// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SHAPE LISTS THE BAND IN THE LAWYER'S ORDER, BY OWNER, AND COUNTS THE REST.
//
// Her method for a crowded field: identical marks for the client's goods; identical marks in the ordered
// classes; the same family for the client's goods; every other live mark in the ordered classes for the
// client's goods; the rest counted with its rule. These arms pin the record rule, the one-owner-one-group
// fold, the goods test where the run holds no goods, the goods-cut owners the rest may not cover, and the
// readable section. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordGroup, bandGroups, buildBandShape, classifyRecord, prepareTargets, CROWDED_GROUP_RECORDS } from "../band-shape.mjs";
import { goodsWordCounter, goodsExcerpt } from "../record-goods.mjs";

const T = prepareTargets(["Qzorvak"]);
const classify = (r) => classifyRecord(r.mark_text, T);
const inScope = (r) => (r.classes ?? []).some((c) => ["9", "28"].includes(String(c)));
const rec = (id, mark, owner, classes, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status: "registered", ...extra });
const goodsReader = (byId, { rowChars = 60 } = {}) => ({
  of: (r) => byId[r.record_id.split("/").pop()] ?? null,
  hits: goodsWordCounter(["game controllers", "joysticks"]),
  line: (g) => goodsExcerpt(g, { inScopeClasses: ["9", "28"], maxChars: 40 }),
  rowCut: (g) => Boolean(goodsExcerpt(g, { inScopeClasses: ["9", "28"], maxChars: rowChars })?.cut),
});

test("one record's group follows her order, and goods the run does not hold pass the goods test", () => {
  assert.equal(recordGroup({ tier: "identical", live: false, inScope: false, hits: 1 }), "a", "identical for the goods: (a), live or not, in class or not");
  assert.equal(recordGroup({ tier: "near-identical", live: true, inScope: true, hits: 0 }), "b", "identical in the ordered classes, goods unrelated: (b)");
  assert.equal(recordGroup({ tier: "same-family", live: true, inScope: false, hits: 2 }), "c");
  assert.equal(recordGroup({ tier: "other", live: true, inScope: false, hits: 1, dominant: true }), "c", "the searched dominant word for the goods: (c)");
  assert.equal(recordGroup({ tier: "other", live: true, inScope: true, hits: 1 }), "d");
  assert.equal(recordGroup({ tier: "other", live: true, inScope: true, hits: null }), "d", "no goods on file is not a mismatch");
  assert.equal(recordGroup({ tier: "identical", live: true, inScope: false, hits: null }), "a");
  for (const [why, r] of [
    ["unrelated goods", { tier: "other", live: true, inScope: true, hits: 0 }],
    ["not live", { tier: "other", live: false, inScope: true, hits: 1 }],
    ["outside the ordered classes", { tier: "other", live: true, inScope: false, hits: 1 }],
    ["same family on unrelated goods", { tier: "same-family", live: true, inScope: true, hits: 0 }],
  ]) assert.equal(recordGroup(r), "rest", why);
});

