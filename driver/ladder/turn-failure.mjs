// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// turn-failure.mjs — what a settled turn's failure is called.
//
// The stage ladder (gateway.mjs runStageLadder) asks two questions of a turn the engine hands back. First,
// whether the turn itself failed (a timeout, a fallback, an exit code, an envelope) before any file is judged.
// Then, once the rescues have had their say, which name the failure is recorded and retried under: the name
// decides the retry, so a rate limit, an overload or a model the wire contradicts each gets its own. Both
// answers are here with the classifiers they use; the gateway re-exports those classifiers.

import { envGateOn } from "../driver.config.mjs";
import { note } from "../log.mjs";

export function isEmbeddedFallback(json, stderr = "") {
  const m = json?.meta ?? json?.result?.meta ?? {};
  return m.transport === "embedded" || m.fallbackFrom === "gateway" || /EMBEDDED FALLBACK/.test(stderr);
}

// A gateway turn that ran out of time. Three signals: (1) execFile hit its hard kill (timeoutSec+60);
// (2) the gateway hit its OWN turn timeout, after which the CLI auto-falls-back to embedded and that
// attempt errors — surfacing as `EmbeddedAttemptSessionTakeoverError` / "request timed out" on a
// nonzero exit (the v14 delivery failure, previously mislabelled `nonzero_exit_1`); (3) any nonzero
// exit whose wall already reached the configured budget. Distinguished from transient errors so the
// retry policy can give a slow stage ONE longer shot instead of 3 identical doomed attempts.
export const isTimeout = (facts) => timeoutCause(facts) !== null;
export function timeoutCause({ killed, code, wall, stderr = "", timeoutSec }) {   // which signal fired, or null
  if (killed) return "killed";
  if (/EmbeddedAttemptSessionTakeoverError|request timed out|\bETIMEDOUT\b/i.test(stderr)) return "stderr";
  return code !== 0 && wall >= timeoutSec ? "wall" : null;
}

// A LANE WEDGE: a timeout whose turn moved ZERO tokens — the gateway never admitted it to a command lane (the
// serial `main` lane saturated by the heartbeat sweep). The real signature (teal-bastion 2026-06-15) is a
// hard-kill timeout with a NULL usage envelope, so we key on "fail is a timeout AND no tokens moved" rather than
// on a parsed 0-usage object. A slow-but-working model that times out returns a status_timeout envelope WITH
// usage (admitted) → NOT a wedge. Kept pure + exported so the classifier is unit-tested (it must not misfire on
// admitted turns, and it MUST fire on the null-usage hard-kill that the production incident actually produced).
export function isLaneWedge(fail, usage) {
  if (fail !== "timeout") return false;
  const moved = (usage?.input || 0) + (usage?.output || 0) + (usage?.cacheRead || 0) + (usage?.cacheWrite || 0);
  return moved === 0;
}

// Final wedge classification at the runStage call site. A 0-token timeout LOOKS like a wedge (isLaneWedge), but a
// HARD-WALL kill (signals.hardWall — the turn ran the full timeout+60 and was SIGKILLed) is a genuine over-budget
// grind, NOT a saturated command lane; labelling it `lane_wedge` wastes a 2-cycle chain retry on a turn that won't
// fit. Keep `lane_wedge` only for a STALL (signals.stalled) or a truly-silent non-hard-wall null-usage kill; a
// hard-wall kill stays `timeout` (gets at most ONE extended shot, then the deferral). PURE + exported for test.
export function classifyWedge(fail, usage, signals) {
  if (isLaneWedge(fail, usage) && !signals?.hardWall) return "lane_wedge";
  return fail;
}

