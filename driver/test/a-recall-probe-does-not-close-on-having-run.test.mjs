// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-recall-probe-does-not-close-on-having-run.test.mjs — loop 3, owner ruling 2026-08-19: "no".
//
// THE TRAIL THIS REPRODUCES. In the R2 scenario, DELPHI GENETICS — a HIGH-graded LIVE US registration —
// produced no doubt of any kind. Both of its recall asks ended `kind:executed` / `handoff:null` via the
// plan-execution join: satisfied by the query having RUN, not by the result reaching findings. The ask
// closed before a doubt would be minted, so 's provenance rule never saw it. Nothing on any
// delivered surface said the right existed.
//
// The rule keys on what the probe RETURNED, never on execution — because a probe that ran and found
// NOTHING legitimately closes, and a rule that forgot that would open every clean recall on every run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAsks, finalizeOpenHandoffs, summarizeAsks, recallDischargedByReturn } from "../ask-ledger.mjs";

const QID = "recall-delphi";
const recall = (qid = QID) => ({
  ts: "2026-08-19T00:00:00Z",
  directives: [{ qid, mark_text: "EXAMPLEMARK", owner: "Someone Holdings" }],
});
// `executed` rows as register-plan.mjs writes them since: BOTH return keys always present.
const ran = (returned, qid = QID) => ({ executed: [{ qid, state: "enumerated", ...returned }] });
const askFor = (opts, id = `ask:recall:${QID}`) => deriveAsks(opts).find((a) => a.ask_id === id);

// ── THE TRAIL ─────────────────────────────────────────────────────────────────────────────────────
test("DELPHI GENETICS: a recall probe that came back HOLDING something does not end executed", () => {
  const a = askFor({ recall: recall(), planExecution: ran({ records: 2, total_hits: 2 }) });
  assert.ok(a, "the recall directive mints an ask");
  assert.equal(a.ending, null, "an executed ending here is the defect: the right vanishes without a doubt");
  assert.match(a.handoff, /returned 2 records/, "the handoff must say WHAT came back, not merely that it is open");
  assert.match(a.handoff, /discharges on what came back, not on having run/);
});

test("and it reaches a human: the open ask is counted open, and finalize does not flatten its reason", () => {
  const asks = deriveAsks({ recall: recall(), planExecution: ran({ records: 2, total_hits: 2 }) });
  assert.equal(summarizeAsks(asks).open, 1, "the header count must show it as open, not executed");
  const final = finalizeOpenHandoffs(asks).find((a) => a.ask_id === `ask:recall:${QID}`);
  assert.match(final.handoff, /returned 2 records/,
    "finalizeOpenHandoffs stamps only rows with NO handoff — a specific reason must survive to the lawyer");
});

// ── THE LEGITIMATE CLOSE, WHICH IS THE HALF A CARELESS RULE BREAKS ────────────────────────────────
test("a probe that ran and found NOTHING closes on executed, exactly as before", () => {
  const a = askFor({ recall: recall(), planExecution: ran({ records: 0, total_hits: 0 }) });
  assert.equal(a.ending?.kind, "executed");
  assert.equal(a.handoff, null);
  assert.match(a.ending.evidence, /returned 0 records/);
});

// ── THE THREE STATES THAT ARE NOT AN ANSWER ───────────────────────────────────────────────────────
test("zero records against a POSITIVE count does not discharge — counted N, carried none of them", () => {
  const a = askFor({ recall: recall(), planExecution: ran({ records: 0, total_hits: 7 }) });
  assert.equal(a.ending, null, "the provider found 7 and the block carried none; that is not 'there are none'");
  assert.match(a.handoff, /returned 0 records of 7 counted/);
});

test("a count that could not be taken does not discharge — 'we could not tell' is not 'there are none'", () => {
  const a = askFor({ recall: recall(), planExecution: ran({ records: null, total_hits: null }) });
  assert.equal(a.ending, null);
  assert.match(a.handoff, /ran, but the count could not be taken/);
});

test("a counted crowd whose record list was not carried does not discharge either", () => {
  const a = askFor({ recall: recall(), planExecution: ran({ records: null, total_hits: 900 }) });
  assert.equal(a.ending, null);
  assert.match(a.handoff, /counted 900, record list not carried/);
});

// ── WHAT THE RULE MUST NOT TOUCH ──────────────────────────────────────────────────────────────────
//
// A PRE- RECEIPT CLOSES AS IT ALWAYS HAS. It carries neither return key, so nothing about it says
// what came back — and refusing it would reopen every recall ask on every archived run, which is a
// rewrite of history rather than a rule about new runs. `planJoinFrom` tells this state from "the count
// could not be taken" by KEY PRESENCE, and this arm is why that discriminator exists.
test("a legacy receipt — the pre-#1349 {qid,state} shape — still closes, so archived runs do not move", () => {
  const a = askFor({ recall: recall(), planExecution: { executed: [{ qid: QID, state: "enumerated" }] } });
  assert.equal(a.ending?.kind, "executed", "an archived run's recall asks must end exactly as they did");
  assert.equal(a.handoff, null);
  assert.match(a.ending.evidence, /what it returned was not recorded/);
});

test("`xcheck` is untouched — this is loop 3, and the sibling net was not measured or ruled on", () => {
  const a = deriveAsks({
    xcheck: { ts: "2026-08-19T00:00:00Z", directives: [{ qid: "xc-1", mark_text: "M", owner: "O" }] },
    planExecution: { executed: [{ qid: "xc-1", state: "enumerated", records: 2, total_hits: 2 }] },
  }).find((x) => x.ask_id === "ask:xcheck:xc-1");
  assert.equal(a.ending?.kind, "executed", "widening the rule to a net nobody measured would be invented, not ruled");
  assert.equal(a.handoff, null);
});

test("an UNEXECUTED recall probe keeps the open ending it always had, with no #1349 handoff on it", () => {
  // The rule only speaks about probes that RAN. A probe the execution record cannot confirm was already
  // open, and its handoff is finalizeOpenHandoffs's generic line — not a claim about what came back.
  const a = askFor({ recall: recall(), planExecution: { executed: [] } });
  assert.equal(a.ending, null);
  assert.equal(a.handoff, null, "before finalize it carries none — the #1349 reason is only for probes that ran");
  const final = finalizeOpenHandoffs([a])[0];
  assert.match(final.handoff, /ships OPEN in the audit's ask ledger/);
  assert.doesNotMatch(final.handoff, /discharges on what came back/);
});

// ── THE PREDICATE, DIRECTLY ───────────────────────────────────────────────────────────────────────
test("the discharge predicate is three-valued, and only the empty answer discharges", () => {
  assert.equal(recallDischargedByReturn(null).discharges, true, "legacy");
  assert.equal(recallDischargedByReturn({ records: 0, total_hits: 0 }).discharges, true);
  assert.equal(recallDischargedByReturn({ records: 0, total_hits: null }).discharges, true);
  assert.equal(recallDischargedByReturn({ records: 1, total_hits: 1 }).discharges, false);
  assert.equal(recallDischargedByReturn({ records: 0, total_hits: 7 }).discharges, false);
  assert.equal(recallDischargedByReturn({ records: null, total_hits: null }).discharges, false);
});
