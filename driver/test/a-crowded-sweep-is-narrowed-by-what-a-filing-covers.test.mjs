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
  assert.equal(CLARIVATE.goodsTextMultiWord, "ordered-phrase");
  assert.equal(CLARIVATE.goodsTextListOr, true);
  // Signa intersects a phrase's words — the nearest honest form — but has NO OR at all, so it cannot
  // be handed a list of alternatives.
  assert.equal(SIGNA.goodsTextMultiWord, "word-intersection");
  assert.equal(SIGNA.goodsTextListOr, false);
  // The two are NOT the same answer, which is why the flag names the meaning instead of saying yes:
  // one returns the words in that order, the other any filing carrying all of them anywhere.
  assert.notEqual(CLARIVATE.goodsTextMultiWord, SIGNA.goodsTextMultiWord);
  // Corsearch ORs several product clauses; its phrase behaviour is unmeasured, so a phrase is refused.
  assert.equal(CORSEARCH.goodsTextMultiWord, null, "unmeasured must be null, not false — they differ");
  assert.equal(CORSEARCH.goodsTextListOr, true);
});

test("a register with no OR gets one plan entry per word; one with an OR gets one entry", async () => {
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const manifest = { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    incumbent_classes: [], goods_words: ["alpha", "beta", "gamma"] };
  const job = { jobKey: "t", classes: ["9"], jurisdictions: [] };
  const goods = (caps) => compileRegisterPlan({ manifest, job, capabilities: caps })
    .entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);

  // Clarivate offers the three as alternatives in one clause: one question, one count.
  const one = goods(CLARIVATE);
  assert.equal(one.length, 1, "a register with an OR asked three questions instead of one");
  assert.deepEqual(one[0].goods_text, ["alpha", "beta", "gamma"]);

  // Signa has no OR on this field at all, so the words cannot ride one value — joining them would
  // INTERSECT them, narrowing as the list grows and still answering 200. Three questions instead.
  const three = goods(SIGNA);
  assert.equal(three.length, 3, "a register with no OR did not get one entry per word");
  assert.deepEqual(three.map((e) => e.goods_text), [["alpha"], ["beta"], ["gamma"]],
    "each entry must carry exactly one word — the wire refuses more");
  // Each is an ordinary dictated question, so each has its own identity to count and ledger against.
  assert.equal(new Set(three.map((e) => e.qid)).size, 3, "the per-word entries share a qid");
  for (const e of three) assert.match(e.qid, /\+goods-/, "a per-word entry is not identifiable as one");

  // Corsearch ORs its product clauses, so it is the one-entry shape too.
  assert.equal(goods(CORSEARCH).length, 1);
});

test("the manual tells the model to write the key, and a manifest written to it compiles the entry", async () => {
  // THE ARM THAT WOULD HAVE CAUGHT THE FEATURE BEING INERT. Every other arm here builds a manifest
  // object directly, so all of them pass whether or not anything ever tells the model to write
  // `goods_words`. The compiler reads that key and nothing else by design, so if the instruction is
  // missing the key never arrives, the entry never compiles, and the narrowing silently does nothing
  // while the cost saving beside it still lands.
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { parseVariantManifestModel } = await import("../variant-manifest-model.mjs");
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

  const manual = readFileSync(join(ROOT, "driver", "skills", "clearance-variants", "SKILL.md"), "utf8");
  assert.match(manual, /`goods_words`/, "nothing tells the model to write the key the compiler reads");
  assert.match(manual, /at most 24/, "the bound the compiler enforces is not stated to the model");
  // The owner manual must not still promise a lane that no longer compiles.
  const registerManual = readFileSync(join(ROOT, "driver", "skills", "clearance-register", "unit.md"), "utf8");
  // ASSERT WHAT IT SAYS, NOT THAT ONE OLD STRING IS GONE. Checking for the absence of a single phrase
  // passed while the paragraph still asserted the lane in different words a few clauses earlier — the
  // manual told the model both that the lane exists and that it does not.
  assert.match(registerManual, /plan carries no owner lane from the manifest's watchlist/,
    "the register manual does not state that the owner lane is gone");
  assert.doesNotMatch(registerManual, /owner lane lives HERE|plan-dictated OWNER LANE/,
    "the register manual still asserts the owner lane somewhere in the same paragraph");
  // The instruction must also warn about the words the register reads as operators, since a client's
  // own class 9 wording plausibly contains one ("near field communication").
  assert.match(manual, /cannot read the words and, or, not, adj or near/,
    "nothing warns the model about the words the register parses as operators");

  // A manifest shaped the way that instruction asks for it, taken through the real parser.
  const parsed = parseVariantManifestModel({
    schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    goods_words: ["headphones", "earphones"],
  });
  const plan = compileRegisterPlan({ manifest: parsed, job: { jobKey: "t", classes: ["9"], jurisdictions: [] },
    capabilities: CLARIVATE });
  assert.equal(plan.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length).length, 1,
    "a manifest written to the manual compiled no narrowed entry");
});

