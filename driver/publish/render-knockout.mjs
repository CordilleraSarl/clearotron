// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/render-knockout.mjs — the KNOCKOUT report, rendered in the product's own design language.
//
// It replaces a Word table. The previous knockout report was a byte-faithful port of the interactive
// skill's `template-formatting.md`: `border:solid windowtext 1pt`, `padding:0cm 5.4pt`, Calibri 11pt,
// wrapped in a bare <div> with no <!DOCTYPE>, no <head>, and — the part that actually broke things — no
// <meta charset>. It rendered as a grey spreadsheet beside a clearance report, and its curly quotes and
// middots turned to mojibake wherever a reader's browser guessed latin-1.
//
// This module is a SIBLING of render.mjs, not an extension of it. It imports nothing from that file.
// render.mjs is hash-frozen (test/render-frozen.test.mjs), single-mark shaped, and built around a parsed
// report.md; a knockout is batch-shaped (`marks[]`, one row per name, no report.md at all). Grafting one
// into the other would be a large freeze break in exchange for no reuse.
//
// Visual consistency does not come from sharing the renderer. It comes from sharing the DESIGN SYSTEM,
// and that already lives in modules nothing has frozen: shared/brand.mjs owns the tokens, the dark
// blocks, the theme init and the lockup; templates/report.css owns the layout vocabulary. This file
// emits the same class names — .rep-stickyhead, .topbar, .wrap, .hero/.conf/.mark/.sub, .sec/.num/.note,
// .panel, footer — so the two reports track each other for free when either is restyled. The price is
// ~60 lines of duplicated document shell, and it is the right price: the alternative is exporting the
// shell out of the frozen file, which is a bigger break than the duplication saves.
//
// ONE report. There is no client variant and no internal variant, and that is
// still the rule — it is what removes the whole class of "the wrong link got sent".
//
// WHAT CHANGED, 2026-09-07 (ruling): the one report now CARRIES the reviewer's
// notes rather than routing them to the audit workbook alone. The earlier reading of "one report" was
// that internal working material is simply not part of it; the ruling is that there is one report and the
// person who ran Clearotron reads it, so holding material back "just adds confusion for where data is
// lost". Six notes written for the reviewing lawyer on a delivered run reached the spreadsheet and
// nothing else, which is the measurement behind the ruling.
//
// So: the notes render, LABELLED, in report.css's existing `.internal` purple convention (see
// reviewerNotesBlock) — never merged into the client-voiced body. The workbook keeps them as well; this
// added a surface and moved none. The model's `registerEstimate` is NOT covered by the ruling and stays
// off the page.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPORT_ROOT, REPORT_ROOT_DARK_EXPLICIT, THEME_INIT_EXPLICIT, themeButton,
  THEME_BTN_CSS, CHROME_CSS, FAVICON_LINK, logoLockup, BRAND, confPosture,
} from '../../shared/brand.mjs';
import { SUMMARY_BLOCK_LINE, parseSummaryBlocks } from '../../shared/summary-blocks.mjs';
import { COUNT_BASIS, COUNT_PREDICATES, countsForMark, countLine, variantFormsLine } from '../register-count.mjs';
import { RECORD_BASIS, recordsForMark, recordsLine } from '../register-records.mjs';
import { knockoutFindingViews, splitKnockoutNotes } from '../findings-model.mjs';
import { demoBannerHtml } from './render.mjs';   // — the SAME banner the clearance template renders, not a second wording
// — the two facts the register card is allowed to read off a raw record, and NEITHER is minted
// here. `makeClassifyStatus` and `isAllClass` are the screening lane's own, already shipped, already
// fail-open; re-deriving either in a renderer would be this file starting a second status vocabulary,
// which is the thing providers/_shared/screen.mjs exists to prevent.
import { makeClassifyStatus, isAllClass } from '../../providers/_shared/screen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escAttr = esc;
// Same doctrine as the old table: a model/research-derived URL becomes a link ONLY when it is http(s).
// esc() stops attribute breakout; it does not stop scheme smuggling (javascript:, data:).
const isHttpUrl = (u) => /^https?:\/\//i.test(String(u ?? '').trim());
// target="_blank" IS THE LINK WORKING AT ALL, not a preference about tabs.
//
// The portal serves this document in an iframe with NO allow-same-origin (Result.tsx), so the frame has
// a null origin. A targetless external anchor navigates THAT FRAME, and the evidence hosts a knockout
// cites — storefronts, register pages, marketplaces — answer a framed request with X-Frame-Options or a
// frame-ancestors CSP. The browser blocks the load and the frame keeps showing what it showed before, so
// on screen the click does NOTHING. Counsel reported exactly that on the 2026-08-11 run and it read as
// fake links; the receipts are the product's honesty, so a dead receipt is worse than no receipt.
//
// Measured on the BRIMSTONE fixture before the fix: 9 external evidence anchors, 9 of them targetless.
// render.mjs already emitted the full pair on every external anchor and its rendered fixtures carry
// none without it — this renderer was the one that never did.
//
// The sandbox already permits it: allow-popups allow-popups-to-escape-sandbox have been on that frame
// since the Result screen's first commit (3654a76), so the popup is not what was missing. `rel` stays
// beside it — noopener severs window.opener, noreferrer withholds the run's URL from the evidence host.
const linkOrText = (u) => (isHttpUrl(u) ? `<a href="${escAttr(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u));

// Minimal inline markdown, escaped FIRST. The old renderer ran esc() and nothing else, so a batch
// summary reading `BRIMSTONE rates **High (Classes 9, 28, 41)**.` rendered its asterisks verbatim —
// the model writes markdown because every other surface it feeds renders markdown.
export function inlineMd(s) {
  return esc(String(s ?? ''))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
}
// BLOCKS, NOT ONLY PARAGRAPHS.
//
// The writer emits sub-headers and bullets inside the summary now (ruling 2026-08-31: "keep the
// length, add the structure"). This function read exactly two shapes — a blank line as a paragraph
// break, a single newline as a wrap — so a `## CORAL FREEZE` line reached the client as those literal
// characters, and a `- point` list as one run of text with hyphens in it. The structure the ruling asks
// for would have rendered as punctuation.
//
// A CHUNK WITH NO BLOCK LINE TAKES THE ORIGINAL BRANCH, EXPRESSION FOR EXPRESSION. That is the whole
// compatibility argument and it is structural, not a promise: with no heading and no bullet anywhere in
// the string, every chunk falls to the same `<p>` map this function has always been, so an ARCHIVED run
// re-rendered by this build is byte-identical to the document it was delivered as. This renderer must
// never edit a delivered report — the same rule QUALIFIER_WORDS states further down this file.
//
// Depth is deliberate: `##` and `###` become <h4>/<h5>, never <h1>/<h2>. The summary sits under the
// report's own <h1>, and a heading that outranks its container reads as a second document.
/** One chunk that DOES carry a block line, laid out. The GRAMMAR is shared (see summary-blocks.mjs);
 *  this function owns only the HTML. PURE. */
function mdChunkBlocks(chunk) {
  return parseSummaryBlocks(chunk).map((b) => {
    if (b.kind === 'heading') { const lvl = Math.min(6, b.level + 2); return `<h${lvl} class="ko-sumh">${inlineMd(b.text)}</h${lvl}>`; }
    if (b.kind === 'bullets') return `<ul class="ko-bul ko-sumbul">${b.items.map((i) => `<li>${inlineMd(i)}</li>`).join('')}</ul>`;
    return `<p>${inlineMd(b.text).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export const mdParagraphs = (s) => String(s ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  .map((p) => (SUMMARY_BLOCK_LINE.test(p) ? mdChunkBlocks(p) : `<p>${inlineMd(p).replace(/\n/g, '<br>')}</p>`)).join('');

// Band tone → the report's risk ramp. The knockout page colours from the run's FROZEN framework, exactly
// as the old table did: the tone is the join, never the label, so a customer ladder ("Moderate") lands on
// the same ramp position as the house one ("Medium").
const STOP_VAR = ['--clear', '--low', '--med', '--high', '--severe'];
const STOP_BY_TONE = { minimal: 0, low: 1, medium: 2, high: 3, severe: 4 };
function bandStop(framework, band) {
  const tone = framework?.bands?.find((b) => String(b.label).toLowerCase() === String(band ?? '').trim().toLowerCase())?.tone;
  return STOP_VAR[STOP_BY_TONE[tone] ?? 2];
}

const DEGRADED_NOTE = 'Automated research for this name was unavailable — manual verification is recommended before relying on this rating.';

// THE QUALIFIER, IN WORDS. It rendered as a bare grey token under the band chip — `low`, no
// label, no border, nothing on the page saying what it qualified. A reader met one word of a private
// vocabulary and had to guess whether it described the risk, the confidence or the search.
//
// What it actually is: the closed SECOND axis (verify-knockout.mjs KNOCKOUT_RATING_QUALIFIERS, one
// word). The doctrine it encodes is that enforcer profiling "can cap a middle band at its '(low)'
// qualifier" — so it SOFTENS a band and never sharpens it, and the sentence that says so is the whole
// fix. Rendered in the same place, beside the chip it caps; nothing about the rating changes.
//
// An unrecognised word keeps its own text and gains the frame. The validator closes the set for a run
// published TODAY, and an archived run re-renders as what it was — dropping a word this build does not
// know would be a renderer editing a delivered rating.
const QUALIFIER_WORDS = Object.freeze({ low: 'at the low end of this band' });
function qualifierHtml(q) {
  const word = String(q ?? '').trim();
  if (!word) return '';
  const said = QUALIFIER_WORDS[word.toLowerCase()] ?? `${word} within this band`;
  return `<span class="ko-qual">${esc(said)}</span>`;
}

// The layout this report adds on top of report.css. Additive and `ko-`prefixed: report.css is shared with
// the frozen clearance renderer, and a selector that is inert there cannot regress it.
const KO_CSS = `
  .ko-glance{padding:6px 0 2px}
  /* — framework attribution, captioning the rows. Same gutter and hairline as.ko-row so it reads
     as the table's head, not a floating note. */
  .ko-legend{padding:11px 24px 12px;border-bottom:1px solid var(--line);font-size:11.5px;color:var(--faint)}
  .ko-row{display:grid;grid-template-columns:minmax(140px,.34fr) 1fr;gap:18px;align-items:start;
    padding:15px 24px;border-bottom:1px solid var(--line)}
  .ko-row:last-child{border-bottom:0}
  .ko-name{font-weight:800;font-size:17px;letter-spacing:-.01em;margin:0 0 7px;word-break:break-word}
  .ko-band{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    color:#fff;padding:4px 11px;border-radius:30px}
  .ko-qual{display:block;margin-top:5px;font-size:11.5px;color:var(--faint)}
  .ko-classes{font-size:12px;color:var(--faint);margin:6px 0 0}
  .ko-bul{margin:0;padding-left:18px;font-size:14px;color:var(--slate);line-height:1.6}
  /* / — the summary's own sub-headers and bullets. The summary is the report's entry point and
     the owner's complaint was that it read as one block; these are what make it scannable. Sized BELOW
     .ko-name so a sub-header inside the summary never competes with a mark's own name. */
  .ko-sumh{font-weight:800;font-size:13.5px;letter-spacing:.01em;margin:15px 0 6px;color:var(--slate)}
  .ko-sumh:first-child{margin-top:0}
  .ko-sumbul{margin:0 0 8px}
  .ko-bul li{margin:0 0 5px}
  .ko-bul li:last-child{margin-bottom:0}
  /* — one conflict, one block: the reference a reader carries to the workbook, the name, its band,
     the conclusion sentence, the ground under it, and the evidence it opens to. */
  /* ko-find is a LOCATOR now, not a look: the block wears .card as well and report.css draws it. The
     dashed rule and the top margin this used to carry would fight the card's own border and radius. */
  .ko-find.card{margin:14px 0 0}
  .ko-find.card:first-child{margin-top:0}
  .ko-findband{display:inline-block;font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
    color:#fff;padding:2px 8px;border-radius:30px;margin-left:7px;vertical-align:1px}
  .ko-findmeta{margin:0 0 5px;font-size:12px;color:var(--faint)}
  .ko-findnet{margin:0 0 5px;font-size:14px;color:var(--slate);line-height:1.6}
  .ko-findbasis{margin:0 0 5px;font-size:13.5px;color:var(--slate);line-height:1.6}
  .ko-findev{margin:0;font-size:12.5px;line-height:1.6;word-break:break-word}
  .ko-count{font-family:var(--mono);font-size:13px;color:var(--ink);margin:0}
  .ko-degraded{font-size:13px;color:var(--med-tx,#82550A);margin:8px 0 0;font-style:italic}
  /* The reviewer-notes legend. NOT .ko-legend — that name is taken by the framework attribution row
     above, and reusing it would restyle the caption. It names the purple convention report.css already
     draws for .internal, so the colour is stated once and never re-specified. */
  .ko-refnote{margin:0;padding:11px 24px 0;font-size:12px;color:#6a2b6e;font-style:italic}
  /* The notes sit inside a mark's column, so the shared .internal block's bullets keep the column's
     own list indent and do not fight the paragraph above them. */
  .ko-row .internal .ko-bul{margin:0 0 4px}
  .ko-row .internal .ko-bul:last-child{margin-bottom:0}
  .ko-counts table{width:100%;border-collapse:collapse;font-size:14px}
  .ko-counts th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);
    font-weight:700;padding:14px 24px 8px;border-bottom:1px solid var(--line)}
  .ko-counts td{padding:13px 24px;border-bottom:1px solid var(--line);vertical-align:top}
  .ko-counts tr:last-child td{border-bottom:0}
  .ko-counts td.num{font-family:var(--mono);font-size:15px;font-weight:600;color:var(--ink)}
  .ko-counts td.na{font-family:var(--mono);font-size:12.5px;color:var(--faint)}
  .ko-counts tr.ko-forms td{font-size:12px;color:var(--faint);line-height:1.55;padding:0 24px 13px;
    font-family:var(--mono);word-break:break-word}
  .ko-tier{font-size:13.5px;color:var(--slate);line-height:1.65;margin:0;padding:18px 24px}
  /* — the read, as structure. The chip and classes are the head; basis leads; factors are a tight
     list; the two qualifying blocks are visually distinct so a scan separates "why this band" from
     "what would move it"; the register line is code-owned and always last. */
  .ko-basisline{margin:0 0 8px;font-size:14.5px;color:var(--ink);line-height:1.5;font-weight:600}
  .ko-lbl{display:block;font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    color:var(--faint);margin:0 0 4px}
  .ko-counter{margin:10px 0 0;padding:9px 0 0;border-top:1px dashed var(--line)}
  .ko-mitig{margin:10px 0 0;padding:9px 12px;border-left:2px solid var(--line);background:var(--sunken,transparent)}
  .ko-mitig p{margin:0;font-size:13.5px;color:var(--slate);line-height:1.6}
  .ko-full{margin:10px 0 0;font-size:13px;color:var(--slate)}
  .ko-full summary{cursor:pointer;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:700}
  .ko-full ul{margin-top:7px}
  /* NOTHING IS DISCARDED — including on paper. A collapsed <details> prints collapsed, so a report
     saved to PDF would drop the narrative this block exists to preserve. The beforeprint handler below
     opens them; this hides the now-pointless toggle in print. */
  @media print{.ko-full summary{display:none}}
  /* THE LABELS THE READER ACTUALLY READS. ko-lbl above is 9.5px uppercase grey — the owner's
     "what holds what?" was asked of a label in that style, so a new word in the same style is the
     same defect with different letters. These are body size and body colour, and they carry the
     band's own word ("Why High"), which is what makes them answerable without a legend. */
  .ko-lbl2{display:block;font-size:14px;font-weight:700;color:var(--ink);margin:0 0 5px;letter-spacing:0}
  /* The card's fold. ko-full rides with it so openAll() and the beforeprint handler reach it —
     what folds on screen still prints, which is the rule this template already states for the
     narrative fold. ko-why carries only the spacing a card needs inside its own body. */
  .ko-why{margin:6px 0 5px}
  .ko-why summary{font-size:12px;text-transform:none;letter-spacing:0;color:var(--rose,var(--faint));font-weight:600}
  /* "About this request" — what was asked, and any flag on the asking. It sits in the hero because a
     mis-scoped request makes every number below it answer the wrong question. */
  .ko-req{margin:14px 0 0;padding:13px 16px;border:1px solid var(--line);border-radius:3px}
  .ko-req .ko-lbl2{margin-bottom:6px}
  .ko-req p{margin:0 0 6px;font-size:13.5px;color:var(--slate);line-height:1.6}
  .ko-req p:last-child{margin-bottom:0}
  .ko-reqflag{border-left:3px solid var(--rose,var(--line));padding-left:11px;margin-top:9px}
  /* THE PURPLE NOTES COME OFF THE EXPORT, exactly as the clearance page removes its internal notes
     ("Internal (review-only) notes are removed on export"). The knockout's export is window.print()
     via exportPDF(), so print is the whole export path and this rule is the whole strip. Without it
     a knockout PDF forwarded to a client carries the reviewing lawyer's notes. */
  @media print{.internal{display:none !important}}
  .ko-reg{margin:11px 0 0;padding:8px 0 0;border-top:1px solid var(--line);
    font-family:var(--mono);font-size:12px;color:var(--faint);line-height:1.5}
  .ko-filings{padding:14px 0 2px;border-bottom:1px solid var(--line)}
  .ko-filings:last-of-type{border-bottom:0}
  .ko-filings .ko-name{padding:0 24px}
  .ko-filings td{font-size:13px}
  .ko-basis{font-size:12.5px;color:var(--slate);line-height:1.6;margin:0;padding:15px 24px 17px;border-top:1px solid var(--line)}
  .ko-scope{font-size:13.5px;color:var(--slate);line-height:1.65;margin:0;padding:18px 24px}
  .ko-scope b{color:var(--ink)}
  /* A wide counts table must scroll inside its own panel, never push the page sideways. */
  .ko-scroll{overflow-x:auto}
  @media(max-width:700px){.ko-row{grid-template-columns:1fr;gap:10px}}
`;

const REPORT_BASE = REPORT_ROOT + '\n' + readFileSync(join(HERE, 'templates', 'report.css'), 'utf8');
// Print renders light whatever the toggle says — re-assert the light tokens under [data-theme=dark].
const PRINT_LIGHT = '\n@media print{' + REPORT_ROOT.replace(':root{', ':root[data-theme="dark"]{color-scheme:light;') + '}';

/** The batch's display title: the mark itself when a screen covered one name, else the count. */
function batchTitle(marks) {
  if (marks.length === 1) return marks[0].name ?? '';
  return `${marks.length} names`;
}

// Spine mapping (spec 2026-07-30 §3, charter ruling 1: renames ruled OK): the per-name verdict rows
// ARE the hero at this depth, so the old "01 Names at a glance" heading goes and the rows render
// UNNUMBERED straight under the hero. Counts + per-name reads merge into ONE numbered section named
// like the clearance spine ("On-field conflicts" — counts are the D2 form of "who is in the way"),
// and "Scope & method" takes the clearance Scope name. Same names, same order, fewer rows.
function glanceSection(marks, framework, registerCounts) {
  const rows = marks.map((m) => {
    const stop = bandStop(framework, m.rating);
    const counted = registerCounts ? countLine(countsForMark(registerCounts, m.name)) : null;
    return `<div class="ko-row">
      <div>
        <p class="ko-name">${esc(m.name)}</p>
        <span class="ko-band" style="background:var(${stop})">${esc(m.rating ?? '—')}</span>
        ${qualifierHtml(m.ratingQualifier)}
        ${m.classesSearched?.length ? `<p class="ko-classes">Classes ${esc(m.classesSearched.join(', '))}</p>` : ''}
      </div>
      <div>
        ${counted ? `<p class="ko-count">${esc(counted)}</p>` : ''}
        ${m.degraded ? `<p class="ko-degraded">${esc(DEGRADED_NOTE)}</p>` : ''}
      </div>
    </div>`;
  }).join('');
  // THE FRAMEWORK IS NAMED BESIDE THE CHIPS IT EXPLAINS. Every `.ko-band` chip below speaks one
  // word out of a framework's vocabulary, and that framework was named exactly once on this page: in the
  // footer, under everything it governs. This is ATTRIBUTION AND NOTHING ELSE — the same "Rated under
  // <name>" the footer prints, moved to where the words it licenses are actually read.
  //
  // NO LADDER HERE. Spelling the band scale out beside the chips would be new furniture on a client
  // deliverable, and a rung buys depth, never furniture. If the knockout reader needs the
  // scale, that is its own decision on its own merits, not a rider on this one.
  //
  // No framework ⇒ NOTHING. A run this render was given no manifest for gets no attribution invented for
  // it, and the chips still carry their own words.
  const legend = framework?.title
    ? `<div class="ko-legend">Rated under <span class="mono">${esc(framework.title)}</span></div>`
    : '';
  return `<div class="panel ko-glance">${legend}${rows}</div>`;
}

// Depth 2's numbers, as their own numbered section rather than one bullet among many. The customer
// bought this measurement; burying it in a table cell was the complaint that started this rebuild.
//
// THE SCOPE LEADS (owner correction, 2026-08-11). Class scoping is the sharper half of what counsel
// asked for — "identical mark + exact class searches, very narrow" — so the figure the reader meets
// first has to be the class-scoped one, with the fact that it IS class-scoped stated on the same row
// rather than inferred from the request. A row counted across all 45 classes says so in the same place,
// in the same words, because that number is bigger, more frightening and less useful than the honest one
// and must never be mistaken for a narrow search.
//
// There is ONE figure per predicate per row, at ONE scope, and the table says which. A second
// all-classes figure alongside a class-scoped one would be a second count — one more provider call per
// mark per predicate, billable on Corsearch — and that is a spend the owner has not ruled on. Raised as
// a follow-up rather than assumed here.
// ── TERRITORIES IN WORDS, NEVER CODES ───────────────────────────────────────────────────────────────
//
// The line read "territories: EM, US, WO". On a worldwide run the same line printed every register code
// the provider offers — roughly two hundred, AD through ZZ, internal groupings among them — which the
// owner called a meaningless list, correctly: a reader cannot tell anything from two hundred codes and
// cannot tell much from three.
//
// TWO CODES ARE REGISTERS RATHER THAN COUNTRIES and neither is an ISO region, so neither can be resolved
// by a country table: EM is the EU Intellectual Property Office and WO is WIPO's international register.
// They are named here because they are the two a reader meets constantly.
//
// A CODE THIS TABLE CANNOT NAME IS DROPPED, NOT PRINTED. The provider's internal groupings (XA, XG, XS,
// XW, ZZ and their like) name no register a reader could look up, and printing one is the defect this
// change exists to remove. Dropping them is safe because the COUNT of registers is stated separately and
// is taken before any naming — so a reader is never told about fewer registers than were counted.
// TWO FORMS PER REGISTER, because English needs both: "Counted in the United States" takes the article
// and "United States application" refuses it. One map with one form produced "the United States
// application (pending)" on a card, which is why they are separate fields rather than a regex over one.
const REGISTER_NAMES = Object.freeze({
  EM: { bare: 'European Union', phrase: 'the European Union' },
  EU: { bare: 'European Union', phrase: 'the European Union' },
  WO: { bare: 'international', phrase: 'the WIPO register' },
  US: { bare: 'United States', phrase: 'the United States' },
  GB: { bare: 'United Kingdom', phrase: 'the United Kingdom' },
  UK: { bare: 'United Kingdom', phrase: 'the United Kingdom' },
  CH: { bare: 'Swiss', phrase: 'Switzerland' },
});

/**
 * A register code as a reader's words, or '' when this build cannot name it. NEVER returns a code.
 * `bare: true` gives the attributive form for a phrase like "United States application".
 */
function territoryName(code, { bare = false } = {}) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return '';
  if (REGISTER_NAMES[c]) return bare ? REGISTER_NAMES[c].bare : REGISTER_NAMES[c].phrase;
  // The provider's internal groupings all sit in the X* and Z* space and name no lookup-able register.
  if (/^[XZ]/.test(c)) return '';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(c);
    // Intl hands the CODE back when it knows no region by that name — which would print exactly the
    // thing this function exists to prevent, so an unresolved code is an empty string.
    return name && name.toUpperCase() !== c ? name : '';
  } catch { return ''; }
}

/** "a, b and c" — the reader's list, not a join on commas. */
function listWords(items) {
  const xs = (items ?? []).filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * The counted scope, in one sentence. Three shapes, and the shape is chosen by
 * how many registers were counted rather than by which they were:
 *
 *   every register the provider offers  -> "Counted worldwide, 190 registers, on Clarivate Compumark."
 *   up to six                           -> named in full
 *   more than six, not all              -> the count, and where the list is
 *
 * The provider is named here and nowhere else on the page; 331 D takes the vendor's name off the cards.
 */
const TERRITORY_NAME_CAP = 6;
function territoriesLine(registerCounts) {
  const provider = registerCounts?.providerLabel ?? registerCounts?.provider ?? 'the register';
  const regions = (registerCounts?.scope?.regions ?? []).filter(Boolean);
  const worldwide = registerCounts?.scope?.worldwide === true || regions.length === 0;
  if (worldwide) {
    const n = regions.length;
    return n
      ? `Counted worldwide, ${n} registers, on ${provider}.`
      : `Counted worldwide on ${provider}.`;
  }
  const named = regions.map(territoryName).filter(Boolean);
  if (named.length && named.length <= TERRITORY_NAME_CAP) {
    return `Counted in ${listWords(named)}, on ${provider}.`;
  }
  return `Counted on ${regions.length} registers, listed on the workbook's Register Counts sheet, on ${provider}.`;
}

/** What the counts do and do not say — the one line that replaces the count-basis paragraph on the page. */
const COUNTS_READER_LINE = 'Counts include live, pending and dead filings. '
  + 'A count is not a conflict; the cards above say which filings matter.';

function countsSection(marks, registerCounts) {
  // ── THE DEFINITION MOVES INTO THE COLUMN HEADER ──────────────────────────────────────────────────
  //
  // The 70-word count-basis paragraph existed because three one-word headers — Identical, Containing,
  // Close variations — did not say what they counted, so the definition had to go somewhere. Put it in
  // the header and the paragraph has nothing left to do.
  //
  // ONE NAME ⇒ THE HEADER NAMES IT, because "Exactly ORBIT" needs no gloss at all. Several names share
  // one table and no header can name one of them, so they keep the general form and each row's own
  // forms line (already rendered, unchanged) carries that row's near-spellings.
  const single = marks.length === 1 ? String(marks[0]?.name ?? '').trim() : '';
  const forms = single
    ? ((countsForMark(registerCounts, single)?.counts?.close?.forms ?? []).map((f) => String(f?.form ?? '').trim()).filter(Boolean))
    : [];
  const headLabel = (pk) => {
    if (pk === 'identical') return single ? `Exactly ${single}` : 'Exactly the name';
    if (pk === 'containing') return single ? `Contains ${single}` : 'Contains the name';
    return forms.length ? `Near-spellings (${forms.join(', ')})` : 'Near-spellings';
  };
  const head = COUNT_PREDICATES.map((p) => `<th>${esc(headLabel(p.key))}</th>`).join('');
  const rows = marks.map((m) => {
    const e = countsForMark(registerCounts, m.name);
    const cells = COUNT_PREDICATES.map((p) => {
      const c = e?.counts?.[p.key];
      // "not available" is never a blank and never a 0 — both read as "none found", which is a finding.
      //
      // Three states, not two. A cell that is ABSENT is a different fact from one that failed: an
      // archived run re-rendering through today's renderer has no close-variation cell because the
      // column did not exist when it was counted, and "no count recorded" would read as a defect in a
      // report that has none. The hover says which.
      const why = c?.unavailable ?? (c
        ? 'no count recorded'
        : 'not counted on this run — it predates this column, and an archived report re-renders as what it was');
      return Number.isFinite(c?.total)
        ? `<td class="num">${esc(String(c.total))}</td>`
        : `<td class="na" title="${escAttr(why)}">not available</td>`;
    }).join('');
    const scoped = e?.classScope !== 'all-classes' && (e?.classes?.length > 0);
    const scope = scoped
      ? `classes ${e.classes.join(', ')}`
      : 'all classes — this run named none, so nothing narrowed the count';
    // The forms the close column was counted over. A number whose forms are not on the page cannot be
    // checked by the reader it was written for, which makes it a claim rather than a measurement.
    const forms = variantFormsLine(e);
    return `<tr><td><b>${esc(m.name)}</b><br><span class="ko-classes">${esc(scope)}</span></td>${cells}</tr>`
      + (forms ? `<tr class="ko-forms"><td colspan="${COUNT_PREDICATES.length + 1}">${esc(forms)}</td></tr>` : '');
  }).join('');
  // COUNT_BASIS IS OFF THE PAGE, NOT OUT OF THE RECORD. It is still written to
  // report-data.json (knockoutReportData -> registerCountBasis) and still on the workbook, which is where
  // 331 says it belongs; what it stops doing is printing twice on a page whose headers now say the same
  // thing in three words each.
  return `<div class="panel">
  <div class="ko-counts ko-scroll"><table><thead><tr><th>Name</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  <p class="ko-basis">${esc(COUNTS_READER_LINE)}<br>${esc(territoriesLine(registerCounts))}</p>
</div>`;
}

// The filings behind the narrow numbers, as a compact appendix under the counts.
//
// FIRST N ROWS, then the workbook. The full list is capped at 100 per name and a hundred rows of
// register data on a triage document would bury the page it is an appendix to; the workbook is where a
// reader who wants all of them goes, and the line says so with the real figures rather than "see the
// workbook".
//
// The three states are three states. Records ⇒ the table. An answered search that found nothing ⇒ the
// sentence saying so. A search that could not run ⇒ the sentence saying THAT, with the provider's own
// words — because "no filings found" and "we could not look" are the same shape on a page and only one
// of them is a finding. recordsLine owns all three wordings so the report, the workbook and
// report-data.json cannot phrase them differently.
/**
 * MATERIALITY, FOR BOTH REGISTER SURFACES.
 *
 * Two caps decide which filings a client sees — the appendix table and the promoted cards — and both
 * took the provider's arrival order. Measured on a delivered four-mark run: one name fetched 23 records,
 * the page printed the first 8, and the registration the reviewing lawyer built her only non-Manageable
 * band on sat at row 12. It reached no client-facing surface at all.
 *
 * WHAT THE ARRIVAL ORDER ALREADY CARRIES, because it is not nothing and a naive sort would destroy it.
 * register-records.mjs collects term by term at concurrency ONE, and listedTerms returns the name itself
 * before its close variations — so every identical-name filing already precedes every variation. That is
 * one of the three axes below, and it is why basis is an explicit key here rather than something left to
 * sort stability: sorting on status and class alone would lift a live in-class VARIATION above a live
 * in-class filing on the name itself, which is worse than what shipped.
 *
 * Within a term the order is the provider's, and carries no status or class signal. The other two axes
 * are genuinely absent, which is what this supplies.
 *
 * THE KEYS, in the order the issue states them:
 *   1. status        live before ambiguous before dead
 *   2. class overlap in an instructed class, before unstated, before outside
 *   3. basis         the name itself before a close variation
 *   4. arrival       and past those three there is no signal, so the provider order stands. Explicit
 *                    rather than leaning on Array.sort being stable — the tiebreak is a decision.
 *
 * STATUS COMES FROM THE SCREENING LANE'S OWN CLASSIFIER, not a fourth vocabulary. makeClassifyStatus
 * answers live/dead/AMBIGUOUS with the fail-open posture this lane requires: an unrecognised status word
 * is ambiguous, never dead, so a provider whose vocabulary this build does not know cannot have its
 * filings silently sunk. A dead-set derived from half that export used to sit here; this is one spelling.
 *
 * PRESENTATION ONLY. Nothing here changes which records are fetched, and nothing changes what
 * registerFilingsBasis says they are. It changes the order they are shown in.
 */
const classifyStatus = makeClassifyStatus();
const STATUS_ORDER = Object.freeze({ live: 0, ambiguous: 1, dead: 2 });

/** The classes a filing is judged against: what was searched for this mark, plus the entry's own. */
function classScope(entry, mark) {
  return new Set([...(mark?.classesSearched ?? []), ...(entry?.classes ?? [])]
    .map(Number).filter(Number.isInteger));
}

/** 0 in scope, 1 the register did not say, 2 outside. Silence never sinks a filing — the same rule
 *  promotableRecords applies when it decides whether to promote one at all. */
function classRank(r, scope) {
  if (!scope.size) return 0;
  const classes = (Array.isArray(r?.classes) ? r.classes : []).map(Number).filter(Number.isFinite);
  if (!classes.length) return 1;
  if (isAllClass(classes)) return 0;
  return classes.some((c) => scope.has(c)) ? 0 : 2;
}

/** Most material first. PURE, and it never drops a record — see filingsSection on why the appendix
 *  ranks but does not filter. */
/**
 * EVERY FILING THIS RUN ITSELF WEIGHED, by record id.
 *
 * Two fields carry that, and both are joined against the run's own record store by the driver before
 * they ever reach here, so this is a fact about what the rater used and not a word it typed:
 * `registerReads` (a filing weighed that did NOT become a finding) and each finding's `weighedFilings`
 * (the ids that finding's reasoning rests on). Read together because a reader does not care which
 * bucket a filing landed in — only that the run says it mattered.
 */
function weighedRecordIds(mark) {
  const out = new Set();
  for (const row of mark?.registerReads ?? []) if (row?.recordId) out.add(String(row.recordId));
  for (const f of mark?.findings ?? []) for (const id of f?.weighedFilings ?? []) if (id) out.add(String(id));
  return out;
}

/**
 * THE RUN'S OWN MATERIALITY LEADS, AND THE CAPTION SAYS SO.
 *
 * These three keys — live before dead, in-class before out, the name before its close variations — are
 * mechanical, and until now they were the whole of "most material first". They cannot see the one
 * judgement the report is actually about: which filing THIS RUN weighed and concluded bears on the
 * rating.
 *
 * MEASURED. On a delivered knockout the rater named a franchise owner's registration in the client's
 * own territory, in the classes being cleared, as supporting the material conflict — and it placed
 * outside the shown rows, because it scored no better than eight others on three keys that could not
 * see the assessment. The reader was shown that conflict as reputation only, while the paper right sat
 * below the fold of a table captioned "most material first".
 *
 * PROMOTED, NEVER FILTERED. The ruling on this appendix is that it ranks and does not filter: it is the
 * evidence behind a count, and a reader must be able to reconcile the two. Promotion keeps every row
 * and moves one up; dropping rows would break the reconciliation that rule exists for.
 *
 * AHEAD OF `s`, DELIBERATELY. A dead filing the rater weighed and wrote a read about is more material
 * TO THIS REPORT than a live one nobody looked at twice — that is what "weighed" means. The caption is
 * rewritten to state this order rather than the old one, because a caption describing a different sort
 * from the one that ran is the defect this issue is about, one layer up.
 */
export function rankByMateriality(records, entry, mark) {
  const scope = classScope(entry, mark);
  const weighed = weighedRecordIds(mark);
  return (Array.isArray(records) ? records : [])
    .map((r, i) => ({ r, i, w: weighed.has(String(r?.recordId)) ? 0 : 1,
      s: STATUS_ORDER[classifyStatus(r?.status)] ?? 1, c: classRank(r, scope),
      b: r?.matchedBasis === 'close' ? 1 : 0 }))
    .sort((a, b) => a.w - b.w || a.s - b.s || a.c - b.c || a.b - b.b || a.i - b.i)
    .map((x) => x.r);
}

const APPENDIX_ROWS = 8;
function filingsSection(marks, registerRecords) {
  // The provider refused the whole lane (clarivate's per-record bill). One sentence, once — not the
  // same refusal repeated under every mark.
  if (registerRecords.unavailable) {
    return `<div class="panel"><p class="ko-tier">${esc(registerRecords.unavailable)}</p></div>`;
  }
  const blocks = marks.map((m) => {
    const e = recordsForMark(registerRecords, m.name);
    const line = recordsLine(e);
    if (!e || !(e.records ?? []).length) {
      return `<div class="ko-row"><div><p class="ko-name">${esc(m.name)}</p></div>
        <div><p class="ko-bul">${esc(line ?? 'No filings listing was recorded for this name.')}</p></div></div>`;
    }
    // RANKED, AND DELIBERATELY NOT FILTERED. This table is the evidence behind a
    // COUNT: dropping a cancelled or out-of-class row would leave a reader unable to reconcile the table
    // with the number above it, and "we did not show you that one" is a different promise from "it is
    // not material". The cards promote and therefore filter; the appendix evidences and therefore ranks.
    const ranked = rankByMateriality(e.records, e, m);
    const shown = ranked.slice(0, APPENDIX_ROWS);
    const rows = shown.map((r) => `<tr>
      <td>${esc(r.mark ?? '—')}${r.matchedBasis === 'close' ? `<br><span class="ko-classes">found as ${esc(r.matchedForm)}</span>` : ''}</td>
      <td>${esc(r.owner ?? '—')}</td>
      <td>${esc(r.status ?? '—')}</td>
      <td>${esc((r.classes ?? []).join(', ') || '—')}</td>
      <td>${esc(r.territory ?? '—')}</td>
      <td class="ko-findev">${r.url ? linkOrText(r.url) : esc(r.recordId ?? '—')}</td>
    </tr>`).join('');
    // "First N" WAS TRUE AND IS NOT ANY MORE, and saying it of a ranked table would be worse than the
    // cap: it invites the reader to take the sample for the top of the provider's list. Say the count
    // that exists, say what decided the order, and say where the rest is.
    const more = e.records.length > shown.length
      ? ` Showing ${shown.length} of ${e.records.length}, most material first — the filings this`
        + ` assessment weighed before the rest, then live filings before dead,`
        + ` in the searched classes before outside them, the name itself before its close variations.`
        + ` The full list is in the audit workbook's Register Filings sheet.`
      : ' The same rows are in the audit workbook\'s Register Filings sheet, most material first.';
    return `<div class="ko-filings">
      <p class="ko-name">${esc(m.name)}</p>
      <div class="ko-counts ko-scroll"><table><thead><tr><th>Trademark</th><th>Owner</th><th>Status</th><th>Classes</th><th>Territory</th><th>Record</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="ko-basis">${esc(line ?? '')}${esc(more)}</p>
    </div>`;
  }).join('');
  return `<div class="panel ko-glance">${blocks}<p class="ko-basis">${esc(RECORD_BASIS)}</p></div>`;
}

// The tier-absence line ( part 2). A knockout whose product bought no register step used to render
// NOTHING about the registers — and silence on a page of numbers reads as an omission, not as a tier
// fact. It is what sent the 2026-08-08 report back: the reader could not tell "we did not sell you this"
// from "we ran it and found nothing".
//
// It survives for REPLAYS. Every knockout this build offers carries the counts, so a live run reaches
// the first arm below or none at all; an ARCHIVED run of a retired counts-free product re-renders
// through this same function and must still say which it was.
//
// Two different absences, two different sentences, and collapsing them would be the defect one layer up:
// a run whose product includes counts but whose count FAILED has not been told it is a lesser tier — it
// has a gap, and the reason for it is on the page beside the mark.
function tierAbsenceLine(registerCounts, probeRan) {
  if (registerCounts?.marks?.length) return null;
  return probeRan
    ? 'Register hit-counts are part of this search, and none could be taken on this run — the per-name reason is recorded in the audit workbook. This is a gap in this run, not a limit of the product.'
    : 'Register hit-counts (identical · containing · close variations) are not included in this product tier, so no register was counted for this report. They are part of the Knockout search this offering sells today.';
}

// ONE conflict, rendered from the typed record. The reference comes first because it is what a
// reader carries to the audit workbook; the band chip is the finding's OWN band, in the same ladder as
// the mark's — one rating vocabulary on one page.
//
// Every URL goes through linkOrText, which links http(s) only. That is not a duplicate of the receipts
// gate and must not be traded for it: the gate proves a URL was HELD, and a held URL can still carry a
// javascript: scheme. The renderer holds on its own.
// — `data-ko-mark` / `data-ko-ord` are the flag control's LOCATOR, and they are positions, never
// names. portal-report.mjs attaches its per-finding control to `.ko-find[data-ko-ord]`, and the pair
// resolves against report-data.json's `marks[<mark>].findings[]` — the same projection, in the same
// order, on both surfaces (`knockoutFindingViews` sorts identically for the render and for the data
// file). An ordinal ALONE cannot locate a knockout finding: restarts them at 1 per mark, so every
// mark in a batch has a finding 1, and a flag keyed on the ordinal would land on the first mark's.
//
// A NAME is deliberately not emitted here for the control to send. `ref` is right there and reads
// nicely, but portal-ui/src/contract/reportFrame.ts refuses a mark from the document side on purpose,
// and the composite key IS a mark name. The server reads `ref` back off disk once it has resolved.
/**
 * THE CARD'S DETAIL, FOLDED.
 *
 * Visible on a card: the reference, the name, the band chip, the source chip, the one-sentence read and
 * the evidence links. Folded: the paragraph that argues the band, and on a register card the use-check
 * line and the record link with it.
 *
 * WHY A FOLD AND NOT A CUT. The paragraph is the reasoning, and 331 rejects "shortening by dropping the
 * reasons" in as many words. It is one click away and it still prints — `ko-full` is on the element, so
 * openAll() and the beforeprint handler both reach it and a saved PDF carries the whole argument.
 *
 * EMPTY IN, EMPTY OUT. A card with no detail renders no fold rather than an empty one, which is also the
 * archived-run path: a run whose findings carry no `basis` renders exactly the card it was delivered.
 */
function whyBandFold(inner) {
  const body = String(inner ?? '').trim();
  if (!body) return '';
  return `<details class="ko-full ko-why"><summary>${esc(WHY_BAND_LABEL)}</summary>${body}</details>`;
}

/** The card fold's own word. Stated once so the renderer and its tests read the same string. */
const WHY_BAND_LABEL = 'Why this band';

function findingBlock(v, framework, markIndex) {
  const meta = [v.type, v.owner].filter(Boolean).map((s) => esc(s)).join(' · ');
  const ev = v.evidence.map((u) => linkOrText(u)).join(' · ');
  // THE CLEARANCE REPORT'S CARD, AND THE KNOCKOUT'S LOCATOR — both classes, deliberately. report.css
  // is already inlined here and already defines .card, .top, .rail, .cardhead,
  // .fnum and .who; this uses them rather than a parallel set, so a client who has read one report
  // recognises the other.
  //
  // ko-find STAYS, and removing it is a client-facing regression with a green suite. portal-report.mjs
  // finds flaggable conflicts with '.card[id^="c"],.ko-find[data-ko-ord]', and this document cannot use
  // the id branch: ordinals restart at 1 PER MARK, so every mark in a batch would have an id of c1.
  // That is why data-ko-mark/data-ko-ord exist, and why the second branch had to be added at all — the
  // selector matched nothing on a knockout before it, and the flag control was never drawn.
  //
  // NO PICKBOX. The clearance's card carries one because its exportPDF filters to the ticked findings;
  // this document has no tick filter, and a checkbox that changes nothing is worse than none.
  //
  // THE RAIL IS COLOURED FROM THE RUN'S OWN FRAMEWORK, not from report.css's .rail.med/.low/.off. Those
  // three are the clearance's on-field/off-field vocabulary; a knockout's bands come from the frozen
  // manifest and can be any ladder a customer configures. Mapping one onto the other would be a second
  // table to keep in step — the same inline var the band chip already uses is the honest join.
  const stop = bandStop(framework, v.band);
  return `<div class="card ko-find" data-ko-mark="${Number(markIndex)}" data-ko-ord="${Number(v.ordinal)}">
        <div class="top">
          <div class="rail" style="background:var(${stop})"></div>
          <div class="body">
            <div class="cardhead">
              <span class="fnum">${esc(v.ref)}</span><span class="who">${esc(v.name ?? 'Unnamed finding')}</span>${
    v.band ? `<span class="ko-findband" style="background:var(${stop})">${esc(v.band)}</span>` : ''}${sourceChips(v)}
            </div>
            ${meta ? `<p class="ko-findmeta">${meta}</p>` : ''}
            ${v.lead ? `<p class="ko-findnet">${inlineMd(v.lead)}</p>` : ''}
            ${whyBandFold(v.detail ? `<p class="ko-findbasis">${inlineMd(v.detail)}</p>` : '')}
            ${ev ? `<p class="ko-findev">Evidence: ${ev}</p>` : ''}
          </div>
        </div>
      </div>`;
}

// ── — THE REGISTER FILING AS A CONFLICT CARD ────────────────────────────────────────────────────
//
// THE DEFECT. Register results reached the reader as three counts per name plus a flat appendix table.
// An identical filing, live, in a class the run was instructed on — the one thing a screen exists to
// catch — got the same visual weight as a lapsed filing in an irrelevant class, and nothing anywhere
// pointed at it. A reader could hold a knockout whose register found an exact blocking filing and never
// notice it.
//
// THE FIX IS PROMOTION, NOT ASSESSMENT, and the distinction is the whole design:
//
//   • The filing is not rated. The card carries no band from the run's ladder, no score, no ranking
//     against the common-law conflicts — it carries the register's own fields and one fixed sentence
//     saying the rating did not turn on it. The counts doctrine (register-count.mjs rule 3,
//     register-records.mjs rule 3) is unchanged: a count rates nothing and no filing is assessed.
//   • The two facts that decide promotion are code-owned and both fail OPEN — see promotableRecords.
//   • The raw status is printed verbatim on every card, so the reader is never asked to trust a
//     classification. Promotion decides what gets POINTED AT; the reader decides what it means.
//
// NO NEW SHAPE, AND SINCE NOT A SECOND ONE EITHER. The card was `findingBlock`'s
// markup element for element when wrote this, and then findingBlock moved to the clearance report's
// treatment and this block did not — leaving one card on the page whose reference rendered smaller and
// lighter than the other nine, in .ko-findhead / .ko-ref where every neighbour had .cardhead / .fnum.
// Those two rules are now DELETED rather than left unreferenced: an unused rule in a stylesheet this
// page inlines is bytes on every document and an invitation to re-adopt the shape.
//
// What tells the two kinds apart is report.css's existing source chip — `.src.reg` here, `.src.cl` on a
// typed finding — which is the vocabulary the clearance reports already use and the owner's ruling on
// asked for. Both classes stay on the wrapper: `card` is the visual treatment,
// `ko-find` is the locator portal-report.mjs needs to draw the flag control.

/** How many promoted filings a name may put on cards before the rest is the appendix's job. Beside
 *  APPENDIX_ROWS because it is the same kind of bound for the same reason: a conflicts list a reader
 *  stops reading has surfaced nothing. The overflow is stated, never silent. */
const REGISTER_CARDS = 3;

/** Where the register card's ordinals start, clear of the 1…N a mark's typed findings occupy. It is a
 *  FLOOR, not a fixed base: registerCardViews lifts it above the highest typed ordinal on the mark, so
 *  a mark with 900 conflicts cannot collide. A collision is the silent failure here — portal-service
 *  resolves a flag by (markIndex, ordinal), so a duplicate ordinal attaches a lawyer's correction to
 *  the wrong conflict with nothing going red. */
const REGISTER_ORDINAL_FLOOR = 900;

/**
 * The line a register card carries where a finding card carries a band. Verbatim, one constant, so the
 * report and report-data.json cannot phrase it two ways.
 *
 * IT USED TO SAY "this search screens; a clearance weighs". That was a claim about
 * the PRODUCT, and made it false: the rater is handed this run's fetched filings and
 * weighs them. A label saying the product does not do the thing it just did is worse than no label.
 *
 * What is still TRUE of a card that reaches this line is narrower and is what it now says: this filing
 * did not become a conflict finding. That holds on a post-1926 run (the rater read it and the rating did
 * not turn on it) and on an archived one (nobody weighed anything), so one sentence serves both without
 * either claiming more than its run supports.
 */
// THE NAME IS HISTORICAL, THE VALUE IS NOT. This constant was the card's "not weighed" label; the
// owner's ruling on retires that word from what a client reads. The identifier keeps
// the old name deliberately — it is internal, it is imported by name in two places, and renaming it
// would move both ends of a rename for no gain a client can see. Do not read the NAME as a description
// of the value.
//
// ── IT USED TO DENY SOMETHING NOBODY HERE COULD KNOW ────────────────────────────
//
// The value was "not raised as a conflict — the rating did not turn on this filing", printed on EVERY
// promoted register card, unconditionally. The note above it argued that this stays true on a post-1926
// run because the rater read the filing and the rating did not turn on it — which is not a fact this
// renderer holds. It is a guess about the rater, and on a delivered run it was wrong three times
// in one report: the assessment weighs three live senior filings into a Very High while the three cards
// beneath it each tell the reader the rating did not turn on them. Two statements about the same
// filings, on the same page, contradicting each other — and the fixed one is ours.
//
// WHAT REPLACES IT IS TRUE OF THE CARD, WHICH IS ALL THIS FUNCTION KNOWS. A promoted record arrives
// here with a proprietor, a territory, a status and an address; nothing on it records what the rater
// weighed, because no per-finding key carries that (ordinal/name/owner/band/net/type/evidence/basis —
// see findings-model.mjs). So the line says the one thing the renderer can stand behind: this card is a
// register listing and carries no rating. That keeps the job the old sentence was doing — stopping a
// filing from looking rated beside neighbours that are — without speaking for the rater.
//
// SHOWING THE RATER'S ACTUAL READ IS THE OTHER HALF, and it cannot be done here: it needs the assess
// seat to emit which filings it weighed. Deriving it from the assessment's prose would be a regex over
// rendered prose, which is the thing this lane's structure-at-source rule exists to prevent.
export const NOT_WEIGHED_LINE = 'Register listing — this card carries no rating of its own';
const NOT_WEIGHED = NOT_WEIGHED_LINE;

/**
 * The register card's basis line, which cannot be written without knowing whether the card is rated.
 *
 * THE TWO RULINGS MEET HERE AND THEY ALMOST CONTRADICTED EACH OTHER ON A CLIENT PAGE. One ruling
 * retired a code-owned placeholder because a rating nobody performed must not appear; the other then
 * ruled that the rater's OWN band for a promoted filing must appear, because a filing
 * the rater weighed into the verdict was rendering as though it had not been. Both hold, and they hold
 * over different cards.
 *
 * `band` and `read` are independent fields — the band comes from `registerReads[].band` and the read
 * from its `text` — so a filing the rater banded WITHOUT typing a read is reachable, and the first cut
 * of this rendered the band chip beside the sentence "this card carries no rating of its own". The
 * report would have been contradicting itself in one card, in the client's voice.
 *
 * So: the retired line belongs only to a card with no band. A banded card with no read says nothing
 * rather than something false — the chip and the source tag already say what the card is.
 */
function basisLine(band, read) {
  if (read) return `<p class="ko-findbasis">${esc(read)}</p>`;
  return band ? '' : `<p class="ko-findbasis">${esc(NOT_WEIGHED)}</p>`;
}


/**
 * Which listed filings get pointed at. TWO tests, and both fail OPEN — a filing is promoted unless
 * something the register actually said rules it out.
 *
 *   1. NOT CONFIDENTLY DEAD. Only the screening lane's own dead vocabulary excludes. An unrecognised
 *      status word is AMBIGUOUS and promotes: dropping a filing because this build does not know the
 *      provider's word for its state would be the silent absence this repo keeps paying for. The
 *      consequence, stated: on a provider whose dead words are not `invalid`/`expired`, a dead filing
 *      is promoted — and the card prints its status, so the page never claims otherwise.
 *   2. IN AN INSTRUCTED CLASS. No instructed classes ⇒ nothing to be outside of. No classes on the
 *      record ⇒ the register did not say, and silence never excludes. An all-class registration is in
 *      every class including this one (isAllClass).
 *
 * Neither test is a judgment about the filing. Whether any of it blocks anything is lawyer work this
 * product does not do — the same line register-records.mjs rule 3 has held since the lane shipped.
 */
// EXPORTED so the pipeline can ask the same question the page asks. The owner
// use-check runs on PROMOTED filings only, and "promoted" has to mean here what it means on the report —
// a second predicate would let the engine search an owner whose filing the report never shows, or skip
// one it does.
export function promotableRecords(entry, mark) {
  const scope = new Set([...(mark?.classesSearched ?? []), ...(entry?.classes ?? [])]
    .map(Number).filter(Number.isInteger));
  return (entry?.records ?? []).filter((r) => {
    if (classifyStatus(r?.status) === 'dead') return false;   // one spelling — see rankByMateriality
    if (!scope.size) return true;
    const classes = (Array.isArray(r?.classes) ? r.classes : []).map(Number).filter(Number.isFinite);
    if (!classes.length) return true;
    if (isAllClass(classes)) return true;
    return classes.some((c) => scope.has(c));
  });
}

/** One sentence of what the filing IS, composed from the register's own fields. No adjective that the
 *  record did not supply, and every absent field says it is absent rather than rendering as a blank —
 *  a blank cell and an unstated field read alike to a human and only one is honest. */
// ── THE OFFICE, NOT THE VENDOR ──────────────────────────────────────────────────────────────────────
//
// The sentence read "A filing of the identical name on Clarivate Compumark — held by ..., status
// PENDING, classes 9, 38, 45, territory us." Clarivate Compumark is the search vendor; the filing is at
// the United States office. Naming the vendor in the position where a reader expects the register says
// the filing exists somewhere it does not, and prints a raw two-letter territory code besides.
//
// The provider is still named — once, in scope, as the data source (territoriesLine), which is what it
// is. A card states the office, the kind of right, its status, its owner and its classes.
//
// STATUS IS THE RECORD'S OWN WORD, lower-cased for the sentence and never re-classified: "pending" here
// is the register's PENDING, not this renderer's reading of it. A record that states none says so.
const REGISTRATION_WORDS = /^(?:reg|registered|registration)/i;

/** "United States application (pending)" — the office and the kind of right, from the record's own fields. */
function registerRightPhrase(r) {
  const office = territoryName(r?.territory, { bare: true });
  const status = String(r?.status ?? '').trim();
  // A right whose status names a registration is a registration; anything else is an application. The
  // record's raw word rides in the bracket either way, so the reader never has to trust the reading.
  const kind = REGISTRATION_WORDS.test(status) ? 'registration' : 'application';
  const where = office ? `${office} ` : '';
  // The bracket exists to show the register's OWN word where that word adds something. On a record whose
  // status already names the kind ("REGISTERED" beside "registration") it adds nothing but noise, so it
  // is dropped — the reader has the same fact either way, in one word instead of two.
  // "registration (registered)" and "application (application)" say the kind twice. Both roots are
  // tested rather than stemmed, because a stemmer that turns "registered" and "registration" into one
  // token also turns "pending" and "pended" into one, and "(pending)" is a fact the reader wants.
  const echoes = (kind === 'registration' && REGISTRATION_WORDS.test(status))
    || (kind === 'application' && /^(?:appl|filed?)/i.test(status));
  const bracket = status && !echoes ? ` (${status.toLowerCase()})` : '';
  return `${where}${kind}${bracket}`.trim();
}

function registerStatement(r, provider) {
  const name = String(r?.mark ?? r?.name ?? '').trim();
  const classes = (Array.isArray(r.classes) ? r.classes : []).filter((n) => Number.isFinite(Number(n)));
  const lead = [name, registerRightPhrase(r)].filter(Boolean).join(', ');
  const owner = r.owner ? `by ${r.owner}` : 'owner not stated on the record';
  const cls = classes.length
    ? `class${classes.length === 1 ? '' : 'es'} ${classes.join(', ')}`
    : 'classes not stated on the record';
  // A close-variation card says WHICH near-form matched, because the name at the head of the sentence is
  // then not the name the client asked about and a reader must not have to guess which it is.
  const via = r.matchedBasis === 'close' && r.matchedForm ? ` Found under the close variation ${r.matchedForm}.` : '';
  return `${lead} ${owner}, ${cls}.${via}`;
}

/**
 * A mark's promoted filings as card views, and the ONE place both surfaces read them.
 *
 * The renderer and knockoutReportData call this same function for the same reason knockoutFindingViews
 * exists: portal-service.mjs resolves a flag as `data.marks[markIndex].findings.find(f => f.ordinal ===
 * ordinal)`, so the DOM's `data-ko-ord` and the data file's `ordinal` must be produced by one
 * projection or a flag lands on nothing — silently, because an unresolved ordinal is a legitimate state.
 *
 * THE REF IS ITS OWN NAMESPACE (`<MARK> REG #1`) and that is deliberate. `<MARK> #<n>` is the audit
 * workbook's Findings-sheet key; a register filing has no row on that sheet, so printing that
 * form would point a reader at a row that does not exist. Its receipt is the register record itself,
 * which the card links.
 */
/**
 * WHICH OF A MARK'S REGISTER CARDS THE PAGE DRAWS.
 *
 * THIS FILTERS THE PAGE, NEVER THE RECORD, and that separation is the whole point. 331 rejects dropping
 * anything from report-data.json or the workbook to make the page shorter, so `registerCardViews` still
 * builds every promoted filing and still assigns the ordinals it always did — knockoutReportData reads
 * that, unchanged. This function decides only what is DRAWN.
 *
 * Keeping one projection also keeps the flag path honest: portal-service resolves a flag as
 * `marks[i].findings.find(f => f.ordinal === ordinal)`, so a card on the page carries the ordinal its
 * own data entry has. A card the page does not draw cannot be flagged, because there is nothing to click.
 *
 * ONLY AN EXPLICIT LOWEST-RUNG BAND SUPPRESSES A CARD. Absence never does, and that is the whole rule —
 * there is no second condition and no archived-run special case, because this one covers both.
 *
 * The first cut read an absent band as "lowest" and needed a clause-F escape hatch beside it: if no
 * filing on the mark carried a band, keep them all. That escape hatch is what a wrong default looks
 * like. It handled the run with NO bands and silently mishandled the run with SOME: `band` is optional
 * per row, so a rater who bands the filings that matter and leaves the rest alone is doing what the
 * shape invites — and the mark whose one typed band happened to be the bottom rung lost every card it
 * had, including the filings nobody ruled on.
 *
 * `atLowestBand` below already argues this, one function down: a band it cannot place on the ladder
 * is kept, because "the rater said something, and the safe reading of something we cannot rank is that
 * it is worth pointing at". An absent band is strictly LESS information than an unrankable one, so if
 * unknown keeps, absent keeps. Dropping it would be this renderer deciding a filing is immaterial on
 * the rater's behalf — the same claim a later ruling removed from these cards for the same reason.
 *
 * A run that carries no bands at all still renders every card it was delivered with, which is what
 * clause F asks for; it now falls out of the rule instead of being carved around it.
 */
function registerCardsOnPage(cards, mark, framework) {
  return cards.filter((v) => !atLowestBand(framework, readBandFor(mark, v?.record?.recordId)));
}

/**
 * DID THE RATER PUT THIS FILING ON THE LADDER'S LOWEST RUNG?
 *
 * The ladder runs worst-first, so the lowest rung is the LAST entry. A filing the rater put there is one
 * the rater called manageable, and 331 keeps those in the filings table rather than on a card: three
 * cards whose own text says the filing does not bear materially on the rating cost the reader more than
 * they told him.
 *
 * Stated as "is it AT the lowest rung" rather than "is it above it", because that is the only direction
 * a caller may act on. Every other answer — a rung higher up, a word this build cannot place on the
 * run's own ladder, no band at all — is a filing that keeps its card. An unplaceable word is not a band
 * this function may quietly demote: the rater said something, and the safe reading of something we
 * cannot rank is that it is worth pointing at. Absence says even less, so it keeps the card too.
 */
function atLowestBand(framework, band) {
  const ladder = Array.isArray(framework?.bands) ? framework.bands : [];
  const word = String(band ?? '').trim().toLowerCase();
  if (!word || !ladder.length) return false;
  const lowest = String(ladder[ladder.length - 1]?.label ?? '').trim().toLowerCase();
  return Boolean(lowest) && word === lowest;
}

/** The rater's band for one filing, off the row that names it. `null` when the rater gave none. */
function readBandFor(mark, recordId) {
  const id = String(recordId ?? '').trim();
  if (!id) return null;
  const row = (Array.isArray(mark?.registerReads) ? mark.registerReads : [])
    .find((x) => String(x?.recordId ?? '').trim() === id);
  return String(row?.band ?? '').trim() || null;
}

function registerCardViews(mark, framework, registerRecords) {
  if (!registerRecords || registerRecords.unavailable) return { cards: [], entry: null, promoted: 0 };
  const entry = recordsForMark(registerRecords, mark?.name);
  if (!entry) return { cards: [], entry: null, promoted: 0 };
  const promoted = promotableRecords(entry, mark);
  const typed = knockoutFindingViews(mark, { manifest: framework });
  const floor = Math.max(REGISTER_ORDINAL_FLOOR, ...typed.map((v) => Number(v.ordinal) || 0));
  const markName = String(mark?.name ?? '').trim();
  const provider = registerRecords.providerLabel ?? registerRecords.provider ?? 'the register';
  // RANKED BEFORE THE CAP. promotableRecords decides WHETHER a filing may be
  // pointed at; this decides WHICH of the ones that may get the three slots. Without it the three cards
  // were the first three the provider happened to return.
  const cards = rankByMateriality(promoted, entry, mark).slice(0, REGISTER_CARDS).map((r, i) => ({
    ordinal: floor + i + 1,
    ref: markName ? `${markName} REG #${i + 1}` : `REG #${i + 1}`,
    record: r,
    provider,
    statement: registerStatement(r, provider),
    evidence: isHttpUrl(r.url) ? [r.url] : [],
  }));
  return { cards, entry, promoted: promoted.length, provider };
}

/**
 * ONE promoted filing, in findingBlock's own anatomy — the SAME anatomy, now, not a parallel one.
 *
 * RULING: one combined card, the same head as every other conflict, tagged by
 * SOURCE. "Weighed" and "not weighed" are not terms we use with a client, so the band slot's neutral word
 * is gone; what tells the two apart on the page is where the finding came from, which is the vocabulary
 * the clearance reports already use for exactly this.
 *
 * THE BAND CHIP IS DRAWN ONLY WHEN THE RATER SENT ONE, and that condition is the whole rule. The old note
 * here said "no band chip and no `bandStop`, ever: a rung of the run's ladder would be a rating nobody
 * performed" — which was true for as long as nothing could carry the rater's rating of an individual
 * filing. `registerReads[].band` now can, so the objection is answered where it was
 * raised: with a band, the rating WAS performed, by the seat, in the framework's own words, and the chip
 * states it. With no band the old rule stands unchanged — --faint rail, no chip, nothing claimed — and
 * that is still what every archived run renders.
 *
 * THE LINE UNDER THE STATEMENT DESCRIBES THE CARD, NOT THE RATING. It used to deny
 * that the rating turned on this filing, which this function has no way to know and which a delivered
 * report contradicted on three cards at once. See NOT_WEIGHED_LINE for the measurement and the split.
 */
/**
 * THE SOURCE CHIPS, DERIVED.
 *
 * This was one hardcoded `Common law` chip on EVERY typed finding, whatever its evidence rested on. On a
 * delivered run the top finding's own basis reasoned across the screened market AND the filings the run
 * had fetched — a genuine two-source read, labelled single-source at the exact moment it mattered.
 *
 * DERIVED, NEVER DECLARED. The seat cites the register record ids its reasoning used and the driver
 * JOINS them against the run's own record store (verify-knockout's registerRecordIdsFor); the chip is
 * then read off a fact. That is the rule stages.mjs already applies to the clearance lane's source_type,
 * which it classifies `mechanical:code-extracted` because "the lane that produced the record is a driver
 * fact". A label the seat typed about its own sourcing would be an unjoined self-report.
 *
 * ARCHIVED RUNS ARE UNCHANGED. They carry no weighedFilings, so the register side is empty and the
 * common-law side falls back on — one `Common law` chip, exactly the markup they were delivered with.
 * The fallback is also what keeps an evidence-less prose row wearing the chip it always wore.
 */
function sourceChips(v) {
  const register = Array.isArray(v?.weighedFilings) && v.weighedFilings.length > 0;
  const commonLaw = (Array.isArray(v?.evidence) && v.evidence.length > 0) || !register;
  return `${commonLaw ? '<span class="src cl">Common law</span>' : ''}${register ? '<span class="src reg">Register</span>' : ''}`;
}

// ── THE REVIEWER'S NOTES, ON THE REPORT ─────────────────────────────────────────────────
//
// RULING, 2026-09-07: there is one report and the person who ran Clearotron reads it — keeping
// this material off the page "just adds confusion for where data is lost". This replaces the earlier
// split under which the notes went to the audit workbook alone (the header of this file and
// publish/knockout.mjs carried that rule; both now say what replaced it). The workbook keeps them too:
// this adds a surface, it does not move one.
//
// LABELLED, NEVER MERGED. They render in the established `.internal` purple convention report.css
// already defines — the same one the clearance report uses for this material — so a reader can see whose
// voice a line is in. Merging them into the client-voiced body would make the reviewer's asides read as
// findings about the mark, which is the one way this ruling could produce a worse document.
const REVIEWER_NOTES_LEGEND = 'Purple notes are for the reviewing lawyer. Remove them before this goes to the client.';

// The clearance lane's own label, copied rather than re-worded. One spelling across
// both products is the point: a reader who has seen it on a clearance report knows what it means here.
const USE_CHECK_LABEL = 'Use-check source:';

/** The owner lookup covering a filing, joined by recordId. `null` when this run owed that filing none. */
function ownerCheckFor(ownerChecks, recordId) {
  const id = String(recordId ?? '').trim();
  if (!id) return null;
  return (Array.isArray(ownerChecks) ? ownerChecks : [])
    .find((c) => (Array.isArray(c?.recordIds) ? c.recordIds : []).some((x) => String(x).trim() === id)) ?? null;
}

// The two-place sort lives in findings-model.mjs (splitKnockoutNotes) because the predelivery lint
// needs the same answer: the page files each note, and the reviewer warns a writer whose note will file
// the way they did not intend. One reader, so the two can never disagree.
/**
 * "About this request" — what was asked, and any flag on the asking.
 *
 * WHAT WAS ASKED IS CODE-OWNED. It is read off the run's own frozen instructed scope, never off model
 * prose, so the line states the request the run was given rather than a paraphrase of it. An archived run
 * that carries no such sidecar renders the flags alone, and a run with neither renders nothing at all —
 * the block never appears empty and never appears with a heading over nothing.
 *
 * THE FLAGS ARE THE REVIEWER'S OWN WORDS, unedited. This surface moves them; it does not rewrite them.
 * They keep the purple convention here exactly as they wear it under the cards, which is also what keeps
 * them off the export: the strip is one rule on .internal and it reaches both places.
 */
function aboutRequestBlock(scope, requestNotes) {
  const goods = String(scope?.goods ?? '').trim();
  const classes = (Array.isArray(scope?.classes) ? scope.classes : []).filter((c) => c || c === 0);
  const jx = (Array.isArray(scope?.jurisdictions) ? scope.jurisdictions : []).map((t) => territoryName(t)).filter(Boolean);
  const asked = [
    classes.length ? `Class${classes.length === 1 ? '' : 'es'} ${classes.join(', ')}` : '',
    goods,
  ].filter(Boolean).join(' — ');
  const where = jx.length ? `Searched in ${listWords(jx)}.` : '';
  const flags = (requestNotes ?? []).filter(Boolean);
  if (!asked && !where && !flags.length) return '';
  return `<div class="ko-req">
      <span class="ko-lbl2">About this request</span>
      ${asked ? `<p>${esc(asked)}</p>` : ''}
      ${where ? `<p>${esc(where)}</p>` : ''}
      ${flags.length ? `<div class="internal ko-reqflag">${
        flags.map((n) => `<p class="ko-bul">${inlineMd(n)}</p>`).join('')}</div>` : ''}
    </div>`;
}

function reviewerNotesBlock(m) {
  const notes = splitKnockoutNotes(m).name;
  if (!notes.length) return '';
  return `<div class="internal">
            <span class="tag">For the reviewing lawyer</span>
            ${notes.map((n) => `<p class="ko-bul">${inlineMd(n)}</p>`).join('')}
          </div>`;
}

function registerFindingBlock(v, markIndex, reads = null, framework = null, ownerChecks = []) {
  const r = v.record;
  // — THE RATER'S OWN READ OF THIS FILING, when it recorded one. `registerReads` is
  // joined to the record store by the validator, so a row that reaches here names a filing this run
  // actually holds. With no row the neutral line stands, and the neutral line is TRUE: it describes the
  // card. That is why the field can be optional without the page ever asserting something false.
  const row = (Array.isArray(reads) ? reads : [])
    .map((x) => ({ id: String(x?.recordId ?? '').trim(), text: String(x?.read ?? '').trim(), band: String(x?.band ?? '').trim() }))
    .find((x) => x.id && x.id === String(r?.recordId ?? '').trim());
  const read = row?.text;
  // The band rides the SAME row as the read and is independently optional: a read with no band prints
  // exactly as it did before this field existed. The validator has already checked the word against the
  // frozen ladder, so `bandStop` resolves a real stop rather than falling through to a default that would
  // colour an unknown word as though it were rated.
  const band = row?.band || null;
  const stop = band ? bandStop(framework, band) : null;
  // ── WHERE THE OWNER'S TRADE WAS LOOKED UP ──────────────────────────────────────────────────────
  //
  // The source is the DRIVER'S, joined by this filing's own recordId — never a URL the seat typed. That
  // is the whole reason a reader can trust it: the row exists because the driver made the call, so
  // "asserting a no-result without issuing a query" is not a thing this surface can express.
  //
  // ABSENT ON A RUN THAT OWED NO CHECK, and that silence is correct: no line at all says nothing, while
  // a line reading "no result" on a filing nobody was asked about would claim a search that never ran.
  const useCheck = ownerCheckFor(ownerChecks, r?.recordId);
  const useCheckSource = useCheck?.source ?? null;
  const meta = [r.owner ? esc(r.owner) : 'proprietor not stated', r.territory ? esc(r.territory) : null]
    .filter(Boolean).join(' · ');
  const receipt = isHttpUrl(r.url) ? linkOrText(r.url) : esc(r.recordId ?? 'no record address supplied');
  return `<div class="card ko-find" data-ko-mark="${Number(markIndex)}" data-ko-ord="${Number(v.ordinal)}">
        <div class="top">
          <div class="rail" style="background:var(${stop ?? '--faint'})"></div>
          <div class="body">
            <div class="cardhead">
              <span class="fnum">${esc(v.ref)}</span><span class="who">${esc(r.mark ?? 'Unnamed filing')}</span>${
    band ? `<span class="ko-findband" style="background:var(${stop})">${esc(band)}</span>` : ''}<span class="src reg">Register</span>
            </div>
            <p class="ko-findmeta">${meta}</p>
            <p class="ko-findnet">${esc(v.statement)}</p>
            ${basisLine(band, read)}
            ${useCheck ? `<p class="ko-findev">${esc(USE_CHECK_LABEL)} ${isHttpUrl(useCheckSource) ? linkOrText(useCheckSource) : esc(useCheckSource)}</p>` : ''}
            <p class="ko-findev">Register record: ${receipt}</p>
          </div>
        </div>
      </div>`;
}

// The first conflict's reference, as the worked example the workbook line points at. Named rather than
// described: "a reference like MARK #1" makes a reader guess the format of their own document.
function firstRef(marks, framework) {
  for (const m of marks) {
    const [v] = knockoutFindingViews(m, { manifest: framework });
    if (v) return v.ref;
  }
  return '';
}

// — THE REGISTER SENTENCE IS THE RENDERER'S, and it is the whole reason this function exists.
//
// A live run printed "the register overlay has not been run" in model prose directly under a table of
// register counts the same run had taken. The model was not lying: it cannot see the count lane, it is
// deliberately never shown the figures (register-count.mjs rule 1), and it filled the gap with the only
// thing it had. The fix is not a better prompt — it is that nobody who cannot see the machinery gets to
// describe it. The validator forbids the model from saying anything about register coverage; this
// function says it, from the artifacts.
//
// It reads the SIDECARS, never the prose: the counts entry for this mark, and whether the product bought
// the probe at all. Four states, four sentences, and none of them is a judgment.
//
// — AND IT NOW STATES THE POSITION, NOT ONLY THE COVERAGE. Coverage alone ("hit-counts were taken
// for this name") answers a question nobody asked; the question a reader holds is whether anything
// STANDS on the register for this name. That sentence is appended by registerPositionClause below and
// it is present in every state, including the state where the answer is "nothing does" — an absence is
// a finding and must be said out loud, never left as a silence over a table of numbers.
function registerLine(mark, registerCounts, probeRan, registerRecords = null, cards = []) {
  return [coverageClause(mark, registerCounts, probeRan),
    registerPositionClause(mark, registerCounts, registerRecords, cards)].filter(Boolean).join(' ');
}

/**
 * Where the name STANDS on the register that was searched. Six states, and they are six because
 * collapsing any pair of them would put a claim on the page that the artifacts do not support:
 *
 *   no listing lane at all      the counts were taken and the filings behind them were not listed. The
 *                               page may not say "nothing stands" — nothing looked.
 *   the lane refused            the provider could not list. Same rule, different reason, and the
 *                               reason is already on the page once (filingsSection).
 *   no entry for this name      the listing ran and this name is not in it. Not the same as an empty
 *                               listing for it.
 *   promoted filings            the answer the issue was raised for, with the card refs so the reader
 *                               can walk from the framing to the filing in one step.
 *   listed, none promoted       filings exist and none is both in the counted classes and other than
 *                               dead. Says WHY, so the reader is not left to infer that none exists.
 *   listed nothing              the register returned none under the name or any close variation of it.
 *                               This is the "none exists" arm, and it is only reachable when every
 *                               search actually answered.
 */
function registerPositionClause(mark, registerCounts, registerRecords, cards = []) {
  if (!registerRecords) {
    return registerCounts ? 'The filings behind those counts were not listed on this run.' : '';
  }
  if (registerRecords.unavailable) {
    return 'The filings behind the counts could not be listed on this run, so nothing here says whether one stands.';
  }
  const entry = recordsForMark(registerRecords, mark?.name);
  const provider = registerRecords.providerLabel ?? registerRecords.provider ?? 'the register';
  if (!entry) return 'No filings listing was recorded for this name.';
  if (cards.length) {
    const classes = [...new Set(cards.flatMap((c) => (c.record.classes ?? []).map(Number).filter(Number.isFinite)))]
      .sort((a, b) => a - b);
    const where = classes.length ? ` in class${classes.length === 1 ? '' : 'es'} ${classes.join(', ')}` : '';
    const one = cards.length === 1;
    const refs = cards.map((c) => c.ref).join(', ');
    return `${one ? 'A filing' : `${cards.length} filings`} of this name or a close variation of it `
      + `stand${one ? 's' : ''} on ${provider}${where} — ${refs} above.`;
  }
  const records = entry.records ?? [];
  if (!records.length) {
    return (entry.terms ?? []).some((t) => !t.ok)
      ? 'The filings listing for this name did not complete, so nothing here says whether one stands.'
      : `No filing of this name or a close variation of it stands on ${provider}, in the classes counted.`;
  }
  return `${records.length} filing${records.length === 1 ? ' is' : 's are'} listed for this name below; `
    + `none is carried up as a conflict — each is either shown dead on the register or outside the classes counted.`;
}

function coverageClause(mark, registerCounts, probeRan) {
  const entry = registerCounts ? countsForMark(registerCounts, mark.name) : null;
  if (!entry?.counts) {
    return probeRan
      ? 'Register: hit-counts are part of this search and none could be taken for this name — the reason is in the audit workbook.'
      : 'Register: not included in this product tier — no register was counted for this name.';
  }
  const anyFigure = COUNT_PREDICATES.some((p) => Number.isFinite(entry.counts[p.key]?.total));
  if (!anyFigure) return 'Register: no count could be taken for this name — the reason is in the audit workbook.';
  // COVERAGE, NOT THE FIGURES. asks the renderer to own the register-tier caveat, and the numbers
  // are already on this page twice — in the glance line at the top and in the counts table above this
  // section. A third rendering of "3 identical, 41 containing" at the foot of every card is noise, and
  // noise is what a reader stops reading. What the card owes is the fact the model cannot supply: that
  // the lane ran for THIS name, and where its output is.
  const scope = entry.classScope === 'all-classes' || !(entry.classes ?? []).length
    ? 'across all classes'
    : `in class${entry.classes.length === 1 ? '' : 'es'} ${entry.classes.join(', ')}`;
  return `Register: hit-counts were taken for this name ${scope} — the figures are in the counts table above.`;
}

// — the per-mark read, rendered as STRUCTURE because it was emitted as structure.
//
// The stage now types what its prose used to fuse: `basis` (why this band, one sentence), `factors[]`
// (the load-bearing observations), `counterFactors[]` (what holds it off the next band either way) and
// `mitigation` (the one thing that would move it). Rendering those as a wall was never the defect — the
// wall was the emission. Same discipline as: structure at source, never a regex over rendered prose.
//
// AN ARCHIVED RUN HAS NONE OF THESE, and re-renders exactly as it was delivered: `bullets` alone, in the
// same <ul> as before. The validator makes the fields mandatory for a turn TODAY; a knockout published in
// July is not a defect and must not grow a section it never had.
//
// NOTHING IS DISCARDED. Where a run carries both the typed fields and prose bullets the bullets survive
// under a collapsed "Full narrative" — the reader who wants the long form still has it, one click away,
// and no sentence the stage wrote is dropped on the floor.
/**
 * THE LABELS, IN THE READER'S WORDS.
 *
 * The old pair was "What holds it there" and "What would move it", 9.5px grey capitals. The owner read
 * the first one and asked "what holds what?" — so the fix is not a synonym in the same style, it is a
 * label that carries the band's own word and answers the question by itself.
 *
 *   factors        → "Why High"              (the mark's own band)
 *   counterFactors → "Why not Very High"     (the rung ABOVE it on the run's own ladder)
 *   mitigation     → "What would lower the risk"
 *
 * The ladder runs worst-first, so the rung above is the PREVIOUS entry. At the top rung there is no
 * higher band to name and the honest label is "What keeps it here" — the same question, asked where the
 * comparative form has no answer. A band this build cannot find on the ladder gets that label too,
 * rather than a comparative naming a rung that may not exist.
 */
function counterLabel(framework, band) {
  const ladder = Array.isArray(framework?.bands) ? framework.bands : [];
  const i = ladder.findIndex((b) => String(b?.label ?? '').trim().toLowerCase() === String(band ?? '').trim().toLowerCase());
  const up = i > 0 ? String(ladder[i - 1]?.label ?? '').trim() : '';
  return up ? `Why not ${up}` : 'What keeps it here';
}

const ASSESSMENT_FOLD_LABEL = 'Read the full assessment';

/** The scope block's own words, as one string, so the caveat filter reads exactly what the page prints. */
const SCOPE_BLOCK_TEXT = 'What this is. A fast screen for obvious blockers to using each name, from '
  + 'marketplace and web use plus a count of register filings. What it is not. A clearance search. We '
  + 'drew no register conclusions and give no filing advice. A name that passes here is not clear; it '
  + 'goes on to clearance. Every conflict above links to the material we found. The audit workbook holds '
  + 'every search run, every empty result and the working notes. Register data.';

/** Words that carry no claim, so their presence or absence says nothing about what a sentence asserts. */
const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'do',
  'does', 'each', 'for', 'from', 'has', 'have', 'here', 'in', 'is', 'it', 'its', 'no', 'not', 'of', 'on',
  'or', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to', 'up', 'was', 'we', 'were',
  'what', 'when', 'which', 'will', 'with', 'you', 'your']);

const contentWords = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));

/**
 * Does this line assert anything the reference text does not already assert?
 *
 * TRUE unless every content word in the line is already in the reference. An empty line has nothing to
 * say and returns false; a line with one unfamiliar word is kept. Singular/plural is folded so that
 * "conclusion" does not read as new beside "conclusions".
 */
function saysSomethingNew(line, reference) {
  // The stem must be IDEMPOTENT on the singular, or the fold does nothing: an earlier form stripped
  // "es" and turned "gives" into "giv" while leaving "give" alone, so the two never matched and every
  // caveat looked new. Strip one trailing "s" and nothing else.
  const stem = (w) => w.replace(/ies$/, 'y').replace(/s$/, '');
  const known = new Set(contentWords(reference).map(stem));
  const words = contentWords(line);
  if (!words.length) return false;
  return words.some((w) => !known.has(stem(w)));
}

function readBlock(m, framework) {
  const factors = (m.factors ?? []).filter((s) => typeof s === 'string' && s.trim());
  const counter = (m.counterFactors ?? []).filter((s) => typeof s === 'string' && s.trim());
  const structured = Boolean(m.basis || factors.length || counter.length || m.mitigation);
  const bullets = (m.bullets ?? []).map((b) => `<li>${inlineMd(b)}</li>`).join('');
  if (!structured) return bullets ? `<ul class="ko-bul">${bullets}</ul>` : '';
  const assessment = String(m.assessment ?? '').trim();
  const band = String(m.rating ?? '').trim();
  return [
    m.basis ? `<p class="ko-basisline">${inlineMd(m.basis)}</p>` : '',
    factors.length ? `<div class="ko-why-band">${band ? `<span class="ko-lbl2">Why ${esc(band)}</span>` : ''}<ul class="ko-bul">${
      factors.map((f) => `<li>${inlineMd(f)}</li>`).join('')}</ul></div>` : '',
    counter.length ? `<div class="ko-counter"><span class="ko-lbl2">${esc(counterLabel(framework, band))}</span><ul class="ko-bul">${
      counter.map((f) => `<li>${inlineMd(f)}</li>`).join('')}</ul></div>` : '',
    m.mitigation ? `<div class="ko-mitig"><span class="ko-lbl2">What would lower the risk</span><p>${inlineMd(m.mitigation)}</p></div>` : '',
    // ── THE ASSESSMENT REPLACES THE "FULL NARRATIVE" FOLD ────────────────────────────────────────────
    //
    // The model writes both. `bullets` (five) say in other words what `factors` (four) already say
    // visible above; `assessment` is the long-form read under its own four headings, and until now the
    // page rendered it NOWHERE — validated, carried in report-data.json and the workbook, never shown.
    // The owner found the bullets fold by accident and called it the most useful block on the page; the
    // assessment is the better version of the same thing.
    //
    // `bullets` is NOT dropped from the record — knockoutReportData still carries it and the workbook
    // still writes it. What retires is one fold on one page, replaced by a longer answer to the same
    // question. 331 rejects dropping the field itself, and this does not.
    //
    // CLAUSE F. An archived run carries bullets and no assessment: it keeps the fold it was delivered
    // with, under its own old label. The fallback is the old block, never an empty new one.
    assessment
      ? `<details class="ko-full"><summary>${esc(ASSESSMENT_FOLD_LABEL)}</summary><div class="ko-assess">${mdParagraphs(assessment)}</div></details>`
      : (bullets ? `<details class="ko-full"><summary>Full narrative</summary><ul class="ko-bul">${bullets}</ul></details>` : ''),
  ].filter(Boolean).join('');
}

function analysisSection(marks, framework, { registerCounts = null, probeRan = false, registerRecords = null, ownerChecks = [] } = {}) {
  const cards = marks.map((m, markIndex) => {
    const stop = bandStop(framework, m.rating);
    const bullets = readBlock(m, framework);
    // — the promoted register filings, in the SAME list as the common-law conflicts. They render
    // after the typed findings and that position is not a rank: a card with no band already sorts last
    // under compareKnockoutBlockingPower, so appending them is the ladder's own rule applied to a row
    // that has no rung, not a new one invented for the register.
    const reg = registerCardViews(m, framework, registerRecords);
    const drawn = registerCardsOnPage(reg.cards, m, framework);
    const regBlocks = drawn.map((v) => registerFindingBlock(v, markIndex, m?.registerReads, framework, ownerChecks)).join('');
    // The overflow counts what is NOT on the page against what met the promotion test — cards held back
    // by the cap and cards the rater put on the lowest rung alike, because from the reader's side they
    // are the same fact: further filings for this name, all of them listed below.
    const held = reg.promoted - drawn.length;
    const overflow = held > 0
      ? `<p class="ko-bul">${esc(`${held} further filing${held === 1 ? '' : 's'} for this name met the same test — every one of them is in the filings section below.`)}</p>`
      : '';
    // THE DEFECT THIS CLOSES. This line was `(m.findings ??).filter((f) => f?.url)`, and a
    // typed finding has no `url` — so every conflict was dropped from the page and a mark whose findings
    // were all typed fell to the fallback below: "No adverse signals recorded for this name on this
    // screen." A MARK WITH CONFLICTS RENDERED AS A CLEAN MARK, on the client-facing document, with
    // nothing anywhere saying so. findings-model.mjs's view reads both shapes and drops nothing.
    const finds = knockoutFindingViews(m, { manifest: framework }).map((v) => findingBlock(v, framework, markIndex)).join('');
    // — THE REGISTER CARDS ARE INSIDE `body`, and that is the fall-through guard. A mark whose only
    // conflict is a filing on the register used to reach the sentence below and be published as clean.
    // The guard is deliberately TIGHT: a listed filing that is dead or out of the counted classes does
    // not suppress it, because for that mark the sentence is true and the filings section says so.
    const body = [bullets, finds, regBlocks, overflow].filter(Boolean).join('');
    return `<div class="ko-row">
      <div>
        <p class="ko-name">${esc(m.name)}</p>
        <span class="ko-band" style="background:var(${stop})">${esc(m.rating ?? '—')}</span>
        ${qualifierHtml(m.ratingQualifier)}
        ${m.classesSearched?.length ? `<p class="ko-classes">Classes ${esc(m.classesSearched.join(', '))}</p>` : ''}
      </div>
      <div>
        ${body || '<p class="ko-bul">No adverse signals recorded for this name on this screen.</p>'}
        ${m.degraded ? `<p class="ko-degraded">${esc(DEGRADED_NOTE)}</p>` : ''}
        ${reviewerNotesBlock(m)}
        <p class="ko-reg">${esc(registerLine(m, registerCounts, probeRan, registerRecords, reg.cards))}</p>
      </div>
    </div>`;
  }).join('');
  // The legend rides the panel and only when a note is actually on it — a standing sentence explaining a
  // colour no reader can see would be the report describing a convention it did not use.
  const anyNotes = marks.some((m) => (Array.isArray(m?.purpleNotes) ? m.purpleNotes : [])
    .some((n) => String(n ?? '').trim()));
  const legend = anyNotes ? `<p class="ko-refnote">${esc(REVIEWER_NOTES_LEGEND)}</p>` : '';
  return `<div class="panel ko-glance">${legend}${cards}</div>`;
}

// The method line names EXACTLY what ran, and its wording is doctrine — with counts on the page, "register
// searches are addressed separately" alone would be read against the numbers beside it, so the basis is
// stated in full: what was counted, where, and that counting is not searching.
// charter ruling 1 (name-led) — same rule as render.mjs depthStripHtml: the strip leads with the
// product's registry name in bold (the pill name), then the coverage clauses. The seam is the
// LAST " — " (a registry name may itself carry one; the clauses never do); a nameless note (retired
// level degradation) renders whole; absent ⇒ '' (archived byte-identity).
//
// The body below reads as a verbatim copy of render.mjs's depthStripHtml and it is DELIBERATELY not
// shared (raised and closed 2026-07-31). The two are identical as text but not as behaviour: they
// close over different `esc` helpers — this file's escapes '"' as well, render.mjs's does not — so a
// depth note carrying a double quote renders differently on the two templates. Lifting one copy into a
// shared module therefore is not a de-duplication, it is a decision to change one template's output;
// on the clearance side that template is hash-frozen and its rendered bytes are what archived runs
// re-publish as. Six lines of duplication is the cheaper of the two, and the rule they implement is
// stated once, here. If they are ever unified, unify `esc` first and re-measure the freeze.
// — the hero's confidentiality row, from the SHARED three-state rule (shared/brand.mjs confPosture),
// which render.mjs's `confLineHtml` also calls. This template used to hardcode 'Privileged &amp;
// Confidential' as the first element of an unconditional array join, so no profile could suppress it and
// no profile could extend it — the clearance's own rule was unreachable from here.
//
// THE WHOLE ROW GOES WHEN BOTH HALVES ARE EMPTY, matching render.mjs and for its stated reason: an empty
// `.label` leaves the leading `.dot` bulleting nothing, and a reader sees a mark and hunts for the text
// it points at. `esc` here is the knockout's own — it also escapes `"` — which is why the composer is
// local and only the RULE is shared (the depthStrip lesson, immediately below).
function confLineHtml(delivery, productName) {
  const parts = [confPosture(delivery), productName ? esc(productName) : ''].filter(Boolean);
  if (!parts.length) return '';
  return `<div class="conf"><span class="dot"></span><span class="label">${parts.join(' · ')}</span></div>`;
}

function depthStrip(note) {
  const t = String(note ?? '').trim();
  if (!t) return '';
  const i = t.lastIndexOf(' — ');
  const inner = i > 0 ? `<b>${esc(t.slice(0, i))}</b> — ${esc(t.slice(i + 3))}` : esc(t);
  return `<div class="depth-strip">${inner}</div>`;
}

// The receipts clause says EVERY, so it prints only when every rendered conflict actually cites
// something — not merely when one does. Two ways it would otherwise become an absence claim exceeding
// what was examined, which is the rule this lane states in its own skill ("Assert nothing you did not
// examine"): a screen that named no conflicts has receipted nothing, and an ARCHIVED prose run can carry
// a finding with no url at all, which renders with no evidence line under a sentence claiming all of them
// have one. Either case ⇒ no sentence. What it claims when it does print is what knockoutReceipts
// enforced at publish (verify-knockout.mjs): held evidence, per mark, or no report at all.
// D6 — THE CAVEATS BLOCK GETS A SENTENCE OF ITS OWN, and the finding it answers is an ABSENCE.
// `standardCaveats` are MODEL-AUTHORED strings printed one per <br>, and nothing constrains a caveat to
// be a whole sentence — the model may legitimately write list items. `inlineMd` renders no lists, so a
// caveat written as "- Japan was not searched" printed a LITERAL dash with nothing above it, between two
// complete renderer-owned paragraphs (methodLine above, the audit-workbook sentence below). This is the
// lead-in they had and it did not: it is renderer-owned, so it is there whatever the model wrote, and it
// says what the lines under it are. It is not a filter and it rewrites no caveat.
const CAVEAT_LEAD = 'This screen also carries the following limits:';


/**
 * Render the knockout report.
 *
 * `identity` is the level's report identity from the registry (search-policy.mjs reportIdentityFor) —
 * `{ banner, stageLabel, identity }`. It is what makes the document say which product it is, and it comes
 * off the same registry row that chose the machinery, so the two cannot disagree.
 *
 * THE DOCUMENT PRINTS `.identity`, NOT `.banner`. `banner` leads with `stageLabel`, which for the
 * one live Knockout search dedupes to the same string — and on the two RETIRED knockout rows reads
 * "Depth 1 — Knockout review". A depth number is a rung on a ladder the offering no longer has, and it
 * must not appear on a client's page. The retired row's own registry NAME still prints, so an archived
 * knockout still says what it was sold as.
 *
 * A null name prints NOTHING rather than the old `|| 'Knockout review'` fallback, which was itself a
 * hardcoded product name — and, worse, the name of a RETIRED row, so a knockout whose level the registry
 * had forgotten asserted it was the one product it provably was not.
 */
export function renderKnockoutHtml(findings, framework, {
  runId, overall, issued = null, auditFile = null, probeRan = false, registerCounts = null,
  registerRecords = null,
  // The driver's own record of the owner lookups it ran. Defaults to [] so an
  // archived run that predates the lane renders exactly as it was delivered.
  ownerChecks = [],
  identity = null, matter = null, homeHref = null, chromeHref = null, depthNote = null,
  // — the run's FROZEN policy, so the scope section states what this run was
  // instructed to do rather than what its artifacts happen to show. Defaults to null, and an archived
  // run that carries none keeps the artifact-derived sentence it was delivered with.
  searchPolicy = null,
  // — the run's own frozen instructed scope: the goods, classes and
  // territories the requester asked for, in the requester's words. Defaults to null, and an archived run
  // that carries no such sidecar renders "About this request" from its request-level notes alone, or not
  // at all when it has none. Never derived from model prose — this is what was ASKED, not what was said
  // about it.
  instructedScope = null,
  // — the run's frozen delivery overlay. It defaults to null, which is the NO-OPINION state and
  // renders the same plain "Privileged & Confidential" this template always printed — so the ~15 unit
  // fixtures and both render-check scripts, none of which pass one, are unchanged by its arrival.
  delivery = null,
  // — IS THIS AN INVENTED MARK? This template had no demo handling of any kind, so
  // every demo knockout shipped looking real: an invented mark, a real register basis, a real-looking
  // risk assessment, a published URL, and nothing saying the matter is fiction. The clearance template
  // has carried the banner since 2013; the knockout path was assumed to follow and did not.
  // Defaults FALSE, so every existing fixture and both render-check scripts render exactly as before.
  demoData = false,
} = {}) {
  const marks = findings?.marks ?? [];
  const title = batchTitle(marks);
  const productName = identity?.identity ?? null;
  const overallStop = bandStop(framework, overall);
  const summary = findings?.batch?.executiveSummary ?? '';
  const caveats = findings?.batch?.standardCaveats ?? [];
  const productContext = findings?.batch?.productContext ?? '';

  // Sections are numbered in render order off ONE counter, so a run without a counts sidecar renumbers
  // cleanly instead of leaving a hole (or, as the first cut of this did, repeating 01).
  let n = 1;
  const num = () => String(n++).padStart(2, '0');
  const allViews = marks.flatMap((m) => knockoutFindingViews(m, { manifest: framework }));
  const citedFindings = allViews.filter((v) => v.evidence.length).length;
  const uncitedFindings = allViews.length - citedFindings;
  // ── A ONE-NAME PAGE HAS NO INDEX ────────────────────────────────────────────────────────────────
  //
  // The glance row exists to let a reader of a BATCH find the name they care about. With one name there
  // is nothing to index, and the row printed that name, its band and its classes for the first of three
  // times before the reader reached a single sentence of reading. On a batch it stays exactly as it was.
  const glance = marks.length > 1 ? glanceSection(marks, framework, registerCounts) : '';
  const hasCounts = Boolean(registerCounts?.marks?.length);
  // The register block is a table when counts were taken and a SENTENCE when they were not — never
  // nothing. It renders in the place the numbers would have occupied, at the top of the section that
  // owns them, because that is where a reader looks for them and fails to find them.
  const tierLine = tierAbsenceLine(registerCounts, probeRan);
  const counts = hasCounts
    ? countsSection(marks, registerCounts)
    : `<div class="panel"><p class="ko-tier">${esc(tierLine)}</p></div>`;
  // ── A CAVEAT THAT SAYS NOTHING THE SCOPE BLOCK HAS NOT SAID IS NOT RENDERED ────────────────────────
  //
  // The four model-written caveats on the measured run overlap the fixed text completely — 331 item 9,
  // and 333 rule 4 ("say it once") fixes it at the source for runs written under that doctrine. This is
  // the reader for the ones already written.
  //
  // THE TEST IS SUBSET, NOT SIMILARITY, and the difference is the whole safety argument. A caveat is
  // dropped only when EVERY content word in it already appears in the scope block. A caveat making any
  // new claim brings at least one new content word with it and is kept — so this cannot silently delete
  // a disclosure, which is the one failure that would matter on a client-facing page. A similarity score
  // could; that is why there isn't one.
  const newCaveats = caveats.filter((c) => saysSomethingNew(c, SCOPE_BLOCK_TEXT));
  const analysis = analysisSection(marks, framework, { registerCounts, probeRan, registerRecords, ownerChecks });
  // The request-level notes, gathered across every mark on the document and rendered ONCE at the top.
  // They are about the asking, not about a name, so a batch repeating them per mark would be the same
  // sentence three times. reviewerNotesBlock renders the rest, under that mark's own cards.
  const requestNotes = marks.flatMap((m) => splitKnockoutNotes(m).request);
  const aboutRequest = aboutRequestBlock(instructedScope, requestNotes);
  const provider = hasCounts ? (registerCounts.providerLabel ?? registerCounts.provider ?? 'the register') : null;
  // The filings appendix renders only when the run produced a listing artifact — never on its absence,
  // and never as an empty table. A knockout with no sidecar publishes exactly the counts-only document.
  // — THE DRILL-THROUGH CLAIM IS NARROWED TO WHAT IT IS TRUE OF. The workbook line below said "the
  // reference beside each conflict above is its row on the workbook's Findings sheet", universally, over
  // a list that now also carries register cards. A `REG` reference has no Findings row and the Register
  // Filings sheet carries no reference column at all (publish/knockout.mjs), so on any page with a
  // promoted filing that sentence sent a reader to a row that does not exist. A false pointer on the
  // audit trail is worse than no pointer, and the honest fix is to narrow the claim rather than mint a
  // second drill-through key for a card whose receipt is the register record itself.
  // Counted over what the page DRAWS: the sentence explains a REG reference a reader can see, so a run
  // whose register cards are all held back needs no sentence about them.
  const registerCardCount = marks.reduce((n, m) =>
    n + registerCardsOnPage(registerCardViews(m, framework, registerRecords).cards, m, framework).length, 0);
  const hasRecords = Boolean(registerRecords && (registerRecords.marks?.length || registerRecords.unavailable));
  const filings = hasRecords ? filingsSection(marks, registerRecords) : '';
  const onFieldSec = `<div class="sec"><span class="num">${num()}</span><h2>On-field conflicts</h2><span class="note">${hasCounts ? `register hit-counts (${esc(provider)}) and the read, per name` : 'what we found, per name'}</span></div>
${counts}
${analysis}`;
  const filingsSec = filings
    ? `<div class="sec"><span class="num">${num()}</span><h2>The filings behind the counts</h2><span class="note">the name itself and its close variations — the ${APPENDIX_ROWS} most material per name, full list in the workbook</span></div>
${filings}`
    : '';

  // CHROME_CSS is not optional decoration: it styles .lockup (including the 10px flag SVG), .has-glow,
  // .watermark and .fab-stack — every one of which this page emits. Without it the lockup's inline SVG
  // falls back to its intrinsic 500px and overflows the body box by ~440px, which the height bridge then
  // posts as the frame height. That is invisible to a string test and obvious to a browser: the page
  // renders correctly and sits in a frame with 450px of dead space under it. Caught by render-check.
  const cssInline = REPORT_BASE + '\n' + CHROME_CSS + '\n' + THEME_BTN_CSS + '\n' + KO_CSS;
  const chromeLinkTag = chromeHref ? `<link rel="stylesheet" href="${escAttr(chromeHref)}">` : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${productName ? `${esc(productName)} — ` : ''}${esc(title)} · ${esc(BRAND.name)}</title>
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@500;600&display=swap" rel="stylesheet">${FAVICON_LINK}${THEME_INIT_EXPLICIT}
<style>${cssInline}${REPORT_ROOT_DARK_EXPLICIT}${PRINT_LIGHT}</style>${chromeLinkTag}</head><body class="has-glow">
<div class="rep-stickyhead no-print">
<div class="topbar no-print">
  ${homeHref ? `<a class="homebtn tb-back no-print" href="${escAttr(homeHref)}" title="All reports"><span aria-hidden="true">←</span> <span class="tb-back-lbl">All reports</span></a>` : ''}
  ${logoLockup({ mark: 20, tag: '' })}<span class="sp"></span>
  <span class="tb-risk" style="background:var(${overallStop})">${esc(overall ?? '—')}</span>
  <span class="mono tb-matter" style="font-size:11px;color:var(--faint)">${esc(matter || runId || '')}</span>
  ${issued ? `<span class="mono tb-issued"><span aria-hidden="true">🗓 </span>Issued ${esc(issued)}</span>` : ''}
</div>
</div>
<div class="fab-stack">${themeButton()}</div>
<script>
/* THE DOCUMENT'S OWN CONTROLS, and they are GLOBAL on purpose.
   The portal frames this document and drives it by postMessage. The bridge injected at serve time looks
   up exportPDF, pickAll and openAll BY NAME and replies "this report has no <verb>" when a name is not
   there. Every one of these lived inside an IIFE, so a knockout answered that to all three and every
   Export-menu item failed on every knockout ever published.
   pickAll IS STILL ABSENT, and that is the honest answer rather than an omission: this template has no
   input.pickbox anywhere, so a select-all would tick nothing. The shell reads what is defined here and
   offers only that, so an absent verb is an absent menu item instead of a control that fails.
   NO BACKTICKS IN THIS COMMENT. It sits inside a template literal, and a backtick ends it -- the failure
   arrives at IMPORT time naming a token nobody wrote (portal-report.test.mjs pins the same rule). */
function openAll(v){document.querySelectorAll('details.ko-full').forEach(function(d){d.open=!!v;});}
/* No tick filter — there is nothing to filter. The beforeprint handler below opens every collapsed
   narrative first, so what prints is the whole document rather than whatever happened to be expanded. */
function exportPDF(){window.print();}
(function(){var o=function(){openAll(true);};
if(window.matchMedia){var m=window.matchMedia('print');if(m.addEventListener)m.addEventListener('change',function(e){if(e.matches)o();});}
window.addEventListener('beforeprint',o);})();</script>
<div class="wrap">
  <header class="hero">
    ${demoBannerHtml(demoData === true)}
    ${confLineHtml(delivery, productName)}
    ${depthStrip(depthNote)}
    <h1 class="mark">${esc(title)}</h1>
    ${productContext ? `<p class="ko-classes" style="font-size:13.5px;margin:0 0 16px">${inlineMd(productContext)}</p>` : ''}
    ${aboutRequest}
    ${summary ? `<div class="sub">${mdParagraphs(summary)}</div>` : ''}
  </header>

  ${glance}
  ${onFieldSec}
  ${filingsSec}

  <div class="sec"><span class="num">${num()}</span><h2>Scope &amp; what we didn't search</h2><span class="note">what this screen is</span></div>
  <!-- COLLAPSED, like the clearance report's. Both documents already inline the
       same report.css, and details.scope is its vocabulary — this section was the one place the two
       lanes presented the same thing differently, with the knockout's open panel pushing the filings
       table and the footer down the page on every read. What is inside is unchanged; a reader who
       wants it opens it, exactly as they do on the bigger report.
       NO BACKTICKS IN THIS COMMENT: it sits inside a template literal and one ends it, failing at
       IMPORT time on a token nobody wrote. Second time in this file today. -->
  <details class="scope"><summary>Scope &amp; what we didn't search</summary>
  <div class="panel drillbody">
    ${(() => {
      // FROM THE POLICY WHERE THERE IS ONE. The fallback is not a tidy default: an
      // archived run froze no policy, and re-rendering it must not invent a scope claim about a run
      // nobody can now ask. It keeps the sentence it was delivered with.
      // ── THE SCOPE BLOCK, WHOLE ────────────────────────────────────────────────────────────────────
      //
      // The composed lines said one thing five times in 362 words: "not a clearance" three times,
      // "proceeds to clearance" twice, and the count-basis sentence a second time after the counts table
      // had already carried it. This is the owner's replacement text, and its two halves are the two
      // questions a reader of a screen actually has.
      //
      // "Every conflict above links to the material we found" STAYS CONDITIONAL and that is not a
      // stylistic carry-over: said unconditionally it is an absence claim wider than what was examined,
      // which this file refuses elsewhere in the same words. It prints only when every rendered conflict
      // cites something.
      const linked = citedFindings && !uncitedFindings
        ? ' Every conflict above links to the material we found.'
        : '';
      const source = registerCounts
        ? ` Register data: ${registerCounts.providerLabel ?? registerCounts.provider ?? 'the register'}.`
        : '';
      return `<p class="ko-scope"><b>What this is.</b> A fast screen for obvious blockers to using each `
        + `name, from marketplace and web use plus a count of register filings.</p>`
        + `<p class="ko-scope"><b>What it is not.</b> A clearance search. We drew no register conclusions `
        + `and give no filing advice. A name that passes here is not clear; it goes on to clearance.</p>`
        + `<p class="ko-scope">${linked.trim()}${linked ? ' ' : ''}The audit workbook holds every search run, `
        + `every empty result and the working notes.${source}</p>`;
    })()}
    ${newCaveats.length ? `<p class="ko-scope" style="border-top:1px solid var(--line)">${CAVEAT_LEAD}<br>${newCaveats.map((c) => inlineMd(c)).join('<br>')}</p>` : ''}
    ${auditFile ? `<p class="ko-scope" style="border-top:1px solid var(--line)"><a href="${escAttr(auditFile)}">Download the audit workbook (Excel)</a> — every search run, every negative result, and the working notes behind these ratings.${
    citedFindings ? ` The reference beside each common-law conflict above (for example <span class="mono">${esc(firstRef(marks, framework))}</span>) is its row on the workbook's Findings sheet.${
      registerCardCount ? ` A <span class="mono">REG</span> reference is a register filing rather than a common-law conflict — it has no Findings row, and its receipt is the register record the card links.` : ''}` : ''}</p>` : ''}
  </div>
  </details>

  <footer>
    <span>${productName ? `${esc(productName)}. ` : ''}${framework?.title ? ` Rated under <span class="mono">${esc(framework.title)}</span>.` : ''}<br>Matter ${esc(matter || runId || '')}.${issued ? ` Issued ${esc(issued)}.` : ''}</span>
    ${logoLockup({ mark: 16 })}
  </footer>
</div>
</body></html>`;
}

/**
 * report-data.json — the run, as data.
 *
 * Two readers, one file. The assistant drafts a client-facing email from it (which is why the retired
 * per-customer email template does not need to come back as config: formatting is judgement, and this is
 * the input judgement works from). And it is the shape the portal's unbuilt native-render path has been
 * looking for since before it had a writer — same filename, so building that path later is a read, not a
 * migration.
 *
 * It carries what the REPORT says, plus the level identity, and nothing internal: the audit workbook is
 * where the working notes live, and a data file that quietly re-admitted them would reopen exactly the
 * leak this series closed.
 */
export function knockoutReportData(findings, framework, { runId, codename, overall, issued, identity, registerCounts, registerRecords = null, ownerChecks = [], url, auditFile, customerKey, matter }) {
  const marks = findings?.marks ?? [];
  return {
    schema: 'report-data/1',
    runId,
    codename: codename || null,
    matter: matter || runId,
    customerKey: customerKey || 'generic',
    issued: issued || null,
    url: url || null,
    auditFile: auditFile || null,
    level: {
      searchLevel: identity?.level ?? null,
      stageLabel: identity?.stageLabel ?? null,
      identity: identity?.identity ?? null,
      // `banner` is NOT projected. It is stageLabel joined to identity, so on a retired row it carries a
      // depth rung — and report-data.json is a CLIENT surface (the portal's native render and the MCP
      // brief read it). The two fields it is made of are both here already; a consumer that wants the
      // internal face takes `stageLabel`, and nothing gets a pre-joined string that leaks one.
    },
    framework: framework ? { key: framework.framework_key, title: framework.title, bands: framework.bands.map((b) => ({ label: b.label, tone: b.tone })) } : null,
    overall: overall ?? null,
    summary: findings?.batch?.executiveSummary ?? null,
    productContext: findings?.batch?.productContext ?? null,
    caveats: findings?.batch?.standardCaveats ?? [],
    marks: marks.map((m) => {
      const counted = registerCounts ? countsForMark(registerCounts, m.name) : null;
      return {
        name: m.name,
        band: m.rating ?? null,
        qualifier: m.ratingQualifier ?? null,
        // WHAT THIS NAME IS FOR. Per MARK, not per batch — a character name and a
        // franchise title can sit at different bands on identical evidence, and the manner-of-use
        // calibration in the firm-wide reasoning turns on exactly this. It reached the plan and the
        // rater and stopped there: this projection is an explicit whitelist, so a field nobody adds is
        // a field the assistant drafting client mail never sees, however faithfully the rater carried
        // it. Null on an archived run that predates the frame carrying it.
        contextFraming: m.contextFraming ?? null,
        classesSearched: m.classesSearched ?? [],
        classesDriving: m.classesDriving ?? [],
        degraded: Boolean(m.degraded),
        points: m.bullets ?? [],
        // ── THE ASSESSMENT THE RUN ALREADY WROTE ──────────────────────────────────────────────────
        //
        // Seven keys the assess stage writes into knockout-findings.json reached this file as nothing.
        // They were not withheld by a rule — no code decided against them; this projection is an explicit
        // whitelist and nobody had added them, so an assistant drafting from this file could not see the
        // reasoning behind a rating it was drafting about.
        //
        // `assessment` is the sharpest case: publish substitutes it into `batch.executiveSummary` ONLY on
        // a multi-mark batch, so on a single-mark run — the common knockout — the mark's own opening read
        // was written, validated, and then dropped by both surfaces at once.
        //
        // `purpleNotes` is the reviewer's notes, and it is here by the owner's ruling of 2026-09-07: one
        // report, read by the person who ran Clearotron, because keeping material off it "just adds
        // confusion for where data is lost". They are LABELLED on the page rather than merged into the
        // client-voiced body — see reviewerNotesBlock — so a reader can tell whose voice they are in.
        assessment: (() => { const t = String(m.assessment ?? '').trim(); return t || null; })(),
        counterFactors: m.counterFactors ?? [],
        mitigation: (() => { const t = String(m.mitigation ?? '').trim(); return t || null; })(),
        // `null`, not `false`, when the rater said nothing: a crowded field is a mitigant the reasoning
        // turns on, and an unstated one must not read as a stated "no".
        crowdedField: typeof m.crowdedField === 'boolean' ? m.crowdedField : null,
        reviewerNotes: m.purpleNotes ?? [],
        // The proof-of-search rows — the same defensibility record list_searches answers from.
        negatives: (m.negatives ?? []).map((n) => ({
          term: n?.term ?? null, source: n?.source ?? null, note: n?.note ?? null,
        })),
        // The rater's read of a filing it weighed, keyed by the record id the card prints, so a consumer
        // can join a read to its filing without matching on prose.
        registerReads: (m.registerReads ?? []).map((x) => ({
          recordId: x?.recordId ?? null,
          read: x?.read ?? null,
          band: String(x?.band ?? '').trim() || null,
        })),
        // — the typed finding, ranked, with the reference the report prints. The old key was
        // `evidence[]` and it was `(m.findings ?? []).filter((f) => f?.url)`: a typed finding has no
        // `url`, so this file — the one the assistant drafts client mail from — silently carried zero
        // conflicts for a mark that had several. `shape` says which record each row came from, so a
        // reader can tell a typed run from an archived prose one without guessing at the blanks.
        findings: [
          ...knockoutFindingViews(m, { manifest: framework }).map((v) => ({
            ref: v.ref, ordinal: v.ordinal, name: v.name, owner: v.owner, band: v.band, type: v.type,
            net: v.lead, basis: v.detail, evidence: v.evidence, shape: v.shape,
          })),
          // — the promoted register filings, in the SAME array, from the SAME projection the page
          // renders from (registerCardViews). Two reasons it cannot live under its own key:
          //
          //  1. THE FLAG. portal-service.mjs resolves per-finding feedback as
          //     `data.marks[markIndex].findings.find(f => f.ordinal === ordinal)`, against the
          //     `data-ko-ord` the card carries. A card in the DOM with no row here resolves NOTHING and
          //     logs `resolved:false` — the reader's correction is captured against no facts, silently.
          //  2. THE BRIEF. mcp-server/lib/brief.mjs walks this array to write "Each name screened".
          //     A promoted filing the brief omitted would be the report and the brief disagreeing about
          //     what the run found.
          //
          // `shape: 'register'` is the load-bearing field: a consumer can tell a weighed conflict from a
          // pointed-at filing without parsing prose.
          //
          // `band` AND `basis` NOW CARRY THE RATER'S READ WHEN IT SENT ONE. Before
          // this, both were constants — `band: null` and the not-weighed sentence — on every filing of
          // every run, including runs where the seat had written a full read of that exact filing and the
          // HTML card was already printing it. The page and this file disagreed, and this file is the one
          // the MCP brief answers from, so the surface a reader asks "what did you make of that
          // registration?" was the surface that had dropped the answer.
          //
          // The unmatched case is unchanged and must stay that way: no row for this recordId ⇒ `band:
          // null` and the not-weighed line, which describes the card and claims nothing.
          ...registerCardViews(m, framework, registerRecords).cards.map((v) => {
            const row = (Array.isArray(m?.registerReads) ? m.registerReads : [])
              .find((x) => String(x?.recordId ?? '').trim() && String(x?.recordId ?? '').trim() === String(v.record?.recordId ?? '').trim());
            const read = String(row?.read ?? '').trim() || null;
            const band = String(row?.band ?? '').trim() || null;
            // The driver's own record of where this filing's proprietor was looked up, joined by
            // recordId. `null` where the run owed no check — the same three states the
            // card has, so a consumer can tell "searched and found nothing" from "never searched".
            const oc = ownerCheckFor(ownerChecks, v.record?.recordId);
            return {
              ref: v.ref, ordinal: v.ordinal, name: v.record.mark, owner: v.record.owner, band,
              type: 'Register filing',
              net: read ? v.statement : `${v.statement} It was ${NOT_WEIGHED}.`,
              basis: read ?? NOT_WEIGHED,
              useCheckSource: oc?.source ?? null,
              evidence: v.evidence, shape: 'register',
            };
          }),
        ],
        registerCounts: counted?.counts
          ? {
            classScope: counted.classScope ?? null,
            classes: counted.classes ?? [],
            ...Object.fromEntries(COUNT_PREDICATES.map((p) => [p.key, Number.isFinite(counted.counts[p.key]?.total) ? counted.counts[p.key].total : null])),
            // The close column is an aggregate, so the forms under it ride with it — a consumer that
            // got the number and not the forms could restate the figure but never explain it, and this
            // file is what the assistant drafts client mail from.
            closeVariationForms: (counted.counts.close?.forms ?? []).map((f) => f.form),
            closeVariationsLine: variantFormsLine(counted),
            line: countLine(counted),
          }
          : null,
        // part 5 — the filings behind the narrow counts, as data. The assistant drafts client mail
        // from this file, so it gets the SAME three states the report gets: rows, an answered nothing,
        // or a stated reason. `records: []` with no line beside it would be read as "no filings".
        registerFilings: (() => {
          const listed = registerRecords ? recordsForMark(registerRecords, m.name) : null;
          if (registerRecords?.unavailable) return { available: false, line: registerRecords.unavailable, records: [] };
          if (!listed) return null;
          return {
            available: true,
            line: recordsLine(listed),
            fetched: listed.fetched ?? (listed.records ?? []).length,
            capped: Boolean(listed.capped),
            records: (listed.records ?? []).map((r) => ({
              mark: r.mark, owner: r.owner, status: r.status, classes: r.classes ?? [],
              territory: r.territory, matchedForm: r.matchedForm, matchedBasis: r.matchedBasis,
              recordId: r.recordId, url: r.url,
            })),
            // Which searches did NOT answer, by name. A consumer that lists only `records` would report
            // a partial listing as a complete one.
            unanswered: (listed.terms ?? []).filter((t) => !t.ok).map((t) => ({ form: t.term, basis: t.basis, reason: t.reason ?? null })),
          };
        })(),
      };
    }),
    registerCountBasis: registerCounts ? COUNT_BASIS : null,
    registerFilingsBasis: registerRecords && !registerRecords.unavailable ? RECORD_BASIS : null,
    registerProvider: registerCounts ? (registerCounts.providerLabel ?? registerCounts.provider ?? null) : null,
  };
}
