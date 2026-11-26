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
// This module is a SIBLING of render.mjs, not an extension of it. render.mjs is single-mark shaped and
// built around a parsed report.md; a knockout is batch-shaped (`marks[]`, one row per name, no report.md at
// all). It takes two pieces from that file, the demo banner and the served-models line, so the two reports
// say those in one wording.
//
// Visual consistency does not come from sharing the renderer. It comes from sharing the DESIGN SYSTEM:
// shared/brand.mjs owns the tokens, the dark blocks, the theme init and the lockup; templates/report.css owns
// the layout vocabulary; page-shell.mjs owns the document both pages sit in. This file emits the same class
// names — .rep-stickyhead, .topbar, .wrap, .hero/.conf/.mark/.sub, .sec/.num/.note, .panel, footer — so the
// two reports track each other for free when either is restyled. The shell used to be ~60 lines duplicated
// here, because exporting it out of the hash-frozen clearance renderer cost more than the copy; the freeze
// is gone and the shell is shared.
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
  themeButton, THEME_BTN_CSS, CHROME_CSS, logoLockup, confPosture,
} from '../../shared/brand.mjs';
import { reportPage } from './page-shell.mjs';   // the one report frame, shared with the clearance template
import { hrefAttr } from './attr.mjs';   // the workbook beside the page, linked as the clearance links it
import { escapeAttr } from '../../shared/html-escape.mjs';
import { inlineMarkdown } from '../../shared/inline-markdown.mjs';   // the inline-markdown dialect, shared with the clearance template
import { SUMMARY_BLOCK_LINE, parseSummaryBlocks } from '../../shared/summary-blocks.mjs';

