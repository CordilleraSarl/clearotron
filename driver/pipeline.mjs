// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// pipeline.mjs — the deterministic driver: sequences every clearance-search stage as a blocking engine
// turn, joins the fan-out in code (the fan-in barrier), gates on the refutation
// verdict, and never parks (there is no LLM continuation decision anywhere). CLI: `node pipeline.mjs --job <file.json>`.

import { writePark } from "./run-park.mjs";
import { CLEARANCE_ENDING } from "./run-failed.mjs";
import { runShell } from "./run-shell.mjs";
import { deliveryEndState } from "./run-delivered.mjs";
import { StageFailure, buildFailurePacket, isDesignedRefusal, stageWallFields, terminalReasonFields } from "./run-outcome.mjs";
import { correctionReading, correctionRows, flagOrdinals, recordCorrectionsBasis, repairUnnamedRemovals, rollbackCorrectivePass, useThePipeline } from "./steps/corrections.mjs";
import { CASE_LAW_PRODUCT, CASE_LAW_TRIGGERS, caseLawJoin, composeDispatchExtra, decideCaseLaw, DISPATCH_EXTRA_BUILDERS, planAuditExtra, prepareDeclinationSpec, readCoverageJudgment, refute, reviewProfileSelection, settleDerivedBases, withGoodsFrom, withGoodsStates } from "./dispatch-extras.mjs";
import { askableOf, capabilityGapAxes, computeOpenFloors, conditionsFollowingTheRecord, enrichFindingDeadlines, envelopeDecision, envelopeHeldNote, escalationHeldNote, findFloorBreaches, isInactiveAxisRow, lateRecordIds, lateRecordsUnaddressed, loadScreenGateUnresolved, NOT_CLOSEABLE_KINDS, officeGapOf, readFloorAxes, refusedRecordsLeftOut, registerGapConditions, skepticDeferralExtra } from "./floor-and-gap-checks.mjs";
import { connotationAuditSeats, connotationRemedyToken, recordConnotationAudit, taintDisposition, taintParkJudgmentArtifacts, undoTaintRenames } from "./connotation-audit-run.mjs";
import { bandClasses, deriveBandShape, deriveNamedBand, deriveOwnerScreenArtifact, foldSupplementalProposals, holdStickyGapsIn, mainMarketsOf, mechanicalFormGapDirectives, mergeRegisterBands, namedBandText, plannedChannelsFor, readPlanExecution, readRegisterBands, reaskFollowUpErrors, refreshSupplementalExecution, remergeIfBandsMoved, runSaturationProbeCodeSide, slicesUnitNeverReached, stickyGapUnits, takeSlicesOutOfTheBand, unfinishedUnitAsItStands, writePlanExecutionReceipt } from "./register-band-run.mjs";
import { deriveFormNeighbourhood, deriveGridSpec, parseIntakeAsks } from "./intake-derivations.mjs";
import { deriveFloorDuty, placementOwnerFates, placementSeamReason, recordPlacementPass } from "./placement-pass-record.mjs";
import { findRunDate, resumeStopRefusal } from "./run-resume.mjs";
import { attachFramework, attachProfile, attachRegisterPlan, attachSearchPolicy, depthLadderEvent, foldRecipeScope, freezeProfile, profileShaOf, registerDeferredCoverage } from "./run-attachments.mjs";
import { resultsPerCellOf } from "./provider-calls.mjs";
import { digestDispatchExtra, extractRulingsTail, loadCoverageLedger, readOwnerScreen, recallFollowupMaxFor, relabelCoverageRows, runDigest, writeRegisterDigestFacts } from "./register-digest-run.mjs";
import { deriveRecordCarry, recordSynthesisSeam, safeReadText } from "./record-carry-trace.mjs";
import { inScopeClassList, registerJurisdictions } from "./run-scope.mjs";
import { changedFindingOrdinals, changedFindingOwners, floorDutyOwedNow, foreignRecordLinksBlanked, goodsEvidenceForTheWriter, keepGoodsEvidenceAsWritten, messageCtxFor, NARROW_REPAIR_TRIGGERS, outputStands, recoverWinningAttempt, reviewExclusionsPaths, revisedCitesNote, safeReadJson, stage, stageCharter, stageSessionKey, useTheStrayLedger, withdrawnExclusionLine, writerExclusionBlock, writerExclusionLine, writerExclusions } from "./stage-dispatch.mjs";
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
import "./engine/mcp/http-dispatcher.mjs"; import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename, resolve, relative } from "node:path";   // resolve: the resume line must work from any cwd
import { driverDir, driverRel, ensureDriverDir } from "../shared/driver-dir.mjs";
import { REVIEWER_OPEN_QUESTIONS_FILE } from "./reviewer-open-points.mjs";   // the run-record file the reviewer's open points go to, and the only thing that reads them now
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
import { paths, STAGES, axisTier, decideAxes, whatsappRouting, stageOrdinal, stageInputs, dependencyOrder, REGISTER_AXES, providerMeta } from "./stages.mjs";
import { RESEARCH_ANSWERS_FILE, RESEARCH_REPLAY_FILE, replayAnswersFile, savedResearchCount } from "./research-answers.mjs";   // the research a stage's earlier attempts got, handed to a later one; a replay of it
import { IDENTITY_FILE as REPORT_IDENTITY_FILE } from "./report-overview-record.mjs";
import { readPartNotCompleted, NOT_COMPLETED_DIR } from "./parts-not-completed.mjs";
import { CONTEXT_DERIVATIONS, DISPATCH_EXTRAS, INLINE_CONTEXT, sandboxManifest, sandboxGaps, derivationsFor } from "./stage-context.mjs";   // — what a stage is actually handed
import { derivedStateOf, recordedDerivedState, replayOfDerivation } from "./derived-state.mjs";   // the register picture a dispatch was handed, so a replay can be checked against it
import { parseVerdict, parseCorrectionKinds, parseCorrections } from "./verify.mjs";
import { nextRefutationSeq, readAcceptedReviewSince } from "./narrative-refutation-record.mjs";   // T3b — the typed flags, not the re-parse
import { unresolvedFlags } from "./corrections-feedforward.mjs";
import { deliveredOutcomes } from "./corrections-delivered.mjs";   // whether each correction reached the record the report was built from
import { coverageUnitLabel } from "./coverage-ledger.mjs";
import { readEnvelopeDecision, settledDeferralsSection } from "./envelope-settle.mjs";
import { REGISTER_PROVIDER } from "./driver.config.mjs";
import { FACTS_FILE as DIGEST_FACTS_FILE } from "./register-digest-record.mjs";   // conversion 11 — the render's facts sidecar and the accounting era stamp
import { floorTierByMark, floorMarkKey } from "./band-shape.mjs";   // PR-8 — the deterministic reading layer; P2-A — candidates + positions
import { writeUpForm } from "./write-up-form.mjs";   // §8/§9 — which findings earn a full card
import { shortEntryBody, groupEntries, buildGradedEntriesSection } from "./write-up-render.mjs";
// — ONE binding of the office split to this box's env, shared with Depth 2's two lanes.
// — the merge unions the halves' forms into the canonical one, with the same code the gateway unions
// an attempt with. PURE and acyclic.
// — the register coverage form: the driver writes it before the digest dispatches, renders the
// `## Coverage ledger` table and the machine ledger FROM it after the pass, and unions it across passes.
import { unitLabel, buildCoverageForm, formLedgerRows, isLayerRow, nationalRegistersNotSearched, nationalRegistersNote, orderFormName } from "./coverage-form.mjs";
import { coverageFormInput, readCoverageForm, waitingFamilyStates } from "./coverage-form-io.mjs";
import { placementFloorDecisionLines, placementAuditRows } from "./placement-decisions.mjs";   // placement's standing decisions, one check for every reader
export { placementSetAsideGrounds, placementFloorDecisionLines, placementSetAsideLines, placementAuditRows, placementRecallEndings,
  standingPlacementDecisions, writePlacementDecisions } from "./placement-decisions.mjs";
import { keepsInstructedScope, rebuildRunOrder } from "./accepted-order.mjs";   // the order a run was accepted on, kept with it from intake (steps/open-run.mjs)
import { loadProfiles, applicantMatchesProfile } from "./profiles.mjs";   // adds profileStoreResolution — the CONFIG store's identity, beside the doctrine tree's
// THE OFFERING'S own sentence about where the native-language investigation can be bought. It reaches a
// CLIENT REPORT through the script-scope coverage row, which is why it is imported rather than typed:
// the row used to name "Depth 5 (clearance-jx)" — a retired key on a retired ladder — as its remedy.
import { NATIVE_LANGUAGE_REMEDY } from "./products.mjs";
import { defaultTerritoryState, clientMarkets, orderTerritories } from "./effective-scope.mjs";   // the ONE territory ladder (the geography stamp included) + the stored-defaults reading
import { acquireSlot, releaseSlot } from "./slot-lock.mjs";
import { runLog, note, fileMeta } from "./log.mjs"; import { plainDirective, deferralCoverageRow, plainDeferralReason } from "./deferral-row.mjs"; import { PART_NAMES, NOT_COMPLETED } from "./degraded-parts.mjs"; import { armProduced, readArmSurfaces, producedNothingLine } from "./experiment-honesty.mjs"; import { correctiveReadiness, correctiveRefusalLine, correctivePassState } from "./corrective-arm.mjs";
import { deriveScopeFacts } from "./scope-facts.mjs";
import { repairFollowup } from "./repair-composers.mjs";
import { seedRunStatus, writeRunStatus, rollupStatus, signoffPatch, readSignoff } from "./progress.mjs";
import { atomicWrite } from "./run-record.mjs";
import { writeOutboxPacket } from "./outbox.mjs";
import { buildAuditMd } from "./publish/audit-from-spine.mjs";
import { readInstructedScope } from "./matter-frame-record.mjs";   // — the frame's inferred scope, when nothing was instructed; and the classes it judged necessary beyond the instructed ones, each with its reason, which the plan compile gives one identical-mark question apiece (decision 18)
import { instructedOrder } from "./record-goods.mjs";   // — the band's goods, read from the run's own records, so the shape can sort by the client's goods
import { stitchDoubts } from "./doubt-ledger.mjs";   // doubt-stitch + doubt-closure (2026-07-22)
// Conversion 6: the two line-form parsers are no longer on the live path — the seat sends typed
// rows and the driver applies THOSE. `parseClosureLines`/`parseAskClosureLines` are still exported and
// still tested: an archived run's doubt-closure.md is a hand-typed artifact and stays readable, which
// is the archive rule — a new way in, never a replacement.
import { pendingWhatIf, claimWhatIf, finishWhatIf, whatIfRefusal } from "./whatif-queue.mjs";   // a queued job is settled before its run archives   // PR-6 — every ask ends (2026-07-29)
// — every placed candidate ends somewhere a reader can see; the ones that do not are counted by name
import { snapshotSynthesisBase, restoreSynthesisBase, lastAcceptedCall, acceptSynthesis, driverReadsFor } from "./synthesis-record.mjs";   // — the duty checked against the DELIVERED document; the merge base a corrective pass holds and puts back
import { parseStageOutcomes, recordCarryDoubtsAgain } from "./record-carry.mjs";
import { declinationCallPaths } from "./declination-tool.mjs";   // — synthesis's own stated declines
import { traceCommonLawCarry, commonLawCarryEvent, CL_STAGES } from "./commonlaw-carry.mjs";
// — the run's own record log. Every driver-side register call that can write a record BODY carries
// this path, because this process runs several runs' pipelines at once and a global address would file
// one run's evidence under another.
import { beginAnswerMemory } from "../providers/_shared/answer-memory.mjs";
import { emptyQueue, coerceQueue, mintItem, pendingItems, markFlushed, receiptKeyFor } from "./digest-queue.mjs";   // (t1cd) — the digest-trigger funnel
import { foldFindingsFile, foldAfterSave, openPass, modelRecordPath, snapshotFold, readFold } from "./record-fold.mjs";   // the folded record from the delivery seam on
import { writeReviewAddresses } from "./review-addresses.mjs";   // the parts of the report each review dispatch may address
import { restamp, restampStage, reconcileStamps, shaOf, readStamp, writeFindings, settleOneShotStamp, projectStageInput } from "./stage-freshness.mjs";
import { parseManifestVariants, GRID_HALVES, GRID_SEATS } from "./common-law-receipts.mjs";
import { stampTokenRollup } from "./tokens.mjs";
import { recordRunConsumption } from "./consumption-ledger.mjs";
import { quoteForJob, logTurnaroundReconciliation } from "./run-quote.mjs";
import { readRepairBase, repairBasePath, changedContent, isEmptyChange, restingOn, scopeItems, classifyPoints, changedInputsOf, listForReview, writePostRepairRecord, postRepairRecordPath } from "./repair-scope.mjs";
import { parseFindingsJson, parseFindingsJsonLenient, compareBlockingPower, inDispositionMode, DISPOSITION_GROUP, deriveActionConditions, cardedParties, actionPartyReferences, joinAskToAnswer, stripAskLabel, reasonedNegativeGroups } from "./findings-model.mjs";
import { foldCaption, foldCardRead } from "./card-budget.mjs";
// S2 — the report card's mechanical frame, composed from the record instead of dictated (see below).
import { carriesOwnFrame, composeCard } from "./card-frame.mjs";
// qw/cn-scope-honesty — the zh-lane capability tables + the requested-scope resolver, for the plain-clearotron
// honesty row/note. jx-lanes.mjs is a PURE zero-import leaf (data + decisions, no env/fs), so a static
// import here costs a plain clearotron nothing — the "lazy import" rule below (jx.mjs / jx-units.mjs) guards
// the lane MACHINERY, not this table. Aliased: scope-ledger.mjs already exports a scopeJurisdictions
// (rows → markets); this one is (job, profile) → requested territories, the decideJxLanes precedence.
import { JURISDICTION_ADAPTERS, LANGUAGE_LANES, scopeJurisdictions as jxScopeJurisdictions } from "./jx-lanes.mjs";
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

// The ACTIVE provider's capability contract and the offices this DEPLOYMENT cannot reach both moved to
// register-unreachable.mjs, unchanged, because Depth 2's count and record lanes need the same
// two answers and a second binding of the member→variable lookup is how two lanes come to disagree
// about which variable matters. Their behaviour here — NEVER-KILL, null contract, empty list — is
// identical; the module comment carries the reasoning that used to live at this spot.

// Cited registry URIs on a delivered surface (broad form — hyphens AND underscores are legal in record
// ids: corsearch `/mark/cn/37554073-42`, Signa `/mark/us/tm_019d1db7-…`).
const CITED_URI_RE = /\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/gi;

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

/**
 * The receipt AT DELIVERY, derived on the spot when a resume skipped the fan-in that writes it.
 *
 * Without this the two named-competitor lint checks emit nothing at all on a resumed run — no
 * failure, no pass row, no trace: an absence reading as success, which is the exact defect class the
 * instrumentation house rule exists to kill. The absence is therefore also RECORDED either way, with
 * the reason, so "this matter has no owner lane" and "the receipt went missing" are distinguishable.
 */
export function ownerScreenForDelivery(ctx) {   // @internal
  const P = ctx.paths;
  const onDisk = readOwnerScreen(P);
  if (onDisk?.owners?.length) return onDisk;
  let derived = null;
  try {
    if (ctx.registerPlan && existsSync(P.registerNamedBand)) {
      derived = deriveOwnerScreenArtifact(ctx, JSON.parse(readFileSync(P.registerNamedBand, "utf8")));
    }
  } catch (e) { note(`owner-screen delivery derivation skipped (non-fatal): ${String(e.message).slice(0, 80)}`); }
  if (!derived?.owners?.length) {
    runLog(P.runDir, { event: "owner-screen-absent", owners: 0,
      reason: !ctx.registerPlan ? "no frozen register plan on this run"
        : !existsSync(P.registerNamedBand) ? "no merged band on disk"
        : "the frozen plan carries no owner×element slice (no watchlist owners seeded)" });
  }
  return derived;
}

// THE RECORDS A DELIVERY REPAIR WAS HANDED THE WHOLE GOODS TEXT FOR (predelivery-lint.mjs, goodsHeldWholeChecks), kept
// beside the run so the check after that repair, and a resume, do not name them again. A missing or unreadable file is
// an empty set: the check then names them, which costs a repair and never hides a finding.
const GOODS_HANDED_FILE = "goods-held-whole-handed.json";
function readGoodsHanded(runDir) {
  try { return new Set(JSON.parse(readFileSync(driverDir(runDir, GOODS_HANDED_FILE), "utf8"))?.records ?? []); } catch { return new Set(); }
}
function recordGoodsHanded(runDir, uris) {
  const all = new Set([...readGoodsHanded(runDir), ...uris]);
  ensureDriverDir(runDir);
  atomicWrite(driverDir(runDir, GOODS_HANDED_FILE), JSON.stringify({ records: [...all].sort() }, null, 2) + "\n");
}

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

