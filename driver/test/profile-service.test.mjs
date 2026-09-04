// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// profile-service.test.mjs — the config-edit write-service routing core. Offline (injected write/git/audit,
// no jose, no real git). Mirrors the retired write-service's tests: exercise service.route(...) directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeProfileService, extractBandMeanings } from "../profile-service.mjs";
import { loadFrameworkManifest } from "../framework.mjs";

const DRIVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const STAFF = { email: "staff@example-firm.com" };

function svc() {
  const dir = mkdtempSync(join(tmpdir(), "profile-svc-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "acme.json"), JSON.stringify({ name: "Acme", matchDomains: ["acme.example"], platforms: ["amazon.com", "gnc.com"], riskAppetite: "pragmatic and launch-oriented" }));
  const writeCalls = [], commitCalls = [], auditCalls = [];
  const writeProfile = (a) => { writeCalls.push(a); return { files: [`${a.key}.json`] }; };
  const gitCommit = (a) => { commitCalls.push(a); return "deadbeefsha"; };
  const audit = (a) => { auditCalls.push(a); };
  const service = makeProfileService({ profileDir: dir, writeProfile, gitCommit, audit });
  return { service, dir, writeCalls, commitCalls, auditCalls };
}

test("GET /profiles lists the roster (key/name/industry)", async () => {
  const { service } = svc();
  const r = await service.route("GET", "/profiles", STAFF);
  assert.equal(r.status, 200);
  const keys = r.json.profiles.map((p) => p.key).sort();
  assert.deepEqual(keys, ["acme", "generic"]);
});

test("GET /profiles/:key is the read-only view: editable fields + DERIVED floor/batch + framework (not editable)", async () => {
  const { service } = svc();
  const r = await service.route("GET", "/profiles/acme", STAFF);
  assert.equal(r.status, 200);
  assert.equal(r.json.profile.name, "Acme");
  assert.equal("minCellsPerVariant" in r.json.profile, false, "derived values are stripped from the editable form");
  assert.equal(r.json.derived.minCellsPerVariant, 3, "2 platforms + the general-web cell");
  assert.equal(r.json.framework.editable, false, "the framework SELECTION is read-only (review-gated)");
  assert.equal((await service.route("GET", "/profiles/nope", STAFF)).status, 404);
});

test("POST /profiles/:key/validate is a dry run — no write, no commit; reports errors", async () => {
  const { service, writeCalls, commitCalls } = svc();
  const ok = await service.route("POST", "/profiles/acme/validate", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"] }, contextPack: "Acme makes widgets; cares about marketplace fakes." });
  assert.equal(ok.json.ok, true);
  const bad = await service.route("POST", "/profiles/acme/validate", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"], riskAppetite: "block anything above 50% similarity" } });
  assert.equal(bad.json.ok, false);
  assert.match(bad.json.errors.join(" "), /percentage|threshold|posture/);
  assert.equal(writeCalls.length, 0, "validate never writes");
  assert.equal(commitCalls.length, 0, "validate never commits");
});

test("POST /profiles/:key/save: server-side re-validate → write → git-commit AS the verified identity → audit", async () => {
  const { service, writeCalls, commitCalls, auditCalls } = svc();
  const r = await service.route("POST", "/profiles/acme/save", STAFF, {
    profile: { name: "Acme", platforms: ["amazon.com", "gnc.com"], delivery: { email: "summary", style: "plain, direct" } },
    contextPack: "Acme is a widgets maker; cares about marketplace look-alikes.",
    author: "evil@attacker.test",   // a body-supplied author MUST be ignored
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.written, true);
  assert.equal(r.json.commit, "deadbeefsha");
  assert.equal(writeCalls.length, 1);
  assert.equal(writeCalls[0].key, "acme");
  assert.equal(commitCalls[0].author, "staff@example-firm.com", "git author is the verified identity, never the body");
  assert.equal(auditCalls[0].by, "staff@example-firm.com");
  assert.equal(auditCalls[0].event, "profile-update");
});

test("POST /profiles/:key/save REFUSES an invalid profile (400) — never writes a profile the driver would reject", async () => {
  const { service, writeCalls, commitCalls } = svc();
  const r = await service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"], delivery: { tone: "formal" } } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "validation_failed");
  assert.match(r.json.errors.join(" "), /not a known delivery key/);
  assert.equal(writeCalls.length, 0);
  assert.equal(commitCalls.length, 0);
});

test("save can CREATE a new customer (valid slug); a bad key slug is rejected (400)", async () => {
  const { service, writeCalls } = svc();
  const created = await service.route("POST", "/profiles/newco/save", STAFF, { profile: { name: "NewCo", platforms: ["amazon.com"] } });
  assert.equal(created.status, 200);
  assert.equal(created.json.created, true, "an absent key is created");
  assert.equal(writeCalls[0].key, "newco");
  const bad = await service.route("POST", "/profiles/Bad_Key/save", STAFF, { profile: { name: "X", platforms: ["amazon.com"] } });
  assert.equal(bad.status, 400, "an unsafe key slug (uppercase/underscore) is rejected before any write");
});

test("guards: bad method → 405; unknown path → 404; missing profile body → 400", async () => {
  const { service } = svc();
  assert.equal((await service.route("PUT", "/profiles/acme/save", STAFF, { profile: {} })).status, 405);
  assert.equal((await service.route("POST", "/profiles/acme/bogus", STAFF, {})).status, 404);
  assert.equal((await service.route("GET", "/nope", STAFF)).status, 404);
  assert.equal((await service.route("POST", "/profiles/acme/save", STAFF, {})).status, 400, "no profile object in the body");
});

// ── code-owned framework selection: a UI save can never drop, change or introduce it ─────────────────────
// Regression for the 2026-07-04/05 UI saves (587324ab, cea0ca2f, c59030a1): the editor form carries no
// framework fields, so a body-built save omitted them and the wholesale write stripped the selection —
// zephyr/aurora silently flipped to the house-default framework.
function svcWithFramework() {
  const dir = mkdtempSync(join(tmpdir(), "profile-svc-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "zephyr.json"), JSON.stringify({
    name: "Zephyr Beverages", platforms: ["amazon.com"],
    frameworkPath: "skills/prelim-search/risk-framework-zephyr.md",
    workedExamplesPath: "skills/prelim-search/worked-examples-zephyr.md",
    delivery: { email: "summary", privileged: true, style: "plain, direct", template: "standard" },
  }));
  writeFileSync(join(dir, "aurora.json"), JSON.stringify({
    name: "Aurora Interactive", platforms: ["amazon.com"],
    frameworkPath: "skills/prelim-search/risk-framework-aurora.md",
    workedExamplesPath: "skills/prelim-search/worked-examples-aurora.md",
  }));
  const writeCalls = [];
  const writeProfile = (a) => { writeCalls.push(a); return { files: [`${a.key}.json`] }; };
  const service = makeProfileService({ profileDir: dir, writeProfile });
  return { service, writeCalls };
}

test("save PRESERVES the framework selection when the client body omits it (the 2026-07-04 regression)", async () => {
  const { service, writeCalls } = svcWithFramework();
  const r = await service.route("POST", "/profiles/zephyr/save", STAFF, { profile: { name: "Zephyr Beverages", platforms: ["amazon.com", "gnc.com"] } });
  assert.equal(r.status, 200);
  assert.equal(writeCalls[0].profile.frameworkPath, "skills/prelim-search/risk-framework-zephyr.md",
    "an omitted frameworkPath is preserved from disk — never dropped");
  assert.equal(writeCalls[0].profile.workedExamplesPath, "skills/prelim-search/worked-examples-zephyr.md");
  assert.deepEqual(writeCalls[0].profile.platforms, ["amazon.com", "gnc.com"], "the actual edit still lands");
});

test("save IGNORES a client-supplied framework selection — on-disk wins, and none can be introduced", async () => {
  const { service, writeCalls } = svcWithFramework();
  await service.route("POST", "/profiles/zephyr/save", STAFF,
    { profile: { name: "Zephyr Beverages", platforms: ["amazon.com"], frameworkPath: "skills/prelim-search/risk-framework.md" } });
  assert.equal(writeCalls[0].profile.frameworkPath, "skills/prelim-search/risk-framework-zephyr.md",
    "a client-supplied CHANGE to the selection is discarded (git + review gated)");
  await service.route("POST", "/profiles/generic/save", STAFF,
    { profile: { name: "House default", platforms: ["amazon.com"], frameworkPath: "skills/prelim-search/risk-framework-zephyr.md" } });
  assert.equal("frameworkPath" in writeCalls[1].profile, false, "a client cannot INTRODUCE a selection on a profile that has none");
});

test("validate dry-runs the EFFECTIVE profile (with the preserved selection) — it judges exactly what save writes", async () => {
  const { service, writeCalls } = svcWithFramework();
  const r = await service.route("POST", "/profiles/zephyr/validate", STAFF,
    { profile: { name: "Zephyr Beverages", platforms: ["amazon.com"], frameworkPath: "not/a/skill.md" } });
  assert.equal(r.json.ok, true, "the bogus client-supplied path is discarded before validation, matching save");
  assert.equal(writeCalls.length, 0, "validate never writes");
});

test("view serves the framework IN FORCE (doc 50): custom flag + manifest ladder for the page", async () => {
  const { service } = svcWithFramework();
  const custom = (await service.route("GET", "/profiles/zephyr", STAFF)).json.framework;
  assert.equal(custom.custom, true, "zephyr has its own framework on file");
  assert.equal(custom.manifest?.framework_key, "zephyr");
  assert.deepEqual(custom.manifest?.bands.map((b) => b.label), ["Very High", "High", "Medium", "Manageable"]);
  assert.equal(custom.manifest?.entity_label, "Zephyr/Volt/Kaskade");
  const house = (await service.route("GET", "/profiles/generic", STAFF)).json.framework;
  assert.equal(house.custom, false, "no custom framework on file ⇒ the house default is in force");
  assert.equal(house.manifest?.framework_key, "house-default");
  assert.equal(house.editable, false, "selection stays read-only either way");
});

// ── band meanings (doc 50, display-only): lifted from the REAL shipped decks at view time ────────────────
// ANTI-SILENT-FAILURE: these parse the decks actually shipped in skills/prelim-search/, so a future deck
// edit that breaks extraction fails CI here instead of silently blanking the page's "What the bands mean" box.
test("view lifts bandMeanings from the REAL shipped decks — matrix table (aurora), band sections (house/zephyr)", async () => {
  const { service } = svcWithFramework();

  // aurora (matrix-shaped): the deck's Band-meanings table rows, in manifest order, with the response column
  const ms = (await service.route("GET", "/profiles/aurora", STAFF)).json.framework;
  assert.deepEqual(ms.bandMeanings?.map((r) => r.band), ["Very High", "High", "Medium", "Manageable", "Low"],
    "aurora: one row per manifest band, in ladder order");
  for (const row of ms.bandMeanings) {
    assert.ok(typeof row.meaning === "string" && row.meaning.trim().length > 3, `aurora ${row.band}: non-empty meaning`);
    assert.ok(typeof row.response === "string" && row.response.trim().length > 3, `aurora ${row.band}: non-empty response`);
  }
  assert.equal(ms.bandMeanings[0].meaning, "Generally not accepted");
  assert.equal(ms.bandMeanings[0].response, "Run alternative name in parallel");

  // zephyr + house (bands-shaped): the band's own "Potential outcomes" prose — deck-native meaning, no response
  const cel = (await service.route("GET", "/profiles/zephyr", STAFF)).json.framework;
  assert.deepEqual(cel.bandMeanings?.map((r) => r.band), ["Very High", "High", "Medium", "Manageable"]);
  for (const row of cel.bandMeanings) {
    assert.ok(typeof row.meaning === "string" && row.meaning.trim().length > 10, `zephyr ${row.band}: non-empty meaning`);
    assert.equal("response" in row, false, "bands-shaped decks have no response column");
  }
  assert.match(cel.bandMeanings[3].meaning, /nuisance/i, "the Manageable meaning is the deck's own outcomes prose");
  const house = (await service.route("GET", "/profiles/generic", STAFF)).json.framework;
  assert.deepEqual(house.bandMeanings?.map((r) => r.band), ["Very High", "High", "Moderate", "Manageable"]);
  for (const row of house.bandMeanings) {
    assert.ok(typeof row.meaning === "string" && row.meaning.trim().length > 10, `house ${row.band}: non-empty meaning`);
  }

  // doc-50 hard line: display-only prose BESIDE the manifest — never a manifest field
  assert.equal("bandMeanings" in ms.manifest, false, "bandMeanings must never become a manifest field");
});

test("bandMeanings is best-effort: a missing framework asset serves the view WITHOUT the key — never a 500", async () => {
  const dir = mkdtempSync(join(tmpdir(), "profile-svc-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "ghost.json"), JSON.stringify({
    name: "Ghost", platforms: ["amazon.com"],
    frameworkPath: "skills/prelim-search/risk-framework-ghost.md",   // valid shape, no such deck/manifest
  }));
  const service = makeProfileService({ profileDir: dir, writeProfile: () => ({ files: [] }) });
  const r = await service.route("GET", "/profiles/ghost", STAFF);
  assert.equal(r.status, 200, "a mid-change framework asset must never 500 the editor");
  assert.equal(r.json.framework.manifest, null);
  assert.equal("bandMeanings" in r.json.framework, false, "no manifest ⇒ no bandMeanings key");
});

test("extractBandMeanings: ANY miss ⇒ null (no partial box); garbled input never throws", () => {
  const msManifest = loadFrameworkManifest(DRIVER_ROOT, "skills/prelim-search/risk-framework-aurora.md");
  const houseManifest = loadFrameworkManifest(DRIVER_ROOT, "skills/prelim-search/risk-framework.md");
  const msDeck = readFileSync(join(DRIVER_ROOT, "skills/prelim-search/risk-framework-aurora.md"), "utf8");
  const houseDeck = readFileSync(join(DRIVER_ROOT, "skills/prelim-search/risk-framework.md"), "utf8");
  // sanity on the real decks (the view test above covers the full contents)
  assert.equal(extractBandMeanings(msDeck, msManifest).length, 5);
  assert.equal(extractBandMeanings(houseDeck, houseManifest).length, 4);
  // the matrix deck WITHOUT its Band-meanings table (the matrix's 2-cell rows alone don't qualify) ⇒ null
  const cut = msDeck.indexOf("## Band meanings");
  assert.ok(cut > 0, "fixture: the shipped aurora deck carries its Band meanings table");
  assert.equal(extractBandMeanings(msDeck.slice(0, cut), msManifest), null);
  // — REWRITTEN, because the old assertion pinned the defect. It required that a deck
  // missing ONE band's outcomes bullet blank the WHOLE box, which is what made a merely RENAMED rung
  // remove the section silently. A band still stating rungs is not a garbled deck: it renders what it
  // has, and only that rung is absent.
  // The rung's NAME is the deck's, and the deck renamed it. Anchored on the last rung's position rather
  // than on either spelling, so this arm does not have to be edited again the next time she renames one.
  const oneMiss = houseDeck.replace(/^- \*\*Potential [a-z]+\.\*\*.*$/m, "");
  const partial = extractBandMeanings(oneMiss, houseManifest);
  assert.ok(Array.isArray(partial) && partial.length === 4,
    "one rung removed from one band blanked the entire box — that is the rename defect, not a protection");
  assert.equal(partial[0].rungs.length, 2, "the band that lost a rung should render its remaining two");
  assert.equal(partial[1].rungs.length, 3, "and the untouched bands are unaffected");
  // …while a band stating NO rungs at all IS garbled, and still returns null. That is the protection the
  // old assertion was really for, kept and now aimed at the case it actually describes.
  const noRungs = houseDeck.replace(/^- \*\*(Legal|Practical|Potential)[^\n]*$/gm, "prose, no rungs");
  assert.equal(extractBandMeanings(noRungs, houseManifest), null,
    "a deck whose bands state no rungs at all must still blank the box — a half-shown framework misleads");
  // garbage in ⇒ null out, no throw
  assert.equal(extractBandMeanings("", houseManifest), null);
  assert.equal(extractBandMeanings("# not a framework\nplain prose, no bands", houseManifest), null);
  assert.equal(extractBandMeanings(null, houseManifest), null);
  assert.equal(extractBandMeanings(msDeck, null), null);
  assert.equal(extractBandMeanings(msDeck, { bands: [] }), null);
});

// ── delivery merge (the page's collect() contract): style/template the form doesn't edit survive a save ──
test("delivery style/template survive the page's save round-trip (view → collect-merge → save)", async () => {
  const { service, writeCalls } = svcWithFramework();
  const before = (await service.route("GET", "/profiles/zephyr", STAFF)).json.profile;
  assert.equal(before.delivery.style, "plain, direct", "the view serves the loaded delivery for the page to merge over");
  // exactly what the page's collect() now does: spread the loaded delivery, overwrite only the form's fields
  const merged = { ...before.delivery, email: "table", privileged: false };
  const r = await service.route("POST", "/profiles/zephyr/save", STAFF, { profile: { ...before, delivery: merged } });
  assert.equal(r.status, 200);
  const written = writeCalls[0].profile.delivery;
  assert.equal(written.style, "plain, direct", "style the form doesn't edit survives the round-trip");
  assert.equal(written.template, "standard", "template the form doesn't edit survives the round-trip");
  assert.equal(written.email, "table", "the form's edits still land");
  assert.equal(written.privileged, false);
});

// ── spec 62 — project overlays under a customer ─────────────────────────────────────────────────────────
function svcP({ gitCommit: gitCommitOver = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "profile-svc-proj-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "aurora.json"), JSON.stringify({
    name: "Aurora Interactive Corporation", matchDomains: ["aurora.com"], platforms: ["store.steampowered.com", "itch.io"],
    marketplaceDensity: "sparse", defaultClasses: [9, 41], defaultJurisdictions: ["Global"],
    selfExclusionOwners: ["Aurora Interactive"], delivery: { email: "summary", privileged: true }, industry: "tech",
    frameworkPath: "skills/prelim-search/risk-framework-aurora.md",
  }));
  const writeCalls = [], commitCalls = [], auditCalls = [];
  const writeProject = (a) => { writeCalls.push(a); return { files: [`projects/${a.customer}/${a.project}.json`] }; };
  // the override lets a test inject a THROWING git (the audit-gap regression below)
  const gitCommit = (a) => { commitCalls.push(a); return gitCommitOver ? gitCommitOver(a) : "projsha123"; };
  const audit = (a) => { auditCalls.push(a); };
  const service = makeProfileService({ profileDir: dir, writeProject, gitCommit, audit });
  return { service, dir, writeCalls, commitCalls, auditCalls };
}
// write a real overlay file on disk (loadProjects reads the fs for the GET view)
function seedProject(dir, customer, slug, overlay, contextPack) {
  mkdirSync(join(dir, "projects", customer), { recursive: true });
  writeFileSync(join(dir, "projects", customer, `${slug}.json`), JSON.stringify(overlay));
  if (contextPack) writeFileSync(join(dir, "projects", customer, `${slug}.context.md`), contextPack);
}

test("spec 62 GET /profiles/:customer/projects lists the customer's projects; unknown customer → 404", async () => {
  const { service, dir } = svcP();
  assert.deepEqual((await service.route("GET", "/profiles/aurora/projects", STAFF)).json.projects, [], "empty at first");
  seedProject(dir, "aurora", "console-ecosystem", { projectName: "Console ecosystem", platforms: ["amazon.com"] });
  const r = await service.route("GET", "/profiles/aurora/projects", STAFF);
  // CONTRACT CHANGE (archive): the list row now carries `archived`. This is the STAFF door, so archived
  // projects are SHOWN and MARKED rather than hidden — hiding is the client-side portal wall's job.
  assert.deepEqual(r.json.projects, [{ key: "console-ecosystem", name: "Console ecosystem", archived: false }]);
  assert.equal((await service.route("GET", "/profiles/ghost/projects", STAFF)).status, 404, "no such customer");
});

test("spec 62 GET /profiles/:customer/projects/:project serves overlay + inherited + effective + origins", async () => {
  const { service, dir } = svcP();
  seedProject(dir, "aurora", "console", { projectName: "Console ecosystem", platforms: ["amazon.com", "walmart.com", "ebay.com"], defaultClasses: [9, 28] }, "# ctx\nConsole peripherals.");
  const r = await service.route("GET", "/profiles/aurora/projects/console", STAFF);
  assert.equal(r.status, 200);
  assert.equal(r.json.customerName, "Aurora Interactive Corporation");
  assert.deepEqual(r.json.overlay, { projectName: "Console ecosystem", platforms: ["amazon.com", "walmart.com", "ebay.com"], defaultClasses: [9, 28] }, "overlay is deltas only");
  assert.deepEqual(r.json.inherited.defaultJurisdictions, ["Global"], "inherited from the customer");
  assert.equal(r.json.effective.platforms.length, 5, "effective platforms UNION the customer's floor with the overlay's adds");
  assert.equal(r.json.origins.platforms, "customer+project");
  assert.equal(r.json.origins.defaultJurisdictions, "customer");
  assert.equal(r.json.derived.minCellsPerVariant, 6, "5 unioned platforms + web");
  assert.ok(r.json.contextPack.includes("Console peripherals"));
  assert.equal((await service.route("GET", "/profiles/aurora/projects/nope", STAFF)).status, 404);
});

test("spec 62 save/validate: a valid overlay writes to projects/<c>/<p>.json, commits AS identity, audits", async () => {
  const { service, writeCalls, commitCalls, auditCalls } = svcP();
  const ok = await service.route("POST", "/profiles/aurora/projects/console/validate", STAFF,
    { profile: { projectName: "Console ecosystem", platforms: ["amazon.com", "walmart.com"], defaultClasses: [9, 28] } });
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.isNew, true);
  assert.equal(writeCalls.length, 0, "validate never writes");
  const saved = await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { projectName: "Console ecosystem", platforms: ["amazon.com", "walmart.com"], defaultClasses: [9, 28] },
      contextPack: "Console peripherals landscape.", author: "evil@attacker.test" });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.written, true);
  assert.equal(writeCalls[0].customer, "aurora");
  assert.equal(writeCalls[0].project, "console");
  assert.equal(commitCalls[0].author, "staff@example-firm.com", "git author is the verified identity, never the body");
  assert.equal(auditCalls[0].event, "project-create");
  assert.equal(auditCalls[0].key, "aurora/console");
});

