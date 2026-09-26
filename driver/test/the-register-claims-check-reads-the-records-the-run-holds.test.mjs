// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REGISTER-CLAIMS CHECK IS BOUND BY WHAT THE RUN HOLDS, NOT BY A CONSTANT.
//
// `register-claims-within-counts` was written when the knockout lane held two totals per mark and no
// records at all, so "count language only" was the honest bound. The lane now lists filings — two runs
// on 2026-09-26 carried 59 and 29 records against 0 in the counts file — and the check was refusing a
// sentence that read a status off a filing the run had actually fetched. That pushes the rater toward
// saying LESS about a record it holds, which is the opposite of what this family of checks is for.
//
// So the bound is now: no claim wider than the records the run holds. A status about one filing is
// supported where records exist; a claim about the FIELD is not, however many records there are.
//
// EVERY ARM HAS ITS CONTROL, and here the control is the one that matters: a check loosened until it
// stops failing anything is indistinguishable from a check that was deleted. So each arm that asserts a
// sentence now PASSES is paired with one asserting a sentence the records still cannot support FAILS,
// on the same fixture and the same record count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { evalAssertion } from "../../scripts/e2e.mjs";

/** A knockout run directory carrying a findings document and a stated number of register records. */
function makeRun({ text, records }) {
  const dir = mkdtempSync(join(tmpdir(), "regclaims-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "search-policy.json"), JSON.stringify({ pipeline: "knockout" }));
  if (records !== null) {
    // Shaped like the real file: records hang off marks, and the op counts across them.
    const marks = [{ name: "E2E CLAIMS PROBE", records: Array.from({ length: records }, (_, i) => ({ recordId: `R${i}` })) }];
    writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify({ marks }));
  }
  writeFileSync(join(dir, "knockout-findings.md"), text);
  return dir;
}

const check = (opts) => {
  const dir = makeRun(opts);
  try {
    return evalAssertion({ op: "register-claims-within-counts", path: "knockout-findings.md" }, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

// ── a status read off a filing the run holds ─────────────────────────────────────────────────────────

test("a status about one filing PASSES where the run holds records", () => {
  // The two sentences that failed on a real run. Neither says anything about the register as a field.
  for (const text of [
    "The US application was abandoned, so it gives no registered right.",
    "This US Class 28 registration is cancelled, so it gives no registered right.",
  ]) {
    const r = check({ text, records: 59 });
    assert.equal(r.ok, true, `a supported status was refused: ${r.saw}`);
  }
});

test("CONTROL: the same sentence still FAILS where the run holds no records", () => {
  // Without this arm the change would read as "that sentence is always fine", which is not the rule.
  // With nothing fetched, a singular absence has nothing to be a status OF.
  const r = check({ text: "There is no registration for this name.", records: 0 });
  assert.equal(r.ok, false, "with no records held, a singular absence is still a claim about the field");
  assert.match(r.saw, /wider than the records/);
});

// ── a claim about the FIELD, which records never make sayable ────────────────────────────────────────

test("CONTROL: a field claim FAILS even with records in hand — 59 filings is not an enumeration", () => {
  for (const text of [
    "The register is crowded for this term.",
    "The mark is clear on the register.",
    "There is nothing on the register for this name.",
    "The register search found no conflicting marks.",
    "There are no registrations for this name in any class.",
    "No registered marks were identified.",
  ]) {
    const r = check({ text, records: 59 });
    assert.equal(r.ok, false, `a field claim passed on the strength of held records: "${text}" — ${r.saw}`);
  }
});

test("a plural sweep and a singular status are told apart, on the same fixture", () => {
  // The whole narrowing in one pair: the noun's number is what separates a sweep from a status.
  assert.equal(check({ text: "It gives no registered right.", records: 12 }).ok, true);
  assert.equal(check({ text: "There are no registered rights in this class.", records: 12 }).ok, false);
});

// ── the records file itself ──────────────────────────────────────────────────────────────────────────

test("an ABSENT records file is as strict as a zero one, and says which it was", () => {
  // These two are BEHAVIOURALLY IDENTICAL — records loosen this bound and zero is its strictest state,
  // so neither allows anything the other does. The distinction is kept for the sentence, not the
  // verdict: "the run held nothing" is a fact about the search, "the file would not open" is a fact
  // about this check's own evidence, and only one of them sends a reader to look at the run.
  const absent = check({ text: "There is no registration for this name.", records: null });
  const zero = check({ text: "There is no registration for this name.", records: 0 });
  assert.equal(absent.ok, false);
  assert.equal(zero.ok, false);
  assert.equal(absent.ok, zero.ok, "identical verdicts — the split buys the basis line, nothing else");
  assert.match(absent.saw, /absent or unreadable/, "and the two are told apart in words");
  assert.match(zero.saw, /holds 0 register record/);
  assert.notEqual(absent.saw, zero.saw);
});

test("the answer says which basis it judged on, either way", () => {
  // A reader who sees a pass must be able to tell "supported by 59 records" from "nothing to object to".
  const pass = check({ text: "It gives no registered right.", records: 59 });
  assert.match(pass.saw, /holds 59 register record/);
  const fail = check({ text: "The register is crowded.", records: 59 });
  assert.match(fail.saw, /holds 59 register record/);
});

// ── what the change must not have loosened ───────────────────────────────────────────────────────────

test("a labelled expectation still passes, and an unlabelled sweep still does not", () => {
  assert.equal(check({ text: "We expect around 40 filings on the register for this term.", records: 0 }).ok, true);
  assert.equal(check({ text: "There are no filings on the register for this term.", records: 0 }).ok, false);
});

test("a sentence that says nothing about the register is not in scope at all", () => {
  const r = check({ text: "The fan wiki entry is the strongest common-law use found.", records: 0 });
  assert.equal(r.ok, true);
});

test("the op still declines a lane that is not the knockout, and says so rather than passing", () => {
  const dir = mkdtempSync(join(tmpdir(), "regclaims-lane-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "search-policy.json"), JSON.stringify({ pipeline: "clearance" }));
  writeFileSync(join(dir, "knockout-findings.md"), "The register is crowded.");
  try {
    const r = evalAssertion({ op: "register-claims-within-counts", path: "knockout-findings.md" }, dir);
    assert.equal(r.notProbed, true, "a lane this op does not bound is NOT PROBED, never a pass");
    assert.match(r.saw, /NOT PROBED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unreadable search policy is still a finding", () => {
  const dir = mkdtempSync(join(tmpdir(), "regclaims-policy-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "knockout-findings.md"), "anything");
  try {
    const r = evalAssertion({ op: "register-claims-within-counts", path: "knockout-findings.md" }, dir);
    assert.equal(r.ok, false, "an unreadable configuration is a finding, not a pass");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
