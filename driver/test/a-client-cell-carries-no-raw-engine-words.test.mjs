// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLIENT CELL CARRIES NO RAW ENGINE WORDS. Three cells a client reads printed the engine's own text: the
// knockout Audit Trail row of a web search that failed ("PERPLEXITY_API_KEY absent from driver env",
// "executor threw: …"), the knockout's Register Counts note when the close-variation cap was unusable (the
// setting's name and its raw value, "NaN" included), and the clearance workbook's Machine QC row when the
// checks themselves threw ("gate-evaluation-error: <the exception>"). Each cell now carries the line the
// product already prints for that case, and the raw cause stays in the run's record, where it was written.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKnockoutWorkbook } from "../publish/knockout.mjs";
import { buildAudit } from "../publish/xlsx.mjs";
import { gateCouldNotEvaluate } from "../publish/index.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";

const LEFT_OPEN = plainDeferralReason("unfinished");
const TIMED_OUT = plainDeferralReason("mechanical-fail:timeout");
const FINDINGS = { marks: [{ name: "LANTERNWICK", findings: [] }] };

async function workbookRows(path) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sheet = (name) => {
    const ws = wb.getWorksheet(name);
    if (!ws) return null;
    const head = ws.getRow(1).values.slice(1);
    const rows = [];
    ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(head.map((h, i) => [h, String(row.values[i + 1] ?? "")]))); });
    return rows;
  };
  const cells = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.values.slice(1).forEach((v) => cells.push(String(v ?? "")))));
  return { sheet, cells };
}

function tempBook(t, name) {
  const dir = mkdtempSync(join(tmpdir(), "raw-engine-words-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, name);
}

test("a knockout web search that failed prints the reader's line on its Audit Trail row, never its raw cause", async (t) => {
  const out = tempBook(t, "knockout-audit.xlsx");
  const receipts = [
    { mark: "LANTERNWICK", callNo: 1, preset: "pro-search", executor: "perplexity", ok: false, cause: "PERPLEXITY_API_KEY absent from driver env", took_ms: 1000 },
    { mark: "LANTERNWICK", callNo: 2, preset: "pro-search", executor: "perplexity", ok: false, cause: "executor threw: request timed out after 90s", took_ms: 90000 },
    { mark: "LANTERNWICK", callNo: 3, preset: "pro-search", executor: "perplexity", ok: true, bytes: 10, took_ms: 2000 },
  ];
  await buildKnockoutWorkbook(FINDINGS, receipts, out);
  const { sheet, cells } = await workbookRows(out);
  const trail = sheet("Audit Trail");
  assert.deepEqual(trail.map((r) => r["Result Summary"]), [`FAILED — ${LEFT_OPEN}`, `FAILED — ${TIMED_OUT}`, "ok — 10 bytes"]);
  assert.deepEqual(trail.map((r) => r["OK/Degraded"]), ["Degraded", "Degraded", "OK"], "the rows keep their state");
  assert.ok(!cells.some((c) => /API_KEY|driver env|executor threw/.test(c)), "a raw cause reached a reader's cell");
});

test("an unusable close-variation cap leaves the setting's name out of the Register Counts note", async (t) => {
  const out = tempBook(t, "knockout-audit.xlsx");
  // The counts record as the count lane writes it for a cap that cut every form: the reader's line in
  // `unavailable`, and the configuration fault with the setting to fix in `cause`.
  const registerCounts = { schema: 2, provider: "signa", providerLabel: "Signa", scope: { regions: [] }, marks: [{ name: "LANTERNWICK", classes: [4],
    counts: {
      identical: { total: 3 }, containing: { total: 5 },
      close: { total: null, forms: [], generated: 7, counted: 0, unavailable: LEFT_OPEN,
        cause: "the close-variation form cap is set to NaN, which admits no forms. Check CLEAROTRON_KNOCKOUT_VARIANT_CAP; this is a configuration fault, not a property of the name" },
    } }] };
  await buildKnockoutWorkbook(FINDINGS, [], out, registerCounts);
  const { sheet, cells } = await workbookRows(out);
  const [row] = sheet("Register Counts");
  assert.equal(row["Notes"], `Close variations: ${LEFT_OPEN}`);
  assert.ok(!cells.some((c) => /CLEAROTRON_|\bNaN\b|configuration fault/.test(c)), "the setting or its raw value reached a reader's cell");
});

test("checks that could not be evaluated leave the exception out of the Machine QC row, and keep it for the record", async (t) => {
  const gate = gateCouldNotEvaluate(new TypeError("Cannot read properties of undefined (reading 'axes')"), []);
  assert.deepEqual(gate.reasons, [], "nothing was judged, so no reason is given");
  assert.deepEqual(gate.reasonCodes, ["gate-evaluation-error"], "the stable code still rides along");
  assert.match(gate.evaluationError, /Cannot read properties of undefined/, "the exception is kept for the run's record");
  const out = tempBook(t, "audit.xlsx");
  await buildAudit({ findings: [], coverage: [], clientGate: gate }, null, out, "LANTERNWICK", { title: "LANTERNWICK" });
  const { sheet, cells } = await workbookRows(out);
  const qc = sheet("Summary").find((r) => /Machine QC/.test(r["Field"]));
  assert.ok(qc, "no Machine QC row on the Summary");
  assert.match(qc["Value"], /the checks could not be evaluated/);
  assert.ok(!cells.some((c) => /gate-evaluation-error|Cannot read properties/.test(c)), "the exception reached a reader's cell");
});

test("THE CONTROL: a check that did fail keeps its own line on the Machine QC row", async (t) => {
  const out = tempBook(t, "audit.xlsx");
  const gate = { released: false, reasons: ["The findings table does not add up to the headline figure."], reasonCodes: ["arithmetic"] };
  await buildAudit({ findings: [], coverage: [], clientGate: gate }, null, out, "LANTERNWICK", { title: "LANTERNWICK" });
  const { sheet } = await workbookRows(out);
  const qc = sheet("Summary").find((r) => /Machine QC/.test(r["Field"]));
  assert.match(qc["Value"], /1 machine check\(s\) failed at publish/);
  assert.match(qc["Value"], /The findings table does not add up to the headline figure\./);
});
