// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SHAPE LISTS THE BAND IN THE LAWYER'S ORDER, ONE LINE PER MARK OF AN OWNER, AND COUNTS THE REST.
//
// The crowded-field method: identical marks for the client's goods; identical marks in the ordered
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

test("one record's group follows the ruled order, and goods the run does not hold pass the goods test", () => {
  assert.equal(recordGroup({ tier: "identical", live: true, inScope: true, hits: 1 }), "a", "identical, live in the ordered classes, for the goods: (a)");
  assert.equal(recordGroup({ tier: "identical", live: false, inScope: true, hits: 1 }), "b", "a dead identical mark in class is (b): a dead record's goods never put a mark in (a)");
  assert.equal(recordGroup({ tier: "identical", live: true, inScope: false, hits: 1, dominant: true }), "c", "out of class, its goods put it in (c) by the word it carries, never in (a)");
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
    rec("a1", "QZORVAK", "Alpha Ltd", ["9"]),                     // identical, live in class, for the goods → (a)
    rec("a2", "Plimbo", "Alpha Ltd", ["9"]),                      // the same owner's other mark: live, in class, for the goods → (d)
    rec("b1", "Qzorvak", "Beta GmbH", ["9"]),                     // identical, in class, goods unrelated → (b)
    rec("r1", "Drellux", "Delta AG", ["9"]),                      // in class, goods unrelated → the rest
  ];
  const goods = goodsReader({ a1: [{ classes: ["9"], text: "joysticks" }], a2: [{ classes: ["9"], text: "game controllers" }],
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
  assert.deepEqual(g.by_group.a.lines.map((l) => l.owner_name), ["Gamma SA", "Delta AG", "Beta GmbH"]);
  assert.deepEqual(g.by_group.a.lines.map((l) => l.goods_words), [["joysticks"], ["joysticks"], ["joysticks"]]);
  assert.ok(!g.by_group.a.lines.some((l) => ["Alpha Ltd", "Epsilon Oy"].includes(l.owner_name)),
    "goods held only out of class, or only on a dead record, never put a mark in (a)");
  assert.deepEqual(g.by_group.b.lines.map((l) => l.owner_name), ["Epsilon Oy"], "a dead identical mark in class is (b)");
});

test("a line the goods test placed while its records carry no goods on file is listed apart, and no other line is", () => {
  const records = [rec("u1", "QZORVAK", "Epsilon Oy", ["9"]), rec("u2", "QZORVAK", "Zeta BV", ["9"]), rec("u3", "Drellux", "Eta Kft", ["31"], { status: "expired" })];
  const g = bandGroups(records, { classify, inScope, goods: goodsReader({ u2: [{ classes: ["9"], text: "printers; ".repeat(40) }] }) });
  assert.deepEqual(g.no_goods.map((l) => l.owner_name), ["Epsilon Oy"], "identical, in class, and nothing on file to test its goods");
  assert.deepEqual(g.by_group.b.lines.map((l) => l.owner_name), ["Zeta BV"], "a long goods text is read whole: nothing is cut, it is simply not the client's goods");
  assert.deepEqual(g.by_group.rest.lines.map((l) => l.owner_name), ["Eta Kft"], "a dead mark with no goods is in the rest on what the line shows");
});

test("the readable section states each group's count in lines, carries goods words and only a (b) floor's goods text, and shows a crowded group by its first page", () => {
  const records = [];
  for (let i = 0; i < CROWDED_GROUP_RECORDS; i++) records.push(rec(`n${i}`, "Qzorvak", `Owner ${String(i).padStart(4, "0")} Ltd`, ["9"]));
  for (let i = 0; i < 7; i++) records.push(rec(`x${i}`, "QZORVAK", `Theta ${i} Ltd`, ["9"]));
  const goods = goodsReader(Object.fromEntries(records.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: r.owner_name.startsWith("Theta") ? "joysticks" : "printers" }]])));
  const { shape, md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 2,
    dominantTerm: "Qzorv", manifestDominant: "Qzorvak", markets: ["EU"], caps: { owners: 5 } });
  assert.equal(shape.groups.b.records, CROWDED_GROUP_RECORDS);
  assert.equal(shape.groups.b.list.length, CROWDED_GROUP_RECORDS, "the machine shape keeps every line");
  const section = md.slice(md.indexOf("## The band in the lawyer's order"), md.indexOf("### By Nice class"));
  assert.ok(section.includes("1,000 records in 1,000 lines from 1,000 owners. A thousand or more? The field is crowded. These are identical marks in the ordered classes whose goods name none of the client's product words. Read the first page, carry forward any line a lawyer would raise, and set the rest aside in this group's one row with the count: the client is told the field is crowded. The first 5 lines are below; page with band_lookup {\"group\":\"b\"} only where a line needs reading."), "the crowded sentence, in (b)'s own words");
  assert.equal((section.match(/\| Qzorvak \| Owner \d{4} Ltd \|/g) ?? []).length, 5, "the readable mirror shows (b)'s first page only");
  assert.equal((section.match(/\| QZORVAK \| Theta \d Ltd \|/g) ?? []).length, 7, "a group under a thousand is listed whole");
  assert.match(section, /7 records in 7 lines from 7 owners\./);
  assert.match(section, /\| QZORVAK \| Theta 0 Ltd \| 9 \| 1 of 1 \| EU \| 1 of 2: joysticks \| yes \| \/mark\/eu\/x0 \|/, "a line: classes, live of records, territories, the words matched, whether it is a floor");
  assert.equal((section.match(/ «printers» /g) ?? []).length, 5, "a floor line in (b) shows the goods the test read");
  assert.doesNotMatch(section.replace(/«[^»]*»/g, ""), /printers/, "no other goods text on a line");
  assert.match(section, /The client's markets: EU\./);
  assert.match(section, /Sorted on «Qzorv», the word the register's goods-narrowed search asked for \(the variants stage named «Qzorvak»\)\./);
  assert.match(section, /\*\*The rest: 0 records in 0 lines from 0 owners\*\* — every record in none of \(a\) to \(d\) above\. Write down what you set aside and why: one row, with this count\./);
  assert.ok(md.indexOf("**Floors: 1,007 records in 1,007 lines**") >= 0 && md.indexOf("**Floors:") < md.indexOf("## The band in the lawyer's order"), "the floors are counted above the band");
});

