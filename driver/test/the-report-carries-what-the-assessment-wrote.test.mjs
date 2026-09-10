// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — what the assess stage wrote, and what the published run actually carries.
//
// THE DEFECT WAS A WHITELIST, NOT A RULE. `knockoutReportData` projects an explicit list of keys, and
// seven the assess stage writes into knockout-findings.json were simply not on it. Nothing had decided
// against them: they were written, validated, and then dropped between the run directory and the file
// every chat/MCP reader answers from. On a delivered run that meant six notes written for the reviewing
// lawyer reached a spreadsheet and nothing else, and the one registered right on the page was the only
// card carrying no rating.
//
// TWO DIRECTIONS ARE LOAD-BEARING HERE AND ONLY ONE IS THE HAPPY PATH:
//
//   1. A read the rater sent reaches the card, with its band.
//   2. A filing the rater did NOT weigh keeps the neutral line and claims no rating.
//
// A join tested only in direction 1 passes just as well when it has deleted the neutral line entirely,
// which would put "no rating was performed" cards and "we say nothing" cards into the same shape — the
// exact confusion NOT_WEIGHED_LINE was split out to end. Every join arm below drives both.
import { test } from "node:test";
import assert from "node:assert/strict";

import { knockoutReportData, renderKnockoutHtml, NOT_WEIGHED_LINE } from "../publish/render-knockout.mjs";

const MARK = "IRONWHISK";

const FRAMEWORK = {
  schema_version: 1,
  framework_key: "house-triage",
  title: "House triage ladder",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};

// EVERY PARTY IN THIS FILE IS INVENTED, AND THAT IS A RULE RATHER THAN A HABIT.
//
// The first version of this fixture used the real proprietor from the delivered search the issue was
// filed against. It reads as fidelity to the report and it is the opposite: an issue lives on a private
// tracker, a fixture is published and indexed forever, and the association a conflict fixture publishes
// is "this company was screened as a conflict" — about a real business that never asked to be in it.
//
// A fixture is the one place a real party has no reason to appear at all. Nothing here is keyed on a
// real name: the arms below assert structure, so any invented name serves. If you are copying a case
// out of an issue, copy the SHAPE and leave the parties behind.
const rec = (owner, over = {}) => ({
  recordId: `R-${owner}`, mark: MARK, owner, status: "Valid", classes: [9], territory: "DE",
  matchedForm: MARK, matchedBasis: "identical", url: null, provider: "fixture", ...over,
});

const sidecar = (records) => ({
  provider: "fixture", providerLabel: "the fixture register",
  marks: [{ name: MARK, classes: [9], records, available: records.length }],
});

// The mark as the assess stage writes it — every one of the seven keys populated, so an arm that finds a
// key missing downstream is measuring the projection and never the fixture.
const markRow = (over = {}) => ({
  name: MARK, rating: "Manageable", ratingQualifier: null,
  classesSearched: [9], classesDriving: [9], contextFraming: "compound",
  bullets: ["Scattered informal uses; no dominant owner."],
  basis: "A compound of two ordinary kitchen words.",
  factors: ["Two storefronts trade under the name."],
  counterFactors: ["No registered right and no dominant trader was found."],
  mitigation: "Narrowing to the tool classes would put daylight between this and the storefront use.",
  assessment: "This name reads as a compound of two ordinary kitchen words, and the field around it is "
    + "scattered rather than owned.",
  crowdedField: true,
  purpleNotes: ["Confirm firm history on IRONWHISK before the call.",
    "Belt-and-braces classes 16 and 35 are quiet rather than cleared."],
  negatives: [{ term: "ironwhisk cookware", source: "marketplace sweep", note: "no exact-name seller" }],
  findings: [], degraded: null,
  ...over,
});

const findingsDoc = (over = {}) => ({
  schema_version: 1,
  batch: { executiveSummary: "The batch's cross-mark read.", standardCaveats: [] },
  marks: [markRow(over)],
});

