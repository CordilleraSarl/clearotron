// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A register finding links to the trade mark office's own page for its record, where the office publishes
// one, and says why not where it does not.
//
// The register vendor these arms model publishes no page per record, so its findings reached the reader
// with the engine's handle and nothing to open. The office pages are addressed in code, from the fetched
// record's own numbers. What the arms hold:
//   - every office in the table, from a record in the vendor's own number form, to the exact address, and
//     the table covers exactly the offices the vendor lists;
//   - a number in any other form gets no link, and neither does a record with no number: the handle's id
//     is never an address, even where it looks like a valid number;
//   - a Madrid designation goes to WIPO by its IR number, whatever office it sits under;
//   - the card's label is the office and the number, linked where there is an address; the reason is
//     stated once per office in Scope, never beside every line;
//   - the workbook's Link carries the address or the reason, and its link rule is not widened by it;
//   - every other register renders exactly as before.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";

process.env.CLEAROTRON_MCP_URL ||= "https://mcp.test/mcp";
const { OFFICE_RECORD_PAGES, officeRecordLink, recordLinksFor, officeReasonSentences, linkCellFor } = await import("../publish/office-record-links.mjs");
const { SIGNA_OFFICE_SNAPSHOT } = await import("../../providers/signa/src/offices.generated.js");
const { parseReport } = await import("../publish/parse.mjs");
const { renderHtml } = await import("../publish/render.mjs");
const { buildAudit } = await import("../publish/xlsx.mjs");

// A record as the vendor's normaliser hands it over, numbers in the vendor's own published form.
const SIGNA = (office, applicationNumber, registrationNumber, extra = {}) =>
  ({ provider: "signa", office, applicationNumber, registrationNumber, filingRoute: "direct_national", irNumber: null, ...extra });

const EXPECTED = [
  ["au", SIGNA("au", "2145673", "2145673"), "AU 2145673", "https://search.ipaustralia.gov.au/trademarks/search/view/2145673"],
  ["ca", SIGNA("ca", "1834521", "TMA1024576"), "CA 1834521", "https://ised-isde.canada.ca/cipo/trademark-search/1834521-00?lang=eng"],
  ["ch", SIGNA("ch", "12345/2020", "7634210"), "CH 12345/2020", "https://www.swissreg.ch/database-client/register/detail?type=trademark&lang=en&no=12345%2F2020"],
  ["eu", SIGNA("eu", "018165108", "018165108", { filingRoute: "direct_regional" }), "EU 018165108", "https://euipo.europa.eu/eSearch/#details/trademarks/018165108"],
  ["fr", SIGNA("fr", "FR4123456", "FR4123456"), "FR4123456", "https://data.inpi.fr/marques/FR4123456"],
  ["gb", SIGNA("gb", "UK00003456789", "UK00003456789"), "UK00003456789", "https://trademarks.ipo.gov.uk/ipo-tmcase/page/Results/1/UK00003456789"],
  ["no", SIGNA("no", "202012345", "312456"), "NO 202012345", "https://services.patentstyret.no/search-details/trademark/202012345-312456?lang=en"],
  ["se", SIGNA("se", "2020-12345", "578291"), "SE 2020-12345", "https://search.prv.se/#/trademark/2020-12345"],
  ["us", SIGNA("us", "88123456", "5847291"), "US 88123456", "https://tsdr.uspto.gov/#caseNumber=88123456&caseType=SERIAL_NO&searchType=statusSearch"],
  ["wo", SIGNA("wo", "1543782", "1543782", { filingRoute: "madrid_ir" }), "WO 1543782", "https://www3.wipo.int/madrid/monitor/en/showData.jsp?ID=ROM.1543782"],
];

test("the table speaks for exactly the offices the vendor lists as live", () => {
  const live = SIGNA_OFFICE_SNAPSHOT.offices.filter((o) => o.status === "live").map((o) => o.jurisdiction.toLowerCase()).sort();
  assert.ok(live.length >= 10, `a floor on the vendor's office list: ${live.length}`);
  assert.deepEqual(Object.keys(OFFICE_RECORD_PAGES).sort(), live);
});

test("every office with a record page is addressed from the vendor's number form, to the exact address", () => {
  assert.equal(EXPECTED.length, Object.values(OFFICE_RECORD_PAGES).filter((p) => p.address).length, "one arm per office with a page");
  for (const [office, rec, label, href] of EXPECTED) assert.deepEqual(officeRecordLink(rec), { office, label, href, reason: null }, office);
});

test("Singapore publishes no page for a single record: no link, and the reason says so", () => {
  assert.deepEqual(officeRecordLink(SIGNA("sg", "40202012345Y", "40202012345Y")),
    { office: "sg", label: "SG 40202012345Y", href: null, reason: "no-page" });
});

