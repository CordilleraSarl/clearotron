// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// child-record.mjs — the engine child's pid, written down, so a stop can target THIS run's turn.
//
//. The owner pressed Stop on his own run and it did not stop: the cooperative stop
// closes admission and waits for the stage in flight, and that stage was 28 minutes into a turn with no
// bound on it. His ruling: "a stop is a stop — maybe it should be a 'stop immediately or at next
// boundary to preserve data' kind of question when you press it."
//
// The objection to a hard stop was that it leaves a half-written artifact. MEASURED on his own run,
// 2026-09-02: it does not. Cancel sentinel written, then SIGTERM to the engine child, and the run went
// terminal in THREE SECONDS with a clean record — state=cancelled, the stage named, the actor and the
// request time carried, `.postponed` cleared, the queue marker and its result present, and the token
// receipt preserved. Nothing that mattered was half-written and there was no state:running orphan.
//
// ── WHY THE CHILD AND NOT THE RUNNER ─────────────────────────────────────────────────────────────
//
// The measurement separates them: the engine child was 27:57 old, the runner 1:11:25. Killing the CHILD
// is what let the pipeline's own catch write that clean terminal — the runner survived to do the work.
// Killing the runner instead could not have produced that record, because the thing that writes it
// would have been the thing that died, and on a `--watch` drainer it would have ended every other run
// that process was draining too. "Stop this run" must mean this run.
//
// ── WHY THIS FILE HAS TO EXIST AT ALL ────────────────────────────────────────────────────────────
//
// Nothing recorded the engine child's pid. The adapters hold `child.pid` in memory for their own group
// kill and never write it down; everything persisted for a run — status.json's identity seed, the queue
// claim sidecar, the worker heartbeat — is the RUNNER's pid. So the ruling's phrase "the recorded
// engine pid" described a mechanism that did not exist; the e2e measurement satisfied the box rule by
// observing the pid and writing it down by hand before killing it. This is that recording, made
// permanent, so a stop is a file read rather than a hunt.
//
// ── AND WHY NOT argv MATCHING ────────────────────────────────────────────────────────────────────
//
// The child's argv already names its run and stage, so "find the claude process whose argv mentions
// this run dir" looks tempting and is the exact pattern match the box rule forbids. This box carries
// several deployments under different users, and a `claude` process here can belong to another agent's
// work entirely — a health check misread one that way the same morning, reporting a foreign checkout's
// drainer as an unnamed build. A recorded pid is safer than a name for one reason, and the reason is
// identity, which is why the record is `pid:starttime` and not a bare pid.
//
// ONE FORMAT, NOT TWO: `pid:starttime`, the same string `claimToken()` writes and `parseClaimSidecar`
// reads. A second spelling of "which process is this" is a second thing to keep in step.

import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { procStarttime, parseClaimSidecar } from "../claim-liveness.mjs";

export const ENGINE_CHILD_FILE = "engine-child.pid";

/** Where this run's engine-child record lives, or null when there is no run dir to write into. */
export function engineChildPath(runDir) {
  return runDir ? driverDir(runDir, ENGINE_CHILD_FILE) : null;
}

/**
 * Record the child that is about to do this run's turn. Best effort and NEVER fatal: a dispatch that
 * cannot write this file must still run, because the cost of failing here is a stop that falls back to
 * the boundary — the behaviour that shipped for a year — and the cost of throwing is a run that dies
 * for a bookkeeping error.
 */
export function recordEngineChild(runDir, pid, { write = writeFileSync, starttimeOf = procStarttime } = {}) {
  const p = engineChildPath(runDir);
  if (!p || !Number.isInteger(pid) || pid <= 0) return false;
  try { write(p, `${pid}:${starttimeOf(pid) ?? ""}\n`); return true; }
  catch { return false; }
}

/**
 * Clear the record when the turn ends — ONLY if it still names this pid.
 *
 * A child that exits slowly must not erase the record of the one that replaced it. Turns are sequential
 * per run today, so the race is narrow, but "narrow" is how the next reader inherits a stop that
 * targets a process that finished ten minutes ago.
 */
export function clearEngineChild(runDir, pid, { read = readFileSync, rm = rmSync } = {}) {
  const p = engineChildPath(runDir);
  if (!p) return false;
  try {
    const rec = parseClaimSidecar(read(p, "utf8"));
    if (rec && Number.isInteger(pid) && rec.pid !== pid) return false;   // not ours to clear
  } catch { /* unreadable or already gone — removing it is still correct */ }
  try { rm(p, { force: true }); return true; } catch { return false; }
}

/**
 * The recorded child, or null.
 *
 * NULL IS "NOTHING TO TARGET", AND IT IS NOT AN ERROR — a run between turns, a run that predates this
 * file, an unreadable sidecar. Every caller must treat it as "no immediate stop is possible here" and
 * fall back to the cooperative stop. What none of them may do is widen the search: an absent record is
 * the state in which a pattern match looks reasonable, and that is precisely when it is most dangerous.
 */
export function readEngineChild(runDir, { read = readFileSync } = {}) {
  const p = engineChildPath(runDir);
  if (!p) return null;
  try { return parseClaimSidecar(read(p, "utf8")); } catch { return null; }
}

/**
 * Is the recorded child still the process it claims to be?
 *
 * pid REUSE IS THE WHOLE REASON THE STARTTIME IS IN THE RECORD. A pid alone, on a box that has been up
 * for days, can name something else entirely by the time anyone reads it — and the thing a stop does
 * with the answer is send a signal. A record with no starttime (the process was gone before it could be
 * read) is treated as NOT verifiable, which fails toward doing nothing.
 */
export function engineChildIsLive(rec, { starttimeOf = procStarttime } = {}) {
  if (!rec || !Number.isInteger(rec.pid) || rec.pid <= 0) return false;
  if (!rec.starttime) return false;
  return starttimeOf(rec.pid) === rec.starttime;
}
