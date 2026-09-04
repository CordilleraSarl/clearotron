// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE TAINT PARK MUST DROP THE COVERAGE FORM ACCUMULATOR, OR IT ACHIEVES NOTHING.
//
// The park exists to force a resumed run to RE-RULE slices whose search was kill-touched. It renames
// register-findings.md and register-coverage-ledger.json for exactly that reason — its own comment:
// "a digest already derived from tainted material is renamed too, else its skip would ship stale rows."
//
// The coverage form's `_driver/` copy is such material and the first cut of this build left it behind.
// It is the ACCUMULATOR: unionCoverageForm carries a settled status forward across every re-dispatch,
// keyed on `formRowKey` — `block:<qid>` — and a qid does not change when its slice is re-run. So a
// block re-run to a completely different hit count keeps the status and the reason the seat gave it over
// the DISCARDED band, the gate finds nothing to refuse, and the digest ships a ruling about material the
// run threw away.
//
// Marking block rows `open` (the other half of this build) narrows the leak without closing it: a stale
// `confirmed-clean` can no longer survive the union, because rowIsSettled refuses a clean claim on an
// open row. A stale `coverage-limited` survives intact — and that is the shape a compliant digest
// actually writes over a saturated crowd, so it is the shape reproduced below.
//
// This file proves the leak is real (test 1), that parking the accumulator closes it (test 2), and that
// the park's artifact list actually names it (test 3) — the park has no harness that can drive it end to
// end, so the list is exported and asserted rather than trusted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { unionCoverageForm } from "../coverage-union.mjs";
import { findCoverageFormViolations } from "../coverage-form.mjs";
import { armCoverageForm, coverageFormPaths, coverageFormStamp, readCoverageForm,
  readCoverageFormInput, writeCoverageForm } from "../coverage-form-io.mjs";
import { taintParkJudgmentArtifacts } from "../pipeline.mjs";
import { paths } from "../stages.mjs";

const QID = "ps:stack:lumen+form";
// The SAME slice, searched twice: once under the pass the taint killed, once after the re-run. Same
// qid — the plan did not change — and a wholly different hit count, because the first pass was cut short.
const TAINTED_BAND = [{ state: "incomplete", qid: QID, total_hits: 6862,
  term_counts: { LUMEN: { disposition: "crowd" }, LUMENN: { disposition: "unenumerated" } } }];
const FRESH_BAND = [{ state: "incomplete", qid: QID, total_hits: 41209,
  term_counts: { LUMEN: { disposition: "crowd" }, LUMENN: { disposition: "unenumerated" } } }];

function runDir(band = TAINTED_BAND) {
  const dir = mkdtempSync(join(tmpdir(), "cov-park-"));
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(join(dir, "register-findings.md"), "# Register findings\n\n## Findings — Mark: LUMEN\n\nbody\n");
  writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({
    skeleton: [{ axis: "primary-sweep", state: "incomplete", missing: [] }], deferred: [] }));
  writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify({
    entries: [{ qid: QID, axis: "primary-sweep", predicate: "exact",
      terms: ["LUMEN", "LUMENN"], nice_classes: ["9"], expected_kind: "enumerate" }] }));
  writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), JSON.stringify(band));
  return dir;
}
const setBand = (dir, band) =>
  writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), JSON.stringify(band));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

/**
 * Settle the form over the band currently on disk, the way a digest pass does.
 *
 * The block is ruled `coverage-limited` — the HONEST status for a crowd that ran and saturated, and the
 * one a compliant digest writes. `confirmed-clean` cannot leak here at all any more: block rows are
 * `open`, so rowIsSettled refuses a clean claim on one and the union will not carry it. That narrows
 * the leak; it does not close it. A disclosure is still a RULING, made over a specific band, and this
 * one quotes the band the park is about to throw away.
 */
function settleOverCurrentBand(dir, reason) {
  const input = readCoverageFormInput(dir);
  const { form } = unionCoverageForm(null, null, input);
  const filled = unionCoverageForm(null, { rows: form.rows.map((r) => ({ ...r,
    status: r.kind === "block" ? "coverage-limited" : "confirmed-clean", reason })) }, input);
  writeCoverageForm(dir, filled.form);
  return filled;
}

