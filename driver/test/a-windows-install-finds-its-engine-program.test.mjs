// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NATIVE WINDOWS: THE ENGINE'S PROGRAM IS FOUND AS WINDOWS FINDS A PROGRAM, AND STARTED WITHOUT A SHELL.
//
// Measured on a real Windows run, 2026-09-09: the lookup took npm's extensionless `claude` shim, a shell
// script Windows cannot start, because `X_OK` on Windows only asks whether a file exists, and the spawn
// failed with ENOENT. Windows finds a program by extension, in PATHEXT's order; npm's `.cmd` shim is a
// batch file Node will not start without a shell; and Codex's npm program is a JavaScript launcher.
//
// These arms build a Windows machine's PATH on this Linux one: real directories and files, joined with
// ";", named with Windows extensions, and the lookup told it is on win32. The files are real because the
// lookup reads them. Every arm also holds what Linux finds, which must not move.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEngineProgram, ENGINE_BINARIES } from "../driver.config.mjs";
import { engineSpawn, spawnsDetached } from "../engine/engine-spawn.mjs";
import { npmInvocation } from "../../shared/npm-cli.mjs";
import { resolveEngineBin } from "../../bin/onboard.mjs";

const W = { platform: "win32", enginesDir: null };
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]);   // a Windows program starts "MZ"

const dir = (name) => mkdtempSync(join(tmpdir(), `win-${name}-`));
const file = (p, body = "", mode = 0o644) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, body); chmodSync(p, mode); return p; };

/** An npm global prefix as Windows lays it out: the shims beside `node_modules`, the package inside it. */
function npmPrefix(engine, { binBody = EXE } = {}) {
  const spec = ENGINE_BINARIES[engine];
  const prefix = dir("npm");
  const pkgDir = join(prefix, "node_modules", ...spec.package.split("/"));
  const binRel = engine === "openai-agent" ? "bin/codex.js" : "bin/claude.exe";
  file(join(pkgDir, "package.json"), JSON.stringify({ name: spec.package, version: "9.9.9", bin: { [spec.fallback]: binRel } }));
  const program = file(join(pkgDir, ...binRel.split("/")), binBody, 0o755);
  file(join(prefix, `${spec.fallback}.cmd`), `@"%dp0%\\node_modules\\${spec.package}\\${binRel}" %*\r\n`);
  file(join(prefix, spec.fallback), "#!/bin/sh\nexec node \"$basedir/node_modules/x\" \"$@\"\n", 0o755);   // npm's shim for Git Bash
  return { prefix, program };
}

