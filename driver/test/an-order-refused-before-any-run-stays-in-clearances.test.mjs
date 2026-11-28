// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ORDER REFUSED BEFORE ANY RUN STAYS IN CLEARANCES.
//
// An accepted order showed as a queued row while it waited and as its run's row once it ran. While a worker checked it,
// and for good after a refusal before any run, it showed nowhere, and the person who pressed Start could not find it
// again. The portal now records each Start it accepted, per company, and the runs list carries those orders as `orders`:
//   - a refused order and one being checked appear once, for their own company, with the kind of refusal;
//   - another company, and another Generic organisation, see nothing of them;
//   - a waiting order is its queued row and nothing more, and an order with a run is its run's row: one row at a time;
//   - leaving and coming back after a refusal finds the same row;
//   - only the portal's own Starts are listed, never the queue's history.
// Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makePortalService } from "../portal-service.mjs";
import { recordStart, STARTS_DIR } from "../portal-orders.mjs";

const A = { email: "orders@alpha.example" }, B = { email: "orders@beta.example" };
const X = { email: "orders@x.example" }, Y = { email: "orders@y.example" }, STAFF = { email: "staff@firm.example" };
const GRANTS = {
  tenants: {
    celta: { accounts: ["demo-brand-owner", "zephyr"], users: { [A.email]: ["demo-brand-owner"], [B.email]: ["zephyr"] } },
    orgx: { accounts: [], generic: true, users: { [X.email]: "*" } },
    orgy: { accounts: [], generic: true, users: { [Y.email]: "*" } },
  },
  people: { [STAFF.email]: { run: true, manage: true, everything: true }, [A.email]: { run: true }, [B.email]: { run: true },
    [X.email]: { run: true }, [Y.email]: { run: true } },
};

function world() {
  const root = mkdtempSync(join(tmpdir(), "pre-run-orders-"));
  const workspaceRoot = join(root, "workspace"), poolRoot = join(root, "pool"), qdir = join(workspaceRoot, "queue");
  for (const d of [workspaceRoot, poolRoot, qdir]) mkdirSync(d, { recursive: true });
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {}, poolRoot, workspaceRoot, queueDirs: () => [qdir] });
  const list = async (who, query) => svc.route("GET", "/portal/api/runs", who, {}, query);
  /** An order the portal accepted for `account`, waiting in the queue. */
  const accepted = (reference, account, organisation = null) => {
    writeFileSync(join(qdir, `${reference}.json`), JSON.stringify({ id: reference, profileKey: account, ...(organisation ? { tenant: organisation } : {}),
      markName: "PREVENA", product: "global-preliminary-search", forwarder: "jordan" }));
    recordStart(workspaceRoot, { account, organisation, reference });
  };
  const refuse = (reference, kind) => {
    renameSync(join(qdir, `${reference}.json`), join(qdir, `${reference}.failed`));
    writeFileSync(join(qdir, `${reference}.failed.reason`), "the runner's own words\nnotify: sent\n");
    if (kind) writeFileSync(join(qdir, `${reference}.failed.kind`), `${kind}\n`);
  };
  const claim = (reference) => renameSync(join(qdir, `${reference}.json`), join(qdir, `${reference}.processing`));
  const dispatch = (reference) => writeFileSync(join(qdir, `${reference}.processing.meta`), JSON.stringify({ codename: "quiet-heron", dateISO: "2026-11-27" }));
  return { list, accepted, refuse, claim, dispatch, workspaceRoot, qdir };
}
const refs = (r) => (r.json.orders ?? []).map((o) => o.reference);

