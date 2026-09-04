// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-caps.test.mjs — per-account admission caps (checkRunCaps) + profile validation.
// SAFETY GUARD: env pinned before dynamic driver imports.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "caps-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const { checkRunCaps } = await import("../runner.mjs");
const { validateProfileEdit } = await import("../profiles.mjs");

function queueWith({ queued = [], ledger = [] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "caps-q-"));
  const qdir = join(base, "queue");
  mkdirSync(qdir, { recursive: true });
  queued.forEach((j, i) => writeFileSync(join(qdir, `${j.state ?? "j" + i}.${j.ext ?? "json"}`), JSON.stringify(j)));
  for (const e of ledger) appendFileSync(join(base, ".matter-ledger.jsonl"), JSON.stringify(e) + "\n");
  return qdir;
}

test("checkRunCaps: maxQueued counts tagged backlog across queues; the in-hand job rides on top; under-cap passes", () => {
  const NOW = Date.parse("2026-07-18T12:00:00Z");
  const q1 = queueWith({ queued: [
    { state: "a", profileKey: "aurora" }, { state: "b", profileKey: "aurora", ext: "processing" },
    { state: "c", profileKey: "zephyr" }, { state: "d" } /* untagged */ ] });
  const q2 = queueWith({ queued: [{ state: "e", profileKey: "aurora", ext: "postponed" }] });
  // aurora tagged backlog = 3 (a, b, e). cap 3 ⇒ 3 >= 3+1 is false ⇒ passes; cap 2 ⇒ 3 >= 3 ⇒ refuses.
  assert.equal(checkRunCaps({ account: "aurora", caps: { maxQueued: 3 }, queueDirs: [q1, q2], now: NOW }), null);
  const msg = checkRunCaps({ account: "aurora", caps: { maxQueued: 2 }, queueDirs: [q1, q2], now: NOW });
  assert.match(msg, /runCaps\.maxQueued=2/);
  assert.match(msg, /re-send/, "over-cap clarifies with a recoverable instruction, never a silent drop");
  assert.equal(checkRunCaps({ account: "zephyr", caps: { maxQueued: 2 }, queueDirs: [q1, q2], now: NOW }), null,
    "another account's backlog never counts");
});

test("checkRunCaps: monthlyRuns counts THIS month's ledger entries for the account; resets across months; generic/absent never capped", () => {
  const NOW = Date.parse("2026-07-18T12:00:00Z");
  const lastMonth = Date.parse("2026-06-30T12:00:00Z");
  const q = queueWith({ ledger: [
    { msgId: "1", ts: NOW - 1000, profileKey: "aurora" },
    { msgId: "2", ts: NOW - 2000, profileKey: "aurora" },
    { msgId: "3", ts: lastMonth, profileKey: "aurora" },   // outside the month — never counts
    { msgId: "4", ts: NOW - 3000, profileKey: "zephyr" },
    { msgId: "5", ts: NOW - 4000 },                        // untagged — never counts
  ] });
  assert.equal(checkRunCaps({ account: "aurora", caps: { monthlyRuns: 3 }, queueDirs: [q], now: NOW }), null, "2 this month + this one = 3 ≤ 3");
  const msg = checkRunCaps({ account: "aurora", caps: { monthlyRuns: 2 }, queueDirs: [q], now: NOW });
  assert.match(msg, /started 2 run\(s\) this month/);
  assert.match(msg, /resets at month end/);
  assert.equal(checkRunCaps({ account: "generic", caps: { monthlyRuns: 1 }, queueDirs: [q], now: NOW }), null, "generic is never capped");
  assert.equal(checkRunCaps({ account: null, caps: { monthlyRuns: 1 }, queueDirs: [q], now: NOW }), null);
  assert.equal(checkRunCaps({ account: "aurora", caps: null, queueDirs: [q], now: NOW }), null, "no caps configured = no gate");
});

