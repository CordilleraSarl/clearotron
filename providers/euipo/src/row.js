// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// row.js — EUIPO's two row shapes and the status classifier behind them.
//
// TWO VOCABULARIES, DELIBERATELY, and they are not duplication:
//
//   toBandRow       the FLAT corsearch-shaped row every band consumer reads. Its key names ARE the
//                   contract — band-shape, named-band and supplemental's PREVIEW_FIELDS index into it
//                   by name. `classes`, `owner_name`, `application_date` — not `nice_classes`,
//                   `owner`, `filing_date`. Nothing throws on the mismatch: the row is a plain object,
//                   the wrong keys read as null, and the band renders EMPTY while every stage reports
//                   success.
//   toNeutralRecord the record-fetch vocabulary (applicationNumber, statusClass, niceClasses …) that
//                   registry-fidelity and the findings model read.
//
// EVERY FIELD MAPPING BELOW WAS READ OFF A REAL RESPONSE, not off the OpenAPI spec. Probed against the
// sandbox 2026-08-09 over a 2.35M-record corpus. The three that a spec-reading would have got wrong:
//
//   * there is NO owner-country field. `applicants[]` carries {office, identifier, name} and nothing
//     else, and `office` is the filing office ("EM"), NOT the applicant's country. Mapping it to
//     owner_country would print "EM" as every EU applicant's nationality.
//   * `oppositions[] / cancellations[] / appeals[] / decisions[]` are OMITTED WHEN EMPTY, and appear
//     ONLY on the detail record — a search row never carries them at any value. See below.
//   * `statusDate` exists on the detail record only; the search row has no status date at all.

import { isAllClass, makeClassifyStatus, screenVerdict } from "../../_shared/screen.mjs";

// ── The status vocabulary ─────────────────────────────────────────────────────────────────────────
//
// This decides which rights get dropped without ever being looked at, so the DEAD list is the part
// that has to be defended. No test can settle it — a wrong entry produces a smaller band, not an
// error — so each one is defended in writing and the list is kept as short as the register allows.
//
// DEAD is five terminal acts, and terminal is the whole criterion. Each one is an ending the register
// itself records as final:
//   WITHDRAWN             the applicant withdrew it
//   REFUSED               refused registration (see the open question below)
//   CANCELLED             cancelled on application by a third party
//   SURRENDERED           the proprietor gave it up
//   REMOVED_FROM_REGISTER struck off
//
// Everything merely PENDING or CONTESTED is LIVE, and that is deliberate rather than generous:
//   OPPOSITION_PENDING / CANCELLATION_PENDING — the mark is on the register and enforceable RIGHT NOW.
//     A cancellation action against it is somebody else's problem, not evidence the right is gone.
//   APPEALED / APPEALABLE — a decision has issued and its outcome is undetermined. Whichever way it
//     went, "under appeal" is not "finally dead".
//   RECEIVED / UNDER_EXAMINATION / APPLICATION_PUBLISHED / REGISTRATION_PENDING /
//   START_OF_OPPOSITION_PERIOD / ACCEPTANCE_PENDING / ACCEPTED — pending applications, every one of
//     which carries a filing date that is senior to anything the client files tomorrow.
//
// EXPIRED IS IN NEITHER LIST, AND THAT IS THE LOAD-BEARING CHOICE. EUTMR Art. 53(3) gives a six-month
// grace period after expiry in which renewal restores the right RETROACTIVELY, and EUIPO has no
// separate grace-period status — EXPIRED covers both the revivable and the truly gone. Classing it
// dead silently drops live senior rights; classing it live overstates. So it lands on "ambiguous",
// which `screenVerdict` routes to `deepfetch:ambiguous` — fetched and looked at, never batch-dropped.
// That is the same posture the shared vocabulary takes for corsearch's `graceperiod`, which its own
// comment calls out as a real senior-rights risk that must never be batch-dropped. Costs a record
// fetch per expired candidate; recall over thrift is the standing rule.
//
// THE ONE THAT COULD STILL BE WRONG, and how far it was chased. Does EUIPO set REFUSED while an
// appeal is still available, or APPEALABLE until the window closes? If the former, the DEAD list is
// dropping refused-but-appealable applications — live rights, silently.
//
// A REFUSED detail record carries no `appeals[]` array; it carries `decisions[]`, the refusal decision
// itself. APPEALED is a separate status holding its own population. That is consistent with REFUSED
// being terminal and appeals living in APPEALED / APPEALABLE, which is what the DEAD list assumes.
//
// THE RESIDUAL RISK, kept because it is a live caveat rather than history: what would settle the
// question is a record caught moving REFUSED → APPEALED, read at both ends. Until then REFUSED stays
// on the DEAD list and this paragraph is the risk that carries.
export const EUIPO_STATUS_LIVE = Object.freeze([
  "RECEIVED", "UNDER_EXAMINATION", "APPLICATION_PUBLISHED", "REGISTRATION_PENDING", "REGISTERED",
  "OPPOSITION_PENDING", "APPEALED", "CANCELLATION_PENDING", "APPEALABLE",
  "START_OF_OPPOSITION_PERIOD", "ACCEPTANCE_PENDING", "ACCEPTED",
]);
export const EUIPO_STATUS_DEAD = Object.freeze([
  "WITHDRAWN", "REFUSED", "CANCELLED", "SURRENDERED", "REMOVED_FROM_REGISTER",
]);
// Deliberately in neither list — see the grace-period note above. Named so a reader can see the
// omission is a decision and not an oversight, and so a test can pin it.
export const EUIPO_STATUS_AMBIGUOUS = Object.freeze(["EXPIRED"]);

