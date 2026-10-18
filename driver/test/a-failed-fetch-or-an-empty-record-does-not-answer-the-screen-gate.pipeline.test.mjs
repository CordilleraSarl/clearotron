// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the mock pipeline through the screen gate's recovery fetch, three ways.
//
// A FAILED FETCH, OR A BODY THAT CARRIES NO RECORD, DOES NOT ANSWER THE SCREEN GATE. The gate sends a goods drop it
// cannot ground to its own recovery fetch, and discloses the drop and clamps the verdict when that fetch does not
// bring the record (ruled). It read a failed record fetch in the call ledger as a fetched record, and any object body
// as the record, so a recovery that brought nothing closed the drop and the report shipped it as examined. Now the
// recovery that files the record resolves the drop, and the two that do not are disclosed as they always should
// have been, through the existing presentation. The empty record arrives as a register sends it: a call row that
// reads ok, and the empty record its normaliser writes. The mocked drop is the fixture's own record id.
//
// Own file = own process + own workspace root (the repo convention for mock-pipeline scenarios). SAFETY GUARD: the
// workspace root and the call ledger are pinned BEFORE any driver module loads, so driver modules load dynamically.
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync, appendFileSync } from "node:fs";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
const LEDGER = join(mkdtempSync(join(tmpdir(), "clearotron-sgr-ledger-")), "corsearch-calls.jsonl");
process.env.CLEAROTRON_REGISTER_CALL_LOG = LEDGER;
writeFileSync(LEDGER, "");
// The register's normaliser loads after the pins above, as the driver modules do: its ledger fixes its paths on load.
const { normalizeRecord: signaRecord } = await import("../../providers/signa/src/core.js");

import { test } from "node:test";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
const ON_CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" };
process.env.CLEAROTRON_AI ||= "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job-sgr", msgId: "<sgr@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8302", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const DROP = "/mark/cn/88001-42";

async function runMockPipeline(env, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-sgr-"));
  writeFileSync(LEDGER, "");   // each arm reads only the calls it made: the runs share one job, so one run prefix
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_FAIL_STAGE", "MOCK_SCREEN_DROP", "MOCK_FRAME_DIFF",
    "CLEAROTRON_SCREEN_GATE_UNNAMED"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, opts);
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

// The gate's recovery fetch, as the register's own plumbing would leave it: a body filed where the driver says.
const fileBody = (recordLog, sessionKey, uri, body) => {
  mkdirSync(dirname(recordLog), { recursive: true });
  appendFileSync(recordLog, JSON.stringify({ ts: "2026-10-18T00:00:00Z", provider: "corsearch", sessionKey, target: uri, body }) + "\n");
};

test("a recovery fetch that files the record resolves the drop: nothing is disclosed and the verdict is not clamped for it", async () => {
  const recordFetcher = async (uri, { sessionKey, recordLog }) => {
    fileBody(recordLog, sessionKey, uri, { statusText: "Registered", classList: ["9"], goodsAndServices: [{ classNumber: 9, description: "joysticks" }] });
    return { ok: true };
  };
  const { res, events } = await runMockPipeline({ MOCK_SCREEN_DROP: "persist" }, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  assert.ok(!events.some((e) => e.event === "screen-gate-unresolved"), "a drop whose record the recovery filed was disclosed");
  assert.equal(res.verdict, "CLEAR", "guard: the control delivers clean, so the two arms below measure the gate alone");
});

test("a recovery fetch the register refused, logged as a failed record fetch, does not answer the gate: the drop is disclosed and the verdict clamped", async () => {
  const recordFetcher = async (uri, { sessionKey }) => {
    appendFileSync(LEDGER, JSON.stringify({ ts: "2026-10-18T00:00:00Z", provider: "corsearch", sessionKey, tool: "record_fetch", target: uri,
      ok: false, http_status: 404, bytes: 0, cache_hit: false }) + "\n");
    return { ok: false, cause: "record 404 (mock — unretrievable)" };
  };
  const { res, events } = await runMockPipeline({ MOCK_SCREEN_DROP: "persist" }, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const unresolved = events.find((e) => e.event === "screen-gate-unresolved");
  assert.deepEqual(unresolved?.uris, [DROP], "the failed fetch in the call ledger closed the drop as if the record had been fetched");
  assert.equal(unresolved.action, "disclose-clamp");
  assert.equal(res.verdict, "CONDITIONAL", "the drop the recovery could not ground shipped as examined");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "screen-gate-unresolved.json"), "utf8"));
  assert.deepEqual(sidecar.unresolved.map((u) => [u.uri, u.cause_source]), [[DROP, "provider"]]);
});

// A register that answers 200 with an empty record: the call row reads ok, as a register's own ledger writes it, and
// the body filed is the empty record the register's normaliser writes, identity and plumbing and nothing else.
const answeredEmpty = (uri, { sessionKey, recordLog }) => {
  appendFileSync(LEDGER, JSON.stringify({ ts: "2026-10-18T00:00:00Z", provider: "corsearch", sessionKey, tool: "record_fetch", target: uri,
    ok: true, http_status: 200, bytes: 412, cache_hit: false }) + "\n");
  fileBody(recordLog, sessionKey, uri, signaRecord({ id: uri.split("/").pop() }, uri.split("/")[2].toUpperCase()));
};

test("a recovery fetch that reports success and files a body carrying no record does not answer the gate either", async () => {
  const recordFetcher = async (uri, ctx) => { answeredEmpty(uri, ctx); return { ok: true }; };
  const { res, events } = await runMockPipeline({ MOCK_SCREEN_DROP: "persist" }, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  const unresolved = events.find((e) => e.event === "screen-gate-unresolved");
  assert.deepEqual(unresolved?.uris, [DROP], "an empty body closed the drop as if it were the record");
  assert.equal(res.verdict, "CONDITIONAL");
  const sidecar = JSON.parse(readFileSync(driverDir(res.runDir, "screen-gate-unresolved.json"), "utf8"));
  assert.deepEqual(sidecar.unresolved.map((u) => [u.uri, u.cause_source]), [[DROP, "driver-fetch-reported-ok"]],
    "the disclosure names the case the existing presentation already has: the fetch reported success and the record is not on file");
});

test("on the Codex engine too: an empty body does not answer the gate", async () => {
  const recordFetcher = async (uri, ctx) => { answeredEmpty(uri, ctx); return { ok: true }; };
  const { res, events } = await runMockPipeline({ MOCK_SCREEN_DROP: "persist", ...ON_CODEX }, { recordFetcher });
  assert.equal(res.ok, true, JSON.stringify({ ok: res.ok, fail: res.fail, stage: res.failedStage }));
  assert.deepEqual(events.find((e) => e.event === "screen-gate-unresolved")?.uris, [DROP]);
  assert.equal(res.verdict, "CONDITIONAL");
  assert.ok(existsSync(driverDir(res.runDir, "screen-gate-unresolved.json")));
});