test("spec 62 save REJECTS a customer-only key (400) — the sparse validator, NOT the silent preserve path", async () => {
  const { service, writeCalls } = svcP();
  const r = await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { projectName: "Console", name: "Console ecosystem", platforms: ["amazon.com"] } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "validation_failed");
  assert.match(r.json.errors.join(" "), /customer-only/, "a name-bearing overlay is a hard 400, never silently stripped");
  assert.equal(writeCalls.length, 0);
});

test("spec 62 project guards: bad slug → 400; bad method → 405; unknown sub-action → 404; missing body → 400", async () => {
  const { service } = svcP();
  assert.equal((await service.route("POST", "/profiles/aurora/projects/Bad_Slug/save", STAFF, { profile: { projectName: "X" } })).status, 400, "an unsafe project slug is rejected before any write");
  assert.equal((await service.route("PUT", "/profiles/aurora/projects/console/save", STAFF, { profile: {} })).status, 405);
  assert.equal((await service.route("POST", "/profiles/aurora/projects/console/bogus", STAFF, {})).status, 404);
  assert.equal((await service.route("POST", "/profiles/aurora/projects/console/save", STAFF, {})).status, 400, "no overlay object in the body");
});

// ---- archive: a save with a flag (no new verb, no new route) -------------------------------------------

