// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// `doctor` proves the engine with one real turn, so a sign-in that is dead fails it.
//
// It used to read the engine from the disk alone, and a program that is installed and holds a sign-in file passes
// every test the disk can answer. Measured on a production install, 2026-11-25: Codex's renewal had been refused
// for three weeks, the program still said it was logged in, `doctor` exited 0, and the first order in that time
// was refused at the run door with nobody told. Driven here against both engines' dead logins
// (dead-login-engines.mjs), with nothing outside this machine called.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { NO_INSTALLED_ENGINES } from "./drive-env.mjs";
import { doctorRepoRoot } from "./helpers/portal-bundle.mjs";
import { deadLoginEngines } from "./dead-login-engines.mjs";
import { engineSpawn } from "../engine/engine-spawn.mjs";

/** The real command, in a scratch home, with the deployment's git position pinned (doctor-refuses-what-cannot-run.test.mjs says why). */
function doctor(env, args = []) {
  const home = mkdtempSync(join(tmpdir(), "doctor-dead-login-home-"));
  try {
    const repo = doctorRepoRoot();
    const r = spawnSync(process.execPath, [join(repo, "bin", "clearotron.mjs"), "doctor", ...args],
      { cwd: repo, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: home, USERPROFILE: home, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", ...NO_INSTALLED_ENGINES, ...env } });
    if (r.error || r.signal) throw new Error(`the child did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
    return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

for (const [engine, said] of [["claude", /anthropic-agent is not signed in/], ["codex", /openai-agent is not signed in/]]) {
  test(`doctor fails on a dead ${engine} login it can only find with a real turn`, () => {
    const dir = mkdtempSync(join(tmpdir(), "dead-login-"));
    try {
      const engines = deadLoginEngines(dir);
      if (engine === "codex") {
        const start = engineSpawn(engines.codex.CLEAROTRON_CODEX_PATH, ["login", "status"]);
        const status = spawnSync(start.command, start.args, { encoding: "utf8" });
        assert.match(status.stdout, /Logged in/, "the stand-in says it is signed in, as the real one did");
      }
      const r = doctor(engines[engine]);
      assert.equal(r.status, 1, r.out);
      assert.match(r.out, said, r.out);
      assert.doesNotMatch(r.out, /add --probe-engine/, "the turn is not an option the reader has to ask for");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("the flag that used to ask for the turn is still accepted, and the turn runs either way", () => {
  const dir = mkdtempSync(join(tmpdir(), "dead-login-flag-"));
  try {
    const r = doctor(deadLoginEngines(dir).claude, ["--probe-engine"]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /anthropic-agent is not signed in/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
