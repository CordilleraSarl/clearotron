#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// disconnect.mjs — revoke YOUR key. The door stays up; nobody else notices.
//
// ── THE ISSUE THIS CLOSES ───────────────────────────────────────────────────
//
// `clearotron connect` can open the client connector door; before this verb, nothing closed it. Undoing
// a connect meant systemd, a text editor, and remembering that the KEY OUTLIVES THE DOOR: stopping the
// unit revokes nothing, and an account key stays valid for its full ninety days whether or not anything
// is listening. The person most likely to believe "I turned it off" is the one who just stopped the
// service.
//
// Owner ruling, 2026-08-31: record key IDs never secrets; the id goes to the denylist; the record is
// struck. REVOCATION COMES FIRST in the apply order — if this dies halfway, the half that must already
// have happened is the credential being dead.
//
// ── WHAT THIS VERB STOPPED DOING ON 2026-09-03 (owner ruling, Q3) ─────────────
//
// It used to stop and REMOVE the unit, and turn `CLIENT_MCP_ACCOUNT_ACCESS` back off. Both were right
// while the door existed only because a reader had asked for it. The door now comes up with the
// product, and Q3 rules the verb per-person: *"it revokes YOUR key and nobody else notices … Neither
// stops the service."*
//
// The line that made this urgent rather than tidy: `rmSync` on the unit file, against an installer that
// re-places it. One person disconnecting deleted a door their colleagues were using, and the next
// install brought it back — a product contradicting itself across two commands.
//
// CUTTING EVERYONE OFF IS `--everyone`, and it is a different act with a different name. It states how
// many keys and how many PEOPLE it affects before it does anything, and it does not stop the service
// either. See `revokeEveryonePlan`.
//
// ── WHAT THIS DOES NOT TOUCH, SAID OUT LOUD ──────────────────────────────────────────────────────
//
// The ENROLMENT — the grants-file user row that `clearotron grant` wrote — stays. That row is shared:
// it is what the same person's browser sign-in resolves through, and it existed before connect ran
// (connect REFUSES an unenrolled identity rather than enrolling one). Removing it here would revoke a
// door this verb never opened. The closing report says the enrolment remains and names the verb that
// removes it, so "disconnected" is never read as "un-enrolled".
//
// ── A STDIO ASSISTANT WAS NEVER CONNECTED ON THIS SIDE ───────────────────────────────────────────
//
// For an assistant that runs the server itself from disk, connect changed NOTHING on this install — the
// reader added a command or a config block to their own assistant's settings. There is nothing here to
// close, and pretending otherwise would teach that a disconnect on this side did a thing it cannot do.
// Which side an assistant is on is the ROW's property (`shared/connect-clients.mjs`), never a name
// branch here — `connect-clients-are-data` refuses one.

// FIRST IMPORT — the rename layer must apply before any module-top env capture evaluates.
import "../shared/env-local.mjs";
import { createInterface } from "node:readline/promises";
import { requireInteractive } from "../shared/invocation.mjs";   // — a prompt with nobody to answer it
import { stdin, stdout } from "node:process";
// `rmSync` and `execFileSync` are GONE FROM THE IMPORTS on purpose ( Q3). This verb no
// longer touches the unit file or systemd at all, and an import kept "in case" is the readiest way for a
// deleted behaviour to return through a caller nobody re-read.
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, userInfo } from "node:os";
import { CONNECT_CLIENTS, clientById } from "../shared/connect-clients.mjs";
import { defaultDenylistPath, disablePlan, revokeEveryonePlan, applyDisablePlan, describeClosure, recordedKeysFor, removeRecordedKeys } from "../shared/client-door.mjs";
import { loadGrants } from "../shared/scope.mjs";
import { envFrom } from "../shared/env-aliases.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { atomicWrite } from "../driver/progress.mjs";

