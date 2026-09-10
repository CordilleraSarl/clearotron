// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Plain language on the knockout's default-visible lines (the knockout half).
//
// The report goes to a lawyer who layers advice on top, and that lawyer's client reads the same page.
// The band, the summary, the basis line and the one-liners are the whole product for the second reader,
// and on the delivered run they were its hardest lines: a 74-word basis sentence ending "likely to
// prevail on the marks-and-goods comparison", and a summary opening "This chunk covers a single mark".
//
// THE PARTITION IS WHAT THIS FILE IS ABOUT. The rule is not "no legal words on the report" — it is "no
// legal words where the reader has not chosen to go deeper". Since the page folds each card's argument
// Behind a fold, the same word is a defect in a finding's `net` and correct in its `basis`.
// Half the arms below exist to hold that line, because a check that flagged both would push the writer
// toward vaguer reasoning in the one place precision is wanted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { plainLanguageChecks, runKnockoutLint, NEVER_PROJECTED, INTERNAL_SURFACE } from "../predelivery-lint.mjs";

const SKILL = new URL("../skills/knockout-assess/SKILL.md", import.meta.url);

const flagged = (findings, id) => {
  const c = plainLanguageChecks({ findings }).find((x) => x.id === id);
  assert.ok(c, `no check with id ${id}`);
  return c;
};
const VOCAB = "plain-language-vocabulary";
const LENGTH = "plain-language-sentence-length";

const MARK = (over = {}) => ({
  name: "IRONWHISK", rating: "Medium",
  basis: "The name is used by several small sellers in the same goods.",
  factors: ["Two storefronts trade under it."], counterFactors: ["No registered right was found."],
  mitigation: "Narrowing the goods would help.", purpleNotes: [], registerReads: [],
  findings: [], ...over,
});
const FINDINGS = (over = {}) => ({ batch: { executiveSummary: "One name screened.", standardCaveats: [] }, marks: [MARK(over)] });

// ── the flag ─────────────────────────────────────────────────────────────────────────────────────────

test("333: a lawyer's word in a finding's ONE sentence is flagged, and the field is named", () => {
  const c = flagged(FINDINGS({
    findings: [{ ordinal: 1, net: "The proprietor holds a subsisting right and would prevail." }],
  }), VOCAB);
  assert.equal(c.pass, false);
  assert.match(c.detail, /proprietor/);
  assert.match(c.detail, /subsisting/);
  assert.match(c.detail, /conflict 1/, "the flag names the line to rewrite, not a score");
});

test("333: the same word inside a FOLD is not flagged — that is rule 2, not an oversight", () => {
  // A finding's `basis` is behind "Why this band" and the long `assessment` is behind its own fold.
  // Precision is wanted there; a check that flagged it would trade precision for vagueness.
  const c = flagged(FINDINGS({
    findings: [{ ordinal: 1, net: "Same name, same goods, and they were first.",
      basis: "The proprietor holds a subsisting registration and would prevail on every limb." }],
    assessment: "The proprietor's specification is broad and its senior right is citable.",
  }), VOCAB);
  assert.equal(c.pass, true, "folded reasoning keeps the lawyer's vocabulary");
});

test("333: 'chunk' is an engine word and is caught wherever a reader meets it", () => {
  const f = FINDINGS();
  f.batch.executiveSummary = "This chunk covers a single mark.";
  assert.match(flagged(f, VOCAB).detail, /chunk/);
});

test("333: the summary the owner asked for passes the same check", () => {
  const f = FINDINGS();
  f.batch.executiveSummary = "One name screened: IRONWHISK, rated Medium.";
  assert.equal(flagged(f, VOCAB).pass, true);
  assert.equal(flagged(f, LENGTH).pass, true);
});

test("333: a default-visible sentence over 25 words is flagged with its length", () => {
  const long = "IRONWHISK is a suggestive and already widely adopted term in the kitchen tools field, and "
    + "identically named cookware sits in the client's own retail channel alongside an established "
    + "business of the same name, so a prior owner is likely to win.";
  const c = flagged(FINDINGS({ basis: long }), LENGTH);
  assert.equal(c.pass, false);
  assert.match(c.detail, /basis line: \d+ words/, "the flag says which line and how long it ran");
  // And the rewrite the issue gives as the standard passes.
  const plain = "IRONWHISK is already the name of two cookware sellers on the same shelves. Either would "
    + "likely win a dispute over this name for these goods.";
  assert.equal(flagged(FINDINGS({ basis: plain }), LENGTH).pass, true);
});

