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
// No test here spawns a real `claude` or `codex`, and none can: the two that spawn set an absolute
// CLEAROTRON_CLAUDE_PATH, and everything else injects. The probe also RESOLVES the program, to name the copy
// that runs in its advice; that reads the filesystem and spawns nothing, and the one test about it puts the
// copy it resolves in a temporary folder and empties PATH around it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyProbe, probeEngineTurn, preflightEngineTurn, probeFailureText, probeVerdictLane,
  PROBE_MODEL, PROBE_THINKING, PROBE_PROMPT } from "../engine/probe.mjs";
import { CLOUD_SETTINGS, CLOUD_CREDENTIAL_CHECK } from "../engine/auth.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK_CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(MOCK_CLAUDE, 0o755);

/** A tuple in the shape engine/CONTRACT.md §1 pins, so a classification is asserted against the real form. */
const tupleOf = (over = {}) => ({ code: 1, killed: false, wall: 0.4, stdout: "", stderr: "", laneWaitMs: 0,
  json: {}, usage: null, sessionRef: null, signals: {}, ...over });

const explode = () => { throw new Error("loadAdapter must not be reached — this suite never spawns a real engine"); };

/** The word the probe handed its tool, read off the tool config it passed, as the tool server reads it. */
const wordOf = (a) => JSON.parse(a.mcpConfig).mcpServers.probe.env.CLEAROTRON_PROBE_SENTINEL;
/** What a working engine does with the probe's tool: calls it, and answers with the word it returned. */
const answering = (over = {}) => async (a) => tupleOf({ code: 0, stdout: `${wordOf(a)}`, ...over });

// ── the seam that keeps the suite (and CI) from spending ─────────────────────────────────────────────

test("an injected runTurn means the real adapter is never even loaded", async () => {
  let calls = 0;
  const v = await probeEngineTurn({
    env: { CLEAROTRON_AI: "anthropic-agent" },
    loadAdapter: explode,
    runTurn: async (a) => { calls++; return answering()(a); },
  });
  assert.equal(calls, 1, "the injected turn ran");
  assert.equal(v.ok, true);
  assert.equal(v.mode, "ok");
});

test("the probe asks for the CHEAPEST turn either adapter can build", async () => {
  let seen = null;
  await probeEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
    runTurn: async (a) => { seen = a; return answering()(a); } });
  // haiku + low are the floor rungs of BOTH tier tables (CONTRACT §3), and nothing heavier is passed: one
  // tool on one server, and no skillsDir, no runDir — the smallest argv that still proves a stage's tools.
  assert.equal(seen.model, PROBE_MODEL);
  assert.equal(seen.model, "haiku");
  assert.equal(seen.thinking, PROBE_THINKING);
  assert.equal(seen.thinking, "low");
  assert.equal(seen.message, PROBE_PROMPT);
  assert.ok(seen.timeoutSec > 0 && seen.timeoutSec <= 120, "bounded, because a person is waiting at a wizard");
  assert.ok(seen.stallSec > 0 && seen.stallSec < seen.timeoutSec, "and the stall clock trips well before the wall");
  for (const k of ["skillsDir", "runDir", "resumeRef"]) {
    assert.equal(seen[k], undefined, `${k} would make the probe heavier than the thing it protects`);
  }
  // THE ONE TOOL, and nothing beside it: the probe's own server, granted by the name a stage would use.
  assert.equal(seen.allowedTools, "mcp__probe__ping");
  const servers = JSON.parse(seen.mcpConfig).mcpServers;
  assert.deepEqual(Object.keys(servers), ["probe"], "the probe hands the engine one server, its own");
  assert.match(servers.probe.args[0], /engine\/mcp\/probe-server\.mjs$/);
  assert.match(wordOf(seen), /^probe-[0-9a-f]{8}$/, "the word is minted fresh, so the model cannot supply it");
});

