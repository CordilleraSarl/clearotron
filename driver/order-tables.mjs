// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// order-tables.mjs — the tables an order is checked against, loaded once, for every door that asks.
//
// `orderTimeRefusal` (run-requirements.mjs) is the one test for "can this install run a search", and it is
// pure: the register and engine tables arrive from the caller. The runner's intake wall and the portal's order
// door both take them from HERE, so the two ask one question of one set of tables and cannot disagree. The
// portal used to ask nothing: it said "queued", and the runner then refused the order with no one watching.
//
// The register SELECTION table is read from `shared/register-selection.mjs`, where it moved out of the setup wizard
// (`bin/onboard.mjs`, which re-exports it). Reaching it through the wizard pointed the driver at `bin/`: the wizard
// imports the portal service, which imports this module, so the three closed a loop, and the static form of that
// import is what made `clearotron doctor` exit 13 after printing most of a report. This module sits outside
// run-requirements.mjs so that module stays pure.
import { PROVIDERS } from "../shared/register-selection.mjs";
let tables = null;
export async function runTables() {
  if (!tables) {
    const { ENGINE_BINARIES, DEFAULT_ENGINE_ID, resolveEngineProgram } = await import("./driver.config.mjs");
    tables = { registers: PROVIDERS, engines: ENGINE_BINARIES, defaultEngine: DEFAULT_ENGINE_ID, resolveEngine: resolveEngineProgram };
  }
  return tables;
}
