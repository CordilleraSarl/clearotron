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
//
// TWO OWNERS OF ONE MARK ARE TWO FINDINGS. A finding that names no register record is keyed by its mark and owner, and
// the key read the owner object as text, which is the same for every owner. Two owners' findings for one mark shared a
// key, so the second save replaced the first. Found by design's review, 2026-10-28, on the saved progress of a test
// run, where common-law saves carried that key. The cases at the foot hold both owners through every step.
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

test("the record keeps the writer's numbering: a saved finding keeps its number where it is free, and the record is in that order", (t) => {
  const numbered = (dir) => JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings.map((f) => [f.mark, f.ordinal]);
  // Saved out of the writer's order, and completed by a call that carries none.
  const none = run(t);
  save(none, [F3]);
  save(none, [F1, F2]);
  assert.equal(whole(none, []).refused, null);
  assert.deepEqual(numbered(none), [F1, F2, F3].map((f) => [f.mark, f.ordinal]), "the findings were numbered in the order saved");
  // The call carries the writer's 2, and the saves its 3 and 1. Numbered after the call's highest, the saved ones
  // took 3 and 4, and the fold's renumber would have moved every one of them.
  const between = run(t);
  save(between, [F3, F1]);
  assert.equal(whole(between, [F2]).refused, null);
  assert.deepEqual(numbered(between), [F1, F2, F3].map((f) => [f.mark, f.ordinal]), "a call carrying one finding moved the saved ones");
  // A saved finding under a number the call holds moves after the highest, and the record still parses.
  const taken = run(t);
  save(taken, [{ ...F1, ordinal: F2.ordinal }, F3]);
  assert.equal(whole(taken, [F2]).refused, null);
  assert.deepEqual(numbered(taken), [[F2.mark, F2.ordinal], [F3.mark, F3.ordinal], [F1.mark, F3.ordinal + 1]]);
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

// Two common-law findings of one mark, each owned by its own party: no register record names either.
const commonLaw = (ordinal, owner, link) => {
  const f = structuredClone(F1);
  f.ordinal = ordinal;
  f.mark = "TESSARIN";
  f.owner = { name: owner, country: "GB", registrations: [] };
  f.source = { source_type: "common-law-web", resolved_link: link };
  if (f.meters?.mark_similarity) f.meters.mark_similarity.source = link;
  return f;
};
const ONE = commonLaw(4, "Halvorne Works", "https://example.invalid/halvorne");
const TWO = commonLaw(5, "Quillmere Ltd", "https://example.invalid/quillmere");
const KEYS = ["mark:tessarin|halvorne works|gb", "mark:tessarin|quillmere ltd|gb"];

test("two owners of one mark, saved apart, stay two findings through the save, the read and the completing call", (t) => {
  const dir = run(t);
  save(dir, [F1, F2]);
  const first = save(dir, [ONE]);
  const second = save(dir, [TWO]);
  assert.equal(first.refused ?? second.refused ?? null, null, first.refused ?? second.refused);
  assert.equal(second.saved[0].revised, undefined, "the second owner's finding was saved as a revision of the first owner's");
  const held = SR.readSavedFindings(dir).filter((x) => x.finding.mark === "TESSARIN");
  assert.deepEqual(held.map((x) => [x.key, x.finding.owner.name]), [[KEYS[0], "Halvorne Works"], [KEYS[1], "Quillmere Ltd"]],
    "the two owners do not each hold their own saved finding");
  const done = whole(dir, [{ ...F3, ordinal: 1 }]);
  assert.equal(done.refused, null, done.refused);
  const rec = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8"));
  assert.deepEqual(rec.findings.filter((f) => f.mark === "TESSARIN").map((f) => f.owner.name).sort(), ["Halvorne Works", "Quillmere Ltd"],
    "the completed record lost an owner's finding");
});

test("a re-save of one owner's finding updates that finding and leaves the other owner's", (t) => {
  const dir = run(t);
  save(dir, [ONE, TWO]);
  assert.equal(save(dir, [ONE]).saved[0].unchanged, true, "an identical re-save was a new save");
  const revised = { ...ONE, legal_position: `${ONE.legal_position} Revised on the listing's own evidence.` };
  assert.equal(save(dir, [revised]).saved[0].revised, true);
  const held = new Map(SR.readSavedFindings(dir).map((x) => [x.key, x]));
  assert.equal(held.size, 2, "a revision of one owner's finding saved a copy, or took the other's");
  assert.deepEqual([held.get(KEYS[0]).finding.legal_position, held.get(KEYS[0]).revisions], [revised.legal_position, 1]);
  assert.deepEqual(held.get(KEYS[1]).finding, TWO, "the other owner's finding changed");
});

test("findings saved under the old key keep both owners when the run reads them", (t) => {
  const dir = run(t);
  const old = "mark:tessarin|[object object]";
  mkdirSync(join(driverDir(dir), "synthesis-calls"), { recursive: true });
  writeFileSync(SR.savedFindingsPath(dir), [{ at: "2026-10-28T03:00:00Z", key: old, finding: ONE },
    { at: "2026-10-28T03:01:00Z", key: old, revised: true, finding: TWO }].map((r) => JSON.stringify(r)).join("\n") + "\n");
  assert.deepEqual(SR.readSavedFindings(dir).map((x) => [x.key, x.finding.owner.name, x.revisions]), [[KEYS[0], "Halvorne Works", 0], [KEYS[1], "Quillmere Ltd", 0]],
    "a finding saved under the old key was read as the other owner's revision");
});

