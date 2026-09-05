// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repairs.mjs — failure signatures, recovery classification, and the bounded repair ledger.
//
// Repair-first doctrine (2026-07-05, the senior lawyer): every gate KEEPS its firing condition — what changes is
// the RESPONSE when it fires. A defect gets a bounded, code-level repair at the point of defect; the
// run-level auto-recovery ladder is reserved for failures a fresh re-sample can actually change. The
// Open Country autopsy (TMP8729, 2026-07-05) is the motivating case: an HTTP 414 from an over-long
// OR-stacked form band re-failed BYTE-IDENTICALLY across 3 auto-recovery parks (~77 min) before the
// terminal — retrying a deterministic defect is not recovery, it is delay plus a wrong diagnosis.
//
// Three ideas live here, deliberately dependency-light (node:fs/crypto/path only):
//   1. failureSignature — a stable fingerprint of (stage, reason) so the recovery ladder can detect
//      "this exact failure already happened" and stop re-buying it.
//   2. classifyFailureReason — transient | deterministic | unknown, from the reason TEXT alone.
//      Class "factual" is NEVER inferred from text: only a throw site that knows the ground truth
//      (screen-gate, client-gate, a reasoned reviewer BLOCKING) may stamp it via StageFailure opts.
//   3. createRepairLedger — persistent per-run attempt bookkeeping (_driver/repairs.json) so a
//      park/resume can never re-arm an exhausted repair and repairs can never loop.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

// ── the terminal kind that is not a failure ───────────────────────────────────────────────
//
// A REFUSAL THE PRODUCT IS DESIGNED TO MAKE. The engine did not break: an order arrived that this
// deployment does not serve, a preflight said so before any spend, and the run stopped. Owner ruling
// 2026-08-13 — such a refusal must be distinguishable from a failure IN EVERY SINK IT REACHES, must
// never feed failure statistics, and must never trigger recovery machinery.
//
// It is a terminalKind and NOT a new `state`, and that is the load-bearing choice. `state` is a closed
// vocabulary every surface switches on — status-snapshot.mjs's own bucket filter is
// `state === "delivered" || state === "failed"`, and scripts/e2e.mjs maps the queue marker through
// TERMINAL_BY_SUFFIX_RAN = { failed, done, cancelled }. A fifth state would not read as "refused" to
// either of them; it would read as nothing, and the run would drop off the status page and out of the
// round report. A mislabelled terminal is a defect; an invisible one is a worse defect. `terminalKind`
// is the field those same readers ALREADY carry for "why did this run end" (status-snapshot.mjs
// slimRun, scripts/e2e.mjs readMarkerTerminal), so the discriminator arrives on surfaces that exist.
//
// The boundary, stated once so it is not re-litigated per call site: the product declined THIS ORDER
// against THIS DEPLOYMENT, before any spend, and no retry can change the answer. Whether the gap is a
// territory the provider does not cover or a member this box never wired up is the same event with
// different remedies — both remedies are "change the order or change the deployment", neither is
// "run it again", and neither is a fault in the engine.
export const REFUSAL_TERMINAL_KIND = "designed-refusal";

// ── classification ──────────────────────────────────────────────────────────────────────────────

// TRANSIENT: infrastructure/sampling noise where a parked re-sample (fresh session, valid stages
// skip) is a plausible remedy — the full backoff ladder stays available. Mirrors gateway fail
// strings (timeout / lane_wedge / embedded_fallback / nonzero_exit / status_*) plus transport-level
// noise and provider 5xx. `unparseable_json` is the CLI envelope coming back as garbage — sampling
// noise, NOT a content verdict (the strict content parsers have their own named tokens, which are
// deliberately absent here).
// `transport failure` is transport-guard.mjs faultText's own literal — "<CODE> — transport
// failure on the <where> call (no response from the provider): <detail>". The code LEADS when the
// rejection carried one, and the errno tokens below matched it; but undici reports a codeless fault as
// a bare `TypeError: fetch failed` (no cause.code), and that line — transport noise by construction —
// carried no token either regex knew, so it classified DETERMINISTIC at fan-in: loud-terminal, but it
// defeated 's weather lane for exactly the unreachable-provider case the lane exists for.
export const TRANSIENT_RE = /\btimeout\b|\blane_wedge\b|\bembedded_fallback\b|\bnonzero_exit|\bunparseable_json\b|\bstatus_(timeout|overloaded|error|aborted|rate_limited)\b|\brate_limited\b|\boverloaded\b|\beconnreset\b|\betimedout\b|\benotfound\b|\beai_again\b|socket hang\s?up|\bhttp\s?5\d\d\b|\btransport failure\b/i;

// STRUCTURAL REFUSAL: the provider ANSWERED, and its answer is a verdict on the REQUEST. The remedy is
// a different query, never time and never a retry — so this outranks the status code, which is the whole
// point of it existing.
//
// — a 5xx can carry one. Measured verbatim on a delivered run (2026-08-15):
//
//   HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - <JX> - Near/Adj queries with sub queries that can
//   return a huge amount of results are not allowed
//
// `\bhttp\s?5\d\d\b` matches that, so TRANSIENT_RE claimed it and the sentence "are not allowed" was
// never read. Seven slices on one axis were filed as weather (`permanent: 0`), and the same refusal
// will recur byte-identically on every future run of that shape. Status code decided; message ignored —
// the same inversion fixed one layer up at the fan-in.
//
// NARROW BY CONSTRUCTION, and it grows only with a provider's verbatim string in hand. The error
// direction matters: a wrong "structural" stops a retry that would have worked, so this must never
// generalise on a hunch. Phrases here are request-shape verdicts a provider states about a query it
// parsed — not authorization ("not permitted", 403, already deterministic) and not pressure (429).
export const STRUCTURAL_REFUSAL_RE = /\b(?:are|is)\s+not\s+allowed\b|\bnot\s+supported\b|\bunsupported\s+(?:query|operator|syntax|predicate)\b|\bquery\s+too\s+complex\b/i;

/**
 * Can the recovery ladder do anything for this provider error? The predicate `deferExhaustedProviderErrors`
 * takes as `retryCannotHelp`.
 *
 * A structural refusal is permanent EVEN WHEN IT LOOKS TRANSIENT, because the provider read the request
 * and rejected its shape. Everything else keeps the prior rule: not-transient ⇒ the ladder cannot help.
 * PURE.
 */
export const retryCannotHelpWith = (reason) => {
  const s = String(reason ?? "");
  return STRUCTURAL_REFUSAL_RE.test(s) || !TRANSIENT_RE.test(s);
};

