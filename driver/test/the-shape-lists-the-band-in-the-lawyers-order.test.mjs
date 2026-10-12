// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SHAPE LISTS THE BAND IN THE LAWYER'S ORDER, ONE LINE PER MARK OF AN OWNER, AND COUNTS THE REST.
//
// Her method for a crowded field: identical marks for the client's goods; identical marks in the ordered
// classes; the same family for the client's goods; every other live mark in the ordered classes for the
// client's goods; the rest counted with its rule. These arms pin the record rule, the line per position,
// the order inside a group as ruled (the client's goods on a live record in the ordered classes, then live
// records in those classes, then goods words, then the client's markets, then records), the goods test where
// the run holds no goods, the lines listed apart for having no goods on file, and the readable section, whose lines
// carry the goods words matched and never the goods text. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordGroup, bandGroups, buildBandShape, classifyRecord, prepareTargets, CROWDED_GROUP_RECORDS } from "../band-shape.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const T = prepareTargets(["Qzorvak"]);
const classify = (r) => classifyRecord(r.mark_text, T);
const inScope = (r) => (r.classes ?? []).some((c) => ["9", "28"].includes(String(c)));
const rec = (id, mark, owner, classes, extra = {}) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes, status: "registered", jurisdictions: ["EU"], ...extra });
const goodsReader = (byId) => ({
  of: (r) => byId[r.record_id.split("/").pop()] ?? null,
  hits: goodsWordCounter(["game controllers", "joysticks"]),
  matched: goodsWordsMatched(["game controllers", "joysticks"]),
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
    { classify, inScope, goods: goodsReader({ k1: [{ classes: ["9"], text: "joysticks" }], k2: [{ classes: ["9"], text: "joysticks" }] }),
      keysOf: () => ({ line: "line:one", owner: "owner:omega" }) });
  assert.equal(keyed.by_group.a.lines.length, 1);
  assert.equal(keyed.by_group.a.lines[0].records, 2);
});

test("inside a group the lines run by the client's goods on a live record in class, then live records there, then words, then markets, then records", () => {
  const records = [
    rec("m1", "QZORVAK", "Alpha Ltd", ["25"], { jurisdictions: ["CH"] }),                 // two words, but outside the ordered classes
    rec("m2", "QZORVAK", "Beta GmbH", ["9"], { jurisdictions: ["US"] }),                  // one word on a live in-class record
    rec("m3", "QZORVAK", "Gamma SA", ["9"], { jurisdictions: ["US"] }),                   // the same, with a second live in-class record
    rec("m3b", "QZORVAK", "Gamma SA", ["28"], { jurisdictions: ["US"] }),
    rec("m4", "QZORVAK", "Delta AG", ["9"], { jurisdictions: ["CH"] }),                   // one word, in the client's markets
    rec("m5", "QZORVAK", "Epsilon Oy", ["9"], { jurisdictions: ["CH"], status: "expired" }),   // two words, but not live
  ];
  const goods = goodsReader({ m1: [{ classes: ["25"], text: "joysticks and game controllers" }], m2: [{ classes: ["9"], text: "joysticks" }],
    m3: [{ classes: ["9"], text: "joysticks" }], m3b: [{ classes: ["28"], text: "toys" }], m4: [{ classes: ["9"], text: "joysticks" }],
    m5: [{ classes: ["9"], text: "joysticks and game controllers" }] });
  const g = bandGroups(records, { classify, inScope, goods, markets: ["CH"] });
  assert.deepEqual(g.by_group.a.lines.map((l) => l.owner_name), ["Gamma SA", "Delta AG", "Beta GmbH", "Alpha Ltd", "Epsilon Oy"]);
  assert.deepEqual(g.by_group.a.lines.map((l) => l.goods_words), [["joysticks"], ["joysticks"], ["joysticks"], ["game controllers", "joysticks"], ["game controllers", "joysticks"]]);
});

