// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A QUESTION THE PLAN HAD ALREADY ASKED CLOSES ITS REOPEN DIRECTIVE.
//
// When the blind frame comparison asks for a reopen, the fold can refuse a minted slice because the plan already
// holds a row asking the same question; the refused slice is never frozen into the plan and never runs. The remedy
// term ledger learned to read such a slice through the row that answered it, and its term classes `found`. The
// directive check did not: it required every minted slice to have run, so the directive stayed deferred as
// `slice-not-landed`, the dominant-element gap stayed open, and a CLEAR verdict clamped to CONDITIONAL on a
// question the plan had asked and answered. Both now read a slice through one rule (`answeredAs`), and a directive
// closed that way names the row that answered it. Every mark here is invented.
import test from "node:test";
import assert from "node:assert/strict";
import { verifyRegisterDirectiveClose, answeredAs } from "../close-verify.mjs";
import { accountRemedyTerms, domClosedOverAccounted } from "../remedy-accounting.mjs";
import { compileRegisterPlan, foldSupplementalEntries } from "../register-plan.mjs";
import { deriveAsks } from "../ask-ledger.mjs";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";

const MARK = "INVENTEDMARK";
/** A proposal the plan already asks, minted and folded for real, so the fold's own record is what is read. */
function foldARepeatedQuestion() {
  const plan = compileRegisterPlan({
    manifest: { schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
      variants: [{ value: MARK, category: "core" }], incumbent_classes: [] },
    job: { jobKey: "t", classes: ["9"], jurisdictions: [] }, capabilities: CLARIVATE });
  const asked = plan.entries.find((e) => e.axis === "primary-sweep" && e.predicate === "exact");
  const { minted } = mintSupplementalEntries("primary-sweep",
    [{ predicate: "exact", term: MARK, nice_classes: [9], regions: [], rationale: "the same question again" }], { capabilities: CLARIVATE });
  const folded = foldSupplementalEntries(plan, minted);
  assert.equal(folded.refused[0]?.kind, "duplicate-question", "guard: the fold refused the repeat as already asked");
  // exactly what the pipeline threads through to both readers
  const foldRefusals = new Map(folded.refused.map((r) => [r.qid, { kind: r.kind ?? null, twin: r.twin ?? null }]));
  return { refused: minted[0].qid, twin: asked.qid, foldRefusals };
}
const enumerated = (qid) => ({ qid, state: "enumerated", total_hits: 71, records: new Array(71).fill({}) });

test("the defect: without the fold's record the directive stays deferred on the slice that never ran", () => {
  const { refused, twin } = foldARepeatedQuestion();
  const v = verifyRegisterDirectiveClose({ qids: [refused], executedQids: new Set([twin]), blocksByQid: new Map([[twin, enumerated(twin)]]) });
  assert.deepEqual([v.closed, v.reason], [false, `slice-not-landed:${refused}`]);
});

test("with the fold's record the directive closes on the row that answered it, and names that row", () => {
  const { refused, twin, foldRefusals } = foldARepeatedQuestion();
  const v = verifyRegisterDirectiveClose({ qids: [refused], executedQids: new Set([twin]), blocksByQid: new Map([[twin, enumerated(twin)]]), foldRefusals });
  assert.equal(v.closed, true, `the directive stayed deferred: ${v.reason}`);
  assert.deepEqual(v.answered_by, [{ qid: refused, twin }]);
});

test("so the dominant-element gap closes, where it clamped the verdict before", () => {
  const { refused, twin, foldRefusals } = foldARepeatedQuestion();
  const key = "variant:dominant";
  const directives = [{ key, layer: "variant", severity: "dominant-element" }];
  const terms = [{ directive: key, layer: "variant", severity: "dominant-element", term: MARK, predicates: [], qids: [refused] }];
  const world = { executedQids: new Set([twin]), blocksByQid: new Map([[twin, enumerated(twin)]]) };
  const gap = (refusals) => {
    const v = verifyRegisterDirectiveClose({ qids: [refused], ...world, foldRefusals: refusals });
    const accounting = accountRemedyTerms({ terms, ...world, foldRefusals: refusals });
    return domClosedOverAccounted({ directives, swept: v.closed ? [key] : [], accounting, reopenKeyOf: (d) => d.key }).domClosed;
  };
  assert.equal(gap(new Map()), false, "control: without the fold's record the gap stays open");
  assert.equal(gap(foldRefusals), true, "the gap stayed open on a question the plan had asked and answered");
});

test("CONTROLS — an identity collision, a malformed term, a duplicate with no twin and a twin that never ran stay deferred", () => {
  const { refused, twin } = foldARepeatedQuestion();
  const world = { qids: [refused], executedQids: new Set([twin]), blocksByQid: new Map([[twin, enumerated(twin)]]) };
  for (const r of [{ kind: "identity-collision", twin }, { kind: "malformed-term", twin }, { kind: "duplicate-question", twin: null }]) {
    const v = verifyRegisterDirectiveClose({ ...world, foldRefusals: new Map([[refused, r]]) });
    assert.equal(v.closed, false, `${r.kind}${r.twin ? "" : " with no twin"} closed a directive`);
  }
  const unrun = verifyRegisterDirectiveClose({ qids: [refused], executedQids: new Set(), blocksByQid: new Map(), foldRefusals: new Map([[refused, { kind: "duplicate-question", twin }]]) });
  assert.deepEqual([unrun.closed, unrun.reason], [false, `slice-not-landed:${refused} (answered by ${twin})`], "a twin that never ran answered the question");
});

test("a slice that was never asked still does not close, and the two readers resolve a slice one way", () => {
  const { refused, twin, foldRefusals } = foldARepeatedQuestion();
  const v = verifyRegisterDirectiveClose({ qids: ["supp:primary-sweep:exact:other:00000000"], executedQids: new Set([twin]),
    blocksByQid: new Map([[twin, enumerated(twin)]]), foldRefusals });
  assert.equal(v.closed, false);
  assert.equal(answeredAs(refused, foldRefusals), twin);
  assert.equal(answeredAs("supp:primary-sweep:exact:other:00000000", foldRefusals), "supp:primary-sweep:exact:other:00000000");
});

test("the run's ask for the directive ends on the row that answered it, not left open on the slice that never ran", () => {
  const { refused, twin, foldRefusals } = foldARepeatedQuestion();
  const key = "variant:dominant";
  const v = verifyRegisterDirectiveClose({ qids: [refused], executedQids: new Set([twin]), blocksByQid: new Map([[twin, enumerated(twin)]]), foldRefusals });
  const receipt = { requested: [key], swept: [key], deferrals: [], directive_qids: { [key]: [refused] },
    answered_elsewhere: [{ directive: key, slices: v.answered_by }] };
  const planExecution = { executed: [{ qid: twin, state: "enumerated", records: 71, total_hits: 71 }] };
  const endingOf = (fr) => deriveAsks({ frameReopen: fr, planExecution }).find((a) => a.born?.ref === key)?.ending;
  assert.equal(endingOf({ ...receipt, answered_elsewhere: undefined }), null, "control: without the twin the ask stays open on the slice that never ran");
  assert.equal(endingOf(receipt)?.kind, "executed", "the ask stayed open though its question was asked and answered");
});
