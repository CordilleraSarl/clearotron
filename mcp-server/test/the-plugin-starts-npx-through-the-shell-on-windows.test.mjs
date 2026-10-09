// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PLUGIN STARTS ITS SERVER ON WINDOWS TOO: NODE STARTS A LAUNCHER, AND THE LAUNCHER STARTS NPX.
//
// Claude Code starts a plugin's server with no shell, and npx is a batch file on Windows, which starts
// only through the command shell. So the plugin's `.mcp.json` names node and `scripts/npx.mjs`, and the
// launcher starts npx itself. These arms start it exactly as Claude Code does, from the plugin's own
// entry, with the root written in forward slashes as Claude Code writes it on Windows, and hold it to
// what it promises: the server's input, output and exit code pass through unchanged; an npx planted in
// the working folder is never the one started; the server still ends when its input closes after the
// launcher was killed; and the shell is handed nothing it could read two ways.
//
// A stand-in npx, first on the PATH in a folder whose name has a space, plays the server, so no arm
// reaches npm or the network. The Windows workflow runs this file on Windows and requires the arms
// Windows needs to have run there and passed, so a skip cannot read as a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { npxCommand, npxOnPath, plainArgument } from "../../plugin/scripts/npx.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const PLUGIN = join(ROOT, "plugin");
const LAUNCHER = join(PLUGIN, "scripts", "npx.mjs");
const WINDOWS = process.platform === "win32";
const ON_WINDOWS_ONLY = WINDOWS ? false : "elsewhere npx is a program, started without a shell";
const ENTRY = JSON.parse(readFileSync(join(PLUGIN, ".mcp.json"), "utf8")).mcpServers["trademark-artifacts"];
const NPX_ARGS = ENTRY.args.slice(1);

// The stand-in server: it says it is up, records who it is, echoes its whole input once that input
// ends, then the arguments it was started with, and exits 7.
const STAND_IN = `import { writeFileSync } from "node:fs";
writeFileSync(process.env.STAND_IN_PIDS, JSON.stringify({ pid: process.pid, ppid: process.ppid }));
process.stdout.write("ready\\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  process.stdout.write("echo:" + input + "args:" + JSON.stringify(process.argv.slice(2)) + "\\n");
  process.exit(7);
});
`;
const DECOY = `import { writeFileSync } from "node:fs";
writeFileSync(process.env.DECOY_RAN, "the decoy in the working folder ran");
process.exit(3);
`;

