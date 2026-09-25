// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// e2e-first-time.mjs — "first time", read from the whole run record.
//
// THE DEFINITION (ruled 2026-09-25): a run passes first time with zero failures and zero retries of any
// kind its record shows, recoveries, re-asks and repairs included, read from the run record and never
// from the attempt count. A stage's attempt number misses most of them: a form repair turn, a warm rung
// refunded because it never reached the model, a turn rescued at its wall, a failure turned into an ok by
// quarantine, a tool call that failed inside a turn, a refused item, a follow-up turn in the same session
// and a second cycle after a recovery all leave the stage's own count where it was.
//
// WHAT COUNTS, BY NAME. Every event the run log can carry and every reason a stage can be dispatched for is
// classed below, and a test fails on any name the product writes that is not, so an event added later is
// read as nothing until someone classes it. Counted: a step, stage, check or gate that failed; anything
// asked or run again because an answer or a step was not accepted as it stood, by the model or by code; a
// recovery, park, cancel or rollback; a repair or clamp, where code changed an answer it did not accept; a
// quarantine; a refused item. Not counted: what the run does whatever the first answer was, telemetry,
// notes about the answer's content that change nothing in the run (the quality read judges those), and
// the twin record of an incident already counted under another name: one incident is one row.
//
// IT RECORDS AND NEVER GRADES. A retry can be a guard working; the harness lists each row with its kind,
// stage, engine and model and the reader decides, as the ledger beside it already does for retries. The
// engine and model ride every row, so a difference across engines stays visibly confounded.
//
// "NOT RECORDED" IS NOT ZERO. A kind the run record cannot show is named as not recorded on every line; a
// run with no model-attempt record answers "cannot tell", never "yes"; and a name this reader has not
// classed is listed, and keeps a run with nothing else from reading "yes".
//
// A pure leaf: node:fs and node:path plus shared/driver-dir.mjs, which the harness already imports, so it
// cannot drag driver.config.mjs, whose unset-env defaults are PRODUCTION, into the harness.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir, labelOfDriverFile } from "../shared/driver-dir.mjs";

// What no file of the run record holds, stated on every answer. The register's own HTTP retries are
// written to the provider call log, which is per machine, not per run; and a tool result whose text reports a
// failure while its call settles ok carries no marker the call log keeps.
export const NOT_RECORDED = [
  "register calls the provider retried inside one tool call (the call log is per machine, not per run)",
  "a tool result that reports a failure in its text while the call settles ok",
];

const FAILED = "step failed";
const REASK = "re-ask";
const RETRY = "retry";
const REPAIR = "repair";
const QUARANTINE = "quarantine";
const REFUSED = "refused item";
const RECOVERY = "recovery";

