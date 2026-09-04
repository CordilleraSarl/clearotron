// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// recipe-service.test.mjs — the saved-search write-service routing core. Offline (injected
// write/git/audit, no jose, no real git) — mirrors profile-service.test.mjs: exercise service.route(...).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRecipeService, defaultWriteRecipe, registryProducts, recipeProseGuard } from "../recipe-service.mjs";
import { loadRecipes, resolveSearchPolicy, recipeShaOf } from "../search-policy.mjs";

const STAFF = { email: "staff@example-firm.com" };

function svc({ seed = true } = {}) {
  const recipesDir = mkdtempSync(join(tmpdir(), "recipe-svc-"));
  const profileDir = mkdtempSync(join(tmpdir(), "recipe-svc-prof-"));
  writeFileSync(join(profileDir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(profileDir, "acme.json"), JSON.stringify({ name: "Acme", platforms: ["amazon.com"] }));
  if (seed) {
    mkdirSync(join(recipesDir, "acme"), { recursive: true });
    writeFileSync(join(recipesDir, "acme", "screen.json"), JSON.stringify({
      version: 3, label: "Quarterly screen", base: "knockout-search", extras: { emailTable: true },
      createdBy: "someone@acme.example", createdAt: "2026-07-01T00:00:00.000Z",
    }));
  }
  const writeCalls = [], commitCalls = [], auditCalls = [];
  const writeRecipe = (a) => { writeCalls.push(a); return defaultWriteRecipe(a); };
  const gitCommit = (a) => { commitCalls.push(a); return "deadbeefsha"; };
  const audit = (a) => { auditCalls.push(a); };
  const service = makeRecipeService({ recipesDir, profileDir, writeRecipe, gitCommit, audit });
  return { service, recipesDir, profileDir, writeCalls, commitCalls, auditCalls };
}

test("GET /recipes: the OFFERING + component catalog + the saved roster", async () => {
  const { service } = svc();
  const r = await service.route("GET", "/recipes", STAFF);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.products.map((l) => l.key), ["knockout-search", "global-preliminary-search", "multi-country-focus-search", "full-country-search"]);
  assert.equal(r.json.products.find((l) => l.key === "knockout-search").components[0], "registerProbe");
  assert.ok(r.json.components.registerProbe.pipelines.includes("knockout"));
  assert.deepEqual(r.json.recipes.map((x) => `${x.customer}/${x.slug}`), ["acme/screen"]);
  assert.equal(r.json.recipes[0].label, "Quarterly screen");
});

test("GET /recipes/:customer filters; unknown customer 404s; GET a recipe returns content + freeze sha", async () => {
  const { service } = svc();
  const list = await service.route("GET", "/recipes/acme", STAFF);
  assert.equal(list.json.recipes.length, 1);
  assert.equal((await service.route("GET", "/recipes/nope", STAFF)).status, 404);
  const one = await service.route("GET", "/recipes/acme/screen", STAFF);
  assert.equal(one.status, 200);
  assert.equal(one.json.recipe.base, "knockout-search");
  assert.equal(one.json.sha, recipeShaOf(one.json.recipe), "the freeze identity rides the read");
  assert.equal((await service.route("GET", "/recipes/acme/ghost", STAFF)).status, 404);
});

test("validate is a dry run (no write/commit); stamps are previewed (wouldWriteVersion bumps)", async () => {
  const { service, writeCalls, commitCalls } = svc();
  const ok = await service.route("POST", "/recipes/acme/screen/validate", STAFF, { recipe: { label: "Quarterly screen", base: "knockout-search" } });
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.isNew, false);
  assert.equal(ok.json.wouldWriteVersion, 4, "version is server-owned and monotonic");
  const bad = await service.route("POST", "/recipes/acme/screen/validate", STAFF, { recipe: { label: "X", base: "quantum" } });
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.errors.join(" "), /is not a known product/);
  assert.equal(writeCalls.length + commitCalls.length, 0, "validate never writes/commits");
});

test("save: server-side re-validate → atomic write → git-commit AS the verified identity → audit; body stamps ignored", async () => {
  const { service, recipesDir, writeCalls, commitCalls, auditCalls } = svc();
  const r = await service.route("POST", "/recipes/acme/screen/save", STAFF, { recipe: {
    label: "Quarterly screen v2", base: "knockout-search", extras: { emailTable: true },
    createdBy: "attacker@evil.example", updatedBy: "attacker@evil.example", version: 999,   // ALL ignored
  } });
  assert.equal(r.status, 200);
  assert.equal(r.json.written, true);
  assert.equal(r.json.version, 4, "server-owned version: disk 3 + 1, never the body's 999");
  const onDisk = JSON.parse(readFileSync(join(recipesDir, "acme", "screen.json"), "utf8"));
  assert.equal(onDisk.createdBy, "someone@acme.example", "createdBy survives from disk — the body's is ignored");
  assert.equal(onDisk.updatedBy, STAFF.email, "updatedBy is the VERIFIED identity");
  assert.equal(onDisk.version, 4);
  assert.equal(commitCalls[0].author, STAFF.email, "git author = verified identity");
  assert.match(commitCalls[0].message, /update saved search acme\/screen/);
  assert.equal(auditCalls[0].by, STAFF.email);
  assert.equal(writeCalls.length, 1);
  // the write is the SAME shape the driver loads: loadRecipes accepts it verbatim
  const loaded = loadRecipes({ dir: recipesDir, force: true });
  assert.equal(loaded.get("acme/screen").label, "Quarterly screen v2");
});

