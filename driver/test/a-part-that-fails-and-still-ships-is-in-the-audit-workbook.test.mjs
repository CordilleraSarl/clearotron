// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PART THAT FAILS AND STILL SHIPS IS IN THE AUDIT WORKBOOK (ruled 2026-09-25): run clean first time, retry
// and recover, and flag in the audit anything that still failed. A part the report shipped without, with
// nothing saying so, is the defect. The part is read from the run as it stands at delivery, so a failure a
// retry recovered writes nothing; the row is the shipped deferral row, so no sentence is new; and a run with
// no failure produces the workbook it produced before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { degradedParts, degradedPartRows, writeDegradedParts, readDegradedPartRows, PART_NAMES, TIMED_OUT, NOT_COMPLETED } from "../degraded-parts.mjs";
import { deferralCoverageRow } from "../deferral-row.mjs";
import { buildAudit } from "../publish/xlsx.mjs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { firstTimeRows, firstTimeLines } from "../../scripts/e2e-first-time.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const attempt = (n, ok, fail = null) => ({ attempt: n, ok, fail, engine: "engine-a", modelActual: "model-a" });

/** A delivered clearance run with every part present, plus `patch` applied to its files. */
function runDir(t, patch = {}) {
  const dir = mkdtempSync(join(tmpdir(), "degraded-parts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "_driver"), { recursive: true });
  const files = {
    "_driver/run.jsonl": jl([{ event: "case-law-decision", run: true }]),
    "_driver/case-law.jsonl": jl([attempt(1, true)]),
    "_driver/skeptic.jsonl": jl([attempt(1, true)]),
    "case-law-findings.md": "# Case-law grounding\n\nNo on-point precedent found.\n",
    "audit.md": "# Audit\n\n## Negative results\n",
    ...patch,
  };
  for (const [name, body] of Object.entries(files)) if (body !== null) writeFileSync(join(dir, name), body);
  return dir;
}

test("a run whose every part is present writes no degraded part", (t) => {
  assert.deepEqual(degradedParts(runDir(t)), []);
});

test("court decisions that were due and never arrived are a degraded part, with the reason the row can give", (t) => {
  const absent = degradedParts(runDir(t, { "case-law-findings.md": null }));
  assert.deepEqual(absent.map((p) => [p.part, p.name, p.reason]), [["court-decisions", "Court decisions", NOT_COMPLETED]]);
  const empty = degradedParts(runDir(t, { "case-law-findings.md": "  \n" }));
  assert.deepEqual(empty.map((p) => p.part), ["court-decisions"], "an empty file reads 'not in scope' on the report, and is not");
  const timedOut = degradedParts(runDir(t, { "_driver/case-law.jsonl": jl([attempt(1, false, "timeout")]) }));
  assert.deepEqual(timedOut.map((p) => p.reason), [TIMED_OUT]);
  assert.match(timedOut[0].cause, /timeout/, "the raw cause stays on the run's record");
});

test("a failure a retry or a resume recovered writes nothing: the stage's last attempt decides", (t) => {
  const recovered = runDir(t, { "_driver/case-law.jsonl": jl([attempt(1, false, "timeout"), attempt(1, true)]) });
  assert.deepEqual(degradedParts(recovered), []);
});

test("a run that was not due court decisions has none to miss", (t) => {
  const dir = runDir(t, { "_driver/run.jsonl": jl([{ event: "case-law-decision", run: false }]),
    "case-law-findings.md": null, "_driver/case-law.jsonl": null });
  assert.deepEqual(degradedParts(dir), []);
});

test("the search log is a degraded part when it did not arrive", (t) => {
  assert.deepEqual(degradedParts(runDir(t, { "audit.md": null })).map((p) => [p.part, p.name]), [["search-log", "What was searched"]]);
});

test("the checks behind the report are one part, Machine QC, whichever of them did not finish", (t) => {
  const cases = {
    "the reviewer's pass": { "_driver/skeptic.jsonl": jl([attempt(1, false, "missing_file")]) },
    "the review's re-check": { "_driver/narrative-refutation.jsonl": jl([attempt(1, false, "timeout")]) },
    "the blind frame": { "_driver/blind-frame.jsonl": jl([attempt(1, false, "missing_file")]) },
    "the frame diff": { "_driver/run.jsonl": jl([{ event: "case-law-decision", run: true }, { event: "frame-diff-skipped", reason: "model-unparseable: x" }]) },
    "the corrective pass, rolled back": { "_driver/run.jsonl": jl([{ event: "case-law-decision", run: true }, { event: "corrective-rollback", reason: "validator" }]) },
    "the crowd counts": { "_driver/run.jsonl": jl([{ event: "case-law-decision", run: true }, { event: "crowd-context-failed", fail: "boom" }]) },
  };
  for (const [what, patch] of Object.entries(cases)) {
    const parts = degradedParts(runDir(t, patch));
    assert.deepEqual(parts.map((p) => [p.part, p.name]), [["checks", "Machine QC"]], what);
    assert.ok(parts[0].cause.startsWith(what), `the record does not name ${what}: ${parts[0].cause}`);
  }
  assert.equal(degradedParts(runDir(t, cases["the review's re-check"]))[0].reason, TIMED_OUT);
});

test("a step's later success clears it: the last word in the run log decides", (t) => {
  const log = (...events) => ({ "_driver/run.jsonl": jl([{ event: "case-law-decision", run: true }, ...events]) });
  assert.deepEqual(degradedParts(runDir(t, log({ event: "crowd-context-failed", fail: "x" }, { event: "crowd-context" }))), []);
  assert.deepEqual(degradedParts(runDir(t, log({ event: "corrective-rollback", reason: "v" }, { event: "corrective-cycle-receipt" }))), []);
  assert.deepEqual(degradedParts(runDir(t, log({ event: "band-shape-failed", fail: "x" }, { event: "band-shape-derived" }))), []);
  assert.deepEqual(degradedParts(runDir(t, log({ event: "digest-flush" }, { event: "digest-flush-failed", fail: "timeout" }))).map((p) => p.part), ["register"]);
});

test("a native-language investigation that was asked and never ran is a degraded part; one that ran short is not read here", (t) => {
  assert.deepEqual(degradedParts(runDir(t), { localLanguage: "not-run" }).map((p) => [p.part, p.name]), [["local-language", "Local-language investigation"]]);
  for (const state of ["ran", "ran-shallow", "not-in-scope", null]) assert.deepEqual(degradedParts(runDir(t), { localLanguage: state }), [], String(state));
});

test("the register's own steps and a finding's written card are degraded parts when they ended failed", (t) => {
  const register = degradedParts(runDir(t, { "_driver/run.jsonl": jl([{ event: "case-law-decision", run: true },
    { event: "owner-screen-failed", fail: "boom" }, { event: "form-neighbourhood-skipped", reason: "threw" }]) }));
  assert.deepEqual(register.map((p) => [p.part, p.name]), [["register", "Register"]]);
  assert.match(register[0].cause, /the form floor: threw; the owner screen: boom|the owner screen: boom/);
  const cards = degradedParts(runDir(t, { "_driver/report-card:3.jsonl": jl([attempt(1, false, "timeout")]), "_driver/report-card:4.jsonl": jl([attempt(1, true)]) }));
  assert.deepEqual(cards.map((p) => [p.part, p.name, p.cause]), [["finding-cards", "Findings", "card stages ended failed: report-card:3"]]);
});

test("each part's name is a label the report or the workbook already prints", () => {
  const render = readFileSync(join(HERE, "..", "publish", "render.mjs"), "utf8");
  const xlsx = readFileSync(join(HERE, "..", "publish", "xlsx.mjs"), "utf8");
  assert.ok(render.includes(`'${PART_NAMES.courtDecisions}'`), "the report's search-coverage row");
  assert.ok(xlsx.includes(`'${PART_NAMES.searchLog}'`), "the workbook's tab");
  assert.ok(xlsx.includes(`'⚠  ${PART_NAMES.machineQc}'`), "the workbook's Summary row for the checks");
  assert.ok(render.includes(`'${PART_NAMES.register}'`), "the report's search-coverage row");
  assert.ok(render.includes(`'${PART_NAMES.localLanguage}'`), "the report's search-coverage row");
  assert.ok(xlsx.includes(`'${PART_NAMES.findings}'`), "the workbook's tab");
});

test("the row is the shipped deferral row, one per name, with the row's own reason and never the raw cause", () => {
  const parts = [
    { part: "court-decisions", name: "Court decisions", reason: TIMED_OUT, cause: "the case-law stage ended failed: timeout after 2700s" },
    { part: "reviewer", name: "Machine QC", reason: NOT_COMPLETED, cause: "the skeptic stage ended failed: missing_file" },
    { part: "frame", name: "Machine QC", reason: NOT_COMPLETED, cause: "another check" },
  ];
  const rows = degradedPartRows(parts);
  assert.deepEqual(rows, [deferralCoverageRow("Court decisions", TIMED_OUT), deferralCoverageRow("Machine QC", NOT_COMPLETED)]);
  assert.equal(rows[0].area, "Follow-up / Court decisions");
  assert.equal(rows[0].note, "Court decisions — not completed this run — the source timed out this run");
  assert.equal(rows[1].note, "Machine QC — not completed this run — it could not be completed this run, so it is left open here rather than reported as clean");
  for (const r of rows) assert.ok(!/2700s|missing_file|stage ended/.test(r.note), `a raw cause reached a reader's cell: ${r.note}`);
});

test("the rows written at delivery are what a republish reads back", (t) => {
  const dir = runDir(t, { "audit.md": null });
  const record = writeDegradedParts(dir, degradedParts(dir));
  assert.deepEqual(readDegradedPartRows(dir), record.rows);
  assert.deepEqual(readDegradedPartRows(runDir(t)), [], "a run that wrote none reads none");
});

test("the first-time line counts a degraded part only where the part's record is the failure's only one", () => {
  const base = { attempts: [{ stage: "matter-frame", row: { attempt: 1, ok: true, engine: "e", modelActual: "m" } }], status: { state: "delivered" } };
  const reads = (event) => firstTimeLines(firstTimeRows({ ...base, runLog: [event] }))[0].split(" — ")[0];
  assert.equal(reads({ event: "degraded-parts", parts: [{ part: "court-decisions", cause: "case-law-findings.md is empty" }] }), "first time: no");
  assert.equal(reads({ event: "degraded-parts", parts: [{ part: "checks", cause: "the reviewer's pass: timeout" }] }), "first time: yes",
    "a stage that ended failed is counted from its own attempt row, not twice");
  assert.equal(reads({ event: "degraded-parts", parts: [] }), "first time: yes");
  assert.equal(reads({ event: "degraded-parts-failed", cause: "boom" }), "first time: no");
  assert.equal(reads({ event: "publish-gates", auditWorkbook: "failed", auditWorkbookError: "x" }), "first time: no");
  assert.equal(reads({ event: "publish-gates", auditWorkbook: "built" }), "first time: yes");
});

// ── The workbook ─────────────────────────────────────────────────────────────────────────────────────

async function sheets(contract, t) {
  const dir = mkdtempSync(join(tmpdir(), "degraded-book-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, "audit.xlsx");
  const result = await buildAudit(contract, null, out, "NOVAPULSE", { title: "NOVAPULSE" });
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const rows = (name) => {
    const out = [];
    wb.getWorksheet(name)?.eachRow((row) => out.push(row.values.slice(1).map((v) => (v == null ? "" : String(v)))));
    return out;
  };
  return { result, summary: rows("Summary"), coverage: rows("Coverage & gaps") };
}

const CONTRACT = {
  findings: [{ ordinal: 1, mark: "NOVA PULSAR", owner: { name: "Example Owner Ltd", country: "GB", registrations: [] }, disposition: "distinguished",
    source: { source_type: "register", resolved_link: "https://example.org/record/1" } }],
  coverage: [{ area: "Register — class 9", state: "confirmed-clean", note: "searched in full" }],
};

test("a degraded part is an Open row on Coverage & gaps, and the Summary counts it and leads with it", async (t) => {
  const degraded = degradedPartRows([{ name: "Court decisions", reason: NOT_COMPLETED }]);
  const { summary, coverage, result } = await sheets({ ...CONTRACT, degradedParts: degraded }, t);
  const row = coverage.find((r) => r[0] === "Follow-up / Court decisions");
  assert.ok(row, "no row for the part on Coverage & gaps");
  assert.equal(row[1], "Open");
  assert.equal(summary.find((r) => r[0] === "   Open / limited coverage")?.[1], "1");
  assert.equal(summary.find((r) => /check first/i.test(r[0]))?.[1], degraded[0].note);
  assert.ok(!result.gateViolations.some((v) => /headline-honesty/.test(v)), result.gateViolations.join(" | "));
});

test("a run with no failure produces the workbook it produced before", async (t) => {
  const before = await sheets(CONTRACT, t);
  const now = await sheets({ ...CONTRACT, degradedParts: [] }, t);
  assert.deepEqual(now.summary, before.summary);
  assert.deepEqual(now.coverage, before.coverage);
  assert.equal(before.summary.find((r) => /check first/i.test(r[0]))?.[1], "None — every search unit reached completion.");
});

// ── At the door: a real offline run whose reviewer stage fails, read from the workbook it published ──────

const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

async function runOffline(env) {
  const root = mkdtempSync(join(tmpdir(), "degraded-run-"));
  const profiles = join(root, "profiles");
  cpSync(join(HERE, "..", "profiles"), profiles, { recursive: true });
  pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
  process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
  process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
  process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
  process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
  process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
  delete process.env.MOCK_FAIL_STAGE;
  for (const [k, v] of Object.entries({ CLEAROTRON_CUSTOMERS_DIR: profiles, CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0",
    CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", ...env })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ id: "test-job", msgId: "<test@x>", forwarder: "jordan", forwarderDomain: "example.com",
    ref: "TMP-2201", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch" }, {});
  const book = readdirSync(join(root, "pool"), { recursive: true }).find((p) => String(p).endsWith("-audit.xlsx"));
  assert.ok(book, "the run published no workbook");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(root, "pool", book));
  const areas = [];
  wb.getWorksheet("Coverage & gaps")?.eachRow((row) => areas.push(String(row.values[1] ?? "")));
  return { res, root, areas };
}

test("at the door: a run whose reviewer stage failed publishes a workbook that says so, and a clean run's does not", async (t) => {
  const failed = await runOffline({ MOCK_FAIL_STAGE: "Step 2.6 — Skeptic review" });
  t.after(() => rmSync(failed.root, { recursive: true, force: true }));
  assert.ok(failed.areas.includes("Follow-up / Machine QC"), `no row for the failed reviewer pass: ${failed.areas.join(" | ")}`);
  const record = JSON.parse(readFileSync(driverDir(failed.res.runDir, "degraded-parts.json"), "utf8"));
  assert.deepEqual(record.parts.map((p) => p.part), ["checks"]);
  const clean = await runOffline({});
  t.after(() => rmSync(clean.root, { recursive: true, force: true }));
  assert.ok(!clean.areas.some((a) => a.startsWith("Follow-up / Machine QC")), "a clean run's workbook carries a degraded row");
  // Every part, not only the one the other run failed: a check that fires on a clean run is a false row.
  assert.deepEqual(JSON.parse(readFileSync(driverDir(clean.res.runDir, "degraded-parts.json"), "utf8")).parts, [], "a clean run recorded a degraded part");
});
