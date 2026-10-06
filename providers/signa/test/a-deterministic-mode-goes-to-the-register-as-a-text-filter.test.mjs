// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-deterministic-mode-goes-to-the-register-as-a-text-filter.test.mjs — the register's retired `match`.
//
// THE DEFECT. The register retired the `match` parameter and, from its sunset date, refuses it rather
// than ignoring it. This connector sent `match` for every deterministic mode — the containing search
// behind "Filings containing the name", the anchored wildcard searches, and an exact question below the
// ranked floor. A refused request is an error, and an error on the containing band reaches the report as
// "not available" on every run on this register. The replacement is the text filter
// `filters.mark_text.<op>`, sent alone: no `q`, which would rank it, and no `similarity`, which the
// register refuses without a `q`.
//
// The register also removed two response fields the normaliser read, `search_meta.strategies_used` and
// `search_meta.match`, and named `search_meta.similarity_applied` and each row's `match` object as what to
// read instead.
//
// No vendor measurements and no mark live here; the terms are invented and the bodies fabricated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchRequest, toSignaParams, normalizeSearchResponse } from "../src/core.js";

const TERM = "ZYTHERMO";
// Written out rather than imported, so a wrong mapping in the code still fails here.
const FILTER_FOR = { contains: "contains", starts_with: "starts_with", ends_with: "ends_with" };

test("each deterministic mode is a text filter, with no `match`, no `q` and no channels", () => {
  for (const [mode, op] of Object.entries(FILTER_FOR)) {
    const body = buildSearchRequest(toSignaParams({ name: TERM, match_mode: mode, nice_classes: [9], regions: ["US"] }));
    assert.deepEqual(body.filters?.mark_text, { [op]: [TERM] }, `${mode} did not reach the register as its text filter`);
    assert.equal("match" in body, false, `${mode} still sends the parameter the register refuses after its sunset`);
    assert.equal("q" in body, false, `${mode} carries a \`q\`, which would turn the listing into a ranked search`);
    assert.equal("similarity" in body, false, `${mode} carries channels, which the register refuses without a \`q\``);
    assert.deepEqual(body.filters.nice_classes, [9], "the other filters ride beside the text filter");
  }
});

test("the count lane's containing question reaches the wire as the containing filter", () => {
  const body = buildSearchRequest(toSignaParams({ name: TERM, match_mode: "default", nice_classes: [9] }));
  assert.deepEqual(body.filters?.mark_text, { contains: [TERM] });
  assert.equal("match" in body, false);
});

test("`similar` has no filter: the register ranks a term on its own, so it goes as the ranked shape", () => {
  const body = buildSearchRequest({ query: TERM, match: "similar" });
  assert.equal(body.q, TERM);
  assert.deepEqual(body.similarity, ["identical", "lookalike"]);
  assert.equal("match" in body, false);
  assert.equal(body.filters?.mark_text, undefined);
});

test("CONTROL: a ranked question is unchanged — a term in `q` with its channels, and no text filter", () => {
  const body = buildSearchRequest(toSignaParams({ name: TERM, match_mode: "phonetic", nice_classes: [9] }));
  assert.equal(body.q, TERM);
  assert.deepEqual(body.similarity, ["identical", "phonetic"]);
  assert.equal(body.filters?.mark_text, undefined);
});

test("the response reads what the register says it ran, and each row says why it was returned", () => {
  const out = normalizeSearchResponse({
    object: "list", has_more: false,
    pagination: { cursor: null, total_count: 1, total_count_approximate: false },
    search_meta: { search_id: "srch_invented", query: TERM, similarity_applied: ["identical", "lookalike"] },
    data: [{ id: "tm_invented", jurisdiction_code: "US", mark_text: TERM,
      match: { tier: "identical", via: ["lookalike"], terms: [TERM] } }],
  }, TERM);
  assert.deepEqual(out.similarity_applied, ["identical", "lookalike"]);
  assert.equal("strategies_used" in out, false, "a field the register removed must not read as an empty report of what ran");
  assert.deepEqual(out.results[0].match, { tier: "identical", via: ["lookalike"], terms: [TERM] });
});

test("CONTROL: an answer with no channel report and no row match reads null, never an invented empty", () => {
  const out = normalizeSearchResponse({
    object: "list", has_more: false, pagination: { cursor: null, total_count: 1, total_count_approximate: false },
    search_meta: {}, data: [{ id: "tm_invented", jurisdiction_code: "US", mark_text: TERM }],
  }, TERM);
  assert.equal(out.similarity_applied, null);
  assert.equal(out.results[0].match, null);
});
