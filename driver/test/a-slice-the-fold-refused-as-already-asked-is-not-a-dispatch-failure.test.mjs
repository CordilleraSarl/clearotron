// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REMEDY TERM WHOSE SLICE THE FOLD REFUSED AS ALREADY-ASKED WAS RECORDED AS A DISPATCH FAILURE.
//
// The frame reopen mints a slice per remedy term. The fold refuses a mint when the plan already holds a
// row asking the same question, and hands back the twin's qid; such a slice is never frozen into the
// plan and never dispatches. The reopen's own re-attempt knows this — it filters its retry to the qids
// the fold accepted. `classifyRemedyTerm` did not: rule 2 requires every minted qid to land, so it fired
// on the refused slice and returned before rules 3-5 could read the rest of the term.
//
// Measured on a delivered breadth run: one term carried a refused exact-fold slice and an accepted one.
// The plan row it duplicated had run and enumerated 71 records. The term was recorded `dispatch-failed`
// with `slice-not-landed`, and the dominant-element gap stayed open and clamped on that basis. A
// dispatch failure reads as an engine fault a re-run would fix; the truth was that the coverage was
// already on the plan's own row, which a re-run reproduces exactly.
//
// ONLY THE DUPLICATE KIND RESOLVES, and the two controls below are the point. An identity collision and
// a malformed term are genuine faults: nothing else asked those questions, so nothing else answers them
// and the term stays `dispatch-failed`. A fix that let every fold refusal through would close gaps that
// really are open.

import test from "node:test";
import assert from "node:assert/strict";
import { classifyRemedyTerm, accountRemedyTerms } from "../remedy-accounting.mjs";

const REFUSED = "supp:primary-sweep:exact:widgetly:aebd6081";   // minted, refused at the fold
const TWIN = "supp:incumbent-class:exact:widgetly:aebd6081";    // the plan row that already asked it
const ACCEPTED = "supp:primary-sweep:default:widgetly:156081c7";

/** The twin ran and enumerated records — the shape the measured run had. */
const twinBlock = { qid: TWIN, state: "enumerated", total_hits: 71, records: new Array(71).fill({}) };
/** The accepted slice came back a crowd over the enumerate ceiling: material, not empty. */
const crowdBlock = { qid: ACCEPTED, state: "incomplete", total_hits: 18079, records: null };

const term = () => ({ directive: "variant:dominant", layer: "variant", severity: "dominant-element",
  term: "WIDGETLY", predicates: [], qids: [REFUSED, ACCEPTED] });

const world = (foldRefusals) => ({
  blocksByQid: new Map([[TWIN, twinBlock], [ACCEPTED, crowdBlock]]),
  executedQids: new Set([TWIN, ACCEPTED]),
  foldRefusals,
});

const dup = () => new Map([[REFUSED, { kind: "duplicate-question", twin: TWIN }]]);