// ── QUERYABLE ≠ CLASSIFIABLE, and conflating the two produces a 400 on a well-formed band ─────────
//
// `euipo-client.js` STATUSES lists 18 values from the spec. TWO OF THEM — APPEALABLE and
// ACCEPTANCE_PENDING — are REJECTED by the API: `status=="APPEALABLE"` returns HTTP 400 "invalid, or
// malformed parameters", at a valid `size`.
//
// So there are two vocabularies and they are not the same set:
//   QUERYABLE (16)  what may appear inside `status=in=(…)`. Building a live-status filter from the
//                   12-name LIVE list above 400s the whole query — the band then errors rather than
//                   returning a narrower answer, which is at least loud, but it is still a query we
//                   never had to get wrong.
//   CLASSIFIABLE (18) what may come BACK on a row. The spec lists all 18 and the classifier must
//                   handle all 18, because a status we cannot filter ON can still be filtered BY the
//                   office and returned to us. An unrecognised token falls to "ambiguous" anyway
//                   (fail-open), so the cost of being wrong here is a wasted fetch, not a lost mark.
export const EUIPO_STATUS_QUERYABLE = Object.freeze(
  [...EUIPO_STATUS_LIVE, ...EUIPO_STATUS_DEAD, ...EUIPO_STATUS_AMBIGUOUS]
    .filter((s) => s !== "APPEALABLE" && s !== "ACCEPTANCE_PENDING")
    .sort(),
);
/** The LIVE statuses that can actually ride a wire filter — the 12-name list minus the two the API
 *  rejects. `countStatusFilter: "live"` means this list, not the classifier's. */
export const EUIPO_STATUS_LIVE_QUERYABLE = Object.freeze(
  EUIPO_STATUS_LIVE.filter((s) => EUIPO_STATUS_QUERYABLE.includes(s)),
);

// The classifier over EUIPO's own vocabulary. NOT the shared default: `makeClassifyStatus`'s defaults
// are corsearch's brand-json tokens (valid/pending/invalid/expired), and EUIPO's SCREAMING_SNAKE
// statuses match none of them — so the default returns "ambiguous" for EVERY row, screenVerdict
// returns deepfetch:ambiguous for the whole band, and nothing is ever screened. A recall and cost
// failure that reads exactly like a working system.
export const classifyEuipoStatus = makeClassifyStatus({
  live: EUIPO_STATUS_LIVE,
  dead: EUIPO_STATUS_DEAD,
});

