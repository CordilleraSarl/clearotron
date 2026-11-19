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
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { publishSource, demoChildren } = await import("../demo-container.mjs");
const { republishRun } = await import("../publish/report-registry.mjs");
const { readClearanceDocument } = await import("../publish/index.mjs");
const { CLEARANCE_DOCUMENT, clearanceReportDocument, clearanceReportDataOf } = await import("../publish/report-document.mjs");
const { clearanceReportData } = await import("../publish/report-data.mjs");
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
  followUpKinds: new Map([[1, "owner"]]), commonLawJoinedTerms: new Set(["ZETA", "ALPHA"]),
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
});

test("the verdict's sign-off is the reviewer's, and the rest of the record is the verdict's", () => {
  const doc = clearanceReportDocument({ ...invented, assessmentNotCompleted: false,
    verdictInfo: { verdict: "CONDITIONAL", tier: "Moderate", badge: "l3", reasons: ["r"], clauses: ["c"], statement: "S." } });
  assert.equal(doc.reviewer.signoff, "CONDITIONAL");
  assert.equal(doc.verdict.record.verdict, undefined);
  assert.equal(doc.verdict.record.tier, "Moderate");
});
