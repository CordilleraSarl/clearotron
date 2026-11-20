// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO CLIENT SENTENCE IS WRITTEN OUTSIDE THE CATALOGUE. Every sentence the report pages, the audit workbooks and the
// cover emails put in front of a reader lives in driver/publish/strings.mjs by id, so a translation or a reworded
// sentence changes one module and nothing else. This holds the publishing files to that: each is parsed the way
// the portal's string extractor parses its source, and any literal that reads as prose must be one of those listed
// below, each with its reason. A new sentence written in place fails here; one that moved to the catalogue must
// come off the list. A row key a workbook builds its rows on passes, because the catalogue maps it to its label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stringsIn, readsAsProse } from "../../scripts/portal-strings.mjs";
import { WORKBOOK_LABELS } from "../publish/strings.mjs";

const PUBLISH = join(import.meta.dirname, "..", "publish");
const KEYS = new Set([...Object.keys(WORKBOOK_LABELS.columns), ...Object.keys(WORKBOOK_LABELS.sheets)]);

// What is still written in place, and why it may be. Exact strings, as the parser reads them ({…} marks a value).
const ALLOWED = {
  "render.mjs": [
    // a part's shipped name, which guards hold in this file
    "Marketplace and web",
    "Local-language investigation",
    "Court decisions",
    // the heading a guard holds to both layouts in this file
    "<div class=\"sec\"><span class=\"num\"></span><h2>Marks that can coexist</h2></div> {…}{…}",
    "<div class=\"sec\"><span class=\"num\"></span><h2>Marks that can coexist</h2></div> {…}",
    // an engine token compared against, never printed
    "perplexity_research — no result",
    // markup the parser reads as words
    "class=\"on\" style=\"color:var({…})\"",
  ],
  "render-knockout.mjs": [
    // a part's shipped name, which a guard holds in this file
    "<div class=\"panel about\"> <div class=\"label\">About this request</div> {…} {…} {…} {…} {…} {…} {…} {…} </div>",
    // the caveat filter's reference, which the page no longer prints
    "What this is. A fast screen for obvious blockers to using each name, from marketplace and web use plus a count of register filings. What it is not. A clearance search. We drew no register conclusions and give no filing advice. A name that passes here is not clear; it goes on to clearance. Every conflict above links to the material we found. The audit workbook holds every search run, every empty result and the working notes. Register data.",
  ],
  "xlsx.mjs": [
    // the workbook validator's own findings, which no client reads
    "expected 4 tabs, got {…} ({…})",
    "missing tab \"{…}\"",
    "banned vocab \"{…}\" in {…}",
    "tab name \"{…}\"",
    "banned vocab \"{…}\"",
    "machine-check row Summary r{…} is not lawyer-language: {…}",
    "empty column \"{…}\" in {…}",
    "Findings has {…} ghost/continuation row(s) with no mark (multi-registration owners must stay on one row)",
    "Findings \"{…}\": no source",
    "Findings \"{…}\": no treatment",
    "Findings \"{…}\": no band/treatment marker",
    "Findings \"{…}\": no record link, and no registration number + office either — nothing identifies the record",
    "Findings \"{…}\": link does not resolve to http(s)",
    "mark similarity",
    "goods proximity",
    "Findings \"{…}\": the similarity driver carries an evidence word the report does not print (got \"{…}\")",
    "Findings \"{…}\": {…} driver is unknown but says nothing about its evidence (got \"{…}\")",
    "Findings \"{…}\": {…} driver's evidence word is not the report's (got \"{…}\")",
    "What was searched: no common-law block",
    "What was searched: the common-law block carries no searched terms — the run's search log recorded none, so the sheet states the sweep rather than setting it out",
    "What was searched: a common-law block on a register-only run — the workbook claims a sweep that did not run",
    "Summary: no Verdict row",
    "Summary: coverage is open but no caveat row (headline-honesty)",
    "Coverage & gaps: coverage is open but no Open/Limited row (headline-honesty)",
  ],
  "knockout.mjs": [
    // log lines, a file name and front-matter keys
    "knockout publish REFUSED for {…}: {…} finding citation(s) could not be traced to this run's own research payloads. {…}",
    "knockout receipts: {…} citation(s) across {…} finding(s) on {…}/{…} mark(s) traced to held evidence",
    "knockout record links: {…} URL(s) on a host {…} cannot produce reduced to the record number — {…}{…}",
    "this run",
    "and {…} more",
    "knockout lint receipt write failed (non-fatal): {…}",
    "knockout predelivery lint skipped (non-fatal): {…}",
    "knockout report document not built (non-fatal): {…}",
    "knockout report document not written (non-fatal): {…}",
    // an error a publish throws
    "the report document could not be built, so the run record cannot be written",
    // the error that stops the publish when the report document the pages read was not built; no client reads it
    "[report-document] not built, so the Knockout pages have nothing to read",
    "knockout working record: {…} is not in the run directory, so the delivered report has no engine text to be checked against",
    "knockout-audit-{…}.xlsx",
    "overall_label: \"{…}\"",
    "overall_badge: \"{…}\"",
  ],
  "office-record-links.mjs": [
    // log lines
    "record not retrieved {…}",
    "linked {…}{…} · cited by number {…}{…} · {…}",
    "no office number {…}",
  ],
  "index.mjs": [
    // the staff pool index, its attributes and a style value
    "data-anon-href data-anon-key=\"{…}\" data-anon-run=\"{…}\"",
    "<span class=\"disc\" title=\"{…}\">◦ built without an input</span>",
    "published without {…} — each declared optional, so the release stands; the report was built without it",
    "<div class=\"filterbar\"><label class=\"flbl\" for=\"clientFilter\">Client</label><select id=\"clientFilter\"><option value=\"\">All clients</option>{…}</select></div>",
    "<details class=\"archive-roll\"> <summary><span class=\"arch-h\">Older / retired runs</span><span class=\"arch-n\">{…} run(s)</span></summary> <table> <tr><th>Matter</th><th>Project</th><th>Client</th><th>Overall</th><th>Run</th><th>Audit</th></tr> {…} </table> </details>",
    "Clearance reports",
    "{…} shown · {…} retired · {…} report(s) total · access-controlled · noindex. Behind the deployment's auth proxy in production.",
    "{…} report(s) · access-controlled · noindex. Behind the deployment's auth proxy in production.",
    "font-family:Calibri,'Segoe UI',Arial,sans-serif",
    // an error a publish throws
    "the report document could not be built, so the run record cannot be written",
  ],
};
const FILES = [...Object.keys(ALLOWED), "register-record.mjs", "register-record-html.mjs"];

