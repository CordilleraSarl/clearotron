// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE NATIVE-LANGUAGE READER IS TOLD WHAT EACH RECORD'S GOODS REST ON, AND WHERE IT IS SHOWN LESS THAN ALL OF THEM.
//
// It was given the first 300 characters of a held record's goods, labelled simply "goods", and a record whose goods
// only its search row carried read as "no goods text held". Now, through the reader's own input:
//   · a record's goods are its held body's, else its search row's, each labelled in the words the band lookup serves;
//   · a cut the reader makes says how much it shows of how much, each class none of whose wording appears, each class
//     whose further wording does not, and which version of a translated statement it shortened or left out, apart
//     from any cut the register made, and both are said where both apply;
//   · a statement given with a translation shows the original first and the translation beside it, labelled;
//   · an empty held body, a body with no goods field and nothing held stay three different things;
//   · the reader is told that missing goods establish nothing.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chineseRegisterRecords, buildNativereadPayload, NATIVEREAD_GOODS_CHARS } from "../jx-units.mjs";
import { buildNativereadRequest } from "../../providers/jx/src/nativeread.js";

const GOODS = "invented wooden toys";
const LONG = "invented software for arranging toy shelves ".repeat(9).trim();   // over the reader's cut
const AT_REGISTER_CUT = "x".repeat(280);                                       // the register's default answer length

// One run holding one Chinese record per case: its band row, and where the case holds one, its official record.
function caseRun(cases) {
  const dir = mkdtempSync(join(tmpdir(), "nativeread-goods-"));
  mkdirSync(join(dir, "register-units"), { recursive: true });
  mkdirSync(join(dir, "_records"), { recursive: true });
  const rows = [];
  for (const [n, { row = {}, body = null }] of Object.entries(cases)) {
    rows.push({ record_id: `/mark/cn/${n}`, mark_text: `INVENTED ${n}`, owner_name: "Invented Owner Co", status: "Registered", classes: [9], ...row });
    if (body) writeFileSync(join(dir, "_records", `cn-${n}.json`), JSON.stringify({ _uri: `/mark/cn/${n}`, ...body }));
  }
  writeFileSync(join(dir, "register-units", "transliteration-numeric-band.json"), JSON.stringify([{ state: "enumerated", records: rows }]));
  return dir;
}
const lineOf = (payload, n) => payload.split("\n").find((l) => l.startsWith(`- /mark/cn/${n} |`)) ?? "";
const classified = (text, extra = {}) => ({ nice_class: 9, goods_services_text: text, ...extra });

