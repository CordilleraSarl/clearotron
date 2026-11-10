// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// next-rung.mjs — what the stage ladder does after a failed attempt.
//
// The stage ladder (gateway.mjs runStageLadder) asks this once an attempt has failed, been rescued or not
// (rescue.mjs) and been named (turn-failure.mjs). The answer is one of four: "retry" goes on to the next attempt,
// "break" stops the ladder and lets the stage fail on what it has, "identical" stops it because the failure
// repeated byte for byte, and "rate-limited" returns at once so the run can be postponed. It also returns the
// ladder state the decision moves: the escalation point, the refunded rungs, the timeout retry and its budget.

import { runLog, note } from "../log.mjs";
import { everyToolCallRefused } from "../engine/tool-refusal.mjs";

// #5b — stop a WARM attempt after ONE try when it ran to the HARD WALL. The warm patch is the one rung that resumes
// a session: it is passed the session that just produced a content failure. If that resumed turn was SIGKILLed at
// the full timeout+60 wall (signals.hardWall, NOT a 0-token stall), break and let the caller record the
// coverage-limited deferral. A warm attempt can itself time out; warmEligible() only stops the attempt AFTER a
// timeout from being warm. A FOLLOWUP IS NOT STOPPED HERE. It is a new stage() call, attempt 1, with no resumeRef,
// so it is a fresh session with its own wall. This rule used to stop it too, on the premise that it resumed an
// already-loaded session, and that premise was false; it now gets the one extended retry any fresh dispatch gets.
// Measured 2026-11-05 over saved runs: no follow-up attempt and no warm attempt had timed out, so neither form of
// the rule had decided a run. A STALL (no hardWall) is NOT stopped here: it keeps its one retry at the same budget,
// since a transient stall can clear. PURE + exported for test: the live path needs a wall-clock kill.
export function warmHardWallStop({ fail, warm, signals }) {
  return fail === "timeout" && Boolean(warm) && Boolean(signals?.hardWall);
}

// criterion 1 — A WARM TURN THAT NEVER REACHED THE MODEL DOES NOT COST A RUNG, ONCE.
//
// Measured before this existed: a warm turn returning `usage: null` and `runId: null` — the
// startup-death shape, exit 1 under a second, zero tokens — still advanced the ladder. A stage with
// three attempts spent one on a turn that did nothing, which is the defect this issue names: "a
// warm-patch attempt either reaches the model or does not consume a ladder rung."
//
// THE BOUND IS THE WHOLE DESIGN. Refunding unconditionally lets a warm turn that never lands loop
// until the wall. ONE free rung per ladder is the concession; a second zero-usage warm turn in the
// same ladder is charged, and the record says so rather than leaving the difference to be inferred.
//
// PROVISIONAL, and deliberately one line to change: the number below is a routed parameter (2026-08-22),
// not a measured optimum. Nobody has yet counted how often a second free rung would have
// converted, and until someone does, 1 is the smallest concession that closes the defect.
//
// THE CHARGING BRANCH CANNOT FIRE TODAY, and that is stated rather than left to be discovered. `warm`
// requires `!warmUsed` and `warmUsed` is set the moment one fires, so a ladder gets AT MOST ONE warm
// turn — there can be no second zero-usage warm turn to charge. This counter is therefore defence, not
// arithmetic anyone reaches: it keeps the bound LOCAL and explicit, so that if the one-warm-per-ladder
// invariant is ever relaxed, the refund does not silently become unbounded along with it. Deriving the
// bound from `warmUsed` instead would have coupled a rung policy to an unrelated rule and hidden the
// dependency. The arms pin the invariant as the premise rather than pretending to exercise the branch.
const WARM_ZERO_USAGE_FREE_RUNGS = 1;