test("the served shape marks each floor on its line and lists none a second time; the data keeps every floor", () => {
  const records = [rec("f1", "QZORVAK", "Alpha Ltd", ["9"]), rec("f2", "QZORVAK", "Alpha Ltd", ["9"], { jurisdictions: ["CH"] }),
    rec("f3", "QZORVAK", "Beta GmbH", ["9"]), rec("n1", "Drellux", "Gamma SA", ["9"])];
  const goods = goodsReader({ f1: [{ classes: ["9"], text: "joysticks" }], f2: [{ classes: ["9"], text: "joysticks" }], f3: [{ classes: ["9"], text: "printers" }], n1: [{ classes: ["9"], text: "joysticks" }] });
  const { shape, md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 1 });
  assert.equal(shape.floors.in_class_identical_or_near.length, 3, "the shape's data keeps every floor record for the duty check");
  assert.ok(md.includes("**Floors: 3 records in 2 lines** — every live in-class identical or near-identical record, each marked on its line in the band below."));
  assert.ok(!md.includes("## Floors") && !md.includes("| mark | tier | target |"), "no per-record floors section");
  assert.match(md, /\| QZORVAK \| Alpha Ltd \| 9 \| 2 of 2 \| CH,EU \| 1 of 1: joysticks \| yes \| /, "Alpha's two floor records are one line, marked");
  assert.match(md, /\| QZORVAK \| Beta GmbH \| 9 \| 1 of 1 \| EU \| 0 of 1 «printers» \| yes \| /, "a floor in (b) is marked too, with the goods the test read");
  assert.match(md, /\| Drellux \| Gamma SA \| 9 \| 1 of 1 \| EU \| 1 of 1: joysticks \| no \| /, "a line holding no floor says so");
});

