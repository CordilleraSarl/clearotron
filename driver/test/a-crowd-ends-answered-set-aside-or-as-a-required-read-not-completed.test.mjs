// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CROWD ENDS ONE OF THREE WAYS, AND THE RUN RECORDS WHICH.
//
// A crowd is a question that ran and counted more than it read. Under the crowded-field method it is answered by
// a narrowed list read in full that keeps its limits, set aside with its count, or, for the identical mark's own
// question, a required read not completed until a read list covers its main markets. The ending is worked out from
// the run's own files and carried as data on the receipt, the coverage form's row and the band shape. And second
// framing never asks a crowd again: the same question is refused at the fold and answered by the crowd's own row.
// Every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinPlanToBands, deriveCoverageSkeleton, foldSupplementalEntries } from "../register-plan.mjs";
import { coverageFormRows, coverageFormBrief } from "../coverage-form.mjs";
import { buildBandShape } from "../band-shape.mjs";
import { verifyRegisterDirectiveClose } from "../close-verify.mjs";
import { classifyRemedyTerm } from "../remedy-accounting.mjs";
import { findCoverageFormViolations } from "../coverage-form.mjs";
import { deriveCoverageStatus } from "../coverage-ledger.mjs";
import { uncarriedCoverageLimits } from "../synthesis-record.mjs";

const AXIS = "primary-sweep";
const e = (qid, term, over = {}) => ({ qid, axis: AXIS, predicate: "exact", term, nice_classes: ["9"], regions: [], expected_kind: "enumerate", ...over });
const crowd = (qid, total = 900) => ({ qid, state: "incomplete", total_hits: total, fetched: 0, records: [], reason: `total_hits ${total} exceeds the enumerate ceiling 600 — this is a CROWD` });
const read = (qid) => ({ qid, state: "enumerated", total_hits: 2, count: 2, records: [{ record_id: `/mark/jp/${qid.length}`, mark_text: "QZORVAK", classes: [9] }] });
const sup = (qid, term, narrows, over = {}) => e(qid, term, { origin: "supplemental", narrows, ...over });
const GOODS = ["video games"];

const PLAN = { schema: "register-plan/1", plan_version: 3, regions: ["JP", "KR", "US"], nice_classes: ["9"], entries: [
  e("primary-sweep:exact:qzorvak", "QZORVAK", { provenance: "mark" }),
  sup("supp:goods", "QZORVAK", "primary-sweep:exact:qzorvak", { goods_text: GOODS }),
  e("primary-sweep:contains:qzorv", "QZORV", { predicate: "contains" }),
  sup("supp:contains-jp", "QZORV", "primary-sweep:contains:qzorv", { predicate: "contains", regions: ["JP"] }),
  e("primary-sweep:contains:zorv", "ZORV", { predicate: "contains" }),
  sup("supp:zorv-wider", "ZORV", "primary-sweep:contains:zorv", { predicate: "contains", nice_classes: ["9", "42"] }),
] };
const BANDS = { [AXIS]: [crowd("primary-sweep:exact:qzorvak"), read("supp:goods"), crowd("primary-sweep:contains:qzorv"), read("supp:contains-jp"),
  crowd("primary-sweep:contains:zorv"), read("supp:zorv-wider")] };
const ending = (j, qid) => j.crowd_endings.rows.find((r) => r.qid === qid);

test("a crowd a read list answered is answered by it; one no list answered is set aside; a list that widens answers nothing", () => {
  const j = joinPlanToBands(PLAN, BANDS);
  assert.deepEqual(ending(j, "primary-sweep:exact:qzorvak"), { qid: "primary-sweep:exact:qzorvak", axis: AXIS, total_hits: 900, ending: "answered", answered_by: ["supp:goods"] });
  assert.equal(ending(j, "primary-sweep:contains:qzorv").ending, "answered", "a wider crowd answered in one market is answered: its remainder is set aside with its count");
  assert.deepEqual(ending(j, "primary-sweep:contains:zorv"), { qid: "primary-sweep:contains:zorv", axis: AXIS, total_hits: 900, ending: "set-aside" },
    "a list that asked more classes than the crowd answered it");
  assert.deepEqual([j.crowd_endings.answered, j.crowd_endings.set_aside, j.crowd_endings.required_read_not_completed], [2, 1, 0]);
  assert.equal("crowd_endings" in joinPlanToBands(PLAN, { [AXIS]: BANDS[AXIS].map((b) => (b.state === "incomplete" ? read(b.qid) : b)) }), false,
    "a run with no crowd keeps the receipt's earlier shape");
});

