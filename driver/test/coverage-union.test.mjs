// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the coverage form's accumulator: a row settled on attempt 1 cannot be lost on attempt 3.
//
// register-digest re-dispatches from eight triggers and three of them are COLD — a fresh session that
// re-derives a 160 KB document from a 1.9 MB band instead of editing it. The one measured three-attempt
// profile in the repo is this stage's: 105,747 output tokens FAIL → 137,519 FAIL → 36,362 PASS, and the
// attempt that passed is the one that PATCHED. Every cold attempt re-earned judgments already made.
//
// The union makes the outstanding count monotonically non-increasing BY CONSTRUCTION rather than by the
// model behaving well. These tests prove that property offline; whether a run then CONVERGES is a claim
// about a model's next turn and no preserved artifact answers it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { unionCoverageForm, outstandingCoverageRows } from "../coverage-union.mjs";
import { rowIsSettled, formRowKey } from "../coverage-form.mjs";

const PLAN = { entries: [
  { qid: "ps:stack:lumen+form", axis: "primary-sweep", predicate: "exact", terms: ["LUMEN", "LUMENN"],
    nice_classes: ["9"], expected_kind: "enumerate" },
  { qid: "tn:translit:lumen+cyr", axis: "transliteration-numeric", predicate: "default", term: "ЛЮМЕН",
    nice_classes: ["9"], expected_kind: "enumerate" },
] };
const INPUT = {
  skeleton: [
    { axis: "primary-sweep", state: "incomplete", missing: [] },
    { axis: "transliteration-numeric", state: "deferred", deferred: ["tn:translit:lumen+cyr"], missing: [] },
  ],
  plan: PLAN,
  bandBlocksByAxis: { "primary-sweep": [{ state: "incomplete", qid: "ps:stack:lumen+form", total_hits: 6862,
    term_counts: { LUMEN: { disposition: "crowd" }, LUMENN: { disposition: "unenumerated" } } }] },
  deferredReasons: { "tn:translit:lumen+cyr": "the provider indexes non-latin filings by their transliteration" },
  activeAxes: ["primary-sweep", "transliteration-numeric"],
};

const empty = () => unionCoverageForm(null, null, INPUT);
const settleAll = (rows) => rows.map((r) => ({ ...r,
  status: r.open ? "deferred" : "confirmed-clean", reason: "judged" }));

test("attempt 1: the union over nothing is the empty form, and every row is outstanding", () => {
  const u = empty();
  assert.equal(u.settled, 0);
  assert.equal(u.outstanding, u.total);
  assert.equal(u.carried, 0);
  assert.ok(u.total >= 3, "an axis row per axis, the open block, the deferred qid");
  assert.match(u.form._provenance, /driver-written form/);
});

test("A ROW SETTLED ON ATTEMPT 1 IS STILL SETTLED ON ATTEMPT 3, over a submission that wrote nothing", () => {
  const a1 = unionCoverageForm(null, { rows: settleAll(empty().form.rows) }, INPUT);
  assert.equal(a1.outstanding, 0);
  // attempt 2 is COLD: a fresh session that re-emitted the file from scratch with every field blank.
  const a2 = unionCoverageForm(a1.form, { rows: a1.form.rows.map((r) => ({ ...r, status: null, reason: null })) }, INPUT);
  assert.equal(a2.outstanding, 0, "a cold re-emit cannot destroy work already done");
  assert.equal(a2.carried, a2.total, "every settled row came from a PREVIOUS attempt");
  // attempt 3 wrote no file at all.
  const a3 = unionCoverageForm(a2.form, null, INPUT);
  assert.equal(a3.outstanding, 0);
});

test("THE OUTSTANDING COUNT CANNOT RISE ON THE DRIVER'S OBLIGATIONS, whatever a pass submits", () => {
  // Scoped to the DRIVER rows, and deliberately: those are what the plan decides and what a cold
  // re-dispatch used to destroy. A SEAT row the digest adds late is new work it chose to add — counting
  // it here would make "the count cannot rise" a claim about the model's discretion rather than about
  // this function.
  let prior = null, last = Infinity;
  const rows = empty().form.rows;
  const passes = [
    rows.slice(0, 1), rows.slice(0, 2), rows.slice(0, 3), rows, [], [{ row_id: "NOPE", status: "x" }],
    null, { rows: "junk" },
  ];
  for (const sub of passes) {
    const u = unionCoverageForm(prior, Array.isArray(sub) ? { rows: settleAll(sub) } : sub, INPUT);
    const outstanding = u.form.rows.filter((r) => r.kind !== "seat" && !rowIsSettled(r, r)).length;
    assert.ok(outstanding <= last, `outstanding rose ${last} → ${outstanding}`);
    last = outstanding;
    prior = u.form;
  }
  assert.equal(last, 0, "and it reached zero — the passes between settled every obligation");
});

