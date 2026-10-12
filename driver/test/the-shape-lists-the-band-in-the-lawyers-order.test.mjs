// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SHAPE LISTS THE BAND IN THE LAWYER'S ORDER, ONE LINE PER MARK OF AN OWNER, AND COUNTS THE REST.
//
// Her method for a crowded field: identical marks for the client's goods; identical marks in the ordered
// classes; the same family for the client's goods; every other live mark in the ordered classes for the
// client's goods; the rest counted with its rule. These arms pin the record rule, the line per position,
// the order inside a group (goods words, the client's own counted double, then the client's markets, then
// live records, then record count), the goods test where the run holds no goods, the goods-cut lines the
// rest may not cover, and the readable section. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordGroup, bandGroups, buildBandShape, classifyRecord, prepareTargets, CROWDED_GROUP_RECORDS } from "../band-shape.mjs";
import { goodsWordCounter, goodsWordScore, goodsExcerpt } from "../record-goods.mjs";

const T = prepareTargets(["Qzorvak"]);
const classify = (r) => classifyRecord(r.mark_text, T);
const inScope = (r) => (r.classes ?? []).some((c) => ["9", "28"].includes(String(c)));
const rec = (id, mark, owner, classes, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status: "registered", jurisdictions: ["EU"], ...extra });
const goodsReader = (byId, { rowChars = 60, own = "" } = {}) => ({
  of: (r) => byId[r.record_id.split("/").pop()] ?? null,
  hits: goodsWordCounter(["game controllers", "joysticks"]),
  score: goodsWordScore(["game controllers", "joysticks"], own),
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
  for (const [why, r] of [
    ["unrelated goods", { tier: "other", live: true, inScope: true, hits: 0 }],
    ["not live", { tier: "other", live: false, inScope: true, hits: 1 }],
    ["outside the ordered classes", { tier: "other", live: true, inScope: false, hits: 1 }],
    ["same family on unrelated goods", { tier: "same-family", live: true, inScope: true, hits: 0 }],
  ]) assert.equal(recordGroup(r), "rest", why);
});

test("each mark of an owner is its own line in its own group, so a second mark is never hidden behind the first", () => {
  const records = [
    rec("a1", "QZORVAK", "Alpha Ltd", ["25"]),                    // identical, for the goods → (a)
    rec("a2", "Plimbo", "Alpha Ltd", ["9"]),                      // the same owner's other mark: live, in class, for the goods → (d)
    rec("b1", "Qzorvak", "Beta GmbH", ["9"]),                     // identical, in class, goods unrelated → (b)
    rec("r1", "Drellux", "Delta AG", ["9"]),                      // in class, goods unrelated → the rest
  ];
  const goods = goodsReader({ a1: [{ classes: ["25"], text: "joysticks" }], a2: [{ classes: ["9"], text: "game controllers" }],
    b1: [{ classes: ["9"], text: "printers" }], r1: [{ classes: ["9"], text: "printers" }] });
  const g = bandGroups(records, { classify, inScope, goods });
  assert.deepEqual(g.by_group.a.lines.map((l) => [l.owner_name, l.mark]), [["Alpha Ltd", "QZORVAK"]]);
  assert.deepEqual(g.by_group.d.lines.map((l) => [l.owner_name, l.mark]), [["Alpha Ltd", "Plimbo"]], "Alpha's other mark has a line of its own");
  assert.equal(g.by_group.a.lines[0].owner_key, g.by_group.d.lines[0].owner_key, "both lines carry the one owner's key");
  assert.notEqual(g.by_group.a.lines[0].key, g.by_group.d.lines[0].key);
  assert.deepEqual(g.by_group.rest.lines.map((l) => l.owner_name), ["Delta AG"]);
  // The keys a row reaches win over the band row's spelling: two spellings of one mark of one owner, one line.
  const keyed = bandGroups([rec("k1", "QZORVAK", "Omega Ltd", ["9"]), rec("k2", "QZORVAK", "Omega Limited", ["9"])],
    { classify, inScope, goods: null, keysOf: () => ({ position: "pos:one", owner: "owner:omega" }) });
  assert.equal(keyed.by_group.a.lines.length, 1);
  assert.equal(keyed.by_group.a.lines[0].records, 2);
});

