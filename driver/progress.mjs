// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// progress.mjs — live run status for the prelim-search driver.
//
// Two artifacts, both written by the driver into the FORWARDING agent's own workspace
// (so the agent's sandboxed read tool can see them — agents can't exec, so on-demand status is a
// plain file read, never a script call):
//   1. <runDir>/status.json        — the machine-readable per-run truth (travels into the archive on
//                                     success, since the run-dir is renamed there).
//   2. <studioRoot>/STATUS.md       — a human-readable rollup of recent runs, newest-first, the ONE file
//                                     the prelim-status skill reads to answer "where is it at?".
//
// Both writes are atomic (temp + rename) and idempotent — status is DERIVED from the current run, never
// blindly incremented — so the resumable pipeline can re-drive a run without corrupting either file.

import { readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { DRIVER_DIR } from "../shared/driver-dir.mjs";   //
import { config } from "./driver.config.mjs";
import { batchMarkName } from "./mark-name.mjs";
import { runLog, note } from "./log.mjs";
// — the seed's pid stamp. claim-liveness.mjs is the real home of the /proc reader (runner.mjs
// imports and re-exports it rather than owning it), so this takes it from the source and adds no
// dependency on the runner.
import { procStarttime } from "./claim-liveness.mjs";
import { engineCommit, engineCommitSource } from "./engine-build.mjs";   // — the SAME stamp the pool copy records

// The 9-step USER-FACING stepper — the single source of truth for display. Deliberately collapses the
// driver's execution units (fan-out register axes, skeptic-escalation re-runs, corrective re-synthesis,
// two refutation passes) onto a clean forward-only sequence, so the displayed step never jumps backward.
export const DISPLAY_STEPS = [
  "Framing the matter",     // 1  matter-frame, prelim-variants
  "Register sweeps",        // 2  common-law + register-unit:* (fan-out + escalation re-runs collapse here)
  "Placement & digest",     // 3  placement-inquiry, register-digest (+ re-digest)
  "Skeptic review",         // 4  skeptic
  "Synthesis",              // 5  synthesis (+ corrective re-synthesis)
  "Case law & refutation",  // 6  case-law, narrative-refutation (both passes)
  "Drafting the report",    // 7  report-synthesis, audit (code)
  "Publishing",             // 8  publish (code) → .published
  "Sending to you",         // 9  notify, notify-chat → .delivered
];

// Real STAGES key (no axis suffix) → 0-based DISPLAY_STEPS index.
//
// — this map, STAGE_NO_STEP and NON_STAGE_STEPS below are a CLOSED PARTITION of Object.keys(STAGES),
// asserted in both directions by progress.test.mjs. "Keys not present here are no-ops for display" was
// true and unenforced: a stage added to STAGES and forgotten here does not fail, it renders as an
// UNLABELLED GAP on the stepper the client watches — the run looks stalled while it is working. Three
// stages were sitting in that state (blind-frame, frame-diff, doubt-closure); each now says so by name.
export const STAGE_TO_STEP = {
  "matter-frame": 0, "prelim-variants": 0,
  "common-law": 1, "common-law-half": 1, "register-unit": 1,
  "placement-inquiry": 2, "register-digest": 2,
  skeptic: 3,
  synthesis: 4,
  "case-law": 5, "narrative-refutation": 5,
  // "client-summary" is a RETIRED stage (2026-08-01) and is KEPT here deliberately: archived runs
  // carry its rows, and a status row whose stage resolves to no step renders as an unlabelled gap.
  "report-overview": 6, "report-card": 6, "client-summary": 6, audit: 6,
  publish: 7,
  // RETIRED with the delivery mode that was their only caller and KEPT here for the same reason
  // client-summary is: archived runs carry their rows, and a row whose stage resolves to no step renders
  // as an unlabelled gap. See NON_STAGE_STEPS below, which is where a key that is not a stage is declared.
  notify: 8, "notify-chat": 8,
};

// — the stages that deliberately have NO display step, each with the reason it does not move the
// stepper. A stage in neither this map nor STAGE_TO_STEP fails progress.test.mjs, so the choice is made
// once, consciously, by whoever adds the stage — never by omission.
export const STAGE_NO_STEP = {
  // Both run INSIDE the gather the stepper already shows as "Searching": blind-frame is a sibling of the
  // gather (it re-derives the frame cold and advances nothing the client waits on), and frame-diff is the
  // code-consumed reopen check that closes it. Advancing the stepper for either would show the run moving
  // on while the searches it depends on are still out.
  "blind-frame": "runs as a sibling of the gather — advancing the stepper would claim progress the searches have not made",
  "frame-diff": "the code-consumed reopen check inside the gather step, not a phase the client waits on",
  // Condition-only: fires only when stitch-open doubts exist, well after the stepper has passed synthesis.
  "doubt-closure": "condition-only (only when stitch-open doubts exist) — the stepper is already past it",
};

// Keys of STAGE_TO_STEP that are NOT stages, with the reason each is legitimately here. Without this the
// completeness check could only run one way, and a typo'd stage key would sit in STAGE_TO_STEP forever.
export const NON_STAGE_STEPS = {
  audit: "a CODE step (buildAuditMd), not an LLM stage — it has no STAGES entry and never will",
  publish: "a CODE step (the publish path), not an LLM stage",
  "client-summary": "a RETIRED stage (2026-08-01) kept for ARCHIVED runs' rows — a row whose stage resolves to no step renders as an unlabelled gap",
  notify: "a RETIRED stage (#1014, deleted with the gateway delivery mode) kept for ARCHIVED runs' rows — same reason as client-summary",
  "notify-chat": "a RETIRED stage (#1014, deleted with the gateway delivery mode) kept for ARCHIVED runs' rows — same reason as client-summary",
};

// rawStageKey may carry an axis suffix ("register-unit:primary-sweep") — strip it. Returns null for an
// unknown key so callers can no-op (an unmapped stage must never touch the displayed step).
export function stepForStage(rawStageKey) {
  const key = String(rawStageKey ?? "").split(":")[0];
  const index = STAGE_TO_STEP[key];
  if (index == null) return null;
  return { index, label: DISPLAY_STEPS[index], n: index + 1, total: DISPLAY_STEPS.length };
}

// Lifecycle honesty (charter P1 §4): the status patch a TERMINAL delivered write must carry. Nothing runs
// after the report: delivery is a packet and publish is code, so no
// recordTransition ever advances the stepper past "Drafting the report" — a delivered run (with
// .published + .delivered on disk) sat frozen at 7/9 on every status surface. The terminal state ADVANCES
// the stepper: delivered ⇒ the final display step, always written together with state "delivered"
// (the knockout lane already does exactly this with its own STEPS; this is the clearance twin).
export function finalStepFields() {
  const index = DISPLAY_STEPS.length - 1;
  return { stepIndex: index, stepLabel: DISPLAY_STEPS[index], stepN: index + 1, stepTotal: DISPLAY_STEPS.length };
}

function nowISO() { return new Date().toISOString(); }

// Exported (B5): pipeline.mjs routes findings.json, sentinels, front-matter and escalation-state
// through this same idiom — the tmp lives in the TARGET's directory (a sibling name), so the rename
// never crosses a device; a reader sees the old complete file or the new one, never a truncation.
export function atomicWrite(file, text) {
  // unique tmp name: concurrent runs (WS-C) can rollup the same STATUS.md — a shared .tmp would
  // cross-rename/ENOENT between writers (content is derived-from-disk either way, so last-writer-wins
  // on the RENAME is fine; the tmp file itself must not be shared).
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text);
  try { renameSync(tmp, file); }
  catch (e) {
    try { unlinkSync(tmp); } catch { /* cleanup is best-effort — the rename failure is the real error */ }
    throw e;
  }
}

