// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REGISTER'S WORDS FOR NO GOODS ARE NOT GOODS.
//
// A record can carry a statement whose whole text says there is none. Read as goods, it made a record with nothing listed read
// as complete, and its words were tested against the client's. Each goods reader goes through the one rule here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordGoods, recordGoodsProvenance, saysNoGoods } from "../record-goods.mjs";
import { recordGoodsEvidence, goodsFromLabel } from "../goods-evidence.mjs";

const statement = (description, extra = {}) => ({ classes: [9], language: "en", description, ...extra });
const body = (...goodsServices) => ({ goodsServices });

test("the phrases, as the whole of a statement only", () => {
  for (const t of ["No goods available", "no goods available", "No goods available.", "- no goods available", "No greek supported", "No bulgarian supported", "no list.", "Not listed", "not specified", "-", "", "  "]) assert.equal(saysNoGoods(t), true, JSON.stringify(t));
  for (const t of ["computer software", "No goods available in class 9 but software in class 42", "not specified goods for retail", "No-iron shirts", "no list of goods; shirts"]) assert.equal(saysNoGoods(t), false, t);
});

test("a statement that says so is no statement, and the real ones beside it stand", () => {
  assert.deepEqual(recordGoods(body(statement("No goods available"))), []);
  assert.deepEqual(recordGoods(body(statement("computer software"), statement("No greek supported", { language: "el" }), statement("No bulgarian supported", { language: "bg" }))),
    [{ classes: ["9"], text: "computer software" }]);
});

test("a translation that says so gives way to its original, and an original that says so does not ride beside a translation", () => {
  assert.deepEqual(recordGoods(body({ classes: [9], language: "de", description: "Software", translation: "No goods available", translation_language: "en" })),
    [{ classes: ["9"], text: "Software", en: false }]);
  assert.deepEqual(recordGoods(body({ classes: [9], language: "de", description: "No german supported", translation: "software", translation_language: "en" })),
    [{ classes: ["9"], text: "software" }]);
});

test("the other registers' shapes read the same", () => {
  assert.deepEqual(recordGoods({ _raw: { classifications: [{ nice_class: 9, goods_services_text: "No goods available", goods_services_language: "en", goods_services_text_truncated: false }] } }), []);
  assert.deepEqual(recordGoods({ goodsAndServices: "No goods available" }), []);
  assert.deepEqual(recordGoods({ goodsAndServices: [{ classNumber: 9, description: "not specified" }] }), []);
});

test("a record whose only statement says so reads as listing none, not as complete, and never as a statement that missed the client's words", () => {
  const b = body(statement("No goods available"));
  assert.deepEqual(recordGoodsProvenance(b), { operation: "record-text", field: "empty" });
  const id = "/mark/us/invented1";
  const held = new Map([[id, { via: ["register-record-bodies"], provider: "clarivate", session: null, ts: null, goods: recordGoodsProvenance(b) }]]);
  const row = recordGoodsEvidence({ record_id: id }, { goods: { of: () => recordGoods(b), held: () => false }, held, fetches: null });
  assert.deepEqual([row.state, row.basis, goodsFromLabel(row)], ["absent", "full-record-without-goods", "official record, no goods listed"]);
  assert.deepEqual(recordGoodsProvenance(body(statement("computer software"), statement("No greek supported", { language: "el" }))), { operation: "record-text", field: "listed" });
  assert.deepEqual(recordGoodsProvenance({ goodsAndServices: "No goods available" }), { operation: "bulk-register", field: "empty" });
});
