// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/audit-view.mjs — the AUDIT CHAIN a client account may interrogate, projected.
//
// Owner ruling, 2026-08-27: "I don't see why we don't open it or just give it to clients. Ignore the call
// spend." shared/scope.mjs holds the line that ruling drew and which artifacts it opened; this file is the
// half that decides what the four STRUCTURED reads hand over — get_run, trace, decision_timeline,
// get_finding, and list_findings' raw block lists.
//
// ── WHY THIS IS A SIBLING OF lib/evidence.mjs AND NOT A COPY OF IT ───────────────────────────────────
//
// evidence.mjs is built on one rule: "Everything emitted from here is a NAMED STRUCTURED FIELD or an enum
// derived from one. There is no code path that forwards free prose." That rule is what made the evidence
// layer safe to open without anyone auditing the corpus, and it is why the audit blocks' `key_factors`,
// `notes` and `impact` are not filtered there — they are never read.
//
// This layer CANNOT hold that rule, and pretending otherwise would ship a tool that returns nothing. The
// audit trail IS prose: a chain of reasoning is the thing the owner gave away. So the rule here is the
// OTHER one the codebase already has — scrub.mjs's — and it is stated just as plainly:
//
//   Structure is an ALLOWLIST: a field travels because it is named below, never because it was present.
//   Prose is TRANSFORMED, through the report's own client-safety passes and never a second copy of them.
//
// The transform is `scrubBody` from lib/scrub.mjs, which composes the driver's `stripInternal`,
// `dropLabelledInternals`, `stripEngineInternals` and `stripTelemetry` — the same functions publish/
// render.mjs applies to the report the client already holds. A rule added in parse.mjs lands here for
// free; a rule restated here would be the drift R1 was.
//
// ── WHAT NEVER TRAVELS, and where each was ruled ─────────────────────────────────────────────────────
//
//   MODEL IDENTITY AND BILLED COUNTS. Not filtered — not in scope. events.mjs, trace.mjs and server.mjs's
//   getStages each state on their own surface that model attribution lives in get_telemetry alone, and
//   get_telemetry stays sealed. trace's `providerUsage` is the one billed field that reaches this file,
//   and it is dropped by omission below rather than by a filter, which is why there is no branch to keep
//   in step with the ledger.
//
//   THE ENGINE'S JUDGMENT OF ITS OWN OUTPUT. `withdrawn_reason` ("confabulated attribution") and the two
//   reviewer files it is read from — skeptic-flags.md, senior-eye-review.md — are the class scrub.mjs
//   settled: "internal judgment about the engine's own quality never reaches a client principal,
//   and there is nothing to transform". So the timeline's `rationale` object, which is raw text lifted
//   out of exactly those two files by makeRationale(), is dropped whole. THE VERDICT IT PRODUCED IS NOT:
//   `verdict`, `escalated`, `deliveredWithOpenQuestions` all travel. The client learns that a reviewer
//   ruled BLOCKING and which axes were escalated; they do not read our critique of our own draft.
//
//   A RAW FAILURE STRING. pipeline writes `String(e?.stack ?? e)` — absolute paths, module names, provider
//   error text. server.mjs's sanitizeRunForClient already refuses it on list_runs "or the connector
//   becomes the softer door to the same string"; the same sentence is used here, from the same constant.
//
//   A POINTER TO A SEALED FILE. trace's `judgment.refutationFile` names senior-eye-review.md, which this
//   principal may not read. A dangling pointer is worse than an omission: it invites a call that refuses.
//
// ── AND THE WITHDRAWN BLOCK STAYS DROPPED ────────────────────────────────────────────────────────────
//
// dropped withdrawn audit blocks from a client's cards, because report-data.mjs filters to live
// findings and "a withdrawn finding renders nowhere — it does not exist here either". That ruling is
// about a finding the client is never shown, and opening the audit trail does not reopen it: the block
// still describes work on a finding that renders nowhere, with both markers of its withdrawal stripped.
// So `scrubBlocks` below keeps the drop, and the raw list a client account reads is the LIVE chain.

