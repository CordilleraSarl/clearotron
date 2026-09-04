// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Pure tests for the spec-A4 own-rights evidence gate (mirror of use-check.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findOwnRightsViolations } from "../own-rights.mjs";

const narrative = (blocks) => `# Synthesis narrative\n\n## Bottom line\nfine.\n\n${blocks.join("\n\n")}\n`;

const RELIANT = `### Finding 2 — AGE OF EMPIRES II: SATIN & STEEL
**Composite — 2 (Manageable).**
The AGE OF EMPIRES prefix is the client's own registered mark, which shields the compound title.`;

test("house-mark reliance without an Own-rights source line → violation", () => {
  const v = findOwnRightsViolations(narrative([RELIANT]));
  assert.equal(v.length, 1);
  assert.match(v[0].finding, /Finding 2/);
});

test("the evidence line satisfies; so does the honest negative", () => {
  assert.equal(findOwnRightsViolations(narrative([
    RELIANT + `\n- **Own-rights source:** /mark/eu/000123456, /mark/us/75123456`,
  ])).length, 0);
  assert.equal(findOwnRightsViolations(narrative([
    RELIANT + `\n- **Own-rights source:** no applicant-owned registrations in the searched register material`,
  ])).length, 0);
  // archived runs carry the retired sweep-negative literal — the linter still accepts it (free-form source text)
  assert.equal(findOwnRightsViolations(narrative([
    RELIANT + `\n- **Own-rights source:** own-portfolio sweep — no registrations found`,
  ])).length, 0);
});

test("findings that do not lean on the client's own rights are not policed", () => {
  const v = findOwnRightsViolations(narrative([
    `### Finding 1 — SATIN & BRONZE\n**Composite — 3 (Medium).**\nThe owner's registration is US-only; genre distance narrows the conflict.`,
  ]));
  assert.equal(v.length, 0);
});

test("reliance phrasing variants trigger; non-finding sections do not", () => {
  for (const phrase of [
    "rests on the client's own registered house mark",
    "the franchise root carries the clearance",
    "the applicant's own live registration covers the prefix",
  ]) {
    const v = findOwnRightsViolations(narrative([`### Finding 3 — X\n**Composite — 3.**\nReasoning: ${phrase}.`]));
    assert.equal(v.length, 1, phrase);
  }
  const actions = findOwnRightsViolations(narrative([`## Actions\n- Confirm the client's own registered mark portfolio.`]));
  assert.equal(actions.length, 0, "Actions section paraphrase is not a finding");
});

test("empty/missing input → no violations, never throws", () => {
  assert.equal(findOwnRightsViolations("").length, 0);
  assert.equal(findOwnRightsViolations(null).length, 0);
});

test("applicant-unknown interplay: the neutral disregard note is a hypothesis, never own-rights reliance", () => {
  const v = findOwnRightsViolations(narrative([
    `### Finding 1 — THIS IS MY MATCHDAY — Mystery Owner LLC
**Composite — 4 (High).**
Identical registration in the searched class.
- **Note:** if this is the applicant's own prior filing, disregard.`,
  ]));
  assert.equal(v.length, 0, "the 'if this is the applicant's own filing, disregard' note must not demand an own-rights sweep");
});
