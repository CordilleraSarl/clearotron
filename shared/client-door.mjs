// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// client-door.mjs — the client connector's settings, its key, and the revocation of one person's key.
//
// ── THE DOOR NOW COMES UP WITH THE PRODUCT (owner ruling 2026-09-03,) ─────────
//
// There are TWO MCP doors. The ENGINE door (`mcp-server/http-server.mjs`) is what `clearotron start`
// runs and what the portal's Start button calls; it refuses an account-scoped key outright. The CLIENT
// door (`mcp-server/http-server-client.mjs`) is a separate process, and it is the only one that accepts
// a key acting for a brand owner's account.
//
// UNTIL 2026-09-03 THIS FILE SAID THE OPPOSITE, and the reasoning it gave was right under the ruling it
// cited. The owner's 2026-08-31 "On demand is fine" made STARTING the door the consent that opened
// client-account access, so the fence shipped unset and `clearotron connect` turned it on when a reader
// picked an assistant that could not work without it.
//
// He superseded that knowingly (settled point 2): the door auto-starts with the product and THE
// PER-ACCOUNT KEY IS THE GATE, not whether a process runs. A door with no key issued refuses everything
// — the same protection by a mechanism that does not depend on a reader finding a verb. What follows
// from it, and is the reason this file changed rather than just its comments:
//
//   · the installer places and starts the unit, so the installer must write the settings it refuses to
//     start without. `enablePlan({ issuesKey: false })` is that question asked without a key.
//   · `connect` still mints, still says what it did, and still refuses to hand over a key it could not
//     issue. Nothing about the key half is relaxed by the door being up.
//   · `disconnect` is a PERSON's revocation (Q3), not a teardown — see the closing half below.
//
// THE PLAN/APPLY SPLIT STAYS, and its reason outlived the consent it was built for: the plan is pure,
// says in the reader's words what would change, and is what the caller prints. An apply that cannot run
// without a plan is the only way "we said what we did" is a property of the code rather than a habit of
// whoever wrote the caller.
//
// ── WHAT THE PLAN STILL REFUSES OVER ─────────────────────────────────────────────────────────────
//
// `clearotron start` generates `TRADEMARK_MCP_TOKEN_SECRET`, writes `CLEAROTRON_ACCESS_FILE` and
// creates an empty `grants.json` (bin/start.mjs); `render-units.mjs --apply` generates the secret too
// (Q4, owner-confirmed 2026-09-03). The client door refuses to start without that access file and
// minting refuses without that secret, so on an install that has either path behind it the
// preconditions are met. On one that has NOT, the plan says so and stops rather than half-configuring
// a door — which is now the difference between a box that installs and a box that crash-loops one.

import { join } from "node:path";
import { challengeVerdict, blockedByAccessChallenge, challengeNote } from "./mcp-challenge.mjs";   // — F57

/** The unit that runs the client door. Installed like any other; started only by this module. */
export const CLIENT_DOOR_UNIT = "clearotron-client-mcp.service";

/**
 * Where revoked key ids live, and the one place that decides it.
 *
 * — bb8's F14. This literal was written out in four places (connect, start
 * twice, disconnect). `connect` armed the variable AND created the file, with a comment saying exactly
 * why: a named-but-absent file was the same landmine one step later, because `isRevoked` then failed
 * OPEN on an unreadable list. It fails CLOSED now, which makes creating the file more load-bearing
 * rather than less: the absence is no longer a silent hole, it is a refusal. `start` named the same
 * path and created nothing — so on a
 * default install the door ran with a denylist that did not exist, every revocation was written to a
 * file no verifier could read, and a revoked key kept answering 200. The guard existed; one of the two
 * doors was outside it.
 */
export const defaultDenylistPath = (home) => join(home, ".config", "clearotron", "token-denylist");

/**
 * The denylist path a door should be given — the operator's, if they set one.
 *
 *, bb8's sharpening of F14. `defaultDenylistPath` answers "where does it live
 * when nobody said"; this answers "where does it live", which is the question every caller actually had.
 * The client door was composed with the default UNCONDITIONALLY while every other child inherited
 * TRADEMARK_MCP_TOKEN_DENYLIST, so on a box where an operator had placed the list themselves:
 *
 *   staff door  → the operator's file        (revocation worked)
 *   client door → ~/.config/clearotron/…     (revocation silently did nothing)
 *
 * and `key issue` printed the operator's file to someone revoking a CLIENT key. Every surface agreed
 * with itself and two of them were about different files. Account keys live at the client door, so the
 * half that ignored the operator is the half that mattered.
 *
 * The previous fix made the path COMPOSED in one place. That is not the same as RESOLVED to one value,
 * and the arm that checked the first passed the whole time the second was false.
 */
export const denylistPathFor = (env, home) =>
  String(env?.TRADEMARK_MCP_TOKEN_DENYLIST ?? "").trim() || defaultDenylistPath(home);

/**
 * Create the denylist if it is absent, so the door is born consulting a file that exists.
 *
 * Idempotent and never destructive: an existing list is left exactly as it is. Mode 600 because it
 * names key ids, and the header says who writes it so the next reader is not guessing.
 *
 * Returns what happened, because the caller reports it and "already there" is not the same fact as
 * "created" — a door that had to create its own denylist on a box that has been running is worth a line.
 */
export function ensureDenylistFile(path, io) {
  if (io.exists(path)) {
    // PRESENT IS NOT THE SAME AS READABLE, and only one of the two makes revocation work. A list the
    // door cannot open is the exact state `isRevoked` turns into "not revoked" — the same landmine as an
    // absent one, wearing a passing existence check. Read it here, where the door is still startable.
    if (io.read) io.read(path);
    return { path, created: false };
  }
  io.mkdir(io.dirname(path));
  io.write(path, "# Revoked key ids, one jti per line. Written by `clearotron disconnect`; read on every key check.\n");
  return { path, created: true };
}

/**
 * The client door's port — NOT the engine door's.
 *
 * These are two processes on two ports and conflating them is the mistake this whole module exists to
 * stop: the engine door (`TRADEMARK_MCP_HTTP_PORT`, 18790) is what `clearotron start` runs and it
 * refuses an account key. Handing a reader that address for Cowork produces a door that answers and
 * then rejects their key, which is worse than no address at all.
 *
 * 18811 is `http-server-client.mjs`'s own default and the unit states it explicitly — see for why
 * a defaulted port on this particular surface is a guess about which instance you are.
 */
export function clientDoorPort(env = {}) {
  const raw = String(env.CLIENT_MCP_HTTP_PORT ?? "").trim();
  if (!raw) return 18811;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`CLIENT_MCP_HTTP_PORT="${raw}" is not a port number (1-65535).`);
  }
  return n;
}

/** The address a client on this machine connects to. Loopback, because that is what the unit binds. */
export const clientDoorAddress = (env = {}) => `http://127.0.0.1:${clientDoorPort(env)}`;

