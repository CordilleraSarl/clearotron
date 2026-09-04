// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// declination-server.mjs — synthesis's typed transport for the records it does NOT deliver.
//
// ── WHY ITS OWN SERVER AND ITS OWN KEY, WHICH IS THE WHOLE DESIGN DECISION HERE ─────────────────────
//
// This is `coverage`'s shape, one lane over, and NOT the RECORDING category's — that choice was made
// twice, the second time after building it the other way and measuring what broke.
//
// The RECORDING category exists to move a stage's ARTIFACT from seat-written to driver-written: every
// row carries `seatWrites: false`, the corrective ladder re-routes repairs of that artifact to a call,
// and the agreement guard proves the stage is never still ordered to hand-write it. Synthesis is not
// doing any of that. It authors findings.json now and always will. It needs ONE extra tool for the half
// of its judgment no artifact ever held — what it decided NOT to deliver.
//
// Joining RECORDING to get that one tool made synthesis the first `seatWrites: true` row in a table
// whose every invariant assumes the opposite, and the guards said so immediately: the corrective ladder
// began generating repair messages that named a driver-written ledger and a hand-written deliverable in
// one breath, and the agreement guard read a legitimate "write findings.json" order as a banned
// hand-write of declinations.json. Neither guard was wrong. The category was.
//
// `coverage` had already solved it: "ITS OWN KEY, NOT A TOOL ON `band` ... One tool, one key, granted by
// exactly one stage's group list", and — the line that decides it — "an allowlist growing by one token
// on an ALREADY-TOOLED stage, so no argv-surface transition fires and the RECORDING tables are
// untouched." That is exactly what synthesis needs and exactly what it costs.
//
// NOT A TOOL ON `band` OR `perplexity`, for that ruling's own reason: `band` is held by four judgment
// stages and `perplexity` by two, so a record tool riding either would be enumerated into every holder's
// grant — the second-writer disease arriving as an allowlist side effect rather than as a decision.
//
// ── WHAT IT IS NOT ─────────────────────────────────────────────────────────────────────────────────
//
// It dials nothing. It reads one driver-written spec in this run's own `_driver` and appends to one
// ledger beside it. The retrieval surface is unchanged, which is the promise every typed-transport key
// in this build makes and the only one that matters for the grant review.
import { serve } from "./stdio-server.mjs";
import { recordDeclinations } from "../../declination-tool.mjs";
import { MAX_DECLINATIONS_PER_CALL, DECLINATION_REASONS, DECLINATION_REASON_TOKENS } from "../../declination-call.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";   //

const DECLINATION_SPEC = "declination-spec.json";

/**
 * The offered list and the job's own scope, BOTH driver-authored, read fresh per call.
 *
 * `rows` is every record this synthesis pass has on its findings surface, in the dispatch's order, and
 * the seat cites one by POSITION. `scope` is instructed-scope.json, written before any model ran — the
 * only facts the tool's refusal rests on. Neither is the seat's, which is the point: a record the pass
 * was never handed is one it cannot speak about, and a fact it cannot author is one it cannot bend.
 *
 * Read at CALL TIME and never cached: the spec is rewritten per synthesis pass, and a cached copy would
 * let a corrective pass cite positions from the pass before it — two readers of one file disagreeing,
 * which is the failure the doubt-closure transport's own loader records in the same words.
 */
function loadDeclinationSpec(runDir) {
  const spec = JSON.parse(readFileSync(driverDir(runDir, DECLINATION_SPEC), "utf8"));
  return {
    runDir,
    rows: Array.isArray(spec?.rows) ? spec.rows : [],
    scope: spec?.scope ?? {},
  };
}

async function record_declination(params) {
  // `CLEAROTRON_BAND_RUN_DIR` at CALL TIME, and there is no `run_dir` parameter — the run is not the seat's
  // to name. 's lesson, where an invented fallback sat two lines under a promise never to guess.
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  let spec;
  try { spec = loadDeclinationSpec(runDir); }
  catch (e) { return { error: `no readable ${DECLINATION_SPEC} in this run (${String(e?.message ?? e).slice(0, 120)}) — the driver writes it before dispatching this stage` }; }
  return recordDeclinations(spec, params);
}

serve({
  name: "declination",
  tools: [{
    name: "record_declination",
    description:
      "Record, per record, your decision NOT to deliver something that reached your findings surface. " +
      "Every record the digest carried to you either becomes a finding or carries a stated reason it did " +
      "not — there is no third way out, and a record left silent is reported as a defect of this run and " +
      "named individually in its trace. One call carries a batch; the answer tells you what was accepted, " +
      "what was refused and why, and WHICH RECORDS STILL CARRY NO DECISION, so you can finish inside this " +
      "turn. A refusal is about bookkeeping, never about your legal judgment: a reason is refused only " +
      "where it contradicts a fact the job recorded before this run started.",
    inputSchema: { type: "object", required: ["declinations"], properties: {
      declinations: {
        type: "array",
        description: `Up to ${MAX_DECLINATIONS_PER_CALL} rows per call. Send more in a further call; every accepted row is kept — a refused row never voids its neighbours.`,
        items: { type: "object", required: ["row_index", "reason", "grounds"], properties: {
          row_index: {
            type: "integer",
            description: "The POSITION of the record in the findings-surface list this stage was handed. There is no field for a uri or a mark name — a record you were not given cannot be expressed.",
          },
          reason: {
            type: "string",
            enum: [...DECLINATION_REASON_TOKENS],
            description: "The category, from the closed set the synthesis rules already authorise: "
              + DECLINATION_REASON_TOKENS.map((t) => `${t} — ${DECLINATION_REASONS[t].gloss}`).join(" · ")
              + ". If your ground is none of these, the rules do not let you omit the record.",
          },
          grounds: {
            type: "string",
            description: "One or two lines, in your own words, on why THIS record does not earn a line. Never machine-parsed — it is what the reviewing lawyer reads. The reason token is the category; this is the substance.",
          },
        } },
      },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_declination,
  }],
});
