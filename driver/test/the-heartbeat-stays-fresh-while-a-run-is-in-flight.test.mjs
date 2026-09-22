// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-heartbeat-stays-fresh-while-a-run-is-in-flight.test.mjs — the worker's beat must not go stale
// during the very thing it is meant to prove the worker is doing.
//
// MEASURED ON A LIVE RUN: the heartbeat file was forty minutes stale while the worker was alive and
// writing records throughout. It was seconds fresh when the box was idle, which is the reading that
// makes it dangerous — it looks like a liveness signal precisely when nothing is happening. The beat
// was written once per tick and the tick then awaited a whole clearance, which takes hours.
//
// Anything reading beat age as liveness would call that healthy run dead, and the obvious next act is
// to restart or kill it. The deploy pre-flight reads the claim, pid and status file instead, which is
// why nothing was lost.
//
// The arm drives the REAL loop with a run in flight, because a unit test of `beat()` passes either
// way — `beat` was never the broken part.
import { test } from "node:test";
import assert from "node:assert/strict";
import { watch } from "../runner.mjs";

/** A watch tick whose run takes "hours": it resolves only when the test lets it. */
const inFlightRun = () => {
  let release;
  const started = new Promise((r) => { release = r; });
  let resolveRun;
  const run = () => { release(); return new Promise((r) => { resolveRun = r; }); };
  return { run, started, finish: () => resolveRun() };
};

test("the beat keeps going while a tick's run is still running", async () => {
  const beats = [];
  const { run, started, finish } = inFlightRun();
  let fire = null;
  const watching = watch({
    ticks: 1, run, sleep: async () => {}, stopped: () => false,
    heartbeat: () => beats.push(beats.length),
    // The timer, driven by hand rather than by the clock: the point is that SOMETHING beats while the
    // run is awaited, not how many milliseconds the interval is.
    startBeating: (fn) => { fire = fn; return () => { fire = null; }; },
  });

  await started;
  assert.equal(beats.length, 1, "the tick's own opening beat is missing");
  assert.ok(fire, "nothing was scheduled to beat while the run is in flight");
  fire(); fire();
  assert.equal(beats.length, 3, "the beat did not continue during the run — this is the defect");

  finish();
  await watching;
  assert.equal(fire, null, "the beat timer outlived the run it was covering");
});

test("the timer stops even when the tick fails", async () => {
  let stopped = false;
  await watch({
    ticks: 1, sleep: async () => {}, stopped: () => false, heartbeat: () => {},
    run: async () => { throw new Error("a tick that failed"); },
    startBeating: () => () => { stopped = true; },
  });
  // A timer left running would go on beating for a worker that had stopped — a heartbeat that lies in
  // the one direction this module's fail-safe rule forbids.
  assert.ok(stopped, "a failed tick left the heartbeat beating for a worker that is no longer working");
});

test("the opening beat still comes before the tick's work", async () => {
  // Unchanged and load-bearing: a beat written only after the work would leave a freshly started
  // worker looking absent for its whole first tick, which is the window a user watches after pressing
  // Start.
  const order = [];
  await watch({
    ticks: 1, sleep: async () => {}, stopped: () => false,
    heartbeat: () => order.push("beat"),
    run: async () => { order.push("run"); },
    startBeating: () => () => {},
  });
  assert.deepEqual(order, ["beat", "run"], "the beat no longer precedes the tick's work");
});

test("the DEFAULT timer really beats during a run, on a real clock", async () => {
  // The arms above inject the timer, so they would pass over a default that never fired. This one
  // takes the default: a run that lasts long enough for a short interval to tick, and a count of the
  // beats that arrived while it was in flight.
  const beats = [];
  const { run, started, finish } = inFlightRun();
  const watching = watch({
    ticks: 1, run, sleep: async () => {}, stopped: () => false,
    heartbeat: () => beats.push(Date.now()),
    beatEveryMs: 10,          // the real setInterval path — no startBeating override
  });

  await started;
  const opening = beats.length;
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(beats.length > opening,
    `the default timer wrote no beat in 60ms at a 10ms interval (${beats.length} beats, opening ${opening})`);

  finish();
  await watching;
  // …and it stops with the run: no beat after the loop returns.
  const afterRun = beats.length;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(beats.length, afterRun, "the default timer went on beating after the run finished");
});
