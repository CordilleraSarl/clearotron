// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pipeline-knockout.mjs — the KNOCKOUT (Depth 1) slim lane.
//
// A knockout batch is ONE run: N marks (5–15), one broad CODE-side research call per mark and one more
// for the name in use in the client's field (each receipted), one LLM frame turn, chunked LLM assess turns, a
// one-row-per-mark report + 3-sheet audit workbook, the standard outbox delivery handoff. Dispatched
// from pipelineInner AFTER the profile/policy freezes (ctx.profile + ctx.searchPolicy are set; the run
// slot and pipeline()'s rate-limit postpone wrap us).
//
// What this lane deliberately does NOT have, by design:
//   - no register machinery, no grid, no coverage ledger — the sweep is ONE broad question per mark,
//     and one narrow one on the name in use in the client's field, as the frame words it;
//   - no failure path of its own. A failure takes the clearance's (run-failed.mjs): the same class-aware
//     recovery ladder — TRANSIENT gets the ladder, UNKNOWN exactly one park, DETERMINISTIC and FACTUAL get
//     NONE, every designed refusal gets none, and a signature that already parked is terminal at once —
//     the same park, stop and failure records, and the same notice. Rate limits still postpone via
//     pipeline()'s outer catch.
//     A THROW SITE THAT KNOWS ITS OWN CLASS MUST STAMP IT (`failClass`, see StageFailure). Unstamped,
//     the ladder can only guess from the reason text, and the guess for anything the regexes do not
//     recognise is UNKNOWN — which buys a park. Every throw in this file was written while the lane had
//     no ladder and stamping was therefore free to skip; that is no longer true;
//
// A NOTE ON THE ISSUE NUMBER, BECAUSE THE HISTORY AND THE SOURCE DISAGREE AND ONLY ONE CAN BE FIXED.
// The commit that landed this ladder says "". That is the WRONG issue — 1886 is
// about doctrine resolution and has nothing to do with this lane. The work was authorised against the
// plan of record, 1889, which lists it by name. The commit message cannot be edited once pushed and
// history is not rewritten to tidy a citation, so the wrong number stands in the log forever; the
// references in this file are corrected and this comment is the reconciliation. A reader who greps the
// history for 1886 and lands here is in the right place and the number that brought them is not.
import { atomicWrite, paths } from "./run-record.mjs";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync, renameSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { diffFingerprint, fingerprint, readStamp, writeFingerprint } from "./stage-freshness.mjs";   // a stage reuses its output only while what it read is unchanged
import { driverDir, ensureDriverDir } from "../shared/driver-dir.mjs";   // — one definition of where `_driver/` is
import { fileURLToPath } from "node:url";

import { runStage } from "./gateway.mjs";
import { config, RESEARCH_PROVIDERS, REGISTER_PROVIDER, missingCredentials } from "./driver.config.mjs";
import { registerAdapter as adapterForRegister } from "./engine/run-choices.mjs";   // the run's register adapter, from ctx.register
import { StageFailure, stageWallFields } from "./run-outcome.mjs";   // — the wall fields the spine already carries
import { endTheDeliveredRun, runShell } from "./run-shell.mjs";   // — the runner and the delivered ending both products share
import { logTurnaroundReconciliation } from "./run-quote.mjs";
import { RunCancelled, assertNotCancelledBeforePublish, isCancelled, readCancel } from "./cancel.mjs";   // stop-by-user: never the failure lane below
import { loadFrameworkManifest, parseFrameworkManifest, frameworkFor, DEFAULT_FRAMEWORK } from "./framework.mjs";
import { attachFrameworkMethod, methodPathFor, FROZEN_METHOD_FILE } from "./framework-method.mjs";
import { KO_STAGES, KO_STEPS, KO_STEP_REGISTER_COUNT, koSteps, koPaths, kebab, knockoutGridSpec, KNOCKOUT_WEB, KNOCKOUT_MINUTES_BAR, knockoutBarVerdict, koChunks } from "./stages-knockout.mjs";
import { kebabCollisions, reportIdentityFor, CAPABILITY_SKIPPED_CAUSE, CAPABILITY_SKIPPED_NOTE } from "./search-policy.mjs";
import { countPreflight, countRegisterHits, countedMarks, resolveCountExecutor } from "./register-count.mjs";
import { recordsPreflight, listedMarks } from "./register-records.mjs";
import { knockoutQuestionPlan, knockoutBandPath, knockoutBandBlocks, knockoutProposals, knockoutRecordsDoc, knockoutAxis, openingQid, questionPlanPath,
  readingTableLines, appendQuestionReceipts, resolveQuestionExecutor, writeFixtureMarker, addedClassQuestions, formsOfName, formQid, countRowsOf, foldFormCounts, unfoldFormCounts, withCitedFilings, withHeldGoods } from "./knockout-register-read.mjs";
import { capabilitiesFor } from "./register-capabilities.mjs";
// — the ONE binding of the office split to this box's env, shared with the plan lane.
import { registerUnavailableOffices } from "./register-unreachable.mjs";
import { runRecordLogPath } from "../providers/_shared/ledger-path.mjs";   // — this run's record log
import { beginAnswerMemory } from "../providers/_shared/answer-memory.mjs";
import { validators as koValidators, validateMergedFindings, worstBand, registerSurfacedFilings, raterCaveats, SURVIVOR_BOUNDARY_RE, REGISTER_LANE_FILE, PERMITTED_SOURCES } from "./verify-knockout.mjs";
import { KNOCKOUT_CARD_ORDER } from "./findings-model.mjs";
import { reviewDispatch, applyKnockoutReview, knockoutReviewFile, rewritesThatSurvive } from "./knockout-review-record.mjs";
import { chunkBasePath, correctionAnswers, correctionOutcomes, correctionWork, correctionWorkPath, keepChunkBases, knockoutCorrectionFile, movedOutsideScope, readCorrectionWork, restoreChunkBases, rollBackName, sameFinding } from "./knockout-correction-record.mjs";
import { knockoutAssessSourceDefects } from "./knockout-assess-record.mjs";
import { correctionsAppliedTable, unresolvedFlags } from "./corrections-feedforward.mjs";
import { settledKnockoutReading } from "./knockout-register-record.mjs";
import { stripNextStepSections } from "./knockout-next-step.mjs";
import { publishKnockout, composeKnockoutEmail, knockoutName } from "./publish/knockout.mjs";
import { writeRunStatus, readRunStatus, rollupStatus, identitySeed, recordTransition, resumeRecord } from "./progress.mjs";   // — the identity seed is shared; the stepper is not
import { batchMarkName } from "./mark-name.mjs";
import { runLog, note, outputMeta } from "./log.mjs";
import { defaultTerritoryState } from "./effective-scope.mjs";   // the stored-defaults reading — one producer, shared with the clearance lane
import { whatsappRouting } from "./stages.mjs";
import { rollupTokens, stampTokenRollup } from "./tokens.mjs";
import { recordRunConsumption } from "./consumption-ledger.mjs";
// The scoped owner lookup a promoted register filing is owed. Bounded, deduplicated
// per owner, and structurally unable to withhold a report.
import { composeOwnerQuery, ownerPayloadFile, ownersOwedACheck, runOwnerChecks } from "./owner-use-check.mjs";
import { isResearchAnswer } from "./research-answers.mjs";

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
export const TRIAGE_FRAMEWORK = "skills/clearance-search/risk-framework-triage.md";

// sentinel/archive mirror pipeline.mjs's private helpers (cross-referenced there) — byte-faithful.
const sentinel = (runDir, name, obj) => atomicWrite(join(runDir, name), JSON.stringify({ ts: new Date().toISOString(), ...obj }, null, 2) + "\n");
function archive(run) {
  try { mkdirSync(dirname(run.archiveDir), { recursive: true }); renameSync(run.runDir, run.archiveDir); return run.archiveDir; }
  catch (e) { note(`archive failed (non-fatal): ${e.message}`); return null; }
}
// Steps are addressed BY LABEL: Depth 2 inserts a step, so every index after the frame shifts. The
// run's own step list is frozen on ctx at dispatch (ctx.koSteps).
// `currentStep` is the step the run is in now, as a clearance records it; this stepper only moves forward, so it is
// the step fields in the clearance's shape.
const koStep = (ctx, label, extra = {}) => {
  const steps = ctx.koSteps ?? KO_STEPS;
  const i = steps.indexOf(label);
  writeRunStatus(ctx, { stepIndex: i, stepLabel: label, stepN: i + 1, stepTotal: steps.length,
    currentStep: { index: i, label, n: i + 1, total: steps.length }, ...extra });
};

// ── framework freeze (knockout flavour): the customer's OWN framework when configured, else the house
// TRIAGE ladder (NOT the clearance Generic default — a knockout rates at triage grain). Same freeze
// doctrine as attachFramework: minted once, read verbatim on resume, corrupt = loud.
function attachKnockoutFramework(ctx) {
  const sidecarPath = paths(ctx.paths.runDir).framework;
  // ── THE DECK'S PATH, RESOLVED ONCE AND ON BOTH PATHS ────────────────────────
  //
  // The assess stage is served the DECK now, not only the manifest — `framework.mjs` states the rule
  // the manifest obeys: "vocabulary and order ONLY. Never a mapping table, threshold, or decision
  // rule — those live in the deck prose, where the model reasons with them." A rater given the band
  // words and not the rulebook was being told to honour ceilings stated in a document it never saw.
  //
  // Resolved HERE and hung on ctx rather than recomputed in the dispatch, because "which deck" is one
  // decision and a second copy of it is how the two lanes drifted in the first place. ABOVE the resume
  // return as well: a resumed run reads its manifest off the sidecar and would otherwise reach the
  // dispatch with no deck path at all — the stage would silently fall back to reading nothing, which
  // is exactly the failure this issue is about, reintroduced on the resume path only.
  const configured = frameworkFor(ctx.profile);
  const fwPath = configured !== DEFAULT_FRAMEWORK ? configured : TRIAGE_FRAMEWORK;
  ctx.frameworkPath = fwPath;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT */ }
  if (raw != null) {
    try { ctx.framework = parseFrameworkManifest(raw); }
    catch (e) { throw new Error(`_driver/framework.json is corrupt (${e.message}) — investigate; the frozen framework is never silently re-derived`); }
    readBackLadder(sidecarPath);
    // The method is read back with the manifest it was frozen beside, never loaded fresh on a resume.
    ctx.frameworkMethod = attachFrameworkMethod({ frozenPath: driverDir(ctx.paths.runDir, FROZEN_METHOD_FILE),
      resolve: (rel) => config.resolveSkillPath(rel), fwPath, manifest: ctx.framework, minted: false });
    return;
  }
  const manifest = loadFrameworkManifest((rel) => config.resolveSkillPath(rel), fwPath);   // see pipeline.mjs attachFramework
  ctx.framework = manifest;
  // THE FRAMEWORK'S METHOD, frozen when the framework states one (framework-method.mjs): every rated card
  // on a knockout page then records the framework's inputs and takes its table's band. Frozen BEFORE the
  // manifest, as the clearance lane does: a run interrupted between the two writes has no manifest, so its
  // resume mints both again. The other order would leave a manifest with no method beside it, which the
  // resume branch above reads as a framework that states none.
  ctx.frameworkMethod = attachFrameworkMethod({ frozenPath: driverDir(ctx.paths.runDir, FROZEN_METHOD_FILE),
    resolve: (rel) => config.resolveSkillPath(rel), fwPath, manifest, minted: true });
  atomicWrite(sidecarPath, JSON.stringify(manifest, null, 2) + "\n");
  runLog(ctx.paths.runDir, { event: "framework", key: manifest.framework_key, custom: fwPath !== TRIAGE_FRAMEWORK, lane: "knockout", bands: manifest.bands.map((b) => b.label).join("/"),
    method: ctx.frameworkMethod ? methodPathFor(fwPath) : null });
  readBackLadder(sidecarPath);
}

// ── — READ THE LADDER BACK THE WAY ITS CONSUMER READS IT, AT THE ONE MOMENT IT IS FREE ─────────
//
// `knockoutAssessChunk` does not use `ctx.framework`. It re-reads the sidecar off disk with a forgiving
// reader and derives its ladder from `fw?.bands`; when that comes back empty, its three band checks —
// `knockout_band_unknown`, `classesDriving`, `registerEstimate` — are ALL inert and every rating in the
// chunk passes unchecked, with no runLog and no note. A run the ladder never constrained is then
// indistinguishable from one it did.
//
// The refusal that would have caught it does not reach that path. `framework.mjs` rejects a manifest with
// fewer than two bands, but the validator never parses, so the guarantee lives on a road the consumer does
// not travel — check-what-enforces, not what declares. Checking here costs no model call: this runs before
// any assess dispatch.
//
// ONE DISPOSITION. The driver wrote the file from a manifest it had already parsed: on this pass when it froze
// the framework, or on an earlier pass of the same build when this is a resume, since a run started on another
// build is not resumed. If it cannot read its own ladder back, the driver is contradicting itself and nothing
// downstream is trustworthy. Hard fail, before a paid turn.
export function readBackLadder(sidecarPath) {   // exported for its test
  let bands = null;
  try { bands = JSON.parse(readFileSync(sidecarPath, "utf8"))?.bands; } catch { /* handled below */ }
  const ladder = Array.isArray(bands) ? bands.map((b) => String(b?.label ?? "")).filter(Boolean) : [];
  if (ladder.length) return;
  throw new Error(`knockout_ladder_unreadable: ${sidecarPath} does not read back as a band ladder, so knockoutAssessChunk's three band checks would pass every rating unchecked — the driver wrote this file itself from a parsed manifest, so this is a driver fault and no seat can fix it`);
}