// Run-log events that count, with the kind the line lists them under. `when` narrows an event that
// counts only in one state, and a list gives each state its own kind: a summary event and a skip carry
// a failure and a designed case under one name, told apart by their fields.
export const COUNTED_EVENTS = {
  // a step, stage, check or gate that failed
  "asks-failed": FAILED, "band-shape-failed": FAILED, "band-truth-gate": FAILED, "basis-derivation-failed": FAILED,
  "basis-derivation-shortfall": FAILED, "basis-derivation-unwritable": FAILED, "commonlaw-carry-failed": FAILED,
  "commonlaw-reconciliation-bug": FAILED, "commonlaw-reconciliation-failed": FAILED, "connotation-receipts-failed": FAILED,
  "connotation-reissue-failed": FAILED, "connotation-reissue-result": { kind: FAILED, when: (e) => e.ok === false },
  "connotation-unfinished-disclosed": FAILED, "core-artifact-invalid": FAILED, "corrections-applied-failed": FAILED,
  "coverage-form-absent": FAILED, "coverage-ledger-fallback": FAILED, "coverage-ledger-render-failed": FAILED,
  "crowd-context-failed": FAILED, "delivery-stale-blocked": FAILED, "digest-flush-failed": FAILED,
  "digest-flush-timeout": FAILED, "document-coverage-render-failed": FAILED, "doubts-failed": FAILED,
  "evidence-claim-invariant": { kind: FAILED, when: (e) => e.ok === false || Number(e.violations) > 0 },
  "floor-duty-failed": FAILED, "frame-reopen-redigest-failed": FAILED, "house-element-ownership-failed": FAILED,
  "intake-asks-missing": FAILED, "invalid-artifact-strikes": FAILED, "knockout-band-checks-inert": FAILED,
  "knockout-in-use-as-unanswered": FAILED, "knockout-ladder-unreadable": FAILED, "knockout-method-checks-inert": FAILED,
  "knockout-owner-checks-failed": FAILED, "knockout-register-records-failed": FAILED, "knockout-sweep-outage": FAILED,
  "machine-qc-failed": FAILED, "named-band-invalid": FAILED, "owner-screen-failed": FAILED, "placement-carry-failed": FAILED,
  "plan-qids-provider-hard-error-deferred": FAILED, "predelivery-lint-failed": FAILED, "probe-over-cap-unreadable": FAILED,
  "profile-mismatch-probe-failed": FAILED, "recall-reconciliation-failed": FAILED,
  "recall-reconciliation-followup-exhausted": FAILED, "recall-reconciliation-positions-failed": FAILED,
  "record-carry-failed": FAILED, "record-discard-failed": FAILED, "register-digest-facts-failed": FAILED,
  "register-plan-infeasible": FAILED, "register-positions-failed": FAILED, "register-presence-failed": FAILED,
  "remedy-accounting-failed": FAILED, "report-cards-rate-limited": FAILED, "restamp-miss": FAILED,
  "reviewer-degenerate": FAILED, "salvage-lane-no-target": FAILED, "searched-jurisdictions-unresolved": FAILED,
  "skeptic-skipped": FAILED, "stage-input-over-ceiling": FAILED, "status-write-failed": FAILED,
  "stale-repair-entry-done": { kind: FAILED, when: (e) => (Array.isArray(e.failed) ? e.failed.length : Number(e.failed)) > 0 },
  // written only where the step threw
  "form-neighbourhood-skipped": FAILED, "register-plan-skipped": FAILED,
  // a stage failure is on its own record; a model that would not parse, or was never written, is only here
  "frame-diff-skipped": { kind: FAILED, when: (e) => /^model-unparseable|^no-frame-diff-model$/.test(String(e.reason ?? "")) },
  "jx-candidate-fold-skipped": { kind: FAILED, when: (e) => !isDesignedJxCause(e.cause) },
  "jx-nativeread-skipped": { kind: FAILED, when: (e) => !isDesignedJxCause(e.cause) },
  "jx-serp-grid-skipped": { kind: FAILED, when: (e) => !isDesignedJxCause(e.cause) },
  "knockout-owner-checks": { kind: FAILED, when: (e) => Number(e.unanswered) > 0 },
  "knockout-register-counts": { kind: FAILED, when: (e) => Number(e.counted) < Number(e.marks) },
  // the plain-English pass rewrote the rater's text, or failed and shipped it unrewritten
  "knockout-review": [{ kind: REPAIR, when: (e) => e.outcome === "applied" && Number(e.applied) > 0 },
    { kind: FAILED, when: (e) => !["applied", "nothing-flagged"].includes(e.outcome) }],
  "commonlaw-reconciliation": { kind: FAILED, when: (e) => e.state !== "at-or-above-floor" },
  "engine-turn-probe": { kind: FAILED, when: (e) => e.ok === false },
  // a skeptic flag on a code-side axis re-runs its plan queries through the executor
  "escalation-recheck": [{ kind: REASK, when: (e) => e.dispatched === true },
    { kind: FAILED, when: (e) => e.outcome === "repair-budget-exhausted" }],
  "skills-store": { kind: FAILED, when: (e) => e.outcome !== "pass" },
  "profile-store": { kind: FAILED, when: (e) => e.outcome !== "pass" },
  "registry-record-closure": { kind: FAILED, when: (e) => (Array.isArray(e.failed) ? e.failed.length : 0) > 0 },
  "silently-lost-findings": { kind: FAILED, when: (e) => Number(e.lost) > 0 },
  "correction-kinds": { kind: FAILED, when: (e) => e.ok === false },
  "reasoning-integrity": { kind: FAILED, when: (e) => e.ok === false },
  "screen-gate-postflush": [{ kind: FAILED, when: (e) => Number(e.count) > 0 }, { kind: REPAIR, when: (e) => e.recovered === true }],
  // a duty or carry the run could not compute, or whose arithmetic does not reconcile
  "floor-duty": { kind: FAILED, when: (e) => e.computable === false || e.reconciles === false },
  "declination-duty": { kind: FAILED, when: (e) => e.computable === false || e.reconciles === false },
  "commonlaw-carry": { kind: FAILED, when: (e) => e.computable === false },
  "placement-carry": { kind: FAILED, when: (e) => e.computable === false },
  "recall-reconciliation": { kind: FAILED, when: (e) => e.computable === false },
  "record-carry": { kind: FAILED, when: (e) => e.computable === false },
  "remedy-accounting": { kind: FAILED, when: (e) => e.computable === false },
  // asked or run again, where no dispatch records it
  "connotation-reissue": REASK, "plan-qids-missing": REASK, "plan-qids-deferred-suspect": REASK,
  "screen-gate-violation": REASK, "stage-floor-duty-rerun": REASK, "lane-wedge-retry": RETRY,
  // code changed an answer it did not accept
  "band-truth-rebuilt": REPAIR, "client-condition-dropped": REPAIR, "common-law-downgrade-clamp": REPAIR,
  "commonlaw-channels-unstated": REPAIR, "commonlaw-channels-unusable": REPAIR,
  "corrective-unnamed-removal-repaired": REPAIR, "coverage-floor-clamp": REPAIR, "jx-receipt-repaired": REPAIR,
  "knockout-next-step-removed": REPAIR, "recall-reconciliation-positions-rederived": REPAIR, "registry-auto-correct": REPAIR,
  "repair-attempted": REPAIR, "terminal-guard-clamp": REPAIR, "verdict-conditions-dropped": REPAIR,
  "verdict-hardened-by-repair": REPAIR, "verdict-rederive-repair": REPAIR,
  "common-law-half-quarantined": QUARANTINE, "coverage-ledger-quarantined": QUARANTINE,
  "findings-actions-quarantined": QUARANTINE, "named-band-state-quarantined": QUARANTINE, "quarantine": QUARANTINE,
  "taint-quarantine": QUARANTINE,
  "ask-closure-unverified": REFUSED, "doubt-closure-unverified": REFUSED, "frame-reopen-fold-refused": REFUSED,
  "jx-entry-refused": REFUSED, "knockout-register-records-refused": REFUSED, "register-xcheck-refused": REFUSED,
  "supplemental-fold-refused": REFUSED, "verdict-softening-not-adopted": REFUSED, "register-recall-refused": REFUSED,
  "auto-recovery-exhausted": RECOVERY, "auto-recovery-parked": RECOVERY, "corrective-rollback": RECOVERY,
  "parked-for-human": RECOVERY, "postponed": RECOVERY, "recovery-parked": RECOVERY, "taint-park": RECOVERY,
  "cancelled": "cancelled", "failed": "run failed", "form-repair": "form repair turn",
  "attempt-prevented": "attempt the ladder cut",
  // A rung that reached the model is an attempt past the first, which the stage record lists as a retry.
  "warm-rung": { kind: "refunded warm rung", when: (e) => e.rung_free === true },
};

