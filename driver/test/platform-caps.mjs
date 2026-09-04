// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// What THIS machine can actually falsify — probed, never inferred from `process.platform`.
//
//: the first macOS CI run failed 10 assertions that README.md promised worked there. Four
// distinct platform facts caused them, and every one of them is a property of the MACHINE rather
// than of the operating system's name:
//
//   · a volume that folds case on lookup      (macOS default, and ext4 `-O casefold` on Linux)
//   · the claimer birth stamp (/proc on Linux, `ps -o lstart` elsewhere — absent only where neither answers)
//   · timeout(1) + bash >= 4                   (GNU/deployment-host shell; macOS ships neither)
//
// `process.platform === "darwin"` is wrong in BOTH directions for all three. macOS can be installed
// on a case-SENSITIVE APFS volume, Linux can mount a folding one (that is how was reproduced on
// a Linux box), and a Linux container can be missing /proc. A platform name would make the suite
// assert the wrong thing on a machine nobody tested — which is the failure mode was about.
//
// EVERY export here comes with the sentence a reader needs when a test skips on it. A silent
// `if (platform === "darwin") return` is the one outcome ruled out: the skip has to say what
// went unverified and where the claim is written down, or README.md is promising something no run
// ever checked.
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { procStarttime } from "../claim-liveness.mjs";   // — ask the reader, not the filesystem

/** Does `dir` fold case on LOOKUP? Probed by writing a name and asking for it back shouted.
 *  Probe the directory the fixture actually uses — folding is a per-VOLUME (ext4: per-DIRECTORY-tree)
 *  property, so /tmp and the repo checkout can legitimately disagree on one machine. */
export function foldsCase(dir) {
  // The two names are built by joining onto `dir`, never by case-mapping the finished path: the
  // directory part is somebody else's mkdtemp output and may hold anything, and folding IT would
  // ask a different question (or, on a mixed tree, silently answer about the wrong directory).
  const leaf = `casefold-probe-${process.pid}`;
  try {
    writeFileSync(join(dir, leaf), "");
    return existsSync(join(dir, leaf.toUpperCase()));
  } catch { return false; }
}

/**
 * The birth stamp behind the PID-reuse defence — PROBED THROUGH THE PRODUCT'S OWN READER.
 *
 *. This asked the filesystem for `/proc/<pid>/stat`, which was the same
 * question while `procStarttime` had one implementation. It has two now — `/proc` on Linux, `ps
 * -o lstart` everywhere else — so a machine with no `/proc` can produce the stamp, and a probe of the
 * FILE would skip arms that would pass. The capability is whether the reader ANSWERS, and the only
 * honest way to ask that is to call it. The constant keeps its name so the skip family declared in
 * `every-skip-is-declared.test.mjs` still matches the sentence below.
 */
export const HAS_BIRTH_STAMP = procStarttime(process.pid) !== null;

export const NO_PROC_STARTTIME_WHY =
  "this machine produced no birth stamp for its own pid — neither /proc/<pid>/stat nor `ps -o lstart` " +
  "answered — so procStarttime() returns null and the #665 PID-reuse defence degrades to bare-pid " +
  "liveness. The degradation is FAIL-SAFE (an unreadable starttime counts the claimer ALIVE, so a live " +
  "run is never double-claimed and no lawyer is double-delivered to) — what is lost is the escape " +
  "hatch that frees a `.processing` held by a RECYCLED pid, which then waits for the max-claim-age " +
  "ceiling instead. README.md 'Where it runs' states this limitation; do not delete this skip without " +
  "deleting that sentence too.";

/** Can this machine run driver/deliver-trigger.sh at all? Two hard requirements, both absent on a
 *  stock macOS: `declare -A` needs bash >= 4 (macOS ships 3.2, GPLv3), and every courier wake is
 *  wrapped in timeout(1) from GNU coreutils (macOS ships no timeout and no gtimeout). */
