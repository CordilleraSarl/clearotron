// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The "What was searched" sheet is written in the reader's words, not the engine's.
//
// THE DEFECT, as a mechanism. The sheet's Result and Note cells carry the search log's own prose, which is
// model-authored and already written on every archived run. The workbook's build check scans every cell
// against BANNED, but only as advice: the file is written first and the hits are logged, because a check
// that withholds the workbook is worse than the word. So on this sheet nothing stood between the engine's
// vocabulary and a delivery surface a reviewing lawyer opens.
//
// The repair is at the cell, as the row is written. That is why these tests read the DELIVERED file
// rather than the violation list, and why one of them starts from an audit record already on disk — the
// file a republish reads. Each distinction the repair draws has its own test: a query recorded as never
// run must still read as not searched after its words change; a name that carries one of the words is
// left as written; and the search term, which is what was searched, is never rewritten.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { buildAudit, searchRows, BANNED } from "../publish/xlsx.mjs";
import { parseAudit } from "../publish/parse.mjs";

const dir = mkdtempSync(join(tmpdir(), "audit-reader-words-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const REG = (search_term, result, notes) => ({ source_layer: "Register", search_term, result, notes });
const contract = { findings: [], coverage: [], fetchState: {}, verdict: { tier: "Manageable" }, jurisdiction: "Switzerland (register) + common-law" };
const fm = { title: "NORTHWIND", matter: "reader-words", classes: "9", overall_label: "Manageable" };

// The rows are the shapes the search log really carries: a register spine's model-authored prose, and a
// common-law gap whose platform was recorded as a web address.
const DELIVERED = [
  REG("NORTHWIND (exact)", "no hits — clean", "served from the cache; record at https://register.example/mark/ch/1100011"),
  REG("NORTHWIND (phonetic)", "provider-rejected (HTTP 429) on the first attempt; 0 hits on the second", "lint flagged the composite score of the two passes"),
  REG("NORTHWIND (translated)", "pending", "receipt deferred, never a negative"),
  REG("NORTHWIND (sparse)", null, null),
  { source_layer: "Common-law", search_term: "NORTHWIND", platform: "https://www.etsy.com", result: "provider 503", notes: "could not be searched", not_searched: "yes" },
];

async function sheetRows(book) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(book);
  const ws = wb.getWorksheet("What was searched");
  assert.ok(ws, "the workbook has a What was searched sheet");
  const cols = {};
  ws.getRow(1).eachCell((c, n) => { cols[String(c.value)] = n; });
  for (const k of ["Search term / variant", "Result", "Outcome", "Note"]) assert.ok(cols[k], `the sheet has a ${k} column`);
  const text = (row, k) => {
    const v = row.getCell(cols[k]).value;
    return v && typeof v === "object" ? String(v.text ?? v.hyperlink ?? (v.richText || []).map((r) => r.text).join("")) : String(v ?? "");
  };
  const rows = [];
  ws.eachRow((row, rn) => { if (rn > 1) rows.push(Object.fromEntries(["Search term / variant", "Result", "Outcome", "Note"].map((k) => [k, text(row, k)]))); });
  return rows;
}

let built, delivered;
before(async () => {
  built = await buildAudit(contract, { findings: [], audit: [], negatives: DELIVERED }, join(dir, "book.xlsx"), fm.title, fm);
  delivered = await sheetRows(join(dir, "book.xlsx"));
});
const row = (term) => delivered.find((r) => r["Search term / variant"] === term);

test("the delivered workbook carries no engine word in a Result or Note cell", () => {
  // THE FLOOR: every row written reached the sheet, so "no word found" cannot mean "no row read" — and the
  // sparse row, with neither a result nor a note, is among them: the repair cannot cost a run its workbook.
  for (const n of DELIVERED) assert.ok(row(n.search_term), `the row for ${n.search_term} is on the delivered sheet`);
  for (const r of delivered) for (const k of ["Result", "Note"]) {
    assert.doesNotMatch(r[k], BANNED, `${k} of "${r["Search term / variant"]}" still says an engine word: ${r[k]}`);
  }
  // The words were put right, not deleted: what the search log said is still there to read.
  assert.equal(row("NORTHWIND (exact)").Note, "served from the stored copy; record at register.example/mark/ch/1100011",
    "a web address keeps its host and path; only the scheme goes");
  assert.equal(row("NORTHWIND (phonetic)").Result, "provider-rejected (429) on the first attempt; 0 hits on the second");
  assert.equal(row("NORTHWIND (phonetic)").Note, "check flagged the combined score of the two passes");
  assert.match(row("NORTHWIND").Note, /could not be searched \(www\.etsy\.com\)/, "a platform recorded as a web address keeps its host");
  // And the build check, which still runs, agrees: nothing on this sheet for it to report.
  const onSheet = built.gateViolations.filter((v) => /^banned vocab .* in What was searched\b/.test(v));
  assert.deepEqual(onSheet, [], `the build check still finds an engine word on the sheet: ${onSheet.join(" | ")}`);
});

test("a query the engine recorded as never run still reads as not searched once its words are changed", () => {
  const r = row("NORTHWIND (translated)");
  assert.equal(r.Note, "record deferred, never a negative",
    "the note's words were changed on this row — without that, the Outcome below proves nothing about the order");
  assert.equal(r.Outcome, "Open — not searched",
    "the row was classified from the changed words: 'record deferred' is not how the engine says a query never ran, "
    + "so a query that never ran became a claim about what it found");
});

test("a name that carries one of the words is left as written", () => {
  const [r] = searchRows({ negatives: [REG("NORTHWIND (owner)", "0 hits", "closest: COMPOSITE (cl. 9), owner Meter Group AG; no receipt on file")] }, { registerOnly: true })
    .filter((x) => !x._section);
  assert.match(r.Note, /^closest: COMPOSITE \(cl\. 9\), owner Meter Group AG;/,
    "a mark and an owner are what the search found, and a rewritten one misstates it");
  assert.match(r.Note, /no record on file$/, "while the engine's own word in the same cell is still put right");
});

test("the search term is what was searched, and is never rewritten", () => {
  const [r] = searchRows({ negatives: [REG("cache meter (exact)", "0 hits", "")] }, { registerOnly: true }).filter((x) => !x._section);
  assert.equal(r["Search term / variant"], "cache meter (exact)");
});

test("every word the banned list names is put into a plain word on this sheet", () => {
  // Read off the list itself, each optional trailing letter taken both ways, so a word added to the list
  // later arrives here without anybody remembering to add it.
  const inner = BANNED.source.match(/^\\b\((.*)\)\\b$/)?.[1];
  assert.ok(inner, `the banned list is no longer one \\b(…)\\b group, so its words cannot be read off it: ${BANNED.source}`);
  const forms = inner.split("|").flatMap((alt) => (/^\w+\?$/.test(alt) ? [alt.slice(0, -2), alt.slice(0, -1)] : [alt]));
  assert.ok(forms.length >= 11, `a floor on the words read off the list: ${forms.join(", ")}`);
  for (const w of forms) assert.match(w, BANNED, `"${w}" was read off the list, so it must itself be banned`);
  const rows = searchRows({ negatives: forms.map((w, i) => REG(`TERM ${i}`, `a ${w} here`, `the ${w} there`)) }, { registerOnly: true }).filter((x) => !x._section);
  assert.equal(rows.length, forms.length, "one row per word");
  rows.forEach((r, i) => {
    assert.doesNotMatch(r.Result, BANNED, `"${forms[i]}" survives in a Result: ${r.Result}`);
    assert.doesNotMatch(r.Note, BANNED, `"${forms[i]}" survives in a Note: ${r.Note}`);
  });
});

test("an audit record already on disk — the file a republish reads — is delivered in the reader's words", async () => {
  const md = join(dir, "audit.md");
  writeFileSync(md, [
    "# Findings", "",
    "# Negative Results", "",
    "## NR1",
    "- source_layer: Register",
    "- search_term: NORTHWIND",
    "- result: NOT SEARCHED — receipt `deferred`, never a negative",
    "- notes: served from the cache; see https://register.example/mark/ch/1100011",
    "",
  ].join("\n"));
  const parsed = parseAudit(md);
  assert.equal(parsed.negatives.length, 1, "the record parses to the one row written");
  const book = join(dir, "republished.xlsx");
  await buildAudit(contract, parsed, book, fm.title, fm);
  const r = (await sheetRows(book)).find((x) => x["Search term / variant"] === "NORTHWIND");
  assert.ok(r, "the row reached the delivered sheet");
  assert.equal(r.Result, "NOT SEARCHED — record `deferred`, never a negative");
  assert.equal(r.Note, "served from the stored copy; see register.example/mark/ch/1100011");
  assert.equal(r.Outcome, "Open — not searched");
});
