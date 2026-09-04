// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// 's CONSTRAINT, MADE MEASURABLE: what the coverage form's gate refuses, against what the prose
// join refused, over one set of digest judgments.
//
// THE INVARIANT, in the three parts the design of record now states (docs/design/register-digest-form.md
// §2, corrected 2026-08-07 — the earlier text said the join was axis-scoped, build 2.2 followed it, and
// that is the defect this file exists to pin shut):
//
//   1. ONE-DIRECTIONAL. Every (axis, block) pair the FORM gate refuses was also refused by the PROSE
//      join. The gate never goes stricter — a stricter gate fires on runs that pass today. The one
//      boundary where that does not hold is named and tested separately at the foot of this file, rather
//      than left for a reader to discover.
//   2. CHARACTERISED BY NAME. Every pair in the difference is a TRANSCRIPTION FAILURE: the digest meant
//      to disclose that block and its typing failed the string join. Enumerated by name below, never by
//      count. A difference containing a block the digest never named at all is NOT a transcription
//      failure — it is the gate going quiet, and it fails this build.
//   3. BLOCK SPECIFICITY. A disclosure naming block A never discharges block B. That is what the prose
//      join did (`blockIsDisclosed` joined on the block's OWN qid or hit count inside the axis's
//      haystack), and it is what the form must do. The ION scenario is the pin: its second block is
//      refused by BOTH mechanisms.
//
// THE PROSE MECHANISM IS IMPORTED, NOT RECONSTRUCTED. It is back in the tree — register-plan.mjs keeps
// it as the archived-run reader, because the form is armed conditionally and a floor is never deleted
// unconditionally while its replacement is conditional. An in-test copy would now be a SECOND copy of
// the firing predicate, free to drift from the one that ships, which is the defect `openBlocksByAxis`'s
// own "ONE CALCULATION, NOT TWO" header exists to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openBlocksByAxis, findUnverifiedIncompleteCleanClaims } from "../register-plan.mjs";
import { coverageFormRows, findCoverageFormViolations, renderCoverageLedgerSection, spliceCoverageLedger } from "../coverage-form.mjs";

/** The (axis, qid) pairs the PROSE gate refuses: C1 ∧ … ∧ C7 ∧ ¬C8, over the model's own rows. */
function proseRefused(rows, skeleton, bands, plan) {
  const out = new Set();
  for (const v of findUnverifiedIncompleteCleanClaims(rows, skeleton, bands, plan))
    for (const b of v.blocks) out.add(`${v.axis}|${b.qid}`);
  return out;
}

// ── THE FORM MECHANISM, FILLED FROM THE SAME JUDGMENT ───────────────────────────────────────────────
//
// The two mechanisms are only comparable if the same beliefs go into both, so each scenario DECLARES
// what its digest believes — which blocks its prose rows are ABOUT (`disclosed`) — and the form is
// filled from that declaration rather than from a search of the digest's own text. Deriving the fill by
// string-matching the prose would make this test a tautology: it would re-run the join it is meant to be
// measuring, and every difference would vanish by construction.
//
// `disclosed` is the test author's reading of what each scenario's digest meant, stated in the fixture
// where a reviewer can check it against the prose beside it.
function formRefused(scenario, skeleton, bands, plan) {
  const { rows: driverRows } = coverageFormRows({ skeleton, plan, bandBlocksByAxis: bands });
  const disclosed = new Set(scenario.disclosed ?? []);
  // Did the digest claim this axis clean at all? That is C1, and it is the only axis-level fact the
  // form fill needs: everything else is decided per row.
  const axisClean = new Map();
  for (const r of scenario.rows) {
    const ax = String(r.axis).trim();
    if (String(r.status).trim() === "confirmed-clean") axisClean.set(ax, true);
    else if (!axisClean.has(ax)) axisClean.set(ax, false);
  }
  for (const r of driverRows) {
    r.status = r.kind === "block"
      // A block the digest meant to disclose gets the disclosure ON ITS OWN ROW. One it did not, on an
      // axis it called clean, carries that clean claim — which is exactly the swallow being tested for.
      ? (disclosed.has(r.qid) ? "coverage-limited" : (axisClean.get(r.axis) ? "confirmed-clean" : "coverage-limited"))
      : r.open ? "deferred"
        : (axisClean.get(r.axis) ? "confirmed-clean" : "coverage-limited");
    r.reason = "judged";
  }
  const seat = scenario.rows.map((r, i) => ({ row_id: `CS-${i}`, axis: String(r.axis).trim(), kind: "seat",
    unit: String(r.unit ?? r.axis), open: false, status: String(r.status).trim(), reason: String(r.reason ?? "r") || "r" }));
  // REFUSAL IS READ PER BLOCK ROW, by the driver's own row id — never per axis. Reading it per axis is
  // what let the loose build report "the axis fired" and lose which block it fired about.
  const blockById = new Map(driverRows.filter((r) => r.kind === "block").map((r) => [r.row_id, r]));
  const out = new Set();
  for (const v of findCoverageFormViolations([...driverRows, ...seat])) {
    const b = blockById.get(v.row);
    if (b) out.add(`${b.axis}|${b.qid}`);
  }
  return out;
}

