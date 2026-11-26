// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// own-search-setting.mjs — whether a run's dictated searches are its own AI program's (engine/mcp/own-search.mjs).
//
// THE RUN'S OWN RECORD SAYS SO: the web-research service its door admitted, written once into `_driver/run-choices.json`
// beside its engine and register (engine/run-choices.mjs, `research`). Nothing else switches it, so the sweep, the
// research server and every later attempt of a stage read one answer, and a resume keeps it.
//
// A leaf on its own, so the research server can ask it without importing the session code, which reaches the engine's
// sign-in settings that no tool server is handed. It reads the record's file directly for the same reason: the record's
// module imports the configuration, and its file name is pinned equal to RUN_CHOICES_FILE by a test.
import { existsSync, readFileSync } from "node:fs";
import { driverDir } from "../../../shared/driver-dir.mjs";

export const RUN_RECORD_FILE = "run-choices.json";

/** Whether this run's dictated searches are its own AI program's. A stage experiment's shadow folder reads its run's record. IMPURE (reads). */
export function ownSearchOn(runDir) {
  if (!runDir) return false;
  const p = [runDir, String(runDir).split("/_experiments/")[0]].map((d) => driverDir(d, RUN_RECORD_FILE)).find((f) => existsSync(f));
  if (!p) return false;
  try { return String(JSON.parse(readFileSync(p, "utf8"))?.research ?? "").trim().toLowerCase() === "own"; } catch { return false; }
}
