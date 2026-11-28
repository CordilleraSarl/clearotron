// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OUTBOX FILE HOLDS ONLY THE NOTICE AND ITS ROUTING.
//
// The outbox file leaves the engine: docs/DELIVERY.md offers it to an integrator whole (design, 2026-11-27). So the bytes
// on disk are read here, not a door's answer:
//   - a stopped run's packet, through the real writer, for a run that waited out a provider's usage cap: the notice
//     with the cap sentence, its routing, and no word of the stage, the kind or the reason;
//   - the packets an earlier version wrote, which the worker rewrites under their own names before it delivers: the
//     routing and the failure's id kept, the run's record holding every word, and a second pass changing nothing.
// Every name is invented.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { driverDir } from "../../shared/driver-dir.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "outbox-notice-only-"));
const OUTBOX = join(ROOT, "outbox");
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_OUTBOX_DIR", OUTBOX);

const { test } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { writeOutboxPacket } = await import("../outbox.mjs");
const { plainOlderOutboxPackets, userOutboxPacket } = await import("../outbox-notices.mjs");
const { buildFailurePacket } = await import("../run-outcome.mjs");

const RECORDED = "TypeError: receiver said ETIMEDOUT at Object.probe (/srv/invented/app/driver/pipeline.mjs:2411:9)";
// What no outbox file may hold.
const INTERNAL = /\/srv\/invented|ETIMEDOUT|TypeError|pipeline\.mjs|register-probe|weather-exhausted|deterministic|FAILED|reasonVerbatim|failedStage|terminalKind|failureSignature|diagnostic|repairs|CLEAROTRON_REQUESTER_WHATSAPP|matterSignature|dup-override|dupOverride|queue/;
const ADMIN = "Please tell whoever administers this installation.";
const read = (file) => readFileSync(join(OUTBOX, file), "utf8");
const withoutTs = ({ ts: _t, ...p }) => p;

