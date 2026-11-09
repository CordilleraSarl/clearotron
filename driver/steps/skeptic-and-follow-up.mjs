// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/skeptic-and-follow-up.mjs — the skeptic, and the searches and rechecks its flags and the floors raise.
//
// One phase of a run, moved out of pipelineInner unchanged. `helpers` are functions still held in pipeline.mjs, handed in
// because this module must not import that one back; each moves here when the other phases that share it have moved.
import { runRecordLogPath } from "../../providers/_shared/ledger-path.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { heldForNothingToSend, splitDeferredByCloseability } from "../coverage-ledger.mjs";
import { CROWD_CONTEXT_AXIS, buildCrowdContext } from "../crowd-context.mjs";
import { pendingItems, runPostFlushGateRepair } from "../digest-queue.mjs";
import { config } from "../driver.config.mjs";
import { note, outputMeta, runLog } from "../log.mjs";
import { atomicWrite } from "../progress.mjs";
import { fullyDeferredAxes, undoneSearchesNote } from "../register-plan.mjs";
import { registerCapabilities } from "../register-unreachable.mjs";
import { assembleRunRecords, recordBodyHasContent } from "../registry-fidelity.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { findScreenGateParseGaps, findScreenGateViolations, screenGateZeroCause } from "../screen-gate.mjs";
import { escalatedAxes } from "../skeptic-record.mjs";
import { STAGES, lines } from "../stages.mjs";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

