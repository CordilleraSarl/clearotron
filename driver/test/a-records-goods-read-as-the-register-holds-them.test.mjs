// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RECORD'S GOODS READ AS THE REGISTER HOLDS THEM. The report prints a registration's goods in English, or the
// vendor's machine translation marked as one; a reader who wants the original wording asks their assistant, and
// the connector serves it from recordGoodsAsRegistered (2026-11-18). Each statement is the record's own text in
// its own language, with the provider's translation beside it where there is one. One test per shape the goods
// reader knows, on invented records, and a provider's marker for no goods is no statement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordGoodsAsRegistered } from "../record-goods.mjs";

test("a Clarivate statement keeps its original and language, with the machine translation beside it", () => {
  assert.deepEqual(recordGoodsAsRegistered({ goodsServices: [
    { classes: [9], language: "fr", description: "Casques audio; enceintes.", translation_language: "en", translation: "Headphones; loudspeakers." },
    { classes: ["41"], language: "en", description: "Education services." },
  ] }), [
    { classes: ["9"], text: "Casques audio; enceintes.", language: "fr", translation: { text: "Headphones; loudspeakers.", language: "en" } },
    { classes: ["41"], text: "Education services.", language: "en", translation: null },
  ]);
});

test("a Signa classification keeps its own text and language", () => {
  assert.deepEqual(recordGoodsAsRegistered({ _raw: { classifications: [{ nice_class: 9, goods_services_text: "Kopfhörer.", goods_services_language: "de" }] } }),
    [{ classes: ["9"], text: "Kopfhörer.", language: "de", translation: null }]);
});

test("an EUIPO statement held in several languages gives one entry per language; a US statement has no class or language", () => {
  assert.deepEqual(recordGoodsAsRegistered({ goodsAndServices: [{ classNumber: 9, description: [{ language: "es", terms: "Auriculares." }, { language: "en", terms: "Headphones." }] }] }), [
    { classes: ["9"], text: "Auriculares.", language: "es", translation: null },
    { classes: ["9"], text: "Headphones.", language: "en", translation: null },
  ]);
  assert.deepEqual(recordGoodsAsRegistered({ goodsAndServices: "Headphones; loudspeakers." }),
    [{ classes: [], text: "Headphones; loudspeakers.", language: null, translation: null }]);
});

test("a provider's marker for no goods is no statement, and a translation that is one is no translation", () => {
  assert.deepEqual(recordGoodsAsRegistered({ goodsServices: [{ classes: [9], language: "en", description: "No goods available" }] }), []);
  assert.deepEqual(recordGoodsAsRegistered({ goodsServices: [{ classes: [9], language: "el", description: "Ακουστικά.", translation_language: "el", translation: "No greek supported" }] }),
    [{ classes: ["9"], text: "Ακουστικά.", language: "el", translation: null }]);
  assert.deepEqual(recordGoodsAsRegistered(null), []);
});