// ── the tool: three outcomes, never two ──────────────────────────────────────────────────────────────

test("a host that refuses every tool call is refused at the door, and the setting that fixes it is named", async () => {
  // The production shape: codex reported success, every tool call was refused before reaching its
  // server, and the turn carried no word because no call got through.
  const refused = { mcpToolCalls: 0, mcpToolCallsRefused: 1,
    mcpToolCallRefusals: [{ server: "probe", tool: "ping", message: "MCP tool call requires approval, but approval policy is never" }] };
  const v = await probeEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: async () => tupleOf({ code: 0, stdout: "I could not call the tool.", ...refused }) });
  assert.equal(v.ok, false);
  assert.equal(v.mode, "tools-refused");
  assert.equal(probeVerdictLane(v), "configuration", "a host that refuses every tool call is this box's to fix, so the door refuses");
  assert.match(v.fix, /CLEAROTRON_CODEX_SANDBOX_BYPASS=1/, "the refusal does not name the setting that fixes it");
  assert.match(v.detail, /requires approval/, "codex's own reason rides the verdict");
  await assert.rejects(() => preflightEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: async () => tupleOf({ code: 0, ...refused }) }), /refused every tool call/);
});

test("a turn that returns the tool's word passes; one that shows nothing either way warns", async () => {
  const ok = await probeEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: answering({ mcpToolCalls: 1, mcpToolCallsRefused: 0 }) });
  assert.equal(ok.ok, true, JSON.stringify(ok));

  // THE ABSENCE IS NOT A PASS. A completed turn with no word and no refusal shows nothing about the tools:
  // the model answered without calling it, or an engine that keeps no tool gauge could not say.
  const none = await probeEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
    runTurn: async () => tupleOf({ code: 0, stdout: "ok" }) });
  assert.equal(none.ok, false, "a turn that never showed the tool's word passed the probe");
  assert.equal(none.mode, "tools-unproven");
  assert.equal(probeVerdictLane(none), "weather", "and it is not this box's fault to refuse a run on");

  // A word guessed out of the prompt is not the word: the probe mints it where the model cannot see it.
  const guessed = await probeEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
    runTurn: async () => tupleOf({ code: 0, stdout: "probe-00000000" }) });
  assert.equal(guessed.ok, false);

  // One refused call beside a completed one is not a refusing host.
  const mixed = await probeEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: answering({ mcpToolCalls: 1, mcpToolCallsRefused: 1 }) });
  assert.equal(mixed.ok, true);
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

// THE REMEDY FITS THE BOX IT IS READ ON. "Run the CLI once in a terminal" is the one thing a server with no
// browser cannot do, and it was the only remedy the text-match path offered — to an install that had set
// up the route built for servers. Each engine's headless route comes off the engine table, in the form
// that table declares: a TOKEN route names the command and the variable, a DEVICE route names the command
// and no variable, because there is none to set.
test("signed out: a headless box is told its own route, in the form the engine declares", () => {
  const claude = classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ stderr: "Invalid API key · Please run /login" }) });
  assert.equal(claude.mode, "signed-out");
  assert.match(claude.fix, /run `claude` once/, "the interactive route is still offered first");
  assert.match(claude.fix, /claude setup-token/, "the token route's command is named");
  assert.match(claude.fix, /CLAUDE_CODE_OAUTH_TOKEN/, "and the variable the token is carried by");

  const codex = classifyProbe({ engine: "openai-agent", tuple: tupleOf({ stderr: "Invalid API key · Please run /login" }) });
  assert.equal(codex.mode, "signed-out");
  assert.match(codex.fix, /codex login --device-auth/, "a device route is named, to be run on this box");
  assert.doesNotMatch(codex.fix, /set the token it prints/, "and no token variable is invented for an engine that declares none");
});

