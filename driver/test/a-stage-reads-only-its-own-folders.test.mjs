// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE READS ONLY ITS OWN FOLDERS, ON BOTH ENGINES.
//
// A search stage reads pages from the open web, and a page can carry text written to steer the model.
// Until now a stage could be steered into reading any file its account can read: the install's settings
// file, which holds the key that signs access keys, and the engine program's own sign-in. On Claude the
// file tools opened any path; on Codex the sandbox confined writing and let commands read the whole disk.
//
// Claude's file tools now refuse any path outside the turn's working directories, and Codex, with its
// sandbox on, runs every command under a permission profile that reads only the instruction trees, the run
// folder and the temp folders. These arms hold both, on every stage, fresh and resumed, and hold a retry to
// the run folder its stage was dispatched with, which the fence would otherwise take from it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, PER_AXIS_STAGES, PER_CHUNK_STAGES } from "../engine/mcp/gather-config.mjs";
import { buildClaudeArgs, READ_FENCE } from "../engine/anthropic-agent.mjs";
import { probeToolConfig } from "../engine/probe.mjs";
import { FENCE_PROFILE } from "../engine/mcp/codex-config.mjs";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SKILLS = join(ROOT, "driver", "skills");

/** Every `--settings` value on one argv, parsed. */
function settingsOf(args) {
  const out = [];
  args.forEach((a, i) => { if (a === "--settings") out.push(JSON.parse(args[i + 1])); });
  return out;
}

/** The gateway's resolution for one stage name, with the instruction tree it grants every stage. */
function argvFor(stage, { resumeRef = null } = {}) {
  const groups = toolGroupsForStage(stage);
  let mcpConfig, allowedTools;
  if (groups.length) {
    // A register stage resolves its server through the provider the test harness declares before any import.
    const cfg = buildGatherMcpConfig(groups, { sessionKey: "k", agent: "a", runDir: "/RUN" });
    mcpConfig = cfg ? JSON.stringify(cfg) : undefined;
    allowedTools = allowedToolsFor(groups);
  }
  return buildClaudeArgs({ message: "x /RUN/in.md", model: "opus", thinking: "low", cwd: "/tmp", skillsDir: SKILLS, runDir: "/RUN", mcpConfig, allowedTools, resumeRef }).args;
}

test("claude: the fence is the vendor's own setting, switched on", () => {
  assert.deepEqual({ ...READ_FENCE }, { blockReadsOutsideWorkingDirectories: true });
});

test("claude: every stage's turn carries the read fence, fresh and resumed, beside its write boundary", () => {
  const names = [...new Set([
    ...Object.keys(STAGES), ...Object.keys(KO_STAGES),
    ...[...PER_AXIS_STAGES].map((s) => `${s}:primary-sweep`), ...[...PER_CHUNK_STAGES].map((s) => `${s}#1`),
  ])];
  assert.ok(names.length >= 19, `only ${names.length} stage names to check`);
  const lacking = [];
  for (const stage of names) {
    for (const resumeRef of [null, "sess-1"]) {
      const s = settingsOf(argvFor(stage, { resumeRef }));
      const label = `${stage}${resumeRef ? " (resumed)" : ""}`;
      if (s.length !== 1) { lacking.push(`${label}: ${s.length} --settings`); continue; }
      if (s[0].permissions?.blockReadsOutsideWorkingDirectories !== true) lacking.push(`${label}: no read fence`);
      // The instruction tree is granted to every stage, so every stage has a boundary to keep.
      if (!s[0].hooks?.PreToolUse?.length) lacking.push(`${label}: the write boundary's hook is gone`);
    }
  }
  assert.deepEqual(lacking, [], "stage turns without the fence or without their write boundary");
});

test("claude: the engine probe's turn carries the read fence, so the check runs as a search does", () => {
  const { args } = buildClaudeArgs({ message: "x", model: "haiku", thinking: "low", runDir: "/PROBE", ...probeToolConfig(["a", "b", "c"]) });
  const s = settingsOf(args);
  assert.equal(s.length, 1);
  assert.equal(s[0].permissions?.blockReadsOutsideWorkingDirectories, true);
});

test("claude: a retried stage keeps the run folder its dispatch was granted, though the retry names its files by relative path", async () => {
  const { warmPatchMessage } = await import("../gateway.mjs");
  // Shaped as a real run folder is: the retry shortens every path to the part from `clearance-search/` on.
  const runDir = "/work/studio/clearance-search/tmp0001-project/2026-09-23-run";
  const dispatch = `Read ${runDir}/matter-context.md, then record the frame.`;
  const retry = warmPatchMessage("missing_file", [`${runDir}/matter-frame.md`]);
  // The case is real only if the retry itself names nothing under the run folder.
  assert.ok(!retry.includes(`${runDir}/`), `the retry now names the run folder, so this arm checks nothing: ${retry}`);
  const dirs = (args) => args.reduce((acc, a, i) => (a === "--add-dir" ? [...acc, args[i + 1]] : acc), []);
  const base = { message: retry, model: "opus", thinking: "low", resumeRef: "sess-1", runDir, seatWrites: false };
  // Judged on its own text, a stage that writes nothing itself loses the folder on the retry…
  assert.ok(!dirs(buildClaudeArgs(base).args).includes(runDir), "the gap this closes is not there to close");
  // …and judged on its stage's dispatch, as the gateway now passes it, it keeps it.
  assert.ok(dirs(buildClaudeArgs({ ...base, grantDispatch: dispatch }).args).includes(runDir));
});

