// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pipeline.mjs — the deterministic driver: sequences every clearance-search stage as a blocking engine
// turn, joins the fan-out in code (the fan-in barrier), gates on the refutation
// verdict, and never parks (there is no LLM continuation decision anywhere). CLI: `node pipeline.mjs --job <file.json>`.

import { serveOwnQuestions, stopServingOwnQuestions } from "./own-search-questions.mjs";   // a run on its own search: its questions are answered while its segment runs
import { writePark } from "./run-park.mjs";
import { CLEARANCE_ENDING } from "./run-failed.mjs";
import { runShell } from "./run-shell.mjs";
import { deliveryEndState } from "./run-delivered.mjs";
import { StageFailure, buildFailurePacket, isDesignedRefusal, stageWallFields, terminalReasonFields } from "./run-outcome.mjs";
import { correctionReading, correctionRows, correctionsExtra, flagOrdinals, recordCorrectionsBasis, repairUnnamedRemovals, rollbackCorrectivePass } from "./steps/corrections.mjs";
import { assembleReportMd, buildAskAnswersSection, buildOnlyYouSection, buildReasonedNegativesSection, buildReviewerOpenPointsSection, CODE_BUILT_SECTIONS, reassembleFromTheRecord, recordCorrectionsDelivered } from "./report-assembly.mjs";
import { applyScopeFrontMatterOf, assessmentCoverageOfRun, assessmentCoverageRows, reportIdentityRecord, searchLogAuditMd, sentinel, setAsideTheAssessment, settlePendingWhatIfsBeforeArchive, writeScopeFactsOf } from "./run-end-state.mjs";
import { keepDeliveredRecordAsHistory, ownerScreenForDelivery, readFindingsForReport, rebuildDeliveredRecord, rewriteFromBeforeTheSeam, withdrawSupersededAudit } from "./delivered-record-run.mjs";
import { coverageJudgmentRows, coverageRowArea, coverageRowAreaLabel, decideScriptScopeHonesty, fullProseOrdinals, injectDeferralCoverage, injectLaneDepthCoverage, injectMeaningGapCoverage, injectScreenGateCoverage, injectScriptScopeCoverage, injectUncoveredMarketCoverage, localLanguageStateOf, mergedScriptScopeRow, orderMarketsOf, planWriteUps, scriptLaneRanOnRun, scriptScopeDisclosure, stampCoverageJudgmentRows } from "./coverage-rows-run.mjs";
import { actionsRegisterListed, CORRECTIONS_DELIVERED_FILE, correctionsTheRestoreLacks, CORRECTIVE_RECHECK_FILE, correctiveCycleSettledDecision, DELIVERY_TAIL_LABEL_RE, openAskForClosure, partitionDeliveryStale, postRepairScope, recordChangeOwesReview, removalRepairedRow, restoredFindingsTable, saveWithRetries, snapshotFindingsForCorrections, stagesStaleOnPlacement, unreadRecordReview, UPSTREAM_STALE_REPAIR, whatTheRepairLeftStale, withdrawByToken } from "./repair-review-run.mjs";
import { CASE_LAW_PRODUCT, CASE_LAW_TRIGGERS, caseLawJoin, composeDispatchExtra, decideCaseLaw, DISPATCH_EXTRA_BUILDERS, prepareDeclinationSpec, reviewProfileSelection, settleDerivedBases, withGoodsFrom, withGoodsStates } from "./dispatch-extras.mjs";
import { askableOf, capabilityGapAxes, computeOpenFloors, conditionsFollowingTheRecord, enrichFindingDeadlines, envelopeDecision, envelopeHeldNote, escalationHeldNote, findFloorBreaches, isInactiveAxisRow, lateRecordIds, lateRecordsUnaddressed, loadScreenGateUnresolved, NOT_CLOSEABLE_KINDS, officeGapOf, readFloorAxes, refusedRecordsLeftOut, registerGapConditions, skepticDeferralExtra } from "./floor-and-gap-checks.mjs";
import { connotationAuditSeats, connotationRemedyToken, recordConnotationAudit, taintDisposition, taintParkJudgmentArtifacts, undoTaintRenames } from "./connotation-audit-run.mjs";
import { bandClasses, deriveBandShape, deriveNamedBand, foldSupplementalProposals, holdStickyGapsIn, mainMarketsOf, mechanicalFormGapDirectives, mergeRegisterBands, namedBandText, readPlanExecution, readRegisterBands, reaskFollowUpErrors, refreshSupplementalExecution, remergeIfBandsMoved, runSaturationProbeCodeSide, slicesUnitNeverReached, stickyGapUnits, takeSlicesOutOfTheBand, unfinishedUnitAsItStands, writePlanExecutionReceipt } from "./register-band-run.mjs";
import { deriveFormNeighbourhood, deriveGridSpec, parseIntakeAsks } from "./intake-derivations.mjs";
import { deriveFloorDuty, placementOwnerFates, placementSeamReason, recordPlacementPass } from "./placement-pass-record.mjs";
import { findRunDate, resumeStopRefusal } from "./run-resume.mjs";
import { attachFramework, attachProfile, attachRegisterPlan, attachSearchPolicy, depthLadderEvent, foldRecipeScope, freezeProfile, profileShaOf, registerDeferredCoverage } from "./run-attachments.mjs";
import { resultsPerCellOf } from "./provider-calls.mjs";
import { digestDispatchExtra, extractRulingsTail, loadCoverageLedger, readOwnerScreen, recallFollowupMaxFor, relabelCoverageRows, runDigest, writeRegisterDigestFacts } from "./register-digest-run.mjs";
import { deriveRecordCarry, recordSynthesisSeam } from "./record-carry-trace.mjs";
import { inScopeClassList, registerJurisdictions } from "./run-scope.mjs";
import { changedFindingOrdinals, changedFindingOwners, floorDutyOwedNow, foreignRecordLinksBlanked, goodsEvidenceForTheWriter, keepGoodsEvidenceAsWritten, messageCtxFor, NARROW_REPAIR_TRIGGERS, outputStands, recoverWinningAttempt, reviewExclusionsPaths, revisedCitesNote, safeReadJson, stage, stageCharter, stageSessionKey, withdrawnExclusionLine, writerExclusionBlock, writerExclusionLine, writerExclusions } from "./stage-dispatch.mjs";
import { runDelivery } from "./steps/delivery.mjs";
import { runOverviewAndCards } from "./steps/overview-and-cards.mjs";
import { runVerdictGate } from "./steps/verdict-gate.mjs";
import { openRun } from "./steps/open-run.mjs";
import { runIntake } from "./steps/intake.mjs";
import { runPlacementAndDigest } from "./steps/placement-and-digest.mjs";
import { runRegisterSweep } from "./steps/register-sweep.mjs";
import { runSynthesis } from "./steps/synthesis.mjs";
import { runFrameComparison } from "./steps/frame-comparison.mjs";
import { runSkepticAndFollowUp } from "./steps/skeptic-and-follow-up.mjs";
import { runCorrectionCycle } from "./steps/correction-cycle.mjs";
import "../shared/env-local.mjs";   // side effect: apply <repo>/.env when THIS file is the CLI entry (never on library import)
import "./engine/mcp/http-dispatcher.mjs"; import { readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename, resolve } from "node:path";   // resolve: the resume line must work from any cwd
import { driverDir, driverRel, ensureDriverDir } from "../shared/driver-dir.mjs";
import { goodsOf } from "./queue-markers.mjs";   // — one reading of "does this job name goods", shared with the intake gate
import { selectEngine } from "./gateway.mjs";
// — the arm's TOOL WIRING, for its context receipt. Read through the same two functions the
// gateway dispatches with, never re-derived: a receipt that described a second computation would be
// describing a dispatch that did not happen.
import { toolGroupsForStage as experimentToolGroups, buildGatherMcpConfig as experimentMcpConfig, allowedToolsFor as experimentAllowedTools } from "./engine/mcp/gather-config.mjs";
import { probeSeed as orderProbeSeed } from "./order-probe.mjs";   // item 11 — records which ordering arm a run ran under
import { config } from "./driver.config.mjs";
import { codexSandboxBypassed } from "./engine/openai-agent.mjs";        // — a replay is refused where nothing keeps a stage's commands out of the answers it replays
import { buildRunContext, deriveSlug, kebab } from "./phase0.mjs";
import { crossBuildResumeRefusal } from "./one-build-per-run.mjs";   // a run is finished on the build it started on (owner, 2026-11-09)
import { paths, STAGES, axisTier, decideAxes, whatsappRouting, stageOrdinal, stageInputs, dependencyOrder, REGISTER_AXES } from "./stages.mjs";
import { RESEARCH_ANSWERS_FILE, RESEARCH_REPLAY_FILE, replayAnswersFile, savedResearchCount } from "./research-answers.mjs";   // the research a stage's earlier attempts got, handed to a later one; a replay of it
import { readPartNotCompleted } from "./parts-not-completed.mjs";
import { CONTEXT_DERIVATIONS, DISPATCH_EXTRAS, INLINE_CONTEXT, sandboxManifest, sandboxGaps, derivationsFor } from "./stage-context.mjs";   // — what a stage is actually handed
import { derivedStateOf, recordedDerivedState, replayOfDerivation } from "./derived-state.mjs";   // the register picture a dispatch was handed, so a replay can be checked against it
import { parseCorrectionKinds } from "./verify.mjs";
import { readEnvelopeDecision, settledDeferralsSection } from "./envelope-settle.mjs";
import { REGISTER_PROVIDER } from "./driver.config.mjs";
import { FACTS_FILE as DIGEST_FACTS_FILE } from "./register-digest-record.mjs";   // conversion 11 — the render's facts sidecar and the accounting era stamp
// — ONE binding of the office split to this box's env, shared with Depth 2's two lanes.
// — the merge unions the halves' forms into the canonical one, with the same code the gateway unions
// an attempt with. PURE and acyclic.
// — the register coverage form: the driver writes it before the digest dispatches, renders the
// `## Coverage ledger` table and the machine ledger FROM it after the pass, and unions it across passes.
export { placementSetAsideGrounds, placementFloorDecisionLines, placementSetAsideLines, placementAuditRows, placementRecallEndings,
  standingPlacementDecisions, writePlacementDecisions } from "./placement-decisions.mjs";
import { keepsInstructedScope, rebuildRunOrder } from "./accepted-order.mjs";   // the order a run was accepted on, kept with it from intake (steps/open-run.mjs)
import { loadProfiles, applicantMatchesProfile } from "./profiles.mjs";   // adds profileStoreResolution — the CONFIG store's identity, beside the doctrine tree's
// THE OFFERING'S own sentence about where the native-language investigation can be bought. It reaches a
// CLIENT REPORT through the script-scope coverage row, which is why it is imported rather than typed:
// the row used to name "Depth 5 (clearance-jx)" — a retired key on a retired ladder — as its remedy.
import { NATIVE_LANGUAGE_REMEDY } from "./products.mjs";
import { defaultTerritoryState } from "./effective-scope.mjs";   // the ONE territory ladder (the geography stamp included) + the stored-defaults reading
import { acquireSlot, releaseSlot } from "./slot-lock.mjs";
import { runLog, note, fileMeta } from "./log.mjs"; import { armProduced, readArmSurfaces, producedNothingLine } from "./experiment-honesty.mjs"; import { correctiveReadiness, correctiveRefusalLine, correctivePassState } from "./corrective-arm.mjs";
import { repairFollowup } from "./repair-composers.mjs";
import { seedRunStatus, writeRunStatus, rollupStatus, signoffPatch, readSignoff } from "./progress.mjs";
import { atomicWrite } from "./run-record.mjs"; import { findRunDirFor } from "./run-dir-lookup.mjs";
import { writeOutboxPacket } from "./outbox.mjs";
import { readInstructedScope } from "./matter-frame-record.mjs";   // — the frame's inferred scope, when nothing was instructed; and the classes it judged necessary beyond the instructed ones, each with its reason, which the plan compile gives one identical-mark question apiece (decision 18)
// Conversion 6: the two line-form parsers are no longer on the live path — the seat sends typed
// rows and the driver applies THOSE. `parseClosureLines`/`parseAskClosureLines` are still exported and
// still tested: an archived run's doubt-closure.md is a hand-typed artifact and stays readable, which
// is the archive rule — a new way in, never a replacement.
// — every placed candidate ends somewhere a reader can see; the ones that do not are counted by name
// — the run's own record log. Every driver-side register call that can write a record BODY carries
// this path, because this process runs several runs' pipelines at once and a global address would file
// one run's evidence under another.
import { beginAnswerMemory } from "../providers/_shared/answer-memory.mjs";
import { emptyQueue, coerceQueue, mintItem, pendingItems, markFlushed, receiptKeyFor } from "./digest-queue.mjs";   // (t1cd) — the digest-trigger funnel
import { openPass } from "./record-fold.mjs";   // the folded record from the delivery seam on
import { restampStage, reconcileStamps, settleOneShotStamp, projectStageInput } from "./stage-freshness.mjs";
import { parseManifestVariants, GRID_HALVES, GRID_SEATS } from "./common-law-receipts.mjs";
import { stampTokenRollup } from "./tokens.mjs";
import { recordRunConsumption } from "./consumption-ledger.mjs";
import { quoteForJob, logTurnaroundReconciliation } from "./run-quote.mjs";
// S2 — the report card's mechanical frame, composed from the record instead of dictated (see below).
// qw/cn-scope-honesty — the zh-lane capability tables + the requested-scope resolver, for the plain-clearotron
// honesty row/note. jx-lanes.mjs is a PURE zero-import leaf (data + decisions, no env/fs), so a static
// import here costs a plain clearotron nothing — the "lazy import" rule below (jx.mjs / jx-units.mjs) guards
// the lane MACHINERY, not this table. Aliased: scope-ledger.mjs already exports a scopeJurisdictions
// (rows → markets); this one is (job, profile) → requested territories, the decideJxLanes precedence.
// — the two reads that used to sit inline here (blind model, then the manifest's prose line) moved
// into boundDominantElementFrom, so the driver's bind and the record tool's bind are ONE body. Neither
// parseBlindFrameModel nor dominantElementFromManifest is called from this file any more.
import { isContentShapedFail, isFallbackEligible } from "./repairs.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { reachableCommand } from "../shared/invocation.mjs";   // — a printed command the reader can type later, from anywhere
export { StageFailure, buildFailurePacket, isDesignedRefusal, stageWallFields, terminalReasonFields };   // moved to run-outcome.mjs; importers read them here as before
export { correctionReading, correctionRows, flagOrdinals, recordCorrectionsBasis, repairUnnamedRemovals, rollbackCorrectivePass };   // moved to steps/corrections.mjs; importers read them here as before
export { isContentShapedFail, isFallbackEligible };   // moved to repairs.mjs; importers read them here as before
export { logTurnaroundReconciliation };   // moved to run-quote.mjs; importers read it here as before
export { assembleReportMd, buildAskAnswersSection, buildOnlyYouSection, buildReasonedNegativesSection, buildReviewerOpenPointsSection, CODE_BUILT_SECTIONS, reassembleFromTheRecord, recordCorrectionsDelivered };   // moved to report-assembly.mjs; importers read them here as before
export { applyScopeFrontMatterOf, assessmentCoverageOfRun, assessmentCoverageRows, reportIdentityRecord, searchLogAuditMd, setAsideTheAssessment, settlePendingWhatIfsBeforeArchive, writeScopeFactsOf };   // moved to run-end-state.mjs; importers read them here as before
export { keepDeliveredRecordAsHistory, ownerScreenForDelivery, readFindingsForReport, rebuildDeliveredRecord, rewriteFromBeforeTheSeam, withdrawSupersededAudit };   // moved to delivered-record-run.mjs; importers read them here as before
export { coverageJudgmentRows, coverageRowArea, coverageRowAreaLabel, decideScriptScopeHonesty, fullProseOrdinals, injectDeferralCoverage, injectLaneDepthCoverage, injectMeaningGapCoverage, injectScreenGateCoverage, injectScriptScopeCoverage, injectUncoveredMarketCoverage, localLanguageStateOf, mergedScriptScopeRow, orderMarketsOf, planWriteUps, scriptLaneRanOnRun, scriptScopeDisclosure, stampCoverageJudgmentRows };   // moved to coverage-rows-run.mjs; importers read them here as before
export { actionsRegisterListed, CORRECTIONS_DELIVERED_FILE, correctionsExtra, correctionsTheRestoreLacks, CORRECTIVE_RECHECK_FILE, correctiveCycleSettledDecision, DELIVERY_TAIL_LABEL_RE, openAskForClosure, partitionDeliveryStale, postRepairScope, recordChangeOwesReview, removalRepairedRow, restoredFindingsTable, saveWithRetries, snapshotFindingsForCorrections, stagesStaleOnPlacement, unreadRecordReview, whatTheRepairLeftStale, withdrawByToken };   // moved to repair-review-run.mjs; importers read them here as before
export { CASE_LAW_PRODUCT, CASE_LAW_TRIGGERS, caseLawJoin, composeDispatchExtra, decideCaseLaw, prepareDeclinationSpec, reviewProfileSelection, settleDerivedBases, withGoodsFrom, withGoodsStates };   // moved to dispatch-extras.mjs; importers read them here as before
export { askableOf, capabilityGapAxes, computeOpenFloors, conditionsFollowingTheRecord, enrichFindingDeadlines, envelopeDecision, envelopeHeldNote, escalationHeldNote, findFloorBreaches, isInactiveAxisRow, lateRecordIds, lateRecordsUnaddressed, loadScreenGateUnresolved, NOT_CLOSEABLE_KINDS, officeGapOf, readFloorAxes, refusedRecordsLeftOut, registerGapConditions, skepticDeferralExtra };   // moved to floor-and-gap-checks.mjs; importers read them here as before
export { connotationAuditSeats, connotationRemedyToken, recordConnotationAudit, taintDisposition, taintParkJudgmentArtifacts, undoTaintRenames };   // moved to connotation-audit-run.mjs; importers read them here as before
export { bandClasses, deriveNamedBand, foldSupplementalProposals, holdStickyGapsIn, mainMarketsOf, mechanicalFormGapDirectives, mergeRegisterBands, namedBandText, readPlanExecution, readRegisterBands, reaskFollowUpErrors, refreshSupplementalExecution, remergeIfBandsMoved, runSaturationProbeCodeSide, slicesUnitNeverReached, stickyGapUnits, takeSlicesOutOfTheBand, unfinishedUnitAsItStands, writePlanExecutionReceipt };   // moved to register-band-run.mjs; importers read them here as before
export { deriveFormNeighbourhood, parseIntakeAsks };   // moved to intake-derivations.mjs; importers read them here as before
export { deriveFloorDuty, placementOwnerFates, placementSeamReason, recordPlacementPass };   // moved to placement-pass-record.mjs; importers read them here as before
export { resumeStopRefusal };   // moved to run-resume.mjs; importers read them here as before
export { attachSearchPolicy, depthLadderEvent, foldRecipeScope, freezeProfile, profileShaOf, registerDeferredCoverage };   // moved to run-attachments.mjs; importers read them here as before
export { resultsPerCellOf };   // moved to provider-calls.mjs; importers read them here as before
export { digestDispatchExtra, extractRulingsTail, loadCoverageLedger, readOwnerScreen, recallFollowupMaxFor, relabelCoverageRows, writeRegisterDigestFacts };   // moved to register-digest-run.mjs; importers read them here as before
export { deriveRecordCarry, recordSynthesisSeam };   // moved to record-carry-trace.mjs; importers read them here as before
export { inScopeClassList, registerJurisdictions };   // moved to run-scope.mjs; importers read them here as before
export { changedFindingOrdinals, changedFindingOwners, floorDutyOwedNow, foreignRecordLinksBlanked, goodsEvidenceForTheWriter, keepGoodsEvidenceAsWritten, messageCtxFor, NARROW_REPAIR_TRIGGERS, outputStands, recoverWinningAttempt, reviewExclusionsPaths, revisedCitesNote, stageCharter, stageSessionKey, withdrawnExclusionLine, writerExclusionBlock, writerExclusionLine, writerExclusions };   // moved to stage-dispatch.mjs; importers read them here as before

// judgment-relocation (revised 2026-06-24, senior lawyer): there is NO judgment-driven halt state. A run only ever
// stops-without-delivering on a TECHNICAL problem (StageFailure → .failed) or pauses on a rate-limit cap
// (.postponed, auto-resumes). When the lawyer (synthesis) judges a material slice not fully cleared, the run
// DELIVERS a CONDITIONAL with an honest flag (the verdict clamp below) — never a re-search re-loop (slow +
// fragile mid-pipeline) and never a no-deliver halt (a lawyer must always get something). This is safe because
// the funnel enumerates the dangerous named band COMPLETELY (the fan-in band gate guarantees it crossed), so a
// conditional covers a genuine residual the lawyer flagged, not a sampled-and-hidden miss.

