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
//   - the same account sending it again meets its own order, which is refused as already filed, spending nothing and
//     writing nothing; sending the reference it was given back is the same retry;
//   - an order filed under the bare reference before this change is the same order to its own account, and nothing at
//     all to another;
//   - a session that sees every account (an operator) files the reference as sent, and is answered as before.
// Every name is invented.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
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

const person = (sub, extra) => ({ kind: "account", sub, permissions: { run: true, manage: false }, ...extra });
const A = person("orders@alpha.example", { accounts: ["demo-brand-owner"] });
const B = person("orders@beta.example", { accounts: ["zephyr"] });
const ORG_X = person("orders@x.example", { accounts: [], genericOrgs: ["orgx"] });
const ORG_Y = person("orders@y.example", { accounts: [], genericOrgs: ["orgy"] });
const STAFF = null;   // the ops door: sees every account

async function start(scope, args) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer(scope ? { scope, local: false } : undefined).connect(b);
  const client = new Client({ name: "reference-account-test", version: "1" });
  await client.connect(a);
  await client.listTools();
  const r = await client.callTool({ name: "start_run", arguments: { markName: "QZORVAK", classes: [9], forwarder: "requester", ...args } });
  await client.close();
  return { outcome: r.structuredContent?.outcome, id: r.structuredContent?.id, reason: r.structuredContent?.reason, text: r.content?.[0]?.text ?? "" };
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

test("the same account sending it again meets its own order: refused, nothing written, nothing spent", async () => {
  const first = await start(A, { id: "ORDER-2", profileKey: "demo-brand-owner" });
  const count = files().length;
  const kept = read(`${first.id}.json`);
  for (const id of ["ORDER-2", first.id]) {   // the reference it sent, and the one it was given back
    const again = await start(A, { id, profileKey: "demo-brand-owner" });
    assert.equal(again.outcome, "refused", `${id}: ${again.text}`);
    assert.match(again.reason, new RegExp(`a job with id "${first.id}" is already queued/processing`));
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
  assert.equal(own.outcome, "refused", "its own earlier order: no second spend");
  assert.match(own.reason, /a job with id "LEGACY-1" is already queued\/processing/);
  const other = await start(B, { id: "LEGACY-1", profileKey: "zephyr" });
  assert.equal(other.outcome, "queued", other.text);
  assert.match(other.id, /^LEGACY-1@[0-9a-f]{12}$/);
  assert.doesNotMatch(other.text, /already|exists|demo-brand-owner/i);
});

test("a session that sees every account files the reference as sent, and is answered as before", async () => {
  const s = await start(STAFF, { id: "ORDER-4", profileKey: "demo-brand-owner" });
  assert.equal(s.outcome, "queued", s.text);
  assert.equal(s.id, "ORDER-4");
  const again = await start(STAFF, { id: "ORDER-4", profileKey: "zephyr" });
  assert.equal(again.outcome, "refused");
  assert.match(again.reason, /a job with id "ORDER-4" is already queued\/processing/);
});

test("a reference too long to carry the mark is refused in the id rule's own sentence, with the room it has", async () => {
  const r = await start(A, { id: "R".repeat(120), profileKey: "demo-brand-owner" });
  assert.equal(r.outcome, "refused");
  assert.match(r.reason, /Use an ID of 1–115 characters\. .* This one has 120 characters\./);
});