test("the defect: with no refusal record, the term reads as a dispatch failure", () => {
  // This is the state before the fold started recording WHY it refused. It is kept as an arm because it
  // is what every run already in the archive looks like, and because it pins that the fix is the
  // refusal record and not some other change that happened to land beside it.
  const c = classifyRemedyTerm(term(), world(new Map()));
  assert.equal(c.class, "dispatch-failed");
  assert.equal(c.basis, "slice-not-landed");
  assert.match(c.reason, new RegExp(REFUSED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the reason names the refused qid, which is the pointer that made this diagnosable at all");
});

test("a slice refused as already-asked reads through the twin that answered it", () => {
  const c = classifyRemedyTerm(term(), world(dup()));
  assert.equal(c.class, "found", `expected the term to class on what its question actually returned; got ${c.class} (${c.basis})`);
  assert.equal(c.basis, "band-block");
  assert.equal(c.reason, null);
});

test("the slice row says it was answered elsewhere, and by which row", () => {
  const c = classifyRemedyTerm(term(), world(dup()));
  const s = c.slices.find((x) => x.qid === REFUSED);
  assert.ok(s, "the refused qid keeps a slice row — a term that drops it cannot be audited");
  assert.equal(s.answered_by, TWIN);
  assert.equal(s.refused_at_fold, "duplicate-question");
  const other = c.slices.find((x) => x.qid === ACCEPTED);
  assert.equal(other.answered_by, undefined, "a slice that was not refused carries no substitution");
});

test("CONTROL — an identity collision is still a dispatch failure", () => {
  const c = classifyRemedyTerm(term(), world(new Map([[REFUSED, { kind: "identity-collision", twin: null }]])));
  assert.equal(c.class, "dispatch-failed");
  assert.equal(c.basis, "slice-not-landed");
});

test("CONTROL — a malformed term is still a dispatch failure", () => {
  const c = classifyRemedyTerm(term(), world(new Map([[REFUSED, { kind: "malformed-term", twin: null }]])));
  assert.equal(c.class, "dispatch-failed");
});

test("CONTROL — a duplicate refusal with no twin recorded resolves nothing", () => {
  // The fold always knows the twin, but a legacy receipt does not carry it. Guessing one would be the
  // same invention this issue exists to remove, so the term stays a dispatch failure and says so.
  const c = classifyRemedyTerm(term(), world(new Map([[REFUSED, { kind: "duplicate-question", twin: null }]])));
  assert.equal(c.class, "dispatch-failed");
});

test("CONTROL — the twin must itself have landed; a duplicate of an unrun row is not coverage", () => {
  const c = classifyRemedyTerm(term(), {
    blocksByQid: new Map([[ACCEPTED, crowdBlock]]),   // the twin has no block
    executedQids: new Set([ACCEPTED]),                 // and never executed
    foldRefusals: dup(),
  });
  assert.equal(c.class, "dispatch-failed",
    "resolving to a twin that never ran would close a gap on a question nobody asked");
  assert.equal(c.basis, "slice-not-landed");
});

test("the ledger carries the resolution through, and the totals move with it", () => {
  const args = { terms: [term()], blocksByQid: world(dup()).blocksByQid, executedQids: world(dup()).executedQids };
  const before = accountRemedyTerms({ ...args, foldRefusals: new Map() });
  const after = accountRemedyTerms({ ...args, foldRefusals: dup() });
  assert.equal(before.totals.dispatch_failed, 1);
  assert.equal(before.totals.found, 0);
  assert.equal(after.totals.dispatch_failed, 0);
  assert.equal(after.totals.found, 1);
  assert.equal(after.totals.terms, before.totals.terms, "the term count is the same term counted differently");
  assert.deepEqual(after.not_accounted, [], "a resolved term is accounted, so it leaves the not-accounted list");
});

// ── THE TWO HALVES, JOINED ────────────────────────────────────────────────────────────────────────
//
// Every arm above hands the classifier a hand-written refusal map. That pins the classifier and nothing
// else: were the fold to record a different shape — a different kind string, the twin under another key,
// or nothing at all — those arms would go on passing while the pipeline learned nothing. So the fold is
// driven for real here, and its own output is what the classifier reads.

import { compileRegisterPlan, foldSupplementalEntries } from "../register-plan.mjs";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";

const MARK = "INVENTEDMARK";
const planFor = () => compileRegisterPlan({
  manifest: { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }],
    variants: [{ value: MARK, category: "core" }], incumbent_classes: [] },
  job: { jobKey: "t", classes: ["9"], jurisdictions: [] }, capabilities: CLARIVATE });

/** Mint a proposal the plan already asks, so the fold refuses it as a duplicate. */
function foldARepeatedQuestion() {
  const plan = planFor();
  const asked = plan.entries.find((e) => e.axis === "primary-sweep" && e.predicate === "exact");
  assert.ok(asked, "the compiled plan holds no exact primary-sweep row to duplicate");
  const minted = mintSupplementalEntries("primary-sweep",
    [{ predicate: "exact", term: MARK, nice_classes: [9], regions: [], rationale: "the same question again" }],
    { capabilities: CLARIVATE });
  assert.equal(minted.minted.length, 1, `the mint produced ${minted.minted.length} rows, not one`);
  return { plan, asked, folded: foldSupplementalEntries(plan, minted.minted), minted: minted.minted[0] };
}

test("the fold records WHY it refused, and which plan row already holds the answer", () => {
  const { folded, asked } = foldARepeatedQuestion();
  assert.equal(folded.added.length, 0, "the fold accepted a question the plan already asks");
  assert.equal(folded.refused.length, 1, `expected one refusal, got ${folded.refused.length}`);
  const [r] = folded.refused;
  assert.equal(r.kind, "duplicate-question",
    "the refusal kind is what lets a reader tell an already-answered question from a wiring fault");
  assert.equal(r.twin, asked.qid, "the twin is carried as a field, not only inside the prose");
  assert.match(r.issue, /refused AT THE FOLD/, "the human sentence stays — the field is an addition, not a replacement");
});

test("end to end — the fold's own refusal resolves the term the pipeline builds from it", () => {
  const { folded, asked, minted } = foldARepeatedQuestion();
  // exactly what pipeline.mjs now threads through
  const foldRefusals = new Map(folded.refused.map((r) => [r.qid, { kind: r.kind ?? null, twin: r.twin ?? null }]));
  const landed = { qid: asked.qid, state: "enumerated", total_hits: 71, records: new Array(71).fill({}) };
  const t = { directive: "variant:dominant", layer: "variant", severity: "dominant-element",
    term: MARK, predicates: [], qids: [minted.qid] };
  const world = { blocksByQid: new Map([[asked.qid, landed]]), executedQids: new Set([asked.qid]) };

  assert.equal(classifyRemedyTerm(t, world).class, "dispatch-failed",
    "without the fold's record the term still reads as a failure — that is the defect");
  const c = classifyRemedyTerm(t, { ...world, foldRefusals });
  assert.equal(c.class, "found", `with the fold's own record the term should class on the twin's result; got ${c.class}`);
  assert.equal(c.slices.find((s) => s.qid === minted.qid)?.answered_by, asked.qid);
});
