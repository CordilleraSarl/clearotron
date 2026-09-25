// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — parses an invented framework's method and rates findings through its table
//
// A framework that states a method — named inputs, and a table from them to a band — declares it beside
// its deck, and every rated conflict records the inputs and takes the band the table gives. These arms
// pin the shared pieces both rating paths use: the method file's validation, the check a rating goes
// through, and the line the page shows. The framework here is invented; its labels are nobody's.
//
// BREAK MATRIX:
//   · a table that leaves a combination without a band, or gives it two, is accepted     → arm 1 red
//   · a method is accepted against another framework's manifest, or with a foreign band   → arm 1 red
//   · a rating with no inputs, an unknown value, an input named twice or an off-table band passes → arm 2 red
//   · a borderline band the table does not give for a neighbour passes                    → arm 2 red
//   · a framework with no method accepts inputs, or refuses a rating without them         → arm 3 red
//   · the page line drops the framework's order or its label choice                       → arm 4 red
//   · a run frozen with no method reads as having one, or a corrupt copy reads as none    → arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrameworkManifest } from "../framework.mjs";
import {
  parseFrameworkMethod, checkRatingInputs, inputsLine, tableBand, neighbourBands, methodPathFor,
  loadFrameworkMethod, readFrozenMethod, freezeFrameworkMethod,
} from "../framework-method.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "orchard-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const METHOD = {
  schema_version: 1, framework_key: "orchard-test",
  inputs: [
    { label: "Claim Grade", values: ["P", "Q", "R"], ordered: true },
    { label: "Conflict Kind", values: ["Orchard", "Harbour"], show_label: false },
  ],
  table: [
    { band: "Severe", when: { "Claim Grade": ["R"], "Conflict Kind": ["Orchard"] } },
    { band: "serious", when: { "Claim Grade": ["R"], "Conflict Kind": ["Harbour"] } },
    { band: "Notable", when: { "Claim Grade": ["Q"] } },
    { band: "Slight", when: { "Claim Grade": ["P"] } },
  ],
};
const method = parseFrameworkMethod(METHOD, MANIFEST);

test("a method parses only when its table gives every combination exactly one of the framework's bands", () => {
  assert.equal(method.table[1].band, "Serious", "a band is kept in the manifest's own casing");
  assert.equal(tableBand(method, ["R", "Harbour"]), "Serious");
  assert.equal(tableBand(method, ["Q", "Orchard"]), "Notable", "a row that does not name an input matches all its values");
  const bad = (patch, re) => assert.throws(() => parseFrameworkMethod({ ...METHOD, ...patch }, MANIFEST), re);
  bad({ table: METHOD.table.slice(1) }, /framework_method_table_incomplete: no row gives a band for Claim Grade R, Conflict Kind Orchard/);
  bad({ table: [...METHOD.table, { band: "Serious", when: { "Conflict Kind": ["Orchard"] } }] }, /framework_method_table_ambiguous/);
  bad({ table: [{ band: "Moderate", when: {} }] }, /framework_method_row_band_invalid/);
  bad({ table: [{ band: "Slight", when: { "Claim Grade": ["Z"] } }] }, /framework_method_row_value_unknown/);
  bad({ framework_key: "another" }, /framework_method_key_mismatch/);
  bad({ weights: [] }, /framework_method_key_unknown/);
  bad({ inputs: [{ label: "Grade 1", values: ["P", "Q"] }] }, /framework_method_input_label_invalid/);
  bad({ inputs: [{ label: "Claim Grade", values: ["P"] }] }, /framework_method_input_values_invalid/);
});