// Run-log events that do not count, by why. Every name the product writes is here or above.
export const NOT_COUNTED_EVENTS = {
  "what the run does whatever the first answer was: telemetry, receipts, derivations, plans and designed skips": [
    "answer-memory", "asks", "audit", "axes", "axis-from-plan", "band-borderline", "band-shape-derived", "basis-derivation",
    "blind-frame-skipped", "case-law-decision", "case-law-trigger", "channel-coverage", "closure-partition",
    "common-law-candidates", "common-law-merged", "common-law-path", "common-law-supp-folded", 
    "commonlaw-channels-added", "connotation-receipts", 
    "corrective-worklist-source", "coverage-form-written", "coverage-judgment", "coverage-judgment-rows",
    "coverage-ledger-derived", "coverage-ledger-dropped", "coverage-ledger-rendered", "crowd-context", "crowd-context-skips",
    "customer-late-bind", "customer-late-bind-ack", "depth-ladder", "digest-batch-brief",
    "digest-coverage-form-brief", "digest-flush", "digest-queue-noop", "digest-queued", "digest-rulings-tail",
    "doctrine-write", "document-coverage-rendered", "document-growth-trip", "doubt-selection", "doubts", "draft-carry",
    "economics", "engine-build", "envelope-closed", "envelope-decision", "envelope-decision-early",
    "escalation-skipped", "experiment", "experiment-refused", 
    "form-neighbourhood-derived", "frame-diff", 
    "frame-diff-source-directives-dropped", "frame-reopen-reconcile-not-needed", "frame-reopen-skipped", "frame-web-grid",
    "framework", "grid-ledger-saved", "grid-spec", "grid-split", "grid-split-skipped", "hit-list-minted",
    "house-element-ownership", "intake-artifacts", "intake-asks", "jurisdiction-scope", "jurisdiction-scope-register-deferred",
    "jx-aim-consumed", "jx-candidate-fold", "jx-nativeread", 
    "jx-serp-grid", "jx-serp-grid-overflow", "jx-serp-grid-spec", "jx-slices-stated",
    "knockout-published", "knockout-receipts", 
    "knockout-register-records", "knockout-sweep-skipped", "knockout-sweep-start", "level-scope-note",
    "named-band-merged", "one-shot-stamp-settled", "order-probe", "output-snapshot", "owner-screen-derived",
    "placement-borderline", "placement-form-written", "plan-execution", "plan-execution-census",
    "plan-execution-refresh", "plan-qids-deferred", "probe-over-cap-undispatched", "profile", "profile-exclusion-seed",
    "profile-resolved", "profile-selection", "provider-usage", "publish-gates", "quote",
    "record-artifacts", "register-digest-facts-written",
    "register-only", "register-plan", "register-plan-axis-deferred", "register-plan-deferred-coverage",
    "register-plan-variant-dropped", "register-positions-derived", "register-presence",
    "register-presence-skipped", "register-xcheck", "run-integrity",
    "scope-facts", "scope-frontmatter", "scope-ledger-derived", "scope-ledger-skipped", "screen-gate-clean",
    "search-policy", "searched-jurisdictions", "senior-rights", "skip",
    "stage-contract", "stage-limit-derived", "stage-stamps-reconciled", "start", "supplemental-fold", "token-rollup",
    "turnaround-reconciliation", "verdict", "verdict-conditions-recorded", "verdict-frontmatter",
    "whatif-settled-on-archive", "write-up-forms",
  ],
  "a note about the answer's content that changes nothing in the run; the quality read judges it": [
    "ask-closure-mark-owed", "classifier-gap", 
    "connotation-addressed-not-discharged", "connotation-ruling-drift", "default-territory-unrecognized", "delivery-flags",
    "enforcer-signals", "findings-actions-legacy", "findings-schema-legacy", "floor-duty-undischarged",
    "frame-diff-undispatchable-disclosed", "frame-reopen-dom-unaccounted", "house-element-excluded",
    "house-element-not-applied", "owner-screen-absent", "profile-mismatch", "reasonless-exits", "screen-gate-parse-gap",
    "screen-gate-unnamed-observed", "stated-divergence-findings", "stray-artifact",
    "stray-matter", "synthesis-duty-undischarged", "verdict-blocking-delivered",
  ],
  "the twin of an incident counted under another record — its dispatch, its repair, its clamp or its failure": [
    "action-reemit", "ask-answer-reemit", "authority-write-denied", "connotation-remedy", "corrections-applied",
    "corrective-cycle-receipt", "corrective-cycle-settled", "corrective-findings-stale", "coverage-absence-rendered",
    "coverage-closure", "coverage-ledger-recovered", "delivery-stale-repair", "envelope-close-rows", "escalation-noop",
    "finding-reemit", "findings-actions-absent", "findings-schema-downlevel", "form-oracle-gap", "frame-reopen",
    "frame-reopen-reattempt", "grid-ledger-missing", "knockout-assess-invalidated", "lint-redo-skipped-structural",
    "meaning-gap-coverage", "park-resumed", "plan-qids-sticky-gap", "recall-reconciliation-unended",
    "recovery-classified", "record-discard", "screen-gate-unresolved", "skeptic-escalation", "stage-stale",
    "stale-repair-entry", "taint-disclose", "unsettled-inputs", "verdict-2", "verdict-3",
  ],
  "read from its own record: the stage records, the dispatch records and the tool-call log": [
    "attempt", "stage", "settled", "started",
  ],
  "the portal's, the profile store's or the config store's audit log, never a run log": [
    "compose-read", "demo-order", "family-group", "family-ungroup", "other", "person-add", "person-change",
    "person-remove", "plan", "plan-gate-skipped", "profile-create", "profile-create-withdrawn", "profile-save",
    "profile-update", "project-create", "project-save", "project-update", "queue-cancel", "queue-order",
    "quota-precheck-blind", "recipe-create", "recipe-update", "report-feedback", "request-error", "request-refused", "run-restore",
    "run-retire", "saved-search-save", "stop", "store-commit-failed", "trigger",
  ],
  // The recall store's, removed before this reader; older records still carry them. Its one refusal is counted above.
  "retired: older records carry them": [
    "known-conflicts-read", "known-conflicts-upsert", "known-conflicts-upsert-skipped", "recall-regression",
    "register-recall-probes",
  ],
};

