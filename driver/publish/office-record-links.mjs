// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// office-record-links.mjs — the page a trade mark office publishes for one record, addressed from the
// numbers on the record the run fetched.
//
// WHY THIS EXISTS. A register vendor with no per-record page of its own left every register finding with
// nothing a reader could open. The card showed the engine's handle, `/mark/<office>/<id>`, and the id in
// it is the vendor's, not the office's. Most offices do publish a page per record, keyed on their own
// application or registration number, and the fetched record carries that number. So the link is built
// here, in code, from a table of what each office's address takes: never by the model, and never from
// the handle.
//
// WHAT THIS DOES NOT TOUCH. The model's own record URLs are still refused for such a vendor: its
// allow-list (record-origins.mjs) stays empty, and normalizeRecordLinks still strips a host it does not
// publish. This is a second source of links with one input, the fetched record, and it only ever emits
// an address from the table below.
//
// A NUMBER THAT DOES NOT FIT GETS NO LINK. Each entry states the form its address takes, and a number in
// any other form is cited, not linked: a guessed address on a legal deliverable is worse than an admitted
// absence. The only reshaping is what the office's own format defines: Swiss application serials are
// five digits, EU application numbers nine, French numbers carry FR.
//
// Each address was checked on 2026-09-10 against a real record, and each row says how.

const pad = (s, n) => String(s).padStart(n, "0");
const clean = (v) => (v == null ? "" : String(v).trim());

/** The first of `values` matching `re`, handed to `build`; null when none does. */
function addressFrom(values, re, build) {
  for (const v of values) {
    const m = re.exec(clean(v));
    if (m) return build(m);
  }
  return null;
}

// An international registration, at WIPO's Madrid Monitor. Opened a real record. WIPO has said it will
// retire Madrid Monitor once eMadrid covers everything it does, and has given no date.
const madridMonitor = (values) => addressFrom(values, /^0*([1-9]\d{4,6})$/, (m) => ({
  number: m[1], href: `https://www3.wipo.int/madrid/monitor/en/showData.jsp?ID=ROM.${m[1]}` }));

/**
 * One entry per office code the handle carries (`/mark/<office>/...`, lower case). `address(rec)` returns
 * `{ number, href }` when the record's number is in the form the office's page takes, and null when it is
 * not. An office with `address: null` publishes no page for a single record.
 */
