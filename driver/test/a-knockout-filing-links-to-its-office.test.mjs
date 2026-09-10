// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A knockout searched on a register with no record pages of its own gives each listed filing the trade
// mark office's own page, or the office and the number and why it is not a link. It never shows the
// engine's handle for a filing that has a number, and every filing keeps its owner, classes and filing date.
//
// The register these arms model hands its search rows over under its own key names. The listing read none
// of them, so every filing reached the report with no owner, no classes and no filing date, and its record
// cell showed the handle `/mark/<office>/<id>`: the vendor's id, which a reader can look up nowhere.
//
// One vendor answer drives every arm below, through the provider's real adapter, the real listing and the
// real publisher, so no arm can pass on a shape the adapter would never produce. What the arms hold:
//   - the listing keeps each filing's owner, classes, filing date and office numbers, and a failed search
//     keeps its reason;
//   - the appendix row and the register card carry the office's link, or the office and the number; the
//     handle appears nowhere for a filing with a number; the reason is said once per office, under the
//     filings;
//   - the workbook's Record cell carries the same link or number with the reason in Note, report-data.json
//     carries the same, and meta.json the tally;
//   - a filing with no office number renders as before, every other register renders byte for byte as
//     before, and a link already on the sidecar is never what the report shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

// Pinned BEFORE the publish import: driver.config reads env at module load, and its pool root's default is
// the real archive. The run's register is read from its own sidecar, never from this deployment's setting,
// so the setting names a different register.
const ROOT = mkdtempSync(join(tmpdir(), "ko-office-record-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");

const { publishKnockout } = await import("../publish/knockout.mjs");
const { PROVIDERS } = await import("../driver.config.mjs");
const { RECORD_BASIS, listRegisterRecords, resolveRecordExecutor } = await import("../register-records.mjs");
const { officeRecordLink, reasonCellFor } = await import("../publish/office-record-links.mjs");
const { kebab } = await import("../stages-knockout.mjs");

const MARK = "KURENA";

// The vendor's own search answer: full records, the numbers in the vendor's own published form.
const row = (id, jurisdiction, owner, numbers) => ({
  id, jurisdiction_code: jurisdiction, mark_text: MARK, owner_name: owner,
  owners: [{ name: owner, country_code: jurisdiction }],
  classifications: [{ nice_class: 9 }, { nice_class: 42 }],
  status: { primary: "active", stage: "registered" },
  filing_date: "2021-03-04", registration_date: "2021-09-01",
  application_number: null, registration_number: null, ir_number: null, filing_route: "direct_national",
  ...numbers,
});
const VENDOR_ROWS = [
  row("tm_0001", "CH", "Kurena SA", { application_number: "12345/2020", registration_number: "7634210" }),
  row("tm_0002", "SG", "Kurena Pte Ltd", { application_number: "40202012345Y", registration_number: "40202012345Y" }),
  row("tm_0003", "CH", "Kurena Holding AG", { filing_route: "madrid_designation", ir_number: "1543782", registration_number: "1543782" }),
  row("tm_0004", "GB", "Kurena Ltd", {}),
];
const ANSWER = { data: VENDOR_ROWS, pagination: { total_count: VENDOR_ROWS.length, total_count_approximate: false, has_more: false } };
const HANDLE = { ch: "/mark/ch/tm_0001", sg: "/mark/sg/tm_0002", wo: "/mark/ch/tm_0003", none: "/mark/gb/tm_0004" };

/** The listing, taken through Signa's own adapter against a stand-in vendor answering `status` with `body`. */
async function listOnSigna(status, body) {
  const realFetch = globalThis.fetch;
  const calls = [];
  process.env.SIGNA_API_KEY = "fixture-key";
  process.env.SIGNA_BASE_URL = "https://signa.test";
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  try {
    const exec = resolveRecordExecutor({ adapter: PROVIDERS.signa });
    assert.equal(exec.source, "provider", "the listing reached Signa's own adapter");
    const doc = await listRegisterRecords({
      marks: [{ name: MARK, classes: [9] }], provider: "signa", capabilities: { id: "signa" }, lister: exec.list,
    });
    assert.ok(calls.length >= 1 && calls.every((u) => u.startsWith("https://signa.test/")), "every search went to the stand-in vendor");
    return doc;
  } finally {
    globalThis.fetch = realFetch;
  }
}

const LISTING = await listOnSigna(200, ANSWER);

test("the listing keeps each Signa filing's owner, classes, filing date and office numbers", () => {
  const records = LISTING.marks[0].records;
  assert.equal(records.length, VENDOR_ROWS.length, "every filing the vendor answered is listed");
  const ch = records.find((r) => r.recordId === HANDLE.ch);
  assert.ok(ch, "the Swiss filing is listed under its handle");
  assert.deepEqual(
    [ch.owner, ch.ownerCountry, ch.classes, ch.applicationDate, ch.registrationDate, ch.status, ch.territory],
    ["Kurena SA", "CH", [9, 42], "2021-03-04", "2021-09-01", "registered", "ch"]);
  assert.deepEqual([ch.applicationNumber, ch.registrationNumber, ch.irNumber, ch.filingRoute], ["12345/2020", "7634210", null, "direct_national"]);
  const ir = records.find((r) => r.recordId === HANDLE.wo);
  assert.deepEqual([ir.filingRoute, ir.irNumber], ["madrid_designation", "1543782"]);
  const bare = records.find((r) => r.recordId === HANDLE.none);
  assert.deepEqual([bare.applicationNumber, bare.registrationNumber, bare.irNumber], [null, null, null]);
});

test("a Signa search that fails keeps its reason in the listing", async () => {
  const doc = await listOnSigna(429, { error: { detail: "rate limited" } });
  const failed = doc.marks[0].terms.filter((t) => !t.ok);
  assert.ok(failed.length >= 1 && failed.length === doc.marks[0].terms.length, "every search is recorded as failed");
  for (const t of failed) assert.match(t.reason, /signa_search HTTP 429: rate limited/, `the reason reached the listing: ${t.reason}`);
});

const FRAMEWORK = { framework_key: "house-triage", title: "t", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Medium", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };
const EVIDENCE = "https://storefront.invalid/listing/kurena";
const FINDINGS = {
  marks: [{
    name: MARK, rating: "Medium", bullets: ["Synthetic fixture."],
    findings: [{
      ordinal: 1, name: "Look-alike listing", owner: "Kurena SA", band: "Medium",
      net: "A listing under a closely similar name is live on a marketplace.", type: "Active Business", evidence: [EVIDENCE],
    }],
  }],
};

const cell = (v) => (v == null ? "" : typeof v === "object" ? String(v.text ?? v.hyperlink ?? "") : String(v));

/** The workbook's filing rows, keyed by the sheet's own header row. */
function filingRows(wb) {
  const sheet = wb.getWorksheet("Register Filings");
  assert.ok(sheet, `the workbook carries no Register Filings sheet: ${wb.worksheets.map((ws) => ws.name).join(", ")}`);
  const header = sheet.getRow(1).values;
  const rows = [];
  sheet.eachRow((r, n) => { if (n > 1) rows.push(Object.fromEntries(header.map((h, i) => [h, cell(r.values[i])]).filter(([h]) => h))); });
  return rows;
}

/** Publish `doc` as a run's own sidecar and return what the run delivered. */
async function publish(doc, runId = `ko-office-record-${Math.random().toString(36).slice(2, 8)}`) {
  const runDir = mkdtempSync(join(ROOT, "run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  mkdirSync(join(runDir, "research"), { recursive: true });
  writeFileSync(driverDir(runDir, "framework.json"), JSON.stringify(FRAMEWORK));
  // The receipts door refuses a publish whose citations cannot be traced to the run's own payloads.
  writeFileSync(join(runDir, "research", `${kebab(MARK)}.md`), `# captured research payload (fixture)\n\n${EVIDENCE}\n`);
  writeFileSync(driverDir(runDir, "register-records.json"), JSON.stringify(doc));
  const poolRoot = mkdtempSync(join(ROOT, "pool-"));
  await publishKnockout({
    runId, codename: "fixture", runDir, findings: FINDINGS, framework: FRAMEWORK, overall: "Medium",
    poolRoot, poolUrl: "https://trademark.test", customerKey: "generic", skipRegen: true,
  });
  const dir = join(poolRoot, runId);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(dir, "knockout-audit-fixture.xlsx"));
  return {
    html: readFileSync(join(dir, "report.html"), "utf8"),
    data: JSON.parse(readFileSync(join(dir, "report-data.json"), "utf8")),
    meta: JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")),
    filings: filingRows(wb),
  };
}

const NUMBER_KEYS = ["applicationNumber", "registrationNumber", "irNumber", "filingRoute"];
/** The same listing as one taken before the numbers were kept. */
const withoutNumbers = (doc) => {
  const out = structuredClone(doc);
  out.marks[0].records = out.marks[0].records.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !NUMBER_KEYS.includes(k))));
  return out;
};

