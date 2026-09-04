// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// usage-ledger-standalone-queue.test.mjs — the allowance counter reads the ledger the WALL reads, on the
// deployment shape that broke it.
//
// THE FIXTURE IS THE POINT. runcaps-default.test.mjs builds its queue INSIDE a workspace
// (<root>/workspace-clawdi/studio/prelim-search/queue), which is the layout the old workspace-relative
// reconstruction was written for — so it passed while the deployed product counted zero for every
// account. Here the queue is a standalone directory with the ledger beside it, exactly as
// CLEAROTRON_QUEUE_DIR deployments run, and there is no workspace anywhere.
//
// Everything below asks one question in two directions: does the count agree with the wall, and does it
// say so when it cannot count at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { checkRunCaps, matterLedgerPath: fromRunner } = await import("../runner.mjs");
const { accountUsage, matterLedgerPath: fromLeaf } = await import("../usage-ledger.mjs");

const DAY = "2026-08-05T10:00:00.000Z";
const NOW = Date.parse(DAY);
const matterLedgerPath = fromLeaf;
const row = (over = {}) => ({ profileKey: "petcary", clientPrincipal: true, ts: NOW, msgId: `m${Math.random()}`, ...over });

/** The deployment shape was found on: <root>/queue + <root>/.matter-ledger.jsonl, no workspace. */
function standalone(rows = null) {
  const root = mkdtempSync(join(tmpdir(), "standalone-q-"));
  const qdir = join(root, "queue");
  mkdirSync(qdir, { recursive: true });
  if (rows) writeFileSync(matterLedgerPath(qdir), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  return { root, qdir };
}
const usage = (queueDirs) => accountUsage({ queueDirs, account: "petcary", now: NOW });

// ── One calculation, not two that agree today ──────────────────────────────────────────────────────

test("the wall and the pre-check share ONE ledger-path function — the SAME function object", () => {
  // Reference equality, not equal output: two copies that currently agree is the defect (,),
  // and only identity can fail when someone reintroduces a second correct copy.
  assert.equal(fromRunner, fromLeaf, "runner.mjs and usage-ledger.mjs hold two ledger-path functions again");
});

test("the ledger path is derived from the QUEUE dir, wherever the queue lives", () => {
  assert.equal(matterLedgerPath("/srv/tm/queue"), "/srv/tm/.matter-ledger.jsonl");
  // the workspace-embedded layout still resolves the way it always did
  assert.equal(matterLedgerPath("/h/agentplatform/workspace-clawdi/studio/prelim-search/queue"),
    "/h/agentplatform/workspace-clawdi/studio/prelim-search/.matter-ledger.jsonl");
});

// ── The count, on the shape that broke ─────────────────────────────────────────────────────────────

test("a queue OUTSIDE any workspace: the counter finds the ledger the wall finds", () => {
  const { qdir } = standalone([row(), row({ failed: true }), row({ clientPrincipal: undefined })]);
  const u = usage([qdir]);
  assert.equal(u.complete, true, "a real queue with a real ledger is a count we took");
  assert.equal(u.today, 1, "the standalone-queue ledger was not read — this is the #429 zero");
  assert.equal(u.thisMonth, 3, "the monthly SPEND figure counts failed and staff runs too");
});

test("the pre-check refuses at exactly the run the wall refuses", () => {
  const { qdir } = standalone([row(), row()]);
  const caps = { dailyRuns: 2 };
  const u = usage([qdir]);
  // the wall's own answer for the same account, the same day, the same ledger
  const wall = checkRunCaps({ account: "petcary", caps, queueDirs: [qdir], now: NOW, clientRun: true });
  assert.match(String(wall), /daily allowance/, "fixture does not reach the wall's cap");
  assert.equal(u.today + 1 > caps.dailyRuns, true,
    "the screen would have admitted a run the wall refuses — the exact lie usage-ledger.mjs exists to prevent");
});

test("queued counts the wall's live markers, including a mid-publish claim", () => {
  const { qdir } = standalone([]);
  for (const f of ["a.json", "b.processing", "c.postponed", "d.processing.claimed-tok9", "e.done", "f.failed"]) {
    writeFileSync(join(qdir, f), JSON.stringify({ profileKey: "petcary" }));
  }
  assert.equal(usage([qdir]).queued, 4, "`.processing.claimed-*` is live and must be counted (#375)");
});

// ── An absence must never read as a pass ───────────────────────────────────────────────────────────
//
// `complete` answers ONE question: was a ledger read. It must not answer "does a directory I was named
// exist", and the first attempt at this patch did exactly that — which is a flag that is CONSTANT TRUE in
// production, because driver.config appends the canonical queue with no existence test and drainQueue
// mkdir -p's whatever it is handed. The test below marked THE DISCRIMINATOR is the one that fails if
// anyone reintroduces it; the others fence the states around it.

test("THE DISCRIMINATOR: a queue that EXISTS with no ledger beside it is blind, not zero", () => {
  // The exact production shape: a portal handed the canonical queue (on disk, drainQueue made
  // it) while the ledger the wall writes sits beside a different queue entirely. Every account then read
  // as a confident 0 and the client-facing 429 could never fire. From in here "no ledger where I was told
  // to look" is the SAME observation a fresh deployment makes — so it reports blind, and the fresh box
  // stops being blind at the first run it admits (recordMatter appends at claim, not at completion).
  const { qdir } = standalone(null);   // queue exists, ledger absent
  const u = usage([qdir]);
  assert.equal(u.complete, false, "an existing directory was mistaken for a ledger that was read");
  assert.equal(u.basis, "no-ledger");
  assert.equal(u.today, 0);
});

test("an EMPTY ledger file IS a count — a read that returned no rows is a zero with evidence behind it", () => {
  // The other side of the discriminator, and the reason `complete` keys on the read rather than on the
  // row count: this deployment is correctly wired and genuinely has spent nothing today.
  const { qdir } = standalone([]);   // ledger written, zero rows
  const u = usage([qdir]);
  assert.equal(u.complete, true, "a ledger that opened and held nothing was reported as unreadable");
  assert.equal(u.basis, "counted");
  assert.equal(u.today, 0);
  assert.equal(checkRunCaps({ account: "petcary", caps: { dailyRuns: 2 }, queueDirs: [qdir], now: NOW, clientRun: true }),
    null, "the wall admits here, so the counter must agree it is a zero rather than an unknown");
});

test("EMPTY input: no queue dirs at all is `complete:false`, never a confident zero", () => {
  const u = usage([]);
  assert.equal(u.complete, false, "counting nothing was reported as a count");
  assert.equal(u.basis, "no-queues", "unwired and empty are different faults and get different names");
  assert.equal(u.today, 0);
});

test("MISSING input: an omitted queueDirs is `complete:false` rather than throwing or passing", () => {
  const u = accountUsage({ account: "petcary", now: NOW });
  assert.equal(u.complete, false);
  assert.equal(u.basis, "no-queues");
  assert.equal(u.today, 0);
  assert.equal(accountUsage({ queueDirs: null, account: "petcary", now: NOW }).complete, false);
});

test("MISSING dir: a queue dir named but not on disk is `complete:false` — the wrong-path shape itself", () => {
  const u = usage([join(tmpdir(), "no-such-queue-429", "queue")]);
  assert.equal(u.complete, false, "a path that does not exist counted as zero runs today");
  assert.equal(u.basis, "no-ledger");
  assert.equal(u.today, 0);
});

// SKIPPED under root rather than returned early: root reads through mode 000, so there is no denial to
// assert — and a test that quietly asserts nothing reports `ok`, which is the shape of pass this whole
// file exists to refuse.
test("an UNREADABLE ledger is `complete:false` — a low number is not the same as no number",
  { skip: process.getuid?.() === 0 ? "root reads through mode 000 — no denial to observe" : false }, () => {
    const { qdir } = standalone([row()]);
    const p = matterLedgerPath(qdir);
    chmodSync(p, 0o000);
    const u = usage([qdir]);
    chmodSync(p, 0o644);
    assert.equal(u.complete, false, "a ledger that could not be read reported a confident count");
    assert.equal(u.basis, "unreadable", "a permission wall and a queue nobody wired need different people");
  });

test("EVERY queue given is counted — a ledger read anywhere in the list is a count", () => {
  // Coverage, NOT the assertion: `today` is the load-bearing number here. A queue dir that is not
  // on disk has been drained by nobody and has no ledger to miss, so two ledgers read out of three names
  // is still a count — while the same absence ALONE is blind, which is the test above.
  const a = standalone([row()]), b = standalone([row()]);
  const u = usage([a.qdir, join(tmpdir(), "no-such-queue-429b", "queue"), b.qdir]);
  assert.equal(u.today, 2, "the ledger of every named queue must be counted, as the wall counts them");
  assert.equal(u.complete, true);
});

// SKIPPED under root for the same reason as the read test above.
test("one unreadable ledger among readable ones is BLIND — a floor must not go out as a total",
  { skip: process.getuid?.() === 0 ? "root reads through mode 000 — no denial to observe" : false }, () => {
    const a = standalone([row()]), b = standalone([row()]);
    chmodSync(matterLedgerPath(b.qdir), 0o000);
    const u = usage([a.qdir, b.qdir]);
    chmodSync(matterLedgerPath(b.qdir), 0o644);
    assert.equal(u.today, 1, "what it could read, it counted");
    assert.equal(u.complete, false, "a partial count went out as a fact — this is the shape that under-reports");
    assert.equal(u.basis, "unreadable");
  });
