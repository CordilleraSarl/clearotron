// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Offline unit tests for progress.mjs (status writer + display mapping) and the chat roster the
// delivery packet's routing key comes from. PURE CODE — no gateway, no billing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DISPLAY_STEPS, stepForStage, writeRunStatus, rollupStatus, seedRunStatus, recordTransition, lineFor, finalStepFields, STAGE_TO_STEP, STAGE_NO_STEP, NON_STAGE_STEPS } from "../progress.mjs";
import { STAGES, AGENT_WHATSAPP, STAGE_ORDER, STAGE_ORDER_EXCLUDED } from "../stages.mjs";

test("finalStepFields is the terminal display step — what every delivered status write must carry (charter P1 §4)", () => {
  // Lifecycle honesty: handoff mode runs no notify stages and publish is code, so the DELIVERED write is
  // the only thing that can finish the stepper — 7/9-on-a-delivered-run was the shipped bug.
  assert.deepEqual(finalStepFields(), {
    stepIndex: DISPLAY_STEPS.length - 1,
    stepLabel: DISPLAY_STEPS[DISPLAY_STEPS.length - 1],
    stepN: DISPLAY_STEPS.length,
    stepTotal: DISPLAY_STEPS.length,
  });
  assert.equal(finalStepFields().stepN, 9, "the clearance sequence ends at 9/9");
});

test("stepForStage maps real stage keys onto the 9-step display sequence", () => {
  assert.equal(DISPLAY_STEPS.length, 9);
  assert.equal(stepForStage("matter-frame").index, 0);
  assert.equal(stepForStage("register-unit").index, 1);
  assert.equal(stepForStage("register-unit:primary-sweep").index, 1, "axis suffix collapses to one step");
  assert.equal(stepForStage("skeptic").index, 3);
  assert.equal(stepForStage("notify").index, 8);
  assert.equal(stepForStage("notify").n, 9, "n is 1-based");
  assert.equal(stepForStage("notify").total, 9);
  assert.equal(stepForStage("unknown-stage"), null, "unmapped key is a no-op");
  assert.equal(stepForStage("notify-fail-chat"), null, "failure ping never advances the stepper");
});

test("writeRunStatus keeps the displayed step monotonic (escalation re-run does not regress it)", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-mono-"));
  const runDir = join(studioRoot, "tmp1-x", "2026-06-02-teal-spire");
  mkdirSync(runDir, { recursive: true });
  const ctx = { run: { runDir, studioRoot } };

  const at = (k) => ({ stepIndex: stepForStage(k).index, stepLabel: stepForStage(k).label, stepN: stepForStage(k).n, stepTotal: stepForStage(k).total });
  writeRunStatus(ctx, at("synthesis"));        // step 5 (index 4)
  writeRunStatus(ctx, at("register-unit"));    // escalation re-run → step 2 (index 1)
  const s = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(s.stepIndex, 4, "step did not regress");
  assert.equal(s.stepLabel, "Synthesis", "label tracks the kept index");
  assert.equal(s.stepN, 5);
});