/**
 * Is the client door already standing?
 *
 * BOTH HALVES, because either one alone is a door that does not do the job: a unit that is running with
 * the fence off accepts no account key, and the fence on with nothing listening is a setting with no
 * server. Reporting "standing" on half of it would send a reader to paste an address at nothing.
 */
export function clientDoorState({ env = {}, unitDir, exists, active = null, listening = null, activeState = null, subState = null } = {}) {
  const fenceOn = String(env.CLIENT_MCP_ACCOUNT_ACCESS ?? "").trim() === "1";
  const unitInstalled = Boolean(exists(join(unitDir, CLIENT_DOOR_UNIT)));
  // `standing` IS UNCHANGED AND STILL MEANS CONFIGURED — a file on disk and a fence flag. Two callers
  // read it and neither is wrong to; what was wrong is that they printed it as "the door is on".
  const standing = fenceOn && unitInstalled;
  // ── CONFIGURED IS NOT RUNNING ──────────────────────────────────────────────
  //
  // Measured by role-e2e: a `connect` that died at `daemon-reload` had ALREADY written the denylist and
  // installed both unit files, and `doctor` then said "the client door is on" while the unit was
  // inactive and nothing listened on its port. The trigger was a shell without a session bus, which is
  // not the product's fault — but any failure at that step leaves the same half-applied state
  // reporting as complete, and the auto-start ruling moves where that step can fail rather than
  // whether it can.
  //
  // `active` IS INJECTED AND DEFAULTS TO null, which means NOBODY ASKED. That is a third answer, not a
  // synonym for false: a caller that cannot reach systemd must not be able to report a door as down
  // any more than it can report one as up. Same discipline as the queue-watch arm's unprobed half.
  return {
    // — bb8's F11: what is ANSWERING, which the unit file cannot say.
    // — THE PAIR, NOT ITS BOOLEAN. `active` collapses ActiveState and SubState,
    // so a crash loop (`activating/auto-restart`) and a unit that was never started (`inactive/dead`)
    // reduce to the same `false` and printed the same sentence — one is a fault to read the journal for,
    // the other is a connect that stopped half-way.
    listening, activeState, subState, standing, fenceOn, unitInstalled, active, serving: standing && active === true };
}

/**
 * The honest sentence for a door's state, given what was and was not measured.
 *
 * FIVE answers, and the two that matter are the two the caller used to get wrong in opposite directions.
 *
 * CONFIGURED IS NOT RUNNING. A `connect` that died at `daemon-reload` has already
 * written the fence and placed both units, so every angle reads as set up; role-e2e measured `doctor`
 * saying "the client door is on" over an inactive unit with nothing on its port. That state is a
 * problem and it is the reason this function exists.
 *
 * AN ABSENCE IS NOT A MISCONFIGURATION, and that is `doctor`'s own written rule rather than a new one:
 * *"No `claude` and nothing set is a fresh machine: reported, exit 0. CLEAROTRON_CLAUDE_PATH naming
 * something wrong is a configuration that fails at run time"* (`onboard-wizard.test.mjs`). A first cut
 * of this returned `problem` for every not-standing door, on the reasoning that the 2026-09-03 ruling
 * makes the installer place both halves — true of an INSTALL, and doctor cannot tell an install from a
 * checkout that never ran one. Wired, it failed eleven arms, `--check on an unconfigured machine exits
 * 0` among them. Neither half present is an ABSENCE; exactly one is a half-applied install, which is a
 * misconfiguration and says so.
 *
 * EVERY COMMAND THIS PRINTS IS INJECTED, never a literal. Doctor's own guard runs
 * every command doctor prints from a directory that is not the install, so a bare `clearotron start` in
 * this text is `command not found` in the reader's terminal — which is exactly what the guard caught the
 * moment this function acquired a caller. The defaults are the shim spelling; the caller passes
 * `invoke()`.
 */
export function describeDoorState(door, {
  unit = CLIENT_DOOR_UNIT,
  closeCmd = "clearotron disconnect",
  startCmd = "clearotron start",
  connectCmd = "clearotron connect",
} = {}) {
  if (!door.standing) {
    // WHICH HALF, NOT THAT ONE. The sentence this replaced in doctor already named the two
    // independently ("fence off, unit installed"); collapsing them into "the unit or the setting" would
    // have been a worse sentence than the one it replaced, and the two halves have different remedies.
    const missing = [
      door.unitInstalled ? null : `${unit} is not installed`,
      door.fenceOn ? null : "account access (CLIENT_MCP_ACCOUNT_ACCESS) is off",
    ].filter(Boolean).join(" and ");
    // `standing` is both halves, so anything true here is exactly one of them — a door somebody started
    // configuring and did not finish. That is the state a `connect` or an install that stopped part-way
    // leaves, and it is the one worth exit 1.
    if (door.fenceOn || door.unitInstalled) {
      return { level: "problem",
        text: `the client door is HALF configured — ${missing}. Something began setting it up and stopped: `
          + `finish with \`${connectCmd}\`, or close it with \`${closeCmd}\`.` };
    }
    // A DOOR THAT ANSWERS IS SET UP, WHATEVER THE UNITS SAY ( — bb8's F11).
    //
    // `standing` is unit-file + fence, and a FOREGROUND `clearotron start` has neither: it runs the door
    // as its own child. Measured — the door listening on its port while this sentence said "the client
    // door is not set up here" and told the reader to run the command they had just run. The unit file
    // is evidence about the BACKGROUND shape only; the port is evidence about both.
    if (door.listening === true) {
      // WHAT A CONNECT PROVES, AND WHAT IT DOES NOT. Something is listening where this environment's
      // client door would be. That is enough to stop saying "not set up here" — the sentence that told a
      // reader whose foreground door was up to run the command they had just run — and it is NOT enough
      // to call it theirs: the product's ports are fixed defaults, so on a shared box the answer may be
      // another install's door entirely. Caught by 2145's arm on a machine where exactly that was true.
      return { level: "info",
        text: `something is listening on the client door's address for this environment — no ${unit} is `
          + "installed, so either this install is running in the foreground (it stops when that terminal "
          + `does; \`${startCmd} --background\` installs the unit) or another install holds the port.` };
    }
    return { level: "info",
      text: `the client door is not set up here — ${missing}. \`${startCmd}\` writes both. Since the `
        + "2026-09-03 ruling an install places them, so on an installed box this means the install did "
        + "not finish" };
  }
  if (door.active === null) {
    // THE PROBE STILL COUNTS HERE. Not asking systemd is not the same as knowing nothing: if the port
    // answers, the door is serving whatever systemd would have said.
    if (door.listening === true) {
      return { level: "ok",
        text: `${unit} is installed and account access is enabled, and the client door's port is `
          + "answering — systemd was not asked, so this is the port's word rather than the unit's" };
    }
    return { level: "info",
      text: `${unit} is installed and account access is enabled — whether it is RUNNING was not checked, `
        + "so this says the door is set up, not that it answers" };
  }
  if (door.active === false) {
    // NAME THE STATE, AND NEVER ASSERT AN EMPTY PORT WITHOUT LOOKING (, Hera).
    //
    // This said "nothing is listening on the client door" from `active === false` alone, while a probe
    // of that very port had already been taken and passed in — and read nowhere on this branch. With a
    // decoy holding the port it printed a falsehood. It also collapsed two different faults into one
    // sentence: `activating/auto-restart` is a unit failing over and over, and `inactive/dead` is a
    // connect that stopped half-way. They have different next steps.
    const looping = door.activeState === "activating" || door.subState === "auto-restart";
    const stateWords = door.activeState ? ` (${door.activeState}/${door.subState ?? "?"})` : "";
    if (door.listening === true) {
      return { level: "problem",
        text: `${unit}${stateWords} is not running, and something IS listening on the client door's port. `
          + "That is very likely why it cannot start: the product's ports are fixed defaults, so another "
          + "install or a stray process holds it, and the unit fails over and over against a port it will "
          + `never get. Find the holder before re-applying anything — \`${startCmd}\`'s own refusal names `
          + "the port and the variable, and `ss -ltnp` names the process." };
    }
    if (looping) {
      return { level: "problem",
        text: `${unit}${stateWords} is CRASH-LOOPING — it starts, fails, and systemd restarts it. Nothing `
          + `is listening. Its own words are the fastest route: \`journalctl --user -u ${unit} -n 30\`.` };
    }
    return { level: "problem",
      text: `${unit}${stateWords} is installed and account access is enabled, but the unit is NOT RUNNING `
        + "and nothing is listening on the client door. This is what a `connect` that failed part-way "
        + `leaves behind, and it reads as set up from every angle except this one. \`${closeCmd}\` then `
        + `\`${connectCmd}\` re-applies it cleanly.` };
  }
  return { level: "ok", text: `the client door is on and running (${unit}) — \`${closeCmd}\` closes it` };
}