// Names older records carry that the product no longer writes, so no census can find them.
export const RETIRED_EVENTS = ["known-conflicts-read", "known-conflicts-upsert", "known-conflicts-upsert-skipped",
  "recall-regression", "register-recall-probes", "register-recall-refused"];

// A stage dispatched again says why, on the run log's `stage` event. Counted: a dispatch that exists
// because an answer was not accepted as it stood.
export const COUNTED_TRIGGERS = {
  "action-reemit": REASK, "actions-missing": REASK, "ask-answer-reemit": REASK, "connotation-remedy": REASK,
  "corrective": REASK, "corrective-findings": REASK, "coverage-closure": REASK, "degenerate-reask": REASK,
  // the unit left closeable rows deferred
  "envelope": REASK,
  // the skeptic did not accept the unit's answer
  "escalation": REASK,
  "finding-reemit": REASK,
  // the blind frame or the form oracle named what the first frame and sweep missed
  "frame-reopen": REASK,
  "frame-reopen-retry": RETRY, "grid-ledger": REASK, "intake-asks-followup": REASK, "lint-repair": REPAIR,
  "plan-join": REASK, "plan-join-fresh": REASK, "schema-downlevel": REASK, "stale-repair": REPAIR,
  "stale-repair-entry": REPAIR, "taint-rerun": REASK, "verdict-recheck": REASK,
};
// The two reasons built at run time: a recall reconciliation re-asking the digest, and a flush retried.
export const TRIGGER_FAMILIES = [[/^recall-reconcile-./, REASK], [/-retry$/, RETRY]];
export const NOT_COUNTED_TRIGGERS = {
  "a first dispatch, or one the run makes whatever the first answer was": ["fresh", "skip", "late-bind", "experiment"],
  "the digest folding in re-runs, each counted where it was dispatched": ["settlement-flush", "late-flush"],
  "a follow-up message's composer or section, never a dispatch reason": ["digest-flush", "draft-carry", "envelope-close",
    "frame-reopen-directive", "recall-reconcile", "settled-coverage-facts"],
};

