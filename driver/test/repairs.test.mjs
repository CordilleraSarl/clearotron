// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// repairs.mjs — failure signatures, transient/deterministic classification, and the bounded repair
// ledger (repair-first doctrine, 2026-07-05). The signature tests are seeded from the REAL Wilderness
// Bound (TMP8729) park reasons: three byte-identical parks must sign identically (the repeat-signature
// terminal exists exactly for that shape), while genuinely different defects must sign apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";   // — the wiring arm reads pipeline.mjs from source
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { normalizeReason, bareStage, failureSignature, classifyFailureReason, createRepairLedger, decideRecovery, countTrailingStageStrikes, recoveryLaneOf, countRecoveryLanes, weatherCeilingFor, TRANSIENT_RE, DETERMINISTIC_RE, fanInMissingEvidence, STRUCTURAL_REFUSAL_RE, retryCannotHelpWith, unnamedStructuredFailure } from "../repairs.mjs";

// The verbatim fan-in reason from the 2026-07-05 teal-causeway .failed sentinel.
const WILDERNESS_REASON = "register plan unexecuted after followup — 2 dictated qid(s) own no band block: primary-sweep:exact:ailderness+form; primary-sweep:exact:aildernessbound+form (a clean can never ship over a slice the plan dictated and nothing ran)";

// ---- failureSignature: stability across attempts, separation across defects --------------------------

test("signature: the three byte-identical Wilderness parks sign identically", () => {
  const a = failureSignature("fan-in", WILDERNESS_REASON);
  const b = failureSignature("fan-in", WILDERNESS_REASON);
  assert.equal(a.sig, b.sig);
  assert.match(a.sig, /^fan-in\|[0-9a-f]{12}$/);
});

test("signature: volatile tokens (counts, hex ids, paths, timestamps) normalize away", () => {
  const s1 = failureSignature("fan-in", "register plan unexecuted after followup — 2 dictated qid(s) own no band block");
  const s2 = failureSignature("fan-in", "register plan unexecuted after followup — 3 dictated qid(s) own no band block");
  assert.equal(s1.sig, s2.sig, "a count change is the same defect, not a new one");
  const h1 = failureSignature("deliver", "send failed for msgId AC4353CE369A086BAD4E598FE31EA16A");
  const h2 = failureSignature("deliver", "send failed for msgId 00FF12AB34CD56EF78AB90CD12EF34AB");
  assert.equal(h1.sig, h2.sig, "hex ids normalize to the same skeleton");
  const p1 = failureSignature("matter-frame", "missing_file: /home/x/agentplatform/workspace/studio/run-a/matter-context.md");
  const p2 = failureSignature("matter-frame", "missing_file: /home/y/other/studio/run-b/matter-context.md");
  assert.equal(p1.sig, p2.sig, "paths reduce to their basename");
});

test("signature: different stages and different defects sign apart", () => {
  const fanIn = failureSignature("fan-in", WILDERNESS_REASON);
  const other = failureSignature("screen-gate", WILDERNESS_REASON);
  assert.notEqual(fanIn.sig, other.sig);
  const collapsed = failureSignature("fan-in", "collapsed named band: slice searched but lost (total_hits>0, zero records)");
  assert.notEqual(fanIn.sig, collapsed.sig);
});

test("signature: decorated stage labels collapse to their bare stage (not a resume key)", () => {
  assert.equal(bareStage("synthesis(blocking)"), "synthesis");
  assert.equal(bareStage("register-unit:primary-sweep(plan-join)"), "register-unit:primary-sweep");
  assert.equal(failureSignature("synthesis(blocking)", "x").sig, failureSignature("synthesis", "x").sig);
});

test("normalizeReason: caps at the 200-char park-log truncation window (160)", () => {
  const norm = normalizeReason("z".repeat(500));
  assert.ok(norm.length <= 160);
});

// ---- classifyFailureReason: the class table -----------------------------------------------------------

test("classify: gateway transient fail strings keep the full recovery ladder", () => {
  for (const r of ["timeout", "lane_wedge", "embedded_fallback", "nonzero_exit_1", "unparseable_json", "status_timeout", "status_overloaded", "rate_limited"]) {
    assert.equal(classifyFailureReason(r), "transient", r);
  }
  assert.equal(classifyFailureReason("provider error during enumeration (page 3): HTTP 503 upstream unavailable"), "transient");
});

test("classify: request-shape provider 4xx and the fan-in plan family are deterministic", () => {
  assert.equal(classifyFailureReason(WILDERNESS_REASON), "deterministic");
  assert.equal(classifyFailureReason("provider error (after one in-tool retry): ERROR: corsearch_search HTTP 414 for query==name:`ailderness`…"), "deterministic");
  assert.equal(classifyFailureReason("HTTP 404 record not found"), "deterministic");
  assert.equal(classifyFailureReason("collapsed named band: primary-sweep slice searched but lost"), "deterministic");
  assert.equal(classifyFailureReason("common-law grid_join_missing: 3 term×platform cells absent"), "deterministic");
});

test("classify: 408/429 are pressure, not request-shape — never deterministic", () => {
  assert.notEqual(classifyFailureReason("HTTP 408 request timeout"), "deterministic");
  assert.notEqual(classifyFailureReason("HTTP 429 too many requests"), "deterministic");
});

test("classify: content/validator rejects stay 'unknown' — the VENZY re-sample doctrine", () => {
  // The VENZY bake run's corrective re-synthesis died on model vocabulary misses and a fresh resume
  // WOULD have converged — invalid_file/parser tokens must NOT be text-classified deterministic.
  for (const r of [
    "invalid_file:register-findings.md:findings_unparseable",
    "invalid_file:coverage-ledger.json:coverage_key_unknown",
    "named artifact failed strict re-parse: findings_rated_under_mismatch",
    "some brand-new failure text nobody has seen before",
  ]) assert.equal(classifyFailureReason(r), "unknown", r);
});

test("classify: TRANSIENT wins when a mixed message contains both classes (safety bias to retry)", () => {
  assert.equal(classifyFailureReason("axis errors: qid a → timeout; qid b → HTTP 414 URI too long"), "transient");
});

// ---- decideRecovery: the park-budget matrix -----------------------------------------------------------

test("decideRecovery: transient keeps the full ladder; unknown gets exactly one park PER DEFECT", () => {
  const base = { sig: "s|abc", history: [], recoveryMax: 3 };
  assert.equal(decideRecovery({ ...base, failClass: "transient", priorAttempts: 2 }).recoverable, true);
  assert.equal(decideRecovery({ ...base, failClass: "transient", priorAttempts: 3 }).terminalKind, "exhausted",
    "the run-global ceiling is unchanged at recoveryMax");
  assert.equal(decideRecovery({ ...base, failClass: "unknown", priorAttempts: 0 }).recoverable, true, "one fresh sample — the VENZY doctrine");
  // CHANGED 2026-07-27 (audit): priorAttempts=1 with an EMPTY history is an unrelated earlier park —
  // this defect has never been sampled, so refusing it was the starvation bug (a run died "exhausted"
  // with zero attempts at the failure that actually killed it). The one-park rule is per signature.
  assert.equal(decideRecovery({ ...base, failClass: "unknown", priorAttempts: 1 }).recoverable, true,
    "an unrelated earlier park must not spend THIS defect's single sample");
  assert.equal(decideRecovery({ ...base, failClass: "unknown", priorAttempts: 1, history: [{ sig: "s|abc" }] }).terminalKind,
    "repeat-signature", "but a second identical unknown failure has disproved itself");
});