test("333: every default-visible field is read, and the folded ones are not", () => {
  const seeded = "A subsisting proprietor.";
  for (const field of ["basis", "mitigation"]) {
    assert.equal(flagged(FINDINGS({ [field]: seeded }), VOCAB).pass, false, `${field} is read`);
  }
  for (const field of ["factors", "counterFactors", "purpleNotes"]) {
    assert.equal(flagged(FINDINGS({ [field]: [seeded] }), VOCAB).pass, false, `${field} is read`);
  }
  assert.equal(flagged(FINDINGS({ registerReads: [{ recordId: "R", read: seeded }] }), VOCAB).pass, false,
    "a read of a filing is default-visible on the card it sits on");
  // Internal working prose is not a reader surface and is deliberately outside this check.
  assert.equal(flagged(FINDINGS({ contextFraming: seeded, registerEstimate: seeded }), VOCAB).pass, true);
});

// ── the note that would print in the wrong place ─────────────────────────────────────────────────────
//
// The page sorts a reviewer's note by what it talks about, which is what lets an archived run put its
// mis-scoping flag at the top without a new field. The cost of that choice is that a note plainly about
// the asking which never says "the request" prints at the bottom instead — the exact defect the move
// exists to fix, and invisible, because nothing about the page looks wrong.

test("333/331: a note about the asking that never names the request is flagged for its writer", () => {
  const c = flagged(FINDINGS({ purpleNotes: [
    "Confirm the intended goods with the client before any filing step.",
    "Ask whether the client already has prior use of IRONWHISK in these goods.",
  ] }), "reviewer-note-subject");
  assert.equal(c.pass, false, "both notes are about the request and neither says so");
  assert.match(c.detail, /print under this name's conflicts rather than at the top/,
    "the flag says what will happen, not that a rule was broken");
});

test("333/331: naming the request clears it, and a note about the NAME never trips it", () => {
  assert.equal(flagged(FINDINGS({ purpleNotes: [
    "Check the request. We were asked to screen Class 9 software, and the client is described as a beverages business.",
  ] }), "reviewer-note-subject").pass, true, "it names the request, so it prints at the top");
  assert.equal(flagged(FINDINGS({ purpleNotes: [
    "Pull EG Tech's full goods list at clearance. It is the record most likely to change the picture.",
  ] }), "reviewer-note-subject").pass, true, "a note about the name is not about the asking");
});

test("333/331: the rater's own `about` ends the question — nothing is inferred over it", () => {
  const c = flagged(FINDINGS({ purpleNotes: [
    { about: "name", text: "Confirm the intended goods with the client before any filing step." },
  ] }), "reviewer-note-subject");
  assert.equal(c.pass, true, "a typed note is taken at its word, whatever the words are");
});

// ── how the flag travels ─────────────────────────────────────────────────────────────────────────────

test("333: a hit is a rewrite, never a disclosure — the flags never reach a delivery surface", () => {
  const lint = runKnockoutLint({
    findings: FINDINGS({ findings: [{ ordinal: 1, net: "The proprietor would prevail." }] }),
  });
  const mine = lint.failures.filter((f) => String(f.id).startsWith("plain-language-"));
  assert.ok(mine.length > 0, "the reviewer ran and flagged");
  // The caller projects on `surface === "report"` exactly. "findings" is scanned and never projected.
  for (const f of mine) assert.equal(f.surface, "findings", `${f.id} must not be projectable`);
});

// ── the rule, rather than a run that satisfies it (public issue 150) ────────────────────────────────
//
// The arm above asserts that today's callers produce an internal surface. That is the property holding
// BY BEHAVIOUR: every caller happens to pass nothing, and a future one passing `report` would have put
// a plain-language hit on the page a client reads with nothing going red. The arms below hold it by
// construction instead, from both ends — the surface cannot be ASKED for, and it cannot be RELABELLED
// afterwards, which is the same edit one step later and looks like every line around it.