test("a phrase a register cannot take drops ALONE, and the drop is disclosed on the plan", async () => {
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const base = { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    incumbent_classes: [] };
  const job = { jobKey: "t", classes: ["9"], jurisdictions: [] };
  const plan = (goods_words, caps) => compileRegisterPlan({ manifest: { ...base, goods_words }, job, capabilities: caps });
  const goodsOf = (p) => p.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);

  // THE DEFECT THIS CLOSES: one phrase used to suppress the WHOLE narrowing, so a register that could
  // have been asked "headphones" was asked nothing at all and the crowd stayed a crowd.
  const mixed = plan(["headphones", "computer software"], CORSEARCH);
  assert.equal(goodsOf(mixed).length, 1, "one phrase suppressed the words beside it");
  assert.deepEqual(goodsOf(mixed)[0].goods_text, ["headphones"], "the sendable word was not asked");

  // DROPPING IT SILENTLY WOULD BE THE SAME DEFECT WEARING A BETTER FACE. The words are OR-ed, so a
  // dropped term makes the clause NARROWER: fewer records, and a conflict that term would have
  // surfaced is never found. The model was asked for it, so the plan says it did not go.
  assert.deepEqual(mixed.goods_text_not_asked, ["computer software"]);
  assert.match(mixed.goods_text_not_asked_reason, /never a clean negative/);
  assert.match(mixed.goods_text_not_asked_reason, /LESS than the list/);

  // A phrase-only list on such a register compiles nothing, and still discloses.
  const only = plan(["computer software"], CORSEARCH);
  assert.equal(goodsOf(only).length, 0);
  assert.deepEqual(only.goods_text_not_asked, ["computer software"]);

  // A REGISTER WITH AN HONEST FORM MUST NOT DROP AT ALL. Signa intersects the words, which is a
  // superset of the true phrase and a subset of each single word — less than asked, never more.
  const sig = plan(["wireless headphones", "earphones"], SIGNA);
  assert.equal(sig.goods_text_not_asked, undefined, "a register with an honest form dropped a term");
  assert.deepEqual(goodsOf(sig).map((e) => e.goods_text), [["wireless headphones"], ["earphones"]]);

  // Clarivate takes the phrase as an adjacency inside the OR — nothing dropped, one question.
  const clar = plan(["wireless headphones", "earphones"], CLARIVATE);
  assert.equal(clar.goods_text_not_asked, undefined);
  assert.deepEqual(goodsOf(clar)[0].goods_text, ["wireless headphones", "earphones"]);

  // A plan that sends its whole list carries neither field, so those plans stay byte-identical.
  const clean = plan(["headphones"], CLARIVATE);
  assert.ok(!("goods_text_not_asked" in clean) && !("goods_text_not_asked_reason" in clean));
});

