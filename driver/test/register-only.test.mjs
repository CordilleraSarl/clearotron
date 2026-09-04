// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-only.test.mjs — the RETIRED register-only search: a clearance with its unregistered-use half
// removed, ordered zero times in the life of the archive and retired on 2026-08-06.
//
// This file used to pin the level as a product. It now pins the two halves of its retirement, which are
// different claims and must not be allowed to collapse into each other:
//
//   NOTHING OFFERS IT AND NO DOOR ACCEPTS IT. It is out of ORDERABLE_PRODUCTS, so every menu built from that
//   array drops it; and every selector — an explicit product, a profile default, a saved search's
//   base — meets the same refusal, which enumerates the levels that DO exist and never names this one as
//   an option. The refusal is what a subtractive fix usually forgets: the registry row still exists, so
//   `policyFor` still answers, and a door that asked `policyFor` whether a level exists kept selling it.
//
//   EVERYTHING THAT DESCRIBES A RUN THAT ALREADY RAN IS UNTOUCHED. The PRODUCT_POLICIES row stays, so an
//   archived run re-renders with its own name and a truthful covers line; riskStatement still states the
//   basis; the workbook gate still inverts. Retiring the product must never rewrite what a delivered run
//   says it was — and a report that claimed a marketplace sweep which never ran would be exactly that.

import test from "node:test";
import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

import { ORDERABLE_PRODUCTS, RETIRED_PRODUCTS, PRODUCT_POLICIES, COMPONENTS, BUILT, policyFor, loadRecipes, retiredBaseSkips,
  isRegisterOnly, gateResolvedPolicy, productAvailability, validateRecipe, resolveSearchPolicy, RETIRED_POLICIES,
  reportIdentityFor, productCoverageNote } from "../search-policy.mjs";
import * as searchPolicy from "../search-policy.mjs";
import { productRow, productRows } from "../product-rows.mjs";
import { validateJob } from "../enqueue-schema.mjs";
import { riskStatement } from "../findings-model.mjs";
import { stageInputs, REGISTER_ONLY_NOTE } from "../stages.mjs";
import { buildAudit, validateAudit } from "../publish/xlsx.mjs";
import * as plan from "../../mcp-server/lib/plan.mjs";

const KEY = "prelim-register-only";
const RO = policyFor(KEY);
const DRIVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

// The frozen sidecar a run at this level wrote — _driver/search-policy.json, verbatim shape. Every
// archived-render assertion below reads THIS rather than the registry, because that is what publish
// reads: the run's own statement of what it did.
const FROZEN = { level: KEY, pipeline: "clearance", stageLabel: "Depth 3",
  components: { registerProbe: false, jxLanes: false, commonLawGrid: false }, maxMarks: 1 };

// ── the retirement ───────────────────────────────────────────────────────────────────────────────────

test("the level is RETIRED: out of the orderable registry, still in the naming registry", () => {
  assert.ok(!ORDERABLE_PRODUCTS.includes(KEY), "nothing may order it");
  assert.ok(RETIRED_PRODUCTS.includes(KEY), "and the retirement is declared, not implied by an absence");
  assert.ok(RETIRED_POLICIES[KEY], "the row survives — it is what names an archived run");
  assert.ok(!PRODUCT_POLICIES[KEY], "…in the RETIRED map, so no menu built from the offering can reach it");
  assert.equal(RO.pipeline, "clearance", "it was the clearance shape, not a knockout");
  assert.equal(RO.components.commonLawGrid, false);
});

test("no menu built from the registry offers it", () => {
  assert.deepEqual(productRows().map((r) => r.key), [...ORDERABLE_PRODUCTS]);
  assert.ok(!productRows().some((r) => r.key === KEY), "the wire rows are the menu, and it is not in them");
  // …but the ROW is still answerable by key, which is how a refusal and an archived run name it.
  assert.equal(productRow(KEY).name, "Preliminary clearance — register only");
  assert.equal(productRow(KEY).stageLabel, "Depth 3");
});

test("the ladder is gone entirely, and the retired rung keeps its number anyway", () => {
  // The offering replaced the ladder, so there is no gap left to keep open — but the RETIRED rows
  // keep the rungs they were sold under, because renaming them would rewrite what a delivered run claims
  // it was. That is the same reason this row exists at all.
  assert.deepEqual(productRows().map((r) => r.stageLabel),
    ["Knockout search", "Global preliminary search", "Multi-country focus search", "Full country search"]);
  assert.equal(productRow(KEY).stageLabel, "Depth 3");
  assert.equal(productRow("prelim").stageLabel, "Depth 4", "and the rung it sat beside is untouched too");
});

