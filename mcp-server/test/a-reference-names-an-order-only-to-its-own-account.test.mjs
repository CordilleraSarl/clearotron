// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REFERENCE NAMES AN ORDER ONLY TO ITS OWN ACCOUNT.
//
// A connector session that does not see every account may choose the reference its order is filed under, and another
// account's session may choose the same one. start_run answered a reference already in the queue with that order's
// state, whoever's it was: one company could learn that another's order existed and what became of it, and the two
// orders could not both be filed. Every order such a session files now carries a fixed mark of its account (and of its
// organisation, for Generic):
//   - two accounts, or two Generic organisations, that send one reference both file their order, and neither answer
//     says anything of the other's;
//   - the same account sending it again meets its own order, and is answered with it (already-filed), spending nothing
//     and writing nothing; sending the reference it was given back is the same retry;
//   - an order filed under the bare reference before this change is the same order to its own account, and nothing at
//     all to another;
//   - a session that sees every account (an operator) files the reference as sent; its retry for the same account is
//     answered with the order, and for another account is refused as before;
//   - order_status finds an order by either reference, for its own account only: another account's order and a
//     reference nobody holds give one answer;
//   - the mark is the one orders have been filed under since references first carried it.
// Every name is invented.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "reference-account-"));
const QUEUE = join(ROOT, "queue");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", QUEUE);
process.env.TRADEMARK_MCP_AUDIT_LOG = join(ROOT, "audit.jsonl");

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { makeServer } = await import("../server.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { accountMark } = await import("../../driver/order-receipt.mjs");

const person = (sub, extra) => ({ kind: "account", sub, permissions: { run: true, manage: false }, ...extra });
const A = person("orders@alpha.example", { accounts: ["demo-brand-owner"] });
const B = person("orders@beta.example", { accounts: ["zephyr"] });
const ORG_X = person("orders@x.example", { accounts: [], genericOrgs: ["orgx"] });
const ORG_Y = person("orders@y.example", { accounts: [], genericOrgs: ["orgy"] });
const STAFF = null;   // the ops door: sees every account

async function call(scope, name, args) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer(scope ? { scope, local: false } : undefined).connect(b);
  const client = new Client({ name: "reference-account-test", version: "1" });
  await client.connect(a);
  await client.listTools();   // compiles every declared shape: each answer below is checked against its own
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  return r;
}
async function start(scope, args) {
  const r = await call(scope, "start_run", { markName: "QZORVAK", classes: [9], forwarder: "requester", ...args });
  const s = r.structuredContent ?? {};
  return { ...s, outcome: s.outcome, id: s.id, reason: s.reason, text: r.content?.[0]?.text ?? "" };
}
async function status(scope, id) {
  const r = await call(scope, "order_status", { id });
  assert.ok(!r.isError, r.content?.[0]?.text);
  return r.structuredContent;
}
const files = () => { try { return readdirSync(QUEUE).filter((n) => n.endsWith(".json")).sort(); } catch { return []; } };
const read = (name) => readFileSync(join(QUEUE, name), "utf8");

test("two accounts that send one reference both file their order, and neither answer says anything of the other's", async () => {
  const a = await start(A, { id: "ORDER-1", profileKey: "demo-brand-owner" });
  assert.equal(a.outcome, "queued", a.text);
  assert.match(a.id, /^ORDER-1@[0-9a-f]{12}$/);
  const before = read(`${a.id}.json`);
  const b = await start(B, { id: "ORDER-1", profileKey: "zephyr" });
  assert.equal(b.outcome, "queued", "another account's order is no reason to refuse this one");
  assert.notEqual(b.id, a.id);
  assert.equal(read(`${a.id}.json`), before, "the first order's file is untouched");
  assert.doesNotMatch(b.text, new RegExp(a.id.split("@")[1]), "nothing of the first order's reference");
  assert.doesNotMatch(b.text, /already|exists|waiting|refused|delivered/i, "nothing of its existence or state");
});

test("the same account sending it again meets its own order: answered with it, nothing written, nothing spent", async () => {
  const first = await start(A, { id: "ORDER-2", profileKey: "demo-brand-owner" });
  const count = files().length;
  const kept = read(`${first.id}.json`);
  for (const id of ["ORDER-2", first.id]) {   // the reference it sent, and the one it was given back
    const again = await start(A, { id, profileKey: "demo-brand-owner" });
    assert.equal(again.outcome, "already-filed", `${id}: ${again.text}`);
    assert.deepEqual([again.id, again.state, again.terminal, again.runId], [first.id, "waiting", false, null]);
  }
  assert.equal(files().length, count, "no second order");
  assert.equal(read(`${first.id}.json`), kept);
});