const UNIT_DIR = join(homedir(), ".config", "systemd", "user");
const ENV_PATH = join(homedir(), ".env");
// — one owner for this path. It was written out here, in disconnect and twice
// in start; `start` named it and created nothing, which is how a revoked key kept answering 200.
const DENYLIST_PATH = defaultDenylistPath(homedir());
const say = (s = "") => console.log(s);

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    say("");
    say("  clearotron disconnect — revoke your own key. The connector keeps running.");
    say("");
    say("  Your key stops working from this moment on — it does not wait out its expiry.");
    say("  Nobody else is affected: the connector stays up, and everyone else's keys keep");
    say("  working. Your enrolment (who may sign in, and to what) is not touched;");
    say("  `clearotron grant` manages that.");
    say("");
    say("    --client <name>   which assistant you connected (see --list for the names)");
    say("    --list            the assistants this build knows");
    say("    --everyone        the admin act: revoke EVERY issued key on this install. It says");
    say("                      how many keys and how many people that is before doing it.");
    say("    --dry-run         say what would change, change nothing");
    say("");
    return 0;
  }
  const known = new Set(["--client", "--list", "--dry-run", "--everyone", "--help", "-h"]);
  const unknown = argv.filter((a) => a.startsWith("--") && !known.has(a));
  if (unknown.length) {
    console.error(`disconnect: unrecognised flag(s): ${unknown.join(", ")}`);
    console.error(`  This build accepts: ${[...known].join(" ")}`);
    process.exit(2);
  }
  const dryRun = argv.includes("--dry-run");

  if (argv.includes("--list")) {
    for (const c of CONNECT_CLIENTS) say(`  ${c.id.padEnd(16)} ${c.name}`);
    return 0;
  }

  // ── THE ADMIN ACT, BEFORE ANY ASSISTANT QUESTION ( Q3) ─────────────────────────
  //
  // It asks no assistant, because it is not about one: every key on the install goes, whichever
  // assistant each was issued for. It states the two counts and then asks for the word "revoke" typed
  // in full — a y/n on an act this size is a keystroke away from a mistake nobody can undo, and the
  // keys are not recoverable.
  if (argv.includes("--everyone")) return await cutEveryoneOff({ dryRun });

  const i = argv.indexOf("--client");
  let chosen = i >= 0 ? clientById(argv[i + 1]) : null;
  if (i >= 0 && !chosen) {
    console.error(`disconnect: no such assistant "${argv[i + 1]}". One of: ${CONNECT_CLIENTS.map((c) => c.id).join(", ")}`);
    process.exit(2);
  }
  if (!chosen) {
    say("");
    say("  Which assistant do you want to disconnect?");
    say("");
    CONNECT_CLIENTS.forEach((c, n) => say(`    ${n + 1}) ${c.name}`));
    say("");
    requireInteractive({ verb: "disconnect" });
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question(`  1-${CONNECT_CLIENTS.length}: `)).trim();
      chosen = CONNECT_CLIENTS[Number(answer) - 1] ?? clientById(answer);
    } finally { rl.close(); }
    if (!chosen) { console.error("disconnect: not one of the listed assistants."); process.exit(2); }
  }

  say("");
  say(`  ${chosen.name}`);
  say("");

  // The row's own property decides the side. `accepts: "stdio"` never touched this install; "either"
  // only opens the door when its stdio route was missing, and on THIS box (the one disconnect runs on)
  // the stdio route resolves, so its connect handed over a command too.
  if (chosen.accepts === "stdio" || chosen.accepts === "either") {
    say("  Connecting this assistant changed nothing on this install — it runs the software itself,");
    say("  from the configuration you added on its side. To disconnect it, remove that entry in the");
    say("  assistant's own settings.");
    if (chosen.accepts === "either") {
      say("");
      say("  If you connected it by address instead, the door and key are shared — disconnect the");
      say("  assistant you named when the door was opened, and the closure covers this one too.");
    }
    return 0;
  }

  // The operator identity, resolved the same way connect resolves it — one spelling for one person.
  const identity = process.env.PORTAL_LOCAL_USER || `${userInfo().username}@localhost`;

  let grants = null;
  try { grants = loadGrants(); } catch (e) {
    say(`  The grants file could not be read (${e.message}) — issued-key records are unknown from here.`);
    say("  The door is still closed below; any recorded key must be revoked once the file is readable.");
  }
  const recorded = grants ? recordedKeysFor(grants, identity) : [];

  const plan = disablePlan({ env: process.env, unitDir: UNIT_DIR, exists: existsSync,
    identity, recorded, denylistPath: DENYLIST_PATH });

  if (!plan.possible) {
    // "disconnect on a door that is not open says so plainly and changes nothing" — the acceptance line.
    for (const line of plan.says) say(`  ${line}`);
    return 0;
  }

  if (dryRun) {
    say("  (dry run — nothing was changed)");
    for (const s of plan.steps) say(`    would ${s.what}`);
    say("");
    for (const line of describeClosure(plan, { applied: false })) say(`  ${line}`);
    return 0;
  }

  applyDisablePlan(plan, revocationIo(grants));

  for (const line of describeClosure(plan, { applied: true })) say(`  ${line}`);
  say("");
  say(`  ${identity} is still enrolled — signing in through the browser still works. \`clearotron grant\``);
  say("  is where enrolment is given and taken away.");
  return 0;
}

