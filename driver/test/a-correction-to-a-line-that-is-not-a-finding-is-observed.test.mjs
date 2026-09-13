// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CORRECTION TO A LINE THE READER SEES THAT IS NOT A FINDING IS APPLIED, OR DECLINED WITH A REASON.
//
// The reviewer reads the lines a clearance reader meets first and returns rewrites. A finding carries an
// ordinal and a name, so a flag about one joins; a coverage note, an action and the mark assessment carry
// neither, so every flag about them came out `not-entity-scoped` whatever the corrective pass did —
// seven such flags survived one clearance on the test box, and a production matter showed the same split
// (2026-09-11). The flagged lines reached the client as written.
//
// Two halves, and both are here: the pass is TOLD where a rewrite of such a line goes, and the driver
// OBSERVES the line it named, so "applied" and "declined" are facts the run records rather than claims.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCorrectionsApplied, correctionsAppliedTable, linesOf, reportLines,
  RESOLVED_OUTCOMES, unresolvedFlags,
} from "../corrections-feedforward.mjs";
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";

/** A findings record carrying one of every default-visible line that is not a finding. */
const doc = ({ note = "Both EU registers were read for word marks in class 9.", action = "File the intent-to-use before the deadline.",
  distinctiveness = "The mark is suggestive of the goods.", corrections = null } = {}) => ({
  findings: [{ ordinal: 1, mark: "ZENTORVIK", owner: { name: "Zentorvik Oy" }, band: "Medium",
    legal_position: "x", practical_position: "y", net: "One sentence about the conflict." }],
  coverage: [{ area: "EUIPO class 9", state: "confirmed-clean", note }],
  actions: [{ id: 3, kind: "file", text: action }],
  markAssessment: { distinctiveness, connotation: "It reads as a coined word." },
  ...(corrections ? { corrections } : {}),
});

const row = (n, text, extra = {}) => ({ n, kind: "narrative", typed: true, text, ordinals: null, ...extra });

test("the lines a reader meets that are not a finding are enumerated, with the labels the reviewer was handed", () => {
  const lines = reportLines(doc());
  // A FLOOR ON THE POPULATION. A reader that answered nothing would make every assertion below vacuous,
  // and an empty list reads exactly like a complete one.
  assert.ok(lines.length >= 4, `only ${lines.length} visible lines — the reader answered nothing`);
  assert.deepEqual(lines.map((l) => l.label), [
    'the coverage line for "EUIPO class 9"',
    'the action "3"',
    "the mark assessment's distinctiveness",
    "the mark assessment's connotation",
  ]);
  // The raw record answers the same, because a findings document reaches this both ways.
  assert.equal(reportLines({ mark_assessment: { distinctiveness: "d" } })[0].label, "the mark assessment's distinctiveness");
});

test("a flag joins a line by the label it was handed, or by quoting it", () => {
  const lines = reportLines(doc());
  assert.deepEqual(linesOf('the coverage line for "EUIPO class 9" claims more than the run did', lines).map((l) => l.label),
    ['the coverage line for "EUIPO class 9"']);
  assert.deepEqual(linesOf('the action "3" tells the client to do something the opinion does not support', lines).map((l) => l.label),
    ['the action "3"']);
  assert.deepEqual(linesOf("the mark assessment's distinctiveness overstates it", lines).map((l) => l.label),
    ["the mark assessment's distinctiveness"]);
  // QUOTED, which is what the reviewer is told to do with a sentence it rewrites.
  assert.deepEqual(linesOf('it says "Both EU registers were read for word marks in class 9" and only one was', lines).map((l) => l.label),
    ['the coverage line for "EUIPO class 9"']);
  // AND THE CONTROL: a flag about the document joins nothing, which is a different fact from naming a
  // line and finding it unmoved.
  assert.deepEqual(linesOf("the narrative's second paragraph overstates how crowded the field is", lines), []);
});

