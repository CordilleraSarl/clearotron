// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWER'S OPEN POINTS STAY IN THE RUN RECORD, AND REACH NO SURFACE THAT IS SENT.
//
// Owner ruling 2026-09-24 took the section off the client's report page and left it on the email, gated on
// whether the run's forwarder was the client. Owner ruling 2026-10-01 removed it from the email too, on
// every run, together with the "[Open question]" rows: the first names our own engine stage as if a human
// declining to sign a report, and the rows are non-critical and confuse. Nothing is reworded and nothing
// replaces them. The facts stay on the run.
//
// WHAT THESE ARMS ASSERT IS ABSENCE, which is the shape that needs its control. An email that renders
// nothing passes an absence assertion for any reason at all — a changed heading, a broken composer, an
// empty report. So each absence arm below is paired with something the same call DOES produce, and the
// record arm asserts the text is still there in full. Absence plus a live control, never absence alone.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildReviewerOpenPointsSection } from "../pipeline.mjs";
import { REVIEWER_OPEN_QUESTIONS_FILE } from "../reviewer-open-points.mjs";
import { composeEmailHtml } from "../publish/index.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import * as openPointsModule from "../reviewer-open-points.mjs";

const REVIEW = ["BLOCKING", "", "## Flags", "",
  "1. [kind: fact] [on: 3] the summary says the phonetic axis ran; the receipt shows it never did"].join("\n");
const SENTENCE = /independent reviewer did not sign this report off/i;
const HEADING = /Reviewer(&#39;|')s open questions/i;

function runWithRecord() {
  const dir = mkdtempSync(join(tmpdir(), "open-points-record-"));
  const file = driverDir(dir, REVIEWER_OPEN_QUESTIONS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${buildReviewerOpenPointsSection(REVIEW)}\n`);
  return dir;
}
const reportIn = (dir) => {
  const report = join(dir, "report.md");
  // The caption is the control anchor, not the Summary prose: the cover carries the risk label, the
  // caption and the report link, and does NOT reprint the report's own summary text. Anchoring a control
  // on prose the cover never carries would have failed for the wrong reason — which is what it did.
  writeFileSync(report, "---\noverall_label: MEDIUM\noverall_caption: a caption the cover prints\n---\n\n# Summary\n\nThe bottom line.\n");
  return report;
};

test("the record still carries the section, in full, with its heading and its sentence", () => {
  const dir = runWithRecord();
  try {
    const md = readFileSync(driverDir(dir, REVIEWER_OPEN_QUESTIONS_FILE), "utf8");
    assert.match(md, /Reviewer's open questions/, "the record lost the section the ruling asked us to keep");
    assert.match(md, SENTENCE, "the record lost the sentence — it comes off the surfaces, not off the run");
    assert.match(md, /the phonetic axis ran; the receipt shows it never did/,
      "the reviewer's own words must survive in the record, or the reviewing lawyer has nothing to read");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the email carries neither the heading nor the sentence — and still carries its own content", () => {
  const dir = runWithRecord();
  try {
    const html = composeEmailHtml(reportIn(dir), "https://example.invalid/r", null, [], undefined, {});
    // THE CONTROL, in the same call: an email that composed nothing would pass the two absences below
    // for the wrong reason, so the bottom line and the report link must be there.
    assert.match(html, /a caption the cover prints/, "the email composed nothing, so the absences below prove nothing");
    assert.match(html, /example\.invalid\/r/, "the email lost its report link");
    assert.doesNotMatch(html, HEADING, "the reviewer's section heading is on the email again");
    assert.doesNotMatch(html, SENTENCE, "the sign-off sentence is on the email again");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an email composer handed the record's text anyway does not print it", () => {
  // The hand-off is removed at the call site, and this holds the other half: a caller that passes the
  // old option — a resumed run on an older job shape, or somebody wiring it back — gets nothing.
  const dir = runWithRecord();
  try {
    const md = readFileSync(driverDir(dir, REVIEWER_OPEN_QUESTIONS_FILE), "utf8");
    const html = composeEmailHtml(reportIn(dir), "https://example.invalid/r", null, [], undefined,
      { reviewerOpenPointsMd: md });
    assert.match(html, /a caption the cover prints/, "the email composed nothing — the absences below prove nothing");
    assert.doesNotMatch(html, HEADING, "the composer still renders the option it was handed");
    assert.doesNotMatch(html, SENTENCE);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a report that still carries an authored section does not get it reprinted on the email", () => {
  // The scrape that lifted the block out of the report's own # Summary is gone. An archived report, or a
  // stage that authors a section of that name, must not reach the cover through it.
  const dir = mkdtempSync(join(tmpdir(), "open-points-authored-"));
  try {
    const report = join(dir, "report.md");
    writeFileSync(report, "---\noverall_label: MEDIUM\noverall_caption: a caption the cover prints\n---\n\n# Summary\n\n"
      + "The bottom line.\n\n**Reviewer's open questions**\n\n"
      + "**The independent reviewer did not sign this report off.** A point.\n\nOrdinary prose after it.\n");
    const html = composeEmailHtml(report, "https://example.invalid/r", null, [], undefined, {});
    assert.match(html, /a caption the cover prints/, "the email composed nothing — the absences below prove nothing");
    assert.doesNotMatch(html, HEADING, "an authored section reached the cover through the scrape again");
    assert.doesNotMatch(html, SENTENCE, "the sign-off sentence reached the cover from the report body");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the reader that fed the email is gone, not left exported with no caller", () => {
  // An exported reader with no caller is the shape somebody wires back up, and a function that existed
  // and looked safe to call is how this reached a sent surface in the first place.
  assert.equal(openPointsModule.reviewerOpenPointsForEmail, undefined,
    "the email reader is still exported, so the path can be restored by one line somewhere else");
  assert.equal(typeof openPointsModule.REVIEWER_OPEN_QUESTIONS_FILE, "string",
    "the record's file name must still be owned here, or the writer and the readers can disagree about it");
});

// NOT COVERED HERE: the write site in pipeline.mjs removes a stale record when the reviewer left nothing
// open. No unit in this file reaches that branch. An assertion that the record is absent from a freshly
// created directory held by construction and proved nothing, so this arm claims only what it proves.
test("a signed review with no open flags builds no section", () => {
  assert.equal(buildReviewerOpenPointsSection(["SIGNED", "", "## Flags", ""].join("\n")), "",
    "a signed review with no open flags must build no section at all");
});