test("the only reshaping is the padding and prefix the office's own format defines", () => {
  assert.equal(officeRecordLink(SIGNA("ch", "8133/2025", null)).href, "https://www.swissreg.ch/database-client/register/detail?type=trademark&lang=en&no=08133%2F2025");
  assert.equal(officeRecordLink(SIGNA("eu", "18165108", null)).href, "https://euipo.europa.eu/eSearch/#details/trademarks/018165108");
  assert.equal(officeRecordLink(SIGNA("fr", "4123456", null)).href, "https://data.inpi.fr/marques/FR4123456");
  assert.equal(officeRecordLink(SIGNA("ca", "1834521-01", null)).href, "https://ised-isde.canada.ca/cipo/trademark-search/1834521-01?lang=eng");
  assert.equal(officeRecordLink(SIGNA("no", "202012345", null)).href, "https://services.patentstyret.no/search-details/trademark/202012345?lang=en");
});

test("a number in any other form gets no link, at every office with a page", () => {
  const off = [
    SIGNA("au", "A2145673", null), SIGNA("ca", "TMA1024576", null), SIGNA("ch", "12345-2020", null),
    SIGNA("eu", "EU018165108", null), SIGNA("fr", "20/4123456", null), SIGNA("gb", "3456789", "3456789"),
    SIGNA("no", "12345", null), SIGNA("se", "2020/12345", null), SIGNA("us", "5847291", null),
    SIGNA("wo", "R123", "R123", { filingRoute: "madrid_ir" }),
  ];
  assert.deepEqual(off.map((r) => r.office), EXPECTED.map(([o]) => o), "one malformed number per office with a page");
  for (const rec of off) assert.deepEqual([rec.office, officeRecordLink(rec).href, officeRecordLink(rec).reason], [rec.office, null, "unaddressable"]);
});

test("every office's pattern is anchored at both ends: its good number with a letter before or after gets no link", () => {
  // A malformed number per office reaches only the anchors its own shape happens to test. This drives both
  // anchors at every office, from the office's own good number: a letter before it and a letter after it.
  // A letter rather than a digit after it, because an Australian, Canadian or WIPO number varies in length,
  // so a trailing digit can still spell a real number there, where a letter spells none.
  const bend = (rec, f) => ({ ...rec, ...Object.fromEntries(["applicationNumber", "registrationNumber", "irNumber"]
    .filter((k) => rec[k] != null).map((k) => [k, f(String(rec[k]))])) });
  for (const [office, rec] of EXPECTED) {
    for (const [how, f] of [["before", (n) => `x${n}`], ["after", (n) => `${n}x`]]) {
      const l = officeRecordLink(bend(rec, f));
      assert.deepEqual([office, how, l.href, l.reason], [office, how, null, "unaddressable"]);
    }
  }
});

test("the handle is never an address: a record with no number gets no link, whatever its id looks like", () => {
  // The id inside `/mark/<office>/<id>` is the vendor's. Plant a valid-looking office number there and none
  // in the record: every office must refuse, because the handle's id is not the office's number.
  for (const [office, rec] of EXPECTED) {
    const id = rec.applicationNumber;
    const bare = { provider: "signa", office, id, applicationNumber: null, registrationNumber: null, irNumber: null };
    assert.deepEqual(officeRecordLink(bare, `/mark/${office}/${id}`), { office, label: null, href: null, reason: "unaddressable" }, office);
  }
});

test("a Madrid designation goes to WIPO by its IR number, whatever office it sits under", () => {
  const des = SIGNA("ch", "12345/2020", "1543782", { filingRoute: "madrid_designation", irNumber: "1543782" });
  assert.deepEqual(officeRecordLink(des), { office: "wo", label: "WO 1543782", href: "https://www3.wipo.int/madrid/monitor/en/showData.jsp?ID=ROM.1543782", reason: null });
  // Without the IR number there is nothing to address it by, and the national number would open the wrong record.
  assert.deepEqual(officeRecordLink({ ...des, irNumber: null }), { office: "wo", label: null, href: null, reason: "unaddressable" });
});

