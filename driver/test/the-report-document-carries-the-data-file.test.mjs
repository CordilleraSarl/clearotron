// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REPORT DOCUMENT CARRIES THE DATA FILE. Publishing writes the run's report as one JSON document
// (publish/report-document.mjs), which every surface is to read in place of its own route. The first proof
// that it holds what a surface needs: the data file built from the document, after the document has been
// written out and read back, is the data file publishing writes, byte for byte.
//
// SAFETY GUARD: the workspace is pinned before the driver's modules are imported, because the driver config
// freezes its roots at import.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", __mkdtemp(__join(__tmpdir(), "report-document-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", __mkdtemp(__join(__tmpdir(), "report-document-pool-default-")));
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { publishSource, demoChildren } = await import("../demo-container.mjs");
const { republishRun } = await import("../publish/report-registry.mjs");
const { readClearanceDocument, coverNoteInputs, composeCoverNote } = await import("../publish/index.mjs");
const { publishKnockout, readKnockoutDocument, composeKnockoutCoverNote, knockoutName } = await import("../publish/knockout.mjs");
const { worstBand } = await import("../verify-knockout.mjs");
const { CLEARANCE_DOCUMENT, KNOCKOUT_DOCUMENT, clearanceReportDocument, clearanceReportDataOf, knockoutReportDocument,
  knockoutReportDataOf, allFindingsOf, clearanceWorkbookOf } = await import("../publish/report-document.mjs");
const { clearanceReportData } = await import("../publish/report-data.mjs");
const { buildAudit } = await import("../publish/xlsx.mjs");
const { deliveryFlagLines } = await import("../predelivery-lint.mjs");
const { zipEntries, workbookEntryText } = await import("./snapshot/workbook-entries.mjs");
const { paths } = await import("../run-record.mjs");

/** The value as JSON would carry it: equal to itself only if it holds no Map, Set, Date, function or undefined. */
const throughJson = (v) => JSON.parse(JSON.stringify(v));

const copy = publishSource(join(ROOT, "demo"), { repoRoot: ROOT });
const clearances = demoChildren(copy)
  .map((name) => ({ name, dir: join(copy, name) }))
  .filter((s) => existsSync(join(s.dir, "run", "report.md")));

test("each demo's document is JSON as built, and the data file it carries is the one publishing writes", async () => {
  assert.equal(clearances.length, 3, `the demo container holds ${clearances.length} clearance(s)`);
  for (const { name, dir } of clearances) {
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    const runDir = join(dir, "run");
    const pool = mkdtempSync(join(tmpdir(), "report-document-pool-"));

    // Built in memory from what publishing reads, the document survives JSON whole: nothing in it is a Map, a
    // Set, a Date or undefined.
    const read = await readClearanceDocument({
      runId: meta.runId, reportMd: join(runDir, "report.md"), auditMd: join(runDir, "audit.md"),
      findingsJson: join(runDir, "findings.json"), poolRoot: pool, poolUrl: "", customerKey: "generic", runDir,
    });
    const built = clearanceReportDocument({ ...read, runId: meta.runId }, { codename: meta.codename, customerKey: "generic" });
    assert.deepStrictEqual(throughJson(built), built, `${name}: the document holds a value JSON does not carry`);
    assert.equal(built.document, CLEARANCE_DOCUMENT);
    assert.ok(built.client.findings.length > 0, `${name}: the document carries no finding, so the comparison below proves little`);

    // Published, the document is in the run's own record and not in the pool, and the data file built from it,
    // read back, is the pool's data file byte for byte.
    await republishRun({ runId: meta.runId, meta, pool, poolUrl: "", runDir });
    const written = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8"));
    assert.ok(!existsSync(join(pool, meta.runId, "report-document.json")), `${name}: the document reached the pool`);
    const dataFile = readFileSync(join(pool, meta.runId, "report-data.json"), "utf8");
    assert.equal(JSON.stringify(clearanceReportDataOf(written), null, 2), dataFile,
      `${name}: the data file built from the document is not the data file publishing wrote`);
  }
});

