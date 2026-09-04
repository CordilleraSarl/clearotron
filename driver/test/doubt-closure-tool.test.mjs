// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The closure transport's disk half. The properties are B's, and each is here because getting it wrong
// re-creates a blindness that has already cost us a diagnosis:
//
//   · the payload is captured AS RECEIVED, before anything is decided about it;
//   · the index line is written by the RECEIVER, before the work, so a call that dies mid-flight is
//     distinguishable from a call that was never made;
//   · a capture that fails is REPORTED, never swallowed — "captured" and "capture failed" are different
//     facts and the answer says which;
//   · and it is INERT: it touches nothing the live path reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { recordClosures, captureCall, callsSoFar, closureCallPaths } from "../doubt-closure-tool.mjs";

const FILES = ["findings.json", "audit.md"];
const TEXTS = { "findings.json": "The mark VENTURI is registered in CH for class 9.", "audit.md": "nothing here" };

function runDir() {
  const d = mkdtempSync(join(tmpdir(), "clc-tool-"));
  mkdirSync(driverDir(d), { recursive: true });
  return d;
}
const specFor = (d) => ({ runDir: d, openIds: ["d1", "d2", "d3"], allowedFiles: FILES, fileTexts: TEXTS });
const good = { kind: "doubt", doubt_id: "d1", verdict: "settled", file_index: 0, quote: "VENTURI is registered in CH", reason: "register hit" };
const bad = { kind: "doubt", doubt_id: "d2", verdict: "settled", file_index: 0, quote: "not in that file at all", reason: "r" };

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const indexLines = (d) => {
  const { index } = closureCallPaths(d, 0);
  return existsSync(index) ? readFileSync(index, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test("the payload is captured AS RECEIVED — refused rows and unknown fields included", () => {
  // A payload pruned to what we liked is not evidence about what was sent. The 2026-08-15 failure could
  // only be diagnosed by hand because the one artifact that would have settled it had been overwritten.
  const d = runDir();
  const answer = recordClosures(specFor(d), { closures: [good, bad, { doubt_id: "nope", verdict: "open", reason: "x", invented_field: 7 }] });

  assert.ok(answer.captured, "the answer names the payload it kept");
  const payload = readJson(answer.captured);
  assert.equal(payload.closures.length, 3, "ALL THREE rows are in the record, including the two refused");
  assert.equal(payload.closures[2].invented_field, 7, "…and a field this transport does not accept survives, because it is evidence");
  assert.match(payload._provenance, /as RECEIVED by the tool/);
  assert.equal(answer.capture_failed, null);
});

test("the index line is written by the RECEIVER, and it names the payload", () => {
  const d = runDir();
  recordClosures(specFor(d), { closures: [good] });
  const lines = indexLines(d);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].seq, 1);
  assert.equal(lines[0].rowCount, 1);
  assert.match(lines[0].payload, /^call-001\.json$/, "the line names the payload file, so correlation is not by mtime");
});

test("a call that dies before it decides still leaves its index line — absence means NOT CALLED", () => {
  // The property the index exists for. captureCall runs before any validation, so the record of "a call
  // arrived" cannot be lost by anything that happens afterwards. Driven directly rather than by
  // simulating a crash: this is exactly the code path a crash would leave behind.
  const d = runDir();
  const r = captureCall(d, 1, { closures: [good, bad] });
  assert.equal(r.ok, true);
  assert.equal(indexLines(d).length, 1, "the line exists before any verdict does");
  assert.equal(readJson(r.payload).rowCount, 2);
  assert.equal(callsSoFar(d), 1, "…and the next call's seq is derived from it, so numbering survives a crash");
});

// SKIPPED under root rather than returned early: root ignores a directory's write bit, so the 0o500 below
// refuses nothing, both writes land and the answer correctly reports no failure — the red is this
// harness's, not the recorder's. An early `return` would report `ok` for a test that asserted nothing, so
// the reason is declared on the line where a reader of the output can see it.
test("a capture that CANNOT be written is reported, never swallowed",
  { skip: process.getuid?.() === 0 && "root writes through a 0o500 directory — the fault injection is a no-op" }, () => {
  // The rows are still valid work, so the call is not lost — but "captured" and "capture failed" are
  // different facts, and an answer that reported only success would make a lost payload invisible.
  const d = runDir();
  chmodSync(driverDir(d), 0o500);
  try {
    const answer = recordClosures(specFor(d), { closures: [good] });
    assert.equal(answer.captured, null);
    assert.ok(answer.capture_failed, "the failure is named in the answer");
    assert.equal(answer.accepted, 1, "and the seat's valid row is still accepted — the capture is not a gate");
    assert.ok(answer.record_failed, "the accepted-rows record failed for the same reason, and says so separately");
  } finally { chmodSync(driverDir(d), 0o700); }
});