// ── Identity ──────────────────────────────────────────────────────────────────────────────────────
// `/mark/eu/<applicationNumber>` — the synthetic corsearch-shaped ref the driver's URI machinery
// (pipeline CITED_URI_RE, screen-gate URI_RE, registry-fidelity round-trip) already understands.
// Application numbers are 9 digits ("000504787") or W + 8 digits for an IR designation ("W00843717");
// both are plain alphanumerics, so no regex loosening is needed the way signa's `tm_…` ids required.
export const EUIPO_OFFICE = "eu";
export function makeRef(applicationNumber) {
  const n = String(applicationNumber ?? "").trim();
  return n ? `/mark/${EUIPO_OFFICE}/${n}` : null;
}
const REF_RE = /^\/mark\/([a-z]{2,4})\/(.+)$/i;
export function refToId(ref) {
  const m = REF_RE.exec(String(ref ?? "").trim());
  return m ? m[2] : String(ref ?? "").trim();
}

// EUIPO publishes a page per application number. `hasPublicRecordUrl: true` rests on this, so a
// finding can cite an address the reader can actually open.
export function publicRecordUrl(applicationNumber) {
  const n = String(applicationNumber ?? "").trim();
  return n ? `https://euipo.europa.eu/eSearch/#details/trademarks/${encodeURIComponent(n)}` : null;
}

const firstName = (xs) => (Array.isArray(xs) && xs.length ? (xs[0]?.name ?? null) : null);
const verbal = (t) => t?.wordMarkSpecification?.verbalElement ?? t?.markText ?? t?.mark_text ?? null;

/**
 * The flat band row. Key names are the contract; see the header.
 *
 * IDEMPOTENT ON PURPOSE: the enumerate kernel screens rows that doSearch has already converted, so
 * this runs over its own output. A band row carries `classes`; a raw EUIPO item carries `niceClasses`.
 * Reading only one silently empties the classes on the second pass — and empty classes make
 * screenVerdict skip its class check entirely, so an out-of-scope mark reads as in-scope-live.
 */
export function toBandRow(t) {
  if (!t || typeof t !== "object") return t;
  const appNo = t.applicationNumber ?? refToId(t.record_id) ?? null;
  const classes = Array.isArray(t.niceClasses) ? t.niceClasses
    : Array.isArray(t.classes) ? t.classes : [];
  return {
    record_id: t.record_id ?? makeRef(appNo),
    mark_text: verbal(t),
    classes,
    status: t.status ?? null,
    // The search row carries NO status date — only the detail record does. Null here is "the row does
    // not have it", which is the truth; inventing it from applicationDate would be a fabricated fact.
    status_date: t.statusDate ?? t.status_date ?? null,
    owner_name: t.owner_name ?? firstName(t.applicants),
    // There is no applicant country anywhere in this API. `applicants[].office` is the FILING OFFICE
    // ("EM"), not a nationality — mapping it here would stamp every EU applicant as EM-domiciled.
    owner_country: null,
    application_date: t.applicationDate ?? t.application_date ?? null,
    registration_date: t.registrationDate ?? t.registration_date ?? null,
    expiry_date: t.expiryDate ?? t.expiry_date ?? null,
    mark_feature: t.markFeature ?? t.mark_feature ?? null,
    // EUIPO has no separate registration number: the application number IS the registration number
    // once registered. Stated rather than left null, because a null here reads as "unregistered".
    // EUIPO has no separate registration number: the application number IS the registration number
    // once the mark registers. The test is `registrationDate`, NOT `status === "REGISTERED"`.
    //
    // The status test was wrong, and wrong in the worst direction. A CANCELLED, SURRENDERED, EXPIRED
    // or REMOVED_FROM_REGISTER mark WAS registered and still holds that number — probed against
    // PRODUCTION, all four carry `registrationDate` on 100% of rows, as does OPPOSITION_PENDING.
    // Gating on the status reported `null` for every one of them, which reads as "never registered"
    // for precisely the dead SENIOR rights a clearance exists to surface — on a citable record.
    // WITHDRAWN and APPLICATION_PUBLISHED carry no registration date (0% of rows): those genuinely
    // never registered, and `null` is the honest answer there.
    registration_number: (t.registrationDate ?? t.registration_date) ? appNo : (t.registration_number ?? null),
    resolved_link: t.resolved_link ?? publicRecordUrl(appNo),
  };
}