test("rollupStatus builds STATUS.md: newest-first, running/delivered/failed lines", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-roll-"));
  const mk = (rel, obj) => {
    const d = join(studioRoot, rel);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "status.json"), JSON.stringify(obj) + "\n");
  };
  // delivered (oldest), running (newest), failed (middle) — interleave updatedAt to test sort
  mk("archive/2026-06/tmp2-nebula/2026-06-01-marble-gantry", {
    runId: "tmp2-nebula-2026-06-01-marble-gantry", ref: "TMP8402", markName: "NEBULA",
    state: "delivered", verdict: "CONDITIONAL", url: "https://trademark.example.com/x/report.html",
    updatedAt: "2026-06-01T10:00:00Z",
  });
  mk("tmp1-novapulse/2026-06-02-teal-spire", {
    runId: "tmp1-novapulse-2026-06-02-teal-spire", ref: "TMP8439", markName: "PROJECT NOVAPULSE",
    state: "running", stepIndex: 4, stepLabel: "Synthesis", stepN: 5, stepTotal: 9,
    updatedAt: "2026-06-02T14:00:00Z",
  });
  mk("tmp3-oryx/2026-06-02-quartz-foundry", {
    runId: "tmp3-oryx-2026-06-02-quartz-foundry", ref: "TMP8388", markName: "ORYX",
    state: "failed", failedStage: "register-digest", reason: "timeout",
    updatedAt: "2026-06-02T09:00:00Z",
  });
  // rate-limit POSTPONE (oldest updatedAt → sorts last, keeps the running line at [0]) — must render as a
  // distinct ⏸ paused line carrying its auto-resume time, NEVER as "running".
  mk("tmp4-bioveltrin/2026-05-31-marble-conduit", {
    runId: "tmp4-bioveltrin-2026-05-31-marble-conduit", ref: "TMP8500", markName: "BIOVELTRIN",
    state: "postponed", lastStage: "register-digest", resetsAt: "2026-06-22T23:30:00Z",
    stepN: 4, stepTotal: 9, stepLabel: "Skeptic review",
    updatedAt: "2026-05-31T10:00:00Z",
  });

  rollupStatus(studioRoot);
  const md = readFileSync(join(studioRoot, "STATUS.md"), "utf8");
  const lines = md.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 4);
  assert.match(lines[0], /TMP8439 PROJECT NOVAPULSE — step 5\/9 Synthesis — running/, "newest (running) first");
  assert.ok(lines.some((l) => /TMP8402 NEBULA — delivered \(CONDITIONAL\) — https:/.test(l)), "delivered line w/ verdict+url");
  assert.ok(lines.some((l) => /TMP8388 ORYX — ⚠️ FAILED at register-digest — timeout/.test(l)), "failed line w/ stage+reason");
  assert.ok(lines.some((l) => /TMP8500 BIOVELTRIN — ⏸ POSTPONED \(usage-limit cap\) at register-digest — resumes 2026-06-22 23:30 UTC/.test(l)), "postponed line w/ pause marker + resume time");
});

// A run wedged at "running" with no sentinel and no process (a SIGKILLed driver, an aborted lane) is
// cleared by the presentation retire: one key on status.json, never by rewriting `state`. The ops snapshot
// honoured it; STATUS.md did not, so the stale row outlived the cleanup on the surface the agent reads.
test("rollupStatus hides retired runs — and a retired row never costs a live run its slot", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-retired-"));
  const mk = (rel, obj) => {
    const d = join(studioRoot, rel);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "status.json"), JSON.stringify(obj) + "\n");
  };
  // The stale one is NEWEST, so an unfiltered rollup would put it at the top of the list.
  mk("norefabc-aquaplus/2026-07-16-quartz-spire", {
    runId: "norefabc-aquaplus-2026-07-16-quartz-spire", ref: null, markName: "AquaPlus",
    state: "running", stepN: 4, stepTotal: 9, stepLabel: "Skeptic review",
    retired: true, updatedAt: "2026-07-16T14:54:47Z",
  });
  mk("tmp9-livemark/2026-07-15-teal-spire", {
    runId: "tmp9-livemark-2026-07-15-teal-spire", ref: "TMP9001", markName: "LIVEMARK",
    state: "running", stepN: 2, stepTotal: 9, stepLabel: "Register sweeps",
    updatedAt: "2026-07-15T09:00:00Z",
  });

  rollupStatus(studioRoot);
  const lines = readFileSync(join(studioRoot, "STATUS.md"), "utf8").split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 1, "the retired run claims no line");
  assert.match(lines[0], /TMP9001 LIVEMARK/, "the live run is what remains");
  assert.doesNotMatch(lines.join("\n"), /AquaPlus/, "no trace of the retired run");
});

test("rollupStatus still shows runs that carry retired:false or no flag at all", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-unretired-"));
  const mk = (rel, obj) => {
    const d = join(studioRoot, rel);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "status.json"), JSON.stringify(obj) + "\n");
  };
  mk("tmp1-a/2026-07-15-a", { runId: "a", ref: "TMP1", markName: "ALPHA", state: "running", retired: false, updatedAt: "2026-07-15T09:00:00Z" });
  mk("tmp2-b/2026-07-14-b", { runId: "b", ref: "TMP2", markName: "BETA", state: "running", updatedAt: "2026-07-14T09:00:00Z" });

  rollupStatus(studioRoot);
  const md = readFileSync(join(studioRoot, "STATUS.md"), "utf8");
  assert.match(md, /TMP1 ALPHA/);
  assert.match(md, /TMP2 BETA/);
});

