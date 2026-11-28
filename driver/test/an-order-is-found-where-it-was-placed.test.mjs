// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// AN ORDER IS FOUND WHERE IT WAS PLACED. The person who placed an order can ask what became of it at the door they used:
// the command line's `--status`, and the portal's /portal/api/orders/<reference>. Each answers from the same receipt,
// within that door's own visibility, and whatever a caller may not see answers exactly as no order at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makePortalService } from "../portal-service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "enqueue.mjs");

// Orders in the states the runner leaves them in, for two companies.
function queueOfOrders() {
  const qdir = join(mkdtempSync(join(tmpdir(), "order-found-")), "queue");
  mkdirSync(qdir, { recursive: true });
  const job = (id, profileKey) => JSON.stringify({ id, profileKey, markName: "FOUND PROBE", ref: "TMP-41", forwarder: "jordan" });
  writeFileSync(join(qdir, "portal-a-refused.failed"), job("portal-a-refused", "demo-brand-owner"));
  writeFileSync(join(qdir, "portal-a-refused.failed.reason"), "demo-brand-owner is demo data and cannot run a real clearance.\nnotify: sent\n");
  writeFileSync(join(qdir, "portal-a-running.processing"), job("portal-a-running", "demo-brand-owner"));
  writeFileSync(join(qdir, "portal-a-running.processing.meta"), JSON.stringify({ codename: "quiet-heron", dateISO: "2026-11-26" }));
  writeFileSync(join(qdir, "portal-b-waiting.json"), job("portal-b-waiting", "zephyr"));
  return qdir;
}

const status = (qdir, reference) => {
  const r = spawnSync(process.execPath, [CLI, "--status", reference, "--queue-dir", qdir], { encoding: "utf8", env: { ...process.env } });
  let out = null; try { out = JSON.parse(r.stdout); } catch { /* reported by the assertion */ }
  return { code: r.status, out, stderr: r.stderr };
};

test("the command line answers what became of an order as order_status does, and says why when it finds none", () => {
  const qdir = queueOfOrders();
  const refused = status(qdir, "portal-a-refused");
  assert.equal(refused.code, 0, refused.stderr);
  // The kind of the refusal and whose order it is; never the reason as the runner recorded it (design, 2026-11-27).
  assert.deepEqual([refused.out.found, refused.out.state, refused.out.reason, refused.out.reasonKind, refused.out.account],
    [true, "refused", null, "other", "demo-brand-owner"]);
  assert.doesNotMatch(refused.out && JSON.stringify(refused.out), /demo data|notify/, "nothing of the runner's text is printed");
  const running = status(qdir, "portal-a-running");
  assert.equal(running.out.state, "running");
  assert.equal(running.out.runId, "tmp41-found-probe-2026-11-26-quiet-heron");
  assert.equal(status(qdir, "portal-b-waiting").out.state, "waiting");
  const none = status(qdir, "portal-nothing");
  assert.deepEqual([none.code, none.out], [4, { found: false, basis: "not-found" }]);
  const bad = status(qdir, "../escape");
  assert.deepEqual([bad.code, bad.out], [4, { found: false, basis: "invalid-reference" }]);
});

const STAFF = { email: "staff@example-firm.com" };
const CLIENT_A = { email: "orders@alpha.example" };
const CLIENT_B = { email: "orders@beta.example" };
const GRANTS = {
  tenants: { celta: { accounts: ["demo-brand-owner", "zephyr"],
    users: { [CLIENT_A.email]: ["demo-brand-owner"], [CLIENT_B.email]: ["zephyr"] } } },
  people: { [STAFF.email]: { run: true, manage: true, everything: true }, [CLIENT_A.email]: { run: true }, [CLIENT_B.email]: { run: true } },
};

test("the portal answers each person for their own company's orders only", async () => {
  const qdir = queueOfOrders();
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {}, queueDirs: () => [qdir] });
  const get = (who, ref, account) => svc.route("GET", `/portal/api/orders/${encodeURIComponent(ref)}`, who, {}, account ? { account } : {});

  const refused = await get(CLIENT_A, "portal-a-refused", "demo-brand-owner");
  assert.equal(refused.status, 200, JSON.stringify(refused.json));
  // The reason as written is the operator's; the company is told which kind of refusal it was. An order refused before
  // the runner recorded a kind is `other`.
  assert.deepEqual([refused.json.state, refused.json.runId, refused.json.reason, refused.json.reasonKind],
    ["refused", null, null, "other"]);
  assert.equal(refused.json.account, undefined, "a company's own answer does not echo the account back");
  const running = await get(CLIENT_A, "portal-a-running", "demo-brand-owner");
  assert.deepEqual([running.json.state, running.json.runId], ["running", "tmp41-found-probe-2026-11-26-quiet-heron"]);

  // Another company's order is no order at all, by its own account or by naming the other one.
  assert.deepEqual(await get(CLIENT_A, "portal-b-waiting", "demo-brand-owner"), { status: 404, json: { error: "not_found" } });
  assert.notEqual((await get(CLIENT_A, "portal-b-waiting", "zephyr")).status, 200, "naming another company's account opens nothing");
  assert.deepEqual(await get(CLIENT_B, "portal-a-refused", "zephyr"), { status: 404, json: { error: "not_found" } });

  // Someone who sees everything is answered for every order, with the account it belongs to.
  const staff = await get(STAFF, "portal-b-waiting");
  assert.deepEqual([staff.status, staff.json.state, staff.json.account], [200, "waiting", "zephyr"]);
  const staffRefused = await get(STAFF, "portal-a-refused");
  assert.deepEqual([staffRefused.json.reason, staffRefused.json.reasonKind], [null, "other"], "nobody reads the reason as written");
});

test("a queue that would not open is not a missing order, for a company's person as for staff", async () => {
  const qdir = queueOfOrders();
  const unreadable = join(dirname(qdir), "not-a-directory");
  writeFileSync(unreadable, "");   // readdir fails with ENOTDIR: the queue is there and cannot be read
  const svc = makePortalService({ secret: "s".repeat(32), grants: GRANTS, audit: () => {}, queueDirs: () => [qdir, unreadable] });
  const get = (who, ref, account) => svc.route("GET", `/portal/api/orders/${encodeURIComponent(ref)}`, who, {}, account ? { account } : {});
  assert.deepEqual(await get(CLIENT_A, "portal-a-nothing", "demo-brand-owner"), { status: 503, json: { error: "could_not_look" } });
  assert.equal((await get(STAFF, "portal-a-nothing")).json.unreadable, 1, "staff are told how many queues would not open");
  // An order found in a queue that opened is still found.
  assert.equal((await get(CLIENT_A, "portal-a-running", "demo-brand-owner")).status, 200);
});
