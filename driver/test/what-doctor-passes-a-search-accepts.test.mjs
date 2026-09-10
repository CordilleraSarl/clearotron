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
import { orderTimeRefusal } from "../run-requirements.mjs";
import { ENGINE_BINARIES, DEFAULT_ENGINE_ID } from "../driver.config.mjs";
const { PROVIDERS } = await import("../../bin/onboard.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const TABLES = { registers: PROVIDERS, engines: ENGINE_BINARIES, defaultEngine: DEFAULT_ENGINE_ID };

/** A scratch HOME holding only the install's own environment file, with `lines` in it. */
function homeWith(lines) {
  const home = mkdtempSync(join(tmpdir(), "doctor-accepts-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"), lines.join("\n") + "\n");
  return home;
}

/** The real command, with nothing inherited: HOME and PATH pinned so the arm measures the code, not the box. */
function doctor(home, ...args) {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor", ...args],
    { cwd: ROOT, encoding: "utf8", timeout: 120000,
      env: { PATH: "/usr/bin:/bin", HOME: home, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" } });
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
