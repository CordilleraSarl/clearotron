// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// F2 rule-shape detector — flags a rating decided by a cutoff/blanket rule (clearance is reasoned, not
// computed), and CRITICALLY does NOT flag the base-rate counts the engine encourages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findRuleShapeFlags } from "../rule-shape.mjs";

test("flags rule-shaped reasoning: Level/Composite cutoffs, thresholds, blanket rules", () => {
  for (const t of [
    "treat anything at Level C or above as High",
    "Composite 3+ always blocks the launch",
    "above Level C we recommend hold",
    "a 60% confusion threshold decides the rating",
    "rate it automatically as high",
    "any descriptive mark is Level B",
    "in every case score the famous mark high",
  ]) assert.ok(findRuleShapeFlags(t).length > 0, `must flag: ${t}`);
});

test("does NOT flag base-rate counts / the firm formula (the engine ENCOURAGES counts over adjectives)", () => {
  for (const t of [
    "640 of 3,060 live filings claim gaming software",
    "545 live JELLY filings worldwide; the element is heavily diluted",
    "127k overwhelmingly positive Steam reviews; 1m+ downloads",
    "75% of the class-9 filings are dead",
    "Level 3 Risk = C + Horse Trade",
    "Level 5 Risk = E + Classic",
    "8,575 live BR(E)AKER filings (2,317 claim gaming)",
    "the registration is revocable for non-use after 5 years",
  ]) assert.deepEqual(findRuleShapeFlags(t), [], `must NOT flag: ${t}`);
});

test("does NOT flag PRESENTATION cutoffs (where findings are shown/banded, not a rule deciding the rating)", () => {
  for (const t of [
    "Findings at Level C or above are detailed below",
    "Composite 3 or above findings are listed below",
    "marks at Level C or above appear in the table that follows",
  ]) assert.deepEqual(findRuleShapeFlags(t), [], `presentation, not a rule: ${t}`);
  assert.ok(findRuleShapeFlags("treat anything at Level C or above as High").length > 0, "a real decision cutoff still flags");
});

test("does NOT flag matrix-citation (Appendix B — the customer's risk matrix is a sanctioned rubric, not a us-invented shortcut)", () => {
  for (const t of [
    "a finding at Level C or above tops out at Medium per the matrix",
    "this is automatically Medium because the matrix puts Level C + Paper there",
    "read the Composite off the matrix; Level C or above caps at Medium under the ceiling",
  ]) assert.deepEqual(findRuleShapeFlags(t), [], `matrix-citation, not a shortcut: ${t}`);
  // a genuine us-invented shortcut carrying NO matrix vocabulary still flags
  assert.ok(findRuleShapeFlags("we treat anything at Level C or above as High").length > 0, "non-matrix shortcut still flags");
});

test("doc-27 Item 3: the matrix DERIVATION 'Level C + <DisputeType>' is exempt; a bare '+' cutoff still flags", () => {
  for (const t of [
    "Level C + Horse Trade",                       // the "+" joins a Dispute Type → matrix derivation
    "Composite 3 + Paper Conflict",
    "we graded it Level C + Classic for that owner",
  ]) assert.deepEqual(findRuleShapeFlags(t), [], `full matrix-derivation citation must NOT flag: ${t}`);
  for (const t of [
    "we treat Level C + as the hold line",         // bare "+" cutoff, no Dispute Type follows
    "anything Composite 3 + is escalated",
    "Level C +\nHorse Trade is a separate finding", // EOL guard: the "+" does NOT join the next-line word
  ]) assert.ok(findRuleShapeFlags(t).length > 0, `bare "+" cutoff (or cross-line) must still flag: ${t}`);
});

// Map C — the reworded synthesis USE-CHECK guidance is per-finding ("regardless of its Composite
// rating"), so the MODEL OUTPUT it produces must NOT read as a rule-shaped cutoff; a genuine
// aggregate-threshold summary (the prose Map C exists to stop the model emitting) still flags.
// (The stage MESSAGE / Goodhart guard note are instructions, never scanned by this instrument — only
// the synthesis narrative/report surfaces are.)
test("Map C: per-finding use-check wording does NOT flag; an aggregate Composite-cutoff summary DOES", () => {
  const perFinding = "The verdict for this finding turns on the absence of use (regardless of its Composite rating), so a scoped use-check was run and cited.";
  assert.deepEqual(findRuleShapeFlags(perFinding), [], "per-finding use-absence reasoning is not a rule");
  assert.ok(findRuleShapeFlags("All Composite 3+ findings carry verified use-check sources").length > 0, "the aggregate-threshold summary Map C retires still flags");
  assert.ok(findRuleShapeFlags("Composite 3+ findings are always high").length > 0, "a real aggregate threshold summary still flags");
});

test("pure + tolerant: empty/missing input → []", () => {
  assert.deepEqual(findRuleShapeFlags(""), []);
  assert.deepEqual(findRuleShapeFlags(null), []);
  assert.deepEqual(findRuleShapeFlags(undefined), []);
});

test("dedupes identical matches; returns {why, snippet}", () => {
  const f = findRuleShapeFlags("Level C or above is high. And again Level C or above is high.");
  assert.equal(f.length, 1, "identical match deduped");
  assert.ok(f[0].why && f[0].snippet, "shape is {why, snippet}");
});
