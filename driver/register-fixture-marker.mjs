// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// register-fixture-marker.mjs — whether this run's register answers come from a fixture directory. From the job, never
// the environment: it is a fact about the run, and every tool server a stage spawns reads it here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { driverDir } from "../shared/driver-dir.mjs";

export const REGISTER_FIXTURE_MARKER = "register-fixtures.json";

/** Mount the fixture register for this run's stages. */
export function writeFixtureMarker(runDir, records) {
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, REGISTER_FIXTURE_MARKER), JSON.stringify({ records }, null, 2) + "\n");
}

/** The fixture directory this run's register answers come from, or null on a run that asks the register. */
export function fixtureRecordsDir(runDir) {
  const p = driverDir(runDir, REGISTER_FIXTURE_MARKER);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8"))?.records ?? null; } catch { return null; }
}