// THIS BOARD'S FOUR ENTRIES, in its order. Its third reads "Also considered" and resolves at the filings
// section, which is what that section is; the rule that filters them against the finished document lives
// in shared/brand.mjs, beside the clearance report's own five.
const STRIP = Object.freeze([
  ['summary', K.strip.summary], ['findings', K.strip.findings], ['filings', K.strip.filings], ['next', K.strip.next],
]);
import { COUNT_BASIS, COUNT_PREDICATES, countsForMark, countLine, variantFormsLine, disclosedFloor, moreThan, countNote } from '../register-count.mjs';
import { recordBasisOf, readByJudgment, noneCarriedForward, NONE_CARRIED_FORWARD, recordsForMark, recordsLine } from '../register-records.mjs';
import { officeLinkSentences, officeRecordLink } from './office-record-links.mjs';
import { knockoutFindingViews, splitKnockoutNotes, KNOCKOUT_CARD_ORDER } from '../findings-model.mjs';
import { inputsLine } from '../framework-method.mjs';
import { demoBannerHtml, servedModelsLine, coverageGrid } from './render.mjs';   // — the SAME banner the clearance template renders, not a second wording
import { EXPORT_TOGGLE, exportPopover, EXPORT_MENU_JS } from './report-topbar.mjs';   // — the export menu's shell and behaviour, shared with the clearance template   // — the SAME banner the clearance template renders, not a second wording
// — the two facts the register card is allowed to read off a raw record, and NEITHER is minted
// here. `makeClassifyStatus` and `isAllClass` are the screening lane's own, already shipped, already
// fail-open; re-deriving either in a renderer would be this file starting a second status vocabulary,
// which is the thing providers/_shared/screen.mjs exists to prevent.
import { makeClassifyStatus, isAllClass } from '../../providers/_shared/screen.mjs';
import { saysSomethingNew } from '../../shared/says-something-new.mjs';
import OFFERED from '../../shared/offered-territories.json' with { type: 'json' };   // the order form's own territory names
import { normalizeTerritory } from '../../providers/_shared/territory-codes.mjs';   // a territory as written → its code
import { KNOCKOUT_PAGE as K } from './strings.mjs';
import { knockoutLeftOpenOf } from './knockout-left-open.mjs';   // a name's Left open rows, one projection for every reader
import { recordEntryHtml, logoFigureHtml } from './register-record-html.mjs';   // a record entry and a logo, drawn once for both report pages
import { RECORD_LABELS } from './register-record.mjs';
import { REC, ownerDisplayName, normalizeRecordUri } from '../registry-fidelity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// One escaper for text and attribute values alike, since this template does not keep the two apart.
const esc = escapeAttr;
const escAttr = escapeAttr;
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
// COPY LINK, as on a clearance card (owner, 2026-11-25): inside the portal only, shown by the frame bridge, never printed.
const COPY_ICONS = '<svg class="ci-link" width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a3 3 0 004.2.3l2-2a3 3 0 00-4.2-4.2l-1 1"/><path d="M8 6a3 3 0 00-4.2-.3l-2 2a3 3 0 004.2 4.2l1-1"/></svg><svg class="ci-tick" width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7"/></svg>';
const copyLinkButton = () => `<button type="button" class="copy-fi no-print" data-copied="${escAttr(K.finding.copied)}">${COPY_ICONS}<span>${esc(K.finding.copyLink)}</span></button>`;
// A card's own address on the page: a Knockout numbers its findings again for each name, so the name's position leads.
const koCardId = (markIndex, ordinal) => `k${Number(markIndex)}-${Number(ordinal)}`;
const linkOrText = (u) => (isHttpUrl(u) ? `<a href="${escAttr(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u));
// The audit workbook's link, attribute-safe: the portal's route where the publisher hands one in, else the workbook's
// own file name beside the page, else none.
const workbookHref = (route, file) => (isHttpUrl(route) ? escAttr(route) : hrefAttr(file, { relative: true }));

// A listed filing's record as its office publishes it, where the run's register has no page of its own:
// publish sets `officeLink` from the filing's own numbers (office-record-links.mjs). The label is the
// office and the number, linked where the office has a page. The handle names the vendor's record, not
// the office's, and a reader can look it up nowhere. A filing with no number shows `fallback`, as before.
const officeRecordCell = (r, fallback, label = null) => {   // `label` prints in place of the office's own, escaped like it
  const l = r?.officeLink;
  if (!l?.label) return fallback;
  return l.href ? `<a href="${escAttr(l.href)}" target="_blank" rel="noopener noreferrer">${esc(label ?? l.label)}</a>` : esc(label ?? l.label);
};

// Minimal inline markdown, escaped FIRST. The old renderer ran esc() and nothing else, so a batch
// summary reading `BRIMSTONE rates **High (Classes 9, 28, 41)**.` rendered its asterisks verbatim —
// the model writes markdown because every other surface it feeds renders markdown.
// The dialect is the one the clearance reads too (shared/inline-markdown.mjs), links included.
export function inlineMd(s) {
  return inlineMarkdown(esc(String(s ?? '')));
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

export const DEGRADED_NOTE = K.degradedNote;

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
const QUALIFIER_WORDS = K.qualifier;
function qualifierHtml(q) {
  const word = String(q ?? '').trim();
  if (!word) return '';
  const said = QUALIFIER_WORDS[word.toLowerCase()] ?? K.qualifierOther(word);
  return `<span class="ko-qual">${esc(said)}</span>`;
}

// The layout this report adds on top of report.css, kept in templates/knockout.css. Additive and `ko-`prefixed:
// report.css is shared with the clearance renderer, and a selector that is inert there cannot regress it.
const KO_CSS = '\n' + readFileSync(join(HERE, 'templates', 'knockout.css'), 'utf8');   // the file's text, after the line break the sheet always began with


/** The batch's display title: the mark itself when a screen covered one name, else the count. */
function batchTitle(marks) {
  if (marks.length === 1) return marks[0].name ?? '';
  return K.names(marks.length);
}

// Spine mapping (spec 2026-07-30 §3, charter ruling 1: renames ruled OK): the per-name verdict rows
// ARE the hero at this depth, so the old "01 Names at a glance" heading goes and the rows render
// UNNUMBERED straight under the hero. Counts + per-name reads merge into ONE numbered section named
// like the clearance spine ("On-field conflicts" — counts are the D2 form of "who is in the way"),
// and "Scope & method" takes the clearance Scope name. Same names, same order, fewer rows.
// A NAME'S BAND COLUMN: its one band and classes, or where the evidence divides them, a band and its classes per
// group, in the order the merged gate left them, highest first. The same chip and the same line either way, so no
// words are added. A mark with no groups, which is every archived run, keeps its markup byte for byte.
function bandColumn(m, framework) {
  const chip = (band, qualifier, classes) => `<span class="ko-band" style="background:var(${bandStop(framework, band)});color:var(${bandStop(framework, band)}-on)">${esc(band ?? '—')}</span>
        ${qualifierHtml(qualifier)}
        ${classes?.length ? `<p class="ko-classes">${esc(K.classes(classes.join(', ')))}</p>` : ''}`;
  if (!Array.isArray(m.classGroups) || !m.classGroups.length) return chip(m.rating, m.ratingQualifier, m.classesSearched);
  return m.classGroups.map((g) => chip(g.band, g.ratingQualifier, g.classes)).join('\n        ');
}

function glanceSection(marks, framework, registerCounts) {
  const rows = marks.map((m) => {
    const counted = registerCounts ? countLine(countsForMark(registerCounts, m.name)) : null;
    return `<div class="ko-row">
      <div>
        <p class="ko-name">${esc(m.name)}</p>
        ${bandColumn(m, framework)}
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
    ? '' /* The 2026-09-16 report redesign — the framework is named once, on the rating card */
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
const REGISTER_NAMES = K.registerNames;

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

/** A territory the order names, in the order form's own words, or '' when that list has no such code. */
const ORDER_FORM_NAMES = new Map([...OFFERED.regions, ...OFFERED.countries].map((t) => [t.code, t.name]));
const orderedTerritoryName = (code) => {
  const c = String(code ?? '').trim().toUpperCase();
  // EM is the European Union register's own code, and some records carry it for an EU order.
  return ORDER_FORM_NAMES.get(c === 'EM' ? 'EU' : c) ?? '';
};

/**
 * A territory as the order wrote it, as a code. An order carries a code ("EU", "UK") or a country's name
 * ("Norway"), and both name lookups on this page take codes: a name reached them unconverted, came back
 * empty and left the page without a trace (a delivered knockout, 2026-10-08, named two of the four
 * territories it searched). The shared normaliser turns a name into its code; UK is the order form's GB.
 */
const orderCode = (t) => {
  const c = normalizeTerritory(t) || String(t ?? '').trim().toUpperCase();
  return c === 'UK' ? 'GB' : c;
};

/** "a, b and c" — the reader's list, not a join on commas. */
function listWords(items) {
  const xs = (items ?? []).filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return K.listEnd(xs.slice(0, -1).join(', '), xs[xs.length - 1]);
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
  const provider = registerCounts?.providerLabel ?? registerCounts?.provider ?? K.counted.theRegister;
  const regions = (registerCounts?.scope?.regions ?? []).filter(Boolean);
  const worldwide = registerCounts?.scope?.worldwide === true || regions.length === 0;
  if (worldwide) {
    const n = regions.length;
    return n
      ? K.counted.worldwideOn(n, provider)
      : K.counted.worldwide(provider);
  }
  const named = regions.map(territoryName).filter(Boolean);
  if (named.length && named.length <= TERRITORY_NAME_CAP) {
    return K.counted.named(listWords(named), provider);
  }
  return K.counted.listed(regions.length, provider);
}

// The reader line that used to sit under the counts table ("a count is not a conflict…") is off the page:
// the approved knockout board carries no caveat under the table, and the writing standard lists it among
// the caveat sentences a page does not print. The column headers say what each count is.

function countsSection(marks, registerCounts, positions = '') {
  // ── THE DEFINITION MOVES INTO THE COLUMN HEADER ──────────────────────────────────────────────────
  //
  // The 70-word count-basis paragraph existed because three one-word headers — Identical, Containing,
  // Close variations — did not say what they counted, so the definition had to go somewhere. Put it in
  // the header and the paragraph has nothing left to do.
  //
  // ONE NAME ⇒ THE HEADER NAMES IT, because "Exactly ACME" needs no gloss at all. Several names share
  // one table and no header can name one of them, so they keep the general form and each row's own
  // forms line (already rendered, unchanged) carries that row's near-spellings.
  const single = marks.length === 1 ? String(marks[0]?.name ?? '').trim() : '';
  const forms = single
    ? ((countsForMark(registerCounts, single)?.counts?.close?.forms ?? []).map((f) => String(f?.form ?? '').trim()).filter(Boolean))
    : [];
  const headLabel = (pk) => {
    if (pk === 'identical') return single ? K.counts.exactly(single) : K.counts.exactlyTheName;
    if (pk === 'containing') return single ? K.counts.contains(single) : K.counts.containsTheName;
    return forms.length ? K.counts.nearSpellingsOf(forms.join(', ')) : K.counts.nearSpellings;
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
      const why = countNote(c) ?? (c
        ? K.counts.noCountRecorded
        : K.counts.notCountedThisRun);
      if (Number.isFinite(c?.total)) return `<td class="num">${esc(String(c.total))}</td>`;
      // The register answered with its own floor: that is a figure, and it is printed as one.
      if (disclosedFloor(c) !== null) return `<td class="num">${esc(moreThan(disclosedFloor(c)))}</td>`;
      return `<td class="na" title="${escAttr(why)}">${K.counts.notAvailable}</td>`;
    }).join('');
    const scoped = e?.classScope !== 'all-classes' && (e?.classes?.length > 0);
    const scope = scoped
      ? K.counts.inClasses(e.classes.join(', '))
      : K.counts.allClasses;
    // The forms the close column was counted over. A number whose forms are not on the page cannot be
    // checked by the reader it was written for, which makes it a claim rather than a measurement.
    const forms = variantFormsLine(e);
    return `<tr><td><b>${esc(m.name)}</b><br><span class="ko-classes">${esc(scope)}</span></td>${cells}</tr>`
      // The line sits in a block of its own so a phone can hold it to the card's visible width (knockout.css).
      + (forms ? `<tr class="ko-forms"><td colspan="${COUNT_PREDICATES.length + 1}"><div class="ko-formsline">${esc(forms)}</div></td></tr>` : '');
  }).join('');
  // COUNT_BASIS IS OFF THE PAGE, NOT OUT OF THE RECORD. It is still written to
  // report-data.json (knockoutReportData -> registerCountBasis) and still on the workbook, which is where
  // 331 says it belongs; what it stops doing is printing twice on a page whose headers now say the same
  // thing in three words each.
  return `<div class="panel">
  <div class="ko-counts ko-scroll"><table><thead><tr><th>${K.counts.name}</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  <p class="ko-basis">${esc(territoriesLine(registerCounts))}${
    positions ? `<br>${esc(positions)}` : ''}</p>
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
/**
 * THE FILINGS A NAME'S TABLE SHOWS: its listing in the run's own order of materiality, at most APPENDIX_ROWS. The page
 * draws these rows, and the logo step asks for logos for these alone (mark-logos.mjs), so no logo is paid for that no
 * reader sees. PURE.
 */
export function shownFilings(entry, mark) {
  return rankByMateriality(entry?.records, entry, mark).slice(0, APPENDIX_ROWS);
}
// EACH LISTED FILING OPENS ITS REGISTER RECORD (owner, 2026-11-18; the approved board). A filing whose record the
// run saved gets a closed drop-down in a row under its table row, the same entry a clearance card draws, and its
// logo, where the run saved one, on a line of its own under the mark name, uncaptioned because the Territory
// column names the register. A filing with no saved record keeps its single row, so a run that saved none renders
// as it did.
function filingRows(r, { filingRecords, logos }) {
  const key = normalizeRecordUri(r.recordId);
  const rec = key ? filingRecords.get(key) : null;
  const cell = officeRecordCell(r, r.url ? linkOrText(r.url) : esc(r.recordId ?? '—'));
  const logo = rec ? logoFigureHtml(rec, { uri: key, logo: logos.get(key), href: r.officeLink?.href ? escAttr(r.officeLink.href) : null, caption: false }) : null;
  const row = `<tr${rec ? ' class="rr-has"' : ''}>
      <td>${esc(r.mark ?? '—')}${r.matchedBasis === 'close' ? `<br><span class="ko-classes">${esc(K.filings.foundAs(r.matchedForm))}</span>` : ''}${logo ? `<div class="rr-logos rr-ko">${logo}</div>` : ''}</td>
      <td>${esc(r.owner ?? '—')}</td>
      <td>${esc(r.status ?? '—')}</td>
      <td>${esc((r.classes ?? []).join(', ') || '—')}</td>
      <td>${esc(r.territory ?? '—')}</td>
      <td class="ko-findev">${cell}</td>
    </tr>`;
  if (!rec) return row;
  const ownerName = ownerDisplayName({ raw: REC.owner(rec), native: REC.ownerNative(rec), resolved: r.owner });
  const fallback = r.url ? linkOrText(r.url) : esc(r.recordId ?? '—');
  const number = { label: r.officeLink?.label ?? null, fallbackText: r.url ?? r.recordId ?? '', cell: (label) => officeRecordCell(r, fallback, label) };
  const entry = recordEntryHtml(rec, { uri: key, jurisdiction: r.territory, number, ownerName });
  return `${row}<tr class="rr-krow"><td colspan="6"><details class="drill rr-drill"><summary>${esc(RECORD_LABELS.title)}</summary><div class="drillbody">${entry}</div></details></td></tr>`;
}

function filingsSection(marks, registerRecords, records = { filingRecords: new Map(), logos: new Map() }) {
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
        <div><p class="ko-bul">${esc(line ?? K.filings.noListing)}</p></div></div>`;
    }
    // RANKED, AND DELIBERATELY NOT FILTERED. This table is the evidence behind a
    // COUNT: dropping a cancelled or out-of-class row would leave a reader unable to reconcile the table
    // with the number above it, and "we did not show you that one" is a different promise from "it is
    // not material". The cards promote and therefore filter; the appendix evidences and therefore ranks.
    const shown = shownFilings(e, m);
    const rows = shown.map((r) => filingRows(r, records)).join('');
    // "First N" WAS TRUE AND IS NOT ANY MORE, and saying it of a ranked table would be worse than the
    // cap: it invites the reader to take the sample for the top of the provider's list. Say the count
    // that exists, say what decided the order, and say where the rest is.
    const more = e.records.length > shown.length
      ? K.filings.showing(shown.length, e.records.length, readByJudgment(registerRecords) ? K.filings.otherSearches : K.filings.closeVariations)
      : K.filings.sameRows;
    return `<div class="ko-filings">
      <p class="ko-name">${esc(m.name)}</p>
      <div class="ko-counts ko-scroll"><table><thead><tr><th>${K.filings.head.trademark}</th><th>${K.filings.head.owner}</th><th>${K.filings.head.status}</th><th>${K.filings.head.classes}</th><th>${K.filings.head.territory}</th><th>${K.filings.head.record}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="ko-basis">${esc(line ?? '')}${esc(more)}</p>
    </div>`;
  }).join('');
  return `<div class="panel ko-glance">${blocks}<p class="ko-basis">${esc(recordBasisOf(registerRecords))}${officeLinkNote(registerRecords)}</p></div>`;
}

