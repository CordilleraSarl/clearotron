// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the judges' opening pages over an invented pile shaped like a crowded case
//
// THE OPENING PAGES HOLD THE WHOLE NEAR BAND (design, 2026-10-02).
//
// The judges' message carries the owner table's first pages up to a character budget, and the rest is read
// by page. On a crowded case the budget ended inside the near band: the owners with a live record in the
// order's classes whose closeness is better than a loose match, which a lawyer reads in full. One of the
// lawyer's entries sat just past the cut and no judge ever saw it. Now the pages run on, whole, until the
// near band is complete, and only then may the budget stop them; the loose matches follow by page as before.
// A near band that ends inside the budget leaves the opening exactly as it was. No call is added.
//
// The pile is built in memory and every name in it is invented; the table, the paging tool and the opening
// are the engine's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeOwnerTools, MESSAGE_TABLE_CHARS } from "../owner-tools.mjs";
import { firstTablePages, nearBandKeys } from "../owner-judgment.mjs";

const pad = (i) => String(i).padStart(4, "0");
/**
 * A pile shaped like the crowded case: `near` owners, each with a live record in class 9 brought by an
 * exact question on another form of the mark, then `loose` owners whose records only a contains question
 * brought, then a few with nothing live.
 */
function pile({ near, loose, dead = 20 }) {
  const records = [];
  const add = (i, mark, qid, status) => records.push({ id: `/mark/us/${pad(i)}`, mark, owner: `Owner ${pad(i)} Holdings Ltd`,
    ownerCountry: "US", office: "US", classes: [9], status, filed: "2019-04-01", qids: [qid] });
  let i = 0;
  for (let k = 0; k < near; k++) add(i++, k % 2 ? "QORVENA" : "QORVEX", "q-exact", "REGISTERED");
  for (let k = 0; k < loose; k++) add(i++, "QORVENTALIS", "q-contains", "REGISTERED");
  for (let k = 0; k < dead; k++) add(i++, "QORVENA", "q-exact", "EXPIRED");
  return { orderMarks: ["QORVEN"], orderClasses: [9], records,
    questions: [{ qid: "q-exact", match: "exact" }, { qid: "q-contains", match: "contains" }],
    readFullRecord: () => null };
}
const open = (p, withBand) => {
  const tools = makeOwnerTools(p);
  const band = nearBandKeys(tools.table);
  return { band, opening: firstTablePages(tools.serve, MESSAGE_TABLE_CHARS, withBand ? { nearBand: band } : {}), tools };
};

test("on a crowded pile the budget used to cut inside the near band; the opening now holds all of it and stops there", () => {
  const p = pile({ near: 900, loose: 1200 });
  const before = open(p, false);
  const { band, opening, tools } = open(p, true);
  // PREMISE — the shape of the case: the near band runs past what the budget alone would show.
  assert.equal(band.length, 900, "the near band is the live owners closer than a loose match");
  const missedBefore = band.filter((k) => !before.opening.keysShown.includes(k)).length;
  assert.ok(missedBefore > 0, `premise: the budget alone shows the whole band (${before.opening.pages} pages) — this arm proves nothing`);
  // THE CLAIM — every near-band owner is on the opening pages, in more pages than the budget gave.
  const shown = new Set(opening.keysShown);
  assert.deepEqual(band.filter((k) => !shown.has(k)), [], "a near-band owner is still past the opening");
  assert.ok(opening.pages > before.opening.pages, `${opening.pages} page(s) against ${before.opening.pages}`);
  // ...and it stops at the page that completes the band: the loose matches after it are read by page.
  const pageOf = (n) => tools.serve("owner_table", { page: n }).result.keysShown;
  assert.ok(pageOf(opening.pages).some((k) => k === band[band.length - 1]), "the last page shown is not the one that completes the band");
  const next = pageOf(opening.pages + 1);
  assert.ok(next.length > 0 && next.every((k) => !band.includes(k)), "the page after the opening still holds near-band owners");
  assert.equal(opening.keysShown.length, new Set(opening.keysShown).size, "an owner shown twice");
});

test("CONTROL — a near band that ends inside the budget leaves the opening exactly as it was", () => {
  const p = pile({ near: 40, loose: 1200 });
  const before = open(p, false);
  const after = open(p, true);
  assert.ok(after.band.every((k) => before.opening.keysShown.includes(k)), "premise: the small band fits the budget");
  assert.equal(after.opening.pages, before.opening.pages);
  assert.deepEqual(after.opening.keysShown, before.opening.keysShown);
  assert.equal(after.opening.text, before.opening.text);
});

test("the near band is the live owners at the first three closeness steps, in table order", () => {
  const p = pile({ near: 5, loose: 5, dead: 3 });
  const { tools, band } = open(p, true);
  const rows = tools.table.rows;
  assert.deepEqual(band, rows.slice(0, 5).map((r) => r.key), "the band is not the table's leading rows");
  assert.ok(rows.slice(5).every((r) => !band.includes(r.key)));
  assert.ok(rows.filter((r) => band.includes(r.key)).every((r) => r.liveInClasses > 0 && r.row.closeness !== "loose match"));
});

test("the judges' step hands the near band to the opening", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /firstTablePages\(tools\.serve, MESSAGE_TABLE_CHARS, \{ nearBand: nearBandKeys\(table\) \}\)/,
    "the pipeline opens the table without the near band");
});