const data = (over = {}, records = [rec("LUMENREED")]) =>
  knockoutReportData(findingsDoc(over), FRAMEWORK, {
    runId: "tmp0001-fixture", codename: "fixture-run", overall: "Manageable",
    issued: "2026-09-07", identity: {}, registerCounts: null,
    registerRecords: sidecar(records), url: null, auditFile: null, customerKey: "generic",
    matter: "tmp0001-fixture",
  });

const html = (over = {}, records = [rec("LUMENREED")]) =>
  renderKnockoutHtml(findingsDoc(over), FRAMEWORK, {
    runId: "tmp0001-fixture", overall: "Manageable", registerRecords: sidecar(records),
  });

// ── the seven keys ───────────────────────────────────────────────────────────────────────────────────

test("274: every key the assess stage wrote reaches report-data.json", () => {
  const m = data().marks[0];
  assert.equal(m.assessment, findingsDoc().marks[0].assessment, "the mark's own opening read");
  assert.deepEqual(m.counterFactors, ["No registered right and no dominant trader was found."]);
  assert.match(m.mitigation, /^Narrowing to the tool classes/);
  assert.equal(m.crowdedField, true);
  assert.equal(m.reviewerNotes.length, 2, "the reviewer's notes");
  assert.equal(m.negatives.length, 1, "the proof-of-search rows");
  assert.equal(m.negatives[0].term, "ironwhisk cookware");
});

// The single-mark run is the one publish drops, and it is the common knockout. `publishKnockout`
// substitutes `assessment` into `batch.executiveSummary` only when the batch has MORE than one mark, so
// on a one-mark run the paragraph was written, validated and then carried by neither surface.
test("274: on a SINGLE-mark run the assessment still travels — the case publish drops", () => {
  const d = data();
  assert.equal(d.marks.length, 1, "premise: this is the single-mark shape");
  assert.equal(d.summary, "The batch's cross-mark read.", "the batch summary is untouched");
  assert.ok(d.marks[0].assessment, "and the mark's own read is carried in its own key, not instead of it");
});

// `false` and "the rater said nothing" are different facts. A crowded field is a mitigant the reasoning
// turns on, so an unstated one collapsing to `false` would hand a reader a stated "no" nobody wrote.
test("274: an unstated crowdedField is null, not false", () => {
  assert.equal(data({ crowdedField: undefined }).marks[0].crowdedField, null, "unstated stays unstated");
  assert.equal(data({ crowdedField: false }).marks[0].crowdedField, false, "a stated no is carried as one");
  assert.equal(data({ crowdedField: true }).marks[0].crowdedField, true);
});

// ── the register card: the join, driven BOTH ways ────────────────────────────────────────────────────

