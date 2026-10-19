// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RE-SWEEP DOES NOT ASK AGAIN FOR A FAMILY THE READING TURN WITHHELD.
//
// On a crowded field the wider register families wait in the plan for the reading turn, and run only
// when it asks for them. The turn records each family it leaves unasked as withheld-by-judgment, with
// its reason. The blind frame comparison's re-sweep turns a main-element request into two questions per
// term, an exact one and a contains one, and the contains question on the mark is one of those waiting
// families. The fold lets a question through when it matches a waiting family, because the reading
// turn's own ask of that question is what the family waits for. So the re-sweep asked a family the turn
// had withheld, and the run's record held the re-ask's open row in place of the family's own.
//
// The re-sweep now refuses an exact repeat of a withheld family before the fold, as `withheld-by-judgment`
// with the family as its twin, and the closure rule settles that slice by the reading turn's recorded
// reason. It is never read as a question that ran, was answered, or came back clean. A missing judgment,
// a failed search, a required row and a different scope inherit nothing, and the family stays waiting, so
// the reading turn can still release it. The arms below follow the slice to every reader that accounts for
// it: the directive, the remedy term ledger, the main-element gap, the run's ask, the plan join, the
// coverage form and the register coverage line. Every mark here is invented.
import test from "node:test";
import assert from "node:assert/strict";
// The re-sweep's helpers are read off the module, not imported by name, so that on a tree without them each
// arm that needs them fails on its own and every other arm still runs and reports.
import * as registerPlan from "../register-plan.mjs";
import { compileRegisterPlan, foldSupplementalEntries, joinPlanToBands, deriveCoverageSkeleton } from "../register-plan.mjs";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { verifyRegisterDirectiveClose, answeredAs } from "../close-verify.mjs";
import { classifyRemedyTerm, accountRemedyTerms, domClosedOverAccounted, mintRemedyAccountingDoubts, remedyAccountingEvent } from "../remedy-accounting.mjs";
import { deriveAsks, applyAskClosure } from "../ask-ledger.mjs";
import { STAGES, paths as stagePaths } from "../stages.mjs";
import { coverageFormRows } from "../coverage-form.mjs";
import { deriveScopeFacts } from "../scope-facts.mjs";
import { frameResidualGaps, partitionFiring, reopenKey } from "../frame-diff-model.mjs";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";

const MARK = "INVENTEDMARK";
const FAMILY = "primary-sweep:default:inventedmark";   // the contains question on the mark, waiting for the reading turn
const IDENTICAL = "primary-sweep:exact:inventedmark";  // the identical question, which never waits
const REASON = "the identical list already shows every mark a buyer would confuse with this one";
const withheldRecord = () => ({ [FAMILY]: { axis: "primary-sweep", reason: REASON } });   // the shape readWithheldFamilies returns

const planFor = () => compileRegisterPlan({
  manifest: { schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
    variants: [{ value: MARK, category: "core" }], incumbent_classes: [] },
  job: { jobKey: "t", classes: ["9"], jurisdictions: [] }, capabilities: CLARIVATE });

/** What the re-sweep mints for a main-element request on the mark: the exact question and the contains one. */
function mintMainElementRequest(extra = {}) {
  const base = { nice_classes: [9], regions: [], rationale: "frame-reopen variant: the main element was not fully searched", ...extra };
  const { minted } = mintSupplementalEntries("primary-sweep",
    [{ ...base, predicate: "exact", term: MARK }, { ...base, predicate: "default", term: MARK }], { capabilities: CLARIVATE });
  assert.equal(minted.length, 2, "guard: the mint produced the exact and the contains question");
  return { exact: minted.find((m) => m.predicate === "exact"), contains: minted.find((m) => m.predicate === "default"), minted };
}

/** The frame-reopen fold as the pipeline runs it: the withheld repeats refused first, the rest folded. */
function resweepFold(plan, minted, withheld = withheldRecord(), released = new Set()) {
  const twins = registerPlan.withheldFamilyTwins(plan, withheld, released);
  const { kept, refused: withheldRefused } = registerPlan.refuseWithheldFamilies(minted, twins, plan);
  const folded = foldSupplementalEntries(plan, kept);
  const refused = [...withheldRefused, ...folded.refused];
  // exactly what the pipeline threads through to the directive check and the remedy ledger
  const foldRefusals = new Map(refused.map((r) => [r.qid, { kind: r.kind ?? null, twin: r.twin ?? null, reason: r.reason ?? null }]));
  return { plan: folded.plan, added: folded.added, refused, foldRefusals };
}

const listed = (qid, n) => ({ qid, state: "enumerated", total_hits: n, records: new Array(n).fill({}) });
const countedZero = (qid) => ({ qid, state: "enumerated", total_hits: 0, records: [] });
const crowd = (qid) => ({ qid, state: "incomplete", total_hits: 12000, records: null });

// ── THE REFUSAL ──────────────────────────────────────────────────────────────────────────────────────

test("an exact repeat of a family the reading turn withheld is refused, with the family as its twin, and nothing is folded for it", () => {
  const plan = planFor();
  assert.ok(plan.entries.some((e) => e.qid === FAMILY && e.when?.awaits_reading_turn === true), "guard: the contains question on the mark waits for the reading turn");
  const { exact, contains, minted } = mintMainElementRequest();
  assert.ok(foldSupplementalEntries(plan, minted).added.includes(contains.qid),
    "control: without the screen the fold takes the repeat, which is how the re-sweep asked the withheld family");
  const r = resweepFold(plan, minted);
  assert.deepEqual(r.refused.find((x) => x.qid === contains.qid),
    { qid: contains.qid, term: MARK, kind: "withheld-by-judgment", twin: FAMILY, reason: REASON });
  assert.equal(r.refused.find((x) => x.qid === exact.qid)?.kind, "duplicate-question", "the exact question is still the plan's own, answered by its twin");
  assert.deepEqual(r.added, [], "both questions are already settled, so nothing is added and nothing is sent");
  assert.equal(r.plan.plan_version, plan.plan_version, "the plan is not re-versioned for a fold that added nothing");
});

