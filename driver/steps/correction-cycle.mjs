// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/correction-cycle.mjs — the correction after the review, and the recheck of it.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { driverDir } from "../../shared/driver-dir.mjs";
import { buildCorrectionsApplied, correctionsAppliedTable, scopeDrift } from "../corrections-feedforward.mjs";
import { evidenceClaimTable, evidenceClaimViolations } from "../evidence-claim-invariant.mjs";
import { parseFindingsJsonLenient } from "../findings-model.mjs";
import { note, runLog } from "../log.mjs";
import { nextRefutationSeq, settleRecheckSave } from "../narrative-refutation-record.mjs";
import { atomicWrite, signoffPatch, writeRunStatus } from "../progress.mjs";
import { modelRecordPath } from "../record-fold.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { shaOf } from "../stage-freshness.mjs";
import { parseVerdict } from "../verify.mjs";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export async function runCorrectionCycle({ ctx, run, P, verdict, firstRef, synthesisKey, synthesisModel, synthesisThinking }, helpers) {
  const { CORRECTIONS_DELIVERED_FILE, CORRECTIVE_RECHECK_FILE, asPartNotCompleted, correctionNamedLines, correctionNamedOrdinals, correctionNamedSet, correctionReading, correctionRows, correctionsExtra, correctiveCycleSettledDecision, enforceCorrectionsReachFindings, must, planAuditExtra, prepareDeclinationSpec, recordCorrectionsBasis, recordSynthesisSeam, removalRepairedRow, repairUnnamedRemovals, restoredFindingsTable, rollbackCorrectivePass, snapshotFindingsForCorrections, stage, writerExclusionBlock } = helpers;
  // AD-2 A1 (E2E-R2, recovery granularity) — the corrective cycle fires ONCE per settled
  // review/narrative state. Both legs below run `force:true` (they bypass the stage-freshness skip
  // by design), so on EVERY resume of a CONDITIONAL/BLOCKING run the cycle used to re-fire: two
  // opus-class calls that re-emit the narrative + findings, staling the whole delivery tail behind
  // them — which is how a stale-artifact recovery became a full pipeline re-run (34% of E2E-R2).
  // The completion receipt records the exact review + narrative bytes the cycle settled; a resume
  // whose bytes are unchanged skips both legs (`verdict` on such a pass is already the post-recheck
  // verdict — refute() parsed it off the very review the receipt fingerprints). Either file moving
  // re-arms the cycle. findings.json is deliberately NOT keyed: four sanctioned driver-owned
  // mutators rewrite it after this point on every pass (the restamp class — injectDeferralCoverage /
  // enrichFindingDeadlines / consolidateFindingsFile / the coverage-floor clamp), so keying on it
  // would re-arm the settled cycle on every resume, the exact cost this receipt kills. Whether the
  // corrections REACHED findings.json is enforced inside the cycle (enforceCorrectionsReachFindings
  // + the verdict-recheck), never by this receipt.
  const correctiveCyclePath = driverDir(run.runDir, "corrective-cycle.json");
  const correctiveCycleShas = () => ({ review: shaOf(P.seniorEyeReview), narrative: shaOf(P.narrative) });
  const correctiveEntryVerdict = verdict;   // the recheck reassigns `verdict`; the receipt keys on the entry gate
  let correctiveCycleSettled = false;
  let correctiveRecheckOk = false;
  if (correctiveEntryVerdict === "CONDITIONAL" || correctiveEntryVerdict === "BLOCKING") {
    let cycleReceipt = null;
    try { cycleReceipt = JSON.parse(readFileSync(correctiveCyclePath, "utf8")); } catch { /* no receipt — the cycle runs */ }
    correctiveCycleSettled = correctiveCycleSettledDecision(cycleReceipt, correctiveCycleShas());
    if (correctiveCycleSettled) {
      runLog(run.runDir, { event: "corrective-cycle-settled", verdict, receiptTs: cycleReceipt?.ts ?? null });
      note(`corrective cycle already settled for these exact review/narrative bytes — not re-firing (a stale-artifact recovery re-does what went stale, never the settled corrective loop)`);
    }
  }
  // One corrective re-synthesis on CONDITIONAL/BLOCKING, feeding the reviewer's flags back in, dispatched on the
  // WINNING synthesis attempt's key, model and thinking, so the model that wrote a fallback-won synthesis corrects
  // it. Its first attempt is a fresh turn handed the flags and the inputs; it never resumes the synthesis session.
  let correctionsApplied = null;   // — the driver's flag-by-flag observation, shared by both legs
  let evidenceViolations = [];     // — claims that moved against their own evidence, carried to the recheck
  let correctionsScope = null;     // — the declared per-finding scope, and whether the pass held to it
  let correctiveRollback = null;   // T3b — set when the corrective pass failed and the last good findings came back
  let correctiveRepair = null;     // — set when the driver put back a removal no flag named
  if (!correctiveCycleSettled && (verdict === "CONDITIONAL" || verdict === "BLOCKING")) {   // T3: the quarantine path is terminal now — the corrective pass always runs
    const preCorrective = snapshotFindingsForCorrections(P, run.runDir);                     // A1
    // — re-prepared, not reused. The findings surface cannot move between these two passes today
    // (nothing writes placements.json or register-findings.md between them — checked), so this rewrites
    // the same list. It is here anyway, because the alternative is an invariant a future change breaks
    // silently: if the surface ever did move, the corrective's `row_index` would point into the previous
    // pass's list and a declination would land on the wrong record.
    prepareDeclinationSpec(ctx, P);
    // THE CORRECTION RIDES ITS OWN DISPATCH: the excluded positions its flags name go to the writer's save with this
    // dispatch, its retries and the follow-up below, and with no other. The message names the same positions.
    const reading = correctionReading(P);
    const correction = { positions: reading.positions };
    const correctivePass = await stage("synthesis", ctx, { force: true, followup: correctionsExtra(P, ctx.depth, ctx.framework, reading), correction, sessionKey: synthesisKey, model: synthesisModel, thinking: synthesisThinking, trigger: "corrective" });
    // half one — the corrective pass rewrites findings.json under a closed minimal-edit contract,
    // so it is the pass most likely to change one record's fate. Its own account, at its own moment; the
    // winner rule in record-discard.mjs lets this carry cancel an earlier discard.
    recordSynthesisSeam(ctx, correctivePass, "corrective");
    // T3b — a corrective pass that cannot produce a valid document no longer kills the run. The
    // pre-corrective findings come back and the run delivers, with the reviewer's objections printed
    // by `buildReviewerOpenPointsSection` — which is the other half of the same owner decision and is
    // what makes this honest rather than quiet. `must` still runs where the rollback declines.
    correctiveRollback = correctivePass.ok
      ? null
      : rollbackCorrectivePass(P, run.runDir, preCorrective, correctivePass);
    if (correctiveRollback) {
      runLog(run.runDir, { event: "corrective-rollback", reason: correctiveRollback.reason,
        restored: correctiveRollback.restored, verdict });
      note(`[corrections] the corrective pass failed (${correctiveRollback.reason}) — `
        + `${correctiveRollback.restored ? "findings.json restored to the version the reviewer read" : "findings.json was never changed"}`
        + `; the run delivers with the reviewer's points printed rather than failing`);
    } else {
      // The rollback declined: a rate limit, which waits, or no record from before the pass to trust, which is the
      // assessment not completed, as for the correction after the review of a repair.
      await asPartNotCompleted("assessment", async () => must(correctivePass, `synthesis(${verdict.toLowerCase()})`));
      // ── — THE THIRD BRANCH, AND IT IS ON THE SUCCESS SIDE ON PURPOSE ─────────
      //
      // A repair is not a rollback and must never be reached by falling through to one. The rollback
      // branch above deliberately skips both the corrections-reached-findings gate and the reviewer's
      // re-read, because what it delivers is the PRE-corrective document — the exact bytes the
      // reviewer already read, so there is nothing new to re-read. A repaired document is the
      // opposite: it is a document nobody has seen, assembled by the driver from two sources.
      //
      // So it stays here, before the gate, with `correctiveRollback` still null — which is what makes
      // the reviewer's re-read run over it. That dispatch is guarded on `!correctiveRollback`, so a
      // repair hung off the rollback side would have inherited the skip silently and shipped a
      // driver-assembled document no reviewer ever saw. Every check the successful branch runs, the
      // repair branch runs, on the repaired bytes.
      //
      // NAMED AGAINST THE PRE-CORRECTIVE DOCUMENT. A removed finding is absent from the post-pass
      // file, so matching the review's names against that file would find none of them and call every
      // named removal unnamed.
      let preDocForNames = null;
      try { preDocForNames = preCorrective ? parseFindingsJsonLenient(preCorrective.raw) : null; } catch { /* fall back to the file */ }
      const repaired = repairUnnamedRemovals(P, run.runDir, preCorrective,
        correctionNamedOrdinals(P), correctionNamedSet(P, preDocForNames), correctionNamedLines(P, preDocForNames));
      correctiveRepair = repaired;   // carried to the reviewer's re-read, which must know these are the DRIVER's
      if (repaired) {
        // A DEFECT SIGNAL, not a success. After the schema fix a corrective pass sends a targeted edit
        // and cannot remove a finding at all, so e2e asserts this count is ZERO — a firing reports the
        // primary fix not holding, never this backstop working.
        runLog(run.runDir, removalRepairedRow(repaired));   // with `base`: whether the merge base took the restore
        note(`[corrections] the corrective pass removed ${repaired.restoredFindings.length} finding(s) `
          + `no flag named — restored whole from the pre-corrective snapshot: `
          + `${repaired.restoredFindings.map((f) => `#${f.ordinal} ${f.mark}`).join(", ")}`
          + (repaired.restoredKeys.length ? `; and ${repaired.restoredKeys.length} top-level register(s): ${repaired.restoredKeys.join(", ")}` : "")
          + (repaired.restoredRows.length ? `; and ${repaired.restoredRows.length} row(s): ${repaired.restoredRows.map((r) => r.key).join(", ")}` : "")
          + (repaired.leftRemoved.length ? `. ${repaired.leftRemoved.length} removal(s) the reviewer DID name stay removed.` : "")
          + " The reviewer re-reads the repaired document before it ships.");
      }
      await enforceCorrectionsReachFindings(ctx, P, preCorrective, { synthesisKey, synthesisModel, synthesisThinking, correction });   // A1 freshness gate
    }
    // — WHAT THE DRIVER OBSERVED, flag by flag, written before the recheck is dispatched. The
    // recheck's whole cost is re-reading two documents to work out whether its own corrections landed;
    // the driver already holds the pre-corrective findings snapshot and the post-pass file, so it can
    // answer that from evidence and leave the reviewer the part only it can do — judging whether what
    // changed is RIGHT. NEVER-KILL: a table that cannot be built just means the recheck reads as it
    // always did, which is today's behaviour exactly.
    try {
      const rows = correctionRows(P, readFileSync(P.seniorEyeReview, "utf8"));   // the same reading of each flag as the correction's
      const preDoc = preCorrective ? parseFindingsJsonLenient(preCorrective.model?.raw ?? preCorrective.raw) : null;   // the flags name the model's ordinals, so both sides are the record the model wrote (record-fold.mjs)
      let postDoc = null;
      try { postDoc = parseFindingsJsonLenient(readFileSync(modelRecordPath(run.runDir, P.findings), "utf8")); } catch { /* shape defects ride the normal ladder */ }
      correctionsApplied = buildCorrectionsApplied(rows, preDoc, postDoc);
      // — A CLAIM MAY NOT OUTLIVE ITS EVIDENCE, AND A DEMOTED STAMP MAY NOT COME BACK.
      //
      // Same two documents, one more question. The pass that fixes the reviewer's flags is the pass
      // most likely to break the join between a claim and its support, and on the run this was found
      // on it did both: four meters lost their basis while the band held (one with a byte-identical
      // claim, one that GREW by 243 characters as its citation was deleted), and six stamps the
      // driver had demoted minutes earlier as `record-on-disk-never-read` came back as
      // `verified-from-record` with no register call in between.
      //
      // RECORDED, AND CARRIED TO THE RECHECK — never a refusal here, for the reason the table above
      // is not one either: the reviewer is about to read both documents and is better placed than a
      // diff to say whether a change was right. A gate here would also spend a dispatch on the stage
      // this seam exists to make cheaper. ``'s correct-or-escalate is satisfied by escalating to
      // the seat that can judge it.
      try {
        let demotions = [];
        try { demotions = JSON.parse(readFileSync(P.basisDerivation, "utf8"))?.rows ?? []; }
        catch { /* no derivation record — stated below, never inferred as "clean" */ }
        const ec = evidenceClaimViolations({ before: preDoc?.findings, after: postDoc?.findings, demotions });
        evidenceViolations = ec.violations;
        runLog(run.runDir, { event: "evidence-claim-invariant", violations: ec.violations.length,
          byArm: ec.violations.reduce((a, v) => ({ ...a, [v.arm]: (a[v.arm] ?? 0) + 1 }), {}),
          snapshots: ec.snapshots });
        if (ec.violations.length) {
          atomicWrite(driverDir(run.runDir, "evidence-claim-violations.json"),
            JSON.stringify({ ts: new Date().toISOString(), ...ec }, null, 2) + "\n");
          note(`#1557: ${ec.violations.length} claim(s) moved against their own evidence in the corrective pass — `
            + ec.violations.slice(0, 3).map((v) => `${v.finding}/${v.meter} (${v.arm})`).join("; ")
            + `${ec.violations.length > 3 ? ` …${ec.violations.length - 3} more` : ""}`);
        }
      } catch (e) {
        runLog(run.runDir, { event: "evidence-claim-invariant", ok: false, why: String(e?.message ?? e).slice(0, 160) });
      }
      // — what the DECLARED scope was and whether the pass honoured it. Recorded, never refused:
      // a gate here costs a whole extra dispatch on the stage this change exists to make cheaper, and
      // the reviewer is about to read the table anyway — it is better placed than a diff to say
      // whether a knock-on edit was right. `unbound` is the `cite_unbound` shape one gate over and
      // would earn a refusal if it recurs; this round measures whether it does.
      correctionsScope = scopeDrift(rows, preDoc, postDoc);
      atomicWrite(P.correctionsApplied, JSON.stringify({ ts: new Date().toISOString(), verdict,
        scope: correctionsScope, rows: correctionsApplied }, null, 2) + "\n");
      const by = correctionsApplied.reduce((a, r) => (a[r.outcome] = (a[r.outcome] ?? 0) + 1, a), {});
      runLog(run.runDir, { event: "corrections-applied", flags: correctionsApplied.length, outcomes: by,
        scoped: correctionsScope.scoped, named: correctionsScope.named.length,
        movedOutsideScope: correctionsScope.moved.length, unboundOrdinals: correctionsScope.unbound.length });
      // The basis for the delivery check each assembly makes (recordCorrectionsDelivered): what each flag
      // changed in the fields a report prints from the record, from the same two records. Its own file.
      try { recordCorrectionsBasis(run.runDir, correctionsApplied, preDoc, postDoc); }
      catch (e) {
        try { rmSync(driverDir(run.runDir, CORRECTIONS_DELIVERED_FILE), { force: true }); } catch { /* best-effort */ }
        note(`[corrections] the delivery basis could not be kept (${String(e?.message ?? e).slice(0, 100)}) — this pass has no delivery record`);
      }
    } catch (e) {
      // A basis from an earlier pass would be read against this pass's report as if it were this pass's.
      try { rmSync(driverDir(run.runDir, CORRECTIONS_DELIVERED_FILE), { force: true }); } catch { /* best-effort */ }
      correctionsApplied = null;
      note(`[corrections] the applied table could not be built (${String(e?.message ?? e).slice(0, 100)}) — the recheck reads both files, as before`);
      runLog(run.runDir, { event: "corrections-applied-failed", error: String(e?.message ?? e).slice(0, 160) });
    }
  }
  // T3b — NO RECHECK AFTER A ROLLBACK. The document is byte-identical to the one the reviewer just
  // read, so a recheck spends a dispatch to re-derive the verdict it already gave. The entry verdict
  // stands, which is also the fail-safe direction this block uses everywhere else.
  if (!correctiveRollback && !correctiveCycleSettled && (verdict === "CONDITIONAL" || verdict === "BLOCKING")) {
    // A1: re-check after the corrective pass with a lean follow-up on the refutation's winning key and model —
    // NOT a full re-run of the stage, and NOT the base model when another model won. The follow-up's first
    // attempt starts fresh, and it never resumes the refutation's session (no engine resumes by key). (With no
    // winning key, as on a crash-resume skip, a clean forced re-run on the same model.)
    // A1: the recheck also runs on the CONDITIONAL path (the VENZY shipping path — previously the
    // corrective output was never re-verified there) and reads the updated FINDINGS too, since the client
    // surfaces render from findings.json, not the narrative. Failure falls back to the ENTRY verdict
    // (CONDITIONAL stays CONDITIONAL; BLOCKING stays BLOCKING — the established fail-safe direction).
    const entryVerdict = verdict;
    // — the observed table rides as DATA. It never replaces the reviewer's judgement and it never
    // asserts a correction was RIGHT; it says what moved, so the reviewer argues with evidence instead
    // of with its own memory of two long documents.
    const appliedTable = correctionsApplied ? correctionsAppliedTable(correctionsApplied) : "";
    const restoredTable = restoredFindingsTable(correctiveRepair);
    // — CARRIED, not merely recorded. The first cut of this feature wrote the violations to an
    // artifact and said in its own comment that they were carried to the recheck; nothing read the
    // file, the seat holds no tool that could, and the note beside the write is stderr. An escalation
    // that reaches no reader is a log line.
    const evidenceTable = evidenceClaimTable(evidenceViolations);
    // T1 (J3): EVERY path that rewrites the review must re-demand the PLAN-EXECUTION CHECK
    // section — the validator requires it whenever the receipt exists, and the copper-spire recheck
    // rewrite dropped it (the reviewer complied with the lean followup, then failed the validator).
    const planAuditCarry = (ctx.registerPlan && existsSync(P.planExecution))
      ? `Your rewritten review MUST again contain the section titled exactly "PLAN-EXECUTION CHECK" — carry your prior section forward, updated for the corrected narrative/findings (the deterministic validator requires it whenever the plan-execution receipt exists).`
      : "";
    const recheckSeq0 = nextRefutationSeq(run.runDir);
    const reviewShaBefore = shaOf(P.seniorEyeReview);
    let reviewBefore = null;
    try { reviewBefore = readFileSync(P.seniorEyeReview, "utf8"); } catch { reviewBefore = null; }
    const rc = firstRef.key
      ? await stage("narrative-refutation", ctx, {
          force: true, sessionKey: firstRef.key, model: firstRef.model, thinking: firstRef.thinking, trigger: "verdict-recheck",
          // The record its flags and the table above number, which is the writer's own while a fold is in force: a
          // correction that saved nothing leaves the earlier pass's fold standing (record-fold.mjs).
          followup: repairFollowup("narrative-refutation:verdict-recheck", {
            narrative: P.narrative, findings: modelRecordPath(run.runDir, P.findings), seniorEyeReview: P.seniorEyeReview,
            correctionsScope, appliedTable, restoredTable, evidenceTable, planAuditCarry,
            writerExclusions: writerExclusionBlock(P, { review: "later", named: correctionsScope?.positions ?? [] }),
          }),
        })
      : await stage("narrative-refutation", ctx, { force: true, model: firstRef.model, thinking: firstRef.thinking, trigger: "verdict-recheck", ...(planAuditExtra(ctx) ? { extra: planAuditExtra(ctx) } : {}) });
    // A RECHECK COUNTS ONLY WHEN THIS DISPATCH SAVED A REVIEW. A reviewer whose every save was refused writes
    // nothing, and the stage still reads ok on the review that stands from before the correction, so its verdict and
    // its points would pass as the review of the corrected record, and the receipt would stop a resume from finishing
    // a verification nobody made. Such a recheck is a failed one: the entry verdict stands, the record says the
    // correction was not verified, no receipt is written, and the earlier review stays in place as the earlier review.
    //
    // TWO WAYS TO SAVE, BOTH COUNTED, UNDER ONE SET OF RULES. The message above orders the review file rewritten, and a
    // seat may do that or record the review through its tool; both are seen on test runs. So a save is an accepted tool
    // call made since this dispatch began, or review bytes that differ from the ones before it and that the tool's rules
    // would accept (settleRecheckSave). A refused rewrite gives way to the accepted call or to the earlier review, and
    // reads as no save. A byte-identical rewrite reads as no save, which costs only a cycle run again on a resume: the
    // same bytes carry the same verdict.
    const recheckSave = settleRecheckSave(run.runDir, { before: reviewBefore, stageOk: rc.ok === true, seq0: recheckSeq0 });
    if (recheckSave.restore != null) {
      try { atomicWrite(P.seniorEyeReview, recheckSave.restore); }
      catch (e) { note(`[corrections] the review could not be put back after the recheck (${String(e?.message ?? e).slice(0, 100)})`); }
    }
    if (recheckSave.refused) runLog(run.runDir, { event: "verdict-recheck-file-save-refused", refused: recheckSave.refused, seq0: recheckSeq0, entryVerdict });
    const recheckRead = recheckSave.read;
    if (rc.ok && !recheckRead) {
      runLog(run.runDir, { event: "verdict-recheck-unread", fail: recheckSave.fail, seq0: recheckSeq0, entryVerdict });
      note(`[corrections] the recheck after the correction recorded no review it could accept (${recheckSave.fail}) — the correction is not verified, the entry verdict (${entryVerdict}) stands, and the review in place is the one from before the correction`);
    }
    // What stands is what was decided, so a put-back that could not be written never reads a refused verdict back.
    verdict = recheckRead ? (parseVerdict(recheckSave.restore ?? readFileSync(P.seniorEyeReview, "utf8")) ?? entryVerdict) : entryVerdict;
    correctiveRecheckOk = rc.ok === true && Boolean(recheckRead);
    try {
      atomicWrite(driverDir(run.runDir, CORRECTIVE_RECHECK_FILE), JSON.stringify({ ts: new Date().toISOString(),
        status: correctiveRecheckOk ? "read" : "unread", by: recheckRead?.by ?? null, entryVerdict, verdict, seq0: recheckSeq0, seq: recheckRead?.seq ?? null,
        reviewSha: reviewShaBefore,   // the review this recheck found: earlierReviewNotRechecked tells it from any saved later
        ...(correctiveRecheckOk ? {} : { fail: rc.ok ? recheckSave.fail : String(rc.fail ?? "failed").slice(0, 160) }) }, null, 2) + "\n");
    } catch (e) { note(`[corrections] the recheck's record could not be written (${String(e?.message ?? e).slice(0, 100)}) — the run log still holds the outcome`); }
    runLog(run.runDir, { event: "verdict-2", verdict, read: correctiveRecheckOk });
    writeRunStatus(ctx, signoffPatch(verdict));
  }
  // AD-2 A1 — the completion receipt, written ONLY when the cycle finished with a verified recheck:
  // a fallen-back recheck kept the entry verdict WITHOUT re-verifying, and cementing that would stop
  // a resume from finishing the verification it still owes (so that path re-fires, exactly as today).
  // Best-effort: a failed write just means the cycle may re-fire on a resume — never worse than today.
  if (!correctiveCycleSettled && correctiveRecheckOk
      && (correctiveEntryVerdict === "CONDITIONAL" || correctiveEntryVerdict === "BLOCKING")) {
    try {
      writeFileSync(`${correctiveCyclePath}.tmp`, JSON.stringify({
        ts: new Date().toISOString(), entryVerdict: correctiveEntryVerdict, verdict, shas: correctiveCycleShas(),
      }, null, 2) + "\n");
      renameSync(`${correctiveCyclePath}.tmp`, correctiveCyclePath);
      runLog(run.runDir, { event: "corrective-cycle-receipt", entryVerdict: correctiveEntryVerdict, verdict });
    } catch (e) { note(`corrective-cycle receipt write failed (non-fatal — the cycle may re-fire on a resume): ${String(e?.message || e).slice(0, 100)}`); }
  }
  return { verdict, correctiveEntryVerdict, correctiveCycleSettled, correctiveRecheckOk };
}