import { scrubBody, scrubCards } from "./scrub.mjs";
import { accountMayReadArtifact } from "../../shared/scope.mjs";
import { clientFailureNote } from "../../shared/client-failure-note.mjs";   

/**
 * The one sentence a client gets in place of an engine stack. Shared with server.mjs's list_runs cut.
 *
 * — the owner's failed-run ruling. The wording now comes from shared/, because
 * this file and driver/portal-service.mjs each carried their own copy of the identical sentence and a
 * reword that fixed one left the other saying a client had been notified when nobody had.
 *
 * The brandName parameter is kept for callers, and deliberately unused: the sentence no longer names the
 * product, because naming it was what made "<BRAND> has been notified" sound like a commitment.
 */
export const CLIENT_FAILURE_NOTE = () => clientFailureNote();

const clean = (v) => (typeof v === "string" ? scrubBody(v) : v);

/** Keep exactly the named keys, in the order named, dropping any that are absent. */
function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

// ---- the audit BLOCKS (list_findings kind:*, get_finding, trace's finding leaf) --------------------
//
// A block is a flat key→string map parsed out of audit.md (parseBlocks). Its KEYS are the driver's and
// are stable; its VALUES are model prose. So the treatment is: reuse scrubCards for the key rules that
// already exist (the withdrawn drop, the tier/label/disposition strip, the resolution transforms), then
// pass every surviving string through the body transform. The second half is what the cards path does
// not need — a card's prose was written for the client — and what the audit trail does.
export function scrubBlocks(items) {
  if (!Array.isArray(items)) return items;
  return scrubCards(items).map((b) => {
    const out = {};
    for (const [k, v] of Object.entries(b)) out[k] = clean(v);
    return out;
  });
}

/**
 * get_finding — one block.
 *
 * A WITHDRAWN block scrubs away to nothing, and the choice there is 's choice: the tool itself
 * throws on a finding it cannot resolve, so returning `null` would hand a client an empty answer they
 * would believe, on the one call whose whole job is to resolve an id. It REFUSES instead, in the words
 * the record actually supports — the finding exists and was withdrawn, which is why it renders nowhere.
 */
export function accountFinding(f) {
  if (!f || typeof f !== "object") return f;
  const [only] = scrubBlocks([f]);
  if (!only) throw new Error(`finding "${f.id ?? "?"}" was withdrawn during the run and does not appear in the delivered record`);
  return only;
}

/** list_findings on the raw path — {source, kind, items}. The cards path never reaches here. */
export function accountFindingList(result) {
  if (!result || typeof result !== "object") return result;
  return { ...pick(result, ["_note", "source", "kind"]), items: scrubBlocks(result.items) };
}

// ---- get_run ---------------------------------------------------------------------------------------
//
// The lifecycle view: which stages ran, which artifacts exist, what the coverage ledger says. Model-free
// by construction (getStages: "Model identity is confined to get_telemetry — get_run is a narrative
// surface"), so what has to go is the run's INTERNAL ROUTING — `agent` (which workspace ran it), `url`
// (the staff-side link) — and the raw failure string.
const RUN_FIELDS = ["runId", "codename", "slug", "state", "product", "markName", "classes", "created",
  "updated", "delivered", "sendPending", "failedStage", "location"];
const STAGE_FIELDS = ["stage", "trigger", "ok", "attempts", "outputWritten", "summary"];

