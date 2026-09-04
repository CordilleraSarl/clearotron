// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ask-ledger.mjs (PR-6) — every question the run asks itself ends: executed (COMPUTED from the
// plan-execution join, never asserted), judged-immaterial with reasons, or recovery (loudly handed
// over); anything else ships VISIBLY OPEN. Offline, synthetic fixtures structure-copied from the
// real receipts' SHAPES only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveAsks, planJoinFrom, answerLineFor,
  parseAskClosureLines, applyAskClosure, finalizeOpenHandoffs, summarizeAsks, ASK_ENDINGS,
} from "../ask-ledger.mjs";
import { applyClosure } from "../doubt-ledger.mjs";   // the sibling guard, for the agreement test at the foot of this file

const PLAN_EXEC = {
  plan_version: 3,
  executed: [{ qid: "supp:primary-sweep:exact:frostberry:abcd1234", state: "enumerated" },
    { qid: "xcheck-owner-glacier-labs", state: "enumerated" },
    { qid: "recall-frostberry", state: "incomplete" }],
  missing: ["supp:primary-sweep:exact:iceberry:beef5678"],
  deferred: [{ qid: "supp:primary-sweep:wildcard:frost:cafe9999", reason: "provider lacks the wildcard capability — deferred" }],
  skipped: [],
};

test("ending vocabulary is frozen", () => {
  assert.deepEqual(ASK_ENDINGS, ["executed", "judged-immaterial", "recovery"]);
});

test("planJoinFrom: executed set + deferred reasons from the receipt shape", () => {
  const j = planJoinFrom(PLAN_EXEC);
  assert.ok(j.executed.has("xcheck-owner-glacier-labs"));
  assert.ok(!j.executed.has("supp:primary-sweep:exact:iceberry:beef5678"));
  assert.match(j.deferredReason.get("supp:primary-sweep:wildcard:frost:cafe9999"), /wildcard capability/);
});

// ── birth-place 1: intake asks join the report's own labelled answer lines ───────────────────────
test("intake asks: answered → executed; 'NOT executed' answer → recovery with handoff; no line → OPEN", () => {
  const report = [
    "# Actions",
    "### Answers to your instructions",
    "- You asked us to check the FROSTBERRY domain portfolio → nothing found on the live registers",
    "- You asked us to check Danish descriptiveness objections → NOT executed this run — no DK register layer was bought",
  ].join("\n");
  const asks = deriveAsks({
    intakeAsks: [
      { ask: "check the FROSTBERRY domain portfolio", owner: "register" },
      { ask: "check Danish descriptiveness objections", owner: "register" },
      { ask: "confirm the Ruritanian sound-mark register was swept", owner: "register" },
    ],
    reportMd: report,
  }, { ts: "2026-07-29T00:00:00Z" });
  const [a1, a2, a3] = asks;
  assert.equal(a1.born.place, "intake-ask");
  assert.equal(a1.ending.kind, "executed");
  assert.equal(a1.ending.by, "report-answer-join");
  assert.match(a1.ending.evidence, /nothing found on the live registers/);
  assert.equal(a2.ending.kind, "recovery");
  assert.ok(a2.handoff, "a not-executed intake ask names its handoff surface");
  assert.equal(a3.ending, null, "an unanswered intake ask stays OPEN (→ closure stage)");
});

test("answerLineFor: majority-distinctive-word containment, never fuzzy — a foreign line does not join", () => {
  const report = "- You asked us to check the FROSTBERRY domain portfolio → nothing found";
  assert.ok(answerLineFor("check the FROSTBERRY domain portfolio", report));
  assert.equal(answerLineFor("verify Ruritanian customs recordals coverage", report), null);
});