// ── koStage: the slim lane's stage runner — skip-if-output-valid (the stageOnce pattern), one
// runStage call, StageFailure on exhaustion (rate_limited rides to pipeline()'s postpone catch).
/**
 * Rewrite the lines a reader meets first, and NEVER cost a client a report doing it.
 *
 * Every failure path returns the record it was handed. A stage that fails, times out, returns nothing,
 * returns something that will not parse, or produces a rewrite the merged gate then refuses, all end the
 * same way: the rated record ships, unrewritten, exactly as it shipped before this stage existed. This
 * pass is presentation. A refusal is never a pass, and "no report" is a product failure — so the last
 * thing added to the delivery path is the last thing that should be able to stop it.
 *
 * EVERY KNOCKOUT IS REVIEWED, by the owner's ruling of 2026-10-10. The reviewer's first question is the
 * client's, and a record whose wording the driver's read flagged nowhere still gets it: the reviewer is
 * handed the lines a reader meets first, with their addresses, and rewrites toward the client's question
 * or declines at one of them. Only a record with no such line at all is not dispatched. That is logged
 * with its counts, so "there was nothing to read" and "the pass never ran" are different rows in the
 * journal rather than one absent one.
 */
async function knockoutReviewingPass({ ctx, run, K, merged, plan, chunks, composeRecord }) {
  // A ROUND ALREADY BEGUN GOES ON FROM WHERE IT STOOD: a resumed run must not check a half-corrected record as a first look.
  // Unless the record it was begun on is gone: a chunk rated again on this pass, or a change in what the first review
  // read, leaves its defects about a rating the run no longer holds. That round is set aside and the record is read afresh.
  let begun = readCorrectionWork(run.runDir);
  const obsolete = begun ? reviewRoundObsolete({ ctx, run, K }) : null;
  if (obsolete) {
    setAsideTheRound(run.runDir, begun, ctx.koRated ?? new Set(), obsolete);
    merged = composeRecord();
    begun = null;
  }
  if (begun?.stoodDown) return merged;
  if (begun) return correctAndRecheck({ ctx, run, K, plan, chunks, composeRecord, work: begun, firstReview: readJsonOrNull(knockoutReviewFile(run.runDir)), merged });
  // A SOURCE THE RATING LOST STAYS OPEN: leaving a reference out does not support the claim it stood behind. It goes to the correction
  // with whatever the check raises, and where no check or correction follows, it stays on the record for the reviewing lawyer.
  const sourceDefects = sourceDefectsOf(run.runDir, merged, chunks);
  // A REPAIR THE RATING STEP PROPOSED WAITS FOR THE CHECK, and stays on the record until an accepted read of it. The changed work stays too.
  const sourceAnswered = chunks.flatMap((_, c) => knockoutAssessSourceDefects(run.runDir, c)).filter((x) => x.state === "answered");
  const keepOpen = () => {
    if (!sourceDefects.length && !sourceAnswered.length) return;
    atomicWrite(paths(run.runDir).knockoutCorrections, JSON.stringify({ defects: sourceDefects, outcomes: [], recheck: "not-run",
      open: [...sourceDefects.map((x) => ({ kind: x.kind, mark: x.mark, problem: x.problem, state: "not-corrected" })),
        ...sourceAnswered.map((x) => ({ kind: "source", mark: x.mark, problem: sourceProblem(x), state: "not-rechecked" }))] }, null, 2) + "\n");
  };
  const d = reviewDispatch(merged, plan);
  const { about } = d;
  if (!d.dispatch && !sourceDefects.length && !sourceAnswered.length) {
    runLog(run.runDir, { event: "knockout-review", outcome: "nothing-flagged", flagged: 0, listed: 0,
      marks: merged.marks.length, excludedMarks: about.marks.length, excludedOwners: about.owners.length });
    return merged;
  }

  const keep = (outcome, detail) => {
    keepOpen();
    runLog(run.runDir, { event: "knockout-review", outcome, flagged: d.flagged, listed: d.listed, applied: 0,
      delivered: "the rated record, unrewritten", ...detail });
    note(`reviewing pass: ${outcome} — the rated record ships unrewritten`);
    return merged;
  };

  try {
    await koStage("knockout-review", ctx, {
      msgCtx: { ...d.msgCtx, sourceAnswers: sourceAnswered.map(sourceAnswerLine) },
    });
  } catch (e) {
    return keep("stage-failed", { reason: String(e?.message ?? e).slice(0, 200) });
  }

  let review;
  try { review = JSON.parse(readFileSync(knockoutReviewFile(run.runDir), "utf8")); }
  catch (e) { return keep("artifact-unreadable", { reason: String(e?.message ?? e).slice(0, 200) }); }

  // A MATERIAL DEFECT GOES TO THE STEP THAT CAN REPAIR IT, once, and the corrected record is read again.
  if (review.material?.length || sourceDefects.length) {
    const work = correctionWork({ rated: merged, material: [...(review.material ?? []), ...sourceDefects], chunks });
    keepChunkBases(run.runDir, chunksOf(work));
    atomicWrite(correctionWorkPath(run.runDir), JSON.stringify(work, null, 2) + "\n");
    return correctAndRecheck({ ctx, run, K, plan, chunks, composeRecord, work, firstReview: review, merged });
  }

  const { doc, receipt } = applyKnockoutReview(merged, review);
  // THE REWRITTEN RECORD GOES THROUGH THE SAME GATE. Not a lighter one and not none: this is the record
  // a client receives, and the only reason it is trusted is that it passed what the rated one passed.
  const mv = validateMergedFindings(run.runDir, doc, plan);
  if (!mv.ok) return keep("rewrite-refused-by-the-merged-gate", { failures: mv.failures.slice(0, 5) });

  atomicWrite(K.findings, JSON.stringify(doc, null, 2) + "\n");
  runLog(run.runDir, { event: "knockout-review", outcome: "applied", flagged: d.flagged, listed: d.listed,
    applied: receipt.applied, declined: receipt.declined,
    unresolved: receipt.unresolved.length, refused: receipt.refused.length,
    excludedMarks: about.marks.length, excludedOwners: about.owners.length });
  return doc;
}

/**
 * Is the review round this run began still about the record it holds? Not when a chunk was rated again on this pass, or
 * when anything the first review read has changed other than the record and its message, which the round's own
 * corrections change. With no record of what the first review read, its freshness is unknown, so the round is not kept.
 * Returns why it is obsolete, or null.
 */
function reviewRoundObsolete({ ctx, run, K }) {
  if (ctx.koRated?.size) return { why: "a chunk was rated again on this pass", chunks: [...ctx.koRated] };
  const stamp = readStamp(run.runDir, "knockout-review");
  if (!Array.isArray(stamp?.inputs) || !stamp.inputs.length) return { why: "no record of what the first review read" };
  const notTheRoundsOwn = (e) => e.path !== K.findings && e.path !== "value:message";
  const now = koReadsNow(KO_STAGES["knockout-review"], K, "knockout-review", "", ctx);
  const d = diffFingerprint(stamp.inputs.filter(notTheRoundsOwn), now.filter(notTheRoundsOwn));
  return d.stale ? { why: "what the first review read has changed", changed: d.changed } : null;
}

/**
 * Set an obsolete review round aside, kept: each chunk it corrected goes back to its rating, except one rated again on
 * this pass, which keeps its new rating; then the round's work, chunk bases, corrections and reviews move under
 * `_driver/knockout-review-set-aside/`, so the next round keeps its own bases and its reviews run afresh.
 */
function setAsideTheRound(runDir, work, rated, why) {
  const touched = chunksOf(work);
  restoreChunkBases(runDir, touched.filter((c) => !rated.has(c)));
  const dest = driverDir(runDir, "knockout-review-set-aside", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dest, { recursive: true });
  const moved = [];
  for (const f of [correctionWorkPath(runDir), paths(runDir).knockoutCorrections, knockoutReviewFile(runDir, 0), knockoutReviewFile(runDir, 1),
    ...touched.flatMap((c) => [chunkBasePath(runDir, c), knockoutCorrectionFile(runDir, c)])]) {
    if (!existsSync(f)) continue;
    renameSync(f, join(dest, basename(f)));
    moved.push(basename(f));
  }
  runLog(runDir, { event: "knockout-review-round-set-aside", ...why, moved });
  note(`reviewing pass: the round begun on the earlier rating is set aside (${why.why}); the record is read afresh`);
}

/** What the check compares: the source left out and the claim as it stood, beside the record it reads. */
export const sourceAnswerLine = (d) => `- "${d.mark}", finding "${d.name}"${d.removed ? ", since removed" : ""}: it cited "${d.cited}". The claim then: ${JSON.stringify(d.was?.net ?? "")}, on the ground ${JSON.stringify(d.was?.basis ?? "")}.`;

const sourceProblem = (d) => (d.kind === "weighed"
  ? `This finding listed "${d.cited}" among the filings it weighed, which this run does not hold, and it was left out. Give the claim held support, or amend it.`
  : `This finding cited "${d.cited}", which is not traceable to ${PERMITTED_SOURCES}, and the citation was left out. Give the claim held support, or amend it.`);

/** The sources the rating step lost and did not address, as defects on the findings they stood behind, in the record's numbering. */
function sourceDefectsOf(runDir, merged, chunks) {
  return chunks.flatMap((_, c) => knockoutAssessSourceDefects(runDir, c)).filter((d) => d.state !== "answered").map((d) => {
    const mark = merged.marks.find((m) => String(m?.name ?? "") === String(d.mark ?? ""));
    const finding = (mark?.findings ?? []).find((f) => sameFinding(f, d));
    if (!finding) return null;
    return { kind: "source", mark: d.mark, finding: finding.ordinal, rests_on: [],
      problem: sourceProblem(d) };
  }).filter(Boolean);
}

const readJsonOrNull = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const chunksOf = (work) => [...new Set((work?.defects ?? []).map((x) => x.chunk).filter((c) => c != null))];

/**
 * One correction and one recheck. Each chunk a defect names goes back to the rating step; the record is composed again through the
 * same steps and gate; and a fresh reader reads the result, with what became of each defect. There is no third look. What it still
 * finds, and any defect no one answered, stays on the record for the reviewing lawyer. Nothing here can cost a client the report,
 * and no defect leaves the record by a step failing: a repair the record cannot stand with goes back name by name, and a stage that
 * fails leaves what it had accepted.
 */
async function correctAndRecheck({ ctx, run, K, plan, chunks, composeRecord, work, firstReview, merged }) {
  const touched = chunksOf(work);
  const correctedNames = [...new Set(work.defects.map((x) => x.mark))];
  const log = (outcome, detail = {}) => runLog(run.runDir, { event: "knockout-review", outcome, material: work.defects.length, marks: correctedNames.length, ...detail });
  const asOpen = (defects, state, reason = null) => defects.map((x) => ({ kind: x.kind, mark: x.mark, problem: x.problem, state, ...(reason ? { reason } : {}) }));
  const keepRecord = (record) => { try { atomicWrite(paths(run.runDir).knockoutCorrections, JSON.stringify(record, null, 2) + "\n"); } catch (e) { note(`corrections record not kept (non-fatal): ${String(e?.message ?? e).slice(0, 160)}`); } };
  const failed = [];
  for (const c of touched) {
    try {
      await koStage("knockout-correct", ctx, { chunkNo: c, msgCtx: { work, chunkMarks: chunks[c], framework: ctx.framework, frameworkMethod: ctx.frameworkMethod ?? null } });
    } catch (e) {
      if (e instanceof StageFailure && (e.rateLimited || e.resetsAt)) throw e;
      failed.push({ chunk: c, reason: String(e?.message ?? e).slice(0, 200) });
    }
  }
  // Back to the record as it was rated, through the same gate, with every defect still open and why.
  const standDown = (outcome, detail) => {
    restoreChunkBases(run.runDir, touched);
    atomicWrite(correctionWorkPath(run.runDir), JSON.stringify({ ...work, stoodDown: outcome }, null, 2) + "\n");
    keepRecord({ defects: work.defects, outcomes: [], recheck: "not-run", failure: outcome, failedChunks: failed, open: asOpen(work.defects, "not-corrected", outcome) });
    let rated = merged;
    try { rated = composeRecord(); } catch (e) { note(`the rated record could not be composed again (non-fatal): ${String(e?.message ?? e).slice(0, 160)}`); }
    log(outcome, { applied: 0, delivered: "the rated record, uncorrected", ...detail });
    note(`reviewing pass: ${outcome} — the rated record ships uncorrected`);
    return rated;
  };
  if (failed.length === touched.length && !touched.some((c) => existsSync(knockoutCorrectionFile(run.runDir, c)))) return standDown("correction-failed", { reason: failed[0]?.reason });

  // A REPAIR THE RECORD CANNOT STAND WITH GOES BACK, name by name, and the others stay.
  let corrected = null, gateCause = null;
  const rolledBack = [];
  try { corrected = composeRecord(); }
  catch (e) {
    gateCause = String(e?.message ?? e).slice(0, 300);
    for (const name of correctedNames) {
      const kept = touched.map((c) => [c, readFileSync(K.assessChunk(c), "utf8"), existsSync(knockoutCorrectionFile(run.runDir, c)) ? readFileSync(knockoutCorrectionFile(run.runDir, c), "utf8") : null]);
      rollBackName(run.runDir, work, name);
      try { corrected = composeRecord(); rolledBack.push(name); break; }
      catch { for (const [c, text, receipt] of kept) { writeFileSync(K.assessChunk(c), text); if (receipt != null) writeFileSync(knockoutCorrectionFile(run.runDir, c), receipt); } }
    }
    if (!corrected) return standDown("correction-refused-by-the-merged-gate", { reason: gateCause });
  }
  // A CHANGE OUTSIDE THE DEFECTS IS RECORDED AND RECHECKED, as a clearance records it (design ruling, 2026-11-10: the
  // Knockout corrects the clearance's way). It no longer stands the correction down: each moved name is kept with its
  // before and after, and the recheck reads it. A comparison that could not be made sends the recheck to the whole batch.
  const outside = movedOutsideScope(work, corrected);
  const movedNames = [...new Set([...outside.marks, ...outside.blocks])];

  // THE FIRST PASS'S REWRITES STILL STAND ONLY ON A NAME THE CORRECTION DID NOT CHANGE. A rewrite on a changed name was
  // written against the record as rated, and laid over the change it would put back the words the change replaced. With no
  // comparison, no name is known to be unchanged. The second pass reads the record with the survivors on it, as it ships.
  let doc = corrected;
  const survivors = rewritesThatSurvive(firstReview, outside.complete ? [...new Set([...correctedNames, ...movedNames])] : null);
  const rewritesRetired = (firstReview?.rewrites?.length ?? 0) - survivors.rewrites.length;
  const { doc: rewritten, receipt } = applyKnockoutReview(corrected, survivors);
  if (validateMergedFindings(run.runDir, rewritten, plan).ok) { doc = rewritten; atomicWrite(K.findings, JSON.stringify(doc, null, 2) + "\n"); }

  const answers = correctionAnswers(run.runDir, touched);
  const outcomes = correctionOutcomes(work, doc, answers);
  const unresolved = unresolvedFlags(outcomes).map((r) => r.n);
  const notAnswered = work.defects.filter((x) => outcomes.find((o) => o.n === x.n)?.outcome === "not-answered");
  const held = { defects: work.defects, outcomes, failedChunks: failed, rolledBack, ...(gateCause ? { gateCause } : {}),
    movedOutsideDefects: outside.moved, comparisonComplete: outside.complete, rewritesRetired };

  const d = reviewDispatch(doc, plan);
  try {
    await koStage("knockout-review", ctx, { chunkNo: 1, msgCtx: { ...d.msgCtx, recheckTable: correctionsAppliedTable(outcomes),
      movedNames, comparisonComplete: outside.complete } });
  } catch (e) {
    if (e instanceof StageFailure && (e.rateLimited || e.resetsAt)) throw e;
    // NOBODY READ THE CORRECTED RECORD, so nothing here can call a defect answered.
    const reason = String(e?.message ?? e).slice(0, 200);
    keepRecord({ ...held, recheck: "failed", failure: reason, open: asOpen(work.defects, "not-rechecked", "recheck-failed") });
    log("recheck-failed", { applied: receipt.applied, unresolved: unresolved.length, reason, movedOutsideDefects: movedNames.length, comparisonComplete: outside.complete });
    return doc;
  }
  const second = readJsonOrNull(knockoutReviewFile(run.runDir, 1));
  const found = second?.material ?? [];
  const open = [...found, ...asOpen(notAnswered.filter((x) => !found.some((m) => m.mark === x.mark && m.kind === x.kind)), "not-answered")];
  keepRecord({ ...held, recheck: "ran", open });
  const again = applyKnockoutReview(doc, second ?? {});
  if (validateMergedFindings(run.runDir, again.doc, plan).ok) { doc = again.doc; atomicWrite(K.findings, JSON.stringify(doc, null, 2) + "\n"); }
  log("corrected", { applied: receipt.applied + again.receipt.applied, unresolved: unresolved.length, open: open.length, failedChunks: failed.length, rolledBack: rolledBack.length,
    movedOutsideDefects: movedNames.length, comparisonComplete: outside.complete });
  return doc;
}

