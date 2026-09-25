// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWER'S OPEN POINTS REACH THE REVIEWING LAWYER, NEVER A CLIENT.
//
// Owner ruling 2026-09-24: reviewer notes never reach the client page. They are for the reviewing lawyer,
// who reads them in the run's email review headline. That email goes to the job's forwarder, and on a
// client-started run the forwarder IS the client, so there the points stay in the run record alone. The
// audit workbook is out entirely: its link rides the same email and a client can download it.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { buildReviewerOpenPointsSection } from "../pipeline.mjs";
import { REVIEWER_OPEN_QUESTIONS_FILE, reviewerOpenPointsForEmail } from "../reviewer-open-points.mjs";
import { composeEmailHtml } from "../publish/index.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const REVIEW = ["BLOCKING", "", "## Flags", "",
  "1. [kind: fact] [on: 3] the summary says the phonetic axis ran; the receipt shows it never did"].join("\n");

function runWithRecord() {
  const dir = mkdtempSync(join(tmpdir(), "open-points-email-"));
  const file = driverDir(dir, REVIEWER_OPEN_QUESTIONS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${buildReviewerOpenPointsSection(REVIEW)}\n`);
  return dir;
}

test("a firm-started run hands the recorded open points to its email", () => {
  const dir = runWithRecord();
  try {
    const md = reviewerOpenPointsForEmail({ clientPrincipal: false }, dir);
    assert.match(md, /Reviewer's open questions/);
    assert.match(md, /the phonetic axis ran; the receipt shows it never did/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a client-started run hands its email nothing: that email goes to the client", () => {
  const dir = runWithRecord();
  try { assert.equal(reviewerOpenPointsForEmail({ clientPrincipal: true }, dir), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no record, nothing handed over", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-points-email-"));
  try { assert.equal(reviewerOpenPointsForEmail({}, dir), null); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the email's review headline carries the points it is handed, and nothing when handed none", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-points-email-"));
  try {
    const report = join(dir, "report.md");
    writeFileSync(report, "---\noverall_label: MEDIUM\noverall_caption: x\n---\n\n# Summary\n\nThe bottom line.\n");
    const md = buildReviewerOpenPointsSection(REVIEW);
    const withPoints = composeEmailHtml(report, "https://example.invalid/r", null, [], undefined, { reviewerOpenPointsMd: md });
    assert.match(withPoints, /Reviewer(&#39;|')s open questions/);
    assert.match(withPoints, /did not sign this report off/);
    assert.match(withPoints, /the phonetic axis ran; the receipt shows it never did/);
    assert.doesNotMatch(withPoints, /###/, "a markdown heading marker reached the email");
    const without = composeEmailHtml(report, "https://example.invalid/r", null, [], undefined, {});
    assert.doesNotMatch(without, /Reviewer(&#39;|')s open questions|did not sign this report off/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the drafting manual asks for no reviewer's section on the report, and says where the points are kept", () => {
  const md = readFileSync(new URL("../skills/clearance-search/SKILL.md", import.meta.url), "utf8");
  assert.ok(md.includes("### Deliverable 2: Excel workbook"), "guard: the drafting manual was read");
  assert.doesNotMatch(md, /Reviewer's open questions/, "a drafting model told to print the section would write it itself");
  assert.ok(md.includes("the report is delivered and those concerns stay in the run record for the reviewing lawyer."));
  assert.ok(md.includes("The reviewing lawyer always sees the review (CLEAR / CONDITIONAL / BLOCKING) on the audit notification, so the reviewer can decide whether the read was right."));
});

test("the delivery contract no longer says the driver puts the reviewer's points at the top of the report", () => {
  const md = readFileSync(new URL("../skills/clearance-search/delivery-contract.md", import.meta.url), "utf8");
  assert.ok(md.includes("## House prose contract"), "guard: the delivery contract was read");
  assert.doesNotMatch(md, /TOP OF THE BODY|buildReviewerOpenPointsSection/, "a note describing a section the driver no longer builds");
});
