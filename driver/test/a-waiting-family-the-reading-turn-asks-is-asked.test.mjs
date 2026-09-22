// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WAITING FAMILY THE READING TURN ASKS IS RECORDED AS ASKED.
//
// The wider families wait in the plan for the reading turn, and a family's own row never runs: the turn's
// ask arrives as an ordinary supplemental entry. Two things kept that ask from counting. The fold refused
// it as the duplicate of the waiting row, which claimed its question; and the join had no link from a
// waiting row to the entry that asked it, so every family read as never asked. On a delivered run 156
// entries were still waiting at delivery, and at least two of them had been asked, answered and refused
// at the fold six times each.
import test from "node:test";
import assert from "node:assert/strict";
import { compileRegisterPlan, joinPlanToBands, deriveCoverageSkeleton, foldSupplementalEntries,
  awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";

const MARK = "VELTRIS";
const manifest = {
  schema_version: 1, mark: MARK, dominant_element: MARK,
  elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }, { value: "VELTRISS", category: "spelling" },
    { value: "WELTRIS", category: "sound-alike" }, { value: "VELTRIS PRO", category: "compound" }],
  incumbent_classes: ["9"], goods_words: ["software"],
};
const plan = () => compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9", "42"], jurisdictions: ["US", "EU"] },
  capabilities: PROVIDER_CAPABILITIES.signa });
// The run's bands: every entry that is not waiting ran and answered.
const bandsFor = (p) => {
  const out = {};
  for (const e of p.entries) {
    if (awaitsReadingTurn(e.when) || e.unsupported) continue;
    (out[e.axis] ??= []).push({ qid: e.qid, state: "enumerated", records: [], total_hits: 0 });
  }
  return out;
};
// The reading turn's ask of one waiting family: the same question, as a supplemental carries it.
const askOf = (e) => {
  const { when, qidSuffix, provenance, ...rest } = e;
  return { ...rest, qid: `supp:${e.axis}:${e.predicate}:ask-${e.qid.length}`, origin: "supplemental", rationale: "the identical mark read as a list" };
};

test("THE CONTROL: with nothing asked, every waiting family is open and nothing records a decision", () => {
  const p = plan();
  const waiting = p.entries.filter((e) => awaitsReadingTurn(e.when));
  assert.ok(waiting.length >= 3, `only ${waiting.length} waiting families compiled — this arm asserts over too few`);
  const join = joinPlanToBands(p, bandsFor(p));
  assert.equal(join.awaiting.length, waiting.length);
  assert.deepEqual(join.asked, []);
});

test("the reading turn's ask of a waiting family folds, and the family is recorded as asked by it", () => {
  const p = plan();
  const family = p.entries.find((e) => awaitsReadingTurn(e.when) && e.axis === "primary-sweep");
  assert.ok(family, "no waiting primary-sweep family compiled");
  const ask = askOf(family);
  const folded = foldSupplementalEntries(p, [ask]);
  assert.deepEqual(folded.refused, [], `the ask was refused as the waiting row's duplicate: ${folded.refused[0]?.issue?.slice(0, 120)}`);
  assert.deepEqual(folded.added, [ask.qid]);
  const bands = bandsFor(folded.plan);
  const join = joinPlanToBands(folded.plan, bands);
  assert.deepEqual(join.asked, [{ qid: family.qid, axis: family.axis, asked_by: ask.qid }]);
  assert.ok(!join.awaiting.some((x) => x.qid === family.qid), "the family asked is still counted as waiting");
  assert.equal(join.awaiting.length, joinPlanToBands(p, bandsFor(p)).awaiting.length - 1, "more than the one family changed state");
  // Counted once: the ask where it ran, the family as asked, never as a second execution.
  const sk = deriveCoverageSkeleton(folded.plan, join).find((s) => s.axis === family.axis);
  const before = deriveCoverageSkeleton(p, joinPlanToBands(p, bandsFor(p))).find((s) => s.axis === family.axis);
  assert.equal(sk.asked, 1);
  assert.equal(sk.executed, before.executed + 1, "the family's question was counted twice");
});

test("a different question does not answer a waiting family", () => {
  const p = plan();
  const family = p.entries.find((e) => awaitsReadingTurn(e.when) && e.axis === "primary-sweep");
  const other = { ...askOf(family), qid: "supp:primary-sweep:exact:other", ...(family.terms ? { terms: ["ZZZOTHER"] } : { term: "ZZZOTHER" }) };
  const folded = foldSupplementalEntries(p, [other]);
  const join = joinPlanToBands(folded.plan, bandsFor(folded.plan));
  assert.deepEqual(join.asked, []);
  assert.ok(join.awaiting.some((x) => x.qid === family.qid));
});
