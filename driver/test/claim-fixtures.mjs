// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE DEAD-CLAIMER FIXTURE, IN ONE PLACE.
//
// A fixture that writes `String(await deadPid())` writes a LEGACY BARE-PID sidecar, and
// `claimerIsAlive`'s bare-pid branch (claim-liveness.mjs) returns ALIVE for any pid that answers
// `kill(pid, 0)` — it has no birth stamp to compare, so it cannot tell the claimer from whoever holds
// that pid number now. The arm then reads `IN FLIGHT`, the job is never consumed, and the assertion
// fails on a runner and passes on a laptop.
//
// TWO different things make a pid answer, and BOTH are ordinary on a shared self-hosted runner:
//
//   recycled     the kernel wrapped pid_max (4194304 here) and reissued the number
//   foreign uid  another user's live process holds it — `kill` raises EPERM, which claimerIsAlive
//                counts as ALIVE by design (a pid under another uid is still a running process)
//
// Both are defeated by the sidecar A REAL CLAIMER WOULD HAVE WRITTEN: pid + the kernel's boot-tick
// birth stamp, captured while the child still lives. `claimerIsAlive` then takes its starttime branch
// and answers on positive evidence — pid gone ⇒ dead, pid held by anyone else ⇒ starttime mismatch ⇒
// dead. Deterministic under any load, and it exercises more of the product than the bare pid did.
//
// This is 's cure, which landed in runner.takeover.test.mjs and was never carried to the other
// three files that build the same fixture. It lives here so a fifth copy cannot drift from it.
//
// NOT A BIGGER TIMEOUT. says so and it is right: a timing-sensitive test made quieter is not made
// correct. Nothing here waits longer than it did.
import { spawn } from "node:child_process";
import { procStarttime } from "../claim-liveness.mjs";
import { HAS_BIRTH_STAMP, NO_PROC_STARTTIME_WHY } from "./platform-caps.mjs";

// The gate every caller of deadClaimToken needs, built from the machine PROBE rather than restated:
// with no /proc there is no birth stamp, the fail-safe polarity reports the claimer ALIVE, and an arm
// asserting the takeover proceeds cannot hold. has the full reasoning.
export const PROC_GATE = HAS_BIRTH_STAMP ? {} : { skip: NO_PROC_STARTTIME_WHY };

// `claimToken` is NOT re-implemented here — runner.mjs exports the real one, and a fixture that
// restates production's stamping format is a copy that can drift from it. Import it from ../runner.mjs.

// The token a claimer that has since died would have left behind.
export async function deadClaimToken() {
  const c = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore" });
  // Read the birth stamp WHILE IT LIVES — this is the value the claimer itself would have stamped.
  let st = null;
  for (let i = 0; i < 50 && st == null; i++) {
    st = procStarttime(c.pid);
    if (st == null) await new Promise((r) => setTimeout(r, 2));
  }
  c.kill("SIGKILL");
  await new Promise((r) => c.on("exit", r));
  // No /proc ⇒ no birth stamp to stamp, and a bare pid is all a real claimer could have written either.
  // Stated rather than silently degraded.
  return st ? `${c.pid}:${st}` : String(c.pid);
}