// ── the doors ────────────────────────────────────────────────────────────────────────────────────────

// BOTH doors, and the same words. The portal and the ops-MCP are the only two ways in, and each of them
// reaches BOTH producers below: the queue door (validateJob — portal /run, MCP start_run) and the
// resolver (resolveSearchPolicy — portal /run/plan, MCP plan_run). So the pairing that matters is not
// portal-vs-MCP but plan-vs-submit, and the lead sentence has to be the same on all four paths.
const job = (over = {}) => ({ id: "tmp9001", msgId: "<x@y>", markName: "NOVAPULSE", classes: [9],
  forwarder: "someone", ...over });

test("both doors refuse a request that names it, in the same words, enumerating what does exist", () => {
  const queue = validateJob(job({ product: KEY }));
  assert.equal(queue.ok, false);
  const queueErr = queue.errors.find((e) => e.includes(KEY));
  assert.ok(queueErr, "the queue door must refuse it by name");

  const resolved = resolveSearchPolicy({ product: KEY }, {});
  assert.ok(resolved.clarify, "the resolver must refuse it too — the plan doors read this");

  for (const [where, msg] of [["queue", queueErr], ["resolver", resolved.clarify]]) {
    assert.match(msg, new RegExp(`"${KEY}"`), `${where}: it echoes what was asked for`);
    for (const live of ORDERABLE_PRODUCTS) assert.ok(msg.includes(live), `${where}: it lists ${live}`);
    // The refusal is built from ORDERABLE_PRODUCTS at call time, which is why removing the row fixed the text
    // at every door with no edit — and why the retired key can never reappear in the list it offers.
    assert.doesNotMatch(msg, new RegExp(`one of:.*${KEY}`), `${where}: never offered as an alternative`);
  }
});

test("a profile default and a saved-search base meet the same wall", () => {
  // Three selectors, one test. The recipe base is the one a subtractive fix misses: it resolves through
  // `policyFor`, which still answers for a retired row, so it ran a retired product with nothing refusing.
  const viaProfile = resolveSearchPolicy({}, { profile: { key: "acme", defaultProduct: KEY } });
  assert.match(viaProfile.clarify ?? "", /names no search we offer|retired/);

  const recipes = new Map([["acme/screen", { version: 1, label: "US register screen", base: KEY }]]);
  const viaRecipe = resolveSearchPolicy({ recipeKey: "screen" }, { profile: { key: "acme" }, recipes });
  assert.ok(viaRecipe.clarify, "a saved search on a retired base must not resolve");
  assert.match(viaRecipe.clarify, /retired/);
  assert.ok(!viaRecipe.level, "and it must not come back as a runnable policy");
});

test("the saved-search door refuses the base at SAVE time as well as at run time", () => {
  const saved = validateRecipe("acme", "screen", { label: "US register screen", base: KEY });
  assert.equal(saved.ok, false, "a recipe may not be written on a retired level");
  assert.match(saved.errors.join(" "), /retired/);
  assert.equal(validateRecipe("acme", "screen", { label: "Standard", base: "global-preliminary-search" }).ok, true);
});

test("and the grid cannot be subtracted from a live level instead — the refusal names no dead product", () => {
  // Red-team #12: `base: "global-preliminary-search", components: {commonLawGrid: false}` would PLAN as Depth 4 while
  // running the retired search. The refusal used to tell the reader to use the register-only LEVEL,
  // which is now a level that does not exist — a refusal that sends a client to a dead end.
  const bad = validateRecipe("acme", "screen", {
    label: "Our usual clearance", base: "global-preliminary-search", components: { commonLawGrid: false },
  });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /cannot be set on a saved search/);
  assert.match(bad.errors.join(" "), /retired/);
  assert.doesNotMatch(bad.errors.join(" "), new RegExp(`set base to.*${KEY}`), "it must not send anyone to a retired level");
  // …and the OTHER component a saved search could once set is refused too, for its own reason: jxLanes
  // IS the native-language investigation, and the product decides it. A saved search that could switch
  // it on would put it back on the two products the offering says do not carry it.
  const lanes = validateRecipe("acme", "screen", { label: "Deep dive", base: "multi-country-focus-search", components: { jxLanes: true } });
  assert.equal(lanes.ok, false);
  assert.match(lanes.errors.join(" "), /the native-language investigation follows the product/);
  assert.match(lanes.errors.join(" "), /"nativeLanguage": true/, "and it names the field that DOES buy it");
});