test("seed + recordTransition write an answerable status from the first moment", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-seed-"));
  const runDir = join(studioRoot, "tmp9-aurora", "2026-06-02-copper-spire");
  mkdirSync(runDir, { recursive: true });
  const ctx = {
    run: { runDir, studioRoot, slug: "tmp9-aurora", codename: "copper-spire", date: "2026-06-02" },
    job: { id: "j9", forwarder: "requester", ref: "TMP9001", markName: "AURORA", classes: [9] },
    agent: "clawdi",
  };
  seedRunStatus(ctx);
  let s = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(s.state, "running");
  assert.equal(s.stepIndex, 0, "seeded at the first step");
  assert.equal(s.markName, "AURORA");
  recordTransition(ctx, "register-unit:primary-sweep");
  s = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(s.stepIndex, 1, "transition advanced the step");
  assert.equal(s.lastStage, "register-unit:primary-sweep");
});

// — TWO ARMS FOR THE CHAT-PING STAGES SAT HERE AND GO WITH THEM. They checked that each send
// stage's message resolved the agent's bound number out of AGENT_WHATSAPP and interpolated the mark,
// ref, verdict and URL. The roster survives and is still exercised below; what it feeds is now a
// packet FIELD (`whatsappTo`) rather than a dictated line in a prompt, so the fact those arms pinned
// is asserted where the packet is built rather than where a message was composed.
test("the chat roster still resolves an agent to its bound number — the packet's routing key", () => {
  assert.equal(AGENT_WHATSAPP["clawdi-alex"], "+10000000002", "the demo roster is still keyed by agent id");
  assert.equal(AGENT_WHATSAPP["clawdi"], "+10000000001");
});

// ── 2026-07-04 incident: the rollup must carry the send state — the completion-watch's primary source ──
test("lineFor: sendPending renders LOUDLY on delivered AND failed rows; flips off with the flag", () => {
  const del = { ref: "TMP1", markName: "X", state: "delivered", verdict: "CLEAR", url: "https://x/report.html", sendPending: true };
  assert.match(lineFor(del), /📮 SEND PENDING \(email\/WhatsApp NOT yet out — run prelim-deliver\)/);
  assert.doesNotMatch(lineFor({ ...del, sendPending: false }), /SEND PENDING/);
  const failed = { ref: null, markName: "VENZY", state: "failed", failedStage: "synthesis(blocking)", reason: "x", sendPending: true };
  assert.match(lineFor(failed), /⚠️ FAILED at synthesis\(blocking\)/);
  assert.match(lineFor(failed), /📮 FAILURE NOTICE PENDING \(run prelim-deliver\)/);
  assert.doesNotMatch(lineFor({ ...failed, sendPending: undefined }), /PENDING \(run prelim-deliver\)/);
});

test("lineFor: a recovering run renders loudly as AUTO-RECOVERY — never readable as settled", () => {
  const r = { ref: "TMP9", markName: "VENZY", state: "recovering", recoveryAttempts: 1, recoveryMax: 3, failedStage: "synthesis(blocking)", resetsAt: "2026-07-04T11:00:00.000Z" };
  const line = lineFor(r);
  assert.match(line, /🔄 AUTO-RECOVERY \(attempt 1\/3\) at synthesis\(blocking\)/);
  assert.match(line, /resumes 2026-07-04 11:00 UTC/);
  assert.match(line, /report still owed/);
});

// ── B5: atomicWrite is the ONE replace idiom for driver-owned state (findings.json, sentinels,
// front-matter, escalation-state route through it from pipeline.mjs) — a reader must see the old
// complete file or the new one, NEVER a truncation, and a failed writer must not strand its tmp. ──
import { atomicWrite } from "../progress.mjs";
import { readdirSync } from "node:fs";

test("atomicWrite: replaces the target in place and leaves no tmp debris", () => {
  const dir = mkdtempSync(join(tmpdir(), "prog-atomic-"));
  const file = join(dir, "findings.json");
  writeFileSync(file, '{"old":true}\n');
  atomicWrite(file, '{"new":true}\n');
  assert.equal(readFileSync(file, "utf8"), '{"new":true}\n');
  assert.deepEqual(readdirSync(dir), ["findings.json"], "the sibling tmp was renamed away, not left behind");
});

