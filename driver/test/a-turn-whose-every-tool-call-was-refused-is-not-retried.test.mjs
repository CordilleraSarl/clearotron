// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A TURN WHOSE EVERY TOOL CALL WAS REFUSED IS NOT RETRIED.
//
// On some hosts codex's own sandbox refuses every tool server a stage is given. The turn still reports
// success, the stage fails for want of what its tools would have produced, and the retry ladder bought
// the same refusal again: three paid attempts per stage on a production run, across every register and
// common-law stage, before the identical-failure break stopped each one. The next attempt spawns the
// same sandbox, so it cannot differ. The ladder now stops on the first.
//
// Driven through the real codex adapter against the offline mock, which streams refused calls in the
// shape codex 0.150.1 emits, so the gauge the gateway reads is the adapter's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runStage, everyToolCallRefused } from "../gateway.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const MOCK = join(dirname(fileURLToPath(import.meta.url)), "mock-codex.mjs");

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

/** One stage with three attempts allowed, whose turn writes nothing, refusing `refused` tool calls. */
async function stage(refused) {
  const dir = mkdtempSync(join(tmpdir(), "tools-refused-"));
  try {
    const out = join(dir, "ctx.md");
    return await withEnv({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "api-key",
      CODEX_API_KEY: "sk-test", CLEAROTRON_RETRY_BACKOFF_MS: "0", MOCK_CODEX_NOFILE: "1", MOCK_CODEX_MCP_REFUSED: String(refused) },
    () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: `refused-${refused}-${process.pid}`,
      runDir: dir, expectFile: out, maxRetries: 2 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("a stage whose every tool call was refused stops at the first attempt", async () => {
  const r = await stage(3);
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 1, `a turn refused every tool call and the ladder retried it (${r.attempts} attempts)`);
});

test("THE CONTROL: the same failure with no refusal is retried as before", async () => {
  // Without it the first arm would pass on a ladder that stops every missing file at once.
  const r = await stage(0);
  assert.equal(r.ok, false);
  assert.ok(r.attempts >= 2, `a plain missing file was not retried (${r.attempts} attempt)`);
});

test("only a turn where every call was refused and none completed counts", () => {
  assert.equal(everyToolCallRefused({ mcpToolCalls: 0, mcpToolCallsRefused: 3 }), true);
  assert.equal(everyToolCallRefused({ mcpToolCalls: 5, mcpToolCallsRefused: 1 }), false,
    "one refused call beside completed ones is a model asking for a tool it may not have, not a host that refuses tools");
  assert.equal(everyToolCallRefused({ mcpToolCalls: 0, mcpToolCallsRefused: 0 }), false, "a turn that called nothing refused nothing");
  // An engine that does not keep the gauge reports nothing, and nothing is not a refusal.
  assert.equal(everyToolCallRefused({ mcpToolCalls: null, mcpToolCallsRefused: null }), false);
  assert.equal(everyToolCallRefused({}), false);
});
