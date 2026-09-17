// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The knockout page's reading order, folds and labels.
//
// The complaint the redesign answers is digestibility, not correctness: on a one-name report the reader
// met the name, band and classes three times before a sentence of reading, then nine unfolded conflict
// cards, and only under all of that a note saying the request may have been scoped to the wrong market.
//
// TWO PROPERTIES ARE LOAD-BEARING HERE AND NEITHER IS COSMETIC:
//
//   1. THE PAGE IS FILTERED; THE RECORD IS NOT. Every clause below shortens what is DRAWN. report-data
//      and the workbook keep what they carried, so an arm that only read the HTML could not tell a fold
//      from a deletion — several of these read both.
//   2. AN ARCHIVED RUN RE-RENDERS AS DELIVERED (clause F). Every field this design leans on is optional
//      on runs already published, so each new behaviour is driven twice: with the field and without it.
//      A clause with no absent-field arm is a clause that silently rewrites history.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderKnockoutHtml, knockoutReportData } from "../publish/render-knockout.mjs";
import { EXPORT_TOGGLE, EXPORT_MENU_JS } from "../publish/report-topbar.mjs";

// Worst-first, and deliberately FOUR rungs with "Low" at the bottom: a ladder whose lowest rung is the
// one a fixture happens to use cannot tell "above the lowest" from "has a band at all".
const FW = {
  framework_key: "house-triage",
  title: "House triage framework",
  bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" },
    { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }],
};

const REC = (over = {}) => ({
  recordId: "R-1", mark: "IRONWHISK", owner: "Pemberton Tools Ltd", ownerCountry: "GB",
  status: "PENDING", classes: [8, 21], territory: "us", matchedForm: "IRONWHISK",
  matchedBasis: "identical", url: null, provider: "clarivate", ...over,
});

const RECORDS = (records = [REC()]) => ({
  provider: "clarivate", providerLabel: "Clarivate Compumark",
  marks: [{ name: "IRONWHISK", classes: [8], classScope: "mark", records, fetched: records.length, available: true }],
});

const COUNTS = (over = {}) => ({
  schema: 1, provider: "clarivate", providerLabel: "Clarivate Compumark", basis: "b",
  scope: { jurisdictions: ["EU", "US"], regions: ["EM", "US", "WO"], classes: [8] },
  marks: [{
    name: "IRONWHISK", classes: [8], classScope: "mark",
    counts: {
      identical: { total: 12 }, containing: { total: 44 },
      close: { total: 3, forms: [{ form: "IRONWISK", total: 1 }, { form: "IRONWHISC", total: 2 }], generated: 2, counted: 2 },
    },
  }],
  ...over,
});

const MARK = (over = {}) => ({
  name: "IRONWHISK", classesSearched: [8], classesDriving: [8], rating: "Medium", ratingQualifier: null,
  basis: "The name is a compound of two ordinary kitchen words used informally by several sellers.",
  factors: ["Two storefronts trade under the name in the same goods."],
  counterFactors: ["No registered right was found on the material searched."],
  mitigation: "Narrowing to the tool classes would put daylight between this and the storefront use.",
  bullets: ["Scattered informal uses; no dominant owner."],
  assessment: "## What the name is\n\nA compound of two ordinary words.\n\n## What drives the rating\n\nTwo storefronts.",
  purpleNotes: [], findings: [], negatives: [], degraded: false,
  ...over,
});

const FINDING = (over = {}) => ({
  ordinal: 1, name: "Ironwhisk Kitchen", owner: "Halloway Retail", band: "Medium",
  net: "A storefront trading under the same name in the same goods.",
  basis: "The storefront has traded since 2019 and its listings reach the same buyers, which is what "
    + "makes this the conflict the rating turns on rather than one of several look-alikes.",
  type: "Active Business", evidence: ["https://example.invalid/listing"], ...over,
});

// The page INLINES its stylesheet, and that stylesheet carries comments naming the very blocks these
// arms assert are absent. An arm reading the whole document therefore passes or fails on a comment
// rather than on the page — so every absence assertion below reads the BODY.
const body = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, '');

const RENDER = (marks, over = {}) => renderKnockoutHtml(
  { marks, batch: { executiveSummary: "One name screened.", standardCaveats: [] } }, FW,
  { runId: "r", overall: "Medium", identity: { identity: "Knockout search" }, ...over },
);

// ── THE IDENTITY LINE NAMES THE MARK AND THE SEARCH, NEVER THE RUN ───────────────────────────────
//
// It printed `matter || runId`, and the publisher passes the runId AS the matter, so a client read the
// engine's run identifier: on a real run a temporary-directory name carrying a capture suffix. It is
// ours, it means nothing to them, and it is the one string on that page that could not be shown to
// anyone at all. The mock reads mark then search type.
//
// Clause F, and it is the whole reason this has two halves: a run with no registry identity is exactly
// the run that used to print the raw name, so a fallback to the identifier would keep the defect for
// precisely the documents that have it. With no product name the mark stands alone; with neither, the
// line does not render.
const RUNID = "tmpdemo2014knockoutsearch-ironwhisk-2026-09-02-sample-capture";
const identityLine = (html) => (html.match(/<span class="mono tb-matter"[^>]*>([\s\S]*?)<\/span>/) || [])[1] ?? null;