test("a line the goods test placed while its records carry no goods on file is listed apart, and no other line is", () => {
  const records = [rec("u1", "QZORVAK", "Epsilon Oy", ["9"]), rec("u2", "QZORVAK", "Zeta BV", ["9"]), rec("u3", "Drellux", "Eta Kft", ["31"], { status: "expired" })];
  const g = bandGroups(records, { classify, inScope, goods: goodsReader({ u2: [{ classes: ["9"], text: "printers; ".repeat(40) }] }) });
  assert.deepEqual(g.no_goods.map((l) => l.owner_name), ["Epsilon Oy"], "identical, in class, and nothing on file to test its goods");
  assert.deepEqual(g.by_group.b.lines.map((l) => l.owner_name), ["Zeta BV"], "a long goods text is read whole: nothing is cut, it is simply not the client's goods");
  assert.deepEqual(g.by_group.rest.lines.map((l) => l.owner_name), ["Eta Kft"], "a dead mark with no goods is in the rest on what the line shows");
});

test("the readable section states each group's count in lines, carries goods words not goods text, and shows a crowded group by its first page", () => {
  const records = [];
  for (let i = 0; i < CROWDED_GROUP_RECORDS; i++) records.push(rec(`n${i}`, "Qzorvak", `Owner ${String(i).padStart(4, "0")} Ltd`, ["9"]));
  for (let i = 0; i < 7; i++) records.push(rec(`x${i}`, "QZORVAK", `Theta ${i} Ltd`, ["9"]));
  const goods = goodsReader(Object.fromEntries(records.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: r.owner_name.startsWith("Theta") ? "joysticks" : "printers" }]])));
  const { shape, md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 2,
    dominantTerm: "Qzorv", manifestDominant: "Qzorvak", markets: ["EU"], caps: { owners: 5 } });
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS);
  assert.equal(shape.groups.b.list.length, CROWDED_GROUP_RECORDS, "the machine shape keeps every line");
  const section = md.slice(md.indexOf("## The band in the lawyer's order"), md.indexOf("### By Nice class"));
  assert.ok(section.includes("1,000 records in 1,000 lines from 1,000 owners. A thousand or more? The field is crowded: read the identical and live ones for the client's goods, tell the client it is crowded, and do not write up the rest. The first 5 lines are below; page every other line with band_lookup {\"group\":\"b\"} before this group's row, which covers only the lines you were served."), "her crowded sentence, and how to page the group");
  assert.equal((section.match(/\| Qzorvak \| Owner \d{4} Ltd \|/g) ?? []).length, 5, "the readable mirror shows (b)'s first page only");
  assert.equal((section.match(/\| QZORVAK \| Theta \d Ltd \|/g) ?? []).length, 7, "a group under a thousand is listed whole");
  assert.match(section, /7 records in 7 lines from 7 owners\./);
  assert.match(section, /\| QZORVAK \| Theta 0 Ltd \| 9 \| 1 of 1 \| EU \| 1 of 2: joysticks \| \/mark\/eu\/x0 \|/, "a line: classes, live of records, territories, the words matched");
  assert.doesNotMatch(section, /printers/, "no goods text on a line");
  assert.match(section, /The client's markets: EU\./);
  assert.match(section, /Sorted on «Qzorv», the word the register's goods-narrowed search asked for \(the variants stage named «Qzorvak»\)\./);
  assert.match(section, /\*\*The rest: 0 records in 0 lines from 0 owners\*\* — every record in none of \(a\) to \(d\) above\. Write down what you set aside and why: one row, with this count\./);
  assert.ok(md.indexOf("## The band in the lawyer's order") > md.indexOf("## Floors"), "the groups follow the floors");
});