test("nothing else was refused along with it — the live levels still resolve", () => {
  for (const live of ORDERABLE_PRODUCTS) {
    const r = resolveSearchPolicy({ product: live }, {});
    assert.equal(r.level, live, `${live} must still be orderable`);
    assert.equal(validateJob(job({ product: live })).ok, true, `${live} must still pass the queue door`);
  }
});

// ── the predicate ────────────────────────────────────────────────────────────────────────────────────

// The 2026-07-21 composer off-by-one, made a test: a knockout also carries commonLawGrid:false, and
// reading that as "does not search marketplaces" is what routed a 20-name knockout into a 1-name
// clearance. isRegisterOnly must key on the PIPELINE too, or the knockout levels get caught by the gate.
test("a knockout is NOT register-only, even though it carries commonLawGrid:false", () => {
  assert.equal(isRegisterOnly(policyFor("knockout-search")), false);
  assert.equal(isRegisterOnly(policyFor("knockout-register")), false);
  assert.equal(isRegisterOnly(FROZEN), true, "a frozen sidecar from a run that did happen still reads true");
  assert.equal(isRegisterOnly(policyFor("prelim")), false);
});

test("a policy frozen before the component existed reads as grid-ran (archived runs never change)", () => {
  assert.equal(isRegisterOnly({ pipeline: "clearance", components: { jxLanes: false } }), false);
  assert.equal(isRegisterOnly(null), false);
});

test("ONE predicate, and publish joins it rather than re-implementing it", () => {
  // The doc comment on isRegisterOnly called it "the ONE predicate every consumer joins on" while
  // publish/index.mjs re-derived the whole expression inline and never imported it, and productCoverageNote
  // read the component by hand. A grep for the predicate's callers therefore missed the branch that
  // drives the entire workbook. Asserted against the SOURCE because that is where the duplication lived.
  const src = readFileSync(join(DRIVER_DIR, "publish", "index.mjs"), "utf8");
  assert.match(src, /import \{[^}]*isRegisterOnly[^}]*\} from '\.\.\/search-policy\.mjs'/);
  assert.match(src, /const registerOnly = isRegisterOnly\(searchPolicy\)/);
  assert.doesNotMatch(src, /components\?\.commonLawGrid === false/, "no hand copy of the predicate survives");
  const policySrc = readFileSync(join(DRIVER_DIR, "search-policy.mjs"), "utf8");
  assert.equal((policySrc.match(/components\?\.commonLawGrid === false/g) ?? []).length, 1,
    "the expression exists exactly once — inside the predicate itself");
});

test("commonLawGrid is still declared on every row, so the subtraction is never implicit", () => {
  for (const [key, p] of Object.entries({ ...PRODUCT_POLICIES, ...RETIRED_POLICIES }))
    assert.equal(typeof p.components.commonLawGrid, "boolean", `${key} must state commonLawGrid`);
  for (const key of ["global-preliminary-search", "multi-country-focus-search", "full-country-search"])
    assert.equal(PRODUCT_POLICIES[key].components.commonLawGrid, true, `${key}: every clearance sweeps it`);
});

test("commonLawGrid is clearance-scoped — it names the grid machinery, which a knockout has none of", () => {
  assert.deepEqual(COMPONENTS.commonLawGrid.pipelines, ["clearance"]);
  assert.doesNotMatch(COMPONENTS.commonLawGrid.desc, /register-only/,
    "the component catalog is published to the recipe door — it must not advertise a retired product");
});

// ── what an archived run still says about itself ─────────────────────────────────────────────────────