// Stage records written into a run after it delivered, by their own dispatcher: a what-if memo asked of an
// archived run is not the run's record.
export const OUTSIDE_THE_RUN = ["whatif-memo"];

// An event that re-runs its stage through the stage runner, so the re-run is also a second fresh
// dispatch of the same label: the event names it and the dispatch is not listed again.
const NAMES_A_FRESH_DISPATCH = new Set(["lane-wedge-retry", "stage-floor-duty-rerun"]);

// A native-language unit that did not run for a reason the design gives. Any other cause, a degraded or
// deferred unit, a throw or a corrupt fixture among them, is a failure.
const DESIGNED_JX_CAUSES = [/^CLEAROTRON_NATIVE_LANGUAGE_\w+ off$/, /^no frozen \S+ lane decision/, /^no SERP capability entry/,
  /^already ran \(frozen\)$/, /^already folded \(frozen\)$/, /^no lanes in scope/, /^frozen decision has no lanes$/,
  /^no in-scope classes/, /^no terms to dictate/];
function isDesignedJxCause(cause) { return DESIGNED_JX_CAUSES.some((re) => re.test(String(cause ?? ""))); }

const NOT_COUNTED = Symbol("not counted");
const flat = (groups) => new Set(Object.values(groups).flat());
const NOT_COUNTED_EVENT_NAMES = flat(NOT_COUNTED_EVENTS);
const NOT_COUNTED_TRIGGER_NAMES = flat(NOT_COUNTED_TRIGGERS);
const normal = (c) => (Array.isArray(c) ? c : [typeof c === "string" ? { kind: c } : c]);

