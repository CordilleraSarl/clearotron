#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// connect.mjs — pick an assistant; get the one thing that assistant needs.
//
// ── THE OWNER'S QUESTION ────────────────────────────────────────────────────
//
// He installed the product, reached the portal at 127.0.0.1 with no configuration, and could not
// connect anything: *"i didnt need to mint a key for the UI or open a tunnel i just ran clearotron
// start? and this key minting, what is that?"* Then: *"AND it might not just be cowork, it might be
// chatgpt or perplexity. or [another agent platform]. COME ON MAN. this shouldn't be so hard."*
//
// It is not hard once the right question is asked. What varies is not the reader's network — it is what
// each CLIENT can accept, which is a fact we hold and they should never have to work out. So this asks
// one thing and answers only for that one client. The clients and their resolution are data in
// `shared/connect-clients.mjs`; there is no branch on a client's name here, and an arm refuses one.
//
// ── ONE PRESS, NOT A PROCEDURE (owner, 2026-08-31) ───────────────────────────────────────────────
//
// *"One press does all of it, invisibly: enables whatever the chosen assistant needs, mints the
// credential… No second step, no page to visit, nothing to configure."* That is a ruling about the
// portal's Connect button, and this verb is its command-line twin: picking an assistant does the whole
// job, including turning on the client door when that assistant needs it.
//
// SO THERE IS NO CONSENT PROMPT, AND THERE IS STILL A SENTENCE. An earlier cut of this file stopped and
// asked before touching the fence. The ruling removes the stopping; it does not ask for silence, and a
// command that turns on a door to this install without ever saying it did would be reporting less than
// it changed. The line is printed AFTER the fact, costs no step, and is what makes the change legible
// in a terminal scrollback — the closest thing this path has to an audit the reader will actually see.
//
// ── WHAT IS NEVER PRINTED ────────────────────────────────────────────────────────────────────────
//
// The account key is written to stdout ONCE and nowhere else — not to a log, not to the journal, not
// into an error. Possession is the credential. `--dry-run` exists so this command can be exercised, by
// a person or an arm, without a live key ever being produced.

// FIRST IMPORT — the rename layer must apply before any module-top env capture evaluates.
import "../shared/env-local.mjs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { CONNECT_CLIENTS, clientById, whatItNeeds } from "../shared/connect-clients.mjs";
import { stdioConnectFor, STDIO_SHAPES } from "../shared/stdio-connect.mjs";
import { clientDoorAddress, clientDoorPort, clientDoorState, enablePlan, applyEnablePlan, describeChange, recordConnectKey, CLIENT_DOOR_UNIT } from "../shared/client-door.mjs";
import { mintToken, tokenId, accountsForEmail, loadGrants } from "../shared/scope.mjs";
import { envFrom } from "../shared/env-aliases.mjs";
import { atomicWrite } from "../driver/progress.mjs";
// — F40. SERVER_INSTALL_SET is what `bin/start.mjs` re-exports as
// BACKGROUND_UNITS; taken from shared/ so this verb does not reach into another bin/ entry point.
import { SERVER_INSTALL_SET } from "../shared/server-units.mjs";
import { unitEnvironment, unitValue, couldNotDetermine } from "../driver/unit-environment.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The environment `systemctl --user` needs, with the session bus filled in when it can be derived.
 *
 *. Under `su`/`sudo -u` these two are unset and systemctl cannot find the bus.
 * `/run/user/<uid>` is where it lives when a user session exists, so this supplies them from the uid
 * rather than asking a reader to. When the directory is absent there IS no user bus and no value would
 * help — busRemedy() says so in words instead.
 */
function userBusEnv() {
  const env = { ...process.env };
  if (env.XDG_RUNTIME_DIR && env.DBUS_SESSION_BUS_ADDRESS) return env;
  const dir = env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? ""}`;
  if (!existsSync(dir)) return env;             // no session: the remedy is words, not a guessed value
  env.XDG_RUNTIME_DIR = dir;
  env.DBUS_SESSION_BUS_ADDRESS ||= `unix:path=${dir}/bus`;
  return env;
}

/** What to tell a reader whose shell has no user bus — the two exports, by name. */
function busRemedy() {
  const uid = process.getuid?.() ?? "$(id -u)";
  return `systemctl --user needs a login session's bus, and this shell has none — which is what \`su\` and \`sudo -u\` leave you with.\n`
    + `Either log in as this user properly (\`machinectl shell\`, or ssh as them), or export the two the bus is found through:\n`
    + `  export XDG_RUNTIME_DIR=/run/user/${uid}\n`
    + `  export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus\n`
    + `Nothing you have done is lost: the env file and the denylist were written before this step.`;
}