test("a narrowing that drops the client's goods, or a list that failed, answers nothing", () => {
  const plan = { ...PLAN, entries: [
    e("primary-sweep:exact:qzorvak-goods", "QZORVAK", { provenance: "mark", goods_text: GOODS }),
    sup("supp:no-goods", "QZORVAK", "primary-sweep:exact:qzorvak-goods", { regions: ["JP"] }),
    sup("supp:failed", "QZORVAK", "primary-sweep:exact:qzorvak-goods", { goods_text: GOODS, regions: ["KR"] }),
  ] };
  const j = joinPlanToBands(plan, { [AXIS]: [crowd("primary-sweep:exact:qzorvak-goods"), read("supp:no-goods"), { ...read("supp:failed"), error: true }] });
  assert.deepEqual(ending(j, "primary-sweep:exact:qzorvak-goods"), { qid: "primary-sweep:exact:qzorvak-goods", axis: AXIS, total_hits: 900, ending: "required-read-not-completed" });
});

test("the identical mark's crowd is answered only when read lists cover its main markets, or its whole scope", () => {
  const plan = { ...PLAN, entries: [
    e("primary-sweep:exact:qzorvak", "QZORVAK", { provenance: "mark" }),
    sup("supp:goods", "QZORVAK", "primary-sweep:exact:qzorvak", { goods_text: GOODS }),
    sup("supp:goods-jp", "QZORVAK", "supp:goods", { goods_text: GOODS, regions: ["JP"] }),
    sup("supp:goods-kr", "QZORVAK", "supp:goods", { goods_text: GOODS, regions: ["KR"] }),
  ] };
  const bands = { [AXIS]: [crowd("primary-sweep:exact:qzorvak"), crowd("supp:goods", 700), read("supp:goods-jp"), read("supp:goods-kr")] };
  const inTwo = joinPlanToBands(plan, bands, { mainMarkets: ["JP", "KR"] });
  assert.equal(ending(inTwo, "primary-sweep:exact:qzorvak").ending, "answered", "both main markets were read as lists");
  assert.deepEqual(ending(inTwo, "supp:goods").answered_by, ["supp:goods-jp", "supp:goods-kr"]);
  const inThree = joinPlanToBands(plan, bands, { mainMarkets: ["JP", "KR", "US"] });
  assert.deepEqual(ending(inThree, "supp:goods"), { qid: "supp:goods", axis: AXIS, total_hits: 700, ending: "required-read-not-completed", markets_read: ["JP", "KR"] },
    "a main market its market step did not read is a required read not completed, with the markets it did read");
  assert.equal(inThree.crowd_endings.required_read_not_completed, 2);
  // no main markets known: the whole scope is the measure
  assert.equal(ending(joinPlanToBands(plan, bands), "supp:goods").ending, "required-read-not-completed");
});