test("a word the register reads as an operator comes out of the item, not the item out of the list", async () => {
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const base = { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    incumbent_classes: [] };
  const job = { jobKey: "t", classes: ["9"], jurisdictions: [] };
  const plan = (goods_words) => compileRegisterPlan({ manifest: { ...base, goods_words }, job, capabilities: CLARIVATE });
  const goodsOf = (p) => p.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);

  // "near field communication" is ordinary class 9 specification language, and NEAR is an operator in
  // the value on this register. The word comes out; the rest of the term is still asked.
  const near = plan(["headphones", "near field communication"]);
  assert.deepEqual(goodsOf(near)[0].goods_text, ["headphones", "field communication"]);
  assert.deepEqual(near.goods_text_rewritten,
    [{ term: "near field communication", removed: ["near"], asked: "field communication" }]);

  // AND/OR/NOT were screened before, but by THROWING — which killed the whole entry and took the good
  // terms with it. ADJ and NEAR were not screened at all on this path and reached the wire.
  for (const [term, word] of [["controllers and peripherals", "and"], ["cases or sleeves", "or"],
                              ["adj2 straps", "adj2"], ["near field tags", "near"]]) {
    const p = plan(["headphones", term]);
    assert.equal(goodsOf(p).length, 1, `a reserved word in ${JSON.stringify(term)} killed the entry`);
    assert.ok(goodsOf(p)[0].goods_text.includes("headphones"),
      `the good term was lost alongside ${JSON.stringify(term)}`);
    assert.deepEqual(p.goods_text_rewritten[0].removed, [word]);
  }

  // A term that is NOTHING BUT a reserved word has nothing left to ask, so it goes — and says so.
  const only = plan(["headphones", "near"]);
  assert.deepEqual(goodsOf(only)[0].goods_text, ["headphones"]);
  assert.deepEqual(only.goods_text_rewritten, [{ term: "near", removed: ["near"], asked: null }]);

  // A clean list carries neither field, so those plans stay byte-identical.
  assert.ok(!("goods_text_rewritten" in plan(["headphones", "earphones"])));

  // The connector is the backstop for paths that never go through a plan, and it STRIPS rather than
  // throws — a throw there would take every good term down with the bad one.
  assert.doesNotThrow(() => req({ goods_text: ["controllers and peripherals"] }));

  // ── THE ADJACENCY IS WIDENED BY WHAT CAME OUT ────────────────────────────────────────────────────
  //
  // Removing a word from the MIDDLE leaves the survivors further apart than they were written. No
  // filing says "controllers peripherals", so a strict adjacency finds nothing where the widened one
  // finds the phrase that was meant — measured 1 against 0. This is the rule the mark field already
  // follows for the same reason.
  assert.equal(fieldNamed(req({ goods_text: ["controllers and peripherals"] }), GOODS_FIELD).value,
    "controllers ADJ2 peripherals", "the adjacency was not widened by the removed word");
  // A word off the FRONT changes no distance between the words that remain, so this one stays strict.
  assert.equal(fieldNamed(req({ goods_text: ["near field communication"] }), GOODS_FIELD).value,
    "field ADJ communication", "a leading removal widened an adjacency it does not affect");
  // Two removals between the same pair widen by both.
  assert.equal(fieldNamed(req({ goods_text: ["headphones and or cases"] }), GOODS_FIELD).value,
    "headphones ADJ3 cases");
  // …and a phrase with nothing removed is unchanged.
  assert.equal(fieldNamed(req({ goods_text: ["wireless headphones"] }), GOODS_FIELD).value,
    "wireless ADJ headphones");

  // THE PAIR THAT USED TO COLLAPSE. Before the gap was carried, these two produced the SAME wire
  // value, so the difference between a word taken off the front and one taken from the middle was
  // lost — the second silently asserted an adjacency across the hole it had just made.
  assert.notEqual(fieldNamed(req({ goods_text: ["near field communication"] }), GOODS_FIELD).value,
    fieldNamed(req({ goods_text: ["field near communication"] }), GOODS_FIELD).value);
  assert.equal(fieldNamed(req({ goods_text: ["field near communication"] }), GOODS_FIELD).value,
    "field ADJ2 communication");
  // Ordinary specification wording, and each step carries its own distance.
  assert.equal(fieldNamed(req({ goods_text: ["audio and video apparatus"] }), GOODS_FIELD).value,
    "audio ADJ2 video ADJ apparatus");
});