export function accountRun(result, { brandName = "The firm" } = {}) {
  if (!result || typeof result !== "object") return result;
  const run = pick(result.run, RUN_FIELDS);
  if (result.run?.state === "failed") { run.reason = CLIENT_FAILURE_NOTE(brandName); run.reasonRedacted = true; }
  return {
    run,
    // `fail` is dropped from the stage rows by omission (STAGE_FIELDS names no such key) — a stage's
    // failure text is the same engine string sanitizeRunForClient refuses. `ok:false` still says it failed.
    stages: Array.isArray(result.stages) ? result.stages.map((s) => { const r = pick(s, STAGE_FIELDS); r.summary = clean(r.summary); return r; }) : [],
    // The failover FACT, without the model pair it swapped between (the raw rows carry only stage+attempt
    // today; picking the two keys is what keeps that true if the writer ever widens).
    failover: Array.isArray(result.failover) ? result.failover.map((f) => pick(f, ["stage", "attempt"])) : [],
    // THE INVENTORY IS FILTERED TO WHAT THE CLIENT MAY OPEN, and that is not a tidiness rule.
    // artifactStatus() walks REPORTED_ARTIFACTS, which names skepticFlags, seniorEyeReview,
    // clientSummary, doubtClosure, frameDiff, placement, findings and reportOverview — every one of them
    // sealed by ACCOUNT_ARTIFACTS. Picking `name` and `exists` off those rows drops the validator's
    // failure prose and keeps a name-by-name directory of the engine's internals, which is the dangling
    // pointer this file refuses one field over at trace's `refutationFile`, forty times: it names a
    // document and invites a call that refuses. So the LIST answers the same question the read does.
    artifacts: Array.isArray(result.artifacts)
      ? result.artifacts.filter((a) => accountMayReadArtifact(a?.name)).map((a) => pick(a, ["name", "exists"]))
      : [],
    coverageSummary: result.coverageSummary ?? null,
  };
}

// ---- trace -----------------------------------------------------------------------------------------
//
// The provenance walk. `emittingStage` recurses through `upstream`, so the node projection recurses too —
// a projection that flattened at depth 1 would hand back the raw node it stopped at.
const NODE_FIELDS = ["stage", "trigger", "ok", "attempts", "output", "note", "artifact"];

function accountNode(node) {
  if (!node || typeof node !== "object") return node;
  const out = pick(node, NODE_FIELDS);
  if ("summary" in node) out.summary = clean(node.summary);
  if ("failover" in node) out.failover = node.failover ? { occurred: true, attempt: node.failover.attempt ?? null } : null;
  if (Array.isArray(node.inputs))
    out.inputs = node.inputs.map((i) => pick(i, ["name", "consumedSha", "currentSha", "changedSince"]));
  if (Array.isArray(node.upstream)) out.upstream = node.upstream.map(accountNode);
  return out;
}

export function accountTrace(result) {
  if (!result || typeof result !== "object") return result;
  if (result.error) return pick(result, ["runId", "target", "error"]);   // the resolver's own guidance, no run content
  const out = {
    ...pick(result, ["runId", "target", "mode"]),
    resolvedAs: pick(result.resolvedAs, ["kind", "stage", "fuzzy", "codeBuilt"]),
    emittingStage: accountNode(result.emittingStage),
    // `refutationFile` is dropped: it names an artifact this principal may not open.
    judgment: pick(result.judgment, ["verdict", "skepticEscalated", "deliveredWithOpenQuestions"]),
    findingsSource: result.findingsSource ?? null,
  };
  // `providerUsage` and `rawEnvelopeAvailable` are absent by omission — the first is billed counts, the
  // second answers "is the raw model envelope on disk", which is a question about our own plumbing.
  if (result.finding) out.finding = accountFinding(result.finding);
  if ("searchTerms" in result) out.searchTerms = result.searchTerms;
  if (result.record) out.record = pick(result.record, ["url", "source"]);
  if (Array.isArray(result.auditTrail)) {
    out.auditTrail = scrubBlocks(result.auditTrail);
    out.auditTrailNote = result.auditTrailNote ?? null;
  }
  // `note` is NOT forwarded, and this is the one place a raw string looked harmless and was not. trace's
  // verdict branch returns a hard-coded sentence ending "unresolved concerns are surfaced to Alex (never
  // withheld)" — an internal identity, in a literal, so no prose filter would ever have caught it: the
  // scrub transforms MODEL output, and this is ours. The fact it carries is worth keeping, so it is
  // restated here in client words rather than dropped: what the verdict is FOR.
  if (result.note) out.note = result.resolvedAs?.kind === "verdict"
    ? "The verdict gates delivery: a reviewer reads the narrative against the source records and rules CLEAR, CONDITIONAL or BLOCKING. Anything short of CLEAR sends the work back for a corrective pass, and an unresolved concern is raised rather than withheld."
    : clean(result.note);
  return out;
}

