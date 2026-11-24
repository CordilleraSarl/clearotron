// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT RATING CARRIES THE CALIBRATION OF ITS WORKED EXAMPLES, NOT THE COLLECTION. The rating manual used to link the whole
// worked-examples file, and Codex sessions opened it, with the synthesis rules, on every rating. The rating now carries the
// calibration part of the file its framework uses, in its opening message, and is told to open a worked example only for a
// calibration question still open. What the tests hold:
//   - the cut runs from "The reasoning to reproduce" to the end of "Two calibration moves", and leaves the report-writing rest;
//   - a file without both headings is carried whole, so no framework's calibration is dropped;
//   - the rating message, for one name and for a family, carries the calibration after its manuals and the instruction once;
//   - the rating manual no longer sends the session to the whole collection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KO_STAGES, koPaths, calibrationExcerptOf } from "../stages-knockout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, "..", "skills", "clearance-search");
const HOUSE = "skills/clearance-search/worked-examples.md";
const INSTRUCTION = "Apply the supplied Knockout assessment rules and the customer’s risk framework to each finding. If a specific calibration question remains, consult the relevant rule or worked example for that question.";

test("the house examples are cut to their calibration: the reasoning to reproduce and the two calibration moves", () => {
  const file = readFileSync(join(EXAMPLES, "worked-examples.md"), "utf8");
  const cut = calibrationExcerptOf(file, HOUSE);
  const lines = cut.split("\n");
  assert.equal(lines[0], `=== MANUAL EXCERPT: ${HOUSE}, from "The reasoning to reproduce" to the end of "Two calibration moves" ===`);
  assert.equal(lines.at(-1), "=== END MANUAL EXCERPT ===");
  assert.match(lines[1], /^## The reasoning to reproduce\b/, "the cut opens on its first heading");
  assert.ok(lines.some((l) => /^### Two calibration moves\b/.test(l)), "the calibration moves are carried");
  for (const rest of [/^### Delivery prose/m, /^## Voice/m, /^## Example 1\b/m]) assert.doesNotMatch(cut, rest, "the report-writing rest is left out");
  assert.ok(cut.length < file.length / 5, `the cut carries ${cut.length} of ${file.length} characters`);
});

test("a file without both headings is carried whole, so a framework's calibration is never dropped", () => {
  const without = readdirSync(EXAMPLES).filter((f) => /^worked-examples.*\.md$/.test(f))
    .map((f) => [f, readFileSync(join(EXAMPLES, f), "utf8")])
    .filter(([, t]) => !/^## The reasoning to reproduce\b/m.test(t) || !/^### Two calibration moves\b/m.test(t));
  assert.ok(without.length > 0, "no shipped examples file lacks the headings, so the fallback below is driven by an invented one only");
  for (const [f, t] of [...without, ["invented.md", "# Calibration\n\nOne move, stated once.\n\n"]]) {
    const ref = `skills/clearance-search/${f}`;
    assert.equal(calibrationExcerptOf(t, ref), `=== MANUAL: ${ref} ===\n${t.replace(/\s+$/, "")}\n=== END MANUAL: ${ref} ===`, `${f} is not carried whole`);
  }
  // One heading alone is not the calibration part: the file goes whole rather than half.
  const half = "## The reasoning to reproduce\n\nA move.\n\n## Voice\n\nA pair.\n";
  assert.match(calibrationExcerptOf(half, "skills/x.md"), /^=== MANUAL: skills\/x\.md ===\n## The reasoning to reproduce[\s\S]*## Voice/);
  assert.equal(calibrationExcerptOf("  \n", "skills/x.md"), null, "an empty file carries nothing");
});

test("the rating carries the calibration after its manuals, and the instruction once, for one name and for a family", () => {
  const K = koPaths(mkdtempSync(join(tmpdir(), "ko-calibration-")));
  const calibration = calibrationExcerptOf(readFileSync(join(EXAMPLES, "worked-examples.md"), "utf8"), HOUSE);
  const message = (names, calibrationExcerpt) => KO_STAGES["knockout-assess"].message({ K, job: {}, chunkNo: 0,
    chunkMarks: names.map((name) => ({ name })), chunkTotal: 2, framework: { bands: [{ label: "High" }, { label: "Low" }] },
    frameworkPath: null, probeNote: "", calibrationExcerpt });
  for (const names of [["QUILLBRAE"], ["QUILLBRAE", "QUILBRAE"]]) {
    const m = message(names, calibration);
    const read = m.indexOf("First, read and follow exactly: "), at = m.indexOf(calibration), said = m.indexOf(INSTRUCTION);
    assert.ok(read >= 0 && at > read && said > at + calibration.length, `${names.length} name(s): manuals, then the calibration, then the instruction`);
    assert.equal(m.split(INSTRUCTION).length, 2, "the instruction is said once");
    assert.ok(m.indexOf(names.length > 1 ? "You are rating a family of" : "You are rating one name for a Knockout screen.") > said, "the job follows the rules it applies");
  }
  // With no calibration to carry, the message says the instruction and nothing in its place.
  const bare = message(["QUILLBRAE"], null);
  assert.doesNotMatch(bare, /=== MANUAL( EXCERPT)?:/);
  assert.ok(bare.includes(INSTRUCTION));
});

test("the rating manual no longer sends the session to the whole worked-examples collection", () => {
  const manual = readFileSync(join(HERE, "..", "skills", "knockout-assess", "SKILL.md"), "utf8");
  assert.doesNotMatch(manual, /worked-examples\.md/, "the rating manual links a worked-examples file again");
  assert.match(manual, /^3\. \*\*Band per the framework ladder\*\*, applying the calibration rules below\.$/m);
});
