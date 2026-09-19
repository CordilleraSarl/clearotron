// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NOTICE WHEN THE PROCESS THAT STARTED US IS GONE.
//
// `npx clearotron demo` runs as npm → `sh -c clearotron demo …` → the launcher → the demo. A TERM to the
// pid a shell hands back for a backgrounded `npx …` reaches npm, npm passes it to that `sh`, and `sh` exits
// without passing it on. The launcher is reparented and the demo runs on, holding its three ports, with
// nothing saying so. Measured on npm 10.9.8, 2026-09-18. Neither npm nor that `sh` is ours to change, and
// a process is told nothing when its parent dies on Linux or macOS, so the launcher asks: its parent pid
// changes the moment it is reparented, to init or to the nearest subreaper.
//
// A process whose parent is already init when it starts (started under `setsid`, or by a service manager
// that exits) never sees its parent pid change, so this never fires for it.

/**
 * Call `onGone` once, the first time this process's parent pid differs from the one it had when this was
 * called. Returns a function that stops watching. The timer never keeps the process alive on its own.
 */
export function watchParent(onGone, { intervalMs = 1000, parentPid = () => process.ppid } = {}) {
  const first = parentPid();
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    const now = parentPid();
    if (now === first) return;
    fired = true;
    clearInterval(timer);
    onGone({ was: first, now });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
