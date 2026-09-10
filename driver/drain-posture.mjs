// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// drain-posture.mjs — HOW THIS BOX DRAINS, decided ONCE for every arm whose verdict depends on it.
//
// ── WHY THIS IS A MODULE AND NOT A LINE IN EACH ARM ─────────────────────────────────────────────────
//
// Two arms of the same deploy check reached opposite conclusions about one box, measured on
// `c6e183d`. The queue arm read the worker unit, found it enabled, and said the .path/timer
// posture it was written for is retired here. The drainer arm did not read anything, applied the
// timer-era rule, and called an absent drainer a fault. Both sentences shipped in the same report.
//
// They were not disagreeing about the evidence — only one of them had looked. So the fix is not a
// second copy of the same `enabled === true` test in the second arm: it is one rule, in one place, that
// every arm consults and every message names. A duplicated predicate is a disagreement waiting for the
// day somebody edits one copy.
//
// ── WHY "COULD NOT LOOK" IS ITS OWN ANSWER ──────────────────────────────────────────────────────────
//
// The posture decides whether an absent drainer is normal, so an unknown posture must never resolve to
// either answer. On production these units belong to another account and are unreadable from anywhere
// else; a privilege-limited read that answered "continuous" would turn a real outage into a pass, and
// one that answered "scheduled" would turn every healthy box red. `unknown` says which read failed and
// leaves the caller to keep whatever it does when it cannot look — which for deploy health is a
// failure, never a pass.
//
// ── ENABLED, NOT PRESENT ────────────────────────────────────────────────────────────────────────────
//
// The inputs are `probeWorker`/`probeTimer`'s answers from queue-watch-probe.mjs, which read the
// `*.wants/` symlink `systemctl --user enable` writes rather than the unit file. An installed unit
// nobody enabled drains nothing, so `present` cannot license a posture claim.

/** The box drains continuously — a worker holds the queue open, so no drainer means nothing is draining. */
export const CONTINUOUS = "continuous";
/** The box drains on a schedule — no drainer BETWEEN ticks is the normal resting state. */
export const SCHEDULED = "scheduled";
/** Asked both, and neither will fire. Nothing drains this box at all, whatever is or is not running. */
export const NONE = "none";
/** One of the reads failed or was never made. Never resolve this to either answer. */
export const UNKNOWN = "unknown";

/** How a unit that will not fire is described — and `present: null` says so rather than guessing. */
const describeOff = (u) => u.present === false ? `${u.unit} does not exist`
  : u.present === true ? `${u.unit} exists but is not enabled`
  : `${u.unit} will not fire, and whether it is even installed could not be established`;

/**
 * PURE. Which drain posture this box is in, and how that was established.
 *
 * @param {object} o
 * @param {{unit: string, present: boolean|null, enabled: boolean|null, error: string|null}|null} [o.worker]
 *        probeWorker()'s answer. `enabled: false` must mean "asked, and it will not fire".
 * @param {{unit: string, present: boolean|null, enabled: boolean|null, error: string|null}|null} [o.timer]
 *        probeTimer()'s answer, read only when the worker is not draining.
 * @returns {{kind: "continuous"|"scheduled"|"none"|"unknown", how: string}}
 *          `how` is a clause a message can carry verbatim, so every arm names the posture it read.
 */
export function drainPosture({ worker = null, timer = null } = {}) {
  // THE WORKER FIRST, because after the 2026-08-26 retirement it is the only drain path a fresh box has,
  // and where it is enabled the timer's state cannot change the answer.
  if (worker?.enabled === true) {
    return { kind: CONTINUOUS, how: `${worker.unit} is enabled and drains continuously` };
  }

  if (worker?.enabled === false) {
    const notWorker = describeOff(worker);
    if (timer?.enabled === true) {
      return { kind: SCHEDULED, how: `${timer.unit} is enabled and drains on its schedule, and ${notWorker}` };
    }
    if (timer?.enabled === false) {
      return { kind: NONE, how: `${notWorker} and ${describeOff(timer)}, so nothing drains this box at all` };
    }
    // The worker answered and the timer did not. That is half a posture, and half a posture decides
    // nothing — a box with no worker might be draining on a timer nobody could read.
    const why = timer?.error ? `${timer.unit} could not be read: ${timer.error}` : "no timer state was supplied";
    return { kind: UNKNOWN, how: `${notWorker}, and whether a timer drains it instead was NOT probed (${why})` };
  }

  const why = worker?.error ? `${worker.unit} could not be read: ${worker.error}`
    : worker ? `${worker.unit} answered neither enabled nor not enabled`
    : "no worker state was supplied";
  return { kind: UNKNOWN, how: `it was NOT probed (${why})` };
}

/**
 * Is an absent drainer the NORMAL resting state here? Only a scheduled box says yes.
 *
 * Written as "normal", never as "a fault", so that `unknown` falls on the safe side of the one caller
 * that matters. A predicate spelled the other way would answer "not a fault" to a posture nobody could
 * read, which is the shape of every could-not-look this repository has had to go back and repair.
 */
export const absentDrainerIsNormal = (kind) => kind === SCHEDULED;
