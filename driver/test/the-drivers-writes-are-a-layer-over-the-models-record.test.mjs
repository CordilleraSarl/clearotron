// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the driver's layer over the model's record, on invented records
//
// THE DRIVER'S WRITES ARE A LAYER OVER THE MODEL'S RECORD, APPLIED AGAIN AFTER EVERY ACCEPTED SAVE THAT
// FOLLOWS THEM, IN THE PIPELINE'S ORDER (design, 2026-10-03).
//
// A save changes the model's record and nothing else; findings.json is the driver's writes this pass has
// applied, rebuilt over it after the stage that saved. What is named in the model's numbering joins the
// model's record. The two writes that act on the model's base: the restoration of what a corrective save
// removed unnamed goes into the base, so the next save keeps it; a rollback puts the base back with the
// record, so a failed pass's calls are no base for anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis } from "../synthesis-record.mjs";
import { foldRecord, foldFindingsFile, readFold } from "../record-fold.mjs";
import { openLayer, noteApplied, modelRecordPath, MODEL_RECORD_FILE } from "../record-layer.mjs";
import { reapplyLayer, repairUnnamedRemovals, rollbackCorrectivePass, snapshotFindingsForCorrections } from "../pipeline.mjs";
import { paths } from "../stages.mjs";
import { runLint } from "../predelivery-lint.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
const LONG = "Qorvalen Holdings' earlier VELTRIN would probably win against your mark for software in the European Union "
  + "because the goods overlap, the marks are near and the earlier right is live on the register today too.";

/** A record whose findings are `[owner, mark]` pairs, each on its own registration. */
function record(rows) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, findings: rows.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9100000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    return f;
  }) };
}
// The second finding is a second filing of the first: the same owner and the same mark.
const TWINS = [["Qorvalen Holdings", "VELTRIN"], ["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"]];
const THREE = [["Qorvalen Holdings", "VELTRIN"], ["Selmora Labs", "KESTRIN"], ["Brannick Tooling", "ORVANTE"]];

