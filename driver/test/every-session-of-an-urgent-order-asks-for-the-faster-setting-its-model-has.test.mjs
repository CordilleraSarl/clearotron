// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY SESSION OF AN URGENT ORDER ASKS FOR THE FASTER SETTING WHERE ITS MODEL HAS ONE, on both engines: every stage of
// every tier, its retries and warm resumes, and the native-language turns. A session whose model has no faster setting
// runs at its usual speed, on the model it chose, and says why. Every session's record says what was asked for beside
// what the program reported serving, and the run's rollup counts them all (engine/speed.mjs, run-speed.mjs). The
// dispatches go through the real gateway and each engine's real adapter to the stand-in programs, and the test reads the
// argv each program was handed. Every name and message here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "urgent-speed-locks-"));
const { runStage } = await import("../gateway.mjs");
const { fastSupported, sessionSpeed, urgentAvailability, urgentDecision, turnSpeed } = await import("../engine/speed.mjs");
const { recordRunChoices, readRunChoices, urgentForRun } = await import("../engine/run-choices.mjs");
const { buildClaudeArgs, speedOfClaudeTurn, anthropicAgentEngine } = await import("../engine/anthropic-agent.mjs");
const { buildCodexArgs, CODEX_FAST_OVERRIDES, speedOfCodexTurn, openaiAgentEngine } = await import("../engine/openai-agent.mjs");
const { makeJxTurnRunner } = await import("../engine/jx-turn.mjs");
const { speedRollup, stampSpeedRollup } = await import("../run-speed.mjs");

const ENGINES = {
  "anthropic-agent": (dir) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"),
    MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count"), MOCK_OUT_FILE: join(dir, "out.md") }),
  "openai-agent": (dir) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented", MOCK_CODEX_FILE: "a stub\n", MOCK_CODEX_CALL_LOG: join(dir, "calls.jsonl"),
    MOCK_COUNT_FILE: join(dir, "count"), MOCK_OUT_FILE: join(dir, "out.md") }),
};

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

/** Every argv the stand-in program was handed, in order. */
const argvs = (dir) => readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
  .map((c) => (Array.isArray(c) ? c : c.argv ?? c.args ?? []));
const settingsOf = (argv) => JSON.parse(argv[argv.indexOf("--settings") + 1]);
const attempts = (dir) => (existsSync(driverDir(dir, "run.jsonl")) ? readFileSync(driverDir(dir, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [])
  .filter((e) => e.event === "attempt");

/** One stage on a run recorded with `urgent` (or none), on `engine`, at `model`. */
async function dispatch(engine, { urgent, model, env = {}, maxRetries = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), "urgent-speed-"));
  mkdirSync(driverDir(dir), { recursive: true });
  recordRunChoices(dir, { engine, register: null, urgent });
  const out = join(dir, "out.md");
  await withEnv({ ...ENGINES[engine](dir), CLEAROTRON_RETRY_BACKOFF_MS: "0", ...env },
    () => runStage("skeptic", { message: `Write a short note. Write it to this ABSOLUTE path: ${out}`, model, thinking: "high",
      sessionKey: `urgent-speed-${engine}-${model}-${Math.random().toString(36).slice(2)}`, runDir: dir, expectFile: out, maxRetries, timeoutSec: 30 }).catch(() => null));
  return dir;
}

const FAST = urgentDecision({ ordered: true, engine: "anthropic-agent", auth: { mode: "subscription" } });