test("archive: state is STICKY against omission — a body without `archived` cannot silently un-archive", async () => {
  const { service, dir, writeCalls } = svcP();
  seedProject(dir, "aurora", "console", { archived: true, projectName: "Console", platforms: ["amazon.com"] });
  // exactly what profile-page.html's collectProject() sends: the overlay REBUILT from form inputs, with
  // no `archived` key anywhere in it.
  const r = await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { projectName: "Console renamed", platforms: ["amazon.com"] } });
  assert.equal(r.status, 200);
  assert.equal(writeCalls[0].overlay.archived, true, "omission is not consent — the project stays archived");
  assert.equal(writeCalls[0].overlay.projectName, "Console renamed", "the rest of the edit still lands");
});

test("archive: un-archiving takes an EXPLICIT archived:false", async () => {
  const { service, dir, writeCalls } = svcP();
  seedProject(dir, "aurora", "console", { archived: true, projectName: "Console", platforms: ["amazon.com"] });
  const r = await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { archived: false, projectName: "Console", platforms: ["amazon.com"] } });
  assert.equal(r.status, 200);
  assert.ok(!writeCalls[0].overlay.archived, "an explicit false is the one thing that un-archives");
});

test("archive: a NON-BOOLEAN archived is refused, so `null` cannot un-archive by the back door", async () => {
  // The hole this closes: the validator used to test `archived != null`, the stickiness guard only
  // re-applies the flag when the key is `undefined`, and the loader only lifts `=== true`. So
  // `archived: null` passed the type check, dodged the sticky guard, and then read as live on load —
  // an un-archive that took no explicit false at all, which is exactly what the rule forbids.
  const { service, dir, writeCalls } = svcP();
  seedProject(dir, "aurora", "console", { archived: true, projectName: "Console", platforms: ["amazon.com"] });
  const r = await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { archived: null, projectName: "Console", platforms: ["amazon.com"] } });
  assert.equal(r.status, 400, "an ambiguous archive state is refused rather than guessed at");
  assert.match(JSON.stringify(r.json), /archived must be a boolean/);
  assert.equal(writeCalls.length, 0, "and nothing is written — the project stays archived on disk");
});

