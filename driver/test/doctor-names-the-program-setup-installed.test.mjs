// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// DOCTOR NAMES THE PROGRAM SETUP INSTALLED, WHERE NO AI IS CHOSEN.
//
// QUICKSTART and INSTALL §1 say to sign in "with the program setup installed (doctor prints its path)". Measured in
// a stranger walk of a beta, 2026-11-10: a reader who declined setup's trial turn had the program installed and no
// AI chosen, and doctor printed no path. It now prints a line for each AI program setup installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installedProgramLines } from "../../bin/onboard.mjs";
import { handRunEnv } from "./drive-env.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a Claude program setup installed is named, with how to sign in", () => {
  const find = (id) => (id === "anthropic-agent" ? { source: "installed", resolved: "/e/claude.exe" } : { source: null, resolved: null });
  assert.deepEqual(installedProgramLines({}, { resolve: find }),
    ["Claude's program, installed by setup: /e/claude.exe. Run it once in a terminal to sign in."]);
});

test("a Codex program is named with its own sign-in, and a copy found on PATH is not setup's", () => {
  const find = (id) => (id === "openai-agent" ? { source: "installed", resolved: "/e/codex.js" } : { source: "path", resolved: "/usr/bin/claude" });
  assert.deepEqual(installedProgramLines({}, { resolve: find }),
    ["Codex's program, installed by setup: /e/codex.js. Run `/e/codex.js login` once in a terminal to sign in."]);
});

/** A home where setup installed Claude's program (a stand-in) into its engines folder, and chose no AI. */
function homeWithInstalledClaude({ install = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), "doctor-installed-"));
  if (install) {
    const pkg = join(home, ".local", "share", "clearotron", "engines", "node_modules", "@anthropic-ai", "claude-code");
    mkdirSync(join(pkg, "bin"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@anthropic-ai/claude-code", version: "9.9.9", bin: { claude: "bin/claude.exe" } }));
    writeFileSync(join(pkg, "bin", "claude.exe"), "#!/bin/sh\necho 9.9.9\n");
    chmodSync(join(pkg, "bin", "claude.exe"), 0o755);
    return { home, program: join(pkg, "bin", "claude.exe") };
  }
  return { home, program: null };
}
function doctor(home) {
  try {
    return execFileSync(process.execPath, [join(REPO, "bin", "onboard.mjs"), "--check"], { encoding: "utf8", stdio: "pipe", timeout: 120000,
      // The engines folder is named, never inherited: the suite points it at an empty one so a real program cannot leak in.
      env: handRunEnv({ HOME: home, USERPROFILE: home, PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
        CLEAROTRON_ENGINES_DIR: join(home, ".local", "share", "clearotron", "engines") }, {}) });
  } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
}

test("doctor, with no AI chosen, prints the path of the program setup installed", { skip: process.platform === "win32" && "a POSIX stand-in" }, () => {
  const { home, program } = homeWithInstalledClaude();
  try {
    const out = doctor(home);
    assert.match(out, /no AI is chosen/, `anti-vacuity: doctor did not read this as a machine with no AI chosen:\n${out}`);
    assert.ok(out.includes(`· Claude's program, installed by setup: ${program}. Run it once in a terminal to sign in.`), out);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE CONTROL: with nothing installed, doctor names no program", { skip: process.platform === "win32" && "a POSIX stand-in" }, () => {
  const { home } = homeWithInstalledClaude({ install: false });
  try {
    const out = doctor(home);
    assert.match(out, /no AI is chosen/, out);
    assert.doesNotMatch(out, /installed by setup/, out);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
