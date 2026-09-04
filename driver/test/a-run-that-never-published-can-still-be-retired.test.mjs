// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — THE CONTROL WAS OFFERED FOR A RUN THE ENDPOINT COULD NOT SEE ───────────
//
// The owner pressed Retire on his own install and nothing happened, twice. From the portal's own audit
// log, both presses: `{"path":"/portal/admin/retired","status":400,"reason":"unknown run"}`.
//
// The run had been STOPPED, and a stopped run never publishes into the pool. The retire route resolved
// the id by reading `<pool>/<runId>/meta.json`; the Clearances list that drew the button reads the pool,
// the workspaces AND the queues. So the screen and the endpoint were asking different questions about
// the same id, and the failed and abandoned runs — the ones a reader most wants off the list — were
// exactly the population the control could never act on.
//
// TWO HALVES, AND THE SECOND IS WHY A RESOLVER ALONE IS NOT THE FIX. `scanAccountRuns` honoured the
// retirement sidecar in its POOL branch only, so a tag written for an unpublished run sat in the file
// doing nothing and the run stayed on the list. Retiring would have reported success and changed
// nothing, which is worse than the refusal it replaces.
//
// BREAK MATRIX:
//   · a stopped run resolves                     → break: read the pool alone, arm 1 goes red
//   · retiring it takes it off the list           → break: skip the live branch's filter, arm 2 goes red
//   · "Show retired" then holds it                → break: filter one way only, arm 2 goes red
//   · restore puts it back                        → break: resolve restores against the pool, arm 3 red
//   · an id NOBODY lists is still refused         → break: resolve anything, arm 4 goes red
//   · a refusal on a state-changing route is filed → break: narrow the predicate, arm 5 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { makePortalService, resolveRunAccount, isAdminWrite } from "../portal-service.mjs";

const STAFF = { email: "k@staff.example" };

/** A workspace holding runs in the states that never reach the pool, and an empty pool beside it. */
function world(runs) {
  const poolRoot = mkdtempSync(join(tmpdir(), "retire-pool-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "retire-ws-"));
  for (const [runId, state] of Object.entries(runs)) {
    const dir = join(workspaceRoot, `workspace-${runId}`, "studio", "prelim-search", "runs", runId);
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ runId, state, markName: runId.toUpperCase(), slug: runId }));
    writeFileSync(driverDir(dir, "profile.json"), JSON.stringify({ profileKey: "aurora" }));
  }
  const audits = [];
  const service = makePortalService({ poolRoot, workspaceRoot, secret: "s",
    staffDomains: ["staff.example"],
    grants: () => ({ tenants: { aurora: { accounts: ["aurora"], users: {} } } }),
    audit: (row) => audits.push(row) });
  return { poolRoot, workspaceRoot, service, audits };
}

const listed = async (service, query = {}) =>
  (await service.route("GET", "/portal/api/runs", STAFF, {}, { scope: "mine", ...query })).json.runs.map((r) => r.runId).sort();
const retiredView = async (service) =>
  (await service.route("GET", "/portal/admin/retired", STAFF, {}, {})).json.runs.map((r) => r.runId).sort();