export const DEPLOYMENT_SHELL = (() => {
  const missing = [];
  const v = spawnSync("bash", ["-c", "echo ${BASH_VERSINFO[0]}"], { encoding: "utf8" });
  const major = Number(String(v.stdout ?? "").trim());
  if (!Number.isFinite(major) || major < 4) missing.push(`bash >= 4 for \`declare -A\` (found ${v.stdout?.trim() || "no bash"})`);
  const wall = spawnSync("bash", ["-c", "command -v timeout || command -v gtimeout"], { encoding: "utf8" });
  if (wall.status !== 0) missing.push("timeout(1)/gtimeout(1), the enforced wall on every courier wake");
  return { ok: missing.length === 0, missing };
})();

export const NO_DEPLOYMENT_SHELL_WHY =
  `this machine cannot run driver/deliver-trigger.sh — missing ${DEPLOYMENT_SHELL.missing.join("; ")}. ` +
  "The trigger is the LINUX deployment host's script: it is driven by prelim-outbox.path/.service/.timer, " +
  "which are systemd units, and systemd exists on no other platform — so this is a part the engine does " +
  "not run here rather than a defect to fix. The script itself says so at startup (it refuses with a " +
  "named diagnosis rather than waking without its wall). README.md 'Where it runs' states this " +
  "limitation; do not delete this skip without deleting that sentence too.";

/** A stand-in for "the reasoning CLI died at startup": exits nonzero, emits no stream event, and —
 *  unlike the /bin/false this replaced — exists on every platform. /bin/false is coreutils and lives
 *  at /usr/bin/false on macOS, so spawning it there raised ENOENT and took the engine's SPAWN-ERROR
 *  path instead of its exit path. Same shape, different tuple, and the test was reading the wrong one. */
export function failingBin(code = 7) {
  const dir = mkdtempSync(join(tmpdir(), "failbin-"));
  const p = join(dir, "startup-death.sh");
  writeFileSync(p, `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 });
  return p;
}

/**
 * Is `pid` running? THREE-VALUED — `true`, `false`, and `null` for COULD NOT LOOK.
 *
 *. The 2104 reaper arms asked `existsSync("/proc/<pid>")` directly, and `/proc`
 * is a Linux filesystem. On the first macOS nightly that carried them all five failed at their own
 * control, before a single signal was sent — while the three arms in the same file that never ask this
 * question returned green in the same job. That is the same seam 2099 fixed for `processTable`: one
 * contract, two implementations, and `null` meaning the instrument did not start.
 *
 * THE ERRNO IS THE ANSWER, and reading it is the whole difference between this and the bare `kill -0`
 * that `docs/architecture/06-operations-runbook.md` warns about ("a cross-user pid reads as dead under
 * `kill -0`"). That warning is about the NAIVE form, which treats any throw as death:
 *
 *   no throw      → alive, and ours to signal.
 *   ESRCH         → no such process. THE ONLY ANSWER THAT MEANS DEAD.
 *   EPERM         → alive, and somebody else's. The kernel can only refuse to signal a process that
 *                   EXISTS, so this is precisely the runbook's cross-user case — answered, rather than
 *                   collapsed into the "dead" that made the runbook write the warning.
 *   anything else → could not look. Never `false`: an instrument that failed must not read as an
 *                   absence. That collapse is the bug class 2099 exists to stop, and the one this
 *                   function is most likely to be misused into.
 *
 * `process.kill(pid, 0)` sends no signal; it asks the kernel whether it COULD. It is POSIX, it spawns
 * nothing, and it answers on macOS — which `processTable()` also does, but at a `ps -Ao` per call, and
 * the caller here polls every 50ms for up to eight seconds across five arms.
 *
 * `kill` is injected for one reason: so the branches THIS machine never takes are still executed here.
 * It is the same reason `processTable` injects `runPs`, and it is what stops this fix from shipping on
 * the word of the one platform that happened to run it.
 */
export function pidAlive(pid, { kill = (p) => process.kill(p, 0) } = {}) {
  // Not a question this can answer: `false` would be a lie in the shape of an answer, and 0 and the
  // negatives address a process GROUP — never something to probe by accident.
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { kill(pid); return true; } catch (err) {
    if (err?.code === "ESRCH") return false;
    if (err?.code === "EPERM") return true;
    return null;
  }
}
