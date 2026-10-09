// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A page the web notes marked as a candidate or conflict leaves synthesis the way a register record does:
// delivered as a finding, or declined by its position on the offered list with a reason and a ground. The
// pages follow the records on that list, so no record's position moves, and nothing the seat sends can name
// a page it was not handed. A page the notes only read is not offered. The declines reach the hand-off
// count, and an undecided page is counted, not refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir, ensureDriverDir } from "../../shared/driver-dir.mjs";
import { acceptDeclinationCall, rowKey, isPageRow, DECLINATION_REASONS, groundsProblem } from "../declination-call.mjs";
import { recordDeclinations, readDeclinations, declinationKey } from "../declination-tool.mjs";
import { reconcileDeclinationDuty } from "../declination-duty.mjs";
import { notesExits, notesPageRows } from "../hand-off-exits.mjs";
import { paths, STAGES } from "../stages.mjs";

const PL = await import("../pipeline.mjs");

const RECORD = { uri: "/mark/eu/tm_sample-1", mark: "SAMPLE", owner: "Sample Holdings SA", tier: "sheet-2", classes: [9], status: "REGISTERED" };
const PAGE_A = { kind: "page", page: "store.example/app/12/Near_Title", url: "https://store.example/app/12/Near_Title/" };
const PAGE_B = { kind: "page", page: "store.example/publisher/north", url: "https://store.example/publisher/north" };
const NOTES = [
  "## Findings",
  "| Finding | Source / Platform | URL | Notes |",
  "|---|---|---|---|",
  `| Near title | store.example | ${PAGE_A.url} | direct conflict |`,
  `| Publisher | store.example | ${PAGE_B.url} | indie publisher |`,
  "### Negative results",
  "| Variant | Platform | Result |",
  "|---|---|---|",
  "| SAMPLE | store.example | No similar listings (8 candidates reviewed) https://store.example/search?q=sample |",
].join("\n");
const GROUND = "an indie publisher page with no game under the name; nothing sold in the client's field";

test("a page row is keyed by its address, and a record row by its uri", () => {
  assert.equal(isPageRow(PAGE_A), true);
  assert.equal(isPageRow(RECORD), false);
  assert.equal(rowKey(PAGE_A), "page:store.example/app/12/Near_Title");
  assert.equal(rowKey(RECORD), "/mark/eu/tm_sample-1");
  assert.equal(declinationKey("page:store.example/x"), "page:store.example/x", "the record normaliser would read a page key as nothing");
  assert.equal(declinationKey("https://register.example/mark/EU/tm_sample-1"), "/mark/eu/tm_sample-1");
});

test("the seat declines a page by its position, and the acceptance names the page, never a uri it lacks", () => {
  const spec = { rows: [RECORD, PAGE_A, PAGE_B], scope: { marks: ["SAMPLE"], classes: [9] } };
  const r = acceptDeclinationCall(spec, { declinations: [
    { row_index: 2, reason: "not-worth-the-line", grounds: GROUND },
    { row_index: 1, reason: "no-such-reason", grounds: GROUND },
  ] });
  assert.equal(r.accepted.length, 1);
  assert.deepEqual({ ...r.accepted[0], grounds: undefined },
    { row_index: 2, uri: null, page: PAGE_B.page, url: PAGE_B.url, mark: null, owner: null, reason: "not-worth-the-line", grounds: undefined });
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].uri, "page:store.example/app/12/Near_Title", "a refused page is named, so the bound can count it");
  assert.deepEqual(r.open.map((o) => o.row_index), [0, 1], "the record and the refused page are still owed");
  assert.equal(r.open[1].page, PAGE_A.page);
});

test("a page carries no status or class, so no refusal about a live in-class mark can fire on it", () => {
  const spec = { rows: [PAGE_A], scope: { marks: ["NEAR TITLE"], classes: [9] } };
  const r = acceptDeclinationCall(spec, { declinations: [{ row_index: 0, reason: "not-worth-the-line", grounds: GROUND }] });
  assert.equal(r.accepted.length, 1);
  assert.match(DECLINATION_REASONS["own-right"].gloss, /record or page/);
  assert.match(DECLINATION_REASONS["duplicate-of-delivered"].gloss, /record or page/);
});