test("archive: the commit message encodes the transition — archive / update / create", async () => {
  const { service, dir, commitCalls } = svcP();
  await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { projectName: "Console", platforms: ["amazon.com"] } });
  assert.match(commitCalls[0].message, /create project aurora\/console/);

  seedProject(dir, "aurora", "console", { projectName: "Console", platforms: ["amazon.com"] });
  await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { archived: true, projectName: "Console", platforms: ["amazon.com"] } });
  assert.match(commitCalls[1].message, /archive project aurora\/console/, "live → archived reads as an archive");

  seedProject(dir, "aurora", "console", { archived: true, projectName: "Console", platforms: ["amazon.com"] });
  await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { archived: true, projectName: "Console 2", platforms: ["amazon.com"] } });
  assert.match(commitCalls[2].message, /update project aurora\/console/, "an ordinary save of an already-archived project is still an update");
});

test("archive: a GIT failure no longer loses the audit record (pre-existing defect, fixed here)", async () => {
  // Before this change gitCommit sat outside any try/catch: git throwing AFTER the atomic rename 500'd the
  // request and skipped the audit call entirely — a LIVE overlay with no record of who changed it or when.
  const { service, writeCalls, auditCalls } = svcP({ gitCommit: () => { throw new Error("index.lock exists"); } });
  const r = await service.route("POST", "/profiles/aurora/projects/console/save", STAFF,
    { profile: { projectName: "Console", platforms: ["amazon.com"] } });
  assert.equal(writeCalls.length, 1, "the write already landed");
  assert.equal(r.status, 200, "the mutation is reported, not hidden behind a 500");
  assert.equal(r.json.written, true);
  assert.match(r.json.commitError, /index\.lock exists/, "the response names the git failure");
  // the audit line is written EVEN THOUGH git failed — this is the 2026-07-18 fix. Counting rows is the wrong assertion for it ( adds a second row saying the commit did not stick); what must hold is that the MUTATION row exists and precedes any failure row.
  assert.ok(auditCalls.length >= 1, "the audit line is written EVEN THOUGH git failed — this is the fix");
  assert.notEqual(auditCalls[0].event, "store-commit-failed", "the MUTATION row comes first");
  assert.ok(auditCalls.some((a) => a.event === "store-commit-failed"),
    "and tracker issue 2005: the trail must also say the commit did not stick");
  // — the row no longer carries `commit`/`commitError`, and cannot: it is written BEFORE the commit
  // is attempted, so that it rides inside it and stops being an orphan. The response above names the
  // error; so does the service journal. This arm still guards the 2026-07-18 fix — the ROW SURVIVES.
  assert.equal("commit" in auditCalls[0], false, "the row claims a sha it cannot know");
});

