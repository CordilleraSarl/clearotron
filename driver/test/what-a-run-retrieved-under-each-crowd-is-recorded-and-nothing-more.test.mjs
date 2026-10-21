// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A RUN RETRIEVED UNDER EACH CROWD IS RECORDED, AND NOTHING MORE.
//
// A crowd is a question that ran and counted more than it read. The run records what it retrieved under it: a
// narrowed list retrieved in full, or none; and for the identical mark's own question, whether retrieved lists cover
// every class it asks in every main market. A narrowing counts only when it asks the same question with tighter
// limits: the same predicate and terms, classes and markets within its parent's, the parent's goods words or fewer.
// Retrieving a list is not reading it, and no list is not a decision to set the crowd aside: those are the reading
// step's. Each arm below is a case that would have overstated it. And second framing never asks a crowd again.
// Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinPlanToBands, deriveCoverageSkeleton, foldSupplementalEntries } from "../register-plan.mjs";
import { coverageFormRows, coverageFormBrief, findCoverageFormViolations } from "../coverage-form.mjs";
import { buildBandShape } from "../band-shape.mjs";
import { verifyRegisterDirectiveClose } from "../close-verify.mjs";
import { classifyRemedyTerm } from "../remedy-accounting.mjs";
import { deriveCoverageStatus } from "../coverage-ledger.mjs";
import { uncarriedCoverageLimits } from "../synthesis-record.mjs";

const AXIS = "primary-sweep";
const GOODS = ["video games", "joysticks"];
const e = (qid, term, over = {}) => ({ qid, axis: AXIS, predicate: "exact", term, nice_classes: ["9"], regions: [], expected_kind: "enumerate", ...over });
const crowd = (qid, total = 900) => ({ qid, state: "incomplete", total_hits: total, fetched: 0, records: [], reason: `total_hits ${total} exceeds the enumerate ceiling 600 — this is a CROWD` });
const listed = (qid) => ({ qid, state: "enumerated", total_hits: 2, count: 2, records: [{ record_id: `/mark/jp/${qid.length}`, mark_text: "QZORVAK", classes: [9] }] });
const sup = (qid, term, narrows, over = {}) => e(qid, term, { origin: "supplemental", narrows, ...over });
const narrowingOf = (j, qid) => j.crowd_narrowing.rows.find((r) => r.qid === qid);
// the plan's own goods question carries the client's goods words
const GOODS_ROW = e("primary-sweep:exact:qzorvak+goods", "QZORVAK", { provenance: "mark", goods_text: GOODS });

test("a wider crowd records a narrowed list retrieved in full, or none: a narrowing that widens, re-words or fails counts for nothing", () => {
  const plan = { regions: ["JP", "KR", "US"], nice_classes: ["9"], entries: [
    GOODS_ROW,
    e("primary-sweep:contains:qzorv", "QZORV", { predicate: "contains" }),
    sup("supp:contains-jp", "QZORV", "primary-sweep:contains:qzorv", { predicate: "contains", regions: ["JP"] }),
    e("primary-sweep:contains:zorv", "ZORV", { predicate: "contains" }),
    sup("supp:zorv-wider", "ZORV", "primary-sweep:contains:zorv", { predicate: "contains", nice_classes: ["9", "42"] }),
    sup("supp:zorv-reworded", "ZORVO", "primary-sweep:contains:zorv", { predicate: "contains", regions: ["JP"] }),
    sup("supp:zorv-exact", "ZORV", "primary-sweep:contains:zorv", { regions: ["JP"] }),
    sup("supp:zorv-failed", "ZORV", "primary-sweep:contains:zorv", { predicate: "contains", regions: ["KR"] }),
  ] };
  const bands = { [AXIS]: [crowd("primary-sweep:contains:qzorv"), listed("supp:contains-jp"), crowd("primary-sweep:contains:zorv"),
    listed("supp:zorv-wider"), listed("supp:zorv-reworded"), listed("supp:zorv-exact"), { ...listed("supp:zorv-failed"), error: true }] };
  const j = joinPlanToBands(plan, bands);
  assert.deepEqual(narrowingOf(j, "primary-sweep:contains:qzorv"), { qid: "primary-sweep:contains:qzorv", axis: AXIS, total_hits: 900, narrowing: "list-retrieved", lists: ["supp:contains-jp"] });
  assert.deepEqual(narrowingOf(j, "primary-sweep:contains:zorv"), { qid: "primary-sweep:contains:zorv", axis: AXIS, total_hits: 900, narrowing: "no-list" },
    "a list that asked more classes, another term, another predicate, or failed was counted under the crowd");
  assert.deepEqual([j.crowd_narrowing.list_retrieved, j.crowd_narrowing.no_list], [1, 1]);
  assert.equal(JSON.stringify(j.crowd_narrowing).match(/answered|set-aside|read\b/), null, "the record claims a reading or a judgment it never saw");
  assert.equal("crowd_narrowing" in joinPlanToBands(plan, { [AXIS]: bands[AXIS].map((b) => (b.state === "incomplete" ? listed(b.qid) : b)) }), false,
    "a run with no crowd keeps the receipt's earlier shape");
});

