// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A knockout's rater is handed each mark's pages as a list, and every page and every filing it does not
// carry leaves with a ground: in a finding, a read or an absence, or in the mark's `setAside`. The list it
// is handed is the list the hand-off count reads, the record tool and its allowlist take the new rows,
// and the rows reach the audit workbook's Working Notes, never the report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir, ensureDriverDir } from "../../shared/driver-dir.mjs";
import { KO_STAGES, koPaths, knockoutPageListLines } from "../stages-knockout.mjs";
import { kebab } from "../search-policy.mjs";
import { payloadPages } from "../hand-off-exits.mjs";
import { setAsideNote } from "../publish/knockout.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SENTENCE_6 = "Judge an owner's records as a set. Write the position from the record in the client's market and class, quoting its goods. A record you do not carry is given a ground; no record leaves without one.";
const PAYLOAD = "## Findings\n- **Near** — https://apps.example.org/app/7 — a game.\n## Sources\n- https://dict.example/word/near\n";

function runWithResearch() {
  const runDir = mkdtempSync(join(tmpdir(), "ko-set-aside-"));
  const K = koPaths(runDir);
  mkdirSync(K.researchDir, { recursive: true });
  writeFileSync(K.research(kebab("NEARFIELD")), PAYLOAD);
  ensureDriverDir(runDir);
  writeFileSync(K.registerRecords, JSON.stringify({ marks: [{ name: "NEARFIELD", records: [
    { recordId: "R-1", mark: "NEARFIELD", owner: "Paper Goods KK" },
  ] }] }));
  return { runDir, K };
}

