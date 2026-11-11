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
import { correctionNamedLines, correctionNamedOrdinals, correctionNamedSet, correctionReading, correctionRows, enforceCorrectionsReachFindings, flagOrdinals, recordCorrectionsBasis, repairUnnamedRemovals, rollbackCorrectivePass, runPostRepairCorrection, useThePipeline } from "./steps/corrections.mjs";
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
import "./engine/mcp/http-dispatcher.mjs"; import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename, resolve, relative } from "node:path";   // resolve: the resume line must work from any cwd
import { driverDir, driverRel, ensureDriverDir } from "../shared/driver-dir.mjs";
import { REVIEWER_OPEN_QUESTIONS_FILE } from "./reviewer-open-points.mjs";   // the run-record file the reviewer's open points go to, and the only thing that reads them now
import { goodsOf } from "./queue-markers.mjs";   // — one reading of "does this job name goods", shared with the intake gate
import { fileURLToPath } from "node:url";
import { runStage, correctionHint, gridLedgerNameFor, draftCarryEligible, toolWrittenArtifact, selectEngine, saidBackOnly } from "./gateway.mjs";
// — the arm's TOOL WIRING, for its context receipt. Read through the same two functions the
// gateway dispatches with, never re-derived: a receipt that described a second computation would be
// describing a dispatch that did not happen.
import { toolGroupsForStage as experimentToolGroups, buildGatherMcpConfig as experimentMcpConfig, allowedToolsFor as experimentAllowedTools } from "./engine/mcp/gather-config.mjs";
import { readBestDraft, bestDraftDir } from "./best-draft.mjs";
import { canonicalJurisdictionCode, isKnownJurisdictionCode } from "./jurisdiction-codes.mjs";
import { probeSeed as orderProbeSeed } from "./order-probe.mjs";   // item 11 — records which ordering arm a run ran under
import { config, resolveModel, laneArmed } from "./driver.config.mjs";
import { registerAdapter } from "./engine/run-choices.mjs";   // the run's register adapter, from ctx.register
import { codexSandboxBypassed } from "./engine/openai-agent.mjs";        // — a replay is refused where nothing keeps a stage's commands out of the answers it replays
import { buildRunContext, deriveSlug, kebab } from "./phase0.mjs";
import { crossBuildResumeRefusal } from "./one-build-per-run.mjs";   // a run is finished on the build it started on (owner, 2026-11-09)
import { paths, STAGES, axisTier, decideAxes, assertEffectiveTier, lines, whatsappRouting, chainEntries, stageOrdinal, stageInputs, dependencyOrder, REGISTER_AXES, REGISTER_ENUMERATE_TOOL, buildEscalationFollowup, buildEnvelopeCloseFollowup, buildFrameReopenFollowup, buildFrameReopenRetryMessage, thinkingFor, composeFollowup, stampDispatchBlocks, recordEmptyReturn, nothingFound, nothingToRead, providerMeta, inquiryRungDirective } from "./stages.mjs"; import { bandSizeForStage, derivedLimitSec, limitExceedsCeiling, ceilingRefusal, stagesRefusingBand } from "./band-size.mjs";
import { handResearchAnswers, RESEARCH_ANSWERS_FILE, RESEARCH_REPLAY_FILE, replayAnswersFile, savedResearchCount, runResearchAnswers, researchAnswerKey, handResearchAfterReview } from "./research-answers.mjs";   // the research a stage's earlier attempts got, handed to a later one; a replay of it
import { IDENTITY_FILE as REPORT_IDENTITY_FILE } from "./report-overview-record.mjs";
import { readPartNotCompleted, NOT_COMPLETED_DIR } from "./parts-not-completed.mjs";
import { renderUnitNote, readBandAccount } from "./register-unit-record.mjs";   // a unit that could not finish, its note rendered from its band
import { bandWithSlicesOut, slicesTakenOutByAxis } from "../shared/slices-taken-out.mjs";   // a band read with the slices a check could not prove ran taken out
import { dispatchRows, clearedSignatures } from "./seat-attempts.mjs";
import { CONTEXT_DERIVATIONS, DISPATCH_EXTRAS, INLINE_CONTEXT, sandboxManifest, sandboxGaps, derivationsFor } from "./stage-context.mjs";   // — what a stage is actually handed
import { derivedStateOf, recordedDerivedState, replayOfDerivation } from "./derived-state.mjs";   // the register picture a dispatch was handed, so a replay can be checked against it
import { parseVerdict, parseCorrectionKinds, parseCorrections, validators } from "./verify.mjs";
import { nextRefutationSeq, readAcceptedReviewSince, REVIEW_EXCLUSIONS_FILE } from "./narrative-refutation-record.mjs";   // T3b — the typed flags, not the re-parse
import { unresolvedFlags, reportLines } from "./corrections-feedforward.mjs";
import { deliveredOutcomes } from "./corrections-delivered.mjs";   // whether each correction reached the record the report was built from
import { parseCoverageLedgerJson, parseCoverageLedgerFull, classTokensFromScopeText, coerceToolAbsenceDeferred, applyTaintDeferred, splitDeferredByCloseability, formRowUnitKey, coverageLedgerTableRows, coverageUnitLabel, COVERAGE_STATUSES } from "./coverage-ledger.mjs";
import { receiptSettled, readEnvelopeDecision, settleReceipt, settledDeferralsSection, readStickyGaps } from "./envelope-settle.mjs";
import { readActiveTaintAxes } from "./register-taint.mjs";
import { parseNamedBand, mergeNamedBands, quarantineUnknownStates, bandRecords } from "./named-band.mjs";
import { recordOriginsFor, activeRecordOrigins } from "./record-origins.mjs"; import { recordBlanking, FOREIGN_HOST_TOKEN } from "./foreign-record-links.mjs";
import { REGISTER_PROVIDER } from "./driver.config.mjs";
import { noteRegisterServed } from "./register-served.mjs";   // which registers actually served this run — noted eagerly from the dispatch's own resolver, and reconciled at publish against the ledger rows, which carry the vendor per call
import { FACTS_FILE as DIGEST_FACTS_FILE, ACCOUNTING_STAMP as DIGEST_ACCOUNTING_STAMP, digestAccountingGap, digestBatchBrief, batchesOf } from "./register-digest-record.mjs";   // conversion 11 — the render's facts sidecar and the accounting era stamp
import { buildBandShape, dominantElementComposites, deriveRegisterPositions, floorTierByMark, floorMarkKey, isLiveRecord } from "./band-shape.mjs";   // PR-8 — the deterministic reading layer; P2-A — candidates + positions
import { deriveOwnerScreen, ownerScreenNegative } from "./owner-screen.mjs";   // P2-B — the owner×element screen's own receipt
import { reconcileRecall, parseFindingsEndings, parseCrowdRulings, readOkRecordUris,
  unprovableRecordBases, applyDerivedBases,
  carryRecallFollowup, unendedSignature, recallReconciliationEvent, RECALL_RECONCILIATION_SCHEMA_VERSION } from "./recall-reconciliation.mjs";   // P2-A — the recall spine
import { writeUpForm } from "./write-up-form.mjs";   // §8/§9 — which findings earn a full card
import { shortEntryBody, groupEntries, buildGradedEntriesSection } from "./write-up-render.mjs";
import { compileRegisterPlan, parseRegisterPlan, resolvePlanAgainstStore, joinPlanToBands, crowdNarrowing, marketStepMarkets, blocksByQidOf, deriveCoverageSkeleton, validatePlanFeasibility, feasibilityMessages, foldSupplementalEntries, fullyDeferredAxes, variantTermIssue, PLAN_AUDIT_HEAD, PLAN_AUDIT_CLASSES, deferExhaustedProviderErrors, ladderExhaustedQids } from "./register-plan.mjs";
// — ONE binding of the office split to this box's env, shared with Depth 2's two lanes.
import { registerCapabilities, registerUnavailableOffices } from "./register-unreachable.mjs";
import { parseVariantManifestModel, famousMarkElements } from "./variant-manifest-model.mjs";
import { meaningAnglesFromMatterContext, meaningAnglesAssertedNone, findConnotationViolations, parsePrRiskResults, connotationReasonKey, parseDispositionForm, CONNOTATION_FORM_TOKEN_SRC, CONNOTATION_UNRULED_REASONS, connotationAuditCounts, DECLINED_RULING } from "./connotation-search.mjs";
// — the merge unions the halves' forms into the canonical one, with the same code the gateway unions
// an attempt with. PURE and acyclic.
import { formSidecarPath } from "./disposition-union.mjs";
import { foldCallVerdicts, partitionUnruledByLedger, detectRulingDrift, ledgerReasonHistogram, ledgerRows, ledgerUnattributed } from "./disposition-call.mjs";
import { readCallVerdicts, callVerdictLedgerExists, callRecordPaths } from "./disposition-tool.mjs";
import { classifyGroundsNote } from "./grounds-grammar.mjs";   // — a charged rating carries its grounds
// — the register coverage form: the driver writes it before the digest dispatches, renders the
// `## Coverage ledger` table and the machine ledger FROM it after the pass, and unions it across passes.
import { documentCoverage, renderDocumentCoverageSection, spliceDocumentCoverage } from "./document-coverage.mjs";   //
import { buildCoverageAbsenceForm, coverageFormAbsence, coverageFormBrief, renderCoverageAbsenceSection, renderCoverageLedgerSection, spliceCoverageLedger, renderCoverageLedgerJsonFromForm, unitLabel, buildCoverageForm, formLedgerRows, isLayerRow, nationalRegistersNotSearched, nationalRegistersNote, orderFormName } from "./coverage-form.mjs";
import { unionCoverageForm } from "./coverage-union.mjs";
import { armCoverageForm, coverageFormInput, coverageFormPaths, coverageFormStamp, readCoverageForm, readCoverageFormInput, waitingFamilyStates, writeCoverageForm } from "./coverage-form-io.mjs";
import { releasedFamilyQids, readWithheldFamilies } from "./withheld-families.mjs";   // the waiting families the reading turn released join as dictated entries
import { readOutstanding, FOLLOW_UP_SEARCH_LIMIT, followUpSearchesSent } from "../providers/_shared/follow-up-searches.mjs";
// The plan join's options, one place: the families the reading turn released, the follow-ups the run's
// safety net did not send, which join as questions not asked rather than missing (follow-up-searches.mjs), and the run's
// main markets, the one market list a crowd of the identical mark is read in (crowdNarrowing): the order's
// countries, else the customer's priority markets, else the markets the customer's field and brand point to, as the
// identical mark's market step used them (W8), else the major markets, where no market step ran.
export const mainMarketsOf = (ctx) => {   // @internal
  try {
    const { scope, priorities, major } = narrowingMarkets(instructedOrder(ctx.paths, ctx.job), ctx.profile);
    if (scope.length) return scope;
    if (priorities.length) return priorities;
    const used = marketStepMarkets(ctx.registerPlan);
    return used.length ? used : major;
  } catch { return []; }
};
const joinOptions = (ctx) => ({ released: releasedFamilyQids(ctx.paths.runDir),
  outstanding: new Set(readOutstanding(driverDir(ctx.paths.runDir)).map((r) => String(r.qid))), mainMarkets: mainMarketsOf(ctx) });
import { unionPlacementForm } from "./placement-union.mjs";
import { placedUriRows, standingSetAside, placementSetAsideGrounds, placementFloorDecisionLines, placementSetAsideLines, placementAuditRows, placementRecallEndings, writePlacementDecisions, rankingNow, rankingToJson } from "./placement-decisions.mjs";   // placement's standing decisions, one check for every reader
export { placementSetAsideGrounds, placementFloorDecisionLines, placementSetAsideLines, placementAuditRows, placementRecallEndings,
  standingPlacementDecisions, writePlacementDecisions } from "./placement-decisions.mjs";
import { readPlacementForm, readPlacementFormInput, writePlacementForm } from "./placement-form-io.mjs";
import { rebuildRunOrder } from "./accepted-order.mjs";   // the order a run was accepted on, kept with it from intake (steps/open-run.mjs)
import { buildSelectionIndex, setAsideKeysOf, ownerFates, servedLines, lineKey } from "./placement-form.mjs";
import { dictatedPaths, findStrayArtifacts, treeSnapshot, findStrayInTree, matterSiblings, findStrayMatterSiblings } from "./stray-artifacts.mjs";   // — a run dir holds no document no stage dictated; — nor does the doctrine tree
import { resolveProfile, loadProfiles, resolveEffectiveProfile, derivedFloor, derivedBatchSize, gridBatchFor, applicantMatchesProfile, NEUTRAL_DELIVERY, recipeProseGuard, withRunPlatforms } from "./profiles.mjs";   // adds profileStoreResolution — the CONFIG store's identity, beside the doctrine tree's
import { resolveSearchPolicy, gateResolvedPolicy, loadRecipes, isRegisterOnly, depthFor } from "./search-policy.mjs";
import { profileOrdinals } from "./profile-selection.mjs";   // lever 3 — driver selection
// THE OFFERING'S own sentence about where the native-language investigation can be bought. It reaches a
// CLIENT REPORT through the script-scope coverage row, which is why it is imported rather than typed:
// the row used to name "Depth 5 (clearance-jx)" — a retired key on a retired ladder — as its remedy.
import { NATIVE_LANGUAGE_REMEDY } from "./products.mjs";
import { resolveTerritories, defaultTerritoryState, clientMarkets, orderTerritories, narrowingMarkets } from "./effective-scope.mjs";   // the ONE territory ladder (the geography stamp included) + the stored-defaults reading
import { acquireSlot, releaseSlot } from "./slot-lock.mjs";
import { withRejected } from "./engine/mcp/supplemental.mjs";
import { runLog, note, fileMeta, outputMeta, stageLog } from "./log.mjs"; import { plainDirective, deferralCoverageRow, plainDeferralReason } from "./deferral-row.mjs"; import { PART_NAMES, NOT_COMPLETED } from "./degraded-parts.mjs"; import { armProduced, readArmSurfaces, producedNothingLine } from "./experiment-honesty.mjs"; import { correctiveReadiness, correctiveRefusalLine, correctivePassState } from "./corrective-arm.mjs";
import { deriveScopeFacts } from "./scope-facts.mjs";
import { editRepairTail, abbrev } from "./repair-contract.mjs";
import { repairFollowup } from "./repair-composers.mjs";
import { seedRunStatus, recordTransition, writeRunStatus, rollupStatus, terminalRunState, signoffPatch, readSignoff } from "./progress.mjs";
import { atomicWrite } from "./run-record.mjs";
import { writeOutboxPacket } from "./outbox.mjs";
import { parseCaseLawProfiles, joinCaseLawProfiles } from "./publish/parse.mjs"; import { buildAuditMd } from "./publish/audit-from-spine.mjs";
import { lastAcceptedMatterFrame, withFrameClasses, frameIdentifiedClassRows, frameHouseElementCandidate, readInstructedScope } from "./matter-frame-record.mjs";   // — the frame's inferred scope, when nothing was instructed; and the classes it judged necessary beyond the instructed ones, each with its reason, which the plan compile gives one identical-mark question apiece (decision 18)
import { bandShapeGoods, instructedOrder, goodsEvidence } from "./record-goods.mjs";   // — the band's goods, read from the run's own records, so the shape can sort by the client's goods
import { frameWebChoiceFor, frameAskedForWebGrid, webGridOf } from "./web-grid.mjs";   // — the web grid the matter frame decides: its stores, its forms, what it set aside
import { mintSupplementalQid, stableStringify } from "./register-plan.mjs";
import { excludeHouseElement, verifyHouseElementOwnership, resolveRegions as resolvePlanRegions, HOUSE_ELEMENT_RECEIPT, rowOutsideProviderOffices } from "./register-plan.mjs";
import { capabilitiesFor } from "./register-capabilities.mjs";
import { resolveRecordExecutor } from "./register-records.mjs";   // — the stamp the late lanes never met
import { slimLine, crowdLine } from "./hit-list.mjs";   // — the list the run works from; crowds ride it as a sibling array
import { stitchDoubts } from "./doubt-ledger.mjs";   // doubt-stitch + doubt-closure (2026-07-22)
// Conversion 6: the two line-form parsers are no longer on the live path — the seat sends typed
// rows and the driver applies THOSE. `parseClosureLines`/`parseAskClosureLines` are still exported and
// still tested: an archived run's doubt-closure.md is a hand-typed artifact and stays readable, which
// is the archive rule — a new way in, never a replacement.
import { pendingWhatIf, claimWhatIf, finishWhatIf, whatIfRefusal } from "./whatif-queue.mjs";   // a queued job is settled before its run archives   // PR-6 — every ask ends (2026-07-29)
// — every placed candidate ends somewhere a reader can see; the ones that do not are counted by name
import { PLACEMENT_CARRY_SCHEMA_VERSION, reconcilePlacementCarry, placementCarryEvent, entryUris, parseCarrySurfaces, classifyPlacement } from "./placement-carry.mjs";
import { FLOOR_DUTY_SCHEMA_VERSION, reconcileFloorDuty, floorDutyEvent, armFloorDuty, floorDutyArmed, floorDutyBlock, floorDutyBlocksSkip } from "./floor-duty.mjs";   // — the era stamp that turns disclosure into a delivery floor
import { snapshotSynthesisBase, restoreSynthesisBase, rebaseSynthesis, lastAcceptedCall, acceptSynthesis, driverReadsFor, handSavedFindings } from "./synthesis-record.mjs";   // — the duty checked against the DELIVERED document; the merge base a corrective pass holds and puts back
import { RECORD_CARRY_SCHEMA_VERSION, traceRecordCarry, parseStageOutcomes, recordCarryEvent, recordCarryDoubtsAgain, bandRecordUri, placementIndex, findingUris } from "./record-carry.mjs"; import { notesPageRows } from "./hand-off-exits.mjs";
import { reconcileSurfaceDuty, surfaceDutyNote } from "./surface-duty.mjs";   // item 3 — silence at the findings surface, read off the rows above
import { DISCARD_LEDGER_NAME, seamRows, appendDiscardRows, foldDiscardLedger } from "./record-discard.mjs";
import { citedFindingNumbers } from "./finding-citations.mjs";   // the findings an exclusion's ground cites
import { deriveGoodsEvidence, recordGoodsEvidence, heldRecordProvenance, heldBodiesOf, recordFetchOutcomes, readRunCallRows, recordReads, linesRead, registerCallAccount, readGoodsEvidence, GOODS_EVIDENCE_FILE, GOODS_EVIDENCE_AS_WRITTEN_FILE, goodsFromLabel } from "./goods-evidence.mjs";   // — what each band record's goods rest on, written beside the shape and served by no band tool
import { readDeclinations, declinationCallPaths } from "./declination-tool.mjs";   // — synthesis's own stated declines
import { seamReasonFor } from "./declination-call.mjs";   // — the per-record judgment, pure and separately tested
import { traceCommonLawCarry, commonLawCarryEvent, reconciliationVerdict, planVsExecutedChannels, CL_STAGES } from "./commonlaw-carry.mjs";
// — the committed ratchet floor. Read at module load like any other frozen contract object; a
// missing or unparseable floor yields state "no-floor" rather than a throw, because a run must not die
// because its ratchet lost its baseline.
const COMMONLAW_CARRY_FLOOR = (() => {
  try { return JSON.parse(readFileSync(new URL("./commonlaw-carry-floor.json", import.meta.url), "utf8")); }
  catch { return null; }
})();
import { DEFAULT_LEDGER_PATH } from "./provider-usage.mjs";
// — the run's own record log. Every driver-side register call that can write a record BODY carries
// this path, because this process runs several runs' pipelines at once and a global address would file
// one run's evidence under another.
import { runRecordLogPath } from "../providers/_shared/ledger-path.mjs";
import { beginAnswerMemory } from "../providers/_shared/answer-memory.mjs";
import { screenGateEvidence, policedDropUris } from "./screen-gate.mjs";
import { emptyQueue, coerceQueue, mintItem, pendingItems, markFlushed, receiptKeyFor, buildFlushFollowup } from "./digest-queue.mjs";   // (t1cd) — the digest-trigger funnel
import { foldFindingsFile, foldAfterSave, openPass, modelRecordPath, snapshotFold, readFold, keptModelOrdinal } from "./record-fold.mjs";   // the folded record from the delivery seam on
import { addressListLines, writeReviewAddresses } from "./review-addresses.mjs";   // the parts of the report each review dispatch may address
import { writeStamp, stageStaleness, restamp, restampStage, reconcileStamps, shaOf, readStamp, writeFindings, settleOneShotStamp, projectStageInput } from "./stage-freshness.mjs";
import { parseManifestVariants, GRID_HALVES, GRID_SEATS, MEANING_SEAT, splitGridSpec, halfOfTerm, openChannelRows } from "./common-law-receipts.mjs";
import { stampTokenRollup } from "./tokens.mjs";
import { recordRunConsumption } from "./consumption-ledger.mjs";
import { quoteForJob, logTurnaroundReconciliation } from "./run-quote.mjs";
import { assembleRunRecords, readRecordArtifacts, findRegistryArithmeticIssues, findRegistryViolations, collectOppositionDeadlines, normalizeRecordUri } from "./registry-fidelity.mjs";
import { parsePlacementsJson } from "./placement-model.mjs";   // B2 — the structured tier mirror; the lint reads it only to flag an EMPTY one
import { plainRegisterFlags, SENTENCE_WORD_LIMIT } from "./plain-register.mjs";
import { readRepairBase, repairBasePath, changedContent, isEmptyChange, restingOn, scopeItems, classifyPoints, changedInputsOf, listForReview, writePostRepairRecord, postRepairRecordPath } from "./repair-scope.mjs";
import { parseFindingsJson, parseFindingsJsonLenient, consolidateFindings, compareBlockingPower, inDispositionMode, DISPOSITION_GROUP, deriveActionConditions, cardedParties, actionPartyReferences, salvageRepairTargets, remapActionOrdinals, joinAskToAnswer, stripAskLabel, reasonedNegativeGroups, blankForeignRecordLinks } from "./findings-model.mjs";
import { foldCaption, foldCardRead } from "./card-budget.mjs";
// S2 — the report card's mechanical frame, composed from the record instead of dictated (see below).
import { carriesOwnFrame, composeCard } from "./card-frame.mjs";
import { parseFrameworkManifest, loadFrameworkManifest, frameworkFor, manifestPathFor, DEFAULT_FRAMEWORK } from "./framework.mjs";
import { attachFrameworkMethod, methodPathFor, FROZEN_METHOD_FILE } from "./framework-method.mjs";
import { renderScopeLedgerJson, scopeLedgerJsonFromRows, gridChannels, parseScopeLedgerJson, scopeJurisdictions, droppedVariantFamilies } from "./scope-ledger.mjs";
// qw/cn-scope-honesty — the zh-lane capability tables + the requested-scope resolver, for the plain-clearotron
// honesty row/note. jx-lanes.mjs is a PURE zero-import leaf (data + decisions, no env/fs), so a static
// import here costs a plain clearotron nothing — the "lazy import" rule below (jx.mjs / jx-units.mjs) guards
// the lane MACHINERY, not this table. Aliased: scope-ledger.mjs already exports a scopeJurisdictions
// (rows → markets); this one is (job, profile) → requested territories, the decideJxLanes precedence.
import { JURISDICTION_ADAPTERS, LANGUAGE_LANES, scopeJurisdictions as jxScopeJurisdictions, zhScopeDepthNotes } from "./jx-lanes.mjs";
// — the two reads that used to sit inline here (blind model, then the manifest's prose line) moved
// into boundDominantElementFrom, so the driver's bind and the record tool's bind are ONE body. Neither
// parseBlindFrameModel nor dominantElementFromManifest is called from this file any more.
import { recordedScopeLedgerRows } from "./clearance-variants-record.mjs";
import { renderFormNeighbourhoodJson, parseFormNeighbourhoodJson, dispatchedQueriesFromBand, formGapDirectives, markText } from "./form-neighbourhood.mjs"; import { loadOrdinaryWords } from "./ordinary-words.mjs";
import { classifyFailureReason, createRepairLedger, TRANSIENT_RE, retryCannotHelpWith, isContentShapedFail, isFallbackEligible } from "./repairs.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { isCancelled } from "./cancel.mjs";   // stop-by-user: a distinct class, never classified as a failure; isCancelled is the resume door's own refusal (2155)
import { BRAND } from "../shared/brand.mjs";   // — the operator name a client is told to expect, from the tenant seam
import { reachableCommand } from "../shared/invocation.mjs";   // — a printed command the reader can type later, from anywhere
export { StageFailure, buildFailurePacket, isDesignedRefusal, stageWallFields, terminalReasonFields };   // moved to run-outcome.mjs; importers read them here as before
export { correctionReading, correctionRows, flagOrdinals, recordCorrectionsBasis, repairUnnamedRemovals, rollbackCorrectivePass };   // moved to steps/corrections.mjs; importers read them here as before
export { isContentShapedFail, isFallbackEligible };   // moved to repairs.mjs; importers read them here as before
export { logTurnaroundReconciliation };   // moved to run-quote.mjs; importers read it here as before

// Fix-1 (deterministic common-law closure): the lanes that dictate a supplementary grid SPEC (the driver
// writes the spec, the plugin writes the ledger, the driver folds it in code). One tag per lane so
// concurrent supplementaries never clobber each other and readHalfLedger folds every sibling. The
// coverage-closure lane is the only cell-closing top-up; frame-reopen source-channel closure stays
// prose/byte-diff (its channels are model-resolved, not spec-shaped platforms), so it writes no supp ledger.
const CL_SUPP_TAGS = ["closure"];

// V4-2 — the driver-code targeted record fetch (registry-evidence closure), delegated to the ACTIVE
// register provider's adapter (driver.config.PROVIDERS). Pure code at the comparator's named point — no
// agent turn, no gateway command lane: the adapter imports the provider's dependency-free plugin core and
// calls doRecordFetch directly. The plugin chokepoint writes BOTH ledgers (call row + normalized record
// body) under the un-namespaced sessionKey we pass, so the row prefix-matches this run and the assembled
// record set picks it up on re-assembly. Credential = the provider's own env var (already in the driver's
// systemd EnvironmentFile); absence is a named mechanical cause. One provider is active per run.
/**
 * Note the adapter's own id against this run, and hand the adapter straight back.
 *
 * RECORDED WHERE IT IS RESOLVED, so the run's record says what SERVED it rather than what was configured
 * at launch. Noting is idempotent per run and writes only when the set changes, so a run fetching a
 * thousand records pays one write. A null run directory notes nothing: a call outside a run has no record
 * to carry the field, and inventing one is the guess this field exists to replace.
 */
function noteAdapter(ctx, adapter) {
  noteRegisterServed(ctx?.run?.runDir ?? ctx?.paths?.runDir ?? null, adapter?.id);
  return adapter;
}

async function defaultRecordFetcher(uri, ctx) {
  return noteAdapter(ctx, registerAdapter(ctx.register)).recordFetch(uri, ctx);
}

/**
 * THE ENGINE RE-ISSUES A DICTATED MEANING SEARCH ITSELF, without asking the assessing model to redo the
 * sweep — the same shape as `defaultRecordFetcher` above, which fetches a register record in code when
 * one was dropped unexamined rather than sending the model back for it.
 *
 * "Through the same tool" is literal and costs no new machinery: the research provider's grid functions
 * are a plain module with no listener, so the component the model calls and this one call the SAME
 * functions on the same provider. There is no second implementation to drift.
 *
 * NARROW BY CONSTRUCTION. The spec handed over carries only the queries that are missing, so this buys
 * those cells rather than re-running a sweep that already cost real money and real minutes.
 *
 * It DECIDES nothing. The caller re-merges and the gate judges, so a re-issue that comes back empty is
 * simply a re-merge that still fails, and is disclosed as such rather than counted as searched.
 */
/** The grid spec's `results_per_cell` from a frozen search policy, or nothing for a run frozen without one. PURE. */
export function resultsPerCellOf(searchPolicy) {   // @internal
  const n = searchPolicy?.web?.resultsPerCell;
  return Number.isInteger(n) && n >= 1 ? { results_per_cell: n } : {};
}

async function defaultConnotationReissuer(queries, { spec, modelOverride = null, rawPath = null } = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY || "";
  if (!apiKey) return { ok: false, cause: "no research credential in the driver environment", rows: [] };
  const core = await import("../providers/perplexity/src/core.js");
  const narrow = { ...spec, connotation: { ...(spec.connotation ?? {}), queries: queries.slice() } };
  try {
    const task = core.buildGridProgramTask(narrow);
    const data = await core.callAgentAPI(apiKey,
      core.buildRequestBody({ task, preset: "pro-search", modelOverride, enableSandbox: true }));
    // WHAT CAME BACK, KEPT IN THE RUN like every other web call's: the capture keeps the receipts only.
    if (rawPath) {
      try {
        mkdirSync(dirname(rawPath), { recursive: true });
        writeFileSync(rawPath, JSON.stringify({ tool: "connotation-reissue", queries, items: core.rawResultItems(data) }, null, 1) + "\n");
      } catch { /* best-effort: the receipts below are the record */ }
    }
    const cap = core.captureGridFromResponse(data, narrow);
    if (!cap?.ok) return { ok: false, cause: String(cap?.error ?? "capture failed").slice(0, 160), rows: [] };
    const rows = parsePrRiskResults(cap.ledgerJson).filter((r) => queries.includes(r.query));
    return { ok: true, rows, requested: queries.length };
  } catch (e) {
    return { ok: false, cause: String(e?.message ?? e).slice(0, 160), rows: [] };
  }
}

// The ACTIVE provider's capability contract and the offices this DEPLOYMENT cannot reach both moved to
// register-unreachable.mjs, unchanged, because Depth 2's count and record lanes need the same
// two answers and a second binding of the member→variable lookup is how two lanes come to disagree
// about which variable matters. Their behaviour here — NEVER-KILL, null contract, empty list — is
// identical; the module comment carries the reasoning that used to live at this spot.

// Cited registry URIs on a delivered surface (broad form — hyphens AND underscores are legal in record
// ids: corsearch `/mark/cn/37554073-42`, Signa `/mark/us/tm_019d1db7-…`).
const CITED_URI_RE = /\/mark\/[a-z]{2,6}\/[a-z0-9][a-z0-9_-]*/gi;

/**
 * The connotation token a merge failure carries, or null. Reads BOTH the message and the `detail`.
 *
 * — THIS USED TO BE AN INLINE `e.message` MATCH, AND THAT MADE THE MERGE'S REMEDY CHANNEL DEAD.
 * `StageFailure` builds its message as `${stage}: ${reason}`, and moved the open-set payload out of
 * `reason` into `detail` so a renderer could show the sentence and hide the payload. From that split on,
 * the message read "common-law: merged half-grids failed the canonical validator" and carried no token,
 * so the remedy's `if (!tok) throw e` fired on EVERY merge-validator failure and a bounded, dictated
 * one-round repair — built for exactly this, widened by to cover `quote_unbound` — never ran once.
 * A converted field takes its guards quiet rather than red, and a recovery path is a reader too.
 *
 * Message FIRST and still read: an archived or re-thrown failure carrying the token inline must keep
 * opening the channel. Exported because a guard that can only be asserted by reading source is a guard
 * whose behaviour was never tested. PURE; never throws.
 */
export function connotationRemedyToken(err) {   // @internal
  const re = new RegExp(`${CONNOTATION_FORM_TOKEN_SRC}[^)]*`);
  for (const text of [err?.message, err?.detail]) {
    const m = String(text ?? "").match(re);
    if (m) return m[0];
  }
  return null;
}

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

// ── WS-A: machine coverage ledger plumbing ───────────────────────────────────────────────────────────
// The coverage gates read the machine ledger when the digest saved one, else the legacy prose parse.
// Called FRESH at each gate — register-findings.md AND the JSON are rewritten by re-digests, so a
// cached read could span a rewrite. An unreadable machine ledger here is near-impossible (the file
// passed the stage validator) — fall back to prose rather than crash; the validator owns that failure.
/**
 * The relabels every coverage consumer reads rows through: a tool-absence relabelled deferred, a clean on a
 * timeout-tainted axis downgraded, and the open channels the run dictated and nobody ran. One function, so a ledger
 * read from any source is relabelled alike. IMPURE (reads the run's taint and grid receipts).
 */
export function relabelCoverageRows(runDir, rows) {   // @internal
  return [...applyTaintDeferred(coerceToolAbsenceDeferred(rows), readActiveTaintAxes(runDir)), ...openChannelRows(runDir)];
}

export function loadCoverageLedger(runDir) {   // @internal
  // Keystone (#1): every consumer reads through here, so the tool-absence→deferred relabel applies ONCE,
  // at the single choke point — the escalation-skip gate, the deadline envelope, and the U1 clamp all then
  // act on the corrected status. The relabel is a pure backstop over coverageLedger.coerceToolAbsenceDeferred
  // (a closeable could-not-reach gap must never read as an accepted saturation limit).
  // Timeout-taint (copper-lattice): the sibling relabel — a confirmed-clean row on an axis whose winning
  // pass was kill-touched (register-taint.mjs) is downgraded to deferred at the same choke point, so the
  // envelope re-runs it and the verdict floor clamps over it, whatever the prose self-reported.
  const relabel = (rows) => relabelCoverageRows(runDir, rows);
  const jsonPath = paths(runDir).registerCoverageLedger;
  if (existsSync(jsonPath)) {
    try { return { rows: relabel(parseCoverageLedgerJson(readFileSync(jsonPath, "utf8"))), source: "machine", dropped: [] }; }
    catch (e) { note(`loadCoverageLedger: machine ledger unreadable (${String(e.message).slice(0, 80)}) — prose fallback`); }
  }
  const findingsPath = paths(runDir).registerFindings;
  if (!existsSync(findingsPath)) return { rows: [], source: "none", dropped: [] };
  const { rows, dropped } = parseCoverageLedgerFull(readFileSync(findingsPath, "utf8"));
  return { rows: relabel(rows), source: "prose", dropped };
}

/**
 * Which still-tainted axes are disclosed and which are parked. Every axis once synthesis is done (the audit spine is
 * locked); an axis the searches record lists, whose recovery is spent; and the rest parked, to be run again. PURE.
 */
export function taintDisposition(stillTainted, { digestLocked = false, disclosedAxes = new Set() } = {}) {   // @internal
  const disclose = (stillTainted ?? []).filter((a) => digestLocked || disclosedAxes.has(a));
  return { disclose, park: (stillTainted ?? []).filter((a) => !disclose.includes(a)) };
}

/**
 * Put back what a taint park renamed, so the band and the digest are read as the last pass left them. A renamed copy
 * whose original has since been written again stays where it is. Returns the paths put back. IMPURE.
 */
export function undoTaintRenames(renames) {   // @internal
  const back = [];
  for (const r of Array.isArray(renames) ? renames : []) {
    try { if (r?.to && r?.from && existsSync(r.to) && !existsSync(r.from)) { renameSync(r.to, r.from); back.push(r.from); } }
    catch { /* best-effort: what stays renamed is re-run on the resume, as before */ }
  }
  return back;
}

// THE BANDS ARE READ WITH THE RECORDED SLICES OUT, whatever wrote them since. A unit re-run after the fan-in, by the
// envelope, the escalation or the taint chain, writes its axis's band whole, and a slice the searches' record took
// out would come back with the records nobody could prove were searched. So the band's two readers, the merge and the
// plan join, take the recorded slices out of what they read, in memory and never by writing the file: a unit or the
// executor may be writing that band at the same moment. Every other reader of a band as answers does the same, from
// the one definition (shared/slices-taken-out.mjs).
const recordedSlicesByAxis = (P) => slicesTakenOutByAxis(P?.runDir);

// A band's text with the slices taken out, for a reader that parses text. Text that does not parse is handed on whole,
// for the reader's own parse to refuse. PURE.
function withSlicesOut(raw, slices) {
  if (!Array.isArray(slices) || !slices.length) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return raw;
    const { blocks, taken } = bandWithSlicesOut(parsed, slices);
    return taken.length ? JSON.stringify(blocks) : raw;
  } catch { return raw; }
}

/**
 * THE SLICES A RUN COULD NOT PROVE IT SEARCHED, TAKEN OUT OF ITS BAND. Each recorded slice's block becomes the
 * executor's own deferred block (providers/_shared/execute-plan.mjs), carrying the slice's reason, or is added as one
 * where the band holds none for it. The plan join files it as deferred, the coverage form gives it an open row the
 * write-up may not call clean, and the axis's other blocks stand. The band as it was is kept beside it the first time,
 * as evidence. An axis whose band is absent or unreadable is left to the band's own checks. Returns the slices taken
 * out on this call. IMPURE (rewrites the bands).
 */
export function takeSlicesOutOfTheBand(P, slices) {   // @internal
  const taken = [];
  const byAxis = new Map();
  for (const s of Array.isArray(slices) ? slices : []) {
    if (!s?.axis || (!s?.qid && !s?.query)) continue;
    if (!byAxis.has(s.axis)) byAxis.set(s.axis, []);
    byAxis.get(s.axis).push(s);
  }
  for (const [axis, list] of byAxis) {
    const at = P.registerBand(axis);
    let blocks;
    try { blocks = JSON.parse(readFileSync(at, "utf8")); } catch { continue; }
    if (!Array.isArray(blocks)) continue;
    const out = bandWithSlicesOut(blocks, list);
    if (!out.taken.length) continue;
    taken.push(...out.taken);
    try { if (!existsSync(`${at}.before-taken-out`)) copyFileSync(at, `${at}.before-taken-out`); } catch { /* the evidence is best-effort */ }
    atomicWrite(at, JSON.stringify(out.blocks, null, 2) + "\n");
  }
  return taken;
}

// ── judgment-relocation (2026-06-23): the COMPLETE NAMED BAND flow (lift the firewall) ───────────────
// The register-unit funnel writes register-units/<axis>-band.json (a JSON ARRAY of named-band blocks). The
// driver MERGES the per-axis bands into one complete band (register-named-band.json) and feeds it to Layer B
// (placement / digest / synthesis). Light VALIDATOR like the coverage-ledger one: parseNamedBand THROWS
// `named_band_*` tokens — a parse miss is a stage fail with the token, never a hard crash. mergeNamedBands
// de-dups enumerated records by record_id and preserves every crowd descriptor. Returns the merged band
// object {enumerated, crowds} plus { axes:[…], invalid:[{axis,reason}] } so the caller can flag a bad axis.
export function mergeRegisterBands(P, axes = []) {   // @internal
  const recorded = recordedSlicesByAxis(P);
  const bands = [];
  const merged = [];
  const invalid = [];
  for (const a of (axes ?? [])) {
    const bandPath = P.registerBand(a);
    if (!existsSync(bandPath)) continue;   // an axis that found nothing may legitimately write no band
    try {
      const band = parseNamedBand(withSlicesOut(readFileSync(bandPath, "utf8"), recorded.get(a)));   // throws named_band_* on a malformed artifact
      bands.push(band);
      merged.push(a);
    } catch (e) {
      // T1 (J1c, merge/resume path): a VOCABULARY miss on a qid-less judgment block must not
      // send the WHOLE axis to invalid[] — that silently dropped every enumerated record the axis DID
      // carry (a recall loss worse than the hard-fail). Quarantine repairs the band durably (unknown
      // qid-less states → honest incomplete descriptors), then the strict parse re-runs. Any other
      // defect (unparseable, block-invalid, qid-stamped unknown state) still lands in invalid[].
      if (/named_band_state_invalid/.test(String(e.message))) {
        try {
          const { blocks, quarantined } = quarantineUnknownStates(readFileSync(bandPath, "utf8"));
          if (quarantined.length) {
            writeFileSync(`${bandPath}.tmp`, JSON.stringify(blocks, null, 2) + "\n");
            renameSync(`${bandPath}.tmp`, bandPath);
            runLog(P.runDir, { event: "named-band-state-quarantined", axis: a, states: quarantined.map((q) => q.state), site: "merge" });
            const band = parseNamedBand(withSlicesOut(readFileSync(bandPath, "utf8"), recorded.get(a)));
            bands.push(band);
            merged.push(a);
            continue;
          }
        } catch { /* fall through to invalid[] with the ORIGINAL token */ }
      }
      // do NOT hard-crash — record the token (mirrors the coverage-ledger validator) so the caller flags it.
      invalid.push({ axis: a, reason: String(e.message).slice(0, 120) });
    }
  }
  return { band: mergeNamedBands(bands), axes: merged, invalid };
}

// Merge the per-axis bands and write the UNION to register-named-band.json (atomic temp+rename) so Layer B's
// declared stage input (stages.mjs stageInputs) is on disk. A run with no band files at all writes an empty
// {enumerated:[],crowds:[]} so the input always exists (a legacy/archived run, or a clean run where no axis
// surfaced a named band, still delivers).
// T3 (H3, an owner-approved doctrine flip — the code is its own record;): a band file that STILL will not parse after
// the T1 recovery ladder (warm re-emit + vocabulary quarantine, both already attempted upstream and again
// inside mergeRegisterBands) is a MACHINERY DEFECT — the run FAILS here instead of shipping a
// finished-looking CONDITIONAL over receipts judgment could not read (the retired WS-A "never-kill" /
// artifact-clamp behaviour; the rule is: machinery fails, CONDITIONAL is for lawyer-judged residue).

// ── copper-lattice re-route: supplemental-plan fold + receipt refresh ────────────────────────────────
// The propose-supplemental tool persists model-proposed entries per axis
// (register-units/<axis>-supplemental-plan.json — one writer per file, axes run in parallel) and
// executes them itself. The DRIVER folds them into the run plan here (single-threaded), so every
// supplemental is skeleton-tracked and receipt-durable exactly like a dictated entry — the taint
// chain, the clean-gates, and dispatchPlanQids cover them with zero extra code. Run-local only: the
// slug store is never written (clearances run once; senior lawyer 2026-07-10).
export function readRegisterBands(P, axes) {   // @internal
  const recorded = recordedSlicesByAxis(P);
  const byAxis = {};
  for (const a of axes ?? []) {
    if (!existsSync(P.registerBand(a))) continue;
    try {
      const parsed = JSON.parse(readFileSync(P.registerBand(a), "utf8"));
      byAxis[a] = bandWithSlicesOut(Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : []), recorded.get(a)).blocks;
    } catch { byAxis[a] = []; }
  }
  return byAxis;
}
/** The plan-execution receipt in hand (ctx first, then the on-disk copy). Never throws. */
export function readPlanExecution(ctx) {   // @internal
  if (ctx?.planExecution) return ctx.planExecution;
  const p = ctx?.paths?.planExecution;
  try { return p && existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; }
}
/**
 * A qid this run has accepted as a capability gap (envelope-settle.mjs stickyGapsAfter) leaves `missing`
 * for `deferred`, with the reason it was accepted under, so no re-join can put it back on the ladder.
 * Returns the join unchanged when nothing is held. PURE.
 */
export function holdStickyGapsIn(join, sticky) {   // @internal
  const held = (join?.missing ?? []).filter((q) => sticky?.has(q));
  if (!held.length) return join;
  return { ...join, missing: join.missing.filter((q) => !sticky.has(q)),
    deferred: [...(join.deferred ?? []), ...held.map((q) => ({ qid: q, reason: String(sticky.get(q)?.reason ?? "").slice(0, 300) }))] };
}

/**
 * The coverage units of this run's sticky capability gaps, as ledgerUnitKey()s, found through the coverage
 * form's own deferred rows (the driver writes each with its qid). The envelope, the escalation and the
 * skeptic's ledger split then hold those rows whatever reason the seat wrote for them. A run with no form,
 * or no sticky gap, holds nothing extra, exactly as before.
 */
export function stickyGapUnits(P) {   // @internal
  const sticky = readStickyGaps(P);
  if (!sticky.size) return new Set();
  const stamp = coverageFormStamp(P.runDir);
  const rows = stamp.required ? (readCoverageForm(P.runDir, stamp.formName).rows ?? []) : [];
  return new Set(rows.filter((r) => r?.kind === "deferred" && sticky.has(String(r.qid ?? ""))).map(formRowUnitKey));
}

export function writePlanExecutionReceipt(ctx, joinRes) {   // @internal
  const P = ctx.paths;
  joinRes = holdStickyGapsIn(joinRes, readStickyGaps(P));
  // — the ONE place the receipt is written is the one place this decision is taken. The
  // reclassification is keyed off the receipt already on disk (ladderExhaustedQids), so every writer
  // agrees without any of them knowing about it: the fan-in, the envelope's re-join after its close
  // attempt, and refreshSupplementalExecution's post-followup accounting. Doing it at the fan-in alone
  // would have let the very next re-join put a deferred slice back into `missing` and record it
  // "closed: ok" — a slice disclosed as a gap on one line and claimed closed on the next.
  // Deliberately NOT gated on plan_version. A qid is the same slice whichever plan version carries it,
  // and a supplemental fold bumps the version — gating on it would hand a hard-errored slice back to
  // `missing` the moment the plan grew, which is the one moment a run is least able to notice.
  const prior = readPlanExecution(ctx);
  {
    // The predicate is the SAME test the fan-in throw below uses to stamp `deterministic` and refuse the
    // ladder. Passing it here is what closes the regression: an error the run will not ride the
    // ladder for can no longer be required to have ridden it. See register-plan.mjs's header.
    //
    // — it was `(reason) => !TRANSIENT_RE.test(reason)`, and that read the STATUS CODE over the
    // SENTENCE. A provider that answers `HTTP 500 … Near/Adj queries with sub queries that can return a
    // huge amount of results are not allowed` has read the request and rejected its shape; the refusal
    // will recur byte-identically forever. `\bhttp\s?5\d\d\b` matched it, so seven slices on one axis
    // were filed ladder-spent with `permanent: 0` — a structural refusal recorded as weather.
    // `retryCannotHelpWith` keeps the old rule and adds the one that outranks it.
    const { join, converted } = deferExhaustedProviderErrors(
      joinRes, readRegisterBands(P, ctx.axes ?? []), ladderExhaustedQids(prior),
      retryCannotHelpWith);
    if (converted.length) {
      joinRes = join;
      const permanent = converted.filter((c) => c.path === "permanent");
      // — THE ROW NOW CARRIES THE THING IT IS A DECISION ABOUT.
      //
      // Its keys were `ts, event, count, permanent, qids`. A reader who saw `permanent: 0` had nothing
      // to audit that against: the classification was recorded and the string it was made from was not,
      // so the one row that says "this refusal is weather" could never be checked from the record. The
      // causes are already in hand — `converted[]` carries both — so this is a field, not plumbing.
      //
      // `qids_omitted` for the same reason one level down: `slice(0, 8)` dropped the ninth qid onward
      // with no marker and no count, which is the pathology this issue is about, in this very line.
      // Naming the number is the whole fix — a reader can now tell a list of eight from a list of
      // eight-of-nineteen.
      runLog(P.runDir, { event: "plan-qids-provider-hard-error-deferred", count: converted.length,
        permanent: permanent.length, qids: converted.slice(0, 8).map((c) => c.qid),
        qids_omitted: Math.max(0, converted.length - 8),
        reasons: [...new Set(converted.map((c) => String(c.cause ?? "").slice(0, 160)))].slice(0, 4) });
      // The two paths get their own sentence: one says the ladder was spent, the other says the ladder
      // could not have helped. A note claiming the wrong one makes the run's own record of WHY a slice
      // went unsearched wrong, which is the thing this whole mechanism is for.
      for (const [path, rows] of [["ladder-spent", converted.filter((c) => c.path === "ladder-spent")], ["permanent", permanent]]) {
        if (!rows.length) continue;
        note(`register plan: ${rows.length} dictated slice(s) DEFERRED `
          + (path === "permanent"
            ? `without riding the recovery ladder — the provider accepted them and then failed with an error this run cannot classify as transient, so retrying is futile and they were never searched: `
            : `after the full recovery ladder — the provider accepted them and then hard-errored, so they were never searched and cannot be read as clean: `)
          + rows.slice(0, 3).map((c) => `${c.qid} ← ${c.cause.slice(0, 120)}`).join("; "));
      }
    }
  }
  const skeleton = deriveCoverageSkeleton(ctx.registerPlan, joinRes);
  const supplemental = ctx.registerPlan.entries.filter((e) => e.origin === "supplemental" || /^(supp:|xcheck-)/.test(e.qid)).map((e) => e.qid);
  // — EXECUTED IS NOT ANSWERED, and the receipt stated only the first. `joinPlanToBands` pushes to
  // `executed` any block that is neither error nor deferred, carrying its `state` through — so a row
  // reading `{"qid":"…","state":"incomplete"}` sits in `executed`, and a receipt of
  // `executed: 146, missing: []` reads as "the plan ran" when it means "146 slices own a block".
  //
  // A reader — human or gate — had to open the band files to get the number the field name promised.
  // `answered` is that number, derived from rows the receipt already carries, so nothing new is measured
  // and the two cannot disagree. `incomplete` is stated beside it rather than left to subtraction: a
  // crowd descriptor is a legitimate, disclosed NON-answer, and the honest receipt says how many there
  // are instead of letting `missing: []` imply none.
  const answeredRows = (joinRes.executed ?? []).filter((e) => String(e?.state ?? "").toLowerCase() !== "incomplete");
  const census = { answered: answeredRows.length, incomplete: (joinRes.executed ?? []).length - answeredRows.length };
  // THE SAFETY NET UNDER THE FOLLOW-UP SEARCHES (follow-up-searches.mjs), on the run log and nowhere a model reads: the
  // limit, the follow-up searches sent and how many follow-ups it did not send. Logged once each time those figures move.
  try {
    const { sent } = followUpSearchesSent(driverDir(P.runDir));
    // a question held back once and asked later (a count file unreadable for a moment) was asked
    const answered = new Set((joinRes.executed ?? []).map((e) => String(e?.qid)));
    const notSent = readOutstanding(driverDir(P.runDir)).filter((r) => !answered.has(String(r.qid))).length;
    if (sent > 0 || notSent > 0) {
      const net = { limit: FOLLOW_UP_SEARCH_LIMIT, sent: Number.isFinite(sent) ? sent : null, reached: !Number.isFinite(sent) || sent >= FOLLOW_UP_SEARCH_LIMIT, not_sent: notSent };
      const seen = `${net.sent}:${net.not_sent}`;
      if (ctx.followUpNetLogged !== seen) { runLog(P.runDir, { event: "register-follow-up-searches", ...net }); ctx.followUpNetLogged = seen; }
    }
  } catch { /* the run log line is a record only */ }
  // the run's main markets, the one market list its crowd endings were read against: a run constant the coverage form reads
  const receipt = { plan_version: ctx.registerPlan.plan_version, ...joinRes, ...census, ...(supplemental.length ? { supplemental } : {}),
    main_markets: mainMarketsOf(ctx), skeleton };
  writeFileSync(`${P.planExecution}.tmp`, JSON.stringify(receipt, null, 2) + "\n");
  renameSync(`${P.planExecution}.tmp`, P.planExecution);
  ctx.planExecution = receipt;
  return skeleton;
}
/**
 * — derive every meter's `basis` from the machine evidence and write the record. NEVER-KILL.
 *
 * Called at each seam where findings.json is settled, because the ONE-SHOT audit it replaced could not
 * see a stamp added after it ran, and four of four measured runs added or lost some. Idempotent: a
 * second call over an unchanged file demotes nothing and writes the same record with an empty list.
 *
 * Returns the record it wrote, or null if the findings file could not be read.
 */
export function settleDerivedBases(ctx, at) {   // @internal
  const P = ctx.paths;
  try {
    const recordFile = (uri) => join(P.runDir, "_records", String(uri).replace(/^\/mark\//, "").replace(/[^a-z0-9]+/gi, "-") + ".json");
    // TWO parses of the same bytes, deliberately. The LENIENT parse is what every other join in the
    // driver reads, and it normalises — it adds a `schemaVersion` alias the on-disk contract forbids, so
    // writing it back fails the core-artifact gate on a key nobody typed. The strict parse is what gets
    // WRITTEN: the file's own keys, its own shape, with only the basis values changed.
    const raw = readFileSync(P.findings, "utf8");
    let doc = null;
    try { doc = parseFindingsJsonLenient(raw); } catch { return null; }
    let readSet = new Set();
    try { readSet = readOkRecordUris(readFileSync(P.readingLog, "utf8")); } catch { /* no reads logged ⇒ nothing is provable */ }
    const findings = doc?.findings ?? [];
    const demotions = unprovableRecordBases({
      findings,
      hasRecord: (uri) => existsSync(recordFile(uri)),
      wasRead: (uri) => readSet.has(uri),
    });
    let applied = 0;
    let unwritable = 0;
    let heldBase = null;   // what the synthesis merge base took, when there was a demotion to give it
    if (demotions.length) {
      let onDisk = null;
      try { onDisk = JSON.parse(raw); } catch { onDisk = null; }
      if (!onDisk) {
        // An absence is a finding: the demotions are real and could not be applied. Loud, and recorded
        // on the artifact below — never a quiet pass that leaves an unprovable claim standing.
        unwritable = demotions.length;
        note(`basis derivation (${at}): ${demotions.length} unprovable verified-from-record stamp(s) could NOT be demoted — `
          + `findings.json does not strictly parse, so the file cannot be rewritten without inventing its shape`);
        runLog(P.runDir, { event: "basis-derivation-unwritable", at, demotions: demotions.length });
      } else {
        const next = applyDerivedBases(onDisk, demotions);
        applied = next.applied;
        writeFindings(P.runDir, next.doc, { why: "derived-bases-demoted", settles: [] });
        // THE HELD BASE TAKES THE SAME DEMOTIONS. Every accepted synthesis patch merges onto
        // `_driver/synthesis-calls/accepted.json` and re-renders the findings it does not name from there, so a
        // demotion written to this file alone came back with the next patch, and the evidence check then told
        // the reviewer the stamp had returned. In the model's numbering: under a fold, a demotion lands on the
        // member the fold kept, whose object the folded finding is. The edit is judged as a call is; a refusal
        // leaves the base byte-identical and is recorded below, and the run goes on as it did before.
        if (applied) {
          const fold = readFold(P.runDir);
          const inModel = demotions.map((d) => ({ ...d, ordinal: keptModelOrdinal(fold, d.ordinal) })).filter((d) => d.ordinal != null);
          const r = rebaseSynthesis(P.runDir, (held) => applyDerivedBases(held, inModel).doc);
          heldBase = r.ok ? { base: r.changed ? "demoted" : "unchanged" }
            : /^no_base:/.test(String(r.reason)) ? { base: "no-base" } : { base: "refused", baseReason: String(r.reason).slice(0, 200) };
          if (heldBase.base === "refused") {
            note(`basis derivation (${at}): the synthesis merge base could not take the demotions (${heldBase.baseReason.slice(0, 100)}) — `
              + `it is left as it was, and the next accepted patch re-renders the stamps it holds`);
          }
        }
        // A SHORTFALL IS A FINDING. The demotions are computed against the lenient parse, which normalises
        // — so a raw finding missing the `ordinal` the match keys on would leave an unprovable claim
        // standing while `demoted` and `rows` sat next to each other looking consistent. Say it.
        if (applied !== demotions.length) {
          unwritable = demotions.length - applied;
          note(`basis derivation (${at}): ${unwritable} of ${demotions.length} unprovable stamp(s) did NOT apply — `
            + `the on-disk findings carry no matching ordinal/meter for them, so the claim is still standing`);
          runLog(P.runDir, { event: "basis-derivation-shortfall", at, expected: demotions.length, applied });
        }
      }
    }
    if (applied) {
      note(`basis derivation (${at}): ${applied} meter(s) demoted verified-from-record → inferred-from-signal — `
        + `the reading log cannot back the claim: `
        + demotions.slice(0, 3).map((d) => `${d.mark ?? d.ordinal}/${d.meter} (${d.why})`).join("; ")
        + `${demotions.length > 3 ? ` …${demotions.length - 3} more` : ""}`);
    }
    // The rows are the audit record, written whether or not anything moved (AD-4): "nothing was
    // demoted" and "nobody looked" must not read the same.
    const stampedBefore = findings.reduce((n, f) => n + Object.values(f?.meters ?? {})
      .filter((m) => m?.basis === "verified-from-record").length, 0);
    const record = { ts: new Date().toISOString(), at,
      stamped_before: stampedBefore, stamped_after: stampedBefore - applied, demoted: applied,
      ...(unwritable ? { unwritable } : {}), ...(heldBase ?? {}),
      rows: demotions.map((d) => ({ ordinal: d.ordinal, mark: d.mark, meter: d.meter, uri: d.uri, why: d.why })) };
    atomicWrite(P.basisDerivation, JSON.stringify(record, null, 2) + "\n");
    runLog(P.runDir, { event: "basis-derivation", at, stamped_after: stampedBefore - applied, demoted: applied,
      ...(heldBase ? { base: heldBase.base } : {}),
      never_fetched: demotions.filter((d) => d.why === "record-never-fetched").length,
      never_read: demotions.filter((d) => d.why === "record-on-disk-never-read").length });
    return record;
  } catch (e) {
    note(`basis derivation (${at}) skipped (${String(e?.message ?? e).slice(0, 100)}) — never-kill`);
    runLog(ctx?.paths?.runDir, { event: "basis-derivation-failed", at, fail: String(e?.message ?? e).slice(0, 160) });
    return null;
  }
}

export function foldSupplementalProposals(ctx) {   // @internal
  if (!ctx.registerPlan) return [];
  const P = ctx.paths;
  const entries = [];
  for (const a of ctx.axes ?? []) {
    const p = join(P.runDir, "register-units", `${a}-supplemental-plan.json`);
    if (!existsSync(p)) continue;
    try {
      const supp = JSON.parse(readFileSync(p, "utf8"));
      for (const e of Array.isArray(supp?.entries) ? supp.entries : []) if (e?.qid && e?.axis === a) entries.push(e);
    } catch (e) { note(`supplemental plan ${a} unreadable (${String(e.message).slice(0, 60)}) — its qids stay tool-side until repaired`); }
  }
  if (!entries.length) return [];
  const { plan, added, refused } = foldSupplementalEntries(ctx.registerPlan, entries);
  if (added.length) {
    writeFileSync(`${P.registerPlan}.tmp`, JSON.stringify(plan, null, 2) + "\n");
    renameSync(`${P.registerPlan}.tmp`, P.registerPlan);
    ctx.registerPlan = plan;
    runLog(P.runDir, { event: "supplemental-fold", added: added.length, version: plan.plan_version });
    note(`supplemental fold: ${added.length} model-proposed register entr${added.length === 1 ? "y" : "ies"} joined the plan (v${plan.plan_version})`);
  }
  // — the model-set `term_literal` path. The propose-supplemental tool screens at mint, but the
  // flag is a field the MODEL fills in, and it used to suppress every term rule; a markup term wearing
  // it passed the mint, landed in this sidecar and folded here unexamined. The refusal goes back into
  // the axis sidecar's own `rejected[]` — the surface the authoring stage already reads — rather than
  // into a new file nobody opens.
  if (refused.length) {
    runLog(P.runDir, { event: "supplemental-fold-refused", refused: refused.length,
      rows: refused.slice(0, 6).map((r) => ({ qid: r.qid, term: String(r.term).slice(0, 60) })) });
    note(`supplemental fold: ${refused.length} model-proposed entr${refused.length === 1 ? "y" : "ies"} REFUSED — ${refused.map((r) => r.qid).join(", ")}`);
    for (const a of ctx.axes ?? []) {
      const rows = refused.filter((r) => entries.find((e) => e.qid === r.qid)?.axis === a);
      if (!rows.length) continue;
      const p = join(P.runDir, "register-units", `${a}-supplemental-plan.json`);
      try {
        const doc = JSON.parse(readFileSync(p, "utf8"));
        const next = withRejected(doc, rows.map((r) => ({ issue: r.issue, proposal: { qid: r.qid, term: r.term } })),
          { ts: new Date().toISOString(), origin: "supplemental-fold" });
        writeFileSync(`${p}.tmp`, JSON.stringify(next, null, 2) + "\n");
        renameSync(`${p}.tmp`, p);
      } catch (e) { note(`supplemental fold: rejected[] write failed for ${a} (non-fatal): ${String(e.message).slice(0, 80)}`); }
    }
  }
  return added;
}
// Post-followup accounting: escalation/envelope/reopen turns may have proposed new supplementals —
// fold them and refresh the receipt so plan-execution.json (the not-finished substrate every gate
// reads) always includes them. NEVER-KILL: accounting must not fail a run the followup just repaired.
export function refreshSupplementalExecution(ctx) {   // @internal
  if (!ctx.registerPlan) return;
  try {
    const added = foldSupplementalProposals(ctx);
    const stale = ctx.planExecution && ctx.planExecution.plan_version !== ctx.registerPlan.plan_version;
    if (added.length || stale) {
      writePlanExecutionReceipt(ctx, joinPlanToBands(ctx.registerPlan, readRegisterBands(ctx.paths, ctx.axes ?? []), joinOptions(ctx)));
      runLog(ctx.paths.runDir, { event: "plan-execution-refresh", added: added.length });
    }
  } catch (e) { note(`supplemental receipt refresh skipped (${String(e.message).slice(0, 80)}) — never-kill`); }
}

/** One axis band's bytes, or null where it has none: what a re-run's change is measured against. */
function bandBytesOf(P, axis) { try { return readFileSync(P.registerBand(axis), "utf8"); } catch { return null; } }

/** A fingerprint of every axis band file, in axis order: what a merge read. */
function axisBandsFingerprint(P, axes = []) {
  const h = createHash("sha256");
  for (const a of axes ?? []) { h.update(`${a}\0`); h.update(bandBytesOf(P, a) ?? "\0absent"); h.update("\0"); }
  return h.digest("hex");
}

/**
 * THE NAMED BAND MERGED AGAIN WHEN AN AXIS BAND MOVED SINCE THE LAST MERGE. A unit re-run in its own session after the
 * fan-in (the cross-check's questions, a frame-reopen sweep, the skeptic's escalation, the envelope close) can add blocks
 * to its axis band whatever it does to its notes, and placement, the reading step and the writer read the named band.
 * Only the code-side recheck merged again, so the records those re-runs found reached none of the three. Code only:
 * nothing is dispatched. Returns whether the band was merged again.
 *
 * A BAND A READING STAGE WOULD REFUSE IS NOT ADOPTED. Placement, the reading step and the writer each refuse a band past
 * the size ceiling before they dispatch, and that refusal ends the run with no report. These re-runs alone can grow a
 * band the first merge kept under it past it, where without this merge the run would have gone on reading the band as
 * first merged. So the band is measured before it is adopted, by the test each stage applies at dispatch, and a band any
 * of the three would refuse is not adopted: the earlier merge stands, and the records the re-runs found stay unread. They
 * are not lost silently: the records the refused band held and the band standing does not are kept, and the recall gate
 * counts them into its approved sentence for records neither addressed nor set aside. `refusing` is that test,
 * injectable so a test can drive a refusal without a band of that size.
 */
export function remergeIfBandsMoved(ctx, why, { refusing = (bytes) => stagesRefusingBand(bytes, (s) => STAGES[s]?.timeoutSec) } = {}) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  if (ctx.bandsMergedAt == null) return false;   // nothing merged yet this pass: the fan-in merge reads every band
  const now = axisBandsFingerprint(P, ctx.axes);
  if (now === ctx.bandsMergedAt || now === ctx.bandsRefusedAt) return false;   // unmoved, or already refused as it stands
  try {
    const merged = mergeRegisterBands(P, ctx.axes ?? []);
    if (!merged.invalid.length) {
      const bytes = Buffer.byteLength(namedBandText(merged.band));
      const stages = refusing(bytes);
      if (stages.length) {
        ctx.bandsRefusedAt = now;
        const left = recordRefusedRecords(P, merged.band);
        runLog(P.runDir, { event: "named-band-remerge-over-ceiling", why, bytes, stages, records: left });
        note(`${why}: the band merged again would be ${(bytes / (1024 * 1024)).toFixed(1)} MB, more than ${stages.join(", ")} can be dispatched over — the earlier merge stands, and the records the re-run found stay unread`);
        return false;
      }
    }
    deriveNamedBand(ctx, merged); runLog(P.runDir, { event: "named-band-remerged", why }); return true;
  }
  catch (e) { note(`${why}: the named band could not be merged again (${String(e?.message ?? e).slice(0, 100)}) — the earlier merge stands`); return false; }
}

/** Where the records a refused merge left out are kept, for the recall gate. */
const refusedRecordsPath = (P) => paths(P.runDir).bandRefusedRecords;

/**
 * THE RECORDS A REFUSED MERGE LEAVES OUT: the ids the band merged again holds and the band standing does not, added to
 * those an earlier refusal left out. Returns how many are kept, or null when they could not be written, which the run
 * record names. Never throws.
 */
function recordRefusedRecords(P, band) {
  try {
    const key = (r) => String(r?.record_id ?? "").toLowerCase();
    const standing = new Set((safeReadJson(P.registerNamedBand)?.enumerated ?? []).map(key));
    const ids = [...new Set([...(safeReadJson(refusedRecordsPath(P))?.ids ?? []),
      ...(band?.enumerated ?? []).map(key).filter((id) => id && !standing.has(id))])];
    atomicWrite(refusedRecordsPath(P), JSON.stringify({ ids, count: ids.length }, null, 2) + "\n");
    return ids.length;
  } catch (e) {
    runLog(P.runDir, { event: "band-refused-records-failed", reason: String(e?.message ?? e).slice(0, 160) });
    return null;
  }
}

/**
 * The records a refused merge left out that are still outside the named band: a record a later merge took in is read,
 * and is not counted as left out. Never throws.
 */
export function refusedRecordsLeftOut(P) {   // @internal — driven by its test with a run's own files
  const ids = safeReadJson(refusedRecordsPath(P))?.ids;
  if (!Array.isArray(ids) || !ids.length) return [];
  const inBand = new Set((safeReadJson(P.registerNamedBand)?.enumerated ?? []).map((r) => String(r?.record_id ?? "").toLowerCase()));
  return ids.map((x) => String(x).toLowerCase()).filter((id) => id && !inBand.has(id));
}

/** The named band as it is written to disk: what a dispatch over it measures. */
const namedBandText = (band) => JSON.stringify(band, null, 2) + "\n";

export function deriveNamedBand(ctx, merged = null) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  const axes = ctx.axes ?? [];
  const { band, axes: ok, invalid } = merged ?? mergeRegisterBands(P, axes);   // a caller that measured the merge first hands it in
  const mergedFrom = axisBandsFingerprint(P, axes);
  if (invalid.length) {
    const detail = invalid.map((x) => `${x.axis}:${x.reason}`).join("; ");
    runLog(P.runDir, { event: "named-band-invalid", invalid });
    throw new StageFailure("fan-in", `register band artifact malformed for: ${invalid.map((x) => x.axis).join(", ")} (${detail.slice(0, 200)}) — judgment cannot read the funnel's own receipts; a report never ships over them`, undefined, { failClass: "deterministic" });
  }
  try {
    const tmp = P.registerNamedBand + ".tmp";
    writeFileSync(tmp, namedBandText(band));
    renameSync(tmp, P.registerNamedBand);
    ctx.bandsMergedAt = mergedFrom;
    runLog(P.runDir, { event: "named-band-merged", axes: ok, enumerated: band.enumerated.length, crowds: band.crowds.length });
  } catch (e) {
    note(`named-band merge write failed (non-fatal): ${String(e.message).slice(0, 100)}`);
  }
  // PR-8 — the reading layer's shape rides EVERY re-merge: the band never changes without the shape
  // following it in the same pass, so a stage can never read a shape older than its band.
  deriveBandShape(ctx, band);
  // P2-B — the owner screen's own receipt rides the same re-merge, for the same reason: the screen's
  // attribution is a function of the band, and a stale receipt is exactly how "produced no records"
  // outlived the records.
  deriveOwnerScreenArtifact(ctx, band);
  // — THE HIT LIST RIDES THE SAME RE-MERGE, for the same reason its two siblings do.
  // It is a projection of the band and nothing else, so a list older than its band would be a list that
  // disagrees with the archive about what was enumerated.
  deriveHitList(ctx, band);
  return band;
}

/**
 * — write `register-hit-list.json`: one slim line per enumerated record.
 *
 * THE LIST IS THE WORKING OBJECT AND THE BAND IS THE ARCHIVE. Judgment reads this; the band stays
 * whole, preserved, and unread by the stages that used to pay per-record attention to it.
 *
 * Best-effort like its siblings — a derivation failure removes a projection, it does not kill a run.
 * The BAND is the witness of what was enumerated; this file is how the run works through it, and a
 * missing one is visible immediately (every downstream reader takes it as its input).
 *
 * `read` rides where the band row carries the office's own reading of the mark. On the run measured,
 * 558 of 1,937 records had one on the normalised record and lost it at the band row — the adapter-side
 * half of that is cause 1, and this projection carries it the moment it is there.
 */
function deriveHitList(ctx, band) {
  const P = ctx.paths;
  try {
    // The reading lives on the row's SCREEN object — that is the shape the adapter builds and the
    // band row copies its top-level fields from. Measured on the archived round: every one of the
    // 1,937 rows carries a screen, and every populated `mark_text` came from it. Top level is read
    // as a fallback so a provider that promotes the field is not silently ignored.
    const lines = (band?.enumerated ?? []).map((r) =>
      slimLine(r, r?.screen?.mark_transliteration ?? r?.mark_transliteration ?? null));
    // ── CROWDS RIDE BESIDE THE LINES (Option A, as ruled) ─────────────────────────────────────────
    //
    // A crowd is a zone that could NOT be enumerated. Without it on the list, `band_lookup` answering
    // from the list returns nothing for a crowded zone — and nothing is indistinguishable from
    // "searched and clean". That is the silent-clean defect the whole programme exists to remove, so
    // the crowds land BEFORE the downstream swap can drop the band read.
    //
    // Written ALWAYS, empty when the run had none: an absent key means a list minted before crowds
    // rode, an empty array means this run had no crowd. Different facts, stated differently.
    //
    // ✕ WHAT THE SWAP STILL HAS TO CHECK BEFORE IT DROPS A BAND READ. `sample`, `term_counts` and
    // `class_counts` are deliberately NOT on the list — the first two are 82% of crowd bytes, and the
    // ruled field set excludes all three. Their consumers (crowd-context.mjs, coverage-ledger.mjs)
    // read register-named-band.json, which keeps being written, so nothing breaks today. But a swap
    // that repoints one of those readers at the list would silently lose the per-term and per-class
    // truth — named-band.mjs's own note says dropping class_counts hides WHICH class leg stayed open.
    // Census those three keys' readers before repointing anything, not after.
    const crowds = (band?.crowds ?? []).map(crowdLine);
    const tmp = P.registerHitList + ".tmp";
    writeFileSync(tmp, JSON.stringify({ schema_version: 1, lines, crowds }, null, 2) + "\n");
    renameSync(tmp, P.registerHitList);
    runLog(P.runDir, { event: "hit-list-minted", lines: lines.length, crowds: crowds.length,
      // a crowd whose count could not be taken is not a crowd that found nothing; the receipt says
      // how many of each, so a reader diagnosing coverage does not have to open the list to find out.
      crowds_uncounted: crowds.filter((c) => c.total_hits === null).length,
      with_reading: lines.filter((l) => l.read).length });
    return lines;
  } catch (e) {
    note(`hit-list mint failed (non-fatal): ${String(e.message).slice(0, 100)}`);
    return null;
  }
}

// P2-B (charter P2b) — write _driver/owner-screen.json: which owner slice ran, what it returned, and
// when it did not run, the mechanical reason. A projection of the frozen plan × the plan-execution
// receipt × the merged band; it decides nothing (the Coverage ledger stays the authority on status)
// and it is best-effort like its siblings — a derivation failure only removes a receipt.
function deriveOwnerScreenArtifact(ctx, band) {
  const P = ctx.paths;
  if (!ctx.registerPlan) return null;
  try {
    const blocks = Object.values(readRegisterBands(P, ctx.axes ?? [])).flat();
    const deferredByQid = new Map((readPlanExecution(ctx)?.deferred ?? [])
      .map((d) => [String(d?.qid ?? ""), String(d?.reason ?? "")]).filter(([q]) => q));
    let caps = null;
    try { caps = registerCapabilities(ctx.register); } catch { /* unknown provider — the screen still reports states */ }
    const screen = deriveOwnerScreen(ctx.registerPlan.entries ?? [], blocks, band?.enumerated ?? [],
      { deferredByQid, capabilities: caps });
    if (!screen.owners.length) return null;   // no incumbent lane on this matter — nothing to receipt
    atomicWrite(P.ownerScreen, JSON.stringify({ ts: new Date().toISOString(), ...screen }, null, 2) + "\n");
    // unconditional counts (AD-4): every field on every run, so a zero is a recorded zero.
    runLog(P.runDir, { event: "owner-screen-derived", ...screen.totals,
      owner_surface: screen.owner_surface, provider: screen.provider });
    return screen;
  } catch (e) {
    runLog(P.runDir, { event: "owner-screen-failed", fail: String(e?.message ?? e).slice(0, 160) });
    note(`owner-screen derivation failed (non-fatal — the band and the coverage ledger stand): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

/** Read the owner-screen receipt back (the lint + the digest/skeptic data block read it). */
export function readOwnerScreen(P) {   // @internal
  try { return existsSync(P.ownerScreen) ? JSON.parse(readFileSync(P.ownerScreen, "utf8")) : null; }
  catch { return null; }
}

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

// PR-8 (Thread D1) — derive the deterministic band SHAPE (band-shape.mjs) from the freshly merged band:
// _driver/band-shape.json + the readable band-shape.md the band tools serve. Targets = the mark under
// search + its manifest variants (the structured model when it parsed; the job's mark always). BEST-
// EFFORT, never a gate: a shape derivation failure is logged loudly and the run proceeds — judgment
// still holds band_lookup over the band itself, and every machine check reads the complete band anyway.
// The identity fields deriveRegisterPositions needs, from _records/ — registration/application
// numbers, the Madrid IR↔base linkage and the protocol/agreement designations, none of which a search
// row can carry. ONE builder for the two callers (the shape derivation and, when the shape's artifact
// is missing, the recall reconciliation), so the two can never disagree about what a position is.
// Measured on the real 2,596-record band: 220 ms over 35 MB. PURE-ish (reads, never writes).
function recordDetailIndex(runDir) {
  const detailByUri = new Map();
  for (const [uri, body] of readRecordArtifacts(runDir)) {
    const basics = (Array.isArray(body?.basicRegistrationApplications) ? body.basicRegistrationApplications : [])
      .flatMap((b) => (Array.isArray(b?.basicRegistrations) ? b.basicRegistrations : []))
      .map((b) => b?.basicRegistrationNumber).filter(Boolean);
    const md0 = body?.madridDesignations;
    const designations = [...(Array.isArray(md0?.protocol) ? md0.protocol : []), ...(Array.isArray(md0?.agreement) ? md0.agreement : [])];
    detailByUri.set(uri, {
      registrationNumber: body?.registrationNumber ?? null,
      applicationNumber: body?.applicationNumber ?? null,
      basicRegistrationNumbers: basics,
      madridDesignations: designations,
    });
  }
  return detailByUri;
}

function deriveBandShape(ctx, band) {
  const P = ctx.paths;
  let evidenceDoc = null;
  try {
    const targets = [];
    const markNames = Array.isArray(ctx.job?.marks)
      ? ctx.job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean)
      : [ctx.job?.markName ?? ctx.job?.name].filter(Boolean);
    targets.push(...markNames);
    try {
      if (existsSync(P.variantManifestModel)) {
        const model = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8"));
        targets.push(model.mark, model.dominant_element,
          ...model.elements.filter((e) => e.kind === "distinctive").map((e) => e.value),
          ...model.variants.map((v) => v.value));
      }
    } catch { /* prose-only manifest — the job's mark still classifies */ }
    let crowdContext = null;
    try { if (existsSync(P.crowdContext)) crowdContext = JSON.parse(readFileSync(P.crowdContext, "utf8")); }
    catch { /* evidence artifact unreadable — the shape's crowds simply carry no join */ }
    // The instructed classes and those the frame added for the client's own goods (decision 18, ruled 2026-09-21): a live identical record in either is a floor.
    let inScopeClasses = []; try { inScopeClasses = inScopeClassList(ctx.job, ctx.profile).map(String); } catch { inScopeClasses = (ctx.job?.classes ?? []).map(String); }
    inScopeClasses = withFrameClasses(inScopeClasses, P.runDir);
    // P2-A (charter P2d) — the exact-identity POSITIONS projection rides every shape derivation, so
    // the identity collapse exists BEFORE any digest reads the band. The detail index (registration
    // numbers, IR-base linkage, Madrid designations) comes from _records/ — the fields search rows
    // cannot carry. Best-effort inside the shape's own best-effort: a positions failure only omits
    // the projection (the per-registration band and floors are untouched).
    let positions = null;
    try {
      positions = deriveRegisterPositions(band?.enumerated ?? [], recordDetailIndex(P.runDir));
      atomicWrite(P.registerPositions, JSON.stringify({ ts: new Date().toISOString(), ...positions }, null, 2) + "\n");
      // counts only — never a cost, never a client identity (telemetry contract)
      runLog(P.runDir, { event: "register-positions-derived", records: positions.totals.records,
        positions: positions.totals.positions, bridges: positions.totals.bridges });
    } catch (e) {
      runLog(P.runDir, { event: "register-positions-failed", fail: String(e?.message ?? e).slice(0, 160) });
      note(`register-positions derivation failed (non-fatal — the per-registration band stands): ${String(e?.message ?? e).slice(0, 100)}`);
    }
    const shapeGoods = bandShapeGoods(P, band?.enumerated ?? []);
    // What each record's goods rest on, derived first so the shape says it of each line the goods test could not
    // place; the same record is written beside the shape below.
    try { evidenceDoc = goodsEvidenceDocFor(ctx, band, shapeGoods.goods); } catch { evidenceDoc = null; }
    const evidenceBy = evidenceDoc ? new Map(evidenceDoc.records.map((r) => [r.uri, r])) : null;
    const evidenceOf = evidenceBy ? (r) => evidenceBy.get(normalizeRecordUri(r?.record_id) || String(r?.record_id ?? "")) ?? null : null;
    // what was retrieved under each crowd, from the per-axis blocks on disk now: the shape never carries a record older than its band
    const endings = (() => {
      if (!ctx.registerPlan || !(band?.crowds?.length)) return [];
      try { return crowdNarrowing(ctx.registerPlan, blocksByQidOf(readRegisterBands(P, ctx.axes ?? [])), { mainMarkets: mainMarketsOf(ctx) }).rows; } catch { return []; }
    })();
    const { shape, md } = buildBandShape(band, { crowdNarrowing: endings, targets: targets.slice(0, 64), inScopeClasses, crowdContext, positions, ...shapeGoods, markets: clientMarkets(instructedOrder(P, ctx.job), ctx.profile), territories: orderTerritories(instructedOrder(P, ctx.job), ctx.profile), keysOf: setAsideKeysOf(positions?.positions ?? null), evidenceOf });
    mkdirSync(dirname(P.bandShape), { recursive: true });
    atomicWrite(P.bandShape, JSON.stringify(shape, null, 2) + "\n");
    atomicWrite(P.bandShapeMd, md + "\n");
    const tested = shape.groups?.goods_test ?? { source: "none", words: [] };
    runLog(P.runDir, { event: "band-shape-derived", records: shape.totals.records, crowds: shape.totals.crowds,
      tiers: shape.totals.by_tier, floors: shape.floors.in_class_identical_or_near.length,
      goods_test: tested.source, goods_test_words: tested.words.length,
      // what each record's goods rest on: a held body, its band row's whole statements, statements cut short, or none
      goods_evidence: goodsEvidence(band?.enumerated ?? [], shapeGoods.goods),
      blind_spots: shape.blind_spots.map((b) => ({ kind: b.kind, count: b.count })) });
    // The goods test falls back where the variants stage named no product words; the run says so.
    if (tested.source !== "product_words")
      note(`band shape: no product words named — the goods test reads ${tested.source === "goods_words" ? "the words the register search was narrowed by" : "no words, so every line it would place is listed as not tested on goods"}`);
  } catch (e) {
    runLog(P.runDir, { event: "band-shape-failed", fail: String(e?.message ?? e).slice(0, 200) });
    note(`band-shape derivation failed (non-fatal — judgment still holds band_lookup over the band; machine checks read the complete band): ${String(e?.message ?? e).slice(0, 120)}`);
  }
  recordGoodsEvidenceFor(ctx, band, evidenceDoc);
  // Placement's standing decisions are read off the shape, so a shape derived again can change them with no placement
  // pass: a group's row checked again on the new shape may cover other lines, or stand no longer, and the floors it
  // leaves can grow. The decisions file the reading step, the writer and the review declare is written again with the
  // shape, so such a change makes a stage that already read them stale. Only once placement has written it.
  if (existsSync(P.placementDecisions)) {
    try { writePlacementDecisions(P); }
    catch (e) { runLog(P.runDir, { event: "placement-decisions-failed", at: "band-shape", reason: String(e?.message ?? e).slice(0, 120) }); }
  }
}

/**
 * WHAT EACH BAND RECORD'S GOODS REST ON, written beside the shape after every derivation (goods-evidence.mjs): the
 * goods reader the shape tests with, given the band's records so that a reader which reads a band row's own goods
 * reads them here too; the official records the run holds, with where each came from; and this run's record fetches,
 * from the register call ledger. The shape says the same of each line from the same derivation (its goods cell and
 * `goods_evidence`); the file itself is served by no band tool, gates nothing, and a failure costs the run this
 * record and nothing else.
 */
function goodsEvidenceDocFor(ctx, band, goods = null) {
  const P = ctx.paths;
  const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
  const calls = runPrefix ? readRunCallRows(DEFAULT_LEDGER_PATH, runPrefix) : { rows: [], error: null };
  const records = Array.isArray(band?.enumerated) ? band.enumerated : [];
  const doc = deriveGoodsEvidence({ records, goods: goods ?? bandShapeGoods(P, records).goods, held: heldRecordProvenance(P.runDir),
    fetches: recordFetchOutcomes(calls.rows, { runPrefix }) });
  // Whether fetches could be read is part of the record: without the ledger, "not held" may hide a failed fetch.
  doc.fetches_read = runPrefix ? (calls.error ? `the register call ledger could not be read: ${calls.error}` : true) : "no run prefix";
  return doc;
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

function recordGoodsEvidenceFor(ctx, band, derived = null) {
  const P = ctx.paths;
  try {
    const doc = derived ?? goodsEvidenceDocFor(ctx, band);
    ensureDriverDir(P.runDir);
    atomicWrite(driverDir(P.runDir, GOODS_EVIDENCE_FILE), JSON.stringify(doc, null, 2) + "\n");
    runLog(P.runDir, { event: "goods-evidence", records: doc.totals.records, by_state: doc.totals.by_state,
      by_source: doc.totals.by_source, unreadable: doc.totals.unreadable, fetches_read: doc.fetches_read });
  } catch (e) {
    runLog(P.runDir, { event: "goods-evidence-failed", fail: String(e?.message ?? e).slice(0, 160) });
  }
}

// The DETERMINISTIC GRID CONTRACT — extracted from pipelineInner unchanged (item).
//
// It was inline, which meant `_driver/grid-spec.json` and the two A1 half-specs existed only if you had
// entered pipeline(). `--experiment common-law-half` therefore could not run at all: its prompt hands
// the plugin `grid_spec_path: _driver/grid-spec.half-<x>.json`, and nothing put that file in the
// sandbox. Now it is a named derivation the rig replays (stage-context.mjs CONTEXT_DERIVATIONS
// "grid-spec"), and pipelineInner calls exactly this.
//
// Reads ctx.gridVariants / ctx.profile / ctx.registerOnly and writes ctx.gridSpecPath + ctx.clHalfTerms,
// exactly as the inline block did. Nothing about WHAT it computes changed: `runCommonLaw` was
// `!ctx.registerOnly` at the call site, `run.runDir` is `ctx.paths.runDir`, and the canonical spec path
// is now the paths() key rather than the same string spelled inline.
function deriveGridSpec(ctx) {
  const P = ctx.paths;
  // Deterministic grid contract (robust fix, 2026-06-14): write the EXACT terms × platforms the grid
  // will run as a code-owned spec. The perplexity plugin reads this, runs only these cells, and writes
  // common-law-grid.json ITSELF from the API response — the large grid JSON never round-trips through
  // the model's bounded turn-output (no truncation: measured on a dense beverages run) and the model never re-types
  // the keys or cells (no drops/mis-keys: NOVA PULSE/marble-anvil). The receipts gate joins against THIS
  // same file, so it can never demand a key the grid did not run. No profile (no dictated platforms) ⇒
  // legacy model-authored path (back-compat; the gate falls back to the prose manifest).
  ctx.gridSpecPath = null;
  ctx.clHalfTerms = null;   // A1 split — {a:[terms], b:[terms]} when the two-member split is armed below
  // — WHICH PATH, AND WHY. The 2026-08-12 round could not answer this from any artifact: one build
  // ran the unsplit stage and delivered, the next ran three halves and died, and the run records held
  // nothing that named the difference. The flag was a red herring both times — it is ON by default and
  // was ON for both — because the selector is a CONJUNCTION and it was a different term that differed.
  // Every branch below writes its own reason; the initial value is the one that actually decided the
  // 2026-08-11 codex R2 run (no grid spec authored at all), and it is the branch that emits NO event
  // today, which is why absence was the only signal and absence is not a record.
  // The three inputs are recorded, not just their verdict. Working hit exactly this wall: the
  // 2026-08-11 run authored no spec, `clearance-variants` had succeeded, and WHICH of the three conjuncts
  // was false could not be recovered from any artifact — so the round could name the path but not the
  // cause. A record that says "no spec" and not "no spec BECAUSE the profile carried no platforms" just
  // moves the same unanswerable question one step along.
  ctx.clSplitDecision = {
    path: "unsplit", reason: "no-grid-spec",
    detail: ctx.registerOnly
      ? "register-only run — no common-law grid is authored, so there is nothing to split"
      : "no dictated grid spec (legacy spec-less path) — the split partitions a spec, so with no spec it cannot arm",
    terms: null,
    spec_inputs: { registerOnly: Boolean(ctx.registerOnly), gridVariants: ctx.gridVariants?.length ?? 0, profilePlatforms: ctx.profile?.platforms?.length ?? 0 },
  };
  // AN EMPTY MARKETPLACE LIST STILL WRITES A GRID. A company may pick no marketplaces (the owner's ruling of
  // 2026-09-23), and the general-web cell and the meaning sweep ride in this spec: gating it on a non-empty
  // list switched both off with the stores, and the downgrade clamp then read the missing spec as a failed
  // sweep. The spec below is then the web cell plus whatever channels the matter frame names. Only a profile
  // with no list at all (legacy) takes the spec-less path.
  if (!ctx.registerOnly && ctx.gridVariants?.length && Array.isArray(ctx.profile?.platforms)) {
    const gridSpecPath = P.gridSpec;
    // #5 — required channels: a NAMED profile's curated platforms are authoritative. The GENERIC fallback
    // derives the channels from the MATTER FRAME's industry/goods reasoning (its "Search channels:" line) so
    // a regulated/B2B matter (veterinary pharma, say) searches its real channels (EMA/FDA registers) instead of
    // being forced onto — and invalidated by — consumer storefronts. No static class→channel table: the
    // frame names them the way a lawyer reasons about the vertical, so it generalises to ANY industry. The
    // deterministic grid runs grid-spec.platforms and the receipts gate joins the SAME file, so this is the
    // single, consistent lever. Frame named none ⇒ keep the profile default (back-compat, never worse).
    const matterMd = existsSync(P.matterContext) ? readFileSync(P.matterContext, "utf8") : "";
    // THE FRAME'S CHANNELS REACH THE GRID FOR EVERY PROFILE NOW, not only the generic one. A delivered
    // run swept the customer's eight storefronts while the frame named this matter's own ecosystem — a
    // plugin repository among them — and none of it was queried; the lawyer graded a plugin published
    // there. A named profile's list is the client's mandate, so it stands and the frame's channels run
    // BESIDE it; generic still replaces, because its list is a house default and that branch exists to
    // keep a regulated matter off consumer storefronts. gridChannels owns both readings.
    // Read once and reported below: a considered "none named" and an unreadable line are not one silence.
    const chosen = gridChannels({ profilePlatforms: ctx.profile.platforms,
      profileKey: ctx.profile.profileKey, matterMd });
    const channels = chosen.channels;
    const diag = chosen.diag;
    if (chosen.added.length) {
      note(`common-law channels: the matter frame named ${chosen.added.length} channel(s) the profile does not carry, added beside it — ${chosen.added.join(", ")}`);
      runLog(P.runDir, { event: "commonlaw-channels-added", added: chosen.added, from: "matter-frame" });
    } else if (ctx.profile.profileKey === "generic" && diag.channels.length) {
      note(`common-law channels derived from the matter frame (generic profile): ${diag.channels.join(", ")}`);
    } else if (diag.state === "all-rejected") {
      note(`common-law channels: the matter frame's "Search channels:" line named ${diag.offered.length} value(s) and NONE is domain-shaped, so every one was discarded and the profile's stand — ${diag.rejected.slice(0, 6).map((s) => JSON.stringify(s)).join(", ")}. The frame answered; the answer could not be used.`);
      runLog(P.runDir, { event: "commonlaw-channels-unusable", state: diag.state, rejected: diag.rejected.slice(0, 12) });
    } else {
      note(`common-law channels: ${diag.state === "no-document" ? "no matter-context file to read" : "the matter frame carries no \"Search channels:\" line"}, so the profile's ${channels.length} platform(s) stand.`);
      runLog(P.runDir, { event: "commonlaw-channels-unstated", state: diag.state });
    }
    // THE MEANING SWEEP IS THE MATTER FRAME'S LIST (ruled 2026-09-25). A meaning search runs at all because
    // of a live near-miss: a benign-reading name one letter off a major street-gang label, meaning sweep
    // skipped, clean PR claimed. The frame names the meanings and the languages that matter for this matter
    // (its "Meaning angles:" line, required on fresh runs by the matterContext validator); the driver
    // DICTATES them verbatim, exactly like the term×platform cells, and the plugin runs them on the general
    // web and records each into the ledger's extras.pr_risk[] — a tool-written receipt the model cannot
    // fabricate, and verify.mjs rejects a clean PR claim with no recorded queries. Two fixed shapes rode
    // beside the list, about 54 questions whatever the matter; they are gone. The count is ASSERTED in the
    // grid-spec event either way — a 0 is the frame's recorded `none`, never an absence.
    const angleQueries = meaningAnglesFromMatterContext(matterMd);
    // Only the frame's `none` is a decision. A missing line, or one naming nothing usable, would read to
    // the web step as that decision and skip the meaning search on a frame that never made it.
    const anglesAssertedNone = meaningAnglesAssertedNone(matterMd);
    if (!angleQueries.length && !anglesAssertedNone)
      throw new StageFailure("grid-spec",
        "the matter frame's \"Meaning angles:\" line is missing or names no usable question, and the frame did not assert none — so there is no meaning search to dictate, and an empty one would read as the frame's decision",
        undefined, { failClass: "deterministic" });
    // THE WEB GRID THE MATTER FRAME DECIDED (web-grid.mjs): the stores it did not set aside, for the mark
    // itself and the forms a buyer could confuse, and every spelling on the general web. A frame that was
    // never asked for those fields (a resumed older run) keeps every spelling on every channel.
    const choice = frameWebChoiceFor(P.runDir);
    const asked = frameAskedForWebGrid(P.runDir);
    const markNames = Array.isArray(ctx.job?.marks)
      ? ctx.job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean)
      : [ctx.job?.markName ?? ctx.job?.name].filter(Boolean);
    // THE FAMOUS-MARK CHECK: the elements the variants step flagged, each searched on the general web. A
    // manifest that cannot be read here flags none, which is the grid as it was before the flag.
    let famous = [];
    try { famous = famousMarkElements(parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8"))); } catch { /* none */ }
    const web = webGridOf({ variants: ctx.gridVariants, channels, marks: markNames,
      forms: choice.forms, setAside: choice.setAside, decided: choice.forms !== null || asked, famous });
    const webCells = web.grids ? web.grids.reduce((n, g) => n + g.terms.length * g.platforms.length, 0) : web.terms.length * web.platforms.length;
    runLog(P.runDir, { event: "frame-web-grid", reading: web.grids ? (choice.forms !== null ? "frame-forms" : "mark-only") : "every-channel",
      forms: choice.forms?.length ?? null, stores: web.platforms.length - 1, stores_set_aside: web.setAside.filter((x) => x.store).length,
      forms_set_aside: web.setAside.filter((x) => x.form).length, unmatched: web.unmatched.length, cells: webCells,
      famous: web.famous?.length ?? 0 });
    if (!web.grids) note(`common-law grid: the matter frame was not asked for its stores and forms, so every spelling runs on every channel (${webCells} cells)`);
    else note(`common-law grid: ${web.platforms.length - 1} store(s) for ${web.grids.length > 1 ? web.grids[0].terms.length : 0} form(s), and ${web.terms.length} spelling(s) on the general web — ${webCells} cells${choice.forms === null ? "; the frame sent no forms, so the mark itself stands in for them" : ""}${web.setAside.length ? `; ${web.setAside.length} set aside by the frame with its reason` : ""}${web.famous?.length ? `; ${web.famous.length} element(s) flagged for the famous-mark check among the general-web searches` : ""}`);
    const gridSpec = {
      terms: web.terms,
      platforms: web.platforms, // the dictated stores + the general-web cell
      // THE BLOCKS: which terms run on which platforms, when the frame decided the grid. `menu` is every
      // channel the frame chose from, and `set_aside` what it left out with its reason, for the record and
      // the audit workbook; neither dictates a cell.
      ...(web.grids ? { grids: web.grids, menu: web.menu, set_aside: web.setAside } : {}),
      // The famous-mark check's cells, for the record: each is a general-web cell the grid above carries.
      ...(web.famous?.length ? { famous: web.famous } : {}),
      output_path: P.commonLawGrid,
      // SIZED BY THE CELLS THIS GRID RUNS, never larger than the profile's own figure (gridBatchFor).
      batch: gridBatchFor(ctx.profile, web.platforms.length),
      // disposition_required (P2-C §8b leg 2): the receipt-presence stamp arming the commonLaw validator's
      // receipts-disposition arm (the D1 ledger_required pattern — every fresh spec carries it; pre-P2-C
      // archived specs lack it, so replay verdicts never flip). splitGridSpec spreads the connotation
      // object, so the stamp rides the halves harmlessly (the half validator skips the connotation gate).
      // — dispositions_path rides the CANONICAL spec too, not only the halves. Until this it was
      // written by splitGridSpec alone, so the three paths that reach an UNSPLIT grid — the split flag
      // off, a single-term grid, a resume of a pre-split run — named the seat no file to fill and the
      // meaning sweep fell back to a prose regime that no longer exists. The path is dictated HERE and in
      // splitGridSpec, from the same P.* factory, and derived nowhere: the grid tool writes the form, the
      // gateway unions it and the validator reads it, all from this one string.
      // `none_named` is the frame's asserted zero carried to the seat that owns the sweep, so an empty list
      // reads as the frame's decision and never as a spec the driver failed to write.
      connotation: { queries: angleQueries, ...(anglesAssertedNone ? { none_named: true } : {}), disposition_required: true,
        dispositions_path: P.commonLawDispositions },
      // D1 fail-closed stamp: the commonLaw validator refuses a missing plugin ledger ONLY for specs
      // carrying this field (receipt presence, never absence) — pre-D1 archived specs lack it, so
      // replay verdicts on old runs never flip while every fresh grid is ledger-or-fail.
      ledger_required: true,
      // HOW MANY RESULTS EACH CELL AND EACH MEANING QUERY ASKS FOR AND KEEPS, by report type, from the
      // run's frozen policy. A run frozen before the rule names none, and its program asks as it did.
      ...resultsPerCellOf(ctx.searchPolicy),
    };
    atomicWrite(gridSpecPath, JSON.stringify(gridSpec, null, 2) + "\n");   // B5 — the canonical grid-spec is never seen torn (the fail-closed join rejects a truncated read)
    ctx.gridSpecPath = gridSpecPath;
    runLog(P.runDir, { event: "grid-spec", terms: gridSpec.terms.length, platforms: gridSpec.platforms.length, connotation: angleQueries.length, connotation_derived: angleQueries.length });

    // ── A1 SPLIT (perf): the per-half spec sidecars for the two concurrent common-law members ────────
    // The canonical _driver/grid-spec.json above stays the FULL spec — the validator/receipts join, the
    // coverage-closure gap recompute and replay all key on it, stamped ledger_required exactly as before.
    // When the split is armed the driver ALSO writes one half-spec per member (grid-spec.half-a/b.json):
    // terms partitioned by the deterministic parity partition (common-law-receipts.splitGridTerms — a
    // term owns ALL its platforms in one half, so the per-variant count/identity joins hold at half
    // level), connotation queries partitioned the same way (each owned by exactly one half; the merge's
    // concat+dedup restores the full receipt set), each half writing its OWN ledger. The halves merge in
    // CODE into the canonical common-law-grid.json at gather fan-in, before anything downstream reads it.
    // Self-disarm case (single-member assembly kept VERBATIM): a single-term grid, which has nothing to
    // partition.
    //
    // item 8 deleted the `flag-off` case with CLEAROTRON_COMMONLAW_SPLIT. A resume of a PRE-SPLIT run (a
    // valid common-law-findings.md with no half files beside it) also kept the single-member assembly, and
    // that case is gone too: a run from an earlier build is no longer resumed, and a current run whose
    // grid has two or more terms splits on its first pass, from frozen inputs a resume derives the same
    // grid from. The single-term grid is why the ASSEMBLY stays: it reaches it without any switch, and
    // records its own reason.
    const splitTerms = gridSpec.terms.length;
    if (splitTerms < 2)
      ctx.clSplitDecision = { path: "unsplit", reason: "single-term-grid",
        detail: `the grid carries ${splitTerms} term(s) — there is nothing to partition into two halves`,
        terms: splitTerms };
    if (splitTerms >= 2) {
      const halves = splitGridSpec(gridSpec, {
        outputPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, P.commonLawGridHalf(h)])),
        // — dictated, so the grid tool names the same file the validator reads.
        dispositionsPaths: Object.fromEntries(GRID_SEATS.map((h) => [h, P.commonLawDispositionsHalf(h)])),
      });
      for (const h of GRID_SEATS) atomicWrite(P.gridSpecHalf(h), JSON.stringify(halves[h], null, 2) + "\n");
      // THE FRAME NAMED NO MEANING QUESTION, so the meaning seat has nothing to search. Its ledger is the
      // empty one the grid tool would have written, written here, so the merge and every check downstream
      // read a sweep of zero queries rather than a missing file; the seat is told not to run the tool.
      if (halves[MEANING_SEAT]?.connotation?.none_named === true)
        atomicWrite(P.commonLawGridHalf(MEANING_SEAT), JSON.stringify({ cells: [], extras: { pr_risk: [] }, gaps: [] }, null, 2) + "\n");
      ctx.clHalfTerms = { a: halves.a.terms, b: halves.b.terms };

      ctx.clSplitDecision = { path: "split", reason: "armed",
        detail: `${splitTerms} dictated terms, not a pre-split resume — the grid runs as ${GRID_SEATS.length} concurrent half-members`,
        terms: splitTerms,
        halves: Object.fromEntries(GRID_SEATS.map((h) => [h, halves[h]?.terms?.length ?? 0])) };
      //: connotation_<h> = 0 on the non-owning half is the ASSERTED ownership receipt, not a
      // missing sweep. The count that means "no meaning sweep was dictated at all" is the `grid-spec`
      // event's own `connotation:` field above; a reader comparing the two can tell them apart.
      // — connotation_a / connotation_b are now BOTH zero by construction, and that pair is the
      // regression signal this issue asked for: the gate that fired on 13 of 14 first attempts cannot
      // fire on a seat that owes nothing. connotation_m is where the sweep went.
      runLog(P.runDir, { event: "grid-split", terms_a: halves.a.terms.length, terms_b: halves.b.terms.length,
        connotation_a: halves.a.connotation.queries.length, connotation_b: halves.b.connotation.queries.length,
        connotation_m: halves[MEANING_SEAT].connotation.queries.length,
        connotationOwner: MEANING_SEAT });
    }
  }
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

// The driver-computed prompt blocks, bound the same way. `skepticDeferralExtra` and
// `digestDispatchExtra` are the two dispatches that carry context no file records.
const DISPATCH_EXTRA_BUILDERS = {
  // WHICH PASS ARE WE REPRODUCING? A digest's extra is not one string: A8's hint and the owner receipt
  // ride every pass, the placement rulings tail rides only a CORRECTIVE one. Default "fresh" — that is
  // the pass a preserved run's canonical artifact came from, so it is what "identical to what pipeline()
  // would hand it" means unless the operator says otherwise (--dispatch-trigger).
  "digest-dispatch-extra": (ctx, opts = {}) => digestDispatchExtra(ctx, { trigger: opts.dispatchTrigger ?? "fresh", willRun: true }),
  // (the trigger vocabulary is validated in runExperiment — a typo must refuse, not quietly compose a
  // different arm: "escalaton" would silently drop the rulings tail and nothing would say so)
  "skeptic-deferral-extra": (ctx) => skepticDeferralExtra(ctx),
  // corruption 2 — narrative-refutation's two, composed inline at the dispatch site until now.
  "plan-audit": (ctx) => planAuditExtra(ctx),
  "refute-registry-check": (ctx) => refuteRegistryCheckExtra(ctx),
  "refute-plain-register": (ctx) => plainRegisterExtra(ctx),
  // — the SAME receipt derivation, one seat earlier. A distinct id rather than a second
  // `plan-audit` entry so the dispatch receipt (`extras`) still says which stage carried which block;
  // the builder delegates, so there is one derivation and one set of graded classes.
  "synthesis-plan-audit": (ctx) => planAuditExtra(ctx, { stage: "synthesis" }),
  "synthesis-coverage-ledger": (ctx) => coverageLedgerExtra(ctx),
};

/**
 * THE ONE COMPOSER ( corruption 2). Every driver-computed prompt block for a stage, built in
 * registry order, returned with the ids and sizes that produced it.
 *
 * Production dispatch sites call this and so does the `--experiment` sandbox. That is the entire fix:
 * corruption 2 was not a missing entry in a table, it was a design in which the production prompt and
 * the shadow prompt were composed by two different pieces of code that had to be kept in step by hand.
 * `refute()` drifted; nothing could have told anyone. With one composer a block cannot exist on one
 * path and not the other, and a NEW block reaches both the moment it is registered.
 *
 * A builder that throws is noted and skipped rather than failing the run — a prompt block is additive
 * context, and losing a production dispatch over one would be worse than the block being absent. The
 * `ids` it returns are what actually got built, so an absence is visible on the arm's receipt instead
 * of inferred from a table.
 *
 * ── review: THE COMPOSER STAMPS WHAT IT BUILT, AND THE PROMPT READS THE STAMP ────────────────
 *
 * A stage message that PROMISES a driver-computed block ("it is tabulated for you below") is making a
 * claim about this function's output, and it was making it unconditionally. Three reachable shapes
 * produce no block — no frozen register plan (a class-less matter or a pre-spec48 resume; the degrade
 * is documented at attachRegisterPlan), an unparseable receipt, and neither artifact on disk — and on
 * all three the seat was told a table was below and given none. A seat that reads no MISSING slice in
 * a promised table has been handed an absence dressed as a pass, which is the one inference
 * exists to stop.
 *
 * ONE DERIVATION, NOT A SECOND PREDICATE. The obvious fix — a helper the message calls to guess what
 * the builders will do — is two copies of one rule, which is the drift this build spent b0ac330
 * removing. Instead the composer records what it ACTUALLY built on the ctx, and the message branches
 * on that record. Every path that dispatches a stage cold composes first and renders the message
 * second (production at the fresh call site, `experimentExtra` for the `--experiment` arm, and the
 * stale-repair entry), so the stamp is always the truth about the very message being built. It cannot
 * be threaded at one call site instead: `experimentExtra` is a different function, and a stamp set
 * only in production would make the shadow prompt take a different branch from the run it measures —
 * corruption 2, rebuilt inside the build that cites corruption 2.
 *
 * ABSENT IS NOT CORRUPT. `failed` is recorded apart from "did not build": no plan and no receipt is a
 * legitimate run shape, while a receipt that exists and cannot be parsed is a DRIVER-written artifact
 * bug. Collapsing the two would make the bug read as an ordinary run — an absence that is not a
 * finding. The prompt says which of the two it is, and the note() still fires for the run log.
 */
export function composeDispatchExtra(name, ctx, opts = {}) {   // @internal
  const parts = [], ids = [], failed = [], empty = [];
  for (const x of DISPATCH_EXTRAS) {
    if (x.stage !== name) continue;
    // `skip`: blocks a dispatch deliberately does not send — the review after a delivery-check repair leaves
    // out the plain-words list, which covers every line a client meets and points at a check that review is
    // not given. Skipped is not built and not failed: it appears in neither list.
    if (Array.isArray(opts.skip) && opts.skip.includes(x.id)) continue;
    try {
      const built = DISPATCH_EXTRA_BUILDERS[x.id](ctx, opts);
      recordEmptyReturn(built, x.id, { parts, ids, empty });   // EVERY builder that ran is recorded, not only those that produced text: `if (built)` alone put an empty return in neither list, so a block that ran with nothing to flag read exactly like one that never ran — and only the second is a defect. The three-way sort lives in stages.mjs beside the sentinels it reads.
    } catch (e) {
      const detail = String(e?.message ?? e).slice(0, 100);
      failed.push({ id: x.id, error: detail });
      note(`dispatch extra "${x.id}" threw (${detail})`);
    }
  }
  // The stamp rides the ctx the message is about to be rendered from. Keyed by stage, because one ctx
  // composes blocks for several stages over a run and the last one must never answer for another.
  // `stampDispatchBlocks` is imported from stages.mjs, where the reader lives: one definition of the
  // stamp's shape, rather than a field name two files agree on by hand.
  stampDispatchBlocks(ctx, name, { built: ids.map((x) => x.id), failed, empty });
  return { text: parts.length ? parts.join("\n\n") : "", ids, failed, empty };
}

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

// The case-law profiles joined to the findings as they stand: the profiles carry the writer's numbers, and after a
// grouping the delivered record has its own (joinCaseLawProfiles).
const caseLawJoin = (P, findings) => joinCaseLawProfiles(parseCaseLawProfiles(readFileSync(P.caseLaw, "utf8")), findings, readFold(P.runDir)?.map?.modelToFolded ?? null);

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
    } catch { /* no case-law layer — production passes null here too */ }
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

// Read the synthesis SUFFICIENCY signal from findings.json. The driver reads the raw JSON directly (NOT via the
// strict parseFindingsJson key-allowlist) so the verdict-clamp is decoupled from the findings parser: an absent
// field (clean run, archived run) is the "sufficient → deliver clean" default. Shape (synthesis contract):
// {sufficient:bool, reason:string}. There are no `commands`/`halt` any more — the lawyer's judgment that a
// material slice was not fully cleared CLAMPS the verdict CLEAR→CONDITIONAL (deliver-conditional), never a
// re-search loop and never a halt.
function readCoverageJudgment(P) {
  const ABSENT = { present: false, sufficient: true, reason: "" };
  if (!existsSync(P.findings)) return ABSENT;
  let doc;
  try { doc = JSON.parse(readFileSync(P.findings, "utf8")); } catch { return ABSENT; }
  const cj = doc && typeof doc === "object" ? doc.coverage_judgment : null;
  if (!cj || typeof cj !== "object" || Array.isArray(cj)) return ABSENT;
  return {
    present: true,
    sufficient: cj.sufficient !== false,   // default-true: only an explicit false withholds (→ CONDITIONAL)
    reason: String(cj.reason ?? "").slice(0, 300),
  };
}

// Round 2 Change 1d — best-effort: the jurisdiction tokens a run actually searched, read from the coverage
// ledger unit scopes (e.g. "primary-sweep / EU", "transliteration-numeric / PH (material)"). A "worldwide" /
// "global" scope is reported separately: it covers the in-scope set (so no under-coverage), but on a narrow
// scope it is itself the over-reach the skill (Change 1c) must bound.
// A12 (addendum 2026-07-30): tokens are recorded in the CANONICAL vocabulary (UK→GB, EM/EUTM/EUIPO→EU —
// driver/jurisdiction-codes.mjs), so a ledger that spells the same territory two ways yields ONE code and
// the scope diff can never flag GB-vs-UK as different territories. Tokens outside the known universe ride
// back in `unknown` — carried in `jurisdictions` too (never dropped), but the caller must surface them
// LOUDLY (a jurisdiction nobody can place must never be a silent row in the machine record).
// item 13 — `extractSearchedJurisdictions` LIVED HERE AND IS GONE. It ran a two-letter scan over the
// coverage ledger's prose to decide which territories a run had searched, and the narrowing (drop
// tokens that are not known jurisdiction codes) closed only the half where the junk token was not a real
// code. The other half cannot be closed by any token list: SA, AG, KG, SL and SE are simultaneously real
// jurisdiction codes and ordinary European company suffixes, so "… GmbH & Co. KG" reads as Kyrgyzstan and
// always would have. A territory claimed as searched now traces to an EXECUTED QUERY —
// `searchedJurisdictionsFromPlan(plan, execution)` in register-plan.mjs, joining plan entries' `regions[]`
// to plan-execution's `executed[].qid`. Do not reintroduce a prose derivation here in any form.

// The MIRROR-quarantine predicate: which coverage failures mean "the findings are good and only the
// machine ledger is bad", so the run may proceed on the rows it has with the mirror quarantined.
//
// — NARROWED FROM `coverage_` TO THE STRUCTURE FAMILY, and the width was already wrong. A bare
// `coverage_` prefix swept in every `coverage_clean_*` judgment token too: a refused CLEAN CLAIM deleted
// the machine ledger and stamped `machineLedgerNote` saying "coverage gates read the prose table for
// this run" — a sentence about a defect that was never the mirror's. It survived only because the
// re-validate underneath it re-failed, so the synthetic ok never fired. With the coverage FORM the same
// width would be live: `coverage_no_status` names a judgment the seat has not made, and quarantining a
// derived artifact cannot make that true. The form tokens are deliberately OUT — a refused judgment
// fails the stage and rides the corrective ladder, which is the only thing that can fix it.
const isCoverageLedgerFail = (fail) => /invalid_file:.*?:coverage_(ledger|axis|key|mirror|status|classes)_/.test(fail ?? "");

/**
 * Does the case-law grounding stage run? REQUESTED-OR-DETECTED (F4, 2026-07-21).
 *
 * It used to be detection-only — a regex over the draft narrative — which made the composer's "Case law"
 * toggle a dead switch: a client could buy the "Full deep dive"'s headline feature and receive it only if
 * the drafting model happened to reach for one of these five words. `job.caseLaw === true` now forces it.
 *
 * The detector is deliberately kept as an OR rather than replaced. It is the run's own reasoning noticing
 * that the read turns on a precedent or an opposition, and a client who left the box unticked has not
 * thereby instructed us to ignore that. So the lever is ADDITIVE: it can only ever add the stage, never
 * suppress one the narrative called for — which is why an explicit `caseLaw: false` is recorded and not
 * obeyed. The honest way to sell a search without case law is a level that does not run it, not a flag
 * that overrides the run's judgment mid-flight.
 *
 * TWO PLACES CAN REQUEST IT, and they OR together for the same reason. `job.caseLaw` is this request;
 * `policy.caseLaw` is the frozen saved search that was named instead of a level — a composer that offers
 * "Save as search" over a lever the recipe then dropped would sell a search that quietly differs from the
 * one that was saved. Whichever asked, the run is the same and the log records both.
 */
// The five words whose presence in the draft narrative means the run's own reading turned on a precedent
// or an opposition. Exported so a probe binds to it instead of retyping it (the rule).
export const CASE_LAW_TRIGGERS = /watchlist|precedent|case[- ]law|opposition|famous mark/i;   // @internal

// — CASE LAW HAS EXACTLY ONE HOME, AND THE PRODUCT DECIDES IT, NOT THE NARRATIVE.
//
// The offering locked with the reviewing lawyer gives the case-law and opposition reading to the Full
// country search alone, over exactly one country, where it is automatic. Multi-country focus deliberately
// has no case-law component. `job.caseLaw` is refused at the door and `policy.caseLaw` is set from the
// product spec, so the REQUESTED path was already confined correctly — and the one-territory rule is
// enforced at that door.
//
// The detector was not. It fires mid-run, after admission, on a run already scoped to however many
// territories it was sold, and it passes no door: a Multi-country focus search over seven territories ran
// a case-law pass and wrote 10 KB of findings. That is a component of a product the client did not order,
// unbilled, with no scope guard — and the run's own scenario assertion passed, because it reads the
// recorded-and-ignored `caseLaw` flag rather than the artifacts.
//
// So the detector still DETECTS and no longer EXECUTES. The judgment is worth keeping — a run noticing
// that its read turns on an opposition is a real observation — and it is recorded as machine-written run
// data (the product, the trigger word, the territories) in `_driver/` only. It is the natural seed of a
// "a case-law question exists in territory X — a Full country search would examine it" recommendation,
// and NO report or email sentence for it exists here: no wording enters a deliverable that the owner has
// not agreed.
export const CASE_LAW_PRODUCT = "full-country-search";   // @internal

/**
 * Does the case-law grounding stage run? PRODUCT-GATED, requested-or-detected within it.
 *
 * `run` is true only on the one product that carries the reading. `detected` stays truthful whatever the
 * product is, because the observation is recorded rather than discarded, and `declined` names the state
 * the round could not previously see: the run's reading called for case law and the product does not
 * carry it.
 *
 * A run whose policy cannot be read at all is NOT eligible, and says so with `product: null`. Declining
 * is the safe direction — the alternative is starting an unbounded pass on a product nobody established
 * — and it is recorded rather than silent, which is what stops it being an absence read as a decision.
 *
 * PURE; never throws.
 */
export function decideCaseLaw({ job, narrative, policy } = {}) {   // @internal
  const requested = job?.caseLaw === true || policy?.caseLaw === true;
  const m = CASE_LAW_TRIGGERS.exec(String(narrative ?? ""));
  const detected = Boolean(m);
  // `product` and `level` are one value under two keys — search-policy.mjs writes both, and archived runs
  // carry `level`. Read both so a resumed pre-rename run is not silently ineligible.
  const product = String(policy?.product ?? policy?.level ?? "").trim() || null;
  const eligible = product === CASE_LAW_PRODUCT;
  const called = requested || detected;
  return {
    run: called && eligible,
    requested, detected, eligible, product,
    trigger: m ? m[0].toLowerCase() : null,
    // The observation this build exists to preserve: the reading called for case law, and the product
    // this run was sold does not carry it.
    declined: called && !eligible,
  };
}

// ── WS-B: the run's frozen profile + the sidecar spine ──────────────────────────────────────────────
// Resolve the customer profile ONCE and freeze it into _driver/profile.json (temp+rename, BEFORE any
// validated stage). Resume / --experiment load FROM the sidecar — a profiles/ edit between
// run and resume must never change a live run's floor or platform grid mid-flight; validators read
// the same file (verify.mjs readRunProfile), which also makes concurrent runs' floors physically
// isolated (the WS-C boundary). write=false (reconstructCtx) reads without minting a sidecar into an
// existing run dir.
// The exact subset of the resolved profile frozen into the run sidecar (_driver/profile.json). Exported so
// the freeze contract is unit-testable (the bug this guards: a per-customer field configured in a profile
// but DROPPED here is silently never applied — the stages read the frozen copy, not the raw profile).
export function freezeProfile(p, project = null) {   // @internal
  const frozen = {
    profileKey: p.key,
    name: p.name,
    industry: p.industry ?? "",
    platforms: p.platforms,
    minCellsPerVariant: derivedFloor(p),
    batchSize: derivedBatchSize(p),
    defaultClasses: p.defaultClasses ?? [],
    defaultJurisdictions: p.defaultJurisdictions ?? [],
    selfExclusionOwners: p.selfExclusionOwners ?? [],
    // WS-B delivery overlay + F8 appetite — frozen into the sidecar so publish/render/email select the
    // customer's variant from the same immutable source the rest of the run reads (resume-safe).
    delivery: p.delivery ?? NEUTRAL_DELIVERY,
    riskAppetite: p.riskAppetite ?? "",
    // Phase 1: per-customer context pack (background facts) — frozen like riskAppetite so a pack edited
    // between run and resume can never change a live run mid-flight. Fed to delivery curation as CONTEXT
    // (emphasis only, D1); absent ⇒ "" ⇒ falsy-omitted in the stage message (byte-identical to no pack).
    contextPack: p.contextPack ?? "",
    // — THE DEMO MARKING IS FROZEN, and until now it was not.
    //
    // This function is an allow-list, and `demoData` was not on it. So the frozen sidecar NEVER carried
    // the flag, `resolveDemoData`'s sidecar branch was DEAD on every run, and the demonstration banner
    // hung entirely on the roster re-read — whose catch answers `false` when the roster cannot be read.
    // A republish, an archive re-render, a renamed profile or a missing env therefore renders a DEMO
    // REPORT AS REAL: invented mark, real register basis, published URL, no disclaimer.
    //
    // THE FAILURE DIRECTION WAS REASONED WRONG WHEN THE RESOLVER WAS WRITTEN, and I wrote it. Its header
    // argues that unreadable evidence yielding `false` is safe because "a marking is never invented for a
    // report nobody proved is a demo". For a marking that says THIS IS FICTION, not-marking is the unsafe
    // direction — it is the exact defect 2122 was raised on. Freezing the flag is what makes the safe
    // reading available at all: the sidecar is written once, from the roster, while it IS readable.
    //
    // `=== true` and nothing looser, matching demoRunShape and buildJob: a truthy string must not be able
    // to declare a real client matter fiction. Absent stays absent — this cannot MARK a run the roster
    // never called a demo, only preserve one it did.
    demoData: p.demoData === true,
    // BUGFIX 2026-06-19: per-customer reasoning-skill SELECTION must be frozen too. It was missing here, so
    // frameworkFor()/workedExamplesFor() (stages.mjs) read the frozen ctx.profile, found no path, and silently
    // fell back to the firm-neutral DEFAULT for EVERY run — the profiles' configured frameworks
    // were never applied. RAW value (NOT `?? ""`): absent ⇒ undefined ⇒ JSON drops it ⇒ frameworkFor falls back
    // to DEFAULT; an empty string would NOT trigger the `?? DEFAULT` and would break the read.
    frameworkPath: p.frameworkPath,
    workedExamplesPath: p.workedExamplesPath,
    // Search spine: the account's DEFAULT PRODUCT, the entitlement menu and the jx deepening POSTURE
    // freeze with the profile so a resume can never re-decide them from an edited profiles/ state.
    // CONDITIONAL SPREAD, not a raw assignment (review 2026-07-17): `key: undefined` creates an OWN
    // property that Object.keys/profileShaOf still see (canonicalJson renders it "null"), which would
    // silently change EVERY pre-spine profile's sha — the spread keeps absent keys truly absent, so
    // profiles without them freeze byte- AND sha-identically to a pre-spine sidecar.
    //
    // `defaultProduct` REPLACES `defaultSearchLevel` HERE, and the omission was load-bearing:
    // deleted defaultSearchLevel from KNOWN_PROFILE_KEYS but this line was never repointed, so the
    // frozen profile carried the account's default product NOWHERE — and attachSearchPolicy, which
    // resolves off this frozen sidecar and nothing else, could never see it. An account whose profile
    // says "every search here is a Knockout search" froze a clearance derived from its territories
    // instead. No profile can still carry `defaultSearchLevel` (profiles.mjs refuses it as an unknown
    // key), so under the conditional spread no existing sidecar's bytes or sha change.
    ...(p.defaultProduct !== undefined ? { defaultProduct: p.defaultProduct } : {}),
    ...(p.allowedRecipes !== undefined ? { allowedRecipes: p.allowedRecipes } : {}),
    ...(p.jxPolicy !== undefined ? { jxPolicy: p.jxPolicy } : {}),
  };
  // spec 62 — when the run is under a PROJECT, record which project rated it and the per-field origin map,
  // added AFTER the 14-field base so a NO-PROJECT freeze stays byte-identical to a pre-62 sidecar (the
  // regression anchor and every existing run's profileSha are preserved; profileShaOf sorts keys,
  // so these hash in only when present, making "which project rated this run" verifiable, never asserted).
  if (project?.projectKey) {
    frozen.projectKey = project.projectKey;
    frozen.projectName = project.projectName ?? project.projectKey;
    frozen.origins = project.origins ?? {};
  }
  return frozen;
}
// T9 (K3) — sha over the canonical (key-sorted) JSON of the frozen subset, so "which
// framework/profile rated this run" is VERIFIABLE (recompute from profiles/<key>.json through
// freezeProfile and compare), never merely asserted. Pre-49 sidecars simply lack the field.
function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export function profileShaOf(frozen) {   // @internal
  const { profileSha: _omit, ...rest } = frozen ?? {};
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

function attachProfile(ctx, job, { write = true } = {}) {
  const sidecarPath = paths(ctx.paths.runDir).profile;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT — genuinely absent */ }
  if (raw != null) {
    let sidecar;
    try { sidecar = JSON.parse(raw); }
    catch (e) {
      // PRESENT but unreadable: the sidecar is DRIVER-written (temp+rename) — a corrupt one is a
      // code/filesystem bug. Fail loudly; silently re-resolving from CURRENT profiles/ would be the
      // exact mid-run drift the freeze exists to forbid (and the validators fail-close on the same
      // file — both ends of the contract must agree).
      throw new Error(`_driver/profile.json is corrupt (${e.message}) — investigate; the frozen profile is never silently re-derived`);
    }
    ctx.profile = sidecar;
    // mismatch probe is telemetry-only and must never let a broken profiles/ state crash a resume
    // whose frozen sidecar needs nothing from it.
    try {
      const current = resolveProfile(job);
      if (current && current.key !== sidecar.profileKey)
        runLog(ctx.paths.runDir, { event: "profile-mismatch", sidecar: sidecar.profileKey, resolved: current.key });
      // THE MATCH IS RECORDED TOO, and that is the point rather than symmetry for its own sake.
      // `profile-mismatch` existed and its counterpart did not, so "the profile was right" was carried
      // by the ABSENCE of a row — and an absence cannot tell "it matched" from "the probe never ran"
      // (it throws below on a broken profiles/ state) or from "this run predates the probe". Three
      // different facts, one empty grep. The positive row says which.
      else if (current)
        runLog(ctx.paths.runDir, { event: "profile-resolved", sidecar: sidecar.profileKey, resolved: current.key });
    } catch (e) {
      runLog(ctx.paths.runDir, { event: "profile-mismatch-probe-failed", error: String(e.message).slice(0, 120) });
    }
    return;
  }
  if (!write) {
    // no sidecar + read-only (reconstructCtx, or a resume of a pre-WS-B run): stay LEGACY end to
    // end — a fresh resolve here would make the messages dictate what the validators (which read
    // only the sidecar) won't enforce.
    ctx.profile = null;
    return;
  }
  // spec 62 — resolve the EFFECTIVE profile (customer + optional project overlay merged per-field). No project ⇒
  // { projectKey: null, origins: null } and the freeze is byte-identical to pre-62. derivedFloor/derivedBatchSize
  // follow the RESOLVED platforms automatically (a project's wider marketplace list ⇒ its own smaller batch).
  const { profile: p0, projectKey, projectName, origins } = resolveEffectiveProfile(job);
  // Per-run platforms are ADDITIVE, and are folded in BEFORE the freeze so derivedFloor/derivedBatchSize
  // re-derive from the surface actually swept. Sweeping an extra marketplace without raising the floor
  // would leave the coverage ledger describing a grid the run never had.
  const { profile: p, added: addedPlatforms } = withRunPlatforms(p0, job.platforms);
  ctx.profile = freezeProfile(p, projectKey ? { projectKey, projectName, origins } : null);
  // Provenance ("why did this run sweep gnc.com?") is deliberately NOT stamped onto the frozen profile:
  // profileSha exists so "which profile rated this run" can be RECOMPUTED from profiles/<key>.json, and a
  // job-derived field in that subset would make it unrecomputable. The swept set is visible in the frozen
  // platforms; where the extras came from is run telemetry, logged below.
  ctx.profile.profileSha = profileShaOf(ctx.profile);   // T9 (K3)
  // WHICH ORGANISATION'S GENERIC this run is filed under — the door stamps it on a Generic job, from the
  // verified principal. Set AFTER the hash for the reason the provenance note above gives: it is job-
  // derived, and `profileSha` must stay recomputable from profiles/<key>.json. Absent on a company's run.
  if (typeof job?.tenant === "string" && job.tenant && ctx.profile.profileKey === "generic") ctx.profile.organisation = job.tenant;
  const tmp = `${sidecarPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(ctx.profile, null, 2) + "\n");
  renameSync(tmp, sidecarPath);
  runLog(ctx.paths.runDir, { event: "profile", key: p.key, project: projectKey ?? null, platforms: p.platforms.length,
    ...(addedPlatforms.length ? { runPlatforms: addedPlatforms } : {}),
    floor: ctx.profile.minCellsPerVariant, batch: ctx.profile.batchSize });
}

// ── doc 50 — freeze the FRAMEWORK MANIFEST beside the profile sidecar ────────────────────────────────
// _driver/framework.json is the frozen band vocabulary of the framework in force (the customer's own via
// the frozen frameworkPath, else the Generic default) — the single source every v4 consumer reads (the
// synthesis dictation, verify's band gates, the lint auto-correct, render/index/email/xlsx). Frozen so a
// framework edit between run and resume can never change a live run's vocabulary. RESUME BACKFILL: a run
// frozen before doc 50 has a profile sidecar but no framework sidecar — mint it here from the frozen
// frameworkPath (the parked-run deploy-boundary case); its findings.json stays whatever version it
// declares, judged by that version's gates. Corrupt ⇒ fail loud (driver-written, same as profile.json).
const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
function attachFramework(ctx, { write = true } = {}) {
  const sidecarPath = paths(ctx.paths.runDir).framework;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT — genuinely absent */ }
  const methodPath = driverDir(ctx.paths.runDir, FROZEN_METHOD_FILE);
  if (raw != null) {
    try { ctx.framework = parseFrameworkManifest(raw); }
    catch (e) { throw new Error(`_driver/framework.json is corrupt (${e.message}) — investigate; the frozen framework is never silently re-derived`); }
    // The method the run froze, or none: a run frozen without one is never given one on resume.
    ctx.frameworkMethod = attachFrameworkMethod({ frozenPath: methodPath, manifest: ctx.framework, minted: false });
    return;
  }
  // NO FROZEN FRAMEWORK. It is frozen before the first stage, so a run without one ran no stage, and a
  // read-only caller has nothing to rebuild. (A run from before the framework freeze was given one here,
  // resolved in memory; a run from an earlier build is no longer resumed.)
  if (!write) throw new Error("_driver/framework.json is absent — the run stopped before its framework was frozen, so it ran no stage and there is nothing to rebuild");
  // A cold start, or a resume of a first pass that stopped before this freeze: the framework in force is
  // resolved from the frozen profile and minted now, as the cold path does. With no profile it is the
  // GENERIC DEFAULT — doc 50 has no framework-less runs, and frameworkFor(null) resolves it.
  const fwPath = frameworkFor(ctx.profile);
  // config.skillsRoot, NOT DRIVER_DIR: the profile's framework may live in the deployment's config
  // store (CLEAROTRON_INSTRUCTIONS_DIR), which is also the root the AGENT resolves the same path against.
  const manifest = loadFrameworkManifest((rel) => config.resolveSkillPath(rel), fwPath);   // throws framework_manifest_missing — a deploy defect, loud
  ctx.framework = manifest;
  // The method is frozen BEFORE the manifest: a run interrupted between the two writes has no manifest,
  // so its resume mints both again. The other order would leave a manifest with no method beside it,
  // which the resume branch above reads as a framework that states none.
  ctx.frameworkMethod = attachFrameworkMethod({ frozenPath: methodPath, resolve: (rel) => config.resolveSkillPath(rel), fwPath, manifest, minted: true });
  const tmp = `${sidecarPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  renameSync(tmp, sidecarPath);
  runLog(ctx.paths.runDir, { event: "framework", key: manifest.framework_key,
    custom: fwPath !== DEFAULT_FRAMEWORK, bands: manifest.bands.map((b) => b.label).join("/"), file: manifestPathFor(fwPath),
    method: ctx.frameworkMethod ? methodPathFor(fwPath) : null });
}

// ── Search-depth spine — freeze the resolved SEARCH POLICY beside the profile ────────────────────────
// _driver/search-policy.json records WHICH product shape this run is (level / pipeline / components /
// recipe content-sha / where the selection came from) — frozen once at cold start so a profile-default or
// recipe edit between run and resume can never reshape a live run (the freezeProfile doctrine), and so
// publish/meta can stamp the run's product identity without re-deriving it. Exported for unit tests.
// Resolution inputs: the FROZEN ctx.profile (carries defaultProduct + allowedRecipes — the resume-safe
// source; the runner's admission gate already enforced allowedRecipes on the raw profile at claim) and
// the SHARED TERRITORY LADDER, because a request that names no product is named by its own scope.
// A resolution that lands on a pipeline this build cannot execute FAILS LOUD — a CLI-invoked job must
// never silently run a knockout selection as a full-priced clearance (the admission gate's discipline,
// held at the second door too).
/** The preview's promise, kept at the run's own door: a saved search's scope BINDS the run.
 *
 *  resolveEffectiveScope (the plan/review preview) ladders request > saved search > account, but
 *  until now its recipeScope input had no run-side consumer — the run resolved scope from job
 *  fields + profile defaults only, so a requester could approve the saved scope and get a
 *  different search (audit N3, 2026-07-27). The fold writes the SAME ladder into the job itself:
 *  jurisdictions/classes fill only when the requester left them unset (request wins), platforms
 *  union additively (a mandate is never removable, mirroring withRunPlatforms — the account's own
 *  list still unions in later at the gather door). Idempotent by construction, so the resume
 *  re-fold from the frozen sidecar changes nothing; sidecars frozen before recipeScope existed
 *  carry null and no-op. */
export function foldRecipeScope(job, searchPolicy) {   // @internal
  const s = searchPolicy?.recipeScope;
  if (!s || typeof s !== "object") return job;
  const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
  // WORLDWIDE IS NOT A GAP THE SAVED SEARCH MAY FILL. A worldwide-stamped request has no
  // `job.jurisdictions` — that is what worldwide LOOKS like on the wire — so the emptiness test alone
  // read it as "the requester named none" and wrote the saved search's territories in. The run then
  // carried a stamp saying everywhere and a list saying seven countries, and every consumer downstream
  // of this fold reads the list. resolveEffectiveScope already puts worldwide above the saved-search
  // rung; this is the same rule at the one place that WRITES.
  const worldwide = job.geography?.mode === "worldwide";
  if (!worldwide && !nonEmpty(job.jurisdictions) && nonEmpty(s.jurisdictions)) {
    job.jurisdictions = [...s.jurisdictions];
    // AND THE STAMP MOVES WITH THEM. `job.geography` was written at the door to say the requester named
    // no territories; after this fold the job names some, and leaving the old stamp behind makes every
    // later reader attribute a saved search's scope to a request that never mentioned geography.
    // GEOGRAPHY_ORIGINS has carried "saved-search" since the stamp was minted, for "a writer that
    // freezes a resolved layer into the job, which nothing does yet". This is that writer.
    job.geography = { mode: "named", origin: "saved-search" };
  }
  if (!nonEmpty(job.classes) && nonEmpty(s.classes)) job.classes = [...s.classes];
  if (nonEmpty(s.platforms)) {
    const have = new Set((job.platforms ?? []).map((p) => String(p).trim().toLowerCase()));
    const add = s.platforms.filter((p) => !have.has(String(p).trim().toLowerCase()));
    if (add.length) job.platforms = [...(job.platforms ?? []), ...add];
  }
  return job;
}

export function attachSearchPolicy(ctx, job, { write = true } = {}) {   // @internal
  const sidecarPath = paths(ctx.paths.runDir).searchPolicy;
  let raw = null;
  try { raw = readFileSync(sidecarPath, "utf8"); } catch { /* ENOENT — genuinely absent */ }
  if (raw != null) {
    try { ctx.searchPolicy = JSON.parse(raw); }
    catch (e) { throw new Error(`_driver/search-policy.json is corrupt (${e.message}) — investigate; the frozen policy is never silently re-derived`); }
  } else if (!write) {
    // NO FROZEN PRODUCT, AND THIS CALLER MAY NOT FREEZE ONE. A run froze its product before its first stage, so it has
    // none to read. A resume finishes the opening first (steps/open-run.mjs finishTheOpening), so a reader here never
    // assumes one: this used to read the absence as a run from before the freeze and name a retired clearance.
    throw new Error("_driver/search-policy.json is absent — the run stopped before its product was frozen, and this reader does not settle one");
  } else {
    let resolved;
    // force:true — the recipe store is written by a LIVE service; a long-lived driver process must see a
    // just-saved recipe (save→trigger), and the read only happens when the job names one (rare, cheap).
    //
    // ── RESOLVED AGAINST THE TERRITORIES, WHICH IS WHAT THE WALL RESOLVED AGAINST ──────────────────────
    //
    // This call omitted `territories` and therefore minted the product from an EMPTY scope. Under the
    // offering's last rung an empty scope IS worldwide, so a one-country clearance — admitted by the
    // wall as a Full country search, quoted with case law and the native-language lane, 2.5h — froze
    // here as a Global preliminary search with caseLaw:false and jxLanes:false. The case-law stage never
    // ran and the delivered document printed a product the client did not buy. The two resolutions are
    // independent by construction (the runner does not hand its policy down), so the only fix is that
    // both read the same ladder: resolveTerritories, off the FROZEN profile, exactly as the wall's own
    // first pass reads it off the effective one. The saved-search rung is not needed here and cannot be
    // — foldRecipeScope runs immediately below and writes it into the job — which is why this is the
    // ladder rather than the full resolver.
    try {
      resolved = resolveSearchPolicy(job, {
        profile: ctx.profile,
        recipes: job.recipeKey ? loadRecipes({ force: true, proseGuard: recipeProseGuard }) : null,
        territories: resolveTerritories(job, ctx.profile).jurisdictions,
      });
    } catch (e) { resolved = { clarify: `search-policy resolution errored: ${String(e?.message ?? e).slice(0, 160)}` }; }
    // A CLARIFY THROWS. THERE IS NO FAIL-OPEN LEFT, and its deletion is the point.
    //
    // It used to fall open to the literal level `clearotron` — stageLabel "Depth 4" — whenever the job named
    // no selector and the profile carried no default. Both halves of that condition had rotted: the
    // selector test read the deleted `searchLevel` (so it was true for every job) and the profile test
    // read the deleted `defaultSearchLevel` (so it was undefined for every profile). The branch was
    // therefore UNCONDITIONAL: any resolution that clarified — a product the account's allowedRecipes
    // refuses, a staff-set default that is a typo, an unreadable recipe store — silently minted a
    // RETIRED product into the frozen sidecar, and reportIdentityFor resolved it back through
    // RETIRED_POLICIES so the delivered report was bannered "Depth 4 — Preliminary clearance".
    //
    // A guess wearing a level key is what the offering replaced. A resolution nobody can make names no
    // product, and this door refuses rather than choosing one (the admission gate's discipline, held at
    // the second door too — CLI/direct dispatch never passes the first).
    if (resolved.clarify) throw new Error(`search-policy: ${resolved.clarify}`);
    // The availability gate holds at THIS door too (CLI/direct dispatch bypasses the runner's admission
    // gate): a selection this build/deployment cannot execute refuses on MINT — never a silent downgrade
    // to a plain clearance. Resume-reads are exempt: a mid-flight run keeps its frozen shape even if a
    // kill switch flipped after it started.
    const gateMsg = gateResolvedPolicy(resolved);
    if (gateMsg) throw new Error(`search-policy: ${gateMsg}`);
    // deliveryRoute "portal" has no consumer yet — refuse like an unbuilt level (a silent email-anyway
    // would be a delivery-contract lie); "email"/absent is today's behavior.
    const route = String(job.deliveryRoute ?? "").trim().toLowerCase() || null;
    if (route && route !== "email")
      throw new Error(`search-policy: deliveryRoute ${JSON.stringify(job.deliveryRoute)} is not available in this build yet — omit it to deliver by email`);
    // Attribution rides the sidecar SANITIZED (review 2026-07-17): the validator only WARNS on a malformed
    // parentRunId ("treated as unset") — honor that promise at the freeze so a raw queue file can never
    // persist an arbitrary string into meta.json; enqueuedVia is clamped to a bounded token for the same
    // reason. `sub` (the verified ops-token principal) joins these once the grants slice lands (Phase 3b).
    const pidRaw = String(job.parentRunId ?? "").trim().toLowerCase();
    const viaRaw = String(job.enqueuedVia ?? "").trim();
    ctx.searchPolicy = { schema: 1, level: resolved.level, pipeline: resolved.pipeline, stageLabel: resolved.stageLabel,
      components: resolved.components, recipe: resolved.recipe ?? null, extras: resolved.extras ?? null,
      origins: resolved.origins,
      // WHOEVER asked for the case-law pass — this job's own lever, or the saved search named instead of
      // a level — frozen with the rest of the selection. A run that resumes days later grounds case law
      // because the run was SOLD it, not because a recipe still says so. (resolveSearchPolicy ORs the two
      // requesters; until 2026-08-01 it returned the recipe's side alone, so a level-selected job froze
      // `false` while the quote had already priced the premium and the stage had already run.)
      caseLaw: resolved.caseLaw === true,
      // The saved search's SCOPE, frozen verbatim for the same reason: foldRecipeScope derives the
      // run's own jurisdictions/classes/platforms from THIS copy on every pass (fresh and resume),
      // so a recipe edited mid-park cannot retarget a run the requester already approved.
      recipeScope: resolved.recipeScope ?? null,
      // THE WEB SETTINGS this run is held to (search-policy.mjs PRODUCT_POLICIES): the tier its questions go
      // out on and the results each grid cell keeps. Frozen, so a resume runs on what the run started on.
      web: resolved.web ?? null,
      deliveryRoute: route,
      enqueuedVia: /^[a-z0-9][a-z0-9/_.-]{0,63}$/i.test(viaRaw) ? viaRaw : null,
      // WHO triggered (Phase 3b attribution): the verified token sub start_run stamped — frozen here so
      // it survives into meta.json (the ledger alone was unanswerable from list_runs; review 2026-07-18).
      // Same bounded-token clamp as enqueuedVia (this string reaches meta/log surfaces).
      enqueuedBy: /^[a-z0-9][a-z0-9@/_.:-]{0,119}$/i.test(String(job.enqueuedBy ?? "").trim()) ? String(job.enqueuedBy).trim() : null,
      parentRunId: /^[a-z0-9][a-z0-9-]{1,80}$/.test(pidRaw) ? pidRaw : null,
      frozenAt: new Date().toISOString() };
    const tmp = `${sidecarPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(ctx.searchPolicy, null, 2) + "\n");
    renameSync(tmp, sidecarPath);
    runLog(ctx.paths.runDir, { event: "search-policy", level: ctx.searchPolicy.level, origin: ctx.searchPolicy.origins?.level ?? null,
      recipe: ctx.searchPolicy.recipe?.key ?? null });
    // qw/cn-scope-honesty (b) — the resolution-time twin of the delivery-time honesty row: a run whose
    // requested scope names a zh-lane jurisdiction but whose machinery does not carry the lane gets a
    // RECORDED recommendation naming where the native-language investigation can be bought. A note only
    // — it never clarifies, parks, or substitutes the product (this door direct-dispatches too, so the
    // note lands in the run log; the runner emits its own copy at the intake door, the
    // checkMarkBudget-warnings posture).
    for (const n of zhScopeDepthNotes(job, ctx.searchPolicy, ctx.profile))
      runLog(ctx.paths.runDir, { event: "level-scope-note", note: n });
  }
  // The fold runs on EVERY path through this door — fresh mint, frozen-sidecar resume, legacy
  // implicit clearotron (recipeScope null there = no-op) — so every downstream consumer of
  // job.jurisdictions/classes/platforms sees the scope the preview promised.
  foldRecipeScope(job, ctx.searchPolicy);
  // Phase 2a: "knockout" is now a dispatchable pipeline — the refusal covers only shapes THIS build
  // cannot execute (e.g. a sidecar frozen by a future build, resumed here).
  if (!["clearance", "knockout"].includes(ctx.searchPolicy.pipeline))
    throw new Error(`run is frozen to search level "${ctx.searchPolicy.level}" (pipeline "${ctx.searchPolicy.pipeline}") — this build has no such pipeline; refusing to run it as a clearance (never a silent product substitution)`);
  // Derived HERE, off the frozen policy, and not at the gather fan-out where it is first used: every
  // stage message() reads ctx.registerOnly, and a run RESUMED past gather never re-enters that block —
  // so deriving it there would leave the late judgment stages (synthesis, refutation, report-overview)
  // reading undefined on exactly the resumes where the prompt matters most, telling them to read a
  // common-law findings file that was never written.
  ctx.registerOnly = isRegisterOnly(ctx.searchPolicy);
  // — the depth row, resolved HERE for the same reason registerOnly is: the late judgment stages
  // are exactly the ones that read it, and a resume that derived it later would have them grading
  // against `undefined` on the runs where it matters most. Fails toward depth when the product is
  // unknown, and carries `source` so a silent fallback is visible in the run record rather than
  // looking like a ladder that did nothing.
  ctx.depth = depthFor(ctx.searchPolicy);
}

// Map #3 — the coverage-ledger JSON is now CODE-DERIVED from the validated prose (deriveCoverageLedgerJson
// below, called in runDigest after every digest pass), never authored by the model. The old save-MANDATE
// instruction (re-save your JSON mirror) is retired: there is nothing for the worker to save, and the JSON
// is consistent with the prose BY CONSTRUCTION, which kills the mirror-desync class the cross-check existed
// to catch.

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

// ── — THE COVERAGE LEDGER IS PUBLISHED FROM THE FORM, IN BOTH SHAPES ───────────────────────────
//
// Map #3 code-derived register-coverage-ledger.json FROM the model's prose `## Coverage ledger` table,
// which made a model-authored document the source of truth for every coverage gate downstream. The
// direction is INVERTED here: the driver-written form is the source, and BOTH the prose table and the
// JSON are renders of it. They agree by construction and neither can be the thing that drifts, which is
// the same argument Map #3 made one level down — applied to the artifact that was still authored.
//
// Called after every digest pass that ended ok, on the same seam deriveCoverageLedgerJson always ran.
// NEVER-KILL: any defect logs a note, drops a stale JSON and leaves the run to deliver on whatever the
// findings carry. The table is the rendered surface; the JSON is the gates' optimization.
function renderCoverageLedgerFromForm(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerFindings)) return;
  const stamp = coverageFormStamp(P.runDir);
  if (!stamp.required) return;
  const cf = readCoverageForm(P.runDir, stamp.formName);
  // M6 — A DECLARED ABSENCE IS RENDERED, NOT SKIPPED. Returning early here on a zero-row form would
  // leave the report with no `## Coverage ledger` section at all, and a reader cannot tell a missing
  // section from a run that swept everything and had nothing to say. The declaration names the cause and
  // states, in the lawyer's own section, that no coverage claim is made anywhere in the report.
  const absence = cf.rows && !cf.rows.length ? coverageFormAbsence(cf.parsed) : null;
  if (!absence && !cf.rows?.length) return;
  try {
    const section = absence ? renderCoverageAbsenceSection(absence) : renderCoverageLedgerSection(cf.rows);
    if (!section) return;
    // Idempotent: spliceCoverageLedger REPLACES a section already there, so re-rendering on a later pass
    // updates the table rather than appending a second one.
    atomicWrite(P.registerFindings, spliceCoverageLedger(readFileSync(P.registerFindings, "utf8"), section));
    runLog(P.runDir, { event: absence ? "coverage-absence-rendered" : "coverage-ledger-rendered", trigger, rows: cf.rows.length, ...(absence ? { cause: absence.cause } : {}) });
  } catch (e) {
    note(`runDigest: coverage-ledger render failed (${String(e.message).slice(0, 100)}) — the findings ship without the driver-rendered table`);
    runLog(P.runDir, { event: "coverage-ledger-render-failed", trigger, reason: String(e.message).slice(0, 120) });
  }
}

// ── — THE DOCUMENT-COVERAGE SENTENCE, RENDERED FROM THE RUN'S OWN RECORDS ─────────────────────
//
// The narrative seat is now told to say nothing about whether registry documents were obtained (see the
// block in stages.mjs). That prohibition alone would leave a run that genuinely fetched nothing with
// a report silent on the point, which reads as one where the wording WAS read — so the sentence has to be
// written, measured, by the only thing that can see the lane.
//
// Beside the coverage ledger and in the same document, because it is the same kind of statement: what this
// run's search actually rests on. Idempotent (spliceDocumentCoverage REPLACES), best-effort, and it never
// renders an empty section — a heading with nothing under it asserts an absence it cannot explain.
function renderDocumentCoverageFromRecords(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerFindings)) return;
  try {
    // The set the GATES consume, not `_records/` alone: a run whose bodies live only in the ledger would
    // otherwise be described as one that fetched nothing — the defect this renders against, re-created by
    // reading a narrower artifact than the one that holds the answer.
    const { records } = assembleRunRecords(P.runDir, `clearance-${ctx.run.slug}-${ctx.run.codename}-`);
    const summary = documentCoverage({ records, findings: safeReadJson(P.findings) });
    const section = renderDocumentCoverageSection(summary);
    if (!section) return;
    atomicWrite(P.registerFindings, spliceDocumentCoverage(readFileSync(P.registerFindings, "utf8"), section));
    runLog(P.runDir, { event: "document-coverage-rendered", trigger, ...summary });
  } catch (e) {
    note(`runDigest: document-coverage render failed (${String(e.message).slice(0, 100)}) — the findings ship without the driver-rendered section`);
    runLog(P.runDir, { event: "document-coverage-render-failed", trigger, reason: String(e.message).slice(0, 120) });
  }
}

// ── CONVERSION 11 — THE FACTS THE DIGEST'S RENDER IS COMPOSED FROM ────────────────────────────────
//
// Written before the digest dispatches, beside the coverage form and inside the same `willRun` gate, so
// the two artifacts the stage now depends on are armed by ONE condition and cannot disagree about which
// era the run is in.
//
// IT IS THE DRIVER'S, AND THAT IS THE POINT. `record_register_digest` takes no record field — no Mark,
// no Owner, no Classes, no count — and this sidecar is why it does not have to: everything the render
// needs is here, keyed by the uri the seat cites. The report-overview precedent, for the reason its own
// comment gives: facts that arrive as an option the driver writes cannot come back in as parameters the
// seat sets, which is what stops thirteen mechanical elements returning through the tool.
//
// NON-FATAL, and the failure direction is deliberate. A miss leaves no sidecar; `readDigestFacts`
// returns empty facts; every seat-sent uri then refuses by name (`registerdigest_uri_unknown`) on the
// first call. So a driver fault surfaces as a loud refusal on call 1 rather than as a document of blank
// identifier cells — the same fail-closed direction the coverage form's write order takes.
export function writeRegisterDigestFacts(ctx, trigger) {   // @internal
  const P = ctx.paths;
  try {
    const records = existsSync(P.registerNamedBand)
      ? bandRecords(JSON.parse(readFileSync(P.registerNamedBand, "utf8"))) : [];
    // The SLIM index — the ten fields the render reads, never the whole record. A band is measured in
    // megabytes and this file is read on every call.
    const slim = [];
    for (const r of records) {
      const uri = r?.record_id ?? r?.uri ?? r?.screen?.uri;
      if (!uri) continue;
      slim.push({
        record_id: uri, mark_text: r.mark_text ?? null, owner_name: r.owner_name ?? null,
        owner_country: r.owner_country ?? r?.screen?.owner_country ?? null,
        classes: r.classes ?? null, status: r.status ?? r?.screen?.status ?? null,
        application_date: r.application_date ?? r?.screen?.application_date ?? null,
        registration_date: r.registration_date ?? null, expiry_date: r.expiry_date ?? null,
        jurisdictions: r.jurisdictions ?? null,
        screen: { screen_verdict: r?.screen?.screen_verdict ?? r?.screen_verdict ?? null },
      });
    }
    let readIds = [];
    try { readIds = [...readOkRecordUris(readFileSync(P.readingLog, "utf8"))]; } catch { readIds = []; }

    // THE OWED SET: the records of the entries placement carried into this stage that the write-up must end, the
    // population the refusal judges. `record-carry.mjs` judges the seam against every placed record, and an adopted
    // entry is carried by its row.
    // ── AN ABSENT FILE IS THE ONLY BENIGN WAY TO HAVE NO OWED SET ────────────────────────────────
    //
    // This was one bare `catch {}` around the whole block, and it hid a `ReferenceError`: `entryUris`
    // was called here and imported nowhere, so the loop threw on EVERY run, `owed` stayed empty, the
    // stamp was never written and the accounting rule never armed anywhere — the precise fail-open this
    // transport's header defends against, arriving through a swallowed crash instead of through the
    // write order. Green everywhere, because nothing drove this writer. Found on a replay rig, not by a
    // test, 2026-08-27.
    //
    // So the two states are now separated. NO FILE is a real answer: this run has no structured
    // placements, there is no population to hold the seat to, and not arming is correct. A file that IS
    // present and cannot be turned into an owed set is a DRIVER DEFECT, and it arms with `owed: null` —
    // which the transport already refuses by name as a driver fault rather than a model one. Never
    // silently empty: "the driver told me none" and "the driver could not tell me" are different facts
    // and only the first may be checked against.
    //
    // WHAT THE WRITE-UP OWES IS PLACEMENT'S HEADLINE ENTRIES, judged per entry: a row naming any record of an entry ends
    // the whole entry. A sheet-2 entry is adopted as placed (`adopt`): the render writes its row on the entry's first
    // live record, else its first, with placement's reason, unless the write-up overrides it with any row naming any of
    // its records. A watchlist-annex entry is adopted the same way (`watch`), into the watchlist annex: the write-up's
    // render has no other table for it, so without that row it reached no surface and its ending was nobody's. Out-of-scope
    // entries owe nothing. An entry with no records owes nothing and gets no row.
    const owed = [];
    const owedEntries = [];
    const adopt = [];
    const watch = [];
    let owedFailed = null;
    if (existsSync(P.placementModel)) {
      try {
        const placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
        const live = new Map(records.map((r) => [bandRecordUri(r).toLowerCase(), isLiveRecord(r)]));
        for (const e of Array.isArray(placements) ? placements : []) {
          const uris = entryUris(e);
          if (!uris.length) continue;
          if (e?.tier === "headline-candidate") { owedEntries.push({ uris }); owed.push(...uris); }
          else if (e?.tier === "sheet-2" || e?.tier === "watchlist-annex")
            (e.tier === "sheet-2" ? adopt : watch).push({ uri: uris.find((u) => live.get(u) === true) ?? uris[0], uris, reason: String(e?.reason ?? "") });
        }
      } catch (e) { owedFailed = String(e?.message ?? e).slice(0, 160); }
    }

    const facts = {
      schema_version: 1,
      owed: owedFailed ? null : [...new Set(owed)],
      ...(owedFailed ? {} : { owed_entries: owedEntries, adopt, watch }),
      identity: {
        mark: ctx.job?.markName ?? ctx.run?.slug ?? null,
        date: ctx.job?.filedDate ?? ctx.run?.startedAt?.slice?.(0, 10) ?? null,
        provider: (ctx.register ?? REGISTER_PROVIDER) ?? null,
      },
      recordHost: recordOriginsFor(ctx.register ?? REGISTER_PROVIDER)?.[0] ?? "",
      counts: digestSummaryCounts(ctx, slim.length),
      auditRows: digestAuditRows(ctx),
      readIds,
      records: slim,
    };
    ensureDriverDir(P.runDir);   // — one creator for `_driver/`, never a bare mkdir
    // ── THE STAMP LANDS BEFORE THE FACTS, AND THE ORDER IS THE FAIL-CLOSED LEG ────────────────────
    //
    // `armCoverageForm`'s rule, one artifact over: stamp first, artifact second. If the facts write
    // fails after the stamp lands, the seat reaches a run stamped for accounting with no owed list, and
    // the transport refuses that BY NAME as a driver fault. Stamp second would mean a failed facts write
    // silently disarms the rule — the fail-open the 1955 design named as the arm most likely to be got
    // wrong, and a rule that disarms itself on a disk error is worse than none because it reads as one.
    //
    // NOT STAMPED when the run has no structured placements: there is then no owed population to hold
    // the seat to, and arming over an empty list would refuse nothing while looking like a gate.
    // ARMED ON A FAILED OWED BUILD TOO. Not arming there would be the fail-open again by a shorter
    // route: the rule would switch itself off on exactly the runs whose owed set the driver got wrong.
    // Armed with `owed: null`, the transport refuses BY NAME as a driver fault on the first call.
    const armed = owed.length > 0 || owedFailed !== null;
    if (armed) atomicWrite(driverDir(P.runDir, DIGEST_ACCOUNTING_STAMP), JSON.stringify({ ts: new Date().toISOString(), owed: owedFailed ? null : owed.length, owed_failed: owedFailed }, null, 2) + "\n");
    atomicWrite(driverDir(P.runDir, DIGEST_FACTS_FILE), JSON.stringify(facts, null, 2) + "\n");
    if (owedFailed) note(`register-digest: placements.json is present and the owed set could not be built from it (${owedFailed}) — arming the accounting rule with no owed list, so the digest's first call refuses by name as a driver fault`);
    runLog(P.runDir, { event: "register-digest-facts-written", trigger, records: slim.length, readIds: readIds.length, owed: owedFailed ? null : owed.length, owed_failed: owedFailed, accounting_armed: armed });
  } catch (e) {
    note(`register-digest facts write failed (${String(e.message).slice(0, 100)}) — the digest's first call will refuse by name rather than render blank identifier cells`);
    runLog(P.runDir, { event: "register-digest-facts-failed", trigger, reason: String(e.message).slice(0, 120) });
  }
}

/** The `## Summary` counts, from the driver's own receipts. Every entry is [label, value]. */
function digestSummaryCounts(ctx, enumerated) {
  const P = ctx.paths;
  const out = [];
  const exec = safeReadJson(paths(P.runDir).planExecution);
  const entries = Array.isArray(exec?.skeleton) ? exec.skeleton : [];
  // ── NO TOOL NAME IS SPELLED HERE, AND THAT IS A CONSTRAINT RATHER THAN A STYLE CHOICE ────────────
  //
  // The first cut classified calls with `/fetch|record/i` vs `/search|enumerate|screen/i` to render a
  // "search + detail-fetch" split. Two source guards refused it, both correctly: `register-steering`
  // requires pipeline.mjs to reach the enumerate tool only through REGISTER_ENUMERATE_TOOL, and
  // `register-advertisement-vs-grant` reads a tool name in the driver's own text as the driver ORDERING
  // that tool — which made this file advertise `register_batch_screen` to a provider (signa) that does
  // not serve it. A hardcoded tool list here is a second register of tool names in the one file those
  // guards police.
  //
  // So the split goes and the honest counts stay. `tool-calls.jsonl` writes one line per call, which is
  // a total the driver can state without knowing what any of them was called; the records READ come from
  // the reading audit, which is already the driver's own list. That loses the search-vs-fetch breakdown,
  // and losing it is the right trade: the regex was guessing at a distinction the log does not record,
  // and a guessed number in a client-facing document is worse than a true one that says less.
  // ── NO LIVE COUNTER GOES IN THIS DOCUMENT, AND THE TOOL-CALL TOTAL WAS ONE ───────────────────────
  //
  // `tool calls recorded this run` was rendered here from `tool-calls.jsonl`'s line count, which GROWS
  // for as long as the run does. That put a moving number inside an artifact four other stages declare
  // as an input and hash for freshness — so every digest pass rendered a different document even when
  // the seat's values were byte-identical, every downstream stage went stale on it, and delivery
  // refused with "assembled from material that has since changed". Measured on the non-split closure
  // resume: two renders of the same findings, 28 calls and then 56, 108 bytes apart.
  //
  // THE RULE, since the next driver-derived fact will be tempting in the same way: a value rendered into
  // this document must be a fact about the FINDINGS, settled when they were. `enumerated records` is the
  // frozen band's size and `plan entries executed` counts the frozen plan's skeleton — both settle
  // before the digest runs and neither moves afterwards. A telemetry total is a fact about the RUN, it
  // belongs in the run log where it already is, and it means nothing to the lawyer reading this page.
  out.push(["enumerated records", enumerated]);
  out.push(["plan entries executed", entries.length]);
  return out;
}

/** The `### Audit trail` rows — per-unit search / detail-fetch counts with the driver's `_query` stamp. */
function digestAuditRows(ctx) {
  const P = ctx.paths;
  const exec = safeReadJson(paths(P.runDir).planExecution);
  const rows = [];
  for (const e of Array.isArray(exec?.skeleton) ? exec.skeleton : []) {
    rows.push({ unit: e?.axis ?? e?.qid ?? "—", searches: e?.searches ?? e?.pages ?? 0,
      detail_fetches: e?.detail_fetches ?? 0, query: e?.qid ?? "" });
  }
  return rows;
}

function deriveCoverageLedgerJson(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerFindings)) return;
  renderCoverageLedgerFromForm(ctx, trigger);
  renderDocumentCoverageFromRecords(ctx, trigger);   // — the sentence the seat may no longer write
  const stamp = coverageFormStamp(P.runDir);
  const cf = stamp.required ? readCoverageForm(P.runDir, stamp.formName) : { rows: null };
  if (!cf.rows?.length) return;      // no form ⇒ nothing to derive; the gates read what the run carries
  try {
    const json = renderCoverageLedgerJsonFromForm(cf.rows, classTokensFromScopeText);
    // RE-VALIDATE the derived JSON against the STRICT contract BEFORE it lands (VELTRIPHEN 2026-06-19).
    // Kept unchanged under even though the form's axes are already canonical: on a defect DON'T land
    // it — a bad JSON would throw at EVERY loadCoverageLedger read, silently degrading every gate for the
    // whole run. Drop any stale JSON instead, so the fallback is explicit and the report flags the gap.
    parseCoverageLedgerJson(json);
    const tmp = P.registerCoverageLedger + ".tmp";
    writeFileSync(tmp, json);
    renameSync(tmp, P.registerCoverageLedger);
    runLog(P.runDir, { event: "coverage-ledger-derived", trigger });
  } catch (e) {
    // Prose unparseable (render threw) OR the derived JSON failed strict re-validate. Drop any stale JSON so
    // loadCoverageLedger falls back to prose cleanly (no throw at read), record the gap, and surface it on the report.
    try { rmSync(P.registerCoverageLedger, { force: true }); } catch { /* absent is fine */ }
    note(`runDigest: coverage-ledger derivation/validate failed (${String(e.message).slice(0, 100)}) — prose fallback`);
    runLog(P.runDir, { event: "coverage-ledger-fallback", trigger, reason: `derive_failed:${String(e.message).slice(0, 80)}` });
    ctx.machineLedgerNote = ctx.machineLedgerNote || `coverage machine-ledger unavailable (${abbrev(String(e.message), 60)}) — gates ran on the prose table`;
  }
}

// Frame-omission design — CODE-DERIVE scope-ledger.json from the validated clearance-variants prose
// `### Scope ledger` table (so the JSON is authored by the driver, not the model, and matches the prose
// by construction — exactly the deriveCoverageLedgerJson pattern). NEVER-KILL: a manifest with no/unparseable
// Scope ledger (legacy artifacts, a terse run) logs a note and skips the write; the frame-diff then reads the
// manifest prose directly. The scope ledger is an optimization for the frame-diff, never a delivery gate.
function deriveScopeLedgerJson(ctx) {
  const P = ctx.paths;
  if (!existsSync(P.variantManifest)) return;
  try {
    // ── CONVERSION 3 — THE PARSE IS DELETED ON THE RECORDED PATH, NOT MOVED ───────────────────────
    //
    // This used to be the only way the ledger existed: re-read the `### Scope ledger` markdown TABLE out
    // of the prose manifest, on fixed column positions, and serialise what came back. The rows arrive
    // TYPED now, so the driver serialises them straight — through the same `scopeLedgerJsonFromRows` the
    // prose path ends in, which is what makes the two byte-identical for the same rows by construction.
    //
    // The prose parse SURVIVES for a manifest this build did not write — archived and replayed runs, and
    // any run whose seat took the dictated path. The anchor rule: a new way in, never a replacement.
    const recordedRows = recordedScopeLedgerRows(P.runDir);
    const json = recordedRows
      ? scopeLedgerJsonFromRows(recordedRows)
      : renderScopeLedgerJson(readFileSync(P.variantManifest, "utf8"));
    const tmp = P.scopeLedger + ".tmp";
    writeFileSync(tmp, json);
    renameSync(tmp, P.scopeLedger);
    // The SOURCE is recorded beside the event: "serialised from the call" and "parsed out of the prose"
    // are different facts about a run, and a reader of an archived ledger must be able to tell which.
    runLog(P.runDir, { event: "scope-ledger-derived", source: recordedRows ? "typed-call" : "prose-parse" });
  } catch (e) {
    note(`clearance-variants: scope-ledger derivation skipped (${String(e.message).slice(0, 100)}) — frame-diff reads the manifest prose`);
    runLog(P.runDir, { event: "scope-ledger-skipped", reason: `derive_failed:${String(e.message).slice(0, 80)}` });
  }
}

// CODE-DERIVE the mechanical FORM band from the manifest's distinctive element(s): the model picks WHICH token
// is distinctive (judgment — "TRIPHEN" out of "VEL TRIPHEN"); the MACHINE generates that token's COMPLETE form
// neighbourhood (edit-1 ∪ phonetic-family ∪ visual-confusable ∪ transliteration). This is the model-free FORM
// floor that fixes the generation lottery (the vendor cannot reach a first-consonant swap — live-verified on the
// incident where a benign-reading given name sat one consonant off a major street-gang label). Written to form-neighbourhood.json; the register funnel searches it (OR-stacked, count-first)
// and the form-axis oracle (mechanicalFormGapDirectives) checks every near-form was dispatched. NEVER-KILL
// (mirrors deriveScopeLedgerJson): no element / unparseable → log + skip; the register degrades to the model's
// manifest variants — never worse than today.
// 2026-07-18 — the floor is seeded from the VALIDATED variant-manifest.json and scoped by the variant-layer
// rows of the scope ledger. Both artifacts already existed; neither was read here. See scope-ledger.mjs
// droppedVariantFamilies and renderFormNeighbourhoodJson for the two defects this closes.
// 2026-08-03 — the SEED SET is the union of every distinctive element the manifest names, and falls
// back to the job's own mark when it names none, so the floor stops moving with the model's choice of anchor
// and can no longer be empty. See the VARIANT FLOOR section of form-neighbourhood.mjs.
export function deriveFormNeighbourhood(ctx) {   // @internal — exported for its call-site test
  const P = ctx.paths;
  // — an ABSENT prose manifest no longer returns without an artifact. It used to, and that was the
  // zero-semantics hole at its widest: no manifest ⇒ no form-neighbourhood.json ⇒ compileRegisterPlan's
  // bandFor(null) ⇒ a plan with ZERO floor entries, and nothing anywhere saying the floor was missing.
  // The floor's fallback seed is the job's own MARK, which is run input and cannot go missing with a
  // model turn, so the derivation now runs regardless and the prose is read when it happens to exist.
  const manifestMd = existsSync(P.variantManifest) ? readFileSync(P.variantManifest, "utf8") : "";
  let markets = [], droppedAxes = [];
  try {
    const rows = parseScopeLedgerJson(readFileSync(P.scopeLedger, "utf8"));
    markets = scopeJurisdictions(rows);
    // the form families judgment ruled out for THIS mark, with reasons, in its own scope ledger
    droppedAxes = droppedVariantFamilies(rows);
  } catch { /* scope ledger optional — markets are informational; no ledger ⇒ nothing dropped (fail-open) */ }
  // NOT scoped here: the transliteration SCRIPT set. `markets` is passed through but never narrows
  // SUPPORTED_SCRIPTS, so latin-diacritic/german/nordic/cyrillic/greek run on every matter regardless of the
  // jurisdictions judgment applied. That is what generated the five Drivers Haven diacritics — but the fold-dedupe
  // in formNeighbourhood removes them at the source, and the surviving cross-script forms (ß→ss, Cyrillic and
  // Greek homoglyphs) are genuinely distinct strings that cost one term each. Deferred deliberately: narrowing
  // scripts by market is a coverage decision, and the harm it was meant to fix is already gone.
  // the validated sibling is authoritative for the dominant element; prose seeding is the fallback
  let model = null;
  try { model = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8")); } catch { /* prose fallback */ }
  try {
    // The MARK is the floor's fallback seed and the only input to it that is not model output —
    // resolved exactly as every other job-mark consumer resolves it (stages.mjs blind-frame).
    const mark = ctx.job.marks ?? ctx.job.markName ?? ctx.job.name ?? "";
    // The active register's own declaration: `false` leaves the mixed-alphabet look-alike spellings out of
    // the band and lists them as not searched, with the reason its index gives. Undeclared changes nothing.
    const caps = registerCapabilities(ctx.register);
    const mixedScriptQuery = caps?.mixedScriptQuery ?? null;
    const ow = loadOrdinaryWords("en"), json = renderFormNeighbourhoodJson(manifestMd, { markets, droppedAxes, model, mark, ordinaryWords: ow.words, mixedScriptQuery, nativeScriptIndex: caps?.nativeScriptIndex ?? null });   // an unloadable word list removes nothing
    const tmp = P.formNeighbourhood + ".tmp";
    writeFileSync(tmp, json);
    renameSync(tmp, P.formNeighbourhood);
    let exact = 0, floor = 0, added = 0, seededFrom = "", seeds = [], notSearched = 0, mixedNotSearched = 0;
    try {
      const o = JSON.parse(json);
      exact = o.elements.reduce((a, e) => a + (e.band?.exactQueries?.length ?? 0), 0); notSearched = o.elements.reduce((a, e) => a + (e.band?.ordinaryWordDifferentSound?.length ?? 0), 0);
      mixedNotSearched = o.elements.reduce((a, e) => a + (e.band?.mixedScriptNotSearched?.length ?? 0), 0);
      floor = o.variant_floor?.counts?.floor ?? 0;
      added = o.variant_floor?.counts?.model_added ?? 0;
      seededFrom = String(o.seeded_from ?? "");
      seeds = o.elements.map((e) => `${e.role}:${e.element}`);
    } catch { /* counts are telemetry only */ }
    // The SEED SET is logged by name, because it is the input that decides whether two runs of the same
    // matter can produce the same floor — a floor count alone cannot tell a stable run from a re-anchored one.
    runLog(P.runDir, { event: "form-neighbourhood-derived", exact, floor, modelAdded: added, droppedAxes, seeds, seededFrom, ordinaryWordNotSearched: notSearched, ...(mixedScriptQuery === false ? { mixedScriptNotSearched: mixedNotSearched } : {}), ...(ow.error ? { ordinaryWordListError: ow.error } : {}) });
    // The fallback is not a quiet degrade: it means this run's variant floor rests on the mark alone
    // because the stage named no usable element. Loud, so the absence is a finding and not a shrug.
    if (seededFrom.startsWith("job mark"))
      note(`clearance-variants: variant floor seeded from the JOB MARK — the manifest named no usable distinctive element (${floor} floor terms generated; the floor is complete, its seed is not the model's)`);
  } catch (e) {
    // The reason is carried WHOLE. It used to be truncated to 80 characters into the runLog and
    // 100 into the note, which cut the part that says WHICH cause fired — and the empty floor this path
    // produces is invisible downstream: compileRegisterPlan's bandsFor(null) returns [], so the plan
    // compiles and freezes with no floor entries and no error, looking healthy. This line is the only
    // record that the mechanical floor is missing from the run, so it says the whole of why.
    const why = String(e.message);
    note(`clearance-variants: form-neighbourhood derivation skipped (${why}) — register falls back to the manifest variants, so this run has NO mechanical form floor`);
    runLog(P.runDir, { event: "form-neighbourhood-skipped", reason: `derive_failed:${why}`, mark: markText(ctx.job.marks ?? ctx.job.markName ?? ctx.job.name ?? "") });
  }
}

// WS2 (B3) — compile/freeze/reuse the deterministic register plan (the attachProfile
// pattern, applied to search identity). The FROZEN _driver/register-plan.json always wins on a
// resume (mid-run re-derivation is the drift the freeze forbids — a corrupt one fails LOUD).
// ALWAYS ON (the CLEAROTRON_REGISTER_PLAN flag was REMOVED on the senior lawyer's instruction 2026-07-03: shipped
// functionality is never hidden behind env flags — it is on, or it is rolled back): every fresh
// run mints from the structured manifest sibling; a run that cannot support a plan (no/malformed
// sibling — e.g. a pre-spec48 resume — or a class-less matter) degrades to ctx.registerPlan =
// null with a logged reason and every consumer takes the legacy path. Replay reads frozen
// artifacts and receipt-keyed validators, never any env — historical verdicts can never flip.
// CROSS-RUN PLAN STORE REMOVED 2026-07-19. The per-slug store
// (<studio>/<slug>/_plans/register-plan.vN.json) reused/extended a previous run's plan for the same
// matter. It made a shipped fix UNDELIVERABLE: `extendRegisterPlan` is strictly append-only
// (`entries: [...prev.entries, ...added]`, never a removal) and reuse keyed on
// `variants_fingerprint`, which does NOT include the form band. So the 2026-07-18 Drivers Haven
// re-run compiled a clean form band, then dispatched the 2026-07-17 plan's stale diacritic
// OR-stack anyway (`source:"extended", added:11`) and failed on the identical gate, identical five
// terms, identical 424 hits. Any defect that ever reached a plan was immortal for that matter.
//
// Determinism does NOT depend on the store and is unaffected: the compiler is PURE, so the same
// manifest + job + form band still yields a byte-identical plan on a fresh compile. That is what
// fixed the F2 non-reproducibility (fact-set Jaccard 0.04 across re-runs); the store only ever
// added "recall is monotone across plan versions".
//
// Measured before removing: across the whole corpus, 20 plans MINTED, 17 FROZEN (the run-level
// resume freeze below), 5 EXTENDED — and all 5 extensions were re-runs of test matters. The
// monotone-recall guarantee protected a re-clear, which effectively never happens in production,
// at the cost of hiding every fix from the only matters we re-run to verify fixes.
//
// A genuinely narrower manifest on a re-run is now VISIBLE (a smaller fresh plan) rather than
// silently backfilled from history. If monotone recall is ever wanted for a real re-clear it must
// be explicit and diffed, never a silent default.
//
// The RUN-LEVEL freeze (P.registerPlan, immediately below) is untouched and load-bearing: a run
// resuming mid-flight must not re-plan, or its half-executed band no longer identity-joins to its
// qids. That freeze lives inside one run and can never carry a defect across a code change.
// A1 — an axis whose EVERY entry is `unsupported` (capability gaps) will dispatch NOTHING: deferral is
// the honest lane, so this is a LOUD EVENT, never a rejection. Refusing the plan would convert a set of
// disclosed gaps into an undelivered run; staying silent would let a whole register axis quietly ship
// as a stack of deferred rows nobody flagged at plan time.
function logFullyDeferredAxes(plan, P, source) {
  for (const a of fullyDeferredAxes(plan)) {
    runLog(P.runDir, { event: "register-plan-axis-deferred", source, axis: a.axis, entries: a.entries,
      reason: String(a.reason ?? "").slice(0, 200) });
    note(`register-plan: axis ${a.axis} will dispatch ZERO entries — all ${a.entries} deferred as capability gaps (${String(a.reason ?? "").slice(0, 120)})`);
  }
}

// `frozenOnly` (item): read the FROZEN plan or nothing. reconstructCtx is an introspection path —
// it must never compile and freeze a plan into an existing run as a side effect of being asked what the
// run already holds. (attachProfile / attachFramework take the same posture via `write:false`.)
/**
 * Ask the register whether the client owns the element the frame proposed, and record the answer.
 *
 * ASYNC AND SEPARATE FROM THE COMPILE, which is why it is its own step rather than a branch inside
 * `attachRegisterPlan`: that function is synchronous and is called on the resume path too. The shape is
 * the digest's — an async driver step writes a receipt, a synchronous consumer reads it — and it buys
 * the property that matters here: the compile cannot accidentally exclude anything by reaching for a
 * promise it does not await.
 *
 * NOT A REGISTERED CONTEXT DERIVATION, and the reason is worth stating because the obvious reading is
 * that it should be. `stage-context.mjs` declares the derivations a sandbox can REPLAY, and its runners
 * are synchronous. This one asks a live register a question; there is no offline re-derivation of that,
 * and declaring it would promise the `--experiment` rig something no runner can deliver — which the
 * guard catches by name, loudly, as it should. A sandbox instead inherits the receipt with the rest of
 * `_driver/`, and a sandbox that has none excludes nothing, which is the same answer every other
 * unverified run gets.
 *
 * NEVER-KILL. Every failure writes an unverified receipt and the run plans exactly as it does today.
 * The element being searched in full is the safe direction and the status quo; the only thing that can
 * narrow a client's search is a register answer naming their own live registration.
 */
async function verifyAndRecordHouseElement(ctx, opts = {}) {
  const P = ctx.paths;
  try {
    const proposed = frameHouseElementCandidate(P.runDir);
    if (!proposed) return;   // the ordinary case: the frame proposed nothing and there is no question

    const classes = withFrameClasses(inScopeClassList(ctx.job, ctx.profile), P.runDir);
    // THE CLIENT'S OWN NAMES. The profile's trading names are the curated list; the matter's customer is
    // the free-text one. Both, because a profile may be absent on a one-off matter and a customer string
    // may be a person where the filings are held by a company.
    const owners = [...new Set([...(ctx.profile?.selfExclusionOwners ?? []), ctx.job?.customer].map((o) => String(o ?? "").trim()).filter(Boolean))];
    const caps = registerCapabilities(ctx.register);
    const { regions } = resolvePlanRegions(registerJurisdictions(ctx.job, ctx.profile), caps);
    const rec = resolveRecordExecutor({
      lister: opts?.recordLister ?? null, adapter: noteAdapter(ctx, registerAdapter(ctx.register)),
      agentId: ctx.agentId ?? null, sessionKey: `clearance-${ctx.run.slug}-${ctx.run.codename}`,
      recordLog: runRecordLogPath(P.runDir),
      fixtureDir: ctx.job?.registerFixtures?.records ?? null,
    });
    // AN EXACT-NAME LISTING OF THE ELEMENT, filtered to the client's own live in-class registrations by
    // the verifier. The owner join is done on REAL RECORDS the register returned, which is what
    // "verified by owner, not asserted" means — there is no owner-predicate listing on this interface
    // and inventing one would be a second way to ask the same question.
    const lookup = typeof rec.list !== "function" ? null : async ({ element, classes: cls }) => {
      const r = await rec.list(element, { classes: cls, regions, limit: 50 });
      if (!r || r.ok === false) return { ok: false, reason: String(r?.reason ?? "the register listing did not answer") };
      return { ok: true, records: Array.isArray(r.records) ? r.records : [] };
    };

    const receipt = await verifyHouseElementOwnership({ element: proposed.element, classes, owners, lookup });
    receipt.remainder = proposed.remainder;   // carried so the compile needs only this one file
    ensureDriverDir(P.runDir);
    atomicWrite(driverDir(P.runDir, HOUSE_ELEMENT_RECEIPT), JSON.stringify(receipt, null, 2) + "\n");
    runLog(P.runDir, { event: "house-element-ownership", verified: receipt.verified, reason: receipt.reason,
      records: receipt.records.length, owners: owners.length, executor: rec.source });
    if (!receipt.verified) note(`house element: ${proposed.element} stays in the search — ${receipt.reason}`);
  } catch (e) {
    // A THROW HERE MUST NOT COST A REPORT. No receipt means no exclusion, which is today's plan.
    runLog(P.runDir, { event: "house-element-ownership-failed", reason: String(e?.message ?? e).slice(0, 160) });
  }
}

function attachRegisterPlan(ctx, { frozenOnly = false } = {}) {
  const P = ctx.paths;
  if (frozenOnly) {
    // Read and nothing else: no feasibility re-check, and NO run-journal rows. "the driver attached the
    // frozen plan" is a run event; being asked what the run already holds is not, and a reconstruct
    // that logged one would put an event in the journal that never happened.
    ctx.registerPlan = existsSync(P.registerPlan) ? parseRegisterPlan(readFileSync(P.registerPlan, "utf8")) : null;
    return;
  }
  if (existsSync(P.registerPlan)) {
    // parseRegisterPlan throws token-first on corruption — the frozen plan is never silently re-derived
    ctx.registerPlan = parseRegisterPlan(readFileSync(P.registerPlan, "utf8"));
    runLog(P.runDir, { event: "register-plan", source: "frozen", version: ctx.registerPlan.plan_version, entries: ctx.registerPlan.entries.length });
    logFullyDeferredAxes(ctx.registerPlan, P, "frozen");
    return;
  }
  ctx.registerPlan = null;
  let compiled;
  try {
    let manifest = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8"));
    // ── 647 — THE CLIENT'S OWN ELEMENT LEAVES THE CONFLICT ANALYSIS, ON EVIDENCE OR NOT AT ALL ─────
    //
    // The receipt is the ONLY thing that arms this. An absent, unreadable or unverified receipt plans
    // exactly as this compile did before the rule existed, which is the element searched in full — the
    // safe direction, and the one a client is never harmed by.
    let houseConfirmation = null;
    let houseReceipt = null;
    try { houseReceipt = JSON.parse(readFileSync(driverDir(P.runDir, HOUSE_ELEMENT_RECEIPT), "utf8")); }
    catch { houseReceipt = null; }
    if (houseReceipt?.verified === true) {
      const r = excludeHouseElement(manifest, { element: houseReceipt.element, remainder: houseReceipt.remainder });
      if (r.refused) {
        // VERIFIED OWNERSHIP AND STILL NOT APPLIED. The receipt answers who owns the element; the
        // transform answers whether this manifest's mark can survive the cut. Both must hold.
        runLog(P.runDir, { event: "house-element-not-applied", reason: r.refused, element: houseReceipt.element });
      } else {
        manifest = r.manifest;
        houseConfirmation = r.confirmation;
        runLog(P.runDir, { event: "house-element-excluded", element: houseReceipt.element,
          remainder: houseReceipt.remainder, dominant_element: manifest.dominant_element,
          evidence: (houseReceipt.records ?? []).length });
      }
    }
    let form = null;
    try { form = JSON.parse(readFileSync(P.formNeighbourhood, "utf8")); } catch { /* form band optional */ }
    compiled = compileRegisterPlan({
      manifest,
      // the SAME class resolution the recall checks use (job.classes ∪ per-mark classes, else the
      // profile's defaults) — the plan must never be scoped narrower than what the run enforces
      // Jurisdictions resolve EXACTLY as every other scope consumer resolves them (stages.mjs
      // scopeTerritories): the instructed territories, else the customer profile's defaults.
      // enqueue-schema documents "omit it to search the customer's default territories" and NOTHING
      // backfills job.jurisdictions, so `ctx.job.jurisdictions ?? []` compiled a plan with regions:[]
      // for the documented normal case. Harmless on corsearch (an absent region clause is a worldwide
      // sweep); fatal on a provider whose regions[] is mandatory, where every entry then errored on its
      // count probe and the whole plan joined MISSING at fan-in (review finding 11).
      // DECISION 18: the frame's added classes are no longer UNIONED into the plan's class scope. They
      // ride one identical-mark entry each instead, which is what an added class is supposed to cost —
      // unioning put every added class on every variant and every family. The instructed scope is what
      // it always was, and `addedClasses` only ever appends.
      job: { jobKey: ctx.run.slug, classes: inScopeClassList(ctx.job, ctx.profile).map(String), jurisdictions: registerJurisdictions(ctx.job, ctx.profile) },
      addedClasses: frameIdentifiedClassRows(P.runDir), frameMarkets: lastAcceptedMatterFrame(P.runDir)?.scope_jurisdictions ?? null,
      marketList: narrowingMarkets(instructedOrder(ctx.paths, ctx.job), ctx.profile),
      form, skillVersion: "clearance-register@spec48",
      // — WHICH ELEMENT THE EXCLUSION TOOK OUT, so the compile can make its form band unreachable
      // rather than merely unasked-for. Null unless the ownership receipt verified, which is the same
      // condition the exclusion itself runs under: an unverified receipt excludes nothing, and it must
      // not remove a band either.
      houseElement: houseConfirmation ? houseReceipt?.element : null,
      // phase 3 — the plan is compiled AGAINST THE ACTIVE PROVIDER's declared capabilities, so the
      // frozen artifact is executable by construction: the OR-stack split uses that provider's width,
      // jurisdictions are translated into its office vocabulary (EU→EM on Compumark), and a predicate
      // it cannot express is stamped `unsupported` (→ an error:true block → a deferred coverage row)
      // instead of quietly compiling into a weaker search.
      capabilities: registerCapabilities(ctx.register),
      // — the offices this contract covers that THIS BOX cannot reach (a composed provider with an
      // unconfigured member). Split out at compile so the reachable half still executes and the rest
      // rides the plan as a disclosed deferral, never as a silently narrower search.
      unavailableOffices: registerUnavailableOffices(registerCapabilities(ctx.register)),
    });
    // REQUIREMENT 3 — the element is still checked ONCE, as a confirmation of the client's own live
    // registrations rather than as a conflict sweep, so the exclusion is evidenced on the report by a
    // query that ran. Appended after the compile because it is not derived from the manifest: it is the
    // one question about the element the plan still owes.
    if (houseConfirmation && compiled?.entries) {
      const used = new Set(compiled.entries.map((e) => e.qid));
      compiled.entries.push({
        ...houseConfirmation,
        qid: mintSupplementalQid({ prefix: "house", term: houseConfirmation.term, used }),
        nice_classes: compiled.nice_classes ?? [],
        regions: compiled.regions ?? [],
      });
    }
  } catch (e) {
    // NEVER-KILL at mint time: no/malformed sibling or a class-less matter degrades to the legacy
    // path with a logged reason — the plan improves the run, it never turns delivery off.
    note(`register-plan: mint skipped (${String(e.message).slice(0, 100)}) — legacy register path this run`);
    runLog(P.runDir, { event: "register-plan-skipped", reason: String(e.message).slice(0, 120) });
    return;
  }
  // Every fresh run compiles its own plan from THIS run's manifest + job + form band. No prior run
  // of the same matter is consulted (see the header note): a plan is a question list, and it is
  // rebuilt from current inputs so a fix to any of those inputs actually reaches the next run.
  const { plan, action, added } = resolvePlanAgainstStore(null, compiled);
  // 2026-07-29 hardening — variants-model values the compiler refused to dispatch (an infix-star
  // family probe, a prose/label value) compile as DISCLOSED deferred rows, and the drop is loud at
  // mint time too: this event is the feedback to the authoring stage a silent nil search (or a dead
  // run at the freeze lint) never gave. The coverage skeleton discloses the same rows to judgment.
  const droppedVariants = plan.entries.filter((e) => e.unsupported === true && variantTermIssue(e.term));
  if (droppedVariants.length) {
    runLog(P.runDir, { event: "register-plan-variant-dropped",
      entries: droppedVariants.map((e) => ({ qid: e.qid, reason: String(e.unsupported_reason ?? "").slice(0, 200) })) });
    note(`register-plan: ${droppedVariants.length} variants-model value(s) compiled as disclosed deferred rows (un-searchable shape): ${droppedVariants.map((e) => e.qid).join(", ")}`);
  }
  // Repair-first D, hotfixed 2026-07-06 (The Quiet Trail e2e): the gate now applies the round's own
  // doctrine to itself — A REPAIRABLE CONDITION NEVER TERMINATES A RUN.
  //   - `repairable` issues (OR-stack width/name length): log-only from ANY provenance — the executor
  //     chunks oversized stacks at runtime (proven live). The 2026-07-06 failure was exactly this
  //     gate throwing on a 674-name entry INHERITED byte-identical from a pre-split July-3 store via
  //     the recall-monotone extension — a run the executor would have completed.
  //   - `unexecutable` issues (empty terms, unknown predicate, non-numeric classes, dangling guards):
  //     loud ONLY for freshly-authored entries — the whole plan on a fresh mint, ONLY the `added`
  //     entries on an extension. Inherited/reused entries are history, never a fresh compiler bug:
  //     log-only, never brick a matter over its own store.
  const allIssues = validatePlanFeasibility(plan, { capabilities: registerCapabilities(ctx.register) });
  if (allIssues.length) {
    const freshQids = new Set(action === "minted" ? plan.entries.map((e) => e.qid) : (added ?? []).map((e) => e.qid));
    const terminalIssues = allIssues.filter((i) => i.severity === "unexecutable" && freshQids.has(i.entry));
    runLog(P.runDir, { event: "register-plan-infeasible", source: action,
      repairable: allIssues.some((i) => i.severity === "repairable") || undefined,
      terminal: terminalIssues.length ? true : undefined,
      issues: feasibilityMessages(allIssues).slice(0, 6) });
    if (terminalIssues.length)
      throw new StageFailure("register-plan", `freshly compiled plan entries are unexecutable (a compiler bug, not a provider problem): ${feasibilityMessages(terminalIssues).slice(0, 4).join("; ")}`, undefined, { failClass: "deterministic" });
    note(`register-plan: ${allIssues.length} feasibility issue(s) tolerated (${action}; legacy/repairable — the executor chunks oversized stacks): ${feasibilityMessages(allIssues).slice(0, 2).join("; ")}`);
  }
  // (no cross-run store write — the run-dir freeze below is the plan's only durable home, and the
  // archived run keeps it for audit/replay exactly as before)
  // supplemental-lane contract (copper-lattice re-route): stamped on the RUN-DIR copy ONLY — the store
  // copy stays byte-identical (F2 reuse). Everything downstream gates on this flag (the propose-tool
  // stage message, the enumerate exclusion, the band_block_unplanned validator), so a frozen pre-flag
  // plan resumed under new code keeps its old contract end-to-end, and replay over archived runs never
  // sees the flag at all.
  const runPlan = { ...plan, contract: { ...(plan.contract ?? {}), supplemental_lane: 1 } };
  writeFileSync(`${P.registerPlan}.tmp`, JSON.stringify(runPlan, null, 2) + "\n");
  renameSync(`${P.registerPlan}.tmp`, P.registerPlan);
  ctx.registerPlan = runPlan;
  runLog(P.runDir, { event: "register-plan", source: action, version: plan.plan_version, entries: plan.entries.length, added: added.length });
  note(`register plan ${action}: v${plan.plan_version}, ${plan.entries.length} entries${added.length ? ` (+${added.length} new)` : ""}`);
  logFullyDeferredAxes(runPlan, P, action);
  // ── deferred_coverage GETS A CONSUMER (review findings 1/10/14) ──────────────────────────────────
  // The compiler splits the matter's jurisdictions into {regions, deferred}. When SOME are covered, the
  // entries compile with the NARROWED regions and execute normally — every block joins `executed`, the
  // per-axis skeleton says "executed", and the coverage-ledger rows are model-authored prose that has
  // no signal the office was dropped. So a matter that asked for four territories was searched in two
  // and shipped a clean over the other two, recorded NOWHERE in the machine path (`deferred_coverage`
  // had zero consumers outside its own test). That is a false clean over an unsearched territory —
  // doctrine 2 and 3 inverted.
  // Consumer, in the ONE place that is code-derived rather than model-derived: the jurisdiction-scope
  // backstop's `searched` set. A jurisdiction the ACTIVE PROVIDER does not cover is, as a matter of
  // fact, not searched — so it is subtracted there and surfaces as under-coverage the run discloses.
  registerDeferredCoverage(ctx, plan);
}

/**
 * Record the plan's uncovered jurisdictions on ctx so the jurisdiction-scope backstop can subtract them
 * from the searched set, and log/note them. `plan.deferred_coverage` is [{jurisdiction, reason}].
 * Exported for test; never throws (a plan without the key is a fully-covered plan → no-op).
 */
export function registerDeferredCoverage(ctx, plan) {   // @internal
  const deferred = Array.isArray(plan?.deferred_coverage) ? plan.deferred_coverage : [];
  // A12: recorded in the CANONICAL vocabulary (UK→GB, EM/EUTM/EUIPO→EU) so the scope backstop's
  // subtraction meets extractSearchedJurisdictions on the same codes — never GB-vs-UK as two territories.
  ctx.registerDeferredJurisdictions = deferred.map((d) => canonicalJurisdictionCode(d?.jurisdiction)).filter(Boolean);
  if (!ctx.registerDeferredJurisdictions.length) return ctx.registerDeferredJurisdictions;
  try {
    runLog(ctx.paths.runDir, { event: "register-plan-deferred-coverage",
      jurisdictions: ctx.registerDeferredJurisdictions, regions: plan.regions ?? [] });
  } catch { /* logging is never allowed to kill the mint */ }
  note(`register plan: jurisdiction(s) ${ctx.registerDeferredJurisdictions.join(", ")} are NOT covered by the active register provider — `
    + `those territories were never searched on the register (searched: ${(plan.regions ?? []).join(", ") || "none"}). `
    + `They are a deferred coverage gap for judgment, never a clean negative.`);
  return ctx.registerDeferredJurisdictions;
}

// FORM-axis regrounding (Property 1, mechanical): a deterministically-generated form near-form the funnel never
// DISPATCHED is a completeness gap (NOT a sufficiency call). Emit it as a `variant` frame-diff directive so it
// rides the SAME supplemental-sweep + clamp channel as the blind frame-diff — the form axis stops depending on a
// peer model to NOTICE the gap (two LLMs share the same blind spot; the oracle does not). NEVER-KILL: any
// missing/unparseable artifact → [] (the blind frame-diff still runs).
export function mechanicalFormGapDirectives(ctx) {   // @internal
  const P = ctx.paths;
  try {
    if (!existsSync(P.formNeighbourhood) || !existsSync(P.registerNamedBand)) return [];
    const elements = parseFormNeighbourhoodJson(readFileSync(P.formNeighbourhood, "utf8"));
    if (!elements.length) return [];
    const bandText = readFileSync(P.registerNamedBand, "utf8");
    const dispatched = dispatchedQueriesFromBand(bandText);
    // LENIENCY (bias toward "dispatched" — a false gap only wastes a self-heal sweep / over-clamps; it can
    // never ship a false clean): a near-form ALSO counts as dispatched if it appears anywhere in the band
    // artifact — a query the funnel described in prose, or a returned mark_text — so a prose query summary
    // does not manufacture gaps. Only a near-form that appears NOWHERE (truly unsearched) stays a gap.
    const lower = bandText.toLowerCase();
    for (const el of elements) {
      for (const q of el.band.exactQueries) if (lower.includes(String(q).toLowerCase())) dispatched.push(q);
      for (const w of (el.band.wildcardPatterns ?? [])) if (lower.includes(String(w).toLowerCase())) dispatched.push(w); // phonetic family dispatched-in-prose
    }
    // A WITHHELD FAMILY IS AN EXPLAINED ABSENCE. The reading turn withholds a waiting family with its reason
    // (withheld-families.mjs), and the wildcard fringe is one. Counted as unsearched, it would be ordered
    // searched anyway, or clamp the verdict, over a decision the run recorded.
    const withheld = readWithheldFamilies(P.runDir);
    const explained = (ctx.registerPlan?.entries ?? []).filter((e) => withheld[e.qid])
      .flatMap((e) => [e.term, ...(Array.isArray(e.terms) ? e.terms : [])]).filter(Boolean);
    return formGapDirectives(elements, { dispatched, explained });
  } catch { return []; }
}

/**
 * EVERY ARTIFACT THAT CARRIES A JUDGMENT DERIVED FROM THE TAINTED BANDS, renamed by the taint park.
 *
 * Named and exported because the park has no test harness that can drive it, and the one thing that goes
 * wrong here is an artifact being FORGOTTEN — which fails silently, as a resumed digest that skips the
 * re-ruling the park exists to force. A list nobody can assert on is a list that drifts.
 *
 * The park's own rule: "a digest already derived from tainted material is renamed too, else its skip
 * would ship stale rows." Four artifacts satisfy that description:
 *   · register-findings.md          — the digest itself
 *   · register-coverage-ledger.json — its derived machine mirror
 *   · the coverage form's SEAT copy — LEGACY: nothing writes it since the typed-transport conversion
 *     (statuses ride record_coverage), but a pre-conversion run being resumed can still carry one, and
 *     renaming it if present keeps a resumed pre-conversion seat from handing back the pre-park file
 *   · the coverage form's `_driver/` copy — THE ACCUMULATOR, and the one  left behind. It holds the
 *     statuses the seat settled OVER THE TAINTED BANDS, and `formRowKey` is `block:<qid>` — a qid does
 *     not change when its slice is re-run. So a block re-run to a different hit count keeps its stale
 *     `confirmed-clean` and its stale reason, unionCoverageForm carries both into the resumed digest,
 *     findCoverageFormViolations finds nothing to refuse, and the run delivers a re-ruling that never
 *     happened.
 *
 * The form name comes from the ERA STAMP, not the default, so a run whose `form_path` differed does not
 * leak. RENAMED, never deleted — forensics, like everything else in that branch. The stamp itself STAYS:
 * runDigest re-arms and re-writes the form before the next dispatch, and in the window between, a stamp
 * with no form is `coverage_form_missing` — the fail-closed direction.
 */
export function taintParkJudgmentArtifacts(P, runDir) {   // @internal
  const form = coverageFormPaths(runDir, coverageFormStamp(runDir).formName);
  return [P.registerFindings, P.registerCoverageLedger, form.seat, form.sidecar];
}


// Snapshot the JSON to _history (audit) then delete it, ahead of a digest pass that will re-run.
// NEVER restored: a stale ledger over rewritten prose would corrupt every later gate on exactly the
// escalated/late-bound runs (the verified WS-A blocker); absence just means the gates fall back to
// prose until re-saved. Returns whether a file was actually dropped.
function dropStaleCoverageLedger(ctx, trigger) {
  const P = ctx.paths;
  if (!existsSync(P.registerCoverageLedger)) return false;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = join(P.runDir, "_history", `${ts}-coverage-ledger-${trigger}`);
    mkdirSync(dest, { recursive: true });
    copyFileSync(P.registerCoverageLedger, join(dest, basename(P.registerCoverageLedger)));
  } catch { /* snapshot is best-effort */ }
  try { rmSync(P.registerCoverageLedger, { force: true }); } catch { /* best-effort */ }
  runLog(P.runDir, { event: "coverage-ledger-dropped", trigger });
  return true;
}

// Terminal ladder, invalid side (the machine contract never kills a run). The
// registerFindings validator checks prose FIRST, so a coverage_* reason means the findings are good
// and only the JSON mirror is bad after the corrective/warm retries — quarantine it (rename keeps it
// inspectable) and let the run proceed on the prose path with the machine_ledger_note delivery flag.
function quarantineCoverageLedger(ctx, failReason, trigger) {
  const P = ctx.paths;
  try {
    if (existsSync(P.registerCoverageLedger))
      renameSync(P.registerCoverageLedger, P.registerCoverageLedger.replace(/\.json$/, ".invalid.json"));
  } catch { /* best-effort */ }
  // The live file MUST be gone even if the rename failed (EBUSY/EACCES): otherwise the re-validate
  // re-fails on the same JSON and must() kills the run — the never-kill contract dies. No-op after
  // a successful rename.
  try { rmSync(P.registerCoverageLedger, { force: true }); } catch { /* best-effort */ }
  ctx.machineLedgerNote = `machine coverage ledger failed validation after corrective retries (${abbrev(String(failReason), 120)}) — quarantined; coverage gates read the prose table for this run`;
  writeRunStatus(ctx, { machineLedgerNote: ctx.machineLedgerNote });   // survives a crash-resume
  runLog(P.runDir, { event: "coverage-ledger-quarantined", trigger, reason: String(failReason).slice(0, 160) });
}

// ── — THE SAVE-ONLY FOLLOWUP IS GONE, BECAUSE NOTHING ASKS THE MODEL TO SAVE ANYTHING ─────────
//
// `ensureCoverageLedgerSaved` dispatched a followup that DICTATED the machine ledger's JSON schema
// by hand — "a JSON ARRAY, one object per prose Coverage-ledger table row, keys EXACTLY {axis, scope,
// status, reason}…" — a fourth copy of a contract that lives in coverage-ledger.parseCoverageLedgerJson.
// The artifact it asked for is now derived by the driver from the coverage form, so a missing JSON can
// only mean the DERIVE failed; asking a model to hand-write it would be asking it to fix a driver
// defect with a transcription, which is the whole shape removes. The never-kill contract is
// unchanged and is carried by the note below: a run whose JSON did not land delivers on the coverage
// rows the form carries, with the gap flagged on the report.
function noteCoverageLedgerAbsent(ctx, trigger) {
  const P = ctx.paths;
  if (!ctx.machineLedgerNote) {
    ctx.machineLedgerNote = "machine coverage ledger was not derived from the coverage form — coverage gates read the run's own rows for this run";
    writeRunStatus(ctx, { machineLedgerNote: ctx.machineLedgerNote });   // survives a crash-resume
  }
  runLog(P.runDir, { event: "coverage-ledger-fallback", trigger, reason: "derive_absent" });
}

// ── P2-A (the recall spine) — the retrieved→judgment RECONCILIATION ─────────────────────────────────
// Computed after EVERY digest pass (fresh, escalation, envelope, flush, AND idempotency
// skips — a resume must never sail past the gate): every live, in-scope, screen-surfaced record
// carrying the dominant element must END somewhere a reader can see — a finding row, a URI-citing
// Negative-results drop row, or membership of the explicitly ruled, COUNTED dominant-element crowd
// (a Coverage-ledger row). The code-ranked top slice must end individually. The evidence run's
// proven loss class: retrieved, screened surface:in-scope-live (a live US registration among them),
// then zero mentions on any judgment surface — all three kill seams (band→digest, round N→N+1
// rewrite, grid-candidate→judgment) die before the record first becomes text an existing gate can
// parse. This join IS that text, derived by code from the band, so nothing can die before it.
//
// Artifact: _driver/recall-reconciliation.json (the gate-visible discrepancy list; crowd memberships
// counted on the delivered surface, enumerated only here). Event: `recall-reconciliation` on every
// derivation — unended:0 is ASSERTED, never absent. Enforcement: unended ⇒ ONE followup on the
// winning digest session dictating the three ending forms (at most RECALL_FOLLOWUP_MAX attempts per
// unended-set signature, so a park/resume gets a fresh attempt without ever looping); what remains
// unended after that ships NAMED from the pre-verdict floor, through the terminal guards' deliver-and-clamp (the
// owner's ruling of 2026-10-19 that a run is never held), never a silent ship.
const RECALL_FOLLOWUP_MAX = 2;

// amendment 2 — the follow-up bound is a DEPTH ROW (2 / 1 / 1), not a constant. The constant stays
// as the one-country value and as the fallback, and the fallback direction is the whole point: a run whose
// depth is missing, malformed or from a product this build does not grade must get TODAY'S attempts, never
// fewer. Failing the other way would quietly shorten a recall check on exactly the runs we understand
// least. The ladder may only ever REDUCE this — that invariant is asserted per product in
// depth-ladder-table.test.mjs rather than clamped here, so an over-large row reds instead of being
// silently trimmed to something nobody asked for.
// acceptance 5 — WHICH LADDER SETTING THIS RUN ACTUALLY USED, in the run record.
//
// Every other number acceptance 5 asks for is a count of what the ladder produced. This is the one that
// makes those counts mean anything: without the row in force, a later reader comparing two runs cannot
// tell a graded product from an ungraded one, and every measurement across the change is unattributable.
// `source` is the load-bearing field — `default-ungraded` says a product this build has no row for fell
// back to one-country values, which otherwise looks exactly like a deliberate setting.
export function depthLadderEvent(ctx) {   // @internal
  const depth = ctx?.depth ?? null;
  return {
    event: "depth-ladder",
    // `level` is what the frozen policy calls it; see depthFor()'s note.
    product: String(ctx?.searchPolicy?.level ?? ctx?.searchPolicy?.product ?? "") || null,
    source: depth?.source ?? null,
    // the row, spread flat so a jq over run.jsonl reads one field per setting
    ...(depth ? Object.fromEntries(Object.entries(depth).filter(([k]) => k !== "source")) : {}),
  };
}

export const recallFollowupMaxFor = (ctx) => {   // @internal
  const n = ctx?.depth?.recallFollowupMax;
  return Number.isInteger(n) && n > 0 ? n : RECALL_FOLLOWUP_MAX;
};

const safeReadJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const safeReadText = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// ── — the placement→digest CARRY join ─────────────────────────────────────────────────────────
// placements.json is a DECLARED input of register-digest and the digest is told to adopt or
// counter-reason every entry, yet the driver's only reads of that file were a borderline count, an
// empty-file lint and a schema check — nothing ever asked whether a placed candidate reached the
// findings at all. Four sandboxed arms over one band produced watchlist-annex sets of 7, 7, 6 and 0,
// and no artifact anywhere recorded that the fourth had lost them. The band-keyed joins cannot cover
// this: a common-law-shaped placement carries `records: []`, so it has no uri, no band row, and is
// invisible to recall-reconciliation, presence-reconciliation and the screen gate alike.
//
// Disclosure only, deliberately. It never re-tiers (headline vs sheet-2 is judgment and puts
// tier assignment out of scope) and never gates — the artifact + the asserted event + one doubt per
// unanswered placement is the whole mechanism. Absent/legacy placements.json ⇒ computable:false with
// a named reason, never a silent skip.
// ── — THE FLOOR DUTY, checked ────────────────────────────────────────────────────────────────
//
// The floors are placement-inquiry's one uncapped obligation and nothing verified them. The ruling
// of 2026-08-20 made the duty machine-checkable — placed, or named by record id with a one-line ground —
// and this is the check that ruling ordered. The dictation that tells the seat to name the ids ships in
// the same commit, so a run predating it reports its WHOLE floor unmet, correctly.
//
// SAME POSTURE AS placement-carry: disclosure only. It re-tiers nothing, gates nothing and sends no
// followup. `computable:false` carries its reason and NO counts — a zero would read as "every floor
// accounted for", which is the opposite of "the band could not be read".
export function deriveFloorDuty(ctx, r, trigger = null) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  const write = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      atomicWrite(P.floorDuty, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`floor-duty artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  const notComputable = (reason) => {
    write({ schema_version: FLOOR_DUTY_SCHEMA_VERSION, computable: false, reason });
    runLog(P.runDir, floorDutyEvent({ trigger, reason }));
    return null;
  };
  try {
    const now = floorDutyNow(P);
    if (now.reason) return notComputable(now.reason);
    const { artifact, placements } = now;
    const fates = placementOwnerFates(P, placements);
    artifact.owners = fates.counted ?? null;
    if (!fates.counted) artifact.owners_absent = fates.absent;   // no count, and why: no groups, or an input that would not read
    // The pass's own outcome, beside the rows. That lesson: a stage that failed or skipped makes every
    // record it did not reach an UPSTREAM ABSENCE, not a judgment, and a reader blaming the seat for a
    // crash is reading the artifact wrong.
    artifact.pass = { ok: r?.ok === true, skipped: r?.skipped === true };
    write(artifact);
    runLog(P.runDir, floorDutyEvent({ trigger, artifact }));
    const t = artifact.totals;
    const undischarged = t.unanswered + t.named_without_ground;
    if (undischarged) {
      note(`floor duty: ${undischarged} of ${t.floors} floor row(s) did not come back on the placement form`
        + `${t.named_without_ground ? ` (${t.named_without_ground} named with no ground)` : ""}`
        + " — every floor is a live in-class identical or near-identical record and the duty is uncapped;"
        + " this records the gap and re-tiers nothing");
    }
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "floor-duty-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`floor-duty derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

/**
 * The floors reconciled against the band shape and the placements now on disk: `{artifact, placements}`, or
 * `{reason}` when they cannot be. Read, never written: `deriveFloorDuty` writes a pass's account from it, and a
 * resumed run's skip reads it (`floorDutyOwedNow`).
 */
function floorDutyNow(P) {
  const notComputable = (reason) => ({ reason });
  if (!existsSync(P.bandShape)) return notComputable("no band-shape.json — the floors are not on disk to check against");
  if (!existsSync(P.placementModel)) return notComputable("no placements.json (a run predating the structured placement mirror)");
  let floors, placements;
  try {
    const shape = JSON.parse(readFileSync(P.bandShape, "utf8"));
    // ABSENT vs EMPTY, and they are not the same answer. A shape with no floors slice cannot be
    // reconciled and says so; a shape whose floors slice IS empty is a real answer — this band held no
    // live in-class identical record — and reconciles trivially at 0/0.
    const slice = shape?.floors?.in_class_identical_or_near;
    if (!Array.isArray(slice)) return notComputable("band-shape.json carries no floors.in_class_identical_or_near array");
    floors = slice;
  } catch (e) { return notComputable(`band-shape.json unreadable: ${String(e?.message ?? e).slice(0, 80)}`); }
  try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; }
  catch (e) { return notComputable(`placements.json unparseable: ${String(e?.message ?? e).slice(0, 80)}`); }
  return { artifact: reconcileFloorDuty({ floors, placements, setAsideGroundOf: placementSetAsideGrounds(P) }), placements };
}

/**
 * DOES PLACEMENT OWE FLOORS ON THE SHAPE NOW ON DISK? A resumed run derives the band shape afresh, and one derived
 * since the last placement pass can owe more than that pass's floor-duty artifact says: a floor the new shape adds,
 * or a crowded (b) whose row no longer stands. Read from the artifact alone, placement skipped, the duty was derived
 * again straight after it, and the report shipped clamped with the step never asked. Read here as well, placement
 * runs again, and its dispatch-time union tells the step what changed. False where nothing can be reconciled.
 */
export function floorDutyOwedNow(P, name) {   // @internal — driven by its test with a run's own files
  if (name !== "placement-inquiry" || !floorDutyArmed(P.runDir)) return false;
  try { return Boolean(floorDutyBlock(floorDutyNow(P).artifact, { armed: true })); } catch { return false; }
}

function derivePlacementCarry(ctx, trigger) {
  const P = ctx.paths;
  const write = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      atomicWrite(P.placementCarry, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`placement-carry artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  const notComputable = (reason) => {
    write({ schema_version: PLACEMENT_CARRY_SCHEMA_VERSION, computable: false, reason });
    runLog(P.runDir, placementCarryEvent({ trigger, reason }));
    return null;
  };
  try {
    if (!existsSync(P.placementModel)) return notComputable("no placements.json (a run predating the structured placement mirror)");
    if (!existsSync(P.registerFindings)) return notComputable("no register findings file");
    let placements;
    try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; }
    catch (e) { return notComputable(`placements.json unparseable: ${String(e?.message ?? e).slice(0, 80)}`); }
    const artifact = reconcilePlacementCarry({
      placements, registerFindingsText: readFileSync(P.registerFindings, "utf8"),
    });
    write(artifact);
    runLog(P.runDir, placementCarryEvent({ trigger, artifact }));
    const t = artifact.totals;
    if (t.uncarried || t.unclassified) {
      note(`placement-carry: ${t.uncarried} of ${t.placements} placed candidate(s) end NOWHERE in the register findings`
        + `${t.unclassified ? `, and ${t.unclassified} more offer no join key so the carry cannot be decided either way` : ""}`
        + ` — each ships as an OPEN doubt, and none of this re-tiers or blocks anything`);
    }
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "placement-carry-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`placement-carry derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

// ── — the RETRIEVAL→findings record trace ─────────────────────────────────────────────────────
// The ruling: every retrieved record either becomes a finding, or carries a recorded reason it did
// not — per record, joinable back to the retrieval, never a tally. the 2026-08-04 R1 E2E run retrieved the jx
// lane's own target ten times (four REGISTERED, three in the matter's own class 9), banded all ten,
// and the delivered report never named the token; nothing anywhere said why. The carry join above
// could not see it because those records never reached a placement, and it starts at placements.
//
// Reads the band, placements, the delivered findings and the run.jsonl spine, and writes one row per
// retrieved record: where it stopped, on what ground, and where that ground was authored. The stage
// outcomes matter as much as the rows: on that run placement-inquiry never logged ok:true (two hard
// walls, then a resume that SKIPPED the stage because a killed attempt had left a partial artifact),
// so every record it failed to place is upstream absence, not judgment, and the trace says so rather
// than blaming a judgment step that never ran.
//
// Disclosure only, deliberately — annotate, never gate (placement-carry.mjs's rule). It never
// re-retrieves, never keeps a record the funnel dropped, never re-tiers and never blocks delivery: on
// the very run that motivated it, a gate would have suppressed a report that shipped.
// ── HALF ONE — the seam recorders ────────────────────────────────────────────────────────────
// Each writes down what ONE pass of ONE seam just did to each record it had in front of it. Called
// immediately after that pass, so the fact is recorded while the step still holds it: the next pass
// overwrites placements.json / register-findings.md / findings.json and nobody downstream can rebuild
// what this one decided. `record-discard.mjs` carries the winner rule (last row at a seam wins, a later
// carry cancels an earlier discard) because the seams re-run from several triggers.
//
// NEVER THROWS and never gates — same doctrine as the trace it feeds. A ledger that cannot be written
// costs the run a `basis: "recorded"`, which the trace then states, and costs it nothing else.
function recordSeamDiscards(ctx, { seam, stage: stageName, trigger = null, completed = true, skipped = false,
  saw = [], carried = [], reasonFor = null, evidence = "" } = {}) {
  const P = ctx.paths;
  try {
    ctx._discardPass ??= {};
    const pass = (ctx._discardPass[seam] = (ctx._discardPass[seam] ?? 0) + 1);
    // A skipped pass leaves standing what an earlier pass recorded (record-discard.mjs, `seamRows`).
    const prior = skipped ? foldDiscardLedger(safeReadText(driverDir(P.runDir, DISCARD_LEDGER_NAME))) : null;
    const rows = seamRows({ seam, stage: stageName, trigger, pass, completed, skipped, prior, saw, carried, reasonFor, evidence });
    const w = appendDiscardRows(P.runDir, rows);
    const discarded = rows.filter((r) => r.verdict === "discarded").length;
    runLog(P.runDir, {
      event: "record-discard", seam, stage: stageName, trigger, pass, completed,
      saw: rows.length, carried: rows.length - discarded, discarded,
      written: w?.present ?? null, bytes: w?.bytes ?? null, ...(w?.error ? { fail: w.error } : {}),
    });
    return w;
  } catch (e) {
    runLog(P.runDir, { event: "record-discard-failed", seam, stage: stageName, trigger, fail: String(e?.message ?? e).slice(0, 200) });
    return null;
  }
}

/** The band the placement seam saw, as `{uri}` rows. Cheap and tolerant: an unreadable band records nothing. */
function bandUriRows(P) {
  try {
    const band = safeReadJson(P.registerNamedBand);
    const enumerated = Array.isArray(band?.enumerated) ? band.enumerated : [];
    return enumerated.map((r) => ({ uri: bandRecordUri(r) })).filter((r) => r.uri);
  } catch { return []; }
}

/**
 * PLACEMENT. Everything in the band was in front of this pass; what it placed is in placements.json.
 * Recorded whether the pass completed or not — an incomplete pass discards nothing, and its rows say so
 * with `placement:stage-incomplete`, which is the ruling on the 澜珀 run made structural.
 */
function recordPlacementSeam(ctx, r, trigger = null) {
  const P = ctx.paths;
  const saw = bandUriRows(P);
  if (!saw.length) return null;
  return recordSeamDiscards(ctx, {
    seam: "placement", stage: "placement-inquiry", trigger, completed: r?.ok === true && !r?.skipped, skipped: r?.skipped === true,
    saw, carried: placedUriRows(P),
    evidence: r?.skipped ? "the pass was SKIPPED on an artifact already on disk, so it made no decision this pass" : (r?.fail ? String(r.fail).slice(0, 80) : ""),
    reasonFor: placementSeamReason(placementSetAsideGrounds(P)),
  });
}

/**
 * WHAT ONE PLACEMENT PASS DID, RECORDED: the ground every band record left it with (the seam rows) and the floors
 * it answered (the floor duty). The main path and the delivery gate's repeat of the stage both record through
 * here, so the ledger and the floor duty describe the placements the report is built from. Returns the pass
 * result.
 *
 * THE STAMP IS THE MAIN PATH'S. On the main path, a pass that actually ran arms the floor its account may be held
 * to. A SKIPPED pass leaves `placements.json` written by an earlier seat (on a resume, possibly one that never saw
 * the floors order), so it arms nothing, and its seam rows leave the earlier pass's grounds standing. The delivery
 * gate's repeat (`stale-repair`) arms nothing either: the floor it is held to is the one the run was already held
 * to, applied again to the repeated pass's account where the gate rebuilds the report from it. A run whose only
 * pass under the floors order is that repeat is held to no floor, as before.
 */
export function recordPlacementPass(ctx, r, trigger = null) {   // @internal — driven by its test with a run's own files
  recordPlacementSeam(ctx, r, trigger);
  deriveFloorDuty(ctx, r, trigger);
  // The decisions as they stand after this pass, where the reading step and the writer declare them: a pass that
  // changes only a set-aside's ground or a group's membership leaves a reader that already ran stale.
  try { writePlacementDecisions(ctx.paths); }
  catch (e) { runLog(ctx.paths.runDir, { event: "placement-decisions-failed", trigger, reason: String(e?.message ?? e).slice(0, 120) }); }
  if (r?.ok === true && r?.skipped !== true) recordPlacementBandIds(ctx.paths);
  if (r?.ok === true && r?.skipped !== true && trigger !== "stale-repair") armFloorDuty(ctx.paths.runDir);
  return r;
}

const bandRecordIds = (band) => [...new Set((band?.enumerated ?? []).map((r) => String(r?.record_id ?? "").toLowerCase()).filter(Boolean))];

/** The named band's record ids a placement pass that ran read, so a record the band gains after it is known as new. */
function recordPlacementBandIds(P) {
  try {
    const ids = bandRecordIds(safeReadJson(P.registerNamedBand)).sort();
    atomicWrite(paths(P.runDir).placementBandIds, JSON.stringify({ count: ids.length, ids }) + "\n");
  } catch (e) { runLog(P.runDir, { event: "placement-band-ids-failed", reason: String(e?.message ?? e).slice(0, 120) }); }
}

/**
 * The records the named band holds that the last placement pass that ran never read. [] when it read every one, and
 * when no pass recorded what it read (a run predating the record assesses nothing late). Ids, never the band's bytes:
 * a count that moved is not a record placement has not seen. PURE over the run's files.
 */
export function lateRecordIds(P) {   // @internal — driven by its test with a run's own files
  const seen = safeReadJson(paths(P.runDir).placementBandIds);
  if (!Array.isArray(seen?.ids)) return [];
  const had = new Set(seen.ids);
  return bandRecordIds(safeReadJson(P.registerNamedBand)).filter((id) => !had.has(id));
}

/**
 * THE LATE RECORDS THE REPORT DOES NOT ADDRESS: records the band holds that no placement pass read (`lateRecordIds`),
 * which neither the reading step's account nor the writer's findings name, and which no other clause names
 * (`alreadyNamed`, lowercased). A record either step names is addressed there, whatever placement did. Lowercased ids,
 * in the band's order. Never throws. PURE over the run's files.
 */
export function lateRecordsUnaddressed(P, alreadyNamed = new Set()) {   // @internal — driven by its test with a run's own files
  const late = lateRecordIds(P);
  if (!late.length) return [];
  let endings = { carried: new Set(), dropRows: new Set() };
  try { endings = parseFindingsEndings(readFileSync(P.registerFindings, "utf8")); } catch { /* no account from the reading step */ }
  let named = new Set();
  try { named = new Set([...findingUris(parseFindingsJsonLenient(readFileSync(P.findings, "utf8"))?.findings ?? []).keys()].map((u) => String(u).toLowerCase())); }
  catch { /* no findings from the writer */ }
  return late.filter((id) => !endings.carried.has(id) && !endings.dropRows.has(id) && !named.has(id) && !alreadyNamed.has(id));
}

/** The records the writer was owed, by id: the population its duty is out of. Null without a spec. Never throws. */
function owedUrisFor(runDir) {
  try {
    const owed = driverReadsFor(runDir).owed;
    // An entry's row owes every record it holds.
    return Array.isArray(owed) ? owed.flatMap((row) => (Array.isArray(row?.uris) && row.uris.length ? row.uris : [row?.uri ?? row?.record_id]))
      .map((u) => String(normalizeRecordUri(u) ?? "").toLowerCase()).filter(Boolean) : null;
  } catch { return null; }
}

/**
 * Every owner's fate at placement, by the shape's lists (placement-form.mjs `ownerFates`): `{counted}`, or `{absent}`
 * saying why there is no count. A shape with no groups has nothing to count by; an input that would not read is a
 * gap in the record. The two are not one fact, and the floor duty's artifact keeps them apart.
 */
export function placementOwnerFates(P, placements) {   // @internal — driven by its test with a run's own files
  try {
    const input = readPlacementFormInput(P.runDir);
    if (!input.groups) return { absent: "the band shape lists no groups" };
    const index = buildSelectionIndex(input);
    // What placement read, by its own reading log, and what each line's goods rest on, where the run recorded it.
    const evidence = readGoodsEvidence(P.runDir);
    const stateOf = Array.isArray(evidence?.records) ? new Map(evidence.records.map((r) => [normalizeRecordUri(r?.uri), r?.state])) : null;
    const placedUris = (Array.isArray(placements) ? placements : []).flatMap((p) => (Array.isArray(p?.records) ? p.records : []));
    const held = readPlacementForm(P.runDir);
    const counted = ownerFates({ groups: input.groups, entries: standingSetAside(held.set_aside, input, { placedUris, rows: held.rows }), index,
      placedUris,
      served: servedLines(input.groups, input.served, index),
      lineEvidence: stateOf ? (l) => stateOf.get(normalizeRecordUri(l?.record_id)) ?? null : null });
    return counted ? { counted } : { absent: "the band shape's groups could not be counted" };
  } catch (e) { return { absent: `an input could not be read: ${String(e?.message ?? e).slice(0, 120)}` }; }
}

/**
 * WHY A RECORD THE PICKING STEP DID NOT PLACE LEFT IT. Where the step set aside that owner's records as a
 * set, the record leaves with the step's own ground (sentence 6, ruled 2026-09-25). Otherwise the step
 * completed and said nothing about it, which is what the reason-less exit count reports. PURE.
 */
export function placementSeamReason(groundOf) {   // @internal
  return (_rec, uri) => {
    const g = typeof groundOf === "function" ? groundOf(uri) : null;
    if (g) return { reason: "placement:set-aside", reason_source: "step-stated",
      detail: g.by === "group" ? `placement-inquiry set aside this owner's records with group ${g.group}: ${g.ground}`
        : `placement-inquiry set aside this owner's records as a set: ${g.ground}` };
    return { reason: "placement:not-selected", reason_source: "step-silent",
      detail: "placement-inquiry completed this pass and named no placement for this record; the decision not to carry it was made and no ground for this record was recorded" };
  };
}

/**
 * DIGEST. The placements were in front of this pass; the carry class of each is read off the digest's OWN
 * output (register-findings.md) by the existing placement-carry vocabulary — one carry vocabulary, never
 * a second matcher. `carried` and the two reasoned classes are all carries at this seam: a Negative-results
 * row and a Disagreement-resolutions row are the digest speaking, so the record's ending is the digest's
 * stated one and it is recorded as such rather than as a silent drop.
 */
function recordDigestSeam(ctx, r, trigger = null) {
  const P = ctx.paths;
  const saw = placedUriRows(P);
  if (!saw.length) return null;
  let idx = new Map();
  try {
    const placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
    idx = placementIndex(placements, existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "");
  } catch { /* the trace states an indeterminate carry; this seam records what it can */ }
  const carried = [];
  for (const row of saw) {
    const c = idx.get(normalizeRecordUri(row.uri))?.carry;
    if (c === "carried") carried.push(row);
  }
  return recordSeamDiscards(ctx, {
    seam: "digest", stage: "register-digest", trigger, completed: r?.ok === true && !r?.skipped, skipped: r?.skipped === true,
    saw, carried,
    evidence: r?.fail ? String(r.fail).slice(0, 80) : "",
    reasonFor: (rec, uri) => {
      const seat = idx.get(uri);
      if (seat?.carry === "reasoned-negative") return { reason: "digest:reasoned-negative", reason_source: "step-stated",
        detail: `the register digest wrote this candidate a Negative-results drop row: ${seat.ended_by ?? ""}`.trim() };
      if (seat?.carry === "adjudicated") return { reason: "digest:adjudicated", reason_source: "step-stated",
        detail: `the register digest resolved this candidate in a Disagreement-resolutions row: ${seat.ended_by ?? ""}`.trim() };
      if (seat?.carry === "uncarried") return { reason: "digest:silent-drop", reason_source: "absent",
        detail: `placement placed this candidate at ${seat.tier}; this digest pass neither carried it to a findings surface, nor wrote it a Negative-results drop row, nor resolved it in a Disagreement-resolutions row` };
      return { reason: "digest:indeterminate", reason_source: "absent",
        detail: "this digest pass produced no readable carry for this placed record, so no verdict of its own can be read" };
    },
  });
}

/**
 * — THE SAME SET, PRINTED FORWARD INSTEAD OF READ BACKWARD.
 *
 * `recordSynthesisSeam` below computes "what was on the findings surface" AFTER the pass, to work out
 * what was dropped. This computes it BEFORE, so the stage can be handed the list and cite a record by
 * POSITION. The two must agree or `row_index` would point at a different record than the trace blames,
 * so the derivation is written once and called twice — never copied.
 *
 * Best-effort by construction: no placements on disk (a pre-B2 run, a matter with no register layer)
 * means an empty list, `ctx.findingsSurface` stays unset, and the dictation's DECLINATIONS block is
 * absent entirely. A stage handed no list is not ordered to answer one.
 */
function findingsSurfaceRows(P) {
  try {
    const placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
    const text = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
    // THE BAND JOIN, AND IT IS LOAD-BEARING RATHER THAN DECORATIVE. A placement carries no classes and no status. Both of
    // the tool's contradiction refusals rest on exactly those two fields, so a row built from the placement alone would
    // arrive with `classes: []` and `status: null`, every check would find nothing to contradict, and the tool would
    // accept every declination while looking like it was guarding them. A guard that cannot fire is worse than none,
    // because it reads as one. The band record is where the run's own class list and status live.
    const band = new Map();
    try {
      const b = safeReadJson(P.registerNamedBand);
      for (const rec of Array.isArray(b?.enumerated) ? b.enumerated : []) {
        const u = bandRecordUri(rec);
        if (u) band.set(String(u).toLowerCase(), rec);
      }
    } catch { /* an unreadable band leaves the refusals with nothing to rest on; see above */ }
    // THE WRITER IS OWED POSITIONS, NOT RECORDS. A position is one placement entry: an owner's mark with its records.
    // Every entry the write-up carried is owed, whatever its tier: a headline entry, a sheet-2 entry the write-up adopted
    // or kept, and one it promoted. An entry the write-up dropped carries its own ending and is not owed. A finding naming
    // any record of an entry ends it, or one declination of its row, which the report lists once among the set-asides.
    // The row is the entry's first live record, else its first; its records ride with it, and each one's classes and
    // status, for the refusals to read.
    const surfaces = parseCarrySurfaces(text);
    const rows = [];
    for (const e of Array.isArray(placements) ? placements : []) {
      const uris = entryUris(e);
      if (!uris.length || classifyPlacement(e, surfaces).class !== "carried") continue;
      const uri = uris.find((u) => band.has(u) && isLiveRecord(band.get(u))) ?? uris[0];
      const rec = band.get(uri);
      rows.push({
        uri, mark: e?.mark ?? null, owner: e?.owner ?? null, tier: e?.tier ?? null,
        classes: Array.isArray(rec?.classes) ? rec.classes : [],
        status: rec?.status ?? null,
        uris,
        ...(uris.length > 1 ? { members: uris.map((u) => ({ uri: u, mark: band.get(u)?.mark_text ?? e?.mark ?? null,
          classes: Array.isArray(band.get(u)?.classes) ? band.get(u).classes : [], status: band.get(u)?.status ?? null })) } : {}),
      });
    }
    return rows;
  } catch { return []; }
}

/**
 * Write the spec the `record_declination` tool reads, and hand the same list to the dispatch. BOTH sides
 * come from one call so the seat's `row_index` and the tool's offered list cannot disagree — the
 * `CLOSURE_EVIDENCE_FILES` lesson one transport over, where two copies of a positional list would have
 * verified every citation against the wrong file.
 *
 * `scope` is instructed-scope.json, JOB-authored before any model ran. It is the only thing the
 * contradiction refusals rest on, which is why it is read here rather than accepted from the seat.
 */
// THE WRITE-UP IS TOLD WHAT EACH RECORD'S GOODS REST ON, beside its position (goods-evidence.mjs `goodsFromLabel`),
// so a record declined on goods is declined knowing whether those goods were the official record's, a search answer's,
// cut, or none. Only the dispatch's copy carries it; the spec the declination tool reads is the positions alone.
// A list the label could not be added to keeps its lines as they were, and the run says so: a write-up handed no goods
// source must not read as one whose records have none.
export function withGoodsFrom(ctx, P, rows, read = null) {   // @internal — driven by its test with a run's own files
  const unlabelled = (reason) => {
    try { runLog(P.runDir, { event: "write-up-goods-from-failed", rows: rows.length, reason: String(reason).slice(0, 120) }); } catch { /* the list still goes */ }
    return rows;
  };
  try {
    const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
    if (!runPrefix) return unlabelled("the run has no session prefix to read its evidence by");
    const uris = rows.filter((r) => r?.kind !== "page" && r?.uri).map((r) => r.uri);
    const evidence = read ?? goodsEvidenceOfDrops(P, runPrefix, uris);
    return rows.map((r) => {
      const e = r?.kind !== "page" && r?.uri ? evidence.get(r.uri) : null;
      return e ? { ...r, goods_from: goodsFromLabel({ state: e.goods, source: e.source, question: e.question }) } : r;
    });
  } catch (e) { return unlabelled(e?.message ?? e); }
}

// THE TOOL IS TOLD WHAT EACH RECORD'S GOODS REST ON, from the same derivation (ruled 2026-10-27). A goods decision on a
// mark identical to the applied-for mark, live in a filed class, stands only where the run holds that record's goods
// complete, so the spec the declination tool judges carries each record's state, a position's members' included. A
// list the states could not be added to keeps its rows as they were: the refusal then reads no state and refuses, and
// the run says so.
export function withGoodsStates(ctx, P, rows, read = null) {   // @internal — driven by its test with a run's own files
  const unstated = (reason) => {
    try { runLog(P.runDir, { event: "declination-goods-states-failed", rows: rows.length, reason: String(reason).slice(0, 120) }); } catch { /* the list still goes */ }
    return rows;
  };
  try {
    const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
    if (!runPrefix) return unstated("the run has no session prefix to read its evidence by");
    const evidence = read ?? goodsEvidenceOfDrops(P, runPrefix, surfaceUris(rows));
    const state = (u) => evidence.get(u)?.goods ?? null;
    return rows.map((r) => (r?.kind === "page" || !r?.uri ? r : { ...r, goods: state(r.uri),
      ...(Array.isArray(r.members) ? { members: r.members.map((m) => ({ ...m, goods: state(m?.uri) })) } : {}) }));
  } catch (e) { return unstated(e?.message ?? e); }
}

/**
 * THE WRITER'S EXCLUSIONS, AS THE REVIEW IS TOLD THEM (ruled 2026-10-29). Every position placement put forward and the
 * writer was handed, at any tier, that ends in a declination rather than a finding: one entry per position, with
 * placement's tier and its whole reason (a borderline entry's competing readings live there), the writer's reason and
 * ground, the position's records for the band tools, and the floors it covers. The review used to be told only the
 * declinations that covered a floor, so a writer's exclusion of a headline candidate off the floors reached it as an
 * absence. Read from the run's files each time a message is built, like placement's decisions.
 *
 * "NONE" IS A CLAIM, SO IT IS EARNED. `state` is "listed", "none", "unreadable" or "no-positions". "none" means every
 * position handed to the writer is ended by a finding; an absent ledger is that answer only then, because a position
 * with no finding and no declination is a decision the record does not hold. An unreadable placements file, ledger or
 * findings file is "unreadable", never "none". "no-positions" is a run KNOWN to have handed the writer no position: its
 * placements file reads and carries none. A missing placements file is not that: placement runs on every clearance,
 * so its record is expected, and a missing one is "unreadable" (ruled 2026-10-30). A finding the report carries ends a
 * position whatever the ledger still holds; a withdrawn one ends only a position the writer never declined.
 *
 * `delivered` is every record the findings the report carries name, and `findings` each finding's owner and
 * fingerprint, withdrawn ones included, for a later review to establish from the findings themselves which exclusions a
 * finding now delivers and which a changed finding touches; both are null where the findings cannot be read.
 *
 * Each position's `evidence` fingerprints what the run holds of its records, by content (ruled 2026-10-30): each
 * record's band row with the register's answer as it came, the body the run holds for it, and the goods state the
 * writer's list was given. Status, classes and that state are not enough: a record's registered goods can be reworded while all three
 * stay the same, and a body obtained after the full review changes what an exclusion rests on. Only what the run
 * already holds is compared; nothing is fetched for it. IMPURE.
 */
export function writerExclusions(P) {   // @internal — driven by its test with a run's own files
  const empty = (state) => ({ state, positions: [], undecided: 0, delivered: null, findings: null });
  try {
    if (!P?.placementModel || !existsSync(P.placementModel)) return empty("unreadable");
    let placements;
    try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; } catch { return empty("unreadable"); }
    const rows = findingsSurfaceRows(P);
    if (!rows.length) return empty("no-positions");
    const key = (u) => String(normalizeRecordUri(u) ?? "");
    const declined = readDeclinations(P.runDir);
    if (existsSync(declinationCallPaths(P.runDir, 0).ledger) && !declined.present) return empty("unreadable");
    let delivered, withdrawn, findings;
    try {
      const found = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"))?.findings ?? [];
      [delivered, withdrawn] = [true, false].map((live) => new Set([...findingUris(found.filter((f) => (f?.disposition !== "withdrawn") === live)).keys()].map(key)));
      // Each finding as the writer numbered it. A later review's comparison and a ground's "finding 9" both read the
      // writer's numbering, and from the delivery seam on findings.json is the folded, renumbered record (record-fold.mjs).
      const modelAt = modelRecordPath(P.runDir, P.findings);
      const own = modelAt === P.findings ? found : (parseFindingsJsonLenient(readFileSync(modelAt, "utf8"))?.findings ?? []);
      findings = own.map((f) => ({ ordinal: f?.ordinal ?? null, owner: String(f?.owner?.name ?? f?.owner_name ?? (typeof f?.owner === "string" ? f.owner : "") ?? ""),
        fp: createHash("sha256").update(JSON.stringify(f ?? null)).digest("hex").slice(0, 16) }));
    } catch { return empty("unreadable"); }
    // The goods state each record was given on the writer's list, where the list carries one.
    const goodsOf = new Map();
    for (const r of safeReadJson(paths(P.runDir).declinationSpec)?.rows ?? [])
      for (const m of [r, ...(Array.isArray(r?.members) ? r.members : [])]) if (m?.uri) goodsOf.set(key(m.uri), m.goods ?? null);
    const bandOf = new Map();
    for (const row of rows) for (const m of (Array.isArray(row?.members) && row.members.length ? row.members : [row])) bandOf.set(key(m?.uri), m);
    const entryOf = new Map();
    for (const e of Array.isArray(placements) ? placements : []) for (const u of entryUris(e)) entryOf.set(key(u), e);
    const floors = safeReadJson(P.bandShape)?.floors?.in_class_identical_or_near;
    const floorIds = new Set((Array.isArray(floors) ? floors : []).map((f) => key(f?.record_id)).filter(Boolean));
    const positions = [];
    let undecided = 0;
    for (const row of rows) {
      const members = [...new Set((Array.isArray(row?.uris) && row.uris.length ? row.uris : [row?.uri]).map(key).filter(Boolean))];
      if (members.some((u) => delivered.has(u))) continue;
      const d = declined.byUri.get(key(row?.uri));
      if (!d) { if (!members.some((u) => withdrawn.has(u))) undecided++; continue; }
      const e = entryOf.get(key(row?.uri)) ?? null;
      positions.push({ uri: key(row.uri), members, mark: e?.mark ?? row.mark ?? null, owner: e?.owner ?? row.owner ?? null,
        tier: e?.tier ?? row.tier ?? null, borderline: e?.borderline === true, reason: e?.reason ?? null,
        writerReason: d.reason ?? null, grounds: d.grounds ?? null, floors: members.filter((u) => floorIds.has(u)),
        // The findings its ground cites, as the ledger recorded them, or read from the ground of an entry written before
        // the ledger recorded them: the writer's own number, never a name.
        cites: Array.isArray(d.cites) ? d.cites : citedFindingNumbers(d.grounds, { bare: false }) });
    }
    // WHAT EACH EXCLUSION RESTS ON, read for its own records only.
    const band = new Map();
    for (const r of safeReadJson(P.registerNamedBand)?.enumerated ?? []) if (r?.record_id) band.set(key(r.record_id), r);
    const bodies = heldBodiesOf(P.runDir, positions.flatMap((p) => p.members));
    for (const p of positions) p.evidence = createHash("sha256").update(stableStringify(p.members.map((u) => ({ uri: u,
      record: recordContent(band.get(u) ?? bandOf.get(u)), body: bodies.get(u) ?? null, goodsState: goodsOf.get(u) ?? null }))))
      .digest("hex").slice(0, 16);
    return { state: undecided ? "unreadable" : positions.length ? "listed" : "none", positions, undecided, delivered, findings };
  } catch { return empty("unreadable"); }
}

// A band row as the record it stands for: the register's fields and its answer as it came (`raw`, which holds the goods
// wording on every register). What the run adds to it (the questions that found it, how a search scored it, the
// screen's reading) is left out, so the same record found by another question reads alike. The band keeps the first
// copy of each record (named-band.mjs mergeNamedBands), so a later search does not swap its answer.
const SEARCH_SIDE = new Set(["screen", "relevance_score", "match"]);
const recordContent = (row) => (row && typeof row === "object"
  ? Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_") && !SEARCH_SIDE.has(k))) : null);

/** One position's entry, as the review reads it. PURE. */
export const writerExclusionLine = (x) => `- ${x.mark ?? "(unnamed)"}${x.owner ? ` — ${x.owner}` : ""} (${x.members.join(", ")}): `
  + `placement: ${x.tier ?? "(no tier)"}${x.borderline ? ", borderline" : ""} — ${x.reason ?? "(no reason recorded)"}; `
  + `excluded by the writer as ${x.writerReason}: ${x.grounds}`
  + (x.floors.length ? `; covers the floor${x.floors.length > 1 ? "s" : ""} ${x.floors.join(", ")}` : "")
  + (x.revisedCites?.length ? revisedCitesNote(x.revisedCites) : "");

// THE CONNECTION A GROUND RECORDS, NAMED (2026-10-30). An exclusion whose ground cites a finding that changed after the
// full review is a decision the later review checks, and its entry says which finding. Model-facing: the later review
// reads it, and only on such an entry.
export const revisedCitesNote = (ords) => `; that ground cites ${ords.length === 1 ? `finding ${ords[0]}`
  : `findings ${ords.slice(0, -1).join(", ")} and ${ords[ords.length - 1]}`}, which changed after the full review`;

/** A position the full review read as excluded that a finding now delivers, as a later review reads it. PURE. */
export const withdrawnExclusionLine = (x) => `- ${x.mark ?? "(unnamed)"}${x.owner ? ` — ${x.owner}` : ""} (${(x.members ?? [x.uri]).join(", ")}): excluded at the full review, now delivered as a finding`;

/** What the full review was shown, kept for the reviews after it; and what the last review was shown, for its flags. */
export const reviewExclusionsPaths = (P) => ({ full: paths(P.runDir).reviewExclusionsFull, shown: driverDir(P.runDir, REVIEW_EXCLUSIONS_FILE) });

/**
 * THE LIST A REVIEW IS GIVEN, and the record of it. The full review gets every exclusion. A later review (the recheck
 * after a correction, the review after a delivery-check repair) starts a fresh session, so it is given every exclusion
 * too, each once, in two parts (ruled 2026-10-30). First the decisions it is checking: the exclusions whose own
 * sentence, placement's reason or tier, or records' evidence changed since the full review, the ones touched by a
 * finding about the same owner that changed, the ones whose ground cites a finding that changed (its entry names it),
 * the ones its own flags named, and the ones a finding now delivers. Then,
 * under the ruled reference sentence, the other accepted exclusions with their recorded grounds and ids, a floor's
 * among them: it reconsiders one only where a change it identified affects its grounds. With no full review on record,
 * or a record it cannot read, a later review gets the whole list as decisions to check.
 * An exclusion the full review read is said to be delivered only where a current finding names one of its records,
 * never because it left the list.
 *
 * THE RESEARCH THE RUN OBTAINED AFTER THE FULL REVIEW rides beside them (ruled 2026-10-30): every answer the run did not
 * hold, with that text, when the full review's list was built, written to `research-after-review.md`. No record links an
 * answer to an exclusion, so none is joined to one here, and no exclusion is counted changed because research changed:
 * the reviewer judges the connection from the answers and the grounds. The review's own questions are its check, not
 * evidence the writer's grounds rest on, so they are left out.
 *
 * `{state, review, lines, reference, research, changedOnly}`; the review's flags are checked against
 * `review-exclusions.json`. IMPURE.
 */
export function writerExclusionBlock(P, { review = "full", named = [] } = {}) {   // @internal
  const x = writerExclusions(P);
  const at = reviewExclusionsPaths(P);
  const held = runResearchAnswers(P.runDir, { except: reviewSession });
  let shown = x.positions, reference = [], changedOnly = false, withdrawn = [], research = 0;
  if (review !== "full" && x.state !== "unreadable") {
    const full = safeReadJson(at.full);
    if (Array.isArray(full?.positions)) {
      const before = new Map(full.positions.map((p) => [p.uri, p]));
      const names = new Set(named.map((u) => String(normalizeRecordUri(u) ?? "")));
      const touched = changedFindingOwners(full.findings, x.findings);
      const revised = changedFindingOrdinals(full.findings, x.findings);
      const restsOn = (p) => (Array.isArray(p.cites) ? p.cites : []).filter((o) => revised.has(o));
      const changed = (p, b) => !b || b.writerReason !== p.writerReason || b.grounds !== p.grounds || b.reason !== p.reason
        || b.tier !== p.tier || Boolean(b.borderline) !== Boolean(p.borderline) || (b.evidence ?? null) !== (p.evidence ?? null);
      const checked = (p) => names.has(p.uri) || changed(p, before.get(p.uri)) || touched.has(ownerKey(p.owner)) || restsOn(p).length > 0;
      shown = x.positions.filter(checked).map((p) => (restsOn(p).length ? { ...p, revisedCites: restsOn(p) } : p));
      reference = x.positions.filter((p) => !checked(p));
      const now = new Set(x.positions.map((p) => p.uri));
      withdrawn = full.positions.filter((p) => p?.uri && !now.has(p.uri) && (p.members ?? [p.uri]).some((u) => x.delivered?.has(u)));
      changedOnly = true;
      // A record from before the answers were kept is read by time: what the run obtained after it was written.
      const had = Array.isArray(full.research) ? new Set(full.research) : null;
      research = handResearchAfterReview(P.runDir, held.filter((a) => (had ? !had.has(researchAnswerKey(a)) : a.ts > String(full.ts ?? ""))));
    }
  }
  if (review === "full") handResearchAfterReview(P.runDir, []);
  try {
    ensureDriverDir(P.runDir);
    const record = JSON.stringify({ ts: new Date().toISOString(), review, state: x.state, positions: x.positions, findings: x.findings,
      research: held.map(researchAnswerKey), shown: shown.map((p) => p.uri), reference: reference.map((p) => p.uri) }, null, 2) + "\n";
    if (review === "full") atomicWrite(at.full, record);
    atomicWrite(at.shown, record);
  } catch (e) { runLog(P.runDir, { event: "review-exclusions-write-failed", reason: String(e?.message ?? e).slice(0, 160) }); }
  return { state: x.state, review, lines: [...shown.map(writerExclusionLine), ...withdrawn.map(withdrawnExclusionLine)],
    reference: reference.map(writerExclusionLine), research, changedOnly };
}
/** A session of the review itself, under its stage key, a retry of it, or an experiment arm's key for it. PURE. */
const reviewSession = (s) => /-narrative-refutation(?=$|-)/.test(String(s ?? ""));
/** An owner's name as two records of it are compared: trimmed, spaced once, in any case. PURE. */
const ownerKey = (o) => String(o ?? "").replace(/\s+/g, " ").trim().toLowerCase();
/** The ordinals of the findings that changed between two readings, in the writer's numbering: added, removed or
 *  rewritten. Empty where either reading is missing, so a record from before findings were kept changes nothing. PURE. */
export function changedFindingOrdinals(before, after) {   // @internal
  const out = new Set();
  if (!Array.isArray(before) || !Array.isArray(after)) return out;
  const a = new Map(before.map((f) => [f?.ordinal, f])), b = new Map(after.map((f) => [f?.ordinal, f]));
  for (const o of new Set([...a.keys(), ...b.keys()])) if (a.get(o)?.fp !== b.get(o)?.fp) out.add(o);
  return out;
}
/** The owners of those findings, on either reading. PURE. */
export function changedFindingOwners(before, after) {   // @internal
  const out = new Set();
  const a = new Map((before ?? []).map((f) => [f?.ordinal, f])), b = new Map((after ?? []).map((f) => [f?.ordinal, f]));
  for (const o of changedFindingOrdinals(before, after))
    for (const f of [a.get(o), b.get(o)]) if (ownerKey(f?.owner)) out.add(ownerKey(f.owner));
  return out;
}
/** Every record a list of the writer's rows names, a position's members included. PURE. */
const surfaceUris = (rows) => [...new Set(rows.filter((r) => r?.kind !== "page" && r?.uri)
  .flatMap((r) => [r.uri, ...(Array.isArray(r.members) ? r.members.map((m) => m?.uri).filter(Boolean) : [])]))];
/**
 * What the goods of the writer's records rest on, READ ONCE for the labels its message carries and the states its tool
 * judges: the read walks the run's held records, which run to hundreds of megabytes, and took half a minute a pass on a
 * test run. null where it cannot be read; each reader then reads for itself and says so as before. IMPURE.
 */
function surfaceGoodsEvidence(ctx, P, rows) {
  try {
    const runPrefix = ctx.run?.slug && ctx.run?.codename ? `clearance-${ctx.run.slug}-${ctx.run.codename}-` : null;
    return runPrefix ? goodsEvidenceOfDrops(P, runPrefix, surfaceUris(rows)) : null;
  } catch { return null; }
}

export function prepareDeclinationSpec(ctx, P) {   // @internal
  const rows = [...findingsSurfaceRows(P), ...notesPageRows(existsSync(P.commonLaw) ? readFileSync(P.commonLaw, "utf8") : null)];   // records, then the web notes' pages
  if (!rows.length) {
    // AN EMPTY LIST REPLACES THE LAST ONE; it does not leave it standing. The recorder holds the seat to
    // whatever list the spec file carries, and a repair or corrective pass re-prepares because the
    // findings may have moved. Left in place, a list from an earlier pass would bind a pass whose own
    // prompt carries none: the order enforced, and missing from the prompt.
    try { rmSync(paths(P.runDir).declinationSpec, { force: true }); } catch { /* absent is the goal */ }
    delete ctx.findingsSurface;
    return;
  }
  let scope = {};
  try { scope = JSON.parse(readFileSync(P.instructedScope, "utf8")) ?? {}; } catch { scope = {}; }
  try {
    ensureDriverDir(P.runDir);
    const read = surfaceGoodsEvidence(ctx, P, rows);
    atomicWrite(paths(P.runDir).declinationSpec,
      JSON.stringify({ ts: new Date().toISOString(), rows: withGoodsStates(ctx, P, rows, read), scope: { marks: scope.marks ?? [], classes: scope.classes ?? [] } }, null, 2) + "\n");
    ctx.findingsSurface = withGoodsFrom(ctx, P, rows, read);
  } catch (e) {
    // The dispatch block is gated on ctx.findingsSurface, so a failed write leaves the stage UNORDERED
    // rather than ordered to call a tool whose spec it cannot read. Loud in the log, never a dead order.
    note(`declination-spec write failed (non-fatal): ${e.message} — synthesis runs without the declination order this pass`);
  }
}

/**
 * SYNTHESIS. The records the digest carried onto a findings surface were in front of this pass; what it
 * delivered is findings.json. Read with the LENIENT parser, deliberately: the strict one returns nothing
 * on a fenced or prose-wrapped file, and a synthesis pass whose output is merely untidy would otherwise
 * record every record it delivered as discarded — the defect rebuilt one seam later.
 */
/** Where the ranking the writer last read is kept, for the sentence on records re-ranked after it wrote. */
const rankingReadByWriterPath = (P) => paths(P.runDir).rankingReadByWriter;
/** Keeps where each record stood when a writer's pass completed. Never throws. */
function keepRankingReadByWriter(P) {
  try { atomicWrite(rankingReadByWriterPath(P), JSON.stringify(rankingToJson(rankingNow(P)), null, 2) + "\n"); }
  catch (e) { runLog(P.runDir, { event: "ranking-read-by-writer-failed", reason: String(e?.message ?? e).slice(0, 160) }); }
}

export function recordSynthesisSeam(ctx, r, trigger = null) {   // @internal — driven by its test with a run's own files
  const P = ctx.paths;
  if (r?.ok) keepRankingReadByWriter(P);   // where each record stood as this writer read it
  const declined = readDeclinations(P.runDir);   // — three-valued: absent ledger ≠ empty ledger
  // — ONE DERIVATION, and it is CALLED rather than copied. This used to rebuild the carried set
  // inline, in three lines that happened to match `findingsSurfaceRows`'s. They must match: that function
  // prints the list the seat cites BY POSITION, and this one decides which records the trace blames, so a
  // divergence would silently point `row_index` at a different record than the one recorded. Two copies
  // that agree today is exactly the shape this repo keeps paying for.
  const saw = findingsSurfaceRows(P);
  if (!saw.length) return null;
  let delivered = [];
  try {
    if (existsSync(P.findings)) {
      const parsed = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
      for (const [uri] of findingUris(parsed.findings ?? [])) delivered.push({ uri });
    }
  } catch { /* validators.findings' business; this seam records what it can */ }
  // A POSITION IS SEEN WHOLE AND ENDS WHOLE. Each row the writer was handed is a position, one placement entry: every
  // record of it was seen. A record a finding names is carried. A finding naming any record of a position delivers it,
  // and its other records end with it on that ground; the row's declination is each record's. Only a named record
  // reads as carried, because the trace holds a carried record to a finding that names it.
  const key = (u) => String(normalizeRecordUri(u) ?? "");
  const deliveredKeys = new Set(delivered.map((d) => key(d.uri)));
  const rowOf = new Map(), namedWith = new Map();
  const sawRecords = [];
  for (const row of saw) {
    const members = Array.isArray(row?.uris) && row.uris.length ? row.uris : [row?.uri];
    const named = members.find((u) => deliveredKeys.has(key(u)));
    for (const u of members) {
      sawRecords.push({ ...row, uri: u });
      rowOf.set(key(u), row?.uri);
      if (named) namedWith.set(key(u), named);
    }
  }
  return recordSeamDiscards(ctx, {
    seam: "synthesis", stage: "synthesis", trigger, completed: r?.ok === true && !r?.skipped, skipped: r?.skipped === true,
    saw: sawRecords, carried: delivered,
    evidence: r?.fail ? String(r.fail).slice(0, 80) : "",
    reasonFor: (rec, uri) => {
      const named = namedWith.get(key(uri));
      if (named) return { reason: "synthesis:delivered-with-its-position", reason_source: "step-stated",
        detail: `delivered with its position: a finding names ${named}, another record of the same placement entry` };
      // — THE 102. This callback used to be zero-arity and constant: every record this pass
      // discarded got the same sentence and `step-silent`, whatever it was. One of them was KORPHIC,
      // a lawyer-named gold mark placed on sheet-2 and stamped `carry: "carried"`, and the trace could
      // say only that synthesis had not delivered it. The sibling seam one stage earlier
      // (`recordDigestSeam`) has read its stage's own output per record since it was written; this one
      // had nothing to read until `record_declination` gave synthesis somewhere to say it.
      // The judgment itself is `seamReasonFor`, pure and next door, so the guarantee has an arm
      // that does not need a run directory. This callback is now only the plumbing around it.
      return seamReasonFor(declined, rowOf.get(key(uri)) ?? uri);
    },
  });
}

// ── HALF TWO — the join, AFTER findings.json exists ──────────────────────────────────────────
// `findings` is passed in rather than read here so the caller proves it has them. The previous version
// read the file itself, from inside register-digest, which runs BEFORE synthesis authors it — so it
// joined against `[]` and reported every record that became a finding as dropped.
export function deriveRecordCarry(ctx, trigger, { findings = null } = {}) {   // @internal — exported for its CALL-SITE test ( leg b)
  const P = ctx.paths;
  const write = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      atomicWrite(P.recordCarry, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact }, null, 2) + "\n");
    } catch (e) { note(`record-carry artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  const notComputable = (reason) => {
    write({ schema_version: RECORD_CARRY_SCHEMA_VERSION, computable: false, reason });
    runLog(P.runDir, recordCarryEvent({ trigger, reason }));
    return null;
  };
  try {
    if (!existsSync(P.registerNamedBand)) return notComputable("no register-named-band.json (nothing was retrieved, or a run predating the named band)");
    const band = safeReadJson(P.registerNamedBand);
    if (!band) return notComputable("register-named-band.json unreadable");
    let placements = [];
    if (existsSync(P.placementModel)) {
      // a malformed mirror is validators.placement's business; here it means every placed record
      // reads trace:indeterminate rather than the trace refusing to run at all
      try { placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; } catch { /* noted by its own validator */ }
    }
    // THE FINDINGS THIS JOINS AGAINST. Passed in by a caller that has them; read here with the LENIENT
    // parser only as the fallback, never with `safeReadJson`. The strict read was the second way this
    // artifact reached the same wrong answer: a fenced or prose-wrapped findings.json parsed to null,
    // `?? ` turned that into "no findings", and every delivered record read as dropped — the
    // defect by a different route, on a file the run had already recovered elsewhere.
    let deliveredFindings = Array.isArray(findings) ? findings : null;
    if (!deliveredFindings) {
      try { deliveredFindings = existsSync(P.findings) ? (parseFindingsJsonLenient(readFileSync(P.findings, "utf8")).findings ?? []) : []; }
      catch { deliveredFindings = []; }
    }
    const artifact = traceRecordCarry({
      bandRecords: Array.isArray(band?.enumerated) ? band.enumerated : [],
      crowds: Array.isArray(band?.crowds) ? band.crowds : [],
      placements,
      registerFindingsText: existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "",
      findings: deliveredFindings,
      outcomes: parseStageOutcomes(safeReadText(paths(P.runDir).run)),
      planExecution: safeReadJson(paths(P.runDir).planExecution),
      ledger: foldDiscardLedger(safeReadText(driverDir(P.runDir, DISCARD_LEDGER_NAME))),
      // — read the sibling traces OFF DISK rather than threading state through the run: what is
      // on disk at publish is exactly what this run produced, and a declaration derived from anything
      // else can go stale the way the hand-kept constant did.
      siblings: [P.commonLawCarry, P.jxZhCarry].map((f) => safeReadJson(f)).filter(Boolean),
    });
    write(artifact);
    runLog(P.runDir, recordCarryEvent({ trigger, artifact }));
    const t = artifact.totals;
    // ── THE RECONCILIATION RATCHET ────────────────────────────────────────────────────────────
    //
    // RECORDED ON EVERY RUN, tripping only against the committed floor. Both halves are deliberate:
    // a gate that fires on every current run teaches its reader that red means nothing (the whole
    // complaint), and a warning that never bites is decoration. The floor is what the contract achieves
    // today, dated and seeded from a delivered round, and it moves UP when the seat-compliance work
    // lands.
    //
    // ANNOTATES, NEVER SUPPRESSES — the deliverable ships first, exactly like the three notes above.
    // Below-floor means the ROUND cannot claim the contract held; it never means a client gets nothing.
    try {
      const v = reconciliationVerdict(artifact, COMMONLAW_CARRY_FLOOR);
      // NO `slice` FIELD, AND ITS ABSENCE IS THE FIX. shipped this object naming a bare `slice`
      // identifier that has never been bound: deriveRecordCarry takes (ctx, trigger, {findings}) and is
      // called once, at publish, over the whole artifact — there is no slice here to name. The
      // ReferenceError fired on THIS line, the catch below turned it into "verdict failed (non-fatal)",
      // and so the ratchet exists to run has never recorded once. If a PER-SLICE ratchet was the
      // intent, that is a design question for, not something to infer from a stray identifier.
      runLog(P.runDir, { event: "commonlaw-reconciliation", state: v.state,
        candidates_rate: v.rates.candidates.rate, candidates: v.rates.candidates.reconciled, retrieved: v.rates.candidates.retrieved,
        cells_rate: v.rates.cells.rate, cells_rowed: v.rates.cells.rowed, cells_candidate_bearing: v.rates.cells.candidate_bearing,
        trips: v.trips.map((t) => t.metric), floor_date: COMMONLAW_CARRY_FLOOR?.seeded?.date ?? null });
      // The human-read sink, not only the field (/E11): a rate in run.jsonl that never reaches a
      // sentence is a discriminator nobody sees.
      const pct = (r) => (r == null ? "n/a" : `${(r * 100).toFixed(1)}%`);
      if (v.state === "below-floor") {
        for (const t of v.trips) {
          note(`commonlaw-reconciliation: BELOW FLOOR — ${t.label} is ${pct(t.got)}, floor ${pct(t.floor)}`
            + ` (seeded ${COMMONLAW_CARRY_FLOOR?.seeded?.date ?? "?"}). The report still ships; the ROUND cannot claim`
            + " the carry contract held. See driver/commonlaw-carry-floor.json");
        }
      } else if (v.state === "at-or-above-floor") {
        note(`commonlaw-reconciliation: ${pct(v.rates.candidates.rate)} of ${v.rates.candidates.retrieved} candidate(s) reconciled,`
          + ` ${pct(v.rates.cells.rate)} of ${v.rates.cells.candidate_bearing} candidate-bearing cell(s) carry their negative row — at or above the floor`);
      }
    } catch (e) {
      // ── — THIS CATCH BOUGHT TWO MONTHS OF SILENCE, TWO WAYS ─────────────────────────────
      //
      // 1. IT LAUNDERED A PROGRAMMING ERROR INTO A DOMAIN OUTCOME. `slice is not defined` left here as
      //    "verdict failed (non-fatal)" — the sentence a malformed artifact would also produce. A reader
      //    seeing it has no way to tell "the ratchet ran and could not judge" from "the ratchet has never
      //    run". Ten pool traversals, ten failures, zero successes, and nobody could see it.
      // 2. IT REPORTED ONLY TO STDERR. `note()` in `log.mjs` is stderr-only. Nothing reached run.jsonl,
      //    the run dir, or any audited artifact — so no consumer we have could ever have noticed.
      //
      // ReferenceError is the ONLY hard discriminator, and the narrowness is deliberate. TypeError is
      // NOT a programming error here: `v.rates.candidates.rate` on a malformed artifact throws one, and
      // that is a genuine domain failure. Classing it as a bug would commit this catch's own substitution
      // in the opposite direction. Anything beyond ReferenceError gets classified by SHAPE, named at the
      // site, never by constructor.
      const bug = e instanceof ReferenceError;
      runLog(P.runDir, {
        event: bug ? "commonlaw-reconciliation-bug" : "commonlaw-reconciliation-failed",
        error: e?.name ?? "Error", detail: String(e?.message ?? e).slice(0, 200),
        floor_date: COMMONLAW_CARRY_FLOOR?.seeded?.date ?? null,
      });
      note(bug
        ? `commonlaw-reconciliation: DRIVER BUG — ${String(e?.message ?? e).slice(0, 80)}. The ratchet did not run; this is our code, not the artifact. Recorded as commonlaw-reconciliation-bug in run.jsonl.`
        : `commonlaw-reconciliation: verdict failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`);
    }

    if (artifact.degenerate) {
      // The self-check firing. On the run that motivated the issue this was true and silent.
      note(`record-carry: DEGENERATE — findings.json names ${artifact.delivered_findings} finding(s) and this trace says NOT ONE`
        + " retrieved register record became one. Those are statements about the same records, so the TRACE is wrong,"
        + " not the run's recall. Do not quote drop counts from this artifact");
    }
    if (artifact.basis !== "recorded") {
      note(`record-carry: basis=${artifact.basis} — no per-seam discard ledger was present, so every ending in this`
        + " trace was INFERRED by comparing artifacts after the fact rather than recorded by the step that decided it."
        + ` Expected on a run archived before #420; on a fresh run it means no seam wrote to _driver/${DISCARD_LEDGER_NAME}`);
    }
    if (t.unreasoned) {
      note(`record-carry: ${t.unreasoned} of ${t.retrieved} retrieved register record(s) were dropped with NO step recording a ground`
        + ` — each ships as an OPEN doubt; see _driver/record-carry.json .unreasoned. This annotates, it does not re-judge or block`);
    }
    // item 3 — THE SILENCE AT THE READER SURFACE, narrower than `unreasoned` above and reported
    // separately because the two are different claims. `unreasoned` counts every retrieved record with no
    // ground, at any depth; this counts only records a reader surface ALREADY CARRIED, where a decline is
    // a judgment rather than a filter. On the round that motivated this issue the wide number was 0 and
    // this one was 102 — the wide check read clean while a lawyer-named mark sat in the narrow one.
    try {
      const surfaceDuty = reconcileSurfaceDuty({ rows: artifact.rows });
      try {
        atomicWrite(P.surfaceDuty, JSON.stringify({ ts: new Date().toISOString(), trigger, ...surfaceDuty }, null, 2) + "\n");
      } catch (e) { note(`surface-duty artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
      if (surfaceDuty.tripped) note(surfaceDutyNote(surfaceDuty));
    } catch (e) { note(`surface-duty: not computed (${String(e?.message ?? e).slice(0, 80)})`); }
    if (t.upstream_absent) {
      note(`record-carry: ${t.upstream_absent} of ${t.retrieved} retrieved register record(s) were dropped because an upstream stage never completed`
        + ` (${artifact.incomplete_stages.join(", ")}) — NOT because any judgment step rejected them. Any output those stages left is partial`);
    }
    // — GATED ON THE SLICES, NOT ON THE HIT SUM. A refused slice contributes ZERO untraced
    // hits (the executor writes total_hits:0 beside its error stamp), so `if (t.untraced_hits)` went
    // silent on exactly the runs worth telling an operator about: a register round whose provider
    // refused every slice has untraced_hits 0 and printed nothing at all. And "count-only" was the
    // wrong word for the whole population — some of these were never counted.
    if (t.untraceable_slices) {
      note(`record-carry: ${t.untraceable_slices} slice(s) have NO per-record trace at all`
        + (t.untraced_hits ? `, carrying ${t.untraced_hits} hit(s) that were counted and never fetched` : "")
        + " — see .untraceable_slices, whose per-slice reason says whether each was counted-not-fetched or never answered at all");
    }
    // ALWAYS, even on a run with nothing to report: the boundary is what stops the zeros above being
    // read as "nothing was dropped anywhere". A path that emits no rows must say it emitted none.
    note(`record-carry: traced ${t.retrieved} record(s) on the REGISTER path only`
      + ` — no rows are emitted for ${(artifact.scope?.uninstrumented ?? []).map((u) => u.path).join(", ")},`
      + " so this trace is SILENT about drops on those paths rather than clearing them");
    return artifact;
  } catch (e) {
    runLog(P.runDir, { event: "record-carry-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`record-carry derivation failed (non-fatal — disclosure only): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

// ── — the common-law path's trace, and the jx zh slice on the same tracer ────────────────────
//
// A SIBLING of deriveRecordCarry, deliberately. The register path joins on a canonical `/mark` uri; a
// common-law candidate has no uri at all — it carries `{title, url}` and nothing else — so this joins on
// the canonicalised URL plus the structural cell key. The house URL normalizer is rejected on evidence:
// it discards the query, and on the real 2026-07-29 grid it collapses 143 URLs to 139 keys and merges two
// DIFFERENT Play Store apps. That collision concentrates in the non-Latin population this exists for,
// because a Han-script marketplace query returns `?q=…` search URLs.
//
// This is the path that lost WAVO TWIST and WAVO TROPICS on R3 — both sat in the run's own records and
// reached no findings list. It has already cost a round.
//
// Derived at publish, like the register trace and for the same reason: everything it joins is final by
// then. Disclosure only — annotate, never gate.
// ── part 2 — ONE READ OF THE ORDERED CHANNEL LIST, USED AT BOTH SEAMS ────────────────────────
//
// established the source and its reason: the plan is `_driver/grid-spec.json`'s `platforms`, NOT
// `ctx.profile.platforms`. The two diverge on a generic profile, where the channels come from the matter
// frame's `Search channels:` line — reading the profile would compare the grid against a plan the grid
// was never given, silently, on exactly the regulated matters the fallback exists to serve.
//
// It is a function now because there are two callers: the publish-time carry trace, and the stage-exit
// check below. Two copies of a rule this specific is how one of them ends up reading the profile again.
//
// ABSENT ⇒ null ⇒ "unknown", never a clean 1. A register-only run and a run whose grid spec never landed
// both genuinely cannot say what was ordered, and a coverage question that was never asked must not
// answer itself in the affirmative.
function plannedChannelsFor(P) {
  try {
    if (!existsSync(P.gridSpec)) return null;
    const spec = JSON.parse(readFileSync(P.gridSpec, "utf8"));
    return Array.isArray(spec?.platforms) && spec.platforms.length ? spec.platforms : null;
  } catch (e) {
    note(`commonlaw-carry: grid spec unreadable, channel coverage stays unknown (${String(e?.message ?? e).slice(0, 60)})`);
    return null;
  }
}

// ── part 2 — THE CHANNEL COMPARISON, AT SEARCH-STAGE EXIT ────────────────────────────────────
//
// Part 1 shipped the comparison and wired the plan into it (), and it runs at PUBLISH —
// where the rest of the carry trace is derived, about two hours after the sweep it describes. The issue
// asked whether plan-vs-executed is knowable earlier. It is: the merged grid has just been written and
// the spec has been on disk since dispatch, so both inputs exist at this instant and neither changes.
//
// So this reports a coverage hole while the run can still act on it, instead of after delivery.
//
// IT ANNOTATES AND DOES NOT GATE, deliberately. A profile legitimately lists a platform a given grid
// skipped, so promoting this to a floor on arrival is the shape — a grammar killing paid work.
// The publish-time artifact remains the record; this is the early word, and the two derive from the same
// function over the same two inputs, so they cannot disagree about what was ordered.
//
// THE `unknown` STATE SURVIVES THE MOVE, which is the whole point rather than a detail: this seam runs
// on runs whose spec never landed, and those must say they cannot answer rather than score clean.
function noteChannelCoverageAtStageExit(P, mergedGrid) {
  try {
    const channels = planVsExecutedChannels({
      planned: plannedChannelsFor(P),
      cells: mergedGrid?.cells ?? [],
      gaps: mergedGrid?.gaps ?? [],
    });
    runLog(P.runDir, { event: "channel-coverage", at: "search-stage-exit", ...channels });
    if (channels.state === "unknown")
      note(`channel coverage: UNKNOWN at grid exit — ${channels.why}`);
    else if (channels.never_searched?.length)
      note(`channel coverage: ${channels.never_searched.length} planned channel(s) never searched — ${channels.never_searched.join(", ")} (reported, not gated: #1066)`);
  } catch (e) {
    // A coverage NOTE that fails a run it is only describing is worse than the gap it reports.
    note(`channel coverage at grid exit could not be computed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`);
  }
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

function deriveRecallReconciliation(ctx, trigger) {
  const P = ctx.paths;
  const writeArtifact = (artifact) => {
    try {
      ensureDriverDir(P.runDir);
      // ROUND-2 FIX (review problem 5) — the followup RECEIPT survives the re-derive. This write is a
      // full replace and its payload has no `followup` key, so the very next read of it (the attempt
      // counter in enforceRecallReconciliation) always saw null: `attempts` was pinned at 0 and
      // RECALL_FOLLOWUP_MAX could never engage — every digest pass, including every skip-resume,
      // bought another full warm digest turn over the whole band while unended > 0. Carrying the key
      // forward here (not at the call site) covers all three callers of deriveRecallReconciliation.
      const carried = carryRecallFollowup(safeReadJson(P.recallReconciliation), artifact);
      atomicWrite(P.recallReconciliation, JSON.stringify({ ts: new Date().toISOString(), trigger, ...artifact, ...carried }, null, 2) + "\n");
    } catch (e) { note(`recall-reconciliation artifact write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
  };
  try {
    const notComputable = (reason) => {
      writeArtifact({ schema_version: RECALL_RECONCILIATION_SCHEMA_VERSION, computable: false, reason });
      // AD-4 house rule (review problem 8) — ONE row builder for both branches, every field written
      // unconditionally: "the gate found nothing unended" (unended:0) and "the gate could not run"
      // (unended:null) must be distinguishable by VALUE, never by field presence.
      runLog(P.runDir, recallReconciliationEvent({ trigger, reason }));
      return null;
    };
    if (!existsSync(P.registerNamedBand)) return notComputable("no merged register band");
    if (!existsSync(P.registerFindings)) return notComputable("no register findings file");
    let dominantElement = null;
    try { dominantElement = parseVariantManifestModel(readFileSync(P.variantManifestModel, "utf8")).dominant_element; }
    catch { /* prose-only manifest */ }
    if (!dominantElement) return notComputable("no structured dominant element (prose-only manifest)");
    let inScopeClasses = [];
    try { inScopeClasses = inScopeClassList(ctx.job, ctx.profile).map(String); }
    catch { inScopeClasses = (ctx.job?.classes ?? []).map(String); }
    const band = JSON.parse(readFileSync(P.registerNamedBand, "utf8"));
    const candidates = dominantElementComposites(band, { dominantElement, inScopeClasses });
    if (candidates === null) return notComputable("dominant element yields no comparable Latin skeleton");
    const endings = parseFindingsEndings(readFileSync(P.registerFindings, "utf8"));
    const crowdRulings = parseCrowdRulings(loadCoverageLedger(P.runDir).rows);
    // ROUND-2 FIX (review problem 2) — the join's unit is the POSITION, and the positions are the
    // SAME artifact the digest was told to write its Sheet-1 rows from (_driver/register-positions.json,
    // derived in deriveBandShape). One source of truth: the digest cites any one constituent URI, the
    // gate credits any one constituent URI, and the residual count both sides use is the same number.
    //
    // There is NO record-unit fallback, deliberately. Falling back to "every candidate is its own
    // position" is exactly the behaviour whose compliant-digest outcome is unended:1 — it would
    // reinstate the blocker this fix removed, at the seam where nobody would look (the shape's
    // positions write is best-effort inside a best-effort). So: read the artifact; if it is missing,
    // RE-DERIVE it here from the band + _records through the same builder; and only if that also
    // fails is the join NOT COMPUTABLE. A gate that cannot see positions does not get to judge
    // positions as records — and not-computable never blocks (fail-open, the legacy/replay path).
    let positions = safeReadJson(P.registerPositions)?.positions ?? null;
    if (!positions) {
      try {
        positions = deriveRegisterPositions(band?.enumerated ?? [], recordDetailIndex(P.runDir)).positions;
        runLog(P.runDir, { event: "recall-reconciliation-positions-rederived", trigger, positions: positions.length });
      } catch (e) {
        runLog(P.runDir, { event: "recall-reconciliation-positions-failed", trigger, fail: String(e?.message ?? e).slice(0, 160) });
        positions = null;
      }
    }
    if (!positions) return notComputable("no exact-identity positions projection — the join's unit is the POSITION and record-unit would block a compliant one-URI position row");
    const placement = placementRecallEndings(P, candidates.map((c) => c.record_id));
    const artifact = reconcileRecall({ candidates, endings, crowdRulings, positions, dominantElement, inScopeClasses, placement });
    writeArtifact(artifact);
    runLog(P.runDir, recallReconciliationEvent({ trigger, artifact }));
    if (artifact.totals.unended) note(`recall-reconciliation: ${artifact.totals.unended} screened-live dominant-element position(s) end NOWHERE (${artifact.totals.candidates} candidate record(s) in ${artifact.totals.positions} position(s); crowd declares ${artifact.crowd.declared} vs residual ${artifact.crowd.residual})`);
    return artifact;
  } catch (e) {
    // never-kill at the derive seam — the pre-verdict floor still reads the last good artifact.
    runLog(P.runDir, { event: "recall-reconciliation-failed", trigger, fail: String(e?.message ?? e).slice(0, 200) });
    note(`recall-reconciliation derivation failed (non-fatal here; the pre-verdict floor reads the artifact): ${String(e?.message ?? e).slice(0, 100)}`);
    return null;
  }
}

async function enforceRecallReconciliation(ctx, r, trigger) {
  const P = ctx.paths;
  let artifact = deriveRecallReconciliation(ctx, trigger);
  if (!artifact?.computable || !artifact.totals.unended) return;
  // one followup per unended-set signature, bounded across resumes (RECALL_FOLLOWUP_MAX):
  // the receipt rides the artifact file itself, so a crash between followup and re-derive re-arms
  // at most one extra attempt — bounded either way by the recovery ladder's identical-signature stop.
  // The receipt now SURVIVES the re-derive (carryRecallFollowup inside writeArtifact) — before that
  // fix this read always found null and the bound never engaged (review problem 5).
  const sig = unendedSignature(artifact);
  const prior = safeReadJson(P.recallReconciliation)?.followup ?? null;
  const attempts = prior && prior.sig === sig ? (prior.attempts ?? 0) : 0;
  const followupMax = recallFollowupMaxFor(ctx);
  if (!r?.sessionKey || attempts >= followupMax) {
    if (attempts >= followupMax) {
      runLog(P.runDir, { event: "recall-reconciliation-followup-exhausted", trigger, attempts, max: followupMax, unended: artifact.totals.unended });
      note(`recall-reconciliation: ${artifact.totals.unended} unended position(s) with the followup budget spent (${attempts}/${followupMax} on this signature) — the pre-verdict floor owns it from here`);
    }
    return;
  }
  note(`recall-reconciliation: ${artifact.totals.unended} unended position(s) — warm followup ${attempts + 1}/${followupMax} on the digest session`);
  // The crowd row rides the record_coverage TOOL when this run has a form (typed transport) — the
  // driver re-renders both the `## Coverage ledger` table and its JSON mirror from what the tool
  // records, so a hand-written table row is overwritten before deriveRecallReconciliation re-reads the
  // rulings. Same era stamp the dispatch brief keys on, so the followup can never disagree with it.
  const rrStamp = coverageFormStamp(P.runDir);
  const followup = repairFollowup("register-digest:recall-reconcile", {
    artifact,
    registerFindingsPath: P.registerFindings,
    hasCoverageForm: rrStamp.required,
  });
  const rr = await stage("register-digest", ctx, { force: true, followup, sessionKey: r.sessionKey, trigger: `recall-reconcile-${trigger}` });
  if (rr.ok) deriveCoverageLedgerJson(ctx, `recall-reconcile-${trigger}`);   // the followup rewrote the prose — keep the mirror honest
  artifact = deriveRecallReconciliation(ctx, `recall-reconcile-${trigger}`) ?? artifact;
  // stamp the followup receipt onto the artifact (attempt count keyed by the unended-set signature
  // that was ATTEMPTED — carryRecallFollowup keeps it across later re-derives while the set holds,
  // and drops it the moment the set changes, which is genuinely new work deserving a fresh budget).
  const cur = safeReadJson(P.recallReconciliation);
  if (cur) {
    cur.followup = { sig, attempts: attempts + 1, ok: rr.ok === true };
    try { atomicWrite(P.recallReconciliation, JSON.stringify(cur, null, 2) + "\n"); }
    catch { /* receipt is best-effort; the ladder still bounds */ }
  }
  if (artifact?.computable && artifact.totals.unended) {
    runLog(P.runDir, { event: "recall-reconciliation-unended", trigger, unended: artifact.totals.unended,
      uris: artifact.unended.slice(0, 8).map((u) => u.record_id) });
    note(`recall-reconciliation: ${artifact.totals.unended} position(s) STILL unended after the followup — the run delivers with them stated, clamped at the pre-verdict floor`);
  }
}

// EVERY register-digest pass (fresh, escalation, envelope, late-bind, stale-repair) flows through here so
// the WS-A machine-ledger ladder applies uniformly: any pass that will actually RE-RUN the digest
// drops the stale JSON first (not only followups — review finding: --from / a resume whose
// findings re-fail also rewrite the prose, and a forgotten re-save would leave the old JSON outvoting
// it while its very existence disables the missing-side recovery); followups carry the save mandate
// (the fresh full message already does); a coverage_* terminal failure quarantines + continues on
// prose; a missing JSON gets one warm save-only follow-up; a pass that ends with a validated ledger
// clears any stale fallback note. opts.trigger labels the events.
async function runDigest(ctx, opts = {}) {
  const P = ctx.paths;
  const trigger = opts.trigger ?? "fresh";
  // Every digest pass routes through here — fresh, escalation, envelope, settlement-flush, late-flush,
  // stale-repair — so this one seat covers them all. The evidence run's doomed attempt (810s) and the two
  // flush attempts that failed the same validator again (1,402s + 1,506s) were all dispatches over
  // deferrals nothing had decided. Synthesis needs no seat of its own: it reads the digest's output, so
  // a settled digest settles it.
  await assertReceiptSettled(ctx, "register-digest");
  // An idempotency SKIP (valid findings + valid-or-absent JSON) must NOT drop — that JSON is live.
  const willRun = opts.force || forceFromActive(ctx, "register-digest")
    || !existsSync(P.registerFindings)
    || !validators.registerFindings(P.registerFindings, readFileSync(P.registerFindings, "utf8")).ok;
  // D1 — arm the off-enum coverage gate for every digest pass THIS driver dispatches: the sentinel is
  // the receipt the registerFindings validator keys coverage_status_offenum on (receipt PRESENCE, the
  // D1 invariant), so live off-enum Status rows fail token-first into the corrective ladder while
  // archived pre-D1 runs — which never carry the sentinel — keep their replay verdicts (27/64 corpus
  // files hold off-enum shapes; an unkeyed gate would mass-flip the replay harness). Written only when
  // the pass will actually RUN: a resume whose pre-D1 prose already validates is left un-armed.
  // Non-fatal like the instructed-scope write — a miss just leaves the extra gate un-armed.
  //
  // — THE SAME SENTINEL IS THE COVERAGE FORM'S ERA STAMP, AND THE WRITE ORDER IS THE FAIL-CLOSED
  // LEG. `armCoverageForm` stamps `form_required: true` BEFORE `writeCoverageForm` puts the form on
  // disk. Get that order wrong and a failed form write leaves no stamp, the gate never arms, and the run
  // passes having judged nothing — which is the confirmed blocker (a missing sidecar returns
  // {rows:null,error:null}, the validator finds nothing to judge, and a run with NO ruling artifact is
  // byte-for-byte indistinguishable from a fully ruled one). It is reachable: a full disk fails as
  // "artifact absent", not as a disk error. In this order a failed write leaves a stamp saying a form
  // was required and no form to judge, which verify.mjs refuses as `coverage_form_missing` — a named
  // driver bug, the same treatment grid_spec_unreadable / grid_ledger_missing already give one.
  //
  // ── M6 — ALWAYS ARM, ALWAYS WRITE (2026-08-14). SUPERSEDES THE CONDITIONAL ARM BELOW IT ────────
  //
  // What stood here armed the enum sentinel WITHOUT the form arm when the plan apparatus was out of
  // reach, on the stated ground that this was "exactly the state the gate this replaces was inactive
  // in — unchanged behaviour for those runs, and no coverage-form verdict is possible on them". That
  // reason was true about the GATE and false about the REPORT, and it is overridden.
  //
  // It was false about the report because the unarmed run did not go quiet: `stages.mjs` read the same
  // stamp and told the seat "this run has NO coverage form, so the ## Coverage ledger table in your
  // findings is yours to write and it is what every coverage gate reads". So the one condition
  // could not reach kept the arrangement existed to end — a model-authored markdown table as the
  // source of truth every coverage gate read. One contract per stage, not one per runtime condition.
  //
  // And it was the wrong shape even for the gate: an unarmed absence is INDISTINGUISHABLE FROM A
  // COMPLETE RUN. Nothing downstream could tell "this run had no plan apparatus" from "this run swept
  // everything and had nothing to declare". Now the artifact is written either way — with rows when
  // there are rows, and DECLARING its cause when there are none — so the difference is a fact on disk
  // instead of an inference from a missing file.
  //
  // The write order below is unchanged and is still the fail-closed leg: armCoverageForm stamps
  // `form_required: true` BEFORE the form lands, so a failed write leaves a stamp with no form, which
  // verify.mjs refuses as `coverage_form_missing` — a named driver bug — rather than a silent pass.
  if (willRun) {
    try {
      const { input, absent } = coverageFormInput(P.runDir);
      armCoverageForm(P.runDir);
      if (input) {
        const prior = readCoverageForm(P.runDir).rows;      // a re-dispatch keeps what earlier passes settled
        const u = unionCoverageForm({ rows: prior }, { rows: null }, input);
        writeCoverageForm(P.runDir, u.form);
        runLog(P.runDir, { event: "coverage-form-written", trigger, rows: u.total, settled: u.settled,
          open: u.form.rows.filter((x) => x.open).length, bandsUnreadable: input.bandsUnreadable });
      } else {
        writeCoverageForm(P.runDir, buildCoverageAbsenceForm({ cause: absent }));
        runLog(P.runDir, { event: "coverage-form-absent", trigger, cause: absent });
      }
    } catch (e) { note(`coverage-form/sentinel write failed: ${e.message} — if the stamp landed the digest fails closed on the absent form, which is the intended direction`); }
    writeRegisterDigestFacts(ctx, trigger);
  }
  // Boundary package (2026-08-01) — placement now DECLARES the entries whose answer to the promotion
  // question ("does this conflict change the advice, or only complete the record?") two competent lawyers
  // could argue either way on this record. digest.md tells the digest those are the expected place for its
  // judgment to differ and that each must be resolved either way in a `### Disagreement resolutions` row —
  // so the count belongs beside the pass that was HANDED them: it is how a reader sees whether the
  // boundary's residue is shrinking, or whether the digest is being asked to adjudicate the same records
  // every pass. COUNT AND MARKS ONLY: the two readings live in the artifact's `reason`, and borderline
  // prose has no more business in a log row than in the report. Silent when nothing is declared (and on
  // every archived / pre-flag run) — a zero row on every digest pass is a non-event. Marks capped like the
  // recall-reconciliation `uris` row above; `count` stays exact. Best-effort: observability never blocks a
  // digest, and an absent or malformed sibling is validators.placement's business, not this row's.
  if (willRun) {
    try {
      const declared = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements.filter((e) => e.borderline === true);
      if (declared.length) runLog(P.runDir, { event: "placement-borderline", count: declared.length, marks: declared.slice(0, 8).map((e) => e.mark) });
    } catch { /* absent, pre-flag or malformed — not this row's business */ }
  }
  const droppedStale = willRun ? dropStaleCoverageLedger(ctx, trigger) : false;
  // Map #3 — the model no longer authors the JSON (mandate retired); the driver derives it post-validate.
  // — the three driver-computed blocks are ONE named builder, so the --experiment rig composes
  // exactly what this dispatch composes. `effOpts === opts` whenever nothing was appended.
  const composedExtra = digestDispatchExtra(ctx, { trigger, willRun, extra: opts.extra });
  const effOpts = composedExtra === opts.extra ? opts : { ...opts, extra: composedExtra };
  let r = await stage("register-digest", ctx, effOpts);
  if (!r.ok && isCoverageLedgerFail(r.fail)) {
    quarantineCoverageLedger(ctx, r.fail, trigger);
    const v = validators.registerFindings(P.registerFindings,
      existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "");
    if (v.ok) {
      recordTransition(ctx, "register-digest");   // the synthetic ok bypasses stageOnce's success path
      r = { ok: true, attempts: r.attempts, sessionKey: r.sessionKey, model: r.model, quarantined: true };
    }
  }
  // Map #3 — DERIVE the JSON from the just-validated prose (atomic temp+rename). Runs on EVERY pass (fresh,
  // escalation, envelope, late-bind, stale-repair) so the JSON always reflects THIS pass's prose — the root cause
  // of the prior mirror-desync failures is eliminated. A quarantined pass keeps its findings (prose) but the
  // JSON was bad; re-deriving from the good prose recovers a valid one. NEVER-KILL: a derive throw falls to
  // the prose path inside deriveCoverageLedgerJson (no hard-fail).
  if (r.ok && !r.skipped && existsSync(P.registerFindings)) {
    deriveCoverageLedgerJson(ctx, trigger);
  }
  // Near-unreachable safety net: the derive (above) writes the JSON whenever the prose parses, so a missing
  // JSON here means the derive itself threw (unparseable prose) — the prose-fallback path already handled it.
  // Kept as the WS-A never-kill belt-and-braces (it routes to a save-only followup, then prose + flag).
  if (r.ok && !r.skipped && !r.quarantined && !existsSync(P.registerCoverageLedger)) {
    noteCoverageLedgerAbsent(ctx, trigger);
  }
  if (r.ok && !r.skipped && ctx.machineLedgerNote && existsSync(P.registerCoverageLedger)) {
    // this pass ended with a VALIDATED machine ledger — a prior fallback/quarantine note is now
    // false (the gates DO read the machine path from here on); clear it or the report lies.
    ctx.machineLedgerNote = null;
    writeRunStatus(ctx, { machineLedgerNote: null });
    runLog(P.runDir, { event: "coverage-ledger-recovered", trigger });
  }
  // P2-A — the retrieved→judgment reconciliation re-derives after EVERY pass, RAN OR SKIPPED (the
  // round-N→N+1 evaporation died exactly between passes; a skip-resumed run re-checks so a park
  // bought by the pre-verdict floor gets its fresh followup attempt here). Enforcement is one warm
  // followup; delivery blocking belongs to the pre-verdict floor, never to this seam (a flush whose
  // items must stay durable can't be failed from here).
  if (r.ok) await enforceRecallReconciliation(ctx, r, trigger);
  // — the placement→digest CARRY join, re-derived on the same seam and for the same reason: the
  // loss it counts happens BETWEEN passes. It never gates and never sends a followup — the artifact,
  // the asserted run.jsonl row and (at publish) one doubt per unanswered placement are the whole
  // mechanism, per presence-reconciliation's rule that this driver annotates and never re-decides.
  if (r.ok) derivePlacementCarry(ctx, trigger);
  // — THIS WAS `deriveRecordCarry(ctx, trigger)` AND IT WAS THE DEFECT. The trace joins against
  // findings.json, synthesis authors findings.json, and synthesis runs AFTER register-digest — so on a
  // linear fresh run the join ran against `[]` and every retrieved record that DID become a finding was
  // written down as having stopped at an earlier seam, naming that seam. It never errored; it reported a
  // confident wrong answer on the one artifact whose purpose is to say which records reached the
  // findings. It was accidentally right only on runs that tripped the delivery freshness gate, because
  // UPSTREAM_STALE_REPAIR re-runs the digest after synthesis.
  //
  // What belongs here is the DIGEST'S OWN account of what it just did — a fact this pass holds and the
  // next pass overwrites. The join moved to where the findings exist (deliverRun, before the doubt mint
  // and the predelivery lint both read it).
  if (r.ok || r.fail) recordDigestSeam(ctx, r, trigger);
  if (!r.ok && !isCoverageLedgerFail(r.fail) && droppedStale && !existsSync(P.registerCoverageLedger) && !ctx.machineLedgerNote) {
    // drop-then-fail (e.g. the non-fatal late-bind re-digest dying on transport): a valid ledger was
    // deleted and nothing re-saved it — the prose fallback must be visible, never silent.
    ctx.machineLedgerNote = `machine coverage ledger was dropped ahead of the ${trigger} re-digest, which then failed — coverage gates read the prose table for this run`;
    writeRunStatus(ctx, { machineLedgerNote: ctx.machineLedgerNote });
    runLog(P.runDir, { event: "coverage-ledger-fallback", trigger, reason: "dropped_then_failed" });
  }
  return r;
}

// ── THE DRIVER-COMPUTED DIGEST PROMPT BLOCKS (item) ─────────────────────────────────────────────
//
// Three blocks that are context the digest receives and no file records: the deferred-axis hint (A8),
// the placement rulings tail (P5/A-2), and the owner×element screen receipt (P2-B). They lived inline
// in runDigest, so `--experiment register-digest` — which calls stage() directly and never enters
// runDigest — dispatched an arm WITHOUT all three. Named here so both callers compose the identical
// string; stage-context.mjs DISPATCH_EXTRAS declares this builder's read set, so the sandbox carries
// what it reads like any other edge.
//
// EXTRACTION ONLY. Same blocks, same order, same guards: A8 and the owner receipt are unconditional,
// the rulings tail keeps `willRun && trigger !== "fresh"`. Returns `extra` UNCHANGED — by identity, so
// a caller can tell nothing was appended — when no block fires.
export function digestDispatchExtra(ctx, { trigger = "fresh", willRun = true, extra = undefined } = {}) {   // @internal
  const P = ctx.paths;
  let out = extra;
  // — THE COVERAGE FORM BRIEF, replacing the deferred-slice block (was A8, 2026-07-30).
  //
  // What stood here composed a prose list of every deferred qid and told the stage each one "must appear
  // VERBATIM in a Coverage-ledger row". The block's own doc block explained why it could not elide any of
  // them: the join was on the qid verbatim, so a qid the stage was never shown could never be named.
  // R1 carried fourteen. The driver now writes those qids INTO the form as rows, each with its own
  // receipt reason and marked `open`, so the dispatch names the file rather than reciting its contents.
  //
  // STILL BEST-EFFORT HERE, AND — UNLIKE BEFORE — THAT IS NOW SAFE BY CONSTRUCTION RATHER THAN BY
  // ARGUMENT. The old block was best-effort because the ENFORCEMENT lived in the validator reading the
  // same receipt off disk. The form is not composed here at all: it is written above, before the
  // dispatch, and the era stamp is already armed. If this brief fails to compose, the seat gets a
  // dispatch without it and still finds the form on disk — and if the FORM is missing, the validator
  // fails closed. A composition failure costs a corrective round, never a silent pass.
  try {
    const stamp = coverageFormStamp(P.runDir);
    if (stamp.required) {
      const cf = readCoverageForm(P.runDir, stamp.formName);
      // Typed transport: the brief ENUMERATES the rows and names `record_coverage` — the dispatch is
      // the seat's only sight of its obligations now (the seat-facing form copy is dead), and the
      // tool's every answer re-lists what is outstanding, so a brief that failed to compose degrades
      // to learning-by-answer, never to a silent pass (the validator still refuses an unsettled row).
      const block = coverageFormBrief({ rows: cf.rows ?? [] });
      if (block) {
        out = out ? `${out}\n\n${block}` : block;
        runLog(P.runDir, { event: "digest-coverage-form-brief", rows: (cf.rows ?? []).length,
          open: (cf.rows ?? []).filter((r) => r.open).length });
      }
    }
  } catch (e) { note(`coverage-form brief skipped (non-fatal — the form is in _driver/ and the validator refuses an unsettled row): ${String(e.message).slice(0, 80)}`); }
  // — THE BATCH BLOCK: how the driver split this run's band, and which batches are still outstanding.
  //
  // The seat is told the split HERE rather than in the stage's dictation because the numbers are the
  // run's, not the contract's: a band of 40 records is one batch and a band of 1,161 is twelve, and on a
  // resume the outstanding set is what the killed attempt did not reach. The dictation says the rule;
  // this says the arithmetic.
  //
  // BEST-EFFORT, AND SAFE BY CONSTRUCTION rather than by argument — the coverage brief's precedent above,
  // for its reason. Nothing here enforces anything: a call naming a batch is judged against the driver's
  // own split whether or not this block composed, the tool's refusal re-states what is outstanding, and
  // the stage's exit gate refuses a document that ends fewer records than the run carried in. A brief
  // that fails to compose costs a corrective round; it cannot cost a record.
  try {
    const gap = digestAccountingGap(P.runDir);
    const block = digestBatchBrief(gap);
    if (block) {
      out = out ? `${out}\n\n${block}` : block;
      runLog(P.runDir, { event: "digest-batch-brief", trigger, owed: gap.owed.length,
        batches: batchesOf(gap.owed).length, unaccounted: gap.unaccounted.length });
    }
  } catch (e) { note(`digest batch brief skipped (non-fatal — the tool judges every batch against the driver's own split regardless): ${String(e.message).slice(0, 80)}`); }
  // AD-2 A9 (E2E-R2) + the P5 review (2026-07-31): a corrective/repair pass is told NOT to re-read the
  // whole placement file — the per-candidate tiers are in placements.json — but the RULINGS TAIL (band
  // reconciliation, disagreements, coverage rulings, open questions) lives ONLY in the md. Leaving it to
  // model discretion is exactly the loss A9 names, and the named backstop does not cover it:
  // findUnresolvedDisagreements only flags disagreement rows that EXIST, so a table that vanished
  // entirely yields zero flags. So on a corrective dispatch the tail rides the message AS DATA
  // (same shape as correctionsExtra's synthesis block). A fresh pass reads the md itself; a legacy run
  // with no tail costs nothing.
  //
  // A-2 — the guard used to read `&& !opts.followup`, on the reasoning that "a warm followup carries its
  // own message and is untouched". Both halves of that were wrong. A followup is not warm (A-1: it is
  // attempt 1 of a fresh session), and its own message is now COMPOSED with `extra` rather than replacing
  // it — so the tail reaches it. This is the dispatch that needed it most: the least able to reconstruct
  // the rulings tail was the only one denied it, and the flush is the largest re-digest surface in a run.
  //
  // Rebase note (P5 onto A8): this block COMPOSES with the deferred-axis hint above rather than
  // replacing it — it appends to the running `out`, not to the incoming `extra`. Restarting from `extra` here (the
  // pre-rebase shape) would have silently dropped A8's hint on every corrective digest pass, which is
  // the one dispatch where both blocks are wanted at once.
  if (willRun && trigger !== "fresh") {
    const tail = extractRulingsTail(existsSync(P.placement) ? readFileSync(P.placement, "utf8") : "");
    if (tail) {
      const block = lines(
        `PLACEMENT RULINGS TAIL (verbatim from ${P.placement}, provided AS DATA — do NOT re-read the placement file; adjudicate against these rulings: adopt each one or counter-reason it by engaging its stated reason, never silently drop one):`,
        "```markdown",
        tail,
        "```",
      );
      out = out ? `${out}\n\n${block}` : block;
      runLog(P.runDir, { event: "digest-rulings-tail", trigger, chars: tail.length });
    }
  }
  // Rebase note (P2-B onto P5/, 2026-07-31): this block is the THIRD writer of the composed extra on
  // this dispatch, after A8's deferred-axis hint and P5's placement rulings tail. It composes with both
  // for the same reason P5 composed with A8 — it appends to the running `out`, never to `extra`. A
  // corrective digest pass on a matter with a deferred axis and an owner lane carries all three blocks.
  // P2-B (charter P2b): the owner×element screen reaches the digest as DATA. The evidence run's
  // digest had to ASK the band whether the screen had run, got 0 from a broken qid join, and wrote
  // "the owner-by-owner screen produced no records" over a screen that had returned eleven. The
  // receipt says per owner what enumerated, what it attributed, and what did NOT run — and states
  // the one rule the printed negative has to obey.
  try {
    const screen = readOwnerScreen(P);
    const negative = ownerScreenNegative(screen);
    if (negative) {
      const block = `OWNER×ELEMENT SCREEN — DRIVER-COMPUTED RECEIPT (do NOT re-derive this from the band; it is the plan-execution join, and the band's own qids are its source):\n${negative}\n` +
        `Write the screen's coverage row and any owner paragraph FROM THIS. A negative about a named owner may rest ONLY on a slice listed as enumerated with zero records; ` +
        `an owner listed NOT RUN or count-only is a disclosed, open gap and must be written as one — never as "nothing found", and never as "the screen produced no records" when this receipt says records were attributed.`;
      out = out ? `${out}\n\n${block}` : block;
    }
  } catch (e) { note(`owner-screen dispatch data skipped (non-fatal): ${String(e.message).slice(0, 80)}`); }
  return out;
}

// ── — THE SEARCH FLOOR, REBUILT AS A TYPED DESIGNATION ────────────────────────────────────────
//
// The ⭐ marker was retired at and stays retired. What comes back is the MECHANISM it carried: the
// worker who missed the work does not also get to write the label that excuses it.
//
// The old `findFloorBreaches` read ⭐-marked lines out of the manifest TEXT, tokenised them, dropped
// generic words and matched the remainder against coverage-row text. That join is why it needed free text
// at all, and it is what conversion 3 made unreachable. This one reads `search_floor` — axis names, closed
// against REGISTER_AXES, designated by clearance-variants in an earlier turn — and joins on `axis`, which
// both sides type. No tokens, no matching, nothing to go quietly wrong.
//
// A BREACH IS: an axis this mark's floor obliges, carrying a row labelled `coverage-limited`. That label
// says "an accepted structural limit"; on floor work it is the seat grading its own miss. `deferred` is
// NOT a breach — it is honest outstanding work, and `computeOpenFloors` already discloses it.
//
// NO DESIGNATION ⇒ NO BREACH, and that is load-bearing rather than incidental: a floor that defaulted to
// on would manufacture the hold on every run, which is worse than the widening closes.
export function findFloorBreaches(ledger, floorAxes) {   // @internal
  const floors = new Set((floorAxes ?? []).map((a) => String(a ?? "").trim().toLowerCase()).filter(Boolean));
  if (!floors.size) return [];
  return (ledger ?? [])
    .filter((r) => floors.has(String(r?.axis ?? "").toLowerCase()) && r?.status === "coverage-limited")
    .map((r) => ({ axis: String(r.axis).toLowerCase(), unit: r.unit, reason: r.reason ?? "" }));
}

/**
 * The floor axes this run's manifest designates, or `[]`.
 *
 * READ FROM THE VALIDATED MODEL, never from the rendered manifest. The rendered file is a projection and
 * a reader of it would be back to matching text — the thing that killed the original. Every failure is
 * `[]`: no manifest, unreadable, unparseable. That is the honest default here and not an absence read as
 * a pass, because the whole mechanism is opt-in — a run with no designation owes no floor, and a run whose
 * manifest cannot be read has no designation to honour. The refusal for an absent or unparseable manifest
 * belongs to the stage that writes it and already exists there — validators.variantManifest in verify.mjs runs the same parser
 * through `checkSiblingJson` and fails clearance-variants with `variantmodel_missing`. Checked, because
 * "something else refuses it" is exactly the assumption that turns a swallowed error into a silent pass.
 */
export function readFloorAxes(paths) {   // @internal
  try { return parseVariantManifestModel(readFileSync(paths.variantManifestModel, "utf8")).search_floor ?? []; }
  catch { return []; }
}

// A never-active axis self-writes a harmless "not applicable" digest — the skill MANDATES the exact
// scope wording (skills/clearance-register/unit.md: `query:"<axis> not applicable"`,
// `reason:"not applicable — <why>"`), so the coverage-ledger row lands as `<axis> / axis not applicable`.
// It is `deferred` only because a non-search must not be dressed as a clean — it is NOT floor work left
// open. Keyed on the self-digest scope (deterministic, skill-dictated), never a genuine floor's
// substantive scope, so a real open floor can never be swept out.
export function isInactiveAxisRow(r) {   // @internal
  return /\bnot[\s-]?applicable\b/i.test(String(r?.unit ?? r?.scope ?? ""));
}

// Open floors at delivery = `deferred` coverage rows, MINUS never-active axes (an inactive axis had no
// floor work to leave open, so it must not leak a floor row onto the disclosure). Pure + testable.
//
// restores the BREACH half, and the second argument is now the typed designation rather than the
// manifest text the retired version scanned. Two disclosable states, kept apart because they are
// different facts about the run:
//
//   deferred          planned, not run, said so. Honest outstanding work.
//   floor breach      obliged by this mark's floor, and labelled an accepted limit instead of executed.
//
// The breach line names WHY it is disclosed, because "unit X" on a disclosure a client reads is not a
// finding — it is a word.
export function computeOpenFloors(ledger, floorAxes) {   // @internal
  return (ledger ?? []).filter((r) => r.status === "deferred" && !isInactiveAxisRow(r)).map((r) => r.unit)
    .concat(findFloorBreaches(ledger, floorAxes)
      .map((b) => `${b.unit} (labelled coverage-limited — search-floor work on a designated axis, without a found/not-found result)`));
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

// Escalation risk tag — pure and testable. Reads the
// dictated `risk: <category>` field off an axis's ESCALATE line. Fail-safe by construction: a missing or
// A2 (addendum 2026-07-30) — `heldAxes` are floor obligations NO amount of time can close: the active
// provider cannot express those slices at all, so a re-run re-derives the identical refusal. They are
// removed from the arithmetic BEFORE the clock is consulted (the rule lives here, beside the "no
// deadline given" branch that closed two of them on the evidence run) and reported back so the caller
// can log them and leave them standing. They are NOT resolved, NOT relabelled and NOT quietly dropped:
// a held row stays `deferred`, keeps its open-floor status, and ships disclosed with its mechanical
// cause. The coverage floor's right to refuse a clean verdict over that slice is exactly the point.
export function envelopeDecision({ deferredAxes, deadline, now, estCloseSec, heldAxes = [] }) {   // @internal
  const held = [...new Set((heldAxes ?? []).map((a) => String(a)))];
  const closeable = (deferredAxes ?? []).filter((a) => !held.includes(String(a)));
  const heldNote = held.length
    ? ` (${held.length} axis/axes held: a capability-gap deferral is never closeable by time — ${held.join(", ")})`
    : "";
  if (!closeable.length) {
    return held.length
      ? { close: false, closeable, held, reason: `no closeable floor obligations${heldNote}` }
      : { close: false, closeable, held, reason: "no deferred floor obligations" };
  }
  if (!deadline) return { close: true, closeable, held, reason: `no deadline given — time permits closing in-loop${heldNote}` };
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return { close: true, closeable, held, reason: `unparseable deadline "${deadline}" — treated as permissive${heldNote}` };
  const availSec = (t - now) / 1000;
  const marginSec = availSec - estCloseSec - 3600;
  return marginSec > 0
    ? { close: true, closeable, held, reason: `deadline permits: ~${Math.round(estCloseSec / 60)} min to close, ${Math.round(availSec / 60)} min available${heldNote}` }
    : { close: false, closeable, held, reason: `deadline does not permit: ~${Math.round(estCloseSec / 60)} min to close vs ${Math.round(availSec / 60)} min to deadline (incl. 60-min delivery reserve)${heldNote}` };
}

/**
 * Whether a coverage row names an office the plan's provider cannot express, as a predicate for the closeability split.
 * A plan with no provider, or one the capability contract does not know, names nothing outside. PURE.
 */
export function officeGapOf(plan) {   // @internal
  let capabilities = null;
  try { capabilities = plan?.provider ? capabilitiesFor(plan.provider) : null; } catch { capabilities = null; }
  return capabilities ? (row) => rowOutsideProviderOffices(row, capabilities) : () => false;
}

// WHAT A RE-RUN CANNOT CLOSE, in the words the review's table, the review's manual and both re-run follow-ups share, so
// the unit that is told to leave a row and the review that is told not to send it back read one reason.
export const NOT_CLOSEABLE_KINDS = "the provider cannot express the slice, the envelope close has already asked it again, it was not asked in this run, or it names no search at all";   // @internal
const heldRowLines = (rows) => rows.map((r) => `| ${r.unit} | deferred | ${r.reason} |`).join("\n");
/** The rows an escalated unit must leave as they are, and why; empty when there are none. @internal */
export function escalationHeldNote(rows) {
  return rows?.length ? `\n\nNOT YOURS TO CLOSE — a re-run cannot close these: ${NOT_CLOSEABLE_KINDS}. Leave these Coverage-ledger rows exactly as they are (\`deferred\`, same reason), and do not restate them as searched or clean:\n${heldRowLines(rows)}` : "";
}
/** The rows a unit the envelope re-opens must leave as they are, and why; empty when there are none. @internal */
export function envelopeHeldNote(rows) {
  return rows?.length ? `\n\nThese rows on this axis are NOT yours to close and must stay exactly as they are — a re-run cannot close them: ${NOT_CLOSEABLE_KINDS}. Leave them \`deferred\`, keep their reason, and do not restate them as searched or clean:\n${heldRowLines(rows)}` : "";
}

/**
 * Whether a deferred coverage row names a question a re-run can still send, read off the plan-execution receipt as a
 * predicate for the closeability split. An axis's `missing` questions are the ones a re-run sends: planned and never
 * sent, or failed at the provider. A capability gap is not among them, and neither is a follow-up the safety net
 * refused (joinPlanToBands). A row carrying its question's qid can be sent when that question is missing. The axis's
 * own row, which names the axis and no slice of it, stands for the axis's planned questions, and can be sent when the
 * axis holds a missing one. Any other row that names no question names no search: a re-run has nothing to send for
 * it, whatever else its axis holds. Null for an axis the receipt does not cover, or with no receipt, so the split keeps
 * its old answer. PURE.
 */
export function askableOf(receipt) {   // @internal
  const missingByAxis = new Map();
  for (const s of Array.isArray(receipt?.skeleton) ? receipt.skeleton : []) {
    const ax = String(s?.axis ?? "").toLowerCase();
    if (!ax) continue;
    const set = missingByAxis.get(ax) ?? new Set();
    for (const q of Array.isArray(s?.missing) ? s.missing : []) set.add(String(q?.qid ?? q));
    missingByAxis.set(ax, set);
  }
  return (row) => {
    const missing = missingByAxis.get(String(row?.axis ?? "").toLowerCase());
    if (!missing) return null;
    if (row?.qid) return missing.has(String(row.qid));
    return !String(row?.scope ?? "").trim() && missing.size > 0;
  };
}

/**
 * The axes the plan-execution receipt indicts with >=1 DETERMINISTIC deferral (joinPlanToBands'
 * `deferred` bucket — the executor's own client-side refusals), plus the axes the frozen plan says are
 * deferred end to end. The AUTHORITY half of the capability-gap split; prose only ever narrows inside
 * an axis this set already names. PURE.
 */
export function capabilityGapAxes(plan, receipt) {   // @internal
  const axisOf = new Map((plan?.entries ?? []).map((e) => [String(e?.qid ?? ""), String(e?.axis ?? "").toLowerCase()]));
  const out = new Set();
  for (const d of receipt?.deferred ?? []) {
    const ax = axisOf.get(String(d?.qid ?? ""));
    if (ax) out.add(ax);
  }
  for (const s of receipt?.skeleton ?? []) {
    if (s?.state === "deferred" && (s.deferred?.length ?? 0) > 0) out.add(String(s.axis ?? "").toLowerCase());
  }
  return out;
}

/**
 * No stage starts on inputs a recorded, unresolved item is about to change.
 *
 * The start predicate (stageOnce → stage-freshness) tests input PRESENCE and content hash, never input
 * STATUS: plan-execution.json carrying three refused slices gates nothing, which is how placement-inquiry
 * started one second after the run recorded them and a digest attempt was dispatched already doomed.
 *
 * This is straight-line code, so "gating" really means "the decision step runs first" — the fan-in already
 * settles. This guard is the INSURANCE: a resume that reached here without passing the fan-in, a `--from`
 * fork, or a supplemental fold that bumped plan_version after the last decision. It never waits (there is
 * nothing to wait on) and never blocks: it settles, loudly, and lets the stage proceed on settled inputs.
 *
 * Fails loud only when the receipt itself is unreadable — a driver-written artifact, so a parse failure is
 * a defect, not a state to route around.
 */
async function assertReceiptSettled(ctx, stageLabel) {
  const P = ctx?.paths;
  if (!P?.planExecution || !existsSync(P.planExecution)) return { settled: true, cause: "no-receipt" };
  let receipt;
  try { receipt = JSON.parse(readFileSync(P.planExecution, "utf8")); }
  catch (e) {
    throw new StageFailure("settled-gate", `_driver/plan-execution.json is unreadable (${String(e.message).slice(0, 120)}) — the run cannot tell which dictated slices were refused, and ${stageLabel} would read coverage it cannot vouch for`,
      undefined, { failClass: "deterministic" });
  }
  const state = receiptSettled(P, receipt);
  if (state.settled) return state;
  runLog(P.runDir, { event: "unsettled-inputs", stage: stageLabel, cause: state.cause,
    unsettled: state.unsettled.slice(0, 8) });
  note(`${stageLabel}: ${state.unsettled.length} recorded deferral(s) carry no decision (${state.cause}) — settling before the stage runs`);
  // Prefer the fan-in's lane: it carries the executor, so a mis-stamped deferral still gets its one
  // budgeted attempt. Absent it (a seam the fan-in never reached), settle anyway rather than log and
  // proceed unsettled — a guard that only narrates the problem it was written to fix is not a guard.
  // Dispatch-less settling records a suspect as ended, never as closed, so nothing is claimed untried.
  if (ctx.settleEnvelope) await ctx.settleEnvelope(`guard:${stageLabel}`);
  else await settleReceipt({ P, plan: ctx.registerPlan, receipt });
  // Re-read from disk: the settle may have re-joined and rewritten the receipt itself, so judging the
  // outcome against the pre-settle object in hand would report on a receipt that no longer exists.
  let after = receipt;
  try { after = JSON.parse(readFileSync(P.planExecution, "utf8")); } catch { /* keep the one we have */ }
  const settled = receiptSettled(P, after);
  if (!settled.settled)
    note(`${stageLabel}: ${settled.unsettled.length} deferral(s) STILL undecided after settling (${settled.cause}) — the stage proceeds and the coverage gate holds the line`);
  return settled;
}

// `--from <stage>` forces re-run of the named stage AND every downstream stage, while earlier stages still
// skip via idempotency. Keyed on STAGE_ORDER (axis suffix stripped); never deletes files.
function forceFromActive(ctx, name) {
  if (ctx?.forceFrom == null) return false;
  const o = stageOrdinal(name);
  return o >= 0 && o >= ctx.forceFrom;
}

// On an idempotency SKIP we don't re-run, so we recover the WINNING attempt's session key + served model from
// the persisted per-stage telemetry (the last success in _driver/<label>.jsonl). Without this, a stage that
// originally won on a cross-provider fallback would, after a resume, report the PRIMARY model + an undefined
// key — and the verdict-gated corrective re-synthesis would then cold-cache + model-mismatch (review finding).
//
// CODE-SIDE winners have NO session (2026-07-29 hardening): the code-side saturation-probe writes its
// stageLog row with `key: <minted string>` + modelUsed "code:execute-plan", but that key never existed as a
// model session. When the executor lane is unavailable on a resume (dispatch off / no adapter) the AGENT
// member's skip would recover that phantom key and hand it to the warm escalation lane, which then tries to
// warm-resume a session no engine ever opened. A code-side winner therefore recovers its TRUE model (the
// telemetry stays honest in the skip event) with key:null — the same "resumed-past axis" contract
// runSaturationProbeCodeSide already declares (null unitKey ⇒ escalation/envelope use their code/fresh lanes).
/**
 * Is a stage's output on disk valid to reuse? A said-back refusal is a duty the pass said back and recorded, not
 * an invalid output (gateway.mjs saidBackOnly): a pass that stood on one is not run again on resume. A floor it
 * left open is the floor duty's to re-run, above. @internal
 */
export function outputStands(def, out) {
  if (!def?.validate) return true;
  const v = def.validate(out, readFileSync(out, "utf8"));
  return v.ok || saidBackOnly(v.reason);
}

export function recoverWinningAttempt(runDir, label) {   // @internal
  try {
    const lines = readFileSync(driverDir(runDir, `${label}.jsonl`), "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const a = JSON.parse(lines[i]);
      if (!a.fail && a.key) {
        const model = a.modelUsed ?? a.model;
        if (String(model ?? "").startsWith("code")) return { key: null, model };
        return { key: a.key, model };
      }
    }
  } catch { /* no prior telemetry — fall back to caller defaults */ }
  return null;
}

// ── A REGISTER UNIT THAT COULD NOT FINISH IS DELIVERED AS ITS BAND STANDS ─────────────────────────────
//
// A unit that wrote no result once its attempts were spent ended the run, though the run held every other unit: on a
// production run on 2026-10-21 one unit's plan search timed out at the register on every attempt, and the client got
// nothing. Such a unit now fails as the searches not completed (the gather barrier below), naming itself and the planned
// slices its band never reached. Once its recovery is spent, the run-level catch records both, and the resumed pass
// takes the unit as it stands rather than sending it again: its band is what the kept answers left, or empty, and its
// note is the driver's own account of that band, with no word from the seat. The band merge then takes the recorded
// slices out as deferred blocks, so they are delivered as open rows.

/**
 * The planned slices of `axis` that its band holds no block for, each `{axis, qid, reason}` with the shipped reason for a
 * search that never reached the register. A slice with a block, a timed-out one included, is not among them: the band
 * already accounts for it. A guarded child is left to the plan join, which reads it off its parent. PURE but for the read.
 */
export function slicesUnitNeverReached(P, plan, axis) {   // @internal
  let band = [];
  try { const parsed = JSON.parse(readFileSync(P.registerBand(axis), "utf8")); band = Array.isArray(parsed) ? parsed : []; } catch { band = []; }
  const held = new Set(band.map((b) => b?.qid).filter(Boolean).map(String));
  return (plan?.entries ?? []).filter((e) => e?.axis === axis && e?.qid && !e.when && !held.has(String(e.qid)))
    .map((e) => ({ axis, qid: String(e.qid), reason: plainDeferralReason("slice-not-landed") }));
}

/** The unit a run records as unfinished, taken as its band stands: its note rendered from it, nothing dispatched. */
export function unfinishedUnitAsItStands(ctx) {   // @internal
  const P = ctx.paths, a = ctx.axis, label = `register-unit:${a}`;
  const t0 = Date.now();
  mkdirSync(join(P.runDir, "register-units"), { recursive: true });
  const bandPath = P.registerBand(a);
  if (!existsSync(bandPath)) { writeFileSync(`${bandPath}.tmp`, "[]\n"); renameSync(`${bandPath}.tmp`, bandPath); }
  const out = P.registerUnit(a);
  writeFileSync(`${out}.tmp`, renderUnitNote({ axis: a, account: readBandAccount(P.runDir, a) }));
  renameSync(`${out}.tmp`, out);
  runLog(P.runDir, { event: "unit-not-completed-delivery", stage: label, output: outputMeta(out), ...stageWallFields(t0) });
  note(`[${label}] could not be completed once its recovery was spent — taken as its band stands and not sent again`);
  (ctx.skippedStages ??= []).push(label);
  recordTransition(ctx, "register-unit");
  return { ok: true, skipped: true, notCompleted: true, sessionKey: null, model: null };
}

// ── saturation-probe runs CODE-SIDE (2026-07-14, fabricated-band root cause) ────────────────────────
// The axis is fully dictated (count-only crowd descriptors; judgment proposes nothing on it), yet it was
// staffed by the cheapest model whose ONLY job was one register_execute_plan call — and the provider
// call-log proved that call was silently skipped ~1/3 of runs since, each time with a
// hand-fabricated band shipped in its place (ashen-causeway 07-06, teal-lattice 07-07, teal-foundry
// 07-13; copper-keystone 07-14 died at fan-in when the model deleted its own forgery). The driver now runs
// the frozen entries itself through the SAME provider executor the fan-in repair kit uses and templates
// the audit note; the band stays executor-written and qid-stamped, byte-compatible with the agent path.
// The agent stage remains the VERBATIM fallback when no executor lane exists (CLEAROTRON_PLAN_DISPATCH=off,
// a provider without executePlan, or no frozen plan) — that branch is the rollback path, and it is the
// one the offline mock harness exercises.
// Returns the stageOnce result shape. sessionKey is ALWAYS null: there is no live session to
// warm-resume, so the escalation/envelope arms and the plan-join treat the axis as resumed-past and use
// their code/fresh lanes (they already must — resumed-past axes have had a null unitKey since).
export async function runSaturationProbeCodeSide(ctx, planExec) {   // @internal
  const P = ctx.paths;
  const a = "saturation-probe";
  const label = `register-unit:${a}`;
  const out = P.registerUnit(a);
  const bandPath = P.registerBand(a);
  const sessionKey = `clearance-${ctx.run.slug}-${ctx.run.codename}-register-unit-${a}`;
  // crash-resume idempotency — mirrors stageOnce's skip: output present + valid ⇒ never re-execute.
  const forced = forceFromActive(ctx, "register-unit");
  // — hoisted above the skip return. Below it, this member's dispatch row carries boundaries and its
  // SKIP row does not, which is a hole in the wave at the one member that is code-side and fast.
  const t0 = Date.now();
  if (!forced && existsSync(out) && existsSync(bandPath) && validators.registerUnit(out, readFileSync(out, "utf8")).ok) {
    note(`[${label}] skip — output already present and valid (code-side)`);
    // outputMeta, NOT fileMeta — a skip row lands on the SAME get_run stages[] surface as a stage row, and
    // that surface's contract is `present`-bearing (see the census note above the stageOnce skip below).
    runLog(P.runDir, { event: "skip", stage: label, trigger: "skip", model: "code:execute-plan", output: outputMeta(out), ...stageWallFields(t0) });
    (ctx.skippedStages ??= []).push(label);
    recordTransition(ctx, "register-unit");
    return { ok: true, skipped: true, sessionKey: null, model: "code:execute-plan" };
  }
  mkdirSync(join(P.runDir, "register-units"), { recursive: true });
  const entries = (ctx.registerPlan?.entries ?? []).filter((e) => e?.axis === a);
  let summary = null, fail = null;
  if (!entries.length) {
    // vacuous axis (no element flagged saturated — the VENZY shape): the executor refuses an empty
    // axis, so the driver writes the honest empty band itself. Not a hand-authored data block — there
    // is no data; fan-in's plan⇄band join sees zero dictated entries and zero blocks, consistently.
    writeFileSync(`${bandPath}.tmp`, "[]\n");
    renameSync(`${bandPath}.tmp`, bandPath);
    summary = { executed: 0, states: {} };
  } else {
    // one in-driver retry for transport weather; the executor already retries each provider call once
    // in-tool, so two outer attempts is plenty — beyond that the recovery ladder parks the run.
    for (let attempt = 1; attempt <= 2 && !summary; attempt++) {
      const r = await planExec({ planPath: P.registerPlan, axis: a, outputPath: bandPath },
        { agentId: ctx.agent, sessionKey, recordLog: runRecordLogPath(P.runDir) });
      if (r?.ok) { summary = r; fail = null; }
      else {
        fail = `saturation-probe direct execution failed: ${String(r?.cause ?? "unknown").slice(0, 160)}`;
        note(`[${label}] executor attempt ${attempt}/2 failed — ${String(r?.cause ?? "unknown").slice(0, 120)}`);
      }
    }
  }
  if (summary) {
    try {
      writeSatProbeAuditNote({ ctx, out, bandPath, entries });
      const v = validators.registerUnit(out, readFileSync(out, "utf8"));
      if (!v.ok) fail = `code-side unit failed its own validator: ${v.reason}`;
    } catch (e) { fail = `code-side audit note failed: ${String(e?.message ?? e).slice(0, 120)}`; }
  }
  const ok = Boolean(summary) && !fail;
  stageLog(P.runDir, label, {
    attempt: 1, key: sessionKey, agent: ctx.agent, model: "code", modelUsed: "code:execute-plan",
    code: ok ? 0 : 1, wall: (Date.now() - t0) / 1000, status: ok ? "ok" : "error", fail: fail ?? null,
    laneWaitMs: 0, summary: summary ? `direct-executed ${summary.executed ?? entries.length}/${entries.length} dictated entr${entries.length === 1 ? "y" : "ies"}` : null,
    // UNCONDITIONAL outputMeta, matching the runLog row this function writes 20 lines down and the
    // contract the comment below states. It read `ok ? fileMeta(out): undefined` until: half the
    // described fix had landed (null → undefined) and the half that mattered had not. Both halves of
    // the old shape lied — `undefined` OMITS the key, which is the absent-means-false shape this
    // package exists to kill, and fileMeta renders a missing or mid-write output as {sha:null,size:0},
    // a plausible record where there is no file. outputMeta says {present:false} and refuses a byte
    // count nobody measured. Note the babysit guard could not have caught this: it projects run.jsonl,
    // and this row goes to the per-attempt <stage>.jsonl, a surface nothing was asserting.
    output: outputMeta(out),
  });
  // This row lands on get_run stages[] beside stageOnce's, so it owes that surface the SAME contract —
  // it was writing a shape of its own (post-merge audit N2):
  //   · output was `ok ? fileMeta(out) : null`. Under AD-4's vocabulary `null` means "this stage declares
  //     NO output", and this stage plainly declares one — the honest failure value is {present:false}.
  //     Unconditional outputMeta also makes a code-side MID-WRITE (band written, audit note or validator
  //     failed after it) visible instead of erased, exactly as it is on the agent path.
  //   · inputs were bare fileMeta, i.e. no `read` key at all — an OMITTED key, which is the absent-means-
  //     false shape this package exists to kill (and which babysit-output-honesty.test.mjs forbids).
  //     journalStageInputs with no gauge yields read:null: this lane is pure code, it never observes reads,
  //     and null is the honest answer. `.filter(Boolean)` stays OUTSIDE — journalStageInputs preserves a
  //     null element rather than dropping it, so the guard has to run on the path list.
  //   · followup / readsTruncated / warm were absent; they are written unconditionally (false/null/false)
  //     so the null `read`s explain themselves without a join, as on every other row.
  runLog(P.runDir, {
    event: "stage", stage: label, trigger: "fresh", ok, attempts: 1, fail,
    model: "code:execute-plan",
    inputs: journalStageInputs([P.registerPlan].filter(Boolean), { reads: null, readsTruncated: null, warm: false }),
    followup: false, readsTruncated: null, warm: false,
    output: outputMeta(out), summary: ok ? "direct-executed" : undefined,
    ...stageWallFields(t0),   //
  });
  if (ok) recordTransition(ctx, "register-unit");
  return ok ? { ok: true, sessionKey: null, model: "code:execute-plan" } : { ok: false, fail, sessionKey: null, model: "code:execute-plan" };
}

// The templated audit note for the code-side unit. Rendered FROM the executor-written band (the real
// material), never from model prose — the table is the read-back of what actually executed. Wording
// stays clear of the validator's declared_not_executed vocabulary by construction.
function writeSatProbeAuditNote({ ctx, out, bandPath, entries }) {
  let blocks = [];
  try { const parsed = JSON.parse(readFileSync(bandPath, "utf8")); if (Array.isArray(parsed)) blocks = parsed; } catch { /* empty/unreadable band renders as zero blocks; the band validator holds the line */ }
  const cell = (s) => String(s ?? "—").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 70);
  const rows = blocks.map((b) => `| ${cell(b.qid)} | ${cell(b.query)} | ${cell(b.state)}${b.error ? " ⚠ provider error" : ""} | ${b.total_hits ?? "—"} | ${b.fetched ?? 0} |`);
  const md = [
    `# Register unit: saturation-probe axis audit`,
    ``,
    `**Mark:** ${ctx.job?.markName ?? ctx.run.slug} | **Axis:** saturation-probe | **Run:** ${ctx.run.codename}`,
    ``,
    `**Mode:** deterministic code execution — the driver ran the frozen plan's dictated saturation-probe entries directly through the provider executor (the register_execute_plan lane). No model turn was involved; the band file is executor-written with every block qid-stamped.`,
    ``,
    ...(entries.length
      ? [`## Dictated entries executed (${entries.length})`, ``,
        `| qid | query | state | total_hits | fetched |`, `|---|---|---|---|---|`, ...rows]
      : [`## Scope`, ``,
        `The frozen plan carries no saturation-probe entries for this mark (no element flagged saturation: high/very-high) — the axis is vacuous this run and the band is an honest empty array.`]),
    ``,
    `## Coverage`,
    ``,
    `- Blocks in band: ${blocks.length} (${blocks.filter((b) => b?.state === "incomplete").length} incomplete descriptor(s), ${blocks.filter((b) => b?.state === "enumerated").length} enumerated)`,
    `- Band artifact: \`${basename(bandPath)}\` (executor-written, qid-stamped)`,
    ``,
    `Counts are dilution signals for Layer B judgment; the funnel makes no clearance calls.`,
    ``,
  ].join("\n");
  writeFileSync(`${out}.tmp`, md);
  renameSync(`${out}.tmp`, out);
}

// ── stage contracts (2026-07-30 review round) ──────────────────────────────────────────────────────
// _driver/stage-contracts.json records, PER STAGE, the output contract the prompt THIS driver
// dispatched holds the artifact to (declared on the stage def, e.g. clearance-variants
// `contract:{romanization:1}`). Written at DISPATCH time only — a skipped stage never gains one — so
// it is evidence of PROMPT VINTAGE, which is the only honest gate for a new validation rule:
//   - crash-resume: the skip check re-validates the completed output BEFORE any dispatch, marker
//     absent ⇒ the legacy artifact keeps passing under the rules it was minted under (no forced
//     re-run, no P2 staleness cascade, no paid recompute);
//   - replay over archives: nothing ever dispatches, marker absent ⇒ verdicts never flip;
//   - fresh/forced/corrective dispatch under this code: marker written first, so the output (and
//     every later re-validation of it) is held to the new floor.
// The instructed-scope sentinel must NEVER stand in for this: it is written at intake on every
// current-era run — archived and parked included — so it proves vintage, not freshness, and
// gating a new rule on it was proven (2026-07-30 review) to flip real archived verdicts and to
// force-re-run completed stages on resume. Idempotent merge; non-fatal like every _driver sidecar.
function recordStageContract(runDir, name, contract) {
  try {
    const p = paths(runDir).stageContracts;
    let cur = {};
    try { cur = JSON.parse(readFileSync(p, "utf8")) ?? {}; } catch { /* first write */ }
    const next = { ...cur, [name]: { ...(cur[name] ?? {}), ...contract } };
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(`${p}.tmp`, JSON.stringify(next, null, 2) + "\n");
    renameSync(`${p}.tmp`, p);
    runLog(runDir, { event: "stage-contract", stage: name, contract });
  } catch (e) { note(`stage-contract write failed (non-fatal): ${String(e?.message ?? e).slice(0, 80)}`); }
}

// Run one named stage on ONE model (single tier; runStage owns the same-model retry budget). opts:
// {model, thinking, force, extra, followup, sessionKey, agent, trigger, maxRetries}. Returns runStage's
// result (or a {skipped} marker). The cross-model fallback lives in stage() below — this is the leaf executor.
//
// `followup` is the cache-cheap re-run path: when set, we send ONLY that message (NOT def.message) under the
// stage's existing session key. Since the key is unchanged, the engine RESUMES the prior session — the model
// keeps its full prior context (warm cache: cache-READ, not a cold re-write) and is asked to defend/adjust
// rather than redo from scratch. CRITICAL: a followup must keep the SAME model the session was created with —
// cache is model-specific, so switching models cold-caches the whole thread and defeats the point. `extra`
// is the older append-to-original-prompt path, kept for callers that still re-issue.
/**
 * — THE PARK CONTINUES THE WORK, IT DOES NOT RESTART IT.
 *
 * A recovery park re-enters pipeline() from the top and re-dispatches the failed stage on its BASE session
 * key with `def.message(ctx)` — a cold re-commission. gateway.mjs mints `-rerunN` keys INSIDE one dispatch
 * and nothing carries them across a park; the key that would have to be resumed is not even recoverable
 * (recoverWinningAttempt only returns rows that SUCCEEDED, and a parked ladder has none). Measured on the
 * 2026-08-05 R2 run: both common-law halves converged to 1 and 2 violations, and the park restarted them
 * at 21 and 13, three times, until the defect budget ended the run.
 *
 * This hands the dispatch back the best draft the run has produced for this stage, with the outstanding
 * violations as the correction. It is the SAME repair the in-run merge-gate remedy already performs —
 * same dictated hint, same edit contract — extended to the one lane that never had it.
 *
 * WHAT IT REFUSES, and why each refusal is the point:
 *   · only a PATCH-class rejection is carried (draftCarryEligible → WARM_ELIGIBLE_RE). The tokens meaning
 *     "the sweep did not run" are excluded there deliberately: telling a model "do NOT redo the sweep"
 *     over an unsearched grid would manufacture a clean read over a grid nobody searched.
 *   · a draft written by a kill-class attempt was never preserved at all (gateway.mjs), so it can never be
 *     carried here — the artifact half of the never-patch-a-torn-file rule.
 *   · a draft is restored only when it BEATS what is on disk, scored by the stage's OWN validator so
 *     "better" is one comparison and not two rules. A tie restores nothing and only supplies the correction.
 *   · the violations are RE-DERIVED from the document that is now on disk — never replayed from the stored
 *     fail string, which described a file that may since have been superseded.
 *
 * Returns {message, from, quantity} or null. Never throws: a carry that cannot be built falls through to
 * today's cold dispatch, exactly.
 */
function planDraftCarry(ctx, label, out, def) {
  const P = ctx.paths;
  try {
    const best = readBestDraft(P.runDir, label);
    if (!best || !def?.validate || !draftCarryEligible(best.fail)) return null;
    let onDisk = null;
    if (existsSync(out)) {
      const v = def.validate(out, readFileSync(out, "utf8"));
      if (v.ok) return null;                       // already valid — the skip above should have taken it
      onDisk = Number.isFinite(v.quantity) ? v.quantity : null;
    }
    const restore = onDisk === null || best.quantity < onDisk;
    if (restore) copyFileSync(best.path, out);
    const v2 = def.validate(out, readFileSync(out, "utf8"));
    if (v2.ok) return null;
    const outstanding = Number.isFinite(v2.quantity) ? `${v2.quantity} item(s)` : "a small number of items";
    // — DERIVED FROM THE ARTIFACT, NOT FROM THE LABEL, the same source the lint-repair rung uses.
    // Six stages' outputs are now written by the driver off a typed call, and their seats hold neither
    // `Write` nor `Edit`; a carry that ordered a hand-write would be handing them the superseded path.
    // Keyed on `out` so a seventh conversion inherits it with its TOOL_WRITTEN_ARTIFACTS row.
    const toolWritten = toolWrittenArtifact(out);
    const message = repairFollowup("*:draft-carry", {
      out, restore, outstanding, reason: v2.reason, toolWritten,
    });
    runLog(P.runDir, { event: "draft-carry", stage: label, from: basename(best.path), restored: restore,
      quantity: Number.isFinite(v2.quantity) ? v2.quantity : null, priorOnDisk: onDisk,
      reason: String(v2.reason).slice(0, 200) });
    note(`[${label}] continuing the best draft (${outstanding} outstanding${restore ? `, restored over an on-disk draft at ${onDisk ?? "unscored"}` : ""}) instead of re-commissioning the stage`);
    return { message, from: best.path, quantity: Number.isFinite(v2.quantity) ? v2.quantity : null };
  } catch (e) {
    note(`[${label}] draft carry unavailable (${String(e?.message ?? e).slice(0, 100)}) — cold dispatch as before`);
    return null;
  }
}

function clearedForSeat(runDir, label) {
  try { return clearedSignatures(dispatchRows(readFileSync(driverDir(runDir, `${label}.jsonl`), "utf8"))); }
  catch { return []; }
}

/**
 * The context a stage's message is composed from. The review's floor check lists placement's standing decisions, and
 * they are read here, from the run's files, each time its message is built: the review, its recheck, the delivery
 * loop's whole review after a repeated placement pass and a review dispatched from a rebuilt context all read the
 * decisions as they stand then, never a copy an earlier pass left on the context, and never "(none)" from a context
 * that never set one. The reading step and the writer read placement's accepted set-asides the same way. Every
 * other stage composes from the context as it is.
 */
/**
 * The address list a whole review is handed, written where its recording tool reads it: the writer's accepted record
 * and the findings file together, so an ordinal from either numbering resolves, and the accepted narrative's sections.
 * IMPURE.
 */
function reviewAddressesFor(P) {
  const accepted = lastAcceptedCall(P.runDir);
  return writeReviewAddresses(P.runDir, { records: [accepted?.findings, safeReadJson(P.findings)], narratives: [accepted?.narrative],
    seq0: nextRefutationSeq(P.runDir) });
}
export function messageCtxFor(name, ctx) {   // @internal — driven by its test
  if (!ctx?.paths) return ctx;
  // The review is also pointed at the research behind the findings' use checks, where the writer's record wrote it.
  if (name === "narrative-refutation") return { ...ctx, placementFloorDecisions: placementFloorDecisionLines(ctx.paths),
    writerExclusions: writerExclusionBlock(ctx.paths, { review: "full" }),
    reviewAddressLines: addressListLines(reviewAddressesFor(ctx.paths)),
    researchChecks: ctx.paths.researchChecks && existsSync(ctx.paths.researchChecks) ? ctx.paths.researchChecks : null };
  // The reading step and the writer are told placement's accepted set-asides the same way, read when the message is built.
  if (name === "register-digest") return { ...ctx, placementSetAsides: placementSetAsideLines(ctx.paths) };
  // The writer is also handed the research this run's earlier stages and attempts got (research-answers.mjs), written to
  // the run folder when the message is built: none on a run that has asked nothing yet, whose message is unchanged.
  // A sandbox arm reproducing a FIRST attempt hands on nothing: its copy holds the run's own answers under this stage's
  // key, which a first attempt in a run never has (`researchHandOff`, set by the experiment).
  if (name === "synthesis") return { ...ctx, placementSetAsides: placementSetAsideLines(ctx.paths),
    researchAnswered: ctx.run && ctx.researchHandOff !== false ? handResearchAnswers(ctx.paths.runDir, stageSessionKey(ctx, name), { ofRun: true }) : 0,
    // The findings an earlier attempt saved, handed on as a file (synthesis-record.mjs): none on a first attempt, and none
    // in a sandbox arm, whose copy holds no saved findings.
    savedSynthesis: handSavedFindings(ctx.paths.runDir) };
  return ctx;
}

/** A stage's session key, which its retries extend with `-rerun<n>`. One statement, read where a stage is dispatched. */
export const stageSessionKey = (ctx, name, keyAxis = "") => `clearance-${ctx.run.slug}-${ctx.run.codename}-${name}${keyAxis}`;   // @internal

async function stageOnce(name, ctx, opts = {}) {
  const def = STAGES[name];
  if (!def) throw new Error(`unknown stage ${name}`);
  const P = ctx.paths;
  const out = def.out ? def.out(P, ctx.axis) : undefined;
  const tier = ctx.axis ? axisTier(ctx.axis) : {};
  const label = name + (ctx.axis ? `:${ctx.axis}` : "");
  const model = opts.model ?? def.model ?? tier.model;
  // — the stage's own start, captured before ANY work: before the freshness read, before the
  // snapshot, before the followup composition, before runStage. Capture it after the await instead and
  // every field is still present, every presence assertion still passes, and every interval is ~0ms — the
  // journal would then assert that a 14-minute half took nothing. Only a magnitude or overlap assertion
  // catches that, which is why the test for this is written as an overlap.
  const tDispatch = Date.now();

  // crash-resume / idempotency: skip if the output already exists and validates — unless explicitly forced or
  // selected by --from. `--from X` re-runs X..end even when their outputs are still valid.
  const forced = opts.force || forceFromActive(ctx, name);
  // P2 — a changed upstream artifact invalidates its consumers. The skip used to ask only "does my output
  // exist and self-validate?", so a resume that recomputed an upstream stage still shipped every consumer's
  // stale output (copper-vault, 2026-07-21). The dependency map is stages.mjs `stageInputs` — already
  // declared, already logged per stage; this consults it. Keyed on CONTENT, so a pure crash-resume (no
  // input bytes changed) still skips exactly as cheaply as before.
  const declaredInputs = () => stageInputs(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly });
  const freshness = forced ? { stale: false, changed: [] } : stageStaleness(P.runDir, label, declaredInputs());
  if (freshness.stale) {
    const why = freshness.changed.map((c) => `${c.name} ${c.was ?? "(absent)"}→${c.now ?? "(absent)"}`).join(", ");
    runLog(P.runDir, { event: "stage-stale", stage: label, changed: freshness.changed });
    note(`[${label}] stale — ${freshness.changed.length} input(s) changed since this output was produced (${why}); recomputing`);
  }
  // ── — AN UNDISCHARGED FLOOR DUTY IS PART OF "VALID" ──────────────────────────
  //
  // The stage's own validator and the delivery floor disagreed about one placement pass, and a parked run
  // fell into the gap: on resume the stage skipped as "present and valid" while the floor called that same
  // pass's duty undischarged. The seat was never dispatched again, so the duty became permanently
  // undischargeable and the run spent every remaining stage travelling toward a failure it was already
  // doomed to. Reconciled toward the stricter side — the predicate lives in floor-duty.mjs and is CALLED,
  // never copied, so the two judgements cannot drift apart again.
  const dutyBlocksSkip = !forced && (floorDutyBlocksSkip(P.runDir, name) || floorDutyOwedNow(P, name));
  if (dutyBlocksSkip) {
    note(`[${label}] NOT skipped — its floor duty is undischarged, so its output is not valid to reuse; `
      + "re-running so the seat can place the outstanding floor(s) or name them with a ground "
      + "(the placement form unions, so nothing already answered is lost)");
    runLog(P.runDir, { event: "stage-floor-duty-rerun", stage: label });
  }
  if (!forced && !dutyBlocksSkip && !freshness.stale && out && existsSync(out) && outputStands(def, out)) {
    // recover the winning key + served model so a later warm-resume (corrective re-synthesis / verdict re-check)
    // targets the attempt that ACTUALLY produced this output, not the base key on the primary model.
    const won = recoverWinningAttempt(P.runDir, label);
    note(`[${label}] skip — output already present and valid`);
    // outputMeta, NOT fileMeta (post-merge audit N2). `get_run` folds `stage` and `skip` rows into ONE
    // stages[] list, and server.mjs states that surface's contract unqualified: an absent output arrives
    // as {present:false}. A skip row written through fileMeta carried no `present` key at all — so a reader
    // holding the stated contract read `output.present === undefined` → falsy → "not produced" for an
    // artifact that is on disk AND passed its validator (which is the entire reason this branch ran).
    // It bites hardest on a RESUME after a recovery park or a rate-limit postpone, where most rows are
    // skips — i.e. on the babysit surface, in the middle of the shift where someone is watching it.
    runLog(P.runDir, { event: "skip", stage: label, trigger: "skip", model: won?.model ?? resolveModel(model), output: outputMeta(out), ...stageWallFields(tDispatch) });
    (ctx.skippedStages ??= []).push(label);   // V4-1: the lint receipt states which artifacts this delivery inherited
    recordTransition(ctx, name);   // advance the displayed step on resume too (monotonic; an unmapped stage records what it is, and moves no step)
    // `won ? won.key : …` (NOT `won?.key ?? …`): a recovered CODE-SIDE winner carries key:null on purpose —
    // falling back to opts.sessionKey there would re-mint the phantom session the null exists to suppress.
    return { ok: true, skipped: true, sessionKey: won ? won.key : opts.sessionKey, model: won?.model ?? model };
  }

  // The stage is DISPATCHING (never on the skip above): record the output contract this code's prompt
  // holds the artifact to, BEFORE the model runs, so a crash mid-stage still re-validates the partial
  // output under the rules it is being minted under. See recordStageContract's doc block.
  if (def.contract) recordStageContract(P.runDir, name, def.contract);

  // ── AND RECORD THAT THE RUN IS IN IT, AT THE SAME MOMENT ───────────────────────────────────────────
  //
  // The displayed step advanced only where a stage SUCCEEDED, so a run inside a stage that takes minutes
  // read as being in the previous one for the whole of it — a resumed run entered placement at 10:05Z and
  // still showed "Register sweeps" at 10:10Z, which reads as the run having gone backwards. Nothing
  // durable said a stage had STARTED: every stage record is written at completion, and the one start-time
  // signal goes to stderr and never reaches the trace. So no reader could derive it either.
  //
  // Here rather than at the dispatch below, because this is the line that already declares the stage is
  // dispatching, and every mutating path — corrective, followup, escalation, frame-reopen, stale-repair,
  // verdict-recheck — funnels through it. One declaration of entry, for the contract record and the
  // status alike.
  //
  // Safe against the two things that look like it should not be. `writeRunStatus` keeps the furthest step
  // ever reached, so an escalation re-run mapping to an earlier stage still cannot pull the stepper back;
  // and the bare `name` is passed exactly as the success path passes it, so a fan-out's axes go on
  // collapsing to one display step.
  recordTransition(ctx, name);

  // — THE PLACEMENT FORM IS ON DISK BEFORE THE SEAT IS ASKED ANYTHING, and it is written at the SAME
  // choke point every dispatch funnels through: the main path, the stale-repair path and the frame-reopen
  // path all reach the seat through here, and three separate pre-dispatch writes would be three chances
  // to disagree about what the seat was handed.
  //
  // ORDER MATTERS AND IT IS THE FAIL-CLOSED WAY ROUND (the lesson): the era stamp lands first, above,
  // so a form write that fails leaves a stamp saying a form was required and no form to fill — a named,
  // loud state — rather than no stamp at all, which would silently disarm the whole arm on exactly the
  // run it governs.
  //
  // A re-dispatch re-unions rather than blanking: the prior accumulator is the input, so the seat opens
  // the file already holding every tier it has placed so far, and a cold retry starts from the work
  // rather than from nothing. That is the R1 cure, one dispatch earlier than the wall rescue.
  if (name === "placement-inquiry" && def.contract?.placementForm) {
    try {
      const input = readPlacementFormInput(P.runDir);
      const priorForm = readPlacementForm(P.runDir);
      const u = unionPlacementForm({ rows: priorForm.rows, set_aside: priorForm.set_aside }, null, input);
      writePlacementForm(P.runDir, u.form);
      runLog(P.runDir, { event: "placement-form-written", trigger: opts.trigger ?? "fresh", rows: u.total,
        settled: u.settled, carried: u.carried, seatRows: u.seat_rows, unresolved: u.unresolved, setAside: u.set_aside,
        selectable: u.form.generated_from?.selectable_records ?? null });
    } catch (e) {
      note(`placement-form write failed: ${e.message} — the stamp is already armed, so the absence is loud rather than silent`);
    }
  }

  // PR-4 (compute-don't-author, D5) — snapshot-before-overwrite at THE stage choke point. Every mutating
  // path funnels through here (corrective / followup / escalation / frame-reopen / lint-repair /
  // verdict-recheck / coverage-closure / envelope / stale-repair / …), so ONE call site covers every
  // in-place overwrite: the prior output lands in _history/<ts>-<trigger>/ and compare.mjs starts working
  // the moment history is populated. The 2026-07-28 postmortem run's superseded narrative drafts were UNRECOVERABLE — only
  // sizes/shas survived in telemetry. Never fires for a shadowed --experiment (its ctx.paths already point
  // at the sandbox, and the canonical run must stay byte-identical anyway).
  const trigger = opts.trigger ?? "fresh";
  let priorSize = null;
  //: the gate used to be (forced || freshness.stale), which excluded the ONE path that reaches a
  // dispatch with an output already on disk and no snapshot — a re-dispatch over a PRESENT BUT INVALID
  // artifact. A stage that never passed writes no freshness stamp, so it is never "stale"; that is the
  // recovery-park case, and it is exactly where the superseded draft was worth keeping. It is why the
  // run this issue was filed from has no _history/ at all and its 1-violation draft exists nowhere.
  // Reaching this line means the skip at the top did NOT fire, so the condition below is now complete.
  if (out && existsSync(out) && trigger !== "experiment") {
    try { priorSize = statSync(out).size; } catch { /* best-effort */ }
    const reason = trigger === "fresh" ? "stale-recompute" : trigger;
    const snap = snapshotOutputs(ctx, name, reason);
    if (snap) {
      ctx.lastSnapshot = snap;
      runLog(P.runDir, { event: "output-snapshot", stage: label, trigger: reason, snapshot: basename(snap) });
    }
  }

  const keyAxis = ctx.axis ? `-${ctx.axis}` : "";
  // A-1 — followup/freshMessage COMPOSE, they no longer REPLACE.
  //
  // Both branches open a FRESH engine session (a new stage() call is attempt 1, and `resumeRef` is passed
  // only on a warm retry — `gateway.mjs`), so the patch text used to be the entirety of what a corrective
  // pass ever saw: no methodology pointer, no `opts.extra`, no pointer to the stage's own inputs. The old
  // comment here read "followup → resume the existing session with ONLY the follow-up (warm cache)" — the
  // design was sound on that premise and the premise was false. See the block above composeFollowup in
  // stages.mjs for the trace and the measured cost.
  //
  // The task order is deliberately NOT restored: `def.message(ctx)` stays out, because re-commissioning
  // the stage fights the followup's own "do NOT redo it". freshMessage (doc-44 — a standalone message on a
  // fresh session, dispatched as any fresh stage is: its one model, with the gateway's own retries) gets
  // the same composition for the same reason: it is equally a session with nothing in it.
  //
  // The declared inputs are filtered to what is ON DISK here, not in stages.mjs — that module is a pure
  // prompt table with no filesystem reach. An input missing from the line is an OPTIONAL input this run
  // never produced, which is the "or state why not" half of the contract.
  //: a caller-supplied followup/freshMessage always wins — the in-run remedies (the connotation
  // merge gate, coverage closure, frame reopen) carry a warm session and a better-targeted correction.
  // The carry fills the gap BEHIND them: a cold re-dispatch that would otherwise re-commission the stage
  // from def.message(ctx) and throw away everything the parked cycle achieved.
  // — WHAT THIS RUN HAS ALREADY CORRECTED FOR THIS SEAT. Read from `_driver/<seat>.jsonl`, the
  // same per-attempt record the acceptance criterion is written against, so the fix and its test
  // bind to one authority. Best-effort by construction: no log, an unreadable log or a damaged line
  // yields an empty list and the followup is byte-identical to what it was before.
  const carry = (opts.followup == null && opts.freshMessage == null && out)
    ? planDraftCarry(ctx, label, out, def) : null;
  const patch = opts.followup ?? opts.freshMessage ?? carry?.message ?? null;
  const message = patch != null
    ? composeFollowup(name, ctx, {
      followup: patch,
      extra: opts.extra ?? null,
      inputs: stageInputs(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly }).filter((f) => f && existsSync(f)),
      // — the run's own attempt record is the authority on what it has already corrected, and it
      // is read HERE because this is the one site that composes a followup. NEVER-KILL: an unreadable
      // or absent seat log yields no constraint and the dispatch is exactly what it was before.
      cleared: clearedForSeat(P.runDir, label),
      // The review after a delivery-check repair names the files that repair changed; every other dispatch
      // passes nothing and keeps its own inputs line.
      changedInputs: opts.changedInputs ?? null,
      // The reading step's and the writer's fresh sessions are given placement's accepted set-asides as they stand,
      // except a narrow repair: it fixes only the faults or objects it names, and the general order to check each
      // ground would widen it. Its inputs, the decisions file among them, are named as for any other.
      // The review holds no set-asides, and its context records the exclusions its full review was shown, so a
      // follow-up of it does not build one: that would move the record the reviews after it are compared with.
      decisions: NARROW_REPAIR_TRIGGERS.has(trigger) || name === "narrative-refutation" ? null : (messageCtxFor(name, ctx)?.placementSetAsides ?? null),
    })
    : (def.message(messageCtxFor(name, ctx)) + (opts.extra ? `\n\n${opts.extra}` : ""));
  // Every stage runs as the forwarding agent (derived from the queue location). An explicit opts.agent wins.
  const execAgent = opts.agent ?? ctx.agent;
  // thinking: ONLY Anthropic models get a --thinking token; a cross-provider model (gpt/gemini) NEVER does, so
  // it uses its own configured reasoning default. The Anthropic thinking tokens ("medium"/"adaptive"/"low"/"off")
  // are meaningless to gpt/gemini and risk a spurious rejection → a false fallthrough. This holds even when a
  // caller pins opts.thinking (e.g. a corrective resume of a fallback-won stage threads the primary's thinking).
  // opts.thinking still wins: a corrective resume threads the tier the ORIGINAL attempt ran at, and under an
  // A/B arm that value already carries the override — re-reading the env here would let a mid-run change
  // silently split one stage's attempts across two tiers.
  const effThinking = opts.thinking ?? thinkingFor(name, def, tier);
  const thinking = resolveModel(model).startsWith("anthropic/") ? effThinking : undefined;
  // corruption 4b — the haiku+adaptive guard, on the EFFECTIVE pair this dispatch is about to send.
  // `assertTierSanity()` runs once at run start over the static stage table, so it cannot see a pairing
  // assembled here from a runtime override: CLEAROTRON_STAGE_THINKING, a caller-pinned opts.thinking, or an
  // `--experiment --model haiku` over an axis whose tier is adaptive. Haiku 4.5 rejects adaptive and
  // bounces to sonnet, so those are exactly the dispatches that would measure sonnet and log haiku.
  // Evaluated on `effThinking`, not `thinking`: the anthropic gate above nulls the tier for a
  // cross-provider model, and a guard that reads the nulled value would go blind on the same overrides.
  assertEffectiveTier(label, { model, thinking: effThinking });
  // ── THE TIME LIMIT IS DERIVED FROM THE BAND THIS DISPATCH IS HANDED ─────────────────────────────
  //
  // `def.timeoutSec` was a constant chosen once against a band nobody recorded beside it, and on a
  // dense matter the two band-reading stages died AT their walls having written nothing. The base is
  // still the stage's own number; what the band decides is how far above it this dispatch may go. A
  // band at or under the reference returns the base untouched, so nothing already verified moves.
  const dispatchBand = bandSizeForStage(name, P);
  const derivedLimit = derivedLimitSec(def.timeoutSec, dispatchBand);
  // REFUSED BEFORE A SEAT IS DISPATCHED, not after the wall. A limit past the ceiling is a prediction
  // that this stage will be killed; starting it spends the whole prediction to arrive where the refusal
  // already is, and the refusal NAMES the band size, which is the finding a killed attempt never gives.
  if (limitExceedsCeiling(derivedLimit.sec)) {
    const reason = ceilingRefusal(name, derivedLimit);
    runLog(P.runDir, { event: "stage-input-over-ceiling", stage: name,
      inputBytes: derivedLimit.inputBytes, derivedLimitSec: derivedLimit.sec });
    throw new StageFailure(name, reason, undefined, { failClass: "deterministic" });
  }
  runLog(P.runDir, { event: "stage-limit-derived", stage: name, base: def.timeoutSec,
    inputBytes: derivedLimit.inputBytes, derivedLimitSec: derivedLimit.sec, basis: derivedLimit.basis });
  // The register picture this dispatch is handed, by content (derived-state.mjs), so a replay can tell whether it is
  // handed the same one. Never throws; [] when the stage's context reaches no derivation.
  const derivedState = derivedStateOf(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly });
  const r = await runStage(label, {
    agent: execAgent,
    message,
    model,
    thinking,
    // opts.sessionKey names the key a prior run won on (winning-key hardening), so a followup's records sit
    // beside it; else the canonical base key. No engine resumes by key (A-1): a followup is fresh either way.
    sessionKey: opts.sessionKey ?? stageSessionKey(ctx, name, keyAxis),
    timeoutSec: derivedLimit.sec ?? def.timeoutSec,
    derivedLimit,               // recorded on every attempt row: the size it was derived from, and the number
    stallSec: def.stallSec,     // per-stage stall override (heavy stages); undefined → global CLEAROTRON_STALL_MS
    expectFile: out,
    validate: def.validate,
    runDir: P.runDir, bandSize: dispatchBand,
    // ── — THE PRESENTING SIDE, RECOMPOSED PER ATTEMPT ────────────────────────────────────────
    //
    // A stage that declares `refreshCtx` is saying its dispatch text depends on state the run CHANGES
    // between attempts. The stage supplies the ctx change; this site composes the message, so a stage
    // never has to reach for its own `message` function.
    //
    // ONLY WHEN THERE IS NO FOLLOWUP PATCH. A followup is a composed correction aimed at a named defect;
    // replacing it with a re-presented base would discard the correction and re-run the turn that
    // produced it.
    //
    // It NARROWS what the seat is ASKED, never what the tool ACCEPTS: the spec sidecar stays frozen, so a
    // seat answering something it was no longer asked about is served from the ledger rather than refused
    // as out-of-list — and `still_open` keeps naming everything genuinely open.
    ...(patch == null && typeof def.refreshCtx === "function"
      ? { refreshMessage: () => def.message(messageCtxFor(name, def.refreshCtx(ctx))) + (opts.extra ? `\n\n${opts.extra}` : "") }
      : {}),
    // The caller's word that this is a followup: a FRESH session (A-1), journalled on every attempt row. At its
    // hard wall it takes the same one extended retry as any dispatch (gateway.mjs warmHardWallStop).
    followup: opts.followup != null,
    // copper-lattice re-route: a supplemental-lane register unit never sees register_enumerate — its
    // judgment additions ride register_propose_supplemental (contract-gated so frozen pre-flag resumes
    // keep the legacy lane; the band_block_unplanned validator is the backstop either way).
    ...(name === "register-unit" && ctx.registerPlan?.contract?.supplemental_lane
      ? { excludeTools: [REGISTER_ENUMERATE_TOOL] } : {}),
    ...(opts.maxRetries != null ? { maxRetries: opts.maxRetries } : {}),
    // The correction this dispatch is, when it is one: its save may add the finding for an excluded position its flags
    // name. Only the correction's own dispatches carry it.
    ...(opts.correction ? { correction: opts.correction } : {}),
  });
  // run.jsonl "stage" event carries the input→output LINKAGE telemetry (what this stage handed downstream),
  // the WHY (trigger), and the model — the per-attempt execution detail (wall/status/usage) is in _driver/<stage>.jsonl.
  // AD-4 (instrumentation house rule) additions, each three-valued so "did not happen" never reads as
  // "not recorded":
  //   inputs[].read — `inputs` is what the stage was OFFERED (its declared contract); `read` says whether
  //     the settled turn actually OPENED that file. See journalStageInputs for the three-valued rule and why
  //     a WARM PATCH or a capped gauge must journal null rather than a manufactured false.
  //     A followup does NOT (A-1): like opts.freshMessage, it is a standalone message on a fresh session,
  //     so its declared inputs genuinely were offered and `false` is earned. `followup` is still journalled
  //     on the row beside `warm` — `followup` is what the CALLER asked for, `warm` is what the gateway's
  //     retry ladder did with it, and neither implies the other — but only `warm` now suppresses the gauge.
  //   output — UNCONDITIONAL and three-valued via outputMeta (log.mjs): null = the stage declares no output;
  //     {present:false} = expected and NOT on disk; {present:true,sha,size} = what landed. It was fileMeta,
  //     which fabricated a {sha:null,size:0} record for an artifact that never existed.
  //   outputWritten — whether THIS dispatch emitted it (false = landed but inherited; null = not observed).
  const followupDispatch = opts.followup != null;
  runLog(P.runDir, {
    event: "stage", stage: label, trigger: opts.trigger ?? "fresh",
    // — THE MODEL THAT RAN, not the one that was assigned. This wrote `resolveModel(model)`, the
    // ASSIGNED alias resolved through the Anthropic-shaped catalog, so a codex run's skim line read
    // `anthropic/claude-sonnet-5` while the attempt row milliseconds away said `gpt-5.6-sol`. The truthful
    // values were never missing — they sat one file away in the attempt records — so this is a wiring gap,
    // not a measurement gap, and it made a whole round read as Anthropic once.
    //
    // Precedence is deliberate: the WIRE's word first (what the provider says it ran), the engine's own
    // resolver second (what was asked of it, resolved by the engine that owns the vocabulary), and the
    // catalog alias only as the last resort — which is the legacy value, so a path that reports neither
    // is exactly as informative as before and never less.
    ok: r.ok, attempts: r.attempts, fail: r.fail,
    model: r.modelWire ?? r.modelUsed ?? resolveModel(model),
    // — THE SELECTOR, kept separate from the truth. `model` answers "what ran", in the provider's
    // own vocabulary; this answers "what would re-spawn the writer", in the catalog's. One field cannot
    // be both, and the attempt that made it try is what reddened WS1b.
    //
    // Measured, and it narrows what this is for: `recoverWinningAttempt` reads the ATTEMPT telemetry
    // (`_driver/<stage>.jsonl`, `modelUsed ?? model`) and has never read this event, so no resume was
    // ever steered by the field above. This is written so a FUTURE reader of the stage row has the
    // selector without having to join another file — and so that `<selector> ?? model` is a real
    // fallback for pre-change artifacts rather than a promise.
    modelSelector: resolveModel(model),
    inputs: journalStageInputs(stageInputs(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly }),
      { reads: r.reads, followup: followupDispatch, readsTruncated: r.readsTruncated, warm: r.warm }),
    // written unconditionally so the nulls above are self-explaining: a reader never has to join another
    // file to learn WHY this row's `read` flags are null. `warm` joins them for the same reason — without
    // it a warm-patch row's nulls would send the reader to _driver/<stage>.jsonl to find out why, which is
    // exactly the join this trio exists to remove.
    followup: followupDispatch,
    readsTruncated: r.readsTruncated ?? null,
    warm: r.warm ?? null,
    ...(derivedState.length ? { derivedState } : {}),
    output: out ? outputMeta(out) : null,
    outputWritten: r.wrote ?? null,
    summary: r.json?.summary,
    ...stageWallFields(tDispatch),   // — the wall boundaries, so a wave member's cost is a fact
  });
  // P2 — record WHAT this output was produced from, so a later resume can tell whether it still holds.
  if (r.ok && out) writeStamp(P.runDir, label, stageInputs(name, P, { axes: ctx.axes, axis: ctx.axis, registerOnly: ctx.registerOnly }), { project: projectStageInput });
  // Re-asserted on success, and no longer the only advance: entry records the same transition above, so
  // this is what re-states the stage after a fan-out's concurrent axes have each written their own.
  if (r.ok) recordTransition(ctx, name);   // bare name → fan-out axes collapse to one display step (monotonic)
  // PR-4 — document-growth tripwire, keyed on TRIGGER so it covers BOTH growth loops (the lint-repair
  // "re-emit the COMPLETE updated file" cycle AND the skeptic/refutation corrective loop — the 2026-07-28 postmortem run's
  // overview grew 7.1×/6.1× under the first, its narrative 62KB→102KB under the second; a lint-scoped
  // tripwire would have missed the largest grower). A repair defends or corrects — it does not ADD: growth
  // beyond 35% or 20KB over the prior output is a document-growth-trip event that joins the
  // reasoning-integrity tripFlags (internal observability). It NEVER withholds delivery (reasoning-
  // tripwires posture: a trip forces the delivered status to carry the gap, nothing more).
  // What a trip MEANS changed when the corrective prompts moved to targeted edits (repair-contract.mjs):
  // a repair-shaped trigger — lint-repair, the corrective followups, a settlement flush — now instructs the
  // model to patch the lines the correction names and leave every other line byte-identical, so a document
  // that grows past these thresholds under one of them is evidence the edit direction was ignored and the
  // file retyped whole. That is a regression to alarm on, not the known noise it used to be. The triggers
  // that legitimately ADD are the stated exception (coverage-closure and the frame-reopen source sweep each
  // append a Negative-results row per variant × channel) and still read as ordinary growth.
  if (r.ok && out && priorSize != null && priorSize > 0 && trigger !== "fresh" && trigger !== "skip") {
    try {
      const afterSize = statSync(out).size;
      const growthBytes = afterSize - priorSize;
      const growthPct = Math.round((100 * growthBytes) / priorSize);
      if (growthBytes > 20 * 1024 || growthPct > 35) {
        runLog(P.runDir, { event: "document-growth-trip", stage: label, trigger,
          before: priorSize, after: afterSize, growthBytes, growthPct });
        note(`[${label}] document-growth-trip (${trigger}): ${priorSize} → ${afterSize} bytes (+${growthPct}%) — flagged for the reviewer, never withheld`);
      }
    } catch { /* observability only */ }
  }
  return { ...r, model };
}

// ── Lane-wedge whole-stage retry (teal-bastion 2026-06-15) ─────────────────────────────────────────
// gateway.runStage reclassifies a 0-token (never-admitted) timeout to `lane_wedge` — the serial gateway command
// lane was saturated (the all-agent heartbeat sweep + concurrent spawns), NOT a provider problem. Since the
// lane, not the model, is what jammed, the remedy is time: wait for it to clear and re-dispatch the whole
// stage, bounded. Per-attempt timeouts are NEVER shortcut. This is one of the three things that carry
// recovery (with the same-model retry ladder and the rate-limit postpone) now that the model-failover chain
// is deleted — nothing here changed with it; the env names keep CHAIN for compatibility.
// The retry count and the backoff were settable and nothing ever set them; step 3 made them the
// constants below.
const LANE_WEDGE_CHAIN_RETRIES = 2;   // step 3 — was a knob; no environment ever set it
const LANE_WEDGE_BACKOFF_MS = 60000;   // step 3 — was a knob; no environment ever set it
const laneWedgeSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── — A DOCUMENT NOBODY DICTATED IS A DOCUMENT NOBODY VALIDATED ─────────────────────────────────
// One R2 run dir was published carrying an 18 KB "Common-Law Findings Report" at a path no stage ever
// dictated, beside the 36 KB one that was — a reader cannot tell them apart by name, and the stray is
// the stale one. Nothing downstream could see it, because the run dir contents were never compared to
// the set of dictated artifacts.
//
// LOGS. Never deletes, never fails a run, never gates. Deleting a file a model wrote destroys evidence
// about that stage's behaviour, and failing the run turns a cosmetic defect into a lost clearance. Each
// stray is reported ONCE per run — it persists for every later stage, and a line per stage would bury
// the signal it exists to raise. A sweep that throws is swallowed whole: this must never be able to
// cost a run anything.
const strayReported = new Map();
// — the doctrine tree as it was when this run first looked. One snapshot per run dir; anything
// that appears after it appeared because a stage wrote it.
const doctrineBefore = new Map();
const readTreeDir = (d) => readdirSync(d, { withFileTypes: true });
function sweepDoctrineTree(ctx, stageName) {
  try {
    const P = ctx?.paths;
    const root = config.skillsDir;
    if (!P?.runDir || !root) return;
    if (!doctrineBefore.has(P.runDir)) { doctrineBefore.set(P.runDir, treeSnapshot(root, readTreeDir)); return; }
    const seen = strayReported.get(`${P.runDir}::doctrine`) ?? new Set();
    strayReported.set(`${P.runDir}::doctrine`, seen);
    for (const f of findStrayInTree(doctrineBefore.get(P.runDir), treeSnapshot(root, readTreeDir))) {
      if (seen.has(f)) continue;
      seen.add(f);
      // LOUD, and it names the tree rather than the file alone: a reader who has not met this defect
      // needs to know that the thing written to is the driver's doctrine INPUT, not scratch.
      note(`[doctrine-write] ${f} appeared under CLEAROTRON_INSTRUCTIONS_DIR (${root}) during this run — the doctrine `
        + `tree is an INPUT and nothing in a clearance has cause to write to it. First seen after ${stageName}; left in place.`);
      runLog(P.runDir, { event: "doctrine-write", stage: stageName, file: f, root });
    }
  } catch { /* a hygiene sweep must never be able to affect a run */ }
}

// — the STUDIO ROOT at its immediate-child level. Same shape as the doctrine sweep
// above and for the same reason: snapshot once, diff after each stage, say it loudly, never touch it.
// A matter directory that appears while a run is in flight was not created by that run — on the codex
// engine with the sandbox bypassed, a stage wrote its real output into a sibling whose slug was one
// letter off, and nothing said so until a human compared two directory listings by eye.
const matterBefore = new Map();
function sweepMatterSiblings(ctx, stageName) {
  try {
    const P = ctx?.paths;
    const root = config.studioRoot;
    if (!P?.runDir || !root) return;
    const own = basename(dirname(P.runDir));                 // this run's own matter directory
    if (!matterBefore.has(P.runDir)) { matterBefore.set(P.runDir, matterSiblings(root, readTreeDir)); return; }
    const seen = strayReported.get(`${P.runDir}::matter`) ?? new Set();
    strayReported.set(`${P.runDir}::matter`, seen);
    for (const { name, nearMiss } of findStrayMatterSiblings(matterBefore.get(P.runDir), matterSiblings(root, readTreeDir), { own })) {
      if (seen.has(name)) continue;
      seen.add(name);
      note(`[stray-matter] ${name} appeared under the studio root during this run${nearMiss ? ` and is ONE EDIT from this run's own matter "${own}"` : ""}`
        + ` — a clearance creates no matter directory but its own. First seen after ${stageName}; left in place.`
        + (nearMiss ? " A stage may have written outside its run directory; check it before reading its contents as a real matter." : ""));
      runLog(P.runDir, { event: "stray-matter", stage: stageName, name, nearMiss, own, root });
    }
  } catch { /* a hygiene sweep must never be able to affect a run */ }
}
function sweepStrayArtifacts(ctx, stageName) {
  sweepDoctrineTree(ctx, stageName);
  sweepMatterSiblings(ctx, stageName);
  try {
    const P = ctx?.paths;
    if (!P?.runDir) return;
    const seen = strayReported.get(P.runDir) ?? new Set();
    strayReported.set(P.runDir, seen);
    const entries = readdirSync(P.runDir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
    for (const s of findStrayArtifacts(entries, dictatedPaths(P, { halves: GRID_SEATS, axes: ctx?.axes ?? [] }), { runDir: P.runDir })) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      note(`[stray-artifact] ${s.name} — ${s.why}. First seen after ${stageName}; left in place.`);
      runLog(P.runDir, { event: "stray-artifact", stage: stageName, name: s.name, why: s.why });
    }
  } catch { /* a hygiene sweep must never be able to affect a run */ }
}

// ── THE GOODS EVIDENCE AS THE WRITER HAD IT (goods-evidence.mjs GOODS_EVIDENCE_AS_WRITTEN_FILE) ─────────────────────
//
// The delivery check compares a finding that says its goods are cut with the goods evidence the writer was given. That
// evidence is derived again with every band merge, and the first merge of a resumed pass reads the record bodies the
// run holds by then: a record the writer had as a cut search answer read as an official record, and the check found no
// outcome for a record it had handed to the repair, or no longer found a claim the repair left standing.
//
// So the evidence a cold dispatch of the writer is given is kept, as it stood when the dispatch began, once the stage
// has returned a record. A writer that skipped wrote nothing new and leaves the copy as it was. A followup, the delivery
// check's own repair among them, corrects a record written on the copy already kept, so it leaves the copy too: the
// check after that repair compares the corrected findings with what they were first written on. A writer dispatched
// with no evidence leaves no copy, so none can describe an earlier writer.
//
// The text of the evidence a cold writer dispatch is given, null where it is given none, and undefined where no copy is
// to be kept. Never throws.
export function goodsEvidenceForTheWriter(name, ctx, opts = {}) {   // @internal — driven by its test
  if (name !== "synthesis" || opts.followup || !ctx?.paths?.runDir) return undefined;
  try { return readFileSync(driverDir(ctx.paths.runDir, GOODS_EVIDENCE_FILE), "utf8"); } catch { return null; }
}
/** Keep the evidence `goodsEvidenceForTheWriter` read, once the writer's stage returned a record it wrote. Never throws. */
export function keepGoodsEvidenceAsWritten(ctx, r, evidence) {   // @internal — driven by its test
  if (evidence === undefined || !r?.ok || r.skipped) return;
  const at = driverDir(ctx.paths.runDir, GOODS_EVIDENCE_AS_WRITTEN_FILE);
  try {
    if (evidence == null) rmSync(at, { force: true });
    else { ensureDriverDir(ctx.paths.runDir); atomicWrite(at, evidence); }
  } catch (e) {
    note(`[synthesis] the goods evidence the writer was given could not be kept (${String(e?.message ?? e).slice(0, 100)}) — the delivery check reads the evidence as it stands`);
  }
}

async function stage(name, ctx, opts = {}) {
  const writersEvidence = goodsEvidenceForTheWriter(name, ctx, opts);
  let wedgeCycles = 0;
  for (;;) {
    const r = await stageWithChain(name, ctx, opts);
    if (r.ok || r.fail !== "lane_wedge" || wedgeCycles >= LANE_WEDGE_CHAIN_RETRIES) {
      sweepStrayArtifacts(ctx, name);
      keepGoodsEvidenceAsWritten(ctx, r, writersEvidence);
      await afterLateSynthesisSave(name, ctx, r);
      return r;
    }
    wedgeCycles++;
    note(`[${name}] command-lane wedge — the stage timed out with zero progress (saturated lane). Waiting ${Math.round(LANE_WEDGE_BACKOFF_MS / 1000)}s for it to clear, then re-dispatching (${wedgeCycles}/${LANE_WEDGE_CHAIN_RETRIES}); full per-attempt timeouts preserved.`);
    try { runLog(ctx.paths.runDir, { event: "lane-wedge-retry", stage: name + (ctx.axis ? `:${ctx.axis}` : ""), cycle: wedgeCycles, max: LANE_WEDGE_CHAIN_RETRIES }); } catch { /* telemetry best-effort */ }
    await laneWedgeSleep(LANE_WEDGE_BACKOFF_MS);
  }
}

// Dispatch a stage on THE model its definition resolves to. One model, one dispatch — everything below
// this line is the retry ladder inside runStage (same-model attempts, the one 1.5×-extended timeout shot,
// warm patch, backoff), the lane-wedge re-dispatch in stage() above, and the rate-limit postpone.
//
// It used to iterate a model-failover chain here (primary → same-family fallback → Azure → Google, advancing
// on a transient-infra failure). That chain is DELETED. It had never run: chainEntries returned
// exactly one entry for all 19 stages on both shipped engines, so the second rung, the `-fbN` fallback
// session key, the `failover` event and the `chain-exhausted` event were all unreachable. It was deleted
// rather than armed — see driver.config.mjs for the reasoning. The retry ladder is now the whole, honest
// failure story: below it a stage FAILS, loudly, and the run parks or reports.
//
// followups and explicitly model-pinned calls still delegate straight to stageOnce, on their own model. The
// reason given for followups was a resumed session's model-specific cache, which a fresh session does not have.
async function stageWithChain(name, ctx, opts = {}) {
  if (opts.followup || opts.model) return stageOnce(name, ctx, opts);
  const [entry] = chainEntries(name, ctx.axis);
  if (!entry) return {};   // no model resolves (a register-unit dispatched with no axis) — fails as before
  const { model, thinking } = entry;
  const r = await stageOnce(name, ctx, { ...opts, model, thinking });
  // On a SKIP, stageOnce already recovered the WINNING model/key from telemetry into r — do NOT clobber it
  // with this call's model/thinking. On a fresh success, this call's model IS the winner.
  return r.ok && !r.skipped ? { ...r, model, thinking } : r;
}

/**
 * A COVERED PART'S FAILURE IS NAMED WHERE IT IS THROWN (parts-not-completed.mjs). Runs `fn`, and a StageFailure it
 * throws is named as `part`, so the run-level catch, once the recovery is spent, records the part as not completed and
 * delivers without it instead of ending the run. A rate limit is not a failure and is left to its postpone; a failure
 * a throw site already named keeps its name.
 */
async function asPartNotCompleted(part, fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof StageFailure && !e.rateLimited && !e.notCompletedPart) e.notCompletedPart = part;
    throw e;
  }
}

function must(r, name) {
  //: the ladder's own count rides the throw — the stage knew the exact number, the catch would
  // otherwise have to read it back out of a prose reason.
  if (!r.ok) throw new StageFailure(name, r.fail ?? "failed", r.resetsAt, { quantity: r.quantity });
  return r;
}

// A3 — last-resort QUARANTINE for the synthesis findings.json. Reached ONLY after stage()'s full retry ladder
// (incl. the A2 corrective hints) has failed, so it never short-circuits a fixable run. It fires ONLY for a
// PER-FINDING shape defect (an `invalid_file:…:finding_*` token — NOT a top-level `findings_*`/unparseable
// failure) and ONLY when a lenient re-parse still yields >= 1 valid finding. In that case it drops+RECORDS the
// malformed finding(s) (run.jsonl `quarantine` event + a `_quarantine.json` sidecar — never silent) and lets
// the run reach publish (which renders the valid findings via the lenient parse + a loud banner, and BLOCKS
// the client export). findings.json on disk is left INTACT (forensics; no data-path mutation). Anything else —
// a top-level defect, or nothing salvageable — fails the run exactly as before. One bad object never silently
// suppresses a real conflict, and never silently kills a ~$40 run.
async function quarantineSynth(r, ctx, name) {
  if (r.ok) return r; if (foreignRecordLinksBlanked(r, ctx, name)) return { ...r, ok: true, fail: undefined, repaired: "foreign-record-links-blanked" };
  // A6: a max_tokens-named content fault wraps the underlying validator token — strip the wrapper so a
  // per-finding shape defect on a ceiling-cut turn still reaches the lenient-salvage lane.
  const fail = String(r.fail || "").replace(/^max_tokens_no_output:/, "");
  const eligible = /^invalid_file:/.test(fail) && /:finding_[a-z]/.test(fail) && !/:findings_/.test(fail);
  if (eligible && existsSync(ctx.paths.findings)) {
    try {
      const lenient = parseFindingsJsonLenient(readFileSync(ctx.paths.findings, "utf8"));
      let reemitAttempted = false;
      const marks = lenient.quarantined.map((q) => q.mark);
      const targetKey = marks.slice().sort().join("|").slice(0, 120) || "findings";
      if (lenient.quarantined.length) {
        // Repair-first A4 (2026-07-05): before any terminal, ONE warm single-artifact re-emit naming
        // ONLY the quarantined finding objects and their exact parse errors — the whole-file corrective
        // ladder already ran; what's left is a per-object shape miss the model fixes reliably when the
        // defect is named. Needs quarantined objects, NOT survivors (a one-finding file whose only
        // object is malformed is the most repairable shape of all). The stage validator re-judges
        // strictly; a pass IS the repaired stage result.
        const ledger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(ctx.run.runDir, { log: (o) => runLog(ctx.run.runDir, o) }));
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
        // second statement of the same rule, and two ends stating the same rule is how they drift apart.
        const reemitMax = 1;
        if (r.sessionKey && ledger.canAttempt("finding-corrective-reemit", targetKey, { max: reemitMax })) {
          reemitAttempted = true;
          runLog(ctx.paths.runDir, { event: "finding-reemit", stage: name, marks, errors: lenient.quarantined.map((q) => String(q.error ?? "").slice(0, 80)) });
          note(`[${name}] ${marks.length} finding object(s) failed the strict parse — one warm single-artifact re-emit naming exactly those objects`);
          const followup = repairFollowup("synthesis:finding-reemit", { findings: ctx.paths.findings, quarantined: lenient.quarantined });
          const rr = await stage(name, ctx, { force: true, sessionKey: r.sessionKey, model: r.model,
            thinking: r.thinking, trigger: "finding-reemit",
            followup: followup + stageCharter(name, ctx.depth, ctx.framework) });
          ledger.record("finding-corrective-reemit", targetKey, rr.ok ? "ok" : `failed: ${rr.fail}`, { max: reemitMax });
          if (rr.ok) return rr;
        }
      }
      // ── — THE ACTIONS REGISTER GETS THE SAME LEG, because it was reaching this lane already ──
      //
      // `eligible` above admits any `finding_[a-z]` token, and `finding_action_key_unknown` matches it.
      // So an ACTION defect has always entered here — into a lane whose only repair material is the
      // malformed FINDING objects. With none of those, the re-emit above never fired, the terminal
      // below never fired, and the stage exhausted: a paid run died after the whole corrective ladder
      // with the defect nameable and the seat never asked. Measured before this leg existed:
      //   res = { ok:false, failedStage:"synthesis", terminalKind:"exhausted",
      //           reason:"invalid_file:…/findings.json:finding_action_key_unknown:bogus_key" }
      //
      // A naming coincidence decided a code path. `finding_*` and `finding_action_*` are different
      // namespaces that share a prefix, and the author was already hand-excluding one neighbour
      // (`!/:findings_/`) — this is the one that was missed. The fix is not a tighter regex: it is that
      // the lane can repair what it admits.
      //
      // Same shape as the findings leg and deliberately so: ONE warm re-emit, naming exactly the
      // rejected objects and their exact errors, ledgered under its OWN key so an action repair and a
      // finding repair cannot spend each other's single attempt.
      if (!lenient.quarantined.length && lenient.actionsQuarantined.length) {
        const bad = lenient.actionsQuarantined;
        const actionKey = bad.map((q) => `${q.id ?? q.index}`).sort().join("|").slice(0, 120) || "actions";
        const ledger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(ctx.run.runDir, { log: (o) => runLog(ctx.run.runDir, o) }));
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
        // second statement of the same rule, and two ends stating the same rule is how they drift apart.
        const actionReemitMax = 1;
        if (r.sessionKey && ledger.canAttempt("action-corrective-reemit", actionKey, { max: actionReemitMax })) {
          reemitAttempted = true;
          runLog(ctx.paths.runDir, { event: "action-reemit", stage: name, ids: bad.map((q) => q.id),
            kinds: bad.map((q) => q.kind), errors: bad.map((q) => String(q.error ?? "").slice(0, 80)) });
          note(`[${name}] ${bad.length} action object(s) failed the strict parse — one warm single-artifact re-emit naming exactly those objects`);
          const followup = repairFollowup("synthesis:action-reemit", { findings: ctx.paths.findings, bad });
          const rr = await stage(name, ctx, { force: true, sessionKey: r.sessionKey, model: r.model,
            thinking: r.thinking, trigger: "action-reemit",
            followup: followup + stageCharter(name, ctx.depth, ctx.framework) });
          ledger.record("action-corrective-reemit", actionKey, rr.ok ? "ok" : `failed: ${rr.fail}`, { max: actionReemitMax });
          if (rr.ok) return rr;
        }
      }
      // ── — ASK_ANSWERS, THE LAST FAMILY THE LANE ADMITTED AND COULD NOT NAME ─────────────────
      //
      // Enumerated, not guessed: of every token the `finding_[a-z]` test admits, four families exist —
      // per-finding shape (~40, repaired above), `finding_action_*` (12, repaired above),
      // `finding_ask_answer_*` (5, HERE), and `findings_four_answers_*` / `findings_mark_assessment_*`
      // (9), which the existing `!/:findings_/` guard excludes deliberately. With this leg the lane's
      // admission set and its repair set agree on one population, which is the invariant asks for.
      //
      // Worth the repair rather than a clean refusal: `ask_answers` is the join to the FROZEN intake
      // asks, so a dropped one ships a question the client committed at intake unanswered.
      if (!lenient.quarantined.length && !lenient.actionsQuarantined.length && lenient.askAnswersQuarantined?.length) {
        const bad = lenient.askAnswersQuarantined;
        const askKey = bad.map((q) => `${q.index}`).sort().join("|").slice(0, 120) || "ask-answers";
        const ledger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(ctx.run.runDir, { log: (o) => runLog(ctx.run.runDir, o) }));
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
        // second statement of the same rule, and two ends stating the same rule is how they drift apart.
        const askReemitMax = 1;
        if (r.sessionKey && ledger.canAttempt("ask-answer-corrective-reemit", askKey, { max: askReemitMax })) {
          reemitAttempted = true;
          runLog(ctx.paths.runDir, { event: "ask-answer-reemit", stage: name, indices: bad.map((q) => q.index),
            errors: bad.map((q) => String(q.error ?? "").slice(0, 80)) });
          note(`[${name}] ${bad.length} ask_answers object(s) failed the strict parse — one warm single-artifact re-emit naming exactly those objects`);
          const followup = repairFollowup("synthesis:ask-answer-reemit", { findings: ctx.paths.findings, bad });
          const rr = await stage(name, ctx, { force: true, sessionKey: r.sessionKey, model: r.model,
            thinking: r.thinking, trigger: "ask-answer-reemit",
            followup: followup + stageCharter(name, ctx.depth, ctx.framework) });
          ledger.record("ask-answer-corrective-reemit", askKey, rr.ok ? "ok" : `failed: ${rr.fail}`, { max: askReemitMax });
          if (rr.ok) return rr;
        }
      }
      // ── — AND THE LANE MAY NOT ADMIT WHAT IT CANNOT NAME ────────────────────────────────────
      //
      // The guard that generalises past these three families. `eligible` is a regex over a failure
      // string; the repair material is the quarantine lists. When the regex says yes and they are empty,
      // the lane has admitted a defect it cannot describe to anybody — and the behaviour today is to
      // fall out of the `try` and let the original failure stand, which is indistinguishable from a
      // model that could not produce a valid file.
      //
      // The NEXT token to slip the `finding_[a-z]` prefix test gets this instead of silence.
      const targets = salvageRepairTargets(lenient);
      if (targets.total === 0) {
        runLog(ctx.paths.runDir, { event: "salvage-lane-no-target", stage: name, fail: fail.slice(0, 200) });
        throw new StageFailure(name,
          `${fail} — the salvage lane admitted this failure and has nothing to repair: no finding, action or ask_answers object is malformed. The eligibility test and the lane's repair material disagree about what this token means; fix the pairing, not the run`,
          undefined, { failClass: "deterministic" });
      }
      if (lenient.quarantined.length && lenient.findings.length >= 1) {
        // T3 (H3, doctrine flip): a finding still malformed after the corrective ladder is a
        // MACHINERY defect. The old quarantine-and-continue delivered best-effort with the client
        // export blocked — post-T3 that is a guaranteed delivery-preflight fail (a quarantined finding
        // closes the gate) reached only after burning the whole delivery phase. Fail HERE instead;
        // the _quarantine.json sidecar keeps the forensics.
        try { writeFileSync(join(ctx.run.runDir, "_quarantine.json"), JSON.stringify({ stage: name, fail, quarantined: lenient.quarantined, kept: lenient.findings.length }, null, 2)); } catch { /* sidecar is best-effort */ }
        runLog(ctx.paths.runDir, { event: "quarantine", stage: name, fail, dropped: marks, kept: lenient.findings.length, terminal: true });
        // failClass: with the targeted re-emit actually attempted, the defect reproduced through every
        // repair — deterministic, fail fast. Without it (no live session / ledger exhausted), leave the
        // class to the text guess ("unknown" ⇒ one park — the VENZY re-sample doctrine).
        throw new StageFailure(name, `${lenient.quarantined.length} finding(s) unparseable after corrective retries [${marks.join(", ")}] — a report never ships missing findings (the delivery preflight would refuse it anyway)`, undefined,
          reemitAttempted ? { failClass: "deterministic", repairs: [{ repair: "finding-corrective-reemit", target: targetKey, outcome: "failed" }] } : {});
      }
      if (reemitAttempted)
        throw new StageFailure(name, fail || "failed", undefined, { failClass: "deterministic", repairs: [{ repair: "finding-corrective-reemit", target: targetKey, outcome: "failed" }] });
    } catch (e) {
      if (e instanceof StageFailure) throw e;
      note(`[${name}] quarantine re-parse failed (${e.message}) — failing the run as before`);
    }
  }
  throw new StageFailure(name, fail || "failed");
}

async function runBatched(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// AD-2 A9 (E2E-R2) — placement's RULINGS TAIL, extracted verbatim: everything from the
// "### Coverage rulings & open questions" heading to the end of the file (per the placement-inquiry
// SKILL contract, that section and "### Open questions for the client / reviewer" close the file).
// Pure text→text so the extraction tests offline; "" when the heading is absent (a legacy or
// register-less run costs the dispatch nothing). Capped so a crowded band's rulings cannot balloon
// a followup dispatch — the cut lands on a line boundary and says so, never a silent mid-row chop.
export function extractRulingsTail(placementMd, { cap = 8000 } = {}) {   // @internal
  const text = String(placementMd ?? "");
  const m = text.match(/^#{2,4}\s*Coverage rulings\b.*$/im);
  if (!m) return "";
  const tail = text.slice(m.index).trim();
  if (tail.length <= cap) return tail;
  const cut = tail.lastIndexOf("\n", cap);
  return `${tail.slice(0, cut > 0 ? cut : cap).trimEnd()}\n\n[rulings tail truncated at ${cap} chars — the full text is in the placement file]`;
}

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
/**
 * — THE CHARTER: the depth directive a stage family's every dispatch must carry.
 *
 * The architecture's delivery rule: the directive is composed ONCE per run and rides every dispatch of
 * that family — fresh, corrective, re-dispatch — with the inclusion asserted at the call site.
 *
 * WHY A FOLLOWUP DISPATCH NEEDS IT AT ALL. A dispatch with no `sessionKey` is a fresh turn: the driver
 * rebuilds the whole message from `STAGES.<name>.message`, and the directive is in there. A dispatch
 * WITH a `sessionKey` sends its followup in place of that message — so it inherits nothing the
 * message builder produces. That is not a theoretical gap: it is how the delivered narrative came from
 * a pass carrying no directive at all while the fresh pass carried one.
 *
 * Composed from the same function the fresh dispatch uses, so the two are the same string rather than
 * two texts that agree today.
 */
export function stageCharter(stageName, depth) {   // @internal
  // SYNTHESIS CARRIES NO DEPTH RUNG ANY MORE: its per-finding write-up rules contradicted the synthesis call, which records
  // sections only (design, 2026-11-06). The placement inquiry's rung still rides every dispatch of that stage.
  const directive = stageName === "placement-inquiry" ? inquiryRungDirective(depth) : "";
  return directive ? `\n\n${directive}` : "";
}

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

// item 15a — the UPSTREAM repair arms. One entry per stage label that can turn up stale on the delivery
// path and is not a delivery-tail surface. Each re-runs exactly the stage the pipeline would have run,
// forced, under a `stale-repair` trigger.
//
// A MAP rather than a chain of ifs, and it is the honest scope statement: a label with no entry here is
// one this pass will NOT repair, so it stays stale and the delivery guard blocks — the pre-15a behaviour,
// for exactly the labels we have not costed. Adding a stage to the delivery path without adding it here
// silently reverts that stage to the park path, so the two belong side by side.
//
// A LABEL WITH NO ENTRY HERE IS ONE THIS PASS WILL NOT REPAIR: it stays stale and the delivery guard
// blocks, which is the pre-15a behaviour, kept for exactly the labels we have not costed.
//
// register-digest routes through runDigest, never a bare stage(): a bare call leaves the old machine
// ledger outvoting the rewritten prose (the WS-A finding), which would make the "repair" produce a run
// whose JSON and prose disagree.

// ── — the meaning-receipts audit, and it MUST survive a terminal run ───────────────────────────
// The gate now distinguishes a receipt the model never addressed (blocking) from one it addressed in a
// form that did not bind (advisory). An advisory is not a silent pass: it is a defect recorded against
// that receipt, and this is where it becomes readable off the run rather than inferable from a token
// that no longer names it.
//
// WHY IT ALSO FIRES ON THE FAILURE PATH. The two numbers this writes are the ones the sequencing
// ruling says the boundary gets tuned against — obligations carrying a written disposition that failed
// to bind, against obligations the model never addressed. Recorded only where the gate PASSED, they
// would be missing from exactly the runs that need explaining: a run that still goes terminal at
// `common-law-half:b` never reaches the merge seam, and the failure token deliberately carries only the
// blocking count. So this is called from both seams, and it reads whatever is on disk.
//
// WHICH ARTIFACTS. The merged pair when the merge happened; otherwise each half's own pair, because a
// terminal half is exactly the case worth measuring. A half whose last attempt was REJECTED leaves no
// document at its canonical path — the surviving copy is the preserved best draft — so that is read
// too, and `source` says which, since a best draft is the model's last work and not necessarily its
// final one. Best-effort throughout: an audit that cannot be written must never cost a run.
export function connotationAuditSeats(P, runDir) {   // @internal
  const seats = [];
  // B — the audit reads the ACCUMULATORS in `_driver/` (formSidecarPath), the same copies the gate
  // judges. The seat-facing mirrors this used to read died with the form path; reading a path nothing
  // writes would report every ruling as never made.
  // — `dispositions` IS CARRIED, not re-derived. The verdict ledger lives beside the accumulator
  // and `callRecordPaths` is the ONE function that knows where; handing it the accumulator path instead
  // would make this the second place that knows the layout, which is the drift `formSidecarPath`'s own
  // header was written about.
  if (existsSync(P.commonLaw) && existsSync(P.commonLawGrid))
    seats.push({ seat: "merged", source: "artifact", doc: P.commonLaw, grid: P.commonLawGrid,
      form: formSidecarPath(P.commonLawDispositions), dispositions: P.commonLawDispositions });
  else for (const h of GRID_SEATS) {
    const grid = P.commonLawGridHalf(h);
    if (!existsSync(grid)) continue;
    const canonical = P.commonLawHalf(h);
    const dispositions = P.commonLawDispositionsHalf(h);
    const form = formSidecarPath(dispositions);
    if (existsSync(canonical)) { seats.push({ seat: `half-${h}`, source: "artifact", doc: canonical, grid, form, dispositions }); continue; }
    const draft = join(bestDraftDir(runDir, `common-law-half:${h}`), basename(canonical));
    if (existsSync(draft)) seats.push({ seat: `half-${h}`, source: "best-draft", doc: draft, grid, form, dispositions });
  }
  return seats;
}

// EXPORTED FOR THE SAME REASON `connotationAuditSeats` IS: the seat resolution was testable and the
// numbers it produces were not, so the whole point — that the audit READS the verdict ledger — was
// asserted only in the pure functions it calls. A wiring that never runs in a test is a wiring nobody has
// seen work.
export function recordConnotationAudit(run, P) {   // @internal
  try {
    const seats = [];
    let didNotBind = 0, neverAddressed = 0, quotesUnbound = 0, recordedQueries = 0;
    // — the three numbers that make "never addressed" falsifiable. `unruledAll` is the TOTAL this
    // audit used to report under `obligationsNeverAddressed`, kept as its own field so the split can
    // never take a headline number to zero without a companion rising to meet it (the hazard, in the
    // very number is about).
    let unruledAll = 0, addressedNotDischarged = 0, ledgerCalls = 0, ledgerSeats = 0;
    const refusalReasons = {};              // — the LEDGER's reasons: every refusal and drop recorded
    const unruledRefusalReasons = {};       // — the reasons met by rows still UNRULED (the old map)
    const addressedRows = [];
    const callRows = [];                    // — every row the ledger touched, not only the unruled
    // — the refusals that named no row, so the two totals above reconcile on the page.
    const unattributedRefusals = { refused: 0, dropped: 0, reasons: {} };
    const rulingDrift = [];
    const reasonKeys = new Set();
    const queryTexts = new Set();   // — the executed query strings, deduped, beside the count of them
    const formDefects = [];
    // ── — DOES A CHARGED RATING CARRY ITS GROUNDS? RECORDED, NOT ENFORCED ───────────────────────
    //
    // Doctrine already asks for this in as many words: "rule `loaded` and use the note to state plainly
    // what you could not establish and what a human should look at" (clearance-common-law/SKILL.md). The
    // seat does not do it — e2e READ all 24 `loaded` notes in the corpus (not keyword-probed them) and
    // every one describes the material instead. `grounds-grammar.mjs` was built to measure exactly that,
    // proven against those real notes and against a planted violation, AND CALLED BY NOTHING. A check
    // nothing invokes is not a check, so this is the invocation.
    //
    // WHY IT RECORDS INSTEAD OF REFUSING, and this is a sequencing decision rather than a soft one. The
    // module's own header states the limit: its `grounds` arm has no real example to validate against,
    // "because the corpus contains no example of a note that states what could not be established". A
    // refusal built on an unvalidated positive arm would refuse the first seat that complies — and a row
    // refused forever is the live-lock, bought back at the price of the thing being fixed. So the
    // verdict lands in the artifact a reviewer already opens, the next real round supplies the positive
    // examples the arm lacks, and refusing becomes a decision with evidence under it.
    //
    // DEDUPED BY ROW. Every meaning row appears in the merged form AND in half-m's, so a raw count
    // double-reports — the same shape as the ledger fold below, and e2e's own corpus measurement
    // had to dedupe for the same reason.
    const groundsSeen = new Map();   // row id -> {verdict, why}
    // — `declined`, not `loaded`. The key names the population: rows where the seat said it could
    // not establish the reading. It counted every charged row until the ruling split, and a confident
    // `loaded` note DESCRIBES its material correctly — so the old number graded the right answer against
    // the wrong contract and read as a failure. Renamed rather than re-pointed silently: the field is in
    // an artifact a reviewer opens, and a key that keeps its name while changing its population is the
    // one shape nobody detects.
    const chargedNotes = { declined: 0, grounds: 0, description: 0, unclear: 0 };
    // ── — THE LEDGER IS FOLDED ONCE PER LEDGER, NOT ONCE PER SEAT ──────────────────────────────
    //
    // Every half resolves its verdict ledger through `callRecordPaths`, and that lands on ONE shared
    // `_driver/disposition-calls/` for the whole run — the halves' accumulators share a `_driver/`, so
    // `dirname(formSidecarPath(...))` is the same for all three. This loop then folded that one file
    // once per seat and summed the results into run-level maps: on a three-half run the histogram came
    // out at exactly 3x the ledger it claimed to count (283 events read as 849; `callRows` carried 300
    // entries for 100 distinct rows, each three times).
    //
    // IT HIDES ON A SINGLE-HALF RUN, where the multiplier is one and everything reconciles perfectly.
    // That is why the guard for this is a THREE-half fixture: an n=1 population cannot exercise a
    // per-seat multiplication at all.
    //
    // KEYED ON THE RESOLVED LEDGER PATH, not on the seat and not on a flag. If `callRecordPaths` ever
    // becomes seat-scoped, distinct seats produce distinct paths and this stops deduping on its own,
    // which is the behaviour you want from a guard against a layout it does not own.
    const auditSeats = connotationAuditSeats(P, run.runDir);
    const ledgerPathOf = (st) => (st.dispositions ? callRecordPaths(st.dispositions, 0).verdicts : null);
    const ledgerOwners = new Map();          // resolved verdicts path -> the seats that resolve to it
    for (const st of auditSeats) {
      const lp = ledgerPathOf(st);
      if (!lp) continue;
      if (!ledgerOwners.has(lp)) ledgerOwners.set(lp, []);
      ledgerOwners.get(lp).push(st.seat);
    }
    const foldedLedgers = new Map();         // resolved verdicts path -> the fold, computed exactly once
    for (const st of auditSeats) {
      const lp = ledgerPathOf(st);
      if (lp && !foldedLedgers.has(lp)) foldedLedgers.set(lp, foldCallVerdicts(readCallVerdicts(st.dispositions)));
    }
    // WHO A LEDGER-DERIVED ROW BELONGS TO. The ledger carries no seat — its records are {at, seq,
    // accepted, refused, dropped, overflow} and `ledgerRows` keys on row id — so stamping one seat onto
    // rows drawn from a ledger THREE seats share is attribution the file cannot support. It stays the
    // seat's name when exactly one seat owns that ledger (the merged-run case, which is most of them)
    // and becomes "shared" when several do, which is the only true answer available.
    const ledgerSeatLabel = (lp) => {
      const owners = ledgerOwners.get(lp) ?? [];
      return owners.length === 1 ? owners[0] : "shared";
    };
    const foldedIntoRunTotals = new Set();
    for (const st of auditSeats) {
      const rec = parsePrRiskResults(readFileSync(st.grid, "utf8"));
      // — THE AUDIT READS THE FORM THE GATE READS. It used to call the gate WITHOUT the seat's
      // rulings, so it re-read structurally-discharged obligations as violations and its two headline
      // numbers over-reported on every run that used the structured path. Now it is handed the same form,
      // and its numbers are the gate's numbers.
      const fp = st.form && existsSync(st.form) ? parseDispositionForm(readFileSync(st.form, "utf8")) : { rows: null, error: null };
      const conn = findConnotationViolations(readFileSync(st.doc, "utf8"), rec.length,
        { recorded: rec, form: fp.rows, formError: fp.error });
      // — the DECLINATION rows this seat ruled, classified once per row across every form that
      // carries it. A row whose id is blank is skipped rather than merged into one bucket: two unnameable
      // rows are not the same row, and collapsing them would under-count the population being measured.
      //
      // ONLY DECLINATIONS. The grounds grammar asks "does this note state what could not be established"
      // — which is the note contract for a declination and NOT the one for a confident charged ruling,
      // whose note is supposed to say what the material is. Run over both, it graded compliant notes as
      // `description` and the number meant nothing. The grammar is UNCHANGED; only its population is.
      for (const r of (Array.isArray(fp.rows) ? fp.rows : [])) {
        if (String(r?.ruling ?? "").trim().toLowerCase() !== DECLINED_RULING) continue;
        const id = String(r?.row_id ?? "").trim();
        if (!id || groundsSeen.has(id)) continue;
        groundsSeen.set(id, classifyGroundsNote(r?.note));
      }
      // The two states the sequencing ruling asks to be counted apart, in the form's vocabulary: a row
      // the seat WROTE that the gate cannot accept (a damaged form — the disposition exists and is
      // readable) against a row it never filled in at all.
      const damaged = conn.filter((v) => v.reason === "form_damaged");
      // — THE AUDIT'S HEADLINE NUMBER FOLLOWS THE SPLIT, OR IT SILENTLY GOES TO ZERO. `no_ruling`
      // used to be every unruled row; it is now the residual of four states. Filtering on the bare
      // reason after the split would report `obligationsNeverAddressed: 0` on the exact run that died
      // owing 75 — an absence read as a pass, on the number the round after this one will read.
      // `form_untouched` is ONE violation carrying the population in `count`, so it contributes its
      // count and not its length.
      const unruled = conn.filter((v) => CONNOTATION_UNRULED_REASONS.includes(v.reason));
      const counts = connotationAuditCounts(conn);
      const unruledTotal = counts.neverAddressed;
      // — THE THIRD STATE, OR IT IS COUNTED NOWHERE. A row that is ruled and whose quote does not
      // join is neither `form_damaged` nor `no_ruling`, so with two buckets it falls out of both and the
      // audit reports a run that owed nothing over a run that died owing something. R6's own evidence
      // number lives here: `obligationsNeverAddressed: 1` was that run's record of the row that killed it,
      // and under the split it is `quotesThatDidNotBind` instead. Additive — every existing reader of the
      // two fields above is unchanged, and the new field is the one the next round has to be told about.
      const unbound = conn.filter((v) => v.reason === "quote_unbound");
      // — WHAT THE SEAT ACTUALLY DID, from the per-call verdict ledger. Until this existed the
      // audit could only see the FORM, so a row refused 85 times with a correct reason each time was
      // indistinguishable from a row nobody ever answered — and it reported the second. The refusals
      // lived inside the seat's turn and nowhere else.
      //
      // READ, NEVER JUDGED. This does not decide whether a ruling is good; it decides whether the row was
      // ADDRESSED, which is a different question and the one that was unanswerable.
      // PRESENT and EMPTY are asked separately. The fold of an empty read is a perfectly good object, so
      // keying presence on it reported a ledger for every run that had never written one — an absence
      // reading as a presence, in the change built to stop exactly that.
      const ledgerPresent = Boolean(st.dispositions) && callVerdictLedgerExists(st.dispositions);
      const ledgerPath = ledgerPathOf(st);
      const ledger = ledgerPath ? foldedLedgers.get(ledgerPath) ?? null : null;
      // — the run-level maps below take each ledger ONCE. `split`, `unruled` and the per-seat
      // entry keep reading it per seat, because those JOIN it against the seat's own form and are
      // correctly seat-scoped; it is only the run-level accumulation that was multiplying.
      const foldIntoRunTotals = Boolean(ledgerPath) && !foldedIntoRunTotals.has(ledgerPath);
      if (foldIntoRunTotals) foldedIntoRunTotals.add(ledgerPath);
      const split = partitionUnruledByLedger({ unruledTotal, unruledRows: unruled.map((v) => v.row), ledger });
      recordedQueries += rec.length;
      // — NAME WHAT WAS COUNTED. This loop already walks every executed query string and keeps only
      // a reason key, so the artifact a reviewer opens to certify reported `recordedQueries: 61` and
      // no queries. The strings were never lost — they are in `_driver/grid-spec.json` (dictated) and in
      // `common-law-grid*.json` `extras.pr_risk[].query` (executed) on every run — but certifying a
      // sanitizer defect from the receipts file meant joining two other files first, and a reviewer who
      // does not know that reads the count as all there is. Additive: `recordedQueries` keeps its exact
      // meaning and `queries.length === recordedQueries` is the invariant.
      for (const e of rec) { reasonKeys.add(connotationReasonKey(e.query)); queryTexts.add(e.query); }
      didNotBind += counts.didNotBind;
      neverAddressed += split.neverAddressed;
      unruledAll += unruledTotal;
      addressedNotDischarged += split.addressed;
      if (foldIntoRunTotals) ledgerCalls += ledger?.calls ?? 0;   // — once per ledger, not once per seat
      if (ledgerPresent) ledgerSeats += 1;
      for (const r of split.rows) {
        addressedRows.push({ seat: st.seat, row: r.row_id, calls: r.calls, refused: r.refused,
          dropped: r.dropped, reasons: r.reasons, populationUnnamed: split.populationUnnamed });
        for (const [reason, n] of Object.entries(r.reasons)) unruledRefusalReasons[reason] = (unruledRefusalReasons[reason] ?? 0) + n;
      }
      // — TWO POPULATIONS, TWO NAMES. The map above is unchanged in every respect except what it is
      // called: it counts the reasons met by rows that are STILL UNRULED, which is the evidence for
      // `obligationsAddressedNotDischarged`, and it is correctly EMPTY when nothing is outstanding.
      // `refusalReasons` now means what its name says — every refusal and drop the ledger recorded.
      //
      // The rename is the fix, not a tidy-up. On R5 round 7a30934b the artifact carried
      // `refusalReasons: {}` beside a ledger of 193 refusals over 8 types, because everything had been
      // discharged by the end. Nothing was wrong with the number; the name promised the other population,
      // so an empty map read as "nothing was refused" and took the acceptance criterion C with it.
      if (foldIntoRunTotals) for (const [reason, n] of Object.entries(ledgerReasonHistogram(ledger)))
        refusalReasons[reason] = (refusalReasons[reason] ?? 0) + n;
      // — the part of that histogram that belongs to no row, kept separately so `refusalReasons`
      // and `callRows` can be reconciled by a reader instead of taken on trust.
      if (foldIntoRunTotals) {
        const un = ledgerUnattributed(ledger);
        unattributedRefusals.refused += un.refused;
        unattributedRefusals.dropped += un.dropped;
        for (const [reason, n] of Object.entries(un.reasons))
          unattributedRefusals.reasons[reason] = (unattributedRefusals.reasons[reason] ?? 0) + n;
      }
      // The per-row view of the same ledger. `addressedRows` stays scoped to the unruled∩ledger
      // intersection because that is what the note below describes — widening it would make that sentence
      // call discharged rows undischarged.
      if (foldIntoRunTotals) for (const r of ledgerRows(ledger)) callRows.push({ seat: ledgerSeatLabel(ledgerPath), ...r });
      // THE DRIFT DETECTOR RUNS OVER EVERY ROW IN THE LEDGER, not only the unruled ones. R5's drifted rows
      // were DISCHARGED by the time the run finished — a detector scoped to what is still outstanding
      // would have reported nothing on the run that produced the evidence.
      if (foldIntoRunTotals) for (const d of detectRulingDrift(ledger)) rulingDrift.push({ seat: ledgerSeatLabel(ledgerPath), ...d });
      quotesUnbound += counts.quotesUnbound;
      for (const v of damaged)
        formDefects.push({ seat: st.seat, row: v.row, result: v.result, namedQuery: v.query, detail: v.detail });
      // A quote that did not bind is a NAMED defect with a state, so it is recorded beside the form
      // defects rather than as a bare count — the state is what distinguishes "requote continuously" from
      // "you quoted something that is not there", and a reader of the archive cannot re-derive it.
      for (const v of unbound)
        formDefects.push({ seat: st.seat, row: v.row, result: v.result, namedQuery: v.query,
          detail: v.detail, quoteState: v.quote_state });
      seats.push({ seat: st.seat, source: st.source, recordedQueries: rec.length,
        // — per seat, in execution order, so a half that dropped a dictated query is readable
        // against its sibling without opening the grids.
        queries: rec.map((e) => e.query),
        dispositionsThatDidNotBind: counts.didNotBind, obligationsNeverAddressed: split.neverAddressed,
        quotesThatDidNotBind: counts.quotesUnbound,
        // — per seat, because a run with two halves can have one seat looping and one silent, and
        // one summed pair of numbers cannot tell those apart.
        obligationsUnruled: unruledTotal, obligationsAddressedNotDischarged: split.addressed,
        ledgerPresent, ledgerCalls: ledger?.calls ?? 0 });
    }
    if (!seats.length) return;                     // no pair on disk yet — an absence, and nothing to claim
    // — one row, one verdict, whichever forms carried it.
    for (const v of groundsSeen.values()) {
      chargedNotes.declined += 1;
      if (Object.hasOwn(chargedNotes, v.verdict)) chargedNotes[v.verdict] += 1;
    }
    const audit = {
      ts: new Date().toISOString(), recordedQueries,
      // — the run's distinct executed query strings. `recordedQueries` is the count and stays the
      // count; this is what it counted. Written unconditionally, so an empty sweep records [] rather
      // than omitting the key — absent and "ran and issued nothing" are different facts.
      queries: [...queryTexts],
      // — the second scale, recorded and gating nothing. See connotationReasonKey.
      distinctReasons: reasonKeys.size,
      dispositionsThatDidNotBind: didNotBind,
      obligationsNeverAddressed: neverAddressed,
      quotesThatDidNotBind: quotesUnbound,   //
      // ── — "NEVER ADDRESSED" IS NOW A CLAIM THAT CAN BE WRONG, AND SAY SO ────────────────────
      //
      // R5's park reported `obligationsNeverAddressed: 2` over two rows the seat had addressed 163 times
      // with a correct reason returned every time. The three buckets built to explain a non-accepted
      // disposition all read zero, truthfully — a refused row never reaches the form, so there was
      // nothing for them to count. The only field left standing described the one thing that had not
      // happened, and it sent the reader hunting the seat.
      //
      // `obligationsNeverAddressed` now means what it says: unruled AND absent from the verdict ledger.
      // `obligationsUnruled` carries the total it used to carry, so the two parts sum to it and neither
      // can drift to zero unnoticed. WITH NO LEDGER THE SPLIT IS INERT — `addressedNotDischarged` is 0
      // and `neverAddressed` equals the total, which is bit-for-bit the old number. Archived runs and
      // form-path runs keep their history; only a run that HAS the evidence gets the finer answer.
      obligationsUnruled: unruledAll,
      obligationsAddressedNotDischarged: addressedNotDischarged,
      // The histogram is the part that distinguishes a loop from a miss. `{anchor_unbound: 162}` on two
      // rows is an unsatisfiable instruction; `{anchor_unbound: 1}` is a seat that mistyped once.
      // — folded from the LEDGER. See ledgerReasonHistogram for the run that proved the difference.
      refusalReasons,
      // The population this field used to carry under the name above: reasons met by rows STILL UNRULED.
      // Empty is the RIGHT answer here whenever nothing is outstanding, and now it says so by its name.
      unruledRefusalReasons,
      // ITS OWN CARDINALITY, NAMED. The issue that found the empty histogram read
      // `distinctReasons: 14` as its count and concluded the map had been dropped after being counted.
      // It had not: `distinctReasons` is the SECOND SCALE — distinct executed query SHAPES, from
      // `connotationReasonKey` over the grid — and has nothing to do with refusal tokens. Two unrelated
      // numbers, one of them named `…Reasons`, one screenful apart. Naming both is the fix for that
      // reading; asserting they agree, which the issue asked for, would assert something false.
      distinctRefusalReasons: Object.keys(refusalReasons).length,
      addressedRows,
      // — the ledger's own per-row view. `addressedRows` above answers "which OUTSTANDING obligation
      // was addressed"; this answers "what did the seat call, and how did it end". On a run that
      // discharged everything the first is legitimately empty and the second is not, and having only the
      // first is what made a correct emptiness unreadable beside a wrong one.
      callRows,
      // ── — WHERE `refusalReasons` AND `callRows` DIFFER, AND WHY ─────────────────────────────
      //
      // `refusalReasons` totals the LEDGER; `callRows` totals the rows. They differ by exactly the
      // refusals the ledger recorded against no row — the seat addressed an obligation that does not
      // exist, so there is no row to hang the refusal on and inventing one would be worse than the gap.
      //
      // Written unconditionally, zeros and all. `{refused: 0, dropped: 0, reasons: {}}` says the two
      // totals agree; an absent key would say nothing, and this issue exists because a reader met two
      // numbers that disagreed by one with nothing on the page to explain it.
      unattributedRefusals,
      // ── — THE CHARGED RATINGS, AND WHETHER THEY SAID WHY ────────────────────────────────────
      //
      // `loaded` is the count of charged rulings; the other three partition it by whether the note met
      // the instruction. `unclear` is NOT a pass — a note that is neither recognisably grounds nor
      // recognisably a description is a finding, because a two-way classifier would have to guess and
      // guessing on prose is the instrument e2e warned about.
      //
      // Written on every run, zeros and all. `{loaded: 0, …}` says this run produced no charged rating,
      // which is a different fact from a run where nobody looked — and exists because one round's
      // zero was generalised to the corpus and the generalisation was false.
      chargedNotes,
      // ── THE GRAVEST FIND OF THE ROUND, AND IT IS NOT ABOUT COST ───────────────────────────────────
      //
      // A DETECTOR over rows whose legal conclusion moved across calls. R5 moved `benign` → `loaded` /
      // `off-topic` over 85 calls and back to `benign` on the resume, one seat, no regeneration boundary.
      // Had one of those 85 been accepted, the contradiction would have banked against 41 prior `benign`
      // calls and the audit would have been clean. Nothing normalises or resolves it — a seat is allowed
      // to correct itself, and choosing between two legal conclusions is not code's to do.
      rulingDrift,
      // An absence is a finding: no ledger and an empty ledger are different facts, and a reader of an
      // archived run must be able to tell "nothing was refused" from "we were not recording yet".
      ledger: { seatsWithLedger: ledgerSeats, seats: seats.length, calls: ledgerCalls },
      seats, formDefects,
      // — THIS FILE IS FINAL-STATE-ONLY BY CONSTRUCTION, and its field names are past tense.
      // It is re-derived from whatever pair is on disk and written as a whole-file overwrite, so nothing
      // accumulates across attempts. On a delivered run (2026-08-15) attempt 2 returned `quote_unbound=3`,
      // the repair landed, and the final write recorded `quotesThatDidNotBind: 0` — correct for that
      // instant, and a reader takes `quotesThatDidNotBind` as a fact about the RUN.
      //
      // `peak` carries the worst value this run ever recorded, folded from the file already on disk. A
      // run that converged 3 → 0 and a run that never had a defect are different facts and only one of
      // them was expressible. Fold, never reset: a lower current value must not erase the history, which
      // is the whole failure being fixed. Unreadable prior ⇒ this pass's own numbers, never zero.
      peak: (() => {
        let prior = {};
        try { prior = JSON.parse(readFileSync(paths(run.runDir).connotationReceipts, "utf8"))?.peak ?? {}; } catch { /* first pass, or unreadable — this pass IS the peak */ }
        const worst = (k, now) => Math.max(Number(prior?.[k]) || 0, Number(now) || 0);
        return { dispositionsThatDidNotBind: worst("dispositionsThatDidNotBind", didNotBind),
          obligationsNeverAddressed: worst("obligationsNeverAddressed", neverAddressed),
          quotesThatDidNotBind: worst("quotesThatDidNotBind", quotesUnbound),
          formDefects: worst("formDefects", formDefects.length),
          // — THE LOOP IS THE THING THAT MUST NOT CONVERGE AWAY. R5's two rows were discharged
          // after the park, so a final-state-only file would record the run as clean and lose the 163
          // calls entirely. That is the same erasure fixed for `quotesThatDidNotBind`, arriving
          // through the field that describes effort rather than outcome.
          obligationsUnruled: worst("obligationsUnruled", unruledAll),
          obligationsAddressedNotDischarged: worst("obligationsAddressedNotDischarged", addressedNotDischarged),
          ledgerCalls: worst("ledgerCalls", ledgerCalls) };
      })(),
    };
    const tmp = paths(run.runDir).connotationReceiptsJson;
    writeFileSync(tmp, JSON.stringify(audit, null, 2) + "\n");
    renameSync(tmp, paths(run.runDir).connotationReceipts);
    runLog(run.runDir, { event: "connotation-receipts", recordedQueries, distinctReasons: reasonKeys.size,
      dispositionsThatDidNotBind: didNotBind, obligationsNeverAddressed: neverAddressed,
      seats: seats.map((x) => `${x.seat}:${x.source}`) });
    if (didNotBind)
      note(`[connotation] ${didNotBind} form row(s) name a receipt that is not one of their own candidates: ${formDefects.map((v) => v.row).slice(0, 3).join(", ")}`);
    // — SAID OUT LOUD, because the whole defect was a number nobody could question. A row addressed
    // 85 times and still owed is a loop; the reason histogram is what says whether the instruction was
    // satisfiable. This is the line that was missing from R5's park.
    if (addressedNotDischarged) {
      const worst = addressedRows.reduce((a, b) => ((b.calls ?? 0) > (a?.calls ?? 0) ? b : a), null);
      note(`[connotation] ${addressedNotDischarged} obligation(s) were ADDRESSED and not discharged — not "never addressed": ${
        addressedRows.map((r) => `${r.row}×${r.calls}`).slice(0, 3).join(", ")}${
        worst ? ` — worst: ${worst.row} over ${worst.calls} call(s), ${Object.entries(worst.reasons).map(([k, n]) => `${n}× ${k}`).join(", ")}` : ""}`);
      // — `reasons` keeps its exact old value: this event is ABOUT the undischarged rows, so the
      // scoped map is the right one and swapping in the ledger-wide one would silently change what a
      // journal line has meant since. The ledger-wide map rides beside it, named.
      runLog(run.runDir, { event: "connotation-addressed-not-discharged", n: addressedNotDischarged,
        unruledTotal: unruledAll, neverAddressed, reasons: unruledRefusalReasons,
        ledgerReasons: refusalReasons, ledgerCalls });
    }
    if (rulingDrift.length) {
      note(`[connotation] ⚠️ ${rulingDrift.length} row(s) MOVED their ruling across calls — a later attempt asserted a different legal conclusion than an earlier one on the same row: ${
        rulingDrift.map((d) => `${d.row_id} ${d.rulingSeq.join("→")}`).slice(0, 3).join("; ")}`);
      runLog(run.runDir, { event: "connotation-ruling-drift", n: rulingDrift.length,
        rows: rulingDrift.map((d) => ({ row: d.row_id, seq: d.rulingSeq, calls: d.calls, accepted: d.accepted })) });
    }
  } catch (e) {
    try { runLog(run.runDir, { event: "connotation-receipts-failed", error: e.message }); } catch { /* nothing left to record with */ }
  }
}

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
 * THE CONDITIONS THE RECORD'S ACTIONS STATE, AS THE RECORD NOW STANDS. A repair can rewrite, withdraw or add a forward
 * legal step, and the list follows it: the entries the record's actions put there (`fromRecord`, by reason) are
 * replaced by the steps it states now (`now`, each `{ reason, clause }`, in the record's order), at the place the first
 * of them stood, or at the end where none stood. Every other entry keeps its place, and a step whose reason another
 * entry carries is left to that entry. Returns the index-aligned arrays as they now stand, the reasons the record now
 * holds there (`held`), and which reasons went and came. PURE.
 */
export function conditionsFollowingTheRecord({ reasons = [], clauses = [], fromRecord = new Set(), now = [] } = {}) {   // @internal — driven by its test
  const kept = [];
  let at = -1;
  for (const [i, r] of reasons.entries()) {
    if (fromRecord.has(r)) { if (at < 0) at = kept.length; continue; }
    kept.push([r, clauses[i]]);
  }
  const others = new Set(kept.map(([r]) => r));
  const placed = [];
  for (const n of now) {
    if (others.has(n.reason) || placed.some(([r]) => r === n.reason)) continue;
    placed.push([n.reason, n.clause ?? n.reason]);
  }
  const pos = at < 0 ? kept.length : at;
  const rows = [...kept.slice(0, pos), ...placed, ...kept.slice(pos)];
  const before = reasons.filter((r) => fromRecord.has(r));
  const clauseWas = new Map(reasons.map((r, i) => [r, clauses[i]]));
  const held = placed.map(([r]) => r);
  return { reasons: rows.map(([r]) => r), clauses: rows.map(([, c]) => c), held: new Set(held),
    withdrawn: before.filter((r) => !held.includes(r)), added: held.filter((r) => !before.includes(r)),
    restated: placed.filter(([r, c]) => before.includes(r) && clauseWas.get(r) !== c).map(([r]) => r) };
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

// (T3a, ruling 2026-08-26 — "Deliver always, with open points printed. The refusal on a blocking
// review goes." That REVERSES T3, which had retired "delivered-with-open-questions" and deleted
// the extra this comment used to be a tombstone for. Both decisions are the owner's; this is the standing
// one. The open points are no longer a dispatch extra a seat writes up: `buildReviewerOpenPointsSection`
// renders them at assembly, code-built from senior-eye-review.md through the shipped parsers, on the
// "code wins" doctrine — the one seat that must not be asked to summarise the reviewer's
// objections is the seat the reviewer objected to.)

// Run refutation. narrative-refutation is opus-primary (Phase-4); the standard cross-provider chain (stage())
// handles route fallback automatically — opus → Azure → Google — each on a fresh `-fbN` key, so this needs no
// bespoke fallback wiring. Returns {ok, verdict, key, model, thinking} — key/model/thinking
// identify the WINNING attempt so the verdict-gate re-check can RESUME it warm (A1) rather than cold-restart
// on the base key / re-try the known-bad route. (--from is auto-honored inside stageOnce's forceFromActive.)
// WS2 (B4) — the DETERMINISTIC PLAN-EXECUTION CHECK (the B2 pre-check precedent): in plan
// mode the reviewer receives the frozen plan's execution receipt as a table and MUST audit it.
// T1 (J3): the section DEMAND is UNCONDITIONAL whenever the receipt exists — the validator
// keys on receipt existence, so the old best-effort demand that silently dropped guaranteed a 3×
// plan_audit_missing fail (copper-spire). Only the receipt TABLE stays best-effort.
//
// review — WHAT AN UNPARSEABLE RECEIPT ACTUALLY DOES, corrected. This said it "fails loud (the
// attachProfile posture)". It does not, and never did on either path: the throw below is a
// StageFailure and `composeDispatchExtra` catches every builder throw, so the block silently vanished
// from the dispatch while the prompt kept promising it. The throw stays — it is the honest signal —
// but the loudness now lands where it changes an outcome: the composer RECORDS the failure in `failed`
// instead of only logging it, the stage's own prompt names the fault and forbids reading the missing
// table as a clean register, and the dispatch receipt distinguishes a block that broke from one that
// never existed. Loud to the seat and to the reader of the receipt, without losing a production
// dispatch over one additive prompt block.
//
// Shared by the fresh refutation AND every recheck path that rewrites the review — the
// validator judges each rewrite identically, so each rewrite must carry the demand.
// ── A2 (addendum 2026-07-30): the skeptic receives the coverage ledger and the plan-execution
// receipt as DATA ─────────────────────────────────────────────────────────────────────────────────
//
// The skeptic's job includes deciding which axes to ESCALATE, and escalation spends money. It was
// given the two findings files and the manifest, and nothing else — so on the 2026-07-30 evidence run
// it re-derived the Coverage ledger out of a 103 KB prose document, spent 28,592 thinking tokens (95%
// of its emission) doing it, got it wrong, and escalated two axes whose slices the provider cannot
// express at all. Both artifacts existed on disk the whole time, machine-written and exact.
//
// The charter's principle in one function: computed things reach the next stage as DATA, not prose.
// The block is a TABLE, not an instruction to go and read files — the paths are named as the
// authority (stages.mjs also lists them as inputs) but the rows are already here, so nothing has to
// be re-derived to answer the escalation question. Best-effort by construction: the skeptic is
// non-fatal and a missing block only returns it to the prose it reads anyway.
export function skepticDeferralExtra(ctx) {   // @internal
  const P = ctx.paths;
  try {
    const rows = loadCoverageLedger(P.runDir).rows;
    const receipt = readPlanExecution(ctx);
    if (!rows.length && !receipt) return "";
    const gapAxes = capabilityGapAxes(ctx.registerPlan, receipt);
    const fullyDeferred = new Set((ctx.registerPlan ? fullyDeferredAxes(ctx.registerPlan) : []).map((a) => String(a.axis).toLowerCase()));
    const axes = [...new Set(rows.map((r) => String(r.axis ?? "").toLowerCase()).filter(Boolean))];
    const heldUnits = stickyGapUnits(P);
    const ledgerLines = coverageLedgerTableRows(rows);
    const held = [], closeable = [];
    for (const a of axes) {
      const s = splitDeferredByCloseability(rows, a, gapAxes, { fullyDeferred: fullyDeferred.has(a), heldUnits, uncovered: officeGapOf(ctx.registerPlan), askable: askableOf(receipt) });
      for (const r of s.held) held.push(`${a} / ${r.unit} — ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
      for (const r of s.closeable) closeable.push(`${a} / ${r.unit} — ${String(r.reason ?? "").replace(/\s+/g, " ").slice(0, 160)}`);
    }
    const deferredList = Array.isArray(receipt?.deferred) ? receipt.deferred : [];
    const deferredQids = deferredList.slice(0, 24)
      .map((d) => `- ${d.qid} — ${String(d.reason ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
    const more = deferredList.length > 24 ? [`- …and ${deferredList.length - 24} more (read ${P.planExecution} for the rest)`] : [];
    // THE CLASSES THE FRAME ADDED, AND WHAT EACH RETURNED. This block names what was refused and what is
    // open, and nothing that ran, so a class the frame added beyond the instructed ones — asked and
    // answered with its records listed — was absent from it, and the skeptic reported it as never swept.
    const addedClassRows = (ctx.registerPlan?.entries ?? []).filter((e) => e?.added_class_reason).map((e) => {
      const ran = (receipt?.executed ?? []).find((x) => x.qid === e.qid);
      const answer = ran ? `${ran.state}${Number.isFinite(ran.records) ? `, ${ran.records} records` : ""}`
        : (receipt?.deferred ?? []).some((d) => d.qid === e.qid) ? "refused (listed above)"
        : (receipt?.missing ?? []).includes(e.qid) ? "not run (missing)" : "not in the receipt";
      return `- ${e.qid} (class ${(e.nice_classes ?? []).join(", ")}) — ${answer}`;
    });
    const ownerNegative = ownerScreenNegative(readOwnerScreen(P));
    return lines(
      `COVERAGE + EXECUTION, DRIVER-COMPUTED — do NOT re-derive any of this from the findings prose. These rows come from ${P.registerCoverageLedger} and ${P.planExecution}, the machine artifacts the driver wrote; both are also yours to read directly, but the answer to "what is still open, and can a re-run close it" is already below.`,
      "",
      "Coverage ledger (axis | unit | status | reason):",
      ...(ledgerLines.length ? ledgerLines : ["| (no machine ledger rows — the ledger is prose-only this run) |"]),
      "",
      deferredQids.length
        ? lines(`Plan-execution receipt — queries the ACTIVE PROVIDER REFUSED deterministically (${deferredList.length} of ${(receipt.executed?.length ?? 0) + deferredList.length + (receipt.missing?.length ?? 0)} planned), with the mechanical reason per query:`, ...deferredQids, ...more)
        : "Plan-execution receipt: no query was deterministically refused by the provider this run.",
      addedClassRows.length ? lines("", "Classes the frame added beyond the instructed ones — each question, and what it returned:", ...addedClassRows) : "",
      "",
      closeable.length
        ? `CLOSEABLE floor obligations (a warm re-run reaches these — escalate them if they are material): ${closeable.join("; ")}.`
        : "CLOSEABLE floor obligations: none.",
      held.length
        ? `NOT CLOSEABLE — a re-run cannot close these: ${NOT_CLOSEABLE_KINDS}: ${held.join("; ")}. Do NOT emit ESCALATE for these. They stay open, disclosed gaps for the lawyer, and the coverage floor is right to refuse a clean verdict over them — say so in a flag if the findings read them as clean, but never as an escalation.`
        : "NOT CLOSEABLE: none.",
      // the owner screen's own receipt rides the same block — the audit claim it replaces ("no record
      // anywhere in the band carries an incumbent-class qid") was false on the evidence run.
      ownerNegative ? `\n${ownerNegative}` : "",
    );
  } catch (e) {
    note(`skeptic deferral data skipped (non-fatal): ${String(e.message).slice(0, 80)}`);
    return "";
  }
}

/**
 * B2 — the deterministic registry-fidelity check over the NARRATIVE, as a prompt block.
 *
 * Lifted verbatim out of `refute` ( corruption 2): it was composed inline at the dispatch site, so
 * it existed only on the production path and an `--experiment narrative-refutation` arm never carried
 * it. It is now a registry builder like every other driver-computed block — ONE composer, called by
 * `refute()` and by the sandbox alike, which is what makes the two prompts the same prompt.
 *
 * Reads `ctx.paths.runDir`, NOT `ctx.run.runDir`. Identical in production (they are the same directory)
 * and the whole point in a sandbox, where `ctx.run` still names the canonical run: reading that would
 * have the arm check its narrative against the canonical run's records and write `_records/` back into
 * the run it is supposed to leave byte-identical.
 *
 * PRESENCE-parity, not byte-parity, and that is stated rather than hoped: this block is a function of
 * the narrative ON DISK NOW, and by arm time a corrective cycle may have rewritten it. So the arm can
 * carry the same block, computed the same way, over different bytes — which is honest. What can never
 * happen again is the block being absent while the comparison run had it.
 */
function refuteRegistryCheckExtra(ctx) {
  try {
    const P = ctx.paths;
    const narrative = existsSync(P.narrative) ? readFileSync(P.narrative, "utf8") : "";
    if (!narrative) return "";
    const recordsByUri = assembleRunRecords(P.runDir, `clearance-${ctx.run.slug}-${ctx.run.codename}-`).records;
    const probs = [
      ...findRegistryArithmeticIssues(narrative).map((a) => `${a.block}: ${a.detail}`),
      ...findRegistryViolations(narrative, recordsByUri).filter((v) => v.kind === "mismatch")
        .map((v) => `${v.block}: ${v.field} says "${v.claimed}" but the fetched record (${v.uri}) says "${v.record}"`),
    ];
    if (!probs.length) return "";
    return lines(
      `DETERMINISTIC REGISTRY CHECK (B2): the code-level registry-fidelity checker found these structured-field problems in the narrative — treat each as a real defect a reasoning review MUST cover (the number/date-swap class). Verify against the fetched record and require correction in your verdict + flags:`,
      ...probs.map((p) => `- ${p}`),
    );
  } catch (e) { note(`refute registry pre-check (non-fatal): ${e.message}`); return ""; }
}

/**
 * Rule 1 of the two-register rule, over the clearance's default-visible lines, as a prompt block.
 *
 * ADVISORY, AND IT STAYS ADVISORY. A hit is a rewritten sentence in the reviewer's own flags — never a
 * disclosure to the client, never a run failure. It moves no band, no evidence and nothing that is
 * searched. That is the whole reason it rides THIS stage rather than the pre-delivery lint: the
 * reviewing pass already quotes a sentence and hands back the rewrite, in the voice it uses for
 * everything else, and it reaches the writer instead of the reader.
 *
 * THE DRIVER MEASURES, THE SEAT JUDGES. `plainRegisterFlags` is deterministic; this block reports what
 * it found — which line carries a word of the profession's, and how long a sentence ran. Whether the
 * sentence is actually wrong, and what replaces it, is the reviewer's call. The decision this
 * implements rejects a word list AS THE MECHANISM, so the block hands the seat evidence and never a
 * verdict: half these words are ordinary English and several are plausible marks.
 *
 * AND IT IS BLIND TO THE RUN'S OWN NOUNS. Every mark, variant and owner the run is about is blanked
 * before the text is read, because a check that flagged the mark being cleared would put its noise on
 * the one report where it matters most — the same defect one level in that turned "AXIS Bank filed in
 * class 36" into "group Bank filed in class 36" on a report clearing AXIS.
 *
 * WHY THE FIELDS ARE THE RECORD'S OWN KEYS, AND WHAT THAT USED TO SAY. This block could not use
 * `DEFAULT_VISIBLE_FIELDS.clearance`, because that list named fields no record carried — iterating it
 * would have opened nothing and reported a clean result over text it never read, which is the
 * absence-as-pass this block exists to avoid.
 *
 * That list is repaired now: every entry is a path that resolves against a delivered record, and an arm
 * resolves each one. The keys below are still written out rather than read from it, because this block
 * needs the `where` label it puts in front of each hit and the list carries paths and not labels. The
 * two agree on the surfaces, and the arm that resolves the list is what keeps that true.
 *
 * The old wording here also stated the defect slightly wrong, and said so about the field it was most
 * likely to mislead on: `thirdPartyRights` was called dead "in either casing" when the record carries
 * `four_answers.third_party_rights`, in fourteen files. Checking a name in one casing and reporting it
 * absent in both is the same error one level down from the one this paragraph is about.
 *
 * An absent or malformed findings.json yields no block, and the composer records the id as not built —
 * so "nothing to say" and "could not look" are told apart on the dispatch receipt rather than inferred.
 */
function plainRegisterExtra(ctx) {
  try {
    const P = ctx.paths;
    if (!existsSync(P.findings)) return nothingToRead(`no findings record at ${P.findings}, so no visible line was read`);   // NOT the same nothing as the one below: this never read a line
    // ABSENT IS NOT CORRUPT, and the composer already tells them apart — so let a parse failure THROW.
    // Swallowing it here would return "" and land the id in neither `ids` nor `failed`, which reads on
    // the dispatch receipt as "this run had nothing to say" over a record nobody could open. The file
    // being missing is the legitimately empty case and returns above; a record that exists and will not
    // parse is a real defect, and the receipt should carry it.
    const doc = parseFindingsJson(readFileSync(P.findings, "utf8"));

    // ONE MARK IS ONE MARK. An order names its mark in `marks` and again in `markName`, so the list held it
    // twice and the seat was told a run about one mark was about 2 (seen on a saved test run, 2026-10-29).
    // Deduped on the key the exclusion blanks by, trimmed and in any case, so the count is the number of
    // names removed before reading.
    const markKeys = new Set();
    const about = {
      marks: [
        ...(Array.isArray(ctx.job?.marks) ? ctx.job.marks.map((m) => (typeof m === "string" ? m : m?.name)) : []),
        ctx.job?.markName, ctx.job?.name,
      ].filter((x) => typeof x === "string" && x)
        .filter((x) => { const k = x.trim().toLowerCase(); if (!k || markKeys.has(k)) return false; markKeys.add(k); return true; }),
      owners: (doc.findings ?? [])
        .flatMap((f) => [f?.owner, f?.owner_name, f?.owner?.name])
        .filter((x) => typeof x === "string" && x),
    };

    // The surfaces a clearance reader meets before opening anything, named one by one so adding a
    // field to the page is a deliberate addition here too.
    const visible = [];
    const add = (where, v, field = null) => { const t = String(v ?? "").trim(); if (t) visible.push({ where, text: t, field }); };
    for (const f of doc.findings ?? []) add(`conflict ${f?.ordinal ?? "?"}'s finding sentence`, f?.net, "net");
    // The lines that are not a finding, labelled by `reportLines` — the labels the corrective cycle's
    // observation joins a flag back to, so what the reviewer is handed and what the driver reads agree.
    for (const l of reportLines(doc)) add(l.label, l.text);

    // A FINDING SENTENCE IS AT MOST TWO SENTENCES, so its length hit cannot say "split it": a finding sentence
    // already at two would be told to grow a third. What does not fit goes to the legal and practical
    // positions, in the approved paragraph's own words. Every other visible line, and the knockout's, keeps the
    // shared hit word for word — `plainRegisterFlags` is not changed.
    const findingSentenceLength = (n) => `${n} words in one sentence, and a visible line takes ${SENTENCE_WORD_LIMIT}. The finding sentence is at most two sentences: every fact that does not fit goes in the legal and practical positions, never dropped.`;
    const hits = [];
    for (const { where, text, field } of visible) {
      for (const flag of plainRegisterFlags(text, about)) {
        hits.push(`- ${where} — ${field === "net" && flag.kind === "length" ? findingSentenceLength(flag.words) : flag.say}`);
      }
    }
    if (!hits.length) return nothingFound(`no plain-words flag over ${visible.length} visible line(s)`);   // a NEGATIVE FINDING, and the count travels with it so a clean read is not a read of nothing

    // THE LAST SENTENCE IS DERIVED, NEVER ASSERTED, and the reason is that it is the one the seat acts
    // on. `about` is built from three optional job keys and from owners found in the record, and
    // nothing guarantees any of them is present — so on a run where the exclusion found nothing, an
    // absolute claim that every mark was removed is false in exactly the state where a hit IS the mark.
    // Found in review, 2026-09-08, driven on a job carrying no marks.
    //
    // THE EMPTY STATE SAYS SO RATHER THAN GOING QUIET. Dropping the clause would leave the seat with no
    // reading of a fact that changes what it should do; telling it the mark was not excluded is more
    // useful than telling it nothing, and far more useful than telling it the opposite.
    // TWO EXCLUSIONS, TWO FACTS, AND ONLY ONE OF THEM PROTECTS THE MARK. Keying the reassurance on
    // marks ∪ owners was the first repair and it moved the defect rather than closing it: owners come
    // from the RECORD and marks from the JOB, so a record carrying thirteen owners and a job naming no
    // mark made the set non-empty, fired the reassurance, and told the seat no flag was the mark under
    // clearance over a flag that was exactly that. That mixed state is the LIKELIER one in production —
    // records carry owners; a job missing its marks is the unusual half. Found in review, 2026-09-08,
    // driven on the first repair's own head.
    const marks = about.marks ?? [], owners = about.owners ?? [];
    const ownerNote = owners.length ? ` The ${owners.length} owner name(s) from the record were also removed.` : "";
    const exclusionNote = marks.length
      ? `The ${marks.length} mark(s) this run is about were removed before reading, so none of these is a hit inside the name being cleared.${ownerNote}`
      : `THIS RUN NAMED NO MARK TO EXCLUDE, so the mark under clearance was NOT removed before reading — a flag below may BE that mark. Check each against the matter before rewriting it.${ownerNote}`;
    return lines(
      `PLAIN WORDS ON WHAT THE READER SEES FIRST: a deterministic read of this run's default-visible lines — the ones a client meets before opening anything — flagged the lines below. Treat each as a candidate FLAGGED CORRECTION [kind: narrative] and handle it exactly as you handle the reader-owned nouns above: quote the sentence and give the rewrite that keeps every fact. THIS IS EVIDENCE, NOT A VERDICT — judge each in context and pass over any where the word is the subject rather than the profession's shorthand. ${exclusionNote}`,
      ...hits,
    );
  } catch (e) {
    // Re-thrown, not swallowed: composeDispatchExtra notes it and records the id under `failed`, so an
    // unreadable record is visible on the receipt instead of looking like a clean run. A prompt block is
    // additive context and the composer already refuses to fail a dispatch over one.
    throw new Error(`plain-register pre-check: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

// ── THE RECEIPT, AND THE GRADED CLASSES, STATED ONCE ────────────────────────────────────────────────
//
//. The receipt this block tabulates is the answer to "did that search run", and until now exactly
// one stage got it: the REVIEWER. `synthesis` — the stage that writes the claim the reviewer then
// blocks — was handed neither the receipt nor the coverage ledger, in the prompt or in the staleness
// map, and re-derived both by reading. On the first delivered clearance the reviewer blocked a synthesis
// that had written an enforcement history over a check the grid never dispatched: the evidence that it
// never dispatched was on disk before synthesis started, and the driver was already computing it for the
// stage downstream.
//
// So the block is shared, and the SPLIT is where the care goes. Two literals are the same for both
// readers — the head (what the receipt is) and the three graded classes (what each state MEANS). One
// literal is per-stage, because the two seats do genuinely different things with the same classes: the
// reviewer AUDITS a finished document against them under a named section title the validator keys on
// (`plan_audit_missing`), and synthesis RULES over them before a word is written. Writing the classes
// out twice, once per seat, is the shape — one rule in two places, drifting from the day the second
// copy is typed — and the classes are the part that must never drift, because class (1) is the blocking
// condition.
// THE HEAD AND THE GRADED CLASSES ARE NOT DECLARED HERE. They live in register-plan.mjs, beside the
// derivation that assigns the states, because the gateway's corrective hint is a THIRD reader of the
// same grading and `pipeline.mjs` imports `gateway.mjs` — so a constant declared here could never
// reach it.
const PLAN_AUDIT_FRAME = {
  // Unchanged in force and unchanged in section title: same three classes, same blocking condition,
  // same closing sentence. `verify.mjs` keys `plan_audit_missing` on the title, so it is verbatim.
  "narrative-refutation":
    `Your review MUST include a section titled "PLAN-EXECUTION CHECK" auditing it against the three classes below: a clean claim resting on class (1) is a BLOCKING flag — that search never ran; on class (2), verify the narrative treats the parent crowd as dilution context and flag ONLY if it is claimed searched-clean; on class (3), flag a clean claim ONLY when the narrative shows NO materiality reasoning for that slice. You audit the reasoning; you never manufacture a CONDITIONAL from a state label.`,
  // — the same receipt, one seat earlier, and the direction reverses: this stage is not being
  // audited against the classes afterwards, it is ruling over them before it writes.
  synthesis:
    `You are ruling over this receipt BEFORE you write — you are not being audited against it afterwards. A fact whose supporting slice falls in class (1) is UNWRITEABLE: say the check was not dispatched this run, and stop there. Class (3) is yours to weigh, and the weighing has to LAND where a reader sees it — a findings.json coverage[] row, or one line of reasoned-immaterial prose naming the slice.`,
};

function planAuditExtra(ctx, { stage = "narrative-refutation" } = {}) {
  const P = ctx.paths;
  if (!ctx.registerPlan || !existsSync(P.planExecution)) return "";
  let exec;
  try { exec = JSON.parse(readFileSync(P.planExecution, "utf8")); }
  catch (e) { throw new StageFailure(stage, `plan-execution receipt unreadable (driver-written artifact): ${String(e.message).slice(0, 100)}`); }
  let rows = [];
  try {
    const crowds = exec.executed.filter((x) => x.state === "incomplete");
    // By the time this block is read the reading turn is over, and a waiting family it chose not to ask
    // is a settled judgment with its reason on record, not an open question. Counted as awaiting, a run
    // whose every waiting family was withheld told the reviewer they all remained open, and it raised a
    // coverage flag against judgments already made.
    const { withheld, awaiting } = waitingFamilyStates(P.runDir, exec.awaiting);
    const withheldOn = (axis) => withheld.filter((f) => f?.axis === axis).length;
    rows = [
      `- executed: ${exec.executed.length} entr${exec.executed.length === 1 ? "y" : "ies"} (${crowds.length} crowd/incomplete${crowds.length ? `: ${crowds.slice(0, 4).map((x) => x.qid).join("; ")}` : ""})`,
      `- missing (no band block): ${exec.missing.length}${exec.missing.length ? ` — ${exec.missing.slice(0, 4).join("; ")}` : ""}`,
      `- skipped (crowd-gated fringe): ${exec.skipped.length}`,
      // The families waiting for the reading turn, and those it asked. Without these lines the table's
      // own buckets summed to the whole plan less the waiting families, and a reviewer read it as
      // "no family waiting" while the receipt held 156.
      `- withheld by judgment (the reading turn chose not to ask them; each carries its reason on the coverage form): ${withheld.length}`,
      `- awaiting the reading turn's ask: ${awaiting.length}`,
      exec.asked?.length ? `- asked by the reading turn (a waiting family's question, asked by another entry): ${exec.asked.length}` : "",
      exec.unplanned?.length ? `- unplanned qid-stamped blocks: ${exec.unplanned.length}` : "",
      ...(exec.skeleton ?? []).map((s) => {
        const w = withheldOn(s.axis), a = Math.max(0, (s.awaiting ?? 0) - w);
        return `- axis ${s.axis}: ${s.state} (${s.executed}/${s.entries} executed, ${s.crowds} crowd${w ? `, ${w} withheld` : ""}${a ? `, ${a} awaiting` : ""})`;
      }),
    ];
  } catch (e) { rows = [`- (receipt table unavailable — read + audit the receipt file directly: ${P.planExecution})`]; note(`plan-audit receipt table (non-fatal): ${e.message}`); }
  return lines(
    `${PLAN_AUDIT_HEAD} ${PLAN_AUDIT_FRAME[stage] ?? PLAN_AUDIT_FRAME["narrative-refutation"]}`,
    PLAN_AUDIT_CLASSES,
    ...rows,
  );
}

// ── — THE COVERAGE LEDGER, HANDED TO THE SEAT THAT SIGNS THE RUN ──────────────────────────────
//
// The ledger's rows are the other half of "what was searched, and how completely". `skepticDeferralExtra`
// has handed them to the skeptic as a table since the 2026-07-30 addendum, for a reason that applies
// with more force one stage later: the skeptic re-derived the ledger out of a 103 KB prose document,
// spent 28,592 thinking tokens doing it and got it wrong. `synthesis` emits a MANDATORY coverage
// judgment and was never shown the ledger at all — it was told to produce "coverage honesty" over
// material it had to go and find.
//
// This is the ledger half only. The receipt half is `planAuditExtra` above, registered separately for
// the same stage, so a defect in one artifact cannot silently take the other block down with it (the
// composer catches per-builder) and the dispatch receipt records which of the two actually built.
function coverageLedgerExtra(ctx) {
  const P = ctx.paths;
  try {
    const rows = loadCoverageLedger(P.runDir).rows;
    if (!rows.length) return "";
    return lines(
      `COVERAGE LEDGER, DRIVER-COMPUTED — the machine ledger the register funnel wrote (${P.registerCoverageLedger}). These are the rows; do NOT re-derive them from the findings prose, and do not re-type their numbers into yours. The file is yours to read directly, but every row it holds is already below.`,
      "",
      "Coverage ledger (axis | unit | status | reason):",
      ...coverageLedgerTableRows(rows),
      "",
      `A row is `+"`confirmed-clean`"+` only where the funnel says so. A `+"`coverage-limited`"+` or `+"`deferred`"+` row is a slice this run did not close: your coverage judgment weighs it, and nothing anywhere in the opinion states it searched-clean.`,
    );
  } catch (e) { note(`synthesis coverage-ledger block skipped (non-fatal): ${String(e.message).slice(0, 80)}`); return ""; }
}

async function refute(ctx) {
  // corruption 2 — this used to compose its two driver-computed blocks INLINE, which is how the
  // A/B rig came to run a shorter prompt than the run it compares against. Both blocks are registry
  // builders now (DISPATCH_EXTRA_BUILDERS), and this call site goes through the SAME composer the
  // sandbox uses: `composeDispatchExtra`. One composer means the production dispatch and the arm cannot
  // disagree about which blocks exist — the only way to keep them equal that does not rely on two lists
  // being edited together forever.
  //
  // What the blocks are: B2 feeds the deterministic registry-fidelity check over the NARRATIVE into the
  // reviewer, so a number/date swap (the teal-anvil failure the reviewer passed) is covered by the
  // reasoning review and caught HERE → corrective re-synthesis, not only at pre-delivery. The
  // plan-execution audit hands the reviewer the code-derived receipt of what actually ran.
  // lever 3 — DRIVER SELECTION. The band is on findings.json before this stage runs, so the
  // ordinals to profile are computed here and listed in the dispatch rather than described to the seat.
  // Set on ctx (not passed as an extra) so the verdict-recheck dispatch below carries the same list from
  // the same computation — a recheck that re-derived it could send a different one to the same session.
  //
  // EVERY UNREADABLE STATE RESOLVES TO null = EVERY FINDING: no cut on the row, no findings file, an
  // unparseable one, a manifest with no bands. Wrong toward depth costs time; wrong toward brevity drops
  // work from a report somebody paid for, and the only symptom is a profile nobody asked about missing.
  ctx.profileSelection = reviewProfileSelection(ctx);
  if (ctx.profileSelection.ordinals)
    runLog(ctx.run.runDir, { event: "profile-selection", of: ctx.profileSelection.total,
      selected: ctx.profileSelection.ordinals.length, keyless: ctx.profileSelection.keyless });
  const { text: extra } = composeDispatchExtra("narrative-refutation", ctx);
  const r = await stage("narrative-refutation", ctx, extra ? { extra } : {});
  // — CARRY THE CONDITION OUT. This returned a bare `{ ok: false }`, so the only
  // thing the caller could throw was a sentence about the LADDER, and the recovery classifier was handed
  // "failed after retries + fallback" — which names no provider condition and matches neither lane
  // regex. Measured on a codex test run that died after seventeen hours: every attempt recorded
  // `rate_limited` or `timeout`, both of which recoveryLaneOf reads as WEATHER, and the run was
  // classified `unknown`/`defect` and spent the small budget reserved for its own mistakes.
  if (!r.ok) return { ok: false, fail: r.fail ?? null };
  const verdict = parseVerdict(readFileSync(ctx.paths.seniorEyeReview, "utf8")) ?? "BLOCKING"; // parse-fail ⟹ fail-safe
  return { ok: true, verdict, key: r.sessionKey, model: r.model, thinking: r.thinking };
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
// The matter's FULL in-scope Nice-class set (incl. services 42/44) — declared classes (top-level OR per-mark)
// else the profile defaults. The dangerous-band floor + its coverage gate must span ALL of these, never a
// goods-only subset (the VELTRIPHEN services-class miss). Strings, deduped.
export function inScopeClassList(job, profile) {   // @internal — also read by scripts/register-plan-shape.mjs, which must resolve scope exactly as the run did
  const fromMarks = Array.isArray(job?.marks) ? job.marks.flatMap((m) => (Array.isArray(m?.classes) ? m.classes : [])) : [];
  const declared = [...(Array.isArray(job?.classes) ? job.classes : []), ...fromMarks];
  return [...new Set((declared.length ? declared : (profile?.defaultClasses ?? [])).map(String))];
}
// The matter's territorial scope for the REGISTER PLAN — THE SHARED LADDER (effective-scope.mjs
// resolveTerritories), the same one the doors, the freeze and stages.mjs scopeTerritories read.
// Deduped, blank-stripped. Exported for test.
//
// IT USED TO BE A HAND COPY of "instructed, else the account's defaults", and that copy had never heard
// of the geography stamp. So a `mode: "worldwide"` clearance — admitted as worldwide at every door,
// priced as worldwide, printed as a Global preliminary search — arrived here and NARROWED to the
// account's default territories: the register plan swept seven countries for a search sold as
// everywhere, and nothing anywhere disagreed. An empty list is the worldwide answer downstream
// (register-plan.mjs treats emptiness as unrestricted), so the fix is the ladder, not a special case.
export function registerJurisdictions(job, profile) {   // @internal
  const list = resolveTerritories(job, profile).jurisdictions;
  return [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? "").trim()).filter(Boolean))];
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
// A6 — the intake-ask register. Parse the matter-frame's "### Intake asks" section into
// machine rows, freeze them at _driver/intake-asks.json (temp+rename), and expose ctx.intakeAsks to
// every downstream message builder. Section missing on a fresh run ⇒ ONE save-only followup
// (the grid-ledger-followup posture), then proceed with [] + a logged note — never-kill, replay-safe
// (archived runs simply have no sidecar and all consumers falsy-skip).
export function parseIntakeAsks(matterContextMd) {   // @internal
  const m = String(matterContextMd ?? "").match(/^###\s*Intake asks\s*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im);
  if (!m) return null;                                        // section absent (legacy / model miss)
  const asks = [];
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (!t.startsWith("-")) continue;
    if (/^-\s*none stated\b/i.test(t)) return [];
    const q = t.match(/^-\s*ask:\s*"([^"]+)"\s*(?:\|\s*owner:\s*([a-z-]+))?/i)
      ?? t.match(/^-\s*"?(.+?)"?\s*(?:\|\s*owner:\s*([a-z-]+))?\s*$/i);   // tolerant fallback shape
    if (q && q[1]?.trim()) asks.push({ ask: q[1].trim(), owner: (q[2] ?? "synthesis").toLowerCase() });
  }
  return asks;
}
async function deriveIntakeAsks(ctx) {
  const { run, paths: P } = ctx;
  const readAsks = () => { try { return parseIntakeAsks(readFileSync(P.matterContext, "utf8")); } catch { return null; } };
  let asks = readAsks();
  if (asks == null) {
    note(`[intake-asks] matter-context has no "### Intake asks" section — one save-only followup`);
    await stage("matter-frame", ctx, {
      force: true, trigger: "intake-asks-followup",
      // ── CONVERSION 2 — THIS WAS AN EDIT ORDER AND IS NOW A CALL ─────────────────────────
      //
      // It used to say: "APPEND that section at the END of the file … ONE Edit that adds the new section
      // after the last line", closed by `editRepairTail`. It called itself "the purest edit case in the
      // driver", and the argument was real at the time — a full re-emission would have re-typed a frame
      // whose every other line `validators.matterContext` string-compared against
      // _driver/instructed-scope.json, so risking the whole file to add a heading was the worse trade.
      //
      // THAT ARGUMENT IS GONE, and it did not survive by being overruled — the conversion dissolved it.
      // The seat no longer types the instructed scope (the driver stamps it), and it no longer types any
      // line shape at all. Re-sending the frame is now re-sending a handful of typed values, so "one small
      // Edit beats a big re-emission" is comparing against a re-emission that no longer exists.
      //
      // WORTH KNOWING FOR THE REMAINING CONVERSIONS: the agreement guard does NOT see this composer.
      // It walks `warmPatchMessage` and `correctiveMessage`, and this is a third, bespoke one — so on this
      // stage the guard reported clean while a live hand-write order stood here. The hand sweep over every
      // site naming `P.matterContext` is what found it. That is the residual gap the guard's own module
      // documents, now measured rather than predicted.
      followup: repairFollowup("matter-frame:intake-asks-followup", {}),
    });
    asks = readAsks();
  }
  if (asks == null) { runLog(run.runDir, { event: "intake-asks-missing" }); asks = []; }
  ctx.intakeAsks = asks;
  try {
    const tmp = paths(run.runDir).intakeAsksJson;
    writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), asks }, null, 2));
    renameSync(tmp, paths(run.runDir).intakeAsks);
  } catch { /* best-effort sidecar; ctx carries the rows for this run */ }
  // item 14a — UNCONDITIONAL, like every other AD-4 counter. This was the last one still written inside
  // an `if`, and it is a bad one to leave: "the requester asked for nothing in particular" and "nobody
  // ever read the request for asks" are different facts about a run, and a missing row made them the
  // same fact. The ask register drives a delivery section and a closure gate, so a reader who cannot
  // tell those apart cannot tell an empty section from a skipped step. `asks` stays capped-free (the
  // list is small by construction) and an empty run writes `count: 0` and `asks: []`.
  runLog(run.runDir, { event: "intake-asks", count: asks.length, asks: asks.map((a) => a.ask) });
}

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
    const deferrals = JSON.parse(readFileSync(rp, "utf8"))?.deferrals ?? [];
    if (!deferrals.length) return;
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
 *  the two unit switches must be on, the per-lane switch must not be killed, and the frozen lane decision
 *  sidecar must carry the zh lane. Any leg missing ⇒ the lane did not run (a product without the
 *  investigation, an incident kill, or no lane in the
 *  frozen decision) — the honesty row is owed. Reads the SIDECAR rather than ctx.jxLanes: at delivery
 *  time on a resume the fold block may never have re-attached it, and the frozen decision on disk is
 *  the single authority anyway.
 *
 *  THIS IS NOT A GATE — it decides whether a CLIENT REPORT carries a row saying the Chinese lane was
 *  not searched, so both directions are a statement of fact and both can be wrong. When the
 *  CLEAROTRON_JX_LANES master leg was retired (2026-07-27) neither naive option was safe: deleting the env
 *  legs outright would report "ran" from a frozen lane DECISION alone, suppressing the disclosure on a
 *  run whose units never executed; keeping a leg on a variable nothing sets any more would read false
 *  forever and tell every client the lane did not run, including the runs where it did. So the legs
 *  track the switches that SURVIVE, which is what "mirrors the jx-units gating legs" has to mean. */
export function scriptLaneRanOnRun(runDir, lane, { searchPolicy = null, env = process.env } = {}) {   // @internal
  if (!searchPolicy?.components?.jxLanes) return false;
  if (!laneArmed(lane, env)) return false;   // — the shared fail-open reader
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
    const scope = jxScopeJurisdictions(job ?? {}, profile ?? {});
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
    const added = [];
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
      doc.coverage.push(p.row);
      added.push(p.lane);
    }
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
      const area = `Native-language investigation depth / ${lane}`;
      if (doc.coverage.some((c) => String(c?.area ?? "").toLowerCase() === area.toLowerCase())) continue;
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

/**
 * WHAT EACH POLICED GOODS DROP RESTS ON, recorded beside the screen gate (screen-gate.mjs `screenGateEvidence`).
 * Taken in two halves: `screenGateSnapshot` at the moment the gate judges, before it fetches anything (the findings
 * it judged, each policed drop's goods evidence, and the reading log), and the record after the gate's fetches,
 * which reads each drop's goods again only where the gate fetched. Disclosure only: the gate's rule and its
 * outcome are decided above and nothing here changes them.
 */
function goodsEvidenceOfDrops(P, runPrefix, uris, gateFetched = null) {
  const out = new Map();
  if (!uris.length) return out;
  const calls = readRunCallRows(DEFAULT_LEDGER_PATH, runPrefix);
  const held = heldRecordProvenance(P.runDir);
  // Each drop's own band row, so that a goods reader which reads a row's goods reads this one's too.
  const band = safeReadJson(P.registerNamedBand);
  const bandRows = Array.isArray(band?.enumerated) ? band.enumerated : [];
  const rowOf = new Map(bandRows.map((r) => [normalizeRecordUri(r?.record_id), r]));
  const goods = bandShapeGoods(P, bandRows).goods;
  const fetches = recordFetchOutcomes(calls.rows, { runPrefix });
  // The gate's own fetches are this run's too, recorded by the gate whatever the register's ledger kept of them.
  for (const [u, r] of gateFetched ?? []) {
    const key = normalizeRecordUri(u) || String(u ?? "").toLowerCase();
    const o = fetches.get(key) ?? { sent: 0, from_memory: 0, failed: 0, ok: false, last_status: null };
    if (r?.ok === true) o.ok = true; else o.failed = Math.max(o.failed, 1);
    fetches.set(key, o);
  }
  for (const uri of uris) {
    const e = recordGoodsEvidence(rowOf.get(normalizeRecordUri(uri)) ?? { record_id: uri }, { goods, held, fetches });
    // A register page the research saved is named by the question that saved it, which the write-up's label carries.
    out.set(uri, { goods: e.state, source: e.source, ...(e.question != null ? { question: e.question } : {}) });
  }
  return out;
}

function screenGateSnapshot(ctx, runPrefix) {
  const P = ctx.paths;
  try {
    const findings = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
    let readingLog = "";
    try { readingLog = readFileSync(P.readingLog, "utf8"); } catch { readingLog = ""; }
    return { findings, readingLog, goods: goodsEvidenceOfDrops(P, runPrefix, policedDropUris(findings)) };
  } catch (e) {
    return { findings: "", readingLog: "", goods: new Map(), error: String(e?.message ?? e).slice(0, 160) };
  }
}

function recordScreenGateEvidence(ctx, { runPrefix, before, heldBeforeGate, heldAfterGate, gateFetched }) {
  const P = ctx.paths;
  try {
    const uris = policedDropUris(before.findings);
    const after = gateFetched.size ? goodsEvidenceOfDrops(P, runPrefix, uris, gateFetched) : before.goods;
    // The line each drop's record sits on, as placement's fate count joins it, so a part of the shape or a page
    // of a group that served the line counts as the goods words shown.
    let lineOf = () => null, lineReads = "read";
    try {
      const index = buildSelectionIndex(readPlacementFormInput(P.runDir));
      lineOf = (uri) => lineKey(index.resolve(uri));
    } catch (e) { lineReads = `the band shape's lines could not be read, so only record opens and lookups count: ${String(e?.message ?? e).slice(0, 100)}`; }
    const ev = screenGateEvidence({ findingsContent: before.findings, heldBefore: heldBeforeGate, heldAfter: heldAfterGate,
      before: (uri) => before.goods.get(uri), after: (uri) => after.get(uri),
      reads: recordReads(before.readingLog), lines: linesRead(before.readingLog), lineOf, readerStage: "register-digest", gateFetched });
    const calls = readRunCallRows(DEFAULT_LEDGER_PATH, runPrefix);
    const gateCalls = registerCallAccount(calls.rows.filter((r) => String(r?.sessionKey ?? "").includes("screen-gate-refetch")));
    const doc = { schema_version: 2, ...ev, gate_calls: gateCalls, line_reads: lineReads,
      reading_note: "A drop with no recorded read has no band_record open or search-answer serve, and no lookup, part of the shape or page of a group serving its line, in the reading log for the reading step. The log is best-effort: this does not show the goods were never read.",
      ...(before.error ? { snapshot_error: before.error } : {}), ...(calls.error ? { call_ledger_error: calls.error } : {}) };
    ensureDriverDir(P.runDir);
    atomicWrite(paths(P.runDir).screenGateEvidence, JSON.stringify({ ts: new Date().toISOString(), ...doc }, null, 2) + "\n");
    runLog(P.runDir, { event: "screen-gate-evidence", ...ev.counts, unnamed: ev.unnamed, fetches: ev.fetches,
      alternatives: ev.alternatives, gate_calls: gateCalls });
  } catch (e) {
    runLog(P.runDir, { event: "screen-gate-evidence-failed", fail: String(e?.message ?? e).slice(0, 160) });
  }
}

// ── screen-gate unexamined-disclosure readers ────────────────────────────────────────────────────────
// The screen-gate's disclose-and-continue terminal writes _driver/screen-gate-unresolved.json (atomic,
// the receipt idiom) the moment its post-repair re-check still fails, so the disclosure survives a
// crash between the gate and delivery. This reader prefers the in-process ctx rows (this session
// produced them); the sidecar is the resume shape — a pass that reaches the coverage floor without
// having re-entered the gate still owes the clamp. Exported for the unit tests.
export function loadScreenGateUnresolved(runDir, ctx = {}) {   // @internal
  if (Array.isArray(ctx.screenGateUnresolved) && ctx.screenGateUnresolved.length) return ctx.screenGateUnresolved;
  try {
    const rows = JSON.parse(readFileSync(paths(runDir).screenGateUnresolved, "utf8"))?.unresolved;
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }   // absent/corrupt sidecar ⇒ no disclosure owed on this path
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

// spec 64 (B3) — within-run deadline propagation (the DEMVENZY drop): the register bands carried
// oppositionEndDate 2026-07-13 two days before the window closed, and it never reached the delivered
// findings/prose. Deterministic join: a finding whose registration matches a band/record opposition
// window INSIDE the action window ([now-graceDays, now+withinDays], the findDeadlineUrgencyMiss
// constants) and that lacks a structured deadline gets deadline:{kind:"opposition", date} injected —
// the EARLIEST qualifying window end. Code fills ABSENCE only (an authored deadline always wins);
// out-of-window dates never inject (an archived 2015 window is history, not urgency). Receipt:
// _driver/deadline-enrich.json. NEVER-KILL: any defect leaves findings.json untouched.
export function enrichFindingDeadlines(P, runDir, note, { nowMs = Date.now(), withinDays = 60, graceDays = 14 } = {}) {   // @internal
  try {
    if (!existsSync(P.findings)) return;
    const deadlines = collectOppositionDeadlines(runDir);
    if (!deadlines.size) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.findings)) return;
    const inWindow = (d) => {
      const days = Math.round((Date.parse(d) - nowMs) / 86400000);
      return Number.isFinite(days) && days <= withinDays && days >= -graceDays;
    };
    const enriched = [];
    for (const f of doc.findings) {
      if (f?.deadline?.date) continue;
      const dates = (Array.isArray(f?.owner?.registrations) ? f.owner.registrations : [])
        .map((r) => deadlines.get(normalizeRecordUri(r?.uri ?? "")))
        .filter(Boolean).filter(inWindow).sort();
      if (!dates.length) continue;
      f.deadline = { kind: "opposition", date: dates[0] };
      enriched.push({ ordinal: f.ordinal, mark: f.mark, date: dates[0] });
    }
    if (!enriched.length) return;
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "finding-deadlines", settles: [] });   // B5 — a crash mid-write must never leave a truncated findings.json
    const base = rebaseEnrichedDeadlines(runDir, enriched);   // a later patch keeps what the file now carries
    atomicWrite(paths(runDir).deadlineEnrich, JSON.stringify({ schema_version: 1, ts: new Date().toISOString(), judged_at: new Date(nowMs).toISOString(), enriched, base }, null, 2) + "\n");
    note(`[deadline-enrich] ${enriched.length} finding(s) gained the register's own opposition window (${enriched.map((e) => `${e.mark}: ${e.date}`).join("; ").slice(0, 140)}) — a recorded deadline never silently disappears`);
  } catch (e) {
    note(`[deadline-enrich] skipped: ${String(e?.message || e).replace(/\s+/g, " ").slice(0, 100)}`);
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
// ASSEMBLE report.md = the overview shell (front-matter + Actions/Coverage/Methodology) + `# Marks` + the
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
useThePipeline({ CORRECTIONS_DELIVERED_FILE, asPartNotCompleted, extractRulingsTail, must, postRepairCorrectionsPath, postRepairStatePath, prepareDeclinationSpec, recordFromTheSaves, recordSynthesisSeam, removalRepairedRow, reviewAfterRepairPath, reviewExclusionsPaths, safeReadJson, snapshotFindingsForCorrections, stage, stageCharter });

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
  writeFileSync(P.report, `${overview}\n\n# Marks\n\n${cards.join("\n\n")}\n`
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
function reconcilePassStamps(runRef, ctx) {
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
    } catch { /* no queue on disk — nothing pending */ }
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

/**
 * — WHY THIS RESUME MUST NOT HAPPEN, OR null.
 *
 * Exported and pure so an arm can drive the DECISION without standing up a run slot, an engine
 * preflight and a whole studio tree to reach it — the same reasoning retireCancelledPark states for
 * returning what it wrote. A predicate nobody can call cheaply is a predicate nobody tests.
 *
 * Two surfaces, because a stop is spelled two ways depending on what the run was doing when it was
 * asked. `.cancel` is the REQUEST, and stop_run writes only that for a run still executing; a terminal
 * `status.json` is the SETTLEMENT, which is what a park retired by the runner (or by an operator at a
 * shell) leaves behind. Reading one and not the other is how the measured run resumed past a cancel
 * that was, by then, written on both of them.
 *
 * The DELIVERED terminal is deliberately NOT folded in here: its caller needs to name which of three
 * delivery markers it found, and it refuses for a different reason (a duplicate report, not a
 * countermanded decision). Two refusals, two messages a reader can act on.
 */
export function resumeStopRefusal(runDir) {   // @internal
  if (!runDir) return null;
  if (isCancelled(runDir)) return "an operator asked it to stop (.cancel present)";
  // ── CANCELLED ONLY, AND THE FIRST CUT OF THIS WAS WRONG ────────────────────────────────────────
  //
  // This read `TERMINAL_STATES.has(state)` — delivered, failed, cancelled — and CI refused sixty-odd
  // resume arms for it. Rightly: `failed` is a terminal the RUNNER writes about itself, and resuming a
  // failed run is not an edge case, it is the documented purpose of the door this guard sits in. The
  // three rmSync calls below exist to clear exactly that sentinel so "a clean resume doesn't read as
  // failed". A guard refusing what its own function was built to do is a worse defect than the one it
  // was fixing, and it would have stranded every crash-recovered run on the box.
  //
  // `cancelled` is the only state a PERSON sets, which is the issue's own criterion — "a terminal
  // status.json state set by an OPERATOR is honoured". The runner's REPARK_MAX circuit breaker and the
  // reclaim-exhausted path both write `failed` with a reason, so "terminal + has a reason" cannot
  // separate them either; the state word can.
  //
  // `delivered` is deliberately absent: the branch above already refuses it, earlier, and names which
  // of three delivery markers it found. Repeating it here would be unreachable code carrying a worse
  // message than the one that fires.
  const t = terminalRunState(runDir);
  return t === "cancelled" ? "it was cancelled (status.json)" : null;
}

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
  } catch { /* best-effort — the returned park still tells the runner */ }
  note(`[pipeline] PARKED ${codename ?? "run"}: ${String(e.message).slice(0, 300)}`);
  return { ok: false, postponed: true, resetsAt: null, parkedFor: e.dependency, codename, runDir };
}

export function journalStageInputs(paths = [], { reads = null, readsTruncated = null, warm = false } = {}) {   // @internal
  const readSet = Array.isArray(reads) ? new Set(reads) : null;
  // A-1 — `followup` was an arm of this predicate and is not any more. It encoded the same false premise
  // the composer above fixes: that a followup is a resumed session whose files were not re-offered. It is
  // not. A followup dispatch is a NEW stage() call, i.e. attempt 1, and `resumeRef` is passed only on a
  // warm retry — so a cold followup's reads gauge is exactly as groundable as a fresh dispatch's, and
  // nulling it turned "verified unread" into "unknowable" on precisely the dispatches worth measuring.
  // `warm` STAYS, and it is the arm that was always right: a warm patch resumes the failed session and is
  // deliberately not re-offered its files, so the turn opening nothing is the normal warm shape rather
  // than evidence it ignored them. `readsTruncated` stays for the same kind of reason — a capped gauge
  // would manufacture a `read:false`. The caller still journals `followup` on the row, so a reader can
  // still split the two populations; it just no longer erases one of them.
  const unreliable = Boolean(warm) || readsTruncated === true;
  return paths.map((p) => {
    const m = fileMeta(p);
    if (!m) return m;
    const opened = readSet ? readSet.has(p) : null;
    return { ...m, read: opened === true ? true : (unreliable ? null : opened) };
  });
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
      resolvedBy: PARK_RESOLVED_BY }, { job: meta.job, agent: meta.agent, codename }); } catch { /* best-effort */ }
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
  const { P, agent, ctx, isResume, run } = await openRun({ job, opts }, { attachProfile, attachSearchPolicy, depthLadderEvent, findRunDate, resumeStopRefusal });
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
  // The settlement flush: ONE warm re-digest carrying every queued segment (plus the frame-reopen
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
      // exclusion IS a filter: one warm reconciliation on the digest session — re-classify, never re-run searches
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
  const { deliverWithoutTheAssessment, publishAndDeliver } = await deliveryEndState({ P, agent, ctx, job, run }, { applyScopeFrontMatterOf, archive, assessmentCoverageOfRun, localLanguageStateOf, reportIdentityRecord, searchLogAuditMd, sentinel, setAsideTheAssessment, writeScopeFactsOf });

  // The clearance's own steps, in order, run by run-shell.mjs. A value one step hands a later one is held here, between
  // them; a step that returns a result ends the run with it. A failure in any step ends through run-failed.mjs.
  let axes, runCommonLaw, planExec, unitKey, dispatchPlanQids, synthesisKey, synthesisModel, synthesisThinking, coverageJudgment, reviewOpen, firstRef, runState, correctiveEntryVerdict, correctiveCycleSettled, correctiveRecheckOk, applyCoverageFloor, clampOnTheFloorDuty, clampOnTheWritersDuty, deliverAndClamp, followTheRecordsActions, saveTheLabel, saveTheOwedLabel, writeVerdictSidecar, applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, findingsForCards, groupedMembers, overviewOpen, rebuildTheDeliveredRecord, restoreTheBrokenRecord, rov, writeScopeFacts, writeUps;
  return await runShell({ P, agent, ctx, job, run }, { ending: CLEARANCE_ENDING, helpers: { recordConnotationAudit, sentinel, undoTaintRenames }, steps: [
    { name: "intake", run: async () => {
        // The matter frame, its variants and the plan (steps/intake.mjs).
        ({ axes, runCommonLaw } = await runIntake({ P, ctx, job, opts, run }, { StageFailure, attachRegisterPlan, deriveFormNeighbourhood, deriveGridSpec, deriveIntakeAsks, deriveScopeLedgerJson, inScopeClassList, must, stage, verifyAndRecordHouseElement }));
    } },
    { name: "register-sweep", run: async () => {
        // The register and unregistered-use searches and their fan-in (steps/register-sweep.mjs).
        ({ planExec, unitKey, dispatchPlanQids } = await runRegisterSweep({ P, agent, axes, ctx, job, opts, run, runCommonLaw }, { CL_SUPP_TAGS, StageFailure, connotationRemedyToken, defaultConnotationReissuer, deriveNamedBand, foldSupplementalProposals, holdStickyGapsIn, inScopeClassList, isFallbackEligible, joinOptions, mergeRegisterBands, must, noteAdapter, noteChannelCoverageAtStageExit, readPlanExecution, readRegisterBands, recordConnotationAudit, remergeIfBandsMoved, resultsPerCellOf, runBatched, runSaturationProbeCodeSide, slicesUnitNeverReached, stage, taintDisposition, taintParkJudgmentArtifacts, takeSlicesOutOfTheBand, unfinishedUnitAsItStands, writePlanExecutionReceipt }));
    } },
    { name: "frame-comparison", run: async () => {
        // The blind frame compared with what the run scoped, and the reopen (steps/frame-comparison.mjs).
        await runFrameComparison({ P, axes, ctx, dispatchPlanQids, flushDigestQueue, job, mintDigestWork, planExec, run, runCommonLaw, unitKey }, { bandBytesOf, deriveNamedBand, forceFromActive, inScopeClassList, joinOptions, loadCoverageLedger, mechanicalFormGapDirectives, readRegisterBands, refreshSupplementalExecution, remergeIfBandsMoved, settleOneShotStamp, stage });
    } },
    { name: "placement-and-digest", run: async () => {
        // Step 2C placement → Step 2D digest
        //
        // THE PASS THAT RESUMES A RUN WHOSE ASSESSMENT COULD NOT BE COMPLETED delivers what the run holds, here, at the
        // assessment's first step and before anything that exists only to feed it runs. See deliverWithoutTheAssessment.
        const assessmentOpen = readPartNotCompleted(run.runDir, "assessment");
        if (assessmentOpen) return await deliverWithoutTheAssessment(assessmentOpen);
        // Placement and the register write-up (steps/placement-and-digest.mjs).
        await runPlacementAndDigest({ checkLateBind, ctx }, { asPartNotCompleted, assertReceiptSettled, must, recordPlacementPass, runDigest, stage });
    } },
    { name: "skeptic-and-follow-up", run: async () => {
        // The skeptic, and the searches and rechecks that follow it (steps/skeptic-and-follow-up.mjs).
        await runSkepticAndFollowUp({ P, agent, axes, ctx, dispatchPlanQids, flushDigestQueue, job, mintDigestWork, opts, planExec, run, unitKey }, { askableOf, bandBytesOf, capabilityGapAxes, defaultRecordFetcher, deriveBandShape, deriveNamedBand, envelopeDecision, envelopeHeldNote, escalationHeldNote, findFloorBreaches, forceFromActive, isInactiveAxisRow, lateRecordIds, loadCoverageLedger, officeGapOf, readFloorAxes, readPlanExecution, recordPlacementPass, recordScreenGateEvidence, refreshSupplementalExecution, remergeIfBandsMoved, runBatched, screenGateSnapshot, settleOneShotStamp, skepticDeferralExtra, stage, stickyGapUnits });
    } },
    { name: "synthesis", run: async () => {
        // The writer, the case-law grounding and the first review (steps/synthesis.mjs).
        ({ synthesisKey, synthesisModel, synthesisThinking, coverageJudgment, reviewOpen, firstRef } = await runSynthesis({ P, checkLateBind, ctx, job, opts, run }, { asPartNotCompleted, composeDispatchExtra, decideCaseLaw, goodsEvidenceForTheWriter, keepGoodsEvidenceAsWritten, prepareDeclinationSpec, quarantineSynth, readCoverageJudgment, recordSynthesisSeam, refute, settleDerivedBases, stage, stageCharter }));

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
        const correctionCycle = await runCorrectionCycle({ ctx, run, P, verdict: runState.verdict, firstRef, synthesisKey, synthesisModel, synthesisThinking }, { CORRECTIONS_DELIVERED_FILE, CORRECTIVE_RECHECK_FILE, asPartNotCompleted, correctionNamedLines, correctionNamedOrdinals, correctionNamedSet, correctionReading, correctionRows, correctionsExtra, correctiveCycleSettledDecision, enforceCorrectionsReachFindings, must, planAuditExtra, prepareDeclinationSpec, recordCorrectionsBasis, recordSynthesisSeam, removalRepairedRow, repairUnnamedRemovals, restoredFindingsTable, rollbackCorrectivePass, snapshotFindingsForCorrections, stage, writerExclusionBlock });
        runState.verdict = correctionCycle.verdict;
        ({ correctiveEntryVerdict, correctiveCycleSettled, correctiveRecheckOk } = correctionCycle);
    } },
    { name: "verdict-gate", run: async () => {
        // The verdict's floors and terminal guards (steps/verdict-gate.mjs).
        // applyVerdictFrontMatter is declared further down, so it goes in by name, read when called.
        ({ applyCoverageFloor, clampOnTheFloorDuty, clampOnTheWritersDuty, deliverAndClamp, followTheRecordsActions, saveTheLabel, saveTheOwedLabel, writeVerdictSidecar } = await runVerdictGate({ P, agent, applyVerdictFrontMatter: (...a) => applyVerdictFrontMatter(...a), correctiveCycleSettled, correctiveEntryVerdict, correctiveRecheckOk, coverageJudgment, ctx, opts, run, runState }, { StageFailure, actionsRegisterListed, conditionsFollowingTheRecord, defaultRecordFetcher, enrichFindingDeadlines, lateRecordsUnaddressed, loadCoverageLedger, loadScreenGateUnresolved, owedUrisFor, planAuditExtra, refusedRecordsLeftOut, registerGapConditions, safeReadJson, saveWithRetries, stage, withdrawByToken }));

        // R.1 primitive #3 (engagement receipt) is computed later, in the pre-delivery block, together with
        // F2 rule-shape + B2b reviewer self-coherence into ONE _driver/reasoning-integrity.json sidecar — that
        // point has report.md + senior-eye-review.md on disk too, so the single writer carries all three signals.
    } },
    { name: "overview-and-cards", run: async () => {
        // The report's overview and its cards (steps/overview-and-cards.mjs).
        ({ applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, findingsForCards, groupedMembers, overviewOpen, rebuildTheDeliveredRecord, restoreTheBrokenRecord, rov, writeScopeFacts, writeUps } = await runOverviewAndCards({ P, applyCoverageFloor, clampOnTheWritersDuty, ctx, followTheRecordsActions, job, run, runState, saveTheLabel, writeVerdictSidecar }, { StageFailure, applyScopeFrontMatterOf, asPartNotCompleted, assembleReportMd, caseLawJoin, consolidateFindingsFile, correctionsTheRestoreLacks, deriveCommonLawCarry, deriveRecordCarry, inScopeClassList, injectDeferralCoverage, injectFrontMatter, injectLaneDepthCoverage, injectMeaningGapCoverage, injectScreenGateCoverage, injectScriptScopeCoverage, keepDeliveredRecordAsHistory, localLanguageStateOf, must, openAskForClosure, originRowsForReport, planWriteUps, readFindingsForReport, readReadingLog, rebuildDeliveredRecord, reportIdentityRecord, restoreTheRecordThatPassed, rewriteFromBeforeTheSeam, runBatched, safeReadJson, settleDerivedBases, stage, stampCoverageJudgmentRows, withdrawSupersededAudit, writeScopeFactsOf, writeShortEntries }));
    } },
    { name: "delivery", run: async () => {
        // The checks before delivery, their repairs, and the publish (steps/delivery.mjs).
        return await runDelivery({ P, applyCoverageFloor, applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, checkLateBind, clampOnTheFloorDuty, clampOnTheWritersDuty, ctx, deliverAndClamp, findingsForCards, followTheRecordsActions, groupedMembers, job, opts, overviewOpen, publishAndDeliver, rebuildTheDeliveredRecord, restoreTheBrokenRecord, reviewOpen, rov, run, runState, saveTheLabel, saveTheOwedLabel, synthesisKey, synthesisModel, synthesisThinking, writeScopeFacts, writeUps, writeVerdictSidecar }, { CITED_URI_RE, NO_CHANGE, REBUILDS_THE_DELIVERED_RECORD, StageFailure, UPSTREAM_STALE_REPAIR, assembleReportMd, cardsNeverBuilt, caseLawJoin, computeOpenFloors, defaultRecordFetcher, fullProseOrdinals, inScopeClassList, injectFrontMatter, keepRankingReadByWriter, lateRecordIds, loadCoverageLedger, owedCardOrdinals, ownerScreenForDelivery, partitionDeliveryStale, postRepairScope, queuedForTheRecordOnly, rankingReadByWriterPath, readFindingsForReport, readFloorAxes, readGoodsHanded, reassembleFromTheRecord, recordChangeOwesReview, recordGoodsHanded, relabelCoverageRows, retainStateBeforeReview, runPostRepairCorrection, runPostRepairReview, runWholeReviewForRecord, safeReadJson, settleDerivedBases, stage, stageCharter, stagesStaleOnPlacement, unreadRecordFindingOnly, unreadRecordReview, whatTheRepairLeftStale });
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

// The calendar date of an existing LIVE run-dir for this job+codename (the leaf is "<date>-<codename>"), read
// off disk so a resume/re-run targets the ORIGINAL run regardless of today's date. null if no live run-dir.
function findRunDate(job, codename, studioRoot) {
  const slugDir = join(studioRoot ?? config.studioRoot, deriveSlug(job));
  let entries = [];
  try { entries = readdirSync(slugDir); } catch { /* none */ }
  const hit = entries.find((n) => /^\d{4}-\d\d-\d\d-/.test(n) && n.endsWith(`-${codename}`));
  return hit ? hit.match(/^(\d{4}-\d\d-\d\d)-/)[1] : null;
}

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

// Copy a stage's about-to-be-overwritten output (+ its per-stage telemetry) into _history/<ts>-<reason>/ so a
// prior result is NEVER lost and stays comparable. Returns the snapshot dir (or null if there was no output).
//
// STRUCTURED SIBLINGS (B2, review 2026-07-31): a stage may declare `outSibs` — machine artifacts written
// BESIDE its markdown output that downstream stages treat as authoritative. They are snapshotted with the
// md and then REMOVED from the run dir, because "the md was regenerated, the JSON was not" is exactly how
// a consumer ends up joining the previous pass's data while being told not to re-read the prose. The
// alternative (require sibling mtime ≥ the md's) does not survive an archive restore, where every file
// lands with a fresh mtime; removal is deterministic and its failure mode is a loud validator miss.
function snapshotOutputs(ctx, name, reason) {
  const def = STAGES[name];
  const out = def?.out ? def.out(ctx.paths, ctx.axis) : null;
  if (!out || !existsSync(out)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(ctx.paths.runDir, "_history", `${ts}-${reason}`);
  mkdirSync(dest, { recursive: true });
  copyFileSync(out, join(dest, basename(out)));
  for (const sib of (def.outSibs ? def.outSibs(ctx.paths, ctx.axis) : [])) {
    if (!sib || !existsSync(sib)) continue;
    try {
      copyFileSync(sib, join(dest, basename(sib)));
      rmSync(sib, { force: true });   // never leave the prior pass's machine record beside a fresh md
    } catch (e) { note(`[${name}] sibling snapshot/invalidate failed for ${basename(sib)} (${e.message})`); }
  }
  const label = name + (ctx.axis ? `:${ctx.axis}` : "");
  const tel = driverDir(ctx.paths.runDir, `${label}.jsonl`);
  if (existsSync(tel)) copyFileSync(tel, join(dest, basename(tel)));
  return dest;
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

/**
 * A DRAW IS WORK ON THIS BOX, AND THE DEPLOY GUARD HAS TO BE ABLE TO SEE IT.
 *
 * `pipeline()` takes a run slot, so a clearance is visible to `deployRefusal` and an hourly deploy defers
 * over it. A draw is a direct invocation and took nothing, so the guard saw an idle box and a tick could
 * fast-forward the checkout, reinstall and restart the units under a running experiment. Measured by the
 * test lane: the only thing protecting a replication was somebody stopping the deploy timer by hand,
 * which made that hold load-bearing without anyone having decided it should be.
 *
 * IT TAKES ITS OWN LOCK, NOT A RUN SLOT. A run slot is admission-controlled against
 * `maxConcurrentRuns`, so acquiring one here would make a draw WAIT behind clearances and make clearances
 * wait behind draws — changing what a draw is in order to fix what a guard can see. The `draw` prefix is
 * a separate namespace in the same directory: the deploy guard counts it, and nothing else does.
 *
 * The cap is deliberately far above any real number of concurrent draws, because this lock exists to be
 * SEEN and never to ration. A draw that blocked here would be a new failure mode in place of an old one.
 */
/**
 * Which findings the review is asked to ground in a profile, from the findings, the framework's bands and the depth. Read
 * from the writer's own record while a fold is in force, in the numbering of the narrative the review reads and of the
 * flags it writes (record-fold.mjs).
 */
export const reviewProfileSelection = (ctx) => profileOrdinals({
  findings: safeReadJson(modelRecordPath(ctx.paths.runDir, ctx.paths.findings)),
  bandOrder: ctx.framework?.bands ?? null,
  maxRank: ctx.depth?.profileKeptBandRank ?? null,
});

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
  CLEAROTRON_JX_LANES: ["2026-07-27", "the jx lane decision is frozen into the run's search policy; the per-lane CLEAROTRON_NATIVE_LANGUAGE_<XX> switches are still live"],
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
  if (!a.job && !a.codename) { console.error(USAGE); process.exit(2); }   // --resume alone rebuilds the job below
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

// ── — WHY THIS IMPORT IS AT THE BOTTOM OF THE FILE ─────────────────────────────────────────────
//
// `import` is hoisted, so its position is free — and at the top of THIS file it is not free. 61
// line-citations across 35 tracked files point into this file and its sibling; one line added at the
// top repoints every one of them by one. `scripts/citation-line-check.mjs` would catch only the few
// that landed on a blank line: it says so itself — "a citation that drifted onto a different REAL line
// reads as correct to it". So the choice was a 61-number sweep with a silent-error mode, or one import
// placed where it shifts nothing. This is the second.
//
// Move it to the top the day those citations name symbols instead of numbers — which is what
// CONTRIBUTING.md asks for, and what makes them checkable at all.

/**
 * The verdict conditions for an unfinished register search: the run record's sentence, and the client's.
 *
 * THE CLIENT'S CLAUSE IS THE SAME SENTENCE WITH THE ENGINE TOKEN TAKEN OUT (ruled 2026-09-18). The axis
 * names — `primary-sweep`, `incumbent-class` — are how the engine files a register slice, and they reached
 * the verdict a client reads as "register coverage deferred on primary-sweep". Nothing is written in their
 * place: the client reads the remaining words, and the run record keeps the axes for whoever repairs the run.
 * PURE.
 *
 * @returns {{ reason: string, clause: string }[]}
 */
export function registerGapConditions(regGap) {   // @internal
  const out = [];
  const deferredAxes = [...new Set((regGap?.deferred ?? []).map((g) => g?.axis).filter(Boolean))];
  if ((regGap?.deferred ?? []).length) out.push({
    reason: `register coverage deferred on ${deferredAxes.join(", ")} — the search did not finish and must be re-run before this can be relied on`,
    clause: "register coverage deferred — the search did not finish and must be re-run before this can be relied on",
  });
  if ((regGap?.taintAxes ?? []).length) out.push({
    reason: `the ${regGap.taintAxes.join(", ")} register pass was cut down at the timeout wall and its self-reported coverage is unverified`,
    clause: "the register pass was cut down at the timeout wall and its self-reported coverage is unverified",
  });
  return out;
}

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
 * A SYNTHESIS SAVE AFTER THE SEAM (the pre-delivery narrative redo, the in-pass stale repair) rewrites
 * findings.json from the seat's own call, and the seam's writes go with it: the coverage-judgment rows, the
 * injected coverage rows, the fold. The seam leaves them on the run's context, and they run again here,
 * before anything downstream reads the record. Before the seam there is nothing on the context, so nothing
 * runs. It sits at the end of this file so that adding it moved no line another file cites.
 */
async function afterLateSynthesisSave(name, ctx, r) {
  if (r?.ok && !r.skipped && name === "synthesis" && typeof ctx?.afterSynthesisSave === "function") await ctx.afterSynthesisSave();
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
 * THE MERGE BASE TAKES THE ENRICHED DEADLINES. A patch after the enrichment is merged onto
 * `_driver/synthesis-calls/accepted.json` and re-renders every finding from there, so a deadline written to the
 * findings file alone was dropped by the next patch, and a card built with it was rebuilt without it. In the model's
 * numbering: under a fold, a deadline lands on the member the fold kept, whose object the folded finding is, and the
 * fold carries it again. Only a finding the base holds with no deadline of its own takes one, as in the file. The
 * edit is judged as a call is; a refusal leaves the base as it was, and the receipt says what happened. Never throws.
 */
function rebaseEnrichedDeadlines(runDir, enriched) {
  const fold = readFold(runDir);
  const byOrdinal = new Map(enriched.map((e) => [keptModelOrdinal(fold, e.ordinal), e.date]).filter(([o]) => o != null));
  if (!byOrdinal.size) return "unmapped";
  const r = rebaseSynthesis(runDir, (held) => ({ ...held, findings: (Array.isArray(held?.findings) ? held.findings : [])
    .map((f) => (byOrdinal.has(f?.ordinal) && !f?.deadline?.date ? { ...f, deadline: { kind: "opposition", date: byOrdinal.get(f.ordinal) } } : f)) }));
  return r.ok ? (r.changed ? "enriched" : "unchanged") : /^no_base:/.test(String(r.reason)) ? "no-base" : "refused";
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
  return jobRebuiltFromStatus && scopeOnDisk ? null : instructedScopeOf(job);
}

// ── THE SALVAGE FOR A FOREIGN RECORD LINK: BLANK IT, RE-CHECK, DELIVER ──────────────────────────────────
//
// A seat that writes an office's page, or another register's, into a record link is refused by the
// findings gate (`finding_record_url_foreign_host`). The salvage lane below takes that token, because it is
// a `finding_…` token, but its lenient re-parse does not judge hosts, so it found nothing to repair and
// failed the run: R2 on 0.4.1-beta.1 delivered no report over eleven copied office links. Here the driver
// blanks every foreign link itself (blankForeignRecordLinks says how), keeps what it changed beside the run,
// and re-checks the file with the stage's own validator. A pass delivers; anything still refused falls
// through to the lanes below exactly as before, with fewer defects in the file.
export function foreignRecordLinksBlanked(r, ctx, name) {   // exported for its test
  const fail = String(r?.fail || "").replace(/^max_tokens_no_output:/, "");
  if (!fail.includes(FOREIGN_HOST_TOKEN) || !existsSync(ctx.paths.findings)) return false;
  let doc;
  try { doc = JSON.parse(readFileSync(ctx.paths.findings, "utf8")); } catch { return false; }
  const { doc: repaired, blanked, kept } = blankForeignRecordLinks(doc, activeRecordOrigins());
  if (!blanked.length) return false;
  writeFindings(ctx.paths.runDir, repaired, { why: "foreign-record-links-blanked", settles: [] });
  recordBlanking(ctx.paths.runDir, { stage: name, layer: "salvage", blanked, kept, fail });
  note(`[${name}] ${blanked.length} record link(s) on a host this register does not publish were blanked by the driver; the originals are in _driver/foreign-record-links.json`);
  const def = STAGES[name];
  const out = def?.out ? def.out(ctx.paths, ctx.axis) : null;
  const v = out && existsSync(out) && def.validate ? def.validate(out, readFileSync(out, "utf8")) : null;
  if (v?.ok) return true;
  runLog(ctx.paths.runDir, { event: "foreign-record-links-recheck", stage: name, ok: false, fail: String(v?.reason ?? "no validator").slice(0, 200) });
  return false;
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

/**
 * The repairs that fix only what they name: a delivery lint fault, or an object of the writer's record that failed the
 * strict parse. They are not told placement's set-asides with the order to check each ground (ruled 2026-10-19); every
 * other follow-up of the reading step and the writer is.
 */
export const NARROW_REPAIR_TRIGGERS = new Set(["lint-repair", "finding-reemit", "action-reemit", "ask-answer-reemit"]);   // @internal — driven by its test

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
