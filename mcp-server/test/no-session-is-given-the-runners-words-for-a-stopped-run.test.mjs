// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO SESSION IS GIVEN THE RUNNER'S WORDS FOR A STOPPED RUN.
//
// What a connector returns to a person or their assistant is user output, with full access as without (design,
// 2026-11-27). A session that sees every company asks about two stopped runs here:
//   - one whose failure packet an earlier version wrote, quoting the stage, an exception with a file's path, a
//     network error code, the kind and the setting that holds chat numbers;
//   - one this version wrote, which waited out a provider's usage cap and stopped for it.
// Each door that answers about a run or its notice is read whole: list_runs, get_run, decision_timeline,
// get_delivery_packet and list_outbox_events. The run's own record keeps every word; no door hands one on. The notice
// is the approved sentence, and the cap sentence only where a cap wait is on record.
// Every name is invented.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { driverDir } from "../../shared/driver-dir.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "stopped-run-words-"));
const OUTBOX = join(ROOT, "outbox");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", OUTBOX);
process.env.TRADEMARK_MCP_AUDIT_LOG = join(ROOT, "audit.jsonl");

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { config } = await import("../lib/driver.mjs");
const { makeServer } = await import("../server.mjs");
const { buildFailurePacket } = await import("../../driver/run-outcome.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const RECORDED = "TypeError: receiver said ETIMEDOUT at Object.probe (/srv/invented/app/driver/pipeline.mjs:2411:9)";
// What no door may hand on, in a run read or a notice.
const INTERNAL = /\/srv\/invented|ETIMEDOUT|TypeError|pipeline\.mjs|CLEAROTRON_REQUESTER_WHATSAPP|reasonVerbatim|failureSignature|diagnostic/;
// What the notice a person reads may not name besides: the stage, the kind, the word the staff copy used.
const NOT_IN_A_NOTICE = /register-probe|deterministic|weather-exhausted|FAILED|REFUSED|verbatim/;

const WS = join(ROOT, `workspace-${config.defaultAgent}`);
function stoppedRun(slug, packet) {
  const codename = "2026-11-27-slate-heron";
  const runDir = join(WS, "studio", "clearance-search", slug, codename);
  mkdirSync(driverDir(runDir), { recursive: true });
  const runId = `${slug}-${codename}`;
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId, slug, codename, date: "2026-11-27", agent: config.defaultAgent, state: "failed",
    markName: "VELLOQUIN", failedStage: "register-probe", reason: RECORDED, terminalKind: packet.terminalKind, sendPending: true }));
  writeFileSync(join(runDir, "run.jsonl"), `${JSON.stringify({ event: "failed", stage: "register-probe", reason: RECORDED, ts: "2026-11-27T09:00:00Z" })}\n`);
  const full = { kind: "run-failed", ...packet, runId, agent: config.defaultAgent };
  writeFileSync(driverDir(runDir, "failure.json"), JSON.stringify(full));
  mkdirSync(OUTBOX, { recursive: true });
  writeFileSync(join(OUTBOX, `${runId}.failed.pending`), JSON.stringify(full));
  return runId;
}

// An earlier version's packet, as 0.7.0 wrote it: the staff copy in the fields a courier relays, and no notice fields.
const OLDER = stoppedRun("tmpx-velloquin", {
  failed: true, refused: false, forwarder: "jordan", forwarderEmail: "jordan@outside.example", msgId: "<m1@outside.example>",
  subject: "VELLOQUIN — run FAILED, nothing delivered",
  emailBodyHtml: `<p>The search for <b>VELLOQUIN</b> FAILED at stage <b>register-probe</b>.</p><p>The driver reported, verbatim:</p><pre>${RECORDED}</pre>`,
  whatsappTo: null, whatsappChannel: "whatsapp",
  whatsappToReason: "no chat number is held for jordan@outside.example — set one in CLEAROTRON_REQUESTER_WHATSAPP to notify them",
  whatsappText: `❌ Clearotron search for VELLOQUIN FAILED at register-probe [deterministic]: ${RECORDED} — nothing was delivered`,
  text: `❌ Clearotron search for VELLOQUIN FAILED at register-probe [deterministic]: ${RECORDED} — nothing was delivered`,
  markName: "VELLOQUIN", failedStage: "register-probe", reason: RECORDED, reasonVerbatim: RECORDED, failureSignature: "register-probe|abc",
  failClass: "deterministic", terminalKind: "deterministic", repairs: [{ repair: "retry", outcome: RECORDED }], reasonDetail: RECORDED,
});
// This version's packet for a run that waited out a provider's usage cap.
const capped = buildFailurePacket({ runId: "x", agent: "x", job: { markName: "VELLOQUIN", product: "knockout-search", forwarder: "staff",
  forwarderEmail: "orders@alpha.example" }, failedStage: "register-probe", shortReason: RECORDED, reasonVerbatim: RECORDED, sig: "s",
  failClass: "transient", terminalKind: "weather-exhausted", priorAttempts: 3, reasonDetail: RECORDED,
  capWait: { waitedMin: 300, parks: 3, statedResets: 0 } });
