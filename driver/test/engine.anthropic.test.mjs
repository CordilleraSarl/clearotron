// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// E1b — anthropic-agent engine unit + integration tests. Fully offline ($0): a mock `claude` binary
// (mock-claude.mjs) emits the stream-json envelope the engine parses. Covers the usage mapping, the
// envelope synthesis, sessionRef/cost, warm-resume threading, and THE stall-watchdog
// (the #1 speed prize) — plus an end-to-end runStage on CLEAROTRON_AI=anthropic-agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { anthropicAgentEngine, claudeModel, effortFor, mapUsage, buildClaudeArgs, absolutizeSkillRefs, spawnEnv,
  EFFORT_TABLE, CROSS_ENGINE_EFFORT_TIERS } from "../engine/anthropic-agent.mjs";
import { EFFORT_TABLE as CODEX_EFFORT_TABLE } from "../engine/openai-agent.mjs";
import { runStage, isTimeout, isLaneWedge, classifyWedge, payloadText, selectEngine, registerEngine } from "../gateway.mjs";
import { failingBin } from "./platform-caps.mjs";
import { reapPidfile } from "./reap-fixture.mjs";   // #1847 — the owner reaps it, on every exit path
import { pinEnv } from "../../shared/env-aliases.mjs";   // Refs tracker issue 1838 — a fixture pins EVERY spelling

test("auth toggle: subscription (default) strips ANTHROPIC_API_KEY; api-key mode keeps it", () => {
  assert.equal(spawnEnv({ ANTHROPIC_API_KEY: "sk-x" }).ANTHROPIC_API_KEY, undefined, "default subscription strips the key → claude uses the included subscription, not API billing");
  assert.equal(spawnEnv({ ANTHROPIC_API_KEY: "sk-x", CLEAROTRON_AI_BILLING: "subscription" }).ANTHROPIC_API_KEY, undefined);
  assert.equal(spawnEnv({ ANTHROPIC_API_KEY: "sk-x", CLEAROTRON_AI_BILLING: "api-key" }).ANTHROPIC_API_KEY, "sk-x", "api-key fallback keeps it");
});

test("2070: CLAUDE_CODE_OAUTH_TOKEN RIDES THROUGH under subscription — the headless sign-in's whole mechanism", () => {
  // The setup-token route only works because spawnEnv is a spread that strips exactly one thing: the
  // token INSTALL.md's headless sign-in produces has to reach the claude subprocess from the env file,
  // and until this arm nothing declared that. A future spawnEnv that allowlists, or strips OAuth vars
  // alongside the API key, silently kills every headless server's subscription lane — the failure
  // arrives ninety minutes into a clearance wearing a model fault's shape.
  const sub = spawnEnv({ CLAUDE_CODE_OAUTH_TOKEN: "tok-x", ANTHROPIC_API_KEY: "sk-x" });
  assert.equal(sub.CLAUDE_CODE_OAUTH_TOKEN, "tok-x", "subscription keeps the OAuth token while stripping the key");
  assert.equal(sub.ANTHROPIC_API_KEY, undefined);
  assert.equal(spawnEnv({ CLAUDE_CODE_OAUTH_TOKEN: "tok-x", CLEAROTRON_AI_BILLING: "api-key", ANTHROPIC_API_KEY: "sk-x" }).CLAUDE_CODE_OAUTH_TOKEN,
    "tok-x", "api-key mode does not eat it either — the CLI's own precedence decides, not ours");
});

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = join(HERE, "mock-claude.mjs");

/** #1780 — the most recent turn, so a timing arm's failure can carry the specimen. */
let lastRun = null;

async function run(opts, env = {}) {
  const all = { CLEAROTRON_CLAUDE_PATH: MOCK, ...env };
  const saved = {};
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; pinEnv(process.env, k, all[k]); }
  // #1780 — the last turn is remembered so `timedTest` can attach the specimen to ANY failure in a
  // timing arm. Sound because node:test runs the subtests of one file sequentially (verified, not
  // assumed: `--test-concurrency=1` was dropped at the FILE level in #179, not within a file).
  try { return (lastRun = await anthropicAgentEngine.runTurn(opts)); }
  finally { for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
}

// ── #1780 — THE SPECIMEN GOES IN EVERY TIMING ARM'S MESSAGE, NOT ONE OF THEM ───────────────────────
//
// #1782 put `firstByteMs` in the engine's no-progress stderr and in arm 449's assertion message. Then a
// real failure landed on main (34d160ec, run 32672060149) in arm 449's SIBLINGS — and carried none of
// it, because each arm writes its own message. A fix at one site missing the sibling that keeps its own
// copy is a shape this repo has been bitten by before, and the instrument built for this very failure
// reproduced it.
//
// So the bit is formatted ONCE here and appended by every arm whose fixture budgets in milliseconds.
// The guard at the bottom of this file fails when such an arm does not carry it — a new arm cannot
// inherit the gap by being written later.
//
// WHAT IT IS FOR. `firstByteMs=null` means the child never spoke and the grace was genuinely exceeded —
// a starved spawn. A NUMBER means it spoke and the turn was measured wrongly afterwards. Those want
// different fixes, and a CI log is the only place the answer exists once the run is over.
// A timing arm declares itself with `timedTest`, and every assertion inside it carries the specimen
// WITHOUT THE AUTHOR REMEMBERING TO APPEND IT. Widening sixteen arms by hand would have put the bit in
// sixteen places that can each drift; this puts it in one, and the guard at the bottom of the file
// fails when a clock-pinning arm is written as a plain `test` instead.
const timed = (fn) => async (t) => {
  lastRun = null;
  try { await fn(t); }
  catch (e) {
    if (lastRun && typeof e?.message === "string" && !e.message.includes("#1780")) e.message += specimen(lastRun);
    throw e;
  }
};

const specimen = (r) =>
  ` [#1780 firstByteMs=${r?.firstByteMs} toolCalls=${r?.toolCalls} toolWaitMs=${r?.toolWaitMs}`
  + ` killed=${r?.killed} signals=${JSON.stringify(r?.signals ?? {})}]`;

test("tier/alias → claude model alias; a model claude cannot run REFUSES (#238 corruption 3)", () => {
  assert.equal(claudeModel("opus"), "claude-opus-5");  // pinned to Opus 5 (2026-07-27), not the bare drifting alias
  assert.equal(claudeModel("sonnet"), "claude-sonnet-5");  // pinned, not the bare drifting alias
  assert.equal(claudeModel("haiku"), "haiku");
  assert.equal(claudeModel("fable"), "fable");  // registered for the synthesis A/B test (CLEAROTRON_SYNTHESIS_MODEL)
  assert.equal(claudeModel("anthropic/claude-opus-5"), "claude-opus-5");  // full catalog id
  assert.equal(claudeModel("anthropic/claude-sonnet-5"), "claude-sonnet-5");  // full catalog id
  assert.equal(claudeModel("claude-haiku-4-5-20251001"), "haiku");   // a dated bare id is a NAMING form, not a substitution
  assert.equal(claudeModel(undefined), undefined);
  // THE CORRUPTION. These four returned an anthropic model and the telemetry logged the alias asked for,
  // so `--model gemini` ran sonnet and every attribution downstream named gemini. They refuse now.
  for (const dead of ["gemini", "gemini-flash", "deepseek-v4-pro", "azure"])
    assert.throws(() => claudeModel(dead), /no claude model mapped/, `${dead} must refuse, not substitute`);
  // …and so does the old catch-all else-arm, which mapped ANY unrecognised string to sonnet.
  assert.throws(() => claudeModel("llama-3"), /no claude model mapped/);
  assert.throws(() => claudeModel("anthropic/claude-mock-winner"), /no claude model mapped/,
    "a claude-* id naming no family this build knows refuses too — it used to fall through to sonnet");
});

test("thinking → effort remap", () => {
  assert.equal(effortFor("off"), "low");
  assert.equal(effortFor("low"), "low");
  assert.equal(effortFor("medium"), "medium");
  assert.equal(effortFor("adaptive"), "medium");
  assert.equal(effortFor("high"), "high");
  assert.equal(effortFor("max"), "max");
  assert.equal(effortFor(undefined), "medium");
});

// #238 corruption 4a — `off` mapped to `low` here and `minimal` on codex, so at the bottom of the ladder
// the two engines were a whole rung apart and a cross-engine effort comparison at `off` was off by one.
// This is the drift test that keeps them one table: the same duplicate-plus-pin discipline
// engine.common.test.mjs uses for WRITE_DISCIPLINE, because anthropic-agent.mjs deliberately imports
// nothing but node built-ins and cannot share a leaf module.
test("#238: `off` means ONE thing across both engines, and the tables may differ only at `max`", () => {
  for (const tier of CROSS_ENGINE_EFFORT_TIERS)
    assert.equal(EFFORT_TABLE[tier], CODEX_EFFORT_TABLE[tier],
      `tier "${tier}" must map to the same effort on both engines — it is the same instruction`);
  assert.equal(EFFORT_TABLE.off, "low", "low is the anthropic floor (claude --effort: low|medium|high|xhigh|max), so it is where `off` has to sit");
  assert.equal(CODEX_EFFORT_TABLE.off, "low", "codex came UP to the shared floor; its `minimal` is deliberately unreachable from the driver vocabulary");
  // The ONE sanctioned divergence, asserted rather than tolerated: `max` means "this engine's top rung",
  // and codex has no `max`. Pinning it here means the tables cannot drift anywhere else unnoticed.
  assert.equal(EFFORT_TABLE.max, "max");
  assert.equal(CODEX_EFFORT_TABLE.max, "xhigh");
  assert.deepEqual(
    Object.keys(EFFORT_TABLE).filter((t) => EFFORT_TABLE[t] !== CODEX_EFFORT_TABLE[t]), ["max"],
    "`max` is the only tier the two engines are allowed to disagree on");
});

