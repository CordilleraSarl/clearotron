// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Unit tests for the WS2 use-check enforcement substrate (use-check.mjs).
// Pure offline: the predicate runs over a literal narrative string. No network, no gateway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findUseCheckViolations } from "../use-check.mjs";

// Build a narrative with a "## Bottom line", a "## Actions" section (which paraphrases use language but is NOT
// a finding), and the given "### Finding N" blocks — so we test finding-scoping too.
function narrative(findingBlocks) {
  return [
    "# Preliminary trademark review",
    "## Bottom line",
    "Medium risk; the owner's class-9 mark is most likely unused and vulnerable to non-use cancellation.",
    "## Actions (open external checks)",
    "1. Confirm whether the owner actually uses class 9 for game software. See Finding 1.",
    "## Findings",
    ...findingBlocks,
  ].join("\n");
}

const MYRKUR = [
  "### Finding 1 — \"Myrkur\" (registered EU word mark, classes 9 + 41) — HEADLINE",
  "- **Source:** Register (EUIPO). EU word mark 018151878, owner Øksemorder IVS.",
  "- **Business / practical read:** The owner is a music act. Its class-9 coverage is almost certainly **not in actual use**; past the grace period it is vulnerable to revocation for non-use.",
  "- **Composite — 3 (Medium).**",
];

test("(a) Composite-3 use-negative finding with NO use-check source → 1 violation", () => {
  const v = findUseCheckViolations(narrative(MYRKUR));
  assert.equal(v.length, 1);
  assert.match(v[0].finding, /Finding 1/);
  assert.equal(v[0].composite, 3);
});

test("(b) same finding WITH a cited Use-check source (real URL) → passes", () => {
  const withSource = [...MYRKUR, "- **Use-check source:** https://store.example/owner-game — no game titles found."];
  assert.equal(findUseCheckViolations(narrative(withSource)).length, 0);
});

test("(c) honest 'perplexity_research — no result' value satisfies (never blocks on a search miss)", () => {
  const withMiss = [...MYRKUR, "- **Use-check source:** perplexity_research — no result"];
  assert.equal(findUseCheckViolations(narrative(withMiss)).length, 0);
});

test("(d) a Composite-2 use-negative finding does NOT trigger (manageable doesn't justify the query)", () => {
  const c2 = [
    "### Finding 2 — minor mark",
    "- **Business / practical read:** likely unused; non-use cancellation available.",
    "- **Composite — 2 (Manageable).**",
  ];
  assert.equal(findUseCheckViolations(narrative(c2)).length, 0);
});

test("(e) a Composite-3 finding with NO use-dependence (e.g. common-law) is not policed", () => {
  const common = [
    "### Finding 3 — live competitor game",
    "- **Source:** Common-law. A live RPG on the app stores.",
    "- **Business / practical read:** common-law rights only; no registration; settlement likely.",
    "- **Composite — 3 (Medium).**",
  ];
  assert.equal(findUseCheckViolations(narrative(common)).length, 0);
});

test("(f) floor-safe: a use-negative finding with an UNPARSEABLE Composite is still caught", () => {
  const wobble = [
    "### Finding 4 — odd format",
    "- **Business / practical read:** owner's use unknown; vulnerable to non-use revocation.",
    "- **Composite — High.**", // no digit → must default to ≥3, not silently pass
  ];
  const v = findUseCheckViolations(narrative(wobble));
  assert.equal(v.length, 1);
  assert.equal(v[0].composite, null);
});

test("(g) the Actions / Bottom line sections paraphrase use language but are NOT flagged (not findings)", () => {
  // narrative() always includes a Bottom line + Actions with non-use language and no source line; with a clean
  // finding present, the only thing that could (wrongly) fire is those sections.
  const cleanFinding = [
    "### Finding 5 — clean",
    "- **Business / practical read:** owner actively sells the goods; no use issue.",
    "- **Composite — 4 (High).**",
  ];
  assert.equal(findUseCheckViolations(narrative(cleanFinding)).length, 0);
});

test("(h) two triggering findings → two violations; both cited → zero", () => {
  const second = [
    "### Finding 9 — another filed-but-idle mark",
    "- **Business / practical read:** no marketplace use found; vulnerable to non-use cancellation.",
    "- **Composite — 4 (High).**",
  ];
  assert.equal(findUseCheckViolations(narrative([...MYRKUR, ...second])).length, 2);
  const cited = narrative([
    ...MYRKUR, "- **Use-check source:** perplexity_research — no result",
    ...second, "- **Use-check source:** https://x.example — none",
  ]);
  assert.equal(findUseCheckViolations(cited).length, 0);
});

test("empty / missing content → no violations, never throws", () => {
  assert.equal(findUseCheckViolations("").length, 0);
  assert.equal(findUseCheckViolations(undefined).length, 0);
});
