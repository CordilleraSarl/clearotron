// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE BAND CARRIES GOODS TEXT FOR THE ORDER'S CLASSES.
//
// The owner's ruling of 2026-11-17: the merged band keeps each record's goods text for the order's classes, and for
// every other class keeps the class number alone. The record says which classes' text was set aside, and why, so a
// class number is never silently all that is left. Live and dead records alike. Measured in testing the same day, on
// a 3,224-record band: goods text outside the order's three classes was 10.0 MB of the 25.7 MB left after the raw trim.
//
// Invented records only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mergeNamedBands, rowAsHanded, GOODS_SET_ASIDE_REASON } from "../named-band.mjs";
import { rowGoods, goodsWordCounter, goodsWordsMatched, goodsTestKey } from "../record-goods.mjs";
import { recordGoodsEvidence, goodsFromLabel } from "../goods-evidence.mjs";
import { bandClasses, namedBandText } from "../pipeline.mjs";
import { derivedLimitSec, stagesRefusingBand } from "../band-size.mjs";
import { STAGES } from "../stages.mjs";
import { buildBandShape, renderBandShapeMd, SAVED_GOODS_RESULT, FLOOR_QUOTE_OMITS } from "../band-shape.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { withFilingGoods } from "../filing-goods.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORDER = ["9", "41", "42"];
const statement = (cls, text) => ({ nice_class: cls, goods_services_text: text, goods_services_text_truncated: false, goods_services_language: "en", scope: null });

function row(i, { status = "Registered", classes = [9, 35, 41], text = (c) => `Goods and services of class ${c} for record ${i}.` } = {}) {
  return { record_id: `/mark/us/9${String(i).padStart(7, "0")}`, mark_text: `QUELVANO ${i}`, status, classes, nice_classes: classes,
    owner_name: "Halvorne Works", goods_whole: true, _qid: "primary-sweep:exact:quelvano", _query: "exact quelvano",
    raw: { office_code: "US", application_number: `9${i}`, classifications: classes.map((c) => statement(c, text(c))), derived: { tokens: "x".repeat(50) } } };
}

test("the order's class statements are kept byte for byte; another class keeps its number and the set-aside is recorded", () => {
  const r = row(1);
  const handed = rowAsHanded(r, { orderClasses: ORDER });
  const byClass = new Map(handed.raw.classifications.map((c) => [String(c.nice_class), c]));
  assert.deepEqual([...byClass.keys()], ["9", "35", "41"], "every class number is kept, in order");
  for (const c of ["9", "41"]) assert.deepEqual(byClass.get(c), r.raw.classifications.find((x) => String(x.nice_class) === c), `class ${c} is whole`);
  assert.equal(byClass.get("35").goods_services_text, undefined, "class 35 carries no text");
  assert.deepEqual(handed.goods_set_aside, { classes: [35], reason: GOODS_SET_ASIDE_REASON });
  assert.deepEqual(r.raw.classifications[1].goods_services_text, "Goods and services of class 35 for record 1.", "the input row is not changed");
  // A record wholly inside the order sets nothing aside, and says nothing.
  assert.equal(rowAsHanded(row(2, { classes: [9, 42] }), { orderClasses: ORDER }).goods_set_aside, undefined);
  // Without the order's classes, every statement is kept, as before the ruling.
  assert.deepEqual(rowAsHanded(r).raw.classifications, r.raw.classifications);
});

test("a dead record is treated as a live one", () => {
  const live = rowAsHanded(row(3), { orderClasses: ORDER });
  const dead = rowAsHanded(row(3, { status: "Expired" }), { orderClasses: ORDER });
  assert.deepEqual(dead.raw, live.raw);
  assert.deepEqual(dead.goods_set_aside, live.goods_set_aside);
});

test("the goods reader reads the order's statements and no others", () => {
  const goods = rowGoods(rowAsHanded(row(4), { orderClasses: ORDER }));
  const read = goods.filter((g) => !g.setAside), aside = goods.filter((g) => g.setAside);
  assert.deepEqual(read.map((g) => g.classes).flat().map(String).sort(), ["41", "9"], "the order's statements are read");
  assert.deepEqual(aside.map((g) => ({ classes: g.classes, text: g.text })), [{ classes: ["35"], text: "" }], "the set-aside class is there, marked, with no text");
  assert.ok(read.every((g) => !g.cut && !g.unknown), "a set-aside class makes no retained statement cut or unknown");
  assert.deepEqual(rowGoods(row(4)).map((g) => g.classes).flat().map(String).sort(), ["35", "41", "9"], "the whole row reads all three");
});

