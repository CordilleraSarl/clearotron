// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/probe.mjs — the turn probe: prove the engine can complete a turn, not that a file exists.
//
// ── HOW THIS SUITE STAYS OFFLINE, WHICH IS THE FIRST THING TO CHECK ──────────────────────────────────
//
// The probe spawns a real coding CLI and costs a real turn. A suite that quietly reached the default
// path would start making model calls on every CI run, and nothing would say so. Three mechanisms, all
// of them asserted rather than promised:
//
//   1. `classifyProbe` is PURE over the engine's normalized tuple, so every failure mode below is driven
//      from a literal — no process, no clock, no network.
//   2. `runTurn` is injectable, and when it is injected `loadAdapter` is NEVER referenced. The first test
//      proves that by injecting a `loadAdapter` that throws.
//   3. The one test that exercises the REAL anthropic adapter end to end points CLEAROTRON_CLAUDE_PATH at
//      `driver/test/mock-claude.mjs` — the same offline fixture the rest of the engine suite spawns —
//      and asserts from the mock's call log that the argv came out of `buildClaudeArgs`.
//
// No test here resolves a real `claude` or `codex`, and none can: the two that spawn set an absolute
// CLEAROTRON_CLAUDE_PATH, and everything else injects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyProbe, probeEngineTurn, preflightEngineTurn, probeFailureText, probeVerdictLane,
  PROBE_MODEL, PROBE_THINKING, PROBE_PROMPT } from "../engine/probe.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(MOCK_CLAUDE, 0o755);

/** A tuple in the shape engine/CONTRACT.md §1 pins, so a classification is asserted against the real form. */
const tupleOf = (over = {}) => ({ code: 1, killed: false, wall: 0.4, stdout: "", stderr: "", laneWaitMs: 0,
  json: {}, usage: null, sessionRef: null, signals: {}, ...over });

const explode = () => { throw new Error("loadAdapter must not be reached — this suite never spawns a real engine"); };

// ── the seam that keeps the suite (and CI) from spending ─────────────────────────────────────────────

test("an injected runTurn means the real adapter is never even loaded", async () => {
  let calls = 0;
  const v = await probeEngineTurn({
    env: { CLEAROTRON_AI: "anthropic-agent" },
    loadAdapter: explode,
    runTurn: async () => { calls++; return tupleOf({ code: 0 }); },
  });
  assert.equal(calls, 1, "the injected turn ran");
  assert.equal(v.ok, true);
  assert.equal(v.mode, "ok");
});

test("the probe asks for the CHEAPEST turn either adapter can build", async () => {
  let seen = null;
  await probeEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
    runTurn: async (a) => { seen = a; return tupleOf({ code: 0 }); } });
  // haiku + low are the floor rungs of BOTH tier tables (CONTRACT §3), and nothing heavier is passed:
  // no mcpConfig, no allowedTools, no skillsDir, no runDir — the smallest argv the adapters produce.
  assert.equal(seen.model, PROBE_MODEL);
  assert.equal(seen.model, "haiku");
  assert.equal(seen.thinking, PROBE_THINKING);
  assert.equal(seen.thinking, "low");
  assert.equal(seen.message, PROBE_PROMPT);
  assert.ok(seen.timeoutSec > 0 && seen.timeoutSec <= 120, "bounded, because a person is waiting at a wizard");
  assert.ok(seen.stallSec > 0 && seen.stallSec < seen.timeoutSec, "and the stall clock trips well before the wall");
  for (const k of ["mcpConfig", "allowedTools", "skillsDir", "runDir", "resumeRef"]) {
    assert.equal(seen[k], undefined, `${k} would make the probe heavier than the thing it protects`);
  }
});

// ── the billing-mode door, which is the one the anthropic adapter does not open for itself ───────────

