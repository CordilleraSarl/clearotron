// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real runner through a postponed-orphan self-resume
// Self-resume for run-dir POSTPONED orphans (#5). A run resumed MANUALLY (node pipeline.mjs --resume) writes a
// run-dir `.postponed` sentinel with NO queue sidecars, so the queue's claimDuePostponed never sees it — pre-fix
// it sat indefinitely. scanDueRunDirOrphans() finds the DUE, payload-complete ones across EVERY agent studio,
// and skips: not-due (backoff window open), pre-fix sentinels (no resume payload), and already-terminal runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { startedOnThisBuild } from "./started-on-this-build.mjs";   // the row a run writes when it starts

// set the workspace root BEFORE driver.config.mjs loads (via the dynamic runner import below), so config.workspaceRoot freezes to our temp dir
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-resume-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";

const mkRun = (agent, slug, run) => {
  const d = join(ROOT, `workspace-${agent}`, "studio", "clearance-search", slug, run);
  mkdirSync(d, { recursive: true });
  return startedOnThisBuild(d);
};
const past = new Date(Date.now() - 60_000).toISOString();
const future = new Date(Date.now() + 3_600_000).toISOString();
const payload = (extra) => JSON.stringify({ resetsAt: past, fromStage: "register-unit", codename: "x", job: { markName: "M", classes: [9] }, agent: "mailagent", ...extra });

test("scanDueRunDirOrphans: DUE payload-complete orphans across agents; skips not-due / pre-fix / terminal", async () => {
  // (1) DUE + full payload (resetsAt in the past) → FOUND
  writeFileSync(join(mkRun("mailagent", "mark-a", "2026-06-25-jade"), ".postponed"), payload({ codename: "jade" }));
  // (2) not due (resetsAt in the future) → skipped
  writeFileSync(join(mkRun("mailagent", "mark-b", "2026-06-25-ruby"), ".postponed"), payload({ codename: "ruby", resetsAt: future }));
  // (3) pre-fix sentinel (no job/agent payload) → skipped (left for manual handling, never a bad pipeline call)
  writeFileSync(join(mkRun("mailagent", "mark-c", "2026-06-25-opal"), ".postponed"), JSON.stringify({ resetsAt: past, codename: "opal" }));
  // (4) already terminal (.delivered present) → skipped (the run moved on after the sentinel was written)
  const done = mkRun("mailagent", "mark-d", "2026-06-25-onyx");
  writeFileSync(join(done, ".postponed"), payload({ codename: "onyx" }));
  writeFileSync(join(done, ".delivered"), "{}");
  // (5) being-resumed (.resuming present) → skipped (another tick/runner already claimed it)
  const claimed = mkRun("mailagent", "mark-f", "2026-06-25-topaz");
  writeFileSync(join(claimed, ".postponed"), payload({ codename: "topaz" }));
  writeFileSync(join(claimed, ".resuming"), "{}");
  // (6) a DIFFERENT agent's studio is scanned too (the multi-agent footgun the queueDirs getter also fixes)
  writeFileSync(join(mkRun("agent-a", "mark-e", "2026-06-25-pearl"), ".postponed"), payload({ codename: "pearl", agent: "agent-a" }));

  const { scanDueRunDirOrphans } = await import("../runner.mjs");
  const found = scanDueRunDirOrphans().map((o) => o.codename).sort();
  assert.deepEqual(found, ["jade", "pearl"], `expected only DUE payload-complete orphans across agents, got: ${found.join(", ")}`);
  // the found ones carry the self-contained resume payload pipeline() needs
  const jade = scanDueRunDirOrphans().find((o) => o.codename === "jade");
  assert.equal(jade.agent, "mailagent");
  assert.equal(jade.fromStage, "register-unit");
  assert.deepEqual(jade.job, { markName: "M", classes: [9] });
});

// Repair-first phase 2: a resume that THROWS re-parks with a counted `reparks` (payload preserved) and
// goes terminal (.failed + status) at the cap — a persistent infra error can no longer loop at tick
// cadence forever, invisibly.
test("resumeRunDirOrphans: throwing resume re-parks with a reparks count, terminal .failed at the cap", async () => {
  const { resumeRunDirOrphans } = await import("../runner.mjs");
  const boom = async () => { throw new Error("EACCES: studio path unwritable"); };

  const runDir = mkRun("mailagent", "mark-g", "2026-07-05-flint");
  const mkOrphan = (reparks) => {
    // each iteration needs a fresh claimable sentinel (the function renames .postponed → .resuming).
    // Post-A4-split shape: a recovery sentinel carries recoveryResumesAt (never resetsAt) — by the time
    // the watcher fires and the resume throws, that clock is already in the PAST.
    const payload = { kind: "recovery", recoveryResumesAt: past, postponedAt: past, codename: "flint", job: { markName: "M", classes: [9] }, agent: "mailagent", attempt: 1, sig: "x|abc", reparks };
    writeFileSync(join(runDir, ".postponed"), JSON.stringify(payload));
    try { rmSync(join(runDir, ".resuming"), { force: true }); } catch { /* fresh */ }
    return { runDir, sentPath: join(runDir, ".postponed"), job: payload.job, agent: "mailagent", codename: "flint", fromStage: null, reparks, payload };
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

// A RUN THAT PARKS AFTER IT PUBLISHED IS RESUMED LIKE ANY OTHER PARK.
//
// A run publishes, then fails in a later delivery step (the email compose, the packet write) and parks for recovery.
// Its folder holds `.published` and, newer, `.postponed`. The watcher read `.published` as "this run moved on" and
// never resumed it, so the run sat parked with its report published and no notice sent. Only a park older than the
// publish means that: a resume deletes the park it resumes, so such a park is stale.
test("scanDueRunDirOrphans: a park written after the publish is resumed; a park older than the publish is not", async () => {
  const { scanDueRunDirOrphans, publishedSincePark } = await import("../runner.mjs");
  const at = (path, ms) => utimesSync(path, new Date(ms), new Date(ms));
  const now = Date.now();

  const after = mkRun("mailagent", "mark-h", "2026-11-10-cobalt");
  writeFileSync(join(after, ".published"), "{}"); at(join(after, ".published"), now - 120_000);
  writeFileSync(join(after, ".postponed"), payload({ codename: "cobalt" })); at(join(after, ".postponed"), now - 60_000);

  const before = mkRun("mailagent", "mark-i", "2026-11-10-garnet");
  writeFileSync(join(before, ".postponed"), payload({ codename: "garnet" })); at(join(before, ".postponed"), now - 120_000);
  writeFileSync(join(before, ".published"), "{}"); at(join(before, ".published"), now - 60_000);

  const found = scanDueRunDirOrphans().map((o) => o.codename);
  assert.ok(found.includes("cobalt"), `the run that parked after publishing was not resumed: ${found.join(", ")}`);
  assert.equal(found.includes("garnet"), false, "a park older than the publish is stale, and stays where it is");

  assert.equal(publishedSincePark(join(after, ".nothing-here"), join(after, ".postponed")), false, "no publish, nothing to compare");
  assert.equal(publishedSincePark(join(after, ".published"), join(after, ".no-park")), true, "an unreadable time reads as moved on");
});
