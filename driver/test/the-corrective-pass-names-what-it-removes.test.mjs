// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE FLOOR UNDER A CORRECTIVE PASS: nothing leaves the findings record without
// somebody having said so.
//
// THE MEASURED FAILURE. A corrective pass resent a whole document holding the four findings it was
// correcting. Fifteen went. The result was schema-valid, so the rollback never fired and every gate
// downstream read a clean run; the delivered report carried none of the lawyer's nine reference marks.
//
// THIS IS THE BACKSTOP, NOT THE FIX. The cause was that the seat could not send a targeted edit at all —
// the tool schema required both halves of the call and declared no patch field while the prompt demanded
// one. That is fixed at the schema, and a targeted edit cannot remove a finding: an ordinal names one to
// replace and there is no shape that deletes. These arms cover the whole-document path that remains.
//
// REPAIR AND DELIVER, ruled by overwatch under authority the owner delegated in session. The client gets
// the reviewer's corrections AND anything that vanished unexplained, restored whole. The three
// alternatives were weighed: rolling back trades one silent loss for another, printing the removals tells
// the client about a hole instead of filling it, and holding the report is against deliver-always.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairUnnamedRemovals, restoredFindingsTable } from "../pipeline.mjs";

const finding = (ordinal, mark) => ({ ordinal, mark, owner: { name: `Owner ${mark}` }, net: `net for ${mark}` });

/** A run dir holding `post` as findings.json, with `pre` as the snapshot the driver took. */
function bed(preDoc, postDoc) {
  const runDir = mkdtempSync(join(tmpdir(), "repair-1955-"));
  mkdirSync(join(runDir, "_driver"), { recursive: true });
  const findings = join(runDir, "findings.json");
  writeFileSync(findings, JSON.stringify(postDoc, null, 2));
  return { runDir, P: { findings, runDir, seniorEyeReview: join(runDir, "nope.md") },
    pre: { raw: JSON.stringify(preDoc, null, 2), sha: "x" },
    read: () => JSON.parse(readFileSync(findings, "utf8")) };
}

test("#1955 a removal no flag named is restored WHOLE from the snapshot", () => {
  const pre = { schema_version: 7, findings: [finding(1, "ALPHA"), finding(2, "BETA"), finding(3, "GAMMA")] };
  const post = { schema_version: 7, findings: [finding(2, "BETA")] };
  const b = bed(pre, post);
  const r = repairUnnamedRemovals(b.P, b.runDir, b.pre, [], []);
  assert.ok(r, "two unexplained removals must fire the repair");
  assert.deepEqual(r.restoredFindings.map((f) => f.mark), ["ALPHA", "GAMMA"]);

  const doc = b.read();
  assert.equal(doc.findings.length, 3, "the client's record must hold every finding again");
  // ORDER, and it is not cosmetic: a restored finding appended to the end is a different document from
  // the one that was correct, and the report renders in this order.
  assert.deepEqual(doc.findings.map((f) => f.mark), ["ALPHA", "BETA", "GAMMA"]);
  // WHOLE, never re-derived — the owner's condition. The restored object is the one the reviewer read.
  assert.deepEqual(doc.findings[0], pre.findings[0], "a restored finding must be byte-identical to the snapshot's");
  assert.deepEqual(doc.findings[2], pre.findings[2]);
});

test("#1955 a removal the reviewer DID name stays removed — by ordinal and by mark", () => {
  // A named removal is a JUDGMENT. This function has no business reversing one; what it reverses is a
  // removal nobody stated, which is by construction one nobody reviewed.
  const pre = { schema_version: 7, findings: [finding(1, "ALPHA"), finding(2, "BETA"), finding(3, "GAMMA")] };
  const post = { schema_version: 7, findings: [finding(2, "BETA")] };

  // named by ORDINAL — a flag carrying `on: [1]`
  const byOrdinal = bed(pre, post);
  const r1 = repairUnnamedRemovals(byOrdinal.P, byOrdinal.runDir, byOrdinal.pre, [1], []);
  assert.deepEqual(r1.restoredFindings.map((f) => f.mark), ["GAMMA"], "only the unnamed one comes back");
  assert.deepEqual(r1.leftRemoved.map((f) => f.mark), ["ALPHA"], "and the named one is recorded as left out");
  assert.deepEqual(byOrdinal.read().findings.map((f) => f.mark), ["BETA", "GAMMA"]);

  // named by MARK — a flag that carries no ordinal at all
  const byMark = bed(pre, post);
  const r2 = repairUnnamedRemovals(byMark.P, byMark.runDir, byMark.pre, [], ["GAMMA"]);
  assert.deepEqual(r2.restoredFindings.map((f) => f.mark), ["ALPHA"]);
  assert.deepEqual(byMark.read().findings.map((f) => f.mark), ["ALPHA", "BETA"]);
});

