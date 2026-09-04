// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE MISSING-FORM BRANCH FAILS CLOSED, and it is the one thing gets wrong.
//
// The meaning-sweep form's reader returns `{rows: null, error: null}` when its `_driver/` sidecar does
// not exist (verify.dispositionForm), and findConnotationViolations returns no violations over a null
// form (connotation-search.mjs `if (form == null) return violations;`). So with the era stamp saying a
// form was REQUIRED and the form absent, the validator finds nothing to judge and the stage PASSES —
// byte-for-byte indistinguishable from a fully ruled form. The doc block calls it safe because "no fresh
// run can reach delivery in this state", which is an assertion about the driver always writing the file,
// not a gate. It is reachable: this repo's own rules record that a full disk fails as "artifact absent",
// not as a disk error, and the only write is best-effort with a note().
//
// The register form must not reproduce that shape. The precedent it copies instead is one file over —
// verify.mjs's grid_spec_unreadable / grid_ledger_missing: when the DRIVER-written artifact is required
// and absent, fail, and name it a driver bug.
//
// THREE STATES, AND THEY ARE NOT THE SAME FACT. This file pins all three, plus the write ORDER that makes
// the third reachable at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { validators } from "../verify.mjs";
import {
  armCoverageForm, armCoverageEnumOnly, coverageFormStamp, coverageFormPaths,
  readCoverageForm, readCoverageFormInput, writeCoverageForm, COVERAGE_FORM_NAME,
} from "../coverage-form-io.mjs";
import { unionCoverageForm } from "../coverage-union.mjs";
import { coerceToolAbsenceDeferred } from "../coverage-ledger.mjs";
import { coverageFormSidecarName, findCoverageFormViolations } from "../coverage-form.mjs";
import { STAGES, paths } from "../stages.mjs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A preserved-shape run dir: the driver-written sidecars a fresh plan-mode run carries, with every mark,
// owner and qid replaced by invented tokens (this repo is de-identified by design).
const FINDINGS = "# Register findings\n\n## Findings — Mark: LUMEN\n\nbody text long enough to pass the "
  + "non-empty floor, with a negative results matrix and an audit trail below it.\n\n### Negative results\n"
  + "| Mark | Variant | Result | Notes |\n|---|---|---|---|\n| LUMEN | exact | 0 hits | clean |\n";

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "cov-form-"));
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(join(dir, "register-findings.md"), FINDINGS);
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
// The prose `## Coverage ledger` an UNSTAMPED run owes — the table the seat writes when there is no
// form. Its rows disclose the open block by qid, which is what the restored prose join joins on.
const LEDGER = "\n## Coverage ledger\n\n| Coverage unit | Status | Reason |\n|---|---|---|\n"
  + "| primary-sweep / exact: LUMEN OR LUMENN | coverage-limited | ps:stack:lumen+form saturated; LUMENN never enumerated |\n";

const judge = (dir) => validators.registerFindings(join(dir, "register-findings.md"), readFileSync(join(dir, "register-findings.md"), "utf8"));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

test("NOT ARMED: no era stamp ⇒ the PRE-#476 floor applies, unchanged and undeleted", () => {
  // THE RULE THIS PINS: never delete a floor unconditionally while its replacement is conditional.
  // The form arm is off here — but the structural `## Coverage ledger` requirement is NOT, because the
  // old floor and the new gate are armed by the SAME condition. The first cut of this build dropped the
  // structural check outright while arming the form only when the plan apparatus was in reach, so a run
  // in exactly this state passed with no coverage judgement of any kind and `deriveCoverageStatus([])`
  // answered `{complete: true}` downstream.
  const dir = runDir();
  try {
    assert.equal(coverageFormStamp(dir).required, false);
    const v = judge(dir);
    assert.equal(v.ok, false, "no form AND no prose table is an ABSENCE of coverage, never a pass");
    assert.match(v.reason, /findings\+ledger/);
    // …and a pre- sentinel (the D1 off-enum arm alone) is still not a form stamp, so the floor holds.
    armCoverageEnumOnly(dir);
    assert.equal(coverageFormStamp(dir).required, false);
    assert.equal(judge(dir).ok, false);
    // The seat writing the table it is told to write on an unstamped run is what clears it — exactly as
    // before. An ARCHIVED run judges byte-for-byte as it always did; the replay corpus is the proof.
    writeFileSync(join(dir, "register-findings.md"), FINDINGS + LEDGER);
    assert.equal(judge(dir).ok, true);
  } finally { cleanup(dir); }
});

