// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A LAYER ROW NAMES EVERY REGISTER IT LEFT. An EU order through a provider that holds three member registers
// leaves 22 national registers unsearched, and the coverage form's layer row holds all 22 in its receipt. The
// workbook's coverage-judgment row printed the writer's reason instead, cut at 160 characters, which named the
// first five or so after "including". The driver now names the full list from the receipt, in the order form's
// words, so no model retypes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bindingLayersFor, territoryLayerReport } from "../binding-layers.mjs";
import { layerReceipt, nationalRegistersNotSearched, nationalRegistersNote, orderFormName, isLayerRow } from "../coverage-form.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

// The pipeline reads its settings at import, so they are pinned first.
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-layer-row-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
const { coverageJudgmentRows } = await import("../pipeline.mjs");

// A provider that returns the EU register, three member registers and the international register, the
// shape of a register that holds France, Spain and Sweden among the member states.
const THREE_MEMBERS = { offices: { layers: {
  EM: { regional: "returns" }, WO: { international: "returns" },
  FR: { national: "returns" }, ES: { national: "returns" }, SE: { national: "returns" },
} } };
const SEARCHED = ["EM", "FR", "ES", "SE", "WO"];
const NAMED_22 = ["Austria", "Benelux", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Denmark", "Estonia", "Finland",
  "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Malta", "Poland", "Portugal", "Romania",
  "Slovakia", "Slovenia"];
const FULL_NOTE = `the national registers of ${NAMED_22.slice(0, -1).join(", ")}, and ${NAMED_22.at(-1)} were not searched`;

const report = territoryLayerReport("EU", SEARCHED, THREE_MEMBERS);
const RECEIPT = layerReceipt(report);

test("an EU order on a three-member register: the receipt reads back as the 22 registers it left", () => {
  assert.equal(report.unsearched.length, 22);
  const offices = nationalRegistersNotSearched(RECEIPT);
  assert.deepEqual(offices, report.unsearched.map((u) => u.office));
  assert.equal(nationalRegistersNote(offices), FULL_NOTE);
});

test("every national register an EU order can name has a name on the order form", () => {
  const offices = bindingLayersFor("EU").filter((b) => b.layer === "national").map((b) => b.office);
  assert.equal(offices.length, 25);
  for (const o of offices) assert.ok(orderFormName(o), `no order-form name for ${o}`);
});

test("one register reads in the singular, and the names are sorted with the serial comma", () => {
  assert.equal(nationalRegistersNote(["MT"]), "the national register of Malta was not searched");
  assert.equal(nationalRegistersNote(["PT", "IE"]), "the national registers of Ireland and Portugal were not searched");
  assert.equal(nationalRegistersNote(["PT", "IE", "AT"]), "the national registers of Austria, Ireland, and Portugal were not searched");
});

test("a receipt this module did not write, or one naming another layer, is not read as a list", () => {
  assert.equal(nationalRegistersNotSearched(""), null);
  assert.equal(nationalRegistersNotSearched("national (AT): unestablished; regional (EM): unestablished"), null);
  assert.equal(nationalRegistersNotSearched("the national register was not searched"), null);
  assert.equal(nationalRegistersNotSearched("national (at): unestablished"), null);
  assert.equal(nationalRegistersNote(["AT", "QQ"]), null, "a code without a name leaves the row as it was");
});

// The ledger is rendered from the form, so the layer row's axis, status and reason are the form row's own.
const LAYER_REASON = "National rights in most member states were not searched.";
const LEDGER = [
  { axis: "primary-sweep", scope: "", status: "deferred", reason: LAYER_REASON },
  { axis: "primary-sweep", scope: "US reconciliation", status: "coverage-limited", reason: "Counted, not cleared." },
];
const FORM = [
  { row_id: "CL-TESTROW1", kind: "deferred", axis: "primary-sweep", unit: "EU — binding registers not all searched",
    receipt_reason: RECEIPT, status: "deferred", reason: LAYER_REASON },
  { row_id: "CA-TESTROW2", kind: "axis", axis: "primary-sweep", unit: "primary-sweep", status: "coverage-limited", reason: "x" },
];

test("the coverage-judgment row of a layer row names every register, under the territory's label", () => {
  assert.ok(isLayerRow(FORM[0]) && !isLayerRow(FORM[1]));
  const before = coverageJudgmentRows(LEDGER, null, null);
  const after = coverageJudgmentRows(LEDGER, null, null, FORM);
  assert.equal(after.length, before.length);
  assert.deepEqual(after[0], { area: before[0].area, areaLabel: "European Union: national registers", note: `deferred — ${FULL_NOTE}` });
  assert.deepEqual(after.slice(1), before.slice(1), "every other row is unchanged");
});

test("a run with no layer row, as on a register that holds every member, reads exactly as before", () => {
  const all = { offices: { layers: { "*": { national: "returns", regional: "returns", international: "returns" } } } };
  assert.equal(territoryLayerReport("EU", ["EM", "AT", "WO"], all).complete, false, "the national match is by office");
  const everyOffice = bindingLayersFor("EU").map((b) => b.office);
  assert.equal(territoryLayerReport("EU", everyOffice, all).complete, true);
  assert.deepEqual(coverageJudgmentRows(LEDGER, null, null, []), coverageJudgmentRows(LEDGER, null, null));
  assert.deepEqual(coverageJudgmentRows(LEDGER, null, null, [FORM[1]]), coverageJudgmentRows(LEDGER, null, null));
});

test("a layer row that does not match exactly one ledger row is left as it was", () => {
  const twice = [LEDGER[0], { ...LEDGER[0] }, LEDGER[1]];
  assert.deepEqual(coverageJudgmentRows(twice, null, null, FORM), coverageJudgmentRows(twice, null, null));
  const reworded = [{ ...LEDGER[0], reason: "Reworded after the form." }, LEDGER[1]];
  assert.deepEqual(coverageJudgmentRows(reworded, null, null, FORM), coverageJudgmentRows(reworded, null, null));
  const mixed = [{ ...FORM[0], receipt_reason: `${RECEIPT}; international (WO): unestablished` }];
  assert.deepEqual(coverageJudgmentRows(LEDGER, null, null, mixed), coverageJudgmentRows(LEDGER, null, null));
});