test("usage mapping: Anthropic shape → canonical {input,output,cacheRead,cacheWrite,total}", () => {
  assert.deepEqual(
    mapUsage({ input_tokens: 10, output_tokens: 46, cache_read_input_tokens: 21462, cache_creation_input_tokens: 5065 }),
    { input: 10, output: 46, cacheRead: 21462, cacheWrite: 5065, total: 26583 });
  assert.equal(mapUsage(null), null);
});

test("buildClaudeArgs: print + stream-json + model/effort/permission, and the optional resume/mcp; the prompt rides `input` (stdin), NOT argv", () => {
  const { args: a, input } = buildClaudeArgs({ message: "hi", model: "opus", thinking: "high" });
  // `-p` is a BARE flag now — the prompt is `input` (piped on stdin), never an argv element (E2BIG fix).
  assert.equal(a[0], "-p"); assert.equal(input, "hi"); assert.ok(!a.includes("hi"), "the prompt is not in argv");
  assert.ok(a.includes("--output-format") && a[a.indexOf("--output-format") + 1] === "stream-json");
  assert.ok(a.includes("--verbose") && a.includes("--include-partial-messages"));
  assert.equal(a[a.indexOf("--model") + 1], "claude-opus-5");  // opus tier pinned to Opus 5 (2026-07-27)
  assert.equal(a[a.indexOf("--effort") + 1], "high");
  assert.equal(a[a.indexOf("--permission-mode") + 1], "acceptEdits");
  assert.ok(!a.includes("--resume"));
  const { args: b } = buildClaudeArgs({ message: "hi", model: "sonnet", thinking: "low", resumeRef: "sess-9", mcpConfig: "/x.json", allowedTools: "mcp__a__b" });
  assert.equal(b[b.indexOf("--resume") + 1], "sess-9");
  assert.ok(b.includes("--strict-mcp-config"));
  assert.equal(b[b.indexOf("--mcp-config") + 1], "/x.json");
  assert.equal(b[b.indexOf("--allowedTools") + 1], "mcp__a__b");
});

test("buildClaudeArgs: never emits --settings (fast mode REMOVED — it ~2.5x'd subscription usage, tripped the 5h cap 2026-06-17)", () => {
  // Full revert: no stage sets fastMode and the engine no longer threads it. A stray/legacy fastMode arg must
  // NOT resurrect --settings (the flag is gone from the signature; this guards against silent reintroduction).
  const { args: a } = buildClaudeArgs({ message: "hi", model: "opus", thinking: "high", fastMode: true });
  assert.ok(!a.includes("--settings"), "fast mode removed -> no --settings even if a fastMode arg is passed");
  const { args: b } = buildClaudeArgs({ message: "hi", model: "opus", thinking: "high" });
  assert.ok(!b.includes("--settings"), "no --settings on a plain opus stage");
});

test("rate-limit / session-cap: rejected rate_limit_event + 429 result -> signals.rateLimited + resetsAt (ISO of epoch-seconds)", async () => {
  const resetsEpoch = 1781729400;
  const r = await run({ message: "x", model: "opus", thinking: "high", timeoutSec: 60 }, { MOCK_CLAUDE_RATELIMIT: String(resetsEpoch) });
  assert.equal(r.signals?.rateLimited, true, "429 / rejected rate_limit_event -> rateLimited signal");
  assert.equal(r.signals?.resetsAt, new Date(resetsEpoch * 1000).toISOString(), "resetsAt = ISO of the event's epoch-seconds value");
  assert.notEqual(r.code, 0, "a rate-limited turn is non-success (nonzero code)");
});

test("runStage: rate-limit -> fail 'rate_limited' (NOT nonzero_exit), carries resetsAt, ONE attempt (no retry/cascade)", async () => {
  const resetsEpoch = 1781729400;
  const env = { CLEAROTRON_CLAUDE_PATH: MOCK, CLEAROTRON_AI: "anthropic-agent", MOCK_CLAUDE_RATELIMIT: String(resetsEpoch) };
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  try {
    const r = await runStage("matter-frame", { agent: "clawdi", message: "do it", model: "opus", thinking: "high", sessionKey: "prelim-test-rl", timeoutSec: 60, maxRetries: 2 });
    assert.equal(r.ok, false);
    assert.equal(r.fail, "rate_limited", "classified distinctly — not the fallback-eligible nonzero_exit_1");
    assert.equal(r.resetsAt, new Date(resetsEpoch * 1000).toISOString(), "resetsAt rides the runStage result");
    assert.equal(r.attempts, 1, "no retries: every retry would hit the same capped subscription");
  } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
});

test("STALL-WATCHDOG: a per-stage stallSec OVERRIDES the global CLEAROTRON_STALL_MS", async () => {
  // The global is deliberately LONG (60s) but the stage pins stallSec=0.3 → it must still kill in well under
  // a second. Proves the per-stage override drives the watchdog (heavy stages raise it; light stages keep the
  // tight global so a real wedge still trips fast). Clamp guard (NaN/≤0 → global) is covered by the global test.
  const t0 = Date.now();
  const r = await run({ message: "x", model: "opus", thinking: "high", timeoutSec: 60, stallSec: 0.3 }, { MOCK_CLAUDE_STALL: "1", CLEAROTRON_STALL_MS: "60000" });
  assert.equal(r.killed, true, "per-stage stall fired despite the long global");
  assert.equal(r.json.status, "timeout");
  assert.ok(Date.now() - t0 < 5000, "killed on the 0.3s per-stage stall, not the 60s global");
});

// ── SKILL-REF PATH RESOLUTION ─────────────────────────────────────────────────────────────────────
// The shared stage prompts reference skills by the convention `skills/foo/SKILL.md`. A workspace agent
// resolves these against its workspace cwd; `claude -p` (cwd=tmpdir) cannot, and its file tools are confined
// to cwd + --add-dir roots. The engine absolutizes those refs against the configured skills tree (skillsDir —
// the driver-co-located `skills/`; the refs keep their `skills/` prefix, so they are joined onto
// the PARENT of skillsDir) and grants --add-dir on skillsDir + the run dir. The retired gateway path is untouched.

test("absolutizeSkillRefs: rewrites bare skills/…md under skillsDir's parent; no skillsDir = no-op", () => {
  assert.equal(
    absolutizeSkillRefs("First, read and follow exactly: skills/matter-frame/SKILL.md.", "/ws/skills"),
    "First, read and follow exactly: /ws/skills/matter-frame/SKILL.md.");
  // multiple refs in one message (synthesis reads three) — each rewritten exactly once
  const m = absolutizeSkillRefs("read skills/prelim-search/synthesis-rules.md, skills/prelim-search/risk-framework.md, skills/prelim-search/worked-examples.md.", "/ws/skills");
  assert.equal(m, "read /ws/skills/prelim-search/synthesis-rules.md, /ws/skills/prelim-search/risk-framework.md, /ws/skills/prelim-search/worked-examples.md.");
  // provider doc stays inside the rewrite
  assert.equal(absolutizeSkillRefs("read skills/prelim-register/providers/corsearch.md", "/ws/skills"), "read /ws/skills/prelim-register/providers/corsearch.md");
  assert.equal(absolutizeSkillRefs("no skill ref here at all", "/ws/skills"), "no skill ref here at all");
  assert.equal(absolutizeSkillRefs("skills/x/y.md", undefined), "skills/x/y.md", "no skillsDir → unchanged");
});

test("absolutizeSkillRefs: IDEMPOTENT — an already-absolute path containing skills/ is NOT double-prefixed", () => {
  const once = absolutizeSkillRefs("read skills/matter-frame/SKILL.md", "%h/cordillera.ch-trademark/driver/skills");
  assert.equal(once, "read %h/cordillera.ch-trademark/driver/skills/matter-frame/SKILL.md");
  // re-running (e.g. a corrective/warm re-wrap of an already-absolutized message) must be a no-op
  assert.equal(absolutizeSkillRefs(once, "%h/cordillera.ch-trademark/driver/skills"), once, "no path doubling");
  // a generic absolute path that merely contains 'skills/' mid-path is left alone
  assert.equal(absolutizeSkillRefs("write /run/x/skills/out.md", "/ws/skills"), "write /run/x/skills/out.md");
});

