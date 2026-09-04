// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Fast tier: spawns `sh`, not a browser. No marker.
//
// — THE WAIT WAS ON THE WRONG THING, NOT TOO SHORT.
//
// `render-check` killed Chrome's PARENT and waited up to 5s for its `exit` event, then deleted the
// profile directory. Chrome's renderer, GPU and zygote processes are separate PIDs; the parent's exit
// says nothing about them, and a straggling renderer keeps `prof-<zoom>/Default` non-empty. The cleanup
// then lost the race and printed `ENOTEMPTY` — after all eighteen render assertions had printed `ok`,
// which at job level is indistinguishable from a real render regression.
//
// The cure is to make the browser a process-group leader and signal the GROUP. This file asserts that
// mechanism on a stand-in, because a test that needs `google-chrome` on PATH would be skipped exactly
// where the bug lives (CI runners) — and a skipped arm asks no question.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** A parent that outlives nothing and a CHILD that writes a file for 30s — Chrome's shape, in `sh`. */
function parentWithChild(dir) {
  const marker = join(dir, "child.pid");
  // `$!` — the BACKGROUND JOB's pid. A first version used `( echo $$ … ) &`, and `$$` inside a subshell
  // expands to the PARENT shell's pid, so the marker named the process being killed and the control arm
  // failed. The control catching that is the reason it is written first.
  const p = spawn("sh", ["-c", `sleep 30 & echo $! > ${marker}; wait`], {
    stdio: ["ignore", "ignore", "ignore"], detached: true,
  });
  return { proc: p, marker };
}

async function childPidFrom(marker) {
  for (let i = 0; i < 60; i++) {
    if (existsSync(marker)) {
      const raw = readFileSync(marker, "utf8").trim();
      if (raw) return Number(raw);
    }
    await settle(50);
  }
  return null;
}

test("#1717 killing the PROCESS leaves the child running — the control, and the bug", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grp-control-"));
  const { proc, marker } = parentWithChild(dir);
  const child = await childPidFrom(marker);
  assert.ok(child && alive(child), "the fixture never started a child — this would prove nothing");

  proc.kill("SIGKILL");                       // exactly what render-check used to do
  await settle(400);
  assert.equal(alive(child), true,
    "a bare kill on the parent must leave the child alive — if this stops holding the fixture no longer "
    + "reproduces the bug and the arm below is no longer evidence of anything");

  // Clean up the child DIRECTLY. The group leader is already dead here, so the negative pid may name
  // nothing — and this arm's whole point is that the child outlived it. Leaving it would leak a process
  // per run onto a shared box, which is a smaller version of the bug under test.
  try { process.kill(child, "SIGKILL"); } catch { /* it exited on its own */ }
  try { process.kill(-proc.pid, "SIGKILL"); } catch { /* group already gone */ }
});

test("#1717 killing the GROUP takes the child with it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "grp-cure-"));
  const { proc, marker } = parentWithChild(dir);
  const child = await childPidFrom(marker);
  assert.ok(child && alive(child), "the fixture never started a child");

  // `detached: true` at spawn is what makes this addressable: the child leads its own group, so the
  // negative pid names the whole tree. Without it this signal would hit the caller's own group.
  process.kill(-proc.pid, "SIGKILL");
  for (let i = 0; i < 40 && alive(child); i++) await settle(50);
  assert.equal(alive(child), false,
    "the group kill must reap the child — this is the whole difference between the two arms");
});
