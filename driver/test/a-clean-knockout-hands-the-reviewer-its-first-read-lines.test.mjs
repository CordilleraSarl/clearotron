// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY KNOCKOUT IS REVIEWED: A CLEAN RECORD HANDS THE REVIEWER ITS FIRST-READ LINES.
//
// The owner's ruling of 2026-10-10: the knockout reviewer runs on every knockout, leading with the
// client's question. On a record the driver's read flags nowhere, the reviewer used to be skipped, and
// dispatching it unchanged would have left it nothing to act on: it may rewrite or decline only at an
// address it was handed, and the clean branch handed none. So a clean record now hands over the lines a
// reader meets first, each with its address, and these arms hold that: the clean record is dispatched,
// with every first-read line and no measured table; each address it offers is one the gate accepts; a
// flagged record is dispatched exactly as before; and a record with no such line is not dispatched.
//
// The clean record is the shipped demo knockout, a real delivered run whose wording the read flags
// nowhere. The flagged one is the delivered specimen the reviewing pass's own arms read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knockoutVisibleProse } from "../predelivery-lint.mjs";
import { reviewDispatch, reviewFirstReadRows, reviewEvidence, reviewAbout, offeredAddress, validateKnockoutReviewFile, ADDRESSABLE } from "../knockout-review-record.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const CLEAN = () => read("../../demo/knockout-search/run/knockout-findings.json");
const FLAGGED = () => read("./fixtures/delivered-knockout/run/knockout-findings.json");
const CLEAN_BRANCH = "THE DRIVER'S READ FLAGGED NO LINE ON THIS RECORD, so nothing below is evidence of a fault. "
  + "These are the lines a reader meets first, each with the ADDRESS that names it.";
const MEASURED = "THE DRIVER MEASURED THESE LINES.";
const message = (msgCtx) => KO_STAGES["knockout-review"].message({ K: { findings: "/run/knockout-findings.json" }, ...msgCtx });

test("a record the read flags nowhere is still reviewed, and handed every line a reader meets first", () => {
  const record = CLEAN();
  const d = reviewDispatch(record, null);
  assert.equal(d.flagged, 0, "precondition: the shipped demo knockout reads clean");
  assert.equal(d.dispatch, true, "a clean knockout is not reviewed");
  const writable = knockoutVisibleProse(record).filter(({ at }) => !at?.engineOwned && Object.hasOwn(ADDRESSABLE, at?.field));
  assert.ok(writable.length > 0, "the demo record has no line the pass may write");
  assert.equal(d.listed, writable.length);
  assert.deepEqual(d.msgCtx.evidenceLines, []);
  assert.equal(d.msgCtx.firstReadLines.length, writable.length);
  for (const [i, { at, where }] of writable.entries()) {
    assert.equal(d.msgCtx.firstReadLines[i], `- ${where} — address ${JSON.stringify(offeredAddress(at))}`);
  }
  assert.ok(!d.msgCtx.firstReadLines.some((l) => l.includes("engineOwned")), "an address carries a key the grammar refuses");
});

test("the clean dispatch leads with the client's question, then the lines, and claims no measurement", () => {
  const d = reviewDispatch(CLEAN(), null);
  const msg = message(d.msgCtx);
  const first = msg.split("\n").find((l) => l.trim());
  assert.match(first, /^Does the report answer the client's question/);
  assert.ok(msg.includes(CLEAN_BRANCH), "the clean branch's sentence is not the one the owner read");
  assert.ok(!msg.includes(MEASURED), "a clean record is told its lines were measured");
  assert.ok(!msg.includes("there is no table below"), "the old branch, which handed no address, is still there");
  for (const line of d.msgCtx.firstReadLines) assert.ok(msg.includes(line), `a first-read line is missing: ${line}`);
});

test("every address the clean dispatch offers is one the gate accepts", () => {
  const record = CLEAN();
  const dir = mkdtempSync(join(tmpdir(), "ko-clean-review-"));
  try {
    writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify(record));
    for (const { at } of reviewFirstReadRows(record)) {
      const file = join(dir, "review.json");
      const text = JSON.stringify({ schema_version: 1, first_question: "Yes.", declined: [{ at, why: "it already answers the client's question plainly" }] });
      writeFileSync(file, text);
      const v = validateKnockoutReviewFile(file, text);
      assert.equal(v.ok, true, `the gate refuses an offered address ${JSON.stringify(at)}: ${v.reason}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an address the flagged table offers, a rater's caveat included, is accepted when copied verbatim", () => {
  // The flagged path's own copy of the defect: a rater's standing caveat was offered with the walk's
  // `engineOwned` mark in its address, and the grammar refuses that key. Copied as the tool says, refused.
  const record = FLAGGED();
  record.batch.standardCaveats.push("This sentence is deliberately written to run well past the limit a default-visible line "
    + "is allowed to carry so that the deterministic read has something it must flag on the surface being planted into.");
  const rows = reviewEvidence(record, reviewAbout(record, null)).rows;
  assert.ok(rows.some((r) => r.at.field === "batch.standardCaveats"), "precondition: a rater's caveat is flagged");
  const dir = mkdtempSync(join(tmpdir(), "ko-flagged-review-"));
  try {
    writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify(record));
    for (const { at } of rows) {
      const file = join(dir, "review.json");
      const text = JSON.stringify({ schema_version: 1, declined: [{ at: JSON.parse(JSON.stringify(at)), why: "kept" }] });
      writeFileSync(file, text);
      const v = validateKnockoutReviewFile(file, text);
      assert.equal(v.ok, true, `the gate refuses an offered address ${JSON.stringify(at)}: ${v.reason}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a flagged record is dispatched with its measured table, as before, and no first-read listing", () => {
  const d = reviewDispatch(FLAGGED(), null);
  assert.ok(d.flagged > 0, "precondition: the delivered specimen carries flagged lines");
  assert.equal(d.dispatch, true);
  assert.equal(d.listed, 0);
  assert.deepEqual(d.msgCtx.firstReadLines, []);
  const msg = message(d.msgCtx);
  assert.ok(msg.includes(MEASURED));
  assert.ok(!msg.includes(CLEAN_BRANCH));
});

test("a record with no line a reader meets first is not dispatched", () => {
  const d = reviewDispatch({ batch: {}, marks: [] }, null);
  assert.equal(d.dispatch, false);
  assert.equal(d.flagged, 0);
  assert.equal(d.listed, 0);
});
