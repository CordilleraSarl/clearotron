// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ENGINE PROGRAM CLEAROTRON INSTALLED IS THE LAST RESORT, AND THE MACHINE'S OWN COPY WINS.
//
// Setup installs the program the reader's engine runs, Claude Code or the Codex CLI, into Clearotron's
// engines folder, so a fresh machine can run a clearance with nothing installed first. A copy the machine
// already has still comes first, because it keeps updating itself. One resolver decides (driver.config.mjs
// resolveEngineProgram) and every reader asks it: the run door, the inventory, doctor, the wizard and both
// adapters. So these arms drive the resolver, the run door, and a real dispatch through each adapter.
//
// EVERY ARM PLANTS ITS OWN INSTALLED COPY, laid out the way npm lays one out in the engines folder:
// `<folder>/node_modules/<package>/{package.json, <bin>}`. The suite points the resolver's last step at
// an empty directory (scripts/test-run.mjs), because a developer's own engines folder may hold a REAL
// program; an arm hands the resolver its fixture folder instead. Nothing here spawns a real engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
process.env.CLEAROTRON_RUN_LOCK_DIR = mkdtempSync(join(tmpdir(), "installed-copy-locks-"));
const { resolveEngineProgram, preflightEngineBinary, ENGINE_BINARIES, ENGINES_DIR_ENV, enginesFolder, engineInstallArgs, engineInstallCommand } = await import("../driver.config.mjs");
const { runStage } = await import("../gateway.mjs");
const { forgetCliVersions } = await import("../engine/cli-version.mjs");

const CLAUDE = ENGINE_BINARIES["anthropic-agent"];
const CODEX = ENGINE_BINARIES["openai-agent"];
const MOCK_CLAUDE = join(HERE, "mock-claude.mjs");
const MOCK_CODEX = join(HERE, "mock-codex.mjs");
chmodSync(MOCK_CLAUDE, 0o755);
chmodSync(MOCK_CODEX, 0o755);

/** The shape the Claude package leaves in place when its install step did not run: a shell script with no `#!`. */
const PLACEHOLDER = 'echo "Error: the native binary is not installed." >&2\nexit 1\n';

/** What Windows starts a bare program name as: it looks a name up on PATH with an extension, never without. */
const EXE = process.platform === "win32" ? ".exe" : "";

/** An npm install of `spec.package` under `root`; its program is copied `from`, symlinked to `link`, or written as `content`. */
function plant(root, spec, { from = null, link = null, content = null, version = "9.9.9", rel = null } = {}) {
  const dir = join(root, "node_modules", ...spec.package.split("/"));
  rel ??= `bin/${spec.fallback === "claude" ? "claude.exe" : "codex.js"}`;
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: spec.package, version, bin: { [spec.fallback]: rel } }));
  const p = join(dir, rel);
  if (link) symlinkSync(link, p);
  else if (from) copyFileSync(from, p);
  else writeFileSync(p, content ?? "#!/bin/sh\nexit 0\n");
  chmodSync(p, 0o755);
  return p;
}

/** A directory holding one executable named `name`, so a PATH decides the lookup rather than inheriting one. */
function onPath(name) {
  const dir = mkdtempSync(join(tmpdir(), "machine-copy-"));
  const p = join(dir, `${name}${EXE}`);
  writeFileSync(p, "#!/bin/sh\nexit 0\n");
  chmodSync(p, 0o755);
  return { dir, p };
}

const fresh = () => mkdtempSync(join(tmpdir(), "installed-copy-"));

test("the machine's own copy on PATH wins, and the installed copy serves only when there is none", () => {
  const root = fresh();
  const installed = plant(root, CLAUDE);
  const machine = onPath("claude");
  const withCopy = resolveEngineProgram("anthropic-agent", { env: { PATH: machine.dir }, enginesDir: root });
  assert.equal(withCopy.source, "path", "a copy on PATH must win: it is the one that keeps itself updated");
  assert.equal(withCopy.resolved, machine.p);
  const without = resolveEngineProgram("anthropic-agent", { env: { PATH: "" }, enginesDir: root });
  assert.equal(without.source, "installed", "with nothing on PATH, the copy Clearotron installed serves");
  assert.equal(without.resolved, installed);
  assert.equal(without.version, "9.9.9", "and its version is read from its own package.json, without spawning it");
  // The run door gives the same answer, because it asks the same resolver.
  const door = preflightEngineBinary({ PATH: "" }, { enginesDir: root });
  assert.equal(door.resolved, installed);
  assert.equal(door.source, "installed");
});

