// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The owner table and the judges' tools, over an invented pile. Every name here is made up.
//
// Ported from the private bench's own tests of the order and the stand-in register (its
// `test/owner-table.test.mjs` and `test/stand-in-register.test.mjs`), because the table and the tools are
// ported from there: the arms that held the bench's behaviour hold the engine's. What changes is named at
// each arm — the engine reads a live run's pile, names `_records/` files its own way, fetches a body on
// open, and says "this search" where the bench said "saved run".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, cpSync, rmSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPile, recordFileName, webCells } from "../pile.mjs";
import { makeOwnerTools, OWNER_TOOLS, splitText, pack, appendRequestLog } from "../owner-tools.mjs";
import { buildOwnerTable, closenessOf, lettersAway, lineOf, LINE_COLUMNS, CLOSENESS, ownerKey } from "../owner-table.mjs";

const PILE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "owner-pile");

const treeHash = (dir) => {
  const h = createHash("sha256");
  const walk = (d) => readdirSync(d).sort().forEach((n) => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p); else { h.update(p.slice(dir.length)); h.update(readFileSync(p)); }
  });
  walk(dir);
  return h.digest("hex");
};
const tools = (opts = {}) => makeOwnerTools(loadPile(PILE), opts);

// ── the order ─────────────────────────────────────────────────────────────────────────────────────────

test("closeness is read off the mark's own text, then off the kind of question that brought it", () => {
  const step = (mark, exact = true, ordered = ["ZZ"]) => CLOSENESS[closenessOf(mark, ordered, exact)];
  assert.equal(step("ZZ"), "same");
  assert.equal(step("z.z."), "same");
  assert.equal(step("Z-Z"), "same");
  assert.equal(step("ZZ CUP"), "holds it as a word");
  assert.equal(step("The zz Cup"), "holds it as a word");
  assert.equal(step("ZZQ"), "another form, asked exactly");
  assert.equal(step("ZZQ", false), "loose match");
  assert.equal(step("BUZZ", false), "loose match");
  assert.equal(step("BLUE RIVER", true, ["Blue River"]), "same");
  assert.equal(step("BLUERIVER", true, ["Blue River"]), "same");
  assert.equal(step("Big Blue River Co", true, ["Blue River"]), "holds it as a word");
  assert.equal(step("Blue Wide River", true, ["Blue River"]), "another form, asked exactly");
});

test("letters away counts the letters added, dropped or changed", () => {
  assert.equal(lettersAway("ZZ", "zz"), 0);
  assert.equal(lettersAway("ZZQ", "ZZ"), 1);
  assert.equal(lettersAway("Z-Z Q!", "ZZ"), 1);
  assert.equal(lettersAway("QZ", "ZZ"), 1);
  assert.equal(lettersAway("ZZMARK", "ZZMORKS"), 2);
  assert.equal(lettersAway("", "ZZ"), 2);
});

test("the table holds every owner once and every record once", () => {
  const pile = loadPile(PILE);
  const table = buildOwnerTable(pile);
  assert.equal(table.rows.reduce((n, r) => n + r.records.length, 0), pile.records.length);
  assert.equal(new Set(table.rows.map((r) => r.key)).size, table.rows.length);
  assert.equal(table.summary.reduce((n, s) => n + s.owners, 0), table.rows.length);
});