test("missing judgment cannot inherit it: a waiting family nobody judged, or one recorded with no reason, is still asked", () => {
  const plan = planFor();
  const { contains, minted } = mintMainElementRequest();
  for (const withheld of [{}, { [FAMILY]: { axis: "primary-sweep", reason: "   " } }]) {
    const r = resweepFold(plan, minted, withheld);
    assert.ok(r.added.includes(contains.qid), `the repeat was refused on ${JSON.stringify(withheld)}`);
    assert.ok(!r.refused.some((x) => x.kind === "withheld-by-judgment"));
  }
});

test("a different scope cannot inherit it: the same term in other classes, other offices or narrowed by goods is folded and asked", () => {
  const plan = planFor();
  for (const extra of [{ nice_classes: [9, 35] }, { regions: ["US"] }, { goods_words: ["software"] }]) {
    const { contains, minted } = mintMainElementRequest(extra);
    const r = resweepFold(plan, minted);
    assert.ok(r.added.includes(contains.qid), `a narrower or wider question was refused as the withheld one: ${JSON.stringify(extra)}`);
  }
});

test("a released family, or one another plan row already asks, is not withheld", () => {
  const plan = planFor();
  const { contains, minted } = mintMainElementRequest();
  // A release replaces the withholding: the family is asked, and the re-sweep's question is not refused for it.
  assert.ok(resweepFold(plan, minted, withheldRecord(), new Set([FAMILY])).added.includes(contains.qid));
  // A question that RAN answers the repeat: the fold's duplicate rule, with the row that ran as its twin.
  const asker = mintSupplementalEntries("primary-sweep",
    [{ predicate: "default", term: MARK, nice_classes: [9], regions: [], rationale: "the reading turn's own ask" }], { capabilities: CLARIVATE }).minted;
  const asked = foldSupplementalEntries(plan, asker.map((e) => ({ ...e, qid: `${e.qid}-asked` }))).plan;
  const r = resweepFold(asked, minted);
  const refusal = r.refused.find((x) => x.qid === contains.qid);
  assert.equal(refusal?.kind, "duplicate-question", "a question the plan already asked is answered by the row that asked it");
  assert.equal(refusal?.twin, `${asker[0].qid}-asked`);
});

test("a record cannot hand its judgment to a required question or across axes: naming a row that does not wait, or a family on another axis, settles nothing", () => {
  const plan = planFor();
  const { exact, contains, minted } = mintMainElementRequest();
  const required = resweepFold(plan, minted, { [IDENTICAL]: { axis: "primary-sweep", reason: REASON } });
  assert.notEqual(required.refused.find((x) => x.qid === exact.qid)?.kind, "withheld-by-judgment", "the identical question is required and never waits");
  const elsewhere = resweepFold(plan, minted, { [FAMILY]: { axis: "transliteration-numeric", reason: REASON } });
  assert.ok(elsewhere.added.includes(contains.qid), "a record about another axis is not the reading turn's judgment on this family");
});

test("the reading turn can still reconsider: the refusal leaves the family waiting, unasked, and its record untouched", () => {
  const plan = planFor();
  const withheld = withheldRecord();
  const before = JSON.stringify(withheld);
  const r = resweepFold(plan, mintMainElementRequest().minted, withheld);
  assert.equal(JSON.stringify(withheld), before, "the record is read, never written");
  const family = r.plan.entries.find((e) => e.qid === FAMILY);
  assert.equal(family?.when?.awaits_reading_turn, true, "the family still waits for the reading turn's ask");
  const join = joinPlanToBands(r.plan, { "primary-sweep": [listed(IDENTICAL, 40)] });
  assert.ok(join.awaiting.some((x) => x.qid === FAMILY), "and the join still reads it as a question nobody asked");
  assert.ok(!join.asked.some((x) => x.qid === FAMILY));
});

// ── THE CLOSURE RULE ─────────────────────────────────────────────────────────────────────────────────

/** The refusal record the re-sweep's fold writes for a withheld repeat, for the arms that vary it. */
const withheldRefusal = (over = {}) => ({ kind: "withheld-by-judgment", twin: FAMILY, reason: REASON, ...over });
/**
 * Both questions refused, on real minted qids: the exact question refused as the plan's own, answered by the
 * identical row that ran and listed 40 records, and the contains question refused as the withheld family's.
 * The record is written out here, in the shape the first arm pins the fold to, so that each reader below is
 * tested on its own; the end-to-end arm after this one reads the fold's own record.
 */
const bothRefused = () => {
  const { exact, contains } = mintMainElementRequest();
  const foldRefusals = new Map([[exact.qid, { kind: "duplicate-question", twin: IDENTICAL, reason: null }], [contains.qid, withheldRefusal()]]);
  return { exact: exact.qid, contains: contains.qid, foldRefusals,
    world: { executedQids: new Set([IDENTICAL]), blocksByQid: new Map([[IDENTICAL, listed(IDENTICAL, 40)]]) } };
};

test("the closure rule settles a withheld slice by the reading turn's judgment, and names it without calling it answered", () => {
  const exact = "supp:primary-sweep:exact:inventedmark:00000001", contains = "supp:primary-sweep:default:inventedmark:00000002";
  const world = { executedQids: new Set([IDENTICAL]), blocksByQid: new Map([[IDENTICAL, listed(IDENTICAL, 40)]]) };
  const foldRefusals = new Map([[exact, { kind: "duplicate-question", twin: IDENTICAL }], [contains, withheldRefusal()]]);
  const v = verifyRegisterDirectiveClose({ qids: [exact, contains], ...world, foldRefusals });
  assert.equal(v.closed, true, `the directive stayed deferred: ${v.reason}`);
  assert.deepEqual(v.answered_by, [{ qid: exact, twin: IDENTICAL }], "only the duplicate is answered by a row that ran");
  assert.deepEqual(v.withheld_by_judgment, [{ qid: contains, family: FAMILY }]);
  assert.equal(answeredAs(contains, foldRefusals), contains, "the duplicate rule does not resolve a withheld slice to anything");
});

