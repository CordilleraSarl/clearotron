// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the coverage-claim check, on invented report text
//
// COMMON-LAW COVERAGE IS COVERAGE THE RUN SEARCHED, WHEN ITS GRID SEARCHED.
//
// The region table names common law as `C/L`, so a sentence about common-law coverage reads to the coverage-claim
// check as a claim about a territory. The set it compares with is the register's jurisdictions alone, so the claim
// failed on every run, whether the common-law grid had searched or not. On a test run, 2026-10-28, a narrative whose
// common-law grid had answered every one of its searches failed the check on its common-law sentence. The same
// check read "the United Kingdom" as `UK` and the searched set holds `GB`, so a run that searched the British
// register failed a sentence saying so. A grid cell is a search that came back, `hit` or `no_hit`; a query that
// failed is a gap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageClaimChecks, commonLawGridSearched } from "../predelivery-lint.mjs";

const SENTENCE = "Our search covered the registers of the United Kingdom and common-law use across the web.";
const failing = (o) => coverageClaimChecks({ text: SENTENCE, searchedJurisdictions: ["GB", "EU"], surface: "narrative", ...o })
  .filter((c) => !c.pass).map((c) => c.detail);
const grid = (...statuses) => ({ cells: statuses.map((status, i) => ({ term: `term-${i}`, platform: "web", status, candidates: [] })), gaps: [] });

test("a common-law coverage sentence passes when the run's common-law grid answered a search", () => {
  assert.deepEqual(failing({ commonLawSearched: commonLawGridSearched(grid("hit", "no_hit")) }), []);
});

test("the same sentence still fails when the grid answered nothing, or the run had none", () => {
  for (const g of [null, { cells: [], gaps: [{ term: "term-0", platform: "web", error: "timeout" }] }]) {
    const out = failing({ commonLawSearched: commonLawGridSearched(g) });
    assert.equal(out.length, 1, `expected one failure for ${JSON.stringify(g)}`);
    assert.match(out[0], /Common-law \(C\/L\)/);
  }
});

test("a grid of searches that found nothing is still a grid that searched", () => {
  assert.equal(commonLawGridSearched(grid("no_hit")), true);
  assert.equal(commonLawGridSearched(grid()), false);
});

test("a sentence naming the United Kingdom passes when the searched set holds GB", () => {
  const out = coverageClaimChecks({ text: "Register searches covered the United Kingdom.", searchedJurisdictions: ["GB"] });
  assert.deepEqual(out.filter((c) => !c.pass), []);
});

test("THE CONTROL: a territory the run did not search still fails, with the grid searched", () => {
  const out = coverageClaimChecks({ text: "We searched common-law use and the register of Japan.", searchedJurisdictions: ["GB"],
    surface: "narrative", commonLawSearched: true }).filter((c) => !c.pass);
  assert.equal(out.length, 1);
  assert.match(out[0].detail, /Japan \(JP\)/);
});