const CH = officeRecordLink({ applicationNumber: "12345/2020", registrationNumber: "7634210", filingRoute: "direct_national" }, HANDLE.ch);
const SG = officeRecordLink({ applicationNumber: "40202012345Y", registrationNumber: "40202012345Y" }, HANDLE.sg);
const WO = officeRecordLink({ filingRoute: "madrid_designation", irNumber: "1543782", registrationNumber: "1543782" }, HANDLE.wo);
const anchor = (l) => `<a href="${l.href.replace(/&/g, "&amp;")}" target="_blank" rel="noopener noreferrer">${l.label}</a>`;
const count = (s, sub) => s.split(sub).length - 1;
const LINKED = "A registration number shown as a link opens the office’s own page for that record.";
const SINGAPORE = "Singapore: the register publishes no page for a single record, so its registrations are cited by number.";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SIGNA = await publish(structuredClone(LISTING));

test("precondition: a linked Swiss number, a linked Madrid designation, and a Singapore number with no page", () => {
  assert.ok(CH.href && WO.href && WO.office === "wo", "the Swiss and the Madrid filings have addresses");
  assert.deepEqual([SG.href, SG.reason, SG.label], [null, "no-page", "SG 40202012345Y"]);
});

test("the appendix and the cards carry the office's page, or the office and the number, never the handle", () => {
  const { html } = SIGNA;
  assert.equal(count(html, anchor(CH)), 2, "the Swiss filing links to the office's page in the appendix and on its card");
  assert.equal(count(html, anchor(WO)), 2, "the Madrid designation links to WIPO in the appendix and on its card");
  assert.ok(html.includes(`<td class="ko-findev">${SG.label}</td>`), "the Singapore row cites its number");
  assert.ok(html.includes(`Register record: ${SG.label}</p>`), "the Singapore card cites its number");
  for (const h of [HANDLE.ch, HANDLE.sg, HANDLE.wo]) assert.ok(!html.includes(h), `the handle ${h} reached the report`);
  assert.ok(html.includes(`<td class="ko-findev">${HANDLE.none}</td>`), "a filing with no office number shows as before");
});