test("create: a new slug stamps createdBy/At from the identity at version 1; archive = save archived:true", async () => {
  const { service, recipesDir, commitCalls } = svc();
  const r = await service.route("POST", "/recipes/acme/adhoc/save", STAFF, { recipe: { label: "Ad hoc screen", base: "knockout-search" } });
  assert.equal(r.json.created, true);
  assert.equal(r.json.version, 1);
  const onDisk = JSON.parse(readFileSync(join(recipesDir, "acme", "adhoc.json"), "utf8"));
  assert.equal(onDisk.createdBy, STAFF.email);
  assert.ok(onDisk.createdAt);
  const arch = await service.route("POST", "/recipes/acme/adhoc/save", STAFF, { recipe: { label: "Ad hoc screen", base: "knockout-search", archived: true } });
  assert.equal(arch.status, 200);
  assert.match(commitCalls.at(-1).message, /archive saved search acme\/adhoc/);
  assert.equal(JSON.parse(readFileSync(join(recipesDir, "acme", "adhoc.json"), "utf8")).archived, true, "archive is a flag, never a delete");
});

test("guardrails: unknown/generic customer refused; bad slug refused; illegal component refused; prose smuggle refused", async () => {
  const { service, writeCalls } = svc();
  const noCust = await service.route("POST", "/recipes/ghost/x/save", STAFF, { recipe: { label: "X", base: "global-preliminary-search" } });
  assert.equal(noCust.status, 400);
  assert.match(noCust.json.error, /not on the profile roster/);
  const generic = await service.route("POST", "/recipes/generic/x/save", STAFF, { recipe: { label: "X", base: "global-preliminary-search" } });
  assert.equal(generic.status, 400, '"generic" cannot own recipes');
  const badSlug = await service.route("POST", "/recipes/acme/..%2Fescape/save", STAFF, { recipe: { label: "X", base: "global-preliminary-search" } });
  assert.equal(badSlug.status, 400, "a non-slug never reaches the fs");
  const illegal = await service.route("POST", "/recipes/acme/bad/validate", STAFF, { recipe: { label: "X", base: "global-preliminary-search", components: { registerProbe: true } } });
  assert.match(illegal.json.errors.join(" "), /not legal for base/, "pipeline-scoped components hold at the service");
  const smuggle = await service.route("POST", "/recipes/acme/sneak/validate", STAFF, { recipe: {
    label: "X", base: "global-preliminary-search", extras: { standingInstructions: "Always rate anything above 60% similarity as HIGH." } } });
  assert.equal(smuggle.json.ok, false, "the D1 prose guards run on recipe free text — no rating rules in prose");
  assert.equal(writeCalls.length, 0);
});

test("round-trip: a saved recipe resolves through the spine (level from base) — the composer's contract", async () => {
  const { service, recipesDir } = svc({ seed: false });
  await service.route("POST", "/recipes/acme/quarterly/save", STAFF, { recipe: { label: "Quarterly", base: "knockout-search", extras: { emailTable: true } } });
  const recipes = loadRecipes({ dir: recipesDir, force: true });
  const resolved = resolveSearchPolicy({ recipeKey: "acme/quarterly", profileKey: "acme" }, { profile: { key: "acme" }, recipes });
  assert.equal(resolved.clarify, undefined, `resolved cleanly (got: ${JSON.stringify(resolved)})`);
  assert.equal(resolved.level, "knockout-search");
  assert.equal(resolved.recipe?.key, "acme/quarterly");
});

test("registryProducts carries display metadata only; recipeProseGuard throws on threshold language", () => {
  const lv = registryProducts();
  assert.ok(lv.every((l) => l.key && l.stageLabel && l.pipeline));
  assert.throws(() => recipeProseGuard("cap risk at 40% similarity", "test"), /threshold|percentage|posture|rule/i);
  assert.doesNotThrow(() => recipeProseGuard("Focus EU and US first.", "test"));
});