function statusPath(runDir) { return join(runDir, "status.json"); }

function readRunStatus(runDir) {
  try { return JSON.parse(readFileSync(statusPath(runDir), "utf8")); }
  catch { return {}; }
}

// Terminal states (A5, 2026-07-28 postmortem): once a run has ended, a stray writer must not resurrect it. The
// 2026-07-28 postmortem zombie was exactly this — `state` was the ONE field the monotonic guard did not cover, so
// a lingering pass's "running" landed over a terminal write and the surface showed "running 7/9" on a
// dead run. `parked-for-human` is deliberately NOT terminal: it is a visible pause (grace-exit), and the
// normal deploy-restart resume must overwrite it without ceremony.
const TERMINAL_STATES = new Set(["delivered", "failed", "cancelled"]);

// Merge `patch` into <runDir>/status.json. The displayed step is MONOTONIC: an escalation re-run (which
// maps to an earlier step) updates lastStage but never pulls stepIndex/label/n/total backward. The state
// is monotonic-at-terminal: delivered/failed/cancelled can only be overwritten by a patch carrying
// `__stateReset: true` — threaded exclusively from the resume guard that DELIBERATELY cleared the
// terminal sentinel (pipeline.mjs). `__stateReset` is consumed here and never persisted.
/**
 * DOOR B — A SEED WHOSE WRITE FAILS IS THE SAME ORPHAN BY A DIFFERENT ROUTE.
 *
 * guaranteed the identity seed RUNS before any refusal. It cannot guarantee the write SUCCEEDS.
 * Both exits below are silent by design — `if (!runDir) return` and the swallowed catch — and
 * `atomicWrite` does not catch its own `writeFileSync`, so an ENOSPC or EACCES lands straight in that
 * empty catch. The result is status.json without identity: round "unknown" forever, the operator told
 * the evidence "may have been torn down". can be perfectly correct and the same orphan still
 * occur.
 *
 * RECORD, DO NOT KILL. A run that cannot record its identity must still deliver — the same rule as the
 * delivery gate never dropping a deliverable, and kill switches are retired house-wide (fail-open
 * only). So the identity seed's failure becomes LOUD in the forensic record and changes nothing else.
 *
 * ONLY THE IDENTITY SEED. Routine status writes stay best-effort and silent: they are re-written
 * seconds later by the next step, and a row per failed step write would bury the one that matters.
 * `critical` is opt-in and the seed call sites are the only holders.
 *
 * `run.jsonl` is the sink because it is already open, is already the forensic record, and is the one
 * artefact that survived on the measured specimen when everything else was missing.
 *
 * THE RECORDING CAN ITSELF FAIL on a dead disk — `run.jsonl` is on the same filesystem. The `df -h /`
 * preflight before an unattended run remains the operational guard for that case; this closes the
 * invisibility for every failure short of it, which is the honest claim.
 */