// ── birth-places 2+3: skeptic escalations end from escalation-state; skips are judged immaterial ──
test("escalations: completed → executed; failed → recovery; skip events → judged-immaterial with the recorded reason", () => {
  const asks = deriveAsks({
    escalationState: { requested: ["primary-sweep", "translit-cyrillic", "envelope:goods"], completed: ["primary-sweep"], failed: ["translit-cyrillic"] },
    events: [{ event: "escalation-skipped", axis: "saturation-probe", reason: "code-side unit (no session)" }],
  }, { ts: "t" });
  const esc = Object.fromEntries(asks.map((a) => [a.ask_id, a]));
  assert.equal(esc["ask:escalation:primary-sweep"].ending.kind, "executed");
  assert.equal(esc["ask:escalation:translit-cyrillic"].ending.kind, "recovery");
  assert.ok(esc["ask:escalation:translit-cyrillic"].handoff);
  const skip = esc["ask:escalation-skip:saturation-probe"];
  assert.equal(skip.ending.kind, "judged-immaterial");
  assert.deepEqual(skip.ending.reasons, ["code-side unit (no session)"]);
  assert.ok(!asks.some((a) => a.ask_id === "ask:escalation:envelope:goods"), "envelope-prefixed failures are the envelope's rows, not escalation's");
});

// ── birth-place 4: envelope decisions/closures ────────────────────────────────────────────────────
test("envelope: verified close → executed; unverified → recovery; close:false decision → recovery with the reason", () => {
  const asks = deriveAsks({
    events: [
      { event: "envelope-decision", deferredAxes: ["primary-sweep", "translit-cyrillic", "saturation-probe"], close: false, reason: "deadline pressure: 40m left, close needs 55m" },
      { event: "envelope-closed", axes: ["primary-sweep"], unverified: ["translit-cyrillic"] },
    ],
  }, { ts: "t" });
  const byId = Object.fromEntries(asks.map((a) => [a.ask_id, a]));
  assert.equal(byId["ask:envelope:primary-sweep"].ending.kind, "executed");
  assert.equal(byId["ask:envelope:translit-cyrillic"].ending.kind, "recovery");
  const parked = byId["ask:envelope:saturation-probe"];
  assert.equal(parked.ending.kind, "recovery");
  assert.match(parked.ending.reasons[0], /deadline pressure/);
  assert.match(parked.handoff, /envelope_note/);
});

// ── birth-place 5: screen-gate rows ───────────────────────────────────────────────────────────────
test("screen-gate: a flagged URI absent from the unresolved sidecar was cleared by the code re-check (executed); a sidecar row is the disclosed recovery", () => {
  const asks = deriveAsks({
    events: [{ event: "screen-gate-violation", uris: ["/mark/xz/70000123", "/mark/xz/70000456"] }],
    screenGateUnresolved: [{ mark: "GLASS LANTERN", uri: "/mark/xz/70000456", cause: "record 404 — not retrievable" }],
  }, { ts: "t" });
  const byRef = Object.fromEntries(asks.map((a) => [a.born.ref, a]));
  assert.equal(byRef["/mark/xz/70000123"].ending.kind, "executed");
  assert.equal(byRef["/mark/xz/70000123"].ending.by, "screen-gate-recheck");
  const bad = byRef["/mark/xz/70000456"];
  assert.equal(bad.ending.kind, "recovery");
  assert.match(bad.ending.reasons[0], /404/);
  assert.match(bad.handoff, /CONDITIONAL clamp/);
});

