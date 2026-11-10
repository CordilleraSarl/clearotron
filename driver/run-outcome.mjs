// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-outcome.mjs — how a run that cannot finish is described: the failure a stage raises, the designed refusal,
// the fields that say where and why it stopped, and the packet that tells the requester.
//
// Moved out of pipeline.mjs unchanged, so the Knockout pipeline can import them without importing the clearance
// pipeline, which imports it back. pipeline.mjs exports them again for every importer that reads them there.
import { CLIENT_ACTION } from "../shared/client-failure-note.mjs";
import { batchMarkName } from "./mark-name.mjs";
import { abbrev } from "./repair-contract.mjs";
import { REFUSAL_TERMINAL_KIND, humanWait } from "./repairs.mjs";
import { reportIdentityFor } from "./search-policy.mjs";
import { whatsappRouting } from "./stages.mjs";

export class StageFailure extends Error {
  // opts (repair-first, 2026-07-05): `failClass` — "transient" | "deterministic" | "factual" — set by
  // throw sites that KNOW the ground truth (e.g. fan-in reading the band's provider error blocks,
  // screen-gate's could-not-fetch, a reasoned reviewer BLOCKING). It always wins over the text-based
  // classifyFailureReason guess in the run-level catch. `repairs` — the bounded repairs attempted at
  // the point of defect before throwing, carried into the failure packet so the notice can say what
  // the machine already tried. Both optional and backward compatible.
  // `reasonCodes` (A4, 2026-07-28 postmortem): stable machine codes for throw sites that enumerate their defects
  // (the client gate). The recovery ladder signs the sorted unique code SET instead of the prose, so a
  // reason list that grows or rewords between attempts can never re-arm a per-signature park budget.
  // `quantity`: the failure's progress count — how many of the thing are still wrong — stamped by
  // a throw site that KNOWS it exactly (the stage ladder, from the validator's own count), so the
  // run-level catch never has to re-derive it from prose. null = this failure carries no such count;
  // never 0, which would mean "nothing left" — the shape of a pass. Recording only: nothing decides on it.
  constructor(stage, reason, resetsAt, opts = {}) {
    super(`${stage}: ${reason}`); this.stage = stage; this.reason = reason; this.resetsAt = resetsAt; this.rateLimited = reason === "rate_limited";
    this.failClass = opts.failClass; this.repairs = Array.isArray(opts.repairs) ? opts.repairs : [];
    this.reasonCodes = Array.isArray(opts.reasonCodes) ? opts.reasonCodes : [];
    this.quantity = Number.isFinite(opts.quantity) ? opts.quantity : null;
    // `detail`: the OPEN-SET payload — a validator reason, a query list, a provider string — kept
    // OUT of `reason` so a renderer can show the sentence and hide the payload. The portal used to print
    // the whole interpolated string to a user: "merged half-grids failed the canonical validator
    // (connotation_undisposed:KIN-ZY wikipedia, …)". A stage-internal concept, a validator enum and six
    // raw search queries in four scripts, on a card whose reader needs one fact: it failed and it cannot
    // be resumed from here.
    //
    // A THROW SITE THAT MOVES ITS PAYLOAD HERE MUST STAMP `quantity`. repairs.mjs progressQuantity reads
    // the convergence census out of the message prose; take the census out of the message without
    // stamping the count and `progress.kind` becomes "unknown", a run converging 29 → 11 reads as
    // plateaued, and its recovery ladder ends early. Silent — the run just stops, having looked stuck.
    // That is exactly what `quantity` was added for: the site that KNOWS the count states it.
    this.detail = typeof opts.detail === "string" && opts.detail.trim() ? opts.detail.trim() : null;
    // `refusal`: THIS THROW IS A REFUSAL THE PRODUCT IS DESIGNED TO MAKE, not a fault. Only a
    // preflight that declines an ORDER against THIS DEPLOYMENT, before any spend, may stamp it — see
    // REFUSAL_TERMINAL_KIND in repairs.mjs for the boundary. It is a boolean and not a free-form kind
    // string on purpose: the throw site states the FACT, the terminal writer names the record, and a
    // call site cannot invent a fifth spelling of "refused" that no sink knows how to read.
    this.refusal = opts.refusal === true;
  }
}

