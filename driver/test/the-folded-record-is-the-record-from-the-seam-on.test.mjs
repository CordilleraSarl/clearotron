// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the fold after the delivery seam, on invented records
//
// THE FOLDED RECORD IS THE RECORD FROM THE DELIVERY SEAM ON (design, 2026-10-03).
//
// The seam folds a second filing of the same conflict into one finding and renumbers. Once it has, every
// accepted save folds the record again, so findings.json stays the folded record the reviewer, the cards
// and the delivery read. The model's own record stays the base for its patches and is kept beside the
// folded one, because what is named against it — a flag's ordinals, the narrative's finding headings — is
// in its numbering. A pass opens before its seam, so a save before the seam on a resumed pass writes the
// model's record as it always has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, FINDINGS_FILE } from "../synthesis-record.mjs";
import { foldRecord, foldFindingsFile, foldAfterSave, openPass, readFold, modelRecordPath, snapshotFold, UNFOLDED_FILE }
  from "../record-fold.mjs";
import { repairUnnamedRemovals, rollbackCorrectivePass } from "../pipeline.mjs";
import { runLint } from "../predelivery-lint.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};

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
const THREE = [["Qorvalen Holdings", "VELTRIN"], ["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"]];
const FOUR = [...THREE, ["Selmora Labs", "KESTRIN"]];

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "fold-"));
  mkdirSync(driverDir(dir), { recursive: true });
  return dir;
}
const at = (dir) => join(dir, FINDINGS_FILE);
const onDisk = (dir) => JSON.parse(readFileSync(at(dir), "utf8"));
const modelRecord = (dir) => JSON.parse(readFileSync(driverDir(dir, UNFOLDED_FILE), "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");

test("the fold maps the model's ordinals to the folded ones and back; a record with nothing to fold is left as it came", () => {
  const { doc, merges, map } = foldRecord(record(THREE));
  assert.equal(merges.length, 1);
  assert.equal(doc.findings.length, 2);
  assert.deepEqual(map.modelToFolded, { 1: 1, 2: 1, 3: 2 });
  assert.deepEqual(map.foldedToModel, { 1: [1, 2], 2: [3] });
  assert.deepEqual(doc.findings[0].owner.registrations.map((r) => r.uri), ["/mark/us/91000001", "/mark/us/91000002"]);
  const plain = record([THREE[0], THREE[2]]);
  const none = foldRecord(plain);
  assert.equal(none.map, null);
  assert.equal(none.doc, plain);
});

test("before the seam a save writes the model's record; after it every accepted save folds again, and a patch in the model's numbering lands on the right folded finding", () => {
  const dir = runDir();
  try {
    assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(THREE) }).refused, null);
    assert.equal(onDisk(dir).findings.length, 3, "a save before the seam folded the record");
    foldFindingsFile(dir, at(dir), null, { seam: true });
    assert.equal(onDisk(dir).findings.length, 2, "premise: the seam folds the second filing in");
    // the model's third finding is the folded second
    const changed = { ...record(THREE).findings[2], legal_position: "The earlier registration was renewed in the searched class." };
    const r = recordSynthesis(dir, { findings_patch: [changed] });
    assert.equal(r.refused, null, String(r.refused));
    const after = onDisk(dir);
    assert.equal(after.findings.length, 2, "a save after the seam unfolded the record");
    assert.equal(after.findings[1].legal_position, changed.legal_position, "the patch did not land on the folded finding it names");
    assert.equal(modelRecord(dir).findings.length, 3, "the record the model wrote is not kept beside the folded one");
    assert.equal(modelRecordPath(dir, at(dir)), driverDir(dir, UNFOLDED_FILE));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a pass opens before its seam: a save on a resumed pass writes the model's record, and the seam folds it again", () => {
  const dir = runDir();
  try {
    recordSynthesis(dir, { narrative: NARRATIVE, findings: record(THREE) });
    foldFindingsFile(dir, at(dir), null, { seam: true });   // the earlier pass's seam
    openPass(dir);                                          // the resumed pass
    assert.equal(readFold(dir).seamPassed, false);
    assert.equal(onDisk(dir).findings.length, 2, "premise: the earlier pass left the record folded");
    assert.equal(modelRecordPath(dir, at(dir)), driverDir(dir, UNFOLDED_FILE), "while the file is folded, the record the model wrote stands");
    recordSynthesis(dir, { narrative: NARRATIVE, findings: record(THREE) });   // before this pass's seam
    assert.equal(onDisk(dir).findings.length, 3, "a save before this pass's seam was folded");
    assert.equal(readFold(dir).map, null, "the map of a fold the save replaced still stands");
    assert.equal(existsSync(driverDir(dir, UNFOLDED_FILE)), false);
    foldFindingsFile(dir, at(dir), null, { seam: true });   // this pass's seam
    assert.equal(onDisk(dir).findings.length, 2);
    assert.equal(readFold(dir).seamPassed, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a seam that finds the record already folded keeps the record the model wrote and the map", () => {
  const dir = runDir();
  try {
    recordSynthesis(dir, { narrative: NARRATIVE, findings: record(THREE) });
    foldFindingsFile(dir, at(dir), null, { seam: true });
    openPass(dir);
    foldFindingsFile(dir, at(dir), null, { seam: true });   // a resumed pass with no save before its seam
    assert.equal(readFold(dir).seamPassed, true);
    assert.deepEqual(readFold(dir).map?.modelToFolded, { 1: 1, 2: 1, 3: 2 }, "the map was dropped");
    assert.equal(modelRecord(dir).findings.length, 3, "the record the model wrote was dropped");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a rolled-back pass puts the fold back with the record", () => {
  const dir = runDir();
  try {
    recordSynthesis(dir, { narrative: NARRATIVE, findings: record(THREE) });
    foldFindingsFile(dir, at(dir), null, { seam: true });
    const raw = readFileSync(at(dir), "utf8");
    const pre = { raw, sha: sha(raw), fold: snapshotFold(dir) };
    // a pass whose save folds nothing: the second filing now names another mark
    const apart = record([THREE[0], ["Qorvalen Holdings", "VELTRIN NOVA"], THREE[2]]);
    assert.equal(recordSynthesis(dir, { narrative: NARRATIVE, findings: apart }).refused, null);
    assert.equal(readFold(dir).map, null, "premise: that save folds nothing");
    rollbackCorrectivePass({ findings: at(dir) }, dir, pre, { fail: "the pass failed validation" });
    assert.equal(readFileSync(at(dir), "utf8"), raw);
    assert.deepEqual(readFold(dir).map, pre.fold.state.map, "the map was not put back");
    assert.equal(modelRecord(dir).findings.length, 3, "the record the model wrote was not put back");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a fold that fails after the seam leaves the record as the save wrote it, and says so", () => {
  const dir = runDir();
  try {
    recordSynthesis(dir, { narrative: NARRATIVE, findings: record(THREE) });
    foldFindingsFile(dir, at(dir), null, { seam: true });
    assert.ok(readFold(dir).map, "premise: a fold is in force");
    writeFileSync(at(dir), "{ not a record");   // a record the fold cannot read
    const r = foldAfterSave(dir, at(dir));
    assert.ok(r.error, "the failure was not reported");
    const state = readFold(dir);
    assert.equal(state.map, null, "the map of an earlier fold still stands");
    assert.equal(state.seamPassed, true);
    assert.ok(state.error, "the failure is not on the record");
    assert.equal(existsSync(driverDir(dir, UNFOLDED_FILE)), false, "the record of an earlier fold is still kept");
    assert.equal(modelRecordPath(dir, at(dir)), at(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The removal repair compares the record before a corrective pass with the record after it, and puts
// back a finding no flag named. A folded record renumbers: compared folded, a finding removed by name
// would shift the last one down and read as an unnamed removal of it.
function foldedRun() {
  const dir = runDir();
  writeFileSync(at(dir), JSON.stringify(record(FOUR), null, 2));
  foldFindingsFile(dir, at(dir), null, { seam: true });   // folded: 1 the two filings, 2 ORVANTE, 3 KESTRIN
  const raw = readFileSync(at(dir), "utf8");
  const modelRaw = readFileSync(driverDir(dir, UNFOLDED_FILE), "utf8");
  return { dir, pre: { raw, sha: sha(raw), model: { raw: modelRaw, sha: sha(modelRaw) }, fold: snapshotFold(dir) } };
}
/** The corrective pass's save, without the model's finding `ordinal`. */
function saveWithout(dir, ordinal) {
  const doc = record(FOUR);
  writeFileSync(at(dir), JSON.stringify({ ...doc, findings: doc.findings.filter((f) => f.ordinal !== ordinal) }, null, 2));
  foldAfterSave(dir, at(dir));
}

test("after the seam, a finding the review named for removal stays removed and nothing comes back in its place", () => {
  const { dir, pre } = foldedRun();
  try {
    saveWithout(dir, 4);   // the review named the model's finding 4, the folded third
    assert.equal(onDisk(dir).findings.length, 2, "premise: the folded record lost a finding");
    const r = repairUnnamedRemovals({ findings: at(dir), runDir: dir }, dir, pre, [4], []);
    assert.equal(r, null, `a finding came back: ${JSON.stringify(r?.restoredFindings)}`);
    assert.deepEqual(onDisk(dir).findings.map((f) => f.mark), ["VELTRIN", "ORVANTE"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("after the seam, a finding removed without a name is put back whole, and the record folds again", () => {
  const { dir, pre } = foldedRun();
  try {
    saveWithout(dir, 3);
    const r = repairUnnamedRemovals({ findings: at(dir), runDir: dir }, dir, pre, [], []);
    assert.deepEqual(r?.restoredFindings.map((f) => f.mark), ["ORVANTE"]);
    assert.deepEqual(onDisk(dir).findings.map((f) => f.mark), ["VELTRIN", "ORVANTE", "KESTRIN"], "the repaired record is not folded");
    assert.equal(modelRecord(dir).findings.length, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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