export const OFFICE_RECORD_PAGES = Object.freeze({
  // Opened a real record. Australia reuses the trade mark number as the registration number.
  au: { name: "Australia", address: (r) => addressFrom([r.applicationNumber, r.registrationNumber], /^(\d{1,8})$/, (m) => ({
    number: m[1], href: `https://search.ipaustralia.gov.au/trademarks/search/view/${m[1]}` })) },
  // Opened a real record. `-00` is the extension CIPO gives the base application.
  ca: { name: "Canada", address: (r) => addressFrom([r.applicationNumber], /^([1-9]\d{0,6})(?:-(\d{2}))?$/, (m) => ({
    number: m[2] ? `${m[1]}-${m[2]}` : m[1], href: `https://ised-isde.canada.ca/cipo/trademark-search/${m[1]}-${m[2] ?? "00"}?lang=eng` })) },
  // Rendered in a browser: a real number draws the record, and one that does not exist draws the bare
  // search page. National marks only; a Madrid designation of Switzerland goes to WIPO, below.
  ch: { name: "Switzerland", address: (r) => addressFrom([r.applicationNumber], /^(\d{1,5})\/(\d{4})$/, (m) => {
    const n = `${pad(m[1], 5)}/${m[2]}`;
    return { number: n, href: `https://www.swissreg.ch/database-client/register/detail?type=trademark&lang=en&no=${encodeURIComponent(n)}` };
  }) },
  // The address the EUIPO provider already links (providers/euipo/src/row.js).
  eu: { name: "European Union", address: (r) => addressFrom([r.applicationNumber], /^(\d{1,9})$/, (m) => {
    const n = pad(m[1], 9);
    return { number: n, href: `https://euipo.europa.eu/eSearch/#details/trademarks/${n}` };
  }) },
  // INPI's own record pages at this address are indexed; INPI blocks automated fetches, so none was
  // opened from a server. The vendor keeps INPI's FR prefix on the number.
  fr: { name: "France", address: (r) => addressFrom([r.applicationNumber, r.registrationNumber], /^(?:FR)?(\d{7})$/i, (m) => ({
    number: `FR${m[1]}`, href: `https://data.inpi.fr/marques/FR${m[1]}` })) },
  // The office's record address as indexed; it challenges automated fetches, so none was opened from a
  // server. UK numbers are UK plus eleven digits (UK000..., UK008..., UK009...).
  gb: { name: "United Kingdom", address: (r) => addressFrom([r.applicationNumber, r.registrationNumber], /^(UK\d{11})$/i, (m) => ({
    number: m[1].toUpperCase(), href: `https://trademarks.ipo.gov.uk/ipo-tmcase/page/Results/1/${m[1].toUpperCase()}` })) },
  // The register's own search opens records at exactly this address: the application number, then the
  // registration number when there is one. Opened a real record. The older search.patentstyret.no
  // addresses now answer 410 Gone.
  no: { name: "Norway", address: (r) => addressFrom([r.applicationNumber], /^((?:19|20)\d{7})$/, (m) => {
    const reg = /^\d{1,7}$/.test(clean(r.registrationNumber)) ? clean(r.registrationNumber) : null;
    return { number: m[1], href: `https://services.patentstyret.no/search-details/trademark/${m[1]}${reg ? `-${reg}` : ""}?lang=en` };
  }) },
  // PRV's new search, in beta since 2026-01-26. Rendered in a browser: a real number draws the record,
  // and one that does not exist draws the bare search page.
  se: { name: "Sweden", address: (r) => addressFrom([r.applicationNumber], /^(\d{4}-\d{5})$/, (m) => ({
    number: m[1], href: `https://search.prv.se/#/trademark/${m[1]}` })) },
  // IPOS Digital Hub shows a record only inside a search session: there is no address for one record.
  sg: { name: "Singapore", address: null },
  // The address the USPTO provider already links. The number is the serial.
  us: { name: "United States", address: (r) => addressFrom([r.applicationNumber], /^(\d{8})$/, (m) => ({
    number: m[1], href: `https://tsdr.uspto.gov/#caseNumber=${m[1]}&caseType=SERIAL_NO&searchType=statusSearch` })) },
  wo: { name: "WIPO (Madrid)", address: (r) => madridMonitor([r.irNumber, r.registrationNumber, r.applicationNumber]) },
});