test("a PATH entry that IS the installed copy is taken for what it is, and a machine copy later on PATH still wins", () => {
  // The engines folder is not on PATH, but a reader can put its node_modules/.bin there. Taken there, the
  // installed copy would be reported, and written into a settings file, as the machine's own.
  const root = fresh();
  const installed = plant(root, CLAUDE);
  const npmBin = join(root, "node_modules", ".bin");
  mkdirSync(npmBin, { recursive: true });
  symlinkSync(installed, join(npmBin, `claude${EXE}`));
  const machine = onPath("claude");
  const both = resolveEngineProgram("anthropic-agent", { env: { PATH: [npmBin, machine.dir].join(delimiter) }, enginesDir: root });
  assert.equal(both.source, "path");
  assert.equal(both.resolved, machine.p, "the machine's copy, later on PATH, wins over npm's link to the installed one");
  const only = resolveEngineProgram("anthropic-agent", { env: { PATH: npmBin }, enginesDir: root });
  assert.equal(only.source, "installed", "reached through npm's link, it is still the copy Clearotron installed");
  assert.equal(only.resolved, installed);
});

test("the vendor's placeholder is refused by name, and never reported as a program that can run", () => {
  const root = fresh();
  plant(root, CLAUDE, { content: PLACEHOLDER });
  const r = resolveEngineProgram("anthropic-agent", { env: { PATH: "" }, enginesDir: root });
  assert.equal(r.resolved, null, "the placeholder passes an execute-bit check and fails every stage, so it must not resolve");
  assert.match(r.rejected[0]?.why ?? "", /install step did not run/, JSON.stringify(r.rejected));
  assert.match(r.rejected[0]?.why ?? "", /--ignore-scripts/, "and the refusal names the fix");
  assert.throws(() => preflightEngineBinary({ PATH: "" }, { enginesDir: root }), /install step did not run/,
    "the run door refuses before any stage, and says why");
});

test("the placeholder gate reads the file's header: a native binary or a `#!` script in the same place resolves", () => {
  // The control. Without it, "refused" above could mean "anything inside a vendor package is refused".
  const cases = [
    ["an ELF header", Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)])],
    ["a Mach-O header", Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(60)])],
    ["a #! line", "#!/bin/sh\nexit 0\n"],
  ];
  for (const [label, content] of cases) {
    const root = fresh();
    const p = plant(root, CLAUDE, { content });
    const r = resolveEngineProgram("anthropic-agent", { env: { PATH: "" }, enginesDir: root });
    assert.equal(r.resolved, p, `${label} in the vendor's package must resolve: ${JSON.stringify(r.rejected)}`);
  }
});

test("a placeholder on PATH, inside an npm install of the vendor's package, is passed over for the next copy", () => {
  // `npm install -g --ignore-scripts @anthropic-ai/claude-code` leaves exactly this on PATH.
  const broken = fresh();
  const stub = plant(broken, CLAUDE, { content: PLACEHOLDER });
  const globalBin = mkdtempSync(join(tmpdir(), "global-bin-"));
  symlinkSync(stub, join(globalBin, `claude${EXE}`));
  const root = fresh();
  const installed = plant(root, CLAUDE);
  const r = resolveEngineProgram("anthropic-agent", { env: { PATH: globalBin }, enginesDir: root });
  assert.equal(r.resolved, installed, "the copy Clearotron installed serves instead");
  assert.equal(r.rejected.length, 1, "and the placeholder is named as passed over");
  assert.equal(r.rejected[0].path, join(globalBin, `claude${EXE}`));
});

/** What the run door says when it refuses, or "" when it does not. */
const refusal = (env, opts) => { try { preflightEngineBinary(env, opts); return ""; } catch (e) { return e.message; } };

test("the run door says no copy was installed only when none was", () => {
  const root = fresh();
  plant(root, CLAUDE, { content: PLACEHOLDER });
  const refused = refusal({ PATH: "" }, { enginesDir: root });
  assert.match(refused, /the placeholder/, refused);
  assert.doesNotMatch(refused, /Clearotron has not installed one/,
    "an installed copy that cannot run was reported as never installed, which sends the reader to install it again");
  // THE CONTROL: with nothing installed, it says so.
  const none = refusal({ PATH: "" }, { enginesDir: fresh() });
  assert.match(none, /Clearotron has not installed one/, none);
});

