// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// hand-off-exits.mjs — every record or page that leaves a clearance hand-off with no ground, counted from
// the traces and files the run already writes.
//
// THE RULE IT MEASURES: a ground is owed for what a step was handed as a candidate, never for every page
// read. A ground may cover an owner's whole set of records, so the picking step reports owners beside
// records: the number of grounds a run owes is the number of owners, not the number of filings.
//
// TWO HAND-OFFS, ONE QUESTION.
//   picking   record-carry.json — a record that stopped at placement with no step recording why
//             (`step-silent`, or `absent` where no ledger spoke). A structural stop (the stage did not
//             complete) states its cause and is not counted.
//   notes     common-law-findings.md against the delivered findings — a page the web notes marked as a
//             candidate or conflict that no delivered finding cites and synthesis did not decline. The grid
//             trace ends where the notes begin, so a page the notes called a conflict and the findings then
//             left out was invisible to it.
// Neither the grid rows the web step read nor the knockout's pages are counted: a page read and not marked
// is not owed a ground, and the knockout's rating step is outside this check.
//
// IT REPORTS AND NEVER GATES. Nothing here changes what is searched, carried or delivered. A count of
// exits is a fact about the run for the reviewing lawyer and for the replay, not a threshold.
//
// "NOT COMPUTABLE" IS NOT ZERO. A missing trace answers `computable: false` with the reason by name, so a
// run that wrote nothing can never read as a run where nothing left silently.
import { parseFindingsSurfaces } from "./commonlaw-carry.mjs";

const notComputable = (reason) => ({ computable: false, reason, exits: 0, rows: [] });

/** Records that left the picking step with no ground. PURE. */
export function pickingExits(recordCarry) {
  if (!recordCarry || !Array.isArray(recordCarry.rows)) {
    return notComputable("no record-carry trace — nothing records how the register's records left the picking step");
  }
  const rows = recordCarry.rows
    .filter((r) => r?.stopped_at === "placement" && (r.reason_source === "step-silent" || r.reason_source === "absent"))
    .map((r) => ({ uri: r.uri ?? null, mark: r.mark ?? null, owner: r.owner ?? null }));
  const owners = new Set(rows.map((r) => String(r.owner ?? "").trim()));
  return { computable: true, reason: null, exits: rows.length, owners: rows.length ? owners.size : 0, rows };
}

const SECTION_ANCHOR_RE = /<!--\s*clearotron:section\s*=\s*([a-z-]+)\s*-->/i;
const HEADING_RE = /^(#{1,6})\s+(.*)/;
// The notes' sections that record what was READ, never what was found: the grid's matrix, the coverage
// ledger, the register hand-offs, the call log and the open flags (clearance-common-law/SKILL.md, Step 6).
const NOT_FINDINGS_RE = /negative results|coverage ledger|cross.?checks?|audit trail|open verification/i;
// The meaning readings (the same section test connotation-search.mjs polices). Every one of them already
// carries its ruling from the disposition form, so none is owed a second ground here.
const MEANING_RE = /reputational|connotation/i;

/**
 * THE PAGES THE WEB NOTES MARKED: every page cited in the notes' findings section, the rows the notes
 * wrote as candidates or conflicts. The section is found by its dictated anchor and ends at the next
 * anchor; a file with no findings anchor (every run archived before the anchors) falls back to the
 * headings, as verify.mjs does: the section a heading below the title names as findings, to the next
 * heading at its level. Either way a heading naming one of the read-only sections ends it, and a meaning
 * subsection inside it is left out. Returns the normalised address → the address as printed. PURE.
 */
export function notesMarkedPages(notesText) {
  const text = String(notesText ?? "");
  const anchored = /<!--\s*clearotron:section\s*=\s*findings\s*-->/i.test(text);
  let inFindings = false, inMeaning = false, level = 0;
  const kept = [];
  for (const ln of text.split("\n")) {
    const a = ln.match(SECTION_ANCHOR_RE);
    if (a) {
      if (anchored) { inFindings = a[1].toLowerCase() === "findings"; inMeaning = false; }
      continue;
    }
    const h = ln.match(HEADING_RE);
    if (h) {
      const [, hashes, title] = h;
      if (NOT_FINDINGS_RE.test(title)) { inFindings = false; inMeaning = false; continue; }
      if (!anchored) {
        // The one level-1 heading is the file's title ("# Common-law findings — <mark>"), never a section.
        if (hashes.length === 1) { inFindings = false; inMeaning = false; continue; }
        if (/\bfindings?\b/i.test(title)) { inFindings = true; level = hashes.length; inMeaning = MEANING_RE.test(title); continue; }
        if (inFindings && hashes.length <= level) { inFindings = false; inMeaning = false; continue; }
      }
      if (inFindings) inMeaning = MEANING_RE.test(title);
      continue;
    }
    if (inFindings && !inMeaning) kept.push(ln);
  }
  return parseFindingsSurfaces(kept.join("\n")).urls;
}

/**
 * Pages the web notes marked as candidates or conflicts that no delivered finding cites and synthesis did
 * not decline with a ground. `declinedPages` is the decline ledger's pages (a Map or Set keyed by
 * normalised address); a page it holds left by a stated decision and is not an exit. PURE.
 */
export function notesExits(notesText, findings, declinedPages = null) {
  if (notesText == null) return notComputable("no web notes on this run — nothing records which pages the web step marked");
  if (findings == null) return notComputable("no delivered findings — the web notes cannot be followed to them");
  const urls = notesMarkedPages(notesText);
  const cited = new Set([...parseFindingsSurfaces(JSON.stringify(findings)).urls.keys()]);
  const declined = declinedPages instanceof Map || declinedPages instanceof Set ? declinedPages : new Set();
  const left = [...urls].filter(([page]) => !cited.has(page));
  const rows = left.filter(([page]) => !declined.has(page)).map(([page, url]) => ({ page, url }));
  return { computable: true, reason: null, exits: rows.length, marked: urls.size, declined: left.length - rows.length, rows };
}

/**
 * The pages the web notes marked, as rows on synthesis's offered list after the register records: the
 * seat declines a page by its position there, exactly as it declines a record. `page` is the normalised
 * address the notes and the findings are joined on; `url` is the address as the notes printed it. No
 * notes, no rows. PURE.
 */
export function notesPageRows(notesText) {
  if (notesText == null) return [];
  return [...notesMarkedPages(notesText)].map(([page, url]) => ({ kind: "page", page, url }));
}

/** The run-log line: counts and reasons only, never a row. PURE. */
export function exitsForLog(exits = {}) {
  const out = {};
  for (const [handOff, e] of Object.entries(exits)) {
    if (!e) continue;
    out[handOff] = e.computable
      ? { computable: true, exits: e.exits, ...("owners" in e ? { owners: e.owners } : {}),
        ...("marked" in e ? { marked: e.marked, declined: e.declined ?? 0 } : {}) }
      : { computable: false, reason: e.reason };
  }
  return out;
}