// ── WHAT A STAGE READ, AND WHETHER ITS OUTPUT STILL STANDS ON IT ────────────────────────────────────────────────
//
// A Knockout stage reuses its output only while what it read is unchanged, through the clearance's own stamps
// (stage-freshness.mjs). It records what it read as it starts (`koReadsNow`, from `reads` in KO_STAGES), and the record
// is written once the stage has run, so it says what the output was based on. On a resume a changed input runs the
// stage again, with a `stage-stale` row naming what changed.
//
// AN OUTPUT WITH NO RECORD IS NOT REUSED. Its freshness is unknown. A clearance reads a missing stamp as fresh, for runs
// that predate its stamps; a Knockout has no such runs to keep, because a run from an earlier build is no longer
// resumed, so reuse here needs the record. (A record that could not be written costs that stage one more run.)

/** The files a folder holds now, as paths, sorted. A folder that cannot be read holds none. */
function filesIn(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(dir, e.name)).sort(); } catch { return []; }
}

// THE REGISTER'S FILES ARE TAKEN AGAIN ON EVERY PASS, and each pass stamps them with when it took them. Measured on two
// passes over one run with nothing changed, these differ in four places and nowhere else: the counts' and the
// records' `takenAt`, a reused count's `reused` mark on its name, and each owner check's `ts` and `took_ms`. So these
// three files are compared on what they say with exactly those four places set aside, through the freshness module's
// projection, and the whole-file sha is still recorded beside it. Nothing else is set aside, at any depth: a count,
// a filing, an owner or what an owner check found that changed is still a change.
const WHEN_IT_WAS_TAKEN = {
  "register-counts.json": ({ takenAt: _takenAt, ...doc }) => ({ ...doc, ...(Array.isArray(doc.marks) ? { marks: doc.marks.map((m) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) return m;
    const { reused: _reused, ...rest } = m;
    return rest;
  }) } : {}) }),
  "register-records.json": ({ takenAt: _takenAt, ...doc }) => doc,
  "owner-checks.json": (doc) => ({ ...doc, ...(Array.isArray(doc.checks) ? { checks: doc.checks.map((c) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return c;
    const { ts: _ts, took_ms: _tookMs, ...rest } = c;
    return rest;
  }) } : {}) }),
};
/** What a retaken register file says, without when it was taken, as a short sha. null for any other file, or one that does not parse. */
export function whatItSays(_label, absPath) {   // @internal
  const without = WHEN_IT_WAS_TAKEN[basename(String(absPath ?? ""))];
  if (!without) return null;
  try {
    const doc = JSON.parse(readFileSync(absPath, "utf8"));
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    return createHash("sha256").update(JSON.stringify(without(doc))).digest("hex").slice(0, 12);
  } catch { return null; }
}

/**
 * What stage `def` reads, as a fingerprint taken now: its files, the files its folders hold, its message, and, for a
 * stage that rates, the framework deck the model is sent to. null when it declares none.
 *
 * THE DECK IS THE FILE THE MODEL READS. Its message names the deck by path, and the model reads it from whichever
 * layer is in force: the deployment's private instructions first, then the shipped tree (`config.resolveSkillPath`,
 * the same resolver the framework freeze uses). So the deck is recorded as that file's content, and which file is in
 * force is recorded beside it: an edited private deck, or a private deck added or removed, is a change. The method
 * is frozen with the run (`framework-method.json`) and declared with the frozen rules.
 */
export function koReadsNow(def, K, label, message, ctx = null) {   // @internal
  const r = def?.reads?.(K) ?? null;
  if (!r) return null;
  const dirs = r.dirs ?? [];
  const files = [...(r.files ?? []), ...dirs.flatMap(filesIn)];
  const values = Object.fromEntries(dirs.map((d) => [`files under ${basename(d)}`, filesIn(d).map((p) => basename(p)).join("\n")]));
  if (r.message) values.message = String(message ?? "");
  if (r.deck && ctx?.frameworkPath) {
    const deck = config.resolveSkillPath(ctx.frameworkPath);
    files.push(deck);
    values["deck in force"] = deck;
  }
  return fingerprint(files, { label, values, project: whatItSays });
}

/** Does the output of `label` still stand on what it read? PURE but for one read of its record. */
export function koStaleness(runDir, label, now) {   // @internal
  const stamp = readStamp(runDir, label);
  if (!Array.isArray(stamp?.inputs) || !stamp.inputs.length) return { stale: true, reason: "no record of the inputs it was produced from", changed: [] };
  const d = diffFingerprint(stamp.inputs, now);
  return d.stale ? { stale: true, reason: "an input changed since it ran", changed: d.changed } : { stale: false, changed: [] };
}

/**
 * Which owner checks this run already holds an answer to, and which it must still ask. PURE but for reads of the
 * answers' own files.
 *
 * AN OWNER CHECK IS PAID FOR, AND ITS ANSWER DOES NOT CHANGE WITHIN THE RUN (2026-11-11), as a register answer does
 * not. So a resume asks again only what the run holds no answer to. A held row answers an owed check only when it is
 * the same question: the same name, owner, filings and classes, the same words put to the provider at the same depth,
 * and an answer whose payload is still under research/ beside it. Anything else is unfinished work and is asked: a
 * failed check, a check with no row, a row whose payload is gone, and an owner or filing that changed. A changed
 * owner does not inherit another owner's answer. A held row is returned as it was written, its time and its sources
 * included, so what the rating reads is the evidence the run paid for.
 */
export function heldOwnerChecks(priorRows, owed, { runDir, preset }) {   // @internal
  const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && [...a].map(String).sort().join("\u0000") === [...b].map(String).sort().join("\u0000");
  const rows = Array.isArray(priorRows) ? priorRows : [];
  const held = new Map();
  const ask = [];
  owed.forEach((o, i) => {
    const payloadFile = ownerPayloadFile(o);
    const row = rows.find((r) => r?.ok === true && r.mark === o.mark && r.owner === o.owner
      && sameSet(r.recordIds, o.recordIds) && sameSet(r.classes, o.classes)
      && r.query === composeOwnerQuery(o) && r.preset === preset && r.payloadFile === payloadFile);
    let answer = null;
    try { answer = row ? readFileSync(join(runDir, "research", payloadFile), "utf8") : null; } catch { answer = null; }
    if (row && isResearchAnswer(answer)) held.set(i, row); else ask.push(o);
  });
  return { held, ask };
}

async function koStage(name, ctx, { chunkNo = null, msgCtx = {} } = {}) {
  // — the stage's own start, captured before ANY work: before the existsSync, before the validator
  // read, before the message composition. states why on the spine — capture it after the await and
  // every field is still present, every presence assertion still passes, and every interval is ~0 ms, so
  // the journal would assert that a four-minute assess took nothing.
  const tDispatch = Date.now();
  const def = KO_STAGES[name];
  const K = ctx.K;
  const out = def.out(K, chunkNo ?? undefined);
  const label = chunkNo != null ? `${name}#${chunkNo}` : name;
  const model = process.env.CLEAROTRON_KNOCKOUT_MODEL || def.model;
  const message = def.message({ ...ctx, K, chunkNo, ...msgCtx });
  const readsNow = koReadsNow(def, K, label, message, ctx);
  if (existsSync(out)) {
    const v = def.validate(out, readFileSync(out, "utf8"));
    const fresh = v.ok && readsNow ? koStaleness(ctx.paths.runDir, label, readsNow) : { stale: false, changed: [] };
    if (v.ok && !fresh.stale) {
      // Was `{event:"stage-skip"}`, which nothing read: mcp-server/lib/events.mjs classifies `stage` and
      // `skip` and dropped this lane on the floor, so a knockout run's stages were invisible in get_run
      // while the clearance spine's were not. Renamed rather than duplicated — no legacy path, and the
      // grep that found its only reader found none.
      runLog(ctx.paths.runDir, { event: "skip", stage: label, lane: "knockout", trigger: "skip", ok: true,
        model, output: outputMeta(out), ...stageWallFields(tDispatch) });
      recordTransition(ctx, name);   // as a clearance's stage records it: the stage the run is at, on a resume too
      return { ok: true, skipped: true };
    }
    runLog(ctx.paths.runDir, { event: "stage-stale", stage: label, reason: v.ok ? fresh.reason : v.reason, ...(fresh.changed.length ? { changed: fresh.changed } : {}) });
  }
  // The run is in this stage from the moment it dispatches, as a clearance's stage records it. The bare name, so a
  // batch's chunks are one stage. No Knockout stage has a step on the clearance's stepper, so this moves no step.
  recordTransition(ctx, name);
  const r = await runStage(label, {
    agent: ctx.agent,
    message,
    model, thinking: def.thinking,
    sessionKey: `clearance-${ctx.run.slug}-${ctx.run.codename}-${label}`,
    timeoutSec: def.timeoutSec, stallSec: def.stallSec,
    expectFile: out, validate: def.validate, runDir: ctx.paths.runDir,
  });
  // BEFORE the throw, and with `ok` on the row. A stage that failed still spent its wall, and a lane
  // whose failures leave no completion row reports its own cost as smaller than it was — which is the
  // reading error exists to prevent, in the direction that flatters.
  runLog(ctx.paths.runDir, { event: "stage", stage: label, lane: "knockout", trigger: "fresh",
    // — the knockout lane's own copy of the clearance lane's defect, found by counting the stage
    // events rather than trusting that there was one. It wrote the ASSIGNED alias, so a codex knockout
    // named an Anthropic model on the line a reader skims. Same precedence as the clearance stage event:
    // the wire's word, then the engine's resolution, then the assignment as the unchanged legacy fallback.
    ok: r.ok, attempts: r.attempts ?? null, fail: r.fail ?? null,
    model: r.modelWire ?? r.modelUsed ?? model,
    modelSelector: model,          // — what re-spawns the writer, beside what ran
    output: outputMeta(out), outputWritten: r.wrote ?? null, ...stageWallFields(tDispatch) });
  if (!r.ok) throw new StageFailure(label, r.fail ?? "failed", r.resetsAt);
  if (readsNow) writeFingerprint(ctx.paths.runDir, label, readsNow);
  // A chunk rated again on this pass makes any review round begun on the old rating obsolete (knockoutReviewingPass).
  if (name === "knockout-assess") (ctx.koRated ??= new Set()).add(chunkNo);
  recordTransition(ctx, name);
  return r;
}

