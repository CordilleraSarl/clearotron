// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — a factual assertion about a named party must resolve to a source the run holds, of a KIND
// that can support it.
//
// A delivered narrative described the client's own company with a named therapeutic pipeline and a
// named commercial agreement. The reviewer refused the report. Three elements failed three different
// ways, and the third is what decides the design:
//
//   invented      occurs in no run artifact at all
//   contradicted  the party's own description was present and said something materially different
//   category      REAL, and present in the run — in a registration's goods wording, which says what a
//                 mark is registered FOR. Rendered as what the company's pipeline IS.
//
// THE FIXTURE IS SYNTHETIC AND STAYS THAT WAY. The specimen run's artifacts are a client matter, and a
// fixture captured from one is exactly what no-client-identifiers check 3 refuses — inside a
// matter-scoped artifact every proprietor is that matter's evidence however public the name is. So the
// three shapes are REPRODUCED here rather than copied, and criterion 5's "reds on that run's own
// narrative" half is discharged by evidence on the issue, not by anything committed to this repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { partyFactSources, partyFactViolations, partyFactMessage, canJudgePartyFacts } from "../party-facts.mjs";
import { STAGES } from "../stages.mjs";
import { partyFactChecks, runLint } from "../predelivery-lint.mjs";

const PARTY = "Aurora Therapeutics SA";

/** A grid holding the party's OWN description — the corpus a party fact may rest on. */
const GRID = { cells: [
  { term: "aurora therapeutics", platform: "web", status: "searched", candidates: [
    { title: "Aurora Therapeutics SA — EPFL spin-off, Lausanne", url: "https://example.test/a" },
    { title: "Aurora Therapeutics develops protease inhibitors for autoimmune and bone disease", url: "https://example.test/b" },
    { title: "Has strategic investments — Aurora Therapeutics", url: "https://example.test/c" },
  ] },
], extras: [], gaps: [] };

const GOODS = "Pharmaceutical preparations, namely antibody-peptide inhibitor conjugates intended for use "
  + "in oncology as well as for the treatment of osteoporosis and autoimmune diseases; Dietary supplements.";

/**
 * A fetched record in the shape the RUNS ACTUALLY HOLD. `osteoporosis` lives only here — the category
 * specimen.
 *
 * THE FIRST VERSION OF THIS FIXTURE PUT THE GOODS IN A PLAIN STRING, and no record anywhere carries that
 * shape. Across 52,855 record artifacts on this box, zero have `goodsAndServices` as a string: assembled
 * Clarivate records use `goodsServices`, a list with the text at `[].description`. So the category shape
 * could not fire on any real run, every goods-supported fact was reported INVENTED, and sixteen green
 * arms said nothing about it — a fixture that invents its own input cannot see a broken reader.
 */
const RECORDS = new Map([["/mark/us/1", {
  _uri: "/mark/us/1", markText: "AURORA", owner: "Aurora Therapeutics SA", niceClasses: ["5"],
  goodsServices: [{ classNumber: "5", description: GOODS }],
}]]);

/** The SAME goods, in the repo's own EUIPO sample shape — a different provider, a different nesting. */
const RECORDS_EUIPO = new Map([["/mark/eu/1", {
  _uri: "/mark/eu/1", markText: "AURORA",
  goodsAndServices: [{ classNumber: 5, description: [{ language: "en", terms: [GOODS] }] }],
}]]);

const sources = () => partyFactSources({ grid: GRID, records: RECORDS });
const para = (text, heading = "Finding 1") => [{ heading, text }];
const flag = (text) => partyFactViolations({ paragraphs: para(text), partyNames: [PARTY], sources: sources() });

test("#1564 the fixture is real — the two corpora are populated and DISJOINT where it matters", () => {
  // Without this every arm below could pass over empty sets, which is the vacuous shape these checks
  // exist to catch elsewhere.
  const s = sources();
  assert.ok(canJudgePartyFacts(s));
  assert.ok(s.descriptive.has("autoimmune"), "the descriptive corpus did not pick up the grid's own titles");
  assert.ok(s.registrationScope.has("osteoporosis"), "the goods wording did not reach the scope corpus");
  assert.equal(s.descriptive.has("osteoporosis"), false,
    "osteoporosis is in BOTH corpora — the category arm below would then prove nothing");
  assert.equal(s.registrationScope.has("epfl"), false, "a non-goods record field leaked into the scope corpus");
});

