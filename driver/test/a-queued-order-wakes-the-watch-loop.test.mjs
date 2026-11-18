// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// An order dropped into a queue waited for the watch loop's next 90 s tick before its search began. The loop now
// watches the queue folders and starts a drain when a job file lands, and keeps the tick as the guarantee for the
// cases a folder watch misses. These arms drive `watch()` against a real temporary folder and a counting stand-in for
// the drain, on the real clock: no queue is read, no pipeline runs and nothing is spent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// No real queue is visible to the import below, even if a tick ran for real.
pinEnv(process.env, "CLEAROTRON_WORK_DIR", mkdtempSync(join(tmpdir(), "clearotron-wake-")));
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const { watch, watchQueueFolders } = await import("../runner.mjs");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drive the loop on `folder` until `act` returns; the drains' start times, on the real clock. */
async function drive({ folder, watchFolder = true, tickMs = 60_000, sliceMs = 100, act, settleMs = 250 }) {
  const starts = [];
  let stop = false;
  const loop = watch({
    tickMs, sliceMs, settleMs,
    run: async () => { starts.push(Date.now()); },
    queueWatch: watchFolder ? (onJob) => watchQueueFolders(onJob, () => [folder]) : () => null,
    heartbeat: () => {}, stopped: () => stop,
  });
  await pause(150);                                     // the first tick has run and the loop is waiting
  await act();
  stop = true;
  await loop;
  return starts;
}

test("a job file landing in a queue folder starts a drain in under 2 s, not at the next tick", async () => {
  const folder = mkdtempSync(join(tmpdir(), "queue-"));
  try {
    let dropped = 0;
    // The loop's real 5 s slice: a wake that waited for the slice to end would miss the bar.
    const starts = await drive({ folder, sliceMs: 5_000, act: async () => {
      dropped = Date.now();
      writeFileSync(join(folder, "job-1.json"), "{}");
      await pause(2_000);
    } });
    assert.equal(starts.length, 2, `drains: ${starts.length}`);
    assert.ok(starts[1] - dropped < 2_000, `the drain began ${starts[1] - dropped} ms after the file landed`);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("with the folder watch silent, the tick still picks the order up", async () => {
  const folder = mkdtempSync(join(tmpdir(), "queue-"));
  try {
    const starts = await drive({ folder, watchFolder: false, tickMs: 600, act: async () => {
      writeFileSync(join(folder, "job-1.json"), "{}");
      await pause(1_000);
    } });
    assert.equal(starts.length, 2, "the tick did not run");
    assert.ok(starts[1] - starts[0] >= 550, `the second drain came before the tick could have: ${starts[1] - starts[0]} ms`);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("a burst of arrivals starts one drain, not one per file", async () => {
  const folder = mkdtempSync(join(tmpdir(), "queue-"));
  try {
    const starts = await drive({ folder, act: async () => {
      for (let k = 0; k < 20; k++) writeFileSync(join(folder, `job-${k}.json`), "{}");
      await pause(1_500);
    } });
    assert.equal(starts.length, 2, `twenty arrivals started ${starts.length - 1} drains`);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("a file that is not a job wakes nothing", async () => {
  const folder = mkdtempSync(join(tmpdir(), "queue-"));
  try {
    const starts = await drive({ folder, act: async () => {
      writeFileSync(join(folder, "job-1.processing"), "{}");
      await pause(800);
    } });
    assert.equal(starts.length, 1, "a claim marker woke the loop");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("a stop request still ends the loop within a slice, and the folder watch is released", async () => {
  let closed = false, stop = false;
  const loop = watch({
    tickMs: 60_000, sliceMs: 100, run: async () => {}, heartbeat: () => {}, stopped: () => stop,
    queueWatch: () => ({ rearm() {}, close() { closed = true; } }),
  });
  await pause(150);
  const asked = Date.now();
  stop = true;
  await loop;
  assert.ok(Date.now() - asked < 1_000, "the loop outlived its stop request by more than a slice");
  assert.equal(closed, true, "the folder watch was not released");
});

test("a folder that cannot be watched is left to the tick, and one made later is watched once re-armed", async () => {
  let woke = 0;
  const root = mkdtempSync(join(tmpdir(), "queues-"));
  const later = join(root, "later");
  const w = watchQueueFolders(() => { woke++; }, () => [join(root, "absent"), later]);
  try {
    mkdirSync(later);
    w.rearm();
    writeFileSync(join(later, "job-1.json"), "{}");
    await pause(500);
    assert.ok(woke > 0, "a queue folder made after the watch began was never watched");
  } finally { w.close(); rmSync(root, { recursive: true, force: true }); }
});
