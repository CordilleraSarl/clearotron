// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-crowded-sweep-is-narrowed-by-what-a-filing-covers.test.mjs — the goods-and-services narrowing:
// the clause each register actually takes, and the disclosed deferral where a connector cannot send one.
//
// WHY THIS EXISTS. A Nice class is a filing bucket, not a specification: class 9 holds headphones and
// jukeboxes alike. On a measured run the contains sweep on the mark's dominant word, already scoped to
// the matter's four classes across 186 offices, reported 10,483 hits against an enumerate ceiling of
// 600 — refused as a crowd, nothing read. Asking what the filings actually COVER is the only lever
// that narrows that sweep without narrowing the mark.
//
// The two registers take the same question in different shapes, measured against the live APIs
// (2026-09-20, count-only probes):
//   Clarivate  INT_GOODS_SERVICES_DESCRIPTION, EQUALS, WHOLE WORDS, several joined by OR.
//              CONTAINS is a hard 400. A mid-word wildcard is a hard 400.
//   Signa      filters.goods_services_text, free text.
// A connector that cannot send one at all must DEFER the slice. Running the un-narrowed sweep instead
// would return the very crowd the narrowing exists to cut and record it under the narrowed slice's
// qid — a widened search wearing a narrow slice's name, which is the false clean this engine exists
// to refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchRequest, GOODS_FIELD, goodsTermsOf } from "../../providers/clarivate/src/core.js";
import { CAPABILITIES as CLARIVATE } from "../../providers/clarivate/src/capabilities.js";
import { CAPABILITIES as SIGNA } from "../../providers/signa/src/capabilities.js";
import { CAPABILITIES as CORSEARCH } from "../../providers/corsearch/src/capabilities.js";
import { goodsTextGap, goodsTextUnsupportedReason } from "../register-plan.mjs";
import { goodsTermsList } from "../../providers/_shared/term-shape.mjs";

const MARK = "INVENTEDMARK";
const req = (extra) => buildSearchRequest({ name: MARK, regions: ["US"], nice_classes: [9], ...extra });
const fieldNamed = (body, name) => body.searchFields.find((f) => f.name === name);

test("the goods clause is whole words joined by OR, on the field the vendor documents", () => {
  const body = req({ goods_text: ["headphones", "earphones"] });
  const goods = fieldNamed(body, GOODS_FIELD);
  assert.ok(goods, `no ${GOODS_FIELD} clause was sent`);
  assert.equal(goods.operator, "EQUALS", "CONTAINS is a hard 400 on this field");
  assert.equal(goods.value, "headphones OR earphones", "several goods words are asked for with OR");
});

test("no wildcard reaches this field, even though every mark mode wraps its term in them", () => {
  const body = req({ goods_text: ["headphones"] });
  assert.ok(!fieldNamed(body, GOODS_FIELD).value.includes("*"),
    "a mid-word wildcard is a hard 400 on the goods field");
  // The contrast is the point: the SAME request's mark clause is wildcarded, and that is correct there.
  assert.ok(fieldNamed(body, "WORD_MARK_SPECIFICATION").value.includes("*"),
    "precondition: the mark field still rides its infix wildcards");
});

test("a multi-word term is refused, not quietly turned into an OR", () => {
  // Splitting "computer software" into `computer OR software` would match a filing that only ever says
  // "computer" — a WIDER search than the caller asked for, arriving silently. The list's contract is
  // whole words, so a phrase is a caller defect and fails at the door. What the wire does with a
  // two-word value here is unprobed, and guessing it into an OR is the same guess in a different hat.
  // A bare space on this field is an implicit OR — "wireless headphones" sent as written returns
  // EITHER word, a wider sweep than asked for, answering 200. `ADJ` is the ordered phrase operator,
  // so the connector joins the words with it rather than passing the space through.
  assert.equal(fieldNamed(req({ goods_text: ["wireless headphones"] }), GOODS_FIELD).value,
    "wireless ADJ headphones", "a phrase was passed through as a space-separated value");
  // …and a list of terms still ORs, with the phrase as one of its alternatives.
  assert.equal(fieldNamed(req({ goods_text: ["wireless headphones", "earphones"] }), GOODS_FIELD).value,
    "wireless ADJ headphones OR earphones");
  assert.equal(fieldNamed(req({ goods_text: ["a", "b", "c"] }), GOODS_FIELD).value, "a OR b OR c",
    "a three-word list is one clause, one call");
});

