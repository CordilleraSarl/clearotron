// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A BAND RECORD'S GOODS ARE READ FROM THE OFFICIAL RECORDS THE RUN ALREADY HOLDS, NEVER FETCHED.
//
// The placement step reads identical marks for the client's particular goods first, and the band row carries
// no goods. Every provider's saved record does, in its own shape: these arms pin each shape, the index the
// run's ledger and `_records/` give, the word test with unknown goods passing, and the excerpt a reader is
// shown. All text is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { niceClass, recordGoods, bandGoodsIndex, goodsFor, goodsWordMatcher, goodsExcerpt } from "../record-goods.mjs";

test("a class is compared as a number: 09, 9 and ' 9 ' are one class, and nothing else is a class", () => {
  assert.equal(niceClass("09"), "9");
  assert.equal(niceClass(9), "9");
  assert.equal(niceClass(" 9 "), "9");
  assert.equal(niceClass("46"), "");
  assert.equal(niceClass("x"), "");
});

test("each provider's goods shape is read, English first where a statement offers it", () => {
  const clarivate = { goodsServices: [
    { classes: [32], language: "de", description: "Mineralwasser", translation_language: "en", translation: "mineral water" },
    { classes: [33], language: "en", description: "wines" },
  ] };
  assert.deepEqual(recordGoods(clarivate), [{ classes: ["32"], text: "mineral water" }, { classes: ["33"], text: "wines" }]);
  const signa = { markText: "QZXV", _raw: { classifications: [{ nice_class: 9, goods_services_text: "game controllers", goods_services_language: "en" }] } };
  assert.deepEqual(recordGoods(signa), [{ classes: ["9"], text: "game controllers" }]);
  const euipo = { goodsAndServices: [{ classNumber: 28, description: [{ language: "fr", terms: ["jouets"] }, { language: "en", terms: ["toys", "games"] }] }] };
  assert.deepEqual(recordGoods(euipo), [{ classes: ["28"], text: "toys; games" }]);
  const usptoLocal = { goodsAndServices: "beverages, namely sparkling water" };
  assert.deepEqual(recordGoods(usptoLocal), [{ classes: [], text: "beverages, namely sparkling water" }]);
  assert.deepEqual(recordGoods([{ goodsAndServices: [{ niceClass: "09", text: "software" }] }]), [{ classes: ["9"], text: "software" }], "a body that is an array is read from its first element");
  assert.deepEqual(recordGoods({ markText: "QZXV" }), [], "a body with no goods gives none");
  assert.deepEqual(recordGoods(null), []);
});

test("the index reads the record ledger and _records, a record's later copy winning, and a band row finds its goods by uri", () => {
  const runDir = mkdtempSync(join(tmpdir(), "record-goods-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    mkdirSync(join(runDir, "_records"), { recursive: true });
    const row = (target, text) => JSON.stringify({ ts: "2026-10-12T00:00:00Z", provider: "x", target, body: { goodsServices: [{ classes: [32], language: "en", description: text }] } });
    writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), [row("/mark/eu/qzxv1", "mineral water"), "not json", row("/mark/eu/qzxv2", "energy drinks")].join("\n") + "\n");
    writeFileSync(join(runDir, "_records", "eu-qzxv2.json"), JSON.stringify({ _uri: "/mark/eu/qzxv2", goodsServices: [{ classes: [32], language: "en", description: "sports drinks" }] }));
    const index = bandGoodsIndex(runDir);
    assert.equal(index.size, 2);
    assert.equal(goodsFor(index, { record_id: "/mark/EU/qzxv1" })[0].text, "mineral water");
    assert.equal(goodsFor(index, { record_id: "/mark/eu/qzxv2" })[0].text, "sports drinks", "the _records copy, read later, wins");
    assert.equal(goodsFor(index, { record_id: "/mark/eu/qzxv9" }), null, "a record with no body on file has no goods");
    assert.equal(bandGoodsIndex(join(runDir, "absent")).size, 0, "a run with neither file gives an empty index, not an error");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a goods word matches whole, folding case and accents, and unknown goods answer null rather than false", () => {
  const m = goodsWordMatcher(["water", "Energy drinks", "café"]);
  assert.equal(m([{ classes: ["32"], text: "Mineral WATER and juices" }]), true);
  assert.equal(m([{ classes: ["32"], text: "watering cans" }]), false, "a word inside another word does not match");
  assert.equal(m([{ classes: ["32"], text: "energy\n drinks" }]), true, "a phrase matches across spacing");
  assert.equal(m([{ classes: ["30"], text: "Cafe and tea" }]), true, "accents are folded");
  assert.equal(m(null), null, "no goods on file is unknown");
  assert.equal(m([]), null);
});

test("the excerpt shows the ordered classes' goods first, cut at its size, with the full length beside it", () => {
  const goods = [{ classes: ["25"], text: "clothing" }, { classes: ["32"], text: "mineral water and juices" }, { classes: [], text: "unclassed" }];
  assert.deepEqual(goodsExcerpt(goods, { inScopeClasses: ["32"], maxChars: 400 }), { text: "[32] mineral water and juices | unclassed | [25] clothing", chars: 57 });
  const cut = goodsExcerpt(goods, { inScopeClasses: ["32"], maxChars: 10 });
  assert.equal(cut.text, "[32] miner");
  assert.equal(cut.chars, 57);
  assert.equal(goodsExcerpt(null), null);
  assert.equal(goodsExcerpt(goods, { inScopeClasses: [] }).text.startsWith("[25] clothing"), true, "with no scope every statement is in scope, in its own order");
});