test("a fail-loud billing misconfiguration is caught BEFORE a turn is spent", async () => {
  // anthropic-agent's own spawnEnv reads CLEAROTRON_AI_BILLING and never calls resolveAuthMode — the
  // gateway does, at the top of runStage. So a probe that went straight to runTurn would PASS here and
  // the first real stage would throw. The probe calls the same door, and it never reaches the turn.
  let calls = 0;
  const v = await probeEngineTurn({
    env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "api-key" },
    loadAdapter: explode,
    runTurn: async () => { calls++; return tupleOf({ code: 0 }); },
  });
  assert.equal(calls, 0, "a config error must not cost a turn");
  assert.equal(v.ok, false);
  assert.equal(v.mode, "auth-misconfigured");
  assert.match(v.fix, /ANTHROPIC_API_KEY is not set/, "the thrower's own words, relayed rather than paraphrased");
});

test("the probe does not TOUCH the billing mode — it only reads the one this box declares", async () => {
  const saved = process.env.CLEAROTRON_AI_BILLING;
  delete process.env.CLEAROTRON_AI_BILLING;
  try {
    let seenAuth = "unread";
    await probeEngineTurn({
      env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: MOCK_CLAUDE },
      loadAdapter: explode,
      runTurn: async () => { seenAuth = process.env.CLEAROTRON_AI_BILLING; return tupleOf({ code: 0 }); },
    });
    assert.equal(seenAuth, undefined, "no mode was invented for the turn");
    assert.equal(process.env.CLEAROTRON_AI_BILLING, undefined, "and none was left behind");
  } finally { if (saved !== undefined) process.env.CLEAROTRON_AI_BILLING = saved; }
});

test("only the ENGINE-SELECTION keys are applied to the process, and they are put back", async () => {
  // The adapters read process.env per call, so the wizard's not-yet-written choice has to be applied for
  // the duration. Anything wider would let a probe move a credential or a spend variable to make itself
  // pass — so the applied set is exactly CLEAROTRON_AI plus the binary variables.
  const savedBin = process.env.CLEAROTRON_CLAUDE_PATH;
  const savedPx = process.env.PERPLEXITY_API_KEY;
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", "/before");
  delete process.env.PERPLEXITY_API_KEY;
  try {
    let inside = null;
    await probeEngineTurn({
      env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: "/during", PERPLEXITY_API_KEY: "must-not-travel" },
      loadAdapter: explode,
      runTurn: async () => { inside = { bin: process.env.CLEAROTRON_CLAUDE_PATH, px: process.env.PERPLEXITY_API_KEY }; return tupleOf({ code: 0 }); },
    });
    assert.equal(inside.bin, "/during", "the chosen binary is what the adapter spawns");
    assert.equal(inside.px, undefined, "a credential in the candidate env is NOT pushed into the process");
    assert.equal(process.env.CLEAROTRON_CLAUDE_PATH, "/before", "and the shell is restored afterwards");
  } finally {
    pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", savedBin);
    if (savedPx !== undefined) process.env.PERPLEXITY_API_KEY = savedPx;
  }
});

// ── the failure modes are TOLD APART, because "cannot run" is not actionable ─────────────────────────

test("signed out: named as such, with the sign-in command for THAT engine", () => {
  const claude = classifyProbe({ engine: "anthropic-agent",
    tuple: tupleOf({ stderr: "Invalid API key · Please run /login" }) });
  assert.equal(claude.mode, "signed-out");
  assert.equal(claude.basis, "text-match");
  assert.match(claude.fix, /run `claude` once/);

  // codex throws its auth.json refusal rather than settling a tuple — a distinct class, same verdict.
  const codex = classifyProbe({ engine: "openai-agent",
    error: new Error("CLEAROTRON_AI_BILLING=subscription but no auth.json at /h/.codex/auth.json — run `codex login` (or set CLEAROTRON_OPENAI_AUTH_FILE), or use CLEAROTRON_AI_BILLING=api-key + CODEX_API_KEY.") });
  assert.equal(codex.mode, "signed-out");
  assert.match(codex.fix, /codex login/, "the adapter's own instruction, relayed verbatim");
});

