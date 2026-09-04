// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — WHAT IS RUNNING, ON A BOX THAT IS NOT LINUX.
//
// Three readers asked the kernel "what is running, since when" by opening `/proc`, and every one of them
// failed on the first macOS run this repository has ever had: the tier had never once executed, so four
// nights of "green" were a runner that never allocated. The arms here exist because the fix is only worth
// anything if BOTH branches are driven — a portability fix whose new branch runs nowhere is the same
// guess it replaced, wearing a passing test.
//
// So every arm below runs the `ps` branch ON LINUX, by injection. That is the whole point: the branch
// macOS takes is exercised on the machine that has no macOS.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processTable, defaultRunPs } from "../../shared/process-table.mjs";
import { procStarttime } from "../claim-liveness.mjs";
import { beat, workerAlive } from "../worker-heartbeat.mjs";

const psStamp = (pid) => procStarttime(pid, undefined, { platform: "darwin" });

// The `/proc` reader is asserted only where /proc EXISTS, and that is not a softening: this arm ran on
// macOS for the first time in this repository's history ('s own verification run)
// and failed on its own premise — a Linux-only reader cannot be proved on a box with no Linux. The `ps`
// reader carries no such condition and is asserted everywhere, which is the half that matters: it is the
// one this issue added, and the one every non-Linux box depends on.
const HAS_PROC = existsSync("/proc/self/stat");

test("2099 both readers list this very process — the instrument is proved, not assumed", () => {
  // ONE SITE, BOTH DIRECTIONS, EXECUTED ON EVERY BOX. Written as an if/else this was an `else` no
  // Linux run can take, and the coverage census refused it by name — correctly: a branch no
  // population reaches is a guess wearing an assertion. Stated as an equality it asserts the same
  // contract (a listing where /proc exists, could-not-look where it does not) and runs everywhere.
  const viaProc = processTable({ platform: "linux" });
  assert.equal(viaProc === null, !HAS_PROC,
    HAS_PROC ? "/proc is on this box and the /proc reader still said could-not-look"
      : "no /proc on this box, and the /proc reader did not say could-not-look — it invented a listing");
  const readers = [["ps", processTable({ platform: "darwin" })]];
  if (viaProc !== null) readers.unshift(["/proc", viaProc]);
  for (const [name, table] of readers) {
    assert.notEqual(table, null, `${name}: the reader returned null on a box where it can look`);
    assert.ok(table.length > 0, `${name}: an empty listing — this process is in it, so the reader broke`);
    const self = table.find((p) => p.pid === process.pid);
    assert.ok(self, `${name}: the listing does not contain this process (pid ${process.pid}), so whatever `
      + "it read, it was not the process table");
    assert.match(self.cmd, /node/, `${name}: this process's command line does not name its interpreter: ${self.cmd}`);
  }
});

test("2099 the ps reader dates a process to a moment, and it is this process's own", () => {
  const self = processTable({ platform: "darwin" }).find((p) => p.pid === process.pid);
  assert.ok(Number.isFinite(self.startedAt), `no start time on the ps branch: ${self.startedAt}`);
  // Bounded on both sides: after this suite's own process could possibly have begun, and not in the
  // future. A parse that silently produced NaN or 0 would pass a bare "is a number" check.
  const age = Date.now() - self.startedAt;
  assert.ok(age >= -2000 && age < 24 * 3600_000,
    `this process started ${Math.round(age / 1000)}s ago by the ps reader, which is not a plausible age`);
});

test("2099 a ps that could not look is null, and null is never an empty box", () => {
  assert.equal(processTable({ platform: "darwin", runPs: () => ({ status: 1, stdout: "" }) }), null,
    "a ps that exited non-zero read as a machine with nothing running on it");
  assert.equal(processTable({ platform: "darwin", runPs: () => ({ status: 0, stdout: "" }) }), null,
    "a ps that exited 0 and printed nothing read as a machine with nothing running on it — this process "
    + "is in that listing, so an empty parse is a broken instrument");
  assert.equal(processTable({ platform: "darwin", runPs: () => ({ status: 0, stdout: "garbage\nmore garbage\n" }) }), null,
    "a ps whose output parsed to nothing read as an empty box rather than as a reader that broke");
  assert.equal(processTable({ platform: "darwin", runPs: () => null }), null,
    "a ps that could not be spawned at all read as something other than could-not-look");
});

test("2099 a command line beginning with a number is not mistaken for a pid", () => {
  // The parse anchors on `lstart`, and this is the case that says so: the pid column and a command that
  // starts with digits are told apart by the date between them, not by position alone.
  const line = "  4242 Mon Sep  1 08:21:53 2026 2026-report.mjs --pool /srv/pool";
  const [row, ...rest] = processTable({ platform: "darwin", runPs: () => ({ status: 0, stdout: `${line}\n` }) });
  assert.deepEqual(rest, [], "one line produced more than one row");
  assert.equal(row.pid, 4242);
  assert.equal(row.cmd, "2026-report.mjs --pool /srv/pool");
  assert.equal(row.startedAt, Date.parse("Mon Sep  1 08:21:53 2026"));
});

test("2099 the birth stamp survives where there is no /proc, and still refuses a dead pid", () => {
  const st = psStamp(process.pid);
  assert.ok(st, "the ps branch produced no birth stamp for this process");
  assert.doesNotMatch(String(st), /:/,
    "the stamp carries a colon, which breaks the `<pid>:<starttime>` sidecar it is written into");
  assert.equal(psStamp(2 ** 22 + 1), null,
    "a pid that cannot exist produced a birth stamp — the reader is inventing one");
});

test("2099 a worker's own beat reads as alive on a box with no /proc", () => {
  // THE PRODUCT DEFECT, driven end to end: `workerAlive` answered false here for a beat written a
  // millisecond earlier, so a macOS reader was told nothing was draining their queue while it drained.
  const dir = mkdtempSync(join(tmpdir(), "ct-hb-noproc-"));
  try {
    assert.equal(beat(dir, { starttimeOf: psStamp }), true);
    assert.equal(workerAlive(dir, { starttimeOf: psStamp }), true,
      "a worker that beat a moment ago reads as absent, which is the false alarm #1721 exists to close");

    // And the defence it is there for still fires: the same pid wearing a different birth stamp is a
    // recycled pid, not this worker.
    assert.equal(workerAlive(dir, { starttimeOf: () => "1" }), false,
      "a pid whose birth stamp does not match the beat read as alive — the recycled-pid defence is off");
    assert.equal(workerAlive(dir, { starttimeOf: () => null }), false,
      "an unreadable birth stamp read as alive, which is the wrong fail-safe direction for this module");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("2099 the real ps invocation is the one the parser was written for", () => {
  // The seam above means every arm could pass over a `ps` nobody ever runs. This one runs the real
  // default, so the flags and the parse are proved together.
  const parsed = processTable({ platform: "darwin", runPs: defaultRunPs });
  assert.notEqual(parsed, null, "the real `ps -Ao pid=,lstart=,command=` produced nothing this parser could read");
  assert.ok(parsed.some((p) => p.pid === process.pid), "the real ps listing does not contain this process");
});
