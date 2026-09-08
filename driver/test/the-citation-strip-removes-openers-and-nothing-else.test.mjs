// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE SWEEP THAT REMOVES A CITATION OPENER, DRIVEN OVER A PLANTED TREE.
//
// The sweep rewrites prose across a hundred files in one pass, so the only useful question is what it
// does to a line it should not touch. Every case here is planted rather than read off the repository: a
// helper that can only run over the real tree cannot be shown to be wrong, and "it produced no diff on
// the files I looked at" is not a property.
//
// The three ways this class of sweep fails, each pinned below:
//   · it eats the opener it matched on          — a stripped quote is a broken literal, silently
//   · it eats an item suffix                    — `tracker issue 1149-12` is one identifier, not two
//   · it stops recognising a form               — the `Refs` and the capitalised variants
import { test } from "node:test";
import assert from "node:assert/strict";

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { OPENER, ANY_CITATION, EXCLUDED, isScannable, surveyOf } from "../../scripts/strip-tracker-citations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const strip = (line) => (OPENER.test(line) ? line.replace(OPENER, "$1") : line);

test("the opener is removed and the thing it stood behind is kept, verbatim", () => {
  for (const [before, after] of [
    ["// tracker issue 149 — the same opt-in shape again", "// the same opt-in shape again"],
    ["  # tracker issue 97 — a merged request becomes a release", "  # a merged request becomes a release"],
    ['assert.ok(x, "Refs tracker issue 2075 — an absent file is a finding")',
     'assert.ok(x, "an absent file is a finding")'],
    ["/* tracker issue 12: the reparser was forgotten */", "/* the reparser was forgotten */"],
    ["tracker issue 88 — a line with no comment leader at all", "a line with no comment leader at all"],
  ]) assert.equal(strip(before), after);
});

// THE CAPTURE GROUP IS THE WHOLE DEFENCE, and its absence is invisible in a diff of a hundred files:
// the replacement would be one character shorter and the file would still parse in the lucky cases.
test("an opening quote or bracket SURVIVES — the replacement puts back what it matched on", () => {
  for (const line of [
    'const m = "tracker issue 2075 — an absent file is a finding";',
    "  ('tracker issue 41 — the door answers before the router')",
    "[tracker issue 8 — a bracketed opener]",
    "`tracker issue 9 — a template literal`",
  ]) {
    const out = strip(line);
    assert.notEqual(out, line, `nothing was stripped from: ${line}`);
    for (const q of ['"', "'", "`", "[", "("]) {
      assert.equal((out.match(new RegExp(`\\${q}`, "g")) ?? []).length,
        (line.match(new RegExp(`\\${q}`, "g")) ?? []).length,
        `the sweep changed the count of ${q} in: ${line}`);
    }
  }
});

// AN ITEM SUFFIX IS ONE IDENTIFIER. `tracker issue 1149-12` names item 12; the hyphen has no space
// after it, which is the whole reason the separator is `\s+` rather than `\s*`. Loosen that and the
// sweep silently deletes the item number and leaves a citation naming the wrong thing.
test("an item suffix is NOT an opener — the separator needs the space", () => {
  for (const line of [
    "// tracker issue 1149-12 says the walk starts at the root",
    // The second is the interesting one and it is left alone DELIBERATELY. It reads as an opener
    // standing behind an item number, and the sweep declines it: an item suffix means the citation
    // names one item rather than a whole thread, and a rule that stripped it would silently turn a
    // precise reference into a vague one. Measured, not assumed — the pattern finds no match here.
    "// tracker issue 1149-12 — and this half looks like an opener behind an item",
  ]) assert.equal(strip(line), line, `an item suffix was eaten in: ${line}`);
});

test("a citation INSIDE a sentence is left alone — it cannot be removed without rewriting around it", () => {
  for (const line of [
    "// the walk must start at the root (tracker issue 180), which is why the prune is here",
    "// this is the shape tracker issue 200 was filed about",
    "  * see tracker issue 1712 for the measurement",
  ]) {
    assert.equal(strip(line), line, `a mid-sentence citation was stripped from: ${line}`);
    assert.ok(ANY_CITATION.test(line), "…and it must still be COUNTED, or the hand-off list loses it");
  }
});