// ── THE SCENARIOS ───────────────────────────────────────────────────────────────────────────────────
// One plan, one skeleton, one band, and every shape of ledger a digest can write over them.
const PLAN = { entries: [
  { qid: "ps:stack:lumen+form", axis: "primary-sweep", predicate: "exact",
    terms: ["LUMEN", "LUMENN"], nice_classes: ["9"], expected_kind: "enumerate" },
  { qid: "ps:owner:lumen+incumbent", axis: "primary-sweep", predicate: "owner",
    term: "LUMEN", nice_classes: ["9"], expected_kind: "enumerate" },
] };
const SKELETON = [{ axis: "primary-sweep", state: "incomplete", entries: 2, executed: 2, crowds: 2, skipped: 0, missing: [] }];
const BANDS = { "primary-sweep": [
  { state: "incomplete", qid: "ps:stack:lumen+form", total_hits: 6862,
    term_counts: { LUMEN: { disposition: "crowd" }, LUMENN: { disposition: "unenumerated" } } },
  { state: "incomplete", qid: "ps:owner:lumen+incumbent", total_hits: 703,
    class_counts: { 9: { disposition: "unenumerated" } } },
] };

const SCENARIOS = [
  { name: "all clean, nothing disclosed — both refuse both blocks",
    disclosed: [],
    rows: [{ axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" }] },
  { name: "the qid written verbatim — the disclosure the gate was built for",
    disclosed: ["ps:stack:lumen+form", "ps:owner:lumen+incumbent"],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / stack",
        reason: "ps:stack:lumen+form and ps:owner:lumen+incumbent stayed open" },
    ] },
  { name: "THE SKILL'S OWN TEMPLATE — a rounded count the join cannot match",
    // The row is about the stack slice and says so in words; `~6,800` is not `6862`, so the number arm
    // misses and the qid never appears. The owner block is not mentioned and is not claimed disclosed.
    disclosed: ["ps:stack:lumen+form"],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / stack",
        reason: "the exact-in-class-live slice returned ~6,800 hits, could not be fully enumerated" },
    ] },
  { name: "the exact count, thousands-grouped — accepted since #74",
    disclosed: ["ps:stack:lumen+form", "ps:owner:lumen+incumbent"],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / stack",
        reason: "returned 6,862 hits; 703 on the owner slice" },
    ] },
  { name: "one block named, the other not — the ION shape",
    // THE REGRESSION PIN FOR THE BLOCKER. One disclosure, two open blocks. The prose join refused the
    // block that disclosure did not name, and so must the form: block specificity is the gate, not a
    // tightening of it. Under the loose reading this pair sat in the difference list below, labelled a
    // transcription failure, when the digest had never named that block at all.
    disclosed: ["ps:stack:lumen+form"],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / stack",
        reason: "ps:stack:lumen+form stayed open" },
    ] },
  { name: "no clean claim at all — neither gate has anything to refuse",
    disclosed: [],
    rows: [{ axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / worldwide", reason: "open" }] },
  { name: "a deferred row rather than coverage-limited — both are non-clean",
    disclosed: ["ps:owner:lumen+incumbent"],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "deferred", unit: "primary-sweep / stack", reason: "ps:owner:lumen+incumbent unreachable" },
    ] },
  { name: "the count inside a longer number — the standalone bound holds",
    // `67030` contains `703`. The prose bound refuses to read that as a disclosure, and the row is about
    // neither block, so neither mechanism accepts either one.
    disclosed: [],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / stack", reason: "record 67030 reviewed" },
    ] },
  { name: "the qid mistyped by one character — a substring match is all or nothing",
    // The digest disclosed BOTH blocks and typed one of the two qids wrong. The join has no tolerance:
    // the misspelled one reads as never named. This is the whole failure class exists to remove.
    disclosed: ["ps:stack:lumen+form", "ps:owner:lumen+incumbent"],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / stack",
        reason: "ps:stack:lumen+form and ps:owner:lumen+incumbant both stayed open" },
    ] },
];

