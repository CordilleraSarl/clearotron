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

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { OPENER, PARENTHETICAL, ANY_CITATION, EXCLUDED, isScannable, surveyOf, stripParenthetical, wrapsInto } from "../../scripts/strip-tracker-citations.mjs";

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

// ── the bracketed citation, and the two things that make it safe ────────────────────────────────────
//
// Measured rather than assumed: the opener sweep had two lines left and seven hundred and fifty
// citations it could not touch. Three hundred and twenty-nine of those sit in brackets holding the
// citation and nothing else, which is a label beside a sentence wearing a different punctuation mark.

test("a bracketed citation goes, and the sentence it stood beside is untouched", () => {
  assert.equal(stripParenthetical("  # nothing (tracker issue 200)."), "  # nothing.");
  assert.equal(stripParenthetical("// A TAG PUSH IS NOT A PUBLISH PATH (tracker issue 264)."),
    "// A TAG PUSH IS NOT A PUBLISH PATH.");
  // The space before the bracket goes with it; leaving it produces a double space mid-sentence.
  assert.equal(stripParenthetical("// green here (tracker issue 204) and wrong there"),
    "// green here and wrong there");
});

test("brackets holding ANYTHING BESIDES the citation are refused — that content is a ruling", () => {
  // The whole of the narrowing. Sixty-eight lines carry a date, a ruling or a second citation inside
  // the same brackets, and a rule wide enough to take them is a rule that deletes rulings.
  for (const line of [
    "// stable is the owner's word (tracker issue 230, unchanged).",
    "// WHAT FIRES THE PUBLISH (tracker issue 264, owner's ruling 2026-09-07).",
    "// ── AND THE GATE COMES AFTER IT (tracker issue 208 / tracker issue 229) ────",
    "// see tracker issue 238 and the guard in that job.",
  ]) {
    assert.equal(PARENTHETICAL.test(line), false, `would have rewritten: ${line}`);
    assert.equal(stripParenthetical(line), line, "the line was changed");
  }
});

test("a drawn heading keeps its rule the length it was", () => {
  // A hundred and six of these sit in box headings. Removing twenty characters and leaving the rule
  // twenty short makes every touched heading ragged against every other heading in its file, and turns
  // a citation removal into a reflow nobody asked to review.
  const before = "// ── THE INPUT DECIDES THE CHANNEL (tracker issue 279) ──────────────";
  const after = stripParenthetical(before);
  assert.equal(after.length, before.length, "the heading changed width");
  assert.equal(after, "// ── THE INPUT DECIDES THE CHANNEL ──────────────────────────────────");
  assert.equal(ANY_CITATION.test(after), false, "the citation survived");
});

test("a line with no trailing rule is not padded", () => {
  // The padding must key on the line ENDING in a rule, not on containing one. A heading whose rule sits
  // mid-line would otherwise grow characters at its end.
  const out = stripParenthetical("// ── A HEADING ── then prose (tracker issue 300) and more prose");
  assert.equal(out, "// ── A HEADING ── then prose and more prose");
});

test("the sweep applies both rules and reports the count of each line it rewrote", () => {
  const tree = {
    "a.mjs": "// tracker issue 11 — an opener\n// and a bracket (tracker issue 12)\n// a ruling (tracker issue 13, decided 2026-01-01)\n",
  };
  const s = surveyOf(Object.keys(tree), (f) => tree[f]);
  assert.equal(s.strippedTotal, 2, "one opener and one bracket");
  assert.equal(s.handoff.length, 1, "the ruling line is the only one owed to a reader");
  assert.match(s.handoff[0].text, /decided 2026-01-01/, "and it is the one carrying content in its brackets");
});