test("a narrowing that swaps the client's goods for other goods counts for nothing", () => {
  const plan = { regions: ["JP"], nice_classes: ["9"], entries: [
    GOODS_ROW,
    e("primary-sweep:exact:qzorvak", "QZORVAK", { provenance: "mark" }),
    sup("supp:other-goods", "QZORVAK", "primary-sweep:exact:qzorvak", { goods_text: ["garden furniture"] }),
    e("primary-sweep:contains:qzorv+goods", "QZORV", { predicate: "contains", goods_text: GOODS }),
    sup("supp:goods-swapped", "QZORV", "primary-sweep:contains:qzorv+goods", { predicate: "contains", goods_text: ["garden furniture"] }),
  ] };
  const j = joinPlanToBands(plan, { [AXIS]: [crowd("primary-sweep:exact:qzorvak"), listed("supp:other-goods"),
    crowd("primary-sweep:contains:qzorv+goods"), listed("supp:goods-swapped")] });
  assert.equal(narrowingOf(j, "primary-sweep:exact:qzorvak").narrowing, "required-not-covered");
  assert.equal(narrowingOf(j, "primary-sweep:contains:qzorv+goods").narrowing, "no-list");
});

test("the identical mark's crowd is covered only cell by cell: every class it asks, in every main market", () => {
  const plan = { regions: ["JP", "KR"], nice_classes: ["9", "41"], entries: [
    GOODS_ROW,
    e("primary-sweep:exact:qzorvak", "QZORVAK", { provenance: "mark", nice_classes: ["9", "41"] }),
    sup("supp:goods", "QZORVAK", "primary-sweep:exact:qzorvak", { goods_text: GOODS, nice_classes: ["9", "41"] }),
    sup("supp:goods-9", "QZORVAK", "supp:goods", { goods_text: GOODS, nice_classes: ["9"] }),
  ] };
  const bands = { [AXIS]: [crowd("primary-sweep:exact:qzorvak"), crowd("supp:goods", 700), listed("supp:goods-9")] };
  const nine = joinPlanToBands(plan, bands, { mainMarkets: ["JP", "KR"] });
  assert.deepEqual(narrowingOf(nine, "primary-sweep:exact:qzorvak"), { qid: "primary-sweep:exact:qzorvak", axis: AXIS, total_hits: 900,
    narrowing: "required-not-covered", lists: ["supp:goods-9"], not_covered: ["41/JP", "41/KR"] }, "a list for class 9 alone was taken for the whole required read");
  const both = joinPlanToBands({ ...plan, entries: [...plan.entries, sup("supp:goods-41", "QZORVAK", "supp:goods", { goods_text: GOODS, nice_classes: ["41"] })] },
    { [AXIS]: [...bands[AXIS], listed("supp:goods-41")] }, { mainMarkets: ["JP", "KR"] });
  assert.deepEqual(narrowingOf(both, "primary-sweep:exact:qzorvak").narrowing, "required-covered");
  assert.equal(both.crowd_narrowing.required_covered, 2);
});

test("on a worldwide order, one market's list never stands for the rest: the main markets are counted, or a worldwide list", () => {
  const plan = { regions: [], nice_classes: ["9"], entries: [
    GOODS_ROW,
    e("primary-sweep:exact:qzorvak", "QZORVAK", { provenance: "mark" }),
    sup("supp:goods-jp", "QZORVAK", "primary-sweep:exact:qzorvak", { goods_text: GOODS, regions: ["JP"] }),
  ] };
  const bands = { [AXIS]: [crowd("primary-sweep:exact:qzorvak"), listed("supp:goods-jp")] };
  assert.deepEqual(narrowingOf(joinPlanToBands(plan, bands, { mainMarkets: ["JP", "KR"] }), "primary-sweep:exact:qzorvak").not_covered, ["9/KR"],
    "one of two main markets was taken for both");
  assert.deepEqual(narrowingOf(joinPlanToBands(plan, bands), "primary-sweep:exact:qzorvak").not_covered, ["9/worldwide"],
    "with no main market named, a one-country list was taken for the whole world");
  const worldwide = { ...plan, entries: [...plan.entries, sup("supp:goods-ww", "QZORVAK", "primary-sweep:exact:qzorvak", { goods_text: GOODS })] };
  assert.equal(narrowingOf(joinPlanToBands(worldwide, { [AXIS]: [...bands[AXIS], listed("supp:goods-ww")] }), "primary-sweep:exact:qzorvak").narrowing, "required-covered");
});

const FORM_PLAN = { regions: ["JP", "KR", "US"], nice_classes: ["9"], entries: [
  GOODS_ROW,
  e("primary-sweep:contains:qzorv", "QZORV", { predicate: "contains" }),
  sup("supp:contains-jp", "QZORV", "primary-sweep:contains:qzorv", { predicate: "contains", regions: ["JP"] }),
  e("primary-sweep:contains:zorv", "ZORV", { predicate: "contains" }),
] };
const FORM_BANDS = { [AXIS]: [listed(GOODS_ROW.qid), crowd("primary-sweep:contains:qzorv"), listed("supp:contains-jp"), crowd("primary-sweep:contains:zorv")] };