// ── THE ADVICE FOLLOWS HOW THE TURN IS PAID FOR ─────────────────────────────────────────────────────────
//
// A cloud that refuses the credentials, and a vendor that refuses a key, answer 401 or 403 like a
// signed-out program, and the only advice was the subscription's: run the program once and sign in. The
// mode stays `signed-out`, so the run door refuses exactly as before; the words name who refused and what
// to check, by name and never by value.

const REFUSED = tupleOf({ stderr: "API Error: 401 Unauthorized" });
const SUBSCRIPTION_ADVICE = /run `claude` once|claude setup-token|is not signed in|Sign in:/;

test("a cloud that refuses the credentials is named, with what to check, and never the subscription's sign-in", () => {
  const clouds = Object.keys(CLOUD_CREDENTIAL_CHECK);
  assert.deepEqual(clouds.sort(), ["bedrock", "foundry", "gateway", "vertex"]);
  for (const cloud of clouds) {
    const v = classifyProbe({ engine: "anthropic-agent", tuple: REFUSED, auth: { mode: "cloud", cloud } });
    assert.equal(v.mode, "signed-out", `${cloud}: the mode moved, and the run door refuses on the mode`);
    assert.equal(probeVerdictLane(v), "configuration", `${cloud}: the run door no longer refuses it`);
    const text = probeFailureText(v);
    assert.doesNotMatch(text, SUBSCRIPTION_ADVICE, `${cloud}: "${text}" is the subscription's advice`);
    // Every setting it tells the reader to check is one doctor and setup's proof turn carry.
    const named = text.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g) ?? [];
    assert.ok(named.length > 0, `${cloud}: names no setting to check`);
    for (const n of named) assert.ok(CLOUD_SETTINGS.includes(n), `${cloud}: names ${n}, which the checks do not carry`);
  }
  const say = (cloud) => probeFailureText(classifyProbe({ engine: "anthropic-agent", tuple: REFUSED, auth: { mode: "cloud", cloud } }));
  assert.equal(say("foundry"), "Microsoft Azure refused the credentials — check ANTHROPIC_FOUNDRY_API_KEY, or the Azure sign-in "
    + "on this machine, and ANTHROPIC_FOUNDRY_RESOURCE, then run this again.");
  assert.match(say("vertex"), /^Google Cloud refused the credentials — check ANTHROPIC_VERTEX_PROJECT_ID, CLOUD_ML_REGION, and the Google sign-in on this machine \(gcloud's, or the key GOOGLE_APPLICATION_CREDENTIALS names\)/);
  assert.match(say("bedrock"), /^Amazon Bedrock refused the credentials — check AWS_REGION and the AWS credentials on this machine/);
  assert.match(say("gateway"), /^The gateway refused the credentials — check ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN/);

  // The startup-class shape, inferred from silence, points at the same check on a cloud.
  const mute = classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ signals: { noStreamEvents: true } }), auth: { mode: "cloud", cloud: "foundry" } });
  assert.equal(mute.mode, "signed-out");
  assert.equal(mute.basis, "startup-class");
  assert.match(mute.fix, /start there: check ANTHROPIC_FOUNDRY_API_KEY/);
  assert.doesNotMatch(mute.fix, SUBSCRIPTION_ADVICE);
});

test("under an API key the advice is about the key, for either engine", () => {
  const claude = classifyProbe({ engine: "anthropic-agent", tuple: REFUSED, auth: { mode: "api-key" } });
  assert.equal(claude.mode, "signed-out");
  assert.equal(probeFailureText(claude), "Anthropic refused the API key — check ANTHROPIC_API_KEY, then run this again.");
  const codex = classifyProbe({ engine: "openai-agent", tuple: REFUSED, auth: { mode: "api-key" } });
  assert.equal(probeFailureText(codex), "OpenAI refused the API key — check CODEX_API_KEY, then run this again.");
});

