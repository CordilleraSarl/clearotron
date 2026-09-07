// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE THIRD COPY OF THE DISPOSITION VOCABULARY, BOUND AT LAST.
//
// removed a hardcoded disposition list from the stages.mjs dictation and left a tripwire
// (disposition-dictation-binding.test.mjs) so it cannot come back. Its verification then named the
// residual: `driver/skills/prelim-search/synthesis-rules.md` hand-lists the same vocabulary in prose —
// the position-required four, the `withdrawn` exemption — and NOTHING bound it. It is in
// STAGES.synthesis.skillReads, a guaranteed read for every synthesis seat, carrying the exact property
// removed one layer down: correct the day it was typed, silently wrong the moment the constant
// moves. records the class; the skills tree was frozen until the doctrine rebuild merged,
// and the residual was re-measured live at the merged head before this file was written.
//
// The precedent is skill-contract-enumerations.test.mjs, and its rule is the one this file obeys:
// AN ASSERTION THAT NAMES MEMBERS OF A SET DOES NOT PIN THE SET. Every disposition assertion here is
// set equality on a list EXTRACTED from the skill at run time against the code's exported constant.
// This file carries a copy of neither. Naming three of four fails; naming a fifth posture fails; a
// sixth token added to the constant fails, because the skill's stated union stops matching.
//
// SCOPE, stated so its edge is visible: this binds the one enumeration block in synthesis-rules.md.
// The `net` requirement two bullets down says "required on exactly the same set, with the same two
// exemptions" — a same-set CLAIM with no list of its own, so there is nothing to extract from it; the
// anchor assertion below pins that it stays a claim rather than growing a fourth copy of the list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSkillReads } from "../stages.mjs";
import { DISPOSITIONS, POSITION_REQUIRED_DISPOSITIONS } from "../findings-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_REL = "skills/prelim-search/synthesis-rules.md";
const SKILL = readFileSync(join(HERE, "..", SKILL_REL), "utf8");

/** Every `backticked` token inside a prose span. */
const ticked = (span) => [...span.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/**
 * The one span between two unique markers. Uniqueness is asserted, not hoped: a second copy of the
 * marker would make "the" span ambiguous, and a missing marker must fail HERE, loudly — an extractor
 * that returns an empty span feeds an empty list to a deepEqual that then explains nothing.
 */
function spanBetween(start, end) {
  const starts = SKILL.split(start).length - 1;
  assert.equal(starts, 1, `marker ${JSON.stringify(start)} appears ${starts}× in ${SKILL_REL} — the enumeration block moved or was rewritten; re-point this guard`);
  const from = SKILL.indexOf(start) + start.length;
  const to = SKILL.indexOf(end, from);
  assert.ok(to > from, `marker ${JSON.stringify(end)} does not follow ${JSON.stringify(start)} in ${SKILL_REL}`);
  return SKILL.slice(from, to);
}

test("the skill file is the guaranteed read it is claimed to be — this guard is not binding dead prose", () => {
  // The LIVE resolution, by stage name — the same list message() emits — with an empty profile so the
  // profile-aware entries fall to their defaults. The file under test is profile-independent.
  const reads = resolveSkillReads("synthesis", { profile: {}, job: {} });
  assert.ok(Array.isArray(reads) && reads.some((r) => String(r).includes(SKILL_REL)),
    `synthesis.skillReads no longer carries ${SKILL_REL} — the vocabulary copy in it stopped reaching the seat, and this file should be re-pointed or retired with that finding`);
});

test("the skill's position-required enumeration IS the constant — set equality, extracted at run time", () => {
  const span = spanBetween("Both positions are required on", "four of the five");
  const stated = ticked(span);
  assert.ok(stated.length > 0, "no backticked tokens between the markers — the enumeration went prose-only and this guard is reading nothing");
  assert.deepEqual([...stated].sort(), [...POSITION_REQUIRED_DISPOSITIONS].sort(),
    `${SKILL_REL} enumerates a different position-required set than findings-model.mjs — the skill copy has drifted from the parser`);
});

test("the skill's stated exemption closes the vocabulary: required set + `withdrawn` = DISPOSITIONS, exactly", () => {
  const span = spanBetween("Two exemptions", "renders in the quiet");
  const stated = ticked(span);
  assert.ok(stated.includes("withdrawn"),
    "the exemption sentence no longer names `withdrawn` — the fifth token is untaught again, which is the original #1004 silence");
  assert.ok(stated.includes("withdrawn_reason"),
    "the exemption sentence no longer names `withdrawn_reason` — the parser throws finding_withdrawn_reason_missing and this sentence is the only guaranteed read that teaches the field");
  // The closure. `ruled_out` is a flag, not a disposition — findings-model has no such token — so the
  // disposition-shaped exemption is `withdrawn` alone, and the union must be the whole constant. A
  // sixth disposition added to the code turns this red: the skill would then be teaching a closed
  // vocabulary one token short, which is exactly the drift this file exists to catch.
  const dispositionExemptions = stated.filter((t) => DISPOSITIONS.includes(t));
  assert.deepEqual(dispositionExemptions, ["withdrawn"], "an exemption token is disposition-shaped and unexpected — the closure below no longer describes the block");
  assert.deepEqual(
    [...new Set([...POSITION_REQUIRED_DISPOSITIONS, "withdrawn"])].sort(),
    [...DISPOSITIONS].sort(),
    `the position-required set plus withdrawn no longer covers DISPOSITIONS — the vocabulary moved and ${SKILL_REL} still teaches the old shape`,
  );
});

test("the `net` bullet stays a same-set CLAIM, not a fourth copy of the list", () => {
  const idx = SKILL.indexOf("required on exactly the same set, with the same two exemptions");
  assert.ok(idx >= 0,
    "the net bullet's same-set sentence is gone — if net now enumerates its own disposition list, that list is a new unbound copy and needs binding the way the block above is bound");
});
