// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/delivery.mjs — the checks before delivery, the repairs they send back, and the publish that ends the run.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { runRecordLogPath } from "../../providers/_shared/ledger-path.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { readAnchors } from "../anchor-reader.mjs";
import { findCoverageLimitedCells, findSimilarListingSignals } from "../common-law-receipts.mjs";
import { coverageFormStamp, readCoverageForm } from "../coverage-form-io.mjs";
import { coverageAbsenceGaps, formLedgerRows } from "../coverage-form.mjs";
import { deriveCoverageStatus } from "../coverage-ledger.mjs";
import { findEngagementReceipts } from "../engagement-receipt.mjs";
import { bandBorderlineDeclarations, parseFindingsJson, parseFindingsJsonLenient } from "../findings-model.mjs";
import { frameResidualGaps } from "../frame-diff-model.mjs";
import { documentGrowth } from "../gate-metrics.mjs";
import { toolWrittenArtifact } from "../gateway.mjs";
import { readGoodsEvidence, readGoodsEvidenceAsWritten } from "../goods-evidence.mjs";
import { fileMeta, note, runLog } from "../log.mjs";
import { nextRefutationSeq, readAcceptedReviewSince } from "../narrative-refutation-record.mjs";
import { clearPartNotCompleted, readPartNotCompleted } from "../parts-not-completed.mjs";
import { rankedRecords, rankingFromJson, rankingNow, recordsReRanked } from "../placement-decisions.mjs";
import { parsePlacementsJson } from "../placement-model.mjs";
import { OVERVIEW_CITATION_ID, flagLines, goodsRepairLine, runLint } from "../predelivery-lint.mjs";
import { atomicWrite, signoffPatch, writeRunStatus } from "../progress.mjs";
import { emailConditionsOfReport } from "../publish/email-conditions.mjs";
import { findDeadlineUrgencyMiss, findOrphanVerificationFlags, findProbativeGradingViolations, findRecallFloorViolations, findReviewFreshnessViolation, findSeedNeutralityViolations, findStatusHonestyViolation, findUncrossCheckedDemotions, findUnresolvedDisagreements } from "../reasoning-tripwires.mjs";
import { findingUris } from "../record-carry.mjs";
import { FOLD_FILE, citingModelOrdinal, keptModelOrdinal, modelRecordPath, readFold } from "../record-fold.mjs";
import { applyRegistryCorrections, assembleRunRecords, normalizeRecordUri } from "../registry-fidelity.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { abbrev } from "../repair-contract.mjs";
import { snapshotRepairBase, writePostRepairRecord } from "../repair-scope.mjs";
import { locateReportFaults, overviewCitationFault, reportPartsOf, writersCitationFaults } from "../repair-targets.mjs";
import { findRuleShapeFlags } from "../rule-shape.mjs";
import { projectStageInput, restamp, settleOneShotStamp, shaOf, staleOnPath } from "../stage-freshness.mjs";
import { dependencyOrder, lines, stageInputs, stageOutputs } from "../stages.mjs";
import { clauseForDefect } from "../terminal-clamp.mjs";
import { VERDICT_RANK, findReviewerCoherenceFlags, lateReviewAgainst, parseVerdict } from "../verify.mjs";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export async function runDelivery({ P, applyCoverageFloor, applyRatedUnderFrontMatter, applyScopeFrontMatter, applyVerdictFrontMatter, assembledOrdinals, byRight, cardOrdinals, checkLateBind, clampOnTheFloorDuty, clampOnTheWritersDuty, ctx, deliverAndClamp, findingsForCards, followTheRecordsActions, groupedMembers, job, opts, overviewOpen, publishAndDeliver, rebuildTheDeliveredRecord, restoreTheBrokenRecord, reviewOpen, rov, run, runState, saveTheLabel, saveTheOwedLabel, synthesisKey, synthesisModel, synthesisThinking, writeScopeFacts, writeUps, writeVerdictSidecar }, helpers) {
  const { CITED_URI_RE, NO_CHANGE, REBUILDS_THE_DELIVERED_RECORD, StageFailure, UPSTREAM_STALE_REPAIR, assembleReportMd, cardsNeverBuilt, caseLawJoin, computeOpenFloors, defaultRecordFetcher, fullProseOrdinals, inScopeClassList, injectFrontMatter, keepRankingReadByWriter, lateRecordIds, loadCoverageLedger, owedCardOrdinals, ownerScreenForDelivery, partitionDeliveryStale, postRepairScope, queuedForTheRecordOnly, rankingReadByWriterPath, readFindingsForReport, readFloorAxes, readGoodsHanded, reassembleFromTheRecord, recordChangeOwesReview, recordGoodsHanded, relabelCoverageRows, retainStateBeforeReview, runPostRepairCorrection, runPostRepairReview, runWholeReviewForRecord, safeReadJson, settleDerivedBases, stage, stageCharter, stagesStaleOnPlacement, unreadRecordFindingOnly, unreadRecordReview, whatTheRepairLeftStale } = helpers;
  // ── Spec A1 + A2: pre-delivery verification — pure code, before ANYTHING outward-facing. Per the
  // user-amended design it NEVER withholds: every check lands in the receipt artifact; failing checks on a
  // drafting surface get ONE warm named-correction redo (the model re-types, this code re-judges); whatever
  // still fails ships as a visible plain-language flag at the top of the email + report. (Deviation from
  // the spec's "blocks delivery", approved 2026-06-10: delivering nothing is worse than delivering good
  // work with one clearly-labelled defect — and code-produced defects would deadlock a block.)
  {
    const lintPrefix = `clearance-${run.slug}-${run.codename}-`;
    // V4-1: the gates evaluate the artifact set assembled for THIS delivery — run-dir _records/
    // (inherited or prior-session) ∪ this-session ledger rows — never the session-prefixed ledger
    // alone (empty on a fork ⇒ the vacuous registry pass that shipped a false citation).
    let assembled = assembleRunRecords(run.runDir, lintPrefix);
    runLog(run.runDir, { event: "record-artifacts", count: assembled.records.size,
      fromRunDir: assembled.fromRunDir, fromLedgerThisSession: assembled.fromLedger,
      ...(assembled.ledgerError ? { ledgerError: assembled.ledgerError } : {}),
      ...(assembled.callLedgerError ? { callLedgerError: assembled.callLedgerError } : {}),
      ...(assembled.fetchedWithoutRecord ? { fetchedWithoutRecord: assembled.fetchedWithoutRecord,
        unrecordedFetches: assembled.unrecordedFetches.slice(0, 20) } : {}) });
    // — AN UNREADABLE LEDGER IS A FINDING, NOT A ZERO. The record ledger outgrew Node's maximum
    // string length and every read returned empty from a file that was present, readable and correct;
    // the run then assembled no records at all and nothing downstream said so — the fetch-receipt join
    // had an empty set and raised no flag, so a run with no records read exactly like a clean one.
    if (assembled.ledgerError)
      note(`[records] the fetch ledger could NOT be read (${assembled.ledgerError}) — this run's record set is EMPTY for that reason, `
        + `not because nothing was fetched; every verified-from-record claim will be unprovable and #563 will demote it`);
    // — THE RECORD LOG IS THIS RUN'S NOW, so an empty one is the ORDINARY state of a run before
    // its first fetch and can no longer be read as "something is wrong". These two lines are what stop
    // that from making an evidence hole invisible.
    if (assembled.callLedgerError)
      note(`[records] the CALL ledger could not be read (${assembled.callLedgerError}) — so this run cannot be checked for `
        + `fetches whose record body is missing; treat a clean record set as unverified, not as proven`);
    if (assembled.fetchedWithoutRecord)
      note(`[records] ${assembled.fetchedWithoutRecord} record fetch(es) succeeded this run and their bodies are NOT in the run's `
        + `record set (${assembled.unrecordedFetches.slice(0, 5).join(", ")}${assembled.fetchedWithoutRecord > 5 ? ", …" : ""}) — `
        + `the bodies were written somewhere this run does not read; every verified-from-record claim resting on them is unprovable`);

    // V4-2 — registry-evidence closure: every /mark/ URI cited on a delivered surface owes its record
    // to this run's set. ONE bounded driver-code fetch pass for the absentees (no agent turn, no
    // command lane); a record that cannot be fetched ships as the failing registry-record-coverage
    // flag with its mechanical cause. The plugin chokepoint writes the record log, so re-assembly
    // materializes _records/<id>.json for the auditor.
    const recordFetchFailures = new Map();
    {
      const surfacesText = [P.report].filter(existsSync)
        .map((f) => readFileSync(f, "utf8")).join("\n");
      const cited = new Set((surfacesText.match(CITED_URI_RE) ?? []).map((u) => u.toLowerCase()));
      // AND THE FINDINGS' OWN REGISTRATIONS, because the report is not a complete list of them. A
      // register that publishes no page per record prints no record address at all, so on those runs
      // the set built from the report above is EMPTY, this pass never runs, and bindFindingsToRecords
      // and joinEvidenceStatus have nothing to compare the cards against — every card then prints the
      // owner, status and dates as the model wrote them, and the only place that says so is the audit
      // workbook's "Record retrieved?" column. Measured over 45 days of test runs: six of nine runs on
      // such a register held no record at all, their findings citing 7 to 90 registrations each, while
      // every run on a register that does publish pages held 112 to 5,038. The findings name the
      // registrations whatever the register does. findingUris is the one derivation of that (it reads
      // owner.registrations[].uri and normalizes to the same lowercased /mark/ path this set keys on),
      // so this is the same question asked of a second source, not a second answer to it.
      for (const uri of findingUris(parseFindingsJsonLenient(
        existsSync(P.findings) ? readFileSync(P.findings, "utf8") : "").findings ?? []).keys()) cited.add(uri);
      const missing = [...cited].filter((u) => !assembled.records.has(u)).sort();
      if (missing.length) {
        note(`registry-record closure: ${missing.length} cited record(s) absent from the run's set — targeted fetch`);
        const fetcher = opts.recordFetcher ?? defaultRecordFetcher;
        for (const uri of missing) {
          const r = await fetcher(uri, { agentId: "clearotron-driver", sessionKey: `${lintPrefix}record-closure`, recordLog: runRecordLogPath(run.runDir) });
          if (!r.ok) recordFetchFailures.set(uri, r.cause);
        }
        assembled = assembleRunRecords(run.runDir, lintPrefix);   // pick up the closure fetches
        runLog(run.runDir, { event: "registry-record-closure", cited: cited.size, missing,
          fetched: missing.length - recordFetchFailures.size,
          failed: [...recordFetchFailures.entries()].map(([uri, cause]) => ({ uri, cause })) });
      }
    }

    const searchedNames = [...new Set([job.markName, job.name,
      ...(Array.isArray(job.marks) ? job.marks.map((m) => m?.name) : [])].filter(Boolean))];
    const lintNow = () => {
      const reportMd = existsSync(P.report) ? readFileSync(P.report, "utf8") : "";
      const narrativeMd = existsSync(P.narrative) ? readFileSync(P.narrative, "utf8") : ""; // R.1: narrative plumbing
      // One resolution per claim: audit.md is built just above this block, so it is on disk here.
      const auditMd = existsSync(P.audit) ? readFileSync(P.audit, "utf8") : "";
      // Re-assemble per lint: a repair redo may have re-emitted surfaces and the closure pass may have
      // grown the set — every re-lint must see the CURRENT record set, not a block-entry snapshot.
      assembled = assembleRunRecords(run.runDir, lintPrefix);
      // doc-31 counts-from-the-finding-set: pass the model's findings so the lint can flag a prose registration
      // count that undershoots what the finding set lists. Malformed findings.json is already a validators.findings
      // fail upstream — a parse miss here just skips the count check (never a double-throw).
      // ION/copper-foundry (2026-07-22): the RAW text is kept as well as the parsed doc, so the
      // permission-prose check can read coverage[] notes — the parsed findings array never carries them.
      // The read happens before the parse, so a malformed findings.json is still scanned for the claim.
      // ACCEPTED FLOOR, stated plainly because the opposite is easy to assume: on the incident run itself
      // this surface was CLEAN. The false claim lived in register-units/*.json, _driver/register-plan.json,
      // the register coverage ledger and skeptic-flags.md — none of which runLint scans. Guarding the four
      // delivered surfaces is the scope here; widening it to the internal register surfaces is its own change.
      let lintFindings = null, lintSv = 1, lintMarkAssessment = null, lintActions = null, lintFindingsRaw = "", lintAskAnswers = null, lintFourAnswers = null;
      try {
        if (existsSync(P.findings)) {
          lintFindingsRaw = readFileSync(P.findings, "utf8");
          const doc = parseFindingsJson(lintFindingsRaw);
          lintFindings = doc.findings; lintSv = doc.schemaVersion ?? 1; lintMarkAssessment = doc.markAssessment ?? null;
          lintActions = doc.actions ?? null;   // spec 64 — the typed register joins the coherence checks
          lintAskAnswers = doc.askAnswers ?? null;   // PR-9 — the intake-ask lint judges the JOIN on v5 runs
          lintFourAnswers = doc.fourAnswers ?? null;   // P5 — the four answers join the content-model presence checks
        }
      } catch {
        // — the strict parse throwing used to leave lintFindings null, and EVERY findings-based
        // content-model check then emitted nothing at all. So on exactly the runs where the contract
        // was missed — the ones that exhaust the corrective ladder and proceed on the lenient doc —
        // the lint was silent about it, and silence read as a clean surface. Fall back to the same
        // lenient parse the delivery path itself used: the checks judge the record that ships.
        try { if (lintFindingsRaw) {
          const soft = parseFindingsJsonLenient(lintFindingsRaw);
          lintFindings = soft.findings; lintSv = soft.schemaVersion ?? 1; lintMarkAssessment = soft.markAssessment ?? null;
          lintActions = soft.actions ?? null; lintAskAnswers = soft.askAnswers ?? null; lintFourAnswers = soft.fourAnswers ?? null;
        } } catch { /* validators.findings owns the unparseable case */ }
      }
      // The narrative's finding headings are in the model's numbering: once the record is folded, its
      // write-ups join the record the model wrote (record-fold.mjs).
      let lintNarrativeFindings = null;
      const lintModelAt = modelRecordPath(run.runDir, P.findings);
      if (lintModelAt !== P.findings) {
        try { lintNarrativeFindings = parseFindingsJsonLenient(readFileSync(lintModelAt, "utf8")).findings; } catch { lintNarrativeFindings = null; }
      }
      // wp50/wi2 — the sidecar tier joins the lint so overall-level prose can't contradict it.
      let lintVerdict = null;
      try { lintVerdict = JSON.parse(readFileSync(driverDir(run.runDir, "verdict.json"), "utf8")); } catch { /* legacy */ }
      // B2 — placements.json joins the lint ONLY so an empty mirror surfaces as a flag (the parser no
      // longer throws on it). Absent (every archived run) or malformed (validators.placement owns that
      // case) ⇒ null ⇒ no check is emitted.
      let lintPlacements = null;
      try { lintPlacements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements; } catch { /* absent or malformed — not this lint's business */ }
      // — the retrieval→findings trace joins the lint so an unreasoned drop, and a drop that is
      // really an incomplete upstream stage, are both stated on the delivery surface a human reads.
      // Read back from the artifact the run already wrote (unlike the doubt mint, which re-derives):
      // this is the lint reporting what the run recorded, and re-reading a 10 MB band at the lint
      // seam to restate it would buy nothing. Absent (every archived run) ⇒ null ⇒ no check emitted.
      const lintRecordCarry = safeReadJson(P.recordCarry);
      // — the common-law and jx slice traces, which nothing downstream read. The SAME pair the
      // reconciliation siblings use at the derive seam, so a third list cannot drift from those two.
      const lintCommonLawCarries = [P.commonLawCarry, P.jxZhCarry].map((f) => safeReadJson(f)).filter(Boolean);
      return runLint({
        // `clientSummaryMd` is deliberately NOT passed (2026-08-01): the stage is retired and a live
        // run writes no client-summary.md. Every client-summary-capable check in predelivery-lint.mjs
        // is presence-gated and simply emits nothing here; they stay alive for replay-archive.mjs,
        // which passes the archived summary.
        reportMd, narrativeMd, auditMd, recordsByUri: assembled.records, searchedNames,
        // What each record's goods rested on when the writer wrote, and the records whose whole text a delivery repair
        // was already handed: a finding written on goods the register cut, whose whole body the run holds now. The
        // evidence is the copy kept when the writer was dispatched cold, which no later band merge rewrites; a run that
        // kept none, written before the copy existed, is read on the evidence as it stands.
        goodsEvidence: readGoodsEvidenceAsWritten(run.runDir) ?? readGoodsEvidence(run.runDir), goodsHanded: readGoodsHanded(run.runDir),
        // The overview as its writer wrote it, read for a citation of a finding the report does not carry; and the
        // conditions the email carries, as the email composes them.
        overviewMd: (() => { try { return readFileSync(P.reportOverview, "utf8"); } catch { return null; } })(), emailConditions: emailConditionsOfReport(reportMd, lintVerdict?.verdict),
        fetchFailures: recordFetchFailures, findings: lintFindings, narrativeFindings: lintNarrativeFindings, findingsRaw: lintFindingsRaw, actionsRegister: lintActions, verdictDoc: lintVerdict,
        // WP-56 B2 — fresh v4 runs expect the standing mark-assessment (structural banner flag when
        // absent). The replay harness's runLint call never passes this, so archived runs never flip.
        markAssessment: lintMarkAssessment, markAssessmentExpected: lintSv >= 4,
        // P5 — fresh v5 runs expect the content model (legal/practical split, manageable categories,
        // four answers). Structural banner flags when absent; the replay harness never passes this.
        fourAnswers: lintFourAnswers, contentModelExpected: lintSv >= 5,
        // — the DECLARED version, so the lint can say when a fresh run is behind the dictated
        // contract and the v6 parser gates never engaged. Live runs only: the replay harness passes
        // nothing here, so archived runs never grow the check.
        findingsSchemaVersion: lintSv,
        placements: lintPlacements,   // B2 — flag-only: an empty structured mirror is stated, never a validator kill
        recordCarry: lintRecordCarry,   // — flag-only: an unreasoned drop, and an upstream-absent one, are named on the delivery surface
        commonLawCarries: lintCommonLawCarries,   // — a lane that flagged its own trace wrong reaches the delivery surface
        actionsExpected: lintSv >= 4,   // spec 64 — a fresh v4 run without the register ships a visible structural flag
        seniorRights: ctx.seniorRights?.rows ?? (() => { try { return JSON.parse(readFileSync(driverDir(run.runDir, "senior-rights.json"), "utf8")).rows; } catch { return null; } })(),   // WP-receipts W4
        seniorRightsExpected: ctx.seniorRightsExpected === true,   // D1 — expected-but-absent is a failing structural check, never a silent pass
        manifest: lintSv >= 4 ? ctx.framework : null,   // doc 50: v4 tier words judged in the frozen framework's vocabulary
        intakeAsks: ctx.intakeAsks ?? (() => { try { return JSON.parse(readFileSync(driverDir(run.runDir, "intake-asks.json"), "utf8")).asks; } catch { return []; } })(),   // A6
        askAnswers: lintAskAnswers,   // PR-9 — present ⇒ the intake-ask check judges the deterministic join, not fuzzy containment
        cardFolds: (() => { try { return JSON.parse(readFileSync(driverDir(run.runDir, "card-folds.json"), "utf8")).folds; } catch { return null; } })(),   // PR-9 — fold observability (flag-only)
        extraPlatformNames: ctx.profile?.platforms ?? [],   // WS-B: profile marketplaces are run vocabulary
        // the SAME structure the masthead's coverage_line is stamped from
        // (scope-facts.json, written by writeScopeFacts). Passing the sidecar rather than re-deriving
        // is the point of the issue: the stamped line and the prose check now answer to one searched
        // set, so they cannot state two different answers about what was searched. Absent sidecar ⇒
        // null ⇒ the check emits nothing at all, rather than a pass it cannot justify.
        searchedJurisdictions: (() => {
          try { return JSON.parse(readFileSync(P.scopeFacts, "utf8")).searched_jurisdictions ?? null; }
          catch { return null; }
        })(),
        // compose guarantees the NAME(S) cell via the searched-name fallback, and code (not the model)
        // builds the per-name rating rows — so these reflect the DELIVERED state (regressions are caught
        // by the publish unit tests; the receipt still names every check).
        // 2026-08-01: this used to read `shape.headerName || …`, where shape came from
        // clientSummaryShape(csMd) — a model-authored header on the retired client summary. With that
        // surface gone the fallback IS the value, and it is the better one: the searched names are
        // code-carried, so templateChecks now judges against what the run actually searched.
        headerName: searchedNames.join(" / "),
        ratedNames: searchedNames,
        // P2-B — the owner×element screen's receipt arms the named-competitor checks. Absent (a
        // matter with no incumbent lane, or an archived run) ⇒ neither check is emitted at all.
        ownerScreen: ownerScreenForDelivery(ctx),
        depth: ctx.depth,   // — the narrative depth rules are a per-product row; absent ⇒ no check
        // — the corpora the party-fact rule partitions. The GRID is material about parties; the
        // fetched records' goods wording is a claim about a registration's scope and is read only from
        // `recordsByUri` above. Absent (an archived run, or a register-only matter with no grid) ⇒ the
        // check emits nothing at all rather than a passing row, because there is nothing to test against.
        commonLawGrid: safeReadJson(P.commonLawGrid),
        matterContext: (() => { try { return readFileSync(P.matterContext, "utf8"); } catch { return ""; } })(),
        clientPartyName: ctx.profile?.name ?? null,
      });
    };
    // — the LAST settle, after refutation and the corrective pass. The audit this replaced ran
    // ONCE, before refutation, and its own numbers prove that was too early: re-derived on the four
    // delivered findings.json files it measured, the verified-stamp counts came out 35→37, 28→31,
    // 37→38, 41→40. Two stamps entered R1's deliverable AFTER the only pass that checked
    // them. A derivation is cheap enough to run at every seam, so it runs at the last one too.
    settleDerivedBases(ctx, "pre-delivery");
    let lint = lintNow();
    // spec 64 — CODE-FIRST repair for a verdict/actions/statement incoherence: the defect is a
    // derivation/staleness bug (the sidecar disagrees with the final findings), so the fix is to
    // RE-DERIVE (applyCoverageFloor + writeVerdictSidecar) and re-lint — never an LLM redo, and never
    // an edit to the actions. One attempt; a residual failure ships as the structural banner flag.
    if (lint.failures.some((f) => f.id === "verdict-actions-coherence" || f.id === "verdict-actions-stale" || f.id === "statement-tier" || f.id === "statement-unconditional" || f.id === "statement-stance" || f.id === "statement-conditional-form")) {
      const beforeVerdict = runState.verdict;
      followTheRecordsActions("in the delivery check's re-derive");   // a stale step goes, as a missing one arrives
      applyCoverageFloor();
      try { writeVerdictSidecar(); }
      catch (e) { throw new StageFailure("verdict", `verdict sidecar re-derive failed (spec-64 coherence repair): ${String(e.message).slice(0, 120)}`); }
      if (runState.verdict !== beforeVerdict) writeRunStatus(ctx, signoffPatch(runState.verdict));
      runLog(run.runDir, { event: "verdict-rederive-repair", from: beforeVerdict, to: runState.verdict });
      lint = lintNow();
    }
    const initialFailures = lint.failures;
    const repaired = [];
    // doc-27 Item 1b ("close the loop"): deterministic registry auto-correction. The registry-record-match
    // guard holds the fetched record's true value, so for numeric identifiers code overwrites the stated
    // value FROM the record (and logs it) rather than relying on the model to re-type it. Run it (a) BEFORE
    // the redo, so the redo only sees residuals (status/arithmetic/reference) and (b) AFTER the redo, since a
    // redo re-emits the WHOLE file and could reintroduce a wrong identifier — the record-true value is the
    // LAST word. PR-4: STATUS TOKENS joined the corrected set (label/parenthetical positions, polarity
    // contradiction only — applyRegistryCorrections); free status prose stays redo territory.
    // `registryCorrections` is DEDUPED on push so a revert→
    // re-correct cycle does not double-count the audit trail; the re-lint fires whenever the file changed.
    const registryCorrections = [];
    const autoCorrectRegistry = () => {
      if (!lint.failures.some((f) => f.id === "registry-record-match")) return;
      let changed = false, newly = 0;
      for (const [file, surface] of [[P.report, "report"]]) {
        if (!existsSync(file)) continue;
        const before = readFileSync(file, "utf8");
        const { text: after, corrections } = applyRegistryCorrections(before, assembled.records);
        if (corrections.length && after !== before) {
          writeFileSync(file, after);
          // THE CORRECTION MUST NOT READ AS STALENESS. `report.md` is watched by the freshness
          // gate on the delivery path, so rewriting it here moves a sha the
          // freshness gate is watching, and the gate then blocks delivery with "the report was
          // assembled from material that has since changed". That is a deadlock rather than a delay:
          // on resume assembleReportMd re-runs unconditionally from the UNCORRECTED card files, this
          // corrector re-applies the byte-identical fix, the failure signature is identical, and the
          // second occurrence is repeat-signature TERMINAL. The client gets nothing, after a fully
          // paid search, because we fixed a registration number for them.
          //
          // restamp() exists for exactly this class and says so — "a post-stage mutator rewrote
          // absPath — account for it everywhere it is recorded, so the change does not read as
          // staleness no recompute could settle". The front-matter injectors already use it the same
          // way (injectFrontMatter). Scoped to THIS file only: a blanket restamp would blind the gate
          // to genuinely stale material, which is the failure it exists to catch.
          restamp(run.runDir, file, { project: projectStageInput });
          changed = true;
          for (const c of corrections) {
            const key = `${surface}|${c.field}|${c.uri}|${c.from}|${c.to}`;
            if (!registryCorrections.some((e) => `${e.surface}|${e.field}|${e.uri}|${e.from}|${e.to}` === key)) {
              registryCorrections.push({ ...c, surface });
              newly++;
            }
          }
        }
      }
      if (changed) {
        if (newly) runLog(run.runDir, { event: "registry-auto-correct", count: newly,
          corrections: registryCorrections.slice(-newly).map((c) => `${c.surface}/${c.field}: "${c.from}"→"${c.to}" (${c.uri})`) });
        lint = lintNow();   // re-judge against the corrected surfaces (the file changed)
      }
    };
    autoCorrectRegistry();
    // RETIRED 2026-08-01 with the client-summary stage: the deterministic client-tier auto-correct
    // ( A2 / F4), the recommendation-bound auto-bind ( T2 / H5) and the BOUNDARY
    // LADDER above them — auto-correct → one forced cold re-emit with the verdict sidecar dictated
    // → a hard deterministic StageFailure — are all DELETED. This is not a gate weakening: the
    // ladder guarded a client-facing surface that no longer ships anywhere. What still guards the
    // report the client actually reads is unchanged — the code-built verdict-bound row
    // (composeEmailHtml opts.verdict, from _driver/verdict.json), the pre-delivery lint below, and
    // the client gate. On the R2 evidence run this ladder was where the cost landed: three
    // byte-identical failures before it exhausted.
    // The writer's accepted record as it stood just before the delivery-check repair, kept only when that
    // repair runs: the review after the repair is handed what changed between the two (repair-scope.mjs).
    let repairBaseKept = false;
    if (lint.failures.length) {
      runLog(run.runDir, { event: "predelivery-lint-failed", failures: lint.failures.map((f) => f.id) });
      const bySurface = (s) => lint.failures.filter((f) => f.surface === s || (s === "report" && f.surface === "all"));
      // STRUCTURAL failures (a 404'd/un-fetchable cited record — registry-record-coverage marked `structural`
      // by the lint) cannot be repaired by re-emitting a drafting surface, so they NEVER trigger a warm redo:
      // they already ship as a visible flag (standing delivery philosophy), and a redo is doomed (the record
      // does not exist). TONICA/ashen-keystone burned ~14 min re-emitting 35KB of report.md for a GB record that
      // 404'd. modelFixable = the residue an LLM redo can actually fix; a structural-only surface skips the redo.
      const modelFixable = (failures) => failures.filter((f) => !f.structural);
      // CONVERSION 4 — THE LINT-REPAIR RUNG IS A REPAIR SURFACE, AND IT COMPOSES ITS OWN
      // FOLLOWUP. gateway.mjs's warm patch and cold corrective both consult TOOL_WRITTEN_ARTIFACTS and
      // turn a repair into a CALL; this ladder did not, so the first shell repair after the conversion
      // would have handed a seat `editRepairTail`'s "TARGETED EDITS … using the Edit tool" for an
      // artifact whose only writer is the driver — an order it cannot obey, because the conversion took
      // `Write` and `Edit` out of its grant. Same class as the ten anchor sites and the max-tokens
      // corrective before it: a retirement reaches the first-attempt surfaces and misses a correction
      // surface. Keyed on the ARTIFACT rather than on the label, so conversions 5 and 6 inherit it.
      const redo = async (label, failures, key, model, thinking, file, more = {}) => {
        if (!failures.length || !key) return;
        note(`pre-delivery lint: ${failures.length} failed check(s) on ${label} — one warm named-correction redo`);
        const toolWritten = file ? toolWrittenArtifact(file) : null;
        const r = await stage(label, ctx, {
          force: true, sessionKey: key, model, thinking, trigger: "lint-repair",
          followup: repairFollowup("*:lint-repair", { label, file, toolWritten, failures, ...more })
            + stageCharter(label, ctx.depth, ctx.framework),
        });
        if (r.ok) repaired.push(label);
      };
      // A citation of a withdrawn or absent finding in the overview's own prose is the overview's to remove, in the
      // words its repair is given (repair-targets.mjs), so its check's failure is not placed a second time below.
      const reportFixable = modelFixable(bySurface("report")).filter((f) => f.id !== OVERVIEW_CITATION_ID);
      const reportParts = reportPartsOf(P, findingsForCards, writeUps);
      const overviewCites = overviewCitationFault(lint.failures);
      const reportStructuralOnly = bySurface("report").filter((f) => f.structural);
      if (reportStructuralOnly.length && !reportFixable.length && !overviewCites) {
        runLog(run.runDir, { event: "lint-redo-skipped-structural", surface: "report", failures: reportStructuralOnly.map((f) => f.id) });
        note(`pre-delivery lint: report failure(s) are structural (un-fetchable record) — shipping as flags, no doomed redo`);
      }
      // B1 — report.md is ASSEMBLED, not one session: a failure keyed to a finding ordinal (e.g. a
      // finding-provenance bleed) re-renders THAT card alone, FRESH (isolated from its own record, so the bleed
      // cannot recur); a shell failure (no ordinal) re-runs report-overview. Then re-assemble. Bounded: one pass.
      let reassembled = false;
      // Each fault goes to the part that holds it (repair-targets.mjs): a card's to that card, with the detail its
      // check gives on that card alone; the overview's to the overview; and a fault only the lines composed from the
      // record hold to the writer's repair below, since the record is the writer's, and so does one a register of the
      // record holds. One no single part holds keeps the overview's repair.
      const targets = locateReportFaults(reportFixable, reportParts);
      const shellFixable = [...targets.overview, ...(overviewCites ? [overviewCites] : [])];
      if (reportFixable.length || overviewCites) runLog(run.runDir, { event: "report-repair-targets", cards: [...targets.cards.keys()],
        overview: shellFixable.map((f) => f.id), stamped: targets.stamped.map((f) => f.id), record: targets.record.map((f) => f.id),
        unlocated: targets.unlocated.map((f) => f.id) });
      const badOrdinals = [...targets.cards.keys()];
      for (const ord of badOrdinals) {
        const f = findingsForCards.find((x) => x.ordinal === ord);
        if (!f) continue;
        // The card is re-rendered FRESH, and for a provenance bleed that IS the repair — isolation from the
        // record it was contaminated by. For a PROSE defect (permission-prose) it is not: nothing about the
        // finding changed, so a silent regeneration is free to write the same sentence again. Hand the card
        // its own failing details, the way the retired client-summary re-emit handed over the verdict authority.
        // Write mode: this stays a FULL WRITE, and not by omission. `extra` rides the card stage's OWN
        // message (which carries its write mandate) on a cold session with no prior card in context, and
        // isolation from the contaminated rendering is the entire point — patching the bad card would
        // preserve exactly what the re-render exists to discard. The redo() ladder below is the opposite
        // case (a warm resume of a session that owns its file) and patches.
        const why = targets.cards.get(ord).map((x) => x.detail).filter(Boolean);
        const rc = await stage("report-card", { ...ctx, axis: String(ord), finding: f }, {
          force: true, trigger: "lint-repair",
          ...(why.length ? { extra: lines(
            `The deterministic pre-delivery lint failed these checks on the previous rendering of THIS card:`,
            ...why.map((d) => `- ${d}`),
            `Fix ONLY what the checks name; change nothing else about the card.`,
          ) } : {}),
        });
        if (rc.ok) { repaired.push(`report-card:${ord}`); reassembled = true; }
      }
      if (shellFixable.length && rov) { await redo("report-overview", shellFixable, rov.sessionKey, rov.model, rov.thinking, P.reportOverview); if (repaired.includes("report-overview")) reassembled = true; }
      // — THE NARRATIVE REDO ROUTE. The same mechanism report-overview already has, re-aimed at
      // the seat that wrote narrative.md. Without it a depth check could only FLAG, and a flag on a
      // narrative that broke the rules is the run shipping the defect with a note attached. ONE followup
      // pass, named violations; a second overrun ships and the lint row is the record.
      //
      // A FAULT IN A LINE COMPOSED FROM THE RECORD (a finding's own sentence, a short entry, a grouped line) is the
      // writer's too: no card or overview repair can change what the renderer stamps from the record. It joins the
      // narrative's faults in the writer's one repair, each named by the finding that owns it, in the numbering the
      // writer's save takes. Its consumers then rebuild, and its change is reviewed, as for any repair of the record.
      // A fault a register of the record holds (the four answers citing a finding the review withdrew) joins it, one
      // line per withdrawn finding it cites, in that numbering.
      const fold = readFold(run.runDir);
      const sentenceFixable = targets.stamped.flatMap((f) => (f.parts ?? []).map((x) => ({ ...f, finding: keptModelOrdinal(fold, x.ordinal), detail: x.detail })));
      const recordFixable = targets.record.flatMap((f) => writersCitationFaults(f, (o) => keptModelOrdinal(fold, o)));
      // A finding named for goods the register cut, whose whole text the run holds now, is named in the writer's
      // numbering, in the line's own words: it opens with the finding it names, so the list puts no "finding N:" before it.
      // Under a fold the report displays the text of the member the fold kept, and the citation of the record can come
      // from another member: the line then names both, so the repair reaches the text the report displays (design,
      // 2026-11-04). Where the fold cannot be read, or no member is read citing the record, the line is not handed: a
      // member is never guessed, and the run records each finding left unhanded.
      const foldUnreadable = fold == null && existsSync(driverDir(run.runDir, FOLD_FILE));
      let writersFindings = null;   // the writer's record, read once and only for a goods line
      const writersRecord = () => {
        if (writersFindings) return writersFindings;
        try { writersFindings = parseFindingsJsonLenient(readFileSync(modelRecordPath(run.runDir, P.findings), "utf8")).findings ?? []; }
        catch { writersFindings = []; }
        return writersFindings;
      };
      const citesRecord = (wf, uri) => (Array.isArray(wf?.owner?.registrations) ? wf.owner.registrations : [])
        .some((reg) => normalizeRecordUri(reg?.uri ?? reg) === uri);
      const goodsUnhanded = [];
      const inWritersNumbering = (f) => {
        if (!String(f.id).startsWith("goods-held-whole:")) return f;
        const shown = foldUnreadable ? null : keptModelOrdinal(fold, f.ordinal);
        const citing = shown == null ? null : citingModelOrdinal(fold, f.ordinal, f.uri, writersRecord(), citesRecord);
        const detail = goodsRepairLine({ shown, citing, uri: f.uri, goods: f.goods, state: f.state });
        if (detail == null) { goodsUnhanded.push({ id: f.id, why: shown == null ? "fold-not-read" : "no-member-read-citing" }); return null; }
        return { ...f, detail };
      };
      const narrativeFixable = [...modelFixable(bySurface("narrative")).map(inWritersNumbering).filter(Boolean), ...sentenceFixable, ...recordFixable];
      if (goodsUnhanded.length) runLog(run.runDir, { event: "goods-held-whole-not-handed", unhanded: goodsUnhanded });
      if (narrativeFixable.length && synthesisKey) repairBaseKept = snapshotRepairBase(run.runDir);
      // A writer fault with no writer session to repair it is not repaired, and the run says so.
      if (narrativeFixable.length && !synthesisKey)
        runLog(run.runDir, { event: "lint-redo-skipped", surface: "writer", why: "no-writer-session", failures: narrativeFixable.map((f) => f.id) });
      if (narrativeFixable.length) await redo("synthesis", narrativeFixable, synthesisKey, synthesisModel, synthesisThinking, P.narrative,
        { findings: modelRecordPath(run.runDir, P.findings), narrative: P.narrative });
      // The records whose whole goods text this repair was handed, kept so the check after it does not name them again.
      const goodsHandedNow = narrativeFixable.filter((f) => String(f.id).startsWith("goods-held-whole:")).map((f) => f.uri);
      if (goodsHandedNow.length && repaired.includes("synthesis")) {
        try {
          recordGoodsHanded(run.runDir, goodsHandedNow);
          runLog(run.runDir, { event: "goods-held-whole-handed", records: [...new Set(goodsHandedNow)].sort() });
        } catch (e) { note(`pre-delivery lint: the records handed their whole goods text were not recorded: ${e?.message ?? e}`); }
      }
      if (reassembled) assembleReportMd(P, findingsForCards, assembledOrdinals, { grouped: groupedMembers, byRight });
      // The client-summary redo arm is retired with the stage (2026-08-01). Its `email`-surface
      // failures have not gone unowned: the `:email` reference check now runs over the report-derived
      // cover text (predelivery-lint.mjs runLint), and those failures ship as visible flags on the
      // cover note itself — the A10 enumeration block — exactly like every other unrepaired check.
      if (repaired.length) {
        // a redo/reassembly rewrote report.md — re-apply every driver-owned front-matter field
        applyVerdictFrontMatter();
        writeScopeFacts();            // compute-don't-author: re-derive (a repair pass may follow a coverage change) …
        applyScopeFrontMatter();      // … and re-stamp the driver-owned scope line over the re-emitted masthead
        applyRatedUnderFrontMatter();  // … and the profile/framework/project disclosure (PR-11: one closure, was a paste)
        // T2: the derived label/badge/bound recommendation too
        lint = lintNow();
        autoCorrectRegistry();        // doc-27 Item 1b: a re-emission may have reintroduced a wrong identifier — overwrite from the record again
      }
    }
    // THE GOODS REFRESH'S OUTCOME, kept in the run record whatever this pass did (predelivery-lint.mjs,
    // goodsHeldWholeChecks): the findings named for the repair, those still saying their goods are cut or unread after
    // it, and the check's own count of the ones that no longer say so.
    try {
      const rows = (lint?.checks ?? []).filter((c) => /^goods-held-whole(?::|-unresolved:|$)/.test(String(c.id)));
      if (rows.some((c) => c.id !== "goods-held-whole") || readGoodsHanded(run.runDir).size)
        runLog(run.runDir, { event: "goods-held-whole",
          named: rows.filter((c) => c.id.startsWith("goods-held-whole:")).map((c) => c.id.slice("goods-held-whole:".length)),
          unresolved: rows.filter((c) => c.id.startsWith("goods-held-whole-unresolved:")).map((c) => c.id.slice("goods-held-whole-unresolved:".length)),
          summary: rows.find((c) => c.id === "goods-held-whole")?.detail ?? null });
    } catch { /* the run record's row is best-effort; the check's own rows are in the receipt below */ }
    // The receipt artifact — ALWAYS written, pass or fail (spec A2's auditor evidence).
    // V4-1: the receipt states the ARTIFACT SET evaluated — surfaces, record set + sources, and the
    // stage labels this session inherited via skip — so an auditor can see the gates ran over
    // inherited content (check counts alone cannot betray a vacuous pass).
    // P2 clause 3 — the DELIVERY PRECONDITION, computed here so it lands IN the receipt below.
    // A report may only ship when nothing it was built from has moved underneath it. Computed before the
    // receipt write (not after) because `gate-metrics.mjs` reads this sink POST-publish for the
    // lint-repair-tax metric: recording the verdict here means no consumer can read the failure list of
    // a stale-blocked run and mistake it for a delivery-quality signal. The receipt itself stays
    // ALWAYS-WRITTEN (spec A2 auditor evidence) — blocking a run must not cost us the evidence of why.
    // The cards on the path are the ones the record owes as it stands, read again each time the path is judged: a
    // synthesis save after the cards can add a finding that is owed one, or withdraw one whose card is owed no longer.
    const deliveryPathStages = () => [...new Set([
      ...(ctx.skippedStages ?? []), "register-digest", "synthesis", "narrative-refutation",
      "report-overview", ...owedCardOrdinals(P, ctx.depth).map((o) => `report-card:${o}`),
    ])];
    const deliveryInputsFor = (label) => {
      const bare = label.replace(/:.*$/, "");
      const axis = label.includes(":") ? label.slice(label.indexOf(":") + 1) : null;
      try { return stageInputs(bare, P, { axes: ctx.axes, axis, registerOnly: ctx.registerOnly }); } catch { return []; }
    };
    // A part not completed has no stage to be stale: the overview's shell is the driver's own, the review is not run
    // again, and nothing re-runs either.
    const deliveryPathNow = () => deliveryPathStages().filter((l) => !(overviewOpen && l === "report-overview")
      && !(reviewOpen && l === "narrative-refutation"));
    runState.staleOnTheDeliveryPath = () => [...staleOnPath(run.runDir, deliveryPathNow(), deliveryInputsFor, { project: projectStageInput }),
      ...cardsNeverBuilt(P, ctx.depth, cardOrdinals)];   // a finding a later save added is owed its one card call
    runState.staleStages = runState.staleOnTheDeliveryPath();
    // A DELIVERY-CHECK REPAIR THAT CHANGED ONLY THE FINDINGS RECORD leaves the narrative's bytes, and so the
    // reviewer, fresh — the reviewer does not declare findings.json. The change is still content no review has
    // read, so the reviewer is queued for the review after a repair, marked as the record's change.
    if (repairBaseKept && !runState.staleStages.some((s2) => s2.label === "narrative-refutation")) {
      if (recordChangeOwesReview(run.runDir)) {
        // At the FRONT, so the dependency order below puts it after the writer and ahead of the overview and the
        // cards, which then rebuild from whatever its correction changes.
        runState.staleStages.unshift({ label: "narrative-refutation", changed: [{ name: basename(P.findings), via: "repair-record" }] });
        runLog(run.runDir, { event: "post-repair-review-queued", why: "the repair changed the findings record only" });
      }
    }
    // A RESUME AFTER SUCH A CHANGE WENT UNREVIEWED: its record queues the reviewer again, so this pass reviews it.
    if (unreadRecordReview(run.runDir) && !runState.staleStages.some((s2) => s2.label === "narrative-refutation")) {
      runState.staleStages.unshift({ label: "narrative-refutation", changed: [{ name: basename(P.findings), via: "repair-record" }] });
      runLog(run.runDir, { event: "post-repair-review-queued", why: "a change to the findings record went unreviewed" });
    }
    // ── AD-2 A1 (E2E-R2, ordering) — repair-owned staleness is re-done IN-PASS, never parked. The
    // pre-delivery repair can move an input under the tail this pass already built (the observed
    // case: the report-overview lint redo rewrote findings.json, staling every report card + the
    // client summary), and the only remedy used to be the stale throw below — a full park/resume
    // cycle that re-drove the whole pipeline to re-render a handful of cards (34% of the E2E-R2
    // run). The stale GUARD stays — it was RIGHT to block — but a staleness confined to the stages
    // THIS pass generates (report-overview / report-card:N) is re-done here, from
    // the CURRENT inputs, exactly once; whatever is still stale after the re-do falls through to
    // the guard unchanged. Any upstream label in the set (register-digest, synthesis, …) keeps the
    // park path untouched: those recomputes need pipeline order.
    const staleRepaired = [];
    // ── item 15a — REPAIR IN DEPENDENCY ORDER, never suppress all repair because one label is upstream ──
    //
    // This used to run only when EVERY stale label was in the delivery tail: one upstream label and the
    // whole pass parked, re-driving the entire pipeline to rebuild a handful of surfaces. The ruling is
    // that mixed staleness is repaired in dependency order — upstream first, then what depends on it,
    // then the independent tails. The thing that must never happen is repairing a TAIL while its
    // UPSTREAM is still stale, and ordering prevents that; suppressing everything does not, it just
    // moves the same work into a resume.
    //
    // The order is derived from the two declaration maps (stages.mjs dependencyOrder over stageOutputs ×
    // stageInputs), never hand-written — which is why 15c had to land first: without knowing who WROTE
    // the artifact that moved there is no order to repair in.
    //
    // Still ONE bounded pass, exactly as before: each label is re-done at most once, and whatever is
    // still stale afterwards blocks at the guard below. Nothing here weakens that guard.
    if (runState.staleStages.length) {
      const ordered = dependencyOrder(runState.staleStages.map((s2) => s2.label), P, { axes: ctx.axes });
      runState.staleStages = ordered.map((l) => runState.staleStages.find((s2) => s2.label === l)).filter(Boolean);
      const upstreamCount = partitionDeliveryStale(runState.staleStages).upstream.length;
      runLog(run.runDir, { event: "delivery-stale-repair", stages: runState.staleStages.map((s2) => s2.label), upstream: upstreamCount, order: ordered });
      note(`delivery: ${runState.staleStages.length} stale stage(s)${upstreamCount ? ` (${upstreamCount} upstream)` : ""} — re-doing them in-pass in DEPENDENCY ORDER (${ordered.join(" → ")}); what went stale, never a pipeline restart`);
      // The whole point is that the staled consumers rebuild from the MOVED input: re-read the
      // findings as they now stand — the pre-repair snapshot this pass rendered from is the past.
      let readNow = readFindingsForReport(P);
      let findingsNow = readNow.findings;
      let ordinalsNow = fullProseOrdinals(findingsNow);
      if (readNow.rejected) note(`stale-repair: findings.json is present and REJECTED by the strict parser (${readNow.rejected}) — ${findingsNow.length} finding(s) still join by ordinal; this rejection is the run's defect, not a missing finding`);
      let caseLawNow = new Map();
      try {
        if (existsSync(P.caseLaw)) caseLawNow = caseLawJoin(P, findingsNow);
      } catch { /* no case-law layer */ }
      let reassemble = false;
      // THE LATE VERDICT, ONE RULE FOR BOTH REVIEWS THIS LOOP CAN RUN — the whole review and the review after
      // a delivery-check repair. A late review may only harden the run's verdict, and a softer one is logged,
      // never adopted. Returns what it found, so the review after a repair can keep the review whose verdict
      // the run carries in senior-eye-review.md.
      const adoptLateReview = (reviewNow, stageLabel) => {
        const { hardened, softened: reviewSays } = lateReviewAgainst(runState.verdict, reviewNow);
        // A late review harsher than the assessment is a ground of its own: a gap closed later never lifts it.
        const says = parseVerdict(reviewNow);
        if ((VERDICT_RANK[says] ?? -1) > (VERDICT_RANK[runState.assessed] ?? -1)) runState.assessed = says;
        // A REVIEW THAT SOFTENED IS NOT ADOPTED, AND THE RUN SAYS SO. The ratchet below only
        // tightens, so a re-review that comes back softer leaves the settled verdict in force while
        // senior-eye-review.md, rewritten by this repair, opens with the softer word. That is the
        // design; recording nothing was the defect: a reader of the run found two answers and no
        // line saying which one governs (measured in testing, 2026-09-23: BLOCKING recorded, CONDITIONAL on disk).
        if (reviewSays) {
          runLog(run.runDir, { event: "verdict-softening-not-adopted", was: runState.verdict, reviewSays, stage: stageLabel });
          note(`stale-repair: the reviewer now returns ${reviewSays}; the run keeps ${runState.verdict}, because a late re-review may only harden the verdict — senior-eye-review.md now disagrees with verdict.json, and verdict.json governs`);
        }
        if (hardened) {
          // ── T3a — THE LATE VERDICT IS ADOPTED, NOT THROWN, AND ADOPTION IS THE WHOLE JOB ──
          //
          // built the throw here because a late hardening was an input the gate had been
          // DENIED: the verdict settles thousands of lines earlier, nothing re-reads the review,
          // so a reviewer refusing to sign DURING this repair "is written to disk and never
          // heard". Measured on `bf21580e` — the narrative printed a registration date of
          // 1 March 2011 against a record reading 25 February 2011, the reviewer said so, and
          // the run delivered anyway.
          //
          // DELETING THE THROW WITHOUT A DESTINATION RE-OPENS EXACTLY THAT HOLE, and that is
          // why this branch is not the same edit as the gate's. The owner's ruling removes the
          // REFUSAL; it does not say the reviewer stops being heard. So the late verdict is
          // adopted as the run's own and everything derived from it is rebuilt:
          //
          //   · `verdict` and status.json      — the run's own record
          //   · verdict.json                   — "the single label authority" (its words)
          //   · `reassemble`                   — assembleReportMd re-runs, so the open-points
          //                                      section is built from THIS review, and
          //                                      applyVerdictFrontMatter re-reads the sidecar
          //                                      and re-stamps overall_label / overall_badge
          //
          // Without the sidecar write the report would ship BADGED WITH THE VERDICT SETTLED
          // BEFORE THE REVIEWER HARDENED — refused by the reviewer, labelled CONDITIONAL. That
          // is worse than either behaviour this replaces, and it is `bf21580e`'s shape one
          // layer up: the reviewer's word on disk and the client's document disagreeing.
          //
          // `verdictHardenedTo` still ratchets ONE WAY, so a review that SOFTENED during the
          // repair still cannot lift a clamp. This branch only ever tightens.
          runLog(run.runDir, { event: "verdict-hardened-by-repair", was: runState.verdict, now: hardened, stage: stageLabel, adopted: true });
          note(`stale-repair: the reviewer returned ${hardened} — adopting it as the run's verdict (the one settled earlier was decided against a review this repair has since rewritten) and rebuilding the label from it`);
          runState.verdict = hardened;
          writeRunStatus(ctx, signoffPatch(runState.verdict));
          try { writeVerdictSidecar(); }
          catch (e) { throw new StageFailure("verdict", `verdict sidecar write failed (the single label authority): ${String(e.message).slice(0, 120)}`); }
          reassemble = true;
        }
        return { hardened, softened: reviewSays };
      };
      const processedLabels = new Set();   // the labels this loop has re-done, for the re-queue after a correction
      const requeuedLabels = new Set();
      const repairFailed = new Map();   // label → why its re-run in this loop did not complete
      // A CHANGED DECISION IS READ AGAIN IN THIS PASS. A repeated placement pass whose decisions moved leaves the reading
      // step, the writer and the review stale, and each of them leaves what reads it stale in turn. They are queued here,
      // in dependency order after the stage that moved them, each re-done at most once more; one already queued runs where
      // it stands, and a stage stale before the repair for the same reasons is not the repair's. The reviewer gets the whole
      // review and its one correction, and the writer is judged again against its duty and the recall gate. The pass
      // then ends with all of them rebuilt from the decision that stands. The guard below used to park the run on them,
      // and the resume re-ran them, until the owner's ruling of 2026-10-19 that a run is never held. A stage still stale
      // after its re-run still falls to the guard: no approved sentence states that case yet.
      const chain = new Set();
      const staleNow = () => staleOnPath(run.runDir, deliveryPathStages(), deliveryInputsFor, { project: projectStageInput });
      const queueWhatItLeftStale = (s2, before) => {
        const at = runState.staleStages.indexOf(s2) + 1;
        const left = whatTheRepairLeftStale({ before, after: staleNow(), repaired: s2.label,
          ahead: new Set(runState.staleStages.slice(at).map((x) => x.label)), processed: processedLabels, requeued: requeuedLabels });
        for (const l of left.chain) chain.add(l);
        for (const l of left.requeue) requeuedLabels.add(l);
        if (!left.queue.length) return;
        const rest = [...runState.staleStages.slice(at), ...left.queue];
        const order = [...new Set(dependencyOrder(rest.map((x) => x.label), P, { axes: ctx.axes }))];   // each label once
        runState.staleStages.splice(at, runState.staleStages.length - at, ...order.map((l) => rest.find((x) => x.label === l)).filter(Boolean));
        runLog(run.runDir, { event: "delivery-stale-requeued", after: s2.label, stages: left.queue.map((x) => x.label) });
      };
      // A STAGE STALE ON WHAT PLACEMENT WROTE IS THE CHAIN'S FROM THE START, whoever moved it: the decisions written
      // again when the shape is derived again, or a late pass whose readers had already run, as much as this check's
      // own repeat. Its re-run is followed, and a re-run that does not complete delivers.
      const placementWrote = new Set([...stageOutputs("placement-inquiry", P, { axes: ctx.axes }).map((f) => basename(f)), basename(P.placementDecisions)]);
      for (const l of stagesStaleOnPlacement(runState.staleStages, placementWrote)) chain.add(l);
      for (const s2 of runState.staleStages) {
        processedLabels.add(s2.label);
        if (s2.label === "report-overview") {
          const r = await stage("report-overview", { ...ctx, displayVerdict: runState.displayVerdict }, { force: true, trigger: "stale-repair" });
          if (r.ok) { staleRepaired.push(s2.label); reassemble = true; }
          else note(`stale-repair: report-overview re-emit failed (${r.fail}) — stays stale, the guard below decides`);
        } else if (s2.label === "narrative-refutation"
            && (chain.has(s2.label) || postRepairScope(run.runDir, P, s2, { staleRepaired, baseKept: repairBaseKept }).mode !== "whole"
              || queuedForTheRecordOnly(s2) || unreadRecordReview(run.runDir))) {
          // A REVIEWER A CHANGED DECISION QUEUED is given the whole review and its one correction here, as the pass that
          // re-ran it on a resume gave it a review and a correction.
          // THE REVIEW AFTER A DELIVERY-CHECK REPAIR (see runPostRepairReview). Reached where the scope is certain, and
          // where a change to the record, or one an earlier review could not read, is reviewed whole: that review's
          // flags go to the same one correction. Every other staleness of the reviewer takes the arm below, as before.
          // A CHANGE NO REVIEW READ IS REVIEWED WHOLE, whatever this pass's own repair changed: the base this pass
          // kept follows the earlier change, so a narrowed review would read only the later one, and saving the same
          // values again would settle a stamp over a change nobody read.
          const unreadOnEntry = unreadRecordReview(run.runDir);
          const narrowedScope = postRepairScope(run.runDir, P, s2, { staleRepaired, baseKept: repairBaseKept });
          const scope = unreadOnEntry && narrowedScope.mode !== "whole" ? { mode: "whole", why: "an earlier change went unreviewed" } : narrowedScope;
          if (scope.mode === "none") {
            // A FILE WRITTEN AGAIN WITH THE SAME VALUES IS NOT A CHANGE: no review runs, and the reviewer's stamp
            // takes the rewrite as accounted for, so the delivery guard does not block on it.
            settleOneShotStamp(run.runDir, "narrative-refutation", [P.narrative], "repair-changed-no-content");
            runLog(run.runDir, { event: "post-repair-review-not-needed", why: scope.why });
            note(`[post-repair] the repair saved the same values again — no review needed`);
            staleRepaired.push(s2.label);
            continue;
          }
          const rerun = () => UPSTREAM_STALE_REPAIR[s2.label](ctx, { displayVerdict: runState.displayVerdict });
          // THE STATE THIS REVIEW READS IS KEPT WHOLE before it runs, so a correction that fails after it has a trusted
          // state to come back to even where the record itself is lost meanwhile.
          retainStateBeforeReview(run.runDir, P);
          // A scope that cannot be narrowed is reviewed whole at once, and its record lists no change it could compare.
          let review = scope.mode === "whole"
            // A resume reviews the change its earlier record names, so that record says what the change was.
            ? await runWholeReviewForRecord(ctx, P, run, { ...scope, changed: scope.changed ?? NO_CHANGE,
              findingOnly: unreadRecordFindingOnly(run.runDir) ?? queuedForTheRecordOnly(s2) }, rerun)
            : await runPostRepairReview(ctx, P, run, scope);
          // A narrowed review that could not be read falls back to the whole review, whose points go to the same one
          // correction below: neither the stamp of a findings-only change nor that of a stage that ends ok on the
          // earlier review's file can show the change unread. When the whole review cannot be read either, its
          // record keeps the change no review read; the record holds nothing (see `unreadRecordReview`).
          if (!review.reviewed && scope.mode !== "whole") review = await runWholeReviewForRecord(ctx, P, run, scope, rerun);
          if (!review.reviewed) continue;
          staleRepaired.push(s2.label);
          reassemble = true;
          // senior-eye-review.md HOLDS THE REVIEW WHOSE VERDICT THE RUN CARRIES. A narrowed review that hardened
          // the verdict stays in place, so the open questions print its grounds; otherwise the whole review goes
          // back, and the narrowed one is kept under _driver/.
          const { hardened } = adoptLateReview(review.reviewText, s2.label);
          if (!hardened) review.putBack();
          if (review.rec.flags.length) {
            const pass = await runPostRepairCorrection(ctx, P, run, { rec: review.rec, items: review.items, points: review.points,
              grounds: Boolean(hardened), whole: review.base?.whole === true, synthesisRef: { key: synthesisKey, model: synthesisModel, thinking: synthesisThinking } });
            if (!pass.ok) runState.correctionRejectedAt = new Date().toISOString();   // a rejected correction gives no result back
            // NOTHING REVIEWS THE CORRECTION: the reviewer's stamp takes what it changed as accounted for, and so
            // does the first cycle's receipt, so a resume re-fires neither.
            settleOneShotStamp(run.runDir, "narrative-refutation", [P.narrative], "post-repair-fix");
            try {
              const at = driverDir(run.runDir, "corrective-cycle.json");
              let receipt = null;
              try { receipt = JSON.parse(readFileSync(at, "utf8")); } catch { receipt = null; }
              atomicWrite(at, JSON.stringify({ ...(receipt ?? { entryVerdict: runState.verdict }), ts: new Date().toISOString(), verdict: runState.verdict,
                shas: { review: shaOf(P.seniorEyeReview), narrative: shaOf(P.narrative) }, settledBy: "post-repair-cycle" }, null, 2) + "\n");
            } catch (e) { note(`[post-repair] the cycle receipt could not be rewritten (${String(e?.message ?? e).slice(0, 100)}) — a resume may re-fire the first correction`); }
            // ITS CONSUMERS REBUILD FROM WHAT IT WROTE: re-read the findings, and queue the overview and any card it
            // left stale that this loop has not queued already.
            readNow = readFindingsForReport(P);
            findingsNow = readNow.findings;
            ordinalsNow = fullProseOrdinals(findingsNow);
            try {
              if (existsSync(P.caseLaw)) caseLawNow = caseLawJoin(P, findingsNow);
            } catch { /* no case-law layer */ }
            // After a correction, and after a rollback that rebuilt the record from a save, what reads the record is
            // rebuilt from it; a rollback that put the same bytes back leaves nothing stale, and queues nothing.
            if (pass.ok || pass.rollback) {
              // A label not queued yet is appended; one this loop already re-done is re-queued ONCE, so the
              // pass stays bounded and still ends with every surface rebuilt from the corrected record.
              const queued = new Set(runState.staleStages.map((x) => x.label));
              // A finding the correction's save added is owed its one card call, as after any later save.
              for (const x of [...staleOnPath(run.runDir, deliveryPathStages(), deliveryInputsFor, { project: projectStageInput }),
                ...cardsNeverBuilt(P, ctx.depth, cardOrdinals)]) {
                if (!(x.label === "report-overview" || x.label.startsWith("report-card:"))) continue;
                if (!queued.has(x.label)) { runState.staleStages.push(x); queued.add(x.label); }
                else if (processedLabels.has(x.label) && !requeuedLabels.has(x.label)) { requeuedLabels.add(x.label); runState.staleStages.push(x); }
              }
            }
            // THE WRITER'S DUTY, JUDGED AGAIN ONCE THE CORRECTION HAS SETTLED, rollback included. The terminal guards judged
            // it on the record before this correction. A correction that rolled back restores a record that the duty as it
            // now stands may not be met by: a save restored as accepted work, or records owed since the save was made. The
            // approved clause names what it leaves unaccounted, and a gap it closed withdraws its clause, as after the
            // writer's re-run in this loop; the label is saved again before anything is published.
            {
              const was = runState.verdict, stood = JSON.stringify(runState.clampReasons);
              const judged = clampOnTheWritersDuty({ again: true });
              if (runState.restoredClear && runState.verdict === "CLEAR") applyCoverageFloor();
              if (JSON.stringify(runState.clampReasons) !== stood || runState.verdict !== was) saveTheLabel("after the correction after a post-repair review");
              runLog(run.runDir, { event: "writer-duty-after-correction", was, now: runState.verdict, rolledBack: Boolean(pass.rollback),
                owed: judged.duty?.computable === true ? judged.duty.totals?.owed ?? null : null,
                unaccounted: judged.duty?.computable === true ? judged.duty.unaccounted.length : null, recall: judged.recall });
            }
          }
          continue;
        } else if (UPSTREAM_STALE_REPAIR[s2.label]) {
          // The upstream arm (item 15a). Each of these re-runs the SAME stage the pipeline would have
          // run, forced, with a `stale-repair` trigger so the telemetry says why. Dependency order put
          // it ahead of anything that reads what it writes, so the tail arms below rebuild from the
          // repaired artifact rather than from the one that moved.
          const reviewSeq0 = s2.label === "narrative-refutation" ? nextRefutationSeq(run.runDir) : null;
          const staleBefore = s2.label === "placement-inquiry" || chain.has(s2.label) ? staleNow() : null;   // what was stale before this one
          if (s2.label === "placement-inquiry" && !runState.rankingBeforeRepeat) runState.rankingBeforeRepeat = rankingNow(P);   // as the writer last read it
          const r = await UPSTREAM_STALE_REPAIR[s2.label](ctx, { displayVerdict: runState.displayVerdict });
          // NOT A PASS: a reviewer that ends with no accepted call reads ok whenever the earlier review's file
          // stands, and its stamp is refreshed over the change it never read. The record says so, the run delivers,
          // and a resume for any other cause reviews the change whole.
          if (r?.ok && s2.label === "narrative-refutation" && !readAcceptedReviewSince(run.runDir, reviewSeq0)) {
            writePostRepairRecord(run.runDir, { status: "unread", whole: true, findingOnly: queuedForTheRecordOnly(s2), by: "stale-repair", fail: "no-accepted-call" });
            runLog(run.runDir, { event: "post-repair-review", read: false, whole: true, fail: "no-accepted-call" });
            note(`stale-repair: the reviewer's re-run recorded no review — the change it was queued for is unreviewed; the run's record says so, and the run delivers`);
          } else if (r?.ok) {
            staleRepaired.push(s2.label);
            reassemble = true;
            // THE FLOOR, APPLIED AGAIN TO THE PLACEMENT THE REPORT IS NOW BUILT FROM. The delivery floor was judged on
            // the placement account before this repair; the repeated pass has recorded its own floor duty, and the
            // stages after it rebuild from it in this loop. The same rule is applied to that account, through the
            // same clamp, so the delivered verdict, its floor and its record describe one pass. It only tightens.
            if (s2.label === "placement-inquiry") {
              const was = runState.verdict, stood = JSON.stringify(runState.clampReasons);
              clampOnTheFloorDuty({ again: true });
              clampOnTheWritersDuty({ again: true });   // the recall gate leaves out the floor that now stands
              // A save that fails here is tried again, then owed, never the end of the run: see saveTheLabel.
              if (JSON.stringify(runState.clampReasons) !== stood || runState.verdict !== was) saveTheLabel("after the repeated placement pass");
              runLog(run.runDir, { event: "floor-duty-after-repair", was, now: runState.verdict });
            }
            // A whole review that is read reviews the change an earlier unread one left: its record says so, and
            // its points stand under the late-review rule below, as any whole review's do. (The arm above has
            // already set aside a stage that read ok without an accepted review.)
            if (s2.label === "narrative-refutation" && unreadRecordReview(run.runDir))
              writePostRepairRecord(run.runDir, { status: "read", whole: true, by: "stale-repair" });
            // its consumers rebuild from what it JUST wrote — re-read, do not carry the pre-repair copy
            readNow = readFindingsForReport(P);
            findingsNow = readNow.findings;
            ordinalsNow = fullProseOrdinals(findingsNow);
            try {
              if (existsSync(P.caseLaw)) caseLawNow = caseLawJoin(P, findingsNow);
            } catch { /* no case-law layer */ }
            for (const owed of cardsNeverBuilt(P, ctx.depth, cardOrdinals)) if (!runState.staleStages.some((x) => x.label === owed.label)) runState.staleStages.push(owed);
            // — AND THE REVIEW IS ALSO SOMETHING THIS PASS JUST WROTE.
            //
            // The re-reads above are the artifacts a repaired stage's CONSUMERS need. narrative-refutation
            // has no consumer here: what it authors is senior-eye-review.md, whose first line is the
            // verdict that decides whether this run may deliver at all — and that verdict was settled
            // thousands of lines earlier, at the gate. Nothing re-reads it, so a reviewer that refuses to
            // sign DURING this repair is written to disk and never heard.
            //
            // Measured on `bf21580e` (round of 2026-08-23): verdict-2 CONDITIONAL at 00:22:11;
            // `delivery-stale-repair` at 00:38:35 naming narrative-refutation; the review landing BLOCKING
            // at 00:52:01; delivered. The narrative printed a registration date of 1 March 2011 against a
            // fetched record reading 25 February 2011 — the reviewer said so, in the document nobody read.
            //
            // NOT a "stop on BLOCKING" check bolted beside the gate. The gate's own terminal is correct and
            // stays where it is; this restores the input it was denied. `verdictHardenedTo` ratchets one
            // way, so a review that softened during the repair cannot lift a clamp.
            if (s2.label === "narrative-refutation") {
              adoptLateReview(existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : "", s2.label);
            }
            // THE WRITER, JUDGED AGAIN WHEN A CHANGED DECISION RE-RAN IT. Its duty and the recall gate were judged on the
            // writer before it; a gap this one opens is named through the same clamps, and one already named stays named.
            // The label is saved again as the floor's is above, through saveTheLabel.
            if (s2.label === "synthesis") keepRankingReadByWriter(P);   // where each record stood as this writer read it
            if (s2.label === "synthesis" && chain.has(s2.label)) {
              const was = runState.verdict, stood = JSON.stringify(runState.clampReasons);
              const judged = clampOnTheWritersDuty({ again: true });
              // A CLEAR a closed gap gave back meets the floor again on what this writer now says: its forward actions
              // are a ground of their own.
              if (runState.restoredClear && runState.verdict === "CLEAR") applyCoverageFloor();
              if (JSON.stringify(runState.clampReasons) !== stood || runState.verdict !== was) saveTheLabel("after the writer's re-run");
              runLog(run.runDir, { event: "writer-duty-after-repair", was, now: runState.verdict,
                owed: judged.duty?.computable === true ? judged.duty.totals?.owed ?? null : null,
                unaccounted: judged.duty?.computable === true ? judged.duty.unaccounted.length : null, recall: judged.recall });
            }
            if (staleBefore) queueWhatItLeftStale(s2, staleBefore);
          } else {
            repairFailed.set(s2.label, String(r?.fail ?? "failed").slice(0, 200));
            note(`stale-repair: ${s2.label} re-run failed (${r?.fail}) — stays stale, the guard below decides`);
          }
        } else if (s2.label.startsWith("report-card:")) {
          const ord = Number(s2.label.slice("report-card:".length));
          const f = findingsNow.find((x) => x.ordinal === ord);
          if (!f || !ordinalsNow.includes(ord)) {
            // — name the CAUSE, not the symptom. This line ran 26 times on R1 while all 26 findings
            // sat in the file, because the strict parser's rejection had been converted into zero
            // findings upstream. A card with no finding and a file that was refused are different
            // problems with different fixes, and the run must not describe one as the other.
            note(readNow.rejected
              ? `stale-repair: ${s2.label} cannot be repaired because findings.json was REJECTED (${readNow.rejected}) — the finding may well be present; fix the rejection, not the card`
              : `stale-repair: ${s2.label} has no full-prose finding in the current findings.json — stays stale, the guard below decides`);
            continue;
          }
          const rc2 = await stage("report-card", { ...ctx, axis: String(ord), finding: f, caseLawProfile: caseLawNow.get(ord) ?? null }, { force: true, trigger: "stale-repair" });
          if (rc2.ok) { staleRepaired.push(s2.label); reassemble = true; }
          else note(`stale-repair: ${s2.label} re-render failed (${rc2.fail}) — stays stale, the guard below decides`);
        }
      }
      if (reassemble) {
        reassembleFromTheRecord(P, findingsNow, ctx.depth);   // the plan the first assembly used, made from the record as it stands
        applyVerdictFrontMatter();      // the reassembly rewrote report.md — re-apply every driver-owned
                                        // field, exactly as the lint-repair branch above does
        writeScopeFacts();
        applyScopeFrontMatter();
        applyRatedUnderFrontMatter();
        // A repair that re-ran a stage the trace and the Audit Trail report has both written again, before the lint
        // below reads the trace. A rebuild that fails withdraws the audit written before the repair, as a failed first
        // build ships none.
        if (rebuildTheDeliveredRecord && staleRepaired.some((l) => REBUILDS_THE_DELIVERED_RECORD.has(l))) {
          const rebuilt = rebuildTheDeliveredRecord("stale-repair");
          if (!rebuilt.ok) note(`stale-repair: the audit could not be written again (${String(rebuilt.reason).slice(0, 100)}) — the one written before the repair is withdrawn and kept under _history; the report ships without an audit`);
        }
      }
      // The AD-2 in-pass stale-repair arm for client-summary is retired with the stage
      // (2026-08-01): nothing generates that label, so it can never turn up stale here.
      // Re-judge the repaired surfaces exactly as the lint-repair branch does, then RE-ASK the
      // freshness question — one bounded pass; anything still stale blocks below, exactly as before.
      lint = lintNow();
      autoCorrectRegistry();
      runState.staleStages = staleOnPath(run.runDir, deliveryPathNow(), deliveryInputsFor, { project: projectStageInput });
      // A REPAIR WHOSE REVIEW COULD NOT BE READ IS NOT REVIEWED, and its record says so (`unreadRecordReview`). The guard
      // is never handed that record: a run is not held on an unread review (owner's ruling, 2026-10-19). What the guard
      // reads here is staleness alone, as in the released engine.
      // A CHANGED DECISION STILL UNREAD AFTER ITS RE-RUN IS DELIVERED, NOT HELD (the owner's ruling of 2026-10-19 that a
      // run is never held). When every stage still stale is one the changed decision left stale and whose re-run in
      // this pass did not complete, the run delivers what it has. The writer's duty and the recall gate are judged
      // again on the writer delivered, and name in their approved sentences what they find. Staleness for any other
      // reason still falls to the guard.
      // LATE RECORDS NO PLACEMENT PASS COULD ASSESS ARE DELIVERED, NOT HELD (ruled 2026-10-19). The band gained records
      // after placement's last pass, and neither the pass that would have assessed them nor the delivery check's repeat
      // of placement completed. The report stands as the last accepted passes built it. An account from before the late
      // records cannot show they were assessed, so the floor and the recall gate are judged again on the band as it
      // stands, and the late records the report does not address are counted in the approved sentence for records
      // neither addressed nor set aside. The attempts and the records are kept in the run record.
      const unassessed = repairFailed.has("placement-inquiry") ? lateRecordIds(P) : [];
      if (unassessed.length && runState.staleStages.some((x) => x.label === "placement-inquiry")
        && runState.staleStages.every((x) => x.label === "placement-inquiry" || chain.has(x.label))) {
        const was = runState.verdict, stood = JSON.stringify(runState.clampReasons);
        clampOnTheFloorDuty({ again: true });
        const judged = clampOnTheWritersDuty({ again: true });
        if ((JSON.stringify(runState.clampReasons) !== stood || runState.verdict !== was) && saveTheLabel("after late records went unassessed")) applyVerdictFrontMatter();
        runLog(run.runDir, { event: "late-evidence-unassessed-delivered", was, now: runState.verdict, records: unassessed.length, ids: unassessed.slice(0, 20),
          stated: judged.recall, latePass: ctx.latePassFailed ?? null, repeat: repairFailed.get("placement-inquiry") });
        note(`late evidence: ${unassessed.length} record(s) reached the band after placement's last pass, and neither its pass for them nor the delivery check's repeat completed — the run delivers what the last accepted passes built, and the approved clauses state what is open`);
        runState.staleStages = runState.staleStages.filter((x) => x.label !== "placement-inquiry");
      }
      if (runState.staleStages.length && runState.staleStages.every((x) => chain.has(x.label))) {
        const was = runState.verdict, named = runState.clampReasons.length, stood = JSON.stringify(runState.clampReasons);
        clampOnTheWritersDuty({ again: true });
        // THE RECORDS RE-RANKED SINCE THE WRITER LAST WROTE, in the owner's words of 2026-10-19. The report states the
        // ranking the writer last read; the audit trail, written again after the repeat, states the one that stands.
        const readByWriter = rankingFromJson(safeReadJson(rankingReadByWriterPath(P))) ?? runState.rankingBeforeRepeat;
        if (readByWriter && runState.staleStages.some((x) => x.label === "synthesis")) {
          const now = rankingNow(P), n = recordsReRanked(readByWriter, now);
          const m = Math.max(rankedRecords(readByWriter), rankedRecords(now), n);
          if (n > 0) deliverAndClamp({
            event: "ranking-changed-unread-delivered",
            defect: `ranking_changed_unread:${n}`,
            detail: { records: n, of: m },
            reason: `ranking_changed_unread:${n} of ${m} record(s) — the delivery check's repeat of placement changed where these records stand, and the writer's re-run for the change did not complete, so the report gives the ranking it last read and the audit trail the one that stands. The report ships with this named rather than being withheld.`,
            clause: clauseForDefect("ranking_changed_unread", n, m),
          });
        }
        if ((JSON.stringify(runState.clampReasons) !== stood || runState.verdict !== was) && saveTheLabel("after a changed decision went unread")) applyVerdictFrontMatter();
        runLog(run.runDir, { event: "changed-decision-unread-delivered", was, now: runState.verdict, named: runState.clampReasons.length - named,
          stages: runState.staleStages.map((x) => ({ label: x.label, changed: (x.changed ?? []).map((c) => c.name) })) });
        note(`stale-repair: ${runState.staleStages.map((x) => x.label).join(", ")} could not be re-run for the changed decision — the run delivers, and the approved clauses name what they find`);
        runState.staleStages = [];
      }
      saveTheOwedLabel();   // before anything is published from it
      note(`stale-repair: re-did ${staleRepaired.length} stage(s) in-pass (${staleRepaired.join(", ") || "none"}) — ${runState.staleStages.length ? `${runState.staleStages.length} still stale, the delivery guard blocks` : "the delivery path is fresh"}`);
    }
    // THE CONDITIONS FOLLOW THE RECORD AS IT IS DELIVERED, whichever repair above moved it last, and the label owed is
    // saved before the receipt below and anything published from it. A list that moved is judged again.
    if (followTheRecordsActions("as the record is delivered")) {
      saveTheLabel("as the record is delivered");
      applyVerdictFrontMatter();
      lint = lintNow();
    }
    saveTheOwedLabel();
    // P2 — record the delivery-BLOCKING stale labels the moment they are known (not only at the throw
    // below), so ANY later exit from this pass — the staleness throw, a core-artifact throw between here
    // and it, an auto-recovery park — carries the set into reconcilePassStamps. Reconcile must leave these
    // stamps stale (see reconcileStamps' `exclude`), else it erases the block and the resume ships stale.
    if (runState.staleStages.length) ctx.deliveryBlockingStale = new Set(runState.staleStages.map((s2) => s2.label));
    try {
      writeFileSync(driverDir(run.runDir, "predelivery-lint.json"), JSON.stringify({
        ts: new Date().toISOString(),
        checks: lint.checks, failures: lint.failures.map((f) => f.id),
        staleStages: runState.staleStages,   // P2: non-empty ⇒ this run was blocked on freshness, not on lint quality
        staleRepaired,   // AD-2 A1: delivery-tail stages re-done IN-PASS after a repair moved their input

        initialFailures: initialFailures.map((f) => f.id), repaired,
        registryCorrections,   // doc-27 Item 1b: deterministic record-true overwrites applied before/after the redo
        artifactSet: {
          surfaces: [P.report].filter(existsSync).map(fileMeta),   // client-summary retired 2026-08-01 — one delivered surface
          recordUris: [...assembled.records.keys()].sort(),
          recordSources: { fromRunDir: assembled.fromRunDir, fromLedgerThisSession: assembled.fromLedger },
          recordFetchFailures: [...recordFetchFailures.entries()].map(([uri, cause]) => ({ uri, cause })),
          skippedStages: ctx.skippedStages ?? [],
        },
      }, null, 2) + "\n");
    } catch (e) { note(`lint receipt write failed (non-fatal): ${e.message}`); }
    // F1 + F2 — reasoning-integrity OBSERVABILITY: per-finding engagement receipts (does
    // each Composite≥3 finding cite any of its own field anchors?) + rule-shape flags (a rating decided
    // by a cutoff/blanket rule), written to an INTERNAL sidecar and surfaced on the INTERNAL report only
    // (publishReport → opts.integrityFlags). GOODHART GUARD: this is observability the reviewer reads while
    // curating, NEVER a gate — nothing retries or blocks on it (§0(a)/§6).
    try {
      const narrativeMd = existsSync(P.narrative) ? readFileSync(P.narrative, "utf8") : "";
      const reportMd = existsSync(P.report) ? readFileSync(P.report, "utf8") : "";
      const anchors = readAnchors({
        registerFindingsMd: existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "",
        matterContextMd: existsSync(P.matterContext) ? readFileSync(P.matterContext, "utf8") : "",
        variantManifestMd: existsSync(P.variantManifest) ? readFileSync(P.variantManifest, "utf8") : "",
      });
      const receipts = findEngagementReceipts(narrativeMd, anchors);
      const bland = receipts.filter((r) => !r.citesOwnAnchor);
      const ruleShape = findRuleShapeFlags(`${narrativeMd}\n${reportMd}`, { disputeTypes: (ctx.frameworkMethod?.inputs ?? []).flatMap((i) => i.values) });   // the run's own dispute types, where its framework states a method
      const reviewMd = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : "";
      // B2b — reviewer self-coherence over senior-eye-review.md (same internal sidecar/banner).
      const reviewerCoherence = findReviewerCoherenceFlags(reviewMd);

      // v5 Appendix-A reasoning tripwire net — the thin MECHANICAL catch under the recall / coverage /
      // honesty PRINCIPLES (skills/*). Same INTERNAL-observability posture as F1/F2/B2: a staff lawyer curates, it
      // never blind-redoes a surface, and each reads ONLY mechanical artifacts — never the noisy reviewer
      // verdict. (The U1 status-FORCING already happened at the verdict clamp above; here it is the
      // surface-honesty backstop + the recorded receipt.) Flag-and-deliver: a trip is surfaced, never withheld.
      const registerFindingsMd = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
      const commonLawMd = existsSync(P.commonLaw) ? readFileSync(P.commonLaw, "utf8") : "";
      const matterContextMd = existsSync(P.matterContext) ? readFileSync(P.matterContext, "utf8") : "";
      const placementMd = existsSync(P.placement) ? readFileSync(P.placement, "utf8") : "";
      let parsedFindings = null;
      try { if (existsSync(P.findings)) parsedFindings = parseFindingsJson(readFileSync(P.findings, "utf8")); }
      catch { /* malformed findings.json is already a validators.findings fail upstream — don't double-throw here */ }
      // AD-4 (instrumentation house rule) — record WHICH inputs this pass could actually read. Every
      // "" fallback above makes a missing file indistinguishable from an empty one, which is exactly how
      // the R2 evidence run's engagement total flapped 13→0 between two emissions (tripwires 9 both
      // times) with nothing saying the second pass simply could not see the narrative. A zero with
      // inputs.narrative:false is "not recorded"; a zero with inputs.narrative:true is "did not happen".
      const inputsRead = {
        narrative: existsSync(P.narrative), report: existsSync(P.report),
        review: existsSync(P.seniorEyeReview), registerFindings: existsSync(P.registerFindings),
        commonLaw: existsSync(P.commonLaw), matterContext: existsSync(P.matterContext),
        placement: existsSync(P.placement),
        findings: parsedFindings != null,
      };
      const inScopeClasses = inScopeClassList(job, ctx.profile);   // #2 — full Nice set (top-level + per-mark), incl. services
      const carriedMarks = (parsedFindings?.findings ?? []).map((f) => f.mark);
      // A3 — the frame residual (an unclosed dominant-element crowd + every deferred frame directive) joins
      // the coverage gaps fed to the status-honesty signal, so the delivered headline cannot read clean while
      // the dominant-element crowd is unfinished (and the caption is promoted to disclose it, below).
      let frameReopenReceipt = null;
      try { const rp = driverDir(run.runDir, "frame-reopen.json"); frameReopenReceipt = existsSync(rp) ? JSON.parse(readFileSync(rp, "utf8")) : null; } catch { /* best-effort */ }
      // copper-lattice net #3 — the cross-check tripwire's substrate (only-if-present)
      let xcheckReceipt = null;
      try { const xp = driverDir(run.runDir, "register-xcheck.json"); xcheckReceipt = existsSync(xp) ? JSON.parse(readFileSync(xp, "utf8")) : null; } catch { /* best-effort */ }
      const carriedOwners = (parsedFindings?.findings ?? []).flatMap((f) => [f?.owner, f?.owner_name, f?.owner?.name]).filter((x) => typeof x === "string" && x);
      const executedQids = (ctx.planExecution?.executed ?? []).map((x) => x.qid);
      const regLedgerRows = loadCoverageLedger(run.runDir).rows;
      // judgment-relocation (2026-06-23): the search-shape gate (findFloorShapeGaps) was DELETED here too —
      // sufficiency is judgment's call (coverage_judgment), not a re-parse of the ledger at the surface. This
      // status-honesty tripwire stays an INTERNAL observability backstop over the genuine ledger gaps
      // (deferred / coverage-limited rows) + the structural frame residual + an unsearched in-scope jurisdiction
      // — it never clamps the verdict (the verdict clamp above is retired); it only flags the reviewer.
      const materialGaps = deriveCoverageStatus([
        ...regLedgerRows,
        ...(commonLawMd ? findCoverageLimitedCells(commonLawMd).map((c) => ({ axis: "common-law", status: "coverage-limited", unit: `${c.variant} × ${c.platform}` })) : []),
      ]).materialGaps.concat(frameResidualGaps(frameReopenReceipt))
        // Round 2 Change 1d — an in-scope jurisdiction the run never searched is a recall gap: it joins the
        // status-honesty signal + the disclosed caption (escalate + disclose, never withhold), like the frame residual.
        .concat((ctx.jurisdictionScope?.underCoverage ?? []).map((j) => ({ unit: `in-scope jurisdiction unsearched: ${j}`, status: "frame-gap", reason: "an instructed / effective-in-scope territory was not searched this run" })))
        // M6 — A DECLARED ABSENCE IS A MATERIAL GAP, and it has to be added HERE because it is
        // invisible everywhere else: the form carries no rows, so `deriveCoverageStatus` above returns
        // `{complete: true}` over it and the status-honesty surface would see a run with nothing
        // outstanding. The declaration reads correctly to the lawyer and says nothing to the machine
        // unless this line exists.
        .concat(coverageAbsenceGaps(readCoverageForm(run.runDir, coverageFormStamp(run.runDir).formName).parsed));
      const tripwires = {
        recallFloor: findRecallFloorViolations(registerFindingsMd, { carriedMarks, searchedNames, inScopeClasses }),   // S1
        reviewFreshness: findReviewFreshnessViolation(reviewMd, { upstreamTexts: [registerFindingsMd, commonLawMd, placementMd] }), // U2
        seedNeutrality: findSeedNeutralityViolations([{ name: "matter-context", text: matterContextMd }, { name: "placements", text: placementMd }]), // S2
        probativeGrading: parsedFindings ? findProbativeGradingViolations(parsedFindings) : [],   // U3
        // The matrix-ceiling tripwire is retired: a framework that states a table now holds each rating to it (framework-method.mjs).
        // U1 (surface backstop). The scan surface NARROWS to report.md on 2026-08-01: client-summary.md
        // was the second half of this concat and no longer exists. The report is the one delivered
        // document, so nothing a reader sees escapes the check — it just has one surface to read now.
        statusHonesty: findStatusHonestyViolation(materialGaps, reportMd),
        // #6/#7/#8 grading tripwires (non-blocking, escalate-and-disclose): a near-term client deadline that
        // must surface as an ACTION; a placement disagreement the digest left unresolved; a register finding
        // with no grounding record (orphan). All read STRUCTURED artifacts (findings.json / the digest table).
        deadlineUrgency: parsedFindings ? findDeadlineUrgencyMiss(parsedFindings, { nowMs: Date.now() }) : [],   // #6
        unresolvedDisagreements: findUnresolvedDisagreements(registerFindingsMd),   // #7
        orphanFindings: parsedFindings ? findOrphanVerificationFlags(parsedFindings) : [],   // #8
        // copper-lattice net #3 — a same-field in-use common-law hit demoted without an executed
        // register cross-check receipt (S1 sibling; receipt-gated ⇒ replay-pure).
        crosscheckMissing: findUncrossCheckedDemotions(commonLawMd ? findSimilarListingSignals(commonLawMd) : [],
          { carriedOwners, carriedMarks, xcheckReceipt, executedQids }),
        // PR-4 — document-growth trips off the append-only spine (the stage choke point logs them; both
        // the lint-repair and corrective loops are covered because the trip keys on TRIGGER). Internal
        // observability like every tripwire: the reviewer sees which repair pass ADDED material.
        documentGrowth: documentGrowth(run.runDir)?.trips ?? [],
      };
      const tripFlags = [
        ...tripwires.recallFloor.map((v) => `recall-floor: ${v.why}`),
        ...tripwires.crosscheckMissing.map((v) => `crosscheck-missing: ${v.why.replace(/^crosscheck-missing:\s*/, "")}`),
        // doc-35 T4: review-freshness (U2) grades the engine's own QC RITUAL ("the review re-read its own
        // inputs"), a process metric not a matter fact — dropped from the reviewer surface.
        ...tripwires.seedNeutrality.map((v) => `seed-neutrality: ${v.where} carries ${v.why}`),
        ...tripwires.probativeGrading.map((v) => `probative-grading: ${v.why}`),
        ...(tripwires.statusHonesty && !tripwires.statusHonesty.pass ? [`status-honesty: ${tripwires.statusHonesty.detail}`] : []),
        ...tripwires.deadlineUrgency.map((v) => `deadline-urgency: ${v.why}`),
        ...tripwires.unresolvedDisagreements.map((v) => `disagreement-unresolved: ${v.why}`),
        ...tripwires.orphanFindings.map((v) => `orphan-finding: ${v.why}`),
        ...tripwires.documentGrowth.map((t) => `document-growth: ${t.stage} grew ${t.growthPct}% (${t.before} → ${t.after} bytes) under trigger "${t.trigger}" — a repair defends or corrects, it does not add; review what the pass appended`),
      ];

      writeFileSync(driverDir(run.runDir, "reasoning-integrity.json"), JSON.stringify({
        ts: new Date().toISOString(),
        inputs: inputsRead,   // AD-4: which substrates this pass could read — a 0 below is only a 0 when its input was true
        engagement: { total: receipts.length, blandCount: bland.length, bland: bland.map((r) => r.finding), receipts },
        ruleShape, reviewerCoherence, tripwires, tripFlags,
        registryCorrections,   // doc-27 Item 1b: surfaced on the INTERNAL banner so the reviewer sees what code fixed from the record
      }, null, 2) + "\n");
      // AD-4: the run.jsonl event is UNCONDITIONAL (it used to fire only when something flagged, so a
      // clean pass and a never-ran pass looked identical to a run.jsonl reader) and carries the
      // inputs-read map, so the 13→0 flap shape self-explains on the row that shows the 0.
      runLog(run.runDir, { event: "reasoning-integrity", ok: true, bland: bland.length, total: receipts.length, ruleShape: ruleShape.length, reviewerCoherence: reviewerCoherence.length, tripwires: tripFlags.length, inputs: inputsRead });
      if (bland.length || ruleShape.length || reviewerCoherence.length || tripFlags.length) {
        note(`reasoning-integrity (observability, non-blocking — for the reviewer to eyeball): ${bland.length}/${receipts.length} finding(s) cite no field anchor; ${ruleShape.length} rule-shape; ${reviewerCoherence.length} reviewer-coherence; ${tripFlags.length} v5 tripwire(s)${tripFlags.length ? ` — ${tripFlags.map((f) => f.split(":")[0]).join(", ")}` : ""}.`);
      }
    } catch (e) {
      // AD-4: a failed integrity pass is a recorded fact, not a stderr aside — the old note-only catch is
      // exactly the "not recorded reads as clean" shape this package retires.
      try { runLog(run.runDir, { event: "reasoning-integrity", ok: false, error: String(e?.message ?? e).slice(0, 160) }); } catch { /* best-effort */ }
      note(`reasoning-integrity (non-fatal): ${e.message}`);
    }
    // Surviving failures + any unclosed envelope gap ride the report front-matter as code-built flags —
    // rendered as the banner at the top of the email and the report page. Single-line, length-capped.
    const flags = flagLines(lint.failures);
    const fmFields = {};
    // A1 (residual leak closed): lint_flags must NOT ride report.md front-matter — report.md is copied
    // verbatim into the client-reachable pool dir (publish/index.mjs copyRO), so a front-matter lint
    // flag is a latent client leak even though the rendered client HTML strips it. The flags live ONLY
    // in the internal _driver/predelivery-lint.json sink (written just above); publishReport reads that
    // sink and surfaces them on the INTERNAL report render alone (opts.lintFlags), never the client one.
    // B5b checkpoint 4: a customer named after the narrative existed binds as a DELIVERY NOTE, never silently.
    await checkLateBind("pre-delivery");
    if (ctx.lateBindNote) fmFields.late_bind_note = ctx.lateBindNote;
    // V4-4: surviving coverage gaps ship as the attempted-and-unreachable note with the priced offer.
    if (ctx.coverageNote) fmFields.coverage_note = ctx.coverageNote.slice(0, 600);
    // T4 (H1/H2): the screen_gate_note / frame_reopen_note / machine_ledger_note front-matter
    // injections are DEAD — their only renderer was the retired review bar, and their SUBSTANCE
    // already reaches the reader honestly: the verdict clamp reasons (hero bound line + email
    // conditions row) carry the screen-gate and frame residues, injectDeferralCoverage puts the
    // unclosed directives in the coverage rows, and the machine-ledger degrade rides status.json /
    // the run log / the audit workbook's Review-receipts sheet.
    // Doc-17 C-2: open floors at delivery = deferred rows ∪ surviving ⭐-floor breaches (the label
    // never demotes floor work). Stated with the mechanical cause, never silently shipped.
    const ledgerLoadFinal = loadCoverageLedger(run.runDir);   // WS-A: third gate consumer — same source as the other two
    let ledgerFinal = ledgerLoadFinal.rows;
    // T3 (H3, the owner-refined line): the machine-ledger DEGRADE is
    // sanctioned only while the gates could actually READ coverage — the prose table is the source
    // of truth and its rows kept every gate functioning. A run whose coverage-honesty floor had
    // ZERO usable rows (machine mirror unavailable AND the prose parse yielded nothing) has no
    // functioning coverage receipts at all — it FAILS instead of stamping a verdict over unread
    // coverage (the retired D1 clamp used to ship this as a finished-looking CONDITIONAL).
    // THE FORM BOTH LEDGERS ARE RENDERED FROM, BEFORE THE RUN IS ENDED FOR WANT OF EITHER. The machine ledger
    // and the prose table are renders of the driver's coverage form, whose statuses the write-up recorded. With both
    // renders unreadable, the form's ruled rows still let the coverage-honesty floor run, through the same relabels,
    // so the run is not ended with no report over a render it lost. With no ruled row there either, see below.
    if (ctx.machineLedgerNote && ledgerLoadFinal.source !== "machine" && ledgerFinal.length === 0 && existsSync(P.registerFindings)) {
      const formRows = formLedgerRows(readCoverageForm(run.runDir).rows ?? []);
      if (formRows.length) {
        ledgerFinal = relabelCoverageRows(run.runDir, formRows);
        runLog(run.runDir, { event: "coverage-ledger-from-form", rows: ledgerFinal.length, note: abbrev(String(ctx.machineLedgerNote), 200) });
        note(`coverage ledger: the machine ledger and the prose table are unreadable — the coverage floor reads the coverage form's ${formRows.length} ruled row(s)`);
      } else
        // With no ruled row anywhere, no verdict can ship over coverage nobody read (spec-49 T3), and the run is not
        // ended for it either: the failure is the assessment's, recorded as not completed and delivered without it.
        throw Object.assign(new StageFailure("coverage-ledger", `no readable coverage ledger — ${abbrev(String(ctx.machineLedgerNote), 200)}; the prose table yielded zero rows${ledgerLoadFinal.dropped?.length ? ` (${ledgerLoadFinal.dropped.length} unclassifiable)` : ""} — the coverage-honesty floor cannot run, so no verdict can ship`), { notCompletedPart: "assessment" });
    }
    // — the designation comes from the VALIDATED model, not the rendered manifest. `manifestFinal`
    // is gone from this call: it was the retired mechanism's text-scanning input and reading it here
    // again would be the token matching that made the original impossible to carry forward.
    const openFloors = computeOpenFloors(ledgerFinal, readFloorAxes(P));
    if (openFloors.length) {
      fmFields.envelope_note = ctx.envelopeNote
        ?? `floor work still open at delivery: ${openFloors.join("; ")} — still recorded open after the in-loop close attempt (see envelope events in the run log)`;
    }
    // WS-A machine-ledger degrade: the receipt stays on the AUDIT lane (status.json via writeRunStatus,
    // the run log, and the workbook's Review-receipts sheet) — no longer a report front-matter caveat.
    // Disk backstop: a quarantined .invalid.json with no live note (crash-resume edge) still records.
    if (!ctx.machineLedgerNote && ledgerLoadFinal.source !== "machine"
        && existsSync(P.registerCoverageLedger.replace(/\.json$/, ".invalid.json"))) {
      ctx.machineLedgerNote = "machine coverage ledger was quarantined earlier in this run (register-coverage-ledger.invalid.json) — coverage gates read the prose table";
      writeRunStatus(ctx, { machineLedgerNote: ctx.machineLedgerNote });
    }
    if (Object.keys(fmFields).length) {
      injectFrontMatter(P.report, fmFields, run.runDir);
      runLog(run.runDir, { event: "delivery-flags", lint: flags.length, envelope: Boolean(fmFields.envelope_note), machineLedger: Boolean(ctx.machineLedgerNote) });
    }
    note(`pre-delivery lint: ${lint.checks.length} checks, ${lint.failures.length} failing${repaired.length ? ` (repaired: ${repaired.join(", ")})` : ""}${fmFields.envelope_note ? " + envelope gap stated" : ""}`);
  }

  // item 10 — the band declarations this run made, recorded once against the SETTLED findings (after
  // every deterministic mutator has run, so the ordinals are the delivered ones). Same shape and same
  // discipline as the placement-borderline row: COUNT AND MARKS ONLY — the two readings live in the
  // finding's own prose, and a declaration has no more business in a log row than in the report. Silent
  // when nothing is declared, and on every archived / pre-field run. Its first reader is the round's own
  // revert criterion: "a record the framework decides clearly" only means something once the records it
  // does NOT decide are marked as such. Best-effort — observability never blocks a delivery.
  try {
    const settled = parseFindingsJsonLenient(readFileSync(P.findings, "utf8")).findings ?? [];
    const declared = bandBorderlineDeclarations(settled);
    if (declared.length)
      runLog(run.runDir, {
        event: "band-borderline", count: declared.length,
        marks: declared.slice(0, 8).map((f) => f.mark),
        between: [...new Set(declared.map((f) => f.borderline_between.join("|")))].slice(0, 8),
      });
  } catch { /* absent or malformed — the core-artifact gate immediately below is what owns that */ }

  // doc-44 Fix C — machine-file DELIVERY gate (mechanism + a pluggable core-artifact seam). A top-level-invalid
  // CORE machine artifact must NOT ship: it is repaired UPSTREAM (the synthesis quarantine + the corrective
  // must() re-synthesis already fail a top-level-invalid findings.json), and THIS is the final backstop before
  // publish so nothing invalid slips through a post-synthesis mutation. Never quarantine-and-ship: a broken
  // findings.json is restored from the last save that passed (restoreTheRecordThatPassed), and with none to restore
  // the failure is the assessment not completed. We validate with the LENIENT parser so a legitimate PER-FINDING quarantine
  // (one bad finding dropped, the rest shipped) still passes — THAT (whether a dropped finding is a core failure)
  // is a POLICY call the definition-of-done (spec 45) owns, not this gate. The CORE_ARTIFACTS list is the SEAM:
  // spec 45 owns its contents; it is seeded with the machine findings file doc-44 names. This enforces machine-
  // file INTEGRITY only — it does NOT set the completed/conditional/failed verdict rule (spec 45 owns that).
  const CORE_ARTIFACTS = [
    { name: "findings.json", path: P.findings, validate: (raw) => { parseFindingsJsonLenient(raw); } },   // ← spec 45 owns this list
  ];
  const coreInvalid = [];
  for (const art of CORE_ARTIFACTS) {
    if (!existsSync(art.path)) continue;   // absent ≠ invalid (a degraded/legacy run legitimately has no machine file)
    try { art.validate(readFileSync(art.path, "utf8")); }
    catch (e) { coreInvalid.push(`${art.name} — ${String(e.message).replace(/\s+/g, " ").slice(0, 140)}`); }
  }
  if (coreInvalid.length) {
    runLog(run.runDir, { event: "core-artifact-invalid", failures: coreInvalid });
    // The record, broken after the delivery checks first read it, is restored as it is there (restoreTheBrokenRecord),
    // and what was built from it is judged again against the record that stands: the freshness check below parks a
    // stage it left stale, and the resumed pass rebuilds it.
    const failure = new StageFailure("core-artifact-gate", `a core machine artifact is invalid and cannot ship: ${coreInvalid.join("; ")}`);
    if (!coreInvalid.every((f) => f.startsWith("findings.json "))) throw failure;   // only the findings record is the assessment's
    if (!(await restoreTheBrokenRecord(coreInvalid, "delivery-gate"))) throw Object.assign(failure, { notCompletedPart: "assessment" });
    runState.staleStages = runState.staleOnTheDeliveryPath();
  }

  // P2 clause 3 — FRESHNESS PRECONDITION, immediately before the client gate. copper-vault's gate
  // passed a byte-identical client summary an hour after rejecting it, because its OTHER input moved
  // underneath a frozen deliverable. A gate whose subject can change without the deliverable changing
  // is not a gate — so nothing is asked of the gate until every stage on the delivery path is fresh
  // with respect to its declared inputs. Deterministic; same failure shape as the other delivery gates.
  if (runState.staleStages.length) {
    const detail = runState.staleStages.map((s2) => `${s2.label} (${s2.changed.map((c) => c.name).join(", ")})`).join("; ");
    runLog(run.runDir, { event: "delivery-stale-blocked", stages: runState.staleStages });
    note(`delivery: ${runState.staleStages.length} stage(s) on the delivery path are stale w.r.t. their inputs — ${detail}`);
    // item 15b — WRITE DOWN WHAT IS STALE, so the recovery has something to aim at.
    //
    // A `stale` failClass parks and the resume re-enters the pipeline from the top. That is correct and
    // safe, and it is also the whole 34% recovery phase: the run walks every stage to discover, one skip
    // at a time, what this pass already knew by name. The set is recorded here — in dependency order, so
    // the reader and the repair agree about what has to happen first — and `repairStale()` below runs
    // exactly it. Best-effort: the sidecar is an accelerator, never the authority. Absent or unreadable,
    // the ordinary resume does what it has always done.
    try {
      const dir = driverDir(run.runDir);
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, "delivery-stale.json.tmp");
      writeFileSync(tmp, JSON.stringify({
        ts: new Date().toISOString(),
        labels: dependencyOrder(runState.staleStages.map((s2) => s2.label), P, { axes: ctx.axes }),
        changed: Object.fromEntries(runState.staleStages.map((s2) => [s2.label, (s2.changed ?? []).map((c) => c.name)])),
      }, null, 2));
      renameSync(tmp, join(dir, "delivery-stale.json"));
    } catch { /* accelerator only — the resume stands without it */ }
    // failClass "stale": the remedy is a DETERMINISTIC recompute of the stale stage(s) (a resume recomputes
    // them — the stamps were left stale for exactly this, see reconcileStamps' exclude), so this must not be
    // starved by the shared one-park "unknown" budget. The repeat-signature backstop still caps it.
    // THE REPEAT IS GIVEN ONE MORE ASSEMBLY, NOT THE STOP NOTICE. A first staleness parks and the resume repairs
    // it, as always. Where the repeat would end the run, the check is named as its own part: the run parks once more,
    // and the resumed pass repairs and checks again from the material as it then stands. Still stale then, it ends as
    // it always did; this check never delivers past staleness.
    throw Object.assign(new StageFailure("delivery", `the report was assembled from material that has since changed: ${detail} — re-run needed (nothing published)`, undefined, { failClass: "stale" }), { notCompletedPart: "delivery" });
  }

  // The changed-material check passed: a record the last pass left for it is answered.
  if (readPartNotCompleted(run.runDir, "delivery")) {
    clearPartNotCompleted(run.runDir, "delivery");
    runLog(run.runDir, { event: "part-completed", part: "delivery" });
  }

  // ONE report (spec 2026-07-30 §5) — the client gate's preflight is gone with the readiness state it
  // chose. publishReport still runs the evaluateClientGate machine checks (they are real: arithmetic,
  // record fidelity, stale corrections) but their result lands on the AUDIT WORKBOOK + meta.json + the
  // machine-qc-failed telemetry event below — it decides nothing about who may read, and there is no
  // client export to withhold. A defect that changes the LEGAL ANSWER is the verdict clamp's job and
  // rides the report as a fact about the mark (a CONDITIONAL/BLOCKING verdict), never as a warning
  // about the document.
  // B — publish: DETERMINISTIC CODE → cannot hang. The durable deliverable: the report ships even if the audit
  // failed above (publishReport renders report.html regardless; the xlsx is best-effort inside it).
  return await publishAndDeliver(runState.verdict);
}
