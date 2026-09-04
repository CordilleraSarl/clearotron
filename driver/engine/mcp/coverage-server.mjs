#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-server.mjs — the seat-facing surface of the typed coverage transport (register-digest).
//
// ── ITS OWN KEY, GRANTED TO EXACTLY ONE STAGE, and that is the point of it being a separate server ──
//
// The digest's other tools ride the `band` key, and `band` is held by FOUR judgment stages
// (register-digest, placement-inquiry, narrative-refutation, synthesis). A record tool added to that
// shared entry would be enumerated into every holder's grant — a synthesis seat handed a writer into
// the digest's coverage accumulator. That is the second-writer disease arriving as an allowlist side
// effect, the exact shape gather-config's RECORDING split names and refuses. So this server carries
// one tool, its LOCAL key is granted only by register-digest's group list, and
// server-tools-granted-or-stated.test.mjs is what keeps any wider grant deliberate.
//
// ── THE SEAT SUPPLIES NO CONTEXT AT ALL — not even a path ───────────────────────────────────────────
//
// The run dir is CLEAROTRON_BAND_RUN_DIR — serverEnv (gather-config.mjs) sets it for EVERY local server,
// wired per run by the driver; there is no parameter for it and this tool never guesses one
// (recording-server.mjs's record_doubt_closure records why the parameter must not exist). The form name comes off the run's own
// era stamp, the row ids are the driver's, and every other identifier is computed. Read at CALL TIME,
// never captured at module load (stdio-server.mjs:29-33 states why for exactly this variable).
import { serve } from "./stdio-server.mjs";
import { recordCoverage } from "../../coverage-tool.mjs";
import { MAX_ROWS_PER_CALL } from "../../coverage-call.mjs";

async function record_coverage(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) return { isError: true, text: "ERROR: this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one." };
  // NEVER THROWN PAST THIS POINT. An exception surfaces to the seat as a tool error naming no row,
  // which tells it nothing about what to fix — the failure mode this transport exists to end.
  try {
    const r = recordCoverage(runDir, params);
    return { isError: !r.ok, text: r.text };
  } catch (e) {
    return { isError: true, text: `ERROR: the driver could not record this call (${String(e?.message ?? e).slice(0, 200)}). This is a driver fault, not a fault in your rulings — do not re-type them.` };
  }
}

serve({
  name: "coverage", version: "0.1.0",
  tools: [{
    name: "record_coverage",
    description:
      "Record your coverage-ledger rulings as VALUES. The driver writes the form — you never open or edit any " +
      "coverage file, so a quote character cannot void a ruling. One call carries a batch: rule a driver row with " +
      "{row_id, status, reason}; add a row of your own with {kind:\"seat\", axis, unit, status, reason}; withdraw " +
      "a row you added with {retract: \"<row_id>\"}. Rows are validated against THIS run's own obligations as they " +
      "arrive, so you learn what to fix inside this turn; rows that validate are kept even when others in the same " +
      "call are refused, and statuses accumulate — a row settled once stays settled. The answer names every " +
      "obligation still outstanding.",
    inputSchema: { type: "object", required: ["rows"], properties: {
      rows: {
        type: "array",
        description: `Up to ${MAX_ROWS_PER_CALL} rows per call. Send more in a further call; the answer tells you what is left.`,
        items: { type: "object", properties: {
          row_id: { type: "string", description: "A driver row's id, exactly as the dispatch's obligations block lists it. Omit on a seat row you are adding — the driver mints seat row ids." },
          status: { type: "string", description: "EXACTLY one bare token of confirmed-clean / coverage-limited / deferred. Qualifiers go in the reason." },
          reason: { type: "string", description: "The sentence the lawyer reads — say what was searched and what was not, in a lawyer's words, never the engine's." },
          kind: { type: "string", description: "\"seat\" on a row you add for a coverage unit the plan does not contain. Never anything else." },
          axis: { type: "string", description: "Seat rows only: EXACTLY one bare token of the closed register-axis vocabulary the dispatch lists." },
          unit: { type: "string", description: "Seat rows only: \"<axis> / <what you swept>\" — the counted dominant-element crowd row carries \"(<N> members)\" in this cell and nowhere else." },
          retract: { type: "string", description: "The row_id of a seat row to withdraw. Driver rows are obligations and cannot be retracted. Silence never removes anything." },
        } },
      },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_coverage,
  }],
});
