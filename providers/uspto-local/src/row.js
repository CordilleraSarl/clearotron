// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// row.js — the two row shapes this provider hands out, and the screening classifier behind them.
//
// TWO VOCABULARIES, DELIBERATELY, and they are not duplication:
//
//   toBandRow      the FLAT corsearch-shaped row every band consumer reads. Its key names are the
//                  contract — band-shape, named-band and supplemental's PREVIEW_FIELDS all index
//                  into it by name.
//   toNeutralRecord the record-fetch vocabulary (applicationNumber, statusClass, niceClasses …),
//                  which registry-fidelity and the findings model read.
//
// COPYING SIGNA'S ROW SHAPE IS THE TRAP. Signa emits `nice_classes`, `owner` and `filing_date`; the
// band contract wants `classes`, `owner_name` and `application_date`. Nothing throws on the
// mismatch — the row is a plain object, the missing keys read as null, and the band renders empty
// while every stage reports success. `providers/_shared/enumerate.mjs` SCREEN_TO_RECORD_FIELDS is
// the statement of which name wins: the flat band row.
//
// STATUS CLASSIFICATION IS INJECTED, NOT DEFAULTED. `makeClassifyStatus`'s defaults are corsearch's
// brand-json tokens — valid / pending / graceperiod / invalid / expired. A USPTO status code is a
// three-digit number and matches none of them, so the default classifier returns "ambiguous" for
// EVERY row, `screenVerdict` returns deepfetch:ambiguous for the whole band, and nothing is ever
// screened. That is a recall and cost failure that reads exactly like a working system, which is
// why the classifier below is built over statusClassOf and passed in explicitly.

import { isAllClass, screenVerdict } from "../../_shared/screen.mjs";
import { statusClassOf, makeRef } from "./index-store.js";

/**
 * The screening classifier over USPTO's own vocabulary.
 *
 * Returns the three tokens `normalizeBrandRow`/`screenVerdict` expect — live | dead | ambiguous —
 * mapped from Table 1 status codes. Note "unknown" becomes "ambiguous" rather than "dead": an
 * unclassifiable mark is fetched and looked at, never dropped.
 */
export function classifyUsptoStatus(raw) {
  const cls = statusClassOf(raw);
  return cls === "unknown" ? "ambiguous" : cls;
}

/**
 * The flat band row. Key names are the contract; see the header.
 *
 * `row` is an index-store record (the shape `toRecord` returns).
 */
export function toBandRow(row) {
  if (!row || typeof row !== "object") return row;
  // IDEMPOTENT ON PURPOSE. The kernel screens rows that doSearch has already converted, so this runs
  // over its own output — a band row carries `classes`, an index record carries `niceClasses`.
  // Reading only one of the two silently empties the classes on the second pass, and empty classes
  // make screenVerdict skip its class check: an out-of-scope mark then reads as in-scope-live.
  const classes = Array.isArray(row.niceClasses) ? row.niceClasses
    : Array.isArray(row.classes) ? row.classes : [];
  return {
    record_id: row.record_id ?? makeRef(row.id ?? row.applicationNumber),
    mark_text: row.mark_text ?? row.markText ?? null,
    classes,
    status: row.status ?? null,
    status_date: row.statusDate ?? null,
    owner_name: row.owner_name ?? row.owner ?? null,
    owner_country: row.owner_country ?? null,
    application_date: row.applicationDate ?? null,
    registration_date: row.registrationDate ?? null,
    expiry_date: row.expiryDate ?? null,
    mark_feature: row.markFeature ?? null,
    registration_number: row.registrationNumber ?? null,
    resolved_link: row.resolved_link ?? null,
  };
}

/** The record-fetch vocabulary. Coexists with the band row; they are read by different consumers. */
export function toNeutralRecord(row) {
  if (!row || typeof row !== "object") return row;
  return {
    uri: row.uri ?? row.record_id ?? null,
    provider: "uspto-local",
    office: "US",
    id: row.id ?? row.applicationNumber ?? null,
    applicationNumber: row.applicationNumber ?? null,
    registrationNumber: row.registrationNumber ?? null,
    applicationDate: row.applicationDate ?? null,
    registrationDate: row.registrationDate ?? null,
    expiryDate: row.expiryDate ?? null,
    statusClass: row.statusClass ?? statusClassOf(row.status),
    statusText: row.status ?? null,
    markText: row.mark_text ?? row.markText ?? null,
    markFeature: row.markFeature ?? null,
    niceClasses: Array.isArray(row.niceClasses) ? row.niceClasses : [],
    owner: row.owner_name ?? row.owner ?? null,
    ownerCountry: row.owner_country ?? null,
    goodsAndServices: row.goodsAndServices ?? null,
    resolved_link: row.resolved_link ?? null,
    // Oppositions live in a separate USPTO bulk product this index does not hold. Declared null, and
    // capabilities.oppositions is false, so nobody reads the absence as "no oppositions exist".
    oppositions: null,
  };
}

/**
 * Screen one row: the band row plus the two computed annotations and the closed-set verdict.
 *
 * This is `normalizeBrandRow`'s job done over our vocabulary. It is written out rather than calling
 * that helper because the helper's plumbing-strip is brand-json-specific and there is no plumbing to
 * strip here — but the two annotations it stamps (`live_status`, `all_class`) are contract, and
 * `screenVerdict` keys on both.
 */
export function rowScreen(row, inScopeClasses) {
  const band = toBandRow(row);
  const screened = {
    ...band,
    live_status: classifyUsptoStatus(row?.status),
    all_class: isAllClass(band.classes),
  };
  // FLAT, and it does not wrap itself in a `screen` key. makeEnumerate composes the record as
  // `{ ...liftScreenFields(record, row), screen: row }` — it does the nesting, so a row that nests
  // itself lands at record.screen.screen.screen_verdict and every consumer's lookup misses by one
  // level. Nothing errors; the verdict is simply absent, and a band with no verdicts is a band that
  // was never screened.
  return { ...screened, screen_verdict: screenVerdict(screened, inScopeClasses) };
}