test("decideRecovery: a repeated TRANSIENT consumes the next ladder rung instead of ending the run", () => {
  // copper-bastion, 2026-07-22: a Corsearch outage parked once (2 min), resumed into the still-dead
  // provider, re-derived the byte-identical reason, and went terminal ~4 minutes in — so the
  // advertised 15- and 60-minute rungs never existed for the failure class whose remedy IS waiting.
  const sig = "fan-in|6b3148456539";
  const reason = "register_execute_plan failed: HTTP 500 from provider";   // outage-shaped: waiting IS the remedy
  const one = decideRecovery({ failClass: "transient", sig, reason, history: [{ sig }], priorAttempts: 1, recoveryMax: 3 });
  assert.equal(one.recoverable, true, "second occurrence of an outage still parks");
  assert.equal(one.sigAttempts, 1, "and the rung follows this signature's own park count");
  const two = decideRecovery({ failClass: "transient", sig, reason, history: [{ sig }, { sig }], priorAttempts: 2, recoveryMax: 3 });
  assert.equal(two.recoverable, true);
  assert.equal(two.sigAttempts, 2, "→ the 60-minute rung");
  // bounded: the budget is spent, so the fourth occurrence is terminal — never an unbounded loop.
  const three = decideRecovery({ failClass: "transient", sig, reason, history: [{ sig }, { sig }, { sig }], priorAttempts: 3, recoveryMax: 3 });
  assert.equal(three.recoverable, false);
  assert.equal(three.terminalKind, "repeat-signature");
  // and the Open Country case is untouched: HTTP 414 classifies deterministic, budget 0.
  assert.equal(classifyFailureReason("register_search failed: HTTP 414 uri too long"), "deterministic");
  assert.equal(decideRecovery({ failClass: "deterministic", sig, history: [], priorAttempts: 0, recoveryMax: 3 }).recoverable, false,
    "the pathology that motivated the repeat rule is caught by its CLASS, not by the repeat check");
});

test("normalizeReason: two failures that differ only past the 160-char cap sign differently", () => {
  // The fan-in template prefix is ~96 chars, so the distinguishing tail (which slice was missing)
  // fell beyond the cap and two different failures both signed fan-in|6b3148456539.
  const head = "register band for axis primary-sweep own no band block for the dictated plan qids and the followup dispatch did not produce them either; ";
  const a = head + "missing qid alpha-one-two-three-four";
  const b = head + "missing qid bravo-nine-eight-seven-six";
  assert.notEqual(failureSignature("fan-in", a).sig, failureSignature("fan-in", b).sig, "different defects must not read as a repeat");
  assert.equal(failureSignature("fan-in", a).sig, failureSignature("fan-in", a).sig, "and the same defect still signs identically");
  // short reasons are untouched — historical rows recompute exactly as before
  assert.equal(normalizeReason("timeout after 30s"), "timeout after Ns");
});

test("decideRecovery: 'stale' gets the full ladder, un-starved by an unrelated prior park (teal-gantry)", () => {
  const base = { sig: "delivery|43e557058fc1", history: [{ sig: "register-digest|8616340245fc", attempt: 1 }], recoveryMax: 3 };
  // teal-gantry: a register-digest park already spent one attempt; the delivery staleness must still recover.
  const d = decideRecovery({ ...base, failClass: "stale", priorAttempts: 1 });
  assert.equal(d.parkBudget, 3, "full ladder, not the shared one-park unknown budget");
  assert.equal(d.recoverable, true, "1 unrelated prior park must not starve a deterministic recompute");
  // The same defect classed 'unknown' used to dead-end here purely because an UNRELATED stage had
  // parked once. Since 2026-07-27 the one-park rule is per signature, so it now gets its single
  // fresh sample too — the stale class still matters (full ladder vs one park), but starvation is
  // no longer the thing that distinguishes them.
  assert.equal(decideRecovery({ ...base, failClass: "unknown", priorAttempts: 1 }).recoverable, true);
  assert.equal(decideRecovery({ ...base, failClass: "unknown", priorAttempts: 1 }).parkBudget, 1, "…but only one, where stale gets three");
  // but the repeat-signature backstop still caps 'stale': a resume that re-hits the SAME staleness is terminal.
  const repeat = decideRecovery({ failClass: "stale", sig: "delivery|43e557058fc1", history: [{ sig: "delivery|43e557058fc1", attempt: 2 }], priorAttempts: 2, recoveryMax: 3 });
  assert.equal(repeat.terminalKind, "repeat-signature", "never an unbounded loop");
});

test("decideRecovery: deterministic and factual never park — repairs already ran at the defect", () => {
  const base = { sig: "s|abc", history: [], priorAttempts: 0, recoveryMax: 3 };
  const det = decideRecovery({ ...base, failClass: "deterministic" });
  assert.equal(det.recoverable, false);
  assert.equal(det.terminalKind, "deterministic");
  const fact = decideRecovery({ ...base, failClass: "factual" });
  assert.equal(fact.recoverable, false);
  assert.equal(fact.terminalKind, "factual");
});

test("decideRecovery: a repeating signature is terminal for every class EXCEPT transient — the Wilderness backstop", () => {
  // CHANGED 2026-07-27 (audit): transient was moved OUT of the unconditional repeat-terminal because
  // waiting is the literal remedy for an outage — see the ladder-rung test above. The backstop the
  // Open Country case actually needs is its CLASS (HTTP 414 → deterministic → budget 0), which
  // is asserted there. Every other class still dies on the second identical failure:
  for (const failClass of ["unknown", "stale"]) {
    const d = decideRecovery({ failClass, sig: "fan-in|deadbeef1234", history: [{ sig: "fan-in|deadbeef1234", attempt: 1 }], priorAttempts: 1, recoveryMax: 3 });
    assert.equal(d.recoverable, false, `${failClass} must not buy the same wall twice`);
    assert.equal(d.repeat, true);
    assert.equal(d.terminalKind, "repeat-signature");
  }
  // …but a DIFFERENT signature on attempt 2 still parks (the failure moved — progress, not a loop)
  const moved = decideRecovery({ failClass: "transient", sig: "synthesis|0123456789ab", history: [{ sig: "fan-in|deadbeef1234", attempt: 1 }], priorAttempts: 1, recoveryMax: 3 });
  assert.equal(moved.recoverable, true);
});

test("decideRecovery: denylist and missing run dir stay terminal; recoveryMax=0 disables all parking", () => {
  assert.equal(decideRecovery({ failClass: "transient", sig: "s|a", nonRecoverable: true, recoveryMax: 3 }).terminalKind, "non-recoverable");
  assert.equal(decideRecovery({ failClass: "transient", sig: "s|a", hasRunDir: false, recoveryMax: 3 }).terminalKind, "no-run-dir");
  assert.equal(decideRecovery({ failClass: "transient", sig: "s|a", recoveryMax: 0 }).recoverable, false, "harness runs with recovery off stay terminal");
  assert.equal(decideRecovery({ failClass: "unknown", sig: "s|a", recoveryMax: 0 }).recoverable, false);
});

