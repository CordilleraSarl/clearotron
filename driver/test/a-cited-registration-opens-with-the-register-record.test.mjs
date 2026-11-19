// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CITED REGISTRATION OPENS WITH THE REGISTER'S OWN RECORD. The reviewing lawyer checks every cited mark
// against the register by hand before reading the analysis; the report now carries the register's facts for
// each one, copied from the record the run saved: the mark and its type, the goods by class, the owner and
// the owner's country, the country, the status with its dates, and the register number. These tests hold the
// rows publish/register-record.mjs builds, one state the record can take at a time, on invented records.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registerRecordView, logoWanted, countryOf, RECORD_LABELS, MT_NOTE, NO_GOODS, CLASS_NOT_STATED, registrationsCount,
} from "../publish/register-record.mjs";

const RECEIPT = "verified — Clarivate Compumark record fetched 2026-10-14";
const TERMS = Array.from({ length: 46 }, (_, i) => `invented audio item ${i + 1}`);

/** An invented record in the shape the run saves a Clarivate record. */
const record = (over = {}) => ({
  uri: "/mark/em/018046213", provider: "clarivate", office: "em",
  applicationNumber: "018046213", registrationNumber: "018046213",
  applicationDate: "2019-03-14", registrationDate: "2019-08-02", expiryDate: "2029-03-14",
  statusClass: "live", statusText: "REGISTERED",
  markText: "SKARVEL", markFeature: "WORD AND DESIGN", imageAvailable: true,
  owner: "Brisavel Acoustics, S.L.", ownerCountry: "ES",
  goodsServices: [{ classes: ["9"], language: "en", description: TERMS.join("; ") }],
  ...over,
});
const rowOf = (view, label) => view.rows.find((r) => r.label === label);

test("the rows come in the board's order, each fact copied from the record", () => {
  const v = registerRecordView(record(), { receipt: RECEIPT });
  assert.deepEqual(v.rows.map((r) => r.label), ["Mark", "Goods and services", "Owner", "Country", "Status", "Register number"]);
  assert.deepEqual(rowOf(v, "Mark"), { label: "Mark", value: "SKARVEL", faint: "Word and design" });
  assert.deepEqual(rowOf(v, "Owner"), { label: "Owner", value: "Brisavel Acoustics, S.L.", faint: "(Spain)" });
  assert.deepEqual(rowOf(v, "Country"), { label: "Country", value: "European Union" });
  assert.deepEqual(rowOf(v, "Status"), { label: "Status", value: "Registered", faint: "filed 2019-03-14 · registered 2019-08-02 · expires 2029-03-14" });
  const number = rowOf(v, "Register number");
  assert.equal(number.receipt, RECEIPT, "the receipt keeps its delivered wording under the number");
  assert.ok(!("faint" in number), "an application number equal to the registration number is not repeated");
});

test("a long specification is cut at a term boundary, with the count of all its terms", () => {
  const [entry] = rowOf(registerRecordView(record()), "Goods and services").entries;
  assert.equal(entry.class, "Class 9");
  assert.equal(entry.showAll, "Show all 46 terms");
  assert.ok(entry.text.startsWith(entry.preview), "the preview is not the start of the whole text");
  assert.ok(TERMS.includes(entry.preview.split("; ").at(-1)), "the preview ends inside a term");
  assert.equal(entry.text, TERMS.join("; "), "the whole text is the record's, unchanged");
});

test("a machine translation is marked, names the language, and says where the original is", () => {
  const v = registerRecordView(record({
    office: "fr", uri: "/mark/fr/4612907", applicationNumber: "4589311", registrationNumber: "4612907",
    goodsServices: [{ classes: ["9"], language: "fr", description: "Casques audio; enceintes.", translation_language: "en", translation: "Headphones; loudspeakers." }],
  }));
  const goods = rowOf(v, "Goods and services");
  assert.deepEqual(goods.marker, { tag: "Machine translation from French", note: MT_NOTE });
  assert.equal(goods.entries[0].text, "Headphones; loudspeakers.");
  assert.equal(rowOf(v, "Register number").faint, "application 4589311", "an application number that differs follows the register number");
});

test("a record with no English shows the original as registered, and says so", () => {
  const v = registerRecordView(record({ office: "ru", uri: "/mark/ru/700001", goodsServices: [{ classes: ["9"], language: "ru", description: "Наушники; громкоговорители." }] }));
  const goods = rowOf(v, "Goods and services");
  assert.equal(goods.note, "In Russian, as registered. No English translation on the record.");
  assert.equal(goods.entries[0].text, "Наушники; громкоговорители.");
  assert.ok(!goods.marker, "an original is not marked as a translation");
});

test("a record that states no goods says so, and a statement with no class says that", () => {
  assert.equal(rowOf(registerRecordView(record({ goodsServices: [] })), "Goods and services").note, NO_GOODS);
  const unclassed = rowOf(registerRecordView(record({ goodsServices: [{ classes: [], language: "en", description: "Headphones." }] })), "Goods and services");
  assert.equal(unclassed.entries[0].class, CLASS_NOT_STATED);
});

test("a logo is wanted only where the record marks the mark figurative and says an image exists", () => {
  assert.equal(logoWanted(record()), true);
  assert.equal(logoWanted(record({ markFeature: "WORD ONLY" })), false, "a word mark's image is only the word");
  assert.equal(logoWanted(record({ imageAvailable: false })), false);
  const v = registerRecordView(record());
  assert.deepEqual(v.logo, { wanted: true, caption: "EU", alt: "SKARVEL, logo as registered in European Union", href: v.logo.href },
    "an EUIPO record (office em) is captioned EU, as the board draws it");
  assert.equal(registerRecordView(record({ office: "wo", uri: "/mark/wo/1500001" })).logo.caption, "WIPO");
  assert.equal(registerRecordView(record({ office: "us", uri: "/mark/us/90000001" })).logo.caption, "US");
});

test("the labels are the approved words", () => {
  assert.deepEqual(RECORD_LABELS, { title: "Register record", mark: "Mark", goods: "Goods and services", owner: "Owner", country: "Country", status: "Status", number: "Register number" });
  assert.equal(MT_NOTE, "For the original wording, open the register number or use Ask AI.");
  assert.equal(NO_GOODS, "The record states no goods or services.");
  assert.equal(CLASS_NOT_STATED, "Class not stated");
  assert.equal(registrationsCount(2), "2 registrations");
  assert.equal(countryOf("wo"), "WIPO (Madrid)", "WO reads as every other report surface names it");
  assert.equal(countryOf("us"), "United States");
  assert.equal(countryOf("em"), "European Union");
  assert.equal(countryOf("ar"), "Argentina", "a country the naming table does not list still reads as a name");
});