test("atomicWrite crash-window: a writer dead BEFORE its rename leaves the old complete version visible", () => {
  const dir = mkdtempSync(join(tmpdir(), "prog-atomic-"));
  const file = join(dir, "findings.json");
  writeFileSync(file, '{"old":true}\n');
  // simulate the kill window: the tmp was written (possibly truncated) but the process died pre-rename —
  // exactly what a plain writeFileSync(file, …) would instead expose as a half-written target.
  writeFileSync(`${file}.4242.zz.tmp`, '{"trunc');
  assert.equal(readFileSync(file, "utf8"), '{"old":true}\n', "the reader still sees the old COMPLETE version");
  // a later writer lands normally over the debris
  atomicWrite(file, '{"new":true}\n');
  assert.equal(readFileSync(file, "utf8"), '{"new":true}\n');
});

test("atomicWrite crash-window: the CANONICAL grid-spec.json is never seen torn (old-complete or new-complete)", () => {
  // pipeline.mjs routes the canonical _driver/grid-spec.json write through atomicWrite (like the HALF
  // specs), so the fail-closed validator/receipts join never observes a truncated grid-spec: a writer
  // killed mid-write strands a tmp, and the reader still sees the OLD complete spec until the rename.
  const dir = mkdtempSync(join(tmpdir(), "prog-gridspec-"));
  const file = join(dir, "grid-spec.json");
  const oldSpec = '{"terms":["ALPHA"],"platforms":["web"],"ledger_required":true}\n';
  writeFileSync(file, oldSpec);
  // crash window: the tmp was written (truncated) but the process died pre-rename.
  writeFileSync(`${file}.7777.aa.tmp`, '{"terms":["ALP');
  assert.equal(readFileSync(file, "utf8"), oldSpec, "the reader still sees the OLD complete spec, never the torn tmp");
  atomicWrite(file, '{"terms":["ALPHA","BETA"],"platforms":["web"],"ledger_required":true}\n');
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).terms, ["ALPHA", "BETA"], "a later writer lands the NEW complete spec");
});

test("atomicWrite: a failed rename cleans up its tmp and rethrows", () => {
  const dir = mkdtempSync(join(tmpdir(), "prog-atomic-"));
  const target = join(dir, "occupied");
  mkdirSync(join(target, "child"), { recursive: true });   // rename(file → non-empty dir) always fails
  assert.throws(() => atomicWrite(target, "x"), /ENOTDIR|EISDIR|ENOTEMPTY/);
  assert.deepEqual(readdirSync(dir), ["occupied"], "no tmp stranded after the failure");
});

// ---- A3 (2026-07-28 postmortem): startedAt is append-only BY DELETION; resumes record themselves --------------

test("seedRunStatus: a fresh run gets startedAt from the first-write backfill, attempts 1, no resumedAt", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-seed-"));
  const runDir = join(studioRoot, "tmp1-x", "2026-07-28-teal-arch");
  mkdirSync(runDir, { recursive: true });
  const ctx = { job: { id: "j1", forwarder: "jordan" }, run: { runDir, studioRoot, slug: "tmp1-x", date: "2026-07-28", codename: "teal-arch" }, agent: "clawdi" };
  seedRunStatus(ctx);
  const s = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(s.startedAt, s.updatedAt, "backfilled from the seed write itself");
  assert.equal(s.attempts, 1);
  assert.equal(s.resumedAt, undefined);
  assert.equal(s.__stateReset, undefined, "the reset flag is consumed, never persisted");
});

test("seedRunStatus on RESUME: startedAt survives untouched (the last-resume lie), resumedAt + attempts recorded, terminal state reopened", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-resume-"));
  const runDir = join(studioRoot, "tmp1-x", "2026-07-28-teal-arch");
  mkdirSync(runDir, { recursive: true });
  const ctx = { job: { id: "j1", forwarder: "jordan" }, run: { runDir, studioRoot, slug: "tmp1-x", date: "2026-07-28", codename: "teal-arch" }, agent: "clawdi" };
  seedRunStatus(ctx);
  const first = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  // the run fails terminally; a human/reclaim resume follows (the guard cleared .failed and threads reset)
  writeRunStatus(ctx, { state: "failed", failedStage: "synthesis", reason: "x" });
  seedRunStatus(ctx, { resume: true });
  const s = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  assert.equal(s.startedAt, first.startedAt, "startedAt is append-only — the resume did NOT re-stamp it");
  assert.equal(s.attempts, 2, "each resume increments attempts");
  assert.ok(typeof s.resumedAt === "string" && s.resumedAt >= first.startedAt, "the resume records its own clock separately");
  assert.equal(s.state, "running", "__stateReset (threaded by the resume guard) reopened the terminal state");
  assert.equal(s.__stateReset, undefined, "the reset flag is consumed, never persisted");
  // a second resume keeps counting
  seedRunStatus(ctx, { resume: true });
  assert.equal(JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).attempts, 3);
});