export function writeRunStatus(ctx, patch = {}, runDirOverride = null, { critical = false } = {}) {
  const runDir = runDirOverride ?? ctx?.run?.runDir;
  // — A STATE WRITE THAT CANNOT FIND ITS RUN DIRECTORY SAYS SO. It used to `return` here, in
  // silence, for every caller.
  //
  // The argument above for silence is sound and does not cover this case: routine writes "are re-written
  // seconds later by the next step", so losing one costs nothing. A write that changes `state` is not
  // routine and nothing re-writes it — the run has just become `recovering`, `postponed` or `failed`, and
  // if that write evaporates the record keeps saying `running` for as long as the run lasts. A reader
  // then meets a parked run that looks stalled, and cannot tell "the flip never happened" from "the flip
  // happened and something overwrote it". That is the ambiguity is about, and it is the reason the
  // 2026-08-17 R5 park could not be attributed to a code path from its own artifacts.
  //
  // NOT A THROW. Fail-open is the house rule on this path — a run that cannot record its state must
  // still deliver — so this records and returns, exactly like the identity seed's failure above.
  if (!runDir) {
    if (typeof patch?.state === "string") {
      try {
        note(`[status] NO RUN DIRECTORY — the state write to ${JSON.stringify(patch.state)} did not happen. `
          + `The run's status.json still says whatever it said last, which for a park or a terminal means it `
          + `says "running". Caller passed neither a runDirOverride nor a ctx.run.runDir (#1159).`);
      } catch { /* the note sink is best-effort too — never let reporting a lost write lose the run */ }
    }
    return;
  }
  const { __stateReset, ...rest } = patch;
  const old = readRunStatus(runDir);
  const merged = { ...old, ...rest, updatedAt: nowISO() };
  if (typeof rest.stepIndex === "number" && typeof old.stepIndex === "number" && old.stepIndex > rest.stepIndex) {
    // keep the furthest step ever reached (label/n/total move together with the index)
    merged.stepIndex = old.stepIndex;
    merged.stepLabel = old.stepLabel;
    merged.stepN = old.stepN;
    merged.stepTotal = old.stepTotal;
  }
  if (typeof rest.state === "string" && TERMINAL_STATES.has(old.state) && rest.state !== old.state && __stateReset !== true) {
    merged.state = old.state;   // a terminal run stays terminal — only a deliberate resume may reopen it
  }
  // A3 (2026-07-28 postmortem): startedAt is APPEND-ONLY BY DELETION — no writer patches it any more (the seed
  // used to stamp it unconditionally on every resume, so status.json carried the LAST resume time, 5h+
  // late). This backfill makes the FIRST write win and every later write a no-op.
  if (!merged.startedAt) merged.startedAt = merged.updatedAt;
  // ── — A RUN THAT HAS STOPPED SAYS WHEN, WHICHEVER WAY IT STOPPED ────────────────────────────
  //
  // The owner watched a SIGKILLed run sit at `state:"running"`, `endedAt:null`, showing 5h43m in the UI.
  // The reconciler fixed the corpse: it brings a dead run to terminal WITH `endedAt` and `reconciledAt`.
  // Nothing else ever wrote the field.
  //
  // So a run that was killed and reconciled ended up BETTER RECORDED THAN ONE THAT STOPPED CLEANLY. Two
  // cancelled runs measured on the test box read `state=cancelled endedAt=null reason=null`; a delivered
  // run carries `deliveredAt` and no `endedAt` at all. Any reader computing a duration from status.json
  // gets nothing on every clean terminal — which is the coping behaviour this issue was filed about,
  // still present on the paths that work.
  //
  // STAMPED HERE, at the one place all three terminals pass through, rather than at each of them. The
  // cooperative cancel, the delivery and the failure are three call sites in three files, and a field
  // three callers have to remember is a field one of them will not. The reconciler passes its own
  // `endedAt` and that value wins — the patch is spread before this runs — so a reconciled corpse keeps
  // saying when the PROCESS died rather than when the record was repaired.
  //
  // APPEND-ONLY, exactly like `startedAt` above and for the same reason: the first write wins and every
  // later one is a no-op, so a re-entrant terminal write cannot move the time a run stopped.
  if (TERMINAL_STATES.has(merged.state) && !merged.endedAt) merged.endedAt = merged.updatedAt;
  // HARDENING, not a bug fix, and the distinction is deliberate (survey on). `deliveredAt` is
  // written with a fresh timestamp by both terminal writers, which is the same patch-wins shape that
  // destroyed `reportedAt` — but no reachable SECOND write was established: writeRunStatus refuses to
  // move a terminal state, and pool-admin's republish does not touch status.json. So this closes a
  // LATENT trap rather than a live one, at the price of one line.
  //
  // Worth the line because of what it is a timestamp OF. Tonight produced two demonstrations of
  // latent-becoming-live — a second refusal door nobody had enumerated, and a write path nobody had
  // asked about — and `deliveredAt` is an OUTWARD-FACING fact: when a matter was delivered. A credible
  // wrong number there is worst-in-class for this firm. A latent trap on an inward metric can wait.
  if (old.deliveredAt && rest.deliveredAt) merged.deliveredAt = old.deliveredAt;
  // ── — WHICH ENGINE SERVED THIS RUN, ON THE RUN DIR AND NOT ONLY ON THE POOL COPY ───────────
  //
  // `meta.json` has carried `engineCommit` since, but meta.json is written at PUBLISH time. A run
  // that FAILED, parked, or is still in flight has no meta.json at all — which is precisely the set a
  // reader is comparing when they ask what changed. The baseline had to attribute every delta BY
  // CLOCK rather than by ancestry, and said so: "No engine or commit for any of the three runs … I
  // therefore explicitly do NOT report a delta attributable to any change."
  //
  // FIRST WRITE WINS, like `startedAt` above and for the same reason: this names the engine the run
  // STARTED on. A resume after a redeploy legitimately executes different code, and `attempts` is what
  // tells a reader a resume happened — stamping the resume's commit here would silently rewrite what
  // the earlier attempts ran. Recording BOTH is a real second question and it is not this one; nothing
  // has yet measured a resume that crossed a deploy.
  //
  // SAME SPELLING as the pool copy and as `feedback-store.mjs`'s reader — `engineCommit`. Two spellings
  // of one fact is the defect class this repo keeps re-filing.
  if (old.engineCommit && rest.engineCommit) merged.engineCommit = old.engineCommit;
  try { atomicWrite(statusPath(runDir), JSON.stringify(merged, null, 2) + "\n"); }
  catch (e) {
    // Still best-effort — a write failure must never break the pipeline. What changes is that the
    // IDENTITY seed's failure stops being invisible.
    if (critical) {
      try {
        runLog(runDir, { event: "status-write-failed", critical: true,
          reason: String(e?.code || e?.message || e).slice(0, 200),
          // The fields whose absence orphans the round, so the record says WHAT was lost and not only
          // that something was. A reader with this row can bind the run to its round by hand.
          ref: rest.ref ?? null, runId: rest.runId ?? null, id: rest.id ?? null });
      } catch { /* the disk that ate status.json can eat this too — see the doc block */ }
    }
  }
}

