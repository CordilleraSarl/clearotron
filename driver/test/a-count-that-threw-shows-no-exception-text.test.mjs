// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COUNT THAT DID NOT LAND SHOWS THE READER'S LINE, NEVER THE EXCEPTION OR THE PROVIDER'S OWN WORDS.
//
// A count's `unavailable` text is the counts record's. When the counter throws it reads `count threw:
// <the exception's message>`, and otherwise it can be the provider's raw refusal. The knockout workbook's
// Register Counts note and the knockout page's "not available" cell both printed it as it stood. Each now
// prints the line the product already prints for a count left open (deferral-row.mjs, plainCause), and
// the record keeps the text exactly as it was written. The two lines the counter writes for a reader stay:
// a name with no near-form, and how many of the close-variation forms went uncounted. Every name here is
// invented.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { countRegisterHits } from "../register-count.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { buildKnockoutWorkbook } from "../publish/knockout.mjs";
import { renderKnockoutHtml } from "../publish/render-knockout.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";

const LEFT_OPEN = plainDeferralReason("unfinished");
const TIMED_OUT = plainDeferralReason("mechanical-fail:timeout");
const NAME = "LANTERNWICK";
const FINDINGS = { marks: [{ name: NAME, findings: [] }], batch: { executiveSummary: "One name screened.", standardCaveats: [] } };
const FW = { framework_key: "orchard-test", title: "Invented test framework", entity_label: "the company",
  bands: [{ label: "High", tone: "high" }, { label: "Low", tone: "low" }], structure: { kind: "bands" } };
const RAW = /count threw|ECONNRESET|socket hang up|HTTP 503|upstream connect error/i;

const count = (counter) => countRegisterHits({
  marks: [{ name: NAME, classes: [9] }], provider: "corsearch", capabilities: capabilitiesFor("corsearch"),
  counter, now: () => new Date("2026-10-02T09:00:00Z"),
});

async function notes(registerCounts, t) {
  const dir = mkdtempSync(join(tmpdir(), "count-threw-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "knockout-audit.xlsx");
  await buildKnockoutWorkbook({ marks: FINDINGS.marks }, [], out, registerCounts);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet("Register Counts");
  const head = ws.getRow(1).values.slice(1);
  const row = Object.fromEntries(head.map((h, i) => [h, String(ws.getRow(2).values[i + 1] ?? "")]));
  const cells = [];
  wb.eachSheet((s) => s.eachRow((r) => r.values.slice(1).forEach((v) => cells.push(String(v ?? "")))));
  // A sheet whose Notes are all empty carries no Notes column at all, so an absent cell reads as no note.
  return { notes: row["Notes"] ?? "", cells };
}
const page = (registerCounts) => String(renderKnockoutHtml(FINDINGS, FW, { runId: "r", overall: "Low", registerCounts }))
  .replace(/<style>[\s\S]*?<\/style>/g, "");

test("a counter that throws leaves its exception in the record and out of the note and the page", async (t) => {
  const doc = await count(async (_term, p) => {
    if (p.key === "identical") return { ok: true, total: 4 };
    throw new Error("socket hang up (ECONNRESET 10.0.0.7:443)");
  });
  const cell = doc.marks[0].counts.containing;
  assert.match(cell.unavailable, /^count threw: socket hang up/, "premise: the record keeps the exception as written");
  const { notes: n, cells } = await notes(doc, t);
  assert.ok(!cells.some((c) => RAW.test(c)), `an exception reached the workbook: ${cells.find((c) => RAW.test(c))}`);
  assert.match(n, new RegExp(`Containing: ${LEFT_OPEN}`));
  assert.ok(!RAW.test(page(doc)), "an exception reached the knockout page");
  assert.match(page(doc), new RegExp(`title="${LEFT_OPEN}"`), "the not-available cell carries the reader's line");
});

test("a provider's own refusal reads as the timeout line when it timed out, and as the open line otherwise", async (t) => {
  const doc = await count(async (_term, p) => (p.key === "identical"
    ? { ok: false, total: null, reason: "HTTP 503 upstream connect error or disconnect/reset before headers" }
    : { ok: false, total: null, reason: "request timed out after 90s" }));
  const { notes: n, cells } = await notes(doc, t);
  assert.ok(!cells.some((c) => RAW.test(c)), "the provider's words reached the workbook");
  assert.match(n, new RegExp(`Identical: ${LEFT_OPEN}`));
  assert.match(n, new RegExp(`Containing: ${TIMED_OUT}`));
});

test("the two lines the counter writes for a reader stay, without the causes that follow them", async (t) => {
  const registerCounts = { schema: 2, provider: "corsearch", providerLabel: "Corsearch", scope: { regions: [] }, marks: [{ name: NAME, classes: [9],
    counts: {
      identical: { total: 3 },
      containing: { total: null, unavailable: `no close-variation forms could be generated from "${NAME}" — the name has no near-form under any rule in the table, so there was nothing to count` },
      close: { total: null, forms: [], generated: 4, counted: 2,
        unavailable: "2 of 4 variant form(s) could not be counted, so the total would understate — LANTERNWIK: count threw: socket hang up · LANTERNWYCK: HTTP 503" },
    } }] };
  const { notes: n, cells } = await notes(registerCounts, t);
  assert.ok(!cells.some((c) => RAW.test(c)), "a form's raw cause reached the workbook");
  assert.match(n, /Containing: no close-variation forms could be generated from "LANTERNWICK"/);
  assert.match(n, /Close variations: 2 of 4 variant form\(s\) could not be counted, so the total would understate(?: ·|$)/);
});

test("THE CONTROL: counts that landed print figures and no note", async (t) => {
  const doc = await count(async () => ({ ok: true, total: 7 }));
  const { notes: n } = await notes(doc, t);
  assert.equal(n, "", "a count that landed owes no note");
  assert.doesNotMatch(page(doc), /not available/);
});
