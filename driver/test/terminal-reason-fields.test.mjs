// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — status.json must contain the terminal cause, because the taxonomy sends readers there.
//
// THE INCIDENT (round finding F5, 2026-08-12). A run died at fan-in and status.json's reason read:
//
//   "…1 dictated qid(s) own no band block: incumbent-class:owner:… ← provider error on the count probe
//    (after one in-tool retry): "
//
// — ending on the colon. The runner journal had the rest: `HTTP 400: APPLICANT_NAME - The system did
// not recognize the syntax`. The 200-char cap on `reason` (it rides the ping) fell exactly where the
// provider's verbatim error begins.
//
// The cost was not inconvenience. The night manager read the empty tail as the cause being ABSENT and
// filed a finding about an empty error string classifying as `deterministic` — then had to correct it.
// An absence read as a finding, which is the class this codebase keeps paying for.
//
// Run:  node --test driver/test/terminal-reason-fields.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { terminalReasonFields } from "../pipeline.mjs";

// The real string, at the length that produced the incident: the cause sits past the 200-char cap.
const FAN_IN_REASON =
  "register plan unexecuted after direct dispatch + followup — 1 dictated qid(s) own no band block: "
  + "incumbent-class:owner:sky-limited+watch ← provider error on the count probe (after one in-tool retry): "
  + "HTTP 400: APPLICANT_NAME - The system did not recognize the syntax of the request "
  + "(a clean can never ship over a slice the plan dictated and nothing ran)";

test("#755 the provider's cause survives to status.json, not only to the journal", () => {
  const f = terminalReasonFields(FAN_IN_REASON);
  assert.ok(FAN_IN_REASON.length > 200, "fixture must actually exceed the cap, or this proves nothing");
  assert.equal(f.reason.length, 200, "the ping-sized field is unchanged — it is load-bearing at 200");
  assert.doesNotMatch(f.reason, /APPLICANT_NAME/, "…and still cuts the cause away, which is why the tail is needed");

  assert.equal(f.reasonTruncated, true, "the cut is stated, not left to be inferred from a length");
  assert.match(f.reasonFull, /HTTP 400: APPLICANT_NAME/,
    "the cause reaches the field the taxonomy names — this is the whole issue");
  assert.match(f.reasonFull, /did not recognize the syntax/, "verbatim, not a paraphrase");
});

test("#755 an untruncated reason says so — an absence must not read as an empty cause", () => {
  // The half that stops this fix from creating the defect it fixes. If `reasonFull` were simply omitted
  // when short, a reader could not tell "nothing was cut" from "the tail is missing", which is exactly
  // the ambiguity that produced F5's wrong finding.
  const f = terminalReasonFields("stage timed out after 1500s");
  assert.equal(f.reason, "stage timed out after 1500s");
  assert.equal(f.reasonTruncated, false, "present and false, never absent");
  assert.equal(f.reasonFull, null, "null because nothing was cut — and reasonTruncated is what says so");
});

test("#755 an empty cause is empty, and is still not silence", () => {
  for (const empty of [null, undefined, "", "   "]) {
    const f = terminalReasonFields(empty);
    assert.equal(f.reason, "", `an absent reason stays absent (${JSON.stringify(empty)})`);
    assert.equal(f.reasonTruncated, false, "nothing was cut, because there was nothing to cut");
    assert.equal(f.reasonFull, null);
  }
});

test("#755 whitespace is collapsed identically in both fields — they cannot disagree", () => {
  // reason and reasonFull are derived from ONE normalisation. Two normalisations is how a short field and
  // a long field come to describe the same failure differently.
  const messy = `line one\n\n   line two\ttabbed   ${"x".repeat(300)}`;
  const f = terminalReasonFields(messy);
  // gave `reason` the same "…" marker `reasonFull` has carried since (see the bounded-tail
  // test below), so the prefix is now the short field MINUS its marker. The property this test exists
  // for is untouched — one normalisation, two fields — and it is asserted harder: the marker is the
  // only character by which the two may differ.
  assert.ok(f.reason.endsWith("…"), "a cut short field says so, exactly as the cut full field does");
  assert.ok(f.reasonFull.startsWith(f.reason.slice(0, -1)),
    "the short field is the full one's opening, character for character");
  assert.doesNotMatch(f.reasonFull, /\n|\t|  /, "collapsed once, for both");
});

test("#755 the tail is BOUNDED — a runaway reason cannot make status.json unreadable", () => {
  const huge = "A".repeat(50_000);
  const f = terminalReasonFields(huge);
  assert.ok(f.reasonFull.length <= 4000, `bounded (got ${f.reasonFull.length})`);
  assert.ok(f.reasonFull.endsWith("…"), "and says it was cut, rather than ending mid-string like the defect did");
});
