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
    assert.equal(body.match, "exact", "`match: contains` is the 400 this change exists to avoid; exact is the deterministic shape");
    assert.equal(body.strategies, undefined, "the ranked shape rides beside the deterministic one, which the register refuses");
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

// ── THE SAME FLOOR ON THE TWO PATHS THAT ASK THE CONTAINS FORM AFTER THE PLAN IS FROZEN ─────────────
//
// The crowd-context pass counts each formative term on the contains form, twice (all classes, and the
// in-scope classes); the reading turn mints its own questions, and "default" is the predicate it
// proposes most. On a two-letter mark on a register with a floor, both came back as errors: the crowd
// read "count unavailable", and the reading turn's own contains questions were refused. Same rule on
// both: the exact form, the same filters, one question for one, and the entry says so.
import { mintSliceCountEntries, buildCrowdContext } from "../crowd-context.mjs";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { readFileSync as readSrc } from "node:fs";
import { join as joinPath, dirname as dirOf } from "node:path";
import { fileURLToPath as fromUrl } from "node:url";

const SLICE = { axis: "primary-sweep", unit: "u", reason: "r", terms: [SHORT], nice_classes: ["9"], regions: [] };

test("crowd context: a short term's two counts are asked exactly, and a long one keeps contains", () => {
  const short = mintSliceCountEntries(SLICE, 0, { capabilities: PROVIDER_CAPABILITIES.signa });
  const perTerm = short.filter((e) => /-t0-/.test(e.qid));
  assert.equal(perTerm.length, 2, "one count across all classes and one in the in-scope classes");
  for (const e of perTerm) {
    assert.equal(e.predicate, "exact", `${e.qid} still counts on the contains form`);
    assert.equal(e.contains_substituted?.min_length, 3);
    assert.equal(signaWire(e).match, "exact", "the wire carries match: contains, or no exact at all");
  }
  assert.equal(short.length, mintSliceCountEntries(SLICE, 0).length, "the substitution changed how many counts are asked");
  const long = mintSliceCountEntries({ ...SLICE, terms: [LONG] }, 0, { capabilities: PROVIDER_CAPABILITIES.signa });
  for (const e of long.filter((x) => /-t0-/.test(x.qid))) assert.equal(e.predicate, "default");
  for (const id of ["clarivate", "corsearch"]) {
    for (const e of mintSliceCountEntries(SLICE, 0, { capabilities: PROVIDER_CAPABILITIES[id] }).filter((x) => /-t0-/.test(x.qid)))
      assert.equal(e.predicate, "default", `${id}: a count changed form with no declared floor`);
  }
});

test("crowd context, driven: the executor is handed the exact form, and the count row records it", async () => {
  // THE PATH, not the minting function: buildCrowdContext is what the pipeline calls, and a floor that
  // stopped at mintSliceCountEntries would never reach the executor.
  const handed = [];
  const executor = async (entries) => { handed.push(...entries); return entries.map((e) => ({ qid: e.qid, total_hits: 7 })); };
  const ledger = [{ axis: "primary-sweep", unit: "q1", status: "coverage-limited", reason: `a crowd on ${SHORT}` }];
  const planContext = { entries: [{ qid: "q1", axis: "primary-sweep", predicate: "default", term: SHORT, nice_classes: ["9"] }], niceClasses: ["9"], regions: [] };
  const cc = await buildCrowdContext({ ledger, planContext, executor, capabilities: PROVIDER_CAPABILITIES.signa });
  const counts = handed.filter((e) => /-t\d+-/.test(e.qid));
  // PREMISE: the ledger row must have been selected, or this arm reads an empty population and passes.
  assert.ok(counts.length >= 2, `no per-term count reached the executor (${handed.length} entr(ies) in all) — the fixture selected no slice`);
  for (const e of counts) assert.equal(e.predicate, "exact", `${e.qid} reached the executor on the contains form`);
  const row = cc.json.slices[0].term_counts[0];
  assert.equal(row.contains_substituted?.to, "exact", "the count row does not say it was an exact count");
});

test("reading turn: a contains proposal on a short term is minted exactly; a long one and a mixed stack are not", () => {
  const propose = (p, caps = PROVIDER_CAPABILITIES.signa) =>
    mintSupplementalEntries("primary-sweep", [{ nice_classes: ["9"], rationale: "narrow the crowd", ...p }], { capabilities: caps });
  const { minted: [short] } = propose({ predicate: "default", term: SHORT, goods_words: ["software"] });
  assert.equal(short.predicate, "exact");
  assert.match(short.qid, /^supp:primary-sweep:exact:/, "the qid must name the question actually asked");
  assert.equal(short.contains_substituted?.term_length, 2);
  assert.deepEqual(short.goods_text, ["software"], "the goods narrowing rides the substituted question");
  const wire = signaWire(short);
  assert.equal(wire.match, "exact", "the substituted question is not the exact one on the wire");
  assert.equal(wire.filters.goods_services_text, "software");
  assert.equal(propose({ predicate: "default", term: LONG }).minted[0].predicate, "default");
  assert.equal(propose({ predicate: "default", term: SHORT }, PROVIDER_CAPABILITIES.clarivate).minted[0].predicate, "default",
    "a register with no declared floor keeps the form the model chose");
  // A long member must never be narrowed to exact. Where the register has OR, a mixed stack stays one
  // question in the model's form; where it has none, the stack is one question per name, so the short
  // name alone is asked exactly and the long one keeps its form.
  assert.equal(propose({ predicate: "default", terms: [SHORT, LONG] }, PROVIDER_CAPABILITIES.clarivate).minted[0]?.predicate, "default");
  assert.deepEqual(propose({ predicate: "default", terms: [SHORT, LONG] }).minted.map((e) => [e.term, e.predicate]),
    [[SHORT, "exact"], [LONG, "default"]]);
  // The model's own exact and wildcard questions are its choice, and are never touched.
  assert.equal(propose({ predicate: "exact", term: SHORT }).minted[0].contains_substituted, undefined);
});

test("every register's propose tool hands the minting its own capabilities, so the floor is read on the wire path", () => {
  // The reading turn reaches mintSupplementalEntries through the register's MCP server. A server that
  // passed no capabilities would leave the floor unread, and every arm above would still pass.
  const here = dirOf(fromUrl(import.meta.url));
  for (const id of ["signa", "clarivate", "corsearch"]) {
    const src = readSrc(joinPath(here, "..", "engine", "mcp", `${id}-server.mjs`), "utf8");
    assert.match(src, /proposeSupplemental\([\s\S]{0,300}capabilities: CAPABILITIES/, `${id}-server does not pass its capabilities`);
  }
});

test("the pipeline hands the crowd-context pass the active register's capabilities", () => {
  // buildCrowdContext defaults to no capabilities, which counts every term on the contains form. The
  // floor reaches a run only if the pipeline's own call passes them, so the call site is asserted.
  const src = readSrc(joinPath(dirOf(fromUrl(import.meta.url)), "..", "pipeline.mjs"), "utf8");
  const call = src.slice(src.indexOf("await buildCrowdContext({"), src.indexOf("await buildCrowdContext({") + 600);
  assert.ok(call.length > 100, "the pipeline no longer calls buildCrowdContext where this arm looks");
  assert.match(call, /capabilities: registerCapabilities\(\)/, "the crowd-context call passes no register capabilities");
});