// ── THE READING STEP, around its model turn ──────────────────────────────────────────────────────────
//
// The counts have landed and nothing has been read. The code writes the run's question plan; the turn looks at the counts,
// asks what the reading rule calls for, and hands back its judgment. The record every later stage reads is built here,
// from what the register answered and what the turn said.
//
// NEVER TERMINAL, the rule this lane has always held for its filings: the counts are the product, and a run that got
// them delivers. When a turn fails the record keeps every answer the run holds and every decision the turn had settled,
// with the failure on it, and nothing more is fetched: listing each smaller count is no recovery. A rate limit is not
// that failure: it parks and resumes as every stage's does, and the resume reuses each answer held.
async function readTheRegister({ ctx, job, K, run, agent, markRows, plan, counts, countExec, opts }) {
  const register = ctx.register ?? REGISTER_PROVIDER;   // the run's register (ctx.register), the machine's where none is named
  const names = markRows.map((m) => ({ name: String(m.name), classes: Array.isArray(m.classes) ? m.classes : null }));
  const exec = resolveQuestionExecutor({
    lister: opts?.recordLister ?? null, adapter: adapterForRegister(ctx.register),
    agentId: agent, sessionKey: `clearance-${run.slug}-${run.codename}`, recordLog: runRecordLogPath(run.runDir),
    // A fixture run never reaches a live register: if the counts ran on fixtures this lane may not either.
    offline: countExec.source.startsWith("fixtures:"),
    fixtureDir: job?.registerFixtures?.records ?? null,
  });
  const refusal = countExec.source.startsWith("fixtures:") && exec.source === "none"
    ? "this run counted from fixtures and its job declares no `registerFixtures.records` directory, so the "
      + "filings behind the counts were not listed — a fixture run never reaches a live register."
    : recordsPreflight({ capabilities: ctx.registerCaps, hasAdapter: exec.source !== "none" });
  if (refusal) {
    atomicWrite(K.registerRecords, JSON.stringify({
      schema: 2, provider: register, providerLabel: ctx.registerCaps?.label ?? register,
      takenAt: new Date().toISOString(), unavailable: refusal, marks: [],
    }, null, 2) + "\n");
    note(`register filings not listed: ${refusal}`);
    runLog(run.runDir, { event: "knockout-register-records-refused", provider: register, reason: refusal });
    return null;
  }
  const unreachable = exec.source === "provider" ? (ctx.registerUnreachable ?? []) : [];
  const scope = { marks: names, classes: job.classes ?? null, jurisdictions: job.jurisdictions ?? null, capabilities: ctx.registerCaps, unreachable };
  const build = (reading) => knockoutRecordsDoc({ ...scope, provider: register, counts, reading, framedMarks: plan.marks,
    readBlocks: (name) => knockoutBandBlocks(run.runDir, name), readProposals: (name) => knockoutProposals(run.runDir, name) });
  try {
    if (exec.fixtureDir) writeFixtureMarker(run.runDir, exec.fixtureDir);
    atomicWrite(questionPlanPath(run.runDir), JSON.stringify(knockoutQuestionPlan({ ...scope, framedMarks: plan.marks }), null, 2) + "\n");
    mkdirSync(join(run.runDir, "register-units"), { recursive: true });
  } catch (e) {
    note(`register filings listing failed (non-fatal): ${e.message}`);
    runLog(run.runDir, { event: "knockout-register-records-failed", provider: register, cause: String(e?.message ?? e).slice(0, 300) });
    return null;
  }

  let reading = null;
  try {
    // A REGISTER INJECTED IN-PROCESS has no tool server a model turn could reach, so the code asks what the plan owes each name.
    if (exec.source === "injected") {
      const framedOf = (name) => (plan.marks ?? []).find((f) => String(f?.name ?? "").trim().toLowerCase() === name.toLowerCase()) ?? null;
      const owedOf = (name) => [
        ...((counts.marks ?? []).find((m) => String(m?.name) === name)?.counts?.identical?.total > 0 ? formsOfName(name, framedOf(name)).map((_, i) => formQid(name, i)) : []),
        ...addedClassQuestions(run.runDir, name).map((q) => q.qid)];
      await runBatched(names.map((m) => m.name).filter((name) => owedOf(name).length), 3, async (name) => {
        const r = await exec.execute({ planPath: questionPlanPath(run.runDir), axis: knockoutAxis(name), outputPath: knockoutBandPath(run.runDir, name),
          qids: owedOf(name) });
        if (r?.ok === false) note(`register list for one name did not complete (non-fatal): ${String(r.cause ?? "").slice(0, 160)}`);
      });
    } else {
      const inScope = [...new Set(names.flatMap((m) => m.classes ?? []).concat(Array.isArray(job.classes) ? job.classes : []))].join(", ") || null;
      await koStage("knockout-register-read", ctx, { msgCtx: {
        readingLines: readingTableLines({ marks: names, counts, classes: job.classes ?? null, framedMarks: plan.marks, runDir: run.runDir }),
        providerDoc: adapterForRegister(ctx.register)?.skillDoc ?? null, inScope,
      } });
      reading = JSON.parse(readFileSync(K.registerReading, "utf8"));
      runLog(run.runDir, { event: "knockout-register-read", names: reading.marks?.length ?? 0 });
    }
  } catch (e) {
    if (e instanceof StageFailure && (e.rateLimited || e.resetsAt)) throw e;
    note(`register reading step did not finish (non-fatal): ${String(e?.message ?? e).slice(0, 200)}`);
    runLog(run.runDir, { event: "knockout-register-read-failed", cause: String(e?.message ?? e).slice(0, 300) });
    reading = settledKnockoutReading(run.runDir);
  }
  try {
    const doc = withHeldGoods(build(reading), run.runDir, { runPrefix: `clearance-${run.slug}-${run.codename}` });
    atomicWrite(K.registerRecords, JSON.stringify(doc, null, 2) + "\n");
    appendQuestionReceipts(K.countLedger, doc, { provider: register });
    runLog(run.runDir, { event: "knockout-register-records", provider: register, executor: exec.source,
      marks: doc.marks.length, listed: listedMarks(doc), records: doc.marks.reduce((n, m) => n + m.records.length, 0),
      questions: doc.marks.reduce((n, m) => n + m.terms.filter((t) => t.qid?.startsWith("supp:")).length, 0), reading: reading ? "finished" : "not-finished" });
    return doc;
  } catch (e) {
    note(`register filings listing failed (non-fatal): ${e.message}`);
    runLog(run.runDir, { event: "knockout-register-records-failed", provider: register, cause: String(e?.message ?? e).slice(0, 300) });
    return null;
  }
}

// ── The sweep's executors: injected (tests) → fixtures dir (the $0 offline guarantee) → the live
// RESEARCH_PROVIDERS.perplexity adapter. Two of them, because the lane asks the web two kinds of thing:
//   grid  async (spec, {mark, preset, reasoning}) -> { ok, ledgerJson?, requested?, present?, cause?, raw?, tookMs? }
//         one mark's web search, every spelling on every place, with every result kept;
//   exec  async (task, {mark, preset}) -> { ok, text?, cause?, raw?, tookMs? }
//         one question, which the owner lookups ask.
// The fixtures dir holds <mark-kebab>.grid.json, the grid program's printed ledger for a mark, and
// <mark-kebab>.md, the answer to a question asked about that mark.
export function resolveSweepExecutor(opts) {   // exported for its test, like readBackLadder above
  if (typeof opts?.gridExecutor === "function" || typeof opts?.sweepExecutor === "function")
    return { grid: opts.gridExecutor ?? null, exec: opts.sweepExecutor ?? null, source: "injected" };
  const fixDir = process.env.CLEAROTRON_KNOCKOUT_SWEEP_FIXTURES;
  if (fixDir) {
    return {
      source: `fixtures:${fixDir}`,
      // THE FIXTURE GOES THROUGH THE LIVE PATH'S OWN RECONCILE, so a canned ledger missing a cell reads
      // exactly as a live one would: the missing cell becomes an honest gap, never a silent hole.
      grid: async (spec, { mark }) => {
        const file = `${kebab(mark)}.grid.json`;
        let printed;
        try { printed = readFileSync(join(fixDir, file), "utf8"); }
        catch (e) { return { ok: false, cause: `fixture missing for ${file}: ${e.message}` }; }
        try {
          const { reconcileGridLedger } = await import("../providers/perplexity/src/core.js");
          const rec = reconcileGridLedger(printed, spec);
          const ledgerJson = JSON.stringify(rec.ledger, null, 2);
          return { ok: true, ledgerJson, requested: rec.requested, present: rec.present, bytes: Buffer.byteLength(ledgerJson) };
        } catch (e) { return { ok: false, cause: `grid: fixture ${file} did not reconcile: ${String(e?.message ?? e).slice(0, 160)}` }; }
      },
      exec: async (_task, { mark }) => {
        const file = `${kebab(mark)}.md`;
        try {
          const text = readFileSync(join(fixDir, file), "utf8");
          return { ok: true, text, bytes: Buffer.byteLength(text) };
        } catch (e) { return { ok: false, cause: `fixture missing for ${file.replace(/\.md$/, "")}: ${e.message}` }; }
      },
    };
  }
  // acceptance 6 — NO CAPABILITY REFUSES THE SCREEN FOR WANT OF A KEY. The live sweep needs a
  // research credential this deployment may not hold, and under ADR-0003 that is a choice between
  // refusing at preflight and degrading with a disclosure. It degrades: `registerProbe` is true on the
  // knockout row of PRODUCT_POLICIES, so the filing counts are in the product independently of this
  // call, and a keyless screen returns them and states the half that did not run.
  //
  // A SKIP RATHER THAN AN EXEC, and that is the whole mechanism. Deleting the preflight throw alone
  // would have been the wrong fix and the comment at that throw says why: the executor would be called
  // per mark, the cred-guard would degrade each one, and the batch would die at the all-failed branch
  // AFTER the paid frame turn — worse than the refusal, and it costs money to reach. Not-attempted and
  // attempted-and-failed are different runs; this is the first.
  if (!process.env.PERPLEXITY_API_KEY) return { source: "perplexity", grid: null, exec: null, skipped: "common-law-no-credential" };
  return {
    source: "perplexity",
    grid: (spec, { preset, reasoning }) => RESEARCH_PROVIDERS.perplexity.grid(spec, { preset, reasoning }),
    exec: (task, { preset }) => RESEARCH_PROVIDERS.perplexity.research(task, { preset }),
  };
}

// bounded-concurrency fan-out (local copy of the runBatched idiom — pipeline.mjs's is private).
// A non-finite limit collapses to 1 worker, never to zero (Array.from({length: NaN}) is [] — a typo'd
// concurrency env var would otherwise silently skip the ENTIRE sweep; review 2026-07-17).
async function runBatched(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const cap = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
  const workers = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return results;
}

// ── The lane ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * THE SURVIVOR BOUNDARY — the sentence that says what a knockout screen is NOT.
 *
 * The boundary of the screen is stated by the ENGINE rather than left to the assessing model, which is
 * the one party that cannot see it: a screen cannot know what it did not look for.
 *
 * The PRODUCT comes off the frozen policy through the registry join — the same name the masthead prints,
 * so the page cannot say one thing in the header and something else in the caveat.
 *
 * `.identity`, NOT `.banner`. Banner leads with the stage label, so on the two retired knockout
 * rows this caveat read "at the configured depth (Depth 1 — Knockout review)": a rung on a ladder the
 * offering no longer has, printed in client-facing prose, on the same page whose masthead had just
 * stopped printing one. The phrase "the configured depth" went with it — the screen is named by the
 * product it IS. A policy that resolves to no name says "a knockout screen" rather than asserting one.
 *
 * EXTRACTED FROM knockoutInner, WITH ITS GUARD, because the two must not drift. The idempotence check
 * used to be a regex literal written out beside the sentence, and rewording the sentence left the guard
 * matching the OLD phrase — so a re-merge would have appended a SECOND copy of the boundary to the
 * delivered report, and nothing in 3,891 tests could see it. They are now one exported pair: the regex
 * matches the invariant clause of the sentence this function builds, and a test holds them together.
 */
// — DEFINED IN verify-knockout.mjs NOW, and re-exported here so existing importers
// are untouched. The verifier needs it to tell the engine's own caveats from the rater's, and the import
// direction is producer -> verifier; it cannot be the other way without a cycle.
export { SURVIVOR_BOUNDARY_RE };

export function survivorBoundaryNote(policy) {
  const product = reportIdentityFor(policy ?? null).identity;
  const screenName = product ? `a ${product}` : "a knockout screen";
  return `This is ${screenName}, not a clearance. A mark not knocked out here is not clear — it is not knocked out at this screen's depth, and proceeds to clearance. Nothing above is a finding of availability.`;
}

// ── a next-step section the model wrote comes off, in code ──────────────────────────────────────────
//
// Each name's read is published as its own report, and the screen states findings and a rating — what to
// do with the name is the reading lawyer's. A heading the model wrote over a next step, and the section
// under it, are removed here and named in the run record; `knockout-next-step.mjs` says what counts. This
// replaced a pre-delivery refusal that re-asked the whole chunk for the same edit (owner, 2026-09-19).
// EXPORTED so the record line is driven directly, not only through a whole pipeline.
export function removeNextStepSections(runDir, marks) {
  const out = [];
  for (const m of marks ?? []) {
    if (typeof m?.assessment !== "string") continue;
    const { text, removed } = stripNextStepSections(m.assessment);
    if (!removed.length) continue;
    m.assessment = text;
    const row = { event: "knockout-next-step-removed", mark: m.name, headings: removed.map((r) => r.heading),
      chars: removed.reduce((n, r) => n + r.chars, 0), lane: "knockout" };
    runLog(runDir, row);
    out.push(row);
  }
  return out;
}

