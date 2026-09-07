// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Contract tests for doubt-ledger.mjs — doubts end in a recorded judgment.
// The defect shape under test is the copper-gantry trio, rebuilt with INVENTED marks/owners (no client
// data in git): an asserted "active nationwide product" fragment, a direct-search "does NOT appear on
// official sites" refutation, and a "requires cross-check" hand-off — three fragments about ONE mark
// that used to ship side by side with no surface saying which won. Everything here is pure/offline.
import test from "node:test";
import assert from "node:assert/strict";
import { mintCrossCheckDoubts, mintContradictionDoubts, stitchDoubts, capsCandidates,
  normalizeJoinText, parseClosureLines, applyClosure, squash } from "../doubt-ledger.mjs";

// ── shared synthetic material (all invented) ─────────────────────────────────────────────────────
const GATHER_MD = [
  "# Common-law findings — VOLTMAX",
  "",
  "## Supplementary search summary",
  "Direct search of nutrivolt.example for all variants returned no product matches.",
  "CROSS-CHECK REQUIRED: VOLTMAX ENERGYCORE US/Madrid designations — direct owner-site search found no such product; only the register can say whether a dormant filing exists",
  "Some later prose noting this requires prelim-register layer cross-check, but not in the dictated form.",
].join("\n");

// The synthetic PROPEL-shaped trio: assertion, refutation, unrelated bystander.
const TRIO_BLOCKS = [
  {
    title: "**[NEW] NutriVolt VOLTMAX ENERGYCORE (Electrolyte Sports Drink)**",
    owner: "NutriVolt Beverages, Inc.",
    source_layer: "Common-law",
    description: "CRITICAL FINDING: VOLTMAX ENERGYCORE positioned as an enhanced electrolyte sports drink. Active commercial product with nationwide distribution via retail channels.",
  },
  {
    title: "Kestrel Hydration (VOLTMAX ENERGYCORE NOT found on NutriVolt sites)",
    owner: "",
    source_layer: "Common-law",
    description: "Direct search of nutrivolt.example and its brand sites for all variants returned NO matches. VOLTMAX ENERGYCORE does NOT appear as a product name on official NutriVolt sites — may be a dormant filing or historical mark.",
  },
  {
    title: "Aquarelle Fizz (no direct conflict found)",
    owner: "",
    source_layer: "Common-law",
    description: "Watchlist target: site search returns general event content, nothing conflicting on the owned site.",
  },
];

const OFF_FIELD_FINDINGS = {
  findings: [{
    ordinal: 4, mark: "VOLTMAX ENERGYCORE",
    owner: { name: "NutriVolt Beverages, Inc.", country: "US" },
    disposition: "off-field",
  }],
  actions: [{
    id: 2, kind: "monitoring",
    text: "Watch for any US application or Madrid designation of NutriVolt's VOLTMAX ENERGYCORE and re-assess if any surfaces.",
    ordinals: [4],
  }],
};

// ── minting: the dictated hand-off line ──────────────────────────────────────────────────────────
test("mintCrossCheckDoubts parses the dictated line and IGNORES free prose (the copper-gantry note nothing parsed)", () => {
  const doubts = mintCrossCheckDoubts(GATHER_MD, "common-law-findings.md");
  assert.equal(doubts.length, 1, "exactly the dictated line mints — the prose cross-check mention mints nothing");
  const [d] = doubts;
  assert.equal(d.birth.place, "gather-crosscheck");
  assert.equal(d.birth.artifact, "common-law-findings.md");
  assert.ok(d.birth.quote.startsWith("CROSS-CHECK REQUIRED: VOLTMAX ENERGYCORE"), "the birth quote is the verbatim line");
  assert.deepEqual(d.subject.terms, ["VOLTMAX ENERGYCORE"], "the caps-named mark is extracted as the join term");
  assert.equal(d.status, "open");
  assert.equal(d.ending, null);
});

test("a legacy artifact with no dictated line mints nothing at all", () => {
  const legacy = "## Findings\nRequires prelim-register layer cross-check for designations.\nCross-check required for VOLTMAX (lowercase prefix, wrong shape).";
  assert.deepEqual(mintCrossCheckDoubts(legacy, "common-law-findings.md"), []);
});

