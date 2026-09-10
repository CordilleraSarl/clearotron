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
import { spawnSync } from "node:child_process";
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

/**
 * The process group `pid` is in, or null when that cannot be read.
 *
 * Linux reads it from /proc; everywhere else asks `ps`, as `procStarttime` does for a start time, and an
 * injected reader outranks the platform for the reason `procStarttime` gives.
 */
export function procPgid(pid, readStat = undefined, { platform = process.platform, readPsPgid = defaultReadPsPgid } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  let v = NaN;
  try {
    if (readStat || platform === "linux") {
      const stat = (readStat ?? ((p) => readFileSync(`/proc/${p}/stat`, "utf8")))(pid);
      // After the last ')', because comm may hold spaces and parens: state is index 0, ppid 1, pgrp 2.
      v = Number(stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[2]);
    } else {
      v = Number(String(readPsPgid(pid)).trim());
    }
  } catch { return null; }
  return Number.isInteger(v) && v > 0 ? v : null;
}

function defaultReadPsPgid(pid) {
  const r = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : "";
}

/**
 * End the recorded turn, and report whether it ENDED from what was seen afterwards, never from the
 * signal having been sent.
 *
 * SIGNALLED IS NOT ENDED. `process.kill` returning means the OS accepted the signal for delivery, and a
 * process that handles or ignores SIGTERM leaves that line looking the same. On the owner's WSL install
 * of 0.3.0-beta.1 a stop that was reported as having ended the step ran on to the next step boundary. So
 * this watches the turn after the signal, sends SIGKILL to whatever is left when the grace runs out, and
 * answers `ended: true` only once it has seen nothing left.
 *
 * THE GROUP, WHEN THE TURN LEADS ONE. Both engines spawn the turn `detached: true`, so it leads its own
 * process group and the MCP servers it starts are members of it. Measured 2026-09-10 on the coding CLI
 * the engine spawns: a SIGTERM to the turn's pid alone ends the turn and its servers, but a SIGKILL to
 * the pid alone leaves a server running under pid 1, and a SIGKILL to the group does not. So the
 * escalation addresses the group, and "ended" means the group is empty as well as the turn gone.
 *
 * ONLY A GROUP THIS RECORD LEADS. The watchdogs signal `-child.pid` without asking, because they spawned
 * the child detached themselves. This reads a pid off disk. If that pid does not lead its own group,
 * `-pid` names no group of this run's, so the signals go to the pid alone. Nothing at or below pid 1 is
 * ever signalled: `-1` reaches every process this user may signal.
 */
export async function endEngineChild(rec, {
  graceMs = 5000, settleMs = 2000, pollMs = 50,
  kill = (target, sig) => process.kill(target, sig),
  isLive = (r) => engineChildIsLive(r),
  pgidOf = (pid) => procPgid(pid),
  sleep = (ms) => new Promise((res) => setTimeout(res, ms)),
  now = () => Date.now(),
} = {}) {
  if (!rec || !Number.isInteger(rec.pid) || rec.pid <= 1)
    return { signalled: null, escalated: null, group: false, ended: false, error: "no process to signal" };
  const group = pgidOf(rec.pid) === rec.pid;
  const target = group ? -rec.pid : rec.pid;
  const send = (sig) => { try { kill(target, sig); return null; } catch (e) { return e?.code ?? String(e?.message ?? e); } };
  // Signal 0 asks only whether the group still has a member. EPERM is a member this user may not
  // signal, and a member all the same.
  const groupHasMembers = () => {
    if (!group) return false;
    try { kill(-rec.pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
  };
  const gone = () => !isLive(rec) && !groupHasMembers();
  const seenGone = async (ms) => {
    const until = now() + ms;
    for (;;) {
      if (gone()) return true;
      if (now() >= until) return false;
      await sleep(pollMs);
    }
  };

  // ESRCH: it exited between the caller's liveness read and this signal, a race lost harmlessly. EPERM:
  // it is not ours to signal, which must not read as success. Either way nothing was sent.
  const refused = send("SIGTERM");
  if (refused) return { signalled: null, escalated: null, group, ended: false, error: refused };
  if (await seenGone(graceMs)) return { signalled: "SIGTERM", escalated: null, group, ended: true };

  // Still there when the grace ran out. SIGKILL cannot be handled or ignored.
  const killRefused = send("SIGKILL");
  if (killRefused && killRefused !== "ESRCH")
    return { signalled: "SIGTERM", escalated: null, group, ended: gone(), error: killRefused };
  return { signalled: "SIGTERM", escalated: killRefused ? null : "SIGKILL", group, ended: await seenGone(settleMs) };
}