test("a declined page is kept in the ledger under its address, apart from the records", () => {
  const runDir = mkdtempSync(join(tmpdir(), "page-decline-"));
  try {
    const spec = { runDir, rows: [RECORD, PAGE_A, PAGE_B], scope: {} };
    const out = recordDeclinations(spec, { declinations: [
      { row_index: 0, reason: "unrelated-goods", grounds: "stationery only; nothing electronic in the specification" },
      { row_index: 1, reason: "off-field-not-major", grounds: GROUND },
    ] });
    assert.equal(out.accepted, 2);
    assert.equal(out.still_open.length, 1);
    assert.equal(out.still_open[0].page, PAGE_B.page, "the undecided page is named in the answer");
    assert.match(out.note, /^1 row\(s\) on your findings surface still carry no decision/);
    const d = readDeclinations(runDir);
    assert.deepEqual([...d.byUri.keys()], ["/mark/eu/tm_sample-1"]);
    assert.deepEqual([...d.byPage.keys()], [PAGE_A.page]);
    assert.equal(d.byPage.get(PAGE_A.page).url, PAGE_A.url);
    assert.equal(d.count, 2);
    const ledger = JSON.parse(readFileSync(driverDir(runDir, "declinations.json"), "utf8"));
    assert.ok(ledger.declinations.every((x) => x.page || x.uri), "every kept decision names what it decided");
    // The answer's open list is this call's rows left undecided, so a call deciding all three reads closed.
    const again = recordDeclinations(spec, { declinations: [
      { row_index: 0, reason: "unrelated-goods", grounds: "stationery only; nothing electronic in the specification" },
      { row_index: 1, reason: "off-field-not-major", grounds: GROUND },
      { row_index: 2, reason: "not-worth-the-line", grounds: GROUND },
    ] });
    assert.equal(again.still_open.length, 0);
    assert.match(again.note, /every record and page on your findings surface now carries a decision/);
    assert.equal(readDeclinations(runDir).count, 3, "a later call adds to the pages already kept");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("an undecided page is counted, not refused: the records' duty does not reach it", () => {
  const duty = reconcileDeclinationDuty({ owed: [RECORD, PAGE_A], deliveredUris: [], declinedUris: [RECORD.uri] });
  assert.equal(duty.computable, true);
  assert.equal(duty.totals.owed, 1, "the duty counts records only");
  assert.equal(duty.unaccounted.length, 0);
});

test("the hand-off count treats a declined page as a stated exit", () => {
  const e = notesExits(NOTES, [], new Map([[PAGE_A.page, { reason: "off-field-not-major" }]]));
  assert.equal(e.marked, 2, "the two pages the notes marked, not the search page their matrix read");
  assert.equal(e.declined, 1);
  assert.equal(e.exits, 1);
  assert.deepEqual(e.rows.map((r) => r.page), [PAGE_B.page]);
  assert.deepEqual(notesPageRows(NOTES), [PAGE_A, PAGE_B]);
  assert.deepEqual(notesPageRows(null), []);
});

test("the offered list puts the notes' pages after the records, and the spec holds the same list", () => {
  const runDir = mkdtempSync(join(tmpdir(), "page-offered-"));
  try {
    const P = paths(runDir);
    ensureDriverDir(runDir);
    writeFileSync(P.commonLaw, NOTES);
    const ctx = {};
    PL.prepareDeclinationSpec(ctx, P);
    const spec = JSON.parse(readFileSync(driverDir(runDir, "declination-spec.json"), "utf8"));
    assert.deepEqual(spec.rows, [PAGE_A, PAGE_B], "with no placements on disk the pages alone are offered");
    assert.deepEqual(ctx.findingsSurface, spec.rows, "the prompt and the tool read one list");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the synthesis instructions print the pages after the records, continuing the positions", () => {
  const base = {
    paths: { findings: "/run/findings.json" }, job: {}, customerUnknown: false, profile: null,
    intakeAsks: [], enforcerSignals: null, framework: null, jxAim: null, registerOnly: false,
    crowdContext: null, dispatchBlocks: {},
  };
  const text = String(STAGES.synthesis.message({ ...base, findingsSurface: [RECORD, PAGE_A, PAGE_B] }));
  assert.match(text, /the register digest carried 1 record\(s\) onto your findings surface, and the web notes marked 2 page\(s\) as candidates or conflicts\./);
  assert.match(text, /A page you do not mention is counted as a defect of this run\./);
  assert.match(text, /A record or page that reached your findings surface leaves this stage/);
  assert.match(text, /you cite a record or page by its POSITION in the list below/);
  const list = text.slice(text.indexOf("The records on your findings surface, by position:"));
  assert.match(list, /\n {2}0\. SAMPLE — Sample Holdings SA \[sheet-2\] \/mark\/eu\/tm_sample-1\n/);
  assert.match(list, /\nThe pages the web notes marked as candidates or conflicts, continuing the same positions:\n {2}1\. https:\/\/store\.example\/app\/12\/Near_Title\/\n {2}2\. https:\/\/store\.example\/publisher\/north/);
  const recordsOnly = String(STAGES.synthesis.message({ ...base, findingsSurface: [RECORD] }));
  assert.doesNotMatch(recordsOnly, /web notes marked|A page you do not mention/, "a run with no pages reads as before");
  const tool = readFileSync(new URL("../engine/mcp/declination-server.mjs", import.meta.url), "utf8");
  assert.ok(tool.includes("every page the web notes marked as a candidate or conflict"), "the tool names the same pages");
  assert.doesNotMatch(tool, /web notes surfaced/);
});

test("the findings step's own words about a declination say record or page, as the tool's fields do", () => {
  const base = {
    paths: { findings: "/run/findings.json" }, job: {}, customerUnknown: false, profile: null,
    intakeAsks: [], enforcerSignals: null, framework: null, jxAim: null, registerOnly: false,
    crowdContext: null, dispatchBlocks: {},
  };
  const text = String(STAGES.synthesis.message({ ...base, findingsSurface: [RECORD, PAGE_A] }));
  assert.ok(text.includes("on why THIS record or page does not earn a line"));
  assert.ok(text.includes("the rules do not let you omit the record or page."));
  assert.doesNotMatch(text, /THIS record does not earn|omit the record\./);
  assert.match(groundsProblem("too short", "duplicate"), /too short to say anything about this record or page\./);
});

test("what synthesis set aside reaches the audit workbook's coverage tab, with the AI's own ground", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "page-workbook-"));
  const book = join(runDir, "audit.xlsx");
  try {
    recordDeclinations({ runDir, rows: [RECORD, PAGE_A], scope: {} }, { declinations: [
      { row_index: 0, reason: "unrelated-goods", grounds: "stationery only; nothing electronic in the specification" },
      { row_index: 1, reason: "off-field-not-major", grounds: GROUND },
    ] });
    const { setAsideRows } = await import("../publish/index.mjs");
    const setAside = setAsideRows(runDir);
    assert.deepEqual(setAside, [
      { area: "Set aside: SAMPLE — Sample Holdings SA", note: "stationery only; nothing electronic in the specification" },
      { area: `Set aside: ${PAGE_A.url}`, note: GROUND },
    ]);
    assert.deepEqual(setAsideRows(join(runDir, "no-such-run")), [], "no ledger, no rows");
    const { buildAudit } = await import("../publish/xlsx.mjs");
    const { default: ExcelJS } = await import("exceljs");
    await buildAudit({ findings: [], coverage: [{ area: "register / Switzerland — anchor", state: "confirmed-clean", note: "enumerated to completion" }],
      setAside, fetchState: {}, verdict: { tier: "Manageable" }, jurisdiction: "Switzerland" }, { findings: [], audit: [], negatives: [] }, book, "SAMPLE", { title: "SAMPLE" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(book);
    const ws = wb.getWorksheet("Coverage & gaps");
    const rows = [];
    ws.eachRow((r, n) => { if (n > 1) rows.push(r.values.slice(1).map((v) => String(v ?? ""))); });
    assert.deepEqual(rows.slice(-2), [
      ["Set aside: SAMPLE — Sample Holdings SA", "Note", "stationery only; nothing electronic in the specification", "—"],
      [`Set aside: ${PAGE_A.url}`, "Note", GROUND, "—"],
    ], "a ground with a semicolon stays whole in 'What was done'");
    assert.equal(wb.worksheets.length, 4, "the workbook keeps its four tabs");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});
