// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE OPEN COVERAGE ROWS GROUP UNDER THEIR STATE WORDS, EACH WITH ITS COUNT, AND EVERY ROW STAYS.
//
// A report listed 23 to 65 open coverage rows that all looked alike. They now group under the state words the rows
// already carry, each group with its count, in a fixed order; no row is dropped, merged or reworded (owner,
// 2026-11-18). Every area and note here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { parseFindingsJson } from "../findings-model.mjs";

const run = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo", "multi-country-focus-search", "run");
const row = (n, state) => ({ area: `Invented area ${n}`, state, note: `Invented note ${n}.` });
const COVERAGE = [row(1, "not-searched"), row(2, "coverage-limited"), row(3, "open"), row(4, "not-searched"),
  row(5, "note"), row(6, "coverage-limited"), row(7, "confirmed-clean"), row(8, "not-searched")];

test("open rows group under their state words with a count, in a fixed order, and every row renders once", () => {
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  const html = renderHtml(parseReport(join(run, "report.md")), v.findings, COVERAGE, { runId: "demo" });
  // Every open row renders exactly once; the searched-and-clean row (7) is not one of them and joins no group.
  for (const n of [1, 2, 3, 4, 5, 6, 8]) {
    assert.equal(html.split(`Invented note ${n}.`).length - 1, 1, `open row ${n} is not on the page exactly once`);
  }
  const grouped = html.slice(html.indexOf('<div class="covgrp">'), html.lastIndexOf('</div></div></div>'));
  assert.equal(grouped.includes("Invented note 7."), false, "a searched-and-clean row was put in an open group");
  const heads = [...html.matchAll(/<div class="covgh">([^<]*) <span class="covgn">\((\d+)\)<\/span><\/div>/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(heads, [["Partially covered", 2], ["Open item", 1], ["Not run this run", 3], ["Note", 1]]);
  // Each group holds exactly the rows it counts: the three not-searched rows sit under that heading.
  const group = html.slice(html.indexOf("Not run this run <span"), html.indexOf("Note <span class=\"covgn\""));
  for (const n of [1, 4, 8]) assert.ok(group.includes(`Invented note ${n}.`), `row ${n} is outside its group`);
});

// A REPORT WHOSE ASSESSMENT DID NOT COMPLETE states a shared note once, capitalised, then the searches it covers; a
// row with a note of its own renders as it always did (owner, 2026-11-18).
test("with no assessment, rows that share a note are one item: the note once, then the searches it covers", () => {
  const v = parseFindingsJson(readFileSync(join(run, "findings.json"), "utf8"));
  const SHARED = "it could not be completed on this invented search.";
  const rows = [
    { area: "invented search one", state: "open", note: SHARED },
    { area: "invented search two", state: "open", note: SHARED },
    { area: "invented search three", state: "open", note: SHARED },
    { area: "invented search four", state: "open", note: "Its own invented note." },
  ];
  const html = renderHtml(parseReport(join(run, "report.md")), v.findings, rows, { runId: "demo", assessmentNotCompleted: true });
  assert.equal(html.split(SHARED).length - 1, 0, "the shared note still prints lower-case");
  assert.equal(html.split("It could not be completed on this invented search.").length - 1, 1, "the shared note is not said once, capitalised");
  const list = html.match(/<ul class="covlist">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  assert.deepEqual([...list.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => m[1]),
    ["Invented search one", "Invented search two", "Invented search three"]);
  assert.equal(html.split("Its own invented note.").length - 1, 1, "the row with its own note renders as it was");
  assert.match(html, /Open item <span class="covgn">\(4\)<\/span>/, "the group still counts every row");
  // A report with its verdict keeps one cell per row.
  const withVerdict = renderHtml(parseReport(join(run, "report.md")), v.findings, rows, { runId: "demo" });
  assert.equal(withVerdict.split(SHARED).length - 1, 3);
  assert.doesNotMatch(withVerdict, /class="covlist"/);
});
