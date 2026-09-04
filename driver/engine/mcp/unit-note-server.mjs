#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unit-note-server.mjs — the seat-facing surface of the register unit's typed audit-note transport.
//
// ── ITS OWN KEY, AND NOT THE RECORDING CATEGORY, WHICH IS A DECISION RATHER THAN A SHORTCUT ────────
//
// Every RECORDING row declares `seatWrites: false`, and that flag is the category's whole safety
// argument: the artifact becomes the driver's, so nothing the seat is ASKED to produce needs a writer,
// so the writer goes. register-unit is the first stage where that is false. Its dispatch carries a
// ternary on the plan's `supplemental_lane` contract, and the lane-OFF branch orders the seat to
// hand-write the named band — a path that is live for a matter with NO NICE CLASSES, which compiles no
// register plan at all (pipeline.mjs sets ctx.registerPlan null, and `band_block_unplanned` is itself
// gated on the same flag so the validator deliberately steps aside for it). Taking `Write` away breaks
// a current configuration, not a legacy one.
//
// `seatWrites: true` inside RECORDING is not the answer either: it was tried and the guards refused it
// within one run (gather-config.mjs's `declination` entry records it — "the corrective began naming a
// driver-written ledger and a hand-written deliverable in one message. Neither guard was wrong; the
// category was"). So this takes the shape the tree already carries for exactly this situation —
// `coverage` / `declination` / `dispositions`: one tool on its own LOCAL key, granted by exactly one
// stage's group list, an allowlist growing by one token on an already-tooled stage.
//
// The note still becomes the driver's, and the machinery that matters for that is `toolWrittenArtifact`
// in gateway.mjs, which is keyed on the PATH and not on category membership: a repair naming this file
// is re-routed to this call instead of to the write-mode tails. `recording-agreement.test.mjs` requires
// RECORDING → the artifact tables, never the reverse.
//
// ── THE AXIS IS THE DRIVER'S ANSWER, NOT THE SEAT'S ────────────────────────────────────────────────
//
// register-unit fans out one seat per axis and the driver knows which one it dispatched, so the axis
// arrives as CLEAROTRON_RECORD_AXIS and a payload naming any other is refused here. That is the
// `record_report_card` pattern (recording-server.mjs) and it exists for the same reason: a fan-out seat
// that can name its own index can file its work under someone else's. Read at CALL TIME, never captured
// at module load: stdio-server.mjs's "ONE FILE PER RUN, resolved at CALL TIME" note states why for this
// class of variable — "a module-load capture would freeze whatever was in the environment when the
// module first loaded and write every later run's rows to the wrong place".
//
// The run dir is CLEAROTRON_BAND_RUN_DIR, set by serverEnv for every local server. There is no parameter
// for it and this tool never guesses one.
import { serve } from "./stdio-server.mjs";
import { recordUnitNote } from "../../register-unit-record.mjs";

async function record_unit_note(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) return { isError: true, text: "ERROR: this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one." };
  // THE BOUND AXIS. Absent means unbound, and unbound is refused rather than defaulted: a fan-out tool
  // that accepts whatever index it is handed is the 224/0 habit this binding replaced with a structure.
  const bound = String(process.env.CLEAROTRON_RECORD_AXIS ?? "").trim();
  if (!bound) return { isError: true, text: "ERROR: this server was started without a bound axis — the driver binds the axis it fanned out for. A note filed under an axis nobody bound would land in another unit's file." };
  const named = String(params?.axis ?? "").trim();
  if (named && named !== bound)
    return { isError: true, text: `ERROR: unit_axis_not_yours:${named} — you are the seat for axis "${bound}" and hold no other unit's material. Send "${bound}" or omit the field; the driver binds it either way.` };
  // NEVER THROWN PAST THIS POINT. An exception surfaces to the seat as a tool error naming nothing it
  // can act on, which is the failure mode this transport exists to end.
  try {
    const r = recordUnitNote(runDir, { ...(params ?? {}), axis: bound });
    if (r.refused) return { isError: true, text: `REFUSED: ${r.refused}` };
    if (r.write_failed) return { isError: true, text: `ERROR: the driver could not store this note (${r.write_failed}). This is a driver fault, not a fault in your observation — do not re-type it.` };
    // THE COUNTS ARE REPORTED BACK, because they are the note's substance and the seat never saw them:
    // they are derived from the band the tools wrote. A seat that reads them back can tell at once that
    // the note it just filed describes the sweep it just ran.
    return { isError: false, text: `Recorded the audit note for axis "${r.axis}": ${r.blocks} band block(s) — ${r.enumerated} enumerated, ${r.incomplete} incomplete${r.unknown ? `, ${r.unknown} in neither state` : ""}, ${r.records} record(s) carried forward. The driver wrote the note; you never open it.` };
  } catch (e) {
    return { isError: true, text: `ERROR: the driver could not record this call (${String(e?.message ?? e).slice(0, 200)}). This is a driver fault, not a fault in your observation — do not re-type it.` };
  }
}

serve({
  name: "unit-note", version: "0.1.0",
  tools: [{
    name: "record_unit_note",
    description:
      "File this axis's SHORT AUDIT NOTE as values. The driver writes register-units/<axis>.md — you never open " +
      "or edit it. The three counts the note states (queries enumerated, incomplete blocks, records carried " +
      "forward) are NOT yours to type: they are taken from the band the register tools wrote, so the note and the " +
      "band cannot disagree. What you send is the part the band cannot say — whether this axis produced a null " +
      "result, and one short observation an auditor would want. A note filed before the band exists is refused: " +
      "an account of a sweep that has not happened is not a short note, it is a wrong one.",
    inputSchema: { type: "object", properties: {
      null_result: { type: "boolean", description: "True only when this axis genuinely found nothing. Refused against a band that carries records — the band is what the lawyer reads, and a note calling it empty is the claim this lane cannot afford to get wrong." },
      note: { type: "string", description: "ONE short observation, a single paragraph, in a lawyer's words. What the counts cannot say — a transliteration that came back too generic to be useful, a register that answered slowly, a slice you stopped on a crowd. Not a restatement of the counts." },
      axis: { type: "string", description: "Optional, and checked rather than trusted: the driver binds the axis it dispatched you for. Send it to confirm, or omit it. Naming a different axis is refused — you hold no other unit's material." },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_unit_note,
  }],
});
