// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE SUMMARY IS STRUCTURED AT THE WRITER AND STAYS STRUCTURED AT EVERY READER.
//
// Tracker issues 1934 and 2056. Owner ruling 2026-08-31: "keep the length, add the structure, so long as
// length is consistent more or less."
//
// The measurement that opened those issues found the render byte-faithful and the seat emitting zero
// structure, and concluded the fix was at the writer alone. That conclusion was taken on UNSTRUCTURED
// input, which cannot see what a reader does with structure — and every reader in this product flattened
// it. So these arms cover BOTH halves, and the ones that would have caught the original defect are the
// ones that drive a structured string through a reader rather than reading the writer's instructions.
//
// Each arm PLANTS the shape it is named for. An arm that only asserts today's output passes equally on
// the defect and on the fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseSummaryBlocks, SUMMARY_BLOCK_LINE } from "../../shared/summary-blocks.mjs";
import { batchSummaryOf } from "../portal-report.mjs";
import { knockoutDocumentRoutes } from "../publish/knockout.mjs";
import { validators, isUnbrokenWall, SUMMARY_SECTION_BREAK_RE, UNBROKEN_PROSE_CHARS } from "../verify-knockout.mjs";
import { NOT_WEIGHED_LINE, mdParagraphs } from "../publish/render-knockout.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const STRUCTURED = [
  "Two names screened; neither is knocked out at this depth.",
  "",
  "## CORAL FREEZE — Medium",
  "",
  "- Crowded field of small sellers",
  "- No dominant enforcer identified",
  "",
  "## CINDER LANTERN — Low",
  "",
  "Clean sweep across the screened marketplaces.",
].join("\n");

// An assessment as the seat wrote them BEFORE the ruling: one run of characters, no break anywhere.
const WALL = "CORAL FREEZE screens at Medium on this sweep. ".repeat(30);

// ── The writer: the dictation and the doctrine order structure, and no longer order its opposite ──────

test("the dispatch orders structure on both summaries, and the superseded wording is gone", () => {
  const d = read("driver/stages-knockout.mjs");
  assert.match(d, /GIVE IT STRUCTURE A READER CAN SCAN/,
    "the per-mark assessment is no longer ordered as an unstructured paragraph");
  assert.match(d, /STRUCTURE IT: a short opening line/,
    "the cross-mark chunkSummary is no longer ordered as an unstructured paragraph");
  // THE PLANT. This is the exact clause that produced the 2,875-character block, and an arm that cannot
  // fail on it is measuring that a sentence exists rather than that the instruction changed.
  assert.doesNotMatch(d, /2–5 measured sentences covering THIS chunk's marks/,
    "the superseded 'measured sentences' order still stands — the seat gets two answers and picks one");
  assert.doesNotMatch(d, /a single-mark client's opening read is the standard to match, not a ceiling/,
    "the superseded 'not a ceiling' clause still stands beside the ruling that amended it");
});

test("the doctrine file agrees with the dispatch instead of contradicting it", () => {
  const s = read("driver/skills/knockout-assess/SKILL.md");
  assert.doesNotMatch(s, /`chunkSummary`, narrative, not bullets/,
    "SKILL.md still forbids the bullets the dispatch now asks for");
  assert.match(s, /## The per-mark opening read/, "the assessment field has no doctrine section");
  assert.match(s, /Never `# `/, "the depth rule that stops a summary truncating itself is not stated");
});

test("SKILL.md's closed-key block names every key the validator actually requires", () => {
  // The gap this closes was recorded in the code itself: "required by the validator, absent from the
  // doctrine's own shape block". A seat reading the doctrine as authoritative omitted five keys.
  const s = read("driver/skills/knockout-assess/SKILL.md");
  const block = s.slice(s.indexOf('"marks": [ {'), s.indexOf('"degraded": null'));
  for (const k of ["basis", "factors", "counterFactors", "mitigation", "assessment"]) {
    assert.match(block, new RegExp(`"${k}"`), `the doctrine's "closed keys" block omits ${k}, which the validator requires`);
  }
});

// ── The validator: the two rules, each planted ───────────────────────────────────────────────────────

const chunkOf = (over) => ({
  schema_version: 1, chunkSummary: "Two names screened.", marks: [], ...over,
});

test("an H1 in a summary is refused — it would end the client's report at that line", () => {
  const v = validators.knockoutAssessChunk;
  assert.equal(SUMMARY_SECTION_BREAK_RE.test("# CORAL FREEZE"), true);
  assert.equal(SUMMARY_SECTION_BREAK_RE.test("## CORAL FREEZE"), false, "a legal sub-header must not be refused");
  // and the rule discriminates on the thing that matters — the hash count, not the word after it
  assert.equal(SUMMARY_SECTION_BREAK_RE.test("### Register"), false);
});

test("an unbroken wall is refused, and length alone never is", () => {
  assert.equal(isUnbrokenWall(WALL), true, "the shape the owner reported is not caught");
  assert.equal(isUnbrokenWall(`${WALL}\n\n## A sub-header\n\n- a point`), false,
    "a LONGER string with structure is refused — this rule has become the length cap it must not be");
  assert.equal(isUnbrokenWall("A short single-paragraph read."), false,
    "a genuinely short read is blocked, which would cost a client a report over formatting");
  assert.ok(UNBROKEN_PROSE_CHARS > 800, "the floor has drifted down into honest-paragraph territory");
});

// ── The readers: structure survives to every surface ─────────────────────────────────────────────────

test("the grouped page keeps every block — before the fix it kept the first sentence", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-structure-"));
  writeFileSync(join(dir, "report.md"), `---\ntitle: "x"\n---\n\n# Summary\n\n${STRUCTURED}\n\n# Documents\n\n- **CORAL FREEZE**: \`report-coral-freeze.html\`\n`);
  const blocks = batchSummaryOf(dir);
  const whole = blocks.join("\n");
  assert.ok(blocks.length > 1, "the summary collapsed to a single block — the truncation is back");
  assert.match(whole, /CINDER LANTERN/, "the mark after the first sub-header was dropped from the entry point");
  assert.match(whole, /- Crowded field of small sellers\n- No dominant enforcer/,
    "the bullet list was collapsed into one line, which is what the whitespace collapse used to do");
  assert.doesNotMatch(whole, /report-coral-freeze\.html/, "the pool filenames leaked to the client");
});

