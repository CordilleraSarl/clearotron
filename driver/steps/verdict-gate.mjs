// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/verdict-gate.mjs — the verdict's floors and terminal guards, and the label and sidecar they write.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { paths } from "../run-record.mjs";
import { runRecordLogPath } from "../../providers/_shared/ledger-path.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { decideRegisterGap } from "../coverage-ledger.mjs";
import { plainDirective } from "../deferral-row.mjs";
import { UNREACHABLE_SENIOR_POLICY } from "../driver.config.mjs";
import { deriveActionConditions, deriveDisplayVerdict, parseFindingsJsonLenient, quarantinedConditionRows, riskStatement, verdictStance } from "../findings-model.mjs";
import { floorDutyArmed, floorDutyBlock, floorDutyClosed } from "../floor-duty.mjs";
import { note, runLog } from "../log.mjs";
import { signoffPatch, writeRunStatus } from "../progress.mjs";
import { readActiveTaintAxes } from "../register-taint.mjs";
import { assembleRunRecords } from "../registry-fidelity.mjs";
import { postRepairRecordPath } from "../repair-scope.mjs";
import { createRepairLedger } from "../repairs.mjs";
import { isRegisterOnly } from "../search-policy.mjs";
import { rankClusterLegs, verdictDrivingFindings } from "../senior-rights.mjs";
import { lines } from "../stages.mjs";
import { synthesisDutyForRun } from "../synthesis-record.mjs";
import { clauseForDefect, gapPositivelyClosed, jointUnaccounted, orderClausesForLede, terminalClampDecision, verdictWhenTheStepsAreWithdrawn, verdictWithConditionsStanding, verdictWithoutTheClosedGap } from "../terminal-clamp.mjs";
import { countCitedDefects, parseCorrections, parseVerdict } from "../verify.mjs";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export async function runVerdictGate({ P, agent, applyVerdictFrontMatter, correctiveCycleSettled, correctiveEntryVerdict, correctiveRecheckOk, coverageJudgment, ctx, opts, run, runState }, helpers) {
  const { StageFailure, actionsRegisterListed, conditionsFollowingTheRecord, defaultRecordFetcher, enrichFindingDeadlines, lateRecordsUnaddressed, loadCoverageLedger, loadScreenGateUnresolved, owedUrisFor, planAuditExtra, refusedRecordsLeftOut, registerGapConditions, safeReadJson, saveWithRetries, stage, withdrawByToken } = helpers;
  // U1 — coverage-honesty floor (Appendix A tripwire #2). The reviewer verdict is empirically noisy
  // (it flips on byte-identical input), so the honest-status signal is derived from the coverage
  // LEDGER alone, never from the verdict. A run can be only as CLEAR as the layers it actually ran:
  // if a layer MATERIAL to this matter is coverage-limited / deferred (saturation-probe excluded by
  // contract — count-only ⇒ limited by definition), the run cannot ship CLEAR. We only ever RAISE
  // CLEAR→CONDITIONAL — never lower, never manufacture BLOCKING — and we do it AFTER the reviewer's
  // corrective ladder has settled, so it forces an honest delivered status without firing an empty
  // corrective re-synthesis (the gap is a search-execution reality, not a narrative the model can fix).
  // This is the deterministic backstop under the reviewer's LLM-level coverage-overclaim rule.
  // judgment-relocation (revised 2026-06-24): the deliver-conditional verdict floor. The funnel's old
  // search-shape coverage-honesty clamp (findFloorShapeGaps, deleted) is gone — sufficiency is the lawyer's
  // call, not a re-parse of the prose ledger. Three honest, NON-WITHHOLDING reasons can clamp a clean run
  // CLEAR→CONDITIONAL (deliver the report, carry the gap in the status — never command a re-loop, never halt):
  //   • coverageInsufficient — the lawyer (synthesis coverage_judgment.sufficient:false) judged a MATERIAL
  //     register slice not fully cleared. This is the deliver-conditional realisation of "command or halt":
  //     we neither re-search nor stop — we ship a CONDITIONAL with the lawyer's reason. Safe because the
  //     dangerous named band was enumerated to completeness (fan-in band gate); the conditional covers a
  //     genuine residual, not a hidden miss.
  //   • frameResidual — a STRUCTURAL omission the blind frame-diff found and the reopen could not close.
  //   • screenGateGap — an in-scope-live mark whose record could not be retrieved (could-not-examine).
  // A GENUINE open judgment (the search IS complete; the legal/commercial call is genuinely arguable) is NOT a
  // clamp — it ships as reasoning in the report (the lawyer's product), never as a status caveat.
  // ── WP-receipts W3 — the senior-right closure ("verify the right that matters", senior lawyer 2026-07-05).
  // For the handful of findings that DRIVE the delivered verdict, the verified basis must be the
  // cluster's SENIOR live right, never an arbitrary leg (VENZY: the report read "verified" off the
  // junior AE 2015 leg while the senior TR 2009 registration was never pulled). Seniority is ranked
  // in CODE from artifacts the run already holds (fetched records → register-index screen facts);
  // when the senior leg is absent from the record set, ONE targeted driver fetch closes it — the
  // same code-fetch seam as the screen-gate/V4-2 closures. Zero new provider calls to IDENTIFY the
  // senior leg; worst case one redirect-fetch per verdict-driving finding, steady-state zero once
  // the digest prompt redirect lands the senior leg first. Single-leg clusters are trivially
  // satisfied (their one fetched leg IS the senior right) — the guarantee targets multi-leg owners.
  ctx.seniorRights = null;
  // D1 fail-closed — record whether the live arm below OWES the receipt: the arming condition
  // (frozen framework + v4 findings) is flagged the moment it is established, so a closure that
  // throws AFTER arming still surfaces in predelivery-lint as expected-but-absent (before D1 a
  // crashed closure left no rows and the lint's presence-gated check silently passed). The
  // replay harness never sets the flag — archived runs never grow the failure.
  ctx.seniorRightsExpected = false;
  if (ctx.framework) {
    try {
      const srDoc = existsSync(P.findings) ? parseFindingsJsonLenient(readFileSync(P.findings, "utf8")) : null;
      if (srDoc && (srDoc.schemaVersion ?? 1) >= 4 && srDoc.findings?.length) {
        ctx.seniorRightsExpected = true;
        const driving = verdictDrivingFindings(srDoc.findings, ctx.framework);
        const indexByUri = new Map();
        try {
          const band = JSON.parse(readFileSync(P.registerNamedBand, "utf8"));
          for (const r of band?.enumerated ?? []) {
            const uri = String(r?.record_id ?? "").toLowerCase();
            if (uri) indexByUri.set(uri, { applicationDate: r?.screen?.applicationDate, registrationDate: r?.screen?.registrationDate,
              status: r?.screen?.status ?? r?.status, live_status: r?.screen?.live_status });
          }
        } catch { /* no merged band (legacy run) — fetched-record facts alone rank */ }
        const srPrefix = `clearance-${run.slug}-${run.codename}-`;
        let srRecords = assembleRunRecords(run.runDir, srPrefix).records;
        const srFetcher = opts.recordFetcher ?? defaultRecordFetcher;
        const srLedger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(run.runDir, { log: (o) => runLog(run.runDir, o) }));
        const rows = [];
        for (const f of driving) {
          const regs = f?.owner?.registrations ?? [];
          if (regs.length < 2) { rows.push({ ordinal: f.ordinal, mark: f.mark, applicable: false, reason: regs.length ? "single leg — seniority trivial" : "no register legs (use/marketplace evidence path)" }); continue; }
          const { senior, unrankable, excluded } = rankClusterLegs(regs, indexByUri, srRecords);
          if (!senior) { rows.push({ ordinal: f.ordinal, mark: f.mark, applicable: true, seniorUri: null, verified: false, unrankable, excludedDead: excluded.length }); continue; }
          let verified = srRecords.has(senior.uri);
          let fetchFailureCause = null;
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
          // second statement of the same rule, and two ends stating the same rule is how they drift apart.
          const seniorFetchMax = 1;
          if (!verified && srLedger.canAttempt("senior-right-fetch", senior.uri, { max: seniorFetchMax })) {
            note(`senior-right closure: fetching the SENIOR leg ${senior.uri} for "${f.mark}" (the verified basis must be the senior right, never an arbitrary leg)`);
            let outcome = "failed";
            try {
              const rf = await srFetcher(senior.uri, { agentId: agent, sessionKey: `${srPrefix}senior-right`, recordLog: runRecordLogPath(run.runDir) });
              outcome = rf?.ok ? "ok" : `failed: ${String(rf?.cause ?? "unknown").slice(0, 140)}`;
              if (!rf?.ok) fetchFailureCause = String(rf?.cause ?? "unreachable").slice(0, 200);
            } catch (err) { outcome = `threw: ${String(err?.message ?? err).slice(0, 140)}`; fetchFailureCause = String(err?.message ?? err).slice(0, 200); }
            srLedger.record("senior-right-fetch", senior.uri, outcome, { max: seniorFetchMax });
            srRecords = assembleRunRecords(run.runDir, srPrefix).records;
            verified = srRecords.has(senior.uri);
          } else if (!verified) {
            fetchFailureCause = "fetch budget exhausted on a prior attempt";
          }
          rows.push({ ordinal: f.ordinal, mark: f.mark, applicable: true, seniorUri: senior.uri, rankedFrom: senior.source, verified, ...(fetchFailureCause ? { fetchFailureCause } : {}), excludedDead: excluded.length });
        }
        ctx.seniorRights = { schema_version: 1, policy: UNREACHABLE_SENIOR_POLICY, rows };
        writeFileSync(paths(run.runDir).seniorRights, JSON.stringify(ctx.seniorRights, null, 2) + "\n");
        runLog(run.runDir, { event: "senior-rights", driving: driving.length, applicable: rows.filter((r) => r.applicable).length,
          verified: rows.filter((r) => r.verified).length, open: rows.filter((r) => r.applicable && !r.verified).length });
      }
    } catch (e) {
      note(`senior-right closure skipped (${String(e?.message ?? e).slice(0, 100)}) — the render/lint surfaces stay code-owned either way`);
    }
  }

  // The register's own opposition windows reach the findings BEFORE any deadline judgment (the bands
  // are settled by now; the corrective ladder above re-emitted findings last).
  enrichFindingDeadlines(P, run.runDir, note);

  // ── P2-A pre-verdict floor: the reconciliation's hard discrepancy list ─────────────────────────
  // screened-live dominant-element candidates ∖ endings is read here as it always was, and it no longer THROWS:
  // the owner's ruling of 2026-10-19 that a run is never held replaces the Round-2 rule that this one class never
  // ships. The run first recovers what it can in-run (the digest seam's followups; placement assessing late
  // evidence before the writer); whatever is still unended ships NAMED, through the terminal guards' deliver-and-clamp
  // (`clampOnTheRecallGate`, beside the floor duty's clamp below), never as a run that delivers nothing.

  // ── — THE TERMINAL GUARDS DELIVER AND CLAMP; THEY DO NOT WITHHOLD ───────────
  //
  // Ruling, 2026-08-27, verbatim intent: **reports always ship**. When a terminal guard finds
  // the report incomplete at delivery, the engine sends it with the gap patched conservatively and
  // the defect named in the run record. It never withholds.
  //
  // The two checks below USED TO THROW. Both were right about the defect and wrong about the remedy:
  // a guard that stops a report marks where a fix is missing, it is not itself the fix. The cost was
  // measured rather than argued — a live clearance run died at delivery after 5.55 hours because the
  // floor duty found ONE undischarged record, and the client received nothing at all instead of a
  // report naming one gap.
  //
  // NOTHING NEW IS BUILT HERE. `clampReasons`/`clampClauses`/`clampKinds` and the CLEAR→CONDITIONAL
  // clamp already run twenty lines below this point for the coverage floor; these declarations simply
  // move ABOVE the two checks so both can reach them. The conversion is a routing change.
  runState.clampReasons = [];                                       // A2/D1 — persisted below
  let clampClauses = [];
  let clampKinds = {};
  // — which clause texts came from a TERMINAL GUARD. The lede question: a guard's
  // disclosure must not silently outrank the opinion's own condition clauses just because the guards
  // run earlier in this function. The sidecar write sorts guard clauses AFTER the opinion's, stated
  // there; this set is how it tells them apart without a parallel index to keep aligned.
  const guardClauses = new Set();
  // THE ACCEPTED ASSESSMENT: the result the review reached, before any guard or floor clamped it. It moves with the
  // review alone (the degenerate re-ask, a late review that is harsher), and a gap a guard judged again finds closed is
  // withdrawn against it (ruled 2026-10-19).
  runState.assessed = runState.verdict;
  runState.restoredClear = false;   // a closed gap took this run back to CLEAR, so a later writer's judgment meets the floor again
  // THE REASONS THE RECORD'S OWN ACTIONS PUT IN THE LIST, by the floor's legal-actions arm, so the list can follow the
  // record when a repair in the delivery check rewrites, withdraws or adds a step (conditionsFollowingTheRecord).
  let recordConditionReasons = new Set();
  // WHAT A WITHDRAWAL OF THOSE STEPS NEEDS TO GIVE THE REVIEW'S CLEAR BACK (verdictWhenTheStepsAreWithdrawn): that the
  // steps raised the result, that none was ever dropped as unreadable, when a readable record last held none of them,
  // and when a correction in the delivery check was last rejected.
  let stepsRaisedTheResult = false;
  let stepsUnreadable = false;
  let stepsWithdrawnAt = null;
  runState.correctionRejectedAt = null;
  const DROPPED_CONDITIONS_REASON = "a forward legal step this opinion named could not be recorded, so the conditions listed here are incomplete";

  /**
   * Deliver, clamp conservatively, and name the defect in the run record.
   *
   * CONSERVATIVE means one direction only: CLEAR becomes CONDITIONAL. A verdict already at
   * CONDITIONAL or BLOCKING is never relaxed — a clamp may add caution and may never remove it.
   *
   * The defect goes to the RUN RECORD (`runLog`) as well as the reader-facing note, because the R2
   * scorer keys on the run record and this is what preserves its reads: what used to be a terminal
   * failure event is now a delivered-with-defect event, and both are visible to the same consumer.
   */
  // THE DECISION IS `terminalClampDecision`, CALLED NOT COPIED — it lives in terminal-clamp.mjs so
  // the arms can drive it, for the reason floor-duty.mjs states about its own predicate: inline, it
  // could only be pinned by source text, and a source-text pin cannot tell an armed check from one
  // somebody disarmed while leaving its words in place. This closure is the wiring: run record, note,
  // clamp lists, status. The judgement is all in the module.
  const deliverAndClamp = ({ event, defect, reason, clause, detail = {}, again = false, statedElsewhere = false }) => {
    // A GUARD JUDGED AGAIN in this run says nothing new when its judgment is unchanged, and otherwise replaces its
    // earlier clause of the same kind, so a record is never counted twice and no count stands from an earlier pass.
    if (again && runState.clampReasons.includes(String(reason ?? "").trim())) return;
    if (again) replaceClauses(String(defect ?? "").split(":")[0]);
    // — reason and clause are SEPARATE inputs now: the run record and the ops note keep
    // the token sentence; the clause list (which riskStatement renders into the client's Verdict row)
    // receives only the reader's sentence. terminalClampDecision refuses a fused clause by shape.
    const d = terminalClampDecision({ verdict: runState.verdict, defect, reason, clause, detail });
    runLog(run.runDir, { event, ...d.record });
    note(d.reason);
    // A gap stated in another entry's sentence keeps its reason for the run record, and its clause is that sentence's.
    const stored = statedElsewhere ? null : d.clause;
    if (!runState.clampReasons.includes(d.reason)) { clampClauses.push(stored); runState.clampReasons.push(d.reason); guardClauses.add(stored); }
    if (d.clamped) {
      runLog(run.runDir, { event: "terminal-guard-clamp", defect: d.record.defect, from: runState.verdict, to: d.verdict });
      runState.verdict = d.verdict;
      writeRunStatus(ctx, signoffPatch(runState.verdict));
    }
  };

  // A CLAUSE JUDGED AGAIN REPLACES THE ONE IT REPEATS. A guard judged a second time in this run, after a repeat or a
  // re-run, withdraws its earlier clause of the same kind before it states the current one, so a record is never
  // counted twice and a count never stands from an earlier judgment. Returns how many entries it withdrew.
  const replaceClauses = (token, { event = "guard-clause-replaced" } = {}) => {
    const w = withdrawByToken(runState.clampReasons, clampClauses, guardClauses, token);
    if (!w.withdrawn) return 0;
    runState.clampReasons = w.reasons;
    clampClauses = w.clauses;
    runLog(run.runDir, { event, token, withdrawn: w.withdrawn });
    return w.withdrawn;
  };

  // A GAP JUDGED AGAIN AND POSITIVELY CLOSED takes its own clause with it, and the result is recomputed from the
  // accepted assessment and the conditions still standing (ruled 2026-10-19). Only a CONDITIONAL that this run's
  // guards alone made goes back to CLEAR, and that CLEAR then meets the same deliver-conditional floor any CLEAR meets.
  // A gap whose account is absent, unreadable or not computable is not closed: its clause stands.
  const withdrawClosedGap = (token) => {
    if (!replaceClauses(token, { event: "guard-gap-closed" })) return;
    const now = verdictWithoutTheClosedGap({ verdict: runState.verdict, assessed: runState.assessed, reasons: runState.clampReasons });
    if (now === runState.verdict) return;
    runLog(run.runDir, { event: "verdict-recomputed-gap-closed", token, from: runState.verdict, to: now });
    note(`the ${token.split("_")[0]} gap this run named is closed, and nothing else conditions the result — ${runState.verdict} goes back to ${now}, the result the review reached`);
    runState.verdict = now;
    runState.restoredClear = now === "CLEAR";
    writeRunStatus(ctx, signoffPatch(runState.verdict));
    applyCoverageFloor();   // the floor any CLEAR meets: the opinion's forward actions, the coverage gaps
  };

  // THE RECALL GATE, DELIVERED AND CLAMPED (the owner's ruling of 2026-10-19: a run is never held). A retrieved record still
  // ending nowhere a reader can see after the run's recovery ships named, in the approved sentence for the same state,
  // counted in records out of the records the gate weighed. A record another clause already names (the writer's duty,
  // the floor) is left to it, so no record is counted twice. Returns the count it clamped on, or 0.
  // THE RECALL GATE'S GAP AS IT STANDS, judged and not yet clamped, so the writer's duty can be stated with it.
  const recallGapNow = (duty = null) => {
    const rec = safeReadJson(P.recallReconciliation);
    const computable = rec?.computable === true;
    // A record the writer's duty or the floor's clamp already names is left to that clause: one record, one sentence.
    // The floor's rows count only where its clamp fires, so a record is never left unnamed by both.
    const floorNames = floorDutyBlock(safeReadJson(P.floorDuty), { armed: floorDutyArmed(run.runDir) })
      ? (safeReadJson(P.floorDuty)?.rows ?? []).filter((r) => r?.disposition !== "accounted").map((r) => String(r?.record_id ?? "").toLowerCase())
      : [];
    const alreadyNamed = new Set([...(duty?.computable === true ? duty.unaccounted : []).map((u) => String(u?.uri ?? "").toLowerCase()), ...floorNames]);
    // A RECORD A REFUSED MERGE LEFT OUT IS UNREAD, and it is counted here, in the same sentence, out of a total that
    // includes it: the band could not take it without passing the size its readers can be dispatched over.
    const left = refusedRecordsLeftOut(P);
    // A RECORD NO PLACEMENT PASS READ, and that the report does not address, is counted in the same sentence: the band
    // gained it after placement's last pass, and the pass that would have assessed it did not complete.
    const late = lateRecordsUnaddressed(P, alreadyNamed);
    const unended = (computable ? rec.unended ?? [] : []).filter((u) => !(u.candidate_records ?? [u.record_id])
      .some((x) => alreadyNamed.has(String(x).toLowerCase())));
    const weighedIds = new Set(unended.flatMap((u) => u.candidate_records ?? [u.record_id]).map((x) => String(x).toLowerCase()));
    const records = [...new Set([...weighedIds, ...left, ...late])];
    // Out of the records the gate weighed or, where it could weigh none, the records the band holds; and the records
    // left out besides. A late record outside the records the gate weighed is added to the total; where the gate
    // weighed none, the band's count already holds it.
    const base = computable ? Number(rec.totals?.candidates ?? 0) : (safeReadJson(P.registerNamedBand)?.enumerated ?? []).length;
    const weighed = base + left.length + (computable ? late.filter((id) => !weighedIds.has(id)).length : 0);
    // The same population by id, where the gate kept it: what a sentence stated with the writer's duty counts once.
    const population = computable
      ? (Array.isArray(rec.candidate_ids) ? [...rec.candidate_ids, ...left, ...late] : null)
      : [...(safeReadJson(P.registerNamedBand)?.enumerated ?? []).map((r) => String(r?.record_id ?? "").toLowerCase()), ...left];
    return { rec, computable, left, late, unended, records, base, weighed, population };
  };
  // THE RECALL GATE, DELIVERED AND CLAMPED (the owner's ruling of 2026-10-19: a run is never held). A retrieved record still
  // ending nowhere a reader can see after the run's recovery ships named, in the approved sentence for the same state,
  // counted in records out of the records the gate weighed. A record another clause already names (the writer's duty,
  // the floor) is left to it, so no record is counted twice. Where the writer's duty names records too, the one sentence
  // is the duty's, stated with these (`joint`). Returns the count it clamped on, or 0.
  const clampOnTheRecallGate = (duty = null, { again = false, gap = recallGapNow(duty), joint = null } = {}) => {
    const { rec, computable, left, late, unended, records, base, weighed } = gap;
    if (!left.length && !late.length && (!computable || !((rec.totals?.unended ?? 0) > 0))) {
      if (again && gapPositivelyClosed("recall_reconciliation_unended", { recall: rec, leftOut: [...left, ...late] })) withdrawClosedGap("recall_reconciliation_unended");
      return 0;
    }
    // Every record the gate would name is named by a clause standing now: its own earlier clause goes, so the record
    // is counted once. The gap is not closed, and the result is not recomputed.
    if (again && !records.length && unended.length < (rec?.unended ?? []).length) replaceClauses("recall_reconciliation_unended", { event: "guard-clause-named-elsewhere" });
    if (!records.length || !(weighed > 0)) return 0;
    const sample = [...unended.slice(0, 4).map((u) => `${u.mark_text} (${u.record_id})`), ...left.slice(0, 2), ...late.slice(0, 2)].join("; ");
    deliverAndClamp({
      event: "recall-reconciliation-unended-delivered",
      defect: `recall_reconciliation_unended:${records.length}`,
      detail: { positions: unended.length, records: records.length, candidates: base, refused: left.length, late: late.length, ...(joint ? { stated_with_duty: joint } : {}) },
      reason: `recall_reconciliation_unended:${records.length} of ${weighed} record(s) — retrieved and screened in-scope-live on the dominant element but ending nowhere a reader can see (no finding row, no drop row, no counted crowd ruling) after the run's recovery${left.length ? `, ${left.length} of them found by a unit's re-run and left out of a band its readers could not have been dispatched over` : ""}${late.length ? `, ${late.length} of them reaching the band after placement's last pass, whose pass to assess them did not complete` : ""}: ${sample}. The report ships with these named rather than being withheld.${joint ? ` Stated with the writer's duty, once, as ${joint.n} of ${joint.m} record(s).` : ""}`,
      again,
      clause: clauseForDefect("recall_reconciliation_unended", records.length, weighed),
      statedElsewhere: Boolean(joint),
    });
    return records.length;
  };
  // ── — THE DECLINATION DUTY, CHECKED AGAINST THE DELIVERED DOCUMENT ────────────────────────
  //
  // A SECOND NET OVER ONE REACHABLE PATH, and it exists because I argued it could not fire and was
  // wrong. The acceptance boundary refuses a call that leaves a carried record with no exit, and the
  // argument was that nothing could then reach delivery unaccounted. The corrective pass is the state
  // that enumeration missed: `prepareDeclinationSpec` runs again before it over a surface that can
  // have grown, so it is ordered against a LARGER owed set; if that call is refused,
  // `rollbackCorrectivePass` restores the pre-corrective findings and — by T3b's ruling,
  // deliberately — the run DELIVERS. What ships then satisfied the OLD owed set, and no acceptance
  // boundary ever saw a call about the records added since, because the only call ordered against them
  // was the one that was refused.
  //
  // JUDGED AGAIN after the delivery check repeats placement or re-runs the writer, with `again`: a gap that remains
  // replaces its earlier clause with the current count, and a gap positively closed withdraws it (withdrawClosedGap).
  //
  // NO ERA STAMP, and it needs none: an archived run carries no declination spec, so `owed` is null,
  // the reconcile is `computable:false` and this never blocks. Archive compatibility by construction.
  const clampOnTheWritersDuty = ({ again = false } = {}) => {
    const duty = synthesisDutyForRun(run.runDir);
    // THE TWO GAPS STATED ONCE when both name records: the approved sentence, with each record counted once out of the
    // records either required to be assessed (ruled 2026-10-19). The run record keeps each gap's own counts.
    const gap = recallGapNow(duty);
    // THE DUTY IS THE ENTRY'S, AND THE READER IS TOLD ITS RECORDS: every record of each entry left unaccounted, out of
    // the records the owed entries hold (a duty with no record counts is a row per record, as before).
    const dutyIds = duty?.computable === true ? duty.unaccounted.flatMap((u) => (Array.isArray(u.uris) ? u.uris : [u.uri])) : [];
    const recordsOpen = duty?.records?.unaccounted ?? dutyIds.length;
    const recordsOwed = duty?.records?.owed ?? duty?.totals?.owed;
    const joint = duty?.computable === true && duty.unaccounted.length
      ? jointUnaccounted({ dutyIds, owedIds: owedUrisFor(run.runDir), recallIds: gap.records, weighedIds: gap.population })
      : null;
    if (duty?.computable === true && duty.unaccounted.length) {
      const sample = duty.unaccounted.slice(0, 4).map((u) => `${u.mark ? `${u.mark} ` : ""}(${u.uri})`).join("; ");
      // DELIVERS AND CLAMPS. It used to throw. The defect is real and stays
      // named — a record the run judged worth a reader's attention reached the document unaccounted —
      // but naming it to nobody was the worse outcome of the two.
      deliverAndClamp({
        event: "synthesis-duty-undischarged",
        defect: `synthesis_unaccounted_delivered:${recordsOpen}`,
        detail: { unaccounted: recordsOpen, owed: recordsOwed, uris: dutyIds.slice(0, 6) },
        reason: `synthesis_unaccounted_delivered:${recordsOpen} of ${recordsOwed} record(s) reached the findings surface and the delivered document accounts for none of them — neither a finding that names them nor a declination with a ground: ${sample}${duty.unaccounted.length > 4 ? " …" : ""}. The report ships with this named rather than being withheld; these records are open points a reader must weigh.${joint ? ` Stated with the recall gate's records, once, as ${joint.n} of ${joint.m} record(s).` : ""}`,
        again,
        // — the READER's sentence: what is open, in a lawyer's nouns. Counts survive;
        // the token, the record ids and the engine's nouns stay in `reason` and the run record.
        // COMPOSED BY THE AUTHORITY, NOT SPELLED HERE. The same sentence has to be reachable from a
        // run that stored no clause, where these two objects are long gone and only the reason's own
        // counts survive; `terminal-clamp.mjs` composes it from the counts either way, so the fresh
        // run and the republished archive cannot drift apart.
        clause: joint ? clauseForDefect("synthesis_unaccounted_delivered", joint.n, joint.m)
          : clauseForDefect("synthesis_unaccounted_delivered", recordsOpen, recordsOwed),
      });
    } else if (again && gapPositivelyClosed("synthesis_unaccounted_delivered", { duty })) withdrawClosedGap("synthesis_unaccounted_delivered");
    const recall = clampOnTheRecallGate(duty, { again, gap, joint });   // the recall gate's gap, beside the writer's duty
    return { duty, recall };
  };
  // ── — THE FLOOR DUTY, DISCLOSED AND CLAMPED AT DELIVERY (it BLOCKED until) ───
  //
  // The floors are placement-inquiry's one UNCAPPED obligation — every live in-class identical or
  // near-identical record, listed individually — and the duty has been measured and never enforced.
  // Measured on two delivered runs before it was even derived: 45 of 207 floors on one and 99 of 225
  // on the next never reached the placement form, every one a LIVE filing.
  //
  // ARMED BY THE STAMP, NOT BY THE ARTIFACT'S PRESENCE. Across the 24 run directories on the test box,
  // 19 carry no floor-duty artifact at all — and on this box "absent" means a knockout run far more
  // often than an old one, so absence cannot be read as either "clean" or "old". The stamp is written
  // only by a placement pass that actually ran under the code carrying the order.
  //
  // IT COUNTS THE SEAT'S OWN SHARE. A floor row the band gave no record id is undischarged and
  // UNANSWERABLE — no seat behaviour could have closed it, and the repair it implies can be performed
  // by nobody. Blocking on it would fail a run for a band defect under a rule about seat behaviour, so
  // it is disclosed in the message and excluded from the count that blocks. That is a stated limit,
  // not an oversight: if the unanswerable count is ever the large one, it wants its own issue against
  // the band rather than a wider floor here.
  //
  // NO REPAIR RUNG, deliberately and on a measurement (ruling relayed 2026-08-27). Every
  // registered repair composer belongs to another stage; placement has none, and building one is a
  // larger piece of work than this floor. The blast radius said it could wait: on the day this was
  // written today's run discharged all 60 of its floors, and the only two runs with undischarged rows
  // carried 5 and 9 out of 222 and 352. A rung is a follow-up, never a precondition.
  // THE FLOOR DUTY'S CLAMP, callable: applied where the terminal checks run, and again to a placement pass the
  // delivery gate repeats, whose account the report is then rebuilt from. Returns the block it clamped on, or null.
  const clampOnTheFloorDuty = ({ again = false } = {}) => {
    // THE PREDICATE IS `floorDutyBlock`, called not copied — it lives in floor-duty.mjs so the arms can
    // DRIVE it. Inline here it could only be pinned by source text, and a source-text pin cannot tell
    // an armed check from one somebody disarmed while leaving its words in place.
    const block = floorDutyBlock(safeReadJson(P.floorDuty), { armed: floorDutyArmed(run.runDir) });
    if (block) {
      // DELIVERS AND CLAMPS. This threw until a live clearance run died at
      // delivery after 5.55 hours on ONE undischarged floor row — the guard's first real catch,
      // working exactly as built, and the client received nothing instead of a report naming one gap.
      // The era stamp still gates it: `floorDutyArmed` means a placement pass ran under the code
      // carrying the order, so an archived run neither blocks nor is now accused of a defect.
      deliverAndClamp({
        event: "floor-duty-undischarged",
        defect: `floor_duty_undischarged:${block.undischarged}`,
        detail: { undischarged: block.undischarged, floors: block.floors, named_without_ground: block.named_without_ground ?? 0, unanswerable: block.unanswerable ?? 0 },
        reason: `floor_duty_undischarged:${block.undischarged} of ${block.floors} floor row(s) — every floor is a LIVE in-class identical or near-identical record and the duty is uncapped: each is placed at any tier, or named by its record id with a one-line ground. These came back neither: ${block.sample}${block.undischarged > 4 ? " …" : ""}`
          + `${block.named_without_ground ? ` (${block.named_without_ground} named with no ground)` : ""}`
          + `${block.unanswerable ? ` — a further ${block.unanswerable} floor row(s) carry no record id at all and are excluded from this count: the band gave the seat nothing to name, so those are a band defect and not this seat's to answer` : ""}`
          + `. The report ships with these named rather than being withheld.`,
        again,
        // — the READER's sentence. "Floor row" is an engine noun; what the fact IS for a
        // lawyer: live registrations identical or near-identical to the mark that the report does not
        // individually address. Counts survive; token, ids and engine nouns stay in `reason`.
        // Composed by the authority in `terminal-clamp.mjs` for the reason the sibling site above
        // gives: a republished pre-split run has to reach the same sentence from the counts alone.
        clause: clauseForDefect("floor_duty_undischarged", block.undischarged, block.floors),
      });
    } else if (again && gapPositivelyClosed("floor_duty_undischarged", { floorClosed: floorDutyClosed(safeReadJson(P.floorDuty), { armed: floorDutyArmed(run.runDir) }) }))
      withdrawClosedGap("floor_duty_undischarged");
    return block;
  };
  {
    clampOnTheWritersDuty();   // the writer's duty and, beside it, the recall gate (defined above the floor's block)

    clampOnTheFloorDuty();
  }

  // PR-3 (report voice) — the factual open-state clause per reason, INDEX-ALIGNED with clampReasons.
  // The legalActions arm pushes the author's typed `condition` clause (fact voice) where one exists;
  // the machinery arm's reasons are already factual states. riskStatement prefers these for its
  // "conditional on:" lede; verdict.json.reasons stays the ask texts every other consumer renders.
  // (All three now DECLARED ABOVE the terminal checks — — so those can clamp
  // rather than throw. Nothing about their use here changed.)
  // Extracted into a callable (repair-first A5): the degenerate-reviewer re-ask below can flip a
  // stale BLOCKING to CLEAR — that outcome must pass the SAME deliver-conditional floor, never
  // bypass it because the clamp already ran once.
  const applyCoverageFloor = () => {
  // Each entry is the floors' state, so delivery reads only a floor that threw since the last of these.
  runLog(run.runDir, { event: "verdict-floors-pass" });
  // review fix: the machinery arm below must judge the verdict AS IT ENTERED the floor —
  // when the legalActions arm clamps CLEAR→CONDITIONAL first, the machinery gaps (coverage, frame,
  // screen-gate, senior, registerGap) must still be computed and APPENDED, or a run
  // with both a condition action and an unfinished register slice would disclose only the condition.
  const entryVerdict = runState.verdict;
  // spec 64 — the legalActions arm: the opinion's OWN typed condition actions (findings.json
  // actions[], CONDITION_KINDS) are a verdict input, independent of the machinery clamps below.
  // This is the CLEAR-despite-"consent before filing" fix (copper-causeway / ashen-gantry): the
  // reviewer verdict is QC-flag semantics — once its flags are fixed the recheck legitimately
  // returns CLEAR — so the demanded legal acts must gate HERE, derived from the data the author
  // typed, never from a keyword grep over prose. Applies on CLEAR *and* CONDITIONAL (an already-
  // conditional run gets its conditions RECORDED — never again kinds:{} reasons:[] under a report
  // naming forward acts); BLOCKING stays the fail arm untouched. Never lowers. A parse failure
  // here is noted loudly and rides on (never-kill) — the predelivery verdict-actions-coherence
  // lint re-reads the same data independently and is the second net.
  try {
    if (runState.verdict === "CLEAR" || runState.verdict === "CONDITIONAL") {
      const fdoc = existsSync(P.findings) ? parseFindingsJsonLenient(readFileSync(P.findings, "utf8")) : null;
      const { conditions, conditionClauses } = deriveActionConditions(fdoc?.actions, fdoc?.findings);
      if (conditions.length) {
        const fresh = conditions.filter((c) => !runState.clampReasons.includes(c));
        clampKinds.legalActions = true;
        // pairwise push — clampClauses stays index-aligned with clampReasons across re-entries
        // (the degenerate re-ask re-runs this floor; dedup is by the reason TEXT for both).
        for (const c of fresh) clampClauses.push(conditionClauses[conditions.indexOf(c)] ?? c);
        runState.clampReasons.push(...fresh);
        for (const c of fresh) recordConditionReasons.add(c);
        if (runState.verdict === "CLEAR") {
          runLog(run.runDir, { event: "coverage-floor-clamp", cause: "forward-actions", from: "CLEAR", to: "CONDITIONAL", legalActions: conditions.length });
          note(`deliver-conditional floor: the opinion names ${conditions.length} forward legal action(s) a human must take (${conditions[0].slice(0, 140)}${conditions.length > 1 ? `; +${conditions.length - 1} more` : ""}) — clamping CLEAR→CONDITIONAL (spec 64: the disposition is derived from the findings' named actions).`);
          runState.verdict = "CONDITIONAL";
          stepsRaisedTheResult = true;
          writeRunStatus(ctx, signoffPatch(runState.verdict));
        } else if (fresh.length) {
          runLog(run.runDir, { event: "verdict-conditions-recorded", legalActions: fresh.length });
        }
      }
      // ── — THE CONDITIONS THAT NEVER REACHED THE LIST ──────────────────────────────────────
      //
      // `conditions` above is what SURVIVED the lenient parse. An action that failed validateAction
      // is not in it, and until this arm existed that was the whole defect: one unknown key on a
      // senior-clearance row took a run from CLEAR→CONDITIONAL to CLEAR, because the floor and the
      // sidecar's own coherence check both read the post-quarantine list and were blind to the drop
      // for the same reason. The defect and the relaxation were the same event.
      //
      // The clamp is deliberately NOT a run failure. The lenient path exists to salvage a run whose
      // corrective ladder is spent, and a delivered opinion that says "there are conditions, and one
      // of them could not be stated" is worth more to the reader than no opinion. What it must never
      // do is read as complete — so the reason says INCOMPLETE in the client's own words, and the
      // engine-side detail (ids, defect tokens) rides the note and the log where an engineer reads.
      const droppedConditions = quarantinedConditionRows(fdoc?.actionsQuarantined);
      if (droppedConditions.length) stepsUnreadable = true;   // a step nobody can read is never shown withdrawn
      const droppedReason = DROPPED_CONDITIONS_REASON;
      // ONCE, not once per entry. This floor is re-entered — the degenerate re-ask and the delivery
      // block both call it again — so the reason, the clause and the telemetry are guarded by the
      // reason's own presence. An event emitted on every re-entry would inflate any count keyed on
      // it, which is how a log line stops being a measurement.
      if (droppedConditions.length && !runState.clampReasons.includes(droppedReason)) {
        clampKinds.actionsDropped = true;
        clampClauses.push(droppedReason);
        runState.clampReasons.push(droppedReason);
        recordConditionReasons.add(droppedReason);
        runLog(run.runDir, { event: "verdict-conditions-dropped", n: droppedConditions.length,
          ids: droppedConditions.map((q) => q.id), kinds: droppedConditions.map((q) => q.kind),
          errors: droppedConditions.map((q) => String(q.error ?? "").slice(0, 80)) });
        note(`deliver-conditional floor: ${droppedConditions.length} action(s) the opinion typed were dropped by the parser and may have conditioned this result (${droppedConditions.map((q) => `${q.kind ?? "kind-unreadable"}#${q.id ?? "?"}`).join(", ")}) — the verdict cannot be CLEAR over a condition nobody can read.`);
      }
      // The CLAMP is outside that guard on purpose: a re-ask can flip a clamped verdict back to CLEAR,
      // and it must meet this floor again with the reason already recorded.
      if (droppedConditions.length && runState.verdict === "CLEAR") {
        runLog(run.runDir, { event: "coverage-floor-clamp", cause: "dropped-actions", from: "CLEAR", to: "CONDITIONAL", actionsDropped: droppedConditions.length });
        runState.verdict = "CONDITIONAL";
        writeRunStatus(ctx, signoffPatch(runState.verdict));
      }
    }
  } catch (e) { note(`legal-actions floor skipped (${String(e.message).slice(0, 80)}) — never-kill; the predelivery coherence lint is the second net`); }
  // ── — THE RECORDED DOWNGRADE, READ ──────────────────────────────────────────────────────────
  //
  // wrote this record deliberately and wrote it well. Nothing read it. A run whose dictated
  // meaning sweep silently became the legacy spec-less path delivered CLEAN — no clamp, no coverage
  // flag, nothing on the report — while `_driver/common-law-path.json` sat on disk naming the
  // downgrade and the term of the selector that caused it. Being right is not the same as being read.
  //
  // THE LIVE SHAPE THIS CATCHES: a resume of a run with no `_driver/profile.json`. attachProfile
  // stays legacy on a sidecar-less resume (ctx.profile = null, deliberately — retro-minting would
  // apply the identity join to a grid the worker was never dictated), so profile.platforms is 0, the
  // grid spec is never authored, and a variant-carrying non-register-only matter takes the spec-less
  // path. made the OTHER zeroing (a manifest whose variants do not parse) loud; this is the term
  // of the same conjunction that stayed silent.
  //
  // IT SITS IN ITS OWN try, NOT inside the legal-actions block above: that block's catch would
  // swallow this reader whenever deriveActionConditions threw, and a downgrade lost because an
  // unrelated parse failed is the same silence one layer along.
  //
  // The predicate is deliberately narrow — the four other decision arms (flag-off, single-term-grid,
  // resumed-unsplit, register-only) are legitimate paths and must not clamp. The unsplit path is the
  // documented rollback and is NOT a failure; the defect is the silence, so this records and clamps
  // rather than throwing.
  try {
    if (runState.verdict === "CLEAR" || runState.verdict === "CONDITIONAL") {
      let rec = null;
      try { rec = JSON.parse(readFileSync(P.commonLawPath, "utf8")); }
      catch { /* legacy run — the record predates, or this pass never reached the gather */ }
      const down = (rec && rec.path === "unsplit" && rec.reason === "no-grid-spec"
        && rec.spec_inputs?.registerOnly === false && (rec.spec_inputs?.gridVariants ?? 0) > 0) ? rec : null;
      const clReason = down && `the dictated meaning sweep did not run: ${down.spec_inputs.gridVariants} variant(s) were written for it and no grid spec was authored, so the common-law layer ran on the legacy spec-less path and the unregistered-use coverage is not the coverage the plan dictated`;
      // RECORD ONCE. This floor is re-entered (the degenerate re-ask, the lint repair and the
      // post-consolidation delivery block all call it again), so the reason guards itself by presence
      // — an event emitted per re-entry stops being a measurement.
      if (clReason && !runState.clampReasons.includes(clReason)) {
        clampKinds.commonLawDowngrade = true;
        clampClauses.push(clReason); runState.clampReasons.push(clReason);   // machinery reasons ARE factual open-states — clause == reason
        runLog(run.runDir, { event: "common-law-downgrade-clamp", reason: down.reason,
          gridVariants: down.spec_inputs.gridVariants, profilePlatforms: down.spec_inputs.profilePlatforms });
        note(`deliver-conditional floor: ${clReason} — clamping CLEAR→CONDITIONAL so the delivered status carries the gap.`);
      }
      // THE CLAMP IS A SEPARATE `if` ON PURPOSE, exactly as the dropped-conditions clamp below is: a
      // re-ask can flip a clamped verdict back to CLEAR, and it must meet this floor again with the
      // reason ALREADY recorded. Folding these two into one guard would let the second pass skip on
      // the dedup and deliver CLEAR — the precise defect this issue is about.
      if (clReason && runState.verdict === "CLEAR") { runState.verdict = "CONDITIONAL"; writeRunStatus(ctx, signoffPatch(runState.verdict)); }
    }
  } catch (e) {
    note(`common-law downgrade floor skipped (${String(e.message).slice(0, 80)}) — never-kill`);
    // Nothing else would clamp this: the audit workbook names it (degraded-parts.mjs, checks).
    try { runLog(run.runDir, { event: "verdict-floor-failed", floor: "common-law", fail: String(e?.message ?? e).slice(0, 200) }); }
    catch { /* the note above still stands */ }
  }
  if (entryVerdict === "CLEAR") {
    const frameGap = ctx.frameReopenGap === true;
    let frameDeferrals = [];
    try { const rp = paths(run.runDir).frameReopenReceipt; const rec = existsSync(rp) ? JSON.parse(readFileSync(rp, "utf8")) : null; frameDeferrals = Array.isArray(rec?.deferrals) ? rec.deferrals : []; } catch { /* best-effort */ }
    const frameResidual = frameGap || frameDeferrals.length > 0;
    // This arm's producer went live (it had none since the initial port):
    // the unresolved set comes from ctx when THIS session's gate disclosed it, else from the durable
    // sidecar (the resume shape — the gate disclosed, the process died, and this pass reached the
    // floor without re-entering the gate).
    const sgUnresolved = loadScreenGateUnresolved(run.runDir, ctx);
    const screenGateGap = sgUnresolved.length > 0;
    const coverageInsufficient = coverageJudgment.present && coverageJudgment.sufficient === false;
    // WP-receipts W4 — the "clamp" arm of UNREACHABLE_SENIOR_POLICY (OFF by default: the senior lawyer decided
    // open-item, 2026-07-05 — a stated qualification, never a rule-driven verdict change). Built so
    // flipping the policy is one config line, not a code round.
    const seniorGap = UNREACHABLE_SENIOR_POLICY === "clamp"
      && (ctx.seniorRights?.rows ?? []).some((r) => r.applicable && !r.verified);
    // Unfinished-register clamp (copper-lattice 2026-07-08; ON by default, CLEAROTRON_REGISTER_GAP_CLAMP=0
    // is rollback-only): a MATERIAL register slice that never (fully) ran is an EXECUTION fact, not a
    // sufficiency judgment — the screenGateGap class ("could not examine"), read deterministically from
    // the taint-relabelled ledger + the taint receipt, independent of the LLM's
    // coverage_judgment (whose absent-⇒-sufficient default is the hole this closes). deferred rows only;
    // coverage-limited stays an accepted limit.
    const regGap = process.env.CLEAROTRON_REGISTER_GAP_CLAMP !== "0"
      ? decideRegisterGap(loadCoverageLedger(run.runDir).rows, { taintAxes: readActiveTaintAxes(run.runDir) })
      : { gap: false, deferred: [], taintAxes: [] };
    const registerGap = regGap.gap === true;
    // T3 (H4, an owner-approved doctrine flip): the D1 `artifactInvalid`
    // clamp input + kinds.artifact are DELETED — a compromised machine artifact now FAILS the run
    // upstream (deriveNamedBand / the register-digest terminals) instead of shipping a
    // finished-looking CONDITIONAL over unreadable receipts. What remains here are the honest
    // sanctioned clamps: the lawyer's own sufficiency call, a disclosed frame residual, a
    // could-not-examine record, and an unfinished register slice — CONDITIONAL carries
    // lawyer-judged/disclosed residue only.
    if (coverageInsufficient || frameResidual || screenGateGap || seniorGap || registerGap) {
      // THESE SENTENCES REACH A CLIENT AND THEY ARE NOT OURS TO WRITE (owner, 2026-09-17). One of
      // them — the screen-gate line, which says a mark "could not be record_fetched" — carried an
      // engine identifier into the list a client reads as the conditions on their result, by a route
      // `terminalClampDecision` guards and this one did not. A reader's sentence for it was written
      // here and refused: the objection was the class, not the wording. RULED 2026-09-18, design item
      // 25 — cut the clause: it stays in the run record and leaves the client's result entirely, with
      // NOTHING written in its place. That is what the `null` clause below means.
      const reasons = [], clauseOf = new Map();   // run-record reason → the client's clause: the same words, with any engine token taken out
      const machinery = (reason, clause = reason) => { reasons.push(reason); clauseOf.set(reason, clause); };
      if (coverageInsufficient) machinery(`the lawyer judged a material slice not fully cleared: ${coverageJudgment.reason || "register coverage gap"}`);
      // The frame comparison's reason is the engine's account of its own steps: it stays in the run record, and the
      // client's conditions get nothing in its place (ruled 2026-10-13, as the screen-gate line below).
      if (frameGap) machinery("the blind frame-diff flagged a dominant-element omission the reopen pass did not close", null);
      else if (frameDeferrals.length) machinery(`follow-ups left open this run: ${frameDeferrals.map((d) => plainDirective(d.directive)).slice(0, 3).join(", ")}`);
      if (screenGateGap) machinery(`${sgUnresolved.length} in-scope mark(s) dropped on goods could not be record_fetched (unverified): ${sgUnresolved.map((g) => g.mark).join(", ")}`, null);   // run record ONLY: no client clause (ruled 2026-09-18)
      if (seniorGap) machinery(`the oldest registration in a verdict-driving family could not be retrieved (policy: clamp): ${(ctx.seniorRights?.rows ?? []).filter((r) => r.applicable && !r.verified).map((r) => r.mark).join(", ")}`);
      if (registerGap) {
        for (const { reason, clause } of registerGapConditions(regGap)) machinery(reason, clause);
        // (the deferred and cut-down register lines: registerGapConditions, at the end of this file)
      }
      // ── THE THIRD CLAMP SITE NAMES ITSELF, AND NAMES WHICH OF ITS SIX INPUTS FIRED ────────────────
      //
      // All three clamp sites emitted this event under one name with the same from/to, distinguishable
      // only by which optional payload key happened to be present. Two of them fired three milliseconds
      // apart on a production run — the first without `frameDeferred`, the second with it — which reads
      // as one decision logged twice. It was two different decisions wearing one name, and the test lane
      // reasonably discounted one of them. `cause` makes the event self-describing.
      //
      // THE EVENT NAME IS DELIBERATELY NOT SPLIT. It is a true statement about the effect — the verdict
      // was clamped — and something downstream may already count clamps in aggregate. A discriminator is
      // additive; three names would not be.
      //
      // This site is itself six causes under one name, so it also lists WHICH fired rather than
      // leaving a reader to key on field presence and guess.
      const clampInputs = Object.entries({
        coverageInsufficient, frameGap, frameDeferred: frameDeferrals.length,
        screenGate: screenGateGap ? sgUnresolved.length : 0, seniorRight: seniorGap,
        registerGap,
      }).filter(([, v]) => Boolean(v)).map(([k]) => k);
      runLog(run.runDir, { event: "coverage-floor-clamp", cause: "coverage", causes: clampInputs, from: "CLEAR", to: "CONDITIONAL", coverageInsufficient: coverageInsufficient || undefined, frameGap: frameGap || undefined, frameDeferred: frameDeferrals.length || undefined, screenGate: screenGateGap ? sgUnresolved.length : undefined, seniorRight: seniorGap || undefined, registerGap: registerGap ? { deferred: regGap.deferred.length, taint: regGap.taintAxes.length } : undefined });
      note(`deliver-conditional floor: ${reasons.join("; ")} — clamping CLEAR→CONDITIONAL so the delivered status carries the gap (never withheld, never halted).`);
      runState.verdict = "CONDITIONAL";
      // APPEND (dedup by exact text) — the legalActions arm may already have recorded conditions,
      // and this callable runs more than once (degenerate re-ask, lint repair, post-consolidation).
      const freshMachinery = reasons.filter((r) => !runState.clampReasons.includes(r));
      clampClauses.push(...freshMachinery.map((r) => (clauseOf.has(r) ? clauseOf.get(r) : r)));   // the clause is the reason less any engine token; null = the run record's alone
      runState.clampReasons.push(...freshMachinery);
      // The reason KINDS distinguish coverage/frame/screen-gate/senior-right/register residue for the
      // report bound line and the client conditions row (merged — legalActions survives).
      clampKinds = { ...clampKinds, coverage: coverageInsufficient || undefined, frame: frameResidual || undefined, screenGate: screenGateGap || undefined, seniorRight: seniorGap || undefined, registerGap: registerGap || undefined };
      writeRunStatus(ctx, signoffPatch(runState.verdict));
    }
  }
  };
  applyCoverageFloor();
  // A2 / T2 — the delivered verdict + its DERIVED display fields (tier/badge/gauge
  // off the worst live composite) become THE code-carried authority every downstream surface joins
  // (report hero + gauge via driver-owned front-matter, composeEmailHtml, meta.json) instead of
  // each surface re-deriving its own idea of the bound —
  // copper-spire's three-way label contradiction was exactly three surfaces with three authorities.
  // MANDATORY now (was best-effort): the sidecar IS the single authority; a failed write is a run
  // failure, never a silent fallback to divergent labels. Re-invoked after findings consolidation
  // (the delivery block) so the sidecar always reflects the FINAL findings set.
  const composeVerdictSidecar = () => {
    let findingsArr = [], sv = 1, actionsArr = null, actionsDropped = [];
    try {
      const doc = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
      findingsArr = doc?.findings ?? [];
      sv = doc?.schemaVersion ?? 1;
      actionsArr = doc?.actions ?? null;
      actionsDropped = quarantinedConditionRows(doc?.actionsQuarantined);
    } catch { /* no findings — derive off none */ }
    // spec 64 — belt-and-braces: the sidecar is THE authority every surface joins; writing CLEAR
    // while the findings carry live condition actions is the exact incoherence the derivation
    // exists to prevent. Fail loud (StageFailure at the call sites) — never write the contradiction.
    const actionConditions = deriveActionConditions(actionsArr, findingsArr).conditions;
    if (runState.verdict === "CLEAR" && actionConditions.length)
      throw new Error(`verdict CLEAR with ${actionConditions.length} live condition action(s) — applyCoverageFloor must re-derive before the sidecar writes`);
    // — AND THE SAME INVARIANT OVER THE ONES THAT WERE DROPPED. This check read the SURVIVING
    // actions, so it was blind to a quarantined condition in exactly the way the floor above was —
    // two independent guards, one blind spot, because both consumed the same lossy parse. A guard
    // that fails the way the thing it guards fails is not a second net.
    if (runState.verdict === "CLEAR" && actionsDropped.length)
      throw new Error(`verdict CLEAR with ${actionsDropped.length} DROPPED condition action(s) (${actionsDropped.map((q) => `${q.kind ?? "kind-unreadable"}#${q.id ?? "?"}`).join(", ")}) — a condition nobody can read is still a condition; applyCoverageFloor must clamp before the sidecar writes`);
    // — A BLOCKING VERDICT CARRIES ITS GROUNDS, OR THIS WRITE REFUSES.
    //
    // `applyCoverageFloor` populates clampReasons/clampKinds on CLEAR and CONDITIONAL only — "BLOCKING
    // stays the fail arm untouched" — so every BLOCKING sidecar shipped `reasons: []` and `kinds: {}`:
    // the decision without its grounds, in the artifact whose entire purpose is carrying them. The prose
    // survived in senior-eye-review.md, so nothing was lost that time; a consumer of verdict.json alone
    // (dashboard, gate, downstream stage) saw an ungrounded BLOCKING.
    //
    // THE GROUNDS WERE ALREADY PARSED. `parseCorrections` is imported by this file and already walks the
    // review for exactly these lines — it is what the corrective pass is handed at :10242. Nothing needed
    // extracting; the two halves simply were never joined. No third copy of that walk is made here, which
    // is the rule verify.mjs states beside `countCitedDefects` ("the line walk is countCitedDefects's,
    // verbatim, so 'a correction line' means the same thing to both").
    //
    // NO CLIENT SURFACE MOVES. `riskStatement` and `bindRecommendation` both return a fixed string on
    // BLOCKING and never read `reasons`; `deriveDisplayVerdict` passes them through to `conditions` and
    // takes tier/badge/gauge from the findings. And post- a BLOCKING run does not reach delivery
    // at all. This changes the record and nothing a client reads.
    //
    // A DEGENERATE REVIEW STILL WRITES A REASON, and this ordering is deliberate: the sidecar is written
    // HERE, before the degenerate-BLOCKING re-ask below gets its one chance to repair a review that cited
    // nothing. Throwing on the empty case would turn a recoverable reviewer defect into a StageFailure
    // that ends the run before the repair it already has. So the empty case states ITSELF as the ground —
    // "the reviewer cited nothing" is a fact about this run, and an empty array is not.
    // LOCAL TO THIS WRITE, never pushed into clampReasons/clampKinds — and that is the whole care in it.
    // `clampReasons` outlives the call, and the degenerate re-ask below can flip this same run to CLEAR
    // and write again. Grounds pushed into the shared array would ride into the CLEAR sidecar as its
    // `reasons`: a verdict claiming conditions it does not have, which is this PR's own defect arriving
    // through its own fix. On every non-BLOCKING verdict these are pass-throughs.
    let blockingGrounds = [];
    let reviewerCited = false;
    if (runState.verdict === "BLOCKING") {
      let cited = [];
      try { cited = parseCorrections(readFileSync(P.seniorEyeReview, "utf8")).map((r) => r.text).filter(Boolean); }
      catch { /* unreadable or absent review — the fallback ground below is the honest record of that */ }
      reviewerCited = cited.length > 0;
      blockingGrounds = (reviewerCited
        ? cited.slice(0, 12).map((t) => t.slice(0, 300))
        : ["the reviewer refused to sign and cited no file-anchored defect — a degenerate review, recorded as the ground rather than left as an empty array"]
      ).filter((g) => !runState.clampReasons.includes(g));
    }
    // — the lede is the opinion's, by decision: orderClausesForLede (terminal-clamp.mjs)
    // sorts guard clauses after the opinion's condition clauses, reasons reordered in step. The
    // rationale lives on the function so the arms can DRIVE it rather than pin this call site's text.
    const { clauses: orderedClauses, reasons: orderedReasons } = orderClausesForLede(clampClauses, runState.clampReasons, guardClauses);
    const reasonsOut = blockingGrounds.length ? [...orderedReasons, ...blockingGrounds] : orderedReasons;
    // — AND EACH APPENDED GROUND CARRIES AN EXPLICIT NULL CLAUSE, which is what puts it in the
    // run record ALONE. The block above says "no client surface moves", and that was true of the
    // statement and the bound recommendation, both fixed strings on BLOCKING. It was never true of the
    // CONDITIONS LIST: `clientConditions` walks the reasons and prints any reason that has no clause
    // and no engine token, so on a delivered BLOCKING run the reviewer's own cited correction lines
    // printed to the client as their conditions — 8 of the 13 conditions on the run this was measured
    // on (2026-09-20). A stored null is the shipped way to say "recorded, not rendered", and the
    // arrays stay index-aligned because `orderClausesForLede` returns them the same length.
    const clausesOut = blockingGrounds.length
      ? [...orderedClauses, ...blockingGrounds.map(() => null)]
      : orderedClauses;
    const kindsOut = runState.verdict === "BLOCKING" ? { ...clampKinds, reviewerCited } : clampKinds;
    // The invariant itself, stated over the value that is WRITTEN rather than over the branch that fills
    // it — a guard that only holds while the code above is remembered is not a guard. Unreachable today
    // by construction, which is the intended shape: a BLOCKING with an empty reasons array is
    // structurally impossible, and any future path that reintroduces one dies here instead of shipping.
    if (runState.verdict === "BLOCKING" && !reasonsOut.length)
      throw new Error("verdict BLOCKING with no reasons — a blocking decision without its grounds; verdict.json is the artifact whose whole purpose is carrying them");
    // doc 50 — a v4 record derives off the run's FROZEN framework (band words); deriveDisplayVerdict
    // fail-louds if banded findings arrive with no manifest (never silently badge a rated matter LOW).
    const derived = deriveDisplayVerdict({ verdict: runState.verdict, reasons: reasonsOut, kinds: kindsOut, findings: findingsArr,
      manifest: sv >= 4 ? ctx.framework : null });
    // spec 64 — THE one risk statement: composed ONCE here (band word + stance clause from the same
    // sidecar fields), consumed verbatim by every surface (index / status / report hero / email /
    // xlsx) so severity and disposition can never contradict across pages. PR-3 (report voice): a
    // CONDITIONAL statement reads "<Tier> — conditional on: <factual open-state> (and N more)." —
    // clampClauses carries the fact-voice clauses; the structured `stance` field is what every
    // consumer keys on (never the statement's wording — the magic-string coupling is retired).
    const statement = riskStatement({ tier: derived.tier, verdict: runState.verdict, reasons: reasonsOut, clauses: clausesOut,
      basis: isRegisterOnly(ctx.searchPolicy) ? "register-only" : null });
    return { derived, statement, doc: { ts: new Date().toISOString(), verdict: runState.verdict, reasons: reasonsOut, clauses: clausesOut, kinds: kindsOut,
      tier: derived.tier, badge: derived.badge, gaugeIndex: derived.gaugeIndex, maxComposite: derived.maxComposite,
      band: derived.band ?? null, statement, stance: verdictStance(runState.verdict) } };
  };
  // The label, composed above and written here. Composing is apart so the delivery check can show the stages it re-runs
  // the label it could not yet save.
  const writeVerdictSidecar = () => {
    const { derived, statement, doc } = composeVerdictSidecar();
    const tmp = paths(run.runDir).verdictJson;
    writeFileSync(tmp, JSON.stringify(doc, null, 2));
    renameSync(tmp, paths(run.runDir).verdict);
    // — THE STATUS RECORD CARRIES THE BAND AND THE SENTENCE, so a reader of the run does not
    // have to reach for `verdict` to say something about the outcome. `verdict` is the gate's decision
    // (CLEAR / CONDITIONAL / BLOCKING) and is engine vocabulary; the band and the composed statement are
    // what every client surface already speaks. Measured 2026-09-20: an assistant summarising a run read
    // `verdict` and told the client "BLOCKING" beside a Medium rating, because status.json held no band.
    writeRunStatus(ctx, { tier: derived.tier ?? null, statement: statement ?? null });
    return derived;
  };
  // THE LABEL, SAVED AGAIN IN THE DELIVERY CHECK, WITHOUT ENDING THE RUN (2026-10-19). After a clamp there the label
  // has to reach every surface the report is published from, and they all read it from the one file. A save that
  // fails is tried again. One that still fails is owed: the stages the check re-runs are shown the label as composed,
  // and the save is made once more before anything is published, so no surface is built from the label settled
  // before the clamp. Returns whether it is saved.
  runState.labelOwed = null;
  runState.rankingBeforeRepeat = null;   // where each record stood before the delivery check repeated placement
  const saveTheLabel = (why) => {
    const saved = saveWithRetries(() => writeVerdictSidecar());
    if (saved.ok) {
      if (saved.attempts > 1) runLog(run.runDir, { event: "verdict-write-retried", why, attempts: saved.attempts });
      try { runState.displayVerdict = JSON.parse(readFileSync(paths(run.runDir).verdict, "utf8")); } catch { /* the label is re-read at reassembly */ }
      return true;
    }
    runState.labelOwed = runState.labelOwed ?? why;
    runLog(run.runDir, { event: "verdict-write-deferred", why, attempts: saved.attempts, fail: String(saved.error?.message ?? saved.error).slice(0, 160) });
    note(`delivery: the label could not be saved ${why} (${String(saved.error?.message ?? saved.error).slice(0, 100)}) — it is saved again before the report is published`);
    try { runState.displayVerdict = composeVerdictSidecar().doc; } catch { /* composed again when it is saved */ }
    return false;
  };
  // THE LABEL OWED IS SAVED before anything is published from it, and the report's own label follows it. Only a run
  // directory that refuses every save of it ends the run, and then nothing the run writes can be published.
  const saveTheOwedLabel = () => {
    if (!runState.labelOwed) return;
    const owed = runState.labelOwed;
    runState.labelOwed = null;
    if (!saveTheLabel(`${owed}, saved again before delivery`))
      throw new StageFailure("verdict", `the run directory refused every save of the result's label (${owed}) — no surface can be published with it`);
    applyVerdictFrontMatter();
  };
  // THE CONDITIONS FOLLOW THE RECORD AFTER A REPAIR IN THE DELIVERY CHECK. Every surface reads the list from the label,
  // and the list states the record's forward legal steps as the record stands: a repair that rewrites, withdraws or
  // adds one moves the list with it, in the record's own words. The result moves only where the floor any result meets
  // moves it: a CLEAR the repaired steps now condition becomes CONDITIONAL, and nothing is relaxed. A BLOCKING result
  // states no step of its own, so only a list already stating the record's steps follows it. The caller saves the
  // label. Returns whether the list, its kinds or the result changed.
  const followTheRecordsActions = (why) => {
    if (runState.verdict === "BLOCKING" && !recordConditionReasons.size) return false;
    let raw = null, fdoc = null;
    try { if (existsSync(P.findings)) { raw = readFileSync(P.findings, "utf8"); fdoc = parseFindingsJsonLenient(raw); } }
    catch { fdoc = null; }
    if (!fdoc) return false;   // no record to read: the list stands as stated, and the coherence checks judge it
    const { conditions, conditionClauses } = deriveActionConditions(fdoc.actions, fdoc.findings);
    const now = conditions.map((c) => ({ reason: c, clause: conditionClauses[conditions.indexOf(c)] ?? c }));
    const dropped = quarantinedConditionRows(fdoc.actionsQuarantined).length > 0;
    if (dropped && recordConditionReasons.has(DROPPED_CONDITIONS_REASON)) now.push({ reason: DROPPED_CONDITIONS_REASON, clause: DROPPED_CONDITIONS_REASON });
    const state = () => JSON.stringify([runState.clampReasons, clampClauses, Boolean(clampKinds.legalActions), Boolean(clampKinds.actionsDropped)]);
    const stood = state(), was = runState.verdict;
    const f = conditionsFollowingTheRecord({ reasons: runState.clampReasons, clauses: clampClauses, fromRecord: recordConditionReasons, now });
    runState.clampReasons = f.reasons;
    clampClauses = f.clauses;
    recordConditionReasons = f.held;
    if (!conditions.length) delete clampKinds.legalActions;
    if (!dropped) delete clampKinds.actionsDropped;
    // A WITHDRAWAL IS POSITIVE ONLY ON A RECORD WHOSE ACTIONS REGISTER IS A LIST that holds none of the steps. A missing
    // or malformed register, or one with an entry dropped as unreadable, withdraws nothing.
    if (f.held.size || conditions.length || dropped) stepsWithdrawnAt = null;
    else if (f.withdrawn.length) stepsWithdrawnAt = actionsRegisterListed(raw) ? new Date().toISOString() : null;
    // The floor runs again only where the repaired steps reach it, as the coherence repair runs it.
    if (state() !== stood || (runState.verdict === "CLEAR" && (conditions.length || dropped))) applyCoverageFloor();
    restoreTheReviewsClear();
    if (state() === stood && runState.verdict === was) return false;
    runLog(run.runDir, { event: "verdict-conditions-followed", why, withdrawn: f.withdrawn.length, added: f.added.length,
      restated: f.restated.length, conditions: recordConditionReasons.size, from: was, to: runState.verdict });
    note(`the conditions follow the record ${why} (${f.withdrawn.length} withdrawn, ${f.added.length} added, ${f.restated.length} restated${runState.verdict === was ? "" : `; ${was} → ${runState.verdict}`})`);
    return true;
  };
  // A CORRECTION THAT WITHDREW EVERY STEP THAT ALONE MADE THE RESULT CONDITIONAL gives the review's CLEAR back, once the
  // review of that change has been read and no correction since was rejected (the owner's decision, 2026-11-04). The
  // result is recomputed as a closed gap's is, and that CLEAR meets the floor any CLEAR meets. The caller saves the label.
  const restoreTheReviewsClear = () => {
    let review = null;
    try { review = JSON.parse(readFileSync(postRepairRecordPath(run.runDir), "utf8")); } catch { review = null; }
    const now = verdictWhenTheStepsAreWithdrawn({ verdict: runState.verdict, assessed: runState.assessed, reasons: runState.clampReasons, raisedBySteps: stepsRaisedTheResult,
      stepsUnreadable, withdrawnAt: stepsWithdrawnAt, reviewReadAt: review?.status === "read" ? review.ts : null,
      reviewUnread: review?.status === "unread", correctionRejectedAt: runState.correctionRejectedAt,
      // The correction of the first review owed a recheck the cycle did not get accepted: the assessment is not verified.
      recheckUnaccepted: (correctiveEntryVerdict === "CONDITIONAL" || correctiveEntryVerdict === "BLOCKING") && !correctiveCycleSettled && !correctiveRecheckOk });
    if (now === runState.verdict) return false;
    runLog(run.runDir, { event: "verdict-recomputed-steps-withdrawn", from: runState.verdict, to: now, withdrawnAt: stepsWithdrawnAt, reviewReadAt: review?.ts ?? null });
    note(`every forward legal step that made the result conditional was withdrawn, the review of that change was read, and nothing else conditions the result — ${runState.verdict} goes back to ${now}, the result the review reached`);
    runState.verdict = now;
    runState.restoredClear = now === "CLEAR";
    stepsRaisedTheResult = false;
    writeRunStatus(ctx, signoffPatch(runState.verdict));
    applyCoverageFloor();   // the floor any CLEAR meets
    return true;
  };
  try { writeVerdictSidecar(); }
  catch (e) { throw new StageFailure("verdict", `verdict sidecar write failed (the single label authority): ${String(e.message).slice(0, 120)}`); }

  // T3a, ruling 2026-08-26 — "Deliver always, with open points printed. The refusal on a blocking
  // review goes." This REVERSES T3 (H3/H5), whose flip to fail-on-BLOCKING is itself recorded
  // itself an owner-approved decision. Both are his; this is the standing one, and the
  // history is kept here rather than deleted because a reader who finds only one of them will conclude
  // the code drifted from its contract. (It did not; driver/skills/clearance-search/SKILL.md was the stale half, and this
  // change makes it true again.)
  //
  // COPPER-SPIRE IS STILL ANSWERED, AND NOT BY REFUSING. That failure was a BLOCKING verdict reaching
  // delivery and then CONTRADICTING its own client summary — a report that reads finished while the
  // reviewer refused. "Never ships" and "never ships LOOKING FINISHED" were treated as one requirement
  // for a year; they are two, and only the second was load-bearing. The open-points section at the top
  // of the body is what carries it now.
  //
  // The corrective ladder above is still the fix arm and still runs first. What changed is what happens
  // when it is exhausted: the reviewing lawyer gets the best draft the run could produce with its weak
  // spots named, instead of nothing.
  if (runState.verdict === "BLOCKING") {
    // Repair-first A5 (2026-07-05): the reviewer verdict is documented noisy (the U1 comment above —
    // "flips on byte-identical input"), so before the terminal the gate refuses a DEGENERATE artifact:
    // a carried BLOCKING whose own file no longer says BLOCKING (the copper-spire shape — a failed
    // re-check silently kept the stale entry verdict while the review on disk said CLEAR), or a
    // BLOCKING citing ZERO defects (nothing exists for the corrective ladder to fix). ONE forced-fresh
    // re-ask demands the verdict + file-anchored defects. A REASONED blocking is never re-rolled —
    // this repair refuses self-contradiction; it cannot overrule the reviewer.
    // ✕ CONVERSION 9 PRE-EMPTS ONE OF THE TWO SHAPES AND NOT THE OTHER, so this branch stays and the
    // reason is written down rather than left for somebody to re-derive from an arm that never fires.
    //
    //   countCitedDefects === 0   PRE-EMPTED. `record_narrative_refutation` refuses a BLOCKING with an
    //                             empty `flags` array in the turn it is typed, so no review this driver
    //                             RENDERS can carry that shape. It survives only on a file the tool did
    //                             not write — a run resumed across the conversion, or an archived
    //                             review re-read from disk.
    //   parseVerdict(md) !== "BLOCKING"   NOT PRE-EMPTED, and it is the copper-spire shape this repair
    //                             was built for: the run CARRIES BLOCKING while the file on disk says
    //                             something else. That is a disagreement between the carried entry
    //                             verdict and a later render, and no per-call validation can see it —
    //                             each call was individually valid.
    //
    // So the repair is narrower than it was and is not dead. Deleting it would take the shape that
    // still occurs along with the one that no longer does.
    const readReview = () => { try { return readFileSync(P.seniorEyeReview, "utf8"); } catch { return ""; } };
    const isDegenerate = (md) => parseVerdict(md) !== "BLOCKING" || countCitedDefects(md) === 0;
    const reviewMd = readReview();
    const reviewLedger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(run.runDir, { log: (o) => runLog(run.runDir, o) }));
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
    // second statement of the same rule, and two ends stating the same rule is how they drift apart.
    const degenerateReaskMax = 1;
    if (isDegenerate(reviewMd) && reviewLedger.canAttempt("reviewer-degenerate-reask", run.codename, { max: degenerateReaskMax })) {
      runLog(run.runDir, { event: "reviewer-degenerate", fileVerdict: parseVerdict(reviewMd) ?? "unparseable", citedDefects: countCitedDefects(reviewMd) });
      note(`verdict: BLOCKING is DEGENERATE (file says ${parseVerdict(reviewMd) ?? "unparseable"}, ${countCitedDefects(reviewMd)} cited defect(s)) — one forced-fresh re-ask demanding cited defects`);
      const rr = await stage("narrative-refutation", ctx, {
        force: true, trigger: "degenerate-reask",
        extra: lines(
          `Record the review again with \`record_narrative_refutation\`: the verdict (CLEAR / CONDITIONAL / BLOCKING) and any flags that still stand.`,
          `If your verdict is BLOCKING: cite at least one concrete, file-anchored defect per blocking reason (name the file and the exact claim). A BLOCKING with no cited defects is invalid output.`,
          planAuditExtra(ctx) || "",
        ),
      });
      reviewLedger.record("reviewer-degenerate-reask", run.codename, rr.ok ? "ok" : `failed: ${rr.fail}`, { max: degenerateReaskMax });
      if (rr.ok) {
        runState.verdict = parseVerdict(readReview()) ?? "BLOCKING";
        runState.assessed = runState.verdict;   // the re-asked review is the assessment now
        runLog(run.runDir, { event: "verdict-3", verdict: runState.verdict, trigger: "degenerate-reask" });
        writeRunStatus(ctx, signoffPatch(runState.verdict));
        applyCoverageFloor();   // a re-asked CLEAR passes the same deliver-conditional floor
        // After the floor, which judges the verdict as it entered: its machinery arm records its gaps only on a CLEAR.
        const standing = verdictWithConditionsStanding({ verdict: runState.verdict, reasons: runState.clampReasons });
        if (standing !== runState.verdict) {
          runLog(run.runDir, { event: "terminal-guard-clamp", defect: `reasked_clear_over_standing_condition:${runState.clampReasons.length}`, from: runState.verdict, to: standing });
          note(`verdict: the review asked again says ${runState.verdict}, and ${runState.clampReasons.length} condition(s) a guard recorded still stand — ${runState.verdict} becomes ${standing} on them`);
          runState.verdict = standing;
          writeRunStatus(ctx, signoffPatch(runState.verdict));
        }
        try { writeVerdictSidecar(); }
        catch (e) { throw new StageFailure("verdict", `verdict sidecar write failed (the single label authority): ${String(e.message).slice(0, 120)}`); }
      }
    }
    if (runState.verdict === "BLOCKING") {
      // ── T3a — THE RUN DELIVERS. Ruling 2026-08-26, verbatim: "Deliver always, with open
      // points printed. The refusal on a blocking review goes." ──────────────────────────────────
      //
      // What stood here threw, and its reasoning was T3: "a report the reviewer will not
      // stand behind never ships looking finished." That decision was the owner's and it is now
      // reversed by the owner. Both are his; this is the standing one.
      //
      // THE OBJECTION THAT REASONING ANSWERED IS STILL ANSWERED, AND NOT BY THIS BRANCH. Its worry
      // was copper-spire: a BLOCKING verdict reaching delivery and then CONTRADICTING its own client
      // summary — a report that reads finished while the reviewer refused. That is exactly what
      // `buildReviewerOpenPointsSection` prevents, at the top of the body, code-built from the review
      // rather than from any seat's account of it. "Never ships" and "never ships LOOKING FINISHED"
      // were treated as one requirement; they are two, and only the second was ever load-bearing.
      //
      // The corrective ladder above is still the fix arm and still runs first. What changes is only
      // what happens when it is exhausted: the reviewing lawyer receives the best draft the run could
      // produce with its weak spots named, instead of nothing at all.
      runLog(run.runDir, {
        event: "verdict-blocking-delivered",
        citedDefects: countCitedDefects(readReview()),
        degenerate: isDegenerate(readReview()),
      });
      note(`verdict: BLOCKING stands after the corrective pass + re-check — the report DELIVERS, with the reviewer's open points recorded for the reviewing lawyer (${countCitedDefects(readReview())} cited defect(s)); the reviewing lawyer is the backstop`);
    }
  }
  return { applyCoverageFloor, clampOnTheFloorDuty, clampOnTheWritersDuty, deliverAndClamp, followTheRecordsActions, saveTheLabel, saveTheOwedLabel, writeVerdictSidecar };
}
