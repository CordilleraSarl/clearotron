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
import { niceClass, recordGoods, bandGoodsIndex, goodsFor, goodsWordCounter, goodsWordMatcher, instructedOrder } from "../record-goods.mjs";

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
  assert.deepEqual(recordGoods(clarivate), [{ classes: ["32"], text: "mineral water", alt: "Mineralwasser" }, { classes: ["33"], text: "wines" }],
    "the English text is shown, and the original is kept beside it for the goods test");
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

test("a goods word is counted whole, and with no words to look for every record's goods are unknown", () => {
  const count = goodsWordCounter(["water", "juice"]);
  assert.equal(count([{ classes: ["32"], text: "water and juice" }]), 2);
  assert.equal(count([{ classes: ["32"], text: "wine" }]), 0);
  assert.equal(goodsWordCounter([])([{ classes: ["32"], text: "water" }]), null, "no goods words: the test cannot be made, so it is not a mismatch");
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

test("the shape reads the order's goods and markets from the run's instructed scope, so a replay from a rebuilt job sorts as the run did", () => {
  const runDir = mkdtempSync(join(tmpdir(), "record-goods-order-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    const P = { instructedScope: driverDir(runDir, "instructed-scope.json") };
    const rebuilt = { markName: "QZORVAK", classes: ["9"] };   // what a job rebuilt from the run's status carries
    assert.deepEqual(instructedOrder(P, rebuilt), rebuilt, "no instructed scope on file: the job as it is");
    writeFileSync(P.instructedScope, JSON.stringify({ goods: "game controllers", jurisdictions: ["CH"], geography: { mode: "named" }, classes: ["9", "28"] }));
    const order = instructedOrder(P, rebuilt);
    assert.equal(order.goods, "game controllers");
    assert.deepEqual(order.jurisdictions, ["CH"]);
    assert.deepEqual(order.geography, { mode: "named" });
    assert.deepEqual(order.classes, ["9"], "the classes stay the job's: only the goods wording and the markets are read from the scope");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a goods word matches its own forms, whole, on the English text and on the original beside it", () => {
  const g = [{ classes: ["10"], text: "medical device for diagnosing", alt: "dispositif médical de diagnostic" }];
  assert.equal(goodsWordCounter(["diagnosing"], { stems: true })(g), 1);
  assert.equal(goodsWordCounter(["diagnos"], { stems: true })(g), 0, "a cut word is the start of longer words, and matches none of them");
  assert.equal(goodsWordCounter(["dispositif"])(g), 1, "the original wording is read beside its translation");
  assert.equal(goodsWordCounter(["agnos"], { stems: true })(g), 0, "a word begins at a word's start");
});

test("a word's forms are its singular and plural, never a longer word, and a word ending in s keeps its spelling", () => {
  const c = (w, t) => goodsWordCounter([w], { stems: true })([{ classes: ["9"], text: t }]);
  for (const [w, t] of [["car", "smart cards"], ["car", "carpets cleaning machines"], ["pen", "pending"], ["tea", "teaching"], ["game", "gaming"]])
    assert.equal(c(w, t), 0, `"${w}" matched "${t}"`);
  for (const [w, t] of [["car", "car navigation apparatus"], ["boxes", "box"], ["box", "boxes"], ["accessories", "accessory"], ["accessory", "accessories"],
    ["apparatus", "apparatus"], ["status", "status"], ["glass", "glasses"], ["glasses", "glass"], ["games consoles", "game console"], ["game consoles", "games consoles"]])
    assert.equal(c(w, t), 1, `"${w}" missed "${t}"`);
});

test("a word given in the plural and its singular match each other as stems", () => {
  const g = (t) => [{ classes: ["9"], text: t }];
  assert.equal(goodsWordCounter(["video games"], { stems: true })(g("a video game for consoles")), 1);
  assert.equal(goodsWordCounter(["video game"], { stems: true })(g("video games")), 1);
  assert.equal(goodsWordCounter(["game consoles"], { stems: true })(g("game console")), 1);
});

test("a class written only in a language the engine cannot read leaves a zero match unknown", async () => {
  const { goodsWordsMatched } = await import("../record-goods.mjs");
  const count = goodsWordCounter(["video game"], { stems: true }), words = goodsWordsMatched(["video game"], { stems: true });
  const mixed = recordGoods({ goodsServices: [{ classes: [9], language: "de", description: "Videospiele" }, { classes: [35], language: "en", description: "retail services" }] });
  assert.deepEqual([count(mixed), words(mixed)], [null, null], "class 9 is German only: the English class 35 cannot say the goods are not the client's");
  const both = recordGoods({ goodsServices: [{ classes: [9], language: "de", description: "Druckerpatronen" }, { classes: [9], language: "en", description: "printer cartridges" }] });
  assert.deepEqual([count(both), words(both)], [0, []], "a class read in English beside its other languages is a known zero");
  const hit = recordGoods({ goodsServices: [{ classes: [9], language: "de", description: "Spielkonsolen" }, { classes: [28], language: "en", description: "video games" }] });
  assert.deepEqual([count(hit), words(hit)], [1, ["video game"]], "a word matched in English is known, whatever else is unread");
});

test("an untagged statement is English only on an English-language register; elsewhere, Canada included, it is unknown", async () => {
  const { bandGoodsIndex, goodsFor, untaggedIsEnglish } = await import("../record-goods.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { driverDir } = await import("../../shared/driver-dir.mjs");
  assert.deepEqual(["/mark/us/1", "/mark/gb/1", "/mark/uk/1", "/mark/ca/1", "/mark/fr/1", "/mark/eu/1"].map(untaggedIsEnglish), [true, true, true, false, false, false]);
  const runDir = mkdtempSync(join(tmpdir(), "untagged-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    const body = (text) => ({ goodsServices: [{ classes: [28], description: text }] });
    writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), [
      { target: "/mark/us/u1", body: body("toys and games") }, { target: "/mark/fr/f1", body: body("jeux et jouets") },
      { target: "/mark/ca/c1", body: body("jouets; toys") }, { target: "/mark/fr/t1", body: { goodsServices: [{ classes: [28], language: "en", description: "toys" }] } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const index = bandGoodsIndex(runDir), toys = goodsWordCounter(["toy"], { stems: true });
    const count = (id) => toys(goodsFor(index, { record_id: id }));
    assert.deepEqual([count("/mark/us/u1"), count("/mark/fr/f1"), count("/mark/ca/c1"), count("/mark/fr/t1")], [1, null, null, 1],
      "untagged: read on the US register; unknown, never a zero, in France and Canada; a tag reads anywhere");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("plurals in -oes and -ves, and a hyphen in a phrase, match their other forms", () => {
  const c = (w, t) => goodsWordCounter([w], { stems: true })([{ classes: ["9"], text: t }]);
  for (const [w, t] of [["tomato", "tomatoes"], ["tomatoes", "tomato"], ["knife", "knives"], ["knives", "knife"], ["shelf", "shelves"], ["shelves", "shelf"],
    ["mobile phone", "mobile-phone"], ["mobile-phone", "mobile phones"]]) assert.equal(c(w, t), 1, `"${w}" missed "${t}"`);
});

test("goods with no English the engine can use are unknown to the goods test, never a mismatch", () => {
  const word = goodsWordCounter(["video game"], { stems: true });
  assert.equal(word(recordGoods({ goodsServices: [{ classes: [9], language: "de", description: "Videospiele; Spielkonsolen" }] })), null, "German only, no translation");
  assert.equal(word(recordGoods({ goodsServices: [{ classes: [9], language: "de", description: "Videospiele", translation: "video games" }] })), 1, "an untagged translation is read");
  assert.equal(word(recordGoods({ _raw: { classifications: [{ nice_class: 9, goods_services_text: "Videospiele", goods_services_language: "de" }] } })), null, "a tagged foreign text is not read as English");
  assert.equal(word(recordGoods({ goodsAndServices: [{ classNumber: 9, description: [{ language: "fr", terms: ["jeux vidéo"] }] }] })), null, "a list with no English entry");
});