// What the failure path takes from this product. A failure whose error names no stage is named "knockout", the stage the
// notice then names; a stop names its stage with "(knockout)" after it, as the staff read it in the stop reason.
export const KNOCKOUT_ENDING = Object.freeze({ unnamedStage: "knockout", stopStage: (stage) => `${stage} (knockout)`, logTag: "knockout" });

export async function knockoutInner(ctx, job, opts = {}) {
  const { run, agent, paths: P } = ctx;
  const register = ctx.register ?? REGISTER_PROVIDER;   // the run's register (ctx.register), the machine's where none is named
  const K = ctx.K = koPaths(run.runDir);
  const policy = ctx.searchPolicy;
  const runId = `${run.slug}-${run.date}-${run.codename}`;   // same shape as clearance (seedRunStatus) — one format across every consumer
  // A Knockout's own steps, in order, run by run-shell.mjs. A value one step hands a later one is held here, between
  // them. The last step returns the delivered run; a failure in any step ends through run-failed.mjs.
  let sweep, probeWanted, countExec, markRows, markNames, STEPS, plan, planMarks, registerCounts, degraded, recovered, chunks, composeRecord, merged, overall, published;
  return await runShell({ P, agent, ctx, job, run }, { ending: KNOCKOUT_ENDING, helpers: { sentinel }, steps: [
    { name: "open", run: async () => {
        // ── — IDENTITY IS SEEDED BEFORE ANYTHING CAN REFUSE ──────────────────────────────────────────
        //
        // `ref` is the ONLY field round discovery matches on — e2e-rounds.mjs coerces a run's status `ref`
        // to a string and tests the prefix, and nothing else is consulted. (Phrased without the
        // "key: <quoted token>" shape on purpose: gitleaks' generic-api-key rule fires on it in prose.) And
        // `findRunsByRef`'s own docstring says it keys on status.json rather than meta.json *"so that failed
        // runs stay discoverable"* — meta.json is written at publish time, so discovery by it finds every run
        // that succeeded and not one that failed. The intent was written down; the guarantee was not
        // implemented.
        //
        // A run that dies before the full seat-flow seed below wrote status.json from the FAILURE writer, with
        // no `ref` — so `findRunsByRef` never saw it, `roundSettlement` got `runStates 0` + `markers 0`, and
        // the round settled to "unknown" forever. Re-reading it re-stamps unknown. Measured: one round
        // permanently unclosable, its run dir on disk the whole time with a complete diagnosis in it, while
        // the operator was told the evidence "may have been torn down".
        //
        // TWO PREFLIGHTS REACHED THE FAILURE WRITER BEFORE THE SEED, not one. The register-count refusal
        // below is the one that produced the specimen; a PERPLEXITY_API_KEY refusal above it was the same
        // orphan by a different door. Fixing either call site alone would have left the other, which is why
        // the identity goes HERE — above every refusal — rather than into a refusal's own writer.
        // THE SECOND DOOR IS GONE ( acceptance 6 made it a skip), and that does not make this
        // placement redundant: it is what keeps the next refusal added above the seed from re-orphaning its
        // run. Moving this stamp down into the surviving refusal's writer would rebuild the bug.
        //
        // Merged, not replaced: `writeRunStatus` merges, so the full seed further down still writes the step
        // flow, the mark names and everything else. This carries the fields that answer "which run and which
        // round is this", and nothing that would claim progress it has not made.
        //
        // `startedAt` now backfills HERE rather than at the failure, which is more honest and is the
        // documented first-write-wins behaviour (A3, progress.mjs) rather than a change to it.
        //
        // WHICH PASS THIS IS, here and only here, as a clearance's seed records it (resumeRecord): a fresh run
        // is attempt 1, and a resume records its clock and counts itself. Here because a pass refused in
        // preflight is still a pass; only here because a second seed reading the count back would count twice.
        writeRunStatus(ctx, {
          schema: 1, id: job.id, runId, slug: run.slug, codename: run.codename,
          date: run.date, agent, forwarder: job.forwarder, ref: job.ref ?? null,
          state: "running", lane: "knockout",
          ...resumeRecord(run.runDir, ctx.stateReset),
          // — and the PROCESS and BUILD identity for the same reason the run
          // identity is here: a knockout refused in preflight is exactly the run whose record nobody can
          // otherwise attribute, and it is the one most likely to be asked about. Found by the derived
          // guard (driver/test/both-lanes-seed-identity.test.mjs), not by the issue, which named only the
          // seed further down.
          ...identitySeed(),
        }, null, { critical: true });   // door B — this write's failure is the one that must not be silent

        mkdirSync(K.researchDir, { recursive: true });
        attachKnockoutFramework(ctx);

        // Lane preflight (the doc-27 discipline, knockout flavour). This USED TO REFUSE the whole screen
        // when the live sweep had no credential. It no longer does ( acceptance 6): the resolver
        // returns a SKIP instead, the sweep is never attempted, and the screen delivers its register half
        // with the missing half disclosed. The reason the refusal existed is preserved, not discarded —
        // "the cred-guard degrades every mark per-call and the batch dies all-failed only AFTER the paid
        // frame turn" is exactly what a skip prevents, and prevents earlier than a throw did.
        // (pipelineInner's register preflight is skipped for this lane — knockout has no register machinery.)
        sweep = resolveSweepExecutor(opts);

        // Depth 2 preflight — the SAME discipline, for the register count. Both refusals it can return
        // are structural (a provider that cannot count; a territory scope it cannot express), so they are
        // settled here, once, before the paid frame turn — never twenty identical per-mark failures and a
        // published report with an empty column where the product should have been.
        probeWanted = Boolean(policy.components?.registerProbe);
        // THE RECORD THAT THIS RUN HAS NO REGISTER COMPONENT, so a later step reads a skip from what ran, and never from a missing file.
        if (!probeWanted) atomicWrite(driverDir(run.runDir, REGISTER_LANE_FILE), JSON.stringify({ skipped: true }) + "\n");
        countExec = { count: null, source: "none" };
        if (probeWanted) {
          // — NO REGISTER SET IS A REFUSAL TOO, stamped like the count refusal below. `activeProvider()`
          // throws a plain Error when CLEAROTRON_DATABASE is unset; unstamped, the ladder guessed "unknown"
          // from its prose and parked the run to retry a setting no wait can supply, with the reason only
          // in status.json. The remedy is the deployment, so it ends here, refused, before any spend.
          let registerAdapter;
          try { registerAdapter = adapterForRegister(ctx.register); }
          catch (e) {
            throw new StageFailure("knockout-register-count", e.message, null, { refusal: true, failClass: "deterministic" });
          }
          const caps = capabilitiesFor(register);
          countExec = resolveCountExecutor({
            counter: opts?.countExecutor ?? null, adapter: registerAdapter,
            agentId: agent, sessionKey: `clearance-${run.slug}-${run.codename}`,
            recordLog: runRecordLogPath(run.runDir),
            // FROM THE JOB, not the environment. Whether this run calls a real register
            // is a fact about the run, so it arrives with the run and lands on its record.
            fixtureDir: job?.registerFixtures?.counts ?? null,
          });
          // EVERY required variable. `Boolean(process.env[credEnv])` here was a half-check: it
          // reported "credential present" for a euipo instance holding the id and no secret, and would
          // have done the same for a free-tier instance holding one member of two. fixed the
          // same bug in preflightCredentials and left this site; one predicate now serves both.
          //
          // Computed ONCE and passed BOTH ways: the boolean decides, the names go into the sentence.
          // Recomputing inside the refusal string would be a second read of the environment between the
          // decision and the message, which is how a refusal comes to name a variable that is set.
          const missing = countExec.source === "provider" ? missingCredentials(registerAdapter) : [];
          // — the offices this box cannot reach, COMPUTED ONCE for both Depth 2 lanes and for the
          // refusal below, for the same reason `missing` is computed once above: a second read of the
          // environment between the decision and the message is how a refusal comes to name a variable
          // that is set, and here it would also let the count lane and the record lane narrow to different
          // scopes on the same run.
          //
          // ONLY when the counter is the real provider. On fixtures or an injected counter the offices this
          // deployment can reach are not what the lane is talking to, and splitting on them would defer a
          // register the fixture holds — a $0 lane reporting a gap it does not have (the shape a
          // sibling defect had, and the reason `missing` carries the same guard).
          const unreachable = countExec.source === "provider" ? registerUnavailableOffices(caps) : [];
          ctx.registerUnreachable = unreachable;
          const refusal = countPreflight({
            capabilities: caps, jurisdictions: job.jurisdictions ?? null,
            hasAdapter: countExec.source !== "none",
            credentialPresent: missing.length === 0,
            missing, unreachable,
          });
          // — A REFUSAL, STAMPED AS ONE. Every arm countPreflight can return is the product declining
          // an ORDER against THIS DEPLOYMENT before a single token is bought: a provider that cannot count,
          // a credential this box does not hold, a territory the provider does not cover, a register it
          // covers and this install cannot reach. None of them is the engine breaking, and no retry moves
          // any of them — the remedy is always the order or the deployment. Recorded unstamped, correct
          // product behaviour landed in the failure channel and the failure counts stopped meaning anything.
          //
          // `failClass: "deterministic"` says the same thing to the OTHER reader: repairs.mjs's ladder. It
          // was stamped when this lane had no ladder for it to reach — "so the fact travels with the throw
          // rather than being re-guessed from prose by whichever catch the throw ends up in." That catch is
          // now this lane's own, the stamp is LIVE, and it is what buys this refusal
          // zero parks without the ladder having to read a word of the prose.
          if (refusal) throw new StageFailure("knockout-register-count", refusal, null,
            { refusal: true, failClass: "deterministic" });
          ctx.registerCaps = caps;
          if (unreachable.length)
            note(`register offices unreachable on this deployment: ${unreachable.map((u) => `${u.office} (${u.memberId}: ${u.missing.join(" + ")} unset)`).join(", ")} — the lane counts and lists the rest and discloses these on every mark`);
        }

        // intake artifacts + the code-authoritative instructed scope (mirrors pipelineInner's blocks —
        // dispatch happens before them, so this lane writes its own; the frame validator reads THIS file).
        try {
          if (job.rawRequest) writeFileSync(P.inboundRequest, String(job.rawRequest));
          if (job.brief) writeFileSync(P.confirmationBrief, String(job.brief));
        } catch (e) { note(`intake artifact write failed (non-fatal): ${e.message}`); }
        markRows = Array.isArray(job.marks)
          ? job.marks.map((m) => (typeof m === "string" ? { name: m } : m)).filter((m) => m?.name)
          : [job.markName ?? job.name].filter(Boolean).map((name) => ({ name }));
        markNames = markRows.map((m) => String(m.name));
        // research artifacts key on kebab(name) — a collision would silently share one payload between two
        // marks (validateJob clarifies this at intake; this guard covers direct dispatch).
        const koll = kebabCollisions(markNames);
        // `failClass: "factual"` — stamped because gave this lane a ladder that would
        // otherwise GUESS. The reason text matches neither classifier regex, so the guess is UNKNOWN, and
        // UNKNOWN buys one park: a ~$2 re-run of a job whose two mark names collide exactly as they did
        // before, ending in the identical throw two minutes later. FACTUAL rather than DETERMINISTIC on the
        // doctrine repairs.mjs states — deterministic means the repairs already ran and retry is futile;
        // factual means no retry can answer it because the answer is a person's. This throw's own remedy
        // sentence says which one it is: reword or drop one and re-enqueue. Both classes buy zero parks, so
        // the choice changes no behaviour — it changes the terminal kind the operator reads.
        if (koll.length)
          throw new StageFailure("knockout-scope", `marks ${koll.map(([a, b]) => `"${a}"/"${b}"`).join(", ")} collide to the same research key — reword or drop one and re-enqueue`, null,
            { failClass: "factual" });
        try {
          writeFileSync(K.instructedScope, JSON.stringify({
            marks: markNames, classes: job.classes ?? null, jurisdictions: job.jurisdictions ?? null,
            goods: job.goods ?? null, customer: job.customer ?? null,
            // per-mark detail (classes/ref from the request, e.g. the cockpit's "NAME [9, 42]" rows) — the
            // frame reads THIS file, so without it those classes silently vanished (review 2026-07-17)
            marksDetailed: markRows.map((m) => ({ name: String(m.name), ...(Array.isArray(m.classes) && m.classes.length ? { classes: m.classes } : {}), ...(m.ref ? { ref: m.ref } : {}) })),
          }, null, 2) + "\n");
        } catch (e) { note(`instructed-scope write failed (non-fatal): ${e.message}`); }
        // The stored defaults the engine cannot search — the clearance lane's record, on this lane too. A
        // knockout reads the same account profile and dropped the same entries in the same silence.
        try {
          const dts = defaultTerritoryState(ctx.profile);
          // two records of one fact, so each has its own try: a fault in one must not take the other
          try { if (dts.unrecognized.length) runLog(run.runDir, { event: "default-territory-unrecognized", count: dts.unrecognized.length, entries: dts.unrecognized, lane: "knockout" }); } catch (e) { note(`default-territory-unrecognized log failed (non-fatal): ${e.message}`); }
          writeFileSync(K.defaultTerritories, JSON.stringify({
            profileKey: ctx.profile?.profileKey ?? null,
            searchable: dts.kept,
            unrecognized: dts.unrecognized,
          }, null, 2) + "\n");
        } catch (e) { note(`default-territories write failed (non-fatal): ${e.message}`); }

        // status seed — knockout's OWN step flow (never seedRunStatus's clearance stepper). Depth 2
        // walks one more step than a plain knockout, so the list is resolved once and frozen on ctx.
        STEPS = ctx.koSteps = koSteps({ registerProbe: probeWanted });
        writeRunStatus(ctx, {
          schema: 1, id: job.id, runId, slug: run.slug, codename: run.codename,
          date: run.date, agent, forwarder: job.forwarder, ref: job.ref ?? null,
          // ONE SPELLING (progress.mjs batchMarkName). This line composed "IRONWHISK (+2 marks)" while the
          // publisher composed "IRONWHISK +2 more" for the SAME batch, so a run changed its name at delivery
          // and the browser — which threads reads on the name string — listed a batch's live face and its own
          // delivered face as two different marks. It also read "(+1 marks)" on every two-mark batch: the
          // same unguarded plural the publisher's title carried until.
          markName: batchMarkName(markNames),
          // THE NAMES THEMSELVES, so a surface can count them. status.json carried a mark STRING and nothing
          // countable, so the portal's live row sent `marks: []` and the Result screen — which reads that
          // array as a name count — told the customer a three-name batch had "0 names" for the whole run.
          // Bands stay off: a live batch has not been rated, and inventing one is the opposite failure.
          marks: markNames.map((name) => ({ name })),
          classes: job.classes ?? null, state: "running", lane: "knockout", stageLabel: policy.stageLabel,
          // — WHO IS RUNNING THIS AND WHICH BUILD. This lane opts out of the
          // clearance STEPPER (see the step list above) and used to lose the identity fields with it, so no
          // knockout run could be attributed to a commit by its own status.json and none was ever eligible
          // for reconcile-runs' exact liveness test. The stepper and the identity are separate calls now.
          ...identitySeed(),
          stepIndex: 0, stepLabel: STEPS[0], stepN: 1, stepTotal: STEPS.length,
          review: null, url: null, failedStage: null, reason: null, deliveredAt: null,
          // A5/A3: a re-run of a previously-terminal knockout may reopen the state ONLY because the resume
          // guard cleared the sentinel (ctx.stateReset threads that authority); startedAt is no longer
          // seeded anywhere — writeRunStatus backfills it first-write-wins.
          ...(ctx.stateReset ? { __stateReset: true } : {}),
        });
        rollupStatus(run.studioRoot);
        // THE SIGNA RUN MEMORY'S ATTEMPT (providers/_shared/answer-memory.mjs): whatever an earlier attempt
        // held is dropped, so a re-run asks the register again, and the mode is fixed for this attempt.
        ctx.answerMemory = beginAnswerMemory(run.runDir, register);
        if (ctx.answerMemory.applies)
          runLog(run.runDir, { event: "answer-memory", mode: ctx.answerMemory.mode, ...(ctx.answerMemory.unknown ? { unrecognised: ctx.answerMemory.unknown } : {}) });
        if (ctx.answerMemory.unknown) note(`answer memory: ${ctx.answerMemory.switch}="${ctx.answerMemory.unknown}" is not off, watch or on, so this register's default applies (${ctx.answerMemory.mode})`);
        note(`=== KNOCKOUT batch (${policy.stageLabel}) — ${markNames.length} mark(s), framework ${ctx.framework.framework_key} ===`);
    } },
    { name: "frame", run: async () => {
        // 1 — frame
        await koStage("knockout-frame", ctx);
        plan = JSON.parse(readFileSync(K.plan, "utf8"));
        planMarks = plan.marks;
    } },
    { name: "evidence", run: async () => {
        // THE WEB SWEEP NEEDS ONLY THE PLAN. Where the register is counted it starts once the counts have passed their check, and runs beside
        // the register reading and its owner checks; elsewhere it starts here. The rating waits for both, and a branch that fails waits for the
        // other to settle, so nothing is left running.
        const sweepMarks = async () => {
          koStep(ctx, "Sweeping marks");
          // WHEN THE SWEEP STARTED, for the minutes recorded against the owner's bar after it. The sweep's own
          // wall clock, not the sum of the marks' — they run side by side, so a sum would report minutes nobody
          // waited. Epoch, never a formatted time.
          const sweepStartedAt = Date.now();
          const { grid, source } = sweep;
          const { preset, reasoning } = KNOCKOUT_WEB;
          // step 3 — was a knob; no environment ever set it. The `Number.isFinite` guard beside it went
          // with the read: a constant cannot be typo'd, which is the hazard that guard existed for.
          const concurrency = 3;
          let callNo = 0;
          const degraded = new Map();
          const outaged = new Set();   // the subset of `degraded` whose cause was a 429/5xx — see the all-failed branch
          const recovered = [];   // previously-degraded marks whose re-sweep succeeded — their stale assess chunks must be invalidated
          if (sweep.skipped) {
            // acceptance 6 — NOT ATTEMPTED. No executor is called, so nothing is billed, nothing can
            // 429, and no `.failed` sentinel is written: there is no failure here to record, and writing one
            // would tell a resumed run that a sweep was tried.
            //
            // Every mark takes the named cause, and that is the ENTIRE downstream wiring. The assess stage
            // already reads it (stages-knockout.mjs renders "(DEGRADED: … — apply the null-results doctrine,
            // never inflate)"), verify-knockout.mjs already REFUSES a row that holds no payload and does not
            // carry degraded:true plus a manual-verification note, and the renderers already print it. The
            // null-results doctrine carries this case; it needed no new path, only a cause.
            for (const m of planMarks) degraded.set(m.name, CAPABILITY_SKIPPED_CAUSE[sweep.skipped] ?? sweep.skipped);
            runLog(run.runDir, { event: "knockout-sweep-skipped", marks: planMarks.length, executor: source, cause: sweep.skipped });
            note(`knockout sweep: not run (${sweep.skipped}) — the screen delivers its register half and discloses the rest`);
          } else {
          runLog(run.runDir, { event: "knockout-sweep-start", marks: planMarks.length, executor: source, preset, reasoning: reasoning.effort, resultsPerCell: KNOCKOUT_WEB.resultsPerCell, concurrency });
          await runBatched(planMarks, concurrency, async (m) => {
            const out = K.research(kebab(m.name));
            if (existsSync(out)) return;   // per-mark resume: only missing payloads re-sweep
            const hadFailed = existsSync(out + ".failed");
            const spec = knockoutGridSpec(m, plan.batch, { outputPath: out });
            const started = Date.now();
            const n = ++callNo;
            // ONE MORE CALL WHEN THE PROGRAM, NOT THE PROVIDER, FAILED. The search program is written by the
            // provider's model each call, and the clearance grid's own guidance retries once when it did not run
            // or printed something unreadable. A provider outage is not retried here: the provider call retried
            // a 429 or 5xx already, and the all-failed branch below parks the batch on it.
            let r = null, attempts = 0;
            const raw = [];   // every attempt's, in order: a retried call's first answer is evidence too
            if (!spec.terms.length || !spec.platforms.length) {
              r = { ok: false, cause: "the plan names no spellings or no places for this mark" };
            } else {
              while (attempts < 2) {
                attempts++;
                try { r = await grid(spec, { mark: m.name, preset, reasoning }); }
                catch (e) { r = { ok: false, cause: `executor threw: ${String(e?.message ?? e).slice(0, 200)}` }; }
                if (Array.isArray(r?.raw) && r.raw.length) raw.push({ attempt: attempts, items: r.raw });
                if (r?.ok || r?.outage === true || !/^grid: /.test(String(r?.cause ?? ""))) break;
              }
            }
            // THE RAW RESULTS ARE KEPT, whether the call answered or not: what the provider returned is the only
            // record of which pages a search reached, and the ledger keeps only what each cell asked for.
            if (raw.length) {
              try {
                mkdirSync(dirname(K.webResults(kebab(m.name))), { recursive: true });
                writeFileSync(K.webResults(kebab(m.name)), JSON.stringify({ mark: m.name, callNo: n, attempts: raw }, null, 1) + "\n");
              } catch { /* the ledger below is the receipt; a raw-results write never fails a mark */ }
            }
            const row = {
              ts: new Date().toISOString(), mark: m.name, callNo: n, preset, reasoning: reasoning.effort, executor: source,
              spellings: spec.terms, places: spec.platforms, ...(spec.use ? { use: spec.use } : {}), resultsPerCell: spec.results_per_cell,
              cells: r?.requested ?? spec.terms.length * spec.platforms.length,
              // The mark's whole wall time, both attempts when there were two: what the client waited for.
              present: r?.present ?? 0, attempts, took_ms: Date.now() - started,
              bytes: r?.bytes ?? (r?.ledgerJson ? Buffer.byteLength(r.ledgerJson) : 0),
              ok: Boolean(r?.ok && r?.ledgerJson), ...(r?.ok && r?.ledgerJson ? {} : { cause: String(r?.cause ?? "unknown").slice(0, 300) }),
            };
            try { appendFileSync(K.sweepLedger, JSON.stringify(row) + "\n"); } catch { /* receipts best-effort, never fatal */ }
            if (row.ok) {
              // THE LEDGER IS THE PAYLOAD. The rating step reads it as it came back: every cell, the listings
              // each search returned, and any search that could not run. It is data, with no words of ours in it.
              writeFileSync(out, r.ledgerJson + "\n");
              if (hadFailed) {
                try { rmSync(out + ".failed"); } catch { /* best-effort */ }
                recovered.push(m.name);
              }
            } else {
              degraded.set(m.name, row.cause);
              if (r?.outage === true) outaged.add(m.name);
              writeFileSync(out + ".failed", `research failed: ${row.cause}\n`);
            }
          });
          if (degraded.size >= planMarks.length) {
            // EVERY mark failed. Whether that ends the batch or pauses it depends on why, and until now it
            // always ended it: the throw carried a prose reason, and StageFailure sets `rateLimited` by an EXACT
            // string match on `reason === "rate_limited"`, so `rateLimited` was false, the lane's own catch wrote
            // .failed immediately, so the run reported a hard failure for a provider hiccup. When this was
            // written the rate-limit re-throw through pipeline()'s outer catch was the lane's ONLY escape
            // hatch and this path could not reach it. added a second one — the class-aware
            // ladder in the catch below — and an outage-shaped reason classifies TRANSIENT there, so this
            // block is no longer the difference between a park and a dead run. It stays because it is the
            // BETTER answer: `rate_limited` postpones on the provider's own clock through the outer catch,
            // where the ladder would spend a recovery attempt to learn the same thing.
            //
            // ALL of them must be outage-shaped, not merely one. A batch where two marks hit a 429 and one hit a
            // bad key is a broken configuration wearing an outage's clothes; parking it would auto-resume
            // forever and bury the real error. Anything mixed, anything unexplained, stays terminal.
            //
            // resetsAt is null: the provider does not surface Retry-After through this path, and runner.mjs's
            // postponedDueAt already applies the default backoff for a null. Better an honest null than a
            // fabricated deadline.
            if (outaged.size >= planMarks.length) {
              note(`knockout sweep: all ${planMarks.length} research calls failed with an outage-shaped status — postponing rather than failing the batch`);
              runLog(run.runDir, { event: "knockout-sweep-outage", marks: planMarks.length, executor: source });
              throw new StageFailure("knockout-sweep", "rate_limited", null);
            }
            throw new StageFailure("knockout-sweep", `all ${planMarks.length} research calls failed (executor ${source}) — nothing to assess`, null);
          }
          if (degraded.size) note(`knockout sweep: ${degraded.size}/${planMarks.length} mark(s) degraded — the batch continues (null-results doctrine)`);
          // ── WHAT THE SWEEP COST, BESIDE THE BAR (ruling 570) ─────────────────────────────────────────────
          //
          // The frame chooses each name's places with no cap, so the only way to know what a knockout costs is
          // to record it. Cells come from the RECEIPTS ON DISK rather than the loop's own variables: a resumed
          // run's earlier marks are in the ledger and not in this process, and the ledger is what a reader has
          // afterwards. The bar is recorded, not applied — nothing above or below this line reads it.
          try {
            const rows = readFileSync(K.sweepLedger, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
            const cells = rows.reduce((n, r) => n + (Number.isFinite(r?.cells) ? r.cells : 0), 0);
            const places = rows.reduce((n, r) => Math.max(n, Array.isArray(r?.places) ? r.places.length : 0), 0);
            // THE SWEEP'S OWN ELAPSED TIME, UNDER A NAME THAT SAYS SO, and the bar is no longer asserted here.
            // The bar is about the RUN (ruling 591) and this span is one stage of it: both knockouts of
            // 2026-09-26 recorded `overBar: false` at 0.6 and 0.8 minutes while the runs took 14.4 minutes
            // wall, which e2e scored as over. A bar recorded against the wrong quantity is worse than an
            // unrecorded one, because the field's name says it answered the question. It is recorded at
            // delivery instead, where the run's own start is readable.
            const sweepMinutes = Number(((Date.now() - sweepStartedAt) / 60000).toFixed(1));
            runLog(run.runDir, { event: "knockout-sweep-total", marks: planMarks.length, calls: rows.length,
              cells, mostPlacesForOneName: places, sweepMinutes });
            note(`knockout sweep: ${cells} cell(s) across ${rows.length} call(s) in ${sweepMinutes} min`);
          } catch { /* the receipts are the record; a summary that could not be read never fails a sweep */ }
          }
          return { degraded, recovered };
        };
        let sweepRun = null;
        // HANDLED FROM THE START. A sweep that fails while the register is still being read rejects with nothing awaiting it yet, and
        // an unhandled rejection ends the process with no status written. The reading's `finally` and the await below take its failure.
        const startSweep = () => {
          if (!sweepRun) { sweepRun = sweepMarks(); sweepRun.catch(() => {}); }
          return sweepRun;
        };

        // 1.5 — STAGE 0.5: the register hit-counts. Pure code — no stage, no model, no turn. It runs
        // BEFORE the sweep because it is the cheap deterministic question and the client sees its answer
        // first; it runs after the frame only so the batch's shape is settled and a frame failure costs
        // nothing at the register. Its own inputs come from the REQUEST, not from the plan (below).
        registerCounts = null;
        if (probeWanted) {
          koStep(ctx, KO_STEP_REGISTER_COUNT);
          ensureDriverDir(run.runDir);
          // ── THE OWNER LOOKUP, ONCE THE LISTING HAS NAMED THE OWNER AND A COUNT HAS LANDED ──────────────
          //
          // Run after the count gate below, whichever lane went first. A batch where not one mark got a
          // number stops at that gate; on a register that lists first the lookups used to run before it,
          // research calls the batch paid for and then threw away.
          const checkOwners = async (recDoc) => {
            if (!recDoc) return;
            // On the run that produced the issue, the owner's name was on disk 48 seconds before the sweep
            // started and no pass ever searched it: every sweep keys on the TERM, and nothing re-swept on an
            // OWNER once the register named one. The assessment then inferred what the owner sold from the
            // owner's name, and deferred the real answer to a document the run did not hold.
            //
            // Bounded to promoted filings and deduplicated per owner — on the issue's own run that is ONE
            // extra query. Never throws: a failure produces rows saying the lookup did not answer, and the
            // run publishes (ruling A, 2026-09-07).
            try {
              const owed = ownersOwedACheck(recDoc);
              if (owed.length) {
                // A resume asks only the checks the run holds no answer to (heldOwnerChecks).
                let prior = [];
                try { prior = JSON.parse(readFileSync(K.ownerChecks, "utf8")).checks ?? []; } catch { /* first pass */ }
                const { held, ask } = heldOwnerChecks(prior, owed, { runDir: run.runDir, preset: KNOCKOUT_WEB.questionPreset });
                const asked = ask.length ? await runOwnerChecks({
                  owners: ask, exec: sweep.exec, runDir: run.runDir, ledgerPath: K.ownerCheckLedger,
                  rawDir: paths(run.runDir).webResults, preset: KNOCKOUT_WEB.questionPreset,
                  concurrency: 3,   // step 3 — the same constant as the sibling calls above
                }) : [];
                const answers = new Map(ask.map((o, j) => [o, asked[j]]));
                const checks = owed.map((o, i) => held.get(i) ?? answers.get(o));
                atomicWrite(K.ownerChecks, JSON.stringify({ schema: 1, checks }, null, 2) + "\n");
                runLog(run.runDir, {
                  event: "knockout-owner-checks", owners: owed.length,
                  answered: checks.filter((c) => c.ok).length,
                  // The count is logged because the ruling is about COST: one promoted filing on the
                  // issue's run means one query. A number climbing here is the bound having widened.
                  unanswered: checks.filter((c) => !c.ok).length,
                  // Answers the run already held, so asked nothing for: `asked` is what this pass paid for.
                  reused: held.size, asked: ask.length,
                });
              } else {
                runLog(run.runDir, { event: "knockout-owner-checks", owners: 0, answered: 0, unanswered: 0,
                  detail: "no promoted filing names a proprietor to search" });
              }
            } catch (e) {
              // Structural only — runOwnerChecks itself never throws. Non-fatal by the same rule as the
              // listing above: a report is never withheld for a check that could not run.
              note(`owner use-check failed (non-fatal): ${e.message}`);
              runLog(run.runDir, { event: "knockout-owner-checks-failed", cause: String(e?.message ?? e).slice(0, 300) });
            }
          };

          // resume: a settled prior sidecar is reused cell by cell, so a re-run never re-bills a count that
          // already landed — including across a build that ADDED a predicate, where only the new column is
          // bought (register-count.mjs cellSettled).
          let prior = null;
          try { prior = unfoldFormCounts(JSON.parse(readFileSync(K.registerCounts, "utf8"))); } catch { /* first attempt */ }
          const counted0 = await countRegisterHits({
            // Scope comes from the REQUEST (markRows / job.classes), never from the frame's plan. The plan
            // is a model output, and its per-mark classes may carry the frame's own belt-and-braces
            // inference — fine for shaping a research prompt, wrong for a figure the client reads as
            // "filings in my classes". The names are identical either way (the frame validator enforces
            // one row per instructed mark, verbatim), so this is a scope decision, not a set difference.
            marks: countRowsOf(markRows.map((m) => ({ name: String(m.name), classes: Array.isArray(m.classes) ? m.classes : null })), plan.marks),
            classes: job.classes ?? null, jurisdictions: job.jurisdictions ?? null,
            provider: register, capabilities: ctx.registerCaps,
            counter: countExec.count, ledgerPath: K.countLedger, prior,
            joinForms: countExec.source === "provider" && ctx.registerCaps?.exactFormsCountAsOne === true,
            unreachable: ctx.registerUnreachable ?? [],   // — computed once at preflight, above
            concurrency: 3,   // step 3 — was a knob; no environment ever set it
            // The close-variation fan-out's ceiling. A deployment may buy FEWER forms per mark than the code
            // cap — on Corsearch each form is a billable search — and may not buy more: variantForms clamps
            // to VARIANT_CAP, so this knob can only ever narrow. Unset ⇒ the code cap, which is the answer
            // for every deployment that has not thought about it.
            ...(process.env.CLEAROTRON_KNOCKOUT_VARIANT_CAP ? { variantCap: Number(process.env.CLEAROTRON_KNOCKOUT_VARIANT_CAP) } : {}),
          });
          // A name given in several written forms is counted as each, and reads as one row from here on.
          const doc = foldFormCounts(counted0, markRows.map((m) => ({ name: String(m.name) })), plan.marks);
          const counted = countedMarks(doc);
          // Not one mark got a number. The count IS this product — a batch published now would be a plain
          // knockout wearing a Depth 2 label and price, which is the silent substitution the whole
          // search-policy registry exists to forbid. Terminal, with the provider's own reason on it.
          if (!counted) {
            // The record's cause where a count kept one apart from the reader's line, so the operator reads what to fix.
            const first = doc.marks?.[0]?.counts?.[Object.keys(doc.marks[0].counts)[0]];
            const why = first?.cause ?? first?.unavailable ?? "no reason recorded";
            throw new StageFailure("knockout-register-count",
              `no register count could be taken for any of the ${planMarks.length} mark(s) via ${register} (executor ${countExec.source}) — first cause: ${String(why).slice(0, 200)}`, null);
          }
          atomicWrite(K.registerCounts, JSON.stringify(doc, null, 2) + "\n");
          registerCounts = doc;
          runLog(run.runDir, { event: "knockout-register-counts", provider: register, executor: countExec.source, marks: doc.marks.length, counted, regions: doc.scope.regions ?? "worldwide" });
          if (counted < doc.marks.length) note(`register counts: ${doc.marks.length - counted}/${doc.marks.length} mark(s) unavailable — the batch continues (they publish as "not available", never as zero)`);

          const sweeping = startSweep();
          try { await checkOwners(await readTheRegister({ ctx, job, K, run, agent, markRows, plan, counts: doc, countExec, opts })); }
          finally { await sweeping.catch(() => {}); }
        }

        // 2 — the sweep: ONE grid call per mark, receipted, through the clearance grid's own program path.
        // Every spelling the frame named for the mark is searched once on every place it named for the batch,
        // and every result is kept, with no summary (stages-knockout.mjs, KNOCKOUT_WEB). A mark whose call
        // fails is degraded on its own; the rest of the batch goes on.
        ({ degraded, recovered } = await startSweep());
    } },
    { name: "assess", run: async () => {
        // 3 — assess (chunked ≤8/turn; merged + gated in code). DEGRADED per the DISK truth (payload
        // presence), never the in-memory Map alone — resume-proof: a prior attempt's degrades count too.
        // A STOP ASKED FOR WHILE THE TWO RESEARCH BRANCHES RAN ends the run here, with both settled and their work kept: the rating does
        // not start, and the status does not name it as begun. The turn boundary would refuse its first turn anyway.
        if (isCancelled(run.runDir)) throw new RunCancelled("knockout-assess", readCancel(run.runDir));
        koStep(ctx, "Knockout assessment");
        const chunkRows = planMarks.map((m) => {
          const has = existsSync(K.research(kebab(m.name)));
          return { name: m.name, degraded: has ? null : (degraded.get(m.name) ?? "research unavailable (prior attempt)") };
        });
        chunks = koChunks(chunkRows);
        // the assignment sidecar — the per-chunk validator joins each chunk's marks against THIS (membership
        // is enforced in code, not prompted); deterministic from the frozen plan, so a resume re-mints equal.
        atomicWrite(paths(run.runDir).knockoutChunks,
          JSON.stringify({ schema: 1, chunks: chunks.map((ch) => ch.map((m) => m.name)) }, null, 2) + "\n");
        // a recovered mark's evidence changed — its prior assess chunk is STALE by construction; drop it so
        // the stage re-runs (otherwise the re-sweep was billed for nothing and the fresh payload never read).
        if (recovered.length) {
          for (let c = 0; c < chunks.length; c++) {
            if (chunks[c].some((m) => recovered.includes(m.name)) && existsSync(K.assessChunk(c))) {
              try { rmSync(K.assessChunk(c)); runLog(run.runDir, { event: "knockout-assess-invalidated", chunk: c, recovered: chunks[c].filter((m) => recovered.includes(m.name)).map((m) => m.name) }); } catch { /* best-effort */ }
            }
          }
        }
        for (let c = 0; c < chunks.length; c++) {
          await koStage("knockout-assess", ctx, { chunkNo: c, msgCtx: { chunkMarks: chunks[c], chunkTotal: chunks.length, framework: ctx.framework, frameworkMethod: ctx.frameworkMethod ?? null } });
        }
        // ONE COMPOSITION, for the rated batch and for a corrected one: the chunks read, the summary joined, the engine's caveats,
        // the merged gate and the write. A correction that took a shorter road would reach a client through a lighter gate.
        composeRecord = () => {
          // cardOrder records how this run's page lists a name's cards, so a delivered report re-renders as it was delivered.
          const merged = { schema_version: 1, framework: null, batch: null, cardOrder: KNOCKOUT_CARD_ORDER, marks: [] };
          const summaries = [];
          for (let c = 0; c < chunks.length; c++) {
            const chunkPath = K.assessChunk(c);
            const part = JSON.parse(readFileSync(chunkPath, "utf8"));
            if (c === 0) { merged.framework = part.framework ?? { source: ctx.framework.framework_key, ladder: ctx.framework.bands.map((b) => b.label) }; merged.batch = part.batch ?? null; }
            if (typeof part.chunkSummary === "string" && part.chunkSummary.trim()) summaries.push(part.chunkSummary.trim());
            merged.marks.push(...(part.marks ?? []));
          }
          if (!merged.batch) merged.batch = { productContext: plan.batch.productContext, standardCaveats: [] };
          // the WHOLE-batch executive summary = the per-chunk summaries, composed in code (every chunk's
          // validator required one, so no mark's chunk is silently absent — review 2026-07-17)
          merged.batch.executiveSummary = summaries.join("\n\n");
          // ── THE PENDING-REGISTER CAVEAT, CONDITIONAL SINCE RF-10 v3 ────────────────
          //
          // "Ratings reflect our common law assessment. Register analysis may adjust ratings in either
          // direction." This is a CODE DEFAULT that fires when the model supplied no caveat of its own, and
          // turned it from dormant into the thing that ships.
          //
          // BEFORE: a rule in the knockout-assess manual ordered the seat to write that caveat, so the array
          // arrived non-empty and this default almost never fired. THAT RULE IS RETIRED IN THIS SAME BRANCH —
          // the seat is no longer told to write it — so the array now arrives EMPTY and this line injects the
          // sentence unconditionally. Retiring the rule in the doctrine while leaving its default in the code
          // did not remove the caveat; it made it fire on every run.
          //
          // And it is FALSE on the runs it now fires on. The rater is handed this run's fetched register
          // filings and weighs them, so "register analysis may adjust ratings" describes work that already
          // happened. RF-10 v3 (synthesis-rules.md): when register analysis ran AND surfaced live filings,
          // drop the caveat and cite the register evidence directly; where it did not run, it stands and is
          // the honest thing to say.
          //
          // THE DRIVER'S READ, off the run. A seat that could assert whether the register ran could waive its
          // own caveat. Records present AND non-empty: a file that exists with nothing in it is a register
          // that surfaced no filings, which is exactly the case the caveat is still true for.
          // — ONE DERIVATION, shared with the verifier. This was a private copy, and the
          // lint that checks the result did not have it: it required the caveat unconditionally while this
          // injected it conditionally, so any run where the seat supplied its own caveats failed by
          // construction. Two predicates that must agree forever is how they stop agreeing.
          // — THE SAME DERIVATION THE LINT USES. This counted the array, blanks included, so
          // `["", "  "]` read as "the rater supplied two" here and as "supplied none" in the verifier. The lint
          // could not see the disagreement because the survivor sentence below silenced it entirely.
          if (raterCaveats(merged.batch.standardCaveats).length === 0 && !registerSurfacedFilings(K.registerRecords)) {
            merged.batch.standardCaveats = ["Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction."];
          }
          if (!Array.isArray(merged.batch.standardCaveats)) merged.batch.standardCaveats = [];
          // ── the survivor sentence, in CODE ( fix 3) ────────────────────────────────────────────────────
          //
          // A mark this lane did not knock out is a SURVIVOR. It is not clear, and the document must not be
          // readable as though it were: the knockout screens, the clearance enumerates, and the whole distance
          // between them is the work that has not happened yet. Two runs on two matters delivered "Medium,
          // complete" while missing almost every mark the lawyer named, because a screen cannot know what it
          // did not look for — so the boundary of the screen is stated by the engine rather than left to the
          // assessing model, which is the one party that cannot see it.
          //
          // APPENDED, never prepended: publish/knockout.mjs's email takes standardCaveats[0], so leading with
          // this would silently replace the standing caveat in the requester's inbox.
          const survivorNote = survivorBoundaryNote(policy);
          if (!merged.batch.standardCaveats.some((c) => SURVIVOR_BOUNDARY_RE.test(String(c))))
            merged.batch.standardCaveats.push(survivorNote);
          // ── the skipped-capability sentence, in CODE, for the survivor sentence's own reason ──────
          //
          // The per-mark degrade above already reaches the client on every row. This is the RUN-level fact
          // underneath twenty identical rows: not "research was unavailable for this name" twenty times, but
          // one capability that never ran on this deployment. The assessing model cannot state it — it is
          // told a mark is degraded, never why the whole screen is — so the engine states it, exactly as it
          // states the survivor boundary two lines up.
          //
          // APPENDED, never prepended, for the same reason the survivor note is: publish/knockout.mjs's email
          // takes standardCaveats[0], and leading with this would silently replace the standing caveat in the
          // requester's inbox.
          const skippedNote = sweep.skipped ? CAPABILITY_SKIPPED_NOTE[sweep.skipped] : null;
          if (skippedNote && !merged.batch.standardCaveats.some((c) => String(c) === skippedNote))
            merged.batch.standardCaveats.push(skippedNote);
          // The merged gate now also validates the TYPED findings and receipts their citations, and it
          // NORMALISES as it validates — each finding's band comes back in the frozen deck's own casing — so
          // it runs BEFORE the artifact is written, not after. The counts are logged because a receipts pass
          // over zero citations is a different fact from a receipts pass, and only the count can tell them
          // apart afterwards.
          // BEFORE THE GATE AND THE WRITE, so the record on disk is the record that ships, and the reviewing
          // pass never addresses a line inside a section that is about to go.
          removeNextStepSections(run.runDir, merged.marks);
          const mv = validateMergedFindings(run.runDir, merged, plan);
          if (!mv.ok) throw new StageFailure("knockout-assess", `merged findings failed the lint: ${mv.failures.join("; ")}`, null);
          runLog(run.runDir, { event: "knockout-receipts", ...mv.receipts });
          atomicWrite(K.findings, JSON.stringify(merged, null, 2) + "\n");
          return merged;
        };
        // Reassigned by the reviewing pass, which returns a REWRITTEN record rather than editing this one:
        // the original has to survive intact as the thing that ships if the pass cannot finish cleanly.
        merged = composeRecord();
    } },
    { name: "review", run: async () => {
        // ── THE REVIEWING PASS, AFTER THE RECORD IS ON DISK AND BEFORE ANYTHING READS IT ─────────────────
        //
        // ORDER MATTERS THREE WAYS. The record is written FIRST so the stage's validator has something to
        // join every address against — an address that names no line is refused while the seat can still
        // send a repair turn, rather than reported as unresolved after the stage was declared good. It also
        // means a run that dies inside the pass has already left a complete, valid, deliverable record: the
        // rated one, unrewritten, which is exactly what shipped before this stage existed. And the rewritten
        // record goes back through `validateMergedFindings` before it replaces that one, so nothing reaches
        // a client that has not been through the same gate.
        //
        // NO NEW STEP LABEL. `stepTotal` is derived from `koSteps()`, so adding one would renumber the
        // progress screen a client watches for a pass that takes a minute. It runs inside "Knockout
        // assessment", which is what it is part of.
        merged = await knockoutReviewingPass({ ctx, run, K, merged, plan, chunks, composeRecord });
        try { writeFileSync(K.assessment, String(merged.batch.executiveSummary ?? "")); } catch { /* prose mirror, best-effort */ }
    } },
    { name: "publish", run: async () => {
        // 4 — publish (report + workbook + meta + index)
        //
        // PUBLISHED ONCE, as a clearance is. The publish result is recorded in `.published`, and a resume that finds the
        // record delivers what was published rather than publishing again: a run stopped between the publish and its
        // delivery record would otherwise put a second copy in the pool. The record carries everything the delivery
        // below reads, so the resumed delivery is the one the first pass would have sent.
        overall = worstBand(ctx.framework, merged.marks);
        if (existsSync(join(run.runDir, ".published"))) {
          const { ts: _publishedAt, ...stored } = JSON.parse(readFileSync(join(run.runDir, ".published"), "utf8"));
          published = stored;
          koStep(ctx, "Report & publish");
          note(`publish skip — already published → ${published.url}`);
        } else {
          // THE LAST READ OF THE STOP FLAG. Everything above dispatches through the gateway, which reads it
          // before a turn — so on this lane, where publication follows the final stage directly, a stop
          // pressed during that stage was never seen and the report went out anyway.
          assertNotCancelledBeforePublish(run.runDir, "knockout");
          // PAST THE LAST STOPPABLE POINT, RECORDED WHERE IT BECOMES TRUE. The read above is the final one, so
          // from this line on a stop cannot prevent delivery — and the screen must stop promising it will.
          // Written here rather than derived on the screen from a step number: "Report & publish" is step 4 of
          // 5 on this lane, not the last, so any arithmetic over stepN would name the wrong step and go stale
          // the day a lane's list changes.
          writeRunStatus(ctx, { stoppable: false });
          koStep(ctx, "Report & publish");
          // A set-aside filing the rating cites moves up with the carried ones, so the report has its row.
          try {
            const held = JSON.parse(readFileSync(K.registerRecords, "utf8"));
            const moved = withCitedFilings(held, merged);
            if (moved !== held) atomicWrite(K.registerRecords, JSON.stringify(moved, null, 2) + "\n");
          } catch { /* no record on this run, or none readable: publish says which */ }
          published = await publishKnockout({
            runId, codename: run.codename, runDir: run.runDir,
            findings: merged, plan, framework: ctx.framework, overall,
            poolRoot: config.poolRoot,
            // THE FALLBACK HERE COULD NOT FIRE, AND COULD NOT HAVE HELPED IF IT HAD. It read
            // `config.poolUrl ?? envFrom(process.env, "CLEAROTRON_REPORTS_URL") ?? null`. Two things were wrong
            // with it and both were invisible: the getter returns "" when the variable is unset, and `??` only
            // falls through on null or undefined — so the second operand was unreachable — and that second
            // operand read the same `process.env` the getter had just read, so reaching it would have returned
            // the same empty answer. A reader saw a safety net twice over where there was none.
            //
            // `|| null` instead, which says the one true thing: no base URL configured, so no link. That is the
            // state `reportUrlFor` already handles by returning null per report rather than an empty string, and
            // a null link is what the delivery packet is specified to carry when no pool URL is set.
            poolUrl: config.poolUrl || null,
            customerKey: ctx.profile?.profileKey ?? "generic",
            // — the frozen profile's delivery overlay decides the confidentiality marking, exactly as it
            // does on the clearance lane. Absent (an unbound run, or a profile silent on the field) is the
            // NO-OPINION state and gets the plain default; only an explicit `privileged:false` suppresses it.
            delivery: ctx.profile?.delivery,
            searchPolicy: policy, tokens: (() => { try { return rollupTokens(run.runDir).total; } catch { return null; } })(),
            registerCounts,
          });
          sentinel(run.runDir, ".published", published);
          runLog(run.runDir, { event: "knockout-published", url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })), overall, marks: merged.marks.length });
        }
        // The knockout lane put its token total in the PUBLISHED ARTIFACT but never stamped the run itself,
        // so `status.json.tokens` was empty for every Stage-0 run however it ended (fixed 2026-07-28) — and
        // a Stage-0 run appeared in no account-level consumption view at all.
        recordRunConsumption(ctx, { phase: "delivered", tokens: stampTokenRollup(run.runDir, "delivered") });
    } },
    { name: "deliver", run: async () => {
        // 5 — delivery handoff (byte-faithful to pipelineInner's packet contract; cross-ref pipeline.mjs)
        koStep(ctx, "Sending to you");
        // qcFlags: the projected predelivery-lint lines publishKnockout just computed and recorded — the
        // cover note enumerates exactly what the workbook does (A10, extended to this lane 2026-07-31).
        // They are FLAGS: the packet, the state and the send below are byte-identical with or without them.
        // The product's name, from the run's frozen policy, for the email's first line and its subject alike.
        const productName = knockoutName(policy);
        const emailHtml = composeKnockoutEmail({ findings: merged, framework: ctx.framework, overall, reports: published.reports, auditUrl: published.auditUrl, job, registerCounts, qcFlags: published.qcFlags, productName });
        writeFileSync(K.emailBody, emailHtml);
        const nMarks = merged.marks.length;
        const refTag = job.ref ? ` (${job.ref})` : "";
        const packet = {
          runId, agent,
          forwarder: job.forwarder, forwarderEmail: job.forwarderEmail, msgId: job.msgId,
          conversationId: job.conversationId ?? null,
          subject: `${[productName, job.ref ?? markNames[0] ?? "batch"].filter(Boolean).join(" — ")} (${nMarks} mark${nMarks === 1 ? "" : "s"})`,
          emailBodyHtml: emailHtml,
          // THE SAME ROUTING AS THE CLEARANCE PACKET (part b). This read
          // `AGENT_WHATSAPP[agent]`, and every user of a deployment shares one agent id, so every knockout
          // completion paged the operator and told the person who ordered it nothing. The clearance packet
          // was moved off that and this one was not, which is the half that shipped: one call site fixed,
          // two existing. Where no number is held the packet now SAYS so in `whatsappToReason` rather than
          // substituting the operator silently.
          //
          // The failure notice (run-failed.mjs, buildFailurePacket) routes the same way. It used to keep `AGENT_WHATSAPP[agent]` as an
          // operational page, but the courier relays it to the requester, who is owed it as they are owed a report, and the
          // operator keeps the page as the copy beside it.
          ...whatsappRouting(job, agent),
          // ONE LINE, N LINKS. This said "Report: <one url>" and on a batch that url is now null, which would
          // have read "Report: null" — the fail-visible shape doing its job, and still not a line to send. A
          // batch names every report it produced, in the order the names were ordered.
          whatsappText: `✅ Knockout screen${refTag} of ${nMarks} mark(s) is done — ${nMarks === 1 ? "rating" : "highest rating"} ${overall}. `
            + (published.reports.length === 1
              ? `Report: ${published.reports[0].url}`
              : `Reports: ${published.reports.map((r) => `${r.mark} ${r.url}`).join(" · ")}`),
          // `url` is the run's single report, and NULL for a batch — publishKnockout's own rule, carried
          // through rather than papered over. `reports` is where a batch's documents are, and docs/DELIVERY.md
          // says so: an integrator that only knows `url` gets null on a batch and fails visibly, instead of
          // mailing the first of eight names as though it were the answer.
          url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })),
          verdict: overall, markName: batchMarkName(markNames),
        };
        try { rmSync(join(run.runDir, ".sent")); } catch { /* none */ }
        try { rmSync(paths(run.runDir).sendReceipts, { force: true }); } catch { /* none */ }
        try { rmSync(paths(run.runDir).failure); } catch { /* none */ }
        writeFileSync(paths(run.runDir).delivery, JSON.stringify(packet, null, 2) + "\n");
        try {
          mkdirSync(config.outboxDir, { recursive: true });
          writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${agent}\n`);
        } catch (e) { note(`delivery: outbox marker write skipped (${String(e.message).slice(0, 100)})`); }
        const deliveredAt = new Date().toISOString();
        // ── THE TEN-MINUTE BAR, AGAINST THE RUN (ruling 591) ────────────────────────────────────────────
        //
        // Recorded here because this is the first point at which the run's own span is known: `startedAt` is
        // in the run's status and `deliveredAt` is the line above. It used to be recorded at the web sweep,
        // against the sweep's own elapsed time, so both knockouts of 2026-09-26 stated `overBar: false` at
        // 0.6 and 0.8 minutes while their runs took 14.4 minutes wall — the number beside the bar was not the
        // number the bar is about.
        //
        // RECORDED, NEVER APPLIED, exactly as before: nothing reads `overBar` and nothing about this run
        // changes on it.
        //
        // AND AN UNREADABLE START SAYS SO RATHER THAN VANISHING. `readRunStatus` answers `{}` when it cannot
        // read, and a bar quietly omitted because a file was unreadable is an absence that reads as "not
        // over". So the event always carries the field, and names the reason when it has no span.
        try {
          const verdict = knockoutBarVerdict({ startedAt: readRunStatus(run.runDir)?.startedAt, deliveredAt });
          runLog(run.runDir, { event: "knockout-run-total", barMinutes: KNOCKOUT_MINUTES_BAR, ...verdict });
        } catch { /* the bar is a record, never a gate: a summary that could not be written never fails a delivery */ }
        // The turnaround row every run ending writes. A Knockout computes no quote, so the row carries its wall alone.
        logTurnaroundReconciliation(run.runDir, ctx.quote, "delivered");
        // `tier` beside `verdict` — the same band word under the name the clearance lane records it by, so a
        // reader of either lane's status finds the rating in one place. `verdict` stays as it was. The pool copy
        // learns its terminal state at the same seam as a clearance's (run-shell.mjs).
        const archived = endTheDeliveredRun({ ctx, run, published, archive, sentinel }, {
          status: { state: "delivered", tier: overall, statement: published.statement, url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })), deliveredAt, sendPending: true, stepIndex: STEPS.length - 1, stepLabel: STEPS[STEPS.length - 1], stepN: STEPS.length, stepTotal: STEPS.length },
          settle: { state: "delivered", tier: overall, deliveredAt, runId: published.runId ?? run.runId, lane: "knockout" },
          delivered: (archivedAt) => ({ verdict: overall, url: published.url, reports: published.reports.map((r) => ({ mark: r.mark, url: r.url })), notified: "pending", sendPending: true, archived: archivedAt, lane: "knockout" }),
        });
        note(`=== KNOCKOUT DELIVERED (${nMarks} marks, worst ${overall}) → ${published.reports.map((r) => r.url).join(", ") || "no report URL (pool URL unset)"}${archived ? ` — archived → ${archived}` : ""} ===\n`);
        return { ok: true, verdict: overall, url: published.url, reports: published.reports, runDir: archived ?? run.runDir };
    } },
  ] });
}