// ── minting: audit contradictions ────────────────────────────────────────────────────────────────
test("mintContradictionDoubts pairs the asserted block with its direct-search refutation — one doubt for the trio", () => {
  const doubts = mintContradictionDoubts(TRIO_BLOCKS);
  assert.equal(doubts.length, 1, "one doubt per contradictory pair; the bystander pairs with nothing");
  const [d] = doubts;
  assert.equal(d.birth.place, "audit-contradiction");
  assert.equal(d.subject.mark, "VOLTMAX ENERGYCORE");
  assert.equal(d.subject.asserted, TRIO_BLOCKS[0].title);
  assert.equal(d.subject.refuting, TRIO_BLOCKS[1].title);
  assert.ok(d.birth.quote.includes(TRIO_BLOCKS[0].title) && d.birth.quote.includes(TRIO_BLOCKS[1].title),
    "the birth quote carries both fragments verbatim — the doubt IS the pair");
});

test("no contradiction is minted without an explicit negation or without a shared distinctive mark", () => {
  // same blocks minus the refutation's negation language → nothing pairs
  const soft = [TRIO_BLOCKS[0], { ...TRIO_BLOCKS[1], title: "Kestrel Hydration review", description: "VOLTMAX ENERGYCORE reviewed on owner sites; product line focuses on other names." }, TRIO_BLOCKS[2]];
  assert.deepEqual(mintContradictionDoubts(soft), []);
});

// ── stitching: joins to resolutions the run already produced ─────────────────────────────────────
test("a contradiction doubt stitches to the findings.json off-field resolution, carrying disposition/ordinal + the referencing action", () => {
  const doubts = mintContradictionDoubts(TRIO_BLOCKS);
  const [d] = stitchDoubts(doubts, { findings: OFF_FIELD_FINDINGS });
  assert.equal(d.status, "checked-and-settled");
  assert.equal(d.ending.by, "code-stitch");
  assert.equal(d.ending.evidence.file, "findings.json");
  assert.ok(d.ending.evidence.quote.includes("finding #4"), "the ordinal travels");
  assert.ok(d.ending.evidence.quote.includes("off-field"), "the disposition travels");
  assert.ok(d.ending.evidence.quote.includes("Watch for any US application"), "the action referencing ordinal 4 is COPIED, never re-worded");
});

test("a gather cross-check doubt stitches to a register-findings answer line naming its mark", () => {
  const doubts = mintCrossCheckDoubts(
    "CROSS-CHECK REQUIRED: GLACIALIS PEAKFUEL CH designations — marketplace hit could not be verified against the register in this layer",
    "common-law-findings.md");
  const registerFindingsText = [
    "# Register findings — Mark: TEST",
    "",
    "## Answers to your instructions",
    "- You asked us to check GLACIALIS PEAKFUEL designations → nothing found on the CH register; dormant 2019 filing only, watch-only",
    "",
    "## Coverage ledger",
    "| Coverage unit | Status | Reason |",
    "|---|---|---|",
    "| primary-sweep / worldwide | confirmed-clean | full |",
  ].join("\n");
  const [d] = stitchDoubts(doubts, { registerFindingsText });
  assert.equal(d.status, "checked-and-settled");
  assert.equal(d.ending.evidence.file, "register-findings.md");
  assert.ok(d.ending.evidence.quote.includes("nothing found on the CH register"), "the answer line itself is the evidence quote");
});

test("a doubt stitches to a coverage-ledger row naming its term", () => {
  const doubts = mintCrossCheckDoubts(
    "CROSS-CHECK REQUIRED: ZEPHYRINE COLDBREW US designations — owner-site search was inconclusive",
    "register-units/primary-sweep.md");
  const coverageRows = [
    { axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "full" },
    { axis: "primary-sweep", scope: "ZEPHYRINE COLDBREW US designations", status: "confirmed-clean", reason: "exact slice enumerated to has_more:false; no live US record" },
  ];
  const [d] = stitchDoubts(doubts, { coverageRows });
  assert.equal(d.status, "checked-and-settled");
  assert.equal(d.ending.evidence.file, "register-coverage-ledger.json");
  assert.ok(d.ending.evidence.quote.includes("confirmed-clean"), "the row's status travels in the evidence");
  assert.ok(d.ending.evidence.quote.includes("ZEPHYRINE COLDBREW"), "the NAMING row is the one joined, not the generic worldwide row");
});

