// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e-scenario-ops.test.mjs — the whole-run ops two scenarios declared, each driven through evalAssertion.
//
// Until these existed, the harness read each of them FAIL "UNIMPLEMENTED" on every run, whatever the run
// did. Every arm below builds a run directory, calls the op the way `report` does, and reads the answer.
// The file SHAPES are the ones saved clearance runs hold; every mark, owner, store and qid is invented.
//
// Run:  cd driver && node ../scripts/test-run.mjs node --test test/e2e-scenario-ops.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { evalAssertion, pathsAnOpDoesNotRead } from "../../scripts/e2e.mjs";
import { SCENARIO_FILE_OPS } from "../../scripts/e2e-scenario-ops.mjs";

const MARK = "VARENTO";

/** A run directory holding `files` ({ relative path: JSON value }); `_driver/…` goes where driverDir puts it. */
function runWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "scenario-ops-"));
  for (const [rel, doc] of Object.entries(files)) {
    const p = rel.startsWith("_driver/") ? driverDir(dir, rel.slice("_driver/".length)) : join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(doc));
  }
  return dir;
}
const check = (assertion, files) => {
  const dir = runWith(files);
  try { return evalAssertion(assertion, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// ── the plain field ops ─────────────────────────────────────────────────────────────────────────────

test("truthy, non-empty-array and count-greater-than answer on the field they are pointed at", () => {
  const files = {
    "_driver/search-policy.json": { pipeline: "clearance", components: { commonLawGrid: true } },
    "_driver/grid-spec.json": { terms: [MARK], platforms: ["a", "b", "c"] },
  };
  assert.equal(check({ op: "truthy", path: "_driver/search-policy.json:components.commonLawGrid" }, files).ok, true);
  assert.equal(check({ op: "truthy", path: "_driver/search-policy.json:components.registerOnly" }, files).ok, false);
  assert.equal(check({ op: "non-empty-array", path: "_driver/grid-spec.json:platforms" }, files).ok, true);
  assert.equal(check({ op: "non-empty-array", path: "_driver/search-policy.json:pipeline" }, files).ok, false,
    "a non-empty string is not a list");
  assert.equal(check({ op: "count-greater-than", path: "_driver/grid-spec.json:platforms", value: 2 }, files).ok, true);
  assert.equal(check({ op: "count-greater-than", path: "_driver/grid-spec.json:platforms", value: 3 }, files).ok, false,
    "three is not more than three");
  assert.equal(check({ op: "count-greater-than", path: "_driver/grid-spec.json:platforms" }, files).ok, false,
    "no number to compare against is a failure, never a pass");
});

test("every op in the table is reached through evalAssertion, never reported unimplemented", () => {
  for (const op of Object.keys(SCENARIO_FILE_OPS)) {
    const r = check({ op, path: "nothing-here.json" }, {});
    assert.notEqual(r.unimplemented, true, op);
    assert.doesNotMatch(r.saw, /UNIMPLEMENTED/, op);
  }
});

// ── covers-platforms-of ─────────────────────────────────────────────────────────────────────────────

const GRID_ASSERT = { op: "covers-platforms-of", path: "common-law-grid.json", value: "_driver/grid-spec.json:platforms" };
const STORES = ["shop.alderfen.test", "apps.alderfen.test"];
const FRAME = ["mods.quorvale.test"];
const TERMS = [MARK, `${MARK} STUDIO`];
const gridFiles = ({ cells, setAside, profile = { platforms: STORES } } = {}) => ({
  "_driver/grid-spec.json": { terms: TERMS, platforms: [...STORES, ...FRAME, "web"] },
  "_driver/profile.json": profile,
  "common-law-grid.json": { cells, extras: {}, gaps: [], ...(setAside ? { set_aside: setAside } : {}) },
});
const everyCell = (skip = () => false, status = "hit") => TERMS.flatMap((term) => [...STORES, ...FRAME, "web"]
  .filter((platform) => !skip(term, platform)).map((platform) => ({ term, platform, status, candidates: [] })));

test("a grid whose every cell ran is covered", () => {
  const r = check(GRID_ASSERT, gridFiles({ cells: everyCell() }));
  assert.equal(r.ok, true, r.saw);
  assert.match(r.saw, /8 cell\(s\) ran/);
});

test("a profile store set aside for a form, with its reason, is decided", () => {
  const skip = (t, p) => p === STORES[0] && t === TERMS[1];
  const r = check(GRID_ASSERT, gridFiles({ cells: everyCell(skip),
    setAside: [{ term: TERMS[1], platform: STORES[0], reason: "The studio form is not sold on a general store." }] }));
  assert.equal(r.ok, true, r.saw);
  assert.match(r.saw, /1 profile-store cell\(s\) set aside with a reason/);
});

test("a set-aside with no reason decides nothing", () => {
  const skip = (t, p) => p === STORES[0] && t === TERMS[1];
  const r = check(GRID_ASSERT, gridFiles({ cells: everyCell(skip), setAside: [{ term: TERMS[1], platform: STORES[0], reason: "  " }] }));
  assert.equal(r.ok, false);
  assert.match(r.saw, /1 neither ran nor set aside/);
});

test("the frame's channels and the web cell always run: setting one aside is a miss", () => {
  const skip = (t, p) => (p === FRAME[0] || p === "web") && t === TERMS[0];
  const r = check(GRID_ASSERT, gridFiles({ cells: everyCell(skip), setAside: [
    { term: TERMS[0], platform: FRAME[0], reason: "Reason given." },
    { term: TERMS[0], platform: "web", reason: "Reason given." },
  ] }));
  assert.equal(r.ok, false);
  assert.match(r.saw, /2 set aside although the platform is not on the profile's list/);
});

test("a cell that never ran, and a row that is not a receipt, are both misses", () => {
  const cells = everyCell((t, p) => p === "web" && t === TERMS[1]);
  cells.find((c) => c.platform === FRAME[0]).status = "owned-by-other-half";
  const r = check(GRID_ASSERT, gridFiles({ cells }));
  assert.equal(r.ok, false);
  assert.match(r.saw, /2 neither ran nor set aside/);
  assert.match(r.saw, /1 row\(s\) carry a status that is not a receipt/);
});

test("with no store list on the run, which cells may be set aside cannot be established", () => {
  const r = check(GRID_ASSERT, gridFiles({ cells: everyCell(), profile: { profileKey: "x" } }));
  assert.equal(r.ok, false);
  assert.match(r.saw, /carries no store list/);
});

// ── no-unidentified-owner-on-off-register ───────────────────────────────────────────────────────────

const OWNER_ASSERT = { op: "no-unidentified-owner-on-off-register", path: "findings.json" };
const finding = (ordinal, sourceType, owner) => ({ ordinal, mark: MARK, owner, source: { source_type: sourceType, resolved_link: "" } });

test("an off-register finding naming its owner passes; one saying it could not be found fails", () => {
  const good = check(OWNER_ASSERT, { "findings.json": { findings: [
    finding(1, "register-vendor", { name: "Tallowmere Holdings" }),
    finding(2, "common-law-marketplace", { name: "Tallowmere Studio", country: "GB", registrations: [] }),
  ] } });
  assert.equal(good.ok, true, good.saw);
  const bad = check(OWNER_ASSERT, { "findings.json": { findings: [
    finding(2, "common-law-marketplace", { name: "not extracted" }),
    finding(3, "common-law-web", { name: "Owner could not be identified" }),
    finding(4, "common-law-web", null),
  ] } });
  assert.equal(bad.ok, false);
  assert.match(bad.saw, /3 naming no owner: #2 · #3 · #4/);
});

test("a run with no off-register finding is not probed, never passed", () => {
  const r = check(OWNER_ASSERT, { "findings.json": { findings: [finding(1, "register-vendor", { name: "Tallowmere Holdings" })] } });
  assert.equal(r.notProbed, true);
  assert.match(r.saw, /NOT PROBED \(not a pass\)/);
});

// ── the register plan and the reading turn's decisions ──────────────────────────────────────────────

const WAIT = { awaits_reading_turn: true };
const planEntry = (qid, extra = {}) => ({ qid, axis: "primary-sweep", predicate: "default", term: MARK, ...extra });
const JUDGED_ASSERT = { op: "every-family-was-judged", path: "_driver/coverage-ledger.json" };

const familyRun = ({ released = {}, withheld = {}, asked = [], supp = [], formRows = [] } = {}) => ({
  "variant-manifest.json": { mark: MARK },
  "_driver/register-plan.json": { entries: [
    planEntry("primary-sweep:exact:varento", { predicate: "exact", provenance: "mark" }),
    planEntry("fam:a", { when: WAIT }), planEntry("fam:b", { when: WAIT }), planEntry("fam:c", { when: WAIT }),
  ] },
  "_driver/released-families-primary-sweep.json": { axis: "primary-sweep", families: released },
  "_driver/withheld-families-primary-sweep.json": { axis: "primary-sweep", families: withheld },
  "_driver/plan-execution.json": { executed: [], asked },
  "_driver/register-coverage-form.form.json": { rows: formRows },
  "register-units/primary-sweep-supplemental-plan.json": { entries: supp },
});

test("every waiting family released, asked or withheld, each with its reason, is judged", () => {
  const r = check(JUDGED_ASSERT, familyRun({
    released: { "fam:a": { reason: "Looking wider would change who could object in the client's main market." } },
    withheld: { "fam:b": { reason: "The identical list already answers who could object here." } },
    asked: [{ qid: "fam:c", axis: "primary-sweep", asked_by: "supp:primary-sweep:1" }],
    supp: [{ qid: "supp:primary-sweep:1", origin: "supplemental", rationale: "The goods-narrowed list names a second games publisher." }],
  }));
  assert.equal(r.ok, true, r.saw);
  assert.match(r.saw, /3 waiting families: 2 asked \(1 released with a reason\), 1 withheld with a reason/);
  assert.match(r.saw, /the scenario names _driver\/coverage-ledger\.json, which this op does not read/,
    "the declared file the engine never writes is named beside the answer");
});

test("a family nobody decided, one decided both ways, and an ask with no rationale each fail", () => {
  const r = check(JUDGED_ASSERT, familyRun({
    released: { "fam:a": { reason: "Reason." } },
    withheld: { "fam:a": { reason: "Reason." } },
    asked: [{ qid: "fam:b", axis: "primary-sweep", asked_by: "supp:primary-sweep:2" }],
    supp: [{ qid: "supp:primary-sweep:2", origin: "supplemental", rationale: "" }],
  }));
  assert.equal(r.ok, false);
  assert.match(r.saw, /1 decided neither way: fam:c/);
  assert.match(r.saw, /1 recorded both asked and withheld: fam:a/);
  assert.match(r.saw, /1 asked by a question of the turn's that gives no rationale: fam:b/);
});

test("a stacked spelling-band entry that waited fails, even withheld with a reason: the band is asked as written", () => {
  const run = familyRun({
    released: { "fam:a": { reason: "Reason." } },
    withheld: { "fam:b": { reason: "Reason." }, "fam:c": { reason: "Reason." },
      "primary-sweep:exact:varento+form": { reason: "The spellings would only return noise." } },
  });
  run["_driver/register-plan.json"].entries.push(planEntry("primary-sweep:exact:varento+form",
    { predicate: "exact", provenance: "floor", term: undefined, terms: ["VARENTO", "VARENTOS"], when: WAIT }));
  const r = check(JUDGED_ASSERT, run);
  assert.equal(r.ok, false, r.saw);
  assert.match(r.saw, /1 spelling-band entry waited for the reading turn instead of being asked: primary-sweep:exact:varento\+form/);
});

test("a band entry asked one spelling a question that waited fails the same way", () => {
  const run = familyRun({
    released: { "fam:a": { reason: "Reason." } },
    withheld: { "fam:b": { reason: "Reason." }, "fam:c": { reason: "Reason." },
      "primary-sweep:exact:varentos+form#2": { reason: "Reason." } },
  });
  run["_driver/register-plan.json"].entries.push(planEntry("primary-sweep:exact:varentos+form#2",
    { predicate: "exact", provenance: "floor", term: "VARENTOS", when: WAIT }));
  const r = check(JUDGED_ASSERT, run);
  assert.equal(r.ok, false, r.saw);
  assert.match(r.saw, /1 spelling-band entry waited for the reading turn instead of being asked: primary-sweep:exact:varentos\+form#2/);
});

test("a family settled withheld on the coverage form counts, and is named as such", () => {
  const r = check(JUDGED_ASSERT, familyRun({
    released: { "fam:a": { reason: "Reason." } }, withheld: { "fam:b": { reason: "Reason." } },
    formRows: [{ kind: "family", qid: "fam:c", axis: "primary-sweep", status: "withheld-by-judgment", reason: "Not asked: the list answered it." }],
  }));
  assert.equal(r.ok, true, r.saw);
  assert.match(r.saw, /1 settled on the coverage form, not in the reading turn's own record/);
});

test("a plan where nothing waited is not probed", () => {
  const r = check(JUDGED_ASSERT, { "_driver/register-plan.json": { entries: [planEntry("q1")] } });
  assert.equal(r.notProbed, true);
});

const WITHHELD_ASSERT = { op: "withheld-by-judgment-carries-its-reason", path: "_driver/coverage-ledger.json" };

test("withheld families carry their reasons and their axis is not written clean", () => {
  const files = { ...familyRun({ withheld: { "fam:a": { reason: "Reason." } } }),
    "register-coverage-ledger.json": [{ axis: "primary-sweep", scope: "x", status: "coverage-limited", reason: "r", classes: [] }] };
  assert.equal(check(WITHHELD_ASSERT, files).ok, true);
  const blank = check(WITHHELD_ASSERT, { ...files, ...familyRun({ withheld: { "fam:a": { reason: "" } } }) });
  assert.equal(blank.ok, false);
  assert.match(blank.saw, /0 withheld families on record with a reason, 1 without: fam:a/);
  const clean = check(WITHHELD_ASSERT, { ...files,
    "register-coverage-ledger.json": [{ axis: "primary-sweep", scope: "x", status: "confirmed-clean", reason: "", classes: [] }] });
  assert.equal(clean.ok, false);
  assert.match(clean.saw, /1 ledger row\(s\) write clean an axis that holds a withheld family/);
  assert.equal(check(WITHHELD_ASSERT, familyRun()).notProbed, true, "nothing withheld: not probed");
});

const NARROW_ASSERT = { op: "narrowing-names-its-crowd", path: "_driver/coverage-ledger.json" };

test("a narrowing names a crowd on the record, and both carry a count", () => {
  const base = { "_driver/register-plan.json": { entries: [planEntry("crowd:1", { predicate: "exact", provenance: "mark" })] } };
  const supp = (narrows) => ({ "register-units/primary-sweep-supplemental-plan.json": { entries: [
    { qid: "supp:n1", origin: "supplemental", narrows, rationale: "Narrowed to the client's main market." }] } });
  const exec = (rows) => ({ "_driver/plan-execution.json": { executed: rows } });
  const good = check(NARROW_ASSERT, { ...base, ...supp("crowd:1"),
    ...exec([{ qid: "crowd:1", state: "incomplete", total_hits: 1200 }, { qid: "supp:n1", state: "enumerated", records: 40, total_hits: 40 }]) });
  assert.equal(good.ok, true, good.saw);
  const orphan = check(NARROW_ASSERT, { ...base, ...supp("crowd:9"), ...exec([{ qid: "supp:n1", state: "enumerated", total_hits: 40 }]) });
  assert.equal(orphan.ok, false);
  assert.match(orphan.saw, /1 name a crowd that is not on the record/);
  const uncounted = check(NARROW_ASSERT, { ...base, ...supp("crowd:1"), ...exec([{ qid: "supp:n1", state: "enumerated", total_hits: 40 }]) });
  assert.equal(uncounted.ok, false);
  assert.match(uncounted.saw, /1 name a crowd with no count/);
  assert.equal(check(NARROW_ASSERT, { ...base, ...exec([]) }).notProbed, true, "no narrowing: not probed");
});

test("the question and record counts are reported beside the baseline and judged nowhere", () => {
  const r = check({ op: "questions-and-records-at-most", path: "_driver/plan-execution-census.json", value: { questions: 2, records: 10 } },
    { "_driver/plan-execution.json": { executed: [{ qid: "a", records: 30 }, { qid: "b", records: 12 }, { qid: "c", records: 0 }] },
      "_driver/released-families-primary-sweep.json": { axis: "primary-sweep", families: { "fam:a": { reason: "Reason." } } } });
  assert.equal(r.reported, true);
  assert.match(r.saw, /^REPORTED, NOT JUDGED: 3 questions asked and 42 records read, against 2 and 10 on the scenario's baseline; 1 waiting family released/);
  const src = readFileSync(new URL("../../scripts/e2e.mjs", import.meta.url), "utf8");
  assert.match(src, /if \(r\.reported\) \{/, "report counts a reported op as neither a failure nor a gap");
  assert.match(src, /r\.reported \? "info"/, "…and prints it as info");
});

const GATE_ASSERT = { op: "families-gate-on-the-identical-question", path: "_driver/register-plan.json" };

test("every family waits except the identical question, the saturation count, the goods-narrowed question and the inexpressible", () => {
  const entries = [
    planEntry("primary-sweep:exact:varento", { predicate: "exact", provenance: "mark" }),
    planEntry("sat:1", { axis: "saturation-probe", term: "VAR" }),
    planEntry("goods:1", { predicate: "exact", provenance: "mark", goods_text: ["games"] }),
    planEntry("cant:1", { unsupported: true, unsupported_reason: "the register cannot express it" }),
    planEntry("fam:a", { when: WAIT }),
    planEntry("wild:1", { predicate: "wildcard", when: { runs_if_enumerated: "fam:a" } }),
    planEntry("supp:primary-sweep:1", { origin: "supplemental", rationale: "Asked by the reading turn." }),
  ];
  const ok = check(GATE_ASSERT, { "variant-manifest.json": { mark: MARK }, "_driver/register-plan.json": { entries } });
  assert.equal(ok.ok, true, ok.saw);
  const leak = check(GATE_ASSERT, { "variant-manifest.json": { mark: MARK },
    "_driver/register-plan.json": { entries: [...entries, planEntry("fam:loose", { axis: "transliteration-numeric" })] } });
  assert.equal(leak.ok, false);
  assert.match(leak.saw, /1 other entry runs without waiting: transliteration-numeric\/default fam:loose/);
  const noIdentical = check(GATE_ASSERT, { "variant-manifest.json": { mark: MARK },
    "_driver/register-plan.json": { entries: entries.slice(1) } });
  assert.equal(noIdentical.ok, false);
  assert.match(noIdentical.saw, /no identical-mark question/);
});

const CHAIN_ASSERT = { op: "identical-read-per-market", path: "_driver/register-plan.json" };
const IDQ = "primary-sweep:exact:varento";

test("the identical question reads as a list outright, or each crowd is narrowed until a narrowing does", () => {
  const plan = (extra = []) => ({ "variant-manifest.json": { mark: MARK }, "_driver/register-plan.json": { entries: [
    planEntry(IDQ, { predicate: "exact", provenance: "mark" }), ...extra] } });
  const exec = (rows) => ({ "_driver/plan-execution.json": { executed: rows } });
  assert.equal(check(CHAIN_ASSERT, { ...plan(), ...exec([{ qid: IDQ, state: "enumerated" }]) }).ok, true, "a list outright");

  const goods = planEntry("goods:1", { predicate: "exact", provenance: "mark", goods_text: ["games"] });
  const viaGoods = check(CHAIN_ASSERT, { ...plan([goods]), ...exec([{ qid: IDQ, state: "incomplete" }, { qid: "goods:1", state: "enumerated" }]) });
  assert.equal(viaGoods.ok, true, viaGoods.saw);
  assert.match(viaGoods.saw, /1 crowded and were narrowed until a narrowing came back as one/);

  const market = { "register-units/primary-sweep-supplemental-plan.json": { entries: [
    { qid: "supp:m1", origin: "supplemental", narrows: "goods:1", regions: ["EU"], rationale: "Still a crowd: one market." }] } };
  const twoSteps = check(CHAIN_ASSERT, { ...plan([goods]), ...market,
    ...exec([{ qid: IDQ, state: "incomplete" }, { qid: "goods:1", state: "incomplete" }, { qid: "supp:m1", state: "enumerated" }]) });
  assert.equal(twoSteps.ok, true, "a market that still crowds is narrowed again, not failed");

  const stuck = check(CHAIN_ASSERT, { ...plan([goods]), ...market,
    ...exec([{ qid: IDQ, state: "incomplete" }, { qid: "goods:1", state: "incomplete" }, { qid: "supp:m1", state: "incomplete" }]) });
  assert.equal(stuck.ok, false);
  assert.match(stuck.saw, /1 crowded with no narrowing that came back as a list/);

  const never = check(CHAIN_ASSERT, { ...plan(), ...exec([]) });
  assert.equal(never.ok, false);
  assert.match(never.saw, /1 never ran/);
});

// ── the declared files the engine never writes ──────────────────────────────────────────────────────

test("a scenario naming a file the op does not read is reported against the file it does read", () => {
  const found = pathsAnOpDoesNotRead([{ id: "X", expect: { assert: [
    { op: "every-family-was-judged", path: "_driver/coverage-ledger.json" },
    { op: "questions-and-records-at-most", path: "_driver/plan-execution-census.json" },
    { op: "families-gate-on-the-identical-question", path: "_driver/register-plan.json" },
  ] } }]);
  assert.deepEqual(found.map((f) => [f.op, f.declared, f.reads]), [
    ["every-family-was-judged", "_driver/coverage-ledger.json", "_driver/register-plan.json"],
    ["questions-and-records-at-most", "_driver/plan-execution-census.json", "_driver/plan-execution.json"],
  ]);
});