test("profiles: runCaps validates as a customer-only closed object (ints 1–10000, at least one cap)", () => {
  const base = { name: "Acme", platforms: ["amazon.com"] };
  assert.equal(validateProfileEdit("acme", { ...base, runCaps: { maxQueued: 3, monthlyRuns: 40 } }).ok, true);
  assert.match(validateProfileEdit("acme", { ...base, runCaps: { maxQueued: 0 } }).errors.join(" "), /1–10000/);
  assert.match(validateProfileEdit("acme", { ...base, runCaps: { weekly: 5 } }).errors.join(" "), /not a known cap/);
  assert.match(validateProfileEdit("acme", { ...base, runCaps: {} }).errors.join(" "), /at least one cap/);
  assert.match(validateProfileEdit("acme", { ...base, runCaps: 5 }).errors.join(" "), /must be an object/);
  // customer-only: a project overlay naming runCaps is refused (sparse validators)
  const sparse = validateProfileEdit("projects/acme/x", { runCaps: { maxQueued: 99 } }, "", { sparse: true });
  assert.equal(sparse.ok, false, "a project must not widen its customer's caps");
});

test("review 2026-07-18: untagged in-hand rides +1 (never one-over-cap); failed ledger rows count monthly but never dedup; recordMatter is msgId-idempotent", async () => {
  const NOW = Date.parse("2026-07-18T12:00:00Z");
  // untagged in-hand: tagged backlog 2, cap 2 → a TAGGED in-hand (inside the count) passes at exactly cap…
  const q1 = queueWith({ queued: [{ state: "a", profileKey: "aurora" }, { state: "b", profileKey: "aurora", ext: "processing" }] });
  assert.equal(checkRunCaps({ account: "aurora", caps: { maxQueued: 2 }, queueDirs: [q1], inHandTagged: true, now: NOW }), null);
  // …but an UNTAGGED (domain-resolved) in-hand is +1 on top → refused (the old uniform +1 admitted it)
  assert.match(checkRunCaps({ account: "aurora", caps: { maxQueued: 2 }, queueDirs: [q1], inHandTagged: false, now: NOW }), /maxQueued=2/);
  // ledger semantics through the REAL runner helpers
  const { recordMatter, dropMatter, findDuplicateMatter, readMatterLedger } = await import("../runner.mjs");
  const q = queueWith({});
  recordMatter(q, { sig: "f|MARKX|9||-|level:prelim", conversationId: "c1", msgId: "m1", id: "j1", ts: NOW, profileKey: "aurora" });
  recordMatter(q, { sig: "f|MARKX|9||-|level:prelim", conversationId: "c1", msgId: "m1", id: "j1", ts: NOW + 1, profileKey: "aurora" });
  assert.equal(readMatterLedger(q).length, 1, "a crash re-claim (same msgId) never double-counts the month");
  dropMatter(q, "m1");
  const rows = readMatterLedger(q);
  assert.equal(rows.length, 1, "a failed run is MARKED, never removed");
  assert.equal(rows[0].failed, true);
  assert.equal(findDuplicateMatter(q, { sig: "f|MARKX|9||-|level:prelim", conversationId: "c1", msgId: "m2" }, NOW + 1000), null,
    "a failed row never blocks a genuine re-send");
  assert.match(checkRunCaps({ account: "aurora", caps: { monthlyRuns: 1 }, queueDirs: [q], now: NOW }) ?? "",
    /monthlyRuns=1/, "…but the failed run still counts as spend for the monthly cap");
});

// ── runCaps.dailyRuns — the beta allowance ──────────────────────────────────────────────────────────
// The cap that counts a SUBSET of runs: client-started ones. Staff acting for the same account are
// uncapped, which is the whole point — a firm must be able to service a client who has spent their own
// allowance. The stamp is positive-only, so every test here is really a test of that polarity.

