// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A SECTION NAME THE SKILL SPELLS TWO WAYS IS NOT A MISSING SECTION.
//
// An R6 clearance on the openai engine failed `common-law-half:a` TWICE on `missing:negative-results` with
// the section present and complete: the document carried "## Negative-results matrix" and zero
// occurrences of the spaced form the gate matched. The anthropic R6 that delivered on the same scenario
// wrote the spaced form three times — so the gate had been passing on one engine's phrasing habit, and
// the skill itself uses both spellings for all three of these sections (negative results 14/8, coverage
// ledger 39/9, audit trail 41/6, space/hyphen across driver/skills).
//
// THE ARM DRIVES BOTH DIRECTIONS, because a fix that merely stops rejecting is the way this one fails:
// the hyphenated headings must PASS, and a document with the section genuinely absent must still FAIL
// with its reason unchanged. The third arm is the one that would catch "delete the gate".
import { test } from "node:test";
import assert from "node:assert/strict";
import { validators } from "../verify.mjs";

const P = "/tmp/spelling-arm/common-law-findings.md";

// A document that satisfies every OTHER structural requirement, so a failure can only be the heading
// match: a findings heading, a pipe table, and a coverage-ledger status row.
const doc = ({ neg, cov, aud }) => `# Common-law findings — EXAMPLEMARK

## Findings

Nothing of consequence surfaced on the marketplace axis for this mark, and the rows below carry the
receipt for every cell the grid program executed against every named variant and platform.

| variant | platform | result |
|---|---|---|
| EXAMPLEMARK | Steam | No results |
| EXAMPLEMARK | Google Play | No results |

## ${neg}

| variant | platform | receipt |
|---|---|---|
| EXAMPLEMARK | Steam | No results |
| EXAMPLEMARK | Google Play | No similar listings (4 candidates reviewed) |

## ${cov}

| axis | status |
|---|---|
| marketplace | confirmed-clean |

## ${aud}

The grid program ran once, and every call it made is recorded above with its own receipt line.
`;

const SPACED = { neg: "Negative results matrix", cov: "Coverage ledger", aud: "Audit trail" };
const HYPHENATED = { neg: "Negative-results matrix", cov: "Coverage-ledger", aud: "Audit-trail" };

test("2152 the SPACED headings still pass — the regression guard on the form that already worked", () => {
  const r = validators.commonLaw(P, doc(SPACED));
  assert.equal(r.ok, true, `the spaced form must keep passing; got ${JSON.stringify(r)}`);
});

test("2152 the HYPHENATED headings pass — the compound the skill's own checklist uses", () => {
  const r = validators.commonLaw(P, doc(HYPHENATED));
  assert.equal(r.ok, true,
    "a document carrying '## Negative-results matrix' has the section; rejecting it cost a clearance "
    + `that had already spent an hour. Got ${JSON.stringify(r)}`);
});

test("2152 a section that is GENUINELY ABSENT still fails, with its reason unchanged", () => {
  // Every other section present; only the negative-results one removed. This is the arm that fails if
  // the fix were "widen until nothing is rejected".
  const body = doc(SPACED).replace(/## Negative results matrix[\s\S]*?(?=## Coverage ledger)/, "");
  assert.ok(!/negative[\s-]results/i.test(body), "control: the fixture really has no such section");
  const r = validators.commonLaw(P, body);
  assert.equal(r.ok, false, "an absent section must still be refused");
  assert.match(String(r.reason ?? ""), /negative-results/,
    "and the reason must still name it, so the message does not change meaning");
});

test("2152 the sibling tokens are widened too — the class, not the instance", () => {
  // coverage ledger and audit trail carry the identical ambiguity in the skill and happened not to bite.
  for (const key of ["cov", "aud"]) {
    const mixed = { ...SPACED, [key]: HYPHENATED[key] };
    const r = validators.commonLaw(P, doc(mixed));
    assert.equal(r.ok, true, `the hyphenated ${key} heading must pass too; got ${JSON.stringify(r)}`);
  }
});
