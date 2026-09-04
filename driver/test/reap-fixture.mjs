// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reap-fixture.mjs —: A SIGTERM-PROOF FIXTURE IS REAPED BY ITS OWNER, ON EVERY EXIT PATH.
//
// Two node processes sat on the shared test box for 2.7 days: `mock-claude-spew-immune.mjs` and a
// `node -e process.on('SIGTERM',()=>{})…` — `mock-hang-tree.mjs`'s grandchild. Both orphaned to init,
// both immune to SIGTERM, both needing SIGKILL from a human.
//
// ── THE ROOT CAUSE, READ FROM THE CODE RATHER THAN THE SPECIMENS ─────────────────────────────────
//
// The reporter could not establish it — the processes were killed before their environment was
// captured — so this is a statement about the paths that EXIST, not a reconstruction of that night.
// There were two, and they are the same mistake:
//
//   engine-overflow-cap    reaped in a `finally`, but the try that owns it opens AFTER the awaited
//                          turn and AFTER the pidfile read. A rejected turn, or a fixture that never
//                          wrote its pidfile, skips the reaping block entirely.
//   engine.anthropic       the hang-tree arm reaps NOTHING. It asserts the fixtures are dead, which is
//                          true whenever the code under test works.
//
// **The tests that verify a SIGKILL escalation were delegating their own cleanup to the escalation they
// are testing.** On the day either one catches a real regression, it leaks the processes — the failure
// mode is armed precisely when the guard is doing its job.
//
// ── WHAT THIS OWNS, AND WHAT NOTHING CAN ─────────────────────────────────────────────────────────
//
// Registration happens BEFORE the fixture can start, so no path between spawn and teardown can skip it:
// a rejected promise, a failed assertion, a `--test-timeout`, an uncaught throw, Ctrl-C. What it cannot
// cover is the runner itself being SIGKILLed — no in-process handler runs then, and a design that
// claimed otherwise would be lying. That case leaks, and it is the one case a human is the right
// backstop for.
//
// ── PID REUSE, AND WHY THE COMMAND LINE IS CHECKED ───────────────────────────────────────────────
//
// This runs on a SHARED box — another session was running `node --test` during the very round that
// found the leak. A pid read from a file can have been recycled by then, and a blind SIGKILL would kill
// a stranger's process. On Linux `/proc/<pid>/cmdline` says what the pid IS; the kill only happens when
// it still names node. Where that is unreadable (macOS, a hardened /proc) the check cannot be made and
// the kill proceeds — stating that here rather than pretending the guard is universal.
import { readFileSync, existsSync } from "node:fs";

/** pidfiles registered by tests, read at teardown however the process is leaving. */
const registered = new Set();

/** Every number in the pidfile: the spew fixture writes a bare pid, the hang tree writes a JSON object. */
function pidsIn(pidfile) {
  let raw; try { raw = readFileSync(pidfile, "utf8"); } catch { return []; }   // never written = never spawned
  const out = [];
  // THE OBJECT CHECK IS LOAD-BEARING, and its absence is why the first cut of this reaped nothing at
  // all: `JSON.parse("12345")` SUCCEEDS and returns a number, so the spew fixture's bare-pid file took
  // the JSON branch, `Object.values(12345)` gave `[]`, and the function returned no pids while looking
  // like it had parsed the file. Driving it against a real SIGTERM-immune child is what showed it — the
  // shape reads correct.
  let doc = null;
  try { doc = JSON.parse(raw); } catch { /* a bare pid is not JSON — fall through */ }
  if (doc && typeof doc === "object") {
    for (const v of Object.values(doc)) if (Number.isInteger(v) && v > 0) out.push(v);
  } else {
    const n = Number(String(raw).trim());
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

/** Is this pid still the fixture, or a stranger who inherited the number? Unknowable off /proc. */
function stillOurs(pid) {
  const proc = `/proc/${pid}/cmdline`;
  if (!existsSync(proc)) return !existsSync("/proc/self/cmdline");   // no /proc at all → cannot tell → proceed
  try { return readFileSync(proc, "utf8").includes("node"); } catch { return false; }
}

/**
 * Register a pidfile for guaranteed reaping. Call it BEFORE the fixture can start — the whole point is
 * that no exit path between spawn and teardown can skip it.
 */
export function reapPidfile(pidfile) { registered.add(pidfile); return pidfile; }

/** SIGKILL, not SIGTERM: every fixture this file exists for ignores SIGTERM by design. */
export function reapNow() {
  const killed = [];
  for (const pidfile of registered) {
    for (const pid of pidsIn(pidfile)) {
      if (!stillOurs(pid)) continue;
      try { process.kill(pid, "SIGKILL"); killed.push(pid); } catch { /* already gone */ }
    }
  }
  registered.clear();
  return killed;
}

// THE NET. Synchronous by necessity — an `exit` handler cannot await — which is why every read and kill
// above is sync. Registered once, at import, so a test file that imports this is covered whether or not
// it remembers to call `reapNow`.
process.on("exit", reapNow);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { reapNow(); process.exit(process.exitCode ?? 1); });
}
