// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// search-policy.test.mjs — the search-depth spine's SELECTION layer.
// Pure-module tests: search-policy.mjs is a leaf (node builtins only), so no env pinning is needed.
// What must hold forever:
//   - the registry is CLOSED and self-consistent (every level's components are legal for its pipeline);
//   - resolution order is job.recipeKey → job.product → profile default → house "prelim", and ANY
//     unknown token CLARIFIES (a typo must never silently run a different-priced product);
//   - the golden rule is STRUCTURAL: recipe keys share nothing with profile keys (a recipe cannot name a
//     rating-adjacent knob even by accident);
//   - the admission gate refuses what this build/deployment cannot run, loudly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE_DIR = dirname(fileURLToPath(import.meta.url));

import {
  ORDERABLE_PRODUCTS, RETIRED_PRODUCTS, COMPONENTS, PRODUCT_POLICIES, RETIRED_POLICIES, policyFor, BUILT,
  resolveSearchPolicy, gateResolvedPolicy, gateCause, UNAVAILABLE_NOTE, coverageDisclosure, checkMarkBudget, checkScopeAgainstPolicy, countJobMarks,
  validateRecipe, loadRecipes, recipeShaOf, RECIPE_KEYS, RECIPE_EXTRA_KEYS,
} from "../search-policy.mjs";
import { KNOWN_PROFILE_KEYS } from "../profiles.mjs";
// — the product's OWN geography string, so the disclosure is asked the same
// question the gate is rather than a phrase retyped here.
import { PRODUCTS as ALL_PRODUCTS } from "../products.mjs";
const WORLDWIDE_GEOGRAPHY = ALL_PRODUCTS.find((p) => p.geography === "worldwide, and nothing else").geography;

// ── registry self-consistency ────────────────────────────────────────────────────────────────────────
test("registry: PRODUCT_POLICIES keys ⇄ orderable ∪ retired exactly; components legal per pipeline; labels present", () => {
  // PRODUCT_POLICIES is the NAMING set and ORDERABLE_PRODUCTS the ORDERABLE one, and since they differ.
  // Pinned as a partition so a row can never be in neither: that row would be a level nobody can order
  // and nobody declared retired — a menu entry that vanishes with no record of the decision.
  // THE ORDERABLE SET IS THE OFFERING, and there is no second list to drift from it: the row keys ARE
  // PRODUCT_IDS, exactly. The retired rows live in their own map, so a row can never be in neither — a
  // row nobody can order and nobody declared retired is how a menu silently loses an entry.
  assert.deepEqual(Object.keys(PRODUCT_POLICIES), [...ORDERABLE_PRODUCTS],
    "the registry's rows are the offering, in offering order");
  assert.deepEqual(Object.keys(RETIRED_POLICIES).sort(), [...RETIRED_PRODUCTS].sort());
  for (const key of RETIRED_PRODUCTS) {
    assert.ok(!ORDERABLE_PRODUCTS.includes(key), `${key}: a retired row must not be orderable`);
    assert.ok(policyFor(key), `${key}: a retired row keeps its entry — it names archived runs`);
    assert.match(RETIRED_POLICIES[key].stageLabel, /^Depth /, `${key}: keeps the rung it was sold under`);
  }
  for (const [level, p] of Object.entries(PRODUCT_POLICIES)) {
    assert.ok(["knockout", "clearance"].includes(p.pipeline), `${level}: pipeline must be a known shape`);
    assert.ok(p.stageLabel, `${level}: stageLabel is display metadata and must exist`);
    // An ORDERABLE row's label is the PRODUCT'S OWN NAME; a retired row keeps the rung it was sold under
    // ("Depth 4"), which is the only reason those rows still exist.
    if (ORDERABLE_PRODUCTS.includes(level)) assert.equal(p.stageLabel, p.report.identity, `${level}: the label IS the name`);
    else assert.match(p.stageLabel, /^Depth /, `${level}: a retired row keeps the rung it was sold under`);
    assert.equal(p.maxMarks, undefined, `${level}: the name count is the OFFERING's figure, never a second one here`);
    for (const [ck, on] of Object.entries(p.components)) {
      assert.ok(COMPONENTS[ck], `${level}: component ${ck} must be registered`);
      if (on) assert.ok(COMPONENTS[ck].pipelines.includes(p.pipeline),
        `${level}: enables ${ck} but ${ck} is not legal for pipeline ${p.pipeline} — the orthogonality invariant`);
    }
  }
  assert.equal(policyFor("GLOBAL-PRELIMINARY-SEARCH").pipeline, "clearance", "product lookup is case-insensitive");
  assert.equal(policyFor("nope"), null);
});

test("golden rule is structural: RECIPE_KEYS ∩ KNOWN_PROFILE_KEYS = ∅ (a recipe can never name profile/rating config)", () => {
  const overlap = RECIPE_KEYS.filter((k) => KNOWN_PROFILE_KEYS.includes(k));
  assert.deepEqual(overlap, [], `recipe keys must never collide with profile keys (got: ${overlap.join(", ")})`);
  for (const banned of ["frameworkPath", "riskAppetite", "delivery", "platforms", "workedExamplesPath"]) {
    assert.ok(!RECIPE_KEYS.includes(banned), `${banned} must never be a recipe key`);
    assert.ok(!RECIPE_EXTRA_KEYS.includes(banned), `${banned} must never be a recipe extra`);
  }
});

