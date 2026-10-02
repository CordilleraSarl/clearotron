// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE MISSING-FORM BRANCH FAILS CLOSED, and it is the one thing gets wrong.
//
// The meaning-sweep form's reader returns `{rows: null, error: null}` when its `_driver/` sidecar does
// not exist (verify.dispositionForm), and findConnotationViolations returns no violations over a null
// form (connotation-search.mjs `if (form == null) return violations;`). So with the era stamp saying a
// form was REQUIRED and the form absent, the validator finds nothing to judge and the stage PASSES —
// byte-for-byte indistinguishable from a fully ruled form. It is reachable: this repo's own rules record
// that a full disk fails as "artifact absent", not as a disk error, and the only write is best-effort.
//
// The register form must not reproduce that shape. Code writes and settles it now (pipeline.mjs,
// settleCoverageFromFacts — the register digest that used to rule it is gone), so every state below is a
// DRIVER bug, and step 3 fails on it by name (coverage-form-io.mjs, stampedFormFault) rather than handing
// every gate a run with no coverage gaps.
//
// THREE STATES, AND THEY ARE NOT THE SAME FACT. This file pins all three, plus the write ORDER that makes
// the first reachable at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import {
  armCoverageForm, armCoverageEnumOnly, coverageFormStamp, coverageFormPaths,
  readCoverageForm, readCoverageFormInput, writeCoverageForm, stampedFormFault, COVERAGE_FORM_NAME,
} from "../coverage-form-io.mjs";
import { unionCoverageForm } from "../coverage-union.mjs";
import { coerceToolAbsenceDeferred } from "../coverage-ledger.mjs";
import { coverageFormSidecarName, settleCoverageRowsFromFacts, buildCoverageAbsenceForm } from "../coverage-form.mjs";

// A preserved-shape run dir: the driver-written sidecars a fresh plan-mode run carries, with every mark,
// owner and qid replaced by invented tokens (this repo is de-identified by design).

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "cov-form-"));
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(join(dir, "register-units", "primary-sweep.md"), "# unit\n");
  writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({
    skeleton: [{ axis: "primary-sweep", state: "incomplete", missing: [] }],
    deferred: [],
  }));
  writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify({
    entries: [{ qid: "ps:stack:lumen+form", axis: "primary-sweep", predicate: "exact",
      terms: ["LUMEN", "LUMENN"], nice_classes: ["9"], expected_kind: "enumerate" }],
  }));
  writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), JSON.stringify([
    { state: "incomplete", qid: "ps:stack:lumen+form", total_hits: 6862,
      term_counts: { LUMEN: { disposition: "crowd" }, LUMENN: { disposition: "unenumerated" } } },
  ]));
  return dir;
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test("NOT ARMED: no era stamp ⇒ no fault — an archived run is judged exactly as it always was", () => {
  const dir = runDir();
  try {
    assert.equal(coverageFormStamp(dir).required, false);
    assert.equal(stampedFormFault(dir), null);
    // …and a pre-change sentinel (the off-enum arm alone) is still not a form stamp.
    armCoverageEnumOnly(dir);
    assert.equal(coverageFormStamp(dir).required, false);
    assert.equal(stampedFormFault(dir), null);
  } finally { cleanup(dir); }
});

test("ARMED + ABSENT: the driver did not write what it stamped ⇒ a fault, named as a driver bug", () => {
  const dir = runDir();
  try {
    armCoverageForm(dir);
    const fault = stampedFormFault(dir);
    assert.match(String(fault), /^coverage_form_missing:/, "an absent required form must NEVER read as a run with no gaps");
    assert.match(fault, /driver-written — this is a bug, not a model defect/);
    assert.ok(fault.includes(coverageFormSidecarName(COVERAGE_FORM_NAME)), "the fault names the file");
  } finally { cleanup(dir); }
});