test("compile then connect: the wire string a planned goods term actually produces", async () => {
  // THE ARM THAT CATCHES THE COMPOSITION. Both halves were right on their own and the path through
  // them was wrong: the compiler strips once and stores what will be asked, so the connector received
  // "controllers peripherals" with nothing left to strip, recomputed every gap as 1, and asked for a
  // plain adjacency — the query that matches nothing. Testing the connector with the RAW term passed,
  // and testing the compiler's stored term passed, and neither of them was what runs.
  //
  // So this one drives the REAL path: compile the plan, build the entry query the executor would
  // build, and pin the string that reaches the wire.
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const { defaultBuildEntryQuery, planPredicateParams } = await import("../../providers/_shared/execute-plan.mjs");
  const base = { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    incumbent_classes: [] };
  const job = { jobKey: "t", classes: ["9"], jurisdictions: [] };
  const wireFor = (word) => {
    const plan = compileRegisterPlan({ manifest: { ...base, goods_words: [word] }, job, capabilities: CLARIVATE });
    const entry = plan.entries.find((e) => Array.isArray(e.goods_text) && e.goods_text.length);
    const query = defaultBuildEntryQuery(entry, planPredicateParams(entry));
    return fieldNamed(buildSearchRequest({ ...query, name: MARK, regions: ["US"] }), GOODS_FIELD).value;
  };

  assert.equal(wireFor("controllers and peripherals"), "controllers ADJ2 peripherals");
  assert.equal(wireFor("field near communication"), "field ADJ2 communication");
  assert.equal(wireFor("audio and video apparatus"), "audio ADJ2 video ADJ apparatus");
  // A leading removal opens no gap between the survivors, so this one stays strict.
  assert.equal(wireFor("near field communication"), "field ADJ communication");
  // …and a term with nothing removed is unchanged by any of it.
  assert.equal(wireFor("wireless headphones"), "wireless ADJ headphones");

  // The plan STATES the distances, which is what makes the frozen artifact a full account of what
  // will be asked rather than only of which words will be asked.
  const plan = compileRegisterPlan({ manifest: { ...base, goods_words: ["audio and video apparatus"] },
    job, capabilities: CLARIVATE });
  const entry = plan.entries.find((e) => Array.isArray(e.goods_text) && e.goods_text.length);
  assert.deepEqual(entry.goods_text, ["audio video apparatus"]);
  assert.deepEqual(entry.goods_text_gaps, [[2, 1]], "the plan does not state the distances it will ask at");
});

