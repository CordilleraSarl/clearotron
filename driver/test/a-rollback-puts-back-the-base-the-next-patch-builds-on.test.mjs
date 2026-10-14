// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the corrective rollback and the removal repair, on invented records
//
// A ROLLBACK PUTS BACK THE BASE THE NEXT PATCH BUILDS ON.
//
// A corrective pass that saves and then fails is rolled back to the record the reviewer read. The rollback
// used to put back findings.json alone: narrative.md kept the failed pass's text, and the transport's merge
// base (`_driver/synthesis-calls/accepted.json`) kept the failed pass's record, so the next patch merged onto
// a record the rollback had discarded and quietly applied it again. The snapshot now holds the narrative and
// the base too, and the rollback puts all three back.
//
// The removal repair has the same gap from the other side. It puts a finding no flag named back into the
// file, but the next patch merges onto the base and re-renders the file from it, so a restore the base never
// saw is dropped again. The repair now writes what it restores into the base as well, in the model's
// numbering, with and without a fold in force.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { driverDir } from "../../shared/driver-dir.mjs";
import { recordSynthesis, FINDINGS_FILE, NARRATIVE_FILE } from "../synthesis-record.mjs";
import { foldFindingsFile, snapshotFold, UNFOLDED_FILE } from "../record-fold.mjs";
import { rollbackCorrectivePass, repairUnnamedRemovals } from "../pipeline.mjs";
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
    f.owner.registrations[0].uri = `/mark/us/9200000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    return f;
  }) };
}
const APART = [["Halvorne Works", "TESSARIN"], ["Quillmere Ltd", "ODRAVEL"], ["Pennick Supply", "MARVETTE"]];
// The second finding is a second filing of the first, so the delivery seam folds the two together.
const FOLDING = [["Qorvalen Holdings", "PRUNDELIQ"], ["Qorvalen Holdings", "PRUNDELIQ"], ["Brannick Tooling", "ORVANTE"],
  ["Selmora Labs", "KESTRIN"]];

function runDir() {
  const dir = mkdtempSync(join(tmpdir(), "rollback-base-"));
  mkdirSync(driverDir(dir), { recursive: true });
  return dir;
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
const findingsAt = (dir) => join(dir, FINDINGS_FILE);
const narrativeAt = (dir) => join(dir, NARRATIVE_FILE);
const acceptedAt = (dir) => driverDir(dir, "synthesis-calls", "accepted.json");
const read = (at) => (existsSync(at) ? readFileSync(at, "utf8") : null);
const onDisk = (dir) => JSON.parse(readFileSync(findingsAt(dir), "utf8"));
const baseFindings = (dir) => JSON.parse(readFileSync(acceptedAt(dir), "utf8")).params.findings;
const P = (dir) => ({ findings: findingsAt(dir), narrative: narrativeAt(dir), runDir: dir });

/** The snapshot a corrective pass takes before it dispatches, built from the files as they stand. */
function snapshot(dir) {
  const raw = readFileSync(findingsAt(dir), "utf8");
  const modelAt = existsSync(driverDir(dir, UNFOLDED_FILE)) ? driverDir(dir, UNFOLDED_FILE) : findingsAt(dir);
  const modelRaw = readFileSync(modelAt, "utf8");
  return { raw, sha: sha(raw), model: { raw: modelRaw, sha: sha(modelRaw) }, fold: snapshotFold(dir),
    base: { accepted: read(acceptedAt(dir)), narrative: read(narrativeAt(dir)) } };
}
const accepted = (r, what) => assert.equal(r.refused, null, `${what} was refused: ${r.refused}`);

test("a pass that saved and then failed is rolled back whole, and the next patch merges onto the record the reviewer read", () => {
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(APART) }), "the first save");
    const pre = snapshot(dir);
    // the corrective pass saves a changed verdict and a changed second finding, then fails
    const failed = { ...record(APART).findings[1], legal_position: "A position the failed pass wrote and the rollback discards." };
    accepted(recordSynthesis(dir, { narrative: { verdict: `${NARRATIVE.verdict} The failed pass rewrote this.` }, findings_patch: [failed] }),
      "the failed pass's save");
    assert.notEqual(read(narrativeAt(dir)), pre.base.narrative, "premise: the failed pass changed the narrative");

    const rec = rollbackCorrectivePass(P(dir), dir, pre, { ok: false, fail: "findings_schema_invalid:3" });
    assert.ok(rec, "the rollback must fire");
    assert.equal(read(findingsAt(dir)), pre.raw, "findings.json is not the record the reviewer read");
    assert.equal(read(narrativeAt(dir)), pre.base.narrative,
      "narrative.md still holds the failed pass's text: the rollback put back the findings and not the narrative beside them");
    assert.equal(read(acceptedAt(dir)), pre.base.accepted,
      "the merge base still holds the failed pass's record, so the next patch would build on what the rollback discarded");

    // the next patch, on the third finding, merges onto the restored base
    const third = { ...record(APART).findings[2], legal_position: "The later patch corrects only the third finding." };
    accepted(recordSynthesis(dir, { findings_patch: [third] }), "the next patch");
    const after = onDisk(dir);
    assert.equal(JSON.stringify(after.findings[1]), JSON.stringify(record(APART).findings[1]),
      "the failed pass's second finding came back with the next patch: it merged onto the discarded record");
    assert.equal(after.findings[2].legal_position, third.legal_position);
    assert.ok(!read(narrativeAt(dir)).includes("The failed pass rewrote this."), "the failed pass's verdict came back with the next patch");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a pass that changed only the narrative is rolled back too: findings.json never moved, and the narrative and the base still come back", () => {
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(APART) }), "the first save");
    const pre = snapshot(dir);
    accepted(recordSynthesis(dir, { narrative: { verdict: `${NARRATIVE.verdict} Only the narrative moved.` } }), "the narrative-only save");
    assert.equal(read(findingsAt(dir)), pre.raw, "premise: a narrative-only save leaves findings.json as it was");

    const rec = rollbackCorrectivePass(P(dir), dir, pre, { ok: false, fail: "empty_response" });
    assert.equal(rec.restored, false, "`restored` speaks for findings.json, which the pass never changed");
    assert.equal(read(narrativeAt(dir)), pre.base.narrative, "a narrative the failed pass changed was left in place because findings.json had not moved");
    assert.equal(read(acceptedAt(dir)), pre.base.accepted, "the base was left at the failed pass's record because findings.json had not moved");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a snapshot that held no base removes the one the failed pass wrote, so a later patch is refused rather than built on it", () => {
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(APART) }), "the first save");
    rmSync(acceptedAt(dir));   // the record on disk came from a path that keeps no transport base
    const pre = snapshot(dir);
    assert.equal(pre.base.accepted, null, "premise: the snapshot holds no base");
    const rewritten = record(APART);
    rewritten.findings[0].legal_position = "The failed pass resent the whole record with this change.";
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: rewritten }), "the failed pass's whole save");
    assert.ok(existsSync(acceptedAt(dir)), "premise: the failed pass's save wrote a base");

    rollbackCorrectivePass(P(dir), dir, pre, { ok: false, fail: "findings_schema_invalid:1" });
    assert.equal(existsSync(acceptedAt(dir)), false, "the failed pass's base outlived the rollback");
    const r = recordSynthesis(dir, { findings_patch: [record(APART).findings[1]] });
    assert.match(String(r.refused), /^synthesis_patch_without_base:/,
      "a patch after the rollback was not refused for want of a base: it merged onto the record the rollback discarded");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a snapshot that carries no base at all leaves the narrative and the base as they stand", () => {
  // The shape every snapshot had before this change: findings.json and the fold only. There is nothing to put
  // back, so nothing is touched.
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(APART) }), "the first save");
    const { base: _held, ...pre } = snapshot(dir);
    accepted(recordSynthesis(dir, { narrative: { verdict: `${NARRATIVE.verdict} Changed.` } }), "the narrative-only save");
    const narrativeNow = read(narrativeAt(dir)), acceptedNow = read(acceptedAt(dir));
    rollbackCorrectivePass(P(dir), dir, pre, { ok: false, fail: "empty_response" });
    assert.equal(read(narrativeAt(dir)), narrativeNow);
    assert.equal(read(acceptedAt(dir)), acceptedNow);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the snapshot the corrective pass takes holds the narrative and the merge base beside the findings", async () => {
  const { snapshotFindingsForCorrections } = await import("../pipeline.mjs");
  assert.equal(typeof snapshotFindingsForCorrections, "function", "the corrective snapshot cannot be reached to check what it holds");
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(APART) }), "the first save");
    const pre = snapshotFindingsForCorrections(P(dir), dir);
    assert.equal(pre.raw, read(findingsAt(dir)));
    assert.deepEqual(pre.base, { accepted: read(acceptedAt(dir)), narrative: read(narrativeAt(dir)) },
      "the snapshot does not hold the narrative and the merge base, so a rollback has nothing to put them back from");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a removal the repair puts back reaches the merge base, so the patch that follows cannot drop it again", () => {
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(APART) }), "the first save");
    const pre = snapshot(dir);
    // the corrective pass resends the whole record without the third finding, which no flag named
    const doc = record(APART);
    const second = { ...doc.findings[1], legal_position: "The flagged second finding, corrected." };
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: { ...doc, findings: [doc.findings[0], second] } }), "the pass's save");
    const r = repairUnnamedRemovals(P(dir), dir, pre, [2], []);
    assert.deepEqual(r?.restoredFindings.map((f) => f.mark), ["MARVETTE"], "premise: the repair puts the third finding back");
    assert.deepEqual(baseFindings(dir).findings.map((f) => f.mark), ["TESSARIN", "ODRAVEL", "MARVETTE"],
      "the merge base does not hold the finding the repair put back");
    assert.equal(JSON.stringify(baseFindings(dir).findings[2]), JSON.stringify(doc.findings[2]), "the base's restored finding is not the one the reviewer read");

    // the corrections gate's re-emit: a patch on the first finding
    const first = { ...doc.findings[0], legal_position: "The re-emit corrects the first finding." };
    accepted(recordSynthesis(dir, { findings_patch: [first] }), "the re-emit");
    const after = onDisk(dir);
    assert.deepEqual(after.findings.map((f) => f.mark), ["TESSARIN", "ODRAVEL", "MARVETTE"],
      "the restored finding was dropped again by the patch that followed the repair");
    assert.equal(after.findings[1].legal_position, second.legal_position, "the pass's own correction was lost");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with a fold in force, the base takes the restored finding in the model's numbering, and a patch keeps it", () => {
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(FOLDING) }), "the first save");
    foldFindingsFile(dir, findingsAt(dir), null, { seam: true });
    assert.equal(onDisk(dir).findings.length, 3, "premise: the seam folds the second filing in");
    const pre = snapshot(dir);
    // the pass resends the record without the model's fourth finding, which no flag named
    const doc = record(FOLDING);
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: { ...doc, findings: doc.findings.slice(0, 3) } }), "the pass's save");
    assert.equal(onDisk(dir).findings.length, 2, "premise: the folded record lost a finding");

    const r = repairUnnamedRemovals(P(dir), dir, pre, [], []);
    assert.deepEqual(r?.restoredFindings.map((f) => f.mark), ["KESTRIN"], "premise: the repair puts the fourth finding back");
    assert.deepEqual(baseFindings(dir).findings.map((f) => f.ordinal), [1, 2, 3, 4],
      "the merge base does not hold the restored finding in the model's numbering");

    // a patch in the model's numbering, on the folded record's second finding
    const third = { ...doc.findings[2], legal_position: "The re-emit corrects the model's third finding." };
    accepted(recordSynthesis(dir, { findings_patch: [third] }), "the re-emit");
    assert.deepEqual(onDisk(dir).findings.map((f) => f.mark), ["PRUNDELIQ", "ORVANTE", "KESTRIN"],
      "the restored finding was dropped again by the patch that followed the repair");
    assert.equal(onDisk(dir).findings[1].legal_position, third.legal_position);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a restore the acceptance boundary refuses leaves the base as it was, and the repair says so", () => {
  const dir = runDir();
  try {
    accepted(recordSynthesis(dir, { narrative: NARRATIVE, findings: record(APART) }), "the first save");
    const pre = snapshot(dir);
    // the snapshot carries a coverage row the transport would refuse; the pass's save dropped it, no flag named it
    const preDoc = JSON.parse(pre.model.raw);
    preDoc.coverage = [...(preDoc.coverage ?? []), { area: "an invented slice", state: "not-a-state" }];
    const raw = JSON.stringify(preDoc, null, 2);
    const held = { ...pre, raw, sha: sha(raw), model: { raw, sha: sha(raw) } };
    const baseBefore = read(acceptedAt(dir));

    const r = repairUnnamedRemovals(P(dir), dir, held, [], []);
    assert.equal(r?.restoredRows.length, 1, "premise: the repair puts the row back into the file");
    assert.equal(read(acceptedAt(dir)), baseBefore, "a restore the boundary refuses was written into the base");
    assert.equal(r.base?.ok, false, "the repair's record does not say the base was left as it was");
    assert.match(String(r.base?.reason), /^synthesis_coverage_state_invalid:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