test("274: a filing the rater read and banded carries both onto the card", () => {
  const d = data({ registerReads: [{ recordId: "R-LUMENREED", band: "Manageable",
    read: "The owner's filings sit in optical goods; the two uses do not meet in the market." }] });
  const card = d.marks[0].findings.find((f) => f.shape === "register");
  assert.ok(card, "the promoted filing is on the card list");
  assert.equal(card.band, "Manageable", "the rater's rating of THAT filing");
  assert.match(card.basis, /^The owner's filings sit in optical goods/, "and the rater's own read");
  assert.doesNotMatch(card.basis, /carries no rating of its own/, "the disclaimer is gone where a read exists");
  assert.doesNotMatch(card.net, /carries no rating of its own/, "…on both prose fields, not just one");
});

// THE DIRECTION A HAPPY-PATH JOIN TEST CANNOT SEE. Acceptance 4 of the issue: the neutral line stays
// where the rater weighed nothing. A join that dropped it unconditionally passes every arm above.
test("274 acceptance 4: a filing with NO read keeps the neutral line and claims no rating", () => {
  const card = data().marks[0].findings.find((f) => f.shape === "register");
  assert.equal(card.band, null, "no band is claimed for a filing nobody rated");
  assert.equal(card.basis, NOT_WEIGHED_LINE, "the neutral line stands");
  assert.match(card.net, /carries no rating of its own/, "and the net sentence still carries it");
});

// The join is by recordId, so a read citing a DIFFERENT filing must not land on this card. Without this,
// a one-record fixture cannot tell a real join from "take the first read in the array".
test("274: the join is by recordId — a read for another filing does not colour this card", () => {
  const d = data(
    { registerReads: [{ recordId: "R-SOMEONE-ELSE", band: "Blocking", read: "A different filing entirely." }] },
    [rec("LUMENREED"), rec("SOMEONE-ELSE")],
  );
  const cards = d.marks[0].findings.filter((f) => f.shape === "register");
  const mine = cards.find((c) => c.owner === "LUMENREED");
  const theirs = cards.find((c) => c.owner === "SOMEONE-ELSE");
  assert.equal(mine.band, null, "the unread filing is untouched by another filing's read");
  assert.equal(mine.basis, NOT_WEIGHED_LINE);
  assert.equal(theirs.band, "Blocking", "and the read lands on the filing it actually cites");
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────

test("274: the band chip is drawn on a banded filing and on no other", () => {
  const banded = html({ registerReads: [{ recordId: "R-LUMENREED", band: "Medium", read: "It bears on the rating." }] });
  assert.match(banded, /class="ko-findband"[^>]*>Medium</, "the chip states the rater's band for the filing");
  assert.match(banded, /It bears on the rating\./, "and the read prints beside it");

  const unbanded = html({ registerReads: [{ recordId: "R-LUMENREED", read: "It bears on the rating." }] });
  assert.match(unbanded, /It bears on the rating\./, "a read with no band still prints");
  assert.doesNotMatch(unbanded, /class="ko-findband"[^>]*>(Blocking|Medium|Manageable|Low)</,
    "…and draws no chip, because no rating was performed on that filing");

  const unread = html();
  assert.doesNotMatch(unread, /class="ko-findband"[^>]*>(Blocking|Medium|Manageable|Low)</,
    "a filing nobody weighed draws no chip either");
  assert.ok(unread.includes(NOT_WEIGHED_LINE), "and keeps the neutral line");
});

// The ruling that put these on the page is also the way this change could produce a WORSE report: notes
// merged into the client-voiced body would read as findings about the mark. The label is the guard.
test("274: the reviewer's notes render LABELLED, never merged into the findings body", () => {
  const out = html();
  assert.match(out, /Confirm firm history on IRONWHISK/, "the note reaches the report");
  assert.match(out, /class="internal"/, "in the established purple internal convention");
  assert.match(out, /class="ko-refnote"/, "under the legend naming that convention");

  const block = /<div class="internal">([\s\S]*?)<\/div>/.exec(out);
  assert.ok(block, "the labelled block exists");
  assert.match(block[1], /Confirm firm history on IRONWHISK/, "and the note is INSIDE it");
  assert.match(block[1], /quiet rather than cleared/, "every note, not just the first");
});

// The legend describes a colour. A report with no notes must not carry a sentence explaining a
// convention it never used.
test("274: no notes, no legend", () => {
  assert.doesNotMatch(html({ purpleNotes: [] }), /class="ko-refnote"/, "an empty list draws no legend");
  assert.doesNotMatch(html({ purpleNotes: ["   "] }), /class="ko-refnote"/, "nor does a blank one");
  assert.doesNotMatch(html({ purpleNotes: [] }), /class="internal"/, "and no empty labelled block is drawn");
});

// The model's estimate of what the registers hold is NOT covered by the ruling that put the notes on the
// page: it is a guess about a thing the same run measured, and it stays off. Stated as an arm because
// the two used to be one rule, and a later reader would otherwise have only the comment.
test("274: the ruling moved the reviewer's notes and NOT the register estimate", () => {
  const out = html({ registerEstimate: "moderate filings expected" });
  assert.match(out, /Confirm firm history/, "the notes are on the page");
  assert.doesNotMatch(out, /moderate filings expected/, "the estimate is not");
});