/**
 * The record-fetch vocabulary. Coexists with the band row; different consumers read each.
 *
 * `fromDetail` is the honest half of the oppositions story. The four proceedings arrays are OMITTED
 * WHEN EMPTY and appear ONLY on the detail record — so on a SEARCH ROW their absence carries no
 * information at all, while on a DETAIL RECORD it genuinely means none are recorded. `oppositions:
 * true` in the capability contract licenses a reader to treat an empty list as a real answer, and it
 * is only a real answer on the detail path. Collapsing the two would turn "we did not ask" into
 * "there are none" — on the one axis this provider is better at than both paid vendors.
 */
export function toNeutralRecord(t, { fromDetail = false } = {}) {
  if (!t || typeof t !== "object") return t;
  const appNo = t.applicationNumber ?? refToId(t.record_id) ?? null;
  const arr = (v) => (Array.isArray(v) ? v : fromDetail ? [] : null);
  return {
    uri: t.uri ?? t.record_id ?? makeRef(appNo),
    provider: "euipo",
    office: "EU",
    id: appNo,
    applicationNumber: appNo,
    // Same rule as the band row, and for the same reason — see toBandRow.
    registrationNumber: t.registrationDate ? appNo : null,
    applicationDate: t.applicationDate ?? null,
    registrationDate: t.registrationDate ?? null,
    expiryDate: t.expiryDate ?? null,
    statusClass: classifyEuipoStatus(t.status),
    statusText: t.status ?? null,
    statusDate: t.statusDate ?? null,
    markText: verbal(t),
    markFeature: t.markFeature ?? null,
    markKind: t.markKind ?? null,
    // INTERNATIONAL_TRADEMARK marks a Madrid designation of the EU. Carried because it is the fact a
    // reader needs to know the right is one territorial leg of an IR — and NOT merged with anything:
    // two designations of one IR are two rights in two territories.
    markBasis: t.markBasis ?? null,
    niceClasses: Array.isArray(t.niceClasses) ? t.niceClasses : [],
    owner: firstName(t.applicants),
    ownerCountry: null,          // absent from this API entirely — see toBandRow
    representative: firstName(t.representatives),
    goodsAndServices: Array.isArray(t.goodsAndServices)
      ? t.goodsAndServices.map((g) => ({ classNumber: g?.classNumber ?? null, description: g?.description ?? null }))
      : null,
    // null on a search row = NOT ASKED. [] on a detail record = asked, none recorded.
    oppositions: arr(t.oppositions),
    cancellations: arr(t.cancellations),
    appeals: arr(t.appeals),
    decisions: arr(t.decisions),
    _provenance: {
      proceedings: fromDetail
        ? "detail record — an empty list means none are recorded on the register"
        : "search row — this API serves proceedings ONLY on the detail record, so an empty list here would mean nothing. Fetch the record to ask.",
    },
    resolved_link: publicRecordUrl(appNo),
  };
}

/**
 * Screen one row: the band row plus the two computed annotations and the closed-set verdict.
 *
 * FLAT — it must not wrap itself in a `screen` key. `makeEnumerate` composes the record as
 * `{ ...liftScreenFields(record, row), screen: row }`, so a row that nests itself lands at
 * `record.screen.screen.screen_verdict`. Nothing errors; the verdict is simply absent, and a band
 * with no verdicts is a band that was never screened.
 */
export function rowScreen(row, inScopeClasses) {
  const band = toBandRow(row);
  const screened = {
    ...band,
    live_status: classifyEuipoStatus(band.status),
    all_class: isAllClass(band.classes),
  };
  return { ...screened, screen_verdict: screenVerdict(screened, inScopeClasses) };
}
