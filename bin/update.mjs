#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clearotron update — bring this install up to date, and refuse to do it over the top of a user's own
// configuration.
//
//   npx clearotron update           pull, reinstall, and report what moved
//   npx clearotron update --help    this text. Changes nothing.
//
// THIS VERB ACTS. It runs `git pull --ff-only` and `npm ci`. Every argument it does not recognise is
// REFUSED rather than ignored, because this file had no argument parsing at all and `update --help`
// therefore performed the update: a reader asking what the command does, did it.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
//
// THE REFUSAL IS THE VALUABLE HALF, NOT THE PULL. `git pull` already worked; anyone could type it.
// What did not exist was anything that stops an upgrade landing on top of a user's own doctrine and
// customer files, or that tells them afterwards what diverged. Before the setup step let a user
// put their configuration store INSIDE the checkout, and for those installs every upgrade is a merge
// conflict at best and a silent overwrite of their own work at worst. Those installs still exist; that
// is the whole population this verb is for.
//
// So the order matters: this checks BEFORE it touches anything. An update that pulled first and
// complained second would have already caused the damage it is describing.
//
// ── THIS COMMAND WRITES NOTHING OUTSIDE THE CHECKOUT ───────────────────────────────────────────────
//
// Its only permitted action toward a user's configuration is to refuse and explain. It does not move
// their files, it does not back them up, it does not merge them: it names them and prints the command
// they can run themselves. Moving a user's configuration is a decision with their data in it, and a
// tool that did it as a side effect of "update" would be making that decision for them.
//
// That property is asserted, not just intended — driver/test/update-writes-only-inside-the-checkout
// .test.mjs holds it, because it is the kind of promise a later convenience quietly breaks.
//
// ── AND IT ENDS WITH THE OVERLAY REPORT, WHICH ALREADY EXISTS ──────────────────────────────────────
//
// built `overlayReport`/`renderOverlayReport` and wired it into `doctor`. A second report
// written here would drift from that one, and the drift would be invisible: two commands describing the
// same overlay, disagreeing, with nothing comparing them. This calls the same pair.

// — FIRST IMPORT, BEFORE THE NODE BUILTINS, AND THE POSITION IS THE CONTRACT. Importing this
// applies the CLEAROTRON_* rename as a side effect and, because bin/update.mjs is a declared CLI entry,
// reads <repo>/.env. Anything imported earlier has already frozen whatever it read from process.env —
// `driver.config.mjs` below captures at module top, and this verb resolves three configuration variables
// to decide whether to REFUSE. Translate late and an operator using the current spellings reads as
// having set nothing, so the refusal that protects their files never fires.
import "../shared/env-local.mjs";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "../driver/driver.config.mjs";
import { isInsideCheckout } from "../shared/inside-checkout.mjs";   // — one copy of the rule
import { overlayReport, renderOverlayReport, treeFiles } from "../shared/doctrine-overlay.mjs";
import { liveRunHolds } from "../driver/deploy-live-run-guard.mjs";   // — one live-run test, shared with deploy-preflight
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { readEnvFile } from "./onboard.mjs";
import { invoke, invocationPrefix } from "../shared/invocation.mjs";   // — name a command the reader can actually type

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = join(REPO, ".env");

// The three variables that name where a user's own material lives. Same list, same order and the same
// prose as the doctor's "Configuration store" section — a variable that is a hazard there and absent
// here would be one this verb happily pulls over.
const CONFIG_VARS = [
  ["CLEAROTRON_CUSTOMERS_DIR", "your customers"],
  ["CLEAROTRON_INSTRUCTIONS_DIR", "your doctrine"],
  ["PROFILE_REPO_ROOT", "the portal's profile editor"],
];

// How many at-risk files to name before summarising. A cap that prints nothing about what it dropped
// reads as a complete list, so the count of the remainder is always printed with it.
const NAME_AT_MOST = 20;

const say = (s = "") => console.log(s);

/**
 * Resolve a configuration variable across every spelling, environment first, then `.env`.
 *
 * The doctor resolves these inside a closure over its own `.env` read, so this is the same rule rather
 * than the same code. It is deliberately NOT a fourth copy of the inside-the-checkout rule — that one
 * lives in `shared/inside-checkout.mjs` and is imported above.
 */
