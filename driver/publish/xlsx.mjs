// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Clearance audit workbook renderer: findings.json (+ coverage) + the audit.md search-log -> a styled,
// four-tab .xlsx a lawyer can read (exceljs). The four tabs answer the two questions a reviewer opens the
// book with — what did you search (Summary + What was searched) and what did you conclude about each finding
// (Findings + Coverage & gaps). This is RE-PRESENTATION of data the run already assembled, not new analysis:
//   Findings          <- findings.json (one row per conflict; registrations joined, never split)
//   What was searched <- audit.md negatives (register + common-law, deduped to one row per term; where
//                        the log holds no common-law terms the sheet SAYS SO rather than omitting them)
//   Coverage & gaps   <- findings.json coverage[]
//   Summary           <- front-matter + the verdict + the coverage caveat + counts derived from the above
// The internal machinery the old six-tab book leaked (receipts / lint / tripwires / HTTP / cache / quadrant
// coordinates / meters) is DROPPED — but nothing lawyer-relevant is lost: the register-record fetch log
// becomes the "Record retrieved?" column, the confidence downgrades become the "from source / our read" tags,
// and any still-open integrity item becomes a plain line in Coverage & gaps + the Summary caveat. An
// ADVISORY gate (validateAudit) runs AFTER the workbook is written and only reports findings (e.g. banned
// vocabulary reaching a lawyer-visible cell) for the driver to log — it never suppresses the deliverable.
// exceljs is loaded lazily so this delivery-only dep can never break the driver's import.

import { BRAND } from '../../shared/brand.mjs';
import { projectAssessmentField } from '../findings-model.mjs';
import { deliveryVocabViolations } from '../predelivery-lint.mjs';

const HEAD_FILL = '11132A';
// plain-English coverage-state fills (the state words are relabelled for the reader; the fills key off them).
const STATE_FILL = { Clean: 'DEF0DC', Limited: 'FBE7C6', Open: 'FBE7C6', Note: 'EDEDED' };
const WIDE = {
  // Summary
  'Field': 26, 'Value': 96,
  // Findings
  '#': 5, 'Conflicting mark': 30, 'Owner': 30, 'Country': 10, 'Source': 14, 'Class': 12,
  'Registration(s)': 30, 'Status & key dates': 26, 'Record retrieved?': 30, 'Risk band': 14,
  'How we treated it': 40, 'Mark similarity': 18, 'Goods proximity': 18, 'Use': 16, 'Enforcer': 18, 'Link': 40,
  // What was searched
  'Search term / variant': 40, 'Scope': 20, 'Result': 24, 'Outcome': 24, 'Note': 60,
  // Coverage & gaps
  'Area': 40, 'State': 12, 'What was done': 60, "What's left": 60,
};
const width = h => WIDE[h] || 16;

// ── banned internal vocabulary — no lawyer-visible cell, header, or tab name may contain any of these ──────
// Exported so the OTHER delivery surface (the cover note) is judged by the same list its own tests run:
// the two surfaces enumerate the same machine-check lines, and a vocabulary rule that only one of them
// knows about is how the raw engine detail reached both in the first place.
export const BANNED = /\b(receipts?|lint|tripwires?|composite|quadrants?|scatter|coordinates?|https?|cache|has_more|meters?)\b/i;

// A10 rows are composed by predelivery-lint's projection table. If a caller hands this module a check
// object instead of a projected line, the row says nothing rather than saying the engine's words.
const A10_UNPROJECTED = 'A machine check on the report did not pass.';
// The Summary rows A10 owns. validateAudit holds these to a HARD standard (see there) — the general
// BANNED scan over every cell stays advisory, because archived model-authored prose legitimately trips
// it and a republish must not lose its workbook over a word in a finding.
const A10_FIELD_RE = /^(?:Machine checks flagged|\s+Check \d+)$/;

// plainNote: fold the raw spine/model prose that reaches a reader cell down to plain English — strip markdown
// emphasis and rewrite the few engineering phrases that leak through the search log ("has_more:false"). The
// validateAudit gate is the backstop; this is the routine cleaner so the gate stays quiet on normal runs.
function plainNote(s) {
  return String(s ?? '')
    .replace(/\*\*/g, '')
    .replace(/has_more\s*:?\s*false/gi, 'completion')
    .replace(/\bhas_more\b/gi, 'enumeration')
    .replace(/\s+/g, ' ')
    .trim();
}

// a column is "empty" only when NO data row fills it. Dropping such a column honours the spec's
// "no dead schema" by construction (a common-law-only run simply omits Class / Registration(s) rather
// than shipping them blank) AND means the workbook never carries an empty column to trip a gate on.
// The drop is safe because every styleRow DECLARES the column it reads — it is handed the surviving
// column set and checks it — NOT because the styled columns are always populated. They are not, and
// the older claim here that they were (Link, Risk band, State, Field, Scope, Result "always populated,
// so never drop") cost a delivery: on a run whose search terms carried no class token, Scope was empty
// on all 17 rows and was dropped, and exceljs resolves an unknown `getCell('Scope')` KEY as a column
// LETTER — "Out of bounds. Excel supports columns from 1 to 16384" (col-cache l2n). buildAudit threw
// before it reached writeFile, the caller's last-resort catch swallowed the message, and the run
// delivered with no workbook at all. Link is the same shape and still reachable: a findings set whose
// every source carries no resolved link drops the Link column the Findings styler reads.
const cellEmpty = v => v == null || (typeof v === 'object'
  ? !(v.text ?? v.hyperlink ?? (v.richText || []).map(r => r.text).join('')) : !String(v).trim());
const nonEmptyColumns = (columns, rows) =>
  columns.filter(h => rows.some(r => !cellEmpty(r[h])));