// The predicates that tell a transient failure from a content verdict, isFallbackEligible and isContentShapedFail,
// live in repairs.mjs, beside the classifier they are defined against. Both run endings read them there.

// The prose Coverage-ledger parser moved to coverage-ledger.mjs (the registerFindings validator
// mirror-checks prose against JSON, and verify cannot import pipeline) — re-exported for callers/tests.
export { parseCoverageLedger, parseCoverageLedgerFull } from "./coverage-ledger.mjs";

// ── THE DERIVATION REGISTRY (item) ──────────────────────────────────────────────────────────────
//
// stage-context.mjs DECLARES what pipeline() derives (which artifacts, from which inputs); this binds
// each declaration to the function that runs it. Two halves rather than one because the declaration has
// to be readable from anywhere — the sandbox manifest, the tests, an analysis tool — while the running
// half needs the pipeline's whole surface.
//
// The rig replays these against the SANDBOX ctx, so a derivation seam actually executes there. That is
// the reason this issue could not be answered by persisting and replaying: all three `probeOrder` seams
// sit INSIDE band-shape.mjs's derivation functions, so a rig that replayed a persisted band-shape.json
// would hand a seeded arm the unseeded artifact and report — byte-identically, and wrongly — no effect.
export const DERIVATION_RUNNERS = {   // @internal
  "band-shape": (ctx) => {
    const P = ctx.paths;
    if (!existsSync(P.registerNamedBand)) return false;
    deriveBandShape(ctx, JSON.parse(readFileSync(P.registerNamedBand, "utf8")));
    return true;
  },
  "grid-spec": (ctx) => { deriveGridSpec(ctx); return true; },
  // ── conversion 11 — the digest's facts sidecar and its accounting stamp ──────────────────────────
  //
  // THE ONLY DERIVATION HERE THAT MUST NOT OVERWRITE THE COPY, and the reason is the inverse of
  // band-shape's. Band-shape re-executes because its seams live inside the derivation. This sidecar has
  // no seam: it is a PROJECTION the driver takes at dispatch time, and re-deriving it after the run has
  // finished reads artifacts that did not exist when the seat saw it — `digestAuditRows` returns empty
  // before the digest writes its findings and non-empty afterwards. Re-deriving therefore hands the arm
  // a context the canonical run never had, which the byte-equality arm caught on the commit that added
  // this entry. So it fills a GAP and never replaces a copy.
  //
  // That gap is the whole point: a run dir produced before conversion 11 carries no sidecar at all, and
  // without this the replay cannot run — the seat's first call refuses `registerdigest_uri_unknown` and
  // the accounting never arms. Derived here, the replay works; the audit rows then reflect the finished
  // run rather than the dispatch moment, which is a stated fidelity limit of replaying an old run dir
  // and not a defect to chase.
  //
  // RETURNS FALSE WITHOUT THE BAND. With no band the sidecar still builds — well-formed, with an empty
  // record index — and every uri the seat cites then refuses by name. Writing that and reporting it as
  // derived hands an arm a file that is present and useless, an absence dressed as a pass one layer
  // below where anyone would look for it.
  "register-digest-facts": (ctx) => {
    if (existsSync(driverDir(ctx.paths.runDir, DIGEST_FACTS_FILE))) return false;   // the canonical copy stands
    if (!existsSync(ctx.paths.registerNamedBand)) return false;
    writeRegisterDigestFacts(ctx, "sandbox");
    return true;
  },
};

// A declared derivation or extra with no runner would silently produce NOTHING and the sandbox would
// look complete. Fail at import, where a reviewer sees it, rather than at 2am inside a best-effort.
for (const d of CONTEXT_DERIVATIONS) {
  if (typeof DERIVATION_RUNNERS[d.id] !== "function")
    throw new Error(`[stage-context] derivation "${d.id}" is declared but has no runner in pipeline.mjs DERIVATION_RUNNERS — a sandbox would produce nothing and read as complete`);
}
for (const x of DISPATCH_EXTRAS) {
  if (typeof DISPATCH_EXTRA_BUILDERS[x.id] !== "function")
    throw new Error(`[stage-context] dispatch extra "${x.id}" is declared but has no builder in pipeline.mjs DISPATCH_EXTRA_BUILDERS — a sandboxed ${x.stage} would run without its driver-computed block`);
}

// The runnable half of INLINE_CONTEXT. Reads the CANONICAL run (`ctx.paths`), because that is the run
// pipelineInner would have been reading when it built this payload.
const INLINE_RESOLVERS = {
  "report-card": (ctx, { axis } = {}) => {
    const P = ctx.paths;
    const ord = Number(axis);
    if (!Number.isInteger(ord)) return { finding: null, caseLawProfile: null };
    let doc = null;
    try { doc = JSON.parse(readFileSync(P.findings, "utf8")); } catch { return { finding: null, caseLawProfile: null }; }
    const findings = (doc?.findings ?? []).filter((f) => f?.disposition !== "withdrawn");
    const finding = findings.find((f) => Number(f?.ordinal) === ord) ?? null;
    let caseLawProfile = null;
    try {
      if (finding && existsSync(P.caseLaw))
        caseLawProfile = caseLawJoin(P, findings).get(ord) ?? null;
    } catch { /* no case-law layer, or a join that failed, which caseLawJoin has recorded — production passes null here too */ }
    return { finding, caseLawProfile };
  },
};

// WHAT `--axis` NAMES, per stage. The axis slot is the dispatch label's suffix, and each stage's label
// already says what its suffix means: `register-unit:primary-sweep` is a register axis,
// `common-law-half:b` is a grid half, `report-card:1` is a finding ordinal. A stage absent from this
// table takes no axis at all, and a stray one is refused — a mistyped axis still names the shadow dir
// and the session key even where the stage ignores it.
const AXIS_VOCABULARY = {
  "register-unit": {
    what: "a register axis", oneOf: `one of: ${REGISTER_AXES.join(", ")}`,
    requiredMessage: `--experiment register-unit requires --axis <axis> (one of: ${REGISTER_AXES.join(", ")})`,
    accepts: (a) => REGISTER_AXES.includes(a),
  },
  "common-law-half": {
    what: "a grid seat", oneOf: `one of: ${GRID_SEATS.join(", ")}`,
    requiredMessage: `--experiment common-law-half requires --axis <seat> (one of: ${GRID_SEATS.join(", ")}) — its half-grid spec, ledger and findings file are all per-half`,
    accepts: (a) => GRID_SEATS.includes(a),
  },
  "report-card": {
    what: "a finding ordinal", oneOf: "a positive integer, as in the report-card:<ordinal> dispatch label",
    requiredMessage: "--experiment report-card requires --axis <ordinal> — a card is dispatched per finding (the label is report-card:<ordinal>) and its finding reaches the stage INLINE",
    accepts: (a) => /^[1-9]\d*$/.test(String(a)),
  },
};

// Which production pass an --experiment arm may reproduce. "fresh" is the first full dispatch (the one
// a preserved run's canonical artefact came from); the rest are the re-dispatch triggers runDigest
// labels, and they carry the placement rulings tail a fresh pass does not.
export const DISPATCH_TRIGGERS = ["fresh", "escalation", "envelope", "late-bind", "stale-repair", "settlement-flush", "corrective"];   // @internal — — the corrective pass is the seam the losses happen in; see driver/corrective-arm.mjs for warm vs cold
// How an --experiment arm's research is answered: sent out as the run sent it, or replayed from the run's own answers.
export const RESEARCH_MODES = ["live", "replay"];   // @internal

/**
 * The sha of a sandbox file AS IT WOULD READ on the canonical run — the sandbox's own directory
 * rewritten back. Files that embed no path (the overwhelming majority) hash identically either way and
 * skip the rewrite entirely; only the driver-written specs, which name their own output_path, differ.
 * Same 12-hex prefix as log.mjs fileMeta, so the two fields on a receipt row are directly comparable.
 */
function canonicalisedSha(file, shadowDir, runDir) {
  try {
    const buf = readFileSync(file);
    // A spec names its output_path inside JSON, where a Windows path's backslashes are doubled, so the
    // sandbox is looked for in that spelling too. A Linux path is the same in both.
    const inJson = (p) => JSON.stringify(p).slice(1, -1);
    if (buf.indexOf(shadowDir) === -1 && buf.indexOf(inJson(shadowDir)) === -1) return fileMeta(file).sha;
    const text = buf.toString("utf8").split(inJson(shadowDir)).join(inJson(runDir)).split(shadowDir).join(runDir);
    return createHash("sha256").update(text).digest("hex").slice(0, 12);
  } catch { return null; }
}

/**
 * The full `extra` an --experiment dispatch carries: the stage's driver-computed block(s) first, the
 * operator's `--instructions` append last (it is a tweak ON TOP of the production prompt, not instead
 * of it — before this, it was the ONLY thing an arm ever carried).
 */
function experimentExtra(shadowCtx, name, opts = {}) {
  // ONE composer with the production path ( corruption 2) — this used to be a second, near-identical
  // loop, which is exactly the shape in which two things that must agree stop agreeing.
  const { text, ids } = composeDispatchExtra(name, shadowCtx, opts);
  const parts = text ? [text] : [];
  if (opts.instructions) parts.push(opts.instructions);
  return { text: parts.length ? parts.join("\n\n") : undefined, ids };
}

// Compute the run's active axes the SAME way verify.mjs's registerFindings does (so a derived JSON the
// validator then re-reads agrees on completeness): the recorded activation register-units/*.md, else
// decideAxes over the sibling manifest, else null (completeness skipped). NOT enforced by the renderer —
// passed only for call-site symmetry; render-as-is avoids double-gating.
function deriveActiveAxes(P) {
  try {
    const units = readdirSync(join(P.runDir, "register-units")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    if (units.length) return units;
  } catch { /* no units dir in reach */ }
  try { return decideAxes(readFileSync(P.variantManifest, "utf8")); } catch { return null; }
}

// Spec A3 — the deadline-envelope arithmetic, pure and testable. Floor obligations are `deferred`
// Coverage-ledger rows (planned, never run). The question: does `deadline − now` exceed the estimated
// cost of closing them in-loop (plus a one-hour reserve for the back half of the run)? No deadline ⇒
// time permits (the spec's intent: stop deferring must-haves when nothing actually forbids doing them).
// Change B5b — late-bind action by run phase, pure and testable. A requester reply naming the customer
// must reach the in-flight run: before matter-frame consumes the job ⇒ fold normally; after matter-frame
// but before the narrative exists ⇒ exclusion is a FILTER — re-classify at (re-)digest, never re-run
// searches; after the narrative exists ⇒ too late to bind silently — the answer ships as a delivery note.
export function lateBindAction({ matterFrameRan, digestRan, narrativeExists }) {   // @internal
  if (narrativeExists) return "front-matter-note";
  if (digestRan) return "warm-redigest";
  if (matterFrameRan) return "digest-message";
  return "fold-job";
}

// AD-2 A1 (E2E-R2, ordering) — the delivery-TAIL stages: exactly the stages the pre-delivery pass
// itself generates and can therefore RE-DO in place when a repair moves an input underneath them
// (the observed case: the report-overview lint redo rewrote findings.json and staled every report
// card). Upstream labels (register-digest, synthesis, narrative-refutation, …) are NOT in this set —
// their recompute needs pipeline order and keeps the park path. Pure so the partition tests offline.
// `client-summary` left this alternation on 2026-08-01 with the stage — nothing generates that label
// on a live pass any more, so it can never appear in a stale set the delivery tail must repair.
// The record's one writer settles a one-shot stage's stamp, and the stamp compares a report card by its
// own finding: both now live beside the stamps in stage-freshness.mjs, and are re-exported here for the
// callers and tests that import them from this file.
export { settleOneShotStamp, projectStageInput };   // @internal
// judgment-relocation (2026-06-23): `floorContext` was REMOVED. It assembled the floor KEYS + SATURATION
// trigger + in-scope classes that fed the now-deleted search-shape gate (findFloorShapeGaps). Sufficiency on
// a crowded field is no longer a driver-side gate over the prose ledger — the funnel enumerates the complete
// band (or marks it `incomplete`) and the lawyer's coverage_judgment decides. (`deriveFloorKeys` is retained
// in coverage-ledger.mjs for command targeting / telemetry; `inScopeClassList` below still serves recall checks.)

// C2 — collapse same-owner+same-mark duplicate filings into ONE finding before the delivery phase reads
// findings.json (overview, cards, render, the published copy the MCP consumes). REWRITES findings.json on
// disk so every downstream surface keys off the single consolidated set, then RE-VALIDATES — if the merge
// somehow produced an invalid shape it leaves the original intact. Best-effort + quiet: any error no-ops
// (this is a delivery-quality pass, never a gate; a malformed findings.json is already handled upstream).

// A3 (F5) — deterministic coverage-row injection from the frame-reopen receipt: whatever the
// synthesis prompt did with the deferrals, the READER always gets the row. Runs after all synthesis
// re-runs settle (so a re-emit can't clobber it) and re-validates before writing (the
// consolidateFindingsFile posture). Never-kill: any defect leaves findings.json untouched.
// The deferral row and its reader's words live in deferral-row.mjs, so publishing can reuse them.
export { clipToWord, deferralCoverageRow } from "./deferral-row.mjs";   // @internal — re-exported for their tests

// qw/cn-scope-honesty — the zh candidate lane (Chinese-script semantic/
// phonetic register candidates) is the native-language investigation, which the offering carries on two
// of its four products and on neither of the others; a search that does not carry it keeps only its
// existing basic CN work. This is the HONESTY half of that decision, the injectDeferralCoverage posture
// verbatim: when the run's effective jurisdiction scope touches the zh-lane family
// (JURISDICTION_ADAPTERS: CN/HK/TW/MO — or an unscoped/worldwide run, which by engine convention sweeps
// those territories too; see the corsearch absent-region note above) AND the zh lane did NOT run on this
// run, the READER gets ONE deterministic coverage row saying what was not searched and where it can be
// bought. The row is `coverage-limited` — the DISCLOSED ACCEPTED
// LIMIT status: decideRegisterGap (coverage-ledger.mjs) clamps CLEAR→CONDITIONAL on `deferred` rows
// ONLY, so this row can NEVER flip a verdict, and nothing here gates delivery (flag-and-deliver).
// Search behavior changes NOWHERE — this branch adds honesty, not searching.
// (findings.json coverage vocabulary calls the field `state`; the register ledger calls the same
// closed token `status` — one vocabulary, two key names.)
// — LANE-GENERAL, not zh-hardcoded. LANGUAGE_LANES defines zh, ja and ko; the disclosure was
// written for zh alone, so a Japan- or Korea-scoped run at plain clearotron said NOTHING about the
// Japanese/Korean-script equivalents it had not searched. Silence there is indistinguishable from
// "there was nothing to search" — the same absence-reads-as-a-pass class as the remedy-term half of
//, one layer over.
//
// The vocabulary is DERIVED from the two tables that already own it, so there is no new
// hand-maintained table to drift ( is auditing exactly those): the script prefix comes from
// LANGUAGE_LANES[lane].label and the territory list from JURISDICTION_ADAPTERS. A lane added to those
// tables gets its disclosure row for free; a lane removed loses it. For zh the derivation reproduces
// the two constants below BYTE-FOR-BYTE, which is why they stay exported and are asserted against the
// derivation in the tests.
//
// SERP_LANES is deliberately untouched: zh-only there is the shipped design (SERP_LANES declared in jx-lanes.mjs), not
// drift, and generalising the platform grid is a different piece of work.
//
// ── THE REMEDY CLAUSE NAMES A PRODUCT, AND FOR A WHILE IT NAMED A DELETED ONE ───────────────────────
//
// This row reaches a CLIENT REPORT. It read "…not searched at this level — available at Depth 5
// (clearance-jx)": an internal product key and a rung on the depth ladder, both retired by, offered as
// the remedy for a coverage limit the same sentence had just disclosed. `injectScriptScopeCoverage`
// calls the decision on EVERY run, and it was driven — it fires for a worldwide scope, a CN-named scope
// and the ja lane — so this was delivered prose telling a reader to buy something that does not exist.
//
// The remedy now comes from products.mjs (NATIVE_LANGUAGE_REMEDY), which is where the offering's names
// live and the one place that moves when the offering does. "at this level" goes with it: there is no
// ladder for a level to sit on, and the honest subject is the search the client bought.
export const ZH_SCOPE_COVERAGE_AREA = "Chinese-script register equivalents (CN / HK / TW / MO)";   // @internal
export const ZH_SCOPE_COVERAGE_NOTE = `Chinese-script same-meaning/phonetic register equivalents not searched on this search — ${NATIVE_LANGUAGE_REMEDY}`;   // @internal

/** The zh-bound form, kept because it is the name the existing callers and tests use. Delegates —
 *  there is one decision, not two. PURE. */
export function decideZhScopeHonesty(opts = {}) {   // @internal
  return decideScriptScopeHonesty({ ...opts, lane: "zh" });
}

/** The zh-bound form, kept for the existing callers and tests. PURE apart from the sidecar read. */
export function zhLaneRanOnRun(runDir, opts = {}) {   // @internal
  return scriptLaneRanOnRun(runDir, "zh", opts);
}

/** The zh-only form, kept because it is the name the existing tests use. One writer, one lane. */
export function injectZhScopeCoverage(P, runDir, note, opts = {}) {   // @internal
  return injectScriptScopeCoverage(P, runDir, note, { ...opts, lanes: ["zh"] });
}

// ── V4-7 + WS-C: the global run-slot lock ───────────────────────────────────────────────────────────────
// Acquired by EVERY pipeline() entry (runner-dispatched or manual), so the cap holds no matter how a run
// is launched — the 2026-06-12 starvation came from manual relaunches bypassing the (then-serial) runner.
// Mechanics live in slot-lock.mjs (shared with the WS-C turn cap): pid:nonce tokens, ATOMIC stale
// reclaim, ownership-verified release — the old read-then-rm reclaim had a TOCTOU two concurrent
// acquirers (legal under cap 3) could use to end up sharing a slot. Returns a handle {slot, token}.
export async function acquireRunSlot(agent = null) {   // @internal
  // — one read, through the config getter. This line used to read `process.env`
  // first and fall through `config.maxConcurrentRuns || 1`, which READ as a third default and could
  // never produce one: the getter it fell through returns either a number >= 1 or NaN, and NaN is
  // truthy, so the `|| 1` was unreachable. The env-first read also bypassed the alias resolution every
  // other read of this variable gets, so an operator who set only the current spelling was invisible
  // here. The getter refuses a non-numeric value by name — BEFORE a slot is sought, so a typo'd cap now
  // says so at the door instead of leaving this run waiting on a comparison that can never be true.
  const cap = config.maxConcurrentRuns;
  return acquireSlot({
    dir: config.runLockDir, cap, prefix: "slot",
    // Phase-4: per-agent admission LIFTED (tag omitted) — a single agent may now hold multiple run slots
    // up to `cap`. The original one-run-per-agent fence guarded the gateway-era heartbeat-starvation + the
    // deferred M2 within-agent session-lock risk; both are moot now compute runs off-gateway with a per-run
    // claude session (no shared agent session). `agent` is kept only for the wait log. The runner keeps
    // claim+dedup serial per queue, so same-matter double-runs cannot slip through the relaxed slot cap.
    pollMs: Math.max(25, Number(process.env.CLEAROTRON_RUN_LOCK_POLL_MS || 15000)),
    onWait: (waitedMs) => note(`[pipeline] run admission waiting ${Math.round(waitedMs / 1000)}s (cap ${cap}${agent ? `, agent=${agent}` : ""})`),
  });
}

// P2 — reconcile every stage stamp against the artifacts as they finally stand for this pass, so the NEXT
// pass pays only for material that actually changed between passes (not for this pass's own driver-side
// re-merges/normalizations). Runs on success and failure alike, and always after the delivery precondition.
export function reconcilePassStamps(runRef, ctx) {   // @internal, exported for its test
  try {
    const P = ctx?.paths ?? runRef?.paths;
    if (!P?.runDir) return;
    // A delivery-blocked stale stage is left stale so the resume recomputes it. PR-11 closes the
    // sibling hole: a PENDING digest-queue item records a band/ledger mutation whose re-digest never
    // flushed (the pass died before the late flush, or the flush itself failed) — this finally runs
    // on EVERY pass exit, including those deaths, and reconciling the digest stamps there would
    // re-fingerprint them against the mutated band and make the next resume SKIP the very recompute
    // the queue still owes. The bare name excludes every axis's digest stamp; the stamps stay stale
    // until the queue is actually drained.
    const exclude = new Set(ctx?.deliveryBlockingStale ?? []);
    try {
      const q = coerceQueue(JSON.parse(readFileSync(P.digestQueue, "utf8")));
      if (pendingItems(q).length) exclude.add("register-digest");
    } catch {
      // No queue on disk is nothing pending. A queue that is there and does not read may still owe a re-digest, so the
      // digest stays stale and the resume recomputes it, rather than being reconciled as though nothing were owed.
      if (existsSync(P.digestQueue)) exclude.add("register-digest");
    }
    const n = reconcileStamps(P.runDir, (label) => {
      const bare = label.replace(/:.*$/, "");
      const axis = label.includes(":") ? label.slice(label.indexOf(":") + 1) : null;
      try { return stageInputs(bare, P, { axes: ctx?.axes, axis, registerOnly: ctx?.registerOnly }); } catch { return []; }
    }, exclude, { project: projectStageInput });
    if (n) runLog(P.runDir, { event: "stage-stamps-reconciled", stages: n });
  } catch { /* best-effort — a stamp we could not reconcile just costs a recompute next pass */ }
}

// — the live slot, exposed so the CLI's unsettled-run net can release it. `pipeline`'s own
// `finally` is the normal path and is unchanged; this is only reachable when that finally never runs,
// which is exactly the case a deadlock produces.
export let liveRunSlot = null;   // @internal

export async function pipeline(job, opts = {}) {
  const slot = await acquireRunSlot(opts.agent ?? config.defaultAgent);
  liveRunSlot = slot;
  try {
    return await pipelineInner(job, opts);
  } catch (e) {
    // RATE-LIMIT POSTPONE: a 429 session-cap at ANY stage is NOT a run failure — the run dir + every valid
    // stage are intact, so park it resumable and let the runner auto-resume after resetsAt (vs burning a
    // ~$40 cold re-run, and vs the futile fallback cascade). Any OTHER failure propagates unchanged.
    if (e instanceof StageFailure && e.rateLimited) return postponeRun(e, opts.__runRef, { job, agent: opts.agent ?? config.defaultAgent, ctx: opts.__ctx });
    // A RESUME THIS RUNNER CANNOT SERVE: the run started on an engine or a register this runner does not serve, and
    // the resume stopped before anything was spent or cleared. It parks, and resumes by itself on a runner that
    // serves its choice; it never switches to this runner's.
    if (isRunChoiceUnavailable(e)) return parkForRunChoice(e, { job, agent: opts.agent ?? config.defaultAgent });
    throw e;
  } finally {
    stopServingOwnQuestions(opts.__runRef?.runDir);   // the segment's questions end with it (own-search-questions.mjs)
    reconcilePassStamps(opts.__runRef, opts.__ctx);
    releaseSlot(slot);
    liveRunSlot = null;
  }
}

// The signal a resume raises when its recorded engine or register cannot be served here. Matched by its name and the
// fields the park needs, so the park does not depend on which module defines the signal.
export function isRunChoiceUnavailable(e) {   // @internal
  return e?.name === "RunChoiceUnavailable" && typeof e.run?.runDir === "string" && Boolean(e.dependency);
}

/**
 * Park a resume whose recorded choice this runner cannot serve. The marker states what the run waits on and what
 * ends the wait, as a rate-limit park does, with no clock of its own: the runner's due time is the park plus its
 * backoff, and the re-dispatch parks again until a runner serves the choice. Nothing was spent, so no cost rows.
 */
export function parkForRunChoice(e, { job, agent }) {   // @internal
  const { runDir, codename = null } = e.run;
  try {
    writePark(runDir, { kind: "run-choice", resetsAt: null, postponedAt: new Date().toISOString(), dependency: e.dependency,
      waitingOn: e.waitingOn ?? null, resolvedBy: e.resolvedBy ?? null }, { job, agent, codename });
  } catch (err) {
    // The returned park still tells this runner; a later runner finds the run only by its marker, so its loss is said.
    note(`[pipeline] park marker NOT written for ${codename ?? "run"}: ${String(err?.message ?? err).slice(0, 160)}`);
    try { runLog(runDir, { event: "park-marker-unwritten", kind: "run-choice", cause: String(err?.message ?? err).slice(0, 200) }); } catch { /* the note is the record */ }
  }
  note(`[pipeline] PARKED ${codename ?? "run"}: ${String(e.message).slice(0, 300)}`);
  return { ok: false, postponed: true, resetsAt: null, parkedFor: e.dependency, codename, runDir };
}

// logTurnaroundReconciliation, the quoted-against-actual row each run ending writes, lives in run-quote.mjs beside
// reconcileTurnaround.

// The two sentences a rate-limit park owes its reader, in ONE place. They are written into the `.postponed`
// sentinel for whoever reads the run dir AND printed by the CLI for whoever is watching the terminal, and a
// reader who meets both must not meet two different stories.
const PARK_WAITING_ON = "provider rate limit (the cap that refused the last dispatch)";
const PARK_RESOLVED_BY = "a live retry — the stored reset is a hint about when to look, not the authority on whether to. Nothing needs editing by hand if the cap lifts early.";

// Write the resumable POSTPONED state (no .failed sentinel, no notify-fail) and return a postpone result the
// runner parks as `<job>.postponed` (+ .meta) and re-dispatches once resetsAt passes. Best-effort throughout:
// the run dir + completed stages are the source of truth; a marker-write hiccup never turns a postpone into loss.
function postponeRun(e, run, meta = {}) {
  const resetsAt = e.resetsAt ?? null;
  const codename = run?.codename ?? null;
  note(`[pipeline] RATE-LIMITED at ${e.stage} — POSTPONING ${codename ?? "run"} until ${resetsAt ?? "the cap resets"} (resumable; no .failed written)`);
  if (run?.runDir) {
    // Self-contained resume payload: the runner's run-dir self-resume watcher reads {job, agent, codename,
    // fromStage} straight from this sentinel and re-invokes pipeline() — so a MANUALLY-resumed run (no queue
    // sidecars) auto-resumes too, not only queue jobs. postponedAt drives the backoff if resetsAt is null.
    // kind:"rate-limit" (A4): `.postponed` is written by BOTH the rate-limit postpone and the recovery
    // park, and only the recovery sentinel carried a discriminator — a reader had to infer the kind from
    // which fields happened to be present (the 2026-07-28 postmortem misread: a recovery park diagnosed as a
    // rate-limit park). Both sentinels now say what they are.
    // — the sentinel is the OTHER record that can independently resume this run, so it carries the
    // same probe state and the same statement of what the wait depends on. Both records are read through
    // ONE function (runner.postponedDueAt), which is what stops them disagreeing about whether the run
    // may proceed; carrying the fields here is what stops them disagreeing about how long it has waited.
    const priorProbe = (() => {
      try { return Number(JSON.parse(readFileSync(join(run.runDir, ".postponed"), "utf8"))?.probeAttempt) || 0; }
      catch { return 0; }
    })();
    try { writePark(run.runDir, { kind: "rate-limit", resetsAt, postponedAt: new Date().toISOString(), fromStage: e.stage, codename, job: meta.job ?? null, agent: meta.agent ?? null,
      probeAttempt: priorProbe + 1,
      waitingOn: PARK_WAITING_ON,
      resolvedBy: PARK_RESOLVED_BY }, { job: meta.job, agent: meta.agent, codename }); }
    catch (err) {
      // The marker is how the runner resumes the run once the limit resets; a run whose marker is lost is said to be.
      note(`[pipeline] park marker NOT written for ${codename ?? "run"}: ${String(err?.message ?? err).slice(0, 160)} — the runner cannot resume this run from it`);
      try { runLog(run.runDir, { event: "park-marker-unwritten", kind: "rate-limit", cause: String(err?.message ?? err).slice(0, 200) }); } catch { /* the note is the record */ }
    }
    // Flip the dashboard status.json state -> "postponed" (best-effort; the .postponed marker is the
    // source of truth). Routed through writeRunStatus so the terminal-state guard applies here too.
    try {
      if (existsSync(join(run.runDir, "status.json"))) writeRunStatus(null, { state: "postponed", resetsAt }, run.runDir);
    } catch { /* best-effort */ }
    try { runLog(run.runDir, { event: "postponed", stage: e.stage, resetsAt }); } catch { /* best-effort */ }
    logTurnaroundReconciliation(run.runDir, meta.ctx?.quote, "rate-limit-postponed");
    // A rate-limit park is exactly where spend hides: the stages that ran before the 429 burned tokens,
    // and if the run never resumes nothing else ever stamps them. The ledger row is written for the same
    // reason — a park that is never resumed is otherwise consumption no account-level view can see.
    const parkTokens = stampTokenRollup(run.runDir, "postponed");
    if (meta.ctx) recordRunConsumption(meta.ctx, { phase: "postponed", tokens: parkTokens });
  }
  return { ok: false, postponed: true, resetsAt, codename, fromStage: e.stage, runDir: run?.runDir ?? null };
}

/**
 * The instructed scope a job asks for — what the MATTER named, before any model ran.
 *
 * Pulled out of the run so it can be driven straight from a job, because the defect it closes lived
 * exactly in the seam between the intake gate and this object: the gate counts a job as carrying a
 * goods description under EITHER spelling, and this stamped only the current one. A job written the
 * older way passed the gate and landed `goods: null` — the scope file saying the matter named no
 * goods while the request plainly did — and every reader that asks what the matter covers reads this
 * file. Nothing said so, because nothing compared the two sites.
 *
 * PURE: a job in, a plain object out, no IO.
 */
export function instructedScopeOf(job) {
  // THE MARKS ARE ALWAYS A LIST. A job that names its mark only as `markName` — a queue file written by
  // hand or by a forwarding agent, a resume rebuilt from status.json — recorded the bare string, and the
  // declination tool's identical-mark refusal reads a list, so on those runs it saw no mark and never
  // fired. An array that names no mark falls back the same way the intake gate does; null when nothing
  // names one.
  const named = Array.isArray(job?.marks)
    ? job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean) : [];
  const single = job?.markName ?? job?.name ?? null;
  const markNames = named.length ? named : (single ? [single] : null);
  return {
    marks: markNames,
    classes: job?.classes ?? null,
    jurisdictions: job?.jurisdictions ?? null,
    // THE GATE'S OWN READING, imported rather than restated. A run's job is folded onto one field at
    // assembly, so this is normally reading what is already there; it stays for a job handed to this
    // function directly, and because the gate and the scope disagreeing is the defect it closes.
    goods: goodsOf(job),
    customer: job?.customer ?? null,
    // the geography stamp (enqueue-schema.mjs, "the GEOGRAPHY STAMP": {mode, origin}) — copied
    // VERBATIM, never recomputed: foldRecipeScope mutates job.jurisdictions on later passes (and
    // re-stamps origin "saved-search" when it does), so by read time the stamp is the only surviving
    // record of where the territories came from. Without it here, the frame reconstructs that
    // provenance from the request prose — a reconstruction validators.matterContext cannot check.
    // null = the job predates the stamp ("unrecorded", effective-scope.mjs) — an explicit state,
    // never a missing key.
    geography: job?.geography ?? null,
  };
}

