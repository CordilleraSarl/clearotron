// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// prompt-payload-names-no-tracker-issue.test.mjs — the engine's instructions cite no tracker issue.
//
// ── WHY THIS GUARD AND NOT THE STRIP ────────────────────────────────────────────────────────────
//
// `driver/skills/**` is EXEMPT from the export's reference strip, and must stay exempt: those files are
// the program the model reads at run time, not documentation. The strip was editing fifteen of them
// until 2026-09-03 — twenty-seven edits — and an edit there changes what a clearance concludes.
//
// The price of that exemption used to be that any tracker token written into a skill file survived into
// the public tree. The owner ruled on 2026-09-03, on the scale measurement: the tokens go, by hand, and
// then the practice ends. His words on why the sentences themselves stay: "we just remove the actual
// issue number… we know removing a number will NOT reduce quality here."
//
// So this is the half that makes it permanent. The strip may not reach these files; this refuses the
// token at the door instead, where a human is writing it and can simply say the thing instead of citing
// where it was decided.
//
// ── WHY A COLOUR IS NOT A CITATION, AND WHY THAT MATTERS HERE ────────────────────────────────────
//
// MEASURED, not hypothesised. The obvious pattern for this class — `#` followed by three to five
// digits — matches CSS. `` is three digits. `#4472C4` contains ``. A sweep written the obvious
// way reported twenty-five lines when twenty-two were citations: the other three were the colours in a
// served HTML template, and stripping them would have changed what that form RENDERS while every
// reference check still read green.
//
// The exclusion is therefore about the SITE, not the digits: a declaration whose property is a colour is
// a colour. An arm below plants both and requires the guard to tell them apart, because a rule that
// cannot is a rule that will eventually edit a stylesheet.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "prompt payload names no tracker issue";

/** The citation shapes. Built rather than written so this file is not its own first offender. */
const HASH = new RegExp("#" + "[0-9]{3,5}\\b");
const WORDED = new RegExp("tracker\\s+(?:issue\\s+)?[0-9]{3,5}\\b|\\bissue\\s+[0-9]{3,5}\\b", "i");

/** A CSS declaration — the property is what settles it, never the digit count. */
const COLOUR_SITE = /(?:^|[;{\s])(?:color|background|background-color|border|border-color|fill|stroke|outline|box-shadow|text-shadow)\s*:/i;

/** Every line of `source` that cites a tracker issue. Colour declarations are not citations. */
export function citationsIn(source) {
  const out = [];
  source.split("\n").forEach((line, i) => {
    if (COLOUR_SITE.test(line)) return;
    if (HASH.test(line) || WORDED.test(line)) out.push(i + 1);
  });
  return out;
}

test("the engine's instruction files cite no tracker issue", (ctx) => {
  const tracked = trackedFiles(GUARD, { root: ROOT, pathspec: ["driver/skills"] });
  if (tracked === null) return ctx.skip(skipReason(GUARD));
  const files = nonEmpty(tracked, "trackedFiles(GUARD, { pathspec: ['driver/skills'] })");
  // A FLOOR, NOT JUST NON-EMPTY. The population is the skills tree, which is 55 files today and does not
  // shrink by accident. One file reaching this loop would satisfy `nonEmpty` while proving nothing about
  // the other fifty-four, and a clean result over a corpus that quietly collapsed is the failure this
  // whole family of guards exists to stop.
  assert.ok(files.length >= 40,
    `only ${files.length} prompt file(s) reached the scan — the pathspec is broken, not the tree`);

  const offences = [];
  for (const rel of files) {
    let src;
    try { src = readFileSync(join(ROOT, rel), "utf8"); } catch { src = null; }
    // AN UNREADABLE FILE IS A FINDING. A prompt file nobody could read is not a prompt file with
    // nothing in it, and this guard exists precisely because the strip cannot look here.
    if (src === null) { offences.push(`${rel}: could not be read`); continue; }
    for (const n of citationsIn(src)) offences.push(`${rel}:${n}`);
  }

  assert.deepEqual(offences, [],
    `${offences.length} line(s) in the engine's instructions cite a tracker issue:\n  `
    + offences.join("\n  ")
    + "\n\nThese files are served to the model at run time and the export's reference strip is exempt "
    + "from them BY DESIGN, so a token written here ships. Say the thing instead of citing where it was "
    + "decided — the reason a rule exists belongs in the rule, and a number a public reader cannot "
    + "resolve is not a reason.");
});

test("PLANT: the guard catches a citation and passes a colour — it must tell them apart", () => {
  // Both directions, because the whole reason this arm exists is that the obvious pattern cannot.
  const cite = "Never tag it in the findings (" + "#1393" + ").";
  const worded = "RETIRED (" + "tracker issue 1893" + ") — this told the seat to surface them.";
  assert.deepEqual(citationsIn(cite), [1], "a hash citation was not caught");
  assert.deepEqual(citationsIn(worded), [1], "a worded citation was not caught");

  // THE CONTROL, and it is the one that matters: these are the exact declarations that a digit-count
  // rule reported as citations on this tree, in a template the product SERVES.
  assert.deepEqual(citationsIn("    color: #000;"), [], "a colour was reported as a citation");
  assert.deepEqual(citationsIn("    background-color: #4472C4;"), [], "a colour was reported as a citation");
  assert.deepEqual(citationsIn("    background-color: #000;"), [], "a colour was reported as a citation");

  // And a line with neither must stay silent, or the two arms above prove nothing.
  assert.deepEqual(citationsIn("The adapter sends one request per territory."), []);
});