test("#850 M6 — THE DISPATCH HAS NO SECOND ARM, and the driver arms before it dispatches", () => {
  // WHAT THIS REPLACED, AND WHY THE REPLACEMENT IS NOT WEAKER. Until M6 this asserted the opposite of
  // its own second half: an UNARMED run's dispatch told the seat "the ## Coverage ledger table in your
  // findings is yours to write", because the validator's unstamped arm demanded that table. One stamp,
  // two instructions — and inside the unarmed one, 's whole correction was reversed: a
  // model-authored markdown table was the source of truth every coverage gate read.
  //
  // M6 deleted the dispatch's second arm, not the validator's. The validator still demands the prose
  // table on an unstamped run, and that is deliberate and load-bearing: an ARCHIVED pre- run
  // carries no stamp at all, and changing what it judges to would mutate replay verdicts that people
  // quote. So the asymmetry this test used to pin is real — and UNREACHABLE on a live run, because
  // arming and dispatching are gated on the same `willRun` and the arm runs first. That is what is
  // asserted now: the instruction is unconditional, and the ordering that makes it safe is read out of
  // the source rather than assumed.
  const dir = runDir();
  try {
    const P = paths(dir);
    const unstamped = STAGES["register-digest"].message({ paths: P, axes: ["primary-sweep"], registerOnly: true });
    armCoverageForm(dir);
    const stamped = STAGES["register-digest"].message({ paths: P, axes: ["primary-sweep"], registerOnly: true });

    for (const [name, msg] of [["unstamped", unstamped], ["stamped", stamped]]) {
      assert.match(msg, /do NOT write a ## Coverage ledger table/, `${name}: the seat is never told to author the table`);
      assert.doesNotMatch(msg, /yours to write/, `${name}: the retired instruction is gone from both`);
      // Typed transport: the dispatch names the TOOL, never a coverage file — the seat holds no pen on
      // any coverage artifact, and a named file would re-teach the dead seat-facing copy.
      assert.match(msg, /record_coverage/, `${name}: and the recording route is named either way`);
      assert.doesNotMatch(msg, /register-coverage-form\.json/, `${name}: no coverage file is named to the seat`);
    }
    assert.equal(unstamped, stamped, "there is ONE instruction now — the stamp no longer forks the dispatch");

    // THE ORDERING IS THE SAFETY, so it is asserted against the source and not left to a comment. If a
    // future edit dispatches the digest without arming first, the unstamped validator arm becomes
    // reachable on a live run and the seat is handed an unclearable contract.
    const src = readFileSync(join(ROOT, "pipeline.mjs"), "utf8");
    const arm = src.indexOf("armCoverageForm(P.runDir);");
    const gate = src.lastIndexOf("if (willRun) {", arm);
    assert.ok(gate >= 0 && arm > gate, "armCoverageForm runs inside the same willRun gate that dispatches the digest");
  } finally { cleanup(dir); }
});

test("ARMED + EMPTY: a stamped form carrying NO rows is an ABSENCE of judgement, not a complete one", () => {
  // ASK WHAT THE ZERO MEANS. `readCoverageFormInput` accepts a `skeleton: []` receipt and an
  // `entries: []` plan, so a run that executed nothing gets a stamp and a form with no obligations.
  // findCoverageFormViolations([]) is [], formLedgerRows([]) is [], and `[]` is not nullish — so the
  // prose fallback never engages, every gate below sees no rows, and `deriveCoverageStatus([])` returns
  // `{complete: true}`. Zero rows read as COMPLETE COVERAGE on the validator whose job is coverage
  // honesty. That is `{rows: null, error: null}` one step over: the exact shape this build set out to
  // refuse, reproduced inside the artifact meant to replace it.
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
    const v = judge(dir);
    assert.equal(v.ok, false, "an empty required form must NEVER read as complete coverage");
    assert.match(v.reason, /^coverage_form_empty:/);
    assert.match(v.reason, /driver-written — this is a bug, not a model defect/);
  } finally { cleanup(dir); }
});

test("ARMED + ABSENT: the driver did not write what it stamped ⇒ FAIL, named as a driver bug", () => {
  const dir = runDir();
  try {
    armCoverageForm(dir);
    const v = judge(dir);
    assert.equal(v.ok, false, "an absent required form must NEVER read as a pass — this is #460's blocker");
    assert.match(v.reason, /^coverage_form_missing:/);
    assert.match(v.reason, /driver-written — this is a bug, not a model defect/);
    assert.match(v.reason, new RegExp(coverageFormSidecarName(COVERAGE_FORM_NAME).replace(/\./g, "\\.")));
  } finally { cleanup(dir); }
});