test("a live record in the order's classes comes before closeness, and each owner is one line", () => {
  const pile = loadPile(PILE);
  const far = { id: "/mark/EE/0000-F1", mark: "ZZMARKS", owner: "Far Owner", ownerCountry: "EE", office: "EE", classes: [9], status: "REGISTERED", filed: "2015-01-01", registered: null, qids: [] };
  const wider = { ...pile, records: [...pile.records, far] };
  const order = buildOwnerTable(wider).rows.map((r) => r.row.owner);
  assert.equal(order.at(-1), "Owner Two GmbH", "the owner with nothing live in the order's classes is last, though its mark is the same");
  assert.equal(order.at(-2), "Far Owner", "a loose match holding a live record in the order's classes comes before it");
  const { call } = makeOwnerTools(wider);
  return call("owner_table", {}).then(({ result }) => {
    assert.equal(result.columns, LINE_COLUMNS);
    assert.equal(typeof result.owners[0], "string");
    assert.equal(result.owners[0].split(" | ").length, LINE_COLUMNS.split(" | ").length);
    assert.match(result.owners.at(-2), /^Far Owner \| EE \| loose match \| 1 \| 1, 1, 1 \| ZZMARKS \| 9 \| EE \| 2015$/);
    assert.equal(JSON.stringify(result).includes("keysShown"), false, "the keys shown ride beside the answer, never in it");
    assert.equal(result.keysShown.length, result.owners.length);
    assert.equal(lineOf({ owner: "A | B", countries: [], closeness: "same", letters_away: 0, records: 1, live: 1, live_in_the_order_classes: 1, marks: ["X|Y"], classes: [9], offices: ["AA"], filed: [2001, 2003] }), "A / B |  | same | 0 | 1, 1, 1 | X / Y | 9 | AA | 2001-2003");
  });
});

test("filters narrow the table, and a long table comes in pages that hold every owner once", async () => {
  const whole = tools();
  assert.equal((await whole.call("owner_table", { live_in_the_order_classes: true })).result.owners_after_filters, 3);
  assert.equal((await whole.call("owner_table", { office: "cc" })).result.owners_after_filters, 1);
  assert.equal((await whole.call("owner_table", { owner_contains: "late" })).result.owners_after_filters, 1);
  assert.equal((await whole.call("owner_table", { closeness: "loose match" })).result.owners_after_filters, 0);
  const small = tools({ answerChars: 300 });   // one line an owner is short: a page this small holds three
  const first = (await small.call("owner_table", {})).result;
  assert.ok(first.pages > 1);
  const seen = [];
  for (let page = 1; page <= first.pages; page++) seen.push(...(await small.call("owner_table", { page })).result.owners);
  assert.deepEqual(seen, (await whole.call("owner_table", {})).result.owners);
});

test("an owner's records are found under any spelling of its name, across every list", async () => {
  const { call } = tools();
  const byTableName = (await call("owner_records", { owner: "OWNER ONE" })).result;
  const byOtherSpelling = (await call("owner_records", { owner: "Owner One K.K." })).result;
  assert.deepEqual(byTableName.list.map((r) => r.record), ["/mark/AA/0000-A1", "/mark/BB/0000-B2"]);
  assert.deepEqual(byOtherSpelling.list, byTableName.list);
  assert.deepEqual(byTableName.names.sort(), ["OWNER ONE", "Owner One K.K."]);
  assert.equal((await call("owner_records", { owner: "lat" })).refused, true, "too short to search by");
  assert.equal((await call("owner_records", { owner: "late" })).result.records, 1);
  assert.match((await call("owner_records", { owner: "Owner" })).result.text, /owners hold/);
  assert.match((await call("owner_records", { owner: "Nobody At All" })).result.text, /No owner "Nobody At All" in this search/);
  assert.equal(ownerKey("Owner One K.K."), ownerKey("OWNER ONE"));
});

test("a record with no owner name is a row of its own, asked for by the name the table gives it", async () => {
  const pile = loadPile(PILE);
  const nameless = { ...pile, records: [...pile.records, { id: "/mark/DD/0000-N1", mark: "ZZMARK", owner: "", ownerCountry: "", office: "DD", classes: [9], status: "REGISTERED", filed: null, registered: null, qids: [] }] };
  const { call } = makeOwnerTools(nameless);
  const lines = (await call("owner_table", {})).result.owners;
  const line = lines.find((l) => l.startsWith("(no owner recorded)"));
  assert.match(line, /^\(no owner recorded\) \/mark\/DD\/0000-N1 \|/);
  assert.deepEqual((await call("owner_records", { owner: "(no owner recorded) /mark/DD/0000-N1" })).result.list.map((r) => r.record), ["/mark/DD/0000-N1"]);
});

// ── the pile and the tools ────────────────────────────────────────────────────────────────────────────

test("only the questions the run executed are held, under short ids", () => {
  const pile = loadPile(PILE);
  assert.deepEqual(pile.questions.map((q) => q.id), ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]);
  assert.ok(pile.questions.every((q) => !q.words.includes("ZZNEVER")));
});