test("CONTROL: on a subscription the sign-in advice is what it always was", () => {
  const today = classifyProbe({ engine: "anthropic-agent", tuple: REFUSED });
  const sub = classifyProbe({ engine: "anthropic-agent", tuple: REFUSED, auth: { mode: "subscription" } });
  assert.equal(sub.fix, today.fix);
  assert.equal(sub.headline, "anthropic-agent is not signed in");
  assert.match(sub.fix, /^Sign in: run `claude` once in a terminal and complete the sign-in — or, on a machine you cannot complete a sign-in on, run `claude setup-token`/);
});

test("the sign-in advice names the route by the machine a sign-in cannot be completed on, as the install page does", () => {
  const install = readFileSync(join(HERE, "..", "..", "INSTALL.md"), "utf8");
  assert.match(install, /\| A machine you cannot complete a sign-in on \|/, "the install page's sign-in table no longer names that column so");
  for (const engine of Object.keys(ENGINE_BINARIES)) {
    const { fix } = classifyProbe({ engine, tuple: REFUSED, auth: { mode: "subscription" } });
    assert.match(fix, / — or, on a machine you cannot complete a sign-in on, run `/, `${engine}: ${fix}`);
    assert.doesNotMatch(fix, /\bbox\b/, `${engine}: ${fix}`);
  }
});

test("the probe advises by the billing mode it resolved, and names a setting it checks, never its value", async () => {
  const key = "foundry-key-test-not-real";
  const v = await probeEngineTurn({ loadAdapter: explode, runTurn: async () => REFUSED,
    env: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_AI_BILLING: "cloud", CLAUDE_CODE_USE_FOUNDRY: "1",
      ANTHROPIC_FOUNDRY_RESOURCE: "resource-test", ANTHROPIC_FOUNDRY_API_KEY: key } });
  assert.match(probeFailureText(v), /^Microsoft Azure refused the credentials — check ANTHROPIC_FOUNDRY_API_KEY/);
  assert.ok(!JSON.stringify(v).includes(key), "the verdict carries the key's value");
  // CONTROL: the same refusal under the default billing mode is the subscription's.
  const sub = await probeEngineTurn({ loadAdapter: explode, runTurn: async () => REFUSED, env: { CLEAROTRON_AI: "anthropic-agent" } });
  assert.match(probeFailureText(sub), /is not signed in — Sign in: run `claude` once/);
});

// ── THE ADVICE NAMES THE COPY THAT RUNS ──────────────────────────────────────────────────────────────
//
// The copy setup installs is not on PATH, so "run `claude` once" is a command the reader's shell cannot
// find on exactly the machines setup set up. Any other copy is reachable as named, and the text stays.

test("the sign-in advice names the copy Clearotron installed, and only that copy", () => {
  const installed = { source: "installed", path: "/opt/engines/node_modules/@anthropic-ai/claude-code/bin/claude.exe" };
  const v = classifyProbe({ engine: "anthropic-agent", tuple: REFUSED, program: installed });
  assert.match(v.fix, new RegExp(`^Sign in: run \`${installed.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\` once in a terminal`));
  assert.doesNotMatch(v.fix, /run `claude` once/, "the bare word survived for a copy that is not on PATH");
  // The token route runs on any machine, so it keeps the bare word and names this machine's copy beside it.
  assert.ok(v.fix.includes(`run \`claude setup-token\` on any machine you can sign in on (on this one, \`${installed.path} setup-token\`)`), v.fix);
  const mute = classifyProbe({ engine: "anthropic-agent", tuple: tupleOf({ signals: { noStreamEvents: true } }), program: installed });
  assert.ok(mute.fix.includes(`run \`${installed.path}\` once`), mute.fix);
  // Codex's device route runs here, so it names the copy that runs here.
  const codex = classifyProbe({ engine: "openai-agent", tuple: REFUSED, program: { source: "installed", path: "/opt/engines/codex" } });
  assert.ok(codex.fix.includes("run `/opt/engines/codex login --device-auth` here"), codex.fix);
  // CONTROL: a copy on PATH, or named by its setting, is reachable as named.
  const today = classifyProbe({ engine: "anthropic-agent", tuple: REFUSED }).fix;
  for (const source of ["path", "explicit"])
    assert.equal(classifyProbe({ engine: "anthropic-agent", tuple: REFUSED, program: { source, path: "/usr/local/bin/claude" } }).fix, today, source);
});

