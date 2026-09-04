// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// loop 3 — AN ENDING THAT SAYS A QUERY RAN AND NOTHING ABOUT WHAT CAME BACK.
//
// A recall probe's ask ends `executed` the moment the plan-execution join sees its qid. That answers
// "did it run" and has never answered "did anything come back" — so on every archived run a probe that
// returned a live in-scope right is byte-identical to one that returned nothing. The difference lived in
// `_driver/register-recall.json`, which is purged with the run dir. Measured across the 19 delivered runs
// in the test pool: 32 executed recall probes whose subject never reached findings.json, and NOT ONE of
// them can be classified, because the ending records only that a query ran.
//
// This is the instrument, not the rule: the ending now carries what the slice returned, into audit.md,
// which outlives `_driver/`. The doctrine question — may a probe that returned a live right close on
// execution alone — is the owner's, and it cannot even be ASKED of an archived run until this ships.
//
// THE ARM THAT MATTERS IS THE NULL ONE. close-verify.mjs already records the trap in its own words:
// "the executor writes total_hits NULL for a count it could not take, and `Number(null)` is 0". A
// two-valued count would report an untaken count as "returned nothing" — re-creating, inside the fix,
// the exact confusion the fix exists to remove.
import { test } from "node:test";
import assert from "node:assert/strict";

import { joinPlanToBands } from "../register-plan.mjs";
import { planJoinFrom, returnedPhrase } from "../ask-ledger.mjs";

const plan = (qids) => ({ entries: qids.map((qid) => ({ qid, axis: "primary-sweep" })) });
const bands = (blocks) => ({ "primary-sweep": blocks });

// ── the join records what came back ───────────────────────────────────────────────────────────────

test("joinPlanToBands carries the returned counts beside the fact that the slice ran", () => {
  const j = joinPlanToBands(plan(["q1"]), bands([
    { qid: "q1", state: "enumerated", total_hits: 4, records: [{}, {}, {}, {}] },
  ]));
  assert.equal(j.executed.length, 1);
  assert.deepEqual(j.executed[0], { qid: "q1", state: "enumerated", records: 4, total_hits: 4 });
});

test("THE NULL TRAP: a count the provider could not take stays null and never becomes 0", () => {
  // Number(null) === 0. If this entry reported total_hits 0 the reader would be told the probe found
  // nothing, when in fact nobody knows — which is the defect this whole change exists to remove.
  const j = joinPlanToBands(plan(["q1"]), bands([
    { qid: "q1", state: "enumerated", total_hits: null, records: [{}] },
  ]));
  assert.equal(j.executed[0].total_hits, null, "an untaken count must not read as a count of zero");
  assert.equal(j.executed[0].records, 1);
});

test("a block with no records array reports null records, not zero", () => {
  const j = joinPlanToBands(plan(["q1"]), bands([{ qid: "q1", state: "crowd", total_hits: 900 }]));
  assert.equal(j.executed[0].records, null, "absent is not empty");
  assert.equal(j.executed[0].total_hits, 900);
});

test("a genuine empty return is recorded as zero — the legitimate close must stay expressible", () => {
  // The issue's own caution: a probe that ran and found NOTHING closes on `executed` correctly. If this
  // arm could not distinguish itself from the null arm above, the rule built on it would be worthless.
  const j = joinPlanToBands(plan(["q1"]), bands([{ qid: "q1", state: "enumerated", total_hits: 0, records: [] }]));
  assert.equal(j.executed[0].records, 0);
  assert.equal(j.executed[0].total_hits, 0);
});

// ── the join surface the ask ledger consumes ──────────────────────────────────────────────────────

test("planJoinFrom answers has() exactly as the Set did, and carries the return alongside", () => {
  const j = planJoinFrom({ executed: [{ qid: "q1", state: "enumerated", records: 2, total_hits: 2 }] });
  assert.equal(j.executed.has("q1"), true, "every existing membership test must be untouched");
  assert.equal(j.executed.has("nope"), false);
  assert.deepEqual(j.executed.get("q1"), { records: 2, total_hits: 2 });
});

test("a legacy receipt of bare qid strings still joins, and says the return was not recorded", () => {
  const j = planJoinFrom({ executed: ["q1"] });
  assert.equal(j.executed.has("q1"), true, "archived runs must keep ending as they did");
  assert.equal(j.executed.get("q1"), null);
  assert.match(returnedPhrase(j.executed.get("q1")), /not recorded/);
});

// The arm above tests a shape NO driver ever wrote. `git show c80ca5bf^:driver/register-plan.mjs`
// says the pre- producer pushed `{ qid, state }` — an object — so the bare-string branch proved
// nothing and the real legacy receipt fell through to the failed-count sentence. These three arms are
// keyed on the literal shape history shows, not on one convenient to construct.

test("THE REAL LEGACY SHAPE: a pre-#1349 receipt is {qid, state}, and it reads as NOT RECORDED", () => {
  const j = planJoinFrom({ executed: [{ qid: "q1", state: "enumerated" }] });
  assert.equal(j.executed.has("q1"), true, "membership is what every existing caller asks");
  assert.equal(j.executed.get("q1"), null, "carrying neither key means the run predates the instrument");
  assert.match(returnedPhrase(j.executed.get("q1")), /not recorded/);
});