test("the filings show their owner, classes and filing date", () => {
  const { html, filings } = SIGNA;
  assert.ok(html.includes("<td>Kurena SA</td>") && html.includes("<td>9, 42</td>"), "the appendix row carries the owner and classes");
  const ch = filings.find((r) => r.Owner === "Kurena SA");
  assert.deepEqual([ch.Classes, ch.Filed, ch.Registered], ["9, 42", "2021-03-04", "2021-09-01"]);
});

test("under the filings, once: what a linked number opens, and why Singapore's is cited by number", () => {
  const { html } = SIGNA;
  assert.equal(count(html, LINKED), 1);
  assert.equal(count(html, SINGAPORE), 1);
  assert.ok(html.includes(`<p class="ko-basis">${esc(RECORD_BASIS)} ${LINKED} ${SINGAPORE}</p>`), "the sentences sit under the filings");
});

test("the workbook's Record cell carries the same link or number, with the reason in Note", () => {
  const by = Object.fromEntries(SIGNA.filings.map((r) => [r.Owner, r]));
  assert.deepEqual([by["Kurena SA"].Record, by["Kurena SA"].Note], [CH.href, ""]);
  assert.deepEqual([by["Kurena Pte Ltd"].Record, by["Kurena Pte Ltd"].Note], [SG.label, reasonCellFor(SG)]);
  assert.deepEqual([by["Kurena Holding AG"].Record, by["Kurena Holding AG"].Note], [WO.href, ""]);
  assert.deepEqual([by["Kurena Ltd"].Record, by["Kurena Ltd"].Note], [HANDLE.none, ""]);
});