function effectiveConfig(fileEnv) {
  const out = [];
  for (const [name, what] of CONFIG_VARS) {
    let hit = null;
    let found = null;
    for (const spelling of [name]) {
      const fromEnv = process.env[spelling];
      if (typeof fromEnv === "string" && fromEnv.trim()) { hit = { v: fromEnv, from: "environment" }; found = spelling; break; }
      const fromFile = fileEnv[spelling];
      if (typeof fromFile === "string" && fromFile.trim()) { hit = { v: fromFile, from: ".env" }; found = spelling; break; }
    }
    // THE MESSAGE NAMES A VARIABLE THE READER CAN ACT ON. `CONFIG_VARS` above spells these the legacy
    // way because that is what the code reads; the refusal is read by an OPERATOR, and telling someone
    // to go and fix `CLEAROTRON_INSTRUCTIONS_DIR` when they set `CLEAROTRON_INSTRUCTIONS_DIR` sends them looking
    // for a line that is not in their file. So: the spelling they actually used, when they used one,
    // and the current name otherwise — never the retired one on its own.
    if (hit) out.push({ name: found ?? name, what, value: hit.v, from: hit.from });
  }
  return out;
}

/**
 * The configuration entries that sit inside the checkout, each with the files an upgrade would land on.
 *
 * AN ABSENT DIRECTORY IS STILL A REFUSAL. A variable pointing inside the checkout at a path that does
 * not exist yet is the same defect one `mkdir` later, and reporting "no files at risk" as if it were
 * safe is how it survives to the upgrade after this one.
 */
function atRisk(entries) {
  return entries
    .filter((e) => isInsideCheckout(e.value, REPO))
    .map((e) => {
      let files = [];
      let readable = true;
      // treeFiles answers null for an absent root (absence, not emptiness), so `?? []` covers the
      // directory that is removed between the check and the walk rather than throwing inside a refusal.
      try { files = existsSync(e.value) ? (treeFiles(e.value) ?? []) : []; }
      catch { readable = false; }
      return { ...e, files, readable, exists: existsSync(e.value) };
    });
}

function reportRefusal(risky) {
  say("\n  UPDATE REFUSED — this install keeps its configuration inside the checkout.\n");
  for (const e of risky) {
    say(`  ${e.name}=${e.value}  (${e.from})`);
    say(`    ${e.what} live here, inside ${resolve(REPO)}.`);
    if (!e.exists) {
      say("    The directory does not exist yet — which is the same defect one `mkdir` later, so this");
      say("    is refused now rather than on the upgrade after this one.");
    } else if (!e.readable) {
      say("    Its contents could not be read, so the files at risk cannot be named. That is a reason to");
      say("    stop, not a reason to continue: an unreadable directory is not an empty one.");
    } else if (e.files.length === 0) {
      say("    No files in it yet. The path is still wrong, and anything written there later is at risk.");
    } else {
      const shown = e.files.slice(0, NAME_AT_MOST);
      say(`    ${e.files.length} file(s) an upgrade would land on top of:`);
      for (const f of shown) say(`      ${f}`);
      if (e.files.length > shown.length) say(`      … and ${e.files.length - shown.length} more not listed here.`);
    }
    say("");
  }
  say("  Move them out of the checkout, then update. Nothing here has been changed.\n");
  say("  For each variable above, choose a directory outside the checkout and move its contents:");
  say("");
  say("      mkdir -p <somewhere-outside>");
  say("      mv <the-path-above> <somewhere-outside>/");
  say("");
  say(`  then point the variable at the new location in your .env, and run \`${invoke("doctor")}\` to`);
  say("  confirm it. This command will not move your files for you: where your own doctrine and");
  say("  customer records live is your decision, not a side effect of an upgrade.\n");
}

/**
 * Run a command in the checkout and stream it. `cwd` is REPO for every one of them, which is the
 * mechanical half of "writes nothing outside the checkout" — see the test named in the header.
 */
/**
 * Is this install a git checkout at all?
 *
 * Asked of the DIRECTORY THIS FILE LIVES IN, not the caller's cwd — an operator running `clearotron
 * update` from inside some other repository must not have that repository answered about.
 */
