// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// V4-1 (gates bind to the delivered artifact set) + V4-2 (registry-evidence closure) — unit + e2e.
// Reference case: the copper-conduit fork delivered "Reg. 4349603, renewed 2025" for US 86272665 with
// ZERO records in its prefix-filtered set — every registry check passed vacuously.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, writeFileSync, readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
// band-truth gate (2026-07-14): OFF in hermetic harnesses — mock runs never dial the provider.
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
import {
  writeRecordArtifacts, readRecordArtifacts, assembleRunRecords,
} from "../registry-fidelity.mjs";
import { registryChecks } from "../predelivery-lint.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
// code-side saturation-probe (2026-07-14): OFF in this legacy harness — its scenarios script the AGENT
// member; the dedicated satprobe-codeside tests exercise the code-side path with an injected executor.
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const REC = {
  applicationNumber: "86272665", applicationDate: "2014-05-15",
  registrationNumber: "4641314", registrationDate: "2014-11-18",
  onomaticsStatus: "Valid", corsearchStatusCode: "Registered",
};

test("readRecordArtifacts: _uri round-trip + legacy filename derivation", () => {
  const runDir = mkdtempSync(join(tmpdir(), "v4rec-"));
  writeRecordArtifacts(runDir, new Map([["/mark/cn/37554073-42", { registrationNumber: "x" }]]));
  // legacy artifact (pre-V4: no _uri) — uri re-derived from the filename
  writeFileSync(join(runDir, "_records", "us-86272665.json"), JSON.stringify(REC) + "\n");
  const map = readRecordArtifacts(runDir);
  assert.equal(map.size, 2);
  assert.equal(map.get("/mark/cn/37554073-42").registrationNumber, "x", "embedded _uri wins (hyphenated id intact)");
  assert.equal(map.get("/mark/us/86272665").registrationNumber, "4641314", "legacy filename re-derived");
});

test("assembleRunRecords: run-dir artifacts ∪ this-session ledger (session wins), persisted back", () => {
  const runDir = mkdtempSync(join(tmpdir(), "v4asm-"));
  const ledger = join(runDir, "ledger.jsonl");
  // inherited artifact (the fork case: _records/ copied, ledger prefix knows nothing)
  writeRecordArtifacts(runDir, new Map([["/mark/us/86272665", { ...REC, registrationNumber: "OLD" }]]));
  appendFileSync(ledger, JSON.stringify({
    ts: "t", sessionKey: "agent:clawdi:prelim-tmp1-aa-record-closure", target: "/mark/us/86272665", body: REC,
  }) + "\n");
  appendFileSync(ledger, JSON.stringify({
    ts: "t", sessionKey: "agent:clawdi:prelim-tmp1-aa-register-unit-x", target: "/mark/eu/018922211", body: { registrationNumber: "9" },
  }) + "\n");
  const { records, fromRunDir, fromLedger } = assembleRunRecords(runDir, "prelim-tmp1-aa-", ledger);
  assert.deepEqual({ size: records.size, fromRunDir, fromLedger }, { size: 2, fromRunDir: 1, fromLedger: 2 });
  assert.equal(records.get("/mark/us/86272665").registrationNumber, "4641314", "this-session row wins over inherited");
  // persisted: the ledger-only record materialized as an artifact, so the NEXT session inherits it
  assert.equal(readRecordArtifacts(runDir).get("/mark/eu/018922211").registrationNumber, "9");
});

test("registry-record-coverage: fails on a cited-but-unfetched record, carrying the mechanical cause", () => {
  const text = "## H-1 ([record](/mark/us/86272665))\nRegistration 4641314.";
  const failing = registryChecks({
    text, recordsByUri: new Map(), surface: "report",
    fetchFailures: new Map([["/mark/us/86272665", "corsearch_record_fetch HTTP 503"]]),
  }).find((c) => c.id === "registry-record-coverage");
  assert.equal(failing.pass, false);
  assert.match(failing.detail, /cites \/mark\/us\/86272665 but this run's record set holds no fetched record/);
  assert.match(failing.detail, /targeted fetch failed: corsearch_record_fetch HTTP 503/);
  const passing = registryChecks({ text, recordsByUri: new Map([["/mark/us/86272665", REC]]), surface: "report" })
    .find((c) => c.id === "registry-record-coverage");
  assert.equal(passing.pass, true);
});

// ── e2e: the closure pass inside the pipeline (mock gateway, injected fetcher) ─────────────────────────

const JOB = {
  id: "v4-job", msgId: "<v4@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP8443", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch",
};

async function runWithFetcher(recordFetcher, env = {}) {
  const root = mkdtempSync(join(tmpdir(), "v4e2e-"));
  // — the record log is the RUN's now, so there is no path to pin here. `CLEAROTRON_REGISTER_RECORD_LOG`
  // is still set, at a path nothing should reach: a fetcher that ignores the `recordLog` it is handed and
  // writes to the ambient env instead must FAIL these tests, which is exactly the regression the move
  // could otherwise ship silently.
  const recordLog = join(root, "must-not-be-read.jsonl");
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_REPORT_URI", "MOCK_CL_SHORT", "MOCK_NO_GRID_LEDGER"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_REGISTER_RECORD_LOG: recordLog, MOCK_REPORT_URI: "/mark/us/86272665", ...env,
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, { recordFetcher });
  delete process.env.MOCK_REPORT_URI;
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
  return { res, events, receipt, recordLog };
}