test("the absent form and the fully settled form are DISTINGUISHABLE — the probe #460 fails", () => {
  // Run the exact three-way probe that exposes the meaning-sweep hole, against this gate.
  const dir = runDir();
  try {
    armCoverageForm(dir);
    const absent = judge(dir);
    const u = unionCoverageForm(null, null, readCoverageFormInput(dir));
    writeCoverageForm(dir, u.form);
    const unfilled = judge(dir);
    const settled = unionCoverageForm(null, { rows: u.form.rows.map((r) =>
      ({ ...r, status: r.open ? "deferred" : "coverage-limited", reason: "judged" })) }, readCoverageFormInput(dir));
    writeCoverageForm(dir, settled.form);
    const filled = judge(dir);
    assert.equal(absent.ok, false);
    assert.equal(unfilled.ok, false);
    assert.equal(filled.ok, true);
    assert.notEqual(absent.reason, unfilled.reason, "absent and unfilled are different facts and say so");
    assert.match(absent.reason, /coverage_form_missing/);
    assert.match(unfilled.reason, /coverage_no_status:no_status=/);
  } finally { cleanup(dir); }
});

test("ARMED + DAMAGED: present and unusable is a NAMED defect, never read as absent", () => {
  const dir = runDir();
  try {
    armCoverageForm(dir);
    writeFileSync(coverageFormPaths(dir).sidecar, "{ not json");
    const v = judge(dir);
    assert.equal(v.ok, false);
    assert.match(v.reason, /^coverage_form_damaged:form_damaged=1;/);
    assert.equal(v.quantity, 1, "the validator's own exact count rides as `quantity` (#246)");
    // reading it as absent would silently drop every status in it — the placements.json rule
    assert.ok(!/coverage_form_missing/.test(v.reason));
  } finally { cleanup(dir); }
});

test("THE WRITE ORDER: the stamp lands BEFORE the form, so a failed form write fails CLOSED", () => {
  // Get this backwards and a failed form write leaves no stamp, the gate never arms, and the run passes
  // having judged nothing — 's shape rebuilt. armCoverageForm is a separate call precisely so the
  // failure mode is "stamp present, form absent".
  const dir = runDir();
  try {
    armCoverageForm(dir);
    assert.equal(coverageFormStamp(dir).required, true);
    assert.equal(readCoverageForm(dir).present, false, "nothing written yet");
    assert.equal(judge(dir).ok, false, "and the gate is already armed against the absence");
  } finally { cleanup(dir); }
});

test("the stamp cannot be forged or deleted into a pass: the era arm reads `_driver/`, the seat writes the run root", () => {
  const dir = runDir();
  try {
    armCoverageForm(dir);
    const u = unionCoverageForm(null, { rows: [] }, readCoverageFormInput(dir));
    const filled = unionCoverageForm(null, { rows: u.form.rows.map((r) =>
      ({ ...r, status: r.open ? "deferred" : "coverage-limited", reason: "judged" })) }, readCoverageFormInput(dir));
    writeCoverageForm(dir, filled.form);
    assert.equal(judge(dir).ok, true);
    // A seat that deletes its own copy loses nothing and disarms nothing.
    rmSync(coverageFormPaths(dir).seat, { force: true });
    assert.equal(judge(dir).ok, true, "the gate reads the driver's copy");
    // A seat that rewrites its own copy to say everything is clean changes nothing either: the union is
    // what moves the driver's copy, and it re-stamps every driver field first.
    writeFileSync(coverageFormPaths(dir).seat, JSON.stringify({ rows: [] }));
    assert.equal(judge(dir).ok, true);
    // Only removing the DRIVER's copy changes the verdict — and it changes it to a refusal.
    rmSync(coverageFormPaths(dir).sidecar, { force: true });
    assert.match(judge(dir).reason, /coverage_form_missing/);
  } finally { cleanup(dir); }
});