test("the accepted rows are recorded in the shape the two ledgers consume, split by kind", () => {
  const d = runDir();
  const answer = recordClosures(specFor(d), { closures: [
    good,
    { kind: "ask", doubt_id: "d2", verdict: "immaterial", file_index: 0, quote: "VENTURI is registered in CH", reason: "on the record" },
    { kind: "ask", doubt_id: "d3", verdict: "open", handoff: "confirm the launch territory" },
  ] });
  assert.equal(answer.accepted, 3);
  const rec = readJson(answer.recorded);
  assert.deepEqual(rec.lines.doubt.map((l) => l.verdict), ["SETTLED"]);
  assert.deepEqual(rec.lines.ask.map((l) => l.verdict), ["IMMATERIAL", "OPEN"]);
  assert.equal(rec.lines.ask[1].reason, "confirm the launch territory", "the open ask's handoff becomes the line's reason, which is what applyAskClosure reads");
});

test("the answer tells the seat what is STILL OPEN, re-derived rather than assumed", () => {
  const d = runDir();
  const answer = recordClosures(specFor(d), { closures: [good, bad] });
  assert.equal(answer.accepted, 1);
  assert.deepEqual(answer.still_open.sort(), ["d2", "d3"], "d2 was refused so it is still owed; d3 was never spoken to");
  assert.deepEqual(answer.refused.map((r) => r.doubt_id), ["d2"]);
  assert.match(answer.refused[0].reason, /does not appear verbatim/, "the refusal is actionable inside the seat's own turn");
  assert.deepEqual(answer.evidence_files, FILES, "the positional list is handed back, because file_index means nothing without it");
});

test("✅ LIVE at conversion 6 — it renders the artifact, and STILL writes nothing else", () => {
  // INVERTED, NEVER DELETED. This arm asserted inertness — "no doubt-closure.md" — which was the property
  // that made safe to land before the stage converted. Conversion 6 is that conversion, so the
  // expected state flips. Deleting the arm instead would have retired the only thing tracking what this
  // module puts on disk, at the exact moment it started putting something there.
  //
  // WHY THE TOOL RENDERS IT AND NOT THE PIPELINE: `validators.doubtClosure` reads this file when the
  // seat's turn ENDS, before the pipeline applies anything. A driver that rendered it afterwards would
  // fail validation on every run — on a NON-FATAL stage, so the doubts would ship open and it would read
  // as a seat that said nothing.
  const d = runDir();
  recordClosures(specFor(d), { closures: [good] });

  const artifact = join(d, "doubt-closure.md");
  assert.equal(existsSync(artifact), true, "the artifact is rendered by the tool, in the seat's own turn");
  const text = readFileSync(artifact, "utf8");
  assert.match(text, /^(?:[-*]\s+)?(?:SETTLED|IMMATERIAL|OPEN)\s+\S+:/m,
    "and it carries the lines validators.doubtClosure requires — the validator is why it is rendered at all");
  assert.ok(text.includes(good.quote), "rendered from the ACCEPTED row, quote and all");

  assert.equal(existsSync(driverDir(d, "doubt-closure.md")), false, "still never into _driver/ — the write boundary denies that tree");
  // The blast radius is still exactly two places: the run root's artifact and its own calls directory.
  assert.deepEqual(readdirSync(d).sort(), ["_driver", "doubt-closure.md"], "the artifact and nothing else at the run root");
  assert.deepEqual(readdirSync(driverDir(d)).sort(), ["doubt-closure-calls"], "and nothing else under _driver");
});

test("seq increments across calls, so two calls in a turn cannot overwrite each other", () => {
  const d = runDir();
  const a = recordClosures(specFor(d), { closures: [good] });
  const b = recordClosures(specFor(d), { closures: [{ kind: "doubt", doubt_id: "d3", verdict: "open", reason: "nothing answers it" }] });
  assert.notEqual(a.captured, b.captured);
  assert.equal(indexLines(d).length, 2);
  assert.deepEqual(indexLines(d).map((l) => l.seq), [1, 2]);
});

