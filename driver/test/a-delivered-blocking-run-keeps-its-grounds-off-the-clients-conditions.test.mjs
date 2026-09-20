// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-delivered-blocking-run-keeps-its-grounds-off-the-clients-conditions.test.mjs — a BLOCKING verdict's
// grounds are the run record's, and the client's conditions are the authored ones.
//
// Measured on a delivered run (2026-09-20): the sidecar carried 5 stored clauses and 15 reasons, of which
// the reviewer's own cited correction lines were appended with no clause. `clientConditions` prints any
// reason that has no clause and carries no engine token, so the client's CONDITIONS section rendered 13
// items — 5 authored, 8 the reviewer's lines about coverage and the engine's reading of its own draft.
//
// The pipeline now stores an explicit null clause for each appended ground, which is the shipped way of
// saying "recorded, not rendered", and the arrays stay index-aligned because `orderClausesForLede` returns
// them the same length.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clientConditions, orderClausesForLede } from "../terminal-clamp.mjs";
import { riskStatement } from "../findings-model.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

// The run's shape, in invented words: five authored conditions, eight appended grounds.
const CLAUSES = ["consent from the prior owner is not in hand", "the examiner's objection is unanswered",
  "the coexistence deal is unsigned", "the assignment is not recorded",
  "3 of the 40 live registrations identical or near-identical to the mark are not individually addressed in this report — each remains an open point a reader must weigh"];
const REASONS = ["Obtain consent.", "Respond to the objection.", "Sign the deal.", "Record the assignment.",
  "floor_duty_undischarged:3 of 40 floor row(s)"];
const GROUNDS = [
  "register / non-Latin forms in two scripts: the forms were read to completion",
  "searched to completion and read, with no conflicting incumbent on the material searched",
  "the marketplace sweep reached every listed platform",
  "the owner check answered for each promoted filing",
  "the class list matches the instruction",
  "no case-law lane was in scope for this order",
  "the variant manifest covers the ratified forms",
  "the coverage ledger carries no open row",
];

/** The sidecar the pipeline now writes for a delivered BLOCKING run. */
const sidecar = () => {
  const { clauses, reasons } = orderClausesForLede(CLAUSES, REASONS, new Set());
  return { verdict: "BLOCKING", tier: "Medium", reasons: [...reasons, ...GROUNDS],
    clauses: [...clauses, ...GROUNDS.map(() => null)] };
};

test("the client's conditions are the authored ones; the reviewer's grounds are recorded and not rendered", () => {
  const v = sidecar();
  assert.equal(v.reasons.length, 13, "the record still carries every ground");
  const shown = clientConditions(v);
  assert.equal(shown.length, 5, `the client read ${shown.length} conditions; the authored ones are 5`);
  for (const g of GROUNDS) assert.ok(!shown.includes(g), `a reviewer's ground reached the client: ${g}`);
  for (const c of CLAUSES) assert.ok(shown.includes(c), "an authored condition was dropped");
});

test("the defect, as it stood: with no stored clause the same grounds print as conditions", () => {
  // The shape this run actually delivered — 5 clauses, 13 reasons, 13 conditions on the page.
  const before = { verdict: "BLOCKING", tier: "Medium", reasons: [...REASONS, ...GROUNDS], clauses: CLAUSES };
  assert.equal(clientConditions(before).length, 13,
    "the arm above would pass over a composer that never rendered a clause-less reason at all");
});

test("the pipeline stores a null clause per appended ground, and the statement is composed from the same array", () => {
  const src = readFileSync(join(ROOT, "driver", "pipeline.mjs"), "utf8");
  assert.match(src, /const clausesOut = blockingGrounds\.length\s*\n\s*\? \[\.\.\.orderedClauses, \.\.\.blockingGrounds\.map\(\(\) => null\)\]/,
    "the grounds no longer carry an explicit null clause");
  assert.match(src, /riskStatement\(\{ tier: derived\.tier, verdict, reasons: reasonsOut, clauses: clausesOut,/);
  assert.match(src, /reasons: reasonsOut, clauses: clausesOut, kinds: kindsOut,/, "the sidecar is written from the same array");
});

test("nothing the statement says moves: BLOCKING keeps its fixed sentence", () => {
  const v = sidecar();
  assert.equal(riskStatement({ tier: v.tier, verdict: "BLOCKING", reasons: v.reasons, clauses: v.clauses }),
    riskStatement({ tier: v.tier, verdict: "BLOCKING", reasons: [], clauses: [] }));
});
