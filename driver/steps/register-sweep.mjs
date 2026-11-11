// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/register-sweep.mjs — the register and unregistered-use searches, their fan-in, and the recovery of what fell short.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { runRecordLogPath } from "../../providers/_shared/ledger-path.mjs";
import { recordSpan } from "../attributed-span.mjs";
import { recordStatusesFromFindings } from "../common-law-coverage-status.mjs";
import { GRID_HALVES, GRID_SEATS, MEANING_SEAT, balanceClosureCells, findCoverageLimitedCells, findDroppedConnotationQueries, findErroredConnotationQueries, findGridCandidateOmissions, findSimilarListingSignals, mergeCommonLawFindings, mergeGrids, partitionClosableCells } from "../common-law-receipts.mjs";
import { connotationObligations, parseDispositionForm, parsePrRiskResults, renderDispositionTable } from "../connotation-search.mjs";
import { NON_MATERIAL_AXES } from "../coverage-ledger.mjs";
import { undecidedCrossChecks, waitingCrossCheck, withoutWait } from "../cross-check-wait.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";
import { formSidecarPath, outstandingRows, unionDispositionForm } from "../disposition-union.mjs";
import { config, envGateOn } from "../driver.config.mjs";
import { registerAdapter } from "../engine/run-choices.mjs";   // the run's register adapter, from ctx.register
import { readStickyGaps, receiptSettled, settleReceipt } from "../envelope-settle.mjs";
import { note, runLog } from "../log.mjs";
import { findCollapsedBands, quarantineUnknownStates, taintQuarantineCleanBlocks } from "../named-band.mjs";
import { readPartNotCompleted } from "../parts-not-completed.mjs";
import { gridBatchFor } from "../profiles.mjs";
import { countLaneCalls } from "../provider-usage.mjs";
import { atomicWrite, driverDir, readJson } from "../run-record.mjs";
import { foldSupplementalEntries, isProviderHardErrorReason, joinPlanToBands, mintSupplementalQid, partitionFoldDirectives, romanizedTermsFromPlan, screenThenCap } from "../register-plan.mjs";
import { readRegisterTaint } from "../register-taint.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { classifyFailureReason, createRepairLedger, fanInMissingEvidence } from "../repairs.mjs";
import { validators } from "../verify.mjs";
import { closureBlocksOf } from "../web-grid.mjs";
import { readWithheldFamilies, releasedFamilyQids } from "../withheld-families.mjs";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { seedUnplannedBands } from "../register-unit-record.mjs";
import { join } from "node:path";

/**
 * Which cross-checks this pass folds into the plan, and which the receipt keeps from an earlier pass. PURE.
 *
 * A run that enters the sweep again finds the cross-checks it minted before already in the plan. The fold
 * passes over a qid the plan holds without adding or refusing it, so the screen alone keeps none of them,
 * and the receipt was rewritten with no directives: the audit, the ask count and the demotion tripwire lost
 * cross-checks that had run. A directive whose qid the plan holds is carried, as the earlier receipt
 * recorded it where it did, and counts against the cap, so a later pass mints only what the first left
 * room for. On a first pass the plan holds none, and the answer is the screen's.
 */
export function crossChecksForThisPass(plan, candidates, candDirectives, prior, cap) {
  const held = new Set((plan?.entries ?? []).map((e) => e?.qid));
  const carried = new Map();
  for (const d of [...(Array.isArray(prior?.directives) ? prior.directives : []), ...(candDirectives ?? [])])
    if (held.has(d?.qid) && !carried.has(d.qid)) carried.set(d.qid, d);
  return { ...screenThenCap(plan, candidates, Math.max(0, cap - carried.size)), carried: [...carried.values()] };
}

