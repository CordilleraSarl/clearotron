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
import { BACKGROUND_UNITS } from "./start.mjs";
import { CLIENT_DOOR_UNIT } from "../shared/client-door.mjs";
import { invoke } from "../shared/invocation.mjs";

const UNIT_DIR = join(homedir(), ".config", "systemd", "user");
const say = (s = "") => console.log(s);

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
for (const u of BACKGROUND_UNITS) {
  if (u === CLIENT_DOOR_UNIT) continue;   // structurally unreachable (the pin's census forbids it); belt anyway
  const file = join(UNIT_DIR, u);
  if (!existsSync(file)) continue;
  found++;
  try { execFileSync("systemctl", ["--user", "disable", "--now", u], { stdio: "ignore" }); } catch { /* already down */ }
  try { rmSync(file, { force: true }); } catch { /* already gone */ }
  say(`  stopped and removed ${u}`);
}
try { execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" }); } catch { /* no user bus */ }

if (!found) {
  say("  Nothing was running in the background — no pinned unit is installed on this box.");
  say("  Nothing to do, and nothing was changed.");
} else {
  say("");
  say("  The background product is stopped and the box runs nothing again — plain `clearotron start`");
  say("  works in a terminal from here.");
  const door = existsSync(join(UNIT_DIR, CLIENT_DOOR_UNIT));
  if (door) say(`  Your assistant connection is untouched and still up; \`${invoke("disconnect")}\` is what closes it and revokes its key.`);
}
process.exit(0);
