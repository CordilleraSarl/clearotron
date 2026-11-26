// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN URGENT ORDER RUNS AT THE SPEED THIS INSTALLATION CAN, AND THE CONNECTOR SAYS WHICH BEFORE AND AFTER.
//
// The connector carries the order's How soon option, `urgent`. Whether this installation can run it is the answer the
// run itself reads at its start (engine/speed.mjs urgentAvailability, through lib/urgent.mjs):
//   - where it can, the order is written Urgent;
//   - where it cannot, the order starts at Standard, counts as one search, and the reply says so in the board's own
//     sentence. It is never refused and never held;
//   - a value that is not a boolean is refused, so an Urgent order is never quietly run, and counted, as Standard.
// describe_options says which, and plan_run previews both options' turnaround and count from the shared effort model.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "urgent-order-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", join(ROOT, "queue"));

const { test, afterEach } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { makeServer } = await import("../server.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { URGENT_UNAVAILABLE } = await import("../lib/urgent.mjs");

// THE TWO INSTALLATIONS: Claude on a subscription can run Urgent; Claude through Amazon Bedrock cannot (the vendor's
// fast-mode page, read in engine/speed.mjs).
const CAN = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "subscription", CLAUDE_CODE_USE_BEDROCK: undefined };
const CANNOT = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_BEDROCK: "1" };
const saved = {};
function installation(env) {
  for (const [k, v] of Object.entries(env)) {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

async function call(name, args) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer().connect(b);
  const client = new Client({ name: "urgent-order-test", version: "1" });
  await client.connect(a);
  await client.listTools();   // the SDK client checks every answer of a tool that declares one
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  return r;
}
const order = (extra) => ({ markName: `URGENT${Math.random().toString(36).slice(2, 7).toUpperCase()}`, forwarder: "requester", classes: [9],
  profileKey: "demo-brand-owner", product: "multi-country-focus-search", jurisdictions: ["EU", "US"], ...extra });
const queuedJob = (r) => JSON.parse(readFileSync(r.structuredContent.queuePath, "utf8"));

test("where this installation can run Urgent, the order is written Urgent and nothing is added to the reply", async () => {
  installation(CAN);
  const r = await call("start_run", order({ urgent: true }));
  assert.equal(r.structuredContent?.outcome, "queued", JSON.stringify(r.content));
  assert.equal(queuedJob(r).urgent, true);
  assert.ok(!r.structuredContent.warnings.includes(URGENT_UNAVAILABLE));
});

test("where it cannot, the order starts at Standard, is never refused, and its reply says so in the board's sentence", async () => {
  installation(CANNOT);
  const r = await call("start_run", order({ urgent: true }));
  assert.equal(r.isError, undefined, JSON.stringify(r.content));
  assert.equal(r.structuredContent.outcome, "queued");
  assert.equal(queuedJob(r).urgent, false, "written Standard, so it runs and counts as one search");
  assert.ok(r.structuredContent.warnings.includes("Not available with this installation's AI service. Searches run at Standard."));
});

test("a Standard order, sent or omitted, is written as sent on either installation", async () => {
  for (const env of [CAN, CANNOT]) {
    installation(env);
    assert.equal(queuedJob(await call("start_run", order({ urgent: false }))).urgent, false);
    assert.equal("urgent" in queuedJob(await call("start_run", order({}))), false);
  }
});

test("a value that is not a boolean is refused, on both tools, rather than run as Standard", async () => {
  installation(CAN);
  for (const tool of ["start_run", "plan_run"]) {
    const r = await call(tool, order({ urgent: "yes" }));
    const said = tool === "start_run" ? r.structuredContent?.reason ?? r.content[0].text : JSON.parse(r.content[0].text).blockers.join("\n");
    assert.match(said, /urgent "yes" must be a boolean/, `${tool}: ${said}`);
  }
});

test("describe_options says whether this installation can run Urgent", async () => {
  installation(CAN);
  assert.deepEqual(JSON.parse((await call("describe_options", {})).content[0].text).urgent, { available: true });
  installation(CANNOT);
  assert.deepEqual(JSON.parse((await call("describe_options", {})).content[0].text).urgent, { available: false, note: URGENT_UNAVAILABLE });
});

test("plan_run previews both options' turnaround and count, from the shared effort model", async () => {
  installation(CAN);
  const can = JSON.parse((await call("plan_run", order({ urgent: true }))).content[0].text).howSoon;
  assert.equal(can.chosen, "urgent");
  assert.equal(can.urgentAvailable, true);
  for (const opt of [can.standard, can.urgent]) {
    assert.equal(typeof opt.turnaround, "string");
    assert.equal(typeof opt.searches, "number");
  }
  installation(CANNOT);
  const cannot = JSON.parse((await call("plan_run", order({ urgent: true }))).content[0].text);
  assert.equal(cannot.howSoon.chosen, "standard", "previewed as it would run: Standard");
  assert.equal(cannot.howSoon.urgentAvailable, false);
  assert.equal(cannot.howSoon.urgent, null);
  assert.equal(cannot.howSoon.urgentNote, URGENT_UNAVAILABLE);
  assert.ok(cannot.warnings.includes(URGENT_UNAVAILABLE));
});
