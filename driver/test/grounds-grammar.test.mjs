// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// grounds-grammar.test.mjs —: the instrument, proven against a known case before first use.
//
// The design spec's last bullet asks for exactly this and gives the reason: "the checker itself gets a
// planted violation (a note that describes the material must redden it), per the validate-against-a-
// known-case rule." A checker nobody has seen fail is a checker nobody should believe.
//
// The known cases are REAL. e2e read all 24 `loaded` notes in the corpus rather than keyword-probing
// them, and two are quoted verbatim. They carry no identity — they describe third-party web
// content — so they are used here as written. Invented fixtures only carry the shapes you thought of,
// which is this repo's own house rule and the reason the fixture is preserved rather than tidied.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGroundsNote, statesGrounds, GROUNDS_VERDICTS } from "../grounds-grammar.mjs";

// Verbatim from the corpus. Both are TRUE statements. Neither states what could not be
// established, and that is the entire defect.
const REAL_NOTES = [
  "Article about real gang member sentenced for federal drug trafficking offense",
  "Wikipedia article documenting 1871 race riot, negative historical violence event",
];

test("#919 THE DEFECT, ON REAL DATA: the notes the seat actually writes describe the material", () => {
  for (const note of REAL_NOTES) {
    const r = classifyGroundsNote(note);
    assert.equal(r.verdict, "description", `${JSON.stringify(note)} → ${r.verdict} (${r.why})`);
    assert.equal(statesGrounds(note), false);
  }
  // The measurement this instrument exists to make repeatable: 24 of 24 in the corpus, 0 grounds.
  assert.equal(REAL_NOTES.filter(statesGrounds).length, 0,
    "if this ever passes, the seat's behaviour changed and #919's premise needs re-reading");
});

test("#919 the checker FIRES on a planted violation — the spec's proof before first use", () => {
  // Planted: a note that describes the material, in the shape a seat would write it, must redden the
  // check. This is the assertion the spec names; without it the instrument is an opinion.
  const planted = "Blog post describing a criminal conviction, negative reputational content";
  assert.equal(classifyGroundsNote(planted).verdict, "description");
  // …and the control it needs, or "reddens on everything" would pass here too.
  const clean = "Could not establish whether this refers to the applicant or an unrelated namesake of "
    + "the same surname; no source ties the conviction to the mark holder.";
  assert.equal(classifyGroundsNote(clean).verdict, "grounds");
});

test("#919 A DESCRIPTION CONTAINING A LIMIT PHRASE IS STILL A DESCRIPTION — the keyword-probe trap", () => {
  // e2e's warning on the original measurement: "a keyword probe on prose is exactly the instrument
  // that misleads". This is that trap, made into an assertion.
  //
  // The first three carry "could not" and nothing else. A bare word list scores them as grounds; both arms here
  // reject them, and the limit arm never even fires — it is anchored on a verb of ESTABLISHMENT, so
  // "could not pay" and "could not be appealed" are not limits on what the writer could show.
  for (const t of [
    "Article about a man who could not pay his debts and was declared bankrupt",
    "Wikipedia page documenting a dispute the parties could not resolve",
    "News story about a verdict that could not be appealed",
  ]) {
    assert.equal(classifyGroundsNote(t).verdict, "description", `${JSON.stringify(t)} → not a description`);
  }

  // The sharper case, and the one the PRECEDENCE rule exists for: a real limit construction sitting
  // inside a description of the source. Both signals fire; description has to win, or a seat could
  // satisfy the instruction by describing the material and appending a stock phrase.
  for (const t of [
    "Article about a firm that could not establish its rights in the mark",
    "Wikipedia page documenting a claim the court could not verify",
  ]) {
    const r = classifyGroundsNote(t);
    assert.equal(r.verdict, "description", `${JSON.stringify(t)} → ${r.verdict}`);
    assert.match(r.why, /limit phrase appears inside that description/,
      "and the reason must NAME what was decided, so a reader who disagrees can see the call");
  }
});

test("#919 a note that is neither is UNCLEAR, and unclear is a finding rather than a pass", () => {
  // The third arm, and the reason there are three. A two-way classifier has to guess, and guessing on
  // prose is how the probe misleads. Absence is a finding: a note nobody can read as either shape is
  // not a note that satisfies the instruction.
  for (const s of ["", "   ", "see above", "flagged", "n/a"]) {
    const r = classifyGroundsNote(s);
    assert.equal(r.verdict, "unclear", `${JSON.stringify(s)} → ${r.verdict}`);
    assert.equal(statesGrounds(s), false, "and unclear must never satisfy the caller");
  }
  assert.equal(classifyGroundsNote(null).verdict, "unclear");
  assert.equal(classifyGroundsNote(undefined).verdict, "unclear");
});

test("#919 the grounds arm recognises the forms the instruction actually asks for", () => {
  // VALIDATED AGAINST CONSTRUCTED EXAMPLES ONLY, and that is stated rather than glossed: the corpus
  // contains NO note that states what could not be established — that absence IS the defect, so there
  // is nothing real to validate this arm against. The first real one to arrive is worth re-reading
  // this against rather than assuming it passes.
  const grounds = [
    "Could not establish whether the person named shares only a surname with the applicant.",
    "Unable to confirm that the entity in the filing is the same one in the coverage.",
    "No evidence ties the allegation to the mark holder rather than a similarly named trader.",
    "Nothing here establishes which of the two companies the report is about.",
    "It remains unclear whether the proceedings concern the applicant or its former distributor.",
    "The source does not establish that the conviction belongs to this proprietor.",
    "Not established that the account posting the material is operated by the owner.",
  ];
  for (const g of grounds) {
    const r = classifyGroundsNote(g);
    assert.equal(r.verdict, "grounds", `${JSON.stringify(g)} → ${r.verdict} (${r.why})`);
  }
});

test("#919 the verdict set is closed, and every answer carries a why a reader can act on", () => {
  const samples = [...REAL_NOTES, "", "Could not establish anything.", "some prose with no shape at all"];
  for (const s of samples) {
    const r = classifyGroundsNote(s);
    assert.ok(GROUNDS_VERDICTS.includes(r.verdict), `${r.verdict} is not one of the three`);
    assert.ok(r.why && r.why.length > 30,
      "a verdict without a usable reason is the step-silent shape this whole issue is about (#1117)");
  }
});