test("buildClaudeArgs: --add-dir grants skills tree + run dir; message absolutized in `input`; both added on resume too", () => {
  const { args: a, input } = buildClaudeArgs({ message: "read skills/matter-frame/SKILL.md then write /run/out.md", model: "opus", thinking: "medium", skillsDir: "/ws/skills", runDir: "/run" });
  assert.equal(input, "read /ws/skills/matter-frame/SKILL.md then write /run/out.md", "skill ref absolutized in the stdin prompt");
  const addDirs = a.reduce((acc, x, i) => (x === "--add-dir" ? [...acc, a[i + 1]] : acc), []);
  assert.deepEqual(addDirs, ["/ws/skills", "/run"], "exactly the skills tree + the run dir, in order");
  // resume branch still carries the dirs (a resumed turn re-needs file access)
  const { args: r } = buildClaudeArgs({ message: "x", model: "sonnet", thinking: "low", resumeRef: "sess-9", skillsDir: "/ws/skills", runDir: "/run" });
  assert.equal(r.filter((x) => x === "--add-dir").length, 2, "add-dir present on the --resume path");
});

test("buildClaudeArgs: no skillsDir/runDir (engine unit tests, mocks) → no --add-dir, message untouched", () => {
  const { args: a, input } = buildClaudeArgs({ message: "read skills/x/SKILL.md", model: "haiku", thinking: "low" });
  assert.equal(input, "read skills/x/SKILL.md", "message unchanged when no skillsDir");
  assert.ok(!a.includes("--add-dir"), "no add-dir without a run/skills dir");
});

test("buildClaudeArgs: a no-skills message is byte-identical, but the run dir is still granted (write root)", () => {
  const { args: a, input } = buildClaudeArgs({ message: "Read /run/email-body.md and reply DONE.", skillsDir: "/ws/skills", runDir: "/run" });
  assert.equal(input, "Read /run/email-body.md and reply DONE.", "no skills token → message unchanged");
  const addDirs = a.reduce((acc, x, i) => (x === "--add-dir" ? [...acc, a[i + 1]] : acc), []);
  assert.deepEqual(addDirs, ["/ws/skills", "/run"]);
});

test("E2BIG regression: a >128 KB prompt runs (prompt rides stdin, not a `-p` argv element)", async () => {
  // The ROADTRIPPIN' VIBES failure: the register-unit primary-sweep prompt inlined a 152 KB plan slice,
  // exceeding MAX_ARG_STRLEN (128 KB) as a single `-p` argv → `spawn E2BIG`, a 2 ms pre-exec kill. With the
  // prompt on stdin there is no argv ceiling. This spawns the mock with a 200 KB prompt — it would E2BIG
  // pre-fix (the mock is a real child spawned the same way) and must succeed post-fix.
  const big = "x".repeat(200000);   // > MAX_ARG_STRLEN (131072); safely under ARG_MAX total
  const r = await run({ message: big, model: "haiku", thinking: "low", timeoutSec: 60 }, { MOCK_CLAUDE_NOFILE: "1" });
  assert.equal(r.json.status, "ok", "a 200 KB prompt spawns + completes via stdin (no E2BIG)");
  assert.equal(r.code, 0);
});

// #1014 — A TEST FOR A SECOND ARGV BUILDER USED TO SIT HERE, and it is deleted with the builder. It
// pinned that the comms one-shots' args carried no `--add-dir` and no skill absolutization, which was
// the whole difference between them and a compute turn. There are no comms one-shots: every
// requester-facing event is an outbox packet written by code, so there is exactly ONE argv builder in
// the product and the arms above are the only ones that can be wrong.

test("runTurn (normal): synthesizes an ok envelope in the classifier's shape with mapped usage/sessionRef — no currency in the tuple", async () => {
  const r = await run({ message: "say ok", model: "sonnet", thinking: "medium", timeoutSec: 60 });
  assert.equal(r.json.status, "ok");
  assert.equal(payloadText(r.json), "mock claude ok");
  assert.equal(r.usage.total, 26583);
  assert.equal(r.usage.cacheWrite, 5065);
  // tokens-only directive (2026-07-11): the mock's total_cost_usd stays in the raw stream — the tuple carries none of it
  assert.ok(!("costUsd" in r) && !("pricedModel" in r), "tuple must carry no currency fields");
  assert.equal(r.killed, false);
  assert.equal(r.code, 0);
  assert.ok(r.sessionRef && typeof r.sessionRef === "string");
});

test("runTurn writes the message-named output file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eng-file-"));
  const out = join(dir, "stage.md");
  try {
    const r = await run({ message: `Do it. Write the result to the ABSOLUTE path for the output: ${out}`, model: "haiku", thinking: "low", timeoutSec: 60 },
      { MOCK_CLAUDE_FILE: "# real-ish output\n" });
    assert.equal(r.json.status, "ok");
    assert.ok(existsSync(out));
    assert.match(readFileSync(out, "utf8"), /real-ish output/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runTurn (failed turn): is_error → synthesized error envelope, nonzero code", async () => {
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 }, { MOCK_CLAUDE_FAIL: "1", MOCK_CLAUDE_NOFILE: "1" });
  assert.equal(r.json.status, "error");
  assert.equal(r.code, 1);
  assert.equal(r.killed, false);
});

test("C2 GROUP KILL: the stall kill reaps a SIGTERM-ignoring grandchild (MCP-server stand-in) via SIGTERM→SIGKILL escalation", timed(async () => {
  // The 3.5-day orphan class: claude's MCP-server children survived a direct child.kill. detached:true
  // + the watchdog's group kill must take down the WHOLE tree — including a grandchild that ignores the
  // SIGTERM (only the ~5s-later group SIGKILL, shortened here, can reap it).
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  const waitDead = async (pid, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 25)); }
    return !alive(pid);
  };
  // #1847 — this arm reaped NOTHING: it asserts the fixtures are dead, which is true whenever the code
  // under test works, and leaves a SIGTERM-immune tree plus its grandchild orphaned to init on the day
  // it does not. Registered before the fixture can start; the assertions below are unchanged, because
  // whether the ESCALATION reaps them is the subject.
  const pidfile = reapPidfile(join(mkdtempSync(join(tmpdir(), "eng-tree-")), "tree.json"));
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 }, {
    CLEAROTRON_CLAUDE_PATH: join(HERE, "mock-hang-tree.mjs"),
    MOCK_TREE_PIDFILE: pidfile, MOCK_TREE_EMIT_INIT: "1",
    CLEAROTRON_STALL_MS: "300", CLEAROTRON_KILL_ESCALATE_MS: "300",
  });
  // the kill classification is UNCHANGED by the escalation (stall → timeout → lane_wedge downstream)
  assert.equal(r.killed, true);
  assert.equal(r.json.status, "timeout");
  assert.equal(r.signals?.stalled, true);
  const { pid, grandPid } = JSON.parse(readFileSync(pidfile, "utf8"));
  assert.ok(await waitDead(pid), "the SIGTERM-immune claude stand-in is dead after the group SIGKILL");
  assert.ok(await waitDead(grandPid), "the SIGTERM-ignoring grandchild (MCP-server stand-in) is dead — no orphan survives the stage");
}));

test("STALL-WATCHDOG: 120s-of-zero-tokens (mocked short) → kill → timeout → lane_wedge", timed(async () => {
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 }, { MOCK_CLAUDE_STALL: "1", CLEAROTRON_STALL_MS: "300" });
  assert.equal(r.killed, true);
  assert.equal(r.json.status, "timeout");
  assert.equal(r.usage, null);
  assert.equal(r.signals?.stalled, true);
  assert.equal(r.signals?.hardWall, undefined, "a STALL is not a hard-wall kill → no hardWall flag (else classifyWedge would mislabel it a timeout)");
  // maps into the EXISTING taxonomy unchanged:
  assert.equal(isTimeout({ killed: r.killed, code: r.code, wall: r.wall, stderr: r.stderr, timeoutSec: 60 }), true);
  assert.equal(isLaneWedge("timeout", r.usage), true);
  assert.equal(classifyWedge("timeout", r.usage, r.signals), "lane_wedge", "a stall still classifies as lane_wedge (cascades), unchanged by the fix");
}));

test("warm-resume threads --resume and the engine returns that sessionRef", async () => {
  const log = join(mkdtempSync(join(tmpdir(), "eng-log-")), "calls.jsonl");
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60, resumeRef: "sess-warm-1" }, { MOCK_CLAUDE_CALL_LOG: log });
  assert.equal(r.sessionRef, "sess-warm-1");
  const { argv } = JSON.parse(readFileSync(log, "utf8").trim());   // call-log = { argv, prompt } (prompt rides stdin)
  assert.equal(argv[argv.indexOf("--resume") + 1], "sess-warm-1");
});

test("B1 regression: result event with NO trailing newline is still parsed (flush-on-close)", async () => {
  const r = await run({ message: "x", model: "haiku", thinking: "low", timeoutSec: 60 }, { MOCK_CLAUDE_NO_NEWLINE: "1", MOCK_CLAUDE_NOFILE: "1" });
  assert.equal(r.json.status, "ok");          // would be "error" if the final (un-terminated) result line were dropped
  assert.equal(payloadText(r.json), "mock claude ok");
  assert.equal(r.code, 0);
  assert.ok(r.usage && r.usage.total > 0);
  assert.ok(r.sessionRef);
});