test("no quota: the reset TIME is the message, and where it came from is on the record", () => {
  const anthropic = classifyProbe({ engine: "anthropic-agent",
    tuple: tupleOf({ code: 1, signals: { rateLimited: true, resetsAt: "2026-08-12T17:00:00.000Z" } }) });
  assert.equal(anthropic.mode, "no-quota");
  assert.equal(anthropic.basis, "provider-signal");
  assert.equal(anthropic.resetsAt, "2026-08-12T17:00:00.000Z");
  assert.match(probeFailureText(anthropic), /no quota until 2026-08-12T17:00:00\.000Z/);

  // codex publishes no structured rate-limit metadata; its adapter says so in rateLimitBasis, and a
  // verdict that hid that would report a guess with the confidence of a provider signal.
  const codex = classifyProbe({ engine: "openai-agent",
    tuple: tupleOf({ code: 1, signals: { rateLimited: true, rateLimitBasis: "text-match" } }) });
  assert.equal(codex.mode, "no-quota");
  assert.equal(codex.basis, "text-match");
  assert.equal(codex.resetsAt, null);
  assert.match(codex.fix, /not a provider signal/);
});

test("tier unavailable: it points at the tier doctrine that exists, and re-authors none of it", () => {
  const codex = classifyProbe({ engine: "openai-agent",
    tuple: tupleOf({ stderr: "error: model_not_found: gpt-5.6-sol" }) });
  assert.equal(codex.mode, "tier-unavailable");
  assert.match(codex.fix, /CLEAROTRON_OPENAI_MODEL_/);
  assert.match(codex.fix, /04-configuration-reference\.md/, "#752 documented this; the probe cites it");
  assert.match(codex.fix, /gpt-5\.6-sol/);

  const anthropic = classifyProbe({ engine: "anthropic-agent",
    tuple: tupleOf({ stderr: "your account does not have access to this model" }) });
  assert.equal(anthropic.mode, "tier-unavailable");
  assert.match(anthropic.fix, /Model tiers and resolution/);
});

test("the #752 anchor the tier message sends a reader to actually exists", () => {
  // A message that names a document is only actionable while the document says the thing. This is the
  // acceptance-grep lesson from itself: the criterion passed against words that were never there.
  const doc = readFileSync(join(HERE, "..", "..", "docs", "architecture", "04-configuration-reference.md"), "utf8");
  assert.match(doc, /CLEAROTRON_OPENAI_MODEL_JUDGMENT/);
  assert.match(doc, /Model tiers and resolution/);
});

test("a startup-class death is called the signed-out shape, and says that is what it is", () => {
  // The anthropic adapter's own diagnosis: the CLI exited without emitting a single stream event, so the
  // failure happened before any turn ran (args/auth/MCP). Reported as signed-out because that is the
  // actionable reading, with `basis` saying it was inferred from the shape and not read from a message.
  const v = classifyProbe({ engine: "anthropic-agent",
    tuple: tupleOf({ stderr: "", signals: { noStreamEvents: true } }) });
  assert.equal(v.mode, "signed-out");
  assert.equal(v.basis, "startup-class");
});

test("a stall, a spawn failure and a plain failed turn are three different answers", () => {
  const stalled = classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ code: 137, killed: true, signals: { stalled: true } }) });
  assert.equal(stalled.mode, "timed-out");

  const noSpawn = classifyProbe({ engine: "anthropic-agent",
    tuple: tupleOf({ json: null, stderr: "anthropic-agent spawn error: spawn ENOENT" }) });
  assert.equal(noSpawn.mode, "cannot-spawn");
  assert.match(noSpawn.fix, /CLEAROTRON_CLAUDE_PATH/, "it names the variable to fix, not the other engine's");

  const failed = classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ code: 1, stderr: "the model produced a teapot" }) });
  assert.equal(failed.mode, "failed");
  assert.equal(failed.basis, "nonzero-exit");
  assert.match(failed.detail, /teapot/, "the engine's own words ride along — the generic case is where they matter most");
});

test("every failure verdict is a sentence a reader can act on", () => {
  for (const v of [
    classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ stderr: "Please run /login" }) }),
    classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ signals: { rateLimited: true, resetsAt: "2026-08-12T17:00:00.000Z" } }) }),
    classifyProbe({ engine: "openai-agent", tuple: tupleOf({ stderr: "unknown model" }) }),
    classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ killed: true }) }),
  ]) {
    assert.equal(v.ok, false);
    assert.ok(v.headline && v.fix, `${v.mode} must say what to do`);
    assert.ok(!/cannot run\b/i.test(v.headline), "'cannot run' is the non-answer this ladder exists to replace");
  }
});

