// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MARK SHORTER THAN THE REGISTER'S CONTAINS FORM ACCEPTS IS ASKED ON THE EXACT FORM, ONE FOR ONE.
//
// Measured on a two-letter mark, 2026-09-22: its identical question crowded, and every always-on
// goods-narrowed question and the saturation probe went out on the contains form, which the register
// documents as needing three characters. All of them came back 400. The narrowing the matter needed was
// the one the register would not run.
//
// Each register now declares the shortest term its contains form accepts, and a shorter term is asked on
// the exact form with the same classes and goods words. These arms drive a two-letter mark through the
// compiler for each register, and on the register with a floor, on through the executor's query builder
// to the request body that goes over the wire: the compiler alone passing would say nothing about what
// the register is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { compileRegisterPlan, containsFormSubstitution, foldedTermLength } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { defaultBuildEntryQuery, planPredicateParams } from "../../providers/_shared/execute-plan.mjs";
import { buildSearchRequest, toSignaParams } from "../../providers/signa/src/core.js";

const SHORT = "QX";
const LONG = "QUANTIX";
const manifestFor = (mark) => ({ schema_version: 1, mark, dominant_element: mark,
  elements: [{ value: mark, kind: "distinctive" }, { value: mark, kind: "common" }],
  variants: [{ value: mark, category: "core" }],
  incumbent_classes: [], goods_words: ["software", "messaging", "scheduling"] });
const JOB = { jobKey: "t", classes: ["9", "42"], jurisdictions: [] };
const compile = (mark, capabilities) => compileRegisterPlan({ manifest: manifestFor(mark), job: JOB, capabilities });

const goodsEntries = (plan) => plan.entries.filter((e) => Array.isArray(e.goods_text) && e.goods_text.length);
const probeEntries = (plan) => plan.entries.filter((e) => e.axis === "saturation-probe");
/** What the executor hands Signa's connector, and what the connector puts on the wire. */
const signaWire = (e) => buildSearchRequest(toSignaParams(defaultBuildEntryQuery(e, planPredicateParams(e))));

test("the three registers declare their floor, and only a documented one is a number", () => {
  assert.equal(PROVIDER_CAPABILITIES.signa.containsMinLength, 3, "Signa documents three characters for contains");
  // No vendor document states one for these two, so none is declared: a number must come from the vendor.
  assert.equal(PROVIDER_CAPABILITIES.clarivate.containsMinLength, null);
  assert.equal(PROVIDER_CAPABILITIES.corsearch.containsMinLength, null);
});

test("folded length counts what the register counts: case and accents folded, spaces not counted", () => {
  assert.equal(foldedTermLength("QX"), 2);
  assert.equal(foldedTermLength("Éx"), 2, "an accent is not a character of its own");
  assert.equal(foldedTermLength("Q X"), 2, "a space does not lift a term over the floor");
  assert.equal(foldedTermLength("QUANTIX"), 7);
});

test("Signa: a two-letter mark's goods-narrowed questions and probe are asked exactly, and say so", () => {
  const plan = compile(SHORT, PROVIDER_CAPABILITIES.signa);
  const goods = goodsEntries(plan), probes = probeEntries(plan);
  assert.equal(goods.length, 3, "Signa has no OR on its goods field, so one question per goods word");
  assert.equal(probes.length, 1);
  for (const e of [...goods, ...probes]) {
    assert.equal(e.predicate, "exact", `${e.qid} still goes out on the contains form`);
    assert.equal(e.unsupported, undefined, `${e.qid} was deferred instead of asked`);
    assert.deepEqual(e.contains_substituted && { from: e.contains_substituted.from, to: e.contains_substituted.to,
      min: e.contains_substituted.min_length, len: e.contains_substituted.term_length },
      { from: "default", to: "exact", min: 3, len: 2 }, `${e.qid} does not record the substitution`);
    assert.match(e.contains_substituted.reason, /only for a term of 3 or more characters/);
  }
  // The same filters as the contains form would have carried: the instructed classes and one goods word each.
  for (const e of goods) assert.deepEqual(e.nice_classes, ["9", "42"]);
  assert.deepEqual(goods.map((e) => e.goods_text).flat().sort(), ["messaging", "scheduling", "software"]);
});

test("Signa: the request that goes over the wire is the exact form, with both filters, and no contains", () => {
  const plan = compile(SHORT, PROVIDER_CAPABILITIES.signa);
  for (const e of goodsEntries(plan)) {
    const body = signaWire(e);
    assert.equal(body.query, SHORT);
    assert.equal(body.match, undefined, "`match: contains` is the 400 this change exists to avoid");
    assert.deepEqual(body.strategies, ["exact"], "the ranked exact shape, whose floor is two characters");
    assert.deepEqual(body.filters.nice_classes, [9, 42]);
    assert.equal(body.filters.goods_services_text, e.goods_text[0], "the goods word rides the same request");
  }
  // THE CONTROL, which is half the test: a mark at or over the floor keeps the contains form on the wire.
  for (const e of goodsEntries(compile(LONG, PROVIDER_CAPABILITIES.signa))) {
    assert.equal(e.predicate, "default");
    assert.equal(e.contains_substituted, undefined);
    assert.equal(signaWire(e).match, "contains", "a long mark lost its contains form");
  }
});

test("the substitution is one for one: the same number of questions, the same ungated set", () => {
  const withFloor = compile(SHORT, PROVIDER_CAPABILITIES.signa);
  const withoutFloor = compile(SHORT, { ...PROVIDER_CAPABILITIES.signa, containsMinLength: null });
  assert.equal(withFloor.entries.length, withoutFloor.entries.length, "the substitution added or removed a question");
  const shape = (plan) => plan.entries.map((e) => `${e.axis}|${e.expected_kind}|${(e.goods_text ?? []).join(",")}|${e.when ? "waits" : "open"}`).sort();
  assert.deepEqual(shape(withFloor), shape(withoutFloor), "something other than the form of the question moved");
  const moved = withFloor.entries.filter((e) => e.contains_substituted);
  assert.equal(moved.length, 4, "three goods-narrowed questions and one probe, and nothing else");
});

test("Clarivate and Corsearch declare no floor, so a two-letter mark compiles exactly as it did", () => {
  for (const id of ["clarivate", "corsearch"]) {
    const plan = compile(SHORT, PROVIDER_CAPABILITIES[id]);
    const touched = [...goodsEntries(plan), ...probeEntries(plan)];
    assert.ok(touched.length >= 2, `${id}: the population is empty, so this arm would pass having looked at nothing`);
    for (const e of touched) {
      assert.equal(e.predicate, "default", `${id}: ${e.qid} changed form with no declared floor`);
      assert.equal(e.contains_substituted, undefined);
    }
  }
});

test("a register with no capabilities, or a floor below two, substitutes nothing", () => {
  assert.equal(containsFormSubstitution(SHORT, null), null);
  assert.equal(containsFormSubstitution(SHORT, { id: "x", containsMinLength: 1 }), null);
  assert.equal(containsFormSubstitution("ABC", { id: "x", containsMinLength: 3 }), null, "at the floor is enough");
  assert.equal(containsFormSubstitution("AB", { id: "x", containsMinLength: 3 }).to, "exact");
});