// ── The run: which registers get links, and the count publish records ───────────────────────────────────
const meters = {
  mark_similarity: { token: "high", basis: "verified-from-record" },
  goods_proximity: { token: "medium", basis: "verified-from-record" },
  use: { token: "low", basis: "inferred-from-signal" },
  enforcer: { token: "low", basis: "inferred-from-signal" },
};
const finding = (ordinal, owner, country, uris, extra = {}) => ({
  ordinal, mark: `NORTHWIND ${ordinal}`, band: "Manageable", disposition: "distinguished", meters,
  composite: 3, level: "B", dispute_type: "paper-conflict", quadrant: { x: 0.6, y: 0.5 },
  owner: { name: owner, country, registrations: uris.map((uri) => ({ uri, classes: ["9"], status: "Registered", filed: "2020-01-01", jurisdiction: country })) },
  source: { source_type: "register-vendor", resolved_link: "" }, ...extra,
});
const RECORDS = new Map([
  ["/mark/au/s1", { _uri: "/mark/au/s1", ...SIGNA("au", "2145673", "2145673"), jurisdiction: "AU", statusText: "Registered", classList: ["9"] }],
  ["/mark/sg/s2", { _uri: "/mark/sg/s2", ...SIGNA("sg", "40202012345Y", null), jurisdiction: "SG", statusText: "Registered", classList: ["9"] }],
  ["/mark/sg/s3", { _uri: "/mark/sg/s3", ...SIGNA("sg", "40202012346Z", null), jurisdiction: "SG", statusText: "Registered", classList: ["9"] }],
  ["/mark/fr/s4", { _uri: "/mark/fr/s4", ...SIGNA("fr", "20/4123456", null), jurisdiction: "FR", statusText: "Registered", classList: ["9"] }],
]);
const FINDINGS = [
  finding(1, "Northwind Holdings", "AU", ["/mark/au/s1", "/mark/sg/s2"]),
  finding(2, "Northwind Asia", "SG", ["/mark/sg/s3", "/mark/fr/s4", "/mark/ch/s5"]),
];

test("links are built only for a register with no record pages of its own; every other register is left alone", () => {
  for (const other of ["euipo", "uspto-local", "free-tier", "corsearch", "clarivate", "", undefined]) assert.equal(recordLinksFor(FINDINGS, RECORDS, other), null, String(other));
  assert.ok(recordLinksFor(FINDINGS, RECORDS, "signa"));
});

test("the run's tally counts linked, cited-by-number and not-retrieved registrations per office", () => {
  const out = recordLinksFor(FINDINGS, RECORDS, "signa");
  assert.deepEqual(out.tally, { linked: { au: 1 }, cited: { sg: { "no-page": 2 }, fr: { unaddressable: 1 } }, notRetrieved: 1 });
  assert.equal(out.summary, "linked 1 (au 1) · cited by number 3 (sg 2 no-page, fr 1 unaddressable) · record not retrieved 1");
  assert.equal(out.byUri.get("/mark/ch/s5"), null, "an unfetched registration has no link and no label of its own");
});

test("the reason is stated once per office, with no count the cards could contradict", () => {
  const { byUri } = recordLinksFor(FINDINGS, RECORDS, "signa");
  assert.deepEqual(officeReasonSentences(byUri), [
    "France: registrations whose numbers are not in the form the register's page address takes are cited by number, not linked.",
    "Singapore: the register publishes no page for a single record, so its registrations are cited by number.",
  ]);
});