test("a rated conflict records every input, one of its values, and the band the table gives for them", () => {
  const ok = checkRatingInputs(method, { inputs: { "claim grade": "r", "Conflict Kind": "harbour" }, band: "Serious" });
  assert.equal(ok.issue, undefined);
  assert.deepEqual(ok.inputs, { "Claim Grade": "R", "Conflict Kind": "Harbour" }, "the inputs come back in the framework's casing and order");

  const issue = (arg) => checkRatingInputs(method, arg).issue;
  assert.deepEqual(issue({ band: "Serious" }),
    { code: "inputs_missing", detail: 'this framework rates through Claim Grade and Conflict Kind; record both under "inputs"' });
  assert.equal(issue({ inputs: { "Claim Grade": "R" }, band: "Serious" }).code, "inputs_missing");
  assert.deepEqual(issue({ inputs: { "Claim Grade": "S", "Conflict Kind": "Harbour" }, band: "Serious" }),
    { code: "inputs_invalid", detail: "Claim Grade must be one of: P / Q / R" });
  assert.equal(issue({ inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour", Weight: "3" }, band: "Serious" }).code, "inputs_unknown");
  assert.deepEqual(issue({ inputs: { "Claim Grade": "R", "claim grade": "P", "Conflict Kind": "Harbour" }, band: "Serious" }),
    { code: "inputs_duplicate", detail: "Claim Grade is given twice; record it once" }, "one input named twice is refused, never collapsed");
  assert.deepEqual(issue({ inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour" }, band: "Severe" }),
    { code: "band_off_table", detail: "the band Severe is not what this framework's table gives for Claim Grade R and Conflict Kind Harbour; the table gives Serious. Change the band, or reconsider an input" });

  assert.deepEqual(neighbourBands(method, ["Q", "Orchard"]).sort(), ["Severe", "Slight"]);
  assert.equal(issue({ inputs: { "Claim Grade": "Q", "Conflict Kind": "Orchard" }, band: "Notable", borderline: ["Notable", "Severe"] }), undefined,
    "a finding may sit between its band and the band of a neighbouring grade");
  assert.equal(issue({ inputs: { "Claim Grade": "Q", "Conflict Kind": "Orchard" }, band: "Notable", borderline: ["Notable", "Serious"] }).code, "borderline_off_table",
    "a borderline band the table gives no neighbour is refused");

  assert.equal(issue({ inputs: { "Claim Grade": "R", "Conflict Kind": "Harbour" }, band: null, rated: false }).code, "inputs_forbidden",
    "an unrated item records no inputs");
});

test("a framework that states no method rates exactly as before", () => {
  assert.deepEqual(checkRatingInputs(null, { band: "Serious" }), { inputs: undefined });
  assert.equal(checkRatingInputs(null, { inputs: { "Claim Grade": "R" }, band: "Serious" }).issue.code, "inputs_forbidden");
});

test("the page shows the inputs in the framework's order, each with or without its label as the framework says", () => {
  assert.equal(inputsLine(method, { "Conflict Kind": "Harbour", "Claim Grade": "R" }), "Claim Grade R · Harbour");
  assert.equal(inputsLine(null, { "Claim Grade": "R" }), "");
  assert.equal(inputsLine(method, undefined), "");
});

test("a method is frozen once and read back verbatim; none frozen is none, and a corrupt copy is never none", () => {
  const root = mkdtempSync(join(tmpdir(), "fw-method-"));
  const deck = "skills/clearance-search/risk-framework-orchard.md";
  assert.equal(methodPathFor(deck), "skills/clearance-search/risk-framework-orchard.method.json");
  assert.equal(loadFrameworkMethod((rel) => join(root, rel), deck, MANIFEST), null, "no method file: the framework states no method");
  mkdirSync(join(root, "skills/clearance-search"), { recursive: true });
  writeFileSync(join(root, methodPathFor(deck)), JSON.stringify(METHOD));
  const loaded = loadFrameworkMethod((rel) => join(root, rel), deck, MANIFEST);
  assert.deepEqual(loaded, method);

  const frozen = join(root, "framework-method.json");
  assert.deepEqual(readFrozenMethod(frozen, MANIFEST), { method: null }, "a run frozen without a method has none");
  freezeFrameworkMethod(frozen, loaded);
  assert.deepEqual(readFrozenMethod(frozen, MANIFEST).method, method);
  writeFileSync(frozen, "{ not json");
  const corrupt = readFrozenMethod(frozen, MANIFEST);
  assert.equal(corrupt.method, null);
  assert.match(corrupt.invalid, /framework_method_unparseable/, "a corrupt frozen method is reported, never read as no method");
});