// ── — THE RE-SEND IS SEEN AND NAMED ────────────────────────────────────────────────────────────
//
// Measured across six runs and seven kills at timeout+60, all `stopReason: tool_use`: one run sent six
// calls carrying TWO distinct id-sets, A,B,A,B,A,B, identical by hash — and the tool REFUSED NOTHING.
// Every call was accepted; the seat was re-sending work already taken. Within one attempt both batches
// went twice, 40/40 identical each time. A refusal counter reads zero through all of it, which is why
// disposition's PARK_AFTER_REFUSALS shape could not have caught this.

test("#1239 a re-sent id-set is reported as a repeat, by the call number it repeats", () => {
  const d = runDir();
  const first = recordClosures(specFor(d), { closures: [good] });
  assert.equal(first.repeat_of, null, "the first call of a set cannot be a repeat of anything");
  assert.ok(first.id_set, "an id-set hash was not computed for a call carrying rows");

  const again = recordClosures(specFor(d), { closures: [good] });
  assert.equal(again.id_set, first.id_set, "the same items hashed differently on a second call");
  assert.equal(again.repeat_of, 1, "a re-sent batch was not recognised as a repeat of call 1");
});

test("#1239 THE ORDER IS THE MECHANISM — a call must not match the index row it just wrote", () => {
  // `captureCall` appends THIS call's row, hash included. Asking the index afterwards would match that
  // row and every call would report itself as a repeat of itself — a guard that fires on everything,
  // which is the same as one that fires on nothing. Pinned here because the two statements sit adjacent
  // and swapping them is a one-line edit that no other arm would notice.
  const d = runDir();
  const only = recordClosures(specFor(d), { closures: [good] });
  assert.equal(only.repeat_of, null,
    `the first call reported itself as a repeat of call ${only.repeat_of} — the check ran after the capture`);
  assert.equal(indexLines(d).length, 1, "the fixture did not produce exactly one index row");
});

test("#1239 the hash is over the ITEMS, not their order or their repetition inside one call", () => {
  const d = runDir();
  const a = recordClosures(specFor(d), { closures: [good, { ...good, doubt_id: "d3", verdict: "open", reason: "later" }] });
  // same two items, reversed, and one of them sent twice
  const b = recordClosures(specFor(d), { closures: [{ ...good, doubt_id: "d3", verdict: "open", reason: "later" }, good, good] });
  assert.equal(b.id_set, a.id_set, "order or in-call repetition changed the fingerprint");
  assert.equal(b.repeat_of, 1, "the same item set arriving in a different order was not seen as a repeat");
});

test("#1239 a DIFFERENT id-set is not a repeat — the guard discriminates", () => {
  // Without this, an always-true match would satisfy every arm above.
  const d = runDir();
  recordClosures(specFor(d), { closures: [good] });
  const other = recordClosures(specFor(d), { closures: [{ ...good, doubt_id: "d3" }] });
  assert.notEqual(other.id_set, null);
  assert.equal(other.repeat_of, null, "a batch of different items was reported as a repeat");
});

test("#1239 a call carrying no identifiable rows has no fingerprint and is never a repeat", () => {
  // `null` rather than the hash of an empty string: there is nothing to be identical TO, and a shared
  // hash for "carried nothing" would make every empty call a repeat of the first empty call.
  const d = runDir();
  const empty = recordClosures(specFor(d), { closures: [] });
  assert.equal(empty.id_set, null);
  assert.equal(empty.repeat_of, null);
  const alsoEmpty = recordClosures(specFor(d), { closures: [] });
  assert.equal(alsoEmpty.repeat_of, null, "two calls carrying nothing were matched to each other");
});

test("#1239 the hash reaches the call INDEX, so a repeat is readable after the run", () => {
  // The answer is transient; the index is the artifact a reader opens. If the hash lived only in the
  // return value, the evidence would exist exactly as long as the seat's turn.
  const d = runDir();
  recordClosures(specFor(d), { closures: [good] });
  recordClosures(specFor(d), { closures: [good] });
  const rows = indexLines(d);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].idSetHash, "the index row carries no id-set hash");
  assert.equal(rows[0].idSetHash, rows[1].idSetHash, "two identical calls wrote different hashes to the index");
});