test("#1564 SHAPE 1 — an assertion that resolves to no source at all is flagged as invented", () => {
  const v = flag(`${PARTY} has a preclinical pipeline in lung adenocarcinoma.`);
  const inv = v.find((x) => x.shape === "invented");
  assert.ok(inv, `nothing was flagged as invented (got ${JSON.stringify(v)})`);
  assert.ok(inv.terms.includes("adenocarcinoma"), `the domain term was not among them (got ${inv.terms})`);
  // ONE row for the clause, not one per token — the repair rewrites the sentence once.
  assert.equal(v.filter((x) => x.shape === "invented").length, 1);
  assert.match(partyFactMessage(inv), /resolves to no source this run holds/);
  assert.match(partyFactMessage(inv), /"adenocarcinoma"/, "the message must name the term that failed");
});

test("#1564 SHAPE 3 — a term the run holds ONLY in goods wording is a CATEGORY error, not a sourcing one", () => {
  // The sharpest of the three, and the reason this module partitions before it tests.
  const v = flag(`${PARTY} has a preclinical pipeline in osteoporosis.`);
  const cat = v.find((x) => x.term === "osteoporosis");
  assert.ok(cat, `osteoporosis was not flagged (got ${JSON.stringify(v)})`);
  assert.equal(cat.shape, "category", "flagged, but as the wrong shape — the repair differs");
  assert.match(partyFactMessage(cat), /what a mark is registered FOR/);
});

test("#1564 A TOKEN-PRESENCE RULE PASSES THE CATEGORY CASE — this is why presence is not the rule", () => {
  // THE DISCRIMINATING ARM FOR THE WHOLE ISSUE. Build the naive check the obvious way — does the term
  // appear in any source the run holds — and watch it wave osteoporosis through. If this arm ever fails,
  // the fixture has stopped separating the two corpora and the category arm above is measuring nothing.
  const s = sources();
  const naivePresence = (term) => s.descriptive.has(term) || s.registrationScope.has(term);

  assert.equal(naivePresence("osteoporosis"), true,
    "the naive rule already rejects osteoporosis, so it is not the weaker rule this issue says it is");
  assert.equal(flag(`${PARTY} has a preclinical pipeline in osteoporosis.`).some((x) => x.term === "osteoporosis"), true,
    "the kind-aware rule agrees with the naive one — the category shape is not being caught");

  // And the two rules AGREE on the invented shape, which is what makes the disagreement above specific
  // rather than a check that simply flags more.
  assert.equal(naivePresence("adenocarcinoma"), false);
});

test("#1564 SHAPE 2 — a relationship kind the source contradicts is flagged as contradicted, not invented", () => {
  const v = flag(`${PARTY} announced a strategic manufacturing agreement in 2026.`);
  const c = v.find((x) => x.shape === "contradicted");
  assert.ok(c, `no contradiction flagged (got ${JSON.stringify(v)})`);
  assert.match(partyFactMessage(c), /describes a different one/);
  assert.match(partyFactMessage(c), /investment/, "the message must name what the source actually says");
});

test("#1564 a SOURCED assertion is not flagged — the check can pass, or it proves nothing", () => {
  // The expensive direction to be wrong in: a rule that flagged every party fact would be switched off
  // in a week, and the seat would be back to writing whatever it liked.
  assert.deepEqual(flag(`${PARTY} develops protease inhibitors for autoimmune and bone disease.`), []);
  assert.deepEqual(flag(`${PARTY} is an EPFL spin-off developing protease inhibitors.`), []);
});

test("#1564 a paragraph naming NO party is not examined", () => {
  assert.deepEqual(partyFactViolations({ paragraphs: para("The mark has a pipeline in lung adenocarcinoma."),
    partyNames: [PARTY], sources: sources() }), []);
});

