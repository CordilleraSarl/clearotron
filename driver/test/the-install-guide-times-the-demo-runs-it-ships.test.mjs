// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE INSTALL GUIDE TIMES THE DEMO RUNS IT SHIPS, NOT ONE IT NO LONGER DOES.
//
// The guide said the example run in `demo/` took 2 h 35 m, beside a quote of "up to 2.5 hours", and a
// newcomer read the two as a contradiction (measured on a beta, 2026-11-04). Neither figure was the
// problem's source: the 2 h 35 m came from a sample that has since been replaced. The four samples now
// in `demo/` each record their own start and delivery, and the three clearances among them took about an
// hour, under the quote.
//
// EVERY FIGURE IS READ FROM THE SAMPLES' OWN status.json, in whole minutes, and the clearance quote from
// the effort model, so a re-frozen sample or a re-fitted quote that makes the sentence false goes red here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { policyFor } from "../search-policy.mjs";
import { quoteBoundsFor } from "../effort-model.mjs";
import { spell, DERIVED } from "../doc-constants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const INSTALL = readFileSync(join(ROOT, "INSTALL.md"), "utf8").replace(/\s+/g, " ");

const SAMPLES = readdirSync(join(ROOT, "demo"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => {
  const status = JSON.parse(readFileSync(join(ROOT, "demo", d.name, "run", "status.json"), "utf8"));
  const minutes = (Date.parse(status.deliveredAt) - Date.parse(status.startedAt)) / 60000;
  return { product: d.name, pipeline: policyFor(d.name)?.pipeline, minutes };
});
const clearances = SAMPLES.filter((s) => s.pipeline === "clearance");
const knockouts = SAMPLES.filter((s) => s.pipeline === "knockout");
const whole = (m) => String(Math.round(m));

test("the samples are the four the guide describes, each with a measured wall", () => {
  assert.equal(knockouts.length, 1, "the guide times one knockout sample");
  assert.ok(clearances.length >= 1, "no clearance sample to time");
  for (const s of SAMPLES) assert.ok(Number.isFinite(s.minutes) && s.minutes > 0, `${s.product} records no wall`);
});

test("the guide's figures are the samples' own, and the clearances are quicker than the quote", () => {
  const low = whole(Math.min(...clearances.map((s) => s.minutes)));
  const high = whole(Math.max(...clearances.map((s) => s.minutes)));
  const ko = whole(knockouts[0].minutes);
  const count = spell(clearances.length);
  assert.ok(INSTALL.includes(`The ${count} clearances in \`demo/\` took ${low} to ${high} minutes each, and its knockout search ${ko} minutes.`),
    `§5 does not give the samples' walls: ${count} clearances at ${low} to ${high} minutes, a knockout at ${ko}`);
  const all = spell(SAMPLES.length);
  assert.ok(INSTALL.includes(`**${all[0].toUpperCase()}${all.slice(1)} measured runs.**`), `How long a run takes does not count ${all} measured runs`);
  assert.ok(INSTALL.includes(`The ${count} clearances took **${low} to ${high} minutes** each, quicker than the quote below; the knockout search took **${ko} minutes**.`),
    "How long a run takes does not give the samples' walls");
  // "Quicker than the quote" is only true while every clearance sample beat the low end of the range.
  const { lowHours } = quoteBoundsFor({ pipeline: "clearance", caseLaw: false, nativeLanguage: false, territories: [] });
  for (const s of clearances) assert.ok(s.minutes < lowHours * 60, `${s.product} took ${whole(s.minutes)} minutes, which is not quicker than the quote`);
  assert.doesNotMatch(INSTALL, /2 h 35 m|1\.29×/, "the guide still times a sample it no longer ships");
});

// The section's opening line and the quickstart's figures sit beside these walls, so they say what both the
// walls and the quote allow: a knockout in minutes, a clearance in about an hour or more, and a quote as a quote.
test("the lines beside the walls agree with them, and the quickstart gives the quote as a quote", () => {
  assert.doesNotMatch(INSTALL, /Hours, not minutes\./, "How long a run takes opens with a line its own figures contradict");
  assert.ok(INSTALL.includes("### How long a run takes Minutes for a knockout search, an hour or more for a clearance."),
    "How long a run takes does not open with a line its figures agree with");
  const quickstart = readFileSync(join(ROOT, "QUICKSTART.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(quickstart.includes(`A knockout search is quoted at ${DERIVED.knockoutLowMinutes} to ${DERIVED.knockoutHighMinutes} minutes, `
    + `and the other three at ${DERIVED.clearanceLowHours} to ${DERIVED.clearanceHighHours} hours.`),
  "the quickstart states the quote as how long a search takes, or quotes figures the effort model does not give");
});