// An invented run with every state the demos do not reach: no verdict record, no framework, a stage label only
// the frozen policy knows, a withdrawn finding that is the only one an ask names, and the Maps and Sets publishing
// reads keyed by ordinal and by uri.
const finding = (ordinal, disposition, extra = {}) => ({
  ordinal, mark: `MARK ${ordinal}`, band: "Low", disposition, net: `The read of mark ${ordinal}.`,
  owner: { name: "Owner [internal] working note", country: "CH", registrations: [{ uri: `/mark/ch/${ordinal}`, classes: ["9"] }] },
  ...extra,
});
const invented = {
  runId: "tmpinvented-run", parsed: { fm: { matter: "", title: "An invented report", overall_caption: "" }, secs: { Summary: "One line." }, cards: [] },
  findings: [finding(1, "on-point"), finding(2, "withdrawn"), finding(3, "off-field", { off_field_ground: "goods" })],
  actionsRegister: [
    { id: "a1", kind: "consent", text: "Obtain consent from the owner of mark 1.", ordinals: [1] },
    { id: "a2", kind: "consent", text: "Obtain consent from the owner of mark 2.", ordinals: [2] },
    { id: "a3", kind: "monitoring", text: "Watch the register.", ordinals: [] },
  ],
  coverage: [{ area: "Register", state: "searched" }], contextNotes: [], askAnswers: [{ ask: "Who?", answer: "Nobody." }],
  verdictInfo: null, framework: null, stageLabel: undefined, frozenStageLabel: "Stage 1", searchPolicy: { level: "invented-level" },
  reportRoute: "/portal/report/tmpinvented-run", issued: "2026-01-15 · 13:00 CET", served: null, engineCommit: null,
  caseLawByOrdinal: new Map([[3, [{ case: "A v B" }]], [1, []]]),
  recordsByUri: new Map([["/mark/ch/3", { body: "large" }], ["/mark/ch/1", { body: "large" }]]),
  logos: new Map([["/mark/ch/1", { state: "fetched", src: "data:image/png;base64,AAAA" }]]),
  followUpKinds: new Map([["mark one exact", new Set(["primary-sweep", "owner-lookup"])]]), commonLawJoinedTerms: new Set(["ZETA", "ALPHA"]),
  officeLinks: { byUri: new Map([["/mark/ch/1", null]]), tally: { linked: {}, cited: {}, notRetrieved: 1 }, summary: "record not retrieved 1" },
  assessmentNotCompleted: true,
};

test("on an invented run, the data file built from the document read back is the data file publishing builds", () => {
  const doc = clearanceReportDocument(invented, { codename: "", customerKey: "", auditFile: null });
  assert.deepStrictEqual(throughJson(doc), doc, "the document holds a value JSON does not carry");
  // What publishReport hands the data file today, spelled as it spells it.
  const direct = clearanceReportData({
    runId: invented.runId, codename: "", matter: invented.parsed.fm.matter, markName: null, title: invented.parsed.fm.title,
    customerKey: "" || "generic", issued: invented.issued, url: invented.reportRoute, auditFile: null,
    searchLevel: invented.searchPolicy.level, stageLabel: invented.stageLabel ?? invented.frozenStageLabel ?? null,
    engineCommit: null, servedModels: null, framework: null, verdictInfo: null, findings: invented.findings,
    coverage: invented.coverage, contextNotes: invented.contextNotes, markAssessment: null, fourAnswers: null,
    askAnswers: invented.askAnswers, actions: invented.actionsRegister, jurisdiction: null, searchedJurisdictions: null,
    scopeBasis: null, caption: null, assessmentNotCompleted: true,
  });
  assert.equal(JSON.stringify(clearanceReportDataOf(throughJson(doc)), null, 2), JSON.stringify(direct, null, 2));
  // The cases the comparison would pass without, checked on their own.
  assert.equal(direct.level.stageLabel, "Stage 1", "the frozen stage label is the fallback");
  assert.deepEqual(direct.actions.conditions.map((a) => a.id), ["a1"], "an ask naming only a withdrawn finding is dropped");
  assert.deepEqual(doc.client.findings.map((f) => f.ordinal), [1, 3], "the client section holds a withdrawn finding");
  assert.deepEqual(doc.reviewer.withdrawn.map((w) => [w.at, w.finding.ordinal]), [[1, 2]]);
  // Maps keep their keys' type and order, and the record bodies and logo bytes stay where they are.
  assert.deepEqual(doc.client.caseLaw.byOrdinal.map(([k]) => k), [3, 1]);
  assert.deepEqual(doc.client.records, ["/mark/ch/3", "/mark/ch/1"]);
  assert.deepEqual(doc.client.logos, [["/mark/ch/1", "fetched"]]);
  assert.deepEqual(doc.reviewer.commonLawJoinedTerms, ["ZETA", "ALPHA"]);
  // A Set inside a Map's value keeps its members on disk: JSON alone writes it as {}.
  assert.deepEqual(throughJson(doc).client.followUpKinds, [["mark one exact", ["primary-sweep", "owner-lookup"]]]);
});