// ---- decision_timeline -----------------------------------------------------------------------------
//
// Already the narrowest of the three ("read out in front of lawyers/clients", and model-free). Two things
// still have to go: `rationale`, which is text lifted verbatim out of skeptic-flags.md and
// senior-eye-review.md, and `reason` on a run-failed row, which is the engine's stack.
//
// The entry shape is a UNION over ~15 event kinds and classify() ends in a generic passthrough, so an
// event nobody has projected yet arrives here with whatever keys it was written with. Hence an allowlist
// over the union rather than a delete-list: a new event kind is thinned to its decision word until
// someone widens this deliberately, which is the direction that fails safe.
const TIMELINE_FIELDS = ["ts", "seq", "kind", "phase", "stage", "decision", "trigger", "ok", "outputSha",
  "changedFromPrevious", "attempt", "axes", "axis", "escalated", "verdict", "display", "cause",
  "recovered", "count", "uris", "findings", "negatives", "audit", "snapshot", "resume"];

// `state` and `verdict` TRAVEL — the timeline's own conclusion, and dropping them here while
// accountTrace keeps `judgment.verdict` would have been two surfaces disagreeing about one fact.
//
// `riskLadderAvailable` and `note` do NOT, together and for one reason: the flag exists only to say
// whether `diff_artifact` could show the word-by-word change, and `diff_artifact` is sealed. A flag
// about a tool the caller cannot call is the dangling pointer this file refuses at trace's
// `refutationFile` — it names a capability and invites a call that refuses. Reopen them together if
// diff_artifact is ever ruled on.
export function accountTimeline(result, { brandName = "The firm" } = {}) {
  if (!result || typeof result !== "object") return result;
  const entry = (t) => {
    const out = pick(t, TIMELINE_FIELDS);
    // A failed ATTEMPT keeps the fact and loses the cause string; a failed RUN gets the client sentence.
    if (t.kind === "attempt" && t.fail != null) out.failed = true;
    if (t.decision === "run-failed") { out.reason = CLIENT_FAILURE_NOTE(brandName); out.reasonRedacted = true; }
    return out;
  };
  return {
    ...pick(result, ["runId", "state", "verdict", "_note"]),
    timeline: Array.isArray(result.timeline) ? result.timeline.map(entry) : [],
    verdictHistory: Array.isArray(result.verdictHistory)
      ? result.verdictHistory.map((v) => pick(v, ["ts", "kind", "verdict", "stage"]))
      : result.verdictHistory ?? null,
  };
}

// ---- WHAT-IF (owner ruling 2026-08-27) --------------------------------------------------------------
//
// The counterfactual is the second half of the same ruling, and it meets the same two seals. The PLAN
// prints what the change would cost, drawn from the prior run's telemetry — which is precisely the model
// identity and token counts get_telemetry exists to hold. What survives is what a client needs in order
// to decide: how long it took last time, how complete an answer one stage gives, what sits downstream
// that will NOT be recomputed, and whether it will hit billed external search.
//
// `wallSec` STAYS and the tokens go, and that pair is the whole judgment. A duration is a fact about the
// client's own wait; a token count is a fact about our bill. Neither is a spend control — the owner ruled
// those out and none is added here; this is the same cost/chain line the audit reads draw, applied to the
// one tool that would otherwise walk straight through it.
//
// THE MEMO KIND ADDS THREE, AND LEAVING THEM OUT BROKE IT SILENTLY (tracker issue 132). This list is
// default-deny, so a plan kind whose fields nobody added here arrives stripped rather than refused. A
// memo plan was composed correctly and reached a client missing `kind` (so it could not be told from a
// stage plan), `assumption` (so it did not say what it was about) and `parentUntouched` (so it did not
// say the report and its archive are not modified) — and that last one is the whole safety case for
// offering this on a DELIVERED report. Measured by driving a memo plan through this function, not read.
//
// All three are disclosable on the same reasoning the rest of this list already uses. `kind` is a fact
// about the client's own request; `assumption` is the client's own words reflected back, exactly as
// `instructions` already is in ASKED_FIELDS below; `parentUntouched` is our own fixed sentence and
// discloses nothing about the run.
const PLAN_FIELDS = ["runnable", "reason", "runId", "kind", "stage", "axis", "assumption", "change", "completeness",
  "affectsFinalReport", "downstreamNotRecomputed", "externalCalls", "parentUntouched", "honestyNote",
  "confirmationToken", "next"];