test("the vendor's own installer's claude.exe on PATH is found, and the extensionless shim never is", () => {
  const d = dir("path");
  const exe = file(join(d, "claude.exe"), EXE);
  file(join(d, "claude"), "#!/bin/sh\n", 0o755);
  const r = resolveEngineProgram("anthropic-agent", { env: { Path: d, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, ...W });
  assert.equal(r.resolved, exe, "Windows was handed a file it cannot start, or PATH spelled `Path` was not read");
  assert.equal(r.source, "path");
});

test("npm's claude.cmd stands for the package beside it: the program is its claude.exe", () => {
  const { prefix, program } = npmPrefix("anthropic-agent");
  const r = resolveEngineProgram("anthropic-agent", { env: { PATH: `C:\\Windows;${prefix}` }, ...W });
  assert.equal(r.resolved, program, "the batch shim was taken, which Node cannot start without a shell");
  assert.equal(r.version, "9.9.9", "the copy's version is read from the vendor's own package");
});

test("npm's codex.cmd stands for the launcher, and the launcher runs through the Node running now", () => {
  const { prefix, program } = npmPrefix("openai-agent", { binBody: "#!/usr/bin/env node\n" });
  const r = resolveEngineProgram("openai-agent", { env: { PATH: prefix }, ...W });
  assert.equal(r.resolved, program);
  const run = engineSpawn(r.resolved, ["exec", "-"], { platform: "win32", execPath: "C:\\node\\node.exe" });
  assert.deepEqual(run, { command: "C:\\node\\node.exe", args: [program, "exec", "-"] },
    "a JavaScript program was handed to Windows to start by itself");
  assert.deepEqual(engineSpawn("/usr/bin/codex", ["exec"], { platform: "linux" }), { command: "/usr/bin/codex", args: ["exec"] },
    "Linux stopped starting the program as itself");
  assert.deepEqual(engineSpawn("/x/codex.js", [], { platform: "linux" }), { command: "/x/codex.js", args: [] });
});

test("the vendor's placeholder claude.exe is refused on Windows as it is everywhere", () => {
  const { prefix, program } = npmPrefix("anthropic-agent", { binBody: "echo claude native binary not installed\n" });
  const r = resolveEngineProgram("anthropic-agent", { env: { PATH: prefix }, ...W });
  assert.equal(r.resolved, null, "a text file named claude.exe was taken for the program");
  assert.ok(r.rejected.some((x) => x.path === program && /placeholder/.test(x.why)), JSON.stringify(r.rejected));
});

test("a Windows path in the setting is a path, absolute or relative, not a bare name", () => {
  const absolute = resolveEngineProgram("anthropic-agent", { env: { CLEAROTRON_CLAUDE_PATH: "C:\\Tools\\claude.exe", PATH: "" }, ...W });
  assert.equal(absolute.relative, false);
  assert.equal(absolute.resolved, null, "a program that is not on this machine was reported found");
  assert.equal(absolute.rejected[0]?.path, "C:\\Tools\\claude.exe",
    "C:\\Tools\\claude.exe was looked up on PATH as a bare name, which is what `includes(\"/\")` did");
  const relative = resolveEngineProgram("anthropic-agent", { env: { CLEAROTRON_CLAUDE_PATH: ".\\bin\\claude.exe", PATH: "" }, ...W });
  assert.equal(relative.relative, true, "a relative Windows path was not caught as relative");
  const wizard = resolveEngineBin("C:\\Tools\\claude.exe", { engine: "anthropic-agent", env: { PATH: "" }, ...W });
  assert.equal(wizard.executable, false);
  assert.match(wizard.path, /claude\.exe$/, "setup did not report the path the reader typed");
});

test("Linux still finds the extensionless program, and reads \"\\\" as part of a name", () => {
  const d = dir("linux");
  const p = file(join(d, "claude"), "#!/bin/sh\nexit 0\n", 0o755);
  const r = resolveEngineProgram("anthropic-agent", { env: { PATH: d }, platform: "linux", enginesDir: null });
  assert.equal(r.resolved, p);
  const named = resolveEngineProgram("anthropic-agent", { env: { CLEAROTRON_CLAUDE_PATH: "a\\claude", PATH: "" }, platform: "linux", enginesDir: null });
  assert.equal(named.relative, false, "a Linux name holding \"\\\" was read as a relative path");
});

test("a turn is detached where that buys a process group, and not on Windows", () => {
  assert.equal(spawnsDetached("linux"), true);
  assert.equal(spawnsDetached("darwin"), true);
  assert.equal(spawnsDetached("win32"), false, "a detached child on Windows has no console and outlives the window");
});

test("npm runs on Windows as npm-cli.js through the Node running now, and as `npm` elsewhere", () => {
  const exists = (p) => p.endsWith("npm-cli.js");
  const beside = npmInvocation(["install", "x@>=1"], { platform: "win32", env: {}, execPath: "C:\\Program Files\\nodejs\\node.exe", exists });
  assert.deepEqual(beside, { command: "C:\\Program Files\\nodejs\\node.exe",
    args: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "install", "x@>=1"] },
    "npm.cmd would need a shell on Windows, and cmd.exe reads `>=` as a redirection");
  const named = npmInvocation(["ci"], { platform: "win32", env: { npm_execpath: "D:\\npm\\bin\\npm-cli.js" }, execPath: "node.exe", exists });
  assert.deepEqual(named.args, ["D:\\npm\\bin\\npm-cli.js", "ci"], "the npm that launched this was passed over");
  const pnpm = npmInvocation(["ci"], { platform: "win32", env: { npm_execpath: "D:\\pnpm\\pnpm.cjs" }, execPath: "C:\\n\\node.exe", exists });
  assert.equal(pnpm.args[0], "C:\\n\\node_modules\\npm\\bin\\npm-cli.js", "another package manager was run as npm");
  assert.deepEqual(npmInvocation(["ci"], { platform: "linux", env: { npm_execpath: "/x/npm-cli.js" }, exists }), { command: "npm", args: ["ci"] },
    "Linux stopped running `npm`");
});
