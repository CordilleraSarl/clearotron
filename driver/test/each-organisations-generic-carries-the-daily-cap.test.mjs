// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every organisation's Generic carries the daily cap, and one organisation's day never spends another's.
//
// Ruling, 2026-09-10: "Generic is capped like any company, at the default of 20. Every
// organisation's Generic lane carries the daily cap; the exemption goes." Before it, Generic was the one
// account the runner never capped, and once an organisation's own people could order their Generic, that
// exemption was uncapped spend per organisation.
//
// So this drives the WALL — the runner's admission check — with a ledger holding one organisation's
// Generic day at the default, and reads the answer for that organisation, for another, for a job nobody
// stamped for the cap, and for Generic rows written before the lane existed. And it reads the counter the
// screens show beside it, because a screen that says "3 left" while the wall refuses is the defect a
// shared ledger exists to prevent.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "generic-cap-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { checkRunCaps, DEFAULT_CLIENT_DAILY_RUNS } = await import("../runner.mjs");
const { accountUsage } = await import("../usage-ledger.mjs");

const NOW = Date.parse("2026-09-10T12:00:00Z");
const dirs = [];
function queueWith({ ledger = [], queued = [] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "generic-cap-q-"));
  dirs.push(base);
  const qdir = join(base, "queue");
  mkdirSync(qdir, { recursive: true });
  for (const e of ledger) appendFileSync(join(base, ".matter-ledger.jsonl"), JSON.stringify(e) + "\n");
  queued.forEach((j, i) => writeFileSync(join(qdir, `q${i}.json`), JSON.stringify(j)));
  return qdir;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// One organisation's Generic day, spent to the default: the rows the runner writes when it claims a
// Generic job a person without access to everything ordered.
const day = (organisation, n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  msgId: `${organisation}-${i}`, ts: NOW - 1000 * (i + 1), profileKey: "generic", organisation, clientPrincipal: true, ...extra }));
const ask = (qdir, organisation, clientRun = true) =>
  checkRunCaps({ account: "generic", organisation, caps: null, queueDirs: [qdir], now: NOW, clientRun });

test("the cap under test is the company default, so Generic is capped like any company", () => {
  assert.equal(DEFAULT_CLIENT_DAILY_RUNS, 20, "the ruling names 20; if the default moves, this arm and the ruling part ways");
});

test("an organisation's Generic that has used its day is refused, in words the requester can act on", () => {
  const q = queueWith({ ledger: day("southbank", DEFAULT_CLIENT_DAILY_RUNS) });
  const msg = ask(q, "southbank");
  assert.ok(msg, "the twenty-first Generic clearance of the day went through — Generic is still exempt");
  assert.match(msg, /daily allowance: Generic for southbank has started 20 search\(es\) today/);
  assert.match(msg, /resets at midnight UTC/, "a refusal says when the allowance comes back");
});

test("one short of the cap still runs", () => {
  assert.equal(ask(queueWith({ ledger: day("southbank", DEFAULT_CLIENT_DAILY_RUNS - 1) }), "southbank"), null);
});

test("another organisation's Generic is its own lane, untouched by the first one's day", () => {
  const q = queueWith({ ledger: day("southbank", DEFAULT_CLIENT_DAILY_RUNS) });
  assert.equal(ask(q, "northwind"), null, "Southbank's day spent Northwind's allowance");
  // …and a company's lane is not Generic's either, in either direction.
  assert.equal(checkRunCaps({ account: "harbour", caps: null, queueDirs: [q], now: NOW, clientRun: true }), null);
  const both = queueWith({ ledger: [...day("southbank", 3),
    ...Array.from({ length: DEFAULT_CLIENT_DAILY_RUNS }, (_, i) => ({ msgId: `h${i}`, ts: NOW - 500, profileKey: "harbour", clientPrincipal: true }))] });
  assert.equal(ask(both, "southbank"), null, "a company's day counted against an organisation's Generic");
});

test("a job nobody stamped for the cap is not capped — a person with access to everything, as for a company", () => {
  assert.equal(ask(queueWith({ ledger: day("southbank", DEFAULT_CLIENT_DAILY_RUNS) }), "southbank", false), null);
});

test("Generic rows written before the lane existed count towards no organisation's day", () => {
  // The runner used to write a Generic row with no company and no organisation. Those rows are real history,
  // and counting them into whichever organisation happens to ask would charge it for runs it never made.
  const legacy = Array.from({ length: DEFAULT_CLIENT_DAILY_RUNS }, (_, i) => ({ msgId: `old-${i}`, ts: NOW - 100, clientPrincipal: true }));
  assert.equal(ask(queueWith({ ledger: legacy }), "southbank"), null);
});

test("the counter the screens read counts the same lane the wall caps", () => {
  const q = queueWith({ ledger: [...day("southbank", 5), ...day("northwind", 2)],
    queued: [{ profileKey: "generic", tenant: "southbank" }, { profileKey: "generic", tenant: "northwind" }, { profileKey: "harbour" }] });
  const south = accountUsage({ queueDirs: [q], account: "generic", organisation: "southbank", now: NOW });
  const north = accountUsage({ queueDirs: [q], account: "generic", organisation: "northwind", now: NOW });
  assert.equal(south.today, 5);
  assert.equal(north.today, 2);
  assert.equal(south.queued, 1, "a queued Generic job counts in the lane of the organisation it names");
  assert.equal(north.queued, 1);
});