test("inside a group the lines run by goods words, the client's own counted double, then the client's markets, then live, then records", () => {
  const records = [
    rec("m1", "QZORVAK", "Alpha Ltd", ["9"], { jurisdictions: ["US"] }),          // one word, outside the client's markets
    rec("m2", "QZORVAK", "Beta GmbH", ["9"], { jurisdictions: ["CH"] }),          // one word, in the client's markets
    rec("m3", "QZORVAK", "Gamma SA", ["9"], { jurisdictions: ["US"] }),           // the client's own word: counts double
    rec("m4", "QZORVAK", "Delta AG", ["9"], { jurisdictions: ["CH"], status: "expired" }),   // one word, in market, dead
  ];
  const goods = goodsReader({ m1: [{ classes: ["9"], text: "joysticks" }], m2: [{ classes: ["9"], text: "joysticks" }],
    m3: [{ classes: ["9"], text: "game controllers" }], m4: [{ classes: ["9"], text: "joysticks" }] }, { own: "game controllers for consoles" });
  const g = bandGroups(records, { classify, inScope, goods, markets: ["CH"] });
  assert.deepEqual(g.by_group.a.lines.map((l) => l.owner_name), ["Gamma SA", "Beta GmbH", "Delta AG", "Alpha Ltd"]);
  assert.deepEqual(g.by_group.a.lines.map((l) => l.in_market), [false, true, true, false]);
});

test("a line the rest holds only because its goods missed, whose goods are cut on the row, is listed and not covered", () => {
  const long = "printers; ".repeat(20);
  const records = [rec("u1", "Qzorvak", "Epsilon Oy", ["31"]), rec("u2", "Drellux", "Zeta BV", ["9"]), rec("u3", "Drellux", "Eta Kft", ["31"], { status: "expired" })];
  const g = bandGroups(records, { classify, inScope, goods: goodsReader({
    u1: [{ classes: ["31"], text: long }], u2: [{ classes: ["9"], text: long }], u3: [{ classes: ["31"], text: long }],
  }) });
  assert.deepEqual(g.unresolved.map((l) => l.owner_name).sort(), ["Epsilon Oy", "Zeta BV"],
    "identical outside the classes and live in class: each in the rest on goods alone, goods cut");
  assert.deepEqual(g.by_group.rest.lines.map((l) => l.owner_name), ["Eta Kft"], "an expired record is in the rest on what the row shows");
});

test("the readable section states each group's count in lines, lists (a) whole, and shows a crowded (b) by its first page", () => {
  const records = [];
  for (let i = 0; i < CROWDED_GROUP_RECORDS; i++) records.push(rec(`n${i}`, "Qzorvak", `Owner ${String(i).padStart(4, "0")} Ltd`, ["9"]));
  for (let i = 0; i < 7; i++) records.push(rec(`x${i}`, "QZORVAK", `Theta ${i} Ltd`, ["9"]));
  const goods = goodsReader(Object.fromEntries(records.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: r.owner_name.startsWith("Theta") ? "joysticks" : "printers" }]])));
  const { shape, md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods,
    dominantTerm: "Qzorv", manifestDominant: "Qzorvak", markets: ["EU"], caps: { owners: 5 } });
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS);
  assert.equal(shape.groups.b.list.length, CROWDED_GROUP_RECORDS, "the machine shape keeps every line");
  const section = md.slice(md.indexOf("## The band in the lawyer's order"), md.indexOf("### By Nice class"));
  assert.match(section, /1,000 records in 1,000 lines from 1,000 owners: a thousand or more, the field is crowded\. The first page is below; open by owner name only those your judgment needs\./);
  assert.equal((section.match(/\| Qzorvak \| Owner \d{4} Ltd \|/g) ?? []).length, 5, "the readable mirror shows (b)'s first page only");
  assert.equal((section.match(/\| QZORVAK \| Theta \d Ltd \|/g) ?? []).length, 7, "(a) is listed whole, past the first page");
  assert.match(section, /7 records in 7 lines from 7 owners\.\n\nEvery line in \(a\) is placed or set aside by name\./);
  assert.match(section, /The client's markets: EU\./);
  assert.match(section, /Sorted on «Qzorv», the word the register's goods-narrowed search asked for \(the variants stage named «Qzorvak»\)\./);
  assert.match(section, /\*\*The rest: 0 records in 0 lines from 0 owners\*\*/);
  assert.ok(md.indexOf("## The band in the lawyer's order") > md.indexOf("## Floors"), "the groups follow the floors");
});