test("the probe finds the copy that runs the way the adapter does, and names the installed one", async () => {
  const engines = mkdtempSync(join(tmpdir(), "probe-installed-"));
  const spec = ENGINE_BINARIES["anthropic-agent"];
  const dir = join(engines, "node_modules", ...spec.package.split("/"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: spec.package, version: "9.9.9", bin: { claude: "bin/claude.exe" } }));
  const program = join(dir, "bin", "claude.exe");
  writeFileSync(program, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const saved = { PATH: process.env.PATH, CLEAROTRON_ENGINES_DIR: process.env.CLEAROTRON_ENGINES_DIR };
  // An empty PATH, so no copy of the machine's own can be the one resolved.
  process.env.PATH = mkdtempSync(join(tmpdir(), "probe-empty-path-"));
  process.env.CLEAROTRON_ENGINES_DIR = engines;
  try {
    const v = await probeEngineTurn({ loadAdapter: explode, runTurn: async () => REFUSED, env: { CLEAROTRON_AI: "anthropic-agent" } });
    assert.ok(v.fix.includes(`run \`${program}\` once`), v.fix);
    // CONTROL: with nothing installed the resolver finds nothing, and the advice names the bare word.
    process.env.CLEAROTRON_ENGINES_DIR = mkdtempSync(join(tmpdir(), "probe-no-installed-"));
    const bare = await probeEngineTurn({ loadAdapter: explode, runTurn: async () => REFUSED, env: { CLEAROTRON_AI: "anthropic-agent" } });
    assert.match(bare.fix, /run `claude` once/);
  } finally {
    for (const [k, val] of Object.entries(saved)) if (val === undefined) delete process.env[k]; else process.env[k] = val;
  }
});

// The Codex adapter's refusal of a subscription with no sign-in, in the shape it throws before it starts
// anything. The test below holds the adapter's own source to that shape.
const CODEX_SIGNED_OUT = "CLEAROTRON_AI_BILLING=subscription but no auth.json at /srv/example/.codex/auth.json — run `codex login` "
  + "(or set CLEAROTRON_OPENAI_AUTH_FILE — NOT an aliased name, and deliberately left as it is), or use CLEAROTRON_AI_BILLING=api-key + CODEX_API_KEY.";

test("a signed-out Codex refusal the adapter throws names the copy setup installed", async () => {
  const src = readFileSync(new URL("../engine/openai-agent.mjs", import.meta.url), "utf8");
  assert.match(src, /no auth\.json at \$\{af\} — run \\`codex login\\`/, "the adapter no longer throws the refusal this test stands in for");
  const thrown = new Error(CODEX_SIGNED_OUT);
  const installed = { source: "installed", path: "/opt/engines/node_modules/@openai/codex/bin/codex.js" };
  const v = classifyProbe({ engine: "openai-agent", error: thrown, program: installed });
  assert.equal(v.mode, "signed-out");
  assert.ok(v.fix.includes(`run \`${installed.path} login\``), v.fix);
  assert.doesNotMatch(v.fix, /run `codex login`/, "the bare word survived for a copy that is not on PATH");
  // Through the probe, as doctor and the run door reach it: the throw comes from inside the turn.
  const probed = await probeEngineTurn({ loadAdapter: explode, runTurn: async () => { throw thrown; },
    env: { CLEAROTRON_AI: "openai-agent" }, program: installed });
  assert.equal(probed.mode, "signed-out");
  assert.ok(probed.fix.includes(`run \`${installed.path} login\``), probed.fix);
  // CONTROL: any other copy, or none resolved, gets the text exactly as thrown.
  assert.equal(classifyProbe({ engine: "openai-agent", error: thrown, program: { source: "path", path: "/usr/local/bin/codex" } }).fix, CODEX_SIGNED_OUT);
  assert.equal(classifyProbe({ engine: "openai-agent", error: thrown }).fix, CODEX_SIGNED_OUT);
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
    runTurn: answering() });
  assert.equal(okv.ok, true);
});

