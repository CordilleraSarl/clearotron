// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT CARD CITES A FILING AS ITS OFFICE DOES.
//
// A conflict card's evidence printed the register vendor's record path (/mark/em/…), which opens nothing and no register
// accepts, while the filings table on the same page named the same filing by office and number, linked where the
// office has a page. The card now prints that table cell for a filing the run holds, and reads a filing it does not
// hold only where the run's register puts the office's own number in the path. Every filing here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { addressListedFilings, officeRecordLink } from "../publish/office-record-links.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "evidence-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const WEB = "https://example.invalid/shop/tarnello";
const FILINGS = [
  { recordId: "/mark/em/7f3a9c2e-0b1d", office: "EM", applicationNumber: "018765432", mark: "TARNELLO", owner: "Tarnello Srl", status: "registered", classes: [9] },
  { recordId: "/mark/us/4c8e1a77-92f0", office: "US", applicationNumber: "97123456", mark: "TARNELLO LABS", owner: "Tarnello Srl", status: "registered", classes: [9] },
  { recordId: "/mark/wo/b2d4e6f8-1a3c", office: "WO", irNumber: "1234567", mark: "TARNELLO", owner: "Tarnello Srl", status: "registered", classes: [9] },
];

const evidenceLine = (html) => html.match(/<p class="ko-findev">Sources: ([\s\S]*?)<\/p>/)?.[1] ?? "";
const page = (evidence, provider, filings = FILINGS) => {
  const registerRecords = { provider, marks: [{ name: "TARNELLO", classes: [9], records: filings.map((f) => ({ ...f })) }] };
  addressListedFilings(registerRecords, []);   // a register with no record pages of its own: the office's page is the link
  return renderKnockoutHtml({
    batch: { overall: "Serious", executiveSummary: "summary" },
    marks: [{
      name: "TARNELLO", rating: "Serious", classesSearched: [9], classesDriving: [9], basis: "Close to a known property.",
      factors: ["An observation."], counterFactors: ["What holds it."], mitigation: "", bullets: ["A bullet."], purpleNotes: [],
      findings: [{ ordinal: 1, name: "TARNELLO", owner: "Tarnello Srl", band: "Serious", type: "Active Business",
        net: "Tarnello Srl's filings are likely to block the applicant.", evidence, basis: "Live filings for the same goods." }],
    }],
  }, MANIFEST, { runId: "r1", overall: "Serious", registerRecords });
};
const attr = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cell = (link) => (link.href ? `<a href="${attr(link.href)}" target="_blank" rel="noopener noreferrer">${attr(link.label)}</a>` : attr(link.label));

test("a held filing prints its office and number, linked where the office has a page, for EM, US and WO alike", () => {
  const line = evidenceLine(page([...FILINGS.map((f) => f.recordId), WEB], "clarivate"));
  for (const f of FILINGS) {
    const link = officeRecordLink(f, f.recordId);
    assert.ok(link?.href, `the office has no page for ${f.office}; the fixture does not test a link`);
    assert.ok(line.includes(cell(link)), `${f.office}: the card does not print the filings table's cell: ${line}`);
  }
  assert.ok(line.includes(`<a href="${WEB}" target="_blank" rel="noopener noreferrer">${WEB}</a>`), "the web address is no longer its link");
  assert.doesNotMatch(line, /\/mark\//, "a vendor record path is still on the card");
});

test("a filing the run does not hold is read only where the register's path carries the office's own number", () => {
  const own = page(["/mark/eu/018765432"], "euipo", []);
  const link = officeRecordLink({ office: "eu", applicationNumber: "018765432" });
  assert.ok(evidenceLine(own).includes(cell(link)), "an EUIPO application number was not read as the office's");
  const serial = page(["/mark/us/97123456"], "uspto-local", []);
  assert.ok(evidenceLine(serial).includes(cell(officeRecordLink({ office: "us", applicationNumber: "97123456" }))), "a USPTO serial was not read as the office's");
  for (const provider of ["clarivate", "signa", "corsearch", null]) {
    assert.equal(evidenceLine(page(["/mark/eu/018765432"], provider, [])), "/mark/eu/018765432",
      `${provider}: a vendor id was printed as the office's number`);
  }
});
