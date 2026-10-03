// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN EXPANDED TOTAL SAYS IT COUNTS RECORDS.
//
// The register writes `expanded_fallback` into `search_meta.warnings` when its grouped view cannot serve a
// filter, and the answer then comes back one row per record: a mark is counted once per country it covers.
// The normalised answer says so as `total_counts: "records"`, beside the register's own number, which
// stays exactly as the register gave it. The warning's shape is the one measured live and kept by the
// warnings test beside this file. The response bodies below are fabricated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchResponse } from "../src/core.js";

const body = (warnings) => ({
  object: "list", data: [], has_more: false,
  pagination: { cursor: null, total_count: 1756, total_count_approximate: false },
  search_meta: { search_id: "srch_invented", query: "ZYTHERMO", strategies_used: [], match: "exact", ...(warnings ? { warnings } : {}) },
  request_id: "req_invented",
});
const EXPANDED = {
  code: "expanded_fallback", severity: "info",
  message: "expanded_fallback: the grouped view cannot serve the goods_services_text filter, so results are one row per record (international_registrations=expanded).",
  affected_filters: ["goods_services_text"],
};

test("the register's expanded_fallback makes the answer say its total counts records, and the total stays its own", () => {
  const out = normalizeSearchResponse(body([EXPANDED]), "ZYTHERMO");
  assert.equal(out.total_counts, "records");
  assert.equal(out.total_hits, 1756);
});

test("read on the code, or on a message that opens with it", () => {
  assert.equal(normalizeSearchResponse(body([{ code: "expanded_fallback" }]), "ZYTHERMO").total_counts, "records");
  assert.equal(normalizeSearchResponse(body([{ message: EXPANDED.message }]), "ZYTHERMO").total_counts, "records");
});

test("CONTROL — another warning, no warning, or no answer says nothing about what the total counts", () => {
  for (const w of [undefined, [], [{ code: "mixed_script", message: "mixed_script: …" }]]) {
    assert.equal("total_counts" in normalizeSearchResponse(body(w), "ZYTHERMO"), false, JSON.stringify(w));
  }
  assert.equal("total_counts" in normalizeSearchResponse({ error: { message: "nope" }, search_meta: { warnings: [EXPANDED] } }, "ZYTHERMO"), false,
    "a non-answer stated what its total counts");
});