// OUTAGE: the strict subset of TRANSIENT whose remedy is TIME — the far end is refusing or unreachable
// right now (provider 5xx/429, rate limits, connection failures). ONLY these may re-park the same
// signature and climb the backoff ladder, because "wait longer" is a real remedy for them and for
// nothing else. The rest of TRANSIENT_RE is wedge-shaped — nonzero_exit, unparseable_json,
// lane_wedge, embedded_fallback, a stage that times out every time — where a byte-identical repeat
// means the thing is stuck, and buying it three parks is the Open Country pathology (the
// identical failure bought 3× over ~77 minutes, then failed anyway). Those keep repeat-terminal.
// `transport failure` sits in the OUTAGE subset too: the phrase means the far end DID NOT ANSWER
// (faultText's literal — "no response from the provider"), which is precisely the class whose remedy
// is time. A codeless "fetch failed" is the same unreachable provider as an ECONNRESET that kept its
// errno — it may re-park and climb the backoff ladder, exactly as the errno forms always could.
export const OUTAGE_RE = /\bhttp\s?(?:5\d\d|429)\b|\bstatus_(?:overloaded|rate_limited)\b|\brate_limited\b|\boverloaded\b|\beconnreset\b|\beconnrefused\b|\betimedout\b|\benotfound\b|\beai_again\b|socket hang\s?up|\bservice unavailable\b|\bbad gateway\b|\btransport failure\b/i;

// DETERMINISTIC: rooted in code/data/provider semantics — a re-sample re-derives the same failure.
// Kept deliberately NARROW: provider 4xx that are request-shape verdicts (400/403/404/409/410/414 —
// NOT 408/429, which are time/pressure), the fan-in "plan dictated it and nothing ran" family, a
// collapsed (searched-then-lost) band, and the deterministic grid join. Content/validator rejects
// (invalid_file, *_unparseable, findings_* tokens) are NOT here on purpose: the VENZY bake run
// proved model-vocabulary misses DO converge on a fresh re-sample — they classify "unknown" (one
// park), and the repeat-signature rule is the backstop if the second sample fails identically.
// Throw sites that know better stamp failClass explicitly, which always wins over this text guess.
// `plan-defect` (PR-1): the executor refused a dictated slice whose term disagrees with its predicate
// or is label/prose-shaped (providers/_shared/execute-plan.mjs). The refusal is derived from the FROZEN
// plan's own bytes, so a re-sample re-derives it identically — parking against it is provably futile.
export const DETERMINISTIC_RE = /\bhttp\s?4(0[0349]|1[04])\b|uri too long|own no band block|plan unexecuted|collapsed named band|searched but lost|\bgrid_join_missing\b|\bplan-defect\b/i;

// ──: what the fan-in's missing slices are evidence OF ───────────────────────────────────────
//
// The fan-in park (pipeline.mjs, "N dictated qid(s) own no band block") stamps `failClass` explicitly,
// and per the note above an explicit stamp ALWAYS WINS over classifyFailureReason. So this decision is
// the only thing standing between a plan-execution hole and the weather lane — and it used to get it
// backwards.
//
// It read `errByQid.get(qid) ?? axisOutcome.get(axisOf(qid)) ?? ""`. `axisOutcome` is the AXIS's
// repair-attempt outcome (`threw: ${err.message}` / `failed: ${r.cause}`), which routinely carries
// `socket hang up`, `timeout`, `nonzero_exit`, `http 5xx` — every one a TRANSIENT_RE hit. A slice with
// no provider error of its own was classified on an exception raised while repairing something else.
//
// THAT INVERTS THE SIGNAL. No error block of its own is the strongest evidence a slice never reached
// the provider — the most deterministic case there is — and the absence is what triggered the borrow.
// Note DETERMINISTIC_RE above already matches this throw's own words (`own no band block`,
// `plan unexecuted`): the text guess was RIGHT and the explicit stamp overrode it.
//
// The axis outcome survives as evidence in exactly one case: THE AXIS LANDED NOTHING. Zero qid-stamped
// blocks means the executor never wrote, so its transport failure really is this slice's story and
// 's weather lane keeps working for the dead-provider case it exists for. Once the axis HAS landed
// qid-stamped blocks the executor demonstrably ran and wrote, and this qid's absence is an identity or
// coverage hole that no repair outcome from its axis speaks to.
//
// `landedByAxis` counts QID-STAMPED blocks only. A legacy qid-less band joins nothing (joinPlanToBands),
// so counting it would read as "the executor wrote" on an axis where nothing dictated ever landed.
//
// TWO CLAIMS, NOT ONE — and collapsing them in EITHER direction is a bug this has now had both ways.
// The original conflated them by classifying on the quote. The first cut of this fix conflated them by
// withholding the quote, and the repair-first arm that holds a 414-shaped dispatch failure terminal
// caught it: a 414-shaped DISPATCH
// failure keeps its verbatim "HTTP 414 URI Too Long" in the terminal diagnosis, and that quote is the
// whole teal-causeway lesson — three parks that never surfaced the provider error they were about.
//
//   `quote`        what the failure sentence shows a human. The axis outcome belongs here ALWAYS: a
//                  repair was tried against this slice's axis and what it hit is real information.
//   `classifiedOn` what the ladder decides on. The axis outcome belongs here ONLY when the axis landed
//                  nothing, per the reasoning above.
//
// Quoting a transient-looking axis outcome while stamping deterministic is safe by construction: the
// explicit stamp always wins over classifyFailureReason, and recoveryLaneOf gates on failClass BEFORE
// it ever tests the text. Both are asserted in the tests, because "safe by construction" is a claim
// about two other functions that could change.
export function fanInMissingEvidence(missing, { ownError, axisOf, axisOutcome, landedByAxis } = {}) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : (k == null ? undefined : m?.[k]));
  const qids = Array.isArray(missing) ? missing : [];
  const rows = qids.map((qid) => {
    const axis = typeof axisOf === "function" ? axisOf(qid) : get(axisOf, qid);
    const own = get(ownError, qid);
    if (own) return { qid, axis, quote: String(own), classifiedOn: String(own), source: "slice" };
    const outcome = get(axisOutcome, axis) == null ? "" : String(get(axisOutcome, axis));
    if (!outcome) return { qid, axis, quote: "", classifiedOn: "", source: "none" };
    const landed = Number(get(landedByAxis, axis)) || 0;
    return landed === 0
      ? { qid, axis, quote: outcome, classifiedOn: outcome, source: "axis-landed-nothing" }
      : { qid, axis, quote: outcome, classifiedOn: "", source: "axis-context" };
  });
  // `every` on an empty list is vacuously TRUE, and "no missing slices" must never read as transient.
  // The caller only reaches this inside `if (missing.length)`, so the guard is belt-and-braces — but a
  // vacuous transient here would hand a clean fan-in the full backoff ladder, silently.
  const failClass = rows.length && rows.every((r) => TRANSIENT_RE.test(r.classifiedOn)) ? "transient" : "deterministic";
  return { rows, failClass };
}