test("THE FORM GATE NEVER REFUSES WHAT THE PROSE JOIN ACCEPTED", () => {
  for (const s of SCENARIOS) {
    const prose = proseRefused(s.rows, SKELETON, BANDS, PLAN);
    const form = formRefused(s, SKELETON, BANDS, PLAN);
    for (const pair of form)
      assert.ok(prose.has(pair), `${s.name}: the form refuses ${pair} and the prose join did not — the gate went STRICTER`);
  }
});

test("the difference is EXACTLY the transcription failures — the digest meant to disclose that block", () => {
  const diffs = [];
  for (const s of SCENARIOS) {
    const prose = proseRefused(s.rows, SKELETON, BANDS, PLAN);
    const form = formRefused(s, SKELETON, BANDS, PLAN);
    for (const pair of prose) {
      if (form.has(pair)) continue;
      const qid = pair.split("|")[1];
      assert.ok((s.disclosed ?? []).includes(qid),
        `${s.name}: ${pair} is accepted by the form and the digest never disclosed that block — that is the gate going QUIET, not a transcription failure`);
      diffs.push(`${s.name} :: ${pair}`);
    }
  }
  // The measurement itself, so the review reads what moved instead of taking the claim on trust. TWO
  // pairs, two shapes, and every one a block the scenario declares its digest meant to disclose:
  // a rounded hit count the number arm cannot match, and a qid off by one character.
  assert.deepEqual(diffs, [
    "THE SKILL'S OWN TEMPLATE — a rounded count the join cannot match :: primary-sweep|ps:stack:lumen+form",
    // The pair is keyed on the PLAN's qid, spelled correctly — the misspelling exists only in the
    // digest's prose, which is the entire point of the scenario.
    "the qid mistyped by one character — a substring match is all or nothing :: primary-sweep|ps:owner:lumen+incumbent",
  ]);
});

test("BLOCK SPECIFICITY: a disclosure naming one block never discharges the other — in BOTH mechanisms", () => {
  // The blocker, stated as its own assertion rather than left to be inferred from the diff list. The ION
  // scenario discloses ps:stack and says nothing about ps:owner. Both mechanisms must refuse ps:owner
  // and accept ps:stack. A gate that discharged ps:owner on the mere presence of a non-clean row is the
  // FROSTBERRY hole, which is what `blockIsDisclosed`'s own doc block says must never reopen.
  const ion = SCENARIOS.find((s) => s.name.includes("the ION shape"));
  const prose = proseRefused(ion.rows, SKELETON, BANDS, PLAN);
  const form = formRefused(ion, SKELETON, BANDS, PLAN);
  assert.deepEqual([...prose], ["primary-sweep|ps:owner:lumen+incumbent"]);
  assert.deepEqual([...form], ["primary-sweep|ps:owner:lumen+incumbent"]);
});

test("the STRICTER boundary, named: a coincidental number match discharged a block the digest never meant", () => {
  // The one shape where the form is stricter than the prose join, tested rather than left for a reader
  // to find. The digest discloses the stack slice and, in the same sentence, happens to write the owner
  // block's exact hit count about something else. `blockIsDisclosed` cannot tell a coincidence from a
  // disclosure — a bare number is all it has — so the prose join discharges ps:owner. The form refuses
  // it, because the digest called that block's own row clean.
  //
  // This is the correct direction and it is why the invariant above is stated over intent-faithful
  // fills. The prose accept here is an accident, not a judgment: no lawyer reading that ledger would
  // say the owner slice had been disclosed. Refusing it is the gate doing its job.
  const coincidence = {
    name: "a number that is not a disclosure",
    disclosed: ["ps:stack:lumen+form"],
    rows: [
      { axis: "primary-sweep", status: "confirmed-clean", unit: "primary-sweep / worldwide", reason: "full" },
      { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / stack",
        reason: "ps:stack:lumen+form stayed open; 703 records were read across the whole axis" },
    ],
  };
  const prose = proseRefused(coincidence.rows, SKELETON, BANDS, PLAN);
  const form = formRefused(coincidence, SKELETON, BANDS, PLAN);
  assert.deepEqual([...prose], [], "the prose join discharges ps:owner on the bare number 703");
  assert.deepEqual([...form], ["primary-sweep|ps:owner:lumen+incumbent"],
    "the form refuses it — the digest claimed that block's own row clean");
});

