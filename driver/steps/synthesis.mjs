// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/synthesis.mjs — the writer, the case-law grounding and the first review.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { caseLawSourceRows } from "../case-law-sources.mjs";
import { caseLawInventory } from "../config-inventory.mjs";
import { parseFindingsJsonLenient } from "../findings-model.mjs";
import { note, runLog } from "../log.mjs";
import { readPartNotCompleted } from "../parts-not-completed.mjs";
import { assembleRunRecords, extractEnforcerSignals } from "../registry-fidelity.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export async function runSynthesis({ P, checkLateBind, ctx, job, opts, run }, helpers) {
  const { asPartNotCompleted, composeDispatchExtra, decideCaseLaw, goodsEvidenceForTheWriter, keepGoodsEvidenceAsWritten, prepareDeclinationSpec, quarantineSynth, readCoverageJudgment, recordSynthesisSeam, refute, settleDerivedBases, stage, stageCharter } = helpers;
  // Steps 3/3.5/4 synthesis → optional 4.5 case-law grounding ∥ Step 4.7 refutation.
  // case-law and refutation are independent siblings of synthesis (case-law reads narrative.md;
  // refutation reads the source files, NOT case-law), so they run concurrently — saves ~one stage's
  // wall. The verdict-gated corrective re-synthesis below stays strictly AFTER this join.
  await checkLateBind("pre-synthesis");   // B5b checkpoint 3: a bind here re-classifies via one warm re-digest
  // D2 — surface provider enforcement telemetry (onomaticsAggression / onomaticsOppositions
  // on fetched records) as a structured aim-attention artifact for synthesis. Best-effort; NEVER a
  // rating rule (explicitly not the rejected escalation filter) — absence writes nothing.
  try {
    const { records } = assembleRunRecords(run.runDir, `clearance-${run.slug}-${run.codename}-`);
    const signals = extractEnforcerSignals(records);
    if (signals.length) {
      writeFileSync(`${P.enforcerSignals}.tmp`, JSON.stringify({ signals }, null, 2) + "\n");
      renameSync(`${P.enforcerSignals}.tmp`, P.enforcerSignals);
      ctx.enforcerSignals = signals.length;
      runLog(run.runDir, { event: "enforcer-signals", records: signals.length });
    }
  } catch (e) { note(`enforcer-signals extraction skipped (non-fatal): ${String(e.message).slice(0, 80)}`); }
  // Phase 4 slice 3 — jx-nativeread:zh (SHADOW): the lane model reads the code-inlined zh evidence
  // slice (register unit output + candidates + CNIPA notes + judged grid findings) and writes the
  // aim-attention artifact under _driver/jx/. Runs post-gather so the slice exists; never-kill.
  // item 8 — the CLEAROTRON_JX_NATIVEREAD and CLEAROTRON_JX_CONSUME arms are gone. What is left is the
  // product carrying jxLanes; jxAimForSynthesis still returns null on a KILLED lane or an artifact
  // with no items, so a run that has nothing to consume still leaves ctx.jxAim unset and the synthesis
  // message byte-identical. The unit itself refuses with a stated cause on every other condition.
  if (ctx.searchPolicy?.components?.jxLanes) {
    const { runJxNativeread, jxAimForSynthesis } = await import("../jx-units.mjs");
    const nr = await runJxNativeread(ctx, job, opts, { runLog: (d, row) => runLog(d, row), note });
    if (nr.cause && !nr.ran) runLog(run.runDir, { event: "jx-nativeread-skipped", cause: nr.cause });
    const aim = jxAimForSynthesis(run.runDir);
    if (aim) { ctx.jxAim = aim.count; runLog(run.runDir, { event: "jx-aim-consumed", items: aim.count }); }
  }
  // — the FRESH dispatch carries the driver-computed structural blocks, through the same
  // composer `refute()` uses.
  //
  // WHICH OTHER SYNTHESIS DISPATCHES CARRY THEM, stated from the code rather than from the premise
  // this comment used to assert. The first cut said `stageOnce` ignores `extra` when `followup` is
  // set, and that the resumed seat already holds the blocks. BOTH ARE FALSE and the file says so:
  // pipeline.mjs's `stageOnce` passes `extra` into `composeFollowup` on the followup arm and appends
  // it on the cold arm — A-1 changed that deliberately, because the old drop-it behaviour rested on
  // the same wrong premise — and composeFollowup's own doc block records that a followup dispatch is
  // NOT a resumed session but a fresh attempt 1, so it holds nothing of its own.
  //
  // The true reason the followups do not carry the blocks is simply that they pass no `extra`:
  // they are targeted corrections to work that exists, and their message is the correction. That is a
  // live choice, not a mechanism that forbids it — the corrective re-synthesis below could be given
  // the blocks by passing `extra`, and if a corrective pass is ever found rewriting a coverage claim
  // it cannot support, that is the lever. The stale-repair entry in UPSTREAM_STALE_REPAIR is a COLD
  // dispatch and now composes them, for the reason recorded there.
  prepareDeclinationSpec(ctx, P);   // — the findings-surface list, printed forward and written for the tool
  const { text: synthExtra } = composeDispatchExtra("synthesis", ctx);
  // THE OVERALL ASSESSMENT'S OWN FAILURE IS NAMED WHERE IT IS THROWN. Only this call: the corrective and post-repair
  // passes below run on a record that exists, and their failures are theirs. A failure named here, once its recovery
  // is spent, is recorded as the assessment not completed and delivered without it (the run-level catch), never
  // ended on.
  // The goods evidence this writer is given is kept as written by its stage (around `stage`), and kept here too where
  // the record comes from the salvage after a failed dispatch: a re-emit, or the record taken with its foreign links
  // blanked, completes the record that dispatch wrote on that evidence.
  const writersEvidence = goodsEvidenceForTheWriter("synthesis", ctx);
  const synth = await asPartNotCompleted("assessment", async () =>
    quarantineSynth(await stage("synthesis", ctx, synthExtra ? { extra: synthExtra } : {}), ctx, "synthesis"));   // A3: last-resort quarantine instead of must(); A4: one targeted re-emit inside
  keepGoodsEvidenceAsWritten(ctx, synth, writersEvidence);
  recordSynthesisSeam(ctx, synth);   // half one — which surfaced records this pass delivered, and which it did not
  // The corrective re-synthesis is dispatched on the WINNING attempt's key AND model/thinking. A followup's first
  // attempt starts fresh, and it never resumes the synthesis session (no engine resumes by key); but if synthesis
  // fell over to a cross-provider model, a dispatch on the base model would correct a record another model wrote.
  const synthesisKey = synth.sessionKey, synthesisModel = synth.model, synthesisThinking = synth.thinking;

  // A2/A4 — the v3 evidence gates (verified-needs-source, symmetric use-check, client-tier
  // join) key on the schema_version the artifact DECLARES; a down-level emission on a fresh run
  // would silently disengage them. Demand the dictated version ONCE (warm resume); a still-down-
  // level file is logged loudly and rides on — deliver-always, weaker-gates-visible.
  const readSchemaVersion = () => {
    try { return parseFindingsJsonLenient(readFileSync(P.findings, "utf8")).schemaVersion ?? 1; } catch { return null; }
  };
  const declaredSv = readSchemaVersion();
  // doc 50 — the dictation demands schema_version 4 (band-rated under the framework in force).
  // The demand fires ONLY when synthesis actually RAN this turn: a skip-resumed stage (a parked run
  // whose prior v3 findings.json still validates on the legacy path) keeps its declared version —
  // forcing a mid-run contract switch across the deploy boundary would burn a followup fighting
  // the run's own frozen artifact. Logged loudly instead; that run's gates judge it as v3.
  if (declaredSv !== null && declaredSv < 4 && synth.skipped) {
    note(`[findings] schema_version ${declaredSv} retained on a resumed run (pre-doc-50 artifact) — v${declaredSv} gates apply; no re-emit demanded`);
    runLog(run.runDir, { event: "findings-schema-legacy", declared: declaredSv });
  }
  if (declaredSv !== null && declaredSv < 4 && !synth.skipped) {
    note(`[findings] schema_version ${declaredSv} < 4 — the dictated band rating is missing; demanding the re-emit`);
    // This one keeps the FULL re-emission on purpose, against the targeted-edit rule the other corrective
    // followups now follow. A down-level file is not a valid document with one defect in it — it is the
    // WRONG CONTRACT throughout: every rated object's vocabulary changes, the retired composite/level/
    // dispute_type keys come out, and a new top-level field goes in. There is no small set of named lines
    // to patch, so a whole-file emission is the honest shape of the work rather than an expensive way to
    // avoid one. Do not "fix" this to an Edit on a later sweep.
    await stage("synthesis", ctx, {
      force: true, sessionKey: synthesisKey, model: synthesisModel, thinking: synthesisThinking,
      trigger: "schema-downlevel",
      followup: repairFollowup("synthesis:schema-downlevel", {
        findings: P.findings, declaredSv,
        frameworkKey: ctx.framework?.framework_key ?? "house-default",
        bandLabels: (ctx.framework?.bands ?? []).map((b) => b.label),
      }) + stageCharter("synthesis", ctx.depth, ctx.framework),
    });
    const afterSv = readSchemaVersion();
    if (afterSv !== null && afterSv < 3) runLog(run.runDir, { event: "findings-schema-downlevel", declared: afterSv });
  }

  // spec 64 — the typed forward-action register. The disposition derivation (legalActions arm of the
  // deliver-conditional floor) keys on actions[]; a v4 emission that omits the field entirely would
  // silently disengage it — the exact CLEAR-despite-conditions bug this ships to fix. Same posture as
  // the schema-downlevel demand above: ONE warm re-demand, only when synthesis actually RAN this turn
  // (a resumed pre-change artifact keeps its shape — logged loudly, gates degrade); still-absent
  // after the demand is logged and rides on (deliver-always, the reviewer's actions-unregistered flag
  // and the predelivery coherence lint remain the nets).
  const readActionsPresence = () => {
    try {
      const d = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
      return { sv: d.schemaVersion ?? 1, hasActions: Array.isArray(d.actions), quarantined: d.actionsQuarantined ?? [] };
    } catch { return null; }
  };
  const actionsProbe = readActionsPresence();
  if (actionsProbe && actionsProbe.sv >= 4 && !actionsProbe.hasActions && synth.skipped) {
    note(`[findings] actions[] absent on a resumed run (pre-spec-64 artifact) — the actions floor is disengaged for this run; no re-emit demanded`);
    runLog(run.runDir, { event: "findings-actions-legacy" });
  }
  if (actionsProbe && actionsProbe.sv >= 4 && !actionsProbe.hasActions && !synth.skipped) {
    note(`[findings] actions[] missing — the dictated forward-action register is absent; demanding the re-emit`);
    await stage("synthesis", ctx, {
      force: true, sessionKey: synthesisKey, model: synthesisModel, thinking: synthesisThinking,
      trigger: "actions-missing",
      followup: repairFollowup("synthesis:actions-missing", { findings: P.findings, narrative: P.narrative }) + stageCharter("synthesis", ctx.depth, ctx.framework),
    });
    const after = readActionsPresence();
    if (after && !after.hasActions) runLog(run.runDir, { event: "findings-actions-absent" });
  }
  // A lenient-dropped action is NEVER silent: a lost condition could flip the derived disposition.
  if (actionsProbe?.quarantined?.length)
    runLog(run.runDir, { event: "findings-actions-quarantined", n: actionsProbe.quarantined.length, errors: actionsProbe.quarantined.map((q) => String(q.error ?? "").slice(0, 80)) });

  // ── P2-A (charter P2c) — READ-BEFORE-RATE, DERIVED ────────────────────────────────────────
  // `basis: "verified-from-record"` means THE RUN CAN PROVE IT. The model never self-attests a read.
  // So the driver writes the field: every meter citing a register record the reading log cannot back
  // is demoted to `inferred-from-signal` here, in code, at the moment the claim would otherwise stand.
  //
  // WHAT THIS REPLACED, and why the replacement is not weaker. Until this was a THIRD SYNTHESIS
  // PASS: the same join, computed, then handed back to the model as a warm resume that re-read the
  // records and re-rated the meters. It cost 771.7 / 510.8 / 535.9 s on three of the round's four
  // runs — ~10 serial minutes each — and returned `violations: 0` every time. It was a correct
  // mechanism paying for a whole extra synthesis to re-assert what the log already knew.
  //
  // It also could not see two things a derivation sees for free:
  //   · it ran ONCE, before refutation. Re-derived on the four delivered findings.json files it
  //     measured, its own counts do not hold: 35→37, 28→31, 37→38, 41→40. Stamps entered the
  //     deliverable after the only pass that policed them.
  //   · `off_disk` was never a violation, so a stamp citing a record the run never fetched AT ALL was
  //     waved through. the 2026-08-10 R6 shipped on {"stamped":19,"read":0,"off_disk":19,"violations":0}.
  //
  // The rating stays the lawyer's — nothing here re-rates, re-bands or withholds. Only the evidence
  // LABEL moves, and only downward, to what the machine can show. Never-kill: a settle that cannot
  // read its own inputs logs and rides on, exactly as the pass did.
  settleDerivedBases(ctx, "post-synthesis");

  let narrative = readFileSync(P.narrative, "utf8");

  // ── judgment-relocation (revised 2026-06-24): the COVERAGE SUFFICIENCY signal — deliver-conditional, never
  // command/halt. Layer B (synthesis) read the COMPLETE named band + the `incomplete` crowd descriptors and
  // emitted coverage_judgment {sufficient, reason} into findings.json. Its ONLY effect on the run is the
  // VERDICT: sufficient:false (the lawyer judged a material slice not fully cleared) clamps CLEAR→CONDITIONAL
  // with an honest flag in the verdict block below, then DELIVERS. There is NO funnel re-search re-loop (slow +
  // fragile mid-pipeline) and NO no-deliver halt (a lawyer always gets something unless a TECHNICAL failure
  // occurs). The dangerous named band is already enumerated to completeness (the fan-in band gate guarantees
  // it crossed), so a conditional here covers a GENUINE residual the lawyer flagged, not a sampled-and-hidden
  // miss. An immaterial `incomplete` (off-field noise crowd) → sufficient:true → no clamp → deliver clean.
  const coverageJudgment = readCoverageJudgment(P);
  if (coverageJudgment.present)
    runLog(run.runDir, { event: "coverage-judgment", sufficient: coverageJudgment.sufficient, reason: coverageJudgment.reason.slice(0, 120) });

  // ── Customer-unknown runs (2026-06-18): NO candidate-self gate. A missing applicant is non-blocking and
  // never special-cases the report — an identical/near-identical hit is an ordinary finding at its real
  // tier, counted in the overall rating, carrying only a neutral "if this is the applicant's own prior
  // filing, disregard" note (instructed in the synthesis/report stage prompts, stages.mjs). The old gate
  // that re-synthesised "is this you?" treatment and went fatal on survival was removed: downranking an
  // identical hit and excluding it from the rating could bury a real conflict, and a missing applicant
  // must never fail the run. (Late-bind still re-classifies the applicant's own marks out of the adverse
  // tiers when a customer arrives mid-run — see the matter-frame/digest re-classification followups.)
  const caseLaw = decideCaseLaw({ job, narrative, policy: ctx.searchPolicy });
  const needCaseLaw = caseLaw.run;
  // — WRITTEN UNCONDITIONALLY (the AD-4 instrumentation house rule), because the state worth
  // recording is now the one where the stage does NOT run. A row emitted only when it runs cannot
  // distinguish "the reading called for case law and this product does not carry it" from "nothing
  // called for it", and the first of those is the observation the ruling asked to keep.
  //
  // The territories ride along, read from the frozen instructed scope rather than re-derived: what a
  // later reader wants is "a case-law question exists in territory X", and X is not reconstructable
  // from this row otherwise. This is `_driver/` data. It reaches no report and no email — no wording
  // enters a deliverable that the owner has not agreed, and that includes a sentence built from this.
  runLog(run.runDir, {
    event: "case-law-decision", run: caseLaw.run, requested: caseLaw.requested, detected: caseLaw.detected,
    eligible: caseLaw.eligible, product: caseLaw.product, trigger: caseLaw.trigger, declined: caseLaw.declined,
    jurisdictions: (() => { try { return JSON.parse(readFileSync(P.instructedScope, "utf8"))?.jurisdictions ?? null; } catch { return null; } })(),
  });
  if (caseLaw.declined)
    note(`[case-law] the draft narrative turns on "${caseLaw.trigger}", and a ${caseLaw.product ?? "run with no resolved product"} does not carry the case-law reading — recorded, not run`);
  if (needCaseLaw) runLog(run.runDir, { event: "case-law-trigger", requested: caseLaw.requested, detected: caseLaw.detected });
  // T7 (E5): feed the finding index so the case-law stage stamps "- ord:" on each grounded
  // profile — the render + report-card joins become deterministic (copper-spire's prompt-fished join
  // reached 2 of 3 cards).
  try {
    const fdoc = parseFindingsJsonLenient(readFileSync(P.findings, "utf8"));
    ctx.findingsIndex = (fdoc?.findings ?? []).filter((f) => f.disposition !== "withdrawn")
      .map((f) => ({ ordinal: f.ordinal, mark: f.mark, owner: f.owner?.name ?? null }));
  } catch { ctx.findingsIndex = []; }
  // — WHICH CASE-LAW SOURCES THIS DEPLOYMENT HAS, handed to the stage inline.
  // The seat's tool layer reports an un-enrolled bridge as a CONFIGURED server that closed the
  // connection, because the bridges are declared to every case-law session regardless of enrolment and
  // exit at start-up for want of a token. That wording is true of the plumbing and false of the
  // deployment, and it is where a delivered report's "sources unreachable — infrastructure gap" came
  // from on a box that had never enrolled either source. Read from the SAME inventory the portal's
  // product card reads, so the two surfaces cannot give a client two accounts of one fact. Best-effort:
  // an inventory that cannot be read hands the stage nothing, and the dictation then says nothing about
  // sources rather than asserting a readiness nobody measured.
  try {
    // COMPOSED BY THE MODULE THAT READS IT. This mapping used to be inline here
    // and rebuilt by hand in an arm — two authors for one shape, and the arm's copy went stale the
    // moment this one gained a field, while still passing. `caseLawSourceRows` is now the only place
    // it is written, and it carries `checked` so an UNREADABLE credential reaches the composer as a
    // could-not-look rather than as a source this deployment does not have.
    ctx.caseLawSources = caseLawSourceRows(caseLawInventory(process.env));
  } catch { ctx.caseLawSources = []; }
  // THE FIRST REVIEW, WHERE IT COULD NOT BE COMPLETED (parts-not-completed.mjs). Its recovery was spent, so the report
  // delivers the rated findings with the band alone and no verdict sentence, as a review that signs nothing already
  // renders. No sign-off is recorded, because nobody gave one, and the corrective pass, which answers a review's
  // flags, has none to answer. The workbook's shipped "Machine QC" row records the review as not completed: it reads
  // the review's last attempt, which failed, and nothing runs it again on this pass.
  const reviewOpen = readPartNotCompleted(run.runDir, "review");
  if (reviewOpen) runLog(run.runDir, { event: "review-not-completed-delivery", stage: reviewOpen.stage ?? null });
  const [caseLawRes, firstRef] = await Promise.all([
    needCaseLaw ? stage("case-law", ctx) : Promise.resolve(null),   // non-fatal: a citation gap degrades, not blocks
    reviewOpen ? Promise.resolve({ ok: true, verdict: null, notCompleted: true }) : refute(ctx),
  ]);
  if (caseLawRes && !caseLawRes.ok) note(`case-law grounding failed (non-fatal): ${caseLawRes.fail}`);
  return { synthesisKey, synthesisModel, synthesisThinking, coverageJudgment, reviewOpen, firstRef };
}
