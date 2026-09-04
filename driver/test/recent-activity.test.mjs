// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// recent-activity.test.mjs — buildRecentActivity builds one kind-tagged, newest-first list. retired
// the Quality hub, and with it the finished-check / auto-fix / overnight sources, whose only destination
// was a link into that hub — so the feed is REPORTS ONLY. Cost is not carried into the activity model
// either (dropped from the Run-status UI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecentActivity } from "../status-snapshot.mjs";

test("reports only, newest-first, kind-tagged; retired sources are ignored rather than half-rendered", () => {
  const rows = buildRecentActivity({
    reports: [
      { state: "delivered", deliveredAt: "2026-06-24T10:00:00Z", markName: "EMBER GUARD", verdict: "CONDITIONAL", runId: "tmp8642-x" },
      { state: "delivered", deliveredAt: "2026-06-24T11:00:00Z", markName: "OPEN COUNTRY", verdict: "CLEAR", runId: "tmp8643-y" },
    ],
    //: a stale caller still passing these gets them DROPPED, not rendered with a dead hub link.
    checks: [{ ts: "2026-06-24T12:00:00Z", kind: "quality-check", label: "NOVAPULSE", state: "done" }],
    fixes: [{ ts: "2026-06-24T09:00:00Z", clusterKey: "client-a|RAZER", outcome: { packaged: true, prUrl: "https://x/pull/9" } }],
    overnight: [{ at: "2026-06-24T04:00:00Z", skektech: { state: "ran", prs: ["a"] } }],
  });
  assert.deepEqual(rows.map((r) => r.kind), ["report", "report"], "only reports reach the feed");
  assert.equal(rows[0].label, "OPEN COUNTRY", "newest first — 11:00 before 10:00");
  assert.equal(rows[1].url, "tmp8642-x/report.html");               // delivered report deep-link
  assert.equal(rows[0].costUsd, undefined);                         // cost dropped from the activity model
  for (const r of rows) assert.doesNotMatch(r.url ?? "", /quality\.html/, "no row may link into the retired hub");
});

test("a failed report shows its stage; empty → []", () => {
  const rows = buildRecentActivity({
    reports: [{ state: "failed", failedStage: "synthesis", updatedAt: "2026-06-24T10:00:00Z", slug: "x" }],
  });
  assert.match(rows[0].outcome, /failed · synthesis/);
  assert.deepEqual(buildRecentActivity({}), []);
});

test("report rows carry ok (dot signal): delivered true, failed false", () => {
  const rows = buildRecentActivity({
    reports: [
      { state: "delivered", deliveredAt: "2026-07-01T10:00:00Z", markName: "A", runId: "a" },
      { state: "failed", failedStage: "synthesis", updatedAt: "2026-07-01T09:00:00Z", slug: "b" },
    ],
  });
  assert.equal(rows[0].ok, true);
  assert.equal(rows[1].ok, false);
});

test("an unparseable stamp sinks to the bottom with whenUnknown (page renders —), never fakes recency", () => {
  const rows = buildRecentActivity({
    reports: [
      { state: "delivered", deliveredAt: "not-a-date", markName: "GHOST", runId: "g" },
      { state: "delivered", deliveredAt: "2026-07-01T08:00:00Z", markName: "DATED", runId: "d" },
    ],
  });
  assert.equal(rows[0].label, "DATED", "dated row first");
  assert.equal(rows[1].whenUnknown, true);
  assert.equal(rows[1].whenMs, 0);
  assert.equal(rows[0].whenUnknown, undefined);
  assert.ok(rows[0].whenMs > 0, "one precomputed sort key per row");
});

//: the reaped-check vocabulary ('interrupted' / 'waiting for a slot') lived on the check rows this
// feed no longer builds. A check that is still ALIVE keeps its own bucket (statusSnapshot.checksInProgress,
// covered in status-snapshot.test.mjs); a finished one had nowhere left to be shown once the hub went.