test("under WSL, the run door names the Windows copies it passed over", () => {
  // /mnt/c cannot be created on a Linux runner without root, so the drive predicate is injected.
  const win = onPath("claude");
  const onWindowsDrive = (p) => p.startsWith(win.dir);
  const said = refusal({ PATH: win.dir }, { enginesDir: fresh(), wsl: true, onWindowsDrive });
  assert.ok(said.includes(win.p), `the refusal does not name the copy it passed over: ${said}`);
  assert.match(said, /Windows drive/, said);
  // THE CONTROL: off WSL the same copy is found.
  assert.equal(preflightEngineBinary({ PATH: win.dir }, { enginesDir: fresh(), wsl: false }).resolved, win.p);
});

test("the engine's own fallback word is the default spelled out; any other value is a choice that never falls through", () => {
  const root = fresh();
  const installed = plant(root, CLAUDE);
  // The shipped example file writes CLEAROTRON_CLAUDE_PATH=claude. That means what unset means.
  const word = resolveEngineProgram("anthropic-agent", { env: { PATH: "", CLEAROTRON_CLAUDE_PATH: "claude" }, enginesDir: root });
  assert.equal(word.resolved, installed);
  assert.equal(word.explicit, false);
  // A path somebody typed is reported, never overruled: the installed copy is not a quiet substitute.
  const typed = resolveEngineProgram("anthropic-agent", { env: { PATH: "", CLEAROTRON_CLAUDE_PATH: "/nope/claude" }, enginesDir: root });
  assert.equal(typed.resolved, null);
  assert.equal(typed.explicit, true);
  assert.throws(() => preflightEngineBinary({ PATH: "", CLEAROTRON_CLAUDE_PATH: "/nope/claude" }, { enginesDir: root }), /\/nope\/claude/);
  // Another bare name is looked for on PATH, and only there.
  const other = resolveEngineProgram("anthropic-agent", { env: { PATH: "", CLEAROTRON_CLAUDE_PATH: "claude-beta" }, enginesDir: root });
  assert.equal(other.resolved, null, "a named program that is not on PATH must not be replaced by the installed copy");
});

test("the Codex launcher npm installs is found the same way, with its version", () => {
  const root = fresh();
  const installed = plant(root, CODEX, { from: MOCK_CODEX, version: "0.999.0" });
  const r = resolveEngineProgram("openai-agent", { env: { PATH: "" }, enginesDir: root });
  assert.equal(r.source, "installed");
  assert.equal(r.resolved, installed);
  assert.equal(r.version, "0.999.0");
});

test("the setting that moves the lookup is read when no directory is injected", () => {
  const root = fresh();
  const installed = plant(root, CLAUDE);
  const saved = process.env[ENGINES_DIR_ENV];
  try {
    process.env[ENGINES_DIR_ENV] = root;
    assert.equal(resolveEngineProgram("anthropic-agent", { env: { PATH: "" } }).resolved, installed);
    process.env[ENGINES_DIR_ENV] = fresh();   // an empty directory: nothing is installed there
    assert.equal(resolveEngineProgram("anthropic-agent", { env: { PATH: "" } }).resolved, null);
  } finally {
    if (saved === undefined) delete process.env[ENGINES_DIR_ENV];
    else process.env[ENGINES_DIR_ENV] = saved;
  }
});

test("the default engines folder is under the home directory, where the lookup finds what setup put there", () => {
  // Under the home, not the install's own tree: an update replaces that tree, and the services run as
  // user units under the same home as the setup that installed the program.
  const saved = { home: process.env.HOME, profile: process.env.USERPROFILE, dir: process.env[ENGINES_DIR_ENV] };
  const home = fresh();
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;   // os.homedir() reads this one on Windows
    delete process.env[ENGINES_DIR_ENV];
    const folder = join(home, ".local", "share", "clearotron", "engines");
    assert.equal(enginesFolder(), folder);
    const installed = plant(folder, CLAUDE);
    const r = resolveEngineProgram("anthropic-agent", { env: { PATH: "" } });
    assert.equal(r.source, "installed", `the default lookup did not find the copy setup installed: ${JSON.stringify(r)}`);
    assert.equal(r.resolved, installed);
  } finally {
    if (saved.home === undefined) delete process.env.HOME; else process.env.HOME = saved.home;
    if (saved.profile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = saved.profile;
    if (saved.dir === undefined) delete process.env[ENGINES_DIR_ENV]; else process.env[ENGINES_DIR_ENV] = saved.dir;
  }
});

