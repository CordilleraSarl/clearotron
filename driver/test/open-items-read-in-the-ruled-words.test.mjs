// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// OPEN ITEMS READ IN THE RULED WORDS (owner, 2026-11-18, batch two items 1132 to 1138, L-03).
//
// The Left open grid said "Not run this run", led its rows with a sentence about "bounded monitor items", and showed a
// question from the request under the engine's own token, "Intake-ask". A deferred source read "never swept this run",
// and a full native-language ask that ran candidates only read in the record's terms. Each now reads as ruled. The
// arms here cover what the updated render and lane-depth tests do not. Every name and row here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverageGrid } from "../publish/render.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";
import { coverageUnitLabel, readerRowHead } from "../coverage-ledger.mjs";
import { injectLaneDepthCoverage } from "../pipeline.mjs";
import { LANGUAGE_LANES } from "../jx-lanes.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const ROWS = [{ area: "intake-ask / the TARNELLO search in both scripts", state: "open", note: "Not answered in the report." },
  { area: "Register / EU", state: "not-searched", note: "the source it needed was not searched" }];

test("the grid's lead line is its head alone, and its states read \"Not searched\" and \"Open item\"", () => {
  const html = coverageGrid(ROWS);
  assert.ok(html.includes('<p class="covnext"><b>Next steps &amp; monitoring</b></p>'), "the lead line keeps more than its head");
  assert.doesNotMatch(html, /bounded monitor items|Not run this run/);
  assert.match(html, /<div class="covgh">Not searched <span class="covgn">\(1\)<\/span>/);
});

test("a question from the request heads its row in the reader's words, on the page and through the workbook's label", () => {
  const html = coverageGrid(ROWS);
  assert.ok(html.includes('<div class="ct">Question from the request / the TARNELLO search in both scripts <span class="cst">'), html);
  assert.doesNotMatch(html, /Intake-ask/);
  assert.equal(coverageUnitLabel("intake-ask / the TARNELLO search"), "Question from the request / the TARNELLO search");
  assert.equal(readerRowHead("Intake-Ask"), "Question from the request", "the head alone, in any case");
  for (const other of ["Register / intake-ask", "intake-asks / x", "Company registers"]) assert.equal(readerRowHead(other), other, `${other} was relabelled`);
});

test("a source left unsearched reads as ruled", () => {
  assert.equal(plainDeferralReason("source-not-swept: web"), "the source it needed was not searched, so nothing is known about it either way");
});

test("a full native-language ask that ran candidates only is one row, the owner's sentence alone", () => {
  const d = mkdtempSync(join(tmpdir(), "l03-depth-"));
  const P = { findings: join(d, "findings.json") };
  writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage: [] }));
  mkdirSync(driverDir(d), { recursive: true });
  const lang = LANGUAGE_LANES.zh.label.replace(/-script deepening$/, "");
  const why = `A full-depth ${lang}-language search was requested, but only the candidate search ran; the deeper web search and native-language review were not performed.`;
  writeFileSync(join(driverDir(d), "jx-lanes.json"), JSON.stringify({ lanes: { zh: { depth: "full" } },
    fold: { depth: { zh: { asked: "full", ran: "candidates", shortfall: true, cause: "requested-full-ran-candidates", why, detail: "serp-grid refused" } } } }));
  injectLaneDepthCoverage(P, d, () => {});
  assert.deepEqual(JSON.parse(readFileSync(P.findings, "utf8")).coverage, [{ area: `${lang}-language search depth`, state: "coverage-limited", note: why }]);
});
