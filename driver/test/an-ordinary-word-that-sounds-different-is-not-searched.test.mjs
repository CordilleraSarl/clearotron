// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-ordinary-word-that-sounds-different-is-not-searched.test.mjs — the one-letter neighbourhood drops a
// neighbour only when it is an ordinary word AND sounds different from the element.
//
// THE DEFECT. edit-1 over a short ordinary word is mostly other ordinary words. On a delivered four-letter
// run, 1,037 of 2,098 register records (49%) were reached only by the one-letter lists — ordinary words one
// letter from the element, each a common mark with its own crowd, and each a word the reviewing lawyer would
// not read, because conceptually different words are not confused. A respelling that sounds the same (KANE
// beside CANE) is exactly what a search must find, and so is every neighbour of a made-up word (MALENA beside
// VALENA).
//
// These arms run against the SHIPPED word list, not a fixture, because the list is the rule's data: a list
// that happened to carry "kane" would silently stop a search the lawyer requires.
//
// Run:  node --test driver/test/an-ordinary-word-that-sounds-different-is-not-searched.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { editNeighbourhood, formNeighbourhood, ordinaryWordDifferentSound, variantFloorFamilies, mergeVariantFloor }
  from "../form-neighbourhood.mjs";
import { loadOrdinaryWords, parseWordList } from "../ordinary-words.mjs";

const { words: WORDS, error } = loadOrdinaryWords("en");

test("the shipped list loads, carries ordinary words, and skips its own header", () => {
  assert.equal(error, null);
  assert.ok(WORDS.size > 50000, `expected the full list, loaded ${WORDS.size}`);
  for (const w of ["bane", "cage", "cake", "came", "cone", "see", "sea"]) assert.ok(WORDS.has(w), `${w} is an ordinary word`);
  for (const w of ["kane", "cnae", "canne", "caan", "malena", "velena"]) assert.ok(!WORDS.has(w), `${w} is not in the list`);
  assert.ok(![...WORDS].some((w) => w.startsWith("#")), "header lines are not words");
});

test("CANE: different-sounding ordinary words are dropped; same-sounding respellings are kept", () => {
  const dropped = new Set(ordinaryWordDifferentSound("CANE", WORDS));
  for (const w of ["bane", "cage", "cake", "came"]) assert.ok(dropped.has(w), `${w} is an ordinary word that sounds different — not searched`);
  const band = formNeighbourhood("CANE", { ordinaryWords: WORDS });
  for (const w of ["kane", "cnae", "canne"]) assert.ok(band.exactQueries.includes(w), `${w} is searched`);
  // CAAN is two edits from CANE, so edit-1 never generates it; the rule cannot drop what was never there.
  assert.ok(!editNeighbourhood("CANE").includes("caan") && !dropped.has("caan"));
});

test("CONE and CAN share CANE's Double-Metaphone key, so the rule as specified KEEPS them", () => {
  // Double Metaphone keeps a vowel only at the start of the word, so a vowel change inside it, or the silent
  // final E dropped, does not move the key. Pinned so that making these two drop is a decision about the key,
  // not a quiet edit to the list.
  const band = formNeighbourhood("CANE", { ordinaryWords: WORDS });
  for (const w of ["cone", "can"]) assert.ok(band.exactQueries.includes(w), `${w} keys KN like CANE and is searched`);
});

test("a made-up element keeps its sound-alike neighbours: VALENA → MALENA and VELENA are searched", () => {
  const band = formNeighbourhood("VALENA", { ordinaryWords: WORDS });
  for (const w of ["malena", "velena"]) assert.ok(band.exactQueries.includes(w));
});

test("an ordinary word whose key equals the element's is kept (SEA beside SEE)", () => {
  assert.ok(!ordinaryWordDifferentSound("SEE", WORDS).includes("sea"));
  assert.ok(formNeighbourhood("SEE", { ordinaryWords: WORDS }).exactQueries.includes("sea"));
});

test("dispatched plus not-searched is the whole generated neighbourhood, and the queries only shrink", () => {
  for (const el of ["CANE", "VALENA", "MERIDIAN", "BAT"]) {
    const before = formNeighbourhood(el);
    const after = formNeighbourhood(el, { ordinaryWords: WORDS });
    const generated = editNeighbourhood(el);
    const notSearched = after.ordinaryWordDifferentSound;
    const edit1Searched = generated.filter((t) => !notSearched.includes(t));
    assert.equal(edit1Searched.length + notSearched.length, generated.length, `${el}: every generated neighbour is accounted for`);
    assert.ok(after.exactQueries.every((q) => before.exactQueries.includes(q)), `${el}: no query is added`);
    assert.equal(before.exactQueries.length - after.exactQueries.length, notSearched.length, `${el}: exactly the not-searched terms leave`);
    const row = after.ledger.axes.find((a) => a.axis === "edit-1");
    assert.equal(row.not_searched, notSearched.length);
    assert.equal(row.generated, generated.length);
  }
});

test("no list, or an empty one, drops nothing — the behaviour before the rule", () => {
  assert.deepEqual(formNeighbourhood("CANE").exactQueries, formNeighbourhood("CANE", { ordinaryWords: new Set() }).exactQueries);
  assert.deepEqual(ordinaryWordDifferentSound("CANE", null), []);
});

test("the plan discloses every not-searched term as its own family, outside the searched floor", () => {
  const elements = [{ element: "cane", role: "dominant", band: formNeighbourhood("CANE", { ordinaryWords: WORDS }) }];
  const families = variantFloorFamilies(elements, { mark: "CANE" });
  const fam = families.find((f) => f.family === "ordinary-word-different-sound");
  assert.ok(fam, "the dropped terms are listed, so the plan says what it left out and why");
  assert.equal(fam.searched, false);
  assert.deepEqual(fam.terms, [...elements[0].band.ordinaryWordDifferentSound].sort());
  assert.ok(!families.find((f) => f.family === "edit-1").terms.includes("cake"), "a not-searched word is not in the searched edit-1 family");
  // A model that proposes one of these words is recorded as its own addition, not as a restatement of a
  // floor that never searched it.
  const merged = mergeVariantFloor(families, [{ value: "CAKE", category: "phonetic" }]);
  assert.equal(merged.model_additions.length, 1);
  assert.equal(merged.model_restatements.length, 0);
});

test("parseWordList skips comments and blanks and lowercases", () => {
  assert.deepEqual([...parseWordList("# header\n\nAlpha\nbeta\n  # indented comment\n")], ["alpha", "beta"]);
});