// ── The card ────────────────────────────────────────────────────────────────────────────────────────────
function parsedOf(reportMd) {
  const dir = mkdtempSync(join(tmpdir(), "office-links-"));
  const path = join(dir, "f.report.md");
  writeFileSync(path, reportMd);
  try { return parseReport(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const REPORT = [
  "---", "type: prelim-clearance", "matter: noref-office-links", "title: NORTHWIND",
  "overall_label: MEDIUM", "overall_badge: l3", "overall_caption: medium overall.",
  "classes: 9", "jurisdiction: Australia and Singapore", "run: 2026-09-10", "---", "",
  "# Marks", "## Northwind Holdings", "- one: The senior holder in class 9.", "### The read", "Close on the goods.",
  "## Northwind Asia", "- one: A regional holder.", "### The read", "Distinguished as wholes.",
].join("\n");
const COVERAGE = [{ area: "register / Australia", state: "confirmed-clean", note: "enumerated" }];
const cardOpts = (extra = {}) => ({ runId: "noref-office-links", recordsByUri: RECORDS, recordOrigins: [], recordCitation: "workbook", ...extra });

test("the card links the office and number, cites the rest by number, and states each office's reason once", () => {
  const { byUri } = recordLinksFor(FINDINGS, RECORDS, "signa");
  const html = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, cardOpts({ recordLinks: byUri }));
  assert.match(html, /<a href="https:\/\/search\.ipaustralia\.gov\.au\/trademarks\/search\/view\/2145673" target="_blank" rel="noopener noreferrer">AU 2145673<\/a>/);
  assert.match(html, /<b>SG 40202012345Y<span class="reg-nolink">/, "an unlinked registration shows its office and number, with the workbook note");
  assert.doesNotMatch(html, /<a [^>]*>SG 4020201234/, "no link where the office publishes no page");
  assert.doesNotMatch(html, /<b>\/mark\/(au|sg|fr)\//, "a fetched registration is never labelled with the handle");
  assert.match(html, /<b>\/mark\/ch\/s5<span class="reg-nolink">[^<]*<\/span><\/b> <i>\(register-index entry\)<\/i>/, "an unfetched registration keeps its handle, its note and its label");
  assert.match(html, /A registration number shown as a link opens the office’s own page for that record\./);
  assert.equal(html.split("Singapore: the register publishes no page for a single record").length - 1, 1, "Singapore's reason, once");
  assert.equal(html.split("France: registrations whose numbers are not in the form").length - 1, 1, "France's reason, once");
});

test("a null office-link map renders exactly as an absent one", () => {
  const before = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, cardOpts());
  const after = renderHtml(parsedOf(REPORT), FINDINGS, COVERAGE, cardOpts({ recordLinks: null }));
  assert.equal(after, before);
  assert.doesNotMatch(before, /ipaustralia|opens the office’s own page/);
});

// ── The workbook ────────────────────────────────────────────────────────────────────────────────────────
async function findingsSheet(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet("Findings");
  let header = null;
  ws.eachRow((row, n) => { if (!header && row.values.includes("Registration(s)")) header = n; });
  const cols = Object.fromEntries(ws.getRow(header).values.map((v, i) => [v, i]).filter(([v]) => v));
  const rows = [];
  // The sheet drops a column no row fills, so a run with no link anywhere has no Link column at all.
  ws.eachRow((row, n) => { if (n > header) rows.push({ reg: row.getCell(cols["Registration(s)"]).value, link: cols.Link ? row.getCell(cols.Link).value : undefined }); });
  return { rows, hasLink: Boolean(cols.Link) };
}
const auditMd = { findings: [], audit: [], negatives: [{ source_layer: "Register", search_term: "northwind (exact)", result: "2 hits", notes: "" }] };
const FM = { title: "NORTHWIND", matter: "noref-office-links", classes: "9", overall_label: "Manageable" };

test("the workbook's Link carries the office's page or the reason, and its link rule is not widened", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-links-xlsx-"));
  try {
    const { byUri } = recordLinksFor(FINDINGS, RECORDS, "signa");
    const book = join(dir, "book.xlsx");
    const counts = await buildAudit({ findings: FINDINGS, coverage: COVERAGE, registerPublishesRecordPages: false, recordLinks: byUri }, auditMd, book, "NORTHWIND", FM);
    const { rows } = await findingsSheet(book);
    assert.deepEqual(rows[0].link, { text: "View", hyperlink: "https://search.ipaustralia.gov.au/trademarks/search/view/2145673" });
    assert.equal(rows[0].reg, "AU 2145673; SG 40202012345Y");
    assert.equal(rows[1].link, "No page for a single record at this register (Singapore); cited by number");
    assert.equal(rows[1].reg, "SG 40202012346Z; FR 20/4123456; CH s5");
    assert.deepEqual(counts.gateViolations.filter((v) => /link does not resolve|nothing identifies/i.test(v)), []);
    // The reason is not a pass on its own: on a register that does publish record pages, the same row is
    // still reported, because the rule asks that register for a link and a sentence is not one.
    const strict = await buildAudit({ findings: FINDINGS, coverage: COVERAGE, registerPublishesRecordPages: true, recordLinks: byUri }, auditMd, join(dir, "strict.xlsx"), "NORTHWIND", FM);
    assert.deepEqual(strict.gateViolations.filter((v) => /link does not resolve/i.test(v)), ['Findings "NORTHWIND 2": link does not resolve to http(s)']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with no office-link map the workbook has no Link column and labels registrations from the handle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "office-links-xlsx-"));
  try {
    const book = join(dir, "book.xlsx");
    await buildAudit({ findings: FINDINGS, coverage: COVERAGE, registerPublishesRecordPages: false }, auditMd, book, "NORTHWIND", FM);
    const { rows, hasLink } = await findingsSheet(book);
    assert.equal(hasLink, false, "no Link column when no finding carries a link, as before");
    assert.deepEqual(rows.map((r) => r.reg), ["AU s1; SG s2", "SG s3; FR s4; CH s5"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the workbook's Link cell prefers any linked registration, then the first stated reason", () => {
  const { byUri } = recordLinksFor(FINDINGS, RECORDS, "signa");
  const regs = (...uris) => uris.map((uri) => ({ uri }));
  assert.equal(linkCellFor(regs("/mark/sg/s2", "/mark/au/s1"), byUri), "https://search.ipaustralia.gov.au/trademarks/search/view/2145673");
  assert.equal(linkCellFor(regs("/mark/ch/s5", "/mark/fr/s4"), byUri), "Number not in the form this register's page address takes (France); cited by number");
  assert.equal(linkCellFor(regs("/mark/ch/s5"), byUri), "");
  assert.equal(linkCellFor(regs("/mark/au/s1"), null), "");
});