test("a SUBMITTED row the gate accepts beats a prior one — a seat may correct itself", () => {
  const a1 = unionCoverageForm(null, { rows: settleAll(empty().form.rows) }, INPUT);
  const block = a1.form.rows.find((r) => r.kind === "block");
  const corrected = a1.form.rows.map((r) => r.row_id === block.row_id
    ? { ...r, status: "coverage-limited", reason: "on reflection the LUMENN leg stayed open" } : r);
  const a2 = unionCoverageForm(a1.form, { rows: corrected }, INPUT);
  const after = a2.form.rows.find((r) => r.row_id === block.row_id);
  assert.equal(after.status, "coverage-limited");
  assert.match(after.reason, /on reflection/);
});

test("a row completed ACROSS two passes is judged on the MERGED row, never on either input", () => {
  // A status written on one pass and its reason on the next. Counting only whole settled inputs would
  // report the row outstanding while the gate, reading this same merged row, accepts it — two counts of
  // one thing is how the convergence ledger stops meaning anything.
  const base = empty().form.rows;
  const half = base.map((r) => ({ ...r, status: r.open ? "deferred" : "confirmed-clean", reason: "" }));
  const a1 = unionCoverageForm(null, { rows: half }, INPUT);
  assert.equal(a1.settled, 0, "a status with no reason is not settled");
  const other = base.map((r) => ({ ...r, status: "", reason: "the reasoning, this pass" }));
  const a2 = unionCoverageForm(a1.form, { rows: other }, INPUT);
  assert.equal(a2.outstanding, 0, "the field-wise carry completes rows neither attempt finished alone");
  assert.deepEqual(outstandingCoverageRows(a2.form), []);
});

test("THE ROWS ARE ALWAYS THE DRIVER'S — a seat cannot add, drop or alter an obligation", () => {
  const clean = empty();
  const tampered = clean.form.rows
    .filter((r) => r.kind !== "deferred")                                    // deleted the awkward row
    .map((r) => ({ ...r, open: false, total_hits: 1, qid: "invented", status: "confirmed-clean", reason: "mine" }))
    .concat([{ row_id: "CB-FAKE", kind: "block", axis: "primary-sweep", qid: "made:up", status: "confirmed-clean", reason: "x" }]);
  const u = unionCoverageForm(null, { rows: tampered }, INPUT);
  const keys = u.form.rows.filter((r) => r.kind !== "seat").map(formRowKey).sort();
  assert.deepEqual(keys, clean.form.rows.map(formRowKey).sort(), "the obligation set is the plan's, every pass");
  const deferred = u.form.rows.find((r) => r.kind === "deferred");
  assert.equal(deferred.open, true, "the driver's own flag is re-stamped after the merge");
  assert.equal(deferred.qid, "tn:translit:lumen+cyr");
  assert.equal(u.form.rows.find((r) => r.kind === "block").total_hits, 6862);
  assert.ok(!u.form.rows.some((r) => r.qid === "made:up"), "an invented block row is not an obligation");
});

test("clearing `open` cannot buy a clean claim — the flag is the driver's and is re-stamped", () => {
  const u = unionCoverageForm(null, { rows: empty().form.rows.map((r) =>
    ({ ...r, open: false, status: "confirmed-clean", reason: "nothing to see" })) }, INPUT);
  const d = u.form.rows.find((r) => r.kind === "deferred");
  assert.equal(d.open, true);
  assert.equal(rowIsSettled(d, d), false, "a slice that was never searched is still not clean");
  assert.ok(u.outstanding >= 1);
});