test("the same holds for the fold's own record, end to end, and for a directive whose every slice was withheld", () => {
  const plan = planFor();
  const minted = mintMainElementRequest();
  const { foldRefusals } = resweepFold(plan, minted.minted);
  const { exact, contains, world } = bothRefused();
  assert.deepEqual([...foldRefusals.entries()].sort(), [...bothRefused().foldRefusals.entries()].sort(), "the record the readers are tested on is the fold's own");
  const v = verifyRegisterDirectiveClose({ qids: [exact, contains], ...world, foldRefusals });
  assert.equal(v.closed, true, `the directive stayed deferred: ${v.reason}`);
  assert.deepEqual(v.withheld_by_judgment, [{ qid: contains, family: FAMILY }]);
  const only = verifyRegisterDirectiveClose({ qids: [contains], executedQids: new Set(), blocksByQid: new Map(), foldRefusals });
  assert.equal(only.closed, true, `a directive settled wholly by the reading turn's record stayed deferred: ${only.reason}`);
  assert.equal(only.answered_by, undefined, "nothing answered it");
  assert.deepEqual(only.withheld_by_judgment, [{ qid: contains, family: FAMILY }]);
});

test("nothing less settles a slice: no reason, no twin, another kind, or a failed sibling slice leaves the directive deferred", () => {
  const contains = "supp:primary-sweep:default:inventedmark:00000002";
  const empty = { executedQids: new Set(), blocksByQid: new Map() };
  for (const r of [withheldRefusal({ reason: null }), withheldRefusal({ reason: " " }), withheldRefusal({ twin: null }),
    { kind: "duplicate-question", twin: FAMILY, reason: REASON }, { kind: "malformed-term", twin: FAMILY, reason: REASON }]) {
    const v = verifyRegisterDirectiveClose({ qids: [contains], ...empty, foldRefusals: new Map([[contains, r]]) });
    assert.equal(v.closed, false, `${JSON.stringify(r)} closed a directive whose question never ran`);
  }
  // A failed search cannot hide behind a withheld sibling: the directive is deferred on the slice that failed.
  const failed = "supp:primary-sweep:exact:lanternwick:00000003";
  for (const qids of [[failed, contains], [contains, failed]]) {
    const v = verifyRegisterDirectiveClose({ qids, ...empty, foldRefusals: new Map([[contains, withheldRefusal()]]) });
    assert.deepEqual([v.closed, v.reason], [false, `slice-not-landed:${failed}`], `slices in the order ${qids.join(", ")}`);
    assert.equal(v.answered_by, undefined, "a withheld slice answers nothing, whatever its place in the list");
  }
  // and what is missing in each control above is the only difference: the whole record does settle the slice.
  assert.equal(verifyRegisterDirectiveClose({ qids: [contains], ...empty, foldRefusals: new Map([[contains, withheldRefusal()]]) }).closed, true);
});

// ── THE REMEDY TERM LEDGER ───────────────────────────────────────────────────────────────────────────

const term = (qids) => ({ directive: "variant:inventedmark", layer: "variant", severity: "dominant-element", term: MARK, predicates: [], qids });

test("the remedy ledger: a term whose other slice found records is found, and its withheld slice says it was withheld, not answered", () => {
  const { exact, contains, foldRefusals, world } = bothRefused();
  assert.equal(classifyRemedyTerm(term([exact, contains]), { ...world, foldRefusals: new Map([[exact, foldRefusals.get(exact)]]) }).class,
    "dispatch-failed", "control: without the withheld record the slice reads as a search that failed to run");
  const c = classifyRemedyTerm(term([exact, contains]), { ...world, foldRefusals });
  assert.equal(c.class, "found", `${c.class} (${c.basis}): ${c.reason}`);
  const s = c.slices.find((x) => x.qid === contains);
  assert.equal(s.refused_at_fold, "withheld-by-judgment");
  assert.equal(s.withheld_as, FAMILY);
  assert.equal(s.executed, false, "it never ran");
  assert.equal(s.answered_by, undefined, "and nothing answered it");
  assert.equal(s.total_hits, null, "no count is claimed for it");
});

test("a term whose every slice was withheld, or whose other slices came back empty, is withheld-by-judgment — never searched-empty", () => {
  const { exact, contains, foldRefusals } = bothRefused();
  const all = classifyRemedyTerm(term([contains]), { executedQids: new Set(), blocksByQid: new Map(), foldRefusals });
  assert.equal(all.class, "withheld-by-judgment", `${all.class} (${all.basis}): ${all.reason}`);
  const zero = { executedQids: new Set([IDENTICAL]), blocksByQid: new Map([[IDENTICAL, countedZero(IDENTICAL)]]) };
  const mixed = classifyRemedyTerm(term([exact, contains]), { ...zero, foldRefusals });
  assert.equal(mixed.class, "withheld-by-judgment", "a counted zero beside a question nobody asked is not a clean result for the term");
  assert.equal(classifyRemedyTerm(term([exact]), { ...zero, foldRefusals }).class, "searched-empty", "control: the counted zero alone is searched-empty");
});

test("a failed search cannot inherit it: a withheld slice beside a slice that did not land leaves the term dispatch-failed", () => {
  const { contains, foldRefusals } = bothRefused();
  const failed = "supp:primary-sweep:exact:lanternwick:00000003";
  const c = classifyRemedyTerm(term([contains, failed]), { executedQids: new Set(), blocksByQid: new Map(), foldRefusals });
  assert.equal(c.class, "dispatch-failed");
  assert.match(c.reason, /slice-not-landed:supp:primary-sweep:exact:lanternwick/, "the failure named is the search that did not land");
  assert.ok(!c.reason.includes(contains), "never the slice the reading turn withheld");
});

