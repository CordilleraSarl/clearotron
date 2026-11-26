// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// own-search-setting.mjs — whether a run's dictated searches are its own AI program's (engine/mcp/own-search.mjs).
//
// A leaf on its own, so the research server can ask it without importing the session code, which reaches the engine's
// sign-in settings that no tool server is handed.
import { existsSync, readFileSync } from "node:fs";
import { driverDir } from "../../../shared/driver-dir.mjs";

export const OWN_SEARCH_SETTING_FILE = "research-search.json";

/** Whether this run's dictated searches are its own AI program's. A stage experiment's shadow folder reads its run's setting. IMPURE (reads). */
export function ownSearchOn(runDir) {
  if (!runDir) return false;
  const p = [runDir, String(runDir).split("/_experiments/")[0]].map((d) => driverDir(d, OWN_SEARCH_SETTING_FILE)).find((f) => existsSync(f));
  if (!p) return false;
  try { return JSON.parse(readFileSync(p, "utf8"))?.service === "own"; } catch { return false; }
}