function deriveCommonLawCarry(ctx, trigger, { slice = "common-law", gridPath = null, findingsPath = null,
  consumed = true, outPath = null } = {}) {
  const P = ctx.paths;
  const target = outPath ?? P.commonLawCarry;
  const write = (artifact) => {
    try {
      mkdirSync(dirname(target), { recursive: true });
      atomicWrite(target, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`commonlaw-carry artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  try {
    const grid = gridPath ?? P.commonLawGrid;
    if (!existsSync(grid)) {
      // An absence is a state, not a pass. A matter with no common-law pass writes nothing and says so.
      runLog(P.runDir, commonLawCarryEvent({ trigger, slice, reason: `no ${basename(grid)} on this run` }));
      return null;
    }
    // — WHAT WAS ORDERED, read from the file the EXECUTOR was ordered from. The two reconciliation
    // rates divide the run by itself, so a channel that produced no cell and no candidate enters neither
    // side and a partial sweep scores like a complete one. The plan is the missing denominator.
    //
    // `_driver/grid-spec.json` is the right source and not `ctx.profile.platforms`: it is what the
    // deterministic grid actually runs and what the receipts gate already joins ("the single, consistent
    // lever", above), it carries `[...channels, "web"]` with the general-web cell already unioned, and it
    // is the file that survives the GENERIC-profile branch where the channels come from the matter frame
    // rather than the profile. Reading the profile here would compare the grid against a plan the grid was
    // never given.
    //
    // ABSENT ⇒ null ⇒ the trace reports `channels.state: "unknown"`, never a clean 1. A register-only run
    // and a run whose grid spec never landed both genuinely cannot say what was ordered, and a coverage
    // question that was never asked must not answer itself in the affirmative.
    const plannedChannels = plannedChannelsFor(P);

    const artifact = traceCommonLawCarry({
      gridRaw: readFileSync(grid, "utf8"),
      planned: plannedChannels,
      findingsText: existsSync(findingsPath ?? P.commonLaw) ? readFileSync(findingsPath ?? P.commonLaw, "utf8") : "",
      // ALL THREE labels. A split run logs `common-law-half:a` / `:b` and never `common-law`; asking for
      // `["common-law"]` alone finds no events and every candidate on every split run reads
      // stage-incomplete — a loud wrong answer on the common path.
      outcomes: parseStageOutcomes(safeReadText(paths(P.runDir).run), CL_STAGES),
      consumed, slice,
    });
    write(artifact);
    runLog(P.runDir, commonLawCarryEvent({ trigger, artifact, slice }));
    if (artifact.computable !== true) return artifact;
    const t = artifact.totals;
    if (t.unreasoned) {
      note(`commonlaw-carry (${slice}): ${t.unreasoned} of ${t.retrieved} retrieved candidate(s) were dropped with NO step recording a ground`
        + ` — see ${basename(target)} .unreasoned. This annotates, it does not re-judge or block`);
    }
    if (t.unjoinable_candidates) {
      note(`commonlaw-carry (${slice}): ${t.unjoinable_candidates} candidate(s) carry no URL, so they are counted BY NAME`
        + " rather than joined — see .unjoinable_candidates. Nothing non-Latin is dropped silently");
    }
    if (artifact.degenerate) {
      note(`commonlaw-carry (${slice}): DEGENERATE — the findings name ${artifact.findings_urls} URL(s) and this trace`
        + " says NOT ONE retrieved candidate reached a finding. The TRACE is wrong, not the run's recall");
    }
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "commonlaw-carry-failed", trigger, slice, fail: String(e?.message ?? e).slice(0, 200) });
    note(`commonlaw-carry derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
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

// The ledger of the sweeps for strays (stage-dispatch.mjs): what each run has reported, and the doctrine tree and the
// studio root as each run first saw them. Created here, with this module, and handed to the sweeps as it loads, so a
// fresh load of this module starts it empty.
const strayReported = new Map();
const doctrineBefore = new Map();
const matterBefore = new Map();
useTheStrayLedger({ doctrineBefore, matterBefore, strayReported });

// A1 (F1): a correction must reach EVERY surface the client sees. The narrative alone is
// not enough — report cards, the landscape and the client summary render from findings.json, so a
// corrective pass that re-emits only the narrative lets a killed/mis-attributed card resurrect on
// the delivered page (the VENZY case). The followup therefore mandates BOTH
// files; the driver-side freshness gate below makes it enforceable.
// AD-2 A9 (E2E-R2): the dispatch carries placement's rulings tail AS DATA — computed things reach
// the next stage as data, not prose. A warm resume must not depend on the rulings having survived
// context trimming, and the repair pass is NOT asked to re-read placement-recommendations.md (the
// E2E-R2 dispatch history proves both halves: one corrective dispatch passed with no re-read, and
// another made 7 targeted edits precisely when the tail was in front of it).

export function correctionsExtra(P, depth = null, framework = null, reading = correctionReading(P)) {   // @internal
  const { review, rulingsTail, worklist, scope } = reading;
  // THE RUNG RIDES THE CORRECTIVE RE-EMISSION, byte-identically with the fresh dispatch. Appended rather
  // than threaded through `repairFollowup`'s fields so both dispatches carry the SAME STRING from the
  // SAME function, and an arm can compare them without knowing how either is assembled.
  // THE RECORD ITS PATCH UPDATES. The save patches the writer's own record, and the flags name its findings in its
  // numbering; from the delivery seam on, findings.json is the folded record, renumbered. So while a fold is in force,
  // a correction re-armed on a later pass is handed the writer's record (record-fold.mjs), as the lint's repair is: a
  // number read off the folded record names another finding there, and the next one after it a finding already held.
  return repairFollowup("synthesis:corrective", {
    narrative: P.narrative, findings: modelRecordPath(P.runDir, P.findings), placement: P.placement,
    rulingsTail, scope, worklist, review,
  }) + stageCharter("synthesis", depth, framework);
}

// AD-2 A1 (E2E-R2, recovery granularity) — is the corrective cycle already SETTLED for the bytes on
// disk? Pure decision over the completion receipt + the current shas so it tests offline. Settled
// means: a receipt exists AND the review + narrative bytes are exactly the ones the completed cycle
// left behind (both non-null — an absent file is never "settled"). Either file moving re-arms the
// cycle: a recomputed narrative or a fresh review is new work, never a replay.
export function correctiveCycleSettledDecision(receipt, current) {   // @internal
  return Boolean(receipt?.shas
    && receipt.shas.review != null && receipt.shas.review === current?.review
    && receipt.shas.narrative != null && receipt.shas.narrative === current?.narrative);
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

// — ONE DISPATCHER FOR EVERY REPAIR ARM, BECAUSE THE ENTRIES CANNOT BE TRUSTED TO REMEMBER.
//
// measured the principle and applied it to exactly one entry: a repair dispatch that skips the
// stage's driver-computed blocks came out 3,017 bytes THINNER than the fresh one, so composing the same
// blocks is what makes the two passes identical rather than what makes them differ. That argument is not
// specific to synthesis, and the other two arms that declare blocks never got it.
//
// `narrative-refutation` declares TWO. `plan-audit` is the one the issue was filed about; `refute-registry-check`
// is the deterministic comparison of the narrative's claims against the fetched records in `_records`, and it
// is reachable ONLY through this composer. So on a repair pass the reviewer was re-asked with the
// driver's own contradiction check absent — the class of error that was delivered on the run behind.
//
// A HELPER RATHER THAN THREE FIXES, because three fixes leave the fourth entry free to repeat it. Stages
// that declare nothing compose "" and dispatch exactly as before.
const repairStage = (name) => (ctx) => {
  const { text } = composeDispatchExtra(name, ctx);
  return stage(name, ctx, { force: true, trigger: "stale-repair", ...(text ? { extra: text } : {}) });
};

const UPSTREAM_STALE_REPAIR = {
  "register-digest": (ctx) => runDigest(ctx, { force: true, trigger: "stale-repair" }),
  // A-4 rides here: declaring plan-execution.json on stageInputs.skeptic is only safe once a stale
  // skeptic can be refreshed in place. Without this entry the declaration parks every reopen-shaped run.
  // — its `skeptic-deferral-extra` is passed on the FRESH dispatch and was dropped here.
  skeptic: repairStage("skeptic"),
  // review — THIS IS A COLD DISPATCH AND IT CARRIES THE BLOCKS. It re-authors narrative.md and
  // findings.json, the delivered opinion, and it renders `def.message(ctx)` in full; without the extra
  // the seat ruled over the coverage claim with the receipt and the ledger withheld, on a prompt that
  // told it both were tabulated below. The refutation's equivalent gap fails closed on verify.mjs's
  // `plan_audit_missing`; synthesis has no such validator, so it succeeded silently — measured.
  //
  // The original justification was that a repair must not carry a different prompt from the pass it
  // repairs. The measurement inverts it: the repair dispatch came out 3,017 bytes THINNER than the
  // fresh one, so composing the same blocks is what makes the two passes identical rather than what
  // makes them differ.
  //
  // THE LIST OF RECORDS IT MUST ANSWER IS RE-PREPARED FIRST, as the corrective pass re-prepares it. This
  // repair runs because an input moved, register-findings.md among them, and that file is what the list
  // is read from. Skipped, the repair was dispatched with no DECLINATIONS block at all, while the
  // recorder still held the seat to the list the fresh pass had written: the order missing from the
  // prompt, and enforced against records the digest may since have moved.
  synthesis: (ctx) => { prepareDeclinationSpec(ctx, ctx.paths); return repairStage("synthesis")(ctx); },
  // — composed NEITHER of its two declared blocks; see the dispatcher comment above.
  "narrative-refutation": repairStage("narrative-refutation"),
  // — placement declares register-named-band.json and the per-axis register-units/*.md, and the
  // escalation recheck, the skeptic escalation and the envelope close all rewrite those AFTER it. On a
  // resume where placement skips as LEGITIMATELY fresh (no kill involved — removed the wall route,
  // not the exposure) it joins ctx.skippedStages and therefore deliveryPathStages, one of those arms moves
  // its inputs, and the delivery precondition read it stale with no in-pass remedy. The run parked.
  //
  // Ruled to option 1. It costs ONE placement dispatch on affected resumes — 87k + 113k output tokens,
  // ~27 minutes for the second, and removing that dispatch is what was for, so this is a cost
  // decision rather than a mechanical fix. The other side is now measured: the same rule fired on a
  // different pair with no entry and cost 496,327 output tokens, 43 dispatches of which 33 were repeats,
  // and 1h29m — a third of that run's output and 29% of its wall clock. One targeted re-dispatch
  // to avoid re-deriving everything downstream is the cheaper side by a wide margin, and the safer one.
  //
  // settleOneShotStamp IS REFUSED HERE, and this is the part most likely to be got wrong in a hurry.
  // Blessing frame-diff's stamp is safe because nothing consumes the diff by the time the gate asks.
  // Placement is the opposite: placement.md and placements.json are declared inputs of register-digest,
  // synthesis and narrative-refutation, all of which run after the mutation. Blessing placement's stamp
  // would hide staleness from three live consumers — the exact thing the freshness gate exists to catch.
  // Same defect shape, opposite correct answer.
  //
  // A bare stage() is right here, unlike register-digest above: placement has no machine-ledger sibling a
  // re-run could leave outvoting its prose, and it is re-runnable by contract (no one-shot receipt — the
  // assertReceiptSettled call ahead of its normal dispatch settles the plan receipt, which is already
  // settled by the time the delivery gate asks).
  "placement-inquiry": async (ctx) => recordPlacementPass(ctx, await stage("placement-inquiry", ctx, { force: true, trigger: "stale-repair" }), "stale-repair"),
  // frame-diff is DELIBERATELY ABSENT and must stay absent. It is one-shot by contract (no in-process
  // re-diff), so an entry here would re-dispatch a stage the design says runs once, for a model call
  // that cannot change anything: nothing declares frame-diff's outputs as a stage input, so by the time
  // the delivery gate asks, every consumer of the diff — the reopen gate, runSupplementalSweeps, the
  // dominant-element clamp — has already run. Its answer to a sanctioned in-pass rewrite is
  // settleOneShotStamp above, not a re-run.
};

export const DELIVERY_TAIL_LABEL_RE = /^(report-overview|report-card:.+)$/;   // @internal
export function partitionDeliveryStale(staleStages) {   // @internal
  const tail = [], upstream = [];
  for (const s of staleStages ?? []) (DELIVERY_TAIL_LABEL_RE.test(String(s?.label ?? "")) ? tail : upstream).push(s);
  return { tail, upstream };
}

// A1 — driver-side freshness gate: after a corrective pass, verify the reviewer's named
// entities actually reached findings.json (the file every client surface renders from). Deterministic:
// proper-name candidates from the review ∩ the findings' marks/owner names = the named set; if the
// file is byte-unchanged (or every named finding's object is) and no corrections marker landed, fire
// ONE followup demanding the re-emit; a terminal miss NEVER withholds (never-withhold) — it logs,
// flags the internal review bar, and closes the CLIENT export via _driver/corrections-state.json.
export function snapshotFindingsForCorrections(P, runDir) {   // @internal
  let raw = null;
  try { raw = readFileSync(P.findings, "utf8"); } catch { /* legacy / not-yet-populated */ }
  if (raw == null) return null;
  const sha = createHash("sha256").update(raw).digest("hex");
  // THE RECORD IN THE MODEL'S NUMBERING, beside the one on disk. The review's flags name findings in the
  // model's numbering, so the corrective body compares the record the model wrote; once the delivered
  // record is folded the two differ (record-fold.mjs). The fold is held too, for a rollback to put back,
  // and so are narrative.md and the transport's merge base (`base`): a rollback that put back findings.json
  // alone left the next patch to merge onto the failed pass's record.
  const modelAt = modelRecordPath(runDir, P.findings);
  let modelRaw = raw;
  if (modelAt !== P.findings) { try { modelRaw = readFileSync(modelAt, "utf8"); } catch { modelRaw = raw; } }
  const model = { raw: modelRaw, sha: modelRaw === raw ? sha : createHash("sha256").update(modelRaw).digest("hex") };
  const fold = snapshotFold(runDir);
  try {
    const tmp = paths(runDir).findingsPreCorrectiveJson;
    // PR-4 (snapshot-before-overwrite): store the FULL pre-corrective text, not just its sha — a
    // sha proves the file changed but cannot show WHAT the corrective pass changed; that run's
    // pre-corrective findings were unrecoverable for exactly this reason. Findings are small (KBs);
    // the audit value of the diff dwarfs the bytes.
    writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), sha, text: raw }, null, 2));
    renameSync(tmp, paths(runDir).findingsPreCorrective);
  } catch { /* advisory sidecar */ }
  return { raw, sha, model, fold, base: snapshotSynthesisBase(runDir) };
}
/**
 * THE REPAIR'S RUN-LOG ROW, built from what `repairUnnamedRemovals` returned. PURE.
 *
 * `base` says what the merge base took, in the words the basis derivation's row uses for the same edit:
 * `restored`, or `unchanged` where the base already held what came back; `refused` where the acceptance boundary
 * refused the edit and the base was left as it was, so the next accepted patch drops the restore again; and
 * `no-base` where the run holds no base, so a later patch is refused for having none. The sidecar keeps the reason.
 */
export function removalRepairedRow(repaired) {   // @internal
  const b = repaired?.base;
  const base = !b ? null : b.ok ? (b.changed ? "restored" : "unchanged") : /^no_base:/.test(String(b.reason)) ? "no-base" : "refused";
  return { event: "corrective-unnamed-removal-repaired", defect: true,
    restored: repaired.restoredFindings.length, keys: repaired.restoredKeys.length,
    rows: repaired.restoredRows.length,
    leftRemoved: repaired.leftRemoved.length,
    findings: repaired.restoredFindings.map((f) => `${f.ordinal}:${f.mark}`), ...(base ? { base } : {}) };
}

/**
 * The ordinals the reviewer's flags name, from the typed call where the run has one and the rendered
 * parse where it does not — the same two sources, in the same order, that `correctionsExtra` uses to
 * build the worklist. A flag with no `on` names no ordinal and is matched by MARK instead.
 */
/**
 * WHAT THE DRIVER PUT BACK, for the reviewer's re-read.
 *
 * Every other row in the findings document is the seat's judgment. A restored row is not: the corrective
 * pass removed it with no flag naming it, and the driver put it back whole from the pre-corrective
 * snapshot. A reviewer that cannot tell those apart weighs a driver-restored finding as the author's
 * corrected judgment — the one reading that would make the repair worse than the loss it fixes.
 *
 * "" WHEN NOTHING WAS RESTORED, which is every ordinary run: `lines()` drops an empty string, so the
 * dispatch is byte-identical to the one before this existed unless the repair actually fired.
 */
export function restoredFindingsTable(repair) {   // @internal
  const rows = repair?.restoredFindings ?? [];
  // A RESTORED ROW IS THE DRIVER'S DOING TOO, and this read only findings — so a coverage note or an
  // action the driver put back reached the reviewer as the pass's own work, which is the one reading
  // this section exists to prevent. Same repair, same snapshot, same sentence (found in review).
  const lines = repair?.restoredRows ?? [];
  if (!rows.length && !lines.length) return "";
  if (!rows.length) return [
    "RESTORED BY THE DRIVER, NOT BY THE AUTHOR — read these before anything else.",
    "The corrective pass removed the line(s) below and no flag of yours named them, so the driver put them",
    "back exactly as you last read them. They carry NONE of this round's corrections, and they are not the",
    "author's judgment about anything. If a removal here was in fact right, say so in your review and name",
    "the ground — that is the statement the pass failed to make.",
    "",
    ...lines.map((l) => `  ${l.label} — restored: removed by the corrective pass with no flag naming it`),
    "",
    "These lines MOVED, whatever the scope note above says about what did not.",
  ].join("\n");
  return [
    "RESTORED BY THE DRIVER, NOT BY THE AUTHOR — read these before anything else.",
    "The corrective pass removed the finding(s) below and no flag of yours named them, so the driver put",
    "them back exactly as you last read them. They carry NONE of this round's corrections, and they are",
    "not the author's judgment about anything. If a removal here was in fact right, say so in your review",
    "and name the ground — that is the statement the pass failed to make.",
    "",
    ...rows.map((f) => `  #${f.ordinal} ${f.mark} — restored: removed by the corrective pass with no flag naming it`),
    ...lines.map((l) => `  ${l.label} — restored: removed by the corrective pass with no flag naming it`),
    "",
    "These rows MOVED, whatever the scope note above says about findings that did not.",
  ].join("\n");
}

// ── THE REVIEW AFTER A DELIVERY-CHECK REPAIR, AND ITS ONE CORRECTION ─────────────────────────────────────
//
// When the delivery check finds a fault in the narrative, the writer repairs its record and the narrative's
// bytes move, so the reviewer reads stale. It used to be sent the whole review again, cold, and nothing applied
// what it flagged then. Now, where the scope can be established, it reads what the repair changed and every
// statement resting on it, worked out by value from the writer's record before and after the repair
// (repair-scope.mjs), and its flags go to ONE correction by the writer that nothing reviews again.
//
// THE FIRST REVIEW STAYS WHOLE, and so does this one whenever the scope is not certain: no record kept from
// before the repair, another of the reviewer's inputs moved, a whole re-synthesis ran in this pass, or the
// record's version or framework changed. A rewrite with the same values is no change and no review runs.

/** Which review the reviewer's staleness after a delivery-check repair calls for. Reads the run; never throws. */
/**
 * A SAVE TRIED AGAIN BEFORE IT IS GIVEN UP. Calls `save` up to `attempts` times, waiting `waitMs` between tries, and
 * says how it went: `{ ok, attempts, error }`. Never throws. `wait` is injectable so a test does not sleep.
 */
export function saveWithRetries(save, { attempts = 3, waitMs = 250, wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {   // @internal — driven by its test
  let error = null;
  for (let n = 1; n <= attempts; n++) {
    try { save(); return { ok: true, attempts: n, error }; }
    catch (e) { error = e; if (n < attempts) wait(waitMs); }
  }
  return { ok: false, attempts, error };
}

/**
 * THE STAGES STALE ON WHAT PLACEMENT WROTE, which join the chain of a changed decision whoever moved it: the delivery
 * check's own repeat, the decisions written again when the shape is derived again, or a late pass whose readers had
 * already run. `names` are the base names of placement's files. PURE.
 */
export function stagesStaleOnPlacement(stale = [], names = new Set()) {   // @internal — driven by its test
  return stale.filter((x) => (x?.changed ?? []).some((c) => names.has(String(c?.name ?? "")))).map((x) => x.label);
}

/**
 * A CLAUSE JUDGED AGAIN REPLACES THE ONE IT REPEATS, BY ITS KIND. Withdraws every entry whose reason opens with
 * `<token>:` from the index-aligned reasons and clauses, and a withdrawn clause from the guard set once no entry left
 * carries it. Returns the arrays as they now stand and how many entries went. PURE.
 */
export function withdrawByToken(reasons = [], clauses = [], guard = new Set(), token) {   // @internal — driven by its test
  const keep = reasons.map((r) => !String(r ?? "").startsWith(`${token}:`));
  const out = { reasons: reasons.filter((_, i) => keep[i]), clauses: clauses.filter((_, i) => keep[i]), withdrawn: keep.filter((k) => !k).length };
  for (const [i, c] of clauses.entries()) if (!keep[i] && !out.clauses.includes(c)) guard.delete(c);
  return out;
}

/**
 * IS THE RECORD'S ACTIONS REGISTER A LIST? The one positive sign that a record holding no forward legal step has
 * withdrawn them, rather than lost them: an unreadable record, a missing register and one that is not a list are not a
 * withdrawal. Entries dropped as unreadable are the caller's to weigh. PURE.
 */
export function actionsRegisterListed(raw) {   // @internal — driven by its test
  try { return Array.isArray(JSON.parse(String(raw ?? ""))?.actions); } catch { return false; }
}

/**
 * WHAT A REPAIR IN THE DELIVERY CHECK LEFT STALE, AND WHAT OF IT IS QUEUED. A stage is this repair's when it is stale now
 * and was not before the repair, or is stale on an input that has moved since; a stage stale before for the same reasons
 * is not, and stays the guard's. Every stage the repair left stale joins the chain, so its own re-run is followed in turn.
 * Of those, a stage already queued ahead runs where it stands, and one this pass already re-did is re-done once more at
 * most. PURE.
 */
export function whatTheRepairLeftStale({ before = [], after = [], repaired, ahead = new Set(), processed = new Set(), requeued = new Set() }) {   // @internal — driven by its test
  const keys = (x) => (x?.changed ?? []).map((c) => `${c?.name}@${c?.now}`);
  const was = new Map(before.map((x) => [x.label, new Set(keys(x))]));
  const chain = [], queue = [], requeue = [];
  for (const x of after) {
    if (x.label === repaired) continue;
    const prior = was.get(x.label);
    if (prior && keys(x).every((k) => prior.has(k))) continue;   // stale before, for the same reasons: not this repair's
    chain.push(x.label);
    if (ahead.has(x.label)) continue;
    if (processed.has(x.label)) { if (requeued.has(x.label)) continue; requeue.push(x.label); }
    queue.push(x);
  }
  return { chain, queue, requeue };
}

export function postRepairScope(runDir, P, s2, { staleRepaired = [], baseKept = false } = {}) {   // @internal
  if (!baseKept) return { mode: "whole", why: "no-repair-base" };
  const narrative = basename(String(P?.narrative ?? "narrative.md"));
  const moved = (s2?.changed ?? []).filter((c) => c?.via !== "repair-record" && basename(String(c?.name ?? "")) !== narrative);
  if (moved.length) return { mode: "whole", why: "another-input-moved", moved: moved.map((c) => String(c?.name ?? "")) };
  if (staleRepaired.includes("synthesis")) return { mode: "whole", why: "re-synthesised" };
  // Any other step this loop re-ran ahead of the reviewer (the digest, placement, the skeptic) moved what the review
  // stands on beyond the repair's own change, so the scope the queue captured no longer says what changed.
  const upstream = staleRepaired.filter((l) => l !== "narrative-refutation" && !/^report-(overview|card:)/.test(l));
  if (upstream.length) return { mode: "whole", why: "upstream-re-run", upstream };
  let before = null, after = null;
  try { before = readRepairBase(runDir); after = lastAcceptedCall(runDir); } catch { /* read as no base */ }
  const changed = changedContent(before, after);
  if (changed.whole) return { mode: "whole", why: changed.why };
  if (isEmptyChange(changed)) return { mode: "none", why: "repair-changed-no-content" };
  return { mode: "narrowed", changed, after, findingOnly: queuedForTheRecordOnly(s2) };
}

/**
 * Whether the delivery-check repair's change to the findings record is owed a review when the narrative did not move:
 * any change but the same values saved again. A change the scope cannot narrow (a moved version or framework, or a
 * record that could not be compared) is owed one too, and the loop gives it the whole review. Never throws.
 */
export function recordChangeOwesReview(runDir) {   // @internal
  let c = null;
  try { c = changedContent(readRepairBase(runDir), lastAcceptedCall(runDir)); } catch { c = null; }
  return !isEmptyChange(c);
}

/**
 * An open ask as the closure step is shown it: its id, where it was raised and its text, and for a request kept as
 * parts, which part it is and the questions that part holds, so two parts of one request never read as one line.
 */
export function openAskForClosure(a) {   // @internal — driven by its test
  return { ask_id: a.ask_id, born: a.born, ask: a.ask,
    ...(a.part ? { part: a.part, qids: Array.isArray(a.qids) ? a.qids : [] } : {}), ...(a.family ? { family: a.family } : {}) };
}

/** The change a whole review's record lists when its scope could not be compared: none. */
const NO_CHANGE = Object.freeze({ findings: [], lines: [], registers: [], sections: [], whole: true, why: "not-compared" });

/** Whether the reviewer was queued for a change to the findings record only: its narrative did not move. */
function queuedForTheRecordOnly(s2) {
  const changed = s2?.changed ?? [];
  return changed.length > 0 && changed.every((c) => c?.via === "repair-record");
}

/** What the record of an unread review says its change was: findings only, or more. null with no unread record. */
function unreadRecordFindingOnly(runDir) {
  try {
    const r = JSON.parse(readFileSync(postRepairRecordPath(runDir), "utf8"));
    return r?.status === "unread" && typeof r.findingOnly === "boolean" ? r.findingOnly : null;
  } catch { return null; }
}

/**
 * A review after a repair that could not be read, ON RECORD. Its change went unreviewed, and the reviewer's own stamp
 * cannot be trusted to say so: a findings-only change does not move the files the reviewer declares, and a stage
 * that ends with no accepted call still reads ok whenever the earlier review's file stands, so its stamp is
 * refreshed over the repaired narrative. This record is never handed to the delivery guard: a run is not held on an
 * unread review (owner's ruling, 2026-10-19), and such a run delivers as the released engine delivers it. The one
 * boundary is the released engine's own: a reviewer whose re-run fails outright leaves its stamp stale on a changed
 * narrative, and the freshness guard decides that, as it always has. The record keeps what went unreviewed, and a
 * resume for any other cause reviews that change whole, until a review that is read replaces the record.
 */
export function unreadRecordReview(runDir) {   // @internal
  try { return JSON.parse(readFileSync(postRepairRecordPath(runDir), "utf8"))?.status === "unread"; }
  catch { return false; }
}

const reviewBeforeRepairPath = (runDir) => paths(runDir).reviewBeforeRepair;
const reviewAfterRepairPath = (runDir) => paths(runDir).reviewAfterRepair;
const postRepairCorrectionsPath = (runDir) => paths(runDir).postRepairCorrections;
const scopeRecord = (scope, items) => ({
  findingOnly: Boolean(scope.findingOnly),
  changed: { findings: scope.changed.findings.map((f) => ({ ordinal: f.ordinal, change: f.change, fields: f.fields })),
    lines: scope.changed.lines.map((l) => ({ area: l.area, change: l.change })),
    sections: scope.changed.sections.map((x) => x.title), registers: scope.changed.registers.map((r) => r.label) },
  items: items.map((i) => ({ kind: i.kind, role: i.role, label: i.label, ...(i.delivered != null ? { delivered: i.delivered } : {}) })),
});

/**
 * The narrowed review. Keeps the whole review aside first, so whatever this one writes, the run can put the
 * whole review back: `senior-eye-review.md` holds the review whose verdict the run carries, and the caller
 * decides that after the late-verdict rule. Returns `{reviewed: false}` when no accepted review came back —
 * the label then stays stale and the delivery guard decides, as for a whole review that failed.
 */
async function runPostRepairReview(ctx, P, run, scope) {
  const runDir = run.runDir;
  const kept = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : null;
  if (kept != null) atomicWrite(reviewBeforeRepairPath(runDir), kept);
  const putBack = () => {
    if (kept == null) return;
    let now = null;
    try { now = readFileSync(P.seniorEyeReview, "utf8"); } catch { now = null; }
    if (now !== kept) atomicWrite(P.seniorEyeReview, kept);
  };
  const seq0 = nextRefutationSeq(runDir);
  const fold = readFold(runDir);
  const resting = restingOn(scope.changed, scope.after);
  const items = scopeItems(scope.changed, resting, fold?.map);
  const list = listForReview(scope.changed, resting, fold?.map);
  const changedInputs = changedInputsOf(scope.changed, { narrative: P.narrative, findings: P.findings });
  const message = repairFollowup("narrative-refutation:post-repair-review", {
    findings: P.findings, ...list, registerOnly: Boolean(ctx.registerOnly), job: ctx.job ?? {},
    skepticFlags: P.skepticFlags, frameReopenReceipt: P.frameReopenReceipt, floorDecisions: placementFloorDecisionLines(P),
    writerExclusions: writerExclusionBlock(P, { review: "later" }),
    // The record after the repair, and each changed finding by its ordinal, so a finding the repair removed is nameable.
    reviewAddresses: writeReviewAddresses(runDir, { records: [scope.after?.findings, { findings: scope.changed.findings }],
      narratives: [scope.after?.narrative], seq0 }),
  });
  const { text: blocks } = composeDispatchExtra("narrative-refutation", ctx, { skip: ["refute-plain-register"] });
  const t0 = Date.now();
  const r = await stage("narrative-refutation", ctx, {
    force: true, trigger: "post-repair-review", freshMessage: message, ...(blocks ? { extra: blocks } : {}), changedInputs,
  });
  const rec = r?.ok ? readAcceptedReviewSince(runDir, seq0) : null;
  const base = { seq0, ...scopeRecord(scope, items), changedInputs: changedInputs.map((x) => basename(String(x))), ms: Date.now() - t0 };
  if (!rec) {
    // NOT A PASS: no review the driver can act on came back. The whole review goes back in place, the record
    // says the review could not be read, and the label stays stale for the delivery guard.
    putBack();
    writePostRepairRecord(runDir, { status: "unread", ...base, fail: r?.ok ? "no-accepted-call" : String(r?.fail ?? "failed") });
    runLog(runDir, { event: "post-repair-review", read: false, fail: r?.ok ? "no-accepted-call" : String(r?.fail ?? "failed").slice(0, 120) });
    note(`[post-repair] the review after the delivery-check repair could not be read back — the whole review stays in place and the delivery guard decides`);
    return { reviewed: false };
  }
  const reviewText = readFileSync(P.seniorEyeReview, "utf8");
  atomicWrite(reviewAfterRepairPath(runDir), reviewText);
  const points = classifyPoints(rec.flags, items);
  const by = points.reduce((a, x) => ((a[x.class] = (a[x.class] ?? 0) + 1), a), {});
  writePostRepairRecord(runDir, { status: "read", ...base, verdict: rec.verdict, seq: rec.seq,
    points: points.map((x) => ({ n: x.n, kind: x.kind, on: x.on, target: x.target.label, class: x.class, text: String(rec.flags[x.n - 1]?.text ?? "") })) });
  runLog(runDir, { event: "post-repair-review", read: true, verdict: rec.verdict, flags: rec.flags.length, classes: by,
    changed: { findings: scope.changed.findings.length, lines: scope.changed.lines.length, sections: scope.changed.sections.length, registers: scope.changed.registers.length },
    findingOnly: Boolean(scope.findingOnly), ms: base.ms });
  return { reviewed: true, rec, reviewText, items, points, putBack, base };
}

/**
 * THE WHOLE REVIEW OF A REPAIR'S CHANGE: when the narrowed one could not be read, and when the change cannot be
 * narrowed at all (a change to the record the scope cannot compare, or one an earlier review could not read, as on
 * a resume). It returns what runPostRepairReview returns, so its points go to the same one correction; adopting its
 * verdict alone would leave its flags unapplied. When it cannot be read, the record says the change was not reviewed
 * (`unreadRecordReview`). No unread review is a pass, and the record never holds the run; a re-run that failed outright
 * leaves the reviewer's stamp as the released engine leaves it, for the freshness guard. `rerun`
 * is the reviewer's own stale-repair arm.
 */
async function runWholeReviewForRecord(ctx, P, run, scope, rerun) {
  const runDir = run.runDir;
  const seq0 = nextRefutationSeq(runDir);
  const t0 = Date.now();
  const r = await rerun();
  const rec = r?.ok ? readAcceptedReviewSince(runDir, seq0) : null;
  const fold = readFold(runDir);
  const items = scopeItems(scope.changed, restingOn(scope.changed, scope.after), fold?.map);
  const base = { seq0, ...scopeRecord(scope, items), whole: true, ms: Date.now() - t0 };
  if (!rec) {
    const fail = r?.ok ? "no-accepted-call" : String(r?.fail ?? "failed");
    writePostRepairRecord(runDir, { status: "unread", ...base, fail });
    runLog(runDir, { event: "post-repair-review", read: false, whole: true, fail: fail.slice(0, 120) });
    note(`[post-repair] neither review of what the repair changed could be read back — it was not reviewed, and the run's record says so; ${r?.ok ? "the run delivers" : "the reviewer's re-run failed, so its stamp stays as it was and the freshness guard decides, as in the released engine"}`);
    return { reviewed: false };
  }
  const reviewText = readFileSync(P.seniorEyeReview, "utf8");
  atomicWrite(reviewAfterRepairPath(runDir), reviewText);
  const points = classifyPoints(rec.flags, items);
  writePostRepairRecord(runDir, { status: "read", ...base, verdict: rec.verdict, seq: rec.seq,
    points: points.map((x) => ({ n: x.n, kind: x.kind, on: x.on, target: x.target.label, class: x.class, text: String(rec.flags[x.n - 1]?.text ?? "") })) });
  runLog(runDir, { event: "post-repair-review", read: true, whole: true, verdict: rec.verdict, flags: rec.flags.length, ms: base.ms });
  return { reviewed: true, rec, reviewText, items, points, putBack: () => {}, base };
}

/** Where the state the review after a repair reads is kept whole, before the review and its correction run. */
const postRepairStatePath = (runDir) => paths(runDir).postRepairState;

/**
 * THE STATE THE REVIEW AFTER A REPAIR READS, KEPT WHOLE before the review and its correction can lose any of it: the
 * findings record, its narrative, the merge base the next patch builds on, and the fold, in one file under `_driver/`,
 * so the four are kept together or not at all. Where a part cannot be read, no state is kept, and an earlier one is
 * removed so that it never stands for this review. Returns whether a state was kept. Never throws.
 */
function retainStateBeforeReview(runDir, P) {
  try {
    const findings = readFileSync(P.findings, "utf8");
    const base = snapshotSynthesisBase(runDir);
    if (base.accepted == null || base.narrative == null) throw new Error("a part of the state could not be read");
    atomicWrite(postRepairStatePath(runDir), JSON.stringify({ ts: new Date().toISOString(), findings, narrative: base.narrative,
      accepted: base.accepted, fold: snapshotFold(runDir) }) + "\n");
    return true;
  } catch (e) {
    try { rmSync(postRepairStatePath(runDir), { force: true }); } catch { /* nothing to remove */ }
    runLog(runDir, { event: "post-repair-state-not-kept", reason: String(e?.message ?? e).slice(0, 160) });
    return false;
  }
}

/**
 * THE LAST RECORD A SAVE PASSED, rebuilt through the driver's own acceptance: the save the review read (`before`), then
 * the save kept from before the delivery-check repair (sources 3 and 4 of `trustedStateBeforeCorrection`, with the
 * same duty rule). Null when neither stands. Never throws.
 */
function recordFromTheSaves(Pv, runDir, before) {
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  const reads = (() => { try { return driverReadsFor(runDir); } catch { return null; } })();
  const fromSave = (params, accepted, from) => {
    if (!params || accepted == null || !reads) return null;
    const accept = (r) => { try { return acceptSynthesis(params, r); } catch { return null; } };
    let v = accept(reads), duty = "current", refused = null;
    if (!v?.ok && reads.owed != null) {
      refused = v?.reason ?? null;
      const w = accept({ ...reads, owed: null, declined: null });
      if (w?.ok) { v = w; duty = "relaxed"; }
    }
    if (!v?.ok || typeof v.findings !== "string" || typeof v.narrative !== "string") return null;
    const h = sha(v.findings);
    return { raw: v.findings, sha: h, model: { raw: v.findings, sha: h }, fold: null, base: { accepted, narrative: v.narrative }, from, duty,
      ...(duty === "relaxed" ? { refusedUnderCurrentDuty: String(refused ?? "").slice(0, 160) } : {}) };
  };
  const bytes = (at) => { try { return readFileSync(at, "utf8"); } catch { return null; } };
  return fromSave(before, snapshotSynthesisBase(runDir).accepted, "accepted-save")
    ?? fromSave(readRepairBase(runDir), bytes(repairBasePath(runDir)), "save-before-the-repair");
}

/**
 * A FINDINGS RECORD BROKEN AFTER SYNTHESIS PASSED IT IS RESTORED AT DELIVERY, NOT ENDED ON. The delivery checks
 * find the record broken at the top level, so a write after synthesis broke it. The record comes back from the
 * last save that passed, by the corrective rollback's own search (`recordFromTheSaves`): the save the review read, then
 * the save kept from before the delivery-check repair. It is folded, and given the seam's writes, as after any save, and
 * the check runs again on the record that now stands. The broken record is kept under `_driver/` as evidence. Returns
 * {from, duty}, or null where no save stands or the record restored fails the check too. IMPURE (writes the run).
 */
async function restoreTheRecordThatPassed(ctx, P, runDir, check) {
  const pre = recordFromTheSaves(P, runDir, lastAcceptedCall(runDir));
  if (!pre?.raw) return null;
  try { copyFileSync(P.findings, paths(runDir).findingsBrokenAtDelivery); } catch { /* the evidence is best-effort */ }
  writeFindings(runDir, pre.raw, { why: "record-that-passed-restored", settles: [] });
  restoreSynthesisBase(runDir, pre.base);
  try { foldAfterSave(runDir, P.findings); } catch (e) { note(`[core-artifact] the restored record could not be folded (${String(e?.message ?? e).slice(0, 100)})`); }
  try { await ctx.afterSynthesisSave?.(); } catch (e) { note(`[core-artifact] the seam's writes could not be made again over the restored record (${String(e?.message ?? e).slice(0, 100)})`); }
  try { check(readFileSync(P.findings, "utf8")); } catch { return null; }
  return { from: pre.from, duty: pre.duty ?? "current" };
}

// A correction row's outcomes that say the pass changed the record or the narrative (corrections-feedforward.mjs).
const CORRECTION_CHANGED = new Set(["section-changed", "line-removed", "line-changed", "findings-removed", "findings-changed"]);

/**
 * THE CORRECTIONS A RECORD RESTORED FROM THE SAVE BEFORE THE REPAIR DOES NOT CARRY: what the correction after the review
 * of that repair changed, by the names its points targeted. The corrections' state is judged once, when the correction
 * runs, so nothing else would see that the restored record predates it. Written as that state, the client gate's
 * "findings-stale" reason closes the client export over it, as when a correction did not reach the findings. [] when
 * the record came from the accepted save, or no correction after the repair changed anything. Never throws.
 */
export function correctionsTheRestoreLacks(runDir, from) {   // @internal
  if (from !== "save-before-the-repair") return [];
  try {
    const rec = JSON.parse(readFileSync(postRepairCorrectionsPath(runDir), "utf8"));
    const named = (r) => (Array.isArray(r.targets) && r.targets.length ? r.targets : [(rec.classes ?? []).find((c) => c?.n === r.n)?.target]);
    return [...new Set((rec.rows ?? []).filter((r) => CORRECTION_CHANGED.has(r?.outcome)).flatMap(named)
      .map((t) => String(t ?? "").trim()).filter(Boolean))];
  } catch { return []; }
}

function sentinel(runDir, name, obj) {
  // B5 — sentinels gate resume/delivery decisions: a truncated one must never be visible (tmp + rename).
  atomicWrite(join(runDir, name), JSON.stringify({ ts: new Date().toISOString(), ...obj }, null, 2) + "\n");
}

/**
 * Settle every queued what-if BEFORE the run dir moves into the archive.
 *
 * A queued job lives under the run directory, and the worker enumerates candidates with `liveRunDirs`,
 * which skips `archive` outright. So archiving carried a pending job out of the worker's reach: not
 * claimed, not settled, not refused. The client who asked for it got no answer and no explanation, and
 * no row anywhere said why. That is an absence reported as nothing at all — the one shape
 * `whatIfRefusal` exists to prevent.
 *
 * BEFORE the rename, deliberately: the settlement is written into the run dir and travels with it, so
 * the answer is on disk in the archive where the read tool will look for it.
 *
 * ✕ THE SENTENCE IS PER KIND, and a memo does not get the stage one. `whatIfRefusal`'s standing
 * refusal — "this run is delivered or archived, what-if runs on live runs only" — is TRUE of a stage
 * and FALSE of a memo, which runs on archived evidence by design. Telling a client their memo was
 * refused because the run is archived would be a false sentence in the one place they go to find out
 * what happened. A memo is closed on the true reason instead: it was queued before the run archived,
 * and the drain does not reach an archived run.
 *
 * ✕ A JOB ANOTHER WORKER IS ACTIVELY RUNNING IS LEFT ALONE. `pendingWhatIf` returns queued jobs and
 * claims older than an hour, never a fresh claim, so a live worker's job is not settled underneath it.
 * A fresh claim at the moment of archiving is a race this does not close, and it is written down
 * rather than papered over.
 *
 * Best-effort throughout: a failure to settle must never stop the archive, because a run that cannot
 * archive is a much larger problem than a job with no row.
 */
export function settlePendingWhatIfsBeforeArchive(run) {   // @internal
  let pending = [];
  // NOT a silent catch. This function exists because a job went unanswered with no row anywhere; a
  // failure to enumerate that returned quietly would reproduce exactly that, one level up, and the
  // archive would still succeed so nothing downstream would look wrong.
  try { pending = pendingWhatIf(run.runDir); }
  catch (e) { note(`what-if settle before archive could not enumerate the queue (${String(e?.message ?? e).slice(0, 120)}) — pending jobs may be unanswered`); return; }
  for (const entry of pending) {
    try {
      // CLAIM FIRST, exactly as the worker does. `finishWhatIf` writes the terminal file and does not
      // remove the `.json`; the claim is what renames it out of the queue. Settling without claiming
      // writes a `.failed` beside a `.json` that still reads as QUEUED to every reader — the job would
      // look pending and answered at the same time, which is worse than the silence being fixed here.
      const job = claimWhatIf(entry);
      if (!job) continue;                     // another worker won it, or it vanished — not ours to settle
      const kind = job?.op?.kind === "memo" ? "memo" : "stage";
      // ✕ THE SENTENCE IS PER KIND. The standing refusal — "what-if runs on live runs only" — is TRUE
      // of a stage and FALSE of a memo, which reasons over archived evidence by design. A memo is
      // closed on the true reason instead.
      const error = kind === "memo"
        ? "this what-if was queued before its run was archived, and the drain does not reach an archived run — ask it again against the archived run, which a memo may read"
        : (whatIfRefusal({ location: "archive", state: run.state ?? null, kind }) ?? "this run is delivered or archived — what-if runs on live runs only");
      finishWhatIf(run.runDir, entry.id, { ok: false, op: job.op ?? null, error });
      try { runLog(run.runDir, { event: "whatif-settled-on-archive", id: entry.id, kind, stale: entry.stale }); }
      catch { /* the row is written; the log line is a convenience and must not undo it */ }
    } catch (e) {
      // One job's settlement must not cost the others, or the archive — but it must not be SILENT
      // either. A swallowed failure here leaves exactly the unanswered job this function exists to
      // prevent, and the archive still succeeds, so nothing downstream looks wrong.
      note(`what-if ${entry.id} could not be settled before archive (${String(e?.message ?? e).slice(0, 120)}) — it may be unanswered`);
    }
  }
}

function archive(run) {
  try {
    settlePendingWhatIfsBeforeArchive(run);
    mkdirSync(dirname(run.archiveDir), { recursive: true });
    renameSync(run.runDir, run.archiveDir);
    return run.archiveDir;
  } catch (e) {
    note(`archive failed (non-fatal): ${e.message}`);
    return null;
  }
}

// Deterministically inject/replace fields into a markdown file's YAML front-matter — the DRIVER writes these
// fields, never the LLM. Idempotent; string values are JSON-quoted for YAML safety. No-op if the file has no
// front-matter block. (It was introduced for the WS1c failover stamp; that stamp is deleted with the chain,
//, and every surviving caller — the verdict labels, the scope line, rated_under, the project/origin
// disclosure — is a compute-don't-author field with a live source.)
// `runDir` (P2): the driver-owned front matter is a DECORATION applied after the report is assembled —
// the derived verdict labels, the scope line, rated_under. Consumers that declare report.md as an input
// (report-overview / report-card) are written from its BODY and never derive anything from these
// fields, and the injection happens after they are drafted (and again after any lint redo), so leaving it
// to read as staleness would strand the run: a mismatch with no recompute path that can settle it.
// Re-stamping says "this change is accounted for". Deliberately NOT done for the findings.json mutators
// — those SHOULD invalidate their consumers (that is the whole fix), and they run before the drafting
// stages, so one recompute settles them.
function injectFrontMatter(path, fields, runDir = null) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return false; }
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return false;
  let body = m[1];
  for (const [k, v] of Object.entries(fields)) {
    // plain, single-line value (matches the existing handling_note convention; parseFront splits on the
    // FIRST ':' only, so internal colons in stage labels like "register-unit:primary-sweep" survive intact).
    const line = `${k}: ${String(v).replace(/\r?\n/g, " ").trim()}`;
    const re = new RegExp(`^${k}:.*$`, "m");
    body = re.test(body) ? body.replace(re, line) : `${body}\n${line}`;
  }
  atomicWrite(path, `---\n${body}\n---\n${text.slice(m[0].length)}`);   // B5 — never a half-written report.md visible
  if (runDir) restamp(runDir, path, { project: projectStageInput });
  return true;
}

// spec 62 — the per-field CONFIGURATION PROVENANCE rows for a project run: for each PROJECT_KEY, its effective
// value (compact) and where it came from (project | customer | house). Read off the frozen sidecar `pr` (both
// origins and the effective values live there), serialised to a single-line JSON string for the report
// front-matter. It was rendered internal-only in the scope fold; the 2026-09-16 redesign takes that fold
// off the page, and this row set went with it — it was the one block in there labelled internal, which is
// the class that ruling removed. IT IS STILL RECORDED, here and in the workbook, which is where a reader
// who wants to know which layer set a knob now finds out. Absent origins ⇒ [] ⇒ nothing injected.
function originRowsForReport(pr) {
  if (!pr?.origins) return [];
  const short = (s, n = 48) => { const t = String(s ?? "").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const spec = {
    platforms:            ["Marketplaces",          (v) => `${(v ?? []).length} store${(v ?? []).length === 1 ? "" : "s"} + web`],
    defaultClasses:       ["Default classes",       (v) => (v ?? []).length ? v.join(", ") : "—"],
    defaultJurisdictions: ["Default jurisdictions",  (v) => (v ?? []).length ? v.join(", ") : "—"],
    marketplaceDensity:   ["Marketplace density",   (v) => v ?? "sparse"],
    delivery:             ["Delivery format",       (v) => v ? `${v.email ?? "summary"}${v.privileged ? ", privileged" : ""}` : "summary"],
    riskAppetite:         ["Risk posture",          (v) => (v && String(v).trim()) ? "set" : "—"],
    industry:             ["Sector",                (v) => (v && String(v).trim()) ? short(v) : "—"],
  };
  const rows = [];
  for (const f of ["platforms", "defaultClasses", "defaultJurisdictions", "marketplaceDensity", "delivery", "riskAppetite", "industry"]) {
    const origin = pr.origins[f];
    if (!origin) continue;
    rows.push({ field: spec[f][0], value: short(spec[f][1](pr[f]), 60), origin });
  }
  return rows;
}

// ── B1: per-finding report assembly (report confabulation fix) ───────────────────────────────────────────
// report.md is no longer ONE LLM pass over every card (that cross-contaminated cards). report-overview writes
// the shell; report-card renders ONE card per finding in isolation; the driver assembles deterministically.

// Parse findings.json for the per-card render ([] when absent/malformed — a clean run still ships a shell).
/**
 * — READ THE FINDINGS, AND NEVER REPORT A REJECTION AS AN ABSENCE.
 *
 * This returned `[]` on any parse failure, justified by a comment saying a malformed findings.json had
 * already failed validators.narrative upstream. That stopped being true. findings.json is rewritten by the
 * corrective and lint-repair loops LONG after narrative validation — on R1 PROJECT SABLE it was written at
 * 15:59:42Z, and stale-repair read it twenty seconds later with no validation in between.
 *
 * What the run then said was false in the most expensive possible way. `parseFindingsJson` threw on
 * `finding_action_condition_on_advisory:16`; the catch turned 31 findings into zero; every one of 26 cards
 * took the `!f` branch and reported "has no full-prose finding in the current findings.json"; the delivery
 * guard blocked; the run parked at delivery at 3h35m, burning recovery lane 2 of 3. The findings were
 * there. `parseFindingsJsonLenient` reads that same file cleanly.
 *
 * So the two questions are separated, because they have different answers:
 *
 *   · CAN THE CARDS BE JOINED? Yes — the join needs ordinals, and the lenient reader has them. A card is
 *     declared stale-and-unrepairable only when its finding is genuinely absent, never when a sibling
 *     finding tripped a semantic rule.
 *   · IS THE FILE VALID? No — and that is a real defect that must not be laundered into a clean delivery.
 *     It comes back as `rejected`, the caller says so with the validator's own token, and the delivery
 *     guard still refuses. The run is blocked for the reason it is actually blocked for.
 *
 * Returns {findings, rejected} — `rejected` is null when the file parsed strictly (or is absent), otherwise
 * the validator's message. An absent file is NOT a rejection: no findings is a legitimate state.
 */
// EXPORTED for scripts/write-up-form-census.mjs ( design question 4): a census that reimplemented
// this would lose the LENIENT fallback below and report zero findings on exactly the runs where the card
// loop joined many. The census must count the population the pipeline counts, not a similar one.
export function readFindingsForReport(P) {
  if (!existsSync(P.findings)) return { findings: [], rejected: null };
  let raw;
  try { raw = readFileSync(P.findings, "utf8"); }
  catch (e) { return { findings: [], rejected: `unreadable: ${String(e.message).slice(0, 120)}` }; }
  try { return { findings: parseFindingsJson(raw).findings ?? [], rejected: null }; }
  catch (e) {
    // The strict parser refused. Fall back to the lenient reader for the JOIN only — it is the same file,
    // and a finding whose ordinal is readable can still have its card matched. If even that fails the file
    // is genuinely unusable and zero findings is the honest answer.
    let findings = [];
    try { findings = parseFindingsJsonLenient(raw).findings ?? []; } catch { /* genuinely unusable */ }
    return { findings, rejected: String(e.message).replace(/\s+/g, " ").slice(0, 200) };
  }
}
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

// ── — coverage_judgment.rows IS WRITTEN BY THE DRIVER ────────────────────────────────────────
//
// The dictation used to invite the stage to author "one typed row per slice you weighed". So the rows
// that name which slices are open — the exact facts a reader checks a sufficiency call against — were
// prose the model retyped out of a ledger it had not been shown. That is the transcription
// contract one artifact over: an identifier the seat was never handed is one it can never name, and one
// it retypes is one it can mistype.
//
// The driver holds both sources. The rows are DERIVED from them and stamped in; what the model supplies
// is the part that is judgment and cannot be derived — `sufficient` and the `reason` for it.
//
// TWO SOURCES, ONE ROW SET:
//   · every coverage-ledger row that is NOT `confirmed-clean` — the slices the funnel itself says it did
//     not close. A confirmed-clean row needs no disclosure row; it IS the absence of one.
//   · every qid the plan-execution receipt lists MISSING — a planned query with no band block at all.
//     These have no ledger row of their own, and they are the  class exactly: the search that never
//     ran, which nothing downstream could see from the ledger alone.
//
// WHY A STAMP AND NOT A REFUSAL. A validator throw on model-authored rows would have to fire on the
// archive too: findings-model's own contract is that `coverage_judgment` stays "a deliberately-loose
// passthrough object (archived shapes must keep parsing forever)", and `replay-archive.mjs` republishes
// real matters through that parser. Version-gating the throw is not available either — the schema bump
// is one PR with one owner. And a refusal buys a paid corrective turn to delete a key the driver is
// about to overwrite anyway. So the field simply stops being the model's: authored rows are replaced
// wholesale and the replacement is logged, the same posture `ask_answers` and the card's `- group:` line
// already take.
//
// ABSENT STAYS ABSENT. A run whose synthesis emitted no `coverage_judgment` at all does not get one
// invented here — `sufficient` is the lawyer's call and a fabricated one would clamp, or fail to clamp,
// a verdict on nobody's judgment. The absence is logged instead.
//
// RUNS AT THE POST-SYNTHESIS MUTATOR SEAM, for injectDeferralCoverage's stated reason: after every
// synthesis re-run has settled, so a re-emit cannot clobber it. Never-kill — any defect leaves
// findings.json untouched, and the ledger and receipt still reach the reader by their own surfaces.
// ONE SLICE, ONE ROW. The two sources overlap: an axis whose owner probe produced no band block gets a
// `deferred` LEDGER row saying so AND a MISSING qid saying the same thing, and `projectCoverageJudgment`
// concatenates rows into one internal line — so an un-joined row set reads the same fact twice in two
// vocabularies, which is precisely what the stage's own COVERAGE PROSE rule forbids ("state each
// coverage fact ONCE, in ONE place").
//
// THE JOIN IS THE RECEIPT'S OWN, never a guess off the qid string. `skeleton[].missing` is the
// code-derived axis→missing-qid map (deriveCoverageSkeleton groups by the plan entry's `axis`), and the
// qid prefix is NOT the axis — supplemental and cross-check entries carry `supp:` / `xcheck-` prefixes.
// A missing qid whose axis already owns an open ledger row is named ON that row; a missing qid on an
// axis with no open row still gets its own, because nothing else would disclose it.
//
// A receipt with no skeleton (an archived, pre-skeleton shape) has no axis map, so every missing qid
// gets its own row — the pre-join behaviour, which over-discloses rather than under-discloses.
// review — WHAT THE ROW CALLS ITS SLICE, on the one shape where the ledger's own identifier says
// less than it looks like it says.
//
// `rows[].area` used to be the lawyer's named slice, in the stage's LAWYER ENGLISH register. It is now
// driver-derived, which is the point of this build — but `projectCoverageJudgment` folds these rows
// into the coverage reason and render.mjs prints that in report.html, so whatever goes here is read by
// a client, not just by a gate.
//
// A ledger unit is built as `<axis> / <scope>` and collapses to the BARE AXIS when the row carries no
// scope (coverage-ledger.mjs: `unit: scope ? ... : axis`). On that shape the reader was handed a lone
// engine token — "transliteration-numeric" — with nothing saying whether it meant one slice of the axis
// or all of it. That is the one branch where the machine's exact identifier is less informative than
// what it replaced, so it is the only branch that changes: the scope is stated, in the row's own terms.
//
// NOT a token→prose lookup table. An axis→label map would be a second vocabulary to keep in step with
// REGISTER_AXES, and the qid/axis identifiers ride verbatim everywhere else in this file by design —
// they are what a reader matches back to the ledger. PURE.
// ONE ASSEMBLY, TWO SPELLINGS. `unitText` is what the caller wants printed; the SCOPE TEST is always
// against the raw unit, so the identifier and the label decorate identically and cannot drift apart.
// The scopeless decoration differs on purpose: "(entire axis)" names the machine's unit for a gate,
// "(all of it)" says the same thing to a reader who has no axes.
function coverageRowAreaFrom(axis, unit, unitText, scopeless) {
  const a = String(axis ?? "").trim();
  const u = String(unit ?? "").trim();
  if (!u) return a;
  if (!a) return unitText;
  return u.toLowerCase() === a.toLowerCase() ? `${unitText} ${scopeless}` : unitText;
}

export function coverageRowArea(axis, unit) {   // @internal
  return coverageRowAreaFrom(axis, unit, String(unit ?? "").trim(), "(entire axis)");
}

// — the reader's half of the same answer. `area` is the identifier a gate joins on and does not
// move; `areaLabel` is what the page prints. Emitted here, at the one place the area is minted, so
// nothing downstream has to recognise an axis token inside a string it was handed — which is the
// mechanism that ate the mark AXIS. null when the identifier is already plain English: three
// driver injectors write areas like "Follow-up / …", and a label repeating them would be noise.
export function coverageRowAreaLabel(axis, unit) {   // @internal
  const u = String(unit ?? "").trim();
  const labelled = coverageUnitLabel(u);
  if (!u || labelled === u) return null;
  return coverageRowAreaFrom(axis, unit, labelled, "(all of it)");
}

// A LAYER ROW NAMES EVERY REGISTER IT LEFT, FROM ITS RECEIPT. The machine ledger keeps a row's axis, status
// and reason, not its receipt, so the coverage form's layer row is found again by those three: the ledger is
// rendered from the form, and they are the form row's own. A match must be one form row to one ledger row; any
// other count leaves the row as it was. Its label is the territory's: the unit has no scope, so the axis's label
// would say the whole main sweep stood open.
const normReason = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
function layerRowNotes(ledgerRows, formRows) {
  const keyOf = (r) => `${String(r?.axis ?? "").trim().toLowerCase()}\u0000${String(r?.status ?? "").trim().toLowerCase()}\u0000${normReason(r?.reason)}`;
  const ledgerCount = new Map();
  for (const r of ledgerRows ?? []) ledgerCount.set(keyOf(r), (ledgerCount.get(keyOf(r)) ?? 0) + 1);
  const byKey = new Map();
  for (const f of (formRows ?? []).filter(isLayerRow)) {
    const k = keyOf(f);
    byKey.set(k, byKey.has(k) ? null : f);
  }
  const notes = new Map();
  for (const [k, f] of byKey) {
    if (!f || ledgerCount.get(k) !== 1) continue;
    const note = nationalRegistersNote(nationalRegistersNotSearched(f.receipt_reason));
    const territory = orderFormName(String(f.unit ?? "").split(" — ")[0]);
    if (note && territory) notes.set(k, { note, areaLabel: `${territory}: national registers` });
  }
  return { keyOf, notes };
}

export function coverageJudgmentRows(ledgerRows, planExecution, plan = null, formRows = null) {   // @internal
  const open = [];
  const layers = layerRowNotes(ledgerRows, formRows);
  for (const r of ledgerRows ?? []) {
    // `withheld-by-judgment` joins `confirmed-clean` in NOT reaching the reader, and for the opposite
    // reason. A clean row has nothing to disclose. A withheld one has something to say, and it is
    // ruled to belong in the run record and the coverage ledger only: nothing is added to the report
    // (owner, 2026-09-18). A family the reading turn chose not to open, having read the identical question as
    // a list and found what it needed, is not a gap in the client's search — it is where the work was
    // spent — and a row saying otherwise would read to a lawyer as an incomplete job.
    const status = String(r?.status ?? "").toLowerCase();
    if (!r || status === "confirmed-clean" || status === "withheld-by-judgment") continue;
    const reason = String(r.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const axis = String(r.axis ?? "").toLowerCase();
    const layer = layers.notes.get(layers.keyOf(r));
    open.push({ axis, area: coverageRowArea(axis, r.unit),
      areaLabel: layer ? layer.areaLabel : coverageRowAreaLabel(axis, r.unit),
      note: `${r.status}${layer ? ` — ${layer.note}` : reason ? ` — ${reason}` : ""}`, qids: [] });
  }
  const skeleton = Array.isArray(planExecution?.skeleton) ? planExecution.skeleton : null;
  const axisOf = new Map();
  for (const s of skeleton ?? []) for (const q of s?.missing ?? []) axisOf.set(String(q), String(s.axis ?? "").toLowerCase());
  const claimed = new Set();
  for (const qid of Array.isArray(planExecution?.missing) ? planExecution.missing : []) {
    const q = String(qid ?? "").trim();
    if (!q) continue;
    const host = axisOf.has(q) ? open.find((o) => o.axis === axisOf.get(q)) : null;
    if (host) { host.qids.push(q); claimed.add(q); }
  }
  // A claimed qid is printed nowhere: the plan-execution receipt keeps it for every gate to join on, and a
  // row a lawyer reads names its slice, never an engine identifier (ruled 2026-10-01). One row per slice.
  const rows = open.map((o) => ({ area: o.area, ...(o.areaLabel ? { areaLabel: o.areaLabel } : {}),
    note: o.note }));
  for (const qid of Array.isArray(planExecution?.missing) ? planExecution.missing : []) {
    const q = String(qid ?? "").trim();
    if (q && !claimed.has(q)) rows.push({ area: q, ...orphanAreaLabel(q, axisOf.get(q), plan), note: "planned and not executed this run" });
  }
  return rows.filter((r) => r.area && r.note);
}

// A COVERAGE ROW THAT WAS NOT ADDED. Each adder below catches its own failure and the run goes on (ruled 2026-09-25:
// deliver, and flag in the audit what still failed), so the row it exists to add is missing from the report and
// the workbook. Its note is the run's own line; this event is what delivery reads (degraded-parts.mjs, coverageRows),
// so the audit workbook names the part. It never throws from the catch that calls it.
function coverageRowNotAdded(runDir, adder, e) {
  try { runLog(runDir, { event: "coverage-row-not-added", adder, fail: String(e?.message || e).replace(/\s+/g, " ").slice(0, 200) }); }
  catch { /* the note the caller wrote still stands */ }
}

export function stampCoverageJudgmentRows(P, runDir, note, ctx) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    const cj = doc?.coverage_judgment;
    if (!cj || typeof cj !== "object" || Array.isArray(cj)) {
      runLog(runDir, { event: "coverage-judgment-rows", judgment: false, reason: "synthesis emitted no coverage_judgment — none is invented here" });
      return;
    }
    const rows = coverageJudgmentRows(loadCoverageLedger(runDir).rows, readPlanExecution(ctx), ctx?.registerPlan ?? null,
      readCoverageForm(runDir).rows);
    const discarded = Array.isArray(cj.rows) ? cj.rows.length : 0;
    const next = { ...doc, coverage_judgment: { ...cj } };
    if (rows.length) next.coverage_judgment.rows = rows;
    else delete next.coverage_judgment.rows;
    // The row is written BEFORE the early return, deliberately: "the derived set already matched" and
    // "this never ran" are different facts, and a journal that records only the first of them cannot
    // tell a reader which one happened on a run where rows[] came out empty.
    const changed = JSON.stringify(next) !== JSON.stringify(doc);
    runLog(runDir, { event: "coverage-judgment-rows", judgment: true, rows: rows.length, discarded, changed });
    if (!changed) return;                                           // already exact — leave the bytes alone
    parseFindingsJson(JSON.stringify(next));                        // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, next, { why: "coverage-judgment-rows", settles: [] });
    note(`[coverage-judgment] rows[] written from the ledger + the plan-execution receipt: ${rows.length} open slice(s)${discarded ? `; ${discarded} authored row(s) replaced` : ""}`);
  } catch (e) {
    note(`[coverage-judgment] rows[] stamp skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "coverage-judgment", e);
  }
}

export function injectDeferralCoverage(P, runDir, note) {   // @internal — exported so a second pass is testable without a run
  try {
    const rp = paths(runDir).frameReopenReceipt;
    if (!existsSync(rp) || !existsSync(P.findings)) return;
    const receipt = JSON.parse(readFileSync(rp, "utf8"));
    const deferrals = receipt?.deferrals ?? [];
    if (!deferrals.length) return;
    const kinds = followUpKinds(receipt);   // the search each deferred directive recorded (follow-up-twins.mjs)
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    // T1 (G8): a findings.json without a coverage array must not silently LOSE the deferral
    // rows — the reader-visible disclosure is the whole point of "can't close → disclose".
    if (!Array.isArray(doc.coverage)) doc.coverage = [];
    const normTxt = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    // A row may stand in for this one only as the report page lets it (`dedupeFollowUps`, publish/render.mjs): the
    // driver's own row, or the writer's row restating the gap. A searched-clean row reports the opposite, and an
    // axis-labelled one ("Register / …") is a plan unit that may only share the words.
    const standsIn = (c) => String(c.area ?? "").startsWith("Follow-up / ")
      || (c.state !== "confirmed-clean" && !/\s\/\s/.test(String(c.area ?? "")));
    const wordsOf = (c) => new Set(normTxt(`${c.area} ${c.note ?? ""}`).split(" "));
    const rows = doc.coverage.filter(standsIn).map(wordsOf);
    let added = 0;
    for (const d of deferrals) {
      const directive = String(d?.directive ?? "").trim();
      if (!directive) continue;
      // THE WORDS ARE THE ONES A ROW CARRIES, AND ONE ROW CARRIES ALL OF THEM. A directive is minted with its axis prefix
      // ("source:…"), and every row, this function's own included, prints it through `plainDirective`. This looked
      // for the raw directive's first four long words as one phrase across the whole coverage: the prefix was the
      // first of them, and a short word between two others ("eu", "and") broke the phrase anyway, so no row matched,
      // not even the row this function had just added. Each seam pass added it again: twice over in a record, and
      // back after a save that removed it. Measured on two test runs, 2026-11-03: 9 of 9 directives carried the
      // prefix, and 4 of one run's 7 a short word between their long ones.
      const want = normTxt(plainDirective(directive)).split(" ").filter((w) => w.length >= 4).slice(0, 4);
      if (want.length && rows.some((ws) => want.every((w) => ws.has(w)))) continue;   // synthesis already weighed it in
      const row = deferralCoverageRow(directive, d?.reason);   // — word-boundary heading, full directive in the note
      // An axis-labelled row stands in only on the search the run recorded for this directive, as the page decides.
      if (axisTwin(plainDirective(directive), kindsForFollowUp(row, kinds), doc.coverage.filter((c) => !String(c.area ?? "").startsWith("Follow-up / ")))) continue;
      doc.coverage.push(row);
      rows.push(wordsOf(row));
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "deferral-coverage-rows", settles: [] });   // B5 — a crash mid-write must never leave a truncated findings.json
    note(`[frame-reopen] injected ${added} deferral coverage row(s) — the reader sees every unclosed directive`);
  } catch (e) {
    note(`[frame-reopen] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "frame-reopen", e);
  }
}

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
const WORLDWIDE_SCOPE_RE = /^(worldwide|global|all|all[- ]jurisdictions)$/i;
/** What a synthesis-authored Stage-1.5 coverage row looks like when it has ALREADY made this
 *  disclosure — see the suppression in injectScriptScopeCoverage. Both the current vocabulary and the
 *  retired one, because a resumed run carries whichever was current when its synthesis ran. */
const SCRIPT_SCOPE_RECOMMENDATION_TOKENS = Object.freeze(["native-language investigation", "clearance-jx"]);

/** The disclosure vocabulary for ONE candidate lane, derived (never tabulated). Returns
 *  `{area, note, territories, marker}` — `marker` is the lowercased script prefix the suppression
 *  check keys on. Null for a lane with no LANGUAGE_LANES spec or no territory routed to it. PURE. */
export function scriptScopeDisclosure(lane) {   // @internal
  const spec = LANGUAGE_LANES[lane];
  if (!spec) return null;
  const prefix = String(spec.label ?? "").replace(/\s*deepening\s*$/i, "").trim();   // "Chinese-script"
  const territories = Object.entries(JURISDICTION_ADAPTERS).filter(([, v]) => v?.lane === lane).map(([k]) => k);
  if (!prefix || !territories.length) return null;
  return {
    area: `${prefix} register equivalents (${territories.join(" / ")})`,
    note: `${prefix} same-meaning/phonetic register equivalents not searched on this search — ${NATIVE_LANGUAGE_REMEDY}`,
    territories, marker: prefix.toLowerCase(),
  };
}

/** Several script lanes' rows as one, in the approved words: the lanes' names and their territories joined, the
 *  sentence and the offer once. PURE. */
export function mergedScriptScopeRow(lanes, state = "coverage-limited") {   // @internal
  const parts = lanes.map((lane) => scriptScopeDisclosure(lane)).filter(Boolean);
  const names = parts.map((d) => d.area.replace(/\s*register equivalents\s*\(.*\)$/, ""));
  const joined = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return {
    area: `${joined} register equivalents (${parts.flatMap((d) => d.territories).join(" / ")})`,
    state,
    note: `${joined} same-meaning/phonetic register equivalents not searched on this search — ${NATIVE_LANGUAGE_REMEDY}`,
  };
}

/** The pure decision: should the honesty row be injected, and what row. Exported for the unit tests.
 *  `scope` is the requested-territory list (jxScopeJurisdictions precedence: instructed wins, else
 *  profile defaults); the zh match is EXACTLY the codes decideJxLanes would have matched with the lane
 *  bought (the honest question is "would the zh lane have fired on this scope"), plus the worldwide shapes.
 *  `laneDepthOff`: customer config always wins (the golden rule) — a customer who configured
 *  jxPolicy.laneDepth.zh "off" has already declined the lane; re-advertising it on every report
 *  would nag against their own config. */
export function decideScriptScopeHonesty({ lane = "zh", scope = [], laneRan = false, laneDepthOff = false } = {}) {   // @internal
  if (laneRan || laneDepthOff) return null;
  const d = scriptScopeDisclosure(lane);
  if (!d) return null;
  const toks = (scope ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  // Matched on the LANE, not on mere table membership: JURISDICTION_ADAPTERS carries all three lanes,
  // and a Japan-only scope owes a Japanese-script row and NOT a Chinese-script one. That per-lane
  // filter was always the right shape — it was simply only ever asked about zh.
  const laneHit = toks.some((t) => JURISDICTION_ADAPTERS[t]?.lane === lane);
  const worldwide = toks.length === 0 || toks.some((t) => WORLDWIDE_SCOPE_RE.test(t));
  if (!laneHit && !worldwide) return null;
  return { area: d.area, state: "coverage-limited", note: d.note };
}

/** The zh-bound form, kept because it is the name the existing callers and tests use. Delegates —
 *  there is one decision, not two. PURE. */
export function decideZhScopeHonesty(opts = {}) {   // @internal
  return decideScriptScopeHonesty({ ...opts, lane: "zh" });
}

/** Did the zh candidate lane actually RUN on this run? Mirrors the jx-units gating legs exactly
 *  (jx-units.mjs runJxSerpGrid/runJxNativeread): the frozen policy must carry the jxLanes component
 *  (the product carries the native-language investigation, or a saved search bought it), at least one of
 *  the two unit switches must be on, and the frozen lane decision
 *  sidecar must carry the zh lane. Any leg missing ⇒ the lane did not run (a product without the
 *  investigation, or no lane in the frozen decision) — the honesty row is owed. Reads the SIDECAR rather than ctx.jxLanes: at delivery
 *  time on a resume the fold block may never have re-attached it, and the frozen decision on disk is
 *  the single authority anyway.
 *
 *  THIS IS NOT A GATE — it decides whether a CLIENT REPORT carries a row saying the Chinese lane was
 *  not searched, so both directions are a statement of fact and both can be wrong. When the
 *  CLEAROTRON_JX_LANES master leg was retired (2026-07-27) neither naive option was safe: deleting the env
 *  legs outright would report "ran" from a frozen lane DECISION alone, suppressing the disclosure on a
 *  run whose units never executed; keeping a leg on a variable nothing sets any more would read false
 *  forever and tell every client the lane did not run, including the runs where it did. So the legs
 *  track what the units themselves check, which is what "mirrors the jx-units gating legs" has to mean. */
export function scriptLaneRanOnRun(runDir, lane, { searchPolicy = null } = {}) {   // @internal
  if (!searchPolicy?.components?.jxLanes) return false;
  let sidecar = null;
  try { sidecar = JSON.parse(readFileSync(paths(runDir).jxLanes, "utf8")); }
  catch { return false; }   // sidecar absent/corrupt ⇒ no frozen lane decision ⇒ the lane did not run
  if (!sidecar?.lanes?.[lane]) return false;
  // WHAT "RAN" MEANS IS PER-LANE, and this is a rule table rather than a parameter because the lanes
  // genuinely shipped with different units — pretending one predicate covers all three would be the
  // kind of false generalisation that reads correct and answers wrong.
  //   zh  — shipped the full Phase-4 deepening: the SERP platform grid and the native read. Either
  //         unit running IS the lane running (they gate independently; one on and one off still
  //         searched in Chinese), so the legs stay exactly as they were.
  //   ja/ko — shipped as slice-1 CANDIDATE lanes only (LANGUAGE_LANES declared in jx-lanes.mjs): no SERP_LANES entry, so
  //         runJxSerpGrid hard-refuses them and neither unit flag can ever describe them. The only
  //         work these lanes do is the candidate fold, so "ran" is the fold having ACCEPTED
  //         candidates — a frozen lane decision with an empty fold searched nothing and owes the row.
  if (lane === "zh") {
    // item 8 — the two env legs are gone, and this is the replacement the comment above demands
    // rather than the naive option it warns against. Deleting them outright WOULD have reported "ran"
    // from the frozen lane decision alone. So the legs move from what was CONFIGURED to what HAPPENED:
    // a unit record stating done. That is the same shape the ja/ko branch below already uses (a fold
    // with accepted candidates), and it is strictly better evidence than an environment variable —
    // a box with the arm set and the unit never dispatched used to read "ran".
    let units = null;
    try { units = JSON.parse(readFileSync(driverDir(runDir, "jx", "units.json"), "utf8")); }
    catch { return false; }   // no unit record ⇒ nothing establishes that either unit ran
    const done = (k) => units?.units?.[k]?.done === true;
    return done("serp-grid:zh") || done("nativeread:zh");
  }
  return (sidecar?.fold?.lanes?.[lane]?.accepted ?? []).length > 0;
}

/** The zh-bound form, kept for the existing callers and tests. PURE apart from the sidecar read. */
export function zhLaneRanOnRun(runDir, opts = {}) {   // @internal
  return scriptLaneRanOnRun(runDir, "zh", opts);
}

/** The sibling of injectDeferralCoverage: same call point, same never-kill + re-validate + atomic-write
 *  discipline, same "the reader always gets the row" purpose. Idempotent on resume: the row is keyed
 *  by its area, and a coverage row that already discloses the Stage-1.5 recommendation (a synthesis
 *  that weighed it in on a re-run) suppresses the injection rather than duplicating it. */
export function injectScriptScopeCoverage(P, runDir, note, { searchPolicy = null, job = null, profile = null, env = process.env, lanes = Object.keys(LANGUAGE_LANES), localLanguage = null } = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    // A WORLDWIDE ORDER IS SEARCHED WORLDWIDE, and its native-script rows are owed on that scope. The lane scope below falls
    // back to the account's default territories when an order names none, which is right for the paid lanes it chooses and
    // wrong here: a worldwide order under an account whose defaults hold no Chinese, Japanese or Korean territory wrote no
    // native-script row at all, and its report said nothing of a search it never ran. The account's defaults are the
    // customer's priorities, never the order's scope (ruled 2026-09-26, effective-scope.mjs).
    const scope = job?.geography?.mode === "worldwide" ? [] : jxScopeJurisdictions(job ?? {}, profile ?? {});
    const pending = [];
    // AN INVESTIGATION THE CLIENT ORDERED IS NEVER OFFERED BACK TO THEM (ruled 2026-09-25). The row below
    // says where the native-language investigation can be bought, which is true of a search that did not
    // include it and false of one that did: there, a lane that did not run is a part of the order that
    // failed. So on an ordered investigation no offer is made, and one that ran no lane at all carries the
    // audit's own row for that part, word for word, so the page and the workbook say the same thing.
    const ordered = Boolean(searchPolicy?.components?.jxLanes);
    if (ordered && localLanguage === "not-run") {
      pending.push({ lane: "native-language", row: deferralCoverageRow(PART_NAMES.localLanguage, NOT_COMPLETED), marker: null });
    }
    for (const lane of ordered ? [] : lanes) {
      const d = scriptScopeDisclosure(lane);
      const row = d && decideScriptScopeHonesty({
        lane, scope,
        laneRan: scriptLaneRanOnRun(runDir, lane, { searchPolicy, env }),
        laneDepthOff: profile?.jxPolicy?.laneDepth?.[lane] === "off",
      });
      if (row) pending.push({ lane, row, marker: d.marker });
    }
    if (!pending.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];   // T1 (G8) posture: never silently lose the disclosure
    const rowText = (c) => `${c?.area ?? ""} ${c?.note ?? ""}`.toLowerCase();
    const added = [], owed = [];
    for (const p of pending) {
      // Suppression is PER LANE. The old check treated any coverage row mentioning "clearance-jx" as
      // covering the disclosure, which was harmless while zh was the only lane and is a silent row-
      // eater the moment there are two: on a CN+JP scope the zh row lands first, its own note ended in
      // "(clearance-jx)", and the ja row was then swallowed by a match on the sibling's text. So the
      // deference to a synthesis-authored Stage-1.5 row requires the row to be about THIS lane.
      //
      // TWO VOCABULARIES ON PURPOSE. `native-language investigation` is what the offering calls it now
      // and what synthesis reads in its own prompt; `clearance-jx` is the retired key, kept because a run
      // RESUMED from before carries a synthesis row written in it — dropping the old token would
      // put a second, duplicate disclosure into a report that already makes the same one.
      const already = doc.coverage.some((c) => {
        const t = rowText(c);
        return t.includes(p.row.area.toLowerCase())
          || (p.marker != null && t.includes(p.marker) && SCRIPT_SCOPE_RECOMMENDATION_TOKENS.some((tok) => t.includes(tok)));
      });
      if (already) continue;
      owed.push(p);
    }
    // THE SCRIPT ROWS ARE ONE ROW (owner, 2026-11-18). A worldwide order owed a row per script lane, each ending
    // in the same offer, so "Left open" said it three times. The lanes still owed a row are now one row: their
    // names and territories joined, the same approved sentence once. One lane writes the row it always wrote.
    // The merged row carries every lane's marker and the offer's own words, so the per-lane check above finds
    // it on a second pass and writes nothing more.
    const scriptRows = owed.filter((p) => p.marker != null);
    const rows = [...owed.filter((p) => p.marker == null).map((p) => p.row),
      ...(scriptRows.length > 1 ? [mergedScriptScopeRow(scriptRows.map((p) => p.lane), scriptRows[0].row.state)] : scriptRows.map((p) => p.row))];
    doc.coverage.push(...rows);
    added.push(...owed.map((p) => p.lane));
    if (!added.length) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "script-scope-coverage-row", settles: [] });   // B5 — never a truncated findings.json
    note(`[script-scope] injected the Stage-1.5 honesty coverage row for ${added.join(", ")} — in-scope territory on a run whose ${added.length === 1 ? "lane" : "lanes"} did not run (coverage-limited: a disclosed limit, never a verdict clamp)`);
  } catch (e) {
    note(`[script-scope] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "script-scope", e);
  }
}

/**
 * The native-language state, read the way publishing reads it: `not-run`, `ran-shallow`, `ran` or
 * `not-in-scope`, or null for a run with no lane record. One reader for the page's row and the audit's
 * part, so the two cannot disagree about whether the investigation ran. The lanes' record needs jx.mjs,
 * which a plain clearance never imports.
 */
export async function localLanguageStateOf(runDir) {   // @internal
  if (!existsSync(paths(runDir).jxLanes)) return null;
  const { laneDepthOfRun } = await import("./jx.mjs");
  const { localLanguageDepth } = await import("./publish/search-depth.mjs");
  const read = (f) => { try { return JSON.parse(readFileSync(driverDir(runDir, f), "utf8")); } catch { return null; } };
  return localLanguageDepth(laneDepthOfRun({ sidecar: read("jx-lanes.json"), units: read("jx/units.json") })).state;
}

/** The zh-only form, kept because it is the name the existing tests use. One writer, one lane. */
export function injectZhScopeCoverage(P, runDir, note, opts = {}) {   // @internal
  return injectScriptScopeCoverage(P, runDir, note, { ...opts, lanes: ["zh"] });
}

/** — THE READER-VISIBLE HALF OF THE DEPTH FLAG. The sibling above states a lane that did not run
 *  AT ALL; this one states a lane that ran and did not reach the depth the customer's config asked for.
 *  They are different facts and a reader owed one is not owed the other: `injectScriptScopeCoverage`
 *  returns nothing the moment `laneRan` is true, so a `full`-configured lane that ran candidates only
 *  fell through every disclosure this pipeline had.
 *
 *  RULING (2026-08-17), and it decides the shape rather than just authorising the work: "if we
 *  can't run deep dive on serpAPI we need to flag it" — FLAG, NOT GATE. So nothing here changes what a
 *  run executes or what it retrieves; it changes what the delivered document admits. `coverage-limited`
 *  is the state for exactly that: a disclosed limit, never a verdict clamp.
 *
 *  READS THE RUN'S OWN VERDICT and never re-derives it. `stateJxSlices` mints `fold.depth` at delivery
 *  from the environment the run actually had; deriving it here would answer for the box doing the
 *  injection. Absent verdict ⇒ no row: this writer states a shortfall it can prove, and an artifact that
 *  never stated one is not evidence of a shortfall (the reverse of the zero-means-pass error — a silence
 *  must not manufacture a disclosure either).
 *
 *  Same posture as its two siblings: never-kill, re-validate, atomic write, idempotent by area. */
export function injectLaneDepthCoverage(P, runDir, note) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    let sidecar = null;
    try { sidecar = JSON.parse(readFileSync(paths(runDir).jxLanes, "utf8")); }
    catch { return; }   // no lane on this run, or no frozen decision — nothing to disclose
    const verdicts = sidecar?.fold?.depth;
    if (!verdicts || typeof verdicts !== "object") return;
    const owed = Object.entries(verdicts).filter(([, v]) => v && v.shortfall === true);
    if (!owed.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];   // T1 (G8) posture: never silently lose the disclosure
    const added = [];
    for (const [lane, v] of owed) {
      const label = LANGUAGE_LANES[lane]?.label ?? `${lane} lane`;
      // A LANE THIS VERSION HAS NO DEEPER SEARCH FOR, WHOSE CANDIDATES RAN, IS TOLD IN THE OWNER'S TWO SENTENCES ALONE.
      // `jx.mjs` writes them as this cause's `why`, and the reader gets them as they are, under a label in words: no
      // opening that restates them in the code's terms, and no closing line about verdicts, which belongs to the run's
      // own coverage judgment. Every other cause keeps the fuller note below.
      // A depth the record cannot confirm, and a full ask that ran candidates only, are said the same way, each in the
      // owner's sentence (2026-11-18).
      const plain = (v.cause === "not-built-for-lane" && v.ran === "candidates" || v.cause === "not-established"
        || v.cause === "requested-full-ran-candidates") && typeof v.why === "string" && v.why;
      const language = String(LANGUAGE_LANES[lane]?.label ?? "").replace(/-script deepening$/, "") || lane;   // as jx.mjs names it
      const area = plain ? `${language}-language search depth` : `Native-language investigation depth / ${lane}`;
      const areas = [area, `Native-language investigation depth / ${lane}`, `${language}-language search depth`].map((a) => a.toLowerCase());
      if (doc.coverage.some((c) => areas.includes(String(c?.area ?? "").toLowerCase()))) continue;
      if (plain) {
        doc.coverage.push({ area, state: "coverage-limited", note: v.why.trim() });
        added.push(lane);
        continue;
      }
      // THE SENTENCE NAMES THE ASK, WHAT RAN, AND THE REMEDY — and the remedy differs by cause, which
      // is why the verdict carries one. "This build has no deep slice for the lane" and "the switch was
      // off on this deployment" produce the same shortfall and opposite next steps, and a row that said
      // only "did not reach full depth" would leave the reader unable to tell which.
      const ran = v.ran === "candidates" ? "the candidate lane only"
        : v.ran === "full" ? "full depth"                       // unreachable while shortfall is true; stated rather than assumed
        : "a depth this run's record cannot establish";
      doc.coverage.push({ area, state: "coverage-limited",
        note: `${label}: the configured depth for this lane was \`full\` and this run delivered ${ran}. `
          + `${v.why ?? "no reason recorded"} This is a disclosed limit on what was searched, not a change to any `
          + `verdict below — the lane's results stand for what it did cover.` });
      added.push(lane);
    }
    if (!added.length) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "lane-depth-coverage-row", settles: [] });   // B5 — never a truncated findings.json
    note(`[lane-depth] injected the depth-shortfall coverage row for ${added.join(", ")} — configured full, delivered less (coverage-limited: a disclosed limit, never a verdict clamp)`);
  } catch (e) {
    note(`[lane-depth] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "lane-depth", e);
  }
}

/** The reader-visible half of the same disclosure: one coverage row PER unresolved mark, the
 *  injectDeferralCoverage / injectZhScopeCoverage posture verbatim (never-kill, re-validate,
 *  atomic-write). NOTE the CONDITIONAL clamp does NOT come from these rows — `coverage-limited` never
 *  clamps (decideRegisterGap clamps on `deferred` rows only); the clamp is applyCoverageFloor's
 *  screenGateGap arm reading the same ctx/sidecar set. This function only makes that disclosure
 *  legible on the report. Idempotent by mark+uri (the area string carries both), so a resume or a
 *  second injection pass never duplicates a row. Exported for the unit tests. */
export function injectScreenGateCoverage(P, runDir, note, ctx = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    const unresolved = loadScreenGateUnresolved(runDir, ctx);
    if (!unresolved.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];   // T1 (G8) posture: never silently lose the disclosure
    let added = 0;
    for (const g of unresolved) {
      const area = `Unexamined drop / ${g.mark}${g.uri ? ` (${g.uri})` : ""}`;
      if (doc.coverage.some((c) => String(c?.area ?? "") === area)) continue;   // already disclosed (resume / re-entry)
      doc.coverage.push({ area, state: "coverage-limited",
        note: `${g.mark}: official register record could not be retrieved (${g.cause}) — dropped on goods, could not be examined; verify this record before relying` });
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "screen-gate-coverage-rows", settles: [] });   // B5 — never a truncated findings.json
    note(`[screen-gate] injected ${added} unexamined-drop coverage row(s) — the reader sees every mark the run could not examine`);
  } catch (e) {
    note(`[screen-gate] coverage injection skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "screen-gate", e);
  }
}