test("an unstitchable doubt stays OPEN — nothing loops, nothing guesses", () => {
  const doubts = mintCrossCheckDoubts(
    "CROSS-CHECK REQUIRED: MARLOVIA QUENCHROOT EU designations — no register layer ran for the EU this run",
    "common-law-findings.md");
  const [d] = stitchDoubts(doubts, {
    findings: OFF_FIELD_FINDINGS,                              // resolutions exist — for OTHER marks
    coverageRows: [{ axis: "primary-sweep", scope: "worldwide", status: "confirmed-clean", reason: "full" }],
    registerFindingsText: "## Answers to your instructions\n- You asked us to check VOLTMAX ENERGYCORE → nothing found",
  });
  assert.equal(d.status, "open");
  assert.equal(d.ending, null);
});

test("the join never guesses: a too-short/generic mark token fails the distinctiveness floor and stays OPEN", () => {
  // "HYDRO"-shaped: a 5-char single token must not join anything, even when a finding carries it
  const doubts = mintCrossCheckDoubts("CROSS-CHECK REQUIRED: FIZZY line extension — could not verify", "common-law-findings.md");
  const [d] = stitchDoubts(doubts, { findings: { findings: [{ ordinal: 1, mark: "FIZZY", owner: { name: "X" }, disposition: "off-field" }], actions: [] } });
  assert.equal(d.status, "open", "a floor-failing token joins nothing — OPEN is the honest ending-less state");
});

// ── the deterministic extraction primitive ───────────────────────────────────────────────────────
test("capsCandidates extracts the caps-named mark and trims riding stopwords", () => {
  assert.deepEqual(capsCandidates("**[NEW] NutriVolt VOLTMAX ENERGYCORE (Electrolyte Sports Drink)**"), ["VOLTMAX ENERGYCORE"]);
  assert.deepEqual(capsCandidates("VOLTMAX ENERGYCORE US/Madrid designations"), ["VOLTMAX ENERGYCORE"]);
  assert.deepEqual(capsCandidates("no marks named here"), []);
  // T2c: a diacritic caps run extracts (fold-normalized) instead of shattering at the accented letter
  assert.deepEqual(capsCandidates("PAN MIĘSKO EU designations"), ["PAN MIESKO"]);
});

// ── T2c: the ONE join normalization (normalizeJoinText) ──────────────────────────────────────────
test("normalizeJoinText folds diacritics, splits camelCase/PascalCase, collapses punctuation, uppercases", () => {
  assert.equal(normalizeJoinText("IonLabs"), "ION LABS");
  assert.equal(normalizeJoinText("Pan Mięsko"), "PAN MIESKO");
  assert.equal(normalizeJoinText("volt-max.core  plus"), "VOLT MAX CORE PLUS");
  assert.equal(normalizeJoinText("**ION LABS**"), "ION LABS");
});

// ── T2c: case/format + diacritics widening of the deterministic join ─────────────────────────────
test("an 'IonLabs' doubt joins an 'ION LABS' finding — the camelCase seam is the same token stream", () => {
  const doubts = mintCrossCheckDoubts(
    "CROSS-CHECK REQUIRED: IonLabs marketplace listing — storefront hit could not be matched to a register record in this layer",
    "common-law-findings.md");
  const [d] = stitchDoubts(doubts, {
    findings: { findings: [{ ordinal: 2, mark: "ION LABS", owner: { name: "Ion Laboratories GmbH" }, disposition: "distinguished" }], actions: [] },
  });
  assert.equal(d.status, "checked-and-settled");
  assert.equal(d.ending.evidence.file, "findings.json");
  assert.ok(d.ending.evidence.quote.includes("finding #2"), "the ION LABS finding is the join target");
});

