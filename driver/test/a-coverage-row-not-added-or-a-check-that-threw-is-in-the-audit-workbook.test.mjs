// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COVERAGE ROW NOT ADDED, OR A CHECK THAT THREW, IS IN THE AUDIT WORKBOOK (ruled 2026-09-25: run clean, retry and
// recover, and flag in the audit anything that still failed). Three steps used to fail with a note in the run log and
// nothing else: the adders of the coverage rows, the floor duty, and the demotion of evidence stamps the reading log
// cannot back. Each is driven to fail here by its own input, and delivery's read of the run names the part in the
// shipped deferral row's words. A later pass that succeeded clears it, and a run with no failure writes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { degradedParts, degradedPartRows, PART_NAMES, RULED_WORDS, NOT_COMPLETED, COVERAGE_ROWS_PASS, COVERAGE_ROW_NOT_ADDED,
  VERDICT_FLOORS_PASS, VERDICT_FLOOR_FAILED } from "../degraded-parts.mjs";
import { deferralCoverageRow } from "../deferral-row.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths as stagePaths } from "../stages.mjs";
import { stampCoverageJudgmentRows, injectDeferralCoverage, injectScriptScopeCoverage, injectLaneDepthCoverage,
  injectScreenGateCoverage, injectMeaningGapCoverage, deriveFloorDuty, settleDerivedBases } from "../pipeline.mjs";

const jl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const attempt = (n, ok, fail = null) => ({ attempt: n, ok, fail, engine: "engine-a", modelActual: "model-a" });
const PASS = { event: COVERAGE_ROWS_PASS };
const notAdded = (adder, fail = "induced") => ({ event: COVERAGE_ROW_NOT_ADDED, adder, fail });
const quiet = () => {};

