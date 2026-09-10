// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ONE RULE, TWO COPIES, PINNED.
//
// The two-register rule is written twice on purpose, and the reason is the reach rather than an oversight.
// `report-prose.md` is loaded by `synthesis`, `report-overview` and `report-card` — the clearance stages,
// pinned in report-prose-standard.test.mjs. The knockout assessment stage is NOT among them and cannot
// read that file, so `knockout-assess/SKILL.md` carries its own statement of the same rule.
//
// A POINTER WOULD HAVE BEEN WORSE THAN A COPY. Moving the swaps into the canonical file and referring to
// them from the knockout doctrine would read as tidier and would put the rule where that seat cannot
// open it — the same defect as a doctrine file shadowed whole in the configuration repository, arriving
// by a different road. So: two copies, and this holds them to the same words.
//
// What is NOT pinned is the field list. Each product names the fields ITS seat writes, and those differ
// legitimately — `net` and `purpleNotes` on one, the one-liner and the four answers on the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PLAIN_FORMS, SENTENCE_WORD_LIMIT } from "../plain-register.mjs";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const CLEARANCE = readFileSync(join(SKILLS, "prelim-search/report-prose.md"), "utf8");
const KNOCKOUT = readFileSync(join(SKILLS, "knockout-assess/SKILL.md"), "utf8");
const BOTH = [["the clearance prose standard", CLEARANCE], ["the knockout doctrine", KNOCKOUT]];

test("both products state the rule, and neither is the only one that does", () => {
  for (const [what, text] of BOTH) {
    assert.match(text, /two-register rule|Two registers/i, `${what} does not state the rule`);
    assert.match(text, new RegExp(`${SENTENCE_WORD_LIMIT} words`),
      `${what} does not carry the sentence limit — a rule without its number is advice`);
  }
});

test("every worked swap appears in BOTH copies, in the same words", () => {
  // The copies exist because the two seats read different files. They drift the moment one is edited
  // alone, and a seat taught half a rule writes half a report.
  for (const [term, plain] of PLAIN_FORMS) {
    if (!term || !plain) continue;   // the engine word with no replacement is stated as prose, not as a row
    for (const [what, text] of BOTH) {
      assert.ok(text.toLowerCase().includes(term.toLowerCase()),
        `${what} does not carry the swap for "${term}"`);
      assert.ok(text.toLowerCase().includes(plain.toLowerCase()),
        `${what} names "${term}" without the plain form "${plain}" a writer is meant to use instead`);
    }
  }
});

test("the code the reviewer uses and the doctrine the seat reads name the same terms", () => {
  // The third copy is `plain-register.mjs`, and it is the one that would drift silently: a term added
  // to the module and not to the doctrine flags a seat for a rule it was never given.
  for (const [term] of PLAIN_FORMS) {
    if (!term) continue;
    assert.ok(CLEARANCE.toLowerCase().includes(term.toLowerCase()),
      `the reviewer flags "${term}" but no doctrine a clearance seat reads mentions it`);
  }
});

test("both copies refuse the cheap wrong fix in the same words", () => {
  // "Reject: shortening by dropping the reasons." A seat told only to shorten will drop the why, which
  // is the one thing the reader needed, and the result passes every length check.
  for (const [what, text] of BOTH) {
    assert.match(text, /dropping the reason|the "?why"? stays|never cut evidence|trades away a fact/i,
      `${what} does not forbid shortening by dropping the reason`);
  }
});

test("neither copy claims a gate fails on this", () => {
  // It is presentation. A doctrine that reads as a delivery gate makes a seat write to pass rather than
  // to be read, which is the defect the prose standard's own header warns against.
  for (const [what, text] of BOTH) {
    assert.doesNotMatch(text, /this (?:rule|test) fails the (?:run|delivery|stage)/i,
      `${what} reads as a gate; a hit is a rewrite, never a run failure`);
  }
});
