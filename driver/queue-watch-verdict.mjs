// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — DOES ANYTHING WATCH THE QUEUES THIS DEPLOYMENT WOULD DRAIN?
//
// A client clearance was enqueued, acknowledged to the requester, and landed as a well-formed .json in
// a queue directory no `.path` unit watches. It sat there while the drain ran twice. Nothing errored
// and nothing logged — no unit failed, because the unit that would have picked it up was watching a
// different directory. That is the shape this answers.
//
// THE COMPARISON ITSELF ALREADY EXISTED. `compareWatches` in scripts/drain-preflight.mjs is pure and
// tested, and it is referenced by no systemd unit, no deploy script, and nothing in this repo but an
// npm script and its own tests. A manual diagnostic somebody has to remember is not a guard —
// enforcement was living NOWHERE. This module is not new logic; it is the verdict shape that lets the
// check the deploy already runs carry it.
//
// PURE, and separated from both the filesystem and the unit read for the usual reason: the two branches
// that matter most are the ones a live probe on a healthy box will never produce.
//
// ──: THE FINDING WAS RIGHT AND THE CONSEQUENCE WAS INVENTED ────────────────────────────────────
//
// This arm used to answer an unwatched queue with one sentence — "a job enqueued there is acknowledged
// and never drained" — and that sentence asserts a black hole this module had no evidence for. A `.path`
// unit is an ARRIVAL trigger. It is not the only drain path, and `prelim-driver.path`'s own comment says
// so in as many words: "the watcher is an optimisation over the timer, never the sole drain path."
// Measured on the test box on 2026-08-19, jobs in one of the two directories the arm named were draining
// the whole time — claimed by a drainer, run to completion, off the SKIP list an hour later.
//
// What it cost is the reason this is a defect and not a wording preference. The sentence was read
// exactly as written: a lane diagnosing why test sat 14 commits behind `origin/main` read it plus an
// hourly "SKIP — N job(s) queued" as a deadlock, and went hunting a fault that was not there. The box
// was behaving correctly; a clearance had been in flight since 14:07 and the deploy was refusing exactly
// as designed.
//
// So the missing input was never a subtler comparison. It was the TIMER. Without knowing whether a timer
// would drain the directory later, this module can support "nothing drains this on ARRIVAL" and nothing
// stronger. With it there are three genuinely different findings, and an operator acts differently on
// each:
//
//   · timer enabled          → LATENCY. The job waits for the next tick instead of waking the runner.
//   · timer absent/disabled  → LOSS. Now "never drained" is evidenced, and it is the strong claim.
//   · timer unreadable       → the arrival half is a finding; the drain half is UNPROBED and says so.
//
// THE HONEST SENTENCE ALREADY EXISTED ONE MODULE AWAY. `unwatchedQueueWarning` in queue-watch-probe.mjs
// has told a door's caller the truth since — "it drains only when the 90s timer next fires, or not
// at all if this deployment has no timer". The deploy tick and the enqueue door read one unit file
// precisely so they cannot come to different conclusions about the same box; they were still reaching
// two different conclusions about the same *consequence*. This closes that.

/**
 * @param {object}   a
 * @param {string[]|null} a.queueDirs   what this deployment would ACTUALLY drain, resolved — not the
 *                                      variable. An absent variable and an empty one fall through to
 *                                      the same default, so reading the resolution covers both, and
 *                                      covers the shapes nobody has thought of yet.
 * @param {string[]|null} a.watched     directories the `.path` unit globs
 * @param {string}   a.unitPath         named in every message, so a reader knows what was consulted
 * @param {string|null} a.unitError     why the unit could not be read, if it could not
 * @param {string|null} a.resolveError  why the queue dirs could not be resolved, if they could not
 * @param {{unit: string, present: boolean|null, enabled: boolean|null, error: string|null}|null} a.timer
 *        the OTHER drain path. Omitted entirely ⇒ unknown, and the verdict says the drain half was not
 *        probed rather than assuming either answer. `enabled: false` must mean "asked, and it will not
 *        fire" — never "did not look", which is what makes the strong claim safe to make.
 * @returns {{state: "pass"|"fail"|"warn"|"skip", message: string}}
 */
