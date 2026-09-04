// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner over a whole queued backlog (admission budget)
// Admission-budget guard (C3 companion). TimeoutStartSec is a WEDGE-ONLY ceiling solely because the
// runner bounds its own honest wall time: the oneshot activation drains the whole backlog through the
// continuous-admission loop, so without a cutoff a multi-job backlog (~1.5h+/run; one observed gather
// member alone ~2h26m) legitimately crosses any finite ceiling and systemd SIGKILLs mid-run — pre-B1
// that converts into a fresh-codename full re-spend with the historical double-report tail. This proves
// that past CLEAROTRON_ADMISSION_BUDGET_MS the drain loop STOPS claiming newly-arrived jobs, finishes what's
// already in flight, and exits leaving the unclaimed *.json in the queue — exactly what lets the .path
// glob retrigger a fresh activation (fresh TimeoutStartSec clock) instead of the ceiling killing us.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider, so the
// production call ledger can never evidence their bands; the dedicated band-truth-gate tests turn it ON.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const queueFor = (root, agentId) => join(root, `workspace-${agentId}`, "studio", "prelim-search", "queue");
const jobJson = (ref) => JSON.stringify({
  id: `bud-${ref}`, msgId: `<bud-${ref}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
  ref, markName: "BUDGET PROBE", classes: [9], provider: "corsearch",
});
const until = async (pred, { timeoutMs = 8000, stepMs = 50 } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("admission budget: past the budget the drain stops claiming NEW jobs, finishes in-flight work, and leaves the queue for the next activation", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-budget-"));
  const barrier = join(root, "release-barrier");
  const BUDGET_MS = 3000; // generous enough that A is claimed while admission is still open, tiny enough to elapse in-test
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_BARRIER_FILE: barrier, CLEAROTRON_MAX_CONCURRENT_RUNS: "2", CLEAROTRON_QUEUE_SCAN_MS: "100",
    CLEAROTRON_ADMISSION_BUDGET_MS: String(BUDGET_MS),
  })) pinEnv(process.env, k, v);

  const Q = queueFor(root, "clawdi");
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-a.json"), jobJson("TMP-BUD-A"));  // only A is queued when the drain starts

  try {
    const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
    const t0 = Date.now();
    const done = main({ once: true });   // do NOT await — A blocks at the matter-frame barrier

    // — see runner.admission: the first run-dependent wait is where an absent
    // precondition surfaces, and the check at the await point below is too late to protect it.
    const aClaimed = await until(() => existsSync(join(Q, "job-a.processing")));
    if (!aClaimed) refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.admission-budget.test.mjs");
    assert.ok(aClaimed, "A claimed while admission was open");
    // Let the budget elapse (deadline is armed at main() start, so t0 + BUDGET is an upper bound), THEN drop B.
    await sleep(Math.max(0, t0 + BUDGET_MS - Date.now()) + 600);
    writeFileSync(join(Q, "job-b.json"), jobJson("TMP-BUD-B"));
    // KEY ASSERTION: with A still in flight the loop keeps re-scanning every 100ms, yet B must NOT be
    // claimed — admission is closed. (In the pre-fix runner this claim happens within a scan tick or two;
    // 1.2s ≈ 12 ticks of proof.)
    await sleep(1200);
    assert.ok(!existsSync(join(Q, "job-b.processing")), "B (post-budget arrival) was NOT claimed by this activation");
    assert.ok(existsSync(join(Q, "job-b.json")), "B still sits in the queue as .json (visible to the .path glob for the NEXT activation)");

    writeFileSync(barrier, "go");   // release A — in-flight work always runs to completion
    await done;                     // exits instead of waiting on B: the next activation owns it
    // — BEFORE the assertions below. A run that never started leaves its
    // reason in the packets beside the queue; without this the counts below report it as a
    // product defect.
    refuseOnPreRunFailure(join(root, "prelim-outbox"), "runner.admission-budget.test.mjs");

    assert.ok(existsSync(join(Q, "job-a.done")), "A (in flight at cutoff) was finished, not abandoned");
    assert.ok(existsSync(join(Q, "job-b.json")) && !existsSync(join(Q, "job-b.processing")) && !existsSync(join(Q, "job-b.done")),
      "B left untouched for the retriggered activation");
  } finally {
    delete process.env.MOCK_BARRIER_FILE;
    delete process.env.CLEAROTRON_ADMISSION_BUDGET_MS;
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