test("the list holds every register that binds the order's territories; a line held only outside them goes to the rest", () => {
  const records = [
    rec("t1", "QZORVAK", "Alpha Ltd", ["9"], { jurisdictions: "EM" }),       // the EU register, spelt as one register writes it
    rec("t2", "QZORVAK", "Beta GmbH", ["9"], { jurisdictions: "DE" }),       // a member's national register binds inside an EU order
    rec("t3", "QZORVAK", "Gamma SA", ["9"], { jurisdictions: "WO" }),        // Madrid binds every ordered territory
    rec("t4", "QZORVAK", "Delta AG", ["9"], { jurisdictions: [] }),          // a record naming no register stays in
    rec("t5", "QZORVAK", "Epsilon KK", ["9"], { jurisdictions: "JP" }),      // outside an EU and CH order
  ];
  const goods = goodsReader(Object.fromEntries(records.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: "joysticks" }]])));
  const g = bandGroups(records, { classify, inScope, goods, territories: ["EU", "CH"] });
  assert.deepEqual(g.by_group.a.lines.map((l) => l.owner_name).sort(), ["Alpha Ltd", "Beta GmbH", "Delta AG", "Gamma SA"]);
  assert.deepEqual(g.by_group.rest.lines.map((l) => [l.owner_name, l.outside]), [["Epsilon KK", true]]);
  assert.deepEqual(g.outside, { lines: 1, records: 1 });
  assert.deepEqual(bandGroups(records, { classify, inScope, goods }).by_group.a.lines.length, 5, "a worldwide order lists the world");
  const { shape, md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 1, territories: ["EU", "CH"] });
  assert.deepEqual([shape.groups.rest.floor_lines, shape.groups.rest.list[0].record_id], [1, "/mark/eu/t5"]);
  assert.ok(md.includes("**The rest: 1 records in 1 lines from 1 owners, 1 lines of them held only outside the ordered territories, 1 of those identical marks live in an ordered class, among the floors above**"),
    "an identical mark the order's territories leave in the rest is counted on the rest's line");
});

test("membership binds both ways: the EU register for a member's order, Benelux for its three, the International Bureau for any", () => {
  const goods = goodsReader({ m1: [{ classes: ["9"], text: "joysticks" }], m2: [{ classes: ["9"], text: "joysticks" }], m3: [{ classes: ["9"], text: "joysticks" }], m4: [{ classes: ["9"], text: "joysticks" }] });
  const recs = [rec("m1", "QZORVAK", "Alpha Ltd", ["9"], { jurisdictions: "EM" }), rec("m2", "QZORVAK", "Beta BV", ["9"], { jurisdictions: "BX" }),
    rec("m3", "QZORVAK", "Gamma SA", ["9"], { jurisdictions: "IB" }), rec("m4", "QZORVAK", "Delta Inc", ["9"], { jurisdictions: "US" })];
  const inDE = bandGroups(recs, { classify, inScope, goods, territories: ["DE"] });
  assert.deepEqual(inDE.by_group.a.lines.map((l) => l.owner_name).sort(), ["Alpha Ltd", "Gamma SA"], "an EU mark and an international one bind Germany");
  const inNL = bandGroups(recs, { classify, inScope, goods, territories: ["NL"] });
  assert.ok(inNL.by_group.a.lines.some((l) => l.owner_name === "Beta BV"), "Benelux is the Netherlands' national register");
});

test("an order written in names reads as its codes, and a register given as objects or a map is read", async () => {
  const { orderTerritories } = await import("../effective-scope.mjs");
  assert.deepEqual(orderTerritories({ jurisdictions: ["Switzerland"], geography: { mode: "named" } }, null), ["CH"]);
  const goods = goodsReader({ o1: [{ classes: ["9"], text: "joysticks" }], o2: [{ classes: ["9"], text: "joysticks" }], o3: [{ classes: ["9"], text: "joysticks" }] });
  const recs = [rec("o1", "QZORVAK", "Alpha Ltd", ["9"], { jurisdictions: [{ jurisdiction: "CH", status: "registered" }] }),
    rec("o2", "QZORVAK", "Beta AG", ["9"], { jurisdictions: { CH: "registered", US: "pending" } }),
    rec("o3", "QZORVAK", "Gamma SA", ["9"], { jurisdictions: [{ unknown_shape: true }] })];
  const g = bandGroups(recs, { classify, inScope, goods, territories: ["CH"] });
  assert.deepEqual(g.by_group.a.lines.map((l) => l.owner_name).sort(), ["Alpha Ltd", "Beta AG", "Gamma SA"], "a register it cannot read keeps the record in");
});

