// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the fold at the delivery seam, on invented records
//
// THE FOUR ANSWERS CITE THE FINDINGS AS THE FOLD NUMBERS THEM.
//
// The delivery seam folds a second filing of the same conflict into one finding and renumbers the rest, and the
// actions' citations follow the renumber. The four answers' citations did not. On a test run of a crowded matter the
// writer's record held 405 findings and the fold left 390, so the panel's citations of findings 404 and 405 pointed past the
// record's end. The pre-delivery check flagged them, nothing could repair them, and the client's page linked those
// two answers to findings that were not there. The fold now renumbers the four answers' citations too. A citation
// the fold does not know is left as written, so one the writer got wrong still reaches the check. Every mark and
// owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldRecord } from "../record-fold.mjs";
import { fourAnswersCoherenceChecks } from "../predelivery-lint.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

/** A record whose findings are `[owner, mark]` pairs, each on its own registration. */
function record(rows, fourAnswers) {
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  return { ...doc, four_answers: fourAnswers, findings: rows.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9200000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    return f;
  }) };
}
// The second finding is a second filing of the first, so the fold keeps three findings: 1 and 2 become 1, 3 becomes 2,
// 4 becomes 3.
const FOUR = [["Qorvalen Holdings", "VELTRIN"], ["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"], ["Selmora Labs", "KESTRIN"]];
const answers = (rights, objection) => ({
  third_party_rights: { token: "moderate", ordinals: rights },
  objection_likelihood: { token: "possible", ordinals: objection },
});
const danglingCheck = (doc) => fourAnswersCoherenceChecks({ fourAnswers: doc.four_answers, findings: doc.findings, verdictDoc: null })
  .find((c) => c.id === "four-answers-ordinals");

test("premise: in the model's numbering the panel's citation of the last finding points past the folded record", () => {
  const { doc, map } = foldRecord(record(FOUR, answers([1, 4], [2, 3])));
  assert.deepEqual(map.modelToFolded, { 1: 1, 2: 1, 3: 2, 4: 3 });
  assert.equal(doc.findings.length, 3);
});

test("the fold renumbers the four answers' citations, so each names a finding the folded record holds", () => {
  const { doc } = foldRecord(record(FOUR, answers([1, 4], [2, 3])));
  assert.deepEqual(doc.four_answers.third_party_rights.ordinals, [1, 3], "the citation of the last finding was not renumbered");
  assert.deepEqual(doc.four_answers.objection_likelihood.ordinals, [1, 2], "a citation of the folded filing did not become its kept finding, once");
  assert.equal(doc.four_answers.third_party_rights.token, "moderate", "an answer itself changed");
  assert.equal(danglingCheck(doc)?.pass, true, `the folded panel still cites a finding that is not there: ${danglingCheck(doc)?.detail}`);
});

test("a citation the fold does not know is left as written, and the check still names it", () => {
  const UNKNOWN = 9;
  const { doc } = foldRecord(record(FOUR, answers([4, UNKNOWN], [1])));
  assert.deepEqual(doc.four_answers.third_party_rights.ordinals, [3, UNKNOWN]);
  const check = danglingCheck(doc);
  assert.equal(check?.pass, false, "a citation the writer got wrong was dropped, so the check could not name it");
  assert.ok(check.detail.includes(`cites #${UNKNOWN}, which this run has no finding for`), check.detail);
});

test("a record with nothing to fold keeps its four answers exactly as they came", () => {
  const plain = record([FOUR[0], FOUR[2]], answers([1, 2], [2]));
  const { doc, map } = foldRecord(plain);
  assert.equal(map, null);
  assert.equal(doc, plain);
});
