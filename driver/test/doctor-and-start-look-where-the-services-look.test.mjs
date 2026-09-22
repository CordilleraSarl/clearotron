// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real `doctor` and `start --background` commands in a scratch home
//
// DOCTOR AND START LOOK FOR THE ENGINE'S PROGRAM WHERE A RUN LOOKS FOR IT.
//
// Both ask the order-time gate whether a search would be refused, and the gate asks the engine resolver:
// a path setting, then PATH, then the copy setup installed. They handed it the settings and no PATH, so a
// `claude` on the services' PATH, with no path setting and nothing installed by setup, was not counted.
// Doctor printed "a search is refused until this is set … CLEAROTRON_CLAUDE_PATH", `start --background`
// printed "every run is refused at order time", and the run itself found the program and ran.
//
// The services' PATH could not simply be handed over as read. Every shipped unit writes
// `Environment=PATH=%h/.local/bin:%h/.npm-global/bin:…`, and the unit reader expanded `%h` only in
// `EnvironmentFile=` paths, so the PATH it returned named a folder called `%h/.local/bin`, which exists
// nowhere. Each arm below therefore plants the program in `<home>/.local/bin`, the first folder of the
// shipped PATH, which only an expanded `%h` reaches, and never on the PATH of the command being driven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unitEnvironment, unitValue } from "../unit-environment.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { handRunEnv } from "./drive-env.mjs";
import { withFreePorts } from "./helpers/free-port.mjs";
const { PROVIDERS } = await import("../../bin/onboard.mjs");
const { BACKGROUND_UNITS } = await import("../../bin/start.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SYSTEMD = join(ROOT, "driver", "systemd");
const WORKER = "clearotron-worker.service";
const PROGRAM = ENGINE_BINARIES["anthropic-agent"].fallback;
const PATH_SETTING = ENGINE_BINARIES["anthropic-agent"].env;
// The register is taken from the table, not typed, so the configuration below is one the gate accepts.
const REG = PROVIDERS.find((p) => (p.credentials ?? []).length);
/** Everything the gate asks for except the engine's program. */
const CONFIGURED = [`CLEAROTRON_DATABASE=${REG?.id}`, ...(REG?.credentials ?? []).map((k) => `${k}=x`), "CLEAROTRON_AI=anthropic-agent"];

/** An executable file under the name the engine runs, in `dir`. */
function plantProgram(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PROGRAM), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

test("the shipped worker unit sets its PATH with %h, so the arms below measure its expansion", () => {
  // THE PRECONDITION. If the unit stopped writing `%h` into its PATH, the plants below would still pass
  // and prove nothing about the expansion this file is about.
  assert.ok(REG, "no register declares a credential, so the configured installs below would be refused for it");
  assert.match(readFileSync(join(SYSTEMD, WORKER), "utf8"), /^Environment=PATH=%h\/\.local\/bin:/m,
    "the worker unit's PATH no longer starts with %h/.local/bin, where these arms plant the program");
});

// ── THE UNIT READER ────────────────────────────────────────────────────────────────────────────────

test("an Environment= value has %h expanded to the unit's home, as systemd does", () => {
  const r = unitEnvironment({
    units: [{ name: "u.service", text: "Environment=PATH=%h/.local/bin:/usr/bin A=plain\n" }],
    home: "/srv/example" });
  assert.equal(r.known, true, r.why ?? "");
  assert.equal(unitValue(r, "PATH").value, "/srv/example/.local/bin:/usr/bin");
  assert.equal(unitValue(r, "A").value, "plain", "a value with no specifier is carried as written");
});

test("an escaped percent in an Environment= value becomes one percent, and %%h is not the home", () => {
  // systemd reads `%%` as a literal `%`, so these reach the service as `50%`, `%h` and `x%y`.
  const r = unitEnvironment({
    units: [{ name: "u.service", text: "Environment=A=50%% B=%%h C=x%%y D=%h%%\n" }],
    home: "/srv/example" });
  assert.equal(r.known, true, r.why ?? "");
  assert.deepEqual(r.env, { A: "50%", B: "%h", C: "x%y", D: "/srv/example%" });
  // With no home, an escaped `%%h` is still a literal and needs none; a real `%h` is a gap in the reading.
  assert.equal(unitEnvironment({ units: [{ name: "u.service", text: "Environment=B=%%h\n" }] }).env.B, "%h");
});

test("the shipped worker unit's PATH comes back with the home in it and no %h left", () => {
  const home = "/srv/example";
  const r = unitEnvironment({ units: [{ name: WORKER, text: readFileSync(join(SYSTEMD, WORKER), "utf8") }],
    readEnvFile: () => "", home });
  const path = unitValue(r, "PATH").value;
  assert.ok(path, `the worker unit's PATH was not read (${r.why})`);
  assert.equal(path.split(":")[0], `${home}/.local/bin`);
  assert.doesNotMatch(path, /%h/);
});

test("an Environment= value whose %h cannot be expanded is a gap in the reading, never a literal", () => {
  // A literal `%h/.local/bin` on a PATH is a folder that does not exist, so it answers "no program" for a
  // reader that could not look: the same rule the file branch keeps for `EnvironmentFile=%h/.env`.
  const r = unitEnvironment({ units: [{ name: "u.service", text: "Environment=PATH=%h/.local/bin:/usr/bin\n" }] });
  assert.equal(r.known, false, "an unexpanded %h must not read as a whole picture");
  assert.match(r.why, /PATH=%h\/\.local\/bin:\/usr\/bin \(unresolved systemd specifier\)/);
  assert.equal(unitValue(r, "PATH").state, "unknown");
});

// ── DOCTOR ─────────────────────────────────────────────────────────────────────────────────────────

/** The real command, from a shell whose PATH holds no program: `handRunEnv` over an EMPTY base, so the
 *  suite's own engine path setting cannot reach it and the arm is about the PATH it is given. */
function doctor(home, shellPath = "/usr/bin:/bin") {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"], {
    cwd: ROOT, encoding: "utf8", timeout: 120_000,
    env: handRunEnv({ PATH: shellPath, HOME: home, CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}) });
  if (r.error || r.signal) throw new Error(`doctor did not come back (signal=${r.signal} error=${r.error?.message}), so nothing here was measured`);
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.match(out, /Will a search run\?/, `doctor never reached the check these arms are about:\n${out.slice(0, 900)}`);
  return out;
}