// The territory arms use expired identical marks, which sit in (b): a floor, live, is never cut by territory.
const lapsed = (id, owner, jurisdictions) => rec(id, "QZORVAK", owner, ["9"], { jurisdictions, status: "expired" });

test("the list holds every register that binds the order's territories; a line held only outside them goes to the rest", () => {
  const records = [
    lapsed("t1", "Alpha Ltd", "EM"),       // the EU register, spelt as one register writes it
    lapsed("t2", "Beta GmbH", "DE"),       // a member's national register binds inside an EU order
    lapsed("t3", "Gamma SA", "WO"),        // Madrid binds every ordered territory
    lapsed("t4", "Delta AG", []),          // a record naming no register stays in
    lapsed("t5", "Epsilon KK", "JP"),      // outside an EU and CH order
  ];
  const goods = goodsReader(Object.fromEntries(records.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: "joysticks" }]])));
  const g = bandGroups(records, { classify, inScope, goods, territories: ["EU", "CH"] });
  assert.deepEqual(g.by_group.b.lines.map((l) => l.owner_name).sort(), ["Alpha Ltd", "Beta GmbH", "Delta AG", "Gamma SA"]);
  assert.deepEqual(g.by_group.rest.lines.map((l) => [l.owner_name, l.outside]), [["Epsilon KK", true]]);
  assert.deepEqual(g.outside, { lines: 1, records: 1 });
  assert.deepEqual(bandGroups(records, { classify, inScope, goods }).by_group.b.lines.length, 5, "a worldwide order lists the world");
  const { shape, md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 1, territories: ["EU", "CH"] });
  assert.equal(shape.groups.rest.list[0].record_id, "/mark/eu/t5");
  assert.ok(md.includes("**The rest: 1 records in 1 lines from 1 owners, 1 lines of them held only outside the ordered territories** — every record in none of (a) to (d) above."));
});

test("a floor held only outside the order's territories is listed in (a) or (b), never counted in the rest", async () => {
  const { assertRestHoldsNoFloor } = await import("../band-shape.mjs");
  const records = [rec("f1", "QZORVAK", "Zeta KK", ["9"], { jurisdictions: "JP" }), rec("f2", "QZORVAK", "Eta KK", ["9"], { jurisdictions: "JP" })];
  const goods = goodsReader({ f1: [{ classes: ["9"], text: "joysticks" }], f2: [{ classes: ["9"], text: "printers" }] });
  const g = bandGroups(records, { classify, inScope, goods, territories: ["EU"] });
  assert.deepEqual([g.by_group.a.lines.map((l) => l.owner_name), g.by_group.b.lines.map((l) => l.owner_name), g.by_group.rest.lines.length],
    [["Zeta KK"], ["Eta KK"], 0], "each floor is listed by its goods, with its territory on its line");
  assert.throws(() => assertRestHoldsNoFloor([{ key: "line:x", floors: 1, record_id: "/mark/jp/9" }]), /the rest holds a floor \(\/mark\/jp\/9\)/, "a rest holding a floor refuses the shape");
});

test("membership binds both ways: the EU register for a member's order, Benelux for its three, the International Bureau for any", () => {
  const goods = goodsReader({ m1: [{ classes: ["9"], text: "joysticks" }], m2: [{ classes: ["9"], text: "joysticks" }], m3: [{ classes: ["9"], text: "joysticks" }], m4: [{ classes: ["9"], text: "joysticks" }] });
  const recs = [lapsed("m1", "Alpha Ltd", "EM"), lapsed("m2", "Beta BV", "BX"), lapsed("m3", "Gamma SA", "IB"), lapsed("m4", "Delta Inc", "US")];
  const inDE = bandGroups(recs, { classify, inScope, goods, territories: ["DE"] });
  assert.deepEqual(inDE.by_group.b.lines.map((l) => l.owner_name).sort(), ["Alpha Ltd", "Gamma SA"], "an EU mark and an international one bind Germany");
  const inNL = bandGroups(recs, { classify, inScope, goods, territories: ["NL"] });
  assert.ok(inNL.by_group.b.lines.some((l) => l.owner_name === "Beta BV"), "Benelux is the Netherlands' national register");
});

