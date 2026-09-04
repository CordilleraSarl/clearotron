// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE SUMMARY'S BLOCK GRAMMAR — one definition, because it has four readers.
//
// Owner ruling 2026-08-31 (tracker issues 1934 and 2056): "keep the length, add the structure, so long
// as length is consistent more or less." The assess seat now writes sub-headers and bullets inside the
// summary it emits, and FOUR surfaces read that string back:
//
//   driver/publish/render-knockout.mjs   the per-mark report and the grouped HTML
//   driver/portal-report.mjs             batchSummaryOf, feeding the grouped page's summary route
//   portal-ui/src/contract/summaryBlocks.ts   the browser (a MIRROR — see the parity test)
//   report.md                            markdown, which needs no reader
//
// Authoring the grammar once per reader is this codebase's most productive defect: a dictated shape with
// more than one author drifts silently, because every copy still parses something. So the grammar is
// here and the renderers differ only in what they EMIT — an HTML string, a React element, a paragraph.
//
// THE GRAMMAR PARSES EVERY HEADING DEPTH. THE POLICY ON H1 LIVES ELSEWHERE, ON PURPOSE.
//
// `# ` opens a SECTION in report.md (parseSections splits on /^# /m, batchSummaryOf terminates on it),
// so a summary containing one truncates itself and takes the rest of the client's entry point with it.
// That is forbidden — by the writer doctrine, by verify-knockout's SUMMARY_SECTION_BREAK_RE, and by
// batchSummaryOf terminating before one can ever reach this parser.
//
// It is NOT forbidden here, and the difference matters. An earlier version of this file refused to
// parse `#{1}` at all, reasoning that an H1 is not a block. The consequence was that an H1 fell through
// every branch to the prose one and RENDERED AS THE LITERAL CHARACTERS `# Documents` on a client page —
// the renderer emitting punctuation as content, which is the defect this whole change exists to remove.
// A parser that refuses a shape does not make the shape not arrive; it makes it arrive unhandled.
//
// So: parse it, render it as a heading two levels down like any other, and let the three layers that
// own the policy keep it from ever being written. Defence in depth, and no surface ever prints a hash.

/** A line that opens a block rather than continuing prose: any ATX heading, or a `-`/`*` bullet. */
export const SUMMARY_BLOCK_LINE = /^[ \t]*(?:#{1,6}[ \t]|[-*][ \t])/m;

/** An H1 inside a summary — never a block, always a defect. See the header. */
export const SUMMARY_SECTION_BREAK = /^[ \t]*#[ \t]+\S/m;

/**
 * Parse ONE chunk (a run of lines between blank lines) into typed blocks. PURE.
 *
 * Returns `[{ kind: 'heading', level, text } | { kind: 'bullets', items } | { kind: 'para', text }]`.
 * `level` is the markdown depth as written (2 for `##`), left for the renderer to map onto its own
 * hierarchy — the report puts the summary under an <h1>, so it renders `##` well below one.
 *
 * A chunk with no block line returns exactly one `para` carrying the chunk verbatim, which is what lets
 * every caller keep its previous behaviour unchanged on a summary that has no structure in it.
 */
export function parseSummaryBlocks(chunk) {
  const out = [];
  let para = [];
  let bullets = [];
  const flushPara = () => { if (para.length) { out.push({ kind: 'para', text: para.join('\n') }); para = []; } };
  const flushBullets = () => { if (bullets.length) { out.push({ kind: 'bullets', items: bullets }); bullets = []; } };
  for (const line of String(chunk ?? '').split(/\r?\n/)) {
    const h = line.match(/^[ \t]*(#{1,6})[ \t]+(.*)$/);
    if (h) { flushPara(); flushBullets(); out.push({ kind: 'heading', level: h[1].length, text: h[2].trim() }); continue; }
    const b = line.match(/^[ \t]*[-*][ \t]+(.*)$/);
    if (b) { flushPara(); bullets.push(b[1].trim()); continue; }
    if (!line.trim()) { flushPara(); flushBullets(); continue; }
    flushBullets(); para.push(line);
  }
  flushPara(); flushBullets();
  return out;
}
