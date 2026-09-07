#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stop.mjs — the counterpart of `start --background`, by name, not "find the process and kill it".
//
//. It stops and REMOVES the pinned background units — removal matters, because the
// installed-units gate reads unit FILES to decide this box is a server, and a stop that left them
// behind would leave foreground `clearotron start` refusing on a laptop that is no longer running
// anything. The box goes back to the shape it had before `--background`.
//
// WHAT IT NEVER TOUCHES: the client door. `clearotron connect` opens that and `clearotron disconnect`
// closes it — a product stop must not silently revoke an assistant connection the reader made
// separately, and saying so here is cheaper than a reader discovering their assistant still works and
// wondering what else survived. Keys survive any stop; only `disconnect` revokes.

// FIRST IMPORT — the rename layer must apply before any module-top env capture evaluates.
import "../shared/env-local.mjs";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { systemdSaid, looksLikeBusFailure, busRemedy, CAPTURE_STDERR } from "../shared/systemd-failure.mjs";   // a stop that could not look must not report that it stopped
import { BACKGROUND_UNITS } from "./start.mjs";
import { CLIENT_DOOR_UNIT } from "../shared/client-door.mjs";
import { invoke } from "../shared/invocation.mjs";

const UNIT_DIR = join(homedir(), ".config", "systemd", "user");
const say = (s = "") => console.log(s);
// ON STDERR, because a refusal that scrolls past in the same stream as the success lines is a
// refusal a script cannot act on and a reader skims (tracker issue 270).
const err = (s = "") => console.error(s);

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  say("");
  say("  clearotron stop — stop the background product this box started with `start --background`.");
  say("");
  say("  Stops and removes those units, so the box is back to running nothing — and plain");
  say("  `clearotron start` works in a terminal again. An assistant connection made with");
  say("  `clearotron connect` is NOT touched; `clearotron disconnect` is its counterpart.");
  say("");
  process.exit(0);
}

let found = 0;
const failures = [];
for (const u of BACKGROUND_UNITS) {
  if (u === CLIENT_DOOR_UNIT) continue;   // structurally unreachable (the pin's census forbids it); belt anyway
  const file = join(UNIT_DIR, u);
  if (!existsSync(file)) continue;
  found++;
  // ── THE STOP IS VERIFIED, AND THE FILE GOES ONLY IF IT WORKED (tracker issue 270) ────────────────
  //
  // This was `catch { /* already down */ }` — a COMMENT standing in for a check. The comment guessed why
  // the call failed, the next line deleted the unit file regardless, and the line after that announced
  // "stopped and removed". Measured on a test box: `disable --now` failed for want of a session bus, all
  // four services stayed up on unchanged pids holding all three ports, three unit files were deleted, and
  // the command exited 0 saying the box ran nothing. The services were then unmanageable — running, with
  // no unit file to stop them by — which is strictly worse than leaving both alone.
  //
  // `is-active` is what decides, not the exit code of the disable, because the exit code is what lied.
  let stopped = false;
  let why = null;
  try {
    execFileSync("systemctl", ["--user", "disable", "--now", u], CAPTURE_STDERR);
  } catch (e) {
    why = systemdSaid(e);
  }
  // ASKED AFTER, WHATEVER THE DISABLE SAID. A disable that reported failure may still have stopped it,
  // and one that reported success may not have — only the state answers.
  try {
    const state = execFileSync("systemctl", ["--user", "is-active", u], { ...CAPTURE_STDERR, stdio: ["ignore", "pipe", "pipe"] });
    stopped = String(state).trim() !== "active";
  } catch (e) {
    // `is-active` exits non-zero for an inactive unit, which is the answer we want — but it exits
    // non-zero for "cannot reach systemd" too, and those must not read the same. The stdout is the
    // discriminator: an unreachable systemd prints nothing there.
    const said = String(e?.stdout ?? "").trim();
    if (said && said !== "active") stopped = true;
    else why = why ?? systemdSaid(e);
  }

  if (!stopped) {
    // NOT DELETED. A running service with no unit file cannot be stopped by any ordinary means.
    failures.push({ unit: u, why: why ?? "systemd still reports it active" });
    say(`  COULD NOT STOP ${u} — its unit file is left in place, so it can still be stopped`);
    continue;
  }
  try { rmSync(file, { force: true }); } catch { /* already gone */ }
  say(`  stopped and removed ${u}`);
}
// THE COMMENT HERE ALREADY NAMED THE CAUSE AND SHRUGGED AT IT. If there is no user bus, the disables
// above did not happen either — so this is where that is said.
try {
  execFileSync("systemctl", ["--user", "daemon-reload"], CAPTURE_STDERR);
} catch (e) {
  const said = systemdSaid(e);
  err(`  could not ask systemd to reload its units — ${said}`);
  if (looksLikeBusFailure(said)) err(`\n${busRemedy()}\n`);
}

if (!found) {
  say("  Nothing was running in the background — no pinned unit is installed on this box.");
  say("  Nothing to do, and nothing was changed.");
} else if (failures.length) {
  // THE SENTENCE THAT WAS WRONG. "The background product is stopped and the box runs nothing again" was
  // printed unconditionally — including on the run where four services stayed up. A reader who is told
  // that has no reason to look, which is what made the state unmanageable rather than merely wrong.
  err("");
  err(`  ${failures.length} of ${found} service(s) could NOT be stopped, and their unit files are left in place:`);
  for (const f of failures) err(`    ${f.unit}: ${f.why}`);
  if (failures.some((f) => looksLikeBusFailure(f.why))) err(`\n${busRemedy()}\n`);
  err("  Nothing was removed for these, so they can still be stopped once systemd can be reached.");
  err("  The box is NOT idle. This exits non-zero.");
  process.exitCode = 1;
} else {
  say("");
  say("  The background product is stopped and the box runs nothing again — plain `clearotron start`");
  say("  works in a terminal from here.");
  const door = existsSync(join(UNIT_DIR, CLIENT_DOOR_UNIT));
  if (door) say(`  Your assistant connection is untouched and still up; \`${invoke("disconnect")}\` is what closes it and revokes its key.`);
}
// NOT A BARE ZERO. A stop that could not stop something sets `exitCode` above, and exiting 0 here would
// discard it — printing the refusal and then reporting success, which is the shape this change removes.
process.exit(process.exitCode ?? 0);