// ── resolution order + clarify-never-substitute ─────────────────────────────────────────────────────
test("resolution: with nothing named, THE SCOPE names the product; an explicit one beats a profile default", () => {
  // There is no house-default product any more, and its removal is the change. `prelim` used to be it,
  // and `prelim` named three different searches depending on where it pointed — so the default was a
  // guess wearing a level key. A clearance that names no product IS whichever product its resolved
  // territories make it.
  const r0 = resolveSearchPolicy({}, {});
  assert.equal(r0.product, "global-preliminary-search", "no territories ⇒ worldwide ⇒ the global search");
  assert.equal(r0.pipeline, "clearance");
  assert.equal(r0.origins.level, "the-scope");
  assert.equal(resolveSearchPolicy({}, { territories: ["United States"] }).product, "full-country-search");
  assert.equal(resolveSearchPolicy({}, { territories: ["France", "Germany"] }).product, "multi-country-focus-search");
  assert.equal(resolveSearchPolicy({}, { territories: ["European Union"] }).product, "multi-country-focus-search");
  const prof = { key: "acme", defaultProduct: "knockout-search" };
  const r1 = resolveSearchPolicy({}, { profile: prof });
  assert.equal(r1.product, "knockout-search");
  assert.equal(r1.origins.level, "profile.defaultProduct");
  const r2 = resolveSearchPolicy({ product: "global-preliminary-search" }, { profile: prof });
  assert.equal(r2.product, "global-preliminary-search", "an explicit job selector beats the profile default");
  assert.equal(r2.origins.level, "job.product");
});

test("resolution: a spec-62 PROJECT default is named as the origin", () => {
  const prof = { key: "acme", defaultProduct: "knockout-search", origins: { defaultProduct: "project" } };
  const r = resolveSearchPolicy({}, { profile: prof });
  assert.equal(r.product, "knockout-search");
  assert.equal(r.origins.level, "project.defaultProduct");
});

test("resolution: unknown tokens CLARIFY — job level, profile default, and both-selectors-set", () => {
  assert.match(resolveSearchPolicy({ product: "knock" }, {}).clarify, /names no search we offer/);
  assert.match(resolveSearchPolicy({}, { profile: { key: "acme", defaultProduct: "stage-9" } }).clarify, /fix the acme profile/);
  assert.match(resolveSearchPolicy({ product: "global-preliminary-search", recipeKey: "quick" }, {}).clarify, /name ONE selector/);
  // A RETIRED level key is refused BY NAME rather than silently resolving to the row that still names
  // archived runs — the orderability wall, from the direction a stale request comes at it.
  assert.match(resolveSearchPolicy({ product: "prelim" }, {}).clarify, /names no search we offer/);
});