// ── THE IDENTITY A RUN STAMPS ON ITS OWN RECORD ───────────────────────────
//
// SEPARATE FROM THE STEPPER, and that separation is the whole point. These three fields used to be
// written only inside `seedRunStatus`, in the same call that seeds the 9-step CLEARANCE flow. The
// knockout lane legitimately does not want that stepper — it walks four or five steps of its own — so
// it wrote its own seed and, in opting out of a STEPPER, silently lost a BUILD RECEIPT and a LIVENESS
// RECORD it never meant to decline. Measured on two DELIVERED runs, one per lane: the knockout run
// carried 32 keys and none of the three; the clearance run carried 34 and all of them.
//
// Two things were lost, and neither was the stepper:
//
//   · BUILD ATTESTATION. The documented practice is to read a run's engine build from its OWN
//     status.json, precisely so a build claim cannot be inferred from the box's current checkout. On
//     every knockout run that read was `undefined`, and a reader following the practice got nothing
//     while believing they had attested the run.
//   · LIVENESS. `driver/reconcile-runs.mjs` reads `Number(s.pid) || 0`; with no pid the exact
//     `claimerIsAlive` branch is skipped for the fallback that file itself labels THE WEAKER TEST,
//     which decides on `updatedAt` and a quiet window — independently measured 12 minutes stale on a
//     healthy run. No knockout run had ever been eligible for the exact test.
//
// So any lane that seeds a run status spreads THIS, whatever stepper it walks. A future lane that wants
// its own step flow cannot lose the identity by taking that choice, because the two are no longer one
// call. `driver/test/both-lanes-seed-identity.test.mjs` holds every seed to it.
//
// — WHO IS RUNNING THIS. Nothing on disk could answer that before: status.json recorded no pid,
// the run slot locks are anonymous (Phase-4 lifted the per-agent tag), and the queue's claim sidecar is
// a different object with its own lifetime. So a run whose process was killed sat at `running` forever
// and every reader counted a corpse as live.
//
// Two fields rather than the queue sidecar's colon-joined `pid:starttime` string, deliberately: one
// format with two parsers is the defect class describes. The LIVENESS CHECK is still the shared
// one — driver/reconcile-runs.mjs hands these to `claimerIsAlive` from claim-liveness.mjs, so the
// fail-safe polarity is identical (dead only on positive evidence; an unreadable starttime on a live
// pid counts as ALIVE). `pidStarttime` is what stops a recycled pid impersonating the run.
//
// Re-stamped on resume as well as on a cold start, because a resume is a DIFFERENT process taking the
// run over, and every seed is a place both paths pass through.
/**
 * — THE RUN'S OWN RECORD, ASKED THE SAME WAY BY EVERY LANE.
 *
 * The terminal state this run has already reached, or null. ONE definition of "terminal", read from
 * disk by the module that owns TERMINAL_STATES, because the alternative is the failure queue-markers.mjs
 * was founded on: a vocabulary written down three times and the copies disagreeing. The run-dir resume
 * watcher and the pipeline's resume door both need this answer and neither may retype the set.
 *
 * ABSENCE IS NOT A TERMINAL, and the polarity is deliberate. A missing, empty or corrupt status.json
 * returns null — this answers "has it PROVABLY ended", never "is it safe to resume". A caller that
 * needs the second question asks the markers too, exactly as scanDueRunDirOrphans does: a run whose
 * record cannot be read must stay recoverable, or an unreadable byte strands a live run for ever.
 */