test("a word removed from inside a term is disclosed on the entry and on the plan", async () => {
  // NOTHING EDITS THE CLIENT'S WORDING SILENTLY. The model wrote the term; the register carried less
  // than it says. A reader comparing the goods list to the search must be able to see that.
  const { compileRegisterPlan } = await import("../register-plan.mjs");
  const base = { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    incumbent_classes: [] };
  const job = { jobKey: "t", classes: ["9"], jurisdictions: [] };
  const plan = compileRegisterPlan({ manifest: { ...base, goods_words: ["headphones", "controllers and peripherals"] },
    job, capabilities: CLARIVATE });
  const entry = plan.entries.find((e) => Array.isArray(e.goods_text) && e.goods_text.length);

  assert.deepEqual(entry.goods_text, ["headphones", "controllers peripherals"]);
  assert.deepEqual(entry.goods_text_omitted, ["and"], "the removed word is not on the entry");
  assert.deepEqual(plan.goods_text_not_asked, ["and"], "the removed word is not on the plan");
  assert.match(entry.goods_text_omitted_reason, /never more/);
  assert.match(entry.goods_text_omitted_reason, /widened by the gap/);
  // …and the term-by-term record says what was asked in its place.
  assert.deepEqual(plan.goods_text_rewritten,
    [{ term: "controllers and peripherals", removed: ["and"], asked: "controllers peripherals" }]);

  // A whole item that is nothing but a reserved word is disclosed the same way.
  const dropped = compileRegisterPlan({ manifest: { ...base, goods_words: ["headphones", "near"] },
    job, capabilities: CLARIVATE });
  assert.deepEqual(dropped.goods_text_not_asked, ["near"]);

  // A clean list discloses nothing, so those plans stay byte-identical.
  const clean = compileRegisterPlan({ manifest: { ...base, goods_words: ["headphones"] }, job, capabilities: CLARIVATE });
  assert.ok(!("goods_text_not_asked" in clean) && !("goods_text_rewritten" in clean));
});

test("a matter whose plan was frozen before this build gains the narrowed entry", async () => {
  // THE FAILURE THIS CLOSES IS THE QUIETEST ONE ON THIS BRANCH. Beta goes to production and the change
  // is judged on the next dense matter — but a matter frozen before the deploy would carry no narrowed
  // entry at all: no deferred row, no disclosure, just an entry never minted. A read of that run could
  // not tell "the narrowing was never added" from "the narrowing found nothing".
  //
  // It took two independent causes, either alone enough, and it is verbatim the lesson the fingerprint
  // comment already records against the romanisations: the moved fingerprint alone is not the fix.
  const { compileRegisterPlan, extendRegisterPlan } = await import("../register-plan.mjs");
  const base = { schema_version: 1, mark: MARK, dominant_element: MARK,
    elements: [{ value: MARK, kind: "distinctive" }], variants: [{ value: MARK, category: "core" }],
    incumbent_classes: [], watchlist_owners: ["An Invented Owner"] };
  const job = { jobKey: "t", classes: ["9"], jurisdictions: [] };
  const stored = compileRegisterPlan({ manifest: base, job, capabilities: CLARIVATE });
  const fresh = compileRegisterPlan({ manifest: { ...base, goods_words: ["headphones", "earphones"] },
    job, capabilities: CLARIVATE });

  // 1. The manifest gaining the key must not fingerprint identically, or the stored plan is reused
  //    byte-identical and the extension path never runs at all.
  assert.notEqual(stored.derived_from.variants_fingerprint, fresh.derived_from.variants_fingerprint,
    "a manifest that gained goods words fingerprints the same, so the stored plan is reused verbatim");

  // 2. …and once it runs it must actually append. The narrowed entry shares axis, predicate, term and
  //    owner with the class-wide parent, so a key without the goods terms reads it as already carried.
  const extended = extendRegisterPlan(stored, fresh);
  const plan = extended.plan ?? extended;
  const goods = plan.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);
  assert.equal(goods.length, 1, "the extension appended no narrowed entry to a pre-build plan");
  assert.deepEqual(goods[0].goods_text, ["headphones", "earphones"]);

  // The stored plan's own entries are carried forward untouched — the frozen plan is the contract.
  for (const e of stored.entries) {
    assert.ok(plan.entries.some((x) => x.qid === e.qid), `a stored entry was lost: ${e.axis}`);
  }

  // A manifest carrying no goods words keeps the fingerprint it always had, so nothing re-mints for a
  // field it never had.
  const noGoods = compileRegisterPlan({ manifest: { ...base, goods_words: [] }, job, capabilities: CLARIVATE });
  assert.equal(noGoods.derived_from.variants_fingerprint, stored.derived_from.variants_fingerprint);
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