export function addSheet(wb, name, columns, rows, styleRow) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = nonEmptyColumns(columns, rows);
  columns = cols.length ? cols : columns;   // never drop EVERY column (empty sheet keeps its headers)
  ws.columns = columns.map(h => ({ header: h, key: h, width: width(h) }));
  const kept = new Set(columns);            // what SURVIVED the drop — the set every styler is held to
  const hr = ws.getRow(1);
  hr.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + HEAD_FILL } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  hr.height = 26;
  for (const r of rows) {
    const row = ws.addRow(r);
    row.alignment = { vertical: 'top', wrapText: true };
    // a styler gets the written row, its SOURCE data, and the surviving columns. Each states its own
    // precondition against `kept`, so a dropped column makes that one rule a no-op and leaves every
    // other rule — and any genuinely wrong cell reference — still loud.
    if (styleRow) styleRow(row, r, kept);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

// ── shared derivations ──────────────────────────────────────────────────────────────────────────────────

// source_type -> the plain word a lawyer reads. A register finding never wears a common-law label and back.
const sourceWord = st => /^register/.test(st) ? 'Register'
  : /^case-law/.test(st) ? 'Case-law'
    : /marketplace/.test(st) ? 'Marketplace'
      : /^common-law/.test(st) ? 'Web'
        : st ? 'Web' : '';

// /mark/ca/1693383 -> country "CA", number "1693383", "CA 1693383". Absent/odd shapes fall back gracefully.
const uriCountry = uri => (String(uri || '').match(/\/mark\/([a-z]{2})\//i)?.[1] || '').toUpperCase();
const uriNumber = uri => String(uri || '').match(/\/mark\/[a-z]{2,6}\/(.+)$/i)?.[1] || String(uri || '');
const regLabel = uri => { const c = uriCountry(uri); const n = uriNumber(uri); return c ? `${c} ${n}` : n; };

// the four drivers keep their token but wear a PLAIN provenance tag: a value checked against the actual
// register record or live listing reads "from source"; our own inference reads "our read". (This is the
// verified/inferred basis already computed — relabelled, never recomputed.)
const basisTag = b => b === 'verified-from-record' ? 'from source' : b === 'inferred-from-signal' ? 'our read' : '';
const meterCell = m => m && m.token ? `${m.token}${basisTag(m.basis) ? ` · ${basisTag(m.basis)}` : ''}` : '';

// disposition -> the plain "how we treated it" sentence.
const TREATMENT = {
  adversarial: 'On-field — stress-tested as the closest conflict',
  'coexistence-partner': 'Coexistence partner — living alongside, kept manageable',
  distinguished: 'Distinguished — weak shared element, kept manageable',
  'off-field': 'Off-field — outside the risk zone',
};
const treatmentCell = f => f?.disposition === 'withdrawn'
  ? `Withdrawn on review — ${plainNote(f.withdrawn_reason) || 'no reason recorded'}`
  : (f?.isContextNote ? 'Noted for awareness — not a rated conflict' : (TREATMENT[f?.disposition] || ''));

// Record retrieved? — the plain-English state of the register-record fetch for a finding, from the per-URI
// fetch-state map ({retrieved | failed | not-attempted}). A common-law finding (no registrations) is
// "n/a — live listing"; a failed fetch is VISIBLY unverified, never presented as confirmed.
function retrievedCell(f, fetchState) {
  const regs = f?.owner?.registrations || [];
  if (!regs.length) return 'n/a — live listing';
  const st = uri => (fetchState && fetchState[String(uri || '').toLowerCase()]) || 'not-attempted';
  const states = regs.map(r => st(r.uri));
  if (states.every(s => s === 'retrieved')) return 'Read from the register record';
  const anyRead = states.some(s => s === 'retrieved');
  const anyFailed = states.some(s => s === 'failed');
  // no leg read: a fetch that FAILED (a 404) makes the registry values unverified — say so visibly; a leg
  // simply never pulled (off-field context) is the softer "not individually retrieved".
  if (!anyRead) return anyFailed ? 'Not retrieved — details unverified' : 'Not individually retrieved';
  // mixed — spell out which country legs read and which did not ("CA read; US/AU not retrieved").
  const read = regs.filter(r => st(r.uri) === 'retrieved').map(r => uriCountry(r.uri)).filter(Boolean);
  const missing = regs.filter(r => st(r.uri) !== 'retrieved').map(r => uriCountry(r.uri)).filter(Boolean);
  const parts = [];
  if (read.length) parts.push(`${read.join('/')} read`);
  if (missing.length) parts.push(`${missing.join('/')} not retrieved`);
  return parts.join('; ') || 'Not individually retrieved';
}

// Status & key dates — a single representative line from the first registration whose record was read.
function statusDatesCell(f) {
  const regs = f?.owner?.registrations || [];
  const r = regs.find(x => x && (x.status || x.filed || x.expiry)) || null;
  if (!r) return '';
  return [r.status, r.filed && `filed ${r.filed}`, r.expiry && `exp ${r.expiry}`].filter(Boolean).join(' · ');
}

// Class — union of the bound registration classes, or blank for a common-law finding.
function classCell(f) {
  const cls = new Set();
  for (const r of (f?.owner?.registrations || [])) for (const c of (r.classes || [])) cls.add(String(c));
  return [...cls].join(', ');
}

const FINDING_COLS = ['#', 'Conflicting mark', 'Owner', 'Country', 'Source', 'Class', 'Registration(s)',
  'Status & key dates', 'Record retrieved?', 'Risk band', 'How we treated it',
  'Mark similarity', 'Goods proximity', 'Use', 'Enforcer', 'Link'];

function findingRows(findings, fetchState) {
  return (findings || []).map(f => {
    const regs = f?.owner?.registrations || [];
    const ctx = !!f.isContextNote;
    return {
      '#': f.ordinal ?? '',
      'Conflicting mark': f.mark || '',
      'Owner': f.owner?.name || '',
      'Country': f.owner?.country || '',
      'Source': sourceWord(f.source?.source_type || ''),
      'Class': classCell(f),
      'Registration(s)': regs.length ? regs.map(r => regLabel(r.uri)).join('; ') : (ctx ? '—' : '— (common-law)'),
      'Status & key dates': statusDatesCell(f),
      'Record retrieved?': ctx ? 'n/a — noted only' : retrievedCell(f, fetchState),
      'Risk band': f.band || '—',
      'How we treated it': treatmentCell(f),
      // context notes are NOT rated conflicts — the four drivers read n/a and the four-drivers gate skips them.
      'Mark similarity': ctx ? 'n/a' : meterCell(f.meters?.mark_similarity),
      'Goods proximity': ctx ? 'n/a' : meterCell(f.meters?.goods_proximity),
      'Use': ctx ? 'n/a' : meterCell(f.meters?.use),
      'Enforcer': ctx ? 'n/a' : meterCell(f.meters?.enforcer),
      'Link': f.source?.resolved_link || '',
    };
  });
}

// ── What was searched — one row per search, register + common-law, deduped to one row per term ────────────
const SEARCH_COLS = ['#', 'Search term / variant', 'Scope', 'Result', 'Outcome', 'Note'];

const scopeFromTerm = (term, note) => {
  const m = `${term} ${note}`.match(/cl\.?\s*[\d]+(?:\s*[,/+&]\s*[\d]+)*/i);
  return m ? m[0].replace(/cl\.?\s*/i, 'cl. ').replace(/\s+/g, ' ') : '';
};
const HITY = /similar listing|found|products found|product found|account exists|brand account found|squatted|→\s*finding/i;
const EXCL = /excluded|dropped|off-field|out of scope|distribution-partner|relevance/i;

// THE THIRD STATE. "This could not be searched" is not "this was searched and found nothing", and
// the workbook is the document a reviewing lawyer relies on for what was searched. The word is the one the
// SAME WORKBOOK already shows a client on its Coverage & gaps tab: STATE_WORD maps the typed
// `not-searched` coverage state to "Open". Reusing it keeps one vocabulary in front of the reader instead
// of inventing a second for the same fact.
const NOT_SEARCHED_OUTCOME = 'Open — not searched';
const NOT_SEARCHED_RESULT = 'could not be searched';

// A row is not-searched when it SAYS SO IN A FIELD, not when its prose happens to match a pattern.
// audit-from-spine.mjs stamps `searched:false` on every gaps[] row, because that function already knows
// which arm the row came from. The prose fallback is for the REGISTER spine, whose Negative-results table
// is model-authored markdown with an open vocabulary — at least four distinct phrasings reach this
// workbook today ("NOT SEARCHED — receipt deferred", "provider-rejected on both attempts", "not executed
// — coverage-limited", "Could not be searched") and no closed set is possible. So: the flag when there is
// one, the prose only when there is not.
const NOT_SEARCHED_PROSE = /\bnot searched\b|could not be searched|not executed|provider-rejected|receipt deferred|coverage-limited/i;
const notSearched = (row, result, note) => {
  if (row?.not_searched) return true;                       // the typed marker, whichever end it came from
  return NOT_SEARCHED_PROSE.test(`${result ?? ''} ${note ?? ''}`);
};

const outcomeFor = (result, note, row = null) => {
  const t = `${result} ${note}`;
  // Ahead of everything: a query that never ran cannot be a hit, an exclusion, or a clean sweep.
  if (notSearched(row, result, note)) return NOT_SEARCHED_OUTCOME;
  if (HITY.test(t) && !/no (similar|active|products|results|relevant)/i.test(result)) return '→ Findings';
  if (EXCL.test(t)) return 'Excluded';
  // NO CATCH-ALL. `return 'No conflict'` as a fall-through was the defect: an unknown shape resolved to
  // the most reassuring answer available, so any Result this file has never seen became a closure claim.
  // An unrecognised row now says it is unrecognised, and a human reads the Result column beside it.
  if (!String(result ?? '').trim()) return 'No conflict';
  return /^(0|no |none\b|nothing\b|clean\b)/i.test(String(result).trim()) ? 'No conflict' : 'Recorded — read the Result';
};

// term -> did it become a surviving finding? A PROVABLE join, never a guessed number: the term shares a
// distinctive substring (>=6 chars, so the shared "nova"/"pulse" flavour words never spuriously match)
// with a finding's mark, OR index.mjs supplied a URL-join (a common-law grid hit that resolves to a
// finding's own link). A term with listings but no join is honestly "reviewed, not carried as a conflict"
// — that is exactly the NOVAPULSA / PULSE case, where the search layer surfaced listings synthesis set aside.
const alpha = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
function joinsFinding(term, findings, joinedTerms) {
  const key = String(term || '').trim().toUpperCase();
  if (joinedTerms && joinedTerms.has(key)) return true;
  const ta = alpha(term);
  if (ta.length < 6) return false;
  for (const f of (findings || [])) {
    for (const tok of String(f.mark || '').split(/[^A-Za-z0-9]+/)) {
      const a = alpha(tok);
      if (a.length >= 6 && (ta.includes(a) || a.includes(ta))) return true;
    }
  }
  return false;
}

const COMMON_LAW_SECTION = 'COMMON-LAW  —  web / marketplace / social / product database';

// register negatives are already one row per term in the spine; common-law negatives arrive per-platform and
// collapse to one row per term with a distinct-surface count (the spec's dedup). The full per-surface grid
// is the run's own artifact; this is the reader's deduped view, not a claim the surfaces went unrecorded.
// Exported for test: the three-state logic is the deliverable's own claim about what was
// searched, and it is worth asserting directly rather than only through a rendered xlsx.
export function searchRows(auditParsed, { findings = [], joinedTerms = null, registerOnly = false } = {}) {
  const negs = (auditParsed?.negatives || []).filter(n => (n.search_term || '').trim() && (n.search_term || '').trim() !== '—');
  const reg = negs.filter(n => n.source_layer !== 'Common-law');
  const cl = negs.filter(n => n.source_layer === 'Common-law');

  const rows = [];
  let i = 0;
  const push = r => rows.push({ '#': ++i, ...r });

  if (reg.length) {
    push({ 'Search term / variant': 'REGISTER  —  vendor register, worldwide', Scope: '', Result: '', Outcome: '', Note: '', _section: true });
    for (const n of reg) {
      const note = plainNote(n.notes);
      push({
        'Search term / variant': plainNote(n.search_term), Scope: scopeFromTerm(n.search_term, note),
        Result: plainNote(n.result) || '—', Outcome: outcomeFor(n.result, note, n), Note: note,
      });
    }
  }

  if (cl.length) {
    // group by term, preserving first-seen order; aggregate surfaces + whether any surface produced a hit.
    const order = [];
    const byTerm = new Map();
    for (const n of cl) {
      const key = (n.search_term || '').trim();
      if (!byTerm.has(key)) { byTerm.set(key, { plats: new Set(), results: new Set(), notes: [], gaps: new Set() }); order.push(key); }
      const g = byTerm.get(key);
      if (n.platform) g.plats.add(n.platform);
      if (n.result) g.results.add(n.result);
      if (n.notes) g.notes.push(plainNote(n.notes));
      // — the surfaces that could NOT be searched are counted separately from the ones that came back
      // empty. The dedup unions results across platforms, so one gapped surface among many used to vanish
      // entirely into a term-level "0 — clean".
      if (notSearched(n, n.result, n.notes)) g.gaps.add(n.platform || '?');
    }
    push({ 'Search term / variant': COMMON_LAW_SECTION, Scope: '', Result: '', Outcome: '', Note: '', _section: true });
    for (const term of order) {
      const g = byTerm.get(term);
      const results = [...g.results];
      const anyHit = results.some(r => HITY.test(r) && !/^no /i.test(r));
      const n = g.plats.size;
      const scope = n ? `~${n} surfaces` : '';
      // the deduped row lost its per-surface detail (that lives in the run's own grid); the Note states the
      // honest aggregate — how wide the sweep ran and where any hit went — never one cherry-picked surface
      // receipt (which, on a hit term, would read as "nothing found" beside a "found" result).
      const joined = anyHit && joinsFinding(term, findings, joinedTerms);
      // THREE STATES, not two. `anyHit` is a boolean, so "searched, nothing there" and "the search
      // errored" landed in the same arm and the row read `0 — clean` / `No conflict` / `no listing found`
      // — three separate claims that the term was searched and came back empty, for a term that was not
      // searched at all. The gap count is carried beside the hit flag, never folded into it.
      const gaps = [...g.gaps];
      const ran = Math.max(0, n - gaps.length);
      const gapNote = gaps.length ? ` ${gaps.length} surface${gaps.length === 1 ? '' : 's'} could not be searched (${gaps.slice(0, 4).join(', ')}${gaps.length > 4 ? ', …' : ''}) — this term is NOT closed across them.` : '';
      const outcome = anyHit ? (joined ? '→ Findings' : 'Reviewed — not carried as a conflict')
        : gaps.length && !ran ? NOT_SEARCHED_OUTCOME          // nothing ran at all: never a closure claim
          : gaps.length ? 'No conflict — partial'             // some ran clean, some never ran: say both
            : 'No conflict';
      const note = (anyHit
        ? (joined
          ? `Checked across ${ran ? `~${ran}` : 'the'} surfaces; similar listing(s) surfaced → see Findings`
          : `Checked across ${ran ? `~${ran}` : 'the'} surfaces; listing(s) reviewed, none carried as a separate conflict`)
        : ran
          ? `Checked across ~${ran} surface${ran === 1 ? '' : 's'}; no listing found`
          : `Not checked on any recorded surface`) + gapNote;
      push({
        'Search term / variant': plainNote(term), Scope: scope,
        // The all-clean row is unchanged — a workbook that annotates every clean line teaches the reader to
        // ignore the annotation. It says "of N" only when some surface did NOT run.
        Result: anyHit ? 'similar listing(s) found'
          : !ran ? NOT_SEARCHED_RESULT
            : gaps.length ? `0 — clean on ${ran} of ${n}` : '0 — clean',
        Outcome: outcome, Note: note,
      });
    }
  } else if (!registerOnly) {
    // The search log carries no per-term common-law rows, and nothing about this run records it as
    // register-only. Omitting the block leaves a sheet that READS as a complete register-only search
    // — while the same workbook's "Coverage & gaps" tab rates common-law areas (Clean, on the run
    // that produced this) and its Summary says register AND common-law were searched. One tab would
    // certify coverage the other shows no search for. So the sheet STATES what it cannot evidence:
    // absence read as success is the exact failure this surface exists to prevent, and a gap the
    // reader can see is worth more than a tab that quietly looks complete. The row claims nothing
    // about what ran — only what this run's own search log does and does not hold.
    push({ 'Search term / variant': COMMON_LAW_SECTION, Scope: '', Result: '', Outcome: '', Note: '', _section: true });
    push({
      'Search term / variant': "COMMON-LAW  —  not itemised in this run's search log",
      Scope: '', Result: 'no per-term rows recorded', Outcome: 'Not itemised',
      Note: 'This run is not recorded as a register-only search, so what this tab lists is not the whole of what it searched. Its search log holds no per-term common-law rows, so the sweep cannot be set out term by term here. Read this tab as an incomplete record of the searching — never as evidence that no common-law search ran — and check any common-law line on "Coverage & gaps" against the run\'s own common-law record.',
      _commonLawUnlogged: true,
    });
  }
  return rows;
}

// ── Coverage & gaps ─────────────────────────────────────────────────────────────────────────────────────
const COVERAGE_COLS = ['Area', 'State', 'What was done', "What's left"];
const STATE_WORD = { 'confirmed-clean': 'Clean', 'coverage-limited': 'Limited', open: 'Open', 'not-searched': 'Open', note: 'Note' };

// split a coverage note into "what was done" / "what's left" at its natural prose seam. Open/limited areas
// describe the residual after a "; " or " — "; a clean area is all done and has nothing left.
function splitCoverageNote(note, state) {
  const n = plainNote(note);
  if (!n) return { done: '', left: '' };
  if (state === 'Clean') return { done: n, left: '—' };
  const seam = n.search(/\s—\s|;\s/);
  if (seam > 0) {
    const done = n.slice(0, seam).trim();
    const left = n.slice(seam).replace(/^\s*(—|;)\s*/, '').trim();
    return { done, left: left || '—' };
  }
  // no clean seam — a residual-describing note reads as "what's left"; a clean note reads as "what was done".
  return state === 'Open' || state === 'Limited' ? { done: '', left: n } : { done: n, left: '—' };
}

function coverageRows(coverage) {
  return (coverage || []).map(c => {
    const state = STATE_WORD[c.state] || 'Note';
    const { done, left } = splitCoverageNote(c.note, state);
    return { Area: plainNote(c.area), State: state, 'What was done': done, "What's left": left };
  });
}

// ── Summary ─────────────────────────────────────────────────────────────────────────────────────────────
// The one-open-caveat + headline-honesty rule: the workbook must never read clean/complete while any
// coverage unit did not finish. This computes whether that condition holds and the plain caveat sentence.
function coverageOpen({ coverage = [], coverageJudgment = null, verdict = null } = {}) {
  const openState = (coverage || []).some(c => c.state === 'open' || c.state === 'coverage-limited');
  const judgeUnsure = coverageJudgment && coverageJudgment.sufficient === false;
  const verdictCoverage = !!(verdict && verdict.kinds && verdict.kinds.coverage);
  return openState || judgeUnsure || verdictCoverage;
}

function summaryRows(findings, coverage, fm, { mark, coverageJudgment, verdict, jurisdiction, registerOnly = false, commonLawUnlogged = false, clientGate = null, lintFailures = [], productName = null } = {}) {
  const disp = d => findings.filter(f => f.disposition === d && !f.isContextNote).length;
  const rated = findings.filter(f => !f.isContextNote);
  const openCount = (coverage || []).filter(c => c.state === 'open' || c.state === 'coverage-limited').length;
  const verdictWord = (verdict && verdict.tier) || fm.overall_label || '';
  const caveat = plainNote(coverageJudgment?.reason) ||
    (coverage || []).find(c => c.state === 'open' || c.state === 'coverage-limited')?.note ||
    'None — every search unit reached completion.';

  const rows = [
    // — THE WORKBOOK NAMES THE SAME PRODUCT ITS REPORT DOES. This title was the literal
    // "Preliminary clearance — audit" on every run, so a Knockout search's workbook and a Full country
    // search's workbook carried one name between them, and neither matched the masthead of the report
    // they were downloaded from. The workbook is a delivery surface: its link rides the same cover note
    // that reaches a client principal. Null ⇒ the neutral title, never a product the run did not run.
    { Field: productName ? `${productName} — audit` : 'Search audit', Value: 'The full, downloadable record behind the report — what was searched, and what we concluded about each finding.', _title: true },
    { Field: '', Value: '' },
    { Field: 'Mark', Value: mark || fm.title || '' },
    { Field: 'Matter', Value: fm.matter || '' },
    { Field: 'Classes', Value: fm.classes || '' },
    // compute-don't-author (PR-4, review issue 2): the driver-computed per-class register-coverage
    // line (scope-facts.mjs → `coverage_line:` front-matter) renders here so the workbook's headline
    // carries the honest per-class proportion ("Class 30: 76 of 99 slices fully searched — the
    // remaining 23 are non-Latin script forms", the spec-B4 plain form) beside the bare class
    // numbers. Conditional on the fm key: a republished ARCHIVED workbook (whose front-matter never
    // carried coverage_line) must not grow rows.
    ...(fm.coverage_line ? [{ Field: 'Register coverage', Value: fm.coverage_line }] : []),
    { Field: 'Jurisdiction', Value: jurisdiction || '' },
    { Field: 'Searched', Value: fm.searched || fm.run || '' },
    // spec 64 — the old single row printed the severity TIER under the label "Verdict" (a reader saw
    // "Verdict: High" — vocabulary conflation). With a composed statement the summary carries two
    // labelled rows: the band word and THE one risk statement. A legacy run (no statement) keeps its
    // single original row byte-identically — a republished archived workbook must not grow rows.
    ...(verdict && verdict.statement
      ? [{ Field: 'Risk band', Value: verdictWord }, { Field: 'Verdict', Value: verdict.statement, _verdict: true }]
      : [{ Field: 'Verdict', Value: verdictWord, _verdict: true }]),
    { Field: '⚠  One thing to check first', Value: caveat, _caveat: true },
    // The gap "What was searched" had to DECLARE rather than list, said again where the reader starts.
    // It is set when that sheet found no per-term common-law rows on a run nothing records as
    // register-only, and it exists because the only signal for this used to be an advisory line on
    // stdout: the run that hit it delivered a workbook-less report and the sheet's own gate finding
    // ("no common-law block") reached no reader at all. Same rule as the A10 rows below — the workbook
    // is the QC record the reviewing lawyer keeps, so a flag that matters to the reading belongs on it.
    //
    // This is the ONE place the module deliberately breaks its own archived-republish rule, so it is
    // worth naming what it costs. Absent ⇒ no row, so a run whose log did carry its common-law terms
    // is byte-identical (checked cell-by-cell against a full clearance run's archived artifacts). A
    // run in THIS state does grow rows on republish — and should: its old workbook either did not
    // exist, because the same defect threw before writeFile, or it silently read as a complete
    // register-only search. Reproducing that byte-for-byte would be reproducing the defect.
    ...(commonLawUnlogged
      ? [{ Field: '⚠  Common-law searching', Value: 'Not set out term by term in this workbook: this run\'s search log holds no per-term common-law rows, so "What was searched" lists the register terms only. Read that tab as an incomplete record of the searching, not as evidence that no common-law search ran, and check any common-law line on "Coverage & gaps" against the run\'s own common-law record.', _caveat: true }]
      : []),
    // ONE report (spec 2026-07-30 §5): the machine-QC checks enumerate their failures HERE — the
    // workbook is where they live now, and they decide nothing about who may read the report. The old
    // "⛔ Not released to the client" delivery language is retired with the split it narrated. Reasons
    // are the checks' own plain-language lines (no internal vocabulary); plainNote() folds any
    // engineering residue. No failed checks ⇒ no row, byte-identical workbook (archived republish safe).
    ...(clientGate && clientGate.released === false
      ? [{ Field: '⚠  Machine QC', Value: `${(clientGate.reasons ?? []).length || 'Some'} machine check(s) failed at publish — recorded here for review. ${((clientGate.reasons ?? []).map(r => plainNote(r)).join(' · ')) || 'the checks could not be evaluated'}`, _caveat: true }]
      : []),
    // A10 (addendum 2026-07-30) — the failing predelivery machine checks, ENUMERATED, whether or not
    // the gate closed: the workbook is the QC record the reviewing lawyer keeps, and a defect that
    // lived only in a _driver sink was a flag nobody read. One row per line. Empty ⇒ no rows — a clean
    // or archived-republish workbook never grows a header for nothing.
    // `lintFailures` is a string[] of ALREADY-PROJECTED lawyer lines (predelivery-lint
    // deliveryFlagLines, applied by publish/index.mjs). It is deliberately NOT the check objects: the
    // workbook is a delivery surface — its download link rides in the cover note that reaches a client
    // principal — so the raw `detail` may not arrive here at all, and a caller that passes a check
    // object gets a neutral row rather than that object's prose. validateAudit holds the same line.
    ...(Array.isArray(lintFailures) && lintFailures.length
      ? [{ Field: 'Machine checks flagged', Value: `${lintFailures.length} — enumerated below; the report was delivered as usual.`, _caveat: true },
         ...lintFailures.map((f, i) => ({ Field: `   Check ${i + 1}`, Value: plainNote(typeof f === 'string' ? f : A10_UNPROJECTED), _caveat: true }))]
      : []),
    { Field: '', Value: '' },
    { Field: 'By the numbers', Value: '', _head: true },
    { Field: '   Findings rated', Value: String(rated.length) },
    { Field: '   On-field (the one stress-tested as closest)', Value: String(disp('adversarial')) },
    { Field: '   Distinguished / manageable', Value: String(disp('distinguished')) },
    { Field: '   Off-field (outside the risk zone)', Value: String(disp('off-field')) },
    { Field: '   Coverage areas assessed', Value: String((coverage || []).length) },
    { Field: '   Open / limited coverage', Value: String(openCount) },
    { Field: '', Value: '' },
    { Field: 'How to read this workbook', Value: '', _head: true },
    { Field: '   Findings', Value: 'every conflicting mark we surfaced, our call on it, and the evidence behind each call.' },
    // the third form is not cosmetic. "every search we ran — register and common-law — so you can see
    // we looked everywhere" is a claim ABOUT THIS SHEET, and on a run whose common-law sweep never
    // reached the search log the sheet does not carry it, so the sentence was simply false.
    { Field: '   What was searched', Value: registerOnly
      ? 'every search we ran. This was a REGISTER-ONLY search: trade mark registers were searched, marketplaces and common-law use were not.'
      : commonLawUnlogged
        ? 'every register search we ran, term by term. The common-law searching is NOT set out here — see the caveat above — so this tab is not the whole record of what was searched.'
        : 'every search we ran — register and common-law — so you can see we looked everywhere.' },
    { Field: '   Coverage & gaps', Value: 'what is fully cleared and what is still open — read this first if you have a doubt.' },
    { Field: '   Evidence tags', Value: '“from source” = checked against the actual register record or live listing · “our read” = our own assessment.' },
    { Field: '   Record retrieved?', Value: 'whether the register entry itself was pulled and read; where a record could not be retrieved, its details are shown unverified.' },
  ];
  return rows;
}

// ── PR-9 (E9) — the STRUCTURED v5 rows, rendered as rows ────────────────────────────────────────────────
// The report (frozen renderer) receives the deterministic string projection; the WORKBOOK is the surface
// that renders the typed rows themselves — per-class, per-market, the counter-registration list, the
// coverage-judgment slices and the corrections attestation. All three helpers are ADDITIVE AND
// CONDITIONAL on the structured forms being present: a legacy (string-form / row-less) record produces
// ZERO rows, so a republished archived workbook stays byte-identical.
function assessmentSummaryRows(ma) {
  if (!ma || (typeof ma.distinctiveness !== 'object' || ma.distinctiveness === null)
    && (typeof ma.connotation !== 'object' || ma.connotation === null)) return [];
  const rows = [{ Field: '', Value: '' }, { Field: 'The mark itself', Value: '', _head: true }];
  const field = (label, v) => {
    if (v == null) return;
    rows.push({ Field: `   ${label}`, Value: plainNote(projectAssessmentField(v)) });
    if (typeof v !== 'object') return;
    for (const r of (Array.isArray(v.per_class) ? v.per_class : []))
      rows.push({ Field: `      Class ${String(r.class).trim()}`, Value: plainNote(r.note) });
    for (const r of (Array.isArray(v.per_market) ? v.per_market : []))
      rows.push({ Field: `      ${plainNote(r.market)}`, Value: plainNote(r.note) });
    for (const r of (Array.isArray(v.counter_registrations) ? v.counter_registrations : []))
      rows.push({ Field: '      Coexisting registration', Value: plainNote([r.mark, r.uri, r.owner, r.note].filter(Boolean).join(' — ')) });
  };
  field('Distinctiveness', ma.distinctiveness);
  field('Connotation', ma.connotation);
  return rows.length > 2 ? rows : [];
}
function coverageJudgmentSummaryRows(cj) {
  const rows = Array.isArray(cj?.rows) ? cj.rows : [];
  if (!rows.length) return [];
  return [{ Field: '', Value: '' }, { Field: 'Coverage judgment — slices considered', Value: '', _head: true },
    ...rows.map((r) => ({ Field: `   ${plainNote(r.area)}`, Value: plainNote(r.note) }))];
}
function correctionsSummaryRows(c) {
  const entries = Array.isArray(c?.entries) ? c.entries : [];
  if (!entries.length) return [];
  return [{ Field: '', Value: '' }, { Field: 'Review corrections applied', Value: '', _head: true },
    ...entries.map((r) => ({ Field: `   ${plainNote(r.entity)}`, Value: plainNote([r.disposition, r.note].filter(Boolean).join(' — ')) }))];
}

/**
 * Build the four-tab clearance audit workbook (Summary · Findings · What was searched · Coverage & gaps).
 * @param {object}  contract       parsed findings.json + sidecars: {findings, coverage, coverageJudgment,
 *                                  contextNotes, fetchState, verdict, jurisdiction}
 * @param {object}  auditParsed    parseAudit(audit.md) — the search log (negatives + audit trail)
 * @param {string}  outPath        .xlsx destination
 * @param {string}  mark           the mark text (fm.title fallback)
 * @param {object}  fm             report front-matter
 */
export async function buildAudit(contract, auditParsed, outPath, mark = '', fm = {}) {
  const ExcelJS = (await import('exceljs')).default;   // lazy — see header note
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.name;
  wb.created = new Date(0); // deterministic

  const coverage = contract?.coverage || [];
  const coverageJudgment = contract?.coverageJudgment || null;
  const verdict = contract?.verdict || null;
  const fetchState = contract?.fetchState || {};
  const jurisdiction = contract?.jurisdiction || '';

  // context notes (famous-mark neighbours) ride the Findings tab as explicitly-not-rated rows, so the book
  // holds exactly four tabs and the "never dropped" promise still holds.
  const contextNotes = (contract?.contextNotes || []).map((n, i) => ({
    ordinal: '·', mark: n.mark || '', owner: { name: n.owner || '', country: n.country || '', registrations: [] },
    source: { source_type: n.source_type || 'common-law-web', resolved_link: n.link || n.url || '' },
    isContextNote: true,
  }));
  const findings = [...(contract?.findings || []), ...contextNotes];

  // The search rows are assembled BEFORE the Summary, because the Summary has to be able to say what
  // this sheet could not evidence: where the run's search log holds no per-term common-law rows the
  // sheet declares the gap instead of listing the sweep, and the Summary carries the same statement.
  const registerOnly = contract?.registerOnly === true;
  const joinedTerms = contract?.commonLawJoinedTerms instanceof Set ? contract.commonLawJoinedTerms
    : Array.isArray(contract?.commonLawJoinedTerms) ? new Set(contract.commonLawJoinedTerms.map(s => String(s).toUpperCase())) : null;
  const searched = searchRows(auditParsed, { findings: contract?.findings || [], joinedTerms, registerOnly });
  const commonLawUnlogged = searched.some(r => r._commonLawUnlogged);

  // 1 · Summary
  addSheet(wb, 'Summary', ['Field', 'Value'],
    [...summaryRows(findings, coverage, fm, { mark, coverageJudgment, verdict, jurisdiction, registerOnly, commonLawUnlogged, clientGate: contract?.clientGate ?? null, lintFailures: contract?.lintFailures ?? [], productName: contract?.productName ?? null }),
      // PR-9 — the structured v5 rows (mark assessment / coverage-judgment slices / corrections
      // attestation) render as ROWS here; the report carries only their string projection. All three
      // are empty on legacy records, so a republished archived workbook never grows rows.
      ...assessmentSummaryRows(contract?.markAssessment ?? null),
      ...coverageJudgmentSummaryRows(coverageJudgment),
      ...correctionsSummaryRows(contract?.corrections ?? null)],
    (row, _d, kept) => { if (kept.has('Field')) row.getCell('Field').font = { bold: true }; });

  // 2 · Findings — one row per conflict; registrations joined; provenance folded into the driver tags.
  addSheet(wb, 'Findings', FINDING_COLS, findingRows(findings, fetchState), (row, _d, kept) => {
    if (kept.has('Link')) {
      const link = row.getCell('Link');
      const url = String(link.value || '').trim();
      if (/^https?:\/\//i.test(url)) { link.value = { text: 'View', hyperlink: url }; link.font = { color: { argb: 'FF0563C1' }, underline: true }; }
    }
    if (kept.has('Risk band')) {
      const band = row.getCell('Risk band');
      if (String(band.value || '').trim() && band.value !== '—') { band.font = { bold: true }; band.alignment = { horizontal: 'center', vertical: 'top' }; }
    }
  });

  // 3 · What was searched — register + common-law, deduped; section header rows shaded. The header rows
  // are identified by the flag the row already carries, not re-derived from three of its cells: the
  // re-derivation needed Scope and Result to exist, which on a sparse run they do not.
  addSheet(wb, 'What was searched', SEARCH_COLS, searched, (row, data) => {
    if (data?._section) row.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDED' } }; });
  });

  // 4 · Coverage & gaps — the honest completeness ledger, state coloured.
  addSheet(wb, 'Coverage & gaps', COVERAGE_COLS, coverageRows(coverage), (row, _d, kept) => {
    if (!kept.has('State')) return;
    const st = row.getCell('State'); const f = STATE_FILL[String(st.value).trim()];
    if (f) { st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + f } }; st.font = { bold: true }; }
  });

  // ALWAYS write the workbook — the audit .xlsx is the deliverable and must never be suppressed. The gate
  // runs AFTER the file is written, and is ADVISORY only: its findings are returned for the driver to log,
  // never a reason to drop the Excel. (A gate that deletes the artifact it was meant to protect is the bug
  // this replaced: a legitimately-sparse run — e.g. no bound Class — must still ship its workbook.)
  await wb.xlsx.writeFile(outPath);
  const gate = validateAudit(wb, { findings, coverage, coverageJudgment, verdict, registerOnly });
  return {
    sheets: wb.worksheets.map(w => w.name),
    findings: findings.length,
    coverage: coverage.length,
    searched: wb.getWorksheet('What was searched')?.rowCount - 1 || 0,
    gateViolations: gate.violations,
  };
}

/**
 * validateAudit — the build gate. Reads the assembled workbook back and asserts the spec's MUST-BE-TRUE list.
 * Returns { ok, violations[] }. Exported so tests assert the same contract the build enforces.
 */
export function validateAudit(wb, { findings = [], coverage = [], coverageJudgment = null, verdict = null, registerOnly = false } = {}) {
  const v = [];
  const sheets = wb.worksheets.map(w => w.name);

  // 1 — exactly four tabs, the four plain names, none saying "receipts".
  const EXPECT = ['Summary', 'Findings', 'What was searched', 'Coverage & gaps'];
  if (sheets.length !== 4) v.push(`expected 4 tabs, got ${sheets.length} (${sheets.join(', ')})`);
  for (const name of EXPECT) if (!sheets.includes(name)) v.push(`missing tab "${name}"`);

  // 3 — banned internal vocabulary anywhere a lawyer can see (tab name, header, or any cell).
  const scan = (txt, where) => { if (txt != null && BANNED.test(String(txt))) v.push(`banned vocab "${String(txt).match(BANNED)[0]}" in ${where}`); };
  for (const name of sheets) scan(name, `tab name "${name}"`);
  for (const ws of wb.worksheets) {
    ws.eachRow((row, rn) => row.eachCell(cell => {
      const val = cell.value && typeof cell.value === 'object'
        ? (cell.value.text ?? cell.value.hyperlink ?? (cell.value.richText || []).map(r => r.text).join('')) : cell.value;
      scan(val, `${ws.name} r${rn}`);
    }));
  }

  // 3b — the A10 machine-check rows, HARD. Everything above is advisory by design: the Findings and
  // What-was-searched sheets carry model-authored prose from runs that shipped months ago, and a
  // republish must not lose its workbook over a word in one of them. The A10 rows are different in
  // kind — they are composed by code, from a fixed projection table, on every run — so there is no
  // legitimate way for engine vocabulary to appear in one, and "advisory" was exactly why CI stayed
  // green while `HTTP 404 for uri=/mark/ch/06198` shipped in Summary r12. These rows are held to the
  // delivery house rules (predelivery-lint's list) AND to BANNED, and a hit is reported as a
  // violation the A10 tests assert to be empty.
  const summaryWs = wb.getWorksheet('Summary');
  if (summaryWs) {
    summaryWs.eachRow((row, rn) => {
      const cellText = (c) => { const val = c.value; return val && typeof val === 'object' ? (val.text ?? val.hyperlink ?? (val.richText || []).map(r => r.text).join('')) : val; };
      if (!A10_FIELD_RE.test(String(cellText(row.getCell(1)) ?? ''))) return;
      const value = String(cellText(row.getCell(2)) ?? '');
      const hits = deliveryVocabViolations(value);
      if (BANNED.test(value)) hits.push(`banned vocab "${value.match(BANNED)[0]}"`);
      if (hits.length) v.push(`machine-check row Summary r${rn} is not lawyer-language: ${hits.join(', ')}`);
    });
  }

  // 2 — no column entirely empty (dead schema). A column is empty if every data row's cell is blank.
  for (const ws of wb.worksheets) {
    const nCols = ws.columnCount;
    for (let c = 1; c <= nCols; c++) {
      let any = false;
      for (let r = 2; r <= ws.rowCount; r++) {
        const val = ws.getRow(r).getCell(c).value;
        const s = val && typeof val === 'object' ? (val.text ?? val.hyperlink ?? '') : val;
        if (String(s ?? '').trim()) { any = true; break; }
      }
      if (!any && ws.rowCount > 1) v.push(`empty column "${ws.getRow(1).getCell(c).value}" in ${ws.name}`);
    }
  }

  const findWs = wb.getWorksheet('Findings');
  const col = (ws, name) => { let idx = 0; ws.getRow(1).eachCell((c, i) => { if (c.value === name) idx = i; }); return idx; };
  // A column addSheet DROPPED has no index here — col() returns 0, and exceljs refuses column 0 as hard
  // as it refuses column 16385, so the gate threw on exactly the workbooks it exists to judge. Reading a
  // dropped column as an EMPTY cell is not a softening: every check below already treats "" as the
  // failure it is, so a Findings sheet with no Link column reports "link does not resolve" once per row,
  // which is the truth about that workbook. What the gate must never do is throw — it runs after the
  // file is on disk, so its exception would destroy a deliverable that had already been written.
  const textAt = (row, idx) => {
    if (!idx) return '';
    const val = row.getCell(idx).value;
    return val && typeof val === 'object' ? String(val.text ?? val.hyperlink ?? '') : String(val ?? '');
  };

  // 5/6/7 — Findings integrity: one row per conflict; identity + source + treatment + working link; every
  // rated finding's four drivers tagged from-source/our-read; a failed fetch visibly unverified.
  if (findWs) {
    // 7 — one row per finding: NO ghost/continuation row — every data row carries its own mark (a split
    // multi-registration owner would leave blank-mark continuation rows, which is exactly what's forbidden).
    let ghost = 0;
    const cMark0 = col(findWs, 'Conflicting mark');
    for (let r = 2; r <= findWs.rowCount; r++) {
      if (!textAt(findWs.getRow(r), cMark0).trim()) ghost++;
    }
    if (ghost) v.push(`Findings has ${ghost} ghost/continuation row(s) with no mark (multi-registration owners must stay on one row)`);
    const cMark = col(findWs, 'Conflicting mark'), cSrc = col(findWs, 'Source'), cTreat = col(findWs, 'How we treated it'),
      cLink = col(findWs, 'Link'), cRet = col(findWs, 'Record retrieved?'),
      cMs = col(findWs, 'Mark similarity'), cGp = col(findWs, 'Goods proximity'), cUse = col(findWs, 'Use'), cEnf = col(findWs, 'Enforcer'),
      cBand = col(findWs, 'Risk band');
    for (let r = 2; r <= findWs.rowCount; r++) {
      const row = findWs.getRow(r);
      const cellText = i => textAt(row, i);
      const mark = cellText(cMark).trim();
      if (!mark) continue; // blank spacer safety
      const isCtx = /not a rated conflict/i.test(cellText(cTreat));
      if (!cellText(cSrc).trim()) v.push(`Findings "${mark}": no source`);
      if (!cellText(cTreat).trim()) v.push(`Findings "${mark}": no treatment`);
      if (!cellText(cBand).trim()) v.push(`Findings "${mark}": no band/treatment marker`);
      // link resolves — but a famous-neighbour context note is knowledge-cited with no fetched record, so it
      // legitimately carries no link (its row is exempt, exactly as it is from the four-driver check below).
      const linkVal = cLink ? row.getCell(cLink).value : null;
      const href = linkVal && typeof linkVal === 'object' ? linkVal.hyperlink : linkVal;
      if (!isCtx && !/^https?:\/\//i.test(String(href ?? ''))) v.push(`Findings "${mark}": link does not resolve to http(s)`);
      // fetch-failed visibly unverified
      const ret = cellText(cRet);
      if (/not retrieved/i.test(ret) && !/unverified/i.test(ret) && !/n\/a/i.test(ret) && !/read/i.test(ret)) {
        // "Not individually retrieved" is allowed; only a fetch-FAILURE must carry "unverified"
      }
      // 5 — rated findings: four drivers each tagged from-source/our-read (context notes exempt).
      if (!isCtx) {
        for (const [cc, label] of [[cMs, 'mark similarity'], [cGp, 'goods proximity'], [cUse, 'use'], [cEnf, 'enforcer']]) {
          const t = cellText(cc);
          if (!/from source|our read/i.test(t)) v.push(`Findings "${mark}": ${label} driver not tagged from-source/our-read (got "${t}")`);
        }
      }
    }
  }

  // 4 — common-law searches present in What was searched. On a REGISTER-ONLY run the expectation
  // inverts: the block must be ABSENT, because the sheet is built from the searches that actually ran
  // and a common-law block there would mean the workbook is claiming a sweep the run never did.
  //
  // The block alone is no longer the test. searchRows now emits the COMMON-LAW header plus a single
  // DECLARATION row when the run's search log holds no per-term common-law rows — honest on the
  // sheet, but it would flip a header-only check green and retire the one finding that named the
  // defect. So the count is of SEARCHED TERMS: a row whose term opens REGISTER/COMMON-LAW is a
  // section or that declaration, and anything else beneath the common-law header is a real term.
  // Zero of them on a run nothing records as register-only stays a violation, worded for the state
  // it is actually in — the sheet says so, which is not the same as the gap being closed.
  //
  // "no common-law block" is consequently no longer reachable from buildAudit: on a non-register-only
  // run searchRows always emits the header, with terms or with the declaration. It stays because this
  // gate is EXPORTED and a caller can hand it a workbook this builder did not assemble — a missing
  // block is still the right thing to say about such a workbook. Do not read its absence from the
  // build path as the check having been retired.
  const searchWs = wb.getWorksheet('What was searched');
  if (searchWs) {
    const cTerm = col(searchWs, 'Search term / variant') || 2;
    let inCommon = false, sawCommon = false, commonTerms = 0;
    searchWs.eachRow((row, rn) => {
      if (rn === 1) return;                                   // header
      const t = textAt(row, cTerm).trim();
      if (/^REGISTER\b/.test(t)) { inCommon = false; return; }
      if (/^COMMON-LAW\b/.test(t)) { sawCommon = true; inCommon = true; return; }
      if (inCommon && t) commonTerms++;
    });
    if (!registerOnly && !sawCommon) v.push('What was searched: no common-law block');
    if (!registerOnly && sawCommon && !commonTerms) v.push("What was searched: the common-law block carries no searched terms — the run's search log recorded none, so the sheet states the sweep rather than setting it out");
    if (registerOnly && sawCommon) v.push('What was searched: a common-law block on a register-only run — the workbook claims a sweep that did not run');
  }

  // 8/9 — Summary leads with verdict + caveat; and the headline is never clean while a unit did not finish.
  const sumWs = wb.getWorksheet('Summary');
  if (sumWs) {
    let hasVerdict = false, hasCaveat = false;
    sumWs.eachRow(row => {
      const f = String(row.getCell(1).value || '');
      if (/^Verdict$/.test(f)) hasVerdict = true;
      if (/check first/i.test(f)) hasCaveat = true;
    });
    if (!hasVerdict) v.push('Summary: no Verdict row');
    if (coverageOpen({ coverage, coverageJudgment, verdict })) {
      if (!hasCaveat) v.push('Summary: coverage is open but no caveat row (headline-honesty)');
      const covWs = wb.getWorksheet('Coverage & gaps');
      let openRow = false;
      // by header, not by position: a dropped column shifts the second column to a different question,
      // and this check must read the State word or read nothing (and then say the caveat is missing).
      const cState = covWs ? col(covWs, 'State') : 0;
      covWs?.eachRow(row => { if (/^(Open|Limited)$/.test(textAt(row, cState).trim())) openRow = true; });
      if (!openRow) v.push('Coverage & gaps: coverage is open but no Open/Limited row (headline-honesty)');
    }
  }

  return { ok: v.length === 0, violations: v };
}