test("the main-element gap closes on a withheld slice where the twin ran and where every slice was withheld, and stays open on a failure", () => {
  const { exact, contains, foldRefusals, world } = bothRefused();
  const key = "variant:inventedmark";
  const directives = [{ key, layer: "variant", severity: "dominant-element" }];
  const gap = (qids, w) => {
    const v = verifyRegisterDirectiveClose({ qids, ...w, foldRefusals });
    const accounting = accountRemedyTerms({ terms: [term(qids)], ...w, foldRefusals });
    return domClosedOverAccounted({ directives, swept: v.closed ? [key] : [], accounting, reopenKeyOf: (d) => d.key });
  };
  assert.equal(gap([exact, contains], world).domClosed, true, "the twin ran and the rest is the reading turn's judgment");
  assert.equal(gap([contains], { executedQids: new Set(), blocksByQid: new Map() }).domClosed, true,
    "a request settled wholly by the reading turn's judgment holds no CLEAR open");
  const failed = "supp:primary-sweep:exact:lanternwick:00000003";
  const open = gap([failed, contains], { executedQids: new Set(), blocksByQid: new Map() });
  assert.equal(open.domClosed, false, "a search that did not land keeps the gap open");
  // and with the term ledger's verdict alone, a directive closed elsewhere is still blocked by a failed term
  const blocked = domClosedOverAccounted({ directives, swept: [key], reopenKeyOf: (d) => d.key,
    accounting: accountRemedyTerms({ terms: [term([failed, contains])], executedQids: new Set(), blocksByQid: new Map(), foldRefusals }) });
  assert.deepEqual(blocked.blockedBy.map((b) => b.class), ["dispatch-failed"]);
});

test("no doubt and no unfinished count: the ledger keeps the withheld term apart from every not-accounted class", () => {
  const { contains, foldRefusals } = bothRefused();
  const a = accountRemedyTerms({ terms: [term([contains])], executedQids: new Set(), blocksByQid: new Map(), foldRefusals });
  assert.equal(a.totals.terms, 1);
  assert.equal(a.totals.withheld_by_judgment, 1);
  for (const k of ["found", "searched_empty", "not_dispatched", "dispatch_failed", "unaccounted"]) assert.equal(a.totals[k], 0, k);
  assert.deepEqual(a.not_accounted, [], "a term settled by the reading turn's record is not an open question");
  assert.deepEqual(mintRemedyAccountingDoubts(a), []);
  // the audit seam mints from the receipt's rows; a withheld row given to the mint still mints nothing
  assert.deepEqual(mintRemedyAccountingDoubts({ not_accounted: a.rows }), []);
  const row = remedyAccountingEvent({ trigger: "frame-reopen", artifact: a });
  assert.equal(row.withheld_by_judgment, 1, "the run log row carries the class like every other");
  assert.equal(remedyAccountingEvent({ trigger: "frame-reopen", artifact: null }).withheld_by_judgment, null, "and null, not absent, when the ledger did not build");
});

// ── THE RUN'S ASK ────────────────────────────────────────────────────────────────────────────────────

const asksFor = (receipt, extra = {}) => deriveAsks({ frameReopen: receipt, ...extra }).filter((a) => a.born?.ref === receipt.requested[0]);
const askFor = (receipt, extra = {}) => asksFor(receipt, extra)[0];

/** A directive with one slice that ran through its twin and one slice the reading turn withheld. */
function mixedReceipt() {
  const { exact, contains } = bothRefused();
  const key = "variant:inventedmark";
  return { exact, contains, receipt: { requested: [key], swept: [key], deferrals: [], directive_qids: { [key]: [exact, contains] },
    answered_elsewhere: [{ directive: key, slices: [{ qid: exact, twin: IDENTICAL }] }],
    withheld_by_judgment: [{ directive: key, slices: [{ qid: contains, family: FAMILY }] }] } };
}

test("a directive with a slice that ran and a slice the reading turn withheld keeps each slice's disposition, and calls neither by the other's", () => {
  const { exact, contains, receipt } = mixedReceipt();
  const planExecution = { executed: [{ qid: IDENTICAL, state: "enumerated", records: 40, total_hits: 40 }] };
  assert.equal(askFor({ ...receipt, withheld_by_judgment: undefined }, { planExecution }).ending, null,
    "control: read without the withheld slices the ask stays open on a question that never ran");
  const asks = asksFor(receipt, { planExecution, withheldFamilies: withheldRecord() });
  assert.equal(asks.length, 2, `one record for what ran, one for what was withheld: ${JSON.stringify(asks)}`);
  const [ran, withheld] = asks;
  assert.equal(ran.ending?.kind, "executed");
  assert.match(ran.ending.evidence, /primary-sweep:exact:inventedmark \(returned 40 records\)/);
  assert.ok(!ran.ending.evidence.includes(contains) && !ran.ending.evidence.includes(FAMILY), "the withheld question is not called executed");
  assert.deepEqual(ran.qids, [exact], "and the record that ran lists only the slice that ran");
  assert.equal(withheld.ending?.kind, "judged-immaterial");
  assert.equal(withheld.ending.by, "reading-turn");
  assert.deepEqual(withheld.ending.reasons, [REASON], "the withheld slice keeps the reading turn's reason, word for word");
  assert.deepEqual(withheld.qids, [contains]);
  assert.equal(withheld.handoff, null);
  assert.equal(withheld.ask.text, ran.ask.text, "it is the same question, asked once");
  assert.notEqual(withheld.ask_id, ran.ask_id, "and each record keeps its own id");
});

test("beside a withheld slice, a slice that did not run stays unresolved: open when the execution record cannot confirm it, a recovery when it was deferred", () => {
  const { receipt } = mixedReceipt();
  const kinds = (planExecution) => asksFor(receipt, { planExecution, withheldFamilies: withheldRecord() }).map((a) => a.ending?.kind ?? "open");
  assert.deepEqual(kinds({ executed: [] }), ["open", "judged-immaterial"], "unconfirmed: the slice that should have run stays open");
  assert.deepEqual(kinds({ executed: [], deferred: [{ qid: IDENTICAL, reason: "the register answered with an error" }] }), ["recovery", "judged-immaterial"],
    "deferred: it is handed over as a recovery");
  assert.deepEqual(asksFor(receipt, { planExecution: { executed: [] }, withheldFamilies: {} }).map((a) => a.ending?.kind ?? "open"), ["open", "open"],
    "and without the turn's record the withheld slice has no judgment to end on, so it is open too");
});