// ── birth-places 6+7: frame-diff directives; executed is COMPUTED, never taken from the receipt ───
test("frame receipt: a swept directive with recorded qids is executed ONLY when the plan-execution join confirms; an unconfirmed sweep claim stays OPEN", () => {
  const frameReopen = {
    requested: ["field:cl 35 retail", "variant:frostberri", "variant:frost phonetic family"],
    swept: ["field:cl 35 retail", "variant:frostberri"],
    deferrals: [{ directive: "variant:frost phonetic family", layer: "variant", reason: "no-code-remedy: display label — disclosed, never swept blind" }],
    directive_qids: {
      "field:cl 35 retail": ["supp:primary-sweep:exact:frostberry:abcd1234"],
      "variant:frostberri": ["supp:primary-sweep:exact:iceberry:beef5678"],   // receipt claims swept; join says missing
    },
    born: { "variant:frost phonetic family": "form-neighbourhood" },
  };
  const asks = deriveAsks({ frameReopen, planExecution: PLAN_EXEC }, { ts: "t" });
  const byRef = Object.fromEntries(asks.map((a) => [a.born.ref, a]));
  const confirmed = byRef["field:cl 35 retail"];
  assert.equal(confirmed.ending.kind, "executed");
  assert.equal(confirmed.ending.by, "plan-execution-join", "executed is computed from the join, never asserted");
  assert.equal(byRef["variant:frostberri"].ending, null, "a swept claim the execution record cannot confirm stays a question");
  const deferred = byRef["variant:frost phonetic family"];
  assert.equal(deferred.born.place, "form-neighbourhood", "the receipt's born map routes the form-oracle injection to its own birth place");
  assert.equal(deferred.ending.kind, "recovery");
  assert.match(deferred.handoff, /CLEAR→CONDITIONAL clamp/);
});

test("frame receipt: a swept directive with NO recorded qids (warm-resume arm) ends executed on the receipt's own verification", () => {
  const asks = deriveAsks({ frameReopen: { requested: ["variant:frostberri"], swept: ["variant:frostberri"], deferrals: [] } }, { ts: "t" });
  assert.equal(asks[0].ending.kind, "executed");
  assert.equal(asks[0].ending.by, "frame-reopen-receipt");
});

// ── birth-place 8: supplemental proposals + the persisted rejected[] rows ─────────────────────────
test("supplemental: entries end via the qid join (executed / capability-gap recovery / open); an unsuperseded rejection — cap or shape — stays OPEN", () => {
  const asks = deriveAsks({
    supplementalPlans: [{
      axis: "primary-sweep",
      entries: [
        { qid: "supp:primary-sweep:exact:frostberry:abcd1234", predicate: "exact", term: "FROSTBERRY", nice_classes: ["32"] },
        { qid: "supp:primary-sweep:exact:iceberry:beef5678", predicate: "exact", term: "ICEBERRY", nice_classes: ["32"] },
        { qid: "supp:primary-sweep:wildcard:frost:cafe9999", predicate: "wildcard", term: "FROST*", nice_classes: ["32"] },
      ],
      rejected: [
        { ts: "t0", origin: "propose-tool", issue: "per-axis cap 24 reached — assess whether an existing supplemental already covers this", proposal: { predicate: "exact", term: "SNOWTHISTLE", nice_classes: ["30"] } },
        { ts: "t0", origin: "propose-tool", issue: `unknown predicate "teleport" (one of: …)`, proposal: { predicate: "teleport", term: "X" } },
      ],
    }],
    planExecution: PLAN_EXEC,
  }, { ts: "t" });
  const byId = Object.fromEntries(asks.map((a) => [a.ask_id, a]));
  assert.equal(byId["ask:supplemental:supp:primary-sweep:exact:frostberry:abcd1234"].ending.kind, "executed");
  assert.equal(byId["ask:supplemental:supp:primary-sweep:exact:iceberry:beef5678"].ending, null, "a missing qid stays open — never assumed run");
  assert.equal(byId["ask:supplemental:supp:primary-sweep:wildcard:frost:cafe9999"].ending.kind, "recovery", "a capability-gap deferral is a disclosed handover");
  const cap = byId["ask:supplemental-rejected:primary-sweep:1"];
  assert.equal(cap.ending, null, "an over-cap rejection is a REAL unanswered question — OPEN, closure/lawyer decides");
  assert.match(cap.ask.text, /SNOWTHISTLE/);
  // P2-B: a SHAPE rejection that never minted is equally unanswered. It used to render
  // "judged-immaterial by mint-lint" — a burial the lawyer reads as a decision somebody made, when in
  // fact nobody judged anything. judged-immaterial is now reserved for the supersession join.
  const lint = byId["ask:supplemental-rejected:primary-sweep:2"];
  assert.equal(lint.ending, null, "a shape rejection nobody re-proposed is OPEN, not judged-immaterial");
  assert.match(lint.ask.text, /teleport/);
});