// ---- search-depth spine (review 2026-07-17): the three new keys survive a form save that omits them ----

test("spine keys: allowedRecipes/jxPolicy stay CODE_OWNED; defaultProduct is FORM-OWNED with omission-is-not-consent (absent=preserve, \"\"=unset)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "profile-svc-spine-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "acme.json"), JSON.stringify({
    name: "Acme", platforms: ["amazon.com"],
    defaultProduct: "knockout-search", allowedRecipes: ["knockout-search"], jxPolicy: { providerStance: "default" },
  }));
  const writeCalls = [];
  const service = makeProfileService({ profileDir: dir,
    writeProfile: (a) => { writeCalls.push(a); return { files: [`${a.key}.json`] }; },
    gitCommit: () => "sha", audit: () => {} });
  // the editor posts the FULL profile object it knows about — which has NO spine fields (no form fields yet)
  const r = await service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const written = writeCalls[0].profile;
  assert.equal(written.defaultProduct, "knockout-search", "OMISSION (pre-3a page / stale tab) PRESERVES from disk — the 2026-07-04 silent-strip class stays closed");
  assert.deepEqual(written.allowedRecipes, ["knockout-search"], "fieldless keys must never be stripped by a save");
  assert.deepEqual(written.jxPolicy, { providerStance: "default" });
  // the dropdown's two explicit paths: a value sets; "" is the EXPLICIT unset
  const r2 = await service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"], defaultProduct: "multi-country-focus-search" } });
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  assert.equal(writeCalls[1].profile.defaultProduct, "multi-country-focus-search");
  const r3 = await service.route("POST", "/profiles/acme/save", STAFF, { profile: { name: "Acme", platforms: ["amazon.com"], defaultProduct: "" } });
  assert.equal(r3.status, 200, JSON.stringify(r3.json));
  assert.equal(writeCalls[2].profile.defaultProduct, undefined, '"" is the explicit unset back to the house default');
});