// ---- createRepairLedger: bounded attempts, epoch re-arm, persistence ----------------------------------

test("ledger: bounds attempts, persists across instances, re-arms on a new epoch", () => {
  const runDir = mkdtempSync(join(tmpdir(), "repairs-ledger-"));
  const events = [];
  const ledger = createRepairLedger(runDir, { log: (o) => events.push(o) });

  assert.equal(ledger.canAttempt("plan-direct-execute", "primary-sweep:1", { max: 2, epoch: 1 }), true);
  ledger.record("plan-direct-execute", "primary-sweep:1", "failed", { epoch: 1 });
  assert.equal(ledger.canAttempt("plan-direct-execute", "primary-sweep:1", { max: 2, epoch: 1 }), true, "1 of 2 spent");
  ledger.record("plan-direct-execute", "primary-sweep:1", "failed", { epoch: 1 });
  assert.equal(ledger.canAttempt("plan-direct-execute", "primary-sweep:1", { max: 2, epoch: 1 }), false, "budget exhausted");

  // A park/resume re-opens the ledger — exhaustion must survive.
  const reopened = createRepairLedger(runDir);
  assert.equal(reopened.canAttempt("plan-direct-execute", "primary-sweep:1", { max: 2, epoch: 1 }), false, "exhaustion survives resume");

  // The input legitimately changed (new plan_version / recovery attempt) — budget re-arms from zero.
  assert.equal(reopened.canAttempt("plan-direct-execute", "primary-sweep:1", { max: 2, epoch: 2 }), true, "new epoch re-arms");
  const attempts = reopened.record("plan-direct-execute", "primary-sweep:1", "ok", { epoch: 2 });
  assert.equal(attempts, 1, "epoch change resets the count");

  // Different targets never share a budget.
  assert.equal(reopened.canAttempt("plan-direct-execute", "device-mark:1", { max: 1, epoch: 1 }), true);

  // The file is the durable record and the log callback saw every attempt.
  assert.ok(existsSync(driverDir(runDir, "repairs.json")));
  const persisted = JSON.parse(readFileSync(driverDir(runDir, "repairs.json"), "utf8"));
  assert.equal(persisted["plan-direct-execute:primary-sweep:1"].attempts, 1);
  assert.equal(persisted["plan-direct-execute:primary-sweep:1"].epoch, 2);
  assert.equal(events.length, 2, "log callback fired per record() on the first instance");
  assert.equal(events[0].event, "repair-attempted");
});

test("ledger: a throwing log callback never masks the repair outcome", () => {
  const runDir = mkdtempSync(join(tmpdir(), "repairs-ledger-"));
  const ledger = createRepairLedger(runDir, { log: () => { throw new Error("logger down"); } });
  assert.equal(ledger.record("x", "y", "ok"), 1, "record survives a dead logger");
});

// ---- regex hygiene: the two classes never overlap on their own tokens ---------------------------------

test("class regexes: no token matches both classes", () => {
  for (const t of ["timeout", "lane_wedge", "unparseable_json", "status_overloaded", "HTTP 503"]) {
    assert.equal(DETERMINISTIC_RE.test(t), false, `${t} must not be deterministic`);
  }
  for (const t of ["HTTP 414", "uri too long", "own no band block", "grid_join_missing", "plan-defect: wildcard-shaped term"]) {
    assert.equal(TRANSIENT_RE.test(t), false, `${t} must not be transient`);
  }
});

// PR-1 (A1): the executor's plan-defect refusal (providers/_shared/execute-plan.mjs) is derived from
// the FROZEN plan's own bytes — a re-sample re-derives the identical refusal, so parking is futile.
test("plan-defect classifies deterministic — no park ladder against a refusal that cannot change", () => {
  const reason = 'plan-defect: wildcard-shaped term "TIKI*" under literal predicate "exact" — slice NOT dispatched (a literal search here would be a false clean)';
  assert.equal(classifyFailureReason(reason), "deterministic");
  assert.equal(DETERMINISTIC_RE.test(reason), true);
});

test("decideRecovery: only OUTAGE-shaped transients may repeat — a wedged stage still dies on the second identical failure", () => {
  const sig = "matter-frame|deadbeef1234";
  const hist = [{ sig }];
  // weather: the far end is down/refusing, waiting is the remedy → climbs the ladder
  for (const reason of ["provider returned HTTP 503", "HTTP 429 rate limited", "connect ECONNREFUSED 10.0.0.1:443", "socket hang up"]) {
    assert.equal(decideRecovery({ failClass: "transient", sig, reason, history: hist, priorAttempts: 1, recoveryMax: 3 }).recoverable, true, `outage should re-park: ${reason}`);
  }
  // wedge: it fails identically because it is STUCK — three parks over ~77 min is the Wilderness shape
  for (const reason of ["nonzero_exit (exit 1)", "unparseable_json from the turn", "lane_wedge detected", "embedded_fallback transport"]) {
    const d = decideRecovery({ failClass: "transient", sig, reason, history: hist, priorAttempts: 1, recoveryMax: 3 });
    assert.equal(d.recoverable, false, `wedge must stay terminal: ${reason}`);
    assert.equal(d.terminalKind, "repeat-signature");
  }
  // and the FIRST sighting of a wedge still parks once — this only governs repeats
  assert.equal(decideRecovery({ failClass: "transient", sig, reason: "nonzero_exit (exit 1)", history: [], priorAttempts: 0, recoveryMax: 3 }).recoverable, true);
});

// ---- A4 (2026-07-28 postmortem): code-set signatures — presentation drift can't re-arm a budget ----------------

test("signature: reason CODES sign on the sorted unique set — order, duplicates and prose drift are invisible", () => {
  const a = failureSignature("delivery", "the report can't be relied on: reason one", { codes: ["lint:registry-arithmetic", "findings-stale"] });
  const b = failureSignature("delivery", "totally different prose, same defects, more words", { codes: ["findings-stale", "lint:registry-arithmetic", "findings-stale"] });
  assert.equal(a.sig, b.sig, "same code set ⇒ same signature, whatever the prose or ordering did");
  assert.deepEqual(a.codes, ["findings-stale", "lint:registry-arithmetic"], "the sorted unique set is returned for the event log");
  assert.match(a.sig, /^delivery\|[0-9a-f]{12}$/);
});

test("signature: a genuinely NEW code set honestly mints a new signature (that is a different failure)", () => {
  const one = failureSignature("delivery", "x", { codes: ["lint:registry-arithmetic"] });
  const two = failureSignature("delivery", "x", { codes: ["lint:registry-arithmetic", "lint:registry-record-match"] });
  assert.notEqual(one.sig, two.sig);
});

test("signature: the reason-drift evasion is closed — a reason LIST that grows in prose but not in codes signs identically", () => {
  // attempt 1: one gate reason; attempt 2: the same defect described with an extra prose row appended.
  const first = failureSignature("delivery", "the report can't be relied on as delivered: counts do not add up — re-run needed", { codes: ["lint:registry-arithmetic"] });
  const second = failureSignature("delivery", "the report can't be relied on as delivered: counts do not add up; and here is a second sentence about the same counts — re-run needed", { codes: ["lint:registry-arithmetic"] });
  assert.equal(first.sig, second.sig);
});

