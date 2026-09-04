// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A WAVE MEMBER'S WALL IS A FACT ON ITS OWN ROW, NOT AN INFERENCE FROM ITS NEIGHBOUR'S.
//
// Every wave member already emitted a completion line; the issue's title describes the symptom, not the
// mechanism. What no row carried was a START. `appendLine` stamps exactly one instant, `ts`, at append
// time — the END. Serially the previous row's `ts` is a usable start proxy, so a stage's wall reads off
// the journal as [previous row, own row]. A wave destroys the proxy: N members are dispatched at one
// instant and their rows interleave by COMPLETION order, so the row before member k's row belongs to a
// sibling. Each member's wall then degenerates to [0, the wave's own wall], which is verbatim what the
// closing round reported — "between 0 and 10 minutes and the journal does not record which. An absence,
// not a zero."
//
// THE TEST THAT MATTERS IS THE OVERLAP ONE, AND THIS IS WHY. Capture the dispatch instant AFTER the
// stage's await instead of before it and every field is still present, every presence assertion still
// passes green, and every interval collapses to sub-millisecond — the journal then asserts that a
// 14-minute half took no time. Only a magnitude or overlap assertion can tell those apart. The
// universally-quantified presence checks live in operability.test.mjs over a real resumed run; this file
// owns the two properties that presence cannot express.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageWallFields } from "../pipeline.mjs";

test("#527 the three fields come from ONE computation, so they cannot drift", () => {
  // Exact, not approximate: the pair and the derived number are written by the same helper precisely so a
  // reader never subtracts ISO strings by hand and never finds the two disagreeing.
  assert.deepEqual(stageWallFields(1000, 4500), {
    dispatchedAt: "1970-01-01T00:00:01.000Z",
    settledAt: "1970-01-01T00:00:04.500Z",
    wallSec: 3.5,
  });
  // Sub-second walls are REAL on the code-side member, so the seconds are not rounded or floored. A
  // floor here would print 0 for a 400 ms stage, and 0 is what "did not run" looks like.
  assert.equal(stageWallFields(0, 400).wallSec, 0.4);
  assert.equal(stageWallFields(0, 1).wallSec, 0.001);
  // A zero-length interval is a legitimate measurement (a skip that hit a warm stat cache), and it is
  // still distinguishable from an absent one, which is null on the get_run surface and missing here.
  assert.equal(stageWallFields(5000, 5000).wallSec, 0);
});

test("#527 the boundaries are wall-clock instants, so sibling intervals can be compared at all", () => {
  // Not a monotonic clock. `process.hrtime` yields a duration with no instant, so an interval cannot be
  // placed on the run's timeline and overlap between siblings becomes uncomputable — which is the entire
  // deliverable. This asserts the pair is parseable as absolute time and ordered.
  const before = Date.now();
  const f = stageWallFields(before);
  const after = Date.now();
  assert.ok(Number.isFinite(Date.parse(f.dispatchedAt)), "dispatchedAt is an absolute instant");
  assert.ok(Date.parse(f.dispatchedAt) >= before && Date.parse(f.settledAt) <= after);
  assert.equal(f.wallSec, (Date.parse(f.settledAt) - Date.parse(f.dispatchedAt)) / 1000);
});

test("#527 two members dispatched as a wave produce OVERLAPPING intervals — the property the round needed", () => {
  // The wave's shape, in the small: two members start together and settle at different times. Read off
  // completion rows alone, member A's row is preceded by member B's and vice versa, so neither can use
  // its neighbour as a start. With boundaries on each row the overlap is arithmetic.
  const waveStart = 1_000_000;
  const a = stageWallFields(waveStart, waveStart + 600_000);          // 10 minutes
  const b = stageWallFields(waveStart, waveStart + 25_000);           // 25 seconds, settles first

  const overlaps = (x, y) => Date.parse(x.dispatchedAt) < Date.parse(y.settledAt)
    && Date.parse(y.dispatchedAt) < Date.parse(x.settledAt);
  assert.ok(overlaps(a, b), "concurrent members must overlap — if they do not, one interval is a point");
  assert.equal(a.wallSec, 600);
  assert.equal(b.wallSec, 25);

  // And the thing that could not be said before: which member bounded the wave. The ROW does not claim
  // it — no `boundedTheWave` field, no PASS — because that is an inference, and the harness records
  // rather than judges. It is the READER's arithmetic, and it is now available to be done.
  const longest = [a, b].reduce((m, x) => (x.wallSec > m.wallSec ? x : m));
  assert.equal(longest.wallSec, 600);
  assert.ok(!("boundedTheWave" in a) && !("onCriticalPath" in a),
    "the row states measured facts only — which member bounded the wave belongs to the reader");
});