test("a band of the measured make-up passes dispatch, with the order's goods identical", () => {
  // 3,224 records. Per record, goods text in the order's classes and outside them in the measured proportion (6.1 MB
  // to 10.0 MB), the rest as the raw-trimmed band measured.
  const inside = "Downloadable software; computer games; education and entertainment services; ".repeat(24);
  const outside = "Retail store services featuring apparel, bags, beverages and household goods; ".repeat(39);
  const rows = Array.from({ length: 3224 }, (_, i) => row(i, { classes: [9, 35, 41, 43], text: (c) => (ORDER.includes(String(c)) ? inside : outside) }));
  const rawOnly = mergeNamedBands([{ enumerated: rows, crowds: [] }]);
  const ordered = mergeNamedBands([{ enumerated: rows, crowds: [] }], { orderClasses: ORDER });
  const [before, after] = [rawOnly, ordered].map((b) => Buffer.byteLength(namedBandText(b)));
  assert.ok(after < before);
  const base = (s) => STAGES[s]?.timeoutSec;
  assert.deepEqual(stagesRefusingBand(after, base), []);
  assert.ok(derivedLimitSec(base("placement-inquiry"), { bytes: after }).sec < derivedLimitSec(base("placement-inquiry"), { bytes: before }).sec);
  const orderStatements = (b) => JSON.stringify(b.enumerated.map((r) => r.raw.classifications.filter((c) => ORDER.includes(String(c.nice_class)))));
  assert.equal(orderStatements(ordered), orderStatements(rawOnly), "the order's class statements are byte-identical");
  assert.ok(ordered.enumerated.every((r) => r.goods_set_aside?.classes.join() === "35,43"), "each record records its set-aside");
});

// ── the served record says what was set aside ──────────────────────────────────────────────────────────────────────
async function lookup(runDir, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, "..", "engine", "mcp", "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: "clearotron-x-y-placement-inquiry", CLEAROTRON_GATHER_AGENT: "mailagent" } });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 15000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); resolve(m.result?.content?.[0]?.text ?? ""); } } catch { /* not a message */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "band_lookup", arguments: args } }) + "\n");
  });
}

test("the band tools serve each record's set-aside beside its goods", async () => {
  const band = mergeNamedBands([{ enumerated: [row(5)], crowds: [] }], { orderClasses: ORDER });
  const runDir = mkdtempSync(join(tmpdir(), "band-set-aside-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    writeFileSync(join(runDir, "register-named-band.json"), namedBandText(band));
    const { shape, md } = buildBandShape(band, { targets: ["QUELVANO"], inScopeClasses: ORDER });
    writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape, null, 2));
    writeFileSync(join(runDir, "band-shape.md"), md);
    const served = JSON.parse(await lookup(runDir, { record_id: band.enumerated[0].record_id }));
    assert.deepEqual(served.records[0].goods_set_aside, { classes: [35], reason: GOODS_SET_ASIDE_REASON });
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the band's classes are the band shape's: the instructed classes, with those the frame added", () => {
  const runDir = mkdtempSync(join(tmpdir(), "band-classes-"));
  try {
    assert.deepEqual(bandClasses({ job: { classes: [9, 41] }, profile: null, paths: { runDir } }), ["9", "41"]);
    assert.deepEqual(bandClasses({ job: {}, profile: { defaultClasses: [42] }, paths: { runDir } }), ["42"], "the profile's classes where the order names none");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

// ── Three states, never one: set aside, absent at source, a search never made ─────────────────────────────────────
test("a set-aside class is never read as no goods overlap: the test cannot tell, where it would have said no", () => {
  const words = goodsWordCounter(["apparel"]);
  const text = (c) => (String(c) === "35" ? "Retail store services featuring apparel." : "Downloadable software.");
  const whole = row(6, { text });
  const kept = rowAsHanded(whole, { orderClasses: ORDER });
  assert.equal(words(rowGoods(whole)), 1, "the whole row holds the word, in class 35");
  assert.equal(words(rowGoods(kept)), null, "with class 35 set aside, the test cannot tell: never 0");
  // A match in the order's classes is still a match, and a record with nothing set aside still says no.
  assert.equal(goodsWordCounter(["software"])(rowGoods(kept)), 1);
  const inside = rowAsHanded(row(7, { classes: [9, 41], text }), { orderClasses: ORDER });
  assert.equal(inside.goods_set_aside, undefined);
  assert.equal(words(rowGoods(inside)), 0, "nothing set aside, no word: the test says no, as before");
});

test("the goods evidence names the set-aside apart from a class the register lists without goods", () => {
  const goods = { of: (r) => rowGoods(r), held: () => false };   // the search answer's goods, as the band shape reads them
  const kept = rowAsHanded(row(8), { orderClasses: ORDER });
  const ev = recordGoodsEvidence(kept, { goods });
  assert.equal(ev.state, "set-aside");
  assert.deepEqual(ev.set_aside, ["35"]);
  assert.equal(goodsFromLabel(ev), "search answer; the goods text of class 35 is set aside, outside the order's classes");
  // A class the register itself listed with no goods text is not set aside: nothing is recorded for it, and the record
  // reads on what it holds.
  const empty = row(9, { text: (c) => (String(c) === "35" ? "" : "Downloadable software.") });
  const keptEmpty = rowAsHanded(empty, { orderClasses: ORDER });
  assert.equal(keptEmpty.goods_set_aside, undefined, "an empty statement is not set aside");
  assert.equal(recordGoodsEvidence(keptEmpty, { goods }).state, "complete");
  assert.equal(recordGoodsEvidence(keptEmpty, { goods }).set_aside, undefined);
});

async function bandRecord(runDir, uri) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, "..", "engine", "mcp", "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: "clearotron-x-y-placement-inquiry", CLEAROTRON_GATHER_AGENT: "mailagent" } });
    child.stdout.setEncoding("utf8");
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 15000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(timer); child.kill("SIGKILL"); resolve(m.result?.content?.[0]?.text ?? ""); } } catch { /* not a message */ }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "band_record", arguments: { record_id: uri } } }) + "\n");
  });
}

