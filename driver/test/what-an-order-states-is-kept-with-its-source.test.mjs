// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHAT AN ORDER STATES IS KEPT WITH ITS SOURCE. A request form named its product and four sales channels, the order's
// goods field was empty, and the frame said the brief gave no goods specification; every later stage read that frame.
// The facts an order states plainly are read by code at intake and kept in the run, each with where it was found, so
// what was asked is on record whatever any frame says. Keeping the record changes nothing a model reads. Invented
// names throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { statedFactsOf, requestFormFacts, writeStatedFacts, slotsFilledFrom } from "../stated-facts.mjs";
import { STAGES } from "../stages.mjs";
import { sandboxManifest } from "../stage-context.mjs";
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

// THE TOKEN-NEUTRAL USE OF THE RECORD: the facts go into the slots the assessors already read, and only where the order
// left them empty. The lost order's own shape: a form run together on one line, no goods field, and a use line of the
// order's own that the request's "Manner of Use" says more than.
const ONE_LINE = "From: desk@example.invalid Subject: Clearance QZORVAK Body: please see the form FORM: Names: QZORVAK Classes: 7, 8 "
  + `Description: QZORVAK Copper Edition hand blender, a limited finish of the brand's blender Manner of Use: ${CHANNELS.join(", ")} `
  + "Additional Info: none Send Response to: desk@example.invalid";
const LOST = { markName: "QZORVAK", classes: [7, 8], jurisdictions: ["CH", "EU"], priorUse: "assumed not yet in use", rawRequest: ONE_LINE };
const KEPT = { ...LOST, goods: "hand blenders", priorUse: "sold online and in stores" };   // an order whose own fields carry the facts
const frameMessage = (d, job) => String(STAGES["matter-frame"].message({ paths: paths(d), job, customerUnknown: true, profile: {}, exclusionSeed: [] }));

test("the lost order's product and all four channels reach the frame stage and the frame every later stage reads, each with its source", () => {
  const d = runDir(LOST);
  try {
    const msg = frameMessage(d, LOST);
    assert.match(msg, /^Goods\/services \(verbatim, as stated in the request\): QZORVAK Copper Edition hand blender, a limited finish of the brand's blender — request: the “Description” line \(line 1\)$/m);
    assert.match(msg, /^Stated prior\/intended use: Multiple stated values: assumed not yet in use — order: the prior or intended use field; own online shop, department stores, kitchen specialist retailers, gift-box packaging — request: the “Manner of Use” line \(line 1\)$/m);
    const r = recordMatterFrame(d, PARAMS);
    assert.ok(r.written, r.refused);
    const scope = readFileSync(r.written, "utf8").split("## Instructed scope")[1].split("Stamped by the driver")[0];
    assert.match(scope, /- \*\*Goods\/services:\*\* QZORVAK Copper Edition hand blender, a limited finish of the brand's blender — request: the “Description” line \(line 1\)/);
    for (const c of CHANNELS) assert.ok(scope.includes(c), `the frame's instructed scope lost "${c}"`);
    assert.match(scope, /- \*\*Use:\*\* Multiple stated values: assumed not yet in use — order: the prior or intended use field; own online shop/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("an order whose own fields carry its goods reads exactly what it always read: the frame stage and the frame, byte for byte", () => {
  const withRecord = runDir(KEPT), without = mkdtempSync(join(tmpdir(), "stated-facts-none-"));
  try {
    assert.ok(statedFactsOf(KEPT), "guard: the request states facts the order already carries");
    assert.equal(slotsFilledFrom(statedFactsOf(KEPT)), null);
    assert.equal(frameMessage(withRecord, KEPT).replaceAll(withRecord, "<run>"), frameMessage(without, KEPT).replaceAll(without, "<run>"));
    assert.equal(readFileSync(recordMatterFrame(withRecord, PARAMS).written, "utf8"), acceptMatterFrame(PARAMS, { instructedScope: SCOPE }).content);
  } finally { rmSync(withRecord, { recursive: true, force: true }); rmSync(without, { recursive: true, force: true }); }
});

test("an experiment arm on the frame stage carries the record, so a replay of a goods-less order is filled as the run was", () => {
  const d = runDir(LOST), shadow = mkdtempSync(join(tmpdir(), "stated-facts-arm-"));
  try {
    const manifest = sandboxManifest("matter-frame", paths(d));
    assert.ok(manifest.some((e) => e.path === paths(d).statedFacts), "the frame stage's sandbox does not declare the record");
    // Seeded as an --experiment arm seeds its sandbox: every manifest file the run holds, at the same place.
    for (const e of manifest) {
      if (e.dir || !existsSync(e.path) || !e.path.startsWith(d)) continue;
      const to = join(shadow, e.path.slice(d.length + 1));
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(e.path, to);
    }
    assert.equal(frameMessage(shadow, LOST).replaceAll(shadow, "<run>"), frameMessage(d, LOST).replaceAll(d, "<run>"));
    assert.match(frameMessage(shadow, LOST), /as stated in the request/);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(shadow, { recursive: true, force: true }); }
});

test("a goods-less order whose request states nothing more is not touched either", () => {
  const plain = { markName: "QZORVAK", classes: [7, 8], priorUse: "assumed not yet in use", rawRequest: "Please proceed as discussed." };
  assert.equal(slotsFilledFrom(statedFactsOf(plain)), null, "an order's own use alone fills nothing");
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
