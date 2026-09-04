// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner through SIGTERM mid-claim
// B6 — graceful stop. The runner had NO SIGTERM/SIGINT handler: systemctl stop/restart (or ^C on a manual
// drain) killed it mid-claim-loop, stranding in-flight claims behind a live-looking sidecar — pre-B1 that
// re-minted codenames on the next activation (full re-spend). Cross-process proofs: after SIGTERM no NEW
// job is claimed while the in-flight one runs to completion and the process exits 0; the grace window
// bounds a stop that can't finish (exit 1, claim resumes as the SAME codename next activation — the B6→B1
// handshake); a second signal exits immediately. Queue markers stay consistent throughout (renames are
// atomic; the handler never touches them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync as readdirSyncFs } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

const job = (ref, mark) => ({
  id: `stop-${ref}`, msgId: `<stop-${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref, markName: mark, classes: [9], provider: "corsearch",
});
const queueFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search", "queue");
function envFor(root, extra = {}) {
  return {
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_QUEUE_SCAN_MS: "100", CORSEARCH_SESSION_KEY: "test-offline",
    ...extra,
  };
}
const spawnRunner = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  c.exited = new Promise((r) => c.on("exit", (code) => r(code)));
  return c;
};
const waitFor = async (pred, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("SIGTERM mid-drain: no new claims after the signal, in-flight job completes, clean exit, queued .json untouched", async () => {
  const root = mkdtempSync(join(tmpdir(), "stop-graceful-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-a.json"), JSON.stringify(job("TMP9401", "STOP PROBE A")));
  const barrier = join(root, "release");
  const c = spawnRunner(envFor(root, { MOCK_BARRIER_FILE: barrier, CLEAROTRON_MAX_CONCURRENT_RUNS: "2" }));
  assert.ok(await waitFor(() => existsSync(join(Q, "job-a.processing"))), `A claimed\n${c.log}`);

  c.kill("SIGTERM");
  assert.ok(await waitFor(() => /SIGTERM — graceful stop/.test(c.log), 5000), `handler acknowledged the signal\n${c.log}`);
  // B arrives AFTER the signal — with A in flight the loop keeps re-scanning every 100ms, yet B must
  // never be claimed (admission closed by the stop flag, same gate as the budget).
  writeFileSync(join(Q, "job-b.json"), JSON.stringify(job("TMP9402", "STOP PROBE B")));
  await sleep(1200);
  assert.ok(!existsSync(join(Q, "job-b.processing")), "B (post-signal arrival) was NOT claimed");
  assert.ok(existsSync(join(Q, "job-b.json")), "B still queued as .json for the next activation");

  writeFileSync(barrier, "go");   // release A — in-flight work runs to its natural end
  assert.equal(await c.exited, 0, `graceful drain exits 0\n${c.log}`);
  assert.ok(existsSync(join(Q, "job-a.done")), "A (in flight at the signal) completed, not stranded");
  assert.ok(!existsSync(join(Q, "job-a.processing")) && !existsSync(join(Q, "job-a.processing.pid")),
    "no stranded .processing or live-looking sidecar");
  assert.ok(existsSync(join(Q, "job-b.json")) && !existsSync(join(Q, "job-b.done")), "B left for the next activation");
});

test("bounded grace: a stop that can't finish exits anyway; the cut claim RESUMES as the same codename next activation", async () => {
  const root = mkdtempSync(join(tmpdir(), "stop-grace-cut-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-a.json"), JSON.stringify(job("TMP9403", "STOP PROBE CUT")));
  const barrier = join(root, "release");
  const c = spawnRunner(envFor(root, { MOCK_BARRIER_FILE: barrier, CLEAROTRON_STOP_GRACE_MS: "800" }));
  const metaPath = join(Q, "job-a.processing.meta");
  assert.ok(await waitFor(() => existsSync(metaPath)), `A dispatched (identity persisted)\n${c.log}`);
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));

  // ── — THE GRACE CLOCK BOUNDS THE EXIT, AND NOTHING ELSE ─────────────────────────────────────
  // This arm reddened main on 2026-08-19 and passed again on the next commit with nobody touching it —
  // the failure that teaches a team to re-run rather than read. It was never flaky in the OBSERVATION.
  // `.processing.meta` lands at dispatch; the run dir is created later, inside pipeline(). Signalling
  // the instant the meta appeared started an 800 ms race between the grace timer and run-dir creation
  // on a shared CI runner, and when the timer won, parkInFlightForHuman had no dir to park (runner.mjs
  // `if (!owned …) continue`) — no `.parked`, and the scan below returned undefined. A slow runner and
  // a broken one produced the same red, which is what made it dismissible.
  //
  // So wait for the artifact, the way the assertion two lines up waits for the meta. Past this point
  // the run dir is on disk and the park has somewhere to write, and the 800 ms measures only the thing
  // it exists to measure: a grace that genuinely elapses with the barrier still unreleased. The two
  // claims are now separate — "the grace elapses and the process exits" is below, on the clock; "the
  // cut run is observable and says so" is here, on the artifact.
  const studio = join(root, "workspace-clawdi", "studio", "prelim-search");
  const findRunDir = () => {
    for (const slug of readFileSyncDirs(studio)) {
      const hit = readFileSyncDirs(join(studio, slug)).find((n) => n.endsWith(`-${meta.codename}`));
      if (hit) return join(studio, slug, hit);
    }
    return null;
  };
  assert.ok(await waitFor(() => findRunDir() !== null),
    `the run dir for ${meta.codename} is on disk BEFORE the stop — the grace exit has somewhere to park\n${c.log}`);
  const runDir = findRunDir();

  c.kill("SIGTERM");                       // barrier never releases within the grace window
  assert.equal(await c.exited, 1, `grace elapsed ⇒ exit anyway\n${c.log}`);
  assert.match(c.log, /grace window elapsed/, "the cut is loud");
  assert.ok(existsSync(join(Q, "job-a.processing")), "the cut claim stays .processing (dead claimer now)");

  // A5 — the cut run tells the truth about itself: `.parked` sentinel + status "parked-for-human",
  // instead of a status frozen at "running" with no process behind it (the zombie face in the 2026-07-28 postmortem).
  assert.ok(existsSync(join(runDir, ".parked")), ".parked sentinel written at the grace exit");
  const parkedStatus = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(parkedStatus.state, "parked-for-human", "status says WHY nothing is moving");
  assert.equal(parkedStatus.parkedKind, "grace-exit");

  // B6→B1 handshake: the next activation reads the identity meta and RESUMES — never a fresh mint.
  // The `.parked` sentinel is NON-BLOCKING by design: a systemd restart is the normal SIGTERM case,
  // so the resume needs no human — the resume guard clears the sentinel and the seed reopens the state.
  writeFileSync(barrier, "go");            // let the orphaned mock turn finish before the re-drain
  await sleep(700);
  const c2 = spawnRunner(envFor(root, { MOCK_BARRIER_FILE: barrier }));
  assert.equal(await c2.exited, 0, c2.log);
  assert.ok(existsSync(join(Q, "job-a.done")), `re-drain finished the cut run\n${c2.log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-a.done.result"), "utf8"));
  assert.ok(basename(res.runDir).endsWith(`-${meta.codename}`), `resumed the SAME codename: ${res.runDir} vs ${meta.codename}`);
  assert.ok(!existsSync(join(res.runDir, ".parked")), "the resume consumed the non-blocking .parked sentinel");
  assert.equal(JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8")).state, "delivered", "and the run ended in a real terminal state");
});

// tiny helper: readdir that returns [] instead of throwing (the studio may not exist in early asserts)
function readFileSyncDirs(dir) {
  try { return readdirSyncFs(dir); } catch { return []; }
}

test("second signal exits immediately, well inside the grace window", async () => {
  const root = mkdtempSync(join(tmpdir(), "stop-second-sig-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-a.json"), JSON.stringify(job("TMP9404", "STOP PROBE TWICE")));
  const barrier = join(root, "never-released");
  const c = spawnRunner(envFor(root, { MOCK_BARRIER_FILE: barrier, CLEAROTRON_STOP_GRACE_MS: "30000" }));
  assert.ok(await waitFor(() => existsSync(join(Q, "job-a.processing"))), `A claimed\n${c.log}`);

  c.kill("SIGTERM");
  assert.ok(await waitFor(() => /graceful stop/.test(c.log), 5000), `first signal handled\n${c.log}`);
  const t0 = Date.now();
  c.kill("SIGTERM");
  assert.equal(await c.exited, 1, `second signal exits hard\n${c.log}`);
  assert.ok(Date.now() - t0 < 5000, "exit came from the second signal, not the 30s grace timer");
  assert.match(c.log, /second SIGTERM — exiting immediately/);
});
