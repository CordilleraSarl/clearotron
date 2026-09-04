// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// B — THE FOUR NEW FAILURE STATES.
//
// The typed transport removes one failure class and creates four. A transport whose new failures are
// unnamed is not safer than the one it replaced, it is quieter — and quieter is how the 2026-08-15 run
// was told `74 rows, not one edit` about a form carrying 74 rulings.
//
// ── THE REMEDY LEADS EVERY DETAIL, AND THAT IS NOT A STYLE CHOICE ───────────────────────────────────
//
// The fail token is bounded, and the bound cut mid-word through `…NOT a fault in the r` — deleting the
// one clause that stops a seat re-deriving 74 correct rulings after a call the DRIVER lost. Caught by the
// firing test, not by these: a unit test reads the detail before the token is composed, so the truncation
// is invisible here by construction. Every detail now opens with what to DO; the census and the counts
// come after, where losing them costs nothing.
//
// The distinction these tests exist to defend: under the old transport a seat that did NOTHING and a seat
// whose submission was DESTROYED produced the same artifact. Here they are different records, and the
// engine is required to say which.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditDispositionCalls, callPairs, capturedCalls, CALL_FAILURE_REASONS, TOOL_NAME } from "../disposition-call-audit.mjs";

const dir = () => mkdtempSync(join(tmpdir(), "prelim-call-audit-"));

// Rows in the shape stdio-server.mjs actually writes — read off its logToolEvent calls, not invented.
const started = (seq, tool = TOOL_NAME, server = "perplexity") => JSON.stringify({ ts: "2026-08-16T10:00:00Z", event: "started", seq, server, tool });
const settled = (seq, ok = true, tool = TOOL_NAME, server = "perplexity") => JSON.stringify({ ts: "2026-08-16T10:00:01Z", event: "settled", seq, server, tool, ok });

function logs(rows = [], captures = 0) {
  const d = dir();
  const toolCallsPath = join(d, "tool-calls.jsonl");
  const callIndexPath = join(d, "index.jsonl");
  writeFileSync(toolCallsPath, rows.join("\n") + (rows.length ? "\n" : ""));
  writeFileSync(callIndexPath, Array.from({ length: captures }, (_, i) => JSON.stringify({ seq: i + 1 })).join("\n") + (captures ? "\n" : ""));
  return { toolCallsPath, callIndexPath };
}

// ── THE FOUR STATES ─────────────────────────────────────────────────────────────────────────────────