test("a count is the register's own count, and contains is called contains", async () => {
  const { result } = await tools().call("register_questions", {});
  const byId = Object.fromEntries(result.questions.map((q) => [q.id, q]));
  assert.equal(byId.Q1.count, 3);
  assert.equal(byId.Q1.match, "exact");
  assert.equal(byId.Q2.count, 5000);
  assert.equal(byId.Q2.match, "contains");
  assert.equal(byId.Q2.listed, false);
  assert.match(byId.Q2.offices, /every office in the order's scope \(3\)/);
  assert.deepEqual(byId.Q3.count_per_word, { ZZMARC: 850, ZZMARQ: 50 });
  assert.equal(byId.Q4.narrows, "Q2");
  assert.equal(byId.Q4.goods, "invented goods words");
});

test("the engine's goods words, an array, read as the words they are", () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-pile-"));
  try {
    cpSync(PILE, dir, { recursive: true });
    const p = join(dir, "_driver", "register-plan.json");
    const plan = JSON.parse(readFileSync(p, "utf8"));
    plan.entries.find((e) => e.qid === "supp:primary-sweep:default:zzmark:goods").goods_text = ["invented goods", "invented words"];
    writeFileSync(p, JSON.stringify(plan));
    assert.equal(loadPile(dir).questionById.get("Q4").goods, "invented goods; invented words");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a list groups by owner across spellings, cuts a goods line at its limit, and filters never invent a record", async () => {
  const { call } = tools();
  const { result } = await call("register_list", { question: "Q1" });
  assert.equal(result.records_held, 3);
  assert.equal(result.owner_groups, 2);
  assert.equal(result.groups[0].records, 2);
  assert.deepEqual(result.groups[0].offices, ["AA", "BB"]);
  const rows = result.groups.flatMap((g) => g.list);
  const a1 = rows.find((r) => r.record === "/mark/AA/0000-A1");
  assert.equal(a1.goods_cut, true);
  assert.equal(a1.goods.length, 200);
  const b2 = rows.find((r) => r.record === "/mark/BB/0000-B2");
  assert.match(b2.goods, /invented goods/);
  assert.equal((await call("register_list", { question: "Q1", live_only: true })).result.records_after_filters, 2);
  assert.equal((await call("register_list", { question: "Q1", offices: ["cc"] })).result.records_after_filters, 1);
  assert.equal((await call("register_list", { question: "Q1", classes: [41] })).result.records_after_filters, 2);
});

test("a counted question is refused for listing, with its count, never answered as empty; a sample says it is one", async () => {
  const { call } = tools();
  const counted = await call("register_list", { question: "Q2" });
  assert.equal(counted.refused, true);
  assert.match(counted.result.text, /5000/);
  assert.match(counted.result.text, /this search holds none of them\. Nothing is known/);
  const empty = await call("register_list", { question: "Q4" });
  assert.equal(empty.refused, false);
  assert.deepEqual(empty.result.groups, []);
  const menu = (await call("register_questions", {})).result.questions.find((q) => q.id === "Q6");
  assert.match(menu.note, /This search holds a sample of 2/);
  const sample = (await call("register_list", { question: "Q6" })).result;
  assert.equal(sample.sample_only, true);
  assert.match(sample.note, /this search holds 2 of them and nothing is known about the rest/);
});

test("a question listed late, whose records never reached the merged pile, is still listed", async () => {
  const pile = loadPile(PILE);
  assert.equal(pile.pileSize, 3);
  assert.equal(pile.records.length, 6);
  const { result, refused } = await makeOwnerTools(pile).call("register_list", { question: "Q5" });
  assert.equal(refused, false);
  assert.equal(result.records_held, 1);
});

test("an opened record carries its goods in full and none of the engine's internals", async () => {
  const { call } = tools();
  const { result } = await call("register_open", { record: "/mark/AA/0000-A1" });
  assert.ok(result.goodsServices[0].description.length > 200);
  assert.equal(result._raw, undefined);
  assert.equal(result._provenance, undefined);
  assert.equal((await call("register_open", { record: "/mark/ZZ/none" })).refused, true);
  assert.match((await call("register_open", { record: "/mark/CC/0000-C3" })).result.text, /This search lists \/mark\/CC\/0000-C3 and holds no full record for it/);
});

test("a full record is found under the engine's file name, either case, and in the record log before assembly", () => {
  assert.equal(recordFileName("/mark/AA/0000-A1"), "AA-0000-A1.json");
  const pile = loadPile(PILE);
  assert.equal(pile.readFullRecord("/mark/AA/0000-S1").markText, "ZZMARK", "a lower-case file name is found too");
  const dir = mkdtempSync(join(tmpdir(), "owner-pile-"));
  try {
    cpSync(PILE, dir, { recursive: true });
    rmSync(join(dir, "_records"), { recursive: true, force: true });
    mkdirSync(join(dir, "_driver"), { recursive: true });
    const log = join(dir, "_driver", "register-record-bodies.jsonl");
    appendFileSync(log, `${JSON.stringify({ target: "/mark/AA/0000-A1", body: { markText: "an older body" } })}\n`);
    appendFileSync(log, `${JSON.stringify({ target: "/mark/aa/0000-a1", body: [{ markText: "ZZMARK", goodsServices: [] }] })}\n`);
    const fromLog = loadPile(dir);
    assert.equal(fromLog.readFullRecord("/mark/AA/0000-A1").markText, "ZZMARK", "the last row wins, and an array body is unwrapped");
    assert.equal(fromLog.readFullRecord("/mark/BB/0000-B2"), null, "not in the log: null, never a guess");
    appendFileSync(log, `${JSON.stringify({ target: "/mark/BB/0000-B2", body: { markText: "fetched since" } })}\n`);
    fromLog.refreshFullRecords();
    assert.equal(fromLog.readFullRecord("/mark/BB/0000-B2").markText, "fetched since", "a body written since is found after a refresh");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a body the run does not hold is fetched when a judge opens it, once, and never before", async () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-pile-"));
  try {
    cpSync(PILE, dir, { recursive: true });
    const asked = [];
    const log = join(dir, "_driver", "register-record-bodies.jsonl");
    const fetchRecord = async (id) => { asked.push(id); appendFileSync(log, `${JSON.stringify({ target: id, body: { markText: "fetched on open" } })}\n`); return { ok: true }; };
    const rows = [];
    const { call } = makeOwnerTools(loadPile(dir), { fetchRecord, log: (r) => rows.push(r) });
    await call("register_list", { question: "Q1" });
    assert.deepEqual(asked, [], "listing reads goods lines from what the run holds and fetches nothing");
    const first = await call("register_open", { record: "/mark/CC/0000-C3" });
    assert.equal(first.result.markText, "fetched on open");
    await call("register_open", { record: "/mark/CC/0000-C3" });
    assert.deepEqual(asked, ["/mark/CC/0000-C3"], "fetched once");
    assert.deepEqual(rows.at(-2).fetched, { ok: true }, "the log says the body was fetched");
    // a fetch that fails answers as the bench's tool did, and never throws
    const failing = makeOwnerTools(loadPile(PILE), { fetchRecord: async () => { throw new Error("no credentials"); } });
    const r = await failing.call("register_open", { record: "/mark/CC/0000-C3" });
    assert.equal(r.refused, true);
    assert.match(r.result.text, /holds no full record/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("web results join the saved ledgers, list what was searched, then the results of one search", async () => {
  const { call } = tools();
  const all = (await call("web_results", {})).result;
  assert.equal(all.cells, 2);
  const one = (await call("web_results", { word: "zzmark", place: "WEB" })).result;
  assert.equal(one.results[0].results[0].title, "An invented page");
  assert.equal((await call("web_results", { word: "ZZNONE" })).refused, true);
  const dir = mkdtempSync(join(tmpdir(), "owner-pile-"));
  try {
    cpSync(PILE, dir, { recursive: true });
    writeFileSync(join(dir, "common-law-grid.supp-closure.json"), JSON.stringify([{ cells: [{ term: "ZZMARK", platform: "web", status: "hit", candidates: [{ title: "Another invented page", url: "https://example.invalid/two" }, { title: "dup", url: "https://example.invalid/one" }] }] }]));
    const cells = webCells(dir);
    assert.equal(cells.length, 2, "a supplemental ledger's cell joins the canonical one");
    assert.deepEqual(cells.find((c) => c.place === "web").results.map((r) => r.url), ["https://example.invalid/one", "https://example.invalid/two"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a question the run never asked is refused and recorded; the request log names what was put in front of the judge", async () => {
  const rows = [];
  const { call } = tools({ log: (r) => rows.push(r) });
  assert.equal((await call("register_list", { question: "Q9" })).refused, true);
  const asked = await call("register_new_question", { words: ["ZZOTHER"], match: "exact", reason: "invented" });
  assert.equal(asked.refused, true);
  assert.match(asked.result.text, /This search never asked that/);
  await call("register_list", { question: "Q1" });
  await call("register_open", { record: "/mark/AA/0000-A1" });
  await call("owner_table", {});
  assert.deepEqual(rows[1].args.words, ["ZZOTHER"]);
  assert.equal(rows[2].shown.length, 3);
  assert.deepEqual(rows[3].shown, ["/mark/AA/0000-A1"]);
  assert.equal(rows[4].owner_keys_shown.length, 4, "every owner on the page, by the key the merge joins on");
});

test("a list or a record too long for one answer comes in pages or parts that together are the whole", async () => {
  const pile = loadPile(PILE);
  const whole = (await makeOwnerTools(pile).call("register_list", { question: "Q1" })).result;
  const every = whole.groups.flatMap((g) => g.list.map((r) => r.record)).sort();
  for (const answerChars of [800, 1200, 3000]) {
    const { call } = makeOwnerTools(pile, { answerChars });
    const first = await call("register_list", { question: "Q1" });
    const seen = [];
    for (let page = 1; page <= first.result.pages; page++) {
      const { result, text } = await call("register_list", { question: "Q1", page });
      assert.ok(text.length <= answerChars, `${text.length} characters at a limit of ${answerChars}`);
      seen.push(...result.groups.flatMap((g) => g.list.map((r) => r.record)));
    }
    assert.deepEqual(seen.sort(), every);
  }
  const onDisk = pile.readFullRecord("/mark/AA/0000-A1").goodsServices[0].description;
  const { call } = makeOwnerTools(pile, { answerChars: 400 });
  const first = (await call("register_open", { record: "/mark/AA/0000-A1" })).result;
  assert.ok(first.parts > 1);
  let read = "";
  for (let part = 1; part <= first.parts; part++) read += (await call("register_open", { record: "/mark/AA/0000-A1", part })).result.goodsServices.map((g) => g.description ?? "").join("");
  assert.equal(read, onDisk);
});

test("text is cut after a clause or a space, and items are packed in order", () => {
  const text = "alpha beta; gamma delta; epsilon zeta eta theta; iota";
  const pieces = splitText(text, 20);
  assert.ok(pieces.every((p) => p.length <= 20));
  assert.equal(pieces.join(""), text);
  const items = ["aaaa", "bbbb", "cccc", "d".repeat(40), "eeee"];
  assert.deepEqual(pack(items, 16).map((p) => p.length), [2, 1, 1, 1]);
  assert.deepEqual(pack([], 16), [[]]);
});

test("the tools read the run and write nothing into it but their request log", async () => {
  const dir = mkdtempSync(join(tmpdir(), "owner-pile-"));
  try {
    cpSync(PILE, dir, { recursive: true });
    const before = treeHash(dir);
    const logPath = join(dir, "..", `${dir.split("/").pop()}-requests.jsonl`);
    const { call } = makeOwnerTools(loadPile(dir), { log: (r) => appendRequestLog(logPath, r) });
    for (const t of OWNER_TOOLS) await call(t.name, t.name === "register_list" ? { question: "Q1" } : t.name === "register_open" ? { record: "/mark/AA/0000-A1" } : t.name === "owner_records" ? { owner: "OWNER ONE" } : t.name === "register_new_question" ? { words: ["x"], match: "exact", reason: "y" } : {});
    assert.equal(treeHash(dir), before);
    rmSync(logPath, { force: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
