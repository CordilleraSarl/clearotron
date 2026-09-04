// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// grid-provenance.mjs —: WHAT SERVED THE COMMON-LAW GRID, BESIDE THE LEDGER IT SERVED.
//
// `common-law-grid.json` is the grid tool's stdout saved VERBATIM, and on the unsplit path no driver
// code touches it — so the answer cannot go IN it without either breaking that contract or landing
// only on split runs. An artifact that SOMETIMES says what produced it is worse than one that never
// does, because a reader cannot tell an unstamped run from an unstamped path.
//
// WHAT A READER GETS WRONG WITHOUT IT, measured on the 2026-08-24 R2 round: a flat SerpAPI counter was
// read across this lane and the lane reported as quota-starved. SerpAPI does not serve this lane at
// all — the grid runs inside PERPLEXITY's agent sandbox — and no artifact in the run said so. That
// retraction is the whole reason this file exists.
//
// PURE record builder + one writer, so the shape can be tested without standing up an MCP server:
// perplexity-server.mjs calls `serve()` at module load, so a test cannot import it to reach this.
import { writeFileSync } from "node:fs";

/** The sidecar sits beside the ledger, derived from the ledger's own path — never a composed run-dir layout. */
export function gridProvenancePath(outputPath) {
  return String(outputPath).replace(/\.json$/, ".provenance.json");
}

/**
 * NO COST FIELD, deliberately. The agent API's response carries no per-call credit figure, so any
 * number here would be one this code invented. `cells` is a count of what was asked and what came
 * back, and it says so in its own note, because "cells" beside a provider name reads as a bill.
 */
export function gridProvenanceRecord({ ran, present, requested, model = null }) {
  return {
    _what: "#1846 — which provider served common-law-grid.json, written beside it because the ledger itself is saved verbatim.",
    provider: "perplexity",
    surface: "agent API, sandbox tool",
    tool: "perplexity_research",
    preset: "pro-search",
    model: model ?? "(provider default for the preset)",
    ran,
    _ran: ran
      ? "this call executed the grid"
      : "the ledger was already complete for this spec, so nothing was bought — the sweep is a fact of the run, not of this attempt",
    cells: { present, requested },
    _cells: "A COUNT OF CELLS, NOT A COST. The agent API returns no per-call credit figure, so this file states no price rather than inventing one.",
  };
}

/** Best-effort, like every sidecar on this path: never cost a completed grid over a provenance file. */
export function writeGridProvenance(spec, opts) {
  try {
    writeFileSync(gridProvenancePath(spec.output_path), JSON.stringify(gridProvenanceRecord(opts), null, 2) + "\n");
  } catch { /* the grid is already on disk and cost real money — a sidecar fault must never undo that */ }
}
