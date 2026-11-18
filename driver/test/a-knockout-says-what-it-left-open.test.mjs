// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT SAYS WHAT IT LEFT OPEN (design's rule, approved by the owner 2026-11-18).
//
// A Knockout printed none of its own unfinished searches, so a name whose register search failed read as a clean name,
// where a clearance in the same place says so. The run's own record of a register step that failed, and of a name
// whose research was unavailable, now draws the clearance's Left open grid, in its state words and the shipped notes.
// A Knockout with nothing left open draws no section. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { knockoutLeftOpen } from "../publish/knockout.mjs";
import { renderKnockoutHtml, DEGRADED_NOTE } from "../publish/render-knockout.mjs";
import { plainDeferralReason } from "../deferral-row.mjs";
import { PART_NAMES, TIMED_OUT, NOT_COMPLETED } from "../degraded-parts.mjs";
import { parseFrameworkManifest } from "../framework.mjs";

const MANIFEST = parseFrameworkManifest({
  schema_version: 1, framework_key: "open-test", title: "Invented test framework", source_deck: "none", entity_label: "the company",
  bands: [{ label: "Severe", tone: "severe" }, { label: "Serious", tone: "high" }, { label: "Notable", tone: "medium" }, { label: "Slight", tone: "low" }],
  structure: { kind: "matrix", axes: ["Claim Grade", "Conflict Kind"] },
});
const MARKS = [{ name: "TARNELLO", rating: "Slight", classesSearched: [9], bullets: ["A bullet."], findings: [] },
  { name: "BRISQUETTE", rating: "Slight", classesSearched: [9], bullets: ["A bullet."], findings: [], degraded: true }];
const page = (leftOpen) => renderKnockoutHtml({ batch: { overall: "Slight", executiveSummary: "summary" }, marks: MARKS }, MANIFEST,
  { runId: "r1", overall: "Slight", leftOpen });

test("each recorded failure is one row, in the shipped words, and a run with none has none", () => {
  const steps = { listing: { reason: TIMED_OUT }, reading: { reason: NOT_COMPLETED } };
  assert.deepEqual(knockoutLeftOpen(steps, MARKS), [
    { area: PART_NAMES.register, state: "not-searched", note: plainDeferralReason(TIMED_OUT) },
    { area: PART_NAMES.register, state: "coverage-limited", note: plainDeferralReason(NOT_COMPLETED) },
    { area: "BRISQUETTE", state: "not-searched", note: DEGRADED_NOTE },
  ]);
  assert.deepEqual(knockoutLeftOpen({ listing: null, reading: null, review: { reason: TIMED_OUT } }, [MARKS[0]]), [],
    "a step that is not a search, and a name with its research, are not left open");
  assert.deepEqual(knockoutLeftOpen(null, undefined), []);
});

test("the page draws the clearance's grid under Left open, and nothing when nothing was left open", () => {
  const html = page(knockoutLeftOpen({ listing: { reason: TIMED_OUT } }, MARKS));
  const sec = html.slice(html.indexOf('<h2>Left open</h2>'));
  assert.ok(html.includes('<h2>Left open</h2>'), "no Left open section");
  assert.match(sec, /<div class="covgrp"><div class="covgh">Not run this run <span class="covgn">\(2\)<\/span><\/div>/, "the clearance's state word and count");
  assert.ok(sec.includes(`<div class="ct">Register <span class="cst">`) && sec.includes(plainDeferralReason(TIMED_OUT)), "the register row");
  assert.ok(sec.includes(`<div class="ct">BRISQUETTE <span class="cst">`), "the name whose research was unavailable");
  for (const none of [[], undefined]) assert.doesNotMatch(page(none), /Left open|class="covcell/, "a section drawn with nothing in it");
});