test("an archived run re-renders with its own name, its own rung and a truthful covers line", () => {
  // THE REASON THE ROW SURVIVES. Delete it and reportIdentityFor has no registry answer: the stage label
  // degrades to the sidecar's own, `identity` goes null, `template` goes null for a clearance — the
  // banner falls from "Depth 3 — Preliminary clearance — register only" to a bare rung, and the covers
  // line loses the product name that leads it.
  const id = reportIdentityFor(FROZEN);
  assert.equal(id.stageLabel, "Depth 3");
  assert.equal(id.identity, "Preliminary clearance — register only");
  assert.equal(id.template, "clearance", "it still renders through the clearance publisher");
  assert.equal(id.banner, "Depth 3 — Preliminary clearance — register only");

  const note = productCoverageNote(FROZEN);
  assert.match(note, /^Preliminary clearance — register only — covers registered rights/);
  assert.match(note, /unregistered \(common-law\) use is not covered in this search/);
  assert.doesNotMatch(note, /covers registered rights and unregistered/, "the half that did not run is never in the covers list");
});

test("the level word alone resolves the same way — an archived meta.json with no sidecar", () => {
  assert.equal(reportIdentityFor(KEY).identity, "Preliminary clearance — register only");
  assert.match(productCoverageNote(KEY), /unregistered \(common-law\) use is not covered/);
});

// ── the flag: THE one risk statement ─────────────────────────────────────────────────────────────────

test("CLEAR never says 'clear to proceed' on a register-only run — it states its basis instead", () => {
  const s = riskStatement({ tier: "Low", verdict: "CLEAR", basis: "register-only" });
  assert.match(s, /^Low — clear on register findings alone/);
  assert.ok(!/clear to proceed/.test(s), "the unqualified phrase must not survive anywhere in the sentence");
  assert.match(s, /no common-law or marketplace search was run/);
});

test("a normal clearance's CLEAR sentence is byte-identical to before", () => {
  assert.equal(riskStatement({ tier: "Low", verdict: "CLEAR" }),
    "Low — clear to proceed: no conditions beyond ordinary filing.");
  assert.equal(riskStatement({ tier: "Low", verdict: "CLEAR", basis: null }),
    "Low — clear to proceed: no conditions beyond ordinary filing.");
});

test("CONDITIONAL and BLOCKING carry the basis too — the qualifier is not CLEAR-only", () => {
  const c = riskStatement({ tier: "Medium", verdict: "CONDITIONAL", reasons: ["consent is needed"], basis: "register-only" });
  assert.match(c, /^Medium — conditional on: Consent is needed\./);
  assert.match(c, /Register findings only/);
  assert.match(riskStatement({ tier: "High", verdict: "BLOCKING", basis: "register-only" }), /Register findings only/);
});

test("the statement still leads with the framework's band word (the spec-64 lint reads it back)", () => {
  for (const verdict of ["CLEAR", "CONDITIONAL"])
    assert.match(riskStatement({ tier: "Elevated", verdict, reasons: ["x"], basis: "register-only" }), /^Elevated — /);
});

// ── the stages ───────────────────────────────────────────────────────────────────────────────────────

// A run at this level can no longer be STARTED, but one that exists can still be resumed, and a resume
// re-enters the stage prompts. A stage told to read a file that was never written is the failure this
// machinery was built for (stages.mjs), so it stays for as long as such a run could exist.
test("a register-only run declares no common-law input — telemetry and the sandbox stay honest", () => {
  const P = { commonLaw: "/r/common-law-findings.md", registerFindings: "/r/register-findings.md",
    variantManifest: "/r/variant-manifest.md", matterContext: "/r/matter-context.md",
    placement: "/r/placement.md", registerNamedBand: "/r/band.json", skepticFlags: "/r/skeptic.json",
    frameReopenReceipt: "/r/reopen.json", registerUnit: (a) => `/r/units/${a}.md` };
  const full = stageInputs("synthesis", P, { axes: [] });
  const ro = stageInputs("synthesis", P, { axes: [], registerOnly: true });
  assert.ok(full.includes(P.commonLaw), "the normal run still declares it");
  assert.ok(!ro.includes(P.commonLaw));
  assert.equal(ro.length, full.length - 1, "nothing else is dropped");
});

test("the scope note tells the model absence of evidence is not evidence of absence", () => {
  assert.match(REGISTER_ONLY_NOTE, /REGISTER-ONLY/);
  assert.match(REGISTER_ONLY_NOTE, /not.*evidence of absence/i);
});

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────────

