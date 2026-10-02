// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — a judged run under a framework that states a method, from the judges' form to the stage gate
//
// THE JUDGES RATE THROUGH THE CLIENT'S METHOD (design, 2026-10-02).
//
// A framework can state a method: named inputs and a table from them to a band. When the rating moved to
// the judges, the method stayed with synthesis's gate while synthesis stopped being told about it, so every
// judged run under such a framework failed at synthesis and delivered nothing. Now, on a method framework
// only: the judges read the method's own sentence beside the rating scale, their form takes the inputs for
// every owner considered, the answer check holds each carried rating to the table, the merge keeps each
// judge's inputs with that judge's rating, and the stamp writes the inputs of the judge whose rating was
// taken. Synthesis never writes inputs: any it sends leave at the stamp. A framework with no method is as
// it was. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { parseFrameworkMethod, freezeFrameworkMethod, methodDictation, FROZEN_METHOD_FILE } from "../framework-method.mjs";
import { STAGES } from "../stages.mjs";
import { ANSWER_FORM, composeMessage, checkAnswer, mergeJudgments } from "../owner-judgment.mjs";
import { recordSynthesis } from "../synthesis-record.mjs";
import { validators } from "../verify.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" }, { label: "Low", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const METHOD = parseFrameworkMethod({
  schema_version: 1, framework_key: "orchard-test",
  inputs: [
    { label: "Claim Grade", values: ["P", "Q", "R"], ordered: true },
    { label: "Conflict Kind", values: ["Orchard", "Harbour"], show_label: false },
  ],
  table: [
    { band: "Severe", when: { "Claim Grade": ["R"], "Conflict Kind": ["Orchard"] } },
    { band: "High", when: { "Claim Grade": ["R"], "Conflict Kind": ["Harbour"] } },
    { band: "Medium", when: { "Claim Grade": ["Q"] } },
    { band: "Low", when: { "Claim Grade": ["P"] } },
  ],
}, MANIFEST);
const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};
// The fixture's one finding: owner "Mystery Owner LLC", registration /mark/us/90000001. Judge 2's rating is
// the higher, so it is the one taken, with its inputs.
const DECISIONS = {
  schema_version: 1, judges: { asked: 2, answered: [1, 2] },
  overall_ratings: [{ judge: 1, rating: "Medium" }, { judge: 2, rating: "High" }],
  carried: [{ owners: ["Mystery Owner LLC"], owners_in_the_pile: [], records: ["/mark/us/90000001"], web: [],
    ratings: [
      { judge: 1, rating: "Medium", marks_alike: "close", goods_close: "different", inputs: { "Claim Grade": "Q", "Conflict Kind": "Orchard" } },
      { judge: 2, rating: "High", marks_alike: "same", goods_close: "overlapping", inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour" } }],
    carried_by: [1, 2], decisions: [] }],
  set_aside: [],
};
function judgedRun({ method }) {
  const dir = mkdtempSync(join(tmpdir(), "judged-method-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "framework.json"), JSON.stringify(MANIFEST, null, 2));
  if (method) freezeFrameworkMethod(driverDir(dir, FROZEN_METHOD_FILE), method);
  writeFileSync(join(dir, "owner-decisions.json"), JSON.stringify(DECISIONS, null, 2));
  return dir;
}
const doc = (dir, over = {}) => { const d = JSON.parse(synthesisFindings(dir)); Object.assign(d.findings[0], over); return d; };
const gate = (dir) => { const p = join(dir, "narrative.md"); return validators.findings(p, readFileSync(p, "utf8")); };

test("on a method framework the judges' form takes the inputs, each described by its values alone; with none it is the form as shipped", () => {
  const form = STAGES["owner-judgment"].confined({ frameworkMethod: METHOD }).answerForm;
  const item = form.properties.considered.items;
  assert.ok(item.required.includes("inputs"), "the inputs are not required of every owner considered");
  assert.deepEqual(item.properties.inputs.required, ["Claim Grade", "Conflict Kind"]);
  assert.deepEqual(item.properties.inputs.properties["Claim Grade"], { type: "string", enum: ["P", "Q", "R"], description: "`P`, `Q` or `R`." });
  assert.deepEqual(item.properties.inputs.properties["Conflict Kind"], { type: "string", enum: ["Orchard", "Harbour"], description: "`Orchard` or `Harbour`." });
  assert.equal(item.properties.inputs.additionalProperties, false, "a form the strict engine can take");
  assert.equal(STAGES["owner-judgment"].confined({}).answerForm, ANSWER_FORM, "a framework with no method changed the judges' form");
});

test("the judges read the method's own sentence beside the rating scale, and only on a method framework", () => {
  const parts = { order: "Mark: QZXV", context: "An invented client.", ratingScale: "Severe, High, Medium, Low.", workedExamples: "None here." };
  const withMethod = composeMessage({ ...parts, method: METHOD });
  const scale = withMethod.slice(withMethod.indexOf("# The client's rating scale"), withMethod.indexOf("# The client's worked examples"));
  assert.ok(scale.includes(methodDictation(METHOD)), "the method's sentence is not beside the rating scale");
  assert.equal(withMethod.split(methodDictation(METHOD)).length, 2, "the sentence appears more than once");
  assert.ok(!composeMessage(parts).includes("rates through its inputs"), "a framework with no method told the judges about inputs");
  assert.equal(composeMessage({ ...parts, method: null }), composeMessage(parts));
});

test("the answer check holds a carried rating to the client's table, and only a carried one", () => {
  const facts = { recordIds: new Set(["/mark/us/90000001"]), framework: MANIFEST, method: METHOD };
  const entry = (over) => ({ owners: ["Mystery Owner LLC"], decision: "carry", records: ["/mark/us/90000001"], rating: "High",
    marks_alike: "same", goods_close: "overlapping", reason: "The same mark, live.", ...over });
  const answer = (...considered) => ({ considered, overall_rating: "High", advice: "", questions_wished_for: [] });
  assert.deepEqual(checkAnswer(answer(entry({ inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour" } })), facts).failures, []);
  assert.deepEqual(checkAnswer(answer(entry({ inputs: { "Claim Grade": "R", "Conflict Kind": "Orchard" } })), facts).failures, ["judgment_band_off_table:1"]);
  assert.deepEqual(checkAnswer(answer(entry({})), facts).failures, ["judgment_inputs_missing:1"]);
  assert.deepEqual(checkAnswer(answer(entry({ inputs: { "Claim Grade": "Z", "Conflict Kind": "Harbour" } })), facts).failures, ["judgment_inputs_invalid:1"]);
  // a set-aside owner's inputs are never read against the table
  assert.deepEqual(checkAnswer(answer(entry({ decision: "set_aside", rating: "", inputs: { "Claim Grade": "P", "Conflict Kind": "Orchard" } })), facts).failures, []);
  // with no method, nothing about inputs is asked
  assert.deepEqual(checkAnswer(answer(entry({})), { ...facts, method: null }).failures, []);
});

test("the merge keeps each judge's inputs with that judge's rating", () => {
  const considered = (rating, inputs) => ({ considered: [{ owners: ["Mystery Owner LLC"], decision: "carry", records: ["/mark/us/90000001"],
    rating, marks_alike: "same", goods_close: "overlapping", reason: "The same mark.", inputs }], overall_rating: rating, advice: "", questions_wished_for: [] });
  const m = mergeJudgments({ table: null, judges: [
    { judge: 1, answer: considered("Medium", { "Claim Grade": "Q", "Conflict Kind": "Orchard" }), opening: new Set(), looked: new Set() },
    { judge: 2, answer: considered("High", { "Claim Grade": "R", "Conflict Kind": "Harbour" }), opening: new Set(), looked: new Set() },
  ] });
  const ratings = m.carried[0].ratings;
  assert.deepEqual(ratings.map((r) => [r.judge, r.rating, r.inputs?.["Claim Grade"]]), [[1, "Medium", "Q"], [2, "High", "R"]]);
});

test("a judged run under a method framework records the judges' band and inputs, and the stage gate passes", () => {
  const dir = judgedRun({ method: METHOD });
  // synthesis sends no inputs (it is not told to) and a band of its own: both are the judges' now
  const r = recordSynthesis(dir, { findings: doc(dir, { band: "Low" }), narrative: NARRATIVE });
  assert.ok(r.written, `refused: ${r.refused ?? ""}`);
  const f = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings[0];
  assert.equal(f.band, "High", "the band is not the merged rating");
  assert.deepEqual(f.inputs, { "Claim Grade": "R", "Conflict Kind": "Harbour" }, "the inputs are not those of the judge whose rating was taken");
  const g = gate(dir);
  assert.equal(g.ok, true, `the stage gate refused the judges' record: ${g.reason ?? ""}`);
  // inputs synthesis sends anyway leave at the stamp: the judges' stand
  const again = recordSynthesis(dir, { findings: doc(dir, { inputs: { "Claim Grade": "P", "Conflict Kind": "Orchard" } }), narrative: NARRATIVE });
  assert.ok(again.written, `refused: ${again.refused ?? ""}`);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings[0].inputs, { "Claim Grade": "R", "Conflict Kind": "Harbour" });
  assert.equal(gate(dir).ok, true);
});

test("a judged run under a framework with no method drops any inputs synthesis sends, and the stage gate passes", () => {
  const dir = judgedRun({ method: null });
  const r = recordSynthesis(dir, { findings: doc(dir, { inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour" } }), narrative: NARRATIVE });
  assert.ok(r.written, `refused: ${r.refused ?? ""}`);
  assert.equal(JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).findings[0].inputs, undefined);
  const g = gate(dir);
  assert.equal(g.ok, true, `the stage gate refused: ${g.reason ?? ""}`);
});

test("the method form is strict at every level, as Codex's structured answer requires, and reaches both engines as built", () => {
  // Both adapters write the stage's form verbatim: Claude's `--json-schema`, Codex's `--output-schema` file
  // (anthropic-agent.mjs, openai-agent.mjs). Codex takes only a strict schema: every object closed, every
  // property required. The shipped form holds that; the method's form must too, all the way down.
  const objects = [];
  const walk = (s, at) => {
    if (!s || typeof s !== "object") return;
    if (s.type === "object") objects.push([at, s]);
    for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, `${at}.${k}`);
    if (s.items) walk(s.items, `${at}[]`);
  };
  const form = STAGES["owner-judgment"].confined({ frameworkMethod: METHOD }).answerForm;
  walk(form, "form");
  assert.ok(objects.some(([at]) => at.endsWith(".inputs")), "premise: the walk reached the inputs");
  for (const [at, s] of objects) {
    assert.equal(s.additionalProperties, false, `${at} is open`);
    assert.deepEqual([...(s.required ?? [])].sort(), Object.keys(s.properties ?? {}).sort(), `${at} leaves a property optional`);
  }
});