test("no plan apparatus in reach ⇒ no form — and the PROSE floor carries the run instead", () => {
  // The condition the gate this replaces was inactive in (verify.mjs's outer plan-execution guard and its
  // `no plan in reach` catch). It is reachable on a LIVE run — an --experiment shadow arm whose sandbox
  // lacks the plan, a resume that did not copy it, a torn write — and this test used to assert
  // `judge(dir).ok === true` over findings carrying no coverage ledger at all, with the comment "NOT a
  // hole: nothing was stamped, so nothing is owed". Nothing was stamped and EVERYTHING is still owed:
  // the run has an unaccounted crowd block of 6,862 hits in its own band. What is not owed is a FORM.
  const dir = runDir();
  try {
    rmSync(driverDir(dir, "register-plan.json"), { force: true });
    assert.equal(readCoverageFormInput(dir), null);
    assert.equal(coverageFormStamp(dir).required, false, "no form is required");
    assert.equal(judge(dir).ok, false, "and coverage is still owed — as a prose table");
    assert.match(judge(dir).reason, /findings\+ledger/);
    writeFileSync(join(dir, "register-findings.md"), FINDINGS + LEDGER);
    assert.equal(judge(dir).ok, true, "the pre-#476 path, unchanged");
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
    assert.deepEqual(block.unaccounted_terms, ["LUMENN"]);
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

test("FUNNEL: an unreadable band is recorded on the form and its axis contributes no block row", () => {
  const dir = runDir();
  try {
    writeFileSync(join(dir, "register-units", "primary-sweep-band.json"), "{ torn");
    const input = readCoverageFormInput(dir);
    assert.deepEqual(input.bandsUnreadable, ["primary-sweep"]);
    const { form } = unionCoverageForm(null, null, input);
    assert.deepEqual(form.generated_from.bands_unreadable, ["primary-sweep"]);
    assert.equal(form.rows.filter((r) => r.kind === "block").length, 0);
    // THE AXIS STILL OWNS A ROW. This used to assert that the band file still existed on disk — which the
    // test had written six lines earlier and which nothing in this path deletes, so it could not fail.
    // The property actually worth pinning is that a torn band does not make its AXIS disappear: the block
    // rows go, but the axis row stays and still owes a status, so the gap is a judgement someone has to
    // make rather than a silent zero. An absence is a finding, and this is where it is recorded.
    const axisRow = form.rows.find((r) => r.kind === "axis" && r.axis === "primary-sweep");
    assert.ok(axisRow, "the axis whose band would not parse keeps its row");
    assert.equal(axisRow.status, null, "unsettled — the gate will demand a judgement over it");
    assert.ok(findCoverageFormViolations(form.rows).some((v) => v.row === axisRow.row_id));
  } finally { cleanup(dir); }
});

test("THE CENSUS PARTITIONS: its terms sum to `quantity`, so a converging run never reads as stuck", () => {
  // repairs.mjs CENSUS_RE accepts comma-joined `<name>=<n>` terms and SUMS them. If the terms overlapped
  // — or if one violation were counted twice — progressQuantity would report more outstanding rows than
  // exist, `progress.kind` would stop tracking, and 's defect (a CONVERGING run reading as stuck)
  // comes back. The partition is what makes the discrimination safe to add.
  const CENSUS_RE = /^((?:[a-z_]+=\d+)(?:,[a-z_]+=\d+)*)(?:[;\s]|$)/;
  const dir = runDir();
  try {
    armCoverageForm(dir);
    const input = readCoverageFormInput(dir);
    const { form } = unionCoverageForm(null, null, input);
    // One row settled honestly, the rest left blank ⇒ a MIXED census, which is the case that can go wrong.
    const mixed = unionCoverageForm(null, { rows: form.rows.map((r, i) => i === 0
      ? { ...r, status: "confirmed-clean", reason: "swept" }        // an axis row: legitimately settled
      : { ...r, status: "confirmed-clean", reason: "swept" }) }, input);   // a block row: open ⇒ open_clean
    writeCoverageForm(dir, mixed.form);
    const v = judge(dir);
    assert.equal(v.ok, false);
    const tail = v.reason.replace(/^coverage_no_status:/, "");
    const census = CENSUS_RE.exec(tail.trim());
    assert.ok(census, `the census must be FIRST and parseable: ${v.reason}`);
    const total = [...census[1].matchAll(/=(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    assert.equal(total, v.quantity, "the census sums to the validator's own exact count");
    assert.match(census[1], /open_clean=1/, "and it names the cause the hint has to lead with");
    // NO PARENTHESES before the overflow — pipeline's merge-gate remedy truncates at the first "(".
    const beforeOverflow = v.reason.replace(/ \(\+\d+ more\)$/, "");
    assert.ok(!beforeOverflow.includes("("), `the token carries no parenthesis before its overflow: ${v.reason}`);
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