// ---- A5 (2026-07-28 postmortem): `state` joins the monotonic guard --------------------------------------------

test("writeRunStatus: a terminal state is never overwritten by a stray writer — only __stateReset reopens it", () => {
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-guard-"));
  const runDir = join(studioRoot, "tmp1-x", "2026-07-28-teal-arch");
  mkdirSync(runDir, { recursive: true });
  const ctx = { run: { runDir, studioRoot } };
  for (const terminal of ["delivered", "failed", "cancelled"]) {
    writeRunStatus(ctx, { state: terminal, __stateReset: true });   // reach the terminal (reset clears the previous loop's terminal)
    writeRunStatus(ctx, { state: "running", stepIndex: 6 });        // the zombie write — a lingering pass
    const s = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
    assert.equal(s.state, terminal, `${terminal} survived a stray "running" write`);
    assert.equal(s.stepIndex, 6, "non-state fields still merge — only the state is guarded");
  }
  writeRunStatus(ctx, { state: "running", __stateReset: true });
  assert.equal(JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).state, "running", "a deliberate resume reopens it");
  // parked-for-human is NOT terminal: the normal deploy-restart resume must overwrite it without ceremony
  writeRunStatus(ctx, { state: "parked-for-human", parkedKind: "grace-exit" });
  writeRunStatus(ctx, { state: "running" });
  assert.equal(JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")).state, "running");
});

// ---- A4 field split + parked wording in the rollup --------------------------------------------------

test("lineFor: recovering reads recoveryResumesAt (resetsAt only as the pre-split fallback); parked-for-human renders loudly", () => {
  const rec = { ref: "TMP9", markName: "VENZY", state: "recovering", recoveryAttempts: 1, recoveryMax: 3, failedStage: "synthesis", recoveryResumesAt: "2026-07-28T15:00:00.000Z" };
  assert.match(lineFor(rec), /resumes 2026-07-28 15:00 UTC/);
  const legacy = { ...rec, recoveryResumesAt: undefined, resetsAt: "2026-07-28T16:00:00.000Z" };
  assert.match(lineFor(legacy), /resumes 2026-07-28 16:00 UTC/, "a pre-split run still shows its clock");
  const parked = { ref: "TMP9", markName: "VENZY", state: "parked-for-human", parkedKind: "grace-exit", lastStage: "register-digest", stepN: 3, stepTotal: 9, stepLabel: "Placement & digest" };
  const line = lineFor(parked);
  assert.match(line, /PARKED/);
  assert.match(line, /runner stopped mid-run: grace-exit/);
  assert.match(line, /resume it by hand/, "never reads as quietly settled");
});

// ---- the two park lanes on the rollup line (2026-07-29) ---------------------------------------------

test("lineFor: a recovering run names the lane and shows BOTH budgets — the defect one at a glance", () => {
  // The point of the split is that an operator watching a run wait out a provider overload can SEE
  // that the run's own recovery budget is still whole. One number could not say that.
  const weather = { ref: "TMP9", markName: "VENZY", state: "recovering", recoveryAttempts: 2, recoveryMax: 3,
    recoveryLane: "weather", recoveryLanes: { weather: { attempts: 2, ceiling: 6 }, defect: { attempts: 0, ceiling: 3 } },
    failedStage: "register-digest", recoveryResumesAt: "2026-07-29T23:13:00.000Z" };
  const line = lineFor(weather);
  assert.match(line, /🔄 AUTO-RECOVERY \(upstream weather park — weather 2\/6, defect 0\/3\) at register-digest/);
  assert.match(line, /resumes 2026-07-29 23:13 UTC/);
  assert.match(line, /report still owed/);
  const defect = { ...weather, recoveryLane: "defect", recoveryLanes: { weather: { attempts: 2, ceiling: 6 }, defect: { attempts: 1, ceiling: 3 } } };
  assert.match(lineFor(defect), /\(defect park — weather 2\/6, defect 1\/3\)/);
  // a pre-split record carries neither field and keeps its original single-counter line verbatim
  const legacy = { ref: "TMP9", markName: "VENZY", state: "recovering", recoveryAttempts: 1, recoveryMax: 3, failedStage: "synthesis" };
  assert.match(lineFor(legacy), /🔄 AUTO-RECOVERY \(attempt 1\/3\) at synthesis/);
});