/**
 * What turning it on would do, in the reader's words and in order — or why it cannot be done here.
 *
 * PURE. Takes the facts, returns the plan. The caller prints `.says` and asks; only then does it apply.
 *
 * ── `issuesKey: false` — THE INSTALL PATH ASKS THE SETTINGS QUESTION ALONE ────
 *
 * Since settled point 2 the installer places `clearotron-client-mcp.service` with everything else, and
 * a door that is placed must be a door that can START. It cannot: `http-server-client.mjs` refuses
 * without `CLIENT_MCP_TOKEN_ONLY=1` (it otherwise demands an OIDC audience and an access team, which a
 * local install has neither of), and token-only in turn requires the fence, the secret and the
 * allow-list. Measured on this branch before the flag existed: a fresh install placed the unit,
 * `Restart=on-failure` picked it up, and the box crash-looped a door — which is the one outcome
 * settled point 2 names as forbidden ("never a unit failing at boot").
 *
 * So the installer needs THIS function's six names and not one of its own. The blockers split cleanly
 * in two, and that split is the whole of the flag:
 *
 *   about the SETTINGS   the signing secret · the secret being in the env file the door reads ·
 *                        the access file · where the checkout is · the port being free
 *   about the KEY        a signed-in identity to issue it to · that identity being enrolled
 *
 * An installer mints nothing, so the second pair cannot apply to it — and refusing an install for the
 * want of a person who has not logged in yet would be the product refusing over a fact that is not
 * about the thing being done. The first pair still refuses, loudly: an install that wrote a fence with
 * no secret behind it is the crash-loop again, wearing a green tick.
 *
 * @param {{ env?: object, address: string, identity: string|null, accessFile?: string|null,
 *           issuesKey?: boolean }} facts
 */
/**
 * The Host headers this door will actually be asked to answer —.
 *
 * THE DEFECT THIS CLOSES. The plan wrote loopback only, while the SAME flow hands assistants the public
 * address from `CLEAROTRON_CLIENT_MCP_URL`. Through a tunnel the Host header is the public name, so the door
 * answered `Invalid Host header` to the very address the product advertises. The owner hit it on his
 * first real connection and worked around it by hand; what an operator sees is a valid key "failing"
 * with no path forward, because auth was already correct when this fired.
 *
 * BARE AND :443, because both reach the door and neither is ours to predict. A browser or client talking
 * TLS on the default port usually sends the bare name; some send it with the port. An explicit port in
 * the URL is added as itself — if somebody publishes on :8443, that is the header they will send.
 *
 * LOOPBACK IS NEVER DROPPED. The local install has no public name at all, health probes and the portal
 * reach the door on 127.0.0.1, and a plan that replaced loopback with the public name would fix a tunnel
 * by breaking the machine it runs on.
 *
 * A MALFORMED URL IS NOT A REASON TO REFUSE. This is the install path: an unparseable value falls back
 * to loopback rather than throwing, and the door still starts. A door that runs and turns one address
 * away is recoverable; a `connect` that dies on a typo in an unrelated variable is not.
 */
export function allowedHosts(port, env = {}) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const raw = String(env.CLEAROTRON_CLIENT_MCP_URL ?? "").trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.hostname) {
        hosts.push(u.hostname);
        hosts.push(`${u.hostname}:${u.port || "443"}`);
      }
    } catch { /* not a URL we can read — loopback still stands, and the door still starts */ }
  }
  return [...new Set(hosts)].join(",");
}

