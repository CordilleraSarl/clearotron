// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// a refusal that arrived as a stack trace, after the run had written everything.
//
// `start --background` enabled its units in an uncaught loop, so a systemd refusal reached the operator
// as `node:internal/errors:983`, a status code and `stderr: null`. Two separate failures in one line:
// the call ran with `stdio: "ignore"`, discarding systemd's own explanation, and nothing caught the
// throw, so no sentence was written at all.
//
// DRIVEN AGAINST A STAND-IN `systemctl`, not against this box's. The subject is what the command SAYS
// when systemd refuses, and a drive that needed a real refusal would either depend on the state of the
// machine running the suite or have to break it. A shim on PATH refuses deterministically, in each of
// the two shapes the remedy branches on, and touches no user manager at all.
//
// AND THE CONSEQUENCE IS THE POINT, not the diagnosis. `shared/systemd-failure.mjs` carries the
// diagnosis and is armed where it is used by `connect`; what this file is about is the half-started
// inventory, which is `start`'s alone and is the thing the reader could not get anywhere else.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { handRunEnv } from "./drive-env.mjs";   // tracker issue 204
import { startStands } from "../../bin/start.mjs";
import { systemdFailure, CAPTURE_STDERR } from "../../shared/systemd-failure.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const START = join(ROOT, "bin", "start.mjs");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/**
 * Drive `--background` all the way to the enable step, with a `systemctl` that refuses `enable`.
 *
 * Every requirement is supplied, because this drive's subject is PAST all of them — a run that stops at
 * the missing-values refusal never reaches the loop this file is about, and `reachedTheEnable` says so
 * rather than letting an arm read the wrong refusal.
 */