test("two Generic organisations that send one reference both file their order", async () => {
  const x = await start(ORG_X, { id: "ORDER-3" });
  const y = await start(ORG_Y, { id: "ORDER-3" });
  assert.equal(x.outcome, "queued", x.text);
  assert.equal(y.outcome, "queued", y.text);
  assert.notEqual(x.id, y.id);
  assert.equal(JSON.parse(read(`${x.id}.json`)).tenant, "orgx");
  assert.equal(JSON.parse(read(`${y.id}.json`)).tenant, "orgy");
  assert.doesNotMatch(y.text, /already|exists/i);
});

test("an order filed under the bare reference before is its own account's order, and nothing to another account", async () => {
  mkdirSync(QUEUE, { recursive: true });
  writeFileSync(join(QUEUE, "LEGACY-1.json"), JSON.stringify({ id: "LEGACY-1", profileKey: "demo-brand-owner", markName: "QZORVAK", forwarder: "requester" }));
  const own = await start(A, { id: "LEGACY-1", profileKey: "demo-brand-owner" });
  assert.equal(own.outcome, "already-filed", "its own earlier order: no second spend");
  assert.deepEqual([own.id, own.state], ["LEGACY-1", "waiting"]);
  const other = await start(B, { id: "LEGACY-1", profileKey: "zephyr" });
  assert.equal(other.outcome, "queued", other.text);
  assert.match(other.id, /^LEGACY-1@[0-9a-f]{12}$/);
  assert.doesNotMatch(other.text, /already|exists|demo-brand-owner/i);
});

test("a session that sees every account files the reference as sent: its retry is the order, another account's is refused", async () => {
  const s = await start(STAFF, { id: "ORDER-4", profileKey: "demo-brand-owner" });
  assert.equal(s.outcome, "queued", s.text);
  assert.equal(s.id, "ORDER-4");
  const retry = await start(STAFF, { id: "ORDER-4", profileKey: "demo-brand-owner" });
  assert.deepEqual([retry.outcome, retry.id, retry.state], ["already-filed", "ORDER-4", "waiting"]);
  const again = await start(STAFF, { id: "ORDER-4", profileKey: "zephyr" });
  assert.equal(again.outcome, "refused");
  assert.match(again.reason, /a job with id "ORDER-4" is already queued\/processing/);
});

