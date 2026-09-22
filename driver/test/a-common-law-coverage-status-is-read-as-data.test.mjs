// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COMMON-LAW COVERAGE STATUS IS READ AS DATA, AND THE PROSE WORD IS THE FALLBACK.
//
// The common-law gate refused a finished findings file unless one of three exact words appeared somewhere
// in its prose. The research did not change the outcome; the model's phrasing did. On the codex engine,
// 13 of 22 failed common-law attempts on the test box (16-22 September) were that word, each a full
// stage re-run. The register path already reads its statuses as data.
//
// So the seat now also records its ledger rows' statuses through `record_coverage_status`, the driver
// writes them, and the gate reads that record first. Four properties, each held below:
//
//   1. Data alone passes: no status word in the prose, a recorded status, and the gate accepts it. Without
//      the record the same document is refused, which is today's behaviour.
//   2. Nothing that passes today stops passing: the prose word still passes on its own, and a record the
//      gate cannot read as data never turns a passing document into a failing one.
//   3. The merged canonical file is the halves concatenated, so the halves' records answer for it.
//   4. The path a run takes: the seat's call reaches the real server, the server writes where the gate
//      reads, and the manual orders the tool with the values its schema accepts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { GRID_HALVES, splitGridTerms, mergeGrids, mergeCommonLawFindings } from "../common-law-receipts.mjs";
import { validators } from "../verify.mjs";
import { paths } from "../stages.mjs";
import { recordCoverageStatus, coverageStatusPath, coverageStatusAsData, findingsPathForSpec, COMMON_LAW_COVERAGE_STATUSES }
  from "../common-law-coverage-status.mjs";

process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PLATFORMS = ["store.steampowered.com", "web"];
const TERMS = ["novapulse", "kroma", "转码", "chr0ma"];
const QUERIES = ["novapulse slang", "novapulse gang", "kroma meaning", "转码 meaning"];
const cellsFor = (terms) => terms.flatMap((term) => SPEC_PLATFORMS.map((platform) => ({ term, platform, status: "no_hit", results: [] })));
const prRisk = (queries) => queries.map((q) => ({ query: q, results: [] }));

/** A half's findings, complete in every section, with the ledger row's status cell as given. */
const halfDoc = (h, terms, status) => [
  `# Common-law findings — half ${h}`, "",
  "## Findings — Mark: X", "| a | b |", "",
  "### Negative results",
  ...terms.flatMap((t) => SPEC_PLATFORMS.map((p) => `| ${t} | ${p} | No results |`)),
  "",
  "### PR / reputational", "None identified — reads clean.", "",
  "### Coverage ledger", `| dictated platform grid | ${status} | all dictated platforms searched |`, "",
  "### Audit trail", "| 1 | grid | cells | ok |", "",
].join("\n") + "x".repeat(200);

/**
 * A run directory the servers accept (under studio/prelim-search), holding the merged canonical pair and each
 * half's driver-written spec, as the driver leaves them. Each half's ledger status cell is as given.
 */