test("an ARCHIVED run, whose documents heading is the old '## Documents', still stops in the right place", () => {
  // The regression this arm exists for was introduced by the fix: promoting the heading to an H1 and
  // terminating on H1 alone sails straight past every already-delivered run's `## Documents`.
  const dir = mkdtempSync(join(tmpdir(), "ko-archived-"));
  writeFileSync(join(dir, "report.md"), `---\ntitle: "x"\n---\n\n# Summary\n\nBRIMSTONE rates Low across the board.\n\n## Documents\n\n- **BRIMSTONE**: \`report-brimstone.html\`\n`);
  const blocks = batchSummaryOf(dir);
  assert.deepEqual(blocks, ["BRIMSTONE rates Low across the board."]);
  assert.doesNotMatch(blocks.join("\n"), /report-brimstone\.html/, "an archived run now leaks its pool filenames");
});

test("the documents list is a SECTION of report.md, not part of the summary", () => {
  const routes = knockoutDocumentRoutes([{ mark: "CORAL FREEZE", band: "Medium", file: "report-coral-freeze.html" }]);
  assert.ok(routes.includes("# Documents"),
    "as '## Documents' this heading sits inside the Summary section, which is what forced the reader to guess the boundary by depth");
});

test("the promoted register card no longer denies a weighing it cannot see (tracker 2058)", () => {
  // The card printed "the rating did not turn on this filing" on EVERY promoted filing, unconditionally.
  // On a delivered run the assessment weighed three live senior filings into a Very High and the
  // three cards under it denied that three times — the report contradicting itself, and the fixed half
  // was ours. Nothing in the render path records what the rater weighed (a finding's closed keys are
  // ordinal/name/owner/band/net/type/evidence/basis), so the honest line describes the CARD.
  assert.doesNotMatch(NOT_WEIGHED_LINE, /the rating did not turn on|not raised as a conflict/,
    "the card is asserting the rater's read again, which no data reaching this renderer supports");
  assert.match(NOT_WEIGHED_LINE, /carries no rating of its own/,
    "the card must still stop a reader taking a listed filing for a rated conflict");
});

test("the block grammar is read the same way by every reader", () => {
  const blocks = parseSummaryBlocks("## CORAL FREEZE — Medium\n- crowded field\ntrailing prose");
  assert.deepEqual(blocks.map((b) => b.kind), ["heading", "bullets", "para"]);
  assert.equal(SUMMARY_BLOCK_LINE.test("ordinary prose with no marker"), false);
});

test("NO HEADING DEPTH RENDERS AS A LITERAL HASH — the renderer never prints punctuation as content", () => {
  // The gap this closes was mine. The grammar refused to parse `#{1}` because an H1 is forbidden in a
  // summary, so an H1 fell through every branch to the prose one and rendered as the characters
  // `# Documents` on a client page. Refusing to PARSE a shape does not stop it arriving.
  //
  // Where the forbidding actually happens is asserted right below, so this arm cannot be read as
  // permission to write one.
  for (const depth of [1, 2, 3, 4, 5, 6]) {
    const html = mdParagraphs(`${"#".repeat(depth)} A heading`);
    assert.match(html, /^<h[3-6] class="ko-sumh">A heading<\/h[3-6]>$/,
      `depth ${depth} did not render as a heading: ${html}`);
    assert.doesNotMatch(html, /#/, `depth ${depth} leaked a literal hash to the page: ${html}`);
  }
  // …and a bullet list, for the same reason: hyphens must not reach a reader as hyphens.
  assert.match(mdParagraphs("- one\n- two"), /^<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>$/);
});

test("the H1 BAN lives where it can act — the validator and the section boundary, not the parser", () => {
  assert.equal(SUMMARY_SECTION_BREAK_RE.test("# Documents"), true, "the validator no longer refuses an H1");
  assert.equal(SUMMARY_SECTION_BREAK_RE.test("## MARK"), false, "the validator refuses a legal sub-header");
});