test("the record rides the crowd's coverage-form row, its brief line and its band-shape entry as data, and the row stays open", () => {
  const j = joinPlanToBands(FORM_PLAN, FORM_BANDS);
  const rows = coverageFormRows({ skeleton: deriveCoverageSkeleton(FORM_PLAN, j), plan: FORM_PLAN, bandBlocksByAxis: FORM_BANDS }).rows.filter((r) => r.kind === "block");
  const row = (qid) => rows.find((r) => r.qid === qid);
  assert.deepEqual([row("primary-sweep:contains:qzorv").narrowing, row("primary-sweep:contains:qzorv").lists], ["list-retrieved", ["supp:contains-jp"]]);
  assert.equal(row("primary-sweep:contains:zorv").narrowing, "no-list");
  assert.ok(rows.every((r) => r.open === true), "the record decided a row the reading step owns");
  const brief = coverageFormBrief({ rows });
  assert.match(brief, /\(block\) [^\n]*900 hits; narrowing: list-retrieved \(supp:contains-jp\) — OPEN/);
  assert.match(brief, /\(block\) [^\n]*900 hits; narrowing: no-list — OPEN/);
  const band = { enumerated: [], crowds: [{ qid: "primary-sweep:contains:qzorv", query: "contains QZORV [cl 9]", total_hits: 900, fetched: 0, reason: "crowd" },
    { qid: "primary-sweep:contains:zorv", query: "contains ZORV [cl 9]", total_hits: 900, fetched: 0, reason: "crowd" }] };
  const { shape } = buildBandShape(band, { targets: ["QZORVAK"], inScopeClasses: ["9"], crowdNarrowing: j.crowd_narrowing.rows });
  assert.deepEqual(shape.crowds.map((c) => [c.narrowing, c.lists ?? null]), [["list-retrieved", ["supp:contains-jp"]], ["no-list", null]]);
});

test("second framing does not ask a crowd again: the same question is refused at the fold and checked on the crowd's row", () => {
  const j = joinPlanToBands(FORM_PLAN, FORM_BANDS);
  for (const twin of ["primary-sweep:contains:qzorv", "primary-sweep:contains:zorv"]) {
    const again = { ...FORM_PLAN.entries.find((x) => x.qid === twin), qid: `supp:${AXIS}:reopen:${twin.length}`, origin: "supplemental", rationale: "frame-reopen" };
    const { added, refused } = foldSupplementalEntries(FORM_PLAN, [again]);
    assert.deepEqual(added, [], "the crowd was asked again");
    assert.deepEqual(refused.map((r) => [r.kind, r.twin]), [["duplicate-question", twin]]);
    const foldRefusals = new Map(refused.map((r) => [r.qid, r]));
    const executedQids = new Set(j.executed.map((x) => x.qid));
    const blocksByQid = new Map(FORM_BANDS[AXIS].map((b) => [b.qid, b]));
    const v = verifyRegisterDirectiveClose({ qids: [again.qid], intendedClasses: ["9"], executedQids, blocksByQid, foldRefusals });
    assert.deepEqual([v.closed, v.answered_by], [true, [{ qid: again.qid, twin }]]);
    assert.equal(classifyRemedyTerm({ term: "QZORV", qids: [again.qid] }, { blocksByQid, executedQids, foldRefusals }).class, "found",
      "the repeat was recorded as a search that failed");
  }
});

test("a crowd row the write-up settles as withheld by judgment is finished work to every gate that reads it", () => {
  const j = joinPlanToBands(FORM_PLAN, FORM_BANDS);
  const rows = coverageFormRows({ skeleton: deriveCoverageSkeleton(FORM_PLAN, j), plan: FORM_PLAN, bandBlocksByAxis: FORM_BANDS }).rows;
  const settle = (r) => (r.kind === "block"
    ? { ...r, status: "withheld-by-judgment", reason: "read in its place, with its count kept" }
    : { ...r, status: "confirmed-clean", reason: "listed in full" });
  const ledger = rows.map(settle);
  assert.deepEqual(findCoverageFormViolations(ledger), [], "the form refused a crowd row settled as withheld");
  assert.deepEqual(deriveCoverageStatus(ledger), { complete: true, materialGaps: [] }, "a withheld crowd row was counted a gap");
  assert.equal(uncarriedCoverageLimits([{ area: "register", state: "confirmed-clean" }], ledger), null, "synthesis was made to carry a withheld crowd row as a limit");
  // the control: the same rows left coverage-limited are gaps, and the client's section must carry one
  const limited = ledger.map((r) => (r.kind === "block" ? { ...r, status: "coverage-limited" } : r));
  assert.equal(deriveCoverageStatus(limited).complete, false);
  assert.ok(Array.isArray(uncarriedCoverageLimits([{ area: "register", state: "confirmed-clean" }], limited)));
});
