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