const UNIT_DIR = join(homedir(), ".config", "systemd", "user");
const ENV_PATH = join(homedir(), ".env");
// Where the revocation list lives when this install has never named one — created by connect so the
// door is BORN consulting it (; measured: no denylist is configured on production,
// and `isRevoked()` fails open on an unset path, so assuming one makes every issued key unrevokable).
const DENYLIST_PATH = join(homedir(), ".config", "clearotron", "token-denylist");
const say = (s = "") => console.log(s);

/**
 * The environment to reason about the RUNNING product with — F40, and the same root as F34.
 *
 * `doctor` invented problems; this verb invented problems AND REFUSED TO ACT on them. Measured on a
 * correctly-running install, in one sitting: "this installation is not on the internet yet" while the
 * public URL was set and the route answered from outside; "this install has no access file" while the
 * access file had existed for hours; "port 18811 is already in use, so the door cannot listen there"
 * while the door was up on 18812 and public. The owner hand-copied SEVEN already-correct values from
 * the units' env file into the CLI's to get past refusals about configuration that was already right.
 *
 * The asymmetry was in one line. This verb WRITES to ~/.env — it checks that file for the door secret,
 * a few lines below — and READ from process.env, which on a packaged install is
 * node_modules/clearotron/.env. Two files, one of them the units', and the reasoning used the other.
 *
 * Returns the unit environment when it can be read, and says so when it cannot. A caller that cannot
 * tell must not refuse: that is the acceptance criterion, and the reason `known` is returned rather
 * than being collapsed into a usable-looking empty object.
 */
function runningEnv() {
  const units = [...SERVER_INSTALL_SET, CLIENT_DOOR_UNIT]
    .map((u) => ({ name: u, text: existsSync(join(UNIT_DIR, u)) ? readFileSync(join(UNIT_DIR, u), "utf8") : null }));
  if (!units.some((u) => u.text != null))
    // No units: `start` supervises and this shell's environment is the honest thing to read. Not a
    // could-not-look — there is genuinely no unit environment to be wrong about.
    return { env: process.env, known: true, hosted: false, why: null };
  const resolved = unitEnvironment({
    units, home: homedir(),
    readEnvFile: (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } } });
  return { env: resolved.known ? resolved.env : process.env, known: resolved.known, hosted: true,
    why: resolved.why, resolved };
}

/** What this deployment has to offer, read once and handed to the pure resolver. */
function deploymentHas(env = process.env) {
  const door = clientDoorState({ env, unitDir: UNIT_DIR, exists: existsSync });
  return {
    // EVERY SHAPE, RESOLVED ONCE. A row picks its own; nothing here knows a client's name.
    stdioRoutes: Object.fromEntries(Object.keys(STDIO_SHAPES).map((shape) =>
      [shape, stdioConnectFor(shape, { workDir: env.CLEAROTRON_WORK_DIR || null })])),
    // WHERE THE DOOR BINDS — not an address handed to any assistant. It is the loopback address the
    // unit listens on, and `enablePlan` needs it to write the unit. It used to be passed to the
    // resolver as `localAddress` and served to Cowork as somewhere to connect, which is the false
    // offer §3 refutes: no assistant reaches a loopback address, whatever machine
    // it appears to run on. Renamed so that reading it as a connect address takes a deliberate act.
    doorBindAddress: clientDoorAddress(env),
    // THE ONE ADDRESS ANY ASSISTANT IS EVER GIVEN.
    publicAddress: env.CLEAROTRON_CLIENT_MCP_URL || null,
    port: clientDoorPort(env),
    // THE IDENTITY THE INSTALL ALREADY ESTABLISHED. An earlier cut invented a variable for this, and the
    // tree already had one: `bin/start.mjs` resolves the local operator as
    // `PORTAL_LOCAL_USER || <whoami>@localhost` and writes the grants file against it. Inventing a second
    // name for the same person would have produced a key issued to an identity the guest list never heard
    // of — the enrolment refusal firing on a mismatch the product created itself.
    operator: env.PORTAL_LOCAL_USER || `${userInfo().username}@localhost`,
  };
}

