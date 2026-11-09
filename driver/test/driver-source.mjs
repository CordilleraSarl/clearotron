// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// driver-source.mjs — the driver's source text, for the tests that pin it, wherever a phase has moved to.
//
// The orchestrator is being carved into modules, one phase at a time. A test that reads `pipeline.mjs` by name would go red
// on each move though nothing about a run changed, so every such test reads through here: the file it names and, for the
// orchestrator, everything carved out of it. A pin is retired for a behaviour test when its code becomes reachable, not here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

// Where the phases carved out of a file live, in the order they are read after it.
const CARVED_FROM = { "pipeline.mjs": "steps" };

/** The source of a file under driver/, named from there, with whatever has been carved out of it appended. Throws on a file that is not there. */
export function driverSource(file) {
  const dir = CARVED_FROM[file] ? join(DRIVER, CARVED_FROM[file]) : null;
  const carved = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort().map((f) => join(dir, f)) : [];
  return [join(DRIVER, file), ...carved].map((p) => readFileSync(p, "utf8")).join("\n");
}