// ---- audit item 7: the rollup settles from the SAME store the retry machinery reads ---------------------
test("rollupStatus: a run with .sent beside its status.json never shows SEND PENDING — one store, one answer", () => {
  // The delivered-run contradiction this closes: mark_sent writes .sent (the receipt outbox-backoff and
  // the courier's retry guard key on) and flips status.sendPending BEST-EFFORT — so a failed flip left
  // STATUS.md shouting "SEND PENDING" over a run whose .sent was simultaneously suppressing every retry.
  // The banner now derives from the same predicate the machinery uses: sendPending AND no .sent.
  const studioRoot = mkdtempSync(join(tmpdir(), "prog-sent-"));
  const mk = (rel, obj, sent) => {
    const d = join(studioRoot, rel);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "status.json"), JSON.stringify(obj) + "\n");
    if (sent) writeFileSync(join(d, ".sent"), JSON.stringify(sent) + "\n");
  };
  // the incident shape: delivered, sendPending stuck true, .sent present (flip failed mid-settle)
  mk("tmp1-ivory/2026-07-29-ivory-y", {
    runId: "tmp1-ivory-2026-07-29-ivory-y", ref: "TMP9001", markName: "IVORY",
    state: "delivered", verdict: "CONDITIONAL", sendPending: true, updatedAt: "2026-07-29T10:00:00Z",
  }, { ts: "2026-07-29T10:05:00Z", messageId: null, attestation: "relayed out-of-band", via: "mcp/mark_sent", settled: "delivery" });
  // the control: genuinely unsettled run keeps its loud banner
  mk("tmp2-owed/2026-07-29-basalt-arch", {
    runId: "tmp2-owed-2026-07-29-basalt-arch", ref: "TMP9002", markName: "OWED",
    state: "delivered", verdict: "OK", sendPending: true, updatedAt: "2026-07-29T09:00:00Z",
  }, null);

  rollupStatus(studioRoot);
  const md = readFileSync(join(studioRoot, "STATUS.md"), "utf8");
  const ivory = md.split("\n").find((l) => /TMP9001/.test(l));
  const owed = md.split("\n").find((l) => /TMP9002/.test(l));
  assert.ok(ivory && !/SEND PENDING/.test(ivory), ".sent settles the banner even when the status flip was lost");
  assert.ok(owed && /SEND PENDING/.test(owed), "a run with no receipt stays loudly pending — that is the truth");
});

// ── — the stage-registry family is a CLOSED PARTITION, checked in both directions ───────────────
// STAGES is the authority; STAGE_ORDER (stages.mjs) and STAGE_TO_STEP (progress.mjs) are hand-kept
// projections of it. Nothing pinned either one to it, and both fail silently in a way a reader cannot
// tell from working:
//   · missing from STAGE_ORDER      ⇒ stageOrdinal() === -1 ⇒ `--from <stage>` cannot target it, and its
//                                     archived rows sort ahead of everything on any indexOf consumer;
//   · missing from STAGE_TO_STEP    ⇒ stepForStage() === null ⇒ the client's stepper shows an unlabelled
//                                     gap, i.e. a working run that looks stalled.
// Every stage must now be consciously placed in each projection, or consciously excluded WITH A REASON.
test("#249: every STAGES key is in STAGE_ORDER or declared excluded from it — no stage falls out of --from silently", () => {
  const stages = Object.keys(STAGES);
  assert.ok(stages.length > 10, `only ${stages.length} stages — this guard is sweeping nothing`);
  const unplaced = stages.filter((s) => !STAGE_ORDER.includes(s) && !(s in STAGE_ORDER_EXCLUDED));
  assert.deepEqual(unplaced, [],
    `these stages are in neither STAGE_ORDER nor STAGE_ORDER_EXCLUDED: ${unplaced.join(", ")} — stageOrdinal() returns -1 for them, so --from cannot target them and their rows mis-sort. Add each to the order, or to STAGE_ORDER_EXCLUDED with the reason it has no fixed point.`);
  // …and the reverse: no dead entry in either list.
  const ghosts = STAGE_ORDER.filter((s) => !stages.includes(s));
  assert.deepEqual(ghosts, [], `STAGE_ORDER names stages that do not exist: ${ghosts.join(", ")}`);
  const deadExclusions = Object.keys(STAGE_ORDER_EXCLUDED).filter((s) => !stages.includes(s));
  assert.deepEqual(deadExclusions, [], `STAGE_ORDER_EXCLUDED names stages that do not exist: ${deadExclusions.join(", ")}`);
  for (const [s, why] of Object.entries(STAGE_ORDER_EXCLUDED))
    assert.ok(typeof why === "string" && why.length > 20, `STAGE_ORDER_EXCLUDED["${s}"] must state WHY, not just opt out`);
});

