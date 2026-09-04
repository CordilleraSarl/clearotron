// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-queued-job-is-visible-before-a-worker-claims-it.test.mjs — the dashboard, between submit and claim.
//
// THE DEFECT. A search submitted through the portal appeared NOWHERE on the
// dashboard until a worker claimed it — 87 seconds on the reported run. Not queued, not running. The
// owner's words: "several minutes from submitting it in the UI to it appearing — from a user
// perspective that's unacceptable, I thought it was lost." A submission that vanishes is read as lost,
// and the reader's next move is to submit it again.
//
// The queued-row machinery was not missing. It was built, it carries the brand owner, the product, the
// submitted time and the position in the line, and it already distinguishes "waiting for a worker" from
// "waiting to start". IT WAS NEVER CALLED. `scanAccountRuns` looked for queues at exactly one shape —
// `workspace-*/studio/prelim-search/queue` — and a documented headless install has no workspaces at all.
//
// Measured on the test box: `CLEAROTRON_QUEUE_DIR=/home/testuser/trademark/queue`, that directory is the
// ONLY queue anywhere under the tree, and it holds portal-prefixed jobs. The scan ran zero times.
//
// WHY EVERY EXISTING ARM PASSED THROUGH ALL OF IT. portal-queue-order.test.mjs and portal-service's own
// queued-row arm both BUILD a workspace queue — the one shape where the old code works. They pass today,
// and they would pass against a fix that never looked anywhere else. The deployment that ships is the
// one nothing tested.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanAccountRuns } from "../portal-service.mjs";

/** A deployment with a configured intake queue and NO agent workspaces — the documented install. */
function headless(jobs) {
  const root = mkdtempSync(join(process.env.TMPDIR || "/tmp", "q1918-"));
  const poolRoot = join(root, "pool");
  const workspaceRoot = join(root, "workspaces");
  const queue = join(root, "queue");
  for (const d of [poolRoot, workspaceRoot, queue]) mkdirSync(d, { recursive: true });
  for (const j of jobs) writeFileSync(join(queue, `${j.id}.json`), JSON.stringify(j));
  return { poolRoot, workspaceRoot, queue, root };
}

const JOB = {
  id: "portal-mta0j1im-py3cn2", profileKey: "aurora", markName: "LUMEN",
  product: "knockout-search", marks: [{ name: "LUMEN" }, { name: "LUMEN GO" }],
};

test("THE DEFECT: a headless install shows the job the moment it is queued", () => {
  const w = headless([JOB]);

  // What shipped: the scan is handed no queue list, finds no workspaces, and reports nothing at all.
  // This is not a weaker assertion than the one below — it is the measured behaviour, and it is why a
  // client watched an empty dashboard for a minute and a half.
  assert.deepEqual(
    scanAccountRuns({ poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot, account: "aurora" }),
    [], "precondition: without the queue list there is nothing to see — the reported defect",
  );

  const rows = scanAccountRuns({
    poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot, account: "aurora", queueDirs: [w.queue],
  });
  const queued = rows.filter((r) => r.state === "queued");
  assert.equal(queued.length, 1, "the submission is on the dashboard before any worker touches it");

  // The acceptance criteria, read off the row: it says whose it is, what it is, and when it went in.
  const row = queued[0];
  assert.equal(row.runId, JOB.id);
  assert.equal(row.account, "aurora", "the brand owner");
  assert.equal(row.product, "knockout-search", "the product ordered");
  assert.equal(row.kind, "knockout-batch", "…and the pipeline that product actually runs");
  assert.ok(row.issuedAt, "the time it was submitted");
  assert.equal(row.queuePos, 1, "and its place in the line");
  assert.match(String(row.step), /Waiting/, "with a step that says it is waiting rather than nothing");
});

test("a multi-name submission is named by its names, not by a job id nobody recognises", () => {
  const w = headless([JOB]);
  const row = scanAccountRuns({ poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot,
    account: "aurora", queueDirs: [w.queue] }).find((r) => r.state === "queued");
  assert.match(String(row.markName), /LUMEN/, "the row carries the mark the client typed");
});

test("ownership holds on a headless queue exactly as it does on a workspace one", () => {
  // The queue is shared across every brand owner on the deployment — it is one directory. A row that
  // leaked would publish another tenant's pending work, which is the boundary the 404-never-403 rule
  // exists to protect, arriving through a new door.
  const w = headless([JOB, { ...JOB, id: "portal-other", profileKey: "zephyr", markName: "SOMEONE-ELSE" }]);
  const mine = scanAccountRuns({ poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot,
    account: "aurora", queueDirs: [w.queue] }).filter((r) => r.state === "queued");
  assert.deepEqual(mine.map((r) => r.runId), [JOB.id], "only this account's job");
  const theirs = scanAccountRuns({ poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot,
    account: "zephyr", queueDirs: [w.queue] }).filter((r) => r.state === "queued");
  assert.deepEqual(theirs.map((r) => r.runId), ["portal-other"], "…and the other account sees only its own");
});

test("a queue reachable both ways is read ONCE", () => {
  // `config.queueDirs` lists the workspace queues too, so a mixed deployment reaches the same directory
  // through the configured list AND through the walk. Reading it twice would list every job twice and
  // give each row two positions in the line — a defect that looks like the queue is backed up.
  const root = mkdtempSync(join(process.env.TMPDIR || "/tmp", "q1918-both-"));
  const poolRoot = join(root, "pool");
  const workspaceRoot = join(root, "workspaces");
  const q = join(workspaceRoot, "workspace-clawdi", "studio", "prelim-search", "queue");
  mkdirSync(poolRoot, { recursive: true });
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, `${JOB.id}.json`), JSON.stringify(JOB));

  const rows = scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora", queueDirs: [q] })
    .filter((r) => r.state === "queued");
  assert.deepEqual(rows.map((r) => r.runId), [JOB.id], "one job, one row");
  assert.deepEqual(rows.map((r) => r.queuePos), [1], "and one position");
});

test("the workspace queue still works on its own — this ADDS a place to look", () => {
  // The union is deliberate. A deployment whose queue is not in the configured list keeps working, so
  // this cannot break a box by being deployed to it.
  const root = mkdtempSync(join(process.env.TMPDIR || "/tmp", "q1918-ws-"));
  const poolRoot = join(root, "pool");
  const workspaceRoot = join(root, "workspaces");
  const q = join(workspaceRoot, "workspace-clawdi", "studio", "prelim-search", "queue");
  mkdirSync(poolRoot, { recursive: true });
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, `${JOB.id}.json`), JSON.stringify(JOB));

  const rows = scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" })   // no queueDirs at all
    .filter((r) => r.state === "queued");
  assert.deepEqual(rows.map((r) => r.runId), [JOB.id], "found by the walk, as before");
});

test("CONTROL: an empty queue list on a headless box finds nothing, so the queue is what produces the row", () => {
  const w = headless([JOB]);
  for (const dirs of [[], [join(w.root, "does-not-exist")], ["", null]]) {
    assert.deepEqual(
      scanAccountRuns({ poolRoot: w.poolRoot, workspaceRoot: w.workspaceRoot, account: "aurora", queueDirs: dirs })
        .filter((r) => r.state === "queued"), [],
      `queueDirs=${JSON.stringify(dirs)} finds nothing — and neither throws`,
    );
  }
});
