// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHAT AN ORDER STATES IS KEPT WITH ITS SOURCE. A request form named its product and four sales channels, the order's
// goods field was empty, and the frame said the brief gave no goods specification; every later stage read that frame.
// The facts an order states plainly are read by code at intake and kept in the run, each with where it was found, so
// what was asked is on record whatever any frame says. Keeping the record changes nothing a model reads. Invented
// names throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statedFactsOf, requestFormFacts, writeStatedFacts } from "../stated-facts.mjs";
import { acceptMatterFrame, recordMatterFrame } from "../matter-frame-record.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../run-record.mjs";

const CHANNELS = ["own online shop", "department stores", "kitchen specialist retailers", "gift-box packaging"];
// The shape that was lost: a request form, as the email door renders a table, with the goods field left empty.
const FORM = ["Hello, our request form is below.", "", "Field | Answer", "Mark | QZORVAK", "Product | QZORVAK Copper Edition hand blender",
  "Classes | 7, 8", `Sales channels | ${CHANNELS.join(", ")}`, "Territories | Switzerland, EU", "", "Kind regards"].join("\n");
const JOB = { markName: "QZORVAK", classes: [7, 8], jurisdictions: ["CH", "EU"], rawRequest: FORM };
const SCOPE = { marks: ["QZORVAK"], classes: [7, 8], jurisdictions: ["CH", "EU"], goods: null };
// A frame that says what the lost frame said: no goods specification, and no channels.
const PARAMS = {
  prose_body: "The brief gives no goods specification; QZORVAK could be a hardware product, a game or a franchise, so the frame reads it across those sectors.".padEnd(320, " ."),
  scope_basis: "instructed", scope_jurisdictions: ["CH", "EU"], excluded_jurisdictions: [], search_channels: ["amazon.de"],
  meaning_angles: [], meaning_angles_none: true, intake_asks: [], identified_classes: [],
};

function runDir(job) {
  const d = mkdtempSync(join(tmpdir(), "stated-facts-"));
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(paths(d).instructedScope, JSON.stringify(SCOPE));
  writeStatedFacts(paths(d), job);
  return d;
}

test("the lost shape: an empty goods field, and the product and all four channels are kept, each with its source", () => {
  const d = runDir(JOB);
  try {
    const record = JSON.parse(readFileSync(paths(d).statedFacts, "utf8"));
    assert.deepEqual(record.facts.map((f) => [f.field, f.value]), [
      ["description", "QZORVAK Copper Edition hand blender"], ["channels", CHANNELS.join(", ")]]);
    assert.deepEqual(record.facts.map((f) => f.source), ["request: the “Product” line (line 5)", "request: the “Sales channels” line (line 7)"]);
    assert.deepEqual(record.multiple, []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("keeping the record changes nothing a model reads: the frame renders exactly as it did", () => {
  const d = runDir(JOB);
  try {
    const r = recordMatterFrame(d, PARAMS);
    assert.ok(r.written, r.refused);
    assert.equal(readFileSync(r.written, "utf8"), acceptMatterFrame(PARAMS, { instructedScope: SCOPE }).content);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a form flattened onto one line, as an order once arrived: each labelled field is read up to the next label", () => {
  const oneLine = "From: desk@example.invalid Subject: Clearance QZORVAK Body: please see the form FORM: Names: QZORVAK Classes: 7, 8 "
    + `Description: QZORVAK Copper Edition hand blender, a limited finish of the brand's blender Manner of Use: ${CHANNELS.join(", ")} `
    + "Additional Info: none Send Response to: desk@example.invalid";
  const { facts } = statedFactsOf({ markName: "QZORVAK", classes: [7, 8], rawRequest: oneLine });
  assert.deepEqual(facts.map((f) => [f.field, f.value, f.source]), [
    ["description", "QZORVAK Copper Edition hand blender, a limited finish of the brand's blender", "request: the “Description” line (line 1)"],
    ["use", CHANNELS.join(", "), "request: the “Manner of Use” line (line 1)"]]);
});

test("an order that states no such fact leaves no stated-facts file", () => {
  const plain = { markName: "QZORVAK", classes: [7, 8], rawRequest: "Please proceed with the clearance we discussed on the phone.\n\nThanks" };
  assert.equal(statedFactsOf(plain), null);
  const d = runDir(plain);
  try {
    assert.equal(existsSync(paths(d).statedFacts), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("an input already flagged incomplete at intake keeps its flag, word for word", () => {
  const flagged = { ...JOB, goods: "route planning software; cloud hosting of route da [the request was cut off here at intake]", rawRequest: undefined };
  const { facts } = statedFactsOf(flagged);
  assert.deepEqual(facts, [{ field: "goods", value: flagged.goods, source: "order: the goods field" }]);
});

test("a fact stated twice, differently, is kept both times, each with its source, as multiple stated values; one stated twice alike is kept once", () => {
  const job = { ...JOB, goods: "kitchen appliances", priorUse: "launch in spring", rawRequest: `${FORM}\nGoods: hand blenders and spare blades\nGoods: kitchen appliances` };
  const { facts, multiple } = statedFactsOf(job);
  assert.deepEqual(facts.filter((f) => f.field === "goods").map((f) => [f.value, f.source]), [
    ["kitchen appliances", "order: the goods field"], ["hand blenders and spare blades", "request: the “Goods” line (line 11)"]]);
  assert.deepEqual(multiple, ["goods"]);
  assert.deepEqual(facts.find((f) => f.field === "use"), { field: "use", value: "launch in spring", source: "order: the prior or intended use field" });
});

test("the labels are a fixed set in four languages, in either shape, and a value may follow as a list", () => {
  const facts = requestFormFacts([
    "**Produktbeschreibung:** Stabmixer aus Kupfer", "Vertriebskanäle | Fachhandel, Online-Shop", "Canaux de distribution : grands magasins",
    "Uso previsto: vendita al dettaglio", "Goods and services:", "- hand blenders", "- spare blades", "", "Distribution: internal only",
    "Our products are sold worldwide.", "Product manager: Jane Example",
  ].join("\n"));
  assert.deepEqual(facts.map((f) => [f.field, f.value]), [
    ["description", "Stabmixer aus Kupfer"], ["channels", "Fachhandel, Online-Shop"], ["channels", "grands magasins"],
    ["use", "vendita al dettaglio"], ["goods", "hand blenders; spare blades"]]);
});