test("THE WRITE ORDER: the stamp lands BEFORE the form, so a failed form write fails CLOSED", () => {
  // Get this backwards and a failed form write leaves no stamp, the check never arms, and the run passes
  // having settled nothing — the shape rebuilt. armCoverageForm is a separate call precisely so the
  // failure mode is "stamp present, form absent". And the pipeline arms before it settles.
  const dir = runDir();
  try {
    armCoverageForm(dir);
    assert.equal(coverageFormStamp(dir).required, true);
    assert.equal(readCoverageForm(dir).present, false, "nothing written yet");
    assert.match(String(stampedFormFault(dir)), /coverage_form_missing/, "and the check is already armed against the absence");
  } finally { cleanup(dir); }
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const settle = src.slice(src.indexOf("function settleCoverageFromFacts("));
  assert.ok(settle.indexOf("armCoverageForm(P.runDir)") >= 0
    && settle.indexOf("armCoverageForm(P.runDir)") < settle.indexOf("writeCoverageForm(P.runDir"), "the settle arms the stamp before it writes the form");
  assert.match(src, /const formFault = stampedFormFault\(P\.runDir\);\s*if \(formFault\)/, "and step 3 fails on the fault");
});

test("ARMED + DAMAGED: present and unusable is a NAMED fault, never read as absent", () => {
  const dir = runDir();
  try {
    armCoverageForm(dir);
    writeFileSync(coverageFormPaths(dir).sidecar, "{ not json");
    const fault = stampedFormFault(dir);
    assert.match(String(fault), /^coverage_form_damaged:/);
    // reading it as absent would silently drop every status in it
    assert.ok(!/coverage_form_missing/.test(fault));
  } finally { cleanup(dir); }
});

test("ARMED + EMPTY: a stamped form carrying NO rows is an ABSENCE of coverage, not a complete one", () => {
  // ASK WHAT THE ZERO MEANS. `readCoverageFormInput` accepts a `skeleton: []` receipt and an
  // `entries: []` plan, so a run that executed nothing gets a stamp and a form with no obligations. Zero
  // rows would read as COMPLETE COVERAGE to every gate below.
  const dir = runDir();
  try {
    writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({ skeleton: [], deferred: [] }));
    writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify({ entries: [] }));
    rmSync(join(dir, "register-units"), { recursive: true, force: true });
    const input = readCoverageFormInput(dir);
    assert.notEqual(input, null, "the input is READABLE — this is not the no-plan-in-reach case");
    armCoverageForm(dir);
    const u = unionCoverageForm(null, null, input);
    assert.equal(u.form.rows.length, 0, "and it legitimately builds a form with no rows");
    writeCoverageForm(dir, u.form);
    assert.match(String(stampedFormFault(dir)), /^coverage_form_empty:/);
  } finally { cleanup(dir); }
});

test("an empty form that DECLARES why it is empty is no fault — the absence is disclosed instead", () => {
  // No plan apparatus in reach (an experiment sandbox without the plan, a resume that did not copy it):
  // the settle writes a form that names its cause from the closed vocabulary, and delivery discloses it
  // (coverageAbsenceGaps). An empty form wearing a made-up cause is still a fault.
  const dir = runDir();
  try {
    rmSync(driverDir(dir, "register-plan.json"), { force: true });
    assert.equal(readCoverageFormInput(dir), null);
    armCoverageForm(dir);
    writeCoverageForm(dir, buildCoverageAbsenceForm({ cause: "no_frozen_plan" }));
    assert.equal(stampedFormFault(dir), null);
    writeCoverageForm(dir, { rows: [], absence: { cause: "a cause nobody wrote down" } });
    assert.match(String(stampedFormFault(dir)), /^coverage_form_empty:/);
  } finally { cleanup(dir); }
});