export function terminalRunState(runDir) {
  if (!runDir) return null;
  const s = readRunStatus(runDir);
  return typeof s?.state === "string" && TERMINAL_STATES.has(s.state) ? s.state : null;
}

export function identitySeed() {
  return {
    pid: process.pid,
    pidStarttime: procStarttime(process.pid),
    // — the same stamp the pool copy records. `engineCommit` catches and returns null rather
    // than throwing, which matters here: this is the identity seed, and a throw would cost the run its
    // record. Since it answers from `build-info.json` when there is no git, so a
    // PACKAGED install — the one a stranger gets — names its commit like any other. A null now means
    // neither source could name the code, which is a different and honest answer from a wrong sha.
    engineCommit: engineCommit(),
    // WHICH evidence, beside the sha. A commit attested by a shipped file is not a commit read from a
    // live checkout, and the field is the only place a later reader can tell them apart.
    engineCommitSource: engineCommitSource(),
  };
}

// Seed identity + an initial step so a status query works from the very first moment of a run.
// A3: the seed carries NO startedAt — writeRunStatus backfills it on the run's first-ever write, and
// first-write-wins makes it the honest wall-clock start across any number of resumes. A resume instead
// records itself: resumedAt (this resume's clock) + attempts (fresh run = 1, each resume +1), and
// threads __stateReset because the resume guard has deliberately cleared a terminal sentinel. The
// verdict/failedStage/reason resets stay (a resumed run owes a fresh outcome);
// recoveryAttempts/recoveryHistory stay OUT of the seed (they are the park budget's memory).
export function seedRunStatus(ctx, { resume = false } = {}) {
  const { job, run, agent } = ctx;
  const first = stepForStage("matter-frame");
  const prior = resume ? readRunStatus(run.runDir) : {};
  writeRunStatus(ctx, {
    schema: 1,
    id: job.id,
    runId: `${run.slug}-${run.date}-${run.codename}`,
    slug: run.slug,
    codename: run.codename,
    date: run.date,
    agent,
    forwarder: job.forwarder,
    ref: job.ref ?? null,
    // The clearance lane admits one name (maxNames: 1, refused at the run door), so this composes to
    // exactly what it did before. It goes through the shared rule anyway, so the two lanes cannot start
    // spelling one fact two ways again the day a clearance product reads more than one name.
    markName: job.markName ?? job.name ?? batchMarkName(job.marks) ?? null,
    classes: job.classes ?? null,
    // — BOTH HALVES OF THE AGREEMENT, on the run's own record. Written
    // unconditionally, including the false pair, so "this run was ordinary" stays visibly different from
    // "this record predates the field". One without the other cannot be read: the profile's marker says
    // whether the account is fiction and the job's field says whether the requester consented, and a
    // report carrying a demo banner should be answerable from the run that produced it.
    demoRun: job.demoRun === true,
    demoDataProfile: ctx.profile?.demoData === true,
    state: "running",
    // — the identity is the SHARED rule, not this stepper's. See identitySeed.
    ...identitySeed(),
    stepIndex: first.index, stepLabel: first.label, stepN: first.n, stepTotal: first.total,
    lastStage: null,
    verdict: null,
    url: null,
    failedStage: null,
    reason: null,
    deliveredAt: null,
    ...(resume
      ? { resumedAt: nowISO(), attempts: (Number(prior.attempts) || 1) + 1, __stateReset: true }
      : { attempts: 1 }),
  }, null, { critical: true });   // door B — the clearance lane's identity seed, same rule
}

