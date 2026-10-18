// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// GOODS NOT ESTABLISHED WHOLE ARE NEVER READ AS A MISMATCH.
//
// The shared goods reader is the one place that says whether a goods statement is whole (ruled 2026-10-18). A
// statement is whole where its source says so: a search answer's statement shorter than the default answer's
// documented cut, a retrieved record the register flags whole, the record text of a full record, the bulk
// register statement the US index holds. It is cut where the register flags it. Anywhere else its completeness
// is not established: an unflagged search-answer statement at or over the cut, a retrieved record with no flag, a
// register whose full-record operation the tree documents nowhere. Missing words in such goods establish nothing,
// so the goods test the band shape groups on reads a statement that matches none of the client's words as
// unknown, never as goods unrelated to the client's, and its line is listed with the goods the test could not
// read. A match still stands. Every mark, owner and statement here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { normalizeSearchResponse } from "../../providers/signa/src/core.js";
import { buildBandShape } from "../band-shape.mjs";
import { bandShapeGoods, rowGoods, goodsWordCounter, goodsWordsMatched, recordGoodsProvenance, DEFAULT_ANSWER_CUT } from "../record-goods.mjs";

const pad = (text, n) => (text + " and other goods".repeat(40)).slice(0, n);
const statement = (text, flag) => ({ nice_class: 9, goods_services_text: text, goods_services_language: "en",
  ...(flag === undefined ? {} : { goods_services_text_truncated: flag }) });
const vendorRow = (id, owner, classifications) => ({ id, mark_text: "QZORVAK", jurisdiction_code: "US", office_code: "US",
  status: { primary: "active", stage: "registered" }, classifications,
  owners: [{ id: `o-${id}`, name: owner, country_code: "CH" }], filing_date: "2019-03-04", registration_date: "2020-01-02" });
const ROWS = normalizeSearchResponse({ data: [
  vendorRow("w1", "Alpha Ltd", [statement(pad("Laser printers", DEFAULT_ANSWER_CUT - 1), false)]),  // under the cut, no match → (b)
  vendorRow("w2", "Beta GmbH", [statement(pad("Laser printers", DEFAULT_ANSWER_CUT), false)]),      // at the cut, unflagged, no match → unknown
  vendorRow("w3", "Gamma SA", [statement(pad("Joysticks; printers", DEFAULT_ANSWER_CUT), false)]),  // at the cut, a match → (a)
  vendorRow("w4", "Delta AG", [statement(pad("Laser printers", DEFAULT_ANSWER_CUT), true)]),        // flagged → cut, no match → unknown
], pagination: { total_count: 4, has_more: false } }, "qzorvak").results;
const row = (k) => ROWS.find((r) => r.id === k);

test("a search answer's statement is whole under the default answer's documented cut, cut where flagged, and not established at or over the cut", () => {
  assert.equal(DEFAULT_ANSWER_CUT, 280);
  const marks = (r) => (rowGoods(r) ?? []).map((g) => (g.cut ? "cut" : g.unknown ? "unknown" : "whole"));
  assert.deepEqual(marks(row("w1")), ["whole"]);
  assert.deepEqual(marks(row("w2")), ["unknown"], "an unflagged statement at the cut was read as whole on the register's word, which the default answer never gives");
  assert.deepEqual(marks(row("w4")), ["cut"]);
  const over = { record_id: "/mark/us/w5", raw: { classifications: [statement(pad("Laser printers", 300))] } };
  assert.deepEqual(marks(over), ["unknown"], "longer than the cut, from an answer documented to cut at it: nothing establishes it whole");
  const spaced = { record_id: "/mark/us/w6", raw: { classifications: [statement(`${pad("Laser printers", DEFAULT_ANSWER_CUT - 1)} `)] } };
  assert.deepEqual(marks(spaced), ["unknown"], "the cut is measured on the text the register sent, before it is trimmed");
});

test("the goods test reads a statement not established whole that names none of the client's words as unknown, and a match as a match", () => {
  const count = goodsWordCounter(["joysticks"], { stems: true }), matched = goodsWordsMatched(["joysticks"], { stems: true });
  const of = (k) => rowGoods(row(k));
  assert.deepEqual([count(of("w1")), matched(of("w1"))], [0, []], "whole and no match: not the client's goods");
  assert.deepEqual([count(of("w2")), matched(of("w2"))], [null, null], "not established and no match: unknown, never a mismatch");
  assert.deepEqual([count(of("w3")), matched(of("w3"))], [1, ["joysticks"]], "not established and a match: the match stands");
});

test("the band shape lists a line whose goods are not established whole, and match nothing, with the goods it could not read", (t) => {
  const runDir = mkdtempSync(join(tmpdir(), "goods-not-whole-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const P = { runDir, variantManifestModel: join(runDir, "variant-manifest.json"), registerPlan: driverDir(runDir, "register-plan.json") };
  writeFileSync(P.variantManifestModel, JSON.stringify({ schema_version: 1, mark: "QZORVAK", dominant_element: "QZORVAK",
    elements: [{ value: "QZORVAK", kind: "distinctive" }], variants: [{ value: "QZORVAK", category: "core" }],
    incumbent_classes: [], watchlist_owners: [], goods_words: ["joysticks"], product_words: ["joysticks"] }));
  const g = bandShapeGoods(P, ROWS);
  const { shape } = buildBandShape({ enumerated: ROWS, crowds: [] }, { targets: ["Qzorvak"], inScopeClasses: ["9"], ...g });
  const where = (k) => ["a", "b", "c", "d", "rest", "no_goods"].find((grp) => shape.groups[grp].list.some((l) => l.record_id === row(k).record_id));
  assert.deepEqual(Object.fromEntries(["w1", "w2", "w3", "w4"].map((k) => [k, where(k)])), { w1: "b", w2: "no_goods", w3: "a", w4: "no_goods" },
    "a line whose goods are not established whole was placed among the identical marks for other goods");
});

test("each held record's body says the operation it came from and whether it supplies the goods field", () => {
  assert.deepEqual(recordGoodsProvenance({ goodsServices: [{ classes: [9], language: "en", description: "joysticks" }] }), { operation: "record-text", field: "listed" });
  assert.deepEqual(recordGoodsProvenance({ goodsServices: [{ classes: [9], description: "" }] }), { operation: "record-text", field: "empty" });
  assert.deepEqual(recordGoodsProvenance({ _raw: { classifications: [statement("joysticks", false)] } }), { operation: "retrieve", field: "listed" });
  assert.deepEqual(recordGoodsProvenance({ _raw: { classifications: [] } }), { operation: "retrieve", field: "empty" });
  assert.deepEqual(recordGoodsProvenance({ goodsAndServices: "beverages, namely sparkling water" }), { operation: "bulk-register", field: "listed" });
  assert.deepEqual(recordGoodsProvenance({ goodsAndServices: [{ classNumber: 28, description: "toys" }] }), { operation: "undocumented", field: "listed" });
  assert.deepEqual(recordGoodsProvenance({ statusText: "Registered" }), { operation: "undocumented", field: "none" },
    "a body with no goods field is not one that lists no goods");
  assert.deepEqual(recordGoodsProvenance(null), { operation: "undocumented", field: "none" });
});