/** An event's class: [{kind, when?}, …], the first that holds applying; NOT_COUNTED; or null when this reader has not classed it. */
export function classOfEvent(name) {
  const n = String(name ?? "");
  if (Object.hasOwn(COUNTED_EVENTS, n)) return normal(COUNTED_EVENTS[n]);
  return NOT_COUNTED_EVENT_NAMES.has(n) ? NOT_COUNTED : null;
}

/** A dispatch reason's class, the same way. */
export function classOfTrigger(name) {
  const n = String(name ?? "");
  if (Object.hasOwn(COUNTED_TRIGGERS, n)) return normal(COUNTED_TRIGGERS[n]);
  if (NOT_COUNTED_TRIGGER_NAMES.has(n)) return NOT_COUNTED;
  const family = TRIGGER_FAMILIES.find(([re]) => re.test(n));
  return family ? [{ kind: family[1] }] : null;
}

export { NOT_COUNTED };

const clip = (s, n = 140) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const causeOf = (e) => {
  const why = [e.reason, e.fail, e.error, e.cause, e.rule, e.action, e.repair].find((v) => typeof v === "string" && v);
  return `${e.event}${why ? `: ${why}` : ""}`;
};

/**
 * Every row of the record that keeps a run from being first time. PURE; never throws on odd input.
 *
 * @param attempts  [{stage, row, code}] — every numbered row of `_driver/<stage>.jsonl`, in file order;
 *                  `code` marks a row with no engine, a code-side step
 * @param runLog    the parsed rows of `_driver/run.jsonl`, in order
 * @param status    status.json
 * @param markers   {postponed, failed, cancelled} — the run's queue markers, parsed, or null
 * @param toolCalls the parsed rows of `_driver/tool-calls.jsonl`
 * @param discards  the parsed rows of `_driver/record-discard.jsonl`
 * @returns {{firstTime: boolean|null, rows, unclassed, codeSteps, engineRows, notRecorded}}
 */
