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
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyProbe, probeEngineTurn, preflightEngineTurn, probeFailureText, probeVerdictLane,
  PROBE_MODEL, PROBE_THINKING, PROBE_TOOLS, PROBE_FILE, probePrompt, isProbePrompt, probeToolConfig,
  ENGINES_WITH_A_SHELL, PROBE_COMMAND_FILE } from "../engine/probe.mjs";
import { parseCodexEvent } from "../engine/openai-agent.mjs";
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

/** The words the probe handed its tools, read off the tool config it passed, as the tool server reads them. */
const wordsOf = (a) => JSON.parse(a.mcpConfig).mcpServers.probe.args.slice(1);
const wordOf = (a) => wordsOf(a)[0];
/**
 * What a working engine does with the probe's turn: calls each tool, writes their words to the file the
 * instruction names, in the run folder it was handed, and answers with the words.
 */
/** The word the probe's command prints, read off the file its prompt names, or null when it asks for none. */
const commandWordOf = (a) => {
  const f = /Run the shell command cat "(.+?)"\./.exec(a.message)?.[1];
  try { return f ? readFileSync(f, "utf8").trim() : null; } catch { return null; }
};
const answering = (over = {}, { write = true, command = true } = {}) => async (a) => {
  if (write) writeFileSync(join(a.runDir, PROBE_FILE), wordsOf(a).join("\n") + "\n");
  const said = [...wordsOf(a), ...(command && commandWordOf(a) ? [commandWordOf(a)] : [])];
  return tupleOf({ code: 0, stdout: said.join(" "), ...over });
};

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
  // haiku + low are the floor rungs of BOTH tier tables (CONTRACT §3), and nothing heavier is passed: three
  // tools on one server, one file in a run folder of the probe's own, and no skillsDir — the smallest turn
  // that still proves a stage's tools and a stage's write.
  assert.equal(seen.model, PROBE_MODEL);
  assert.equal(seen.model, "haiku");
  assert.equal(seen.thinking, PROBE_THINKING);
  assert.equal(seen.thinking, "low");
  assert.ok(seen.runDir && seen.runDir.startsWith(tmpdir()), `the probe's run folder is its own, in the temp folder: ${seen.runDir}`);
  assert.equal(seen.message, probePrompt(join(seen.runDir, PROBE_FILE)));
  assert.ok(isProbePrompt(seen.message));
  assert.equal(existsSync(seen.runDir), false, "the probe's run folder outlived its turn");
  assert.ok(seen.timeoutSec > 0 && seen.timeoutSec <= 120, "bounded, because a person is waiting at a wizard");
  assert.ok(seen.stallSec > 0 && seen.stallSec < seen.timeoutSec, "and the stall clock trips well before the wall");
  for (const k of ["skillsDir", "resumeRef"]) {
    assert.equal(seen[k], undefined, `${k} would make the probe heavier than the thing it protects`);
  }
  // A WRITING STAGE'S GRANT, and nothing beside it: the file tools, and the probe's own tools by the name a
  // stage would use.
  assert.equal(seen.allowedTools, "Read Write Edit mcp__probe__ping mcp__probe__note mcp__probe__look");
  const servers = JSON.parse(seen.mcpConfig).mcpServers;
  assert.deepEqual(Object.keys(servers), ["probe"], "the probe hands the engine one server, its own");
  assert.match(servers.probe.args[0], /engine\/mcp\/probe-server\.mjs$/);
  const words = wordsOf(seen);
  assert.equal(words.length, PROBE_TOOLS.length, "one word per tool");
  for (const w of words) assert.match(w, /^probe-[0-9a-f]{8}$/, "each word is minted fresh, so the model cannot supply it");
  assert.equal(new Set(words).size, words.length, "and no two are the same, so one call cannot answer for another");
});

