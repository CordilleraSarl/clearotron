// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the disciplines EVERY depth rung obeys, applied to every rung there is.
//
// The ladder adds one "tell the stage what kind of report it is writing" directive per graded stage.
// They share four rules, and a rung that quietly breaks one produces no error and no red — only a
// report that is thinner than it should be, or a stage that grades when it should not.
//
// THE RUNGS ARE DISCOVERED, NOT LISTED. A rung added to stages.mjs and forgotten here would inherit no
// guard at all, which is the failure exists to catch, arriving through a door its members do not
// watch. The set is asserted non-empty and against a floor, so a rename that empties the discovery
// reports a broken instrument rather than a clean suite.

import { test } from "node:test";
import { driverSource } from "./driver-source.mjs";
import assert from "node:assert/strict";
import * as stages from "../stages.mjs";
import { PRODUCT_POLICIES } from "../search-policy.mjs";

/** Every exported `<something>RungDirective` — the ladder's directive family, found rather than typed. */
const RUNGS = Object.entries(stages)
  .filter(([name, v]) => /RungDirective$/.test(name) && typeof v === "function")
  .map(([name, fn]) => ({ name, fn }));

// Which findings get a grounded profile is not a rung: the band is on findings.json before that stage runs, so the driver lists
// the ordinals (`profile-selection.mjs`), and the arm at the end of this file asserts that selection is wired. The narrative's
// per-finding prose rules left the synthesis dispatch with no replacement (design, 2026-11-06).

/** The depth field each rung reads, derived from its own name: inquiryRungDirective → inquiryTrace. */
const FIELD_OF = {
  inquiryRungDirective: "inquiryTrace",
  skepticRungDirective: "skepticFlagging",
  variantRungDirective: "variantManifest",
};

/** Every value any product's table actually uses for that field, plus the ways a value can be absent. */
const valuesFor = (field) => [
  ...new Set(Object.values(PRODUCT_POLICIES).map((p) => p.depth?.[field]).filter(Boolean)),
];