// The classes, in the order the run-level catch consults them.
//   transient      → full auto-recovery ladder (re-sampling is the remedy)
//   unknown        → one park (the VENZY doctrine: a single fresh sample often converges)
//   deterministic  → no parks (repairs already ran at the point of defect; retry is provably futile)
//   factual        → no parks (a human question, not a retry question — throw-site stamped only)
export function classifyFailureReason(reason) {
  const text = String(reason ?? "");
  if (TRANSIENT_RE.test(text)) return "transient";
  if (DETERMINISTIC_RE.test(text)) return "deterministic";
  return "unknown";
}

// ── — A FAILURE THE VALIDATOR NAMED THAT THE CLASSIFIER COULD NOT ─────────────────────────────
//
// R5 parked at common-law-half:m on `class:"unknown", classSource:"reason-text"` over a reason string a
// validator had emitted, structured, with its own token and its own count in it. Neither regex above
// mentions a validator token, so every structured reason lands on the catch-all — and the run then
// survived on the catch-all lane's default budget rather than on anything that understood the failure.
// Nothing recorded that this had happened, so the gap could only be found by reading a log by hand.
//
// THIS CHANGES NO BUDGET, AND THAT IS THE DESIGN, not a limitation of it. The issue's own correction
// (2026-08-13) withdrew the trend rule it proposed: R6 showed a FLAT count (74 → 74) on a stage that was
// about to succeed, and a ceiling read off that trend would have killed the run at 2/9. Both runs
// recovered on exactly the park the current default grants. So the class stays "unknown" and keeps its
// one park; what is new is only that the failure gets NAMED. Minting a new class value would be that
// refuted rule arriving by the back door — decideRecovery's parkBudget sends any class outside
// transient/stale/unknown to ZERO parks, so a well-meant "structured" class is a silent terminal.
//
// The token is a PARAMETER, not re-derived here: failureSignature already computes it from the reason,
// and a second derivation is a second answer waiting to disagree with the first.
// ── BUILD A — WHERE THE CLASSIFICATION CAME FROM ────────────────────────────────────────────
//
// Owner ruling 2026-08-19: `classSource` becomes `validator-token` for a token the validator already
// named. Budgets identical, no new class value, no lane change — `decideRecovery` takes no
// `classSource` argument at all, so this cannot reach a budget branch even by mistake.
//
// Exported and pure for the same reason `unnamedStructuredFailure` is: the pipeline's call site had a
// three-way ternary inline, and a second copy of a precedence rule is a second answer waiting to
// disagree with the first. ONE derivation, and a test can drive it without running a pipeline.
//
// PRECEDENCE, and the ordering is the design:
//   throw-site       the stage stamped its own class. It counted the things; nothing outranks it.
//   validator-token  the reason carries an ALLOWLISTED validator token (PROGRESS_TOKENS, via
//                    progressQuantity) — the case  was filed on.
//   reason-text      neither: the generic regex read, which is a guess and stays labelled as one.
//
// SCOPED TO THE QUANTITY TOKEN, NOT TO `kindToken`, deliberately. `kindToken` is any leading `word:`
// prefix, not a vocabulary — `invalid_file:<path>` is 71 of 76 recorded stage failures and no validator
// named it. Routing that to `validator-token` would silence unnamedStructuredFailure on exactly the
// shape it was widened to catch, and would do it by relabelling rather than by understanding anything.
//
// The strike relabel ("invalid-artifact-strikes") is applied by the caller AFTER this and still
// outranks all three — it is a deliberate override, and it is the caller's to make.
export function classificationSource({ stamped = false, quantityToken = null } = {}) {
  if (stamped) return "throw-site";
  if (quantityToken) return "validator-token";
  return "reason-text";
}

export function unnamedStructuredFailure({ failClass, classSource, token, kind } = {}) {
  // — A KIND COUNTS AS STRUCTURE, and requiring a quantity was why this reported almost nothing.
  // `invalid_file:<path>` is 71 of 76 recorded stage failures and carries no count, so the predicate as
  // first written was blind to the shape it most needed to see: 2 of 4 `unknown` classifications on the
  // preserved runs went unreported for exactly this reason.
  return failClass === "unknown" && classSource === "reason-text" && (Boolean(token) || Boolean(kind));
}

// ── failure signature ────────────────────────────────────────────────────────────────────────────