export function isGitCheckout(repo = REPO, exists = existsSync) {
  // NO SPAWN HERE, DELIBERATELY. 's arm requires that update.mjs hold exactly ONE spawn site, so
  // that one helper owns every command and pins `cwd` — "a later addition inherits whatever directory
  // the user happened to be standing in". A `git rev-parse` here was that later addition, and the arm
  // caught it. It is also more than the question needs: a packaged install has no `.git` at all, and a
  // worktree's `.git` is a file rather than a directory, which `existsSync` answers for both.
  return exists(join(repo, ".git"));
}

function runInCheckout(cmd, args) {
  say(`\n  $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: REPO, stdio: "inherit" });
  if (r.error) { console.error(`  could not run ${cmd}: ${r.error.message}`); return 70; }
  if (r.signal) { console.error(`  ${cmd} was killed by ${r.signal}`); return 70; }
  return r.status ?? 0;
}

/**
 * The usage text, printed for --help. Kept next to the parser rather than derived from this file's
 * header comment: the header is developer-facing, and the reader who types --help is not.
 */
function usage() {
  const P = invocationPrefix();
  say(`\n  ${P}clearotron update — bring this install up to date.\n`);
  say(`    ${P}clearotron update           pull, reinstall, and report what moved`);
  say(`    ${P}clearotron update --help    this text. Changes nothing.\n`);
  say("  It runs `git pull --ff-only` then `npm ci`, and REFUSES before touching anything if this");
  say("  install keeps its configuration store inside the checkout.\n");
}

/**
 * ARGUMENTS ARE REFUSED, NOT IGNORED, AND THAT IS THE WHOLE POINT OF THIS FUNCTION.
 *
 * This file parsed no arguments. Node hands them over regardless, so `clearotron update --help` fell
 * straight through to the update and ran `git pull --ff-only` and `npm ci` — asking what the command
 * does performed it, on any install whose credentials work, which is every installed user.
 *
 * Fixing only --help would leave the class: `--dry-run`, `--check`, a typo, anything at all would be
 * swallowed the same way and the update would run. A strict parser is what makes an unrecognised flag
 * fail SAFE. The two verbs that already reject unknown flags looked broken and were the safe ones.
 *
 * @returns {number|null} an exit code if the verb must not proceed, or null to carry on.
 */
function parseArgv(argv) {
  if (argv.includes("--help") || argv.includes("-h")) { usage(); return 0; }
  const unknown = argv.filter((a) => a !== "");
  if (unknown.length) {
    console.error(`clearotron update: unrecognised argument ${JSON.stringify(unknown[0])} — this verb takes none.`);
    console.error(`Nothing was pulled and nothing was installed. \`${invocationPrefix()}clearotron update --help\` explains it.`);
    return 2;
  }
  return null;
}