test("the identity line names the mark and the search, and no run identifier reaches it", () => {
  const html = RENDER([MARK()], { runId: RUNID, matter: RUNID });
  const line = identityLine(html);
  assert.ok(line, "the identity line renders");
  assert.match(line, /IRONWHISK/, "the mark is named");
  assert.match(line, /Knockout search/, "and the search type beside it");
  assert.doesNotMatch(html, /tmpdemo|sample-capture/, "no run identifier anywhere on the page");
});

test("clause F: with no registry identity the mark stands alone — never the run identifier", () => {
  const html = RENDER([MARK()], { runId: RUNID, matter: RUNID, identity: null });
  const line = identityLine(html);
  assert.ok(line, "an archived run still gets an identity line");
  assert.match(line, /IRONWHISK/, "the mark stands alone");
  assert.doesNotMatch(line, /Knockout search/, "nothing is invented for a run that carries no identity");
  assert.doesNotMatch(html, /tmpdemo|sample-capture/,
    "the run that has no identity is the one that used to print the raw name — it must not fall back to it");
});

// ── THE FOOTER SAYS THE SAME THREE THINGS, AND ISSUES A DATE ─────────────────────────────────────
//
// It read "<product>. / Matter <runId>. Issued <date · time>." — the run identifier a second time,
// under a label calling it the client's matter when it is the engine's own run directory, and the
// publish clock. Built from the same parts as the identity line now, so the two cannot drift apart.
//
// The TIME is dropped on both. `issued` is composed at publish as date-then-time, and that time is the
// minute the file was written: it tells a reader nothing, and on a screen whose work spans hours it
// implies a precision the work does not have.
const footerOf = (html) => (html.match(/<footer[^>]*>([\s\S]*?)<\/footer>/) || [])[1] ?? "";

test("the footer names mark, search and an issue DATE — no identifier, no clock", () => {
  const html = RENDER([MARK()], { runId: RUNID, matter: RUNID, issued: "2026-09-15 · 08:36" });
  const foot = footerOf(html);
  assert.match(foot, /IRONWHISK/, "the mark");
  assert.match(foot, /Knockout search/, "the search");
  assert.match(foot, /issued on 2026-09-15/, "the date it was issued");
  assert.doesNotMatch(foot, /08:36/, "not the minute the file was written");
  assert.doesNotMatch(foot, /Matter/, "nothing calls the run directory the client's matter");
  assert.doesNotMatch(html, /tmpdemo|sample-capture/, "and the identifier is nowhere on the page");
});

test("the header issues the same date, and neither surface carries the clock", () => {
  const html = RENDER([MARK()], { runId: RUNID, matter: RUNID, issued: "2026-09-15 · 08:36" });
  assert.match(html, /Issued on 2026-09-15/, "the header issues a date");
  assert.doesNotMatch(html, /08:36/, "the publish clock reaches neither surface");
});

test("clause F: an issued value in an unexpected shape falls through whole rather than being cut", () => {
  // The date is taken by PATTERN, not by splitting on the separator. Both approaches agree on the
  // shape this publisher writes today, so the fixture that separates them is one where a separator
  // appears and the leading part is NOT a date — an archived run written before the format settled.
  // Splitting would hand the reader "Q3" as the day the search issued; matching hands back the whole
  // string, which is honest about not recognising it. Driven in this direction on purpose: the arm
  // that used "15 September 2026" passed under BOTH, so it proved nothing about the rule.
  const odd = RENDER([MARK()], { runId: RUNID, matter: RUNID, issued: "Q3 \u00b7 2026" });
  assert.match(footerOf(odd), /issued on Q3 \u00b7 2026/, "an unrecognised shape survives whole");
  assert.doesNotMatch(footerOf(odd), /issued on Q3\./, "it is not truncated at the separator");

  const plain = RENDER([MARK()], { runId: RUNID, matter: RUNID, issued: "15 September 2026" });
  assert.match(footerOf(plain), /issued on 15 September 2026/, "…and a shape with no separator too");
});

test("clause F: a batch with no marks still names no run directory", () => {
  // WHAT THIS DOES AND DOES NOT HOLD, because the first version of this comment was wrong. A title
  // is ALWAYS truthy here — `batchTitle` returns the mark's name, or "<n> names", and for an empty
  // batch that is the string "0 names". So there is no input under which a `title || runId` fallback
  // could reach the identifier, and no arm can separate that fallback from its absence. It is
  // unreachable rather than guarded, and writing an arm that claims to guard it would be a false
  // reassurance to whoever changes this next.
  //
  // What this arm does hold is the degenerate batch: a document with nothing to name still prints no
  // run directory anywhere. The regression it actually catches is the real one — restoring the old
  // `matter || runId` line — and that was driven, not assumed.
  const html = RENDER([], { runId: RUNID, matter: RUNID });
  assert.doesNotMatch(html, /tmpdemo|sample-capture/,
    "with nothing else to name, the page still does not fall back to the run directory");
  const line = identityLine(html);
  if (line) assert.doesNotMatch(line, /tmpdemo|sample-capture/, "nor does the identity line itself");
});

// ── A.1 — what was asked, and any flag on the asking, at the top ─────────────────────────────────────

const SCOPE = {
  marks: ["IRONWHISK"], classes: [8], jurisdictions: ["EU", "US"],
  goods: "hand tools and kitchen implements",
};