test("a line that was rewritten is resolved; one left as written is printed, with the pass's own reason", () => {
  const pre = doc();
  const post = doc({ note: "Both EU registers were read for word marks in class 9, and no other class.",
    corrections: { applied: true, note: 'the coverage line for "EUIPO class 9": corrected' } });
  const changed = buildCorrectionsApplied([row(1, 'the coverage line for "EUIPO class 9" claims more than the run did')], pre, post);
  assert.equal(changed[0].outcome, "line-changed");
  assert.deepEqual(changed[0].targets, ['the coverage line for "EUIPO class 9"']);
  assert.ok(RESOLVED_OUTCOMES.includes("line-changed"), "a rewritten line is resolved, or the client's report prints it as open");
  assert.deepEqual(unresolvedFlags(changed), []);

  // Left as written, with a reason: the run records the decline rather than reporting nothing.
  const declined = doc({ corrections: { applied: true, note: 'the coverage line for "EUIPO class 9": no-change-because the receipt supports it' } });
  const unchanged = buildCorrectionsApplied([row(1, 'the coverage line for "EUIPO class 9" claims more than the run did')], pre, declined);
  assert.equal(unchanged[0].outcome, "line-unchanged");
  assert.match(unchanged[0].reason, /no-change-because the receipt supports it/);
  assert.equal(unresolvedFlags(unchanged).length, 1, "a line nobody moved is not resolved");

  // Neither applied nor declined: the reason is null, and the row still prints.
  const silent = buildCorrectionsApplied([row(1, 'the coverage line for "EUIPO class 9" claims more than the run did')], pre, doc());
  assert.equal(silent[0].outcome, "line-unchanged");
  assert.equal(silent[0].reason, null);
});

test("a line the pass deleted is its own outcome, as a removed finding is", () => {
  const pre = doc();
  const post = { ...doc(), coverage: [] };
  const applied = buildCorrectionsApplied([row(1, 'the coverage line for "EUIPO class 9" claims more than the run did')], pre, post);
  assert.equal(applied[0].outcome, "line-removed");
  assert.deepEqual(applied[0].removed, ['the coverage line for "EUIPO class 9"']);
  assert.equal(unresolvedFlags(applied).length, 1, "a line answered by deletion is not a line corrected");
});

test("what the flag declares still decides: an ordinal wins, and a flag naming nothing is unchanged in meaning", () => {
  const pre = doc();
  const post = doc({ note: "rewritten entirely" });
  // A DECLARED ORDINAL is the reviewer's own answer to the same question and still beats the line join.
  const declared = buildCorrectionsApplied(
    [row(1, 'the coverage line for "EUIPO class 9" is wrong', { ordinals: [1] })], pre, post);
  assert.equal(declared[0].outcome, "findings-unchanged");
  assert.deepEqual(declared[0].ordinals, [1]);
  // AND THE CONTROL THAT MUST NOT MOVE: a flag about the document, naming no finding and no visible line,
  // is still `not-entity-scoped` — the run could not check it, and saying otherwise would be a claim.
  const prose = buildCorrectionsApplied([row(1, "the narrative's second paragraph overstates how crowded the field is")], pre, post);
  assert.equal(prose[0].outcome, "not-entity-scoped");
  assert.equal(prose[0].reason, undefined, "a row that joined no line carries no reason field at all");
});

test("the table the recheck reads says which line moved, and what the pass said about one that did not", () => {
  const pre = doc();
  const post = doc({ corrections: { applied: true, note: 'the action "3": no-change-because the opinion supports it' } });
  const table = correctionsAppliedTable(buildCorrectionsApplied([row(1, 'the action "3" is not supported by the opinion')], pre, post));
  assert.match(table, /line-unchanged/);
  assert.match(table, /the pass said: the action "3": no-change-because/);
  assert.match(table, /`line-\*` rows compare a line the reader sees that is not a finding/);
});

test("the corrective pass is told where a rewrite of such a line goes, in both of the composer's shapes", () => {
  const corrective = REPAIR_COMPOSERS.find((c) => c.key === "synthesis:corrective");
  assert.ok(corrective, "the corrective composer is gone, and this arm is about what it says");
  for (const sample of corrective.samples) {
    const text = corrective.compose(sample.args);
    assert.match(text, /a coverage row's "note", an action's "text", or the mark assessment's/,
      `${sample.name}: the pass is not told that such a line is correctable at all`);
    assert.match(text, /send the complete top-level `coverage` array/, sample.name);
    assert.match(text, /A row left out of the array is a row deleted/, `${sample.name}: nothing warns that a partial array deletes`);
    assert.match(text, /Rewording a coverage note is NOT reopening the coverage account/,
      `${sample.name}: without this the seat reads two instructions as a conflict and does nothing`);
    assert.match(text, /named in the "corrections" note with the reason/, `${sample.name}: a decline has nowhere to go`);
  }
});
