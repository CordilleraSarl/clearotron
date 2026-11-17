// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FULL-DEPTH SEARCH THIS VERSION CANNOT RUN IS LEFT OPEN IN TWO SENTENCES.
//
// When a client asks for a full-depth Japanese- or Korean-language search, this version runs only the candidate
// search. The report's "Left open" row says so in the two sentences the depth verdict writes, under a label in
// words, and nothing else: no opening that restates them in the code's terms, and no closing line about verdicts.
// The row keeps its partly-covered state. Every other cause keeps its fuller note. Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { deriveLaneDepthVerdicts } from "../jx.mjs";
import { injectLaneDepthCoverage } from "../pipeline.mjs";

const OWNER = {
  ja: "The requested full-depth Japanese-language search is not available in this version. Only the candidate search ran; the deeper web search and native-language review were not performed.",
  ko: "The requested full-depth Korean-language search is not available in this version. Only the candidate search ran; the deeper web search and native-language review were not performed.",
};

// The verdicts as the run states them: produced by the depth verdict itself, never typed here.
const verdictsFor = (lane, jurisdiction) => deriveLaneDepthVerdicts({
  sidecar: { lanes: { [lane]: { depth: "full", jurisdictions: [jurisdiction] } } },
  slices: { candidates: { slice: 1, state: "ran", lanes: { [lane]: "ran" } } },
});

function runWith(lane, depth, coverage = [{ area: "register / JP", state: "confirmed-clean", note: "" }]) {
  const d = mkdtempSync(join(tmpdir(), "left-open-depth-"));
  const P = { findings: join(d, "findings.json") };
  writeFileSync(P.findings, JSON.stringify({ schema_version: 2, findings: [], coverage }, null, 2));
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(join(driverDir(d), "jx-lanes.json"), JSON.stringify({ lanes: { [lane]: { depth: "full" } }, fold: { depth } }));
  return { d, P, rows: () => JSON.parse(readFileSync(P.findings, "utf8")).coverage };
}

for (const [lane, jurisdiction, label] of [["ja", "JP", "Japanese-language search depth"], ["ko", "KR", "Korean-language search depth"]]) {
  test(`${label}: the row is the owner's two sentences, partly covered, under a label in words`, () => {
    const depth = verdictsFor(lane, jurisdiction);
    assert.equal(depth[lane].cause, "not-built-for-lane", "premise: the cause the owner's sentences are for");
    const run = runWith(lane, depth);
    injectLaneDepthCoverage(run.P, run.d, () => {});
    const row = run.rows().find((c) => c.area === label);
    assert.ok(row, `no row labelled "${label}": ${JSON.stringify(run.rows().map((c) => c.area))}`);
    assert.equal(row.note, OWNER[lane], "the note is the two approved sentences, exactly");
    assert.equal(row.state, "coverage-limited", "the row stays partly covered");
    assert.doesNotMatch(`${row.area} ${row.note}`, /\blane\b|deepening|`full`|disclosed limit|verdict/,
      "nothing from the code's vocabulary, and no closing reassurance about verdicts");
    assert.equal(run.rows().length, 2, "the existing row is untouched");
  });
}

test("the row is written once, whichever label an earlier pass gave it", () => {
  const depth = verdictsFor("ja", "JP");
  const run = runWith("ja", depth);
  injectLaneDepthCoverage(run.P, run.d, () => {});
  injectLaneDepthCoverage(run.P, run.d, () => {});
  assert.equal(run.rows().filter((c) => /search depth|investigation depth/i.test(c.area)).length, 1, "a second pass adds nothing");

  const older = runWith("ja", depth, [{ area: "Native-language investigation depth / ja", state: "coverage-limited", note: "older wording" }]);
  injectLaneDepthCoverage(older.P, older.d, () => {});
  assert.equal(older.rows().length, 1, "a row under the earlier label is not written a second time under the new one");
});

test("every other cause keeps its fuller note and its label", () => {
  const run = runWith("zh", { zh: { asked: "full", ran: "candidates", shortfall: true, cause: "requested-full-ran-candidates",
    why: "asked for full and ran candidates only — serp-grid not-armed, nativeread not-armed" } });
  injectLaneDepthCoverage(run.P, run.d, () => {});
  const row = run.rows().find((c) => c.area === "Native-language investigation depth / zh");
  assert.ok(row, "the other cause keeps its label");
  assert.match(row.note, /not a change to any verdict/);
  assert.equal(row.state, "coverage-limited");
});
