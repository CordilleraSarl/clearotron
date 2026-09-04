// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/knockout.mjs — the KNOCKOUT (Depth 1) publisher: the one-row-per-mark report table (the
// interactive skill's template-formatting.md, byte-faithful palette), the audit workbook (Findings /
// Negative Results / Audit Trail on every run, plus the conditional sheets buildKnockoutWorkbook adds —
// the trail built from the DRIVER's own sweep receipts, stronger than the interactive skill's
// self-reported trail), meta.json batch stamps, and the email composer. Deliberately separate from publishReport (single-clearance-shaped); shares the exported
// palette (TONE_TIER, resolved against the run's FROZEN framework) so driver and interactive output
// can never drift and a knockout never reads the clearance composer's module state.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { driverDir, ensureDriverDir } from '../../shared/driver-dir.mjs';   //
import { riskTier, TONE_TIER, regenIndex, regenSurfaces, auditRouteFor, markReportRouteFor } from './index.mjs';
import { runKnockoutLint, deliveryFlagLines } from '../predelivery-lint.mjs';
import { note } from '../log.mjs';
import { addSheet } from './xlsx.mjs';
import { COUNT_PREDICATES, COUNT_BASIS, countsForMark, countLine, countedMarks, variantFormsLine } from '../register-count.mjs';
import { RECORD_BASIS, recordsForMark, recordsLine, listedMarks, normalizeRegisterRecordLinks } from '../register-records.mjs';
import { reportIdentityFor, productCoverageNote, kebab } from '../search-policy.mjs';
import { batchMarkName } from '../mark-name.mjs';
import { renderKnockoutHtml, knockoutReportData } from './render-knockout.mjs';
import { resolveDemoData, demoBannerMd } from './demo-marking.mjs';   //
import { engineCommit } from '../engine-build.mjs';
import { knockoutFindingViews, knockoutFindingRange } from '../findings-model.mjs';
import { knockoutReceipts, worstBand } from '../verify-knockout.mjs';

const grpRead = (p, mode) => { try { chmodSync(p, mode); } catch { /* best-effort */ } };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The http(s)-only link helpers that used to live here went with the MSO review table (2026-07-28) and
// had no caller left: this module writes workbook CELLS and a cover note that links the report, never a
// model-derived URL. The rule they carried is not gone — it is enforced where a research URL actually
// becomes an href, in publish/render-knockout.mjs (linkOrText), and pinned by that file's own tests.
// Band colours come from the FROZEN framework's tones — NEVER riskTier's module-global EMAIL_BANDS
// (set by the clearance email composer; empty or stale here, so a custom ladder would render gray or
// inherit a previous clearance run's palette in the same process — review 2026-07-17). Fallback for a
// label the frozen ladder doesn't know: riskTier's legacy five-word regexes, then neutral gray.
export function bandTier(framework, word) {
  const tone = framework?.bands?.find((b) => String(b.label).toLowerCase() === String(word ?? '').trim().toLowerCase())?.tone;
  if (tone && TONE_TIER[tone]) return { ...TONE_TIER[tone], label: String(word) };
  return riskTier(word) ?? { bg: '#bfbfbf', fg: '#000', txt: '#555', label: String(word ?? '—') };
}
// The email body is inline-styled and self-contained by contract (docs/DELIVERY.md: the courier sends
// `emailBodyHtml` verbatim), so it keeps a mail-safe font stack. The report does not — it has a stylesheet.
const FONT = `font-family:Calibri,sans-serif;font-size:11pt`;

// badge tone → the index's b-l* classes (regenIndex renders <span class="b b-<badge>">): map by tone
// so a customer ladder colours identically to the clearance rows.
const TONE_BADGE = { severe: 'l4', high: 'l3', medium: 'mh', low: 'l2', minimal: 'l1' };
export function bandBadge(framework, band) {
  const tone = framework?.bands?.find((b) => b.label.toLowerCase() === String(band ?? '').toLowerCase())?.tone;
  return TONE_BADGE[tone] ?? 'mh';
}

const bandCounts = (framework, marks) => {
  const ladder = (framework?.bands ?? []).map((b) => b.label);
  const counts = new Map(ladder.map((l) => [l, 0]));
  for (const m of marks) {
    const hit = ladder.find((l) => l.toLowerCase() === String(m.rating ?? '').toLowerCase());
    if (hit) counts.set(hit, counts.get(hit) + 1);
  }
  return [...counts].filter(([, n]) => n > 0);
};
export const knockoutStatement = (framework, marks) =>
  `Knockout screen — ${marks.length} mark${marks.length === 1 ? '' : 's'}: ${bandCounts(framework, marks).map(([l, n]) => `${n} ${l}`).join(', ') || 'no rated marks'}.`;

// The MSO review table and its bare-<div> page wrapper are DELETED (2026-07-28). They were a
// byte-faithful port of the interactive skill's Word template — `border:solid windowtext 1pt`, Calibri
// 11pt, no <!DOCTYPE>, no <head>, no <meta charset> — and they rendered a Depth 2 report as a grey
// spreadsheet with the register hit-counts the customer paid for buried in a table cell. The report now
// renders through publish/render-knockout.mjs in the product's own design language, off the same shared
// stylesheet and brand tokens as the clearance report. Internal working material (the purple staff notes,
// the model's registerEstimate) is not stripped from the report — it is not IN the report; it lives in
// the audit workbook, which is what an internal artifact is for.