// Convenience: advance the run to the step for `rawStageKey` (no-op for unmapped keys) then refresh STATUS.md.
export function recordTransition(ctx, rawStageKey) {
  const step = stepForStage(rawStageKey);
  if (!step) return;
  writeRunStatus(ctx, { stepIndex: step.index, stepLabel: step.label, stepN: step.n, stepTotal: step.total, lastStage: rawStageKey });
  rollupStatus(ctx?.run?.studioRoot);
}

// ---- STATUS.md rollup --------------------------------------------------------------------------------
// The archive lives UNDER studioRoot (studioRoot/archive/...), so a recursive walk of studioRoot finds
// both in-flight and delivered/failed runs. Cap depth (status.json only sits at the run-dir level) and
// skip the high-churn leaf dirs for speed.
const SKIP_DIRS = new Set([DRIVER_DIR, "register-units", "queue", "_history", "_experiments", "_known-conflicts"]);   // spec 64 — the per-mark recall store holds no status.json
const MAX_RUNS = 12;

function findStatusFiles(root, depth, acc) {
  if (depth < 0) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isFile() && e.name === "status.json") acc.push(join(root, e.name));
    else if (e.isDirectory() && !SKIP_DIRS.has(e.name)) findStatusFiles(join(root, e.name), depth - 1, acc);
  }
}