export function queueWatchVerdict({ queueDirs, watched, unitPath, unitError = null, resolveError = null, timer = null, worker = null } = {}) {
  // ── THE POSTURE QUESTION COMES FIRST, because after the retirement it decides whether the rest of
  // this function is even asking about anything (; owner ruling 2026-08-26, restated
  // 2026-08-31). The arrival trigger and the timer were two halves of ONE posture. The worker drains
  // continuously under --watch, so on a box in that posture there is no arrival to trigger and no
  // schedule to wait for, and every finding below would be describing the absence of machinery this
  // deployment deliberately does not use.
  //
  // ONLY ENOENT, and this is the whole care in the branch. `unitError` collapses "the unit is not
  // there" with "I was refused permission to look", and only the first is evidence of the posture. A
  // permission error still skips — a privilege-limited read that answers "fine" is the exact failure
  // this family of checks exists to refuse, and letting a worker unit talk it into a pass would put
  // that failure back one door along.
  const workerDrains = worker?.enabled === true;
  if (workerDrains && unitError && /ENOENT/.test(String(unitError))) {
    return { state: "pass",
      message: `no arrival trigger, and none is expected: ${worker.unit} is enabled and drains continuously, `
        + `so the .path/timer posture this arm was written for is retired on this box (${unitPath} is absent)` };
  }
  // NOT A PASS, EITHER WAY. On prod these units belong to another account and are unreadable from
  // anywhere else; a privilege-limited read that answers "fine" is the exact failure this family of
  // checks exists to refuse, and it is the one that would make this guard decoration on the box that
  // matters most.
  if (unitError) return { state: "skip", message: `the .path unit could not be read — ${unitPath}: ${unitError}` };
  if (resolveError) return { state: "skip", message: `the queue dirs could not be resolved — ${resolveError}` };

  const q = Array.isArray(queueDirs) ? queueDirs : null;
  const w = Array.isArray(watched) ? watched : [];
  if (!q) return { state: "skip", message: "no queue dirs were supplied to compare" };
  // An empty resolution compares nothing and would otherwise pass with flying colours — the shape of a
  // guard that has stopped existing.
  if (!q.length) {
    return { state: "fail",
      message: `this deployment resolves NO queue directory at all, so nothing enqueued to it can ever be drained (${unitPath} watches ${w.length})` };
  }

  const norm = (p) => String(p ?? "").replace(/\/+$/, "");
  const watchedSet = new Set(w.map(norm));
  const unwatched = q.map(norm).filter((d) => !watchedSet.has(d));
  const where = `${q.length} queue dir(s) resolved; ${unitPath} watches ${w.length}`;

  if (unwatched.length) {
    const dirs = unwatched.join(", ");
    const head = `${unwatched.length} queue dir(s) NO .path unit watches, so nothing drains them ON ARRIVAL: ${dirs}`;

    // ASKED, AND IT WILL FIRE. The gap is real and worth reporting — an arrival trigger is missing —
    // but the job is not lost, and calling this `fail` is what sent a reader hunting a deadlock. `warn`
    // is a real outcome on this surface (live-surface-check records it), and the exit code is driven by
    // `fail` alone, so this stops reddening an hourly deploy for a latency characteristic.
    // NOT EVEN LATENCY. A continuous drain does not wait for a tick, so the arrival gap costs nothing
    // here — reporting it as latency would be true of the timer posture and false of this one.
    if (workerDrains) {
      return { state: "pass",
        message: `${head} — and none is needed: ${worker.unit} is enabled and drains continuously, so this `
          + `is neither loss nor latency · ${where}` };
    }
    if (timer?.enabled === true) {
      return { state: "warn",
        message: `${head} — they drain on ${timer.unit}'s schedule instead, which is ENABLED, so this is LATENCY and not loss · ${where}` };
    }
    // ASKED, AND IT WILL NOT FIRE. Only here is the black hole evidenced, and here it is worth saying
    // in the strongest words available.
    if (timer?.enabled === false) {
      const why = timer.present === false ? `${timer.unit} does not exist` : `${timer.unit} exists but is not enabled`;
      return { state: "fail",
        message: `${head} — and ${why}, so a job enqueued there is acknowledged and never drained · ${where}` };
    }
    // DID NOT ASK, OR COULD NOT. An unprobed half is not a passed half, and it is not a failed half
    // either — it is named as the thing nobody looked at.
    const why = timer?.error ? `${timer.unit} could not be read: ${timer.error}` : "no timer state was supplied";
    return { state: "fail",
      message: `${head}. Whether a timer drains them later was NOT PROBED (${why}) — that half is unprobed, not passed · ${where}` };
  }
  return { state: "pass", message: where };
}