test("150: the internal three cannot be ASKED for on a projectable surface", () => {
  // The parameter is gone. Passing one is not a thing a caller can do, so this asserts the shape rather
  // than a value: whatever a caller sends, the surface is the one this module pins.
  const checks = plainLanguageChecks({ findings: FINDINGS({ basis: "The proprietor would prevail." }), surface: "report" });
  assert.ok(checks.length > 0, "nothing ran, so nothing was asserted about what it labelled itself");
  for (const c of checks) {
    assert.equal(c.surface, INTERNAL_SURFACE,
      `${c.id} took its surface from the caller — a caller asking for "report" puts an internal note on the client's page`);
  }
});

test("150: and they cannot be RELABELLED onto the delivery surface by the lane that pushes them", () => {
  // Driven through the real lint rather than by calling the relabeller, because the relabeller is the
  // thing under test and reaching past it would prove nothing about the path that runs.
  const lint = runKnockoutLint({
    findings: FINDINGS({
      findings: [{ ordinal: 1, net: "The proprietor would prevail." }],
      purpleNotes: ["The stated industry does not match the goods."],
    }),
  });
  const projected = lint.checks.filter((c) => c.surface === "report").map((c) => c.id);
  assert.ok(projected.length > 0, "no check reached the delivery surface at all — the lane did not run");
  for (const id of NEVER_PROJECTED) {
    assert.ok(!projected.includes(id),
      `${id} is internal by design and reached the surface the caller projects from`);
  }
});

test("150: the set names every internal check the lane actually produces, not a subset of them", () => {
  // A set that has drifted from the checks it governs is the same defect wearing the fix's clothes: the
  // arm above would pass over an id nobody added, and that id would project. `reviewer-note-subject` is
  // the live example — it is internal for the same reason as the other two and the arm that predates
  // this one matched only the `plain-language-` prefix, so it never covered it.
  const ids = plainLanguageChecks({ findings: FINDINGS({ basis: "The proprietor would prevail." }) }).map((c) => c.id);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.ok(NEVER_PROJECTED.has(id),
      `${id} is produced by the internal reviewer and is not in NEVER_PROJECTED, so the lane may relabel it onto the client's page`);
  }
});

test("333: the reviewer decides nothing — a flagged run still returns a receipt, not a refusal", () => {
  const lint = runKnockoutLint({ findings: FINDINGS({ basis: "The proprietor would prevail." }) });
  assert.ok(Array.isArray(lint.checks) && lint.checks.length > 0);
  assert.ok(Array.isArray(lint.notApplicable), "the receipt still says what it did not run");
});

// ── THE LIST AND THE PAGE, HELD TOGETHER ────────────────────────────────────────────────────────────
//
// The checked fields are written out one by one rather than derived, which is right — deriving them
// would make "what a reader sees" a guess. The cost is that the list must be revisited whenever a field
// leaves a fold or joins one, and that dependency otherwise lives only in a comment.
//
// So the two are compared directly. For each field, a page is rendered carrying a marker in that field
// alone; stripping every CLOSED <details> body says whether a reader meets it without clicking; and the
// reviewer is asked whether it reads that field. The two answers must agree, field by field. Move a
// field into a fold and forget the list, or draw a folded field and forget the list, and this fails
// naming the field.

import { renderKnockoutHtml } from "../publish/render-knockout.mjs";

const FW_R = { framework_key: "t", bands: [{ label: "Blocking", tone: "severe" }, { label: "Medium", tone: "medium" }] };
const MARKER = "zzmarkerzz";

/**
 * Is the marker on the page WITHOUT opening anything?
 *
 * THE STYLESHEET AND THE SCRIPT COME OFF FIRST, and skipping that made this read false for every field
 * including ones that plainly render. The page inlines both, and they mention the fold element by name;
 * a non-greedy strip therefore started inside the stylesheet and ran to the document's first real
 * closing tag, swallowing the body between them. The page's own comments do the same thing.
 */
const seenWithoutClicking = (html) => {
  const body = String(html)
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<script>[\s\S]*?<\/script>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const shut = body.replace(/<details(?![^>]*\sopen)[^>]*>[\s\S]*?<\/details>/g, "");
  return shut.includes(MARKER);
};

/** Does the plain-language reviewer read this field? Seed a term only it would flag. */
const readByTheReviewer = (findings) =>
  plainLanguageChecks({ findings }).some((c) => c.id === VOCAB && !c.pass);

