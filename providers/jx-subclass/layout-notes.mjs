// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// MinerU layout.json → 注 note items, in the tranche schema.
//
// The document interleaves group headers, goods lines and 注 blocks. Everything here is positional:
// a note belongs to the last group header above it, and an item runs until the next numbered item or
// the next structural line. Nothing is inferred from meaning.
//
// printed_page = page_idx + PAGE_OFFSET, checked against the page's own printed footer wherever the
// footer survived extraction — 126 of 129 pages carry one and every single one agrees.
import { readFileSync } from "node:fs";

// The offset between MinerU's 0-based page index and the printed page number depends on where the
// file was cut: +124 for the run over the second half, -25 for the run over the whole PDF. It is
// DERIVED from the pages' own printed footers and then checked against every one of them, because a
// hardcoded offset silently misfiles every citation when the next file is cut somewhere else.
export function pageOffset(layout) {
  const votes = new Map();
  for (const p of layout.pdf_info) {
    const ns = (p.discarded_blocks ?? []).flatMap(b => (b.lines ?? []).map(lineText))
      .map(s => s.trim()).filter(s => /^\d{1,3}$/.test(s)).map(Number);
    if (ns.length === 1) votes.set(ns[0] - p.page_idx, (votes.get(ns[0] - p.page_idx) ?? 0) + 1);
  }
  if (!votes.size) throw new Error("no page carries a printed footer — the offset cannot be derived, and must not be guessed");
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [offset, agreeing] = ranked[0];
  const dissenting = ranked.slice(1).reduce((a, [, n]) => a + n, 0);
  if (dissenting) throw new Error(`printed footers disagree on the offset: ${ranked.map(([o, n]) => `${o}x${n}`).join(" ")}`);
  return { offset, agreeing };
}

// 23 lines come back with a leading # — a mark the OCR reads off the page, not a heading. Left in
// place it hides a GROUP HEADER, and every note under that header is then filed against the group
// above it: wrong source_group, no error anywhere.
const lineText = (ln) => ln.spans.map(sp => sp.content ?? "").join("").replace(/^\s*[#＃]\s*/, "");

export function pageLines(layout, opts = {}) {
  const out = [];
  const offset = opts.offset ?? pageOffset(layout).offset;
  for (const p of [...layout.pdf_info].sort((a, b) => a.page_idx - b.page_idx)) {
    const printed = p.page_idx + offset;
    const stamped = (p.discarded_blocks ?? []).flatMap(b => (b.lines ?? []).map(lineText))
      .map(s => s.trim()).filter(s => /^\d{1,3}$/.test(s)).map(Number);
    if (stamped.length === 1 && stamped[0] !== printed)
      throw new Error(`page_idx ${p.page_idx}: footer says printed ${stamped[0]}, offset says ${printed}`);
    const blocks = [...(p.para_blocks ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const b of blocks) {
      if (b.type === "image") continue;                 // the glyph that marks each 注 block, carrying no text
      for (const ln of (b.lines ?? [])) {
        const s = lineText(ln).trim();
        if (s) out.push({ printed, text: s, type: b.type });
      }
    }
  }
  return out;
}

const CLASS_TITLE = /^第[一二三四五六七八九十]+类$/;
// A group header is four digits then a TITLE. The rest must not start with a digit: a goods list
// wrapping onto "290102，烹调用番茄汁290110…" begins with a 6-digit basic number, and reading its first
// four as a header silently refiled every note below it under group 2901.
const GROUP_HEAD  = /^(\d{4})[ 　]*([^\d].*)$/;
const NOTE_START  = /^注\s*[：:]/;
const PART_MARK   = /^（[一二三四五六七八九十]+）/;
const BASIC_NO    = /\d{6}|[CＣ]\s?\d{6}/;              // goods lines carry basic numbers; 注 text never does

const isStructure = (s) =>
  CLASS_TITLE.test(s) || PART_MARK.test(s) || s.startsWith("※") || BASIC_NO.test(s) ||
  (GROUP_HEAD.test(s) && +s.slice(0, 2) >= 1 && +s.slice(0, 2) <= 45 && !/^\d{4}[，,、]/.test(s));

// A wrapped line can begin with a digit ("0115类似；"), so an item number counts only when it is the
// one expected next. Guessing from the digit alone splits one relation into two half-relations.
const itemStart = (s, expect) => {
  const m = /^(\d{1,2})\s*[.．、]\s*/.exec(s);
  return m && +m[1] === expect ? m[0].length : 0;
};

export function extractNotes(layout, opts = {}) {
  const lines = pageLines(layout, opts);
  const notes = [];
  let group = null, klass = null, cur = null, expect = 1, numbered = false;
  const close = () => { if (cur && cur.text.trim()) notes.push(cur); cur = null; };

  for (const { printed, text } of lines) {
    const s = text.replace(/\s+/g, "");
    if (CLASS_TITLE.test(s)) { close(); klass = s; group = null; continue; }

    if (NOTE_START.test(s)) {
      close();
      let body = s.replace(NOTE_START, "");
      const n = itemStart(body, 1);
      numbered = n > 0; expect = numbered ? 2 : 1;
      cur = { source_group: group ?? klass, printed_page: printed, note_number: numbered ? 1 : null, text: body.slice(n) };
      continue;
    }

    if (cur) {
      const n = itemStart(s, expect);
      if (n) { const g = cur.source_group; close(); cur = { source_group: g, printed_page: printed, note_number: expect, text: s.slice(n) }; expect++; continue; }
      if (!isStructure(s)) { cur.text += s; continue; }      // a wrap of the item in hand
      close();
    }

    const gm = GROUP_HEAD.exec(s);
    if (gm && +gm[1].slice(0, 2) >= 1 && +gm[1].slice(0, 2) <= 45 && !BASIC_NO.test(gm[1] + gm[2].slice(0, 1))) {
      group = gm[1];
    }
  }
  close();
  return notes;
}

export const loadLayout = (path) => JSON.parse(readFileSync(path, "utf8"));
