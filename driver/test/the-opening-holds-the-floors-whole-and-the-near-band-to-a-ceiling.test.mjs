// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the judges' opening pages over invented piles shaped like a crowded case
//
// THE OPENING HOLDS THE FLOORS WHOLE, THEN THE NEAR BAND TO A CEILING, AND THE CUT IS RECORDED
// (design, 2026-10-03).
//
// The judges' message carries the owner table's first pages up to a character budget. On a crowded case
// the budget ended inside the near band, and a lawyer's entry sat just past it. The opening now holds,
// whole and always, the floors: the owners with a live record in the order's classes whose mark is the
// ordered mark or holds it as a word. Then the third closeness step follows, in table order, up to a
// ceiling in pages; the loose matches are read by page as before. Where the ceiling cuts inside the near
// band, the opening says where: the rank reached and the band's size. It is never smaller than the budget
// alone makes it, and a pile whose near band fits shows exactly today's opening.
//
// The pile is built in memory and every name in it is invented; the table, the paging tool and the opening
// are the engine's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeOwnerTools, MESSAGE_TABLE_CHARS } from "../owner-tools.mjs";
import { firstTablePages, openingBands } from "../owner-judgment.mjs";

const pad = (i) => String(i).padStart(4, "0");
/**
 * A pile: `same` owners whose live record in class 9 is the ordered mark, `word` whose mark holds it as a
 * word, `near` brought by an exact question on another form, then `loose` only a contains question brought.
 */
function pile({ same = 0, word = 0, near = 0, loose = 0 }) {
  const records = [];
  let i = 0;
  const add = (n, mark, qid) => { for (let k = 0; k < n; k++, i++) records.push({ id: `/mark/us/${pad(i)}`, mark,
    owner: `Owner ${pad(i)} Holdings Ltd`, ownerCountry: "US", office: "US", classes: [9], status: "REGISTERED", filed: "2019-04-01", qids: [qid] }); };
  add(same, "QORVEN", "q-exact"); add(word, "QORVEN LABS", "q-exact"); add(near, "QORVENA", "q-exact"); add(loose, "QORVENTALIS", "q-contains");
  return { orderMarks: ["QORVEN"], orderClasses: [9], records,
    questions: [{ qid: "q-exact", match: "exact" }, { qid: "q-contains", match: "contains" }], readFullRecord: () => null };
}
/**
 * Today's opening, read off the paging tool independently of the code under test: whole pages while the
 * text stays within the budget, the first page always.
 */
function budgetOpening(tools) {
  const keys = [], texts = [];
  let used = 0;
  for (let page = 1; ; page++) {
    const r = tools.serve("owner_table", { page });
    if (r.refused || (texts.length && used + r.text.length > MESSAGE_TABLE_CHARS)) break;
    texts.push(r.text); used += r.text.length; keys.push(...r.result.keysShown);
    if (page >= r.result.pages) break;
  }
  return { pages: texts.length, keysShown: keys, text: texts.join("\n\n") };
}
const open = (p, ceilingPages) => {
  const tools = makeOwnerTools(p);
  const bands = openingBands(tools.table);
  return { bands, tools, today: budgetOpening(tools),
    opening: firstTablePages(tools.serve, MESSAGE_TABLE_CHARS, { ...bands, ceilingPages }) };
};
const shownAll = (opening, keys) => keys.every((k) => opening.keysShown.includes(k));

test("the floors are the live owners at the first two steps; the near band adds the third; both lead the table", () => {
  const { bands, tools } = open(pile({ same: 3, word: 4, near: 5, loose: 6 }), 4);
  const rows = tools.table.rows;
  assert.deepEqual(bands.floor, rows.slice(0, 7).map((r) => r.key));
  assert.deepEqual(bands.band, rows.slice(0, 12).map((r) => r.key));
});

test("past the budget the third step runs to the ceiling, and the cut inside the band is recorded", () => {
  const { bands, today, opening, tools } = open(pile({ same: 20, word: 80, near: 1100, loose: 600 }), 3);
  assert.ok(!shownAll(today, bands.band), "premise: the budget alone stops inside the near band");
  assert.equal(opening.pages, 3, "the opening did not run to the ceiling");
  assert.ok(shownAll(opening, bands.floor), "a floor owner is past the opening");
  assert.ok(!shownAll(opening, bands.band), "premise: the ceiling cuts inside this band");
  assert.deepEqual(opening.cut, { rankReached: opening.keysShown.length, nearBand: bands.band.length });
  const next = tools.serve("owner_table", { page: 4 }).result.keysShown;
  assert.ok(next.every((k) => bands.band.includes(k)), "the cut is not inside the band: page 4 already holds loose matches");
});

test("a band within the ceiling is shown whole and nothing is cut", () => {
  const { bands, opening } = open(pile({ same: 20, word: 80, near: 500, loose: 1200 }), 6);
  assert.ok(shownAll(opening, bands.band));
  assert.equal(opening.cut, null);
});

test("floors past the ceiling still go whole, and the cut of the rest is recorded", () => {
  const { bands, opening } = open(pile({ same: 300, word: 1000, near: 400, loose: 300 }), 2);
  assert.ok(opening.pages > 2, `premise: the floors run past the ceiling (${opening.pages} page(s))`);
  assert.ok(shownAll(opening, bands.floor), "the ceiling cut the floors");
  assert.ok(opening.cut && opening.cut.rankReached >= bands.floor.length && opening.cut.nearBand === bands.band.length, JSON.stringify(opening.cut));
});

test("the opening is never smaller than today's, and with no ceiling set the third step stops where the budget does", () => {
  const p = pile({ same: 20, word: 80, near: 1100, loose: 600 });
  for (const ceiling of [1, null]) {
    const { today, opening } = open(p, ceiling);
    assert.equal(opening.pages, today.pages, `ceiling ${ceiling}: the opening shrank or grew`);
    assert.deepEqual(opening.keysShown, today.keysShown);
    assert.ok(opening.cut, `ceiling ${ceiling}: the cut inside the band went unrecorded`);
  }
});

test("CONTROL — a pile whose near band fits shows exactly today's opening, with nothing cut", () => {
  const { today, opening } = open(pile({ same: 10, word: 30, near: 40, loose: 1200 }), 4);
  assert.equal(opening.text, today.text);
  assert.deepEqual(opening.keysShown, today.keysShown);
  assert.equal(opening.cut, null);
});

test("the judges' step opens with both bands and the one ceiling setting, and logs the cut", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /firstTablePages\(tools\.serve, MESSAGE_TABLE_CHARS, \{ \.\.\.openingBands\(table\), ceilingPages: OPENING_CEILING_PAGES \}\)/);
  assert.match(src, /event: "owner-table"[\s\S]{0,400}openingCut: opening\.cut/, "the run log does not carry the cut");
});