function agentFromStudioRoot(studioRoot) {
  const m = new RegExp(`${config.workspacePrefixRe}([^/]+)/studio/prelim-search/?$`).exec(studioRoot ?? "");
  return m ? m[1] : "";
}

function trunc(s, n = 140) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// PURE + exported for test (the 2026-07-04 send-state rendering is load-bearing for the completion-watch).
export function lineFor(s) {
  const head = `${s.ref ?? "(no ref)"} ${s.markName ?? ""}`.trim();
  const stepTxt = s.stepN && s.stepTotal ? `step ${s.stepN}/${s.stepTotal} ${s.stepLabel ?? ""}`.trim() : "starting";
  // 2026-07-04 incident: STATUS.md showed marble-spire as plain "delivered" and VENZY as plain
  // "FAILED" while BOTH still had their email/WhatsApp queued (sendPending) behind a wedged outbox
  // lane — so the heartbeat completion-watch read the rollup, saw nothing pending, and stood down.
  // The rollup now carries the send state loudly; prelim-deliver flips sendPending:false on send.
  const pending = s.sendPending === true ? " — 📮 SEND PENDING (email/WhatsApp NOT yet out — run prelim-deliver)" : "";
  if (s.state === "delivered") {
    const v = s.verdict ? ` (${s.verdict})` : "";
    return `- ${head} — delivered${v}${s.url ? ` — ${s.url}` : ""}${pending}`;
  }
  if (s.state === "failed") {
    const at = s.failedStage ?? s.lastStage ?? stepTxt;
    return `- ${head} — ⚠️ FAILED at ${at}${s.reason ? ` — ${trunc(s.reason)}` : ""}${pending ? " — 📮 FAILURE NOTICE PENDING (run prelim-deliver)" : ""}`;
  }
  if (s.state === "recovering") {
    // 2026-07-04 production doctrine: a recoverable failure AUTO-RESUMES — the report is still owed.
    // Rendered loudly so no watcher ever reads a recovering run as settled.
    // A4 field split: a recovery park writes `recoveryResumesAt` (resetsAt is the rate-limit clock and
    // keeps that one meaning); the resetsAt fallback reads pre-split runs only.
    const at = s.recoveryResumesAt ?? s.resetsAt;
    const when = at ? ` — resumes ${String(at).replace("T", " ").slice(0, 16)} UTC` : "";
    // Two park lanes (2026-07-29): upstream weather and the run's own defects have separate budgets,
    // so one number can no longer say how much room is left. Render BOTH — a reader watching a run
    // wait out a provider outage needs to see at a glance that the defect budget is still whole,
    // which is the entire point of the split. Pre-split records carry neither field and keep the
    // original single-counter line verbatim.
    const lanes = s.recoveryLanes;
    const budget = lanes
      ? `${s.recoveryLane === "weather" ? "upstream weather" : "defect"} park — weather ${lanes.weather?.attempts ?? "?"}/${lanes.weather?.ceiling ?? "?"}, defect ${lanes.defect?.attempts ?? "?"}/${lanes.defect?.ceiling ?? "?"}`
      : `attempt ${s.recoveryAttempts ?? "?"}/${s.recoveryMax ?? "?"}`;
    return `- ${head} — 🔄 AUTO-RECOVERY (${budget}) at ${s.failedStage ?? s.lastStage ?? stepTxt}${when} — report still owed, no action needed unless it exhausts`;
  }
  if (s.state === "parked-for-human") {
    // A5 grace-exit: the runner was stopped (deploy restart / operator stop) with this run in flight.
    // Visible-but-non-blocking: the next runner activation reclaims and resumes it — but if none comes
    // (unit disabled, manual runner), a human owns it, so the line must never read as quietly settled.
    return `- ${head} — ⏸ PARKED (runner stopped mid-run${s.parkedKind ? `: ${s.parkedKind}` : ""}) at ${s.lastStage ?? stepTxt} — resumes on the next runner activation; if none is coming, resume it by hand`;
  }
  if (s.state === "postponed") {
    // rate-limit pause: alive + auto-resuming — never render as "running" (would hide the pause + ETA).
    const when = s.resetsAt ? ` — resumes ${String(s.resetsAt).replace("T", " ").slice(0, 16)} UTC` : " — resumes when the cap resets";
    return `- ${head} — ⏸ POSTPONED (usage-limit cap) at ${s.lastStage ?? stepTxt}${when}`;
  }
  return `- ${head} — ${stepTxt} — running`;
}