/** An npx named `npx` here and `npx.cmd` on Windows, that runs `script` with this node. */
function plantNpx(dir, name, script) {
  writeFileSync(join(dir, name), script);
  if (WINDOWS) {
    writeFileSync(join(dir, "npx.cmd"), `@"${process.execPath}" "%~dp0${name}" %*\r\n`);
  } else {
    writeFileSync(join(dir, "npx"), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/${name}" "$@"\n`);
    chmodSync(join(dir, "npx"), 0o755);
  }
}

/** A stand-in npx first on the PATH, a project folder holding a decoy npx, and the environment for both. */
function standIn() {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-npx-"));
  const bin = join(tmp, "node js");
  const project = join(tmp, "project");
  mkdirSync(bin);
  mkdirSync(project);
  plantNpx(bin, "stand-in.mjs", STAND_IN);
  plantNpx(project, "decoy.mjs", DECOY);
  const env = { ...process.env, STAND_IN_PIDS: join(tmp, "pids.json"), DECOY_RAN: join(tmp, "decoy-ran") };
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  env[key] = [bin, dirname(process.execPath), env[key] ?? ""].join(delimiter);
  return { tmp, project, env, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** The plugin's entry, started as Claude Code starts it: the command from `.mcp.json`, no shell, pipes. */
function startAsClaudeCodeDoes({ project, env }, args = ENTRY.args) {
  const root = PLUGIN.replaceAll("\\", "/");
  const argv = args.map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", root));
  const child = spawn(ENTRY.command, argv, { cwd: project, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let onReady;
  const ready = new Promise((resolve) => { onReady = resolve; });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => { stdout += d; if (stdout.startsWith("ready\n")) onReady(); });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const done = new Promise((resolve) => child.stdout.on("end", resolve)).then(async () => ({ ...(await exited), stdout, stderr }));
  return { child, ready: () => within(ready, 30_000, () => `the stand-in never said it was up; stderr: ${stderr}`), exited, done };
}

function within(promise, ms, why) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(why())), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};

const REQUEST = '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n';

test("a bare npx entry does not start on Windows, which is the failure the launcher exists for", { skip: ON_WINDOWS_ONLY }, async () => {
  const s = standIn();
  try {
    const failed = await new Promise((resolve) => {
      try {
        const child = spawn("npx", NPX_ARGS, { cwd: s.project, env: s.env, stdio: "ignore" });
        child.on("error", (e) => resolve(e.code));
        child.on("exit", (code) => resolve(`started, and exited ${code}`));
      } catch (e) {
        resolve(e.code);
      }
    });
    assert.ok(["ENOENT", "EINVAL"].includes(failed), `npx started with no shell: ${failed}`);
    assert.equal(existsSync(s.env.STAND_IN_PIDS), false, "the stand-in ran");
  } finally { s.cleanup(); }
});

test("the launcher hands the server its input and output unchanged, and the exit code of npx back", async () => {
  const s = standIn();
  try {
    const run = startAsClaudeCodeDoes(s);
    await run.ready();
    run.child.stdin.end(REQUEST);
    const { code, stdout, stderr } = await within(run.done, 30_000, () => "the launcher never ended");
    assert.equal(stdout, `ready\necho:${REQUEST}args:${JSON.stringify(NPX_ARGS)}\n`, `stderr: ${stderr}`);
    assert.equal(code, 7);
    assert.equal(stderr, "");
  } finally { s.cleanup(); }
});

test("an npx in the project folder is never the one started", async () => {
  const s = standIn();
  try {
    const run = startAsClaudeCodeDoes(s);
    await run.ready();
    run.child.stdin.end();
    const { code } = await within(run.done, 30_000, () => "the launcher never ended");
    assert.equal(existsSync(s.env.DECOY_RAN), false, "the decoy npx in the working folder ran");
    assert.equal(code, 7);
  } finally { s.cleanup(); }
});

test("the server ends when its input closes, though the launcher was killed first", async () => {
  const s = standIn();
  try {
    const run = startAsClaudeCodeDoes(s);
    await run.ready();
    const { pid, ppid } = JSON.parse(readFileSync(s.env.STAND_IN_PIDS, "utf8"));
    await new Promise((resolve) => run.child.stdin.write(REQUEST, resolve));
    run.child.kill("SIGKILL");
    await within(run.exited, 15_000, () => "the launcher outlived a kill");
    if (!run.child.stdin.destroyed) run.child.stdin.end();
    const { stdout } = await within(run.done, 30_000, () => "the server's output never closed");
    assert.equal(stdout, `ready\necho:${REQUEST}args:${JSON.stringify(NPX_ARGS)}\n`, "the server did not end on its own, on the end of its input");
    let left = [pid, ppid].filter(alive);
    for (let i = 0; i < 30 && left.length; i++) {
      await new Promise((r) => setTimeout(r, 500));
      left = left.filter(alive);
    }
    assert.deepEqual(left, [], "programs the launcher started were still running 15 seconds after their input closed");
  } finally { s.cleanup(); }
});

test("the real npx starts through the launcher", async () => {
  const s = standIn();
  try {
    const env = { ...process.env };
    const run = startAsClaudeCodeDoes({ project: s.project, env }, [ENTRY.args[0], "--version"]);
    run.child.stdin.end();
    const { code, stdout, stderr } = await within(run.done, 60_000, () => "npx --version never ended");
    assert.equal(code, 0, `stderr: ${stderr}`);
    assert.match(stdout, /^\d+\.\d+\.\d+\r?\n$/);
  } finally { s.cleanup(); }
});

test("npx is started as a program where it is one, and on Windows as one quoted line for the shell", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.deepEqual(npxCommand(NPX_ARGS, platform), { command: "npx", args: NPX_ARGS, shell: false });
  }
  const tmp = mkdtempSync(join(tmpdir(), "plugin-npx-path-"));
  try {
    const [first, second, relative] = ["first dir", "second", "relative"].map((d) => join(tmp, d));
    for (const d of [first, second, relative]) {
      mkdirSync(d);
      writeFileSync(join(d, "npx.cmd"), "");
    }
    const env = { Path: ["", "relative", second, first].join(";"), PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    assert.deepEqual(npxCommand(NPX_ARGS, "win32", env), {
      command: [`"${join(second, "npx.cmd")}"`, ...NPX_ARGS].join(" "),
      args: [],
      shell: true,
    });
    assert.equal(npxOnPath({ PATH: `"${first}"`, PATHEXT: ".CMD" }, ";"), join(first, "npx.cmd"), "a quoted PATH entry");
    const pct = join(tmp, "100%");
    mkdirSync(pct);
    writeFileSync(join(pct, "npx.cmd"), "");
    assert.equal(npxOnPath({ PATH: [pct, first].join(";") }, ";"), join(first, "npx.cmd"), "a path the shell would rewrite");
    assert.throws(() => npxCommand(NPX_ARGS, "win32", { PATH: join(tmp, "none") }), { code: "ENOENT" });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("an argument the shell could read two ways is refused on every platform", () => {
  for (const a of ["-y", "clearotron@0.4.1", "mcp", "--version", "--package=clearotron@1.2.3", "a/b:c+d"]) {
    assert.ok(plainArgument(a), a);
  }
  for (const a of ["", "a b", "x&y", "%PATH%", "!x!", '"q"', "a|b", "^", "<", ">", "(", ")", ";", ",", "a\nb", "\\x"]) {
    for (const platform of ["linux", "darwin", "win32"]) {
      assert.throws(() => npxCommand(["-y", a], platform, { PATH: "" }), /not a plain argument/, `${platform}: ${JSON.stringify(a)}`);
    }
  }
  assert.ok(NPX_ARGS.every(plainArgument), `the plugin's own arguments: ${NPX_ARGS}`);
});

test("the launcher stands alone: node builtins only, nothing on the server's output, no version of its own", () => {
  const source = readFileSync(LAUNCHER, "utf8");
  const imports = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, "no import read; the pattern no longer matches the file");
  for (const spec of imports) assert.match(spec, /^node:/, `the launcher imports ${spec}, which the installed folder does not have`);
  assert.doesNotMatch(source, /import\(/, "a dynamic import");
  assert.doesNotMatch(source, /console\.log|process\.stdout/, "the launcher writes to the output the server answers on");
  assert.doesNotMatch(source, /clearotron@|\b\d+\.\d+\.\d+\b/, "the launcher names a version; the pin lives in .mcp.json alone");
});