test("a directive whose withheld slices repeat two families, one still withheld and one the turn released after the fold, ends each slice on what happened to it", () => {
  const { exact, receipt: mixed } = mixedReceipt();
  const key = mixed.requested[0];
  const second = `${FAMILY}+merch`;   // a second waiting family, which the reading turn released after the fold
  const receipt = { ...mixed, directive_qids: { [key]: [exact, "slice:withheld", "slice:released"] },
    withheld_by_judgment: [{ directive: key, slices: [{ qid: "slice:withheld", family: FAMILY }, { qid: "slice:released", family: second }] }] };
  const identical = { qid: IDENTICAL, state: "enumerated", records: 40, total_hits: 40 };
  // The release deleted the second family's withholding from the record; the first keeps the turn's reason.
  const asks = asksFor(receipt, { planExecution: { executed: [identical, { qid: second, state: "enumerated", records: 3, total_hits: 3 }] }, withheldFamilies: withheldRecord() });
  assert.deepEqual(asks.map((a) => [a.ending?.kind ?? "open", a.qids]),
    [["executed", [exact]], ["judged-immaterial", ["slice:withheld"]], ["executed", ["slice:released"]]], JSON.stringify(asks));
  assert.deepEqual(asks[1].ending.reasons, [REASON], "the family still withheld keeps the reading turn's reason");
  assert.match(asks[2].ending.evidence, /: primary-sweep:default:inventedmark\+merch \(returned 3 records\)$/, "the released family ends on its own run, and names only itself");
  assert.equal(new Set(asks.map((a) => a.ask_id)).size, 3, "each record keeps its own id");
  assert.deepEqual(asks.map((a) => a.part), ["ran", "family", "family"], "the slices that ran are one part, and each family its own");
  const notRun = asksFor(receipt, { planExecution: { executed: [identical] }, withheldFamilies: withheldRecord() });
  assert.deepEqual(notRun.map((a) => a.ending?.kind ?? "open"), ["executed", "judged-immaterial", "open"],
    "released and never run, that slice stays open, and the judgment on the other is still shown");
  const noneRan = asksFor({ ...receipt, directive_qids: { [key]: ["slice:withheld", "slice:released"] } }, { planExecution: { executed: [] }, withheldFamilies: withheldRecord() });
  assert.deepEqual(noneRan.map((a) => a.ending?.kind ?? "open"), ["judged-immaterial", "open"], "with no slice that ran, the same split holds");
});

// ── A PART KEEPS ITS ID, AND A CLOSURE SETTLES ONLY THE PART IT NAMES ─────────────────────────────

/** A request with a slice that should have run and a slice whose family the turn released and nothing ran. */
function twoOpenParts(order = (xs) => xs) {
  const { exact, receipt: mixed } = mixedReceipt();
  const key = mixed.requested[0];
  return { key, receipt: { ...mixed, directive_qids: { [key]: order([exact, "slice:released"]) },
    withheld_by_judgment: [{ directive: key, slices: [{ qid: "slice:released", family: FAMILY }] }] } };
}
const CITED = "an invented line the closure cites";
const immaterial = (id) => ({ id, verdict: "IMMATERIAL", file: "findings.json", quote: CITED, reason: "an invented reason" });
const kinds = (asks) => Object.fromEntries(asks.map((a) => [a.ask_id, a.ending?.kind ?? "open"]));

test("two open parts of one request: a closure naming one part settles that part alone, and an id no part carries settles nothing", () => {
  const { key, receipt } = twoOpenParts();
  const asks = asksFor(receipt, { planExecution: { executed: [] }, withheldFamilies: {} });
  assert.deepEqual(asks.map((a) => a.ending?.kind ?? "open"), ["open", "open"]);
  const [ran, fam] = asks;
  assert.match(ran.ask_id, /^ask:frame:variant-inventedmark-[0-9a-f]{8}$/, "the part that should have run keeps the request's own id");
  assert.equal(ran.legacy_id, `ask:frame:${key.replace(/[^a-z0-9]+/g, "-")}`, "the ran part keeps the short id a closure written before the hash cites");
  assert.match(fam.ask_id, /^ask:frame:variant-inventedmark-[0-9a-f]{8}:family:primary-sweep-default-inventedmark-[0-9a-f]{8}$/, "the family's part is named for its family");
  assert.equal(fam.legacy_id, undefined, "a family part has no short id an old closure could have meant");
  assert.deepEqual([ran.part, fam.part, fam.family], ["ran", "family", FAMILY]);
  const files = { "findings.json": CITED };
  const one = applyAskClosure(asks, [immaterial(fam.ask_id)], files).asks;
  assert.deepEqual(kinds(one), { [ran.ask_id]: "open", [fam.ask_id]: "judged-immaterial" }, "the cited part settles; its sibling stays open");
  const other = applyAskClosure(asks, [immaterial(ran.ask_id)], files).asks;
  assert.deepEqual(kinds(other), { [ran.ask_id]: "judged-immaterial", [fam.ask_id]: "open" });
  // With no slice that ran, no part carries the request's own id, so a citation of it settles nothing.
  const settledOnly = asksFor({ ...receipt, directive_qids: { [key]: ["slice:released"] } }, { planExecution: { executed: [] }, withheldFamilies: {} });
  assert.equal(settledOnly.length, 1);
  assert.deepEqual(kinds(applyAskClosure(settledOnly, [immaterial(ran.ask_id)], files).asks), { [settledOnly[0].ask_id]: "open" });
});

// ── TWO REQUESTS NEVER SHARE AN ID ────────────────────────────────────────────────────────────────
// The slug cuts at 48 characters and folds punctuation, so two directives that differ only after the cut, or only
// in punctuation, gave one id, and the second request's obligation was dropped. Each id now carries a hash of the
// whole directive. A closure written before the hash names the short id: it settles the one request still carrying
// that short id, and none where two do.
const CUT_A = "register:check the identical spelling in the ordered classes for the north american market";
const CUT_B = "register:check the identical spelling in the ordered classes for the european union market";
const FOLD_A = "variant:invented-mark";
const FOLD_B = "variant:invented mark";
const openRequests = (keys) => deriveAsks({ frameReopen: { requested: keys, swept: keys, deferrals: [],
  directive_qids: Object.fromEntries(keys.map((k, i) => [k, [`slice:q${i}:${k.length}`]])) }, planExecution: { executed: [] } })
  .filter((a) => a.born?.artifact === "_driver/frame-reopen.json");