// ── The workbook: the skill's three sheet names + columns, plus the conditional sheets below ────────
// ── ONE DRILL-THROUGH KEY: `<MARK> #<ordinal>`, per mark ──────────────────────────────────────
// This sheet used to number findings on a GLOBAL running counter while the typed record numbers per
// mark, so the report's "#2" and the workbook's "#2" were different findings and the Audit Trail's
// "Finding Reference" pointed at whichever finding of that mark happened to be counted first. The global
// counter is DELETED. The report prints `<MARK> #<ordinal>` beside every conflict, the Findings sheet
// carries the same string in its own column, and the Audit Trail names the mark's range.
//
// THE RANGE CELL IS A COUNT CLAIM (`<MARK> #1–#4` says four findings), which is why the ordinal is not
// the model's to choose: validateKnockoutFindings ranks and renumbers 1…N on the merged artifact,
// before publish ever sees it. Written when the numbering was the model's, this cell printed `#3–#7`
// over two findings.
//
// THE THREE DEAD READS ARE GONE. `f.source` ('Source / Platform'), `f.levelNotation` ('Risk Level') and
// `f.notes` ('Notes') appear in no contract the stage was ever given, so those three columns have
// shipped blank since the lane launched — three columns of `?? ''` that read as "nothing found" rather
// than "never asked for". 'Impact' goes with them: it was the second rating scale. What replaces them is
// what the typed record actually carries. A `—` means the shape that produced the row never had the
// field (an archived prose finding), which is a different fact from an empty cell.
export async function buildKnockoutWorkbook(findings, receipts, outPath, registerCounts = null, qcFlags = [], framework = null, registerRecords = null) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const findingRows = [];
  const negativeRows = [];
  const refByMark = new Map();
  for (const m of findings.marks ?? []) {
    const range = knockoutFindingRange(m);
    if (range) refByMark.set(m.name, range);
    for (const v of knockoutFindingViews(m, { manifest: framework })) {
      findingRows.push({
        'Mark': m.name, 'Finding Reference': v.ref, 'Finding Name': v.name ?? '—', 'Owner': v.owner ?? '—',
        'Band': v.band ?? '—', 'Type': v.type ?? '—', 'Net': v.lead ?? '—', 'Basis': v.detail ?? '—',
        'Evidence': v.evidence.join('\n') || '—',
      });
    }
    for (const n of m.negatives ?? []) {
      negativeRows.push({ 'Mark': m.name, 'Search Term': n.term ?? '', 'Source / Context': n.source ?? '', 'Result': n.note ?? 'No results found', 'Notes': '' });
    }
  }
  const trailRows = (receipts ?? []).map((r) => ({
    'Mark': r.mark, 'Search Term': r.mark, 'Source / Context': `${r.executor ?? 'perplexity'} (${r.preset ?? ''})`,
    'Result Summary': r.ok ? `ok — ${r.bytes ?? 0} bytes` : `FAILED — ${r.cause ?? 'unknown'}`,
    'Finding Reference': r.ok && refByMark.has(r.mark) ? refByMark.get(r.mark) : '',
    'Sweep Call #': r.callNo ?? '', 'Wall-time (s)': r.took_ms != null ? Math.round(r.took_ms / 1000) : '', 'OK/Degraded': r.ok ? 'OK' : 'Degraded',
  }));
  addSheet(wb, 'Findings', ['Mark', 'Finding Reference', 'Finding Name', 'Owner', 'Band', 'Type', 'Net', 'Basis', 'Evidence'], findingRows);
  addSheet(wb, 'Negative Results', ['Mark', 'Search Term', 'Source / Context', 'Result', 'Notes'], negativeRows);
  addSheet(wb, 'Audit Trail', ['Mark', 'Search Term', 'Source / Context', 'Result Summary', 'Finding Reference', 'Sweep Call #', 'Wall-time (s)', 'OK/Degraded'], trailRows);
  // ── Depth 2: an EXTRA sheet, only when counts were taken ────────────────────────────────────────
  // Additive by design: the three sheets above are the interactive skill's exact contract and a
  // knockout without counts produces a byte-identical workbook. A count that could not be taken says
  // "not available" in the cell — never a blank and never a 0, because both read as "none found".
  // ── Working notes: the material that used to render PURPLE on the report ──────────────────────────
  // It is not stripped from the report any more, it is not IN the report — one report, and internal
  // working material belongs in the internal artifact. This sheet is where it lands, so nothing is lost:
  // the staff notes that framed a rating, and the model's register ESTIMATE (a guess about what the
  // registers hold), which never belonged beside a counted figure on a client-facing page.
  // Additive and conditional: a run with no working notes produces the same workbook it always did.
  const noteRows = [];
  for (const m of findings.marks ?? []) {
    for (const n of m.purpleNotes ?? []) noteRows.push({ 'Mark': m.name, 'Type': 'Internal note', 'Note': n });
    if (m.registerEstimate) noteRows.push({ 'Mark': m.name, 'Type': 'Register estimate (model)', 'Note': m.registerEstimate });
  }
  if (noteRows.length) addSheet(wb, 'Working Notes', ['Mark', 'Type', 'Note'], noteRows);

  if (registerCounts?.marks?.length) {
    const cell = (c) => (Number.isFinite(c?.total) ? c.total : 'not available');
    const countRows = (findings.marks ?? []).map((m) => {
      const e = countsForMark(registerCounts, m.name);
      const row = {
        'Mark': m.name,
        'Classes counted': (e?.classes ?? []).join(', ') || 'all classes',
        'Territories': (registerCounts.scope?.regions ?? []).join(', ') || 'worldwide',
      };
      for (const p of COUNT_PREDICATES) row[p.column] = cell(e?.counts?.[p.key]);
      // WHICH FORMS the close column was counted over. Without it the aggregate is a number nobody can
      // check: two runs of the same mark under different rule tables produce different figures and the
      // sheet would show no reason why. An archived schema-1 row (no expansion cell) says so in words
      // rather than showing a blank, which on this sheet reads as "none".
      row['Close variation forms'] = variantFormsLine(e) ?? 'not recorded — this run predates the close-variation column';
      row['Register'] = registerCounts.providerLabel ?? registerCounts.provider ?? '';
      row['Basis'] = COUNT_BASIS;
      // The verbatim provider reason for anything missing — the auditable half of "not available".
      row['Notes'] = COUNT_PREDICATES
        .filter((p) => !Number.isFinite(e?.counts?.[p.key]?.total))
        .map((p) => `${p.label}: ${e?.counts?.[p.key]?.unavailable ?? 'no count recorded'}`)
        .join(' · ');
      return row;
    });
    addSheet(wb, 'Register Counts',
      ['Mark', 'Classes counted', 'Territories', ...COUNT_PREDICATES.map((p) => p.column), 'Close variation forms', 'Register', 'Basis', 'Notes'],
      countRows);
  }
  // ── part 5: the FILINGS behind the narrow counts ────────────────────────────────────────────
  //
  // Same conditional-sheet discipline as the counts sheet above, and one deliberate difference: the
  // condition is THE ARTIFACT EXISTING, not the rows existing. A run whose every fetch failed produces
  // an artifact with no records in it, and gating on `records.length` would give that run no sheet at
  // all — indistinguishable from a run that never listed, which is the absence-reads-as-a-pass defect
  // this lane keeps closing. The sheet is written and the rows say what happened.
  //
  // A run with NO artifact still produces a byte-identical workbook to yesterday's, which is what keeps
  // an archived republish honest.
  if (registerRecords) {
    const recordRows = [];
    for (const m of findings.marks ?? []) {
      const e = recordsForMark(registerRecords, m.name);
      if (!e) {
        recordRows.push({
          'Mark': m.name, 'Matched form': '—', 'Basis': '—', 'Trademark': 'not listed',
          'Owner': '—', 'Status': '—', 'Classes': '—', 'Territory': '—', 'Filed': '—', 'Registered': '—',
          'Record': '—', 'Note': registerRecords.unavailable ?? 'no listing was recorded for this mark',
        });
        continue;
      }
      for (const r of e.records ?? []) {
        recordRows.push({
          'Mark': m.name,
          // WHICH QUESTION FOUND IT, on every row. A filing on the name and a filing on a generated
          // variant are different facts, and a sheet that fuses them is a sheet that overstates.
          'Matched form': r.matchedForm ?? '—',
          'Basis': r.matchedBasis === 'close' ? 'close variation' : 'identical',
          'Trademark': r.mark ?? '—', 'Owner': r.owner ?? '—', 'Status': r.status ?? '—',
          'Classes': (r.classes ?? []).join(', ') || '—', 'Territory': r.territory ?? '—',
          'Filed': r.applicationDate ?? '—', 'Registered': r.registrationDate ?? '—',
          'Record': r.url ?? r.recordId ?? '—', 'Note': '',
        });
      }
      // Every search that did NOT answer gets its own row. Without them a mark with two dead searches
      // and three filings reads as a mark with three filings.
      for (const t of e.terms ?? []) {
        if (t.ok) continue;
        recordRows.push({
          'Mark': m.name, 'Matched form': t.term, 'Basis': t.basis === 'close' ? 'close variation' : 'identical',
          'Trademark': 'not available', 'Owner': '—', 'Status': '—', 'Classes': '—', 'Territory': '—',
          'Filed': '—', 'Registered': '—', 'Record': '—', 'Note': t.reason ?? 'the search did not run',
        });
      }
      if (!(e.records ?? []).length && (e.terms ?? []).every((t) => t.ok)) {
        recordRows.push({
          'Mark': m.name, 'Matched form': '—', 'Basis': '—', 'Trademark': 'none found',
          'Owner': '—', 'Status': '—', 'Classes': '—', 'Territory': '—', 'Filed': '—', 'Registered': '—',
          'Record': '—', 'Note': recordsLine(e) ?? '',
        });
      }
      if (e.capped) {
        recordRows.push({
          'Mark': m.name, 'Matched form': '—', 'Basis': '—', 'Trademark': `capped at ${e.cap}`,
          'Owner': '—', 'Status': '—', 'Classes': '—', 'Territory': '—', 'Filed': '—', 'Registered': '—',
          'Record': '—', 'Note': recordsLine(e) ?? '',
        });
      }
    }
    addSheet(wb, 'Register Filings',
      ['Mark', 'Matched form', 'Basis', 'Trademark', 'Owner', 'Status', 'Classes', 'Territory', 'Filed', 'Registered', 'Record', 'Note'],
      recordRows);
  }

  // ── The machine-check record (2026-07-31) ───────────────────────────────────────────────────────
  // / made the predelivery lint the workbook's QC record, and the workbook is the QC record the
  // reviewing lawyer keeps. Additive and CONDITIONAL, exactly like the two sheets above: no flags ⇒ no
  // sheet ⇒ a clean run's workbook is byte-identical to the one it produced yesterday (and an archived
  // republish never grows a sheet for nothing). The lines arrive ALREADY PROJECTED (deliveryFlagLines):
  // this is a delivery surface — its download link rides in the cover note — so the checks' own `detail`
  // may not reach it at all. Flags only: nothing here decides whether the workbook ships.
  const qcLines = (Array.isArray(qcFlags) ? qcFlags : []).filter((l) => typeof l === 'string' && l.trim());
  if (qcLines.length) {
    addSheet(wb, 'Machine Checks', ['Check', 'What it found'], [
      { 'Check': 'Machine checks flagged', 'What it found': `${qcLines.length} — enumerated below; the report was delivered as usual.` },
      ...qcLines.map((l, i) => ({ 'Check': `Check ${i + 1}`, 'What it found': l })),
    ]);
  }
  await wb.xlsx.writeFile(outPath);
}

