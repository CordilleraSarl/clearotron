// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REVIEW IS HANDED THE ADDRESSES ITS FLAGS MAY NAME.
//
// A flag names the findings it is about by ordinal, and nothing checked the ordinal named a finding the review was
// handed; the report's other parts had no address, so a correction bound a flag to them by matching its prose. The
// address list names every finding by ordinal, across the records before and after a correction, and every coverage
// line, action, mark assessment read and narrative section by the key a correction already uses. A key two rows of
// one record share is never offered. What a flag declares resolves against the list, or the first thing that does not
// is returned, with the listed address it differs from only in spacing or case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDeclared, reviewAddresses } from "../review-addresses.mjs";

const BEFORE = {
  findings: [{ ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 }],
  coverage: [{ area: "European Union", note: "searched" }, { area: "United Kingdom", note: "" }],
  actions: [{ id: "watch", text: "Watch the register." }],
  mark_assessment: { distinctiveness: "Inherently distinctive.", connotation: "" },
};
const AFTER = { findings: [{ ordinal: 1 }, { ordinal: 3 }, { ordinal: 4 }], coverage: BEFORE.coverage, actions: BEFORE.actions,
  markAssessment: BEFORE.mark_assessment };
const NARRATIVE = { verdict: "Proceed with care.", coverage: { read: "" }, spine: "The spine.", calibration: "", ask_answers: [] };

test("findings are addressed by ordinal across the record before and after a correction", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER] });
  assert.deepEqual(list.ordinals, [1, 2, 3, 4], "a finding the correction removed, or added, must stay nameable");
  assert.equal(list.schema, 1);
});

test("each other part is addressed by the key a correction already gives it, and only parts with content", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
  assert.deepEqual(list.lines, [
    { address: "coverage:european union", label: 'the coverage line for "European Union"' },
    { address: "coverage:united kingdom", label: 'the coverage line for "United Kingdom"' },
    { address: "action:watch", label: 'the action "watch"' },
    { address: "mark-assessment:distinctiveness", label: "the mark assessment's distinctiveness" },
    { address: "section:verdict", label: "the narrative's verdict section" },
    { address: "section:spine", label: "the narrative's spine section" },
  ], "an empty mark assessment read or narrative section has nothing for a flag to be about");
});

test("a key two rows of one record share is not offered, and a row with no area or id is not addressed", () => {
  const doc = { findings: [], coverage: [{ area: "Japan" }, { area: "japan." }, { area: "" }], actions: [{ text: "No id." }] };
  const list = reviewAddresses({ records: [doc] });
  assert.deepEqual(list.lines, [], "two rows that one address would name, and rows with no identity, are left out");
  const sameRowTwice = reviewAddresses({ records: [{ coverage: [{ area: "Japan" }] }, { coverage: [{ area: "Japan" }] }] });
  assert.deepEqual(sameRowTwice.lines.map((l) => l.address), ["coverage:japan"], "the same row before and after is one part");
});

test("what a flag declares resolves against the list, or the first thing that does not is named", () => {
  const list = reviewAddresses({ records: [BEFORE, AFTER], narratives: [NARRATIVE] });
  assert.deepEqual(resolveDeclared(list, { on: [2, 4], lines: ["coverage:european union", "section:verdict"] }), { ok: true });
  assert.deepEqual(resolveDeclared(list, {}), { ok: true }, "a flag about the document as a whole declares nothing");
  assert.deepEqual(resolveDeclared(list, { on: [1, 9] }), { ok: false, kind: "ordinal", value: 9 });
  assert.deepEqual(resolveDeclared(list, { lines: "coverage:european union" }), { ok: false, kind: "lines-shape" });
  assert.deepEqual(resolveDeclared(list, { lines: [7] }), { ok: false, kind: "lines-shape" });
  assert.deepEqual(resolveDeclared(list, { lines: ["Coverage:European  Union"] }),
    { ok: false, kind: "line", value: "Coverage:European  Union", near: "coverage:european union" });
  assert.deepEqual(resolveDeclared(list, { lines: ["section:calibration"] }),
    { ok: false, kind: "line", value: "section:calibration", near: null }, "an empty section was not handed to the review");
});
