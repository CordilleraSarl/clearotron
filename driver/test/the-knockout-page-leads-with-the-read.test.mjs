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

// ── A.1 — what was asked, and any flag on the asking, at the top ─────────────────────────────────────

const SCOPE = {
  marks: ["IRONWHISK"], classes: [8], jurisdictions: ["EU", "US"],
  goods: "hand tools and kitchen implements",
};

test("331 A.1: what was asked comes from the run's OWN instructed scope, not from model prose", () => {
  const html = RENDER([MARK()], { instructedScope: SCOPE });
  assert.match(html, /class="ko-req"/, "the request block renders");
  assert.match(html, /About this request/);
  assert.match(html, /Class 8 — hand tools and kitchen implements/, "the goods as the requester stated them");
  assert.match(html, /Searched in the European Union and the United States\./, "territories in words");
});

test("331 A.1: a note about the REQUEST is lifted to the top and does not also print under the cards", () => {
  const flag = "The dispatch states a beverages industry, which does not match the instructed Class 8 goods.";
  const own = "Check for firm-specific history on this name before advising.";
  const html = RENDER([MARK({ purpleNotes: [own, flag] })], { instructedScope: SCOPE });
  const req = html.slice(html.indexOf('class="ko-req"'), html.indexOf("On-field conflicts"));
  const cards = html.slice(html.indexOf("On-field conflicts"));
  assert.ok(req.includes(flag), "the request flag is above the conflicts");
  assert.ok(!cards.includes(flag), "and is not repeated under them");
  assert.ok(cards.includes(own), "a note about the NAME stays where it was");
  assert.ok(!req.includes(own), "and is not lifted");
});

test("331 A.1: the rater's own split WINS over the fallback, which is then never consulted", () => {
  // The word the fallback keys on, on a note the rater has typed as being about the NAME. If the
  // fallback ran at all — even additively — this note would be lifted. It must not be.
  const typed = { about: "name", text: "The dispatch is irrelevant here; this is about the mark itself." };
  const html = RENDER([MARK({ purpleNotes: [typed] })], { instructedScope: SCOPE });
  const req = html.slice(html.indexOf('class="ko-req"'), html.indexOf("On-field conflicts"));
  assert.ok(!req.includes("irrelevant here"), "a typed name-note is never lifted by the word-fallback");
  assert.ok(html.slice(html.indexOf("On-field conflicts")).includes("irrelevant here"), "it renders under the cards");
});

test("331 A.1 clause F: no instructed scope and no request flag renders NO block, never an empty one", () => {
  const html = body(RENDER([MARK()]));
  assert.doesNotMatch(html, /class="ko-req"/, "an archived run with no sidecar grows no empty heading");
  assert.doesNotMatch(html, /About this request/);
});

// ── A.2 — the read, its labels and the assessment fold ───────────────────────────────────────────────

test("331 A.2: the assessment is ON the page, folded, with its own headings intact", () => {
  const html = RENDER([MARK()]);
  assert.match(html, /<summary>Read the full assessment<\/summary>/);
  assert.match(html, /What the name is/, "the assessment's own headings survive the fold");
  assert.match(html, /What drives the rating/);
  assert.doesNotMatch(html, /Full narrative/, "the bullets fold is retired where an assessment exists");
});

test("331 A.2: retiring the fold does not drop the bullets from the record", () => {
  const data = knockoutReportData({ marks: [MARK()], batch: {} }, FW, { runId: "r", overall: "Medium" });
  // report-data has always carried this field under its reader-facing name, `points`. Asserting
  // `bullets` here would fail for the wrong reason and would say nothing about whether the fold's
  // retirement cost the record anything.
  assert.deepEqual(data.marks[0].points, ["Scattered informal uses; no dominant owner."],
    "the field 331 forbids dropping is still written to report-data, as `points`");
  assert.equal(data.marks[0].assessment, MARK().assessment, "and the assessment beside it");
});

test("331 A.2 clause F: an archived run with bullets and NO assessment keeps the fold it was delivered", () => {
  const legacy = MARK();
  delete legacy.assessment;
  const html = RENDER([legacy]);
  assert.match(html, /<details class="ko-full"><summary>Full narrative<\/summary>/);
  assert.doesNotMatch(html, /Read the full assessment/, "and grows no empty label for a field it lacks");
});

// ── A.3 — the card fold, and which register filings become cards ─────────────────────────────────────