// Rebuild <studioRoot>/STATUS.md from every status.json under studioRoot. Newest-first, capped, atomic,
// and NEVER throws (a rollup failure must never break a run — the per-run status.json is the backstop).
export function rollupStatus(studioRoot) {
  if (!studioRoot || !existsSync(studioRoot)) return;
  try {
    const files = [];
    findStatusFiles(studioRoot, 5, files);
    const byRun = new Map();
    for (const f of files) {
      let s;
      try { s = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
      // THE ROLLUP SETTLES FROM THE SAME STORE mark_sent writes (audit item 7): `.sent` beside
      // status.json is the primary settle receipt, and mark_sent's sendPending flip is best-effort —
      // a flip that failed left STATUS.md shouting "SEND PENDING" over a run whose .sent guard was
      // simultaneously suppressing every retry. Two readers, two stores, two answers. Folding the
      // guard in HERE means the banner and the retry machinery can never disagree again.
      if (s.sendPending === true && existsSync(join(dirname(f), ".sent"))) s.sendPending = false;
      const key = s.runId ?? f;
      const prev = byRun.get(key);
      if (!prev || String(s.updatedAt ?? "") >= String(prev.updatedAt ?? "")) byRun.set(key, s);
    }
    const runs = [...byRun.values()]
      // Presentation retire: same one-key `retired: true` on status.json that hides a run from the ops
      // snapshot (status-snapshot.mjs). It was honoured on the browser surface only, so a retired run went
      // on claiming a STATUS.md line — and a run wedged at "running" (no sentinel, no process) sat in the
      // rollup forever, which is precisely what the flag exists to clear. Filter BEFORE the MAX_RUNS slice,
      // or a retired row still costs a live run its place in the list.
      .filter((s) => s?.retired !== true)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
      .slice(0, MAX_RUNS);
    const agent = agentFromStudioRoot(studioRoot);
    const body = runs.length ? runs.map(lineFor).join("\n") : "_No prelim searches running or recently finished._";
    const md = `# Prelim-search status — ${agent}\n_updated ${nowISO()}_\n\n${body}\n`;
    atomicWrite(join(studioRoot, "STATUS.md"), md);
  } catch { /* never throw */ }
}
