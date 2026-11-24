// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/register-record-html.mjs — one cited registration's register record, and its logo, as both report pages
// draw them.
//
// The clearance draws a record on each finding card and the Knockout under each listed filing (owner, 2026-11-18).
// The rows come from registerRecordView, which copies every fact from the saved record; this module lays them out
// once, so the two pages cannot drift apart. What differs between the pages is an input: the register number's cell,
// which each page already prints its own way, the receipt line, and the owner's name as that page resolves it.
import { registerRecordView, RECORD_LABELS as L, countryOf, LOGO_NOT_RETRIEVED } from './register-record.mjs';
import { REC, inPriorityWindow } from '../registry-fidelity.mjs';
import { registrationSystem } from '../jurisdiction-systems.mjs';
import { normRegion } from './regions.mjs';
import { REGISTER_RECORD as RR } from './strings.mjs';
import { escapeText as esc, escapeAttr as escAttr } from '../../shared/html-escape.mjs';

/**
 * One register record entry: Mark, Goods and services, Owner, Country, Status and Register number, each row drawn
 * only when the record states it. `number` is the page's own register number for the registration: `label`, the
 * office's number as plain text, or null where the page cites the record by its handle; `fallbackText`, the text the
 * page shows then; and `cell(label)`, the page's cell for a label, which escapes it;
 * `receipt` the page's receipt line or null; `ownerName` the owner as the page resolves it; `jurisdiction` the
 * registration's jurisdiction where the record names none; `asOf` the publish date the Paris-priority flag is read
 * against, or null for no flag. PURE.
 */
