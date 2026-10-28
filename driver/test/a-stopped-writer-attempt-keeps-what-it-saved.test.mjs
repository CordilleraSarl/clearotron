// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STOPPED WRITER ATTEMPT KEEPS WHAT IT SAVED, AND THE NEXT ONE CONTINUES FROM IT.
//
// The writer recorded the report in one whole call and nothing was kept until that call passed: on a test run of a
// crowded matter, 2026-10-27, two writer attempts were stopped after hundreds of tool calls each and left nothing. The
// writer now saves each finding as it completes it. A saved finding is checked as the record checks a finding and
// kept in the run's own record, keyed by the position it ends. A refused one leaves its neighbours saved, a repeat
// changes nothing, a changed one is a revision, and a save never reverses a declination. A later attempt is told what
// is saved and what is still owed. The completing call takes every saved finding for a position it does not carry, and
// the record-wide checks still judge the whole. Every mark and owner below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";

process.env.MOCK_FINDINGS_N = "3";
const M = await import("./mock-stage-fixtures.mjs");
const SR = await import("../synthesis-record.mjs");
const { savedFindingsBlock, SAVED_FINDINGS_FILE } = await import("../saved-findings-block.mjs");

const DOC = JSON.parse(M.synthesisFindings(null, ""));
const [F1, F2, F3] = DOC.findings;
const URIS = ["/mark/us/90000001", "/mark/us/90000002", "/mark/us/90000003"];
const SECTIONS = {
  spine: "Dominant-element analysis across the three near marks of one owner family, each read against the client's goods in class 9. "
    + "The marks share the element that carries the client's mark, and the goods overlap in the searched class, so the read turns on that overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The register search ran across the instructed classes and territory." },
};

function run(t) {
  const dir = mkdtempSync(join(tmpdir(), "writer-saves-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "declination-spec.json"), JSON.stringify({ schema_version: 1, rows: URIS.map((uri, i) => ({ uri, mark: DOC.findings[i].mark, owner: "an invented owner", tier: "headline-candidate" })) }) + "\n");
  return dir;
}
const declare = (dir, uris) => writeFileSync(driverDir(dir, "declinations.json"), JSON.stringify({ declinations: uris.map((uri) => ({ uri, reason_token: "unrelated-goods", note: "an invented decline" })) }) + "\n");
const save = (dir, list) => SR.recordSynthesis(dir, { save_findings: list });
const whole = (dir, findings) => SR.recordSynthesis(dir, { findings: { ...DOC, findings }, narrative: SECTIONS });

test("a finding saved before any report exists is kept, and nothing reads the run as written", (t) => {
  const dir = run(t);
  const r = save(dir, [F1]);
  assert.equal(r.refused, null, r.refused);
  assert.deepEqual(r.saved.map((s) => s.key), [`position:${URIS[0]}`], "the finding is not keyed by the position it ends");
  assert.equal(SR.readSavedFindings(dir).length, 1);
  assert.equal(existsSync(join(dir, "findings.json")) || existsSync(join(dir, "narrative.md")), false, "a save wrote a report file");
});

test("a refused finding leaves its neighbours saved; a repeat changes nothing; a changed one is a revision", (t) => {
  const dir = run(t);
  save(dir, [F1]);
  const r = save(dir, [F2, { ...F3, mark: "" }]);
  assert.equal(r.saved.length, 1);
  assert.match(r.save_refused[0].reason, /^synthesis_save_invalid:1: finding_mark_missing/);
  assert.deepEqual(SR.readSavedFindings(dir).map((s) => s.key).sort(), [`position:${URIS[0]}`, `position:${URIS[1]}`], "a refusal took a saved neighbour with it");
  assert.equal(save(dir, [F1]).saved[0].unchanged, true, "an identical re-save was a new save");
  // The same position under another rank: an ordinal is a rank and moves, the position does not.
  const revised = { ...F1, ordinal: 7, legal_position: `${F1.legal_position ?? ""} Revised on the record's own evidence.`.trim() };
  assert.equal(save(dir, [revised]).saved[0].revised, true);
  const held = SR.readSavedFindings(dir).find((s) => s.key === `position:${URIS[0]}`);
  assert.equal(held.finding.ordinal, 7);
  assert.equal(held.revisions, 1);
  assert.equal(SR.readSavedFindings(dir).length, 2, "a revision saved a second copy of the position");
});

test("a save never reverses a declination", (t) => {
  const dir = run(t);
  declare(dir, [URIS[2]]);
  const r = save(dir, [F3]);
  assert.match(r.save_refused[0].reason, /^synthesis_save_declined:0: you declined \/mark\/us\/90000003/);
  assert.equal(SR.readSavedFindings(dir).length, 0);
});

test("the completing call takes the saved findings it does not carry, and the record-wide checks judge the whole", (t) => {
  const dir = run(t);
  save(dir, [F1, F2]);
  // Without the third position the record is incomplete, and is refused as an incomplete record always was.
  const short = whole(dir, []);
  assert.match(String(short.refused), /^synthesis_unaccounted_records:1 of 3/, short.refused);
  assert.equal(SR.readSavedFindings(dir).length, 2, "a refused completing call consumed the saved findings");
  const done = whole(dir, [{ ...F3, ordinal: 1 }]);
  assert.equal(done.refused, null, done.refused);
  const rec = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
  assert.deepEqual(rec.findings.map((f) => f.mark).sort(), [F1.mark, F2.mark, F3.mark].sort(), "the record lost a saved finding");
  assert.deepEqual(SR.readSavedFindings(dir), [], "the saved findings were not consumed by the accepted record");
  // A part saved after the accepted record waits for the next completing call.
  save(dir, [F1]);
  assert.equal(SR.readSavedFindings(dir).length, 1);
});

test("a later attempt is told what is saved, where, and which positions are still to settle; a first is told nothing", (t) => {
  const dir = run(t);
  assert.equal(SR.handSavedFindings(dir), null);
  assert.equal(savedFindingsBlock(SR.handSavedFindings(dir)), "", "a first attempt's message changed");
  declare(dir, [URIS[2]]);
  save(dir, [F1]);
  const h = SR.handSavedFindings(dir);
  assert.deepEqual({ findings: h.findings, declined: h.declined, outstanding: h.outstanding.length }, { findings: 1, declined: 1, outstanding: 1 });
  assert.match(h.outstanding[0], /\(\/mark\/us\/90000002\)$/);
  const file = JSON.parse(readFileSync(join(dir, SAVED_FINDINGS_FILE), "utf8"));
  assert.deepEqual(file.saved_findings.map((f) => f.mark), [F1.mark], "the saved finding and its evidence are not in the file the attempt is handed");
  const block = savedFindingsBlock(h);
  assert.match(block, /^SAVED IN THIS RUN: an earlier attempt of this stage saved 1 finding through record_synthesis and declined 1 record through record_declination\. /);
  assert.match(block, /Still to settle: 1 position: .*\(\/mark\/us\/90000002\)\./);
});