test("the workbook's findings are the run's own list, each withdrawn one back in its place", () => {
  for (const order of [["withdrawn", "on-point", "on-point"], ["on-point", "withdrawn", "on-point"], ["on-point", "on-point", "withdrawn"], ["withdrawn", "withdrawn", "on-point"]]) {
    const findings = order.map((disposition, i) => finding(i + 1, disposition));
    const doc = throughJson(clearanceReportDocument({ ...invented, findings }));
    assert.deepEqual(allFindingsOf(doc).map((f) => f.ordinal), [1, 2, 3], `order ${order.join(", ")}`);
  }
});

/** A workbook's entries as text, the build's own stamps aside. */
const entriesOf = (file) => Object.fromEntries(zipEntries(readFileSync(file)).map(([n, b]) => [n, workbookEntryText(n, b)]));

test("on an invented run, the workbook built from the document read back is the workbook publishing builds", async () => {
  const d = { ...invented, assessmentNotCompleted: false, coverageJudgment: { sufficient: false, reason: "an invented reason" },
    fetchState: { "/mark/ch/1": "retrieved" }, degradedRows: [], reviewReceipts: { lint: [{ id: "invented-check", detail: "d", family: "f" }] },
    clientGate: { released: true, reasons: [] }, verdictInfo: { verdict: "CONDITIONAL", tier: "Low", badge: "l2", reasons: [], clauses: [] },
    runOrigins: [], productName: "An invented product" };
  const dir = mkdtempSync(join(tmpdir(), "report-document-wb-"));
  // What publishReport handed the workbook before it read the document, spelled as it spelled it.
  await buildAudit({ degradedParts: d.degradedRows, droppedConditions: [], undispatchedProbes: [], withheldFamilies: [], releasedFamilies: [],
    setAside: [], findings: d.findings, frameworkMethod: null, coverage: d.coverage, contextNotes: d.contextNotes,
    coverageJudgment: d.coverageJudgment, markAssessment: null, corrections: null, fetchState: d.fetchState, verdict: d.verdictInfo,
    jurisdiction: null, commonLawJoinedTerms: d.commonLawJoinedTerms, registerOnly: false, clientGate: d.clientGate,
    lintFailures: deliveryFlagLines(d.reviewReceipts.lint), productName: d.productName, registerPublishesRecordPages: false,
    recordLinks: d.officeLinks.byUri, assessmentNotCompleted: false, registerReach: undefined, registerScope: undefined },
  null, join(dir, "direct.xlsx"), d.parsed.fm.title, d.parsed.fm);
  const w = clearanceWorkbookOf(throughJson(clearanceReportDocument(d, {})));
  await buildAudit(w.contract, w.audit, join(dir, "document.xlsx"), w.title, w.frontMatter);
  const direct = entriesOf(join(dir, "direct.xlsx"));
  assert.ok(Object.values(direct).join("").includes("MARK 2"), "premise: the withdrawn finding reaches the workbook");
  assert.deepEqual(entriesOf(join(dir, "document.xlsx")), direct);
});

test("of the run's review receipts, the document carries the failing checks alone, since no surface reads the rest", () => {
  const lint = [{ id: "invented-check", detail: "raw detail", family: "f" }];
  const doc = clearanceReportDocument({ ...invented, reviewReceipts: { lint, engagement: { x: 1 }, tripFlags: ["t"], machineLedgerNote: "n" } }, {});
  assert.deepStrictEqual(doc.reviewer.lint, lint);
  assert.equal(doc.reviewer.receipts, undefined);
  assert.doesNotMatch(JSON.stringify(doc), /machineLedgerNote|tripFlags|engagement/);
});

