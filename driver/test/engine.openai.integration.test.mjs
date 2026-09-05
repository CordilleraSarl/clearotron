// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// openai-agent INTEGRATION: the engine registered in the gateway, selectable via CLEAROTRON_AI, driving a
// real runStage through the shared retry/file-truth ladder — plus the billing-mode (auth) matrix. $0 (the
// mock codex binary). This is the "mechanical swap" proof at the runStage level; the whole-pipeline
// parametric proof lives in pipeline.openai.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   // #1336
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runStage, selectEngine } from "../gateway.mjs";
import { resolveAuthMode } from "../engine/auth.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // Refs tracker issue 1838 — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = join(HERE, "mock-codex.mjs");

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

test("selectEngine resolves openai-agent when CLEAROTRON_AI=openai-agent; unknown still fails loud", async () => {
  await withEnv({ CLEAROTRON_AI: "openai-agent" }, () => {
    assert.equal(selectEngine().name, "openai-agent");   // #696 — process-wide, no stage argument
  });
  await withEnv({ CLEAROTRON_AI: "nonsense-engine" }, () => {
    assert.throws(() => selectEngine(), /not a registered engine adapter/);
  });
});

test("runStage on CLEAROTRON_AI=openai-agent writes the file + returns ok via the real retry ladder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oai-rs-"));
  try {
    const out = join(dir, "matter-context.md");
    const res = await withEnv(
      { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-dummy", MOCK_CODEX_FILE: "# ctx\n", CLEAROTRON_RETRY_BACKOFF_MS: "0" },
      () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", thinking: "high", sessionKey: "s1", runDir: dir, expectFile: out }));
    assert.equal(res.ok, true);
    assert.equal(res.attempts, 1);
    assert.ok(existsSync(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runStage on openai-agent: a missing output file drives the missing_file ladder (retries, then fails)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oai-mf-"));
  try {
    const out = join(dir, "matter-context.md");
    const res = await withEnv(
      { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-dummy", MOCK_CODEX_NOFILE: "1", CLEAROTRON_RETRY_BACKOFF_MS: "0" },
      () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: "s2", runDir: dir, expectFile: out, maxRetries: 1 }));
    assert.equal(res.ok, false);
    assert.match(res.fail, /missing_file/);
    assert.equal(res.attempts, 2);   // maxRetries:1 → 2 attempts
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runStage on openai-agent: a rate-limit turn returns fail=rate_limited (postpone path), no wasteful retries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oai-rl-"));
  try {
    const out = join(dir, "o.md");
    const res = await withEnv(
      { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-dummy", MOCK_CODEX_RATELIMIT: "1", CLEAROTRON_RETRY_BACKOFF_MS: "0" },
      () => runStage("matter-frame", { message: `OUTPUT_FILE: ${out}`, model: "sonnet", sessionKey: "s3", runDir: dir, expectFile: out }));
    assert.equal(res.ok, false);
    assert.equal(res.fail, "rate_limited");
    assert.equal(res.attempts, 1);   // rate_limited returns immediately (no retry against the same cap)
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── billing-mode (auth) matrix — the provable toggle, both providers ─────────────────────────────────
test("auth matrix: all four combinations resolve; the two api-key-without-key cases FAIL LOUD", () => {
  // anthropic
  assert.deepEqual(resolveAuthMode({ engineName: "anthropic-agent", env: {} }), { provider: "anthropic", mode: "subscription", apiBilled: false });
  assert.deepEqual(resolveAuthMode({ engineName: "anthropic-agent", env: { CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk" } }), { provider: "anthropic", mode: "api-key", apiBilled: true });
  assert.throws(() => resolveAuthMode({ engineName: "anthropic-agent", env: { CLEAROTRON_AI_BILLING: "api-key" } }), /ANTHROPIC_API_KEY is not set/);
  // openai
  assert.deepEqual(resolveAuthMode({ engineName: "openai-agent", env: {} }), { provider: "openai", mode: "subscription", apiBilled: false });
  assert.deepEqual(resolveAuthMode({ engineName: "openai-agent", env: { CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk" } }), { provider: "openai", mode: "api-key", apiBilled: true });
  assert.throws(() => resolveAuthMode({ engineName: "openai-agent", env: { CLEAROTRON_AI_BILLING: "api-key" } }), /CODEX_API_KEY is not set/);
  // a future/unknown engine → no policy, never throws
  assert.equal(resolveAuthMode({ engineName: "future-agent", env: {} }).mode, "unknown");
});

test("runStage fails LOUD when the billing mode claims api-key but no key is set (both providers)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oai-auth-"));
  try {
    await assert.rejects(
      withEnv({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "" },
        () => runStage("matter-frame", { message: "x", model: "opus", sessionKey: "s4", runDir: dir, expectFile: join(dir, "o.md") })),
      /CODEX_API_KEY is not set/);
    await assert.rejects(
      withEnv({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "" },
        () => runStage("matter-frame", { message: "x", model: "opus", sessionKey: "s5", runDir: dir, expectFile: join(dir, "o.md") })),
      /ANTHROPIC_API_KEY is not set/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("telemetry stamp: the stage row records engine + authMode (provable billing)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oai-stamp-"));
  try {
    const out = join(dir, "matter-context.md");
    await withEnv(
      { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-dummy", MOCK_CODEX_FILE: "# c\n", CLEAROTRON_RETRY_BACKOFF_MS: "0" },
      () => runStage("matter-frame", { message: `OUTPUT_FILE: ${out}`, model: "opus", sessionKey: "s6", runDir: dir, expectFile: out }));
    const log = readFileSync(driverDir(dir, "matter-frame.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const row = log[log.length - 1];
    assert.equal(row.engine, "openai-agent");
    assert.equal(row.authMode, "api-key");
    assert.equal(row.apiBilled, true);
    assert.equal(row.modelUsed, "gpt-5.6-sol");   // honest provenance: the GPT id, not an anthropic id
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
