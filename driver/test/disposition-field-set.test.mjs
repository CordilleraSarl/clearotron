// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// M2, FINISHED — A CONTRACT IS ITS FIELD SET, NOT ONLY ITS SENTENCES.
//
// R5 (2026-08-14) found the half E12 structurally cannot see. Every dictated SENTENCE agreed after M1 and
// M2: the dispatch, the doctrine and the corrective hints all ordered `receipt_index` and `anchor`. The
// FORM did not — `connotationObligations()` emitted `quote: null` and NO `anchor` key and no
// `receipt_index` key at all. A seat was told to set two fields, opened the file, and found neither slot,
// beside a slot for a third field the same instruction tells it not to write.
//
// It fails exactly like a diverging sentence: silently, as a seat "failing" at something it was never
// coherently asked. E12 reconciles what the code SAYS. This reconciles what the code EMITS, and it binds
// three things to one declared list so no two of them can drift:
//
//     MEANING_SEAT_FIELDS   the declaration
//     the emitted row       every obligation row carries a slot per field
//     the instruction       the composer names every field, and no retired one

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MEANING_SEAT_FIELDS, connotationObligations, obligationRows, meaningSweepReceiptsInstruction,
} from "../connotation-search.mjs";

const RECEIPTS = [
  { query: "veltrin meaning", results: [
    { id: "R-AAAAAAAA", title: "Veltrin — the dolphin", url: "https://example.invalid/a",
      snippet: "A long enough passage of captured text to be usable for a spot check on this row." },
    { id: "R-BBBBBBBB", title: "Delphi oracle", url: "https://example.invalid/b",
      snippet: "Another passage, also long enough to count as a usable snippet for the same purposes." }] },
];

const rows = () => obligationRows(connotationObligations(RECEIPTS));

test("EVERY ORDERED FIELD HAS A SLOT — the defect R5 surfaced, stated as a property", () => {
  const emitted = rows();
  assert.ok(emitted.length > 0, "the fixture must produce obligations, or this test asserts nothing");
  for (const row of emitted)
    for (const f of MEANING_SEAT_FIELDS)
      assert.ok(f in row, `the seat is ordered to set \`${f}\` and the row it opens has no such key`);
});

test("…and the instruction names every one of them", () => {
  const text = meaningSweepReceiptsInstruction("/run/form.json");
  for (const f of MEANING_SEAT_FIELDS)
    assert.ok(text.includes(f), `\`${f}\` is a seat field with no slot named in the dispatch that orders it`);
});

test("THE RETIRED FIELDS ARE NOT ORDERED — M1 and M2 moved these, and the instruction must not ask again", () => {
  const text = meaningSweepReceiptsInstruction("/run/form.json");
  // `receipt_id` may be MENTIONED — a sole-candidate row carries one the seat must leave alone — but it
  // is not a seat field, so it must not be in the declared list. The distinction is the whole of M1.
  assert.ok(!MEANING_SEAT_FIELDS.includes("receipt_id"));
  assert.ok(!MEANING_SEAT_FIELDS.includes("quote"));
  assert.match(text, /receipt_index/, "the position contract is what the instruction orders");
  // — `anchor` JOINS the retired list. The instruction ordered ONE string doing two jobs: locating
  // an extraction span by exact match, and proving the passage was read. The locator duty is what made it
  // unsatisfiable on non-Latin text, so the order is now `segment_index` (the locator, machine-checked and
  // always satisfiable) and `fragment` (the proof, containment only).
  assert.ok(!MEANING_SEAT_FIELDS.includes("anchor"));
  assert.match(text, /segment_index/, "the pointer contract is ordered");
  assert.match(text, /fragment/, "and the proof contract, separately — a seat told one word supplies one field");
  assert.doesNotMatch(text, /`anchor`/,
    "the retired order must be DELETED, not left beside its replacement: a dictation is a code path, and an order that cannot be satisfied sitting next to one that can is the flag disease in prose");
});

test("`quote` keeps its slot and is NOT a seat field — the driver fills it", () => {
  // Not a nicety: the driver extracts the passage into `quote`, and an archived form's own verbatim quote
  // still discharges the spot check. Removing the slot would break the replay path; declaring it a seat
  // field would re-order the transcription task M2 deleted and finished.
  for (const row of rows()) assert.ok("quote" in row);
  assert.ok(!MEANING_SEAT_FIELDS.includes("quote"));
});