test("a 'Pan Miesko' doubt joins whichever side carries the diacritic — folding works in BOTH directions", () => {
  const FINDING_PLAIN = { ordinal: 3, mark: "Pan Miesko", owner: { name: "Wedlina Krakowska sp. z o.o." }, disposition: "off-field" };
  const FINDING_DIACRITIC = { ...FINDING_PLAIN, mark: "PAN MIĘSKO" };
  // doubt WITH the diacritic, finding WITHOUT
  const [withD] = stitchDoubts(
    mintCrossCheckDoubts("CROSS-CHECK REQUIRED: PAN MIĘSKO PL designations — deli-market listing could not be verified", "common-law-findings.md"),
    { findings: { findings: [FINDING_PLAIN], actions: [] } });
  assert.equal(withD.status, "checked-and-settled");
  assert.ok(withD.ending.evidence.quote.includes("finding #3"));
  // doubt WITHOUT the diacritic, finding WITH
  const [withoutD] = stitchDoubts(
    mintCrossCheckDoubts("CROSS-CHECK REQUIRED: Pan Miesko PL designations — deli-market listing could not be verified", "common-law-findings.md"),
    { findings: { findings: [FINDING_DIACRITIC], actions: [] } });
  assert.equal(withoutD.status, "checked-and-settled");
  assert.ok(withoutD.ending.evidence.quote.includes("finding #3"));
});

// ── T2c: the short-mark TWO-TOKEN path (the floor stays for bare tokens) ─────────────────────────
const ION_REGISTER_MD = [
  "# Register findings — Mark: ION",
  "",
  "## Risk-relevant marks",
  "Narrative about the searched field.",
  "",
  "## Adjacent-register notes",                       // NOT an answer/watchlist section — any-line surface
  "- ION (Blackstone Audio) — dormant 2017 CH registration, audiobook goods, watch-only",
  "- General remark about direct search coverage.",
].join("\n");

test("a short mark + owner token co-matching ONE line joins it — two independent weak signals, any register-findings line", () => {
  const doubts = mintCrossCheckDoubts(
    "CROSS-CHECK REQUIRED: ION audiobook edition by Blackstone — owner-site search could not confirm any live product",
    "common-law-findings.md");
  assert.deepEqual(doubts[0].subject.terms, [], "ION fails the floor — no bare join term is minted");
  const [d] = stitchDoubts(doubts, { registerFindingsText: ION_REGISTER_MD });
  assert.equal(d.status, "checked-and-settled");
  assert.equal(d.ending.evidence.file, "register-findings.md");
  assert.ok(d.ending.evidence.quote.includes("ION (Blackstone Audio)"), "the co-named line is the evidence");
});

test("the same short mark ALONE joins nothing — the distinctiveness floor stands for one weak signal", () => {
  const doubts = mintCrossCheckDoubts(
    "CROSS-CHECK REQUIRED: ION designations — register slice could not be verified in this layer",
    "common-law-findings.md");
  const [d] = stitchDoubts(doubts, { registerFindingsText: ION_REGISTER_MD });
  assert.equal(d.status, "open", "ION alone must NEVER join, even though a line carrying ION exists");
  assert.equal(d.ending, null);
});

test("a class number is a valid second signal: short mark + 'class N' co-matching a coverage row joins it", () => {
  const doubts = mintCrossCheckDoubts(
    "CROSS-CHECK REQUIRED: ION apparel line in class 25 — register slice not enumerated this run",
    "register-units/incumbent-class.md");
  const [d] = stitchDoubts(doubts, {
    coverageRows: [
      { axis: "incumbent-class", scope: "worldwide", status: "confirmed-clean", reason: "full" },
      { axis: "incumbent-class", scope: "ION exact, class 25", status: "confirmed-clean", reason: "exact slice enumerated to has_more:false" },
    ],
  });
  assert.equal(d.status, "checked-and-settled");
  assert.equal(d.ending.evidence.file, "register-coverage-ledger.json");
  assert.ok(d.ending.evidence.quote.includes("class 25"), "the class-co-named row is the one joined");
});

