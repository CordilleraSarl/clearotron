// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REGISTER'S OWN WARNINGS REACH THE RUN, WHOLE.
//
// The register can attach warnings to a search response. They were dropped on the floor: the normalised
// response kept the search id, the match mode and the timings and said nothing about what the register
// had flagged, so a run had no record of it and nobody reading the run afterwards could know.
//
// THEY ARE CARRIED WHOLE, NOT FILTERED TO THE CODES WE KNOW. A recorder keyed to a fixed list passes its
// own tests forever and quietly records nothing the day the register adds a code — and from the outside
// that is indistinguishable from a clean run. The arms below therefore include a code this repository has
// never seen, because that is the case a filtered recorder fails.
//
// AND THE COLUMN WILL USUALLY BE EMPTY, WHICH IS NOT THE SAME AS SAFE. The one code observed live is
// emitted on the exact-text filter path, not on the ranked path every sweep here uses — a ranked query
// folds look-alike letters through its own similarity channel and has nothing to warn about. So an empty
// list is the expected reading and is not evidence that a query carried no risk.
//
// No vendor measurements and no mark live here; the response bodies below are fabricated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchResponse } from "../src/core.js";

const body = (extra = {}) => ({
  object: "list", data: [], has_more: false,
  pagination: { cursor: null, total_count: 0, total_count_approximate: false },
  search_meta: { search_id: "srch_invented", query: "ZYTHERMO", strategies_used: [], match: "exact", ...extra },
  request_id: "req_invented",
});

test("a warning the register attaches is on the normalised response", () => {
  const w = { code: "mixed_script", severity: "info", affected_filter: "mark_text_is", message: "…" };
  assert.deepEqual(normalizeSearchResponse(body({ warnings: [w] }), "ZYTHERMO").warnings, [w]);
});

test("the code that DOES arrive on our own request shapes is carried, with its affected filters", () => {
  // `expanded_fallback` is emitted on `offices` together with `nice_classes`, and on
  // `goods_services_text` — which rides every goods-narrowed question this connector sends. It reports
  // that the grouped view cannot serve the filter, so the answer is one row per record rather than one
  // row per mark, and the total inflates. The total is what the enumerate ceiling reads to call a band a
  // crowd, so this is the one warning whose arrival changes how a number should be read.
  const w = {
    code: "expanded_fallback", severity: "info",
    message: "expanded_fallback: the grouped view cannot serve the goods_services_text filter, so results are one row per record (international_registrations=expanded).",
    affected_filters: ["goods_services_text"],
  };
  const out = normalizeSearchResponse(body({ warnings: [w] }), "ZYTHERMO");
  assert.deepEqual(out.warnings, [w]);
  assert.deepEqual(out.warnings[0].affected_filters, ["goods_services_text"],
    "which filter forced the fallback must survive, or a reader cannot tell which number to distrust");
});

test("a code this repository has never seen is carried too — the filtered-recorder case", () => {
  const unknown = { code: "a_code_no_one_here_has_written_down", severity: "warning", message: "…" };
  assert.deepEqual(normalizeSearchResponse(body({ warnings: [unknown] }), "ZYTHERMO").warnings, [unknown],
    "the recorder keeps only codes it knows, so a new one would vanish and the column would read clean");
});

test("every warning of several is kept, in the register's own order", () => {
  const many = [{ code: "one" }, { code: "two" }, { code: "three" }];
  assert.deepEqual(normalizeSearchResponse(body({ warnings: many }), "ZYTHERMO").warnings.map((x) => x.code),
    ["one", "two", "three"]);
});

test("a clean response carries an empty list, never undefined", () => {
  // A clean response has no `warnings` key at all. An absent field and an empty list must not be two
  // different answers downstream, or a reader has to know which one this connector happens to produce.
  const out = normalizeSearchResponse(body(), "ZYTHERMO");
  assert.deepEqual(out.warnings, []);
  assert.ok(Array.isArray(out.warnings));
});

test("a malformed warnings field does not become one, and does not throw", () => {
  for (const bad of ["a string", 7, {}, null]) {
    assert.deepEqual(normalizeSearchResponse(body({ warnings: bad }), "ZYTHERMO").warnings, [],
      `${JSON.stringify(bad)} was treated as a warnings list`);
  }
});

test("CONTROL: the rest of the normalised response is unchanged by this", () => {
  const out = normalizeSearchResponse(body({ warnings: [{ code: "mixed_script" }] }), "ZYTHERMO");
  assert.equal(out.search_id, "srch_invented");
  assert.equal(out.match, "exact");
  assert.equal(out.query, "ZYTHERMO");
});
