// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO SESSION IS GIVEN THE RUNNER'S WORDS FOR AN ORDER.
//
// Every person using Clearotron is told of an order in product terms, whatever their role (design, 2026-11-27): never a
// queue's name, a file's path, an override flag, a network error code or a check's own message, which the runner keeps
// in the queue's record. Here each refused order's record holds all five. order_status and start_run's answer to a
// retried reference are asked about it, by a company's session and by a session that sees every account, for an order
// placed through a company's own connector, one forwarded by email and one staff placed for someone else. The whole
// answer is read: the structured fields and the text the assistant is shown.
// Every name is invented.
import { mkdtempSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "runners-words-"));
const QUEUE = join(ROOT, "queue");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", QUEUE);
process.env.TRADEMARK_MCP_AUDIT_LOG = join(ROOT, "audit.jsonl");

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { makeServer } = await import("../server.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const COMPANY = { kind: "account", sub: "orders@alpha.example", permissions: { run: true, manage: false }, accounts: ["demo-brand-owner"] };
const EVERYTHING = null;   // the ops door: sees every account

const RECORDED = "/home/invented/work/workspace-intake-agent/studio/queue/ORDER.failed: re-submit with --dup-override; "
  + "receiver said ETIMEDOUT; runCaps.dailyRuns must be at most 2";
const INTERNAL = /\/home\/invented|workspace-intake-agent|studio\/queue|--dup-override|dupOverride|ETIMEDOUT|runCaps|dailyRuns|notify:/;

async function call(scope, name, args) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer(scope ? { scope, local: false } : undefined).connect(b);
  const client = new Client({ name: "runners-words-test", version: "1" });
  await client.connect(a);
  await client.listTools();   // compiles every declared shape: each answer below is checked against its own
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  return r;
}
const ORDER = { markName: "VELLOQUIN", classes: [9], profileKey: "demo-brand-owner" };

/** Files an order the way it came in, then refuses it with the record above, as the runner would. */
async function refusedOrder(scope, id, extra) {
  const r = await call(scope, "start_run", { ...ORDER, id, ...extra });
  const filed = r.structuredContent?.id;
  assert.ok(filed, r.content?.[0]?.text);
  renameSync(join(QUEUE, `${filed}.json`), join(QUEUE, `${filed}.failed`));
  writeFileSync(join(QUEUE, `${filed}.failed.reason`), `${RECORDED}\nnotify: sent\n`);
  writeFileSync(join(QUEUE, `${filed}.failed.kind`), "run-cap\n");
  return filed;
}

test("order_status and a retried start_run tell every session the kind of refusal and nothing the runner wrote", async () => {
  const orders = [
    ["through a company's own connector", COMPANY, await refusedOrder(COMPANY, "ORD-OWN", { forwarder: "requester" })],
    ["forwarded by email", EVERYTHING, await refusedOrder(EVERYTHING, "ORD-MAIL", { forwarder: "jordan", forwarderEmail: "jordan@outside.example", msgId: "<m1@outside.example>" })],
    ["placed by staff for someone else", EVERYTHING, await refusedOrder(EVERYTHING, "ORD-FOR", { forwarder: "staff", forwarderEmail: "orders@alpha.example" })],
  ];
  for (const [how, placedBy, filed] of orders) {
    for (const [who, scope] of [["a company's session", COMPANY], ["a session that sees every account", EVERYTHING]]) {
      if (scope === COMPANY && placedBy !== COMPANY) continue;   // a company asks by the reference it was given
      const status = await call(scope, "order_status", { id: filed });
      assert.ok(!status.isError, status.content?.[0]?.text);
      assert.deepEqual([status.structuredContent.state, status.structuredContent.reasonKind, status.structuredContent.reason],
        ["refused", "run-cap", null], `${how}, ${who}`);
      assert.doesNotMatch(JSON.stringify(status), INTERNAL, `order_status, ${how}, ${who}`);
      const retry = await call(scope, "start_run", { ...ORDER, id: filed, forwarder: "requester" });
      assert.deepEqual([retry.structuredContent?.outcome, retry.structuredContent?.reasonKind, retry.structuredContent?.reason],
        ["already-filed", "run-cap", null], `${how}, ${who}: ${retry.content?.[0]?.text}`);
      assert.doesNotMatch(JSON.stringify(retry), INTERNAL, `start_run retry, ${how}, ${who}`);
    }
  }
});
