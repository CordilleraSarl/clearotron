// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The crash window between publishing and announcing.
//
// pipeline.mjs writes _driver/delivery.json → the outbox marker → status.sendPending. A process death
// inside that window (SIGKILL, OOM, the 2026-07-22 memory-pressure crash) leaves a FINISHED report
// with no marker and no sendPending. Crash-reclaim then correctly refuses to re-run it — the report
// exists — and marks the job .done, at which point every backstop scans past it: the outbox rescan
// looks for markers, the completion-watch looks for sendPending, and neither is there. The client
// never receives a report that was fully paid for and correctly produced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { armUnannouncedDelivery } from "../runner.mjs";

function runDir({ packet = true, sent = false, status = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "unannounced-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (packet) writeFileSync(driverDir(dir, "delivery.json"), JSON.stringify({ runId: "slug-codename" }));
  if (sent) writeFileSync(join(dir, ".sent"), "sent\n");
  if (status) writeFileSync(join(dir, "status.json"), JSON.stringify(status, null, 2));
  return dir;
}
const status = (dir) => JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));

test("a published-but-unannounced run is re-armed so the backstop can deliver it", () => {
  // exactly the crash shape: packet written, no marker, status still says the run was in flight
  const dir = runDir({ status: { state: "running", stepIndex: 12 } });
  assert.equal(armUnannouncedDelivery(dir, "job1"), "armed");
  const s = status(dir);
  assert.equal(s.sendPending, true, "the flag every delivery backstop scans for");
  assert.equal(s.state, "delivered", "and the state matches what actually happened on disk");
  assert.equal(s.stepIndex, 12, "existing status fields are preserved, not clobbered");
});

test("it is idempotent and never re-sends something already sent", () => {
  const sent = runDir({ sent: true, status: { state: "delivered", sendPending: false } });
  assert.equal(armUnannouncedDelivery(sent), "already-sent");
  assert.equal(status(sent).sendPending, false, "a sent run is never re-armed — that would double-send");

  const armed = runDir({ status: { state: "delivered", sendPending: true } });
  assert.equal(armUnannouncedDelivery(armed), "already-pending");

  // running it twice on the same dir changes nothing the second time
  const dir = runDir({ status: { state: "running" } });
  assert.equal(armUnannouncedDelivery(dir), "armed");
  assert.equal(armUnannouncedDelivery(dir), "already-pending");
});

test("a run with no delivery packet is left completely alone", () => {
  // archived-without-packet / legacy / genuinely-failed runs must not be announced as deliverable
  const dir = runDir({ packet: false, status: { state: "failed" } });
  assert.equal(armUnannouncedDelivery(dir), "no-packet");
  assert.equal(status(dir).sendPending, undefined);
  assert.equal(status(dir).state, "failed");
});

test("a missing status.json is treated as unarmed, not as an error", () => {
  const dir = runDir({ status: null });
  assert.equal(armUnannouncedDelivery(dir), "armed");
  assert.ok(existsSync(join(dir, "status.json")));
  assert.equal(status(dir).sendPending, true);
});
