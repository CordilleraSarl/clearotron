// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The portal's view of the queue: the order the runner will actually admit in, an ordinal that does
// not publish other tenants' queue depth, and "all of MY brand owners" for a multi-brand client.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "pq-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "pq-pool-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { makePortalService, scanAccountRuns } = await import("../portal-service.mjs");

const STAFF_DOMAINS = ["example-firm.com"];
const STAFF = { email: "staff@example-firm.com" };
// One tenant, two brand owners, and a user who holds BOTH — the law-firm-with-several-clients shape.
const GRANTS = { tenants: {
  celta: { accounts: ["aurora", "zephyr"], users: {
    "multi@celta.example": ["aurora", "zephyr"],
    "solo@celta.example": ["aurora"],
  } },
} };
const MULTI = { email: "multi@celta.example" };
const SOLO = { email: "solo@celta.example" };

// Build a workspace whose queue holds `jobs` (in the given file order) plus an optional order file.
function queueWorld(jobs, order = null) {
  const poolRoot = mkdtempSync(join(tmpdir(), "pq-poolfx-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "pq-wsfx-"));
  const studio = join(workspaceRoot, "workspace-clawdi", "studio", "prelim-search");
  const q = join(studio, "queue");
  mkdirSync(q, { recursive: true });
  for (const j of jobs) {
    writeFileSync(join(q, `${j.id}.json`), JSON.stringify({
      id: j.id, forwarder: "jordan", markName: j.mark, classes: [9],
      profileKey: j.account, enqueuedAt: j.at ?? "2026-07-28T10:00:00.000Z",
    }));
  }
  if (order) writeFileSync(join(studio, ".queue-order.json"), JSON.stringify({ order }) + "\n");
  return { poolRoot, workspaceRoot };
}

const queuedOf = (runs) => runs.filter((r) => r.state === "queued");

test("queued rows come back in the runner's admission order, numbered densely from 1", () => {
  // Filenames and enqueuedAt both ascend a→b→c; the order file says the opposite. Only the order file
  // being honoured can produce c,b,a — which is the same guarantee the runner test makes about which
  // one actually RUNS next, asserted here on what the screen will show.
  const { poolRoot, workspaceRoot } = queueWorld([
    { id: "q-a", mark: "ALPHA", account: "aurora", at: "2026-07-28T10:01:00.000Z" },
    { id: "q-b", mark: "BRAVO", account: "aurora", at: "2026-07-28T10:02:00.000Z" },
    { id: "q-c", mark: "CHARLIE", account: "aurora", at: "2026-07-28T10:03:00.000Z" },
  ], ["q-c", "q-b", "q-a"]);

  const rows = queuedOf(scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" }));
  assert.deepEqual(rows.map((r) => r.runId), ["q-c", "q-b", "q-a"], "shown in admission order");
  assert.deepEqual(rows.map((r) => r.queuePos), [1, 2, 3], "and numbered 1..N with no gaps");
});

test("with no order file the portal shows oldest-first, matching what the runner will do", () => {
  const { poolRoot, workspaceRoot } = queueWorld([
    { id: "q-a", mark: "ALPHA", account: "aurora", at: "2026-07-28T10:40:00.000Z" },
    { id: "q-b", mark: "BRAVO", account: "aurora", at: "2026-07-28T10:20:00.000Z" },
    { id: "q-c", mark: "CHARLIE", account: "aurora", at: "2026-07-28T10:30:00.000Z" },
  ]);
  const rows = queuedOf(scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" }));
  assert.deepEqual(rows.map((r) => r.runId), ["q-b", "q-c", "q-a"], "oldest enqueuedAt leads");
});

test("the ordinal never publishes another tenant's queue depth", () => {
  // Four jobs interleaved between two brand owners. Aurora's own two sit at lane positions 2 and 4.
  // Showing "2" and "4" would tell aurora that two jobs it cannot see are queued ahead of it — the
  // same fact the 404-not-403 rule exists to withhold.
  const { poolRoot, workspaceRoot } = queueWorld([
    { id: "q-z1", mark: "ZED ONE", account: "zephyr" },
    { id: "q-a1", mark: "AURORA ONE", account: "aurora" },
    { id: "q-z2", mark: "ZED TWO", account: "zephyr" },
    { id: "q-a2", mark: "AURORA TWO", account: "aurora" },
  ], ["q-z1", "q-a1", "q-z2", "q-a2"]);

  const rows = queuedOf(scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" }));
  assert.deepEqual(rows.map((r) => r.runId), ["q-a1", "q-a2"], "only aurora's own jobs");
  assert.deepEqual(rows.map((r) => r.queuePos), [1, 2], "dense over what aurora can see, NOT lane indexes 2 and 4");

  // Staff read every row, so for them the dense numbering IS the lane depth.
  const all = queuedOf(scanAccountRuns({ poolRoot, workspaceRoot, account: null }));
  assert.deepEqual(all.map((r) => r.queuePos), [1, 2, 3, 4]);
});

test("scanAccountRuns takes an ARRAY of accounts — the union of what that caller could fetch one at a time", () => {
  const { poolRoot, workspaceRoot } = queueWorld([
    { id: "q-a1", mark: "AURORA ONE", account: "aurora" },
    { id: "q-z1", mark: "ZED ONE", account: "zephyr" },
    { id: "q-o1", mark: "OTHER", account: "othercorp" },
  ], ["q-a1", "q-z1", "q-o1"]);

  const rows = queuedOf(scanAccountRuns({ poolRoot, workspaceRoot, account: ["aurora", "zephyr"] }));
  assert.deepEqual(rows.map((r) => r.runId), ["q-a1", "q-z1"], "both held accounts, and nothing else");
  // An EMPTY array must match nothing. Falling through to "every account" here would turn a caller
  // who holds no brand owners into a caller who holds all of them.
  assert.deepEqual(scanAccountRuns({ poolRoot, workspaceRoot, account: [] }), []);
});

// ── the route ─────────────────────────────────────────────────────────────────────────────────────
const serviceFor = ({ poolRoot, workspaceRoot }, grants = GRANTS) => makePortalService({
  poolRoot, workspaceRoot, recipesDir: mkdtempSync(join(tmpdir(), "pq-rec-")),
  secret: "test-secret", staffDomains: STAFF_DOMAINS, grants,
  trigger: async () => ({ ok: true }), audit: () => {},
});

test("?scope=mine : one request shape, and everyone gets exactly the brand owners they hold", async () => {
  // Home is account-scoped and must not empty when the sidebar switcher picks one owner. Before this
  // branch a client asking for all of its own work had to make one request per owner against a
  // 120/min limit, so the multi-brand case could not work at any level of visual polish.
  //
  // Staff and client send the IDENTICAL request. There is no role branch in the UI, which is the rule.
  const world = queueWorld([
    { id: "q-a1", mark: "AURORA ONE", account: "aurora" },
    { id: "q-z1", mark: "ZED ONE", account: "zephyr" },
    { id: "q-o1", mark: "OTHER", account: "othercorp" },
  ], ["q-a1", "q-z1", "q-o1"]);
  const service = serviceFor(world);

  const res = await service.route("GET", "/portal/api/runs", MULTI, null, { scope: "mine" });
  assert.equal(res.status, 200);
  assert.deepEqual(queuedOf(res.json.runs).map((r) => r.runId), ["q-a1", "q-z1"]);
  assert.ok(!res.json.runs.some((r) => r.account === "othercorp"), "a foreign account never appears");

  // Staff: the same request, every account.
  const staff = await service.route("GET", "/portal/api/runs", STAFF, null, { scope: "mine" });
  assert.equal(staff.status, 200);
  assert.deepEqual(queuedOf(staff.json.runs).map((r) => r.runId), ["q-a1", "q-z1", "q-o1"]);

  // A single-grant client gets exactly its one.
  const solo = await service.route("GET", "/portal/api/runs", SOLO, null, { scope: "mine" });
  assert.equal(solo.status, 200);
  assert.deepEqual(queuedOf(solo.json.runs).map((r) => r.runId), ["q-a1"]);
});

test("?scope=mine does NOT relax the wildcard — `*` still means every account, staff only", async () => {
  // The rule this guards is deliberate and predates the new scope: letting a client's `*` resolve to
  // "mine" would teach the browser that `*` is a harmless default worth sending everywhere, and the
  // next path that forgets to re-check it becomes a cross-tenant read. Two capabilities, two names.
  const world = queueWorld([
    { id: "q-a1", mark: "AURORA ONE", account: "aurora" },
    { id: "q-o1", mark: "OTHER", account: "othercorp" },
  ], ["q-a1", "q-o1"]);
  const service = serviceFor(world);

  const wild = await service.route("GET", "/portal/api/runs", MULTI, null, { account: "*" });
  assert.equal(wild.status, 404, "an admitted client still gets the plain 404 on the wildcard");
  assert.deepEqual(wild.json, { error: "not_found" }, "byte-identical to any other denial");
});

test("?scope=mine : the grants-absent '*' sentinel is NOT a list and is never expanded", async () => {
  // With no grants file, enforcement is OFF and every identity reads accounts: "*". Expanding that
  // sentinel here would turn a missing config file into a cross-tenant read.
  const world = queueWorld([
    { id: "q-a1", mark: "AURORA ONE", account: "aurora" },
    { id: "q-o1", mark: "OTHER", account: "othercorp" },
  ], ["q-a1", "q-o1"]);
  const service = serviceFor(world, null);

  const res = await service.route("GET", "/portal/api/runs", { email: "anyone@nowhere.example" }, null, { scope: "mine" });
  assert.notEqual(res.status, 200, `the sentinel must not resolve to a run list (got ${res.status})`);
  assert.equal(res.status, 404);
});

test("?scope=mine : an unenrolled identity is still refused at the door", async () => {
  const world = queueWorld([{ id: "q-a1", mark: "AURORA ONE", account: "aurora" }]);
  const service = serviceFor(world);
  const res = await service.route("GET", "/portal/api/runs", { email: "who@nowhere.example" }, null, { scope: "mine" });
  assert.equal(res.status, 403, "no principal at all ⇒ the door refuses before any scoping question");
});
