// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Timeline-projection tests (decision_timeline + run_changes both fold over this). Lib imported in before().

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildFixture, buildRichRun, RUN_ID, RUN_ID2 } from "./_fixture.mjs";

let runs, events;

before(async () => {
  buildFixture();
  buildRichRun();
  runs = await import("../lib/runs.mjs");
  events = await import("../lib/events.mjs");
});

test("projectTimeline orders milestones, stamps a monotonic seq, groups by phase", () => {
  const run = runs.resolveRun(RUN_ID);
  const { timeline } = events.projectTimeline(events.readEvents(run.runDir), run.P);
  assert.ok(timeline.length > 5);
  assert.equal(timeline[0].kind, "start");
  timeline.forEach((t, i) => assert.equal(t.seq, i));
  const digest = timeline.find((t) => t.stage === "register-digest");
  assert.equal(digest.phase, "Placement & digest");
  assert.equal(digest.changedFromPrevious, null); // first sighting of the stage
});

test("escalation rationale is attached from skeptic-flags.md", () => {
  const run = runs.resolveRun(RUN_ID);
  const { timeline } = events.projectTimeline(events.readEvents(run.runDir), run.P);
  const esc = timeline.find((t) => t.kind === "skeptic-escalation");
  assert.deepEqual(esc.escalated, ["primary-sweep"]);
  assert.equal(esc.rationale.source, "skeptic-flags.md");
  assert.match(esc.rationale.text, /ESCALATE/i);
});

test("rich run: re-digest flips changedFromPrevious; verdictHistory is ordered; verdict rationale attached", () => {
  const run = runs.resolveRun(RUN_ID2);
  const { timeline, verdictHistory } = events.projectTimeline(events.readEvents(run.runDir), run.P);
  const digests = timeline.filter((t) => t.stage === "register-digest");
  assert.equal(digests.length, 2);
  assert.equal(digests[0].changedFromPrevious, null);   // first
  assert.equal(digests[1].changedFromPrevious, true);   // sha changed on the escalation re-digest
  assert.equal(digests[1].trigger, "escalation");
  assert.deepEqual(verdictHistory, ["BLOCKING", "CONDITIONAL"]);
  assert.ok(timeline.some((t) => t.kind === "delivered-with-open-questions"));
  const v = timeline.find((t) => t.kind === "verdict");
  assert.equal(v.rationale.source, "senior-eye-review.md");
  assert.match(v.rationale.text, /MYRKUR conflict/i);
});

test("sinceTs filter (run_changes) keeps original seq numbers and drops older events", () => {
  const run = runs.resolveRun(RUN_ID2);
  const all = events.projectTimeline(events.readEvents(run.runDir), run.P).timeline;
  const midTs = all[2].ts;
  const { timeline } = events.projectTimeline(events.readEvents(run.runDir), run.P, { sinceTs: midTs });
  assert.ok(timeline.length > 0 && timeline.length < all.length);
  assert.ok(timeline.every((t) => String(t.ts) > String(midTs)));
  assert.equal(timeline[0].seq, 3); // seq assigned over the full log, not renumbered after filtering
});

test("seq cursor survives same-millisecond events where a ts cursor would drop them", () => {
  const P = runs.resolveRun(RUN_ID).P;
  const SAME = "2026-01-01T00:00:00.000Z";
  const evs = [
    { ts: SAME, event: "start", agent: "t" },
    { ts: SAME, event: "screen-gate-clean" },          // same ms as the cursor event
    { ts: SAME, event: "verdict", verdict: "CLEAR" },  // same ms again
  ];
  // ts-based re-poll with since = the start's ts drops BOTH trailing same-ms events (the bug) ...
  assert.equal(events.projectTimeline(evs, P, { sinceTs: SAME }).timeline.length, 0);
  // ... while a seq cursor (=0, the start) retains them.
  const bySeq = events.projectTimeline(evs, P, { sinceSeq: 0 }).timeline;
  assert.deepEqual(bySeq.map((t) => t.seq), [1, 2]);
});

// ── post-merge audit, problem 6: attempts on a lawyer-facing timeline ──────────────────────────
// put one `attempt` row on run.jsonl per model dispatch. classify gained the case and
// projectTimeline emits every classified row with no kind filter, so every stage started producing BOTH
// `attempt-succeeded` and `stage-completed` — +61 entries on 269 (+23%) on the 2026-07-29 delivered run,
// roughly double on a correction-heavy one. That was a side effect, not a decision. The deliberate call:
// a SUCCEEDED attempt is not a decision (stage-completed already says it) and is folded out; a FAILED one
// says something no other entry does ("this stage had to be re-dispatched, and here is why") and stays.
test("a SUCCEEDED attempt is folded out of the timeline — stage-completed already tells it", () => {
  const P = runs.resolveRun(RUN_ID).P;
  const evs = [
    { ts: "2026-07-29T19:00:00.000Z", event: "start", agent: "clawdi" },
    { ts: "2026-07-29T19:10:00.000Z", event: "attempt", stage: "register-digest", attempt: 1, of: 3, ok: false, fail: "status_overloaded" },
    { ts: "2026-07-29T19:12:00.000Z", event: "attempt", stage: "register-digest", attempt: 2, of: 3, ok: true, fail: null },
    { ts: "2026-07-29T19:13:07.133Z", event: "stage", stage: "register-digest", trigger: "fresh", ok: true, attempts: 2,
      output: { name: "register-findings.md", sha: "1ba8feb88bef", size: 112422, present: true } },
  ];
  const { timeline } = events.projectTimeline(evs, P);
  assert.deepEqual(timeline.map((t) => t.decision), ["run-started", "attempt-failed", "stage-completed"],
    "the retry and its cause survive; the winning dispatch is not narrated twice");
  const failed = timeline.find((t) => t.decision === "attempt-failed");
  assert.equal(failed.fail, "status_overloaded", "the cause is what makes a failed attempt worth an entry");
  assert.equal(failed.attempt, 1);
});

test("folding an attempt out does NOT renumber seq — a poll cursor never re-reads or skips history", () => {
  const P = runs.resolveRun(RUN_ID).P;
  const evs = [
    { ts: "2026-07-29T19:00:00.000Z", event: "start", agent: "clawdi" },
    { ts: "2026-07-29T19:12:00.000Z", event: "attempt", stage: "register-digest", attempt: 1, of: 3, ok: true, fail: null },
    { ts: "2026-07-29T19:13:00.000Z", event: "stage", stage: "register-digest", trigger: "fresh", ok: true, attempts: 1 },
    { ts: "2026-07-29T19:14:00.000Z", event: "verdict", verdict: "CONDITIONAL" },
  ];
  const { timeline } = events.projectTimeline(evs, P);
  assert.deepEqual(timeline.map((t) => t.seq), [0, 2, 3], "seq is assigned over the FULL log; 1 is simply unused");
  // …and a cursor held at the entry before the fold still returns exactly the entries after it
  assert.deepEqual(events.projectTimeline(evs, P, { sinceSeq: 0 }).timeline.map((t) => t.seq), [2, 3]);
});
