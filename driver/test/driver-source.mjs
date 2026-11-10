// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// driver-source.mjs — the driver's source text, for the tests that pin it, wherever a phase has moved to.
//
// The orchestrator is being carved into modules, one phase at a time. A test that reads `pipeline.mjs` by name would go red
// on each move though nothing about a run changed, so every such test reads through here: the file it names and, for the
// orchestrator, everything carved out of it. A pin is retired for a behaviour test when its code becomes reachable, not here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { paths } from "../run-record.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

// Where the phases carved out of a file live, in the order they are read after it.
const CARVED_FROM = { "pipeline.mjs": "steps", "gateway.mjs": "ladder", "portal-service.mjs": "portal-routes" };
// A single module a file's definitions moved to whole, read after it the same way.
const MOVED_TO = { "stages.mjs": ["run-record.mjs"], "pipeline.mjs": ["run-record.mjs", "run-outcome.mjs"], "portal-service.mjs": ["portal-confirmation.mjs", "portal-runs.mjs"] };

/** The source of a file under driver/, named from there, with whatever has been carved out of it appended. Throws on a file that is not there. */
export function driverSource(file) {
  const dir = CARVED_FROM[file] ? join(DRIVER, CARVED_FROM[file]) : null;
  const carved = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort().map((f) => join(dir, f)) : [];
  const moved = (MOVED_TO[file] ?? []).map((f) => join(DRIVER, f));
  return [join(DRIVER, file), ...carved, ...moved].map((p) => readFileSync(p, "utf8")).join("\n");
}

/** The file names a source reaches through `paths(base).key`, for a test that pins which run files it reads. */
export function runFilesNamedIn(src) {
  const table = paths("");
  const named = [...src.matchAll(/\b(?:paths|runPaths)\([^;\n]*?\)\.(\w+)/g)].map((m) => table[m[1]]);
  return [...new Set(named.filter((v) => typeof v === "string").map((v) => basename(v)))];
}