export function enablePlan({ env = {}, address, identity, accessFile = null, port = null, portIsFree = null, portOwner = null,
  grantedAccounts = undefined, checkoutDir = null, denylistPath = null, unitEnvHasSecret = undefined,
  issuesKey = true } = {}) {
  const blockers = [];
  // The two things `clearotron start` lays down. Their absence means this install was never started,
  // and a door configured on top of that would fail at boot with a message about a file nobody named.
  // EACH BLOCKER CARRIES ITS OWN REMEDY. A single `fix` for the whole plan told a reader whose PORT was
  // occupied to "run `clearotron start` first — it creates the access file and the secret this door
  // needs", which is true of three blockers and nonsense for the fourth. A remedy that does not match
  // the finding is worse than none: it sends someone to do work that changes nothing, and when that
  // fails they have no reason to doubt the sentence rather than themselves.
  const refuse = (why, fix) => blockers.push({ why, fix });
  if (!String(env.TRADEMARK_MCP_TOKEN_SECRET ?? "").trim()) {
    refuse("this install has no token secret yet, so no key can be issued",
      "run `clearotron start` — it generates the signing secret this door needs");
  }
  // ── THE DOOR'S ENV IS NOT THIS PROCESS'S ENV (found driving) ────────────────
  //
  // The unit loads `~/.env`; this verb runs with the caller's shell. A secret exported in the shell
  // but absent from the env file passed every check here and the door then died at birth with
  // "requires TRADEMARK_MCP_TOKEN_SECRET" — the health probe refused before a key was issued (right),
  // but nothing named the cause at plan time (wrong, and this line is the fix). `undefined` means the
  // caller did not look, which keeps this pure function honest on callers that cannot read the file.
  if (unitEnvHasSecret === false) {
    refuse("the signing secret is in this shell but NOT in the env file the door reads, so the door would die at birth",
      "run `clearotron start` — it writes the secret into the env file the services load");
  }
  const access = accessFile ?? env.CLEAROTRON_ACCESS_FILE ?? null;
  if (!String(access ?? "").trim()) {
    refuse("this install has no access file, and the client door refuses to start without one",
      "run `clearotron start` — it creates the guest list a client identity is scoped against");
  }
  // THE UNIT'S ExecStart IS `${CLEAROTRON_CHECKOUT_DIR}/mcp-server/http-server-client.mjs`, and systemd
  // expands an unset variable to NOTHING rather than failing — so without it the unit installs, starts,
  // tries to run `/mcp-server/http-server-client.mjs`, and dies. Driving the verb on a box with no
  // `~/.env` found exactly that: fence on, key issued, door dead.
  //
  // AVOIDED RATHER THAN REFUSED, which is the better half of the same fix. The caller knows where the
  // checkout is — it is running out of it — so this is written rather than demanded. A blocker here
  // would have been the product refusing over a fact it was holding.
  if (!String(checkoutDir ?? "").trim()) {
    refuse("the caller did not say where this checkout lives, and the door's command line needs it",
      "this is a defect in whatever called connect, not something to configure");
  }
  if (issuesKey && !identity) {
    // An account key carries no identity beyond its `sub` — that is what the audit log names and what
    // revoking by person acts on. Minting one for nobody produces a credential that cannot be attributed.
    refuse("there is no signed-in identity to issue the key to, and an account key must name whose it is",
      "sign in to the portal first, so the key can be issued to a person and revoked by name");
  }
  // ── A KEY THAT OPENS A DOOR AND THEN 403s IS NOT A CONNECTION (measured 2026-08-31) ───────────
  //
  // Driving the whole path found this and nothing short of it could have: the minted account key
  // authenticated correctly — 401 without it, past auth with it — and every request then returned
  // `403 {"error":"this identity is not granted any account"}`. A fresh install creates an EMPTY grants
  // file, so an identity nobody has enrolled resolves to no accounts, and `connect` was handing out a
  // credential that could do nothing at all.
  //
  // That is this issue's own complaint reproduced with extra steps: the owner installed the product and
  // could not connect anything, and a connect verb that ends in a silent 403 is a worse version of it,
  // because now he has a key and believes he is done. Enrolling an identity is a separate, deliberate
  // act (`clearotron grant`) and must not happen as a side effect of choosing an assistant — so this
  // refuses and says which command grants it.
  //
  // `undefined` means the caller did not look, and that is NOT a pass — but neither is it this pure
  // function's place to invent a grants file. A caller that cannot resolve grants passes `null`, which
  // is the "no grants file at all" case and means unrestricted by `accountsForEmail`'s own contract.
  if (issuesKey && grantedAccounts !== undefined) {
    const none = Array.isArray(grantedAccounts) && grantedAccounts.length === 0;
    if (none) {
      refuse(`${identity ?? "this identity"} is not enrolled, so a key issued to it could open the door and do nothing`,
        `run \`clearotron grant\` to enrol ${identity ?? "this identity"} against a brand owner, then connect again`);
    }
  }

  // ── THE PORT IS CHECKED, NOT ASSUMED (, and measured 2026-08-31) ──────────────────────────
  //
  // A default port is a guess about which instance you are. Driving this verb on a shared box found
  // 18811 ALREADY HELD by another user's client face: the unit was installed, started, and crash-looped,
  // while a listening socket on the expected port made it look like the door was up. Reading a port as
  // proof of your own process is the mistake — the port answered, and it was never mine.
  const chosen = port ?? clientDoorPort(env);
  // ── WHOSE SOCKET IS IT ( — F39) ────────────────────────────────────────
  //
  // The paragraph above is right about the incident and the remedy it produced answered the WRONG
  // QUESTION. "Can I bind?" and "is my door already there?" are two states needing opposite responses,
  // and a bind test cannot tell them apart because it never asks who owns the socket. On any
  // `--background` install the door is always running, so this refused EVERY TIME, PERMANENTLY, on a
  // correctly configured machine — and the workaround was to stop a healthy service so this verb could
  // prove to itself that it could have started one.
  //
  // `portOwner` answers the question the bind was standing in for. `portIsFree` is kept for callers
  // that have no way to ask, and its false still means a stranger — which is what it always meant.
  const owner = portOwner ? portOwner(chosen)
    : portIsFree ? (portIsFree(chosen) ? "free" : "stranger")
    : "free";
  if (owner === "stranger") {
    refuse(`port ${chosen} is already in use on this machine, so the door cannot listen there`,
      `set CLIENT_MCP_HTTP_PORT to a free port and connect again — something else already answers on ${chosen}`);
  }
  // "ours" is the state this verb is TRYING to reach, so it is not a blocker. "unknown" is a reader
  // that could not look, and a could-not-look must not refuse a machine that is probably correct —
  // that is how the permanent refusal above came to exist.
  if (blockers.length) return { possible: false, blockers };

  // ── ONE RESOLVED PORT, EVERY DERIVED VALUE WRITTEN WITH IT ────────────────────────────────────
  //
  // CLIENT_MCP_ALLOWED_HOSTS arms DNS-rebinding protection and the door refuses to start without it.
  // It names host:port, so a port written in one place and an allow-list written in another drift into
  // a door that starts and turns every request away — which reads as a dead door rather than as a
  // misconfiguration. They are derived from the same number, here, and written together.
  //
  // CLIENT_MCP_TOKEN_ONLY=1 IS WHAT MAKES THIS WORK AT ALL, and driving it is how that was found. With
  // it unset the door demands an OIDC audience plus a Cloudflare Access team or issuer and refuses to
  // start fail-closed — correct for a hosted deployment fronted by an identity proxy, and impossible on
  // a local install, which has no proxy and never will. Token-only is the API-key door: the key IS the
  // identity. Its own preconditions are exactly what this plan has already established — the signing
  // secret, account access on, a loopback host, and an allow-list.
  const settings = {
    // Written, not required. The value is this checkout's own path, which the caller cannot be wrong
    // about; an installer that already set it keeps its value, because setEnvValue replaces only what
    // this plan names and the installer's spelling is the same key with the same meaning.
    CLEAROTRON_CHECKOUT_DIR: checkoutDir,
    CLIENT_MCP_ACCOUNT_ACCESS: "1",
    CLIENT_MCP_TOKEN_ONLY: "1",
    CLIENT_MCP_HTTP_HOST: "127.0.0.1",
    CLIENT_MCP_HTTP_PORT: String(chosen),
    CLIENT_MCP_ALLOWED_HOSTS: allowedHosts(chosen, env),
  };

  // ── THE DENYLIST PATH IS NAMED AND CREATED HERE, NEVER ASSUMED ───────────
  //
  // Measured on production, owner 2026-08-31: no denylist is configured anywhere — the variable is
  // empty in one example env and commented out in the other, and `isRevoked()` returns false when the
  // path is unset. So a key minted by a connect that assumed a denylist would be UNREVOKABLE, silently:
  // `disconnect` would write a jti into a file no verifier reads, and every check would look done.
  //
  // Armed AT CONNECT TIME, deliberately, not at disconnect: a process reads its environment once, at
  // start. A variable first written when someone disconnects is one the already-running door never
  // loaded — the door this plan starts must be born knowing where the denylist lives, so a later
  // revocation lands in a file it actually consults. The FILE is ensured too (empty, comment header):
  // A named-but-absent file was the same landmine one step later, when `isRevoked` still failed OPEN on
  // an unreadable list. It fails CLOSED now, so ensuring the file is what stops the
  // closed contract from refusing every key on a box nobody misconfigured.
  const existing = String(env.TRADEMARK_MCP_TOKEN_DENYLIST ?? "").trim();
  const armedPath = existing || (denylistPath ? String(denylistPath) : null);
  if (!existing && armedPath) settings.TRADEMARK_MCP_TOKEN_DENYLIST = armedPath;

  return {
    possible: true,
    blockers: [],
    settings,
    issuesKey,
    steps: [
      { id: "env", what: `turn on client-account access and the API-key door on port ${chosen}`, env: settings },
      ...(armedPath ? [{ id: "denylist", what: `arm the revocation list at ${armedPath}`, denylist: armedPath }] : []),
      { id: "unit", what: `install and start ${CLIENT_DOOR_UNIT}`, unit: CLIENT_DOOR_UNIT },
      // NO KEY STEP WHEN NOBODY IS MINTING ONE, rather than a step the caller is trusted to skip. A
      // plan that lists an act its applier will not perform is a plan whose printed words are wrong,
      // and `describeChange`/`applyEnablePlan` both read this list rather than the flag.
      ...(issuesKey ? [{ id: "key", what: `issue an account key for ${identity}`, mint: { scope: "account", sub: identity } }] : []),
    ],
    address: address ?? `http://127.0.0.1:${chosen}`,
    port: chosen,
    identity,
    accessFile: access,
    denylistPath: armedPath,
  };
}

