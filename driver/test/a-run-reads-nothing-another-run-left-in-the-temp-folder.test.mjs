// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN READS NOTHING ANOTHER RUN LEFT IN THE TEMP FOLDER.
//
// A Codex stage's commands used the account's temp folder and `/tmp`, which every stage of every run on the
// machine shares, and the stage's profile granted both. In a test run of a crowded matter, 2026-10-27, the
// writer's commands found and read the working notes, a state file with ratings and a families file that an
// earlier run's writer had left in `/tmp` the day before. Measured on codex 0.162.0 with that profile: a
// command read a file planted in `/tmp` and wrote another beside it.
//
// Each Codex home now has one working folder of its own, beside it. The turn's TMPDIR, TMP and TEMP name it,
// with the sandbox on or off, and the profile grants it in place of the shared folders. A stage's ladder keeps
// the folder across its turns, and it goes with the home. Measured on codex 0.162.0 with this profile: `/tmp`
// does not exist for the command, and `mktemp`, a heredoc and Python's tempfile all land in the working folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FENCE_PROFILE } from "../engine/mcp/codex-config.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = join(HERE, "..", "skills");

async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  try { return await fn(); }
  finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
}

/** Codex turns through the real adapter against the stand-in, and what each was given. */
async function codexTurns(t, { bypass, codexHome = null, turns = 1, between = null } = {}) {
  const { openaiAgentEngine } = await import("../engine/openai-agent.mjs");
  const dir = mkdtempSync(join(tmpdir(), "own-temp-folder-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runDir = join(dir, "run"); mkdirSync(runDir);
  const log = join(dir, "calls.jsonl");
  await withEnv({ CLEAROTRON_CODEX_PATH: join(HERE, "mock-codex.mjs"), MOCK_CODEX_CALL_LOG: log,
    CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-test", CLEAROTRON_CODEX_SANDBOX_BYPASS: bypass }, async () => {
    for (let i = 0; i < turns; i++) {
      const r = await openaiAgentEngine.runTurn({ message: "reply ok", model: "haiku", thinking: "low", timeoutSec: 60, runDir, skillsDir: SKILLS, codexHome });
      assert.equal(r.code, 0, r.stderr);
      if (between && i < turns - 1) between(JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop()));
    }
  });
  return readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
}
const rulesOf = (configToml) => {
  const profile = configToml.slice(configToml.indexOf(`[permissions.${FENCE_PROFILE}.filesystem]`));
  return Object.fromEntries([...profile.matchAll(/^("[^"]+") = "(read|write|deny)"$/gm)].map((m) => [JSON.parse(m[1]), m[2]]));
};

test("codex, sandbox on: the profile grants no shared temp folder, and grants the home's own working folder", async (t) => {
  const [call] = await codexTurns(t, { bypass: undefined });
  const rules = rulesOf(call.configToml);
  assert.equal(rules[":slash_tmp"], undefined, "the profile still grants /tmp, which every run on the machine shares");
  assert.equal(rules[":tmpdir"], undefined, "the profile still grants the account's temp folder, which every run shares");
  const own = `${call.codexHome}.work`;
  assert.equal(rules[own], "write", `the profile does not grant the home's working folder:\n${call.configToml}`);
  assert.ok(!own.startsWith(realpathSync(tmpdir()) + sep) && !own.startsWith(`${sep}tmp${sep}`), `the working folder sits in a shared temp folder: ${own}`);
});

test("the turn's commands are handed the working folder as TMPDIR, TMP and TEMP, with the sandbox on and with the bypass", async (t) => {
  for (const bypass of [undefined, "1"]) {
    const [call] = await codexTurns(t, { bypass });
    const own = `${call.codexHome}.work`;
    assert.deepEqual(call.tempFolders, { TMPDIR: own, TMP: own, TEMP: own }, `bypass=${bypass}: a temp-folder name points somewhere shared`);
  }
});

test("two turns get two working folders, and a turn's own home takes its folder with it", async (t) => {
  const [a] = await codexTurns(t, { bypass: undefined });
  const [b] = await codexTurns(t, { bypass: undefined });
  assert.notEqual(a.tempFolders.TMPDIR, b.tempFolders.TMPDIR, "two turns share one temp folder");
  for (const c of [a, b]) assert.equal(existsSync(c.tempFolders.TMPDIR), false, `a turn left its working folder behind: ${c.tempFolders.TMPDIR}`);
});

test("a stage's ladder keeps one working folder across its turns, and it goes when the ladder settles", async (t) => {
  const { makeCodexHome, releaseCodexHome, workFolderOf } = await import("../engine/openai-agent.mjs");
  const home = makeCodexHome("stage-own-temp-folder-");
  t.after(() => releaseCodexHome(home));
  const calls = await codexTurns(t, { bypass: undefined, codexHome: home, turns: 2,
    between: (c) => writeFileSync(join(c.tempFolders.TMPDIR, "notes.md"), "kept between attempts\n") });
  assert.equal(calls[0].tempFolders.TMPDIR, workFolderOf(home));
  assert.equal(calls[1].tempFolders.TMPDIR, workFolderOf(home), "a resumed turn of the same ladder was handed another folder");
  assert.equal(readFileSync(join(workFolderOf(home), "notes.md"), "utf8"), "kept between attempts\n", "the ladder lost its notes between turns");
  if (process.platform !== "win32") assert.equal(statSync(workFolderOf(home)).mode & 0o777, 0o700, "another account on the machine can open the working folder");
  releaseCodexHome(home);
  assert.equal(existsSync(workFolderOf(home)), false, "the working folder outlived its home");
});

test("a working folder whose maker has ended is swept with its home; a live maker's is left alone", async (t) => {
  const { sweepStaleCodexHomes } = await import("../engine/openai-agent.mjs");
  const root = mkdtempSync(join(tmpdir(), "own-temp-sweep-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const names = ["stage-writer-p11-abcdef", "stage-writer-p11-abcdef.work", "turn-p22-ghijkl", "turn-p22-ghijkl.work"];
  for (const n of names) mkdirSync(join(root, n));
  const removed = sweepStaleCodexHomes(root, { alive: (pid) => pid === 22 });
  assert.deepEqual(removed.sort(), ["stage-writer-p11-abcdef", "stage-writer-p11-abcdef.work"]);
  assert.ok(existsSync(join(root, "turn-p22-ghijkl.work")), "a live maker's working folder was swept");
});