test("333: every field a reader meets without clicking is a field the reviewer reads", () => {
  // Both halves of the partition, so the arm fails in either direction rather than only one.
  const fields = [
    ["basis",            (m) => { m.basis = `The proprietor ${MARKER}.`; }],
    ["mitigation",       (m) => { m.mitigation = `The proprietor ${MARKER}.`; }],
    ["factors",          (m) => { m.factors = [`The proprietor ${MARKER}.`]; }],
    ["counterFactors",   (m) => { m.counterFactors = [`The proprietor ${MARKER}.`]; }],
    ["purpleNotes",      (m) => { m.purpleNotes = [`The proprietor ${MARKER}.`]; }],
    ["a finding's net",  (m) => { m.findings = [{ ordinal: 1, name: "N", net: `The proprietor ${MARKER}.` }]; }],
    ["assessment",       (m) => { m.assessment = `The proprietor ${MARKER}.`; }],
    ["a finding's basis",(m) => { m.findings = [{ ordinal: 1, name: "N", net: "Plain.", basis: `The proprietor ${MARKER}.` }]; }],
  ];
  const rows = [];
  for (const [name, seed] of fields) {
    const m = { name: "IRONWHISK", classesSearched: [8], rating: "Medium", basis: "Plain enough.",
      factors: ["Plain."], counterFactors: ["Plain."], mitigation: "Plain.", purpleNotes: [],
      findings: [], negatives: [] };
    seed(m);
    const findings = { batch: { executiveSummary: "One name screened.", standardCaveats: [] }, marks: [m] };
    const html = renderKnockoutHtml(findings, FW_R, { runId: "r", overall: "Medium" });
    rows.push({
      name,
      // THE THIRD FACT, without which a folded field and a field that renders NOWHERE look identical:
      // both are invisible and both are unchecked, so both would satisfy the equality below while one
      // of them tests nothing. Every row must first prove the marker reached the document.
      present: html.includes(MARKER),
      visible: seenWithoutClicking(html),
      checked: readByTheReviewer(findings),
    });
  }
  // Every row prints before any assertion: a failure should arrive with the whole table beside it,
  // not with the first row that tripped.
  for (const r of rows) {
    console.log(`  present=${String(r.present).padEnd(5)} visible=${String(r.visible).padEnd(5)} `
      + `checked=${String(r.checked).padEnd(5)} ${r.name}`);
  }
  for (const r of rows) {
    assert.ok(r.present, `${r.name} rendered nowhere at all — this row proves nothing either way`);
  }
  for (const r of rows) {
    assert.equal(r.checked, r.visible,
      r.visible
        ? `${r.name} is on the page before any click and the reviewer does not read it`
        : `${r.name} is behind a fold and the reviewer reads it — folded reasoning keeps its precision`);
  }
});

// ── the doctrine that teaches it ─────────────────────────────────────────────────────────────────────