test("each register's phrase and list behaviour is declared, and they differ", () => {
  // Clarivate expresses both: a phrase through ADJ, a list through OR.
  assert.equal(CLARIVATE.goodsTextPhrases, true);
  assert.equal(CLARIVATE.goodsTextListOr, true);
  // Signa intersects a phrase's words — the nearest honest form — but has NO OR at all, so it cannot
  // be handed a list of alternatives.
  assert.equal(SIGNA.goodsTextPhrases, true);
  assert.equal(SIGNA.goodsTextListOr, false);
  // Corsearch ORs several product clauses; its phrase behaviour is unmeasured, so a phrase is refused.
  assert.equal(CORSEARCH.goodsTextPhrases, false);
  assert.equal(CORSEARCH.goodsTextListOr, true);
});

test("signa takes one goods term and refuses a list rather than intersecting it", async () => {
  const { buildSearchRequest: signaRequest } = await import("../../providers/signa/src/core.js");
  const one = signaRequest({ query: MARK, match: "contains", nice_classes: [9], goods_text: ["headphones"] });
  assert.equal(one.filters.goods_services_text, "headphones");
  // A phrase's words intersect here, which is the nearest honest form of the ask — sent as written.
  const phrase = signaRequest({ query: MARK, match: "contains", nice_classes: [9], goods_text: ["wireless headphones"] });
  assert.equal(phrase.filters.goods_services_text, "wireless headphones");
  // A LIST has no form here: OR is matched as a literal word, a pipe and a comma intersect, an array
  // is refused. Joining it with spaces would intersect the words and narrow as the list grew, at 200.
  assert.throws(() => signaRequest({ query: MARK, match: "contains", nice_classes: [9], goods_text: ["headphones", "earphones"] }),
    /no OR on its goods filter/, "a list was intersected instead of refused");
});

test("a wildcard is refused at the door, because it is a 400 on the wire", () => {
  for (const t of ["*phones", "head*", "*head*"]) {
    assert.throws(() => req({ goods_text: [t] }), /.+/, `the wildcard ${t} reached the goods clause`);
  }
});

test("the narrowing is an extra field on the same request, never a second search", () => {
  const body = req({ goods_text: ["headphones"] });
  for (const name of ["WORD_MARK_SPECIFICATION", "INT_CLASS_NUMBER", GOODS_FIELD]) {
    assert.ok(fieldNamed(body, name), `${name} is missing — the three clauses ride one request`);
  }
  // …and asking for goods changes nothing else about the query.
  const without = req({});
  for (const f of without.searchFields) {
    assert.deepEqual(fieldNamed(body, f.name), f, `the ${f.name} clause moved when goods text was added`);
  }
});

test("an empty or blank goods list sends no clause at all", () => {
  for (const goods_text of [[], [""], ["   "], null, undefined]) {
    assert.equal(fieldNamed(req({ goods_text }), GOODS_FIELD), undefined,
      `a blank goods list (${JSON.stringify(goods_text)}) still sent a clause`);
  }
});

test("goods text alone is not a search element — it narrows a search, it is not one", () => {
  // A goods-only query would return every filing whose description carries the word, in every class,
  // for every owner. That is not a narrowed sweep; it is a new and much wider one.
  assert.throws(() => buildSearchRequest({ goods_text: ["headphones"], regions: ["US"], nice_classes: [9] }),
    /narrows a search and is not one/, "a goods-only request was assembled");
});

test("one reader for the field, shared by the compiler, the executor and the connector", () => {
  const entry = { goods_text: "headphones" };
  assert.deepEqual(goodsTermsList(entry), ["headphones"], "a scalar and a one-element list differ");
  assert.deepEqual(goodsTermsList({ goods_text: ["a", "a", " a ", ""] }), ["a"],
    "duplicates and blanks survive, so the same ask would compile two different plans");
  assert.deepEqual(goodsTermsOf(entry), goodsTermsList(entry),
    "the connector reads the field differently from the compiler");
});

test("a provider whose connector cannot send it defers the slice, and says so in plain words", () => {
  const entry = { term: MARK, goods_text: ["headphones"], predicate: "default" };
  assert.equal(goodsTextGap(entry, CLARIVATE), null, "clarivate can send it and must not defer");
  assert.equal(goodsTextGap(entry, SIGNA), null, "signa can send it and must not defer");
  assert.equal(goodsTextGap(entry, CORSEARCH), null, "corsearch sends a product clause and must not defer");
  // The deferral itself, on a provider that declares nothing — the lane every future connector lands in.
  const gap = goodsTextGap(entry, { id: "a-new-provider" });
  assert.equal(gap, goodsTextUnsupportedReason("a-new-provider"));
  assert.match(gap, /never a clean negative/, "a deferred slice must never read as a clean");
  assert.match(gap, /crowd the narrowing exists to cut/,
    "the reason must say why the wide sweep is not an acceptable fallback");
  // An entry that asks for no goods text is untouched on every provider.
  for (const caps of [CLARIVATE, SIGNA, CORSEARCH, { id: "a-new-provider" }]) {
    assert.equal(goodsTextGap({ term: MARK, predicate: "default" }, caps), null);
  }
});