test("an owner sits in the best group any of its records reaches, keyed the way a set-aside row reaches it", () => {
  const records = [
    rec("a1", "QZORVAK", "Alpha Ltd", ["25"]),          // identical, goods match → (a)
    rec("a2", "Plimbo", "Alpha Ltd", ["9"]),            // other, live, in class, goods match → (d) — but the owner is in (a)
    rec("b1", "Qzorvak", "Beta GmbH", ["9"]),           // identical, in class, goods unrelated → (b)
    rec("r1", "Plimbo", "Gamma SA", ["31"], { status: "expired" }),
    rec("r2", "Drellux", "Delta AG", ["9"]),            // other, in class, goods unrelated → rest
  ];
  const goods = goodsReader({
    a1: [{ classes: ["25"], text: "joysticks" }], a2: [{ classes: ["9"], text: "game controllers" }],
    b1: [{ classes: ["9"], text: "printers" }], r1: [{ classes: ["31"], text: "seeds" }], r2: [{ classes: ["9"], text: "printers" }],
  });
  const g = bandGroups(records, { classify, inScope, goods });
  assert.deepEqual(g.by_group.a.owners.map((o) => o.owner_name), ["Alpha Ltd"]);
  assert.equal(g.by_group.a.owners[0].records, 2, "the owner's whole set rides with it");
  assert.equal(g.by_group.a.records, 1, "the group counts the records that reach it, the pile her sizes are about");
  assert.equal(g.by_group.a.set_records, 2);
  assert.equal(g.by_group.d.owners.length, 0, "Alpha's other mark does not list the owner a second time");
  assert.deepEqual(g.by_group.b.owners.map((o) => o.owner_name), ["Beta GmbH"]);
  assert.deepEqual(g.by_group.rest.owners.map((o) => o.owner_name).sort(), ["Delta AG", "Gamma SA"]);
  // The set-aside row's own key wins over the band row's owner name: two spellings of one owner, one key.
  const keyed = bandGroups([rec("k1", "QZORVAK", "Omega Ltd", ["9"]), rec("k2", "Plimbo", "Omega Limited", ["31"], { status: "expired" })],
    { classify, inScope, goods: null, ownerKeyOf: () => "owner:omega" });
  assert.equal(keyed.by_group.a.owners.length, 1);
  assert.equal(keyed.by_group.rest.owners.length, 0, "the expired record of the same owner is not set aside with the rest");
});

test("an owner the rest holds only because its goods missed, whose goods are cut on the row, is listed and not covered", () => {
  const long = "printers; ".repeat(20);
  const records = [rec("u1", "Qzorvak", "Epsilon Oy", ["31"]), rec("u2", "Drellux", "Zeta BV", ["9"]), rec("u3", "Drellux", "Eta Kft", ["31"], { status: "expired" })];
  const g = bandGroups(records, { classify, inScope, goods: goodsReader({
    u1: [{ classes: ["31"], text: long }], u2: [{ classes: ["9"], text: long }], u3: [{ classes: ["31"], text: long }],
  }) });
  assert.deepEqual(g.unresolved.map((o) => o.owner_name).sort(), ["Epsilon Oy", "Zeta BV"],
    "identical outside the classes and live in class: each in the rest on goods alone, goods cut");
  assert.deepEqual(g.by_group.rest.owners.map((o) => o.owner_name), ["Eta Kft"], "an expired record is in the rest on what the row shows");
});

test("the readable section states each group's count, and a group of a thousand or more shows its first page", () => {
  const records = [];
  for (let i = 0; i < CROWDED_GROUP_RECORDS; i++) records.push(rec(`n${i}`, "Qzorvak", `Owner ${String(i).padStart(4, "0")} Ltd`, ["9"]));
  records.push(rec("x1", "Plimbo", "Theta Ltd", ["9"]));
  const goods = goodsReader(Object.fromEntries(records.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: r.mark_text === "Plimbo" ? "joysticks" : "printers" }]])));
  const { shape, md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods,
    dominantTerm: "Qzorv", manifestDominant: "Qzorvak", caps: { owners: 5 } });
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS);
  assert.equal(shape.groups.b.list.length, CROWDED_GROUP_RECORDS, "the machine shape keeps every owner");
  assert.match(md, /1,000 records from 1,000 owners: a thousand or more, the field is crowded\. The first page is below; open by owner name only those your judgment needs\./);
  const section = md.slice(md.indexOf("## The band in the lawyer's order"), md.indexOf("### By Nice class"));
  assert.equal((section.match(/\| Owner \d{4} Ltd \|/g) ?? []).length, 5, "the readable mirror shows the first page only");
  assert.match(md, /1 records from 1 owners\./, "a small group states its count too");
  assert.match(md, /Sorted on «Qzorv», the word the register's goods-narrowed search asked for \(the variants stage named «Qzorvak»\)\./);
  assert.match(md, /\*\*The rest: 0 records from 0 owners\*\*/);
  assert.ok(md.indexOf("## The band in the lawyer's order") > md.indexOf("## Floors"), "the groups follow the floors");
});