test("SEAT ROWS ride through, keep their status, and cannot displace a driver row", () => {
  const seat = [
    { axis: "primary-sweep", kind: "seat", unit: "primary-sweep / NZ (material)", status: "deferred", reason: "not run" },
    { axis: "transliteration-numeric", kind: "deferred", qid: "tn:translit:lumen+cyr", status: "confirmed-clean", reason: "mine" },
  ];
  const a1 = unionCoverageForm(null, { rows: [...settleAll(empty().form.rows), ...seat] }, INPUT);
  const nz = a1.form.rows.find((r) => r.kind === "seat");
  assert.ok(nz, "the digest's own coverage unit survives — the ledger a lawyer reads keeps its slices");
  assert.equal(nz.status, "deferred");
  assert.equal(a1.form.rows.filter((r) => r.kind === "deferred").length, 1, "no shadow driver row was minted");
  // …and a later pass that said NOTHING inherits them rather than dropping them (a pass that SPOKE owns
  // them outright — see the retraction test below).
  const a2 = unionCoverageForm(a1.form, null, INPUT);
  assert.ok(a2.form.rows.some((r) => r.kind === "seat" && r.unit.includes("NZ")));
});

test("the union never throws on junk, an absent prior, or a damaged submission", () => {
  for (const bad of [null, undefined, "", 7, { rows: "no" }, { rows: [null, 3, { }] }, [{ }]]) {
    assert.doesNotThrow(() => unionCoverageForm(bad, bad, INPUT));
  }
  assert.equal(unionCoverageForm(null, null, {}).total, 0, "no plan apparatus ⇒ no rows, and no throw");
});

test("A SEAT ROW CAN BE RETRACTED — omission by a submission that SPOKE is retraction", () => {
  // The asymmetry, deliberately: a DRIVER row is an obligation the plan decides, so omitting it changes
  // nothing about what is owed. A SEAT row is the digest's own coverage unit, and carrying it forever
  // would make a slice row wrong on attempt 1 permanent IN THE TABLE A LAWYER READS, with a corrective
  // pass told "that row is wrong" unable to comply. Rewriting the prose section used to drop it.
  const seat = { axis: "primary-sweep", kind: "seat", unit: "primary-sweep / NZ (material)",
    status: "deferred", reason: "not run" };
  const a1 = unionCoverageForm(null, { rows: [...settleAll(empty().form.rows), seat] }, INPUT);
  assert.ok(a1.form.rows.some((r) => r.kind === "seat"));
  // The corrective pass rewrites the file without that row: it goes.
  const a2 = unionCoverageForm(a1.form, { rows: a1.form.rows.filter((r) => r.kind !== "seat") }, INPUT);
  assert.ok(!a2.form.rows.some((r) => r.kind === "seat"), "a submission that spoke owns the seat rows outright");
  assert.equal(a2.outstanding, 0, "…and retracting one never leaves a driver obligation unsettled");
  // A pass that said NOTHING (no file, unreadable, or the driver's own pre-dispatch write) still inherits.
  const a3 = unionCoverageForm(a1.form, null, INPUT);
  assert.ok(a3.form.rows.some((r) => r.kind === "seat"), "a cold turn that wrote nothing loses none of them");
  const a4 = unionCoverageForm(a1.form, { rows: null }, INPUT);
  assert.ok(a4.form.rows.some((r) => r.kind === "seat"));
});

test("a seat row on an axis outside the vocabulary is REFUSED, not passed downstream to break the ledger", () => {
  // normalizeAxis repairs cosmetic noise and leaves a genuinely-unknown token unchanged (repair
  // formatting, never invent an axis). Without a check in rowIsSettled that row would sail through the
  // gate and die in parseCoverageLedgerJson, which drops the machine ledger for the whole run — a defect
  // nothing the seat is asked to do could then repair.
  const bad = { axis: "not-an-axis", kind: "seat", unit: "not-an-axis / whatever", status: "confirmed-clean", reason: "ok" };
  const u = unionCoverageForm(null, { rows: [...settleAll(empty().form.rows), bad] }, INPUT);
  const row = u.form.rows.find((r) => r.kind === "seat");
  assert.equal(rowIsSettled(row, row), false);
  assert.equal(u.outstanding, 1);
  assert.deepEqual(outstandingCoverageRows(u.form).map((r) => r.axis), ["not-an-axis"]);
  // normalizeAxis's own repairs still land: a `digest`-labelled cross-check row is coerced to the axis
  // that owns it, exactly as the prose parser coerced it, and settles.
  const coerced = unionCoverageForm(null, { rows: [...settleAll(empty().form.rows),
    { axis: "digest", kind: "seat", unit: "digest / cross-class merch check", status: "confirmed-clean", reason: "ok" }] }, INPUT);
  const cr = coerced.form.rows.find((r) => r.kind === "seat");
  assert.equal(cr.axis, "primary-sweep");
  assert.equal(rowIsSettled(cr, cr), true);
});