test("the real probe server, started as the config starts it, returns exactly the word it was given", async () => {
  // The mocks read the word off the config, so nothing else here runs the server itself. This does: the
  // command and arguments the engines receive, then one ping.
  const ping = (server) => new Promise((resolve, reject) => {
    const p = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...server.env } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("probe-server.mjs did not answer ping")); }, 20000);
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: server.tool, arguments: {} } });
  });
  const words = ["probe-0badc0de", "probe-0badc0df", "probe-0badc0e0"];
  const server = JSON.parse(probeToolConfig(words).mcpConfig).mcpServers.probe;
  for (const [i, tool] of PROBE_TOOLS.entries()) {
    const r = await ping({ ...server, tool });
    assert.notEqual(r?.isError, true, `the server refused its own ${tool}`);
    assert.equal((r?.content ?? []).map((c) => c.text).join(""), words[i], `${tool} returned another tool's word`);
  }
  // Started with no word, each refuses rather than returning something a guess could match.
  for (const tool of PROBE_TOOLS) {
    const bare = await ping({ ...server, args: server.args.slice(0, 1), tool });
    assert.equal(bare?.isError, true, `a server with no word answered ${tool}`);
  }
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
    assert.ok(isProbePrompt(call.prompt), "the prompt rode stdin, never argv");
    assert.ok(!call.argv.some((a) => isProbePrompt(a)), "and never as an argument");
    // ONE MCP SERVER, the probe's own, handed over the way a stage hands over its tools.
    const cfg = JSON.parse(call.argv[call.argv.indexOf("--mcp-config") + 1]);
    assert.deepEqual(Object.keys(cfg.mcpServers), ["probe"], "the probe starts its own tool server and no other");
    assert.equal(call.argv[call.argv.indexOf("--allowedTools") + 1], "Read Write Edit mcp__probe__ping mcp__probe__note mcp__probe__look");
    // ITS OWN RUN FOLDER, granted as a stage's is, and gone once the turn is.
    const granted = call.argv[call.argv.indexOf("--add-dir") + 1];
    assert.ok(granted && /clearotron-probe-/.test(granted), `the probe's run folder was not granted: ${call.argv.join(" ")}`);
    assert.ok(call.prompt.includes(join(granted, PROBE_FILE)), "the file the probe asks for sits in the folder it granted");
    assert.equal(existsSync(granted), false, "the probe's run folder outlived its turn");
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