async function driveToEnable(stderrLine) {
  const home = mkdtempSync(join(tmpdir(), "ct203-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  const shim = join(bin, "systemctl");
  // Reload succeeds, enable refuses. Both matter: a shim that failed the reload would land in the
  // OTHER catch, which has its own message and is not this file's subject.
  writeFileSync(shim, `#!/bin/sh\nfor a in "$@"; do\n  if [ "$a" = "enable" ]; then\n    echo ${JSON.stringify(stderrLine)} >&2\n    exit 1\n  fi\ndone\nexit 0\n`);
  chmodSync(shim, 0o755);
  writeFileSync(join(home, ".config", "clearotron", ".env"),
    "CLEAROTRON_DATABASE=corsearch\nCLEAROTRON_AI=claude\nCLEAROTRON_CLAUDE_PATH=/usr/bin/true\n"
    + "CORSEARCH_SESSION_KEY=drive-only-not-a-real-key\n"
    + `CLEAROTRON_REPORTS_DIR=${join(home, "pool")}\n`);
  const ports = { portal: await freePort(), mcp: await freePort(), client: await freePort() };
  const r = spawnSync(process.execPath, [START, "--background"], { encoding: "utf8", timeout: 180_000,
    // A hand-run environment from the one definition. Either of the two variables `handRunEnv` clears
    // would make this drive read no .env, so the values written above never arrive and it stops at an
    // earlier refusal — the guard `reachedTheEnable` names rather than lets an arm read past
    //.
    env: handRunEnv({ HOME: home, PATH: `${bin}:${process.env.PATH}`,
      PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
      CLIENT_MCP_HTTP_PORT: String(ports.client) }) });
  return { home, unitDir: join(home, ".config", "systemd", "user"),
    said: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status,
    clean: () => rmSync(home, { recursive: true, force: true }) };
}

/** Did this drive reach the enable loop? An earlier refusal is a could-not-look, never a pass. */
function reachedTheEnable(d) {
  assert.ok(!/would install units that cannot run a clearance/.test(d.said),
    `this drive stopped at the missing-values refusal and never reached the enable step:\n${d.said.slice(-1200)}`);
  assert.ok(!/user manager is not reachable/.test(d.said),
    `this drive stopped at the daemon-reload refusal, which is a different message:\n${d.said.slice(-1200)}`);
  return d.said;
}

let REFUSED = null;    // systemd declines for a reason that is not the bus
let NOBUS = null;      // systemd declines because there is no session bus

test.before(async () => {
  REFUSED = await driveToEnable("Failed to enable unit: Unit file clearotron-portal.service does not exist.");
  NOBUS = await driveToEnable("Failed to connect to bus: No medium found");
});
test.after(() => { REFUSED?.clean(); NOBUS?.clean(); });

test("203 a systemd refusal arrives as a sentence, and no stack trace reaches the operator", () => {
  const said = reachedTheEnable(REFUSED);
  assert.match(said, /^start: /m, "the refusal did not come out of this command's own failure path");
  for (const trace of [/node:internal\/errors/, /at genericNodeError/, /at checkExecSyncError/, /^\s+at .*\(node:/m]) {
    assert.ok(!trace.test(said), `a raw stack trace still reaches the operator (${trace}):\n${said.slice(-1500)}`);
  }
  assert.equal(REFUSED.code, 1, "it must still exit non-zero — a sentence is not a success");
});

test("203 systemd's own words are printed, not discarded by `stdio: ignore`", () => {
  const said = reachedTheEnable(REFUSED);
  assert.match(said, /Failed to enable unit: Unit file clearotron-portal\.service does not exist\./,
    `the reason systemd gave was thrown away before anyone could read it:\n${said.slice(-1500)}`);
});

test("203 the reader is told which unit refused and what is running", () => {
  const said = reachedTheEnable(REFUSED);
  assert.match(said, /HALF STARTED/, `no statement of what happened to the install:\n${said.slice(-1500)}`);
  assert.match(said, /was NOT enabled/, "the refusing unit is not named");
  assert.ok(said.includes(REFUSED.unitDir),
    `the unit files were rendered somewhere and the reader is not told where:\n${said.slice(-1500)}`);
  assert.match(said, /clearotron stop/, "nothing tells the reader how to take back down what is up");
});

test("203 the generic post-write trailer does not double the specific one", () => {
  // Both were printed at first, and the pair read as two answers to one question. The generic line is
  // still right on every OTHER post-write refusal — the arm below holds it there — so this is about
  // suppression at one site, not deletion.
  const said = reachedTheEnable(REFUSED);
  assert.ok(!/This run had already written state/.test(said),
    `the generic trailer printed beside the specific one:\n${said.slice(-1500)}`);
});

test("203 and the generic trailer still fires where nothing better was said", async () => {
  // THE PLANT FOR THE SUPPRESSION. `fatal(msg, { stated: true })` is opt-in, and an opt-in that turned
  // out to be always-on would delete the re-running-is-safe line from every other post-write refusal in
  // this command with nothing going red. So it is driven at a DIFFERENT post-write refusal.
  //
  // WHICH ONE CHANGED WITH tracker issue 216. This used to withhold the engine values and stop at the
  // missing-requirements refusal. The owner ruled on 2026-09-06 that an install comes up without those
  // and every run is refused at ORDER time instead, so that refusal is gone from this command and this
  // arm lost its trigger — not its subject. It drives the CLIENT DOOR'S refusal now: an occupied port
  // makes `enablePlan` impossible, and the fatal for that sits after `markStateWritten()` and passes no
  // `stated`, which is exactly the shape this arm needs.
  //
  // WHY NOT AN OCCUPIED PORT, which was the obvious swap and is wrong: `start` probes the ports BEFORE
  // it writes anything, so a held port refuses with "already in use" and never reaches the trailer. That
  // was driven, not reasoned about. The revocation list is read AFTER `markStateWritten()`, so a path
  // that cannot be a file is a post-write refusal with nothing else to say — which is what this arm is.
  const home = mkdtempSync(join(tmpdir(), "ct203g-"));
  // Real free ports, not 0: the launcher refuses "0" by name as not a port number, and that refusal is
  // BEFORE any state is written — the drive would prove nothing and say so.
  const ports = { portal: await freePort(), mcp: await freePort(), client: await freePort() };
  // HELD, so the client door's port is genuinely taken when the plan asks.
  // A DIRECTORY WHERE THE REVOCATION LIST'S FILE BELONGS. `ensureDenylistFile` cannot write it and the
  // refusal that follows is post-write and carries no `stated`.
  mkdirSync(join(home, ".config", "clearotron", "token-denylist"), { recursive: true });
  try {
    const r = spawnSync(process.execPath, [START, "--background"], { encoding: "utf8", timeout: 180_000,
      // CLEAROTRON_NO_ENV_FILE is set BACK here on purpose: this drive wants a refusal that comes from
      // the box rather than from a file, and reading one would be a way to accidentally have values.
      env: handRunEnv({ HOME: home, CLEAROTRON_NO_ENV_FILE: "1",
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client),
        CLEAROTRON_DATABASE: undefined, CLEAROTRON_AI: undefined, CLEAROTRON_CLAUDE_PATH: undefined }) });
    const said = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.match(said, /could not use the revocation list/,
      `this drive did not reach a post-write refusal, so it proves nothing about the trailer:\n${said.slice(-1200)}`);
    assert.match(said, /This run had already written state/,
      `the generic trailer is gone from a refusal that has nothing else to say:\n${said.slice(-1200)}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("203 the bus branch and the not-the-bus branch give DIFFERENT remedies", () => {
  // The defect this half inherits: one remedy appended to every failure, so a
  // unit that would not start for a bound port told the reader to export XDG_RUNTIME_DIR. A confident
  // remedy for a cause that is not the reader's costs more than no remedy.
  const refused = reachedTheEnable(REFUSED);
  const nobus = reachedTheEnable(NOBUS);
  assert.match(refused, /Read what systemd itself says/);
  assert.ok(!/export XDG_RUNTIME_DIR/.test(refused),
    `a refusal that is not about the bus was given the bus remedy:\n${refused.slice(-1500)}`);
  assert.match(nobus, /export DBUS_SESSION_BUS_ADDRESS/);
  assert.ok(!/Read what systemd itself says/.test(nobus),
    `a missing bus was sent to \`systemctl status\`, which needs the bus it has not got:\n${nobus.slice(-1500)}`);
  // Both still say what stands: the half-started inventory is not a property of one branch.
  for (const said of [refused, nobus]) assert.match(said, /HALF STARTED/);
});

test("203 the OTHER systemd catch still lands, and now leads with what systemd said", async () => {
  // NOTHING DRIVES THIS PATH ANYWHERE ELSE — `reachedTheEnable` above excludes it by name, so the
  // daemon-reload catch was changed with no arm over it. It keeps its own two-cause remedy, which is
  // right and is not the shared one: at that point the question is whether this session can reach a
  // user manager at all, and the answer is lingering or the two exports, not a unit's journal.
  //
  // AND IT MUST NOT DERIVE THE BUS. `connect` passes `userBusEnv()` at every systemctl call it makes,
  // `showUnit` included. This file has five and a first cut of this change derived it at two — worse
  // than at none, because `enable --now` would then succeed against a bus the health read three screens
  // down still does not ask, and every unit would start and be reported as not running. Held to the
  // uniform shape here so that improving it is a deliberate act with its own drive.
  const home = mkdtempSync(join(tmpdir(), "ct203r-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "systemctl");
  writeFileSync(shim, '#!/bin/sh\necho "Failed to connect to bus: No medium found" >&2\nexit 1\n');
  chmodSync(shim, 0o755);
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"),
    "CLEAROTRON_DATABASE=corsearch\nCLEAROTRON_AI=claude\nCLEAROTRON_CLAUDE_PATH=/usr/bin/true\n"
    + "CORSEARCH_SESSION_KEY=drive-only-not-a-real-key\n"
    + `CLEAROTRON_REPORTS_DIR=${join(home, "pool")}\n`);
  const ports = { portal: await freePort(), mcp: await freePort(), client: await freePort() };
  try {
    const r = spawnSync(process.execPath, [START, "--background"], { encoding: "utf8", timeout: 180_000,
      env: handRunEnv({ HOME: home, PATH: `${bin}:${process.env.PATH}`,
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client) }) });
    const said = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.match(said, /user manager is not reachable/,
      `this drive did not reach the daemon-reload catch:\n${said.slice(-1200)}`);
    assert.match(said, /Failed to connect to bus: No medium found/,
      `systemd's own words are still being discarded here — the half that was `
      + `never done in this file:\n${said.slice(-1200)}`);
    assert.match(said, /loginctl enable-linger/, "the lingering cause is gone");
    assert.match(said, /export DBUS_SESSION_BUS_ADDRESS/, "the bus-unset cause is gone");
    // This one HAS nothing better to say about consequence, so the generic trailer is right here.
    assert.match(said, /This run had already written state/);
    assert.equal(r.status, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("203 the inventory names every unit already up, not just the one that refused", () => {
  // A refusal on the third unit leaves two running, and "half started" is not enough to act on when the
  // reader is deciding whether the portal in front of them is theirs. Read at the function, because a
  // drive can only ever produce whichever unit the set happens to enable first.
  const none = startStands({ unit: "a.service", enabled: [], unitDir: "/u", invocation: "clearotron start" });
  assert.ok(!/enabled and started/.test(none),
    "a run that enabled nothing claimed it had enabled something");
  assert.ok(!/nothing after it was reached/.test(none),
    "with nothing enabled there is no 'after it' to describe");
  const some = startStands({ unit: "c.service", enabled: ["a.service", "b.service"], unitDir: "/u",
    invocation: "clearotron start" });
  assert.match(some, /enabled and started: a\.service, b\.service/);
  assert.match(some, /c\.service was NOT enabled, and nothing after it was reached/);
});

test("203 a caller with nothing to say about consequence is not given one", () => {
  // `stands` is the caller's and is omitted rather than invented. `connect` and `start` write different
  // things and leave the box in different states, which is why the shared file never guesses it.
  const bare = systemdFailure({ stderr: "Unit x.service not found." }, { unit: "x.service" });
  assert.match(bare.message, /Unit x\.service not found\./);
  assert.ok(!/HALF/.test(bare.message), "the shared file invented a consequence its caller did not give");
  assert.deepEqual(CAPTURE_STDERR, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
});