// P2-B (charter P2e) — the mint seam's rephrase loop is its best property: rejected[] → re-propose →
// executed, in-turn. It is also the remedy the A5 script screen hands back. The ledger must SHOW it
// working, so the supersession join runs for every rejection reason, not just cap hits.
test("supplemental: a SHAPE rejection the model then fixed and got minted is superseded, not buried", () => {
  const asks = deriveAsks({
    supplementalPlans: [{
      axis: "transliteration-numeric",
      entries: [
        { qid: "supp:transliteration-numeric:exact:bingsha:abcd1234", predicate: "exact", term: "冰沙", nice_classes: ["30"] },
      ],
      rejected: [
        { ts: "t0", origin: "propose-tool", issue: "term \"冰沙\" is not in Latin script, and the active register provider indexes non-Latin filings by their TRANSLITERATION — supply it as this proposal's \"romanization\" field and re-propose",
          proposal: { predicate: "exact", term: "冰沙", nice_classes: ["30"] } },
      ],
    }],
    planExecution: { executed: [{ qid: "supp:transliteration-numeric:exact:bingsha:abcd1234", state: "enumerated" }], deferred: [], missing: [], skipped: [] },
  }, { ts: "t" });
  const byId = Object.fromEntries(asks.map((a) => [a.ask_id, a]));
  const rej = byId["ask:supplemental-rejected:transliteration-numeric:1"];
  assert.equal(rej.ending.kind, "judged-immaterial");
  assert.match(rej.ending.evidence, /superseded by minted qid supp:transliteration-numeric:exact:bingsha:abcd1234/,
    "the row points at where the question was actually answered");
  assert.equal(byId["ask:supplemental:supp:transliteration-numeric:exact:bingsha:abcd1234"].ending.kind, "executed",
    "and that row carries the live outcome");
});

// Review fix (2026-07-29): a per-call-cap rejection whose identical proposal was RE-PROPOSED in the
// next tool call and minted must not ride to closure as a permanent false-open — it is superseded by
// the minted qid, whose ask row carries the live computed ending. A per-axis cap rejection can never
// mint later and correctly stays OPEN.
test("supplemental: a cap-hit rejection later minted as an identical entry is superseded (judged-immaterial pointing at the qid); an unmatched cap rejection stays OPEN", () => {
  const asks = deriveAsks({
    supplementalPlans: [{
      axis: "primary-sweep",
      entries: [
        // the re-proposal minted (second call) — same (predicate, term, classes, owner) question
        { qid: "supp:primary-sweep:exact:frostberry:abcd1234", predicate: "exact", term: "FROSTBERRY", owner: "Glacier Labs", nice_classes: ["32"] },
        // term/terms spelling difference is the SAME question
        { qid: "supp:primary-sweep:exact:iceberry:beef5678", predicate: "exact", terms: ["ICEBERRY"], nice_classes: ["32"] },
      ],
      rejected: [
        { ts: "t0", origin: "propose-tool", issue: "per-call cap 12 reached", proposal: { predicate: "exact", term: "FROSTBERRY", owner: "Glacier Labs", nice_classes: ["32"] } },
        { ts: "t0", origin: "propose-tool", issue: "per-call cap 12 reached", proposal: { predicate: "exact", term: "ICEBERRY", nice_classes: ["32"] } },
        // never re-proposed — a REAL unanswered question, OPEN for closure/lawyer
        { ts: "t0", origin: "propose-tool", issue: "per-call cap 12 reached", proposal: { predicate: "exact", term: "SNOWTHISTLE", nice_classes: ["30"] } },
        // per-axis cap: can never mint later; even though FROSTBERRY-like text, different classes ⇒ no match
        { ts: "t0", origin: "propose-tool", issue: "per-axis cap 24 reached — assess whether an existing supplemental already covers this", proposal: { predicate: "exact", term: "FROSTBERRY", nice_classes: ["05"] } },
      ],
    }],
    planExecution: PLAN_EXEC,
  }, { ts: "t" });
  const byId = Object.fromEntries(asks.map((a) => [a.ask_id, a]));
  const sup1 = byId["ask:supplemental-rejected:primary-sweep:1"];
  assert.equal(sup1.ending.kind, "judged-immaterial");
  assert.equal(sup1.ending.by, "mint-join");
  assert.match(sup1.ending.evidence, /superseded by minted qid supp:primary-sweep:exact:frostberry:abcd1234/);
  assert.match(sup1.ending.reasons[1], /ask:supplemental:supp:primary-sweep:exact:frostberry:abcd1234/, "the ending points at the row carrying the live outcome");
  const sup2 = byId["ask:supplemental-rejected:primary-sweep:2"];
  assert.equal(sup2.ending.kind, "judged-immaterial", "term vs terms:[term] is the same question");
  assert.match(sup2.ending.evidence, /iceberry/);
  assert.equal(byId["ask:supplemental-rejected:primary-sweep:3"].ending, null, "never re-proposed — stays OPEN");
  assert.equal(byId["ask:supplemental-rejected:primary-sweep:4"].ending, null, "different classes is a different question — no false supersede");
  // the minted rows keep their own computed endings — the join never touches them
  assert.equal(byId["ask:supplemental:supp:primary-sweep:exact:frostberry:abcd1234"].ending.kind, "executed");
  assert.equal(byId["ask:supplemental:supp:primary-sweep:exact:iceberry:beef5678"].ending, null);
});

