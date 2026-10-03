// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RUN-LIFECYCLE CHAPTER'S STEP ORDER AND `STAGE_ORDER` ARE TWO STATEMENTS OF ONE FACT.
//
// `frame-diff` moved from below the screen-gate to above placement-inquiry on 2026-08-03 — the comment at
// its call site records the move, the date and the reason: placement used to be dispatched twice, so the
// frame settles first and placement runs once on a settled frame. `STAGE_ORDER` moved with it, because
// `--from <stage>` keys on that list. The chapter did not, and nothing was red for seven weeks, because
// nothing read the chapter's numbered list at all. It was corrected by somebody reading the issue body
// properly, which is not a mechanism.
//
// NEITHER SIDE IS RETYPED HERE, and that is the whole design. A third copy of the order would be a third
// thing to drift — the defect one layer up. The executed order comes from `STAGE_ORDER`; the documented
// order comes from parsing the chapter. This file holds no list of stage names.
//
// ── WHY TITLES AND NOT PROSE ─────────────────────────────────────────────────────────────────────────
//
// The first version of this matched each stage id anywhere in its step's text, and got 11 of 15 — more
// coverage and a WRONG position. `synthesis` matched steps 8, 11, 12 and 15, because step 8 says "after
// synthesis exists on a resume"; taking its earliest mention put synthesis at 8, and that passed only
// because the skeptic is also at 8. A mention is not a position. A step's TITLE is the chapter asserting
// where a stage sits, and that is the only claim worth pinning.
//
// THE COST OF THAT CHOICE IS STATED RATHER THAN HIDDEN: six of fifteen stages are named in a title, so a
// reorder among the other nine is invisible here. The recorded count below is what stops that cost
// growing silently — a title reworded so it no longer names its stage drops the count, and the arm says so
// rather than quietly checking less.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGE_ORDER } from "../stages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTER = "docs/architecture/03-run-lifecycle.md";

/** The chapter's numbered steps, as `{ n, title }` — parsed, never retyped. */
function documentedSteps() {
  const md = readFileSync(join(ROOT, CHAPTER), "utf8");
  return [...md.matchAll(/^(\d+)\. \*\*([^*]+)\*\*/gm)].map((m) => ({ n: Number(m[1]), title: m[2] }));
}

/** Every stage whose id a step TITLE names, with the step it names it in. */
function positions(steps) {
  const out = [];
  for (const id of STAGE_ORDER) {
    const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const named = steps.filter((s) => re.test(s.title)).map((s) => s.n);
    if (named.length) out.push({ id, named, step: named[0] });
  }
  return out;
}

// FIVE, and it is recorded rather than derived, for the reason in the header: a derived count cannot notice
// itself falling. Raise it deliberately when a title starts naming its stage; lower it only with the reason.
// 6 -> 5: frame-diff's step left the chapter with the stage (the mid-run reopening was removed).
const NAMED_IN_A_TITLE = 5;

test("the chapter is parsed at all — a numbered list this finds nothing in would pass every arm below", () => {
  const steps = documentedSteps();
  assert.ok(steps.length >= 10, `only ${steps.length} numbered step(s) parsed from ${CHAPTER} — the list's shape changed and this file is now measuring nothing`);
  assert.deepEqual(steps.map((s) => s.n), steps.map((_, i) => i + 1),
    "the chapter's steps are not numbered 1..n in order, so a step number is not a position");
});

test("every stage a step title names is named in exactly one title", () => {
  const found = positions(documentedSteps());
  const ambiguous = found.filter((f) => f.named.length > 1).map((f) => `${f.id} in steps ${f.named.join(", ")}`);
  assert.deepEqual(ambiguous, [],
    "a stage named by two titles has no single documented position, so the comparison below would be picking one arbitrarily");
});

test("the count of stages pinned by a title is the recorded one", () => {
  const found = positions(documentedSteps());
  assert.equal(found.length, NAMED_IN_A_TITLE,
    `${found.length} stage id(s) are named in a step title, and ${NAMED_IN_A_TITLE} were recorded. `
    + "Raising it is ordinary — a title now names its stage. FALLING is the case this arm exists for: a "
    + "reworded title that no longer names its stage takes that stage out of the order check silently, and "
    + `this file would then pass while comparing less. Named now: ${found.map((f) => f.id).join(", ")}`);
});

test("the documented order of those stages is the executed order", () => {
  const found = positions(documentedSteps());
  const wrong = [];
  for (let i = 1; i < found.length; i++) {
    const prev = found[i - 1], here = found[i];
    if (here.step < prev.step) wrong.push(
      `STAGE_ORDER runs ${prev.id} before ${here.id}, and the chapter puts ${here.id} at step ${here.step} `
      + `before ${prev.id} at step ${prev.step}`);
  }
  assert.deepEqual(wrong, [],
    `the chapter and the executed order disagree:\n  ${wrong.join("\n  ")}\n\n`
    + `One of the two moved without the other. ${CHAPTER}'s numbered list is the documented order; `
    + "`STAGE_ORDER` in driver/stages.mjs is what the engine runs and what `--from <stage>` keys on. "
    + "Fix whichever is wrong — and if the code moved, the call-site comment beside the move is where the "
    + "reason belongs, not here.");
});
