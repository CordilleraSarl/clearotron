// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RUN'S OWN COMMON-LAW SEARCH RECORD IS NAMED IN WORDS.
//
// A web and marketplace name the assessing model backed with the run's own search ledger carried that file's name
// where a web address would be, and the report printed it as a link to nowhere. A reference positively identified as
// that ledger now reads "the run's own common-law search record". Any other source keeps its exact reference: a
// file of another kind could be a register record or anything else, and a blanket label would invent provenance.
// Invented values only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";

const DIR = mkdtempSync(join(tmpdir(), "common-law-record-label-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

function pageWith(web) {
  const md = join(DIR, `r${Math.random().toString(36).slice(2)}.report.md`);
  writeFileSync(md, ["---", "type: clearance-clearance", "matter: quillmere", "title: QUILLMERE", "run: 2026-11-11", "---", "", "# Marks", ""].join("\n"));
  return renderHtml(parseReport(md), [], [], { runId: "quillmere", searchDepth: { cleared: { register: [], web } } });
}
const rowOf = (html, title) => {
  const m = new RegExp(`<div class="crow"><span class="cm-mark">${title}</span>(.*?)</div>`).exec(html);
  assert.ok(m, `no row for ${title}`);
  return m[1];
};

test("the run's own ledger, whole or a half, reads as the run's own common-law search record, and links nowhere", () => {
  for (const url of ["common-law-grid.half-b.json", "common-law-grid.json", "_driver/common-law-grid.half-a.json"]) {
    const row = rowOf(pageWith([{ title: "No confirmed QUILLMERE-form conflict", url }]), "No confirmed QUILLMERE-form conflict");
    assert.equal(row, `<span class="curl">the run's own common-law search record</span>`, `for ${url}`);
    assert.doesNotMatch(row, /href|common-law-grid/);
  }
});

test("a web address is still a link to it", () => {
  const row = rowOf(pageWith([{ title: "Quillmere candles", url: "https://example.test/quillmere" }]), "Quillmere candles");
  assert.equal(row, `<a class="curl" href="https://example.test/quillmere">example.test/quillmere</a>`);
});

test("any other source keeps its exact reference until a truthful label exists", () => {
  for (const url of ["common-law-findings.half-b.md", "grid-spec.half-b.json", "records/jp-1.json"]) {
    const row = rowOf(pageWith([{ title: "Quillmere other", url }]), "Quillmere other");
    assert.ok(row.includes(`>${url}</a>`), `${url} was relabelled: ${row}`);
    assert.doesNotMatch(row, /own common-law search record/);
  }
});
