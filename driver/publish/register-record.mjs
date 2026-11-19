// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// publish/register-record.mjs — the register's own record of one cited registration, as the report shows it.
//
// A reviewing lawyer checks every cited mark against the register by hand before reading the analysis. The
// report now opens each cited registration with the register's facts (docs/design/register-record/, the
// approved board): the mark and its type, the goods by class, the owner and the owner's country, the country,
// the status with its dates, and the register number linked to the office's own record. This module builds
// those rows from the record the run saved; the renderers lay them out.
//
// EVERY FACT IS COPIED FROM THE SAVED RECORD. Nothing here is composed by a model, and nothing is translated
// here: a record's goods are its English where it holds English, the vendor's machine translation marked as
// one where it holds that, and the original as registered otherwise. The goods are read by record-goods.mjs,
// the one reader of a record's goods; the record's other fields by registry-fidelity.mjs's REC, as the
// renderer reads them today.
//
// PURE — no IO, no register call. A logo is not fetched here: `logo.wanted` says whether a registration's
// record carries one worth fetching, and the run's logo step does the fetching.
import { recordGoods, niceClass, untaggedIsEnglish, DEFAULT_ANSWER_CUT } from '../record-goods.mjs';
import { REC } from '../registry-fidelity.mjs';
import { officeRecordLink } from './office-record-links.mjs';
import { normRegion, regionName } from './regions.mjs';
import { REGISTER_RECORD as R } from './strings.mjs';

// The labels and notes, from the catalogue. A renderer takes them from here.
export const RECORD_LABELS = R.labels;
export const MT_NOTE = R.mtNote;
export const NO_GOODS = R.noGoods;
export const CLASS_NOT_STATED = R.classNotStated;
export const LOGO_NOT_RETRIEVED = R.logoNotRetrieved;
export const registrationsCount = R.registrationsCount;
export const showAllTerms = R.showAllTerms;
const machineTranslation = R.machineTranslation;
const asRegistered = R.asRegistered;
export const logoAlt = R.logoAlt;

// A code into the English name a reader knows, from the one naming source every report surface uses.
export function countryOf(office) {
  const code = normRegion(String(office ?? '').trim());
  return code ? regionName(code) : null;
}
// A logo is captioned with its register as a reader names it (EU, US, WIPO), not the office code the record
// carries (EM for the EUIPO).
const logoCaption = (office) => {
  const code = normRegion(String(office ?? '').trim());
  return code === 'WO' ? 'WIPO' : code || null;
};
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const nameOf = (names, code) => {
  try { const n = names.of(code); return n && n !== code ? n : null; } catch { return null; }
};
const languageOf = (code) => {
  const c = String(code ?? '').trim();
  return c ? nameOf(languageNames, c) : null;
};

// A register's own words for its status, in the case a sentence takes: "REGISTERED" reads "Registered".
const statusOf = (rec) => {
  const s = REC.statusStr(rec).trim();
  return s && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s || null;
};
const markTypeOf = (rec) => {
  const t = String(rec?.markFeature ?? rec?.markType ?? '').trim();
  return t && t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t || null;
};

/**
 * Whether a registration's logo is worth fetching: the record marks the mark as figurative and says an image
 * exists. A plain word mark is skipped even when its record has an image, because that image is only the word.
 */
export function logoWanted(rec) {
  if (rec?.imageAvailable !== true) return false;
  return /design|device|figurative|stylis|styliz|combined|logo|composite|special form/i.test(String(rec?.markFeature ?? rec?.markType ?? ''));
}

/** A statement's terms: the register separates them with semicolons. */
const termsOf = (text) => String(text).split(/\s*;\s*/).map((t) => t.trim()).filter(Boolean);

