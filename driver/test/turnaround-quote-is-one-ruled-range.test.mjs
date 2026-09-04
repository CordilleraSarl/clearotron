// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE TURNAROUND QUOTE IS ONE RULED RANGE, FROM ONE SOURCE.
//
// WHAT THIS REPLACED. The quote used to be a base plus one adder per lane — 1.5h, +0.5 case law, +0.5
// native language, +0.5 single territory. On three consecutive delivered runs, one engine build, one
// night, it missed the actual wall by +66%, +82% and −22%: in BOTH directions, and it did not even RANK
// the three jobs correctly — the product that quoted longest finished fastest.
//
// Every wall recoverable from either source, eight runs:
//
//     quoted 1.5h ×6  ->  actual 2.23  2.28  2.38  2.40  2.49  2.49
//     quoted 3.0h ×1  ->  actual 2.33      <- the MOST lanes, SHORTER than five of the others
//     quoted 1.5h ×1  ->  actual 2.73
//
// Quote spread 1.5–3.0h against an actual spread of 2.23–2.73h. The lever adders were manufacturing
// variation the wall does not have, and the base sat below EVERY observed actual. The owner ruled one
// range for every clearance — 1.5–2.5 hours — and "~15 min" for the knockout, which had been quoted 45
// min against 4–6 min delivered.
//
// THE UPPER BOUND SITS BELOW THE HIGHEST MEASURED WALL: 2.5h quoted, 2.73h (2h44) observed. That is the
// owner's call, made with the measurements in front of him. It is pinned here so that a later reader who
// notices the gap can see it was known and decided, not overlooked.
//
// WHAT THIS FILE IS FOR. Not the arithmetic — that is trivial and would not be worth a file. It is the
// INVARIANCE: a lever must not move a clearance quote. That is the property the ruling actually decided,
// it is the one a well-meaning change would break first, and it is invisible in any single example.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as model from "../effort-model.mjs";
import {
  TURNAROUND_QUOTE, quoteBoundsFor, turnaroundBounds, turnaroundHours, turnaround, quoteEffort,
} from "../effort-model.mjs";

const job = (levers, names = 1) => ({ levers, names, platforms: 0 });
const clearance = (extra = {}) => ({ pipeline: "clearance", territories: ["US"], ...extra });

test("#1669 the ruled figures, exactly as the owner stated them", () => {
  assert.equal(turnaround(job(clearance())), "1.5–2.5 hours");
  // — the knockout quote is a RANGE, 5-10 minutes, on a later owner ruling. The
  // "~15 min" this asserted came from and is superseded; the header's eight-run evidence above is
  // about clearance VARIANCE and is untouched by it. Note what that header already records: the knockout
  // delivered 4-6 minutes against 45 quoted, so 5-10 sits on the measurement and 15 never did.
  assert.equal(turnaround(job({ pipeline: "knockout", territories: ["US"] })), "5–10 min");
});

// THE ARM THAT MATTERS. Every lever combination the old model priced, asserted to move nothing.
test("#1669 NO lever changes a clearance quote — the adders cannot come back one at a time", () => {
  const combos = [];
  for (const caseLaw of [false, true]) {
    for (const nativeLanguage of [false, true]) {
      for (const territories of [["US"], ["US", "GB", "DE"]]) {
        combos.push({ caseLaw, nativeLanguage, territories });
      }
    }
  }
  assert.equal(combos.length, 8, "the lever grid the old model priced");

  const seen = new Set();
  for (const c of combos) {
    const i = job(clearance(c));
    seen.add(`${turnaround(i)}|${turnaroundHours(i)}`);
  }
  assert.deepEqual([...seen], ["1.5–2.5 hours|2.5"],
    "a lever moved the quote. #1669 ruled ONE range for every clearance because the adders were "
    + "manufacturing spread the measured walls do not have — the run carrying every lane came in shorter "
    + `than five carrying fewer. Got: ${[...seen].join("  ")}`);
});

test("#1669 ONE SOURCE — the rendered figures are the table's own numbers, not a second copy", () => {
  const c = quoteBoundsFor(clearance());
  assert.deepEqual(c, TURNAROUND_QUOTE.clearance, "the clearance row is selected, not rebuilt");
  assert.deepEqual(quoteBoundsFor({ pipeline: "knockout", territories: ["US"] }), TURNAROUND_QUOTE.knockout);

  // The job must render the table verbatim. If someone adds a second set of constants anywhere between
  // the table and the string, this is what stops agreeing.
  const i = job(clearance());
  assert.deepEqual(turnaroundBounds(i), { lowHours: 1.5, highHours: 2.5 });
  assert.equal(turnaroundHours(i), TURNAROUND_QUOTE.clearance.highHours,
    "the recorded figure is the table's upper bound — reconcileTurnaround divides by it, and a range cannot be divided by");
});