test("spine: a project-overlay save that omits defaultProduct preserves the overlay's existing value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "profile-svc-spine2-"));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  writeFileSync(join(dir, "acme.json"), JSON.stringify({ name: "Acme", platforms: ["amazon.com"] }));
  mkdirSync(join(dir, "projects", "acme"), { recursive: true });
  writeFileSync(join(dir, "projects", "acme", "launch.json"), JSON.stringify({ defaultProduct: "knockout-search", platforms: ["gnc.com"] }));
  const writes = [];
  const service = makeProfileService({ profileDir: dir,
    writeProfile: () => ({ files: [] }),
    writeProject: (a) => { writes.push(a); return { files: [`projects/acme/launch.json`] }; },
    gitCommit: () => "sha", audit: () => {} });
  const r = await service.route("POST", "/profiles/acme/projects/launch/save", STAFF, { profile: { platforms: ["gnc.com", "amazon.com"] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(writes[0].overlay.defaultProduct, "knockout-search", "an overlay save without the field keeps the engagement's depth default");
});

// ══ 2080: reads answer from the DEPLOYMENT'S LAYERED VIEW; writes keep the store ══════════════════
//
// The owner's fresh install: the wizard creates an empty store and calls it working; the engine agrees
// (generic falls through from the bundled base — pinned by config-resolves-outside-the-checkout's
// spawned arm); this service read the store dir alone and 500'd every Profiles screen. `readLayered`
// is the construction fact the portal passes; these arms pin the PLUMBING (which loader form each
// route uses) and the PRESERVATION behaviour on a shown-through profile. The real loader's layering
// is not re-proven here — one author, one pin.

function layeredSvc() {
  // The injected loader RECORDS how it was asked, and emulates the two views: asked with `dir` it is
  // the empty store (what the deployment's store dir holds); asked without, the layered view where
  // the bundled generic shows through carrying a code-owned field the client body will not send.
  const calls = [];
  const shownThroughGeneric = { key: "generic", name: "House default", platforms: ["amazon.com"],
    frameworkPath: "skills/prelim-search/risk-framework.md" };
  const loadProfiles = (opts = {}) => {
    calls.push(opts);
    if (opts.dir !== undefined) return new Map();                       // the store alone: EMPTY
    return new Map([["generic", shownThroughGeneric]]);                 // layered: generic shows through
  };
  const writeCalls = [];
  const writeProfile = (a) => { writeCalls.push(a); return { files: [`${a.key}.json`] }; };
  const service = makeProfileService({ profileDir: "/srv/empty-store", readLayered: true,
    loadProfiles, writeProfile, gitCommit: () => "sha", audit: () => {} });
  return { service, calls, writeCalls };
}

test("2080: every read route asks for the layered view when constructed readLayered — the roster answers on an empty store", async () => {
  const { service, calls } = layeredSvc();
  const roster = await service.route("GET", "/profiles", STAFF);
  assert.equal(roster.status, 200, JSON.stringify(roster.json));
  assert.deepEqual(roster.json.profiles.map((p) => p.key), ["generic"],
    "the shown-through generic reaches the screen instead of a 500");
  const one = await service.route("GET", "/profiles/generic", STAFF);
  assert.equal(one.status, 200);
  // THE PLUMBING PIN: not one read asked with `dir` — the explicit form is what bypassed layering.
  assert.ok(calls.length > 0, "the loader was consulted at all");
  assert.deepEqual(calls.filter((c) => c.dir !== undefined), [],
    "a readLayered service must never read the store dir alone");
});

test("2080: saving a SHOWN-THROUGH profile preserves its code-owned fields — the omitted-field class on the override-by-name path", async () => {
  // THE PLANT THIS GUARDS: preservation resolved from the store-alone view finds no existing generic,
  // preserves from null, and the first override-by-name save silently drops frameworkPath — the
  // 2026-07-04 class arriving through the new road. The client body legitimately omits it.
  const { service, writeCalls } = layeredSvc();
  const r = await service.route("POST", "/profiles/generic/save", STAFF,
    { profile: { name: "House default", platforms: ["amazon.com", "gnc.com"] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(writeCalls.length, 1, "the write lands in the store — override-by-name working");
  assert.equal(writeCalls[0].profile.frameworkPath, "skills/prelim-search/risk-framework.md",
    "the shown-through profile's code-owned framework survives a body that omits it");
});

test("2080: a fixture-built service keeps the explicit read it always had — readLayered is a construction fact, not a default", async () => {
  const { service, dir } = svc();
  const r = await service.route("GET", "/profiles", STAFF);
  assert.equal(r.status, 200);
  assert.ok(r.json.profiles.map((p) => p.key).includes("acme"), `the fixture roster answers from ${dir}`);
});

test("2080: THE DEPLOYMENT SHAPE, no injection — a real empty store, the real loader, the roster answers", () => {
  // The owner's box, reproduced: CLEAROTRON_CUSTOMERS_DIR names an empty directory, the service is
  // constructed the way portal-service constructs it (readLayered), and GET /profiles must answer with
  // the shown-through generic instead of the REQUIRED refusal. Spawned, because the loader captures the
  // env at module top — an in-process env write is invisible to it.
  //
  // 2064 discipline: a spawn's status/error is read BEFORE its stdout means anything — an empty stdout
  // on a loaded box must say "the child did not come back", never a verdict about the roster.
  const store = mkdtempSync(join(tmpdir(), "empty-store-"));
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { makeProfileService } from ${JSON.stringify(fileURLToPath(new URL("../profile-service.mjs", import.meta.url)))};
    const svc = makeProfileService({ profileDir: process.env.CLEAROTRON_CUSTOMERS_DIR, readLayered: true });
    const r = await svc.route("GET", "/profiles", { email: "staff@example-firm.com" });
    console.log(JSON.stringify({ status: r.status, keys: (r.json.profiles ?? []).map((p) => p.key) }));
  `], { encoding: "utf8", env: { ...process.env, CLEAROTRON_CUSTOMERS_DIR: store }, timeout: 30000 });
  rmSync(store, { recursive: true, force: true });
  assert.ok(!child.error && child.status === 0,
    `the child did not come back clean (status=${child.status} signal=${child.signal} error=${child.error?.message ?? "none"}) — stderr:\n${child.stderr}`);
  const out = (() => { try { return JSON.parse(child.stdout.trim().split("\n").pop()); } catch { return null; } })();
  assert.ok(out, `the child printed no parseable verdict — raw stdout: ${JSON.stringify(child.stdout)}`);
  assert.equal(out.status, 200, "an empty store must answer, not refuse — this is the owner's 500");
  assert.deepEqual(out.keys, ["generic"], "generic — and only generic — shows through to the screen");
});