async function pipelineInner(job, opts = {}) {
  // The order, the run directory, the resume checks and the context (steps/open-run.mjs).
  const { P, agent, ctx, isResume, run } = await openRun({ job, opts });
  // ── Phase 2a dispatch: a knockout-pipeline policy runs the SLIM lane (pipeline-knockout.mjs) —
  // lazy import (a clearance run never loads it; also breaks the static cycle). Placed INSIDE the
  // run slot + pipeline()'s rate-limit postpone catch, with profile+policy frozen; the knockout lane
  // owns its own framework freeze, status stepper and delivery handoff, and ends a failed run through
  // the clearance's own failure path (run-failed.mjs). attachSearchPolicy already refused any pipeline
  // this build cannot execute, so reaching this branch means the lane is available.
  if (ctx.searchPolicy?.pipeline === "knockout") {
    const { knockoutInner } = await import("./pipeline-knockout.mjs");
    return await knockoutInner(ctx, job, opts);
  }
  // doc 50 — freeze the framework-in-force's manifest beside it. A resume reads the frozen one verbatim
  // (never re-derived); a resume whose first pass stopped before this line mints it now, as that pass would
  // have.
  attachFramework(ctx);
  // A pass opens before the delivery seam: until this pass's seam folds the record, a save writes the
  // model's record as it is (record-fold.mjs).
  openPass(ctx.paths.runDir);

  // ── (t1cd): the digest-trigger FUNNEL ──────────────────────────────────────────────────────
  // The digest-trigger funnel (; flag deleted post-E2E 2026-07-22): the queue
  // (digest-queue.mjs) is the only path to a non-fresh re-digest EXCEPT for the sites declared in
  // digest-queue.mjs's DIGEST_OWN_PASS_EXEMPTIONS, which today is `enforceRecallReconciliation` alone
  // and carries the measured reason it cannot be queued (queueing it would orphan the mint the last
  // flush's own pass makes). That list is censused by an arm, so this sentence cannot go stale
  // silently again — it read "the ONLY path" while one mechanism had always fired its own pass, and an
  // invariant with an undeclared violation teaches the next reader the wrong rule.
  // Everything else: escalation/envelope/screen-gate keep
  // their unit-level work but MINT durable queue items instead of firing their own opus digest pass, and
  // the queue settles in ONE consolidated flush at the frame-reopen seam (pre-synthesis), plus at most
  // one bounded LATE flush for post-synthesis triggers (a screen-gate mint on a resume past synthesis).
  // The sidecar is loaded HERE, on every start/resume, BEFORE any trigger block runs: a resumed run
  // re-entering a mechanism re-mints the same receiptKey and no-ops — the 13-pass fix (per-mechanism
  // "max one" bounds no longer reset on resume). Because the flush changes register-findings.md ONCE
  // instead of N times, the stage-freshness staleness recompute of the whole back half (skeptic/
  // synthesis/cards/summaries) also happens once — that is most of the win. Proven live on
  // copper-bastion: 2 triggers → 1 flush across 3 sessions and 2 crash-resumes, zero duplicate mints.
  ctx.digestQueue = (() => {
    try { return coerceQueue(JSON.parse(readFileSync(P.digestQueue, "utf8"))); }
    catch { return emptyQueue(); }   // absent/torn sidecar ⇒ fresh queue (never worse than legacy)
  })();
  ctx.digestSettled = false;
  const persistDigestQueue = () => {
    try { atomicWrite(P.digestQueue, JSON.stringify(ctx.digestQueue, null, 2) + "\n"); }
    catch (e) { note(`digest-queue sidecar write failed (non-fatal): ${e.message}`); }
  };
  const mintDigestWork = (trigger, keyParts, followupSegment) => {
    const receiptKey = receiptKeyFor(trigger, keyParts);
    const r = mintItem(ctx.digestQueue, { trigger, receiptKey, followupSegment, mintedAt: new Date().toISOString() });
    ctx.digestQueue = r.queue;
    if (r.minted) {
      persistDigestQueue();
      runLog(run.runDir, { event: "digest-queued", trigger, receiptKey });
      note(`digest-funnel: ${trigger} re-digest work queued (${receiptKey}) — reconciles at the next settlement flush`);
    } else {
      runLog(run.runDir, { event: "digest-queue-noop", receiptKey });
      note(`digest-funnel: ${trigger} re-mint no-ops (${receiptKey} already ${r.item.flushedAt ? "flushed" : "pending"}) — no new digest pass`);
    }
    return r.minted;
  };
  // The settlement flush: ONE re-digest follow-up (a fresh session carrying its whole message, as every follow-up
  // is; stages.mjs, followup composition) carrying every queued segment (plus the frame-reopen
  // segment when that block fired), sectioned, ending with the standard FULL re-emission contract.
  // Timeout ⇒ one retry on a fresh session, on the same model (the legacy frame-reopen re-digest's own
  // recovery). A flush that still fails leaves its items PENDING (durable — the late flush or the next
  // resume's settlement gets one more chance) and the run continues on the prior digest: the funnel
  // never gates delivery. On success, items are receipted (markFlushed — they can never re-fire), the
  // envelope's deferred verification runs (ctx.envelopeFlushVerify), and the screen-gate is re-checked
  // in code over the flushed findings (ctx.screenGateRecheck — one bounded code-fetch repair round).
  const flushDigestQueue = async (pass, extraSections = []) => {
    const pending = pendingItems(ctx.digestQueue);
    if (!pending.length && !extraSections.length) return { ran: false, ok: true };
    const sections = [...extraSections, ...pending.map((i) => ({ trigger: i.trigger, text: i.followupSegment }))];
    // A8's dispatch hint reaches FRESH dispatches only — stageOnce ignores `extra` when opts.followup is
    // set, and a flush is always a followup. That exemption is where the evidence run lost 2,908s: the
    // settlement flush failed coverage_clean_deferred twice more (1,402s then 1,506s, the file growing
    // 103,639 → 160,913 bytes while it failed) over the same three slices the receipt had recorded hours
    // earlier. A flush carries its own message, so the settled facts ride it as a section.
    const settledSection = settledDeferralsSection(readEnvelopeDecision(P));
    if (settledSection) sections.unshift({ trigger: "settled-coverage-facts", text: settledSection });
    const followup = repairFollowup("register-digest:digest-flush", { registerFindingsPath: P.registerFindings, sections });
    const trigger = pass === "late" ? "late-flush" : "settlement-flush";
    let rd = await runDigest(ctx, { force: true, followup, sessionKey: ctx.digestKey, trigger });
    if (!rd.ok && /timeout/.test(String(rd.fail))) {
      note(`digest-funnel: ${trigger} timed out — ONE retry on a fresh session, same model`);
      runLog(run.runDir, { event: "digest-flush-timeout", pass, fail: String(rd.fail).slice(0, 120) });
      rd = await runDigest(ctx, { force: true, trigger: `${trigger}-retry` });
    }
    if (rd.ok) {
      ctx.digestQueue = markFlushed(ctx.digestQueue, pending.map((i) => i.id), new Date().toISOString());
      persistDigestQueue();
      runLog(run.runDir, { event: "digest-flush", pass, items: pending.map((i) => i.receiptKey),
        triggers: [...new Set(sections.map((s) => s.trigger))] });
      note(`digest-funnel: ${pass} flush landed — ${sections.length} section(s) reconciled in one digest pass`);
      // stage-freshness interaction: the flush is a SANCTIONED post-audit refinement of the findings
      // (legacy parity — on a fresh run the escalation/envelope re-digests also post-date the skeptic,
      // and the delivery gate accepts it because the stage RAN that pass and reconcileStamps blesses
      // it). On a RESUMED pass skeptic/frame-diff SKIPPED, so their stamps would read the flush as
      // delivery-blocking staleness and park the run into another re-drive cycle — the very cascade
      // this funnel bounds. Their one-shot receipts (escalation fires once per flag set; the reopen
      // receipt) forbid a post-settlement re-run anyway, so take the flush as accounted-for in exactly
      // those two stamps. Synthesis and the back half are deliberately NOT restamped: their staleness
      // recompute is the contract — and it now happens ONCE, off one flush, instead of once per
      // mechanism re-digest.
      //
      // FRAME-DIFF LEFT THIS LOOP ON 2026-08-04 ( follow-up). It used to ride here for the same
      // reason the skeptic does, and re-aimed stageInputs["frame-diff"] at the register evidence —
      // it no longer declares register-findings.md or register-coverage-ledger.json, so the two calls
      // had become a guaranteed no-op that nothing recorded. Nothing this flush writes is a frame-diff
      // input (the re-digest rewrites the findings and the coverage ledger; it never touches the band or
      // the units), so there is nothing here to account for. The rewrites frame-diff DOES need accounted
      // for happen upstream of this seam, at the settleOneShotStamp call sites. The skeptic still
      // declares both files, so its half stays exactly as it was.
      restampStage(run.runDir, "skeptic", P.registerFindings, { project: projectStageInput });
      restampStage(run.runDir, "skeptic", P.registerCoverageLedger, { project: projectStageInput });
      if (ctx.envelopeFlushVerify) {
        const verify = ctx.envelopeFlushVerify;
        ctx.envelopeFlushVerify = null;
        try { verify(); } catch (e) { note(`envelope post-flush verification failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
      }
      // the flush landed ⇒ the frame-reopen reconcile (if any was pending) is in the findings — the
      // demotion hook below is moot; drop it so a LATER flush failure can't demote a reconciled close.
      ctx.frameReopenFlushDemote = null;
      if (ctx.screenGateRecheck) {
        try { await ctx.screenGateRecheck(pass); } catch (e) { note(`screen-gate post-flush re-check failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
      }
    } else {
      runLog(run.runDir, { event: "digest-flush-failed", pass, fail: String(rd.fail).slice(0, 160),
        items: pending.map((i) => i.receiptKey) });
      note(`digest-funnel: ${pass} flush failed (${rd.fail}) — items stay pending (durable); the run continues on the prior digest`);
      // C2 (review fix, 2026-07-29): the LOCKED-path dispatch arm released its verified closes on the
      // PROMISE of this flush (receipt swept + domClosed + the clamp dropped) — the unlocked path
      // demotes them when its pre-synthesis flush fails (the redigest-fail demotion invariant), so the
      // locked path must too. The reopen block registers this hook whenever a frame-reopen reconcile
      // item is riding the queue; a failed flush demotes every verified-closed directive back to a
      // disclosed deferral, rewrites the receipt (domClosed:false) and re-arms ctx.frameReopenGap —
      // the delivered verdict carries the unreconciled gap. Flushes always carry ALL pending items,
      // so a failure here IS the frame-reopen item's failure. Same envelopeFlushVerify hook shape.
      if (ctx.frameReopenFlushDemote) {
        const demote = ctx.frameReopenFlushDemote;
        ctx.frameReopenFlushDemote = null;
        try { demote(rd.fail); } catch (e) { note(`frame-reopen post-flush demotion failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
      }
    }
    return { ran: true, ok: rd.ok, fail: rd.fail, result: rd };
  };
  // Spec A5 — archive the VERBATIM inbound request (untouched) + the intake confirmation brief as run
  // artifacts the moment the run exists, so every matter-frame claim about the request is traceable to
  // the source text and the brief the requester actually saw. Idempotent (plain overwrites, same content).
  try {
    if (job.rawRequest) writeFileSync(P.inboundRequest, String(job.rawRequest));
    if (job.brief) writeFileSync(P.confirmationBrief, String(job.brief));
    if (job.rawRequest || job.brief) runLog(run.runDir, {
      event: "intake-artifacts", rawRequest: Boolean(job.rawRequest), brief: Boolean(job.brief),
    });
  } catch (e) { note(`intake artifact write failed (non-fatal): ${e.message}`); }
  // WS2 (B3) — the code-authoritative INSTRUCTED SCOPE: what the job fields actually said,
  // written before any model breathes on them. The matter frame must quote these verbatim (the
  // frame validator compares against THIS file, never against the frame's own paraphrase) —
  // paraphrase drift between the request and the frame is a defect, not a style choice.
  try {
    const scope = instructedScopeToWrite(job, { jobRebuiltFromStatus: opts.jobRebuiltFromStatus, scopeOnDisk: existsSync(P.instructedScope) }); if (scope) { writeFileSync(P.instructedScope, JSON.stringify(scope, null, 2) + "\n"); writeStatedFacts(P, job); }   // what the order states, kept with its source (stated-facts.mjs)
  } catch (e) { note(`instructed-scope write failed (non-fatal): ${e.message}`); }
  // THE STORED DEFAULTS THE ENGINE CANNOT SEARCH — recorded by the run, not only by the plan preview.
  //
  // `defaultTerritoryState` is the ONE producer of this reading (effective-scope.mjs) and it is CALLED
  // here rather than re-derived: the run's own territory ladder (`resolveTerritories`) passes an
  // unrecognised account default straight through, so before this the only surfaces that named one were
  // the plan response and the profile screen — both intake-side. A firm whose stored default is
  // misspelled got a narrower search than the configuration says, and no run artifact said so.
  // Written for EVERY run, empty list included: an empty array is the asserted zero, and a reader who
  // only ever sees this file on the runs that had a bad entry cannot tell it from a run nothing checked.
  try {
    const dts = defaultTerritoryState(ctx.profile);
    // two records of one fact, so each has its own try: a fault in one must not take the other
    try { if (dts.unrecognized.length) runLog(run.runDir, { event: "default-territory-unrecognized", count: dts.unrecognized.length, entries: dts.unrecognized }); } catch (e) { note(`default-territory-unrecognized log failed (non-fatal): ${e.message}`); }
    writeFileSync(P.defaultTerritories, JSON.stringify({
      profileKey: ctx.profile?.profileKey ?? null,
      searchable: dts.kept,
      unrecognized: dts.unrecognized,
    }, null, 2) + "\n");
  } catch (e) { note(`default-territories write failed (non-fatal): ${e.message}`); }
  // Change B5 — unknown-customer state + the late-bind consumer. The intake gate sets
  // job.customerUnknown when the applicant is neither stated nor forwarder-implied; the forwarding agent
  // may later drop customer-bind.json into this run dir when a thread reply names the applicant (B5b).
  // checkLateBind polls at four phase checkpoints; binding by phase per lateBindAction (pure, above).
  ctx.customerUnknown = job.customerUnknown === true && !job.customer;
  const readBind = () => {
    try {
      const b = JSON.parse(readFileSync(P.customerBind, "utf8"));
      if (!b || !b.customer) return null;
      const bind = { customer: String(b.customer), exclusions: Array.isArray(b.exclusions) ? b.exclusions.map(String) : [] };
      // WS-B: a bound applicant that IS the profile customer activates the profile's exclusion seed —
      // union it into the reply's exclusions so EVERY downstream consumer (fold, digest-message
      // block, re-digest followup) sees one combined set, not just the matter-frame line.
      if (applicantMatchesProfile(ctx.profile, bind.customer) && ctx.profile?.selfExclusionOwners?.length) {
        bind.exclusions = [...new Set([...bind.exclusions, ...ctx.profile.selfExclusionOwners])];
        ctx.exclusionSeed = ctx.profile.selfExclusionOwners;
      }
      return bind;
    } catch { return null; }
  };
  const checkLateBind = async (phase) => {
    if (!ctx.customerUnknown || ctx.lateBound) return;
    const bind = readBind();
    if (!bind) return;
    const action = lateBindAction({
      matterFrameRan: existsSync(P.matterContext),
      digestRan: existsSync(P.registerFindings),
      narrativeExists: existsSync(P.narrative),
    });
    ctx.lateBound = true;
    ctx.customerUnknown = false;
    runLog(run.runDir, { event: "customer-late-bind", phase, action, customer: bind.customer, exclusions: bind.exclusions });
    note(`customer late-bind at ${phase}: ${bind.customer} → ${action}`);
    if (action === "fold-job") {
      job.customer = bind.customer;                 // normal path — matter-frame consumes it like any stated customer
    } else if (action === "digest-message") {
      ctx.lateBind = bind;                          // the digest stage message carries the re-classification block
    } else if (action === "warm-redigest") {
      // exclusion IS a filter: one reconciliation follow-up of the digest step, in a fresh session — re-classify, never re-run searches
      const followup = repairFollowup("register-digest:late-bind", { registerFindings: P.registerFindings, bind });
      const r = await runDigest(ctx, { force: true, followup, sessionKey: ctx.digestKey, trigger: "late-bind" });
      if (!r.ok) note(`late-bind re-digest failed (non-fatal — classification note will ride the report): ${r.fail}`);
    } else if (action === "front-matter-note") {
      ctx.lateBindNote = `applicant named mid-run as ${bind.customer}; findings were classified without an exclusion set — re-classification available on request`;
    }
    // B5b ack (Jordan, 2026-06-12): the requester gets a plain-language confirmation that the answer
    // landed and WHAT was done with it — a bind must never be a silent black hole. Best-effort;
    // markers/events are already written above, so an ack failure can never lose the bind. The ack
    // rides the outbox as an event packet, like every other requester-facing event.
    try {
      const mark = job.markName ?? job.name ?? run.slug;
      const text = action === "front-matter-note"
        ? `✅ Noted — applicant for the ${mark} search recorded as ${bind.customer}. The analysis was already written, so the report will carry a note saying so; reply if you want the findings re-classified against their portfolio.`
        : `✅ Noted — applicant for the ${mark} search recorded as ${bind.customer}. Folded into the running search: their own marks won't be reported as conflicts.`;
      const runId = `${run.slug}-${run.date}-${run.codename}`;   // canonical runId form (charter P1 §3) — every outbox marker carries the same id
      const p = writeOutboxPacket(`${runId}.bindack`, {
        kind: "late-bind-ack", runId, agent,
        forwarder: job.forwarder ?? null, forwarderEmail: job.forwarderEmail ?? null, msgId: job.msgId ?? null,
        customer: bind.customer, action, ...whatsappRouting(job, agent), text,
      });
      runLog(run.runDir, { event: "customer-late-bind-ack", sent: Boolean(p), via: "outbox" });
    } catch (e) { note(`late-bind ack failed (non-fatal): ${e?.message ?? e}`); }
  };
  await checkLateBind("pre-matter-frame");
  // WS-B exclusion gate (after the pre-start bind so a folded applicant counts): the profile's
  // selfExclusionOwners[] seeds the matter frame ONLY when the job's applicant IS this customer —
  // a profile-matched forwarder asking about a third party must never get the customer's own marks
  // classified out of the conflicts.
  ctx.exclusionSeed = applicantMatchesProfile(ctx.profile, job.customer) ? (ctx.profile.selfExclusionOwners ?? []) : [];
  if (ctx.exclusionSeed.length) runLog(run.runDir, { event: "profile-exclusion-seed", owners: ctx.exclusionSeed.length });
  // On resume, rehydrate the driver-owned notes that must survive a park. (The failover provenance that
  // used to be rehydrated alongside is deleted with the chain — no run ever carried any.)
  if (isResume) {
    try {
      const prior = JSON.parse(readFileSync(join(run.runDir, "status.json"), "utf8"));
      // WS-A: the machine-ledger fallback/quarantine note must survive a resume — a delivered run flags
      // its prose fallback even when the digest was skipped.
      if (typeof prior.machineLedgerNote === "string" && prior.machineLedgerNote) ctx.machineLedgerNote = prior.machineLedgerNote;
    } catch { /* none */ }
  }
  // --from <stage>: force re-run of that stage and everything downstream (idempotency still skips earlier stages).
  ctx.forceFrom = opts.fromStage != null ? stageOrdinal(opts.fromStage) : null;
  if (opts.fromStage != null && ctx.forceFrom < 0) throw new Error(`--from: unknown stage "${opts.fromStage}"`);
  runLog(run.runDir, { event: "start", agent, resume: isResume, fromStage: opts.fromStage ?? null, job: { id: job.id, slug: run.slug, codename: run.codename, customer: run.customer, forwarder: job.forwarder } });
  // THE SIGNA RUN MEMORY'S ATTEMPT (providers/_shared/answer-memory.mjs): whatever an earlier attempt held
  // is dropped, so a resume asks the register again, and the mode is fixed for this attempt.
  ctx.answerMemory = beginAnswerMemory(run.runDir, ctx.register ?? REGISTER_PROVIDER);
  if (ctx.answerMemory.applies)
    runLog(run.runDir, { event: "answer-memory", mode: ctx.answerMemory.mode, ...(ctx.answerMemory.unknown ? { unrecognised: ctx.answerMemory.unknown } : {}) });
  if (ctx.answerMemory.unknown) note(`answer memory: ${ctx.answerMemory.switch}="${ctx.answerMemory.unknown}" is not off, watch or on, so this register's default applies (${ctx.answerMemory.mode})`);
  // item 11 — WHICH ARM DID THIS RUN RUN UNDER? Unconditional and three-valued in the AD-4 sense: the row
  // is always written, `seed: null` meaning the ordinary production ordering. A probe arm that is not on
  // the record is an arm whose result cannot be attributed later, and the probe exists to attribute.
  runLog(run.runDir, { event: "order-probe", seed: orderProbeSeed() });
  seedRunStatus(ctx, { resume: isResume });   // status.json + STATUS.md answerable from the first moment of the run; a resume records resumedAt/attempts and never touches startedAt (A3)
  rollupStatus(run.studioRoot);
  // THE QUOTE, frozen at the start of the run and carried to every terminal.
  //
  // This is the join key the whole calibration rests on: without "what we said this would be" recorded
  // beside "what it consumed", measured tokens can never correct the weights that produced the estimate.
  // Derived from the FROZEN sidecars (ctx.searchPolicy, ctx.profile), so a resume re-derives the same
  // number rather than re-quoting a run mid-flight — the figure the requester was shown is the figure it
  // is measured against. Best-effort: a run must never fail because it could not be sized.
  ctx.quote = quoteForJob({ job, profile: ctx.profile, searchPolicy: ctx.searchPolicy });
  if (ctx.quote) runLog(run.runDir, { event: "quote", ...ctx.quote });
  note(`\n=== clearotron-driver: ${run.slug} / ${run.date}-${run.codename} (agent=${agent}) ===`);

  // How the run ends delivered (run-delivered.mjs).
  const { deliverWithoutTheAssessment, publishAndDeliver } = await deliveryEndState({ P, agent, ctx, job, run, opts });

  // The clearance's own steps, in order, run by run-shell.mjs. A value one step hands a later one is held here, between
  // them; a step that returns a result ends the run with it. A failure in any step ends through run-failed.mjs.
  let axes, runCommonLaw, planExec, unitKey, dispatchPlanQids, synthesisKey, synthesisModel, synthesisThinking, coverageJudgment, reviewOpen, firstRef, runState, correctiveEntryVerdict, correctiveCycleSettled, correctiveRecheckOk, applyCoverageFloor, clampOnTheFloorDuty, clampOnTheWritersDuty, deliverAndClamp, followTheRecordsActions, saveTheLabel, saveTheOwedLabel, writeVerdictSidecar, applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, findingsForCards, groupedMembers, overviewOpen, rebuildTheDeliveredRecord, restoreTheBrokenRecord, rov, writeScopeFacts, writeUps;
  return await runShell({ P, agent, ctx, job, run }, { ending: CLEARANCE_ENDING, helpers: { recordConnotationAudit, sentinel, undoTaintRenames }, steps: [
    { name: "intake", run: async () => {
        // The matter frame, its variants and the plan (steps/intake.mjs).
        ({ axes, runCommonLaw } = await runIntake({ P, ctx, job, opts, run }));
    } },
    { name: "register-sweep", run: async () => {
        // The register and unregistered-use searches and their fan-in (steps/register-sweep.mjs).
        ({ planExec, unitKey, dispatchPlanQids } = await runRegisterSweep({ P, agent, axes, ctx, job, opts, run, runCommonLaw }));
    } },
    { name: "frame-comparison", run: async () => {
        // The blind frame compared with what the run scoped, and the reopen (steps/frame-comparison.mjs).
        await runFrameComparison({ P, axes, ctx, dispatchPlanQids, flushDigestQueue, job, mintDigestWork, planExec, run, runCommonLaw, unitKey });
    } },
    { name: "placement-and-digest", run: async () => {
        // Step 2C placement → Step 2D digest
        //
        // THE PASS THAT RESUMES A RUN WHOSE ASSESSMENT COULD NOT BE COMPLETED delivers what the run holds, here, at the
        // assessment's first step and before anything that exists only to feed it runs. See deliverWithoutTheAssessment.
        const assessmentOpen = readPartNotCompleted(run.runDir, "assessment");
        if (assessmentOpen) return await deliverWithoutTheAssessment(assessmentOpen);
        // Placement and the register write-up (steps/placement-and-digest.mjs).
        await runPlacementAndDigest({ checkLateBind, ctx });
    } },
    { name: "skeptic-and-follow-up", run: async () => {
        // The skeptic, and the searches and rechecks that follow it (steps/skeptic-and-follow-up.mjs).
        await runSkepticAndFollowUp({ P, agent, axes, ctx, dispatchPlanQids, flushDigestQueue, job, mintDigestWork, opts, planExec, run, unitKey });
    } },
    { name: "synthesis", run: async () => {
        // The writer, the case-law grounding and the first review (steps/synthesis.mjs).
        ({ synthesisKey, synthesisModel, synthesisThinking, coverageJudgment, reviewOpen, firstRef } = await runSynthesis({ P, checkLateBind, ctx, job, opts, run }));

        // Step 4.7 — the code-side verdict gate
        // — the classifier is handed the FAILURE, not a statement about the ladder. The
        // condition leads the sentence: `recoveryLaneOf` reads the reason text, and a park bought because an
        // upstream provider was rate-limiting is WEATHER, not a defect. The ladder's own summary stays, after
        // it, because "this had already exhausted retries and fallback" is still what a reader needs next.
        // The fallback branch is deliberate and not decoration: when the ladder truly recorded no condition,
        // saying so is honest, and inventing one would be the same guess in a more confident voice.
        if (!firstRef.ok)
          throw Object.assign(new StageFailure("narrative-refutation", firstRef.fail
            ? `${firstRef.fail} — the refutation ladder exhausted retries and fallback on it`
            : "failed after retries + fallback (the ladder recorded no condition)"), { notCompletedPart: "review" });
        runState = { verdict: firstRef.verdict };   // null where the review was not completed: no sign-off, the band alone
        runLog(run.runDir, { event: "verdict", verdict: runState.verdict });
        writeRunStatus(ctx, signoffPatch(runState.verdict));
        note(`refutation verdict: ${runState.verdict}`);
        // qw/typed-correction-kinds — TELEMETRY ONLY (data first; the corrective-skip decision is a
        // separate owner-gated build): partition the review's flagged-correction lines by their
        // self-declared [kind: …] tokens (verify.parseCorrectionKinds — closed enum, author-declared,
        // untyped/unknown ⇒ `fact` fail-safe) and record the histogram in run.jsonl. ZERO behavior
        // change by construction: the corrective/recheck flow below reads only `verdict`, never these
        // counts, and a read/parse defect can never touch the verdict gate.
        // AD-4 (instrumentation house rule): the event is written UNCONDITIONALLY. The R2 evidence run logged
        // an all-zero histogram against a BLOCKING verdict, and nothing said whether the reviewer really flagged
        // zero correction lines or the read/parse quietly failed (the old catch logged NOTHING). Now: `verdict`
        // rides the row (an all-zero histogram on CONDITIONAL/BLOCKING is legible as the anomaly it is), and a
        // read/parse failure is a recorded fact (ok:false + the error) instead of silence.
        // — `kindChannelOk` IS A SECOND FACT, AND IT NEEDED ITS OWN KEY.
        //
        // `ok` here has always meant "the file was read and parsed without throwing". It cannot also carry
        // "the reviewer's kind channel produced something", and overloading it would have been the cheaper
        // change and the wrong one: the two are false in different situations and a reader cannot tell which
        // from one boolean.
        //
        // The distinction is the whole. A review where every parsed line landed on the `fact`
        // fail-safe reads, in the counts alone, exactly like a review whose flags were all genuinely
        // factual — and on the run that found this, `fact: 10` on a BLOCKING verdict was the former and
        // looked entirely reasonable. The all-zero histogram AD-4 above made legible is the easy case;
        // `untyped === total` is the one that was not, and now it is a recorded fact rather than an
        // inference a reader has to make by comparing two other numbers.
        try {
          const ck = parseCorrectionKinds(readFileSync(P.seniorEyeReview, "utf8"));
          runLog(run.runDir, { event: "correction-kinds", ok: true, kindChannelOk: ck.ok !== false, verdict: runState.verdict,
            counts: ck.counts, untyped: ck.untyped, total: ck.total, ...(ck.why ? { kindChannelWhy: ck.why } : {}) });
        } catch (e) {
          // The key rides BOTH arms: written only on success, its absence on a failed row would read as
          // "the channel was fine", which is precisely the inference this issue exists to stop.
          try { runLog(run.runDir, { event: "correction-kinds", ok: false, kindChannelOk: false, verdict: runState.verdict, error: String(e?.message ?? e).slice(0, 160) }); }
          catch { /* telemetry best-effort — never-kill */ }
        }
    } },
    { name: "correction-cycle", run: async () => {
        // The correction after the review and the recheck of it (steps/correction-cycle.mjs).
        const correctionCycle = await runCorrectionCycle({ ctx, run, P, verdict: runState.verdict, firstRef, synthesisKey, synthesisModel, synthesisThinking });
        runState.verdict = correctionCycle.verdict;
        ({ correctiveEntryVerdict, correctiveCycleSettled, correctiveRecheckOk } = correctionCycle);
    } },
    { name: "verdict-gate", run: async () => {
        // The verdict's floors and terminal guards (steps/verdict-gate.mjs).
        // applyVerdictFrontMatter is declared further down, so it goes in by name, read when called.
        ({ applyCoverageFloor, clampOnTheFloorDuty, clampOnTheWritersDuty, deliverAndClamp, followTheRecordsActions, saveTheLabel, saveTheOwedLabel, writeVerdictSidecar } = await runVerdictGate({ P, agent, applyVerdictFrontMatter: (...a) => applyVerdictFrontMatter(...a), correctiveCycleSettled, correctiveEntryVerdict, correctiveRecheckOk, coverageJudgment, ctx, opts, run, runState }));

        // R.1 primitive #3 (engagement receipt) is computed later, in the pre-delivery block, together with
        // F2 rule-shape + B2b reviewer self-coherence into ONE _driver/reasoning-integrity.json sidecar — that
        // point has report.md + senior-eye-review.md on disk too, so the single writer carries all three signals.
    } },
    { name: "overview-and-cards", run: async () => {
        // The report's overview and its cards (steps/overview-and-cards.mjs).
        ({ applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, findingsForCards, groupedMembers, overviewOpen, rebuildTheDeliveredRecord, restoreTheBrokenRecord, rov, writeScopeFacts, writeUps } = await runOverviewAndCards({ P, applyCoverageFloor, clampOnTheWritersDuty, ctx, followTheRecordsActions, job, run, runState, saveTheLabel, writeVerdictSidecar }));
    } },
    { name: "delivery", run: async () => {
        // The checks before delivery, their repairs, and the publish (steps/delivery.mjs).
        return await runDelivery({ P, applyCoverageFloor, applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, checkLateBind, clampOnTheFloorDuty, clampOnTheWritersDuty, ctx, deliverAndClamp, findingsForCards, followTheRecordsActions, groupedMembers, job, opts, overviewOpen, publishAndDeliver, rebuildTheDeliveredRecord, restoreTheBrokenRecord, reviewOpen, rov, run, runState, saveTheLabel, saveTheOwedLabel, synthesisKey, synthesisModel, synthesisThinking, writeScopeFacts, writeUps, writeVerdictSidecar });
    } },
  ] });
}

// ---- operability: resolve / reconstruct / single-stage re-run / sandboxed experiment -----------------

// Resolve an existing LIVE run identity from a codename. Drop 1: live runs only — an archived (delivered) run
// is intentionally not a re-run/--from target. buildRunContext then rebuilds the same identity (same run-dir).
function resolveRun(job, opts) {
  if (!opts.codename) throw new Error("a codename is required (pass --resume <codename>)");
  const studioRoot = opts.studioRoot ?? config.studioRoot;
  const date = findRunDate(job, opts.codename, studioRoot);
  if (!date) throw new Error(`no live run-dir for codename "${opts.codename}" under ${join(studioRoot, deriveSlug(job))}`);
  return buildRunContext(job, { studioRoot, archiveRoot: opts.archiveRoot ?? config.archiveRoot, codename: opts.codename, date });
}

// Rebuild the ctx a single stage needs WITHOUT re-running upstream: axes from the persisted manifest, verdict
// from status.json, publishedUrl from .published. (Mirrors what pipeline() accumulates mid-run.)
/**
 * THE JOB A RUN RAN, READ BACK OUT OF THE RUN'S OWN STATUS. PURE.
 *
 * `--resume` needs a job file, and the job file is gone by the time a resume is needed: the queue entry
 * that carried it is consumed when the run starts, and nothing copies it into the run directory. So the
 * one command that repairs a failed run names a path the box does not have, and the person who finds out
 * is the person trying to repair it.
 *
 * This is not a guess at the job. `seedRunStatus` writes these fields FROM the job the engine ran, so
 * reading them back is the engine's own record, not a reconstruction of intent. `reconstructCtx` reads
 * profile and framework from the run's frozen sidecars with `write: false`, so the run's own configuration
 * governs and the job supplies identity.
 *
 * THE ORDER'S TERRITORIES COME FROM THE RUN'S INSTRUCTED SCOPE, `scope` here. Status does not carry
 * them, and the stage messages read them off the job: the narrowing line names "one
 * question per market of the order's scope", and the default-territories line says whether the request
 * named any. A job without them fell back to the account's defaults, so a stage re-run on a saved run was
 * told markets the order never named (measured, 2026-10-29: four in place of the order's three). The run
 * wrote `jurisdictions` and `geography` verbatim from its job at intake (`instructedScopeOf`), so copying
 * them back gives the job its own territories, not a reading of them.
 *
 * THE ORDER'S MARKS, GOODS AND APPLICANT COME FROM THE SAME SCOPE, for the same reason. The review's
 * plain-words block reads the marks list, the frame messages print the goods only when the job carries
 * them, and the self-exclusion seed reads the applicant. The scope keeps each mark's name and nothing
 * else of its entry, so the marks come back as `{ name }`. An entry's own reference and classes are not
 * read back; the job's are, from status.
 *
 * THE ACCOUNT COMES FROM THE FROZEN PROFILE, `profile` here, and only where this install's roster holds
 * it. `buildRunContext` resolves the account through `selectCustomer`, which refuses a key the roster
 * lacks rather than fall back to `generic`. On the install that ran the run the roster holds it. A copy of
 * the run read where it does not, such as a sandbox on the bundled roster, would be refused for a job
 * field the resume does not need: the frozen profile governs either way. So the key is left off there,
 * as it was before it was restored, and the caller says so. `roster` null means not checked.
 *
 * THE PRODUCT COMES FROM THE FROZEN SEARCH POLICY, `searchPolicy` here, only when the order named it
 * (`origins.level` is `job.product`). A product resolved from a saved search, the account's default or
 * the scope was never on the order, so a job carrying it would be a different order.
 *
 * THE PROJECT AND THE ORGANISATION COME FROM THE FROZEN PROFILE TOO: the freeze took `projectKey` from the order,
 * and stamped a Generic run's `tenant` as its `organisation`. This rebuild is the last resort, for a run that kept no
 * copy of its order (accepted-order.mjs); the fields only the order held are not here.
 *
 * THE CALLER MUST CHECK THE SLUG, and `resumeJobRefusal` below is that check. A rebuilt job that derives
 * the run's own slug has reproduced the run's identity — `deriveSlug` reads `ref` and `markName` and
 * nothing else — and one that derives a different slug is a job for a different matter.
 */
export function jobFromStatus(status, scope = null, { profile = null, searchPolicy = null, roster = null } = {}) {   // @internal
  const s = status ?? {};
  if (!s.id && !s.ref && !s.markName) return null;   // not a status this can rebuild from
  const named = Array.isArray(scope?.marks) ? scope.marks.filter((m) => typeof m === "string" && m.trim()) : [];
  const said = (v) => v != null && String(v).trim() !== "";
  const account = typeof profile?.profileKey === "string" && profile.profileKey.trim() ? profile.profileKey : null;
  const product = searchPolicy?.origins?.level === "job.product" && said(searchPolicy?.level) ? searchPolicy.level : null;
  return {
    id: s.id ?? null, ref: s.ref ?? null, markName: s.markName ?? null,
    classes: Array.isArray(s.classes) ? s.classes : null,
    forwarder: s.forwarder ?? null,
    ...(named.length ? { marks: named.map((name) => ({ name })) } : {}),
    ...(said(scope?.goods) ? { goods: scope.goods } : {}),
    ...(said(scope?.customer) ? { customer: scope.customer } : {}),
    ...(Array.isArray(scope?.jurisdictions) ? { jurisdictions: scope.jurisdictions } : {}),
    ...(scope?.geography && typeof scope.geography === "object" ? { geography: scope.geography } : {}),
    ...(account && (!roster || roster.has(account)) ? { profileKey: account } : {}),
    ...(said(profile?.projectKey) ? { projectKey: profile.projectKey } : {}),
    ...(account === "generic" && said(profile?.organisation) ? { tenant: profile.organisation } : {}),
    ...(product ? { product } : {}),
  };
}

/** Why a rebuilt job may not stand in for the run's own, or null when it may. PURE. */
export function resumeJobRefusal(job, slug) {   // @internal
  if (!job) return "this run's status.json carries no id, reference or mark name, so the job it ran cannot be read back from it";
  // EVERY IDENTIFYING FIELD, OR NO REBUILD: a job missing one is a guess at that field, and a resume must not guess.
  const missing = [["id", job.id], ["markName", job.markName], ["forwarder", job.forwarder]].filter(([, v]) => !v).map(([k]) => k).concat(Array.isArray(job.classes) ? [] : ["classes"]);
  if (missing.length) return `this run's status.json carries no ${missing.join(", ")}, so the job it ran cannot be read back whole — pass --job <file.json> rather than resume on a guess`;
  const derived = deriveSlug(job);
  if (derived !== slug)
    return `the job rebuilt from this run's status.json derives ${derived}, and the run directory is ${slug} — `
      + "they are different matters, so the rebuild is refused rather than resumed into the wrong run";
  return null;
}

export function reconstructCtx(job, opts) {   // @internal
  const run = resolveRun(job, opts);
  const P = paths(run.runDir);
  // A run that froze no search policy stopped before its first stage (the policy is frozen as the run
  // opens), so it has nothing to repair or --experiment on, and reading it as a clearance could hand a
  // Knockout batch the clearance's framework. (A run from before the policy freeze was read as a clearance
  // here; a run from an earlier build is no longer resumed.)
  if (!existsSync(paths(run.runDir).searchPolicy))
    throw new Error(`run ${run.codename} froze no search policy — it stopped before its first stage, so there is nothing to repair or --experiment on`);
  // A KNOCKOUT run has none of the clearance stages this tooling drives — and letting it through would
  // mint the clearance DEFAULT_FRAMEWORK into a triage-graded run (review 2026-07-17). A knockout redo
  // is a re-enqueue (~$2), not a stage surgery.
  try {
    const sp = JSON.parse(readFileSync(paths(run.runDir).searchPolicy, "utf8"));
    if (sp?.pipeline === "knockout")
      throw new Error(`run ${run.codename} is a KNOCKOUT batch — it has no clearance stages to repair or --experiment; re-enqueue the batch instead`);
  } catch (e) { if (/KNOCKOUT batch/.test(String(e?.message))) throw e; /* a corrupt sidecar: attachSearchPolicy below notes it */ }
  // ctx.job is a SHALLOW COPY: attachSearchPolicy (below) folds the frozen recipe's scope INTO the job
  // (foldRecipeScope mutates job.platforms/classes). The fold is right — it is what the cold path's
  // stages saw — but reconstructCtx was side-effect-free on its argument and stays that way.
  const ctx = { paths: P, job: { ...job }, run, agent: opts.agent ?? config.defaultAgent };
  attachProfile(ctx, job, { write: false });   // WS-B: sidecar-first, never minted into an existing run
  attachFramework(ctx, { write: false });      // doc 50: read the frozen manifest (or resolve in-memory); introspection never mints
  // the exclusion seed is pure and reconstructible — a reconstructed matter-frame must not silently drop it
  ctx.exclusionSeed = applicantMatchesProfile(ctx.profile, job.customer) ? (ctx.profile?.selfExclusionOwners ?? []) : [];
  // axes drive which register-unit files placement/digest/skeptic/synthesis reference. Mirror the cold path
  // (pipeline) exactly: decideAxes("") defaults ALL axes ON, so a missing manifest never silently UNDER-spawns.
  ctx.axes = decideAxes(existsSync(P.variantManifest) ? readFileSync(P.variantManifest, "utf8") : "");
  // …including the cold path's axis-from-plan UNION ( B3), and the reason is now the plainer one:
  // THE FROZEN PLAN IS THE SEARCH AUTHORITY, and what it carries need not match what prose activation
  // would have chosen. `decideAxes` reads the manifest; the plan is what actually ran.
  //
  // The two diverge in both directions and each has a live case. A plan frozen before the guessed
  // owner lane was removed still carries its owner entries on incumbent-class, and a resumed run must
  // execute the plan it froze rather than the axes today's manifest would activate. Going the other
  // way, any future lane that mints entries on an axis the manifest does not announce lands here too.
  //
  // Without the union a stale-repair/--experiment of register-digest/placement would exclude the
  // executed lane from the per-axis unit list and the declared inputs/freshness stamps.
  // Best-effort read — a legacy run without a frozen plan reconstructs exactly as before.
  try {
    const plan = JSON.parse(readFileSync(P.registerPlan, "utf8"));
    for (const a of new Set((plan?.entries ?? []).map((e) => e?.axis).filter(Boolean))) {
      if (!ctx.axes.includes(a)) ctx.axes.push(a);
    }
  } catch { /* no/corrupt frozen plan — prose axes stand, as they always did */ }
  const readJson = (f) => { try { return JSON.parse(readFileSync(join(run.runDir, f), "utf8")); } catch { return null; } };
  const status = readJson("status.json");
  if (readSignoff(status)) ctx.verdict = readSignoff(status);   // `review.signoff`, or `verdict` on a record written before the move
  const pub = readJson(".published");
  if (pub?.url) ctx.publishedUrl = pub.url;
  // ── THE CTX FIELDS THIS USED TO DROP (item) ───────────────────────────────────────────────────
  //
  // Every stage's message() destructures exactly the ctx fields it reads. Diff that set against what was
  // set above and eight run-scoped fields were missing — so a reconstructed dispatch (a stale repair OR
  // an --experiment arm) read `undefined` where the cold pass had data, and the prompt silently lost a
  // block. All eight are REBUILT FROM THE RUN'S OWN FROZEN SIDECARS, never re-decided here: this is an
  // introspection path and it mints nothing (attachSearchPolicy/attachRegisterPlan are called in their
  // read-only postures, and the sidecar writes are skipped).
  //
  // Dispatch-scoped fields are deliberately NOT here — ctx.finding, ctx.openDoubts/openAsks,
  // ctx.failInfo and ctx.lateBind belong to one dispatch inside one loop, not to
  // the run. --experiment resolves those through stage-context.mjs INLINE_CONTEXT and REFUSES rather
  // than dispatching against an undefined.
  //
  // searchPolicy + registerOnly: read by six message builders (synthesis, report-overview, the two
  // register funnels, doubt-closure, narrative-refutation).
  //
  // NON-FATAL, and that is a deliberate call about a PRODUCTION path. attachSearchPolicy throws on
  // three shapes (no frozen sidecar, which this function has already refused above, a corrupt sidecar,
  // a pipeline this build cannot execute) and repairStale calls this function. Before today a repair ran with these
  // fields simply UNSET, so letting a throw out would turn a run this build has always repaired into a
  // run it refuses — a regression dressed as strictness, and the knockout guard eight lines above
  // already tolerates the corrupt-sidecar case explicitly. Adding the field can only improve the
  // prompt; adding a failure mode cannot. So: fall back to the old behaviour, loudly.
  //
  try { attachSearchPolicy(ctx, ctx.job, { write: false }); }
  catch (e) { note(`reconstructCtx: search policy not attachable (${String(e?.message ?? e).slice(0, 140)}) — searchPolicy/registerOnly stay unset, exactly as before this field existed`); }
  // the frozen deterministic plan: feeds skepticDeferralExtra, the register-unit message's dictated
  // entries, and the supplemental lane's excludeTools. Same posture — parseRegisterPlan throws
  // token-first on a corrupt plan and a repair must not start refusing runs over it.
  try { attachRegisterPlan(ctx, { frozenOnly: true }); }
  catch (e) { ctx.registerPlan = null; note(`reconstructCtx: frozen register plan unreadable (${String(e?.message ?? e).slice(0, 140)}) — registerPlan stays null, exactly as before this field existed`); }
  // the requester's explicit checks — owned by common-law half "a", the register funnel and synthesis.
  ctx.intakeAsks = readJson(driverRel("intake-asks.json"))?.asks ?? [];
  // "we do not know who the applicant is" — a late bind on the canonical run cleared it (pipelineInner
  // sets customerUnknown=false when customer-bind.json lands), so the receipt on disk is the authority.
  ctx.customerUnknown = job.customerUnknown === true && !job.customer && !existsSync(P.customerBind);
  // COUNTS, exactly as the cold path carries them (the message builders print a count, never the rows).
  const signals = readJson(driverRel("enforcer-signals.json"));
  if (Array.isArray(signals?.signals)) ctx.enforcerSignals = signals.signals.length;
  else if (Array.isArray(signals)) ctx.enforcerSignals = signals.length;
  const crowd = readJson(driverRel("crowd-context.json"));
  if (crowd) ctx.crowdContext = { slices: (crowd.slices ?? []).length };
  // the dictated grid keys + the spec sidecars the common-law prompts hand the plugin. READ, never
  // re-derived: reconstructCtx does not write, and the --experiment rig re-derives inside its sandbox.
  try { ctx.gridVariants = parseManifestVariants(readFileSync(P.variantManifest, "utf8")); }
  catch { ctx.gridVariants = []; }
  ctx.gridSpecPath = existsSync(P.gridSpec) ? P.gridSpec : null;
  ctx.clHalfTerms = null;
  try {
    // — armed on ALL THREE seat specs, never on the two grid halves alone: arming from a/b would dispatch a
    // seat whose spec does not exist. A split writes all three, so a run missing one did not split, and its
    // routing stays unsplit. (A run split before the meaning seat existed had only a/b, and was named here;
    // a run from an earlier build is no longer resumed.)
    if (GRID_SEATS.every((h) => existsSync(P.gridSpecHalf(h)))) {
      ctx.clHalfTerms = Object.fromEntries(GRID_HALVES.map((h) =>
        [h, JSON.parse(readFileSync(P.gridSpecHalf(h), "utf8")).terms ?? []]));
    }
  } catch { /* a torn half spec — the unsplit routing stands */ }
  return ctx;
}

/**
 * The aim count the cold pass sets before synthesis (`ctx.jxAim`), set on a reconstructed context from the
 * same function and behind the same gate. It lives here rather than in reconstructCtx because the lane
 * module is only ever imported lazily and reconstructCtx is synchronous. Without it a synthesis arm on a run
 * whose pass carried the Chinese-evidence block dispatched without it. Returns the count it set, or null.
 */
export async function attachJxAim(ctx) {   // @internal
  if (!ctx?.searchPolicy?.components?.jxLanes) return null;
  const { jxAimForSynthesis } = await import("./jx-units.mjs");
  const aim = jxAimForSynthesis(ctx.paths.runDir);
  if (aim) ctx.jxAim = aim.count;
  return aim ? aim.count : null;
}

// ── item 15b — the STALE ENTRY POINT ─────────────────────────────────────────────────────────────────
//
// A `stale` failClass parks and the resume re-enters the pipeline FROM THE TOP. That is safe, and it is
// also most of the 34% recovery phase on the evidence run: the resume walks every stage to rediscover,
// one skip at a time, what the blocked pass already knew by name.
//
// So the blocked pass writes the set down (`_driver/delivery-stale.json`, in dependency order) and this
// re-runs exactly it — nothing above it, nothing beside it — then hands back to the caller to re-deliver.
//
// WHAT IT DELIBERATELY DOES NOT DO: decide that the run is now deliverable. It recomputes and returns;
// the delivery gate is re-asked by the ordinary pass, unchanged, and blocks again if anything is still
// stale. An entry point that could also clear the guard would be the guard deciding about itself.
//
// Returns null when there is nothing recorded to repair — the caller then resumes as it always has, so
// this is an accelerator that can never become a requirement.
export async function repairStale(job, opts = {}) {   // @internal
  const ctx = reconstructCtx(job, opts);
  const P = ctx.paths;
  let rec = null;
  try { rec = JSON.parse(readFileSync(paths(P.runDir).deliveryStale, "utf8")); } catch { return null; }
  const labels = Array.isArray(rec?.labels) ? rec.labels : [];
  if (!labels.length) return null;
  await attachJxAim(ctx);   // the aim count the cold pass sets, as --experiment sets it on its rebuilt context
  // RE-DERIVE THE ORDER rather than trusting the file's. The recorded order was right when it was
  // written, and a code change since could have moved an edge — the file names WHAT, the live graph says
  // WHEN. (the file names WHAT, the live graph says WHEN)
  const ordered = dependencyOrder(labels, P, { axes: ctx.axes });
  runLog(P.runDir, { event: "stale-repair-entry", labels: ordered, recorded: rec?.ts ?? null });
  note(`stale-repair entry: recomputing ${ordered.length} recorded stale stage(s) in dependency order — ${ordered.join(" → ")}`);
  const done = [], failed = [];
  for (const label of ordered) {
    const bare = label.replace(/:.*$/, "");
    const axis = label.includes(":") ? label.slice(label.indexOf(":") + 1) : null;
    const runner = UPSTREAM_STALE_REPAIR[label]
      ?? (STAGES[bare] ? (c) => stage(bare, { ...c, ...(axis ? { axis } : {}) }, { force: true, trigger: "stale-repair-entry" }) : null);
    if (!runner) { note(`stale-repair entry: no runner for ${label} — left for the ordinary resume`); failed.push(label); continue; }
    const r = await runner(ctx, {});
    if (r?.ok) done.push(label); else { failed.push(label); note(`stale-repair entry: ${label} failed (${r?.fail}) — the ordinary resume takes it from here`); }
  }
  runLog(P.runDir, { event: "stale-repair-entry-done", repaired: done, failed });
  note(`stale-repair entry: recomputed ${done.length}/${ordered.length}${failed.length ? ` (still open: ${failed.join(", ")})` : ""}`);
  return { ok: failed.length === 0, repaired: done, failed };
}

// --experiment <stage>: re-run ONE stage SANDBOXED — no canonical ARTIFACT is read back or overwritten. The
// stage reads COPIES of its canonical inputs from a shadow dir and writes its output there; a distinct
// `clearance-exp-…` session key never collides with the canonical session AND sorts outside the run's
// provider-usage prefix (experiment Corsearch calls are not billed to the canonical run). Single-model by
// design (the canonical primary unless --model overrides) so the comparison is clean.
//
// IT DOES WRITE INTO THE CANONICAL RUN DIRECTORY, and the older wording here ("left byte-for-byte
// untouched") said otherwise. The shadow lives at `<runDir>/_experiments/<ts>-<tag>` and both outcomes
// append a row to the canonical `_driver/run.jsonl` — `experiment` on a dispatch, `experiment-refused`
// on a manifest gap. Every canonical artifact is safe and that is the guarantee worth having; a run
// directory that must not be written to at all is NOT one of them, so do not read this flag as licence
// to point it at an archive. Corrected 2026-08-27 from a measurement, not from reading the code.
/**
 * — the tool wiring a dispatch resolves, as a plain record.
 *
 * `dispatchLabel` reproduces the ONE label construction every dispatch uses (stageOnce). It is written
 * here rather than imported because stageOnce builds it inline from its own `name`/`ctx.axis`; the test
 * asserts the two agree, so a future edit to either fails rather than drifting the receipt away from
 * the dispatch it claims to describe.
 *
 * Every failure is recorded as a REFUSAL, never as an empty wiring: an arm whose config could not be
 * built and an arm that legitimately holds no tools are opposite facts, and `{groups: []}` for both
 * would be the same absence-read-as-pass the rest of this file spends its comments on.
 */
export const dispatchLabel = (name, axis) => name + (axis ? `:${axis}` : "");   // @internal

export function experimentWiring(name, axis, { sessionKey, agent, runDir } = {}) {   // @internal
  const label = dispatchLabel(name, axis);
  let groups;
  try { groups = experimentToolGroups(label); }
  catch (e) { return { label, groups: null, servers: null, allowedTools: null, refusal: `toolGroupsForStage threw: ${String(e?.message ?? e).slice(0, 160)}` }; }
  if (!groups.length) return { label, groups: [], servers: [], allowedTools: null, refusal: null };
  try {
    const cfg = experimentMcpConfig(groups, { sessionKey, agent, runDir });
    return {
      label, groups,
      // NAMES only. The server entries carry an `env` block, and a receipt that copied it would be a
      // credential store with a filename that says "context".
      servers: cfg ? Object.keys(cfg.mcpServers).sort() : [],
      allowedTools: experimentAllowedTools(groups) || null,
      refusal: null,
    };
  } catch (e) {
    // The register group resolves the ACTIVE PROVIDER, which throws when none is configured. That is a
    // real thing about this arm's environment and it belongs on the arm's record.
    return { label, groups, servers: null, allowedTools: null, refusal: `buildGatherMcpConfig threw: ${String(e?.message ?? e).slice(0, 160)}` };
  }
}

/**
 * The engine that will serve this arm, by name —.
 *
 * NEVER THROWS: a receipt that cannot be written is worse than one naming an unregistered engine, and an
 * unregistered name is itself the honest answer to "what was asked for". An unset CLEAROTRON_AI resolves
 * through selectEngine to the real default rather than being reported as absent.
 */
function experimentEngineName() {
  try { return selectEngine().name ?? null; }
  catch { return String(process.env.CLEAROTRON_AI ?? "").trim().toLowerCase() || null; }
}

export async function runExperiment(job, opts) {   // @internal
  const lock = await acquireSlot({ dir: config.runLockDir, cap: 1024, prefix: "draw" });
  try {
    return await runExperimentInner(job, opts);
  } finally {
    stopServingOwnQuestions(opts.__experimentDir);
    // Best-effort, like the run slot's own release: the lock reaper covers a process that dies here, and
    // a stale draw lock with a dead pid does not refuse a deploy — the guard tests liveness.
    try { releaseSlot(lock); } catch { /* the reaper covers what this misses */ }
  }
}


async function runExperimentInner(job, opts) {
  const name = opts.experiment;
  if (!STAGES[name]) throw new Error(`--experiment: unknown stage "${name}"`);
  // The axis is checked for MEMBERSHIP, not truthiness, and BEFORE reconstructCtx touches the run dir.
  // A typo used to pass: `--axis primary-swep` wrote register-units/primary-swep.md into the shadow dir
  // and silently took the sonnet/adaptive default tier (axisTier's else-arm), so the experiment ran at a
  // tier nobody chose and compared against nothing. REGISTER_AXES was already interpolated into the error
  // text below — it now backs it. Any non-null axis is validated, including on a stage that ignores one,
  // because a mistyped axis on a non-register stage still names the shadow dir and the session key.
  const axis = opts.axis ?? null;
  //
  // REBASE NOTE — (merged first) made this a MEMBERSHIP test against REGISTER_AXES for every
  // stage. That was right for the world as it stood, where a register axis was the only thing `--axis`
  // could name. It is no longer: the axis slot IS the dispatch label's suffix, and production already
  // labels `common-law-half:b` and `report-card:1` — a grid half and a finding ordinal. Rejecting those
  // against REGISTER_AXES would refuse the two arms this issue exists to make work.
  //
  // So the membership test is kept and made PER STAGE: every stage that takes an axis names its own
  // vocabulary, and a stage that takes none still refuses a stray one — the guarantee, unchanged,
  // over a valid set that is now true for each stage rather than true for one of them.
  const vocab = AXIS_VOCABULARY[name] ?? null;
  if (!vocab && axis !== null)
    throw new Error(`--experiment ${name}: --axis "${axis}" is not a register axis, and ${name} takes no axis at all — it would still name the shadow dir and the session key`);
  if (vocab && axis === null)
    throw new Error(vocab.requiredMessage);
  if (vocab && !vocab.accepts(axis))
    throw new Error(`--experiment ${name}: --axis "${axis}" is not ${vocab.what} (${vocab.oneOf})`);
  // A typo here changes WHICH driver-computed blocks the arm carries and nothing would say so — the
  // same silent-degradation shape the RETIRED_FLAGS table at the bottom of this file exists for.
  // `--research replay` answers the arm's research from the run's own answers and sends nothing out
  // (research-answers.mjs). Only a stage that holds the research tool has research to replay.
  if (opts.research != null && !RESEARCH_MODES.includes(opts.research))
    throw new Error(`--research: unknown value "${opts.research}" — one of: ${RESEARCH_MODES.join(", ")}`);
  if (opts.research === "replay" && !experimentToolGroups(name).includes("perplexity"))
    throw new Error(`--experiment ${name} --research replay: ${name} holds no research tool, so there is no research to replay`);
  // The replayed answers sit outside the arm's folder, and only the engine's own fence keeps a stage's commands there.
  // Codex's sandbox bypass builds none, so the writer could read every answer it is about to be replayed.
  if (opts.research === "replay" && experimentEngineName() === "openai-agent" && codexSandboxBypassed())
    throw new Error(`--experiment ${name} --research replay: Codex's sandbox is bypassed (CLEAROTRON_CODEX_SANDBOX_BYPASS=1), so the stage's commands could read the answers the replay answers from — run the arm with the sandbox on, or with --research live`);
  if (opts.dispatchTrigger != null && !DISPATCH_TRIGGERS.includes(opts.dispatchTrigger))
    throw new Error(`--dispatch-trigger: unknown value "${opts.dispatchTrigger}" — it decides which production pass the arm reproduces, so a typo would compose a quietly different prompt. One of: ${DISPATCH_TRIGGERS.join(", ")}`);
  const ctx = reconstructCtx(job, opts);
  await attachJxAim(ctx);   // read off the canonical run, as the cold pass reads it; the file itself is a sandbox edge
  const model = opts.model ?? (axis ? axisTier(axis).model : STAGES[name].model);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const tag = [name, axis, opts.label ? kebab(opts.label) : null].filter(Boolean).join("-");
  const shadowDir = join(ctx.paths.runDir, "_experiments", `${ts}-${tag}`);
  mkdirSync(join(shadowDir, "register-units"), { recursive: true });
  ensureDriverDir(shadowDir);
  // AN ARM OF A RUN ON ITS OWN SEARCH asks its questions into its shadow folder, where its tool server serves: they are
  // answered from here, as the run's are (own-search-questions.mjs), until the experiment ends (runExperiment).
  opts.__experimentDir = shadowDir;
  serveOwnQuestions(shadowDir);
  // Any ctx field holding a PATH is dropped rather than inherited: reconstructCtx resolved them against
  // the canonical run, and a sandbox whose prompt names a canonical path is not a sandbox. The
  // derivations below re-set them against ctx.paths, which here is the shadow dir.
  // A `fresh` arm is a stage's first attempt, which is handed no earlier attempt's research: the copied answers are
  // what the replay answers from, never a hand-off production's first attempt does not get.
  const shadowCtx = { ...ctx, paths: paths(shadowDir), axis, gridSpecPath: null, clHalfTerms: null,
    researchHandOff: (opts.dispatchTrigger ?? "fresh") !== "fresh" };
  const inputOpts = { axes: ctx.axes, axis, registerOnly: ctx.registerOnly, researchHandOff: shadowCtx.researchHandOff, dispatchTrigger: opts.dispatchTrigger ?? "fresh" };
  const manifest = sandboxManifest(name, ctx.paths, inputOpts);
  // ── 1. GATHER — the sandbox manifest, not the freshness list ──────────────────────────────────────
  //
  // The old loop copied `stageInputs()` and `continue`d past anything not on disk, which is two bugs in
  // one line: it modelled a stage as "a prompt over its declared files", and it read an absence as a
  // pass. The manifest is the stage's whole context — declared inputs, what its TOOLS open inside their
  // own processes, what the DRIVER reads to build its prompt blocks, and the transitive inputs of every
  // derivation whose output any of those needs. Directories are copied whole (`_records/` is how
  // band_record serves official records, and the positions projection cannot be derived without it).
  const copyTree = (src, dst) => {
    for (const ent of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, ent.name), d = join(dst, ent.name);
      if (ent.isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d); }
      else if (ent.isFile()) copyFileSync(s, d);
    }
  };
  for (const e of manifest) {
    if (!existsSync(e.path)) continue;   // not on the canonical run — step 3 decides whether that is honest
    const dst = join(shadowDir, e.path.slice(ctx.paths.runDir.length + 1));
    if (e.dir) { mkdirSync(dst, { recursive: true }); copyTree(e.path, dst); }
    else { mkdirSync(dirname(dst), { recursive: true }); copyFileSync(e.path, dst); }
  }
  // ── 2. DERIVE — inside the sandbox, through the pipeline's own functions ──────────────────────────
  //
  // Copying a derived artifact would replay it; running the derivation re-executes its seams. That is
  // the whole reason this is not persist-and-replay: `probeOrder` lives INSIDE band-shape.mjs's
  // derivation functions, so an order-seeded arm that replayed `band-shape.json` would come back
  // byte-identical to its control and report, wrongly, that ordering does not matter.
  //
  // Which derivations run is computed from the manifest — a derivation is replayed because its OUTPUT
  // is in this stage's context, never because the stage was named in a list. Add a derived artifact to
  // the registry and every stage whose context reaches it gets it, with no edit here.
  //
  // EXCEPT WHERE THE RUN STILL HOLDS THE PICTURE THE DISPATCH WAS HANDED (derived-state.mjs). An arm that changes
  // nothing upstream reproduces a pass, and re-deriving from inputs that have grown since hands it a later picture
  // than the pass read. So where the dispatch this arm reproduces recorded its picture, and the run's files are still
  // exactly that picture, the run's own derived files are the arm's. A seeded arm re-derives, as it must. Anything
  // else re-derives as before, and the receipt says the replay is not faithful, and why.
  const recordedPicture = recordedDerivedState(ctx.paths.runDir, name + (axis ? `:${axis}` : ""), opts.dispatchTrigger ?? "fresh");
  const currentPicture = derivedStateOf(name, ctx.paths, inputOpts);
  const changesDerivation = orderProbeSeed() != null;
  const derived = [], pictureReplay = [];
  for (const id of derivationsFor(name, ctx.paths, inputOpts)) {
    const replay = replayOfDerivation(id, recordedPicture, currentPicture, { changesDerivation });
    // A projection goes through its runner as before, which keeps the run's copy and fills only a gap.
    if (replay.how === "kept" && CONTEXT_DERIVATIONS.find((d) => d.id === id)?.projection !== true) {
      for (const w of CONTEXT_DERIVATIONS.find((d) => d.id === id).writes(ctx.paths)) {
        if (!existsSync(w)) continue;
        const dst = join(shadowDir, w.slice(ctx.paths.runDir.length + 1));
        mkdirSync(dirname(dst), { recursive: true }); copyFileSync(w, dst);
      }
      pictureReplay.push(replay);
      continue;
    }
    try { if (DERIVATION_RUNNERS[id](shadowCtx) !== false) derived.push(id); pictureReplay.push(replay); }
    catch (e) {
      note(`--experiment: derivation "${id}" threw in the sandbox (${String(e?.message ?? e).slice(0, 120)})`);
      pictureReplay.push({ ...replay, faithful: false, why: "the derivation failed in the sandbox" });
    }
  }
  // ── 3. REFUSE an incomplete context ───────────────────────────────────────────────────────────────
  //
  // The canonical run is the arbiter. If it holds the artifact, `pipeline()` would have handed it to
  // this stage and a sandbox without it is measuring a pipeline that does not exist — so the dispatch
  // is refused BY NAME rather than run against a quietly thinner context. If the canonical run does not
  // hold it, its absence here is faithful and costs nothing.
  const gaps = sandboxGaps(manifest, ctx.paths.runDir, shadowDir);
  if (gaps.length) {
    runLog(ctx.paths.runDir, { event: "experiment-refused", stage: name + (axis ? `:${axis}` : ""), missing: gaps.map((g) => g.rel) });
    throw new Error(`--experiment ${name}: the sandbox could not reproduce ${gaps.length} thing(s) this stage's context has on the canonical run — refusing to dispatch against an incomplete context:\n` +
      gaps.map((g) => `  · ${g.rel}  [${g.kind}${g.via ? ` via ${g.via}` : ""}]${g.why ? ` — ${g.why}` : ""}`).join("\n"));
  }
  // A REPLAY NEEDS ANSWERS TO REPLAY. Refused by name when the run kept none, rather than dispatched to refuse
  // every question it asks; the marker is the research server's whole switch, and only a sandbox writes it. The
  // answers are copied beside the arm, never into it (research-answers.mjs), and the marker names that copy.
  let replayedAnswers = null;
  if (opts.research === "replay") {
    const kept = driverDir(ctx.paths.runDir, RESEARCH_ANSWERS_FILE);
    replayedAnswers = savedResearchCount(kept);
    if (!replayedAnswers)
      throw new Error(`--experiment ${name} --research replay: this run kept no research answers (_driver/research-answers.jsonl is absent or holds none), so there is nothing to replay — run the arm with --research live`);
    const answersFrom = replayAnswersFile(shadowDir);
    mkdirSync(dirname(answersFrom), { recursive: true });
    copyFileSync(kept, answersFrom);
    atomicWrite(driverDir(shadowDir, RESEARCH_REPLAY_FILE), JSON.stringify({ replayOf: "the run's saved research answers", answers: replayedAnswers, answersFrom }, null, 2) + "\n");
  }
  // ── 4. INLINE context — what no file copy can supply ──────────────────────────────────────────────
  //
  // `report-card` receives its finding as ctx.finding; its declared findings.json exists for staleness,
  // is never opened by the agent, and is therefore not in the sandbox at all. The driver rebuilds the
  // payload from the CANONICAL run — which is what pipelineInner does when it dispatches a card — and
  // REFUSES if a required field cannot be rebuilt, exactly as a missing file would.
  const inlineDecl = INLINE_CONTEXT[name];
  if (inlineDecl) {
    const resolved = INLINE_RESOLVERS[name](ctx, { axis });
    for (const f of inlineDecl.required ?? []) {
      if (resolved[f] == null)
        throw new Error(`--experiment ${name}: this stage receives ctx.${f} INLINE and it could not be rebuilt from ${inlineDecl.from} — pass --axis <ordinal> naming a finding that exists on this run (the production dispatch label is ${name}:<ordinal>)`);
    }
    // EVERY declared field is set, present or not: production hands report-card `caseLawProfile: … ?? null`,
    // so a run with no case-law layer must arrive as null here too, never as an absent key.
    for (const f of inlineDecl.fields) shadowCtx[f] = resolved[f] ?? null;
  }
  // A SYNTHESIS ARM IS HANDED THE LIST OF RECORDS IT MUST ANSWER, exactly as production hands it, or it
  // replays a different stage. The spec file alone reached the sandbox: the list the dispatch prints
  // rides `ctx.findingsSurface`, which only `prepareDeclinationSpec` sets, so every synthesis arm ran
  // with no DECLINATIONS block while the recorder held it to the copied list. Built from the sandbox's
  // own copies, so the canonical run is not touched.
  if (name === "synthesis") prepareDeclinationSpec(shadowCtx, shadowCtx.paths);
  // A REVIEW ARM IS TOLD WHICH FINDINGS TO PROFILE, as production tells it: the run computes the list just before the
  // review is dispatched and sets it on the context, so an arm that did not had no grounded-profiles line at all.
  if (name === "narrative-refutation") shadowCtx.profileSelection = reviewProfileSelection(shadowCtx);
  const sessionKey = `clearance-exp-${ctx.run.slug}-${ctx.run.codename}-${name}${axis ? `-${axis}` : ""}-${ts}`;
  let { text: extra, ids: extraIds } = experimentExtra(shadowCtx, name, opts);

  // — THE CORRECTIVE PASS, on a COLD turn, and it says which pass it reproduced.
  //
  // Production's corrective pass is a followup dispatch on the run's own synthesis key, and its message is
  // these blocks: its first attempt starts fresh, and it never resumes the synthesis session (no engine resumes
  // by key). An arm builds a fresh key in a sandbox, and dispatching on the real run's key was rejected because
  // "canonical run untouched" is the arm's whole contract. So the arm carries the same INPUTS on a cold turn,
  // composed by the same function production uses — reaching the seam, not reproducing production's dispatch.
  // The receipt says `dispatched-cold`, never `dispatched-warm`, so the two cannot be read as one another.
  const P = shadowCtx.paths;
  const correctiveReady = correctiveReadiness({
    preCorrective: existsSync(paths(shadowDir).findingsPreCorrective),
    reviewerVerdict: existsSync(P.seniorEyeReview),
  });
  const whichPass = correctivePassState({ trigger: opts.dispatchTrigger ?? null, ready: correctiveReady.ready });
  let armCorrection = null;
  if (opts.dispatchTrigger === "corrective") {
    if (!correctiveReady.ready) {
      // REFUSED BY NAME, never a fresh pass wearing a corrective label — which is exactly the quietly
      // different prompt the trigger vocabulary refuses a typo for.
      note(correctiveRefusalLine(name, correctiveReady.missing));
      runLog(ctx.paths.runDir, { event: "experiment-refused", stage: name + (axis ? `:${axis}` : ""), reason: "no-corrective-state" });
      return { ok: false, shadowDir, output: null, fail: "no_corrective_state", correctivePass: whichPass };
    }
    const reading = correctionReading(P);
    const blocks = correctionsExtra(P, ctx.depth, ctx.framework, reading);   // depth+framework are RUN-level; only `P` is the sandbox's
    armCorrection = { positions: reading.positions };   // the arm's save may add what production's may
    extra = [extra, blocks].filter(Boolean).join("\n\n");
    extraIds = [...(extraIds ?? []), { id: "corrective-blocks", chars: blocks.length }];
  }
  // ── 5. THE CONTEXT RECEIPT ────────────────────────────────────────────────────────────────────────
  //
  // What this arm was handed, fingerprinted AT DISPATCH. Two reasons it is written rather than inferred:
  // the stage is about to overwrite its own output, so "what went in" is unrecoverable minutes later;
  // and an arm whose context nobody can state is an arm whose result nobody can defend. `compare.mjs`
  // and the byte-equality test both read this rather than racing the stage's write.
  const receipt = {
    ts: new Date().toISOString(), stage: name, axis, label: opts.label ?? null,
    // — THE TIER AND THE ENGINE, never a synthesised vendor id.
    //
    // This recorded `resolveModel(model)`, and `resolveModel` is ENGINE-BLIND: it maps a tier through the
    // Anthropic alias table whichever adapter is about to run. An arm dispatched under
    // `CLEAROTRON_AI=openai-agent` therefore recorded `anthropic/claude-opus-5` while its attempt record
    // said `openai-agent` / a codex model. An A/B between two engines is what --experiment exists for,
    // and both arms' receipts would have said the same thing with nothing looking wrong.
    //
    // The receipt is stamped AT DISPATCH, before the attempt exists, so it cannot know what actually
    // served. It records what it does know — the tier as dispatched, and the engine that will serve it —
    // and invents nothing. The per-attempt `_driver/<stage>.jsonl` stays the attribution to trust for
    // what RAN.
    engine: experimentEngineName(),
    modelTier: model ?? null,
    // — THE RATING AUTHORITY THIS ARM RAN UNDER, on the arm's own record.
    //
    // `whatIfRun` resolves this correctly and returned it in memory only: nothing in the experiment
    // directory named the profile it rated under, so a reader coming to the arm tomorrow could not
    // confirm which framework produced it, and a future regression would be as silent as the one this
    // was opened on. The frozen sidecar is the authority — never a fresh resolve, which is the mid-run
    // drift the freeze exists to forbid.
    //
    // `null` means the run carries no frozen profile (a legacy run), and it is written rather than
    // omitted: absent and "there was none" are different facts and only one of them is a defect.
    ratedUnder: ctx.profile?.profileKey ?? null,
    // WHICH ORDER THE ARM RAN ON (accepted-order.mjs): the job file it was given, the order the run kept, or a
    // rebuild from status that lacks the fields named here. Only a whole order makes a faithful replay; whether a
    // job file is the order, nothing here can say, so `faithful` is null for one.
    order: opts.orderRecovery
      ? { source: opts.orderRecovery.source, unrecovered: opts.orderRecovery.unrecovered, faithful: opts.orderRecovery.unrecovered.length === 0 }
      : { source: "job-file", unrecovered: [], faithful: null },
    dispatchTrigger: opts.dispatchTrigger ?? "fresh",
    // How the arm's research was answered: sent out live, or replayed from the run's own answers.
    research: opts.research === "replay" ? { mode: "replay", answers: replayedAnswers } : { mode: "live" },
    // Whether the arm's message hands on an earlier attempt's research, as a retry's does: never on a `fresh` arm.
    researchHandOff: shadowCtx.researchHandOff,
    // — WHICH PASS THIS ARM REPRODUCED, in a word. null on a non-corrective arm;
    // never "dispatched-warm", which is production's alone.
    correctivePass: whichPass,
    seed: orderProbeSeed(), derived, extraChars: extra ? extra.length : 0,
    // WHETHER THE ARM WAS HANDED THE PICTURE ITS DISPATCH WAS (derived-state.mjs): per derivation, kept or re-derived,
    // and why a re-derived one is not faithful. `faithfulPicture` is false whenever one is not.
    pictureReplay, faithfulPicture: pictureReplay.every((x) => x.faithful === true),
    // corruption 2 — WHICH driver-computed blocks this arm actually carried, by id and size.
    // `extraChars` alone could not distinguish "the stage has no blocks" from "its blocks were never
    // registered and silently vanished": both read as 0. The list names what was built, so a reader
    // comparing an arm to the run it is measured against can see the composition rather than infer it.
    // Presence, not bytes: `refute-registry-check` is a function of the narrative on disk NOW, which a
    // corrective cycle may have rewritten since the canonical dispatch (see its builder).
    extras: extraIds,
    // — WHAT TOOLS THIS ARM HELD.
    //
    // `--experiment common-law-half` arms failed byte-identically with `grid_ledger_missing`, and the
    // reading was that the arm carried no perplexity toolgroup. It does — the label the sandbox
    // dispatches on is built at the one site every dispatch uses, so `toolGroupsForStage` returns
    // ["perplexity"] for an arm exactly as it does in production. But nothing on the record SAID so,
    // and that is the actual defect: at least four different causes present to the driver as the same
    // sentence, "the ledger is absent". No tool in the group. No API key, so the tool answers with an
    // ERROR string the driver never sees. An output_path the tool refuses. A seat that simply did not
    // call it. The validator cannot tell them apart and neither could anyone reading the arm.
    //
    // So the wiring is written down, from the same two functions the gateway dispatches with. NAMES
    // only — never the server `env`, which is how a receipt starts carrying credentials.
    tools: experimentWiring(name, axis, { sessionKey, agent: shadowCtx.agent ?? null, runDir: shadowDir }),
    edges: manifest.filter((e) => existsSync(e.path)).map((e) => {
      const rel = e.path.slice(ctx.paths.runDir.length + 1);
      const inSandbox = join(shadowDir, rel);
      if (e.dir || !existsSync(inSandbox)) return { rel, kind: e.kind, via: e.via ?? null, dir: Boolean(e.dir), sha: null, shaCanonical: null, size: null };
      const meta = fileMeta(inSandbox);
      return { rel, kind: e.kind, via: e.via ?? null, dir: false, size: meta.size,
        // `sha` is the bytes on disk in the sandbox. `shaCanonical` is those bytes with the sandbox's
        // own location rewritten back to the run dir — the fingerprint that answers "is this the same
        // context the canonical run had?". They differ for exactly the artefacts that EMBED a path: a
        // re-derived grid spec names its own `output_path`, which MUST point into the sandbox (that is
        // the plugin writing where it was told to), and comparing raw bytes there would report a
        // divergence that is the sandbox working correctly.
        sha: meta.sha, shaCanonical: canonicalisedSha(inSandbox, shadowDir, ctx.paths.runDir) };
    }),
  };
  try { atomicWrite(paths(shadowDir).experimentContext, JSON.stringify(receipt, null, 2) + "\n"); }
  catch (e) { note(`--experiment: context receipt write failed (${String(e?.message ?? e).slice(0, 80)}) — the arm still runs, its context is just unstated`); }
  // — the same correction on the experiment EVENT: tier and engine, never a
  // vendor-namespaced id this site cannot know.
  runLog(ctx.paths.runDir, { event: "experiment", stage: name + (axis ? `:${axis}` : ""), engine: experimentEngineName(), modelTier: model ?? null, label: opts.label ?? null, shadowDir: basename(shadowDir),
    derived, context: manifest.length, seed: orderProbeSeed() });
  // The order-probe provenance row, on the arm's OWN record and on the same unconditional three-valued
  // terms pipelineInner writes it (`seed: null` = the ordinary production ordering). An arm whose
  // ordering is not on the record is an arm nobody can attribute later, and attribution is the entire
  // point of the probe — experiment runs were the one dispatch path that never wrote it.
  runLog(shadowDir, { event: "order-probe", seed: orderProbeSeed() });
  const r = await stage(name, shadowCtx, { force: true, model, extra, sessionKey, trigger: "experiment", ...(armCorrection ? { correction: armCorrection } : {}) });
  const out = STAGES[name].out ? STAGES[name].out(shadowCtx.paths, axis) : null;

  // — AN ARM THAT PRODUCED NOTHING DOES NOT PRINT OK.
  //
  // This printed OK on an arm whose seat made zero tool calls and wrote nothing, because the sandbox had
  // copied the canonical document in as a declared INPUT under the stage's output name. Every surface a
  // reader would consult agreed and all of them were wrong. The tells exist and none of them is where
  // anyone looks, so they are read here and said in one line BEFORE the exit code.
  const produced = armProduced(readArmSurfaces({
    shadowDir, stage: name, outputPath: out,
    io: {
      readFile: (f) => { try { return readFileSync(f, "utf8"); } catch { return null; } },
      listDir: (d) => { try { return readdirSync(d); } catch { return null; } },
      sha256: (f) => { try { return fileMeta(f).sha; } catch { return null; } },
      driverPath: (base, ...parts) => driverDir(base, ...parts),
    },
  }));
  if (produced.verdict === "produced-nothing") {
    note(producedNothingLine(name, produced.why));
    runLog(ctx.paths.runDir, { event: "experiment-refused", stage: name + (axis ? `:${axis}` : ""), reason: "produced-nothing" });
    return { ok: false, shadowDir, output: out, fail: "produced_nothing" };
  }
  // COULD-NOT-TELL IS SAID OUT LOUD rather than absorbed into the green: an arm nobody could check is not
  // an arm that passed, and the reader deciding whether to trust this one needs to know which it is.
  if (produced.verdict === "could-not-tell") {
    note(`--experiment ${name}: could not verify the seat produced anything — ${produced.why}`);
  }
  // A PLACEMENT ARM IS READ BY ITS FLOORS AND ITS OWNERS' FATES, which a run derives after the pass
  // (deriveFloorDuty, in pipelineInner). Derived here as well, inside the sandbox, so the arm carries the
  // same floor-duty artifact a run would and a replay can be judged on it.
  if (name === "placement-inquiry") deriveFloorDuty(shadowCtx, r, "experiment");
  note(`--experiment ${name} ${r.ok ? "OK" : `FAILED (${r.fail})`} → ${out ?? shadowDir} (canonical run untouched)`);
  return { ok: r.ok, shadowDir, output: out, fail: r.fail };
}

// ---- CLI entrypoint --------------------------------------------------------------------------------------
// node pipeline.mjs --job <file.json> [--agent <id>]                                  cold run
//   …                              --resume <codename> [--from <stage>]               resume / re-run from a point
//   …                              --resume <codename> --experiment <stage> [--model <id>] [--instructions <t>] [--axis <a>] [--label <t>]   sandboxed re-run
// REFUSES what it does not recognise. This used to skip an unknown token silently, which does not
// fail — it runs a DIFFERENT operation than the one that was typed. `--form synthesis` (for `--from`) drops
// the stage and resumes from the top; `--experiement <stage>` (for `--experiment`) drops the SANDBOX and
// mutates the canonical run, which is the exact opposite of what the operator asked for. Both exit 0 having
// done real work. Same failure the RETIRED_FLAGS table below was added for — that table only covers flags
// this CLI deliberately deleted, so every typo, and every flag renamed rather than retired, still degraded.
//
// Every flag here takes a value, so a bare token is never valid: it is either a misspelt flag or a stray
// argument, and both are refused. Shape copied from enqueue.mjs's parseArgs, including the missing-value
// guard this one also lacked (`--from` as the last token used to set fromStage to undefined).
function parseArgv(argv) {
  const o = {};
  const flags = { "--job": "job", "--agent": "agent", "--resume": "codename", "--from": "fromStage",
    "--experiment": "experiment", "--model": "model", "--instructions": "instructions",
    "--label": "label", "--axis": "axis", "--dispatch-trigger": "dispatchTrigger", "--research": "research", "--records": "records" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") { o.help = true; continue; }
    const key = flags[argv[i]];
    if (!key) {
      throw new Error(argv[i].startsWith("-")
        ? `unknown flag ${argv[i]}`
        : `unexpected argument "${argv[i]}" — every flag this CLI takes needs a value, so a bare token is a typo`);
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
    o[key] = v;
  }
  return o;
}

// ---- retired flags ---------------------------------------------------------------------------------
// A deleted flag must REFUSE, not disappear. parseArgv ignores every argument not in its table, so a
// removed switch otherwise degrades SILENTLY into whatever the remaining arguments mean: after `--rerun`
// was deleted, `--resume <codename> --rerun <stage>` parsed as a bare resume — many stages, real model
// spend, a mutated live run dir, no error and no clue. Muscle memory is the whole risk, so every flag this
// CLI retires keeps an entry here naming what to reach for instead. A table rather than an `if` per flag:
// the next removal needs somewhere to go, and one hand-written guard per retirement is the species that
// rots. Retire, don't delete the entry — an operator's habit outlives the release that broke it.
const RETIRED_FLAGS = {
  "--rerun": "re-running one stage in place strands every downstream artifact derived from the output it " +
    "replaces. Use --from <stage> (re-runs stage-to-end, so the tail re-derives) or --experiment <stage> " +
    "(sandboxed — the canonical run is left byte-for-byte untouched).",
};

// The refusal for the first retired flag in argv, or null. Pure: the CLI block prints it and exits 2.
export function retiredFlagRefusal(argv) {   // @internal
  for (const arg of argv) if (Object.hasOwn(RETIRED_FLAGS, arg)) return `error: ${arg} was deleted — ${RETIRED_FLAGS[arg]}`;
  return null;
}

// ---- retired environment variables -----------------------------------------------------------------
// The same principle as RETIRED_FLAGS, one notch softer, and the difference is deliberate. A retired
// FLAG is typed by a person at a prompt who is standing there to read the refusal. A retired ENV VAR
// sits in an EnvironmentFile that predates the retirement, and refusing on it turns a stale line in a
// file nobody has opened for months into a failure to run at all — for a variable that, being dead,
// changes nothing. These three gated search-level ADMISSION until 2026-07-27; the docs that told
// operators to export them are deleted in this change, but the env files those recipes were copied into
// are outside this repo and cannot be read from here, so we must assume they still carry the lines.
// WARN, therefore, and name the file to edit.
//
// stderr, never stdout: the ops-MCP speaks JSON-RPC over stdio and a stray stdout line corrupts it.
// Called from the CLI block only, for the same reason — the runner and the services import this module.
// EVERY ENTRY CARRIES ITS OWN DATE. It used to be `{name: why}` with "RETIRED 2026-07-27" written into
// the warning string, which was true of all three entries and would have become false of the fourth —
// a line that dates every retirement to the first one is worse than a line with no date at all.
const RETIRED_ENV = {
  CLEAROTRON_KNOCKOUT_MODE: ["2026-07-27", "knockout availability is a property of the BUILD and the wired provider (search-policy.mjs BUILT)"], CLEAROTRON_KNOCKOUT_RECORD_CAP: ["2026-11-05", "a knockout reads the lists its reading step selects, in full; there is no record cap"],
  CLEAROTRON_JX_LANES: ["2026-07-27", "the jx lane decision is frozen into the run's search policy"],
  // The per-language off switch: no deployment set it, and a lane in the frozen lane decision always runs.
  CLEAROTRON_NATIVE_LANGUAGE_ZH: ["2026-11-11", "a native-language lane runs wherever the run's frozen lane decision carries it; there is no per-language off switch"],
  CLEAROTRON_NATIVE_LANGUAGE_JA: ["2026-11-11", "a native-language lane runs wherever the run's frozen lane decision carries it; there is no per-language off switch"],
  CLEAROTRON_NATIVE_LANGUAGE_KO: ["2026-11-11", "a native-language lane runs wherever the run's frozen lane decision carries it; there is no per-language off switch"],
  CLEAROTRON_RECIPES_MODE: ["2026-07-27", "a saved search is honoured wherever it resolves"],

  // ── ─────────────────────────────────────────────────────────────────────────────────────
  // THE DELIVERY ONE IS THE REASON THIS TABLE GREW, and it is the only entry here that a deployment
  // could have been relying on. A box carrying `=stage` believed its requester-facing events were
  // being sent for it. They are packets now, and an integrator has to consume them — so an operator
  // who upgrades and reads nothing would find out from a client who was never told their search
  // finished. ONE SPELLING IS LISTED AND IT COVERS BOTH, which is a property of the alias layer rather
  // than an omission: shared/env-aliases.mjs populates this name from the current one before anything
  // reads either, so an operator on either spelling is warned. Keyed on the old name because
  // forbids this file from learning a new one — the point of translating at the read point is that the
  // conversion lane never has to change.
  CLEAROTRON_DELIVERY: ["2026-08-20", "there is ONE delivery behaviour and it is not a setting: every requester-facing event is a self-contained outbox packet (docs/DELIVERY.md). If this was set to `stage`, nothing is sending your notices — wire an integrator against the outbox"],

  // The rest were read only by code deleted with the gateway exec, so a box that sets one loses
  // nothing — but a tuned value that silently stops applying is the same class of quiet as the
  // delivery row, one size down.
  CLEAROTRON_TURN_CAP: ["2026-08-20", "the turn cap fenced an agent gateway's command lanes; engines run off-gateway and take no lane. Run parallelism is CLEAROTRON_MAX_CONCURRENT_RUNS x CLEAROTRON_GATHER_CONCURRENCY"],
  CLEAROTRON_TURN_LOCK_POLL_MS: ["2026-08-20", "poll interval of the turn cap above"],
  CLEAROTRON_EXEC_MAX_BUFFER: ["2026-08-20", "output ceiling of the gateway exec; the engine's own ceiling is CLEAROTRON_ENGINE_MAX_BUFFER and is unchanged"],
  CLEAROTRON_EXEC_SIGKILL_GRACE_MS: ["2026-08-20", "SIGTERM-to-SIGKILL grace of the gateway exec; the engine's own is CLEAROTRON_KILL_ESCALATE_MS and is unchanged"],
  CLEAROTRON_PREFLIGHT_TIMEOUT_MS: ["2026-08-20", "wall on a gateway agent-listing preflight that no longer runs — nothing is asked to be reachable before a job is claimed"],
  CLEAROTRON_PREFLIGHT_FAIL_DELAY_MS: ["2026-08-20", "the hold after that preflight failed"],

  // Both switched off parts of the recall store, which is gone: no run reads or writes remembered
  // conflicts any more, so a box that set either to 0 loses nothing and one that left them on gains nothing.
  CLEAROTRON_RECALL_PROBES: ["2026-09-24", "the feature was removed"],
  CLEAROTRON_RECALL_TRIPWIRE: ["2026-09-24", "the feature was removed"],

  // Set in no environment file on any box when it was retired. The knockout's web search now runs one
  // pinned setting, so an old line stays harmless and says so.
  CLEAROTRON_KNOCKOUT_PRESET: ["2026-09-25", "the knockout's web search settings are fixed in the build"],
};

/** One warning line per retired variable still set in `env`. Pure; [] when the environment is clean. */
export function retiredEnvWarnings(env = process.env) {
  return Object.entries(RETIRED_ENV)
    .filter(([name]) => env[name] != null && env[name] !== "")
    .map(([name, [when, why]]) => `warning: ${name} is set but was RETIRED ${when} and does nothing — ${why}. Delete the line from your environment file.`);
}

// ----: no non-clean exit leaves the reader without the command that picks the run back up ---------
// The mechanisms to continue a run are all here already — idempotent resume skips every stage whose output
// still validates. What was missing is the one fact a person needs to use them: `--resume` takes a
// CODENAME, and at three of the four bad terminals nothing printed it. So a failed run ended with a stage
// and a reason and no way forward, and a laptop user's only option was a cold re-run of a multi-hour,
// multi-tens-of-dollars job. On the VM that gap is invisible because systemd re-invokes the runner and the
// run resumes itself; the further a deployment is from systemd, the worse the silence.
//
// Pure and exported so every branch is testable with no run, no run dir and no spend.
//
// THE PRODUCT'S OWN VERB, in the form that reaches this install from any directory, and an ABSOLUTE job path:
// this line is read hours later, possibly from a different directory, and a relative path that silently
// resolves somewhere else would be a worse answer than no line at all.
export function resumeCommand({ jobPath, codename, agent = null, command = reachableCommand }) {   // @internal
  // THE IDENTITY IS THE CODENAME, NOT THE JOB PATH, and requiring both is what made this print nothing
  // on the failures that most needed it. A resume rebuilds the job from the run's own status when no
  // `--job` is given, so a command without one is valid — and it is the only valid one by the time a
  // failure has made a resume necessary, because the queue entry carrying the job is long consumed.
  // Requiring a path here meant every such failure was told "nothing to resume", which was false.
  if (!codename) return null;
  return `${command("run")}${jobPath ? ` --job ${jobPath}` : ""}${agent ? ` --agent ${agent}` : ""} --resume ${codename}`;
}

// The stderr lines a non-clean exit owes its reader, as an array (empty = say nothing further).
//
// Three cases deliberately print NO command, because a command there would be worse than silence:
//   · CANCELLED — someone pressed Stop. The whole cancel terminal exists so a stopped run is never told it
//     broke and never comes back through a resume path (the runner's own scan skips `.cancelled`), and
//     handing them a resume line would invite them to undo their own decision by accident.
//   · `err.noResume` — the resume-refused-because-delivered throw. The identity exists, so a naive rule
//     would print a command that lands straight back on the same refusal.
//   · `--experiment` — a sandbox that never touches the canonical run. Offering to re-drive the canonical
//     run is not what the operator asked for, and runExperiment has no `__runRef` to name anyway.
//
// And where NO identity exists yet (the door preflights: tier sanity, engine binary, register credential,
// an unresolvable resume codename), the honest line says there is nothing to resume rather than printing a
// command with a hole in it.
export function resumeAdvice({ result = null, error = null, signal = null, jobPath = null, agent = null, codename = null, experiment = false, noResume = false, command = reachableCommand } = {}) {   // @internal
  if (result?.ok) return [];
  if (experiment) return [];
  if (noResume || error?.noResume) return [];
  if (result?.cancelled) return [`stopped at ${result.failedStage ?? "an early stage"} because you asked — terminal. Nothing was delivered and nothing resumes; start a new run when you want one.`];
  const cmd = resumeCommand({ jobPath, codename, agent, command });
  // No identity yet: the door preflights and the unresolvable-codename guard all fire before a run dir
  // exists, and a signal can arrive there too. Say there is nothing to resume rather than print a command
  // with a hole in it — and do not point at an "error above" when a signal is what happened.
  if (!cmd) return [signal
    ? `nothing to resume: ${signal} arrived before the run had an identity, so no work was started and none was lost.`
    : "nothing to resume: this stopped before the run had an identity, so no work was started and none was lost. Fix the error above and run the same command again."];
  // A park is NOT a failure, and the difference is the reader's whole decision: wait, or act. Both park
  // kinds resume themselves wherever something re-invokes the runner — the systemd units on a server, or
  // `clearotron run-queue --watch` on a machine that has none — so the line says that first and offers the manual
  // command second. On a laptop with neither, the manual command is the only path, which is exactly why
  // it is printed rather than left to be looked up.
  const watching = `${command("run-queue")} --watch`;
  const lines = [];
  if (result?.postponed && result.recovery) {
    lines.push(`parked for automatic recovery${result.resetsAt ? ` until ${result.resetsAt}` : ""} — nothing failed terminally and every finished stage is kept.`);
    lines.push(`it resumes ITSELF once that window passes, if something on this machine is watching (\`${watching}\`, or the systemd units on a server). Otherwise pick it up by hand:`);
  } else if (result?.postponed) {
    lines.push(`parked on a provider rate limit at ${result.fromStage ?? "the last stage"}${result.resetsAt ? ` until ${result.resetsAt}` : ""} — nothing failed and every finished stage is kept.`);
    lines.push(`waiting on: ${PARK_WAITING_ON}`);
    lines.push(`resolved by: ${PARK_RESOLVED_BY}`);
    lines.push(`it resumes ITSELF once the window passes, if something on this machine is watching (\`${watching}\`, or the systemd units on a server). Otherwise pick it up by hand:`);
  } else if (signal) {
    lines.push(`cut by ${signal} — the run dir and every finished stage are intact. Resume with:`);
  } else {
    lines.push(`resume this run — completed stages are skipped, only what is missing or invalid re-runs:`);
  }
  lines.push(`  ${cmd}`);
  return lines;
}

// What a reader who typed `clearotron run` is told; the developer usage below stays for `node driver/pipeline.mjs`.
const RUN_USAGE = "usage: clearotron run --job <file.json> — runs one clearance from a job file. An example job is examples/job.euipo.json.";
const USAGE = "usage: node pipeline.mjs --job <file.json> [--agent <id>]\n" +
  "       [--resume <codename> [--from <stage>] [--records live|replay]]\n" +
  "       [--resume <codename> --experiment <stage> [--model <id>] [--instructions <text>] [--axis <axis>] [--label <text>] [--dispatch-trigger <t>] [--research live|replay]]\n" +
  "  --instructions appends to a stage's prompt (a light tweak); a full prompt rewrite means editing the stage's skill file.\n" +
  "  --axis also names the ORDINAL for report-card (its dispatch label is report-card:<ordinal>).\n" +
  "  --dispatch-trigger picks WHICH production pass the arm reproduces (default \"fresh\"); a corrective pass carries prompt blocks a fresh one does not.";

// ── — THE CLI RUNS FROM A DETACHED ASYNC CALL, NOT A TOP-LEVEL AWAIT ────────────────────────
//
// It used to be `if (isEntrypoint(…)) { … await pipeline(job, opts) … }`, which is a top-level await: the
// whole run happened INSIDE this module's evaluation, so `pipeline.mjs` never finished evaluating while a
// run was in flight. That deadlocked every knockout run, and the deadlock was silent.
//
//   pipeline.mjs is still evaluating (the run is inside its top-level await)
//     → the run reaches the knockout branch
//       → await import("./pipeline-knockout.mjs")           the lazy import that "breaks the static cycle"
//         → that module statically imports pipeline.mjs
//           → whose evaluation cannot complete until the run returns
//             → which cannot happen until the import settles
//
// Node then has an empty event loop and a top-level await that will never settle, so it exits 13 with no
// error, no stack and no diagnostic — because nothing threw. A deadlock is not a failure any catch can
// see. `pipeline()`'s `finally { releaseSlot(slot) }` never ran either, which is why a dead pid was left
// holding slot-0, and `knockoutInner`'s identity seed was never reached, which is why the run dir
// had no status.json and read as in-flight forever.
//
// WRAPPING IS THE FIX, AND MOVING THE FIVE SHARED SYMBOLS WAS NOT. Moving them removes one back-edge; this
// removes the CLASS — module evaluation now completes before the run starts, so ANY module lazily imported
// during a run may import this one without deadlocking. The next lazy import added to a stage would otherwise
// have rebuilt the same trap, silently. The five have since moved to run-outcome.mjs anyway, for load weight
// and testability, and the Knockout pipeline no longer imports this file; the wrap still guards the class.
//
// `.catch` mirrors the inner catch below rather than relying on an unhandled rejection: a throw before the
// try block (argument parsing, a retired-flag refusal) would otherwise exit through Node's default handler
// with a different code than every other failure on this path.
if (isEntrypoint(import.meta.url)) void (async () => {
  // BEFORE anything else, including the usage check: a retired flag is refused on its own terms, so the
  // operator reads why it is gone rather than a usage block that simply no longer mentions it.
  const retired = retiredFlagRefusal(process.argv.slice(2));
  if (retired) { console.error(retired); process.exit(2); }
  for (const w of retiredEnvWarnings()) console.error(w);
  // The refusal names the token and prints USAGE, so the operator can see what they meant to type. It fires
  // AFTER retiredFlagRefusal on purpose: a deleted flag keeps its specific "use --from / --experiment"
  // message instead of collapsing into a generic "unknown flag --rerun".
  let a;
  try { a = parseArgv(process.argv.slice(2)); }
  catch (e) { console.error(`error: ${e.message}`); console.error(USAGE); process.exit(2); }
  const usage = process.env.CLEAROTRON_INVOKED_AS ? RUN_USAGE : USAGE;   // reached through `clearotron run`, or directly
  // Reached through `clearotron run`, the help keeps the dispatcher's spend line, which it printed before this
  // program had a --help of its own.
  if (a.help) {
    console.log(usage);
    if (process.env.CLEAROTRON_INVOKED_AS) console.log("THIS SPENDS: hours of model time and real register calls. See INSTALL.md §5 and §6.");
    process.exit(0);
  }
  if (!a.job && !a.codename) { console.error(usage); process.exit(2); }   // --resume alone rebuilds the job below
  // composition guards
  if (a.fromStage && !a.codename) { console.error("error: --from requires --resume <codename>"); process.exit(2); }
  if (a.experiment && !a.codename) { console.error("error: --experiment requires --resume <codename>"); process.exit(2); }
  if ((a.model || a.instructions || a.dispatchTrigger) && !a.experiment) { console.error("error: --model/--instructions/--dispatch-trigger apply only to --experiment"); process.exit(2); }
  if (a.records && (!a.codename || a.experiment)) { console.error("error: --records applies only to --resume <codename>, without --experiment"); process.exit(2); }

  // — SAY IT BEFORE THE RUN, NOT AFTER IT. `config.poolRoot` now refuses when CLEAROTRON_REPORTS_DIR is
  // unset, but the first thing that touches it is the publish step, so a first run on an unconfigured
  // machine would spend hours of engine time and then refuse over a variable that was already missing
  // before the first token. This costs one property read and turns that into a refusal at the prompt.
  //
  // IN THE CLI GATE ONLY, and that is the whole of its scope. `pipeline()` is imported by runner.mjs and
  // by the tests, and those callers reach publish through their own entry points — a courtesy for the
  // person typing a command must not become a new precondition for the ones that are not.
  try { void config.poolRoot; }
  catch (e) { console.error(`error: ${e.message}`); process.exit(2); }

  // ── A RUN IS FINISHED ON THE BUILD IT STARTED ON, FROM THE COMMAND LINE TOO ───────────────────────────
  //
  // The runner's resumes refuse a run that started on another build (one-build-per-run.mjs). `--resume`, with
  // `--from` or `--experiment` or neither, is the same door typed by a person, and it carried a run from an
  // earlier version onto this one. Each branch below asks it of the run folder as soon as it has found one,
  // before the order is rebuilt or anything is written, and refuses in the runner's words. With no run folder
  // there is nothing to ask: the resume itself refuses that, by name. `pipeline()` stays unchecked as a
  // library, because the bench resumes saved copies on new code to measure what a change does.
  const refuseAcrossBuilds = (runDir) => {
    const refused = crossBuildResumeRefusal(runDir);
    if (refused) { console.error(`error: ${refused}`); process.exit(2); }
  };

  // — reading the job file used to sit OUTSIDE the try below, so a path typo or a stray comma
  // exited on a raw V8 stack trace: a non-clean exit with no honest message, and the one shape of
  // mistake a first-time reader is likeliest to make. Kept guarded here through the rebase — the
  // pool check above is a separate refusal and must not swallow this one.
  let job, orderRecovery = null;
  if (!a.job && a.codename) {
    // ── RESUMING A RUN WHOSE JOB FILE THE BOX NO LONGER HAS ───────────────────────────────────────
    //
    // The queue entry carrying the job is consumed when the run starts, so by the time a failure makes
    // a resume necessary the input needed to perform it is already gone — and the exit advice printed
    // on that failure composes a command naming a path that is not there. Rebuilt from the run's own
    // status.json, which the engine wrote FROM the job it ran, and refused unless the rebuild derives
    // this run's own slug.
    //
    // The scan is what makes it possible at all: finding a run by codename needs its slug, and the
    // slug comes from the job, which is the thing being rebuilt. So the studio root's matters are
    // scanned for the one holding a run dir with this codename. `findRunDirFor` decides what counts as
    // that leaf, imported rather than re-spelled here — a second private copy of the leaf rule is how
    // a reclaim and a resume come to disagree about which directory is the run. The rule lives in
    // run-dir-lookup.mjs, which imports neither this module nor runner.mjs, so both import it from
    // there and neither imports the other.
    const studioRoot = a.agent ? config.studioRootForAgent(a.agent) : config.studioRoot;
    const archiveRoot = a.agent ? config.archiveRootForAgent(a.agent) : config.archiveRoot;
    let found = null;
    try {
      for (const slug of readdirSync(studioRoot)) {
        const hit = findRunDirFor({ codename: a.codename, slug, studioRoot, archiveRoot });
        if (hit) { found = { ...hit, slug }; break; }
      }
    } catch (e) { console.error(`error: cannot read the studio root ${studioRoot} — ${e.message}`); process.exit(2); }
    if (!found) {
      console.error(`error: no run directory for --resume ${a.codename} under ${studioRoot}`);
      console.error("       pass --job <file.json> if the run lives somewhere this cannot see.");
      process.exit(2);
    }
    refuseAcrossBuilds(found.dir);
    let status = null;
    try { status = JSON.parse(readFileSync(join(found.dir, "status.json"), "utf8")); }
    catch (e) { console.error(`error: cannot read ${join(found.dir, "status.json")} — ${e.message}`); process.exit(2); }
    const scope = readInstructedScope(found.dir);
    // The account and the product from the run's frozen files, and the roster that says whether the account
    // can ride on this install (jobFromStatus says why it may not).
    let roster = null;
    try { roster = loadProfiles(); } catch { /* the run context reads the roster again, and refuses with its reason */ }
    const frozen = { profile: safeReadJson(paths(found.dir).profile), searchPolicy: safeReadJson(paths(found.dir).searchPolicy), roster };
    // The order the run kept at intake, else an older run's retained queue entry, else the rebuild from status
    // (accepted-order.mjs says which, and why a queue entry was refused).
    orderRecovery = rebuildRunOrder({ runDir: found.dir, status, scope, profile: frozen.profile,
      queueDir: config.queueDirForAgent(a.agent || config.defaultAgent), scopeOf: instructedScopeOf,
      fromStatus: () => jobFromStatus(status, scope, frozen), write: !a.experiment });
    job = orderRecovery.job;
    const refusal = resumeJobRefusal(job, found.slug);
    if (refusal) { console.error(`error: ${refusal}`); process.exit(2); }
    const fromScope = [job.marks && "marks", job.goods && "goods", job.customer && "applicant", job.jurisdictions && "territories"].filter(Boolean);
    if (orderRecovery.source !== "status")
      console.error(`[pipeline] --job not given; the job for ${a.codename} is the order ${orderRecovery.source === "accepted-order"
        ? "the run kept when it was accepted" : "in the run's retained queue entry, now kept with the run"} (slug ${found.slug} confirmed)`);
    else console.error(`[pipeline] --job not given; rebuilt the job for ${a.codename} from ${join(found.dir, "status.json")} (slug ${found.slug} confirmed)`
      + (!scope ? "; the run holds no readable instructed scope, so its territories fall back to the account's defaults"
        : fromScope.length ? `; the order's ${fromScope.join(", ")} from its instructed scope` : "")
      + (job.profileKey ? "; its account from the frozen profile"
        : frozen.profile?.profileKey ? "; its account is not on this install's roster, so the job names none and the frozen profile governs" : "")
      + (job.product ? "; its product from the frozen search policy" : "")
      + `; the run holds no copy of its order${orderRecovery.conflict ? ` (its queue entry was refused: ${orderRecovery.conflict})` : ""}, so the job lacks what only the order held: ${orderRecovery.unrecovered.join(", ")}`);
  } else {
    try { job = JSON.parse(readFileSync(a.job, "utf8")); }
    catch (e) { console.error(`error: cannot read job file ${a.job} — ${e.message}`); process.exit(2); }
    if (a.codename) {
      // The live run the resume will open, by the lookup the resume itself makes.
      const studioRoot = a.agent ? config.studioRootForAgent(a.agent) : config.studioRoot;
      const date = findRunDate(job, a.codename, studioRoot);
      if (date) refuseAcrossBuilds(join(studioRoot, deriveSlug(job), `${date}-${a.codename}`));
    }
  }
  // Manual runs: if --agent is given, root the run-dir in that agent's workspace too (mirrors the runner).
  const base = a.agent
    ? { agent: a.agent, studioRoot: config.studioRootForAgent(a.agent), archiveRoot: config.archiveRootForAgent(a.agent) }
    : {};
  // — the opts object is HOISTED so the exits below can read the identity out of it. pipelineInner
  // hangs `__runRef` on the caller's own opts the moment the run context is built, which is how pipeline()'s
  // rate-limit catch already finds the run to postpone; the same hook lets a THROWN exit name the run.
  const opts = a.experiment
    ? { ...base, codename: a.codename, experiment: a.experiment, model: a.model, instructions: a.instructions, axis: a.axis, label: a.label, dispatchTrigger: a.dispatchTrigger, research: a.research, orderRecovery }
    : { ...base, codename: a.codename, fromStage: a.fromStage, ...(a.job ? { explicitJob: true } : { jobRebuiltFromStatus: true }), records: a.records };
  // `jobPath` is null on a rebuilt resume, so the advice composes a command that does not name a file
  // the box does not have — which is the whole defect this path exists to close, and printing it again
  // in the exit advice would reintroduce it one layer along.
  const advise = (o) => { for (const line of resumeAdvice({ jobPath: a.job ? resolve(a.job) : null, agent: a.agent ?? null, experiment: Boolean(a.experiment), ...o })) console.error(line); };

  // ── the laptop case: a closed lid, a shutdown, a ^C ────────────────────────────────────────────────
  // Until now this CLI had NO signal handler: node's default die-now killed the process mid-stage, the run
  // dir kept saying "running" with no process behind it, and the terminal printed nothing at all — the
  // worst of the exits, and on a laptop the most common one. The handler does not try to finish the work
  // (that grace-window machinery is the runner's, and importing it here would stack listeners on every
  // in-process test that imports this module): it records WHY the run stopped and prints the way back in.
  //
  // `.parked` mirrors what the runner writes when a stop cuts a run in flight — deliberately NON-BLOCKING
  // (the resume guard above clears it), and deliberately NOT `.postponed`: a park sentinel with a resume
  // payload is a standing instruction to a watcher to re-run this automatically, and a person who pressed
  // ^C has not asked for that. They get the command instead.
  //
  // Mainline only, exactly like the runner's — this whole block runs only when pipeline.mjs IS the entry.
  let signalled = false;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      if (signalled) process.exit(sig === "SIGINT" ? 130 : 143);
      signalled = true;
      const run = opts.__runRef ?? null;
      // A signal can land in the window between the delivery commit and the process exiting — the
      // `.delivered` sentinel and `_driver/delivery.json` are written, and rollupStatus still has work to
      // do. Parking THERE would stamp "parked-for-human" onto a run that succeeded, which is the zombie
      // face A5 exists to end, and the resume line would name a run the resume guard refuses outright.
      // Same two markers the resume guard consults, checked inline rather than imported.
      const delivered = Boolean(run?.runDir) &&
        (existsSync(join(run.runDir, ".delivered")) || existsSync(paths(run.runDir).delivery));
      if (run?.runDir && !delivered) {
        try {
          writeFileSync(join(run.runDir, ".parked"), JSON.stringify({ kind: "cli-signal", signal: sig, codename: run.codename, agent: opts.agent ?? config.defaultAgent, ts: new Date().toISOString() }, null, 2) + "\n");
          writeRunStatus(null, { state: "parked-for-human", parkedKind: "cli-signal",
            reason: `the manual run was stopped (${sig}) with this run in flight — resume it with --resume ${run.codename}` }, run.runDir);
          runLog(run.runDir, { event: "parked-for-human", kind: "cli-signal", signal: sig });
        } catch { /* best-effort: the printed command below is the durable handoff, not this */ }
      }
      console.error(`\n${sig} — stopping.`);
      if (delivered) console.error(`${run.codename} had already delivered — nothing was interrupted and nothing needs resuming.`);
      advise({ signal: sig, codename: run?.codename ?? null, noResume: delivered });
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }

  // ── part 2 — NO DEATH PATH LEAVES A RUN READABLE AS IN-FLIGHT ─────────────────────────────
  //
  // The wrap above removes the deadlock that was found. This is the net for the ones that are not: any
  // await that never settles drains the event loop, and Node exits 13 having run no catch and no finally.
  // `beforeExit` DOES still fire there — measured — so it is the last place anything can speak.
  //
  // It writes a TERMINAL status only if the run left none. A run that already recorded its own outcome is
  // never overwritten: this speaks for runs that could not, and silence about a completed run would be a
  // worse lie than the one it is fixing. Everything here is synchronous because a handler at this point
  // gets no further turn of the loop.
  let settled = false;
  process.on("beforeExit", () => {
    if (settled) return;
    settled = true;                                   // never twice, whatever else drains
    const dir = opts.__runRef?.runDir ?? null;
    const codename = opts.__runRef?.codename ?? null;
    const why = "the run stopped without settling — an internal wait never completed. This is a defect in "
      + "the product, not in the job: no stage reported a failure and nothing threw.";
    console.error(`\n=== RUN DID NOT SETTLE${codename ? ` (${codename})` : ""} ===\n${why}`);
    try {
      if (dir && !existsSync(join(dir, "status.json"))) {
        writeFileSync(join(dir, "status.json"), `${JSON.stringify({
          schema: 1, state: "failed", codename, failedStage: "unsettled",
          reason: why, updatedAt: new Date().toISOString(),
        }, null, 2)}\n`);
        console.error(`a terminal status was written to ${join(dir, "status.json")} so this run does not read as still running.`);
      }
    } catch (e) { console.error(`could not write a terminal status: ${e.message}`); }
    // The slot's own `finally` never ran either, so a dead pid would hold it until something reaped it.
    try { if (liveRunSlot) releaseSlot(liveRunSlot); } catch { /* best-effort: the lock reaper covers what this misses */ }
    process.exitCode = 1;
  });

  try {
    // A NEW RUN ON AN INSTALL THAT CANNOT SEARCH YET is refused in doctor's words, before the doors ask for a
    // program nobody chose (driver/run-requirements.mjs, commandLineRefusal). A resume keeps the engine it recorded.
    if (!a.codename && !a.experiment) {
      const notYet = commandLineRefusal(process.env, await runTables(), reachableCommand("install"));
      if (notYet) throw new Error(notYet);
    }
    const res = a.experiment ? await runExperiment(job, opts) : await pipeline(job, opts);
    settled = true;
    if (!res.ok) advise({ result: res, codename: res.codename ?? opts.__runRef?.codename ?? null });
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    settled = true;
    console.error(`error: ${e.message}`);
    // No `a.codename` fallback: the throws that fire BEFORE the run context exists include the one for a
    // codename with no live run dir, and echoing that same codename back would be a command already known
    // to fail. `__runRef` is present only once there is a real run to resume.
    advise({ error: e, codename: opts.__runRef?.codename ?? null });
    process.exit(2);
  }
})().catch((e) => { console.error(`error: ${e?.message ?? e}`); process.exit(2); });

/**
 * The instructed scope this run writes, or null to keep the one already on disk. A resume that rebuilt its
 * job from status.json holds what the run kept of the order, not the order: its identity, and what
 * `jobFromStatus` reads back from this same scope and the frozen files. Written from it, the scope could
 * only lose what that reading leaves out, and every later reader of the scope would see a narrower matter
 * than was ordered. Such a resume keeps the scope the run started with. A job read from a file, or a run
 * with no scope yet, writes as before. PURE.
 */
export function instructedScopeToWrite(job, { jobRebuiltFromStatus = false, scopeOnDisk = false } = {}) {   // @internal
  return keepsInstructedScope({ jobRebuiltFromStatus, scopeOnDisk }) ? null : instructedScopeOf(job);
}

// Hoisted, so placed last: an import at the top would move every line citation into this file.
import { commandLineRefusal } from "./run-requirements.mjs";
import { runTables } from "./order-tables.mjs";
import { writeStatedFacts } from "./stated-facts.mjs";