test("2077 arm 1 — a run that was stopped resolves, so Retire answers instead of refusing", async () => {
  const { poolRoot, workspaceRoot, service } = world({ stopped: "cancelled", died: "failed", alive: "running" });
  // The premise the defect turned on: the LIST can see it and the pool cannot.
  assert.deepEqual(await listed(service), ["alive", "died", "stopped"]);
  assert.equal(resolveRunAccount({ poolRoot, workspaceRoot, runId: "stopped" })?.account, "aurora",
    "the resolver cannot see a run that never published, which is the whole defect");

  const r = await service.route("POST", "/portal/admin/retired", STAFF, { runIds: ["stopped"] }, {});
  assert.equal(r.status, 200, `Retire still refuses a stopped run: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.retired, true);
});

test("2077 arm 2 — and retiring it actually takes it off the list, both ways", async () => {
  const { service } = world({ stopped: "cancelled", alive: "running" });
  await service.route("POST", "/portal/admin/retired", STAFF, { runIds: ["stopped"] }, {});

  assert.deepEqual(await listed(service), ["alive"],
    "the tag was written and the run is still listed — a control that reports success and changes "
    + "nothing is worse than the refusal it replaces");
  // The staff fold is EXCLUSIVELY the retired ones, the same rule the pool branch has always applied.
  assert.deepEqual(await retiredView(service), ["stopped"], "the retired view cannot find what was retired");
});

test("2077 arm 3 — restore is the way back for a run that never published either", async () => {
  const { service } = world({ stopped: "cancelled" });
  await service.route("POST", "/portal/admin/retired", STAFF, { runIds: ["stopped"] }, {});
  assert.deepEqual(await listed(service), [], "premise: it is hidden");

  const back = await service.route("POST", "/portal/admin/retired", STAFF, { action: "restore", runIds: ["stopped"] }, {});
  assert.equal(back.status, 200);
  assert.deepEqual(await listed(service), ["stopped"], "a retired unpublished run cannot be brought back — a one-way door");
});

test("2077 arm 4 — an id no surface lists is still refused, and the tenancy rule is untouched", async () => {
  const { poolRoot, workspaceRoot, service } = world({ stopped: "cancelled" });
  assert.equal(resolveRunAccount({ poolRoot, workspaceRoot, runId: "never-existed" }), null);
  const r = await service.route("POST", "/portal/admin/retired", STAFF, { runIds: ["never-existed"] }, {});
  assert.equal(r.status, 400, "the resolver now admits anything, so a typo writes a tag nothing explains");
  assert.equal(r.json.error, "unknown run");
  // The account still comes from the RUN, never from the body — a body-supplied owner is a
  // body-supplied tenancy claim, and widening the resolver must not have widened that.
  assert.equal(resolveRunAccount({ poolRoot, workspaceRoot, runId: "stopped" })?.account, "aurora");
});

test("2077 arm 5 — a refusal on a state-changing route leaves a line, with the server's own reason", async () => {
  const { service, audits } = world({ alive: "running" });

  // THE ROUTE THE ISSUE FOUND SILENT. `/portal/api/ack` filed nothing in either direction, and it is the
  // one whose on-screen message was the least informative — the server composed a sentence a reader
  // could act on and no surface anywhere kept it.
  const r = await service.route("POST", "/portal/api/ack", STAFF, { runId: "alive", state: "running", acknowledged: true }, {});
  assert.equal(r.status, 400);
  const row = audits.find((a) => a.path === "/portal/api/ack");
  assert.ok(row, "a refused acknowledge still files nothing");
  assert.equal(row.status, 400);
  assert.match(row.reason, /failed or cancelled/, "the row does not carry the reason the server composed");

  // THE RULE IS THE PREFIX, NOT THE TWO WE FOUND — so a route added later is covered without anybody
  // remembering. Both prefixes, both directions.
  for (const path of ["/portal/api/ack", "/portal/api/run", "/portal/api/run/abc/stop",
    "/portal/api/queue/abc/cancel", "/portal/admin/retired", "/portal/api/feedback"]) {
    assert.equal(isAdminWrite("POST", path), true, `${path} is a state-changing write and files nothing`);
  }
  for (const [method, path] of [
    ["GET", "/portal/api/ack"],                 // a read is not a write
    ["GET", "/portal/admin/retired"],
    ["POST", "/portal/api/compose/read"],       // computes a draft, changes nothing
    ["POST", "/portal/api/run/plan"],           // prices a request, changes nothing
    ["POST", "/portal/login"],                  // the credential-carrying doors stay outside, as before
    ["POST", "/portal/logout"],
    ["POST", "/portal/report/tmp1-aurora/"],
    ["POST", "/portal/apix/ack"],               // prefix, not substring
    ["POST", ""],
    ["POST", undefined],
  ]) assert.equal(isAdminWrite(method, path), false, `${method} ${path} must not be journalled`);
});