test("the groups key on the client's product words when the variants stage names them, and on the goods words when it does not", async () => {
  const { bandShapeGoods } = await import("../record-goods.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { driverDir } = await import("../../shared/driver-dir.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "shape-product-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    const P = { runDir, variantManifestModel: join(runDir, "variant-manifest.json"), registerPlan: driverDir(runDir, "register-plan.json") };
    writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), JSON.stringify({ target: "/mark/eu/p1", body: { goodsServices: [{ classes: [9], language: "en", description: "computer peripherals" }] } }) + "\n");
    const base = { schema_version: 1, mark: "QZORVAK", dominant_element: "QZORVAK", elements: [{ value: "QZORVAK", kind: "distinctive" }],
      variants: [{ value: "QZORVAK", category: "core" }], incumbent_classes: [], watchlist_owners: [] };
    writeFileSync(P.variantManifestModel, JSON.stringify({ ...base, goods_words: ["joysticks", "peripherals"] }));
    const generic = bandShapeGoods(P, ["9"]);
    assert.equal(generic.goods.hits(generic.goods.of({ record_id: "/mark/eu/p1" })), 1, "no product words named: the goods words decide");
    writeFileSync(P.variantManifestModel, JSON.stringify({ ...base, goods_words: ["joysticks", "peripherals"], product_words: ["joysticks"] }));
    const product = bandShapeGoods(P, ["9"]);
    assert.equal(product.goods.hits(product.goods.of({ record_id: "/mark/eu/p1" })), 0, "a class word alone is not the client's goods");
    assert.equal(product.goodsWordCount, 1);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the shape says which words its goods test read, and says so when it fell back to the class words", async () => {
  const { bandShapeGoods } = await import("../record-goods.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { driverDir } = await import("../../shared/driver-dir.mjs");
  const runDir = mkdtempSync(join(tmpdir(), "shape-source-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    const P = { runDir, variantManifestModel: join(runDir, "variant-manifest.json"), registerPlan: driverDir(runDir, "register-plan.json") };
    writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), JSON.stringify({ target: "/mark/eu/p1", body: { goodsServices: [{ classes: [9], language: "en", description: "joysticks" }] } }) + "\n");
    const base = { schema_version: 1, mark: "QZORVAK", dominant_element: "QZORVAK", elements: [{ value: "QZORVAK", kind: "distinctive" }],
      variants: [{ value: "QZORVAK", category: "core" }], incumbent_classes: [], watchlist_owners: [] };
    const band = { enumerated: [rec("p1", "QZORVAK", "Alpha Ltd", ["9"])] };
    const shapeFor = (model) => {
      writeFileSync(P.variantManifestModel, JSON.stringify({ ...base, ...model }));
      const g = bandShapeGoods(P);
      return { test: g.goodsTest, md: buildBandShape(band, { targets: ["Qzorvak"], inScopeClasses: ["9"], ...g }).md };
    };
    const product = shapeFor({ goods_words: ["computer peripherals"], product_words: ["joystick"] });
    assert.deepEqual(product.test, { source: "product_words", words: ["joystick"] });
    assert.match(product.md, /The goods test reads each record's goods for the client's product words: «joystick»\./);
    const fallback = shapeFor({ goods_words: ["computer peripherals", "joysticks"] });
    assert.deepEqual(fallback.test, { source: "goods_words", words: ["computer peripherals", "joysticks"] });
    assert.match(fallback.md, /No product words were given, so the goods test reads each record's goods for the class words of the register search: «computer peripherals», «joysticks»\. They name the classes, not the client's product/);
    const none = shapeFor({});
    assert.equal(none.test.source, "none");
    assert.match(none.md, /No goods words were given, so no record was tested on its goods\./);
    assert.match(none.md, /\*\*Not tested on goods: 1 records in 1 lines from 1 owners\*\* — no goods words were given/, "with no words the line is listed apart for that reason, not for goods the record lacks");
    assert.doesNotMatch(none.md, /No goods on file/);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a mark whose goods carry no English is listed apart and opened, never sent to the rest", async () => {
  const { recordGoods } = await import("../record-goods.mjs");
  const bodies = { f1: { goodsServices: [{ classes: [9], language: "de", description: "Videospiele; Spielkonsolen" }] } };
  const goods = { of: (r) => { const b = bodies[r.record_id.split("/").pop()]; return b ? recordGoods(b) : null; },
    hits: goodsWordCounter(["video game"], { stems: true }), matched: goodsWordsMatched(["video game"], { stems: true }) };
  const g = bandGroups([rec("f1", "QZORVAK", "Alpha GmbH", ["9"])], { classify, inScope, goods });
  assert.deepEqual(g.no_goods.map((l) => l.owner_name), ["Alpha GmbH"]);
  assert.equal(g.by_group.rest.lines.length + g.by_group.b.lines.length, 0);
});