// ── birth-place 9: cross-checks (xcheck + recall) + over-cap rows ─────────────────────────────────
test("cross-checks: directives end via the qid join; over-cap rows are OPEN questions", () => {
  const asks = deriveAsks({
    xcheck: { directives: [{ qid: "xcheck-owner-glacier-labs", owner: "Glacier Labs" }], overflow: [{ term: "Frost Hollow Trading", reason: "cap 10 reached — assess manually" }] },
    recall: { directives: [{ qid: "recall-frostberry", mark_text: "Zylight FROSTBERRY" }], overflow: [] },
    planExecution: PLAN_EXEC,
  }, { ts: "t" });
  const byId = Object.fromEntries(asks.map((a) => [a.ask_id, a]));
  assert.equal(byId["ask:xcheck:xcheck-owner-glacier-labs"].ending.kind, "executed");
  assert.equal(byId["ask:recall:recall-frostberry"].ending.kind, "executed");
  assert.equal(byId["ask:xcheck:xcheck-owner-glacier-labs"].born.place, "cross-check");
  const over = byId["ask:xcheck-overflow:1"];
  assert.equal(over.ending, null);
  assert.match(over.ask.text, /Frost Hollow Trading/);
});

// ── birth-place 10: crowd-context skips + failures ────────────────────────────────────────────────
test("crowd-context: a skipped slice is judged-immaterial with its honest reason; a failed pass is a recovery handover", () => {
  const asks = deriveAsks({
    events: [
      { event: "crowd-context-skips", skipped: [{ axis: "primary-sweep", unit: "FROST composites", reason: "no formative term joinable from the plan — cannot compose evidence queries without inventing a term" }] },
      { event: "crowd-context-failed", fail: "executor unavailable" },
    ],
  }, { ts: "t" });
  const skip = asks.find((a) => a.born.place === "crowd-context" && a.ending?.kind === "judged-immaterial");
  assert.ok(skip);
  assert.match(skip.ending.reasons[0], /no formative term/);
  const failed = asks.find((a) => a.ask_id === "ask:crowd-failed:1");
  assert.equal(failed.ending.kind, "recovery");
  assert.match(failed.handoff, /sufficient:false/);
});