test("333: the skill carries the two-register rule, and its worked examples obey it", () => {
  const skill = readFileSync(SKILL, "utf8");
  assert.match(skill, /## Plain language — the two-register rule/);
  assert.match(skill, /no sentence over 25 words/);
  // The swaps are examples of one failure, not its boundary — the skill must say so, because a writer
  // who reads the table as the rule will find a synonym the table missed and ship it.
  assert.match(skill, /The rule is the test, not the list/);
  // The doctrine tells a writer that a request note NAMES the request. The renderer sorts notes on
  // exactly that, so a doctrine that stopped saying it would silently file request notes under the name.
  assert.match(skill, /A note about the request NAMES the request/);
});

test("333: the skill's own worked notes sort the way the skill says they do", () => {
  const skill = readFileSync(SKILL, "utf8");
  const section = skill.slice(skill.indexOf("A note is verb-first"), skill.indexOf("## The per-mark opening read"));
  const quotes = [...section.matchAll(/^> "(.+?)"$/gms)].map((m) => m[1].replace(/\s*>\s*/g, " "));
  assert.ok(quotes.length >= 4, `expected the worked notes, found ${quotes.length}`);
  // The renderer's own reader, restated: a note naming the request is a request note.
  const isRequest = (t) => /\b(?:dispatch|the request|the requester|instructed|was asked)\b/i.test(t);
  const [reqA, reqB, ...names] = quotes;
  assert.ok(isRequest(reqA), "the mis-scoped-request example must sort as a request note");
  assert.ok(isRequest(reqB), "and so must the prior-use example");
  for (const n of names) assert.ok(!isRequest(n), `a name note must not sort as a request note: ${n.slice(0, 40)}`);
});

// ── the live check reads the pinned rule, rather than a fourth copy of it ────────────────────────────
//
// The rule is written three times on purpose — the two products' doctrine documents and PLAIN_FORMS —
// and a test pins those three to each other, because a seat taught half a rule writes half a report.
// The copy that actually RAN on every delivery was a fourth, in the pre-delivery lint, importing
// nothing and outside that pinning. It had drifted in both directions at once.
test("395: the terms the live check flags are exactly the pinned ones", () => {
  const flaggedTerms = (basis) => {
    const c = plainLanguageChecks({ findings: FINDINGS({ basis }) }).find((x) => x.id === VOCAB);
    return c && !c.pass ? c.detail : "";
  };

  // TAUGHT AND NOW ENFORCED. `instructed` is in the doctrine both products read and the fourth copy did
  // not carry it, so a seat was taught to avoid a word nothing checked.
  assert.match(flaggedTerms("We searched what was instructed."), /instructed/,
    "a term the doctrine teaches is still not enforced by the check that runs");

  // NOT TAUGHT, SO NOT ENFORCED. These three were flagged by the fourth copy and appear in no pinned
  // copy, so a seat was corrected against a rule it was never given. Teaching one is a doctrine change:
  // adding it to PLAIN_FORMS without its worked swap in both documents reds the pinning test, which is
  // the point of that test.
  for (const [term, prose] of [
    ["lane", "The register lane returned nothing."],
    ["limb", "It fails on every limb of the test."],
    ["senior right", "They hold a senior right here."],
  ]) {
    assert.equal(flaggedTerms(prose), "", `"${term}" is flagged by the live check and taught in no pinned copy`);
  }
});

test("395: consolidating on the pinned source did not narrow what is caught", () => {
  // THE REGRESSION THIS COULD HAVE BEEN. The fourth copy's patterns handled inflections and the pinned
  // source's did not — it built `\bproprietor\b` and matched neither plural. Reading terms from the
  // weaker matcher would have quietly narrowed the live check while looking like a tidy-up, so the
  // inflections moved INTO the pinned source and both sides use one matcher.
  for (const prose of ["Two proprietors objected.", "The earlier mark is prevailing here.", "Both chunks were screened."]) {
    const c = plainLanguageChecks({ findings: FINDINGS({ basis: prose }) }).find((x) => x.id === VOCAB);
    assert.equal(c.pass, false, `an inflected form stopped being caught: ${prose}`);
  }
  assert.equal(plainLanguageChecks({ findings: FINDINGS({ basis: "Two shops sell under this name in the same goods." }) })
    .find((x) => x.id === VOCAB).pass, true, "clean prose was flagged");
});

// ── the flag carries the replacement, not only the fault ────────────────────────────────────────────
//
// The doctrine's own words: the swap is the load-bearing half. This flag named the term and pointed at
// a document for what to write instead — which is the half a reviewing pass that REWRITES the line needs
// in hand, and the half a reader of the flag cannot act on without going somewhere else.
test("89: a vocabulary flag says what to write instead, and where the pinned source has no swap it says to cut", () => {
  const detail = (basis) => plainLanguageChecks({ findings: FINDINGS({ basis }) })
    .find((x) => x.id === VOCAB).detail;

  const d = detail("The proprietor would prevail here.");
  assert.match(d, /"proprietor" → "owner"/, "the flag names the fault and not the remedy");
  assert.match(d, /"prevail" → "win"/, "…for every term on the line, not just the first");
  assert.match(d, /do not swap the word/,
    "the instruction to rewrite the sentence is gone — a word-for-word swap is the cheap wrong fix the doctrine names");

  // AN ENGINE WORD HAS NO PLAIN FORM, deliberately: there is nothing a reader should see in its place,
  // so the instruction is to cut rather than to replace. A blank arrow would read as a missing swap.
  const engine = detail("The chunk was screened overnight.");
  assert.match(engine, /"chunk" \(an engine word — cut it\)/, "an engine word was offered a replacement it has none of");
  assert.doesNotMatch(engine, /chunk" → ""/, "an empty swap reached the flag");
});
