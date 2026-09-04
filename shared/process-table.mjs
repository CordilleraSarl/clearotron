// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// process-table.mjs — WHO ELSE IS RUNNING, on a box that may not have /proc.
//
//. Three places asked the operating system "what is running, since when" by
// reading `/proc` directly, and `/proc` is a Linux filesystem: macOS has none. On the first macOS run
// this repository has ever had — the tier had never once executed, see 2099 — all three failed at the
// same seam, in three different shapes:
//
//   • `bin/onboard.mjs` returned `null` and doctor printed "the process table could not be read", so
//     the deployment check that tells a reader they are running an older tree can never work there.
//   • an arm read `readdirSync("/proc")` and died with ENOENT.
//   • `driver/claim-liveness.mjs` read `/proc/<pid>/stat` for a birth stamp — its own concern, and it
//     keeps its own announced degradation.
//
// README.md's "Where it runs" names macOS FIRST. A check that cannot look on a supported platform is
// not a check, so this is one reader with one contract and two implementations behind it.
//
// ── THE CONTRACT, AND THE ONE THING IT REFUSES TO DO ──────────────────────────────────────────────
//
// `null` means COULD NOT LOOK. An empty array means the box was read and nothing matched. They are
// different answers and this module never collapses them, because the collapse is the whole bug class:
// a scan that cannot run returns nothing, nothing matches the filter, and the caller reports a clean
// machine from an instrument that never started. Every caller here already knows to check for `null`
// (onboard's `readProcs` injection exists for exactly this reason) — the contract is kept so that stays
// true on the platform where the reader is a subprocess rather than a directory listing.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Every process on this box: `{ pid, cmd, startedAt }`, or `null` when the table could not be read.
 *
 * `cmd` is the full command line, whitespace-normalised. `startedAt` is epoch ms and may be `NaN` when
 * the process went away mid-scan — the callers that care already test it with `Number.isFinite`.
 *
 * `platform` and `runPs` are injected so the two branches can BOTH be driven on one box: without that,
 * every arm for the branch this machine does not take would be written and never executed, which is
 * how a portability fix ships broken on the platform it was written for.
 */
export function processTable({ platform = process.platform, runPs = defaultRunPs } = {}) {
  return platform === "linux" ? fromProc() : fromPs(runPs);
}

/** Linux: the kernel's own listing. `/proc/<pid>` mtime is the process's start. */
function fromProc() {
  let pids;
  try { pids = readdirSync("/proc").filter((n) => /^\d+$/.test(n)); } catch { return null; }
  const out = [];
  for (const pid of pids) {
    let cmd;
    // A kernel thread has an EMPTY cmdline rather than an unreadable one, and it is a real process —
    // it belongs in the listing with the name the kernel gives it, not dropped as if it did not exist.
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim(); } catch { continue; }
    let startedAt = NaN;
    try { startedAt = statSync(`/proc/${pid}`).mtimeMs; } catch { /* gone mid-scan */ }
    out.push({ pid: Number(pid), cmd, startedAt });
  }
  return out;
}

/**
 * Everywhere else: `ps`, which is POSIX and is on macOS.
 *
 * `lstart` rather than `start` or `etime`: `start` abbreviates to a time-of-day for anything begun
 * today and to a DATE for anything older, so it cannot be parsed to a moment; `etime` is a duration
 * that changes between two reads of the same process. `lstart` is always the full absolute start time.
 * It is also why the field order is pid, lstart, command and not the other way round — `command` is the
 * only field that can contain arbitrary spaces, so it has to be last for the parse below to be sound.
 */
function fromPs(runPs) {
  const r = runPs();
  if (!r || r.status !== 0 || typeof r.stdout !== "string") return null;
  const out = [];
  for (const line of r.stdout.split("\n")) {
    // lstart is `Mon Sep  1 08:21:53 2026` — a fixed shape, and anchoring on it is what separates the
    // pid from a command line that begins with a number.
    const m = /^\s*(\d+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    out.push({ pid: Number(m[1]), cmd: m[3].trim(), startedAt: Date.parse(m[2]) });
  }
  // A `ps` that exited 0 and printed NOTHING PARSEABLE has not read the box: this process is in that
  // listing, so an empty result is a broken instrument and must not read as an empty machine.
  return out.length ? out : null;
}

const defaultRunPs = () =>
  spawnSync("ps", ["-Ao", "pid=,lstart=,command="], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

export { defaultRunPs };