test("a stopped run's outbox file, written for a cap death, holds the cap notice and its routing and nothing of the stop", () => {
  const packet = { kind: "run-failed", ...buildFailurePacket({ runId: "tmpx-velloquin-2026-11-27-slate-heron", agent: "intake-agent",
    job: { markName: "VELLOQUIN", product: "knockout-search", forwarder: "jordan", forwarderEmail: "jordan@outside.example", msgId: "<k1@outside.example>" },
    failedStage: "register-probe", shortReason: RECORDED, reasonVerbatim: RECORDED, sig: "s", failClass: "transient",
    terminalKind: "weather-exhausted", priorAttempts: 3, repairs: [{ repair: "retry", outcome: RECORDED }],
    capWait: { waitedMin: 300, parks: 3, statedResets: 0 } }), markName: "VELLOQUIN", reason: RECORDED, failureSignature: "s" };
  packet.text = packet.whatsappText;
  const dest = writeOutboxPacket(`${packet.runId}.failed`, packet);
  assert.ok(dest, "the packet was written");
  const bytes = read(`${packet.runId}.failed.pending`);
  assert.doesNotMatch(bytes, INTERNAL);
  const onDisk = JSON.parse(bytes);
  assert.match(onDisk.text, /^The Knockout search for VELLOQUIN stopped before it finished, and nothing was delivered\. A provider's usage cap was still in force after 5h of waiting across 3 attempts/);
  assert.match(onDisk.text, /Re-trigger once the cap has reset\.$/);
  assert.ok(!onDisk.text.includes(ADMIN), "one recovery action, the cap sentence's own");
  assert.equal(onDisk.whatsappText, onDisk.text);
  assert.equal(onDisk.failureId, packet.failureId, "the failure's id rides with its notice");
  assert.equal(onDisk.forwarderEmail, "jordan@outside.example");
  // A door reading the file hands on the same packet: composing it again changes nothing.
  assert.deepEqual(userOutboxPacket(onDisk), withoutTs(onDisk));
});

// The run folders a rewritten packet's record is confirmed in.
const RUNS = {};
function runWithRecord(runId, record) {
  const runDir = join(ROOT, "runs", runId);
  mkdirSync(driverDir(runDir), { recursive: true });
  if (record) writeFileSync(driverDir(runDir, "failure.json"), JSON.stringify(record, null, 2));
  RUNS[runId] = runDir;
  return runDir;
}
// As 0.7.0 wrote a stopped run's packet: the staff copy in every field a courier relays.
const olderStop = (runId, extra = {}) => ({
  ts: "2026-11-20T09:00:00.000Z", kind: "run-failed", runId, agent: "intake-agent", failed: true, refused: false,
  forwarder: "jordan", forwarderEmail: "jordan@outside.example", msgId: `<${runId}@outside.example>`, conversationId: null,
  subject: "VELLOQUIN — run FAILED, nothing delivered",
  emailBodyHtml: `<p>The search for <b>VELLOQUIN</b> FAILED at stage <b>register-probe</b>.</p><pre>${RECORDED}</pre>`,
  whatsappTo: "+41000000001", whatsappChannel: "whatsapp", whatsappCcOperator: null,
  whatsappText: `❌ Clearotron search for VELLOQUIN FAILED at register-probe [deterministic]: ${RECORDED} — nothing was delivered`,
  markName: "VELLOQUIN", failedStage: "register-probe", reason: RECORDED, reasonVerbatim: RECORDED, terminalKind: "deterministic",
  failClass: "deterministic", repairs: [{ repair: "retry", outcome: RECORDED }], failureSignature: "register-probe|abc",
  text: `❌ Clearotron search for VELLOQUIN FAILED at register-probe [deterministic]: ${RECORDED} — nothing was delivered`,
  ...extra,
});

test("the packets an earlier version wrote are rewritten under their own names before delivery, and the run's record keeps every word", () => {
  mkdirSync(OUTBOX, { recursive: true });
  const KEPT = olderStop("tmpx-velloquin-2026-11-20-amber-gate", { failureId: "f-0001" });
  runWithRecord(KEPT.runId, KEPT);
  const recordBefore = readFileSync(driverDir(RUNS[KEPT.runId], "failure.json"), "utf8");
  const ONLY_HERE = olderStop("tmpx-velloquin-2026-11-20-birch-quay");
  runWithRecord(ONLY_HERE.runId, null);   // its run folder holds no record: the outbox copy is the only full one
  const files = {
    [`${KEPT.runId}.failed.pending`]: KEPT,
    [`${ONLY_HERE.runId}.failed.pending`]: ONLY_HERE,
    "intake-q-0001.failed.pending": { ts: "2026-11-20T09:01:00.000Z", kind: "intake-rejected", classify: "reject", base: "q-0001",
      agent: "intake-agent", account: "alpha", organisation: null, jobId: "j1", msgId: "<q1@outside.example>", forwarder: "jordan",
      forwarderEmail: "jordan@outside.example", markName: "VELLOQUIN", errors: ["CLEAROTRON_RUN_CAP reached in the intake-agent queue"],
      text: "⚠️ Clearotron request \"VELLOQUIN\" was rejected at intake: CLEAROTRON_RUN_CAP reached. Job parked as q-0001.failed in the intake-agent queue." },
    "intake-q-0002.duplicate.pending": { ts: "2026-11-20T09:02:00.000Z", kind: "duplicate-skipped", base: "q-0002", agent: "intake-agent",
      account: "alpha", organisation: null, jobId: "j2", msgId: "<q2@outside.example>", forwarder: "jordan", forwarderEmail: "jordan@outside.example",
      markName: "VELLOQUIN", matterSignature: "sig-abc", priorMsgId: "<other-company@outside.example>", priorJobId: "j0",
      priorRecordedAt: "2026-11-19T08:00:00.000Z", matchedBy: "matter-signature",
      text: "⚠️ Clearotron request \"VELLOQUIN\" matches a matter already in progress — re-submit it with dupOverride (`--dup-override`)." },
    "intake-q-0003.prerun-failed.pending": { ts: "2026-11-20T09:03:00.000Z", kind: "pre-run-failed", base: "q-0003", agent: "intake-agent",
      account: "alpha", organisation: null, jobId: "j3", msgId: "<q3@outside.example>", forwarder: "jordan", forwarderEmail: "jordan@outside.example",
      markName: "VELLOQUIN", whatsappTo: null, whatsappChannel: "whatsapp", whatsappCcOperator: null,
      whatsappToReason: "no chat number is held for jordan@outside.example — set one in CLEAROTRON_REQUESTER_WHATSAPP to notify them",
      reason: RECORDED, text: `⚠️ Clearotron request "VELLOQUIN" failed before its run could start: ${RECORDED}` },
  };
  for (const [name, p] of Object.entries(files)) writeFileSync(join(OUTBOX, name), JSON.stringify(p, null, 2));
  writeFileSync(join(OUTBOX, "tmpx-other-2026-11-20-cedar-lane.pending"), "intake-agent\n");   // a delivered marker
  const markerBefore = read("tmpx-other-2026-11-20-cedar-lane.pending");
  const before = new Set(readdirSync(OUTBOX));

  const rewritten = plainOlderOutboxPackets({ outboxDir: OUTBOX, recordDirFor: (id) => RUNS[id] ?? null });
  assert.deepEqual(rewritten.sort(), Object.keys(files).filter((f) => f !== "tmpx-velloquin-2026-11-27-slate-heron.failed.pending").sort());
  assert.deepEqual(new Set(readdirSync(OUTBOX)), before, "every file keeps its name: the name is what settles it");
  for (const name of Object.keys(files)) assert.doesNotMatch(read(name), INTERNAL, name);
  assert.equal(read("tmpx-other-2026-11-20-cedar-lane.pending"), markerBefore, "a delivered marker is left as it is");

  const kept = JSON.parse(read(`${KEPT.runId}.failed.pending`));
  assert.equal(kept.text, `The search for VELLOQUIN stopped before it finished, and nothing was delivered. ${ADMIN}`);
  for (const k of ["ts", "runId", "agent", "forwarderEmail", "msgId", "whatsappTo", "failureId"]) assert.equal(kept[k], KEPT[k], `${k} is kept`);
  assert.equal(readFileSync(driverDir(RUNS[KEPT.runId], "failure.json"), "utf8"), recordBefore, "a record already held is not touched");
  const record = JSON.parse(readFileSync(driverDir(RUNS[ONLY_HERE.runId], "failure.json"), "utf8"));
  assert.equal(record.reasonVerbatim, RECORDED, "the only full record was kept in its run's folder before the outbox copy lost a word");

  const intake = JSON.parse(read("intake-q-0001.failed.pending"));
  assert.deepEqual(intake.errors, []);
  assert.equal(intake.text, `The search for VELLOQUIN was not started, and nothing was delivered. ${ADMIN}`);
  assert.equal(intake.account, "alpha", "whose notice it is stays");
  const dup = JSON.parse(read("intake-q-0002.duplicate.pending"));
  assert.equal(dup.text, "This order was flagged as a duplicate. Order reference: q-0002");
  assert.deepEqual([dup.priorMsgId, dup.priorJobId, dup.priorRecordedAt], [null, null, null], "whether this requester may see the earlier order was never recorded");
  const pre = JSON.parse(read("intake-q-0003.prerun-failed.pending"));
  assert.equal(pre.text, `The search for VELLOQUIN was not started, and nothing was delivered. ${ADMIN}`);
  assert.ok(!("whatsappToReason" in pre) && !("reason" in pre));

  const bytes = Object.fromEntries(Object.keys(files).map((n) => [n, read(n)]));
  assert.deepEqual(plainOlderOutboxPackets({ outboxDir: OUTBOX, recordDirFor: (id) => RUNS[id] ?? null }), [], "a second pass rewrites nothing");
  for (const n of Object.keys(files)) assert.equal(read(n), bytes[n], `${n} unchanged by a second pass`);
  for (const n of Object.keys(files)) { const p = JSON.parse(read(n)); assert.deepEqual(userOutboxPacket(p), n.startsWith("tmpx") ? withoutTs(p) : p, `a door hands ${n} on as it is`); }
  assert.ok(existsSync(join(OUTBOX, `${KEPT.runId}.failed.pending`)));
});