test("#1669 the ruled bounds are what the table holds, and 2.5h is BELOW the highest measured wall", () => {
  assert.deepEqual(TURNAROUND_QUOTE.clearance, { lowHours: 1.5, highHours: 2.5 });
  // — 5-10 minutes, expressed as the same division the table uses so the arm
  // pins the ruled MINUTES rather than a rounded decimal somebody would have to reverse-engineer.
  assert.deepEqual(TURNAROUND_QUOTE.knockout, { lowHours: 5 / 60, highHours: 10 / 60 });
  // AND THAT IT IS A RANGE. The failure this guards is a later change flattening the two ends back to one
  // figure: the deepEqual above would be edited to match and read as correct, while the picker silently
  // returned to quoting a single number. Both bounds are stated, so state the relation between them.
  assert.ok(TURNAROUND_QUOTE.knockout.lowHours < TURNAROUND_QUOTE.knockout.highHours,
    "the knockout quote was flattened back to a single figure — 2009 ruled it a range");
  // 2h44 = 2.73h was the longest wall in the evidence. The quote deliberately does not cover it.
  // Asserted so that raising the bound reads as reversing a ruling rather than fixing an oversight.
  assert.ok(TURNAROUND_QUOTE.clearance.highHours < 2.73,
    "the owner ruled 2.5h with a 2.73h observed maximum in front of him — this is decided, not missed");
});

// REPLACED THE ARM THAT USED TO SIT HERE. It asserted the opposite — that five names quoted
// 4.5–7.5 hours, three waves at the ruled range — and it was a correct test of a wrong model: the wave
// count came from a hard-coded 2 annotated `CLEAROTRON_MAX_CONCURRENT_RUNS`, a fourth copy of a default an
// operator changes in an `.env` with no deploy. Deleting that arm and stopping there would have left the
// ruling with no guard at all, which is how a multiplier comes back. So it is re-aimed at the property
// the owner actually ruled: the NAME COUNT does not move a clearance quote, the same way no lever does.
test("#1894 the name count does not move the quote — there is no arithmetic left to reintroduce", () => {
  const seen = new Set();
  for (const names of [1, 2, 3, 5, 8, 20, 100]) {
    const i = job(clearance(), names);
    assert.ok(model.runCount(i) === names, `the fixture must actually carry ${names} runs`);
    seen.add(`${turnaround(i)}|${turnaroundHours(i)}|${JSON.stringify(turnaroundBounds(i))}`);
  }
  assert.deepEqual([...seen], [`1.5–2.5 hours|2.5|${JSON.stringify({ lowHours: 1.5, highHours: 2.5 })}`],
    "a name count moved the quote. #1894 ruled the turnaround is a table lookup with no compute in it — "
    + `"No compute. We just say 1.5-2.5 hours for big reports, period." Got: ${[...seen].join("  ")}`);

  // The knockout row is NOT flattened into the clearance one. The ruling named the clearance figure; a
  // change that made both rows answer the same would satisfy the assertion above and be wrong.
  const k = job({ pipeline: "knockout", territories: ["US"] }, 8);
  assert.equal(turnaround(k), "5–10 min");
});

// 's third acceptance line — "exactly one place defines the number" — as something that can fail.
// The run-slot cap was copied into this module as `CONCURRENCY` and multiplied in by `waveCount`; both
// are gone, and this is what notices if either comes back. It reads the module's EXPORTS, not its text,
// so the prose above explaining why they went cannot satisfy it.
test("#1894 the run-slot cap is not copied into the effort model, in any exported form", () => {
  const names = Object.keys(model);
  assert.ok(names.length > 10, "the module barely exported anything — this arm would pass vacuously");

  for (const dead of ["CONCURRENCY", "waveCount"]) {
    assert.ok(!(dead in model),
      `${dead} is back. The turnaround quote is a table lookup since #1894; the run-slot cap is read at `
      + "the sites that ENFORCE it, from the environment, and is never copied here to quote from.");
  }

  // The broader shape, so a rename does not walk through: nothing exported may be the bare number 2
  // under a concurrency-ish name, and no exported function of a job may vary with the name count alone.
  const capish = names.filter((n) => /concurren|wave|slot|parallel/i.test(n));
  assert.deepEqual(capish, [], `these exports look like a re-copied run-slot cap: ${capish.join(", ")}`);
});

test("#1669 the quote object carries the RANGE, so nothing downstream has to re-derive it", () => {
  const q = quoteEffort(job(clearance()));
  assert.equal(q.turnaround, "1.5–2.5 hours");
  assert.equal(q.turnaroundHours, 2.5, "the legacy single figure stays the upper bound");
  assert.equal(q.turnaroundLowHours, 1.5);
  assert.equal(q.turnaroundHighHours, 2.5);
  // The point of carrying both: a consumer that wants to SHOW the range must not have to re-derive it
  // from the one number, which is how a second source of the bounds gets created.
  assert.equal(`${q.turnaroundLowHours}–${q.turnaroundHighHours} hours`, q.turnaround);
});