const handleOffice = (uri) => (/^\/mark\/([a-z]{2,4})\//i.exec(clean(uri))?.[1] ?? "").toLowerCase();

// A number that already carries its office's letters (FR4123456, UK00003456789) stands alone; a bare
// one is shown with its office (CH 08133/2025), so the label always says whose number it is.
const labelOf = (office, number) => (number ? (/^[a-z]{2}/i.test(number) ? number : `${office.toUpperCase()} ${number}`) : null);

/**
 * The office's page for one fetched record. `{ office, label, href, reason: null }` when the office
 * publishes a page and the number is in the form its address takes. Otherwise `href` is null and
 * `reason` says why: `no-page` (the office publishes none), `unaddressable` (the number is not in the
 * form the address takes, or is missing), `unknown-office` (this table holds no address for the office).
 *
 * A MADRID DESIGNATION IS ADDRESSED AT WIPO, whatever office it sits under. On a designation the
 * vendor's registration number is the IR number, so a national address built from it opens the wrong
 * record or none.
 */
export function officeRecordLink(rec, uri = "") {
  if (!rec || typeof rec !== "object") return null;
  const designation = clean(rec.filingRoute) === "madrid_designation";
  const office = designation ? "wo" : (clean(rec.office).toLowerCase() || handleOffice(uri));
  const page = OFFICE_RECORD_PAGES[office];
  const own = designation ? clean(rec.irNumber) : clean(rec.applicationNumber) || clean(rec.registrationNumber);
  const unlinked = (reason) => ({ office, label: labelOf(office, own), href: null, reason });
  if (!page) return unlinked("unknown-office");
  if (!page.address) return unlinked("no-page");
  const a = designation ? madridMonitor([rec.irNumber]) : page.address(rec);
  return a ? { office, label: labelOf(office, a.number), href: a.href, reason: null } : unlinked("unaddressable");
}

/** The registers whose records carry no page of the vendor's own, so the office's page is the link. */
export const VENDORS_WITHOUT_RECORD_PAGES = Object.freeze(["signa"]);

/**
 * Every registration the findings cite, keyed by its lower-cased uri, for a run whose register is
 * `provider`. Returns null for any other register, so those runs render exactly as before: their records
 * carry links of their own. `tally` is what publish records, per office, so that a register whose numbers
 * never fit shows up as a count instead of as a report that quietly looks the way it always did.
 */
export function recordLinksFor(findings, recordsByUri, provider) {
  if (!VENDORS_WITHOUT_RECORD_PAGES.includes(clean(provider).toLowerCase())) return null;
  const byUri = new Map();
  const tally = { linked: {}, cited: {}, notRetrieved: 0 };
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  for (const f of Array.isArray(findings) ? findings : []) {
    for (const r of f?.owner?.registrations ?? []) {
      const key = clean(r?.uri).toLowerCase();
      if (!key || byUri.has(key)) continue;
      const rec = recordsByUri instanceof Map ? recordsByUri.get(key) : null;
      if (!rec) { byUri.set(key, null); tally.notRetrieved += 1; continue; }
      const link = officeRecordLink(rec, key);
      byUri.set(key, link);
      if (link.href) bump(tally.linked, link.office);
      else bump((tally.cited[link.office] ??= {}), link.reason);
    }
  }
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const linked = Object.entries(tally.linked).map(([o, n]) => `${o} ${n}`).join(", ");
  const cited = Object.entries(tally.cited).flatMap(([o, rs]) => Object.entries(rs).map(([r, n]) => `${o} ${n} ${r}`)).join(", ");
  const summary = `linked ${sum(Object.values(tally.linked))}${linked ? ` (${linked})` : ""}`
    + ` · cited by number ${sum(Object.values(tally.cited).flatMap((rs) => Object.values(rs)))}${cited ? ` (${cited})` : ""}`
    + ` · record not retrieved ${tally.notRetrieved}`;
  return { byUri, tally, summary };
}

const nameOf = (office) => OFFICE_RECORD_PAGES[office]?.name ?? office.toUpperCase();

/** The report's once-per-office account of the registrations it cites by number rather than links. */
export function officeReasonSentences(byUri) {
  const per = new Map();
  for (const l of byUri instanceof Map ? byUri.values() : []) {
    if (!l || l.href) continue;
    const k = `${l.office} ${l.reason}`;
    per.set(k, (per.get(k) ?? 0) + 1);
  }
  return [...per].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => {
    const [office, reason] = k.split(" ");
    const name = nameOf(office);
    if (reason === "no-page") return `${name}: the register publishes no page for a single record, so its registrations are cited by number.`;
    if (reason === "unknown-office") return `${name}: we hold no page address for this register, so its registrations are cited by number.`;
    return n === 1
      ? `${name}: one registration is cited by number, not linked, because its number is not in the form the register's page address takes.`
      : `${name}: ${n} registrations are cited by number, not linked, because their numbers are not in the form the register's page address takes.`;
  });
}

/** The workbook's Link cell for a finding: its first linked registration, else the first stated reason. */
export function linkCellFor(registrations, byUri) {
  if (!(byUri instanceof Map)) return "";
  const links = (registrations ?? []).map((r) => byUri.get(clean(r?.uri).toLowerCase())).filter(Boolean);
  const linked = links.find((l) => l.href);
  if (linked) return linked.href;
  const first = links[0];
  if (!first) return "";
  const name = nameOf(first.office);
  if (first.reason === "no-page") return `No page for a single record at this register (${name}); cited by number`;
  if (first.reason === "unknown-office") return `No page address held for this register (${name}); cited by number`;
  return `Number not in the form this register's page address takes (${name}); cited by number`;
}
