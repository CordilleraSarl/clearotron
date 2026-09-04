#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// status.mjs — is the product up, and on which ports. Reads; changes nothing.
//
//: "a reader whose portal has quietly gone should not have to read a process list."
// This answers for the BACKGROUND units and the connect-opened door; a foreground `clearotron start`
// is its own status — it is on a screen, saying things. Deeper configuration questions belong to
// `clearotron doctor`, which this points at rather than half-duplicating.

// FIRST IMPORT — the rename layer must apply before any module-top env capture evaluates.
import "../shared/env-local.mjs";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { BACKGROUND_UNITS, resolvePorts } from "./start.mjs";
import { parseEnvFile } from "../driver/systemd/render-units.mjs";   // ONE KEY=value reader — what systemd actually reads
import { CLIENT_DOOR_UNIT, clientDoorPort } from "../shared/client-door.mjs";
import { invoke } from "../shared/invocation.mjs";
import { configStaleness, stalenessWarning, parseSystemdTimestamp } from "../driver/config-staleness.mjs";   // — F48

const UNIT_DIR = join(homedir(), ".config", "systemd", "user");
const say = (s = "") => console.log(s);

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  say("");
  say("  clearotron status — is the product up, and on which ports. Reads; changes nothing.");
  say("");
  process.exit(0);
}

const state = (u) => {
  try {
    const out = execFileSync("systemctl", ["--user", "show", u, "-p", "ActiveState", "-p", "SubState"], { encoding: "utf8" });
    const f = Object.fromEntries(out.trim().split("\n").map((l) => l.split("=")));
    return `${f.ActiveState}/${f.SubState}`;
  } catch { return "unreadable"; }
};

/**
 * When this unit last became active, as an EPOCH in milliseconds ( — F48).
 *
 * Only the shell-out lives here. Interpreting what systemd prints is `parseSystemdTimestamp`, in the
 * pure module beside the comparison it feeds — the split exists because the interpretation is the half
 * that had the bug, and it is drivable there over the real outputs with no stub.
 *
 * null is could-not-look and is never folded into "current". That collapse IS the finding.
 */
const startedEpochMs = (u) => {
  try {
    const out = execFileSync("systemctl",
      ["--user", "show", u, "-p", "ActiveEnterTimestamp", "--timestamp=unix"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const line = String(out).split("\n").find((l) => l.startsWith("ActiveEnterTimestamp="));
    return parseSystemdTimestamp(line?.slice("ActiveEnterTimestamp=".length));
  } catch { return null; }
};say("");
let installed = 0;
for (const u of BACKGROUND_UNITS) {
  if (!existsSync(join(UNIT_DIR, u))) continue;
  installed++;
  say(`  ${u.padEnd(34)} ${state(u)}`);
}
if (!installed) {
  say("  No background units are installed — this box runs the product only while a terminal holds");
  say(`  \`clearotron start\`. \`clearotron start --background\` is the form that survives the terminal.`);
} else {
  // The ports come from the same resolver start uses, RESOLVED OVER THE UNITS' OWN FILE: the running
  // services read %h/.env via systemd, and this CLI's shell env may know nothing of it — the first
  // drive of this verb reported the DEFAULT ports while the units answered on the configured ones.
  // The file wins, because the question is which ports the UNITS are on, not which this shell would use.
  let ports = null;
  try {
    let home = {};
    try { home = parseEnvFile(readFileSync(join(homedir(), ".env"), "utf8")); } catch { /* no file — shell env alone */ }
    ports = resolvePorts({ ...process.env, ...home });
  } catch { /* named below */ }
  if (ports) say(`\n  portal http://127.0.0.1:${ports.portal}/portal · engine door 127.0.0.1:${ports.mcp}`);
  else say("\n  the port configuration does not resolve — `clearotron doctor` names what is wrong");

  // ── ACTIVE IS NOT CURRENT ( — F48) ────────────────────────────────────────
  //
  // Three services ran replaced configuration for forty minutes while this command reported all four
  // active/running — because they WERE. A process reads its environment once, at start, so "is it up"
  // and "is it using the configuration on disk" are different questions and only the first was asked.
  // The only signal was a roster looking wrong in a screenshot, spotted by eye.
  const ENV_FILE = join(homedir(), ".env");
  let configEpochMs = null;
  try { configEpochMs = statSync(ENV_FILE).mtimeMs; } catch { /* no file: nothing to be behind */ }
  const rows = configStaleness({
    configEpochMs,
    units: [...BACKGROUND_UNITS, CLIENT_DOOR_UNIT]
      .filter((u) => existsSync(join(UNIT_DIR, u)))
      .map((u) => ({ name: u, startedEpochMs: startedEpochMs(u) })),
  });
  const stale = rows.filter((r) => r.state === "stale");
  const unknown = rows.filter((r) => r.state === "unknown");
  if (stale.length) say(`\n  ⚠ ${stalenessWarning(stale)}`);
  // A could-not-look is reported as one. It is not a fault and it is not a clean bill of health, and
  // silently treating it as the latter is the collapse this whole check exists to undo.
  else if (unknown.length && configEpochMs !== null)
    say(`\n  · whether ${unknown.length} service(s) are running the current configuration could not be determined`
      + ` — their start time was unreadable. This is not a report that they are current.`);
}
if (existsSync(join(UNIT_DIR, CLIENT_DOOR_UNIT))) {
  say(`  ${CLIENT_DOOR_UNIT.padEnd(34)} ${state(CLIENT_DOOR_UNIT)}  (assistant connection — 127.0.0.1:${clientDoorPort(process.env)}; \`${invoke("disconnect")}\` closes it)`);
}
say(`\n  Configuration questions: ${invoke("doctor")}`);
process.exit(0);