// ── — THE REPEAT IS ANSWERED, NOT RE-RUN ───────────────────────────────────────────────────────

test("#1239 a repeat writes no second accepted file, so the artifact keeps ONE line per id", () => {
  // THE HALF THAT WAS COSTING CORRECTNESS, NOT TIME. `readAcceptedClosures` concatenates every
  // accepted-NNN.json and the render maps all of them, deduping nothing — so before this, a batch sent
  // twice put two lines per row into doubt-closure.md, and where a verdict had changed it put BOTH
  // answers in for the same id. That file is what `validators.doubtClosure` reads.
  const d = runDir();
  recordClosures(specFor(d), { closures: [good] });
  const again = recordClosures(specFor(d), { closures: [good] });

  assert.equal(again.served_from_ledger, true, "a re-sent batch was re-run instead of answered");
  assert.equal(again.recorded, null, "a repeat wrote a second accepted file");
  assert.equal(again.record_failed, null, "a repeat reported a record FAILURE rather than not attempting one");

  const art = readFileSync(join(d, "doubt-closure.md"), "utf8");
  const verdictLines = art.split("\n").filter((l) => /^(SETTLED|OPEN|IMMATERIAL) /.test(l));
  assert.equal(verdictLines.length, 1, `the artifact carries ${verdictLines.length} verdict lines for one row:\n${art}`);
});

test("#1239 a repeat carrying a CHANGED verdict does not put both answers in the artifact", () => {
  // The shape measured on the killed runs: the same id answered SETTLED on one call and OPEN on a later
  // one. Re-running produced a file asserting both at once. The id-set is what identifies the batch, so
  // the second call is served and the ledger keeps the answer it already recorded — the change is visible
  // in the captured payloads and the call index, which is where a disagreement belongs.
  const d = runDir();
  const openSame = { kind: "doubt", doubt_id: "d1", verdict: "open", reason: "cannot establish it on re-read" };
  recordClosures(specFor(d), { closures: [good] });
  const flip = recordClosures(specFor(d), { closures: [openSame] });

  assert.equal(flip.repeat_of, 1, "the same id sent again was not recognised as the same batch");
  const art = readFileSync(join(d, "doubt-closure.md"), "utf8");
  const forD1 = art.split("\n").filter((l) => / d1:/.test(l));
  assert.equal(forD1.length, 1, `two verdicts for one id reached the artifact:\n${art}`);
  // and the payload of the second call is still on disk, unfiltered — the disagreement is not erased
  const payloads = indexLines(d);
  assert.equal(payloads.length, 2, "the repeat was not captured as its own call");
});

test("#1239 a served answer re-derives still_open from the ledger — it is not an echo", () => {
  // The seat's next move is decided by `still_open`, so a stale echo would send it back for work already
  // done, which is the loop this is bounding.
  const d = runDir();
  recordClosures(specFor(d), { closures: [good] });                 // d1 settled
  const again = recordClosures(specFor(d), { closures: [good] });
  assert.equal(again.served_from_ledger, true);
  assert.ok(!again.still_open.includes("d1"), "a served answer listed an item the ledger has already closed");
  assert.deepEqual([...again.still_open].sort(), ["d2", "d3"], "the served answer did not re-derive what is owed");
});

test("#1239 `served_from_ledger` is written on BOTH paths", () => {
  // A key that appears only when it is true makes its absence mean two things: "not a repeat" and "this
  // build does not report repeats". The same rule the capture/record pairs above already follow.
  const d = runDir();
  const first = recordClosures(specFor(d), { closures: [good] });
  assert.equal(first.served_from_ledger, false);
  assert.equal(recordClosures(specFor(d), { closures: [good] }).served_from_ledger, true);
});

test("#1239 a NEW batch after a repeat is still judged — the serve does not latch", () => {
  // The failure that would make this worse than the loop: a stage that stops accepting work after its
  // first repeat would drop real verdicts and ship the doubts open.
  const d = runDir();
  recordClosures(specFor(d), { closures: [good] });
  recordClosures(specFor(d), { closures: [good] });                                  // served
  const fresh = recordClosures(specFor(d), { closures: [{ ...good, doubt_id: "d3" }] });
  assert.equal(fresh.served_from_ledger, false, "a fresh batch was served from the ledger after a repeat");
  assert.equal(fresh.accepted, 1, "a fresh batch after a repeat was not judged");
});