test("V4-2 e2e: a cited record absent from the set triggers ONE targeted fetch; coverage passes; receipt states the set", async () => {
  const calls = [];
  // The stub stands in for the plugin-core doRecordFetch: it writes the record-log row the real
  // chokepoint writes (same sessionKey attribution), then the driver's re-assembly must pick it up.
  // — AT THE ADDRESS IT WAS HANDED. `recordLog` is how the driver tells a record fetch which run's
  // log to append to, and a fetch that lands anywhere else is a body the run will never see.
  const fetcher = async (uri, { sessionKey, recordLog }) => {
    calls.push({ uri, sessionKey, recordLog });
    mkdirSync(dirname(recordLog), { recursive: true });
    appendFileSync(recordLog, JSON.stringify({ ts: "t", sessionKey, target: uri, body: REC }) + "\n");
    return { ok: true };
  };
  const { res, events, receipt } = await runWithFetcher(fetcher);
  // `res.runDir` is the ARCHIVED location by now — the run dir moves after delivery — so the assertion is
  // on the shape (this run's directory, its _driver/) rather than on a path string that has since moved.
  assert.ok(calls[0].recordLog.endsWith(driverDir(basename(res.runDir), "register-record-bodies.jsonl")),
    `the closure fetch is told THIS run's record log, derived from the run dir: ${calls[0].recordLog}`);
  assert.ok(existsSync(driverDir(res.runDir, "register-record-bodies.jsonl")),
    "and the body travelled with the run — not left behind in the home directory");
  assert.ok(!existsSync(process.env.CLEAROTRON_REGISTER_RECORD_LOG),
    "nothing wrote to the ambient global path: the run's evidence is not split across two addresses");
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.length, 1, "exactly one targeted fetch");
  assert.equal(calls[0].uri, "/mark/us/86272665");
  assert.match(calls[0].sessionKey, /^prelim-tmp8443-novapulse-.+-record-closure$/, "run-attributed closure session key");
  const closure = events.find((e) => e.event === "registry-record-closure");
  assert.deepEqual({ missing: closure.missing, fetched: closure.fetched, failed: closure.failed }, { missing: ["/mark/us/86272665"], fetched: 1, failed: [] });
  const cov = receipt.checks.find((c) => c.id === "registry-record-coverage" && c.surface === "report");
  assert.equal(cov.pass, true, cov.detail);
  assert.ok(receipt.artifactSet.recordUris.includes("/mark/us/86272665"), "receipt states the record set");
  assert.ok(Array.isArray(receipt.artifactSet.skippedStages), "receipt states inherited stages");
  assert.ok(existsSync(join(res.runDir, "_records", "us-86272665.json")), "record artifact materialized");
});

test("V4-2 e2e: an unfetchable cited record ships as the failing coverage flag with the mechanical cause", async () => {
  const fetcher = async () => ({ ok: false, cause: "corsearch_record_fetch HTTP 503 for uri=/mark/us/86272665" });
  const { res, events, receipt } = await runWithFetcher(fetcher);
  assert.equal(res.ok, true, "flag-and-deliver: the run still ships");
  const closure = events.find((e) => e.event === "registry-record-closure");
  assert.equal(closure.fetched, 0);
  assert.equal(closure.failed[0].uri, "/mark/us/86272665");
  const cov = receipt.checks.find((c) => c.id === "registry-record-coverage" && c.surface === "report");
  assert.equal(cov.pass, false);
  assert.match(cov.detail, /targeted fetch failed: .*HTTP 503/);
  assert.match(cov.detail, /record set holds no fetched record/);
  // A1: the flag lives in the INTERNAL _driver sink — NEVER report.md front-matter (report.md is copied
  // into the client-reachable pool, so a front-matter lint flag would be a latent client leak).
  assert.ok(receipt.failures.includes("registry-record-coverage"), "the failing check lives in the internal sink");
  const fm = readFileSync(join(res.runDir, "report.md"), "utf8").match(/^---\n[\s\S]*?\n---/)[0];
  assert.doesNotMatch(fm, /lint_flags:/, "A1: lint flags never ride report.md front-matter");
});

test("V4-1 e2e: no cited URIs → no closure pass; receipt still states the (empty) artifact set", async () => {
  const calls = [];
  const fetcher = async (uri) => { calls.push(uri); return { ok: true }; };
  const root = mkdtempSync(join(tmpdir(), "v4e2e-"));
  for (const k of ["MOCK_VERDICT", "MOCK_PERMISSION_PROSE", "MOCK_SKEPTIC", "MOCK_REPORT_URI", "MOCK_CL_SHORT", "MOCK_NO_GRID_LEDGER"]) delete process.env[k];
  for (const [k, v] of Object.entries({
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_AGENT: "clawdi", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CLEAROTRON_REGISTER_RECORD_LOG: join(root, "records.jsonl"),
  })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB, id: "v4-job-clean" }, { recordFetcher: fetcher });
  assert.equal(res.ok, true);
  assert.deepEqual(calls, [], "no targeted fetches when nothing is cited");
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(!events.some((e) => e.event === "registry-record-closure"), "no closure event without citations");
  const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
  assert.deepEqual(receipt.artifactSet.recordUris, []);
  assert.ok(events.some((e) => e.event === "record-artifacts" && e.fromRunDir === 0 && e.fromLedgerThisSession === 0));
});
