// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-failed.mjs — what a run does when a step fails: postpone, stop, park for recovery, or end, and the notice it sends.
//
// The clearance pipeline's failure path, moved out of pipelineInner's catch unchanged. Every path through it returns
// the run's result or throws, so pipelineInner returns what it returns. `helpers` are functions still held in
// pipeline.mjs, handed in because this module must not import that one back.
import { writePark } from "./run-park.mjs";
import { ensureDriverDir } from "../shared/driver-dir.mjs";
import { stopReason } from "../shared/stop-reason.mjs";
import { RunCancelled } from "./cancel.mjs";
import { recordRunConsumption } from "./consumption-ledger.mjs";
import { config } from "./driver.config.mjs";
import { note, runLog } from "./log.mjs";
import { writeOutboxPacket } from "./outbox.mjs";
import { axesNotYetDisclosed, clearPartsNotCompleted, readPartNotCompleted, slicesNotYetRecorded, unitsNotYetRecorded, writePartNotCompleted } from "./parts-not-completed.mjs";
import { rollupStatus, writeRunStatus } from "./progress.mjs";
import { abbrev } from "./repair-contract.mjs";
import { capParkSchedule, capWaitFrom, classificationSource, classifyFailureReason, countRecoveryLanes, countTrailingStageStrikes, decideRecovery, failureSignature, isCapPark, unnamedStructuredFailure, weatherCeilingFor } from "./repairs.mjs";
import { StageFailure, buildFailurePacket, terminalReasonFields } from "./run-outcome.mjs";
import { paths } from "./stages.mjs";
import { stampTokenRollup } from "./tokens.mjs";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function endTheFailedRun({ P, agent, ctx, e, job, run }, helpers) {
  const { isContentShapedFail, logTurnaroundReconciliation, recordConnotationAudit, sentinel, undoTaintRenames } = helpers;
  // RATE-LIMIT POSTPONE (re-throw): a 429 session-cap is NOT a terminal failure — RE-THROW it so pipeline()'s
  // outer catch parks the run resumable (.postponed, no .failed, no notify-fail) and the runner auto-resumes
  // after the cap window, vs stranding every completed stage and forcing a ~$40 cold re-run. This catch wraps
  // the ENTIRE stage sequence (try at the top of pipelineInner), so without this guard a rate-limited
  // StageFailure is swallowed HERE and the postpone path (pipeline() catch + postponeRun + runner
  // .resumePostponed) is unreachable — the exact bug behind the 2026-06-22 register-stage 429 hard-fails.
  if (e instanceof StageFailure && e.rateLimited) throw e;
  // — RECORD THE TWO NUMBERS ON THE WAY DOWN. A run that still goes terminal at the meaning
  // gate never reaches the merge seam, and its failure token carries only the BLOCKING count by
  // design. Recorded only where the gate passed, "dispositions that did not bind" would be missing
  // from precisely the runs that need explaining — and that count is what the boundary gets tuned
  // against. Reads whatever is on disk (merged pair, else each half's, else its preserved best
  // draft) and can never mask the failure it is describing.
  try { recordConnotationAudit(run, P); } catch { /* observability must never mask the failure */ }
  // ── STOPPED BY THE USER ──────────────────────────────────────────────────────────────────────
  // Terminal, and deliberately NOT routed through anything below. Two reasons:
  //
  //   1. decideRecovery would park it. A cancel carries no failure signature, so the class guess
  //      lands on "unknown", which buys one recovery park — the run would write `.postponed` and the
  //      runner would auto-resume it two minutes later and keep billing.
  //   2. The failure packet would tell them their search BROKE. buildFailurePacket's copy is
  //      "❌ Clearotron search for X FAILED at Y", pushed to the customer over the outbox. Someone who
  //      pressed Stop must never be told something went wrong; they already know what happened.
  //
  // Partial work is not deliverable, so nothing is published — but the spend up to this point is
  // real, which is why this leaves a row rather than vanishing: the consumption ledger records it with
  // the cancelled status, and the run list is refreshed, as for a Knockout. The ledger keeps one row per
  // run, so handling a stop twice counts it once, and neither write can turn the stop into a resume.
  if (e instanceof RunCancelled) {
    note(`[pipeline] STOPPED ${run.codename} at ${e.stage} by user request${e.requestedAt ? ` (asked ${e.requestedAt})` : ""} — terminal, nothing delivered`);
    try { sentinel(run.runDir, ".cancelled", { stage: e.stage, requestedAt: e.requestedAt, via: e.via }); } catch { /* best-effort */ }
    try { runLog(run.runDir, { event: "cancelled", stage: e.stage, requestedAt: e.requestedAt, via: e.via }); } catch { /* best-effort */ }
    try { recordRunConsumption(ctx, { phase: "cancelled", tokens: stampTokenRollup(run.runDir, "cancelled") }); } catch { /* best-effort — a stop still spent what it spent */ }
    logTurnaroundReconciliation(run.runDir, ctx?.quote, "cancelled");   // a stop still consumed wall
    writeRunStatus(ctx, { state: "cancelled", failedStage: e.stage,
      reason: stopReason({ stage: e.stage, via: e.via, requestedAt: e.requestedAt }) });
    try { rollupStatus(run.studioRoot); } catch { /* best-effort */ }
    // `failedStage` non-null satisfies the runner's backstop predicate, so it does not overwrite
    // this with a spurious "pre-run" failure notice.
    //
    // — `reason` USED TO STAY NULL HERE, on the ground that "there is no fault". That was true
    // and it was answering a different question: `state` already carries whether there was a fault,
    // and what `reason` owes is why the run ENDED. A stop has an answer to that, and it is the one
    // fact that tells this apart from a crash for anyone holding status.json alone — which is what
    // the portal and every metrics reader hold. Five of five cancelled runs on the test box read
    // `reason: null`, with the provenance sitting unreachable in the `.cancelled` sidecar beside them.
    return { ok: false, cancelled: true, failedStage: e.stage, codename: run?.codename ?? null, runDir: run.runDir };
  }
  // judgment-relocation (revised 2026-06-24): there is NO judgment-driven halt terminal. A run only stops
  // without delivering on a TECHNICAL failure (below) or pauses on a rate-limit (.postponed, above). A
  // material coverage gap the lawyer flagged ships as a CONDITIONAL (the deliver-conditional clamp earlier),
  // never a no-deliver halt — a lawyer always gets a report unless something technically broke.
  const reason = e instanceof StageFailure ? e.reason : String(e?.stack ?? e);
  // — the OPEN-SET payload, kept apart from the sentence all the way to the status file, so the
  // portal can render one and put the other behind a disclosure. Null on every failure that carries
  // none, and on every non-StageFailure throw.
  const reasonDetail = e instanceof StageFailure ? e.detail : null;
  const failedStage = e?.stage ?? "pipeline";
  // ── 2026-07-04 (senior lawyer, production doctrine): AUTOMATIC RUN-LEVEL RECOVERY ─────────────────
  // A business-critical report must converge to an honest delivery WITHOUT a human re-trigger. The
  // VENZY bake run proved the gap: the corrective re-synthesis exhausted its in-stage ladder on
  // model vocabulary misses and the run went TERMINAL — dead until someone noticed, even though a
  // fresh resume (new sampling, valid stages skipped) converges with high probability. So a
  // recoverable failure PARKS the run on the SAME self-contained .postponed machinery the
  // rate-limit path uses (runner's self-resume watcher re-invokes pipeline(); idempotency skips
  // every valid stage; ONLY the broken segment re-runs), with bounded attempts + escalating backoff.
  // Recovery can never ship garbage: every resume passes the same validators, reviewer and gates.
  //
  // ── repair-first phase 2 (2026-07-05, senior lawyer): recovery is CLASS-AWARE — parks are only bought
  // where a fresh re-sample is the plausible remedy. TRANSIENT keeps the full ladder; UNKNOWN gets
  // exactly one park (the VENZY doctrine above — one fresh sample often converges); DETERMINISTIC
  // and FACTUAL get none (their repairs already ran at the point of defect; a re-sample re-derives
  // the same failure). And the universal backstop: a failure whose SIGNATURE already parked once is
  // re-hitting the same wall — terminal immediately, whatever the class guess said. Open Country
  // (TMP8729, 2026-07-05) is the proof case: the identical 414-shaped fan-in failure was bought 3×
  // (~77 min) before a terminal with a WRONG "systemic cause" diagnosis. Non-recoverable by denylist
  // only: credential/config/job-shape failures, where a retry is provably futile.
  const NON_RECOVERABLE_RE = /credential|CORSEARCH_(USER|PASS|TOKEN)|missing register credential|invalid job|job file|profile\.json is corrupt/i;
  const recoveryMax = Math.max(0, Number(process.env.CLEAROTRON_RECOVERY_MAX ?? 3));
  const RECOVERY_BACKOFF_MIN = [2, 15, 60];   // attempt N resumes after BACKOFF[N-1] minutes (last repeats)
  const statusSnapshot = (() => { try { return JSON.parse(readFileSync(join(run.runDir, "status.json"), "utf8")) ?? {}; } catch { return {}; } })();
  const priorAttempts = Number(statusSnapshot.recoveryAttempts) || 0;
  const recoveryHistory = Array.isArray(statusSnapshot.recoveryHistory) ? statusSnapshot.recoveryHistory : [];
  // ── two park lanes (2026-07-29) ─────────────────────────────────────────────────────────────────
  // `recoveryAttempts` stays the TOTAL park count and keeps every meaning it already had (the repair
  // ledger's epoch, the taint-rerun session key, the ".tainted-N" forensic suffix, the failure
  // notice's "after N automatic recovery attempts"). What changed is which counter the run-level
  // CEILING is measured against: upstream weather draws on its own bounded lane so it can no longer
  // spend the budget reserved for the run's own recoverable defects. Both lane counts are read back
  // off the append-only park history, so there is one source of truth and nothing to drift.
  const laneCounts = countRecoveryLanes(recoveryHistory, { total: priorAttempts });
  const weatherCeiling = weatherCeilingFor(recoveryMax);
  // A4: sign on the throw site's stable reason CODES when it carries them (the client gate) — the
  // sorted unique code set, so prose drift between attempts can never re-arm a per-signature budget.
  const failSig = failureSignature(failedStage, reason, { codes: e instanceof StageFailure ? e.reasonCodes : undefined });
  let failClass = (e instanceof StageFailure && e.failClass) || classifyFailureReason(String(reason));
  // BUILD A (owner-ruled 2026-08-19) — NAME the source when the validator already named it.
  // Three sources, in precedence order, and the ordering is the whole design:
  //   throw-site       the stage stamped its own class. It counted the things; nothing outranks it.
  //   validator-token  the reason carries an ALLOWLISTED validator token (PROGRESS_TOKENS, via
  //                    progressQuantity). This is the case the issue was filed on: a structured
  //                    reason a validator emitted, landing on the catch-all with nothing recording
  //                    that it had. The classifier now says where the name came from.
  //   reason-text      neither — the generic regex read, which is a guess and is labelled as one.
  //
  // SCOPED TO `quantityToken`, NOT to `kindToken`, and that is deliberate. `kindToken` is any leading
  // `word:` prefix (`^([a-z][a-z0-9_]*)\s*:`), not a vocabulary — `invalid_file:<path>` is 71 of 76
  // recorded stage failures and no validator named it. Treating a prefix as a validator's name would
  // silence the detector on precisely the shape it was widened to catch, and it would do it by
  // relabelling rather than by understanding anything.
  //
  // CHANGES NO BUDGET, structurally rather than by care: `decideRecovery` takes no `classSource`
  // argument at all, so there is no branch for this to reach. The 2026-08-13 correction on the issue
  // withdrew the trend rule — R6's flat 74 → 74 was a stage about to succeed — and B stays unruled.
  let classSource = classificationSource({
    stamped: Boolean(e instanceof StageFailure && e.failClass), quantityToken: failSig.quantityToken });
  // ── A5 invalid-artifact strikes (2026-07-28 postmortem backstop) ────────────────────────────────────────────
  // A stage that keeps producing an INVALID output can loop forever: the idempotency skip can't fire
  // over an invalid artifact, so every resume re-runs it, and the reclaim/self-resume lanes keep the
  // resumes coming (the 2026-07-28 postmortem run: common-law-half:a re-failed validation on every resume while the
  // surface said "running 7/9"). Three TRAILING CONSECUTIVE content-shaped failures of ONE stage in
  // the append-only run.jsonl spine mean re-sampling has disproved itself — the failure is
  // deterministic in practice whatever the text guess says (parkBudget 0 ⇒ terminal WITH artifacts,
  // terminalKind "invalid-artifact-loop"). Content-shaped ONLY (isContentShapedFail: transient-classified
  // OR fallback-eligible failures break the streak): a flapping provider, a rate-limit postpone trail, or
  // a timeout streak never converts — waiting is a real remedy there. A throw-site FACTUAL
  // stamp outranks the strike relabel (it is already terminal, and its kind is the truer diagnosis).
  const INVALID_ARTIFACT_STRIKE_CAP = 3;
  let strikeTerminalKind = null;
  if (run?.runDir && failClass !== "factual") {
    try {
      const rows = readFileSync(paths(run.runDir).run, "utf8").trim().split("\n")
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const strikes = countTrailingStageStrikes(rows, failedStage, { isContentShaped: isContentShapedFail });
      if (strikes >= INVALID_ARTIFACT_STRIKE_CAP) {
        strikeTerminalKind = "invalid-artifact-loop";
        failClass = "deterministic";
        classSource = "invalid-artifact-strikes";
        runLog(run.runDir, { event: "invalid-artifact-strikes", stage: failedStage, strikes, cap: INVALID_ARTIFACT_STRIKE_CAP });
        note(`[pipeline] ${failedStage} has produced ${strikes} consecutive invalid/failed outputs — terminal (invalid-artifact-loop), artifacts kept for diagnosis`);
      }
    } catch { /* the strike backstop must never mask the original failure */ }
  }
  const attemptedRepairs = e instanceof StageFailure && e.repairs?.length ? e.repairs : undefined;
  // — the progress quantity, UN-TRUNCATED, reaching the break/park comparison. The throw site's
  // stamp wins (it counted the things); the allowlisted text read of the full reason is the fallback
  // for throw sites that only have prose. null = ABSENT, never zero. `quantitySource` names which,
  // exactly like `classSource` above — a number in a ledger is worth less than a number that says
  // where it came from. The comparison RECORDS this; no branch of it reads the value ( owns policy).
  const stampedQuantity = e instanceof StageFailure && Number.isFinite(e.quantity) ? e.quantity : null;
  const quantity = stampedQuantity ?? failSig.quantity;
  const quantitySource = quantity === null ? null : stampedQuantity !== null ? "throw-site" : "reason-text";
  const decision = decideRecovery({
    failClass, sig: failSig.sig, reason: String(reason), history: recoveryHistory, priorAttempts, recoveryMax,
    nonRecoverable: NON_RECOVERABLE_RE.test(String(reason)), hasRunDir: Boolean(run?.runDir),
    weatherAttempts: laneCounts.weather, defectAttempts: laneCounts.defect, weatherCeiling, quantity,
  });
  // The stamped kind: the strike relabel names the loop precisely; otherwise the decision's own kind.
  const terminalKind = decision.recoverable ? null : (strikeTerminalKind ?? decision.terminalKind);
  if (run?.runDir) {
    try {
      runLog(run.runDir, { event: "recovery-classified", sig: failSig.sig, class: failClass, stage: failedStage, classSource, priorAttempts, parkBudget: decision.parkBudget, lane: decision.lane, laneAttempts: decision.laneAttempts, laneCeiling: decision.laneCeiling, ...(terminalKind ? { terminalKind } : {}), ...(failSig.codes?.length ? { reasonCodes: failSig.codes } : {}), ...(attemptedRepairs ? { repairs: attemptedRepairs } : {}),
        //: what the comparison SAW — this failure's count, the last count for the same signature,
        // and the direction between them. "unknown" whenever either side is absent.
        quantity, quantitySource, progress: decision.progress,
        //: the NAME of the structured token in the reason, or null. It comes from failSig — i.e.
        // from progressQuantity over the reason text — regardless of which source won the VALUE above.
        // The run this issue was filed on logged quantitySource:"throw-site", so a token threaded only
        // through the stamp path would have been null on exactly that run.
        reasonToken: failSig.quantityToken });
    } catch { /* observability must never mask the failure */ }
    // — THE CLASSIFIER GAP, MADE INTO AN EVENT. The classifier returning "unknown" over a reason
    // a validator structured is a gap in classifyFailureReason, not an unknowable failure, and until
    // now it was legible only to somebody reading run.jsonl by hand. Emitted beside the classification
    // and NOT through the stderr-only note path, which is a family records as still live.
    // It changes nothing about the decision above: the class, the lane and the budget are already set.
    try {
      // — the KIND rides beside the quantity token, and either one makes the failure nameable.
      // Both keys are written unconditionally as value-or-null: "this failure had no kind" and "this
      // build does not record kinds" are different facts, and a key present only when it is populated
      // makes its absence a claim.
      if (unnamedStructuredFailure({ failClass, classSource, token: failSig.quantityToken, kind: failSig.kindToken })) {
        runLog(run.runDir, { event: "classifier-gap", stage: failedStage, sig: failSig.sig,
          token: failSig.quantityToken ?? null, kind: failSig.kindToken ?? null, quantity, class: failClass });
      }
    } catch { /* never mask the failure */ }
  }
  if (decision.recoverable) {
    const attempt = priorAttempts + 1;
    // The rung follows THIS SIGNATURE's own park count, not the run-global attempt: a repeated
    // transient (a provider outage that has not ended) must wait longer each time — 2 → 15 → 60 —
    // while an unrelated first-time defect later in the run still gets the short first rung rather
    // than inheriting an earlier defect's escalation.
    const rung = Math.min(decision.sigAttempts ?? (attempt - 1), RECOVERY_BACKOFF_MIN.length - 1);
    const backoffMin = RECOVERY_BACKOFF_MIN[rung];
    // A4 field split (2026-07-28 postmortem): a recovery park writes `recoveryResumesAt` and STOPS writing
    // `resetsAt` — resetsAt keeps its one documented meaning (the rate-limit cap-reset clock), so a
    // reader can no longer mistake a recovery backoff for a provider cap. Status also actively clears
    // any lingering resetsAt from an earlier rate-limit park on the same run.
    //
    // The lane split does NOT get its own clock field, and that is the honest choice. `resetsAt`
    // means one thing — a provider TOLD us when its cap window reopens — and a weather park has no
    // such promise: nobody said when the overload ends, the 2/15/60 ladder is our own guess, which
    // is precisely what `recoveryResumesAt` means. So a weather park writes `recoveryResumesAt` like
    // any other recovery park, still leaves `resetsAt` null, and the record says WHICH lane bought
    // the wait in `recoveryLane` instead of implying a provider clock that does not exist.
    // A CAP PARK IS NOT A STAGE FAILING, and the 2/15/60 ladder cannot survive one.
    // A cap that classifies `rate_limited` already takes the postpone path and waits for its stated
    // reset. One that does NOT lands here, where two things used to go wrong: the provider's own reset
    // hint was dropped even though StageFailure carries it all the way to this site, and the ladder
    // topped out at 60 minutes, so six probes covered ~3 hours and a daily cap outlived every one of
    // them. Cap parks now ride their own ladder (15/30/60/120/240) and a STATED reset time beats it.
    const capResetHint = (e instanceof StageFailure && e.resetsAt) || null;
    const capPark = isCapPark(reason, capResetHint);
    const capSchedule = capPark
      ? capParkSchedule({ resetsAt: capResetHint, attempts: decision.sigAttempts ?? (attempt - 1) })
      : null;
    const recoveryResumesAt = capSchedule
      ? capSchedule.resumesAt
      : new Date(Date.now() + backoffMin * 60000).toISOString();
    // What the wait was bought on: "provider" = its own clock said so, "ladder" = our guess. Same
    // honesty rule the adapters apply to resetsAtBasis — a reader must be able to tell a stated fact
    // from an inference, or the record quietly upgrades one into the other.
    const recoveryWaitBasis = capSchedule ? capSchedule.basis : "ladder";
    const recoveryWaitMin = capSchedule ? capSchedule.waitMin : backoffMin;
    const lane = decision.lane;
    const laneAttempt = (decision.laneAttempts ?? 0) + 1;
    const laneLabel = lane === "weather" ? "upstream weather" : "defect";
    // Both counters, always both, whichever lane was charged — a reader must be able to see that the
    // defect budget is intact while weather is being spent (that is the whole point of the split).
    const recoveryLanes = {
      weather: { attempts: laneCounts.weather + (lane === "weather" ? 1 : 0), ceiling: weatherCeiling },
      defect: { attempts: laneCounts.defect + (lane === "defect" ? 1 : 0), ceiling: recoveryMax },
    };
    note(`[pipeline] RECOVERABLE failure in ${run.codename} at ${failedStage} — parking for AUTO-RECOVERY, ${laneLabel} lane ${laneAttempt}/${decision.laneCeiling} (defect budget ${recoveryLanes.defect.attempts}/${recoveryMax} spent; resumes ~${recoveryWaitMin}min${capSchedule ? ` on the ${recoveryWaitBasis === "provider" ? "provider's stated reset" : "cap ladder"}` : ""}; valid stages skip on resume): ${String(reason).slice(0, 160)}`);
    // no fromStage: the failed-stage label can be decorated ("synthesis(blocking)") and is not a
    // resume key — plain idempotent resume re-runs exactly the invalid/missing outputs.
    try { writePark(run.runDir, { kind: "recovery", recoveryResumesAt, postponedAt: new Date().toISOString(), codename: run.codename, job, agent, attempt, reason: String(reason).slice(0, 300), sig: failSig.sig, class: failClass, lane }, { job, agent, codename: run.codename }); } catch { /* best-effort */ }
    // recoveryHistory is the repeat-signature memory AND the lane ledger: append-only, one row per
    // park, read back on the next failure so an identical defect is never bought twice and so each
    // lane's spend is recomputed from the record rather than from a second counter that could drift
    // (writeRunStatus shallow-merges, so the full array is passed each time).
    // — a PARKED run is the one a reader diagnoses from status.json alone, and this cut at 200
    // and said nothing. `recovering` is not terminal, so it was never covered by the terminal
    // fields; the reader's problem is identical either way — a sentence that stops mid-thought with
    // no key admitting it stopped. Same three fields, same function, so the two cannot drift.
    writeRunStatus(ctx, { state: "recovering", recoveryAttempts: attempt, recoveryMax, failedStage,
      ...terminalReasonFields(reason),
      recoveryResumesAt, resetsAt: null,
      recoveryLane: lane, recoveryLanes,
      //: the row carries the park's progress QUANTITY, so the next failure's comparison can see
      // 9 → 6 (converging) where the signature alone shows only "the same defect again". Written
      // unconditionally as number|null — a row that says null means "this failure had no count", which
      // is a different fact from a pre-change row that has no such key at all.
      //
      //: `quantityToken` and `classSource` ride beside it, written unconditionally as value|null
      // for the same reason. This row is the ONLY one of the three records here that repair-digest.mjs
      // reads — runLog writes run.jsonl, which that module never opens — so without these two fields
      // the classifier gap would be recorded and still unreportable, which is this issue's own defect
      // committed inside its own fix. `classSource` rides too rather than a pre-computed verdict, so
      // the digest applies the SAME exported predicate the pipeline applies instead of guessing from
      // half the inputs. It also makes the epoch legible: a row with no `classSource` KEY predates
      // this field and was never measured, which is a different fact from a row that says "no gap".
      recoveryHistory: [...recoveryHistory, { sig: failSig.sig, stage: failedStage, class: failClass, lane, attempt, quantity, quantityToken: failSig.quantityToken ?? null, kindToken: failSig.kindToken ?? null, classSource, ts: new Date().toISOString(),
      // THE SAME FACTS THE RUN LOG ALREADY GETS, in the record that SURVIVES.
      // The auto-recovery-parked event below carries capPark/basis/waitMin and says in its own note
      // that a cap has to be legible or nobody can tell a stated reset from our ladder's guess. But
      // run.jsonl is not what the terminal reads: status.json's recoveryHistory is the only record
      // that survives a park/resume, so the cap died with the run log and the failure notice could
      // only ever say 'a provider was overloaded'. Spread the same way, ABSENT on a non-cap park
      // rather than false, for the reason stated below: a row that says nothing is honest about not
      // having looked; `capPark: false` claims we checked.
      ...(capSchedule ? { capPark: true, recoveryWaitBasis, recoveryWaitMin } : {}) }] });
    rollupStatus(run.studioRoot);
    runLog(run.runDir, { event: "auto-recovery-parked", stage: failedStage, attempt, of: recoveryMax, lane, laneAttempt, laneOf: decision.laneCeiling, recoveryResumesAt, reason: String(reason).slice(0, 200), sig: failSig.sig, class: failClass,
      // a cap park has to be legible in the record, or the next reader diagnosing
      // "why did this wait 21 hours" cannot tell a provider's stated reset from our own ladder guess.
      // Absent on a non-cap park rather than false: a row that says nothing is honest about not having
      // looked, while `capPark: false` would read as "we checked and it was not one".
      ...(capSchedule ? { capPark: true, recoveryWaitBasis, recoveryWaitMin, capResetHint: capResetHint ?? null } : {}) });
    logTurnaroundReconciliation(run.runDir, ctx?.quote, "recovery-parked");
    recordRunConsumption(ctx, { phase: "recovery-park", tokens: stampTokenRollup(run.runDir, "recovery-park") });
    // the return's `resetsAt` is the runner's due-clock contract (parkPostponed meta / postponedDueAt),
    // not a status surface — it stays under the machinery name deliberately.
    return { ok: false, postponed: true, recovery: true, attempt, resetsAt: recoveryResumesAt, codename: run.codename, runDir: run.runDir };
  }
  // ── A COVERED PART WHOSE RECOVERY IS SPENT IS DELIVERED WITHOUT, NOT ENDED ON ────────────────────────
  //
  // A failure the throw site named as a covered part (`notCompletedPart`, parts-not-completed.mjs) reaches here once
  // the decision above has nothing left to buy: every recovery lane spent, a repeated signature, or a deterministic
  // refusal such as a band too large to dispatch. The run holds everything but that part, so it is not ended with the
  // stop notice: the part is recorded as not completed, and the run parks for an immediate resume. The resumed pass
  // reaches the part, finds the record, and delivers without it, with the gap stated.
  //
  // ONCE PER PART: a part whose record already exists is not routed again, so a failure on the pass that delivers
  // without it ends the run below, as every failure did. Written before `.failed` and before the failure packet, so
  // a run that delivers carries neither. A rate limit and a stop never reach this line (both are handled above), and
  // a storage failure is not a covered part: no throw site names one.
  const coveredPart = e instanceof StageFailure ? (e.notCompletedPart ?? null) : null;
  const heldRecord = coveredPart && run?.runDir ? readPartNotCompleted(run.runDir, coveredPart) : null;
  // THE SEARCHES' RECORD GROWS: a failure is routed again while it names a slice the record does not hold yet.
  const addedSlices = coveredPart === "searches" ? slicesNotYetRecorded(heldRecord, e.excludedSlices) : [];
  const addedAxes = coveredPart === "searches" ? axesNotYetDisclosed(heldRecord, e.taintedAxes) : [];
  const addedUnits = coveredPart === "searches" ? unitsNotYetRecorded(heldRecord, e.unfinishedUnits) : [];
  if (coveredPart && run?.runDir && (coveredPart === "searches" ? addedSlices.length + addedAxes.length + addedUnits.length > 0 : !heldRecord)) {
    let parked = null;
    try {
      // A TIMED-OUT AXIS IS READ AS THE LAST PASS LEFT IT: the park renamed its unit, band and digest so a resume would
      // run it again, and with its recovery spent nothing will, so they are put back.
      if (addedAxes.length) undoTaintRenames(e.undoRenames);
      writePartNotCompleted(run.runDir, coveredPart, { stage: failedStage, reason: String(reason), sig: failSig.sig, terminalKind,
        ...(coveredPart === "searches" ? { slices: [...(Array.isArray(heldRecord?.slices) ? heldRecord.slices : []), ...addedSlices],
          disclosedAxes: [...(Array.isArray(heldRecord?.disclosed_axes) ? heldRecord.disclosed_axes : []), ...addedAxes],
          unfinishedUnits: [...(Array.isArray(heldRecord?.unfinished_units) ? heldRecord.unfinished_units : []), ...addedUnits] } : {}) });
      const resumesAt = new Date().toISOString();
      // The payload the runner's self-resume needs (job, agent, codename), and the recovery kind, whose stated
      // clock it keeps exactly: now. No recovery attempt is counted, because nothing is being retried.
      writePark(run.runDir, { kind: "recovery", recoveryResumesAt: resumesAt, postponedAt: resumesAt,
        codename: run.codename, job, agent, attempt: priorAttempts, reason: String(reason).slice(0, 300), sig: failSig.sig,
        class: failClass, notCompleted: coveredPart }, { job, agent, codename: run.codename });
      // The cause's payload rides beside the sentence, as on the stop it replaces, so the record still points at it.
      writeRunStatus(ctx, { state: "recovering", failedStage, ...terminalReasonFields(reason), recoveryResumesAt: resumesAt, resetsAt: null,
        reasonDetail: reasonDetail ? abbrev(String(reasonDetail).replace(/\s+/g, " ").trim(), 600) : null });
      rollupStatus(run.studioRoot);
      runLog(run.runDir, { event: "part-not-completed", part: coveredPart, stage: failedStage, sig: failSig.sig, class: failClass,
        terminalKind: terminalKind ?? null, resumesAt });
      logTurnaroundReconciliation(run.runDir, ctx?.quote, "recovery-parked");
      recordRunConsumption(ctx, { phase: "recovery-park", tokens: stampTokenRollup(run.runDir, "recovery-park") });
      note(`[pipeline] ${failedStage} could not be completed once its recovery was spent — recorded as the ${coveredPart} not completed; the run resumes now and delivers what it holds`);
      parked = { ok: false, postponed: true, recovery: true, attempt: priorAttempts, resetsAt: resumesAt, codename: run.codename, runDir: run.runDir };
    } catch (rErr) {
      note(`[pipeline] the ${coveredPart} could not be recorded as not completed (${String(rErr?.message ?? rErr).slice(0, 120)}) — the run ends with the stop notice`);
    }
    if (parked) return parked;
  }
  // A RUN THAT ENDS WITH THE STOP NOTICE CARRIES NO RECORD OF A PART NOT COMPLETED: nothing was delivered without it,
  // and a later resume should try the part again.
  if (run?.runDir) clearPartsNotCompleted(run.runDir);
  // Both lane ceilings end the run, and both say so. "weather-exhausted" is the honest terminal for
  // a provider that was still refusing after the whole weather ladder — the run did not break, the
  // far end never came back, and the notice must not read as a defect in the run's own output.
  if ((decision.terminalKind === "exhausted" || decision.terminalKind === "weather-exhausted") && recoveryMax > 0) {
    runLog(run.runDir, { event: "auto-recovery-exhausted", attempts: priorAttempts, of: recoveryMax, lane: decision.lane, laneAttempts: decision.laneAttempts, laneOf: decision.laneCeiling });
  }
  sentinel(run.runDir, ".failed", { stage: failedStage, reason, recoveryAttempts: priorAttempts, sig: failSig.sig, class: failClass, terminalKind });
  runLog(run.runDir, { event: "failed", stage: failedStage, reason, sig: failSig.sig, class: failClass, terminalKind });
  logTurnaroundReconciliation(run.runDir, ctx?.quote, "failed");   // a run that never delivered still burned wall
  // Record the failure in status FIRST (so the on-demand STATUS.md surfaces it even if the ping can't fire —
  // e.g. a gateway-wide outage where the agent send itself would also fail). reason is truncated for the ping.
  // terminalKind (A5): "failed with artifacts" is not a new enum — it is `failed` + the stamped kind
  // (invalid-artifact-loop | reclaim-exhausted | exhausted | …), so every status reader can say WHY the
  // run ended without parsing sentinels.
  const { reason: shortReason, reasonTruncated, reasonFull } = terminalReasonFields(reason);
  // — THE TAXONOMY'S NAMED SOURCE MUST CONTAIN THE CAUSE.
  //
  // `reason` is capped at 200 because it rides the ping. On the 2026-08-12 round that cap fell exactly
  // where the provider's verbatim error begins: status.json read
  //   "…1 dictated qid(s) own no band block: incumbent-class:owner:… ← provider error on the count
  //    probe (after one in-tool retry): "
  // — ending on the colon, with nothing after it. The journal had
  // `HTTP 400: APPLICANT_NAME - The system did not recognize the syntax`, but the failure taxonomy
  // sends a diagnosing agent to status.json, and for this failure it was the one place the answer was
  // not. It produced a wrong finding in the round itself: the cause was read as ABSENT, and an absent
  // error string was then reasoned about as if it were the defect.
  //
  // `reasonDetail` could not cover it. That field carries `StageFailure.detail`, and the fan-in throw
  // passes none — so for the failure that exposed this, the only carrier was the truncated `reason`.
  // Widening the 200 cap was the rejected alternative: it is load-bearing for the ping, and the next
  // message longer than whatever new number is chosen would reopen this silently.
  //
  // So the cut is made VISIBLE and the tail is kept beside it. `reasonTruncated` is written on every
  // terminal failure, true or false, because "no reasonFull key" and "nothing was cut" have to be
  // distinguishable — an absence must read as an absence, never as an empty cause.
  // — `reasonDetail` rides beside `reason`, never inside it. abbrev, not a bare slice: a cut that
  // reads as a word is worse than one that reads as a cut, and this one is read by an engineer
  // chasing a defect.
  // — one spelling of the payload for BOTH sinks. status.json already carried `reasonDetail`;
  // `_driver/failure.json` carried neither it nor the count, and `reasonQuantity` reached
  // no file at all — so the operator read "dropped 1 dictated connotation query" and had to replay the
  // gate against the preserved artifacts to learn which one. Derived once here and passed to both
  // writers, so the notice and the status file can never disagree about the payload.
  const reasonDetailField = reasonDetail ? abbrev(String(reasonDetail).replace(/\s+/g, " ").trim(), 600) : null;
  writeRunStatus(ctx, { state: "failed", failedStage, reason: shortReason, terminalKind,
    reasonTruncated, reasonFull,
    // number|null, written on every terminal failure like reasonTruncated: null means THIS failure
    // carries no count, which is a different fact from a status file with no such key. Never 0.
    reasonDetail: reasonDetailField, reasonQuantity: quantity });
  // A terminal failure spent everything up to the break — and carries the run's worst retry waste.
  // Stamped AFTER the state write so a status reader never sees tokens without knowing the run failed.
  recordRunConsumption(ctx, { phase: "failed", tokens: stampTokenRollup(run.runDir, "failed") });
  rollupStatus(run.studioRoot);
  // Best-effort failure notice — must NEVER throw or mask the original failure. The failure event
  // rides the outbox like every other event (the engine has no message tool; a chat-ping stage on it
  // would burn a turn and fail) — the never-silent guarantee, headless form (docs/DELIVERY.md
  // run-failed packet; the level-triggered *.pending watch keeps it alive until ack_event).
  // failPingSent records which lane WROTE the packet. It no longer decides whether the notice is
  // owed: a failure arms sendPending either way (below), because mark_sent is the only clear and it
  // settles a failure.json on the same evidence a delivery needs. ONE SEND PATH, ruled 2026-09-12.
  let failPingSent = false;
  {
    try {
      const runId = `${run.slug}-${run.date}-${run.codename}`;   // ONE canonical runId form (charter P1 §3) — matches status.runId
      const mark = job.markName ?? job.name ?? job.ref ?? "the matter";
      // The packet carries the FULL code-authored notice (terminal-kind sentence, verbatim
      // machine reason, attempted repairs, burned recovery attempts) — the courier relays it verbatim,
      // so the requester reads the honest diagnosis, not a thin one-liner. `text` stays as the short
      // WhatsApp-sized fallback for legacy relays.
      const rich = buildFailurePacket({
        runId, agent, job, failedStage, shortReason,
        reasonVerbatim: String(reason).slice(0, 1000), sig: failSig.sig, failClass,
        terminalKind: terminalKind ?? null, repairs: attemptedRepairs ?? [],
        priorAttempts,
        // Read off the park history rather than recomputed: the history is what survived the parks.
        capWait: capWaitFrom(Array.isArray(statusSnapshot?.recoveryHistory) ? statusSnapshot.recoveryHistory : []),
        reasonDetail: reasonDetailField, reasonQuantity: quantity,   // — the payload reaches the notice
      });
      const packet = {
        kind: "run-failed", ...rich,
        markName: job.markName ?? job.name ?? null, reason: shortReason,
        text: rich.whatsappText,
        // machine fields (repair-digest's primary source — the.failed sentinel stays the fallback)
        failureSignature: failSig.sig, recoveryAttempts: priorAttempts,
      };
      ensureDriverDir(run.runDir);
      writeFileSync(paths(run.runDir).failure, JSON.stringify(packet, null, 2) + "\n");
      failPingSent = Boolean(writeOutboxPacket(`${runId}.failed`, packet));
    } catch (evErr) {
      note(`failure event packet threw (swallowed): ${evErr?.message ?? evErr}`);
    }
  }
  // T5 (J5) — the failure NOTICE rides the SAME guaranteed lane as success delivery: a
  // CODE-authored packet (_driver/failure.json) + sendPending + the outbox wake marker, consumed by
  // the completion-watch → clearotron-deliver skill exactly like a delivery packet. This makes the
  // notice failure-independent: no WhatsApp binding, a handoff-mode engine, or a dead ping stage can
  // no longer silence it ( F9: teal-keystone died silently on exactly that). Best-effort —
  // packet-write trouble must never mask the original failure; the .failed sentinel + status.json
  // remain the durable record either way.
  //
  // OWED EITHER WAY, AND EXACTLY ONE MARKER. A failed run used to read sendPending:false whenever the
  // packet write SUCCEEDED, so the owed-run scan could not see it and the notice waited on a reader of
  // the outbox instead. Now the flag is armed on both lanes. What is NOT duplicated is the marker: the
  // primary lane's packet IS one, because writeOutboxPacket("<runId>.failed") lands
  // `<runId>.failed.pending` and the *.pending watch already matches it. Arming a second
  // `<runId>.pending` beside it would leave a file mark_sent does not clear — it clears `<id>.pending`
  // for each id the run was known by, not this suffixed form — and the sweep re-arms off whatever is
  // on disk, which is how a permanent SEND PENDING was born. So: the flag always, the packet and the
  // marker only when nothing wrote them.
  // THE RECORD OF AN OBLIGATION MUST NOT BE CONTINGENT ON THE ACTION IT OBLIGES. The flag says
  // somebody is owed a notice. Setting it downstream of the attempt to deliver that notice means it is
  // only set when the delivery path already worked — the case that needed it least. This block did
  // exactly that for one revision: `writeOutboxPacket` swallows its own failure and returns null, so
  // an unwritable outbox fell to the branch below, where the RAW marker write threw and took the flag
  // with it. The run then ended failed and NOT owed, in the one condition where the flag is the only
  // thing that could still record the obligation. Order, therefore: supersede the old send's guards,
  // arm the flag, and only then attempt the writes that can fail.
  try { rmSync(join(run.runDir, ".sent")); } catch { /* none */ }
  try { rmSync(paths(run.runDir).sendReceipts, { force: true }); } catch { /* none */ }
  // A fresh notice supersedes an older send's .sent marker AND its per-channel receipts (a resumed run
  // that fails again must still notify on every channel, not be skip-guarded by the earlier send's).
  // Both are best-effort removals above, so neither can keep the flag below from being written.
  try { writeRunStatus(ctx, { sendPending: true }); } catch (sErr) {
    note(`failure notice could NOT be recorded as owed (${String(sErr?.message ?? sErr).slice(0, 100)}) — the run directory is unwritable, so nothing here can say a notice is outstanding`);
  }
  try {
    if (!failPingSent) {
      const packet = buildFailurePacket({
        runId: `${run.slug}-${run.date}-${run.codename}`, agent, job, failedStage, shortReason,   // canonical runId form (charter P1 §3)
        reasonVerbatim: String(reason).slice(0, 1000), sig: failSig.sig, failClass, terminalKind,
        repairs: attemptedRepairs ?? [], priorAttempts,
        reasonDetail: reasonDetailField, reasonQuantity: quantity,   // — the BACKSTOP notice carries it too
      });
      writeFileSync(paths(run.runDir).failure, JSON.stringify(packet, null, 2) + "\n");
      mkdirSync(config.outboxDir, { recursive: true });
      writeFileSync(join(config.outboxDir, `${packet.runId}.pending`), `${agent}\n`);
    }
    note(`failure notice OWED (${failPingSent ? "event lane wrote the packet" : "handoff wrote the packet"}) — mark_sent is the only clear`);
  } catch (nfErr) {
    // NOT "status.json remains the record" — that sentence was here and it was false on exactly the
    // path that reaches this catch, because the flag was written after the throw. It is written before
    // it now, so the record genuinely does stand, and saying which part failed is what keeps the next
    // reader looking in the right place.
    note(`failure notice is owed but its packet/marker could not be written (${String(nfErr?.message ?? nfErr).slice(0, 100)}) — status.json carries the obligation; the outbox does not`);
  }
  note(`=== FAILED ${run.codename} at ${failedStage}: ${reason} ===\n`);
  // `codename` matches the three sibling terminals (postpone, recovery park, cancelled). Without it
  // the CLI could not name the run to resume at the one terminal where resuming is the whole remedy.
  //
  // `terminalKind`: the RETURN is a sink. runner.mjs's queue terminal stringifies this object
  // whole into `<base>.failed.result`, and that file is what scripts/e2e.mjs reads when the run dir
  // cannot be reached — `terminalKind: st?.terminalKind ?? result?.terminalKind ?? null`. The second
  // half of that expression could never fire, on either lane, because neither terminal returned the
  // field it had already computed. It costs one word to stop computing a diagnostic and dropping it.
  return { ok: false, failedStage, reason, terminalKind, codename: run.codename, runDir: run.runDir };
}
