// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — locating a delivery-check fault in the report's parts, on invented texts
//
// A REPORT FAULT REACHES THE PART THAT HOLDS IT.
//
// Most of the delivery check's prose checks name no finding, and every such fault went to the overview's repair,
// which cannot edit a card. Each is now located by running its own check again on each part's own text: a card that
// holds it gets it, with the detail the check gives on that card alone; the overview gets what it holds; a fault only
// the lines composed from the record hold goes to the writer, named by the finding of each line that holds it; and one
// no single part holds keeps the overview's repair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { locateReportFaults, LOCATED_CHECKS } from "../repair-targets.mjs";
import { runLint } from "../predelivery-lint.mjs";

const ADVICE = "We recommend filing a narrower specification before launch.";
const SCOPE = "The search ran 14 queries across the register.";
const CARD = (ordinal, extra = "") => ({ ordinal, text: `### Full detail\n\n- **Filing:** The invented filing detail for card ${ordinal}.${extra ? `\n- **Read:** ${extra}` : ""}\n` });
const OVERVIEW = (extra = "") => `---\ntitle: An invented matter\n---\n\n# Actions\n\nThe invented overview of the matter.${extra ? ` ${extra}` : ""}\n`;
const fault = (id, detail = "the whole report's detail") => ({ id, family: "x", surface: "report", pass: false, detail });

test("a fault inside one card goes to that card, with the detail its check gives on that card alone", () => {
  const t = locateReportFaults([fault("prescription-prose")], { cards: [CARD(1), CARD(2, ADVICE), CARD(3)], overview: OVERVIEW() });
  assert.deepEqual([...t.cards.keys()], [2]);
  const [f] = t.cards.get(2);
  assert.equal(f.ordinal, 2);
  assert.match(f.detail, /We recommend filing a narrower specification/, "the card is not told what its own text holds");
  assert.deepEqual([t.overview, t.stamped, t.unlocated], [[], [], []], "the overview was given a fault it does not hold");
});

test("a fault in the overview goes to the overview, and one in a card and the overview goes to both", () => {
  const shell = locateReportFaults([fault("scope-numbers-in-prose")], { cards: [CARD(1), CARD(2)], overview: OVERVIEW(SCOPE) });
  assert.deepEqual([shell.cards.size, shell.overview.length], [0, 1]);
  assert.match(shell.overview[0].detail, /14 queries/);
  const both = locateReportFaults([fault("scope-numbers-in-prose")], { cards: [CARD(1, SCOPE), CARD(2)], overview: OVERVIEW(SCOPE) });
  assert.deepEqual([[...both.cards.keys()], both.overview.length, both.unlocated.length], [[1], 1, 0]);
});

test("a fault only a line composed from the record holds goes to the writer, named by that line's finding", () => {
  const t = locateReportFaults([fault("prescription-prose")], { cards: [CARD(1), CARD(2)], overview: OVERVIEW(),
    stamped: [{ ordinal: 1, text: "The invented finding sentence." }, { ordinal: 2, text: ADVICE }] });
  assert.deepEqual([t.cards.size, t.overview.length, t.stamped.length, t.unlocated.length], [0, 0, 1, 0]);
  assert.deepEqual(t.stamped[0].parts.map((x) => x.ordinal), [2], "the fault is not placed in the line that holds it");
  assert.match(t.stamped[0].parts[0].detail, /We recommend filing a narrower specification/, "the writer is not told what that line holds");
});

test("a fault no single part holds, or whose check cannot run on a part, keeps the overview's repair it always had", () => {
  const counts = locateReportFaults([fault("counting-consistency")], {
    cards: [CARD(1, "Halvorne Works holds 3 registrations in the class."), CARD(2, "Halvorne Works holds 5 registrations in the class.")],
    overview: OVERVIEW() });
  assert.deepEqual([counts.cards.size, counts.overview.length, counts.unlocated.length], [0, 1, 1]);
  assert.equal(counts.overview[0].detail, "the whole report's detail", "an unlocated fault lost the detail the check gave");
  const other = locateReportFaults([fault("party-fact-sourcing")], { cards: [CARD(1)], overview: OVERVIEW() });
  assert.deepEqual([other.cards.size, other.overview.length, other.unlocated.length], [0, 1, 1]);
});

test("a fault whose check named its finding goes to that finding's card unchanged", () => {
  const named = { ...fault("finding-provenance", "card 2 cites a record of finding 1"), ordinal: 2 };
  const t = locateReportFaults([named], { cards: [CARD(1), CARD(2)], overview: OVERVIEW() });
  assert.deepEqual(t.cards.get(2), [named]);
  assert.deepEqual([t.overview, t.unlocated], [[], []]);
});

test("each check the locator runs on a part fails on the whole report where it fails on a part", () => {
  // the located checks are the delivery check's own: on a report made of the same parts, each fails as a whole
  const report = `${OVERVIEW()}\n# Marks\n\n## An invented card\n\n- ord: 2\n\n${ADVICE} ${SCOPE} We recommend a narrower filing.`;
  const failing = new Set(runLint({ reportMd: report }).failures.map((f) => f.id));
  for (const id of ["prescription-prose", "scope-numbers-in-prose"]) assert.ok(failing.has(id), `${id} does not fail on the whole report`);
  assert.ok(LOCATED_CHECKS.includes("prescription-prose") && LOCATED_CHECKS.includes("scope-numbers-in-prose"));
});