test("each mark's pages are printed as the list the hand-off count reads", () => {
  const { runDir, K } = runWithResearch();
  try {
    const lines = knockoutPageListLines(K, [{ name: "NEARFIELD" }, { name: "NO PAYLOAD" }]);
    assert.match(lines[0], /^EACH MARK'S PAGES — every address its research names, as the engine reads them\. /);
    assert.deepEqual(lines.slice(1), ["- NEARFIELD:", ...payloadPages(PAYLOAD).map((p) => `  ${p.url}`)],
      "the rater's list and the count's list are one derivation");
    assert.deepEqual(knockoutPageListLines(K, [{ name: "NO PAYLOAD" }]), [], "no page at all, no block");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the assessment's instructions carry the page list and the set-aside rule for filings", () => {
  const { runDir, K } = runWithResearch();
  try {
    const text = String(KO_STAGES["knockout-assess"].message({
      K, chunkNo: 0, chunkMarks: [{ name: "NEARFIELD" }], chunkTotal: 1, probeNote: "",
      framework: { bands: [{ label: "High" }, { label: "Manageable" }] }, frameworkPath: null,
    }));
    assert.ok(text.includes("EACH MARK'S PAGES —"), "the page list is in the dispatch");
    assert.ok(text.indexOf("EACH MARK'S PAGES —") > text.indexOf("Each mark's RAW research payload"), "it follows each mark's research file");
    assert.ok(text.includes("  https://apps.example.org/app/7"));
    assert.ok(text.includes(`Both are optional for a filing you weighed, and both are joined against the filings you were given, so an id we do not hold is refused by name. A filing you did not weigh gets no read — do not invent one, and never write "not weighed" as a read — and goes in "setAside" with its ground instead.`));
    assert.ok(text.includes(`"setAside" also takes {recordId, ground} for a filing above that no finding weighs and no registerReads row reads. "ground" is one line in your own words on why it does not earn a finding. It goes to the audit workbook, never the report.`));
    assert.doesNotMatch(text, /simply gets no row/, "the line sentence 6 contradicts is gone");
  } finally { rmSync(runDir, { recursive: true, force: true }); }
});

test("the manual carries sentence 6 once, closing step 5, and the set-aside contract", () => {
  const md = readFileSync(join(DRIVER, "skills", "knockout-assess", "SKILL.md"), "utf8");
  assert.equal(md.split(SENTENCE_6).length - 1, 1, "sentence 6, character for character, once");
  const at = md.indexOf(SENTENCE_6);
  assert.ok(at > md.indexOf("5. **`findings[]`") && at < md.indexOf("6. **RETIRED"), "it closes step 5");
  assert.doesNotMatch(md, /omitting them is always safe|simply gets no row/);
  assert.ok(md.includes("**Both are optional for a filing you weighed.**"));
  assert.ok(md.includes(`"setAside": [ { "page": "…", "ground": "…" }, { "recordId": "…", "ground": "…" } ],`));
  assert.ok(md.includes("**`setAside` — what you read and did not carry, each with its ground.**"));
  const placement = readFileSync(join(DRIVER, "skills", "placement-inquiry", "SKILL.md"), "utf8");
  assert.equal(placement.split(SENTENCE_6).length - 1, 1, "and once in the placement manual");
});

test("the record tool declares the list, and the allowlist the driver validates against takes its three keys", () => {
  const server = readFileSync(join(DRIVER, "engine", "mcp", "recording-server.mjs"), "utf8");
  assert.match(server, /setAside: \{\n\s+type: "array",\n\s+description: "Rows of \{ page, ground \} or \{ recordId, ground \}/);
  assert.match(server, /ground: \{ type: "string", description: "Why THIS page or filing does not earn a finding, in one line\." \}/);
  const record = readFileSync(join(DRIVER, "knockout-assess-record.mjs"), "utf8");
  assert.match(record, /"marks\.setAside": \["page", "recordId", "ground"\]/);
  assert.match(record, /\n\s+"setAside",\n\s+\],/, "the mark allowlist names the list");
});

test("a set-aside row prints as what was set aside, then the rater's ground", () => {
  const records = { marks: [{ name: "NEARFIELD", records: [{ recordId: "R-1", mark: "NEARFIELD", owner: "Paper Goods KK" }] }] };
  assert.equal(setAsideNote({ page: "https://dict.example/word/near", ground: "a dictionary entry, not a use" }, "NEARFIELD", records),
    "https://dict.example/word/near: a dictionary entry, not a use");
  assert.equal(setAsideNote({ recordId: "R-1", ground: "class 16 paper goods only" }, "nearfield", records),
    "NEARFIELD — Paper Goods KK: class 16 paper goods only");
  assert.equal(setAsideNote({ recordId: "R-8", ground: "not in the store" }, "NEARFIELD", records), "R-8: not in the store");
});

test("the knockout workbook prints each set-aside row on Working Notes, and a blank ground prints nothing", async () => {
  const { buildKnockoutWorkbook } = await import("../publish/knockout.mjs");
  const { default: ExcelJS } = await import("exceljs");
  const dir = mkdtempSync(join(tmpdir(), "ko-set-aside-book-"));
  try {
    const book = join(dir, "audit.xlsx");
    const findings = { marks: [{ name: "NEARFIELD", findings: [], negatives: [], setAside: [
      { page: "https://dict.example/word/near", ground: "a dictionary entry, not a use" },
      { recordId: "R-1", ground: "class 16 paper goods only" },
      { recordId: "R-2", ground: "" },
    ] }] };
    const records = { marks: [{ name: "NEARFIELD", records: [{ recordId: "R-1", mark: "NEARFIELD", owner: "Paper Goods KK" }] }] };
    await buildKnockoutWorkbook(findings, [], book, null, [], null, records);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(book);
    const ws = wb.getWorksheet("Working Notes");
    const rows = [];
    ws.eachRow((r, n) => { if (n > 1) rows.push(r.values.slice(1).map((v) => String(v ?? ""))); });
    assert.deepEqual(rows, [
      ["NEARFIELD", "Set aside", "https://dict.example/word/near: a dictionary entry, not a use"],
      ["NEARFIELD", "Set aside", "NEARFIELD — Paper Goods KK: class 16 paper goods only"],
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