/** Is this the product declining an order, rather than the engine failing? PURE — both lanes ask it. */
export const isDesignedRefusal = (e) => e instanceof StageFailure && e.refusal === true;

// T5 + repair-first phase 3 — the CODE-authored failure packet, extracted and exported (tests +
// the runner's re-park cap reuse it). The email/WhatsApp copy is keyed on terminalKind and QUOTES the
// machine reason VERBATIM: teal-causeway's notice claimed a "systemic (credentials/provider/config)"
// cause for a deterministic 414, and its confirmation brief invented a "corrupted query IDs" story —
// the notice now says only what the machine knows, and says it in the machine's own words.
/**
 * — the three terminal-reason fields status.json carries, as ONE decision in one place.
 *
 * `reason` is capped at 200 because it rides the ping. On the 2026-08-12 round that cap fell exactly
 * where the provider's verbatim error begins: status.json ended on
 * "provider error on the count probe (after one in-tool retry): " with nothing after the colon, while
 * the journal held `HTTP 400: APPLICANT_NAME - The system did not recognize the syntax`. The failure
 * taxonomy sends a diagnosing agent to status.json, so for that failure it was the one place the answer
 * was not — and the round read the cause as ABSENT and reasoned about the absence as if it were the
 * defect.
 *
 * `reasonDetail` could not have covered it: that field carries `StageFailure.detail`, and the fan-in
 * throw passes none. Widening the 200 cap was rejected — it is load-bearing for the ping, and the next
 * message longer than whatever number replaced it would reopen this silently.
 *
 * So the cut is made VISIBLE and the tail kept beside it. `reasonTruncated` is present on every terminal
 * failure, true or false: "no reasonFull key" and "nothing was cut" must be distinguishable, or an
 * absence reads as an empty cause — which is the whole defect, one level along. PURE.
 *
 * — VISIBLE IN THE STRING, not only in a sibling key. `reason` was a bare slice, so a cut sentence
 * read as a finished one. Three failed runs of 2026-08-19 ended theirs mid-path — ".../studio/clearance-se"
 * — and the reader who stat'd that directory got ENOENT and diagnosed a working mechanism as a broken
 * one. Nothing had been lost: `reasonFull` carried the whole path on all three and `reasonTruncated` was
 * true on all three. The field that gets read FIRST simply never said it was short. `abbrev` is this
 * repo's marker for exactly that — repair-contract.mjs: "COMPLETE, or VISIBLY MARKED as incomplete" —
 * and its ellipsis rides INSIDE the bound, so `reason` is still 200 characters and still load-bearing
 * for the ping. `truncated` is computed from the cap rather than from a length comparison against the
 * marked string, so the fact stays true of the SOURCE and not of whatever the marker did to it.
 */
export function terminalReasonFields(reason, { cap = 200, fullCap = 4000 } = {}) {
  const full = String(reason ?? "").replace(/\s+/g, " ").trim();
  const truncated = full.length > cap;
  return { reason: abbrev(full, cap), reasonTruncated: truncated, reasonFull: truncated ? abbrev(full, fullCap) : null };
}

