// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner through a pre-try{} failure end to end
// B3 — guaranteed failure-notice backstop for pre-try{} throws. A failure thrown BEFORE pipelineInner's
// try{} (corrupt profile sidecar, dropped register credential, resume-refused, …) used to produce a
// silent .failed with no requester notice — a dropped credential would silently fail every queued run at
// once. The runner's finalize now writes the SAME packet + outbox marker the pipeline catch writes (or a
// a QUEUE-level packet when no run dir exists), and NEVER double-notifies a failure the pipeline already
// noticed. All cross-process against the real runner mainline (mock gateway, tmp workspaces).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { todayISO } from "../phase0.mjs";
import { deadClaimToken } from "./claim-fixtures.mjs";   // — pid+starttime, never a bare pid
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

const job = (ref, mark) => ({
  id: `bs-${ref}`, msgId: `<bs-${ref}@x>`, forwarder: "requester", forwarderDomain: "example.com",
  ref, markName: mark, classes: [9], provider: "corsearch",
});
const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");
const queueFor = (root) => join(studioFor(root), "queue");
function envFor(root, extra = {}) {
  return {
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
    ...extra,
  };
}
const runToExit = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  return new Promise((r) => c.on("exit", (code) => r({ code, log: c.log })));
};
const outboxFiles = (root) => { try { return readdirSync(join(root, "outbox")); } catch { return []; } };

test("pre-try throw with a run dir (corrupt _driver/profile.json) → failure packet + outbox marker exactly once", async () => {
  const root = mkdtempSync(join(tmpdir(), "backstop-profile-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  const J = job("TMP9301", "CORRUPT PROFILE");
  const slug = "tmp9301-corrupt-profile";
  const date = todayISO();
  // a crashed run whose DRIVER-written profile sidecar is corrupt: the resume re-dispatch throws in
  // attachProfile — before pipelineInner's try{} — the exact silent-.failed class the backstop closes
  const runDir = join(studioFor(root), slug, `${date}-copper-anvil`);
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "profile.json"), "{corrupt");
  writeFileSync(join(Q, "job-p.processing"), JSON.stringify(J));
  writeFileSync(join(Q, "job-p.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-p.processing.meta"), JSON.stringify({ codename: "copper-anvil", dateISO: date, agentId: "clawdi" }));

  const { code, log } = await runToExit(envFor(root));
  assert.equal(code, 0, log);
  assert.ok(existsSync(join(Q, "job-p.failed")), `run marked .failed\n${log}`);
  const packetPath = driverDir(runDir, "failure.json");
  assert.ok(existsSync(packetPath), `backstop wrote the failure packet\n${log}`);
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  assert.equal(packet.failedStage, "pre-run");
  // charter P1 §3 — ONE canonical runId form: the backstop packet (and the marker it names) carries the
  // dated `<slug>-<date>-<codename>`, matching status.runId and the outbox rescan (was dateless pre-fix).
  assert.equal(packet.runId, `${slug}-${date}-copper-anvil`);
  assert.match(packet.reasonVerbatim, /profile\.json is corrupt/);
  assert.deepEqual(outboxFiles(root), [`${slug}-${date}-copper-anvil.pending`], "exactly one outbox wake marker");

  // idempotence: a second drain of the SAME leftover state must not re-notify. Re-stage the .failed as a
  // dead .processing again (the crash-repeat shape) — the packet-exists guard has to hold.
  const { renameSync } = await import("node:fs");
  renameSync(join(Q, "job-p.failed"), join(Q, "job-p.processing"));
  writeFileSync(join(Q, "job-p.processing.pid"), await deadClaimToken());
  writeFileSync(join(Q, "job-p.processing.meta"), JSON.stringify({ codename: "copper-anvil", dateISO: date, agentId: "clawdi" }));
  const second = await runToExit(envFor(root));
  assert.equal(second.code, 0, second.log);
  assert.deepEqual(outboxFiles(root), [`${slug}-${date}-copper-anvil.pending`], "STILL exactly one marker — no double-notify");
});

