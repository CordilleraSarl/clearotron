// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE "WHAT THE BANDS MEAN" BOX SHOWS THE WHOLE BAND, NOT ONLY WHAT IT COSTS.
//
// Part 1. `bandsBandMeanings` lifted exactly one bullet per band — the consequences
// rung — so the portal's framework screen showed no legal position and no practical position at all.
// The reviewing lawyer read that screen and concluded the legal assessment had been deleted from her
// framework. It had not: the deck on disk is complete and the engine reasons over all of it. The one
// surface a lawyer uses to check WHICH framework rates their matters misrepresented it.
//
// The second defect is the one that would have bitten Part 2: the lift hard-coded the English phrase
// "Potential outcomes", and any miss returned null, and null renders as NO SECTION AT ALL. A deck that
// merely RENAMES that rung would therefore have removed the entire box, silently — and the completed
// deck Part 2 adopts renames exactly it. The arm for that is here rather than waiting for Part 2,
// because it is the reason Part 1 has to land first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractBandMeanings } from "../profile-service.mjs";
import { loadFrameworkManifest } from "../framework.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const DRIVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(DRIVER_ROOT, "skills", "prelim-search");
const GUARD = "the-bands-box-shows-the-whole-band";
const REPO = join(DRIVER_ROOT, "..");   // trackedFiles pathspecs are repo-relative, not driver-relative
const deckOf = (f) => readFileSync(join(SKILLS, f), "utf8");
const manifestOf = (f) => loadFrameworkManifest(DRIVER_ROOT, `skills/prelim-search/${f}`);
const rowsFor = (f) => extractBandMeanings(deckOf(f), manifestOf(f));

// The four shipped decks the issue names. Verified on one is verified on nothing: this function has a
// branch per deck SHAPE, and the shapes differ.
const HOUSE = "risk-framework.md";
const ZEPHYR = "risk-framework-zephyr.md";
const AURORA = "risk-framework-aurora.md";
const DEMO = "risk-framework-demo.md";

test("2061 a bands deck reaches the screen with EVERY rung it states, in the deck's own order", () => {
  for (const deck of [HOUSE, ZEPHYR]) {
    const rows = rowsFor(deck);
    assert.ok(Array.isArray(rows) && rows.length, `${deck}: no band meanings at all`);
    for (const r of rows) {
      assert.ok(Array.isArray(r.rungs) && r.rungs.length >= 3,
        `${deck} / ${r.band}: ${r.rungs?.length ?? 0} rung(s) reach the screen. The defect this closes was `
        + "exactly one — the consequences bullet — with the legal and practical halves absent");
      for (const rung of r.rungs) {
        assert.ok(rung.label && rung.text, `${deck} / ${r.band}: a rung reached the screen with no label or no text`);
      }
    }
    // THE ORDER IS THE DECK'S. A reader is meant to see why a band is that band before what it costs,
    // which is the order the deck states and not one this code chooses.
    const first = rows[0].rungs.map((x) => x.label.toLowerCase());
    assert.match(first[0], /legal/, `${deck}: the legal position is not the rung a reader meets first`);
    assert.ok(first.findIndex((l) => /potential/.test(l)) === first.length - 1,
      `${deck}: the consequences rung is not last — the deck's order was not preserved`);
  }
});

test("2061 a deck that RENAMES a rung still renders — the old lift hard-coded one English phrase", () => {
  // Part 2's own rename, applied to the shipped deck. Before this change the box vanished entirely.
  const renamed = deckOf(HOUSE).replaceAll("**Potential outcomes.**", "**Potential consequences.**");
  const rows = extractBandMeanings(renamed, manifestOf(HOUSE));
  assert.ok(Array.isArray(rows) && rows.length === 4,
    "a renamed third rung blanked the whole section — this is the defect that would have hidden Part 2");
  assert.equal(rows[0].rungs.at(-1).label, "Potential consequences",
    "the deck's own word for the rung did not survive; something here still privileges one phrase");
});

test("2061 a band that states NO rungs is still a garbled deck, and still blanks the box", () => {
  // The protection that was worth keeping, aimed at the case it actually describes. A half-shown
  // framework misleads worse than an absent one; a merely renamed rung is not a half-shown framework.
  const noRungs = deckOf(HOUSE).replace(/^- \*\*(Legal|Practical|Potential)[^\n]*$/gm, "prose, no rungs");
  assert.equal(extractBandMeanings(noRungs, manifestOf(HOUSE)), null);
});

test("2061 MATRIX decks are untouched — they carry their own summary and no rungs", () => {
  const aurora = rowsFor(AURORA);
  assert.ok(Array.isArray(aurora) && aurora.length === 5, "aurora stopped rendering");
  for (const r of aurora) {
    assert.ok(r.meaning, "aurora lost the meaning it lifts from its own Band-meanings table");
    assert.equal(r.rungs, undefined, "a matrix deck grew rungs — that shape is the bands branch's");
  }
});