test("C1 through C7 are byte-identical — the shared calculation is called once and by both", () => {
  // The whole of the firing predicate except C8 lives in openBlocksByAxis, which the form BUILDS from and
  // findUnverifiedIncompleteCleanClaims now WRAPS. There is no second copy that could drift.
  const open = openBlocksByAxis(SKELETON, BANDS, PLAN);
  assert.deepEqual(Object.keys(open), ["primary-sweep"]);
  assert.deepEqual(open["primary-sweep"].map((b) => b.qid), ["ps:stack:lumen+form", "ps:owner:lumen+incumbent"]);
  assert.equal(open["primary-sweep"][0].total_hits, 6862);
  assert.deepEqual(open["primary-sweep"][0].unaccounted, ["LUMENN"]);
  assert.deepEqual(open["primary-sweep"][1].unaccounted_classes, ["9"]);
  const built = coverageFormRows({ skeleton: SKELETON, plan: PLAN, bandBlocksByAxis: BANDS }).rows
    .filter((r) => r.kind === "block").map((r) => r.qid);
  assert.deepEqual(built, ["ps:stack:lumen+form", "ps:owner:lumen+incumbent"]);
});

test("C2..C7's replay carve-outs survive: a legacy band with neither count map can never open a block", () => {
  // A pre-count-first band CANNOT carry term_counts and a pre-class-split one CANNOT carry class_counts;
  // absent means legacy, never unverified. The 2026-07-10 corpus audit turned on exactly this.
  const legacy = { "primary-sweep": [{ state: "incomplete", qid: "ps:stack:lumen+form", total_hits: 6862 }] };
  assert.deepEqual(openBlocksByAxis(SKELETON, legacy, PLAN), {});
  assert.deepEqual(coverageFormRows({ skeleton: SKELETON, plan: PLAN, bandBlocksByAxis: legacy }).rows
    .filter((r) => r.kind === "block"), []);
});

test("an error block still joins MISSING, and a count-kind entry is still sanctioned", () => {
  const errored = { "primary-sweep": [{ state: "incomplete", error: true, qid: "ps:stack:lumen+form",
    total_hits: 1, term_counts: { LUMEN: { disposition: "unenumerated" } } }] };
  assert.deepEqual(openBlocksByAxis(SKELETON, errored, PLAN), {});
  const countPlan = { entries: [{ ...PLAN.entries[0], expected_kind: "count" }] };
  assert.deepEqual(openBlocksByAxis(SKELETON, BANDS, countPlan), {});
});

// ── — RE-RENDERING THE LEDGER MUST NOT DELETE THE REST OF THE DOCUMENT ──────────────────────────
//
// `spliceCoverageLedger` replaced from its own heading to the next heading of level ≤ its own. A DEEPER
// heading after it was therefore not a boundary — and this function's own fallback inserts the section
// immediately before `### Audit trail`, while runDigest re-renders on every pass. So the second render of
// any findings document with that shape deleted the audit trail and everything under it.
//
// Not latent, and not hypothetical: reproduced directly before the fix, on the shape the fallback creates.
// Found from the sibling splice written for, which copied this scan and was caught by its own
// re-render arm.
test("#850 a second ledger render leaves the rest of the document standing", () => {
  const sec = renderCoverageLedgerSection([{ unit: "u1", status: "confirmed-clean", reason: "r", qid: "q1" }]);
  assert.ok(sec.length, "the fixture rendered an EMPTY section — the arm below would pass over nothing. "
    + "`status` must be one of COVERAGE_STATUSES or renderCoverageLedgerSection returns \"\".");
  // The shape spliceCoverageLedger's own fallback produces on the first render.
  const once = spliceCoverageLedger("# Register findings\n\nbody\n\n### Audit trail\n\nrows here\n", sec);
  assert.match(once, /### Audit trail/);
  const twice = spliceCoverageLedger(once, sec);
  assert.match(twice, /### Audit trail/, "the second render deleted the audit trail HEADING");
  assert.match(twice, /rows here/, "the second render deleted the audit trail's ROWS — a delivered document "
    + "losing content on a re-render nobody asked for");
  assert.equal((twice.match(/## Coverage ledger/g) ?? []).length, 1, "and it must still be idempotent");
});

test("#850 a deeper heading is a boundary, but the section still replaces its own body", () => {
  // The other direction: stopping at ANY heading must not stop the splice from doing its job. A version
  // that never replaced would be idempotent by accident and would leave a stale table in place.
  const a = renderCoverageLedgerSection([{ unit: "u1", status: "confirmed-clean", reason: "first", qid: "q1" }]);
  const b = renderCoverageLedgerSection([{ unit: "u1", status: "deferred", reason: "second", qid: "q1" }]);
  const out = spliceCoverageLedger(spliceCoverageLedger("# F\n\n### Audit trail\n\nrows\n", a), b);
  assert.match(out, /second/, "the later render must win");
  assert.doesNotMatch(out, /first/, "the earlier table survived beside it");
  assert.match(out, /rows/);
});