// (enforcement check E11 in the family) — `reasonDetail` and `reasonQuantity` are PACKET FIELDS.
//
// The merge gate computes WHICH dictated connotation query dropped and hands it over as StageFailure.detail
// with the count as `quantity`. Before this, neither reached this packet: on E2E's preserved R1 run of 2026-08-13
// `_driver/failure.json` carried reason/reasonVerbatim/failClass/terminalKind and no payload at all, so the
// operator was told one query had dropped and never which one — E2E had to replay
// findDroppedConnotationQueries against the preserved artifacts to name it. `reasonDetail` already reached
// status.json; `reasonQuantity` reached neither file.
//
// Both are written UNCONDITIONALLY as string|null and number|null. Never omitted, never 0: "no key" and
// "this failure carries no count" are different facts, the same distinction `reasonTruncated` is written on
// every terminal failure to preserve. And per the payload stays OUT of the sentence — `whatsappText`
// and the CLIENT body are untouched; the staff body gets it in its own <pre>, beside the verbatim reason
// that body already quotes.
export function buildFailurePacket({ runId, agent, job = {}, failedStage, shortReason, reasonVerbatim, sig, failClass, terminalKind, repairs = [], priorAttempts = 0, reasonDetail = null, reasonQuantity = null, capWait = null }) {
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const detail = typeof reasonDetail === "string" && reasonDetail.trim() ? reasonDetail.trim() : null;
  const quantity = Number.isFinite(reasonQuantity) ? reasonQuantity : null;
  // WHAT FAILED, named as ALL of it. A knockout batch is one job, one run and one price over up to
  // eight names, and this said "IRONWHISK" for a batch of three — the requester was told one name had
  // failed and that nothing was delivered. Both honest readings cost money: that the other two came
  // through (they did not), or that re-ordering the named one is the fix (it re-runs one and silently
  // drops two). The SUCCESS packet from the same lane has always stated the count, which is what makes
  // this a defect rather than a house style.
  //
  // `job.marks` and the shared composer (progress.mjs), so the notice, the run's own status.json and the
  // delivered meta all spell one fact one way. A clearance job carries a single name and composes to
  // exactly what it did before.
  const mark = batchMarkName(job.marks, job.markName ?? job.name ?? job.ref ?? "the matter");
  const KIND_SENTENCES = {
    deterministic: "The same defect reproduces on every attempt — a code or data fix is needed; retrying will not help.",
    "repeat-signature": "The retry failed IDENTICALLY to the first attempt — further retries cannot help; a code or data fix is needed.",
    factual: "A factual gap the machinery could not close — this is a human decision, not a retry.",
    "non-recoverable": "A credentials/configuration cause — fix the environment, then re-trigger the run.",
    exhausted: `Automatic recovery is exhausted after ${priorAttempts} attempt${priorAttempts === 1 ? "" : "s"} — the cause looks systemic (provider/environment), not a bad sample.`,
    // The weather lane ran out: the run's own output was never the problem, an upstream provider was
    // still overloaded or refusing after the whole waiting ladder. Say that, so nobody goes hunting
    // for a defect in the run — and say that a re-trigger is the right move once the far end is back.
    // Deliberately COUNTLESS: `priorAttempts` is the run's TOTAL park count across both lanes, so
    // quoting it here as "waiting attempts" would re-conflate the two budgets in the one sentence that
    // exists to keep them apart. The surrounding copy already reports the honest total.
    "weather-exhausted": "An upstream provider stayed overloaded or unreachable through every waiting attempt this run had — nothing in the run itself failed a check. Re-trigger once the provider is healthy.",
    // — THE ONE KIND THAT IS NOT A FAULT. Every sentence above explains a break; this one has to
    // say that nothing broke, or the copy re-tells the lie the terminalKind was added to stop. The
    // remedy is never "re-trigger" and never "a code fix" — it is the order or the deployment, and the
    // verbatim reason below this line names which.
    [REFUSAL_TERMINAL_KIND]: "Nothing failed. This deployment does not serve the search that was ordered, and said so before any work was done — the reason below names what is missing and what to change. Re-running it unchanged returns the same answer.",
  };
  // ── A CAP DEATH IS A SUBSCRIPTION OUTCOME, NOT AN OUTAGE (the fourth ask) ─────────────────────────
  //
  // The weather lane carries BOTH an overloaded provider and a usage cap, and its one sentence
  // described the first: "stayed overloaded or unreachable … Re-trigger once the provider is healthy."
  // Told to somebody whose subscription cap has not reset, every clause of that is wrong — the provider
  // was healthy and answering, re-triggering now hits the same cap, and "overloaded" points the reader
  // at an availability problem they cannot act on.
  //
  // The owner pre-committed the wording watching a capped run: a cap death is reported as a
  // SUBSCRIPTION OUTCOME, NEVER AS AN ENGINE FINDING. So this names the cap, states how long the run
  // actually held out before giving up, and says plainly that nothing about the run or the mark
  // produced it.
  //
  // The elapsed wait matters as much as the cause. The cap ladder now reaches ~11h, so "3 automatic
  // recovery attempts" — which is all the surrounding copy reports — reads as a run that gave up
  // quickly when it waited most of a day. A reader deciding whether to re-trigger needs the hours.
  //
  // Falls back to the weather sentence when the history carries no cap park, so an actual outage is
  // still described as one. capWait is null in that case BY CONSTRUCTION (capWaitFrom returns null
  // rather than a zeroed object), which is what keeps this branch from claiming a cap that never was.
  const capLine = capWait && terminalKind === "weather-exhausted"
    ? `A provider's usage cap was still in force after ${humanWait(capWait.waitedMin)} of waiting across ${capWait.parks} attempt${capWait.parks === 1 ? "" : "s"} — a subscription outcome, not a finding about the run or the mark. Nothing in the run itself failed a check.${capWait.statedResets ? " The provider stated its own reset time and the run waited for it." : ""} Re-trigger once the cap has reset.`
    : null;
  const kindLine = capLine ?? KIND_SENTENCES[terminalKind] ?? "The run stopped on a technical failure; the run directory is preserved for diagnosis.";
  const attempted = repairs.length
    ? `<p>What the machine already attempted:</p><ul>${repairs.map((r) => `<li>${esc(r.repair)} → ${esc(r.outcome)}${r.target ? ` (${esc(r.target)})` : ""}</li>`).join("")}</ul>`
    : "";
  // — a designed refusal is REFUSED, not FAILED, in every string this packet composes. The packet
  // is a sink an operator reads before any other: it is the email, and it is the WhatsApp line. Stamping
  // the kind and leaving "❌ … FAILED at …" on the wire would leave the discriminator true in a field
  // and false in the only sentence anybody sees.
  const refused = terminalKind === REFUSAL_TERMINAL_KIND;
  const retryHint = refused
    ? "nothing to fix in the engine — change the order or configure this deployment"
    : terminalKind === "deterministic" || terminalKind === "repeat-signature"
      ? "retrying will not help — needs a code/data fix" : "needs human attention";
  // The payload block, staff body only. "Which one" is the question the reason cannot answer: the
  // sentence says "dropped 1 dictated connotation query", the payload names the query. Empty when the
  // throw site carried no detail — an absent block, never a heading over nothing. A refusal carries no
  // dropped-query detail, so the block renders only on the failure branch below.
  const detailBlock = detail
    ? `<p>Which one${quantity === null ? "" : ` (${quantity})`}:</p><pre style="white-space:pre-wrap">${esc(detail)}</pre>`
    : "";
  // CLIENT-STARTED runs (2026-07-29 hardening): the email lane routes to job.forwarderEmail, and for a
  // clientPrincipal run that address IS the client. The verbatim machine reason (String(e?.stack ?? e)
  // upstream — absolute paths, module names, provider error text) is exactly what every client-facing
  // listing already redacts (sanitizeRunForClient / CLIENT_FAILURE_NOTE); the failure EMAIL was the one
  // client surface still quoting it. The client gets the same neutral notice the listings use; the
  // verbatim reason, repairs and retry hints stay on the packet fields + WhatsApp (staff surfaces).
  const clientRun = job.clientPrincipal === true;
  // — WHAT FAILED, named as the thing that was ORDERED. These four strings said "Preliminary
  // clearance" whatever the request was, so a Knockout search that died at the sweep told its requester
  // a preliminary clearance had failed — a product they did not buy, under a name the offering no longer
  // sells.
  //
  // `job.product` and not the run's frozen policy, deliberately: a failure packet is built at points
  // where no policy has resolved (an admission refusal, a crash before the sidecar is written), and
  // `job.product` is the ORDER — which is exactly what a failure notice is about. An absent or unknown
  // token resolves to null, and the sentences fall back to naming no product rather than the wrong one.
  const ordered = reportIdentityFor(job.product ?? null).identity;
  const orderedIs = ordered ? `The ${ordered}` : "The search";
  const orderedFor = ordered ? `${ordered} — ${mark}` : mark;
  return {
    // `failed: true` and `kind: "run-failed"` (added by both callers) are UNCHANGED on a refusal, and
    // deliberately: they are the packet's ROUTING — "this run delivered nothing, send the no-delivery
    // notice" — and every relay, the outbox and docs/DELIVERY.md are built on them. `refused` is the
    // discriminator beside them, written true OR false on every packet for the reason: an absent key
    // must not be the only thing separating "not a refusal" from "a packet written before the field
    // existed".
    runId, agent, failed: true, refused,
    forwarder: job.forwarder, forwarderEmail: job.forwarderEmail, msgId: job.msgId,
    conversationId: job.conversationId ?? null,
    subject: clientRun
      ? `${orderedFor} — search ${refused ? "not started" : "stopped"}, nothing delivered`
      : `${orderedFor} — run ${refused ? "REFUSED" : "FAILED"}, nothing delivered`,
    emailBodyHtml: clientRun
      // — the owner's failed-run ruling. This said "<BRAND> has been notified
      // and will follow up. Nothing is needed from your side." Nobody had been notified; the box has no
      // outbox. And a client told there is nothing for them to do does not tell their operator, which
      // was the only action that would have moved it — so the sentence did not merely overclaim, it
      // stopped the thing that would have helped. One author for all three client surfaces now.
      ? `<p>${esc(orderedIs)} for <b>${esc(mark)}</b> ${refused ? "was not started, and nothing was delivered" : "stopped before it finished, and nothing was delivered"}.</p><p>${esc(CLIENT_ACTION)}</p>`
      : refused
        ? `<p>${esc(orderedIs)} for <b>${esc(mark)}</b> was REFUSED at stage <b>${esc(failedStage)}</b> before any work was done, and NOTHING was delivered.</p><p>${esc(kindLine)}</p><p>The driver reported, verbatim:</p><pre style="white-space:pre-wrap">${esc(reasonVerbatim)}</pre><p>The run directory is preserved; this is not a defect to diagnose.</p>`
        : `<p>${esc(orderedIs)} for <b>${esc(mark)}</b> FAILED at stage <b>${esc(failedStage)}</b>${priorAttempts ? ` after <b>${priorAttempts} automatic recovery attempt${priorAttempts === 1 ? "" : "s"}</b>` : ""} and NOTHING was delivered.</p><p>${esc(kindLine)}</p><p>The driver reported, verbatim:</p><pre style="white-space:pre-wrap">${esc(reasonVerbatim)}</pre>${detailBlock}${attempted}<p>The run directory is preserved for diagnosis; re-trigger the run when the cause is addressed.</p>`,
    // THE NOTICE GOES TO WHOEVER ASKED, as the completion notice does (whatsappRouting, stages.mjs): the requester's own
    // number where one is held, the gap stated where none is, and the operator's copy beside it. It went to the agent's
    // number, which every user of a deployment shares, so the operator was told of a failure the requester never heard.
    ...whatsappRouting(job, agent),
    whatsappText: refused
      ? `⛔ Clearotron search for ${mark} REFUSED at ${failedStage} [${terminalKind}]: ${shortReason} — nothing was delivered and nothing broke; ${retryHint}.`
      : `❌ Clearotron search for ${mark} FAILED at ${failedStage}${priorAttempts ? ` after ${priorAttempts} automatic recovery attempt${priorAttempts === 1 ? "" : "s"}` : ""}${terminalKind ? ` [${terminalKind}]` : ""}: ${shortReason} — nothing was delivered; ${retryHint}.`,
    markName: job.markName ?? job.name ?? null, failedStage, reason: shortReason,
    reasonVerbatim, failureSignature: sig, failClass, terminalKind, repairs, recoveryAttempts: priorAttempts,
    reasonDetail: detail, reasonQuantity: quantity,
  };
}