test("#1955 a top-level register that disappeared comes back, and the rule is DERIVED", () => {
  // Not a typed list of key names. A register added next year is covered the day it exists, and there is
  // no second place to remember it.
  const pre = { schema_version: 7, rated_under_framework: "fw-1", ask_answers: [{ ask: "a", answer: "b" }],
    findings: [finding(1, "ALPHA")] };
  const post = { schema_version: 7, findings: [finding(1, "ALPHA")] };
  const b = bed(pre, post);
  const r = repairUnnamedRemovals(b.P, b.runDir, b.pre, [], []);
  assert.deepEqual(r.restoredKeys.sort(), ["ask_answers", "rated_under_framework"]);
  assert.deepEqual(b.read().ask_answers, pre.ask_answers, "restored whole, not rebuilt");
});

test("#1955 THE CONTROL: a pass that legitimately GREW the record does not fire", () => {
  // MORTY'S CONTROL, and it is the arm that stops this rule being a count check. Of five preserved runs
  // with a pre-corrective snapshot, four were clean negatives and ONE went 12 findings to 13 — a
  // corrective pass that ADDED one. A rule keyed on "the count must not fall", or on equality, would
  // false-refuse that run and repair a document that was never damaged.
  const pre = { schema_version: 7, findings: Array.from({ length: 12 }, (_, i) => finding(i + 1, `M${i + 1}`)) };
  const post = { schema_version: 7, findings: Array.from({ length: 13 }, (_, i) => finding(i + 1, `M${i + 1}`)) };
  const b = bed(pre, post);
  assert.equal(repairUnnamedRemovals(b.P, b.runDir, b.pre, [], []), null,
    "12 → 13 is a corrective pass doing its job; firing here would repair a document nobody damaged");
  assert.equal(b.read().findings.length, 13, "and the file must be left exactly as the pass wrote it");
});

test("#1955 a clean corrective pass is silent, and an edit-in-place is not a removal", () => {
  // The overwhelming majority of passes. A repair that fires on them is noise that gets the guard turned
  // off, and it would rewrite findings.json on every run for nothing.
  const pre = { schema_version: 7, findings: [finding(1, "ALPHA"), finding(2, "BETA")] };
  const same = bed(pre, { schema_version: 7, findings: [finding(1, "ALPHA"), finding(2, "BETA")] });
  assert.equal(repairUnnamedRemovals(same.P, same.runDir, same.pre, [], []), null, "an unchanged record is silent");

  // The shape the fix makes normal: one row corrected in place, nothing removed.
  const edited = bed(pre, { schema_version: 7,
    findings: [finding(1, "ALPHA"), { ...finding(2, "BETA"), net: "CORRECTED" }] });
  assert.equal(repairUnnamedRemovals(edited.P, edited.runDir, edited.pre, [], []), null,
    "a corrected row is not a removed row");
  assert.equal(edited.read().findings[1].net, "CORRECTED", "and the correction survives untouched");
});

test("#1955 an absence is not a pass: no snapshot and an unreadable record both decline", () => {
  const pre = { schema_version: 7, findings: [finding(1, "ALPHA")] };
  const b = bed(pre, { schema_version: 7, findings: [] });
  assert.equal(repairUnnamedRemovals(b.P, b.runDir, null, [], []), null, "no snapshot — nothing to compare against");
  assert.equal(repairUnnamedRemovals(b.P, b.runDir, { raw: "{not json" }, [], []), null, "an unparseable snapshot declines");
  // AND IT DECLINES RATHER THAN REPAIRING FROM NOTHING. Declining leaves the run on its normal ladder;
  // repairing from an unreadable snapshot would invent the document.
  assert.equal(b.read().findings.length, 0, "the file is left for the ladder that can read it");
});

