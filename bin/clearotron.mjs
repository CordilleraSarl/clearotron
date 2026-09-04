#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clearotron — the one command. It resolves a verb to a file and hands that file argv, unchanged.
//
// THIS FILE IMPLEMENTS NOTHING. Every verb below already existed as a runnable file before this
// dispatcher did, and each is still runnable directly. The reason that matters: `bin/onboard.mjs`
// validates each credential against the live service through the doors the engine itself uses, and
// has been hardened through, and plus a cache-bust around a module-level const.
// A dispatcher that re-checked any of that would be a second, weaker copy of a check that already
// exists — so this one spawns and forwards, and does not look at what it is forwarding.
//
// The verb table is DECLARED here and HELD to disk by test/. A hardcoded table that nobody checks
// goes stale in the direction that cannot fail: it advertises a verb whose file was renamed, and the
// only symptom is a stranger typing a command that does not work. owns widening this — full
// --help text, the derived listing, and completion. This is the minimum that makes the published
// package a command rather than a directory of scripts.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { constants as SIG } from "node:os";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";
import { invocationPrefix } from "../shared/invocation.mjs";   // — print a command the reader can type

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * item 5 — the published version, from the ONE place that holds it.
 *
 * EXPORTED so the test reads it the same way the command does. An unreadable or version-less manifest
 * answers `unknown` rather than throwing: someone is typing this because something is already wrong,
 * and a stack trace in place of a version number costs them the answer they came for.
 */
export function readPackageVersion(root = ROOT) {
  try {
    const v = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))?.version;
    return typeof v === "string" && v.trim() ? v.trim() : "unknown";
  } catch { return "unknown"; }
}

// verb -> [file relative to the package root, ...arguments that are part of the verb's meaning]
// `doctor` is `install --check`: the same file, the half of it that writes nothing.
export const VERBS = {
  install: ["bin/onboard.mjs"],
  doctor:  ["bin/onboard.mjs", "--check"],
  demo:    ["bin/example.mjs"],
  start:   ["bin/start.mjs"],
  stop:    ["bin/stop.mjs"],
  status:  ["bin/status.mjs"],
  connect: ["bin/connect.mjs"],
  disconnect: ["bin/disconnect.mjs"],
  run:     ["driver/pipeline.mjs"],
  drain:   ["driver/runner.mjs"],
  cancel:  ["bin/cancel.mjs"],
  grant:   ["bin/grant.mjs"],
  key:     ["bin/key.mjs"],
  brandowner: ["bin/brandowner.mjs"],
  project: ["bin/project.mjs"],
  passphrase: ["bin/passphrase.mjs"],
  sync:    ["bin/uspto-sync.mjs"],
  update:  ["bin/update.mjs"],
};

export const SUMMARY = {
  install: "configure this install — one question at a time, nothing written until each answer checks out",
  doctor:  "report what this machine is configured for. Writes nothing, calls nobody",
  demo:    "replay a finished example clearance and serve it. No keys, no model, no account",
  start:   "start the product — the portal and the engine door — and print one address to open",
  stop:    "stop the background product and give the box back — connect's door is not touched",
  status:  "is the product up, and on which ports. Reads; changes nothing",
  connect: "connect the assistant you already use — pick it by name and get the one thing it needs",
  disconnect: "close what connect opened and revoke the key it issued — the enrolment stays",
  run:     "run one clearance from a job file",
  drain:   "do the queued work. THIS SPENDS: hours of model time and real register calls",
  cancel:  "stop one run by name. The rest of the product keeps running, and nothing resumes it",
  grant:   "enrol a client, or list who may see what",
  key:     "issue the key a person's own assistant presents — after you have enrolled them with `grant`",
  brandowner: "onboard a brand owner — create its bundle and set the risk framework its matters are rated under",
  project: "add an engagement under a brand owner — the classes, jurisdictions and platforms it searches",
  passphrase: "report or RESET the portal's local sign-in — the recovery for a lost passphrase",
  sync:    "build or update the free US register index (a large download, and hours of ingest)",
  update:  "bring this install up to date — and REFUSE to do it over the top of your own configuration",
};

/**
 * Runnable entry points in `bin/` that are deliberately NOT verbs, each with the reason.
 *
 * asks for the verb list to be derived from what is on disk rather than hardcoded. A list of
 * SUMMARIES cannot be derived — nobody writes prose by walking a directory — so what is derived is the
 * COMPLETENESS CHECK: a test enumerates `bin/*.mjs`, and every one must be either a verb or named here
 * with a reason. That closes the gap the requirement is about (a runnable thing on disk that the one
 * command cannot reach) while the line a reader sees stays written by a person.
 *
 * An empty declaration would defeat it, so the test asserts each entry still matches a real file: an
 * exemption that has stopped being needed is deleted rather than carried.
 */
export const NOT_VERBS = {
  "clearotron.mjs": "this dispatcher itself — the thing doing the reaching cannot be one of the things "
    + "reached, and a `clearotron clearotron` verb would be a loop with a friendly name.",
  "signa-sync.mjs": "a MAINTAINER tool, not a user verb. It regenerates a COMMITTED snapshot of the "
    + "vendor's office list so a coverage change arrives as a diff in a pull request rather than as a "
    + "different answer on a Tuesday (owner decision, 2026-08-16). Exposing it as a verb would invite "
    + "a user to run it, and its output is a source file this repo reviews.",
};