test("A.1: what was asked comes from the run's OWN instructed scope, not from model prose", () => {
  const html = RENDER([MARK()], { instructedScope: SCOPE });
  assert.match(html, /class="panel about"/, "the request panel renders");
  assert.match(html, /About this request/);
  // The prose sentences became labelled rows. What the requester stated has to survive that, so the
  // arm reads the VALUES, which is the part a client acts on, and not the wording around them.
  assert.match(html, /<span class="k">Instructed use<\/span><span class="v">hand tools and kitchen implements<\/span>/,
    "the goods as the requester stated them");
  assert.match(html, /<span class="k">Classes<\/span><span class="v">8<\/span>/);
  assert.match(html, /<span class="k">Where searched<\/span><span class="v">the European Union and the United States<\/span>/,
    "territories in words");
});

// Item 18 (owner, 2026-09-16) retired the whole of the notes-on-the-page design, which these three arms
// were written against: a reviewer's note was lifted to the top when it was about the REQUEST, left under
// the cards when it was about the NAME, and labelled for the reader it was written for. None of that is
// drawn now. What replaces those arms is the property that OUTLIVES the design — the page is filtered and
// the record is not — driven both ways round, because an arm asserting only the absence would pass just as
// well if the notes had been dropped from the run record too.
test("A.4/A.5 item 18: no reviewer note reaches the page, however it is typed", () => {
  const aboutRequest = "The dispatch states a beverages industry, which does not match the instructed Class 8 goods.";
  const aboutName = "Check for firm-specific history on this name before advising.";
  const typed = { about: "name", text: "The dispatch is irrelevant here; this is about the mark itself." };
  const html = body(RENDER([MARK({ purpleNotes: [aboutName, aboutRequest, typed] })], { instructedScope: SCOPE }));
  assert.ok(!html.includes(aboutRequest), "a note about the request is not lifted to the top");
  assert.ok(!html.includes(aboutName), "a note about the name is not drawn under the cards");
  assert.ok(!html.includes("irrelevant here"), "nor is one the rater typed itself");
  assert.doesNotMatch(html, /For the reviewing lawyer/, "and no label for a reader the page no longer has");
  assert.doesNotMatch(html, /Remove them before this goes to the client/,
    "the legend is back — a caveat telling the reader how to handle the document, which was ruled out");
});

test("A.4/A.5 item 18: the run record keeps every one of them", () => {
  const notes = ["Check for firm-specific history on this name before advising.",
    "The dispatch states a beverages industry, which does not match the instructed Class 8 goods."];
  const data = knockoutReportData({ marks: [MARK({ purpleNotes: notes })], batch: {} }, FW, { runId: "r", overall: "Medium" });
  assert.deepEqual(data.marks[0].reviewerNotes, notes,
    "item 18 took the notes off the delivered page, not out of the working record");
});

test("A.1 clause F: no instructed scope renders NO panel, never an empty one", () => {
  const html = body(RENDER([MARK()]));
  assert.doesNotMatch(html, /class="panel about"/, "an archived run with no sidecar grows no empty heading");
  assert.doesNotMatch(html, /About this request/);
});

// ── A.2 — the read, its labels and the assessment fold ───────────────────────────────────────────────

test("A.2: the assessment is ON the page, folded, with its own headings intact", () => {
  const html = RENDER([MARK()]);
  assert.match(html, /<summary>Read the full assessment<\/summary>/);
  assert.match(html, /What the name is/, "the assessment's own headings survive the fold");
  assert.match(html, /What drives the rating/);
  assert.doesNotMatch(html, /Full narrative/, "the bullets fold is retired where an assessment exists");
});

test("A.2: retiring the fold does not drop the bullets from the record", () => {
  const data = knockoutReportData({ marks: [MARK()], batch: {} }, FW, { runId: "r", overall: "Medium" });
  // report-data has always carried this field under its reader-facing name, `points`. Asserting
  // `bullets` here would fail for the wrong reason and would say nothing about whether the fold's
  // retirement cost the record anything.
  assert.deepEqual(data.marks[0].points, ["Scattered informal uses; no dominant owner."],
    "the field 331 forbids dropping is still written to report-data, as `points`");
  assert.equal(data.marks[0].assessment, MARK().assessment, "and the assessment beside it");
});

test("A.2 clause F: an archived run with bullets and NO assessment keeps the fold it was delivered", () => {
  const legacy = MARK();
  delete legacy.assessment;
  const html = RENDER([legacy]);
  assert.match(html, /<details class="ko-full"><summary>Full narrative<\/summary>/);
  assert.doesNotMatch(html, /Read the full assessment/, "and grows no empty label for a field it lacks");
});

// ── A.3 — the card fold, and which register filings become cards ─────────────────────────────────────

test("A.3: a card shows its one sentence and folds the paragraph that argues the band", () => {
  const html = RENDER([MARK({ findings: [FINDING()] })]);
  assert.match(html, /class="ko-findnet">A storefront trading under the same name/, "the net stays visible");
  const fold = html.slice(html.indexOf("Why this band"));
  assert.match(html, /<summary>Why this band<\/summary>/);
  assert.ok(fold.includes("traded since 2019"), "the basis paragraph is inside the fold");
  // It still PRINTS: the fold wears ko-full, which openAll() and the beforeprint handler both reach.
  assert.match(html, /<details class="ko-full ko-why">/, "the fold opens for print like every other");
});