test("the verdict record is kept whole, sign-off included, because the page prints it where there is no statement", () => {
  const record = { verdict: "CONDITIONAL", tier: "Moderate", badge: "l3", reasons: ["r"], clauses: ["c"] };
  const doc = clearanceReportDocument({ ...invented, assessmentNotCompleted: false, verdictInfo: record });
  assert.deepStrictEqual(doc.verdict.record, record);
  assert.equal(doc.reviewer.signoff, undefined, "the sign-off is held twice");
});

// ── THE KNOCKOUT: one document per run, and one data file per name built from it ──────────────────────────────

test("the Knockout demo's document is JSON as built, keeps its findings record whole, and carries its data file", async () => {
  const sample = demoChildren(copy).map((name) => join(copy, name)).find((dir) => existsSync(join(dir, "run", "knockout-findings.json")));
  assert.ok(sample, "the demo container holds no Knockout");
  const meta = JSON.parse(readFileSync(join(sample, "meta.json"), "utf8"));
  const runDir = join(sample, "run");
  const findings = JSON.parse(readFileSync(join(runDir, "knockout-findings.json"), "utf8"));
  const framework = JSON.parse(readFileSync(paths(runDir).framework, "utf8"));
  const pool = mkdtempSync(join(tmpdir(), "report-document-pool-"));

  const read = await readKnockoutDocument({ runId: meta.runId, runDir, findings, framework, overall: null, poolRoot: pool, poolUrl: "" });
  const built = knockoutReportDocument(read, { runId: meta.runId, findings, framework });
  assert.deepStrictEqual(throughJson(built), built, "the document holds a value JSON does not carry");
  assert.equal(built.document, KNOCKOUT_DOCUMENT);
  assert.deepStrictEqual(throughJson(built).client.findings, findings, "the document's findings record is not the one read");

  const published = await republishRun({ runId: meta.runId, meta, pool, poolUrl: "", runDir });
  const written = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8"));
  assert.equal(written.run.reports.length, 1);
  const policy = existsSync(paths(runDir).searchPolicy) ? JSON.parse(readFileSync(paths(runDir).searchPolicy, "utf8")) : null;
  assertKnockoutEmailBothWays(runDir, { findings, framework, overall: worstBand(framework, findings.marks ?? []), published, productName: knockoutName(policy) });
  assert.equal(JSON.stringify(knockoutReportDataOf(written, 0), null, 2), readFileSync(join(pool, meta.runId, "report-data.json"), "utf8"),
    "the data file built from the document is not the data file publishing wrote");
});