test("an unknown CLEAROTRON_AI is NOT this function's refusal to make, here either", async () => {
  // Same discipline as preflightEngineBinary: gateway.selectEngine owns "that is not an engine".
  const v = await probeEngineTurn({ env: { CLEAROTRON_AI: "silent-engine" }, loadAdapter: explode, runTurn: explode });
  assert.equal(v.ok, false);
  assert.equal(v.mode, "unknown-engine");
  assert.match(v.fix, /selectEngine/);
});

// ── the run door: REFUSE, not warn ───────────────────────────────────────────────────────────────────

test("preflightEngineTurn REFUSES a failing engine and returns a passing one", async () => {
  await assert.rejects(
    () => preflightEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
      runTurn: async () => tupleOf({ stderr: "Please run /login" }) }),
    (e) => {
      assert.match(e.message, /^\[preflight\] /, "it wears the same prefix as its refusing siblings");
      assert.match(e.message, /not signed in/);
      assert.match(e.message, /run `claude` once/);
      return true;
    });

  const okv = await preflightEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
    runTurn: async () => tupleOf({ code: 0 }) });
  assert.equal(okv.ok, true);
});

// ── weather or configuration: what a RUN DOOR is allowed to refuse on ─────────────────────────

test("#819 the door refuses a fault this box owns, and lets the weather through", () => {
  const lane = (over) => probeVerdictLane(classifyProbe({ engine: "anthropic-agent", ...over }));

  // CONFIGURATION — an operator set something, or did not, and it will be just as wrong in ninety minutes.
  assert.equal(lane({ tuple: tupleOf({ stderr: "Please run /login" }) }), "configuration", "signed out, said in words");
  assert.equal(lane({ error: new Error("CLEAROTRON_AI_BILLING=api-key but ANTHROPIC_API_KEY is not set") }), "configuration", "a declared billing mode with no key");
  assert.equal(lane({ tuple: tupleOf({ stderr: "unknown model" }) }), "configuration", "a tier this account cannot reach");
  assert.equal(lane({ tuple: tupleOf({ json: null, stderr: "anthropic-agent spawn error: spawn ENOENT" }) }), "configuration", "a binary that will not start");

  // WEATHER — nothing on this box is wrong, and the run handles it better than the door can.
  assert.equal(lane({ tuple: tupleOf({ signals: { rateLimited: true, resetsAt: "2026-08-12T17:00:00.000Z" } }) }), "weather",
    "a spent quota: refusing here would replace a park that carries resetsAt and resumes itself with a terminal failure");
  assert.equal(lane({ tuple: tupleOf({ stderr: 'API Error: 529 {"type":"overloaded_error"}' }) }), "weather",
    "an upstream 529: the recovery ladder's weather lane exists for exactly this");
  assert.equal(lane({ tuple: tupleOf({ killed: true, signals: { stalled: true } }) }), "weather", "a stall is a symptom, not a diagnosis");

  // …and the INFERENCE FROM SILENCE, which is the one that matters. A CLI that dies before emitting a
  // stream event is the signed-out shape AND the wedged-MCP shape AND the PATH-gap shape — onboard-wizard
  // records a hosted runner where a hermetic PATH produced exactly this verdict on a healthy engine. The
  // mode is named for the reader; the door must not refuse a production run on it.
  const mute = classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ signals: { noStreamEvents: true } }) });
  assert.equal(mute.mode, "signed-out", "the reader is still told the likeliest cause");
  assert.equal(mute.basis, "startup-class");
  assert.equal(probeVerdictLane(mute), "weather", "but a refusal is not made on an inference from silence");
});

test("#819 the default is OPEN — a mode this partition has never heard of is weather", () => {
  // The asymmetry that sets the default: refusing wrongly kills a run that would have worked; proceeding
  // wrongly costs the stages before a failure the engine was going to produce anyway.
  assert.equal(probeVerdictLane({ ok: false, mode: "something-invented-next-quarter", basis: "config" }), "weather");
  assert.equal(probeVerdictLane({ ok: false, mode: "signed-out", basis: "a-basis-nobody-has-written-yet" }), "weather");
  assert.equal(probeVerdictLane({ ok: true, mode: "ok", basis: "completed-turn" }), "ok");
});

