// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NARROWED LIST COVERS ONLY THE MARKETS IT ASKED.
//
// A register can answer a list narrowed by goods with offices left out, and the list's block names them. The list is
// complete for the offices it asked and read none of the others. The identical mark's crowd counted such a list on its
// plan's markets, so a client whose main markets were Hong Kong and Taiwan had both required reads counted as done by a
// list that never asked either. Each arm below is a case that overstated it, or a control that must not move. Every
// mark and goods word is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { joinPlanToBands, deriveCoverageSkeleton } from "../register-plan.mjs";
import { coverageFormRows, coverageFormBrief } from "../coverage-form.mjs";
import { buildBandShape } from "../band-shape.mjs";

const AXIS = "primary-sweep";
const GOODS = ["kettles", "teapots"];
const IDENTICAL = "primary-sweep:exact:velmorak";
const e = (qid, term, over = {}) => ({ qid, axis: AXIS, predicate: "exact", term, nice_classes: ["21"], regions: [], expected_kind: "enumerate", ...over });
const sup = (qid, term, narrows, over = {}) => e(qid, term, { origin: "supplemental", narrows, ...over });
const crowd = (qid, total = 900) => ({ qid, state: "incomplete", total_hits: total, fetched: 0, records: [], reason: `total_hits ${total} exceeds the enumerate ceiling 600 — this is a CROWD` });
const listed = (qid, over = {}) => ({ qid, state: "enumerated", total_hits: 2, count: 2, records: [{ record_id: `/mark/us/${qid.length}`, mark_text: "VELMORAK", classes: [21] }], ...over });
// the plan's own goods question carries the client's goods words
const GOODS_ROW = e("primary-sweep:exact:velmorak+goods", "VELMORAK", { provenance: "mark", goods_text: GOODS });
const PLAN = { regions: ["HK", "JP", "MO", "TW", "US"], nice_classes: ["21"], entries: [
  GOODS_ROW,
  e(IDENTICAL, "VELMORAK", { provenance: "mark" }),
  sup("supp:goods", "VELMORAK", IDENTICAL, { goods_text: GOODS }),
] };
// the register answered the goods list with three offices left out
const LEFT_OUT = ["HK", "MO", "TW"];
const bands = (goodsBlock = listed("supp:goods", { offices_without_goods_field: LEFT_OUT }), more = []) =>
  ({ [AXIS]: [listed(GOODS_ROW.qid), crowd(IDENTICAL), goodsBlock, ...more] });
const ending = (plan, b, mainMarkets) => joinPlanToBands(plan, b, { mainMarkets }).crowd_narrowing.rows.find((r) => r.qid === IDENTICAL);

test("a goods list the register answered with Hong Kong and Taiwan left out is not their required read", () => {
  assert.deepEqual(ending(PLAN, bands(), ["HK", "TW"]), { qid: IDENTICAL, axis: AXIS, total_hits: 900,
    narrowing: "required-not-covered", lists: ["supp:goods"], not_covered: ["21/HK", "21/TW"] },
  "a list that never asked Hong Kong or Taiwan was counted as their required read");
  assert.deepEqual(ending(PLAN, bands(), ["HK", "JP"]).not_covered, ["21/HK"], "a market the list asked was counted open, or one it left out was counted read");
  assert.deepEqual(ending(PLAN, bands(), ["Hong Kong", "Taiwan"]).not_covered, ["21/HK", "21/TW"], "a main market named in words escaped the offices left out");
});

test("a market the list asked, a list with nothing left out, and a second list that asked the market itself all stand as before", () => {
  assert.equal(ending(PLAN, bands(), ["JP", "US"]).narrowing, "required-covered", "a list's left-out offices reached a market it asked");
  assert.equal(ending(PLAN, bands(listed("supp:goods")), ["HK", "TW"]).narrowing, "required-covered", "a list with no office left out stopped covering");
  const withHongKong = { ...PLAN, entries: [...PLAN.entries, sup("supp:hong-kong", "VELMORAK", IDENTICAL, { regions: ["HK"] })] };
  assert.deepEqual(ending(withHongKong, bands(undefined, [listed("supp:hong-kong")]), ["HK", "TW"]).not_covered, ["21/TW"],
    "a list that asked Hong Kong itself did not cover it");
});

test("an unrestricted list with offices left out is not a worldwide list", () => {
  const worldwide = { ...PLAN, regions: [] };
  assert.deepEqual(ending(worldwide, bands(), []).not_covered, ["21/worldwide"], "a list that left offices out was taken for the whole world");
  assert.equal(ending(worldwide, bands(listed("supp:goods")), []).narrowing, "required-covered", "a worldwide list with nothing left out stopped covering");
});

test("the receipt, the coverage form and the band shape carry the same open cells", () => {
  const b = bands();
  const mainMarkets = ["HK", "TW"];
  const j = joinPlanToBands(PLAN, b, { mainMarkets });
  assert.deepEqual([j.crowd_narrowing.required_covered, j.crowd_narrowing.required_not_covered], [0, 1]);
  const rows = coverageFormRows({ skeleton: deriveCoverageSkeleton(PLAN, j), plan: PLAN, bandBlocksByAxis: b, mainMarkets }).rows.filter((r) => r.kind === "block");
  const row = rows.find((r) => r.qid === IDENTICAL);
  assert.deepEqual([row.narrowing, row.not_covered], ["required-not-covered", ["21/HK", "21/TW"]]);
  assert.equal(row.open, true, "the record decided a row the reading step owns");
  assert.match(coverageFormBrief({ rows }), /narrowing: required-not-covered \(supp:goods\); not covered: 21\/HK, 21\/TW/);
  const band = { enumerated: [], crowds: [{ qid: IDENTICAL, query: "exact VELMORAK [cl 21]", total_hits: 900, fetched: 0, reason: "crowd" }] };
  const { shape } = buildBandShape(band, { targets: ["VELMORAK"], inScopeClasses: ["21"], crowdNarrowing: j.crowd_narrowing.rows });
  assert.deepEqual(shape.crowds.map((c) => [c.narrowing, c.not_covered ?? null]), [["required-not-covered", ["21/HK", "21/TW"]]]);
});
