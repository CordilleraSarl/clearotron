// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ANSWER SHOWS ONE LINE, AND THE REST FOLDS.
//
// The owner read a delivered report on 2026-09-20 and called "Answers to your instructions" unreadable:
// every answer printed at full length, one after another. The acceptance brief had ruled the shape long
// before — the question and the answer's opening visible, the explanation behind a fold — and nothing
// built it, because no demo run carries intake asks, so the section renders in no demo and no mock.
//
// What this arm holds: the first sentence is what shows, the remainder is still THERE, and an internal
// note never crosses into the visible line or out of the element a client surface cuts it from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseReport } from "../publish/parse.mjs";
import { renderHtml } from "../publish/render.mjs";
import { prepareReportForEmbed } from "../portal-report.mjs";

const parsedOf = (md) => {
  const dir = mkdtempSync(join(tmpdir(), "clearotron-answers-"));
  const path = join(dir, "f.report.md");
  writeFileSync(path, md);
  try { return parseReport(path); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const FM = [
  "---", "type: clearance-clearance", "matter: ans-demo", "title: VENQORI",
  "overall_label: MEDIUM", "overall_badge: l3", "overall_caption: medium overall.",
  "classes: 9 · 42", "jurisdiction: United States only", "run: 2026-09-20", "---", "",
].join("\n");

// The register's own line shape, as pipeline.mjs buildAskAnswersSection prints it.
const LONG = "Nothing found — the term reads as coined. The sweep covered the two marketplaces the goods "
  + "are sold through and the EU register. No third party uses it on class 9 software in the territories "
  + "you named.";
const ASKS = [
  "# Actions",
  "### Answers to your instructions",
  `- You asked: check whether the mark has any unpleasant meaning → ${LONG}`,
  "- You asked: flag whether the mark is descriptive → **Not descriptive**.",
  "- You asked: check the Turkish incumbent → Satisfied. ::p:: reviewer: invert if the applicant is the incumbent.",
  "- You asked: check the design mark → nothing found ::p:: reviewer: the design index was not reachable.",
  "- You asked: an internal-only note → ::p:: reviewer: nothing was ordered here.",
  "### Only you can close these",
  "- Confirm the senior filing is the client's own.",
].join("\n");

const page = () => renderHtml(parsedOf(`${FM}\n${ASKS}\n\n# Marks\n`), [], [], { runId: "ans-demo" });
const answersBlock = (html) => {
  const at = html.indexOf('<ul class="answers">');
  assert.ok(at > 0, "the answers render as something other than the answers list");
  return html.slice(at, html.indexOf("</ul>", at) + 5);
};
const items = (html) => answersBlock(html).split(/<li(?: class="[^"]*")?>/).slice(1).map((s) => s.replace(/<\/li>[\s\S]*$/, ""));

test("each answer shows its first sentence, and the rest is folded rather than cut", () => {
  const html = page();
  const [long] = items(html);
  assert.match(long, /You asked: check whether the mark has any unpleasant meaning →/, "the ask is not on the visible line");
  const visible = long.slice(0, long.indexOf("<details"));
  assert.match(visible, /Nothing found — the term reads as coined\./, "the first sentence is not the visible line");
  assert.doesNotMatch(visible, /The sweep covered/, "the second sentence is on the visible line, so nothing was folded");
  assert.match(long, /<details class="ans-more"><summary>More<\/summary><p>/, "the remainder is not behind the page's fold");
  // NOTHING IS CUT. Every word of the answer is still in the document.
  assert.match(long, /The sweep covered the two marketplaces[\s\S]*in the territories you named\./);
});

test("a one-sentence answer renders as that line, with no empty fold", () => {
  const one = items(page())[1];
  assert.match(one, /You asked: flag whether the mark is descriptive → <b>Not descriptive<\/b>\./);
  assert.doesNotMatch(one, /<details/, "a one-sentence answer opened a fold with nothing in it");
});

test("an internal note never reaches the visible line, and a client surface still cuts it", () => {
  const html = page();
  const [, , tailAfterSentence, tailOnly] = items(html);
  // The note follows a complete sentence: the sentence shows, the note is folded with it.
  const visible = tailAfterSentence.slice(0, tailAfterSentence.indexOf("<details"));
  assert.match(visible, /Satisfied\./);
  assert.doesNotMatch(visible, /\[internal\]/, "an internal note reached the visible line");
  assert.match(tailAfterSentence, /<div class="int-note"><details[\s\S]*invert if the applicant is the incumbent\./,
    "the internal note is not inside a fold the client surface removes whole");
  // A remainder that is ONLY the note folds inside the wrapper a client surface removes whole, so that
  // reader gets the line and never an empty disclosure.
  assert.match(tailOnly, /nothing found<div class="int-note"><details class="ans-more">[\s\S]*the design index was not reachable\./);
  // An answer that is internal from its first word keeps its whole row internal, so the client surface
  // takes the row rather than leaving the question over a dangling arrow.
  assert.match(answersBlock(html), /<li class="int-note">You asked: an internal-only note[\s\S]*nothing was ordered here\./,
    "an answer that is internal from its first word is not classed as an internal row");

  // THE CLIENT SURFACE, prepared the way the portal serves a report to a non-staff reader.
  const served = prepareReportForEmbed(html, { staff: false }).html;
  assert.doesNotMatch(served, /\[internal\]/, "an internal note survived to the client surface");
  assert.match(served, /The sweep covered the two marketplaces/, "the client lost the folded public remainder");
  assert.match(served, /Satisfied\./, "the client lost an answer whose note was cut");
  assert.match(served, /nothing found/, "the client lost the answer whose whole remainder was a note");
  assert.doesNotMatch(served, /an internal-only note/, "the client kept a question whose whole answer was internal");
  assert.doesNotMatch(served.slice(served.indexOf("Satisfied."), served.indexOf("Satisfied.") + 400), /<summary>More<\/summary>/,
    "the client kept a More disclosure with nothing behind it");
});