const DAY = Date.parse("2026-07-20T12:00:00Z");
const clientRow = (profileKey, ts) => ({ profileKey, ts, clientPrincipal: true });
const staffRow = (profileKey, ts) => ({ profileKey, ts });

test("dailyRuns: a client run over the allowance is refused, and the message says when it resets", () => {
  const q = queueWith({ ledger: [
    clientRow("aurora", DAY), clientRow("aurora", DAY), clientRow("aurora", DAY),
  ] });
  const msg = checkRunCaps({ account: "aurora", caps: { dailyRuns: 3 }, queueDirs: [q], now: DAY, clientRun: true });
  assert.match(msg, /daily allowance/);
  assert.match(msg, /started 3 search\(es\) today/);
  assert.match(msg, /resets at midnight UTC/);
});

test("dailyRuns: under the allowance passes", () => {
  const q = queueWith({ ledger: [clientRow("aurora", DAY), clientRow("aurora", DAY)] });
  assert.equal(checkRunCaps({ account: "aurora", caps: { dailyRuns: 3 }, queueDirs: [q], now: DAY, clientRun: true }), null);
});

test("dailyRuns: STAFF runs never consume the allowance, and a staff run is never refused by it", () => {
  // three staff runs today: they are real runs, but none of them is the client's to pay for
  const q = queueWith({ ledger: [staffRow("aurora", DAY), staffRow("aurora", DAY), staffRow("aurora", DAY)] });
  // the client still has their full allowance
  assert.equal(checkRunCaps({ account: "aurora", caps: { dailyRuns: 3 }, queueDirs: [q], now: DAY, clientRun: true }), null);
  // and a staff run is uncapped even when the client's allowance IS exhausted
  const spent = queueWith({ ledger: [clientRow("aurora", DAY), clientRow("aurora", DAY), clientRow("aurora", DAY)] });
  assert.equal(checkRunCaps({ account: "aurora", caps: { dailyRuns: 3 }, queueDirs: [spent], now: DAY, clientRun: false }), null);
});

test("dailyRuns: yesterday's client runs do not count against today", () => {
  const YESTERDAY = Date.parse("2026-07-19T23:59:00Z");
  const q = queueWith({ ledger: [
    clientRow("aurora", YESTERDAY), clientRow("aurora", YESTERDAY), clientRow("aurora", YESTERDAY),
  ] });
  assert.equal(checkRunCaps({ account: "aurora", caps: { dailyRuns: 3 }, queueDirs: [q], now: DAY, clientRun: true }), null);
});

test("dailyRuns: another account's client runs do not count against this one", () => {
  const q = queueWith({ ledger: [clientRow("zephyr", DAY), clientRow("zephyr", DAY), clientRow("zephyr", DAY)] });
  assert.equal(checkRunCaps({ account: "aurora", caps: { dailyRuns: 3 }, queueDirs: [q], now: DAY, clientRun: true }), null);
});

test("profile validation: dailyRuns is a known cap, bounded, and one cap alone is enough", () => {
  const base = { name: "Acme", platforms: ["amazon.com"] };
  assert.equal(validateProfileEdit("acme", { ...base, runCaps: { dailyRuns: 3 } }).ok, true);
  assert.equal(validateProfileEdit("acme", { ...base, runCaps: { dailyRuns: 3, monthlyRuns: 40 } }).ok, true);
  assert.match(validateProfileEdit("acme", { ...base, runCaps: { dailyRuns: 0 } }).errors.join(" "), /1–10000/);
  assert.match(validateProfileEdit("acme", { ...base, runCaps: { dailyLimit: 3 } }).errors.join(" "), /maxQueued \| dailyRuns \| monthlyRuns/);
  // customer-only, exactly as the other caps are: a project overlay must not grant itself an allowance
  assert.equal(validateProfileEdit("projects/acme/x", { runCaps: { dailyRuns: 99 } }, "", { sparse: true }).ok, false);
});