test("watchdog does NOT clip a healthy-but-SLOW streaming turn (the contract's main promise)", async () => {
  // gap (50ms) ≪ STALL (15000ms): the mock streams 10 deltas over ~500ms; the stall threshold is never
  // reached on a healthy turn, so a large STALL adds NO test-duration cost — it only widens the window so
  // slow child-process STARTUP under full-suite parallel load can't false-trip the watchdog (the clock
  // starts at spawn; prod's 120s default is immune, only the artificially-short test STALL was fragile).
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_SLOW_STREAM: "50", MOCK_CLAUDE_SLOW_COUNT: "10", CLEAROTRON_STALL_MS: "15000", MOCK_CLAUDE_NOFILE: "1" });
  assert.equal(r.killed, false);
  assert.equal(r.json.status, "ok");
  assert.equal(payloadText(r.json), "mock claude ok");
});

test("spawn error (ENOENT) → clean errResult, never a hang or double-resolve", async () => {
  const r = await run({ message: "x", model: "haiku", thinking: "low", timeoutSec: 60 }, { CLEAROTRON_CLAUDE_PATH: "/nonexistent/claude-xyz-does-not-exist" });
  assert.equal(r.json, null);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /spawn error/);
});

test("no hang when timeoutSec is omitted: the stall-watchdog still terminates a silent turn", timed(async () => {
  const r = await run({ message: "x", model: "haiku", thinking: "low" }, { MOCK_CLAUDE_STALL: "1", CLEAROTRON_STALL_MS: "300" });
  assert.equal(r.killed, true);
  assert.equal(r.json.status, "timeout");
}));

test("engine registry: CLEAROTRON_AI selects a provider adapter; a second adapter plugs in without touching runStage", () => {
  const saved = process.env.CLEAROTRON_AI;
  try {
    // #696 — SELECTION IS PROCESS-WIDE. This loop used to pass a stage name and read as a per-stage
    // lookup; the argument was ignored, so it asserted a routing that did not exist. It now says the
    // true thing, which is stronger: every stage of every job in this activation gets the SAME engine,
    // including the (handoff-only) comms stages.
    process.env.CLEAROTRON_AI = "anthropic-agent";
    for (const s of ["matter-frame", "register-unit:primary-sweep", "skeptic", "synthesis", "report-overview", "report-card", "notify", "notify-chat", "notify-fail-chat"])
      assert.equal(selectEngine().name, "anthropic-agent", `${s} → the anthropic adapter, like every other stage`);
    // The guard against the ignored argument coming back: a parameter this function does not honour is
    // how the false per-stage claim got written in the first place.
    assert.equal(selectEngine.length, 0,
      "selectEngine takes NO argument — a parameter it ignores is a per-stage override that does not exist");
    delete process.env.CLEAROTRON_AI;
    assert.equal(selectEngine().name, "anthropic-agent", "default = anthropic-agent");
    // FAIL-LOUD: an unregistered engine id (a removed adapter, or a typo) throws — never a silent
    // wrong-provider run.
    process.env.CLEAROTRON_AI = "gateway-bin";
    assert.throws(() => selectEngine(), /not a registered engine adapter/, "removed/unknown engine → fail loud");
    // PLUGGABILITY (the roadmap capability): a future provider adapter — e.g. openai-agent — registers and is
    // then dispatched by CLEAROTRON_AI, with the engine-agnostic runStage ladder untouched.
    const openaiStub = { name: "openai-agent", runTurn: async () => ({ code: 0, json: { status: "ok" } }) };
    registerEngine(openaiStub);
    process.env.CLEAROTRON_AI = "openai-agent";
    assert.equal(selectEngine(), openaiStub, "a registered second adapter is selected by CLEAROTRON_AI");
  } finally { if (saved === undefined) delete process.env.CLEAROTRON_AI; else process.env.CLEAROTRON_AI = saved; }
});

// ── NO-PROGRESS WATCHDOG + streamed-usage honesty (charter P1 §1, 2026-07-30) ──────────────────────
// The byte-stall resets on ANY streamed byte, so a byte-alive turn that never moves a token, never
// advances the agent loop and never touches its artifact used to burn silently to the hard wall (the
// R-round shape: a synthesis SIGKILLed at the 1500s wall whose retry did the identical work in 369s).
// These tests pin: (a) non-progress chatter dies on the no-progress ceiling, recorded as a STALL;
// (b) token movement IS progress; (c) an artifact write IS progress; (d) a token-moving kill carries the
// STREAMED usage (never null) and therefore never classifies as a 0-token lane wedge.


test("NO-PROGRESS watchdog: byte-alive junk chatter is killed on the no-progress ceiling and recorded as a stall", timed(async () => {
  const t0 = Date.now();
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_JUNK_STREAM: "40", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400" });
  assert.equal(r.killed, true, "killed well below the wall despite continuous bytes");
  assert.ok(Date.now() - t0 < 10000, "the no-progress ceiling fired, not the 60s+60s walls");
  assert.equal(r.json.status, "timeout");
  assert.equal(r.signals?.stalled, true, "a no-progress kill IS a stall");
  assert.equal(r.signals?.noProgress, true, "and carries the no-progress discriminator");
  assert.equal(r.signals?.hardWall, undefined, "never mislabelled a hard-wall 'needed more time' kill");
  assert.match(r.stderr, /no-progress watchdog/, "the stderr signature names the stall, not a slow turn");
  assert.equal(isTimeout({ killed: r.killed, code: r.code, wall: r.wall, stderr: r.stderr, timeoutSec: 60 }), true);
}));

// ── #1624 — THE CEILING SITE ITSELF, NOT THE FUNCTION IT CALLS ──────────────────────────────────────
//
// The change moved the hard ceiling off ELAPSED and onto ACTIVE time. It shipped with three arms on
// `activeElapsedMs` as a PURE FUNCTION and none on the site that calls it — so reverting the single line
// at the site (`wall >= hardMs`) left the full suite green at 7,511 tests, with `activeElapsedMs` holding
// ZERO production references and nothing noticing. Tested rule, untested use, on a kill path.
//
// It had no end-to-end arm because it had no test override: `hardMs` floors at 61 SECONDS, while both
// sibling clocks (CLEAROTRON_STALL_MS, CLEAROTRON_NO_PROGRESS_MS) have had one all along. `CLEAROTRON_HARD_MS` closes
// that, and the two arms below drive the site in BOTH directions — the one it must no longer kill, and
// the one it still must.

test("#1624 THE SITE: a mostly-TOOL-WAIT turn outlives a ceiling its ELAPSED time passed", timed(async () => {
  // The turn this change exists for. Elapsed ~1.3s against a 500ms ceiling; active time ~0.1s. On the
  // reverted line this is killed at 500ms — which is a healthy turn dying because a register lookup was
  // slow. The other two clocks are pinned wide so THIS ceiling is the only one that could fire.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_TOOL_WAIT: JSON.stringify([{ name: "RegisterLookup", ms: 1200 }]),
      CLEAROTRON_HARD_MS: "500", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "60000" });
  assert.equal(r.killed, false,
    "the hard ceiling killed a turn whose ACTIVE time never approached it — the site is measuring elapsed");
  assert.ok(r.toolWaitMs >= 1000, `the fixture waited ${r.toolWaitMs}ms on a tool — under ~1s it never `
    + "produced the elapsed-vs-active gap this arm turns on, and would pass on the reverted line too");
  assert.ok(r.wall * 1000 > 500, "elapsed never passed the ceiling, so nothing was being asked of the site");
}));

test("#1624 THE SITE, THE OTHER WAY: a GENERATING turn still hits the ceiling", timed(async () => {
  // Not a ceiling removal, asserted where it is enforced rather than on the helper. A turn with no tool
  // wait has active time equal to its wall, so it must die exactly as before.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_TOKEN_STREAM: "40", MOCK_CLAUDE_TOKEN_COUNT: "200", MOCK_CLAUDE_NOFILE: "1",
      CLEAROTRON_HARD_MS: "600", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "60000" });
  assert.equal(r.killed, true,
    "a turn generating for the whole budget outlived the hard ceiling — the wall is disabled, not relocated");
  assert.equal(r.signals?.noProgress, undefined,
    "killed by the no-progress clock, not the hard ceiling — so this arm is not testing the site at all");
}));

test("#1624 CLEAROTRON_HARD_MS is a pin, never a way to switch the wall off", timed(async () => {
  // The fail-safe direction on the override itself. A non-positive or unparseable value must fall through
  // to the computed wall; reading it as "no ceiling" would let a bad env line disable the last backstop
  // on every turn, silently, which is a worse failure than the one this whole change addresses.
  // THE TURN MUST OUTLIVE A WATCHDOG TICK, or this proves nothing. With the sibling clocks pinned wide
  // the poll interval is 1s, so a short turn finishes before the watchdog runs even once and passes
  // whatever the ceiling says — which is what the first cut of this arm did: its plant did not red.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_TOOL_WAIT: JSON.stringify([{ name: "RegisterLookup", ms: 1500 }]),
      CLEAROTRON_HARD_MS: "0", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "60000" });
  assert.ok(r.wall > 1.0, `the turn ran ${r.wall}s — under one 1s poll the watchdog never ticked, so this `
    + "arm cannot see what the ceiling did");
  assert.equal(r.killed, false, "a zero pin was read as a ceiling of zero and killed the turn");
}));