test("THE LEAK, REPRODUCED: an accumulator that survives the park carries a discarded band's ruling", () => {
  const dir = runDir();
  try {
    armCoverageForm(dir);
    // A pass over the TAINTED band rules the block, quoting that band's size. The ruling is honest about
    // the material it saw — and that material is exactly what the park is about to discard.
    const before = settleOverCurrentBand(dir, "6,862 hits; LUMENN unenumerated within the budget for this pass");
    assert.equal(before.form.rows.find((r) => r.kind === "block").total_hits, 6862);
    assert.equal(before.outstanding, 0);

    // The park as it stood: findings and derived ledger renamed, accumulator untouched.
    renameSync(join(dir, "register-findings.md"), join(dir, "register-findings.md.tainted-1"));
    rmSync(driverDir(dir, "plan-execution.json"), { force: true });
    // …the slice is re-run and comes back a THIRD bigger, still open.
    setBand(dir, FRESH_BAND);
    writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({
      skeleton: [{ axis: "primary-sweep", state: "incomplete", missing: [] }], deferred: [] }));

    const input = readCoverageFormInput(dir);
    const prior = readCoverageForm(dir).rows;
    const resumed = unionCoverageForm({ rows: prior }, { rows: null }, input);
    const block = resumed.form.rows.find((r) => r.kind === "block");
    assert.equal(block.total_hits, 41209, "the FACT is regenerated from the fresh band…");
    assert.equal(block.status, "coverage-limited", "…and the RULING over the discarded one survives it");
    assert.match(block.reason, /6,862 hits/,
      "the reason a lawyer reads still describes a band six times smaller than the one the run searched");
    assert.equal(resumed.outstanding, 0, "and the row counts as work already done");
    assert.deepEqual(findCoverageFormViolations(resumed.form.rows), [],
      "so the gate has nothing to refuse and the resumed digest never re-rules the slice");
  } finally { cleanup(dir); }
});

test("THE FIX: parking the accumulator makes the resumed run re-rule the slice", () => {
  const dir = runDir();
  try {
    armCoverageForm(dir);
    settleOverCurrentBand(dir, "6,862 hits; LUMENN unenumerated within the budget for this pass");
    const P = paths(dir);

    // The park, with the form in its artifact list.
    for (const f of taintParkJudgmentArtifacts(P, dir)) if (existsSync(f)) renameSync(f, `${f}.tainted-1`);
    rmSync(driverDir(dir, "plan-execution.json"), { force: true });
    assert.equal(readCoverageForm(dir).present, false, "the accumulator is gone from the live path…");
    assert.ok(existsSync(driverDir(dir, "register-coverage-form.form.json.tainted-1")),
      "…and preserved for forensics, never deleted");
    assert.equal(coverageFormStamp(dir).required, true,
      "the STAMP stays: a stamp with no form is coverage_form_missing, which is the fail-closed direction");

    setBand(dir, FRESH_BAND);
    writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({
      skeleton: [{ axis: "primary-sweep", state: "incomplete", missing: [] }], deferred: [] }));

    const input = readCoverageFormInput(dir);
    const resumed = unionCoverageForm({ rows: readCoverageForm(dir).rows }, { rows: null }, input);
    const block = resumed.form.rows.find((r) => r.kind === "block");
    assert.equal(block.total_hits, 41209);
    assert.equal(block.status, null, "the ruling over the discarded band did NOT survive");
    assert.equal(block.reason, null, "nor the sentence quoting its size");
    assert.ok(resumed.outstanding > 0);
    assert.ok(findCoverageFormViolations(resumed.form.rows).some((v) => v.row === block.row_id),
      "the resumed digest is made to rule the slice again — which is what the park is for");
  } finally { cleanup(dir); }
});

test("the park's artifact list NAMES the form, both copies, under the stamped form name", () => {
  // The park has no harness that can drive it, so the list it iterates is exported and asserted here.
  // The failure mode is an artifact quietly missing from it, which shows up only as a resumed digest
  // that skipped a re-ruling — an absence, and absences are what this repo refuses to read as passes.
  const dir = runDir();
  try {
    armCoverageForm(dir);
    const P = paths(dir);
    const list = taintParkJudgmentArtifacts(P, dir);
    assert.deepEqual(list, [
      P.registerFindings,
      P.registerCoverageLedger,
      coverageFormPaths(dir).seat,
      coverageFormPaths(dir).sidecar,
    ]);
    // The name comes from the ERA STAMP, not the default — a run whose form_path differed must not leak.
    writeFileSync(driverDir(dir, "coverage-enum.json"), JSON.stringify({
      statuses: ["confirmed-clean", "coverage-limited", "deferred"],
      form_required: true, form_path: "register-coverage-form.v2.json" }));
    const renamed = taintParkJudgmentArtifacts(P, dir);
    assert.ok(renamed[2].endsWith("register-coverage-form.v2.json"));
    assert.ok(renamed[3].endsWith("_driver/register-coverage-form.v2.form.json"));
  } finally { cleanup(dir); }
});