test("A.3: a finding with no basis renders no fold rather than an empty one", () => {
  const bare = FINDING();
  delete bare.basis;
  const html = RENDER([MARK({ findings: [bare] })]);
  assert.doesNotMatch(html, /Why this band/);
});

test("A.3: only an EXPLICIT lowest-rung band takes a filing off the page", () => {
  const records = [REC({ recordId: "R-1" }), REC({ recordId: "R-2", owner: "Second Owner Ltd" })];
  const lowest = FW.bands[FW.bands.length - 1].label;
  const html = RENDER(
    [MARK({ registerReads: [{ recordId: "R-1", band: "Medium", read: "It bears on the rating." },
      { recordId: "R-2", band: lowest, read: "It does not." }] })],
    { registerRecords: RECORDS(records), registerCounts: COUNTS() },
  );
  assert.ok(html.includes("Pemberton Tools Ltd"), "the banded filing is drawn as a card");
  const cards = (html.match(/<span class="fnum">[^<]*REG #\d[^<]*<\/span>/g) ?? []);
  assert.equal(cards.length, 1, `exactly one card is drawn, not both (lowest rung = ${lowest})`);
});

test("A.3: the suppressed filings are still in the RECORD and still counted as held back", () => {
  const records = [REC({ recordId: "R-1" }), REC({ recordId: "R-2", owner: "Second Owner Ltd" })];
  const opts = { runId: "r", overall: "Medium", registerRecords: RECORDS(records), registerCounts: COUNTS() };
  const mark = MARK({ registerReads: [{ recordId: "R-1", band: "Low", read: "x" }, { recordId: "R-2", band: "Low", read: "y" }] });
  const data = knockoutReportData({ marks: [mark], batch: {} }, FW, opts);
  const reg = (data.marks[0].findings ?? []).filter((f) => f.shape === "register");
  assert.equal(reg.length, 2, "report-data carries every promoted filing whatever the page draws");
  const html = RENDER([mark], opts);
  assert.match(html, /further filing/, "and the page says how many it held back rather than hiding them");
});

// ── AN ABSENT BAND IS NOT A LOW BAND ────────────────────────────────────────────────────────────────
//
// `band` is optional per row, so a rater who bands the filings that matter and leaves the rest alone is
// doing what the shape invites. An earlier cut read absence as "lowest" and needed a clause-F escape
// beside it — keep everything when NO filing on the mark carries a band. That handled the run with no
// bands and silently mishandled the run with some: a mark whose one typed band happened to be the
// bottom rung lost every card it had, the unruled filings included.
//
// These four are one rule seen from four sides, and the archived case now falls out of it rather than
// being carved around it. The counts are printed per row because "0 cards" is the answer this filter
// gives when it is working AND when it is over-reaching, and only the input tells the two apart.
const cardCount = (html) => (html.match(/<span class="fnum">[^<]*REG #\d[^<]*<\/span>/g) ?? []).length;

test("A.3: an absent band keeps a filing's card — it says less than an unrankable one, not more", () => {
  const records = [REC({ recordId: "R-1" }), REC({ recordId: "R-2", owner: "Second Owner Ltd" }),
    REC({ recordId: "R-3", owner: "Third Owner Ltd" })];
  const opts = { registerRecords: RECORDS(records), registerCounts: COUNTS() };
  const lowest = FW.bands[FW.bands.length - 1].label;
  const draw = (reads) => cardCount(RENDER([MARK(reads ? { registerReads: reads } : {})], opts));

  // 1. No registerReads at all — a run archived before the field existed.
  assert.equal(draw(null), 3, "an archived run renders every card it was delivered with");
  // 2. Reads present, no bands — every run between the read landing and the band landing.
  assert.equal(draw([{ recordId: "R-1", read: "x" }, { recordId: "R-2", read: "y" }, { recordId: "R-3", read: "z" }]),
    3, "reads without bands are not rated-and-all-lowest");
  // 3. PARTIALLY banded, the band above the floor. The two the rater left alone keep their cards.
  assert.equal(draw([{ recordId: "R-1", read: "x", band: "Blocking" }, { recordId: "R-2", read: "y" }, { recordId: "R-3", read: "z" }]),
    3, "banding one filing is not a ruling about the others");
  // 4. PARTIALLY banded, and the one band typed IS the floor. Only that one goes.
  assert.equal(draw([{ recordId: "R-1", read: "x", band: lowest }, { recordId: "R-2", read: "y" }, { recordId: "R-3", read: "z" }]),
    2, `only the filing put on ${lowest} leaves the page`);
  // 5. And the design's own case: every filing explicitly on the floor draws nothing.
  assert.equal(draw([{ recordId: "R-1", read: "x", band: lowest }, { recordId: "R-2", read: "y", band: lowest },
    { recordId: "R-3", read: "z", band: lowest }]), 0, "the case 331 exists to fix");
});

test("A.3: a band this build cannot place on the ladder keeps its card", () => {
  const records = [REC({ recordId: "R-1" })];
  const html = RENDER([MARK({ registerReads: [{ recordId: "R-1", read: "x", band: "Catastrophic" }] })],
    { registerRecords: RECORDS(records), registerCounts: COUNTS() });
  assert.equal(cardCount(html), 1,
    "the rater said something; a word we cannot rank is not a word we may quietly demote");
});

// ── A.4 / A.5 — the reviewer's notes, and their absence from the export ──────────────────────────────

// ── A.7 — what happens next, and the assessment it is taken from ────────────────────────────────────
//
// THE PARAGRAPH MOVES; IT IS NOT COPIED. The first cut of this rendered the section from the assessment
// and left the assessment whole, so the client read the same paragraph twice — once in the fold, once at
// the foot. Nothing red: a spec check asking whether the section is PRESENT passes either way, and so
// does every arm above. The arm that discriminates is a count.

const SPLIT = "## The name\n\nA compound.\n\n## What drives the rating\n\nTwo storefronts.\n\n"
  + "## What to do with it\n\nProceed, and check the domain before filing.";

test("A.7: the outcome paragraph closes the page, and is not also left in the fold", () => {
  const html = body(RENDER([MARK({ assessment: SPLIT })]));
  assert.match(html, /<h2>What happens next<\/h2>/, "it has a section of its own");
  const once = (needle) => (html.split(needle).length - 1);
  assert.equal(once("Proceed, and check the domain before filing."), 1,
    "the paragraph appears exactly once on the page");
  assert.equal(once("What to do with it"), 0, "and its heading went with it");
  assert.equal(once("Two storefronts."), 1, "the rest of the assessment is untouched, and still folded");
  assert.ok(html.indexOf("Two storefronts.") < html.indexOf("Proceed, and check the domain"),
    "the outcome closes the page rather than moving above the read it came from");
});

test("A.7: only the LAST block is hoisted, so a mid-document heading is never reordered", () => {
  // The heading is the model's own — the assessing skill fixes no vocabulary for it. A phrase match
  // anywhere in the document would lift this middle section to the foot and hand the client the
  // engine's argument in an order the engine did not write, with nothing to show for it.
  const mid = "## The name\n\nA compound.\n\n## Recommendation\n\nProceed for now.\n\n"
    + "## What drives the rating\n\nTwo storefronts.";
  const html = body(RENDER([MARK({ assessment: mid })]));
  assert.doesNotMatch(html, /<h2>What happens next<\/h2>/, "no section is built from a middle block");
  assert.ok(html.includes("Recommendation"), "and the assessment renders whole, in its own order");
  assert.ok(html.indexOf("Proceed for now.") < html.indexOf("Two storefronts."),
    "the middle stays in the middle");
});

test("A.7 clause F: an assessment with no such heading renders whole and grows no section", () => {
  const html = body(RENDER([MARK()]));
  assert.doesNotMatch(html, /<h2>What happens next<\/h2>/);
  assert.ok(html.includes("Two storefronts"), "the assessment is still drawn");
});

test("A.7: a batch gives every name its paragraph, under its own name", () => {
  const second = SPLIT.replace("Proceed, and check the domain before filing.", "Do not file this one.");
  const html = body(RENDER([MARK({ assessment: SPLIT }), MARK({ name: "COPPERWHISK", assessment: second })]));
  const sec = html.slice(html.indexOf("<h2>What happens next</h2>"));
  assert.ok(sec.includes("Proceed, and check the domain before filing."), "the first name's paragraph");
  assert.ok(sec.includes("Do not file this one."), "and the second's, which a single-outcome section would drop");
  assert.match(sec, /<h3>IRONWHISK<\/h3>/, "each under the name it belongs to");
  assert.match(sec, /<h3>COPPERWHISK<\/h3>/);
});

// ── A.6 — the one-name page has no index ─────────────────────────────────────────────────────────────

test("A.6: one name renders no at-a-glance row; two names still do", () => {
  // READ THROUGH THE PANEL, NOT THE LEGEND IT USED TO CARRY. This arm probed the index through its
  // "Rated under <framework>" child, and that line is off the page — the framework is named on the
  // rating card now. COUNTED, NOT MATCHED. The index and the cards are built by two functions that emit the same
  // markup — same panel class, same row, same name line — so no selector tells them apart and an arm
  // written as one would be green on a page that draws no index at all. What the index IS, observably,
  // is one extra name line per mark: one name draws its card and nothing else, two draw two cards and
  // the two-line index above them.
  const names = (html) => (html.match(/class="ko-name"/g) ?? []).length;
  const one = RENDER([MARK()], { registerCounts: COUNTS() });
  assert.equal(names(one), 1, "nothing to index, so the name is printed once, on its card");
  const two = RENDER([MARK(), MARK({ name: "COPPERWHISK" })], { registerCounts: COUNTS() });
  assert.equal(names(two), 4, "a batch keeps the index it needs: two cards, and a row each above them");
  assert.ok(two.includes("COPPERWHISK"), "and names the second mark in it");
});

// ── B — the counts table says what it counted ────────────────────────────────────────────────────────

test("B: the column headers carry the definition and the basis paragraph leaves the page", () => {
  const html = RENDER([MARK()], { registerCounts: COUNTS() });
  assert.match(html, /<th>Exactly IRONWHISK<\/th>/);
  assert.match(html, /<th>Contains IRONWHISK<\/th>/);
  assert.match(html, /<th>Near-spellings \(IRONWISK, IRONWHISC\)<\/th>/, "the forms come from the run's own variant list");
  assert.match(html, /A count is not a conflict; the cards above say which filings matter\./);
  assert.doesNotMatch(html, /counted by name only/, "the 70-word basis sentence is off the page");
});

test("B: several names share one table, so no header may name one of them", () => {
  const counts = COUNTS();
  counts.marks.push({ ...counts.marks[0], name: "COPPERWHISK" });
  const html = RENDER([MARK(), MARK({ name: "COPPERWHISK" })], { registerCounts: counts });
  assert.match(html, /<th>Exactly the name<\/th>/);
  assert.doesNotMatch(html, /Exactly IRONWHISK/, "a header naming one mark would be wrong for the other row");
});

test("B: the basis sentence stays in report-data, which is where the issue puts it", () => {
  const data = knockoutReportData({ marks: [MARK()], batch: {} }, FW, { runId: "r", registerCounts: COUNTS() });
  assert.match(String(data.registerCountBasis), /counted by name only/);
});

// ── C — territories in words ─────────────────────────────────────────────────────────────────────────

const territories = (html) => (html.match(/Counted [^<]*/) ?? [])[0] ?? "";

test("C: a bounded scope names its registers in full and prints no code", () => {
  const html = RENDER([MARK()], { registerCounts: COUNTS() });
  assert.equal(territories(html),
    "Counted in the European Union, the United States and the WIPO register, on Clarivate Compumark.");
});

test("C: the provider's internal groupings are dropped, never printed", () => {
  const counts = COUNTS();
  counts.scope.regions = ["US", "XA", "XG", "ZZ"];
  const line = territories(RENDER([MARK()], { registerCounts: counts }));
  assert.equal(line, "Counted in the United States, on Clarivate Compumark.");
  for (const code of ["XA", "XG", "ZZ"]) assert.ok(!line.includes(code), `${code} is not a register a reader can look up`);
});

test("C: more than six registers gives a count and says where the list is", () => {
  const counts = COUNTS();
  counts.scope.regions = ["US", "EM", "WO", "CH", "GB", "FR", "DE"];
  assert.match(territories(RENDER([MARK()], { registerCounts: counts })),
    /^Counted on 7 registers, listed on the workbook's Register Counts sheet/);
});

test("C: a worldwide run states the count, never two hundred codes", () => {
  const counts = COUNTS();
  counts.scope = { ...counts.scope, worldwide: true, regions: new Array(190).fill("XX") };
  const line = territories(RENDER([MARK()], { registerCounts: counts }));
  assert.equal(line, "Counted worldwide, 190 registers, on Clarivate Compumark.");
});

// ── D — the card names the office, not the search vendor ─────────────────────────────────────────────

test("D: a register card states the office and the kind of right, and never the vendor", () => {
  const html = RENDER(
    [MARK({ registerReads: [{ recordId: "R-1", band: "Medium", read: "It bears on the rating." }] })],
    { registerRecords: RECORDS(), registerCounts: COUNTS() },
  );
  const card = html.slice(html.indexOf("REG #1"));
  assert.match(card, /IRONWHISK, United States application \(pending\) by Pemberton Tools Ltd, classes 8, 21\./);
  const sentence = (card.match(/<p class="ko-findnet">([^<]*)</) ?? [])[1] ?? "";
  assert.ok(!/Clarivate|Compumark/.test(sentence), "the search vendor is not a register");
});

test("D: a registration does not say 'registration (registered)'", () => {
  const html = RENDER(
    [MARK({ registerReads: [{ recordId: "R-1", band: "Medium", read: "x" }] })],
    { registerRecords: RECORDS([REC({ status: "REGISTERED" })]), registerCounts: COUNTS() },
  );
  assert.match(html, /IRONWHISK, United States registration by Pemberton Tools Ltd/);
  assert.doesNotMatch(html, /registration \(registered\)/);
});

// ── E — the scope block ──────────────────────────────────────────────────────────────────────────────

// The scope block is off the page (the 2026-09-16 report redesign): the fixed paragraph saying what a screen is and
// is not, and with it the "every conflict above links to the material we found" line. Both were the
// narration the redesign was ordered to cut. ONE ARM HOLDS THE GROUND the deleted arms held, because a
// block removed with nothing asserting its absence comes back on the next edit near it and nothing reds.
test("E: the scope block and its fixed narration are off the page", () => {
  const html = body(RENDER([MARK({ findings: [FINDING()] })], { registerCounts: COUNTS() }));
  assert.doesNotMatch(html, /Scope &amp; what we didn't search/);
  assert.doesNotMatch(html, /<details class="scope"/);
  assert.doesNotMatch(html, /A fast screen for obvious blockers/, "the fixed What this is paragraph");
  assert.doesNotMatch(html, /Every conflict above links to the material we found/);
});

test("E: a caveat making a NEW claim survives; one that only restates the block does not", () => {
  const restates = "This is not a clearance search and it gives no filing advice.";
  const adds = "Ratings reflect worst-case exposure at triage and fuller work can move them either way.";
  const html = renderKnockoutHtml(
    { marks: [MARK()], batch: { executiveSummary: "s", standardCaveats: [restates, adds] } }, FW,
    { runId: "r", overall: "Medium", registerCounts: COUNTS() },
  );
  assert.match(html, /class="panel ko-caveats"/, "the caveats have a block of their own now the scope section has gone");
  assert.ok(html.includes("worst-case exposure"), "a caveat with a new claim is kept");
  assert.ok(!html.includes(restates), "one whose every content word is already in the block is not repeated");
});

// ── the word budget ─────────────────────────────────────────────────────────────────────────────────
//
// The complaint this whole redesign answers was length: one name, 2,000 words before the reader reached
// the note saying the request may have been scoped to the wrong market. The design asks for under 1,200
// visible words with every fold closed, and nothing measured it — so the page can grow back to where it
// started with every other arm in this file green.
//
// AGAINST THE REAL RUN, NOT THE FIXTURES ABOVE. Those are three sentences per mark: a budget asserted
// over them would pass at any page size and say nothing, which is the arm this file did not need. The
// demo run is committed, is what `npm run example` publishes, and is one name.
//
// VISIBLE MEANS FOLDS CLOSED: a `<summary>` is on screen, the rest of a closed `<details>` is not, and
// `<script>`/`<style>`/comments never are. A BLOCK BOUNDARY IS A WORD BOUNDARY — generated markup
// carries no whitespace between adjacent block elements, so a walker that concatenates text reads
// `</p><p>` as one token and under-reads by one word per join, silently. The inline set is listed
// because an unknown tag is far more likely to be a block than a span, and guessing the other way loses
// words rather than inventing them.
const INLINE_TAGS = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn", "em",
  "i", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr"]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "source", "track", "wbr"]);
const NEVER_READ = new Set(["script", "style", "head", "template", "noscript"]);

function visibleWords(html, { foldsOpen = false } = {}) {
  const out = [];
  const stack = [];
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<!--", i)) { const e = html.indexOf("-->", i); i = e < 0 ? html.length : e + 3; continue; }
    if (html[i] === "<") {
      const e = html.indexOf(">", i);
      if (e < 0) break;
      const raw = html.slice(i + 1, e);
      const closing = raw[0] === "/";
      const tag = raw.replace(/^\//, "").split(/[\s/>]/)[0].toLowerCase();
      if (tag) {
        if (closing) { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].tag === tag) { stack.length = k; break; } }
        // A `<details open>` IS ON SCREEN. The first version of this ignored the attribute and treated
        // every fold as closed, which made it blind to the one change that would put the folded detail
        // back in front of the reader — planted by opening a fold, and the arm passed. What is being
        // measured is what a reader sees, not what the markup could hide if it chose to.
        else if (!raw.endsWith("/") && !VOID_TAGS.has(tag)) stack.push({ tag, open: /\sopen(\s|=|$|\/)/i.test(raw) });
        if (!INLINE_TAGS.has(tag)) out.push(" ");
      }
      i = e + 1;
      continue;
    }
    const e = html.indexOf("<", i);
    const skipping = stack.some((e) => NEVER_READ.has(e.tag));
    // Inside a CLOSED <details>, everything is hidden EXCEPT the <summary> that labels it.
    const hidden = !foldsOpen && stack.some((e, k) =>
      e.tag === "details" && !e.open && !stack.slice(k + 1).some((f) => f.tag === "summary"));
    if (!skipping && !hidden) out.push(html.slice(i, e < 0 ? html.length : e).replace(/&nbsp;/g, " ").replace(/&[a-z]+;|&#\d+;/gi, "x"));
    i = e < 0 ? html.length : e;
  }
  return out.join("").trim().split(/\s+/).filter(Boolean).length;
}

test("the one-name page stays inside its word budget, folds closed", () => {
  const at = (p) => fileURLToPath(new URL(`../../demo/knockout-search/run/${p}`, import.meta.url));
  const j = (p) => JSON.parse(readFileSync(at(p), "utf8"));
  const findings = j("knockout-findings.json");
  assert.equal((findings.marks ?? []).length, 1, "the budget in the issue is stated for a ONE-NAME page");

  const html = renderKnockoutHtml(findings, j("_driver/framework.json"), {
    runId: "budget", overall: null, issued: "2026-09-07",
    registerCounts: j("_driver/register-counts.json"),
    registerRecords: j("_driver/register-records.json"),
    instructedScope: j("_driver/instructed-scope.json"),
    identity: null, matter: "budget", demoData: false,
    delivery: { privileged: false },
  });

  const closed = visibleWords(html);
  const open = visibleWords(html, { foldsOpen: true });

  // A FLOOR AS WELL AS A CEILING. A renderer that emitted almost nothing would satisfy a ceiling alone,
  // and a page that has stopped rendering its content reads exactly like a page that got shorter.
  assert.ok(closed > 400, `the page rendered only ${closed} visible words — that is not a shorter page, it is a broken one`);
  assert.ok(closed < 1200,
    `the one-name page is ${closed} visible words with every fold closed; the design asks for under 1,200. `
    + `The complaint this answers was 2,000 words before the reader reached the request flag.`);

  // AND THE FOLDS MUST ACTUALLY HOLD SOMETHING. Without this, deleting every <details> would drive the
  // closed count down and pass — the detail would be gone from the page rather than folded off it, and
  // "folds closed" would be measuring a page that has no folds.
  assert.ok(open > closed + 200,
    `opening the folds added only ${open - closed} words, so the detail is not being folded away — it is missing`);
});

// ── THE KNOCKOUT CARRIES THE EXPORT CONTROL THE APPROVED HEADER DRAWS ───────────────────────────────
//
// The approved header is "brand, band badge, name and type, Issued on, Ask AI, Export", the same as the
// clearance report's. This template emitted no Export control and no popover, while the stylesheet it
// inlines still described its utility buttons as the ones "used by the topbar Export popover". A reader
// inside the portal could still ask the assistant to export, because the serve-time bridge reaches
// `exportPDF` by name; a reader who opened the file itself had the browser's print command and nothing
// on the page.
//
// BREAK MATRIX:
//   · the control is in the top bar             → break: emit no popover, arm 1 red
//   · its entry is the plain print              → break: copy the clearance's tick wording, arm 2 red
//   · no select-all names a control that cannot exist → break: copy the clearance's pickAll row, arm 3 red
//   · the verbs it calls are DEFINED here       → break: offer a verb this template does not define, arm 4 red
//   · it is not printed                         → break: drop no-print from the bar, arm 5 red
test("the knockout's top bar carries an Export control, and it offers only what this template can do", () => {
  const html = RENDER([MARK()]);

  assert.match(html, /class="tbbtn primary tb-exp-toggle"/, "no Export control in the knockout's top bar");
  assert.match(html, /class="tb-pop tb-exp-pop" hidden/, "the Export control opens no popover");
  assert.match(html, /<button class="util primary" onclick="exportPDF\(\)">[^<]*Export PDF<\/button>/,
    "the popover has no plain Export PDF entry");

  // THE TICK WORDING IS THE CLEARANCE'S AND IT DOES NOT BELONG HERE. This template has no pickbox, so a
  // "(ticked findings)" entry and a Select all row would both name a control that cannot exist.
  assert.doesNotMatch(html, /ticked findings/, "the knockout offers to filter by a tick it does not have");
  // ON THE CALL, NOT ON THE WORD. The page's own script CARRIES the name in a comment explaining why
  // this template defines no pickAll, so a bare search for it matches the reason the control is absent.
  assert.doesNotMatch(html, /onclick="pickAll/, "a select-all reaches a verb this template deliberately does not define");
  assert.doesNotMatch(html, /Tick a finding/, "the clearance's hint about ticking came with the markup");

  // EVERY VERB THE POPOVER CALLS IS DEFINED IN THE PAGE. The serve-time bridge looks these up by name,
  // and the whole reason this template defines no pickAll is that an absent verb is an absent menu item
  // rather than a control that fails. A popover calling one anyway would put that back.
  for (const verb of [...html.matchAll(/onclick="(\w+)\(/g)].map((m) => m[1])) {
    assert.match(html, new RegExp(`function ${verb}\\(`), `the page calls ${verb}() and does not define it`);
  }

  // The bar is chrome, not document: it carries no-print, so the exported PDF shows no controls.
  assert.match(html, /<div class="topbar no-print">/, "the top bar would print into the PDF");

  // BUILT TO THE BOARD, NOT TO THE ISSUE TEXT. The board puts Ask AI and Export in one menu and draws
  // the Export button and its caret; it does not draw what the menu contains. So the entries are the
  // clearance report's own words and the menu carries no heading — a heading here would be a word on a
  // client's page that nobody chose.
  const menu = (html.match(/<div class="tb-menu">[\s\S]*?<\/div>\s*<\/div>/) || [])[0] ?? "";
  assert.match(menu, /tb-ask/, "Ask AI sits outside the menu the board draws it in");
  assert.match(menu, /tb-exp-toggle/, "the Export button sits outside that menu");
  // ON THE ELEMENT, NOT ON THE WORD — again. The page INLINES report.css, which styles a heading the
  // clearance report uses, so a bare search for the class name matches the stylesheet and would fail
  // whatever the markup did. This is the second assertion in this arm to need narrowing for the same
  // reason: the rendered page carries the vocabulary of both templates, only one of which it uses.
  assert.doesNotMatch(html, /<div class="tb-pop-title"/, "the menu carries a heading the board does not draw");
});

// ── THE EXPORT MENU IS ONE CONTROL, AND THIS IS THE knockout HALF OF SAYING SO ──────────────────────
//
// Both report templates draw an export menu. They drew two copies of it — the knockout's arrived by
// being re-emitted from the clearance's markup, because the clearance renderer is frozen and lifting the
// control out was its own change. The shell now comes from `report-topbar.mjs` and both templates import
// it; the ENTRIES stay each template's own, because they are a statement about what that template can do.
//
// PINNED TO THE MODULE'S OWN STRINGS, not to a spelling written here. A future author who re-forks a
// copy has to keep it byte-identical to pass, and the moment the fork drifts — a class renamed, an aria
// attribute dropped, a listener changed — this reds, in the file whose template drifted.
//
// BREAK MATRIX:
//   · the page emits the module's toggle      → break: spell a second one here, arm 1 red
//   · the page carries the module's listeners → break: copy them back inline and change one, arm 2 red
//   · ONE menu, not two                       → break: emit the shell twice, arm 3 red
test("the export menu this template draws is the shared one, not a copy of it", () => {
  const html = RENDER([MARK()]);
  assert.ok(html.includes(EXPORT_TOGGLE), "the export button is not the shared one — this template spells its own");
  assert.ok(html.includes(EXPORT_MENU_JS), "the open/close behaviour is not the shared one");
  assert.equal(html.split('class="tb-pop tb-exp-pop"').length - 1, 1, "the page carries more than one export panel");
  // COUNTED ON THE BUTTON, NOT ON ITS CLASS NAME. The first spelling of this assertion counted the bare
  // string and expected two — one in the markup, one in the listeners — and the listeners name it three
  // times. The number was guessed rather than measured, which is the defect this whole arm exists to
  // catch one level along. The button itself appears once, and that is the property.
  assert.equal(html.split(EXPORT_TOGGLE).length - 1, 1, "the export button is emitted other than once");
});