// Imported down here, below every line the rest of the tree cites by number, so adding them moved none of those lines.
import { registerReach, NOT_COVERED_REASON } from "./register-reach.mjs";   // — what the register service reaches, against the order's markets
import { regionName } from "./publish/regions.mjs";

// THE MARKETS AN ORDER IS FOR, as the register's reach is read against them: a worldwide order's are the client's
// markets (the account's default markets, else the major markets, plus any market the order names), and a territorial
// order's are its own. Read from the run's frozen order and profile. Never throws: an order it cannot read has no
// markets here, and the coverage line and the rows then say what they said before.
export function orderMarketsOf(ctx, plan) {   // @internal
  try {
    const order = instructedOrder(ctx.paths, ctx.job);
    return plan?.scope_basis === "worldwide" ? clientMarkets(order, ctx.profile) : orderTerritories(order, ctx.profile);
  } catch { return []; }
}

/** EVERY MARKET THE REGISTER SERVICE DOES NOT REACH GETS A "NOT SEARCHED" ROW, WRITTEN BY CODE (owner, 2026-11-18).
 *  Whether such a market was named used to depend on what the writer chose to write: on three deliveries of one
 *  order, one named Japan alone, and Vietnam was named on none. The reach is register-reach.mjs's, the same answer the
 *  coverage line names, so the row and the line cannot disagree. The area is the country's name and the reason is the
 *  approved one. A row the writer added for the same market stays beside it. Idempotent by area and reason, so a resume
 *  or a second pass never doubles a row; never-kill, as its siblings. */
