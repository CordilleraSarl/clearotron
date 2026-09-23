// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the real `doctor` command, once with a fake engine
//
// A FRESH INSTALL THAT FOLLOWS THE DOCUMENTATION, AND THREE SURFACES THAT DISAGREED ABOUT IT.
//
// Measured on a fresh-install walk, 2026-09-10: `doctor`, `start` and the portal sign-in all succeeded,
// and the first search was refused. Each surface told the operator something different about why:
//
//   1. THE PROBE. A token kept in the install's own environment file never reached `doctor`'s proof turn,
//      which reported the engine signed out — while the same token exported into the shell proved it.
//      The probe fills its environment from a list of variable names, and that list was a second copy of
//      the one `applyEngineEnv` applies to the spawn; it had dropped both credentials. The fix is that the
//      copy that is filled IS the copy that is applied (`engineEnvKeys`).
//   2. THE REFUSAL. The order-time refusal named only the file background units read. A runner started
//      from a terminal on a box with no units reads the install's own file, so its operator was told to
//      create a file nothing on that box reads.
//   3. DOCTOR. It passed an install the run then refused, because it checked each requirement against
//      the operator's shell while the refusal checks the runner's environment. It now asks the order-time
//      gate's own authority, of the environment a run will have.
//
// What the refusal already did well is held here as well, because the fix must not flatten it: it names
// every missing item, says nothing has been searched or spent, and names no variable to a client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// A namespace import, not a named one: a named import of an export a tree does not have fails the WHOLE
// file before any arm runs, and every other arm here would then read as red for a reason it never tested.
import * as probe from "../engine/probe.mjs";
import { orderTimeRefusal, startEnvFileOf, runRequirements } from "../run-requirements.mjs";
import { handRunEnv } from "./drive-env.mjs";
import { ENGINE_BINARIES, DEFAULT_ENGINE_ID, resolveEngineProgram } from "../driver.config.mjs";

import { doctorRepoRoot } from "./helpers/portal-bundle.mjs";