test("goods are the held record's, else the search row's, each said with what it rests on and how complete it is", () => {
  const dir = caseRun({
    10: { body: { goodsServices: [{ classes: [9], description: GOODS, language: "zh" }] } },
    20: { row: { raw: { classifications: [classified(GOODS)] } } },
    30: { row: { raw: { classifications: [classified("invented wooden to", { goods_services_text_truncated: true })] } } },
    40: { row: { raw: { classifications: [classified(AT_REGISTER_CUT)] } } },
    50: { row: { goods_whole: true, raw: { classifications: [classified(AT_REGISTER_CUT)] } } },
    60: { row: { raw: { classifications: [classified(GOODS)] }, goods_set_aside: { classes: [12] } } },
  });
  try {
    const { payload } = buildNativereadPayload({ registerRecords: chineseRegisterRecords(dir) });
    assert.match(lineOf(payload, 10), /\| goods \(official record\): class 9: invented wooden toys$/);
    assert.match(lineOf(payload, 20), /\| goods \(search answer\): class 9: invented wooden toys$/, "a row's own goods read as none held");
    assert.match(lineOf(payload, 30), /\| goods \(search answer, cut by the register\): class 9: invented wooden to$/);
    assert.match(lineOf(payload, 40), /\| goods \(search answer, completeness not established\): class 9: x{280}$/);
    assert.match(lineOf(payload, 50), /\| goods \(search answer\): class 9: x{280}$/, "a row asked for whole read as uncertain");
    assert.match(lineOf(payload, 60), /\| goods \(search answer; the goods text of class 12 is set aside, outside the order's classes\): class 9: invented wooden toys$/);
    assert.doesNotMatch(payload, /class 12:/, "a set-aside class was shown as an empty statement");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the reader's own cut says how much it shows of how much and which classes it left out, beside the register's cut", () => {
  const dir = caseRun({
    10: { body: { goodsServices: [{ classes: [9], description: LONG, language: "zh" }, { classes: [42], description: GOODS, language: "zh" }] } },
    20: { row: { raw: { classifications: [classified(LONG, { goods_services_text_truncated: true })] } } },
  });
  try {
    const { payload } = buildNativereadPayload({ registerRecords: chineseRegisterRecords(dir) });
    const whole = [...`class 9: ${LONG}; class 42: ${GOODS}`].length;
    const held = lineOf(payload, 10);
    assert.ok(held.includes(`goods (official record; first ${NATIVEREAD_GOODS_CHARS} of ${whole} characters shown; the text of class 42 is not shown): class 9: invented software`), held);
    assert.equal(held.split("): ").pop().length, NATIVEREAD_GOODS_CHARS);
    assert.ok(lineOf(payload, 20).includes(`goods (search answer, cut by the register; first ${NATIVEREAD_GOODS_CHARS} of ${[...`class 9: ${LONG}`].length} characters shown): `),
      "the register's cut and the reader's were not both said");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an empty held record, one with no goods field and nothing held stay three different things", () => {
  const dir = caseRun({
    10: { body: { markText: "INVENTED 10", goodsServices: [] } },
    20: { body: { markText: "INVENTED 20" } },
    30: {},
  });
  try {
    const { payload } = buildNativereadPayload({ registerRecords: chineseRegisterRecords(dir) });
    assert.match(lineOf(payload, 10), /\| goods: official record, no goods listed$/);
    assert.match(lineOf(payload, 20), /\| goods: official record, completeness not established$/);
    assert.match(lineOf(payload, 30), /\| goods: nothing held$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the reader is told that goods carry their source and that missing goods establish nothing", () => {
  const prompt = buildNativereadRequest({ mark: "QZORVEL", payload: "## Chinese register records supplied (1 of 1)" }).messages[0].content;
  assert.match(prompt, /^Each goods entry identifies its source and states how much wording is shown\.$/m);
  assert.match(prompt, /^Missing goods do not establish that the goods are unrelated\.$/m);
});

const ORIGINAL = "发明的木制玩具";   // invented wording, the original of GOODS

test("a translated statement shows its original first and the translation beside it, and an untranslated one once", () => {
  const dir = caseRun({
    10: { body: { goodsServices: [{ classes: [9], description: ORIGINAL, language: "zh", translation: GOODS, translation_language: "en" }] } },
    20: { body: { goodsServices: [{ classes: [9], description: ORIGINAL, language: "zh" }] } },
  });
  try {
    const { payload } = buildNativereadPayload({ registerRecords: chineseRegisterRecords(dir) });
    assert.match(lineOf(payload, 10), new RegExp(`\\| goods \\(official record\\): class 9: ${ORIGINAL} \\(translation: ${GOODS}\\)$`));
    assert.match(lineOf(payload, 20), new RegExp(`\\| goods \\(official record\\): class 9: ${ORIGINAL}$`), "an original with no translation was not kept once");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("past the cut, a class with some wording shown says its further wording is not shown, and a translated statement says which version", () => {
  const dir = caseRun({
    10: { body: { goodsServices: [{ classes: [9], description: LONG, language: "zh" }, { classes: [9], description: GOODS, language: "zh" }] } },
    20: { body: { goodsServices: [{ classes: [9], description: ORIGINAL, language: "zh", translation: LONG, translation_language: "en" }] } },
    30: { body: { goodsServices: [{ classes: [9], description: LONG, language: "zh", translation: GOODS, translation_language: "en" }] } },
    40: { body: { goodsServices: [{ classes: [9], description: "x".repeat(NATIVEREAD_GOODS_CHARS - "class 9: ".length - 3), language: "zh", translation: GOODS, translation_language: "en" }] } },
    // The translation's last word ends at the cut, and only the closing bracket falls past it.
    50: { body: { goodsServices: [{ classes: [9], description: "x".repeat(50), language: "zh",
      translation: "y".repeat(NATIVEREAD_GOODS_CHARS - "class 9: ".length - 50 - " (translation: ".length), translation_language: "en" }] } },
  });
  try {
    const { payload } = buildNativereadPayload({ registerRecords: chineseRegisterRecords(dir) });
    assert.match(lineOf(payload, 10), /characters shown; further wording for class 9 is not shown\): /);
    assert.doesNotMatch(lineOf(payload, 10), /the text of class 9 is not shown/, "a class whose wording appeared was said to be left out whole");
    assert.match(lineOf(payload, 20), /characters shown; the translation for class 9 is shortened\): /);
    assert.match(lineOf(payload, 30), /characters shown; the original wording for class 9 is shortened, and its translation is not shown\): /);
    assert.match(lineOf(payload, 40), /characters shown; the translation for class 9 is not shown\): /);
    assert.ok(lineOf(payload, 50).includes(`goods (official record; first ${NATIVEREAD_GOODS_CHARS} of ${NATIVEREAD_GOODS_CHARS + 1} characters shown): `),
      `a translation shown whole was said to be shortened: ${lineOf(payload, 50)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