test("#1624 the ceiling site CALLS activeElapsedMs — a pure function nothing drives is not a change", () => {
  // THE ZERO-REFERENCE STATE, CAUGHT DIRECTLY. This is what the revert produced: the helper exported,
  // fully unit-tested, and called by nothing that ships. Counted against production sources only, so a
  // test file importing it can never satisfy this.
  const src = readFileSync(new URL("../engine/anthropic-agent.mjs", import.meta.url), "utf8");
  const calls = (src.match(/activeElapsedMs\(/g) ?? []).length;
  const declarations = (src.match(/export function activeElapsedMs\(/g) ?? []).length;
  assert.equal(declarations, 1, "the helper moved or was renamed — this arm is counting the wrong symbol");
  assert.ok(calls - declarations >= 1,
    "activeElapsedMs has NO caller in the engine: the hard ceiling is back on elapsed time and every unit "
    + "arm on the helper still passes, which is exactly how this shipped the first time");
});

test("NO-PROGRESS watchdog: a turn whose TOOL CALL NEVER RETURNS is still killed (#1624)", timed(async () => {
  // THE CLAIM THAT MAKES #1624 SAFE, AS AN ARM. That change moved the hard ceiling off ELAPSED and onto
  // ACTIVE time, so a turn waiting on a slow register call no longer dies for waiting. The reason that
  // is not a ceiling REMOVAL is this watchdog: only a COMPLETED tool result resets the progress clock
  // (`progress()` fires on the `user` event, never on an outstanding ask), so a call that never returns
  // cannot hold the turn open — and it is bounded TIGHTER here than the elapsed ceiling ever bounded it.
  //
  // Nothing exercised that before this arm. #1624's own file covers the tiling identity, which is
  // instrumentation, not the kill — a change to the kill path whose safety argument no test touches.
  const t0 = Date.now();
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_JUNK_STREAM: "40", MOCK_CLAUDE_TOOL_HANG: "1", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400" });
  assert.equal(r.killed, true, "a turn with an outstanding tool ask and no result ran to the wall — #1624 "
    + "removed the elapsed ceiling on the understanding that this watchdog still bounds it");
  assert.equal(r.signals?.noProgress, true, "killed, but not by the no-progress clock — so the bound #1624 relies on is not the one that fired");
  assert.ok(Date.now() - t0 < 10000, "the no-progress ceiling fired, not the 60s walls");
  // The ask MUST be outstanding, or this is the junk-chatter arm above wearing a different name.
  assert.equal(r.toolCalls >= 1 || r.toolWaitMs > 0, true,
    "the fixture never opened a tool ask, so this proves nothing about an unreturned call. "
    // #1780 — THE SPECIMEN, IN THE FAILURE MESSAGE. This arm has reddened `main` twice on exactly this
    // check and neither ambient load nor a full-suite run reproduces it here, so the next natural
    // failure has to carry its own diagnosis: firstByteMs=null means the child never spoke and the
    // 2000ms grace was exceeded; a NUMBER means it spoke and the ask never reached toolCalls.
    + `[#1780 specimen: firstByteMs=${r.firstByteMs} toolCalls=${r.toolCalls} toolWaitMs=${r.toolWaitMs} `
    + `killed=${r.killed} noProgress=${r.signals?.noProgress}]`);
}));

// ── #1692 — A STARVED SPAWN IS NOT A FINDING ABOUT THE TURN ────────────────────────────────────────
// The two arms above failed under full-suite load and passed alone, three times in one day on diffs that
// could not reach a watchdog. The cause was not the arms: every clock in this engine started at SPAWN, so
// on a loaded box they timed process startup and killed before the child had emitted a byte. #1703 fixed
// exactly this for the byte-stall in common.mjs, which this engine does not use — it spawns its own child.
//
// MOCK_CLAUDE_BOOT_MS makes that deterministic: the mock blocks before ANY output, which is what a starved
// spawn looks like from the parent's side. These arms therefore reproduce the flake with the box idle, and
// they are the reason the fix cannot silently come undone.

test("#1692 a STARVED SPAWN does not read as a no-progress stall — the kill lands after the child speaks", timed(async () => {
  // Arm-449's own configuration plus 900ms of startup. Before the fix the no-progress clock fired at 400ms,
  // DURING the boot: killed=true and signals.noProgress=true both still held, so the arm failed only on its
  // anti-vacuity check — the turn died with zero tool calls, having never been given a chance to progress.
  // ── tracker issue 2021 — THE ARM STATES THE GRACE IT NEEDS, instead of trusting the box's ───────
  //
  // The engine's rule is `progIdle >= (started ? NOPROG : max(NOPROG, GRACE))`: before the child speaks,
  // the SPAWN GRACE governs, and that IS the fix this arm exists to pin. GRACE defaults to 2000 ms
  // (engine/common.mjs). Against a 900 ms boot that is fine on an idle box and nothing on a loaded one:
  // under concurrency the child is starved past 2000 ms, is killed with `firstByteMs=null` — correctly,
  // the grace was genuinely exceeded — and the arm's ANTI-VACUITY check reds while both real assertions
  // pass. Measured by T1000 under full-suite load; 58/58 alone on the same commit.
  //
  // Pinning the grace high makes the arm measure the CODE'S BRANCH rather than this machine's speed. It
  // does not weaken anything: a regression that drops the `started ?` branch kills at NOPROG = 400 ms,
  // DURING the 900 ms boot, and the same anti-vacuity check reds exactly as it is meant to. The grace is
  // the readiness signal this sub-shape was missing — owned by the arm rather than guessed at.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_BOOT_MS: "900", MOCK_CLAUDE_JUNK_STREAM: "40", MOCK_CLAUDE_TOOL_HANG: "1",
      CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400", CLEAROTRON_SPAWN_GRACE_MS: "15000" });
  assert.equal(r.killed, true,
    "the unreturned tool ask must still be bounded — the grace covers startup, not the turn" + specimen(r));
  assert.equal(r.signals?.noProgress, true,
    "killed by some other clock, so this is not the bound #1624 relies on" + specimen(r));
  assert.ok(r.toolCalls >= 1 || r.toolWaitMs > 0,
    "killed before the child opened its tool ask: the no-progress clock is timing STARTUP, which is the "
    + "#1692 defect" + specimen(r));
}));

test("2021 the arm above still DISCRIMINATES — with the grace cut, the defect's timing reds it", timed(async () => {
  // ✕ THE CONTROL FOR THE FIX ABOVE. Pinning the grace high stops a loaded box reddening that arm; this
  // proves it did not stop the ARM working. The engine's rule is
  // `progIdle >= (started ? NOPROG : max(NOPROG, GRACE))`, so cutting GRACE below NOPROG reproduces the
  // pre-fix timing exactly: the threshold before the child speaks becomes NOPROG, 400 ms, which fires
  // DURING the 900 ms boot.
  //
  // Asserted on the ANTI-VACUITY CONDITION rather than on a thrown failure, because that is the check
  // that reds in the real thing: the turn dies having opened no tool ask and waited on nothing.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_BOOT_MS: "900", MOCK_CLAUDE_JUNK_STREAM: "40", MOCK_CLAUDE_TOOL_HANG: "1",
      CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400", CLEAROTRON_SPAWN_GRACE_MS: "100" });
  assert.equal(r.killed, true, "the turn survived a 400ms ceiling across a 900ms boot" + specimen(r));
  assert.equal(r.firstByteMs, null,
    "the child spoke inside 400ms, so this control is not reproducing a kill during boot" + specimen(r));
  assert.ok(!(r.toolCalls >= 1 || r.toolWaitMs > 0),
    "the anti-vacuity condition the arm above turns on is SATISFIED here, so that arm would pass on a "
    + "kill-during-boot — which is the defect it exists to catch" + specimen(r));
}));

test("#1692 a STARVED SPAWN is not ACTIVE time — the hard ceiling measures from the first byte", timed(async () => {
  // Arm-395's configuration plus 900ms of startup. Before the fix: killed=true, signals.hardWall, wall 1.0s,
  // toolWaitMs 0, toolCalls 0 — a 500ms ceiling spent entirely on process boot, with nothing to show for it.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_BOOT_MS: "900", MOCK_CLAUDE_TOOL_WAIT: JSON.stringify([{ name: "RegisterLookup", ms: 1200 }]),
      CLEAROTRON_HARD_MS: "500", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "60000" });
  assert.equal(r.killed, false,
    "startup was charged to the ceiling as active time — the turn died having done no work at all" + specimen(r));
  assert.ok(r.toolWaitMs >= 1000, `the fixture waited ${r.toolWaitMs}ms on a tool — under ~1s the turn never `
    + "reached the elapsed-vs-active gap this arm turns on" + specimen(r));
  assert.equal(r.toolCalls >= 1, true,
    "no tool call was ever opened, so the turn was killed during boot" + specimen(r));
}));