// Once, under the filings: what a linked number opens and, per office, why the rest are cited by number.
// The clearance's own sentences, said once for the reason it says them once: a note repeated beside every
// filing reads as a broken report. Empty unless a filing carries an office number.
function officeLinkNote(registerRecords) {
  const links = (registerRecords?.marks ?? []).flatMap((m) => m?.records ?? []).map((r) => r?.officeLink).filter(Boolean);
  return officeLinkSentences(new Map(links.map((l, i) => [i, l]))).map((s) => ` ${esc(s)}`).join('');
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
    ? K.tierAbsence.probeRan
    : K.tierAbsence.notInTier;
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
const WHY_BAND_LABEL = K.riskAssessment;   // the clearance's word for the reasoning (owner, 2026-11-18)

/**
 * The band chip's text. A framework that states a method shows its inputs beside the band, in its own
 * labels and order ("Medium · Tier 2 · Contested"); every other framework's chip is the
 * band alone, exactly as before. The finding card and the register card both print through here, so a
 * rated conflict reads the same whichever kind of card carries it.
 */
function bandChipText(band, method, inputs) {
  const line = inputsLine(method, inputs);
  return line ? `${esc(band)} · ${esc(line)}` : esc(band);
}

// A CARD CITES A FILING THE WAY THE FILINGS TABLE DOES. A conflict card's evidence held the register vendor's record
// path (/mark/em/…), which opens nothing and no register accepts, while the filings table on the same page printed the
// same filing by office and number, linked where the office has a page. An entry naming a filing the run holds now
// prints that table cell. An entry naming one it does not hold is read only where the run's register puts the office's
// own number in the path: the EUIPO's application number and the USPTO's serial. Clarivate and Signa put their own
// record id there and Corsearch its own id with a class suffix, and a vendor id printed as the office's number would be
// a citation no office can find, so those print as before. A web address stays a link.
const OWN_NUMBER_OFFICE = Object.freeze({ euipo: 'eu', 'uspto-local': 'us' });
export function filingsByHandle(registerRecords) {
  const byHandle = new Map();
  for (const r of (registerRecords?.marks ?? []).flatMap((m) => m?.records ?? [])) {
    if (r && typeof r === 'object' && r.recordId) byHandle.set(String(r.recordId).trim().toLowerCase(), r);
  }
  return byHandle;
}
function evidenceCell(u, { filings = null, provider = null } = {}) {
  if (isHttpUrl(u)) return linkOrText(u);
  const handle = String(u ?? '').trim();
  const r = filings?.get(handle.toLowerCase());
  if (r) return officeRecordCell(r, r.url ? linkOrText(r.url) : esc(r.recordId ?? handle));
  const office = OWN_NUMBER_OFFICE[provider];
  const own = office ? new RegExp(`^/mark/${office}/([A-Za-z0-9]+)$`, 'i').exec(handle) : null;
  const link = own ? officeRecordLink({ office, applicationNumber: own[1] }) : null;
  return link?.label ? officeRecordCell({ officeLink: link }, esc(handle)) : esc(handle);
}

function findingBlock(v, framework, markIndex, method = null, cite = {}) {
  const meta = [v.type, v.owner].filter(Boolean).map((s) => esc(s)).join(' · ');
  const ev = v.evidence.map((u) => evidenceCell(u, cite)).join(' · ');
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
  return `<div class="card ko-find" id="${koCardId(markIndex, v.ordinal)}" data-ko-mark="${Number(markIndex)}" data-ko-ord="${Number(v.ordinal)}">
        <div class="top">
          <div class="rail" style="background:var(${stop})"></div>
          <div class="body">
            <div class="cardhead">
              <span class="fnum">${esc(v.ref)}</span><h3 class="who">${esc(v.name ?? K.finding.unnamed)}</h3>${
    v.band ? `<span class="ko-findband" style="background:var(${stop});color:var(${stop}-on)">${bandChipText(v.band, method, v.inputs)}</span>` : ''}${sourceChips(v)}
              <span class="fi-acts no-print">${copyLinkButton()}<button class="ask-fi no-print">${K.finding.askAi}</button></span>
            </div>
            ${meta ? `<p class="ko-findmeta">${meta}</p>` : ''}
            ${v.lead ? `<p class="ko-findnet">${inlineMd(v.lead)}</p>` : ''}
            ${/* The 2026-09-16 report redesign — head, meta and the one-line read stay visible; the rest folds, as on
                 a clearance card, so a screen of many names reads as a screen. */''}
            ${(v.detail || ev) ? `<details class="drill"><summary>${K.finding.fullDetail}</summary><div class="drillbody">${
      whyBandFold(v.detail ? `<p class="ko-findbasis">${inlineMd(v.detail)}</p>` : '')}${
      ev ? `<p class="ko-findev">${K.finding.sources}${ev}</p>` : ''}</div></details>` : ''}
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
export const NOT_WEIGHED_LINE = K.filingCard.notWeighed;
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
  return `${where}${kind === 'registration' ? K.filingCard.registration : K.filingCard.application}${bracket}`.trim();
}

function registerStatement(r, provider) {
  const name = String(r?.mark ?? r?.name ?? '').trim();
  const classes = (Array.isArray(r.classes) ? r.classes : []).filter((n) => Number.isFinite(Number(n)));
  const lead = [name, registerRightPhrase(r)].filter(Boolean).join(', ');
  const owner = r.owner ? K.filingCard.by(r.owner) : K.filingCard.ownerNotStated;
  const cls = classes.length
    ? K.filingCard.classes(classes.length, classes.join(', '))
    : K.filingCard.classesNotStated;
  // A close-variation card says WHICH near-form matched, because the name at the head of the sentence is
  // then not the name the client asked about and a reader must not have to guess which it is. A filing the reading
  // step found names its question, and that question may be a wider search, which is no close variation.
  const via = r.matchedBasis === 'close' && r.matchedForm ? (r.question ? K.filingCard.foundBySearch(r.matchedForm) : K.filingCard.foundUnderVariation(r.matchedForm)) : '';
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

export function registerCardViews(mark, framework, registerRecords) {
  if (!registerRecords || registerRecords.unavailable) return { cards: [], entry: null, promoted: 0 };
  const entry = recordsForMark(registerRecords, mark?.name);
  if (!entry) return { cards: [], entry: null, promoted: 0 };
  const promoted = promotableRecords(entry, mark);
  const typed = knockoutFindingViews(mark, { manifest: framework });
  const floor = Math.max(REGISTER_ORDINAL_FLOOR, ...typed.map((v) => Number(v.ordinal) || 0));
  const markName = String(mark?.name ?? '').trim();
  const provider = registerRecords.providerLabel ?? registerRecords.provider ?? K.counted.theRegister;
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
  return `${commonLaw ? `<span class="src cl">${K.chips.commonLaw}</span>` : ''}${register ? `<span class="src reg">${K.chips.register}</span>` : ''}`;
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

// The clearance lane's own label, copied rather than re-worded. One spelling across
// both products is the point: a reader who has seen it on a clearance report knows what it means here.
const USE_CHECK_LABEL = K.filingCard.useCheckLabel;

// WHAT THE CARD SAYS OF AN OWNER LOOKUP, read from the lookup's own outcome (owner-use-check.mjs), never from a marker:
// a lookup that failed or was refused, and a completed answer that carries no link, used to print the same "no result"
// literal, and neither shows a search that found nothing. The words are the owner's (approved 2026-10-28). A lookup's
// row with a link cites it. A completed search that found nothing keeps the existing no-result line, and no lookup
// today gives a sign of one beyond a missing link, which alone does not establish it.
export const USE_CHECK_UNAVAILABLE = K.filingCard.useCheckUnavailable;
export const USE_CHECK_LINK_UNAVAILABLE = K.filingCard.useCheckLinkUnavailable;
/** A lookup's outcome: "linked" with its link, "no-link", or "unavailable". `null` when no lookup was owed. PURE. */
export function ownerCheckOutcome(row) {
  if (!row) return null;
  if (row.ok !== true) return { kind: 'unavailable' };
  return isHttpUrl(row.source) ? { kind: 'linked', url: row.source } : { kind: 'no-link' };
}
/** The card's line for a lookup, after its label where it has one. PURE. */
export const ownerCheckText = (o) => !o ? null : o.kind === 'unavailable' ? USE_CHECK_UNAVAILABLE
  : o.kind === 'linked' ? o.url : USE_CHECK_LINK_UNAVAILABLE;

/** The owner lookup covering a filing, joined by recordId. `null` when this run owed that filing none. */
export function ownerCheckFor(ownerChecks, recordId) {
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
function aboutRequestBlock(scope, requestNotes, depthNote = '', productContext = '', searched = '', registerCounts = null) {
  const goods = String(scope?.goods ?? '').trim();
  const classes = (Array.isArray(scope?.classes) ? scope.classes : []).filter((c) => c || c === 0);
  const jx = (Array.isArray(scope?.jurisdictions) ? scope.jurisdictions : []).map((t) => territoryName(orderCode(t))).filter(Boolean);
  const asked = goods;
  const classLine = classes.length ? classes.join(', ') : '';
  const where = jx.length ? listWords(jx) : '';
  // The type of search is the bolded head of the depth note; the rest of that sentence is the product's
  // covers line, which the owner ruled off the page.
  const note = String(depthNote ?? '').trim();
  const cut = note.lastIndexOf(' \u2014 ');
  const stage = cut > 0 ? note.slice(0, cut).trim() : note;
  const context = String(productContext ?? '').trim();
  // REGISTERS COUNTED IS A ROW (the 2026-09-16 report redesign). A line of country names running through
  // the middle of the panel is the thing a reader skips; the count and its source are what they read.
  const regions = (registerCounts?.scope?.regions ?? []).filter(Boolean);
  const provider = registerCounts?.providerLabel ?? registerCounts?.provider ?? '';
  // THE ORDER'S TERRITORIES, NOT THE PROVIDER'S REGISTERS (owner, 2026-09-19). The row counted the
  // registers the provider searched, and for a one-country order that is not one: a United States order is
  // counted over the United States and the international register, because an international filing can
  // designate the United States. A client who ordered one country read "2 registers" as a mistake. So an
  // order that names its territories is stated as it named them, in the order form's own names; the
  // registers actually counted stay in the line under the counts table. A worldwide order keeps the board's
  // row, "186 registers, on Clarivate Compumark.", because there the count is the scope (the record says
  // worldwide by carrying no jurisdictions). A territory the provider does not cover was not counted, so it
  // is not listed here; it is disclosed where deferrals are. A territory the form's list cannot name, or an
  // office this install could not reach, falls back to the count rather than printing a code or claiming
  // a territory nothing was counted in.
  const on = provider ? K.about.on(provider) : '';
  const sc = registerCounts?.scope ?? {};
  const deferred = new Set((sc.deferredJurisdictions ?? []).map(orderCode));
  const ordered = [...new Set((sc.jurisdictions ?? [])
    .filter((c) => !deferred.has(orderCode(c))).map((c) => orderedTerritoryName(orderCode(c))))];
  const namesTheOrder = sc.worldwide !== true && !(sc.unreachableOffices ?? []).length
    && ordered.length > 0 && ordered.every(Boolean);
  const counted = namesTheOrder ? `${listWords(ordered)}${on}.`
    : regions.length
      ? `${K.about.registers(regions.length)}${on}.`
      : (registerCounts ? `${K.about.countedWorldwide}${on}` : '');
  if (!asked && !where && !classLine && !stage && !context && !counted) return '';
  // ONE PANEL, THE SAME ON BOTH REPORTS (the 2026-09-16 report redesign). The rows carry what was asked for; the
  // counts row says what was counted and hides the territory list behind a fold rather than running a
  // line of country codes through the middle of the panel.
  const row = (k, v, extra = '') => v ? `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}${extra}</span></div>` : '';
  return `<div class="panel about">
      <div class="label">About this request</div>
      ${row(K.about.typeOfSearch, stage)}
      ${row(K.about.instructedUse, asked)}
      ${row(K.about.classes, classLine)}
      ${row(K.about.whereSearched, where)}
      ${row(K.about.context, context)}
      ${row(K.about.registersCounted, counted)}
      ${row(K.about.searchedOn, searched)}
      ${/* item 18 — a note for the reviewing lawyer does not reach the delivered page */''}
    </div>`;
}

function reviewerNotesBlock(m) {
  const notes = splitKnockoutNotes(m).name;
  if (!notes.length) return '';
  // Item 18 (owner, 2026-09-16): the reviewing lawyer's notes stay in the working record, the audit
  // workbook and the assistant. They were styled as a visible block on the page a client opens.
  return '';
}

// THE FILING'S LOGO ON ITS CARD (owner, 2026-11-25): one "Register" frame holding that filing's logo where the run fetched
// one, captioned with its register as a clearance card's logo is, with the alt text and the office link the filings table
// gives it. A filing the run holds no record of, or whose logo did not arrive, draws no frame.
function filingLogoFrame(r, { filingRecords = new Map(), logos = new Map() } = {}) {
  const key = normalizeRecordUri(r?.recordId);
  const rec = key ? filingRecords.get(key) : null;
  const fig = rec ? logoFigureHtml(rec, { uri: key, logo: logos.get(key), href: r.officeLink?.href ? escAttr(r.officeLink.href) : null, caption: true }) : null;
  return fig ? `<div class="pic-line"><div class="pic-set"><div class="pic-head"><span class="pic-lab">${esc(K.pictures.register)}</span></div><div class="rr-logos rr-band">${fig}</div></div></div>` : '';
}

/** The filings a name's register cards draw, for the logo step to ask about as it asks about the table's rows. */
export function cardFilings(registerRecords, mark, framework) {
  return registerCardsOnPage(registerCardViews(mark, framework, registerRecords).cards, mark, framework).map((v) => v.record);
}

function registerFindingBlock(v, markIndex, reads = null, framework = null, ownerChecks = [], method = null, pictures = {}) {
  const r = v.record;
  // — THE RATER'S OWN READ OF THIS FILING, when it recorded one. `registerReads` is
  // joined to the record store by the validator, so a row that reaches here names a filing this run
  // actually holds. With no row the neutral line stands, and the neutral line is TRUE: it describes the
  // card. That is why the field can be optional without the page ever asserting something false.
  const row = (Array.isArray(reads) ? reads : [])
    .map((x) => ({ id: String(x?.recordId ?? '').trim(), text: String(x?.read ?? '').trim(), band: String(x?.band ?? '').trim(), inputs: x?.inputs ?? null }))
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
  const useCheck = ownerCheckOutcome(ownerCheckFor(ownerChecks, r?.recordId));
  const useCheckLine = !useCheck ? ''
    : useCheck.kind === 'unavailable' ? esc(USE_CHECK_UNAVAILABLE)
    : `${esc(USE_CHECK_LABEL)} ${useCheck.kind === 'linked' ? linkOrText(useCheck.url) : esc(USE_CHECK_LINK_UNAVAILABLE)}`;
  const meta = [r.owner ? esc(r.owner) : K.filingCard.proprietorNotStated, r.territory ? esc(r.territory) : null]
    .filter(Boolean).join(' · ');
  const receipt = officeRecordCell(r, isHttpUrl(r.url) ? linkOrText(r.url) : esc(r.recordId ?? K.filingCard.noRecordAddress));
  return `<div class="card ko-find" id="${koCardId(markIndex, v.ordinal)}" data-ko-mark="${Number(markIndex)}" data-ko-ord="${Number(v.ordinal)}">
        <div class="top">
          <div class="rail" style="background:var(${stop ?? '--faint'})"></div>
          <div class="body">
            <div class="cardhead">
              <span class="fnum">${esc(v.ref)}</span><h3 class="who">${esc(r.mark ?? K.filingCard.unnamed)}</h3>${
    band ? `<span class="ko-findband" style="background:var(${stop});color:var(${stop}-on)">${bandChipText(band, method, row?.inputs)}</span>` : ''}<span class="src reg">${K.chips.register}</span>
              <span class="fi-acts no-print">${copyLinkButton()}<button class="ask-fi no-print">${K.finding.askAi}</button></span>
            </div>
            <p class="ko-findmeta">${meta}</p>
            ${filingLogoFrame(r, pictures)}
            <p class="ko-findnet">${esc(v.statement)}</p>
            ${/* The 2026-09-16 report redesign — the head, the meta line and the one-line read stay visible; the rest
                 sits behind a fold, as it does on a clearance card, so a screen of many names reads as a
                 screen rather than as a wall. */''}
            <details class="drill"><summary>${K.finding.fullDetail}</summary><div class="drillbody">
            ${basisLine(band, read)}
            ${useCheckLine ? `<p class="ko-findev">${useCheckLine}</p>` : ''}
            <p class="ko-findev">${K.filingCard.registerRecord}${receipt}</p>
            </div></details>
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

// — THE REGISTER SENTENCE IS THE RENDERER'S, and it is the whole reason the clause below exists.
//
// A live run printed "the register overlay has not been run" in model prose directly under a table of
// register counts the same run had taken. The model was not lying: it cannot see the count lane, it is
// deliberately never shown the figures (register-count.mjs rule 1), and it filled the gap with the only
// thing it had. The fix is not a better prompt — it is that nobody who cannot see the machinery gets to
// describe it. The validator forbids the model from saying anything about register coverage; this
// clause says it, from the artifacts.
//
// — IT STATES THE POSITION, NOT ONLY THE COVERAGE. Coverage alone ("hit-counts were taken for this
// name") answers a question nobody asked; the question a reader holds is whether anything STANDS on the
// register for this name. registerPositionClause says that in every state, including the state where the
// answer is "nothing does": an absence is a finding and must be said out loud, never left as a silence
// over a table of numbers.
//
// THE COVERAGE CLAUSE AND THE FUNCTION THAT COMPOSED THE PAIR ARE GONE. Neither was called from anywhere
// in the tree. The composer's call to `registerPositionClause` was the one that did NOT pass the
// unreadable-sidecar flag, so anybody reviving it would have revived exactly the defect that flag closes,
// silently, with nothing at the call site to say so. The live composition is inline in
// `renderKnockoutHtml`, which passes it; whether counts were taken at all is said once, by tierAbsenceLine.

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
// `where` names where the cards this clause points at actually sit relative to it. It said "above"
// unconditionally, which was true while the clause was drawn under the cards. It is drawn under the
// COUNTS now — the numbers it qualifies — and the cards are below it, so a fixed word would send a
// reader the wrong way up the page. The caller knows the order; this function does not guess it.
// The one sentence for a listing whose answer this run cannot state, whether the lister refused or the
// sidecar itself would not parse. Held once so the two callers below cannot drift: they are the same fact
// to a reader, and two copies of a sentence are two sentences waiting to differ.
const FILINGS_NOT_LISTED = K.read.filingsNotListed;

function registerPositionClause(mark, registerCounts, registerRecords, cards = [], where = K.read.above, recordsUnreadable = false) {
  if (!registerRecords) {
    // AN UNREADABLE SIDECAR IS NOT AN ABSENT ONE. Absent means the listing was never taken, and the page
    // says so. Unreadable means it WAS taken and this run cannot say what it found. The second sentence
    // was already written, for the lister's own refusal, and was simply unreachable from a republish:
    // a file that would not parse arrived as null, and null reads here as absent.
    if (recordsUnreadable) return FILINGS_NOT_LISTED;
    return registerCounts ? K.read.countsNotListed : '';
  }
  if (registerRecords.unavailable) {
    return FILINGS_NOT_LISTED;
  }
  const entry = recordsForMark(registerRecords, mark?.name);
  const provider = registerRecords.providerLabel ?? registerRecords.provider ?? K.read.theRegister;
  if (!entry) return K.read.noListing;
  if (cards.length) {
    const classes = [...new Set(cards.flatMap((c) => (c.record.classes ?? []).map(Number).filter(Number.isFinite)))]
      .sort((a, b) => a - b);
    const classWhere = classes.length ? K.read.inClasses(classes.length, classes.join(', ')) : '';
    const refs = cards.map((c) => c.ref).join(', ');
    return K.read.filingsStand(cards.length, readByJudgment(registerRecords) ? K.read.nameNear : K.read.closeVariation, provider, classWhere, refs, where);
  }
  const records = entry.records ?? [];
  if (!records.length) {
    // THE CLEAN NEGATIVE NEEDS POSITIVE EVIDENCE, and it used to need only the absence of a refusal. The
    // test was `some((t) => !t.ok)`, so a listing carrying NO terms at all — nothing asked — answered false
    // and fell through to "no filing stands": a settled result printed over a question never put. Stated
    // the other way round, it is the rule `recordsLine` now holds on the same fact, in the same words: a
    // term was asked and answered, and none was left unanswered. Anything else is a listing that did not
    // finish, which this page already has the sentence for.
    const terms = entry.terms ?? [];
    const ranAndAnswered = terms.length > 0 && terms.every((t) => t.ok && !t.setAside);
    return ranAndAnswered
      ? K.read.noneStands(provider)
      : noneCarriedForward(entry) ? NONE_CARRIED_FORWARD
      : K.read.listingIncomplete;
  }
  return K.read.listedBelow(records.length);
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
 *   factors        → "Why High"                 (the mark's own band, on the rating card)
 *   counterFactors → "Remaining uncertainties"
 *   mitigation     → "What would change this"
 *
 * The counter-factor label was "Why not <the rung above>", read off the run's own ladder. It asked the
 * reader to hold a ladder the page had not given them; at the top rung there was no higher band to name,
 * so it asked a different question there; and a band the build could not find on the ladder fell to that
 * same special case. the 2026-09-16 report redesign names what is under the heading instead, at every rung.
 */
// The 2026-09-16 report redesign — the heading names what is UNDER it rather than a band the reader was not shown.
// It read "Why not <the rung above>", which asked the reader to hold a ladder they had not been given
// and, at the top rung, had no band to name and asked a different question instead. The engine's
// bullets are unchanged; only the label is, and it no longer varies with the band.
const COUNTER_LABEL = K.read.remainingUncertainties;

const ASSESSMENT_FOLD_LABEL = K.read.readFullAssessment;

/** The scope block's own words, as one string, so the caveat filter reads exactly what the page prints. */
const SCOPE_BLOCK_TEXT = 'What this is. A fast screen for obvious blockers to using each name, from '
  + 'marketplace and web use plus a count of register filings. What it is not. A clearance search. We '
  + 'drew no register conclusions and give no filing advice. A name that passes here is not clear; it '
  + 'goes on to clearance. Every conflict above links to the material we found. The audit workbook holds '
  + 'every search run, every empty result and the working notes. Register data.';

// THE CAVEAT FILTER IS SHARED, NOT LOCAL. `saysSomethingNew` was defined here and is now in
// `shared/says-something-new.mjs`, because the writing-standard check asks the identical question of a
// page's lede against its title. Two definitions of one rule is one definition and one imitation of it.
// The stopword set and the idempotent stem travel with it; the reference text below stays here, because
// it is this page's own words and nothing else's.

// ── THE RATING CARD, ONE DESIGN WITH THE CLEARANCE REPORT (the 2026-09-16 report redesign) ──────────────────────
// The company's own ladder drawn as the coloured scale with the band lit, the basis sentence, the
// engine's own "why" bullets under a heading that names the band, and the framework named once. The
// ticks clamp at the ends so the first and last words do not hang off the bar. Nothing is composed:
// the bullets and the basis are the engine's, and the band words are the framework's own.
function koScale(framework, band) {
  const ladder = (Array.isArray(framework?.bands) ? framework.bands : []).map((b) => String(b?.label ?? '').trim()).filter(Boolean).reverse();
  if (!ladder.length) return '';
  const n = ladder.length;
  const idx = Math.max(0, ladder.findIndex((b) => b.toLowerCase() === String(band ?? '').trim().toLowerCase()));
  const pct = (k) => (n > 1 ? (k / (n - 1)) * 100 : 50);
  const STOPS = ['--clear', '--low', '--med', '--high', '--severe'];
  const stopAt = (k) => STOPS[Math.round((k / Math.max(1, n - 1)) * (STOPS.length - 1))];
  const tone = (k) => `var(${stopAt(k)})`;
  const shift = (k) => (k === 0 ? '0' : k === n - 1 ? '-100%' : '-50%');
  return `<div class="kscale"><div class="kbar" style="background:linear-gradient(90deg,${
    ladder.map((b, k) => `${tone(k)} ${pct(k)}%`).join(',')})"><div class="kmarker" style="left:${pct(idx)}%;transform:translateX(${
    idx === 0 ? '-12px' : idx === n - 1 ? 'calc(-100% + 12px)' : '-50%'})"><div class="kpill" style="background:${tone(idx)};color:var(${stopAt(idx)}-on)">${
    esc(ladder[idx] || band || '')}</div><div class="kneedle" style="background:${tone(idx)}"></div></div></div><div class="kticks">${
    ladder.map((b, k) => `<span class="${k === idx ? 'on' : ''}" style="left:${pct(k)}%;transform:translateX(${shift(k)})${
      k === idx ? `;color:${tone(k)}` : ''}">${esc(b)}</span>`).join('')}</div></div>`;
}

// NO "WHAT HAPPENS NEXT" (design's rule, approved by the owner 2026-11-18). The section hoisted a next-step block out of
// each name's assessment and drew it under its own heading. Since 2026-09-19 the pipeline takes that block off before it
// writes the record (`knockout-next-step.mjs`), so no record written since carries one, and a Knockout leads to the
// lawyer's choice of which names go on to a clearance, which each name's rating already states. The section and its
// hoist are gone: an assessment renders whole, as written. A page delivered earlier keeps what it was delivered with;
// the cross-build refusal guards it.

function readBlock(m, framework, { opening = '' } = {}) {
  const factors = (m.factors ?? []).filter((s) => typeof s === 'string' && s.trim());
  const counter = (m.counterFactors ?? []).filter((s) => typeof s === 'string' && s.trim());
  const structured = Boolean(m.basis || factors.length || counter.length || m.mitigation);
  const bullets = (m.bullets ?? []).map((b) => `<li>${inlineMd(b)}</li>`).join('');
  if (!structured) return bullets ? `<ul class="ko-bul">${bullets}</ul>` : '';
  const assessment = String(m.assessment ?? '').trim();
  const band = String(m.rating ?? '').trim();
  const card = [
    framework?.title
      ? `<div class="gauge-head"><div class="label">${K.readCard.overallRisk}</div><div class="gauge-fw">${esc(framework.title)}</div></div>`
      : `<div class="label">${K.readCard.overallRisk}</div>`,
    koScale(framework, band),
    m.basis ? `<p class="ko-basisline">${inlineMd(m.basis)}</p>` : '',
    factors.length ? `<div class="gwhy">${band ? `<div class="label">${esc(K.readCard.why(band))}</div>` : ''}<ul class="ko-bul">${
      factors.map((f) => `<li>${inlineMd(f)}</li>`).join('')}</ul></div>` : '',
  ].filter(Boolean).join('');
  return [
    card ? `<div class="panel gauge ko-gauge">${card}</div>` : '',
    counter.length ? `<div class="ko-counter"><span class="ko-lbl2">${esc(COUNTER_LABEL)}</span><ul class="ko-bul">${
      counter.map((f) => `<li>${inlineMd(f)}</li>`).join('')}</ul></div>` : '',
    m.mitigation ? `<div class="ko-mitig"><span class="ko-lbl2">${K.readCard.whatWouldChange}</span><p>${inlineMd(m.mitigation)}</p></div>` : '',
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
    // A PER-NAME PAGE OF A MULTI-NAME BATCH OPENS WITH THIS VERY ASSESSMENT (the publisher sets it as the page's
    // opening), so the fold would print it a second time: 10 to 26% of each such page repeated. There the fold is
    // not drawn (owner, 2026-11-18). A single-name page opens with the batch paragraph, which is other text, and keeps it.
    assessment && String(opening ?? '').trim() === String(m.assessment ?? '').trim() ? ''
    : assessment
      ? `<details class="ko-full"><summary>${esc(ASSESSMENT_FOLD_LABEL)}</summary><div class="ko-assess">${mdParagraphs(assessment)}</div></details>`
      : (bullets ? `<details class="ko-full"><summary>${K.readCard.fullNarrative}</summary><ul class="ko-bul">${bullets}</ul></details>` : ''),
  ].filter(Boolean).join('');
}

function analysisSection(marks, framework, { registerCounts = null, probeRan = false, registerRecords = null, ownerChecks = [], frameworkMethod = null, cardOrder = null, opening = '', filingRecords = new Map(), logos = new Map() } = {}) {
  const cite = { filings: filingsByHandle(registerRecords), provider: registerRecords?.provider ?? null };
  const cards = marks.map((m, markIndex) => {
    const bullets = readBlock(m, framework, { opening });
    // — the promoted register filings, in the SAME list as the common-law conflicts. A name's filing evidence
    // leads and its web use follows, the order a lawyer's report takes: first the findings that weigh a filing,
    // then the filing cards, then the findings resting on use alone. Each keeps its own order, so the
    // position says which evidence this is, and the band inside each says how much it blocks. A run recorded
    // before this order keeps the one it was delivered with: its findings, then its filing cards.
    const reg = registerCardViews(m, framework, registerRecords);
    const drawn = registerCardsOnPage(reg.cards, m, framework);
    const regBlocks = drawn.map((v) => registerFindingBlock(v, markIndex, m?.registerReads, framework, ownerChecks, frameworkMethod, { filingRecords, logos })).join('');
    // The overflow counts what is NOT on the page against what met the promotion test — cards held back
    // by the cap and cards the rater put on the lowest rung alike, because from the reader's side they
    // are the same fact: further filings for this name, all of them listed below.
    const held = reg.promoted - drawn.length;
    const overflow = held > 0
      ? `<p class="ko-bul">${esc(K.furtherFilings(held))}</p>`
      : '';
    // THE DEFECT THIS CLOSES. This line was `(m.findings ??).filter((f) => f?.url)`, and a
    // typed finding has no `url` — so every conflict was dropped from the page and a mark whose findings
    // were all typed fell to the fallback below: "No adverse signals recorded for this name on this
    // screen." A MARK WITH CONFLICTS RENDERED AS A CLEAN MARK, on the client-facing document, with
    // nothing anywhere saying so. findings-model.mjs's view reads both shapes and drops nothing.
    const views = knockoutFindingViews(m, { manifest: framework });
    const weighsAFiling = (v) => Array.isArray(v?.weighedFilings) && v.weighedFilings.length > 0;
    const findsOf = (list) => list.map((v) => findingBlock(v, framework, markIndex, frameworkMethod, cite)).join('');
    // — THE REGISTER CARDS ARE INSIDE `body`, and that is the fall-through guard. A mark whose only
    // conflict is a filing on the register used to reach the sentence below and be published as clean.
    // The guard is deliberately TIGHT: a listed filing that is dead or out of the counted classes does
    // not suppress it, because for that mark the sentence is true and the filings section says so.
    const body = (cardOrder === KNOCKOUT_CARD_ORDER
      ? [bullets, findsOf(views.filter(weighsAFiling)), regBlocks, overflow, findsOf(views.filter((v) => !weighsAFiling(v)))]
      : [bullets, findsOf(views), regBlocks, overflow]).filter(Boolean).join('');
    // A BAND WITH NO LADDER NAMED IS A NUMBER WITH NO SCALE. The framework's name rides the rating card,
    // and that card is only built for a mark with a structured read — an archived run whose marks carry
    // bullets and nothing else draws no card, and its band chips were then shown with no statement
    // anywhere of which ladder they belong to. It was named in the glance panel, which rendered either
    // way; that line went because the card names it, and this case went with it unnoticed.
    //
    // IT SITS OUTSIDE `body`, and that is not tidiness. `body` being empty is what decides whether this
    // mark says "no adverse signals recorded" — a mark with nothing against it — so anything added to it
    // silently retires that sentence. Named ONCE: the read above carries it where it drew a card, and
    // the test for that reads the markup this same function just produced.
    // The rating line reads as the clearance's does, "Overall risk" and the framework's name (owner, 2026-11-18).
    const frameworkLine = !body.includes('class="gauge-fw"') && framework?.title && String(m.rating ?? '').trim()
      ? `<div class="ko-fwline"><div class="label">${K.readCard.overallRisk}</div><div class="gauge-fw">${esc(framework.title)}</div></div>` : '';
    return `<div class="ko-row">
      <div>
        <p class="ko-name">${esc(m.name)}</p>
        ${bandColumn(m, framework)}
      </div>
      <div>
        ${body || `<p class="ko-bul">${K.readCard.noAdverseSignals}</p>`}
        ${frameworkLine}
        ${m.degraded ? `<p class="ko-degraded">${esc(DEGRADED_NOTE)}</p>` : ''}
        ${reviewerNotesBlock(m)}
        ${/* The 2026-09-16 report redesign — the register line restated the counts table above it */''}
      </div>
    </div>`;
  }).join('');
  // NO LEGEND. A standing line saying "remove these before this goes to the client" was an instruction
  // to the reader printed on the document itself, and the owner ruled it out: a report that explains its
  // own conventions in a caveat is telling the reader how to handle it rather than what was found. The
  // notes and their "For the reviewing lawyer" label stay — that label names a reader, which is a fact
  // about the note; the legend told somebody what to do about it, which is not.
  return `<div class="panel ko-glance">${cards}</div>`;
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
// IT CAME BACK WITH THE BLOCK (2026-09-16). The caveats were rendered nowhere for a while after the
// section above them was removed, and the first restoration drew them as bare paragraphs — dropping this
// sentence, which is the whole of what the ruling asked for. One paragraph, the lead-in first, the
// caveats verbatim after it; only where it sits on the page has changed.
const CAVEAT_LEAD = K.caveatLead;


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
// ONE NAME'S KNOCKOUT PAGE CONTEXT FROM THE RUN'S REPORT DOCUMENT (C14). The run's report document
// (publish/report-document.mjs, `_driver/report-document.json`) holds every fact a Knockout page prints, and this is the
// one place the page reads it: as written, for the name at `at`, into what the page's context is built from: the name's
// own slice of the findings record, opening with that name's own assessment on a batch, and the band its report
// carries. What the document does not hold is the page's surface (which name, the workbook's portal address, the
// confidentiality posture, the demo flag) and the two sets it holds by reference (each filing's saved record and each
// saved logo), which publish resolves from the run. PURE given its inputs.
function knockoutContextOf(doc, { at, filingRecords = new Map(), logos = new Map(), auditHref = null, delivery = null, demoData = false } = {}) {
  const run = doc?.run ?? {}, scope = doc?.scope ?? {}, client = doc?.client ?? {}, framework = doc?.framework ?? {};
  const findings = client.findings ?? {};
  const m = (findings.marks ?? [])[at];
  // A NAME'S PAGE OPENS WITH ITS OWN ASSESSMENT. On a batch the batch's paragraph names every name in it, and a reader
  // who ordered one name must not be handed a summary about other clients' names, so each name's page takes that name's
  // own paragraph in its place; a one-name run keeps its own. An archived name with no assessment opens blank, as
  // delivered. The batch's paragraph itself stays whole in the record.
  const one = { ...findings, marks: [m], batch: { ...(findings.batch ?? {}), ...(run.single ? {} : { executiveSummary: String(m?.assessment ?? '').trim() }) } };
  const registerRecords = client.registerRecords ?? null;
  const product = run.product ?? {};
  return knockoutContext(one, framework.manifest ?? null, {
    runId: run.runId, overall: run.reports?.[at]?.band ?? null, issued: run.issued, searched: run.searched, auditFile: run.auditFile,
    probeRan: scope.probeRan, registerCounts: client.registerCounts ?? null, registerRecords, ownerChecks: client.ownerChecks ?? [],
    instructedScope: scope.instructedScope ?? null,
    identity: { identity: product.name ?? null, stageLabel: product.stageLabel ?? null, template: product.template ?? null, banner: product.banner ?? null },
    matter: run.runId, auditHref,
    leftOpen: knockoutLeftOpenOf(doc, at),
    registerRecordsUnreadable: client.registerRecordsUnreadable, filingRecords, logos, demoData, depthNote: product.depthNote ?? null,
    searchPolicy: scope.policy ?? null, delivery, servedModels: client.servedModels, frameworkMethod: framework.method,
  });
}

function knockoutContext(findings, framework, {
  runId, overall, issued = null, searched = null, auditFile = null, probeRan = false, registerCounts = null,
  registerRecords = null,
  // — was the filings sidecar PRESENT but unreadable? Defaults to false, so every existing caller — the
  // unit fixtures and both render-check scripts, none of which pass one — renders exactly as it did. It
  // is its own value rather than a marker on `registerRecords`, because three sites PRINT
  // `registerRecords.unavailable` and anything invented for it would become client-facing wording.
  registerRecordsUnreadable = false,
  // Each listed filing's saved record and logo, by its normalised record id; empty draws the table as before.
  filingRecords = new Map(), logos = new Map(),
  // The searches this run did not complete, as Left open rows ({area, state, note}); empty draws no section.
  leftOpen = [],
  // The driver's own record of the owner lookups it ran. Defaults to [] so an
  // archived run that predates the lane renders exactly as it was delivered.
  ownerChecks = [],
  identity = null, matter = null, homeHref = null, chromeHref = null, depthNote = null, auditHref = null,
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
  // The models that served the batch, as tokens.mjs servedModels names them for a client: the scope
  // section's closing line. Defaults to null, so a fixture or an archived run that passes none renders
  // as it always did.
  servedModels = null,
  // — IS THIS AN INVENTED MARK? This template had no demo handling of any kind, so
  // every demo knockout shipped looking real: an invented mark, a real register basis, a real-looking
  // risk assessment, a published URL, and nothing saying the matter is fiction. The clearance template
  // has carried the banner since 2013; the knockout path was assumed to follow and did not.
  // Defaults FALSE, so every existing fixture and both render-check scripts render exactly as before.
  demoData = false,
  // The run's frozen method (framework-method.mjs), where its framework states one: each rated card
  // then shows the framework's inputs beside its band. Defaults to null — the band alone, as before.
  frameworkMethod = null,
} = {}) {
  const marks = findings?.marks ?? [];
  const title = batchTitle(marks);
  const productName = identity?.identity ?? null;
  // A DATE, NOT A TIMESTAMP. `issued` is composed as `<date> · <time>` at publish, and the time is the
  // minute the file was written — it tells a reader nothing and implies a precision the work does not
  // have. Every mock issues the date alone. Taken by pattern rather than by splitting on the
  // separator, so a format that changes falls through whole instead of being cut in the wrong place.
  const issuedDate = (String(issued ?? '').match(/^\d{4}-\d{2}-\d{2}/) || [])[0] ?? issued;
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
  // WHERE THE NAME STANDS, WHICH THE NUMBERS DO NOT SAY. A table of counts answers how many filings were
  // seen; the question a reader holds is whether anything STANDS on the register for this name, and two
  // of that question's six states are absences — nothing was listed, and the listing could not be made
  // at all. The clause said it from the line under the conflict cards, and that line was removed for
  // restating the counts table. Only its COVERAGE half restated the table; the position half is a
  // separate answer, and losing it left an absence as a silence over a table of numbers, which is the
  // one thing the comment over it says must never happen.
  //
  // IT RIDES BOTH BRANCHES. Attaching it to the counts table alone would have dropped it on every run
  // that has records and no counts — a product tier that lists filings without counting them — and that
  // is the same silent loss again, one branch further down. The refs come from the same view function
  // the cards are drawn from: a second derivation here would be a second answer to which filings were
  // promoted, and the clause would name refs no card carries.
  const cardsByMark = new Map(marks.map((m) => [m?.name, registerCardViews(m, framework, registerRecords).cards]));
  const positions = marks.map((m) => {
    const clause = registerPositionClause(m, registerCounts, registerRecords, cardsByMark.get(m?.name) ?? [], K.read.below, registerRecordsUnreadable);
    if (!clause) return '';
    return marks.length > 1 && m?.name ? `${m.name}: ${clause}` : clause;
  }).filter(Boolean).join(' ');
  const counts = hasCounts
    ? countsSection(marks, registerCounts, positions)
    : `<div class="panel"><p class="ko-tier">${esc(tierLine)}</p>${
        positions ? `<p class="ko-basis">${esc(positions)}</p>` : ''}</div>`;
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
  const analysis = analysisSection(marks, framework, { registerCounts, probeRan, registerRecords, ownerChecks, frameworkMethod, cardOrder: findings?.cardOrder, opening: findings?.batch?.executiveSummary, filingRecords, logos });
  // The request-level notes, gathered across every mark on the document and rendered ONCE at the top.
  // They are about the asking, not about a name, so a batch repeating them per mark would be the same
  // sentence three times. reviewerNotesBlock renders the rest, under that mark's own cards.
  const requestNotes = marks.flatMap((m) => splitKnockoutNotes(m).request);
  const aboutRequest = aboutRequestBlock(instructedScope, requestNotes, depthNote, productContext, searched, registerCounts);
  const provider = hasCounts ? (registerCounts.providerLabel ?? registerCounts.provider ?? K.counted.theRegister) : null;
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
  const filings = hasRecords ? filingsSection(marks, registerRecords, { filingRecords, logos }) : '';
  const onFieldSec = `<div class="sec" id="findings"><span class="num"></span><h2>${K.sections.conflicts}</h2></div>
${counts}
${analysis}`;
  // WHAT THIS KNOCKOUT LEFT OPEN (design's rule, approved by the owner 2026-11-18). A name whose register search failed read
  // as a clean name, where a clearance in the same place says so. The rows are the run's own record of searches that did
  // not complete, built from the run's record by knockoutLeftOpen (knockout-left-open.mjs), in the clearance's grid and
  // state words; none is model prose. A Knockout with nothing left open draws nothing, byte for byte. No scope narration returns.
  const leftOpenSec = Array.isArray(leftOpen) && leftOpen.length
    ? `\n\n  <div class="sec" id="open"><span class="num"></span><h2>${K.sections.leftOpen}</h2></div>\n  <div class="panel"><div class="openrows">${coverageGrid(leftOpen, { verdict: false })}</div></div>`
    : '';
  const filingsSec = filings
    ? `<div class="sec" id="filings"><span class="num"></span><h2>${K.sections.alsoConsidered}</h2><span class="note">${K.sections.alsoConsideredNote}</span></div>
${filings}`
    : '';

  // CHROME_CSS is not optional decoration: it styles .lockup (including the 10px flag SVG), .has-glow,
  // .watermark and .fab-stack — every one of which this page emits. Without it the lockup's inline SVG
  // falls back to its intrinsic 500px and overflows the body box by ~440px, which the height bridge then
  // posts as the frame height. That is invisible to a string test and obvious to a browser: the page
  // renders correctly and sits in a frame with 450px of dead space under it. Caught by render-check.
  return { findings, runId, overall, issued, identity, matter, homeHref, auditHref, auditFile, delivery, servedModels, demoData, title, productName, issuedDate, overallStop, summary, caveats, glance, newCaveats, aboutRequest, onFieldSec, leftOpenSec, filingsSec, chromeHref };
}

// THE KNOCKOUT PAGE, AS ITS PARTS (C14). page-shell.mjs `reportPage` draws every report page in one frame; what makes this
// page the Knockout is what it hands that frame: its title, its sheet, its top bar, the theme button and the document's
// own controls after it, its sections in their order, and its footer. Each part reads the context knockoutContext built
// once, in the order the page has always evaluated them, so the page is byte for byte the page it was.
export const KNOCKOUT_PAGE = Object.freeze({
  contextOf: knockoutContextOf,
  title: ({ title, productName }) => `${productName ? `${esc(productName)} — ` : ''}${esc(title)}`,
  css: () => CHROME_CSS + '\n' + THEME_BTN_CSS + '\n' + KO_CSS,
  topbar: ({ findings, runId, overall, issued, identity, matter, homeHref, auditHref, auditFile, title, productName, issuedDate, overallStop }) => `${homeHref ? `<a class="homebtn tb-back no-print" href="${escAttr(homeHref)}" title="${K.topbar.allReports}"><span aria-hidden="true">←</span> <span class="tb-back-lbl">${K.topbar.allReports}</span></a>` : ''}
  ${logoLockup({ mark: 20, tag: '' })}<span class="sp"></span>
  <span class="tb-risk" style="background:var(${overallStop});color:var(${overallStop}-on)">${esc(overall ?? '—')}</span>
  ${/* THE IDENTITY LINE NAMES THE MARK AND THE SEARCH, NOT THE RUN. It printed `matter || runId`,
       and the caller passes the runId AS the matter, so what a client read was the engine's own run
       identifier — on a real run a temporary-directory name carrying a capture suffix. It is ours, it
       means nothing to them, and it is the one string on the page that could not be shown to anyone.
       The mock reads mark then search type, and both are already in hand here.
       There is NO fall back to the identifier: with no product name the mark stands alone, and with
       neither the line does not render. A run whose registry identity is missing is exactly the case
       that used to print the raw name, so falling back would keep the defect for the runs that have
       it. */''}
  ${title || productName ? `<span class="mono tb-matter" style="font-size:11px;color:var(--slate)">${
    [title, productName].filter(Boolean).map(esc).join(' / ')}</span>` : ''}
  ${issuedDate ? `<span class="mono tb-issued"><span aria-hidden="true">🗓 </span>${esc(K.topbar.issuedOn(issuedDate))}</span>` : ''}
  ${/* THE EXPORT CONTROL, which this template had never emitted. The approved header carries it and the
       clearance report has it; the knockout offered a reader who opens the file no route to a PDF at
       all, while its own stylesheet still described the utility buttons as "used by the topbar Export
       popover" — the styling for a control that was not there.
       NO TICK WORDING AND NO SELECT-ALL. The clearance's entry reads "Export PDF (ticked findings)"
       and its popover offers Select all / Select none, because its exportPDF filters to the ticked
       ones. This template has no pickbox anywhere, so `pickAll` is deliberately not defined here and a
       tick verb would name a control that cannot exist. What prints is the whole document.
       EVERY WORD IN IT IS ALREADY THE PRODUCT'S. The board draws the Export button and its caret and
       stops there — it does not draw what the menu contains — so the entries are the clearance
       report's own, verbatim, minus the tick wording that names a control this template does not have.
       The heading this first carried ("Export") was written here and is gone: a word on a page a
       client reads is the owner's to choose, and the board does not ask for one.
       THE MARKUP IS THE CLEARANCE'S, RE-EMITTED RATHER THAN SHARED, and that is a debt this change
       takes on knowingly: `render.mjs` is frozen at a content hash, and extracting its top bar is its
       own change with its own byte-comparison against a real archived run. Filed as a follow-up. The
       class names are the shared vocabulary this file already emits, so report.css styles both. */''}
  <div class="tb-menu">
    <button type="button" class="tbbtn tb-ask no-print">\u2726 <span class="tb-lbl">${K.topbar.askAi}</span></button>
    ${EXPORT_TOGGLE}
    ${exportPopover(`
      <button class="util primary" onclick="exportPDF()">\u2b07 ${K.topbar.exportPdf}</button>
      ${/* THE CLEARANCE'S OWN WORKBOOK CONTROL (owner, 2026-11-18). The page cites "the audit workbook" and gave no way to
           open it; the control links the portal's audit route the publisher hands in. A page published with no public
           address, as the demo is, links the workbook by its file name, which sits beside the page, as the clearance's
           control does. Absent when the run has no workbook. */''}${
        workbookHref(auditHref, auditFile) ? `<a class="util" href="${workbookHref(auditHref, auditFile)}" download>\u2b07 ${K.topbar.downloadAudit}</a>` : ''}
      <div class="tb-sep"></div>
      <div class="tb-row"><button class="util" onclick="openAll(true)">${K.topbar.expandAll}</button><button class="util" onclick="openAll(false)">${K.topbar.collapseAll}</button></div>
    `)}
  </div>`,
  afterHead: () => `<div class="fab-stack" data-report-chrome>${themeButton()}</div>
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
   arrives at IMPORT time naming a token nobody wrote (portal-report.test.mjs pins the same rule).
   EXPAND ALL MEANS EVERY FOLD. It opened only the full assessment and left 20 of the demo's 21 folds alone, so a
   search of the page missed every term list and register record. It reads every fold, so a fold added later is in. */
function openAll(v){document.querySelectorAll('details').forEach(function(d){d.open=!!v;});}
/* No tick filter — there is nothing to filter. The beforeprint handler below opens every collapsed
   narrative first, so what prints is the whole document rather than whatever happened to be expanded. */
function exportPDF(){window.print();}
(function(){var o=function(){openAll(true);};
if(window.matchMedia){var m=window.matchMedia('print');if(m.addEventListener)m.addEventListener('change',function(e){if(e.matches)o();});}
window.addEventListener('beforeprint',o);})();
/* The popover opens on its own button, closes on a click outside it and on Escape. Same two listeners
   the clearance template carries, for the same markup; they move together when the top bar is shared. */
${EXPORT_MENU_JS}</script>
`,
  sections: Object.freeze([
    ['verdict', ({ delivery, demoData, title, productName, summary, aboutRequest }) => `<header class="hero" id="summary">
    ${demoBannerHtml(demoData === true)}
    ${confLineHtml(delivery, productName)}
    <h1 class="mark">${esc(title)}</h1>
    ${aboutRequest}
    ${summary ? `<div class="sub">${mdParagraphs(summary)}</div>` : ''}
  </header>`],
    ['glance', ({ glance }) => `

  ${glance}`],
    ['conflicts', ({ onFieldSec }) => `
  ${onFieldSec}`],
    ['also-considered', ({ filingsSec }) => `
  ${filingsSec}`],
    ['open', ({ leftOpenSec }) => `${leftOpenSec}`],
    ['caveats', ({ caveats, newCaveats }) => `


  ${/* The 2026-09-16 report redesign — the scope section and its fold are off the page: what a screen is and
       what it did not search is the narration the owner ruled out. */''}

  ${/* THE MODEL'S CAVEATS OUTLIVE THE BLOCK THEY SAT UNDER. They were rendered after the scope
       section, and taking that section off the page left them computed and drawn nowhere — on the
       committed demo run, two caveats a client used to receive, one of them the only sentence on the
       page saying nothing above is a finding of availability. What the owner ruled out is the fixed
       boilerplate, not what the engine wrote for this run, so they close the page instead.

       THE SUBSET FILTER STAYS, and so does the text it measures against. A caveat is dropped only
       when every content word in it is already said elsewhere on the page, which is what the About
       panel and the tier line now carry; a caveat making any new claim brings a new word with it and
       is kept. Both of the demo run's survive. */''}
  ${newCaveats.length ? `<div class="panel ko-caveats"><p class="ko-scope">${CAVEAT_LEAD}<br>${
    newCaveats.map((c) => inlineMd(c)).join('<br>')}</p></div>` : ''}`],
  ]),
  footer: ({ runId, issued, identity, matter, servedModels, title, productName, issuedDate }) => `${/* THE FOOTER NAMES THE SAME THREE THINGS THE HEADER DOES. It read "<product>. / Matter
         <runId>. Issued <date · time>." — the identifier again, under a label that calls it the
         client's matter when it is the engine's run directory, and the publish clock again. The mock
         reads mark · search · issued on date. Built from the same parts as the identity line so the
         two cannot drift, and with the same rule: no part of it falls back to the identifier. */''}
    <!-- WHICH MODELS SERVED THIS RUN — the same line, from the same function, as the clearance
         report's footer. It used to ride the end of the scope block, which the 2026-09-16 redesign took
         off this page; the line is provenance rather than the narration that was ruled out, so it moved
         here. Owner ruling, 2026-09-17. Adjacent on purpose, as on the clearance side. -->${servedModelsLine(servedModels)}
    <span>${[title, productName].filter(Boolean).map(esc).join(' \u00b7 ')}${
      issuedDate ? `${title || productName ? ' \u00b7 ' : ''}${esc(K.issuedOn(issuedDate))}` : ''}${
      title || productName || issuedDate ? '.' : ''}</span>
    ${logoLockup({ mark: 16 })}`,
  afterWrap: () => '',
  strip: STRIP,
});

export function renderKnockoutHtml(findings, framework, opts = {}) {
  return reportPage(KNOCKOUT_PAGE, knockoutContext(findings, framework, opts));
}
