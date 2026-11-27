// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLAUDE TURN STOPPED BEFORE ITS RESULT KEEPS ITS SESSION'S ID, so the warm resume of a turn stopped while working
// resumes that session. The adapter read the id only from the result event, which a turn stopped at its time limit never
// sends; the resume was then handed the stage's own key, and the program refused it in a second ("requires a valid session
// ID"), spending the retry (measured in testing, 2026-11-26). The id the program states when the session opens is kept.
// Through the real adapter to the stand-in program, which states its session at the start and is stopped before its end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { anthropicAgentEngine } = await import("../engine/anthropic-agent.mjs");

async function turn(opts, env) {
  const all = { CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"), ...env };
  const saved = {};
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; pinEnv(process.env, k, all[k]); }
  try { return await anthropicAgentEngine.runTurn(opts); }
  finally { for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
}

test("a turn stopped at its wall while streaming keeps the id its session opened with, not the stage's key", async () => {
  const t = await turn({ message: "go", model: "opus", thinking: "high", timeoutSec: 60, resumeRef: "clearance-invented-stage-key" },
    { MOCK_CLAUDE_SESSION: "5f0c8a52-invented-session", MOCK_CLAUDE_TOKEN_STREAM: "40", MOCK_CLAUDE_TOKEN_COUNT: "100000", CLEAROTRON_HARD_MS: "1200" });
  assert.equal(t.killed, true, "premise: the turn was stopped before its result");
  assert.equal(t.json?.runId ?? null, null, "premise: no result event arrived");
  assert.equal(t.sessionRef, "5f0c8a52-invented-session", "the resume would be handed something the program cannot resume");
});

test("a turn stalled after its session opened keeps that id too", async () => {
  const t = await turn({ message: "go", model: "opus", thinking: "high", timeoutSec: 60 },
    { MOCK_CLAUDE_SESSION: "77aa1b20-invented-session", MOCK_CLAUDE_STALL: "1", CLEAROTRON_STALL_MS: "300" });
  assert.equal(t.killed, true);
  assert.equal(t.sessionRef, "77aa1b20-invented-session");
});

test("a turn that ends with its result still takes the result's id", async () => {
  const t = await turn({ message: "go", model: "haiku", thinking: "low", timeoutSec: 60 }, { MOCK_CLAUDE_SESSION: "c1d2e3f4-invented-session", MOCK_CLAUDE_FILE: "x\n" });
  assert.equal(t.code, 0);
  assert.equal(t.sessionRef, "c1d2e3f4-invented-session");
});