test("#1692 THE FAIL-SAFE: a child that never speaks AT ALL is still killed, by the byte-stall", timed(async () => {
  // The direction that matters. Excusing startup must not become "startup is unbounded": a spawn that
  // produces nothing has to die on the stall clock at max(STALL, GRACE), not wait out its boot. Pinned
  // tight so the arm proves the bound rather than the mock's own patience.
  const t0 = Date.now();
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_BOOT_MS: "9000", CLEAROTRON_STALL_MS: "300", CLEAROTRON_SPAWN_GRACE_MS: "500",
      CLEAROTRON_NO_PROGRESS_MS: "60000" });
  assert.equal(r.killed, true, "a silent spawn ran unbounded — the grace removed the backstop instead of moving it");
  assert.equal(r.signals?.stalled, true, "killed, but not by the byte-stall that is supposed to bound a silent child");
  assert.ok(Date.now() - t0 < 4000, `waited ${Date.now() - t0}ms for a 9s boot: the stall clock is not bounding startup`);
}));

test("#1692 the grace does NOT survive first contact — a tight ceiling still bites once the child has spoken", timed(async () => {
  // The vacuity check on the fix itself. If the grace widened the ceiling for the whole turn rather than
  // only until the first byte, these arms would pass by never enforcing anything. A 5s grace against a
  // 400ms no-progress pin: the kill must still land on the 400ms clock, far inside the grace.
  const t0 = Date.now();
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_JUNK_STREAM: "40", MOCK_CLAUDE_TOOL_HANG: "1", CLEAROTRON_SPAWN_GRACE_MS: "5000",
      CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400" });
  assert.equal(r.signals?.noProgress, true, "the 400ms ceiling did not fire");
  assert.ok(Date.now() - t0 < 4000,
    `the turn lived ${Date.now() - t0}ms against a 400ms ceiling — the grace is being applied after the child spoke`);
}));

test("#1780 STARTUP DEBT is not charged to the progress clock — the first byte STARTS it, not just releases it", timed(async () => {
  // The cause of #1780, and of the red on #1810's run 32680317129 (an arm above, on a diff that cannot
  // reach this engine). #1692 widened the pre-first-byte DEADLINE but never moved the clock's ORIGIN, so
  // the startup interval stayed on the meter: at the instant the grace stopped protecting the turn,
  // progIdle already WAS the whole boot, and any NOPROG shorter than startup was expired before the child
  // had been observed at all. The kill then landed on the very next tick — before the ask reached
  // toolCalls — which is exactly the anti-vacuity failure, killed and noProgress both still true.
  //
  // ZERO MARGIN BY CONSTRUCTION, which is why it read as ambient flake and why load could not reproduce
  // it on demand: the first byte is `system/init`, which is not a progress event, and the ask is the NEXT
  // event. The turn survived only when no watchdog tick happened to fall in that gap — sub-millisecond on
  // an idle box, a whole tick under full-suite concurrency. MOCK_CLAUDE_ASK_DELAY_MS makes the gap wider
  // than a tick on any box, so the race resolves the same way every time.
  //
  //   boot 1500 (+ spawn) = startup, held under the pinned 8s grace  → no startup kill either way
  //   NOPROG 1200                                                    → pollMs = min(STALL,NOPROG)/2 = 600
  //   ask held 900ms after init, junk keeping the pipe warm          → a tick falls after the first byte
  //                                                                    and before the first progress event
  //   before: progIdle at that tick = startup (~1610) > 1200         → killed with toolCalls 0
  //   after:  progIdle at that tick = ~200                           → the turn lives to open its ask
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_BOOT_MS: "1500", MOCK_CLAUDE_ASK_DELAY_MS: "900", MOCK_CLAUDE_JUNK_STREAM: "40",
      MOCK_CLAUDE_TOOL_HANG: "1", CLEAROTRON_SPAWN_GRACE_MS: "8000", CLEAROTRON_STALL_MS: "60000",
      CLEAROTRON_NO_PROGRESS_MS: "1200" });
  assert.equal(r.killed, true,
    "the unreturned ask is no longer bounded at all — rebasing this clock must MOVE the deadline, not "
    + "remove it" + specimen(r));
  assert.equal(r.signals?.noProgress, true,
    "killed by some other clock, so this proves nothing about the progress clock" + specimen(r));
  assert.equal(r.toolCalls >= 1 || r.toolWaitMs > 0, true,
    "killed before the child opened its ask: the progress clock is still counting from SPAWN, so it was "
    + "already expired the moment the grace let go of it" + specimen(r));
}));

test("#1813 an early STDERR byte does not end the grace — the protocol is on stdout, and that is what starting means", timed(async () => {
  // Found while reading the #1780 fix, filed rather than folded into it, and this is the arm it wanted.
  //
  // The child writes ONE line to stderr and then does its real startup on stdout. A node warning or a CLI
  // deprecation notice is exactly that shape. Before this fix the stderr byte set the first-output clock,
  // which ends the grace AND (since #1780) becomes the progress clock's origin — so a turn that had said
  // nothing in its protocol was measured as having started, and the no-progress ceiling then expired in
  // the middle of its boot.
  //
  //   stderr at ~0ms      ends the grace, origin := ~0
  //   NOPROG 1200         expires at ~1200ms, DURING the 3000ms stdout boot
  //   -> killed, noProgress, toolCalls 0, on a child that was starting up perfectly normally
  //
  // The grace is pinned well above the boot so the ONLY thing this arm can turn on is which stream counts
  // as having spoken. If the fix regressed to "any byte", the kill returns.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_STDERR_FIRST: "1", MOCK_CLAUDE_BOOT_MS: "3000",
      CLEAROTRON_SPAWN_GRACE_MS: "8000", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "1200" });
  assert.equal(r.killed, false,
    "killed during a normal startup because one stderr line was read as the child having spoken — the "
    + "grace ended before the protocol began" + specimen(r));
  assert.equal(r.signals?.noProgress, undefined === r.signals?.noProgress ? undefined : false,
    "the no-progress clock fired against a turn that had not yet produced any protocol output" + specimen(r));
}));

test("#1813 THE FAIL-SAFE: a child that writes ONLY stderr is still bounded, by the byte-stall", timed(async () => {
  // The direction that matters, and the reason the change above is safe. "stderr is not the protocol"
  // must not become "a chattering child runs forever": with no stdout at all the turn has still never
  // started, so the byte-stall bounds it at max(STALL, GRACE) exactly as a silent spawn is bounded.
  const t0 = Date.now();
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_STDERR_FIRST: "1", MOCK_CLAUDE_BOOT_MS: "9000",
      CLEAROTRON_STALL_MS: "300", CLEAROTRON_SPAWN_GRACE_MS: "500", CLEAROTRON_NO_PROGRESS_MS: "60000" });
  assert.equal(r.killed, true,
    "a child that only ever wrote to stderr ran unbounded — the fix removed the backstop instead of "
    + "deciding which stream starts the clocks" + specimen(r));
  assert.ok(Date.now() - t0 < 4000,
    `waited ${Date.now() - t0}ms against a 500ms grace: stderr is keeping the startup window open`);
}));

test("#1692 the grace has ONE source: this engine derives it from common.mjs, never a second literal", () => {
  // Why this issue existed. #1703 set the grace in common.mjs and stopped there; openai-agent reaches that
  // watchdog through runStreamingChild, anthropic-agent spawns directly and did not. A second copy of the
  // number here would let the two engines drift apart again, silently, exactly as they already did once.
  const src = readFileSync(join(HERE, "../engine/anthropic-agent.mjs"), "utf8");
  assert.ok(/import \{[^}]*\bspawnGraceMs\b[^}]*\} from "\.\/common\.mjs"/.test(src),
    "anthropic-agent no longer imports spawnGraceMs from common.mjs — the two engines can now disagree about the grace");
  assert.ok(/firstOutputAt/.test(src),
    "the first-output clock origin is gone: every watchdog clock is back on spawn, which is #1692 itself");
});


test("NO-PROGRESS watchdog: token movement (usage-bearing partials) IS progress — a tight ceiling must not clip it", async () => {
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_TOKEN_STREAM: "50", MOCK_CLAUDE_TOKEN_COUNT: "10", CLEAROTRON_STALL_MS: "15000", CLEAROTRON_NO_PROGRESS_MS: "5000", MOCK_CLAUDE_NOFILE: "1" });
  assert.equal(r.killed, false, "usage-bearing partials reset the progress clock");
  assert.equal(r.json.status, "ok");
});

