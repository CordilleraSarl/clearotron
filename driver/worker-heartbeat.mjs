// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// worker-heartbeat.mjs — IS ANYTHING DRAINING THIS INSTALL'S QUEUE? One home for the answer.
//
//. A queued job that is waiting its turn and a queued job that nothing will ever pick up look
// identical from the portal: both are `state: "queued"` with a position. That was tolerable while draining
// was always a deliberate act — if you had not started a runner you knew it. It stopped being tolerable
// when `bin/start.mjs` began supervising a worker NON-FATALLY: a worker that dies now leaves the portal
// serving, which is the right behaviour and also the state in which "waiting" is a lie.
//
// This is deliberately NOT `claim-liveness.mjs`. That answers "is the process holding THIS CLAIM alive",
// which a queued job cannot ask — it has no claim and no sidecar. This answers the install-level question.
// It reuses that module's `procStarttime` rather than growing a second answer to "is this pid real":
// pid plus the process's birth stamp, so a RECYCLED pid (pid_max wraps at 4194304) cannot read as alive.
//
//. That stamp was `/proc`-only, and this module's fail-safe direction turned the
// absence into a lie rather than a degradation: on macOS `workerAlive` answered FALSE for a beat this
// process had just written, so `drainingState` told every reader on a supervising install that nothing
// was draining their queue. `procStarttime` now has a `ps` implementation behind it; `beat` takes the
// reader as a seam so BOTH branches are driven on one box rather than one of them being a guess.
//
// Lives in the run-lock dir because that is already the one directory every process in an install shares
// — the same place `acquireRunSlot` coordinates the concurrency cap.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { procStarttime } from "./claim-liveness.mjs";

export const HEARTBEAT_FILE = "worker.heartbeat";

/** Where the beat lives. Explicit dir, or the install's run-lock dir. */
export const heartbeatPath = (dir) => join(dir, HEARTBEAT_FILE);

/**
 * Record that this process is draining, right now. Best-effort by design: a worker that cannot write its
 * heartbeat must keep draining rather than stop, because the queue emptying matters more than the portal's
 * label being precise. The cost of the failure is the honest direction — the portal says "no worker" while
 * one is in fact running, which reads as a problem rather than as a promise.
 */
export function beat(dir, { now = Date.now(), pid = process.pid, starttimeOf = procStarttime } = {}) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(heartbeatPath(dir), JSON.stringify({ pid, starttime: starttimeOf(pid), at: now }) + "\n");
    return true;
  } catch { return false; }
}

/**
 * Is a worker draining this install?
 *
 * FAIL-SAFE DIRECTION, and it is the opposite of `claimerIsAlive`'s. That one declares a claimer dead only
 * on POSITIVE evidence, because a wrongly-freed claim means two runners on one job. Here a wrong answer
 * costs a label, and the two errors are not symmetric: saying "a worker is running" when none is leaves a
 * user watching a queue that will never move — the exact defect exists to close — while saying "no
 * worker" when one is running is visible, self-correcting on the next beat, and prompts the right action.
 * So anything unreadable, unparseable, stale or pid-mismatched reads as NO WORKER.
 *
 * `staleMs` defaults to three watch ticks: a beat is written every tick, so one missed tick is scheduling
 * and three is a process that has stopped.
 */
export function workerAlive(dir, { now = Date.now(), staleMs = 3 * 90_000, starttimeOf = procStarttime } = {}) {
  let rec;
  try { rec = JSON.parse(readFileSync(heartbeatPath(dir), "utf8")); } catch { return false; }
  if (!rec || typeof rec.pid !== "number" || typeof rec.at !== "number") return false;
  if (now - rec.at > staleMs) return false;
  // A recycled pid is the case the birth stamp exists for: the number is live and belongs to something
  // else entirely. A null starttime (the process is gone, or /proc is unreadable) is not aliveness.
  const st = starttimeOf(rec.pid);
  if (st === null || st === undefined) return false;
  return rec.starttime === undefined || String(st) === String(rec.starttime);
}

/**
 * TRI-STATE, and the third state is the one that matters: `null` means NOBODY TOLD US.
 *
 *. This was an inline ternary at the call site, and its guard checked the consumer — so planting
 * `: false` here left the suite 28/0 while turning every queued row on every deployment into a false
 * alarm. A deployed instance drains through the systemd path/timer units, writes no heartbeat, and must
 * keep reading "waiting to start"; only an install that SUPERVISES a worker may say one is missing.
 *
 * Extracted so the producer has a contract a unit test can hold, rather than a shape a regex can match.
 *
 *   true   a worker beat recently
 *   false  we supervise one and it is not beating  → the only state that may relabel a row
 *   null   not a supervising install, or it named no lock dir
 */
export function drainingState(env = process.env, { alive = workerAlive } = {}) {
  if (env.PORTAL_LOCAL_WORKER !== "1") return null;
  const dir = env.CLEAROTRON_RUN_LOCK_DIR;
  if (!dir) return null;
  return alive(dir);
}