// ── The email: a COVER NOTE. Headline band, one line per mark, the report link. Nothing else. ────────
// The report is the deliverable and the email points at it — the same doctrine the clearance lane
// follows. The old `delivery.email === 'table'` overlay inlined the full review table into the mail
// body, and it inlined the INTERNAL variant: purple staff notes and the model's register estimate went
// out over the wire to whoever the mail reached. A second rendering of the findings in a second dialect
// is also a second thing to keep true. Per-lawyer client formatting is drafted by the assistant from the
// run's report-data.json, not by a template knob in here.
// `reports` is publishKnockout's own list — `[{mark, url}]`, one per published document — and
// `auditUrl` is composed by the publisher from the pool URL it already holds. Neither is derived here.
// The audit link used to be `url.replace(/report\.html$/, auditFile)`, a second derivation of a URL that
// silently produced nothing the moment a report stopped being called `report.html`; a batch's documents
// are `report-<slug>.html`, so that surgery would have shipped a broken workbook link on every batch.
export function composeKnockoutEmail({ findings, framework, overall, reports = [], auditUrl = null, job, registerCounts = null, qcFlags = [] }) {
  const t = bandTier(framework, overall);
  const n = (findings.marks ?? []).length;
  const urlByMark = new Map((reports ?? []).map((r) => [r.mark, r.url]).filter(([, u]) => u));
  // ONE LINK PER NAME, ON THE NAME. A batch has no single document, so the head links nothing and
  // says how to read the list instead: a "full report" link on a batch could only be one name standing
  // for all of them. A single-mark run keeps its head link exactly as before — same bytes, same place.
  const only = n === 1 ? urlByMark.get((findings.marks ?? [])[0]?.name) ?? null : null;
  const head = `<p style="${FONT}">Knockout trademark review${job?.ref ? ` — ${esc(job.ref)}` : ''}: <b>${n} mark${n === 1 ? '' : 's'}</b>, worst band <b style="color:${t.txt}">${esc(overall ?? '')}</b>.`
    + (only ? ` <a href="${esc(only)}">Open the full report</a>${auditUrl ? ` · <a href="${esc(auditUrl)}">audit workbook</a>` : ''}.` : '')
    + (!only && n > 1 ? ` One report per name below${auditUrl ? `, and one <a href="${esc(auditUrl)}">audit workbook</a> for the batch` : ''}.` : '') + `</p>`;
  // — THE FIRST NON-BLANK, never element 0. `?? fallback` catches null and undefined
  // and not "", so an array whose first entry was an empty string put an empty italic line at the top of
  // the requester's email. That array shape reaches here now that the lint no longer refuses it, and the
  // fallback exists precisely so this line is never blank.
  const firstCaveat = (findings.batch?.standardCaveats ?? []).map((c) => String(c ?? "").trim()).find(Boolean);
  const caveat = `<p style="${FONT}"><i>${esc(firstCaveat || 'Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction.')}</i></p>`;
  const lines = (findings.marks ?? []).map((m) => {
    const counted = registerCounts ? countLine(countsForMark(registerCounts, m.name)) : null;
    const href = n > 1 ? urlByMark.get(m.name) ?? null : null;
    return `<li><b>${esc(m.name)}</b>: <b style="color:${bandTier(framework, m.rating).txt ?? 'black'}">${esc(m.rating)}${m.ratingQualifier ? ` (${esc(m.ratingQualifier)})` : ''}</b>${m.classesDriving?.length ? ` — Classes ${esc(m.classesDriving.join(', '))}` : ''}${counted ? ` — ${esc(counted)}` : ''}${m.degraded ? ' — <i>manual verification recommended (automated research unavailable)</i>' : ''}${href ? ` — <a href="${esc(href)}">open this report</a>` : ''}</li>`;
  }).join('');
  // A10, extended to this lane 2026-07-31 — the surviving machine-check flags reach the reviewing
  // lawyer WITH the report, in the projection's own words, or they reach nobody. The gate stays a gate:
  // this WARNS beside the report link and never suppresses, delays or re-orders the delivery. The lines
  // are deliveryFlagLines() by contract (see the caller): this body is sent verbatim by the courier and
  // on a client-principal run the recipient IS the client, so the checks' own `detail` never comes here.
  // Empty ⇒ no block, byte-identical mail (the clean run and the archived republish).
  // — the cover note carries NO machine-check block. A failing internal check is not a coverage
  // gap and the reader cannot act on it; the projection reaches the workbook's Machine Checks sheet and
  // the run record, both of which the reviewing lawyer has. `qcFlags` still arrives and is still what
  // the workbook enumerates — this seam simply does not render it.
  return [head, `<ul style="${FONT}">${lines}</ul>`, caveat].filter(Boolean).join('\n');
}