test("Benelux binds its three and sits in the EU; a register is read by its code field or its name, never by other keys", () => {
  const goods = goodsReader(Object.fromEntries(["n1", "n2", "n3", "n4", "n5"].map((k) => [k, [{ classes: ["9"], text: "joysticks" }]])));
  const recs = [lapsed("n1", "Alpha BV", "NL"), lapsed("n2", "Beta SA", "EM"), lapsed("n3", "Gamma Ltd", [{ name: "Gamma", type: "word" }]),
    lapsed("n4", "Delta Co", "CHINA"), lapsed("n5", "Eta Inc", { US: "registered" })];
  const listed = (ts) => bandGroups(recs, { classify, inScope, goods, territories: ts }).by_group.b.lines.map((l) => l.owner_name).sort();
  assert.ok(listed(["NL"]).includes("Alpha BV"), "a record coded NL is inside an NL order");
  assert.ok(listed(["EU"]).includes("Alpha BV"), "and inside an EU order");
  assert.ok(listed(["BX"]).includes("Beta SA"), "the EU register binds a Benelux order");
  assert.ok(listed(["JP"]).includes("Gamma Ltd"), "an object with no code field gives no code, so the record stays in");
  assert.ok(listed(["CN"]).includes("Delta Co"), "a register written as a name reads as its code");
  assert.ok(listed(["CH"]).includes("Eta Inc"), "a map is not read as codes: the record stays in");
});

test("class 09 is class 9, in the scope and the floors", () => {
  const goods = goodsReader({ z1: [{ classes: ["9"], text: "joysticks" }] });
  const { shape } = buildBandShape({ enumerated: [rec("z1", "QZORVAK", "Alpha Ltd", ["09"])] }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 1 });
  assert.equal(shape.floors.in_class_identical_or_near.length, 1, "a live identical mark in class 09 is a floor of a class-9 order");
  assert.deepEqual(shape.groups.a.list.map((l) => l.classes), [["9"]]);
});

test("markets written as names read as codes, and a market of the EU holds a member's register", async () => {
  const { clientMarkets } = await import("../effective-scope.mjs");
  assert.ok(clientMarkets({ jurisdictions: ["Switzerland"], geography: { mode: "named" } }, null).includes("CH"));
  const goods = goodsReader({ k1: [{ classes: ["9"], text: "joysticks" }] });
  const g = bandGroups([rec("k1", "QZORVAK", "Alpha GmbH", ["9"], { jurisdictions: "DE" })], { classify, inScope, goods, markets: ["European Union"] });
  assert.deepEqual([g.markets, g.by_group.a.lines[0].in_market], [["EU"], true]);
});