// ── T2c: the doubt-closure stage contract (parse + the anti-confabulation guard) ─────────────────
const RF_TEXT = [
  "# Register findings — Mark: VOLTMAX",
  "## Adjacent notes",
  "- MARLOVIA QUENCHROOT: no live EU record; the 2016 filing lapsed unrenewed",
].join("\n");

const openDoubtFixture = () => mintCrossCheckDoubts(
  "CROSS-CHECK REQUIRED: MARLOVIA QUENCHROOT EU designations — no EU register layer ran for this doubt's section",
  "common-law-findings.md").map((d) => ({ ...d }));

test("parseClosureLines: the two dictated shapes parse; a malformed line parses to NOTHING (absent ⇒ open)", () => {
  const out = parseClosureLines([
    'SETTLED doubt:crosscheck:common-law-findings.md:1: register-findings.md: "no live EU record; the 2016 filing lapsed unrenewed" — the register layer already answered it',
    "OPEN doubt:crosscheck:common-law-findings.md:2: no register layer ran for the EU this run, so no on-disk evidence exists",
    '- SETTLED doubt:x:3: findings.json: "quoted" — bulleted lines are tolerated like the cross-check dictation',
    "SETTLED doubt:x:4 register-findings.md no quote given — malformed (missing colons/quotes) must NOT parse",
    "Some narrative the model was told not to write.",
  ].join("\n"));
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((l) => l.verdict), ["SETTLED", "OPEN", "SETTLED"]);
  assert.equal(out[0].file, "register-findings.md");
  assert.equal(out[0].quote, "no live EU record; the 2016 filing lapsed unrenewed");
  assert.ok(out[0].reason.startsWith("the register layer"));
});

test("applyClosure settles ONLY on a verbatim quote (whitespace-normalized); the ending records the stage + evidence", () => {
  const [d] = openDoubtFixture();
  const lines = parseClosureLines(`SETTLED ${d.id}: register-findings.md: "no live EU record;  the 2016 filing lapsed unrenewed" — the register layer answered it`);
  const r = applyClosure([d], lines, { "register-findings.md": RF_TEXT });
  assert.equal(r.settledByStage, 1);
  assert.deepEqual(r.unverified, []);
  assert.equal(r.doubts[0].status, "checked-and-settled");
  assert.equal(r.doubts[0].ending.by, "doubt-closure-stage");
  assert.equal(r.doubts[0].ending.evidence.file, "register-findings.md");
  assert.ok(r.doubts[0].ending.reason.includes("register layer answered"));
});

test("applyClosure: a near-miss quote NEVER settles — the doubt stays open and is reported unverified (loud)", () => {
  const [d] = openDoubtFixture();
  const lines = parseClosureLines(`SETTLED ${d.id}: register-findings.md: "no live EU record; the 2016 filing was cancelled" — paraphrase, not a quote`);
  const r = applyClosure([d], lines, { "register-findings.md": RF_TEXT });
  assert.equal(r.settledByStage, 0);
  assert.equal(r.doubts[0].status, "open");
  assert.equal(r.doubts[0].ending, null);
  assert.deepEqual(r.unverified, [{ id: d.id, file: "register-findings.md", quote: "no live EU record; the 2016 filing was cancelled" }]);
});

// ── — A QUOTE FROM A JSON CITABLE ───────────────────────────────────────────────────────────
//
// Two of the three citable files are JSON (findings.json, register-coverage-ledger.json), and the
// comparison is against their RAW TEXT. A seat reporting the LOGICAL value it read, rather than the
// escaped bytes it saw, could not verify — the doubt shipped OPEN into `unverified`, and the symptom
// read as the model citing badly. The haystack here is the on-disk JSON rendering, byte for byte.
const FINDINGS_JSON = JSON.stringify({
  findings: [{
    mark: "VENTURI",
    net: 'The mark "VENTURI" is registered in CH and the 2019 filing stands unopposed',
  }],
}, null, 2);