export function nextRung({ fail, warm, attempt, maxRetries, attemptFails, usage, json, turn, signals, runDir, name, timeoutSec,
  saidBackOpen, warmEscalatedAt, rungsRefunded, timeoutRetriesUsed, effTimeout }) {
  const out = (rung) => ({ rung, warmEscalatedAt, rungsRefunded, timeoutRetriesUsed, effTimeout });
  // A4 (addendum 2026-07-30): a byte-identical CONTENT failure signature on consecutive attempts is a
  // proven-deterministic defect — the previous attempt already carried this exact validator string and
  // the corrective/warm re-dispatch reproduced it byte-for-byte, so another paid turn cannot converge
  // (VENZY/E2E-R2: 63% of the run was correction, much of it re-buying identical failures). Stop NOW
  // and park honestly: the run-level recovery ladder (classifyFailureReason → one "unknown" park →
  // repeat-signature terminal) owns what happens next, with proper accounting — that lane's single
  // fresh sample replaces the blind third attempt this used to buy. Scoped to the content classes
  // (missing_file / invalid_file / max_tokens_no_output — same stage, same validator string); every
  // transport class keeps its own policy (timeout's single extended shot, and the
  // wedge/overload breaks above and below).
  //
  // BUILD 2 — A4's PREMISE FAILS ON EXACTLY ONE ATTEMPT, AND IT IS THE ONE IT USUALLY FIRES ON.
  // "Another paid turn cannot converge" assumes the two consecutive attempts are independent samples.
  // A warm patch is not a sample: it RESUMES the session that produced the previous failure (key =
  // lastKey, resumeRef = lastSessionRef), so a session that wrote a document with zero rulings writes
  // it again. It has no capacity to disagree with itself, and its repeat proves nothing about whether
  // a fresh dispatch would converge.
  //
  // The 2026-08-07 round measured both sides of this on the meaning-sweep stage. Where it cost a run:
  // fresh ruled 0 of 72 → warm ruled 0 of 72, byte-identical, the artifact never rewritten → A4 broke
  // the ladder at 2 of 3 with attempt 3's budget unspent → RECOVERABLE park, ~90s, one of three defect
  // lanes → the recovery lane then re-dispatched FRESH and ruled 69 of 72. Two dispatches and a park to
  // reach the attempt the ladder still had in hand. The control is the run whose warm attempt MOVED
  // (78 unruled → 1): the string changed, A4 never fired, and cold attempt 3 cleared it in the ladder.
  //
  // So: discard the SESSION, not the ladder. Fall through to attempt N+1, which is necessarily FRESH
  // (`warmUsed` is already spent, so `warm` cannot be true again) and carries the full corrective
  // message. Three existing bounds keep this finite and none of them is new or relaxed here:
  //   1. `warmUsed` caps warm at ONE attempt per stage run, and `warm` is this escalation's trigger —
  //      so the escalation can fire at most once per ladder, structurally. It is never reset below.
  //   2. `while (attempt < maxRetries + 1)` is untouched: the ceiling stays 3 attempts in production.
  //   3. The guard below only escalates when a further attempt already exists. With no budget left the
  //      break happens exactly as it does today, terminal signal intact.
  // Worst case: fresh(X) → warm(X, escalate) → fresh(X) → A4 fires normally (attempt 3 is not warm) →
  // terminal at 3 attempts.
  //
  // The escalated dispatch does NOT re-buy the paid sweep: perplexity-server short-circuits on a
  // complete recorded ledger ("the sweep is a fact of this run, not of this attempt"), and the seat
  // opens a form already carrying every prior ruling.
  //
  // NOT de-allowlisting the connotation family from WARM_ELIGIBLE_RE instead: on the same round another
  // clearance cleared 61 unruled → 0 on a warm attempt 2. That lane works, and removing it would cost
  // every run that converges on it. This refuses to treat a warm no-op as proof, and nothing more.
  const identicalContent = /^(missing_file:|invalid_file:|max_tokens_no_output)/.test(fail)
    && attemptFails.length >= 2 && attemptFails[attemptFails.length - 2] === fail;
  // ── — THE ESCALATION IS FOR A SEAT THAT PRODUCED SOMETHING ───────────────────────────────
  //
  // BUILD 2 (above) buys ONE fresh attempt after a warm repeat, because a resumed session cannot
  // disagree with itself and its repeat proves nothing about a fresh dispatch. Measured, that is true
  // of a seat whose output was WRONG and false of a seat that wrote nothing at all:
  //
  //   invalid_file repeated (the seat produced something)   fresh attempt 3 converged  9 of 9
  //   missing_file repeated (the seat produced nothing)     fresh attempt 3 converged  0 of 6
  //
  // The second case cost ~3.4 min and ~19k output tokens per affected run for an attempt that has never
  // once converged. So the escalation keeps its budget where it pays and stops buying the case where it
  // does not. This is the deterministic-vs-transient line asked for, drawn on what the record
  // already shows before attempt 3 is spent — not a shorter ladder, which would hide the escalation
  // rather than decide it.
  //
  // A CHANGED FAILURE IS NEVER CUT, and that is structural rather than a second condition:
  // `identicalContent` requires this attempt's failure to repeat the previous one byte-for-byte, so a
  // run that moved missing_file → invalid_file never reaches here at all. Two of the measured runs did
  // exactly that, with real quantity — precisely where the ladder earns its keep.
  //
  // `noChange` says the same thing one line up and is NOT read here on purpose: it is RECORDING ONLY,
  // and no break/park/terminate decision reads it ( owns that policy). `identicalContent` is the
  // live signal this branch already decides on, so the rule needs no new input.
  //
  // SIX IS SIX, and all of it from the test box. If a fresh attempt 3 ever converges after a
  // produced-nothing repeat, this is the line to revisit — the note below names the case in the run log
  // so that event is findable rather than silent.
  const producedNothing = /^missing_file:/.test(fail);
  // (round 2) — THE CUT WAS RECORDED AND THE BREAK BESIDE IT WAS NOT, SO THE PATHOLOGY SURVIVED.
  //
  // The comment below says a decision that prevents an attempt must leave a trace. It shipped attached
  // to ONE of the two branches that prevent one. Measured on a delivered run of the test instance (engine 734689e8): the
  // marker `escalationDeclined` appears in ZERO files anywhere in the workspace, because the cut also
  // requires `warm` and that run's attempt rows carry no `warm` field at all — while `"warm"` appears
  // in 98 jsonl files instance-wide, so the absence is the run's, not the field's. With `warm` falsy
  // the run fell through to the pre-existing `else if (identicalContent)` break, which stopped attempt
  // 3 exactly as the cut would have and recorded NOTHING: its note is gated on `warm`, and note() is
  // stderr regardless.
  //
  // `warm` is CORRECT on the cut and is not an accidental narrowing of the decision: the thing being
  // declined is the warm→fresh escalation, which only exists on a warm attempt. On a cold path there is
  // no escalation to decline — the ladder simply breaks. What was narrowed with it was the RECORDING,
  // and both branches end the same way, with budget still in hand.
  //
  // ONE STATEMENT, so a third branch cannot arrive recording a fourth shape. `wouldHaveBeenAttempt` is
  // the number when budget remained and NULL when the ladder was genuinely spent — that is the whole
  // difference between a choice and an ending, and a row that printed `attempt + 1` unconditionally
  // would claim a prevented attempt that never existed.
  // THE RUN SPINE, NOT THE SEAT JSONL — and the first cut had this wrong.
  //
  // `_driver/<stage>.jsonl` IS THE ATTEMPT LEDGER. Nothing states that in one place, and it is relied on
  // everywhere: convergence-ledger derives quantities per row, warm-retry and retry-backoff count rows as
  // attempts, seat-attempts.mjs claims any row carrying `{attempt:int≥1, key, status}` as a dispatch for
  // seat-retry-report's statistics. A decision is not an attempt, and filing one there put a row with no
  // quantity into ledgers that derive quantities — four test files caught it the moment this fired on a
  // path that is actually common. The escalation cut merged into that file first and had the same fault
  // latent: it fires only on warm produced-nothing, so nothing had reached it yet.
  //
  // `run.jsonl` is where this codebase already files the things that are NOT attempts — `form-repair`
  // above, `repair-attempted`, `engine-turn-probe`. It is durable, it is one file per run, and it is the
  // one the wall decomposition deliberately skips. Findable was the requirement; the seat ledger was
  // never what made it so.
  const recordAttemptPrevented = (decision, rule) => {
    try {
      runLog(runDir, {
        event: "attempt-prevented", stage: name, attempt, of: maxRetries + 1, decision, rule,
        fail: String(fail).slice(0, 200),
        warm: Boolean(warm), producedNothing,
        // The whole difference between a CHOICE and an ENDING. Null when the ladder was genuinely spent:
        // printing `attempt + 1` there claims a prevented attempt that never existed, and every count
        // taken off these rows would be high by exactly the runs that had nothing left to prevent.
        // Null and PRESENT — an omitted key cannot be told from a row written before this existed.
        wouldHaveBeenAttempt: attempt < maxRetries + 1 ? attempt + 1 : null,
      });
    } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
  };
  // criterion 1 — the rung decision, recorded on BOTH branches.
  //
  // `usage == null && runId == null` is the seat never having answered: no token count and no run
  // identity, which together mean the turn died before the model saw it. Either alone is weaker —
  // a turn can legitimately report no usage on some paths — so both are required.
  const zeroUsageWarm = Boolean(warm) && fail && usage == null && json?.runId == null;
  if (zeroUsageWarm) {
    const free = rungsRefunded < WARM_ZERO_USAGE_FREE_RUNGS;
    if (free) rungsRefunded++;
    note(`[${name}] attempt ${attempt} [warm patch] returned no usage and no runId — it never reached the model`
      + (free ? `; NOT charging the ladder a rung for it (${rungsRefunded}/${WARM_ZERO_USAGE_FREE_RUNGS} free rungs used)`
        : `; CHARGING it — the ladder has already refunded ${rungsRefunded}, and a second one would let a warm turn that never lands loop`));
    try {
      runLog(runDir, { event: "warm-rung", stage: name, attempt, of: maxRetries + 1 + rungsRefunded,
        rung_free: free,
        reason: free ? "warm turn never reached the model" : "second zero-usage warm turn",
        free_rungs_used: rungsRefunded, free_rungs_max: WARM_ZERO_USAGE_FREE_RUNGS,
        fail: String(fail).slice(0, 200) });
    } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
  }
  // Exactly one row per prevented attempt: the warm produced-nothing case satisfies the cut AND then
  // falls into the break below, and two rows for one decision would double every count taken off them.
  const cutFired = identicalContent && producedNothing && warm && attempt < maxRetries + 1;
  if (cutFired) {
    note(`[${name}] attempt ${attempt} [warm patch] reproduced attempt ${attempt - 1}'s failure byte-for-byte and the seat produced NOTHING either time (${fail.slice(0, 140)}) — NOT escalating to a fresh attempt ${attempt + 1}: measured 0 of 6 convergences on this shape. A seat whose output was merely wrong still escalates.`);
    // THE CUT IS RECORDED, NOT JUST NOTED. `note` is stderr only (log.mjs) and reaches no artifact, so
    // the run record held no trace of a decision that PREVENTS an attempt — and because the cut
    // returns, the prevented attempt never runs. n=6 would therefore be permanent: a seat or model
    // change that made attempt 3 worth buying again could not be noticed, because nothing anywhere
    // counts how often the cut fired or on what. Its own row in the seat's attempt jsonl, where every
    // attempt already lives, is the smallest thing that makes it findable.
    //
    // FINDABILITY ONLY. This samples nothing: the prevented attempt is still prevented, and the row
    // records the case rather than the counterfactual. Re-opening the question needs a deliberate
    // measurement, not a quiet retry ladder that buys one anyway.
    recordAttemptPrevented("escalation-declined:produced-nothing", "#1062");
  }
  if (identicalContent && !producedNothing && warm && attempt < maxRetries + 1) {
    warmEscalatedAt = attempt + 1;
    note(`[${name}] attempt ${attempt} [warm patch] reproduced attempt ${attempt - 1}'s failure byte-for-byte (${fail.slice(0, 140)}) — a resumed session cannot disagree with itself; DISCARDING that session and escalating attempt ${attempt + 1} to a FRESH dispatch (the recovery lane's fresh sample, bought here without the park)`);
  } else if (identicalContent) {
    // — NOT said when the break was a CHOICE. A produced-nothing repeat reaches here with budget
    // still in hand, and "there is no attempt left" would be false: the attempt exists and was
    // deliberately not spent. Its own note above says which case this is.
    if (warm && !producedNothing) note(`[${name}] the warm patch reproduced its own failure and there is no attempt left to escalate to (attempt ${attempt} of ${maxRetries + 1}) — breaking; the fresh sample falls to the recovery lane`);
    note(`[${name}] attempt ${attempt} failed BYTE-IDENTICALLY to attempt ${attempt - 1} (${fail.slice(0, 140)}) — breaking the ladder: same stage, same validator string, further retries are provably futile`);
    // RECORDED, on the path the cut does not reach. This break is the PRE-EXISTING rule and this change
    // does not re-decide it: my 0-of-6 measurement is about the warm→fresh escalation and licenses
    // nothing about a cold break. It makes the population countable, which is what a later ruling on
    // that question would need and could not have had.
    if (!cutFired) recordAttemptPrevented("ladder-break:identical-signature", "#460");
    // A said-back refusal the step left as it was: the pass stands, below, with what it left open recorded.
    if (saidBackOpen) return out("break");
    return out("identical");
  }

  // Lane-wedge: the turn never got a command lane (0 tokens). The extended ×1.5 shot can't help (it produced
  // nothing), and another attempt on a SHARED lane cannot help — so stop here and hand it on fast. The
  // lane-wedge retry in stage() (pipeline.mjs) waits for the lane to clear and dispatches the stage again.
  if (fail === "lane_wedge") return out("break");
  //: a model mismatch is a CONFIGURATION fault, not a transient. The next attempt sends the same
  // argv to the same provider and gets the same substitution, so retrying only buys the wrong model
  // twice. Break immediately and let the stage fail with the mismatch named on every row.
  if (fail.startsWith("model_mismatch:")) {
    note(`[${name}] model mismatch is deterministic — breaking the ladder (a retry re-buys the same wrong model)`);
    return out("break");
  }
  // A sign-in that could not be refreshed refuses every attempt the same way: the next one sends the
  // same credential and gets the same 401, seconds apart. Break, and let the stage fail with it named.
  if (fail.startsWith("engine_signed_out:")) {
    note(`[${name}] the engine's sign-in could not be refreshed — breaking the ladder (a retry re-sends the same credential)`);
    return out("break");
  }
  // EVERY TOOL CALL THE TURN MADE WAS REFUSED. On some hosts codex's own sandbox refuses the stage's
  // tool servers while the turn reports success, and the stage then fails for want of what the tools
  // would have produced. The next attempt spawns the same sandbox and is refused the same way, so a
  // retry re-buys the refusal: measured at three paid attempts per stage on a production run before the
  // identical-failure break stopped it. Break on the first. A turn where any call completed is not this.
  if (everyToolCallRefused(turn)) {
    note(`[${name}] every tool call this turn made was refused (${turn.mcpToolCallsRefused}) — breaking the ladder (a retry is refused the same way)`);
    return out("break");
  }
  // D3: overload (529 / status_overloaded) — stop the ladder here: an in-ladder re-attempt hammers an
  // API that just said it is overloaded, seconds apart, on the SAME model. Breaking hands the failure
  // to the existing machinery: the stage fails on its one model (there is no model cascade), and that
  // failure parks the run for recovery with escalating backoff (TRANSIENT_RE → .postponed).
  if (fail === "status_overloaded") return out("break");
  // Rate-limit: do NOT retry (every retry hits the same capped subscription) and do NOT fall back — return
  // immediately so the pipeline can postpone + auto-resume after the window. resetsAt rides the result.
  if (fail === "rate_limited") return out("rate-limited");
  // Timeout-aware retry: a genuinely over-budget/hung stage will just re-time-out on an identical
  // attempt (the v14 delivery burned 3 × 600s). Give it exactly ONE longer shot, then stop.
  if (fail === "timeout") {
    // A WARM attempt, the one rung that resumes a session, that ran to its HARD WALL breaks after this attempt,
    // and the caller records the coverage-limited DEFERRAL (which the gate clamps CLEAR→CONDITIONAL). A
    // FOLLOWUP is a fresh session and is not stopped here: it takes the one extended retry below, as any fresh
    // dispatch does. Until 2026-11-05 a followup stopped here too, on the false premise that it resumed a loaded
    // session. See warmHardWallStop.
    if (warmHardWallStop({ fail, warm, signals })) {
      note(`[${name}] warm attempt hit the hard wall — breaking (recording the deferral)`);
      return out("break");
    }
    if (timeoutRetriesUsed >= 1) {
      note(`[${name}] second timeout — stopping (won't finish on a 3rd identical attempt)`);
      return out("break");
    }
    timeoutRetriesUsed++;
    // Stall honesty (charter P1 §1): a STALL kill (byte-silent or no-progress — signals.stalled) is NOT
    // "the stage needed more time" — the R-round evidence retry did the identical work in 369s after a
    // 1500s stall burn. Retry ONCE at the SAME budget; extending would only extend the next stall's burn.
    // A hard-wall kill (a genuine over-budget grind) keeps the single 1.5× extended shot.
    if (signals?.stalled) {
      note(`[${name}] stall kill${signals?.noProgress ? " (no-progress watchdog)" : ""} → one retry at the SAME ${effTimeout}s budget (a stall is not a slow turn)`);
    } else {
      effTimeout = Math.round(timeoutSec * 1.5);
      note(`[${name}] timeout → one extended retry at ${effTimeout}s`);
    }
  }
  return out("retry");
}
