// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — WATCH MODE, the trigger a machine with no systemd does not otherwise have.
//
// Every recovery path in runner.mjs was already complete and already tested (runner.self-resume,
// runner.postpone-identity, rate-limit-postpone). All of them wait for something to call main() again,
// and on the VM that something is the `.path` unit plus the 90s timer. On a laptop it was nothing, so a
// run parked on a provider cap and a run cut by a closed lid both stopped forever, silently.
//
// These tests are about WHEN the loop calls main() and nothing else — they inject `run`, `sleep`, `now`
// and `stopped`, so no queue is scanned, no pipeline is driven and nothing is spent. The behaviour of a
// tick is main()'s, and is covered where main() is covered.
import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// freeze config.workspaceRoot to an empty temp dir BEFORE the import below, so nothing here can see a
// real queue even if a tick were to run for real.
pinEnv(process.env, "CLEAROTRON_WORK_DIR", mkdtempSync(join(tmpdir(), "prelim-watch-")));
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const { watch } = await import("../runner.mjs");

test("watch calls main once per tick and stops at the cap", async () => {
  const calls = [];
  await watch({ ticks: 3, tickMs: 10, sliceMs: 5, run: async (o) => calls.push(o), sleep: async () => {}, stopped: () => false });
  assert.equal(calls.length, 3);
  // the loop must drive the SAME entrypoint systemd drives — a watch tick that took a different door
  // would be a second implementation of activation, which is the thing this change must not become.
  for (const o of calls) assert.deepEqual(o, { once: true });
});

test("a throwing tick is isolated — the loop keeps its next appointment", async () => {
  // Pre-fix there was no loop at all; a loop that dies on the first bad tick puts a laptop straight back
  // there, and the failure that killed it (a transient fs error, a queue dir that vanished) is the kind
  // that is gone by the next tick.
  let n = 0;
  await watch({ ticks: 3, tickMs: 10, sliceMs: 5, run: async () => { n++; throw new Error("boom"); }, sleep: async () => {}, stopped: () => false });
  assert.equal(n, 3);
});

test("a stop request ends the loop instead of claiming into a shutdown", async () => {
  let n = 0, stop = false;
  await watch({ ticks: Infinity, tickMs: 10, sliceMs: 5, run: async () => { n++; if (n === 2) stop = true; }, sleep: async () => {}, stopped: () => stop });
  assert.equal(n, 2);
});

test("WAKE FROM SUSPEND: a resetsAt that passed while the lid was shut is acted on at once, not one tick later", async () => {
  // The whole point. Timers run on a MONOTONIC clock that stops while the machine sleeps, while resetsAt
  // and postponedDueAt are WALL clock. So after four hours of suspend a naive setTimeout(90s) has barely
  // advanced and would serve out the rest of its wait — with a park that came due three hours ago sitting
  // on disk. The slice compares what it asked for against wall-clock elapsed and cuts the wait short.
  let wall = 1_000_000, slices = 0, ticks = 0;
  await watch({
    ticks: 2, tickMs: 90_000, sliceMs: 5_000, wakeJumpMs: 15_000,
    run: async () => { ticks++; },
    sleep: async (ms) => { slices++; wall += slices === 1 ? 4 * 3_600_000 : ms; },   // slice 1 spans a 4h suspend
    now: () => wall,
    stopped: () => false,
  });
  assert.equal(ticks, 2);
  assert.equal(slices, 1, "the wait must end on the slice that detected the jump");
});

test("no jump: the full cadence is served, in slices", async () => {
  // The detector must not be trigger-happy either — an ordinary 90s wait is 18 undisturbed 5s slices, so
  // the loop is not secretly polling the queue six times a minute.
  let wall = 0, slices = 0;
  await watch({
    ticks: 2, tickMs: 90_000, sliceMs: 5_000, wakeJumpMs: 15_000,
    run: async () => {}, sleep: async (ms) => { slices++; wall += ms; }, now: () => wall, stopped: () => false,
  });
  assert.equal(slices, 18);
});

test("main({ once: false }) IS watch mode — the documented parameter is no longer an apology", async () => {
  // runner.mjs used to end main() with "[runner] watch mode not implemented here". The parameter existed,
  // the only call site passed once:true, and the branch was unreachable. It now delegates to the loop.
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../runner.mjs", import.meta.url), "utf8"));
  assert.ok(!src.includes("watch mode not implemented here"), "the apology must be gone, not merely unreachable");
  assert.match(src, /if \(!once\) return await watch\(\);/);
  // and the systemd lane must still take the one-shot door. named the flag as a
  // local, because the drainer's identity stamp records the MODE it is about to run in and needs the same
  // value — so this pins the two halves separately rather than one literal call. It is deliberately
  // STRONGER than the single regex it replaces: the old form could not have told a renamed flag from a
  // renamed variable, and this fails if either half stops meaning "no --watch ⇒ one shot".
  assert.match(src, /const watching = argv\.includes\("--watch"\);/,
    "watch mode must still be decided by the FLAG, not by an environment variable — a variable in an "
    + "EnvironmentFile could silently turn the systemd one-shot into a loop inside a Type=oneshot activation");
  assert.match(src, /await main\(\{ once: !watching \}\);/,
    "and it must still reach main through the documented parameter");
});

test("a mistyped --watch is refused, not silently one-shotted", async () => {
  // `--wach` running one tick and exiting 0 would leave someone believing a watcher is running while
  // nothing re-invokes anything — the same silence this change exists to remove.
  const { execFileSync } = await import("node:child_process");
  const runner = new URL("../runner.mjs", import.meta.url).pathname;
  let out = "", code = 0;
  try {
    execFileSync(process.execPath, [runner, "--wach"], { encoding: "utf8", stdio: "pipe",
      env: pinEnvAll({ ...process.env }, { CLEAROTRON_NO_ENV_FILE: "1", CLEAROTRON_WORK_DIR: process.env.CLEAROTRON_WORK_DIR }) });
  } catch (e) { code = e.status; out = String(e.stderr ?? ""); }
  assert.equal(code, 2, "an unknown argument must refuse");
  assert.match(out, /unknown argument --wach/);
  assert.match(out, /--watch/);
});

test("the watch sleep is REF'd — an idle loop must not let node exit between ticks", async () => {
  // The trap the gateway-preflight hold already documents in this file: the shared delay() unrefs its
  // timer, and between ticks the sleep is the ONLY thing on the event loop, so an unref'd one would let
  // node exit 0 after the first idle tick — a watch mode that silently stops watching.
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../runner.mjs", import.meta.url), "utf8"));
  const sig = /const sleepRefd = \(ms\) => new Promise\(\(r\) => setTimeout\(r, ms\)\);/;
  assert.match(src, sig);
  assert.ok(!/const sleepRefd[\s\S]{0,120}unref/.test(src), "sleepRefd must not unref");
  assert.match(src, /sleep = sleepRefd/);
});