test("#1050 applyClosure verifies a quote from a JSON citable in EITHER rendering — the logical value and the escaped bytes", () => {
  // premise, asserted rather than assumed: the file really does carry the backslashes on disk.
  assert.ok(FINDINGS_JSON.includes('\\"VENTURI\\"'), "premise: the JSON rendering escapes the inner quotes");

  // (a) the sentence a reader would call the quote — the shape that used to fail.
  const [d1] = openDoubtFixture();
  const logical = applyClosure([d1],
    parseClosureLines(`SETTLED ${d1.id}: findings.json: "The mark "VENTURI" is registered in CH" — findings answered it`),
    { "findings.json": FINDINGS_JSON });
  assert.equal(logical.settledByStage, 1, "the logical value settles the doubt");
  assert.deepEqual(logical.unverified, []);
  assert.equal(logical.doubts[0].ending.evidence.file, "findings.json");

  // (b) the escaped bytes the seat actually saw — still verifies, because the step applies to BOTH
  // sides. A one-sided unescape would pass (a) and is not what landed.
  const [d2] = openDoubtFixture();
  const escaped = applyClosure([d2],
    parseClosureLines(`SETTLED ${d2.id}: findings.json: "The mark \\"VENTURI\\" is registered in CH" — findings answered it`),
    { "findings.json": FINDINGS_JSON });
  assert.equal(escaped.settledByStage, 1, "the escaped rendering settles it too — the JSON-escaped form IS the verbatim the seat saw");
  assert.deepEqual(escaped.unverified, []);
});

test("#1050 the escape step widens NOTHING else — a paraphrase of a JSON value still ships OPEN", () => {
  const [d] = openDoubtFixture();
  const r = applyClosure([d],
    parseClosureLines(`SETTLED ${d.id}: findings.json: "The mark "VENTURI" was cancelled in CH" — paraphrase, not a quote`),
    { "findings.json": FINDINGS_JSON });
  assert.equal(r.settledByStage, 0, "the anti-confabulation guard is untouched by the escape step");
  assert.equal(r.doubts[0].status, "open");
  assert.equal(r.unverified.length, 1);
});

test("#1050 squash is the SAME predicate contract-audit already verifies evidence with — one question, one answer", async () => {
  // The ledgers held the narrower of two answers to one question ("does this quote appear verbatim in
  // that text"). They are bound here rather than merged, because the two call sites are scoped by
  // different contracts — but a divergence must be a red test, not a quietly-missed settlement.
  const { normalizeQuote } = await import("../contract-audit.mjs");
  const corpus = [
    'The mark \\"VENTURI\\" is registered in CH',
    'The mark "VENTURI" is registered in CH',
    "  ragged   whitespace\tand a\nnewline  ",
    'nested \\"quotes\\" and "plain" ones together',
    "", null, undefined,
  ];
  for (const s of corpus) assert.equal(squash(s), normalizeQuote(s), `the two normalizers disagree on: ${JSON.stringify(s)}`);
});

test("applyClosure: a citation of a file outside the allowed set never verifies; a settled doubt is never touched; no lines ⇒ pass-through", () => {
  const [d] = openDoubtFixture();
  // outside the citable set (fileTexts) ⇒ unverified, stays open
  const outside = applyClosure([d], parseClosureLines(`SETTLED ${d.id}: narrative.md: "no live EU record" — wrong surface`), { "register-findings.md": RF_TEXT });
  assert.equal(outside.doubts[0].status, "open");
  assert.equal(outside.unverified.length, 1);
  // an already-settled doubt is out of the stage's reach
  const settled = { ...d, status: "checked-and-settled", ending: { by: "code-stitch", evidence: { file: "findings.json", quote: "finding #1" } } };
  const untouched = applyClosure([settled], parseClosureLines(`SETTLED ${d.id}: register-findings.md: "no live EU record; the 2016 filing lapsed unrenewed" — already ended`), { "register-findings.md": RF_TEXT });
  assert.deepEqual(untouched.doubts[0].ending.by, "code-stitch");
  assert.equal(untouched.settledByStage, 0);
  // stage absent (no lines) ⇒ byte-identical doubt records
  const absent = applyClosure([d], [], { "register-findings.md": RF_TEXT });
  assert.deepEqual(absent.doubts, [d]);
  assert.equal(absent.settledByStage, 0);
  assert.deepEqual(absent.unverified, []);
});
