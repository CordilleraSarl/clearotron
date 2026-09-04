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
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as stages from "../stages.mjs";
import { PRODUCT_POLICIES } from "../search-policy.mjs";

/** Every exported `<something>RungDirective` — the ladder's directive family, found rather than typed. */
const RUNGS = Object.entries(stages)
  .filter(([name, v]) => /RungDirective$/.test(name) && typeof v === "function")
  .map(([name, fn]) => ({ name, fn }));

/**
 * Rungs CONVERTED to driver selection, and therefore correctly uncalled.
 *
 * 's architecture prefers driver selection wherever the typed key precedes the dispatch: the
 * driver lists the items and unlisted work is never asked for, which has none of a directive's failure
 * modes. `profileRungDirective` graded grounded profiles by asking the seat to classify findings at
 * review time; the band is on findings.json before that stage runs, so `profile-selection.mjs` lists
 * the ordinals instead.
 *
 * NAMED HERE RATHER THAN REMOVED FROM THE SCAN, because "uncalled" and "converted" look identical to a
 * grep and only one of them is fine. A rung that quietly stops being called is the vacuous pass this
 * file exists to catch; a converted one has a replacement, and the arm at the end asserts it is wired.
 */
const CONVERTED = {
  profileRungDirective: { to: "profileSelectionDirective", from: "./profile-selection.mjs" },
};

/** The depth field each rung reads, derived from its own name: proseRungDirective → narrativeProse. */
const FIELD_OF = {
  proseRungDirective: "narrativeProse",
  inquiryRungDirective: "inquiryTrace",
  skepticRungDirective: "skepticFlagging",
  variantRungDirective: "variantManifest",
  profileRungDirective: "groundedProfiles",
};

/** Every value any product's table actually uses for that field, plus the ways a value can be absent. */
const valuesFor = (field) => [
  ...new Set(Object.values(PRODUCT_POLICIES).map((p) => p.depth?.[field]).filter(Boolean)),
];

test("#1503 every rung is CALLED by a stage — a defined-but-unwired rung grades nothing, silently", () => {
  // THE DECLARATIONS COME OUT FIRST. Scanning the raw source counted `export function xRungDirective(depth)`
  // as a call, so every rung "passed" on its own definition and the arm could not go red at all — caught by
  // unwiring a live rung and watching this stay green.
  const src = readFileSync(new URL("../stages.mjs", import.meta.url), "utf8")
    .split("\n").filter((l) => !/^export function \w+RungDirective\(/.test(l)).join("\n");
  for (const { name } of RUNGS) {
    if (CONVERTED[name]) continue;   // asserted by the arm at the end of this file instead
    // `(depth` NOT `(depth)`: a rung that grew a second argument — the prose rung takes the run's band
    // order now — is still called, and an exact-paren match would report it unwired. That reads as the
    // vacuous pass this arm exists to catch, in the opposite direction.
    const calls = [...src.matchAll(new RegExp(`\\b${name}\\(depth\\b`, "g"))].length;
    assert.ok(calls >= 1,
      `${name} is exported and guarded by every arm in this file, and NO stage calls it. Its product `
      + "would run at one-country depth while the table says otherwise — the ladder's own vacuous pass.");
  }
});

test("#1503 the rung family is DISCOVERABLE and non-empty — a zero here is a broken instrument", () => {
  assert.ok(RUNGS.length >= 5,
    `found ${RUNGS.length} rung directive(s) in stages.mjs. Five rungs ship today; a collapse means `
    + "the naming convention moved and every rung below is now unguarded, not that the ladder got simpler.");
  for (const { name } of RUNGS) {
    assert.ok(FIELD_OF[name],
      `${name} is a rung directive with no depth field mapped here. Add it to FIELD_OF — a rung nobody `
      + "maps is a rung these disciplines silently skip.");
  }
});

test("#1503 every rung emits NOTHING for the one-country row — the byte-identical guard, per rung", () => {
  for (const { name, fn } of RUNGS) {
    const oneCountry = PRODUCT_POLICIES["full-country-search"].depth;
    assert.equal(fn(oneCountry), "",
      `${name} emits text for the one-country row. \`lines()\` drops only falsy entries, so this lands in `
      + "product 4's dispatch and the owner's \"do not change product 4\" stops being mechanical.");
  }
});

test("#1503 every rung treats an UNRECOGNISED value as ungraded — the failure direction is depth", () => {
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

test("#1503 NO COUNT REACHES ANY GRADED INSTRUCTION — a number turns judgment back into a rule", () => {
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

test("#1503 every graded instruction promises what does NOT change, BEFORE it asks for less", () => {
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

test("#1503 no rung tells a seat to keep a STAND-IN entry — grading is by omission", () => {
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

test("#1503 a CONVERTED rung's replacement IS wired — 'uncalled' and 'converted' look the same to a grep", () => {
  // The other half of the skip above. Skipping a converted rung there is only safe if something asserts
  // its replacement actually reached a dispatch — otherwise "we converted it" is a comment, and the
  // product runs ungraded with a tidy explanation for why nothing calls the old function.
  const src = readFileSync(new URL("../stages.mjs", import.meta.url), "utf8");
  assert.ok(Object.keys(CONVERTED).length, "nothing is marked converted — this arm reads nothing");
  for (const [name, { to, from }] of Object.entries(CONVERTED)) {
    assert.ok(src.includes(from), `${name} is marked converted to ${to}, and stages.mjs does not import ${from}`);
    assert.match(src, new RegExp(`\\b${to}\\(`),
      `${name} is marked converted and its replacement ${to} is never called — the product is ungraded `
      + "with a comment explaining why the old function is unused");
  }
});
