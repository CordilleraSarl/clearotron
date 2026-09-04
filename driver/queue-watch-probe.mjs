// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — IS THE QUEUE THIS JOB JUST LANDED IN ACTUALLY WATCHED?
//
// -d2 put the resolved-queues-vs-watched-units comparison on the DEPLOY TICK. That is the right
// place for "is this box wired correctly", and it does not cover the path the incident actually took:
// the job was accepted and acknowledged to the requester at 07:24Z and sat in an unwatched queue WHILE
// the drain ran twice. It arrived BETWEEN ticks, into a location no tick-time check revisits at the
// moment of acceptance. A check that runs on deploy cannot see an enqueue that happens after it.
//
// So this is the same verdict asked at the other end: at the moment of acceptance, about the ONE
// directory the job was just written into — which is not always a member of `config.queueDirs` at all,
// because `--queue-dir` and an explicit agent both reach directories the deployment's own resolution
// never names.
//
// WHY THIS IS A WARNING AND NOT A REFUSAL. The units are a systemd-user deployment detail. A dev box,
// a contributor checkout and CI have no `.path` unit at all, and every one of them enqueues constantly
// — refusing there would break the normal case to guard the rare one. The absence of a unit is
// therefore SILENT (skip), and only a unit that EXISTS and does not cover the directory is loud. That
// is the same rule -d2 settled on, in the same words: a not-yet-existing queue is normal, an
// unreadable unit is SKIP and never a pass.
//
// THE VERDICT IS NOT REIMPLEMENTED HERE. `queueWatchVerdict` already decides, and `watchedQueueDirs`
// already parses the unit; this module is the seam that lets a DOOR ask them, so the deploy tick and
// the enqueue door cannot come to different conclusions about the same box. Reimplementing the
// comparison at the second call site is the defect was filed about, one level up.

import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { queueWatchVerdict } from "./queue-watch-verdict.mjs";
import { watchedQueueDirs } from "../scripts/drain-preflight.mjs";

/** The queue watcher's unit, named in ONE place so the tick check and the doors consult the same file. */
export const pathUnitFor = (home = homedir()) => join(home, ".config", "systemd", "user", "prelim-driver.path");

/**
 * — the unit's DROP-IN directory, which is the other half of its configuration.
 *
 * A systemd unit's effective configuration is the fragment PLUS `<unit>.d/*.conf`, applied after it in
 * lexical filename order. This module read the fragment and nothing else, so it answered a question
 * about a FILE while claiming to answer one about a DEPLOYMENT.
 *
 * Scoped to the fragment's own directory — the home-scoped `~/.config/systemd/user/` tree — deliberately
 * and consistently with the rest of this repo: unit-inventory.test.mjs pins that same scoping, because
 * a user unit shipped under `/usr/lib/systemd/user/` is not this deployment's to reason about. A
 * system-level drop-in would not be seen here; that is a stated limit, not an oversight.
 */
export const pathDropInDirFor = (home = homedir()) => `${pathUnitFor(home)}.d`;

/**
 * — THE OTHER DRAIN PATH, which this module could always see and never asked about.
 *
 * A `.path` unit is an ARRIVAL trigger. The timer is the schedule, and `prelim-driver.path`'s own
 * comment calls the watcher "an optimisation over the timer, never the sole drain path". Reading only
 * the `.path` unit and then reporting a consequence about DRAINING is answering a question with half
 * the evidence — and the half that was missing is the one that decides whether an operator is looking
 * at latency or at loss.
 *
 * ENABLED IS A SYMLINK, NOT A FILE. `systemctl --user enable` records the decision by linking the unit
 * into `timers.target.wants/`, so the answer is on disk and this stays injectable and testable on a box
 * with no systemd — the same reason the fragment is read rather than queried. A system-level unit under
 * `/usr/lib/systemd/user/` would not be seen here; that is this module's standing scope limit, stated
 * for the fragment already and true for the timer in the same way.
 */
export const timerUnitFor = (home = homedir()) => join(home, ".config", "systemd", "user", "prelim-driver.timer");
export const timerWantsLinkFor = (home = homedir()) =>
  join(home, ".config", "systemd", "user", "timers.target.wants", "prelim-driver.timer");

/**
 * ENOENT IS AN ANSWER; ANYTHING ELSE IS A FAILURE TO LOOK.
 *
 * `existsSync` collapses those two — it returns false for a directory it was refused permission to
 * stat, which would let "could not look" arrive at the verdict wearing the costume of "asked, and it
 * will not fire". That is the branch that licenses the strongest sentence this arm can print, so it is
 * the one branch that must never be reachable by accident.
 */
const statExists = (p) => {
  try { lstatSync(p); return true; }
  catch (e) { if (String(e?.code) === "ENOENT") return false; throw e; }
};

/**
 * THE THIRD DRAIN PATH, and after the retirement it is the only one a fresh box has.
 *
 * The arrival trigger and the timer were two halves of one posture, and the owner retired it: the worker
 * drains continuously under `--watch`, so there is no arrival to trigger and no schedule to wait for.
 * This module could not see that posture at all, which is why a box in it produced a permanent
 * "the .path unit could not be read" — honest, correct, and indistinguishable from an open finding
 * forever ('s third criterion, in the consumer that actually printed the line).
 *
 * ENABLED, NOT MERELY PRESENT, for the same reason the timer is read that way: an installed unit nobody
 * enabled drains nothing, and answering "present" would license the strongest sentence this module has
 * on the strength of a file sitting on disk.
 */