export function firstTimeRows({ attempts = [], runLog = [], status = {}, markers = {}, toolCalls = [], discards = [] } = {}) {
  const rows = [];
  const unclassed = new Set();
  const engineOf = new Map();
  const add = (kind, stage, attempt, cause, row = null) => {
    const who = row ?? engineOf.get(stage) ?? {};
    rows.push({ kind, stage: stage ?? null, attempt: attempt ?? null, cause: clip(cause),
      engine: who.engine ?? null, model: who.modelActual ?? who.model ?? null });
  };
  let codeSteps = 0;
  let engineRows = 0;
  // A stage run again numbers its attempts from 1, so a cycle starts at a stage's first row and wherever an
  // attempt number does not rise past the row before it.
  const cycles = new Map();   // stage → [{start, after, row}]
  const prevAttempt = new Map();
  for (const { stage, row, code } of Array.isArray(attempts) ? attempts : []) {
    if (!row || typeof row !== "object" || OUTSIDE_THE_RUN.includes(stage)) continue;
    // A code-side step writes a numbered row with no engine and no verdict of its own: not an engine
    // attempt, never a pass or a failure.
    if (code || row.ok === null || row.ok === undefined) { codeSteps++; continue; }
    engineRows++;
    if (row.engine || row.modelActual || row.model) engineOf.set(stage, row);
    const n = Number(row.attempt);
    if (Number.isFinite(n)) {
      const prev = prevAttempt.get(stage);
      if (prev === undefined || n <= prev) cycles.set(stage, [...(cycles.get(stage) ?? []), { start: n, after: prev ?? null, row }]);
      prevAttempt.set(stage, n);
    }
    if (row.ok === false) add("failed attempt", stage, n, row.fail ?? "no cause recorded", row);
    else if (Number.isFinite(n) && n > 1) add("retry", stage, n, `attempt ${n} succeeded`, row);
    if (row.rescued) add("rescue", stage, n, `rescued: ${row.rescued}`, row);
    if (row.selfReportContradicted === true && row.ok !== false) add("self-report contradicted", stage, n, "the model reported done and its file said otherwise", row);
    if (Number(row.toolCallsRefused) > 0) add("refused tool call", stage, n, `${row.toolCallsRefused} tool call(s) refused in the turn`, row);
  }
  const log = Array.isArray(runLog) ? runLog : [];
  const dispatches = new Map();   // stage → the reason of each dispatch, in order
  const named = new Map();        // stage → fresh re-dispatches an event already names
  const failedSteps = [];         // dispatch records that failed: a code-side step's only record of it
  for (const e of log) {
    if (!e || typeof e !== "object") continue;
    if (e.event === "stage") {
      if (e.stage != null) dispatches.set(e.stage, [...(dispatches.get(e.stage) ?? []), e.trigger ?? "fresh"]);
      if (e.ok === false && e.stage != null) failedSteps.push(e);
      continue;
    }
    const c = classOfEvent(e.event);
    if (c === null) { unclassed.add(`event "${e.event}"`); continue; }
    const holds = c === NOT_COUNTED ? null : c.find((s) => !s.when || s.when(e));
    if (!holds) continue;
    if (NAMES_A_FRESH_DISPATCH.has(e.event) && e.stage != null) named.set(e.stage, (named.get(e.stage) ?? 0) + 1);
    add(holds.kind, e.stage ?? e.fromStage ?? null, e.attempt ?? null, causeOf(e));
  }
  // Each dispatch past a stage's first, by its reason. A stage with no engine row is a code-side step,
  // and counts neither way.
  for (const [stage, reasons] of dispatches) {
    if (OUTSIDE_THE_RUN.includes(stage)) continue;
    let fresh = 0;
    for (const t of reasons) {
      if (t === "fresh") { fresh++; continue; }
      const c = classOfTrigger(t);
      if (c === null) { unclassed.add(`dispatch reason "${t}"`); continue; }
      if (c !== NOT_COUNTED && engineOf.has(stage)) add(c[0].kind, stage, null, `dispatched again: ${t}`);
    }
    const again = Math.max(0, fresh - 1) - (named.get(stage) ?? 0);
    if (engineOf.has(stage)) for (let i = 0; i < again; i++) add("second cycle", stage, 1, "dispatched fresh again: a recovery or resume re-ran the stage");
  }
  // A step with no engine row failed: its dispatch record is the only one. An engine stage's failed
  // attempts are on its own record above.
  for (const e of failedSteps) if (!engineOf.has(e.stage) && !OUTSIDE_THE_RUN.includes(e.stage)) add(FAILED, e.stage, null, `a code-side step failed: ${e.fail ?? "no cause recorded"}`);
  // A cycle no dispatch accounts for. The first needs none: a stage cancelled mid-turn never wrote its
  // dispatch record.
  for (const [stage, cs] of cycles) {
    const unexplained = cs.length - Math.max((dispatches.get(stage) ?? []).length, 1);
    for (const c of unexplained > 0 ? cs.slice(-unexplained) : []) {
      add("second cycle", stage, c.start, `attempt ${c.start} again after attempt ${c.after}, with no dispatch recorded for it: a recovery or resume re-ran the stage`, c.row);
    }
  }
  // status.json and the markers restate what the run log records; they are read where it recorded nothing.
  const has = (kind) => rows.some((r) => r.kind === kind);
  if (!has("recovery")) {
    if (Number(status?.recoveryAttempts) > 0) add("recovery", status.failedStage ?? null, null, `status records ${status.recoveryAttempts} recovery attempt(s)`);
    else if (status?.resumedAt) add("recovery", null, null, `resumed at ${status.resumedAt}`);
    else if (markers?.postponed) add("recovery", markers.postponed.stage ?? null, null, `parked${markers.postponed.parkKind ? ` (${markers.postponed.parkKind})` : ""}`);
  }
  if (markers?.cancelled && !has("cancelled")) add("cancelled", markers.cancelled.stage ?? null, null, "the run's cancel marker");
  // One failure, whichever records name it: the run log's row and the failure marker are the same event.
  if (markers?.failed) {
    const same = rows.find((r) => r.kind === "run failed" && (r.stage ?? null) === (markers.failed.stage ?? null));
    if (same) same.cause = clip(`${same.cause} (also the failure marker)`);
    else add("run failed", markers.failed.stage ?? null, null, markers.failed.reason ?? markers.failed.terminalKind ?? "the run's failure marker");
  }
  for (const d of Array.isArray(discards) ? discards : []) {
    if (/:stage-incomplete$/.test(String(d?.reason ?? ""))) add("incomplete pass", d.stage ?? d.seam ?? null, d.pass ?? null, `${d.seam ?? "a"} pass did not complete`);
  }
  // A tool call that failed inside a turn. The call log names no stage, so each is placed by the time
  // windows of the attempts it fell in; where two concurrent stages overlap it, both are named.
  const windows = log.filter((e) => e?.event === "attempt" && e.ts && Number(e.wall) > 0)
    .map((e) => ({ stage: e.stage, attempt: e.attempt, end: Date.parse(e.ts), start: Date.parse(e.ts) - Number(e.wall) * 1000 }));
  const failedCalls = (Array.isArray(toolCalls) ? toolCalls : []).filter((c) => c?.event === "settled" && c.ok === false);
  for (const c of failedCalls) {
    const t = Date.parse(c.ts);
    const at = windows.filter((w) => t >= w.start && t <= w.end);
    const stage = at.length ? [...new Set(at.map((w) => w.stage))].join(" or ") : null;
    add("failed tool call", stage ?? "stage not recorded", at.length === 1 ? at[0].attempt : null, `${c.server ?? "?"}/${c.tool ?? "?"} settled ok:false at ${c.ts ?? "a time not recorded"}`);
  }
  const firstTime = engineRows === 0 ? null : rows.length ? false : unclassed.size ? null : true;
  return { firstTime, rows, unclassed: [...unclassed], codeSteps, engineRows, notRecorded: NOT_RECORDED };
}