test("a torn band keeps its AXIS row, and code never settles that axis clean", () => {
  // The block rows go with the band, but the axis row stays — so the gap is a row, not a silent zero. An
  // absence is a finding, and this is where it is recorded.
  const dir = runDir();
  try {
    writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), "{ torn");
    const { form } = unionCoverageForm(null, null, readCoverageFormInput(dir));
    assert.deepEqual(form.generated_from.bands_unreadable, ["primary-sweep"]);
    assert.equal(form.rows.filter((r) => r.kind === "block").length, 0);
    const settled = settleCoverageRowsFromFacts(form.rows, { bandsUnreadable: form.generated_from.bands_unreadable });
    const axisRow = settled.find((r) => r.kind === "axis" && r.axis === "primary-sweep");
    assert.ok(axisRow, "the axis whose band would not parse keeps its row");
    assert.equal(axisRow.status, "deferred", "a band the run could not read is not a clean");
  } finally { cleanup(dir); }
});

// ── THE FUNNEL: driver-side rows reproduced from a preserved artifact ───────────────────────────────
test("FUNNEL: plan-execution + plan + band → the exact rows the gate judges, with no model in the loop", () => {
  const dir = runDir();
  try {
    const input = readCoverageFormInput(dir);
    assert.deepEqual(input.skeleton.map((s) => s.axis), ["primary-sweep"]);
    assert.equal(input.plan.entries.length, 1);
    assert.equal(input.bandBlocksByAxis["primary-sweep"].length, 1);
    assert.deepEqual(input.bandsUnreadable, []);
    assert.deepEqual(input.activeAxes, ["primary-sweep"]);
    const { form } = unionCoverageForm(null, null, input);
    assert.deepEqual(form.rows.map((r) => `${r.kind}:${r.qid ?? r.axis}`),
      ["axis:primary-sweep", "block:ps:stack:lumen+form"]);
    const block = form.rows[1];
    assert.equal(block.total_hits, 6862, "read off the band, never typed");
    assert.deepEqual(block.unaccounted_terms, ["LUMEN", "LUMENN"], "LUMEN is itself a crowd: counted, never read");
    assert.match(block.unit, /^primary-sweep \/ exact: LUMEN OR LUMENN \[cl 9\]$/);
    // Whole-object, deliberately: the receipt is the record of what the form was derived from, and a
    // field appearing or vanishing unnoticed is drift in exactly the artifact that exists to prevent it.
    // `deferred_offices` joined in — offices this deployment could not reach, counted separately
    // from `deferred_qids` because the two shapes have different repairs. Zero here: this fixture's plan
    // carries no `deferred_coverage`.
    assert.deepEqual(form.generated_from, { skeleton_axes: ["primary-sweep"], plan_entries: 1,
      open_blocks: 1, deferred_qids: 0, deferred_offices: 0, bands_unreadable: [] });
  } finally { cleanup(dir); }
});

test("a SATURATION reason is never relabelled `deferred` — the clamp is not applied behind the seat", () => {
  // The status on a block row is not cosmetic: decideRegisterGap clamps the verdict CLEAR→CONDITIONAL on
  // `deferred` rows and leaves `coverage-limited` alone. Block rows are `open` now, so EVERY open crowd
  // block contributes a row to the ledger every downstream gate reads — which makes it newly worth
  // proving that the coerceToolAbsenceDeferred backstop cannot turn an honest saturation ruling into a
  // deferral and clamp a run that should ship CLEAR. Its regexes are anchored to access/tool nouns; a
  // crowd that ran and saturated matches none of them.
  const rows = [
    { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / exact: LUMEN OR LUMENN",
      reason: "6,862 hits; the OR-stack saturated and LUMENN was not individually enumerated" },
    { axis: "primary-sweep", status: "coverage-limited", unit: "primary-sweep / owner",
      reason: "the slice could not reach the provider — register provider error" },
  ];
  const out = coerceToolAbsenceDeferred(rows);
  assert.equal(out[0].status, "coverage-limited", "a saturated crowd stays coverage-limited and does NOT clamp");
  assert.equal(out[1].status, "deferred", "a genuine could-not-reach gap still relabels — the backstop is intact");
});