export async function update(argv = process.argv.slice(2)) {
  // BEFORE ANY READ AND ANY SPAWN. An argument check that happens after the pull is not a check.
  const early = parseArgv(argv);
  if (early !== null) return early;

  const fileEnv = readEnvFile(ENV_PATH);
  const entries = effectiveConfig(fileEnv);

  // ── THE REFUSAL, BEFORE ANYTHING IS TOUCHED ──────────────────────────────────────────────────────
  const risky = atRisk(entries);
  if (risky.length) { reportRefusal(risky); return 3; }

  // ── THE FIRST REFUSAL IS "THIS IS NOT THAT KIND OF INSTALL" ──────────────
  //
  // This verb runs `git pull --ff-only` then `npm ci`. A PACKAGED INSTALL — `npm install -g` from a
  // tarball, which is what every registry user has — is not a git checkout and carries no lockfile
  // (`package-lock.json` is not in the archive), so BOTH halves are impossible there for two separate
  // reasons.
  //
  // Without this, the pull ran in a non-repository and the operator was told `git pull --ff-only did
  // not succeed` — true, useless, and pointing at the wrong thing entirely. `update` is the verb a
  // stranger reaches for, so the one install we expect most people to have must not be answered with
  // a git error about a directory that was never a repository.
  if (!isGitCheckout()) {
    console.error("\n  This install is not a git checkout, so there is nothing to pull.");
    console.error("  It was installed from a package rather than cloned, which is the ordinary way.");
    console.error("\n  Update it the way it was installed:\n");
    console.error("      npm install -g clearotron@latest\n");
    console.error("  Nothing was touched.");
    return 4;
  }

  // ── AND THE SECOND REFUSAL: NOT OVER A LIVE RUN ──────────────────────────────────────────────
  //
  //. `npm ci` deletes node_modules and rebuilds it. Doing that under a clearance in flight feeds
  // one expensive run two different code versions, and the run does not fail — it produces an answer
  // assembled from halves of two builds, which is worse than a crash because nothing says so.
  //
  // The test is the SAME ONE `scripts/deploy-preflight.mjs` uses, imported rather than reimplemented:
  // a second copy of "is anything running" would drift, and the two would disagree exactly when it
  // mattered. It reads the RESOLVED queue directories and the run-slot locks — never systemd — so it
  // answers the same whichever drainer this box runs, which is a question this change does not decide.
  //
  // No override flag, deliberately. A timer retries in an hour; a human waits or clears the queue. An
  // escape hatch on an unattended path is a hatch that gets taken by the unattended path.
  const holds = liveRunHolds({ queueDirs: config.queueDirs, lockDir: config.runLockDir });
  const held = [...holds.queued, ...holds.claimed, ...holds.slots];
  if (held.length) {
    console.error(`\n  REFUSED — ${held.length} run(s) queued, claimed or in flight.`);
    for (const q of holds.queued) console.error(`    queued   ${q.id}`);
    for (const c of holds.claimed) console.error(`    claimed  ${c.id}  pid ${c.pid ?? "unknown"}`);
    for (const sl of holds.slots) console.error(`    slot     ${sl.file}  pid ${sl.pid}`);
    console.error("\n  `npm ci` rebuilds node_modules under whatever is running. Nothing was touched.");
    console.error("  Wait for the queue to drain, or clear it, and run this again.\n");
    return 4;
  }
  if (holds.unreadable.length) {
    // A queue this box cannot read is not an empty queue. Refusing here is the difference between
    // "nothing is running" and "I could not look", which is the distinction this repository keeps
    // learning the hard way.
    console.error("\n  REFUSED — a queue could not be read, so whether a run is in flight is unknown:");
    for (const u of holds.unreadable) console.error(`    ${u.path}: ${u.error}`);
    console.error("\n  That is an absence of evidence, not evidence of absence. Nothing was touched.\n");
    return 4;
  }

  say("\n  Configuration store is outside the checkout. Updating the product.");
  for (const e of entries) say(`    ${e.name}=${e.value} (${e.from})`);
  if (!entries.length) {
    say("    Nothing set — this install runs the bundled demo customers and our doctrine. That is a");
    say("    fine way to start, and it means an upgrade has nothing of yours to land on.");
  }

  // `--ff-only`: an update that produced a merge commit, or worse a conflict, would leave a user who
  // types one word holding a half-merged checkout with no idea what to do next. Refusing is the honest
  // outcome — it means their checkout has local changes or has diverged, which is a thing to look at.
  const pulled = runInCheckout("git", ["pull", "--ff-only"]);
  if (pulled !== 0) {
    console.error("\n  git pull --ff-only did not succeed, so nothing further was run.");
    console.error("  Usually this means local modifications to our files, or a diverged branch.");
    console.error("  `git status` will say which. Your configuration was not touched either way.\n");
    return pulled;
  }

  const installed = runInCheckout("npm", ["ci"]);
  if (installed !== 0) {
    console.error("\n  npm ci failed. The code is updated; its dependencies are not, so this install is");
    console.error("  in a half-updated state and should not be run until that command succeeds.\n");
    return installed;
  }

  // ── AND END WITH THE OVERLAY REPORT ──────────────────────────────────────────────────────────────
  //
  // The point of running it HERE is that a pull is exactly the moment our files move under a user's
  // overrides. Reported, never judged — an override is a choice, not a fault, and drift is information.
  say("\n  Doctrine overlay");
  try {
    const report = overlayReport({ baseRoot: config.skillsBaseDir, overlayRoot: config.skillsOverlayDir });
    for (const line of renderOverlayReport(report, { indent: "" })) say(`  ${line}`);
    if (report.ok && report.overlayConfigured) say("\n  Full detail: npm run doctrine-report");
  } catch (e) {
    // An unreadable overlay throws by design. It must not abort the verb after a successful update: the
    // update DID happen, and exiting nonzero here would tell a script it did not.
    console.error(`  the doctrine overlay could not be read — ${e.message}`);
  }

  say("\n  Up to date.\n");
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exit(await update());