test("#1564 a run with NO descriptive corpus never claims invention — absence is not a negative", () => {
  // With no grid and no matter context there is nothing to be absent FROM. Reading that as "invented"
  // would put a fabrication accusation on every party fact in every run missing one artifact.
  const s = partyFactSources({ grid: null, records: RECORDS });
  const v = partyFactViolations({ paragraphs: para(`${PARTY} has a pipeline in lung adenocarcinoma.`),
    partyNames: [PARTY], sources: s });
  assert.equal(v.some((x) => x.shape === "invented"), false, "invention was claimed with no corpus to check against");
  // The CATEGORY judgment still stands, because it rests on presence in goods wording rather than absence.
  assert.equal(partyFactViolations({ paragraphs: para(`${PARTY} has a pipeline in osteoporosis.`),
    partyNames: [PARTY], sources: s }).some((x) => x.shape === "category"), true);
});

test("#1564 a run holding NEITHER corpus returns no verdict at all, rather than a clean one", () => {
  const s = partyFactSources({});
  assert.equal(canJudgePartyFacts(s), false);
  assert.deepEqual(partyFactViolations({ paragraphs: para(`${PARTY} has a pipeline in lung adenocarcinoma.`),
    partyNames: [PARTY], sources: s }), [],
    "a run with no corpora must not produce findings — but the CALLER must not read this as a pass");
});

// ── CRITERION 1: THE SEAT CARRIES THE RULE ───────────────────────────────────────────────────────────

/** The synthesis seat's real dispatch, built the way the driver builds it. */
function synthesisPrompt() {
  const def = STAGES.synthesis;
  assert.ok(def && typeof def.message === "function", "the synthesis seat has no message builder — the arms "
    + "below assert over what this builds, so a seat this fixture cannot construct is a silent pass");
  const P = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `/tmp/1564-run/${k}` : undefined) });
  return String(def.message({
    paths: P, job: { markName: "AURORA", classes: [5] }, customerUnknown: false,
    profile: { key: "demo" }, intakeAsks: [], enforcerSignals: [],
    framework: { title: "House default", framework_key: "house-default", entity_label: "the applicant",
      bands: [{ label: "High" }, { label: "Manageable" }] },
    jxAim: null, registerOnly: false, crowdContext: null, dispatchBlocks: [], findingsSurface: [],
    depth: { narrativeProse: "every-finding" },
  }) ?? "");
}

test("#1564 the synthesis seat is told a party fact must resolve to a source the run holds", () => {
  const prompt = synthesisPrompt();
  assert.ok(prompt.length > 2000, `the dispatch built to ${prompt.length} chars — a fixture that stopped `
    + "building a real prompt would pass every arm here by having nothing to search");
  assert.match(prompt, /EVERY FACTUAL ASSERTION ABOUT A NAMED PARTY MUST RESOLVE TO A SOURCE THIS RUN HOLDS/);
  assert.match(prompt, /client's own company/i,
    "the rule must name the CLIENT's own company — that is the party the shipped defect described");
});

