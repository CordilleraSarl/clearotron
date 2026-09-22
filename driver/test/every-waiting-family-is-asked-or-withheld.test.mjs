// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY WAITING FAMILY IS ASKED OR WITHHELD, AND THE REASON REACHES THE AUDIT WORKBOOK, NOT THE REPORT.
//
// On a delivered run 156 register families waited for the reading turn and it asked 2; nothing recorded
// the rest, and the turn's one stated reason sat in its prose note, where nothing reads it. Ruled: the
// reading turn records each family it leaves unasked as withheld-by-judgment with its reason; the
// coverage form carries a row per waiting family; a family nobody judged holds up delivery; and the
// reason goes in the run record and the audit workbook, never in the report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { compileRegisterPlan, joinPlanToBands, deriveCoverageSkeleton, awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { recordWithheldFamilies, readWithheldFamilies } from "../withheld-families.mjs";
import { coverageFormRows, findCoverageFormViolations, formLedgerRows, renderCoverageLedgerJsonFromForm,
  renderCoverageLedgerSection, coverageFormBrief } from "../coverage-form.mjs";
import { unionCoverageForm } from "../coverage-union.mjs";
import { coverageFormPaths, coverageFormInput } from "../coverage-form-io.mjs";
import { STAGES } from "../stages.mjs";

const MARK = "VELTRIS";
const manifest = {
  schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }, { value: "VELTRISS", category: "spelling" },
    { value: "WELTRIS", category: "sound-alike" }, { value: "VELTRIS PRO", category: "compound" }],
  incumbent_classes: ["9"], goods_words: ["software"],
};
const plan = compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9", "42"], jurisdictions: ["US", "EU"] },
  capabilities: PROVIDER_CAPABILITIES.signa });
const bands = {};
for (const e of plan.entries) {
  if (awaitsReadingTurn(e.when) || e.unsupported) continue;
  (bands[e.axis] ??= []).push({ qid: e.qid, state: "enumerated", records: [], total_hits: 0 });
}
const receipt = joinPlanToBands(plan, bands);
const AXIS = "primary-sweep";
const waiting = receipt.awaiting.filter((f) => f.axis === AXIS);

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "withheld-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify(plan));
  return dir;
}
const REASON = "The identical mark and its close spellings were read in full; these wider spellings add nothing the client's goods make likely.";
const skeleton = deriveCoverageSkeleton(plan, receipt);
const input = (withheld) => ({ skeleton, plan, awaiting: receipt.awaiting, withheld });