test("retirement is not a switch — the gate never learned about it, and must not", () => {
  // Availability answers "can this build run it HERE, NOW", and the answer for a frozen policy is still
  // yes: a resume must not be refused by the level's retirement. What refuses a NEW order is the
  // orderability wall in resolveSearchPolicy, one layer up, where a request is turned into a policy.
  assert.equal(gateResolvedPolicy({ ...FROZEN }), null, "a frozen policy still gates clean");
  assert.equal(productAvailability(RO), null);
  assert.ok(!("registerOnly" in BUILT), "no BUILT entry that would sit at true forever");
  assert.equal(searchPolicy.KILL_SWITCHES, undefined, "KILL_SWITCHES is retired, not merely register-only-free");
});

// ── the publish gate ─────────────────────────────────────────────────────────────────────────────────

// REAL workbooks, built through buildAudit exactly as publish does — a hand-rolled stub patched until it
// stops throwing is the fixture that certifies the bug rather than catching it. The only difference
// between the two books is the one that matters: whether any common-law search actually ran.
const REGISTER_NEGATIVES = [
  { source_layer: "Register", search_term: "novapulse (exact) cl. 9", result: "no hits — clean", notes: "enumerated 0" },
];
const COMMON_LAW_NEGATIVES = [
  { source_layer: "Common-law", search_term: "NOVAPULSE", platform: "amazon.com", result: "No results", notes: "" },
];
const FM = { title: "NOVAPULSE", matter: "noref-register-only", classes: "9", run: "2026-07-21 · register only", overall_label: "Low" };

async function book({ registerOnly, negatives }) {
  const out = join(tmpdir(), `register-only-${registerOnly ? "ro" : "full"}-${process.pid}.xlsx`);
  await buildAudit(
    { findings: [], coverage: [], fetchState: {}, coverageJudgment: null,
      verdict: { tier: "Low", verdict: "CLEAR" }, contextNotes: [], registerOnly,
      jurisdiction: registerOnly ? "US (register only — no common-law / marketplace search)" : "US (register) + common-law" },
    { findings: [], negatives, audit: [] }, out, FM.title, FM);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  await unlink(out).catch(() => {});
  return wb;
}

const clViolations = (wb, opts) => validateAudit(wb, opts).violations.filter((s) => /common-law/.test(s));

test("the workbook gate INVERTS on a register-only run", async () => {
  const roBook = await book({ registerOnly: true, negatives: REGISTER_NEGATIVES });
  const fullBook = await book({ registerOnly: false, negatives: [...REGISTER_NEGATIVES, ...COMMON_LAW_NEGATIVES] });

  // normal clearance: the common-law block is REQUIRED
  assert.equal(clViolations(fullBook, {}).length, 0, "a real clearance workbook passes as before");
  assert.equal(clViolations(roBook, {}).length, 1, "…and one with no common-law block still fails as a clearance");

  // register-only: its absence is correct, and its PRESENCE is the defect — the sheet is built from the
  // searches that actually ran, so a common-law block would mean the book claims a sweep that never ran.
  assert.equal(clViolations(roBook, { registerOnly: true }).length, 0);
  const wrong = clViolations(fullBook, { registerOnly: true });
  assert.equal(wrong.length, 1);
  assert.match(wrong[0], /claims a sweep that did not run/);
});

test("the workbook tells the reader, in its own words, that marketplaces were not searched", async () => {
  const roBook = await book({ registerOnly: true, negatives: REGISTER_NEGATIVES });
  let blurb = "";
  roBook.getWorksheet("Summary").eachRow((row) => {
    if (/What was searched/.test(String(row.getCell(1).value || ""))) blurb = String(row.getCell(2).value || "");
  });
  assert.match(blurb, /REGISTER-ONLY search/);
  assert.match(blurb, /marketplaces and common-law use were not/i);
  assert.ok(!/we looked everywhere/.test(blurb), "the everywhere claim must not survive on this product");
});

// ── the plan caveat ──────────────────────────────────────────────────────────────────────────────────

test("one caveat, because one product shape is left to caveat", () => {
  // The inverted caveat existed because register-only rested the ratings on the other half. A plan
  // describes a run that WOULD start, none of them can be register-only, so `caveatFor` had one answer
  // left. Deleted rather than kept as a branch that still reads like a choice — this asserts the ABSENCE,
  // which is the half a "retire it" change usually leaves behind.
  assert.equal(plan.PLAN_CAVEAT_REGISTER_ONLY, undefined, "the inverted caveat is gone, not merely unused");
  assert.equal(plan.caveatFor, undefined, "and so is the chooser");
  assert.match(plan.PLAN_CAVEAT, /Ratings reflect our common law assessment/);
});

