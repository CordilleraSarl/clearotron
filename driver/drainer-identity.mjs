// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// drainer-identity.mjs — WHICH BUILD THE PROCESS THAT EXECUTES RUNS IS ACTUALLY HOLDING.

//
// Deploy health asserted the commit of three unit-managed services and none of them executes a
// clearance. The process that does — the queue drainer — imports `pipeline` and calls it IN-PROCESS,
// so it holds whatever module graph it booted with until it is restarted. Measured on the test box
// 2026-08-27: the drainer booted off `c5d8db9`, two deploys landed (`9950b83`, then `be085e3`), the
// portal and the two MCP faces were restarted, and the drainer was not. Every clearance for the rest
// of that day ran twenty-two commits back while every check on the box read green.
//
// IT WAS INVISIBLE BY CONSTRUCTION, NOT BY OVERSIGHT. `live-surface-check`'s straddle arm enumerates
// `systemctl --user list-units` and compares what it finds; the drainer was not a unit at all — an
// orphan of an earlier `clearotron start` sitting in a `closing` SSH session with PPID 1. An arm that
// derives its population from the unit list can never see a process that is not in it, so a stronger
// unit comparison would not have helped. The population has to be the PROCESS TABLE.
//
// ── WHY A STAMP AND NOT AN INTERROGATION ────────────────────────────────────────────────────────────
//
// A running process cannot be asked which commit its loaded modules came from — there is no supported
// way in from outside, and the checkout on disk answers a different question (it is the code the NEXT
// process will load, which is exactly the assumption that failed). So the drainer says so itself, at
// boot, in a file beside the queue it drains. A stamp can be stale or absent; both are handled below,
// and neither is ever a pass.
//
// ── WHY THIS IS NOT UNIT-SHAPED ─────────────────────────────────────────────────────────────────────
//
// The owner retired the path-watcher/timer posture on 2026-08-26 (the units leave the inventory; a
// hosted deployment gets one plain service unit running `clearotron start`), so 1977's own mitigation —
// enabling `prelim-driver.timer` — stands on a posture that no longer exists. Nothing here reads a unit,
// a cgroup or a supervisor. It reads a stamp and the process table, which are true under either answer.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";

export const STAMP_BASENAME = "_drainer-identity.json";

/** Where a deployment's drainer stamps itself: beside the workspace whose queues it drains. */
export function drainerStampPath(workspaceRoot) { return join(workspaceRoot, STAMP_BASENAME); }

/**
 * Record who is draining and which build they hold. Called at the drainer's entry, before any work.
 *
 * BEST-EFFORT BY CONSTRUCTION. A drainer that cannot write its stamp still drains — refusing to run
 * because health cannot be observed would trade a reporting gap for a product outage, which is the
 * wrong trade. The absence is a finding at the READING end, where it costs nobody a report.
 */
export function writeDrainerStamp(workspaceRoot, stamp, { write = null } = {}) {
  const path = drainerStampPath(workspaceRoot);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const body = JSON.stringify({ schema: 1, ...stamp }, null, 2) + "\n";
    if (write) { write(path, body); return path; }
    // Atomic: a health check reading a half-written stamp must never see a torn commit sha.
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, path);
    return path;
  } catch { return null; }
}

/** The stamp, or null when there is none to read. A parse failure is a null — the verdict says so. */
export function readDrainerStamp(workspaceRoot, { read = null } = {}) {
  const rd = read ?? ((p) => readFileSync(p, "utf8"));
  try { return JSON.parse(rd(drainerStampPath(workspaceRoot))); } catch { return null; }
}

/** Does this command line belong to a queue drainer? The two shapes a deployment can be running. */
export const DRAINER_CMD = /\b(runner\.mjs|clearotron[^\s]*\s+start)\b/;

/**
 * PURE. What deploy health should say about the process that executes runs.
 *
 * @param {object}   o
 * @param {object|null} o.stamp        readDrainerStamp()'s answer
 * @param {string|null} o.headCommit   the commit the CHECKOUT is on right now
 * @param {(rec: {pid: number, starttime: string|null}) => boolean} o.isAlive
 * @param {Array<{pid: number, cmd: string}>|null} o.processes  processTable(), or null if unreadable
 * @param {(pid: number) => number|null} [o.ppidOf]  the LIVE parent pid, or null when it cannot be read
 * @returns {{state: "pass"|"fail"|"warn", message: string}}
 */