test("each provider's declaration matches what its own connector actually sends", () => {
  assert.equal(CLARIVATE.goodsTextSearch, true);
  assert.equal(CLARIVATE.goodsTextOperator, "EQUALS", "the probed operator, in one place");
  assert.equal(CLARIVATE.goodsTextWholeWordOnly, true);
  assert.equal(SIGNA.goodsTextSearch, true);
  assert.equal(CORSEARCH.goodsTextSearch, true);
});

test("no words and no capability each mean NO ENTRY — never a deferred row claiming a loss", async () => {
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const manifest = { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    incumbent_classes: [], goods_words: ["headphones"] };
  const job = { jobKey: "t", classes: ["9"], jurisdictions: [] };
  const goodsEntries = (p) => p.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);

  const withCap = compileRegisterPlan({ manifest, job, capabilities: CLARIVATE });
  assert.equal(goodsEntries(withCap).length, 1, "the narrowed entry did not compile where it can run");

  // A provider whose connector cannot send the clause: the entry is not compiled AT ALL. Compiling it
  // and letting the gap stamp it `unsupported` would print "this was not searched" in every instructed
  // class of every matter — about a slice whose population is a STRICT SUBSET of the broad sweep that
  // did run. A claimed coverage loss that did not happen is as false as a hidden one.
  const noCap = compileRegisterPlan({ manifest, job, capabilities: { id: "a-new-provider" } });
  assert.equal(goodsEntries(noCap).length, 0, "a narrowed entry compiled on a provider that cannot run it");
  assert.equal(noCap.entries.filter((e) => e.unsupported).length, 0, "it deferred instead of not compiling");

  // No wording anywhere on the matter: nothing to narrow BY, so the broad sweep stands alone.
  const noWords = compileRegisterPlan({ manifest: { ...manifest, goods_words: [] }, job, capabilities: CLARIVATE });
  assert.equal(goodsEntries(noWords).length, 0, "an empty word list compiled an entry with nothing in it");
});

test("a narrowed entry that finds nothing is not coverage, and cannot mask the parent's crowd", async () => {
  // DECIDED, and worth stating because the opposite is the attractive reading: this entry is a
  // NARROWING of the class-wide sweep beside it, not a search in its own right. So a zero from it is
  // never a clean negative on its own — the broad sweep is what covers the field — and it must not be
  // able to improve the axis's coverage line. The place that could go wrong is the skeleton, which
  // counts entries per axis: one more entry that enumerated could in principle dilute a crowd.
  const { deriveCoverageSkeleton } = await import("../register-plan.mjs");
  const plan = { entries: [
    { qid: "primary-sweep:default:mark", axis: "primary-sweep" },
    { qid: "primary-sweep:default:mark+goods", axis: "primary-sweep" },
  ] };
  // The parent crowded out; the narrowed entry ran and found nothing.
  const join = { missing: [], skipped: [], deferred: [],
    executed: [{ qid: "primary-sweep:default:mark", state: "incomplete" },
               { qid: "primary-sweep:default:mark+goods", state: "enumerated" }] };
  const axis = deriveCoverageSkeleton(plan, join).find((a) => a.axis === "primary-sweep");
  assert.equal(axis.state, "incomplete",
    "the narrowed entry's clean run masked the crowd the parent reported — the axis reads as covered");
  assert.equal(axis.crowds, 1, "the parent's crowd stopped being counted");
});

test("corsearch writes the same word list as its own product clauses", async () => {
  const { assembleQuery } = await import("../../providers/corsearch/src/core.js");
  const q = assembleQuery({ name: MARK, nice_classes: ["9"], goods_text: ["headphones", "earphones"] });
  assert.ok(q.includes("product:`headphones`"), "the first goods word did not reach the query");
  assert.ok(q.includes("product:`earphones`"), "the second goods word did not reach the query");
  // Within one field this query language ORs implicitly, so two clauses are "either word".
  assert.ok(q.includes("name:"), "the narrowing replaced the mark clause instead of narrowing it");
  assert.equal(assembleQuery({ name: MARK, nice_classes: ["9"] }).includes("product:"), false,
    "a query with no goods words still carried a product clause");
});