test("an order written in names reads as its codes, and a register given as objects or a map is read", async () => {
  const { orderTerritories } = await import("../effective-scope.mjs");
  assert.deepEqual(orderTerritories({ jurisdictions: ["Switzerland"], geography: { mode: "named" } }, null), ["CH"]);
  const goods = goodsReader({ o1: [{ classes: ["9"], text: "joysticks" }], o2: [{ classes: ["9"], text: "joysticks" }], o3: [{ classes: ["9"], text: "joysticks" }] });
  const recs = [lapsed("o1", "Alpha Ltd", [{ jurisdiction: "CH", status: "registered" }]),
    lapsed("o2", "Beta AG", { CH: "registered", US: "pending" }),
    lapsed("o3", "Gamma SA", [{ unknown_shape: true }])];
  const g = bandGroups(recs, { classify, inScope, goods, territories: ["CH"] });
  assert.deepEqual(g.by_group.b.lines.map((l) => l.owner_name).sort(), ["Alpha Ltd", "Beta AG", "Gamma SA"], "a register it cannot read keeps the record in");
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
    assert.match(fallback.md, /No product words were given, so the goods test reads each record's goods for the words the register search was narrowed by: «computer peripherals», «joysticks»\. They include words other filings use for the same goods/);
    const none = shapeFor({});
    assert.equal(none.test.source, "none");
    assert.match(none.md, /No goods words were given, so no record was tested on its goods\./);
    assert.match(none.md, /\*\*Not tested on goods: 1 records in 1 lines from 1 owners\.\*\* No goods words were given/, "with no words the line is listed apart for that reason, not for goods the record lacks");
    assert.doesNotMatch(none.md, /No goods on file/);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("a goods word is never the start of a longer one, so cards and carpets do not join a group for cars", () => {
  // The build audit's probe: 600 identical live marks for car navigation, 450 for smart cards and carpet cleaning.
  const recs = Array.from({ length: 1050 }, (_, i) => rec(`v${i}`, "QZORVAK", `Owner ${i} Ltd`, ["9"]));
  const text = Object.fromEntries(recs.map((r, i) => [r.record_id, i < 600 ? "car navigation apparatus" : "smart cards; carpets cleaning machines"]));
  const goods = { of: (r) => [{ classes: ["9"], text: text[r.record_id] }], hits: goodsWordCounter(["car"], { stems: true }), matched: goodsWordsMatched(["car"], { stems: true }) };
  const g = bandGroups(recs, { classify, inScope, goods });
  assert.deepEqual([g.by_group.a.records, g.by_group.b.records], [600, 450]);
});

test("the lines the goods test could not place are read by the size rule, paged like a group, and say whether goods are on file", () => {
  const bodies = { u1: [{ classes: ["9"], text: "Videospiele", en: false }] };
  const goods = { of: (r) => bodies[r.record_id.split("/").pop()] ?? null, hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const small = buildBandShape({ enumerated: [rec("u1", "QZORVAK", "Alpha GmbH", ["9"]), rec("u2", "QZORVAK", "Beta Ltd", ["9"])] },
    { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 1, goodsTest: { source: "product_words", words: ["joysticks"] } }).md;
  assert.ok(small.includes("**Goods the test could not read: 2 records in 2 lines from 2 owners.** Fifty? Read them all."));
  assert.ok(small.includes("Each line takes its own fate by name; no group row covers these lines."));
  assert.ok(small.includes("Place each floor here, or set it aside by name; a goods ground needs the floor's goods read in full. Any other line here may be set aside because its goods are unknown."));
  assert.match(small, /\| QZORVAK \| Alpha GmbH \| 9 \| 1 of 1 \| EU \| on file, not readable \| yes \| /);
  assert.match(small, /\| QZORVAK \| Beta Ltd \| 9 \| 1 of 1 \| EU \| no goods on file \| yes \| /);
  const many = Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(`m${i}`, "QZORVAK", `Owner ${i} Ltd`, ["9"]));
  const crowded = buildBandShape({ enumerated: many }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 1, caps: { owners: 5 },
    goodsTest: { source: "product_words", words: ["joysticks"] } });
  assert.ok(crowded.md.includes("A thousand or more? The first 5 lines are below, the floors first, then the live ones in the ordered classes. Carry forward any line a lawyer would raise, and set the rest aside in this list's one row with the count, on the ground that their goods are unreadable and the field is crowded. This row never covers a floor. Place each floor here, or set it aside by name; a goods ground needs the floor's goods read in full. Where more floors are counted than this page shows, page the rest with band_lookup {\"group\":\"no_goods\"}; they come first."));
  assert.equal((crowded.md.match(/\| no goods on file \| yes \|/g) ?? []).length, 5, "a crowded list shows its first page");
});

test("(c) names the word it holds, a fused word reaches it, and (a) past fifty lines is read whole", () => {
  const recs = [rec("w1", "PREQZORVAK", "Alpha Ltd", ["9"]), ...Array.from({ length: 51 }, (_, i) => rec(`z${i}`, "QZORVAK", `Owner ${i} Ltd`, ["9"]))];
  const goods = goodsReader(Object.fromEntries(recs.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: "joysticks" }]])));
  const g = bandGroups(recs, { classify, inScope, goods, dominantTerm: "Qzorvak" });
  assert.deepEqual(g.by_group.c.lines.map((l) => l.mark), ["PREQZORVAK"], "the dominant word fused into a longer word reaches (c)");
  const { md } = buildBandShape({ enumerated: recs }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 2, dominantTerm: "Qzorvak" });
  assert.ok(md.includes("### (c) The same family as the mark, or carrying «Qzorvak», for the client's goods"));
  assert.ok(md.includes("51 records in 51 lines from 51 owners. These are the identical and near-identical marks live in the ordered classes for the client's goods: read every line."));
  assert.doesNotMatch(md.slice(md.indexOf("### (a)"), md.indexOf("### (b)")), /read the near ones first/);
});