const { PROVIDERS } = await import("../../bin/onboard.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
// The doctor arms run from a root with no `.git`, so the checkout's portal bundle, stale or not, is not
// a question they meet: they are not about the bundle (see helpers/portal-bundle.mjs).
const DOCTOR_ROOT = doctorRepoRoot();
const TABLES = { registers: PROVIDERS, engines: ENGINE_BINARIES, defaultEngine: DEFAULT_ENGINE_ID };
// The version a stand-in claims: the engine's own floor, so doctor's floor check does not report it as too old.
const FLOOR_VERSION = ENGINE_BINARIES["anthropic-agent"].floor;

/** A scratch HOME holding only the install's own environment file, with `lines` in it. */
function homeWith(lines) {
  const home = mkdtempSync(join(tmpdir(), "doctor-accepts-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"), lines.join("\n") + "\n");
  return home;
}

/** The real command, with NOTHING inherited: `handRunEnv` over an EMPTY base, not this process's.
 *
 *  `handRunEnv` clears CLEAROTRON_NO_ENV_FILE and INVOCATION_ID, either of which makes the command ignore
 *  the file this arm just wrote. Its default base is this process's environment, and that is wrong HERE:
 *  the suite points CLEAROTRON_CLAUDE_PATH at its mock engine, so the engine-path arm below would pass on a
 *  variable it never set. The empty base keeps the arm about the file and nothing else.
 *
 *  Each drive proves its own file was read by what it asserts — the engine saw the token, or exactly one
 *  name is missing — because doctor loads the file silently and prints no loader line to check. */
function doctor(home, ...args) {
  const r = spawnSync(process.execPath, [join(DOCTOR_ROOT, "bin", "clearotron.mjs"), "doctor", ...args],
    { cwd: DOCTOR_ROOT, encoding: "utf8", timeout: 120000,
      env: handRunEnv({ PATH: "/usr/bin:/bin", HOME: home, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}) });
  if (r.error || r.signal) throw new Error(`doctor did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A fake engine that SUCCEEDS ONLY IF the headless token reaches it, and writes down what it saw — the
 *  witness is the spawned process itself, not anything the command under test says about it. */
function fakeEngine(dir) {
  const log = join(dir, "engine-saw.log");
  const bin = join(dir, "fake-claude.sh");
  writeFileSync(bin, [
    "#!/bin/sh",
    // `--version` ANSWERS AND EXITS, BEFORE ANYTHING IS RECORDED, as the real program does and as
    // mock-claude.mjs already did. Doctor asks a found program its version to compare it against the
    // engine floor, and that question carries no credentials and is not a turn. A stand-in that logged
    // it put an extra line in front of what these arms measure and read as an engine that ran without
    // its token. The version it claims is the floor, so doctor does not report the stand-in as too old.
    `case " $* " in *" --version "*) echo "${FLOOR_VERSION} (stand-in)"; exit 0;; esac`,
    `if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then echo present >> "${log}"; exec "${process.execPath}" "${join(HERE, "mock-claude.mjs")}" "$@"; fi`,
    `echo absent >> "${log}"`,
    `echo "Invalid API key · Please run /login" >&2`,
    "exit 1",
  ].join("\n") + "\n");
  chmodSync(bin, 0o755);
  return { bin, saw: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

// ── 1. THE PROBE ───────────────────────────────────────────────────────────────────────────────────

test("a token kept only in the install's own file reaches the proof turn, and proves the engine", () => {
  const home = homeWith([]);
  try {
    const eng = fakeEngine(home);
    writeFileSync(join(home, ".config", "clearotron", ".env"), [
      "CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_CLAUDE_PATH=${eng.bin}`, "CLAUDE_CODE_OAUTH_TOKEN=test-token-not-real",
    ].join("\n") + "\n");
    const r = doctor(home, "--probe-engine");
    assert.deepEqual(eng.saw(), ["present"], "the spawned engine itself must have received the token from the file");
    assert.match(r.out, /anthropic-agent completed a turn/, "and the command reports the proof it actually got");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE CONTROL: with no token anywhere the engine receives none, and nothing is claimed proven", () => {
  const home = homeWith([]);
  try {
    const eng = fakeEngine(home);
    writeFileSync(join(home, ".config", "clearotron", ".env"), [
      "CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_CLAUDE_PATH=${eng.bin}`,
    ].join("\n") + "\n");
    const r = doctor(home, "--probe-engine");
    assert.deepEqual(eng.saw(), ["absent"], "the fake engine ran and saw no token — so the pair above measured the token, not the fake");
    assert.doesNotMatch(r.out, /completed a turn/);
    assert.match(r.out, /claude setup-token/, "and the signed-out remedy offers the route built for a box with no browser");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("the list the probe is filled from carries every credential every engine declares", () => {
  assert.equal(typeof probe.engineEnvKeys, "function", "the probe exports no single list of the variables it applies");
  const keys = new Set(probe.engineEnvKeys());
  const declared = Object.values(ENGINE_BINARIES).flatMap((s) => [s.env, s.authEnv, s.apiKeyEnv, s.headless?.tokenEnv]).filter(Boolean);
  // A FLOOR, so the property cannot hold vacuously: at least one engine must declare a headless token.
  assert.ok(Object.values(ENGINE_BINARIES).some((s) => s.headless?.tokenEnv), "no engine declares a headless token — this arm would prove nothing");
  for (const k of declared) assert.ok(keys.has(k), `${k} is declared by the engine table and missing from the probe's list`);
  assert.ok(keys.has("CLEAROTRON_AI"));
});

// ── 2. THE REFUSAL ─────────────────────────────────────────────────────────────────────────────────

const UNIT = "/srv/example/.env";
const OWN = "/srv/example/.config/clearotron/.env";

test("a runner that read its own file names it, and the unit file, each by what reads it", () => {
  const r = orderTimeRefusal({}, TABLES, { envFile: UNIT, readFile: OWN });
  assert.ok(r, "an empty environment must be refused");
  assert.match(r.operator, /either of these — both reach a run/);
  assert.ok(r.operator.includes(`${OWN} — the file this runner read when it started`), r.operator);
  assert.ok(r.operator.includes(`${UNIT} — the file background units read`), r.operator);
  assert.ok(r.operator.indexOf(OWN) < r.operator.indexOf(UNIT), "the file this runner actually read comes first");
});

test("one file is named once: under a unit, or when the two are the same file", () => {
  const unitOnly = orderTimeRefusal({}, TABLES, { envFile: UNIT });
  assert.ok(unitOnly.operator.includes(`Set them in ${UNIT} and restart`), "a unit's own EnvironmentFile is the whole answer");
  assert.doesNotMatch(unitOnly.operator, /either of these/);
  const same = orderTimeRefusal({}, TABLES, { envFile: UNIT, readFile: UNIT });
  assert.doesNotMatch(same.operator, /either of these/, "the same file is not offered twice as a choice");
  const neither = orderTimeRefusal({}, TABLES, {});
  assert.match(neither.operator, /clearotron install/, "with no file to name, the wizard is named");
});

test("what the refusal already did well survives: every name, no spend, and no variable to a client", () => {
  const r = orderTimeRefusal({}, TABLES, { envFile: UNIT, readFile: OWN });
  for (const n of r.names) assert.ok(r.operator.includes(n), `${n} is refused for and not named to the operator`);
  assert.match(r.operator, /Nothing has been searched and nothing has been spent/);
  assert.ok(!r.client.includes(UNIT) && !r.client.includes(OWN), "a client is shown no file");
  assert.doesNotMatch(r.client, /CLEAROTRON_[A-Z_]+/, "and no variable");
});

// ── 3. DOCTOR ──────────────────────────────────────────────────────────────────────────────────────

// The register is taken from the table, not typed, so this cannot drift from what the gate reads.
const REG = PROVIDERS.find((p) => (p.credentials ?? []).length);

test("doctor names what the order-time gate refuses for — the engine path included — and keeps exit 0", () => {
  assert.ok(REG, "no register declares a credential — the configured control below would be vacuous");
  const home = homeWith([`CLEAROTRON_DATABASE=${REG.id}`, ...REG.credentials.map((k) => `${k}=x`), "CLEAROTRON_AI=anthropic-agent"]);
  try {
    const r = doctor(home);
    assert.equal(r.status, 0, "an install that is not configured yet is unfinished, not broken — the exit contract holds");
    assert.match(r.out, /Will a search run\?/);
    assert.match(r.out, /a search is refused until this is set in [^:]+: CLEAROTRON_CLAUDE_PATH\s*$/m,
      "the one name the gate refuses for, and doctor used to pass — nothing else is missing on this install");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE CONTROL: with everything the gate asks for, doctor says so and refuses nothing", () => {
  const home = homeWith([`CLEAROTRON_DATABASE=${REG.id}`, ...REG.credentials.map((k) => `${k}=x`),
    "CLEAROTRON_AI=anthropic-agent", "CLEAROTRON_CLAUDE_PATH=/usr/bin/true"]);
  try {
    const r = doctor(home);
    assert.match(r.out, /nothing a search is refused for at order time is missing/);
    assert.doesNotMatch(r.out, /a search is refused until/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── THE ENGINE ROW COUNTS WHAT THE RESOLVER FINDS ────────────────────────────────────────────────
//
// A program on PATH, or the copy Clearotron installed, needs no path written anywhere, and setup
// writes none for the installed copy. Asking only whether the variable was set refused an install whose
// engine the run door would have started.

test("the engine row is present when the resolver finds the program; without a resolver only the variable answers", () => {
  const env = { CLEAROTRON_AI: "anthropic-agent" };
  const name = ENGINE_BINARIES["anthropic-agent"].env;
  const row = (resolveEngine, e = env) => runRequirements(e, { ...TABLES, resolveEngine }).find((r) => r.name === name);
  const asked = [];
  assert.equal(row((id, o) => { asked.push([id, o.env]); return { resolved: "/opt/claude" }; }).present, true);
  assert.deepEqual(asked, [["anthropic-agent", env]], "the resolver is asked about this engine, in the environment being checked");
  assert.equal(row(() => ({ resolved: null })).present, false, "not found is missing");
  assert.equal(row(() => { throw new Error("unreadable"); }).present, false, "a resolver that throws has found nothing");
  assert.equal(row(undefined).present, false, "with no resolver, the unset variable is all there is to see");
  assert.equal(row(undefined, { ...env, [name]: "/opt/claude" }).present, true, "a set variable is present with or without one");
});

test("doctor counts the copy Clearotron installed as the engine a search needs", () => {
  // THE CONTROL is the first doctor arm above: the same install with nothing installed is refused for the
  // engine's program setting.
  const spec = ENGINE_BINARIES["anthropic-agent"];
  const root = mkdtempSync(join(tmpdir(), "doctor-installed-copy-"));
  const dir = join(root, "node_modules", ...spec.package.split("/"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: spec.package, version: "9.9.9", bin: { [spec.fallback]: "bin/claude.exe" } }));
  writeFileSync(join(dir, "bin", "claude.exe"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const home = homeWith([`CLEAROTRON_DATABASE=${REG.id}`, ...REG.credentials.map((k) => `${k}=x`), "CLEAROTRON_AI=anthropic-agent"]);
  try {
    const r = spawnSync(process.execPath, [join(DOCTOR_ROOT, "bin", "clearotron.mjs"), "doctor"], { cwd: DOCTOR_ROOT, encoding: "utf8", timeout: 120000,
      env: handRunEnv({ PATH: "/usr/bin:/bin", HOME: home, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", CLEAROTRON_ENGINES_DIR: root }, {}) });
    if (r.error || r.signal) throw new Error(`doctor did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.match(out, /nothing a search is refused for at order time is missing/, out);
    assert.doesNotMatch(out, /a search is refused until/, out);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("`clearotron start` and the runner hand the engine resolver to the requirement check too", async () => {
  // Doctor is driven above. Start's and the runner's tables are read as they build them: each passes the
  // one resolver, so no door counts only a set variable.
  const { runTables: startTables } = await import("../../bin/start.mjs");
  const { runTables: runnerTables } = await import("../runner.mjs");
  assert.equal((await startTables()).resolveEngine, resolveEngineProgram, "`clearotron start` checks requirements without the resolver");
  assert.equal((await runnerTables()).resolveEngine, resolveEngineProgram, "the runner checks requirements without the resolver");
});

// ── A RUNNER THAT `clearotron start` STARTED ─────────────────────────────────────────────────────
//
// A foreground `clearotron start` reads the install's own file and hands its values to the runner with
// CLEAROTRON_NO_ENV_FILE=1, so the runner read nothing and the refusal named only the units' file: on a
// box with no units, a file that does not exist. Measured on a fresh install, 2026-09-10.

import { childEnv as composeChildEnv, installPaths as layoutOf } from "../../bin/start.mjs";

test("a runner that `clearotron start` started names the file start read, and only that one", () => {
  const unit = "/srv/op/.env", started = "/srv/op/.config/clearotron/.env";
  const r = orderTimeRefusal({}, TABLES, { envFile: unit, readFile: null, startFile: started });
  assert.ok(r.operator.includes(`Set them in ${started} — the file \`clearotron start\` read when it started this runner`),
    "the refusal must name the file this runner's values came from");
  assert.ok(!r.operator.includes(unit), "the units' file reaches nothing on this runner, so it must not be offered");
  // The other two shapes keep their answers: a runner that read its own file names both, a unit's names its own.
  assert.match(orderTimeRefusal({}, TABLES, { envFile: unit, readFile: started, startFile: started }).operator, /either of these — both reach a run/);
  assert.ok(orderTimeRefusal({}, TABLES, { envFile: unit }).operator.includes(`Set them in ${unit} and restart`));
});

test("start hands its file to the worker as a flag no unit carries, and the runner passes it on", () => {
  const start = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  assert.match(start, /start\("the worker", "driver\/runner\.mjs", envs\.worker, \{ args: \["--watch", \.\.\.\(envFileRead\(\) \? \[`--start-env-file=\$\{envFileRead\(\)\}`\] : \[\]\)\], fatal: false \}\)/,
    "the worker is no longer told which file its supervisor read");
  // A unit's runner is started by its unit file, whose command line is fixed: it must never carry the flag,
  // or a unit's refusal would name the supervisor's file instead of its own.
  const exec = readFileSync(join(ROOT, "driver", "systemd", "clearotron-worker.service"), "utf8").split("\n").find((l) => l.startsWith("ExecStart="));
  assert.ok(exec && /runner\.mjs --watch\s*$/.test(exec) && !exec.includes("--start-env-file"), `the worker unit's command line changed: ${exec}`);
  // And nothing of it is in the environments start composes, which is what `--background` writes to the units.
  const envs = composeChildEnv({ ports: { portal: 18802, mcp: 18790 }, paths: layoutOf("/srv/op/trademark"), user: "op@localhost",
    portalSecret: "p", tokenSecret: "t", opsToken: "o", localWorker: true });
  assert.ok(!/start-env-file|START_ENV_FILE/.test(JSON.stringify(envs)), "the handoff leaked into the composition the units' file is written from");
  assert.match(readFileSync(join(ROOT, "driver", "runner.mjs"), "utf8"), /startFile: startEnvFileOf\(process\.argv\)/,
    "and the runner must hand the refusal what its own command line carries");
});

test("the runner accepts start's flag and still refuses an argument it does not know", () => {
  // Driven, because the runner refuses unrecognised arguments on purpose: a flag it did not know would stop
  // every foreground install's worker at its first breath.
  const r = spawnSync(process.execPath, [join(ROOT, "driver", "runner.mjs"), "--start-env-file=/srv/op/.config/clearotron/.env", "--not-a-flag"],
    { encoding: "utf8", env: process.env, timeout: 60_000 });
  assert.equal(r.status, 2, `the runner did not refuse the unknown argument (exit ${r.status}): ${String(r.stderr).slice(0, 300)}`);
  assert.match(String(r.stderr), /unknown argument --not-a-flag/, "it must name the argument it does not know, and not start's flag");
});

test("the runner finds start's file on its own command line, and nowhere else", () => {
  // The sentence above is driven with the file handed in, and the runner only as far as its argument check,
  // so a parse that always answered null would pass both. The parse is driven here.
  const file = "/srv/op/.config/clearotron/.env";
  const rows = [
    [["node", "runner.mjs", "--watch", `--start-env-file=${file}`], file, "the worker start runs"],
    [["node", "runner.mjs", `--start-env-file=${file}`, "--watch"], file, "the flag first"],
    [["node", "runner.mjs", "--watch"], null, "a unit's runner, whose command line never carries it"],
    [["node", "runner.mjs", "--watch", "--start-env-file="], null, "an empty path, which names no file"],
    [["node", "runner.mjs", "--watch", "--start-env-file", file], null, "the bare word, which the runner refuses as unknown"],
  ];
  for (const [argv, want, shape] of rows) assert.equal(startEnvFileOf(argv), want, shape);
});
