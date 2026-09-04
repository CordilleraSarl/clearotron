// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — SECTION SELECTION FAILS OPEN WHEN IT IS A DENYLIST.
//
// fixed WHICH LINES in a section are corrections. This is the section itself. The rule shipped as a
// denylist of the reviewer's self-audit headings and lasted hours: a live review carried
// `## Skeptic flags and reopen deferrals`, on nobody's list, holding six bullets that are the reviewer's
// record of what it had ALREADY resolved. All six parsed as corrections and would have been published as
// grounds of a BLOCKING verdict beside the eleven real ones — 17 rows where 11 are real.
//
// TWO SPECIMENS, BECAUSE ONE IS NOT A VERIFICATION. The same reviewer skill emits `**1. [kind: …]` on one
// run and `1. **[kind: …]` on another, so 's failure was intermittent and a fix keyed to one format
// proves nothing about the other. Both preserved reviews are reproduced here structurally:
//   format A → 14 rows, 14 typed, 0 untyped
//   format B → 11 rows, 11 typed, 0 untyped   (17/11/6 before this change)
//
// Built, not copied — the reviews name real companies and this tree is de-identified by design.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCorrections, parseCorrectionKinds, correctionsSection, CORRECTIONS_SECTION_RE } from "../verify.mjs";

const flags = (n, bold) => Array.from({ length: n }, (_, i) => bold
  ? `**${i + 1}. [kind: fact] [on: ${i + 1}] the record does not support the sentence**`
  : `${i + 1}. **[kind: fact] [on: ${i + 1}] the record does not support the sentence**`)
  .join("\nFix: correct it.\n\n");

// The live document's shape: a sanity section, the corrections, the plan audit, a section of things the
// reviewer already dealt with, and a profile section.
const review = (n, bold) => `# BLOCKING

## Headline, re-derived independently

- **Self-conflict?** handled correctly in the body.
- **Risk shape?** not overstated.

## Flagged corrections

${flags(n, bold)}

## PLAN-EXECUTION CHECK

- every planned slice was executed

## Skeptic flags and reopen deferrals

- Ledger self-contradiction → **corrected** in the narrative.
- Reach-through unsupported → **closed**; it now has its own search.
- No registrability read in the manifest → **addressed** in substance.
- Deferral for the transliterated variant → **visible** as a named open item.
- Crowd claim narrowed → **corrected**.
- Awareness item dropped → **closed**.

## Grounded profiles

- one profile per adversarial finding
`;

test("#1570 only the corrections section is read — both correction formats, both counts", () => {
  for (const [label, bold, n] of [["format A (**1.)", true, 14], ["format B (1. **)", false, 11]]) {
    const k = parseCorrectionKinds(review(n, bold));
    assert.equal(k.total, n, `${label}: expected ${n} rows, got ${k.total}`);
    assert.equal(k.untyped, 0, `${label}: every row is the reviewer's own declaration`);
    assert.equal(k.counts.fact, n, label);
  }
});

test("#1570 the already-resolved items are in NO row — this is the defect", () => {
  // Six bullets recording work the reviewer had finished. Under the denylist all six became `fact`
  // corrections and would have been cited as the grounds a BLOCKING verdict rested on.
  for (const bold of [true, false]) {
    const rows = parseCorrections(review(11, bold));
    for (const marker of ["corrected", "closed", "addressed", "visible"])
      assert.ok(!rows.some((r) => new RegExp(`\\\\*\\\\*${marker}\\\\*\\\\*`, "i").test(r.text)),
        `a "${marker}" item was parsed as a correction`);
    assert.ok(!rows.some((r) => /Ledger self-contradiction|Reach-through unsupported/.test(r.text)));
  }
});

test("#1570 a section nobody anticipated contributes NOTHING — the allowlist fails closed", () => {
  // The whole point. Under a denylist this section is corrections because nobody listed it; under an
  // allowlist it is not corrections because nobody allowed it. Same unknown heading, opposite outcome.
  const md = `# BLOCKING

## Flagged corrections

**1. [kind: rating] [on: 2] the band is averaged**

## A Heading Nobody Has Ever Written Before

- this line is not a correction
- neither is this one
`;
  const rows = parseCorrections(md);
  assert.equal(rows.length, 1, "one correction, from the one section that says it holds corrections");
  assert.equal(rows[0].kind, "rating");
});

test("#1570 the allowlist keys on the WORD, because reviews write the heading five ways", () => {
  // Measured across the preserved reviews on the test instance rather than guessed. A literal
  // `Flagged corrections` would have dropped three of these.
  for (const h of ["Flagged corrections", "Residual corrections", "Flagged correction still standing",
    "Corrections that still stand", "CORRECTIONS"])
    assert.ok(CORRECTIONS_SECTION_RE.test(h), `"${h}" is a corrections heading and must be recognised`);
  for (const h of ["Skeptic flags and reopen deferrals", "Headline, re-derived independently",
    "PLAN-EXECUTION CHECK", "Grounded profiles", "Fresh probe"])
    assert.ok(!CORRECTIONS_SECTION_RE.test(h), `"${h}" is not a corrections heading`);
});

test("#1570 a document that names NO corrections section still yields its corrections", () => {
  // 's fixture is exactly this, and 's writes them under `## Corrections`. The allowlist must not
  // turn a headless review into a silent zero — the fallback applies only where there is no section
  // structure to get wrong, so it cannot reopen the defect above.
  const headless = "BLOCKING\n\n- the owner is wrong\n- the tier is wrong\n";
  const k = parseCorrectionKinds(headless);
  assert.equal(k.total, 2);
  assert.equal(k.counts.fact, 2, "#571's contract");
  assert.equal(k.section, null, "and the parse SAYS it read no named section");
  assert.equal(correctionsSection(headless).named, false);
});

test("#1570 the parse states which section it read — zero rows is two different facts", () => {
  const withSection = review(11, true);
  assert.equal(parseCorrectionKinds(withSection).section, "Flagged corrections");
  assert.equal(correctionsSection(withSection).named, true);
  // An empty corrections section and a document with no such section both total 0, and a reader has to
  // be able to tell them apart: one means nothing was flagged, the other means we looked nowhere.
  const emptySection = "# CLEAR\n\n## Flagged corrections\n\nNothing to flag on this pass.\n";
  const k = parseCorrectionKinds(emptySection);
  assert.equal(k.total, 0);
  assert.equal(k.section, "Flagged corrections", "we looked, and it was empty");
  assert.equal(parseCorrectionKinds("# CLEAR\n\nnothing here\n").section, null, "we looked nowhere");
});
