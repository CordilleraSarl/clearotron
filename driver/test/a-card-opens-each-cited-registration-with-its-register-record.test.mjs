// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CARD OPENS EACH CITED REGISTRATION WITH ITS REGISTER RECORD (owner, 2026-11-18; design, 2026-11-19).
//
// A reviewing lawyer checked every cited mark against the register by hand before reading the analysis. A card now
// carries, in a closed "Register record" drop-down placed before "Full detail", one entry per registration whose
// record the run fetched, its rows copied from that record. The registration line it replaces leaves "Full detail",
// so each fact is printed once. What has no record stays where it was: an index-only citation keeps its number and
// label under "Full detail", and so does the warning that a fetch failed. The old line's three extra facts keep their
// words and move to their row: an international registration's reach and the registration system to Country, and
// the Paris-priority flag beside the dates on Status. A card lists at most eight entries, then sends the reader to
// the audit workbook for all of them. Every name, number and date here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";

const REPORT = (() => {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-rr-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: rr-test", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: European Union", "run: 2026-11-19", "---", ""].join("\n"));
    return parseReport(join(dir, "r.report.md"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();
const RECEIPT_AT = "2026-10-14T09:00:00Z";
const record = (uri, office, over = {}) => ({
  uri, provider: "clarivate", office,
  applicationNumber: "018046213", registrationNumber: "018046213",
  applicationDate: "2019-03-14", registrationDate: "2019-08-02", expiryDate: "2029-03-14",
  statusClass: "live", statusText: "REGISTERED",
  markText: "SKARVEL", markFeature: "WORD AND DESIGN", imageAvailable: true,
  owner: "Brisavel Acoustics, S.L.", ownerCountry: "ES",
  goodsServices: [{ classes: ["9"], language: "en", description: "Headphones; loudspeakers." }],
  _receipt: { fetched_at: RECEIPT_AT },
  ...over,
});
const finding = (registrations, over = {}) => ({
  ordinal: 3, mark: "SKARVEL", composite: 4, disposition: "adversarial", net: "Brisavel would probably win against OSTREVIN.",
  owner: { name: "Brisavel Acoustics, S.L.", registrations },
  ...over,
});
const render = (findings, records, opts = {}) => renderHtml(REPORT, findings, [],
  { runId: "rr-test", recordsByUri: new Map(records.map((r) => [r.uri.toLowerCase(), r])), providerLabel: "Clarivate Compumark", ...opts });
const block = (html) => html.match(/<details class="drill rr-drill">([\s\S]*?)<\/details><details class="drill"><summary>Full detail/)?.[1] ?? "";
const fullDetail = (html) => html.match(/<summary>Full detail<\/summary><div class="drillbody">([\s\S]*?)<\/div><\/details>/)?.[1] ?? "";
const entries = (html) => block(html).split('<div class="rr">').slice(1);

const EU = "/mark/em/018046213", WO = "/mark/wo/1456789", INDEX_ONLY = "/mark/us/97123456";

test("the fetched registrations open the card in a closed drop-down before Full detail, and leave Full detail", () => {
  const html = render([finding([{ uri: EU, jurisdiction: "EM", classes: [9] }, { uri: WO, jurisdiction: "WO", classes: [9] }, { uri: INDEX_ONLY, jurisdiction: "US" }])],
    [record(EU, "em"), record(WO, "wo", { applicationNumber: "1456789", registrationNumber: "1456789" })]);
  assert.match(html, /<details class="drill rr-drill"><summary>Register record <span class="rr-count">2 registrations<\/span><\/summary>/,
    "the drop-down is missing, open, or does not count its registrations");
  assert.ok(html.indexOf("rr-drill") < html.indexOf("<summary>Full detail</summary>"), "the record does not come before Full detail");
  const [eu] = entries(html);
  for (const row of ["Mark", "Goods and services", "Owner", "Country", "Status", "Register number"]) assert.ok(eu.includes(`<span class="k">${row}</span>`), `the ${row} row is missing`);
  assert.ok(eu.includes("<b>SKARVEL</b> <span class=\"rr-faint\">Word and design</span>"), "the mark and its type");
  assert.ok(eu.includes("Registered · <span class=\"rr-faint\">filed 2019-03-14 · registered 2019-08-02 · expires 2029-03-14</span>"), "the status and its dates");
  assert.ok(eu.includes('<i class="receipt">verified — Clarivate Compumark record fetched 2026-10-14</i>'), "the receipt keeps its delivered wording");
  const fd = fullDetail(html);
  assert.ok(fd.includes("(register-index entry)"), "an index-only citation left Full detail");
  assert.ok(fd.includes("97123456"), "the index-only citation lost its number");
  assert.doesNotMatch(fd, /record fetched|· Cl\.9 · REGISTERED/, "a fetched registration's line is still in Full detail");
});

test("an international registration says where its rights reach on the Country row, even when the record omits it", () => {
  const html = render([finding([{ uri: WO, jurisdiction: "WO" }])], [record(WO, "wo", { applicationNumber: "1456789", registrationNumber: "1456789" })]);
  const [wo] = entries(html);
  assert.match(wo, /<span class="k">Country<\/span><span class="v">[^<]*<i class="jsys">|<span class="k">Country<\/span><span class="v">[^<]* · <i>designated countries not on the fetched record — rights reach only its designations<\/i>/,
    "the Country row does not carry the international registration's reach");
  assert.ok(wo.includes("designated countries not on the fetched record — rights reach only its designations"), "the missing designations are not said");
  const named = render([finding([{ uri: WO, jurisdiction: "WO" }])], [record(WO, "wo", { applicationNumber: "1456789", registrationNumber: "1456789", jurisdictions: ["CH", "NO"] })]);
  assert.match(entries(named)[0], /<span class="k">Country<\/span><span class="v">[^]*? · designating: [^<]+<\/span><\/div>/, "named designations are not on the Country row");
});

test("a recent filing carries the Paris-priority flag beside its dates, with its emphasis", () => {
  const html = render([finding([{ uri: EU, jurisdiction: "EM" }])],
    [record(EU, "em", { applicationDate: "2026-09-01", registrationDate: null, expiryDate: null, statusText: "FILED" })], { asOf: "2026-11-19" });
  assert.match(entries(html)[0], /<span class="k">Status<\/span><span class="v">[^]*?filed 2026-09-01<\/span> · <b>recent filing — Paris-priority window \(potential global backdating\)<\/b><\/span>/,
    "the flag is not beside the filing date on the Status row");
});

test("a failed fetch keeps its warning in Full detail, and a card with no fetched record has no drop-down", () => {
  const html = render([finding([{ uri: INDEX_ONLY, jurisdiction: "US" }], { _recordFetchFailure: { cause: "404" } })], [record(EU, "em")]);
  assert.doesNotMatch(html, /rr-drill/, "a card whose registrations were not fetched shows a record");
  assert.ok(fullDetail(html).includes("Official register record could not be retrieved"), "the fetch-failure warning is gone");
});

test("a card lists at most eight registrations, in order, then sends the reader to the workbook for all of them", () => {
  const uris = Array.from({ length: 10 }, (_, i) => `/mark/em/0180462${String(i).padStart(2, "0")}`);
  const recs = uris.map((u, i) => record(u, "em", { applicationNumber: u.split("/").at(-1), registrationNumber: u.split("/").at(-1), markText: `SKARVEL ${i + 1}` }));
  const html = render([finding(uris.map((uri) => ({ uri, jurisdiction: "EM" })))], recs, { auditFile: "audit.xlsx" });
  const shown = entries(html);
  assert.equal(shown.length, 8, "the list is not capped at eight");
  shown.forEach((e, i) => assert.ok(e.includes(`<b>SKARVEL ${i + 1}</b>`), `entry ${i + 1} is out of order or paired with the wrong record`));
  assert.ok(block(html).includes('<div class="cmore"><a class="wb" href="audit.xlsx">All 10 in the audit workbook</a></div>'), "the overflow line is missing");
  assert.ok(block(html).includes("10 registrations"), "the count is not of all the registrations");
});

test("a run with no record set renders the card as it always has", () => {
  const html = renderHtml(REPORT, [finding([{ uri: EU, jurisdiction: "EM", classes: [9], status: "Registered" }])], [], { runId: "rr-none" });
  assert.doesNotMatch(html, /rr-drill/, "an archived run grew a record block");
  assert.ok(fullDetail(html).includes("018046213"), "the back-compat registration line is gone");
});

test("where the office keys its page on the application number, the row shows the registration number and then the application", () => {
  const JP = "/mark/jp/6231111", US = "/mark/us/90000001";
  const links = new Map([[JP, { office: "jp", label: "JP 2019-046708", href: null, reason: "unaddressable" }],
    [US, { office: "us", label: "US 90000001", href: "https://register.example/us?caseNumber=90000001", reason: null }]]);
  const html = render([finding([{ uri: JP, jurisdiction: "JP" }, { uri: US, jurisdiction: "US" }])],
    [record(JP, "jp", { applicationNumber: "2019046708", registrationNumber: "6231111" }),
      record(US, "us", { applicationNumber: "90000001", registrationNumber: "7100200" })], { recordLinks: links });
  const [jp, us] = entries(html);
  assert.match(jp, /<span class="k">Register number<\/span><span class="v">JP 6231111 <span class="rr-faint">application 2019046708<\/span>/,
    "the registration number does not show, or the application number does not follow it");
  assert.match(us, /<span class="v"><a href="https:\/\/register\.example\/us\?caseNumber=90000001" target="_blank" rel="noopener noreferrer">US 7100200<\/a> <span class="rr-faint">application 90000001<\/span>/,
    "the link no longer opens the office's page, or its text is not the registration number");
});

// A REGISTER'S VALUES ARE TEXT, AND A HOSTILE ONE PRINTS AS TEXT. The register number's row once compared and rewrote the
// cell's markup with a pattern that removed tags, the incomplete kind of sanitising a scanner rightly flags. The row now
// swaps the number on plain text and the page's own cell builder escapes it, so markup planted in any record field is
// printed as characters, never parsed.
const HOSTILE = "<scr<script>ipt>alert(1)</script>";
test("markup planted in a record's label, number, mark or owner prints as text on the card", () => {
  const US = "/mark/us/90000001";
  // The office's label carries the markup, and the swap to the registration number runs over it: the record reader
  // keeps only a registration number's digits, so the planted number arrives as its digits, 71002001.
  const links = new Map([[US, { office: "us", label: `US 90000001 ${HOSTILE}`, href: "https://register.example/us?caseNumber=90000001", reason: null }]]);
  const html = render([finding([{ uri: US, jurisdiction: "US" }])],
    [record(US, "us", { applicationNumber: "90000001", registrationNumber: `7100200${HOSTILE}`, markText: HOSTILE, owner: HOSTILE })], { recordLinks: links });
  const [entry] = entries(html);
  assert.doesNotMatch(entry, /<scr|<script|<\/script/i, "a planted tag reached the page as markup");
  assert.ok(entry.includes(">US 71002001 &lt;scr&lt;script&gt;ipt&gt;alert(1)&lt;/script&gt;</a>"), "the swapped label does not print as text in its link");
  assert.ok(entry.includes("<b>&lt;scr&lt;script&gt;ipt&gt;alert(1)&lt;/script&gt;</b>"), "the planted mark does not print as text");
});

test("a record the run's office links do not name prints its own office number, and never a rewritten handle", () => {
  const US = "/mark/us/90000001";
  const html = render([finding([{ uri: US, jurisdiction: "US" }])], [record(US, "us", { applicationNumber: "90000001", registrationNumber: "7100200" })]);
  const [entry] = entries(html);
  assert.match(entry, /<span class="k">Register number<\/span><span class="v">US 7100200 <span class="rr-faint">application 90000001<\/span>/,
    "the record's own office number, as the registration number with its application after it, is not the row");
  assert.doesNotMatch(entry, /\/mark\/us\/7100200/, "a handle was rewritten into a number");
});