/** A delivered clearance run with every other part present, its run log holding `log` after its first event. */
function delivered(t, log = []) {
  const dir = mkdtempSync(join(tmpdir(), "silent-parts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "run.jsonl"), jl([{ event: "case-law-decision", run: true }, ...log]));
  writeFileSync(driverDir(dir, "case-law.jsonl"), jl([attempt(1, true)]));
  writeFileSync(driverDir(dir, "skeptic.jsonl"), jl([attempt(1, true)]));
  writeFileSync(join(dir, "case-law-findings.md"), "# Case-law grounding\n\nNo on-point precedent found.\n");
  writeFileSync(join(dir, "audit.md"), "# Audit\n\n## Negative results\n");
  return dir;
}
const parts = (dir) => degradedParts(dir).map((p) => [p.part, p.name, p.reason]);
const events = (dir) => readFileSync(driverDir(dir, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ── what delivery reads ───────────────────────────────────────────────────────────────────────────────────────

test("a run whose adders, floor duty and evidence check all succeeded writes no degraded part", (t) => {
  const dir = delivered(t, [PASS, { event: "floor-duty", computable: true }, { event: "basis-derivation", demoted: 0 }]);
  writeFileSync(driverDir(dir, "basis-derivation.json"), JSON.stringify({ demoted: 0, rows: [] }));
  assert.deepEqual(parts(dir), []);
});

test("a coverage row an adder could not add is a degraded part of Coverage & gaps, in the shipped row's words", (t) => {
  const dir = delivered(t, [PASS, notAdded("frame-reopen", "Unexpected token")]);
  const found = degradedParts(dir);
  assert.deepEqual(found.map((p) => [p.part, p.name, p.reason]), [["coverage-rows", PART_NAMES.coverage, NOT_COMPLETED]]);
  assert.match(found[0].cause, /frame-reopen: Unexpected token/, "the adder and its raw cause stay on the run's record");
  assert.deepEqual(degradedPartRows(found), [deferralCoverageRow(PART_NAMES.coverage, NOT_COMPLETED)], "no new sentence");
});

test("only the last pass counts: a later clean pass clears a failure, and a failure with no pass after it stands", (t) => {
  assert.deepEqual(parts(delivered(t, [PASS, notAdded("screen-gate"), PASS])), [], "the next pass added the row again");
  assert.deepEqual(parts(delivered(t, [PASS, PASS, notAdded("screen-gate")])).map(([p]) => p), ["coverage-rows"],
    "a resume that did not pass the seam again still delivers without the row");
  const two = degradedParts(delivered(t, [PASS, notAdded("lane-depth"), notAdded("meaning-gap")]));
  assert.equal(two.length, 1, "one reader's line for the area");
  assert.match(two[0].cause, /lane-depth: .*; meaning-gap: /);
});

test("a floor duty that threw is a failed check on the Machine QC line, and a later derivation clears it", (t) => {
  const threw = degradedParts(delivered(t, [{ event: "floor-duty-failed", fail: "induced" }]));
  assert.deepEqual(threw.map((p) => [p.part, p.name]), [["checks", PART_NAMES.machineQc]]);
  assert.match(threw[0].cause, /the floor duty: induced/);
  assert.deepEqual(parts(delivered(t, [{ event: "floor-duty-failed", fail: "induced" }, { event: "floor-duty", computable: true }])), []);
});

test("an evidence stamp left standing, or a check of the stamps that threw, is the official records' line", (t) => {
  const standing = delivered(t, [{ event: "basis-derivation", demoted: 1 }]);
  writeFileSync(driverDir(standing, "basis-derivation.json"), JSON.stringify({ demoted: 1, unwritable: 2, rows: [] }));
  const found = degradedParts(standing);
  assert.deepEqual(found.map((p) => [p.part, p.name, p.reason]), [["evidence-stamps", RULED_WORDS.officialRecords, NOT_COMPLETED]]);
  assert.match(found[0].cause, /^2 verified-from-record stamp/);
  assert.deepEqual(parts(delivered(t, [{ event: "basis-derivation-failed", fail: "induced" }])).map(([p]) => p), ["evidence-stamps"]);
  const cleared = delivered(t, [{ event: "basis-derivation-failed", fail: "induced" }, { event: "basis-derivation", demoted: 0 }]);
  writeFileSync(driverDir(cleared, "basis-derivation.json"), JSON.stringify({ demoted: 0, rows: [] }));
  assert.deepEqual(parts(cleared), [], "a later derivation that wrote every demotion clears both");
});

test("a comparison of a correction's evidence stamps that threw is a failed check, and a later comparison clears it", (t) => {
  const threw = degradedParts(delivered(t, [{ event: "evidence-claim-invariant", ok: false, why: "induced" }]));
  assert.deepEqual(threw.map((p) => [p.part, p.name]), [["checks", PART_NAMES.machineQc]]);
  assert.match(threw[0].cause, /the check of a correction's evidence stamps: induced/);
  assert.deepEqual(parts(delivered(t, [{ event: "evidence-claim-invariant", ok: false, why: "induced" },
    { event: "evidence-claim-invariant", violations: 0, byArm: {} }])), [], "the comparison's last word is its state");
});

test("a floor of the verdict that threw on its last entry is a failed check; a later entry that ran clears it", (t) => {
  const failed = { event: VERDICT_FLOOR_FAILED, floor: "common-law", fail: "induced" };
  const threw = degradedParts(delivered(t, [{ event: VERDICT_FLOORS_PASS }, failed]));
  assert.deepEqual(threw.map((p) => [p.part, p.name]), [["checks", PART_NAMES.machineQc]]);
  assert.match(threw[0].cause, /the common-law floor: induced/);
  assert.deepEqual(parts(delivered(t, [{ event: VERDICT_FLOORS_PASS }, failed, { event: VERDICT_FLOORS_PASS }])), []);
});

test("the names delivery reads are the literal names the pipeline writes", () => {
  // The run log's names are written as literals so that they can be read from the source and classed; this holds the
  // reader's constants to them, so neither side can be renamed alone.
  const source = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  for (const name of [COVERAGE_ROWS_PASS, COVERAGE_ROW_NOT_ADDED, VERDICT_FLOORS_PASS, VERDICT_FLOOR_FAILED])
    assert.ok(source.includes(`event: "${name}"`), `pipeline.mjs writes the event ${name}`);
});

// ── each step, made to fail by its own input ──────────────────────────────────────────────────────────────────

const ADDERS = [
  ["coverage-judgment", (P, dir) => { writeFileSync(P.findings, "{ not json"); stampCoverageJudgmentRows(P, dir, quiet, {}); }],
  ["frame-reopen", (P, dir) => {
    writeFileSync(P.findings, "{}");
    writeFileSync(driverDir(dir, "frame-reopen.json"), "{ not json");
    injectDeferralCoverage(P, dir, quiet);
  }],
  ["script-scope", (P, dir) => {
    writeFileSync(P.findings, "{}");
    injectScriptScopeCoverage(P, dir, quiet, { searchPolicy: { get components() { throw new Error("induced: the policy could not be read"); } } });
  }],
  ["lane-depth", (P, dir) => {
    writeFileSync(P.findings, "{ not json");
    writeFileSync(driverDir(dir, "jx-lanes.json"), JSON.stringify({ fold: { depth: { zh: { shortfall: true, ran: "candidates" } } } }));
    injectLaneDepthCoverage(P, dir, quiet);
  }],
  ["screen-gate", (P, dir) => {
    writeFileSync(P.findings, "{ not json");
    injectScreenGateCoverage(P, dir, quiet, { screenGateUnresolved: [{ mark: "EXAMPLE MARK", uri: "/mark/1" }] });
  }],
  ["meaning-gap", (P, dir) => {
    writeFileSync(P.findings, "{}");
    writeFileSync(P.commonLawGrid, "{ not json");
    injectMeaningGapCoverage(P, dir, quiet);
  }],
];

for (const [adder, fail] of ADDERS) {
  test(`the ${adder} adder, made to fail by its input, logs what delivery reads and the run goes on`, (t) => {
    const dir = delivered(t, [PASS]);
    assert.doesNotThrow(() => fail(stagePaths(dir), dir), "the adder still catches its own failure");
    const logged = events(dir).filter((e) => e.event === COVERAGE_ROW_NOT_ADDED);
    assert.deepEqual(logged.map((e) => e.adder), [adder]);
    assert.ok(logged[0].fail, "the raw cause is on the run's record");
    assert.deepEqual(parts(dir), [["coverage-rows", PART_NAMES.coverage, NOT_COMPLETED]]);
  });
}

test("a floor duty made to throw by its inputs logs what delivery reads and the run goes on", (t) => {
  const dir = delivered(t);
  const P = new Proxy({}, { get: (_, k) => {
    if (k === "runDir") return dir;
    throw new Error(`induced: ${String(k)} could not be read`);
  } });
  assert.equal(deriveFloorDuty({ paths: P }, { ok: true }, "test"), null);
  assert.deepEqual(events(dir).filter((e) => e.event === "floor-duty-failed").length, 1);
  assert.deepEqual(degradedParts(dir).map((p) => [p.part, p.name]), [["checks", PART_NAMES.machineQc]]);
});

test("a check of the evidence stamps made to throw by its input logs what delivery reads and the run goes on", (t) => {
  const dir = delivered(t);
  const P = stagePaths(dir);
  mkdirSync(P.findings);   // a findings path that cannot be read as a file
  assert.equal(settleDerivedBases({ paths: P }, "pre-delivery"), null);
  assert.equal(events(dir).filter((e) => e.event === "basis-derivation-failed").length, 1);
  assert.deepEqual(parts(dir), [["evidence-stamps", RULED_WORDS.officialRecords, NOT_COMPLETED]]);
});
