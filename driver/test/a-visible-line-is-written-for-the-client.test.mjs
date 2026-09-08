// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE TWO-REGISTER RULE ON THE LINES A READER MEETS FIRST — tracker issue 333.
//
// The report goes to a lawyer who layers advice on it, and that lawyer's client reads the same page. The
// owner's review of two delivered pages found the default-visible lines written in the lawyer's
// vocabulary, in single sentences of seventy-odd words — the hardest text on the page occupying the one
// place a non-lawyer reads before opening anything.
//
// This is advisory by ruling: a hit is a rewrite of the line, never a disclosure and never a run failure.
// It changes no band, no evidence and nothing that is searched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainRegisterFlags, PLAIN_FORMS, SENTENCE_WORD_LIMIT, DEFAULT_VISIBLE_FIELDS } from "../plain-register.mjs";

// The two lines the acceptance names, taken from the delivered pages the owner read.
const KNOCKOUT_NET = "The proprietor of the subsisting registration would prevail on the marks-and-goods comparison.";
const CLEARANCE_ONE_LINER = "Obstructed — on the record as it stands the mark is obstructed in all three territories by an "
  + "identical prior position, and each remaining class carries citable prior rights of its own besides.";

test("333 a seeded lawyer-vocabulary sentence in a knockout net is flagged", () => {
  const flags = plainRegisterFlags(KNOCKOUT_NET);
  const terms = flags.filter((f) => f.kind === "vocabulary").map((f) => f.term);
  assert.ok(terms.includes("proprietor"), `not flagged: ${JSON.stringify(terms)}`);
  assert.ok(terms.includes("subsisting"));
  assert.ok(terms.includes("prevail"));
});

test("333 …and in a clearance one-liner", () => {
  const terms = plainRegisterFlags(CLEARANCE_ONE_LINER).filter((f) => f.kind === "vocabulary").map((f) => f.term);
  assert.ok(terms.includes("citable"), `not flagged: ${JSON.stringify(terms)}`);
  assert.ok(terms.includes("on the record as it stands"));
});

test("333 the flag carries the REWRITE, not the word — a seat has to produce a sentence", () => {
  // "Reject: a list of forbidden words as the mechanism." A flag that names a word and stops is that
  // list wearing a different hat: it tells a seat what to delete and nothing about what to write.
  const flag = plainRegisterFlags(KNOCKOUT_NET).find((f) => f.term === "proprietor");
  assert.match(flag.say, /owner/, "the plain form the reader needs is not offered");
  assert.match(flag.say, /Rewrite the sentence/, "and the instruction is to rewrite, not to swap");
});

test("333 THE CONTROL THAT DECIDES WHETHER THIS CAN SHIP: the mark under clearance is never flagged", () => {
  // Half of these words are ordinary English and several are plausible marks. The sibling defect is on
  // the record one level in: a refusal that could not tell a mark from engine vocabulary blocked a
  // clearance on the mark SLICE, and a render-time substitution rewrote "AXIS Bank" as "group Bank" on a
  // report clearing AXIS. Flagging the subject of the report would put noise on exactly the page that
  // matters most.
  for (const mark of ["PREVAIL", "SENIOR", "SPECIFICATION"]) {
    const line = `${mark} is already registered by another owner for the same goods.`;
    assert.deepEqual(plainRegisterFlags(line, { mark }), [],
      `the mark ${mark} was flagged as the lawyer's vocabulary on its own clearance`);
  }
});

test("333 …and an owner named in the run is not flagged either", () => {
  const line = "Prevail Holdings owns the earlier mark and has used it since 2019.";
  assert.deepEqual(plainRegisterFlags(line, { owners: ["Prevail Holdings"] }), []);
});

test("333 …but the same word IS flagged when it is not what the run is about", () => {
  // Without this the control above is satisfied by a check that never fires, which would pass every
  // arm here while doing nothing on the page.
  const line = "The earlier owner would prevail on the comparison.";
  const terms = plainRegisterFlags(line, { mark: "NORTHWIND" }).map((f) => f.term);
  assert.ok(terms.includes("prevail"), "excluding the run's own terms must not disarm the check");
});

test("333 a visible sentence over the limit is flagged, with its length and the remedy", () => {
  const long = "ORBIT is a suggestive and already widely adopted term in the satellite and sky observation field, "
    + "and identically named tracking software sits in the client's own app store channel beside an established "
    + "communications business of the same name, so an earlier owner is likely to win a dispute over this name.";
  const flag = plainRegisterFlags(long, { mark: "ORBIT" }).find((f) => f.kind === "length");
  assert.ok(flag, "a 50-word visible sentence was not flagged");
  assert.ok(flag.words > SENTENCE_WORD_LIMIT);
  assert.match(flag.say, /Do not shorten it by dropping the reason/,
    "the cheapest wrong fix must be foreclosed where the seat reads the instruction");
});

test("333 a line already written for the reader is left alone", () => {
  // The issue's own worked rewrite. If this flags, the rule is refusing the standard it sets.
  const good = "One company already owns this exact name for these goods in all three territories. "
    + "Everything else is a family of similar names, none decisive on its own.";
  assert.deepEqual(plainRegisterFlags(good, { mark: "DELPH" }), []);
});

test("333 both products declare the fields the rule reaches, and they are not empty", () => {
  // The knockout and the clearance drifted apart once already. One list, named where both read it.
  for (const product of ["knockout", "clearance"]) {
    const fields = DEFAULT_VISIBLE_FIELDS[product];
    assert.ok(Array.isArray(fields) && fields.length > 0, `${product} declares no default-visible fields`);
    assert.ok(fields.includes("summary"), `${product} does not count its summary as visible`);
    assert.ok(fields.includes("reviewerNotes"), `${product} does not count the reviewer's notes as visible`);
  }
  assert.ok(DEFAULT_VISIBLE_FIELDS.knockout.includes("net"), "the knockout's one sentence per finding");
  assert.ok(DEFAULT_VISIBLE_FIELDS.clearance.includes("oneLiner"), "the clearance's one-liner");
});

test("333 every worked form offers a plain alternative, or says the word simply goes", () => {
  for (const [term, plain] of PLAIN_FORMS) {
    assert.equal(typeof term, "string");
    assert.ok(term.length > 0);
    assert.equal(typeof plain, "string", `${term} has no plain form recorded`);
  }
  assert.ok(PLAIN_FORMS.some(([, plain]) => plain === ""), "the engine word that has no replacement is not represented");
});
