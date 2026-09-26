// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PARTS READ AT PUBLISH ARE NAMED, AND THE LIST OF STORES IS CLOSED (ruled 2026-09-25). A part of a
// report can be lost where only the publisher sees it: a store present and unreadable, or one a republish
// finds missing after delivery read it. Each store the publisher reads is the part it feeds, named with a
// label the report or workbook already prints or with the owner's words, or it is declared out with its
// reason. These arms hold the table closed, the names to their sources, and each reading to its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { PUBLISH_INPUTS } from "../publish/publish-inputs.mjs";
import {
  STORE_PARTS, STORES_WITHOUT_A_PART, PART_NAMES, RULED_WORDS, NOT_COMPLETED, linkNotOnRegisterSite,
  storeStates, degradedAtPublish, readDeliveredStores, writeDegradedParts, mergeDegradedRows, degradedParts,
  knockoutStepFailures, recordsState,
} from "../degraded-parts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(HERE, "..", p), "utf8");

function runDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "parts-at-publish-"));
  mkdirSync(driverDir(dir), { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const log = (dir, ...events) => writeFileSync(driverDir(dir, "run.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");

test("every store the publisher reads is either a part or declared out with its reason, never both", () => {
  const stores = Object.keys(PUBLISH_INPUTS).sort();
  const covered = [...Object.keys(STORE_PARTS), ...Object.keys(STORES_WITHOUT_A_PART)].sort();
  assert.deepEqual(covered, stores, "a store the publisher reads has no ruling here, or a ruling names a store it no longer reads");
  for (const [store, key] of Object.entries(STORE_PARTS)) {
    assert.ok(PART_NAMES[key] ?? RULED_WORDS[key], `${store} maps to ${key}, which names nothing`);
  }
  for (const [store, why] of Object.entries(STORES_WITHOUT_A_PART)) assert.ok(why.trim(), `${store} is declared out with no reason`);
});

test("the new names are labels the product already prints", () => {
  assert.ok(src("publish/index.mjs").includes(`area: '${PART_NAMES.conditions}'`), "the gaps sheet's area for a condition");
  assert.ok(src("publish/xlsx.mjs").includes(`'${PART_NAMES.coverage}'`), "the workbook's tab");
  assert.ok(src("publish/render.mjs").includes(`'${PART_NAMES.marketplaceWeb}'`), "the report's search-coverage row");
  assert.ok(src("publish/knockout.mjs").includes(`addSheet(wb, '${PART_NAMES.machineChecks}'`), "the knockout workbook's sheet");
  assert.ok(src("publish/render-knockout.mjs").includes(`>${PART_NAMES.aboutThisRequest}<`), "the knockout report's heading");
});

test("the owner's words are his, verbatim (537 and 539, 2026-09-25)", () => {
  assert.equal(RULED_WORDS.officialRecords, "Official records");
  assert.equal(RULED_WORDS.plainLanguageReview, "Plain-language review");
  assert.equal(RULED_WORDS.recordNotKept, "The record of this search was not kept this run; its answer was used");
  assert.equal(linkNotOnRegisterSite("Signa"), "Address not on this register's own site (Signa); cited by number");
});

test("a store present and unreadable is its part's row; the same store read, or never there, is none", (t) => {
  const dir = runDir(t);
  writeFileSync(driverDir(dir, "verdict.json"), "{not json");
  const parts = degradedAtPublish(storeStates(dir), null);
  assert.deepEqual(parts.map((p) => [p.part, p.name, p.reason]), [["store:_driver/verdict.json", "Conditions", NOT_COMPLETED]]);
  assert.match(parts[0].cause, /present and cannot be read/);
  // THE CONTROLS: the same store readable, and a run that never had it.
  writeFileSync(driverDir(dir, "verdict.json"), JSON.stringify({ tier: "LOW" }));
  assert.deepEqual(degradedAtPublish(storeStates(dir), null), []);
  rmSync(driverDir(dir, "verdict.json"));
  assert.deepEqual(degradedAtPublish(storeStates(dir), null), [], "an absent store with no delivery record is an older run, not a loss");
});

test("a store delivery read and a republish finds missing is its part's row; one delivery never read is none", (t) => {
  const dir = runDir(t);
  writeFileSync(join(dir, "case-law-findings.md"), "## Case-law grounding\n");
  writeDegradedParts(dir, []);
  assert.equal(readDeliveredStores(dir)["case-law-findings.md"], "read", "delivery did not record the store it read");
  rmSync(join(dir, "case-law-findings.md"));
  const parts = degradedAtPublish(storeStates(dir), readDeliveredStores(dir));
  assert.deepEqual(parts.map((p) => [p.part, p.name]), [["store:case-law-findings.md", "Court decisions"]]);
  assert.match(parts[0].cause, /read at delivery and is missing now/);
  // THE CONTROL: absent at delivery and absent now is a store this run never had.
  const other = runDir(t);
  writeDegradedParts(other, []);
  assert.deepEqual(degradedAtPublish(storeStates(other), readDeliveredStores(other)), []);
});

test("the record set is read as a folder: files none of which parse is Official records, one good file is not", (t) => {
  const dir = runDir(t);
  mkdirSync(join(dir, "_records"));
  writeFileSync(join(dir, "_records", "jp-1.json"), "{torn");
  assert.equal(recordsState(dir), "damaged");
  assert.deepEqual(degradedAtPublish(storeStates(dir), null).map((p) => p.name), [RULED_WORDS.officialRecords]);
  writeFileSync(join(dir, "_records", "jp-2.json"), JSON.stringify({ _uri: "/mark/jp/2" }));
  assert.equal(recordsState(dir), "read");
  assert.deepEqual(degradedAtPublish(storeStates(dir), null), []);
});

test("delivery's rows come first and one area is one row", () => {
  const a = { area: "Follow-up / Register", state: "Open", note: "delivery" };
  const b = { area: "Follow-up / Register", state: "Open", note: "publish" };
  const c = { area: "Follow-up / Conditions", state: "Open", note: "publish" };
  assert.deepEqual(mergeDegradedRows([a], [b, c]), [a, c]);
});

test("Official records at delivery: a record set built from a fetch ledger that could not be read", (t) => {
  const dir = runDir(t);
  log(dir, { event: "record-artifacts", count: 0, ledgerError: "Cannot create a string longer than 0x1fffffe8 characters" });
  const parts = degradedParts(dir).filter((p) => p.part === "official-records");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, "Official records");
  // THE CONTROLS: a set that is merely empty is the design on a register whose report cites no record
  // address, and a count of fetches taken before the closure fetch can still be closed by it.
  log(dir, { event: "record-artifacts", count: 0 });
  assert.deepEqual(degradedParts(dir).filter((p) => p.part === "official-records"), []);
  log(dir, { event: "record-artifacts", count: 0, fetchedWithoutRecord: 6 });
  assert.deepEqual(degradedParts(dir).filter((p) => p.part === "official-records"), []);
});

test("the knockout's whole steps: the last word of each is its state at delivery", (t) => {
  const dir = runDir(t);
  log(dir,
    { event: "knockout-register-records-failed", cause: "TypeError: marks is not iterable" },
    { event: "knockout-owner-checks-failed", cause: "ETIMEDOUT: timed out" },
    { event: "knockout-review", outcome: "stage-failed", reason: "exhausted" });
  const s = knockoutStepFailures(dir);
  assert.equal(s.listing.reason, NOT_COMPLETED);
  assert.equal(s.ownerChecks.reason, "mechanical-fail:timeout", "a timeout is the timeout line, not the fallback");
  assert.match(s.review.cause, /^stage-failed/);
  // A resume that succeeded clears each, and the review's two good outcomes are not failures.
  log(dir,
    { event: "knockout-register-records-failed", cause: "x" }, { event: "knockout-register-records", marks: 2 },
    { event: "knockout-owner-checks-failed", cause: "x" }, { event: "knockout-owner-checks", owners: 1, answered: 1, unanswered: 0 },
    { event: "knockout-review", outcome: "nothing-flagged" });
  assert.deepEqual(knockoutStepFailures(dir), { listing: null, ownerChecks: null, review: null });
  // A listing refused for a reason the sidecar states is not a failure here: its own row already says why.
  log(dir, { event: "knockout-register-records-refused", reason: "this register lists no filings" });
  assert.equal(knockoutStepFailures(dir).listing, null);
  for (const outcome of ["artifact-unreadable", "rewrite-refused-by-the-merged-gate"]) {
    log(dir, { event: "knockout-review", outcome });
    assert.ok(knockoutStepFailures(dir).review, `${outcome} ships the rater's wording unreviewed`);
  }
  log(dir, { event: "knockout-review", outcome: "applied" });
  assert.equal(knockoutStepFailures(dir).review, null);
});