/**
 * The change in words, in the tense of the moment the caller is in. ONE author for both.
 *
 * There is no consent prompt — owner ruling 2026-08-31, *"One press does all of it, invisibly… No
 * second step"* — so these sentences are reported AFTER the door is open, or ahead of it under
 * `--dry-run`. What they must never be is two separately written sets that disagree about what was
 * turned on; a stale future-tense sentence printed after the fact is a product describing a change it
 * did not make in the way it did not make it.
 *
 * WHAT IS NOT SAID is as deliberate as what is: no flag name, no scope, no token. The reader is told
 * what now exists and what still cannot reach them.
 */
export function describeChange(plan, { applied = false, publicAddress = null, reachabilityKnown = true } = {}) {
  if (!plan?.possible) return [];
  const { address, identity } = plan;
  const tense = applied
    ? { runs: `A second connector is now running on ${address}`, access: "Client-account access is on," }
    : { runs: `This would start a second connector on ${address}`, access: "It would also turn on client-account access," };
  // ── WHETHER IT IS REACHABLE IS A FACT, NOT A SENTENCE ( — F36) ───────────
  //
  // These two lines used to sit two sentences apart: "on this machine only … nothing outside this
  // machine can reach it", printed directly above a public https address the door was already
  // answering on, reached from off-box during that same session before the key was pasted anywhere.
  //
  // A WRONG ANSWER IN THIS DIRECTION IS THE DANGEROUS ONE. An operator told their door is loopback-only
  // does not go on to think about who else can reach it, so the claim is made only when it is true, and
  // when it cannot be established it is not made at all. Silence is the safe failure here; a reassuring
  // sentence is not.
  const reach = publicAddress
    ? `It IS reachable from outside this machine, at ${publicAddress} — that address is what an assistant connects to, and the key is what stops anyone else.`
    : reachabilityKnown
      ? (applied
          ? "Nothing is published to the internet, and nothing outside this machine can reach it."
          : "Nothing would be published to the internet, and nothing outside this machine could reach it.")
      : "Whether anything outside this machine can reach it could not be determined here, so it is not being claimed either way — check the public address this install advertises.";
  return [`${tense.runs}.`,
    `${tense.access} which lets a key act for one brand owner's account — today, ${identity}'s.`,
    reach];
}

/**
 * Set a key in an env file's text, REPLACING an existing value.
 *
 * `mergeEnvFile` in bin/start.mjs deliberately never overwrites — a value a person put there by hand
 * wins over a generated one, which is right for a command that runs on every start. It is wrong here:
 * this runs once, because a reader answered a question about this exact setting, and an install whose
 * file already says `CLIENT_MCP_ACCOUNT_ACCESS=0` is exactly the one that needs changing. Consent is
 * what makes the overwrite legitimate, so this helper is only ever called after the plan was shown.
 *
 * Returns the new text and what it did, so the caller can report "changed" versus "already set" rather
 * than claiming a change it did not make.
 */
export function setEnvValue(text, key, value) {
  const body = typeof text === "string" ? text : "";
  const re = new RegExp(`^([ \\t]*)${key}[ \\t]*=.*$`, "m");
  if (re.test(body)) {
    const before = body;
    const next = body.replace(re, `$1${key}=${value}`);
    return { text: next, changed: next !== before, action: next !== before ? "replaced" : "unchanged" };
  }
  const gap = body.length && !body.endsWith("\n") ? "\n" : "";
  return {
    text: `${body}${gap}\n# Added by \`clearotron connect\` — you were asked before this was set.\n${key}=${value}\n`,
    changed: true, action: "added",
  };
}

/**
 * Carry out a plan. EVERY EFFECT GOES THROUGH `io`, so an arm drives this without systemd, without
 * writing a real env file and without minting a real credential.
 *
 * REFUSES A PLAN THAT IS NOT POSSIBLE, rather than doing the steps it can. A half-enabled door — the
 * fence on, nothing listening — is the state that makes a reader paste an address at nothing, and it is
 * reachable only by a caller that pressed on past the blockers.
 *
 * THE KEY IS RETURNED, NEVER LOGGED. Possession is the credential: it is handed back to the caller to
 * show its reader once, and this function writes it nowhere. A `mint` that returned it through the same
 * channel as its progress reporting would put a live account key in every journal on the box.
 *
 * @param {object} plan from enablePlan
 * @param {{ readEnv:(p:string)=>string, writeEnv:(p:string,t:string)=>void, envPath:string,
 *           installUnit:(name:string)=>void, startUnit:(name:string)=>void,
 *           mint:(spec:object)=>string, onStep?:(what:string)=>void }} io
 */