test("two requests that differ only after the slug's cut, or only in punctuation, keep two asks, whatever their order", () => {
  for (const [a, b] of [[CUT_A, CUT_B], [FOLD_A, FOLD_B]]) {
    const asks = openRequests([a, b]);
    assert.equal(asks.length, 2, `one request was dropped: ${JSON.stringify(asks.map((x) => x.ask_id))}`);
    assert.equal(asks[0].legacy_id, asks[1].legacy_id, "premise: the two requests shared the short id");
    assert.notEqual(asks[0].ask_id, asks[1].ask_id, "the two requests share an id");
    const reversed = openRequests([b, a]);
    assert.deepEqual(Object.fromEntries(reversed.map((x) => [x.born.ref, x.ask_id])), Object.fromEntries(asks.map((x) => [x.born.ref, x.ask_id])),
      "a request's id depends on the order the requests came in");
    // A closure names one of them and settles that one alone.
    const files = { "findings.json": CITED };
    const one = applyAskClosure(asks, [immaterial(asks[1].ask_id)], files).asks;
    assert.deepEqual(kinds(one), { [asks[0].ask_id]: "open", [asks[1].ask_id]: "judged-immaterial" });
  }
});

test("a closure that names a request's short id settles the one request that has it, and none where two do", () => {
  const files = { "findings.json": CITED };
  const [only] = openRequests([CUT_A]);
  const alone = applyAskClosure([only], [immaterial(only.legacy_id)], files);
  assert.deepEqual(kinds(alone.asks), { [only.ask_id]: "judged-immaterial" }, "an old closure of an unambiguous request no longer settles it");
  const both = openRequests([CUT_A, CUT_B]);
  const shared = applyAskClosure(both, [immaterial(both[0].legacy_id)], files);
  assert.deepEqual(kinds(shared.asks), { [both[0].ask_id]: "open", [both[1].ask_id]: "open" }, "an ambiguous old closure settled a request it may not have judged");
  assert.deepEqual(shared.unverified.map((u) => [u.ask_id, [...u.ambiguous].sort()]), [[both[0].legacy_id, [both[0].ask_id, both[1].ask_id].sort()]],
    "the ambiguous citation is not reported with the requests it could have meant");
});

test("an old short-id closure is ambiguous when another request with that short id is now kept only as family parts", () => {
  // Request A's one slice is a family the reading turn withheld, so A is kept only as its family part; request B has an
  // unanswered slice that should have run. Both had one short id. An old closure of it could have meant either.
  const receipt = { requested: [CUT_A, CUT_B], swept: [CUT_A, CUT_B], deferrals: [],
    directive_qids: { [CUT_A]: ["slice:a:withheld"], [CUT_B]: ["slice:b:open"] },
    withheld_by_judgment: [{ directive: CUT_A, slices: [{ qid: "slice:a:withheld", family: FAMILY }] }] };
  const files = { "findings.json": CITED };
  for (const [what, withheldFamilies] of [["withheld", withheldRecord()], ["released and unanswered", {}]]) {
    const asks = deriveAsks({ frameReopen: receipt, planExecution: { executed: [] }, withheldFamilies }).filter((a) => a.born?.artifact === "_driver/frame-reopen.json");
    const a = asks.find((x) => x.born.ref === CUT_A), b = asks.find((x) => x.born.ref === CUT_B);
    assert.deepEqual([a?.part, b?.part ?? "single"], ["family", "single"], `${what}: premise: A is only its family part, B its own`);
    assert.match(String(b.legacy_id), /^ask:frame:register-check-the-identical-spelling/, `${what}: premise: B keeps its short id for old closures`);
    const shared = applyAskClosure(asks, [immaterial(b.legacy_id)], files);
    assert.deepEqual(kinds(shared.asks), kinds(asks), `${what}: the ambiguous old closure settled a request it may not have judged`);
    assert.equal(a.short_id, b.legacy_id, `${what}: A's parts do not record the short id it shared`);
    assert.deepEqual(shared.unverified.map((u) => u.ask_id), [b.legacy_id], `${what}: the ambiguous citation is not reported`);
  }
});

test("the closure step is shown which part of a request each open ask is, as the pipeline hands them over", async () => {
  const { openAskForClosure } = await import("../pipeline.mjs");
  const { receipt } = twoOpenParts();
  const openAsks = asksFor(receipt, { planExecution: { executed: [] }, withheldFamilies: {} }).map(openAskForClosure);
  const msg = STAGES["doubt-closure"].message({ paths: stagePaths("/nonexistent/invented-run"), openDoubts: [], openAsks });
  const lines = msg.split("\n").filter((l) => openAsks.some((a) => l.startsWith(`- ${a.ask_id} — `)));
  assert.equal(lines.length, 2, "premise: both parts are listed");
  for (const a of openAsks) assert.ok(lines.some((l) => l.startsWith(`- ${a.ask_id} — `) && l.endsWith(`(${a.qids.join(", ")})`)),
    `${a.ask_id}: the closure step cannot tell this part from its sibling`);
});