test("signature: empty/absent codes fall back to prose-normalized hashing byte-identically", () => {
  const plain = failureSignature("fan-in", WILDERNESS_REASON);
  assert.equal(failureSignature("fan-in", WILDERNESS_REASON, { codes: [] }).sig, plain.sig);
  assert.equal(failureSignature("fan-in", WILDERNESS_REASON, { codes: undefined }).sig, plain.sig);
  assert.equal(failureSignature("fan-in", WILDERNESS_REASON, {}).sig, plain.sig);
});

// ---- A5 (2026-07-28 postmortem): invalid-artifact strikes — trailing consecutive content-shaped failures -------

const isContentShaped = (f) => !/^timeout$|^nonzero_exit/.test(String(f ?? ""));

test("strikes: trailing consecutive failures of ONE stage count; other stages and skips are transparent", () => {
  const rows = [
    { event: "stage", stage: "matter-frame", ok: true },
    { event: "stage", stage: "common-law-half:a", ok: false, fail: "invalid_file:missing:audit-trail" },
    { event: "stage", stage: "register-unit:primary-sweep", ok: true },   // another stage — transparent
    { event: "skip", stage: "common-law-half:a" },                        // not a "stage" row — transparent
    { event: "stage", stage: "common-law-half:a", ok: false, fail: "invalid_file:missing:audit-trail" },
    { event: "stage", stage: "common-law-half:a", ok: false, fail: "invalid_file:missing:audit-trail" },
  ];
  assert.equal(countTrailingStageStrikes(rows, "common-law-half:a", { isContentShaped }), 3);
  assert.equal(countTrailingStageStrikes(rows, "register-unit:primary-sweep", { isContentShaped }), 0, "a stage whose last row succeeded has no strikes");
});

test("strikes: a SUCCESS resets the streak — only the trailing run of failures counts", () => {
  const rows = [
    { event: "stage", stage: "synthesis", ok: false, fail: "invalid_file:x" },
    { event: "stage", stage: "synthesis", ok: false, fail: "invalid_file:x" },
    { event: "stage", stage: "synthesis", ok: true },
    { event: "stage", stage: "synthesis", ok: false, fail: "invalid_file:x" },
  ];
  assert.equal(countTrailingStageStrikes(rows, "synthesis", { isContentShaped }), 1);
});

test("strikes: an infra-shaped failure breaks the streak — a flapping provider never converts to deterministic", () => {
  const rows = [
    { event: "stage", stage: "synthesis", ok: false, fail: "invalid_file:x" },
    { event: "stage", stage: "synthesis", ok: false, fail: "timeout" },      // weather, not content
    { event: "stage", stage: "synthesis", ok: false, fail: "invalid_file:x" },
  ];
  assert.equal(countTrailingStageStrikes(rows, "synthesis", { isContentShaped }), 1, "the timeout under the trailing failure ends the count");
});

test("strikes: the SHIPPED predicate (isContentShapedFail) — rate-limit / transient weather in the trail breaks the streak", async () => {
  // The hand-rolled predicates above document the counting mechanics; THIS test pins the predicate the
  // pipeline actually passes. The trail below is the subscription-cap shape: two rate_limited stage rows
  // (each postponed+resumed) under one first-time validation failure. rate_limited is NOT in the
  // model-fallback token set, so a !isFallbackEligible-only predicate counts it as a content strike and
  // a NEVER-re-sampled content failure reads as 3 strikes → terminal. The real predicate must break the
  // streak on anything classifyFailureReason calls transient — sampling noise, not a content verdict.
  const { isContentShapedFail } = await import("../pipeline.mjs");
  const rows = [
    { event: "stage", stage: "register-digest", ok: false, fail: "rate_limited" },
    { event: "stage", stage: "register-digest", ok: false, fail: "rate_limited" },
    { event: "stage", stage: "register-digest", ok: false, fail: "invalid_file:register-findings.md:coverage-ledger" },
  ];
  assert.equal(countTrailingStageStrikes(rows, "register-digest", { isContentShaped: isContentShapedFail }), 1,
    "a first-time content failure over a rate-limit trail is 1 strike, never terminal");
  // the other transient shapes the trail really carries: bare unparseable_json and prose transport causes
  assert.equal(isContentShapedFail("unparseable_json"), false, "unparseable_json is sampling noise (TRANSIENT_RE)");
  assert.equal(isContentShapedFail("saturation-probe direct execution failed: HTTP 502 Bad Gateway"), false,
    "prose transport causes from code-side units are infra weather");
  assert.equal(isContentShapedFail("timeout"), false, "fallback-eligible tokens stay infra-shaped");
  // and genuine content verdicts still count
  assert.equal(isContentShapedFail("invalid_file:x/narrative.md:finding_registration_invalid"), true);
  assert.equal(isContentShapedFail("missing_file:x"), true);
});

test("strikes: stage decoration is presentation, the axis suffix is identity (bareStage rules)", () => {
  const rows = [
    { event: "stage", stage: "register-unit:primary-sweep", ok: false, fail: "invalid_file:x" },
    { event: "stage", stage: "register-unit:incumbent-class", ok: false, fail: "invalid_file:x" },
  ];
  assert.equal(countTrailingStageStrikes(rows, "register-unit:primary-sweep(plan-join)", { isContentShaped }), 1, "decoration stripped; the sibling axis is a different stage");
  assert.equal(countTrailingStageStrikes([], "anything", { isContentShaped }), 0);
  assert.equal(countTrailingStageStrikes(null, "anything", { isContentShaped }), 0);
});

// ---- the two park lanes: upstream weather must not spend the defect budget ---------------------------
// A clearance run, 2026-07-29: two upstream overload parks ~37 minutes apart took the run-global
// recovery counter to 2/3 and 3/3. Nothing the run produced had failed a check — the far end was
// overloaded — and the run then spent its remaining four hours ONE failure from terminal, with several
// genuinely recoverable stage failures still ahead of it. These tests hold the split that fixes it, and
// the bound that keeps the fix from becoming an unbounded retry against a dead provider.

test("lanes: an upstream overload park is WEATHER; anything else is a DEFECT", () => {
  for (const reason of ["status_overloaded", "provider returned HTTP 503", "HTTP 429 rate limited",
    "connect ECONNREFUSED 10.0.0.1:443", "socket hang up", "register enumeration failed: HTTP 500"]) {
    assert.equal(recoveryLaneOf("transient", reason), "weather", reason);
  }
  // wedge-shaped transients are the run's own machinery being stuck, not the weather
  for (const reason of ["nonzero_exit (exit 1)", "unparseable_json from the turn", "lane_wedge detected", "timeout"]) {
    assert.equal(recoveryLaneOf("transient", reason), "defect", reason);
  }
  // and the class gates it: an outage-WORDED content verdict is still the run's own defect
  assert.equal(recoveryLaneOf("unknown", "the narrative cites HTTP 503 in its prose"), "defect");
  assert.equal(recoveryLaneOf("deterministic", "HTTP 500"), "defect");
  assert.equal(recoveryLaneOf("factual", "overloaded"), "defect");
});

