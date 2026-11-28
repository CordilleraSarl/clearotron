// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ORDER REFUSED BEFORE ANY RUN CAN BE RETIRED FROM CLEARANCES, AND RESTORED.
//
// Clearances lists an order the portal's Start accepted and a worker refused before any run, and the row never expired.
// The retire action is the firm's curation of that list (design, 2026-11-27): it now takes such an order's reference.
//   - Retired, the order leaves Clearances for its own company and for whoever sees everything, and the Retired tab
//     lists it, marked retired, so it can be restored.
//   - Restored, it is back in Clearances.
//   - Its receipt stays reachable by its link, as a retired run's report does.
//   - A reference nobody recorded is refused as an unknown run, and retiring stays staff-only. (An order still waiting
//     is its queued row, which retire already took as a run.)
// Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePortalService } from "../portal-service.mjs";
import { recordStart } from "../portal-orders.mjs";

const A = { email: "orders@alpha.example" }, STAFF = { email: "staff@firm.example" };
const GRANTS = {
  tenants: { celta: { accounts: ["demo-brand-owner", "zephyr"], users: { [A.email]: ["demo-brand-owner"] } } },
  people: { [STAFF.email]: { run: true, manage: true, everything: true }, [A.email]: { run: true } },
};

function world() {
  const root = mkdtempSync(join(tmpdir(), "retire-pre-run-order-"));
  const workspaceRoot = join(root, "workspace"), poolRoot = join(root, "pool"), qdir = join(workspaceRoot, "queue");
  for (const d of [workspaceRoot, poolRoot, qdir]) mkdirSync(d, { recursive: true });
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {}, poolRoot, workspaceRoot, queueDirs: () => [qdir] });
  const accepted = (reference, account) => {
    writeFileSync(join(qdir, `${reference}.json`), JSON.stringify({ id: reference, profileKey: account, markName: "VELLOQUIN",
      product: "global-preliminary-search", forwarder: "jordan" }));
    recordStart(workspaceRoot, { account, reference });
  };
  const refuse = (reference) => {
    renameSync(join(qdir, `${reference}.json`), join(qdir, `${reference}.failed`));
    writeFileSync(join(qdir, `${reference}.failed.reason`), "the runner's own words\n");
    writeFileSync(join(qdir, `${reference}.failed.kind`), "run-cap\n");
  };
  const orders = async (who, query) => (await svc.route("GET", "/portal/api/runs", who, {}, query)).json.orders.map((o) => o.reference);
  const retired = async () => (await svc.route("GET", "/portal/admin/retired", STAFF, {}, {})).json;
  const act = (action, ids, who = STAFF) => svc.route("POST", "/portal/admin/retired", who, { action, runIds: ids });
  return { svc, accepted, refuse, orders, retired, act };
}

test("retired, a refused order leaves Clearances and is listed on the Retired tab; restored, it is back", async () => {
  const w = world();
  w.accepted("ORDER-1@aaaaaaaaaaaa", "demo-brand-owner");
  w.refuse("ORDER-1@aaaaaaaaaaaa");
  w.accepted("ORDER-2@bbbbbbbbbbbb", "demo-brand-owner");
  w.refuse("ORDER-2@bbbbbbbbbbbb");
  assert.deepEqual((await w.orders(A, { account: "demo-brand-owner" })).sort(), ["ORDER-1@aaaaaaaaaaaa", "ORDER-2@bbbbbbbbbbbb"], "premise");

  const r = await w.act("retire", ["ORDER-1@aaaaaaaaaaaa"]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(await w.orders(A, { account: "demo-brand-owner" }), ["ORDER-2@bbbbbbbbbbbb"], "the retired order left its company's Clearances");
  assert.deepEqual(await w.orders(STAFF, { scope: "mine" }), ["ORDER-2@bbbbbbbbbbbb"], "and the list of whoever sees everything");
  assert.deepEqual(await w.orders(A, { scope: "mine" }), ["ORDER-2@bbbbbbbbbbbb"], "and Home's list of every company the person holds");
  const tab = await w.retired();
  assert.deepEqual(tab.orders.map((o) => [o.reference, o.state, o.retired]), [["ORDER-1@aaaaaaaaaaaa", "refused", true]],
    "the Retired tab lists it, so it can be restored");
  assert.doesNotMatch(JSON.stringify(tab), /runner's own words/, "never the runner's words");

  const receipt = await w.svc.route("GET", "/portal/api/orders/ORDER-1@aaaaaaaaaaaa", A, {}, { account: "demo-brand-owner" });
  assert.equal(receipt.status, 200, "the receipt stays reachable by its link");

  assert.equal((await w.act("restore", ["ORDER-1@aaaaaaaaaaaa"])).status, 200);
  assert.deepEqual((await w.orders(A, { account: "demo-brand-owner" })).sort(), ["ORDER-1@aaaaaaaaaaaa", "ORDER-2@bbbbbbbbbbbb"], "restored, it is back");
  assert.deepEqual((await w.retired()).orders, [], "and off the Retired tab");
});

test("a reference nobody recorded is refused as an unknown run; retiring stays staff-only", async () => {
  const w = world();
  const unknown = await w.act("retire", ["ORDER-9@nobodyrecordedit"]);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.error, "unknown run");
  w.accepted("ORDER-3@cccccccccccc", "demo-brand-owner");
  w.refuse("ORDER-3@cccccccccccc");
  const client = await w.act("retire", ["ORDER-3@cccccccccccc"], A);
  assert.notEqual(client.status, 200, "a company's person cannot retire, as before");
  assert.deepEqual(await w.orders(A, { account: "demo-brand-owner" }), ["ORDER-3@cccccccccccc"], "and nothing was retired");
});