function run(status) {
  const root = mkdtempSync(join(tmpdir(), "cl-status-data-"));
  const dir = join(root, "studio", "prelim-search", "run");
  mkdirSync(driverDir(dir), { recursive: true });
  const spec = { terms: TERMS, platforms: SPEC_PLATFORMS, output_path: join(dir, "common-law-grid.json"), batch: 14,
    connotation: { queries: QUERIES }, ledger_required: true };
  const terms = splitGridTerms(TERMS);
  const queries = splitGridTerms(QUERIES);
  const merged = mergeGrids([{ cells: cellsFor(terms.a), extras: { pr_risk: prRisk(queries.a) }, gaps: [] }],
    [{ cells: cellsFor(terms.b), extras: { pr_risk: prRisk(queries.b) }, gaps: [] }], { spec });
  writeFileSync(driverDir(dir, "grid-spec.json"), JSON.stringify(spec));
  const specPath = { null: driverDir(dir, "grid-spec.json") };
  for (const h of GRID_HALVES) {
    const s = { ...spec, terms: terms[h], output_path: join(dir, `common-law-grid.half-${h}.json`), half: h };
    specPath[h] = driverDir(dir, `grid-spec.half-${h}.json`);
    writeFileSync(specPath[h], JSON.stringify(s));
  }
  writeFileSync(join(dir, "common-law-grid.json"), JSON.stringify(merged));
  const findings = mergeCommonLawFindings(GRID_HALVES.map((h) => ({ half: h, content: halfDoc(h, terms[h], status), error: null })));
  const p = join(dir, "common-law-findings.md");
  writeFileSync(p, findings);
  const spec_ = (h) => JSON.parse(readFileSync(specPath[h ?? null], "utf8"));
  return { root, dir, p, findings, specPath, spec: spec_, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Speak to the real dispositions server over stdio: initialize, then one request. A timeout FAILS. */
function server(method, params) {
  const script = join(DRIVER, "engine", "mcp", "dispositions-server.mjs");
  return new Promise((resolve, reject) => {
    const p = spawn("node", [script], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("dispositions-server.mjs did not answer — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method, params });
  });
}
const callTool = (args) => server("tools/call", { name: "record_coverage_status", arguments: args });
const text = (r) => (r?.content ?? []).map((c) => c.text).join("\n");

const ROW = [{ unit: "dictated platform grid", status: "confirmed-clean" }];
// A ledger row whose status cell carries none of the three words: the phrasing that failed on the test box.
const NO_WORD = "complete";

test("THE CONTROL: with no status word and no record, the canonical file is refused as it is today", () => {
  const r = run(NO_WORD);
  try {
    const v = validators.commonLaw(r.p, r.findings);
    assert.equal(v.ok, false);
    assert.match(v.reason, /no_coverage_status_row/);
  } finally { r.done(); }
});

test("data alone passes: each half records through the real server, and the merged file passes with no word", async () => {
  const r = run(NO_WORD);
  try {
    assert.equal(/confirmed-clean|coverage-limited|deferred/i.test(r.findings), false, "the fixture carries a status word, so this tests nothing");
    for (const h of GRID_HALVES) {
      const res = await callTool({ grid_spec_path: r.specPath[h], rows: ROW });
      assert.notEqual(res?.isError, true, `the server refused half ${h}'s statuses: ${text(res)}`);
      assert.match(text(res), /^Recorded 1 of 1\./);
      assert.ok(existsSync(coverageStatusPath(join(r.dir, `common-law-findings.half-${h}.md`))), `the server wrote nothing where the gate reads half ${h}`);
    }
    assert.deepEqual(validators.commonLaw(r.p, r.findings), { ok: true, reason: "machine-receipts" },
      "a document whose coverage status is on record as data was refused for the missing word");
  } finally { r.done(); }
});

test("an unsplit run's own record answers for its own findings file", () => {
  const r = run(NO_WORD);
  try {
    assert.equal(recordCoverageStatus(r.spec(null), { rows: [{ unit: "dictated platform grid", status: "coverage-limited" },
      { unit: "non-Latin reach", status: "deferred" }] }).ok, true);
    assert.equal(coverageStatusPath(r.p), driverDir(r.dir, "common-law-findings.coverage-status.json"));
    assert.deepEqual(validators.commonLaw(r.p, r.findings), { ok: true, reason: "machine-receipts" });
  } finally { r.done(); }
});

test("a half's own gate reads its own record", () => {
  // The half validator checks the prose gate first and the grid after. Past the gate, this fixture has no
  // half ledger, so the next refusal is the ledger's; which refusal comes back says whether the gate passed.
  const r = run(NO_WORD);
  try {
    const p = join(r.dir, "common-law-findings.half-a.md");
    const c = halfDoc("a", splitGridTerms(TERMS).a, NO_WORD);
    writeFileSync(p, c);
    assert.match(validators.commonLawHalf(p, c).reason, /no_coverage_status_row/, "the control: no record, no word, refused at the gate");
    assert.equal(recordCoverageStatus(r.spec("a"), { rows: ROW }).ok, true);
    const v = validators.commonLawHalf(p, c);
    assert.doesNotMatch(v.reason, /no_coverage_status_row/, "the half's record did not reach its gate");
    assert.match(v.reason, /^grid_ledger_/, `past the gate, the next check refuses: ${v.reason}`);
  } finally { r.done(); }
});

test("a document that passes today still passes, and a record the gate cannot read changes nothing", () => {
  const r = run("confirmed-clean");
  try {
    assert.deepEqual(validators.commonLaw(r.p, r.findings), { ok: true, reason: "machine-receipts" }, "the prose word alone no longer passes");
    // A damaged record is not a refusal: the word still carries the document.
    for (const bad of ["not json", {}, { coverage_status: {} }, { coverage_status: { grid: "clean" } }, { coverage_status: ["confirmed-clean"] }]) {
      writeFileSync(coverageStatusPath(r.p), typeof bad === "string" ? bad : JSON.stringify(bad));
      assert.deepEqual(validators.commonLaw(r.p, r.findings), { ok: true, reason: "machine-receipts" },
        `a damaged record (${JSON.stringify(bad)}) failed a document the prose word passes`);
    }
  } finally { r.done(); }
});

test("a record the gate cannot read as data does not pass a document on its own", () => {
  const r = run(NO_WORD);
  try {
    for (const bad of ["not json", {}, { coverage_status: {} }, { coverage_status: { grid: "clean" } },
      { coverage_status: { grid: "confirmed-clean", other: "unknown" } }, { coverage_status: ["confirmed-clean"] }]) {
      writeFileSync(coverageStatusPath(r.p), typeof bad === "string" ? bad : JSON.stringify(bad));
      assert.equal(coverageStatusAsData(r.p), false, `${JSON.stringify(bad)} read as a coverage status`);
      assert.match(validators.commonLaw(r.p, r.findings).reason, /no_coverage_status_row/);
    }
  } finally { r.done(); }
});

test("the tool keeps what validates, refuses the rest by entry, and accumulates", () => {
  const r = run(NO_WORD);
  try {
    const spec = r.spec("a");
    const file = coverageStatusPath(join(r.dir, "common-law-findings.half-a.md"));
    const none = recordCoverageStatus(spec, { rows: [{ unit: "grid", status: "clean" }] });
    assert.equal(none.ok, false);
    assert.match(none.text, /entry 1 \(grid\): status "clean" is not one of confirmed-clean \/ coverage-limited \/ deferred/);
    assert.equal(existsSync(file), false, "a call with nothing valid wrote a record");
    assert.equal(recordCoverageStatus(spec, { rows: [] }).ok, false);
    const some = recordCoverageStatus(spec, { rows: [{ unit: "grid", status: " Confirmed-Clean " }, { unit: "", status: "deferred" }] });
    assert.equal(some.ok, false, "a call with a refused entry reported success");
    assert.match(some.text, /^Recorded 1 of 2\./);
    assert.match(some.text, /entry 2: unit is empty/);
    recordCoverageStatus(spec, { rows: [{ unit: "non-Latin reach", status: "deferred" }] });
    recordCoverageStatus(spec, { rows: [{ unit: "grid", status: "coverage-limited" }] });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).coverage_status, { grid: "coverage-limited", "non-Latin reach": "deferred" },
      "a later call dropped an earlier unit, or did not replace a restated one");
  } finally { r.done(); }
});

test("the server writes where the gate reads: one derivation, and it is the driver's findings name", () => {
  const r = run(NO_WORD);
  try {
    const P = paths(r.dir);
    for (const h of GRID_HALVES) assert.equal(findingsPathForSpec(r.spec(h)), P.commonLawHalf(h));
    assert.equal(findingsPathForSpec(r.spec(null)), P.commonLaw);
    // A closure top-up hands the seat its own supplementary spec; it names the same half, so the same file.
    assert.equal(findingsPathForSpec({ ...r.spec("b"), output_path: P.commonLawGridSupp("b", "closure") }), P.commonLawHalf("b"));
  } finally { r.done(); }
});

test("the server refuses a call with no driver-written spec, and writes nothing", async () => {
  const r = run(NO_WORD);
  try {
    const res = await callTool({ rows: ROW });
    assert.equal(res.isError, true);
    assert.match(text(res), /grid_spec_path/, "the refusal does not name the missing spec path");
    const outside = join(r.root, "grid-spec.json");
    writeFileSync(outside, JSON.stringify({ ...r.spec("a"), output_path: join(r.root, "common-law-grid.half-a.json") }));
    const res2 = await callTool({ grid_spec_path: outside, rows: ROW });
    assert.equal(res2.isError, true, "a spec outside a run directory was accepted");
    assert.equal(existsSync(coverageStatusPath(join(r.root, "common-law-findings.half-a.md"))), false);
  } finally { r.done(); }
});

test("the manual orders the tool, and names exactly the values its served schema accepts", async () => {
  const skill = readFileSync(join(DRIVER, "skills", "clearance-common-law", "SKILL.md"), "utf8");
  const ledger = skill.slice(skill.indexOf("### Coverage ledger"), skill.indexOf("### Cross-checks suggested"));
  assert.ok(ledger.length > 100, "the manual's coverage ledger section could not be found");
  assert.match(ledger, /`record_coverage_status`, passing `grid_spec_path`/, "the manual does not order the tool beside the ledger");
  const tools = (await server("tools/list", {}))?.tools ?? [];
  const tool = tools.find((t) => t.name === "record_coverage_status");
  assert.ok(tool, `the dispositions server does not serve record_coverage_status (serves: ${tools.map((t) => t.name).join(", ")})`);
  const served = tool.inputSchema.properties.rows.items.properties.status.enum;
  assert.deepEqual(served, [...COMMON_LAW_COVERAGE_STATUSES]);
  for (const s of served) assert.match(ledger, new RegExp(`\`${s}\``), `the manual does not name ${s}`);
  assert.equal(served.length, 3);
});