test("a refused order appears once for its own company, with its kind and never the runner's words", async () => {
  const w = world();
  w.accepted("ORDER-1@aaaaaaaaaaaa", "demo-brand-owner");
  w.refuse("ORDER-1@aaaaaaaaaaaa", "run-cap");
  const r = await w.list(A, { account: "demo-brand-owner" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.orders.map((o) => [o.reference, o.state, o.reasonKind, o.markName]),
    [["ORDER-1@aaaaaaaaaaaa", "refused", "run-cap", "PREVENA"]]);
  assert.doesNotMatch(JSON.stringify(r.json), /runner's own words/);
  assert.ok(!r.json.runs.some((x) => x.runId === "ORDER-1@aaaaaaaaaaaa"), "and no run row besides it");
  const mine = await w.list(A, { scope: "mine" });
  assert.deepEqual(refs(mine), ["ORDER-1@aaaaaaaaaaaa"], "Home's list of every company the person holds finds it too");
});

test("another company, and another Generic organisation, see nothing of it", async () => {
  const w = world();
  w.accepted("ORDER-2@aaaaaaaaaaaa", "demo-brand-owner");
  w.refuse("ORDER-2@aaaaaaaaaaaa", "details");
  w.accepted("ORDER-3@bbbbbbbbbbbb", "generic", "orgx");
  w.refuse("ORDER-3@bbbbbbbbbbbb", "policy");
  assert.deepEqual(refs(await w.list(B, { account: "zephyr" })), []);
  assert.deepEqual(refs(await w.list(B, { scope: "mine" })), []);
  assert.deepEqual(refs(await w.list(X, { account: "generic", tenant: "orgx" })), ["ORDER-3@bbbbbbbbbbbb"]);
  assert.deepEqual(refs(await w.list(Y, { account: "generic", tenant: "orgy" })), []);
  assert.deepEqual(refs(await w.list(Y, { scope: "mine" })), []);
  assert.deepEqual(refs(await w.list(STAFF, { account: "*" })).sort(), ["ORDER-2@aaaaaaaaaaaa", "ORDER-3@bbbbbbbbbbbb"], "staff see every company's");
});

test("a reference a company recorded, now held by another company's order, is nothing to the first", async () => {
  const w = world();
  // The operator's door files a reference as sent, so another company's order can sit under one the portal recorded.
  writeFileSync(join(w.qdir, "SHARED-1.failed"), JSON.stringify({ id: "SHARED-1", profileKey: "zephyr", markName: "OTHER MARK" }));
  writeFileSync(join(w.qdir, "SHARED-1.failed.reason"), "x\n");
  recordStart(w.workspaceRoot, { account: "demo-brand-owner", reference: "SHARED-1" });
  const r = await w.list(A, { account: "demo-brand-owner" });
  assert.deepEqual(refs(r), []);
  assert.doesNotMatch(JSON.stringify(r.json), /OTHER MARK/);
});

test("one row at a time: waiting is its queued row, checking is an order row, and a run replaces it", async () => {
  const w = world();
  w.accepted("ORDER-4@aaaaaaaaaaaa", "demo-brand-owner");
  let r = await w.list(A, { account: "demo-brand-owner" });
  assert.deepEqual(refs(r), [], "waiting: no order row");
  assert.ok(r.json.runs.some((x) => x.runId === "ORDER-4@aaaaaaaaaaaa" && x.state === "queued"), "its queued row");
  w.claim("ORDER-4@aaaaaaaaaaaa");
  r = await w.list(A, { account: "demo-brand-owner" });
  assert.deepEqual(r.json.orders.map((o) => [o.reference, o.state, o.reasonKind]), [["ORDER-4@aaaaaaaaaaaa", "checking", null]]);
  assert.ok(!r.json.runs.some((x) => x.runId === "ORDER-4@aaaaaaaaaaaa"), "being checked, it is not also a queued row");
  w.dispatch("ORDER-4@aaaaaaaaaaaa");
  assert.deepEqual(refs(await w.list(A, { account: "demo-brand-owner" })), [], "started: the run's row takes over");
});

test("leaving and coming back after a refusal before any run finds the same row", async () => {
  const w = world();
  w.accepted("ORDER-5@aaaaaaaaaaaa", "demo-brand-owner");
  w.refuse("ORDER-5@aaaaaaaaaaaa");
  const first = await w.list(A, { account: "demo-brand-owner" });
  const again = await w.list(A, { account: "demo-brand-owner" });
  assert.deepEqual(again.json.orders, first.json.orders);
  assert.equal(first.json.orders[0].reasonKind, "other", "a refusal with no recorded kind is other");
});

test("only the portal's own Starts are listed: a refused order the portal never started is not", async () => {
  const w = world();
  writeFileSync(join(w.qdir, "CONNECTOR-1.failed"), JSON.stringify({ id: "CONNECTOR-1", profileKey: "demo-brand-owner", markName: "PREVENA" }));
  writeFileSync(join(w.qdir, "CONNECTOR-1.failed.reason"), "x\n");
  assert.deepEqual(refs(await w.list(A, { account: "demo-brand-owner" })), []);
  assert.ok(existsSync(join(w.workspaceRoot, STARTS_DIR)) === false, "nothing recorded for it either");
});