test("normal pipeline failure (inside the try{}) is NOT double-noticed by the backstop", async () => {
  const root = mkdtempSync(join(tmpdir(), "backstop-normal-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-n.json"), JSON.stringify(job("TMP9302", "STAGE FAIL")));

  // the pipeline's own catch writes the packet + marker — the only shape there is since. The backstop must see failedStage set and stay out of the way.
  // CONVERSION 2 — the knob is a SUBSTRING of the dispatch, and the dispatch no longer names a path: the
  // frame is handed back through `record_matter_frame` and the driver renders the file. Keyed on the tool
  // the converted dispatch orders, which is the thing that is actually in the message now. Left as
  // "matter-context.md" this silently stopped matching and the test measured prelim-variants failing
  // instead — the assertion still passed a stage name, just not the one the test is about.
  const { code, log } = await runToExit(envFor(root, { MOCK_FAIL_STAGE: "record_matter_frame", CLEAROTRON_DELIVERY: "handoff" }));
  assert.equal(code, 0, log);
  assert.ok(existsSync(join(Q, "job-n.failed")), `run marked .failed\n${log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-n.failed.result"), "utf8"));
  assert.equal(res.failedStage, "matter-frame", "the pipeline's own catch owned the failure");
  const pending = outboxFiles(root);
  assert.equal(pending.length, 1, `exactly one outbox marker (pipeline-written, not doubled): ${pending.join(", ")}`);
  const packet = JSON.parse(readFileSync(driverDir(res.runDir, "failure.json"), "utf8"));
  assert.equal(packet.failedStage, "matter-frame", "packet is the pipeline's, not a backstop 'pre-run' overwrite");
});

// — THE NO-RUN-DIR ARM CHANGED LANE, AND THAT IS THE WHOLE POINT OF THE ARM. It used to assert
// the opposite of what it asserts now: zero outbox markers, and a direct gateway ping carrying the
// sentence. That ping was the ONE un-gated spawn left in the product — its three siblings each took the
// outbox in the headless default and this one did not, so on a deployment without that platform
// installed (which is every deployment of this product) the notice was simply LOST. The failure it
// reports is the one nothing else reports: a throw before the run owns a directory.
test("pre-try throw with NO run dir (dropped register credential) → a QUEUE-level outbox packet", async () => {
  const root = mkdtempSync(join(tmpdir(), "backstop-nodir-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-c.json"), JSON.stringify(job("TMP9303", "NO CREDENTIAL")));
  const callLog = join(root, "calls.jsonl");

  // empty credential ⇒ preflightCredentials throws BEFORE the run dir is created
  const { code, log } = await runToExit(envFor(root, { CORSEARCH_SESSION_KEY: "", MOCK_CALL_LOG: callLog }));
  assert.equal(code, 0, log);
  assert.ok(existsSync(join(Q, "job-c.failed")), `run marked .failed\n${log}`);
  // No RUN-level lane, because there is no run dir — the packet is keyed to the QUEUE BASE instead,
  // under the `intake-<base>.` prefix scripts/e2e.mjs matches. A third naming scheme here
  // would be a notice the harness reports as never sent.
  const pending = outboxFiles(root);
  assert.deepEqual(pending, ["intake-job-c.prerun-failed.pending"],
    `exactly one outbox packet, keyed to the queue base rather than to a runId that does not exist\n${log}`);
  const packet = JSON.parse(readFileSync(join(root, "outbox", pending[0]), "utf8"));
  assert.equal(packet.kind, "pre-run-failed", "the kind says which of the queue-level events this is");
  assert.match(packet.reason, /missing CORSEARCH_SESSION_KEY/, "the packet names the machine's own reason");
  assert.match(packet.text, /FAILED before the run could start/, "and carries the human-ready sentence");
  assert.equal(packet.base, "job-c");

  // NOTHING WAS SPAWNED. The old arm's evidence was a call log with a ping in it; this one's is a call
  // log with nothing in it, which is the stronger claim and the one the deletion is about.
  const calls = existsSync(callLog) ? readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean) : [];
  assert.deepEqual(calls, [], `no binary is spawned on the pre-run failure path\n${log}`);
});