test("the ending rides the crowd's coverage-form row and its band-shape descriptor as data, and the row stays open", () => {
  const j = joinPlanToBands(PLAN, BANDS);
  const rows = coverageFormRows({ skeleton: deriveCoverageSkeleton(PLAN, j), plan: PLAN, bandBlocksByAxis: BANDS }).rows.filter((r) => r.kind === "block");
  const row = (qid) => rows.find((r) => r.qid === qid);
  assert.deepEqual([row("primary-sweep:exact:qzorvak").ending, row("primary-sweep:exact:qzorvak").answered_by], ["answered", ["supp:goods"]]);
  assert.equal(row("primary-sweep:contains:zorv").ending, "set-aside");
  assert.ok(rows.every((r) => r.open === true), "the ending decided a row the reading step owns");
  // the reading step's only sight of the rows is its brief, so the ending is listed there, as data beside the count
  const brief = coverageFormBrief({ rows });
  assert.match(brief, /\(block\) [^\n]*900 hits; ending: answered by supp:goods — OPEN/);
  assert.match(brief, /\(block\) [^\n]*900 hits; ending: set-aside — OPEN/);
  // the form works the endings out from the blocks it is built from, not from an older receipt
  const later = { [AXIS]: [...BANDS[AXIS], read("supp:zorv-late")] };
  const planLater = { ...PLAN, entries: [...PLAN.entries, sup("supp:zorv-late", "ZORV", "primary-sweep:contains:zorv", { predicate: "contains", regions: ["KR"] })] };
  const rowsLater = coverageFormRows({ skeleton: deriveCoverageSkeleton(planLater, joinPlanToBands(planLater, later)), plan: planLater, bandBlocksByAxis: later }).rows;
  assert.equal(rowsLater.find((r) => r.qid === "primary-sweep:contains:zorv").ending, "answered");
  const band = { enumerated: [], crowds: [{ qid: "primary-sweep:contains:qzorv", query: "contains QZORV [cl 9]", total_hits: 900, fetched: 0, reason: "crowd" },
    { qid: "primary-sweep:contains:zorv", query: "contains ZORV [cl 9]", total_hits: 900, fetched: 0, reason: "crowd" }] };
  const { shape } = buildBandShape(band, { targets: ["QZORVAK"], inScopeClasses: ["9"], crowdEndings: j.crowd_endings.rows });
  assert.deepEqual(shape.crowds.map((c) => [c.ending, c.answered_by ?? null]), [["answered", ["supp:contains-jp"]], ["set-aside", null]]);
});

test("second framing does not ask a crowd again: the same question is refused at the fold and answered by the crowd's row", () => {
  const j = joinPlanToBands(PLAN, BANDS);
  for (const twin of ["primary-sweep:contains:qzorv", "primary-sweep:contains:zorv"]) {
    const again = { ...PLAN.entries.find((x) => x.qid === twin), qid: `supp:${AXIS}:reopen:${twin.length}`, origin: "supplemental", rationale: "frame-reopen" };
    const { added, refused } = foldSupplementalEntries(PLAN, [again]);
    assert.deepEqual(added, [], "the crowd was asked again");
    assert.deepEqual(refused.map((r) => [r.kind, r.twin]), [["duplicate-question", twin]]);
    const foldRefusals = new Map(refused.map((r) => [r.qid, r]));
    const executedQids = new Set(j.executed.map((x) => x.qid));
    const blocksByQid = new Map(BANDS[AXIS].map((b) => [b.qid, b]));
    const v = verifyRegisterDirectiveClose({ qids: [again.qid], intendedClasses: ["9"], executedQids, blocksByQid, foldRefusals });
    assert.deepEqual([v.closed, v.answered_by], [true, [{ qid: again.qid, twin }]]);
    assert.equal(classifyRemedyTerm({ term: "QZORV", qids: [again.qid] }, { blocksByQid, executedQids, foldRefusals }).class, "found",
      "the repeat was recorded as a search that failed");
  }
});

test("a crowd row the write-up settles as withheld by judgment is finished work to every gate that reads it", () => {
  const j = joinPlanToBands(PLAN, BANDS);
  const rows = coverageFormRows({ skeleton: deriveCoverageSkeleton(PLAN, j), plan: PLAN, bandBlocksByAxis: BANDS }).rows;
  const settle = (r) => (r.kind === "block"
    ? { ...r, status: r.ending === "required-read-not-completed" ? "coverage-limited" : "withheld-by-judgment", reason: "read in its place, with its count kept" }
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