// THE PLANT. Two files, three openers, one mid-sentence citation, driven through the real survey with
// an injected reader — the arm that proves the counter counts rather than that the tree happens to be
// in a state where nothing shows.
test("the survey counts openers and hands off the rest, over a planted tree", () => {
  const fake = {
    "a/one.mjs": "// tracker issue 1 — first\nconst x = 1;\n// tracker issue 2 — second\n",
    "a/two.md": "tracker issue 3 — third\ntext mentioning tracker issue 4 mid-sentence\n",
    "a/three.mjs": "nothing here at all\n",
  };
  const s = surveyOf(Object.keys(fake), (f) => fake[f]);
  assert.equal(s.strippedTotal, 3, `planted 3 openers, the survey said ${s.strippedTotal}`);
  assert.deepEqual(Object.keys(s.stripped).sort(), ["a/one.mjs", "a/two.md"],
    "a file with nothing to strip must not appear in the table at all");
  assert.equal(s.handoff.length, 1, "the mid-sentence citation is the hand-off, and it is exactly one");
  assert.match(s.handoff[0].text, /mid-sentence/);
  assert.equal(s.handoff[0].line, 2, "the hand-off names a line a reader can open");
});

// THE EXCLUSIONS ARE BY NAME, and that is the point: a pattern that could recognise "this file uses a
// citation as test data" could also stop recognising it. Both directions, so the list cannot quietly
// empty itself and cannot quietly swallow the tree.
// ── THE REPORT IS AN ARTEFACT TOO, and these are the two states it used to collapse ─────────────────
//
// Both were found by a reader rather than by the arms below, which is the point worth keeping: every
// test here asks what the sweep DOES, and neither asked what its report CLAIMS. A hundred-file rewrite
// is authorised by that report.

test("a line that is stripped AND still carries a citation reaches the hand-off list", () => {
  const fake = { "a.mjs": "// tracker issue 1 — this half goes, and tracker issue 2 stays mid-sentence\n" };
  const s = surveyOf(Object.keys(fake), (f) => fake[f]);
  assert.equal(s.strippedTotal, 1, "the opener is still stripped");
  assert.equal(s.handoff.length, 1,
    "the survivor was invisible: the line counted as done and never reached the list a person reads");
  assert.match(s.handoff[0].text, /stays mid-sentence/);
  assert.doesNotMatch(s.handoff[0].text, /^\/\/ tracker issue 1/,
    "and the hand-off shows the line as it will BE, not as it was — a reader opens the file after the sweep");
});

test("a file that cannot be read is REPORTED, not skipped into silence", () => {
  const s = surveyOf(["a.mjs", "gone.mjs"], (f) => {
    if (f === "gone.mjs") throw new Error("EACCES: permission denied");
    return "// nothing here\n";
  });
  assert.equal(s.unreadable.length, 1, "'I could not open this' and 'there was nothing to do' are different answers");
  assert.equal(s.unreadable[0].file, "gone.mjs");
  assert.match(s.unreadable[0].why, /EACCES/, "and the reason is carried, or the report cannot be acted on");
  assert.equal(s.strippedTotal, 0);
});

test("the excluded files are excluded, and nothing else is", () => {
  assert.ok(EXCLUDED.length > 0, "an empty exclusion list means the sweep would rewrite the guard's own corpus");
  for (const f of EXCLUDED) assert.equal(isScannable(f), false, `${f} must be excluded by name`);
  // THIS FILE AND THE SCRIPT ARE ON THAT LIST, and the omission was real rather than theoretical: the
  // sweep would have rewritten thirteen of its own specimens and worked examples, leaving arms that
  // assert a stripped line equals a stripped line.
  for (const own of ["scripts/strip-tracker-citations.mjs",
                     "driver/test/the-citation-strip-removes-openers-and-nothing-else.test.mjs"]) {
    assert.ok(EXCLUDED.includes(own), `${own} defines the rule and must not be swept by it`);
    assert.ok(existsSync(join(ROOT, own)), `${own} is exempted and is not there — an exemption keyed to a moved file exempts nothing`);
  }
  for (const f of ["driver/pipeline.mjs", "INSTALL.md", "docs/architecture/02-architecture.md"]) {
    assert.equal(isScannable(f), true, `${f} must be swept`);
  }
  assert.equal(isScannable("portal-ui/dist/assets/index.js"), false, "a built artefact is not prose");
  assert.equal(isScannable("driver/profiles/aurora.png"), false, "a binary is not prose");
});