const FRAMEWORK = { framework_key: "house-triage", title: "t", bands: [
  { label: "Very High", tone: "severe" }, { label: "High", tone: "high" }, { label: "Moderate", tone: "medium" },
  { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };
const koMark = (name, rating, extra = {}) => ({
  name, rating, bullets: [`An invented point about ${name}.`], assessment: `The invented read of ${name}.`,
  findings: [{ ordinal: 1, name: `${name} look-alike`, owner: "Invented Owner SA", band: rating,
    net: "A listing under a closely similar name is live.", type: "Active Business", evidence: [] }],
  ...extra,
});

test("on an invented batch of two names, each name's data file is the one built from the document", async () => {
  const root = mkdtempSync(join(tmpdir(), "report-document-ko-"));
  const runDir = join(root, "run"), poolRoot = join(root, "pool");
  mkdirSync(paths(runDir).reportDocument.replace(/[^/]+$/, ""), { recursive: true });
  mkdirSync(poolRoot);
  writeFileSync(join(runDir, "status.json"), JSON.stringify({ runId: "tmpinvented-batch" }));
  const findings = {
    schema_version: 2, batch: { executiveSummary: "The batch read, naming both names.", standardCaveats: ["A caveat."] },
    marks: [koMark("QUILLMERE", "High", { ratingQualifier: "on the goods named", purpleNotes: ["A reviewer's note."] }), koMark("TARNOVEL", "Low")],
  };
  const published = await publishKnockout({ runId: "tmpinvented-batch", codename: "invented", runDir, findings, framework: FRAMEWORK, overall: "High",
    poolRoot, poolUrl: "https://reports.example.test", customerKey: "", skipRegen: true });
  const written = JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8"));
  assert.equal(written.run.single, false);
  assert.deepEqual(written.run.reports.map((r) => [r.mark, r.band]), [["QUILLMERE", "High"], ["TARNOVEL", "Low"]]);
  // The findings record whole, under its own names: the data file's projection renames, as publishing does today.
  assert.deepStrictEqual(written.client.findings, findings);
  written.run.reports.forEach((r, at) => {
    const file = readFileSync(join(poolRoot, "tmpinvented-batch", `report-data-${r.slug}.json`), "utf8");
    assert.equal(JSON.stringify(knockoutReportDataOf(written, at), null, 2), file, `${r.mark}: not the data file publishing wrote`);
    // Each name's file opens with that name's own read, never the batch's.
    assert.equal(JSON.parse(file).summary, `The invented read of ${r.mark}.`);
  });
  assertKnockoutEmailBothWays(runDir, { findings, framework: FRAMEWORK, overall: "High", published, productName: null });
});

/**
 * The Knockout's cover email composed from the run's document, and from the values the lane holds with the document set
 * aside, as for a run published before it, must be the same email.
 */
function assertKnockoutEmailBothWays(runDir, { findings, framework, overall, published, productName }) {
  const lane = { findings, framework, overall, reports: published.reports, auditUrl: published.auditUrl, job: {}, registerCounts: null, qcFlags: published.qcFlags, productName };
  const fromDocument = composeKnockoutCoverNote(runDir, lane);
  renameSync(paths(runDir).reportDocument, `${paths(runDir).reportDocument}.aside`);
  const fromLane = composeKnockoutCoverNote(runDir, lane);
  renameSync(`${paths(runDir).reportDocument}.aside`, paths(runDir).reportDocument);
  assert.ok(fromLane.length > 200, "premise: an email was composed");
  assert.equal(fromDocument, fromLane, "the Knockout email from the document is not the email from the lane's values");
}

test("the Knockout's searches left open are the scope's, which the page and the workbook both read", () => {
  const steps = { listing: { failed: true }, reading: null, review: null };
  const doc = knockoutReportDocument({ steps }, { runId: "x", findings: { marks: [] } });
  assert.deepEqual(doc.scope.steps, steps);
  assert.equal(doc.reviewer.steps, undefined);
});

// ── THE COVER EMAIL: from the document where the run has one, from the run's files where it has none ─────────────

test("each demo's cover email composed from its document is the one composed from its files", async () => {
  for (const { name, dir } of clearances) {
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    const runDir = join(dir, "run");
    const pool = mkdtempSync(join(tmpdir(), "report-document-pool-"));
    await republishRun({ runId: meta.runId, meta, pool, poolUrl: "", runDir });
    const args = { url: "https://reports.example.test/portal/report/x/", auditFile: "x-audit.xlsx", names: ["VENQORI"] };
    const fromDocument = coverNoteInputs(runDir);
    assert.deepEqual(fromDocument.report.fm, JSON.parse(readFileSync(paths(runDir).reportDocument, "utf8")).prose.frontMatter, `${name}: premise, the document was read`);
    // The same run with its document set aside reads its files, as a run published before the document does.
    renameSync(paths(runDir).reportDocument, `${paths(runDir).reportDocument}.aside`);
    const fromFiles = coverNoteInputs(runDir);
    renameSync(`${paths(runDir).reportDocument}.aside`, paths(runDir).reportDocument);
    assert.deepEqual(fromDocument.opts, fromFiles.opts, `${name}: the email's options differ`);
    // A document written before it carried the verdict record as written is read from the files.
    const written = readFileSync(paths(runDir).reportDocument, "utf8");
    const older = JSON.parse(written);
    delete older.verdict.written;
    older.prose.frontMatter = { planted: true };
    writeFileSync(paths(runDir).reportDocument, JSON.stringify(older));
    const fromOlder = coverNoteInputs(runDir);
    writeFileSync(paths(runDir).reportDocument, written);
    assert.deepEqual(fromOlder, fromFiles, `${name}: a document without the record as written was read`);
    assert.equal(composeCoverNote(fromDocument, { ...args, productName: fromDocument.opts.productName }),
      composeCoverNote(fromFiles, { ...args, productName: fromFiles.opts.productName }), `${name}: the email differs`);
  }
});