export async function runRegisterSweep({ P, agent, axes, ctx, job, opts, run, runCommonLaw }, helpers) {
  const { CL_SUPP_TAGS, StageFailure, connotationRemedyToken, defaultConnotationReissuer, deriveNamedBand, foldSupplementalProposals, holdStickyGapsIn, inScopeClassList, isFallbackEligible, joinOptions, mergeRegisterBands, must, noteAdapter, noteChannelCoverageAtStageExit, readPlanExecution, readRegisterBands, recordConnotationAudit, remergeIfBandsMoved, resultsPerCellOf, runBatched, runSaturationProbeCodeSide, slicesUnitNeverReached, stage, taintDisposition, taintParkJudgmentArtifacts, takeSlicesOutOfTheBand, unfinishedUnitAsItStands, writePlanExecutionReceipt } = helpers;
  // Step 2A/2B — fan-out (batched ≤ gatherConcurrency) then the code-side fan-in barrier.
  // Property 1 (frame-omission design): the BLIND re-derivation runs as a sibling of the WHOLE gather,
  // not as a gather member — it reads only the raw instruction (no tool calls), so under the turn cap it
  // slots in as a gather unit frees and finishes inside the slowest gather member's wall (≈ zero added
  // critical-path latency). NON-FATAL: a flake notes-and-skips (frame-diff then sees no blind model and
  // is skipped) and never rejects the Promise.all that carries the $40 gather.
  // A1 SPLIT: when armed (ctx.clHalfTerms — flag on + dictated spec + ≥2 terms + not a pre-split
  // resume), the single common-law member becomes TWO concurrent half-grid members (the half id rides
  // the member's axis field, exactly like a register unit's axis). Flag off / self-disarmed keeps the
  // original single-member assembly VERBATIM below — that branch IS the rollback path.
  const clSplit = Boolean(ctx.clHalfTerms);
  // — RECORD THE CHOICE, HERE, where both paths converge. Not inside deriveGridSpec's arming
  // block: that block does not execute at all on the spec-less path, which is exactly the path the
  // 2026-08-11 codex R2 run took, and a record that only exists when the split arms cannot explain a
  // run that did not split. `decided` is derived from ctx.clHalfTerms — the same value the assembly
  // below branches on — so the file can never disagree with what the run actually did.
  {
    const d = ctx.clSplitDecision ?? { path: "unsplit", reason: "not-recorded", detail: "deriveGridSpec did not run on this path", flag: null, terms: null };
    // The recorded reason and the assembly are derived from DIFFERENT things — the reason from which
    // branch of deriveGridSpec ran, the path from ctx.clHalfTerms. A disagreement means the record is
    // explaining a path the run did not take, which is worse than no record at all: it is a confident
    // wrong answer to the exact question was opened to answer. Never silent.
    const agrees = (d.path === "split") === clSplit;
    const decision = { ...d, path: clSplit ? "split" : "unsplit",
      members: clSplit ? GRID_SEATS.map((h) => `common-law-half:${h}`) : (runCommonLaw ? ["common-law"] : []),
      ...(agrees ? {} : { reason: "selector-record-disagreement", recorded_reason: d.reason,
        detail: `the run assembled the ${clSplit ? "split" : "unsplit"} path but deriveGridSpec recorded "${d.reason}" (${d.path}) — the selector and its record have diverged and the recorded reason cannot be trusted` }) };
    atomicWrite(P.commonLawPath, JSON.stringify(decision, null, 2) + "\n");
    runLog(run.runDir, { event: "common-law-path", path: decision.path, reason: decision.reason, terms: decision.terms, ...(agrees ? {} : { disagreement: true, recorded_reason: d.reason }) });
    note(`common-law path: ${decision.path} — ${decision.detail}`);
    // (3) — AND THEN STOP. A disagreement was recorded and the run carried on, which left the
    // one artifact opened to answer "which path did this take" saying, in effect, "I do not know" —
    // while every downstream common-law count was assembled anyway and delivered as if it did.
    //
    // ORDER IS THE WHOLE POINT: the write, the journal row and the note all run FIRST. A throw above
    // them would kill the run with nothing on disk to diagnose from, which is the failure mode this
    // record exists to prevent, arriving through the guard meant to enforce it.
    //
    // THIS CANNOT FIRE ON ANY PATH THE ENGINE HAS TODAY, and that is stated rather than glossed: both
    // sides of `agrees` descend from the single deriveGridSpec(ctx) call ~30 lines above — every arm
    // that records path "split" also sets ctx.clHalfTerms, and every arm that does not, does not — so
    // they cannot disagree. The `?? { reason: "not-recorded" }` default has no live producer either
    // (the only other ctx builder, reconstructCtx, feeds repairStale and the --experiment rig, and
    // neither reaches this line). It buys a tripwire for the refactor that splits those two
    // derivations, and nothing before then. Deterministic: a re-sample re-derives the identical
    // divergence, so the retry ladder has nothing to offer it.
    if (!agrees) throw new StageFailure("grid-spec",
      `the run assembled the ${clSplit ? "split" : "unsplit"} path but deriveGridSpec recorded "${d.reason}" (${d.path}) — the selector and its record have diverged, so no downstream common-law count can be trusted`,
      undefined, { failClass: "deterministic" });
  }
  const gather = clSplit
    ? [...GRID_SEATS.map((h) => ({ name: "common-law-half", axis: h })), ...axes.map((a) => ({ name: "register-unit", axis: a }))]
    : [...(runCommonLaw ? [{ name: "common-law" }] : []), ...axes.map((a) => ({ name: "register-unit", axis: a }))];
  // The common-law member's result, BY NAME. It was read as gatherResults[0] in four places, which was
  // only ever correct because the member is built first and always present — drop it for a register-only
  // run and [0] silently becomes a register unit, and the grid-ledger pass below would then send a
  // grid-ledger save followup addressed to the common-law session into it rather than skip (its guard is
  // gridVariants × !skipped × no-ledger, and gridVariants comes from the manifest either way).
  const clIndex = gather.findIndex((g) => g.name === "common-law");
  const clMember = () => (clIndex >= 0 ? gatherResults[clIndex] : null);
  // The plan-direct executor, resolved ONCE for the code-side saturation-probe unit here AND the
  // fan-in repair kit below (same precedence: injected test executor > provider lane > null when
  // dispatch is off / the provider has no adapter). See runSaturationProbeCodeSide for why the
  // saturation-probe member bypasses the agent whenever this lane and a frozen plan exist — the
  // agent member below stays the verbatim fallback (and the mock harness's default path).
  // CLEAROTRON_PLAN_DISPATCH is a default-ON gate. It used to test `!== "off"` alone, so the `=0` idiom
  // that governance documents for it — and that every sibling gate on that line honours — left the
  // lane fully ARMED. envGateOn accepts both spellings rather than switching to a bare `!== "0"`:
  // deployments and 15 test files already say "off", and breaking that would arm dispatch silently,
  // which is the same bug in the other direction.
  const planExec = opts.planExecutor
    ?? (envGateOn("CLEAROTRON_PLAN_DISPATCH") && registerAdapter(ctx.register).executePlan
      ? (args, c) => noteAdapter(c ?? ctx, registerAdapter(ctx.register)).executePlan(args, c) : null);
  // Kill switch CLEAROTRON_SATPROBE_CODESIDE=0 (the inline `!== "0"` pattern): legacy mock harnesses
  // opt out — their scenarios pre-date the code-side member and script the AGENT path (and an armed
  // real executor lane would dial the provider from a test). Production default is ON.
  const satProbeCodeSide = process.env.CLEAROTRON_SATPROBE_CODESIDE !== "0" && Boolean(planExec && ctx.registerPlan);
  // An axis the frozen plan gives no work gets the honest empty band before its model unit runs (register-unit-record.mjs).
  // The code-side saturation probe writes its own.
  if (ctx.registerPlan) {
    const seeded = seedUnplannedBands(P.runDir, ctx.registerPlan, axes.filter((a) => !(a === "saturation-probe" && satProbeCodeSide)));
    if (seeded.length) runLog(run.runDir, { event: "unit-band-seeded-empty", axes: seeded });
  }
  // The units this run records as unfinished are taken as their bands stand (unfinishedUnitAsItStands, above).
  const unfinishedUnits = new Set(readPartNotCompleted(run.runDir, "searches")?.unfinished_units ?? []);
  const [gatherResults, blindRes] = await Promise.all([
    runBatched(gather, config.gatherConcurrency, (g) =>
      g.name === "register-unit" && unfinishedUnits.has(g.axis)
        ? unfinishedUnitAsItStands({ ...ctx, axis: g.axis })
        : g.name === "register-unit" && g.axis === "saturation-probe" && satProbeCodeSide
        ? runSaturationProbeCodeSide({ ...ctx, axis: g.axis }, planExec)
        : stage(g.name, { ...ctx, axis: g.axis })),
    stage("blind-frame", ctx).catch((e) => ({ ok: false, fail: String(e?.message ?? e) })),
  ]);
  if (!clSplit && clMember()?.ok) recordStatusesFromFindings(P.commonLaw); if (!blindRes.ok) {
    note(`blind-frame failed (non-fatal — no frame-diff/reopen this run): ${blindRes.fail}`);
    runLog(run.runDir, { event: "blind-frame-skipped", reason: blindRes.fail });
  }
  // T1 (J1c) — terminal quarantine BEFORE the must barrier: after the stage's own retry
  // ladder (which now carries a warm re-emit demand naming the fix), a run must never die on a
  // model-authored VOCABULARY miss in the band. The driver repairs the band in code (qid-less
  // unknown-state blocks → honest `incomplete` descriptors judgment reads like any crowd), then
  // re-judges with the SAME stage validator; on a pass the member is recovered. A qid-stamped
  // unknown state (tool bug) or any other defect falls through to must() unchanged.
  for (let i = 0; i < gather.length; i++) {
    const g = gather[i], r = gatherResults[i];
    // register units only — under the A1 split the common-law halves ALSO carry an axis (the half id),
    // and their quarantine lane is the dedicated half fan-in below, never the register band repair.
    if (g.name !== "register-unit" || r?.ok || !/named_band_state_invalid/.test(String(r?.fail ?? ""))) continue;
    const bandPath = P.registerBand(g.axis);
    try {
      const { blocks, quarantined } = quarantineUnknownStates(readFileSync(bandPath, "utf8"));
      if (!quarantined.length) continue;   // not a qid-less vocabulary miss — fail as before
      writeFileSync(`${bandPath}.tmp`, JSON.stringify(blocks, null, 2) + "\n");
      renameSync(`${bandPath}.tmp`, bandPath);
      const v = validators.registerUnit(P.registerUnit(g.axis), readFileSync(P.registerUnit(g.axis), "utf8"));
      if (!v.ok) { note(`register-unit ${g.axis}: band still invalid after quarantine (${v.reason}) — failing as before`); continue; }
      runLog(run.runDir, { event: "named-band-state-quarantined", axis: g.axis, states: quarantined.map((q) => q.state), queries: quarantined.map((q) => q.query.slice(0, 60)) });
      note(`register-unit ${g.axis}: quarantined ${quarantined.length} unknown-state judgment block(s) → incomplete descriptors (recovered; judgment weighs the descriptors)`);
      gatherResults[i] = { ...r, ok: true, fail: null, bandQuarantined: true };
    } catch (e) {
      note(`register-unit ${g.axis}: band quarantine not applicable (${String(e.message).slice(0, 100)}) — failing as before`);
    }
  }
  // ── A1 split fan-in step 1: half-failure quarantine (mirrors the band-quarantine above) ──────────
  // ONE half failing on TRANSIENT INFRASTRUCTURE (isFallbackEligible — its retry ladder already ran
  // out) must not kill the gather the other half completed: the merge below records every cell the
  // failed half owned as an HONEST GAP against the FULL spec — never a thinner-but-valid ledger, every
  // dictated cell stays accounted — and those gaps ride the existing coverage-closure pass (the error
  // text deliberately reads non-mechanical, so they partition CLOSABLE and get the in-loop close
  // attempt; whatever survives ships as the attempted-and-unreachable disclosure). CELLS only: the
  // half's dictated CONNOTATION queries have no gap vocabulary, so the merge gate below runs a
  // per-query identity join and fails TRANSIENT when any are unrecorded — a quarantine survives to
  // the closure pass only when the failed half's meaning receipts made it into its ledger. A CONTENT failure
  // (validator reject — e.g. a dropped dictated cell) and a both-halves failure fall through to must()
  // unchanged: those are quality gates, and quarantining them would be the false-clean disease.
  const clHalves = clSplit ? Object.fromEntries(GRID_SEATS.map((h, i) => {
    const r = gatherResults[i];
    return [h, { i, ok: !!r?.ok, skipped: !!r?.skipped, sessionKey: r?.sessionKey, fail: r?.fail ?? null, quarantined: false }];
  })) : null;
  if (clSplit) {
    const failed = GRID_SEATS.filter((h) => !clHalves[h].ok);
    if (failed.length === 1 && isFallbackEligible(clHalves[failed[0]].fail)) {
      const h = failed[0];
      clHalves[h].quarantined = true;
      gatherResults[clHalves[h].i] = { ...gatherResults[clHalves[h].i], ok: true, fail: null, clHalfQuarantined: true };
      note(`common-law-half:${h} failed on transient infrastructure (${clHalves[h].fail}) — quarantined: its cells merge as honest gaps and ride the coverage-closure pass`);
      runLog(run.runDir, { event: "common-law-half-quarantined", half: h, fail: String(clHalves[h].fail).slice(0, 140) });
    }
  }
  // The engine's own re-issue, spent at most once per run — the bound spans BOTH the half-stage
  // hook below and the merge gate's disclosure, so a run never buys the same search twice.
  let clConnotationReissueSpent = false;
  // ── THE MEANING HALF FELL SHORT BY A SEARCH OR TWO: RE-ISSUE, THEN DELIVER ───────────────────
  //
  // This is where the clearance actually died. The half's own validator refuses when a dictated
  // meaning search is missing from its receipts, and every attempt refused identically — eight of
  // them — so the run was thrown away with fifty-nine of sixty searches done and recorded.
  //
  // Quarantine above cannot help here: that is for a half that failed wholesale on transient
  // infrastructure, where re-running the half converges. This half SUCCEEDED at almost everything.
  // So the engine re-issues the missing searches itself, through the same provider, and re-judges the
  // half on its own artifact. If they landed, the half is simply valid and nothing is disclosed.
  //
  // If they did not, the half is accepted WITH THE SHORTFALL RECORDED — an honest gap per unfinished
  // search, carrying its term, which the merge gate then discloses and the coverage row reads. That is
  // the owner's ruling of 2026-09-17 and it is not the false-clean the gates guard: false-clean is
  // silence, and this says on the client's own page which search did not complete.
  if (clSplit && !clHalves[MEANING_SEAT].ok && /connotation_query_unrecorded/.test(String(clHalves[MEANING_SEAT].fail ?? ""))) {
    const h = MEANING_SEAT;
    let short = [];
    try {
      const spec = readJson(P.gridSpecHalf(h));
      const halfLedger = readJson(P.commonLawGridHalf(h));
      short = findDroppedConnotationQueries(spec, halfLedger);
      if (short.length) {
        runLog(run.runDir, { event: "connotation-reissue", half: h, count: short.length });
        note(`the meaning half recorded all but ${short.length} of its dictated searches — the engine re-issues `
          + `${short.length === 1 ? "it" : "them"} itself rather than asking for the sweep again`);
        clConnotationReissueSpent = true;
        const reissuer = opts.connotationReissuer ?? defaultConnotationReissuer;
        const r = await reissuer(short, { spec, rawPath: driverDir(run.runDir, "web-results", `connotation-reissue-${h}-${Date.now()}.json`) });
        runLog(run.runDir, { event: "connotation-reissue-result", ok: !!r?.ok,
          recovered: Array.isArray(r?.rows) ? r.rows.length : 0,
          cause: r?.ok ? null : String(r?.cause ?? "").slice(0, 160) });
        const rows = (r?.ok && Array.isArray(r.rows)) ? r.rows : [];
        halfLedger.extras = halfLedger.extras ?? {};
        halfLedger.extras.pr_risk = [...(Array.isArray(halfLedger.extras.pr_risk) ? halfLedger.extras.pr_risk : []), ...rows];
        const stillShort = findDroppedConnotationQueries(spec, halfLedger);
        if (stillShort.length) {
          halfLedger.gaps = Array.isArray(halfLedger.gaps) ? halfLedger.gaps : [];
          for (const q of stillShort)
            halfLedger.gaps.push({ term: q, platform: "connotation",
              error: "the search did not complete after a re-ask and a re-issue by the engine" });
          runLog(run.runDir, { event: "connotation-unfinished-disclosed", count: stillShort.length, half: h });
          note(`${stillShort.length} dictated meaning quer${stillShort.length === 1 ? "y" : "ies"} did not complete — `
            + "recorded as honest gaps and DISCLOSED on the coverage row; the run delivers the rest");
        }
        atomicWrite(P.commonLawGridHalf(h), JSON.stringify(halfLedger, null, 2) + "\n");
        // The half is accepted on its re-judged artifact. Same shape as quarantine above: the stage is
        // not re-run and the model is not asked again.
        clHalves[h].ok = true;
        gatherResults[clHalves[h].i] = { ...gatherResults[clHalves[h].i], ok: true, fail: null, clHalfShortfall: stillShort.length };
      }
    } catch (err) {
      runLog(run.runDir, { event: "connotation-reissue-failed", error: String(err?.message ?? err).slice(0, 160) });
    }
  }
  // A REGISTER UNIT THAT WROTE NO RESULT is the searches not completed, after every other member has been held to its
  // own failure as before (unfinishedUnitAsItStands, above). A rate limit keeps its own path.
  const unfinished = gather.map((g, i) => i).filter((i) => gather[i].name === "register-unit" && gather[i].axis
    && !gatherResults[i]?.ok && !gatherResults[i]?.resetsAt && !existsSync(P.registerUnit(gather[i].axis)));
  gather.forEach((g, i) => { if (!unfinished.includes(i)) must(gatherResults[i], g.name + (g.axis ? `:${g.axis}` : "")); });
  if (unfinished.length) {
    const axesOut = unfinished.map((i) => gather[i].axis), first = gatherResults[unfinished[0]];
    throw Object.assign(new StageFailure(`register-unit:${axesOut[0]}`, first?.fail ?? "failed", undefined, { quantity: first?.quantity }),
      { notCompletedPart: "searches", unfinishedUnits: axesOut,
        excludedSlices: axesOut.flatMap((a) => slicesUnitNeverReached(P, ctx.registerPlan, a)) });
  }
  // winning session key per axis → a later escalation resumes the EXACT key the unit succeeded on.
  // (register units only — a common-law half's axis is its half id, tracked in clHalves, never here.)
  const unitKey = {};
  gather.forEach((g, i) => { if (g.name === "register-unit" && g.axis) unitKey[g.axis] = gatherResults[i].sessionKey; });

  // ── A1 split fan-in step 2: merge the half artifacts into the canonical pair ─────────────────────
  // The two plugin-written half ledgers merge in CODE (mergeGrids — cells union by term|platform, gaps
  // recomputed against the FULL canonical spec, extras.pr_risk concat+dedup) into the ONE canonical
  // common-law-grid.json, and the half findings concatenate into the ONE canonical common-law-
  // findings.md, so EVERYTHING downstream (fan-in barrier, receipts/connotation gates, closure,
  // synthesis, replay) reads exactly the artifacts a single-member run would have written. Re-run after
  // every routed half followup (closure / frame-reopen) — the half files stay the source of truth and
  // the canonical pair is always derived, which also makes the merge resume-idempotent.
  const mergeCommonLawArtifacts = !clSplit ? null : ({ discloseUnfinished = false } = {}) => { for (const h of GRID_HALVES) recordStatusesFromFindings(P.commonLawHalf(h), { half: h });   // each half's ledger statuses, recorded by code where the seat made no call (ruling 2026-10-01)
    // Each half's coverage truth = its plugin-written main ledger FOLDED with any plugin-written
    // supplementary sibling(s) the closure lane produced. Returns the batches as an ARRAY (mergeGrids'
    // batchesOf flattens it, cells union across all of them); a missing/corrupt main leaves its cells to
    // re-derive as gaps exactly as before. The supplementary siblings are existsSync-guarded so the
    // FAN-IN merge (which runs BEFORE any supplementary exists) never throws (caveat 2). Only the plugin
    // writes these files — never an agent — so a parse here is defensive, not a live failure mode.
    const readHalfLedger = (h) => {
      const batches = [];
      try { batches.push(readJson(P.commonLawGridHalf(h))); } catch { /* main missing/corrupt → its cells re-derive as gaps */ }
      for (const tag of CL_SUPP_TAGS) {
        const sp = P.commonLawGridSupp(h, tag);
        if (existsSync(sp)) { try { batches.push(readJson(sp)); } catch { /* a corrupt supp sibling contributes nothing; its cells stay gaps */ } }
      }
      return batches.length ? batches : null;
    };
    // GRID halves only: halfErrors attributes uncovered CELLS to the seat that owed them, and gaps are
    // term x platform. The meaning seat owns no terms, so it can never be the owner of a gap — a
    // quarantined meaning seat surfaces through the per-query identity join below instead, which is the
    // gate that can actually see a missing meaning receipt.
    const halfErrors = Object.fromEntries(GRID_HALVES.filter((h) => clHalves[h].quarantined)
      .map((h) => [h, `half-${h} gather member did not complete: ${String(clHalves[h].fail).slice(0, 120)}`]));
    const fullSpec = readJson(ctx.gridSpecPath);
    // — three seats, two merges. mergeGrids returns the same {cells, extras, gaps} shape its
    // batchesOf() accepts, so the meaning seat folds in by chaining rather than by widening a signature
    // the guards are written against. It contributes no cells and no gaps — only its
    // extras.pr_risk, which after this change IS the merged meaning receipt set, because both grid
    // halves carry zero queries and the plugin's own hasConn gate writes them none.
    const mergedGrid = mergeGrids(
      mergeGrids(readHalfLedger("a"), readHalfLedger("b"), { spec: fullSpec, halfErrors }),
      readHalfLedger(MEANING_SEAT), { spec: fullSpec, halfErrors });
    atomicWrite(P.commonLawGrid, JSON.stringify(mergedGrid, null, 2) + "\n");   // B5 — the canonical ledger is never seen torn
    // part 2 — the grid is on disk and the spec has been since dispatch, so plan-vs-executed is
    // answerable HERE, roughly two hours before publish derives it. Reported, never gated.
    noteChannelCoverageAtStageExit(P, mergedGrid);
    // ── — CARRY THE STRUCTURED DISPOSITIONS THROUGH THE MERGE, AND RENDER THE PROSE FROM THEM ──
    // Only CONNOTATION_HALF owns meaning queries, so in practice one half writes this file — but the
    // union is over BOTH, because keying the merge on which half is supposed to own it is exactly the
    // invariant that breaks silently when CONNOTATION_HALF is flipped (its own doc block calls that a
    // wall-clock choice, correctness-neutral — it must stay one).
    //
    // Not carrying it is the shape: both halves pass, the canonical gate re-runs the PROSE join
    // over a document whose dispositions live in structure, and the merge fails a run that was correct.
    // — THE CANONICAL FORM IS THE UNION OF THE HALVES', OVER THE MERGED OBLIGATION SET. The rows
    // are regenerated from the MERGED ledger, so the canonical form carries exactly what the canonical
    // validator will judge — including any recurrence receipt that clears the floor only once both
    // halves' queries are counted (the superadditive case CONNOTATION_HALF exists to make impossible,
    // and which this would surface honestly rather than silently drop).
    const mergedOb = connotationObligations(parsePrRiskResults(JSON.stringify(mergedGrid)));
    const halfRows = [];
    for (const h of GRID_SEATS) {
      // B — the halves' rulings live in their ACCUMULATORS in `_driver/` (the tool's one copy); the
      // seat-facing mirrors died with the form path and are written by nobody.
      const dp = formSidecarPath(P.commonLawDispositionsHalf(h));
      if (!existsSync(dp)) continue;
      try { halfRows.push(...(parseDispositionForm(readFileSync(dp, "utf8")).rows ?? [])); }
      catch { /* a half's unreadable form leaves its obligations undischarged — a finding, never a silent pass */ }
    }
    // Both halves, never only CONNOTATION_HALF: keying the merge on which half is SUPPOSED to own the
    // sweep is exactly the invariant that breaks silently when that constant is flipped, and its own
    // doc block calls the flip correctness-neutral. It must stay one.
    // — THE HALVES ARRIVE THROUGH THE PRIOR CHANNEL, NOT THE SEAT ONE, AND THE PARK IS WHY.
    //
    // This used to be `({ rows: [] }, { rows: halfRows }, …)`: empty prior, halves fed as the seat's
    // submission. It cost a clearance. `unionDispositionForm` reconstructs a park from exactly two
    // places — `s.obstacle`, a LIVE submission field that is deliberately never persisted into a form,
    // or `p.parked` from the prior. Handed a persisted form on the seat side with an empty prior, both
    // miss, and the else branch clears `parked`, `parked_kind`, `parked_reason` and `parked_refusals`.
    // A row the seat had correctly declared unquotable arrived at the canonical validator as a ruled
    // row still owing a quote, `isRuled` refused it, and the run died deterministic with no recovery.
    // Any park erases this way, not only the declared kind — an exhausted park at the bound vanished
    // identically from the day the park shipped.
    //
    // NOT FIXED BY READING `s.parked`, and that is the binding constraint rather than a preference: the
    // seat must not be able to park a row by asserting it in a submission. Every widening of what the
    // seat side may set is a widening of what a model can claim about its own work.
    //
    // The prior channel is the TRUSTED one and already carries everything needed. Half forms are
    // driver-written, `seatFields(p, row)` carries their rulings by the same `pOk` path, and
    // syncDispositionForm() in gateway.mjs already unions this exact shape — prior-only, `{ rows: null }` submitted — on
    // every attempt. So this is that mode, not a new one.
    //
    // ONE METRIC MOVES, deliberately: with no submission, `carried` counts every ruled row, because
    // "rows this attempt's own submission would not have carried" is all of them when there is no
    // submission. Same at the gateway call, for the same reason.
    const merged = mergedOb.queries.length
      ? unionDispositionForm({ rows: halfRows }, { rows: null }, mergedOb, { generatedFrom: "common-law-grid.json" })
      : null;
    if (merged) {
      const json = JSON.stringify(merged.form, null, 2) + "\n";
      // ONE copy: the canonical ACCUMULATOR in `_driver/`. The canonical validator reads exactly this —
      // it is the era stamp the arm keys on, and the copy no seat can delete. The seat-facing mirror
      // (and the preserve-the-submission write that guarded it) died with the form path: no seat ever
      // writes at the canonical dispositions path, so there is no submission to preserve and no second
      // copy to keep in step.
      atomicWrite(formSidecarPath(P.commonLawDispositions), json);
    }
    // The rendered table is DRIVER-RENDERED from the form, with the receipt titles and URLs taken
    // from the tool-written ledger — so the document gains a complete table that no model had to
    // transcribe, and the seats' own narrative and Findings ride through the concatenation untouched.
    const dispositionTable = merged ? renderDispositionTable(merged.form.rows, mergedOb) : "";
    atomicWrite(P.commonLaw, mergeCommonLawFindings(GRID_SEATS.map((h) => ({
      half: h,
      content: existsSync(P.commonLawHalf(h)) ? readFileSync(P.commonLawHalf(h), "utf8") : null,
      error: halfErrors[h] ?? null,
    }))) + (dispositionTable ? `\n${dispositionTable}` : ""));
    runLog(run.runDir, { event: "common-law-merged", cells: mergedGrid.cells.length, gaps: mergedGrid.gaps.length,
      pr_risk: Array.isArray(mergedGrid.extras?.pr_risk) ? mergedGrid.extras.pr_risk.length : 0 });
    // CONVERGE (2026-07-13): the SAME canonical gate runs on EVERY re-merge — the fan-in below AND the
    // reopen/closure supplementary re-merges (which used to re-derive the canonical pair with NO
    // connotation re-check, laundering a supplementary fold past the gate the fan-in enforces). Reusing
    // the fan-in gate here (never a new cycle) guarantees a re-merge can never ship a merged pair the
    // unsplit path would have rejected.
    // The canonical validator over the MERGED artifacts is the same gate a single-member run passes at
    // its stage boundary (full-spec exact join, platform identity, the connotation receipt) — run it in
    // code so the split can never ship a merged pair the unsplit path would have rejected.
    const anyQuarantined = GRID_SEATS.some((h) => clHalves[h].quarantined);
    const v = validators.commonLaw(P.commonLaw, readFileSync(P.commonLaw, "utf8"));
    // — THE CLASS IS DERIVED FROM WHAT THE VALIDATOR SAID, AND IT USED TO BE DECIDED BEFORE IT
    // SPOKE. This was `anyQuarantined ? "transient" : "deterministic"`, computed two lines ABOVE the
    // call, so `v.reason` never reached the classification and EVERY unquarantined merge failure was
    // deterministic — parkBudget 0, no recovery — whatever had actually gone wrong. Two of two
    // clearances died that way in one round, and the proof the class was wrong came from production:
    // `connotation_call_partial` RECOVERED at a half hours earlier on the same engine family and
    // killed a run at the merge, same token, because only one of the two paths asks.
    //
    // Quarantine stays an input and keeps its own answer: a quarantined half is re-run fresh by the
    // park loop, which is a fact about the RUN and not about the reason. Everything else goes through
    // the same router the rest of the engine uses, so the merge stops being the one seat that answers
    // from its own state.
    //
    // Most validator reasons land on `unknown` — the regexes name weather and defects, not validator
    // tokens — which is ONE park, not a free retry loop, and the same treatment the dropped-query
    // branch below already gives an explained failure. A genuine dead end still terminates; it does so
    // after one dictated repair instead of before it.
    const clFailClass = anyQuarantined ? "transient" : classifyFailureReason(v.reason);
    // — the sentence and the payload are separate fields. `quantity` is stamped from the
    // validator's own count, because taking the census out of the message would otherwise blind the
    // convergence ledger (see StageFailure's `detail`).
    if (!v.ok) throw new StageFailure("common-law", "merged half-grids failed the canonical validator", undefined,
      { failClass: clFailClass, detail: v.reason, quantity: v.quantity });
    // CONNOTATION completeness — the validator above cannot carry this under the split: its
    // connotation gate is COUNT-based (any one recorded query passes it), so a quarantined half's
    // dictated meaning queries would vanish silently — never re-routed, nowhere disclosed — while the
    // surviving half's receipts keep the count positive: the exact gang-slang-near-miss false-clean
    // class the gate exists to prevent. The per-query identity join closes that hole: every dictated
    // query must be recorded in the merged extras.pr_risk[], or the merge gate fails.
    //
    // (The previous note here said a dropped query is "never a gap row (gaps are term×platform only)".
    // That is not true and it was the stated justification for the failClass below: mergeGrids' non-spec
    // union branch re-adds any gap whose platform is not in the spec, so an honestly-thrown connotation
    // query DOES arrive as `{ term: <query>, platform: "connotation", error }`. We were discarding the
    // one signal that distinguishes weather from a defect.)
    //
    // HOW MANY ATTEMPTS THE FAILURE GETS, and why it is not one number:
    //   quarantined half   → transient  — the park loop re-runs that half fresh, the surviving half's
    //                                     artifacts are kept, and the re-merge converges.
    //   both halves ok, query THREW and said so
    //                      → unknown    — one park. Most likely one web request failing inside a plugin
    //                                     that otherwise completed; worth exactly one retry. If it throws
    //                                     again the run still dies, which is correct.
    //   both halves ok, query VANISHED  → deterministic — no receipt, no gap row, nothing: the plugin's
    //                                     own per-query contract was not honoured. Retrying a defect
    //                                     buys nothing, and this is the original reasoning, intact.
    //
    // What does NOT change: an errored query still FAILS this gate. A meaning check that did not
    // complete cannot back a clean reputational read, and counting it as searched to keep the run alive
    // would launder a real hole into a clean receipt — a worse defect than the one being fixed. The old
    // behaviour was zero retries after full spend, with a re-run that failed identically; the new
    // behaviour is one retry, then the same honest death.
    const dropped = findDroppedConnotationQueries(fullSpec, mergedGrid);
    if (dropped.length && discloseUnfinished) {
      // ── THE LAST STEP OF THE OWNER'S RULING: a run that completed 59 of 60 dictated searches
      // DELIVERS, and says on the client's own page that it was partial and for which term.
      //
      // This is NOT the false-clean the note below guards against, and the difference is the whole
      // reason it is allowed here. False-clean is SILENCE — a hole counted as searched, nobody able to
      // see what was not done. This records each unfinished query as an honest gap carrying its own
      // term, which is the vocabulary the note above says dictated queries did not have, and that gap
      // is what the coverage row reads. A reader is told the investigation was partial and which term
      // did not complete.
      //
      // It is reached ONLY after the bounded attempts are spent: the model's single routed remedy and
      // the engine's own re-issue of the search. On the first pass this branch does not exist — the
      // gate throws exactly as before and the park loop gets its retries. Disclosure is the last
      // resort, never the first answer.
      const errored = findErroredConnotationQueries(fullSpec, mergedGrid);
      const explained = new Set(errored.map((e) => e.query));
      const gaps = Array.isArray(mergedGrid.gaps) ? mergedGrid.gaps : (mergedGrid.gaps = []);
      for (const q of dropped) {
        if (explained.has(q)) continue;          // the provider already said why; its row stands
        gaps.push({ term: q, platform: "connotation",
          error: "the search did not complete after a re-ask and a re-issue by the engine" });
      }
      // THE CANONICAL LEDGER IS WRITTEN ABOVE, BEFORE THIS GATE RUNS, so mutating the merged object
      // here reaches nothing: the report reads the file. Re-write it with the gaps in place, or the
      // disclosure exists only in memory and the coverage row has nothing to read — which is the
      // silent half of the very defect this branch exists to prevent.
      atomicWrite(P.commonLawGrid, JSON.stringify(mergedGrid, null, 2) + "\n");
      runLog(run.runDir, { event: "connotation-unfinished-disclosed", count: dropped.length,
        explained: errored.length, terms: dropped.length });
      note(`${dropped.length} dictated meaning quer${dropped.length === 1 ? "y" : "ies"} did not complete after `
        + "the bounded attempts — recorded as honest gaps and DISCLOSED on the coverage row; the run delivers");
      return { mergedGrid, fullSpec, connotationUnfinished: dropped.slice() };
    }
    if (dropped.length) {
      const errored = findErroredConnotationQueries(fullSpec, mergedGrid);
      const allExplained = errored.length === dropped.length;
      const dropClass = anyQuarantined ? clFailClass : (allExplained ? "unknown" : "deterministic");
      const detail = allExplained
        ? `threw and were recorded as gaps (${errored.map((e) => `${e.query}: ${e.error}`).join("; ").slice(0, 160)})`
        : `never executed, and a count-based connotation gate cannot see it (${dropped.join("; ").slice(0, 160)})`;
      // — same split: the count is part of the sentence (a reader can act on "3 queries"), the
      // queries themselves are the payload. `quantity` is the drop count, which is what converges.
      throw new StageFailure("common-law",
        `merged half-grids dropped ${dropped.length} dictated connotation quer${dropped.length === 1 ? "y" : "ies"}`,
        undefined, { failClass: dropClass, detail, quantity: dropped.length });
    }
    return { mergedGrid, fullSpec };
  };
  // ── P2-C (§8b leg 2) — the merge-gate connotation failure gets ONE routed model turn before it may
  // be terminal (2026-07-31 review round). With both halves completed (no quarantine), a merged doc
  // failing connotation_no_ruling / connotation_form_damaged is a DOC defect — a clean bottom
  // line in one half over receipts recorded in a half that never wrote its rows — at seats whose warm
  // sessions are still open. mergeCommonLawArtifacts throws it failClass "deterministic", and
  // decideRecovery gives deterministic failures parkBudget 0 ("never parked at all"), so without this
  // channel the FIRST such run dies .failed at the merge after a full paid gather while gateway.mjs's
  // connotation correction hints are never shown to any model. Remedy: route a followup to each usable
  // half whose OWN recorded receipts are among the violations (the routed-half-followup channel — the
  // closure/frame-reopen precedent), carrying the exact correction hint; each half's re-emit is
  // re-judged by validators.commonLawHalf, then ONE re-merge decides. Bounded to a single remedy round
  // per run — a re-merge that still fails throws the same honest death (the original reasoning stands:
  // retrying a defect buys nothing; this is one dictated repair, not a retry). Quarantined-half shapes
  // keep their transient park path untouched (the remedy never runs for them).
  let clConnotationRemedySpent = false;
  /**
   * THE ENGINE'S OWN ATTEMPT, THEN DELIVERY WITH THE GAP DISCLOSED.
   *
   * Reached only after the model has had its single routed repair turn. The engine re-issues the
   * missing searches itself through the same provider, appends whatever comes back to the half's own
   * ledger, and re-merges. If the searches are there now, the run is simply clean and nothing is
   * disclosed. If they are still missing, the run DELIVERS and the coverage row says the investigation
   * was partial and which term did not complete.
   *
   * A clearance that completed 59 of 60 dictated searches used to throw the whole report away. The
   * failure it is replacing is not a quality gate doing its job: the work was done, one search of
   * sixty did not land, and the client lost everything including the 59.
   */
  const reissueThenDisclose = async (e) => {
    if (!clConnotationReissueSpent) {
      clConnotationReissueSpent = true;
      let missing = [];
      try {
        const spec = readJson(P.gridSpecHalf(MEANING_SEAT));
        const merged = readJson(P.commonLawGrid);
        missing = findDroppedConnotationQueries(spec, merged);
        if (missing.length) {
          runLog(run.runDir, { event: "connotation-reissue", count: missing.length });
          note(`${missing.length} dictated meaning quer${missing.length === 1 ? "y" : "ies"} missing after the `
            + "model's one repair turn — the engine re-issues them itself through the same tool");
          const reissuer = opts.connotationReissuer ?? defaultConnotationReissuer;
          const r = await reissuer(missing, { spec, rawPath: driverDir(run.runDir, "web-results", `connotation-reissue-${Date.now()}.json`) });
          runLog(run.runDir, { event: "connotation-reissue-result", ok: !!r?.ok,
            recovered: Array.isArray(r?.rows) ? r.rows.length : 0,
            cause: r?.ok ? null : String(r?.cause ?? "").slice(0, 160) });
          if (r?.ok && r.rows?.length) {
            // Append into the half's OWN ledger, so the ordinary re-merge picks them up and nothing
            // downstream needs to know this call happened.
            const half = readJson(P.commonLawGridHalf(MEANING_SEAT));
            half.extras = half.extras ?? {};
            half.extras.pr_risk = [...(Array.isArray(half.extras.pr_risk) ? half.extras.pr_risk : []), ...r.rows];
            atomicWrite(P.commonLawGridHalf(MEANING_SEAT), JSON.stringify(half, null, 2) + "\n");
          }
        }
      } catch (err) {
        // Never fatal: a re-issue that cannot even be attempted leaves the run exactly where it was,
        // and the disclosure below is what the ruling actually guarantees.
        runLog(run.runDir, { event: "connotation-reissue-failed", error: String(err?.message ?? err).slice(0, 160) });
      }
      try { return mergeCommonLawArtifacts(); } catch { /* still short — disclose below */ }
    }
    return mergeCommonLawArtifacts({ discloseUnfinished: true });
  };
  const mergeWithConnotationRemedy = !clSplit ? null : async () => {
    try { return mergeCommonLawArtifacts(); }
    catch (e) {
      // — `quote_unbound` joins the two here or the remedy channel does not open for it: a merged
      // doc failing ONLY on a quote would throw "deterministic", get parkBudget 0, and die at the merge
      // after a full paid gather with no model ever shown the correction hint. Same defect class as the
      // one this channel was built for, and the token that describes it is the newest one.
      // — THE TOKEN IS READ FROM THE DETAIL AS WELL AS THE MESSAGE, AND WITHOUT THAT THIS WHOLE
      // CHANNEL WAS DEAD. It matched `e.message` alone. StageFailure builds that as `${stage}: ${reason}`,
      // and moved the open-set payload OUT of `reason` into `detail` so a renderer could show the
      // sentence and hide the payload — so from that split onward the message read
      // "common-law: merged half-grids failed the canonical validator" and carried no token at all.
      // `!tok` was therefore true on EVERY merge-validator failure: this remedy re-threw before it
      // opened, and the run died on a token whose own error text carried the recovery instruction.
      // Measured on the two failures that prompted this — token in `e.message`: null; in `e.detail`:
      // `connotation_quote_unbound:quote_unbound=3;…` and `connotation_call_partial:2 rows still
      // outstanding`.
      //
      // A converted field takes its guards QUIET, not red, and a recovery path is a reader too. The
      // message half is kept rather than replaced: an archived or re-thrown failure that still carries
      // the token inline must keep opening this channel.
      const tok = connotationRemedyToken(e);
      const anyQuarantined = GRID_SEATS.some((h) => clHalves[h].quarantined);
      // A quarantined half keeps its transient park path: that half is re-run whole and the re-merge
      // converges, so there is nothing here to disclose yet.
      // THE DROPPED-QUERY FAILURE CARRIES NO FORM TOKEN, and matching on the form tokens alone is why
      // this channel never opened for it: `connotationRemedyToken` reads the connotation FORM
      // vocabulary, and "merged half-grids dropped N dictated connotation queries" is not in it. The
      // run therefore died at the merge with the recovery path sitting unused beside it.
      const droppedQueries = /dropped \d+ dictated connotation quer/i.test(String(e?.message ?? ""));
      if (anyQuarantined) throw e;
      if (droppedQueries) return await reissueThenDisclose(e);
      if (!tok) throw e;
      // ── ONE RE-ASK OF THE MODEL, THEN THE ENGINE TAKES OVER ──────────────────────────────────
      // The loop stops being a loop. The model gets exactly one routed repair turn; after that the
      // engine re-issues the search itself and, failing that, the run delivers with the gap disclosed.
      // Before this, a second arrival here re-threw and the clearance died after a full paid gather.
      if (clConnotationRemedySpent) return await reissueThenDisclose(e);
      clConnotationRemedySpent = true;
      runLog(run.runDir, { event: "connotation-remedy", detail: tok.slice(0, 200) });
      // — WHICH HALVES OWE ROWS, READ FROM THE FORM. This used to re-derive the violation set here,
      // a SECOND derivation of what the gate had just computed — and one that ran without the seats'
      // rulings passed in, so it read structurally-discharged obligations as violations and returned a
      // SUPERSET of the halves that actually owed anything. The canonical form already carries every row
      // and every ruling; an outstanding row's own queries name the halves to route to.
      let needy = new Set();
      try {
        const mergedOb = connotationObligations(parsePrRiskResults(readFileSync(P.commonLawGrid, "utf8")));
        // B — the canonical rulings live in the ACCUMULATOR (the merge's one write); the seat-facing
        // mirror died with the form path.
        const form = parseDispositionForm(readFileSync(formSidecarPath(P.commonLawDispositions), "utf8")).rows;
        for (const row of outstandingRows({ rows: form }, mergedOb))
          for (const q of (row.kind === "recurrence" ? (row.queries ?? []) : [row.query])) if (q) needy.add(q);
      } catch { /* unreadable merged pair or no form — fall through; the re-merge below re-throws honestly */ }
      const usable = (h) => Boolean(clHalves[h].sessionKey && !clHalves[h].quarantined);
      // — ONE seat owns the whole sweep, so the remedy has exactly one address. Routing over the
      // grid halves would send a form-repair turn into two seats that were never given a meaning query
      // and hold no form to open — a message with no work in it, twice, on the critical path.
      await runBatched([MEANING_SEAT], config.gatherConcurrency, async (h) => {
        if (!usable(h)) return;
        let owned = [];
        try { owned = parsePrRiskResults(readFileSync(P.commonLawGridHalf(h), "utf8")).filter((e2) => e2.results.length); }
        catch { /* no seat ledger → nothing owed here */ }
        if (!owned.some((e2) => needy.has(e2.query))) return;
        // B — THE REPAIR IS A TOOL CALL, and the tail must order exactly that. A tail ordering
        // targeted edits to any file would be the two halves of one message disagreeing about where
        // the work lands — the routing gap closed, kept closed under the typed transport.
        const followup = repairFollowup("common-law-half:connotation-remedy", { findingsFile: P.commonLawHalf(h), gridSpecPath: P.gridSpecHalf(h), tok });
        const r = await stage("common-law-half", { ...ctx, axis: h }, { force: true, followup, sessionKey: clHalves[h].sessionKey, trigger: "connotation-remedy" });
        if (!r.ok) note(`connotation remedy (half ${h}) failed mechanically (${r.fail}) — the re-merge below decides`);
      });
      try { return mergeCommonLawArtifacts(); }
      catch (e2) { return await reissueThenDisclose(e2); }
    }
  };
  if (clSplit) await mergeWithConnotationRemedy();
  recordConnotationAudit(run, P);
  // ── repair-first (2026-07-05): the plan-direct-execute repair kit for the fan-in gates below. The
  // provider adapter re-runs dictated slices as pure code at the gate (no agent turn, no gateway lane);
  // the tool's qid-ownership merge preserves untargeted/judgment blocks. Tests inject opts.planExecutor
  // (or set CLEAROTRON_PLAN_DISPATCH=off) so the offline mock never dials the live provider. Budgets live in
  // the persistent repair ledger (_driver/repairs.json); the epoch (plan_version:recoveryAttempts)
  // re-arms them when the input legitimately changed (a plan extension, a fresh recovery attempt).
  // (planExec itself is resolved once, above the gather — the code-side saturation-probe unit shares it.)
  const repairLedger = ctx.repairLedger ?? (ctx.repairLedger = createRepairLedger(run.runDir, { log: (o) => runLog(run.runDir, o) }));
  const repairEpoch = (() => {
    const att = (() => { try { return Number(readJson(join(run.runDir, "status.json")).recoveryAttempts) || 0; } catch { return 0; } })();
    return `${ctx.registerPlan?.plan_version ?? 0}:${att}`;
  })();
  const fanInRepairs = [];
  const dispatchPlanQids = async (a, qids, repairId, max = 1) => {
    if (!planExec || !ctx.registerPlan) return null;
    // A qid this run has accepted as a capability gap is never sent to the provider again, under any plan
    // version (envelope-settle.mjs stickyGapsAfter). A whole-axis dispatch becomes the axis's other qids;
    // the executor's qid-ownership merge keeps the gap's own block as it stands.
    const sticky = readStickyGaps(P);
    if (sticky.size) {
      const wanted = qids?.length ? qids : (ctx.registerPlan.entries ?? []).filter((e) => e.axis === a).map((e) => e.qid);
      const held = wanted.filter((q) => sticky.has(q));
      if (held.length) {
        runLog(run.runDir, { event: "plan-qids-sticky-gap", axis: a, qids: held, action: repairId });
        qids = wanted.filter((q) => !sticky.has(q));
        if (!qids.length) return null;
      }
    }
    if (!repairLedger.canAttempt(repairId, a, { max, epoch: repairEpoch })) return null;
    note(`register-unit ${a}: ${repairId} — direct executor dispatch (code, no agent turn) for ${qids?.length ?? "all"} dictated slice(s)`);
    let outcome;
    // — the clock starts at the DISPATCH, not at the bookkeeping after it. These calls sit
    // between stages, so on the D8 measurement their time landed in "outside any stage": 220s of one
    // 6m45s seam was three of them, against 1.1s of driver compute in the same window.
    const dispatchStartedMs = Date.now();
    try {
      // The envelope close's own dispatch is the one rung that asks a question that timed out at the gateway again
      // (execute-plan.mjs, timedOutBefore); every other dispatch leaves its timeout standing.
      const r = await planExec({ planPath: P.registerPlan, axis: a, outputPath: P.registerBand(a), ...(qids?.length ? { qids } : {}) },
        { agentId: agent, sessionKey: `clearance-${run.slug}-${run.codename}-register-unit-${a}`, recordLog: runRecordLogPath(run.runDir),
          ...(repairId === "early-envelope-close" ? { reaskTimedOut: true } : {}) });
      outcome = r?.ok ? "ok" : `failed: ${String(r?.cause ?? "unknown").slice(0, 140)}`;
    } catch (err) { outcome = `threw: ${String(err?.message ?? err).slice(0, 140)}`; }
    // — MEASURE WHETHER THE HOLE CLOSED, not whether the phone was answered. `outcome` is the
    // executor call returning; on a delivered run all five of these read "ok" while the deferred set
    // they were repairing grew 4 → 7. The bands are already on disk at this point, so the answer costs
    // one read: of the qids we ASKED for, how many now own a band block that is not an error?
    // Best-effort by construction — a repair that worked must never be reported as failed because the
    // measurement threw, so an unreadable band yields "unmeasured" rather than a zero, which would be
    // a confident wrong value of exactly the kind this issue is about.
    let effect;
    try {
      if (qids?.length) {
        // `readRegisterBands` directly, not the `readBands` helper further down: that one is declared
        // in an inner block and is not in this closure's scope. Only this axis's band: the executor writes no
        // other, and every qid it was sent is this axis's.
        const landed = new Set();
        for (const arr of Object.values(readRegisterBands(P, [a]) ?? {}))
          for (const b of arr ?? []) if (b && typeof b.qid === "string" && b.qid && b.error !== true) landed.add(b.qid);
        effect = { asked: qids.length, closed: qids.filter((q) => landed.has(q)).length };
      }
    } catch { effect = undefined; }
    const dispatchEndedMs = Date.now();
    repairLedger.record(repairId, a, outcome, { epoch: repairEpoch, effect, max, durationMs: dispatchEndedMs - dispatchStartedMs });
    // …and the same span where the decomposition can see it. `register-repair` is the stage label it
    // will print, because that instrument takes the label from the filename.
    recordSpan(run.runDir, "register-repair", { startedMs: dispatchStartedMs, endedMs: dispatchEndedMs },
      { repair: repairId, target: a, outcome: String(outcome), asked: effect?.asked ?? null, closed: effect?.closed ?? null });
    if (effect && effect.closed < effect.asked)
      note(`register-unit ${a}: ${repairId} dispatched ${outcome} but closed ${effect.closed} of ${effect.asked} slice(s) — the call returning is not the hole closing`);
    fanInRepairs.push({ repair: repairId, target: a, outcome, effect: effect ?? null });
    return outcome;
  };
  // barrier: every expected file present + valid. "Expected" is what the FROZEN POLICY dictated —
  // a register-only run has no common-law member, so demanding its findings file here would fail
  // every such run at the barrier. The list must never be narrowed for any other reason: this is
  // the gate that stops a report shipping over an artifact a stage was supposed to write and did not.
  for (const f of [...(runCommonLaw ? [P.commonLaw] : []), ...axes.map((a) => P.registerUnit(a))]) {
    if (!existsSync(f)) throw new StageFailure("fan-in", `missing ${f}`);
  }
  // THE SLICES A CHECK COULD NOT PROVE RAN, ONCE ITS RECOVERY WAS SPENT: each is taken out of its axis's band and
  // delivered as an open row, before the band's checks and the plan join read the band. The checks below name the
  // slices they fail on, and the run-level catch records them (parts-not-completed.mjs).
  const searchesOpen = readPartNotCompleted(run.runDir, "searches");
  if (Array.isArray(searchesOpen?.slices) && searchesOpen.slices.length) {
    const taken = takeSlicesOutOfTheBand(P, searchesOpen.slices);
    runLog(run.runDir, { event: "searches-not-completed-delivery", slices: searchesOpen.slices.length, taken: taken.length,
      reasons: [...new Set(searchesOpen.slices.map((s) => s.reason))] });
    note(`register: ${searchesOpen.slices.length} slice(s) a check could not prove ran are taken out of the band and delivered as open rows`);
  }
  // judgment-relocation LINCHPIN (2026-06-24): the load-bearing funnel artifact is the COMPLETE NAMED BAND
  // (register-units/<axis>-band.json) — the real material that crosses the lifted firewall. A unit that RAN
  // THIS process (unitKey[a] set) MUST have written it; a missing band would merge to empty and let a clean
  // ship over an UN-searched band (the firewall silently failing — the exact disease). Hard-require it for
  // freshly-run axes, as a TECHNICAL fan-in failure (retryable), never a silent pass. A resume PAST gather
  // (unitKey unset for an axis) stays lenient — deriveNamedBand handles a legacy/archived band-less run.
  // T3 (H3) — the resume-past-gather leniency is TIGHTENED: post- every unit writes a band
  // (the executor writes even error blocks), so on a resumed run where ANY band file exists, an axis
  // with none is a coverage hole, not a legacy artifact. Only a ZERO-band run (true pre-band legacy /
  // archived) keeps the lenient path. copper-spire's shipping path was exactly fail → manual resume →
  // resumed-past leniency → degrade-with-note → ship.
  const anyBands = axes.some((x) => existsSync(P.registerBand(x)));
  const unprovenBands = [];   // every axis whose band the ledger cannot evidence, failed on together below
  const collapsedSlices = [];   // every axis's qid-stamped slices that claimed hits and carried no record, likewise
  for (const a of axes) {
    if ((unitKey[a] || anyBands) && !existsSync(P.registerBand(a)))
      throw new StageFailure("fan-in", `missing named band for axis "${a}" — the funnel produced no complete band (a clean can never ship over an unsearched band)`, undefined, { detail: `${P.registerBand(a)}${unitKey[a] ? "" : " — resumed-past axis on a run that carries bands: a hole, not legacy"}` });
    // FIX backstop: a COLLAPSED slice (enumerated, total_hits>0, ZERO records) is the firewall silently
    // failing in the other direction — a clean shipping over a dangerous slice that WAS searched but lost.
    // Terminal immediately for freshly-run axes (the validator ladder above already gave the slice a re-run).
    // Fresh-axes-only (unitKey set) → never runs in replay, so no historical-verdict flip from the backstop;
    // the deterministic, floor-safe validators.registerUnit gate carries replay.
    if (unitKey[a] && existsSync(P.registerBand(a))) {
      const readCollapsed = () => { try { return findCollapsedBands(readFileSync(P.registerBand(a), "utf8")); } catch { return []; /* parse defect handled at the stage validator */ } };
      let collapsed = readCollapsed();
      // Repair-first A2: a collapsed DICTATED slice (qid-stamped) gets ONE direct re-execution — the
      // tool rewrites that slice's block from a fresh enumeration, no agent turn. Judgment (qid-less)
      // collapsed slices already had their re-run via the validator ladder — they stay terminal.
      const collapsedQids = collapsed.map((x) => x.qid).filter(Boolean);
      if (collapsedQids.length && (await dispatchPlanQids(a, collapsedQids, "collapsed-reexecute")) === "ok") collapsed = readCollapsed();
      // The collapsed slices are the searches not completed, failed on with every axis's below. One with no qid is named by
      // its query, and its block becomes a deferred block on that query.
      if (collapsed.length) collapsedSlices.push({ axis: a, collapsed });
    }
    // ── band-truth gate (2026-07-14, teal-foundry): the band must be EVIDENCED, not just well-formed ──
    // A qid-stamped band whose unit lane logged ZERO real provider calls was AUTHORED, not executed —
    // the exact fabrication that shipped 07-06 (ashen-causeway), 07-07 (teal-lattice, a CLEAR) and
    // 07-13 (teal-foundry): the model skipped its one register_execute_plan call and hand-wrote
    // plausible blocks. Forged qids satisfy every content gate, and the plan-execution receipt derives
    // from the band itself — so the judge here is the provider call LEDGER, code-written at the plugin
    // chokepoint, outside the model's reach. Repair-first: ONE direct re-execution rebuilds the band
    // from the frozen plan (real calls, real data — the qid-ownership merge overwrites every forged
    // dictated block); fail-closed only when that too cannot be evidenced. Scoped to fresh axes
    // (unitKey — same as the collapsed gate; a resumed skip recovers the winning lane key, so resumed
    // forged runs are caught too) with dictated entries and a qid-carrying band. A null count = the
    // ledger file is absent (hermetic tests, fresh installs) — the gate cannot judge and skips.
    // Kill switch CLEAROTRON_BAND_TRUTH_GATE=0 (the inline `!== "0"` pattern): hermetic test harnesses
    // opt out (their runs never touch the provider, so the production ledger can never evidence them);
    // production default is ON.
    if (process.env.CLEAROTRON_BAND_TRUTH_GATE !== "0"
      && unitKey[a] && existsSync(P.registerBand(a)) && (ctx.registerPlan?.entries ?? []).some((e) => e?.axis === a)) {
      const laneKey = `clearance-${run.slug}-${run.codename}-register-unit-${a}`;
      // A slice taken out of the band, or one the provider could not express, is a deferred block that made no call.
      const qidBlocks = (() => {
        try { const b = readJson(P.registerBand(a)); return Array.isArray(b) ? b.filter((x) => x && typeof x === "object" && x.qid && !(x.error === true && x.deferred === true)) : []; }
        catch { return []; /* parse defects are the stage validator's problem, not this gate's */ }
      })();
      const bandHasQids = qidBlocks.length > 0;
      if (bandHasQids && countLaneCalls(laneKey) === 0) {
        note(`register-unit ${a}: band carries qid blocks but its lane logged ZERO provider calls — authored, not executed; direct re-execution from the frozen plan`);
        runLog(run.runDir, { event: "band-truth-gate", axis: a, lane: laneKey, calls: 0 });
        const outcome = await dispatchPlanQids(a, null, "unverified-band-reexecute");
        const callsNow = countLaneCalls(laneKey);
        if (outcome === "ok" || (callsNow ?? 0) > 0) {
          runLog(run.runDir, { event: "band-truth-rebuilt", axis: a, outcome, calls: callsNow ?? 0 });
          note(`register-unit ${a}: band re-executed from the frozen plan (dispatch ${outcome ?? "unavailable"}, ${callsNow ?? 0} ledger call(s)) — fan-in continues over executor data`);
        } else {
          unprovenBands.push({ axis: a, laneKey, reexecution: outcome, qids: qidBlocks.map((x) => x.qid) });
        }
      }
    }
  }
  // THE SLICES THE BAND'S CHECKS COULD NOT PROVE RAN, failed on together, so one park takes every axis's. They are the
  // searches not completed: once this is terminal they are taken out of the band and delivered as open rows, each with
  // its shipped reason. A band no ledger call evidences reads "nothing in the run's own record confirms it was
  // searched"; a slice that claimed hits and carried no record reads "it could not be completed this run". A slice that
  // is both keeps the first.
  const notCompleted = [
    ...unprovenBands.flatMap((u) => u.qids.map((qid) => ({ axis: u.axis, qid, reason: plainDeferralReason("not-verified-closed") }))),
    ...collapsedSlices.flatMap((c) => c.collapsed.map((x) => (x.qid ? { axis: c.axis, qid: x.qid, reason: plainDeferralReason("collapsed-slice") }
      : { axis: c.axis, query: String(x.query ?? ""), reason: plainDeferralReason("collapsed-slice") }))),
  ];
  if (unprovenBands.length) {
    const [first] = unprovenBands, more = unprovenBands.length - 1;
    throw Object.assign(new StageFailure("fan-in", `fabricated named band for ${more ? `${unprovenBands.length} axes` : `axis "${first.axis}"`} — qid-stamped blocks, ZERO provider calls in the ledger, re-execution not evidenced (a clean can never ship over an unexecuted band)`,
      undefined, { failClass: "deterministic", repairs: fanInRepairs,
        detail: `${P.registerBand(first.axis)} — lane "${first.laneKey}", re-execution ${first.reexecution ?? "no executor lane"}${more ? `; ${more} more axis(es): ${unprovenBands.slice(1).map((u) => u.axis).join(", ")}` : ""}` }),
      { notCompletedPart: "searches", excludedSlices: notCompleted });
  }
  if (collapsedSlices.length) {
    const [{ axis: a, collapsed }] = collapsedSlices;
    const n = collapsedSlices.reduce((k, c) => k + c.collapsed.length, 0);
    throw Object.assign(new StageFailure("fan-in", `collapsed named band for axis "${a}" — ${n} enumerated slice(s) claimed hits but carried ZERO records into the band (a clean can never ship over a collapsed slice)`,
      undefined, { failClass: "deterministic", repairs: fanInRepairs,
        detail: `${P.registerBand(a)} — ${collapsed.slice(0, 6).map((x) => `${(x.query || "slice").slice(0, 40)}~${x.total_hits}`).join("; ")}${collapsedSlices.length > 1 ? `; and on ${collapsedSlices.length - 1} more axis(es)` : ""}` }),
      { notCompletedPart: "searches", excludedSlices: notCompleted });
  }

  // ── timeout-taint chain (copper-lattice 2026-07-08): unfinished ⇒ deferred ⇒ recover ⇒ converge ──────
  // A register-unit pass SIGKILLed at the wall leaves partial band writes the merge preserves; the
  // same-stage retry then "succeeds" by validating the poisoned band — the false 0/clean never THREW, so
  // nothing recovered it. The chain, per tainted axis (register-taint.mjs reads the per-attempt jsonl —
  // durable across --resume):
  //   T0  quarantine floor — every qid-less enumerated-with-zero-records block becomes an honest
  //       `incomplete` descriptor marked `(taint)` (never-silent-clean holds even if every re-run fails);
  //   T0.5 deterministic repair of the dictated half — one whole-axis execute_plan re-dispatch;
  //   T1  ONE fresh in-loop re-run (fresh session, never warm — doc-44: never warm-resume a killed
  //       session; the envelope, a warm resume, stays the second net); attempt-1-clean supersedes.
  // Still tainted on a MATERIAL axis → pre-synthesis: rename the tainted artifacts (so the resume
  // genuinely re-executes, not skip-validates) and THROW transient — the run-level park loop re-runs and
  // converges, repeat-signature → the honest failure notice. Post-synthesis (narrative locked): DISCLOSE —
  // `taint:<axis>` joins escalation-state failed[] (client export withheld) and the ledger relabel
  // (loadCoverageLedger → applyTaintDeferred) + registerGap clamp carry the verdict. NO KILL SWITCH:
  // it had one, nothing ever set it — not a deployment, not CI, not the config store, not a test —
  // so the off-path was never exercised by anything and is gone. The block stays a block because
  // what it declares must not leak into the scope around it.
  {
    const taint0 = readRegisterTaint(run.runDir, axes);
    const taintedNow = axes.filter((a) => taint0[a]?.tainted);
    if (taintedNow.length) {
      const recoveryAttempts = (() => { try { return Number(readJson(join(run.runDir, "status.json")).recoveryAttempts) || 0; } catch { return 0; } })();
      // The axes whose recovery is spent: the searches record lists them, and each is read as it stands and disclosed.
      const disclosedAxes = new Set(Array.isArray(searchesOpen?.disclosed_axes) ? searchesOpen.disclosed_axes : []);
      const axesRec = {};
      const digestLocked = existsSync(P.narrative);   // synthesis done — the audit spine is locked; disclose, never mutate under it
      for (const a of taintedNow) {
        const repairs = [];
        let quarantined = 0;
        // T0 — quarantine floor (unconditional, idempotent, code-only)
        try {
          if (existsSync(P.registerBand(a))) {
            const q = taintQuarantineCleanBlocks(readFileSync(P.registerBand(a), "utf8"));
            if (q.quarantined.length) {
              writeFileSync(`${P.registerBand(a)}.tmp`, JSON.stringify(q.blocks, null, 2) + "\n");
              renameSync(`${P.registerBand(a)}.tmp`, P.registerBand(a));
              quarantined = q.quarantined.length;
              note(`register-unit ${a}: taint-quarantined ${quarantined} self-reported-clean judgment block(s) → incomplete descriptors`);
              runLog(run.runDir, { event: "taint-quarantine", axis: a, blocks: quarantined });
            }
          }
        } catch (e) { note(`register-unit ${a}: taint quarantine not applicable (${String(e.message).slice(0, 100)})`); }
        // T0.5 — deterministic re-execution of the dictated half (repair-ledger bounded). Not for an axis the searches
        // record discloses: its recovery is spent, and its band is read as the last pass left it.
        const dispatched = disclosedAxes.has(a) ? null : await dispatchPlanQids(a, null, "taint-dispatch");
        if (dispatched) repairs.push(`taint-dispatch:${dispatched}`);
        // T1 — ONE fresh in-loop re-run, pre-synthesis only (a fresh full pass on the stage's one model)
        // — held until the real result is in hand; see the push below the taint re-read.
        let taintRerunDispatch = null;
// — ONE ceiling, named once and read by BOTH ends. A literal repeated at the record site is a
        // second statement of the same rule, and two ends stating the same rule is how they drift apart.
        const taintRerunMax = 1;
        if (!digestLocked && !disclosedAxes.has(a) && repairLedger.canAttempt("taint-rerun", a, { max: taintRerunMax, epoch: repairEpoch })) {
          note(`register-unit ${a}: taint-rerun — one fresh re-run (fresh session; a killed session is never warm-resumed)`);
          const r = await stage("register-unit", { ...ctx, axis: a },
            { force: true, trigger: "taint-rerun", sessionKey: `clearance-${run.slug}-${run.codename}-register-unit-${a}-taint-rerun-${recoveryAttempts}` });
          repairLedger.record("taint-rerun", a, r.ok ? "ok" : `failed: ${String(r.fail ?? "unknown").slice(0, 100)}`, { epoch: repairEpoch, max: taintRerunMax });
          repairs.push(`taint-rerun:${r.ok ? "ok" : `failed: ${String(r.fail ?? "unknown").slice(0, 60)}`}`);
          if (r.ok && r.sessionKey) unitKey[a] = r.sessionKey;
          taintRerunDispatch = r.ok ? "ok" : `failed: ${String(r.fail ?? "unknown").slice(0, 100)}`;
        }
        const after = readRegisterTaint(run.runDir, [a])[a];
        // ── — `outcome` SAID THE CALL RETURNED, AND THE ROW REACHES A FAILURE PACKET ───────────
        //
        // `r.ok` is whether the re-run CALL came back, not whether the taint cleared — and this row
        // travels as `repairs:` on a StageFailure, so a reader of that packet saw `outcome: "ok"` for an
        // axis still tainted. The same shape found on `repair-attempted.outcome`.
        //
        // `outcome` KEEPS ITS MEANING rather than being renamed: `repairs.mjs` documents
        // `axisOutcome` as "the AXIS's repair-attempt outcome", and `fanInMissingEvidence` uses it to say
        // what a repair HIT when a slice landed nothing of its own. That reading is correct and consumed
        // correctly; renaming would churn a documented vocabulary across two producers, a map and a
        // parameter, to fix a field that is not the one lying.
        //
        // So the row gains the result as a SIBLING — the other remedy — and the push moves below the
        // taint re-read so there IS a result to state. `cleared` is the same fact `axesRec[a].status`
        // records two lines down, from this same read.
        if (taintRerunDispatch !== null) {
          fanInRepairs.push({ repair: "taint-rerun", target: a, outcome: taintRerunDispatch,
            cleared: !after?.tainted });
        }
        axesRec[a] = {
          status: after?.tainted ? "active" : "resolved",
          evidence: (after?.tainted ? after.evidence : taint0[a].evidence).slice(0, 8),
          quarantinedBlocks: quarantined,
          repairs,
          ...(after?.tainted ? {} : { resolvedBy: "taint-rerun", resolvedAt: new Date().toISOString() }),
        };
      }
      try {
        const tp = P.registerTaint;
        writeFileSync(`${tp}.tmp`, JSON.stringify({ schema_version: 1, ts: new Date().toISOString(), axes: axesRec }, null, 2) + "\n");
        renameSync(`${tp}.tmp`, tp);
      } catch (e) { note(`register-taint receipt write failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
      const stillTainted = Object.entries(axesRec)
        .filter(([a, v]) => v.status === "active" && !NON_MATERIAL_AXES.includes(String(a).toLowerCase()))
        .map(([a]) => a);
      // Disclosed: every axis once synthesis is done, and an axis the searches record lists once its recovery is spent.
      // Parked: the rest, while the run can still re-run them.
      const { disclose: toDisclose, park: toPark } = taintDisposition(stillTainted, { digestLocked, disclosedAxes });
      if (toDisclose.length) {
        // DISCLOSE — the sanctioned lever once synthesis is done, and once an axis's recovery is spent: the client
        // export is withheld until the search is re-run to closure (the same class as a failed escalation/envelope),
        // the internal report ships CONDITIONAL via the ledger relabel + registerGap clamp.
        try {
          const escPath = P.escalationState;
          let esc = {}; try { esc = readJson(escPath); } catch { /* fresh */ }
          const failed = Array.isArray(esc.failed) ? esc.failed : [];
          for (const a of toDisclose) if (!failed.includes(`taint:${a}`)) failed.push(`taint:${a}`);
          atomicWrite(escPath, JSON.stringify({ ...esc, ts: new Date().toISOString(), failed }, null, 2) + "\n");   // B5 — the client-gate reads this: never truncated
        } catch (e) { note(`taint disclose: escalation-state append failed (${String(e.message).slice(0, 80)})`); }
        // Receipt status → "disclosed": the LEDGER keeps treating the axis as a gap (deferred → clamp +
        // client-gate withhold) but the digest validator stays quiet — a locked narrative is never
        // forced into a rewrite loop (see register-taint.mjs status contract).
        try {
          const tp = P.registerTaint;
          const rec = readJson(tp);
          for (const a of toDisclose) if (rec?.axes?.[a]) rec.axes[a] = { ...rec.axes[a], status: "disclosed" };
          writeFileSync(`${tp}.tmp`, JSON.stringify(rec, null, 2) + "\n"); renameSync(`${tp}.tmp`, tp);
        } catch (e) { note(`register-taint receipt disclose update failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
        runLog(run.runDir, { event: "taint-disclose", axes: toDisclose });
        note(`timeout-taint on ${toDisclose.join(", ")} ${digestLocked ? "past the locked audit spine" : "with its recovery spent"} — disclosed: client export withheld, verdict clamps CONDITIONAL (internal report still ships)`);
      }
      if (toPark.length) {
        // PARK — the converging outer net. Rename (never delete — forensics) so stageOnce's
        // exists-and-validates skip MISSES and the resume genuinely re-executes the tainted units;
        // drop the plan-execution receipt so the re-join runs over the fresh bands; a digest already
        // derived from tainted material is renamed too, else its skip would ship stale rows. The renames ride the
        // failure: once its recovery is spent, the run-level catch puts them back and the axes are disclosed instead.
        const undoRenames = [];
        const parkRename = (f) => {
          try { if (existsSync(f)) { renameSync(f, `${f}.tainted-${recoveryAttempts}`); undoRenames.push({ from: f, to: `${f}.tainted-${recoveryAttempts}` }); } }
          catch { /* best-effort */ }
        };
        for (const a of toPark) for (const f of [P.registerUnit(a), P.registerBand(a)]) parkRename(f);
        try { if (existsSync(P.planExecution)) rmSync(P.planExecution); } catch { /* best-effort */ }
        for (const f of taintParkJudgmentArtifacts(P, run.runDir)) parkRename(f);
        runLog(run.runDir, { event: "taint-park", axes: toPark, attempt: recoveryAttempts });
        throw Object.assign(new StageFailure(`register-unit:${toPark[0]}`,
          `register slice timeout-tainted and unrecovered — an unfinished pass cannot ship self-reported clean (axes: ${toPark.join(", ")})`,
          undefined, { failClass: "transient", repairs: fanInRepairs }),
          { notCompletedPart: "searches", taintedAxes: toPark, undoRenames });
      }
    }
  }

  // judgment-relocation (2026-06-23): MERGE the per-axis COMPLETE NAMED BANDS into one (register-named-band.json)
  // so the lifted firewall carries the real material into Layer B (placement / digest / synthesis read it as a
  // declared stage input). T3: a band that survived the recovery ladder still malformed FAILS the run
  // inside deriveNamedBand — judgment must never reason over receipts it cannot read. Re-run on every
  // re-enumeration pass below.
  // Repair-first A3: before that terminal, a malformed DICTATED axis gets ONE whole-axis direct
  // re-execution — the tool's merge rewrites every dictated block (fresh-writes over an unparseable
  // file, trading unsalvageable qid-less judgment blocks for a readable dictated band). Only THIS
  // fan-in call carries the repair; later deriveNamedBand calls re-merge post-repair bands.
  try { deriveNamedBand(ctx); }
  catch (e) {
    if (!(e instanceof StageFailure) || !ctx.registerPlan || !planExec) throw e;
    const { invalid } = mergeRegisterBands(P, axes);
    const planAxes = new Set(ctx.registerPlan.entries.map((x) => x.axis));
    const targets = invalid.map((x) => x.axis).filter((x) => planAxes.has(x));
    let repaired = false;
    for (const a of targets) if ((await dispatchPlanQids(a, null, "band-reexecute")) === "ok") repaired = true;
    if (!repaired) throw e;
    deriveNamedBand(ctx);   // still malformed → throws for real this time
  }

  // ── common-law → register cross-check (copper-lattice recovery net #3) ───────────────────────────
  // Option-D Triggers 1/4 (phase2-execution.md) as CODE: a common-law hit carrying the
  // "Similar listing(s) found" receipt (or an <x>-of-record owner in a findings block) mints
  // deterministic register queries — an owner-field sweep per extracted owner, a contains sweep per
  // owner-less mark — folded into the frozen plan as qid'd entries (plan_version bump). The join
  // below then sees them MISSING and the plan-direct-execute dispatch runs them as pure code; they
  // land qid-stamped in the primary-sweep band, skeleton-tracked and receipt-durable. Bounded at the
  // Option-D cap (10, ranked verified-use-with-URL > owner > term-only), overflow LOGGED never
  // silent; deterministic qids make the fold resume-idempotent. NEVER-KILL: a parse miss degrades to
  // a logged skip. Receipt: _driver/register-xcheck.json (the demotion tripwire's substrate).
  if (ctx.registerPlan) {
    try {
      const receiptPath = P.registerXcheck;
      const prior = existsSync(receiptPath) ? readJson(receiptPath) : null;
      const signals = findSimilarListingSignals(readFileSync(P.commonLaw, "utf8"));
      const ranked = [
        ...signals.filter((s) => s.owner && s.url),
        ...signals.filter((s) => s.owner && !s.url),
        ...signals.filter((s) => !s.owner),
      ];
      const inScope = inScopeClassList(job, ctx.profile).map(Number).filter(Number.isFinite);
      const XCHECK_CAP = 10;
      const candidates = [], candDirectives = [], overflow = [];
      const seen = new Set();
      const mintedQids = new Set();   // qid uniqueness inside the lane — the fold below dedupes on it
      for (const s of ranked) {
        const term = (s.owner ?? s.markText ?? s.term ?? "").trim();
        if (!term || !inScope.length) continue;
        const key = `${s.owner ? "owner" : "mark"}:${term.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // IDENTITY, NOT A DISPLAY SLUG — AND ON BOTH ROW TYPES. `kebab()` NFKD-decomposes and turns
        // every combining mark into a hyphen, so distinct katakana marks minted ONE qid and
        // foldSupplementalEntries, which dedupes on qid, dropped the rest with nothing in refused[]
        // and nothing on the receipt: marks nobody searched, and nothing saying so.
        //
        // The owner side is fixed with it, deliberately. The exemption below withholds the ROMANISATION
        // from owner rows — a term rule, about what goes out in the query. A qid is an identity and
        // decides whether a row survives at all, so a colliding owner qid drops a distinct owner into
        // the substrate findUncrossCheckedDemotions then reads as if it were whole.
        //
        // THE NET IS A SECOND DEFECT, not a precaution. termIdentity falls back to the fingerprint only
        // when the Latin fold is EMPTY, so a Latin term returns its long fold and this site truncates at
        // 40 — two ordinary corporate names sharing a 40-character prefix collide today. Two classes,
        // two changes. Latin qids that do not collide are byte-unchanged, so no existing entry moves.
        const qid = mintSupplementalQid({ prefix: s.owner ? "xcheck-owner" : "xcheck-mark", term, used: mintedQids });
        // — CARRY THE ROMANISATION THE PLAN ALREADY HOLDS. This lane mints outside
        // the compiler's push(), so its entries never met romanStamp: a non-Latin term arrived bare and
        // was refused by the capability gap while the same plan held its romanisation on the entries
        // that answered it. An owner row is exempt — an owner NAME is not mark text and the executor
        // drops the carrier on an owner query, exactly as romanStamp itself decides.
        candidates.push(waitingCrossCheck({ qid, axis: "primary-sweep", predicate: s.owner ? "owner" : "default", term, nice_classes: inScope.map(String), regions: [], ...(s.owner ? {} : (() => { const r = romanizedTermsFromPlan(ctx.registerPlan, term); return r ? { romanizedTerms: r } : {}; })()), expected_kind: "enumerate" }));
        candDirectives.push({ qid, owner: s.owner ?? null, markText: s.markText ?? null, source: { term: s.term ?? null, platform: s.platform ?? null, url: s.url ?? null } });
      }
      // — THIS IS THE LANE THAT KILLED R2b. `findSimilarListingSignals` takes a negative-results
      // matrix row's first cell VERBATIM (the finding arm strips `[*_\`]`, the matrix arm strips
      // nothing), so a grouping HEADING in that table became `{predicate:"default", term:"**Core
      // (BIOVELTRIN, …, etc.)**"}` and folded into a plan the freeze lint had already passed. The
      // screen is inside foldSupplementalEntries; here the refused rows are moved out of directives[]
      // and into the receipt's own refused[], where the ask ledger renders them as OPEN asks. Owner
      // rows are exempt from the term rules, so findUncrossCheckedDemotions keeps its whole substrate.
      // ── — THE CAP COUNTS QUERIES, NOT CANDIDATES ────────────────────────────
      //
      // The cap used to fill from the raw candidate list while the duplicate screen ran AFTER it, so
      // an entry the fold was going to refuse still consumed a slot, and a genuinely new term behind
      // it was logged "assess manually" instead of being searched.
      //
      // AND THE COLLISION IS THE EXPECTED CASE, not an ordering accident. The terms most likely to be
      // refused as duplicates are the mark itself and its nearest forms — exactly what the common-law
      // pass surfaces FIRST, so they arrive at the front of `ranked` and take the earliest slots.
      // Measured on a live run: cap 10, six directives kept, FOUR slots spent on entries this very
      // fold then discarded, and six real terms pushed out behind them.
      //
      // SCREEN FIRST, THEN COUNT. The fold is pure — it derives its sets from `plan.entries` on each
      // call and returns a NEW plan rather than mutating one — so probing with the full candidate
      // list costs nothing, and it is what makes the batch-internal dedup visible before the cap is
      // spent. The fold's refusal logic is untouched: it is right about every row it refuses, and
      // only the ORDER of screening and counting moves.
      const screened = crossChecksForThisPass(ctx.registerPlan, candidates, candDirectives, prior, XCHECK_CAP);
      const entries = screened.entries;
      // Overflow now holds GENUINE excess only: a term is over-cap because ten real queries were
      // minted ahead of it, never because a slot was burned on a row nobody dispatched.
      for (const e of screened.overflow)
        overflow.push({ term: e.term, reason: `cap ${XCHECK_CAP} reached — assess manually` });
      const folded = foldSupplementalEntries(ctx.registerPlan, entries);   // PURE — safe above the guard
      const entryQids = new Set(entries.map((e) => e.qid));
      const kept = [...screened.carried, ...partitionFoldDirectives(candDirectives.filter((d) => entryQids.has(d.qid)), folded.refused).kept];
      // The refusals are still RECORDED, across the WHOLE candidate list. They render as asks a reader
      // adjudicates, and screening further down the list must not quietly drop the disclosure for rows
      // the cap never reached — a fix that searched more while disclosing less would be a bad trade.
      const { refused: refusedDirectives } = partitionFoldDirectives(candDirectives, screened.refused);
      // Computed over the KEPT set, so the resume guard below compares like with like on every attempt.
      const dirKey = kept.map((d) => d.qid).sort().join(",");
      const priorKey = Array.isArray(prior?.directives) ? prior.directives.map((d) => d.qid).sort().join(",") : null;
      if (candidates.length && dirKey !== priorKey) {
        const { plan, added } = folded;
        if (added.length) {
          writeFileSync(`${P.registerPlan}.tmp`, JSON.stringify(plan, null, 2) + "\n");
          renameSync(`${P.registerPlan}.tmp`, P.registerPlan);
          ctx.registerPlan = plan;   // run-local only — no slug-store write-back (clearances run once; senior lawyer 2026-07-10)
          runLog(run.runDir, { event: "register-xcheck", minted: added.length, overflow: overflow.length });
          note(`common-law→register cross-check: ${added.length} register quer${added.length === 1 ? "y" : "ies"} minted (cap ${XCHECK_CAP}${overflow.length ? `, ${overflow.length} over-cap logged` : ""})`);
        }
      }
      if (refusedDirectives.length) {
        runLog(run.runDir, { event: "register-xcheck-refused", refused: refusedDirectives.length,
          qids: refusedDirectives.map((d) => d.qid).slice(0, 6) });
        note(`common-law→register cross-check: ${refusedDirectives.length} signal(s) REFUSED as un-searchable terms — recorded in _driver/register-xcheck.json refused[], never dispatched`);
      }
      // THE CROSS-CHECKS WAIT FOR THE READING STEP (cross-check-wait.mjs). Minted after it decided its plan,
      // they are put to it once more, in its own session. Whatever it leaves undecided — all of them when
      // that session cannot be asked — runs as code, as before the wait, and the receipt says so.
      let decided = prior?.decided ?? null;
      const waiting = undecidedCrossChecks(ctx.registerPlan, { released: releasedFamilyQids(run.runDir), withheld: readWithheldFamilies(run.runDir) });
      if (waiting.length) {
        const axis = "primary-sweep";
        let asked = false;
        // A follow-up that throws is one that could not be asked: the questions must still run below.
        if (unitKey[axis]) try {
          const byQid = new Map(ctx.registerPlan.entries.map((e) => [e.qid, e]));
          const from = new Map([...(Array.isArray(prior?.directives) ? prior.directives : []), ...kept].map((d) => [d.qid, d.source?.url ?? null]));
          const followup = repairFollowup("register-unit:xcheck-decide", { axis, registerPlan: P.registerPlan, bandPath: P.registerBand(axis), entries: waiting.map((q) => ({ ...byQid.get(q), from: from.get(q) ?? null })),
            job: ctx.job, profile: ctx.profile, supplementalLane: !!ctx.registerPlan?.contract?.supplemental_lane });
          const r = await stage("register-unit", { ...ctx, axis }, { force: true, followup, sessionKey: unitKey[axis], trigger: "xcheck-decide" });
          asked = r?.ok === true;
          remergeIfBandsMoved(ctx, "xcheck-decide");
        } catch (e) { runLog(run.runDir, { event: "register-xcheck-decide-failed", fail: String(e?.message ?? e).slice(0, 160) }); }
        const released = releasedFamilyQids(run.runDir), withheld = readWithheldFamilies(run.runDir);
        const ran = undecidedCrossChecks(ctx.registerPlan, { released, withheld });
        if (ran.length) {
          const plan = withoutWait(ctx.registerPlan, ran);
          writeFileSync(`${P.registerPlan}.tmp`, JSON.stringify(plan, null, 2) + "\n");
          renameSync(`${P.registerPlan}.tmp`, P.registerPlan);
          ctx.registerPlan = plan;
          note(`common-law→register cross-check: ${ran.length} quer${ran.length === 1 ? "y" : "ies"} the reading step did not decide`
            + `${asked ? "" : " (its session could not be asked)"} run as code, as before the wait`);
        }
        decided = { asked, released: waiting.filter((q) => released.has(q)), withheld: waiting.filter((q) => withheld[q]), ran_undecided: ran };
        runLog(run.runDir, { event: "register-xcheck-decided", ...decided });
      }
      writeFileSync(`${receiptPath}.tmp`, JSON.stringify({ schema_version: 1, ts: new Date().toISOString(), cap: XCHECK_CAP, directives: kept, overflow, ...(refusedDirectives.length ? { refused: refusedDirectives } : {}), ...(decided ? { decided } : {}) }, null, 2) + "\n");
      renameSync(`${receiptPath}.tmp`, receiptPath);
    } catch (e) {
      note(`common-law→register cross-check skipped (${String(e.message).slice(0, 100)}) — never-kill`);
    }
  }

  // WS2 (B3) — the plan⇄band IDENTITY JOIN (plan mode only; legacy runs have no plan and skip).
  // Every guard-active plan entry must own a band block carrying its qid. A missing qid gets ONE
  // targeted followup on the owning axis's winning key dictating exactly the unexecuted entries;
  // whatever is still missing is a StageFailure — a clean can never ship over a slice the PLAN dictated
  // and nothing ran (the F2/F3 seam). The receipt (_driver/plan-execution.json, incl. the code-derived
  // coverage skeleton) is what the digest ledger gate and the refutation plan-audit read.
  if (ctx.registerPlan) {
    // copper-lattice re-route: fold the propose-tool's per-axis supplemental plans BEFORE the join —
    // a folded qid with no band block joins MISSING and rides the same dispatch/followup/StageFailure
    // ladder as a dictated entry (plan_version growth also invalidates a stale clean receipt below).
    foldSupplementalProposals(ctx);
    const readBands = () => readRegisterBands(P, axes);
    const writeExecution = (joinRes) => writePlanExecutionReceipt(ctx, joinRes);
    // ── Settle the receipt's deferrals HERE, before anything expensive reads them ──────────────────
    // On the R2 evidence run the receipt recorded three refused slices at 11:47:26 and the envelope
    // decided about them at 12:31:22 — with placement (626s), a digest attempt GUARANTEED to fail its
    // coverage_clean_deferred validator (810s), its retry (697s) and the skeptic (335s) in between.
    // made that decision read the deferral's own reason instead of the clock; this makes it happen
    // before the work that depends on it. Zero model turns: the only close mechanism here is the code
    // executor, and nothing in this lane consults a deadline (see envelope-settle.mjs).
    const settleEnvelopeAtReceipt = async (source) => {
      const receipt = readPlanExecution(ctx);
      if (!receipt) return null;
      // A suspect deferral is nearly always an executor MIS-STAMP (deterministic refusals go to
      // `deferred`, transients to `missing`, and the fan-in ladder above already closed-or-killed
      // `missing`). One budgeted attempt each, through the same repair ledger every other lane uses —
      // so a mis-stamp cannot quietly become permanent, and a real gap costs one executor call.
      const doc = await settleReceipt({
        P, plan: ctx.registerPlan, receipt,
        dispatch: planExec ? async (axis, qids) => {
          runLog(run.runDir, { event: "plan-qids-deferred-suspect", axis, qids, action: "early-envelope-close" });
          await dispatchPlanQids(axis, qids, "early-envelope-close", 2);
        } : null,
        rejoin: planExec ? async () => {
          writeExecution(joinPlanToBands(ctx.registerPlan, readBands(), joinOptions(ctx)));
          deriveNamedBand(ctx);   // a close landed band blocks — re-merge so Layer B reads them
          return readPlanExecution(ctx);
        } : null,
      });
      runLog(run.runDir, { event: "envelope-decision-early", source, deferred: (receipt.deferred ?? []).length,
        accepted: doc.accepted.length, closed: doc.closed.length, close_failed: doc.close_failed.length });
      if (doc.accepted.length)
        note(`register plan: ${doc.accepted.length} deferred slice(s) ACCEPTED as provider capability gaps before placement — `
          + `they are disclosed, never retried, and no stage will be asked to close them: `
          + doc.accepted.slice(0, 3).map((a2) => a2.qid).join(", "));
      return doc;
    };
    // Hung on ctx so a downstream guard settles through the SAME lane, executor included. Without this
    // the guard would still settle (settleReceipt works dispatch-less), but a mis-stamped deferral it
    // met would be recorded ended without ever being tried.
    ctx.settleEnvelope = settleEnvelopeAtReceipt;
    // A CLEAN execution receipt for THIS plan version is durable: judgment-lane band re-emits
    // (escalation / frame-reopen warm re-runs) happen AFTER the join and may not carry the qid
    // stamps forward — the receipt, written at the moment of execution, remains the truth of
    // what Phase A ran. Re-join only when no clean receipt exists for this version (fresh runs)
    // or the plan grew (extension bumps plan_version → the new entries must execute + re-join).
    let priorReceipt = null;
    try { priorReceipt = readJson(P.planExecution); } catch { /* none yet */ }
    if (priorReceipt && priorReceipt.plan_version === ctx.registerPlan.plan_version
        && Array.isArray(priorReceipt.missing) && priorReceipt.missing.length === 0) {
      ctx.planExecution = priorReceipt;
      runLog(run.runDir, { event: "plan-execution", reused: true, executed: priorReceipt.executed?.length ?? 0 });
      // The seam a resume sails through. On the evidence run the 15:47:37 resume reused a clean receipt
      // and then re-decided the envelope from scratch an hour later — because the decision had only ever
      // been a log line. Settling here is idempotent and makes the decision durable.
      if (!receiptSettled(P, priorReceipt).settled) await settleEnvelopeAtReceipt("receipt-reuse");
    } else {
    // A qid this run has accepted as a capability gap does not ride the ladder again. It leaves `missing`
    // for `deferred` with the reason it was accepted under, before any dispatch or followup reads the
    // join, so neither the direct executor nor the plan-join followup re-dictates it.
    const holdStickyGaps = (j) => {
      const held = holdStickyGapsIn(j, readStickyGaps(P));
      if (held !== j) runLog(run.runDir, { event: "plan-qids-sticky-gap", qids: j.missing.filter((q) => !held.missing.includes(q)), action: "held-from-missing" });
      return held;
    };
    let joinRes = holdStickyGaps(joinPlanToBands(ctx.registerPlan, readBands(), joinOptions(ctx)));
    const missingEntriesByAxis = () => {
      const byQid = new Map(ctx.registerPlan.entries.map((e) => [e.qid, e]));
      const m = new Map();
      for (const qid of joinRes.missing) {
        const e = byQid.get(qid);
        if (!m.has(e.axis)) m.set(e.axis, []);
        m.get(e.axis).push(e);
      }
      return m;
    };
    // ── repair-first A1 (2026-07-05): code first, agent second, throw with evidence third. The
    // direct executor dispatch closes missing dictated slices in seconds with no agent turn (the
    // Open Country class: two 414-killed form slices burned 3 parks + an LLM followup that
    // re-derived the same failure). The LLM followup below survives as the FALLBACK for providers
    // without an executePlan adapter, or a dispatch that itself failed at the transport level.
    if (joinRes.missing.length && planExec) {
      for (const [a, entries] of missingEntriesByAxis()) {
        const qids = entries.map((e) => e.qid);
        runLog(run.runDir, { event: "plan-qids-missing", axis: a, qids, action: "plan-direct-execute" });
        await dispatchPlanQids(a, qids, "plan-direct-execute", 2);
      }
      joinRes = holdStickyGaps(joinPlanToBands(ctx.registerPlan, readBands(), joinOptions(ctx)));
      if (!joinRes.missing.length) deriveNamedBand(ctx);   // dispatch landed blocks — re-merge so Layer B reads them
    }
    if (joinRes.missing.length) {
      for (const [a, entries] of missingEntriesByAxis()) {
        if (!unitKey[a]) {
          // T1 (J6): a resumed-past axis has no live session, but register_execute_plan needs
          // no session context — ONE fresh tool-only call converts the transient into recovery. The
          // plan-unexecuted StageFailure below still holds the line for a genuine hole.
          runLog(run.runDir, { event: "plan-qids-missing", axis: a, qids: entries.map((e) => e.qid), action: "fresh-execute-plan" });
          note(`register-unit ${a}: ${entries.length} dictated plan entr${entries.length === 1 ? "y" : "ies"} unexecuted on a resumed-past axis — one fresh execute_plan-only call`);
          const freshMsg = repairFollowup("register-unit:plan-join-fresh", { axis: a, registerPlan: P.registerPlan, bandPath: P.registerBand(a), entries });
          const rf = await stage("register-unit", { ...ctx, axis: a }, { force: true, freshMessage: freshMsg, sessionKey: `clearance-${ctx.run.slug}-${ctx.run.codename}-register-unit-${a}-plan-join-fresh`, trigger: "plan-join-fresh" });
          if (!rf.ok) note(`register-unit ${a}: fresh execute_plan call failed (${rf.fail}) — the plan-unexecuted StageFailure below holds the line`);
          continue;
        }
        runLog(run.runDir, { event: "plan-qids-missing", axis: a, qids: entries.map((e) => e.qid), action: "warm-followup" });
        note(`register-unit ${a}: ${entries.length} dictated plan entr${entries.length === 1 ? "y" : "ies"} unexecuted — one followup`);
        const followup = repairFollowup("register-unit:plan-join", { axis: a, registerPlan: P.registerPlan, bandPath: P.registerBand(a), entries });
        // Repair-first: the followup's own failure no longer hard-throws here (the old
        // register-unit:<axis>(plan-join) must()) — the fan-in throw below is the single authority,
        // carrying the per-slice provider evidence and the honest failClass.
        const wf = await stage("register-unit", { ...ctx, axis: a }, { force: true, followup, sessionKey: unitKey[a], trigger: "plan-join" });
        if (!wf.ok) note(`register-unit ${a}: plan-join followup failed (${wf.fail}) — the plan-unexecuted StageFailure below holds the line`);
      }
      joinRes = holdStickyGaps(joinPlanToBands(ctx.registerPlan, readBands(), joinOptions(ctx)));
      deriveNamedBand(ctx);   // the followup appended band blocks — re-merge so Layer B reads them
    }
    const skeleton = writeExecution(joinRes);
    // — the RECEIPT is the authority, not the local join. writeExecution may have moved a
    // ladder-spent, provider-hard-errored qid from `missing` to `deferred`; reading its own write back
    // is what makes the throw below agree with the file every downstream gate reads. Taking the
    // conversion at the writer and forgetting it here would throw over a slice the receipt discloses.
    if (ctx.planExecution) joinRes = { ...joinRes, missing: ctx.planExecution.missing ?? [], deferred: ctx.planExecution.deferred ?? [] };
    // A DEFERRED slice is a capability gap the active provider cannot close (register-plan.mjs
    // joinPlanToBands): re-running it would produce the identical refusal, so it is NOT missing and
    // must not ride the ladder into the StageFailure below. It is also NOT executed — the coverage
    // skeleton marks the axis `deferred` and findUnexecutedCleanClaims refuses a `confirmed-clean`
    // claim over it, so the gap is disclosed rather than closed. Loud in the log and the note, never a
    // silent narrowing.
    // The rows are excluded here and announced by their own note: they are NOT slices the provider
    // cannot express — it accepted them and then failed — and one note claiming both would make the
    // run's own record of WHY a territory went unsearched wrong.
    // And the slices a check could not prove ran, taken out of the band (searchesOpen above): announced on their own.
    const takenOut = new Set((Array.isArray(searchesOpen?.slices) ? searchesOpen.slices : []).map((s) => s.qid));
    const capabilityDeferred = (joinRes.deferred ?? []).filter((d) => !isProviderHardErrorReason(d.reason) && !takenOut.has(d.qid));
    if (capabilityDeferred.length) {
      runLog(run.runDir, { event: "plan-qids-deferred", count: capabilityDeferred.length,
        qids: capabilityDeferred.slice(0, 8).map((d) => d.qid) });
      note(`register plan: ${capabilityDeferred.length} dictated slice(s) DEFERRED — the active register provider cannot express them, `
        + `so they were never searched and cannot be read as clean: ${capabilityDeferred.slice(0, 3).map((d) => `${d.qid} ← ${String(d.reason).slice(0, 120)}`).join("; ")}`);
    }
    // — THE CENSUS IS RECORDED BEFORE THE THROW, NOT AFTER IT. The `plan-execution` runLog below
    // carries `unplanned`, and it sat two lines past the throw: on every run that PARKED here — the only
    // runs anyone diagnoses — the number was computed and discarded. `missing` and `unplanned` together
    // are the fingerprint that separates this park's two causes (see the evidence block below), so the
    // one row that could tell them apart was unreachable on exactly the path that needed it. Same class
    // as /: the data existed, the reporting did not.
    // ONE read of the bands for the census, the error quotes and the landed counts. Reading them twice
    // would let the census and the classification disagree about the same files, and the whole point of
    // both is that they are the record of one moment.
    const bands = readBands() ?? {};
    const landedByAxis = new Map();
    for (const [axis, blocks] of Object.entries(bands))
      landedByAxis.set(axis, (blocks ?? []).filter((b) => b && typeof b.qid === "string" && b.qid).length);
    runLog(run.runDir, { event: "plan-execution-census", executed: joinRes.executed.length, missing: joinRes.missing.length,
      skipped: joinRes.skipped.length, deferred: (joinRes.deferred ?? []).length, unplanned: joinRes.unplanned.length,
      unplannedQids: joinRes.unplanned.slice(0, 8).map((u) => u.qid),
      landed: [...landedByAxis].map(([a, n]) => `${a}:${n}`) });
    if (joinRes.missing.length) {
      // The old throw was a lie of omission ("own no band block") — the provider's VERBATIM error for
      // each missing slice sits in the band's error blocks. Quote it, so the terminal diagnosis (and
      // the recovery classifier) see the actual cause: teal-causeway's three parks never surfaced the
      // HTTP 414 that was in the band file the whole time.
      const errByQid = new Map();
      for (const bandBlocks of Object.values(bands)) for (const b of bandBlocks) if (b && b.qid && b.error && b.reason) errByQid.set(b.qid, String(b.reason));
      const axisOutcome = new Map(fanInRepairs.map((r) => [r.target, r.outcome]));
      const byQid = new Map(ctx.registerPlan.entries.map((e) => [e.qid, e]));
      // — the decision is `fanInMissingEvidence` in repairs.mjs, next to TRANSIENT_RE and
      // DETERMINISTIC_RE. It reads per-slice evidence and falls back to the axis's repair outcome ONLY
      // when that axis landed no qid-stamped block at all; see its comment for why the old unconditional
      // fallback inverted the signal. The detail sentence and the failClass come out of the same pass.
      const { rows, failClass } = fanInMissingEvidence(joinRes.missing, {
        ownError: errByQid, axisOutcome, landedByAxis, axisOf: (qid) => byQid.get(qid)?.axis,
      });
      const detail = rows.slice(0, 6).map((r) => {
        // The quote is always shown; what CHANGES is whether it is presented as this slice's cause.
        // An axis outcome on an axis that landed other blocks is context — a repair was tried and this
        // is what it hit — and saying so is the difference between informing a reader and misleading
        // the ladder. The 414 that teal-causeway lost still reaches the terminal either way.
        if (r.source === "axis-context") return `${r.qid} ← no error of its own; axis "${r.axis}" repair hit: ${r.quote.slice(0, 140)} (axis landed other blocks — context, not this slice's cause)`;
        if (r.quote) return `${r.qid} ← ${r.quote.slice(0, 160)}`;
        return `${r.qid} ← no error block and no repair outcome — nothing ran this slice`;
      });
      // Once their recovery is spent, these are the searches not completed: each is added to its axis's band as the
      // executor's deferred block and delivered as an open row, reading that it was planned and never reached the
      // register (parts-not-completed.mjs).
      throw Object.assign(new StageFailure("fan-in", `register plan unexecuted after direct dispatch + followup — ${joinRes.missing.length} dictated qid(s) own no band block: ${detail.join("; ")}${joinRes.missing.length > 6 ? " …" : ""} (a clean can never ship over a slice the plan dictated and nothing ran)`, undefined,
        // `quantity` is the missing count — what CONVERGES across attempts (5 → 3 → 1 is a run closing
        // on the hole; 5 → 5 → 5 is one that has stopped). repairs.mjs progressQuantity cannot read it
        // out of this prose: its census table is an allowlist and this template is not in it, so the
        // ladder has been reading `unknown` here and a converging run looked plateaued.
        { failClass, repairs: fanInRepairs, quantity: joinRes.missing.length }),
        { notCompletedPart: "searches", excludedSlices: joinRes.missing.map((qid) => ({ axis: byQid.get(qid)?.axis, qid, reason: plainDeferralReason("slice-not-landed") }))
          .filter((x) => x.axis) });
    }
    runLog(run.runDir, { event: "plan-execution", executed: joinRes.executed.length, skipped: joinRes.skipped.length, unplanned: joinRes.unplanned.length,
      awaiting: joinRes.awaiting?.length ?? 0, asked: joinRes.asked?.length ?? 0,
      axes: skeleton.map((s) => `${s.axis}:${s.state}`) });
    // Decide the deferrals now — before placement-inquiry, which on the evidence run started one second
    // after this point on inputs the run had just recorded as unfinished.
    await settleEnvelopeAtReceipt("fan-in");
    }
  }

  // Machine-receipts contract gate (post-mortem §1b): a FRESH common-law run under a dictated key list
  // must save the grid stdout JSON (the validator already exact-joins it when present). A resumed run
  // that skipped the stage is exempt (archived/pre-machine-receipts artifacts are legacy by design).
  // One followup on the winning session asks for just the save; still missing ⇒ the run fails —
  // a new run silently on the legacy prose path would be the inference disease growing back.
  // A1 split: this lane is single-member only BY CONSTRUCTION — each half validator is ledger-or-fail
  // (its spec sidecar always dictates the grid), and mergeCommonLawArtifacts just wrote the canonical
  // ledger in code (a quarantined half's cells are already accounted as gaps), so under the split a
  // missing canonical ledger cannot reach here.
  if (!clSplit) {
    const cl = clMember();
    if (cl && ctx.gridVariants?.length && !cl.skipped && !existsSync(P.commonLawGrid)) {
      runLog(run.runDir, { event: "grid-ledger-missing", action: "warm-followup" });
      note("common-law: grid ledger missing after a fresh run — one warm save-followup");
      const followup = ctx.gridSpecPath
        ? repairFollowup("common-law:grid-ledger", { gridLedger: P.commonLawGrid, gridSpecPath: ctx.gridSpecPath })
        : repairFollowup("common-law:grid-ledger-no-spec", { gridLedger: P.commonLawGrid });
      must(await stage("common-law", ctx, { force: true, followup, sessionKey: cl.sessionKey, trigger: "grid-ledger" }), "common-law(grid-ledger)");
      if (!existsSync(P.commonLawGrid)) throw new StageFailure("common-law", "grid ledger never saved (machine-receipts contract)");
      runLog(run.runDir, { event: "grid-ledger-saved", recovered: true });
    }
  }

  // ── V4-4: coverage closure — a gap the machine can close itself never ships as a recommendation ──
  // At the point the run consumes the common-law findings on its way to synthesis (fresh, resumed, or
  // skipped — V4-1 semantics: this operates on the FILE, not on session events). Coverage-limited cells
  // not exempted by a mechanical-error gap/ledger entry get ONE corrective followup on the stage's
  // winning session, dictating exactly the missing variant×platform cells (batched at the profile-
  // derived ceiling, the convention). Whatever survives ships as a GENUINE attempted-and-unreachable front-matter
  // note with a priced offer — never as a "commission a re-run" recommendation (the S&I line-154
  // failure: the system knew the 91 missing cells, could close them for ~$0.12, and told the lawyer to
  // commission the work instead). The receipt (_driver/coverage-closure.json) is also the narrative
  // validator's conditional substrate. Idempotent across resumes: a receipt whose requested set equals
  // the current closable set means the pass already ran — don't re-spend; keep the note.
  // Cell source: the machine grid ledger's gaps when present (the substrate — each gap carries
  // the program's own error string), else the sanctioned prose vocabulary (inherited/legacy artifacts).
  // Register-only skips the pass entirely: with no grid there are no cells to close, and the fallback
  // prose path would read a common-law findings file that was never written.
  if (runCommonLaw) {
    // P2-A candidate-cardinality CENSUS (review problems 1 + 9) — the ONLY arm: how many hit cells
    // were received by a zero-candidates "No results" receipt. Advisory by construction, because
    // `candidates[]` is raw unjudged web-search output and relevance is the model's judgment; the
    // first cut gated on it and failed the delivered evidence run 221×. Asserted every run (0 is a
    // real answer, per the house rule) so drift in receipt vocabulary is watchable without a
    // brittle prose gate deciding deliveries. Matrix COMPLETENESS stays hard-gated in verify.mjs.
    try {
      if (existsSync(P.commonLawGrid) && existsSync(P.commonLaw)) {
        const om = findGridCandidateOmissions(readFileSync(P.commonLawGrid, "utf8"), readFileSync(P.commonLaw, "utf8"));
        runLog(run.runDir, { event: "common-law-candidates", denied: om.denied.length,
          sample: om.denied.slice(0, 3).map((v) => `${v.term}×${v.platform}(${v.candidates})`) });
        if (om.denied.length) note(`common-law candidates: ${om.denied.length} hit cell(s) received by a "No results" row (advisory census — relevance is the model's judgment; the honest form is "No similar listings (N candidates reviewed)")`);
      }
    } catch (e) { note(`common-law candidate census skipped (${String(e?.message ?? e).slice(0, 80)}) — never-kill`); }
    const closureReceiptPath = P.coverageClosure;
    const cellsOf = () => {
      const txt = readFileSync(P.commonLaw, "utf8");
      let cells;
      try {
        const ledgerRaw = existsSync(P.commonLawGrid) ? readFileSync(P.commonLawGrid, "utf8") : null;
        cells = findCoverageLimitedCells(txt, ledgerRaw);
      } catch { cells = findCoverageLimitedCells(txt); }   // unparseable ledger → prose fallback (the stage validator owns that failure)
      return partitionClosableCells(txt, cells);
    };
    let { exempt, closable } = cellsOf();
    const cellKey = (c) => `${c.variant} × ${c.platform}`;
    // A CHANNEL THE FRAME-DIFF NAMED IS NOT FOLDED IN HERE. It is disclosed as an open row, never swept (the
    // frame-reopen above defers it as a channel never swept), so this pass closes grid cells and nothing else.
    // The signature keeps its second slot, empty, so a receipt written for the same cells still matches.
    const priorReceipt = existsSync(closureReceiptPath) ? readJson(closureReceiptPath) : null;
    const closureSig = JSON.stringify([closable.map(cellKey).sort(), []]);
    const alreadyAttempted = priorReceipt && (priorReceipt.sig === closureSig ||
      // back-compat: a pre-doc-35 receipt keyed only on the cell set
      (priorReceipt.sig == null &&
        JSON.stringify((priorReceipt.requested ?? []).map(cellKey).sort()) === JSON.stringify(closable.map(cellKey).sort())));
    // SIZED BY THE CELLS A CLOSURE GRID RUNS, as the main grid is (gridBatchFor): its spec carries only the
    // platforms of the cells it closes.
    const closureBatch = (cells) => gridBatchFor(ctx.profile, new Set(cells.map((c) => c.platform)).size);
    if (closable.length && !alreadyAttempted) {
      const requested = closable;
      const variants = [...new Set(closable.map((c) => c.variant))];
      const batchSize = closureBatch(closable);
      const batches = Math.max(1, Math.ceil(variants.length / batchSize));
      const gridCalls = batches;   // grid call(s) (tokens-only: no $ estimate)
      note(`coverage closure: ${closable.length} machine-closable cell(s) — one supplementary grid pass (${gridCalls} grid call(s))`);
      // Fix-1: the driver DICTATES a supplementary grid SPEC for a set of closable cells (a subset of the
      // canonical grid) and the PLUGIN writes the ledger from the API response — never an agent hand-append
      // (the grid_ledger_unparseable class). Connotation is OMITTED (caveat 4): meaning was swept in the
      // main gather and the identity join (findDroppedConnotationQueries) lives at the canonical fan-in,
      // which ran already — a supp spec must never re-run it. The driver folds the plugin-written ledger in
      // code below (mergeGrids: union cells, extras.pr_risk survives, gaps recomputed against the full spec).
      const buildSuppSpec = (cells, half) => {
        const spec = {
          terms: [...new Set(cells.map((c) => c.variant))],
          platforms: [...new Set(cells.map((c) => c.platform))],
          // A grid the frame decided is blocks, so its gaps are too: re-running them as one product would
          // ask cells the grid never dictated. One product still reads exactly as before.
          ...closureBlocksOf(cells),
          output_path: P.commonLawGridSupp(half, "closure"),
          batch: batchSize,
          ledger_required: true,
          ...(half ? { half } : {}),
          ...resultsPerCellOf(ctx.searchPolicy),
        };
        atomicWrite(P.gridSpecSupp(half, "closure"), JSON.stringify(spec, null, 2) + "\n");
        return spec;
      };
      if (!clSplit) {
        const suppSpec = closable.length ? buildSuppSpec(closable, null) : null;
        const followup = repairFollowup("common-law:coverage-closure", { findingsFile: P.commonLaw, suppSpec, suppSpecPath: P.gridSpecSupp(null, "closure"), closable, cellKey });
        const r = await stage("common-law", ctx, { force: true, followup, sessionKey: clMember()?.sessionKey, trigger: "coverage-closure" });
        if (!r.ok) note(`coverage closure pass failed mechanically (${r.fail}) — surviving cells ship as the genuine limitation`);
        // Fold AFTER the stage returns ok (caveat 3): the stage re-validated the UNCHANGED canonical ledger
        // (the plugin never touched it — it wrote only the supp), so grid_ledger_unparseable is structurally
        // impossible on this lane. Now union the plugin-written supp into the canonical in code. The full spec
        // is read from the stable _driver/grid-spec.json (resume-safe — ctx.gridSpecPath may be null on a
        // resume where the gather-spec block did not re-run). A missing supp/spec/canonical skips the fold:
        // the closable cells then stay plugin-recorded gaps → closable → ship as an honest limitation (never
        // silently closed). mergeGrids is union-only, so a re-fold on resume is idempotent.
        if (r.ok && suppSpec) {
          const specPath = ctx.gridSpecPath || P.gridSpec;   // — the declared path, not a second literal
          if (existsSync(suppSpec.output_path) && existsSync(P.commonLawGrid) && existsSync(specPath)) {
            try {
              const fullSpec = readJson(specPath);
              const merged = mergeGrids(readJson(P.commonLawGrid), readJson(suppSpec.output_path), { spec: fullSpec });
              atomicWrite(P.commonLawGrid, JSON.stringify(merged, null, 2) + "\n");   // B5 — the canonical ledger is never seen torn
              runLog(run.runDir, { event: "common-law-supp-folded", lane: "coverage-closure", cells: merged.cells.length, gaps: merged.gaps.length });
            } catch (e) { note(`coverage closure: supplementary fold skipped (${String(e.message).slice(0, 80)}) — closable cells stay disclosed gaps`); }
          }
        }
      } else {
        // A1 SPLIT — followup ROUTING: each closable cell goes to the half-session that OWNS its term
        // (the deterministic partition, via ctx.clHalfTerms); a cell whose owner half has no usable
        // session this process (quarantined) re-routes to the OTHER live half — any live common-law
        // session can run a dictated supplementary cell, and the merge unions by term|platform
        // regardless of which half's ledger carries it. Every followup targets the HALF artifacts (the
        // halves stay the source of truth); the code re-merge below refreshes the canonical pair before
        // cellsOf() re-reads it.
        const usable = (h) => Boolean(clHalves[h].sessionKey && !clHalves[h].quarantined);
        // item 25 — the closure set is partitioned EVENLY at dispatch, not routed through halfOfTerm.
        //
        // halfOfTerm is right for the FRESH gather: it is a pure function of the term, every followup
        // finds its work by asking it, and the two halves come out 1.4x apart. It is wrong here. The
        // reopen re-runs a SUBSET chosen by what failed, and that subset does not respect the term
        // partition at all — on the evidence run one half drew 857s of closure work and the other 100s,
        // because the closable cells happened to belong to one side.
        //
        // So the reopen partitions what it is actually re-running, deterministically (sorted by cell
        // key, dealt round-robin), and records the partition. halfOfTerm is untouched and nothing
        // durable is written: a followup can still find its work because it DICTATES its cells by name.
        // This is the balance the N-worker queue was proposed for, without spending the pure partition
        // every followup depends on.
        const usableHalves = GRID_HALVES.filter(usable);
        const bal = balanceClosureCells(closable, usableHalves, cellKey);
        const cellJobs = Object.fromEntries(GRID_HALVES.map((h) => [h, bal.assigned[h] ?? []]));
        for (const cell of bal.unassigned)
          note(`coverage closure: no usable common-law half-session for ${cellKey(cell)} — ships as the genuine limitation`);
        if (closable.length)
          runLog(run.runDir, { event: "closure-partition", cells: closable.length,
            per_half: Object.fromEntries(GRID_HALVES.map((h) => [h, cellJobs[h].length])),
            unassigned: bal.unassigned.length });
        // CONCURRENCY (2026-07-13): the two half followups run CONCURRENTLY on their OWN half keys,
        // each a fresh session (the same runBatched fan-out that dispatched the half gather members) — the halves are
        // independent, so serializing them only doubled the closure wall.
        await runBatched(GRID_HALVES, config.gatherConcurrency, async (h) => {
          const cells = cellJobs[h];
          if (!cells.length) return;
          const suppSpec = buildSuppSpec(cells, h);
          const followup = repairFollowup("common-law-half:coverage-closure", { findingsFile: P.commonLawHalf(h), gridSpecPath: P.gridSpecHalf(h), suppSpec, suppSpecPath: P.gridSpecSupp(h, "closure"), cells, cellKey });
          const r = await stage("common-law-half", { ...ctx, axis: h }, { force: true, followup, sessionKey: clHalves[h].sessionKey, trigger: "coverage-closure" });
          if (!r.ok) note(`coverage closure pass (half ${h}) failed mechanically (${r.fail}) — surviving cells ship as the genuine limitation`);
        });
        // The plugin wrote each half's supplementary ledger; the extended readHalfLedger folds it with the
        // UNCHANGED main half ledger (both plugin-written) into the canonical pair — fold-after-stage, so the
        // stage re-validated the untouched main ledger and grid_ledger_unparseable is impossible on this lane.
        // (Through the connotation-remedy wrapper: a closure re-emit that dropped the disposition rows gets
        // its one routed repair here too, if the fan-in round did not already spend it.)
        await mergeWithConnotationRemedy();   // the halves changed — re-derive the canonical pair before re-reading
      }
      ({ exempt, closable } = cellsOf());
      const receipt = { ts: new Date().toISOString(), requested: requested, sig: closureSig,
        closed: requested.length - closable.length, remaining: closable, exempt, gridCalls };
      writeFileSync(closureReceiptPath, JSON.stringify(receipt, null, 2) + "\n");
      runLog(run.runDir, { event: "coverage-closure", requested: requested.length,
        closed: receipt.closed, remaining: closable.length, exempt: exempt.length, gridCalls });
    } else if (closable.length || exempt.length) {
      runLog(run.runDir, { event: "coverage-closure", requested: 0, closed: 0,
        remaining: closable.length, exempt: exempt.length, gridCalls: 0,
        reason: alreadyAttempted ? "already attempted this gap set" : "all gaps exempt (mechanical failures)" });
    }
    if (closable.length || exempt.length) {
      // Tokens-only (owner directive 2026-07-11): the offer names the work (grid calls), never a $ figure.
      const batchesLeft = Math.max(1, Math.ceil([...new Set(closable.map((c) => c.variant))].length / closureBatch(closable)));
      const offer = ` — closable on instruction (${batchesLeft} supplementary grid call(s))`;
      ctx.coverageNote = `marketplace cells not executed: ${[...closable, ...exempt].map(cellKey).join("; ")}` +
        (closable.length ? ` — attempted in-loop and still unreachable${offer}` : "") +
        (exempt.length ? ` (${exempt.length} cell(s) behind a mechanical platform failure — see the Coverage ledger)` : "");
    }
  }
  return { planExec, unitKey, dispatchPlanQids };
}