test("lanes: an overload park does NOT spend the defect budget — the 2026-07-29 starvation", () => {
  const weatherHist = [
    { sig: "register-unit:primary-sweep|aaaaaaaaaaaa", lane: "weather" },
    { sig: "common-law|bbbbbbbbbbbb", lane: "weather" },
    { sig: "connotation|cccccccccccc", lane: "weather" },
  ];
  const lanes = countRecoveryLanes(weatherHist, { total: 3 });
  assert.deepEqual(lanes, { weather: 3, defect: 0 }, "three parks, all charged to weather");
  // THE FIX: after three weather parks a first-time defect still has its whole budget. Before the split
  // priorAttempts was 3, the ceiling was 3, and this failure died "exhausted" having never been sampled.
  const defect = decideRecovery({ failClass: "unknown", sig: "synthesis|dddddddddddd", reason: "invalid_file: narrative.md",
    history: weatherHist, priorAttempts: 3, recoveryMax: 3, weatherAttempts: lanes.weather, defectAttempts: lanes.defect });
  assert.equal(defect.recoverable, true, "a defect that has never been sampled must still get its sample");
  assert.equal(defect.lane, "defect");
  assert.equal(defect.laneAttempts, 0, "weather spent none of this budget");
  assert.equal(defect.laneCeiling, 3);
  // and the weather failure itself keeps parking on its own lane
  const weather = decideRecovery({ failClass: "transient", sig: "register-digest|eeeeeeeeeeee", reason: "status_overloaded",
    history: weatherHist, priorAttempts: 3, recoveryMax: 3, weatherAttempts: lanes.weather, defectAttempts: lanes.defect });
  assert.equal(weather.recoverable, true);
  assert.equal(weather.lane, "weather");
  assert.equal(weather.laneAttempts, 3);
});

test("lanes: the weather lane is ITSELF bounded — a provider that never comes back ends the run", () => {
  const ceiling = weatherCeilingFor(3);
  assert.equal(ceiling, 6, "two full per-signature ladders (2 → 15 → 60 min each), never an open loop");
  const at = (weatherAttempts) => decideRecovery({ failClass: "transient", sig: `s${weatherAttempts}|abcabcabcabc`,
    reason: "status_overloaded", history: [], priorAttempts: weatherAttempts, recoveryMax: 3, weatherAttempts, defectAttempts: 0 });
  assert.equal(at(5).recoverable, true, "the last rung is still bought");
  const spent = at(6);
  assert.equal(spent.recoverable, false, "and then it STOPS — an unbounded retry against a dead provider is the worse defect");
  assert.equal(spent.terminalKind, "weather-exhausted", "with its own terminal, never mislabelled as the run breaking");
  // the per-signature ladder is the tighter of the two bounds: ONE weather signature buys at most
  // recoveryMax parks (2 + 15 + 60 = 77 minutes) and is then repeat-signature terminal, whatever the
  // lane ceiling still allows — so the worst case is two ladders, not six hours of 60-minute rungs.
  const sameSig = decideRecovery({ failClass: "transient", sig: "fan-in|6b3148456539", reason: "status_overloaded",
    history: [{ sig: "fan-in|6b3148456539" }, { sig: "fan-in|6b3148456539" }, { sig: "fan-in|6b3148456539" }],
    priorAttempts: 3, recoveryMax: 3, weatherAttempts: 3, defectAttempts: 0 });
  assert.equal(sameSig.recoverable, false);
  assert.equal(sameSig.terminalKind, "repeat-signature");
});

test("lanes: a defect park still spends the defect budget, exactly as before the split", () => {
  const defectHist = [
    { sig: "a|111111111111", lane: "defect" }, { sig: "b|222222222222", lane: "defect" }, { sig: "c|333333333333", lane: "defect" },
  ];
  const lanes = countRecoveryLanes(defectHist, { total: 3 });
  assert.deepEqual(lanes, { weather: 0, defect: 3 });
  const d = decideRecovery({ failClass: "unknown", sig: "d|444444444444", reason: "invalid_file: narrative.md",
    history: defectHist, priorAttempts: 3, recoveryMax: 3, weatherAttempts: 0, defectAttempts: 3 });
  assert.equal(d.recoverable, false, "three defect parks is still the whole defect budget");
  assert.equal(d.terminalKind, "exhausted");
  assert.equal(d.lane, "defect");
  // a caller that passes no lane counts at all decides byte-identically to the pre-split code
  assert.equal(decideRecovery({ failClass: "unknown", sig: "d|444444444444", history: defectHist, priorAttempts: 3, recoveryMax: 3 }).terminalKind,
    "exhausted", "defectAttempts defaults to priorAttempts — old callers and pre-split records are unchanged");
});

test("lanes: pre-split history counts as DEFECT — a parked run is never re-scored into a free budget", () => {
  // Rows written before the lane stamp carry no `lane`. They were charged to the single counter, so
  // they stay charged to the defect lane; a bookkeeping gap (recoveryAttempts ahead of the history)
  // goes the same way. Nothing here can hand a resuming run a weather budget it did not earn.
  assert.deepEqual(countRecoveryLanes([{ sig: "a|1" }, { sig: "b|2" }], { total: 2 }), { weather: 0, defect: 2 });
  assert.deepEqual(countRecoveryLanes([{ sig: "a|1", lane: "weather" }], { total: 3 }), { weather: 1, defect: 2 },
    "the shortfall against recoveryAttempts is charged to the defect lane");
  assert.deepEqual(countRecoveryLanes(null, { total: 0 }), { weather: 0, defect: 0 });
  assert.deepEqual(countRecoveryLanes([], {}), { weather: 0, defect: 0 });
});

test("lanes: recovery off stays off — the weather lane cannot re-enable parking on its own", () => {
  // The ceiling is DERIVED from recoveryMax rather than read from its own knob, precisely so there is
  // no switch that can strand this lane while the defect lane still parks, and no way for it to open
  // parking on a harness that turned recovery off.
  assert.equal(weatherCeilingFor(0), 0);
  assert.equal(weatherCeilingFor(undefined), 0);
  const off = decideRecovery({ failClass: "transient", sig: "s|a", reason: "status_overloaded", recoveryMax: 0, weatherAttempts: 0, defectAttempts: 0 });
  assert.equal(off.recoverable, false, "CLEAROTRON_RECOVERY_MAX=0 disables BOTH lanes");
});

// ---- audit item 6 ( ×): the weather lane knows faultText's own phrase --------------------------
test("classify: a CODELESS transport fault ('fetch failed', no errno) is weather, not deterministic", () => {
  // transport-guard's faultText leads with the errno when the rejection carried one — and both weather
  // regexes matched only that leading token. undici reports a codeless fault as a bare
  // "TypeError: fetch failed" (nothing on cause), so the one phrase faultText ALWAYS writes —
  // 'transport failure' — was the one phrase neither regex knew: the line classified deterministic at
  // fan-in and 's weather lane never saw the unreachable provider it was built for.
  const codeless = "provider error (after one in-tool retry): transport failure on the search call (no response from the provider): fetch failed";
  assert.equal(classifyFailureReason(codeless), "transient", "a provider that did not answer is retry territory");
  assert.equal(recoveryLaneOf("transient", codeless), "weather",
    "…and its remedy is TIME: the same backoff ladder an ECONNRESET that kept its errno always got");
  // The errno forms keep their classification — the token is additive, not a rewrite.
  const coded = "ECONNRESET — transport failure on the search call (no response from the provider): socket hang up";
  assert.equal(classifyFailureReason(coded), "transient");
  assert.equal(recoveryLaneOf("transient", coded), "weather");
  // And the phrase never bleeds into text that does not carry it: the deterministic family is untouched.
  assert.equal(classifyFailureReason("HTTP 404 record not found"), "deterministic");
});