test("a pre-#1349 receipt does NOT read like a count the provider could not take", () => {
  // These are two different facts: nobody recorded it, versus somebody tried and failed. Collapsing
  // them re-creates inside the instrument the confusion the instrument exists to remove.
  const legacy = returnedPhrase(planJoinFrom({ executed: [{ qid: "q1", state: "enumerated" }] }).executed.get("q1"));
  const failed = returnedPhrase(planJoinFrom({ executed: [{ qid: "q1", state: "enumerated", records: null, total_hits: null }] }).executed.get("q1"));
  assert.match(legacy, /not recorded/);
  assert.match(failed, /count could not be taken/);
  assert.notEqual(legacy, failed, "the whole point of the three-valued count");
});

test("the discriminator's PREMISE: joinPlanToBands always writes both keys, so absence means legacy", () => {
  // Key presence is only a safe discriminator while the current producer never omits a key. If someone
  // later drops one for brevity, every new receipt starts reading as pre- — silently. This arm
  // fails the moment that premise stops holding.
  for (const block of [
    { qid: "q1", state: "enumerated", total_hits: 4, records: [{}, {}, {}, {}] },
    { qid: "q1", state: "enumerated", total_hits: null, records: [{}] },
    { qid: "q1", state: "crowd", total_hits: 900 },
    { qid: "q1", state: "enumerated", total_hits: 0, records: [] },
  ]) {
    const e = joinPlanToBands(plan(["q1"]), bands([block])).executed[0];
    assert.ok("records" in e, `records key missing for ${JSON.stringify(block.state)}`);
    assert.ok("total_hits" in e, `total_hits key missing for ${JSON.stringify(block.state)}`);
  }
});

// ── the reader's words: three-valued, never a zero standing in for an absence ─────────────────────

test("returnedPhrase distinguishes returned-nothing from count-unavailable from not-recorded", () => {
  const nothing = returnedPhrase({ records: 0, total_hits: 0 });
  const untaken = returnedPhrase({ records: null, total_hits: null });
  const missing = returnedPhrase(null);

  assert.match(nothing, /returned 0 records/);
  assert.match(untaken, /count could not be taken/);
  assert.match(missing, /not recorded/);

  // The property, stated as an assertion rather than trusted: no two of the three read alike.
  assert.equal(new Set([nothing, untaken, missing]).size, 3,
    "if any two collapse, a rule keyed on the return cannot tell a legitimate close from a defect");
});

test("returnedPhrase names the shortfall when a slice counted more than it carried", () => {
  assert.match(returnedPhrase({ records: 3, total_hits: 40 }), /returned 3 records of 40 counted/);
  assert.match(returnedPhrase({ records: 1, total_hits: 1 }), /^returned 1 record$/, "singular, and no redundant tail");
});

test("returnedPhrase reports a counted crowd whose record list was not carried", () => {
  assert.match(returnedPhrase({ records: null, total_hits: 900 }), /counted 900, record list not carried/);
});

// ── end to end: the ending text that lands in the delivered audit ─────────────────────────────────

test("THE POINT: an executed ending states what the probe returned, in audit-facing text", async () => {
  const { deriveAsks } = await import("../ask-ledger.mjs");
  // ON `xcheck`, NOT `recall`, AND THE SWAP IS THE STORY. This arm was written against a recall probe
  // returning 2 records, and 's ruling (2026-08-19, "no") took that exact case away from it: a
  // recall probe that came back holding something no longer ends `executed` at all — it ships OPEN with
  // a handoff naming what came back. The arm's own subject is the EVIDENCE TEXT of an executed ending,
  // which xcheck still produces, so it moves rather than being deleted or weakened to `records: 0`.
  // The recall half now lives in a-recall-probe-does-not-close-on-having-run.test.mjs.
  const xcheck = { ts: "2026-08-19T00:00:00Z", directives: [{ qid: "xc-x", mark_text: "EXAMPLEMARK", owner: "Someone" }] };
  const asks = deriveAsks({
    xcheck,
    planExecution: { executed: [{ qid: "xc-x", state: "enumerated", records: 2, total_hits: 2 }] },
  });
  const a = asks.find((x) => x.ask_id === "ask:xcheck:xc-x");
  assert.ok(a, "the cross-check directive mints an ask");
  assert.equal(a.ending.kind, "executed");
  assert.match(a.ending.evidence, /xc-x \(returned 2 records\)/,
    "the audit must show what came back, not merely that a query ran");
});

test("and an executed probe whose count failed does NOT read as one that found nothing", () => {
  const j = planJoinFrom({ executed: [{ qid: "q1", state: "enumerated", records: null, total_hits: null }] });
  const phrase = returnedPhrase(j.executed.get("q1"));
  assert.doesNotMatch(phrase, /returned 0/, "the regression this instrument exists to prevent");
  assert.match(phrase, /count could not be taken/);
});