test("NEVER MADE: rows are owed and no call was ever started", () => {
  // A first-class failure, not a zero. This is the state the old transport could not tell apart from a
  // destroyed submission, and telling them apart is the point of the whole redesign.
  const p = logs([], 0);
  const r = auditDispositionCalls({ ...p, owed: 74, recorded: 0 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.NEVER_MADE);
  assert.match(r.detail, /never called/);
  assert.match(r.detail, /Not a formatting problem/, "the seat must not go hunting for a shape error");
});

test("TRUNCATED: a call started and never returned", () => {
  // The evidence is the ABSENCE of the second line. A killed process writes no epilogue, so nothing else
  // can express this — which is why it is read off the shipped log rather than a record of our own.
  const p = logs([started(1), settled(1), started(2)], 2);
  const r = auditDispositionCalls({ ...p, owed: 25, recorded: 25 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.TRUNCATED);
  assert.equal(r.count, 1);
  assert.match(r.detail, /^NOT a fault in your rulings/,
    "and it leads with that — see the ordering note at the head of this file");
});

test("SCHEMA VIOLATION: calls arrived and nothing was ever accepted", () => {
  const p = logs([started(1), settled(1, false)], 1);
  const r = auditDispositionCalls({ ...p, owed: 74, recorded: 0 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.SCHEMA);
  assert.match(r.detail, /^Check the payload SHAPE/, "and it leads with the shape to check, not with the count");
});

test("PARTIAL: rows landed and obligations remain", () => {
  const p = logs([started(1), settled(1)], 1);
  const r = auditDispositionCalls({ ...p, owed: 49, recorded: 25 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.PARTIAL);
  assert.match(r.detail, /^Send only what is left/, "the remedy leads");
  assert.match(r.detail, /are KEPT/, "the old transport's disease was one bad row voiding good ones");
  // — this asserted /anchor/, which is how a test comes to DEFEND a retired dictation: the field
  // was gone from the tool and this line still required the detail to name it. Both current fields, so a
  // half-migration cannot pass either.
  assert.match(r.detail, /`segment_index`/, "it points at the field the answer marks");
  assert.match(r.detail, /`fragment`/, "…and at the other half of the same proof");
  assert.doesNotMatch(r.detail, /`anchor`/, "the retired field must not come back through this detail");
});

test("nothing outstanding is nothing to report", () => {
  const p = logs([started(1), settled(1)], 1);
  assert.equal(auditDispositionCalls({ ...p, owed: 0, recorded: 74 }), null);
});

// ── PRECEDENCE — the first match must be the cause, never the symptom ───────────────────────────────

test("a killed call is reported as TRUNCATED, not as the partial state it also is", () => {
  // Both are true. `partial` names what the seat can already see; `truncated` names the cause it cannot.
  // Reporting the symptom would be honest and useless.
  const p = logs([started(1), settled(1), started(2)], 2);
  const r = auditDispositionCalls({ ...p, owed: 49, recorded: 25 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.TRUNCATED);
});

test("a turn with no calls at all is NEVER MADE, not PARTIAL", () => {
  const p = logs([], 0);
  assert.equal(auditDispositionCalls({ ...p, owed: 74, recorded: 0 }).reason, CALL_FAILURE_REASONS.NEVER_MADE);
});

// ── AN UNREADABLE RECORD IS NOT AN EMPTY ONE ────────────────────────────────────────────────────────

test("an unreadable tool log must never produce NEVER MADE", () => {
  // A confident accusation built on a file we failed to open. A run predating the log, or a log we lack
  // permission to read, looks identical to a seat that did nothing — and only one of those is the seat's
  // fault. `partial` is the honest floor: work remains, and we assert nothing about calls we could not see.
  const r = auditDispositionCalls({ toolCallsPath: "/nonexistent/tool-calls.jsonl", callIndexPath: "/nonexistent/index.jsonl", owed: 74, recorded: 0 });
  assert.notEqual(r.reason, CALL_FAILURE_REASONS.NEVER_MADE);
  assert.equal(r.reason, CALL_FAILURE_REASONS.PARTIAL);
});

test("callPairs reports UNREADABLE distinctly from zero calls", () => {
  assert.equal(callPairs("/nonexistent/x.jsonl").readable, false, "'cannot look' must not print as 'nothing there'");
  const p = logs([], 0);
  assert.equal(callPairs(p.toolCallsPath).readable, true);
  assert.equal(callPairs(p.toolCallsPath).started, 0, "…and a readable empty log IS zero calls");
});

test("capturedCalls returns null for unreadable and a number for readable", () => {
  assert.equal(capturedCalls("/nonexistent/index.jsonl"), null);
  assert.equal(capturedCalls(logs([], 3).callIndexPath), 3);
});

// ── THE LOG IS SHARED, SO THE READING MUST BE SPECIFIC ─────────────────────────────────────────────

test("another tool's calls are not read as ours", () => {
  // tool-calls.jsonl carries every tool on every server in the run. Counting rows rather than filtering
  // would report a grid call as a disposition call and hide a never_made behind it.
  const p = logs([started(1, "perplexity_research"), settled(1, true, "perplexity_research")], 0);
  const r = auditDispositionCalls({ ...p, owed: 74, recorded: 0 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.NEVER_MADE);
});

test("the seq counter is PER PROCESS, so pairing keys on server AND seq", () => {
  // A server is spawned per stage and each process counts from 1. Keyed on seq alone, process B's
  // `settled 1` would close process A's `started 1` and a truncated call would read as complete.
  const p = logs([started(1, TOOL_NAME, "perplexity"), settled(1, true, TOOL_NAME, "perplexity-2")], 1);
  const r = auditDispositionCalls({ ...p, owed: 49, recorded: 25 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.TRUNCATED,
    "the unsettled call on the first server must not be closed by a different process's settle");
});

test("a malformed line is skipped without taking the file with it", () => {
  const p = logs(["{not json", started(1), settled(1), started(2)], 2);
  const r = auditDispositionCalls({ ...p, owed: 49, recorded: 25 });
  assert.equal(r.reason, CALL_FAILURE_REASONS.TRUNCATED, "one bad line must not blind the audit");
});

// ── VOID CONTROLS ───────────────────────────────────────────────────────────────────────────────────

test("VOID CONTROL: the four reasons are distinct strings and all four are reachable", () => {
  const names = Object.values(CALL_FAILURE_REASONS);
  assert.equal(new Set(names).size, 4, "two states sharing a name is two states nobody can tell apart");
  const seen = new Set([
    auditDispositionCalls({ ...logs([], 0), owed: 74, recorded: 0 }).reason,
    auditDispositionCalls({ ...logs([started(1)], 1), owed: 74, recorded: 0 }).reason,
    auditDispositionCalls({ ...logs([started(1), settled(1, false)], 1), owed: 74, recorded: 0 }).reason,
    auditDispositionCalls({ ...logs([started(1), settled(1)], 1), owed: 49, recorded: 25 }).reason,
  ]);
  assert.deepEqual([...seen].sort(), [...names].sort(), "a reason no input reaches is a dead branch");
});

test("VOID CONTROL: the fixture log really parses as the shape stdio-server writes", () => {
  // If the fixture drifted from the writer's shape, every filter above would match nothing and the
  // never_made tests would pass by finding no calls — an absence reading as a pass.
  const row = JSON.parse(started(1));
  for (const k of ["event", "seq", "server", "tool"]) assert.ok(k in row, `stdio-server writes \`${k}\``);
  assert.equal(row.tool, TOOL_NAME);
});

// ── EVERY DETAIL MUST FIT THE TOKEN'S BOUND, so nothing is cut at all ───────────────────────────────
//
// The composed fail token slices the detail at 200 characters. The first version of these correctives put
// the remedy LAST and the bound deleted it — a seat was told to re-derive 74 correct rulings after a call
// the driver lost. Leading with the remedy fixed the correctness; two details still stopped mid-word.
//
// Both were then made to FIT rather than cut cleanly, because nothing lost beats a tidy truncation.
//
// A NEGATIVE RESULT WORTH KEEPING: the overflow is NOT scale-dependent. A 1-row fixture and a real 74-row
// form render within one character of each other (237 vs 238), because only the interpolated counts vary.
// So a small fixture would have exposed this exactly as well as a large one — the single reason it hid is
// that the unit tests read the detail BEFORE the token is composed. One hiding place, not two. Recorded
// because an untested theory left standing becomes somebody's assumption later.
const DETAIL_BOUND = 200;

test("every corrective FITS the token bound — nothing is truncated at any scale", () => {
  const shapes = [
    { name: "never_made", p: logs([started(1, "perplexity_research"), settled(1, true, "perplexity_research")], 0) },
    { name: "truncated", p: logs([started(1), settled(1), started(2)], 2) },
    { name: "schema", p: logs([started(1), settled(1, false)], 1) },
    { name: "partial", p: logs([started(1), settled(1)], 1) },
  ];
  // Both ends of the realistic range: a single-row half, and the 74-row form at the centre of the
  // 2026-08-15 failure. Scale-independence is asserted rather than assumed.
  for (const [owed, recorded] of [[1, 0], [1, 1], [74, 0], [49, 25], [3, 71]]) {
    for (const { name, p } of shapes) {
      const r = auditDispositionCalls({ ...p, owed, recorded });
      if (!r) continue;
      assert.ok(r.detail.length <= DETAIL_BOUND,
        `${name} at (${owed},${recorded}) renders ${r.detail.length} chars and the token slices at ${DETAIL_BOUND} — the tail would be cut off a sentence a seat has to act on`);
    }
  }
});

test("VOID CONTROL: the bound is one a real detail could plausibly exceed", () => {
  // If DETAIL_BOUND drifted far above anything these produce, the test above would pass by measuring
  // nothing. The longest real detail must be within reach of the bound rather than trivially under it.
  const longest = Math.max(...[[74, 0], [49, 25]].flatMap(([o, r]) =>
    [logs([started(1), settled(1), started(2)], 2), logs([started(1), settled(1, false)], 1)]
      .map((p) => auditDispositionCalls({ ...p, owed: o, recorded: r })?.detail.length ?? 0)));
  assert.ok(longest > DETAIL_BOUND * 0.7,
    `the longest detail is ${longest} against a ${DETAIL_BOUND} bound — this guard is measuring slack, not fit`);
});
