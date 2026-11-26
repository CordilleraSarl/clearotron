// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN URGENT RUN ASKS FOR THE FASTER SETTING ON ITS JUDGMENT-TIER TURNS ONLY, on both engines, and every attempt row says
// what was asked for beside what the program reported serving (engine/speed.mjs). The dispatches go through the real
// gateway and each engine's real adapter to the stand-in programs, and the test reads the argv each program was handed.
// Every name and message here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "urgent-speed-locks-"));
const { runStage } = await import("../gateway.mjs");
const { isJudgmentTier, urgentAvailability, urgentDecision, turnSpeed } = await import("../engine/speed.mjs");
const { recordRunChoices, readRunChoices, urgentForRun } = await import("../engine/run-choices.mjs");
const { buildClaudeArgs, speedOfClaudeTurn } = await import("../engine/anthropic-agent.mjs");
const { buildCodexArgs, CODEX_FAST_OVERRIDES, speedOfCodexTurn } = await import("../engine/openai-agent.mjs");
const { speedRollup } = await import("../run-speed.mjs");

const ENGINES = {
  "anthropic-agent": (dir) => ({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs"),
    MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count"), MOCK_OUT_FILE: join(dir, "out.md") }),
  "openai-agent": (dir) => ({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-invented", MOCK_CODEX_FILE: "a stub\n", MOCK_CODEX_CALL_LOG: join(dir, "calls.jsonl") }),
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

test("the judgment tier is the declared opus or fable, and a catalog id of either family; no other tier is", () => {
  for (const m of ["opus", "fable", "claude-opus-5-5", "anthropic/claude-opus-5-5", "claude-fable-5-2"]) assert.equal(isJudgmentTier(m), true, m);
  for (const m of ["sonnet", "haiku", "claude-sonnet-5", "claude-haiku-4-5-20251001", "gpt-6.1-sol", "", null, undefined]) assert.equal(isJudgmentTier(m), false, String(m));
});

test("fast only on a judgment turn of a run recorded fast", () => {
  assert.equal(turnSpeed({ urgent: FAST, model: "opus" }), "fast");
  assert.equal(turnSpeed({ urgent: FAST, model: "sonnet" }), "standard");
  assert.equal(turnSpeed({ urgent: FAST, model: "haiku" }), "standard");
  assert.equal(turnSpeed({ urgent: null, model: "opus" }), "standard");
  assert.equal(turnSpeed({ urgent: { ordered: true, fast: false, reason: "not-on-this-cloud" }, model: "opus" }), "standard");
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

test("Codex: fast is two overrides among the global flags, so a resumed turn keeps them; standard passes neither", () => {
  const fast = buildCodexArgs({ model: "opus", thinking: "high", speed: "fast", resumeRef: "thread-invented" }).args;
  const at = fast.indexOf(CODEX_FAST_OVERRIDES[1]);
  assert.ok(at > 0 && at < fast.indexOf("resume"), "the speed rides after `resume`, where codex does not read it");
  assert.ok(fast.includes("features.fast_mode=true"));
  const std = buildCodexArgs({ model: "opus", thinking: "high" }).args;
  assert.ok(!std.some((a) => /service_tier|fast_mode/.test(a)), "a standard turn asked for a tier");
});

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: an Urgent run's judgment stage asks for fast and its row records the request`, async () => {
    const dir = await dispatch(engine, { urgent: FAST, model: "opus" });
    try {
      const argv = argvs(dir)[0];
      if (engine === "anthropic-agent") assert.equal(settingsOf(argv).fastMode, true);
      else assert.ok(argv.includes('service_tier="fast"'), "codex was not asked for the faster tier");
      const row = attempts(dir)[0];
      assert.equal(row?.speed?.requested, "fast");
      assert.equal(row?.tier, "opus");
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

  test(`${engine}: a sweep stage of an Urgent run, and a judgment stage of a standard run, ask for nothing`, async () => {
    for (const [urgent, model] of [[FAST, "sonnet"], [null, "opus"]]) {
      const dir = await dispatch(engine, { urgent, model });
      try {
        const argv = argvs(dir)[0];
        if (engine === "anthropic-agent") assert.equal(settingsOf(argv).fastMode, undefined, `${model}: asked for fast`);
        else assert.ok(!argv.some((a) => /service_tier/.test(a)), `${model}: asked for fast`);
        assert.equal(attempts(dir)[0]?.speed?.requested, "standard");
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
}

test("anthropic-agent: a retry keeps the stage's speed", async () => {
  const dir = await dispatch("anthropic-agent", { urgent: FAST, model: "opus", maxRetries: 1, env: { MOCK_WARM_MODE: "soft_fail" } });
  try {
    const calls = argvs(dir);
    assert.equal(calls.length, 2, "the stage did not retry");
    for (const argv of calls) assert.equal(settingsOf(argv).fastMode, true, "a retry dropped the speed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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
  assert.deepEqual(speedOfCodexTurn("fast"), { requested: "fast", served: null, basis: "unknown", calls: null, state: null, disabledReason: null, notice: null });
});

test("the run's rollup counts its judgment-tier calls served fast out of how many", () => {
  const rows = [
    { event: "attempt", tier: "opus", speed: { requested: "fast", calls: { fast: 3, standard: 1, unknown: 0 } } },
    { event: "attempt", tier: "sonnet", speed: { requested: "standard", calls: { fast: 0, standard: 5, unknown: 0 } } },
    { event: "attempt", tier: "opus", speed: { requested: "fast", calls: null } },
  ];
  assert.deepEqual(speedRollup(rows, FAST), { ordered: true, fast: true, reason: null,
    judgment: { turns: 2, turnsAskedFast: 2, callsFast: 3, callsStandard: 1, callsUnknown: 0, turnsServedUnknown: 1 } });
  assert.equal(speedRollup([], null).ordered, false);
});
