// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PLAN-AUDIT LINE CANNOT OPEN A SECTION. The review's audit lines are the reviewer's own, rendered under the
// plan-execution heading. A recheck after a correction wrote one of them as a line of capitals naming
// corrections, the parsers read it as the document's corrections section, the flags above it counted none, and
// the round-trip refused the call. The reviewer sent the same call again and it was refused again, so the
// recheck recorded no review. Measured on a saved recheck, 2026-11-03.
import { test } from "node:test";
import assert from "node:assert/strict";

import { acceptRefutation, renderRefutation } from "../narrative-refutation-record.mjs";
import { parseCorrectionKinds, countCitedDefects, parseCorrections } from "../verify.mjs";

const FLAGS = [
  { kind: "fact", text: "Finding 3 gives the owner of the earlier filing as the applicant of the later one.", on: [3] },
  { kind: "fact", text: "Finding 4 cites a registration date the record does not carry.", on: [4], fix: "Take the date from the record." },
];
const PLAN_AUDIT = [
  "The receipt records 12 executed entries and none missing; no clean claim rests on a slice that did not run.",
  "CORRECTION REVIEW SCOPE",
  "This recheck covers findings 3 and 4, which the correction changed.",
  "PRIOR FLAGS",
  "- Prior flag 1 is resolved: finding 2 now names its owner.",
  "## Corrections carried forward",
  "Nothing else carries forward.",
];

test("the cause: a heading-shaped audit line naming corrections hides the flags from the parse", () => {
  const verbatim = ["CONDITIONAL", "", "## Flags", "",
    `1. [kind: fact] [on: 3] ${FLAGS[0].text}`, "", `2. [kind: fact] [on: 4] ${FLAGS[1].text}`, "",
    "## PLAN-EXECUTION CHECK", "", ...PLAN_AUDIT, ""].join("\n");
  const kinds = parseCorrectionKinds(verbatim);
  assert.equal(kinds.section, "CORRECTION REVIEW SCOPE", "the audit line is taken for the corrections section");
  assert.equal(kinds.counts.fact, 0, "so the two typed flags above it are not read: the refusal said 0 where the call typed 2");
  assert.equal(countCitedDefects(verbatim), 3, "and the audit's list line after a heading-shaped line is counted as a cited defect");
});

test("a recheck whose audit carries such lines is accepted, with its flags read as typed", () => {
  const r = acceptRefutation({ verdict: "CONDITIONAL", flags: FLAGS, plan_audit: PLAN_AUDIT }, { receiptPresent: true });
  assert.equal(r.ok, true, r.reason);
  const kinds = parseCorrectionKinds(r.content);
  assert.equal(kinds.counts.fact, 2);
  assert.equal(kinds.untyped, 0);
  assert.equal(countCitedDefects(r.content), 2);
  assert.deepEqual(parseCorrections(r.content).map((c) => c.ordinals), [[3], [4]]);
});

test("a heading-shaped audit line renders in bold with its words; every other line renders as written", () => {
  const md = renderRefutation("CONDITIONAL", FLAGS, PLAN_AUDIT);
  const audit = md.split("## PLAN-EXECUTION CHECK\n\n")[1].trimEnd().split("\n");
  assert.deepEqual(audit, [
    PLAN_AUDIT[0],
    "**CORRECTION REVIEW SCOPE**",
    PLAN_AUDIT[2],
    "**PRIOR FLAGS**",
    PLAN_AUDIT[4],
    "**Corrections carried forward**",
    PLAN_AUDIT[6],
  ]);
});