/**
 * Can this machine actually listen there? Asked by BINDING, because that is the only answer that is not
 * a guess — and because the port being answered by somebody ELSE'S process is the case that fooled a
 * reader once already (measured 2026-08-31: 18811 held by another user's client face, my own unit
 * crash-looping beside it, and a listening socket reading as proof the door was up).
 */
function portIsFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
}

/**
 * WHOSE socket is on this port — F39, the question `portIsFree` was standing in for.
 *
 * Binding answers "could I listen here", which on a `--background` install is permanently NO, because
 * our own door is already listening. That refused every time on a correctly configured machine and the
 * workaround was to stop a healthy service so this verb could prove it could have started one.
 *
 * FOUR-VALUED, because the four states want four different responses:
 *   free     — nothing is there.
 *   ours     — our own door unit is up and this is its port. The state this verb is trying to REACH.
 *   stranger — something answers and it is not ours. The 2026-08-31 incident, still refused.
 *   unknown  — we could not ask systemd. Never a refusal: a reader that failed must not block a
 *              machine that is probably correct, which is how the permanent refusal came to exist.
 *
 * @param {number} port
 * @param {boolean} bound  whether a test bind succeeded (nothing is listening)
 */
function portOwnerOf(port, bound) {
  if (bound) return "free";
  // Something holds it. Ask systemd whether the holder is our own door, rather than inferring from the
  // port number — the port answering was never proof of whose process it is, which is the whole lesson
  // of the incident this check was written for.
  let state;
  try {
    const out = execFileSync("systemctl",
      ["--user", "show", CLIENT_DOOR_UNIT, "-p", "ActiveState", "-p", "SubState"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    state = Object.fromEntries(out.trim().split("\n").map((l) => l.split("=")));
  } catch { return "unknown"; }
  if (!state || state.ActiveState === undefined) return "unknown";
  const up = state.ActiveState === "active" && state.SubState === "running";
  if (!up) return "stranger";
  // Our door is up. Is THIS the port it was configured to listen on? The unit's env is the authority,
  // not this shell's — same root as F40, and asking the wrong file here would hand back "stranger" for
  // our own healthy door on any install whose port is not the default.
  const running = runningEnv();
  const configured = clientDoorPort(running.env);
  if (!running.known) return "unknown";
  return configured === port ? "ours" : "stranger";
}

/** A blocking pause, so the health check below asks about a door that has had time to fail. */
const settle = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Is the unit STILL up? Not "was the start accepted".
 *
 * `Type=simple` marks a unit active the instant it forks, so a door that exits on its first line reports
 * healthy for about a second. This settles, then requires the unit to be active AND running AND never to
 * have restarted — a restart counter above zero means it has already died at least once, whatever it
 * says right now.
 */
function unitIsHealthy(name) {
  settle(3000);
  try {
    const out = execFileSync("systemctl",
      ["--user", "show", name, "-p", "ActiveState", "-p", "SubState", "-p", "NRestarts"],
      { encoding: "utf8" });
    const f = Object.fromEntries(out.trim().split("\n").map((l) => l.split("=")));
    return f.ActiveState === "active" && f.SubState === "running" && f.NRestarts === "0";
  } catch { return false; }
}

/** Turn the door on. Only reached because the chosen assistant cannot work without it. */
function enableTheDoor({ have, identity, client = null, dryRun, portFree, portOwner = null, env = process.env, envKnown = true }) {
  // F36 — whether this door is reachable from outside is a FACT we hold, so the sentence answers to it
  // rather than being printed unconditionally. `publicAddress` comes from the units' environment now
  // (F40), which is the only place it was ever true.
  const reach = { publicAddress: have.publicAddress, reachabilityKnown: envKnown };
  // Resolved HERE because it reads a file, and handed to the pure planner as a fact. A door this verb
  // opens for an identity that is granted nothing is a credential with no reach.
  let granted;
  try { granted = accountsForEmail(identity, loadGrants()); } catch { granted = undefined; }
  // The env file the UNIT reads, not this shell — found by the drive: a shell-exported secret passed
  // every plan check while the door died at birth reading an env file that lacked it.
  const unitEnvHasSecret = existsSync(ENV_PATH)
    ? /^[ \t]*TRADEMARK_MCP_TOKEN_SECRET[ \t]*=[ \t]*\S/m.test(readFileSync(ENV_PATH, "utf8"))
    : false;
  const plan = enablePlan({ env, address: have.doorBindAddress, identity,
    grantedAccounts: granted, checkoutDir: REPO, denylistPath: DENYLIST_PATH, unitEnvHasSecret,
    portIsFree: (p) => (p === have.port ? portFree : false),
    // F39 — whose socket, not merely whether we could take it. Only the port we actually want is
    // answerable; any other is left to the bind result, which is what it was always based on.
    portOwner: (p) => (p === have.port ? (portOwner ?? (portFree ? "free" : "stranger")) : "stranger") });
  if (!plan.possible) return { ok: false, blockers: plan.blockers, fix: plan.fix };
  if (dryRun) return { ok: true, dryRun: true, says: describeChange(plan, { applied: false, ...reach }), would: plan.steps.map((s) => s.what) };

  const applied = applyEnablePlan(plan, {
    envPath: ENV_PATH,
    readEnv: (p) => (existsSync(p) ? readFileSync(p, "utf8") : ""),
    writeEnv: (p, t) => writeFileSync(p, t, { mode: 0o600 }),
    ensureDenylist: (p) => {
      mkdirSync(dirname(p), { recursive: true });
      if (!existsSync(p)) writeFileSync(p, "# Revoked key ids, one jti per line. Written by `clearotron disconnect`; read on every key check.\n", { mode: 0o600 });
    },
    installUnit: (name) => {
      mkdirSync(UNIT_DIR, { recursive: true });
      copyFileSync(join(REPO, "driver", "systemd", name), join(UNIT_DIR, name));
      // — A BUS-LESS SHELL IS THE COMMON WAY TO RUN THIS, NOT AN EDGE CASE.
      //
      // Under `su` or `sudo -u` there is no login session, so XDG_RUNTIME_DIR and
      // DBUS_SESSION_BUS_ADDRESS are unset and `systemctl --user` dies with "Failed to connect to bus".
      // The owner met it on his first real connect. What it printed was `Command failed: systemctl
      // --user daemon-reload` — an error naming the command that failed and nothing a reader can act on,
      // at the end of a flow that had ALREADY written the env file and the denylist.
      //
      // The runtime dir is derivable, so derive it rather than asking: /run/user/<uid> is where the bus
      // lives when a session exists at all. If it does not, say the two exports by name — that is the
      // whole remedy, and printing it costs nothing next to a reader who has to find it.
      try { execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore", env: userBusEnv() }); }
      catch (e) { throw new Error(`${e?.message ?? e}\n\n${busRemedy()}`); }
    },
    // The same bus, for the same reason — a connect that reloads and then dies on enable has moved the
    // failure one line without helping anybody.
    startUnit: (name) => {
      try { execFileSync("systemctl", ["--user", "enable", "--now", name], { stdio: "ignore", env: userBusEnv() }); }
      catch (e) { throw new Error(`${e?.message ?? e}\n\n${busRemedy()}`); }
    },
    unitIsHealthy,
    // Minted in-process so the credential never crosses a shell, an argv or a pipe on its way back.
    mint: (spec) => mintToken({ ...spec, ttlSec: 90 * 24 * 3600 }),
  });

  // ── THE LEDGER LINE: the id is written down, the key never is ─────────────
  //
  // Recorded AFTER the mint succeeded and BEFORE the key is shown, because the record is what makes
  // `clearotron disconnect` able to revoke it. The jti is read from our own mint's output (`tokenId`
  // parses, it never authenticates); the token value goes nowhere near the file. A failed record is
  // said OUT LOUD with the fallback that still works — silence here would leave a key that outlives
  // every teardown with nothing anywhere saying it exists, which is this issue's own complaint.
  let recordNote = null;
  const id = tokenId(applied.key);
  if (!id) {
    recordNote = "This key's id could not be read, so it was NOT recorded — `clearotron disconnect` cannot revoke it; it dies only at its own expiry.";
  } else {
    try {
      const grantsPath = envFrom(process.env, "CLEAROTRON_ACCESS_FILE");
      const g = loadGrants();
      atomicWrite(grantsPath, JSON.stringify(
        recordConnectKey(g ?? { tenants: {} }, { jti: id.jti, sub: identity, client, exp: id.exp }),
        null, 2) + "\n");
    } catch (e) {
      recordNote = `The key was issued but its id could not be recorded (${e.message}) — \`clearotron disconnect\` will not know about it; revoke it by adding jti ${id.jti} to the denylist by hand.`;
    }
  }
  return { ok: true, says: describeChange(plan, { applied: true, ...reach }), recordNote, ...applied };
}

/**
 * @param {object} a
 * @param {{env: object, known: boolean, hosted: boolean}} a.running  the UNITS' environment, resolved
 *   once by main() and handed down. A PARAMETER, not a second resolution: reading the unit files twice
 *   per invocation would be waste, and re-resolving here is how the two halves of one answer drift.
 *   It was neither — `running` was read from main()'s scope, which threw ReferenceError on every served
 *   http client.  — F40's own defect, one function along.
 */
async function render(offer, have, { dryRun, running }) {
  say("");
  say(`  ${offer.client.name}`);
  say("");

  // NOT A BUTTON (owner, 2026-08-31): "it reads as unavailable with one plain sentence on why and what
  // would change it, and it does not expand into instructions for a thing that will not work."
  if (!offer.served) {
    say(`  Not available here — ${offer.reason}.`);
    say(`  What would change it: ${offer.fix}.`);
  // The operator's half, printed only HERE. The same row's `fix` renders on the arriving portal page,
  // where six words including "address" are refused outright, so the actionable detail cannot live in
  // it — and a terminal reader who is handed only "whoever installed it can" is handed nothing, since
  // they ARE whoever installed it ( — F30).
  if (offer.operatorFix) say(`  You are that person: ${offer.operatorFix}.`);
    return 1;
  }

  if (offer.route === "disk" || (offer.route === "either" && offer.command)) {
    // A COMMAND AND A CONFIG BLOCK ARE NOT THE SAME INSTRUCTION, and saying "run this" over a TOML
    // block is how a reader pastes four lines into a shell. The shape says which it is.
    const s = offer.stdio;
    say(s?.kind === "config"
      ? `  Add this to ${s.where}:`
      : "  Run this once, on this machine:");
    say("");
    for (const line of String(offer.command).split("\n")) say(`    ${line}`);
    say("");
    if (s?.after) { say(`  ${s.after}`); say(""); }
    say(`  ${offer.note}`);
    return 0;
  }

  // ── AN ADDRESS ROUTE ALWAYS MINTS NOW (owner ruling 2026-09-03,) ─────────────
  //
  // This used to be `if (offer.enables)` — mint only when the row said the door still had to be turned
  // on. Under settled point 2 the door auto-starts, so no row asks for that any more and every offer
  // carries `enables: null`.
  //
  // THAT IS NOT A HARMLESS DEAD KEY, AND IT WAS MEASURED RATHER THAN PREDICTED. With every row null
  // this branch stops firing, `key` is never assigned, and the verb prints an address with NO KEY —
  // while the connector refuses every caller who does not hold one. Driven on `45dc0d3`: all four http
  // rows come back `served: true`, address present, `enables: null`, and `key` is assigned nowhere
  // else in this file. A reader is handed an address that cannot be used, and nothing says so.
  //
  // The condition is the ROUTE now, which is the fact this branch was always about: an address route
  // needs a credential. `enables` is left in the data where the portal lane put it — nothing reads it
  // here any more, and deleting the key is cleanup that rides its own change, not this one.
  //
  // `enableTheDoor` keeps its name and its work. Writing the settings and installing the unit are
  // idempotent against an install that already has both, and doing them here means a box whose install
  // predates the auto-start ruling is repaired by the verb a reader was going to run anyway.
  let key = null;
  if (offer.route === "public-http") {
    const identity = have.operator;
    const bound = await portIsFree(have.port);
    const r = enableTheDoor({ have, identity, client: offer.client.id, dryRun, env: running.env,
      envKnown: running.known, portFree: bound, portOwner: portOwnerOf(have.port, bound) });
    if (!r.ok) {
      // One finding, one remedy, on its own line. A list of reasons above a single fix invites the
      // reader to apply that fix to the reason it does not answer.
      say("  Not available yet:");
      for (const b of r.blockers) { say(`    · ${b.why}`); say(`      What would change it: ${b.fix}.`); }
      return 1;
    }
    if (r.dryRun) {
      say("  (dry run — nothing was changed)");
      for (const w of r.would) say(`    would ${w}`);
      say("");
      for (const line of r.says) say(`  ${line}`);
      return 0;
    }
    key = r.key;
    // AFTER THE FACT, no step — and in the door module's own words, not a second set written here.
    // A sentence about what was just opened, kept in two places, is the one that must not drift.
    for (const line of r.says) say(`  ${line}`);
    if (r.recordNote) say(`  ${r.recordNote}`);
    say("");
  }

  say(`  Address:  ${offer.address}`);
  if (key) say(`  Key:      ${key}`);          // printed once, stored nowhere
  // ── AND WHERE TO PUT THEM ( — F35) ───────────────────────────────────────
  //
  // The owner was left with two strings and no destination: *"I don't know how to connect it in Claude
  // Cowork with those details."* The steps were DEFINED IN THE PRODUCT the whole time — `withSteps`
  // computes them for every offer, interpolating this install's own address and operator — and this
  // verb simply never printed them. Nothing new is authored here; a second set of instructions written
  // at the CLI would drift from the page's, which is the defect connect-clients-are-data exists against.
  if (offer.steps?.length) {
    say("");
    say(`  In ${offer.client?.name ?? "your assistant"}:`);
    offer.steps.forEach((step, n) => say(`    ${n + 1}. ${step}`));
  }
  say("");
  say(`  ${offer.note}`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  // `--help` IS ANSWERED, not rejected. Running this bare drops the reader into a question, so "run it
  // with no arguments to see what it does" — which is what the dispatcher says for a verb that answers
  // no help of its own — is advice that leads somewhere else entirely.
  if (argv.includes("--help") || argv.includes("-h")) {
    say("");
    say("  clearotron connect — connect the assistant you already use.");
    say("");
    say("  Run it with no options and it asks which assistant, then does whatever that one needs:");
    say("  a command to run, or a connector on this machine and a key. You are not asked to choose");
    say("  a transport, an address or a port — which one you need is a fact about your assistant,");
    say("  not about you.");
    say("");
    say("    --client <name>   skip the question (see --list for the names)");
    say("    --list            the assistants this build knows");
    say("    --dry-run         say what would change, change nothing");
    say("");
    return 0;
  }
  const known = new Set(["--client", "--list", "--dry-run", "--help", "-h"]);
  const unknown = argv.filter((a) => a.startsWith("--") && !known.has(a));
  if (unknown.length) {
    console.error(`connect: unrecognised flag(s): ${unknown.join(", ")}`);
    console.error(`  This build accepts: ${[...known].join(" ")}`);
    process.exit(2);
  }
  const dryRun = argv.includes("--dry-run");
  // F40 — reason about the RUNNING product from the units' own environment, not this CLI's env file.
  const running = runningEnv();
  const have = deploymentHas(running.env);
  // AND SAY SO WHEN WE CANNOT LOOK, rather than refusing on a default we inferred. The acceptance
  // criterion names this case explicitly: a command that reasons about the running product resolves
  // the units' environment, or says it could not. Every refusal below is about configuration, and a
  // refusal built on an unread environment is exactly the one the owner spent the leg working around.
  if (running.hosted && !running.known) {
    say("");
    say(`  ⚠ ${couldNotDetermine("this install's configuration", running.resolved)}`);
    say(`    The units are installed, so what follows is read from this command's own environment`);
    say(`    (${ENV_PATH} is what they load). Treat any refusal below as unconfirmed.`);
  }

  if (argv.includes("--list")) {
    for (const c of CONNECT_CLIENTS) say(`  ${c.id.padEnd(16)} ${c.name}`);
    return 0;
  }

  const i = argv.indexOf("--client");
  let chosen = i >= 0 ? clientById(argv[i + 1]) : null;
  if (i >= 0 && !chosen) {
    console.error(`connect: no such assistant "${argv[i + 1]}". One of: ${CONNECT_CLIENTS.map((c) => c.id).join(", ")}`);
    process.exit(2);
  }

  if (!chosen) {
    // THE QUESTION, IN THE READER'S WORDS. Not "which transport", not "is this deployment hosted" —
    // which assistant they want to use, which is the only thing they know for certain.
    say("");
    say("  Which assistant do you want to use?");
    say("");
    CONNECT_CLIENTS.forEach((c, n) => say(`    ${n + 1}) ${c.name}`));
    say("");
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question(`  1-${CONNECT_CLIENTS.length}: `)).trim();
      chosen = CONNECT_CLIENTS[Number(answer) - 1] ?? clientById(answer);
    } finally { rl.close(); }
    if (!chosen) { console.error("connect: not one of the listed assistants."); process.exit(2); }
  }

  return await render(whatItNeeds(chosen, have), have, { dryRun, running });
}

main().then((code) => process.exit(code ?? 0), (e) => { console.error(`connect: ${e.message}`); process.exit(2); });