test("#1564 the seat is told goods wording is not evidence about a party, which is the category rule", () => {
  // 's prohibition and a generic "source your claims" line both leave this open: the seat WILL
  // source a class-5 indication, correctly, to a document it really read, and still be wrong.
  const prompt = synthesisPrompt();
  assert.match(prompt, /GOODS AND SERVICES WORDING IS NEVER EVIDENCE ABOUT A PARTY'S ACTIVITIES/);
  const i = prompt.search(/GOODS AND SERVICES WORDING IS NEVER EVIDENCE/);
  const block = prompt.slice(i, i + 900);
  assert.match(block, /REGISTERED FOR/, "the rule must say what a specification IS, or it reads as arbitrary");
  assert.match(block, /passes any check that asks whether the words appear/i,
    "and it must say WHY a sourcing instruction does not cover it, or the next hand narrows it back");
});

test("#1564 #1556's fetch-lane prohibition is still there — this is an addition, not a replacement", () => {
  // Same seat, two rules, non-overlapping. A seat told to say nothing about document coverage will
  // still write an invented pipeline; a seat told to source its party facts will still describe a lane
  // it cannot see. Losing either to an edit of the other is the failure this arm exists to catch.
  assert.match(synthesisPrompt(), /SAY NOTHING ABOUT WHETHER REGISTRY DOCUMENTS WERE OBTAINED/);
});

// ── THE DELIVERY SEAM: A RULE THAT DOES NOT REACH THE SURFACE IS AN INSTRUCTION, NOT A CHECK ─────────
//
// This family's three previous cures were all prose. part 2 and shipped seat wording alone;
// shipped wording plus a renderer. None of them could fail. Criterion 2 asks that these
// assertions "not reach client prose", so the rule has to be somewhere the delivery path reads.

const NARRATIVE = `## Finding 1\n\n${PARTY} has a preclinical pipeline in lung adenocarcinoma and osteoporosis.\n`;

test("#1564 the check runs at the lint seam and names both shapes it found", () => {
  const out = partyFactChecks({ text: NARRATIVE, clientPartyName: PARTY, grid: GRID, records: RECORDS });
  const failed = out.filter((c) => !c.pass);
  assert.equal(failed.length, 2, `expected the invented and category shapes (got ${JSON.stringify(out)})`);
  assert.ok(failed.some((c) => c.id.includes("invented") && c.id.includes("adenocarcinoma")));
  assert.ok(failed.some((c) => c.id.includes("category") && c.id.includes("osteoporosis")));
  for (const c of failed) assert.equal(c.surface, "report", "a failure off the report surface never reaches the redo");
});

test("#1564 runLint carries it, so the failure rides the delivery surface a human reads", () => {
  const lint = runLint({ reportMd: NARRATIVE, clientPartyName: PARTY, commonLawGrid: GRID, recordsByUri: RECORDS,
    searchedNames: ["AURORA"], headerName: "AURORA", ratedNames: ["AURORA"] });
  const ids = lint.failures.map((f) => f.id);
  assert.ok(ids.some((i) => i.startsWith("party-fact-sourcing:")),
    `runLint dropped the party-fact checks — ids were ${JSON.stringify(ids)}`);
  assert.ok(lint.failures.some((f) => f.family === "party-fact"),
    "the failure has no family of its own, so the client gate cannot name it");
});

test("#1564 a run with no corpora emits NO row — silence, never a passing one", () => {
  // A passing check here would record a verdict nobody measured, and every archived run would read as
  // party-fact-clean. Emptiness is the honest answer; the caller must not read it as coverage.
  assert.deepEqual(partyFactChecks({ text: NARRATIVE, clientPartyName: PARTY }), []);
  assert.deepEqual(partyFactChecks({ text: "", clientPartyName: PARTY, grid: GRID, records: RECORDS }), []);
});

test("#1564 a clean narrative emits a PASSING row — the check must be able to pass", () => {
  const out = partyFactChecks({ text: `## Finding 1\n\n${PARTY} develops protease inhibitors for autoimmune disease.\n`,
    clientPartyName: PARTY, grid: GRID, records: RECORDS });
  assert.equal(out.length, 1);
  assert.equal(out[0].pass, true);
});

// ── THE READER: A PATH INTO A DOCUMENT IS AN INSTRUMENT, AND THIS ONE WAS WRONG EVERYWHERE ───────────

test("#1564 the goods corpus is extracted from EVERY provider shape this box holds", () => {
  // Three shapes, three providers, no normalisation at assembly. A reader keyed to one path reports the
  // other two as "this run has no goods", which is indistinguishable from a run that really has none.
  for (const [label, recs] of [["assembled Clarivate", RECORDS], ["EUIPO sample", RECORDS_EUIPO]]) {
    const s = partyFactSources({ grid: GRID, records: recs });
    assert.ok(s.registrationScope.has("osteoporosis"), `${label}: the goods text was not extracted at all`);
    assert.equal(s.haveScope, true, `${label}: scope reads as unjudgeable`);
    assert.equal(s.scopeEmpty, false, `${label}: a populated record set reported an empty corpus`);
  }
});

test("#1564 THE POSITIVE CONTROL — a non-empty record set that yields NO goods text says so", () => {
  // The arm that would have caught the original defect on day one. `haveScope` used to be
  // `bodies.length > 0`, so a corpus that extracted nothing still reported itself judgeable and every
  // goods-supported fact came out as INVENTED — the opposite of what the category shape exists to say,
  // stated confidently, with nothing anywhere announcing an empty corpus.
  const s = partyFactSources({ grid: GRID, records: new Map([["/mark/x/1", { _uri: "/mark/x/1", markText: "AURORA" }]]) });
  assert.equal(s.recordsHeld, 1);
  assert.equal(s.registrationScope.size, 0);
  assert.equal(s.scopeEmpty, true, "records were held, no goods text came out, and nothing said so");
  assert.equal(s.haveScope, false, "an empty corpus reported itself judgeable");
});

test("#1564 a goods term is CATEGORY, not invented, on a real record shape", () => {
  // The whole point, on the shape runs actually hold. Before this it was reported `invented` — a
  // fabrication accusation against a term the run had read out of a registration.
  const v = partyFactViolations({ paragraphs: para(`${PARTY} has a preclinical pipeline in osteoporosis.`),
    partyNames: [PARTY], sources: partyFactSources({ grid: GRID, records: RECORDS }) });
  const hit = v.find((x) => x.terms.includes("osteoporosis"));
  assert.ok(hit, `osteoporosis was not flagged at all (got ${JSON.stringify(v)})`);
  assert.equal(hit.shape, "category", "flagged as the wrong shape — the repair and the accusation differ");
});

test("#1564 A HYPHENATED COMPOUND resolves to its parts — a CLEAN report must not route itself to a redo", () => {
  // The second real-artifact defect. The grid says "protease inhibitors"; a corrected narrative wrote
  // "protease-inhibitor", and keeping the hyphen inside the token made the compound resolve to nothing.
  // Any clean report hyphenating a compound tripped this, and a lint failure routes the surface to the
  // warm named-correction redo — so the cure was re-writing correct reports.
  const s = partyFactSources({ grid: GRID, records: RECORDS });
  const flagged = partyFactViolations({
    paragraphs: para(`${PARTY} develops protease-inhibitor conjugates for autoimmune disease.`),
    partyNames: [PARTY], sources: s }).flatMap((v) => v.terms);
  // The grid says "protease inhibitorS". Both halves of the compound must resolve — the hyphen must not
  // hide them, and the plural must not either.
  assert.ok(!flagged.includes("protease"), `"protease" was flagged, and the grid carries it (${flagged})`);
  assert.ok(!flagged.includes("inhibitor"), `"inhibitor" was flagged against a source saying "inhibitors" (${flagged})`);
  // `conjugates` IS only in the goods wording, so flagging it as a category error is correct and stays.
  assert.ok(flagged.includes("conjugates"), "the genuine category term stopped being caught");
  // And the guard still bites: an unsourced compound is still caught, so this is not a hole.
  assert.ok(partyFactViolations({
    paragraphs: para(`${PARTY} develops kinase-inhibitor conjugates.`),
    partyNames: [PARTY], sources: s }).length > 0, "splitting hyphens silenced an unsourced compound");
});

// ── COVERAGE: AN EMPTINESS GUARD NEVER FIRES ON A HALF-FILLED TABLE ──────────────────────────────────

test("#1564 EVERY record is read, not the first seven — the arity trap, and why the fixture hid it", () => {
  // `goodsTextOf` took `(body, depth = 0)` and was called as `bodies.flatMap(goodsTextOf)`. flatMap
  // passes (element, INDEX, array), so the array index arrived as the recursion depth: every record past
  // the seventh returned [] at once, and the first six were walked from the wrong starting depth.
  //
  // THE SINGLE-RECORD FIXTURE IS THE ONE ARRANGEMENT WHERE THIS CANNOT BE SEEN, which is why twenty
  // green arms said nothing. This one puts the goods on the LAST of twelve.
  const filler = Array.from({ length: 11 }, (_, i) => [`/mark/f/${i}`, {
    _uri: `/mark/f/${i}`, markText: "FILLER", goodsServices: [{ classNumber: "9", description: "Filler apparatus." }] }]);
  const records = new Map([...filler, ["/mark/us/1", {
    _uri: "/mark/us/1", markText: "AURORA", goodsServices: [{ classNumber: "5", description: GOODS }] }]]);

  const s = partyFactSources({ grid: GRID, records });
  assert.equal(s.recordsHeld, 12);
  assert.equal(s.recordsRead, 12,
    `only ${s.recordsRead} of ${s.recordsHeld} records yielded goods text — the reader is truncating`);
  assert.ok(s.registrationScope.has("osteoporosis"),
    "the goods on the TWELFTH record were not read. Every earlier arm put them on the first, which is the "
    + "one position where a per-record truncation is invisible.");
});

test("#1564 NEITHER emptiness guard can see a PARTIAL corpus — that is why coverage is reported", () => {
  // The guards added with the first fix were `haveScope` (size > 0) and `scopeEmpty` (held but nothing
  // extracted). On the truncating reader both were quiet and correct: the corpus was not empty, it was
  // half-filled. Recorded as an arm because "we added a guard" is exactly what made this feel covered.
  const records = new Map(Array.from({ length: 12 }, (_, i) => [`/mark/f/${i}`, {
    _uri: `/mark/f/${i}`, goodsServices: [{ classNumber: "9", description: `Apparatus number ${i}.` }] }]));
  const s = partyFactSources({ grid: GRID, records });
  assert.equal(s.haveScope, true, "the fixture must be non-empty, or this arm restates the emptiness case");
  assert.equal(s.scopeEmpty, false);
  // The comparison that DOES see it, and the reason `recordsRead` exists at all.
  assert.equal(s.recordsRead, s.recordsHeld,
    "records were held that produced no goods text — either the reader stopped early or those records "
    + "genuinely carry none, and the caller is entitled to tell the difference");
});

test("#1598 a `description` OUTSIDE the goods subtree contributes nothing — the laundering half", () => {
  // The trap's second effect, and the one that made the broken corpus look healthy. Entering at depth >= 1
  // skipped the `depth === 0` goods-subtree gate, so six of the seven records that were read at all pulled
  // `description`/`terms`/`text` from ANYWHERE in the body — an owner's address, a status note, a
  // representative's name. The corpus was 99% empty AND polluted, and the pollution is why `haveScope`
  // read true: 1,362 terms of the wrong words.
  //
  // A term that reaches the scope corpus from a non-goods field is worse than a missing one. It makes the
  // check say CATEGORY — "this run holds that word only in a registration's goods wording" — about a word
  // that appeared in the proprietor's mailing address.
  // NOT AT INDEX 0, and that is the whole arrangement. Under the trap the index WAS the depth, so the
  // first record still got the gate and only its successors laundered — a one-record fixture is once
  // again the single position where the defect is invisible. This one sits fourth.
  const filler = Array.from({ length: 3 }, (_, i) => [`/mark/f/${i}`, {
    _uri: `/mark/f/${i}`, goodsServices: [{ classNumber: "9", description: "Filler apparatus." }] }]);
  const records = new Map([...filler, ["/mark/us/9", {
    _uri: "/mark/us/9", markText: "AURORA",
    owner: { name: "Aurora Therapeutics SA", description: "quantumly zeppelinesque premises" },
    representative: { terms: ["borogoves"] },
    statusText: { text: "slithy" },
    goodsServices: [{ classNumber: "5", description: GOODS }],
  }]]);
  const s = partyFactSources({ grid: GRID, records });
  assert.ok(s.registrationScope.has("osteoporosis"), "the fixture's real goods were not read at all");
  for (const laundered of ["zeppelinesque", "borogoves", "slithy", "premises"])
    assert.equal(s.registrationScope.has(laundered), false,
      `"${laundered}" reached the registration-scope corpus from outside the goods subtree — the check `
      + "would then call it a category error, meaning 'this run holds it only in goods wording'");
});

// ── · THE TWO THINGS A COVERAGE COUNT CANNOT SAY ───────────────────────────────────────────────
//
// `recordsRead === recordsHeld` is the right signal and it is not the whole guard, for two reasons the
// arms below cover.
//
// It is only an equality on a fixture where EVERY record carries goods text. On a real run some records
// legitimately carry none, so the honest production signal is the pair rather than the equality — and a
// pair nobody compares is not an assertion. What holds on any honest data, and reds on a per-record
// truncation whatever shape it takes, is that the corpus is a function of the SET of records and never
// of their ORDER.
//
// And a corpus arm says nothing about the VERDICT. The defect's cost was not a smaller corpus; it was
// `osteoporosis` — goods wording, present in the run — reported as INVENTED, which is a fabrication
// accusation against a term the run had read out of a registration, and the repair it sends the seat is
// for a defect the seat does not have.

const LATE_GOODS = new Map([
  ...Array.from({ length: 11 }, (_, i) => [`/mark/pad/${i}`, {
    _uri: `/mark/pad/${i}`, markText: `PADDING${i}`, owner: "Someone Else SA",
    goodsServices: [{ classNumber: "9", description: `Padding apparatus, variety ${i}.` }] }]),
  ["/mark/us/late", { _uri: "/mark/us/late", markText: "AURORA", owner: PARTY,
    goodsServices: [{ classNumber: "5", description: GOODS }] }],
]);

test("#1598 THE FIXTURE CONTROL — the specimen term is carried by ONE record, and it is the last", () => {
  // Both arms below rest on this. Move the specimen forward, or let a second record carry the term, and
  // they stop proving that the last record was read at all.
  const bodies = [...LATE_GOODS.values()];
  const carriers = bodies.map((b, i) => [i, JSON.stringify(b).includes("osteoporosis")]).filter(([, hit]) => hit);
  assert.deepEqual(carriers.map(([i]) => i), [bodies.length - 1],
    `the specimen term is carried by records at ${carriers.map(([i]) => i).join(", ")} of ${bodies.length}`);
  assert.ok(bodies.length >= 8, `n = ${bodies.length}; a truncation past index 6 needs at least 8 records to show`);
});

test("#1598 the corpus is a function of the SET of records, never of their ORDER", () => {
  // The invariant that survives any implementation of the walk. It needs no model of which records ought
  // to carry goods, so it cannot false-trip on an honest run, and a per-record truncation reds it because
  // WHICH records get read is then decided by position.
  const forward = partyFactSources({ grid: GRID, records: LATE_GOODS });
  const reversed = partyFactSources({ grid: GRID, records: new Map([...LATE_GOODS].reverse()) });
  assert.equal(reversed.registrationScope.size, forward.registrationScope.size,
    `reordering the same records moved the corpus from ${forward.registrationScope.size} terms to `
    + `${reversed.registrationScope.size} — the reader depends on position, so what the run HOLDS and `
    + "what it READS are two different things");
  assert.equal(reversed.recordsRead, forward.recordsRead);
  assert.ok(reversed.registrationScope.has("osteoporosis"));
});

test("#1598 AT THE CALL SITE — a goods term from the last record is CATEGORY, not invented", () => {
  // Criterion 4 at the delivery seam. The corpus arms above prove what was read; this proves the verdict
  // a run actually emits, which is where the cost was.
  const out = partyFactChecks({ text: `## Finding 1\n\n${PARTY} has a preclinical pipeline in osteoporosis.\n`,
    clientPartyName: PARTY, grid: GRID, records: LATE_GOODS });
  const failed = out.filter((c) => c.pass === false);
  assert.equal(failed.length, 1, `expected one failing check, got ${JSON.stringify(out)}`);
  assert.match(failed[0].id, /party-fact-sourcing:category:/,
    `the delivery seam filed it as ${failed[0].id}. A term the run holds in a registration's goods wording `
    + "is a category error; calling it invented accuses the seat of fabricating a word it read.");
});

// ── CRITERION 3: THE CONTRADICTION TEST IS ABOUT *THIS PARTY* ──────────────────────────────────

test("#1564 an unrelated mention of the same word does NOT silence a contradiction", () => {
  // MEASURED ON THE REAL GRID BEFORE THIS FIX: the shape existed and never fired. `descriptive` pools
  // every candidate title in the run, so on a 245-cell grid every relationship word appears somewhere
  // about somebody — and the check read that as "this relationship is sourced". One candidate titled
  // "Contract manufacturing services — <unrelated company>" was enough.
  //
  // The pooled corpus is the right question for an INVENTED claim ("does this run hold the word at
  // all") and the wrong one here, where both sides are about what the run says CONCERNING this party.
  const withNoise = { cells: [{ term: "aurora", platform: "web", status: "searched", candidates: [
    ...GRID.cells[0].candidates,
    { title: "Contract manufacturing services — Unrelated Pharma GmbH", url: "https://example.test/z" },
  ] }], extras: [], gaps: [] };
  const v = partyFactViolations({
    paragraphs: para(`${PARTY} announced a strategic manufacturing agreement in 2026.`),
    partyNames: [PARTY], sources: partyFactSources({ grid: withNoise, records: RECORDS }) });
  const c = v.find((x) => x.shape === "contradicted");
  assert.ok(c, `the contradiction was silenced by a mention about a different company (got ${JSON.stringify(v)})`);
  assert.match(partyFactMessage(c), /investment/, "and the message must still name what the source says");
});

test("#1564 a mention ABOUT THE PARTY is a source, and correctly stops the flag", () => {
  // The other direction, and the arm that keeps the fix from being 'flag everything'. If the run's own
  // material says this party HAS a manufacturing agreement, saying so is sourced, not contradicted.
  const supported = { cells: [{ term: "aurora", platform: "web", status: "searched", candidates: [
    ...GRID.cells[0].candidates,
    { title: `${PARTY} signs manufacturing agreement with a contract partner`, url: "https://example.test/y" },
  ] }], extras: [], gaps: [] };
  assert.equal(partyFactViolations({
    paragraphs: para(`${PARTY} announced a strategic manufacturing agreement in 2026.`),
    partyNames: [PARTY], sources: partyFactSources({ grid: supported, records: RECORDS }) })
    .some((x) => x.shape === "contradicted"), false,
    "a relationship the run's own material attributes to this party was reported as a contradiction");
});

test("#1564 an entry under a SHORTER name form is still about this party", () => {
  // THE FIRST CUT OF THE SCOPING FAILED THIS, and it is the direction that costs a client. Parties reach
  // this check from the register, carrying legal forms ("Aurora Therapeutics SA"); grid candidates are web
  // titles carrying whatever the web uses ("Aurora Therapeutics"). Matching on the full string admitted the
  // spin-off candidate and excluded the investment one — a HALF-scoped corpus, which still has a sourced
  // kind to compare against and so still fires. The run plainly holds this relationship; flagging it is a
  // fabrication accusation against the run's own material.
  assert.equal(flag(`${PARTY} announced strategic investments in 2026.`)
    .some((x) => x.shape === "contradicted"), false,
    "a relationship the run sources under a shorter form of the party's name was called a contradiction");

  // The half-scoping is invisible from the flag alone — it reports the same shape either way. What names
  // it is WHICH sources the message cites, so the contradiction arm asserts both kinds, not just one.
  const c = flag(`${PARTY} announced a strategic manufacturing agreement in 2026.`).find((x) => x.shape === "contradicted");
  assert.match(partyFactMessage(c), /investment\/spin-off/,
    "the message cites one sourced kind, so entries about this party are being admitted by name form");
});

test("#1564 the INVENTED test stays pooled — 'does this run hold it at all' is a different question", () => {
  // The scoping applies to contradiction only. A term absent from the whole run is invented whoever it
  // was written about, and scoping that test to the party would call every unmentioned party's facts
  // invented — which is most of them.
  const s = partyFactSources({ grid: GRID, records: RECORDS });
  assert.ok(s.descriptive.has("autoimmune"), "the pooled corpus stopped being built");
  assert.ok(Array.isArray(s.descriptiveEntries) && s.descriptiveEntries.length > 1,
    "the unpooled entries are absent, so the contradiction test has nothing to scope with");
  const v = partyFactViolations({ paragraphs: para(`${PARTY} has a preclinical pipeline in lung adenocarcinoma.`),
    partyNames: [PARTY], sources: s });
  assert.ok(v.some((x) => x.shape === "invented" && x.terms.includes("adenocarcinoma")));
});