export function applyEnablePlan(plan, io) {
  if (!plan?.possible) {
    throw new Error(`the client door cannot be enabled here: ${(plan?.blockers ?? ["no plan"]).join("; ")}`);
  }
  // A SETTINGS-ONLY PLAN IS NOT AN APPLIABLE ONE HERE. `issuesKey: false` is the installer's question —
  // which names and values does this door need — and this function ends by requiring a credential it
  // was never asked to mint. Refusing names the mismatch; carrying on would throw four steps later on
  // an empty key and read as a mint failure.
  if (plan.issuesKey === false) {
    throw new Error("this is a settings-only plan (issuesKey: false) — it names the door's configuration and "
      + "mints nothing, so it cannot be applied through the path that ends in a key");
  }
  const done = [];
  const step = (what, fn) => { io.onStep?.(what); const r = fn(); done.push(what); return r; };

  step(`writing the door's settings to ${io.envPath}`, () => {
    let text = io.readEnv(io.envPath);
    // Written together, from one resolved port. A partial write here is a door that starts and refuses
    // every request, which is indistinguishable from a dead one to the reader who was just told it works.
    for (const [k, v] of Object.entries(plan.settings)) text = setEnvValue(text, k, v).text;
    io.writeEnv(io.envPath, text);
  });
  if (plan.denylistPath && io.ensureDenylist) {
    // BEFORE the door starts, so the process is born consulting a file that exists. `isRevoked` fails
    // open on an unreadable file by contract; ensuring the file here is what makes a later
    // `clearotron disconnect` an actual revocation rather than a write nobody reads.
    step(`arming the revocation list at ${plan.denylistPath}`, () => io.ensureDenylist(plan.denylistPath));
  }
  step(`installing and starting ${CLIENT_DOOR_UNIT}`, () => {
    io.installUnit(CLIENT_DOOR_UNIT);
    io.startUnit(CLIENT_DOOR_UNIT);
    // STARTING IS NOT RUNNING, AND `is-active` IS NOT ENOUGH. A Type=simple unit is reported active the
    // moment it forks, so a door that exits on its first line reads as healthy for about a second. Driving
    // this verb produced exactly that: `systemctl start` returned 0, the probe passed, a key was issued,
    // and the unit was already in its second restart. The caller's probe must answer "is it still up",
    // not "was it accepted" — see bin/connect.mjs, which settles and reads the restart counter.
    if (io.unitIsHealthy && !io.unitIsHealthy(CLIENT_DOOR_UNIT)) {
      throw new Error(`${CLIENT_DOOR_UNIT} was started but is not running — the door is not open, so no key was issued`);
    }
  });
  const key = step(`issuing an account key for ${plan.identity}`, () =>
    io.mint({ scope: "account", sub: plan.identity }));

  if (!key || typeof key !== "string" || !key.trim()) {
    // An empty mint is an ABSENCE, and reporting the door as ready over it would send a reader to paste
    // nothing into a key box and read the resulting refusal as the product being broken.
    throw new Error("the key was not issued — the door is on, but there is no credential to hand over");
  }
  return { done, key: key.trim(), address: plan.address, identity: plan.identity, port: plan.port };
}

// ══ THE LEDGER: what connect issued, as IDs and never as secrets ═════════════
//
// Owner ruling, 2026-08-31, verbatim shape: "Say yes. Recording key IDs, never secrets. … Store the
// jti beside it and disconnect is: remove the row, add the id to the denylist. No new bookkeeping."
//
// The record rides IN THE GRANTS FILE, beside the rows that give the key its reach — one file to read
// to answer "who can get in, and with what". It is a new top-level `connectKeys` section, keyed by
// jti, because the grants file's own validators (`loadGrants`, `bin/grant.mjs`) check exactly the
// `tenants` object and pass everything else through: the section survives every existing editor, and
// a human can read and hand-edit it like the rest of the file.
//
// WHAT A ROW HOLDS is deliberately closed: the jti (the revocation handle), the identity it was minted
// for, which assistant asked, and the mint/expiry instants. The TOKEN VALUE never appears — an arm
// plants exactly that mistake — because a ledger holding credentials is a credential store wearing an
// audit log's name.

/** A new grants object with one issued key recorded. PURE — the caller owns reading and writing the file. */
export function recordConnectKey(grants, { jti, sub, client = null, exp = null, mintedAt = null }) {
  if (!jti) throw new Error("recordConnectKey: a record with no jti records nothing revocable");
  if (!sub) throw new Error("recordConnectKey: a record must name whose key it is");
  const g = grants && typeof grants === "object" ? grants : { tenants: {} };
  const keys = { ...(g.connectKeys ?? {}) };
  keys[jti] = { sub, client, minted: mintedAt ?? new Date().toISOString(),
    ...(exp != null ? { expires: new Date(exp * 1000).toISOString() } : {}) };
  return { ...g, connectKeys: keys };
}

/** The recorded keys for one identity: `[{ jti, sub, client, minted, expires? }]`. */
export function recordedKeysFor(grants, sub) {
  const keys = grants?.connectKeys ?? {};
  return Object.entries(keys)
    .filter(([, r]) => r && r.sub === sub)
    .map(([jti, r]) => ({ jti, ...r }));
}

/** A new grants object with the named jtis' records removed. PURE. */
export function removeRecordedKeys(grants, jtis) {
  const drop = new Set(jtis ?? []);
  const g = grants && typeof grants === "object" ? grants : { tenants: {} };
  const keys = Object.fromEntries(Object.entries(g.connectKeys ?? {}).filter(([jti]) => !drop.has(jti)));
  return { ...g, connectKeys: keys };
}

/**
 * Every recorded key, judged: `valid`, `expired`, or `revoked` — for `clearotron doctor`, which is the
 * status surface the ruling names ("status should say whether a key is still valid").
 *
 * PURE, and the revocation answer comes THROUGH the caller's `revoked` seam rather than from this
 * module reading a file: doctor hands it the real `isRevoked`, an arm hands it a map, and either way
 * the judgement here cannot drift from the verifier's — expiry is the same clock `verifyToken` uses
 * (exp seconds against now), revocation is the verifier's own function.
 */
export function connectKeyReport(grants, { now = Date.now(), revoked = () => false } = {}) {
  const rows = Object.entries(grants?.connectKeys ?? {}).map(([jti, r]) => {
    const exp = r?.expires ? Date.parse(r.expires) : null;
    const state = revoked(jti) ? "revoked" : exp != null && exp <= now ? "expired" : "valid";
    return { jti, sub: r?.sub ?? null, client: r?.client ?? null, minted: r?.minted ?? null,
      expires: r?.expires ?? null, state };
  });
  return { rows, valid: rows.filter((r) => r.state === "valid").length };
}

