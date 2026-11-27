// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// saved-register-pages.mjs — the goods statements on the register's own pages that the run's research saved.
//
// WHY. A search answer that did not ask for each goods statement whole holds a long one cut at 280 characters, and the
// register flags it (record-goods.mjs `rowGoods`). The run's research may already hold that record's own page on the
// register: the research server keeps every page a question fetched, one file a call, under `_driver/web-results/`
// (perplexity-server.mjs `keepRaw`). Nothing read those pages for goods, so a statement the run held whole was still
// read as cut. Measured 2026-11-03: a writer wrote a cited record's classes up as "cut and unread", after a research
// question of the same run had saved the register's own page for that record.
//
// WHAT IS READ, AND NOTHING ELSE. A research question's file, named `<time>-<pid>-<N>.json`, where N is the number of
// the research server's call; the pages that question fetched (`fetch_url_results`), never a search's snippets; and
// USPTO's status page for one serial (`https://tsdr.uspto.gov/statusview/sn<serial>`), whose goods and services table
// gives each class's statement in its last column. The folder also holds files of other shapes (owner checks, meaning
// searches asked again), which are not a question's and are not read.
//
// A PAGE IS READ ONLY WHERE IT IS WHOLE. A fetch can stop part way down a page. A table row counts only where a bar
// opens and closes it, it has the header's number of cells, and its statement does not end in an ellipsis; a page
// fetched without the table gives nothing. Any doubt reads as no page, and the statement stays as the search answer
// gave it, cut or not established whole.
//
// A pure leaf: node:fs, node:path, run-record.mjs and research-records.mjs only, so the goods reader and the band tool
// server can both import it.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { paths, readJson } from "./run-record.mjs";
import { researchResult, researchResultCall } from "./research-records.mjs";   // one reading of a kept research result

// USPTO's status page for one serial. Its other pages (the documents, the search) carry no goods table.
const STATUS_PAGE = /^https?:\/\/tsdr\.uspto\.gov\/statusview\/sn(\d+)\/?(?:[?#].*)?$/i;

// A markdown table row's cells, or null where no bar closes the row. A bar inside a cell is written `\|`, and any
// punctuation a page's text carries may be written with a backslash before it; the cell reads as the page wrote it.
const cellsOf = (line) => {
  if (!line.startsWith("|") || !line.endsWith("|") || line.endsWith("\\|") || line.length < 2) return null;
  return line.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\([!-/:-@[-`{-~])/g, "$1"));
};
// The first cell names the class, "042 - Primary Class" for class 42, as record-goods.mjs `niceClass` reads one.
const classOf = (cell) => {
  const m = /^0*(\d{1,2})(?!\d)/.exec(cell);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= 45 ? String(n) : "";
};
const CUT_MARK = /(?:\.\.\.|…)$/;

/**
 * The statements of a status page's goods and services table, from the page as markdown: [{cls, text}], one per whole
 * row, in the page's order, or [] where the page holds no such table. The table is the first under a "Goods and
 * services" heading, before the next heading, whose header begins with the international class and ends with the
 * goods and services. PURE.
 */
export function statusPageGoods(markdown) {   // @internal — driven by its test
  const lines = String(markdown ?? "").split(/\r?\n/).map((l) => l.trim());
  for (let at = 0; at < lines.length; at++) {
    if (!/^#{1,6}\s*goods and services\s*#*$/i.test(lines[at])) continue;
    let i = at + 1;
    while (i < lines.length && !lines[i].startsWith("|") && !lines[i].startsWith("#")) i++;
    const table = [];
    while (i < lines.length && lines[i].startsWith("|")) table.push(lines[i++]);
    const head = table.length > 2 ? cellsOf(table[0]) : null;
    const rule = head ? cellsOf(table[1]) : null;
    if (!head || head.length < 2 || !/^international class/i.test(head[0]) || !/^goods and services$/i.test(head.at(-1))
      || rule?.length !== head.length || !rule.every((c) => /^:?-+:?$/.test(c))) continue;
    const out = [];
    for (const line of table.slice(2)) {
      const cells = cellsOf(line);
      if (cells?.length !== head.length) continue;
      const cls = classOf(cells[0]), text = cells.at(-1);
      if (cls && text && !CUT_MARK.test(text)) out.push({ cls, text });
    }
    if (out.length) return out;
  }
  return [];
}

/** The status pages one saved research result fetched, each with its goods table: [{serial, goods}]. A grid's result, a result that cannot be read and a page without the table give none. PURE. */
export function statusPagesIn(result) {   // @internal — driven by its test
  const read = researchResult(result);
  if (!read.known || read.kind !== "question") return [];
  const out = [];
  for (const page of read.pages) {
    const serial = STATUS_PAGE.exec(page.url)?.[1];
    const goods = serial ? statusPageGoods(page.text) : [];
    if (goods.length) out.push({ serial, goods });
  }
  return out;
}

/**
 * A reader of the status pages the run's research saved. Each call returns Map(serial → [{question, goods}]) from the
 * folder as it stands, the pages in the order they were saved. A file is read once, as the research server writes each
 * once; a file that will not parse, as one still being written will not, is read again on the next call. The map's
 * `unreadable` property counts the research results that parsed but could not be read (research-records.mjs): they give
 * no page, and they are not results that fetched none. IMPURE.
 */
export function savedStatusPages(runDir) {
  const none = () => { const m = new Map(); Object.defineProperty(m, "unreadable", { value: 0, enumerable: false }); return m; };
  if (!runDir) return none;
  const dir = paths(runDir).webResults;
  const read = new Map();
  return () => {
    let names = [];
    try { names = readdirSync(dir).filter((n) => researchResultCall(n) != null).sort(); } catch { names = []; }
    const pages = new Map();
    let unreadable = 0;
    for (const name of names) {
      if (!read.has(name)) {
        let result; try { result = readJson(join(dir, name)); } catch { continue; }
        read.set(name, { known: researchResult(result).known, found: statusPagesIn(result) });
      }
      const { known, found } = read.get(name);
      if (!known) unreadable++;
      for (const { serial, goods } of found) {
        if (!pages.has(serial)) pages.set(serial, []);
        pages.get(serial).push({ question: researchResultCall(name), goods });
      }
    }
    Object.defineProperty(pages, "unreadable", { value: unreadable, enumerable: false });
    return pages;
  };
}

/** The USPTO serial a band row names, where the row is a record of the US office that carries one; "" otherwise. PURE. */
export const usSerialOf = (row) => (String(row?.raw?.office_code ?? "").trim().toUpperCase() === "US"
  ? String(row?.raw?.application_number ?? "").replace(/\D/g, "") : "");

const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The register's own statement for one class of a US record: {text, question} from the first page saved for the serial
 * whose statement for the class begins with the copy the search answer gave, or null. The copy is compared without its
 * case or its spacing, and without an ellipsis it ends in; a statement that does not begin with it is another text,
 * and is not used. PURE.
 */
export function savedPageStatement(pages, serial, cls, copy) {
  const start = flat(String(copy ?? "").trim().replace(CUT_MARK, ""));
  if (!start || !serial || !cls) return null;
  for (const { question, goods } of pages?.get?.(serial) ?? []) {
    const hit = goods.find((g) => g.cls === cls && flat(g.text).startsWith(start));
    if (hit) return { text: hit.text, question };
  }
  return null;
}