/** One probe through a real adapter with the mock's controls set for that turn alone. */
async function probeWith(env, controls) {
  const saved = Object.fromEntries(Object.keys(controls).map((k) => [k, process.env[k]]));
  Object.assign(process.env, controls);
  try { return await probeEngineTurn({ env }); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const CODEX = { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-test" };
const CLAUDE = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: MOCK_CLAUDE };

test("through the real codex adapter: one kind of tool refused is refused at the door, and names the setting", async () => {
  // Codex approving the register search and the fetch but not the recording tools is a host no search can
  // finish on, however many other calls went through.
  const v = await probeWith(CODEX, { MOCK_CODEX_REFUSE_TOOLS: "note" });
  assert.equal(v.mode, "tools-refused", JSON.stringify(v));
  assert.equal(v.headline, "openai-agent refused a tool call it was given");
  assert.equal(probeVerdictLane(v), "configuration");
  assert.match(v.fix, /CLEAROTRON_CODEX_SANDBOX_BYPASS=1/);
  assert.match(v.detail, /requires approval, but approval policy is never/);
});

test("through the real codex adapter: a write codex reports as failed is refused at the door, and names the setting", async () => {
  // The shape measured on codex-cli 0.156.1 where its sandbox cannot start: every tool call completed, the
  // file change failed, and no file appeared. A search there spends and writes nothing.
  const v = await probeWith(CODEX, { MOCK_CODEX_WRITE_FAILED: "1" });
  assert.equal(v.mode, "cannot-write", JSON.stringify(v));
  assert.equal(v.basis, "write-gauge");
  assert.equal(probeVerdictLane(v), "configuration");
  assert.match(v.fix, /^Every search stage writes its results to a file, so no search can finish here\. codex's own sandbox cannot write on this machine: set CLEAROTRON_CODEX_SANDBOX_BYPASS=1/);
  // And the run door refuses on it, before a run directory exists.
  process.env.MOCK_CODEX_WRITE_FAILED = "1";
  try {
    await assert.rejects(preflightEngineTurn({ env: CODEX }),
      /\[preflight\] openai-agent could not write a file where a search writes its results/, "the run door did not refuse");
  } finally { delete process.env.MOCK_CODEX_WRITE_FAILED; }
});

// ── THE COMMAND: where a stage keeps a shell, the probe proves one runs ───────────────────────────────
// Measured on codex 0.158.0-alpha.2 with a permission profile that could not read codex's own helper: every
// tool call completed and the patch tool wrote the file, while every shell command failed before it
// started. The probe passed there. Now a Codex probe also runs `cat` of a word it planted in its own folder.

test("only an engine whose stages keep a shell is asked for a command, and Claude's probe reads as it always did", () => {
  assert.deepEqual([...ENGINES_WITH_A_SHELL], ["openai-agent"]);
  assert.equal(probePrompt("/p/probe-words.txt"),
    "Call the ping, note and look tools once each. Write the three words they returned to the file /p/probe-words.txt, one per line. Then reply with the same three words.");
  const withCommand = probePrompt("/p/probe-words.txt", `/p/${PROBE_COMMAND_FILE}`);
  assert.ok(isProbePrompt(withCommand), "the command form is no longer recognised as the probe");
  assert.match(withCommand, /Run the shell command cat "\/p\/probe-command-word\.txt"\./);
});

/** A failed `cat` of the file the turn's prompt planted, as codex reports it when its sandbox cannot start one. */
const failedCatOfPlanted = (output) => async (a) => {
  const planted = /Run the shell command cat "(.+?)"\./.exec(a.message)?.[1];
  return answering({ commandsFailed: 1, commandFailures: [{ command: `/bin/bash -lc 'cat ${planted}'`, output }] }, { command: false })(a);
};

test("a failed cat of the planted file is refused at the door; a word simply missing warns", async () => {
  const failed = await probeEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: failedCatOfPlanted("bwrap: execvp /x/codex: No such file or directory\n") });
  assert.equal(failed.mode, "cannot-run-commands", JSON.stringify(failed));
  assert.equal(failed.basis, "command-gauge");
  assert.equal(probeVerdictLane(failed), "configuration", "a machine whose commands cannot start is this box's to fix");
  assert.match(failed.fix, /^Every search stage reads its instructions through commands, so no search can finish here\. codex's own sandbox cannot run commands on this machine: set CLEAROTRON_CODEX_SANDBOX_BYPASS=1/);
  assert.match(failed.detail, /bwrap: execvp/, "codex's own reason rides the verdict");

  const skipped = await probeEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: answering({}, { command: false }) });
  assert.equal(skipped.mode, "commands-unproven", JSON.stringify(skipped));
  assert.equal(probeVerdictLane(skipped), "weather", "a model that skipped a step is not this box's fault");

  // A MISTYPED NAME ON A WORKING MACHINE IS NOT A BROKEN MACHINE. Codex marks any non-zero exit failed, so a
  // `cat` of the wrong path reads exactly like one the sandbox refused, except for the path it names.
  const mistyped = await probeEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: answering({ commandsFailed: 1, commandFailures: [{ command: "/bin/bash -lc 'cat /tmp/clearotron-probe-x/probe-comand-word.txt'",
      output: "cat: /tmp/clearotron-probe-x/probe-comand-word.txt: No such file or directory\n" }] }, { command: false }) });
  assert.equal(mistyped.mode, "commands-unproven", JSON.stringify(mistyped));
  assert.equal(probeVerdictLane(mistyped), "weather", "a working machine was refused at the door for a mistyped name");

  // A failed command whose word still came back is a command that ran: the model retried, or ran another.
  const retried = await probeEngineTurn({ env: { CLEAROTRON_AI: "openai-agent" }, loadAdapter: explode,
    runTurn: answering({ commandsFailed: 1, commandFailures: [{ command: "cat nope", output: "" }] }) });
  assert.equal(retried.ok, true, JSON.stringify(retried));

  // Claude's stages have no shell, so its probe asks for no command and passes without one.
  const claude = await probeEngineTurn({ env: { CLEAROTRON_AI: "anthropic-agent" }, loadAdapter: explode, runTurn: answering({}, { command: false }) });
  assert.equal(claude.ok, true, JSON.stringify(claude));
});

test("the codex adapter counts a command codex reports as failed, and keeps each one's command line and output", () => {
  const ev = {};
  const item = (status, out) => JSON.stringify({ type: "item.completed", item: { id: "c", type: "command_execution",
    command: "/bin/bash -lc 'cat x'", aggregated_output: out, exit_code: status === "failed" ? 1 : 0, status } });
  parseCodexEvent(item("completed", "probe-1\n"), ev);
  assert.equal(ev.commandsFailed ?? 0, 0, "a command that ran was counted as failed");
  parseCodexEvent(item("failed", "bwrap: first\n"), ev);
  parseCodexEvent(item("failed", "bwrap: second\n"), ev);
  assert.equal(ev.commandsFailed, 2);
  assert.deepEqual(ev.commandFailures, [{ command: "/bin/bash -lc 'cat x'", output: "bwrap: first\n" },
    { command: "/bin/bash -lc 'cat x'", output: "bwrap: second\n" }]);
});