/** Every literal in a source that reads as prose once its markup is set aside, less the workbook's row keys. */
function prose(source, file) {
  const text = (r) => String(r.string ?? r.text ?? "");
  return [...new Set(stringsIn(source, file).map(text)
    .filter((s) => readsAsProse(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()))
    .filter((s) => !KEYS.has(s)))];
}

test("every publishing file writes no client sentence of its own beyond the listed ones", () => {
  assert.equal(FILES.length, 8);
  for (const file of FILES) {
    const found = prose(readFileSync(join(PUBLISH, file), "utf8"), file);
    const allowed = ALLOWED[file] ?? [];
    assert.deepEqual(found.filter((s) => !allowed.includes(s)), [],
      `${file} writes a sentence in place: move it to driver/publish/strings.mjs, or list it here with its reason`);
    assert.deepEqual(allowed.filter((s) => !found.includes(s)), [],
      `${file} no longer writes a listed string: take it off the list`);
  }
});

test("a sentence written in place is caught, in a template as in a plain string", () => {
  const file = "render.mjs";
  const source = readFileSync(join(PUBLISH, file), "utf8");
  const planted = source + "\nconst plantedA = 'A sentence a reader would meet on the page.';"
    + "\nconst plantedB = (n) => `<p>${n} conflicts were found on the register.</p>`;\n";
  const found = prose(planted, file).filter((s) => !(ALLOWED[file] ?? []).includes(s));
  assert.deepEqual(found, ["A sentence a reader would meet on the page.", "<p>{…} conflicts were found on the register.</p>"]);
});