const CAPPED = stoppedRun("tmpx-velloquin-ko", { ...capped, text: capped.whatsappText });

async function call(name, args = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer().connect(b);   // the ops door: a session that sees every company
  const client = new Client({ name: "stopped-run-words-test", version: "1" });
  await client.connect(a);
  await client.listTools();   // compiles every declared shape: each answer below is checked against its own
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
  return r;
}
const wire = (r) => JSON.stringify(r);

test("a session that sees every company reads a stopped run without the runner's words, at every run door", async () => {
  const runs = await call("list_runs");
  const rows = runs.structuredContent.items.filter((r) => [OLDER, CAPPED].includes(r.runId));
  assert.equal(rows.length, 2, wire(runs));
  for (const row of rows) {
    assert.equal(row.state, "failed", "the failure stays visible");
    assert.equal(row.reasonRedacted, true);
    assert.equal(row.agent, config.defaultAgent, "the courier's routing stays");
  }
  assert.doesNotMatch(wire(runs), INTERNAL, "list_runs");
  for (const id of [OLDER, CAPPED]) {
    assert.doesNotMatch(wire(await call("get_run", { runId: id })), INTERNAL, `get_run ${id}`);
    assert.doesNotMatch(wire(await call("decision_timeline", { runId: id })), INTERNAL, `decision_timeline ${id}`);
  }
});

test("a stopped run's notice leaves the outbox doors in the approved words, whichever version wrote it", async () => {
  const ADMIN = "Please tell whoever administers this installation.";
  const older = (await call("get_delivery_packet", { runId: OLDER })).structuredContent.failure;
  assert.equal(older.text, `The search for VELLOQUIN stopped before it finished, and nothing was delivered. ${ADMIN}`);
  assert.equal(older.whatsappText, older.text, "the messaging line is the same notice");
  assert.equal(older.subject, "VELLOQUIN — search stopped, nothing delivered");
  assert.equal(older.forwarderEmail, "jordan@outside.example", "the routing a courier sends by stays");
  assert.ok(!("whatsappToReason" in older), "the install's setup hint is not handed on");

  const cap = (await call("get_delivery_packet", { runId: CAPPED })).structuredContent.failure;
  assert.match(cap.text, /^The Knockout search for VELLOQUIN stopped before it finished, and nothing was delivered\. A provider's usage cap was still in force after 5h of waiting across 3 attempts/);
  assert.match(cap.text, /Re-trigger once the cap has reset\.$/);
  assert.ok(!cap.text.includes(ADMIN), "one recovery action, the cap sentence's own");

  const events = (await call("list_outbox_events")).structuredContent.events.filter((e) => e.kind === "run-failed");
  assert.equal(events.length, 2);
  for (const ev of events) {
    assert.ok(ev.file && ev.runId && ev.agent, "a courier can still route and settle it");
    assert.doesNotMatch(`${ev.subject} ${ev.emailBodyHtml} ${ev.text} ${ev.whatsappText}`, NOT_IN_A_NOTICE, ev.runId);
  }
  for (const r of [await call("get_delivery_packet", { runId: OLDER }), await call("get_delivery_packet", { runId: CAPPED }), await call("list_outbox_events")]) {
    assert.doesNotMatch(wire(r), INTERNAL);
    assert.doesNotMatch(wire(r), /register-probe|deterministic|weather-exhausted/, "no stage or kind in a notice packet");
  }
  // The run's own record keeps every word.
  const record = JSON.parse(readFileSync(driverDir(join(WS, "studio", "clearance-search", "tmpx-velloquin", "2026-11-27-slate-heron"), "failure.json"), "utf8"));
  assert.equal(record.reasonVerbatim, RECORDED);
});
