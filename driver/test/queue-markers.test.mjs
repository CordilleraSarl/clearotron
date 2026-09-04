// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the queue's live-state vocabulary, and the state the deploy guard could not see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveQueueMarker } from "../queue-markers.mjs";

test("#375: a PARKED run is live — the state the test deploy guard counted as zero", () => {
  // The guard refused correctly twice while R1 executed, then deployed ten seconds after the run parked
  // and restarted the services under it. The run resumed 110 seconds later, on a different commit.
  assert.ok(isLiveQueueMarker("job-a.postponed"), "a rate-limit or recovery park auto-resumes — it is live");
  assert.ok(isLiveQueueMarker("job-a.json"), "queued");
  assert.ok(isLiveQueueMarker("job-a.processing"), "claimed and executing");
  assert.ok(isLiveQueueMarker("job-a.processing.claimed-4321:99"), "claimed, mid-publish (#377's window)");
});

test("#375: terminal states are not live — nothing further happens to them", () => {
  for (const n of ["job-a.done", "job-a.failed", "job-a.cancelled", "job-a.duplicate"])
    assert.ok(!isLiveQueueMarker(n), `${n} is terminal`);
  // sidecars and results are not entries
  for (const n of ["job-a.processing.pid", "job-a.postponed.meta", "job-a.done.result", "job-a.failed.reason", "job-a.processing.skips"])
    assert.ok(!isLiveQueueMarker(n), `${n} is a sidecar, not a queue entry`);
  assert.ok(!isLiveQueueMarker(""), "empty");
  assert.ok(!isLiveQueueMarker(null), "null");
});

test("#375: the driver and the deploy guard read ONE definition", async () => {
  // The guard shells `scripts/queue-inflight.mjs`, which imports this module — the same predicate
  // runner.mjs uses for its queued/in-flight admission count. The failure being fixed is a rule written
  // down twice: the runner listed three live states and the guard's grep listed two.
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const q = mkdtempSync(join(tmpdir(), "qm-"));
  for (const n of ["a.json", "b.processing", "c.postponed", "d.done", "e.failed", "b.processing.pid"]) writeFileSync(join(q, n), "");
  const out = execFileSync(process.execPath, [new URL("../../scripts/queue-inflight.mjs", import.meta.url).pathname, q], { encoding: "utf8" }).trim();
  assert.equal(out, "3", "queued + in-flight + parked");
  const names = execFileSync(process.execPath, [new URL("../../scripts/queue-inflight.mjs", import.meta.url).pathname, "--names", q], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(names, ["a.json", "b.processing", "c.postponed"]);
});