test("the reading turn records a waiting family as withheld, with its reason, and is told what is left", () => {
  assert.ok(waiting.length >= 2, `only ${waiting.length} waiting families compiled on ${AXIS} — this arm asserts over too few`);
  const dir = runDir();
  try {
    const r = recordWithheldFamilies(dir, { axis: AXIS, families: [{ qids: [waiting[0].qid], reason: REASON }] });
    assert.deepEqual(r.recorded, [waiting[0].qid]);
    assert.equal(r.still_to_judge.length, waiting.length - 1);
    assert.ok(!r.still_to_judge.includes(waiting[0].qid));
    assert.deepEqual(readWithheldFamilies(dir)[waiting[0].qid], { axis: AXIS, reason: REASON });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("it refuses what is not a waiting family of its axis, and a reason in the engine's words", () => {
  const dir = runDir();
  try {
    const ran = plan.entries.find((e) => e.axis === AXIS && !awaitsReadingTurn(e.when));
    const r = recordWithheldFamilies(dir, { axis: AXIS, families: [
      { qids: [ran.qid], reason: REASON },
      { qids: [waiting[0].qid], reason: "left out of the primary-sweep" },
      { qids: [waiting[1].qid], reason: "" },
    ] });
    assert.deepEqual(r.recorded, []);
    assert.deepEqual(r.rejected.map((x) => x.qid), [ran.qid, waiting[0].qid, waiting[1].qid]);
    assert.match(r.rejected[0].issue, /not a waiting family/);
    assert.match(r.rejected[1].issue, /primary-sweep/);
    assert.deepEqual(readWithheldFamilies(dir), {}, "a refused call wrote a record");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the form carries a row per waiting family: settled where the turn judged it, owed where nobody did", () => {
  const { rows } = coverageFormRows(input({ [waiting[0].qid]: { axis: AXIS, reason: REASON } }));
  const family = rows.filter((r) => r.kind === "family");
  assert.equal(family.length, receipt.awaiting.length, "not one row per waiting family");
  const judged = family.find((r) => r.qid === waiting[0].qid);
  assert.equal(judged.status, "withheld-by-judgment");
  assert.equal(judged.reason, REASON);
  const owed = findCoverageFormViolations(family);
  assert.equal(owed.length, family.length - 1, "the judged family is refused, or an unjudged one passes");
  assert.ok(owed.every((v) => v.reason === "no_status"));
  // THE CONTROL on the status: a waiting family never ran, so no other status judges it.
  for (const status of ["deferred", "coverage-limited", "confirmed-clean"])
    assert.equal(findCoverageFormViolations([{ ...judged, status }]).length, 1, `a family row settled as ${status}`);
});

test("the form the driver builds from the run carries the receipt's waiting families and the turn's record", () => {
  const dir = runDir();
  try {
    writeFileSync(driverDir(dir, "plan-execution.json"), JSON.stringify({ ...receipt, skeleton }));
    recordWithheldFamilies(dir, { axis: AXIS, families: [{ qids: [waiting[0].qid], reason: REASON }] });
    const { input: built } = coverageFormInput(dir);
    const family = coverageFormRows(built).rows.filter((r) => r.kind === "family");
    assert.equal(family.length, receipt.awaiting.length);
    assert.equal(family.find((r) => r.qid === waiting[0].qid)?.status, "withheld-by-judgment");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the turn's judgment survives the union, and the digest may still re-judge it", () => {
  const withheld = { [waiting[0].qid]: { axis: AXIS, reason: REASON } };
  const u = unionCoverageForm({ rows: [] }, { rows: null }, input(withheld));
  const row = u.form.rows.find((r) => r.qid === waiting[0].qid);
  assert.equal(row.status, "withheld-by-judgment", "the union dropped the reading turn's judgment");
  const again = unionCoverageForm({ rows: u.form.rows }, { rows: [{ row_id: row.row_id, status: "withheld-by-judgment", reason: "A second reason." }] }, input(withheld));
  assert.equal(again.form.rows.find((r) => r.qid === waiting[0].qid).reason, "A second reason.");
});

test("a family's reason is kept out of everything the report is built from", () => {
  const { rows } = coverageFormRows(input({ [waiting[0].qid]: { axis: AXIS, reason: REASON } }));
  assert.ok(!formLedgerRows(rows).some((r) => r.reason === REASON));
  assert.ok(!renderCoverageLedgerJsonFromForm(rows).includes(REASON));
  assert.ok(!renderCoverageLedgerSection(rows).includes(REASON));
  // The digest is shown the row and why it is there.
  assert.match(coverageFormBrief({ rows }), /A `family` row is a waiting family the reading turn did not ask/);
});

test("the audit workbook's coverage sheet carries the withheld family and its reason", async () => {
  const { withheldFamilyRows } = await import("../publish/index.mjs");
  const dir = runDir();
  try {
    const { rows } = coverageFormRows(input({ [waiting[0].qid]: { axis: AXIS, reason: REASON } }));
    writeFileSync(coverageFormPaths(dir).sidecar, JSON.stringify({ rows }));
    const out = withheldFamilyRows(dir);
    assert.equal(out.length, 1);
    assert.equal(out[0].note, REASON);
    assert.equal(out[0].state, "not-searched");
    assert.match(out[0].area, /^main register sweep \/ /, "the area is not the driver's reader label");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the reading turn is told to record the waiting families it does not ask", () => {
  const P = { variantManifest: "vm.json", matterContext: "mc.md", registerBand: (a) => `band-${a}.json`,
    registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" };
  const msg = STAGES["register-unit"].message({ paths: P, axis: AXIS, job: { classes: [9, 42] }, registerPlan: plan });
  assert.match(msg, /RECORD EVERY ONE YOU DO NOT ASK with `record_withheld_families`/);
});