/**
 * The effects, once. Both revocation paths do the SAME two things to different id sets, so they share
 * one set of seams — a second copy would be a second author for what revoking means.
 *
 * NO `removeUnit`. It is not omitted from a caller; it does not exist, because no plan may order it
 * ( Q3).
 */
function revocationIo(grants) {
  return {
    envPath: ENV_PATH,
    readEnv: (p) => (existsSync(p) ? readFileSync(p, "utf8") : ""),
    writeEnv: (p, t) => writeFileSync(p, t, { mode: 0o600 }),
    appendDenylist: (p, jtis) => {
      mkdirSync(dirname(p), { recursive: true });
      if (!existsSync(p)) writeFileSync(p, "# Revoked key ids, one jti per line. Written by `clearotron disconnect`; read on every key check.\n", { mode: 0o600 });
      appendFileSync(p, jtis.map((j) => `${j}\n`).join(""));
    },
    strikeRecords: (jtis) => {
      const grantsPath = envFrom(process.env, "CLEAROTRON_ACCESS_FILE");
      if (!grantsPath || !grants) return;   // said above; the denylist already holds the ids
      atomicWrite(grantsPath, JSON.stringify(removeRecordedKeys(grants, jtis), null, 2) + "\n");
    },
  };
}

/**
 * `--everyone`: the admin act Q3 names. Every issued key on this install, and the service left running.
 *
 * THE SIZE IS SAID BEFORE THE ACT, in both dimensions — keys and people. That is the ruling's own
 * requirement and it is the whole difference between this and the per-person verb: an operator typing
 * `--everyone` cannot see from the command how many colleagues they are about to stop.
 */
async function cutEveryoneOff({ dryRun }) {
  let grants = null;
  try { grants = loadGrants(); } catch (e) {
    // AN UNREADABLE GRANTS FILE IS NOT AN EMPTY ONE. Carrying on would revoke nothing and report a
    // cut-off that did not happen — the worst possible answer for this particular verb.
    console.error(`disconnect --everyone: the grants file could not be read (${e.message}).`);
    console.error("  Nothing was revoked. This act needs the record of issued keys to act on.");
    return 2;
  }
  const plan = revokeEveryonePlan({ env: process.env, grants, denylistPath: DENYLIST_PATH });
  say("");
  say("  Revoke every issued key on this install");
  say("");
  for (const line of plan.says) say(`  ${line}`);
  say("");
  if (!plan.possible) return 0;
  if (dryRun) {
    say("  (dry run — nothing was changed)");
    for (const s of plan.steps) say(`    would ${s.what}`);
    return 0;
  }
  requireInteractive({ verb: "disconnect" });
    const rl = createInterface({ input: stdin, output: stdout });
  let answer = "";
  try { answer = (await rl.question("  Type revoke to confirm: ")).trim(); } finally { rl.close(); }
  if (answer !== "revoke") {
    say("");
    say("  Not confirmed. Nothing was revoked.");
    return 0;
  }
  applyDisablePlan(plan, revocationIo(grants));
  say("");
  say(`  ${plan.jtis.length} key(s) revoked. The connector is still running and still accepts a new key.`);
  say("  Nobody was un-enrolled — anyone who can sign in can be issued another.");
  return 0;
}

// THE DISPATCH RUNS ONLY WHEN THIS FILE IS THE COMMAND (tracker issue 183). Importing a verb to reach
// something inside it must read a module, not start a command — `bin/connect.mjs` opened its interactive
// prompt and hung a suite when an arm imported it for one message helper.
//
// This file gets the guard because it HAS a `main()` and the guard is therefore one line. The nine other
// unguarded verbs run their bodies at module top level and are declared, with that reason, in
// driver/test/a-verb-is-a-module-until-it-is-the-command.test.mjs rather than being refactored here.
if (isEntrypoint(import.meta.url)) {
  main().then((code) => process.exit(code ?? 0), (e) => { console.error(`disconnect: ${e.message}`); process.exit(2); });
}
