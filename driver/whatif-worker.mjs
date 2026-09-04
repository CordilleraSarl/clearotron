// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// whatif-worker.mjs — drains the run-local what-if queues (whatif-queue.mjs) and runs the experiments.
//
// THIS IS THE ONLY THING THAT SPAWNS THE ENGINE FOR A CLIENT WHAT-IF, and that is the point. The remote
// MCP surfaces state as a configuration fact that they never shell (http-server.mjs's header), and the
// account door keeps that true by ENQUEUEING rather than executing — so the sandbox spawn happens here,
// in an OS service process, exactly as a clearance run's does. A client's request reaches the engine the
// same way every other paid instruction does: through a queue a worker drains.
//
// ── EXECUTION IS NOT REIMPLEMENTED HERE ──────────────────────────────────────────────────────────────
//
// `whatIfRun` in mcp-server/lib/whatif.mjs already re-validates the op from scratch — stage, axis,
// live-only, the slug guard that proves the reconstructed job rebuilds the same run — and it is
// deliberately written to treat the confirmation token as untrusted. Re-deriving any of that here would
// be a second opinion on what a valid what-if is, and the two would drift. So this file OWNS the queue
// and the recording, and borrows the execution.
//
// The import is LAZY and injectable for the same reason whatif.mjs's own import of pipeline.mjs is: it
// pulls the engine, exceljs and native addons, and nothing that merely scans for pending work should pay
// for that. `driver/recipe-service.mjs` reaches across to mcp-server/lib the same way and for the same
// reason (jose, only on the path that needs it).
//
// ── CONCURRENCY, and why it is its own small cap ─────────────────────────────────────────────────────
//
// The owner ruled SPEND controls out ("ignore the call spend"), and this is not one. A what-if takes
// minutes of engine time on the same box that runs paid clearances, and an account may queue as many as
// it likes — so with no bound at all, a client experimenting could occupy the machine while a lawyer's
// paid search waits. That is a CONCURRENCY decision, which the ruling did not touch.
//
// It is bounded HERE rather than by taking a clearance run-slot, deliberately: a what-if that consumed a
// slot from `slot-lock`'s pool would make a free experiment able to block an admitted paid run, which is
// the same starvation one layer up. Instead the drain runs at most WHATIF_MAX_CONCURRENT at a time and
// takes no run-slot at all, so a what-if can never delay a clearance's admission — only share the box
// with it. Raise it with CLEAROTRON_WHATIF_MAX_CONCURRENT if a deployment wants more.
//
// NOTHING HERE ENFORCES A DAILY ALLOWANCE, and that is the ruling, stated rather than left to be
// noticed: `start_run` is stamped `clientPrincipal:true` at the MCP chokepoint so `runCaps.dailyRuns`
// bites it, and a what-if job carries no such stamp. Every experiment records what it spent — the
// engine's own telemetry lands in the shadow dir — but no door refuses the next one.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pendingWhatIf, claimWhatIf, finishWhatIf, whatIfRefusal, WHATIF_REFUSED_MARKERS } from "./whatif-queue.mjs";
import { note } from "./log.mjs";

export const WHATIF_MAX_CONCURRENT = Math.max(1, Number(process.env.CLEAROTRON_WHATIF_MAX_CONCURRENT || 1));

// WHY A RUN MIGHT BE OFF LIMITS, asked through the SHARED composer in whatif-queue.mjs rather than a
// list of markers kept here. This file used to carry its own list, and it included `.failed` where the
// MCP door's copy did not — so a failed run was planned, enqueued and then refused here. See the
// declaration for what that cost and why `failed` is now eligible.
const refusalFor = (runDir) =>
  whatIfRefusal({ markers: WHATIF_REFUSED_MARKERS.filter((m) => existsSync(join(runDir, m))) });

/**
 * Every live run dir under the given studio roots. Deliberately NOT the archive: an archived run is
 * read-only and `whatIfRun` refuses it, so scanning it would only mint refusals.
 *
 * Takes the roots as an ARGUMENT rather than reading config, because runner.mjs already computes them
 * (agentStudioRoots) and importing it here would close an import cycle — the runner is what calls this.
 */
export function liveRunDirs(studioRoots) {
  const out = [];
  for (const studio of studioRoots) {
    let slugs = [];
    try { slugs = readdirSync(studio); } catch { continue; }
    for (const slug of slugs) {
      if (slug === "queue" || slug === "archive") continue;
      let runs = [];
      try { runs = readdirSync(join(studio, slug)); } catch { continue; }
      for (const runName of runs) out.push(join(studio, slug, runName));
    }
  }
  return out;
}

/** Every claimable what-if across those run dirs, oldest run dir first. */
export function scanPendingWhatIf(studioRoots, { now = Date.now() } = {}) {
  const out = [];
  for (const runDir of liveRunDirs(studioRoots)) {
    const pending = pendingWhatIf(runDir, { now });
    if (pending.length) out.push(...pending.map((p) => ({ ...p, refusal: refusalFor(runDir) })));
  }
  return out;
}

/**
 * Claim and execute what is pending. `runWhatIf` is injectable so a test drives the whole queue → claim →
 * record chain without spawning the engine, exactly as whatif.test.mjs injects into whatIfRun itself.
 * Returns one row per job it settled — never throws: one bad experiment must not stop the drain.
 */
export async function drainWhatIfQueues(studioRoots, {
  runWhatIf = null, max = WHATIF_MAX_CONCURRENT, now = Date.now(),
} = {}) {
  const pending = scanPendingWhatIf(studioRoots, { now });
  if (!pending.length) return [];
  const exec = runWhatIf ?? (await import("../mcp-server/lib/whatif.mjs")).whatIfRun;
  const settled = [];
  for (let i = 0; i < pending.length; i += max) {
    const batch = pending.slice(i, i + max);
    settled.push(...await Promise.all(batch.map((entry) => settleOne(entry, exec))));
  }
  return settled.filter(Boolean);
}

async function settleOne(entry, exec) {
  const job = claimWhatIf(entry);
  if (!job) return null;                       // another worker won it, or the manifest was recorded bad
  const { runDir, id } = entry;
  if (entry.refusal) {
    // A run that reached a terminal state after the job was queued. Recorded as a refusal in the words
    // whatIfPlan uses, rather than left pending: a job nothing will ever run is not "still queued".
    note(`[whatif] ${id} refused — ${entry.refusal}`);
    return finishWhatIf(runDir, id, { ok: false, op: job.op, error: entry.refusal });
  }
  try {
    // THE TOKEN IS RE-MINTED FROM THE STORED OP, not carried as a string. whatIfRun's contract is that it
    // takes a confirmationToken and fully re-validates its payload — so encoding the op we stored puts the
    // job through exactly the validation an ops caller's token goes through, with no second code path.
    const confirmationToken = Buffer.from(JSON.stringify(job.op)).toString("base64url");
    const result = await exec({ confirmationToken });
    note(`[whatif] ${id} ${result?.ok === false ? "failed" : "done"} (${job.op.stage}${job.op.axis ? `:${job.op.axis}` : ""})`);
    return finishWhatIf(runDir, id, { ok: result?.ok !== false, op: job.op, result, error: result?.ok === false ? (result.fail ?? "the experiment did not complete") : null });
  } catch (e) {
    note(`[whatif] ${id} threw: ${e?.message ?? e}`);
    return finishWhatIf(runDir, id, { ok: false, op: job.op, error: String(e?.message ?? e) });
  }
}