// ── the closure line-form: IMMATERIAL is quote-verified; OPEN records the handoff; executed is not assertable ──
test("parseAskClosureLines + applyAskClosure: a verified IMMATERIAL ends the ask; an invented quote lands in unverified and the ask stays OPEN; an OPEN line records the recovery recommendation", () => {
  const asks = [
    { ask_id: "ask:xcheck-overflow:1", born: { place: "cross-check" }, ask: { text: "over-cap probe" }, qids: [], ending: null, handoff: null },
    { ask_id: "ask:supplemental-rejected:primary-sweep:1", born: { place: "supplemental-proposal" }, ask: { text: "cap rejection" }, qids: [], ending: null, handoff: null },
    { ask_id: "ask:intake:1", born: { place: "intake-ask" }, ask: { text: "answered ask" }, qids: [], ending: { kind: "executed", by: "report-answer-join", evidence: "line", reasons: [], ts: null }, handoff: null },
  ];
  const stageOut = [
    `IMMATERIAL ask:xcheck-overflow:1: register-findings.md: "the FROST composite crowd is priced into the coverage disclosure" — the family is already disclosed as a crowd`,
    `IMMATERIAL ask:supplemental-rejected:primary-sweep:1: findings.json: "this quote exists nowhere" — stretched citation`,
    `OPEN ask:intake:1: nothing to do`,   // ended ask — the stage may never touch it
    `SETTLED doubt:crosscheck:x:1: findings.json: "irrelevant" — a doubt line never matches an ask`,
  ].join("\n");
  const lines = parseAskClosureLines(stageOut);
  assert.equal(lines.filter((l) => l.verdict === "IMMATERIAL").length, 2);
  const fileTexts = { "register-findings.md": "…the FROST composite crowd is priced into the coverage disclosure…", "findings.json": "{}" };
  const { asks: out, immaterialByStage, unverified } = applyAskClosure(asks, lines, fileTexts, { ts: "t" });
  assert.equal(immaterialByStage, 1);
  assert.equal(out[0].ending.kind, "judged-immaterial");
  assert.equal(out[0].ending.by, "doubt-closure-stage");
  assert.equal(out[1].ending, null, "the invented quote did NOT end the ask");
  assert.deepEqual(unverified, [{ ask_id: "ask:supplemental-rejected:primary-sweep:1", file: "findings.json", quote: "this quote exists nowhere" }]);
  assert.equal(out[2].ending.kind, "executed", "an ended ask is untouchable");
  assert.equal(out[2].handoff, null, "an OPEN line against an ENDED ask changes nothing");
});

test("an OPEN closure line records the model's recovery recommendation as the handoff — visible, no ending", () => {
  const asks = [{ ask_id: "ask:xcheck-overflow:1", born: {}, ask: { text: "x" }, qids: [], ending: null, handoff: null }];
  const { asks: out } = applyAskClosure(asks, parseAskClosureLines("OPEN ask:xcheck-overflow:1: run the owner probe by hand before filing"), {});
  assert.equal(out[0].ending, null);
  assert.match(out[0].handoff, /owner probe by hand/);
});

test("finalizeOpenHandoffs + summarizeAsks: every open ask names where a human meets it; counts add up", () => {
  const asks = finalizeOpenHandoffs([
    { ask_id: "a", ending: { kind: "executed" }, handoff: null },
    { ask_id: "b", ending: { kind: "judged-immaterial" }, handoff: null },
    { ask_id: "c", ending: { kind: "recovery" }, handoff: "cover note" },
    { ask_id: "d", ending: null, handoff: null },
    { ask_id: "e", ending: null, handoff: "custom recommendation" },
  ]);
  assert.match(asks[3].handoff, /reviewing lawyer/);
  assert.equal(asks[4].handoff, "custom recommendation", "a closure-stage recommendation is never overwritten");
  assert.deepEqual(summarizeAsks(asks), { total: 5, executed: 1, immaterial: 1, recovery: 1, open: 2 });
});