test("every rung is CALLED by a stage — a defined-but-unwired rung grades nothing, silently", () => {
  // THE DECLARATIONS COME OUT FIRST. Scanning the raw source counted `export function xRungDirective(depth)`
  // as a call, so every rung "passed" on its own definition and the arm could not go red at all — caught by
  // unwiring a live rung and watching this stay green.
  const src = driverSource("stages.mjs")
    .split("\n").filter((l) => !/^export function \w+RungDirective\(/.test(l)).join("\n");
  for (const { name } of RUNGS) {
    // `(depth` NOT `(depth)`: a rung that grew a second argument — the prose rung takes the run's band
    // order now — is still called, and an exact-paren match would report it unwired. That reads as the
    // vacuous pass this arm exists to catch, in the opposite direction.
    const calls = [...src.matchAll(new RegExp(`\\b${name}\\(depth\\b`, "g"))].length;
    assert.ok(calls >= 1,
      `${name} is exported and guarded by every arm in this file, and NO stage calls it. Its product `
      + "would run at one-country depth while the table says otherwise — the ladder's own vacuous pass.");
  }
});

test("the rung family is DISCOVERABLE and non-empty — a zero here is a broken instrument", () => {
  assert.ok(RUNGS.length >= 3,
    `found ${RUNGS.length} rung directive(s) in stages.mjs. Three rungs ship today (the profile rung became driver selection, `
    + "and the prose rung left the synthesis dispatch); a collapse below that means "
    + "the naming convention moved and every rung below is now unguarded, not that the ladder got simpler.");
  for (const { name } of RUNGS) {
    assert.ok(FIELD_OF[name],
      `${name} is a rung directive with no depth field mapped here. Add it to FIELD_OF — a rung nobody `
      + "maps is a rung these disciplines silently skip.");
  }
});

test("every rung emits NOTHING for the one-country row — the byte-identical guard, per rung", () => {
  for (const { name, fn } of RUNGS) {
    const oneCountry = PRODUCT_POLICIES["full-country-search"].depth;
    assert.equal(fn(oneCountry), "",
      `${name} emits text for the one-country row. \`lines()\` drops only falsy entries, so this lands in `
      + "product 4's dispatch and the owner's \"do not change product 4\" stops being mechanical.");
  }
});

test("every rung treats an UNRECOGNISED value as ungraded — the failure direction is depth", () => {
  for (const { name, fn } of RUNGS) {
    const field = FIELD_OF[name];
    for (const bad of [undefined, null, {}, { [field]: "typo-not-in-vocab" }, { [field]: "" }]) {
      assert.equal(fn(bad), "",
        `${name} graded on ${JSON.stringify(bad)}. A rung must WHITELIST the values it grades: reading an `
        + "unknown value as 'grade it' means a typo shortens a report, and the only symptom is prose that "
        + "is missing. Being wrong toward depth costs time and nothing else.");
    }
  }
});

test("NO COUNT REACHES ANY GRADED INSTRUCTION — a number turns judgment back into a rule", () => {
  let graded = 0;
  for (const { name, fn } of RUNGS) {
    const field = FIELD_OF[name];
    for (const value of valuesFor(field)) {
      const text = fn({ [field]: value });
      if (!text) continue;
      graded++;
      const digits = text.match(/\d/g) ?? [];
      assert.deepEqual(digits, [],
        `${name}(${value}) contains ${JSON.stringify(digits.join(""))}. The spec forbids a count in the `
        + "wording: an arithmetic cut removes marks rather than prose, and removing non-Latin spellings by "
        + "arithmetic is what #935 was opened for.");
    }
  }
  // A no-count arm that examined zero instructions would pass while the ladder was entirely unwired.
  assert.ok(graded >= 5, `only ${graded} graded instruction(s) were examined — the vocabularies moved`);
});

test("every graded instruction promises what does NOT change, BEFORE it asks for less", () => {
  for (const { name, fn } of RUNGS) {
    const field = FIELD_OF[name];
    for (const value of valuesFor(field)) {
      const text = fn({ [field]: value });
      if (!text) continue;
      assert.match(text, /FIRST, WHAT DOES NOT CHANGE/,
        `${name}(${value}) does not open with what is preserved. A seat can read 'write less' as `
        + "'record less', and the ladder becomes the filter it is defined against.");
      assert.ok(text.indexOf("FIRST, WHAT DOES NOT CHANGE") < text.indexOf("For the rest"),
        `${name}(${value}) asks for less before it says what is preserved — by then the reader has been told`);
    }
  }
});

// The retired sentence, kept verbatim as this arm's control. It shipped in variantRungDirective and a
// seat executed it exactly as written: an entry that stands for a family, naming the family it stands
// for, in a field the compiler dispatches verbatim.
const RETIRED = "For the rest — near-duplicate Latin spellings that no register would separate — one "
  + "entry stands for the family.";
const STAND_IN = /\bone entry (?:stands?|represents?)\b|\bstands? for the\b/i;

test("no rung tells a seat to keep a STAND-IN entry — grading is by omission", () => {
  assert.match(RETIRED, STAND_IN,
    "the detector does not match the sentence that caused the incident, so its silence below means nothing");
  let checked = 0;
  for (const { name, fn } of RUNGS) {
    for (const value of valuesFor(FIELD_OF[name])) {
      const text = fn({ [FIELD_OF[name]]: value });
      if (!text) continue;
      checked++;
      assert.doesNotMatch(text, STAND_IN,
        `${name} tells the seat to keep one entry standing for the ones it dropped. Where the graded `
        + "output is an input a machine dispatches VERBATIM — the variant manifest is — a seat doing that "
        + "faithfully writes the family into the term, and the term becomes a nil search that reads as a "
        + "clean. Grade by omission, and say so.");
    }
  }
  assert.ok(checked >= 5, `only ${checked} graded instruction(s) examined — the vocabularies moved`);
});

test("the grounded-profile selection IS wired — the driver lists the ordinals the retired directive asked the seat for", () => {
  // Driver selection replaced a directive here, and "replaced" and "quietly unwired" look the same to a grep: the product would
  // run ungraded with a tidy explanation for why nothing asks. So the replacement's import and its call are both asserted.
  const src = driverSource("stages.mjs");
  assert.ok(src.includes("./profile-selection.mjs"), "stages.mjs does not import ./profile-selection.mjs");
  assert.match(src, /\bprofileSelectionDirective\(/, "profileSelectionDirective is never called — the product is ungraded");
});