// ----: fanInMissingEvidence — evidence about a slice, not about its neighbours ------------------
//
// Fixture strings are the SHAPES the code actually produces, not invented ones:
//   axis outcome   — pipeline.mjs dispatchPlanQids: `threw: ${err.message}` / `failed: ${r.cause}`
//   provider error — the band's error block `reason`, as quoted in the teal-causeway HTTP 414 park and
//                    the  "HTTP 500 … Count Failed - IL - Near/Adj" comment in register-plan.mjs.

const AXIS_THREW = "threw: ECONNRESET — transport failure on the search call (no response from the provider): socket hang up";
const AXIS_FAILED = "failed: nonzero_exit_1";
const SLICE_414 = "provider error: corsearch_search HTTP 414 <URI Too Long>";
const SLICE_500 = "provider error on the count probe: HTTP 500 Count Failed - IL - Near/Adj";

test("#958: a slice with no error of its own does NOT borrow the axis's repair outcome", () => {
  // The regression. The axis LANDED blocks — the executor demonstrably ran and wrote — so these two
  // qids are an identity/coverage hole. Before the fix both inherited "socket hang up" and the park
  // was stamped transient, spending the weather budget on a plan-execution defect.
  const { rows, failClass } = fanInMissingEvidence(["primary-sweep:exact:q#1", "primary-sweep:exact:q#2"], {
    ownError: new Map(),
    axisOutcome: new Map([["primary-sweep", AXIS_THREW]]),
    landedByAxis: new Map([["primary-sweep", 11]]),
    axisOf: () => "primary-sweep",
  });
  assert.equal(failClass, "deterministic", "nothing ran these slices; a re-sample re-derives that");
  assert.deepEqual(rows.map((r) => r.classifiedOn), ["", ""], "no evidence is borrowed for the CLASS");
  assert.deepEqual(rows.map((r) => r.source), ["axis-context", "axis-context"]);
  assert.deepEqual(rows.map((r) => r.quote), [AXIS_THREW, AXIS_THREW],
    "…but the quote is kept: a reader must still be told a repair was tried and what it hit");
});

test("#958: the honest transient path survives — an axis that landed NOTHING speaks for its slices", () => {
  // 's weather lane exists for exactly this: the executor never wrote, so its transport failure IS
  // this slice's story. Narrowing the fallback to nothing would have broken the dead-provider case.
  const { rows, failClass } = fanInMissingEvidence(["primary-sweep:exact:alpha"], {
    ownError: new Map(),
    axisOutcome: new Map([["primary-sweep", AXIS_THREW]]),
    landedByAxis: new Map([["primary-sweep", 0]]),
    axisOf: () => "primary-sweep",
  });
  assert.equal(failClass, "transient");
  assert.equal(rows[0].source, "axis-landed-nothing");
  assert.equal(recoveryLaneOf("transient", rows[0].classifiedOn), "weather", "…and its remedy is still TIME");
});

test("#958: a slice's OWN provider error always wins, and classifies on its own merits", () => {
  const transientOwn = fanInMissingEvidence(["a"], {
    ownError: new Map([["a", SLICE_500]]),
    axisOutcome: new Map([["x", AXIS_FAILED]]), landedByAxis: new Map([["x", 9]]), axisOf: () => "x",
  });
  assert.equal(transientOwn.failClass, "transient", "an HTTP 500 from one index is genuinely retry territory");
  assert.equal(transientOwn.rows[0].source, "slice");

  const deterministicOwn = fanInMissingEvidence(["a"], {
    ownError: new Map([["a", SLICE_414]]),
    // The axis outcome is transient-looking AND the axis landed nothing — the old code's most favourable
    // case for a wrong answer. The slice's own 414 must still decide it.
    axisOutcome: new Map([["x", AXIS_THREW]]), landedByAxis: new Map([["x", 0]]), axisOf: () => "x",
  });
  assert.equal(deterministicOwn.failClass, "deterministic", "a URI-too-long is a request-shape verdict; retry is futile");
});

test("#958: ONE deterministic slice makes the whole park deterministic", () => {
  // `every` — the park is transient only if re-sampling could fix ALL of it. A mixed set that keeps
  // buying the backoff ladder is the Open Country pathology TRANSIENT_RE's comment names.
  const { failClass } = fanInMissingEvidence(["a", "b"], {
    ownError: new Map([["a", SLICE_500], ["b", SLICE_414]]),
    axisOutcome: new Map(), landedByAxis: new Map(), axisOf: () => "x",
  });
  assert.equal(failClass, "deterministic");
});

test("#958: an empty missing set is NOT vacuously transient", () => {
  // `[].every(...)` is true. A vacuous transient here would hand a clean fan-in the full backoff ladder.
  assert.equal(fanInMissingEvidence([], {}).failClass, "deterministic");
  assert.equal(fanInMissingEvidence(undefined, {}).failClass, "deterministic");
});

test("#958: no outcome at all reads as nothing-ran, never as no-objection", () => {
  const { rows, failClass } = fanInMissingEvidence(["a"], {
    ownError: new Map(), axisOutcome: new Map(), landedByAxis: new Map(), axisOf: () => "x",
  });
  assert.equal(failClass, "deterministic");
  assert.equal(rows[0].source, "none");
  assert.equal(rows[0].quote, "", "nothing to quote — and nothing invented to fill the gap");
  assert.equal(rows[0].classifiedOn, "");
});

test("#958: a quoted transient axis outcome does NOT reach the lane through the text path", () => {
  // The property that replaces an over-tight first cut of this test. That cut asserted the reason
  // carried no transient token at all — which withheld the provider's verbatim error from the terminal
  // diagnosis and was caught by the repair-first arm that holds a 414-shaped dispatch failure terminal.
  // CITED BY THE ARM'S NAME, NOT ITS LINE, and the reason is the same one that made the name necessary
  // in the first place: the line half of this citation had already drifted onto a blank line once when
  // the file above it grew. A name survives the file moving, and it survives the file not being here.
  // The quote stays;
  // what must hold is that quoting it cannot route the park to weather.
  const { rows, failClass } = fanInMissingEvidence(["primary-sweep:exact:q#1"], {
    ownError: new Map(), axisOutcome: new Map([["primary-sweep", AXIS_THREW]]),
    landedByAxis: new Map([["primary-sweep", 4]]), axisOf: () => "primary-sweep",
  });
  const sentence = `1 dictated qid(s) own no band block: ${rows[0].qid} \u2190 no error of its own; axis "${rows[0].axis}" repair hit: ${rows[0].quote}`;
  assert.match(sentence, /socket hang up/, "the operator still sees what the repair hit");
  assert.equal(failClass, "deterministic");
  // Two other functions carry this guarantee, so assert against them rather than trusting the comment.
  assert.equal(recoveryLaneOf(failClass, sentence), "defect",
    "recoveryLaneOf gates on failClass BEFORE it tests the text, so the quoted token cannot buy weather");
  assert.equal(classifyFailureReason(sentence), "transient",
    "the TEXT guess is transient — which is exactly why the explicit stamp must win, and repairs.mjs says it does");
});