test("a retry of an order refused before it ran is that refusal, with its kind and never the runner's words, and nothing new", async () => {
  const first = await start(A, { id: "ORDER-5", profileKey: "demo-brand-owner" });
  const count = files().length;
  renameSync(join(QUEUE, `${first.id}.json`), join(QUEUE, `${first.id}.failed`));
  writeFileSync(join(QUEUE, `${first.id}.failed.reason`), "Refused before it ran, in the runner's words.\nnotify: sent\n");
  writeFileSync(join(QUEUE, `${first.id}.failed.kind`), "run-cap\n");
  const again = await start(A, { id: "ORDER-5", profileKey: "demo-brand-owner" });
  assert.deepEqual([again.outcome, again.id, again.state, again.terminal, again.reason, again.reasonKind],
    ["already-filed", first.id, "refused", true, null, "run-cap"]);
  assert.doesNotMatch(again.text, /runner's words/, "the reason as written stays with the operator");
  assert.equal(files().length, count - 1, "nothing queued again");
});

test("order_status tells every session which check refused an order, and none of them the reason as written", async () => {
  const first = await start(A, { id: "ORDER-9", profileKey: "demo-brand-owner" });
  renameSync(join(QUEUE, `${first.id}.json`), join(QUEUE, `${first.id}.failed`));
  writeFileSync(join(QUEUE, `${first.id}.failed.reason`), "account demo-brand-owner: run cap 3 of 3\nnotify: sent\n");
  writeFileSync(join(QUEUE, `${first.id}.failed.kind`), "run-cap\n");
  const own = await status(A, first.id);
  assert.deepEqual([own.state, own.reason, own.reasonKind], ["refused", null, "run-cap"]);
  // A session that sees every account is told whose order it is, and the kind; the runner's text stays in the queue's
  // record for everyone (design, 2026-11-27). A retry of the reference answers the same.
  const staff = await status(STAFF, first.id);
  assert.deepEqual([staff.reasonKind, staff.reason, staff.account], ["run-cap", null, "demo-brand-owner"]);
  assert.doesNotMatch(JSON.stringify(staff), /run cap 3 of 3|notify/);
  const staffRetry = await start(STAFF, { id: first.id, profileKey: "demo-brand-owner" });
  assert.deepEqual([staffRetry.outcome, staffRetry.reason, staffRetry.reasonKind], ["already-filed", null, "run-cap"]);
  assert.doesNotMatch(JSON.stringify(staffRetry), /run cap 3 of 3|notify/);
  // An order refused before kinds were recorded is `other`, and a waiting one has no kind.
  const old = await start(A, { id: "ORDER-10", profileKey: "demo-brand-owner" });
  renameSync(join(QUEUE, `${old.id}.json`), join(QUEUE, `${old.id}.failed`));
  writeFileSync(join(QUEUE, `${old.id}.failed.reason`), "refused before kinds\n");
  assert.equal((await status(A, old.id)).reasonKind, "other");
  const waiting = await start(A, { id: "ORDER-11", profileKey: "demo-brand-owner" });
  assert.equal((await status(A, waiting.id)).reasonKind, null);
});

test("order_status finds an order by either reference for its own account, and nothing of another's", async () => {
  const a = await start(A, { id: "ORDER-6", profileKey: "demo-brand-owner" });
  for (const id of ["ORDER-6", a.id]) {
    const found = await status(A, id);
    assert.deepEqual([found.found, found.reference, found.state, found.runId], [true, a.id, "waiting", null], id);
    assert.equal(found.account, undefined, "a client's answer does not name the account");
  }
  // Another account's order, by its bare reference or by the full one, answers as a reference nobody holds.
  const nobody = await status(B, "NO-SUCH-ORDER");
  assert.deepEqual(nobody, { found: false, basis: "not-found" });
  assert.deepEqual(await status(B, "ORDER-6"), nobody);
  assert.deepEqual(await status(B, a.id), nobody);
  // Two Generic organisations: each finds its own and not the other's.
  const x = await start(ORG_X, { id: "ORDER-7" });
  assert.equal((await status(ORG_X, "ORDER-7")).reference, x.id);
  assert.deepEqual(await status(ORG_Y, "ORDER-7"), nobody);
  // The operator names exactly the reference it gives, and is told whose order it is.
  const staff = await status(STAFF, a.id);
  assert.deepEqual([staff.found, staff.account], [true, "demo-brand-owner"]);
});

test("a session holding two accounts finds each order by the reference it was given, and is told when one name means two", async () => {
  const BOTH = person("orders@both.example", { accounts: ["demo-brand-owner", "zephyr"] });
  const one = await start(BOTH, { id: "ORDER-8", profileKey: "demo-brand-owner" });
  const two = await start(BOTH, { id: "ORDER-8", profileKey: "zephyr" });
  assert.deepEqual([one.outcome, two.outcome], ["queued", "queued"], "two accounts' orders, both filed");
  assert.equal((await status(BOTH, one.id)).reference, one.id);
  assert.equal((await status(BOTH, two.id)).reference, two.id);
  assert.deepEqual(await status(BOTH, "ORDER-8"), { found: false, basis: "ambiguous" });
  assert.deepEqual(await status(A, "ORDER-8"), { ...(await status(A, one.id)) }, "one account alone is not told of the other's");
});

test("the mark is the one orders have been filed under since references first carried it", () => {
  // Computed with the connector's own copy at the commit that introduced the mark.
  assert.equal(accountMark({ profileKey: "demo-brand-owner" }), "3588122817d3");
  assert.equal(accountMark({ profileKey: "generic", tenant: "orgx" }), "6191f6f8c805");
  assert.equal(accountMark({ tenant: "orgx" }), "6191f6f8c805", "no account is Generic");
  assert.equal(accountMark({}), "1572423e0cf4");
});

test("a reference too long to carry the mark is refused in the id rule's own sentence, with the room it has", async () => {
  const r = await start(A, { id: "R".repeat(120), profileKey: "demo-brand-owner" });
  assert.equal(r.outcome, "refused");
  assert.match(r.reason, /Use an ID of 1–115 characters\. .* This one has 120 characters\./);
});