test("resolution: allowedRecipes (when present) is a closed menu over the RESOLVED selection, any source", () => {
  const prof = { key: "acme", allowedRecipes: ["knockout-search"] };
  assert.equal(resolveSearchPolicy({ product: "knockout-search" }, { profile: prof }).product, "knockout-search");
  assert.match(resolveSearchPolicy({ product: "global-preliminary-search" }, { profile: prof }).clarify, /not in acme's allowed searches/);
  // a staff-set default that contradicts the entitlement surfaces as a clarify, never a silent re-pick
  const contradictory = { key: "acme", defaultProduct: "global-preliminary-search", allowedRecipes: ["knockout-search"] };
  assert.match(resolveSearchPolicy({}, { profile: contradictory }).clarify, /not in acme's allowed searches/);
  // absent list ⇒ everything allowed (no behavior change for existing profiles)
  assert.equal(resolveSearchPolicy({ product: "multi-country-focus-search" }, { profile: { key: "acme" } }).product, "multi-country-focus-search");
});

test("resolution: recipes — expansion, content-sha freeze identity, customer scoping, archived, unknown", () => {
  const recipe = { version: 2, label: "Quarterly screen", base: "knockout-search", components: { registerProbe: true }, extras: { emailTable: true } };
  const recipes = new Map([["acme/quick", recipe], ["other/quick", { ...recipe }]]);
  const prof = { key: "acme" };
  const r = resolveSearchPolicy({ recipeKey: "quick" }, { profile: prof, recipes });
  assert.equal(r.product, "knockout-search");
  assert.equal(r.components.registerProbe, true, "recipe toggles overlay the base level's components");
  assert.equal(r.recipe.key, "acme/quick");
  assert.equal(r.recipe.version, 2);
  assert.equal(r.recipe.sha, recipeShaOf(recipe), "the freeze identity is the recipe CONTENT sha");
  assert.deepEqual(r.extras, { emailTable: true });
  assert.equal(r.origins.level, "job.recipeKey");
  // allowedRecipes matches a RECIPE only by its own identity (slug or full key) — a listed bare level
  // entitles that level, never every recipe based on it (review 2026-07-17)
  assert.equal(resolveSearchPolicy({ recipeKey: "quick" }, { profile: { key: "acme", allowedRecipes: ["quick"] }, recipes }).product, "knockout-search");
  assert.equal(resolveSearchPolicy({ recipeKey: "quick" }, { profile: { key: "acme", allowedRecipes: ["acme/quick"] }, recipes }).product, "knockout-search");
  assert.match(resolveSearchPolicy({ recipeKey: "quick" }, { profile: { key: "acme", allowedRecipes: ["global-preliminary-search"] }, recipes }).clarify, /not in acme's allowed searches/);
  assert.match(resolveSearchPolicy({ recipeKey: "quick" }, { profile: { key: "acme", allowedRecipes: ["knockout-search"] }, recipes }).clarify,
    /not in acme's allowed searches/, "listing the knockout-search PRODUCT must not legitimize an unlisted recipe based on it");
  // cross-customer, unknown, archived ⇒ clarify
  assert.match(resolveSearchPolicy({ recipeKey: "other/quick" }, { profile: prof, recipes }).clarify, /only run for its own customer/);
  assert.match(resolveSearchPolicy({ recipeKey: "ghost" }, { profile: prof, recipes }).clarify, /names no saved search/);
  const archived = new Map([["acme/quick", { ...recipe, archived: true }]]);
  assert.match(resolveSearchPolicy({ recipeKey: "quick" }, { profile: prof, recipes: archived }).clarify, /archived/);
});

test("recipeShaOf: canonical — key-order independent, content-sensitive", () => {
  const a = { label: "X", base: "knockout-search", components: { registerProbe: true } };
  const b = { components: { registerProbe: true }, base: "knockout-search", label: "X" };
  assert.equal(recipeShaOf(a), recipeShaOf(b));
  assert.notEqual(recipeShaOf(a), recipeShaOf({ ...a, label: "Y" }));
});

// ── the admission gate (built-shape availability; the kill switches were retired 2026-07-27) ────────
test("gate: every BUILT level passes, with no environment at all — the switches are gone", () => {
  // This test used to assert the opposite for knockout, prelim-jx and recipes: BUILT but refused until a
  // CLEAROTRON_* switch was set. Those three switches sat over shipped machinery, so on any correct
  // deployment they could only read `true` — and on a process without an engine environment (the portal,
  // the ops-MCP) they read as OFF and refused shipped depths. Availability is now the build alone.
  const del = (k) => delete process.env[k];
  del("CLEAROTRON_KNOCKOUT_MODE"); del("CLEAROTRON_JX_LANES"); del("CLEAROTRON_RECIPES_MODE");
  assert.equal(gateResolvedPolicy(resolveSearchPolicy({}, {})), null, "a scope-named clearance is always runnable");
  assert.equal(gateResolvedPolicy(resolveSearchPolicy({ product: "knockout-search" }, {})), null, "knockout is BUILT ⇒ runnable");
  // The register count probe is BUILT. Whether the ACTIVE PROVIDER can count is a different question,
  // answered at the lane's preflight (driver/register-count.mjs) and reflected to client surfaces through
  // the flag snapshot's `built` map, never from an env var here: this module is a pure leaf.
  assert.equal(gateResolvedPolicy(resolveSearchPolicy({ product: "full-country-search" }, {})), null, "the deepest too");
  assert.equal(gateResolvedPolicy(resolveSearchPolicy({ product: "multi-country-focus-search", nativeLanguage: true }, {})), null, "the native lane is BUILT ⇒ runnable");
  // a recipe-resolved selection is honoured wherever it resolves
  const recipes = new Map([["acme/plain", { label: "Plain", base: "global-preliminary-search" }]]);
  const viaRecipe = resolveSearchPolicy({ recipeKey: "plain" }, { profile: { key: "acme" }, recipes });
  assert.equal(gateResolvedPolicy(viaRecipe), null, "a saved search needs no switch");
  assert.match(gateResolvedPolicy({ clarify: "boom" }), /boom/, "a clarify resolution gates as itself");

  // UNBUILT still refuses, and that is the point: the gate did not become a no-op, it became honest.
  const koReg = resolveSearchPolicy({ product: "knockout-search" }, {});
  assert.match(gateResolvedPolicy(koReg, { built: { ...BUILT, registerProbe: false } }), /not available in this build/);
  // The native-language investigation is OFF on a Multi-country focus search until it is asked for, so
  // the shape that meets an unbuilt lane is either the request that asked, or the product that carries
  // it automatically. Both, because a gate that only judged one of them would be half a gate.
  assert.match(gateResolvedPolicy(resolveSearchPolicy({ product: "multi-country-focus-search", nativeLanguage: true }, {}), { built: { ...BUILT, jxLanes: false } }),
    /not available in this build/);
  assert.match(gateResolvedPolicy(resolveSearchPolicy({ product: "full-country-search" }, {}), { built: { ...BUILT, jxLanes: false } }),
    /not available in this build/);
});

// ── gateCause: the same gate, as a code ──────────────────────────────────────────────────────────────
//
// The prose gate writes for staff, logs and the runner's clarify path. Client-facing doors need the same
// knowledge in client words, so gateCause answers in causes. The contract that keeps the two honest is
// EQUIVALENCE: over every resolution shape, exactly one of them may be null.
test("gateCause is null exactly when gateResolvedPolicy is — one gate, two vocabularies", () => {
  const recipes = new Map([["acme/plain", { label: "Plain", base: "global-preliminary-search" }]]);
  const cases = [
    ["default prelim", resolveSearchPolicy({}, {})],
    ["knockout", resolveSearchPolicy({ product: "knockout-search" }, {})],
    ["knockout-register", resolveSearchPolicy({ product: "knockout-search" }, {})],
    ["prelim-jx", resolveSearchPolicy({ product: "multi-country-focus-search" }, {})],
    ["register-only", resolveSearchPolicy({ product: "prelim-register-only" }, {})],
    ["via recipe", resolveSearchPolicy({ recipeKey: "plain" }, { profile: { key: "acme" }, recipes })],
    ["clarify", { clarify: "boom" }],
    ["nothing at all", null],
  ];
  // The switch matrix this loop used to sweep is gone. What replaces it is the BUILT matrix — the only
  // axis left that can make a level unavailable, and the one the two gates must still agree about.
  for (let bits = 0; bits < 8; bits++) {
    const built = { knockout: !!(bits & 1), jxLanes: !!(bits & 2), registerProbe: !!(bits & 4) };
    for (const [label, resolved] of cases) {
      const prose = gateResolvedPolicy(resolved, { built });
      const cause = gateCause(resolved, { built });
      assert.equal(cause === null, prose === null,
        `${label} @ ${JSON.stringify(built)}: the two gates disagreed — prose=${JSON.stringify(prose)} cause=${JSON.stringify(cause)}`);
      if (cause) assert.ok(["unresolved", "unbuilt"].includes(cause.cause),
        `${label}: unknown cause "${cause.cause}" — 'disabled' and 'recipes-disabled' were retired with the switches`);
    }
  }
});

test("gateCause measures the RESOLVED policy, so a product's own automatic machinery is judged", () => {
  // A saved search can no longer ADD the native-language component — the product decides it, and
  // validateRecipe refuses one. What a RESOLUTION still carries that its base row does not is the
  // product's own automatic arm, which is what this measures.
  const resolved = resolveSearchPolicy({ product: "full-country-search" }, {});
  assert.equal(resolved.components.jxLanes, true);
  assert.deepEqual(gateCause(resolved, { built: { ...BUILT, jxLanes: false } }),
    { cause: "unbuilt", product: resolved.product, stageLabel: resolved.stageLabel });
  assert.equal(gateCause(policyFor("global-preliminary-search"), { built: { ...BUILT, jxLanes: false } }), null,
    "…while a product that does not carry it really is runnable");
  assert.equal(gateCause(resolved), null, "and on this build, which HAS the lanes, it runs");
});

test("the client-facing notes carry no switch name, and no longer promise a switch can be flipped", () => {
  const words = Object.values(UNAVAILABLE_NOTE).join(" ");
  // `disabled` went with the kill switches. Its sentence — "Not switched on for this account yet —
  // Cordillera can enable it." — is exactly what clients were wrongly told about three shipped depths,
  // so leaving it reachable would keep that lie one wiring mistake away.
  // ── — `register-not-worldwide` IS GONE FROM THIS MAP, deliberately ────────
  //
  // The closed-set assertion is the whole point of this arm, so the removal is stated here rather than
  // read past. Every client-facing surface renders a product's refusal as `UNAVAILABLE_NOTE[cause]`;
  // while a sentence sat here for the worldwide coverage cause, the owner's 2026-08-31 ruling — that
  // coverage is disclosed and never refused — held only as long as `productAvailability` remembered not
  // to return it. With no sentence there is nothing for a door to render, so the ruling is structural.
  // The cause is still computed, and `coverageDisclosure` says what the register DOES reach.
  // ── — `demo` IS GONE FROM THIS MAP TOO, and for the same reason ───────────
  //
  // The owner's ruling of 2026-08-31 14:47 superseded his own of 14:44: a demo's products are ORDERABLE,
  // and the confirmation resolves to a report that already exists rather than dispatching. While a
  // refusal sentence sat here the greyed control was one `return "demo"` away from returning — and it
  // had already returned once, because the handover carried the superseded ruling. With no sentence
  // there is nothing for a door to render. What stops a demo spending is now the run route, where an arm
  // counts calls to the trigger seam.
  // D6 — `register-coverage` is deleted too. Neither coverage cause refuses;
  // what is left refusing is a capability gap (`register-cannot-count`) and an unbuilt component.
  assert.deepEqual(Object.keys(UNAVAILABLE_NOTE).sort(),
    ["register-cannot-count", "unbuilt"]);
  // The second cause exists because "unbuilt" was answering two different questions. A deployment whose
  // register cannot COUNT was told "Not part of the current release" — so the reader waits for a version
  // that will never fix it, when the fix is a different register. Its sentence must name no vendor
  // (one register, never a baked-in provider name) and must not imply a release will help.
  assert.match(UNAVAILABLE_NOTE["register-cannot-count"], /cannot return filing counts/);
  assert.doesNotMatch(UNAVAILABLE_NOTE["register-cannot-count"], /release|version|corsearch|clarivate|signa/i);
  //. This reader has no shell open, no account to ask about and quite possibly
  // no machine of ours in front of them, so the sentence names no switch, no command and no file — the
  // one thing they can act on is what the install IS and what a real one would need. A command printed
  // at the wrong reader is its own defect, and this is the wrong reader.
  assert.equal(UNAVAILABLE_NOTE.demo, undefined,
    "the demo refusal sentence is back, so a demo can grey its products again");
  assert.doesNotMatch(words, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, "a client-facing sentence named an environment variable");
  assert.match(UNAVAILABLE_NOTE.unbuilt, /^Not part of the current release\.$/);
  assert.doesNotMatch(words, /switched on/i, "nothing left here claims a switch is waiting to be flipped");

  // — the two COVERAGE causes, held to the same standard and for the same reason. A register that
  // reaches the EU and the US reaches plenty of places and still cannot honour a worldwide search, so
  // "not worldwide" and "not enough territories" are two facts: one sentence for both would give a
  // client the wrong answer to "why".
  //
  // ── — AND THEY NOW LIVE IN DIFFERENT MAPS ────────────────────────────────
  //
  // The worldwide cause discloses where the other refuses, so its words are `coverageDisclosure`'s and
  // not this map's. The standard does not change with the map — it is read by the same client, on the
  // same screen — so the loop reads whichever sentence each cause actually has.
  // BOTH now live in the disclosure map rather than the refusal one (D6). The standard does not change
  // with the map — the same client reads them on the same screen.
  const ONE_COUNTRY = ALL_PRODUCTS.find((p) => p.geography === "exactly one country").geography;
  const coverageSentences = {
    "register-coverage": coverageDisclosure(ONE_COUNTRY, ["European Union"])?.note,
    "register-not-worldwide": coverageDisclosure(WORLDWIDE_GEOGRAPHY, ["European Union"])?.note,
  };
  assert.notEqual(coverageSentences["register-not-worldwide"], coverageSentences["register-coverage"]);
  for (const [k, sentence] of Object.entries(coverageSentences)) {
    assert.ok(sentence, `${k}: has no client-facing sentence at all`);
    assert.match(sentence, /trademark register wired to this deployment|whole world/,
      `${k}: says WHICH register, without naming one`);
    // No vendor, and no promise that a release will help — a coverage limit is fixed by a different
    // register, never a newer version, which is the same distinction the count arm above draws.
    assert.doesNotMatch(sentence, /release|version|corsearch|clarivate|signa|euipo|uspto|free-tier/i,
      `${k}: named a vendor, or told a client to wait for a version that will never fix it`);
    assert.doesNotMatch(sentence, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `${k}: named an environment variable`);
  }
});

test("no source still refuses a recipeKey — the saved-search door has no shut state", () => {
  // Three doors used to refuse a recipeKey when CLEAROTRON_RECIPES_MODE was off (the portal's 422, plan_run's
  // blockers, describe_options' empty list) and shared one sentence so they could not drift. The switch is
  // retired, so the correct number of copies of that sentence is zero — including in search-policy itself.
  const REPO = join(HERE_DIR, "..", "..");
  const sources = [
    join(REPO, "driver", "search-policy.mjs"),
    join(REPO, "driver", "portal-service.mjs"),
    join(REPO, "mcp-server", "lib", "plan.mjs"),
    join(REPO, "mcp-server", "lib", "options.mjs"),
  ];
  for (const f of sources) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /Saved searches are not switched on/,
      `${f} still carries the retired saved-search refusal`);
  }
});

// ── mark budget ─────────────────────────────────────────────────────────────────────────────────────
test("name budget: the OFFERING's figure, on EVERY product — and the soft cap is gone with the second number", () => {
  const marks = (n) => ({ marks: Array.from({ length: n }, (_, i) => ({ name: `MARK-${i}` })) });
  const ko = policyFor("knockout-search");
  assert.deepEqual(checkMarkBudget(marks(8), ko), { errors: [], warnings: [] });
  assert.match(checkMarkBudget(marks(9), ko).errors[0], /9 names exceeds the 8-name limit/);
  // No soft cap. A warning at 15 under a refusal at 8 is a branch that can never fire, and a rule that
  // cannot fire is worse than no rule because it reads as coverage.
  assert.deepEqual(checkMarkBudget(marks(8), ko).warnings, []);
  // EVERY PRODUCT IS BUDGETED NOW. The clearances always said one name and were never enforced, so a
  // three-name clearance was accepted at the door and ran one with the other two silently dropped.
  const errs = checkMarkBudget(marks(5), policyFor("global-preliminary-search")).errors;
  assert.match(errs[0], /5 names exceeds the 1-name limit/);
  assert.match(errs[0], /order a Knockout search to screen them together/, "the way through is named");
  assert.deepEqual(checkMarkBudget(marks(1), policyFor("global-preliminary-search")), { errors: [], warnings: [] });
  // A RETIRED row has no offering figure and is not budgeted — nothing can be ordered at one.
  assert.deepEqual(checkMarkBudget(marks(9), policyFor("prelim")), { errors: [], warnings: [] });
  assert.equal(countJobMarks({ markName: "SOLO" }), 1);
  assert.equal(countJobMarks(marks(3)), 3);
});

// ── recipe validation + the store loader ────────────────────────────────────────────────────────────
test("validateRecipe: closed keys, legal components per base, extras whitelist, slug + free-text budgets", () => {
  const ok = validateRecipe("acme", "quick", { label: "Quick", base: "knockout-search", components: { registerProbe: true }, extras: { emailTable: true, standingInstructions: "Call out the Benelux position when one exists." } });
  assert.deepEqual(ok, { ok: true, errors: [] });
  assert.match(validateRecipe("acme", "quick", { label: "X", base: "knockout-search", frameworkPath: "y" }).errors[0], /unknown key "frameworkPath"/);
  assert.match(validateRecipe("acme", "quick", { label: "X", base: "stage-2" }).errors[0], /is not a known product/);
  assert.match(validateRecipe("acme", "quick", { label: "X", base: "global-preliminary-search", components: { registerProbe: true } }).errors[0], /not legal for base/);
  assert.match(validateRecipe("acme", "quick", { label: "X", base: "global-preliminary-search", extras: { widget: 1 } }).errors[0], /not a known extra/);
  // A RETIRED extra refuses by name and says why, rather than falling into the generic "unknown extra":
  // a deadline is temporal and belongs to the request, not to a template that outlives it (owner, 2026-07-27).
  assert.match(validateRecipe("acme", "quick", { label: "X", base: "global-preliminary-search", extras: { defaultDeadlineDays: 5 } }).errors[0], /no longer a saved-search setting.*belongs to the request/);
  assert.match(validateRecipe("acme", "quick", { label: "X", base: "global-preliminary-search", extras: { standingInstructions: "  " } }).errors[0], /non-empty string/);
  assert.match(validateRecipe("acme", "Bad Slug!", { label: "X", base: "global-preliminary-search" }).errors[0], /lowercase slug/);
  assert.match(validateRecipe("acme", "quick", { label: "y".repeat(2001), base: "global-preliminary-search" }).errors[0], /char budget/);
  // the proseGuard injection point (the recipe service wires the profiles.mjs D1 guards through here)
  const guard = () => { throw new Error("rule-shaped prose"); };
  assert.match(validateRecipe("acme", "quick", { label: "rate everything HIGH", base: "global-preliminary-search" }, { proseGuard: guard }).errors[0], /rule-shaped prose/);
});

test("loadRecipes: missing dir ⇒ empty map; valid store loads customer-keyed; an invalid file fails LOUD", () => {
  assert.equal(loadRecipes({ dir: join(tmpdir(), "definitely-absent-recipes-dir"), force: true }).size, 0);
  const dir = mkdtempSync(join(tmpdir(), "recipes-"));
  mkdirSync(join(dir, "acme"));
  writeFileSync(join(dir, "acme", "quick.json"), JSON.stringify({ label: "Quick", base: "knockout-search" }));
  const m = loadRecipes({ dir, force: true });
  assert.equal(m.size, 1);
  assert.equal(m.get("acme/quick").base, "knockout-search");
  writeFileSync(join(dir, "acme", "bad.json"), JSON.stringify({ label: "Bad", base: "nope" }));
  assert.throws(() => loadRecipes({ dir, force: true }), /is not a known product/, "a corrupt recipe store is a config bug — loud, never skipped");
});

test("checkScopeAgainstPolicy: scope is refused only by machinery that cannot act on it", () => {
  const jobJx = { jurisdictions: ["US"] };
  const jobPlat = { platforms: ["gnc.com"] };
  // knockout pipelines DO take territories (2026-07-20): scope and depth are two axes of one scale, so
  // "global" is the widest setting of a knob rather than a property of a quick screen. The sweep prompt
  // renders the named territories; the instructed-scope sidecar already froze them.
  // They still have no marketplace GRID for a store to be added to, so platforms remain a clarify —
  // accepting them would record scope that nothing sweeps.
  for (const level of ["knockout", "knockout-register"]) {
    assert.deepEqual(checkScopeAgainstPolicy(jobJx, policyFor(level)).errors, [], `${level} + jurisdictions`);
    assert.equal(checkScopeAgainstPolicy(jobPlat, policyFor(level)).errors.length, 1, `${level} + platforms`);
  }
  // clearance pipelines honour both, so they pass through untouched
  for (const level of ["prelim", "prelim-jx"]) {
    assert.deepEqual(checkScopeAgainstPolicy(jobJx, policyFor(level)).errors, [], `${level} + jurisdictions`);
    assert.deepEqual(checkScopeAgainstPolicy(jobPlat, policyFor(level)).errors, [], `${level} + platforms`);
  }
  // empty arrays are not a request for scope
  assert.deepEqual(checkScopeAgainstPolicy({ jurisdictions: [], platforms: [] }, policyFor("knockout")).errors, []);
  assert.deepEqual(checkScopeAgainstPolicy({}, null).errors, [], "no policy resolved yet ⇒ nothing to judge against");
});

test("the recipe store is NAMED, never guessed — an unconfigured deployment has no saved searches", () => {
  // driver/recipes/ holds synthetic demos for two FICTIONAL customers so the dev cockpit and these tests
  // have something to render. It used to be the fallback when CLEAROTRON_RECIPES_DIR was unset — a foot-gun
  // that only fires in production, because production is exactly where the variable is not set. Switching
  // saved searches on there would have surfaced invented customers inside the product.
  const saved = process.env.CLEAROTRON_RECIPES_DIR;
  try {
    delete process.env.CLEAROTRON_RECIPES_DIR;
    assert.equal(loadRecipes({ force: true }).size, 0, "no store configured ⇒ no saved searches, NOT the bundled demos");
    // the demos are still reachable — by asking for them by name, which is what fixture data should require
    assert.ok(loadRecipes({ dir: join(HERE_DIR, "..", "recipes"), force: true }).size > 0, "the dev fixtures still load when named explicitly");
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_RECIPES_DIR;
    else process.env.CLEAROTRON_RECIPES_DIR = saved;
    loadRecipes({ force: true, dir: join(tmpdir(), "definitely-absent-recipes-dir") });   // reset the module cache
  }
});

// ── scope on a saved search — what makes it a saved SEARCH, not a saved depth ────────────────────────
// "Zephyr Beverages knockouts — US focus" is a label over exactly this: base `knockout`, scope {jurisdictions}.
// Without a scope key a saved search could only restate a level that is already one click away, which is
// why the recipe store existed for weeks with nothing worth putting in it.

const scopedRecipe = (scope, base = "global-preliminary-search") => ({ label: "Saved", base, scope });
// the marketplace-entry rule lives in profiles.mjs; search-policy is a pure leaf, so it is INJECTED —
// the same treatment proseGuard already gets, and the reason a saved scope is held to the job's rule
const { platformEntryErrors } = await import("../profiles.mjs");
const GUARDS = { platformEntryErrors };

test("scope: the golden rule still holds — adding scope did not open a door to profile config", () => {
  // The invariant this whole nesting decision exists to protect. Flattening jurisdictions/platforms/
  // classes into top-level recipe keys would collide with the profile key set and break the proof.
  const overlap = RECIPE_KEYS.filter((k) => KNOWN_PROFILE_KEYS.includes(k));
  assert.deepEqual(overlap, [], "recipe keys and profile keys must stay disjoint");
  assert.ok(RECIPE_KEYS.includes("scope"));
  for (const banned of ["platforms", "defaultClasses", "defaultJurisdictions"])
    assert.ok(!RECIPE_KEYS.includes(banned), `${banned} is a PROFILE key and must never be a top-level recipe key`);
});

test("scope: THE PRODUCT'S OWN GEOGRAPHY RULE is applied at SAVE time, in the doors' own words", () => {
  // A saved search is a job template, so a scope its base product does not accept is a trap laid weeks
  // before anyone meets it. One module writes the sentence (products.mjs) and every door quotes it, so
  // what a lawyer reads when a save is refused is what a client reads when a run is.
  const narrowed = validateRecipe("acme", "narrowed", scopedRecipe({ jurisdictions: ["US"] }, "global-preliminary-search"), GUARDS);
  assert.equal(narrowed.ok, false);
  assert.match(narrowed.errors.join(" "), /is worldwide and accepts no narrowing/);
  const region = validateRecipe("acme", "region", scopedRecipe({ jurisdictions: ["EU"] }, "full-country-search"), GUARDS);
  assert.match(region.errors.join(" "), /regional filing system/);
  const one = validateRecipe("acme", "one", scopedRecipe({ jurisdictions: ["US"] }, "multi-country-focus-search"), GUARDS);
  assert.match(one.errors.join(" "), /Add another country or name a region/);
});

test("scope: a well-formed scope saves, and unknown scope fields are refused", () => {
  const ok = validateRecipe("acme", "us-focus", scopedRecipe({ jurisdictions: ["US"], classes: [32] }, "full-country-search"), GUARDS);
  assert.equal(ok.ok, true, ok.errors.join(" "));
  const bad = validateRecipe("acme", "us-focus", scopedRecipe({ territories: ["US"] }), GUARDS);
  assert.match(bad.errors.join(" "), /scope\.territories is not a known scope field/);
});

test("scope: the job door's rules are applied at SAVE time, not left to bite on every future run", () => {
  const badClass = validateRecipe("acme", "scoped", scopedRecipe({ classes: [99] }), GUARDS);
  assert.match(badClass.errors.join(" "), /whole numbers 1–45/);
  const badPlat = validateRecipe("acme", "scoped", scopedRecipe({ platforms: ["web"] }), GUARDS);
  assert.equal(badPlat.ok, false, '"web" is the implicit general-web cell and is never a named store');
  const tooMany = validateRecipe("acme", "scoped", scopedRecipe({ jurisdictions: Array.from({ length: 21 }, (_, i) => `T${i}`) }, "multi-country-focus-search"), GUARDS);
  assert.match(tooMany.errors.join(" "), /max 20/);
});

test("scope: territories stay prose-tolerant — an ISO vocabulary here would reject what the engine runs", () => {
  const r = validateRecipe("acme", "scoped", scopedRecipe({ jurisdictions: ["US", "United Kingdom", "EU"] }, "multi-country-focus-search"), GUARDS);
  assert.equal(r.ok, true, r.errors.join(" "));
});

test("scope: marketplaces cannot be saved against a quick screen — the refusal lands on the EDIT", () => {
  // The scope-vs-machinery rule at save time. Saved against a knockout base, platforms would validate
  // today and clarify on every future run — surfacing far from the edit that caused it, to someone who
  // did not make it. Territories against the same base are fine (2026-07-20).
  const plat = validateRecipe("acme", "scoped", scopedRecipe({ platforms: ["gnc.com"] }, "knockout-search"), GUARDS);
  assert.equal(plat.ok, false);
  assert.match(plat.errors.join(" "), /no marketplace grid/);
  const jx = validateRecipe("acme", "scoped", scopedRecipe({ jurisdictions: ["US"] }, "knockout-search"), GUARDS);
  assert.equal(jx.ok, true, jx.errors.join(" "));
});

test("scope: a saved scope rides out of resolveSearchPolicy for the ladder to place", () => {
  const recipes = new Map([["acme/us-focus", { label: "US focus", base: "knockout-search", scope: { jurisdictions: ["US"] }, version: 3 }]]);
  const r = resolveSearchPolicy({ recipeKey: "us-focus" }, { profile: { key: "acme" }, recipes });
  assert.equal(r.clarify, undefined, r.clarify);
  assert.deepEqual(r.recipeScope, { jurisdictions: ["US"] });
  assert.equal(r.product, "knockout-search", "the base still decides the machinery");
});

test("scope: a recipe without one resolves to no saved scope, never an empty object that looks set", () => {
  const recipes = new Map([["acme/plain", { label: "Plain", base: "global-preliminary-search", version: 1 }]]);
  const r = resolveSearchPolicy({ recipeKey: "plain" }, { profile: { key: "acme" }, recipes });
  assert.equal(r.recipeScope, null);
});

// ── case law and the native-language toggle: what a saved search may still carry ────────────────────

test("caseLaw is NO LONGER a saved setting — refused at the SAVE door, dropped at the LOAD door", () => {
  // The two halves are the emailTable precedent exactly. Case law is a PRODUCT now, so saving one is
  // asking for a setting that does not exist — refused where somebody is present to read why. Refusing
  // to LOAD one would be a different and much worse thing: loadRecipes throws on any error, so one
  // stale file would take down every saved search of every customer, for every tenant.
  const bad = validateRecipe("acme", "with-cases", { label: "With cases", base: "global-preliminary-search", caseLaw: true }, GUARDS);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /caseLaw is no longer a saved-search setting/);
  assert.match(bad.errors.join(" "), /Full country search/, "and it names the product that carries it");
  assert.equal(validateRecipe("acme", "no-cases", { label: "No cases", base: "global-preliminary-search", caseLaw: false }, GUARDS).ok, false,
    "false is refused too — it never suppressed anything, and accepting it would say otherwise");
  // …and the LOAD door drops it silently, because the value is inert by construction.
  const dir = mkdtempSync(join(tmpdir(), "recipes-caselaw-"));
  mkdirSync(join(dir, "acme"));
  writeFileSync(join(dir, "acme", "stale.json"), JSON.stringify({ label: "Stale", base: "global-preliminary-search", caseLaw: true }));
  const loaded = loadRecipes({ dir, force: true });
  assert.equal(loaded.size, 1, "a store written last week is not an outage today");
  assert.ok(!("caseLaw" in loaded.get("acme/stale")), "and the dead key does not survive to be saved back");
});

test("nativeLanguage is the ONE toggle a saved search may carry, and only where the product offers it", () => {
  const ok = validateRecipe("acme", "cn", { label: "CN", base: "multi-country-focus-search", nativeLanguage: true }, GUARDS);
  assert.equal(ok.ok, true, ok.errors.join(" "));
  assert.ok(RECIPE_KEYS.includes("nativeLanguage"));
  const bad = validateRecipe("acme", "bad", { label: "Bad", base: "multi-country-focus-search", nativeLanguage: "yes" }, GUARDS);
  assert.match(bad.errors.join(" "), /nativeLanguage must be a boolean/);
  // Not on a product that does not offer it — the same sentence every door refuses with.
  const wrong = validateRecipe("acme", "ko", { label: "KO", base: "knockout-search", nativeLanguage: true }, GUARDS);
  assert.equal(wrong.ok, false);
  assert.match(wrong.errors.join(" "), /not part of a Knockout search/);
});

test("the components a saved search may set are the ones the PRODUCT does not decide", () => {
  assert.ok(!Object.keys(COMPONENTS).includes("caseLaw"), "case law was never a component and is not one now");
  // jxLanes IS a component and can no longer be SET: it is the native-language investigation, and the
  // product decides it. A saved search that could switch it on would put it back on the two products
  // the offering says do not carry it.
  const asComponent = validateRecipe("acme", "x", { label: "X", base: "multi-country-focus-search", components: { jxLanes: true } }, GUARDS);
  assert.equal(asComponent.ok, false);
  assert.match(asComponent.errors.join(" "), /cannot be set on a saved search/);
  // and the golden rule survives every key
  assert.deepEqual(RECIPE_KEYS.filter((k) => KNOWN_PROFILE_KEYS.includes(k)), []);
});

test("case law rides out of resolution from the PRODUCT, and from nothing else", () => {
  // Until there were two requesters — the job's own flag and a saved search's copy — ORed at
  // resolution. Both are gone: the flag is refused at every door, and a saved caseLaw cannot be written.
  // A single source means the frozen record and the stage that runs cannot disagree.
  const at = (job) => resolveSearchPolicy(job, { profile: { key: "acme" } }).caseLaw;
  assert.equal(at({ product: "full-country-search" }), true, "it is what this product IS");
  assert.equal(at({ product: "global-preliminary-search" }), false);
  assert.equal(at({ product: "multi-country-focus-search" }), false);
  assert.equal(at({ product: "knockout-search" }), false);
  assert.equal(at({ product: "global-preliminary-search", caseLaw: true }), false,
    "a flag the doors refuse cannot change the resolution behind their back");
});

test("the native-language investigation resolves per product: automatic, offered, or absent", () => {
  const at = (job) => resolveSearchPolicy(job, { profile: { key: "acme" } });
  assert.equal(at({ product: "full-country-search" }).nativeLanguage, "automatic");
  assert.equal(at({ product: "full-country-search" }).components.jxLanes, true, "and it is on without being asked for");
  assert.equal(at({ product: "full-country-search" }).nativeRequested, false,
    "so the routing rule cannot refuse a shape we chose for them");
  assert.equal(at({ product: "multi-country-focus-search" }).components.jxLanes, false, "off until it is asked for");
  const asked = at({ product: "multi-country-focus-search", nativeLanguage: true });
  assert.equal(asked.components.jxLanes, true);
  assert.equal(asked.nativeRequested, true, "somebody ticked it, so an unroutable scope IS a refusal");
  assert.equal(at({ product: "knockout-search", nativeLanguage: true }).components.jxLanes, false,
    "a product that does not offer it cannot be talked into it by a field");
  // a saved search carries the toggle the same way the request does
  const recipes = new Map([["acme/cn", { label: "CN", base: "multi-country-focus-search", nativeLanguage: true, version: 1 }]]);
  assert.equal(resolveSearchPolicy({ recipeKey: "cn" }, { profile: { key: "acme" }, recipes }).components.jxLanes, true);
});

test("config nulls: archived:null is refused, so a retired saved search cannot be silently revived", () => {
  // `!= null` let archived:null through; the stickiness guard only re-applies on `undefined` and every
  // consumer reads null as falsy, so a null slipped past both and UN-ARCHIVED the recipe — defeating
  // the rule that only an explicit false may do that. Same hole profiles.mjs closed for projects.
  const r = (extra) => validateRecipe("acme", "us-eu", { label: "US + EU prelim", base: "global-preliminary-search", ...extra });
  assert.equal(r({ archived: null }).ok, false, "an ambiguous value is refused, not guessed at");
  assert.match(r({ archived: null }).errors[0], /archived must be a boolean/);
  assert.equal(r({ archived: true }).ok, true);
  assert.equal(r({ archived: false }).ok, true, "an explicit false is the ONLY way back");
  assert.equal(r({}).ok, true, "and omitting it stays valid (stickiness handles it)");
});

// ── audit item 3: gateCause threads registerCanCount — the can't-count register is its own cause ─────
test("gateCause: a register that cannot count is 'register-cannot-count', never 'unbuilt'", () => {
  const resolved = resolveSearchPolicy({ product: "knockout-search" }, {});
  // The deployment shape that made this reachable: flag-snapshot folds canCount=false into
  // built.registerProbe=false, so a caller passing only the build map got "unbuilt" — and UNAVAILABLE_NOTE
  // then told a client "Not part of the current release." about a depth no release will ever fix there.
  // The fix is a different provider; the cause must say so, at THIS gate exactly as at productAvailability.
  const folded = { ...BUILT, registerProbe: false };
  assert.deepEqual(gateCause(resolved, { built: folded, registerCanCount: false }),
    { cause: "register-cannot-count", product: resolved.product, stageLabel: resolved.stageLabel });
  assert.equal(UNAVAILABLE_NOTE["register-cannot-count"],
    "The trademark register wired to this deployment cannot return filing counts, so this search cannot run here.");
  // Unstated canCount keeps the old reading (a build that genuinely lacks the probe is still 'unbuilt')…
  assert.equal(gateCause(resolved, { built: folded })?.cause, "unbuilt");
  // …and a counting register on a complete build stays runnable.
  assert.equal(gateCause(resolved, { built: BUILT, registerCanCount: true }), null);
});

// ── ONE KNOCKOUT, AND IT CARRIES THE COUNTS ( part 3) ────────────────────────────────────────────
//
// The offering has ONE Knockout search and register hit-counts are part of what it IS. The counts-free
// `knockout` row still exists, because an archived run delivered under it must re-render under the name
// it was sold as — and that is exactly what makes this worth pinning: a nameable row is one careless
// edit away from being an orderable one, and the failure would be silent. A caller would get a cheaper
// screen under a name that promises counts, the report would render no register section, and nothing
// anywhere would say a tier had been substituted. That is the no-hidden-tiers rule, and this is it as a
// test rather than as a comment.
test("no counts-free knockout is reachable from ANY door", () => {
  const recipes = new Map([
    ["acme/legacy-ko", { label: "Legacy KO", base: "knockout" }],
    ["acme/legacy-kor", { label: "Legacy KO+R", base: "knockout-register" }],
  ]);
  const profile = { key: "acme" };
  for (const retired of ["knockout", "knockout-register"]) {
    // door 1 — an explicit product on the request
    const direct = resolveSearchPolicy({ product: retired, marks: ["ALCHEMIST"] }, {});
    assert.ok(direct.clarify, `job.product "${retired}" must be refused`);
    // door 2 — a customer profile's default
    const dflt = resolveSearchPolicy({}, { profile: { ...profile, defaultProduct: retired } });
    assert.ok(dflt.clarify, `profile defaultProduct "${retired}" must be refused`);
    assert.match(dflt.clarify, /names no search we offer/);
    // door 3 — a saved search whose base predates the retirement. This one arrives already resolved to a
    // registry row by policyFor, so it is the door the other two checks would have missed.
    const key = retired === "knockout" ? "legacy-ko" : "legacy-kor";
    const viaRecipe = resolveSearchPolicy({ recipeKey: key }, { profile, recipes, customerKey: "acme" });
    assert.ok(viaRecipe.clarify, `recipe base "${retired}" must be refused`);
    assert.match(viaRecipe.clarify, /retired and can no longer be ordered/);
    // …and it is not in any menu built from the offering.
    assert.ok(!ORDERABLE_PRODUCTS.includes(retired));
  }

  // The positive half, which is the half that matters: EVERY knockout anyone can actually order takes
  // the register counts. A knockout row with registerProbe false would be a counts-free tier by another
  // name, and it would pass every assertion above.
  const orderableKnockouts = ORDERABLE_PRODUCTS.map((p) => [p, policyFor(p)]).filter(([, pol]) => pol.pipeline === "knockout");
  assert.equal(orderableKnockouts.length, 1, "the offering has exactly one Knockout");
  for (const [id, pol] of orderableKnockouts)
    assert.equal(pol.components.registerProbe, true, `${id}: counts are part of what a Knockout is`);
});