test("2061 `meaning` is KEPT, because a second surface reads it", () => {
  // driver/profile-page.html renders these rows too and reads `r.meaning` directly. Dropping the field
  // would have blanked a page nobody asked me to change — the reader population of a shape change is
  // never just the caller you set out to fix.
  for (const deck of [HOUSE, ZEPHYR]) {
    for (const r of rowsFor(deck)) {
      assert.ok(r.meaning, `${deck} / ${r.band}: the legacy field is empty, so the other surface shows nothing`);
      assert.equal(r.meaning, r.rungs.at(-1).text,
        "the legacy field must be the consequences rung — what that surface showed before, across the rename");
    }
  }
});

test("2061 the demo deck's box is absent BEFORE and AFTER — stated, not discovered later", () => {
  // Not a regression and not something this change introduces: the demo deck is matrix-shaped and
  // carries no "Band meanings" table for matrixBandMeanings to read, so its box has always been absent.
  // The issue asks that demo "render exactly as today", and today it renders nothing. Recorded here so
  // the next reader does not take a blank demo box as damage from this work. Filed on the issue.
  assert.equal(rowsFor(DEMO), null,
    "the demo deck now yields rows. That is an improvement rather than a fault, but it is NOT what this "
    + "change set out to do, and the issue's line about demo rendering as today would need revisiting");
});

// ── PART 2 AND PART 3 ────────────────────────────────────────────────────────────────────────────

test("2061 the house deck is the completed version, including the figure that replaces a refusal", () => {
  const deck = deckOf(HOUSE);
  // The $1m default is the half a careful reviewer would revert: the file used to argue against ANY
  // absolute figure in its own words, and that note is gone on the owner's ruling of 2026-08-31 — "her
  // framework is the complete thing including any numbers there's nothing else". Pinned so the argument
  // cannot come back without someone deciding to bring it back.
  assert.match(deck, /default \$1 million/,
    "the default materiality threshold is gone — the deck is back to refusing a figure");
  assert.doesNotMatch(deck, /An absolute figure here would be one company's materiality/,
    "the note arguing against any absolute figure is back, and it contradicts the figure now in the file");
  // The band boundary that actually moved: High and Moderate now share one legal sentence.
  assert.match(deck, /## MODERATE RISK[\s\S]*?Prior rights owner is \*\*likely to win\*\*/,
    "Moderate no longer reads 'likely to win' — the completed ladder was not adopted whole");
  assert.match(deck, /## MANAGEABLE RISK[\s\S]*?Prior rights owner is \*\*likely to lose\*\*/,
    "Manageable no longer reads 'likely to lose' — the completed ladder was not adopted whole");
});

test("2061 the shared reasoning file carries NO ONE CLIENT's ladder", () => {
  // `synthesis-rules.md` applies under EVERY framework and has no per-client override, so house phrasing
  // there was already wrong for the matrix decks and for zephyr. Swapping one client's ladder for
  // another's would have fixed today and left the defect, so the line points at the framework in force.
  const shared = readFileSync(join(SKILLS, "synthesis-rules.md"), "utf8");
  for (const phrase of ["more likely than not to win", "the client has the better of it"]) {
    assert.ok(!shared.includes(phrase),
      `synthesis-rules.md still spells out one framework's ladder ("${phrase}"). It is shared by every `
      + "client, so a concrete ladder here contradicts three of the four shipped decks");
  }
  assert.match(shared, /THE FRAMEWORK IN FORCE/, "the neutral instruction that replaced it is gone too");
});

test("2061 no file cites risk-framework.md for doctrine that is not in it", () => {
  // Seven citations named rules, stages and sections that moved out when the deck was slimmed to four
  // band definitions. Five were repointed at firm-wide-reasoning.md; two named things in NO file and
  // lost the pointer while keeping the rule. Every line is loaded into a model's context on every run:
  // the model follows the pointer, finds nothing, and proceeds on what it already had.
  const dead = [];
  const skillFiles = trackedFiles(GUARD, { root: REPO, pathspec: ["driver/skills"] });
  if (!skillFiles) { assert.ok(skipReason(GUARD), "no corpus and no stated reason"); return; }
  for (const f of nonEmpty(skillFiles, "driver/skills")) {
    if (/risk-framework/.test(f)) continue;
    const src = readFileSync(join(REPO, f), "utf8");
    // A POINTER, NOT A MENTION. The distinction is the difference between "open this file for X" and
    // "X originated here" — the second is history and is true. `firm-wide-reasoning.md` opens by saying
    // the calibration rules originated in a common-law-only context, which this arm caught on its first
    // run and which the issue itself quotes as corroborating context rather than listing as a defect.
    // So a pointer is a BACKTICKED PATH or a see/per construction; a bare subject is neither.
    for (const m of src.matchAll(/(?:see |per |`)[^\n]{0,40}risk-framework(?:\.md)?`?[^\n]{0,40}?(rule \d|Stage C|calibration rule|enforcer-profiling|PR section)/g)) {
      dead.push(`${f}: cites risk-framework for "${m[1]}"`);
    }
  }
  assert.deepEqual(dead, [],
    "a citation names doctrine the deck does not carry. The deck has five headings — its title and the "
    + "four bands — and everything else moved to firm-wide-reasoning.md or out of the tree entirely.");
});
