// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN PROVES ITS ENGINE'S FOOTING BEFORE IT SPENDS (engine/probe.mjs, classifyFooting). The probe's one turn shows, from
// the program's own output, that the write guard ran, that every built-in tool a stage is granted is offered, and that
// the credential is the one the billing mode expects; a mismatch is refused at the door, named.
//
// Three layers: the verdict over literal session reports; the real adapter and the real guard program against the
// stand-in program, which runs the hooks it is handed; and, where a real Claude Code is installed, the real program
// started with no sign-in to read and the vendor's address pointed nowhere, so it reports its session and costs nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { classifyFooting, probeEngineTurn, preflightEngineTurn, probeVerdictLane } = await import("../engine/probe.mjs");
const { EVERY_STAGE_BUILTIN_TOOL } = await import("../engine/mcp/gather-config.mjs");
const { buildClaudeArgs, writeBoundarySettings } = await import("../engine/anthropic-agent.mjs");

const CLAUDE = { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-claude.mjs") };
const TOOLS = [...EVERY_STAGE_BUILTIN_TOOL];
const WORD = "probe-0a1b2c3d";
const ran = (word = WORD) => [{ hook: "SessionStart", outcome: "success", exitCode: 0, stderr: `footing:${word}\n` }];
const report = (over = {}) => ({ tools: [...TOOLS].sort(), agents: ["claude", "Explore"], apiKeySource: "none", version: "2.1.326", hooks: ran(), ...over });
const judge = (r, auth = { mode: "subscription" }, completed = true, env = {}) =>
  classifyFooting({ engine: "anthropic-agent", report: r, expect: { word: WORD, tools: TOOLS }, auth, completed, env });

async function probeWith(env, controls = {}) {
  const saved = Object.fromEntries(Object.keys(controls).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(controls)) pinEnv(process.env, k, v);
  try { return await probeEngineTurn({ env }); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("the footing holds on a session that ran the guard, offers every granted tool, and pays as the install does", () => {
  assert.equal(judge(report()), null);
  assert.equal(judge(report({ apiKeySource: "ANTHROPIC_API_KEY" }), { mode: "api-key" }), null);
  assert.equal(judge(report({ apiKeySource: "none" }), { mode: "cloud", cloud: "bedrock" }), null);
});

test("page fetching counts as the web-fetch helper, the shape a subscription sign-in reports", () => {
  const tools = TOOLS.filter((t) => t !== "WebFetch");
  assert.equal(judge(report({ tools, agents: ["claude", "web-fetch"] })), null);
  assert.equal(judge(report({ tools, agents: ["claude"] }))?.mode, "tools-missing");
});

test("the minimal mode is named as itself: no guard and fewer tools, with the remedy that fits", () => {
  const v = judge(report({ tools: ["Edit", "Read"], hooks: [] }));
  assert.equal(v.mode, "minimal-mode");
  assert.equal(v.basis, "session-report");
  assert.equal(probeVerdictLane(v), "configuration", "the door would only warn");
  assert.match(v.detail, /Grep/);
  assert.match(judge(report({ tools: ["Edit", "Read"], hooks: [] }), undefined, true, { CLAUDE_CODE_SIMPLE: "1" }).fix, /CLAUDE_CODE_SIMPLE is set/);
});

test("a guard that did not run is refused, whatever else the session offered", () => {
  for (const hooks of [[], ran("probe-someoneelse"), [{ hook: "SessionStart", outcome: "error", exitCode: 1, stderr: `footing:${WORD}` }]]) {
    const v = judge(report({ hooks }));
    assert.equal(v?.mode, "guard-off", JSON.stringify(hooks));
    assert.equal(probeVerdictLane(v), "configuration");
  }
});

test("a credential other than the one the install pays with is refused, under each way of paying", () => {
  assert.equal(judge(report({ apiKeySource: "ANTHROPIC_API_KEY" }), { mode: "subscription" })?.mode, "credential-mismatch");
  assert.equal(judge(report({ apiKeySource: "apiKeyHelper" }), { mode: "cloud", cloud: "vertex" })?.mode, "credential-mismatch");
  assert.equal(judge(report({ apiKeySource: "none" }), { mode: "api-key" })?.mode, "credential-mismatch");
});

test("a completed turn whose program listed nothing is refused; a failed one is left to the verdict that names its failure", () => {
  assert.equal(judge(null, undefined, true)?.mode, "footing-unread");
  assert.equal(judge(report({ tools: null }), undefined, true)?.mode, "footing-unread");
  assert.equal(judge(null, undefined, false), null);
});

test("the guard's word rides the session start on the check's turn alone, on stderr, never to the model", () => {
  const plain = JSON.parse(buildClaudeArgs({ message: "m", model: "haiku", thinking: "low", runDir: "/nonexistent/run" }).args.at(-1));
  assert.equal(plain.hooks.SessionStart, undefined, "a stage's turn carries the check's hook");
  const settings = JSON.parse(writeBoundarySettings({ runDir: "/nonexistent/run", footingWord: WORD }));
  const [h] = settings.hooks.SessionStart[0].hooks;
  assert.deepEqual(h.args, settings.hooks.PreToolUse[0].hooks[0].args, "the start hook is not the guard with its own policy");
  const r = spawnSync(h.command, h.args, { input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }), encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "", "the word reached stdout, which the program hands the model");
  assert.equal(r.stderr.trim(), `footing:${WORD}`);
});

test("through the real adapter and guard: a normal start passes, and the door refuses the minimal mode by name", async () => {
  const ok = await probeWith(CLAUDE);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const sub = await probeWith(CLAUDE, { MOCK_CLAUDE_WEB_FETCH_AGENT: "1" });
  assert.equal(sub.ok, true, JSON.stringify(sub));
  const bare = await probeWith(CLAUDE, { MOCK_CLAUDE_BARE: "1" });
  assert.equal(bare.mode, "minimal-mode", JSON.stringify(bare));
  process.env.MOCK_CLAUDE_BARE = "1";
  try { await assert.rejects(preflightEngineTurn({ env: CLAUDE }), /minimal mode/, "the run door let the minimal mode through"); }
  finally { delete process.env.MOCK_CLAUDE_BARE; }
});

test("through the real adapter: a key the subscription install does not pay with is refused at the door", async () => {
  const v = await probeWith(CLAUDE, { MOCK_CLAUDE_KEY_SOURCE: "ANTHROPIC_API_KEY" });
  assert.equal(v.mode, "credential-mismatch", JSON.stringify(v));
  const keyed = await probeWith({ ...CLAUDE, CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-ant-invented" });
  assert.equal(keyed.ok, true, JSON.stringify(keyed));
});

// THE REAL PROGRAM, where one is installed. No sign-in is read and the vendor's address is a closed local port, so the
// program reports its session, fails at sign-in, and costs nothing. Skipped, and saying so, where there is none.
const realClaude = (() => { const r = spawnSync("claude", ["--version"], { encoding: "utf8" }); return r.status === 0 && /Claude Code/.test(r.stdout) ? r.stdout.trim() : null; })();
test("the real program: started normally its footing holds, and in its minimal mode it is refused as that mode",
  { skip: realClaude ? false : "no Claude Code on PATH; the nightly check installs one and runs scripts/engine-footing.mjs" }, async () => {
    const { footingTurn } = await import("../../scripts/engine-footing.mjs");
    const normal = await footingTurn();
    assert.equal(normal.verdict, null, `${realClaude}: ${JSON.stringify(normal)}`);
    const minimal = await footingTurn({ simulateMinimalMode: true });
    assert.equal(minimal.verdict?.mode, "minimal-mode", `${realClaude}: ${JSON.stringify(minimal)}`);
  });

// THE MINIMAL MODE'S REMEDY NAMES THE VERSION THIS INSTALL LAST RAN (the owner's approved words, his item 1345), read from
// the install's own run records, and only on that refusal. A fresh install, or the same version, keeps the words that
// name no number. Every version and folder here is invented.
test("the minimal mode's remedy names the version this install last ran, and names none where none is known", async () => {
  const { minimalModeRemedy } = await import("../engine/probe.mjs");
  const head = "No search starts until it starts normally. Nothing in this install asks for that mode, so this Claude Code version starts in it by default.";
  assert.equal(minimalModeRemedy("2.1.340", "2.1.332 (Claude Code)"), `${head} Install Claude Code 2.1.332, the version this install last ran, then run this check again.`);
  const unnamed = `${head} Install the Claude Code version this install last ran, then run this check again.`;
  assert.equal(minimalModeRemedy("2.1.340", null), unnamed, "a fresh install was told a version");
  assert.equal(minimalModeRemedy("2.1.340 (Claude Code)", "2.1.340"), unnamed, "the refused version was named as the one to install");
  assert.equal(minimalModeRemedy("2.1.340", () => { throw new Error("unreadable"); }), unnamed);
  const v = classifyFooting({ engine: "anthropic-agent", report: report({ version: "2.1.340", tools: ["Edit", "Read"], hooks: [] }), expect: { word: WORD, tools: TOOLS },
    auth: { mode: "subscription" }, completed: true, env: {}, lastRanVersion: "2.1.332" });
  assert.match(v.fix, /Install Claude Code 2\.1\.332, the version this install last ran, then run this check again\.$/);
});

test("the version last run is the newest Claude attempt in the install's newest runs; a Codex run and a run with none are passed over", async () => {
  const { lastClaudeVersionIn, lastRanClaudeVersion } = await import("../engine/probe.mjs");
  const { studioDirFor } = await import("../../shared/pre-rename-spellings.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const row = (engine, cliVersion) => JSON.stringify({ event: "attempt", stage: "matter-frame", engine, cliVersion });
  assert.equal(lastClaudeVersionIn([row("anthropic-agent", "2.1.320 (Claude Code)"), row("anthropic-agent", "2.1.326 (Claude Code)"), row("openai-agent", "0.162.0"), "{torn"].join("\n")), "2.1.326");
  assert.equal(lastClaudeVersionIn(row("openai-agent", "0.162.0")), null);
  const root = mkdtempSync(join(tmpdir(), "footing-last-ran-"));
  const studio = studioDirFor(join(root, "workspace-agentx"));
  const run = (slug, leaf, startedAt, lines) => {
    const dir = join(studio, slug, leaf);
    mkdirSync(join(dir, "_driver"), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ state: "delivered", startedAt }));
    writeFileSync(join(dir, "_driver", "run.jsonl"), lines.join("\n") + "\n");
  };
  run("matter-a", "2026-11-01-old", "2026-11-01T09:00:00.000Z", [row("anthropic-agent", "2.1.320 (Claude Code)")]);
  run("matter-b", "2026-11-20-mid", "2026-11-20T09:00:00.000Z", [row("anthropic-agent", "2.1.332 (Claude Code)")]);
  run("matter-c", "2026-11-25-new", "2026-11-25T09:00:00.000Z", [row("openai-agent", "0.162.0")]);
  run("matter-d", "2026-11-26-none", "2026-11-26T09:00:00.000Z", [JSON.stringify({ event: "start" })]);
  assert.equal(await lastRanClaudeVersion({ workspaceRoot: root }), "2.1.332");
  assert.equal(await lastRanClaudeVersion({ workspaceRoot: join(root, "absent") }), null, "a fresh install named a version");
});

test("through the real adapter: the door's minimal-mode refusal names the version last run, read only on that refusal", async () => {
  let reads = 0;
  const lastRanVersion = async () => { reads++; return "2.1.332"; };
  const keys = [...Object.keys(CLAUDE), "MOCK_CLAUDE_BARE"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(CLAUDE)) pinEnv(process.env, k, v);
  try {
    const ok = await probeEngineTurn({ env: CLAUDE, lastRanVersion });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(reads, 0, "the run records were read on a check that passed");
    process.env.MOCK_CLAUDE_BARE = "1";
    const bare = await probeEngineTurn({ env: CLAUDE, lastRanVersion });
    assert.equal(bare.mode, "minimal-mode");
    assert.equal(reads, 1);
    assert.match(bare.fix, /Install Claude Code 2\.1\.332, the version this install last ran, then run this check again\.$/);
  } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});