export const workerUnitFor = (home = homedir()) => join(home, ".config", "systemd", "user", "clearotron-worker.service");
export const workerWantsLinkFor = (home = homedir()) =>
  join(home, ".config", "systemd", "user", "default.target.wants", "clearotron-worker.service");

export function probeWorker({ home = homedir(), exists = statExists } = {}) {
  const unit = workerUnitFor(home);
  try {
    const present = exists(unit);
    return { unit, present, enabled: present ? exists(workerWantsLinkFor(home)) : false, error: null };
  } catch (e) {
    return { unit, present: null, enabled: null, error: String(e?.code ?? e?.message ?? e) };
  }
}

export function probeTimer({ home = homedir(), exists = statExists } = {}) {
  const unit = timerUnitFor(home);
  try {
    const present = exists(unit);
    return { unit, present, enabled: present ? exists(timerWantsLinkFor(home)) : false, error: null };
  } catch (e) {
    return { unit, present: null, enabled: null, error: String(e?.code ?? e?.message ?? e) };
  }
}

/**
 * The fragment and its drop-ins, concatenated in the order systemd applies them.
 *
 * ORDER IS THE WHOLE MECHANISM, so it is one join and not a merge: fragment first, then each `.conf`
 * in lexical order, and `watchedQueueDirs` folds the result left to right honouring `PathExistsGlob=`
 * as a reset. Composing the TEXT rather than merging parsed lists is what keeps the reset meaning what
 * systemd means by it — a merge would have to re-invent the ordering rule, and would get to be wrong
 * about it independently.
 *
 * A MISSING DROP-IN DIRECTORY IS NORMAL (most boxes have none) and is not an error. An UNREADABLE one,
 * or an unreadable member, throws — and the caller turns that into `skip`, never a pass, which is this
 * module's standing rule for a unit it could not fully read.
 */
function effectiveUnitText({ unitPath, dropInDir, read, list }) {
  const parts = [read(unitPath)];
  let names = [];
  try {
    names = list(dropInDir).filter((n) => n.endsWith(".conf")).sort();
  } catch (e) {
    // ENOENT/ENOTDIR — there is no drop-in directory, which is the common and correct case. Anything
    // else (EACCES on a directory that IS there) is a unit we could not fully read, and it propagates.
    const code = String(e?.code ?? "");
    if (code !== "ENOENT" && code !== "ENOTDIR") throw e;
  }
  for (const n of names) parts.push(read(join(dropInDir, n)));
  return parts.join("\n");
}

/**
 * Ask, about specific directories, whether the queue watcher covers them.
 *
 * `readUnit` and `home` are injected so the two branches that matter — a unit that exists and does not
 * cover the directory, and a unit that cannot be read — are reachable in a test on a box that has no
 * systemd at all. That is the same reason `queueWatchVerdict` is pure: a live probe on a healthy box
 * produces exactly one of the four states, and it is the uninteresting one.
 *
 * @returns {{state: "pass"|"fail"|"skip", message: string, unitPath: string}}
 */
export function probeQueueWatch({ queueDirs, home = homedir(), readUnit = null, listDropIns = null, resolveError = null, timerExists = null, workerExists = null } = {}) {
  const unitPath = pathUnitFor(home);
  const dropInDir = pathDropInDirFor(home);
  const read = readUnit ?? ((p) => readFileSync(p, "utf8"));
  const list = listDropIns ?? ((d) => readdirSync(d));
  let unitText = null, unitError = null;
  try { unitText = effectiveUnitText({ unitPath, dropInDir, read, list }); }
  catch (e) { unitError = String(e?.code ?? e?.message ?? e); }
  const v = queueWatchVerdict({
    queueDirs, unitPath, unitError, resolveError,
    watched: unitText === null ? null : watchedQueueDirs(unitText, home),
    // — always supplied, so the verdict's "nobody probed the drain half" branch is reserved for a
    // caller that genuinely could not look, rather than being this caller's permanent state.
    timer: probeTimer({ home, ...(timerExists ? { exists: timerExists } : {}) }),
    // Always supplied, for the same reason the timer is: an unsupplied half is reserved for a caller
    // that genuinely could not look, never for this caller's permanent state.
    worker: probeWorker({ home, ...(workerExists ? { exists: workerExists } : {}) }),
  });
  return { ...v, unitPath };
}

/**
 * The sentence a door prints when the queue it just accepted into is watched by nothing.
 *
 * NAMES THE DIRECTORY AND THE UNIT, because the incident's cost was entirely in the diagnosis: the job
 * was well-formed, the requester had been told it was accepted, no unit failed and nothing logged. The
 * only way anybody could have found it was by comparing two paths, so the warning carries both.
 */
export const unwatchedQueueWarning = (dir, unitPath) =>
  `[queue-watch] WARNING: ${dir} is not watched by ${unitPath}. This job is accepted and on disk, and `
  + "nothing will wake the runner for it — it drains only when the 90s timer next fires, or not at all "
  + "if this deployment has no timer. Point the unit at this directory, or enqueue into a watched one.";