// ── WHICH BRANCH RUNS WHICH CHECK, asserted rather than described ─────────────────────────────────────
//
// Every arm above tests the repair in isolation. None of them proves the thing that actually decides
// whether a repaired document is safe: that the reviewer RE-READS it before it ships.
//
// The corrective cycle has three branches and they are not symmetric:
//
//   branch        findings delivered        enforceCorrectionsReachFindings   reviewer re-read
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   rollback      the PRE-corrective doc    skipped, deliberately             skipped, deliberately
//   success       the corrected doc         runs                              runs
//   repair        the REPAIRED doc          runs                              runs
//
// The rollback skip is correct and stays: what it delivers is the exact bytes the reviewer already read,
// so there is nothing new to re-read. A repaired document is the opposite — assembled by the driver from
// two sources, seen by nobody. The re-read dispatch is guarded on `!correctiveRollback`, so a repair
// placed on the rollback side would inherit that skip SILENTLY and ship a document no reviewer saw.
//
// This arm pins the placement, because the placement is the whole safety property and nothing else in
// this file would notice it moving.
test("#1955 the repair runs on the SUCCESS branch, so the reviewer re-read covers the repaired document", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");

  const rollbackAt = src.indexOf("correctiveRollback = correctivePass.ok");
  const mustAt = src.indexOf("must(correctivePass,", rollbackAt);
  const repairAt = src.indexOf("repairUnnamedRemovals(P, run.runDir", mustAt);
  const enforceAt = src.indexOf("await enforceCorrectionsReachFindings(ctx, P, preCorrective", mustAt);
  const recheckGuardAt = src.indexOf("if (!correctiveRollback && !correctiveCycleSettled", enforceAt);

  for (const [what, at] of [["the rollback assignment", rollbackAt], ["the success branch's must()", mustAt],
    ["the repair call", repairAt], ["the corrections-reached gate", enforceAt],
    ["the reviewer re-read guard", recheckGuardAt]]) {
    assert.notEqual(at, -1, `${what} is not where this arm reads it — the scan found nothing, which is a `
      + "failure to look rather than a clean structure");
  }

  // ON THE SUCCESS SIDE: after the must() that only the success branch reaches, before the gate.
  assert.ok(mustAt < repairAt && repairAt < enforceAt,
    "the repair must sit inside the success branch, between must(correctivePass) and the corrections gate "
    + "— placed anywhere else it either runs on a failed pass or misses the gate");

  // AND THE RE-READ IS STILL GUARDED THE WAY THAT MAKES THAT WORK. If this guard ever stops keying on
  // `correctiveRollback`, the reasoning above stops holding and this arm should be the thing that says so.
  assert.match(src.slice(recheckGuardAt, recheckGuardAt + 120), /!correctiveRollback/,
    "the reviewer re-read must remain guarded on !correctiveRollback — that guard is what makes a repair, "
    + "which leaves correctiveRollback null, get re-read");

  // THE REPAIR MUST NOT SET IT. Setting `correctiveRollback` would route the repaired document into the
  // branch that skips both checks — the exact silent failure this placement exists to prevent.
  const repairRegion = src.slice(repairAt, enforceAt);
  assert.doesNotMatch(repairRegion, /correctiveRollback\s*=/,
    "the repair path must never assign correctiveRollback — that would hand a driver-assembled document "
    + "to the branch that skips the reviewer");
});

// ── WHAT THE REVIEWER IS TOLD ────────────────────────────────────────────────────────────────────────
//
// Reaching the re-read is not the same as telling it. A repaired document is one where SOME rows are the
// seat's corrected judgment and some were put back by the driver, and the reviewer cannot tell them apart
// by looking — a restored row is a well-formed finding like any other. Weighing a driver-restored row as
// the author's judgment is the one reading that makes the repair worse than the loss it fixes.
test("#1955 the reviewer's re-read is TOLD which findings the driver put back", () => {
  assert.equal(restoredFindingsTable(null), "", "no repair — the dispatch must be byte-identical to before");
  assert.equal(restoredFindingsTable({ restoredFindings: [] }), "", "a repair that restored nothing is silent");

  const t = restoredFindingsTable({ restoredFindings: [{ ordinal: 3, mark: "ALPHA MARK" }, { ordinal: 7, mark: "BETA MARK" }] });
  assert.match(t, /#3 ALPHA MARK/);
  assert.match(t, /#7 BETA MARK/);
  assert.match(t, /RESTORED BY THE DRIVER, NOT BY THE AUTHOR/,
    "the reviewer must be told these are not the author's judgment, or it reads them as corrected findings");
  assert.match(t, /no flag naming it/, "and why they came back");
  assert.match(t, /carry NONE of this round's corrections/,
    "a restored row is the pre-corrective object — saying so stops the reviewer crediting it with the round's work");

  // IT MUST OVERRIDE THE NARROWING. On a declared scope the same dispatch tells the reviewer that every
  // finding outside the scope was compared and did not move, so it need not be re-read. A restored
  // finding moved twice. Without this line the narrowing quietly excuses the rows most needing a look.
  assert.match(t, /These rows MOVED/,
    "the scope narrowing says unmoved findings need no re-read — restored rows must be named as the exception");
});
