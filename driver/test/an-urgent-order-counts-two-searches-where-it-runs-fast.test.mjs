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
const { admittedSearches, urgentRunsHere, ONE_SEARCH_LEFT, oneLeftRefusal } = await import("../urgent-count.mjs");
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
  assert.equal(checkRunCaps({ ...daily, searches: 2 }), ONE_SEARCH_LEFT, "3 used + 2 = 5: an Urgent order does not fit the one left");
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
  assert.equal((portal.match(/quotaRefusal\(account, job\.tenant \?\? null, admittedSearches\(job, \{ runsHere: urgentAvailable \}\)\)/g) ?? []).length, 2,
    "the portal's review and start pre-checks ask with the same count");
});

// ── ONE SEARCH LEFT (design, 2026-11-26) ──────────────────────────────────────────────────────────────
// With exactly one search left an Urgent order, which counts two, is refused in the order screen's own words, "1 search
// left today.", and never run, or counted, as Standard. A Standard order still fits. None left keeps the wall's own
// refusal; two left admits Urgent. Checked here at the wall, which also catches a balance that changed after the preview.
test("at the wall: zero, one and two searches left, for an Urgent order and a Standard one", () => {
  const today = (n) => ledgerQueue(Array.from({ length: n }, () => ({ profileKey: "acme", ts: DAY, clientPrincipal: true })));
  const at = (used, searches) => checkRunCaps({ account: "acme", caps: { dailyRuns: 4 }, queueDirs: [today(used)], now: DAY, clientRun: true, searches });
  assert.match(at(4, 2) ?? "", /daily allowance/, "none left: the wall's own refusal");
  assert.match(at(4, 1) ?? "", /daily allowance/);
  assert.equal(at(3, 2), "1 search left today.", "one left: the screen's sentence, word for word");
  assert.equal(at(3, 1), null, "one left: Standard fits");
  assert.equal(at(2, 2), null, "two left: Urgent fits");
});

test("the rule refuses only the one-left case, and an Urgent order that runs at Standard here counts one and fits", () => {
  assert.equal(ONE_SEARCH_LEFT, "1 search left today.");
  assert.equal(oneLeftRefusal({ used: 3, limit: 4, searches: 2 }), ONE_SEARCH_LEFT);
  assert.equal(oneLeftRefusal({ used: 4, limit: 4, searches: 2 }), null, "none left is not this rule's");
  assert.equal(oneLeftRefusal({ used: 2, limit: 4, searches: 2 }), null);
  assert.equal(oneLeftRefusal({ used: 3, limit: 4, searches: admittedSearches({ ...JOB, urgent: true }, { runsHere: () => false }) }), null,
    "the installation's own fallback keeps its rule: Standard, one search, admitted");
  assert.equal(oneLeftRefusal({ used: 3, limit: null, searches: 2 }), null, "no limit read, no refusal invented");
});

// ── THE PORTAL DOOR ─────────────────────────────────────────────────────────────────────────────────
// New clearance sends `urgent: true` only where Urgent runs fast. The door carries it to the stored job, quotes
// it as admission counts it, says whether Urgent is available, and will not start an Urgent order on a review
// that was confirmed at Standard.
const { makePortalService } = await import("../portal-service.mjs");
const GRANTS = { tenants: { celta: { accounts: ["generic"], users: {} } },
  people: { "staff@example-firm.com": { run: true, manage: true, everything: true } } };
const STAFF = { email: "staff@example-firm.com" };
const ORDER = { account: "generic", markName: "PROBEMARK", classes: [9], product: "global-preliminary-search", geography: { mode: "worldwide" } };
function portal(urgentAvailable) {
  const sent = [];
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {}, urgentAvailable,
    trigger: async (job) => { sent.push(job); return { ok: true, id: job.id }; } });
  return { svc, sent };
}

test("the portal carries an Urgent order to the stored job and quotes it at two searches where it runs fast", async () => {
  const { svc, sent } = portal(() => true);
  const searches = await svc.route("GET", "/portal/api/searches", STAFF, {}, { account: "generic" });
  assert.deepEqual(searches.json.urgent, { available: true });
  const plan = await svc.route("POST", "/portal/api/run/plan", STAFF, { ...ORDER, urgent: true });
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  assert.equal(plan.json.effort?.searches, 2, "the review shows the count admission charges");
  const run = await svc.route("POST", "/portal/api/run", STAFF, { ...ORDER, urgent: true, confirmationToken: plan.json.confirmationToken });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(sent.at(-1)?.urgent, true, "the stored job carries the order");
});

test("where Urgent cannot run fast the portal says so and quotes an Urgent body as Standard", async () => {
  const { svc } = portal(() => false);
  const searches = await svc.route("GET", "/portal/api/searches", STAFF, {}, { account: "generic" });
  assert.deepEqual(searches.json.urgent, { available: false });
  const plan = await svc.route("POST", "/portal/api/run/plan", STAFF, { ...ORDER, urgent: true });
  assert.equal(plan.json.effort?.searches, 1);
});

test("a review confirmed at Standard cannot start an Urgent order", async () => {
  const { svc, sent } = portal(() => true);
  const plan = await svc.route("POST", "/portal/api/run/plan", STAFF, ORDER);
  assert.equal(plan.status, 200);
  const run = await svc.route("POST", "/portal/api/run", STAFF, { ...ORDER, urgent: true, confirmationToken: plan.json.confirmationToken });
  assert.notEqual(run.status, 200, "the token was minted for a different order");
  assert.equal(sent.length, 0);
  // And a value other than `true` is not an Urgent order at this door.
  const plan2 = await svc.route("POST", "/portal/api/run/plan", STAFF, { ...ORDER, urgent: "yes" });
  const run2 = await svc.route("POST", "/portal/api/run", STAFF, { ...ORDER, urgent: "yes", confirmationToken: plan2.json.confirmationToken });
  assert.equal(run2.status, 200);
  assert.equal(sent.at(-1)?.urgent, undefined);
});