/** A home with the shipped background units installed as written, reading `<home>/.env`. */
function hostedHome({ plant, settingsPath = null }) {
  const home = mkdtempSync(join(tmpdir(), "services-path-doctor-"));
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const u of BACKGROUND_UNITS) writeFileSync(join(unitDir, u), readFileSync(join(SYSTEMD, u), "utf8"));
  // `settingsPath` is a PATH line in the file the units load, given as a function of the home.
  const lines = [...CONFIGURED, ...(settingsPath ? [`PATH=${settingsPath(home)}`] : [])];
  writeFileSync(join(home, ".env"), lines.join("\n") + "\n");
  if (plant) plantProgram(join(home, ".local", "bin"));
  return home;
}

test("doctor counts a program on the units' PATH as the engine a search needs", () => {
  const home = hostedHome({ plant: true });
  try {
    const out = doctor(home);
    assert.match(out, /nothing a search is refused for at order time is missing from the units' environment/, out);
    assert.doesNotMatch(out, /a search is refused until/, out);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("THE CONTROL: the same units with no program anywhere still refuse for the engine's path setting", () => {
  const home = hostedHome({ plant: false });
  try {
    const out = doctor(home);
    assert.match(out, new RegExp(`a search is refused until this is set in the units' environment: ${PATH_SETTING}\\s*$`, "m"), out);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a PATH in the units' settings file is the one doctor searches, since on systemd it wins over the unit's", () => {
  // Every shipped unit writes its PATH after its EnvironmentFile= line, and systemd still gives the service
  // the file's PATH. So a program only on the unit's PATH is not found by the services, and doctor must not
  // count it; and a program only on the file's PATH is found, and doctor must count it.
  const shadowed = hostedHome({ plant: true, settingsPath: () => "/usr/bin:/bin" });
  const own = hostedHome({ plant: false, settingsPath: (home) => `${join(home, "tools")}:/usr/bin:/bin` });
  try {
    const out = doctor(shadowed);
    assert.match(out, new RegExp(`a search is refused until this is set in the units' environment: ${PATH_SETTING}\\s*$`, "m"), out);
    plantProgram(join(own, "tools"));
    const found = doctor(own);
    assert.match(found, /nothing a search is refused for at order time is missing from the units' environment/, found);
  } finally { for (const h of [shadowed, own]) rmSync(h, { recursive: true, force: true }); }
});

test("with no units, doctor looks on the PATH that `clearotron start` hands its children", () => {
  // No units: the services are the children of a foreground `clearotron start`, which inherit the PATH of
  // the shell it runs in. So the program is planted on the shell's PATH, and the control is the same
  // install with that folder left off.
  const home = mkdtempSync(join(tmpdir(), "services-path-shell-"));
  try {
    mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
    writeFileSync(join(home, ".config", "clearotron", ".env"), CONFIGURED.join("\n") + "\n");
    const bin = join(home, "bin");
    plantProgram(bin);
    const found = doctor(home, `${bin}:/usr/bin:/bin`);
    assert.match(found, /nothing a search is refused for at order time is missing from your environment file/, found);
    const control = doctor(home);
    assert.match(control, new RegExp(`a search is refused until this is set in your environment file: ${PATH_SETTING}\\s*$`, "m"), control);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ── START --BACKGROUND ──────────────────────────────────────────────────────────────────────────────

/**
 * The real `start --background`, in a scratch home, as far as its announcement of what a run is refused for.
 *
 * NO SYSTEMD CAN BE REACHED FROM HERE. The environment is built over an empty base, so it carries neither
 * XDG_RUNTIME_DIR nor DBUS_SESSION_BUS_ADDRESS, and `systemctl --user` fails before it touches any unit.
 * The command stops there, after the announcement this arm reads. Everything it writes is under `home`.
 *
 * The ports are ephemeral ones, taken and released so the drive gets past the port checks to its subject,
 * and anything can take one before the command probes it. So the drive runs under `withFreePorts`, which
 * repeats it in a fresh home on fresh numbers when start says a port was taken.
 */
async function driveStart(opts) {
  return withFreePorts(["portal", "mcp", "client"], (ports) => driveStartOn(ports, opts), { discard: (d) => d.clean() });
}
function driveStartOn(ports, { plant, settingsPath = null }) {
  const home = mkdtempSync(join(tmpdir(), "services-path-start-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"), "PORTAL_LOCAL_USER=drive@localhost\n");
  // A PATH line in `<home>/.env`, the file the units load.
  if (settingsPath) writeFileSync(join(home, ".env"), `PATH=${settingsPath}\n`);
  if (plant) plantProgram(join(home, ".local", "bin"));
  const env = handRunEnv({ HOME: home, PATH: "/usr/bin:/bin",
    PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
    CLIENT_MCP_HTTP_PORT: String(ports.client) }, {});
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "start.mjs"), "--background"], { encoding: "utf8", timeout: 180_000, env });
  const said = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { said, clean: () => rmSync(home, { recursive: true, force: true }) };
}

/** The names the announcement lists, read off its own lines, and a positive check that it was printed. */
function announced(said) {
  const from = said.indexOf("This install is not configured to run a search yet");
  assert.notEqual(from, -1, `start never announced what a run is refused for, so there is nothing to read:\n${said.slice(0, 1200)}`);
  const to = said.indexOf("Nothing has been installed that cannot run", from);
  assert.notEqual(to, -1, `the announcement has no end this arm recognises:\n${said.slice(from, from + 1200)}`);
  return [...said.slice(from, to).matchAll(/^\s+([A-Z][A-Z0-9_]+) — /gm)].map((m) => m[1]);
}

test("start --background counts a program on the worker unit's PATH, and says a run is refused only for what is missing", async () => {
  const d = await driveStart({ plant: true });
  try {
    const names = announced(d.said);
    // The drive's install has no register, so the announcement is printed either way: this is what makes
    // the absence below a reading rather than a silence.
    assert.ok(names.includes("CLEAROTRON_DATABASE"), `the announcement lists: ${names.join(", ")}`);
    assert.ok(!names.includes(PATH_SETTING),
      `a run is announced as refused for ${PATH_SETTING}, though the program is on the worker unit's PATH:\n${names.join(", ")}`);
  } finally { d.clean(); }
});

test("start --background searches the PATH in the units' settings file, which wins over the worker unit's own", async () => {
  // The program is on the unit's PATH and not on the file's, so the worker would not find it.
  const d = await driveStart({ plant: true, settingsPath: "/usr/bin:/bin" });
  try {
    const names = announced(d.said);
    assert.ok(names.includes(PATH_SETTING),
      `the program on the unit's PATH was counted, though the settings file's PATH is the one the worker gets:\n${names.join(", ")}`);
  } finally { d.clean(); }
});

test("THE CONTROL: with no program on the worker unit's PATH, start still announces the engine's path setting", async () => {
  const d = await driveStart({ plant: false });
  try {
    const names = announced(d.said);
    assert.ok(names.includes(PATH_SETTING), `the announcement lists: ${names.join(", ")}`);
  } finally { d.clean(); }
});
