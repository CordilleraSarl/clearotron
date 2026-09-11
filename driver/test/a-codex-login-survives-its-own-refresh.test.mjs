// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CODEX LOGIN SURVIVES ITS OWN REFRESH.
//
// codex rotates the refresh token when it refreshes, and the provider accepts each one once. Each stage
// used to get a copy of the master login in a home deleted with its ladder. The rotated token went with
// the home, and the master kept a spent one. A codex install then ran one or two searches, and every
// later stage failed in seconds with a bare exit code while `codex login status` still said signed in.
//
// The mock provider below keeps a ledger of consumed refresh tokens and refuses a spent one, and it
// writes the rotated login either through the link or as a new file renamed over it. Real codex's write
// style decides which of those two paths carries the fix, so both are driven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runStage } from "../gateway.mjs";
import { returnAuth } from "../engine/openai-agent.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = join(HERE, "mock-codex.mjs");

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => { try { return await fn(); } finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } } })();
}

const login = (refresh) => JSON.stringify({ OPENAI_API_KEY: null,
  tokens: { id_token: "id", access_token: "at", refresh_token: refresh, account_id: "acct" }, last_refresh: "2026-09-01T00:00:00Z" });
const refreshOf = (path) => JSON.parse(readFileSync(path, "utf8")).tokens.refresh_token;

/** One whole stage ladder on the subscription lane, one attempt, so a refusal is not retried away. */
function ladder(dir, env, n) {
  const out = join(dir, `ctx-${n}.md`);
  return withEnv({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "subscription",
    CODEX_API_KEY: "", CLEAROTRON_RETRY_BACKOFF_MS: "0", MOCK_CODEX_FILE: "# ctx\n", ...env },
  () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: `login-${n}-${process.pid}`,
    runDir: dir, expectFile: out, maxRetries: 0 }));
}

function masterIn(dir) {
  const master = join(dir, "codex", "auth.json");
  mkdirSync(dirname(master), { recursive: true });
  writeFileSync(master, login("r0"), { mode: 0o600 });
  return master;
}

for (const write of ["inplace", "rename"]) {
  test(`a login codex rotates inside a stage reaches the master, and the next stage signs in (${write})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-login-"));
    try {
      const master = masterIn(dir);
      const env = { CLEAROTRON_OPENAI_AUTH_FILE: master, MOCK_CODEX_AUTH_LEDGER: join(dir, "spent"), MOCK_CODEX_AUTH_WRITE: write };
      const first = await ladder(dir, env, 1);
      assert.equal(first.ok, true, `the first stage failed, so nothing below is about a refresh: ${first.fail}`);
      assert.equal(refreshOf(master), "r0+", "the login codex rotated inside the stage did not reach the master");
      assert.equal(statSync(master).mode & 0o777, 0o600, "the master login is no longer private to its owner");
      assert.ok(statSync(master).isFile(), "the master must stay a file");
      const second = await ladder(dir, env, 2);
      assert.equal(second.ok, true, `THE REPORTED CASE: the next stage was refused its refresh (${second.fail})`);
      assert.equal(refreshOf(master), "r0++", "and its rotation reached the master too");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("THE CONTROL: the stand-in provider refuses a refresh token it has already consumed", () => {
  // The old shape, driven at the mock directly: two stage homes, each a COPY of the same master. If the
  // second were not refused, the arms above would pass on a provider that cannot say no.
  const dir = mkdtempSync(join(tmpdir(), "codex-login-ctl-"));
  try {
    const master = masterIn(dir);
    const turn = () => {
      const home = mkdtempSync(join(dir, "home-"));
      copyFileSync(master, join(home, "auth.json"));
      return spawnSync(process.execPath, [MOCK, "exec", "-"], { input: "hello", encoding: "utf8",
        env: { PATH: process.env.PATH, CODEX_HOME: home, MOCK_CODEX_AUTH_LEDGER: join(dir, "spent") } });
    };
    assert.equal(turn().status, 0, "the first copy signs in");
    const second = turn();
    assert.equal(second.status, 1, "a second copy of the same login must be refused");
    assert.match(second.stderr, /refresh token has already been used/);
    assert.equal(refreshOf(master), "r0", "copies never touch the master, which is the defect");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a login that can no longer be refreshed names the fix, and the stage does not retry it", async () => {
  // A master left holding a spent token, the state every install was in before the write-back above.
  // Three attempts are allowed, so a ladder that retried would show it.
  const dir = mkdtempSync(join(tmpdir(), "codex-login-out-"));
  try {
    const master = masterIn(dir);
    const ledger = join(dir, "spent");
    writeFileSync(ledger, "r0\n");
    const out = join(dir, "ctx.md");
    const r = await withEnv({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: MOCK, CLEAROTRON_AI_BILLING: "subscription",
      CODEX_API_KEY: "", CLEAROTRON_RETRY_BACKOFF_MS: "0", MOCK_CODEX_FILE: "# ctx\n", CLEAROTRON_OPENAI_AUTH_FILE: master, MOCK_CODEX_AUTH_LEDGER: ledger },
    () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: `login-out-${process.pid}`,
      runDir: dir, expectFile: out, maxRetries: 2 }));
    assert.equal(r.ok, false);
    assert.match(r.fail, /^engine_signed_out: /, `the failure does not name the sign-in: ${r.fail}`);
    assert.match(r.fail, /`codex login`/, "the failure does not say what fixes it");
    assert.equal(r.attempts, 1, "a refusal that re-sends the same credential was retried");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a login is written back only while the master still holds what the turn was seeded with", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-login-cas-"));
  try {
    const master = join(dir, "auth.json");
    const home = mkdtempSync(join(dir, "home-"));
    writeFileSync(master, "seeded", { mode: 0o600 });
    writeFileSync(join(home, "auth.json"), "rotated here");
    assert.equal(returnAuth(master, home, "seeded"), true);
    assert.equal(readFileSync(master, "utf8"), "rotated here", "an unmoved master takes the rotation");

    // Another ladder rotated the master meanwhile: ours came from the same seed, so one of the two is spent.
    writeFileSync(master, "rotated elsewhere");
    writeFileSync(join(home, "auth.json"), "rotated here again");
    assert.equal(returnAuth(master, home, "rotated here"), false);
    assert.equal(readFileSync(master, "utf8"), "rotated elsewhere", "a master another ladder moved is left alone");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