// ── weather or configuration: what a RUN DOOR is allowed to refuse on ─────────────────────────

test("the door refuses a fault this box owns, and lets the weather through", () => {
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

test("the default is OPEN — a mode this partition has never heard of is weather", () => {
  // The asymmetry that sets the default: refusing wrongly kills a run that would have worked; proceeding
  // wrongly costs the stages before a failure the engine was going to produce anyway.
  assert.equal(probeVerdictLane({ ok: false, mode: "something-invented-next-quarter", basis: "config" }), "weather");
  assert.equal(probeVerdictLane({ ok: false, mode: "signed-out", basis: "a-basis-nobody-has-written-yet" }), "weather");
  assert.equal(probeVerdictLane({ ok: true, mode: "ok", basis: "completed-turn" }), "ok");
});

test("preflightEngineTurn WARNS instead of throwing on the weather lane, and the warning says what it let past", async () => {
  const v = await preflightEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode,
    runTurn: async () => tupleOf({ signals: { rateLimited: true, resetsAt: "2026-08-12T17:00:00.000Z" } }) });
  assert.equal(v.ok, false, "it does NOT pretend the engine worked");
  assert.match(v.warning, /PROCEEDING ANYWAY/);
  assert.match(v.warning, /no-quota\/provider-signal/, "the mode AND the basis, so a reader can judge the call for themselves");
  assert.match(v.warning, /2026-08-12T17:00:00.000Z/, "carrying the actionable part of the verdict it let past");
});

test("a broken probe is a driver bug, never a client-facing refusal", async () => {
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
    // ONE MCP SERVER, the probe's own, handed over the way a stage hands over its tools.
    const cfg = JSON.parse(call.argv[call.argv.indexOf("--mcp-config") + 1]);
    assert.deepEqual(Object.keys(cfg.mcpServers), ["probe"], "the probe starts its own tool server and no other");
    assert.equal(call.argv[call.argv.indexOf("--allowedTools") + 1], "mcp__probe__ping");
    assert.ok(!call.argv.includes("--add-dir"), "and no run directory is granted — there is none");
  } finally {
    if (saved === undefined) delete process.env.MOCK_CLAUDE_CALL_LOG; else process.env.MOCK_CLAUDE_CALL_LOG = saved;
  }
});

test("through the real codex adapter: a host that refuses every tool call fails the probe, one that does not passes", async () => {
  // The acceptance, on the engine path a run takes: the probe's server goes into the rendered config.toml,
  // the mock streams what codex streams, and the adapter's own gauge is what the probe reads.
  const env = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"),
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-test" };
  const saved = process.env.MOCK_CODEX_MCP_REFUSED;
  try {
    process.env.MOCK_CODEX_MCP_REFUSED = "1";
    const refused = await probeEngineTurn({ env });
    assert.equal(refused.mode, "tools-refused", JSON.stringify(refused));
    assert.equal(probeVerdictLane(refused), "configuration");
    delete process.env.MOCK_CODEX_MCP_REFUSED;
    const works = await probeEngineTurn({ env });
    assert.equal(works.ok, true, `a codex whose tool call completed failed the probe: ${JSON.stringify(works)}`);
  } finally {
    if (saved === undefined) delete process.env.MOCK_CODEX_MCP_REFUSED; else process.env.MOCK_CODEX_MCP_REFUSED = saved;
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