test("a crowded (c) says what it holds in the ruled words", () => {
  const recs = Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(`f${i}`, "PREQZORVAK", `Owner ${i} Ltd`, ["9"]));
  const goods = goodsReader(Object.fromEntries(recs.map((r) => [r.record_id.split("/").pop(), [{ classes: ["9"], text: "joysticks" }]])));
  const { shape, md } = buildBandShape({ enumerated: recs }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 2, dominantTerm: "Qzorvak", caps: { owners: 5 } });
  assert.equal(shape.groups.c.records, CROWDED_GROUP_RECORDS, "guard: (c) is crowded");
  assert.ok(md.includes("A thousand or more? The field is crowded. These are marks of the same family as the mark, or carrying the searched word, for the client's goods. Read the first page, carry forward any line a lawyer would raise, and set the rest aside in this group's one row with the count: the client is told the field is crowded."));
});

test("a floor held outside the order says so on its line, an unread order territory is reported, and a no-goods line shows a record on file", () => {
  const outside = bandGroups([rec("o1", "QZORVAK", "Zeta KK", ["9"], { jurisdictions: "JP" })], { classify, inScope,
    goods: goodsReader({ o1: [{ classes: ["9"], text: "joysticks" }] }), territories: ["EU"] });
  assert.equal(outside.by_group.a.lines[0].outside, true);
  const { md } = buildBandShape({ enumerated: [rec("o1", "QZORVAK", "Zeta KK", ["9"], { jurisdictions: "JP" })] },
    { targets: ["Qzorvak"], inScopeClasses: ["9"], goods: goodsReader({ o1: [{ classes: ["9"], text: "joysticks" }] }), goodsWordCount: 2, territories: ["EU"] });
  assert.match(md, /\| QZORVAK \| Zeta KK \| 9 \| 1 of 1 \| JP \(outside the order\) \|/);
  const unread = buildBandShape({ enumerated: [lapsed("s1", "Beta AB", "SE")] }, { targets: ["Qzorvak"], inScopeClasses: ["9"],
    goods: goodsReader({ s1: [{ classes: ["9"], text: "joysticks" }] }), goodsWordCount: 2, territories: ["Atlantis", "CH"] });
  assert.ok(unread.md.includes("The order names «ATLANTIS», which the engine cannot read as a territory, so the list holds every register."));
  assert.deepEqual([unread.shape.groups.b.lines, unread.shape.groups.rest.lines], [1, 0], "a Swedish record is not cut on an order the engine cannot read");
  const bodies = { n1: null, n2: [{ classes: ["9"], text: "Videospiele", en: false }] };
  const ng = bandGroups([rec("n1", "QZORVAK", "Eta AG", ["9"]), rec("n2", "QZORVAK", "Eta AG", ["9"])], { classify, inScope,
    goods: { of: (r) => bodies[r.record_id.split("/").pop()] ?? null, hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) },
    keysOf: () => ({ line: "line:eta", owner: "owner:eta" }) });
  assert.deepEqual([ng.no_goods[0].record_id, ng.no_goods[0].goods_on_file], ["/mark/eu/n2", true], "the line shows the record band_record can open");
});

test("the lines the goods test could not place run floors first", () => {
  const recs = [rec("d1", "Drellux", "Alpha Ltd", ["9"]), rec("d2", "Drellux", "Beta Ltd", ["9"]), rec("f1", "QZORVAK", "Gamma Ltd", ["9"])];
  const g = bandGroups(recs, { classify, inScope, goods: { of: () => null, hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) } });
  assert.deepEqual(g.no_goods.map((l) => [l.owner_name, l.floors > 0]), [["Gamma Ltd", true], ["Alpha Ltd", false], ["Beta Ltd", false]]);
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