test("rejected[] retry duplicates collapse to ONE ask row (the sidecar is an append-only event log)", () => {
  const row = { ts: "t0", origin: "propose-tool", issue: "per-axis cap 24 reached — assess whether an existing supplemental already covers this", proposal: { predicate: "exact", term: "SNOWTHISTLE", nice_classes: ["30"] } };
  const asks = deriveAsks({ supplementalPlans: [{ axis: "primary-sweep", entries: [], rejected: [row, { ...row, ts: "t1" }] }] }, { ts: "t" });
  assert.equal(asks.filter((a) => a.born.place === "supplemental-proposal").length, 1, "one question, one row");
  assert.equal(asks[0].born.ref, "rejected[0]", "the first occurrence keeps the stable ref");
});

test("determinism + purity: same inputs ⇒ deeply equal output; inputs never mutated; no cost/token/time figures in any row", () => {
  const inputs = {
    intakeAsks: [{ ask: "check the FROSTBERRY domain portfolio", owner: "register" }],
    reportMd: "- You asked us to check the FROSTBERRY domain portfolio → nothing found",
    events: [{ event: "escalation-skipped", axis: "saturation-probe", reason: "code-side unit (no session)" }],
    frameReopen: { requested: ["variant:x"], swept: [], deferrals: [{ directive: "variant:x", layer: "variant", reason: "digest-locked-resume" }] },
    planExecution: PLAN_EXEC,
  };
  const frozen = JSON.stringify(inputs);
  const a = deriveAsks(inputs, { ts: "t" });
  const b = deriveAsks(inputs, { ts: "t" });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(inputs), frozen, "pure — inputs untouched");
  const text = JSON.stringify(a).toLowerCase();
  for (const banned of ["usd", "token", "cost", "spend"]) assert.ok(!text.includes(banned), `no ${banned} near closure`);
});

