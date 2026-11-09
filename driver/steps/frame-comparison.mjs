// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/frame-comparison.mjs — the blind frame compared with what the run scoped, and the reopen that acts on it.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { driverDir } from "../../shared/driver-dir.mjs";
import { verifyRegisterDirectiveClose } from "../close-verify.mjs";
import { pendingItems } from "../digest-queue.mjs";
import { countedOnLists, heldAnswers, refuseCountedOnList, refuseHeldQuestions } from "../engine/mcp/held-answers.mjs";
import { mintSupplementalEntries, withRejected } from "../engine/mcp/supplemental.mjs";
import { addedClassBound, alreadyAttemptedReopen, applyDominantBackstop, deriveDirectiveRemedy, firingDirectives, firingDirectivesLenient, jurisdictionScopeFlags, parseFrameDiff, partitionFiring, remedyProposals, reopenKey } from "../frame-diff-model.mjs";
import { boundDominantElementFrom } from "../frame-diff-record.mjs";
import { canonicalJurisdictionCode } from "../jurisdiction-codes.mjs";
import { note, runLog } from "../log.mjs";
import { atomicWrite } from "../progress.mjs";
import { blocksByQidOf, foldSupplementalEntries, joinPlanToBands, pendingRequiredQids, refuseWithheldFamilies, searchedJurisdictionsFromPlan, withheldFamilyTwins } from "../register-plan.mjs";
import { registerCapabilities } from "../register-unreachable.mjs";
import { accountRemedyTerms, domClosedOverAccounted, remedyAccountingEvent } from "../remedy-accounting.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { parseScopeLedgerJson, scopeJurisdictions } from "../scope-ledger.mjs";
import { lines } from "../stages.mjs";
import { readWithheldFamilies, releasedFamilyQids } from "../withheld-families.mjs";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export async function runFrameComparison({ P, axes, ctx, dispatchPlanQids, flushDigestQueue, job, mintDigestWork, planExec, run, runCommonLaw, unitKey }, helpers) {
  const { bandBytesOf, deriveNamedBand, forceFromActive, inScopeClassList, joinOptions, loadCoverageLedger, mechanicalFormGapDirectives, readRegisterBands, refreshSupplementalExecution, remergeIfBandsMoved, settleOneShotStamp, stage } = helpers;
  // ── Property 1+2 (frame-omission design): the blind frame-diff + the reopen channel ────────────────
  // The blind-frame stage re-derived the threat model STARVED of the matter frame (gather, parallel with
  // the sweeps). Diff that cold model against what the run ACTUALLY scoped/searched (frame-diff), and act
  // on the gaps: a targeted SUPPLEMENTAL SWEEP of the missing variant/field/source, then ONE re-digest
  // followup — generalizing the screen-gate's re-digest channel from commission (a drop without a
  // fetch) to OMISSION (a layer never scoped). Bounded exactly like escalation/envelope/coverage-closure:
  // an idempotency receipt (set-equality on the firing directives), ONE re-digest per pass, a byte-diff
  // guard, NO in-process re-diff, one-shot (CLEAROTRON_FRAME_REOPEN_MAX). Same digest-lock as escalation:
  // never re-fire past synthesis on a resume (the directives still compute + flag + clamp, but the
  // sweep/re-digest do not run — they would corrupt the audit spine). The whole block is NON-FATAL.
  //
  // (2026-08-03): THIS BLOCK MOVED, from below the screen-gate to here — above placement-inquiry and
  // below coverage-closure. What it does is unchanged; WHEN it runs is the change, and the reason is that
  // placement used to be dispatched twice (once on the pre-reopen band, once again by the reopen itself).
  // The frame settles first, placement runs once on the settled frame. It stays BELOW coverage-closure
  // deliberately: above it, the dormant doc-35 source-channel arm (which reads _driver/frame-reopen.json
  // and would find it present for the first time) wakes up on every run with an un-swept channel. That is
  // a real lever and a real behaviour change, and it is a separate decision — kept dead exactly as today.
  //
  // ZERO SEMANTICS (the review question this block has lost seven bugs to): after the move, "the reopen
  // produced no directives" and "the reopen never ran" must not read alike. Every ending below logs, and
  // they are distinct in run.jsonl: no blind model ⇒ `frame-diff-skipped` reason:"no-blind-model"; the
  // stage failed ⇒ `frame-diff-skipped` reason:<the failure>; the stage ran and the frame is settled ⇒
  // `frame-diff` with firing:0 and no reopen event; the reopen ran ⇒ `frame-reopen` (or
  // `frame-reopen-skipped`) carrying domClosed. An absent `frame-diff` event means the block did not
  // execute — it never means a clean diff.
  ctx.frameReopenGap = false;
  if (!existsSync(P.blindFrameModel)) {
    // blind-frame failed or was never run: there is no cold model to diff against, so no frame question
    // is asked this run. Recorded, because the alternative is an artifact set in which "asked and clean"
    // and "never asked" look identical.
    runLog(run.runDir, { event: "frame-diff-skipped", reason: "no-blind-model" });
  }
  if (existsSync(P.blindFrameModel)) {
    const fd = await stage("frame-diff", ctx);
    let parsed = null;
    if (!fd.ok) {
      note(`frame-diff failed (non-fatal — no reopen this run): ${fd.fail}`);
      runLog(run.runDir, { event: "frame-diff-skipped", reason: fd.fail });
      // P2-B (the ask contract's other half): far less dies silently. frame-diff is non-fatal, so an
      // exhausted repair ladder used to leave NO trace at all — and when the exhausted defect is
      // `framediff_directive_undispatchable` the stage was in the middle of raising a real omission
      // it could not state as a search. That is precisely the ask the lawyer must still see. Write
      // the reopen receipt with the deferral so the existing disclosure spine picks it up
      // (frameResidualGaps → the report's material gaps, and the ask ledger's frame-diff lane).
      //
      // ONE ROW PER OMISSION (2026-07-31 review round). This wrote a single row scraped out of
      // `fd.fail` — and `fd.fail` is a 160-char slice (verify.mjs) of a message that may name four
      // omissions, so three of four vanished: no coverage row, no ask, no trace. Silent recall loss
      // on the exact path built to prevent it. The offenders are therefore re-derived from the
      // ARTIFACT the stage last saved, which names all of them and names them untruncated. Chain,
      // in order: recompute from disk → scrape the (truncated) token → one generic row. The last
      // two exist because the artifact can be missing or itself unreadable at exhaustion, and a
      // disclosure that only fires on a well-formed artifact is not a disclosure.
      //
      // THE CLAIM'S OWN LIMIT, stated rather than left implied (N3, 2026-07-31 second review round):
      // this gates on `fd.fail` — the LAST attempt's token. A ladder whose earlier attempts raised
      // `framediff_directive_undispatchable` but whose final attempt failed for some other reason
      // (a structural or schema defect on the re-save) leaves this block unentered and discloses
      // nothing. So "nothing dies silently" would be an overclaim: what is true is that the ONE
      // ending this branch was built for — the ladder exhausting ON the undispatchable defect — no
      // longer loses its omissions, and that it loses none of them rather than three of four.
      // Widening it to any attempt in the ladder means carrying the token forward through
      // stageOnce's attempt loop, which is a change to the stage contract, not to this branch.
      if (/framediff_directive_undispatchable/.test(String(fd.fail ?? ""))) {
        try {
          const rp = driverDir(run.runDir, "frame-reopen.json");
          const prior = existsSync(rp) ? JSON.parse(readFileSync(rp, "utf8")) : {};
          // EVERY firing directive, not only the offenders: when this stage fails, `parsed` stays
          // null and the whole reopen block below is skipped, so a firing directive that WAS
          // dispatchable dies here just as silently as one that was not. The 2026-07-29 artifact
          // has five firing directives and four offenders — disclosing four would still drop one.
          // The two endings are stamped differently, because they are different facts.
          let offenders = [];
          if (existsSync(P.frameDiffModel)) {
            try { offenders = firingDirectivesLenient(readFileSync(P.frameDiffModel, "utf8")); }
            catch { /* fall through to the scrape */ }
          }
          if (!offenders.length) {
            // the token carries the items pipe-separated ahead of the " — " (undispatchableThrow),
            // so even the truncated string usually yields the first two or three by name.
            const head = (String(fd.fail).match(/framediff_directive_undispatchable:([^\n]*)/) || [, ""])[1].split(" — ")[0];
            offenders = head.split(" | ").map((s) => s.trim()).filter((s) => s && !/^\+\d+ more$/.test(s)).map((item) => ({ item, why: "x" }));
          }
          if (!offenders.length) offenders = [{ item: "frame-diff directive", why: "x" }];
          atomicWrite(rp, JSON.stringify({
            ts: new Date().toISOString(), requested: [], swept: [], ...prior,
            deferrals: [...(Array.isArray(prior.deferrals) ? prior.deferrals : []), ...offenders.map((o) => ({
              directive: String(o.item || "frame-diff directive").slice(0, 200),
              reason: o.why
                ? "frame-diff could not state this omission as a dispatchable search (undispatchable directive; the repair ladder exhausted) — it is an OPEN question, not a searched clean"
                : "frame-diff raised this omission but the stage's repair ladder exhausted before any directive could be dispatched — it is an OPEN question, not a searched clean",
            }))],
          }, null, 2) + "\n");
          runLog(run.runDir, { event: "frame-diff-undispatchable-disclosed", count: offenders.length,
            undispatchable: offenders.filter((o) => o.why).length, items: offenders.slice(0, 8).map((o) => String(o.item).slice(0, 120)) });
        } catch (e) { note(`frame-diff undispatchable disclosure failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
      }
    } else if (existsSync(P.frameDiffModel)) {
      try { parsed = parseFrameDiff(readFileSync(P.frameDiffModel, "utf8")); }
      catch (e) {
        note(`frame-diff model unparseable post-validate (non-fatal): ${String(e.message).slice(0, 80)}`);
        // zero semantics: the stage PASSED its validator and its model still would not parse here.
        // That left a note and nothing machine-readable, so the run recorded a frame question that was
        // asked, produced nothing, and looked exactly like one that came back clean.
        runLog(run.runDir, { event: "frame-diff-skipped", reason: `model-unparseable: ${String(e.message).slice(0, 80)}` });
      }
    } else if (fd.ok) {
      // the stage reported success and wrote no structured model at all — the same silence, recorded.
      runLog(run.runDir, { event: "frame-diff-skipped", reason: "no-frame-diff-model" });
    }
    if (parsed) {
      // The dominant element the spine test runs against — the backstop forces the gap TRUE on any
      // directive that lands on it (dictate-don't-infer). THE ORDER IS THE FIX:
      //
      //   1-2. the driver's OWN copies, via boundDominantElement — blind-frame-model.json, then the
      //        manifest's "Dominant element:" line.
      //   3.   the frame-diff document's own field, LAST.
      //
      // Rung 3 used to be rung 1, and that was the defect: the seat was told to echo the blind model's
      // spine verbatim, and the driver then preferred the echo over both copies it already held. A
      // transcription slip retargeted this test — the gate that can clamp a CLEAR verdict — with no
      // token speaking about it.
      //
      // It survives as the LAST rung rather than being deleted, and only the archive can reach it: the
      // tool has no `dominant_element` property, so on any run this build dispatches the field in
      // `parsed` is the driver's own stamp. On a REPLAYED archive written under the dictation it is the
      // seat's echo, and reading it there is what stops an archived verdict flipping when the run's
      // other artifacts are missing or unparseable — the anchor rule, a new way in and never a
      // replacement.
      let dominantEl = boundDominantElementFrom(P).value;
      if (!dominantEl) dominantEl = String(parsed.dominant_element ?? "").trim();
      const { directives: blindDirectives, dominant_element_gap } = applyDominantBackstop(parsed, dominantEl);
      // FORM-axis regrounding: merge the MECHANICAL form-coverage gaps (a deterministically-generated near-form
      // the funnel never dispatched) into the SAME directive set as the blind frame-diff. They ride the same
      // supplemental-sweep + clamp channel — but they are found by the deterministic oracle, not a peer LLM that
      // shares the generator's blind spot. This is what makes a missing first-consonant-swap neighbour (the
      // gang-slang near-miss class) fire reliably.
      const mechDirectives = mechanicalFormGapDirectives(ctx);
      if (mechDirectives.length) runLog(run.runDir, { event: "form-oracle-gap", missing: mechDirectives.length, items: mechDirectives.slice(0, 6).map((d) => d.item) });
      const directives = blindDirectives.concat(mechDirectives);
      // Register-only: source-layer directives are "this channel was never searched" observations, and on
      // this product NO common-law channel is searched — that is the thing bought, not an omission. They
      // must not FIRE, because an unswept firing directive becomes a frame DEFERRAL, and a frame deferral
      // is a CLEAR→CONDITIONAL clamp input: every register-only run would clamp through the back door.
      // Dropped at the source so the receipt, the coverage rows and the clamp all agree; the absence is
      // carried by the risk statement's basis clause and the coverage section instead.
      const firingAll = firingDirectives(directives);
      const firing = runCommonLaw ? firingAll : firingAll.filter((d) => d.layer !== "source");
      if (firingAll.length !== firing.length)
        runLog(run.runDir, { event: "frame-diff-source-directives-dropped", reason: "register-only", dropped: firingAll.length - firing.length });
      // judgment-relocation (2026-06-23): the auto-forced "bare-exact-anchor enumeration invariant" was REMOVED.
      // It re-parsed the prose Coverage ledger (findFloorShapeGaps (d)) to FORCE a match_mode:exact reopen when
      // the dominant element's name-list looked "open" — a sufficiency call the driver made from a label. Under
      // the band flow the funnel ENUMERATES the named band (or marks it `incomplete`), and the lawyer reads the
      // COMPLETE band; if a material slice is not fully cleared the run ships CONDITIONAL (coverage_judgment
      // sufficient:false → the deliver-conditional clamp), never an in-machine reopen. The frame-diff below
      // still fires for genuine STRUCTURAL omissions (a variant/field/source never scoped at all) — that is an
      // omission check, not an in-machine "good enough" judgment.
      runLog(run.runDir, { event: "frame-diff", directives: directives.length, firing: firing.length, dominant_element_gap });

      // Round 2 Change 1d — jurisdiction scope check (CODE backstop, both directions). Scope from the
      // scope-ledger (applied jurisdiction rows), searched from the coverage-ledger units. A worldwide sweep
      // covers the in-scope set (no under-coverage) but on a narrow scope is itself over-reach the skill must
      // bound (1c); a scope-bounded run that misses an in-scope territory → under-coverage (discloses below).
      try {
        let scopeJ = [];
        try { scopeJ = scopeJurisdictions(parseScopeLedgerJson(readFileSync(P.scopeLedger, "utf8"))); } catch { /* no/legacy scope ledger → skip */ }
        if (scopeJ.length) {
          // item 13 — SEARCHED TERRITORIES COME FROM THE EXECUTION RECORD, not from ledger prose.
          //
          // This read `extractSearchedJurisdictions(...)` over the coverage ledger's text. narrowed
          // that scan to tokens that ARE known jurisdiction codes, which fixed the mark-fragment case
          // ("KIN ZY" → ZY) and left the worse half standing: SA, AG, KG, SL and SE are all real
          // jurisdiction codes AND all ordinary European company suffixes, so an owner written
          // "… GmbH & Co. KG" still put Kyrgyzstan in the searched set. There is no token list that
          // separates those readings, because they are the same token.
          //
          // A territory is now claimed as searched only when an EXECUTED query names it —
          // register-plan.json entries carry `regions[]`, plan-execution.json carries `executed[].qid`,
          // and the join is the whole derivation. Unresolvable (no plan, no receipt) yields the EMPTY
          // set, so every in-scope territory stays eligible for the underCoverage disclosure: the
          // failure direction is over-disclosure, which a reader resolves, never a silent clean over a
          // territory nobody queried.
          let planDoc = null, execDoc = null;
          try { planDoc = ctx.registerPlan ?? JSON.parse(readFileSync(P.registerPlan, "utf8")); } catch { /* no plan on this run */ }
          try { execDoc = JSON.parse(readFileSync(P.planExecution, "utf8")); } catch { /* no receipt on this run */ }
          const sj = searchedJurisdictionsFromPlan(planDoc, execDoc);
          const ledgerWorldwide = (() => {
            // `worldwide` stays a PROSE reading, and only this one: it can only ever WIDEN what the run
            // claims, and 1c already treats a worldwide claim on a narrow scope as over-reach to bound.
            // It never marks a specific territory searched, so the collision above cannot ride it.
            try {
              return (loadCoverageLedger(run.runDir).rows ?? []).some((r) =>
                /\b(worldwide|global|all[- ]?jurisdic)/i.test(`${r?.unit ?? ""} ${r?.scope ?? ""}`));
            } catch { return false; }
          })();
          sj.worldwide = ledgerWorldwide;
          if (!sj.resolved) {
            runLog(run.runDir, { event: "searched-jurisdictions-unresolved", scope: scopeJ });
            note(`jurisdiction-scope: no plan/execution record to trace searched territories to — every in-scope `
              + `territory stays eligible for the under-coverage disclosure (item 13: unresolvable means unsearched)`);
          } else {
            runLog(run.runDir, { event: "searched-jurisdictions", from: "plan-execution", jurisdictions: sj.jurisdictions });
          }
          // CODE-DERIVED subtraction (review findings 1/10/14). `sj` is read out of the MODEL's
          // coverage-ledger prose, which cannot know that the compiler dropped a jurisdiction the
          // active register provider does not cover — the model was never told. The plan's
          // `deferred_coverage` is the code's own record of exactly that, so subtract it here and
          // clear `worldwide`: a sweep that structurally could not reach a territory is not
          // worldwide, whatever the prose says. Without this the partial-coverage case ships a
          // clean over a territory that was never queried.
          const planDeferred = new Set(ctx.registerDeferredJurisdictions ?? []);
          // both sides are canonical (A12): sj.jurisdictions from the fold above, planDeferred from
          // registerDeferredCoverage — the subtraction can no longer miss on a UK/GB or EU/EM spelling.
          const searched = sj.jurisdictions.filter((j) => !planDeferred.has(canonicalJurisdictionCode(j)));
          const worldwide = sj.worldwide && !planDeferred.size;
          if (planDeferred.size) runLog(run.runDir, { event: "jurisdiction-scope-register-deferred", deferred: [...planDeferred] });
          const jflags = worldwide
            ? { overReach: [], underCoverage: [], worldwide: true }
            : jurisdictionScopeFlags({ scopeJurisdictions: scopeJ, searched });
          if (jflags.underCoverage.length || jflags.overReach.length || jflags.worldwide) {
            ctx.jurisdictionScope = { scope: scopeJ, ...jflags };
            runLog(run.runDir, { event: "jurisdiction-scope", scope: scopeJ, searched, worldwide: worldwide || undefined, register_deferred: planDeferred.size ? [...planDeferred] : undefined, overReach: jflags.overReach, underCoverage: jflags.underCoverage });
            if (jflags.underCoverage.length) note(`jurisdiction-scope: in-scope territory(ies) unsearched — ${jflags.underCoverage.join(", ")} (will disclose)`);
            if (jflags.overReach.length) note(`jurisdiction-scope: out-of-scope territory(ies) searched — ${jflags.overReach.join(", ")} (Change 1c: bound the sweep to scope)`);
            if (jflags.worldwide && scopeJ.length) note(`jurisdiction-scope: a worldwide sweep ran on a scope of ${scopeJ.join(", ")} — covers recall, but Change 1c bounds the sweep to scope`);
          }
        }
      } catch (e) { note(`jurisdiction-scope check skipped (non-fatal): ${String(e.message).slice(0, 80)}`); }

      const reopenReceiptPath = driverDir(run.runDir, "frame-reopen.json");
      const priorReceipt = existsSync(reopenReceiptPath) ? JSON.parse(readFileSync(reopenReceiptPath, "utf8")) : null;
      const already = alreadyAttemptedReopen(priorReceipt, firing);
      const reopenDisabled = process.env.CLEAROTRON_FRAME_REOPEN === "0" || Number(process.env.CLEAROTRON_FRAME_REOPEN_MAX ?? 1) < 1;
      const digestLockedReopen = existsSync(P.narrative) && !forceFromActive(ctx, "synthesis");
      // C2 (PR-6): the digest lock exists to protect the audit spine from a WARM re-run rewriting
      // register-findings.md past synthesis — it was never a reason to strand a PURE-CODE sweep.
      // The dispatch arm (structured remedies → mint → fold → deterministic executor → per-directive
      // verify → placement refresh) only writes the band + plan receipts, which stage-freshness
      // exists to reconcile — so it runs UNDER the lock, and its reconcile segment rides the
      // EXISTING bounded late flush instead of an inline pre-synthesis re-digest. The warm arms
      // (register warm-resume, common-law source sweeps) stay locked, by design.
      const dispatchArmAvailable = !!(ctx.registerPlan?.contract?.supplemental_lane && axes.includes("primary-sweep") && planExec);
      let domClosed = false;
      // 6/7 (ask ledger): the receipt records per-directive minted qids (so "executed" is COMPUTED
      // from the plan-execution join, never asserted) and which directives the form-oracle injected
      // (their ask rows are born in form-neighbourhood, not the blind diff).
      const reopenQids = {};
      const reopenBorn = {};
      for (const d of mechDirectives) reopenBorn[reopenKey(d)] = "form-neighbourhood";
      // — the receipt's per-TERM half. `directive_qids` above records qid STRINGS; `remedy_terms`
      // records what each term ASKED and what came back, so a term that ran and returned nothing is
      // distinguishable from one that never ran. Passed in EXPLICITLY rather than computed here: the
      // demotion paths below rewrite this receipt from a closure decision and have no band blocks in
      // scope, and a field that silently disappears on one write path is the AD-4 defect
      // (`x:0` vs `x:null` must differ by value, never by presence). The demote paths carry the SAME
      // rows forward unchanged, deliberately — a failed re-digest demotes CLOSURE, not searchedness:
      // a query that ran still ran.
      const writeReopenReceipt = (swept, deferrals, dom, partials = [], accounting = null, answered = [], withheld = []) => {
        try {
          writeFileSync(reopenReceiptPath, JSON.stringify({
            ts: new Date().toISOString(), requested: firing.map(reopenKey),
            swept, deferrals, remaining: deferrals.map((x) => x.directive),
            ...(partials.length ? { partials } : {}),
            // a closed directive whose slice the fold refused as already-asked, with the plan row that answered it
            ...(answered.length ? { answered_elsewhere: answered } : {}),
            // a closed directive with a slice settled by the reading turn's judgment: the slice and the family
            // it repeats, and nothing else. The reason stays on the turn's own record.
            ...(withheld.length ? { withheld_by_judgment: withheld } : {}),
            dominant_element_gap, domClosed: dom,
            directive_qids: reopenQids, born: reopenBorn,
            remedy_terms: accounting?.computable === true ? accounting.rows : null,
            remedy_accounting: accounting?.computable === true
              ? { schema_version: accounting.schema_version, totals: accounting.totals, out_of_scope: accounting.out_of_scope }
              : null,
          }, null, 2) + "\n");
        } catch (e) { note(`frame-reopen receipt write failed (non-fatal): ${e.message}`); }
      };

      if (firing.length && !already && !reopenDisabled && (!digestLockedReopen || dispatchArmAvailable)) {
        const regDirectives = firing.filter((d) => d.layer === "variant" || d.layer === "field");
        const srcDirectives = firing.filter((d) => d.layer === "source");
        const changedAxes = [];

        // CLOSURE-FIRST (register). The dominant-element crowd lives on the register and a Corsearch sweep is
        // far cheaper than the common-law grid, so by DEFAULT we try to CLOSE it: re-cover the dominant element
        // and fold the new band blocks into the axis band.json (judgment-relocation: the funnel emits band
        // blocks, NOT a clearance verdict / floor row). WHICH tool does the covering is the lane's call — the
        // dispatch arm below is pure code, the warm-resume arm proposes on the lane and enumerates off it.
        // "Closure" here = the funnel did new work (regChanged) and deriveNamedBand re-merges the fuller band;
        // whether that band is SUFFICIENT is judgment's call (coverage_judgment), never a floor-row label.
        let regChanged = false, regMechFail = null, regNoSession = false;
        // Fix 2 — the register close is now VERIFIED per directive, not swept on a byte-diff. `regArm`
        // records which arm ran; `regSwept` holds the reopenKeys that a re-run of the dispatch detectors
        // confirmed genuinely searched (dispatch arm only); `regDeferReason` carries the honest reason a
        // directive stayed open. The warm-resume arm keeps its axis-level byte-diff (no per-qid mapping).
        let regArm = null;
        const regSwept = new Set();
        const regDeferReason = new Map();
        // — WHAT THE FOLD REFUSED, AND WHICH KIND OF REFUSAL IT WAS. Read by the remedy accounting
        // below, which otherwise requires every minted qid to land and so records a term as
        // dispatch-failed when the fold refused its slice as a duplicate of a question the plan had
        // already asked and answered. A fold-refused qid can never land, by construction — the
        // re-attempt above deliberately filters it out — so only the accounting was still waiting
        // for it. qid -> { kind, twin }.
        const regFoldRefusals = new Map();
        // Partial mints must not read as full sweeps: when SOME of a directive's remedy proposals mint
        // and a sibling is refused by the shape lint, the directive can still verify-closed on the
        // minted subset — the refusal is disclosed per directive (receipt `partials` row on a close,
        // folded into the defer reason otherwise), never dropped into the aggregate count alone.
        const regPartialMint = new Map();
        const regAnsweredBy = new Map();   // reopenKey → the plan rows that answered its slices the fold refused as already-asked
        const regWithheldBy = new Map();   // reopenKey → its slices refused as families the reading turn withheld, with each family
        // — the per-TERM rows the remedy ledger accounts. One row per remedy term per directive,
        // recorded at the mint seam (the only place the term→qid mapping exists) so the receipt can
        // later say what each term asked and what came back. reopenKey → [{term, predicates, qids,
        // dispatch_reason}].
        const regTermRows = new Map();
        // The last plan-execution join the dispatch arm computed ({executedQids, blocksByQid}) — the
        // SAME join the per-directive verify reads, hoisted so the term ledger below cannot disagree
        // with it about what executed. Null on every non-dispatch arm.
        let regLastJoin = null;
        // copper-lattice re-route (supplemental_lane contract): the blind frame-diff already carries
        // the TERMS (judgment chose WHAT at the frame layer) — the sweep itself is clerical, so it is
        // pure code: mint supplemental plan entries from the directives, dispatch the deterministic
        // executor (count-first, ceiling, error stamping — code writes the band, qids stamped), fold +
        // refresh the receipt, re-merge the named band. No LLM sweep turn, no session needed, and the
        // detail-fetch ceiling concern retires with the arm (the executor batch-screens, never
        // detail-fetches; the enumerate ceiling bounds records). The unit .md prose stays as-is —
        // audit-only; where it differs from the band, the band wins. The ONE warm re-digest below is
        // where judgment reasons over the completed band, unchanged.
        if (regDirectives.length && dispatchArmAvailable) {
          regArm = "dispatch";
          const a = "primary-sweep";
          const inScope = inScopeClassList(job, ctx.profile);
          // Part A — thread a STRUCTURED remedy per directive rather than guessing term:d.item +
          // nice_classes:inScope. deriveDirectiveRemedy honours an agent-emitted directive.remedy, else
          // derives one: a FIELD (class-gap) directive → the dominant element × the classes named in its
          // item label (RUN1: HALCYON × Cl.35/38); a variant near-form → the near-form × the in-scope
          // classes (today's behaviour). A field directive with no parseable classes has NO code remedy —
          // searching the dominant element in the matter's own classes just re-runs the primary sweep, so
          // it is DISCLOSED (regDeferReason), never minted-and-swept blind.
          const existingQids = new Set(ctx.registerPlan.entries.map((e) => e.qid));
          // The frame's added classes, from the frozen plan: each costs one question, the identical mark in it, which the
          // plan already asks, so no remedy puts an added class on another question (deriveDirectiveRemedy).
          const classBound = addedClassBound(ctx.registerPlan);
          const directiveQids = new Map();       // reopenKey -> [qid]
          const directiveIntended = new Map();   // reopenKey -> intended nice_classes[]
          const allMinted = [];
          const allRejected = [];
          let rejectedN = 0;
          for (const d of regDirectives) {
            const key = reopenKey(d);
            const remedy = deriveDirectiveRemedy(d, { dominantElement: dominantEl, inScope, ...classBound });
            if (!remedy || !remedy.terms.length || !remedy.nice_classes.length) {
              directiveQids.set(key, []);
              // Per-case wording (A2): the variant fallback now also DISCLOSES a label-shaped item
              // (term-shape lint) — dispatching the display label verbatim was the 2026-07-28
              // nil-search class ("Reverse-order WAVO composites (…)" searched as exact → 0 → read
              // as clean). The remedy contract (SKILL.md) is the fix the wording points at.
              regDeferReason.set(key, String(d.layer ?? "").toLowerCase() === "field"
                ? "no-code-remedy: a field class-gap with no searchable term×class pair (closing it in the matter's own classes only re-runs the primary sweep — disclosed)"
                : "no-code-remedy: the directive's item is a label, not a mark-shaped search term (a literal dispatch would be a nil search reading as clean) — disclosed; a directive that knows its terms must carry a structured remedy{terms, nice_classes}");
              //: a directive with no derivable remedy still NAMED something to search. It gets a
              // term row carrying its own item, so "the reopen restated this and nothing ran" is on the
              // record rather than inferable only from a deferral reason.
              regTermRows.set(key, [{ term: String(d.item ?? ""), predicates: [], qids: [], dispatch_reason: regDeferReason.get(key) }]);
              continue;
            }
            directiveIntended.set(key, remedy.nice_classes);
            const base = { nice_classes: remedy.nice_classes, regions: remedy.regions, rationale: `frame-reopen ${d.layer}: ${String(d.observation ?? "").slice(0, 120)}` };
            const proposals = remedyProposals(remedy, d, base);
            const { minted, rejected } = mintSupplementalEntries(a, proposals, {
              existingQids, perCall: proposals.length,
              axisMax: ctx.registerPlan.entries.length + allMinted.length + proposals.length, existingCount: 0,
              capabilities: registerCapabilities(), priorityClasses: inScope,
            });
            rejectedN += rejected.length;
            allRejected.push(...rejected);
            for (const m of minted) existingQids.add(m.qid);
            directiveQids.set(key, minted.map((m) => m.qid));
            reopenQids[key] = minted.map((m) => m.qid);
            allMinted.push(...minted);
            // Every firing directive must END recorded: a directive whose EVERY proposal the mint
            // refused (the term-shape ladder) would otherwise fall out of both regSwept and the
            // defer map — an unrecorded ending, the exact ashen-lattice failure partitionFiring
            // exists to prevent. Disclose it with the mint's own reason. A PARTIAL refusal (some
            // proposals minted, a sibling refused) is recorded too — a close on the minted subset
            // must state what it did NOT search for the directive.
            if (!minted.length && rejected.length)
              regDeferReason.set(key, `proposals-rejected: ${String(rejected[0].issue ?? "").slice(0, 200)}`);
            else if (rejected.length)
              regPartialMint.set(key, `${minted.length} of ${proposals.length} remedy proposal(s) minted; ${rejected.length} refused at the mint: ${String(rejected[0].issue ?? "").slice(0, 200)}`);
            // — the term rows. A PARTIAL mint is exactly the case the aggregate counts hide: the
            // directive can still verify-closed on the terms that minted while a sibling term was
            // refused and never searched. Per term, the qids it owns (or the mint's own refusal
            // reason) are recorded here, so that sibling has a row of its own instead of living only
            // inside a directive-level partials note.
            regTermRows.set(key, remedy.terms.map((t) => {
              const mine = minted.filter((m) => String(m.term ?? "") === t);
              const refused = rejected.filter((r) => String(r?.proposal?.term ?? "") === t);
              return {
                term: t,
                predicates: mine.map((m) => String(m.predicate ?? "")),
                qids: mine.map((m) => m.qid),
                dispatch_reason: mine.length ? null
                  : refused.length ? `proposals-rejected: ${String(refused[0].issue ?? "").slice(0, 300)}`
                    : "no supplemental entry minted for this term (the mint returned neither an entry nor a refusal for it)",
              };
            }));
          }
          if (rejectedN) note(`frame-reopen: ${rejectedN} directive-minted proposal(s) rejected`);
          // PR-6 (C1 — persist what evaporates): the mint-seam rejections land in the SAME per-axis
          // supplemental-plan sidecar the propose-tool uses (rejected[] beside entries[]) — the ask
          // ledger reads them there; nothing lives only in a note line. Best-effort, never a kill.
          if (allRejected.length) {
            try {
              const suppPath = join(run.runDir, "register-units", `${a}-supplemental-plan.json`);
              let suppDoc = { schema: "register-plan/1", plan_version: 1, derived_from: { job_key: `supplemental:${a}`, variants_fingerprint: "supplemental" }, regions: ctx.registerPlan?.regions ?? [], entries: [] };
              if (existsSync(suppPath)) {
                try { const prior = JSON.parse(readFileSync(suppPath, "utf8")); if (prior && Array.isArray(prior.entries)) suppDoc = prior; } catch { /* torn — rebuilt */ }
              }
              suppDoc = withRejected(suppDoc, allRejected, { ts: new Date().toISOString(), origin: "frame-reopen" });
              mkdirSync(dirname(suppPath), { recursive: true });
              writeFileSync(`${suppPath}.tmp`, JSON.stringify(suppDoc, null, 2) + "\n");
              renameSync(`${suppPath}.tmp`, suppPath);
            } catch (e) { note(`frame-reopen: rejected[] sidecar write failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
          }
          note(`frame-reopen: ${regDirectives.length} register omission(s) → ${allMinted.length} supplemental entr${allMinted.length === 1 ? "y" : "ies"} minted (structured remedy), dispatched as pure code (no agent sweep)`);
          const beforeBand = existsSync(P.registerBand(a)) ? readFileSync(P.registerBand(a), "utf8") : null;
          if (allMinted.length) {
            // A QUESTION THE READING TURN WITHHELD IS NOT ASKED AGAIN HERE. The fold lets a question through
            // when it matches a waiting family, because the reading turn's own ask is what the family waits
            // for; this sweep asks on nobody's judgment, so its exact repeat of a family the turn withheld is
            // refused before the fold, with the family as its twin and the turn's recorded reason. The record
            // is read here, at the fold, so a family the turn has since released is asked as before.
            const withheldTwins = withheldFamilyTwins(ctx.registerPlan, readWithheldFamilies(run.runDir), releasedFamilyQids(run.runDir));
            const { kept: toFold, refused: withheldRefused } = refuseWithheldFamilies(allMinted, withheldTwins, ctx.registerPlan);
            // ONE ANSWER PER QUESTION PER RUN (held-answers.mjs): a question another worker or pass has answered is
            // refused as already asked, its twin the row that answered it, and the directive is checked on that row.
            let toFoldHeld = toFold, heldRefused = [];
            try {
              const planRegions = (ctx.registerPlan.regions ?? []).map(String);
              ({ kept: toFoldHeld, refused: heldRefused } = refuseHeldQuestions(toFold, heldAnswers(run.runDir, { planRegions, withheld: readWithheldFamilies(run.runDir) }), planRegions));
            } catch { toFoldHeld = toFold; heldRefused = []; }   // an economy: without it every question is folded as before
            // A SPELLING THE READING TURN LEFT ON A LIST IT READ, with its count, is left there (held-answers.mjs): the
            // re-sweep's question on it is checked on the list's row instead of being asked again.
            let listRefused = [];
            try {
              const planRegions = (ctx.registerPlan.regions ?? []).map(String);
              ({ kept: toFoldHeld, refused: listRefused } = refuseCountedOnList(toFoldHeld, countedOnLists(run.runDir, { planRegions }), planRegions));
            } catch { listRefused = []; }   // without it the spelling is asked as before
            const folded = foldSupplementalEntries(ctx.registerPlan, toFoldHeld);
            const { plan, added } = folded;
            const refused = [...withheldRefused, ...heldRefused, ...listRefused, ...folded.refused];
            if (added.length) {
              writeFileSync(`${P.registerPlan}.tmp`, JSON.stringify(plan, null, 2) + "\n");
              renameSync(`${P.registerPlan}.tmp`, P.registerPlan);
              ctx.registerPlan = plan;
            }
            // — expected to hold only the two refusals that mean the question is settled already: a
            // duplicate of the plan's own question, and a family the reading turn withheld. Every other kind
            // is a term mintSupplementalEntries should have caught (it runs entryTermIssues at the mint, and
            // its rejects are already in the sidecar above). Logged anyway, because that is a belief about
            // two screens agreeing, and the day they stop agreeing this is the only place that would say so.
            if (refused.length) {
              for (const r of refused) if (r?.qid) regFoldRefusals.set(r.qid, { kind: r.kind ?? null, twin: r.twin ?? null, reason: r.reason ?? null });
              // THE REASON THE FOLD GAVE IS LOGGED, not just the qid it refused. The fold is the only
              // place that knows WHY, and for a duplicate it knows WHICH plan row already holds the
              // answer. Logging the qid alone threw that away: recovering it on one run meant
              // re-deriving the twin from a shared identity hash by hand, and a receipt that cannot
              // say why a slice is missing reads as an engine fault whatever the cause was.
              runLog(run.runDir, { event: "frame-reopen-fold-refused", refused: refused.length,
                qids: refused.map((r) => r.qid).slice(0, 6),
                kinds: refused.reduce((a, r) => { const k = r.kind ?? "unstated"; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
                rows: refused.slice(0, 6).map((r) => ({ qid: r.qid, kind: r.kind ?? null, twin: r.twin ?? null, issue: r.issue ?? null })) });
              // ONE NOTE PER KIND, because they are three different findings and only one of them is a
              // wiring fault. A duplicate-question refusal is the fold working: the question is already
              // in the plan and its existing row carries the coverage. An identity collision or a
              // malformed term IS the mint screen and the fold screen disagreeing, because the mint
              // runs entryTermIssues and should have caught it.
              // A withheld family's refusal is neither: it is the reading turn's decision standing, recorded on
              // the run log row above with its kind and its family, and settled by that turn's reason.
              const dupes = refused.filter((r) => r.kind === "duplicate-question");
              const onLists = refused.filter((r) => r.kind === "counted-on-list");
              const faults = refused.filter((r) => !["duplicate-question", "withheld-by-judgment", "counted-on-list"].includes(r.kind));
              if (dupes.length) note(`frame-reopen: ${dupes.length} minted entr${dupes.length === 1 ? "y" : "ies"} refused at the fold as already-asked — the plan row${dupes.length === 1 ? "" : "s"} ${dupes.map((r) => `"${r.twin ?? "(twin unstated)"}"`).join(", ")} carr${dupes.length === 1 ? "ies" : "y"} that coverage; the term is answered, not unsearched`);
              if (onLists.length) note(`frame-reopen: ${onLists.length} minted entr${onLists.length === 1 ? "y" : "ies"} not asked: ${onLists.length === 1 ? "it names a spelling" : "each names a spelling"} the run counted on a list the reading turn read, and is checked on that list's row (${[...new Set(onLists.map((r) => `"${r.twin}"`))].join(", ")})`);
              if (faults.length) note(`frame-reopen: ${faults.length} minted entr${faults.length === 1 ? "y" : "ies"} REFUSED at the fold (${[...new Set(faults.map((r) => r.kind ?? "unstated"))].join(", ")}) — the mint screen and the fold screen disagree, which is a wiring finding`);
            }
            // Dispatch → derive band → VERIFY per directive (qid-landed + non-collapse + class-scope).
            // A byte-changed band with only a wrong-scope/empty/error block closes NOTHING.
            const dispatchAndVerify = async (qids) => {
              // NOTHING ADDED, NOTHING REPEATED. The executor reads an empty question list as every entry on the
              // axis, so a fold that refused every slice (the plan's own questions, or families the reading
              // turn withheld) handed the whole primary sweep back to the executor to run again. It now sends
              // only the axis's required questions that have not landed (pendingRequiredQids), so a required
              // search still gets its retry and nothing landed is asked twice. The verify below reads the join
              // either way, so a refused slice is still checked through its twin or its family.
              let send = qids;
              if (!send.length) send = pendingRequiredQids(ctx.registerPlan, a, readRegisterBands(P, axes), releasedFamilyQids(ctx.paths.runDir));
              const outcome = send.length ? await dispatchPlanQids(a, send, "frame-reopen-sweep", 2) : "ok";
              refreshSupplementalExecution(ctx);
              try { deriveNamedBand(ctx); } catch (e) { regMechFail = `named-band:${String(e.message).slice(0, 80)}`; }
              const bands = readRegisterBands(P, axes);
              const executedQids = new Set(joinPlanToBands(ctx.registerPlan, bands, joinOptions(ctx)).executed.map((x) => x.qid));
              // every axis's blocks: a slice refused as already answered is checked on its twin, which may be another axis's row
              const blocksByQid = blocksByQidOf(bands);
              return { outcome, executedQids, blocksByQid };
            };
            // A slice the fold refused as already-asked is checked on the row that answered it, as the remedy
            // term ledger reads it; the directive it closes names that row in the receipt.
            const verifyOne = (d, ev) => {
              const v = verifyRegisterDirectiveClose({
                qids: directiveQids.get(reopenKey(d)) ?? [], intendedClasses: directiveIntended.get(reopenKey(d)) ?? [],
                executedQids: ev.executedQids, blocksByQid: ev.blocksByQid, foldRefusals: regFoldRefusals,
              });
              if (v.closed && v.answered_by) regAnsweredBy.set(reopenKey(d), v.answered_by);
              if (v.closed && v.withheld_by_judgment) regWithheldBy.set(reopenKey(d), v.withheld_by_judgment);
              return v;
            };
            const mintedDirectives = regDirectives.filter((d) => (directiveQids.get(reopenKey(d)) ?? []).length);
            let ev = await dispatchAndVerify(added);
            regLastJoin = ev;
            let outcome = ev.outcome;
            const retryTargets = [];
            for (const d of mintedDirectives) {
              const v = verifyOne(d, ev);
              if (v.closed) regSwept.add(reopenKey(d));
              else { regDeferReason.set(reopenKey(d), v.reason); retryTargets.push(d); }
            }
            // Part B — re-attempt ONCE (owner: re-attempt-once-then-disclose). The remedy carried the
            // correct scope from attempt 1, so this recovers a transient (an error / collapsed / unlanded
            // slice), never re-runs a wrong query. dispatchPlanQids' own repair ledger (max 2) refuses a
            // third — so this cannot loop or thrash the paid pass.
            //
            // ONLY THE FAILING DIRECTIVES' OWN ENTRIES GO AGAIN. A directive that verified closed on the first
            // attempt is not asked twice: re-sending its qids re-fetches records the run already holds, and
            // on a register that bills per request it pays for them again.
            if (retryTargets.length) {
              const retryQids = [...new Set(retryTargets.flatMap((d) => directiveQids.get(reopenKey(d)) ?? []))]
                .filter((q) => added.includes(q));
              note(`frame-reopen: ${retryTargets.length} directive(s) not verified-closed — ONE re-attempt of their own ${retryQids.length} entr${retryQids.length === 1 ? "y" : "ies"} with the same structured remedy`);
              runLog(run.runDir, { event: "frame-reopen-reattempt", directives: retryTargets.map(reopenKey), qids: retryQids });
              if (retryQids.length) {
                ev = await dispatchAndVerify(retryQids);
                regLastJoin = ev;
                outcome = ev.outcome ?? outcome;
                for (const d of retryTargets) {
                  const v = verifyOne(d, ev);
                  if (v.closed) { regSwept.add(reopenKey(d)); regDeferReason.delete(reopenKey(d)); }
                  else regDeferReason.set(reopenKey(d), v.reason);
                }
              }
            }
            const afterBand = existsSync(P.registerBand(a)) ? readFileSync(P.registerBand(a), "utf8") : null;
            if (afterBand !== beforeBand) changedAxes.push(a);   // the band changed ⇒ re-digest to reconcile
            if (regSwept.size) regChanged = true;                // ≥1 directive genuinely closed
            if (outcome !== "ok" && !regMechFail) regMechFail = `dispatch:${String(outcome ?? "unavailable").slice(0, 100)}`;
            if (!regSwept.size) note(`frame-reopen: ${a} — no register directive verified-closed after the dispatched sweep (deferring the remainder)`);
          } else {
            note(`frame-reopen: ${a} — no code-closeable register directive this pass (all disclosed)`);
          }
          // — the `&& ctx.digestKey` guard is GONE, and dropping it is required for this arm to
          // survive the move rather than optional. ctx.digestKey is assigned where register-digest runs,
          // which is now BELOW this seam, so on a fresh run it is undefined and the condition could never
          // be true again: every register directive would fall through to `regNoSession`, become a
          // disclosed deferral, and a dominant-element deferral is a CLEAR→CONDITIONAL clamp input —
          // verdicts moving on runs that used to ship CLEAR, with no test failing. The guard existed
          // because this arm's close was only real once a warm re-digest reconciled it, and it needed a
          // live digest session to resume; after the move there is nothing to reconcile into, because the
          // digest has not run and will read the swept unit on its first pass. This arm is unreachable on
          // the dispatch-lane providers (dispatchArmAvailable wins above whenever CLEAROTRON_PLAN_DISPATCH is
          // on and the provider exposes executePlan, which is production today) — it is the lane for a
          // provider without an executor and for the offline mock harness.
        } else if (regDirectives.length && axes.includes("primary-sweep") && unitKey["primary-sweep"]) {
          regArm = "resume";
          const a = "primary-sweep";
          const regDom = regDirectives.filter((d) => d.severity === "dominant-element");
          const beforeUnit = existsSync(P.registerUnit(a)) ? readFileSync(P.registerUnit(a), "utf8") : null;
          const beforeBand = bandBytesOf(P, a);   // a sweep that adds blocks moves the band, whatever it does to the notes
          note(`frame-reopen: ${regDirectives.length} register omission(s) → resuming ${a} to ${regDom.length ? "ENUMERATE the dominant-element floor to exhaustion" : "fold in a targeted supplemental sweep"}`);
          // Lane flag read from the SAME key the tool exclusion keys on (see the stage dispatcher) —
          // this arm is reachable on a lane run whenever the code-side dispatch arm above could not
          // take it (no executePlan adapter, or CLEAROTRON_PLAN_DISPATCH=off).
          const followup = repairFollowup("register-unit:frame-reopen-directive", { paths: P, axis: a, directives: regDirectives,
            supplementalLane: !!ctx.registerPlan?.contract?.supplemental_lane, job: ctx.job, profile: ctx.profile });
          const r = await stage("register-unit", { ...ctx, axis: a }, { force: true, followup, sessionKey: unitKey[a], trigger: "frame-reopen" });
          if (r.ok) {
            if (readFileSync(P.registerUnit(a), "utf8") !== beforeUnit || bandBytesOf(P, a) !== beforeBand) { changedAxes.push(a); regChanged = true; }
            else note(`frame-reopen: ${a} unchanged after the supplemental sweep`);
          } else {
            regMechFail = r.fail; note(`frame-reopen: ${a} supplemental sweep failed mechanically (${r.fail})`);
            // doc-44: a core coverage sweep must NOT be one-shot-then-abandon. On a TIMEOUT (the followup used its
            // own attempts, its extended retry included, and still hit the wall), do ONE fresh, SCOPED re-sweep of the SAME
            // near-form threats on a fresh session: the stage's one model and the gateway's retries, as any fresh
            // stage gets. There is no second model or provider. Scoped (not the whole axis) + bounded detail-fetch so it
            // fits the budget. Still fails ⇒ fall through to the deferral exactly as before.
            if (/timeout/.test(String(regMechFail))) {
              note(`frame-reopen: ${a} timed out — ONE fresh SCOPED retry on a fresh session (same model, the gateway's retries)`);
              const retryMsg = repairFollowup("register-unit:frame-reopen-retry", { paths: P, axis: a, directives: regDirectives,
                supplementalLane: !!ctx.registerPlan?.contract?.supplemental_lane, job: ctx.job, profile: ctx.profile });
              const r2 = await stage("register-unit", { ...ctx, axis: a }, { force: true, freshMessage: retryMsg, sessionKey: `clearance-${ctx.run.slug}-${ctx.run.codename}-register-unit-${a}-reopen-retry`, trigger: "frame-reopen-retry" });
              if (r2.ok && existsSync(P.registerUnit(a)) && (readFileSync(P.registerUnit(a), "utf8") !== beforeUnit || bandBytesOf(P, a) !== beforeBand)) {
                changedAxes.push(a); regChanged = true; regMechFail = null;
                note(`frame-reopen: ${a} fresh scoped retry closed the gap`);
              } else if (!r2.ok) {
                regMechFail = r2.fail; note(`frame-reopen: ${a} fresh scoped retry also failed (${r2.fail}) — deferring`);
              } else {
                note(`frame-reopen: ${a} fresh scoped retry ran but band unchanged — deferring`);
              }
            }
          }
        } else if (regDirectives.length) {
          regNoSession = true;
          note(`frame-reopen: ${regDirectives.length} register omission(s) — no resumable primary-sweep/digest session in this process`);
        }
        if (regArm === "resume") remergeIfBandsMoved(ctx, "frame-reopen");

        // A SOURCE DIRECTIVE NAMING A CHANNEL IS DISCLOSED, NEVER SWEPT. The frame-diff manual says so ("disclosed
        // rather than swept blind — they end as an open coverage row"), and this arm used to do the opposite: it
        // resumed the web-search sessions to sweep the channel for every variant. No web-search session is resumed
        // for a channel now. Each source directive is deferred as a channel never swept, so it reaches the reader as
        // an open row in the shipped words, and the coverage closure below no longer folds it in either.
        // (Register-only never reaches this arm: source-layer directives are dropped before `firing`.)
        if (srcDirectives.length) note(`frame-reopen: ${srcDirectives.length} source-channel directive(s) disclosed as open rows, not swept`);

        // ONE warm re-digest if a register axis materially changed (re-derives register-coverage-ledger.json,
        // and surfaces the newly-enumerated conflicts as findings — this block runs BEFORE synthesis).
        // T1 (J2/G8): the re-digest honors the block's NON-FATAL contract — the old must here
        // killed a full run on a re-digest timeout AFTER the sweeps had already landed (the F5
        // 48%-timeout class). One retry on a fresh session, same model, on a timeout; still failing ⇒
        // the swept register directives are DEMOTED back to deferrals (open coverage row + the
        // CLEAR→CONDITIONAL clamp — "can't close → disclose") and the run continues on the prior digest.
        // CROWDED-FIELD FIX (teal-gantry, 2026-07-21) — RETIRED BY, and this is the whole win.
        // The arms above regenerate the register band by ENUMERATING the dominant-element crowd. Until
        // 2026-08-03 placement-inquiry had already run on the PRE-enumeration band, so the reopen had to
        // dispatch placement a SECOND time or the P2 delivery-freshness gate would (correctly) refuse a
        // report whose placement predated the crowd it was assembled over. That second dispatch was the
        // single largest avoidable cost in the run — 87,031 + 112,991 output tokens across two placement
        // passes on the preserved R2 VENZY run, roughly 27 minutes of wall-clock at ~70 tok/s for the
        // second one alone. The frame now settles ABOVE placement, so there is nothing to refresh:
        // placement has not run yet and will read the enumerated band on its one and only dispatch.
        // deriveNamedBand has already re-merged (the dispatch arm calls it; the warm-resume arm's fold
        // lands in the unit file placement reads).
        //
        // NOTHING replaces it on a RESUME either, and nothing needs to: a resume whose placement artifact
        // is inherited-fresh has that artifact declared stale by stage-freshness the moment these sweeps
        // move register-named-band.json or a register-units/*.md (stageInputs["placement-inquiry"]), and
        // placement re-runs a few lines below because the seam is now downstream of the sweep. The
        // freshness gate stops being a wall to route around and becomes the mechanism.
        //
        // THE DIGEST QUEUE IS DELIBERATELY NOT SETTLED HERE ON A FRESH RUN. The reconcile segment asks
        // judgment to re-read changed units "against your prior findings" — at this seam on a fresh run
        // there ARE no prior findings: register-digest has not run. Minting it would queue a meaningless
        // segment that buys a whole extra Opus pass at the standalone flush below; flushing it would set
        // ctx.digestSettled over an empty queue and strand escalation's and envelope's later mints —
        // staleness at the delivery gate, i.e. a parked run. So both the mint and the flush are gated on
        // the digest having ALREADY produced findings, which is true only on a resume. On a fresh run the
        // digest simply reads the settled band on its first pass, which is what makes the reconcile
        // unnecessary rather than merely skipped.
        const digestAlreadyRan = existsSync(P.registerFindings);
        // The reconcile segment — shared verbatim between the legacy frame-reopen re-digest (funnel
        // OFF) and the settlement flush's frame-reopen section (funnel ON).
        const reopenSections = (changedAxes.length && digestAlreadyRan) ? [{
          trigger: "frame-reopen",
          text: lines(
            `These register units just folded in supplemental sweeps from a blind frame re-derivation: ${changedAxes.join(", ")}. Re-read only those updated unit files, reconcile your prior findings and the Coverage ledger against them, and revise only what the new coverage requires.`,
          ),
        }] : [];
        if (changedAxes.length && !digestAlreadyRan)
          runLog(run.runDir, { event: "frame-reopen-reconcile-not-needed", axes: changedAxes,
            reason: "the digest has not run yet at this seam — it reads the settled band on its first pass" });
        if (!digestAlreadyRan) {
          // nothing to reconcile and nothing to flush: leave ctx.digestSettled false so the standalone
          // settlement seam (post escalation / envelope / screen-gate) still settles the queue it owns.
        } else if (digestLockedReopen) {
          // C2 (PR-6): under the digest lock the dispatch arm's results are already merged into the
          // band; the RECONCILE (judgment re-reading the changed units against its findings) cannot
          // run as an inline pre-synthesis flush — synthesis already ran. Mint the reconcile
          // segment as a durable queue item and ride the EXISTING bounded late flush at the
          // standalone settlement seam below (at most one per pass; receipts survive resume). A
          // late-flush failure leaves the item PENDING (durable — the next resume's flush gets one
          // more chance); the residue is visible: the ask ledger carries the reopen rows and the
          // frameReopenGap clamp stands until the gap genuinely closes. NO findings addendum — a
          // spliced delta was rejected long ago (silent-corruption class); the flush re-emits whole.
          if (reopenSections.length) {
            mintDigestWork("frame-reopen", firing.map(reopenKey), reopenSections[0].text);
          }
        } else if (reopenSections.length || pendingItems(ctx.digestQueue).length) {
          //: THE PRE-SYNTHESIS SETTLEMENT FLUSH. The frame-reopen re-digest already sat at
          // the last seam before synthesis, so it becomes the settlement point: ONE consolidated
          // followup = the frame-reopen segment (if any) + every queued segment (escalation /
          // envelope / screen-gate), each clearly sectioned, ending with the standard full
          // re-emission contract. Timeout retry + failure semantics ride flushDigestQueue.
          const fr = await flushDigestQueue("pre-synthesis", reopenSections);
          ctx.digestSettled = true;
          const rd = fr.result ?? { ok: true };
          if (!rd.ok && changedAxes.length) {
            note(`frame-reopen: re-digest failed (${rd.fail}) — swept register coverage demoted to deferrals (disclose, never kill the run here)`);
            runLog(run.runDir, { event: "frame-reopen-redigest-failed", fail: String(rd.fail).slice(0, 120) });
            regChanged = false;
            // Fix 2 — the dispatch arm's per-directive closures are only as good as the re-digest that
            // reconciled them into findings; on a re-digest failure demote every verified-closed directive
            // back to a disclosed deferral (never a swept-but-unreconciled close).
            for (const k of [...regSwept]) regDeferReason.set(k, `redigest-fail:${String(rd.fail).slice(0, 60)}`);
            regSwept.clear();
            regMechFail = regMechFail || `redigest-fail:${String(rd.fail).slice(0, 80)}`;
          }
        }

        // CLOSURE READ — Fix 2 (close-the-loop): a register directive is swept only when the SPECIFIC
        // re-search VERIFIED (dispatch arm: regSwept holds the per-directive verified-closed keys — the
        // minted qids landed as executed, non-collapsed, right-scope blocks). A byte-changed band that only
        // holds a wrong-scope/empty/error block closes nothing → the directive is a disclosed deferral.
        // WARM-RESUME arm (the un-dispatched providers — clarivate/signa, or CLEAROTRON_PLAN_DISPATCH=off): the
        // agent owns the sweep and stamps NO deterministic searched-scope evidence (the followup writes no
        // [cl …] tag), so a byte-diff cannot prove the intended classes were searched. Reading the band's
        // record classes is NOT proof of scope — the RUN1 dominant element surfaced via 9/28/41/42
        // CO-CLASSIFICATION, so records carry class 35/38 even when 35/38 were never searched. Therefore a
        // DOMINANT-ELEMENT directive is UNVERIFIABLE on this arm and stays a disclosed deferral (the clamp
        // holds — "can't verify → disclose", never a false close). Non-dominant register omissions keep the
        // axis byte-diff (lower stakes, not a clamp input — broadening them would manufacture false defers).
        // Whether the now-searched band is COMPLETE enough is judgment's call downstream (coverage_judgment).
        const { swept, deferrals } = partitionFiring(firing,
          (d) => d.layer === "source" ? false
               : regArm === "dispatch" ? regSwept.has(reopenKey(d))
               : d.severity === "dominant-element" ? false
               : regChanged,
          (d) => {
            if (d.layer === "source") return "source-not-swept";
            if (regArm === "dispatch") {
              const base = regDeferReason.get(reopenKey(d)) || "not-verified-closed";
              const partial = regPartialMint.get(reopenKey(d));
              return partial ? `${base}; ${partial}` : base;
            }
            if (regNoSession) return "no-resumable-session";
            if (regMechFail) return `mechanical-fail:${regMechFail}`;
            if (d.severity === "dominant-element" && regChanged)
              return "resume-arm-unverifiable: the warm-resume arm has no deterministic searched-scope evidence — a bare unit byte-diff cannot confirm the dominant element was searched in the intended classes (disclose, never a false close)";
            return "unchanged-after-resume";
          });
        // — THE REMEDY TERM LEDGER, built before the closure read because the closure read now
        // depends on it. Every term a firing directive restated ends in one of six named states, and
        // `searched-empty` carries the executed query and its counted zero — the state that used to
        // leave no trace anywhere. Non-fatal end to end: a ledger that cannot build leaves the
        // receipt's fields NULL (never absent) and the closure read falls back to its prior rule,
        // because a join that could not run is not evidence of a gap.
        //
        // Only the DISPATCH arm owns term rows. The warm-resume arm hands the sweep to an agent that
        // stamps no per-query receipt, so there is nothing to account and saying so is the honest
        // answer — those directives are listed in `out_of_scope` with the reason, never counted as
        // searched. (That arm already refuses to close a dominant-element directive at all, so no
        // closure claim rests on the silence.)
        let remedyAccounting = null;
        try {
          const termRows = regArm === "dispatch"
            ? regDirectives.flatMap((d) => (regTermRows.get(reopenKey(d)) ?? []).map((r) => ({
                directive: reopenKey(d), layer: d.layer, severity: d.severity, ...r })))
            : [];
          const outOfScope = [
            ...srcDirectives.map((d) => ({ directive: reopenKey(d), layer: d.layer,
              reason: "source-channel directive — disclosed as an open row and never swept, so it has no term unit and no per-query record to account" })),
            ...(regArm === "dispatch" ? [] : regDirectives.map((d) => ({ directive: reopenKey(d), layer: d.layer,
              reason: `register directive handled by the ${regArm ?? "no"} arm, which stamps no per-slice execution receipt — no term-level record exists to account` }))),
          ];
          remedyAccounting = accountRemedyTerms({
            terms: termRows,
            blocksByQid: regLastJoin?.blocksByQid ?? new Map(),
            executedQids: regLastJoin?.executedQids ?? new Set(),
            foldRefusals: regFoldRefusals,
            outOfScope,
          });
        } catch (e) {
          remedyAccounting = null;
          runLog(run.runDir, { event: "remedy-accounting-failed", error: String(e?.message ?? e).slice(0, 200) });
        }
        runLog(run.runDir, remedyAccountingEvent({ trigger: "frame-reopen", artifact: remedyAccounting,
          reason: remedyAccounting ? null : "the remedy term ledger did not build" }));
        if (remedyAccounting?.computable) {
          const t = remedyAccounting.totals;
          note(`frame-reopen remedy ledger: ${t.terms} term(s) — ${t.found} found, ${t.searched_empty} searched-empty (query + counted zero recorded), ${t.not_dispatched} never dispatched, ${t.dispatch_failed} dispatch-failed, ${t.unaccounted} unaccounted`);
        }
        // THE CLOSURE READ —: `domClosed` is computable only over the ACCOUNTED set. A
        // dominant-element directive must be verified-closed AND every term it restated must be
        // `found` or `searched-empty`. One term that never ran, or ran into a shape the record cannot
        // read, and the dominant-element gap is NOT closed — because it demonstrably is not.
        const domRead = domClosedOverAccounted({ directives, swept, accounting: remedyAccounting, reopenKeyOf: reopenKey });
        domClosed = domRead.domClosed;
        if (domRead.blockedBy.length) {
          runLog(run.runDir, { event: "frame-reopen-dom-unaccounted", blocked_by: domRead.blockedBy });
          note(`frame-reopen: the dominant-element directive verified-closed but ${domRead.blockedBy.length} of its remedy term(s) are unaccounted (${domRead.blockedBy.map((b) => `${b.term}=${b.class}`).join(", ")}) — domClosed stays FALSE; the clamp holds until the record can show every term ran`);
        }
        // A directive verified-closed on a PARTIAL mint carries its refusal into the receipt: the
        // ending states "closed on N of M remedy proposals; K refused: <reason>", never a bare close.
        const partials = swept.filter((k) => regPartialMint.has(k))
          .map((k) => ({ directive: k, note: `verified-closed on the minted subset — ${regPartialMint.get(k)}` }));
        const answered = swept.filter((k) => regAnsweredBy.has(k)).map((k) => ({ directive: k, slices: regAnsweredBy.get(k) }));
        const withheldBy = swept.filter((k) => regWithheldBy.has(k)).map((k) => ({ directive: k, slices: regWithheldBy.get(k) }));
        writeReopenReceipt(swept, deferrals, domClosed, partials, remedyAccounting, answered, withheldBy);
        runLog(run.runDir, { event: "frame-reopen", requested: firing.length, swept: swept.length, deferred: deferrals.length, remaining: deferrals.length, dominant_element_gap, domClosed });
        // C2 (review fix, 2026-07-29) — the redigest-fail demotion invariant, LOCKED path. The
        // unlocked path demotes verified-closed directives inline when its pre-synthesis flush
        // fails (above); under the lock the reconcile rides the LATE flush AFTER this receipt is
        // written and the clamp released, so the demotion is a hook flushDigestQueue's failure
        // branch invokes (envelopeFlushVerify shape). It moves every swept key back to a disclosed
        // deferral (redigest-fail:<reason>), rewrites the receipt with domClosed:false, and re-arms
        // ctx.frameReopenGap — the CLEAR clamp holds until the enumerated crowd actually reaches
        // the findings. Registered only when a frame-reopen reconcile item is actually pending
        // (queue-keyed, so a mint no-op on an already-pending item still gets its demotion).
        if (digestLockedReopen && swept.length && pendingItems(ctx.digestQueue).some((i) => i.trigger === "frame-reopen")) {
          const layerByKey = new Map(firing.map((d) => [reopenKey(d), d.layer]));
          const closedKeys = [...swept];
          const priorDeferrals = [...deferrals];
          //: the term ledger rides the demotion UNCHANGED. A failed re-digest demotes CLOSURE,
          // not searchedness — the queries still ran and their results are still what they were, so
          // dropping the rows here would delete a true record to reflect a false one. (The sibling
          // crash-window arm below gets this for free: it rewrites the prior receipt by spread.)
          const demoteAccounting = remedyAccounting;
          ctx.frameReopenFlushDemote = (fail) => {
            const reason = `redigest-fail:${String(fail ?? "late flush failed").slice(0, 60)}`;
            const demoted = priorDeferrals.concat(closedKeys.map((k) => ({ directive: k, layer: layerByKey.get(k) ?? "variant", reason })));
            writeReopenReceipt([], demoted, false, [], demoteAccounting);
            ctx.frameReopenGap = dominant_element_gap;
            runLog(run.runDir, { event: "frame-reopen-redigest-failed", pass: "late", fail: String(fail ?? "").slice(0, 120), demoted: closedKeys });
            note(`frame-reopen: the late flush failed — ${closedKeys.length} verified-closed directive(s) demoted to disclosed deferrals (${reason}); the frameReopenGap clamp stands until the reconcile genuinely lands`);
          };
        }
      } else if (firing.length && already && priorReceipt) {
        // a prior pass already attempted EXACTLY this firing set — its receipt is authoritative for closure.
        domClosed = priorReceipt.domClosed === true;
        note(`frame-reopen: ${firing.length} directive(s) — already attempted this set (prior outcome stands: dominant gap ${domClosed ? "closed" : "open"})`);
        runLog(run.runDir, { event: "frame-reopen-skipped", firing: firing.length, reason: "already-attempted", dominant_element_gap, domClosed });
        // C2 (review fix, 2026-07-29) — crash-window arm of the redigest-fail demotion: a prior
        // locked pass verified its closes and wrote the swept receipt, then died BEFORE its late
        // flush landed (the reconcile item is still pending). This pass trusts the receipt and the
        // clamp stays released while the flush retries below — so if THAT flush fails too, demote
        // from the prior receipt exactly as the in-pass hook does (fields preserved; only the
        // partition and domClosed change). A flush success clears the hook and the prior closes
        // stand reconciled.
        if ((priorReceipt.swept ?? []).length && pendingItems(ctx.digestQueue).some((i) => i.trigger === "frame-reopen")) {
          const layerByKey = new Map(firing.map((d) => [reopenKey(d), d.layer]));
          ctx.frameReopenFlushDemote = (fail) => {
            const reason = `redigest-fail:${String(fail ?? "late flush failed").slice(0, 60)}`;
            const demoted = [...(priorReceipt.deferrals ?? []),
              ...(priorReceipt.swept ?? []).map((k) => ({ directive: k, layer: layerByKey.get(k) ?? "variant", reason }))];
            try {
              writeFileSync(reopenReceiptPath, JSON.stringify({ ...priorReceipt, ts: new Date().toISOString(),
                swept: [], deferrals: demoted, remaining: demoted.map((x) => x.directive), domClosed: false }, null, 2) + "\n");
            } catch (e) { note(`frame-reopen receipt demotion write failed (non-fatal): ${e.message}`); }
            ctx.frameReopenGap = priorReceipt.dominant_element_gap === true;
            runLog(run.runDir, { event: "frame-reopen-redigest-failed", pass: "late", fail: String(fail ?? "").slice(0, 120), demoted: priorReceipt.swept });
            note(`frame-reopen: the late flush failed — ${(priorReceipt.swept ?? []).length} previously verified-closed directive(s) demoted to disclosed deferrals (${reason}); the frameReopenGap clamp re-arms`);
          };
        }
      } else if (firing.length) {
        // disabled / digest-locked on a resume past synthesis: cannot act this run — every firing directive is
        // a documented DEFERRAL (it still escalates+discloses below; only the sweep itself cannot run here).
        const why = reopenDisabled ? "frame-reopen-disabled" : digestLockedReopen ? "digest-locked-resume" : "no-actionable-sweep";
        const { deferrals } = partitionFiring(firing, () => false, () => why);
        writeReopenReceipt([], deferrals, false);
        note(`frame-reopen: ${firing.length} directive(s) not swept — ${why}`);
        runLog(run.runDir, { event: "frame-reopen-skipped", firing: firing.length, reason: why, dominant_element_gap, domClosed: false });
      }

      // Property 2 — a dominant-element gap the reopen did NOT close blocks a clean finding (clamp below,
      // alongside the coverage-honesty floor). This is the gap the register coverage ledger cannot itself
      // represent (an off-fielded cluster, an unsearched channel) — so it is a SEPARATE clamp input.
      ctx.frameReopenGap = dominant_element_gap && !domClosed;
      refreshSupplementalExecution(ctx);   // the reopen arms fold/dispatch supplementals — keep the receipt current
      if (ctx.frameReopenGap) note(`frame-reopen: dominant-element gap stands (unclosed) — will clamp a CLEAR verdict to CONDITIONAL`);
      // — the reopen's own sweeps just rewrote the band and the unit notes that frame-diff declares
      // as inputs, and frame-diff is ONE-SHOT by contract ("NO in-process re-diff"), so it cannot be
      // re-run to catch up. Without this, a pass that crashed between here and the end-of-pass reconcile
      // would resume with frame-diff SKIPPED (⇒ on the delivery path via ctx.skippedStages) and STALE
      // against artifacts its own sweep moved — and frame-diff has no UPSTREAM_STALE_REPAIR entry, so
      // that parks the run. Best-effort by construction: a miss just leaves the delivery gate as strict
      // as it is today.
      //
      // COMMON-LAW JOINED THIS LIST ON 2026-08-04, when the source-layer arm above still resumed the
      // common-law session and re-saved common-law.md. That arm no longer sweeps (a channel is disclosed,
      // never swept), so the reopen does not move the file now; it stays listed because frame-diff
      // declares it, and a file that did not move fingerprints the same on both sides. The seam below
      // covers the arms that run after placement; this one covers the crash window between the sweeps
      // and that seam.
      // P.commonLaw unconditionally: stageInputs["frame-diff"] declares it on every run type, and an
      // absent file fingerprints as absent on both sides — a register-only run is a no-op here.
      settleOneShotStamp(run.runDir, "frame-diff",
        [P.registerNamedBand, ...(axes ?? []).map((a) => P.registerUnit(a)), P.commonLaw],
        "frame-reopen-sweeps");
    }
  }
}
