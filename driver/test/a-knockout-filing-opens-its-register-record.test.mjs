// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT FILING OPENS ITS REGISTER RECORD, AND SHOWS ITS LOGO IN ITS TRADEMARK CELL (owner, 2026-11-18).
//
// The Knockout is a level of clearance, so a listed filing gets what a clearance card's registration gets: a closed
// "Register record" drop-down, in a row under its table row, built from the record the run saved, with the same rows
// a clearance draws. A filing whose record carries a logo shows it under the mark name, in the card's box and with
// no caption, since the Territory column names the register. A filing the run saved no record of keeps its single
// row, so a run that saved none renders its table as before. Every name, number and image here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { parseFrameworkManifest } from "../framework.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseReport } from "../publish/parse.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "record-test", title: "Invented test framework", source_deck: "none",
  entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const DATA = `data:image/png;base64,${PNG.toString("base64")}`;
const US = "/mark/us/6123457", GB = "/mark/gb/uk00004012873", AU = "/mark/au/2210934";
const FILINGS = [
  { recordId: US, mark: "SKARVELLE", owner: "Dunquarry Sound LLC", status: "Registered", classes: [9], territory: "US",
    officeLink: { office: "us", label: "US 6123457", href: "https://register.example/us/6123457", reason: null } },
  { recordId: GB, mark: "SKARVELL AUDIO", owner: "Halloway Trading Ltd", status: "Pending", classes: [9, 11], territory: "GB" },
  { recordId: AU, mark: "SKAR VELLE", owner: "Corrivane Pty Ltd", status: "Registered", classes: [15], territory: "AU" },
];
const body = (uri, office, mark, feature, over = {}) => ({
  uri, provider: "clarivate", office, applicationNumber: uri.split("/").at(-1), registrationNumber: uri.split("/").at(-1),
  applicationDate: "2021-06-07", registrationDate: "2022-03-15", expiryDate: "2032-03-15", statusText: "REGISTERED",
  markText: mark, markFeature: feature, imageAvailable: true, owner: "Dunquarry Sound LLC", ownerCountry: "US",
  goodsServices: [{ classes: ["9"], language: "en", description: "Headphones; earphones; wireless speakers." }], ...over,
});
const page = (opts = {}) => renderKnockoutHtml({
  batch: { overall: "Notable", executiveSummary: "summary" },
  marks: [{ name: "SKARVELLE", rating: "Notable", classesSearched: [9], classesDriving: [9], basis: "Close names stand.",
    factors: ["An observation."], counterFactors: ["What holds it."], mitigation: "", bullets: ["A bullet."], purpleNotes: [], findings: [] }],
}, MANIFEST, { runId: "r1", overall: "Notable",
  registerRecords: { provider: "clarivate", marks: [{ name: "SKARVELLE", classes: [9], records: FILINGS.map((f) => ({ ...f })) }] }, ...opts });
const RECORDS = new Map([[US, body(US, "us", "SKARVELLE", "WORD ONLY")], [GB, body(GB, "gb", "SKARVELL AUDIO", "WORD AND DESIGN", { owner: "Halloway Trading Ltd", ownerCountry: "GB" })]]);
const rowOf = (html, mark) => html.match(new RegExp(`<tr class="rr-has">\\s*<td>${mark}[\\s\\S]*?</tr><tr class="rr-krow">([\\s\\S]*?)</tr>`));

test("a filing the run saved a record of opens it in a closed drop-down in the row under its own", () => {
  const html = page({ filingRecords: RECORDS, logos: new Map() });
  const us = rowOf(html, "SKARVELLE");
  assert.ok(us, "the record row does not follow the filing's row");
  assert.match(us[1], /^<td colspan="6"><details class="drill rr-drill"><summary>Register record<\/summary><div class="drillbody"><div class="rr">/, "the drop-down is missing or open");
  for (const row of ["Mark", "Goods and services", "Owner", "Country", "Status", "Register number"]) assert.ok(us[1].includes(`<span class="k">${row}</span>`), `the ${row} row is missing`);
  assert.ok(us[1].includes('<a href="https://register.example/us/6123457" target="_blank" rel="noopener noreferrer">US 6123457</a>'), "the register number is not the table's own cell");
  assert.ok(us[1].includes("<b>SKARVELLE</b> <span class=\"rr-faint\">Word only</span>"), "the mark and its type");
  assert.match(html, /<tr>\s*<td>SKAR VELLE<\/td>/, "a filing with no saved record lost its single row");
  assert.equal((html.match(/<tr class="rr-krow">/g) ?? []).length, 2, "a record row was drawn for a filing with no saved record");
});

test("a filing's logo sits under its mark name, in the card's box, with no caption", () => {
  const html = page({ filingRecords: RECORDS, logos: new Map([[GB, { state: "fetched", src: DATA }]]) });
  assert.match(html, new RegExp(`<td>SKARVELL AUDIO<div class="rr-logos rr-ko"><figure class="rr-lg"><img src="${DATA.replace(/[+/]/g, (c) => `\\${c}`)}" alt="SKARVELL AUDIO, logo as registered in United Kingdom"></figure></div></td>`),
    "the logo is not under the mark name, uncaptioned");
  assert.doesNotMatch(html.match(/<div class="rr-logos rr-ko">[\s\S]*?<\/div>/)[0], /figcaption/);
});

test("a run that saved no records draws the table as it did, and a clearance and a Knockout draw one entry the same way", () => {
  assert.equal(page(), page({ filingRecords: new Map(), logos: new Map() }), "empty records changed the page");
  assert.doesNotMatch(page(), /<tr class="rr-krow">|<tr class="rr-has">/, "a run with no records drew a record row");
  // The same record, drawn by both pages: the entries match except for the register number's cell, each page's own.
  const dir = mkdtempSync(join(tmpdir(), "rr-both-"));
  try {
    writeFileSync(join(dir, "r.report.md"), ["---", "type: clearance-clearance", "matter: rr-both", "title: OSTREVIN",
      "overall_label: MEDIUM", "overall_badge: l3", "classes: 9", "jurisdiction: United States", "run: 2026-11-19", "---", ""].join("\n"));
    const clearance = renderHtml(parseReport(join(dir, "r.report.md")), [{ ordinal: 1, mark: "SKARVELLE", composite: 4, disposition: "adversarial",
      net: "A sentence.", owner: { name: "Dunquarry Sound LLC", registrations: [{ uri: US, jurisdiction: "US" }] } }], [],
    { runId: "rr-both", recordsByUri: new Map([[US, RECORDS.get(US)]]), recordLinks: new Map([[US, FILINGS[0].officeLink]]) });
    const entryOf = (html) => html.match(/<div class="rr"><div class="rr-row"><span class="k">Mark<\/span><span class="v"><b>SKARVELLE<\/b>[\s\S]*?<span class="k">Register number<\/span>/)?.[0];
    assert.equal(entryOf(clearance), entryOf(page({ filingRecords: RECORDS })), "the two pages draw one record differently");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