/** One class statement as the board draws it: whole, or a preview cut at a term boundary with the count. */
function statementOf(g) {
  const cls = g.classes.length ? g.classes.map((c) => `Class ${niceClass(c) ?? c}`).join(', ') : CLASS_NOT_STATED;
  const terms = termsOf(g.text);
  if ([...g.text].length <= DEFAULT_ANSWER_CUT || terms.length < 2) return { class: cls, text: g.text };
  let preview = '';
  for (const t of terms) {
    const next = preview ? `${preview}; ${t}` : t;
    if ([...next].length > DEFAULT_ANSWER_CUT) break;
    preview = next;
  }
  return { class: cls, text: g.text, preview: preview || terms[0], showAll: showAllTerms(terms.length) };
}

/** The goods row: English, or a marked machine translation, or the original as registered, or none stated. */
function goodsRow(rec, uri) {
  // An untagged statement on an English-language register is English, as the run's own goods reader takes it.
  const goods = recordGoods(rec, { english: untaggedIsEnglish(String(rec.uri ?? uri ?? '')) });
  if (!goods.length) return { label: RECORD_LABELS.goods, note: NO_GOODS, entries: [] };
  const translated = goods.filter((g) => g.alt);
  const original = goods.filter((g) => g.en === false);
  const row = { label: RECORD_LABELS.goods, entries: goods.map(statementOf) };
  if (translated.length) {
    const langs = [...new Set(translatedLanguages(rec))];
    row.marker = { tag: machineTranslation(langs.length === 1 ? languageOf(langs[0]) : null), note: MT_NOTE };
  } else if (original.length) {
    const langs = [...new Set(originalLanguages(rec))];
    row.note = asRegistered(langs.length === 1 ? languageOf(langs[0]) : null);
  }
  return row;
}
const originalLanguages = (rec) => (Array.isArray(rec?.goodsServices) ? rec.goodsServices : [])
  .filter((g) => !g?.translation && String(g?.language ?? '').trim() && !/^en/i.test(String(g.language)))
  .map((g) => String(g.language).trim());
const translatedLanguages = (rec) => (Array.isArray(rec?.goodsServices) ? rec.goodsServices : [])
  .filter((g) => g?.translation && String(g?.language ?? '').trim() && !/^en/i.test(String(g.language)))
  .map((g) => String(g.language).trim());

/**
 * The register record of one cited registration: its rows in the board's order, and whether its logo is wanted.
 * `receipt` is the report's own receipt line for the record ("verified — … record fetched <date>"), passed as
 * the report already writes it. Returns null when there is no record.
 */
export function registerRecordView(rec, { uri = '', receipt = null } = {}) {
  if (!rec || typeof rec !== 'object') return null;
  const mark = String(rec.markText ?? rec.mark ?? '').trim() || null;
  const country = countryOf(rec.office);
  const ownerCountry = countryOf(rec.ownerCountry);
  const link = officeRecordLink(rec, uri);
  const app = REC.serial(rec), reg = REC.regNumber(rec);
  const dates = [
    rec.applicationDate && `filed ${rec.applicationDate}`,
    rec.registrationDate && `registered ${rec.registrationDate}`,
    rec.expiryDate && `expires ${rec.expiryDate}`,
  ].filter(Boolean).join(' · ');
  const rows = [
    { label: RECORD_LABELS.mark, value: mark, ...(markTypeOf(rec) ? { faint: markTypeOf(rec) } : {}) },
    goodsRow(rec, uri),
    { label: RECORD_LABELS.owner, value: REC.owner(rec) || null, ...(ownerCountry ? { faint: `(${ownerCountry})` } : {}) },
    { label: RECORD_LABELS.country, value: country },
    { label: RECORD_LABELS.status, value: statusOf(rec), ...(dates ? { faint: dates } : {}) },
    {
      label: RECORD_LABELS.number, value: link?.label ?? null, href: link?.href ?? null,
      ...(app && reg && app !== reg ? { faint: `application ${app}` } : {}),
      ...(receipt ? { receipt } : {}),
    },
  ];
  return {
    rows,
    logo: { wanted: logoWanted(rec), caption: logoCaption(rec.office), alt: mark && country ? logoAlt(mark, country) : null, href: link?.href ?? null },
  };
}