test("band_record serves a set-aside class as set aside, with no text, beside the order's statements", async () => {
  const band = mergeNamedBands([{ enumerated: [row(10)], crowds: [] }], { orderClasses: ORDER });
  const runDir = mkdtempSync(join(tmpdir(), "band-record-set-aside-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    writeFileSync(join(runDir, "register-named-band.json"), namedBandText(band));
    const served = await bandRecord(runDir, band.enumerated[0].record_id);
    const lines = served.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.class), ["9", "41", "35"]);
    assert.equal(lines.find((l) => l.class === "35").text, null);
    assert.match(lines.find((l) => l.class === "35").goods_from, /^set aside from this run's band, outside the order's classes/);
    assert.ok(lines.filter((l) => l.class !== "35").every((l) => l.text && l.goods_from === "search answer"));
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

// ── The shape's answer for set-aside wording is kept ─────────────────────────────────────────────────────────────
// Measured in testing, 2026-11-17: without it, the shape moved 119 lines of a 3,224-record band into the goods it could
// not read, where the whole wording had answered. The merge now saves the shape's own test's answer on the record's
// whole wording, and only a test on that same word list reads it.
const TEST = { words: ["apparel", "software"], stems: true };
const shapeTest = { hits: goodsWordCounter(TEST.words, { stems: true, setAsideTest: true }), matched: goodsWordsMatched(TEST.words, { stems: true, setAsideTest: true }) };
const outsideSays = (said, { cut = false, inside = "Courses in pottery." } = {}) => (r) => {
  const whole = row(r, { text: (c) => (String(c) === "35" ? said : inside) });
  if (cut) whole.raw.classifications = whole.raw.classifications.map((c) => (String(c.nice_class) === "35" ? { ...c, goods_services_text_truncated: true } : c));
  return whole;
};

test("the merge keeps the shape's answer on the record's whole wording, keyed to the shape's words", () => {
  const kept = rowAsHanded(outsideSays("Retail store services featuring apparel.")(20), { orderClasses: ORDER, goodsTest: TEST });
  assert.deepEqual(kept.goods_set_aside, { classes: [35], reason: GOODS_SET_ASIDE_REASON,
    test: { key: goodsTestKey(TEST.words, { stems: true }), matched: ["apparel"] } });
  assert.equal(kept.raw.classifications.find((c) => String(c.nice_class) === "35").goods_services_text, undefined, "the wording is still set aside");
  const none = rowAsHanded(outsideSays("Retail store services featuring hats.")(27), { orderClasses: ORDER, goodsTest: TEST });
  assert.deepEqual(none.goods_set_aside.test.matched, [], "whole wording with no word is a known zero");
  const cut = rowAsHanded(outsideSays("Retail store services featuring hats.", { cut: true })(21), { orderClasses: ORDER, goodsTest: TEST });
  assert.equal(cut.goods_set_aside.test.matched, null, "cut wording with no word is saved as cannot tell, never a known zero");
  // Without the shape's words, nothing is recorded, and the set-aside reads as before.
  assert.equal(rowAsHanded(outsideSays("Retail.")(22), { orderClasses: ORDER }).goods_set_aside.test, undefined);
});

test("the shape's test reads the recorded answer as it read the whole wording; any other list still cannot tell", () => {
  const cases = [["a word only in the set-aside class", outsideSays("Retail store services featuring apparel.")(23), 1],
    ["no word anywhere, the set-aside wording whole", outsideSays("Retail store services featuring hats.")(24), 0],
    ["no word anywhere, the set-aside wording cut", outsideSays("Retail store services featuring hats.", { cut: true })(25), null]];
  for (const [what, whole, want] of cases) {
    const kept = rowAsHanded(whole, { orderClasses: ORDER, goodsTest: TEST });
    assert.equal(shapeTest.hits(rowGoods(whole)), want, `${what}: the whole wording's answer`);
    assert.equal(shapeTest.hits(rowGoods(kept)), want, `${what}: the shape reads the same answer`);
    assert.deepEqual(shapeTest.matched(rowGoods(kept)), shapeTest.matched(rowGoods(whole)), `${what}: the same words`);
    // The lookup's own goods words, the same words without the recorded answer, or another list: never a no.
    assert.notEqual(goodsWordCounter(TEST.words, { stems: true })(rowGoods(kept)), 0, `${what}: a free-word test is never answered`);
    assert.notEqual(goodsWordCounter(["apparel"], { stems: true, setAsideTest: true })(rowGoods(kept)), 0, `${what}: another list is never answered`);
  }
  // A match in the order's own classes is in the saved answer beside the set-aside class's.
  const both = rowAsHanded(outsideSays("Retail store services featuring apparel.", { inside: "Downloadable software." })(26), { orderClasses: ORDER, goodsTest: TEST });
  assert.equal(shapeTest.hits(rowGoods(both)), 2);
  assert.deepEqual(shapeTest.matched(rowGoods(both)), ["apparel", "software"], "in the list's order");
});

// The test joins a record's statements before it matches, so a phrase can run from one statement into the next. The
// saved answer is the whole wording's, so a set-aside statement neither breaks such a match nor, by its absence, makes one.
test("a phrase across a set-aside statement's boundary is neither lost nor made", () => {
  const PHRASE = { words: ["mobile phone"], stems: true };
  const phraseTest = goodsWordCounter(PHRASE.words, { stems: true, setAsideTest: true });
  const retainedOnly = (goods) => goods.filter((g) => !g.setAside);
  const plain = goodsWordCounter(PHRASE.words, { stems: true });
  // LOST without the whole wording: the phrase runs from class 9 into the set-aside class 35.
  const across = row(60, { text: (c) => ({ 9: "Cases for mobile", 35: "phone retail services", 41: "Courses in pottery." })[c] });
  assert.equal(plain(rowGoods(across)), 1, "premise: the whole wording matches across the boundary");
  const acrossKept = rowAsHanded(across, { orderClasses: ORDER, goodsTest: PHRASE });
  assert.equal(phraseTest(rowGoods(acrossKept)), 1, "the match across a retained and a set-aside statement is kept");
  assert.equal(plain(retainedOnly(rowGoods(acrossKept))), 0, "premise: the retained wording alone would lose it");
  // MADE without the whole wording: the set-aside class 35 sat between "mobile" and "phone".
  const between = row(61, { text: (c) => ({ 9: "Accessories for mobile", 35: "Retail of hats", 41: "phone training courses" })[c] });
  assert.equal(plain(rowGoods(between)), 0, "premise: the whole wording does not match");
  const betweenKept = rowAsHanded(between, { orderClasses: ORDER, goodsTest: PHRASE });
  assert.equal(plain(retainedOnly(rowGoods(betweenKept))), 1, "premise: the retained wording alone would make a match");
  assert.equal(phraseTest(rowGoods(betweenKept)), 0, "no match is made where the whole wording had none");
});

test("a floor's quoted goods say so where the quotation's source omits class descriptions", () => {
  const floorLine = (band, goods) => {
    const { shape } = buildBandShape(band, { targets: ["QUELVANO 50"], inScopeClasses: ORDER, goods,
      goodsTest: { source: "goods_words", words: TEST.words }, goodsWordCount: TEST.words.length });
    assert.equal(shape.groups.b.lines, 1, "premise: one floor line in (b)");
    return renderBandShapeMd(shape).split("\n").find((l) => l.includes("QUELVANO 50") && l.includes("«"));
  };
  const band = mergeNamedBands([{ enumerated: [outsideSays("Retail store services featuring hats.")(50)], crowds: [] }], { orderClasses: ORDER, goodsTest: TEST });
  const trimmed = floorLine(band, { of: (r) => rowGoods(r), held: () => false, ...shapeTest });
  assert.ok(trimmed.includes(`» ${FLOOR_QUOTE_OMITS}`), trimmed);
  // A record held whole is quoted as it stands, with no such words.
  const whole = rowGoods(outsideSays("Retail store services featuring hats.")(50));
  const held = floorLine(band, { of: () => whole, held: () => true, ...shapeTest });
  assert.ok(held.includes("«") && !held.includes(FLOOR_QUOTE_OMITS), held);
});

test("the shape groups each record as its whole wording would, and would not without the recorded answer", () => {
  const rows = [outsideSays("Retail store services featuring apparel.")(30), outsideSays("Retail store services featuring hats.")(31),
    outsideSays("Retail store services featuring hats.", { cut: true })(32), row(33, { classes: [9, 41] })];
  const groupsOf = (band) => {
    const goods = { of: (r) => rowGoods(r), held: () => false, ...shapeTest };
    const { shape } = buildBandShape(band, { targets: ["QUELVANO 30", "QUELVANO 31", "QUELVANO 32", "QUELVANO 33"], inScopeClasses: ORDER, goods,
      goodsTest: { source: "goods_words", words: TEST.words }, goodsWordCount: TEST.words.length });
    return Object.fromEntries(["a", "b", "c", "d", "rest", "no_goods"].map((g) => [g, (shape.groups[g]?.list ?? []).map((l) => [l.mark, l.goods_words])]));
  };
  const whole = groupsOf(mergeNamedBands([{ enumerated: rows, crowds: [] }]));
  assert.deepEqual(groupsOf(mergeNamedBands([{ enumerated: rows, crowds: [] }], { orderClasses: ORDER, goodsTest: TEST })), whole);
  assert.notDeepEqual(groupsOf(mergeNamedBands([{ enumerated: rows, crowds: [] }], { orderClasses: ORDER })), whole, "the case is not empty: without the answer, lines move");
});

test("a crowded group's first page is the page the whole wording gave, and the summary says what a saved result is", () => {
  // Over a thousand records in one group: the shape shows its first page only, so the order inside it decides which
  // lines are read. Three in five hold a word only in the set-aside class; of the rest, half hold none there, and half
  // hold none in wording the register cut.
  const rows = Array.from({ length: 1800 }, (_, i) => (i % 5 < 3 ? outsideSays("Retail store services featuring apparel.")(1000 + i)
    : outsideSays("Retail store services featuring hats.", { cut: i % 5 === 4 })(1000 + i)));
  const shapeOf = (band) => buildBandShape(band, { targets: ["QUELVANO"], inScopeClasses: ORDER, goods: { of: (r) => rowGoods(r), held: () => false, ...shapeTest },
    goodsTest: { source: "goods_words", words: TEST.words }, goodsWordCount: TEST.words.length });
  const whole = shapeOf(mergeNamedBands([{ enumerated: rows, crowds: [] }]));
  const saved = shapeOf(mergeNamedBands([{ enumerated: rows, crowds: [] }], { orderClasses: ORDER, goodsTest: TEST }));
  const unsaved = shapeOf(mergeNamedBands([{ enumerated: rows, crowds: [] }], { orderClasses: ORDER }));
  const crowded = ["a", "b", "c", "d", "no_goods"].filter((g) => whole.shape.groups[g].records >= whole.shape.groups.crowded_at);
  assert.ok(crowded.length, "the case is not empty: a group is crowded");
  const lists = (shape) => Object.fromEntries(["a", "b", "c", "d", "rest", "no_goods"].map((g) => [g, shape.groups[g].list.map((l) => [l.key, l.goods_words])]));
  assert.deepEqual(lists(saved.shape), lists(whole.shape), "every group, every line, in the same order");
  const SAID = `${SAVED_GOODS_RESULT}\n\n`;
  assert.ok(saved.md.includes(SAID), "the summary says what a saved result is");
  assert.ok(!whole.md.includes(SAVED_GOODS_RESULT) && !unsaved.md.includes(SAVED_GOODS_RESULT), "and says it only where one was saved");
  assert.equal(saved.md.replace(SAID, ""), whole.md, "the shape as rendered, first pages included, is the whole wording's");
  assert.notEqual(unsaved.md, whole.md, "without the saved result the shape differs");
});

test("a line the shape still cannot place says the retained wording does not settle the test", () => {
  const band = mergeNamedBands([{ enumerated: [outsideSays("Retail store services featuring hats.", { cut: true })(40)], crowds: [] }], { orderClasses: ORDER, goodsTest: TEST });
  const goods = { of: (r) => rowGoods(r), held: () => false, ...shapeTest };
  const evidence = recordGoodsEvidence(band.enumerated[0], { goods });
  assert.equal(evidence.state, "set-aside", "the goods evidence stays set aside");
  const { shape } = buildBandShape(band, { targets: ["QUELVANO 40"], inScopeClasses: ORDER, goods, evidenceOf: () => evidence,
    goodsTest: { source: "goods_words", words: TEST.words }, goodsWordCount: TEST.words.length });
  assert.equal(shape.groups.no_goods.lines, 1, "cut set-aside wording with no word stays unknown, never a known zero");
  assert.match(renderBandShapeMd(shape), /Some class descriptions were set aside; the retained wording does not settle the goods-word test\./);
});

test("the band tools read the recorded answer into goods_words and serve the set-aside as its classes and reason", async () => {
  const band = mergeNamedBands([{ enumerated: [outsideSays("Retail store services featuring apparel.")(34)], crowds: [] }], { orderClasses: ORDER, goodsTest: TEST });
  const runDir = mkdtempSync(join(tmpdir(), "band-set-aside-answer-"));
  try {
    mkdirSync(driverDir(runDir), { recursive: true });
    writeFileSync(join(runDir, "register-named-band.json"), namedBandText(band));
    const goods = { of: (r) => rowGoods(r), held: () => false, ...shapeTest };
    const { shape, md } = buildBandShape(band, { targets: ["QUELVANO 34"], inScopeClasses: ORDER, goods,
      goodsTest: { source: "goods_words", words: TEST.words }, goodsWordCount: TEST.words.length });
    writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape, null, 2));
    writeFileSync(join(runDir, "band-shape.md"), md);
    const served = JSON.parse(await lookup(runDir, { record_id: band.enumerated[0].record_id })).records[0];
    assert.deepEqual(served.goods_set_aside, { classes: [35], reason: GOODS_SET_ASIDE_REASON }, "the recorded answer is not served on its own");
    assert.equal(served.goods_words, "1 of 2: apparel");
    // The lookup's own goods filter does not read the recorded answer: a word no statement it holds contains still
    // keeps the record, which cannot be told apart from one whose set-aside wording holds it.
    const filtered = JSON.parse(await lookup(runDir, { goods: ["hats"] }));
    assert.equal(filtered.records.length, 1);
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

// The Knockout lane builds no merged band and reads no order classes: its filings take their goods from the record bodies
// the run holds, through filing-goods.mjs, which nothing here touches. A class outside a knockout's asked classes keeps its
// text there, and no filing reads as set aside.
test("a knockout filing keeps every class's goods text: the trim is the merged band's alone", () => {
  const run = mkdtempSync(join(tmpdir(), "knockout-goods-"));
  try {
    mkdirSync(driverDir(run), { recursive: true });
    const id = "/mark/us/invented7";
    const body = { uri: id, markVerbalElementText: "QUILLMERE", status: "Registered", goodsServices: [
      { classes: [9], language: "en", description: "downloadable mapping software" },
      { classes: [25], language: "en", description: "hiking boots; rain jackets" }] };
    writeFileSync(driverDir(run, "register-record-bodies.jsonl"),
      JSON.stringify({ ts: "2026-11-17T00:00:00.000Z", provider: "clarivate", target: id, body }) + "\n");
    const doc = { schema: 1, marks: [{ name: "QUILLMERE", records: [{ recordId: id, mark: "QUILLMERE", goods: null }] }] };
    const rec = withFilingGoods(doc, run).marks[0].records[0];
    assert.deepEqual(rec.goods, ["9: downloadable mapping software", "25: hiking boots; rain jackets"]);
    assert.equal(rec.goodsState, "complete");
    assert.equal(rec.goodsFrom, "official record");
  } finally { rmSync(run, { recursive: true, force: true }); }
});