test("the gateway hands the stage turn its stage's own dispatch for the grant", () => {
  const src = readFileSync(join(ROOT, "driver", "gateway.mjs"), "utf8");
  assert.match(src, /engine\.runTurn\(\{ agent, sessionKey: key, message: effMessage, grantDispatch: base,/,
    "the stage turn no longer passes its dispatch, so a retry judges the grant on the retry's own text");
});

// ── CODEX, THROUGH ITS ADAPTER ───────────────────────────────────────────────────────────────────────
async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  try { return await fn(); }
  finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
}

/** One codex turn through the real adapter against the stand-in, and the argv and config it was given. */
async function codexTurn(bypass) {
  const { openaiAgentEngine } = await import("../engine/openai-agent.mjs");
  const dir = mkdtempSync(join(tmpdir(), "stage-fence-codex-"));
  const runDir = join(dir, "run"); mkdirSync(runDir);
  const trees = [join(dir, "instructions-overlay"), SKILLS];
  const log = join(dir, "calls.jsonl");
  try {
    const t = await withEnv({ CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), MOCK_CODEX_CALL_LOG: log,
      CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-test", CLEAROTRON_CODEX_SANDBOX_BYPASS: bypass },
    () => openaiAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60, runDir, skillsDir: SKILLS, skillsGrantRoots: trees }));
    assert.equal(t.code, 0, t.stderr);
    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop());
    return { ...call, runDir, trees };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("codex, sandbox on: the config selects the stage's profile, and no --sandbox rides the command line to switch it off", async () => {
  const { argv, configToml, runDir, trees } = await codexTurn(undefined);
  assert.ok(!argv.includes("--sandbox"), `--sandbox makes codex ignore the profile: ${argv.join(" ")}`);
  assert.ok(!argv.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!/^\s*sandbox_mode\s*=/m.test(configToml), "sandbox_mode in the config makes codex ignore the profile");
  const top = configToml.slice(0, configToml.indexOf("\n["));
  assert.match(top, new RegExp(`^default_permissions = "${FENCE_PROFILE}"$`, "m"), `the profile is not selected at the top level:\n${top}`);
  const profile = configToml.slice(configToml.indexOf(`[permissions.${FENCE_PROFILE}.filesystem]`));
  const rules = Object.fromEntries([...profile.matchAll(/^("[^"]+") = "(read|write|deny)"$/gm)].map((m) => [JSON.parse(m[1]), m[2]]));
  // The stand-in is a loose program, so its own folder is the program root the profile reads.
  assert.deepEqual(rules, {
    ":minimal": "read", ":tmpdir": "write", ":slash_tmp": "write",
    [trees[0]]: "read", [trees[1]]: "read", [dirname(realpathSync(join(HERE, "mock-codex.mjs")))]: "read", [runDir]: "write", ".": "write",
  }, "the profile grants something other than the instruction trees, codex's own programs, the run folder, the working folder and the temp folders");
  assert.match(profile, new RegExp(`^\\[permissions\\.${FENCE_PROFILE}\\.filesystem\\.":workspace_roots"\\]\\n"\\." = "write"$`, "m"));
});

test("codex, with the bypass: no profile is written, and the command line is the bypass as before", async () => {
  const { argv, configToml } = await codexTurn("1");
  assert.ok(argv.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!argv.includes("--sandbox"));
  assert.ok(!configToml.includes("default_permissions") && !configToml.includes("[permissions."),
    "a profile under the bypass enforces nothing and says it does");
});

test("codex: the profile reads codex's own programs, which its sandbox runs every command through, and never the home", async () => {
  const { codexProgramRoot } = await import("../engine/openai-agent.mjs");
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "codex-program-root-")));
  try {
    // An npm install: the launcher in @openai/codex, the helper in a platform package nested inside it or beside it.
    const pkg = join(dir, "lib", "node_modules", "@openai", "codex", "bin");
    mkdirSync(pkg, { recursive: true }); writeFileSync(join(pkg, "codex.js"), "");
    mkdirSync(join(dir, "bin")); symlinkSync(join(pkg, "codex.js"), join(dir, "bin", "codex"));
    assert.equal(codexProgramRoot(join(dir, "bin", "codex"), "/elsewhere"), join(dir, "lib", "node_modules", "@openai"));
    // A loose program: its folder.
    mkdirSync(join(dir, "tools")); writeFileSync(join(dir, "tools", "codex"), "");
    assert.equal(codexProgramRoot(join(dir, "tools", "codex"), "/elsewhere"), join(dir, "tools"));
    // …unless that folder is the home, or holds it: the fence would read the whole home back.
    assert.equal(codexProgramRoot(join(dir, "tools", "codex"), join(dir, "tools")), null);
    assert.equal(codexProgramRoot(join(dir, "tools", "codex"), join(dir, "tools", "someone")), null);
    // Nothing to resolve: nothing granted.
    assert.equal(codexProgramRoot(join(dir, "missing")), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
