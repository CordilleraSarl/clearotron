// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DELIVERED MARKDOWN LISTS WHAT WAS LEFT OPEN. The connector serves report.md when a reader's assistant asks for the
// report, and report.md had no "Left open": an earlier right that could not be rated, or a script no search completed
// in, reached the assistant only through a second tool. These read the section the Markdown now carries, from rows
// of the shape the page draws: the right named with the approved sentence word for word, the script gap with its
// scope, the page's state words and counts, a note the Markdown already states not said twice, and no heading when
// nothing is open. Every name is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leftOpenMarkdown } from "../left-open-md.mjs";
import { withdrawnRatingRows, WITHDRAWN_RATING_NOTES } from "../withdrawn-rating.mjs";
import { parseFront, parseSections } from "../publish/parse.mjs";

const RECORD = { findings: [
  { ordinal: 1, mark: "QUILLMERE", owner: "Brightmoor Ltd", disposition: "rated" },
  { ordinal: 2, mark: "TARNOVEL", owner: "Holloway GmbH", disposition: "withdrawn", rating_withdrawn_ground: "goods-wording-unavailable" },
] };
const SCRIPT_GAP = { area: "Local-script spellings", state: "not-searched", note: "No search in Han or Hangul script was completed." };
const LIMITED = { area: "common-law / marketplaces", state: "coverage-limited", note: "Two of the four marketplaces answered; the other two returned no listing pages this run." };

test("an earlier right whose rating was withdrawn is named under Left open with the approved sentence, word for word", () => {
  const md = leftOpenMarkdown([...withdrawnRatingRows(RECORD), SCRIPT_GAP]);
  assert.match(md, /^# Left open$/m);
  assert.ok(md.includes(WITHDRAWN_RATING_NOTES["goods-wording-unavailable"]), "the approved sentence is not in the section verbatim");
  assert.match(md, /TARNOVEL/, "the right is not named");
  assert.doesNotMatch(md, /QUILLMERE/, "a rated right was listed as left open");
});

test("a script no search completed in is listed with its scope, under the page's state word and count", () => {
  const md = leftOpenMarkdown([SCRIPT_GAP, LIMITED]);
  assert.match(md, /^\*\*Partially covered \(1\)\*\*$/m);
  assert.match(md, /^\*\*Not searched \(1\)\*\*$/m);
  assert.match(md, /^- \*\*Local-script spellings\*\*: No search in Han or Hangul script was completed\.$/m);
  assert.ok(md.indexOf("Partially covered") < md.indexOf("Not searched"), "the groups are not in the page's state order");
});

test("nothing open draws no heading, and a clean row is never listed", () => {
  assert.equal(leftOpenMarkdown([]), "");
  assert.equal(leftOpenMarkdown(null), "");
  assert.equal(leftOpenMarkdown([{ area: "Register / EU", state: "confirmed-clean", note: "Searched, nothing found." }]), "");
});

test("a note the Markdown already states, and a row given twice, are said once", () => {
  const already = `# Actions\n\n### Only you can close these\n\n- ${LIMITED.note}\n`;
  const md = leftOpenMarkdown([LIMITED, SCRIPT_GAP, SCRIPT_GAP], { already });
  assert.doesNotMatch(md, /Partially covered/, "a note the report already states was repeated");
  assert.equal(md.split(SCRIPT_GAP.note).length - 1, 1, "a row given twice was listed twice");
});

test("where the assessment did not complete, rows that share a note print it once with their areas under it", () => {
  const note = "The assessment did not complete, so this search's results were not read.";
  const md = leftOpenMarkdown([{ area: "Register / EU", state: "open", note }, { area: "Register / UK", state: "open", note }], { verdict: false });
  assert.equal(md.split(note).length - 1, 1);
  assert.match(md, /^ {2}- Register \/ EU$/m);
  assert.match(md, /^ {2}- Register \/ UK$/m);
});

test("the section is a top-level section the report parser keeps apart from the cards", () => {
  const md = leftOpenMarkdown([SCRIPT_GAP]);
  const report = `---\ntitle: QUILLMERE\n---\n\n# Actions\n\n### Checks we ran — what we found\n\n- A check.\n\n${md}\n\n# Marks\n\n## Brightmoor Ltd — QUILLMERE\n`;
  const secs = parseSections(parseFront(report).body);
  assert.deepEqual(Object.keys(secs), ["Actions", "Left open", "Marks"]);
  assert.doesNotMatch(secs.Actions, /Local-script/, "the section ran into Actions");
});