test("through the real codex adapter: the probe's command runs, fails as codex reports it, or is skipped", async () => {
  const works = await probeWith(CODEX, {});
  assert.equal(works.ok, true, JSON.stringify(works));
  const failed = await probeWith(CODEX, { MOCK_CODEX_COMMAND_FAILED: "1" });
  assert.equal(failed.mode, "cannot-run-commands", JSON.stringify(failed));
  assert.equal(probeVerdictLane(failed), "configuration");
  assert.match(failed.detail, /bwrap: execvp/);
  const skipped = await probeWith(CODEX, { MOCK_CODEX_COMMAND_SKIPPED: "1" });
  assert.equal(skipped.mode, "commands-unproven", JSON.stringify(skipped));
  const mistyped = await probeWith(CODEX, { MOCK_CODEX_COMMAND_MISTYPED: "1" });
  assert.equal(mistyped.mode, "commands-unproven", JSON.stringify(mistyped));
  assert.equal(probeVerdictLane(mistyped), "weather", "a mistyped name on a working machine reached the door as a refusal");
  // And the run door refuses on the failed command, before a run directory exists.
  process.env.MOCK_CODEX_COMMAND_FAILED = "1";
  try {
    await assert.rejects(preflightEngineTurn({ env: CODEX }),
      /\[preflight\] openai-agent could not run a command where a search runs its commands/, "the run door did not refuse");
  } finally { delete process.env.MOCK_CODEX_COMMAND_FAILED; }
});

test("through the real claude adapter: a write the program reports as failed is refused; a file simply not written warns", async () => {
  const failed = await probeWith(CLAUDE, { MOCK_CLAUDE_WRITE_FAILED: "1" });
  assert.equal(failed.mode, "cannot-write", JSON.stringify(failed));
  assert.equal(probeVerdictLane(failed), "configuration");
  assert.equal(failed.fix, "Every search stage writes its results to a file, so no search can finish here. The engine's stderr below is the place to start.");
  const skipped = await probeWith(CLAUDE, { MOCK_CLAUDE_PROBE_NO_WRITE: "1" });
  assert.equal(skipped.mode, "write-unproven", JSON.stringify(skipped));
  assert.equal(probeVerdictLane(skipped), "weather", "a missing file with no failed write shows nothing either way, so it warns");
  assert.equal(skipped.headline, "anthropic-agent did not write the file its probe asks for");
  const works = await probeWith(CLAUDE, {});
  assert.equal(works.ok, true, JSON.stringify(works));
});

test("the verdicts on the file: every word in it passes; a word short, or no file, warns; a failed write refuses", () => {
  const words = ["probe-00000001", "probe-00000002", "probe-00000003"];
  const said = tupleOf({ code: 0, stdout: words.join(" ") });
  assert.equal(classifyProbe({ engine: "openai-agent", tuple: said, expect: { words, written: words.join("\n") } }).ok, true);
  assert.equal(classifyProbe({ engine: "openai-agent", tuple: said, expect: { words, written: words.slice(0, 2).join("\n") } }).mode, "write-unproven");
  assert.equal(classifyProbe({ engine: "openai-agent", tuple: said, expect: { words, written: null } }).mode, "write-unproven");
  const v = classifyProbe({ engine: "openai-agent", tuple: { ...said, writesFailed: 1, stderr: "Failed to write file /x/probe-words.txt" }, expect: { words, written: null } });
  assert.equal(v.mode, "cannot-write");
  assert.match(v.detail, /Failed to write file/, "the engine's own words ride along");
  // A written file does not need the gauge's opinion: the proof is the file.
  assert.equal(classifyProbe({ engine: "openai-agent", tuple: { ...said, writesFailed: 1 }, expect: { words, written: words.join("\n") } }).ok, true);
});