// ══ REVOCATION: disconnect is a PERSON, not a service (owner ruling 2026-09-03, Q3) ═══════════════
//
// SUPERSEDED, AND THE OLD SHAPE IS WORTH KNOWING BECAUSE IT WAS COHERENT. Under the 2026-08-31 ruling
// the door existed only because a reader had asked for it, so its mirror was a teardown: revoke the
// key, stop and remove the unit, turn the fence back off. Every one of those was the right act while
// the RUNNING PROCESS was the consent.
//
// It stopped being right the moment the door came up with the product. Q3, verbatim: *"In the UI it is
// per-person: it revokes YOUR key and nobody else notices. Cutting everyone off is a separate,
// deliberate admin act with its own name that states how many people it affects before acting. NEITHER
// stops the service."*
//
// So all three teardown acts are gone, and each for its own reason rather than as one sweep:
//
//   the unit    removing it is the live contradiction this ruling names — the installer re-places it,
//               so a disconnect deleted a door that came back at the next install and stopped one
//               person's colleagues in the meantime.
//   the fence   `CLIENT_MCP_ACCOUNT_ACCESS=0` is the whole install's account access. One person
//               disconnecting turned it off for everybody, which is the exact "nobody else notices"
//               this ruling forbids — and it did it silently, because the sentence said "off again".
//   the words   `describeClosure` said the connector was stopped and access was off. Both sentences
//               would now be lies about a door that is still up, which is worse than either act.
//
// WHAT SURVIVES IS THE PART THE ISSUE WAS ABOUT: the key OUTLIVES the door.
// Stopping a unit revokes nothing, and the person most likely to believe it does is the one who just
// stopped the service. Revocation is still the first and now the only substantive step, and the ledger
// strike still happens only after the denylist write — a record removed before its jti is on the list
// leaves a live key with no trace it ever existed.
//
// THE DENYLIST IS STILL ARMED AT CONNECT TIME, NOT HERE, and that has not moved: a process reads its
// environment once, at start. A variable first written when someone disconnects is one the running door
// never loaded, so a key minted by a connect that did not arm it is unrevokable. `lateArm` below is the
// honest report of exactly that install, not a repair of it.

/**
 * What disconnecting would do — or the plain statement that this person has no key.
 *
 * `recorded` is this identity's rows from `recordedKeysFor`. NOTHING-TO-DO IS NOW KEYED ON THE PERSON,
 * not on the door: the old test (`!fenceOn && !unitInstalled && !jtis.length`) can never fire again,
 * because both door halves are true on every installed box since the auto-start ruling — so a reader
 * with no key would have been shown a closure plan for a door nobody was going to touch.
 *
 * A disconnect with nothing recorded SAYS so rather than implying no key was ever issued: pre-2082
 * connects recorded nothing, and silence here would read as "no keys exist" when the truth is "none
 * were recorded".
 */
export function disablePlan({ env = {}, unitDir, exists, identity = null, recorded = [],
  denylistPath = null } = {}) {
  const door = clientDoorState({ env, unitDir, exists });
  const jtis = (recorded ?? []).map((r) => r.jti).filter(Boolean);
  // The path the running verifiers were BORN with wins; the caller's default only covers the install
  // where connect never armed one (a pre-2082 connect, a hand-built box). In that case the file is
  // created and the env named, and the plan says the running door never loaded it — the honest half of
  // a revocation the environment cannot deliver retroactively.
  const existing = String(env.TRADEMARK_MCP_TOKEN_DENYLIST ?? "").trim();
  const armedPath = existing || (jtis.length && denylistPath ? String(denylistPath) : null);
  const lateArm = Boolean(jtis.length && !existing && armedPath);

  if (!jtis.length) {
    return { possible: false, nothingOpen: true, door,
      says: [`No key issued to ${identity ?? "this identity"} is on record, so there is nothing to revoke.`,
        "The client connector stays up for everyone else, as it does after any disconnect.",
        "A key minted before records were kept is not revoked by this — it dies at its own expiry."] };
  }

  return {
    possible: true,
    nothingOpen: false,
    identity,
    jtis,
    denylistPath: armedPath,
    lateArm,
    door,
    steps: [
      ...(armedPath
        ? [{ id: "revoke", what: `revoke ${jtis.length} issued key(s) — write the id(s) to ${armedPath}`, jtis }]
        : []),
      { id: "ledger", what: `strike the ${jtis.length} revoked id(s) from the record`, jtis },
    ],
  };
}

/**
 * The admin act Q3 names: cut EVERYONE off. Its own name, and it states the size before it acts.
 *
 * NOT A SUPERSET OF `disablePlan` AND NOT REACHED BY ACCIDENT. The ruling's word is "separate,
 * deliberate": the count of keys AND the count of people are computed here and handed to the caller to
 * SAY before anything happens, because "revoke everything" is the one act on this surface whose blast
 * radius the person running it cannot see from the command they typed.
 *
 * IT DOES NOT STOP THE SERVICE EITHER. That is Q3's own word about both paths, and it is the same
 * mechanism as the per-person one: keys are the gate, so a door with every key revoked already refuses
 * everything. Stopping the unit would additionally break the stdio-free local route for readers who
 * hold no key at all, and would be undone by the next install.
 */
export function revokeEveryonePlan({ env = {}, grants = null, denylistPath = null } = {}) {
  const rows = Object.entries(grants?.connectKeys ?? {}).map(([jti, r]) => ({ jti, sub: r?.sub ?? null }));
  const jtis = rows.map((r) => r.jti);
  const people = [...new Set(rows.map((r) => r.sub).filter(Boolean))];
  const existing = String(env.TRADEMARK_MCP_TOKEN_DENYLIST ?? "").trim();
  const armedPath = existing || (denylistPath ? String(denylistPath) : null);

  if (!jtis.length) {
    return { possible: false, nothingOpen: true, jtis: [], people: [],
      says: ["No issued key is on record for this install, so there is nobody to cut off.",
        "The connector stays up; it already refuses every caller without a key."] };
  }
  return {
    possible: true, nothingOpen: false, jtis, people,
    denylistPath: armedPath,
    lateArm: Boolean(!existing && armedPath),
    // THE COUNT IS THE FIRST THING SAID, and it names both dimensions: five keys held by one person and
    // five keys held by five people are the same number and not the same act.
    says: [`This revokes ${jtis.length} issued key(s) held by ${people.length} ${people.length === 1 ? "person" : "people"}`
      + `${people.length ? `: ${people.join(", ")}` : ""}.`,
      "Every one of them stops working immediately — they do not wait out their expiry.",
      "The connector itself keeps running. Anyone who signs in can be issued a new key."],
    steps: [
      ...(armedPath
        ? [{ id: "revoke", what: `revoke all ${jtis.length} issued key(s) — write the id(s) to ${armedPath}`, jtis }]
        : []),
      { id: "ledger", what: `strike all ${jtis.length} revoked id(s) from the record`, jtis },
    ],
  };
}