// D3 — Anthropic overload (HTTP 529 / overloaded_error). Through claude -p a 529 surfaces as a FAILED
// turn (nonzero exit) whose result text/stderr carries the overloaded_error envelope — classified
// generically it looked like `nonzero_exit_1` and the ladder re-attempted INSTANTLY, hammering an API
// that just said "go away" (and burning the retry budget in seconds — the 04:30 restart-window shape).
// Detect it and reclassify to `status_overloaded`, the token the normalized --json envelope already
// produces for the same condition: the stage fails on its one model (there is no model cascade), and
// TRANSIENT_RE routes that failure to the recovery park (.postponed + escalating backoff) — the
// existing machinery owns the re-attempt; runStage breaks its own ladder on it (mirrors lane_wedge).
// The 529 match is deliberately ANCHORED (api error / http prefix, or overload vocabulary within the
// same line) so a stray "529" in ordinary output never misroutes a real content failure. PURE + exported.
const OVERLOAD_RE = /overloaded_error|"type"\s*:\s*"overloaded"|\bapi[ _]?error:?\s*529\b|\bhttp\s*529\b|\b529\b[^\n]{0,120}overloaded|overloaded[^\n]{0,120}\b529\b/i;

export function isOverloaded({ json, stdout = "", stderr = "" } = {}) {
  if (json?.status === "overloaded") return true;
  return OVERLOAD_RE.test(`${stdout}\n${stderr}`);
}

/**
 * IS THIS ATTEMPT A TIMEOUT? A kill and a run past the limit with a non-zero exit always are. A timed-out request named
 * in stderr is one only when the turn did not complete: a turn that exited 0 with its engine's status ok outlived the
 * request, which was a call inside it (a web lookup, a tool), and is judged on what it wrote like any finished turn.
 * Recorded as a timeout, it was run again whole: on one test run a writer finished in 14.7 minutes of its 43, exited 0
 * with its output written, and paid a second attempt of 20.3 minutes. `cause` is `timeoutCause`'s answer. PURE.
 */
export function attemptTimedOut({ cause, code, json }) {
  if (!cause) return false;
  return !(cause === "stderr" && code === 0 && json?.status === "ok");
}

/**
 * The failure a turn's own outcome names before any file is judged, or null when the turn settled cleanly and
 * its files decide. `timedOutBy` is timeoutCause's answer. PURE.
 */
export function turnFailure({ timedOutBy, code, json, stderr }) {
  if (attemptTimedOut({ cause: timedOutBy, code, json })) return "timeout";
  if (isEmbeddedFallback(json, stderr)) return "embedded_fallback";
  if (code !== 0) return `nonzero_exit_${code}`;
  if (!json) return "unparseable_json";
  if (json.status !== "ok") return `status_${json.status}`;
  return null;
}

/**
 * The name a failed attempt is recorded and retried under, once the rescues have run. `gauge` is the model the
 * turn asked for against the one the wire reported. Returns the failure unchanged when no rule renames it, and
 * null for a turn that did not fail and whose model the wire confirms.
 */