test("a refusal the model wandered into, on a server that is not the probe's, is never a refusal at the door", () => {
  const words = ["probe-00000001", "probe-00000002", "probe-00000003"];
  const wandered = tupleOf({ code: 0, stdout: words.join(" "), mcpToolCalls: 3, mcpToolCallsRefused: 1,
    mcpToolCallRefusals: [{ server: "register", tool: "register_search", message: "MCP tool call requires approval, but approval policy is never" }] });
  assert.equal(classifyProbe({ engine: "openai-agent", tuple: wandered, expect: { words, written: words.join("\n") } }).ok, true);
  const own = { ...wandered, mcpToolCallRefusals: [{ server: "probe", tool: "look", message: "MCP tool call requires approval, but approval policy is never" }] };
  assert.equal(classifyProbe({ engine: "openai-agent", tuple: own, expect: { words, written: words.join("\n") } }).mode, "tools-refused");
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

// ── THE PROBE'S TOOL IS DECLARED AS THE REGISTER SEARCH IS ────────────────────────────────────────────
//
// codex decides from a tool's annotations whether a call needs approval, and `codex exec` refuses every
// call that does unless its sandbox is bypassed. A read-only `ping` never needed approval, so the probe
// passed on a host where `register_execute_plan` was refused on every call. Both are read here from the
// servers' own `tools/list`, started as a stage starts them, so what is compared is what codex receives.
const MCP_DIR = join(HERE, "..", "engine", "mcp");
function toolsOf(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...env } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error(`${args[0]} did not answer tools/list`)); }, 20000);
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}
// codex's own rule for an MCP tool under the default `auto` mode (codex-rs/core/src/mcp_tool_call.rs,
// `requires_mcp_tool_approval`, the same at 0.150.1, 0.153.4 and 0.156.1), copied to say why the
// annotations matter, not to stand in for codex.
const codexWouldAskApproval = (a = {}) => a.destructiveHint === true ? true
  : a.readOnlyHint === true ? false
  : (a.destructiveHint ?? true) || (a.openWorldHint ?? true);

test("the probe's tool carries the register search tool's annotations, read from both servers as codex reads them", async () => {
  const probe = JSON.parse(probeToolConfig("probe-0badc0de").mcpConfig).mcpServers.probe;
  const [ping] = (await toolsOf(probe.command, probe.args, probe.env)).filter((t) => t.name === "ping");
  assert.ok(ping, "the probe server lists no ping");
  const registers = readdirSync(MCP_DIR).filter((f) => f.endsWith("-server.mjs")
    && readFileSync(join(MCP_DIR, f), "utf8").includes('"register_execute_plan"'));
  assert.ok(registers.length >= 1, `no register server in ${MCP_DIR} declares register_execute_plan, so nothing was compared`);
  for (const f of registers) {
    const search = (await toolsOf(process.execPath, [join(MCP_DIR, f)])).find((t) => t.name === "register_execute_plan");
    assert.ok(search, `${f} does not list register_execute_plan`);
    assert.deepEqual(ping.annotations, search.annotations,
      `${f}'s register_execute_plan is declared ${JSON.stringify(search.annotations)} and the probe's tool ${JSON.stringify(ping.annotations)} — the probe no longer answers for the search`);
  }
  // WHAT THAT BUYS: the probe's call now needs approval exactly when the search's does. The read-only
  // declaration it replaced never did, which is how a probe passed where no search could run.
  assert.equal(codexWouldAskApproval(ping.annotations), true);
  assert.equal(codexWouldAskApproval({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }), false);
});

test("the probe's other two tools carry the recording tools' and the page fetch's annotations, read from their own servers", async () => {
  // A stage calls three kinds of tool, and codex decides approval by kind. `note` stands in for the tools that
  // record a stage's results, `look` for the page fetch; each is compared with what its own server lists.
  const probe = JSON.parse(probeToolConfig(["a", "b", "c"]).mcpConfig).mcpServers.probe;
  const listed = await toolsOf(probe.command, probe.args, probe.env);
  const byName = Object.fromEntries(listed.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), [...PROBE_TOOLS].sort(), "the probe server lists exactly its three tools");
  const writers = (await toolsOf(process.execPath, [join(MCP_DIR, "recording-server.mjs")])).filter((t) => t.annotations?.readOnlyHint === false);
  assert.ok(writers.length >= 10, `the recording server lists only ${writers.length} tools that record — the comparison would mean nothing`);
  for (const t of writers)
    assert.deepEqual(byName.note.annotations, t.annotations, `${t.name} is declared ${JSON.stringify(t.annotations)} and the probe's note ${JSON.stringify(byName.note.annotations)}`);
  const [fetchUrl] = (await toolsOf(process.execPath, [join(MCP_DIR, "fetch-server.mjs")])).filter((t) => t.name === "fetch_url");
  assert.ok(fetchUrl, "the fetch server lists no fetch_url");
  assert.deepEqual(byName.look.annotations, fetchUrl.annotations);
});