function run() {
  const dir = mkdtempSync(join(tmpdir(), "layer-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const P = paths(dir);
  return { dir, P, ctx: { paths: P, run: { runDir: dir }, framework: null } };
}
const onDisk = (P) => JSON.parse(readFileSync(P.findings, "utf8"));
const modelRecord = (dir) => JSON.parse(readFileSync(driverDir(dir, MODEL_RECORD_FILE), "utf8"));
/** The fold applied as the seam applies it, through the layer. */
const seamFold = ({ dir, P }) => { foldFindingsFile(dir, P.findings, null); noteApplied(dir, "fold", {}, P.findings); };

test("the fold maps the model's ordinals to the folded ones and back; a record with nothing to fold is left as it came", () => {
  const { doc, merges, map } = foldRecord(record(TWINS));
  assert.equal(merges.length, 1);
  assert.equal(doc.findings.length, 2);
  assert.deepEqual(map.modelToFolded, { 1: 1, 2: 1, 3: 2 });
  assert.deepEqual(map.foldedToModel, { 1: [1, 2], 2: [3] });
  const plain = record(THREE);
  const none = foldRecord(plain);
  assert.equal(none.map, null);
  assert.equal(none.doc, plain);
});

test("a save changes the model's record; the layer is rebuilt over it, and a patch in the model's numbering lands on the right folded finding", () => {
  const r = run();
  try {
    openLayer(r.dir);
    assert.equal(recordSynthesis(r.dir, { narrative: NARRATIVE, findings: record(TWINS) }).refused, null);
    seamFold(r);
    assert.equal(onDisk(r.P).findings.length, 2, "premise: the fold applied");
    const changed = { ...record(TWINS).findings[2], legal_position: "The earlier registration was renewed in the searched class." };
    assert.equal(recordSynthesis(r.dir, { findings_patch: [changed] }).refused, null);
    assert.equal(onDisk(r.P).findings.length, 3, "premise: the save wrote the model's record");
    assert.equal(reapplyLayer(r.ctx), true, "the stage that saved did not rebuild the layer");
    const after = onDisk(r.P);
    assert.equal(after.findings.length, 2, "the save undid the fold");
    assert.equal(after.findings[1].legal_position, changed.legal_position, "the patch did not land on the folded finding it names");
    assert.equal(modelRecord(r.dir).findings.length, 3, "the model's record was folded");
    assert.equal(modelRecordPath(r.dir, r.P.findings), driverDir(r.dir, MODEL_RECORD_FILE));
    assert.deepEqual(readFold(r.dir)?.map?.modelToFolded, { 1: 1, 2: 1, 3: 2 }, "the fold's map is not kept both ways");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a stage that saved nothing leaves the record's bytes alone", () => {
  const r = run();
  try {
    openLayer(r.dir);
    recordSynthesis(r.dir, { narrative: NARRATIVE, findings: record(TWINS) });
    seamFold(r);
    const bytes = readFileSync(r.P.findings, "utf8");
    assert.equal(reapplyLayer(r.ctx), false, "a rebuild ran with no save since the layer last wrote");
    assert.equal(readFileSync(r.P.findings, "utf8"), bytes);
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a pass opens with no write applied: a save before its writes run leaves the model's record", () => {
  const r = run();
  try {
    openLayer(r.dir);
    recordSynthesis(r.dir, { narrative: NARRATIVE, findings: record(TWINS) });
    seamFold(r);   // the earlier pass
    openLayer(r.dir);   // the resumed pass
    recordSynthesis(r.dir, { narrative: NARRATIVE, findings: record(TWINS) });
    assert.equal(reapplyLayer(r.ctx), false);
    assert.equal(onDisk(r.P).findings.length, 3, "a write from the earlier pass was applied before this pass applied it");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("what a corrective save removed unnamed goes back into the model's base, so the next save keeps it", () => {
  const r = run();
  try {
    openLayer(r.dir);
    assert.equal(recordSynthesis(r.dir, { narrative: NARRATIVE, findings: record(THREE) }).refused, null);
    const pre = snapshotFindingsForCorrections(r.P, r.dir);
    // the corrective pass's save leaves out finding 2, and no flag named it
    const doc = record(THREE);
    assert.equal(recordSynthesis(r.dir, { narrative: NARRATIVE, findings: { ...doc, findings: doc.findings.filter((f) => f.ordinal !== 2) } }).refused, null);
    const repaired = repairUnnamedRemovals(r.P, r.dir, pre, [], []);
    assert.deepEqual(repaired?.restoredFindings.map((f) => f.mark), ["KESTRIN"]);
    reapplyLayer(r.ctx, { force: true });
    assert.deepEqual(onDisk(r.P).findings.map((f) => f.mark), ["VELTRIN", "KESTRIN", "ORVANTE"]);
    // the next save is a patch to finding 1: it merges onto the base, which now holds finding 2 again
    const changed = { ...record(THREE).findings[0], legal_position: "The earlier registration was renewed in the searched class." };
    assert.equal(recordSynthesis(r.dir, { findings_patch: [changed] }).refused, null);
    reapplyLayer(r.ctx);
    assert.deepEqual(onDisk(r.P).findings.map((f) => f.mark), ["VELTRIN", "KESTRIN", "ORVANTE"], "the next save dropped what the repair restored");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a rollback puts the patch base back with the record: a later patch does not bring back what the failed pass sent", () => {
  const r = run();
  try {
    openLayer(r.dir);
    assert.equal(recordSynthesis(r.dir, { narrative: NARRATIVE, findings: record(THREE) }).refused, null);
    const pre = snapshotFindingsForCorrections(r.P, r.dir);
    // the corrective pass: one call, refused for a sentence over the cap, which also rewrote finding 1
    const failed = record(THREE);
    failed.findings[0].legal_position = "Text the failed pass wrote and the rollback discards.";
    failed.findings[1].net = LONG;
    assert.match(String(recordSynthesis(r.dir, { narrative: NARRATIVE, findings: failed }).refused), /^synthesis_net_too_long:2 /);
    rollbackCorrectivePass(r.P, r.dir, pre, { fail: "the corrective pass failed" });
    // a later repair patches finding 2
    const repair = { ...record(THREE).findings[1], legal_position: "The earlier registration lapsed in one of the two classes." };
    const later = recordSynthesis(r.dir, { findings_patch: [repair] });
    assert.equal(later.refused, null, String(later.refused));
    const f1 = onDisk(r.P).findings[0];
    assert.notEqual(f1.legal_position, failed.findings[0].legal_position, "the later patch merged onto the failed pass's call");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("a fold that cannot be made leaves the record as it is, and its record says why", () => {
  const r = run();
  try {
    writeFileSync(r.P.findings, "{ not a record");
    const out = foldFindingsFile(r.dir, r.P.findings, null);
    assert.ok(out.error);
    assert.equal(readFileSync(r.P.findings, "utf8"), "{ not a record");
    assert.ok(readFold(r.dir)?.error, "the failure is not on the fold's record");
  } finally { rmSync(r.dir, { recursive: true, force: true }); }
});

test("once the record is folded, the narrative's write-ups are checked against the record the model wrote", () => {
  // The narrative's headings are in the model's numbering. Its finding 2 is the second filing, below the
  // depth cut; on the folded record ordinal 2 is another finding, above it.
  const manifest = { bands: [{ label: "Very High" }, { label: "High" }, { label: "Moderate" }, { label: "Manageable" }] };
  const narrativeMd = "# Synthesis narrative\n\n### Finding 2 — VELTRIN — Qorvalen Holdings (US, Cl. 9)\nA write-up on the second filing.\n";
  const folded = [{ ordinal: 1, band: "High" }, { ordinal: 2, band: "Very High" }];
  const model = [{ ordinal: 1, band: "High" }, { ordinal: 2, band: "High" }, { ordinal: 3, band: "Very High" }];
  const depth = { narrativeKeptBandRank: 1, narrativeWriteUpWords: null };
  const failing = (extra) => runLint({ narrativeMd, findings: folded, depth, manifest, ...extra }).checks
    .filter((c) => c.id.startsWith("narrative-write-ups") && !c.pass).map((c) => c.id);
  assert.deepEqual(failing({}), [], "premise: joined to the folded record, the write-up reads another finding's band");
  assert.deepEqual(failing({ narrativeFindings: model }), ["narrative-write-ups:not-kept:2"]);
});