test("a part's id does not depend on slice order, does not move when its family is released and runs, and survives a save and reload", () => {
  const { receipt } = twoOpenParts();
  const { receipt: reversed } = twoOpenParts((xs) => [...xs].reverse());
  const identical = { qid: IDENTICAL, state: "enumerated", records: 40, total_hits: 40 };
  const withheld = asksFor(receipt, { planExecution: { executed: [identical] }, withheldFamilies: withheldRecord() });
  assert.deepEqual(kinds(asksFor(reversed, { planExecution: { executed: [identical] }, withheldFamilies: withheldRecord() })), kinds(withheld),
    "reversed slices give the same parts with the same endings");
  // The turn later releases the family and it runs: the same part, the same id, a new ending.
  const released = asksFor(receipt, { planExecution: { executed: [identical, { qid: FAMILY, state: "enumerated", records: 3, total_hits: 3 }] }, withheldFamilies: {} });
  assert.deepEqual(released.map((a) => a.ask_id), withheld.map((a) => a.ask_id));
  assert.deepEqual(withheld.map((a) => a.ending?.kind), ["executed", "judged-immaterial"]);
  assert.deepEqual(released.map((a) => a.ending?.kind), ["executed", "executed"]);
  // Saved to asks.json and read back, the records keep their ids and close exactly as before.
  const open = asksFor(receipt, { planExecution: { executed: [] }, withheldFamilies: {} });
  const reloaded = JSON.parse(JSON.stringify(open));
  const files = { "findings.json": CITED };
  assert.deepEqual(kinds(applyAskClosure(reloaded, [immaterial(open[1].ask_id)], files).asks), kinds(applyAskClosure(open, [immaterial(open[1].ask_id)], files).asks));
});

test("the closure step is shown each part's own questions, beside the shared question text", () => {
  const { receipt } = twoOpenParts();
  const openAsks = asksFor(receipt, { planExecution: { executed: [] }, withheldFamilies: {} });
  const msg = STAGES["doubt-closure"].message({ paths: stagePaths("/nonexistent/invented-run"), openDoubts: [], openAsks });
  for (const a of openAsks) assert.ok(msg.includes(`- ${a.ask_id} — [frame-diff] ${a.ask.text} (${a.qids.join(", ")})`), `the part ${a.ask_id} is listed with its questions:\n${msg}`);
  // An ask that is not part of a request is listed as before.
  const plain = { ...openAsks[0], ask_id: "ask:invented:plain", part: undefined };
  const msg2 = STAGES["doubt-closure"].message({ paths: stagePaths("/nonexistent/invented-run"), openDoubts: [], openAsks: [plain] });
  assert.ok(msg2.includes(`- ask:invented:plain — [frame-diff] ${plain.ask.text}\n`) || msg2.endsWith(`- ask:invented:plain — [frame-diff] ${plain.ask.text}`), msg2);
});

test("every slice withheld: the ask ends judged immaterial on the reading turn's own reason, and stays open when that record is gone", () => {
  const { contains } = bothRefused();
  const key = "variant:inventedmark";
  const receipt = { requested: [key], swept: [key], deferrals: [], directive_qids: { [key]: [contains] },
    withheld_by_judgment: [{ directive: key, slices: [{ qid: contains, family: FAMILY }] }] };
  const ask = askFor(receipt, { planExecution: { executed: [] }, withheldFamilies: withheldRecord() });
  assert.equal(ask.ending?.kind, "judged-immaterial");
  assert.deepEqual(ask.ending.reasons, [REASON], "the reason is the reading turn's, word for word");
  assert.equal(ask.handoff, null);
  assert.equal(askFor(receipt, { planExecution: { executed: [] }, withheldFamilies: {} }).ending, null,
    "without the record there is no judgment to show, so the ask stays open");
});

test("a family the reading turn released after the fold, and asked then: the ask ends on what the execution record says of it, never open", () => {
  const { contains } = bothRefused();
  const key = "variant:inventedmark";
  const receipt = { requested: [key], swept: [key], deferrals: [], directive_qids: { [key]: [contains] },
    withheld_by_judgment: [{ directive: key, slices: [{ qid: contains, family: FAMILY }] }] };
  // The release deleted the family's withholding from the record; the family itself then ran.
  const ask = askFor(receipt, { planExecution: { executed: [{ qid: FAMILY, state: "enumerated", records: 3, total_hits: 3 }] }, withheldFamilies: {} });
  assert.equal(ask.ending?.kind, "executed", `the frame ask: ${JSON.stringify(ask)}`);
  assert.ok(ask.ending.evidence.includes(FAMILY), "it names the family that ran");
  assert.equal(askFor(receipt, { planExecution: { executed: [] }, withheldFamilies: {} }).ending, null,
    "control: released and never run, it stays open");
});

// ── THE REPORT'S ACCOUNTING ──────────────────────────────────────────────────────────────────────────

/** The two states of one run: the re-sweep's contains question folded and asked (before), or refused (now). */
function bothStates() {
  const plan = planFor();
  const { exact, contains, minted } = mintMainElementRequest();
  const before = foldSupplementalEntries(plan, minted);
  const now = resweepFold(plan, minted);
  // every plan row the axis dictates ran (the identical question and its merchandise-class row), so what
  // differs between the two states is the re-ask alone
  const bands = (withReask) => ({ "primary-sweep": [listed(IDENTICAL, 40), listed(`${IDENTICAL}+merch`, 3),
    ...(withReask ? [crowd(contains.qid)] : [])] });
  const exec = (p, withReask) => {
    const join = joinPlanToBands(p, bands(withReask));
    return { ...join, skeleton: deriveCoverageSkeleton(p, join) };
  };
  return { exact, contains, before: { plan: before.plan, exec: exec(before.plan, true), bands: bands(true) },
    now: { plan: now.plan, exec: exec(now.plan, false), bands: bands(false) } };
}

test("the plan join: the family reads awaiting, neither missing nor executed, where the re-ask had made it read as asked", () => {
  const { contains, before, now } = bothStates();
  assert.deepEqual(before.exec.asked.filter((x) => x.qid === FAMILY).map((x) => x.asked_by), [contains.qid], "before: the re-ask answered the family");
  assert.ok(now.exec.awaiting.some((x) => x.qid === FAMILY), "now: the family is a question nobody asked");
  assert.ok(!now.exec.missing.includes(FAMILY) && !now.exec.executed.some((x) => x.qid === FAMILY), "and it is neither missing nor executed");
});