// Normalize a reason to its token skeleton so the SAME defect signs identically across attempts
// while different defects stay apart: paths → basename, long hex runs → "H", digit runs → "N",
// whitespace collapsed, capped at 160 chars (matches the park log truncation, so a signature can be
// recomputed from historical run.jsonl rows).
export function normalizeReason(reason) {
  const full = String(reason ?? "")
    .toLowerCase()
    .replace(/[^\s"'`]*\/[^\s"'`]*/g, (m) => m.split("/").filter(Boolean).pop() ?? "")
    .replace(/[0-9a-f]{8,}/g, "H")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim();
  if (full.length <= 160) return full;
  // Past the cap, keep a 151-char head AND a digest of the remainder — still exactly 160 chars, so
  // the park-log truncation contract holds. The head ALONE collided: fan-in reasons share a ~96-char
  // template prefix, so two genuinely different missing-slice failures both signed
  // fan-in|6b3148456539 and the second read as "repeat" (copper-bastion, 2026-07-22).
  return `${full.slice(0, 151)}~${createHash("sha256").update(full.slice(151)).digest("hex").slice(0, 8)}`;
}

// Stage labels can be decorated ("synthesis(blocking)", "register-unit:primary-sweep(plan-join)") —
// the decoration is presentation, not identity (same rule as the no-fromStage resume comment in
// pipeline.mjs). The axis suffix (":primary-sweep") IS identity and stays.
export function bareStage(stage) {
  return String(stage ?? "pipeline").replace(/\(.*$/, "").trim();
}

// ── the progress quantity ─────────────────────────────────────────────────────────────────
//
// Some failures carry a COUNT of what is still wrong — "9 meaning receipts undisposed". That number is
// the only evidence a repeating failure has of CONVERGING: 25 → 9 → 6 is a session closing on the fix,
// 12 → 11 → 11 is one that has stopped moving. The signature above cannot carry it BY CONSTRUCTION:
// normalizeReason collapses every digit run to "N" so the same defect signs identically across
// attempts, and past the cap the tail is hashed AFTER that collapse. Measured on the shape that killed
// the R1 scenario (2026-08-02): 6, 9 and 11 undisposed all sign common-law-half:b|55a5bb01bd0c, and all
// three sign 64335a6ff668 on the long-list shape that runs past the cap — identical either way, so the
// terminal read "repeating itself" over a session that was converging. The count travels as its OWN
// typed field NEXT TO the signature, never inside it — the signature keeps signing what it signs today.
//
// ABSENT IS NOT ZERO. Most failures carry no quantity at all (a timeout, a missing file) and record
// null. Zero would read as "nothing left undisposed", which is what SUCCESS looks like — recording it
// for a failure that simply has no count would make every transport failure look converged.
//
// The table is an ALLOWLIST, not a find-a-digit heuristic: a bare \d+ grab would read the exit code out
// of nonzero_exit_1, or the ordinal out of finding_use_check_missing:12, and call it progress. An entry
// joins this table only with the throw site's literal template in hand and a test.
const OVERFLOW_RE = /\(\+(\d+) more\)\s*$/;
const overflowOf = (tail) => { const m = OVERFLOW_RE.exec(tail.trim()); return m ? Number(m[1]) : 0; };

// verify.mjs connotationDispositionFail, since:
//   `connotation_no_ruling:no_ruling=<n>;<row-id> [<query|receipt>],…[ (+N more)]`
//   `connotation_form_damaged:form_damaged=<n>;<detail>[ (+N more)]`
//   `connotation_quote_unbound:quote_unbound=<n>;<row-id> [<query>] <state> <R-id>,…[ (+N more)]`
// The leading CAUSE CENSUS is the exact count stamped at the throw site, so the total is the sum of its
// numbers — no comma-splitting, and therefore immune to the over-count a query containing a comma used to
// cause. LEGACY SHAPES still parse and must: this text path exists for the run-level catch, which sees
// prose only, and a resumed or archived run can still carry a pre- token
// (`connotation_undisposed:<census>;…`, `<q1,q2,…>[ (+N more)]`). A stale token that stopped counting
// would read as a MISSING quantity, which is what a converged run looks like.
// The validator's exact count still rides as `quantity` at the throw site and always wins.
const CENSUS_RE = /^((?:[a-z_]+=\d+)(?:,[a-z_]+=\d+)*)(?:[;\s]|$)/;
function undisposedCount(tail) {
  const census = CENSUS_RE.exec(tail.trim());
  if (census) {
    const total = [...census[1].matchAll(/=(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    // The token cannot fire with zero outstanding rows, so a zero census is a malformed string —
    // ABSENT, not converged (see the ABSENT IS NOT ZERO block above).
    return total || null;
  }
  const overflow = overflowOf(tail);
  const listed = tail.replace(OVERFLOW_RE, "").trim();
  const named = listed ? listed.split(",").map((s) => s.trim()).filter(Boolean).length : 0;
  // The token cannot fire with zero outstanding rows, so a zero here means the string reaching us
  // was cut short of its payload — ABSENT, not converged.
  return named ? named + overflow : null;
}
// A pre- archived token: `connotation_recurrent_uncited:<one result, ≤80 chars>[ (+N more)]` — ONE
// named result plus the overflow. Never split on commas: that payload is a copied result title, not a
// joined list. Nothing emits this shape any more; it is kept so a resumed run's own history still counts.
function recurrentCount(tail) {
  const named = tail.replace(OVERFLOW_RE, "").trim();
  return named ? 1 + overflowOf(tail) : null;
}

// FIRST MATCH WINS, so the live tokens lead. Every entry's `count` reads a census when there is one, and
// each is here with the throw site's literal template in hand and a test — never a find-a-digit heuristic.
const PROGRESS_TOKENS = [
  { token: "connotation_no_ruling", count: undisposedCount },        //, live
  { token: "connotation_form_damaged", count: undisposedCount },     //, live
  // — the three states split out of `connotation_no_ruling`, and they are here for the reason the
  // block above states rather than for symmetry: a token with no entry returns null from
  // progressQuantity, `progress.kind` becomes "unknown", and a seat converging 75 → 40 → 0 reads as
  // stuck — so the ladder breaks on the attempt that was working. Same census shape (`<reason>=<n>;`),
  // so the same counter. FIRST MATCH WINS on indexOf and none of these three names contains another,
  // so position among themselves is free; they sit with their family because a token added away from
  // this comment is a token added without it in view.
  // `form_untouched` signs the POPULATION, not 1 — verify.mjs emits `form_untouched=<row count>` for
  // exactly this reader, so a 75-row failure followed by `token_absent=40` reads as convergence and not
  // as a 40x regression.
  // RETIRED, kept so archived and replayed runs still count. `form_untouched` left CONNOTATION_REASONS
  // with the hand-edited form path (owner ruling 2026-08-17, recorded at contract-vocabulary.mjs:85) and
  // nothing emits it now; its subject matter is `call_never_made`. Delete the ENTRY and a resumed run's
  // own history stops counting — a dead allowlist row costs nothing, a missing one costs a ladder.
  { token: "connotation_form_untouched", count: undisposedCount },   //, retired 2026-08-17
  // — same census shape (`<reason>=<n>;`) and the same counter. It signs the POPULATION for the
  // reason stated just above: an unparseable submission recorded nothing, so every obligation is still
  // owed, and `=1` here would make the next attempt's real progress read as a regression. FIRST MATCH
  // WINS on indexOf and neither this name nor `connotation_form_untouched` contains the other.
  { token: "connotation_form_unparseable", count: undisposedCount }, //, retired 2026-08-17 (as above)
  // B — the four TRANSPORT states. Same census shape (`<reason>=<n>;`), so the same counter. Three of them
  // sign the POPULATION for the reason the two blocks above give: when a call never landed, nothing was
  // recorded, every obligation is still owed, and `=1` would make the next attempt's real progress read as
  // a regression.
  //
  // `call_partial` signs what REMAINS rather than the population, and that is not an inconsistency — it is
  // the same rule. This reader watches the residual fall, and a partial turn's residual IS what is left:
  // 25 of 74 recorded emits 49, the next attempt emits fewer, and that reads as the convergence it is.
  //
  // FIRST MATCH WINS on indexOf. None of these four contains another, and `call_` shares no prefix with
  // `form_` or with the bare row reasons, so their position relative to the family above is free.
  { token: "connotation_call_never_made", count: undisposedCount },
  { token: "connotation_call_truncated", count: undisposedCount },
  { token: "connotation_call_schema_violation", count: undisposedCount },
  { token: "connotation_call_partial", count: undisposedCount },
  // A DIFFERENT KIND OF STALE from the two above, and the distinction is the whole point of writing it
  // down. `token_absent` and `cite_absent` are still LIVE row-level reasons (CONNOTATION_REASONS carries
  // both; findConnotationViolations still pushes them) — but they never mint a TOP-LEVEL fail token any
  // more. connotationDispositionFail reports the four call_* transport states, then form_damaged, then
  // quote_unbound, and returns null; under the typed transport an unruled residual surfaces as a call
  // state instead. So these two can only ever match an ARCHIVED reason string, and a test pinning either
  // as a live token would pin nothing. Kept for exactly that archived traffic.
  { token: "connotation_token_absent", count: undisposedCount },     //, row-level only — never a top-level token
  { token: "connotation_cite_absent", count: undisposedCount },      //, row-level only — never a top-level token
  //. Without an entry here the quote ladder's residual is invisible: progressQuantity returns null,
  // `progress.kind` becomes "unknown", and a run converging 3 → 1 → 0 reads as stuck — the silent failure
  // the block above describes, on the one token added since it was written. Same census shape, so the
  // same counter. FIRST MATCH WINS on `indexOf` and this name contains neither of the two above it, so
  // the position is free; it sits with its family because a token added away from them is a token added
  // without this comment in view.
  { token: "connotation_quote_unbound", count: undisposedCount },    //, live
  // — the register coverage form, same census shape and the same reason. Without an entry here the
  // register-digest ladder's residual is invisible: progressQuantity returns null, `progress.kind`
  // becomes "unknown", and a run converging 4 → 2 → 0 reads as stuck. That is the defect exists to
  // prevent, and this stage is the one whose ladder it costs the most.
  // `coverage_form_axis_invalid` leads the two below it because FIRST MATCH WINS on `indexOf` and its
  // name CONTAINS neither of theirs — order is not load-bearing here, but keeping the three adjacent is:
  // a form token added without an entry in this table is invisible to the convergence ledger, which is
  // the silent failure the block above describes.
  { token: "coverage_form_axis_invalid", count: undisposedCount },   // fix round, live
  { token: "coverage_no_status", count: undisposedCount },           //, live
  { token: "coverage_form_damaged", count: undisposedCount },        //, live
  { token: "connotation_undisposed", count: undisposedCount },       // pre-, archived runs only
  { token: "connotation_recurrent_uncited", count: recurrentCount }, // pre-, archived runs only
];

// The reason must arrive UNTRUNCATED — feed this the fail string as thrown, never a display slice.
// Returns {token, value} or null. Never returns 0 for an absence.
export function progressQuantity(reason) {
  const text = String(reason ?? "");
  for (const { token, count } of PROGRESS_TOKENS) {
    const at = text.indexOf(`${token}:`);
    if (at < 0) continue;
    const value = count(text.slice(at + token.length + 1));
    return Number.isFinite(value) && value >= 0 ? { token, value } : null;
  }
  return null;
}

export function failureSignature(stage, reason, { codes } = {}) {
  const s = bareStage(stage);
  //: the magnitude the signature deliberately cannot carry, extracted from the UNTRUNCATED reason
  // and returned alongside it. null when this failure has no progress quantity. Recording only — `sig`
  // is byte-for-byte what it was before this field existed.
  //: the same read also carries the token's NAME out. It was already being computed here and
  // thrown away one line before it would have been logged, which is why "the classifier could not name
  // a failure the validator had named" was true and unrecorded at the same time. Recording only — it
  // reaches no branch of decideRecovery and moves no budget.
  const q = progressQuantity(reason);
  const quantity = q?.value ?? null;
  const quantityToken = q?.token ?? null;
  // — THE FAILURE'S KIND, WHICH IS NOT ITS QUANTITY, and the distinction is the whole of this fix.
  //
  // `quantityToken` names a COUNT the validator emitted ("form_damaged = 27"). The most machine-readable
  // failures this pipeline produces have no count at all — they are `<kind>:<path>`, and
  // `invalid_file:...` alone is 71 of the 76 recorded stage failures on the test instance. Those reasons
  // have a name and no number, so `progressQuantity` returns null for them and every consumer keyed on
  // the token treats the most legible failure shape there is as unnamed.
  //
  // Measured on the preserved runs: of four `class:"unknown"` classifications, TWO carry a quantity and
  // two do not — and the two that do not are exactly the `<kind>:<path>` ones, on common-law-half:a and
  // :b. They were reported nowhere.
  //
  // RECORDING ONLY. It reaches no branch of decideRecovery and moves no budget, for the reason the
  // block below `classifyFailureReason` already argues at length: any class outside
  // transient/stale/unknown gets ZERO parks, so naming this as a class would be a silent terminal — and
  // the trend rule that would have used it was withdrawn on evidence (R6: a FLAT count on a stage about
  // to succeed). Naming a failure and changing what is done about it are separate decisions, and only
  // the first is taken here.
  const kindToken = String(reason ?? "").trim().match(/^([a-z][a-z0-9_]*)\s*:/i)?.[1]?.toLowerCase() ?? null;
  // A4 (2026-07-28 postmortem): when the throw site carries structured reason CODES, sign the SORTED
  // UNIQUE CODE SET, never the prose. The gate's reason LIST grew 1→2 rows between attempts, the joined
  // prose hashed differently, and the per-signature budget was re-armed twice for the same defect.
  // Presentation drift (wording, ordering, added detail) can no longer mint a fresh signature — but a
  // genuinely NEW code set honestly does, which is correct behavior: a different set of defects IS a
  // different failure. Prose-normalized hashing stays the fallback for uncoded throws.
  const codeSet = Array.isArray(codes) ? [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))].sort() : [];
  if (codeSet.length) {
    const norm = `codes:${codeSet.join(",")}`;
    return { sig: `${s}|${createHash("sha256").update(norm).digest("hex").slice(0, 12)}`, stage: s, norm, codes: codeSet, quantity, quantityToken, kindToken };
  }
  const norm = normalizeReason(reason);
  const sig = `${s}|${createHash("sha256").update(norm).digest("hex").slice(0, 12)}`;
  return { sig, stage: s, norm, quantity, quantityToken, kindToken };
}

// ── invalid-artifact strikes (A5, 2026-07-28 postmortem) ───────────────────────────────────────────────────
// A stage that repeatedly produces an INVALID output never went terminal: the idempotency skip can't
// fire over an invalid artifact, so every resume re-ran it — and with the reclaim/resume lanes feeding
// resumes, the run looped instead of ending (the 2026-07-28 postmortem run: common-law-half:a re-failed validation on
// every resume while the operator watched "running 7/9"). This counts the TRAILING CONSECUTIVE failed
// executions of one stage from the append-only run.jsonl spine ("stage" events only — skips and other
// stages are transparent). Only CONTENT-SHAPED failures count (the caller passes an isContentShaped
// predicate — pipeline's isContentShapedFail: not transient-classified AND not fallback-eligible): a
// flapping provider, a rate-limit trail, or a timeout streak must never convert to deterministic —
// waiting/re-sampling is a real remedy there, and any infra-shaped failure in the trail breaks the
// streak. A success ends the streak too, by definition.
export function countTrailingStageStrikes(rows, stage, { isContentShaped = () => true } = {}) {
  const s = bareStage(stage);
  let count = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (!r || r.event !== "stage" || bareStage(r.stage) !== s) continue;
    if (r.ok === true) break;
    if (!isContentShaped(r.fail)) break;
    count++;
  }
  return count;
}

// ── the two park lanes: weather vs defect ────────────────────────────────────────────────────────
//
// A park bought because an UPSTREAM PROVIDER was overloaded, rate-limiting or unreachable is WEATHER:
// nothing the run produced is wrong, the run has not disproved anything about itself, and the remedy
// is time. A park bought because the run's own output could not be accepted is a DEFECT: the remedy
// is a fresh sample of the run's own work, and the budget for that is deliberately small because
// re-buying a defect is the Open Country pathology.
//
// Until this split both drew down ONE run-global counter, so weather could spend the entire defect
// budget before the run had produced a single defect. A clearance run, 2026-07-29: two upstream
// overload parks ~37 minutes apart took recovery 2/3 and 3/3, and the run then spent its remaining
// four hours one failure from terminal with several genuinely recoverable stage failures still ahead
// of it. It delivered, but by luck, not by design.
//
// The lane predicate is the SAME condition that already decides which failures may repeat a signature
// (OUTAGE_RE over a transient reason). That is on purpose, not a coincidence: "waiting is the literal
// remedy" and "this did not come out of our own output" are the same claim about the same failures,
// and two definitions of it would drift apart.
export function recoveryLaneOf(failClass, reason) {
  return failClass === "transient" && OUTAGE_RE.test(String(reason ?? "")) ? "weather" : "defect";
}

// THE WEATHER CEILING — two full per-signature ladders, and a terminal when it is spent.
//
// Not counting weather at all would be an unbounded retry against a dead provider, which is a worse
// defect than the starvation being fixed here, so the lane is bounded exactly like the other one and
// ends at terminalKind "weather-exhausted" (a real terminal: .failed, the failure notice, a human).
//
// The bound is chosen so it is computable rather than a taste: the per-signature budget already caps
// ONE weather signature at recoveryMax parks climbing 2 → 15 → 60 minutes, i.e. 77 minutes, after
// which the repeat-signature rule ends the run. A ceiling of 2 × recoveryMax therefore buys AT MOST
// two such ladders — about 154 minutes of waiting, worst case — before the run goes terminal and
// somebody is told. Six short parks against six different weather-hit stages cost ~12 minutes; the
// count is what stops the ping-pong, the per-signature ladder is what stops the loop.
//
// Derived from recoveryMax rather than read from its own environment variable, deliberately:
//   * recoveryMax = 0 (recovery switched off, as the offline harness runs) must keep weather off too,
//     and this arithmetic gives that for free;
//   * a separate knob would be a switch that could silently strand the weather lane while the defect
//     lane still parked — kill switches are retired here and availability is fail-open only. There is
//     nothing in this lane that can turn parking off on its own.
export const WEATHER_LADDERS = 2;
export const weatherCeilingFor = (recoveryMax) => Math.max(0, Number(recoveryMax) || 0) * WEATHER_LADDERS;

// Lane counts read off the append-only park history (status.json recoveryHistory), which is the only
// record that survives a park/resume cycle. Rows written before the split carry no `lane` and count
// as DEFECT — which is exactly how they were charged when they were written, so a run parked under
// the old accounting resumes with its budget unchanged instead of being silently re-scored. `total`
// is the run's own recoveryAttempts: if it outruns the history (a park recorded before the history
// existed) the shortfall is charged to the defect lane too, the conservative reading — a bookkeeping
// gap must never hand out a fresh weather budget.
export function countRecoveryLanes(history, { total = 0 } = {}) {
  const rows = Array.isArray(history) ? history : [];
  let weather = 0;
  let defect = 0;
  for (const r of rows) { if (r?.lane === "weather") weather++; else defect++; }
  const shortfall = Math.max(0, (Number(total) || 0) - (weather + defect));
  return { weather, defect: defect + shortfall };
}

// ── the recovery decision ────────────────────────────────────────────────────────────────────────

// Pure decision core for the run-level catch. Park budgets BY CLASS:
//   transient      → the full ladder (recoveryMax; re-sampling is the remedy)
//   stale          → the full ladder — a delivery-path stage was built from material that has since moved
//                    (teal-gantry: placement-inquiry vs a frame-reopened register band). The remedy is a
//                    DETERMINISTIC recompute of the stale stage, not a hope-it-resamples — so it must NOT be
//                    starved by the shared one-park "unknown" budget an unrelated earlier park already spent
//                    (teal-gantry: a register-digest park at 16:45 left priorAttempts=1, and the delivery
//                    staleness then classified "unknown" → 1 ≥ 1 → dead-ended). The repeat-signature backstop
//                    below still caps it: a resume that does not settle the SAME staleness is terminal at once,
//                    so "full ladder" here means "one real attempt, un-starved", never an unbounded loop.
//   unknown        → ONE park (the VENZY doctrine: a single fresh sample often converges)
//   deterministic  → 0 (repairs already ran at the point of defect; a re-sample re-derives the failure)
//   factual        → 0 (a human question, not a retry question)
// The budget is spent PER SIGNATURE, not per run, and the repeat backstop is the budget itself.
//
// Both halves fixed a real kill (audit 2026-07-27):
//   * budget per RUN starved an unrelated later defect — one earlier park anywhere left
//     priorAttempts=1, so a first-time "unknown" failure later in the run was refused its single
//     guaranteed fresh sample and died "exhausted" at 1 of 3. A defect that has never been sampled
//     must always get its sample; that is what the VENZY doctrine buys.
//   * an unconditional repeat-terminal nullified the transient ladder — the SECOND occurrence of a
//     provider outage went terminal ~4 minutes in, so the advertised 15/60-minute rungs never
//     existed (copper-bastion, 2026-07-22, during Corsearch 500s). Re-sampling IS the remedy for
//     transient/stale, so a repeat there consumes the next rung instead of ending the run.
// The Open Country pathology (the identical HTTP 414 bought three times) does NOT return: 414 is
// DETERMINISTIC_RE, budget 0, terminal on sight. And "unknown" keeps budget 1, so a second identical
// unknown failure is still repeat-signature terminal — a fresh sample that failed identically has
// disproved itself. `runCeiling` bounds the whole run so distinct signatures cannot ping-pong.
//
// The run-level ceiling is spent PER LANE (see recoveryLaneOf above): weather draws on
// `weatherAttempts` against `weatherCeiling`, everything else on `defectAttempts` against
// `runCeiling ?? recoveryMax`. `defectAttempts` defaults to `priorAttempts`, so a caller that has not
// been taught the lanes — and every pre-split run record — decides exactly as it did before.
//
// — the decision also REPORTS the magnitude it is deciding over (`progress`), read from this
// failure's `quantity` and the last recorded quantity for the SAME signature in the park history. It
// changes no branch below and no caller reads it as an input: the point of the issue is that the
// comparison can SEE 25 → 9 → 9 as different from 29 → 11 → 0, where today both hash identically.
// What the machinery DOES with that difference is 's decision, not this function's.
export function decideRecovery({ failClass, sig, reason = "", history = [], priorAttempts = 0, recoveryMax = 3, nonRecoverable = false, hasRunDir = true, runCeiling = null, weatherAttempts = 0, defectAttempts = null, weatherCeiling = null, quantity = null }) {
  const hist = Array.isArray(history) ? history : [];
  const sigAttempts = hist.filter((h) => h?.sig === sig).length;
  const repeat = sigAttempts > 0;
  const parkBudget = (failClass === "transient" || failClass === "stale") ? recoveryMax : failClass === "unknown" ? Math.min(1, recoveryMax) : 0;
  // WHICH failures may repeat a signature: transient AND outage-shaped (OUTAGE_RE above). Waiting is
  // the literal remedy for a provider that is down or refusing, so the second occurrence earns the
  // next rung. Everything else keeps repeat-terminal:
  //   transient-but-wedged — nonzero_exit, unparseable_json, lane_wedge, a stage that times out every
  //           time: a byte-identical repeat means it is stuck, and three parks is the Wilderness shape
  //   stale — the remedy is a deterministic recompute; if the recompute did not settle it, running
  //           it again cannot (the real fix for the observed stale kill is restamping, not retries)
  //   unknown — its one fresh sample already failed identically, so it has disproved itself
  //   deterministic/factual — budget 0, never parked at all
  const lane = recoveryLaneOf(failClass, reason);
  const mayRepeat = lane === "weather";
  // The DEFECT ceiling is UNCHANGED (recoveryMax): this change re-slices how the budget is earned, it
  // does not buy a run more parks against its own output.
  const ceiling = Number.isFinite(runCeiling) ? runCeiling : recoveryMax;
  const wCeiling = Number.isFinite(weatherCeiling) ? weatherCeiling : weatherCeilingFor(recoveryMax);
  const laneAttempts = lane === "weather" ? (Number(weatherAttempts) || 0) : (defectAttempts ?? priorAttempts);
  const laneCeiling = lane === "weather" ? wCeiling : ceiling;
  const withinSignature = (mayRepeat || !repeat) && sigAttempts < parkBudget;
  const withinRun = laneAttempts < laneCeiling;
  const recoverable = Boolean(hasRunDir) && !nonRecoverable && withinSignature && withinRun;
  const terminalKind = recoverable ? null
    : !hasRunDir ? "no-run-dir"
    : nonRecoverable ? "non-recoverable"
    : repeat && !withinSignature ? "repeat-signature"
    // The weather lane ends at a DISTINCT terminal: "the provider was still down when we ran out of
    // patience" is a different diagnosis from "this run kept breaking", and the failure notice, the
    // recurrence digest and whoever reads it must not have to guess which one happened.
    : !withinRun ? (lane === "weather" ? "weather-exhausted" : "exhausted")
    : failClass === "factual" ? "factual"
    : failClass === "deterministic" ? "deterministic"
    : "exhausted";
  // RECORDING ONLY — computed after every branch above, read by none of them. `kind` is
  // "unknown" whenever either side is absent: a failure with no quantity must never read as
  // "no-change", which is the reading that would make a converging session look stuck.
  const q = Number.isFinite(quantity) ? quantity : null;
  const priorQuantity = hist.filter((h) => h?.sig === sig && Number.isFinite(h?.quantity)).map((h) => h.quantity).pop() ?? null;
  const delta = q !== null && priorQuantity !== null ? q - priorQuantity : null;
  const progress = { quantity: q, priorQuantity, delta,
    kind: delta === null ? "unknown" : delta < 0 ? "converging" : delta > 0 ? "diverging" : "no-change" };
  // sigAttempts drives the caller's backoff rung: the point of allowing a transient repeat is that
  // it waits LONGER each time (2 → 15 → 60), never that it re-fires straight into the same outage.
  return { recoverable, parkBudget, repeat, sigAttempts, terminalKind, lane, laneAttempts, laneCeiling, progress };
}

// ── bounded repair ledger ────────────────────────────────────────────────────────────────────────

// Persistent attempt bookkeeping under _driver/repairs.json:
//   { "<repairId>:<targetKey>": { attempts, epoch, lastOutcome, ts } }
// Survives parks/resumes, so a repair that exhausted its budget stays exhausted — UNLESS the input
// it repairs legitimately changed (a new plan_version, a later recovery attempt), signalled via
// `epoch`: a different epoch re-arms the budget from zero. `log` is an optional callback (the
// pipeline passes a runLog binding) — this module never imports the logger itself.
/**
 * — THE FIVE WAYS A BOUNDED REPAIR ENDS, AND THREE OF THEM WERE ONE.
 *
 * The ladder spent three attempts on a reconciliation record it could not close, and the run ended on a
 * generic refusal. Nothing distinguished:
 *
 *   `cannot-repair`         every attempt was MEASURED and closed nothing. The repair demonstrably has
 *                           no move for this case; a fourth attempt buys delay. This is the class
 *                           asked to make visible, and it is the only one that indicts the repair.
 *   `exhausted-unmeasured`  the budget is spent and at least one attempt never measured whether it
 *                           closed anything. HONEST IGNORANCE, and it must never be laundered into
 *                           cannot-repair — an unmeasured attempt is not a failed one, and a ledger that
 *                           reports the stronger answer from silence is the disease it exists to catch.
 *   `repaired`              something closed. Partial still counts: the repair has a move.
 *   `in-budget`             attempts remain.
 *   `untried`               no row, or a row from a superseded epoch.
 *
 * PURE. Takes the persisted row, never the file.
 */
export const REPAIR_VERDICTS = Object.freeze(["untried", "in-budget", "repaired", "cannot-repair", "exhausted-unmeasured"]);

export function repairVerdict(row, { max = 1 } = {}) {
  const ceiling = Math.max(1, Number(max) || 1);
  const attempts = Number(row?.attempts) || 0;
  const measured = Number(row?.measuredAttempts) || 0;
  const closed = Number(row?.closedTotal) || 0;
  const asked = Number(row?.askedTotal) || 0;
  const exhausted = attempts >= ceiling;
  const base = { attempts, measured, closed, asked, exhausted };
  if (!row || attempts === 0) return { ...base, attempts: 0, exhausted: false, verdict: "untried" };
  if (closed > 0) return { ...base, verdict: "repaired" };
  if (!exhausted) return { ...base, verdict: "in-budget" };
  // Every attempt measured, none closed: the repair has been given its budget and has no move.
  if (measured >= attempts) return { ...base, verdict: "cannot-repair" };
  return { ...base, verdict: "exhausted-unmeasured" };
}

export function createRepairLedger(runDir, { log } = {}) {
  const file = driverDir(runDir, "repairs.json");
  const load = () => {
    try { return JSON.parse(readFileSync(file, "utf8")) ?? {}; } catch { return {}; }
  };
  const save = (o) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(o, null, 2) + "\n");
  };
  return {
    file,
    /**
     *  — "this repair cannot close this case" as a fact a reader can act on.
     *
     * The repair ladder had a case it could not close and no way to SAY so: three spent attempts and a
     * generic refusal read identically to three spent attempts on a case a fourth would have fixed.
     * Reads the durable row, so it survives a park/resume the same way the budget does.
     */
    verdict(repairId, targetKey, { max = 1, epoch } = {}) {
      const row = load()[`${repairId}:${targetKey}`];
      // A different epoch means the input legitimately changed and the budget re-armed — the old row
      // describes a different question, exactly as canAttempt already treats it.
      if (row && epoch !== undefined && row.epoch !== epoch) return repairVerdict(null, { max });
      return repairVerdict(row, { max });
    },
    canAttempt(repairId, targetKey, { max = 1, epoch } = {}) {
      const row = load()[`${repairId}:${targetKey}`];
      if (!row) return true;
      if (epoch !== undefined && row.epoch !== epoch) return true;
      return (Number(row.attempts) || 0) < max;
    },
    // — `outcome` IS THE DISPATCH, NOT THE REPAIR. It comes from `r?.ok ? "ok": …`, which is the
    // executor CALL returning; nothing here re-joins to ask whether the hole closed. On a delivered run
    // (2026-08-15) all five `repair-attempted` rows read `outcome:"ok"` while the deferred set those
    // repairs were closing grew 4 → 4 → 4 → 5 → 7. Five successful repairs, more broken after them than
    // before, and the receipt said so in a word a reader takes to mean the opposite.
    //
    // `effect` is the caller's measured answer to "did it close?", because THIS is not the layer that
    // can know — only the caller re-joins. It is `{asked, closed}`; a caller that does not measure gets
    // `effect: "unmeasured"` in the row rather than silence, so the row never reads as a verified repair
    // by omission. pipeline.mjs's `bandChanged` (10147) already had this shape right
    // (`outcome === "ok" && bandAfter != null && bandBefore !== bandAfter`); this makes it the rule rather
    // than one site's good judgment. CITED BY SYMBOL, not by number alone: the old citation pointed at a
    // `writeFileSync` three thousand lines away, and the number had been wrong long enough that the blank
    // -target check is what finally caught it rather than anyone reading it.
    // — `durationMs` is the CALLER'S measurement, because this layer cannot take one: `record` is
    // called after the dispatch has returned, so a clock started here would time the bookkeeping and
    // report it as the work. The D8 addendum measured driver compute across three seams at ~5.5 seconds
    // against 13m41s of wall; a duration this layer invented would have looked like the answer.
    record(repairId, targetKey, outcome, { epoch, detail, effect, max, durationMs } = {}) {
      const o = load();
      const key = `${repairId}:${targetKey}`;
      const prev = o[key];
      const attempts = prev && (epoch === undefined || prev.epoch === epoch) ? (Number(prev.attempts) || 0) + 1 : 1;
      // — AND THE EFFECT IS PERSISTED, NOT ONLY LOGGED. added `effect` to the log line and
      // stopped there, so the DURABLE row carried `attempts` and `lastOutcome` and nothing about whether
      // anything closed. Across a park/resume that is the whole difference between "this repair has no
      // move for this case" and "it failed three times and we cannot say why" — two facts with opposite
      // remedies, which the ledger reduced to one number. A row written before this change reports zero
      // measured attempts and is read as unmeasured rather than as cannot-repair; an old row genuinely
      // cannot say, and inferring the stronger answer from its silence is the defect one level up.
      const measuredNow = effect && Number.isFinite(effect.asked) && Number.isFinite(effect.closed);
      const carry = prev && (epoch === undefined || prev.epoch === epoch) ? prev : null;
      const measuredAttempts = (Number(carry?.measuredAttempts) || 0) + (measuredNow ? 1 : 0);
      const askedTotal = (Number(carry?.askedTotal) || 0) + (measuredNow ? effect.asked : 0);
      const closedTotal = (Number(carry?.closedTotal) || 0) + (measuredNow ? effect.closed : 0);
      const measuredMs = Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : null;
      o[key] = { attempts, ...(epoch !== undefined ? { epoch } : {}), lastOutcome: String(outcome), ts: new Date().toISOString(),
        measuredAttempts, askedTotal, closedTotal,
        // Durable as well as logged, for the reason gives about `effect`: across a park/resume the
        // log line is gone and the row is what survives. Null when the caller did not measure — never 0,
        // which would read as an instant repair.
        ...(measuredMs === null ? {} : { lastDurationMs: measuredMs }) };
      save(o);
      try {
        log?.({ event: "repair-attempted", repair: repairId, target: targetKey, dispatch: String(outcome), attempts,
          effect: measuredNow ? { asked: effect.asked, closed: effect.closed } : "unmeasured",
          // — the running totals ride every row, so a reader of ONE line can see whether this
          // repair has ever closed anything. `verdict` only when the caller named the ceiling: this
          // layer does not know the budget, and guessing one would manufacture a cannot-repair.
          measuredAttempts, closedTotal,
          // — how long the dispatch took. This row goes to run.jsonl, which the wall decomposition
          // does not read, so this field is for a person reading the log; the ATTRIBUTION is a separate
          // span row (attributed-span.mjs). Two different jobs, deliberately not conflated.
          ...(measuredMs === null ? {} : { duration_ms: measuredMs }),
          ...(max === undefined ? {} : { verdict: repairVerdict(o[key], { max }).verdict }),
          // `outcome` is KEPT, unchanged, beside the two honest fields: existing readers and every
          // archived run.jsonl keep parsing. Removing it would make this fix a second defect for
          // anyone joining old rows to new ones.
          outcome: String(outcome), ...(detail ? { detail: String(detail).slice(0, 200) } : {}) });
      } catch { /* logging must never mask the repair outcome */ }
      return attempts;
    },
  };
}
