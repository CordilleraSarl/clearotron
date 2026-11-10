// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-shell.mjs — what every run does around its own steps, the same for a clearance and a Knockout.
//
// Each product keeps its own ordered steps: a narrower level of clearance has its own evidence work, inputs and
// outputs. What runs them, and what a run does when they end, is shared: `runShell` runs a product's steps in order,
// a failure ends through run-failed.mjs, and a delivery through the ending below.
import { endAnswerMemory } from "../providers/_shared/answer-memory.mjs";
import { endTheFailedRun } from "./run-failed.mjs";
import { note } from "./log.mjs";
import { rollupStatus, writeRunStatus } from "./progress.mjs";
import { writeSettleStamp } from "./settle-stamp.mjs";

/**
 * Run a product's steps in order, and end the run as both products end one. `steps` is the product's own ordered
 * recipe, each `{ name, run }`. The first step that returns a result ends the run with it: the last step returns the
 * delivered run, and an earlier one may end the run sooner. A throw from any step ends through run-failed.mjs, with
 * the product's data (`ending`) and the helpers the failure path takes from it.
 */
export async function runShell({ P, agent, ctx, job, run }, { ending, helpers, steps }) {
  try {
    let result;
    for (const step of steps) {
      result = await step.run();
      if (result !== undefined) return result;
    }
    return result;
  } catch (e) {
    return await endTheFailedRun({ P, agent, ctx, e, job, run, product: ending }, helpers);
  }
}

/**
 * The delivered ending, the same for both products once a run's report is published and its packet is out: the run's
 * status, the pool copy's settle stamp, the held answers closed, the archive, the run list and `.delivered`, in that
 * order. Status goes before the archive so the moved status.json carries the delivered state, and the run list is
 * rebuilt after it, since it scans the archive too. A product hands in its own fields for each record, whole, and
 * `delivered` is given the archive's path. Returns that path, or null when the run could not be archived.
 */
export function endTheDeliveredRun({ ctx, run, published, archive, sentinel }, { status, settle, delivered }) {
  writeRunStatus(ctx, status);
  // — THE POOL COPY LEARNS ITS OWN TERMINAL STATE, HERE AND NOWHERE ELSE.
  // `meta.json` cannot carry this: it is composed inside publish, before this line runs, so the state
  // did not exist yet when it was written. This is the one moment where the terminal state and the
  // pool directory are both in hand. Best-effort by construction — the report is already published
  // and the run is already settled, so a failure to stamp is logged and the delivery proceeds.
  const stamp = writeSettleStamp(published.poolRunDir, settle);
  if (!stamp.written) note(`delivery: settle stamp not written (${stamp.reason})`);
  endAnswerMemory(run.runDir);   // the held answers do not travel into the archive
  const archived = archive(run);
  rollupStatus(run.studioRoot);
  sentinel(archived ?? run.runDir, ".delivered", delivered(archived));
  return archived;
}
