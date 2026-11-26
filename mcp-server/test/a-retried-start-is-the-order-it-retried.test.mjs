// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RETRIED START_RUN IS THE ORDER IT RETRIED. The id a caller sends is the order's reference and its queue file's name.
// Sent again while the order waits, after it was refused before starting, or after it finished, it never writes a
// second order under the same reference; it answers with the first (already-filed), as it stands.
import { mkdtempSync, existsSync, renameSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "retried-start-"));
const QUEUE = join(ROOT, "queue");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", QUEUE);

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { makeServer } = await import("../server.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

async function call(name, args) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer().connect(b);
  const client = new Client({ name: "retried-start-test", version: "1" });
  await client.connect(a);
  await client.listTools();
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  return r;
}
const order = (id) => ({ id, markName: "RETRY PROBE", forwarder: "requester", classes: [9], profileKey: "demo-brand-owner",
  product: "multi-country-focus-search", jurisdictions: ["EU", "US"] });
const text = (r) => (r.content ?? []).map((c) => c.text ?? "").join(" ");
const jsonFiles = () => readdirSync(QUEUE).filter((n) => n.endsWith(".json"));

test("sent again while it waits, after a refusal before starting, or after it finished, it writes no second order", async () => {
  const first = await call("start_run", order("retry-1"));
  assert.equal(first.structuredContent?.outcome, "queued", text(first));

  const filed = (r) => { const s = r.structuredContent ?? {}; return [r.isError ?? false, s.outcome, s.id, s.state, s.reason]; };
  const whileWaiting = await call("start_run", order("retry-1"));
  assert.deepEqual(filed(whileWaiting), [false, "already-filed", "retry-1", "waiting", null], text(whileWaiting));

  // The runner refused it at the claim: the marker it leaves, and the reason beside it.
  renameSync(join(QUEUE, "retry-1.json"), join(QUEUE, "retry-1.failed"));
  writeFileSync(join(QUEUE, "retry-1.failed.reason"), "demo-brand-owner is demo data and cannot run a real clearance.\nnotify: sent\n");
  const afterRefusal = await call("start_run", order("retry-1"));
  assert.deepEqual(filed(afterRefusal), [false, "already-filed", "retry-1", "refused", "demo-brand-owner is demo data and cannot run a real clearance."]);
  assert.ok(!existsSync(join(QUEUE, "retry-1.json")), "no second order was queued");

  renameSync(join(QUEUE, "retry-1.failed"), join(QUEUE, "retry-1.done"));
  const afterDelivery = await call("start_run", order("retry-1"));
  assert.deepEqual(filed(afterDelivery).slice(0, 4), [false, "already-filed", "retry-1", "delivered"]);
  assert.deepEqual(jsonFiles(), [], "nothing new in the queue at any point");
});