/** The one line the ledger prints, then one line per row. PURE. */
export function firstTimeLines(ft) {
  const nr = `not recorded: ${ft.notRecorded.join("; ")}`;
  const code = ft.codeSteps ? ` ${ft.codeSteps} code step(s) are not engine attempts and count neither way.` : "";
  const unclassed = ft.unclassed ?? [];
  const names = unclassed.length ? ` The record also carries ${unclassed.length} name(s) this reader has not classed, read neither way: ${unclassed.join(", ")}.` : "";
  if (ft.firstTime === null && !ft.engineRows) return [`first time: CANNOT TELL — the run record holds no engine attempt row.${code} (${nr})`];
  if (ft.firstTime === null) return [`first time: CANNOT TELL — the run record shows no failure or retry this reader knows.${names}${code} (${nr})`];
  if (ft.firstTime) return [`first time: yes — the run record shows no failure, retry, repair, rescue or refusal.${code} (${nr})`];
  // The head line is the score; the rows under it are the evidence.
  const counts = new Map();
  for (const r of ft.rows) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const byKind = [...counts].map(([k, n]) => `${n} ${k}`).join(", ");
  return [`first time: no — ${ft.rows.length} row(s): ${byKind}.${names}${code} (${nr})`,
    ...ft.rows.map((r) => `    ${r.kind} · ${r.stage ?? "no stage"}${r.attempt != null ? ` attempt ${r.attempt}` : ""} · ${r.engine ?? "engine not recorded"}/${r.model ?? "model not recorded"} — ${r.cause}`)];
}

const readJsonl = (p) => {
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** The run record, read from a run directory. Absent files read as empty; the answer says what it could not see. */
export function readRunRecord(runDir) {
  const dd = driverDir(runDir);
  const attempts = [];
  let files = [];
  try { files = readdirSync(dd).filter((f) => f.endsWith(".jsonl") && !["run.jsonl", "tool-calls.jsonl", "record-discard.jsonl"].includes(f)); } catch { /* no _driver */ }
  for (const f of files.sort()) {
    const stage = labelOfDriverFile(f);
    // A model-turn record carries its engine; a numbered row with none is a code-side step, kept so it is
    // counted as one rather than dropped — the same line the ledger beside this draws.
    for (const row of readJsonl(join(dd, f))) if (Number.isFinite(Number(row?.attempt))) attempts.push({ stage, row, code: !("engine" in row) });
  }
  const marker = (name) => (existsSync(join(runDir, name)) ? (readJson(join(runDir, name)) ?? { reason: "the marker is present and not readable" }) : null);
  return {
    attempts,
    runLog: readJsonl(join(dd, "run.jsonl")),
    status: readJson(join(runDir, "status.json")) ?? {},
    markers: { postponed: marker(".postponed"), failed: marker(".failed"), cancelled: marker(".cancelled") },
    toolCalls: readJsonl(join(dd, "tool-calls.jsonl")),
    discards: readJsonl(join(dd, "record-discard.jsonl")),
  };
}
