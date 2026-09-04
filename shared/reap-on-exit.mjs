// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reap-on-exit.mjs — a detached child's process group dies with the script that started it.
//
//. A script that spawns a server with `detached: true` gets a killable GROUP —
// `kill(-pid)` reaches the child's own children, which is why these call sites detach at all. What they
// then did was kill that group only on the paths somebody wrote a branch for: success, and a timeout.
//
// MEASURED ON THE DEV BOX, 2026-09-01. Three processes from a `verify-publishable` run that morning,
// PPID 1, eighty-eight minutes old, holding `127.0.0.1:18802` and running product code out of an
// install tree that had already been deleted. A watching runner among them, so not merely idle.
//
// WHY IT MATTERS MORE THAN A STRAY PROCESS: the ports are fixed defaults, so the NEXT run fails with
// EADDRINUSE — which reads exactly like two jobs colliding or an operator with a portal open. It is
// neither. The issue's author reached the wrong cause from that evidence and wrote it into a code
// comment before checking parentage and age. On a self-hosted runner one cancelled job poisons every
// later job that binds those ports, and nothing anywhere says an orphan is holding them.
//
// ── WHAT THE PLANNED PATHS CANNOT COVER, WHICH IS THE WHOLE POINT ─────────────────────────────────
//
// A `finish()` helper reaps on the branches it is called from. It is not called when the SCRIPT dies:
// a cancelled CI job (SIGTERM), a Ctrl-C (SIGINT), a closed terminal (SIGHUP), or a throw somewhere
// else in the file. Those are precisely the exits nobody writes a branch for, and the measured orphan
// came from one of them.
//
//   `exit`     covers a normal return, an explicit process.exit, AND an uncaught exception — Node runs
//              exit handlers after an uncaught throw. Sync work only, which process.kill is.
//   the signals must be handled EXPLICITLY: with no listener they terminate the process WITHOUT
//              running exit handlers, so the reaper would never fire on the very case it exists for.
//              Handling one suppresses that default, so each handler re-exits with the conventional
//              128+signo rather than swallowing the stop.
//
// SIGKILL ON THE SCRIPT ITSELF IS NOT COVERED AND CANNOT BE. Nothing in-process survives it. Stated
// rather than left for a reader to discover: this closes every exit a script can observe, not every
// exit that exists, and a `kill -9` of the parent still strands the group.
//
// IDEMPOTENT, and unregistering is the caller's normal path: a child that exits on its own drops out,
// so the reaper never signals a pid that has been recycled onto somebody else's process.

const groups = new Set();
let installed = false;

function reapAll() {
  for (const pid of groups) {
    // The GROUP first — that is what detaching bought, and it is what reaches the child's children.
    // Falling back to the bare pid keeps a non-detached caller honest rather than silently reaping
    // nothing; both are best-effort, because a reaper that throws on the way out of a crashing script
    // replaces one problem with a worse one.
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  }
  groups.clear();
}

function install() {
  if (installed) return;
  installed = true;
  process.on("exit", reapAll);
  // 128 + signo is the shell's convention for "died by this signal", and preserving it matters: CI
  // reads the exit code to tell a cancellation from a failure, and a reaper that exits 0 on SIGTERM
  // would turn every cancelled job green.
  for (const [sig, no] of [["SIGINT", 2], ["SIGTERM", 15], ["SIGHUP", 1]]) {
    process.on(sig, () => { reapAll(); process.exit(128 + no); });
  }
}

/**
 * Reap `child`'s process group when THIS process exits, by any route it can observe.
 *
 * @returns {() => void} stop watching — called automatically when the child exits on its own.
 */
export function reapOnExit(child) {
  if (!child || typeof child.pid !== "number") return () => {};
  groups.add(child.pid);
  install();
  const stop = () => groups.delete(child.pid);
  try { child.once("exit", stop); } catch { /* a caller that handed us something odd still gets a stop */ }
  return stop;
}

/** The pids currently watched. For arms — a reaper nobody can inspect is a reaper nobody can test. */
export function watchedGroups() {
  return [...groups];
}