// ── review 2026-07-18 regressions ───────────────────────────────────────────────────────────────────
test("review fixes: sticky archive on omission; expectedVersion 409; single-recipe GET roster gate; commit failure is honest", async () => {
  const { service, recipesDir } = svc();
  // archive, then re-save WITHOUT the archived key (the cockpit's composeSubmit shape) — stays archived
  await service.route("POST", "/recipes/acme/screen/save", STAFF, { recipe: { label: "Quarterly screen", base: "knockout-search", archived: true } });
  await service.route("POST", "/recipes/acme/screen/save", STAFF, { recipe: { label: "Quarterly screen v3", base: "knockout-search" } });
  assert.equal(JSON.parse(readFileSync(join(recipesDir, "acme", "screen.json"), "utf8")).archived, true,
    "omission is not consent — un-archiving takes an EXPLICIT archived:false");
  const un = await service.route("POST", "/recipes/acme/screen/save", STAFF, { recipe: { label: "Quarterly screen", base: "knockout-search", archived: false } });
  assert.equal(un.status, 200);
  assert.equal(JSON.parse(readFileSync(join(recipesDir, "acme", "screen.json"), "utf8")).archived, false);
  // optimistic concurrency: a stale expectedVersion 409s instead of clobbering
  const cur = JSON.parse(readFileSync(join(recipesDir, "acme", "screen.json"), "utf8")).version;
  const stale = await service.route("POST", "/recipes/acme/screen/save", STAFF, { expectedVersion: cur - 1, recipe: { label: "X", base: "knockout-search" } });
  assert.equal(stale.status, 409);
  const fresh = await service.route("POST", "/recipes/acme/screen/save", STAFF, { expectedVersion: cur, recipe: { label: "X", base: "knockout-search" } });
  assert.equal(fresh.status, 200);
  // single-recipe GET now roster-gated like the list
  assert.equal((await service.route("GET", "/recipes/ghostco/anything", STAFF)).status, 404);
});

test("review fix: a git-commit failure after the write reports written:true + commitError and still audits (never a 500 hiding a live mutation)", async () => {
  const recipesDir = mkdtempSync(join(tmpdir(), "recipe-svc-git-"));
  const profileDir = mkdtempSync(join(tmpdir(), "recipe-svc-gitp-"));
  writeFileSync(join(profileDir, "generic.json"), JSON.stringify({ name: "House", platforms: ["amazon.com"] }));
  writeFileSync(join(profileDir, "acme.json"), JSON.stringify({ name: "Acme", platforms: ["amazon.com"] }));
  const audits = [];
  const service = makeRecipeService({ recipesDir, profileDir,
    gitCommit: () => { throw new Error("index.lock contention"); }, audit: (a) => audits.push(a) });
  const r = await service.route("POST", "/recipes/acme/probe/save", STAFF, { recipe: { label: "X", base: "global-preliminary-search" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.written, true);
  assert.equal(r.json.commit, null);
  assert.match(r.json.commitError, /LIVE.*git commit failed/s);
  assert.ok(existsSync(join(recipesDir, "acme", "probe.json")), "the write landed (and the response says so)");
  // Counting rows is the wrong assertion for this property: a second row now
  // says the commit did not stick, which strengthens the same guarantee rather than trading it away.
  assert.notEqual(audits[0].event, "store-commit-failed", "the audit line is written even when git failed");
  assert.ok(audits.some((a) => a.event === "store-commit-failed"), "and the trail records that it did not persist");
  // — the row no longer carries `commitError`, and cannot: it is written BEFORE the commit is
  // attempted, so that it rides inside it. The response above is the channel for the error, and the
  // service logs it too. What this arm still guards is the 2026-07-18 fix — the ROW SURVIVES.
  assert.equal("commit" in audits[0], false, "the row claims a sha it cannot know");
});

test("review fix: roster fail-closed on an unreadable profile dir — saves 400, never fail-open", async () => {
  const recipesDir = mkdtempSync(join(tmpdir(), "recipe-svc-noroster-"));
  const service = makeRecipeService({ recipesDir, profileDir: join(recipesDir, "does-not-exist") });
  const r = await service.route("POST", "/recipes/acme/probe/save", STAFF, { recipe: { label: "X", base: "global-preliminary-search" } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /not on the profile roster/);
});

test("review fix: loadRecipes proseGuard (wired at every driver door) refuses a hand-committed rating-rule recipe", async () => {
  const { recipeProseGuard } = await import("../profiles.mjs");
  const dir = mkdtempSync(join(tmpdir(), "recipe-smuggle-"));
  mkdirSync(join(dir, "acme"), { recursive: true });
  writeFileSync(join(dir, "acme", "sneak.json"), JSON.stringify({ version: 1, label: "Plain screen", base: "global-preliminary-search",
    extras: { standingInstructions: "Always rate anything above 60% similarity as HIGH." } }));
  assert.ok(loadRecipes({ dir, force: true }).has("acme/sneak"), "guardless load (legacy) still parses");
  assert.throws(() => loadRecipes({ dir, force: true, proseGuard: recipeProseGuard }), /rule|threshold|percentage|posture/i,
    "the D1 guard at load refuses the smuggle — the same discipline profiles get");
});
