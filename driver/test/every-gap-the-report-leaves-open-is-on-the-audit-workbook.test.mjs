// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY GAP THE REPORT LEAVES OPEN IS ON THE AUDIT WORKBOOK, ONCE (design, 2026-11-20). The report's Left open list
// holds the run's open coverage rows and the local-script gaps composed from the search record, a script left
// unsearched in named territories, in a counted list of them, or worldwide. The workbook's Coverage & gaps sheet printed
// the coverage rows and none of the script gaps, so the record a reviewing lawyer keeps said less than the page. Each
// gap is now on that sheet with the territories the report lists under it; a gap a coverage row already states is that
// row, printed once; and the Summary counts what the sheet adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAudit } from "../publish/xlsx.mjs";
import { leftOpenRows, renderHtml } from "../publish/render.mjs";
import { parseReport } from "../publish/parse.mjs";
import { localScripts } from "../publish/search-depth.mjs";
import { WORKBOOK as W } from "../publish/strings.mjs";

async function book(t, contract) {
  const dir = mkdtempSync(join(tmpdir(), "left-open-book-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "audit.xlsx");
  await buildAudit(contract, null, out, "VOLTARIS", { title: "VOLTARIS" });
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const rows = (name) => {
    const got = [];
    wb.getWorksheet(name)?.eachRow((row) => got.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
    return got;
  };
  return { summary: rows("Summary"), coverage: rows("Coverage & gaps").slice(1) };
}

// Searched in Korea; not in Japan; not in five other planned territories; the worldwide search not completed; and Cyrillic
// planned with no search completed anywhere.
const LOCAL_SCRIPTS = {
  searched: ["Hang", "Kana"], missed: ["Cyrl"],
  territories: {
    Cyrl: { searched: [], missed: ["RU"] },
    Hang: { searched: ["KR"], missed: ["JP"], worldwide: "missed" },
    Kana: { searched: ["JP"], missed: ["CN", "EU", "KR", "TW", "UK"] },
  },
};
const COVERAGE = [
  { area: "Register — class 9", state: "confirmed-clean", note: "searched in full" },
  { area: "Common law — Switzerland", state: "not-searched", note: "the web search did not complete" },
];
const CONTRACT = {
  findings: [{ ordinal: 1, mark: "VOLTARYS", owner: { name: "Example Owner Ltd", country: "GB", registrations: [] }, disposition: "distinguished",
    source: { source_type: "register", resolved_link: "https://example.org/record/1" } }],
  coverage: COVERAGE,
};
// A Left open row as the sheet prints it: its area, and its note with the listed territories under it.
const asSheet = (r) => [r.area, r.detail ? `${r.note}\n${r.detail.join(", ")}` : r.note];

test("every row of the report's Left open list is on the Coverage & gaps sheet exactly once, with its territories", async (t) => {
  const open = leftOpenRows({ coverage: COVERAGE, localScripts: LOCAL_SCRIPTS });
  assert.equal(open.length, 5, "the open coverage row and four script gaps");
  assert.ok(open.some((r) => r.detail?.length === 5), "a counted gap lists its territories");
  const { coverage, summary } = await book(t, { ...CONTRACT, localScripts: LOCAL_SCRIPTS });
  for (const r of open) {
    const [area, left] = asSheet(r);
    assert.equal(coverage.filter((row) => row[0] === area && row[3] === left).length, 1, `${area}: ${left}`);
  }
  // The rows already on the sheet stay as they were, and the Summary counts what the sheet adds.
  assert.equal(coverage.length, COVERAGE.length + 4);
  assert.equal(summary.find((row) => row[0].trim() === W.summary.openOrLimited)?.[1], "5");
});

test("a gap a coverage row already states is that row, and a run with no search record adds nothing", async (t) => {
  const general = leftOpenRows({ localScripts: { searched: [], missed: ["Cyrl"], territories: { Cyrl: { searched: [], missed: ["RU"] } } } });
  assert.equal(general.length, 1);
  const stated = await book(t, { ...CONTRACT, coverage: [...COVERAGE, general[0]], localScripts: { searched: [], missed: ["Cyrl"], territories: {} } });
  assert.equal(stated.coverage.filter((row) => row[3] === general[0].note).length, 1);
  const before = await book(t, CONTRACT);
  assert.deepEqual(before.coverage.map((row) => row[0]), COVERAGE.map((c) => c.area));
});

test("from the plan to the sheet: each scope a term can have is the same gap on the page and on the workbook", async (t) => {
  const exec = (plan, done) => ({ executed: plan.entries.map((e) => ({ qid: e.qid, state: done.includes(e.qid) ? "enumerated" : "incomplete" })) });
  const term = (qid, regions) => ({ qid, term: "Вольтарис", ...(regions ? { regions } : {}) });
  const shapes = {
    own: [{ regions: ["RU", "KZ"], entries: [term("o", ["RU"]), term("k", ["KZ"])] }, ["k"], "No search in Cyrillic script was completed in Russia."],
    inheritedNamed: [{ regions: ["RU", "KZ"], entries: [term("n", []), term("k", ["KZ"])] }, ["k"], "No search in Cyrillic script was completed in Russia."],
    inheritedWorldwide: [{ scope_basis: "worldwide", regions: ["RU", "KZ"], entries: [term("w"), term("k", ["KZ"])] }, ["k"],
      "The planned worldwide search in Cyrillic script did not complete."],
    unrestricted: [{ scope_basis: "worldwide", regions: [], entries: [term("w", []), term("k", ["KZ"])] }, ["k"],
      "The planned worldwide search in Cyrillic script did not complete."],
    indeterminate: [{ regions: [], entries: [term("u", []), term("k", ["KZ"])] }, ["k"],
      "A planned search in Cyrillic script did not complete. Its territory was not recorded."],
  };
  const dir = mkdtempSync(join(tmpdir(), "left-open-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const md = join(dir, "report.md");
  writeFileSync(md, "---\ntitle: VOLTARIS\n---\n\n## Summary\n\nNo conflict.\n");
  for (const [shape, [plan, done, sentence]] of Object.entries(shapes)) {
    const ls = localScripts(plan, exec(plan, done));
    assert.deepEqual(leftOpenRows({ localScripts: ls }).map((r) => r.note), [sentence], shape);
    assert.ok(renderHtml(parseReport(md), [], [], { searchDepth: { counts: { localScripts: ls } } }).includes(`<div class="cd">${sentence}</div>`), `${shape}: the page`);
    const { coverage } = await book(t, { ...CONTRACT, localScripts: ls });
    assert.equal(coverage.filter((row) => row[3] === sentence).length, 1, `${shape}: the sheet`);
  }
  // A question sent with no territory that completed reached every territory: a narrower one that did not leaves no gap.
  const reached = { scope_basis: "worldwide", regions: [], entries: [term("w", []), term("r", ["RU"])] };
  assert.deepEqual(leftOpenRows({ localScripts: localScripts(reached, exec(reached, ["w"])) }), []);
});