export function recordEntryHtml(rec, { uri = '', jurisdiction = '', receipt = null, asOf = null, number, ownerName = null }) {
  const view = registerRecordView(rec, { uri, receipt });
  const by = Object.fromEntries(view.rows.map((row) => [row.label, row]));
  const faint = (t) => (t ? ` <span class="rr-faint">${esc(t)}</span>` : '');
  const row = (label, v) => (v ? `<div class="rr-row"><span class="k">${esc(label)}</span><span class="v">${v}</span></div>` : '');
  // The goods: the translation marker or the original's note first, then each class statement, a long one cut at
  // a term boundary with the rest one tap away.
  const g = by[L.goods];
  const statement = (st) => `<div class="rr-g"><span class="rr-cls">${esc(st.class)}</span> ${st.preview
    ? `<span class="rr-txt">${esc(st.preview)}; …</span><details class="rr-all"><summary>${esc(st.showAll)}</summary><span class="rr-txt">${esc(st.text)}</span></details>`
    : `<span class="rr-txt">${esc(st.text)}</span>`}</div>`;
  const goods = g.entries.length
    ? `${g.marker ? `<details class="rr-mt"><summary>${esc(g.marker.tag)}</summary><span class="rr-mtnote">${esc(g.marker.note)}</span></details>` : ''}${g.note ? `<div class="rr-orig">${esc(g.note)}</div>` : ''}${g.entries.map(statement).join('')}`
    : `<div class="rr-g rr-faint">${esc(g.note)}</div>`;
  // The Country row carries the registration system and, for an international registration, where its rights
  // reach, in the words the registration line carried before the record replaced it (design, 2026-11-19).
  const jur = jurisdiction || rec.jurisdiction || '';
  const sys = registrationSystem(jur);
  const isWO = normRegion(jur) === 'WO' || /\/mark\/wo\//i.test(uri);
  const desig = isWO ? REC.designations(rec) : null;
  const reach = !isWO ? ''
    : (desig ? RR.designating(esc(desig.join(', ')))
             : ` · <i>${RR.designationsNotOnRecord}</i>`);
  // A record that names no office still names its jurisdiction, and the country is read from that.
  const place = by[L.country].value || countryOf(rec.jurisdiction);
  const country = place || isWO || sys
    ? `${esc(place || '')}${sys ? ` <i class="jsys">(${sys})</i>` : ''}${reach}` : '';
  // The Status row: the register's status, its dates, and the Paris-priority flag beside them, with its emphasis.
  const st = by[L.status];
  const prio = asOf && inPriorityWindow(rec, asOf)
    ? ` · <b>${RR.priorityWindow}</b>` : '';
  const status = st.value || st.faint || prio
    ? `${esc(st.value || '')}${st.value && st.faint ? ' · ' : ''}${st.faint ? `<span class="rr-faint">${esc(st.faint)}</span>` : ''}${prio}` : '';
  // The register number is the page's own cell for this registration; the application number follows only where
  // the cell does not already show it. Compared by letters and digits alone: an office can write the number the
  // record holds as 2019046708 with dashes, "2019-046708".
  //
  // THE ROW SHOWS THE REGISTRATION NUMBER, as the board draws it ("US 6123457 application 90770114"). Some offices
  // key their record page on the application number (the USPTO's serial, the JPO's application), so the page's cell
  // reads the application number; there the cell's visible number becomes the registration number, its link still
  // opening the office's page, and "application N" follows. The words are the approved ones; only which number
  // shows changes.
  //
  // THE SWAP IS MADE ON PLAIN TEXT, NEVER ON MARKUP. The office's number arrives as the label the page would print,
  // the registration number takes the application number's place in that text, and the page's own cell builder
  // escapes the result, as it escapes every label it prints. A record handle (`/mark/us/…`) is an identifier, not a
  // number, and is never rewritten.
  const num = by[L.number];
  const bare = (t) => String(t ?? '').replace(/[^0-9A-Za-z]/g, '');
  const appNo = REC.serial(rec), regNo = REC.regNumber(rec);
  let label = number?.label ?? null;
  if (label && appNo && regNo && bare(appNo) !== bare(regNo) && bare(label).includes(bare(appNo)) && !bare(label).includes(bare(regNo))) {
    const loose = new RegExp([...bare(appNo)].join('[^0-9A-Za-z]?'));
    label = label.replace(loose, () => String(regNo));
  }
  const cell = typeof number?.cell === 'function' ? number.cell(label) : '';
  const shown = label ?? number?.fallbackText ?? '';
  const app = num.faint && !bare(shown).includes(bare(num.faint.replace(/^application /, ''))) ? faint(num.faint) : '';
  const mark = by[L.mark].value ? `<b>${esc(by[L.mark].value)}</b>${faint(by[L.mark].faint)}` : '';
  const owner = ownerName || by[L.owner].value;
  const ownerHtml = owner ? `${esc(owner)}${faint(by[L.owner].faint)}` : '';
  return `<div class="rr">${row(L.mark, mark)}${row(L.goods, goods)}${row(L.owner, ownerHtml)}${row(L.country, country)}${row(L.status, status)}${row(L.number, `${cell}${app}${receipt ? `<div><i class="receipt">${esc(receipt)}</i></div>` : ''}`)}</div>`;
}

/**
 * One logo in its fixed box: the saved image, or "Logo not retrieved" where the fetch failed, opening the office's
 * record at `href` when there is one. `logo` is { state, src } from the run's logo step; `caption` draws the
 * register under the box. Null when the registration has no logo to show. PURE.
 */
export function logoFigureHtml(rec, { uri = '', logo = null, href = null, caption = true }) {
  if (!logo || (logo.state !== 'fetched' && logo.state !== 'failed')) return null;
  const { logo: v } = registerRecordView(rec, { uri });
  const link = (inner, cls = '') => (href ? `<a${cls} href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner);
  const body = logo.state === 'fetched'
    ? link(`<img src="${logo.src}" alt="${escAttr(v.alt || '')}">`)
    : (href ? link(esc(LOGO_NOT_RETRIEVED), ' class="rr-nologo"') : `<span class="rr-nologo">${esc(LOGO_NOT_RETRIEVED)}</span>`);
  return `<figure class="rr-lg">${body}${caption && v.caption ? `<figcaption>${esc(v.caption)}</figcaption>` : ''}</figure>`;
}