test("#958: DETERMINISTIC_RE already matched this throw's own words — the stamp was overriding a correct guess", () => {
  // Not a behaviour assertion on the fix: it pins WHY the defect was invisible. The text classifier had
  // it right and repairs.mjs's own note says an explicit stamp always wins over it.
  assert.match(WILDERNESS_REASON, DETERMINISTIC_RE);
  assert.equal(classifyFailureReason(WILDERNESS_REASON), "deterministic");
});

// ──: a receipt states the outcome it is named for, or says it does not know ──────────────────
//
// Provider strings are VERBATIM from a delivered run's band files (2026-08-15), not invented.

const NEAR_ADJ_REFUSAL = "provider error (after one in-tool retry): provider error on the count probe before enumeration: HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - IL - Near/Adj queries with sub queries that can return a huge amount of results are not allowed";
const REAL_500 = "provider error on the count probe: HTTP 500 upstream index unavailable";

test("#960: a 5xx that STATES a request-shape verdict is permanent, not weather", () => {
  // The regression. TRANSIENT_RE matches `\bhttp\s?5\d\d\b`, so the old predicate
  // `(reason) => !TRANSIENT_RE.test(reason)` read this as retryable and filed it ladder-spent.
  assert.equal(TRANSIENT_RE.test(NEAR_ADJ_REFUSAL), true, "it still LOOKS transient by status code — that is the trap");
  assert.equal(STRUCTURAL_REFUSAL_RE.test(NEAR_ADJ_REFUSAL), true, "…and the sentence says otherwise");
  assert.equal(retryCannotHelpWith(NEAR_ADJ_REFUSAL), true, "so the ladder has nothing to offer it");
});

test("#960: an ordinary 5xx keeps its ladder — the fix must not make every provider error permanent", () => {
  assert.equal(STRUCTURAL_REFUSAL_RE.test(REAL_500), false);
  assert.equal(retryCannotHelpWith(REAL_500), false, "a genuinely transient 500 still rides the ladder");
  for (const t of ["socket hang up", "ETIMEDOUT", "status_overloaded", "rate_limited"])
    assert.equal(retryCannotHelpWith(t), false, t);
});

test("#960: a non-transient error stays permanent exactly as before", () => {
  // The prior rule is kept whole; STRUCTURAL_REFUSAL_RE only ADDS cases.
  for (const t of ["HTTP 414 URI Too Long", "HTTP 400 bad request", "plan-defect: wildcard-shaped term"])
    assert.equal(retryCannotHelpWith(t), true, t);
});

test("#960: the structural pattern does not fire on authorization or pressure", () => {
  // "not permitted" is an auth verdict (403 — already deterministic by its code) and 429 is pressure.
  // A wrong `structural` STOPS a retry that would have worked, so the error direction is the one that
  // matters and the pattern is kept narrow deliberately.
  assert.equal(STRUCTURAL_REFUSAL_RE.test("HTTP 403 forbidden: this account is not permitted"), false);
  assert.equal(STRUCTURAL_REFUSAL_RE.test("HTTP 429 rate_limited — too many requests"), false);
});

test("#960: the repair ledger records the EFFECT, and says 'unmeasured' rather than nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "repair-effect-"));
  const rows = [];
  const ledger = createRepairLedger(dir, { log: (o) => rows.push(o) });

  ledger.record("plan-direct-execute", "incumbent-class", "ok", { effect: { asked: 4, closed: 1 } });
  assert.deepEqual(rows[0].effect, { asked: 4, closed: 1 }, "the call returning is not the hole closing");
  assert.equal(rows[0].dispatch, "ok", "what the call did, named as the call");
  assert.equal(rows[0].outcome, "ok", "the legacy field is KEPT so archived rows still join");

  // A caller that cannot measure must not produce a row that reads as a verified repair by omission.
  ledger.record("plan-direct-execute", "primary-sweep", "ok", {});
  assert.equal(rows[1].effect, "unmeasured");
  // A partial or malformed effect is not half-believed.
  ledger.record("plan-direct-execute", "other", "ok", { effect: { asked: 3 } });
  assert.equal(rows[2].effect, "unmeasured");
});

// ---- — the classifier names the failure the validator named -------------------------------------
//
// R5 parked at common-law-half:m on `class:"unknown", classSource:"reason-text"` over a reason a
// validator had structured, and the run survived on the catch-all lane's default budget. The issue's
// own CORRECTION (2026-08-13) then withdrew the trend/ceiling rule it had proposed: R6 showed a FLAT
// count on a stage that was about to succeed, so a ceiling read off the trend would have killed the
// only worldwide clearance in the suite at 2/9. What survives is narrower — NAME the failure, move
// nothing. The budget assertions below are the guard on that, and are the first thing to read.

// The shape connotation-quote-unbound.test.mjs:177 already carries, at the count R5 actually parked on.
const R5_REASON = "invalid_file:common-law-findings.half-b.md:connotation_quote_unbound:quote_unbound=1;Q-1F4YWF87 [x] split R-5T9SYVN3";

test("#849 the classifier NAMES the token the validator named, and the budget does not move", () => {
  const sig = failureSignature("common-law-half:m", R5_REASON);
  assert.equal(sig.quantityToken, "connotation_quote_unbound",
    "the name was already computed here and thrown away — that is the whole defect");
  assert.equal(sig.quantity, 1, "and the count it was computed beside is unchanged");
  // THE TAXONOMY DOES NOT MOVE. decideRecovery sends any class outside transient/stale/unknown to ZERO
  // parks, so minting a class for this shape would be the refuted rule arriving by the back door.
  assert.equal(classifyFailureReason(R5_REASON), "unknown", "the CLASS is untouched — #849's correction");
  assert.ok(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text", token: sig.quantityToken }));
  const d = decideRecovery({ failClass: "unknown", sig: sig.sig, reason: R5_REASON, history: [], priorAttempts: 0, recoveryMax: 3 });
  assert.equal(d.parkBudget, 1, "one park, exactly as before");
  assert.equal(d.lane, "defect");
  assert.equal(d.laneCeiling, 3);
  assert.equal(d.recoverable, true, "R5 and R6 both recovered on exactly this park — nothing here may take it away");
});

test("#849 a reason the classifier legitimately cannot name is not a classifier gap", () => {
  // No structured token: the classifier had nothing to work from, so `unknown` is the honest answer and
  // not a gap. Reporting it would bury the real ones, which is 's mistake in the other direction.
  const bare = failureSignature("gather", "the stage produced no output and said nothing about why");
  assert.equal(bare.quantityToken, null);
  assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text", token: null }), false);
  // A throw-site stamp is not a gap either: the classifier never guessed. Same for the A5 strike
  // relabel, whose classSource is "invalid-artifact-strikes" — it OVERRODE the text read deliberately.
  assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "throw-site", token: "connotation_quote_unbound" }), false);
  assert.equal(unnamedStructuredFailure({ failClass: "deterministic", classSource: "invalid-artifact-strikes", token: "connotation_quote_unbound" }), false);
  assert.equal(unnamedStructuredFailure(), false, "no argument at all is not a gap");
});