test("a line carrying another citation is handed off, never rewritten", () => {
  // REWRITING RE-AGES. A diff has no partial edit: touching one character puts the whole line on the
  // added side, so a by-line citation that has sat there for months becomes newly-added and fails the
  // check that refuses new ones. Two lines in this tree are in that state and rewriting them turned a
  // strip into three new bare citations.
  const line = '  { target: /^diffcase/, why: "FIXTURE NAMES (tracker issue 1941). diffcase-keep.mjs:4 keepRow is DATA" },';
  const tree = { "a.mjs": [line, "// a plain one (tracker issue 12)", ""].join("\n") };
  const s = surveyOf(Object.keys(tree), (f) => tree[f]);
  assert.equal(s.strippedTotal, 1, "the line carrying diffcase-keep.mjs:4 keepRow was rewritten anyway");
  assert.equal(s.handoff.length, 1, "and it must reach the reader instead");
  assert.ok(s.handoff[0].text.includes("diffcase-keep.mjs:4 keepRow"), "the held-back line is the one carrying the by-line citation");
});

test("the sweep is a fixed point on the tree it has already swept", () => {
  // WHAT THIS CATCHES, AND IT IS NOT HYPOTHETICAL. Repairing two re-aged lines by restoring the whole
  // file put a sweepable citation back with them, and it then sat in NEITHER pile: not stripped,
  // because the sweep had not been re-run, and not on the hand-off list either, because the survey
  // strips a line before classifying what remains. A line in neither pile is invisible to every count
  // this file prints. Found in review.
  //
  // Driven over the real tracked tree rather than a fixture: a fixture would prove the property of the
  // fixture, and the defect was in what the repository actually held.
  const tracked = execFileSync("git", ["-C", ROOT, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n").filter(Boolean);
  const s = surveyOf(tracked, (f) => readFileSync(join(ROOT, f), "utf8"));
  assert.ok(tracked.length > 100, `read ${tracked.length} tracked path(s) — the population is not the tree`);
  assert.equal(s.strippedTotal, 0,
    `the sweep would still rewrite ${s.strippedTotal} line(s) of a tree it has already swept — re-run it and commit the result`);
});

// ── a citation that wrapped across a line break ─────────────────────────────────────────────────────
//
// Every rule in this file reads ONE line, so a citation broken across a break matched nothing, counted
// in no total and appeared on no hand-off list. Thirty-six were in the tree. That is not a smaller
// number than the truth, it is an absent one — the same shape as a line stripped before it is
// classified, which this file already has a check for.

test("a citation broken across a line break is found and handed off", () => {
  for (const [a, b] of [
    ["// the rule is stated in tracker", "// issue 264 and nowhere else"],
    ["// the rule is stated in tracker issue", "// 264 and nowhere else"],
    ["# a comment ending in tracker", "#   issues 1149 item 2"],
  ]) {
    assert.equal(wrapsInto(a, b), true, `missed: ${a} ⏎ ${b}`);
  }
});

test("a line ending in the word tracker is not a citation because a number follows it", () => {
  // THE OVER-MATCH THIS COULD HAVE BEEN. `tracker` is an ordinary word and numbered lists are ordinary
  // prose, so requiring `issue` after a bare `tracker` is what keeps a sentence about a bug tracker,
  // followed by a step 3, from reading as a citation and being handed to somebody to rewrite.
  for (const [a, b] of [
    ["// we open a ticket in the tracker", "//   3. then the run resumes"],
    ["// see the tracker", "// for the current state"],
    ["// nothing to do with a tracker issue at all", "// a following line"],
  ]) {
    assert.equal(wrapsInto(a, b), false, `false positive: ${a} ⏎ ${b}`);
  }
  assert.equal(wrapsInto("// ends in tracker", undefined), false, "the last line of a file has no successor");
});

test("the survey reports the wrapped pair at the line the citation starts on", () => {
  const tree = { "a.mjs": ["// a plain one (tracker issue 12)", "// the rule is in tracker", "// issue 264 and nowhere else", ""].join("\n") };
  const s = surveyOf(Object.keys(tree), (f) => tree[f]);
  assert.equal(s.strippedTotal, 1, "the bracketed one on line 1 is still swept");
  const wrapped = s.handoff.filter((h) => h.text.includes("⏎"));
  assert.equal(wrapped.length, 1, "the wrapped citation is on no hand-off list");
  assert.equal(wrapped[0].line, 2, "reported at the line a reader has to open, not the one holding the number");
});