test("331 A.3: a card shows its one sentence and folds the paragraph that argues the band", () => {
  const html = RENDER([MARK({ findings: [FINDING()] })]);
  assert.match(html, /class="ko-findnet">A storefront trading under the same name/, "the net stays visible");
  const fold = html.slice(html.indexOf("Why this band"));
  assert.match(html, /<summary>Why this band<\/summary>/);
  assert.ok(fold.includes("traded since 2019"), "the basis paragraph is inside the fold");
  // It still PRINTS: the fold wears ko-full, which openAll() and the beforeprint handler both reach.
  assert.match(html, /<details class="ko-full ko-why">/, "the fold opens for print like every other");
});

test("331 A.3: a finding with no basis renders no fold rather than an empty one", () => {
  const bare = FINDING();
  delete bare.basis;
  const html = RENDER([MARK({ findings: [bare] })]);
  assert.doesNotMatch(html, /Why this band/);
});

test("331 A.3: only an EXPLICIT lowest-rung band takes a filing off the page", () => {
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

test("331 A.3: the suppressed filings are still in the RECORD and still counted as held back", () => {
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

test("331 A.3: an absent band keeps a filing's card — it says less than an unrankable one, not more", () => {
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

test("331 A.3: a band this build cannot place on the ladder keeps its card", () => {
  const records = [REC({ recordId: "R-1" })];
  const html = RENDER([MARK({ registerReads: [{ recordId: "R-1", read: "x", band: "Catastrophic" }] })],
    { registerRecords: RECORDS(records), registerCounts: COUNTS() });
  assert.equal(cardCount(html), 1,
    "the rater said something; a word we cannot rank is not a word we may quietly demote");
});

// ── A.4 / A.5 — the reviewer's notes, and their absence from the export ──────────────────────────────

test("331 A.4/A.5: the notes say who they are for, and the export strips them", () => {
  const html = RENDER([MARK({ purpleNotes: ["Pull the full goods list before advising."] })]);
  assert.match(html, /For the reviewing lawyer/, "the label names the reader");
  assert.match(html, /Purple notes are for the reviewing lawyer\. Remove them before this goes to the client\./);
  // The knockout's export IS window.print() (exportPDF), so the print rule is the whole strip.
  assert.match(html, /@media print\{\.internal\{display:none ?!important\}\}/,
    "internal notes come off the PDF, as the clearance page has always done");
});

// ── A.6 — the one-name page has no index ─────────────────────────────────────────────────────────────

test("331 A.6: one name renders no at-a-glance row; two names still do", () => {
  const one = RENDER([MARK()], { registerCounts: COUNTS() });
  assert.doesNotMatch(one, /class="ko-legend"/, "nothing to index, so no index");
  const two = RENDER([MARK(), MARK({ name: "COPPERWHISK" })], { registerCounts: COUNTS() });
  assert.match(two, /class="ko-legend"/, "a batch keeps the index it needs");
});

// ── B — the counts table says what it counted ────────────────────────────────────────────────────────

test("331 B: the column headers carry the definition and the basis paragraph leaves the page", () => {
  const html = RENDER([MARK()], { registerCounts: COUNTS() });
  assert.match(html, /<th>Exactly IRONWHISK<\/th>/);
  assert.match(html, /<th>Contains IRONWHISK<\/th>/);
  assert.match(html, /<th>Near-spellings \(IRONWISK, IRONWHISC\)<\/th>/, "the forms come from the run's own variant list");
  assert.match(html, /A count is not a conflict; the cards above say which filings matter\./);
  assert.doesNotMatch(html, /counted by name only/, "the 70-word basis sentence is off the page");
});

test("331 B: several names share one table, so no header may name one of them", () => {
  const counts = COUNTS();
  counts.marks.push({ ...counts.marks[0], name: "COPPERWHISK" });
  const html = RENDER([MARK(), MARK({ name: "COPPERWHISK" })], { registerCounts: counts });
  assert.match(html, /<th>Exactly the name<\/th>/);
  assert.doesNotMatch(html, /Exactly IRONWHISK/, "a header naming one mark would be wrong for the other row");
});

test("331 B: the basis sentence stays in report-data, which is where the issue puts it", () => {
  const data = knockoutReportData({ marks: [MARK()], batch: {} }, FW, { runId: "r", registerCounts: COUNTS() });
  assert.match(String(data.registerCountBasis), /counted by name only/);
});

// ── C — territories in words ─────────────────────────────────────────────────────────────────────────

const territories = (html) => (html.match(/Counted [^<]*/) ?? [])[0] ?? "";

test("331 C: a bounded scope names its registers in full and prints no code", () => {
  const html = RENDER([MARK()], { registerCounts: COUNTS() });
  assert.equal(territories(html),
    "Counted in the European Union, the United States and the WIPO register, on Clarivate Compumark.");
});

test("331 C: the provider's internal groupings are dropped, never printed", () => {
  const counts = COUNTS();
  counts.scope.regions = ["US", "XA", "XG", "ZZ"];
  const line = territories(RENDER([MARK()], { registerCounts: counts }));
  assert.equal(line, "Counted in the United States, on Clarivate Compumark.");
  for (const code of ["XA", "XG", "ZZ"]) assert.ok(!line.includes(code), `${code} is not a register a reader can look up`);
});

test("331 C: more than six registers gives a count and says where the list is", () => {
  const counts = COUNTS();
  counts.scope.regions = ["US", "EM", "WO", "CH", "GB", "FR", "DE"];
  assert.match(territories(RENDER([MARK()], { registerCounts: counts })),
    /^Counted on 7 registers, listed on the workbook's Register Counts sheet/);
});

test("331 C: a worldwide run states the count, never two hundred codes", () => {
  const counts = COUNTS();
  counts.scope = { ...counts.scope, worldwide: true, regions: new Array(190).fill("XX") };
  const line = territories(RENDER([MARK()], { registerCounts: counts }));
  assert.equal(line, "Counted worldwide, 190 registers, on Clarivate Compumark.");
});

// ── D — the card names the office, not the search vendor ─────────────────────────────────────────────

test("331 D: a register card states the office and the kind of right, and never the vendor", () => {
  const html = RENDER(
    [MARK({ registerReads: [{ recordId: "R-1", band: "Medium", read: "It bears on the rating." }] })],
    { registerRecords: RECORDS(), registerCounts: COUNTS() },
  );
  const card = html.slice(html.indexOf("REG #1"));
  assert.match(card, /IRONWHISK, United States application \(pending\) by Pemberton Tools Ltd, classes 8, 21\./);
  const sentence = (card.match(/<p class="ko-findnet">([^<]*)</) ?? [])[1] ?? "";
  assert.ok(!/Clarivate|Compumark/.test(sentence), "the search vendor is not a register");
});

test("331 D: a registration does not say 'registration (registered)'", () => {
  const html = RENDER(
    [MARK({ registerReads: [{ recordId: "R-1", band: "Medium", read: "x" }] })],
    { registerRecords: RECORDS([REC({ status: "REGISTERED" })]), registerCounts: COUNTS() },
  );
  assert.match(html, /IRONWHISK, United States registration by Pemberton Tools Ltd/);
  assert.doesNotMatch(html, /registration \(registered\)/);
});

// ── E — the scope block ──────────────────────────────────────────────────────────────────────────────

test("331 E: the scope block says what the screen is and is not, with 'clearance' at most twice", () => {
  const html = RENDER([MARK()], { registerCounts: COUNTS() });
  const scope = html.slice(html.indexOf("Scope &amp; what we didn't search"));
  assert.match(scope, /<b>What this is\.<\/b> A fast screen for obvious blockers/);
  assert.match(scope, /<b>What it is not\.<\/b> A clearance search\./);
  // COUNTED ON WHAT A READER SEES. The first pass counted the raw HTML and reached three, the third
  // being the word inside a source comment — so the arm was measuring the file, not the page. The
  // model's caveats sit behind a border after this block; how often THEY say it is the two-register rule's
  // business, not this renderer's.
  const cut = scope.indexOf('style="border-top');
  const fixed = (cut > 0 ? scope.slice(0, cut) : scope)
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ');
  assert.equal((fixed.match(/clearance/gi) ?? []).length, 2,
    "the code-owned block states it twice; five restatements were the complaint");
});

test("331 E: 'every conflict above links to what we found' is not said when a conflict cites nothing", () => {
  const cited = RENDER([MARK({ findings: [FINDING()] })], { registerCounts: COUNTS() });
  assert.match(cited, /Every conflict above links to the material we found\./);
  const uncited = RENDER([MARK({ findings: [FINDING(), FINDING({ ordinal: 2, evidence: [] })] })], { registerCounts: COUNTS() });
  assert.doesNotMatch(uncited, /Every conflict above links/,
    "said over a finding that cites nothing it is an absence claim wider than what was examined");
});

test("331 E: a caveat making a NEW claim survives; one that only restates the block does not", () => {
  const restates = "This is not a clearance search and it gives no filing advice.";
  const adds = "Ratings reflect worst-case exposure at triage and fuller work can move them either way.";
  const html = renderKnockoutHtml(
    { marks: [MARK()], batch: { executiveSummary: "s", standardCaveats: [restates, adds] } }, FW,
    { runId: "r", overall: "Medium", registerCounts: COUNTS() },
  );
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

test("331: the one-name page stays inside its word budget, folds closed", () => {
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