export async function runSkepticAndFollowUp({ P, agent, axes, ctx, dispatchPlanQids, flushDigestQueue, job, mintDigestWork, opts, planExec, run, unitKey }, helpers) {
  const { askableOf, bandBytesOf, capabilityGapAxes, defaultRecordFetcher, deriveBandShape, deriveNamedBand, envelopeDecision, envelopeHeldNote, escalationHeldNote, findFloorBreaches, forceFromActive, isInactiveAxisRow, lateRecordIds, loadCoverageLedger, officeGapOf, readFloorAxes, readPlanExecution, recordPlacementPass, recordScreenGateEvidence, refreshSupplementalExecution, remergeIfBandsMoved, runBatched, screenGateSnapshot, settleOneShotStamp, skepticDeferralExtra, stage, stickyGapUnits } = helpers;
  // Step 2.6 skeptic → code-decided escalation. The skeptic poses its flags as a QUESTION back to each
  // flagged unit, which RESUMES its own session (warm cache, same model) and defends-or-adjusts in place —
  // it does NOT redo the search from scratch on a fresh opus session. This is both cheaper (a follow-up turn
  // on the cached thread vs. a cold full opus re-run — the old path's dominant cost) and better (the unit
  // argues from the evidence it already gathered). Opus judgment still happens once, at the re-digest.
  // B1: the skeptic is a fresh-eyes audit that can only ADD escalations — its absence == the (common)
  // clean-skeptic path. A gemini-flash outage must NOT bin the completed gather+digest, so it is NON-FATAL:
  // on failure we proceed with no escalation. (Coverage/judgment stages stay fatal; this is the one exception.)
  const skepticData = skepticDeferralExtra(ctx);
  const sk = await stage("skeptic", ctx, skepticData ? { extra: skepticData } : {});
  let flags = "";
  if (sk.ok) {
    flags = readFileSync(P.skepticFlags, "utf8");
  } else {
    note(`skeptic failed (non-fatal — proceeding with no escalation): ${sk.fail}`);
    runLog(run.runDir, { event: "skeptic-skipped", reason: sk.fail });
  }
  // Which axes to re-run is decided by STRUCTURED tokens the skeptic emits — one `ESCALATE: <axis>` line per
  // axis with a material unresolved gap — NOT by substring-matching its prose (which both false-triggered on
  // incidental mentions and missed gaps phrased without the axis name). `flags` (the full prose) is still
  // passed into the follow-ups as context. No flags (clean OR skipped) ⇒ no escalation.
  //
  // The parse itself MOVED to skeptic-record.mjs (same regex, one function): the record_skeptic
  // transport renders the ESCALATE lines and re-reads them through the same `escalatedAxes` this
  // dispatch runs, so the rendered shape and this read cannot drift — the dictated-shape-with-a-
  // forgotten-reparser seam, closed by having exactly one parser.
  const escalate = escalatedAxes(flags, axes);
  // D3 — the escalation-risk SHADOW loop (risk-tag parse + would-skip telemetry for the
  // never-enabled CLEAROTRON_ESCALATION_FILTER) is DELETED; every ESCALATE line still re-runs its axis.
  // Audit-trail-aware escalation skip (Lever 4). A skeptic flag against an axis whose coverage-ledger
  // row(s) are ALL `coverage-limited` is a DOCUMENTED/ACCEPTED structural limit (a crowd recorded with its
  // count) — a warm re-run cannot close it; it
  // would only re-spend the fat gather context (the ~343K cold-write) + a 2nd Opus re-digest for no recall
  // gain, so we skip it. CONSERVATIVE predicate: skip ONLY when the axis owns ≥1 ledger row AND every owned
  // row is `coverage-limited` (a `deferred` row = real outstanding work → re-run closes it; a `confirmed-clean`
  // row still flagged = a fresh-eyes catch the ledger calls clean → escalate). An axis with no parseable
  // ledger row is never skipped. Escalating needlessly only wastes money; skipping a real gap loses recall —
  // when in doubt, escalate. (Ungated build; A/B to ship — assert only documented-accepted gaps are skipped.)
  const ledger = loadCoverageLedger(run.runDir).rows;   // WS-A: machine ledger when present, else prose
  // A2 — the capability-gap inputs the skip below decides on, read once (same authority-then-prose
  // ordering as the envelope: the receipt indicts an axis, the row reason splits inside it).
  const escalationReceipt = readPlanExecution(ctx);
  const escalationGapAxes = capabilityGapAxes(ctx.registerPlan, escalationReceipt);
  // — the floor axes this mark designated, and the axes whose floor work was excused rather than
  // executed. Read once, beside the other inputs the skip decides on, in the same authority ordering.
  const floorBreachAxes = new Set(findFloorBreaches(ledger, readFloorAxes(P)).map((b) => b.axis));
  const escalationFullyDeferred = new Set((ctx.registerPlan ? fullyDeferredAxes(ctx.registerPlan) : []).map((a) => String(a.axis).toLowerCase()));
  const codeSideEscalations = [];   // A6 — code-side axes a skeptic flag landed on; they get a deterministic recheck below, never a silent skip
  const escalateGated = escalate.filter((a) => {
    // a code-side / resumed-past unit has NO session to warm-resume (unitKey null) — and for
    // saturation-probe there is nothing to defend anyway: the band is a code-executed count table.
    if (a === "saturation-probe" && !unitKey[a]) {
      note(`escalation skipped ${a} — code-executed axis, no unit session to resume (counts are mechanical) — deterministic recheck follows`);
      runLog(run.runDir, { event: "escalation-skipped", axis: a, reason: "code-side unit (no session)" });
      codeSideEscalations.push(a);
      return false;
    }
    const owned = ledger.filter((r) => r.axis === a.toLowerCase());
    // — THE FLOOR TERM IS ON BOTH SKIP BRANCHES, AND ON THIS ONE THAT IS AN EXTENSION rather than
    // a restoration. Stated plainly because it is the one place this PR goes past what removed:
    // the retired `!floorBreachAxes.has(a)` sat on the capability-gap branch below and only there.
    //
    // Leaving this branch unheld would be internally incoherent. An axis whose rows are ALL
    // `coverage-limited` is the PUREST case of the loophole — everything excused, nothing executed — and
    // `computeOpenFloors` already discloses it as an unmet floor. So the run would state an open floor on
    // the delivered report and, in the same breath, have decided not to pursue it: flagged and not
    // pursued, which is half the ruling and the confusing half.
    //
    // It also follows this gate's own doctrine, written above: "Escalating needlessly only wastes money;
    // skipping a real gap loses recall — when in doubt, escalate."
    if (owned.length > 0 && owned.every((r) => r.status === "coverage-limited") && !floorBreachAxes.has(a.toLowerCase())) {
      note(`escalation skipped ${a} — coverage ledger documents an accepted limit (no closeable gap)`);
      runLog(run.runDir, { event: "escalation-skipped", axis: a, reason: "documented coverage-limit" });
      return false;
    }
    // A2 — the code gate behind the prompt line: an axis whose ONLY outstanding work is a
    // capability-gap deferral has nothing a warm re-run can reach. The skeptic escalated exactly
    // this on the evidence run (it re-derived the ledger out of a 103 KB prose document and got it
    // wrong), and the re-run then re-derived the provider's deterministic refusal at full price.
    // Same conservative shape as the coverage-limited skip: the receipt must indict the axis AND
    // every outstanding row must state the gap.
    //
    // ⚠ THE HOLD, and this is the one site where the search floor changes what the pipeline DOES rather
    // than what it reports. retired the ⭐ mechanism and this condition WIDENED as a consequence —
    // the old `&& !floorBreachAxes.has(a)` term PREVENTED the skip, so dropping it made an axis whose
    // only outstanding work is a capability-gap deferral skippable even where floor work had been
    // excused rather than executed. restores the term against the typed designation.
    //
    // The direction is the point: a floor breach does not force a re-run, it withholds a SKIP. An axis
    // that could not be fully checked is never quietly closed — it stays flagged and pursued. And with
    // no designation `floorBreachAxes` is empty, so this reads exactly as it does today on every run
    // that designates no floor.
    if (owned.length > 0 && !floorBreachAxes.has(a.toLowerCase())) {
      const split = splitDeferredByCloseability(ledger, a, escalationGapAxes,
        { fullyDeferred: escalationFullyDeferred.has(a.toLowerCase()), heldUnits: stickyGapUnits(P), uncovered: officeGapOf(ctx.registerPlan), askable: askableOf(escalationReceipt) });
      const openNonDeferred = owned.some((r) => r.status !== "deferred" && r.status !== "coverage-limited");
      if (split.held.length > 0 && split.closeable.length === 0 && !openNonDeferred) {
        // Held only because none of its rows has a question left to send is not a capability gap, and says so.
        const nothingToSend = heldForNothingToSend(split);
        note(nothingToSend
          ? `escalation skipped ${a} — no question is left to send, so a re-run cannot close it (the gap stays open and disclosed)`
          : `escalation skipped ${a} — capability-gap deferral: the active register provider cannot express those slices, so a re-run re-derives the same refusal (the gap stays open and disclosed)`);
        runLog(run.runDir, { event: "escalation-skipped", axis: a,
          reason: nothingToSend ? "no question left to send (nothing a re-run can close)" : "capability-gap deferral (nothing a re-run can close)" });
        return false;
      }
    }
    return true;
  });
  // Escalation is a PRE-synthesis digest refinement (re-run the flagged axis → re-digest). Once synthesis has
  // produced narrative.md, the digest it consumed is locked in — so on a RESUME past synthesis we must NOT
  // re-fire it: a cold-session re-run would re-spend Corsearch and could rewrite register-findings.md, which
  // would corrupt the audit spine the deliverable is built from. V4-1: the lock is "will synthesis run for
  // THIS delivery" — an inherited narrative.md that --from synthesis is about to force-re-run does NOT lock
  // (the stale-proxy bug: forks never closed closable digest work).
  const digestLocked = existsSync(P.narrative) && !forceFromActive(ctx, "synthesis");
  // ── A6 (hardening 8, 2026-07-28 postmortem): a skeptic flag on a CODE-SIDE axis used to END at the skip
  // event — no deterministic re-run, no recorded ending (it fired 2× on the 2026-07-28 postmortem run, silently). The
  // axis is fully dictated, so the honest cheap answer IS code: re-dispatch its frozen plan qids ONCE
  // through the deterministic executor (count probes — seconds, no session, no agent turn). A band
  // that comes back changed makes the digest stale w.r.t. its declared inputs, so stage-staleness
  // forces the re-digest deterministically — no new trigger is invented here. With no dispatch lane
  // (no executor adapter / no frozen plan / repair budget spent) the skip is recorded
  // judged-immaterial WITH its reason, so the escalation has an ending either way. Runs under the
  // same digest lock as the warm escalation arm: past synthesis, a band mutation belongs to the
  // frame-reopen/digest-queue lanes, not here.
  for (const a of codeSideEscalations) {
    if (digestLocked) {
      runLog(run.runDir, { event: "escalation-recheck", axis: a, dispatched: false, reason: "digest-locked (post-synthesis) — a band mutation here would bypass the digest lock" });
      continue;
    }
    if (!planExec || !ctx.registerPlan) {
      runLog(run.runDir, { event: "escalation-recheck", axis: a, dispatched: false, reason: "judged-immaterial: no deterministic dispatch lane (no executor/frozen plan) — the gathered counts stand" });
      continue;
    }
    const bandBefore = (() => { try { return readFileSync(P.registerBand(a), "utf8"); } catch { return null; } })();
    const outcome = await dispatchPlanQids(a, null, "escalation-recheck", 1);
    const bandAfter = (() => { try { return readFileSync(P.registerBand(a), "utf8"); } catch { return null; } })();
    const bandChanged = outcome === "ok" && bandAfter != null && bandBefore !== bandAfter;
    runLog(run.runDir, { event: "escalation-recheck", axis: a, dispatched: outcome != null, outcome: outcome ?? "repair-budget-exhausted", bandChanged });
    if (bandChanged) {
      try { deriveNamedBand(ctx); } catch (err) { note(`escalation-recheck ${a}: band re-merge failed (${String(err?.message ?? err).slice(0, 100)}) — the digest will re-merge on its own pass`); }
      // The changed counts must REACH the digest THIS pass, not by ambush at delivery: minting digest
      // work rides the same pre-synthesis settlement flush as the warm escalation lane above. Leaving
      // it to the delivery-freshness gate alone (register-digest is on staleOnPath) means synthesis
      // and the cards get built from the PRE-recheck digest, delivery blocks as stale, and the run
      // pays a park + a full back-half recompute — the exact re-drive cascade the funnel
      // exists to prevent — for what one flush section reconciles in-pass.
      mintDigestWork("escalation-recheck", [a], lines(
        `A skeptic flag on the code-executed ${a} axis triggered a deterministic recheck: its frozen plan queries were re-dispatched and the fresh counts CHANGED the crowd band. Re-read that axis's updated unit file and count band, reconcile your prior findings against the fresh counts, and revise only what the changed band requires.`,
      ));
      note(`escalation-recheck ${a}: fresh dispatch changed the band — re-digest queued for the settlement flush`);
    }
  }
  if (escalateGated.length && !digestLocked) {
    // Fix 3: re-run flagged axes CONCURRENTLY (was a sequential await-per-axis loop, ~19 min → ~6 min),
    // reusing the gather pass's runBatched fan-out at config.gatherConcurrency (≤ gateway maxConcurrent —
    // proven by the first gather pass). Each axis is independent: it resumes its OWN session key
    // (unitKey[a]) and writes its OWN unit file, so there is no shared mutable state — the only join is the
    // escalated[] collection, which stays deterministic because runBatched writes results by index.
    const escResults = await runBatched(escalateGated, config.gatherConcurrency, async (a) => {
      // WS4: snapshot the unit file BEFORE the escalated re-run. A warm "defend-in-place" that re-emits a
      // byte-identical file leaves the digest's inputs unchanged, so re-firing the Opus re-digest for it is
      // provably wasted spend (the re-digest's own followup says "re-read only those updated unit files").
      // Only axes whose unit file MATERIALLY changed stay in escalated[]; content-compare is conservative —
      // any byte difference re-fires, so a genuine recall fix is never skipped. Floor-neutral.
      const beforeUnit = existsSync(P.registerUnit(a)) ? readFileSync(P.registerUnit(a), "utf8") : null;
      const beforeBand = bandBytesOf(P, a);   // a narrow sub-query adds blocks to the band, whatever it does to the notes
      note(`skeptic escalated ${a} → resuming its session to defend/adjust (warm, same tier)`);
      let followup = repairFollowup("register-unit:escalation", { paths: P, axis: a, flags,
        supplementalLane: !!ctx.registerPlan?.contract?.supplemental_lane, job: ctx.job, profile: ctx.profile });
      // A2, per-row: the skip above only catches an axis whose ENTIRE outstanding work is held (a
      // capability gap, or nothing left to send). An axis is often escalated for a good reason (a flagged confirmed-clean row)
      // while ALSO carrying held rows — and the resumed unit must not be left to think those are
      // work it failed to do. Name them, exactly as the envelope's close followup does.
      const escHeld = splitDeferredByCloseability(ledger, a, escalationGapAxes,
        { fullyDeferred: escalationFullyDeferred.has(a.toLowerCase()), heldUnits: stickyGapUnits(P), uncovered: officeGapOf(ctx.registerPlan), askable: askableOf(escalationReceipt) }).held;
      followup += escalationHeldNote(escHeld);
      // No opts.model → stays on this axis's original tier (axisTier: sonnet/haiku); the followup is a fresh
      // session, so no cache rides on it. sessionKey: unitKey[a] names the EXACT key the unit won on. force bypasses idempotency.
      const r = await stage("register-unit", { ...ctx, axis: a }, { force: true, followup, sessionKey: unitKey[a], trigger: "escalation" });
      if (!r.ok) return { axis: a, changed: false, ok: false };
      const afterUnit = readFileSync(P.registerUnit(a), "utf8");
      const changed = afterUnit !== beforeUnit || bandBytesOf(P, a) !== beforeBand;
      if (!changed) {
        note(`escalation ${a}: unit defended in place (unchanged) — Opus re-digest not needed`);
        runLog(run.runDir, { event: "escalation-noop", axis: a });
      }
      return { axis: a, changed, ok: true };
    });
    const escalated = escResults.filter((e) => e.changed).map((e) => e.axis);
    remergeIfBandsMoved(ctx, "escalation");
    // W-3 input (D1): persist the escalation outcome so the client-export gate can WITHHOLD when a
    // load-bearing escalation the system ITSELF raised did not complete. requested = axes attempted this
    // session; failed = those whose register-unit stage returned !r.ok (never ran to a result). The
    // documented-coverage-limit skips (escalate − escalateGated) are accepted limits, never "failed".
    try {
      atomicWrite(driverDir(run.runDir, "escalation-state.json"), JSON.stringify({   // B5 — the client-gate reads this: never truncated
        ts: new Date().toISOString(),
        requested: escalateGated,
        completed: escResults.filter((e) => e.ok).map((e) => e.axis),
        failed: escResults.filter((e) => !e.ok).map((e) => e.axis),
      }, null, 2) + "\n");
    } catch (e) { note(`escalation-state write failed (non-fatal): ${e.message}`); }
    refreshSupplementalExecution(ctx);   // escalation followups may have PROPOSED supplementals — account for them
    if (escalated.length) {
      runLog(run.runDir, { event: "skeptic-escalation", escalated });
      const escalationSegment = lines(
        `The Step-2.6 skeptic flagged the issues below, and these register units have just defended/revised in place: ${escalated.join(", ")}. Re-read only those updated unit files, reconcile your prior findings against them, and revise only what these flags and the new coverage require.`,
        ``,
        flags,
      );
      //: the unit defend/adjust work above is KEPT; only the opus re-digest is deferred to
      // the pre-synthesis settlement flush. Keyed on the escalated axis set — a resume re-entering
      // this block with the same set no-ops (the receipt survives the resume).
      mintDigestWork("escalation", escalated, escalationSegment);
    }
  }

  // ── Spec A3: deadline-envelope — close unmet must-search floor obligations IN-LOOP when time allows ──
  // Floor obligations = `deferred` Coverage-ledger rows (planned but never run — incl. material
  // jurisdictions the digest reconciliation found unsearched). `coverage-limited` rows are documented
  // accepted limits (Lever 4) — a re-run cannot close them, so they are not floors here. Close mechanics
  // mirror the skeptic-escalation block above: a followup on the owning unit's winning key,
  // byte-diff guard, ONE re-digest for materially-changed axes. Same audit-spine lock: never re-fire
  // past synthesis. The decision (envelope arithmetic + choice) is always logged; whatever remains
  // unclosed at delivery is stated in the report with its MECHANICAL cause (front-matter, code-built).
  //
  // funnel trade (owner-accepted): with escalation+envelope COALESCED into one settlement
  // flush, this decision reads the FRESH digest's ledger (exactly as on runs with no escalation) —
  // the escalation re-digest no longer runs first, so a NEW `deferred` row that escalation-changed
  // units would have surfaced via that re-digest is not visible to THIS envelope pass. That miss is
  // NOT silent: the flushed digest re-emits the Coverage ledger, and any still-open deferred row
  // surfaces at delivery via computeOpenFloors → envelope_note (front-matter) and the U1 floor.
  ctx.envelopeNote = null;
  {
    const ledgerNow = loadCoverageLedger(run.runDir).rows;   // WS-A: machine ledger when present, else prose
    const axesLc = axes.map((x) => x.toLowerCase());
    // Floors = `deferred` rows. The ⭐-breach union is retired — see the note where
    // `findFloorBreaches` used to live.
    const deferredAxes = [...new Set(ledgerNow.filter((r) => r.status === "deferred").map((r) => r.axis))]
      .filter((a) => axesLc.includes(a))
      // a code-side saturation-probe has no unit session to warm-resume, and its dictated entries were
      // executor-run to completion — a "deferred" sat-probe row can only be ledger prose; skip the arm.
      .filter((a) => a !== "saturation-probe" || unitKey[a]);
    // A2 — split each axis's floor obligations into what a re-run can close and what it never can.
    // The plan-execution receipt is the authority (capabilityGapAxes); the row reason only splits
    // INSIDE an indicted axis. An axis with nothing closeable is HELD: never re-run, never closed by
    // time, still deferred, still an open floor, still disclosed.
    const envelopeReceipt = readPlanExecution(ctx);
    const gapAxes = capabilityGapAxes(ctx.registerPlan, envelopeReceipt);
    const fullyDeferred = new Set((ctx.registerPlan ? fullyDeferredAxes(ctx.registerPlan) : []).map((a) => String(a.axis).toLowerCase()));
    const stickyUnitsNow = stickyGapUnits(P);   // a gap this run already accepted is held whatever its row's reason says
    const closeabilityByAxis = new Map(deferredAxes.map((a) => [a,
      splitDeferredByCloseability(ledgerNow, a, gapAxes, { fullyDeferred: fullyDeferred.has(String(a).toLowerCase()), heldUnits: stickyUnitsNow,
        uncovered: officeGapOf(ctx.registerPlan), askable: askableOf(envelopeReceipt) })]));
    const heldAxes = deferredAxes.filter((a) => {
      const s = closeabilityByAxis.get(a);
      // The `!hasBreach &&` term is retired with the ⭐ floor: it kept an axis carrying a
      // mislabelled floor row out of the HELD set, because such a row is work a re-run can do rather
      // than a capability refusal. With no breaches to find, the split alone decides.
      return s.held.length > 0 && s.closeable.length === 0;
    });
    const closeableAxes = deferredAxes.filter((a) => !heldAxes.includes(a));
    const estCloseSec = closeableAxes.length
      ? closeableAxes.length * (STAGES["register-unit"].timeoutSec / 2) + STAGES["register-digest"].timeoutSec / 2
      : 0;
    const decision = envelopeDecision({ deferredAxes, deadline: job.deadline ?? null, now: Date.now(), estCloseSec, heldAxes });
    // unconditional telemetry (AD-4): held/held_rows are written on every run, empty included, so
    // "nothing was held" is a recorded answer and not an absent field.
    // `floorBreaches` is GONE from this event. Its only consumer was pipeline.mock.test.mjs's
    // C-2 arm, which retires in the same diff; ask-ledger.mjs reads `reason`/`axes`/`unverified` here and
    // is untouched.
    runLog(run.runDir, { event: "envelope-decision", deferredAxes, estCloseSec, deadline: job.deadline ?? null,
      held_rows: heldAxes.map((a) => ({ axis: a, rows: (closeabilityByAxis.get(a)?.held ?? []).map((r) => ({ unit: r.unit, reason: String(r.reason ?? "").slice(0, 200) })) })),
      ...decision });
    // An axis held only because none of its rows has a question left to send is not a capability gap: the client's
    // note below names the capability-held axes alone, and the open-floor line discloses the rest.
    const nothingToSendOnly = (a) => heldForNothingToSend(closeabilityByAxis.get(a));
    for (const a of heldAxes) {
      note(nothingToSendOnly(a)
        ? `envelope: ${a} HELD — no question is left to send, so a re-run cannot close it; the floor stays open and ships disclosed`
        : `envelope: ${a} HELD — a capability-gap deferral is never closeable by time; the floor stays open and ships disclosed`);
    }
    // V4-1: same digest-lock semantics as the escalation block — a --from synthesis fork's inherited
    // narrative does not lock the digest (synthesis is about to re-run over it).
    const digestLockedEnv = existsSync(P.narrative) && !forceFromActive(ctx, "synthesis");
    if (closeableAxes.length && decision.close && !digestLockedEnv) {
      const closeResults = await runBatched(closeableAxes, config.gatherConcurrency, async (a) => {
        const beforeUnit = existsSync(P.registerUnit(a)) ? readFileSync(P.registerUnit(a), "utf8") : null;
        const beforeBand = bandBytesOf(P, a);   // a close that runs the deferred slices adds blocks to the band
        // quote the axis's own deferred ledger rows + ⭐-floor breach rows verbatim so the unit closes
        // exactly what was deferred (or mislabelled away). WS-A: the quoted rows come from the SAME
        // loadCoverageLedger read the gate decided on — never a separate prose grep that could diverge.
        // A2: a HELD row (capability gap) is excluded from the quoted work and named separately — the
        // unit must not be asked to close what the provider cannot express, and must not delete the row.
        const split = closeabilityByAxis.get(a) ?? { closeable: [], held: [] };
        const rows = split.closeable
          .map((r) => `| ${r.unit} | deferred | ${r.reason} |`).join("\n");
        const heldRows = envelopeHeldNote(split.held);
        note(`envelope: closing deferred coverage on ${a} (deadline permits — ${decision.reason})`);
        // What the re-opened unit is asked to close, and what it is told to leave: the record of the split
        // this close acted on, so a gap handed back as work is visible in the run's own log.
        runLog(run.runDir, { event: "envelope-close-rows", axis: a,
          closeable: split.closeable.map((r) => String(r.unit ?? "")), held: split.held.map((r) => String(r.unit ?? "")) });
        const followup = repairFollowup("register-unit:envelope-close", { paths: P, axis: a, rows: rows + heldRows,
          supplementalLane: !!ctx.registerPlan?.contract?.supplemental_lane, job: ctx.job, profile: ctx.profile });
        const r = await stage("register-unit", { ...ctx, axis: a }, { force: true, followup, sessionKey: unitKey[a], trigger: "envelope" });
        if (!r.ok) return { axis: a, changed: false, fail: r.fail };
        const afterUnit = readFileSync(P.registerUnit(a), "utf8");
        return { axis: a, changed: afterUnit !== beforeUnit || bandBytesOf(P, a) !== beforeBand, fail: null };
      });
      remergeIfBandsMoved(ctx, "envelope");
      const closedChanged = closeResults.filter((e) => e.changed).map((e) => e.axis);
      const closeFails = closeResults.filter((e) => e.fail);
      if (closedChanged.length) {
        // The reconcile segment — shared verbatim between the legacy immediate re-digest (funnel OFF)
        // and the queued settlement-flush section (funnel ON).
        const envelopeSegment = `These register units just CLOSED their deferred Coverage-ledger work (deadline-envelope rule): ${closedChanged.join(", ")}. Re-read only those updated unit files, reconcile your prior findings and the Coverage ledger against them, and revise only what the new coverage requires.`;
        // Post-re-digest bookkeeping, shared by both paths (funnel ON runs it after the settlement
        // flush lands — the detectors are meaningless before the re-emitted ledger exists):
        // (1) Timeout-taint resolution: an envelope close that CHANGED the axis is the sanctioned closer for
        //     its deferred rows — judgment engaged with the honest taint reason and re-emitted. Mark the
        //     receipt resolved FIRST (before the verify read below), else loadCoverageLedger would re-relabel
        //     the freshly-closed rows and the verify would read them as still-open.
        // (2) Fix 2 (close-the-loop, #7) — the envelope quoted the EXACT deferred rows + ⭐-floor breaches to
        //     close, then logged `envelope-closed` on a byte-diff, telling the audit trail those floors closed
        //     even when the search re-emitted without actually resolving them (RUN1: the incumbent-class /
        //     opposition floors "closed" then shipped still-open). Re-run the SAME detectors on the RE-DIGESTED
        //     ledger and log as closed ONLY the axes whose specific breach/deferral is gone; the rest are
        //     recorded `unverified`. The still-open floors are DISCLOSED by the existing computeOpenFloors →
        //     envelope_note path at delivery (deliver-always; disclose > false-clean), so this arm never
        //     withholds and never mutates that disclosure — it only stops the audit trail claiming a false close.
        //     No re-attempt here: a second paid envelope pass is thrash, and (unlike the register arm) there is
        //     no structured remedy to correct the query with — an honest disclosure is the close.
        const verifyEnvelopeClosure = () => {
          try {
            const tp = driverDir(run.runDir, "register-taint.json");
            if (existsSync(tp)) {
              const rec = JSON.parse(readFileSync(tp, "utf8"));
              let touched = false;
              for (const a of closedChanged) {
                if (rec?.axes?.[a]?.status === "active") {
                  rec.axes[a] = { ...rec.axes[a], status: "resolved", resolvedBy: "envelope", resolvedAt: new Date().toISOString() };
                  touched = true;
                }
              }
              if (touched) { writeFileSync(`${tp}.tmp`, JSON.stringify(rec, null, 2) + "\n"); renameSync(`${tp}.tmp`, tp); }
            }
          } catch (e) { note(`register-taint receipt update failed (non-fatal): ${String(e.message).slice(0, 80)}`); }
          const ledgerAfter = loadCoverageLedger(run.runDir).rows;
          const deferredAfter = new Set(ledgerAfter.filter((r) => r.status === "deferred" && !isInactiveAxisRow(r) && axesLc.includes(r.axis)).map((r) => r.axis));
          // The breach half is retired: an axis is unverified when a deferral survives the
          // re-digest. `envelope-closed`'s `unverified` list keeps its meaning for ask-ledger.mjs.
          const envUnverified = closedChanged.filter((a) => deferredAfter.has(a));
          const envVerified = closedChanged.filter((a) => !envUnverified.includes(a));
          runLog(run.runDir, { event: "envelope-closed", axes: envVerified, ...(envUnverified.length ? { unverified: envUnverified } : {}) });
          if (envUnverified.length) note(`envelope: ${envUnverified.join(", ")} re-emitted but the floor is NOT closed (breach/deferral still present after the re-digest) — will ship disclosed, not marked closed`);
        };
        //: the unit closes above are KEPT; the opus re-digest coalesces into the settlement
        // flush. Keyed on the deferred-row set this decision fired over (a resume re-entering with
        // the same open rows no-ops); the closure verification runs after the flush lands.
        mintDigestWork("envelope",
          ledgerNow.filter((r) => r.status === "deferred").map((r) => `${r.axis}/${r.unit}`),
          envelopeSegment);
        ctx.envelopeFlushVerify = verifyEnvelopeClosure;
      }
      if (closeFails.length) {
        ctx.envelopeNote = closeFails.map((e) =>
          `deferred coverage on ${e.axis} not closed — close attempt failed mechanically (${e.fail})`).join("; ");
        // T3 (H3): a MECHANICAL close-fail of a system-raised envelope close is the same
        // class as a failed escalation — "the main search didn't finish". It lands in the SAME sink
        // the client-gate preflight reads (additive; a prose note alone let it ship finished-looking).
        try {
          const p = driverDir(run.runDir, "escalation-state.json");
          const cur = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { requested: [], completed: [] };
          const failed = [...new Set([...(cur.failed ?? []), ...closeFails.map((e) => `envelope:${e.axis}`)])];
          atomicWrite(p, JSON.stringify({ ...cur, ts: new Date().toISOString(), failed }, null, 2) + "\n");   // B5 — the client-gate reads this: never truncated
        } catch (e) { note(`escalation-state append failed (non-fatal): ${e.message}`); }
      }
    } else if (closeableAxes.length) {
      ctx.envelopeNote = digestLockedEnv
        ? `deferred coverage (${closeableAxes.join(", ")}) not closed — resume past synthesis locks the digest (re-running would corrupt the audit spine)`
        : `deferred coverage (${closeableAxes.join(", ")}) not closed — ${decision.reason}`;
    }
    // A2 — held axes are DISCLOSED, never silently absent: the note is what the report's front matter
    // renders, and a gap nothing can close is precisely the gap the lawyer must be told about. It
    // rides beside any close note rather than replacing it.
    // The account is the owner's sentences (approved 2026-10-30): the searches the register refused during the run apart
    // from the ones it does not support, each refused one with the register's recorded answer, read from the receipt.
    const capabilityHeldAxes = heldAxes.filter((a) => !nothingToSendOnly(a));
    if (capabilityHeldAxes.length) {
      const heldNote = undoneSearchesNote(ctx.registerPlan, envelopeReceipt, capabilityHeldAxes);
      ctx.envelopeNote = ctx.envelopeNote ? `${ctx.envelopeNote}; ${heldNote}` : heldNote;
    }
    refreshSupplementalExecution(ctx);   // envelope closes may have PROPOSED supplementals — account for them
  }

  // Fix 1b — Finding-1 acceptance gate. An in-scope-live mark may NOT be goods/field-dropped on the batch
  // row alone; such a drop must rest on a record_fetch of the real goods. We parse the FINAL
  // register-findings negative-results drops (after any escalation re-digest above rewrote the file) and
  // cross-check each in-scope-live goods/field drop's URI against the run's record_fetch ledger. A violation
  // is the exact CN-pair failure mode. On a resume past synthesis the findings are already final, so
  // re-checking them here is still correct.
  //
  // RECOVER-THEN-DISCLOSE (completes the Fix-3 escalation): the gate is correct and must never be silenced,
  // but the flagged marks are FETCHABLE — a high-conflict run (KINETIC) where the digest took the
  // name-inferred shortcut on a few marks should SELF-HEAL, not die. So on the first violation we do ONE
  // followup re-digest that forces the worker to record_fetch the flagged URIs and re-decide on their
  // REAL goods (mirrors the coverage-ledger recoverCoverageLedger / candidate-self followup pattern, on the
  // WINNING digest key; a fresh session, so the message names the findings it re-decides). Whatever is STILL
  // violating after that one recovery pass is disclosed as unexamined + clamps the verdict (owner
  // decision 2026-07-22 — the terminal branch below); the gate never silently passes a drop.
  {
    const runPrefix = `clearance-${run.slug}-${run.codename}-`;
    // Re-read the findings + recompute the fetched universe on EACH check (the recovery re-digest rewrites
    // the findings AND may record_fetch the flagged URIs — both must be picked up on the post-recovery
    // check). V4-1: the fetched universe is the DELIVERED ARTIFACT SET's records (run-dir _records/ ∪ this
    // session's ledger rows) — not the session-prefixed ledger alone. A failed fetch is not a retrieval, and a
    // body that carries no record is not one either (ruled 2026-10-18): neither answers the gate, so such a drop
    // gets the gate's own recovery fetch and, failing that, its disclosure. A valid copy the run already holds
    // still answers it, whatever a later attempt did. A call the register answered `ok` is no record on its own:
    // every register files the body it fetched, and a 200 carrying an empty record files an empty one, so the
    // body is what is read, never the call's status.
    const fetchedUniverse = () => new Set(
      [...assembleRunRecords(run.runDir, runPrefix).records].filter(([, body]) => recordBodyHasContent(body)).map(([uri]) => uri));
    const checkScreenGate = () => {
      const findings = existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "";
      return findScreenGateViolations(findings, fetchedUniverse());
    };

    // PARSE-GAP LEDGER (2026-07-21): records the gate is blind to because URI_RE's `[a-z]{2}` cannot read
    // their jurisdiction segment (/mark/int/ Madrid, /mark/uss/ US state). NEVER fatal and never a
    // violation — they would be unclearable, since no re-digest can satisfy a parser that cannot read the
    // answer. Logged so the exposure is measurable before and after the coordinated URI-grammar fix.
    {
      const gaps = findScreenGateParseGaps(existsSync(P.registerFindings) ? readFileSync(P.registerFindings, "utf8") : "");
      if (gaps.length) {
        runLog(run.runDir, { event: "screen-gate-parse-gap", count: gaps.length, refs: gaps.map((g) => g.ref) });
        note(`screen-gate: ${gaps.length} goods-drop record reference(s) our URI grammar cannot parse (${[...new Set(gaps.map((g) => g.ref.split("/")[2]))].join(", ")}) — not policed this run; see the URI-grammar fix`);
      }
    }

    // UNNAMED-DROP ARM — OBSERVE MODE (2026-07-21, approved gating). A goods/field drop naming no record
    // anywhere is the same disease as the NR10 batch, but the measured population is large (19 of 35
    // goods-drop rows in the delivered archive), so arming it terminal blind would fail most runs on a
    // repair path whose model compliance is untested. It runs observe-only through the fresh-mark
    // validation run and the replays, and the observation answers the question that decides the
    // semantics — TRACEABILITY, not row shape:
    //   (a) the row dismisses records named NOWHERE in the run's artifacts → NR10's disease → terminal
    //       the day this arms;
    //   (b) the row is a slice-level screen over a band whose members ARE enumerated with URIs elsewhere
    //       in the run (the "204 NODE + 5 OWED + 50 OED scanned" field-screen shape) → auditable
    //       record-by-record, just not in the drop row. Forcing 470 rows for a crowd screen the band
    //       already enumerates would be the rule outstripping what judgment needs.
    // So we record, per unnamed row, whether the run enumerated anything under that row's search term.
    // Never fatal, and deliberately NOT deciding the semantics here — this collects the evidence the
    // proposal is built from. Set CLEAROTRON_SCREEN_GATE_UNNAMED=enforce to arm it terminal.
    const unnamedArmed = String(process.env.CLEAROTRON_SCREEN_GATE_UNNAMED ?? "").toLowerCase() === "enforce";
    {
      const unnamed = checkScreenGate().filter((v) => !v.uri);
      if (unnamed.length) {
        // The run's enumerated material: which slices (`_query`) produced records, and how many.
        let byQuery = new Map(), totalEnumerated = 0;
        try {
          const band = JSON.parse(readFileSync(P.registerNamedBand, "utf8"));
          for (const r of (band?.enumerated ?? [])) {
            const q = String(r?._query ?? "").toLowerCase();
            byQuery.set(q, (byQuery.get(q) ?? 0) + 1);
            totalEnumerated++;
          }
        } catch { /* no band on this path — the rows still log, with no traceability evidence */ }
        const words = (s) => String(s ?? "").toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
        const rows = unnamed.map((v) => {
          const terms = words(v.notes.split(";")[0]).concat(words(v.mark));
          let traceable = 0;
          for (const [q, n] of byQuery) if (terms.some((t) => q.includes(t))) traceable += n;
          return { mark: v.mark.slice(0, 40), result: v.result.slice(0, 40),
            notes: v.notes.replace(/\s+/g, " ").slice(0, 160),
            enumeratedUnderTerm: traceable, class: traceable > 0 ? "b:slice-over-enumerated-band" : "a:named-nowhere" };
        });
        runLog(run.runDir, { event: "screen-gate-unnamed-observed", mode: unnamedArmed ? "enforce" : "observe",
          count: rows.length, totalEnumerated,
          classA: rows.filter((r) => r.class.startsWith("a")).length,
          classB: rows.filter((r) => r.class.startsWith("b")).length, rows });
        note(`screen-gate: ${rows.length} goods-drop row(s) name no record (${rows.filter((r) => r.class.startsWith("a")).length} traceable nowhere, ${rows.filter((r) => r.class.startsWith("b")).length} over an enumerated band) — ${unnamedArmed ? "ENFORCING" : "observe-only this run"}`);
      }
    }

    // Observe mode: the unnamed rows are logged above and dropped from the ENFORCED set, so only NAMED
    // records (the multi-URI policing that ships terminal now) can fail a run.
    //
    // ION/copper-foundry 2026-07-22: this filter used to be applied inline to the FIRST check only, and
    // the post-repair re-check below called checkScreenGate() raw — so an unnamed row that observe mode
    // had just excluded came back and killed the run in the terminal branch. The run log for that run
    // says `mode:"observe"` and the failure detail says "drop row names no record URI", which is the
    // unnamed branch: it died on a rule the same function had declared non-enforcing four lines earlier.
    //
    // Worse, an unnamed row is UNFIXABLE on that path by construction — the repair loop below skips it
    // (`if (!v.uri) continue` — the driver cannot fetch what nobody named), so once it reaches the
    // re-check it fails every time. Observe mode was the only thing holding it, and it was dropped at
    // exactly the point where it was load-bearing. Any run with one unnamed goods-drop row plus at least
    // one named violation (ION had eleven) dies here.
    //
    // One filter, one helper, both call sites. The mode is a property of the RUN, not of a call site.
    const enforcedViolations = () => {
      const v = checkScreenGate();
      return unnamedArmed ? v : v.filter((x) => x.uri);
    };
    //: AFTER any settlement/late flush lands a digest, re-run this gate in code over the
    // flushed findings (cheap — the re-emitted file may carry a NEW drop row without a fetch
    // receipt) with at most ONE bounded code-fetch repair round; survivors are FLAGGED, never
    // looped on and never a delivery gate (the disclose-clamp arm below already ran, immediately, at
    // the mechanism). Registered here so the flush (which runs later, at the frame-reopen seam)
    // reuses the exact same check + fetched-universe closure as the gate itself.
    ctx.screenGateRecheck = async (pass) => {
      const fetcher = opts.recordFetcher ?? defaultRecordFetcher;
      const { violations: leftover, failures: postFlushFailures } = await runPostFlushGateRepair({
        check: enforcedViolations,
        fetcher: (uri) => fetcher(uri, { agentId: agent, sessionKey: `${runPrefix}screen-gate-refetch`, recordLog: runRecordLogPath(run.runDir) }),
        log: (row) => runLog(run.runDir, { pass, ...row }),
      });
      const sidecar = driverDir(run.runDir, "screen-gate-unresolved.json");
      if (leftover.length) {
        note(`screen-gate (post-flush): ${leftover.length} drop row(s) still lack a fetch receipt after one code-fetch repair round — flagged (bounded; never a loop)`);
        // Re-stamp the disclosure to the CURRENT leftover set — the flush may have corrected some
        // rows while new ones appeared; the floor and the sidecar must describe what is true now.
        // A row already disclosed keeps its original (more specific) fetch-failure cause.
        const priorCause = new Map((ctx.screenGateUnresolved ?? []).map((u) => [u.uri ?? u.mark, u]));
        // — the PROVIDER's own words first. `runPostFlushGateRepair` now returns what each fetch
        // said instead of discarding it, so a row disclosed on this path names the register's error
        // rather than the driver's generic string. `cause_source` says which of the three it is,
        // because "the provider refused" and "the fetch reported ok and the gate still cannot see the
        // record" have completely different fixes and used to print identically.
        ctx.screenGateUnresolved = leftover.map((v) => {
          const key = v.uri ?? v.mark;
          const fresh = v.uri ? postFlushFailures?.get(v.uri) : null;
          const prior = priorCause.get(key);
          if (fresh) return { mark: v.mark, uri: v.uri ?? null, cause: fresh, cause_source: "provider" };
          // An earlier pass's cause keeps the source it was given: a refusal is the provider's on that earlier
          // pass, and a fetch that reported success, or a row naming no record, stays what it was.
          if (prior?.cause) return { mark: v.mark, uri: v.uri ?? null, cause: prior.cause,
            cause_source: !prior.cause_source || prior.cause_source === "provider" ? "provider-earlier-pass" : prior.cause_source };
          return {
            mark: v.mark, uri: v.uri ?? null,
            cause: v.uri
              // The fetch did NOT fail. That is the 641-mark class — a case-fold, a granularity or a
              // record-log write loss — and calling it "not retrievable" sent a whole run chasing the
              // provider while the records sat in _records/ the entire time.
              ? "the record_fetch reported success and the gate still cannot see this record — NOT a provider failure; look at the run's own record set before raising it with the vendor"
              : "drop row names no record URI — the dismissal cannot be examined or audited",
            cause_source: v.uri ? "driver-fetch-reported-ok" : "no-uri",
          };
        });
        atomicWrite(sidecar, JSON.stringify({ ts: new Date().toISOString(), unresolved: ctx.screenGateUnresolved }, null, 2) + "\n");
      } else {
        // HEALED AT THE FLUSH: the settled digest re-justified (or the repair fetch grounded) every
        // formerly-unexamined drop. A healed gap must not keep clamping — clear the in-process floor
        // input AND the durable sidecar, exactly like the mechanism's own recovered branch.
        if (Array.isArray(ctx.screenGateUnresolved) && ctx.screenGateUnresolved.length) {
          ctx.screenGateUnresolved = null;
          rmSync(sidecar, { force: true });
          runLog(run.runDir, { event: "screen-gate-clean", recovered: true, pass });
        }
      }
    };
    let violations = enforcedViolations();
    // What the gate's answer stood on before it fetched anything, and each fetch it makes: the evidence below.
    const heldBeforeGate = fetchedUniverse();
    const gateBefore = screenGateSnapshot(ctx, runPrefix);
    const gateFetched = new Map();
    if (violations.length) {
      // REPAIR-OR-DISCLOSE, NEVER BLOCK (2026-06-18). The digest intermittently drops an in-scope-live mark on
      // goods WITHOUT record_fetching it, and a generic re-digest re-runs identically (the model skips the same
      // fetch) — so the old warm-re-fetch could not repair it and the run HARD-HALTED (no report). A production
      // report must ALWAYS ship. So: (1) the DRIVER fetches the flagged URIs in CODE (the V4-2 record-closure
      // pattern — deterministic, no agent turn, no model-compliance dependency); the plugin chokepoint writes
      // them to the ledger+records so the gate's fetched-universe picks them up. (2) Best-effort, re-decide those
      // rows on the now-fetched goods via the digest session. (3) Whatever STILL cannot be retrieved is an
      // irreducible examination gap (dead/404 record, provider error) → DISCLOSE it + CLAMP the verdict (the
      // coverage-honesty floor below) and DELIVER. The gate's intent (no SILENT drop of an in-scope mark) is
      // preserved by loud disclosure, never by withholding the report.
      // uris self-describe (2026-07-29): an unnamed drop row used to ride as a bare `null`, forcing
      // every event consumer to null-guard. Stamp `unnamed:<mark>` — the digest-queue keyParts shape.
      runLog(run.runDir, { event: "screen-gate-violation", count: violations.length, uris: violations.map((v) => v.uri ?? `unnamed:${v.mark}`), action: "driver-refetch" });
      note(`screen-gate: ${violations.length} in-scope-live goods/field drop(s) not record_fetched — DRIVER code-fetch + re-decide (no hard-halt)`);
      const fetcher = opts.recordFetcher ?? defaultRecordFetcher;
      const fetchFailures = new Map();
      for (const v of violations) {
        if (!v.uri) continue;                                // an unnamed drop — the driver cannot fetch what nobody named; the re-digest below must name it
        try {
          const r = await fetcher(v.uri, { agentId: agent, sessionKey: `${runPrefix}screen-gate-refetch`, recordLog: runRecordLogPath(run.runDir) });
          if (!r?.ok) fetchFailures.set(v.uri, r?.cause ?? "record_fetch returned not-ok");
          gateFetched.set(v.uri, { ok: r?.ok === true, cause: r?.ok ? null : (r?.cause ?? "record_fetch returned not-ok") });
        } catch (e) { fetchFailures.set(v.uri, String(e?.message ?? e).slice(0, 120)); gateFetched.set(v.uri, { ok: false, cause: String(e?.message ?? e).slice(0, 120) }); }
      }
      // The re-decide text — shared verbatim between the legacy immediate re-digest (funnel OFF) and
      // the queued settlement-flush section (funnel ON).
      const redecideLines = [
        `RE-DECIDE EACH on its fetched goods: keep it as a conflict/finding if in-field; otherwise record the drop with a fetched-goods justification (never a name/owner-inferred guess).`,
        ...violations.map((v) => v.uri
          ? `- ${v.uri} (${v.mark})${fetchFailures.has(v.uri) ? " [record UNRETRIEVABLE — note it as an unverified drop]" : ""}`
          : `- (${v.mark}) [this drop row names NO record URI — name the record you dropped, one row per record, or restore the candidate]`),
        // ONE RECORD PER ROW: a shared rationale over several records is not a decision about any of them.
        `ONE ROW PER RECORD: if any row above covers several records, split it — each record gets its own row, its own fetched goods, and its own reason. A rationale shared across a batch is not a decision about any of its members.`,
      ];
      //: the driver code-fetch above is KEPT (and is what actually clears the gate — the
      // comment below); the re-decide re-digest exists only to re-justify drop rows on real goods,
      // so it queues for the settlement flush instead of firing its own opus pass. Keyed on the
      // violating URI set (a resume re-seeing the same rows no-ops). Deliberately NOT a tailed
      // "ONLY those rows corrected" wording — the flush ends with the standard FULL
      // re-emission contract (the falcon tripwire).
      mintDigestWork("screen-gate", violations.map((v) => v.uri ?? `unnamed:${v.mark}`), lines(
        `The driver has record_fetched the marks below — their REAL goods/services are in the run's record set.`,
        ...redecideLines,
      ));

      violations = enforcedViolations();
      if (violations.length) {
        // Irreducible: an in-scope-LIVE mark was dropped on goods and its official record could not be
        // retrieved (the code-fetch failed too) — so the drop cannot be examined. This reverses the
        // fail-loud arm that stood here ("it should just mark it as
        // unexamined — couldn't fetch or something. NOT failed"): an unexamined drop ships as a LOUD
        // unexamined disclosure — a per-mark coverage row on the report plus the coverage-honesty
        // floor's CONDITIONAL clamp — never a dead run. The fail was costing whole reports over
        // provider 404s the machinery can do nothing about; the
        // disclosure+clamp keeps the gate's real intent (nobody relies on that mark as clean) while the
        // report still ships. ctx feeds the floor in-process; the sidecar is the durable copy so a
        // crash between here and delivery cannot lose the disclosure (the floor re-reads it on resume).
        // — same three-way split as the post-flush writer. On THIS path the provider's cause was
        // already available in `fetchFailures`; what was missing is that the generic fallback fired
        // silently when the fetch had reported ok, which is a completely different defect and used to
        // read identically. 62 rows on R1 carried one string across six jurisdictions.
        ctx.screenGateUnresolved = violations.map((v) => {
          const cause = v.uri ? fetchFailures.get(v.uri) : null;
          if (cause) return { mark: v.mark, uri: v.uri, cause, cause_source: "provider" };
          return {
            mark: v.mark, uri: v.uri ?? null,
            cause: v.uri
              ? "the record_fetch reported success and the gate still cannot see this record — NOT a provider failure; look at the run's own record set before raising it with the vendor"
              : "drop row names no record URI — the dismissal cannot be examined or audited",
            cause_source: v.uri ? "driver-fetch-reported-ok" : "no-uri",
          };
        });
        atomicWrite(driverDir(run.runDir, "screen-gate-unresolved.json"),
          JSON.stringify({ ts: new Date().toISOString(), unresolved: ctx.screenGateUnresolved }, null, 2) + "\n");
        runLog(run.runDir, { event: "screen-gate-unresolved", count: violations.length, uris: violations.map((v) => v.uri),
          action: "disclose-clamp", failures: [...fetchFailures.entries()].map(([uri, cause]) => ({ uri, cause })) });
        note(`screen-gate: ${violations.length} in-scope-live mark(s) could not be record_fetched after the driver fetch — the run CONTINUES with each disclosed as unexamined (coverage row + CONDITIONAL clamp; owner decision 2026-07-22, never a dead run).`);
      } else {
        // Recovered — and a PRIOR pass's disclosure sidecar (a crash-resume where the record now
        // fetches or the re-decide landed) must go with it: a healed gap must not keep clamping.
        rmSync(driverDir(run.runDir, "screen-gate-unresolved.json"), { force: true });
        runLog(run.runDir, { event: "screen-gate-clean", recovered: true });
      }
    } else {
      rmSync(driverDir(run.runDir, "screen-gate-unresolved.json"), { force: true });   // same healed-gap cleanup as the recovered branch
      // — THE ZERO NAMES ITS OWN CAUSE. This branch fired on the CI red where screen-gate minted
      // no digest work: the gate found no violations, logged that it was clean, and said nothing about
      // WHY — so "the findings file was not there" and "the findings are fine" left identical records.
      // Nothing about the gate's behaviour changes here; the next occurrence just arrives diagnosed.
      const fPresent = existsSync(P.registerFindings);
      runLog(run.runDir, { event: "screen-gate-clean",
        ...screenGateZeroCause({ findingsPresent: fPresent,
          findingsContent: fPresent ? readFileSync(P.registerFindings, "utf8") : "", unnamedArmed }) });
    }
    recordScreenGateEvidence(ctx, { runPrefix, before: gateBefore, heldBeforeGate, heldAfterGate: fetchedUniverse(), gateFetched });
  }

  // ──: STANDALONE SETTLEMENT / LATE FLUSH ───────────────────────────────────────────────────
  // When the frame-reopen block fired nothing (clean diff, no blind model, receipt-skipped, disabled)
  // but the queue is non-empty, the settlement flush still runs HERE — the same seam, before synthesis.
  // Empty queue + no reopen ⇒ zero digest passes at this point.
  //
  // DIGEST-LOCKED (a resume past synthesis): escalation/envelope never ran (their digestLocked guards
  // stay exactly as today), so any pending item here is a POST-SYNTHESIS trigger — today that is the
  // screen-gate on a resumed run (whose legacy re-digest at the gate ALSO ran past synthesis), plus
  // anything a failed pre-synthesis flush left pending. Those get AT MOST ONE bounded LATE flush per
  // pass, at this same seam — deliberately BEFORE the back half's skip evaluation, so the
  // stage-freshness staleness recompute of skeptic/synthesis/cards happens once, in-pass, instead of
  // stale-blocking delivery into another park/resume cycle. Receipts still hold: a flushed item can
  // never re-fire on any later resume.
  if (!ctx.digestSettled) {
    const digestLockedFlush = existsSync(P.narrative) && !forceFromActive(ctx, "synthesis");
    // ── LATE EVIDENCE IS ASSESSED BEFORE THE READING STEP'S LAST PASS AND THE WRITER (owner's ruling, 2026-10-19) ──
    // A record the band gained after placement's pass (a unit's re-run, the code-side recheck) is placed or set aside
    // by placement itself, through its own stage, before the flush below hands the reading step the placements and
    // before the writer reads them. The form is a union, so every row placement accepted stands. Only ids placement
    // never read run it again: a band whose counts alone moved costs nothing. Every path that grows the band after
    // placement queues the reading step's re-run, so the flush below follows; one that did not is recorded.
    if (!digestLockedFlush) {
      const late = lateRecordIds(P);
      if (late.length) {
        runLog(run.runDir, { event: "late-evidence", records: late.length });
        note(`late evidence: ${late.length} record(s) reached the band after placement's pass — placement assesses them before the reading step's next pass and the writer`);
        // A PASS THAT FAILS, OR IS REFUSED BEFORE IT STARTS, DOES NOT END THE RUN HERE. A run is never held for a recovery
        // that could not run (the owner's ruling of 2026-10-19): placement's earlier account stands, and the floor and the
        // recall gate state what it leaves open. The stage can throw before it dispatches, as it does for a band past the
        // size ceiling, so the throw is caught and recorded as the failure it is.
        let pass;
        try { pass = recordPlacementPass(ctx, await stage("placement-inquiry", ctx, { force: true, trigger: "late-evidence" }), "late-evidence"); }
        catch (e) { pass = { ok: false, fail: String(e?.message ?? e) }; }
        if (!pass?.ok) {
          runLog(run.runDir, { event: "late-evidence-failed", records: late.length, fail: String(pass?.fail ?? "failed").slice(0, 200) });
          ctx.latePassFailed = { records: late.length, fail: String(pass?.fail ?? "failed").slice(0, 200) };   // the attempt, for the delivery record
          note(`late evidence: placement's pass did not complete (${String(pass?.fail ?? "").slice(0, 100)}) — its earlier account stands, and the floor and the recall gate state what it leaves open`);
        }
        if (!pendingItems(ctx.digestQueue).length) runLog(run.runDir, { event: "late-evidence-no-digest-work", records: late.length });
      }
    }
    if (!digestLockedFlush) await flushDigestQueue("pre-synthesis");
    else if (pendingItems(ctx.digestQueue).length) await flushDigestQueue("late");
    ctx.digestSettled = true;
  }

  // ── follow-up (2026-08-04): SETTLE THE ONE-SHOT FRAME STAMP ──────────────────────────────────
  // THE LAST SEAM AT WHICH THE BAND AND THE UNITS CAN STILL MOVE. Three arms between frame-diff's seam
  // and here rewrite artifacts it declares, and none of them could account for it: the escalation
  // recheck's deriveNamedBand re-merge (register-named-band.json), the skeptic escalation's forced
  // register-unit re-runs and the envelope close's forced register-unit re-runs (register-units/*.md).
  // re-aimed stageInputs["frame-diff"] at exactly those artifacts and re-aimed nothing else, so on
  // a RESUME that re-enters with frame-diff fresh and narrative.md absent — a recovery park or a
  // rate-limit postpone anywhere between the frame seam and synthesis — frame-diff SKIPPED (⇒ on the
  // delivery path via ctx.skippedStages), one of those arms moved its inputs, the delivery precondition
  // read it stale, and with no UPSTREAM_STALE_REPAIR entry the run PARKED. A fresh run never saw it:
  // frame-diff RUNS there, so it is never on the delivery path.
  //
  // Restamp rather than repair, because a re-diff cannot be the remedy: the stage is one-shot by
  // contract, and every consumer of its output ran before this line. The rewrites are also the SAFE
  // direction — the arms close coverage, so a diff taken over the earlier band can only over-report
  // omissions, never miss one.
  //
  // NOT gated on ctx.digestSettled: settling the stamp is idempotent and must happen on every pass that
  // reaches this seam, including one whose queue was already drained by an earlier pass.
  settleOneShotStamp(run.runDir, "frame-diff",
    [P.registerNamedBand, ...(axes ?? []).map((a) => P.registerUnit(a))], "pre-synthesis-register-arms");

  // ── crowd-context (2026-07-22): the counts a lawyer closes a crowd doubt with ─────────────────────
  // Runs at ONE seam — after the frame-reopen block (so the ledger read reflects any reopen re-digest)
  // and before synthesis (its only consumer). When the coverage ledger holds a MATERIAL slice the
  // funnel could not enumerate to has_more:false (the exact shape the COVERAGE JUDGMENT dictation
  // routes to sufficient:false), the driver gathers the affirmative crowded-field evidence a lawyer
  // closes that doubt with: per-term live counts, the same counts restricted to the in-scope classes,
  // and the exact/near-identical subset FULLY enumerated when it is small enough — the dangerous
  // category actually seen. The artifact is EVIDENCE to judgment, never a gate: no count decides
  // anything here, the digest/ledger/band are never touched (the queries round-trip a STANDALONE
  // plan/band pair under _driver/), and every failure is non-fatal by contract — log
  // `crowd-context-failed` and continue; an absent artifact leaves synthesis's material-slice ⇒
  // sufficient:false path exactly as it was. The executor is the SAME provider executePlan lane the
  // code-side saturation-probe and the fan-in repair kit dispatch through (planExec, resolved once
  // above the gather) — injected, so the module tests against a stub and no new provider surface exists.
  try {
    // crash-resume idempotency (mirrors stageOnce's skip): a prior pass's artifact is reused, never
    // re-bought — re-running would re-spend provider calls and churn synthesis's input fingerprint.
    if (existsSync(P.crowdContext)) {
      try {
        const prior = JSON.parse(readFileSync(P.crowdContext, "utf8"));
        ctx.crowdContext = { slices: (prior.slices ?? []).length };
        runLog(run.runDir, { event: "crowd-context", reused: true, slices: ctx.crowdContext.slices, output: outputMeta(P.crowdContext) });
      } catch { /* unreadable prior artifact — rebuild below */ }
    }
    if (!ctx.crowdContext && planExec && ctx.registerPlan) {
      // the planExec-lane adapter: entries → standalone plan file → provider executePlan → band blocks.
      // Own files under _driver/ (crowd-context-plan/-band.json) so the frozen register plan and the
      // axis bands are never written; blocks come back qid-stamped exactly like every executor band.
      const ccExecutor = async (entries) => {
        const ccPlanPath = driverDir(run.runDir, "crowd-context-plan.json");
        const ccBandPath = driverDir(run.runDir, "crowd-context-band.json");
        atomicWrite(ccPlanPath, JSON.stringify({
          schema_version: 1,
          purpose: "crowd-context evidence queries — driver-minted, standalone; never part of the frozen register plan",
          regions: ctx.registerPlan?.regions ?? [], entries,
        }, null, 2) + "\n");
        const r = await planExec({ planPath: ccPlanPath, axis: CROWD_CONTEXT_AXIS, outputPath: ccBandPath },
          { agentId: ctx.agent, sessionKey: `clearance-${run.slug}-${run.codename}-crowd-context`, recordLog: runRecordLogPath(run.runDir) });
        if (!r?.ok) throw new Error(String(r?.cause ?? "crowd-context plan execution failed").slice(0, 200));
        const blocks = JSON.parse(readFileSync(ccBandPath, "utf8"));
        return Array.isArray(blocks) ? blocks : [];
      };
      const cc = await buildCrowdContext({
        ledger: loadCoverageLedger(run.runDir).rows,   // fresh read — post-reopen/re-digest, same source as every gate
        planContext: { entries: ctx.registerPlan.entries ?? [], niceClasses: ctx.registerPlan.nice_classes ?? [], regions: ctx.registerPlan.regions ?? [] },
        executor: ccExecutor,
        capabilities: registerCapabilities(),   // the contains floor, read the way the plan compile reads it
        note: (m) => note(m),
        log: (row) => runLog(run.runDir, row),   // the orchestrator's own crowd-context-failed row lands in run.jsonl
      });
      if (cc) {
        atomicWrite(P.crowdContext, JSON.stringify(cc.json, null, 2) + "\n");
        atomicWrite(P.crowdContextMd, cc.md);
        ctx.crowdContext = { slices: cc.stats.slices };
        runLog(run.runDir, { event: "crowd-context", ...cc.stats, output: outputMeta(P.crowdContext) });
        note(`crowd-context: gathered ${cc.stats.terms} per-term count(s) over ${cc.stats.slices} material slice(s); ${cc.stats.enumerated_subsets} exact/near-identical subset(s) fully enumerated (${cc.stats.enumerated_records} record(s) seen)`);
        // PR-8 — re-derive the band shape now that crowd-context exists: its crowds[] rows carry the
        // crowd_context_slice join (compose with the artifact, never change it), and synthesis reads
        // the shape. The band itself is unchanged — this only re-projects it with the new evidence.
        try { deriveBandShape(ctx, JSON.parse(readFileSync(P.registerNamedBand, "utf8"))); }
        catch { /* no merged band on this path (legacy/register-gap) — the pre-existing shape stands */ }
      }
    }
  } catch (e) {
    // never-kill: absence of crowd context must never block or degrade a run — disclose and continue.
    note(`crowd-context failed (non-fatal — synthesis proceeds without it): ${String(e?.message ?? e).slice(0, 120)}`);
    runLog(run.runDir, { event: "crowd-context-failed", fail: String(e?.message ?? e).slice(0, 200) });
  }
}