test("#249: every STAGES key has a display step or is declared step-less — no stage renders as an unlabelled gap", () => {
  const stages = Object.keys(STAGES);
  const unplaced = stages.filter((s) => !(s in STAGE_TO_STEP) && !(s in STAGE_NO_STEP));
  assert.deepEqual(unplaced, [],
    `these stages map to no display step and are not declared step-less: ${unplaced.join(", ")} — stepForStage() returns null, so the client's stepper shows an unlabelled gap while the run is working. Add each to STAGE_TO_STEP, or to STAGE_NO_STEP with the reason it must not move the stepper.`);
  // The reverse: every STAGE_TO_STEP key is a real stage or a declared non-stage, so a typo cannot sit here.
  const orphans = Object.keys(STAGE_TO_STEP).filter((k) => !stages.includes(k) && !(k in NON_STAGE_STEPS));
  assert.deepEqual(orphans, [],
    `STAGE_TO_STEP maps keys that are neither stages nor declared non-stages: ${orphans.join(", ")} — a typo'd key here is a stage whose rows silently render as a gap. Add it to NON_STAGE_STEPS with the reason, or fix the key.`);
  const deadDeclarations = Object.keys(STAGE_NO_STEP).filter((s) => !stages.includes(s));
  assert.deepEqual(deadDeclarations, [], `STAGE_NO_STEP names stages that do not exist: ${deadDeclarations.join(", ")}`);
  for (const [s, why] of Object.entries({ ...STAGE_NO_STEP, ...NON_STAGE_STEPS }))
    assert.ok(typeof why === "string" && why.length > 20, `the declaration for "${s}" must state WHY, not just opt out`);
  // Every declared step index must be a real display step — an off-by-one here mislabels the stepper.
  for (const [s, i] of Object.entries(STAGE_TO_STEP))
    assert.ok(Number.isInteger(i) && i >= 0 && i < DISPLAY_STEPS.length, `STAGE_TO_STEP["${s}"] = ${i} is not a DISPLAY_STEPS index`);
});

// ── deliveredAt: HARDENING, not a bug fix ('s first-observation survey, 2026-08-14) ─────────────
//
// `deliveredAt` is written with a fresh timestamp by both terminal writers — the same patch-wins shape
// that destroyed `reportedAt`. The survey could NOT establish a reachable second write: writeRunStatus
// refuses to move a terminal state, and pool-admin's republish does not touch status.json. So this
// closes a LATENT trap rather than a live one, and it is labelled that way on purpose — calling it a
// defect would be the credible-wrong-number error pointing the other way.
//
// It earns the line because of what it timestamps: when a matter was DELIVERED, which is outward-facing.
// A latent trap on an inward metric can wait; one on a delivery timestamp should not, at this price.

test("#948 deliveredAt is first-write-wins — a second delivery write cannot move it", () => {
  const dir = mkdtempSync(join(tmpdir(), "delivered-"));
  try {
    writeRunStatus(null, { state: "delivered", deliveredAt: "2026-08-14T10:00:00.000Z" }, dir);
    writeRunStatus(null, { state: "delivered", deliveredAt: "2026-08-15T23:00:00.000Z" }, dir);
    const st = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
    assert.equal(st.deliveredAt, "2026-08-14T10:00:00.000Z", "the FIRST delivery stamp survives");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#948 …and the first write still lands, so hardening never becomes silence", () => {
  const dir = mkdtempSync(join(tmpdir(), "delivered-first-"));
  try {
    writeRunStatus(null, { state: "delivered", deliveredAt: "2026-08-14T10:00:00.000Z" }, dir);
    assert.equal(JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).deliveredAt, "2026-08-14T10:00:00.000Z");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
