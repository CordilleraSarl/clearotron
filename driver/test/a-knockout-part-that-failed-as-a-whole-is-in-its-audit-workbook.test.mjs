// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT PART THAT FAILED AS A WHOLE IS IN ITS AUDIT WORKBOOK (ruled 2026-09-25, 520, 537 and 539).
// The filings listing, the owner lookups, the plain-language review, the machine checks and the request's
// own record can each fail without stopping the knockout, and each used to leave nothing in the workbook
// that said so. A web search whose answer reached the report and whose trail entry was never written read
// as a search that never ran, and a filing whose link was removed gave no reason. Each is now a row in the
// workbook's own columns and words, and the report is as it was. The first arms drive the knockout lane
// itself with the failure planted; the rest hand the workbook builder each part directly.
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-whole-steps-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AGENT = "clawdi";
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { buildKnockoutWorkbook } = await import("../publish/knockout.mjs");
const { RULED_WORDS, linkNotOnRegisterSite } = await import("../degraded-parts.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const OWNER_QUESTION = /What goods or services does the company "Brightmoor Candle Co"/;
const LEFT_OPEN = "it could not be completed this run, so it is left open here rather than reported as clean";

async function readSheets(path) {
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
  return { trail: sheet("Audit Trail"), filings: sheet("Register Filings") };
}

/** One knockout through the lane, with `plant` run on its run directory first; the workbook it published. */
async function knockout(codename, { plant = () => {} } = {}) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-09-25-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  plant(dir);
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-09-25", codename, archiveDir: join(studioRoot, "archive", `2026-09-25-${codename}`) };
  const job = { id, markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "clawdi", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const res = await knockoutInner(ctx, job, {
    recordLister: async (term) => ({ ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }),
    countExecutor: async () => ({ ok: true, total: 3 }),
    gridExecutor: async (spec) => answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]),
    sweepExecutor: async () => ({ ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" }),
  });
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  const book = readdirSync(join(ROOT, "pool"), { recursive: true }).find((p) => String(p).endsWith(`knockout-audit-${codename}.xlsx`));
  assert.ok(book, "the knockout published no workbook");
  return readSheets(join(ROOT, "pool", book));
}

test("the filings listing that failed as a whole is `not available` for each name, with the reader's line", async () => {
  // A folder where the listing's record goes: the write fails, which is the step failing as a whole. (A
  // search that fails for one name is not this: the listing records it on that name's own row.)
  const { filings } = await knockout("listing-failed", { plant: (dir) => mkdirSync(driverDir(dir, "register-records.json")) });
  assert.ok(filings, "no Register Filings sheet: the failed listing left nothing");
  assert.deepEqual(filings.map((r) => [r["Mark"], r["Trademark"], r["Note"]]), [["LANTERNWICK", "not available", LEFT_OPEN]]);
  assert.ok(!/EISDIR|illegal operation/i.test(JSON.stringify(filings)), "the raw cause reached a reader's cell");
});

test("owner lookups that failed as a whole are each a Degraded row with the lookup's own query", async () => {
  // A folder where the lookups' record goes: the write fails, which is the step failing as a whole.
  const { trail } = await knockout("owners-failed", { plant: (dir) => mkdirSync(driverDir(dir, "owner-checks.json")) });
  const row = trail.find((r) => OWNER_QUESTION.test(r["Search Term"]));
  assert.ok(row, `no trail row for the owner lookup: ${JSON.stringify(trail)}`);
  assert.equal(row["OK/Degraded"], "Degraded");
  assert.equal(row["Result Summary"], `FAILED — ${LEFT_OPEN}`);
});

test("a web search whose trail entry was never written says its record was not kept, never that it failed", async () => {
  // A folder where the trail goes: every entry's write fails, and the searches still answer.
  const { trail } = await knockout("trail-lost", { plant: (dir) => mkdirSync(driverDir(dir, "knockout-sweep.jsonl")) });
  const row = trail.find((r) => r["Result Summary"] === RULED_WORDS.recordNotKept);
  assert.ok(row, `no row for the search whose record was not kept: ${JSON.stringify(trail)}`);
  assert.deepEqual([row["Mark"], row["Search Term"], row["OK/Degraded"]], ["LANTERNWICK", "—", "Degraded"]);
  assert.match(row["Source / Context"], /^perplexity \(.+\)$/);
});

test("THE CONTROL: a knockout whose steps all ran builds the workbook it built before", async () => {
  const { trail, filings } = await knockout("all-ran");
  assert.ok(trail.length > 0 && trail.every((r) => r["OK/Degraded"] === "OK"), `the trail is not the clean run's: ${JSON.stringify(trail)}`);
  assert.ok(filings.every((r) => r["Trademark"] !== "not available"), `the clean listing reads not available: ${JSON.stringify(filings)}`);
});

// ── The workbook builder, handed each part directly ──────────────────────────────────────────────────

const FINDINGS = { marks: [{ name: "LANTERNWICK", findings: [] }] };
async function book(degraded, registerRecords = null) {
  const out = join(mkdtempSync(join(ROOT, "book-")), "audit.xlsx");
  await buildKnockoutWorkbook(FINDINGS, [], out, null, [], null, registerRecords, null, [], degraded);
  return readSheets(out);
}

test("the review, the machine checks and the request's record are each one row, in the ruled words", async () => {
  const { trail } = await book({ review: { reason: "unfinished" }, machineChecks: { reason: "unfinished" }, aboutThisRequest: { reason: "unfinished" } });
  assert.deepEqual(trail.map((r) => [r["Mark"], r["Search Term"], r["Source / Context"], r["Result Summary"], r["Finding Reference"], r["Sweep Call #"], r["Wall-time (s)"], r["OK/Degraded"]]), [
    ["—", "—", "Plain-language review", `FAILED — ${LEFT_OPEN}`, "—", "—", "—", "Degraded"],
    ["—", "—", "Machine Checks", `FAILED — ${LEFT_OPEN}`, "—", "—", "—", "Degraded"],
    ["—", "—", "About this request", `FAILED — ${LEFT_OPEN}`, "—", "—", "—", "Degraded"],
  ]);
});

test("a filing whose link was removed keeps its number and says why; a filing whose link stands says nothing", async () => {
  const records = { provider: "signa", providerLabel: "Signa", marks: [{ name: "LANTERNWICK", terms: [], records: [
    { recordId: "EM-1", mark: "LANTERNWICK", owner: "Brightmoor Candle Co", status: "Registered", classes: [4], url: null },
    { recordId: "EM-2", mark: "LANTERNWICK", owner: "Brightmoor Candle Co", status: "Registered", classes: [4], url: null },
  ] }] };
  const { filings } = await book({ droppedLinks: [{ mark: "LANTERNWICK", recordId: "EM-1", was: "https://elsewhere.example/1" }] }, records);
  const note = (id) => filings.find((r) => r["Record"] === id)?.["Note"];
  assert.equal(note("EM-1"), linkNotOnRegisterSite("Signa"));
  assert.equal(note("EM-2"), "", "a filing whose link was not removed gained a note");
  // A listing that recorded no label for its register is left as delivered: a setting's id is no name.
  const { providerLabel, ...unlabelled } = records;
  const old = await book({ droppedLinks: [{ mark: "LANTERNWICK", recordId: "EM-1", was: "https://elsewhere.example/1" }] }, unlabelled);
  // A sheet whose notes are all empty prints no Note column, so an absent cell is an empty note.
  assert.equal(old.filings.find((r) => r["Record"] === "EM-1")?.["Note"] ?? "", "", `the note named the register by its setting id (${providerLabel} was removed)`);
});

test("THE CONTROL: a workbook handed no failed part is the one it was before", async () => {
  const { trail, filings } = await book({});
  assert.deepEqual(trail, []);
  assert.equal(filings, null, "a knockout with no listing record grew a Register Filings sheet");
});
