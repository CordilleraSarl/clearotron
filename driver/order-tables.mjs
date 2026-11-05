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
// AT CALL TIME, never a static import. The register SELECTION table lives in `bin/onboard.mjs`, a CLI entry
// point, and a static import from `driver/` would point the driver at `bin/` — the cycle that makes
// `clearotron doctor` exit 13 after printing most of a report. This module sits outside run-requirements.mjs
// so that module stays pure and reaches nothing in `bin/`.
let tables = null;
export async function runTables() {
  if (!tables) {
    const { PROVIDERS } = await import("../bin/onboard.mjs");
    const { ENGINE_BINARIES, DEFAULT_ENGINE_ID, resolveEngineProgram } = await import("./driver.config.mjs");
    tables = { registers: PROVIDERS, engines: ENGINE_BINARIES, defaultEngine: DEFAULT_ENGINE_ID, resolveEngine: resolveEngineProgram };
  }
  return tables;
}