export function drainerVerdict({ stamp, headCommit, isAlive, processes, ppidOf = null }) {
  // Every drainer-looking process on the box, named. This is the half a unit-derived population cannot
  // have: the incident's drainer was in no unit, and an orphan that never stamped anything shows up
  // here or nowhere. `null` means the table could not be read, which is its own could-not-look.
  const seen = processes === null ? null : processes.filter((p) => DRAINER_CMD.test(p.cmd ?? ""));
  const nameThem = (ps) => ps.map((p) => `pid ${p.pid}`).join(", ");

  if (!stamp) {
    // COULD NOT LOOK, AND THAT IS A FAILURE. The deploy must not report a build live having never
    // established what the executing process holds — "no stamp" is the exact state the incident's
    // orphaned drainer was in, so treating it as a skip would pass the very box this arm exists for.
    const extra = seen === null ? "and the process table could not be read either"
      : seen.length ? `while ${seen.length} drainer-shaped process(es) ARE running (${nameThem(seen)}) — unstamped, so what build they hold is unknown`
      : "and no drainer-shaped process is running, so nothing is executing runs on this box";
    return { state: "fail", message: `no drainer identity stamp at ${STAMP_BASENAME}: the build held by the process that `
      + `executes runs was NOT established, ${extra}. This is a failure to look, never a pass.` };
  }

  const pid = Number(stamp.pid) || 0;
  if (!pid || !stamp.engineCommit) {
    return { state: "fail", message: `the drainer stamp is present but incomplete (pid=${JSON.stringify(stamp.pid)}, `
      + `engineCommit=${JSON.stringify(stamp.engineCommit)}) — it cannot say who is draining or on what build.` };
  }

  const alive = isAlive({ pid, starttime: stamp.pidStarttime ?? null });
  const held = String(stamp.engineCommit);
  const head = headCommit ? String(headCommit) : null;
  const short = (c) => (c ? c.slice(0, 8) : "(unknown)");
  const via = stamp.engineCommitSource === "build-info"
    ? " (named from the archive's build-info.json, not a live checkout)" : "";
  // Any drainer-shaped process that is NOT the one that stamped: an orphan of an earlier start, or a
  // second drainer nobody meant to leave running. Named, because the incident's whole cost was that
  // nothing said it out loud.
  const strays = seen === null ? null : seen.filter((p) => Number(p.pid) !== pid);
  const strayNote = strays === null ? " The process table could not be read, so an unstamped second drainer would not be seen."
    : strays.length ? ` ALSO RUNNING AND UNACCOUNTED FOR: ${strays.length} drainer-shaped process(es) that did not write this stamp (${nameThem(strays)}) — each holds a build nothing here can name.`
    : "";

  if (!alive) {
    return { state: "fail", message: `the stamped drainer (pid ${pid}, on ${short(held)}${via}) IS GONE: nothing is `
      + `executing runs on this box, and the last thing that did held ${short(held)}.${strayNote}` };
  }

  if (head && held !== head) {
    // THE INCIDENT, stated with both commits as the issue's third criterion requires.
    return { state: "fail", message: `THE EXECUTING PROCESS IS NOT ON THE DEPLOYED COMMIT: drainer pid ${pid} loaded `
      + `${short(held)}${via} and the checkout is on ${short(head)}. It imports the pipeline in-process, so it will `
      + `keep running ${short(held)} for every clearance until it is restarted — a deploy that moved the checkout did `
      + `not move this. Restart the drainer.${strayNote}` };
  }

  if (!head) {
    return { state: "fail", message: `drainer pid ${pid} is alive on ${short(held)}${via}, but the checkout's own HEAD `
      + `could not be read, so the two could not be compared.${strayNote}` };
  }

  // ── IS ANYTHING SUPERVISING IT? (the issue's second criterion) ──────────────────────────────────
  //
  // The incident's drainer was an orphan of an earlier `clearotron start` whose supervisor had exited:
  // PPID 1, in a `closing` SSH session. Nothing restarts a process in that state, so the next deploy
  // moves the checkout and leaves it running old code forever — which is exactly what happened.
  //
  // READ LIVE, NOT FROM THE STAMP. A drainer's parent at BOOT is its supervisor; it becomes 1 only when
  // that supervisor exits, which is the event this is about. A boot-time PPID would have recorded the
  // healthy value and reported the orphan as supervised — the finding lost to the moment it was taken.
  // Unreadable is unreadable and says so; it is never read as "supervised".
  let supervision = "";
  if (ppidOf) {
    const ppid = ppidOf(pid);
    if (ppid === null) supervision = " Its parent process could not be read, so whether anything supervises it is unknown.";
    else if (ppid === 1) supervision = ` IT IS NOT UNDER A SUPERVISOR (PPID 1) — an orphan of a start whose parent has exited. `
      + `Nothing will restart it, so the next deploy will move the checkout and leave this process on its current build.`;
  }

  const base = `drainer pid ${pid} is alive and holds ${short(held)}${via}, the commit the checkout is on.`;
  // An unsupervised drainer is a state health must say out loud whatever the posture ruling — so it
  // downgrades the pass even when every commit agrees, because agreement today is not durability.
  return (strays?.length || supervision)
    ? { state: "warn", message: `${base}${supervision}${strayNote}` }
    : { state: "pass", message: base };
}

/** The live parent pid of `pid`, or null. POSIX `ps`, so this is not a /proc-only reader. */
export function defaultPpidOf(pid, { run = null } = {}) {
  try {
    const out = run
      ? run(pid)
      : execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 });
    const n = Number(String(out).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}