// ── Review findings on the retirement PR, fixed in a follow-up ────────────────────────────────
//
// Both are the same class and it is the class this codebase pays for most: a refusal that is right at one
// door and catastrophic at another, and a check that cannot fail. Neither was reachable from the diff —
// the first because the file it breaks has no line in it, the second because the assertion reads true.

test("one stale saved search does not take the recipe store down for every tenant", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "prelim-recipes-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Two customers. One carries a base retired by; the other is ordinary and unrelated.
  mkdirSync(join(dir, "acme"), { recursive: true });
  mkdirSync(join(dir, "other"), { recursive: true });
  writeFileSync(join(dir, "acme", "legacy.json"), JSON.stringify({ label: "Legacy registers-only", base: KEY }));
  writeFileSync(join(dir, "other", "std.json"), JSON.stringify({ label: "Standard", base: "global-preliminary-search" }));

  const recipes = loadRecipes({ dir, force: true });

  // THE POINT: the unrelated customer's valid saved search survives. validateRecipe refuses a retired
  // base — correct at the SAVE door — but loadRecipes throws on any validation error and walks every
  // customer directory, so refusing at load would have 500'd GET /portal/api/searches, describe_options,
  // plan_run and start_run for every tenant on one file nobody had touched.
  assert.ok(recipes.has("other/std"), "an unrelated customer's valid recipe must still load");
  assert.equal(recipes.has("acme/legacy"), false, "the retired-base recipe is dropped — it names a product that cannot be ordered");

  // AND IT SAYS SO. A retired EXTRA is dropped silently because the value was inert; a whole saved search
  // is not — it disappears from a lawyer's menu, and a disappearance with no reason is the thing this
  // codebase calls a silent failure.
  assert.equal(retiredBaseSkips.length, 1, "the drop is recorded, not silent");
  assert.equal(retiredBaseSkips[0].customer, "acme");
  assert.equal(retiredBaseSkips[0].slug, "legacy");
  assert.match(retiredBaseSkips[0].why, /retired/i);

  // A genuinely BROKEN file still takes the store down. This fix narrows one class; it does not soften
  // the rule that a config error is load-blocking.
  writeFileSync(join(dir, "acme", "broken.json"), JSON.stringify({ label: "No base at all" }));
  assert.throws(() => loadRecipes({ dir, force: true }), /is not a known product/,
    "an unknown base is still a loud config error — only the RETIRED class is dropped");
});

test("the skip list describes the current store and never accumulates", () => {
  const dir = mkdtempSync(join(tmpdir(), "prelim-recipes-"));
  try {
    mkdirSync(join(dir, "acme"), { recursive: true });
    writeFileSync(join(dir, "acme", "legacy.json"), JSON.stringify({ label: "L", base: KEY }));
    loadRecipes({ dir, force: true });
    assert.equal(retiredBaseSkips.length, 1);
    // Same store, loaded again: still one, not two. A caller reading this to explain a missing saved
    // search must never be shown the same drop twice, or a stale one from a store that has been fixed.
    loadRecipes({ dir, force: true });
    assert.equal(retiredBaseSkips.length, 1, "rewritten per load, not appended to");
    rmSync(join(dir, "acme", "legacy.json"));
    loadRecipes({ dir, force: true });
    assert.equal(retiredBaseSkips.length, 0, "a fixed store reports no drops");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no surface can quote a turnaround for a level nobody can order", () => {
  // The retirement PR deleted an assertion that a register-only read is SHORTER than a clearance, and the
  // 1h arm it guarded went with it — so productRow(KEY) now reports a clearance's 1.5h. That is not a
  // regression to fix by restoring the arm: a retired level has no turnaround because it cannot be
  // bought. What must hold is that nothing OFFERS one.
  const keys = productRows().map((r) => r.key);
  assert.equal(keys.includes(KEY), false, "productRows() is the menu — a retired level is not in it");
  for (const r of productRows())
    assert.ok(Number.isFinite(r.baseTurnaroundHours) && r.baseTurnaroundHours > 0,
      `${r.key}: every level a client CAN order still quotes a real turnaround`);
});