test("#849 the token rides BOTH failureSignature returns — the coded one and the prose one", () => {
  // pipeline.mjs takes the token from failSig regardless of which source won the VALUE, and the run this
  // issue was filed on logged quantitySource:"throw-site". A token carried on only one of these two
  // returns would be null on exactly the failure that motivated the fix.
  const prose = failureSignature("common-law-half:m", R5_REASON);
  const coded = failureSignature("common-law-half:m", R5_REASON, { codes: ["connotation_quote_unbound"] });
  assert.equal(prose.quantityToken, "connotation_quote_unbound");
  assert.equal(coded.quantityToken, "connotation_quote_unbound");
  assert.notEqual(prose.sig, coded.sig, "and the A4 code-set signature is still signed the way it was");
});

// ── — THE MOST LEGIBLE FAILURE SHAPE WAS THE ONE NOTHING REPORTED ───────────────────────────────
//
// `classifier-gap` fired only when the reason carried a QUANTITY token. The failures this pipeline
// actually produces mostly carry a KIND and no number — `invalid_file:<path>` is **71 of the 76**
// recorded stage failures on the test instance — so the reporter built to catch "a failure the validator
// named that the classifier could not" was blind to precisely that shape.
//
// Measured on the preserved runs: of four `class:"unknown"` classifications, two carry a quantity and
// two do not, and the two that do not are the `<kind>:<path>` ones on `common-law-half:a` and `:b`.
// Neither was reported anywhere.
test("#849 a <kind>:<path> failure is nameable, and it was not before", () => {
  for (const reason of [
    "invalid_file:prelim-search/x/common-law-findings.half-a.md",
    "missing_file:prelim-search/x/common-law-findings.half-m.md",
  ]) {
    const f = failureSignature("common-law-half:a", reason);
    assert.ok(f.kindToken, `${reason}: the kind is extracted`);
    assert.equal(f.quantityToken, null, "and it carries no quantity — which is why it went unreported");
    assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text",
      token: f.quantityToken, kind: f.kindToken }), true, `${reason}: reportable now`);
    // THE REGRESSION, STATED: the old predicate required a quantity token.
    assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text",
      token: f.quantityToken }), false, "and with the kind withheld it is exactly as blind as before");
  }
});

test("#849 the quantity shape this reporter already caught still reports", () => {
  const f = failureSignature("common-law-half:m", "connotation_form_damaged: form_damaged = 27");
  assert.ok(f.quantityToken, "the original case is unchanged");
  assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text",
    token: f.quantityToken, kind: f.kindToken }), true);
});

test("#849 a bare word is NOT a kind — the colon is what separates a token from prose", () => {
  // `timeout` and `nonzero_exit_1` are real reasons and they stay unnamed. Naming a leading bare word
  // would fire on almost any sentence, which turns the gap report into noise and hides the shape it
  // exists to surface. They are 5 of 76; the shape that is 71 of 76 is covered.
  for (const reason of ["timeout", "nonzero_exit_1", "the stage produced nothing usable this attempt"]) {
    const f = failureSignature("common-law-half:a", reason);
    assert.equal(f.kindToken, null, `${JSON.stringify(reason)} is not a kind`);
    assert.equal(unnamedStructuredFailure({ failClass: "unknown", classSource: "reason-text",
      token: f.quantityToken, kind: f.kindToken }), false);
  }
});

test("#849 naming the failure moves NO budget — the class is untouched", () => {
  // The issue's own trend rule was WITHDRAWN on evidence (R6: a flat count on a stage about to succeed),
  // and `decideRecovery` sends any class outside transient/stale/unknown to ZERO parks — so minting a
  // class for these would be a silent terminal wearing the costume of a fix. This arm pins that naming
  // and deciding stay separate.
  const f = failureSignature("common-law-half:a", "invalid_file:prelim-search/x/y.md");
  assert.equal(classifyFailureReason("invalid_file:prelim-search/x/y.md"), "unknown",
    "the CLASS is still unknown, which is what keeps the one park this failure recovers on");
  assert.ok(f.kindToken, "and the failure is named anyway — the two are different questions");
});

// ── — THE CLASSIFIER IS HANDED THE FAILURE, NOT THE LADDER'S SUMMARY ───────────
//
// `refute()` returned a bare `{ ok: false }`, so the only thing its caller could throw was a sentence
// about the LADDER — "failed after retries + fallback" — which names no provider condition and matches
// neither lane regex. Measured on a codex R2 round that went terminal after seventeen hours: every
// attempt recorded `rate_limited` or `timeout`, and the run was classified `unknown` / `defect`, so a
// run starved by an upstream subscription spent the small budget reserved for its OWN mistakes. That is
// the precise inversion the lane split exists to prevent.
test("#2100 a provider condition reaches the lane split, and the ladder's own summary does not", () => {
  const laneOf = (reason) => recoveryLaneOf(classifyFailureReason(reason), reason);

  // THE DEFECT, kept as a live control. If this ever stops reading defect the arm below proves nothing,
  // because the whole claim is that the two inputs classify DIFFERENTLY.
  assert.equal(laneOf("failed after retries + fallback"), "defect",
    "the ladder's summary names no condition — this is the input that produced the inversion");

  // THE FIX: the condition the attempts actually recorded.
  assert.equal(laneOf("rate_limited — the refutation ladder exhausted retries and fallback on it"), "weather",
    "a park bought because the provider was rate-limiting is weather; nothing the run produced was wrong");

  // AND THE HONEST BRANCH. When the ladder truly recorded no condition, the reason says so and still
  // classifies as a defect — inventing a provider condition there would be the same guess in a more
  // confident voice.
  assert.equal(laneOf("failed after retries + fallback (the ladder recorded no condition)"), "defect");

  // WHAT THIS DOES **NOT** DO, stated so nobody reads it as more than it is: `timeout` is in
  // TRANSIENT_RE but not in OUTAGE_RE, so it classifies transient and still spends the DEFECT budget.
  // The issue's own analysis says the same. Carrying the condition out is what this change buys; which
  // conditions count as weather is the lane rule's business and is untouched here.
  assert.equal(classifyFailureReason("timeout — the refutation ladder exhausted retries and fallback on it"),
    "transient", "the class improves from unknown …");
  assert.equal(laneOf("timeout — the refutation ladder exhausted retries and fallback on it"), "defect",
    "… and the LANE does not change, because timeout is not an outage token");
});

test("#2100 the wiring: the ladder carries its condition out, and the throw site leads with it", () => {
  // The arm above drives the classifier. This holds the WIRING — that the condition is actually
  // PASSED — because a classifier that reads a reason nobody gives it is the whole defect, and the
  // lesson from the same day is that an arm proving the machinery obeys proves
  // nothing about whether anyone asks it to.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");
  assert.match(src, /if \(!r\.ok\) return \{ ok: false, fail: r\.fail \?\? null \};/,
    "refute() must carry the stage's condition out — a bare { ok: false } is what discarded it");
  assert.match(src, /firstRef\.fail\s*\n?\s*\? `\$\{firstRef\.fail\} — the refutation ladder exhausted/,
    "and the throw must LEAD with the condition rather than with a statement about the ladder");
  assert.doesNotMatch(src, /StageFailure\("narrative-refutation", "failed after retries \+ fallback"\)/,
    "the unconditional summary-only throw must be gone, not merely joined by a better one");
});