// ── The publisher ────────────────────────────────────────────────────────────────────────────────────
// `delivery`: the run's frozen delivery overlay, threaded to the template so the knockout obeys the
// SAME three-state confidentiality rule the clearance does. It defaults to null — the no-opinion state,
// which renders the plain marking this template always printed — so the ~15 fixtures in
// knockout-units.test.mjs that call this without one are unaffected by its arrival.
export async function publishKnockout({ runId, codename, runDir, findings, plan, framework, overall, poolRoot, poolUrl, customerKey, searchPolicy, tokens, registerCounts = null, skipRegen = false, delivery = null }) {
  // ── THE RECEIPTS DOOR ───────────────────────────────────────────────────────────────────────
  // BEFORE anything is written, and it can refuse. The live lane already gates the merged artifact
  // (pipeline-knockout.mjs → validateMergedFindings), so on that path this is belt-and-braces; the path
  // it exists for is REPUBLISH — publish/report-registry.mjs republishRun() reads an archived
  // knockout-findings.json and calls this function directly, running no validator at all. A re-render
  // that re-published a citation the driver cannot trace to held evidence would put a fabricated link
  // back in front of a client, months after the gate that should have caught it.
  //
  // It refuses rather than flags, and that is not the delivery-gate rule inverted: the predelivery lint
  // below decides nothing and never blocks, because it judges PROSE. This judges whether the document's
  // evidence is real. A knockout report whose links cannot be traced is not a report with a defect, it
  // is a different document — so no artifact is better than that artifact, and the message names every
  // failing citation so the run can be fixed rather than guessed at.
  //
  // Both this and the merged gate read the run WORKSPACE (research/<mark>.md), which archive() moves
  // whole and purge-runs.mjs removes whole — so a workspace that still exists to republish from still
  // holds the payloads that receipt it.
  const receipts = knockoutReceipts(runDir, findings?.marks ?? []);
  if (!receipts.ok) {
    throw new Error(`knockout publish REFUSED for ${runId}: ${receipts.failures.length} finding citation(s) could not be traced to this run's own research payloads.\n  `
      + receipts.failures.join('\n  '));
  }
  // A pass with nothing to check is not the same answer as a pass, so it is recorded rather than
  // assumed: `urls: 0` in the receipt below means no finding cited anything.
  note(`knockout receipts: ${receipts.checked.urls} citation(s) across ${receipts.checked.findings} finding(s) on ${receipts.checked.citing}/${receipts.checked.marks} mark(s) traced to held evidence`);
  const poolRunDir = join(poolRoot, runId);
  mkdirSync(poolRunDir, { recursive: true });
  const writeRO = (name, data) => { const p = join(poolRunDir, name); writeFileSync(p, data); grpRead(p, 0o640); };
  const issued = (() => {
    try {
      const d = new Date();
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
      return `${date} · ${time}`;
    } catch { return null; }
  })();

  // the SWEEP ledger → the audit trail. Named apart from the URL-receipts check above on purpose: one
  // is the record of what the driver called, the other is the check that the findings cite what it held.
  let sweepReceipts = [];
  try {
    sweepReceipts = readFileSync(driverDir(runDir, 'knockout-sweep.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { /* fixture/degenerate runs may have none */ }

  // Depth 2's sidecar, read from the RUN DIR rather than taken on trust from the caller: the
  // publisher renders what the driver measured and wrote, and a republish of an archived run picks up
  // the same file. An absent sidecar publishes exactly today's knockout.
  if (!registerCounts) {
    try { registerCounts = JSON.parse(readFileSync(driverDir(runDir, 'register-counts.json'), 'utf8')); }
    catch { registerCounts = null; }
  }
  // part 5 — the filings sidecar, read the same way and for the same reason: the publisher renders
  // what the driver measured and wrote, and a republish of an archived run picks up the same file. An
  // absent sidecar publishes exactly the counts-only knockout, with no filings section anywhere.
  let registerRecords = null;
  try { registerRecords = JSON.parse(readFileSync(driverDir(runDir, 'register-records.json'), 'utf8')); }
  catch { registerRecords = null; }

  // ── — THIS LANE HAD NO RECORD-ORIGIN LOGIC AT ALL ─────────────────────────────────────────────
  //
  // gave the clearance lane a provider-derived record host and gave it a repair; the knockout
  // renderer never got either. `render-knockout.mjs` links whatever `record.url` holds, so a run on any
  // provider could cite a filing and link to a DIFFERENT registry — invisibly, because the link resolves
  // to a real page and nothing errors. The reader simply arrives at the wrong vendor.
  //
  // Here rather than in the renderer, and once rather than per surface: this sidecar feeds the workbook
  // (buildKnockoutWorkbook), the report and the batch entry alike, so normalising at the read is what
  // makes all three state the same link. A repair that reached the report and not the workbook would put
  // two different registers in one delivery — the clearance lane says so in the same words.
  //
  // KEYED ON THE RUN'S OWN RECEIPT. `register-records.json` carries the `provider` that produced it, so
  // an archived run republishes against the register IT searched. Reading CLEAROTRON_DATABASE would
  // judge a year-old run against whatever this box is configured for today.
  const recordLinksDropped = normalizeRegisterRecordLinks(registerRecords);
  if (recordLinksDropped.length) {
    note(`knockout record links: ${recordLinksDropped.length} URL(s) on a host ${registerRecords?.provider ?? 'this run'} `
      + `cannot produce reduced to the record number — ${recordLinksDropped.slice(0, 3).map((d) => d.was).join(', ')}`
      + `${recordLinksDropped.length > 3 ? ` and ${recordLinksDropped.length - 3} more` : ''}`);
  }

  // ── Predelivery lint — the APPLICABLE subset, FLAGS not FAILS (2026-07-31) ─────────────────────────
  // This lane wrote no lint receipt at all until now (docs/DELIVERY.md decision memo, updated in the
  // same change). It writes one here, on the publish path, so the workbook and the cover note have a QC
  // record to carry and a knockout defect reaches the lawyer holding the report. Three properties are
  // load-bearing and each is enforced by construction, not by care:
  //   1. It cannot block. runKnockoutLint decides nothing and this whole block is caught — a lint that
  //      throws costs a receipt, never the delivery. The hard gate on this lane is unchanged and lives
  //      where it always did (verify-knockout.mjs: the chunk validator + the merged permission-prose
  //      backstop, which still refuse the run BEFORE publish is ever called).
  //   2. Only REPORT-surface failures are projected. Every deliveryFlagLines sentence says "the report
  //      …", and the internal working prose (staff notes, the model's register estimate) is not in the
  //      reader's document — projecting a failure found there would tell the lawyer the report says
  //      something it does not.
  //   3. The receipt write is best-effort and idempotent. Re-publishing an ARCHIVED run recomputes the
  //      same result over the same frozen findings, so the write records this publish rather than
  //      rewriting history; where the run store is read-only it simply does not land.
  let qcFlags = [];
  try {
    const lint = runKnockoutLint({ findings });
    qcFlags = deliveryFlagLines(lint.failures.filter((c) => c.surface === 'report'));
    try {
      ensureDriverDir(runDir);
      writeFileSync(driverDir(runDir, 'predelivery-lint.json'), JSON.stringify({
        ts: new Date().toISOString(),
        lane: 'knockout',
        checks: lint.checks, failures: lint.failures.map((f) => f.id),
        // The third state, in the shape / settled: "did not happen" is never "not recorded".
        // A clearance check that cannot apply here is listed with its reason — never a passing row.
        notApplicable: lint.notApplicable,
        // What was judged, so an auditor can see the check counts are not a vacuous pass. Deliberately
        // NOT called `artifactSet`: that key has a clearance shape (surfaces / recordUris /
        // recordFetchFailures / skippedStages) that publish/index.mjs reads, and a same-named key of a
        // different shape is a collision waiting for a reader that spreads instead of type-checking.
        judged: { marks: (findings?.marks ?? []).length, findings: (findings?.marks ?? []).reduce((n, m) => n + (m?.findings?.length ?? 0), 0) },
        // — what the receipts door actually checked at THIS publish. A zero here is the honest
        // record of a vacuous pass, which is the reading the counts exist to make possible.
        receipts: receipts.checked,
      }, null, 2) + '\n');
    } catch (e) { note(`knockout lint receipt write failed (non-fatal): ${e.message}`); }
  } catch (e) { note(`knockout predelivery lint skipped (non-fatal): ${e.message}`); }

  const auditFile = `knockout-audit-${codename ?? runId}.xlsx`;
  await buildKnockoutWorkbook(findings, sweepReceipts, join(poolRunDir, auditFile), registerCounts, qcFlags, framework, registerRecords);
  grpRead(join(poolRunDir, auditFile), 0o640);

  // The run's report identity, off the SAME registry row that chose its machinery (search-policy.mjs
  // PRODUCT_POLICIES). Resolved from the frozen policy sidecar so an archived run re-renders under the
  // stage it was sold as, not under whatever today's registry calls that level.
  const identity = reportIdentityFor(searchPolicy ?? null);
  const probeRan = Boolean(searchPolicy?.components?.registerProbe);

  // ── ONE REPORT PER MARK ─────────────────────────────────────────────────────────────────────
  //
  // The knockout is the only product sold over more than one name, and it published ONE document for all
  // of them. A lawyer who sends eight candidates expects eight answers and reads them as eight; a batch
  // document breaks the funnel's unit of work, and it makes the per-name verdict something you extract
  // from a table rather than something you were handed.
  //
  // THE FAN-OUT IS AT PUBLISH, NOT IN THE ENGINE, and that is the issue's own ruling: the assess stage
  // chunks and merges because the per-name work genuinely is shared. What fans out is the OUTPUT. Every
  // mark already carries a complete answer — rating, qualifier, classes searched and driving, its
  // bullets and its typed findings — which is why one mark's slice of `findings` renders a whole report
  // with nothing missing. Verified against a real delivered knockout, not a fixture: five substantive
  // points and twelve typed evidence records on the one mark.
  //
  // THE FILENAME IS THE COUNT, and there is no fallback in it: one mark publishes `report.html`, several
  // publish `report-<slug>.html` each. That keeps every link already in a client's inbox resolving —
  // every knockout ever delivered is single-mark, and the Caddyfile's legacy-report rewrite plus
  // `readReport`'s fixed filename both speak that shape — while a batch gets no single document to be
  // the wrong link. `republishRun` re-renders through this same function, so an archived run re-renders
  // to the same path it was delivered at.
  //
  // The slug is `kebab(name)` and it is UNIQUE BY CONSTRUCTION: `kebabCollisions` refuses a batch whose
  // names collide under it at both admission doors (enqueue-schema.mjs, portal-service.mjs) and
  // again at the lane (pipeline-knockout.mjs). Two marks can never claim one file.
  //
  // A BATCH REPORT CARRIES NO BATCH SUMMARY. `batch.executiveSummary` is the assess chunk's prose and it
  // names every mark in the chunk, so putting it on each per-mark document is exactly the batch residue
  // this issue forbids ("each stands alone — own name, own coverage, own footer"). A single-mark run
  // keeps it, because there it IS that mark's summary and nothing else.
  const markRows = findings.marks ?? [];
  const single = markRows.length === 1;
  // THE ADDRESS IS A ROUTE, NEVER A FILENAME. The published documents sit side by side in the pool
  // directory, and it is very natural to link them the way they are stored — `<pool>/<runId>/<file>`.
  // The pool directory has not been the served site since the 2026-07-20 cutover. The edge claims two
  // shapes and 404s the rest: `/portal/…`, and the legacy rewrite, which is spelled `report.html` and
  // admits no other filename. So a file-shaped link is well-formed, obviously correct, and dead.
  //
  // That is, and it is the same defect email-audit-link.test.mjs records for the clearance lane —
  // "every audit link we have ever emailed died at the front door, silently". It came back here twice:
  // once as string surgery on the report URL, once as this function, and both spelled a pool path.
  //
  // A SINGLE MARK KEEPS THE LEGACY SHAPE. `<runId>/report.html` is what the rewrite exists for, it is
  // the address in every knockout email already sent, and it resolves. Changing a link that works to
  // match one that did not is how the next one of these gets written.
  const origin = poolUrl ? String(poolUrl).replace(/\/$/, '') : null;
  const reportUrlFor = (slug) => !origin ? null
    : single ? `${origin}/${runId}/report.html`
    : markReportRouteFor(origin, runId, slug);
  // — resolved once for the whole publish, off the same two sources the clearance
  // publisher uses (frozen sidecar, then roster; either marks, neither un-marks).
  const demoData = resolveDemoData({ runDir, customerKey });
  const reports = markRows.map((m) => {
    const slug = kebab(m.name);
    const file = single ? 'report.html' : `report-${slug}.html`;
    const dataFile = single ? 'report-data.json' : `report-data-${slug}.json`;
    // The mark's own slice. Its band is the document's band — `overall` on a one-mark document is that
    // mark's rating, never the batch's worst, or a clean name would inherit a blocking name's colour.
    const one = {
      ...findings,
      marks: [m],
      // ── THE PER-MARK DOCUMENT OPENS WITH ITS OWN ASSESSMENT ────────────────
      //
      // This blanked `executiveSummary` on every per-mark document, and the blank was right: the batch
      // paragraph names every mark in the batch, and a reader who ordered one name must not be handed a
      // summary about other clients' marks. What it left behind was a page opening with nothing.
      //
      // The assess stage writes a model-authored paragraph per mark now (owner ruling, full length), so
      // the blank has a replacement rather than being merely correct. Substituting it HERE, into the
      // per-mark COPY, is what makes one line serve both surfaces: the rendered `<div class="sub">` and
      // `report-data-<slug>.json`'s `.summary` both read `batch.executiveSummary`, so neither the
      // renderer nor the data builder needs to change.
      //
      // THE BATCH PARAGRAPH ITSELF IS UNTOUCHED — `findings.batch.executiveSummary` still holds the
      // cross-mark read and still owns the grouped page. This substitutes only in the single-mark copy
      // this loop is building. An archived run whose marks carry no `assessment` falls back to the blank
      // and re-renders exactly as it was delivered.
      batch: { ...(findings.batch ?? {}), ...(single ? {} : { executiveSummary: String(m.assessment ?? '').trim() }) },
    };
    const markBand = single ? overall : worstBand(framework, [m]);
    writeRO(file, renderKnockoutHtml(one, framework, {
      runId, overall: markBand, issued, auditFile, probeRan, registerCounts, registerRecords, identity, matter: runId,
      // — an invented mark says so on its own report. Resolved ONCE above the loop:
      // the answer is a property of the run, and asking per mark would let a multi-mark demo mark some
      // documents and not others if the roster moved mid-publish.
      demoData,
      // charter ruling 1 — the masthead names what this depth covers, from the run's own frozen policy.
      depthNote: productCoverageNote(searchPolicy ?? null),
      // — and the scope section is composed from the same frozen policy, so what the
      // document says it did not search is what the run was instructed not to search.
      searchPolicy: searchPolicy ?? null,
      delivery,
    }));
    // The run as data — what the assistant drafts client-facing mail from, and the shape the portal's
    // native-render path has been reading for since before anything wrote it. One per report, so the
    // native render of a per-mark document is that mark's data and not the batch's.
    writeRO(dataFile, JSON.stringify(knockoutReportData(one, framework, {
      runId, codename, overall: markBand, issued, registerCounts, registerRecords, auditFile, customerKey, matter: runId,
      identity: { ...identity, level: searchPolicy?.level ?? null },
      url: reportUrlFor(slug),
    }), null, 2));
    return { mark: m.name, slug, file, dataFile, url: reportUrlFor(slug), band: markBand ?? null };
  });
  const statement = knockoutStatement(framework, findings.marks ?? []);
  // report.md — front-matter compatible with archive greps (title/matter/overall_label)
  //
  // — AND IT NAMES THE DOCUMENTS (knockoutDocumentRoutes, below).
  const routes = knockoutDocumentRoutes(reports, { auditFile });
  writeRO('report.md', [
    '---',
    `title: "KNOCKOUT TRADEMARK REVIEW REPORT — ${runId}"`,
    `matter: "${runId}"`,
    `overall_label: "${overall ?? ''}"`,
    `overall_badge: "${bandBadge(framework, overall)}"`,
    '---',
    '',
    // — THE CROSS-MARK SURFACE, MARKED. Acceptance 3 asks for the banner on "the
    // grouped knockout page"; there is no such page — this file's own header states that a multi-mark
    // run "writes no `report.html` AT ALL" and that report.md "is the ONLY file that names every mark
    // together". It is served from the pool and reachable by URL, so it is the cross-mark document a
    // reader actually meets. The criterion's intent is met on the file that holds that role; its letter
    // cannot be, because its subject is not built. Recorded on the issue, not just here.
    ...(demoBannerMd(demoData) ? [demoBannerMd(demoData).trimEnd(), ''] : []),
    `# Summary`,
    '',
    String(findings.batch?.executiveSummary ?? ''),
    ...routes,
  ].join('\n'));
  // THE NAME THE RUN IS ABOUT. This object carried `title` and no `markName` key at all, so the
  // portal's displayName() fell through to `title` exactly as designed, and every delivered knockout row
  // read "Knockout review — N marks" in a column whose whole job is to name a mark. A batch of them is a
  // list of identical rows distinguishable only by run codename — two of them can be different marks for
  // different purposes, and nothing on the page says which is which.
  //
  // The data was always there — status.json carries markName and marks[0].name sits in this very object.
  // It was simply never lifted to the field the UI reads. This is NOT the documented back-fill case: that
  // comment says null means "delivered before the stamp existed" and must never render as "no mark", but
  // for the knockout lane null was not staleness, it was permanent.
  //
  // One rule, both shapes: one mark is the mark, several is the first plus a count. Never the run type.
  // The rule itself now lives in mark-name.mjs, because this was one of TWO spellings of it — the live
  // lane wrote "(+N marks)" onto status.json for the same batch, so a run changed its name at delivery
  // and the browser, which threads reads on the name string, listed one batch as two different marks.
  const markNames = (findings.marks ?? []).map((m) => m.name).filter(Boolean);
  writeRO('meta.json', JSON.stringify({
    runId, codename: codename ?? '', matter: runId,
    // The plural bug lived on this line: `${n} marks` with no guard, so every one-mark batch said
    // "1 marks". The sibling statement writer above has always guarded it; this never did.
    //
    // AND IT SPELT THE PRODUCT BY HAND. The literal was "Knockout review" — a product
    // retired — so every batch published under the live "Knockout search" stamped a name the offering
    // no longer sells into its own record, and the staff pool index rendered it in the Mark column
    // (publish/index.mjs anonMark(r.title)) on every knockout row, past and future. The identity is
    // resolved twenty lines up from the run's own frozen policy; this is that same string. A level the
    // registry cannot name says only how many marks, because a wrong product name is worse than none.
    title: [identity.identity, `${markNames.length} mark${markNames.length === 1 ? '' : 's'}`]
      .filter(Boolean).join(' — '),
    markName: batchMarkName(markNames) ?? undefined,
    engineCommit: engineCommit(),
    client: null, customerKey: customerKey || 'generic',
    issuedAt: (() => { try { const prev = JSON.parse(readFileSync(join(poolRunDir, 'meta.json'), 'utf8')); return prev?.issuedAt ?? new Date().toISOString(); } catch { return new Date().toISOString(); } })(),
    kind: 'knockout-batch',
    marks: (findings.marks ?? []).map((m) => ({ name: m.name, band: m.rating })),
    searchLevel: searchPolicy?.level ?? 'knockout',
    // The level's DISPLAY identity, stamped at publish exactly as the clearance lane stamps it. The
    // portal re-derived this from the level word because the knockout meta never carried it; a reader of
    // an archived meta had to know the registry by heart to tell Depth 1 from Depth 2.
    stageLabel: identity.stageLabel ?? undefined,
    // `reportIdentity` WAS written here and read NOWHERE — one occurrence in the whole repository, this
    // one. A stored display label with no reader is not harmless: it is a second answer to "what is this
    // product called", frozen at publish, that would have started disagreeing with the registry the first
    // time a product was renamed — and nothing would have noticed, because nothing looks at it. The name
    // is derived on every render from `searchLevel`, which is right below and IS read. Deleted.
    // Depth 2 provenance — WHICH register was counted and when, so a reader of an archived run can
    // tell a screen that counted from one that did not without opening the workbook.
    registerCounts: registerCounts
      ? { provider: registerCounts.provider, takenAt: registerCounts.takenAt, marks: registerCounts.marks?.length ?? 0, counted: countedMarks(registerCounts) }
      : undefined,
    recipe: searchPolicy?.recipe ?? undefined,
    enqueuedVia: searchPolicy?.enqueuedVia ?? undefined,
    parentRunId: searchPolicy?.parentRunId ?? undefined,
    tokens: tokens && (tokens.input || tokens.output) ? tokens : undefined,
    template: 'knockout',
    // `run` IS GONE. It carried the literal 'Knockout screen (Depth 1)' — a product name that is not the
    // product's name, at a rung of a ladder retired — into report-data.json, where nothing has ever
    // read it. The one `.run` reader in the tree parses report.html front matter and uses it as a DATE
    // fallback, so had this field ever been joined to that one it would have printed a product name where
    // a date belongs. The product is `meta.product`, written from the run's own frozen policy.
    overall: overall ?? '', badge: bandBadge(framework, overall), date: new Date().toISOString().slice(0, 10),
    auditFile, statement,
    framework: framework ? { key: framework.framework_key, title: framework.title, custom: framework.framework_key !== 'house-triage', bands: framework.bands.map((b) => ({ label: b.label, tone: b.tone })) } : undefined,
    // Present ⇒ this run has a report-data.json beside its report. The portal reads this to tell a run it
    // could render natively from a legacy one; the field had readers long before it had a writer.
    reportSchema: 'report-data/1',
    // WHICH DOCUMENTS THIS RUN PUBLISHED, and for which name. Every reader that has to open,
    // serve or link a knockout's reports takes the list from here rather than deriving a filename: the
    // naming rule (one mark ⇒ `report.html`, several ⇒ `report-<slug>.html`) is written ONCE, above, and
    // nobody re-implements it. Absent on every pre- meta, which is exactly the run that has one
    // report at `report.html` — so a reader that falls back to that name on absence is reading the
    // archive correctly, not guessing.
    // — `slug` RIDES. It was destructured away here while being computed twenty lines up, and
    // everything that links a batch's per-mark report needs it: reportsOf() reads it, the portal
    // builds `/portal/report/<runId>/<slug>/` from it, and resolveReportFile() matches on it. Without
    // it BOTH marks of a batch resolved to the run-level URL, which resolveReportFile answers null
    // for by design (a batch has no run-level document) — so every per-mark link 404'd, and the
    // clearances row printed a fallback saying the report was with us for a final read.
    reports: reports.map(({ mark, slug, file, dataFile, band }) => ({ mark, slug, file, dataFile, band })),
  }, null, 2));

  const total = skipRegen ? null : regenIndex(poolRoot);
  if (!skipRegen) { try { await regenSurfaces(poolRoot); } catch { /* best-effort */ } }
  // `url` IS NULL FOR A BATCH, and that is the honest answer rather than a convenient one. A multi-name
  // knockout has no single report, so any one URL here would be the first name standing for all of them —
  // the defect exists to end, re-entering through the delivery packet. Readers take `reports`; a
  // reader that only knows `url` gets null and fails visibly instead of linking one name in eight.
  const url = single ? reports[0]?.url ?? null : null;
  // qcFlags rides the result so the cover note enumerates the SAME projected lines the workbook does —
  // one projection, two surfaces (never a second one composed at the mail).
  // Composed HERE, from the pool URL this function already holds, so the mail never does string surgery
  // on a report URL to guess where the workbook is. One workbook per RUN — the batch's audit trail is one
  // document by design (it carries a Mark column), which is not the same question as the reports.
  //
  // `auditRouteFor`, not a pool path. Removing the string surgery fixed the DERIVATION and left the
  // DESTINATION exactly as dead — `<pool>/<runId>/<auditFile>` reaches no handler, on a batch and on a
  // single alike, which is every knockout ever delivered. `audit.xlsx` is the route literal; the portal
  // reads the run's real filename out of meta.json and sends it as the download name.
  const auditUrl = auditRouteFor(origin, runId);
  return { runId, auditFile, auditUrl, url, reports, poolRunDir, statement, total, qcFlags, receipts: receipts.checked };
}

/**
 * THE ROUTE FROM THE SUMMARY TO THE DOCUMENTS.
 *
 * On a multi-mark run `report.md` is the ONLY file that names every mark together, and it was a dead
 * end: nothing in it said the per-mark documents exist, let alone what they are called.
 *
 * That absence is what produced the reported defect, and the report was wrong about the cause. The claim
 * was that no register count reaches the client. Measured on the two runs it was about, `report.html`
 * carries "0 identical, 5 containing, 0 on close variations", and "Register search pending" — the
 * `registerEstimate` example wording — appears ZERO times in any delivered file, because registerEstimate
 * is workbook-only. What is true is that a multi-mark run writes no `report.html` AT ALL: the documents
 * are `report-<slug>.html`, one per mark. Look for the conventional name, find nothing, fall back to this
 * file, find prose with no counts. A filename convention read as a rendering defect.
 *
 * SO THIS RETURNS A ROUTE AND NEVER THE COUNTS. They are rendered once, in the documents named here. A
 * second render site for the same numbers is the drift this round has deleted four times over, and a
 * summary that restates a number it does not compute is the next thing to go stale.
 *
 * `report.md` is written into the served pool directory — reachable by URL though linked from nowhere —
 * so this doubles as the honest redirect for a reader who lands on it by mistake.
 *
 * Returns [] when there are no documents, so the caller appends nothing rather than an empty heading:
 * a "## Documents" section listing none would state an absence it cannot explain.
 * PURE.
 *
 * @param {Array<{mark:string, file:string, band:string|null}>} reports  one per published document
 * @param {{auditFile?:string|null}} [opts]
 * @returns {string[]} markdown lines to append, or []
 */
export function knockoutDocumentRoutes(reports, { auditFile = null } = {}) {
  const rows = (Array.isArray(reports) ? reports : []).filter((r) => r && r.file);
  if (!rows.length) return [];
  return [
    // — AN H1, BECAUSE IT IS A SIBLING SECTION AND NOT PART OF THE SUMMARY.
    // As `## Documents` this heading sat INSIDE the `# Summary` section: parseSections splits on /^# /m,
    // so `secs['Summary']` carried this list of pool filenames, and batchSummaryOf had to guess the
    // boundary by heading DEPTH instead of reading one. That guess is what broke the moment the summary
    // gained sub-headers of its own — it terminated the client's entry point at the first of them.
    // Promoted, the boundary is the section boundary, and both readers stop in the right place.
    '', '# Documents', '',
    ...rows.map((r) => `- **${r.mark ?? '(unnamed mark)'}**${r.band ? ` — ${r.band}` : ''}: \`${r.file}\``),
    '',
    rows.length === 1
      ? 'The register counts, the records and the coverage are in that document.'
      : 'One document per mark, each carrying its own register counts, records and coverage. There is no '
        + 'combined report: this summary is the only place the marks appear together.',
    ...(auditFile ? [`The receipts are in the audit workbook: \`${auditFile}\`.`] : []),
  ];
}