export function accountWhatIfPlan(result) {
  if (!result || typeof result !== "object") return result;
  const out = pick(result, PLAN_FIELDS);
  // `model` is dropped by omission — PLAN_FIELDS does not name it. The cost prior is REBUILT rather than
  // filtered, so a field added to it upstream arrives withheld instead of served.
  const prior = result.costPrior;
  if (prior) {
    out.costPrior = prior.wallSec != null
      ? { wallSec: prior.wallSec, note: "The prior run of this step took about this long; a re-run is of similar order." }
      : { note: prior.note ?? "No timing recorded for this step — how long it takes is unknown until it runs." };
  }
  return out;
}

// The enqueue acknowledgement. It is composed in whatIfEnqueue from fields this file names, so nothing is
// withheld here — it is declared so that a field added to that acknowledgement later cannot arrive
// unruled, which is what 's default-deny is for.
const QUEUED_FIELDS = ["queued", "runId", "experimentId", "stage", "axis", "queuedAt", "next"];
export const accountWhatIfQueued = (result) => (result && typeof result === "object" ? pick(result, QUEUED_FIELDS) : result);

// The result read. `diff` and `telemetryDelta` come back from the driver's compareCmd: the diff is the
// artifact text changing, which is the answer the client asked for, and the delta is a per-attempt table
// of models and token counts, which is the bill. So the first is scrubbed and the second is dropped.
const RESULT_FIELDS = ["runId", "id", "state", "note", "queuedAt", "finishedAt", "error"];
// WHAT WAS ASKED comes back with the state, and without it the listing cannot do the job its own tool
// description claims — "list every what-if asked of this run" answered with ids and states alone leaves a
// client unable to tell one experiment from another. It is REFLECTED, not disclosed: every field here is
// the client's own request coming back. `model` is projected away rather than trusted absent — a client
// cannot set it (authorize refuses the argument), so a value in this position could only have come from
// an ops-minted token, and reflecting that would put a model tier on a client surface by the back door.
const ASKED_FIELDS = ["stage", "axis", "instructions"];
const EXPERIMENT_FIELDS = ["ok", "stage", "axis", "completeness", "honestyNote", "note"];

function accountExperiment(r) {
  if (!r || typeof r !== "object") return r ?? null;
  const out = pick(r, EXPERIMENT_FIELDS);
  out.honestyNote = clean(out.honestyNote);
  if (typeof r.diff === "string") out.diff = scrubBody(r.diff);
  // `shadowDir` and `output` are internal filenames under _experiments/ that no client tool can open, and
  // `telemetryDelta` is the model-and-token table. Both absent by omission.
  return out;
}

const oneResult = (e) => {
  const out = pick(e, RESULT_FIELDS);
  if (e?.op) out.asked = pick(e.op, ASKED_FIELDS);
  // `requestedBy`, `account` and `schema` are absent by omission: the first two are the stored
  // attribution the server keeps for its own record, not something to hand back around an account.
  if ("result" in (e ?? {})) out.result = accountExperiment(e.result);
  return out;
};

export function accountWhatIfResult(result) {
  if (!result || typeof result !== "object") return result;
  if (Array.isArray(result.experiments))
    return { runId: result.runId, experiments: result.experiments.map(oneResult) };
  return oneResult(result);
}