// The run.jsonl `stage` row's inputs[]: each DECLARED input's fingerprint plus `read` — did the settled
// turn actually open it? Exported and dependency-free (paths + the dispatch's own facts) so the honesty
// rule below is testable without a paid dispatch.
//
// `read` is THREE-VALUED and the null cases carry the whole point (post-merge audit of):
//   true  — the engine's reads gauge saw this exact path opened. Evidence; never downgraded.
//   false — the turn was offered this file and demonstrably did not open it. Only claimable when the
//           dispatch really offered it AND the gauge is complete.
//   null  — nothing can be claimed. Three ways to get here, all of them real:
//             · the engine has no reads gauge at all (reads == null — the openai-agent shape);
//             · the settled attempt was a WARM PATCH: a warm-resume shape, arrived at from the
//               other direction — the CALLER asked for a fresh dispatch and the gateway's retry ladder
//               turned attempt N into a session resume carrying only the fix instruction (gateway.mjs,
//               `warm`). The declared inputs were offered on attempt 1 and NOT re-offered on the settled
//               one, so an absent path there says nothing about whether the stage read it. Without this
//               arm the row asserted `read:false` for a file the run can PROVE it opened on attempt 1,
//               and — worse after AD-4 — stamped `followup:false, readsTruncated:false` beside it, i.e.
//               an affirmative "the gauge was trustworthy". warmEligible fires on a shape recorded at
//               ~43% of the archive corpus, so this is the common path, not an edge case;
//             · the gauge was CAPPED (readsTruncated): the list is a prefix, so an absent path proves
//               nothing at all.
// A FOLLOWUP used to be a fourth arm and is not one (A-1). The reasoning was "it resumes a session that
// already holds the files" — which the engines do not do: `resumeRef` is passed only on a warm retry and
// neither engine reads `sessionKey`, so a followup dispatch is attempt 1 of a fresh session that WAS
// offered its declared inputs. Its gauge is as groundable as any other cold dispatch's, and nulling it
// erased the measurement on exactly the population worth measuring. The caller still journals `followup`
// on the row, so the two populations remain separable by a reader.
// A `false` that is really "we could not tell" is the same defect class AD-4 exists to retire — and it
// lands in exactly the D-item record the charter routes into P2-A ("the stage largely COULD NOT read —
// fix the lookup before diagnosing discipline"). Its mirror image is just as bad and is what this change
// removes: a `null` that is really "we could tell, and it did not".
// ── — A COMPLETION ROW STATES ONE INSTANT, AND A WAVE NEEDS TWO ─────────────────────────────────
// Every wave member DOES emit a completion line — `runBatched` calls `stage()` per member and `stageOnce`
// writes its `{event:"stage"}` row unconditionally. What no row carries is a START. `appendLine` stamps
// exactly one instant, `ts`, at append time, which for a completion row is the END.
//
// Serially that is enough: the previous row's `ts` is a usable start proxy, so a stage's wall reads off
// the journal as [previous row, own row]. A WAVE destroys the proxy — N members are dispatched at one
// instant and their rows interleave by completion order, so the row before member k's row belongs to a
// sibling — and nothing replaced it. Each member's wall then degenerates to [0, the wave's own wall],
// which is verbatim what the closing round had to report: "between 0 and 10 minutes, and the journal does
// not say which. An absence, not a zero."
//
// The per-attempt log does not rescue it. `_driver/<stage>.jsonl` carries `wall`, but that is EXEC ONLY —
// `laneWaitMs` is a separate field by design, and the freshness check, the snapshot, the validator and the
// in-dispatch form repairs all sit outside it — and it carries no start instant either, so a stage cannot
// be placed on the run's timeline from it and sibling overlap stays uncomputable.
//
// THE FIELD NAMES ARE LOAD-BEARING.
//   NOT `startedAt` — `status.json.startedAt` already means the RUN's first-ever start. It is
//     append-only-by-deletion, it is backfilled by a script that SCANS run.jsonl, and run-quote,
//     consumption-ledger, run-economics and the e2e ledger all read it. A stage-scoped `startedAt` on the
//     rows that backfill scans makes a turnaround number quietly wrong months later.
//   NOT `wall` — that name already means exec-only seconds on the per-attempt row. Two surfaces spelling
//     two different facts the same way is how this class of defect gets rebuilt.
//
// `wallSec` is redundant with the pair by construction and is written anyway: the machine writes what must
// be exact, and a reader must not have to subtract ISO strings by hand. One site computes all three, so
// they cannot drift, and the tests assert that identity.
//
// THE ROW STATES FACTS AND JUDGES NOTHING. No `onCriticalPath`, no `boundedTheWave`. Which member bounded
// a wave is an inference from overlapping intervals and it belongs to the reader.
export function stageWallFields(tDispatch, tSettled = Date.now()) {
  return {
    dispatchedAt: new Date(tDispatch).toISOString(),
    settledAt: new Date(tSettled).toISOString(),
    wallSec: (tSettled - tDispatch) / 1000,
  };
}