test("the coverage form carries the family's own settled row in place of the re-ask's open crowd row", () => {
  const { contains, before, now } = bothStates();
  const rowsOf = (s) => coverageFormRows({ skeleton: s.exec.skeleton, plan: s.plan, bandBlocksByAxis: s.bands,
    awaiting: s.exec.awaiting, withheld: withheldRecord() }).rows;
  const b = rowsOf(before);
  assert.ok(b.some((r) => r.kind === "block" && r.qid === contains.qid && r.status === null), "before: the counted, unread crowd is an open row");
  assert.ok(!b.some((r) => r.kind === "family" && r.qid === FAMILY), "before: no row for the family");
  const n = rowsOf(now);
  assert.ok(!n.some((r) => r.qid === contains.qid), "now: no row for a question that was not asked");
  const fam = n.find((r) => r.kind === "family" && r.qid === FAMILY);
  assert.deepEqual([fam?.status, fam?.reason], ["withheld-by-judgment", REASON], "now: the family's row arrives settled with the reading turn's reason");
});

test("the register coverage line counts the family as withheld, never as a search that did not complete, and one search fewer", () => {
  const { before, now } = bothStates();
  const facts = (s, withheldQids) => deriveScopeFacts({ instructedScope: { marks: [MARK], classes: [9], jurisdictions: [] },
    plan: s.plan, planExecution: s.exec, coverageRows: [], withheldQids });
  const before9 = facts(before, []), now9 = facts(now, [FAMILY]);
  const b = before9.per_class["9"], n = now9.per_class["9"];
  assert.equal(b.asked_elsewhere, 1, "before: the family left the count as asked by the re-ask");
  assert.equal(n.withheld, 1, "now: it leaves the count as a judgment not to search");
  assert.equal(n.missing, b.missing, "no search becomes one that did not complete");
  assert.ok(!n.dispatched_qids.includes(FAMILY), "and the family is never counted as a search that ran");
  assert.equal(n.total, b.total - 1, "the re-ask is the one search no longer counted");
  assert.equal(n.incomplete, b.incomplete - 1, "and its crowd leaves the count of results too large to list");
  assert.equal(n.enumerated, b.enumerated, "every listed search is still counted");
  // The client's line says the same in words: one search fewer, and the same wording for the rest.
  assert.notEqual(now9.coverage_line, before9.coverage_line);
  assert.doesNotMatch(now9.coverage_line, /did not complete/);
});

test("a class reads searched only when every required search in it is complete: a withheld family leaves the count, a required search that did not run keeps it from searched", () => {
  const { now } = bothStates();
  const line = (planExecution) => deriveScopeFacts({ instructedScope: { marks: [MARK], classes: [9], jurisdictions: [] },
    plan: now.plan, planExecution, coverageRows: [], withheldQids: [FAMILY] });
  const complete = line(now.exec);
  assert.equal(complete.per_class["9"].withheld, 1);
  assert.match(complete.coverage_line, /Class 9: searched/, `every required search ran: ${complete.coverage_line}`);
  // The same withholding beside a required search that never ran: the class is not searched.
  const bands = { "primary-sweep": [listed(`${IDENTICAL}+merch`, 3)] };
  const join = joinPlanToBands(now.plan, bands);
  const short = line({ ...join, skeleton: deriveCoverageSkeleton(now.plan, join) });
  assert.doesNotMatch(short.coverage_line, /Class 9: searched/, `a required search did not run: ${short.coverage_line}`);
  assert.equal(short.per_class["9"].withheld, 1, "the withheld family still leaves the count");
});

test("a directive settled this way leaves no deferral, so no open frame row, no follow-up row and no standing main-element gap", () => {
  // The pipeline's own chain, without its IO: the per-directive check decides the partition, the term
  // ledger decides the gap, and the receipt those two write is what the follow-up rows, the CLEAR hold and
  // the status-honesty signal all read.
  const { exact, contains, foldRefusals, world } = bothRefused();
  const directive = { layer: "variant", item: MARK, severity: "dominant-element" };
  const v = verifyRegisterDirectiveClose({ qids: [exact, contains], ...world, foldRefusals });
  const { swept, deferrals } = partitionFiring([directive], () => v.closed, () => v.reason);
  const accounting = accountRemedyTerms({ terms: [{ ...term([exact, contains]), directive: reopenKey(directive) }], ...world, foldRefusals });
  const { domClosed } = domClosedOverAccounted({ directives: [directive], swept, accounting });
  assert.deepEqual(deferrals, [], "nothing is left for a follow-up row or a held CLEAR");
  assert.equal(domClosed, true);
  assert.deepEqual(frameResidualGaps({ requested: [reopenKey(directive)], swept, deferrals, dominant_element_gap: true, domClosed }), []);
});

test("a re-sweep that adds nothing owes the axis only what has not landed: never a landed question, a released family's block included, a waiting family the turn did not release, or an unsupported entry; a released family that has not landed is retried", () => {
  const plan = { plan_version: 1, entries: [
    { qid: "a:landed", axis: "primary-sweep" }, { qid: "a:pending", axis: "primary-sweep" },
    { qid: "a:waiting", axis: "primary-sweep", when: { awaits_reading_turn: true } },
    { qid: "a:released", axis: "primary-sweep", when: { awaits_reading_turn: true } },
    { qid: "a:released-landed", axis: "primary-sweep", when: { awaits_reading_turn: true } },
    { qid: "a:unsupported", axis: "primary-sweep", unsupported: true }, { qid: "b:pending", axis: "transliteration-numeric" }] };
  const released = new Set(["a:released", "a:released-landed"]);
  const bands = { "primary-sweep": [listed("a:landed", 2), listed("a:released-landed", 1)], "transliteration-numeric": [] };
  assert.deepEqual(registerPlan.pendingRequiredQids(plan, "primary-sweep", bands, released), ["a:pending", "a:released"]);
  const everyLanded = { "primary-sweep": ["a:landed", "a:pending", "a:released", "a:released-landed"].map((q) => listed(q, 1)) };
  assert.deepEqual(registerPlan.pendingRequiredQids(plan, "primary-sweep", everyLanded, released), [], "with every question landed, nothing is sent");
  assert.deepEqual(registerPlan.pendingRequiredQids({ entries: [] }, "primary-sweep"), []);
});