/** The closure in words — one author, same contract as describeChange. */
export function describeClosure(plan, { applied = false } = {}) {
  if (!plan?.possible) return plan?.says ?? [];
  const lines = [];
  const did = (a, b) => (applied ? a : b);
  if (plan.jtis.length && plan.denylistPath) {
    lines.push(did(`${plan.jtis.length} issued key(s) ${plan.jtis.length === 1 ? "is" : "are"} revoked — refused on sight, before ${plan.jtis.length === 1 ? "it expires" : "they expire"}.`,
      `This would revoke ${plan.jtis.length} issued key(s) — refused on sight, before expiry.`));
    if (plan.lateArm) {
      lines.push(did("The revocation list was only armed now, so anything still running was started without it and consults it from its next start.",
        "The revocation list would be armed only now — anything already running was started without it."));
    }
  }
  if (!plan.denylistPath && plan.jtis.length) {
    // AN ABSENCE, SAID. No denylist path anywhere means the ids have nowhere to go and the keys stay
    // live — reporting a revocation over that would be the exact "every check looked done" this
    // module's connect-time arming exists to prevent.
    lines.push("There is no revocation list configured on this install, so the key ids have nowhere to be "
      + "written and the keys stay live until they expire. Set TRADEMARK_MCP_TOKEN_DENYLIST and connect again.");
  }
  // THE SERVICE IS NOT MENTIONED AS STOPPING, because it does not (Q3). It is mentioned as STAYING, so
  // a reader does not leave believing they closed something.
  lines.push("The client connector keeps running — this revokes your key, and nobody else notices.");
  return lines;
}

/**
 * Carry out a revocation. Same io discipline as applyEnablePlan; refuses a plan that is not possible.
 *
 * Serves BOTH plans above — they differ in which ids they name, never in what is done with them, and a
 * second applier would be a second author for "what revoking means".
 *
 * The ledger strike happens ONLY after the denylist write succeeded — a record removed before its jti
 * is on the list would leave a live key with no trace that it ever existed, which is strictly worse
 * than either state alone.
 */
export function applyDisablePlan(plan, io) {
  if (!plan?.possible) {
    throw new Error(`there is nothing to revoke: ${(plan?.says ?? []).join(" ")}`);
  }
  const done = [];
  const step = (what, fn) => { io.onStep?.(what); const r = fn(); done.push(what); return r; };
  for (const s of plan.steps) {
    if (s.id === "revoke") {
      step(s.what, () => io.appendDenylist(plan.denylistPath, s.jtis));
      if (plan.lateArm) step(`naming the revocation list in ${io.envPath}`, () => {
        const text = setEnvValue(io.readEnv(io.envPath), "TRADEMARK_MCP_TOKEN_DENYLIST", plan.denylistPath).text;
        io.writeEnv(io.envPath, text);
      });
    }
    // NO `unit` AND NO `fence` STEP EXISTS TO HANDLE. Both were deleted with the plans that emitted
    // them (Q3, 2026-09-03); a branch kept here "in case" would be an applier able to do an act no plan
    // may order, which is how the deleted behaviour comes back through a caller nobody re-read.
    if (s.id === "ledger") {
      // ONLY REACHED AFTER THE DENYLIST WRITE, and only when there was one: a ledger strike on an
      // install with no denylist path erases the record of a key that is still live.
      if (!plan.denylistPath) continue;
      step(s.what, () => io.strikeRecords(s.jtis));
    }
  }
  return { done };
}

// ── IS THE PUBLISHED ADDRESS REAL? (, acceptance 2) ────────────────────────────────
//
// The criterion is deliberate about which question this answers: "doctor reports the door's
// REACHABILITY, not its configuration — the address is set AND answers from outside the box. An address
// set to a host nobody can reach reads as 'not set up' with the reason, never as green."
//
// That inversion is the whole point. Every surface that advertises the connector renders from the
// presence of `CLEAROTRON_CLIENT_MCP_URL` alone (`enabled: !!url`), so a value typed into the wrong host,
// or pointing at an ingress nobody provisioned, lights up the Use-your-AI page and the report's Ask-AI
// control while nothing behind it answers — a client is handed an address that fails on first use, and
// the box reports itself configured. Being SET is what the page already believes; it is not evidence.
//
// PURE, so the two branches that matter can be tested without a network: an address nobody can reach,
// and a probe that could not run. A live probe on a healthy box produces neither.

/**
 * @param {object} a
 * @param {string|null} a.url        the published address, exactly as configured — never normalised
 * @param {{ok: boolean, status?: number|null, error?: string|null}|null} a.probe
 *        the result of asking it. `null` means NOBODY ASKED, which is its own answer.
 */
export function clientDoorReachability({ url = null, probe = null } = {}) {
  const raw = String(url ?? "").trim();
  // NOT A FAULT. A local install has no published address and never will — the disk route needs none —
  // so an unset value is the ordinary state of most installs, and reporting it as a problem would train
  // a reader to skim the arm that catches a broken one.
  if (!raw) {
    return { state: "unset",
      message: "no client connector address is published, so the Use-your-AI page and a report's Ask-AI "
        + "control will say this deployment is not set up. That is correct for a local install." };
  }
  let parsed;
  try { parsed = new URL(raw); }
  catch { return { state: "fail", message: `the client connector address is not a URL: ${raw}` }; }
  if (parsed.protocol !== "https:" && !/^(localhost|127\.|\[::1\])/.test(parsed.hostname)) {
    return { state: "fail",
      message: `the client connector address is published over ${parsed.protocol}// to ${parsed.hostname} — an `
        + "assistant will refuse it, and a key travels over it in clear. Publish it over https." };
  }
  // AN UNPROBED HALF IS NOT A PASSED HALF. This is the branch the criterion exists to forbid: the
  // address is set, which is exactly what every advertising surface already believes, and believing it
  // here too would make this check agree with the thing it was written to contradict.
  if (!probe) {
    return { state: "unprobed",
      message: `${raw} is configured and NOBODY ASKED whether it answers — being set is what the page `
        + "already assumes, so this half did not run rather than passing." };
  }
  // THE CHALLENGE FORM IS A DIFFERENT FACT FROM REACHABILITY ( — F57), and it is
  // the one that decides whether an assistant can connect. A 302 is under 500, so the reachability half
  // above calls a Cloudflare-Access browser challenge green: every layer healthy, nothing able to
  // connect. Judged by the shared reader, never by a rule written here — the staff lane asks the same
  // question and the two must not drift.
  const challenge = challengeVerdict(probe);
  if (challenge.blocked) return { state: "fail", message: blockedByAccessChallenge(raw, probe.status) };
  if (probe.ok) {
    return { state: "pass",
      message: `${raw} answers${probe.status ? ` (${probe.status})` : ""}${challengeNote(challenge)}` };
  }
  const why = probe.error ? probe.error : `it answered ${probe.status}`;
  return { state: "fail",
    message: `${raw} is configured and DOES NOT ANSWER — ${why}. Every surface that advertises the `
      + "connector renders from this value being set, so a client would be handed an address that fails "
      + "on first use while this box reported itself configured." };
}