test("the install setup runs is the command it shows: one package, this version or newer, into the engines folder", () => {
  const cwd = fresh();   // a bare `>=` in a pasted command would redirect into a file here
  for (const spec of [CLAUDE, CODEX]) {
    const dir = join(fresh(), "engines with a space");
    const args = engineInstallArgs(spec, dir);
    assert.deepEqual(args.slice(0, 3), ["install", "--prefix", dir]);
    assert.equal(args.at(-1), `${spec.package}@>=${spec.floor}`, "a floor and no ceiling");
    // What a reader pastes is what setup spawns: a POSIX shell splits the printed command into that argv.
    const printed = engineInstallCommand(spec, dir);
    const said = spawnSync("sh", ["-c", `printf '%s\\n' ${printed}`], { cwd, encoding: "utf8" });
    assert.deepEqual(said.stdout.split("\n").slice(0, -1), ["npm", ...args], printed);
    // With no folder to hand (the portal, doctor's advice), the command names the default one as typed.
    assert.equal(spec.install, engineInstallCommand(spec));
    assert.match(spec.install, /^npm install --prefix ~\/\.local\/share\/clearotron\/engines /);
  }
  assert.deepEqual(readdirSync(cwd), [], "the printed command redirected into a file");
});

// ── THE ADAPTERS SPAWN WHAT THE RESOLVER FOUND ───────────────────────────────────────────────────────
//
// Each adapter used to hand spawn(2) a bare word, so the OS walked PATH on its own and a copy that is not
// on PATH could never run, however confidently the run door had approved it. These dispatch one real
// stage with a PATH that holds only `node` (the stand-ins start through `#!/usr/bin/env node`), so the
// only copy anything can find is the one planted as the copy Clearotron installed.

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; pinEnv(process.env, k, env[k]); }
  return (async () => {
    try { return await fn(); }
    finally { for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else pinEnv(process.env, k, saved[k]); } }
  })();
}

const NODE_ONLY = mkdtempSync(join(tmpdir(), "node-only-"));
symlinkSync(process.execPath, join(NODE_ONLY, "node"));

const DISPATCH = {
  "anthropic-agent": { spec: CLAUDE, mock: MOCK_CLAUDE, env: (dir, out) => ({ CLEAROTRON_AI: "anthropic-agent",
    CLEAROTRON_CLAUDE_PATH: undefined, MOCK_CLAUDE_FILE: "a stub the validator accepts\n", MOCK_OUT_FILE: out,
    MOCK_CLAUDE_CALL_LOG: join(dir, "calls.jsonl"), MOCK_COUNT_FILE: join(dir, "count") }) },
  "openai-agent": { spec: CODEX, mock: MOCK_CODEX, env: () => ({ CLEAROTRON_AI: "openai-agent",
    CLEAROTRON_CODEX_PATH: undefined, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-dummy", MOCK_CODEX_FILE: "# ctx\n" }) },
};

for (const [engine, { spec, mock, env }] of Object.entries(DISPATCH)) {
  test(`${engine}: a real dispatch spawns the copy only the resolver can find, and records it as the installed copy`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "installed-dispatch-"));
    const root = fresh();
    try {
      // Linked, not copied: the stand-in imports its neighbours by relative path. On Windows the Claude
      // stand-in is named as the Node script it is, because Windows starts an `.exe` itself and the mock
      // is not a native program; a script there runs through the Node running now.
      plant(root, spec, { link: mock, rel: process.platform === "win32" && spec === CLAUDE ? "bin/claude.mjs" : null });
      mkdirSync(driverDir(dir), { recursive: true });
      forgetCliVersions();
      const out = join(dir, "out.md");
      const res = await withEnv({ ...env(dir, out), PATH: NODE_ONLY, [ENGINES_DIR_ENV]: root, CLEAROTRON_RETRY_BACKOFF_MS: "0" },
        () => runStage("matter-frame", { message: `write it. OUTPUT_FILE: ${out}`, model: "opus", sessionKey: `installed-${engine}`,
          runDir: dir, expectFile: out, maxRetries: 0, timeoutSec: 30 }));
      assert.equal(res?.ok, true, `the turn did not complete, so the adapter did not reach the installed copy: ${JSON.stringify(res).slice(0, 300)}`);
      const rows = readFileSync(driverDir(dir, "matter-frame.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      assert.equal(rows.at(-1).cliSource, "installed",
        `the attempt row does not say the installed copy served: ${JSON.stringify(rows.at(-1)).slice(0, 240)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
}