test("NO-PROGRESS watchdog: an artifact write on the stage's own expected output IS progress", timed(async () => {
  const dir = mkdtempSync(join(tmpdir(), "eng-prog-"));
  const out = join(dir, "out.md");
  try {
    // junk chatter (never progress) + a write loop touching the expected artifact every 150ms: the
    // 1500ms ceiling must NOT fire — the observed writes are honest progress; the turn then finishes.
    // (ceiling ≫ write gap so parallel-suite timer jitter can never false-trip the watchdog here)
    const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60, progressFiles: [out] },
      { MOCK_CLAUDE_JUNK_STREAM: "40", MOCK_CLAUDE_JUNK_COUNT: "60", MOCK_CLAUDE_JUNK_WRITE_FILE: out, MOCK_CLAUDE_JUNK_WRITE_MS: "150",
        CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "1500" });
    assert.equal(r.killed, false, "artifact advance reset the progress clock");
    assert.equal(r.json.status, "ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}));

// #616 — THE STALL WINDOW WAS RACING THE MOCK IT WAS MEASURING.
//
// This ran at CLEAROTRON_STALL_MS: 300 and failed intermittently: `r.usage` null, the kill landing before
// the usage event it exists to assert had been reconstructed. #616 filed it as load-sensitive and asked
// the right question — a real race in the kill path's usage capture, or a tolerance too tight for a
// loaded box. Measured, running this test ALONE on an idle worktree:
//
//     CLEAROTRON_STALL_MS  300 → 2 of 6 green      1500 → 6 of 6      3000 → 6 of 6
//
// So it is the tolerance, and it is not even load: alone it fails MORE often, because a cold process
// gets the mock's first event out later. Nothing about the kill path is racy; the test was killing the
// stream before its own fixture had spoken.
//
// The neighbour above already carries the same lesson in its own words — "ceiling >> write gap so
// parallel-suite timer jitter can never false-trip the watchdog here". This one was never widened.
//
// The property is unchanged and still asserted: the kill DOES happen (r.killed), and it carries the
// usage the stream proved it moved. A longer ceiling gives the fixture room to emit; it does not give
// the code room to pass by not being killed.
test("streamed-usage honesty: a token-moving stall kill carries the STREAMED usage — never null, never a lane wedge", timed(async () => {
  const r = await run({ message: "x", model: "opus", thinking: "high", timeoutSec: 60 },
    { MOCK_CLAUDE_USAGE_THEN_STALL: "1", CLEAROTRON_STALL_MS: "1500" });
  assert.equal(r.killed, true);
  assert.equal(r.signals?.stalled, true);
  assert.ok(r.usage, "the kill reports what the stream PROVED it moved (the 137+usage:null class is over)");
  assert.equal(r.usage.cacheRead, 2950000, "the R-round evidence shape: millions of cacheRead on the killed attempt");
  assert.equal(r.signals?.usageStreamed, true, "marked as stream-reconstructed, not a result-event figure");
  // classification honesty: tokens moved ⇒ NOT a never-admitted lane wedge — it stays a timeout (stall),
  // so the chain does not burn a pointless provider cascade on a turn that was demonstrably admitted.
  assert.equal(isLaneWedge("timeout", r.usage), false);
  assert.equal(classifyWedge("timeout", r.usage, r.signals), "timeout");
}));

test("startup-class death: a CLI exit with NO stream events carries the noStreamEvents signal + a named stderr diagnosis", async () => {
  // The 3× register-digest code=1 zero-token shape: claude died before emitting a single stream event.
  // `sh -c 'exit 7'` stands in for the CLI failing at startup (bad arg/auth/MCP). The tuple must name
  // the startup class so the journal's stderrTail is never read as a mid-turn provider fault.
  //
  // #820 — the stand-in is BUILT, not borrowed from the filesystem. This read `/bin/false` and the
  // comment above already described something else, which is the tell: /bin/false is GNU coreutils and
  // sits at /usr/bin/false on macOS, where /bin holds only the base utilities. Spawning a path that is
  // not there raises ENOENT, anthropic-agent.mjs answers on its `child.on("error")` branch, and
  // errResult() carries NO `signals` key at all — so the assertion below read `undefined` and macOS CI
  // failed it. The engine was right both times: a missing binary is not a CLI that died at startup, and
  // the two must not produce the same tuple. It was the FIXTURE that named a Linux-only path, so the
  // test was measuring the spawn-error branch on macOS and the startup branch on Linux while claiming
  // to measure one thing. A written script exits 7 without emitting a stream event on every platform.
  const r = await run({ message: "x", model: "haiku", thinking: "low", timeoutSec: 60 },
    { CLEAROTRON_CLAUDE_PATH: failingBin(7) });
  assert.notEqual(r.code, 0);
  assert.equal(r.killed, false);
  assert.equal(r.usage, null, "zero movement stays null — the wedge/startup signature");
  assert.equal(r.signals?.noStreamEvents, true);
  assert.match(r.stderr, /exited without emitting any stream event.*startup-class/s);
});

test("INTEGRATION: runStage on CLEAROTRON_AI=anthropic-agent writes file + returns ok via the real retry ladder", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eng-rs-"));
  const out = join(dir, "out.md");
  process.env.CLEAROTRON_AI = "anthropic-agent";
  pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", MOCK);
  try {
    const r = await runStage("teststage", {
      agent: "clawdi", sessionKey: "prelim-test-abc-matterframe",
      message: `Do the task. Write to the ABSOLUTE path for the stage output: ${out}`,
      model: "opus", thinking: "medium", timeoutSec: 60, expectFile: out, validate: () => ({ ok: true }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 1);
    assert.ok(existsSync(out));
  } finally { delete process.env.CLEAROTRON_AI; pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", undefined); rmSync(dir, { recursive: true, force: true }); }
});

// ── THINKING GAUGE (signals.thought) ────────────────────────────────────────────────────────────────
// `--effort` is a disposition, not a guarantee (a live probe at --effort high on a trivial prompt
// produced no thinking block at all), so the stage tier records only what was REQUESTED. These pin what
// actually HAPPENED. The fixture's thinking block carries EMPTY text + a real signature — the production
// shape under thinking.display:"omitted" — so an implementation that reads the text fails here.
test("thinking gauge: a thinking block on the stream sets signals.thought = true", async () => {
  const r = await run({ message: "write /tmp/x.md", model: "opus", thinking: "high", timeoutSec: 30 }, { MOCK_CLAUDE_THINK: "1" });
  assert.equal(r.signals.thought, true, "engaged thinking must be detected via block presence + signature, NOT the (empty) text field");
});

test("thinking gauge: no thinking block → thought is FALSE, and present rather than omitted", async () => {
  const r = await run({ message: "write /tmp/x.md", model: "opus", thinking: "high", timeoutSec: 30 });
  assert.equal(r.signals.thought, false, "a turn that did not think must record false");
  assert.ok("thought" in r.signals, "thought must be written unconditionally — an omitted key is ambiguous with a pre-gauge record, which is the exact defect the gauge replaces");
});

test("thinking gauge: requesting high effort does not by itself imply thinking engaged", async () => {
  const r = await run({ message: "write /tmp/x.md", model: "opus", thinking: "high", timeoutSec: 30 });
  assert.equal(effortFor("high"), "high", "the request really was high…");
  assert.equal(r.signals.thought, false, "…and it still did not think — this is why the tier is not a gauge");
});

// ── READS GAUGE (tuple.reads — AD-4, 2026-07-30 addendum) ───────────────────────────────────────────
// Same doctrine as the thinking gauge: the prompt says what the turn was OFFERED; `reads` records what it
// actually OPENED. Three-valued by contract: [paths] / [] (ran, read nothing — a recorded fact) / key
// absent on an engine that cannot observe (→ the gateway journals null).

test("reads gauge: Read tool_use blocks on the stream land in tuple.reads, deduped", async () => {
  const paths = ["/ws/skills/matter-frame/SKILL.md", "/run/matter-context.md", "/ws/skills/matter-frame/SKILL.md"];
  const r = await run({ message: "write /tmp/x.md", model: "opus", thinking: "medium", timeoutSec: 30 },
    { MOCK_CLAUDE_READS: JSON.stringify(paths) });
  assert.deepEqual(r.reads, ["/ws/skills/matter-frame/SKILL.md", "/run/matter-context.md"],
    "each Read's file_path recorded once, in first-seen order");
});

test("reads gauge: a turn with no Read calls records [] — present, never omitted", async () => {
  const r = await run({ message: "write /tmp/x.md", model: "opus", thinking: "medium", timeoutSec: 30 });
  assert.deepEqual(r.reads, [], "'read nothing' is a recorded fact");
  assert.ok(Array.isArray(r.reads), "reads is unconditional on this engine — an omitted key would be ambiguous with 'cannot observe'");
  assert.equal(r.readsTruncated, false, "…and the list is complete — 'complete', not 'not recorded'");
});

// ── post-merge audit of #172 ──────────────────────────────────────────────────────────────────────────
// The gauge is capped at 500 distinct paths so a pathological turn cannot bloat telemetry. Capping is fine;
// capping SILENTLY is the same defect the package retires everywhere else — a truncated list reads exactly
// like a complete one, and every consumer that derives "this file was not opened" from it derives a lie.
test("AUDIT #172/5 — the 500-path reads cap is RECORDED, so a capped list cannot read as a complete one", async () => {
  const many = Array.from({ length: 505 }, (_, i) => `/run/doc-${i}.md`);
  const r = await run({ message: "write /tmp/x.md", model: "opus", thinking: "medium", timeoutSec: 30 },
    { MOCK_CLAUDE_READS: JSON.stringify(many) });
  assert.equal(r.reads.length, 500, "the cap still holds — telemetry stays bounded");
  assert.equal(r.readsTruncated, true, "…and it SAYS it holds: 5 further distinct paths were dropped");

  // A REPEAT of an already-recorded path at the cap is not truncation — nothing was lost.
  const atCapWithRepeats = [...Array.from({ length: 500 }, (_, i) => `/run/doc-${i}.md`), "/run/doc-0.md", "/run/doc-1.md"];
  const r2 = await run({ message: "write /tmp/x.md", model: "opus", thinking: "medium", timeoutSec: 30 },
    { MOCK_CLAUDE_READS: JSON.stringify(atCapWithRepeats) });
  assert.equal(r2.reads.length, 500);
  assert.equal(r2.readsTruncated, false, "exactly at the cap, dropping only duplicates ⇒ the list IS complete");
});

// The gauge loops run on every stdout chunk AND from settle(). `for (const b of ev.message?.content ?? [])`
// throws TypeError on a TRUTHY non-iterable — and the throw from settle() lands after `settled = true` and
// clearInterval(watchdog) but before resolve(): driver/ registers no uncaughtException handler, so the
// process dies mid-stage with no fail classification and no recovery park, or the turn never settles with
// its watchdog already cleared. Low likelihood, unattended overnight blast radius.
test("AUDIT #172/3 — a truthy NON-ITERABLE message.content cannot throw out of the stream parser (streamed or flushed)", async () => {
  const r = await run({ message: "write /tmp/x.md", model: "opus", thinking: "medium", timeoutSec: 30 },
    { MOCK_CLAUDE_BAD_CONTENT: "1" });
  assert.equal(r.code, 0, "the turn settles cleanly — no throw from the 'data' listener, none from settle()");
  assert.equal(r.json?.status, "ok", "…and the result event emitted before the malformed final line is still parsed");
  assert.deepEqual(r.reads, [], "the malformed events contribute nothing — they are skipped, not fatal");
  assert.equal(r.signals?.thought, false, "the thinking gauge's own guard is likewise unmoved");
});

// ── #1780 — THE BIT THAT DISCRIMINATES THE CAUSE, PINNED ────────────────────────────────────────────
// `firstByteMs` is RECORDING ONLY: nothing in the engine branches on it. A recording field is protected
// by a test or by nothing — deleting it left an earlier one reporting 7103/7101/0/2 and nobody noticed —
// so these two arms exist to make its removal red something. They are also the known-answer cases for
// the instrument itself: if it cannot tell a child that spoke from one that never did, it cannot
// diagnose the failure it was added for.

test("#1780 a child that SPEAKS records when it first spoke", timed(async () => {
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_JUNK_STREAM: "40", MOCK_CLAUDE_TOOL_HANG: "1",
      CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400" });
  assert.equal(typeof r.firstByteMs, "number",
    "the turn produced output and firstByteMs is not a number — the instrument cannot tell a starved "
    + "spawn from a talking child, which is the only thing it was added to do");
  assert.ok(r.firstByteMs >= 0, `firstByteMs was ${r.firstByteMs}`);
}));

test("#1780 a child that NEVER speaks records null, and the stderr says so in words", timed(async () => {
  // A 9s boot against a 300ms stall clock and a 500ms grace: killed by the byte-stall having emitted
  // nothing. This is the state that, if it were happening on CI, would explain the anti-vacuity red.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_BOOT_MS: "9000", CLEAROTRON_STALL_MS: "300", CLEAROTRON_SPAWN_GRACE_MS: "500",
      CLEAROTRON_NO_PROGRESS_MS: "60000" });
  assert.equal(r.killed, true, "the silent child was not killed at all — a different arm is broken");
  assert.equal(r.firstByteMs, null,
    `a child that emitted nothing reported firstByteMs=${r.firstByteMs}. Then the field cannot mean `
    + "'never spoke', and the specimen it exists to provide would be read the wrong way round.");
}));

test("#1780 the no-progress diagnostic carries the specimen, so a CI artifact needs no re-run", timed(async () => {
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_JUNK_STREAM: "40", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400" });
  assert.equal(r.signals?.noProgress, true, "this fixture no longer produces a no-progress kill");
  assert.match(String(r.stderr ?? ""), /no-progress specimen: firstByteMs=/,
    "the no-progress kill printed no specimen. The whole point is that the artifact of a failure "
    + "nobody can reproduce still says which cause it was — a diagnosis that needs a re-run is no "
    + "diagnosis, because the broken state expires.");
  assert.match(String(r.stderr ?? ""), /toolCalls=\d+ noProgressMs=\d+ graceMs=\d+/,
    "the specimen dropped the clocks it must be read against — firstByteMs alone cannot say whether "
    + "the grace was exceeded");
}));

test("#1780 a STARVED SPAWN's specimen says NEVER — the branch that routes the diagnosis", timed(async () => {
  // FOUND BY A PLANT, not by me: the specimen arm above uses a fixture that SPEAKS, so the `NEVER`
  // branch was never executed by any arm. Deleting it left 53/53 green (verified with
  // docs/instruments/mutate.mjs, sha e5236c189d3a → 87fbabb2efb2), and a future starved-spawn specimen
  // would then print a number where it means "never spoke" — routing the reader to the WRONG cause,
  // which is the one job this instrument has.
  //
  // AND THIS IS THE CI SHAPE, not a synthetic corner. With the child silent, the no-progress threshold
  // is max(NOPROG, GRACE) and the stall threshold is max(STALL, GRACE): 500ms against 60s here, so the
  // NO-PROGRESS clock fires first, before first byte — exactly the state that reddens arm 449 on CI.
  const r = await run({ message: "x", model: "sonnet", thinking: "low", timeoutSec: 60 },
    { MOCK_CLAUDE_BOOT_MS: "9000", CLEAROTRON_STALL_MS: "60000", CLEAROTRON_NO_PROGRESS_MS: "400",
      CLEAROTRON_SPAWN_GRACE_MS: "500" });
  assert.equal(r.signals?.noProgress, true,
    "this fixture stopped producing a no-progress kill before first byte — the arm no longer reaches "
    + "the branch it exists to cover");
  assert.equal(r.firstByteMs, null, "the child spoke after all; the fixture is not starving it");
  assert.match(String(r.stderr ?? ""), /no-progress specimen: firstByteMs=NEVER\b/,
    "the specimen printed a NUMBER for a child that never spoke. A reader following the documented "
    + "rule would then diagnose 'it spoke and the ask never landed' on a genuine starved spawn.");
  assert.match(String(r.stderr ?? ""), /firstByteMs=NEVER toolCalls=0\b/,
    "a starved spawn must report zero tool calls beside the NEVER, or the pair does not tell a whole story");
}));

test("#1780 every arm that budgets in milliseconds carries the specimen in its message", () => {
  // THE CLASS, NOT THE TWO SITES. #1782 wired the bit into arm 449 and a real failure landed in its
  // siblings, which carried none of it. Widening those two by hand would repeat the same mistake one
  // arm further out, so this decides the population mechanically: any arm whose fixture pins a clock is
  // an arm that can fail for timing reasons, and every one of them must say what it saw.
  //
  // COMMENTS ARE STRIPPED FIRST. #1795 was an assertion satisfied by the prose explaining it; a guard
  // that reads its own subject's source has to remove the prose or it can be argued into passing.
  const src = readFileSync(new URL("engine.anthropic.test.mjs", import.meta.url), "utf8")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

  // A TIGHT clock, not merely a named one. An arm setting `CLEAROTRON_STALL_MS: "60000"` is switching that
  // clock OFF so it cannot interfere; it is not budgeting in milliseconds and a slow box will not move
  // it. What makes an arm timing-sensitive is a SMALL pin — or a simulated boot, which spends the
  // budget before the turn starts. Counting every arm that merely names a clock made the population 19
  // and would have buried the real ones.
  const TIGHT = /(?:CLEAROTRON_NO_PROGRESS_MS|CLEAROTRON_HARD_MS|CLEAROTRON_STALL_MS|CLEAROTRON_SPAWN_GRACE_MS):\s*"(\d{1,4})"/g;
  const isTimed = (b) => {
    if (/MOCK_CLAUDE_BOOT_MS/.test(b)) return true;
    for (const m of b.matchAll(TIGHT)) if (Number(m[1]) < 5000) return true;
    return false;
  };
  const blocks = src.split(/\ntest\(/).slice(1).map((b) => b.split(/\n\}\)*;/)[0]);
  assert.ok(blocks.length > 20, `only ${blocks.length} arms parsed out of this file — the splitter is wrong, `
    + "and a guard that finds nothing to check passes by finding nothing");

  const timedArms = blocks.filter((b) => isTimed(b) && /await run\(/.test(b));
  assert.ok(timedArms.length >= 8,
    `only ${timedArms.length} timing arms found; this file has had ten or more since #1692. The detector is `
    + "wrong, not the file.");

  const naked = timedArms.filter((b) => !/,\s*timed\(async/.test(b))
    .map((b) => (b.match(/^"((?:[^"\\]|\\.){0,70})/) ?? [, "?"])[1]);
  assert.deepEqual(naked, [],
    `${naked.length} clock-pinning arm(s) are plain \`test\`, so a failure there arrives undiagnosable and `
    + `the next CI red is another wasted specimen. Declare them \`timedTest\`:\n  ${naked.join("\n  ")}`);
});