test("#819 preflightEngineTurn WARNS instead of throwing on the weather lane, and the warning says what it let past", async () => {
  const v = await preflightEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
    runTurn: async () => tupleOf({ signals: { rateLimited: true, resetsAt: "2026-08-12T17:00:00.000Z" } }) });
  assert.equal(v.ok, false, "it does NOT pretend the engine worked");
  assert.match(v.warning, /PROCEEDING ANYWAY/);
  assert.match(v.warning, /no-quota\/provider-signal/, "the mode AND the basis, so a reader can judge the call for themselves");
  assert.match(v.warning, /2026-08-12T17:00:00.000Z/, "carrying the actionable part of the verdict it let past");
});

test("#819 a broken probe is a driver bug, never a client-facing refusal", async () => {
  // `probeEngineTurn` promises a verdict for every CONFIGURATION fault, not for every fault: its adapter
  // load sits outside its own try, so a bad import or a missing runTurn export escapes as a raw throw. At
  // the run door that must not become a terminal refusal — the door owns the catch.
  const v = await preflightEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" },
    loadAdapter: () => { throw new Error("engine/probe: adapter module does not export a runnable"); } });
  assert.equal(v.ok, false);
  assert.equal(v.mode, "probe-error");
  assert.equal(probeVerdictLane(v), "weather");
  assert.match(v.warning, /bug in the probe, not a fault on this box/);
  assert.match(v.warning, /does not export a runnable/, "the thrown text rides along — it is the only diagnosis there is");
});

// ── end to end through the REAL adapter, against the offline mock ────────────────────────────────────

test("the real anthropic adapter is driven by its OWN spawn path — mock-claude, never a live CLI", async () => {
  const dir = mkdtempSync(join(tmpdir(), "probe-e2e-"));
  const log = join(dir, "calls.jsonl");
  const saved = process.env.MOCK_CLAUDE_CALL_LOG;
  process.env.MOCK_CLAUDE_CALL_LOG = log;
  try {
    const v = await probeEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: MOCK_CLAUDE } });
    assert.equal(v.ok, true, JSON.stringify(v));

    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]);
    // buildClaudeArgs' shape, not a hand-rolled one: `-p` as a BARE flag with the prompt on STDIN (the
    // E2BIG lesson), the streaming flags the watchdog needs, and the floor tier.
    assert.deepEqual(call.argv.slice(0, 5), ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
    assert.deepEqual(call.argv.slice(5, 9), ["--model", "haiku", "--effort", "low"]);
    assert.equal(call.prompt, PROBE_PROMPT, "the prompt rode stdin, never argv");
    assert.ok(!call.argv.includes("--mcp-config"), "no MCP servers are started for a probe");
    assert.ok(!call.argv.includes("--add-dir"), "and no run directory is granted — there is none");
  } finally {
    if (saved === undefined) delete process.env.MOCK_CLAUDE_CALL_LOG; else process.env.MOCK_CLAUDE_CALL_LOG = saved;
  }
});

test("a binary that exits silently is diagnosed, not shrugged at", async () => {
  // The startup-class shape for real: a program on PATH that runs, says nothing and exits nonzero. It
  // passes every filesystem check preflightEngineBinary makes, which is exactly why this probe exists.
  const dir = mkdtempSync(join(tmpdir(), "probe-mute-"));
  const mute = join(dir, "claude");
  writeFileSync(mute, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  chmodSync(mute, 0o755);
  const v = await probeEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: mute } });
  assert.equal(v.ok, false);
  assert.equal(v.mode, "signed-out");
  assert.equal(v.basis, "startup-class");
});

// ── one registry, and it has to stay one ─────────────────────────────────────────────────────────────

test("every engine in the registry names an adapter module that exists and answers to its own id", async () => {
  for (const [id, spec] of Object.entries(ENGINE_BINARIES)) {
    const mod = await import(`../${spec.module}`);
    const adapter = mod[spec.adapter];
    assert.ok(adapter, `${spec.module} exports no ${spec.adapter}`);
    assert.equal(adapter.name, id, "the adapter's own name is the registry key — a mismatch selects the wrong engine silently");
    assert.equal(typeof adapter.runTurn, "function");
  }
});
