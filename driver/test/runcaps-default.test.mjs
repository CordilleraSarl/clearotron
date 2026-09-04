// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// runcaps-default.test.mjs — the beta daily allowance: 2 a day per brand owner by default, and a failed
// run does not consume it.
//
// Two caps, two questions, counted differently ON PURPOSE:
//   dailyRuns   — FAIRNESS. Skips failed rows: charging a client their day because our engine broke is
//                 the fastest way to lose them, and they cannot tell our fault from theirs.
//   monthlyRuns — SPEND. Still counts failures, because a failed run did spend and a failing loop that
//                 freed its own quota could burn without bound (dropMatter marks `failed`, never removes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const { checkRunCaps, DEFAULT_CLIENT_DAILY_RUNS, matterLedgerPath } = await import("../runner.mjs");
const { DEFAULT_CLIENT_DAILY_RUNS: PORTAL_DEFAULT, accountUsage } = await import("../portal-service.mjs");

const DAY = "2026-07-20T10:00:00.000Z";
function ledger(rows) {
  const root = mkdtempSync(join(tmpdir(), "runcaps-"));
  const qdir = join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
  mkdirSync(qdir, { recursive: true });
  const p = matterLedgerPath(qdir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  return { root, qdir };
}
const row = (over = {}) => ({ profileKey: "zephyr", clientPrincipal: true, ts: Date.parse(DAY), msgId: `m${Math.random()}`, ...over });
const check = (qdir, caps = null) => checkRunCaps({ account: "zephyr", caps, queueDirs: [qdir], now: Date.parse(DAY), clientRun: true });

test("a profile with NO runCaps is capped at the default, not uncapped", () => {
  // THE NUMBER IS PINNED AS A LITERAL, deliberately. raised it from the beta's 2
  // to 20 on the owner's ruling, and a default that drifts without a ruling is a spend decision nobody
  // made. Reading it from the constant here would assert only that the constant equals itself.
  assert.equal(DEFAULT_CLIENT_DAILY_RUNS, 20);
  // The FIXTURE is derived from the constant, which is the opposite case: it exists to fill the day, and a
  // hardcoded row count is what made this arm red on a change to the number rather than on a defect.
  const { qdir } = ledger(Array.from({ length: DEFAULT_CLIENT_DAILY_RUNS }, () => row()));
  const msg = check(qdir, null);
  assert.match(String(msg), /daily allowance/, "an account with no runCaps block ran past the default");
  assert.match(String(msg), /dailyRuns=20/);
});

test("one under the default is still admitted — the wall is at the number, not below it", () => {
  // The off-by-one the arm above cannot see: a cap that fires one early refuses a client who is inside
  // their allowance, and every assertion above would still pass.
  const { qdir } = ledger(Array.from({ length: DEFAULT_CLIENT_DAILY_RUNS - 1 }, () => row()));
  assert.equal(check(qdir, null), null, "a client was refused while still inside the daily allowance");
});

test("under the default, a run is admitted", () => {
  const { qdir } = ledger([row()]);
  assert.equal(check(qdir, null), null);
});

test("a FAILED run does not consume the daily allowance", () => {
  const { qdir } = ledger([row({ failed: true }), row({ failed: true }), row()]);
  assert.equal(check(qdir, null), null, "failed runs were charged against the client's day");
});

test("an explicit profile value overrides the default, and 0 means zero", () => {
  const { qdir } = ledger([row(), row()]);
  assert.equal(check(qdir, { dailyRuns: 5 }), null, "an explicit higher cap was ignored");
  assert.match(String(check(ledger([]).qdir, { dailyRuns: 0 })), /daily allowance/, "0 read as unlimited");
});

test("the neutral generic profile stays exempt — it is not a brand owner", () => {
  const { qdir } = ledger([{ profileKey: "generic", clientPrincipal: true, ts: Date.parse(DAY), msgId: "g" }]);
  assert.equal(checkRunCaps({ account: "generic", caps: null, queueDirs: [qdir], now: Date.parse(DAY), clientRun: true }), null);
});

test("a STAFF run never consumes a client's day", () => {
  const { qdir } = ledger([row({ clientPrincipal: undefined }), row({ clientPrincipal: undefined })]);
  assert.equal(check(qdir, null), null);
});

test("the portal's default matches the wall's — the screen cannot promise what the gate refuses", () => {
  assert.equal(PORTAL_DEFAULT, DEFAULT_CLIENT_DAILY_RUNS);
});

test("the portal's `today` counter also skips failed runs", () => {
  const { qdir } = ledger([row({ failed: true }), row()]);
  // Counted from the QUEUE DIRS the wall counts, not from a workspace scan. This fixture is the
  // workspace-embedded layout; the standalone-queue layout the old scan could not see is pinned in
  // usage-ledger-standalone-queue.test.mjs.
  const u = accountUsage({ queueDirs: [qdir], account: "zephyr", now: Date.parse(DAY) });
  assert.equal(u.today, 1, "the displayed count disagreed with the wall");
  assert.equal(u.thisMonth, 2, "the monthly SPEND figure must still include the failed run");
  assert.equal(u.complete, true, "a real queue with a real ledger is a count we took");
});

// The boundary the default must NOT cross — an unreadable profile still reports null rather than a
// fabricated allowance — is pinned in portal-service.test.mjs ("a cap the server cannot read is NULL").
