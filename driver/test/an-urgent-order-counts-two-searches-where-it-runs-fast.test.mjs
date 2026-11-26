// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// An Urgent order counts as two searches (ruling 2026-11-25), and the number a client is shown is the number
// admission charges: the quote's `searches`, the runner's daily and monthly caps, the ledger row and the usage
// the screens read all come from the effort model's one count. Where the installation cannot run Urgent fast,
// the order runs at Standard and counts one.
// SAFETY GUARD: env pinned before dynamic driver imports.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "urgent-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverSource } from "./driver-source.mjs";

const { quoteForJob } = await import("../run-quote.mjs");
const { admittedSearches, urgentRunsHere } = await import("../urgent-count.mjs");
const { checkRunCaps } = await import("../runner.mjs");
const { accountUsage, ledgerSearches } = await import("../usage-ledger.mjs");
const { URGENT_SEARCHES, TURNAROUND_QUOTE } = await import("../effort-model.mjs");

const CLEARANCE = { pipeline: "clearance", components: { commonLawGrid: true, jxLanes: false, registerProbe: false } };
const KNOCKOUT = { pipeline: "knockout", components: { commonLawGrid: false, jxLanes: false, registerProbe: false } };
const ACCOUNT = { key: "acme", defaultJurisdictions: ["United States"], defaultClasses: [9, 41], platforms: ["amazon.com"], marketplaceDensity: null };
const JOB = { markName: "Zesty Otter", marks: [{ name: "Zesty Otter" }], classes: [9, 41] };

const DAY = Date.parse("2026-11-26T12:00:00Z");
function ledgerQueue(rows) {
  const base = mkdtempSync(join(tmpdir(), "urgent-q-"));
  const qdir = join(base, "queue");
  mkdirSync(qdir, { recursive: true });
  for (const e of rows) appendFileSync(join(base, ".matter-ledger.jsonl"), JSON.stringify(e) + "\n");
  return qdir;
}

test("the quote counts an Urgent order as two searches and reads its ruled row; the work is unchanged", () => {
  for (const [policy, row] of [[CLEARANCE, TURNAROUND_QUOTE.clearanceUrgent], [KNOCKOUT, TURNAROUND_QUOTE.knockoutUrgent]]) {
    const std = quoteForJob({ job: JOB, profile: ACCOUNT, searchPolicy: policy });
    const urg = quoteForJob({ job: { ...JOB, urgent: true }, profile: ACCOUNT, searchPolicy: policy });
    assert.ok(std && urg, `${policy.pipeline}: both orders were sized`);
    assert.equal(std.searches, 1);
    assert.equal(urg.searches, URGENT_SEARCHES);
    assert.equal(urg.urgent, true);
    assert.deepEqual([urg.turnaroundLowHours, urg.turnaroundHighHours], [row.lowHours, row.highHours]);
    assert.equal(urg.raw, std.raw, `${policy.pipeline}: the same search, the same work`);
    assert.equal(urg.units, std.units);
  }
  assert.equal(TURNAROUND_QUOTE.clearanceUrgent.lowHours, 0.5);
  assert.equal(TURNAROUND_QUOTE.clearanceUrgent.highHours, 1);
  assert.equal(TURNAROUND_QUOTE.knockoutUrgent.lowHours, 3 / 60);
  assert.equal(TURNAROUND_QUOTE.knockoutUrgent.highHours, 6 / 60);
  // Only `true` orders Urgent, the run's own reading of the field.
  assert.equal(quoteForJob({ job: { ...JOB, urgent: "yes" }, profile: ACCOUNT, searchPolicy: CLEARANCE }).searches, 1);
});

test("admission counts what the quote counts where Urgent runs fast, and one where it cannot", () => {
  const fast = () => true, standardOnly = () => false;
  for (const policy of [CLEARANCE, KNOCKOUT]) {
    const urgent = { ...JOB, urgent: true };
    assert.equal(admittedSearches(urgent, { runsHere: fast }), quoteForJob({ job: urgent, profile: ACCOUNT, searchPolicy: policy }).searches,
      `${policy.pipeline}: admission charges the quote's count`);
  }
  assert.equal(admittedSearches({ ...JOB, urgent: true }, { runsHere: fast }), 2);
  assert.equal(admittedSearches({ ...JOB, urgent: true }, { runsHere: standardOnly }), 1, "runs at Standard here, so counts one");
  assert.equal(admittedSearches(JOB, { runsHere: fast }), 1);
  assert.equal(admittedSearches({ ...JOB, urgent: "yes" }, { runsHere: fast }), 1);
  assert.equal(typeof urgentRunsHere(), "boolean", "the installation's answer is read, never thrown");
});

test("the daily and monthly caps add the order's count to what each row recorded; an older row counts one", () => {
  const rows = [
    { profileKey: "acme", ts: DAY, clientPrincipal: true, searches: 2 },   // an Urgent order earlier today
    { profileKey: "acme", ts: DAY, clientPrincipal: true },                // written before rows carried a count
  ];
  assert.equal(ledgerSearches(rows[0]), 2);
  assert.equal(ledgerSearches(rows[1]), 1);
  const q = ledgerQueue(rows);
  const daily = { account: "acme", caps: { dailyRuns: 4 }, queueDirs: [q], now: DAY, clientRun: true };
  assert.equal(checkRunCaps({ ...daily, searches: 1 }), null, "3 used + 1 = 4: a Standard order fits");
  const refused = checkRunCaps({ ...daily, searches: 2 });
  assert.match(refused ?? "", /daily allowance/, "3 used + 2 = 5: an Urgent order does not");
  assert.match(refused ?? "", /started 3 search\(es\) today/);
  const monthly = { account: "acme", caps: { dailyRuns: 100, monthlyRuns: 4 }, queueDirs: [q], now: DAY };
  assert.equal(checkRunCaps({ ...monthly, searches: 1 }), null);
  assert.match(checkRunCaps({ ...monthly, searches: 2 }) ?? "", /monthlyRuns=4/);
  const used = accountUsage({ queueDirs: [q], account: "acme", now: DAY });
  assert.deepEqual([used.today, used.thisMonth, used.complete], [3, 3, true], "the screens read the same sum the wall adds");
});

test("the runner checks the cap against the order's count and records that count on the ledger row", () => {
  const src = driverSource("runner.mjs");
  assert.match(src, /const searches = admittedSearches\(job\);/, "the count is decided once, at claim");
  assert.match(src, /checkRunCaps\(\{[^}]*searches \}\)/s, "the cap is checked against it");
  assert.match(src, /recordMatter\(qdir, \{[^\n]*searches,/, "and the row records it");
  const portal = driverSource("portal-service.mjs");
  assert.equal((portal.match(/quotaRefusal\(account, job\.tenant \?\? null, admittedSearches\(job\)\)/g) ?? []).length, 2,
    "the portal's review and start pre-checks ask with the same count");
});