test("the faster setting follows the model sent, by the vendors' lists, never the tier a stage declares", () => {
  const claude = (m) => fastSupported({ engine: "anthropic-agent", model: m });
  for (const m of ["opus", "fable", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-fable-5-2", "anthropic/claude-opus-5-5", "claude-opus-5-5[1m]"])
    assert.equal(claude(m), true, m);
  for (const m of ["sonnet", "haiku", "claude-opus-4-7", "claude-sonnet-5", "claude-haiku-4-5-20251001", "claude-fable-5-1", "gpt-6-luna", "", null, undefined])
    assert.equal(claude(m), false, String(m));
  const codex = (m) => fastSupported({ engine: "openai-agent", model: m });
  for (const m of ["gpt-6.2-astra", "gpt-6.2-sol", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) assert.equal(codex(m), true, m);
  for (const m of ["gpt-5.6-sol", "gpt-5.6-luna", "opus", "", undefined]) assert.equal(codex(m), false, String(m));
});

test("a run recorded fast asks every session for fast; the session sends it only where its model has it, and says why not", () => {
  assert.equal(turnSpeed({ urgent: FAST }), "fast");
  assert.equal(turnSpeed({ urgent: null }), "standard");
  assert.equal(turnSpeed({ urgent: { ordered: true, fast: false, reason: "not-on-this-cloud" } }), "standard");
  assert.deepEqual(sessionSpeed({ ordered: "fast", engine: "openai-agent", model: "gpt-6-luna" }), { sent: "fast", standardBecause: null });
  assert.deepEqual(sessionSpeed({ ordered: "fast", engine: "anthropic-agent", model: "haiku" }), { sent: "standard", standardBecause: "model-not-fast" });
  assert.deepEqual(sessionSpeed({ ordered: "standard", engine: "anthropic-agent", model: "opus" }), { sent: "standard", standardBecause: null });
});

test("one answer to whether this installation can run Urgent, by engine and billing", () => {
  assert.deepEqual(urgentAvailability({ engine: "anthropic-agent", auth: { mode: "api-key" } }), { available: true, reason: null });
  assert.deepEqual(urgentAvailability({ engine: "anthropic-agent", auth: { mode: "subscription" } }), { available: true, reason: null });
  assert.deepEqual(urgentAvailability({ engine: "anthropic-agent", auth: { mode: "cloud", cloud: "bedrock" } }), { available: false, reason: "not-on-this-cloud" });
  assert.deepEqual(urgentAvailability({ engine: "anthropic-agent", auth: { mode: "cloud", cloud: "foundry" } }), { available: false, reason: "not-on-this-cloud" });
  assert.deepEqual(urgentAvailability({ engine: "anthropic-agent", auth: { mode: "cloud", cloud: "vertex" } }), { available: false, reason: "fable-only-on-this-cloud" });
  assert.deepEqual(urgentAvailability({ engine: "openai-agent", auth: { mode: "subscription" } }), { available: true, reason: null });
  assert.deepEqual(urgentDecision({ ordered: false, engine: "anthropic-agent", auth: { mode: "api-key" } }), { ordered: false, fast: false, reason: null });
  assert.deepEqual(urgentDecision({ ordered: true, engine: "anthropic-agent", auth: { mode: "cloud", cloud: "bedrock" } }), { ordered: true, fast: false, reason: "not-on-this-cloud" });
});

test("the run records its Urgent decision once, and a record in another shape runs at standard speed", () => {
  const dir = mkdtempSync(join(tmpdir(), "urgent-record-"));
  try {
    recordRunChoices(dir, { engine: "anthropic-agent", register: null, urgent: FAST });
    assert.deepEqual(urgentForRun(dir), FAST);
    const again = recordRunChoices(dir, { engine: "anthropic-agent", register: null, urgent: null });
    assert.equal(again.written, false, "a second start rewrote the record");
    assert.deepEqual(urgentForRun(dir), FAST, "a second start changed the run's speed");
    const plain = mkdtempSync(join(tmpdir(), "urgent-record-plain-"));
    recordRunChoices(plain, { engine: "anthropic-agent", register: null, urgent: { ordered: "yes", fast: 1 } });
    assert.equal(urgentForRun(plain), null);
    assert.deepEqual(readRunChoices(plain), { state: "recorded", engine: "anthropic-agent", register: null }, "a run with no decision gained a field");
    rmSync(plain, { recursive: true, force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Claude: fast rides the one --settings value, beside the read fence and the write boundary", () => {
  const runDir = mkdtempSync(join(tmpdir(), "urgent-args-"));
  try {
    const fast = settingsOf(buildClaudeArgs({ message: "m", model: "opus", thinking: "high", speed: "fast", runDir }).args);
    assert.equal(fast.fastMode, true);
    assert.equal(fast.permissions?.blockReadsOutsideWorkingDirectories, true, "the read fence was lost");
    assert.ok(fast.hooks?.PreToolUse?.length, "the write boundary was lost");
    const std = buildClaudeArgs({ message: "m", model: "opus", thinking: "high", runDir }).args;
    assert.equal(settingsOf(std).fastMode, undefined);
    assert.equal(std.filter((a) => a === "--settings").length, 1, "a turn carries more than one --settings");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("Claude: a model with no faster setting is sent as itself with fast mode off, and the reason rides back", () => {
  for (const model of ["haiku", "sonnet", "claude-opus-4-7"]) {
    const built = buildClaudeArgs({ message: "m", model, thinking: "low", speed: "fast" });
    assert.equal(settingsOf(built.args).fastMode, undefined, `${model}: asked for fast, which would move the session off its model`);
    assert.equal(built.args[built.args.indexOf("--model") + 1], model, `${model}: the model changed`);
    assert.deepEqual(built.speed, { sent: "standard", standardBecause: "model-not-fast" });
  }
  // Not the tier: a stage pinned to a model that has the setting gets it, whatever tier it declares.
  assert.equal(settingsOf(buildClaudeArgs({ message: "m", model: "claude-fable-5-2", thinking: "low", speed: "fast" }).args).fastMode, true);
});

test("Codex: fast is two overrides among the global flags, so a resumed turn keeps them; standard passes neither", () => {
  const fast = buildCodexArgs({ model: "opus", thinking: "high", speed: "fast", resumeRef: "thread-invented" }).args;
  const at = fast.indexOf(CODEX_FAST_OVERRIDES[1]);
  assert.ok(at > 0 && at < fast.indexOf("resume"), "the speed rides after `resume`, where codex does not read it");
  assert.ok(fast.includes("features.fast_mode=true"));
  const std = buildCodexArgs({ model: "opus", thinking: "high" }).args;
  assert.ok(!std.some((a) => /service_tier|fast_mode/.test(a)), "a standard turn asked for a tier");
  // Every tier's default model has the setting, the cheap one included; a pinned model without it is sent as itself.
  for (const tier of ["sonnet", "haiku"]) assert.ok(buildCodexArgs({ model: tier, thinking: "low", speed: "fast" }).args.includes('service_tier="fast"'), tier);
  const pinned = buildCodexArgs({ model: "gpt-5.6-sol", thinking: "low", speed: "fast" });
  assert.ok(!pinned.args.some((a) => /service_tier|fast_mode/.test(a)), "a model without the setting was asked for it");
  assert.equal(pinned.args[pinned.args.indexOf("-m") + 1], "gpt-5.6-sol");
  assert.deepEqual(pinned.speed, { sent: "standard", standardBecause: "model-not-fast" });
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: an Urgent order's judgment stage asks for fast and its row records the request`, async () => {
    const dir = await dispatch(engine, { urgent: FAST, model: "opus" });
    try {
      const argv = argvs(dir)[0];
      if (engine === "anthropic-agent") assert.equal(settingsOf(argv).fastMode, true);
      else assert.ok(argv.includes('service_tier="fast"'), "codex was not asked for the faster tier");
      const row = attempts(dir)[0];
      assert.equal(row?.speed?.requested, "fast");
      assert.equal(row?.speed?.standardBecause, null);
      if (engine === "anthropic-agent") {
        assert.equal(row.speed.served, "fast", "the served speed is not the program's own word");
        assert.equal(row.speed.state, "on");
        assert.equal(row.speed.basis, "reported");
      } else {
        assert.equal(row.speed.served, null, "codex reports no served tier, and the row claimed one");
        assert.equal(row.speed.basis, "unknown");
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${engine}: an Urgent order's sweep stage asks for fast where its model has it, and otherwise says why not`, async () => {
    const dir = await dispatch(engine, { urgent: FAST, model: "sonnet" });
    try {
      const argv = argvs(dir)[0];
      const row = attempts(dir)[0];
      if (engine === "openai-agent") {
        assert.ok(argv.includes('service_tier="fast"'), "the sweep tier's model has the setting and was not asked for it");
        assert.deepEqual([row?.speed?.requested, row?.speed?.standardBecause], ["fast", null]);
      } else {
        assert.equal(settingsOf(argv).fastMode, undefined, "a model with no faster setting was asked for it");
        assert.deepEqual([row?.speed?.requested, row?.speed?.standardBecause], ["standard", "model-not-fast"]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${engine}: a Standard order asks for nothing, on any tier, and has nothing to explain`, async () => {
    for (const model of ["opus", "sonnet", "haiku"]) {
      const dir = await dispatch(engine, { urgent: null, model });
      try {
        const argv = argvs(dir)[0];
        if (engine === "anthropic-agent") assert.equal(settingsOf(argv).fastMode, undefined, `${model}: asked for fast`);
        else assert.ok(!argv.some((a) => /service_tier/.test(a)), `${model}: asked for fast`);
        assert.deepEqual([attempts(dir)[0]?.speed?.requested, attempts(dir)[0]?.speed?.standardBecause], ["standard", null]);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });

  test(`${engine}: a retry and its warm resume keep the stage's speed`, async () => {
    const model = engine === "openai-agent" ? "haiku" : "opus";   // on Codex, the cheap tier: not only the judgment stages
    const dir = await dispatch(engine, { urgent: FAST, model, maxRetries: 1, env: { MOCK_WARM_MODE: "stubborn" } });
    try {
      const calls = argvs(dir);
      assert.equal(calls.length, 2, "the stage did not retry");
      for (const argv of calls) {
        if (engine === "anthropic-agent") assert.equal(settingsOf(argv).fastMode, true, "a retry dropped the speed");
        else assert.ok(argv.includes('service_tier="fast"'), "a retry dropped the speed");
      }
      if (engine === "openai-agent") assert.ok(calls[1].includes("resume"), "premise: the retry resumed the session");
      else assert.ok(calls[1].includes("--resume"), "premise: the retry resumed the session");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`${engine}: a native-language turn of an Urgent order asks as the stages do; a turn serving no order asks for nothing`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "urgent-jx-"));
    mkdirSync(driverDir(dir), { recursive: true });
    recordRunChoices(dir, { engine, register: null, urgent: FAST });
    const adapter = engine === "anthropic-agent" ? anthropicAgentEngine : openaiAgentEngine;
    try {
      await withEnv({ ...ENGINES[engine](dir), MOCK_CLAUDE_RESULT: '{"candidates":[]}', MOCK_CODEX_RESULT: '{"candidates":[]}' }, async () => {
        const runner = await makeJxTurnRunner({ runDir: dir, engine: adapter });
        assert.equal(runner.error, undefined, runner.error);
        const r = await runner.turn({ prompt: "Return an empty candidate list." });
        // The lanes run on the cheap tier: Haiku on Claude, which has no faster setting; Luna on Codex, which has.
        if (engine === "openai-agent") {
          assert.ok(argvs(dir).at(-1).includes('service_tier="fast"'), "the lane's turn was not asked for the faster tier");
          assert.deepEqual([r.speed?.requested, r.speed?.standardBecause], ["fast", null]);
        } else {
          assert.equal(settingsOf(argvs(dir).at(-1)).fastMode, undefined, "Haiku was asked for fast");
          assert.deepEqual([r.speed?.requested, r.speed?.standardBecause], ["standard", "model-not-fast"]);
        }
        const portal = await makeJxTurnRunner({ engine: adapter, env: { ...process.env, CLEAROTRON_AI: engine } });
        const p = await portal.turn({ prompt: "Return an empty candidate list." });
        assert.deepEqual([p.speed?.requested, p.speed?.standardBecause], ["standard", null], "a turn serving no order asked for fast");
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("a fast request the program served at standard speed is recorded as served, never as asked", async () => {
  const dir = await dispatch("anthropic-agent", { urgent: FAST, model: "opus", env: { MOCK_CLAUDE_SPEED_SERVED: "standard" } });
  try {
    const row = attempts(dir)[0];
    assert.equal(row.ok, true, "a fallback to standard speed failed the stage");
    assert.equal(row.speed.requested, "fast");
    assert.equal(row.speed.served, "standard");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the turn's record reads the program's own fields, per call, and says unknown where it said nothing", () => {
  const calls = new Map([["m1", "fast"], ["m2", "standard"]]);
  const r = speedOfClaudeTurn({ requested: "fast", result: { fast_mode_state: "cooldown", fast_mode_disabled_reason: null }, calls });
  assert.equal(r.served, "mixed");
  assert.deepEqual(r.calls, { fast: 1, standard: 1, unknown: 0 });
  assert.equal(r.state, "cooldown");
  const silent = speedOfClaudeTurn({ requested: "fast" });
  assert.equal(silent.served, null);
  assert.equal(silent.basis, "unknown");
  assert.deepEqual(speedOfCodexTurn("fast"), { requested: "fast", standardBecause: null, served: null, basis: "unknown", calls: null, state: null, disabledReason: null, notice: null });
  assert.equal(speedOfClaudeTurn({ requested: "standard", standardBecause: "model-not-fast" }).standardBecause, "model-not-fast");
});

test("the run's rollup counts every session: asked fast, confirmed, unknown, fallen back, unsupported and standard", () => {
  const u = (total) => ({ total });
  const rows = [
    { event: "attempt", usage: u(100), speed: { requested: "fast", served: "fast", calls: { fast: 3, standard: 0, unknown: 0 } } },
    { event: "attempt", usage: u(50), speed: { requested: "fast", served: null, basis: "unknown", calls: null } },
    { event: "attempt", usage: u(40), speed: { requested: "fast", served: "mixed", calls: { fast: 1, standard: 1, unknown: 0 } } },
    { event: "attempt", usage: u(30), speed: { requested: "fast", served: "fast", notice: "Fast mode ran out of usage credits" } },
    { lane: "zh", usage: u(20), speed: { requested: "standard", standardBecause: "model-not-fast" } },
    { event: "attempt", usage: u(10), speed: { requested: "standard", standardBecause: null } },
  ];
  assert.deepEqual(speedRollup(rows, FAST), { ordered: true, fast: true, reason: null, sessions: {
    total: 6, fastRequested: 4, fastConfirmed: 1, servedUnknown: 1, fallback: 2, unsupported: 1, standard: 1,
    unsupportedBecause: { "model-not-fast": 1 }, tokens: { fastRequested: 220, standard: 30 } } });
  assert.equal(speedRollup([], null).ordered, false);
});

test("the rollup written at a terminal reads the native-language turns beside the stages, and skips a lane that ran no model", () => {
  const dir = mkdtempSync(join(tmpdir(), "urgent-rollup-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    recordRunChoices(dir, { engine: "openai-agent", register: null, urgent: FAST });
    writeFileSync(driverDir(dir, "run.jsonl"), JSON.stringify({ event: "attempt", usage: { total: 7 }, speed: { requested: "fast", served: null } }) + "\n");
    writeFileSync(driverDir(dir, "jx-completions.jsonl"), [
      { lane: "zh", engine: "openai", authMode: "subscription", usage: { total: 3 }, speed: { requested: "fast", served: null } },
      { lane: "ja", engine: "not-provider-billed", authMode: "not-provider-billed" },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const r = stampSpeedRollup(dir, "delivered");
    assert.deepEqual([r.sessions.total, r.sessions.fastRequested, r.sessions.servedUnknown, r.sessions.tokens.fastRequested], [2, 2, 2, 10]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
