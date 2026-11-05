// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PROVIDER'S WORDS FOR NO GOODS ARE NOT GOODS.
//
// A record can carry a statement whose whole text is a provider's marker. Read as goods, it made a record with nothing listed
// read as complete, and its words were tested against the client's as a statement that missed them. The rule describes the
// provider's boilerplate: whole statements, tied to the language slot where the marker names a language. It does not decide
// what counts as plausible goods, and the record itself stays as it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordGoods, recordGoodsProvenance, isNoGoodsMarker, goodsWordsMatched } from "../record-goods.mjs";
import { recordGoodsEvidence, goodsFromLabel } from "../goods-evidence.mjs";

const statement = (description, extra = {}) => ({ classes: [9], language: "en", description, ...extra });
const body = (...goodsServices) => ({ goodsServices });

test("the markers: whole statements, and a language's marker only on that language's slot", () => {
  for (const [t, lang] of [["No goods available"], ["no goods available"], ["No goods available."], ["- no goods available"], ["No goods available", "zh"],
    ["No greek supported", "el"], ["No bulgarian supported", "bg"], ["no greek supported.", "EL"]]) assert.equal(isNoGoodsMarker(t, lang), true, `${t} on ${lang}`);
  for (const [t, lang] of [["No greek supported", "pt"], ["No greek supported"], ["No bulgarian supported", "el"], ["No french supported", "fr"],
    ["No goods available in class 9 but software in class 42"], ["No-iron shirts"], ["no list"], ["not listed"], ["not specified"], ["-"], [""], ["computer software"]]) assert.equal(isNoGoodsMarker(t, lang), false, `${t} on ${lang}`);
});

test("a marker is no statement, and the real statements beside it stand", () => {
  assert.deepEqual(recordGoods(body(statement("No goods available"))), []);
  assert.deepEqual(recordGoods(body(statement("computer software"), statement("No greek supported", { language: "el" }), statement("No bulgarian supported", { language: "bg" }))),
    [{ classes: ["9"], text: "computer software" }]);
  // Words that only resemble a marker are a statement, and stay one.
  assert.deepEqual(recordGoods(body(statement("No goods available in class 9 but software in class 42"))), [{ classes: ["9"], text: "No goods available in class 9 but software in class 42" }]);
  assert.deepEqual(recordGoods(body(statement("No greek supported", { language: "pt" }))), [{ classes: ["9"], text: "No greek supported", en: false }]);
});

test("a translation that is a marker gives way to the held original, and says what language it is in", () => {
  assert.deepEqual(recordGoods(body({ classes: [9], language: "de", description: "Software", translation: "No goods available", translation_language: "en" })),
    [{ classes: ["9"], text: "Software", en: false, language: "de" }]);
  assert.deepEqual(recordGoods(body({ classes: [9], language: "ru", description: "No goods available", translation: "No goods available", translation_language: "en" })), []);
  // A real translation of a marked original is the statement, and the marker does not ride beside it.
  assert.deepEqual(recordGoods(body({ classes: [9], language: "el", description: "No greek supported", translation: "software", translation_language: "en" })),
    [{ classes: ["9"], text: "software" }]);
});

test("the other registers' shapes read the same", () => {
  assert.deepEqual(recordGoods({ _raw: { classifications: [{ nice_class: 9, goods_services_text: "No goods available", goods_services_language: "en", goods_services_text_truncated: false }] } }), []);
  assert.deepEqual(recordGoods({ goodsAndServices: "No goods available" }), []);
  assert.deepEqual(recordGoods({ goodsAndServices: [{ classNumber: 9, description: "No goods available" }] }), []);
});

test("a record holding only a marker lists no goods, through the existing states, and is never read as unrelated", () => {
  const b = body(statement("No goods available"));
  assert.deepEqual(recordGoodsProvenance(b), { operation: "record-text", field: "empty" });
  const id = "/mark/us/invented1";
  const held = new Map([[id, { via: ["register-record-bodies"], provider: "clarivate", session: null, ts: null, goods: recordGoodsProvenance(b) }]]);
  const row = recordGoodsEvidence({ record_id: id }, { goods: { of: () => recordGoods(b), held: () => false }, held, fetches: null });
  assert.deepEqual([row.state, row.basis, goodsFromLabel(row)], ["absent", "full-record-without-goods", "official record, no goods listed"]);
  assert.deepEqual(recordGoodsProvenance(body(statement("computer software"), statement("No greek supported", { language: "el" }))), { operation: "record-text", field: "listed" });
  assert.deepEqual(recordGoodsProvenance(body(statement("No greek supported", { language: "el" }))), { operation: "record-text", field: "empty" });
  assert.deepEqual(recordGoodsProvenance({ goodsAndServices: "No goods available" }), { operation: "bulk-register", field: "empty" });

  // THE GOODS TEST, the full engine's consumer. A record with no statements is unknown to it, never a miss, and the marker's
  // own words can no longer read as a statement that missed the client's, or as one that met them.
  const test_ = goodsWordsMatched(["software", "goods"], { stems: true });
  assert.equal(test_(recordGoods(b)), null, "no statements: the goods test must say unknown");
  assert.deepEqual(test_(recordGoods(body(statement("computer software")))), ["software"], "genuine wording is still tested");
  assert.equal(test_(recordGoods(body({ classes: [9], language: "de", description: "Software", translation: "No goods available", translation_language: "en" }))), null, "wording the engine cannot read in English stays unknown");
});