test("report-data.json carries the same, and meta.json the tally", () => {
  const records = SIGNA.data.marks[0].registerFilings.records;
  const of = (id) => records.find((r) => r.recordId === id);
  assert.deepEqual(of(HANDLE.ch).officeRecord, { label: CH.label, href: CH.href, reason: null });
  assert.deepEqual(of(HANDLE.wo).officeRecord, { label: WO.label, href: WO.href, reason: null });
  assert.deepEqual(of(HANDLE.sg).officeRecord, { label: SG.label, href: null, reason: "no-page" });
  assert.ok(!("officeRecord" in of(HANDLE.none)), "a filing with no office number carries none");
  assert.deepEqual(SIGNA.meta.recordLinks, { linked: { ch: 1, wo: 1 }, cited: { sg: { "no-page": 1 } }, noNumber: 1 });
});

test("a Signa listing taken before the numbers were kept renders its filings as before", async () => {
  const { html, data, meta, filings } = await publish(withoutNumbers(LISTING));
  for (const h of Object.values(HANDLE)) assert.ok(html.includes(`<td class="ko-findev">${h}</td>`), `${h} shows as before`);
  assert.ok(html.includes(`<p class="ko-basis">${esc(RECORD_BASIS)}</p>`), "nothing is added under the filings");
  assert.ok(!html.includes(CH.href) && !html.includes(LINKED), "no office link on a listing with no numbers");
  assert.ok(data.marks[0].registerFilings.records.every((r) => !("officeRecord" in r)));
  assert.deepEqual(filings.map((r) => r.Record).sort(), Object.values(HANDLE).sort());
  assert.deepEqual(meta.recordLinks, { linked: {}, cited: {}, noNumber: 4 });
});

test("on any other register the filings render byte for byte as before, with no office link", async () => {
  const other = (doc) => ({ ...doc, provider: "clarivate", providerLabel: "Clarivate" });
  const kept = await publish(other(structuredClone(LISTING)), "ko-office-record-other");
  const before = await publish(other(withoutNumbers(LISTING)), "ko-office-record-other");
  assert.ok(kept.html.includes(`<td class="ko-findev">${HANDLE.ch}</td>`), "the filing shows by its handle, as before");
  assert.equal(kept.html, before.html, "the office numbers changed another register's report");
  assert.deepEqual(kept.data, before.data, "the office numbers changed another register's report-data.json");
  assert.deepEqual(kept.filings, before.filings, "the office numbers changed another register's workbook");
  assert.equal(kept.meta.recordLinks, undefined);
});

test("an office link already on the sidecar is never what the report shows", async () => {
  const planted = { office: "ch", label: "CH 99999/2020", href: "https://planted.invalid/record", reason: null };
  const other = { ...structuredClone(LISTING), provider: "clarivate" };
  other.marks[0].records = other.marks[0].records.map((r) => ({ ...r, officeLink: planted }));
  const signa = structuredClone(LISTING);
  signa.marks[0].records = signa.marks[0].records.map((r) => (r.recordId === HANDLE.none ? { ...r, officeLink: planted } : r));
  const outs = [await publish(other), await publish(signa)];
  for (const { html, filings } of outs) {
    assert.ok(!html.includes("planted.invalid") && !html.includes(planted.label), "a planted link reached the report");
    assert.ok(!filings.some((r) => r.Record.includes("planted.invalid")), "a planted link reached the workbook");
  }
});