// ──: a probe REFUSED as an un-searchable term is an OPEN ask, not an absence ──────────────────
test("cross-checks: a refused probe surfaces as an OPEN ask with no qid — a sidecar alone is an absence", () => {
  // The refusal stops a nil search, which is right, but it also means a common-law signal stopped
  // being cross-checked. Without this row that fact lives only in `_driver/register-xcheck.json` and
  // every surface that accounts for asks reports nothing — an absence read as success, which is the
  // failure mode the refusal exists to prevent. `qids: []` and `ending: null` are the point: the
  // question was asked and no register query answered it.
  const asks = deriveAsks({
    xcheck: { directives: [], overflow: [],
      refused: [{ qid: "xcheck-mark-core-bioveltrin", markText: "**Core (BIOVELTRIN, BIO VELTRIN, BIO-VELTRIN, etc.)**",
        issue: 'plan row "xcheck-mark-core-bioveltrin" refused AT THE FOLD — never frozen into the plan, never dispatched: markdown emphasis' }] },
    recall: { directives: [], overflow: [],
      refused: [{ qid: "recall-formative-root", mark_text: "**Formative root (VELTRIN, DELPHIN, DELPHINUS, etc.)**", issue: "markdown emphasis" }] },
    planExecution: PLAN_EXEC,
  }, { ts: "t" });
  const byId = Object.fromEntries(asks.map((a) => [a.ask_id, a]));
  const x = byId["ask:xcheck-refused:1"];
  assert.ok(x, "the xcheck refusal has a row");
  assert.equal(x.born.place, "cross-check");
  assert.equal(x.born.ref, "refused[0]");
  assert.equal(x.born.artifact, "_driver/register-xcheck.json");
  assert.deepEqual(x.qids, [], "it carries no qid BECAUSE it never entered the plan");
  assert.equal(x.ending, null, "so nothing can close it — it is open until a human answers it");
  assert.match(x.ask.text, /never dispatched/);
  assert.match(x.ask.text, /\*\*Core \(BIOVELTRIN/, "the row is named, or a reader cannot act on it");
  assert.ok(byId["ask:recall-refused:1"], "the recall lane gets the same treatment");
  assert.equal(byId["ask:recall-refused:1"].ending, null);
  // and a receipt with no refused adds nothing — the key is absent on every pre- run
  assert.equal(deriveAsks({ xcheck: { directives: [], overflow: [] }, planExecution: PLAN_EXEC }, { ts: "t" })
    .filter((a) => /refused/.test(a.ask_id)).length, 0);
});

// ── THE VERBATIM PREDICATE IS SHARED WITH doubt-ledger, AND THAT IS A CONTRACT ───────────────────────

test("⭐ both ledgers answer 'does this quote appear verbatim' IDENTICALLY — one artifact, one evidence set", () => {
  // WHY THESE TWO AND NOT THE OTHER SIXTY. `replace(/\s+/g, " ").trim()` appears 60 times across 35
  // non-test driver files: it is a generic string-tidying idiom, and a "one true normalizer" rule over it
  // would be a false generalisation. These two are unified on a CONTRACT, not a resemblance —
  // doubt-closure.md is parsed TWICE, by two parsers, into two ledgers, and both verify their citations
  // against the SAME fileTexts. `clip` is identical in both files and stays duplicated on the same test:
  // a divergence there changes how long a display string is, not whether something settles.
  //
  // WHAT A DISAGREEMENT WOULD LOOK LIKE. One seat, one citation, settling a doubt while failing to end an
  // ask — and no token anywhere saying the two checks differed. It would read as the seat citing badly.
  //
  // `squash` is imported from doubt-ledger.mjs rather than copied, so this can no longer fail by
  // divergence-on-edit. It stays because it pins the contract: it is what goes red if a later change ever
  // hands either side its own normalisation again.
  const fileTexts = { "findings.json": "The mark VENTURI is registered in CH for class 9." };
  const cases = [
    ["VENTURI is registered in CH", true, "plain verbatim"],
    ["VENTURI   is\n  registered in CH", true, "whitespace collapsed — the latitude both sides grant"],
    ["   VENTURI is registered in CH   ", true, "leading and trailing space trimmed"],
    ["VENTURI is registered in FR", false, "one word wrong"],
    ["", false, "an empty quote cites nothing — and `hay.includes(\"\")` is TRUE in JS, so this leg is load-bearing on the `q &&` guard, not decoration"],
  ];

  for (const [quote, shouldVerify, why] of cases) {
    const d = applyClosure(
      [{ id: "x1", status: "open" }],
      [{ verdict: "SETTLED", id: "x1", file: "findings.json", quote, reason: "r" }],
      fileTexts,
    );
    const a = applyAskClosure(
      [{ ask_id: "x1", ask: "is it on the register?", handoff: "OLD" }],
      [{ verdict: "IMMATERIAL", id: "x1", file: "findings.json", quote, reason: "r" }],
      fileTexts, { ts: "2026-08-16T00:00:00Z" },
    );

    const doubtVerified = d.settledByStage === 1;
    const askVerified = Boolean(a.asks[0].ending);

    assert.equal(doubtVerified, askVerified,
      `THE LEDGERS DISAGREE on "${why}" — one citation, two answers, and nothing in either artifact records that they differed`);
    // Pinned against the expected answer too, so a shared predicate that became uniformly wrong (both
    // sides accepting everything, or refusing everything) still fails. Agreement alone is satisfied by
    // two checks that are broken the same way.
    assert.equal(doubtVerified, shouldVerify, `the doubt side is wrong about: ${why}`);
    assert.equal(askVerified, shouldVerify, `the ask side is wrong about: ${why}`);

    // And the refusals must be RECORDED, not merely absent — an unverified citation is the loud case.
    if (!shouldVerify) {
      assert.equal(d.unverified.length, 1, `the doubt side dropped its refusal silently: ${why}`);
      assert.equal(a.unverified.length, 1, `the ask side dropped its refusal silently: ${why}`);
    }
  }
});
