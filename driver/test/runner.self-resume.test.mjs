// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner through a postponed-orphan self-resume
// Self-resume for run-dir POSTPONED orphans (#5). A run resumed MANUALLY (node pipeline.mjs --resume) writes a
// run-dir `.postponed` sentinel with NO queue sidecars, so the queue's claimDuePostponed never sees it — pre-fix
// it sat indefinitely. scanDueRunDirOrphans() finds the DUE, payload-complete ones across EVERY agent studio,
// and skips: not-due (backoff window open), pre-fix sentinels (no resume payload), and already-terminal runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// set the workspace root BEFORE driver.config.mjs loads (via the dynamic runner import below), so config.workspaceRoot freezes to our temp dir
const ROOT = mkdtempSync(join(tmpdir(), "prelim-resume-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const mkRun = (agent, slug, run) => {
  const d = join(ROOT, `workspace-${agent}`, "studio", "prelim-search", slug, run);
  mkdirSync(d, { recursive: true });
  return d;
};
const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 3_600_000).toISOString();
const payload = (extra) => JSON.stringify({ resetsAt: past, fromStage: "register-unit", codename: "x", job: { markName: "M", classes: [9] }, agent: "clawdi", ...extra });

test("scanDueRunDirOrphans: DUE payload-complete orphans across agents; skips not-due / pre-fix / terminal", async () => {
  // (1) DUE + full payload (resetsAt in the past) → FOUND
  writeFileSync(join(mkRun("clawdi", "mark-a", "2026-06-25-jade"), ".postponed"), payload({ codename: "jade" }));
  // (2) not due (resetsAt in the future) → skipped
  writeFileSync(join(mkRun("clawdi", "mark-b", "2026-06-25-ruby"), ".postponed"), payload({ codename: "ruby", resetsAt: future }));
  // (3) pre-fix sentinel (no job/agent payload) → skipped (left for manual handling, never a bad pipeline call)
  writeFileSync(join(mkRun("clawdi", "mark-c", "2026-06-25-opal"), ".postponed"), JSON.stringify({ resetsAt: past, codename: "opal" }));
  // (4) already terminal (.delivered present) → skipped (the run moved on after the sentinel was written)
  const done = mkRun("clawdi", "mark-d", "2026-06-25-onyx");
  writeFileSync(join(done, ".postponed"), payload({ codename: "onyx" }));
  writeFileSync(join(done, ".delivered"), "{}");
  // (5) being-resumed (.resuming present) → skipped (another tick/runner already claimed it)
  const claimed = mkRun("clawdi", "mark-f", "2026-06-25-topaz");
  writeFileSync(join(claimed, ".postponed"), payload({ codename: "topaz" }));
  writeFileSync(join(claimed, ".resuming"), "{}");
  // (6) a DIFFERENT agent's studio is scanned too (the multi-agent footgun the queueDirs getter also fixes)
  writeFileSync(join(mkRun("agent-a", "mark-e", "2026-06-25-pearl"), ".postponed"), payload({ codename: "pearl", agent: "agent-a" }));

  const { scanDueRunDirOrphans } = await import("../runner.mjs");
  const found = scanDueRunDirOrphans().map((o) => o.codename).sort();
  assert.deepEqual(found, ["jade", "pearl"], `expected only DUE payload-complete orphans across agents, got: ${found.join(", ")}`);
  // the found ones carry the self-contained resume payload pipeline() needs
  const jade = scanDueRunDirOrphans().find((o) => o.codename === "jade");
  assert.equal(jade.agent, "clawdi");
  assert.equal(jade.fromStage, "register-unit");
  assert.deepEqual(jade.job, { markName: "M", classes: [9] });
});

// Repair-first phase 2: a resume that THROWS re-parks with a counted `reparks` (payload preserved) and
// goes terminal (.failed + status) at the cap — a persistent infra error can no longer loop at tick
// cadence forever, invisibly.
test("resumeRunDirOrphans: throwing resume re-parks with a reparks count, terminal .failed at the cap", async () => {
  const { resumeRunDirOrphans } = await import("../runner.mjs");
  const boom = async () => { throw new Error("EACCES: studio path unwritable"); };

  const runDir = mkRun("clawdi", "mark-g", "2026-07-05-flint");
  const mkOrphan = (reparks) => {
    // each iteration needs a fresh claimable sentinel (the function renames .postponed → .resuming).
    // Post-A4-split shape: a recovery sentinel carries recoveryResumesAt (never resetsAt) — by the time
    // the watcher fires and the resume throws, that clock is already in the PAST.
    const payload = { kind: "recovery", recoveryResumesAt: past, postponedAt: past, codename: "flint", job: { markName: "M", classes: [9] }, agent: "clawdi", attempt: 1, sig: "x|abc", reparks };
    writeFileSync(join(runDir, ".postponed"), JSON.stringify(payload));
    try { rmSync(join(runDir, ".resuming"), { force: true }); } catch { /* fresh */ }
    return { runDir, sentPath: join(runDir, ".postponed"), job: payload.job, agent: "clawdi", codename: "flint", fromStage: null, reparks, payload };
  };

  // reparks 0 → re-parked with reparks 1, original payload fields preserved, no terminal
  await resumeRunDirOrphans([mkOrphan(0)], { runPipeline: boom });
  const reparked = JSON.parse(readFileSync(join(runDir, ".postponed"), "utf8"));
  assert.equal(reparked.reparks, 1);
  assert.equal(reparked.kind, "recovery", "original sentinel payload survives the re-park");
  assert.equal(reparked.sig, "x|abc");
  assert.ok(!existsSync(join(runDir, ".failed")), "not terminal below the cap");
  // BOTH due-clock keys must be nulled: a surviving past recoveryResumesAt would make postponedDueAt
  // read the re-park as due NOW, burning every REPARK_MAX attempt at tick cadence with no backoff —
  // the fresh backoff must run from postponedAt.
  assert.equal(reparked.resetsAt, null, "rate-limit clock nulled on re-park");
  assert.equal(reparked.recoveryResumesAt, null, "recovery clock nulled too — the spread must not resurrect it");
  const { postponedDueAt } = await import("../runner.mjs");
  const BACKOFF = 30 * 60_000;
  assert.equal(postponedDueAt(reparked, BACKOFF), Date.parse(reparked.postponedAt) + BACKOFF,
    "the re-park is due at postponedAt + backoff, not at the stale recovery clock");

  // reparks 2 → third error hits the cap → .failed + status patched, sentinel consumed
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ state: "recovering", codename: "flint" }));
  await resumeRunDirOrphans([mkOrphan(2)], { runPipeline: boom });
  assert.ok(existsSync(join(runDir, ".failed")), "terminal at the cap");
  const failed = JSON.parse(readFileSync(join(runDir, ".failed"), "utf8"));
  assert.equal(failed.reparks, 3);
  assert.match(failed.reason, /self-resume errored 3×/);
  assert.match(failed.reason, /EACCES/, "the last error is quoted, not paraphrased");
  const status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(status.state, "failed");
  assert.equal(status.failedStage, "self-resume");
  assert.ok(!existsSync(join(runDir, ".postponed")), "no further re-park at the cap");
});