export function nameTheFailure(fail, { usage, json, stdout, stderr, signals, gauge, name }) {
  const { modelMismatch, famRequested, famActual, modelRequested, modelActual } = gauge;
  // Lane-wedge reclassification (see isLaneWedge): a 0-token timeout is a saturated command lane, not a slow
  // model. Becoming `lane_wedge` makes the retry policy skip the wasteful extended shot; stage() (pipeline.mjs)
  // waits for the lane to clear and dispatches the stage again on its one model (a shared lane is not
  // model-specific). teal-bastion 2026-06-15.
  // See classifyWedge: a 0-token timeout is a saturated-lane wedge UNLESS it's a hard-wall over-budget kill.
  fail = classifyWedge(fail, usage, signals);
  // D3: an Anthropic 529/overload hides inside the generic transport tokens (nonzero_exit_1 through
  // claude -p) — reclassify to status_overloaded so it stops the same-model ladder below and rides the
  // recovery park instead. Only the transport shapes are eligible: a timeout/wedge has
  // its own policy, and a content failure must never be laundered into a transient by a stray match.
  if (fail && /^(nonzero_exit_|status_error$|unparseable_json$)/.test(fail) && isOverloaded({ json, stdout, stderr })) fail = "status_overloaded";
  // Rate-limit / session-cap (429): the standalone engine maps EVERY tier to the one Claude subscription, so
  // a re-run on any tier is futile — classify distinctly (NOT in FALLBACK_ELIGIBLE) and carry resetsAt so the
  // pipeline POSTPONES the run to resetsAt instead of failing it. (Overrides the nonzero_exit_1 a 429 shows as.)
  // Guarded on `fail`: a turn whose finished, validated artifact was just accepted (the exit-1 rescue above)
  // stays accepted — the NEXT stage's first turn hits the same cap at 0 tokens spent and postpones cleanly.
  if (signals?.rateLimited && fail) fail = "rate_limited";
  // AN ENGINE WHOSE SIGN-IN EXPIRED IS NAMED, not left as `nonzero_exit_1`. codex fails its refresh in
  // seconds with a bare exit code while `codex login status` still reports the user signed in, so the
  // one thing that fixes it has to be in the failure itself. AFTER the rate limit, which wins when both
  // appear: a postponed run resumes on its own, and a signed-out one cannot. The sentence rides after
  // the colon, as `model_mismatch:` carries its detail, so no run-level classifier needs a new token.
  else if (signals?.signedOut && fail) fail = `engine_signed_out: ${signals.signedOut}`;
  // AND ONE WHOSE TOOLS WERE ALL REFUSED IS NAMED, not left as the missing file the refusal caused. The
  // turn reported success and the stage failed for want of what its tools would have produced; a
  // `missing_file` reads as a model that did not write, and sends the reader to the wrong place. The
  // sentence says what fixes this host. After the sign-in, which is the more basic fault when both appear.
  else if (signals?.toolsRefused && fail) fail = `engine_tools_refused: ${signals.toolsRefused}`;
  // A6 (addendum 2026-07-30): stop_reason max_tokens with ZERO usable output is a DETECTED FAULT with a
  // name — never a silent paid retry. The turn ran to its output-token ceiling and the artifact never
  // landed (a content fail on a "successful" turn), or the turn itself died at the ceiling (transport
  // shapes) — either way the CAUSE is the output budget, and an unnamed retry just re-buys the same
  // wall. Naming it here makes the stage-log row carry the fault (counted per attempt), routes
  // correctiveMessage to the shrink-your-output correction, and arms the A4 identical-signature break
  // on a second identical hit. The content detail stays appended (hint derivation and the
  // coverage-quarantine joins still read it); the transport shapes go BARE — their tokens
  // (nonzero_exit / unparseable_json) read as TRANSIENT to the run-level classifier (repairs.mjs
  // TRANSIENT_RE is substring-matched) and would silently re-arm the full recovery ladder for a
  // deterministic ceiling fault. Never fires on a rescued turn (fail is already null) nor on the
  // kill/wedge/overload/rate-limit classes (each keeps its own policy).
  if (fail && json?.stopReason === "max_tokens" && /^(missing_file:|invalid_file:|nonzero_exit_|status_error$|unparseable_json$)/.test(fail)) {
    const named = /^(missing_file:|invalid_file:)/.test(fail) ? `max_tokens_no_output:${fail}` : "max_tokens_no_output";
    note(`[${name}] DETECTED FAULT: stop_reason=max_tokens with no usable output (${fail}) → ${named}`);
    fail = named;
  }

  // corruption 3, THE ENFORCEMENT — a turn that ran a different model than it was told to is a
  // FAILED turn, not a successful one with an interesting note. Everything the stage produced is
  // attributed to the wrong model, so accepting it would put the corruption on the record permanently
  // (the artifact lands, the row says haiku, sonnet wrote it).
  //
  // Deliberately scoped to `!fail`: a turn that already failed keeps its own cause, because `timeout`
  // and `rate_limited` drive retry policies this must not override. `modelMismatch` is journalled on
  // the row either way, so the mismatch is never lost — only the classification defers.
  //
  // Default-ON gate through `envGateOn` (the rule): `CLEAROTRON_MODEL_WIRE_CHECK=0` disarms it without
  // a deploy if a provider ever starts reporting an id this build's family regex misreads. Disarming
  // silences the REFUSAL, never the record — `modelActual`/`modelMismatch` keep landing on every row.
  if (modelMismatch === true && !fail && envGateOn("CLEAROTRON_MODEL_WIRE_CHECK")) {
    fail = `model_mismatch:${famRequested}->${famActual}`;
    note(`[${name}] MODEL MISMATCH: asked for ${modelRequested} (${famRequested}), the wire says ${modelActual} (${famActual}) — failing the turn. An unhonoured model override is an error, not a substitution; every number attributed to this turn would name the wrong model.`);
  }
  return fail;
}