// The dispatch runs only when this file IS the command. Without the guard, importing it to read the
// verb table would DISPATCH — the test that holds the table to disk would run a clearance verb.
function main() {
  
const [verb, ...rest] = process.argv.slice(2);

  // item 5 — THE FIRST THING ANYONE TYPES WHEN REPORTING A PROBLEM, and the first thing we ask
  // for. Read from `package.json`, never a second copy: a hardcoded string is wrong the first time
  // somebody forgets it, and nothing fails when it is.
  if (verb === "--version" || verb === "-v" || verb === "version") {
    console.log(readPackageVersion());
    process.exit(0);
  }

  if (!verb || verb === "--help" || verb === "-h" || verb === "help") {
    const width = Math.max(...Object.keys(VERBS).map((v) => v.length));
    console.log(`\n  ${invocationPrefix()}clearotron <verb> [options]\n`);
    for (const v of Object.keys(VERBS)) console.log(`    ${v.padEnd(width)}  ${SUMMARY[v]}`);
    console.log("\n  Any option after the verb is passed through unchanged.\n");
    process.exit(verb ? 0 : 1);
  }

  if (!Object.hasOwn(VERBS, verb)) {
    // Name what was typed and what exists. A bare "unknown command" makes a typo cost a second guess.
    console.error(`clearotron: no such verb "${verb}". One of: ${Object.keys(VERBS).join(", ")}`);
    process.exit(2);
  }

  // — EVERY VERB ANSWERS --help, INCLUDING THE TWO WHOSE CHILDREN REFUSE IT.
  //
  // `run` and `drain` dispatch to driver/pipeline.mjs and driver/runner.mjs, orchestrator entry points
  // with strict argument parsers and no help path: `--help` came back as `error: unknown flag --help`,
  // exit non-zero. Their parsers are RIGHT to refuse what they do not understand -- that is what makes
  // them fail safe, and showed what the permissive alternative costs (`update --help` performed
  // the update). So the dispatcher answers for them rather than loosening a parser that is doing its job.
  //
  // A LIST, NOT A PROBE, and deliberately: asking a child whether it handles --help means RUNNING it,
  // and two of these verbs spend real money. The list is short, it sits beside VERBS, and a verb added
  // without an entry gets the dispatcher's answer -- which is the safe direction to be wrong in.
  const HELP_FROM_CHILD = new Set(["install", "doctor", "demo", "start", "grant", "key", "passphrase", "sync", "update", "connect", "disconnect", "stop", "status"]);
  if ((rest.includes("--help") || rest.includes("-h")) && !HELP_FROM_CHILD.has(verb)) {
    console.log(`\n  ${invocationPrefix()}clearotron ${verb} — ${SUMMARY[verb]}\n`);
    console.log(`  Options after the verb are passed through to ${VERBS[verb][0]}, which has no --help of`);
    console.log(`  its own. Run it with no arguments to see what it requires.\n`);
    if (verb === "run" || verb === "drain") {
      console.log(`  THIS SPENDS: hours of model time and real register calls. See INSTALL.md §5 and §6.\n`);
    }
    process.exit(0);
  }

  const [rel, ...builtin] = VERBS[verb];
  const target = join(ROOT, rel);
  // An absent target is a PACKAGING defect, not a user error, and it must not read like one: the files
  // allowlist in package.json decides what ships, and a verb whose file was excluded fails here rather
  // than during someone's first clearance.
  if (!existsSync(target)) {
    console.error(`clearotron: ${verb} resolves to ${rel}, which is not in this install — the package is incomplete.`);
    process.exit(70);
  }

  // — tell the child how the READER reached us, so its own advice names a command they can type.
  // Without this every spawned verb sees argv[1] = its own implementation file and would print `npx`
  // even for somebody who typed a bare `clearotron`.
  const child = spawn(process.execPath, [target, ...builtin, ...rest], {
    stdio: "inherit",
    env: { ...process.env, CLEAROTRON_INVOKED_AS: process.argv[1] ?? "" },
  });
  child.on("error", (e) => { console.error(`clearotron: could not run ${rel}: ${e.message}`); process.exit(70); });
  // Reproduce the child's exit faithfully. A signal death reported as exit 0 would tell a script that a
  // killed clearance succeeded, so a signal becomes the shell's 128+n rather than falling through to 0.
  child.on("exit", (code, signal) => {
    if (signal) process.exit(128 + (SIG.signals[signal] ?? 0));
    process.exit(code ?? 0);
  });
}

// RESOLVE BOTH SIDES THROUGH SYMLINKS. `npm install` puts a symlink at node_modules/.bin/clearotron, so
// process.argv[1] is the LINK and import.meta.url is the target — comparing them raw makes this guard
// false for every installed user, and the command then does nothing at all: exit 0, no output. The unit
// arm cannot see it (it imports the module) and neither can running this file directly. It was found by
// `scripts/verify-publishable.mjs`, which types the verbs at a tree with no checkout.
//
// / SWEPT SIXTEEN OTHER SITES OF THIS AND BUILT THE PREDICATE. This file is the seventeenth,
// and it arrived from the other direction: their scan walks the tracked tree, and this file was not on
// main to be walked. It uses their helper rather than the inline realpath it shipped with, because two
// implementations of one comparison is what that sweep exists to remove — and the failure mode here is
// SILENCE, so a second copy drifting would announce nothing.
if (isEntrypoint(import.meta.url)) main();