export function injectUncoveredMarketCoverage(P, runDir, note, ctx = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    let plan = ctx.registerPlan ?? null;
    if (!plan) { try { plan = JSON.parse(readFileSync(P.registerPlan, "utf8")); } catch { return; } }
    const reach = registerReach(plan?.provider, orderMarketsOf(ctx, plan));
    if (!reach?.uncovered.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];
    let added = 0;
    for (const code of reach.uncovered) {
      const area = regionName(code);
      if (doc.coverage.some((c) => String(c?.area ?? "") === area && String(c?.note ?? "") === NOT_COVERED_REASON)) continue;
      doc.coverage.push({ area, state: "not-searched", note: NOT_COVERED_REASON });
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "uncovered-market-rows", settles: [] });
    runLog(runDir, { event: "uncovered-market-rows", service: reach.service, offices: reach.offices, markets: reach.uncovered, added });
    note(`[register-reach] ${added} "Not searched" row(s) for market(s) outside ${reach.service}'s ${reach.offices} offices: ${reach.uncovered.join(", ")}`);
  } catch (e) {
    note(`[register-reach] coverage rows skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "register-reach", e);
  }
}

// THE SEAM'S FOLD. From here on every accepted save folds the record again on acceptance, so the record
// the reviewer, the cards and the delivery read stays folded (record-fold.mjs, design 2026-10-03). doc 50 —
// on a v4 record the merge base is the WORST BAND by the frozen manifest's order. No duplicates leave the
// file byte-identical; a folded shape that does not validate keeps the record as written.
function consolidateFindingsFile(P, note, manifest = null) {
  const { merges, error } = foldFindingsFile(P.runDir, P.findings, manifest, { seam: true });
  for (const m of merges)
    note(`[consolidate] ${m.owner} — ${m.mark}: folded ${m.dropped.length} duplicate filing(s) (ord ${m.dropped.join(", ")}) into one card`);
  if (error) note(`[consolidate] skipped: ${error.slice(0, 100)}`);
}
// minor (a): a finding earns a FULL prose card when composite ≥ 3 (on-field) OR level ∈ {A,B} (high legal
// exposure even at a low practical composite — a mis-rated-low mark must not be reduced to a structured-only row).
export function fullProseOrdinals(findings) {
  return (findings ?? [])
    .filter((f) => f.disposition !== "withdrawn")   // A1: a review-killed finding gets no card call
    // doc 50: every band-rated finding gets a full-prose card (off-field awareness renders structured-only);
    // the composite/level line is the archived-run legacy path.
    .filter((f) => f.band != null || (Number(f.composite) || 0) >= 3 || ["A", "B"].includes(String(f.level || "").toUpperCase()))
    .map((f) => f.ordinal)
    .filter((o) => o != null);
}
// ASSEMBLE report.md = the overview shell (front-matter + Actions) + `# Left open` + `# Marks` + the
// per-card files in render order (composite desc, ordinal asc — mirrors render.mjs `sortedAll`), `open: true` on the
// single top card. Findings with no card file (a failed report-card, or a secondary finding) are NOT emitted —
// render.mjs synthesizes them structured-only from findings.json, so nothing is silently dropped. Pure file IO.
// spec 64 — "### Only you can close these" is CODE-BUILT from the typed actions register (the report-
// overview stage no longer authors it), so the section, the "subject to" bound line, the email box and
// the derived disposition all read from ONE source and can never drift apart. Ordering: time-critical
// conditions (deadline asc) → other conditions (id) → advisories (tagged — actYouConditions skips them,
// so an open question never reads as a condition). Returns "" when nothing renders.
//
// — ALL FOUR ADVISORY KINDS RENDER, AND THE FOURTH USED TO BE UNREACHABLE. What stood here said
// "filing-routine never renders here (ordinary filing mechanics are not an ask)", written 2026-07-16 with
// the ADVISORY_TAG filter itself. then split this section into an ask group and a watch group on
// 2026-08-10, and its own comment below names the watch group's members as "monitoring and filing-routine"
// — but `advisories` was already filtered by ADVISORY_TAG upstream, and did not touch that filter.
// So the group written to hold filing-routine could only ever receive monitoring, and a schema-valid
// ADVISORY_KINDS member could never reach a client document at all. The 2026-07-16 comment described the
// behaviour it shipped with and became stale prose sitting next to code that contradicted it.
//
// Ruling 2026-08-19 (relayed), on a renewal-deadline example: it renders. That intent is the
// ruled behaviour. The tag is REQUIRED, not decoration — `advisoryLine` interpolates ADVISORY_TAG[a.kind]
// directly, so a kind that passes the filter without an entry here renders "- **undefined** …" into a
// client document. Whoever adds a fifth kind adds it in both places, and render.mjs needs the matching
// chip replace or the reader sees the literal token.
const ADVISORY_TAG = { "client-fact": "[Open question]", "commercial-decision": "[Your decision]", monitoring: "[Monitor]", "filing-routine": "[Filing step]" };
// — the condition-side counterpart of ADVISORY_TAG, and the token the report renders as the fourth
// chip. It repeats the group heading deliberately: the chip's job is to say what an item IS wherever the
// eye lands on it, and a list where three kinds are chipped and the fourth is bare reads as three kinds
// plus leftovers. render.mjs has the matching replace beside the other three.
const CONDITION_TAG = "[Before you can rely]";
// PR-3 (report voice) — diacritic-folded lowercase for the subject-join containment test only.
const softNorm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/**
 * THE HEADINGS THIS FILE CODE-BUILDS, and the ONE list of them.
 *
 * Every value below is emitted by a builder in this file and by nothing else. They are declared here and
 * USED by those builders rather than repeated in them, because the whole point of the constant is that it
 * cannot drift from what the code actually writes — a second, hand-kept list is the thing it exists to
 * prevent, and this repo has paid for that shape more than once.
 *
 * ── WHY A CONSTANT AND NOT A COMMENT ───────────────────────────────────────────────────────────────
 *
 * A section that becomes code-built stops being a thing a seat may author, and the dictation that used to
 * order it goes false WITHOUT ANYBODY EDITING IT. Measured: the refutation reviewer was still ordered to
 * "verify the ... section answers EACH of these verbatim intake asks" months after that section became
 * code-built from a validated register — an instruction spending a reviewer's attention on a failure the
 * code had made unrepresentable. Nobody wrote it wrong; a stage underneath it got better.
 *
 * So the guard that catches the next one walks THIS list against what actually reaches a seat, and a
 * section joins the list by the same act that makes it code-built: its builder returning one of these.
 */
export const CODE_BUILT_SECTIONS = Object.freeze({   // @internal
  onlyYou: "### Only you can close these",
  reviewerOpenPoints: "### Reviewer's open questions",
  // Under it, the points of the review that stood when the recheck after the correction saved none.
  earlierReview: "#### Earlier review — correction not rechecked",
  askAnswers: "### Answers to your instructions",
  reasonedNegatives: "# Reasoned negatives",
});

export function buildOnlyYouSection(actions, findings, { nowMs = Date.now(), withinDays = 60, graceDays = 14 } = {}) {   // @internal
  const { conditionActions, advisoryActions } = deriveActionConditions(actions, findings);
  // ── PR-3 (report voice), CORRECTED BY — WHAT THE SUBJECT JOIN DOES AND DOES NOT GUARANTEE ───
  //
  // This comment used to read: "an ask can never name an entity no finding identifies — the
  // reference-integrity property holds by construction". IT DID NOT HOLD, and the sentence sat directly
  // above the code that falsified it, which is worse than never claiming it: a reader stops looking.
  //
  // The join reads `action.ordinals`, resolves each to a finding, and appends that finding's label when
  // the ask does not already name it. Nothing read the OTHER names in the text, so an ask bound to a
  // live finding whose text named a different party delivered as
  //
  //     Obtain consent from PARTY-B before launch. (re: PARTY-A (Party A Ltd))
  //
  // — two parties the reader now believes are connected, manufactured by the mechanism whose comment
  // promised it prevented exactly that.
  //
  // WHAT HOLDS NOW, stated as what it is rather than as a guarantee:
  //   · The label is code-joined from the store and never model-typed. That part was always true.
  //   · An ask that names ANOTHER carded party gets NO appended subject — the run's own party index
  //     (findings-model.mjs `cardedParties`) can see that case, and suppressing the join is the whole
  //     fix for it: a sentence that names its own party needs no "(re:", and one that names a different
  //     party must not be given one.
  //   · An ask citing ordinals that ALL fail to resolve is not silently unsubjected any more. It used
  //     to `continue` past every one and render exactly like a run-level ask, so a broken reference and
  //     a deliberate absence were the same bytes.
  //
  // WHAT DOES NOT HOLD, and is not claimed: an ask may still name a party THE RUN NEVER SAW — a
  // supplier, a licensee, a distributor no finding carries. No index built from findings can see it.
  // That orphan lint is what catches that at delivery, and this is the producer telling the truth
  // about its own reach instead of covering for it.
  const byOrd = new Map((findings ?? []).filter((f) => f && f.disposition !== "withdrawn").map((f) => [f.ordinal, f]));
  const partyIndex = cardedParties(findings);
  const subjectFor = (a) => {
    const t = softNorm(a?.text);
    const refs = actionPartyReferences(a, partyIndex);
    const bound = new Set();
    const missing = [];
    for (const n of (Array.isArray(a?.ordinals) ? a.ordinals : [])) {
      const f = byOrd.get(n);
      if (!f) continue;
      const mark = String(f.mark ?? "").trim(), owner = String(f.owner?.name ?? "").trim();
      bound.add(softNorm(mark)); bound.add(softNorm(owner));
      if ((mark && t.includes(softNorm(mark))) || (owner && t.includes(softNorm(owner)))) continue;
      const label = mark && owner && softNorm(mark) !== softNorm(owner) ? `${mark} (${owner})` : (mark || owner);
      if (label && !missing.some((x) => softNorm(x) === softNorm(label))) missing.push(label);
    }
    // — THE ASK ALREADY NAMES SOMEONE THE RUN KNOWS, AND IT IS NOT WHO WE WERE ABOUT TO APPEND.
    // Appending here is what builds the false association. The ask still renders, whole and unedited —
    // a forward legal step the opinion authored survives this, which is the rule one layer up
    // ("Do not resolve a defect by DELETING the action") applied to its rendering.
    if (missing.length && refs.names.some((n) => !bound.has(softNorm(n)))) return "";
    if (!missing.length) return "";
    return ` (re: ${missing.slice(0, 2).join("; ")}${missing.length > 2 ? `; +${missing.length - 2} more` : ""})`;
  };
  // Terminal punctuation on the ask BEFORE the subject join. This was written to work around a cut —
  // actYouConditions ended its bound line at the first '.' or ':' before whitespace, and the subject's
  // own "(re:" qualified, so a period-less ask (the synthesis prompt demands one sentence but nothing
  // enforces terminal punctuation) delivered as a mangled "…terms (re". THAT CUT IS GONE (ruling
  // 2026-08-10): the conditions box now renders the ask and its subject whole. The punctuation
  // stays because it was always the right output — "Instruct counsel on the joined-script forms (re: X)"
  // reads as one run-on sentence, and the period is what separates the ask from the driver's own note.
  // Asks with no subject are untouched.
  const askLine = (a) => {
    const text = String(a.text).trim();
    const subj = subjectFor(a);
    if (!subj) return text;
    return `${text}${/[.!?:]$/.test(text) ? "" : "."}${subj}`;
  };
  const dated = conditionActions.filter((a) => a.deadline?.date).sort((x, y) => String(x.deadline.date).localeCompare(String(y.deadline.date)));
  const undated = conditionActions.filter((a) => !a.deadline?.date).sort((x, y) => (x.id ?? 0) - (y.id ?? 0));
  const advisories = advisoryActions.filter((a) => ADVISORY_TAG[a.kind]).sort((x, y) => (x.id ?? 0) - (y.id ?? 0));
  // spec 64 A×B glue — a FINDING-level in-window deadline (enrichFindingDeadlines injects them from the
  // register's own opposition windows) surfaces as a code-built time-critical alert when no action
  // already carries that date: a recorded deadline must never silently disappear, even when synthesis
  // authored no action for it. In-window only (an archived 2015 window is history, not an ask).
  const actionDates = new Set([...dated, ...advisories].map((a) => a.deadline?.date).filter(Boolean));
  const inWindow = (d) => {
    const days = Math.round((Date.parse(d) - nowMs) / 86400000);
    return Number.isFinite(days) && days <= withinDays && days >= -graceDays;
  };
  const findingAlerts = (findings ?? [])
    .filter((f) => f && f.disposition !== "withdrawn" && typeof f.deadline?.date === "string" && f.deadline.date.trim())
    .filter((f) => inWindow(f.deadline.date) && !actionDates.has(f.deadline.date))
    .sort((x, y) => String(x.deadline.date).localeCompare(String(y.deadline.date)))
    .map((f) => `- **[Time-critical]** ${String(f.mark ?? "the conflicting mark").trim()}: the ${String(f.deadline.kind ?? "deadline").trim()} window closes ${f.deadline.date} — decide how to respond before it does.`);
  // ── (c) — THREE OBLIGATIONS IN ONE LIST, VISUALLY IDENTICAL ────────────────────────────────────
  // A delivered report put the conditions the verdict DEPENDS ON next to "[Open question] Confirm how
  // the product will be presented" as undifferentiated bullets. A reader skimming has to reconstruct
  // which ones block from the sentences themselves.
  //
  // NOTHING IS INFERRED FROM PROSE. The register already carries the distinction the reader needs:
  // CONDITION_KINDS are the kinds that condition reliance (findings-model.mjs states it — "an advisory
  // never conditions reliance", which is why `action.condition` is refused on an advisory), and the
  // advisory kinds carry their own tags. So this groups on `kind` — the author's own legal
  // classification — and a renderer that guessed severity from wording would be the defect this repo
  // keeps removing.
  //
  // Sub-headings, not a new section: "Only you can close these" is the heading the report, the email's
  // conditional bound and three predelivery checks all key on, and the ordering within each group
  // (dated first, then finding-level alerts, then undated) is unchanged.
  //
  // ── — EVERY ITEM CARRIES ITS LABEL ─────────────────────────────────────────────────────────────
  // The undated arm emitted a bare `- text` while every other line in the section carried a tag. So the
  // items that BLOCK reliance were the only items with no chip, and a reader skimming the list read the
  // unlabelled ones as the residue — the opposite of what they are. Nothing here is inferred: a condition
  // is a condition because its kind is in CONDITION_KINDS, exactly as the tagged arms are.
  // [Time-critical] stays on the DATED arm. A deadline is a fact about the item, not a second class of
  // it, and the date is what the reader has to act on first.
  const conditionLines = [
    ...dated.map((a) => `- **[Time-critical]** ${askLine(a)} (due by ${a.deadline.date})`),
    ...findingAlerts,
    ...undated.map((a) => `- **${CONDITION_TAG}** ${askLine(a)}`),
  ];
  // "we need an answer from you" vs "watch this": the client-fact / commercial-decision kinds are asks
  // addressed TO the reader; monitoring and filing-routine are standing items. Same tags as before, so
  // a reader who knows the old list reads the new one unchanged, one level down.
  const ASK_KINDS = new Set(["client-fact", "commercial-decision"]);
  // ── THE KINDS THAT DO NOT REACH A CLIENT SURFACE ────────────────────────────────────────────────
  //
  // Owner ruling, 2026-10-01, on the clearance emails production sent in the preceding day: the
  // "[Open question]" rows are non-critical and confuse, and they come OUT of the client's report and
  // email. They are not reworded and nothing replaces them.
  //
  // THE FILTER IS HERE AND NOT ON `advisories` ABOVE, which is the whole care in this change. That list
  // also feeds `actionDates`, so dropping a kind from it would silently take a declared deadline out of
  // the date set three predelivery checks key on — a client-facing removal quietly changing a date
  // check. Filtering at the point of RENDERING removes the rows from the document and touches nothing
  // else: the register in findings.json is unchanged, the kind stays valid, an advisory still never
  // conditions reliance, and the verdict and its bound read from the register rather than from these
  // lines.
  //
  // So the row is gone from what the client reads and the fact is still on the run, which is what the
  // ruling asks for.
  const NOT_FOR_CLIENT = new Set(["client-fact"]);
  const advisoryLine = (a) => `- **${ADVISORY_TAG[a.kind]}** ${askLine(a)}${a.deadline?.date ? ` (by ${a.deadline.date})` : ""}`;
  const forClient = (a) => !NOT_FOR_CLIENT.has(a.kind);
  const askLines = advisories.filter((a) => ASK_KINDS.has(a.kind)).filter(forClient).map(advisoryLine);
  const watchLines = advisories.filter((a) => !ASK_KINDS.has(a.kind)).filter(forClient).map(advisoryLine);
  const groups = [
    ["Before you can rely on this result", conditionLines],
    ["We need an answer from you", askLines],
    ["Keep an eye on", watchLines],
  ].filter(([, ls]) => ls.length);
  if (!groups.length) return "";
  // ── — THE ONE-GROUP COLLAPSE IS RE-RULED, AND THIS IS THE ROOT OF THE DRIFT ────────────────────
  //
  // What stood here: `groups.length === 1 ? groups[0][1].join("\n") : …`, on the argument that "a
  // single-bucket list with a lone sub-head is a heading that separates nothing". Read once, that is
  // true about a heading. Read across runs, it makes the section's SHAPE a function of how many buckets
  // a matter happened to fill — which is a property of the client's facts, not of the report. Two runs
  // both carrying blocking conditions rendered them under a named heading or as an anonymous list
  // depending on whether some unrelated third item was a monitoring ask. That is the drift reports,
  // and the flat-list run is the same code path as the three-group one, not a second one.
  //
  // A heading that separates nothing still says what the list IS. The reader is not comparing it with
  // its neighbours; they are asking whether these lines block them, and "Before you can rely on this
  // result" answers that where a bare list does not.
  //
  // ARCHIVED RUNS DO NOT MOVE. This function runs at ASSEMBLY, once, and its output is frozen into the
  // run's report.md; publish and republish read that file and never call it. So no delivered report is
  // rewritten by this — the change reaches runs assembled after it lands, and nothing else.
  const body = groups.map(([head, ls]) => `**${head}**\n\n${ls.join("\n")}`).join("\n\n");
  return `${CODE_BUILT_SECTIONS.onlyYou}\n\n${body}`;
}

// ── T3a — THE REVIEWER'S OPEN POINTS, CODE-BUILT FROM THE REVIEW ────────────────────────────────────
//
// Ruling 2026-08-26, verbatim: "Deliver always, with open points printed. The refusal on a
// blocking review goes." The delivery half stands: a refusing review never withholds a report.
//
// WHERE THE SECTION GOES CHANGED. Owner ruling 2026-09-24: reviewer notes never reach the client page, and
// a report the reviewer still refuses ships with its rating and nothing added. This builder is unchanged
// and its output goes to the run record beside the review (the call site in assembleReportMd), for the
// reviewing lawyer. The rest of this note describes how the section is built, which still holds.
//
// ── CODE-BUILT, LIKE THE ONLY-YOU SECTION, AND FOR THE SAME REASON ─────────────────────────────────
//
// Spec 64's ruling on `### Only you can close these` applies here word for word: code wins, so the
// section can never contradict the artifact it derives from. The one seat that must not be asked to
// summarise the reviewer's objections is the seat the reviewer objected to. So this reads
// senior-eye-review.md through `parseVerdict` and `parseCorrections` — the SHIPPED parsers, the same
// ones the corrective ladder builds its worklist from — and never asks a model to restate them.
//
// ── NOT BLOCKING-ONLY ANY MORE — OWNER DECISION, 2026-08-26 (T3b) ─────────────
//
// This section used to return "" on every verdict but BLOCKING, and the reason it gave was that
// CONDITIONAL reviews already deliver and their flags already reach the corrective pass. That is true
// of where the flags GO and says nothing about whether they LANDED. A flag can reach the corrective
// pass, be worked, and leave the report unchanged — and the client then reads a delivered report with
// no sign that the reviewer objected to something nobody fixed.
//
// Decided as the client outcome, with options put first: print them, on any verdict.
// So the set is no longer chosen by the verdict. It is:
//
//   BLOCKING            every ground the reviewer cites — unchanged, the reviewer refused to sign
//   ANY VERDICT         plus every objection the run tried and could not show it closed
//   A HARDENED VERDICT  plus every point of the review after a repair that hardened it, even one its correction
//                       changed: nothing reviewed that change, so the label keeps a visible ground (`ground`)
//
// The second source is `corrections-applied.json`, the driver's own flag-by-flag observation,
// which already exists and is already written on both the CONDITIONAL and the BLOCKING path. What
// counts as "could not show it closed" is `unresolvedFlags` — decided in corrections-feedforward.mjs
// beside the code that mints the outcomes, so the question has one implementation.
//
// THE UNION IS DEDUPED, AND IT IS A UNION RATHER THAN A CHOICE ON PURPOSE. On BLOCKING the review the
// driver reads at assembly is the RECHECK's rewrite, so a reviewer who dropped an objection it had
// raised — while still refusing on another — would take an unfixed point out of the report with it.
// The pre-corrective observation still holds that row. Both sources, deduped on normalised text.
//
// ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────────────────────────────
//
// It renders NOTHING when the reviewer signed and every objection is observably closed — the majority
// of runs. An empty heading would be worse than no section: it tells a lawyer a refusal happened.
//
// Returns "" only when the reviewer SIGNED. A BLOCKING that cites nothing still renders, and that is a
// correction to this function's first cut: the degenerate re-ask upstream makes that state rare, not
// impossible, and rendering nothing would ship a report whose body reads as reviewed while the reviewer
// refused. Silence is the one thing the section exists to prevent. The wording is the sidecar's own,
// already carried at the degenerate branch above — one sentence for one fact, in both places.
//
// ── THE EARLIER REVIEW'S POINTS SAY WHOSE THEY ARE (heading approved 2026-11-04) ──────────────────
//
// A recheck after the correction that saved no review leaves the review from before the correction in
// place, and its verdict stands. Built from it with nothing said, the points read as the reviewer's view of
// the corrected record, and nobody reviewed that record. So the caller passes `earlier` — the file holding
// that review, and whether it is the one in place (earlierReviewNotRechecked) — and the section puts that
// review's points under `CODE_BUILT_SECTIONS.earlierReview`, with that file as a value and no sentence added.
//
// THE HEADING GOES BY THE POINT, NOT BY THE SECTION. A review of a delivery-check repair can be read after that
// recheck and print its points in the same record. It read only the repair, so the correction is still not
// rechecked and the earlier review's points are still the earlier review's; its own points (`later`, from the
// caller) stay above the heading. The lead is chosen by the verdict of the review in place, so it goes where that
// review's points go: under the heading when that is the earlier review, above it when a later one hardened the
// verdict. The points, their outcomes and the leads are untouched, nothing is dropped, and the section's own
// heading stays first for every reader that keys on it. Without `earlier`, not a byte of the section changes.
export function buildReviewerOpenPointsSection(reviewMd, appliedRows = null, { earlier = null } = {}) {   // @internal
  const blocking = parseVerdict(reviewMd) === "BLOCKING";
  const cited = blocking ? parseCorrections(reviewMd) : [];
  const unfixed = (Array.isArray(appliedRows) ? appliedRows : []).filter((r) => r?.ground === true || unresolvedFlags([r]).length);
  const seen = new Set();
  const rows = [];
  for (const r of [...cited, ...unfixed]) {
    // Deduped on normalised text, which catches a row carried by both sources and nothing cleverer. A
    // reviewer who REPHRASES an objection between the two reads prints twice; that is the direction
    // this section is meant to fail in, and a similarity match here would be a filter deciding which
    // of a lawyer's objections the client is allowed to see.
    const key = String(r?.text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(r);
  }
  // The earlier review's heading, then where its points come from, as a value: the review's file.
  const fromEarlier = earlier
    ? [CODE_BUILT_SECTIONS.earlierReview, "", ...(earlier.review ? [`*(\`${earlier.review}\`)*`, ""] : [])]
    : [];
  if (!rows.length) {
    // Signed, and nothing left open: no section. This is the majority of runs and it is the whole
    // reason the emptiness is checked AFTER the union rather than by the verdict.
    if (!blocking) return "";
    return [
      "### Reviewer's open questions",
      "",
      ...(earlier?.inPlace ? fromEarlier : []),
      "**The independent reviewer did not sign this report off, and cited no specific defect.** A "
      + "refusal without a named ground is not a finding you can act on — read the reviewer's own note "
      + "before relying on this report.",
    ].join("\n");
  }
  // ── THE QUALIFIER IS PER ROW, BECAUSE THE LEAD CANNOT BE TRUE OF ALL OF THEM ─────────────────────
  //
  // ✕ The first cut of this said, in the lead, "the version you are reading did not change in
  // response." That is a claim the driver can only make about `findings-unchanged` — it checked, and
  // nothing moved. It is FALSE of `not-entity-scoped`, where the flag's prose joined no entity, and of
  // `not-checkable`, where there was no pre-corrective document to compare. Both mean the run does not
  // KNOW whether the point was addressed.
  //
  // Not a rare shape. `on` is optional in the typed call BY DESIGN — "omit it for a flag about the
  // document rather than a finding" — and a reviewer's objections about the summary, the methodology
  // note or the caption have no ordinal to declare. Measured on the entity join with nine
  // document-level flags: 9 of 9 land on `not-entity-scoped`, and 9 of 9 of the same flags land on
  // `findings-unchanged` once an ordinal is declared. So the unchecked shape is the NORMAL one for a
  // whole class of objection, and a single lead asserting the report was worked and did not move would
  // be an over-claim on most of a real section.
  //
  // The lead now says only what is true of every row — the report does not SHOW them closed — and each
  // row carries what the driver actually knows. A row with no outcome at all comes from the review
  // itself on a BLOCKING, where the refusal is the whole fact and a qualifier would add nothing.
  const QUALIFIER = {
    "findings-unchanged": "the report did not change in response",
    "findings-removed": "the finding this named was removed rather than corrected",
    "not-entity-scoped": "the run could not check whether this was addressed",
    "not-checkable": "the run could not check whether this was addressed",
    "line-unchanged": "the line this named was left as written",
    // A narrative section a flag of the review after a repair named, left as written: the shipped words.
    "section-unchanged": "the line this named was left as written",
    "line-removed": "the line this named was removed rather than corrected",
  };
  const item = (r) => {
    const bits = [];
    if (Array.isArray(r.ordinals) && r.ordinals.length) bits.push(`finding ${r.ordinals.join(", ")}`);
    // An outcome nobody has classified takes the unchecked wording, never the checked one — the same
    // direction `unresolvedFlags` fails in, for the same reason.
    // A ground the correction changed keeps its observed outcome in the record and prints as unchecked: no review
    // read the change, so the run cannot say it was addressed, and "did not change" would be false.
    if (r.outcome) bits.push((r.ground === true ? null : QUALIFIER[r.outcome]) ?? "the run could not check whether this was addressed");
    const tail = bits.length ? ` *(${bits.join(" — ")})*` : "";
    return `- ${ADVISORY_TAG["client-fact"]} ${String(r.text).trim()}${tail}`;
  };
  // Two leads for two different facts about the report in the reader's hands. Collapsing them into one
  // sentence would either tell a client the reviewer refused when it signed, or bury a refusal.
  const lead = blocking
    ? "**The independent reviewer did not sign this report off.** The points below are the ones they "
      + "raised and the run could not close. They are open questions for the reviewing lawyer's "
      + "judgment — not conditions for you to satisfy, and not steps that complete the work."
    : "**The independent reviewer raised the points below, and this report does not show them "
      + "closed.** Each was put back to the drafting pass; what the run could establish about each one "
      + "is noted against it. They are open questions for the reviewing lawyer's judgment — not "
      + "conditions for you to satisfy, and not steps that complete the work.";
  // Whose each point is: what the review in place cites is that review's, a row of the first correction is the
  // earlier review's flag, and a row the caller marks `later` is the later review's.
  const isEarlier = (r) => Boolean(earlier) && r.later !== true && (earlier.inPlace === true || !cited.includes(r));
  const earlierItems = rows.filter(isEarlier).map(item).join("\n");
  const otherItems = rows.filter((r) => !isEarlier(r)).map(item).join("\n");
  if (!earlierItems) return [CODE_BUILT_SECTIONS.reviewerOpenPoints, "", lead, "", otherItems].join("\n");
  const others = otherItems ? [otherItems, ""] : [];
  return [CODE_BUILT_SECTIONS.reviewerOpenPoints, "",
    ...(earlier.inPlace ? [...others, ...fromEarlier, lead, ""] : [lead, "", ...others, ...fromEarlier]), earlierItems].join("\n");
}

// PR-9 — the code-built "Answers to your instructions" section, the only-you pattern one lane over:
// synthesis authors the top-level ask_answers[] register in findings.json; the driver renders the
// section FROM it, joined to the frozen _driver/intake-asks.json rows (joinAskToAnswer — the same join
// the lint judges), so the answer the client reads and the answer the lint verifies are one record.
// Frozen-intake order leads (the requester's own sequence); answers that join no frozen ask follow in
// register order (an answer synthesis chose to give is never dropped). Returns "" when no answers.
export function buildAskAnswersSection(askAnswers, intakeAsks) {   // @internal
  const entries = (Array.isArray(askAnswers) ? askAnswers : [])
    .filter((a) => a && typeof a.ask === "string" && a.ask.trim() && typeof a.answer === "string" && a.answer.trim());
  if (!entries.length) return "";
  const used = new Set();
  const out = [];
  // Neutral label, ask VERBATIM after the colon: intake asks are captured as imperatives ("check
  // whether…", "confirm…"), so a sentence-shaped prefix ("You asked us to check …") doubles the verb
  // on nearly every real run — code cannot rephrase the way the retired model-authored contract could.
  //
  // ── — THE ANCHORED DE-DUPLICATION OF THIS FUNCTION'S OWN LABEL ────────────────────────────────
  //
  // THIS IS NOT THE SUBSTITUTION FORBIDS, and the difference is not a matter of degree. The
  // ban list read arbitrary client prose and the trademark register, matching words ANYWHERE in a
  // string, which is how `axis` -> `group` renamed the live mark AXIS Bank inside the report clearing
  // it. This reads ONE field and removes an anchored prefix in the shape of THIS FUNCTION'S OWN LABEL:
  // the words "You asked" at position 0, through the first arrow. Not a vocabulary — a position.
  //
  // Stated exactly, because the difference is the whole review question: it does not require the
  // between-text to equal the label the next line emits, because the delivered doubling does not
  // either — synthesis wrote `You asked: "EU register only." → …` while the code emits
  // `- You asked: EU register only → `. Matching only the code's exact bytes would miss every real
  // specimen. What bounds it instead is POSITION: it cannot fire mid-sentence, it never touches `ask`,
  // and a mark named "You asked" would still have to open the answer AND be followed by an arrow.
  //
  // A joinAskToAnswer GATE WAS CONSIDERED AND REJECTED, so it is not re-proposed each review: the
  // second loop below emits entries that joined NO frozen intake ask, so there is no ask to gate them
  // on, and gating would leave exactly those unstripped. Position is the only bound that covers both
  // loops.
  //
  // WHY IT IS NEEDED AT ALL, given the stages.mjs dictation now says "the answer alone": the dictation
  // governs what a MODEL writes on a FUTURE run, and a prompt is not a guarantee. Every archived
  // findings.json on disk carries the old doubled form permanently — demo's does today —
  // and assembly re-runs over an archived register on resume and on every re-assembly. The author fix
  // stops the doubling being written; this stops it being printed.
  //
  // MOVED THE RULE, AND THIS CALL IS WHAT IS LEFT OF IT. The strip used to be a private copy here,
  // and report-data.json's projection of the SAME register had no copy at all — so one answer shipped
  // two ways, which is the drift report-data's own doctrine exists to prevent. findings-model's
  // stripAskLabel is the one implementation, applied at the register read (validateAskAnswer), so both
  // parsers hand every consumer an already-bare answer. This call stays because buildAskAnswersSection is
  // EXPORTED and can be handed a register that never went through a parser; it is idempotent, and being
  // the same function it cannot drift from the choke point.
  //
  // WHAT IT DOES NOT REACH, stated rather than implied: a report.md already frozen by a previous
  // assembly is never rewritten here — publish reads that file and never calls this.
  const line = (ask, answer) => `- You asked: ${String(ask).trim().replace(/[.\s]+$/, "")} → ${stripAskLabel(answer)}`;
  for (const a of (Array.isArray(intakeAsks) ? intakeAsks : [])) {
    const hit = joinAskToAnswer(a?.ask, entries);
    if (hit && !used.has(hit)) { used.add(hit); out.push(line(a.ask, hit.answer)); }
  }
  for (const e of entries) if (!used.has(e)) out.push(line(e.ask, e.answer));
  return out.length ? `${CODE_BUILT_SECTIONS.askAnswers}\n\n${out.join("\n")}` : "";
}

/**
 * The grouped reasoned negatives, for report.md.
 *
 * report.html has rendered these since: shared ground once as a heading, then one line per member.
 * report.md rendered NONE of it, and for the off-field members it rendered nothing at all — a stronger
 * fact than "the grouping is missing". fullProseOrdinals admits a finding on `band != null || composite >=
 * 3 || level in [A,B]`; an off-field finding is REQUIRED to carry `band == null` (findings-model
 * finding_band_forbidden) and its composite is null on a v4+ record, so it fails all three, gets no
 * ordinal, gets no report-card file, and is dropped by the existsSync filter. Four reasoned negatives
 * about named proprietors were therefore silent on one delivered surface while another rendered them in
 * full — and the standing criterion is that every retrieved close match ends as a finding or a reasoned
 * negative, never as silence.
 *
 * ONE AUTHOR. Both surfaces call reasonedNegativeGroups over the same findings.json and print the typed
 * `net`; nothing here re-summarises anything, so the two cannot disagree. That is the distinction
 * drew — its defect was two AUTHORS of one summary, not one summary appearing on two surfaces.
 *
 * The heading is the group's own `ground` label from findings-model.mjs, not render.mjs's short display
 * heading: one map, in the typed source, rather than a second copy here that drifts from it.
 *
 * THE DIVERGENCE THIS USED TO DEFER IS NOW ONE-COUNTRY-ONLY, AND OWNS IT.
 *
 * What stood here said report.html gives a band-2 negative ONLY a group line while report.md also gives
 * it a full card (because .md cards key on `band != null`), so a coexistence-partner or distinguished
 * finding appears twice in the Markdown — and that changing which findings earn a .md card "belongs to
 * whoever takes that on". is whoever takes that on: the depth ladder IS a change to which findings
 * earn a full card, so the two surfaces' card sets move under it.
 *
 * RULED (§9): on multi-country and worldwide a mark demoted to a group line stops also getting a .md
 * card — `.md` aligns with `.html` and the divergence closes for those marks. On ONE COUNTRY it PERSISTS,
 * deliberately: the byte-identical guarantee for product 4 outranks it, and closing it there would be a
 * change to the delivered report nobody asked for. So the divergence is now one-country-only and owned,
 * rather than general and deferred.
 *
 * This section itself is untouched by the ladder: the grouping is not extended and not re-keyed. The
 * graded entries render in a SIBLING section (buildGradedEntriesSection) using the same line grammar.
 */
export function buildReasonedNegativesSection(findings) {   // @internal
  const { total, groups } = reasonedNegativeGroups(findings ?? []);
  // ZERO IS NOT ABSENCE — the same rule the HTML section states. A run that grouped and found none says
  // so, so a reader never has to guess whether there were no negatives or the grouping never ran.
  if (!total) {
    return `${CODE_BUILT_SECTIONS.reasonedNegatives}\n\nNone. Every retrieved close match on this run is an on-field conflict above — nothing was cleared into this section.`;
  }
  const lines = groups.map((g) => {
    const head = `**${g.ground[0].toUpperCase()}${g.ground.slice(1)}** — ${g.findings.length} mark${g.findings.length === 1 ? "" : "s"}.`;
    const members = g.findings.map((f) => {
      const who = String(f.owner?.name ?? "").trim();
      // The typed net is the sentence. `legal_position` is the fallback for an archived record that
      // predates the net, exactly as the HTML line falls back — never a summary written here.
      const why = String(f.net ?? f.legal_position ?? "").trim();
      return `- **#${f.ordinal} ${f.mark}**${who ? ` — ${who}` : ""}${why ? ` · *${why}*` : ""}`;
    });
    return `${head}\n${members.join("\n")}`;
  });
  return `${CODE_BUILT_SECTIONS.reasonedNegatives}\n\n${lines.join("\n\n")}`;
}

// ── WHETHER EACH REVIEWER CORRECTION REACHED THE RECORD THE REPORT WAS BUILT FROM ───────────────────────
//
// The corrective pass keeps a basis — what each flag changed in the fields a report prints from the record —
// in `_driver/corrections-delivered.json`, and every assembly reads it against the record the report was
// built from and writes the outcome beside it (corrections-delivered.mjs). The last assembly's answer stands.
// corrections-applied.json, which the open points and the verdict re-check read, is not touched.
export const CORRECTIONS_DELIVERED_FILE = "corrections-delivered.json";
// Whether the recheck after the correction saved an accepted review (`read`) or not (`unread`, with why), with the
// entry verdict and the verdict that stood. An unread recheck is a correction nobody verified.
export const CORRECTIVE_RECHECK_FILE = "corrective-recheck.json";
// The correction functions in steps/corrections.mjs read these from here, handed in once as this file loads.
useThePipeline({ CORRECTIONS_DELIVERED_FILE, postRepairCorrectionsPath, postRepairStatePath, recordFromTheSaves, removalRepairedRow, reviewAfterRepairPath, snapshotFindingsForCorrections });

/**
 * Where the review from before the correction stands when the recheck after it saved none, as `{review, inPlace}`: the
 * file holding it, relative to the run, and whether that is the review in place. null when the recheck saved a review,
 * when a review that read the corrected record has replaced it, or when the records cannot be read; each of those
 * builds the open points as they were. Never throws.
 *
 * THE BYTES SAY WHICH REVIEW STANDS, NOT THE CALLS. The recheck's record keeps the sha of the review it found. Those
 * bytes in place mean that review stands, whatever was accepted since: a narrowed review after a repair is accepted and
 * the whole review then put back. Other bytes in place mean another review was saved over it, through the tool or by
 * rewriting the file, and its points are its own. The one such review that did not read the corrected record is a
 * narrowed review that hardened the verdict and stays in place: the earlier review is then the one kept beside it, and
 * the correction's rows are still its flags.
 */
function earlierReviewNotRechecked(P) {
  try {
    const runDir = dirname(P.report);
    const recheck = JSON.parse(readFileSync(driverDir(runDir, CORRECTIVE_RECHECK_FILE), "utf8"));
    if (recheck?.status !== "unread") return null;
    const named = (file) => relative(runDir, file).replace(/\\/g, "/");
    const inPlace = shaOf(P.seniorEyeReview);
    if (inPlace === recheck.reviewSha) return { review: named(P.seniorEyeReview), inPlace: true };
    const narrowed = JSON.parse(readFileSync(paths(runDir).postRepairReview, "utf8"));
    const kept = reviewBeforeRepairPath(runDir);
    return narrowed?.status === "read" && narrowed.whole !== true && inPlace === shaOf(reviewAfterRepairPath(runDir)) && shaOf(kept) === recheck.reviewSha
      ? { review: named(kept), inPlace: false } : null;
  } catch { return null; }
}

/**
 * Read the basis against the record this assembly was built from, and record the outcome: the file, and one
 * run-log row. A run with no basis records nothing. A delivered record that cannot be read is recorded as a
 * failure to look, never as an outcome. Never throws.
 */
export function recordCorrectionsDelivered(P) {   // @internal
  if (!P?.runDir) return null;
  const at = driverDir(P.runDir, CORRECTIONS_DELIVERED_FILE);
  let held = null;
  try { held = JSON.parse(readFileSync(at, "utf8")); } catch { return null; }   // no corrective basis on this run
  if (!Array.isArray(held?.basis)) return null;
  let deliveredDoc = null, reportMd = null;
  try { deliveredDoc = parseFindingsJsonLenient(readFileSync(P.findings, "utf8")); } catch { deliveredDoc = null; }
  try { reportMd = readFileSync(P.report, "utf8"); } catch { reportMd = null; }
  let foldMap = null;
  try { foldMap = readFold(P.runDir)?.map ?? null; } catch { foldMap = null; }
  const rows = deliveredOutcomes({ basis: held.basis, deliveredDoc, foldMap, reportMd });
  const { rows: _rows, error: _error, assembledAt: _assembledAt, ...kept } = held;
  const out = { ...kept, assembledAt: new Date().toISOString(), rows: rows ?? null,
    ...(rows ? {} : { error: "the record the report was built from could not be read, so no correction was compared" }) };
  try { atomicWrite(at, JSON.stringify(out, null, 2) + "\n"); } catch { /* the run-log row below is the record */ }
  try {
    const outcomes = (rows ?? []).reduce((a, r) => (a[r.outcome] = (a[r.outcome] ?? 0) + 1, a), {});
    runLog(P.runDir, rows
      ? { event: "corrections-delivered", ok: true, flags: rows.length, outcomes, reportMdRead: reportMd != null }
      : { event: "corrections-delivered", ok: false, error: out.error });
  } catch { /* a log that cannot be written must not stop the report it describes */ }
  return out;
}

export function assembleReportMd(P, findings, cardOrdinals, { grouped = [], byRight = false } = {}) {   // @internal
  const overviewRaw = existsSync(P.reportOverview) ? readFileSync(P.reportOverview, "utf8") : "---\n---\n";
  let overview = overviewRaw.split(/^#\s+Marks\b/m)[0].replace(/\s*$/, "");   // defensive: overview owns down to # Marks
  // PR-9 (Levels) — the caption budget, enforced at assembly: overall_caption clipped at 3 sentences,
  // overflow MOVED into the Scope-section bucket (motion, never deletion). Recorded for the
  // fold-observability lint row below.
  const folds = [];
  {
    const fc = foldCaption(overview);
    overview = fc.md;
    if (fc.fold) folds.push({ ...fc.fold, surface: "overview:caption" });
  }
  // spec 64 — merge the code-built only-you section into the overview's # Actions block. A model-
  // authored "### Only you can close these" (pre-change prompt, or drift) is REPLACED wholesale —
  // code wins, so the section can never contradict the register the verdict derives from.
  // PR-9 — same pattern for "### Answers to your instructions": code-built from the findings.json
  // ask_answers register joined to the frozen intake asks; an authored section is replaced wholesale.
  try {
    const fdoc = (P.findings && existsSync(P.findings)) ? parseFindingsJsonLenient(readFileSync(P.findings, "utf8")) : null;
    if (Array.isArray(fdoc?.askAnswers)) {
      let intakeAsks = [];
      try { intakeAsks = JSON.parse(readFileSync(paths(P.runDir).intakeAsks, "utf8")).asks ?? []; } catch { /* refless run — register order alone */ }
      const ansSection = buildAskAnswersSection(fdoc.askAnswers, intakeAsks);
      const hasAuthoredAns = /^###\s+Answers to your instructions\b/m.test(overview);
      if (hasAuthoredAns) {
        overview = overview.replace(/^###\s+Answers to your instructions\b[^\n]*\n?[\s\S]*?(?=^###\s|^#\s|$(?![\s\S]))/m, () => (ansSection ? `${ansSection}\n\n` : ""));
      } else if (ansSection) {
        const m = /^#\s+Actions\b[^\n]*\n?/m.exec(overview);
        if (m) {
          // The section OPENS # Actions (the render's hero picks the `ans` bucket wherever it sits,
          // but the .md reads best with the requester's answers first).
          const at = m.index + m[0].length;
          overview = `${overview.slice(0, at)}\n${ansSection}\n\n${overview.slice(at).replace(/^\n+/, "")}`;
        } else {
          overview = `${overview}\n\n# Actions\n\n${ansSection}`;
        }
      }
      overview = overview.replace(/\s*$/, "");
    }
    //, THE SECOND DRIFT PATH — and it produced the same symptom from the other end. The guard was
    // `if (Array.isArray(fdoc?.actions))`, so a run whose findings.json carried NO actions register at
    // all skipped this block entirely and a MODEL-AUTHORED "### Only you can close these" survived
    // verbatim, in whatever shape the model wrote it: no groups, no tags, no relation to the register the
    // verdict derives from. Spec 64 already ruled the section code-built ("code wins, so the section can
    // never contradict the register") — this is that ruling applied to the case it did not cover.
    //
    // WITH NO REGISTER THE SECTION IS REMOVED, not rewritten and not inferred. buildOnlyYouSection("")
    // is the honest answer to "which of these does the code vouch for?" when the answer is none, and
    // reading kinds back out of authored prose is the guess this file's own comment forbids six lines up.
    // A run with no register also has no conditions to bound the email or the verdict, so nothing
    // downstream loses an input it had.
    //
    // THE GATE IS "IS THERE A REGISTER DOCUMENT", NOT "DOES IT DECLARE ACTIONS". A run with a
    // findings.json has a register and the code answers for the section, empty answer included. A run
    // with NO findings.json at all — no synthesis reached, a replay of a shape that predates the
    // register — is not a register saying nothing, it is nothing to compare against, and the overview
    // passes through as it always did.
    //
    // Assembly-time, like the collapse above: no archived report.md is rewritten by this.
    if (fdoc) {
      const section = Array.isArray(fdoc.actions) ? buildOnlyYouSection(fdoc.actions, fdoc.findings) : "";
      const hasAuthored = /^###\s+Only you can close these\b/m.test(overview);
      if (hasAuthored) {
        // Replace the authored subsection body: from its heading to the next ### / # heading or end.
        // (function replacement — an action text containing "$" must never trigger $-patterns)
        overview = overview.replace(/^###\s+Only you can close these\b[^\n]*\n?[\s\S]*?(?=^###\s|^#\s|$(?![\s\S]))/m, () => (section ? `${section}\n\n` : ""));
      } else if (section) {
        // \n? — a bodiless final "# Actions" heading (a run with actions but no 'Checks we ran'
        // results, exactly the shape the overview prompt instructs) has no trailing newline after
        // the trailing-whitespace strip above; requiring one made match() null and threw.
        const m = /^#\s+Actions\b/m.test(overview)
          ? overview.match(/^#\s+Actions\b[^\n]*\n?[\s\S]*?(?=^#\s|$(?![\s\S]))/m)
          : null;
        if (m) {
          // Insert at the END of the # Actions section (before the next top-level heading or EOF).
          const head = m[0].replace(/\s*$/, "");
          overview = overview.replace(m[0], () => `${head}\n\n${section}\n\n`);
        } else {
          overview = `${overview}\n\n# Actions\n\n${section}`;
        }
      }
      overview = overview.replace(/\s*$/, "");
    }
  } catch { /* never-kill: a malformed findings.json leaves the overview untouched (its own gates own that) */ }
  // ── THE REVIEWER'S OPEN POINTS GO TO THE RUN RECORD, NEVER TO THE CLIENT PAGE ─────────────────────
  //
  // Owner ruling, 2026-09-24: reviewer notes never reach the client page, and a report the reviewer still
  // refuses ships with its rating and nothing added. This site used to put the section at the top of the
  // body, under an earlier ruling that asked for open points printed; the client page then opened with
  // the reviewer's objections in the engine's own vocabulary, most of them about wording, while the
  // objections that mattered went unnoticed. The section is still built, from the same review and the
  // same corrective observation, and it is written beside them for the reviewing lawyer. The overview is
  // not touched, so nothing here can reach a surface a client reads.
  //
  // Assembly-time, like every sibling here: no archived report.md is rewritten by this, and a stale file
  // from an earlier assembly of the same run is removed rather than left to be read as current.
  try {
    // T3b — the driver's own flag-by-flag observation rides in beside the review. NEVER-KILL, and the
    // direction matters: an unreadable or absent corrections-applied.json yields `null`, which records
    // the BLOCKING grounds alone. A run that never had a corrective pass (SIGNED first time) has no such
    // file BY DESIGN and has no unfixed objections either.
    let applied = null;
    try { applied = JSON.parse(readFileSync(P.correctionsApplied, "utf8"))?.rows ?? null; }
    catch { /* absent or malformed — the record falls back to the review alone */ }
    // …and the correction after the review of a delivery-check repair, which records its rows beside them. Its
    // points print through the same rule: anything not positively resolved. Which review raised a point stays in
    // the run's own records (_driver/post-repair-review.json); the printed line adds nothing.
    // Where that review hardened the verdict its points are the verdict's grounds, and print even when changed.
    try {
      const doc = JSON.parse(readFileSync(paths(dirname(P.report)).postRepairCorrections, "utf8"));
      const after = doc?.rows;
      if (Array.isArray(after) && after.length) applied = [...(applied ?? []), ...after.map((r) => ({ ...r, later: true, ...(doc.grounds === true ? { ground: true } : {}) }))];
    } catch { /* no correction after a repair on this run */ }
    // …and a review after a repair that was read and never corrected: the run was parked before its one correction,
    // and nothing on a resume repeats it. Its points are not shown closed, so they print through the same rule.
    try {
      const runDir = dirname(P.report);
      const rec = JSON.parse(readFileSync(paths(runDir).postRepairReview, "utf8"));
      if (rec?.status === "read" && !existsSync(paths(runDir).postRepairCorrections)) {
        const rows = (Array.isArray(rec.points) ? rec.points : []).filter((x) => String(x?.text ?? "").trim())
          .map((x) => ({ text: String(x.text), kind: x.kind ?? null, outcome: "not-checkable", later: true }));
        if (rows.length) applied = [...(applied ?? []), ...rows];
      }
    } catch { /* no review after a repair on this run */ }
    // …and where the recheck after the correction saved no review, the earlier review's points are named as its own.
    const openPoints = existsSync(P.seniorEyeReview)
      ? buildReviewerOpenPointsSection(readFileSync(P.seniorEyeReview, "utf8"), applied, { earlier: earlierReviewNotRechecked(P) })
      : "";
    const record = driverDir(dirname(P.report), REVIEWER_OPEN_QUESTIONS_FILE);
    if (openPoints) {
      mkdirSync(dirname(record), { recursive: true });
      writeFileSync(record, `${openPoints}\n`);
    } else {
      rmSync(record, { force: true });
    }
  } catch { /* never-kill: an unreadable review leaves no record here — the verdict still ships on its own path */ }
  const set = new Set(cardOrdinals ?? []);
  // T6 (H8): the.md assembly and the HTML render share ONE adversarial-ordering comparator.
  const sorted = [...(findings ?? [])]
    .filter((f) => set.has(f.ordinal) && existsSync(P.reportCard(String(f.ordinal))))
    .sort((a, b) => compareBlockingPower(a, b, inDispositionMode(findings)));
  const cards = sorted.map((f, i) => {
    let body = readFileSync(P.reportCard(String(f.ordinal)), "utf8").trim();
    // PR-9 (Levels) — "### The read" budget: 2 sentences / ~120 words at a sentence boundary; the
    // overflow MOVES to the head of "### Full detail" under a "Continued read" bullet. Runs BEFORE the
    // group/open stamps (both key on the card head, which the fold never touches).
    const fr = foldCardRead(body);
    if (fr.fold) { body = fr.md.trim(); folds.push({ ...fr.fold, surface: `card:${f.ordinal}` }); }
    // S2 — THE FRAME IS COMPOSED, NOT DICTATED. A card written under the current contract opens at
    // `### Full detail`: its head, `- ord:`, `- group:` and `- source:` come from the record here rather
    // than being typed by the seat out of the same record and re-parsed back out of its typing. See
    // card-frame.mjs for the head rule and why it is pinned to the delivered corpus, not to any wording.
    //
    // EVERY OTHER SHAPE TAKES THE PATH BELOW, UNCHANGED — archived cards, replays, and a drifted seat
    // that types a head anyway. That is the fail-safe direction: drift renders as it does today instead
    // of being handed a second, composed head above its own. carriesOwnFrame() carries the argument.
    if (!carriesOwnFrame(body)) {
      const netNew = String(f.net ?? "").replace(/\s+/g, " ").trim();
      return composeCard(f, body, {
        group: DISPOSITION_GROUP[f.disposition],
        netLine: `- net: ${netNew || "[no one-clause net on this finding's record]"}`,
        open: i === 0,
      });
    }
    // WP-56 A4 — deterministic `- group:` stamp from the finding's disposition (DISPOSITION_GROUP):
    // presentation plumbing, never a rating gate. The model mislabeled a rated conflict `off-field`
    // (VIBRANTE) and the client summary selected on that label. Gated on disposition being present so
    // legacy/archived cards (composite-era findings) pass through byte-identical.
    const group = DISPOSITION_GROUP[f.disposition];
    if (group) {
      body = /^\s*- group:/m.test(body)
        ? body.replace(/^(\s*)- group:[^\n]*$/m, `$1- group: ${group}`)
        : body.replace(/^(##[^\n]*\n(?:\s*- ord:[^\n]*\n)?)/, `$1- group: ${group}\n`);
    }
    // — the one-clause net is STAMPED from the typed record, exactly as `- group:` is, and for the
    // same reason one level up: report.md was the last surface still carrying a SEPARATELY AUTHORED
    // summary of a finding that report.html and report-data.json already rendered from findings.json.
    // One finding had three summaries and only one source of truth; they happened to agree on the case
    // that was checked, and nothing made them.
    //
    // FULL TEXT. Nothing on any surface shortens a judgment sentence — the renderer's 240-character fold
    // was deleted with (2026-08-06) and no cap replaced it; the sentence is bounded by the shape
    // contract instead. Whitespace is collapsed only so the value cannot break the one-line `- key:`
    // shape parseCards keys on.
    //
    // AN ABSENT NET IS LOUD, NEVER BLANK. The v6 parser refuses a findings.json whose finding carries no
    // net (finding_net_missing — it rides the corrective ladder at synthesis), so reaching here without
    // one means the lenient/quarantine path or a down-level record. That card still renders, and it says
    // what is missing: a stamped marker is distinguishable from a filtered-out finding, which has no `##`
    // block in report.md at all. An omitted line would have been the silent-absence bug this file family
    // has now shipped seven times.
    const net = String(f.net ?? "").replace(/\s+/g, " ").trim();
    const netLine = `- net: ${net || "[no one-clause net on this finding's record]"}`;
    body = /^\s*- net:/m.test(body)
      ? body.replace(/^\s*- net:[^\n]*$/m, netLine)
      : body.replace(/^(##[^\n]*\n(?:\s*- ord:[^\n]*\n)?)/, `$1${netLine}\n`);
    // The retired authored line. The prompt no longer asks for it and nothing reads it any more,
    // but a drifted card that still emits one would put two summaries of one finding back into the
    // delivered report.md — so the assembly drops it rather than trusting the prompt to hold.
    body = body.replace(/^\s*- one:[^\n]*\n?/m, "");
    // open the single highest-risk (first) card: insert `- open: true` right after its `## ` / `- ord:` head.
    if (i === 0) body = body.replace(/^(##[^\n]*\n(?:\s*- ord:[^\n]*\n)?)/, `$1- open: true\n`);
    return body;
  });
  // — the reasoned negatives, from the SAME typed source report.html reads. Appended after the
  // cards rather than woven into them: the card set is frozen on `fullProseOrdinals`, and an off-field
  // finding has no card to weave into — that is the whole reason it was silent here.
  // Read from findings.json rather than the `findings` argument so the section sees EVERY finding,
  // including the ones cardOrdinals excluded, which is the set at issue.
  let negatives = "";
  try {
    const fdocN = (P.findings && existsSync(P.findings)) ? parseFindingsJsonLenient(readFileSync(P.findings, "utf8")) : null;
    const all = Array.isArray(fdocN?.findings) && fdocN.findings.length ? fdocN.findings : (findings ?? []);
    negatives = buildReasonedNegativesSection(all);
  } catch { negatives = buildReasonedNegativesSection(findings ?? []); }   // never-kill: the cards still ship
  // §8 — the grouped section, a SIBLING of the reasoned negatives in the same line grammar with a
  // different grouping key. The negatives grouping is not extended and not touched. Empty on one country
  // (nothing is graded to an entry there), so the assembled bytes are unchanged for product 4.
  const groupedSection = grouped.length ? buildGradedEntriesSection(grouped, { byRight }) : "";
  // "LEFT OPEN", the rows the page will draw (left-open-md.mjs), before the cards: the connector serves this file when a
  // reader's assistant asks for the report, and it listed none of them (design, 2026-11-19). Nothing open draws no
  // heading. Assembly-time, like the sections above: no stored report.md is rewritten by this.
  let leftOpen = "";
  try {
    if (P.findings && existsSync(P.findings)) leftOpen = leftOpenSectionOfRun(P.runDir, parseFindingsJsonLenient(readFileSync(P.findings, "utf8")).coverage, { already: overview });
  } catch { /* never-kill: an unreadable record leaves the section out, and the cards still ship */ }
  writeFileSync(P.report, `${overview}${leftOpen ? `\n\n${leftOpen}` : ""}\n\n# Marks\n\n${cards.join("\n\n")}\n`
    + `${groupedSection ? `\n${groupedSection}\n` : ""}${negatives ? `\n${negatives}\n` : ""}`);
  // PR-9 — fold observability: every fold this assembly performed, persisted for the predelivery lint's
  // flag-only row (and for anyone auditing where the assembly moved words). Overwritten per assembly so
  // a repair re-assembly reports ITS folds, not a stale set. Best-effort — a sidecar miss never blocks
  // the report.
  try {
    ensureDriverDir(P.runDir);
    writeFileSync(paths(P.runDir).cardFolds, `${JSON.stringify({ schema: 1, folds }, null, 2)}\n`);
  } catch { /* observability only */ }
  // Whether each reviewer correction reached the record this report was built from: rewritten on every
  // assembly, like the fold record above, so the last assembly's answer stands. Nothing without a basis.
  try { recordCorrectionsDelivered(P); } catch { /* observability only: the report is assembled either way */ }
  return { cards: cards.length, folds };
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
    const scope = instructedScopeToWrite(job, { jobRebuiltFromStatus: opts.jobRebuiltFromStatus, scopeOnDisk: existsSync(P.instructedScope) }); if (scope) writeFileSync(P.instructedScope, JSON.stringify(scope, null, 2) + "\n");
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
  const { deliverWithoutTheAssessment, publishAndDeliver } = await deliveryEndState({ P, agent, ctx, job, run, opts }, { applyScopeFrontMatterOf, archive, assessmentCoverageOfRun, localLanguageStateOf, reportIdentityRecord, searchLogAuditMd, sentinel, setAsideTheAssessment, writeScopeFactsOf });

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
        const correctionCycle = await runCorrectionCycle({ ctx, run, P, verdict: runState.verdict, firstRef, synthesisKey, synthesisModel, synthesisThinking }, { CORRECTIONS_DELIVERED_FILE, CORRECTIVE_RECHECK_FILE, correctionsExtra, correctiveCycleSettledDecision, removalRepairedRow, restoredFindingsTable, snapshotFindingsForCorrections });
        runState.verdict = correctionCycle.verdict;
        ({ correctiveEntryVerdict, correctiveCycleSettled, correctiveRecheckOk } = correctionCycle);
    } },
    { name: "verdict-gate", run: async () => {
        // The verdict's floors and terminal guards (steps/verdict-gate.mjs).
        // applyVerdictFrontMatter is declared further down, so it goes in by name, read when called.
        ({ applyCoverageFloor, clampOnTheFloorDuty, clampOnTheWritersDuty, deliverAndClamp, followTheRecordsActions, saveTheLabel, saveTheOwedLabel, writeVerdictSidecar } = await runVerdictGate({ P, agent, applyVerdictFrontMatter: (...a) => applyVerdictFrontMatter(...a), correctiveCycleSettled, correctiveEntryVerdict, correctiveRecheckOk, coverageJudgment, ctx, opts, run, runState }, { actionsRegisterListed, saveWithRetries, withdrawByToken }));

        // R.1 primitive #3 (engagement receipt) is computed later, in the pre-delivery block, together with
        // F2 rule-shape + B2b reviewer self-coherence into ONE _driver/reasoning-integrity.json sidecar — that
        // point has report.md + senior-eye-review.md on disk too, so the single writer carries all three signals.
    } },
    { name: "overview-and-cards", run: async () => {
        // The report's overview and its cards (steps/overview-and-cards.mjs).
        ({ applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, findingsForCards, groupedMembers, overviewOpen, rebuildTheDeliveredRecord, restoreTheBrokenRecord, rov, writeScopeFacts, writeUps } = await runOverviewAndCards({ P, applyCoverageFloor, clampOnTheWritersDuty, ctx, followTheRecordsActions, job, run, runState, saveTheLabel, writeVerdictSidecar }, { applyScopeFrontMatterOf, assembleReportMd, consolidateFindingsFile, correctionsTheRestoreLacks, deriveCommonLawCarry, injectDeferralCoverage, injectFrontMatter, injectLaneDepthCoverage, injectMeaningGapCoverage, injectScreenGateCoverage, injectScriptScopeCoverage, injectUncoveredMarketCoverage, keepDeliveredRecordAsHistory, localLanguageStateOf, openAskForClosure, originRowsForReport, planWriteUps, readFindingsForReport, readReadingLog, rebuildDeliveredRecord, reportIdentityRecord, restoreTheRecordThatPassed, rewriteFromBeforeTheSeam, stampCoverageJudgmentRows, withdrawSupersededAudit, writeScopeFactsOf, writeShortEntries }));
    } },
    { name: "delivery", run: async () => {
        // The checks before delivery, their repairs, and the publish (steps/delivery.mjs).
        return await runDelivery({ P, applyCoverageFloor, applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, checkLateBind, clampOnTheFloorDuty, clampOnTheWritersDuty, ctx, deliverAndClamp, findingsForCards, followTheRecordsActions, groupedMembers, job, opts, overviewOpen, publishAndDeliver, rebuildTheDeliveredRecord, restoreTheBrokenRecord, reviewOpen, rov, run, runState, saveTheLabel, saveTheOwedLabel, synthesisKey, synthesisModel, synthesisThinking, writeScopeFacts, writeUps, writeVerdictSidecar }, { CITED_URI_RE, NO_CHANGE, REBUILDS_THE_DELIVERED_RECORD, UPSTREAM_STALE_REPAIR, assembleReportMd, cardsNeverBuilt, fullProseOrdinals, injectFrontMatter, owedCardOrdinals, ownerScreenForDelivery, partitionDeliveryStale, postRepairScope, queuedForTheRecordOnly, readFindingsForReport, readGoodsHanded, reassembleFromTheRecord, recordChangeOwesReview, recordGoodsHanded, retainStateBeforeReview, runPostRepairReview, runWholeReviewForRecord, stagesStaleOnPlacement, unreadRecordFindingOnly, unreadRecordReview, whatTheRepairLeftStale });
    } },
  ] });
}

// ── A DELIVERY WITHOUT THE OVERALL ASSESSMENT: WHAT IT SETS ASIDE AND WHAT IT READS ───────────────────────────────

/** Every artifact of the overall assessment an earlier pass can leave in the run, as a path. */
function assessmentArtifacts(P, runDir) {
  return [
    P.findings, P.narrative, P.report, P.reportOverview, P.reportCardsDir, P.audit, P.seniorEyeReview, P.caseLaw,
    P.caseLawCitations, P.doubtClosure, P.clientSummary, P.emailBody, P.correctionsApplied,
    join(runDir, REPORT_IDENTITY_FILE), join(runDir, ".published"),
    ...["verdict.json", "senior-rights.json", "corrections-state.json", "corrective-cycle.json", CORRECTIVE_RECHECK_FILE,
      "predelivery-lint.json", "reasoning-integrity.json"].map((n) => driverDir(runDir, n)),
    declinationCallPaths(runDir, 0).ledger,
  ].filter(Boolean);
}

/**
 * Move every assessment artifact an earlier pass left under `_driver/not-completed/set-aside/`, so no rejected draft,
 * earlier verdict, overview or published record can reach a surface of a delivery made without the assessment. Kept,
 * not deleted: the run's record still holds them. Returns the names moved. IMPURE (moves files in the run).
 */
export function setAsideTheAssessment(P, runDir) {   // @internal
  const dest = driverDir(runDir, NOT_COMPLETED_DIR, "set-aside");
  const moved = [];
  for (const src of assessmentArtifacts(P, runDir)) {
    if (!existsSync(src)) continue;
    mkdirSync(dest, { recursive: true });
    const name = relative(runDir, src).replace(/[\\/]/g, "__");
    const to = join(dest, name);
    rmSync(to, { recursive: true, force: true });
    renameSync(src, to);
    moved.push(name);
  }
  return moved;
}

// The register ledger's closed statuses as the shipped coverage states of a delivery made without the assessment.
// "Confirmed-clean" is the write-up's claim that every right it found is reported, and with no assessment nothing is
// reported, so the row is an open item, with the shipped gap reason. A slice the provider could not express was not
// run. A family the reading turn chose not to ask takes the "Note" state its withheld families already take.
const LEDGER_STATE = { "confirmed-clean": "open", "coverage-limited": "coverage-limited",
  deferred: "not-searched", "withheld-by-judgment": "note" };
// The note an open row carries: the shipped gap row's own reason (deferral-row.mjs), never the write-up's text.
const OPEN_ROW_NOTE = plainDeferralReason(NOT_COMPLETED);

/**
 * The register coverage ledger's rows as the report's coverage rows, in a delivery made without the assessment: each
 * row's recorded status as a shipped state (LEDGER_STATE), its unit in the reader's label, and no row clean. The row's
 * reason is not printed: the write-up wrote it for the assessment, in the engine's own words, and in a normal run
 * synthesis writes the reader's note in its place. An open row carries the shipped gap reason; every other row carries
 * no note, and nothing replaces the reason. PURE.
 */
export function assessmentCoverageRows(ledgerRows) {   // @internal
  return (Array.isArray(ledgerRows) ? ledgerRows : []).map((r) => {
    const state = LEDGER_STATE[String(r?.status ?? "").trim().toLowerCase()];
    const unit = String(r?.unit ?? r?.axis ?? "").trim();
    return state && unit ? { area: coverageUnitLabel(unit), state, note: state === "open" ? OPEN_ROW_NOTE : "" } : null;
  }).filter(Boolean);
}

/**
 * The coverage rows a delivery without the assessment states. The register write-up's own ledger where it saved one;
 * where it never did, because placement or the write-up is the step that failed, the driver's own coverage form, whose
 * rows the frozen plan, the plan receipt and the bands give, and whose statuses the write-up records as it rules. A
 * row it never ruled is an open item, with the shipped gap reason and no words of the engine's. IMPURE (reads the run).
 */
export function assessmentCoverageOfRun(runDir) {   // @internal
  const ledger = loadCoverageLedger(runDir);
  const fromLedger = assessmentCoverageRows(ledger.rows);
  if (fromLedger.length) return fromLedger;
  let rows = readCoverageForm(runDir).rows;
  if (!Array.isArray(rows)) {
    const { input } = coverageFormInput(runDir);
    rows = input ? buildCoverageForm(input).rows : [];
  }
  const ruled = assessmentCoverageRows(formLedgerRows(rows));
  const unruled = (rows ?? []).filter((r) => r && r.kind !== "family" && !LEDGER_STATE[String(r.status ?? "").trim().toLowerCase()])
    .map((r) => String(r.unit ?? r.axis ?? "").trim()).filter(Boolean)
    .map((unit) => ({ area: coverageUnitLabel(unit), state: "open", note: OPEN_ROW_NOTE }));
  return [...ruled, ...unruled];
}

/**
 * The audit a run delivers without its assessment: the search log it holds, from the register write-up and the web
 * search, with no record the assessment would have rated and no placement set-aside. PURE apart from reading the run.
 */
export function searchLogAuditMd(P) {   // @internal
  const read = (p) => { try { return existsSync(p) ? readFileSync(p, "utf8") : ""; } catch { return ""; } };
  const commonLawGrid = read(P.commonLawGrid) || null;
  return buildAuditMd(read(P.registerFindings), read(P.commonLaw),
    { findings: [], readingLog: readReadingLog(P), commonLawGrid, placementRows: [], searchLogOnly: true });
}

/**
 * THE MASTHEAD'S SCOPE FACT, derived and written: `_driver/scope-facts.json`, the pure join of the instructed scope, the
 * frozen plan, the band states and the coverage ledger (scope-facts.mjs). One author for both reports: the one the
 * assessment completed and the one delivered without it. Returns the facts, or null with no scope to state. IMPURE.
 */
export function writeScopeFactsOf(ctx, P, runDir) {   // @internal
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
  const plan = ctx.registerPlan ?? readJson(P.registerPlan);
  const instructed = readJson(P.instructedScope);
  if (!plan && !Array.isArray(instructed?.classes)) return null;   // a run with no register layer and no instructed classes has no scope fact to state
  const planExecution = ctx.planExecution ?? readJson(P.planExecution);
  const facts = deriveScopeFacts({
    instructedScope: instructed,
    plan,
    planExecution,
    coverageRows: loadCoverageLedger(runDir).rows,
    withheldQids: waitingFamilyStates(runDir, planExecution?.awaiting).withheld.map((f) => f.qid),
    markets: orderMarketsOf(ctx, plan),
  });
  facts.derived_from = Object.fromEntries([
    ["instructed_scope", P.instructedScope], ["register_plan", P.registerPlan],
    ["plan_execution", P.planExecution], ["coverage_ledger", P.registerCoverageLedger],
  ].filter(([, p]) => existsSync(p)).map(([k, p]) => [k, fileMeta(p)]));
  try {
    atomicWrite(P.scopeFacts, JSON.stringify({ ts: new Date().toISOString(), ...facts }, null, 2) + "\n");
    runLog(runDir, { event: "scope-facts", classes: facts.classes_line, states: Object.fromEntries(Object.entries(facts.per_class).map(([c, v]) => [c, v.state])) });
  } catch (e) { note(`scope-facts write failed (non-fatal): ${e.message}`); }
  return facts;
}

/** Stamp the driver-owned `classes:` and `coverage_line:` from the scope fact onto report.md. IMPURE. */
export function applyScopeFrontMatterOf(P, runDir) {   // @internal
  let facts = null;
  try { facts = JSON.parse(readFileSync(P.scopeFacts, "utf8")); } catch { return; }
  const fields = {};
  if (facts?.classes_line) fields.classes = facts.classes_line;
  if (facts?.coverage_line) fields.coverage_line = facts.coverage_line;
  if (!Object.keys(fields).length) return;
  const wrote = injectFrontMatter(P.report, fields, runDir);
  if (wrote) runLog(runDir, { event: "scope-frontmatter", classes: facts.classes_line ?? null, coverage_line: Boolean(facts.coverage_line) });
}

/**
 * THE REPORT'S IDENTITY, as the driver states it: the nine front-matter keys of `_driver/report-identity.json`,
 * which the overview's shell and the report read. `displayVerdict` supplies the rating's two keys; a run whose
 * overall assessment was not completed passes null, and the two keys are then null, so no surface is handed a rating
 * the run never reached. PURE apart from reading the run's status for its start date.
 */
export function reportIdentityRecord(job, ctx, runDir, displayVerdict = null) {   // @internal
  const idMarks = Array.isArray(job.marks) ? job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean) : [];
  const clRan = !ctx.registerOnly;
  let runDate = null;
  try { runDate = String(JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"))?.startedAt ?? "").slice(0, 10) || null; } catch { /* no status yet — the date half is omitted rather than invented */ }
  return {
    schema_version: 1,
    matter: job.ref ?? job.tmp ?? null,
    title: job.name ?? job.markName ?? idMarks[0] ?? null,
    client: job.customer ?? ctx.profile?.name ?? null,
    use: job.goods ?? null,
    classes: Array.isArray(job.classes) ? job.classes.join(", ") : (job.classes ?? null),
    run: [runDate, providerMeta(ctx?.register ?? REGISTER_PROVIDER).label].filter(Boolean).join(" · ") + (clRan ? " + common-law" : ""),
    overall_label: displayVerdict?.tier ?? null,
    overall_badge: displayVerdict?.badge ?? null,
  };
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
    // a reclaim and a resume come to disagree about which directory is the run. The import is lazy
    // because runner.mjs imports THIS module; at this point both are loaded and nothing cycles.
    const { findRunDirFor } = await import("./runner.mjs");
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

// ── A MEANING SEARCH THAT DID NOT COMPLETE REACHES THE CLIENT'S OWN PAGE, NOT ONLY THE AUDIT ────────────
//
// The connotation gate delivers a run whose dictated meaning searches did not all complete, and records
// each unfinished one as a gap carrying its term — a gap the engine wrote for a search that never came
// back, or the provider's own row for one it refused. The audit read those gaps; the report was never
// handed the grid, so whether a client learned a meaning search was missing was up to the synthesis
// model. This puts each on the coverage the report renders, the way an unclosed follow-up already is:
// the same row, `deferralCoverageRow`, and an approved reader sentence that says it is left open — true
// of a drop and of a refusal alike. Telling the two apart on the page
// would need a sentence nobody has approved, and is not attempted here.
//
// The same guard as `injectDeferralCoverage`: a gap synthesis already weighed in is not added twice, and
// a findings.json that fails its own schema after the push is left as it was.
// THE WORDS ARE CHOSEN, NOT THE CAUSE: of the approved reasons, "nothing in the run's own record confirms it
// was searched" is true of a search that never came back AND of one the provider refused, and does not
// repeat the row's own "not completed this run" the way the generic fallback does. It borrows that arm's
// sentence only; if the arm is ever reworded for its own case, re-read this row against it.
const MEANING_SEARCH_UNFINISHED = "not-verified-closed";
export function injectMeaningGapCoverage(P, runDir, note) {   // @internal — exported so the refusal shape is testable without a run
  try {
    if (!existsSync(P.commonLawGrid) || !existsSync(P.findings)) return;
    const grid = JSON.parse(readFileSync(P.commonLawGrid, "utf8"));
    const terms = [...new Set((Array.isArray(grid?.gaps) ? grid.gaps : [])
      .filter((g) => String(g?.platform ?? "").toLowerCase() === "connotation")
      .map((g) => String(g?.term ?? "").trim()).filter(Boolean))];
    if (!terms.length) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];
    const normTxt = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const covText = normTxt(doc.coverage.map((c) => `${c.area} ${c.note ?? ""}`).join(" "));
    let added = 0;
    for (const term of terms) {
      const slice = normTxt(term).split(" ").filter((w) => w.length >= 4).slice(0, 4).join(" ");
      if (slice && covText.includes(slice)) continue;          // synthesis already weighed it in
      doc.coverage.push(deferralCoverageRow(term, MEANING_SEARCH_UNFINISHED));
      added++;
    }
    if (!added) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "meaning-gap-coverage-rows", settles: [] });
    note(`[common-law] ${added} meaning search(es) that did not complete now reach the report's coverage`);
    runLog(runDir, { event: "meaning-gap-coverage", added });
  } catch (e) {
    note(`[common-law] meaning-gap coverage skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
    coverageRowNotAdded(runDir, "meaning-gap", e);
  }
}

/**
 * THE DRIVER'S WRITES FROM BEFORE THE SEAM, MADE AGAIN AFTER A SYNTHESIS SAVE THAT FOLLOWS IT.
 *
 * Two writes into the findings record run before the seam rather than at it: the basis derivation, which demotes a
 * `verified-from-record` stamp the reading log cannot back, and the deadline enrichment, which gives a finding with
 * no deadline the register's own opposition window. A save after the seam renders the record from the model's call.
 * A patch keeps both, because each also lands in the merge base the patch is merged onto; a whole re-send replaces
 * that base, and they went with it. The seam's own writes were made again after such a save, and these two were not,
 * so the delivered record claimed reads no step had made, and every card whose finding had carried a demoted stamp
 * read as stale and was rebuilt for a finding the save had not changed. They run again here, in the order the pass
 * ran them, before the seam's writes. Each leaves a record that already carries it as it is, and neither throws.
 */
export function rewriteFromBeforeTheSeam(ctx) {   // @internal
  settleDerivedBases(ctx, "late-save");
  enrichFindingDeadlines(ctx.paths, ctx.paths.runDir, note, { nowMs: deadlineClockOf(ctx.paths.runDir) });
}

/**
 * The clock the run's deadline enrichment judged its windows by, so a window is judged again exactly as it was
 * judged the first time, never moved across its edge by the minutes a repair took. Now, on a run whose enrichment
 * recorded none: it judged nothing, so there is nothing to keep it consistent with. Never throws.
 */
function deadlineClockOf(runDir) {
  try {
    const at = Date.parse(JSON.parse(readFileSync(paths(runDir).deadlineEnrich, "utf8"))?.judged_at);
    return Number.isFinite(at) ? at : Date.now();
  } catch { return Date.now(); }
}

/**
 * The reader's name for a planned search that never ran and that no open ledger row on its axis claims —
 * the orphan row of `coverageJudgmentRows`. Its area is the plan's qid, which a lawyer cannot read; the
 * label is composed the way the workbook's released-family rows compose theirs (publish/index.mjs
 * releasedFamilyRows): the plan entry's unit in the coverage form's grammar, its axis head in the reader's
 * words. `{}` when the frozen plan does not carry the entry, so the row keeps the identifier and nothing is
 * invented in its place. PURE.
 */
function orphanAreaLabel(qid, axis, plan) {
  const entry = (Array.isArray(plan?.entries) ? plan.entries : []).find((e) => e?.qid === qid);
  if (!entry) return {};
  const label = coverageUnitLabel(unitLabel(axis || entry.axis, entry));
  return label && label !== qid ? { areaLabel: label } : {};
}

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

/**
 * THE WRITE-UPS A RECORD OWES, PLANNED IN ONE PLACE. PURE.
 *
 * §9: a finding owed prose earns a full card where its form is `full`, and the rest render code-side, as a short
 * entry or as a line in the grouped section (§8). The first assembly made this plan inline, and the delivery check's
 * repair, which reassembles the report after a synthesis save has moved the record, made its own: every finding owed
 * prose and no grouped section. So a report reassembled on a graded product lost its "Also on the register" section,
 * where its grouped findings are read by territory or by right, each short entry kept the text composed before the
 * save, and the cards a run owed stayed the ones the first plan named whatever the record became. One plan, made here
 * from the record as it stands, now serves the first build, the delivery path and every reassembly.
 *
 * The floor tier joins on `mark_text` (floorTierByMark); an absent band shape yields an empty map, and every finding
 * then reads as holding no floor. On one country every form is `full`, so the plan is `fullProseOrdinals` itself.
 */
export function planWriteUps(findings, depth, bandShape) {   // @internal
  const floorTiers = floorTierByMark(bandShape);
  const formOf = (f) => writeUpForm(depth, f, { floorTier: floorTiers.get(floorMarkKey(f?.mark)) ?? null });
  const byOrdinal = new Map((findings ?? []).filter((f) => f?.ordinal != null).map((f) => [f.ordinal, f]));
  const proseOrdinals = fullProseOrdinals(findings);
  const cardOrdinals = proseOrdinals.filter((ord) => formOf(byOrdinal.get(ord)) === "full");
  const entryOrdinals = proseOrdinals.filter((ord) => formOf(byOrdinal.get(ord)) !== "full");
  const entryFindings = entryOrdinals.map((ord) => byOrdinal.get(ord)).filter(Boolean);
  // Worldwide groups by the right, multi-country by territory: the depth row's prose rung says which.
  const byRight = String(depth?.narrativeProse ?? "") === "adversarial";
  const { groups, singles: entrySingles } = groupEntries(entryFindings, { byRight });
  return {
    cardOrdinals, entryOrdinals, entryFindings, byRight, entrySingles,
    // Assembly sees full cards AND short entries; a grouped finding is a line in its section, never a card.
    assembledOrdinals: [...cardOrdinals, ...entrySingles.map((f) => f.ordinal)],
    groupedMembers: groups.flatMap((g) => g.findings),
  };
}

/** Each short entry's card file, composed by code from its finding as it stands. No model turn. */
function writeShortEntries(P, entrySingles) {
  for (const f of entrySingles) {
    try { writeFileSync(P.reportCard(String(f.ordinal)), `${shortEntryBody(f)}\n`); }
    catch (e) { note(`short entry ${f.ordinal} not written (${String(e?.message ?? e).slice(0, 80)}) — it renders structured-only, as an absent card always has`); }
  }
}

/** The full cards the record owes as it stands now, in its order. */
function owedCardOrdinals(P, depth) {
  return planWriteUps(readFindingsForReport(P).findings, depth, safeReadJson(P.bandShape)).cardOrdinals;
}

/**
 * THE CARD A FINDING ADDED AFTER THE CARDS IS OWED. A card with no stamp is never stale, so a finding that a
 * synthesis save after the cards made owed a full card, at an ordinal the first plan never dispatched one for (a
 * finding it added, or one it moved from a short entry to a full card), got no card call, and the report rendered it
 * structured-only or as the short entry. Each such card joins the delivery check's repair once, as owed and never
 * built; a card the first plan dispatched and that failed keeps that outcome, as a failed card always has. Returns
 * entries in the shape `staleOnPath` gives.
 */
function cardsNeverBuilt(P, depth, firstPlan) {
  const dispatched = new Set(firstPlan ?? []);
  return owedCardOrdinals(P, depth)
    .filter((o) => !dispatched.has(o) && !readStamp(P.runDir, `report-card:${o}`))
    .map((o) => ({ label: `report-card:${o}`, changed: [{ name: `${o}.md`, was: null, now: null, via: "never-built" }] }));
}

/** The repaired stages whose output the record-carry trace or the Audit Trail reports. */
const REBUILDS_THE_DELIVERED_RECORD = new Set(["placement-inquiry", "register-digest", "synthesis", "narrative-refutation"]);

/**
 * Keep the Audit Trail, the record-carry trace and the doubt ledger as they stand, under _history/<ts>-audit-and-trace-
 * <reason>/, before any of them is written again, so a pass that writes them over a repair or a resume never loses what
 * the earlier state said. The pass that wrote them may have delivered nothing: a pass the delivery check held writes
 * them too. Returns the directory, or null when there was nothing to keep. Best-effort, like every snapshot.
 */
export function keepDeliveredRecordAsHistory(P, reason) {   // @internal — driven by its test with a run's own files
  const files = [P.audit, P.recordCarry, paths(P.runDir).doubts].filter((f) => existsSync(f));
  if (!files.length) return null;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(P.runDir, "_history", `${ts}-audit-and-trace-${reason}`);
    mkdirSync(dest, { recursive: true });
    for (const f of files) copyFileSync(f, join(dest, basename(f)));
    return dest;
  } catch { return null; }
}

/**
 * The reading audit's lookups (band-server appends every lookup to _driver/reading-log.jsonl). Read on any run that
 * derived a band shape, an empty list included, because a band-consuming stage that read nothing is a fact the audit
 * must show; null on a run with no shape, which renders no section. A torn tail line never kills the audit.
 */
function readReadingLog(P) {
  if (!existsSync(P.bandShape)) return null;
  const log = [];
  try {
    for (const line of readFileSync(P.readingLog, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { log.push(JSON.parse(line)); } catch { /* a torn tail line never kills the audit */ }
    }
  } catch { /* no lookups recorded — the empty array IS the disclosure */ }
  return log;
}

/**
 * Take an audit that no longer describes the run out of the place publishing reads it from, keeping it under _history
 * (unless the caller has just kept it). The report then ships without that Audit Trail, as it does when a first build
 * fails, never with an earlier one offered as current; the publisher still builds the workbook from the current
 * findings. Returns whether an audit was withdrawn.
 */
export function withdrawSupersededAudit(P, reason, { keep = true } = {}) {   // @internal — driven by its test with a run's own files
  if (!existsSync(P.audit)) return false;
  if (keep) keepDeliveredRecordAsHistory(P, reason);
  try { rmSync(P.audit, { force: true }); } catch { return false; }
  runLog(P.runDir, { event: "audit-withdrawn", reason });
  return true;
}

/** The doubt ledger on disk, written again with the doubts the rebuilt audit carries; what it said of the closure stays. */
function writeDoubtLedgerAgain(P, doubts, truncated) {
  const path = paths(P.runDir).doubts;
  const earlier = safeReadJson(path) ?? {};
  const settled = doubts.filter((d) => d?.status === "checked-and-settled").length;
  const { doubts: _d, minted: _m, settled: _s, open: _o, truncated: _t, ...closure } = earlier;
  writeFileSync(path, JSON.stringify({ minted: doubts.length, settled, open: doubts.length - settled,
    ...(truncated?.length ? { truncated } : {}), ...closure, doubts }, null, 2));
}

/**
 * THE TRACE AND THE AUDIT TRAIL, WRITTEN AGAIN OVER A REPAIR. Both describe a pass before the delivery check repairs
 * anything, and a stage that check re-runs can change what they report: a repeated placement pass can reverse a
 * set-aside or change its ground. This keeps the pair as it stands under _history, then writes the trace and the audit
 * again from the run's files, so what is delivered describes the decision that stands at delivery. `inputs` are what the
 * pass built its audit from. The doubts minted from the trace follow the trace written again (recordCarryDoubtsAgain);
 * every other doubt and ask stands as the pass raised and closed it, and nothing is dispatched again.
 * A rebuild that fails, the trace written and the audit not among the ways, withdraws the audit on disk: it describes
 * the state before the repair. Returns {ok, counts} or {ok:false, reason}. IMPURE (writes the run).
 */
export function rebuildDeliveredRecord(ctx, inputs = {}, trigger = "stale-repair") {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  keepDeliveredRecordAsHistory(P, trigger);
  try {
    let findingsNow = [], actionsNow = [];
    try {
      if (existsSync(P.findings)) {
        const parsed = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
        findingsNow = parsed.findings ?? [];
        actionsNow = parsed.actions ?? [];
      }
    } catch { /* the audit still builds without them */ }
    deriveRecordCarry(ctx, trigger, { findings: findingsNow });
    const registerFindingsText = readFileSync(P.registerFindings, "utf8");
    // THE DOUBTS MINTED FROM THE TRACE FOLLOW THE TRACE. The record-carry family was minted from the trace before the
    // repair; read against the trace written just above, a record the repair answered loses its doubt and one it left
    // unreasoned gains one, keyed by record so no closure the closure step recorded moves onto another record. Every
    // other family stands as the pass raised and closed it.
    let doubts = inputs.doubts ?? null, doubtTruncations = inputs.doubtTruncations ?? null;
    if (Array.isArray(doubts)) {
      const coverageRows = (() => { try { const rows = JSON.parse(readFileSync(P.registerCoverageLedger, "utf8")); return Array.isArray(rows) ? rows : []; } catch { return []; } })();
      const re = recordCarryDoubtsAgain(doubts, safeReadJson(P.recordCarry),
        { stitch: (ds) => stitchDoubts(ds, { findings: { findings: findingsNow, actions: actionsNow }, coverageRows, registerFindingsText }) });
      doubts = re.doubts;
      // A trace that could not be read says nothing about any record: the doubts stand as raised, and so does the count
      // of those the cap left out.
      if (!re.unavailable) doubtTruncations = [...(doubtTruncations ?? []).filter((t) => t?.source !== "record-carry"),
        ...(re.omitted ? [{ source: "record-carry", minted: re.minted, omitted: re.omitted }] : [])];
      writeDoubtLedgerAgain(P, doubts, doubtTruncations);
      if (re.fresh.length || re.dropped.length || re.unavailable)
        runLog(P.runDir, { event: "record-carry-doubts-again", trigger, fresh: re.fresh.length, dropped: re.dropped.length, ...(re.unavailable ? { unavailable: true } : {}) });
    }
    const again = buildAuditMd(registerFindingsText, inputs.commonLawText ?? "",
      { findings: findingsNow, doubts, asks: inputs.asks ?? null, readingLog: readReadingLog(P),
        commonLawGrid: inputs.commonLawGrid ?? null, doubtTruncations,
        registerPresence: inputs.registerPresence ?? null, placementRows: placementAuditRows(P) });
    if (!again.counts.findings) throw new Error("0 findings parsed from the spine tables");
    writeFileSync(P.audit, again.md);
    runLog(P.runDir, { event: "audit-rebuilt", trigger, ...again.counts });
    return { ok: true, counts: again.counts };
  } catch (e) {
    const reason = String(e?.message ?? e).slice(0, 160);
    runLog(P.runDir, { event: "audit-rebuild-failed", trigger, reason });
    withdrawSupersededAudit(P, `${trigger}-failed`, { keep: false });   // the pair as it stood was kept above
    return { ok: false, reason };
  }
}

/**
 * Reassemble report.md from the record as it stands, as the first assembly did: the plan made again, each short entry
 * composed again from its finding, and the grouped section built. Returns the plan.
 */
export function reassembleFromTheRecord(P, findings, depth) {   // @internal
  const plan = planWriteUps(findings, depth, safeReadJson(P.bandShape));
  writeShortEntries(P, plan.entrySingles);
  assembleReportMd(P, findings, plan.assembledOrdinals, { grouped: plan.groupedMembers, byRight: plan.byRight });
  return plan;
}

// Hoisted, so placed last: an import at the top would move every line citation into this file.
import { commandLineRefusal } from "./run-requirements.mjs";
import { runTables } from "./order-tables.mjs";
import { leftOpenSectionOfRun } from "./left-open-md.mjs";   // the page's Left open rows, printed into report.md
import { axisTwin, followUpKinds, kindsForFollowUp } from "./follow-up-twins.mjs";   // when a written row stands in for a Follow-up row, as the page decides
