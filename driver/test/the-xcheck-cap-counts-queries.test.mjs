// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the real fold
//
// — THE CROSS-CHECK CAP COUNTED CANDIDATES, NOT QUERIES.
//
// The cap filled from the raw candidate list and the duplicate screen ran AFTER it, so an entry the
// fold was going to refuse still consumed a slot and a genuinely new term behind it was logged
// "assess manually" instead of being searched.
//
// MEASURED on a live run: cap 10, six directives kept, FOUR slots spent on entries this very fold then
// discarded, six real terms pushed out behind them.
//
// AND THE COLLISION IS THE EXPECTED CASE, which is why this is worth a fix rather than a note. The
// terms most likely to be refused as duplicates are the mark itself and its nearest forms — exactly
// what the common-law pass surfaces FIRST. They arrive at the front of the candidate list and take the
// earliest slots, every time.
//
// WHAT THIS IS NOT. The over-cap terms are disclosed, not silently lost: the ask ledger renders each
// one and adjudicates it, marking covered terms immaterial with a citation and only genuinely
// uncovered ones OPEN. The cost is manual adjudication the budget could have absorbed — real, and
// smaller than "unsearched marks". Recording that here because the issue's own severity was corrected
// on the thread, and an arm that overstates its defect teaches the next reader to discount it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { screenThenCap, foldSupplementalEntries } from "../register-plan.mjs";

const PIPELINE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");

const CAP = 10;

/** A supplemental entry in the shape the cross-check lane mints. */
const ent = (term, qid = null) => ({
  qid: qid ?? `supp:primary-sweep:default:${term.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:aaaaaaaa`,
  axis: "primary-sweep", predicate: "default", term,
  nice_classes: ["5", "32"], regions: [], expected_kind: "enumerate",
});

/** A plan already holding `terms` as rows — the twins the fold refuses a candidate against. */
const planWith = (terms) => ({
  plan_version: 1,
  entries: terms.map((t) => ({ ...ent(t, `primary-sweep:default:${t.toLowerCase()}`) })),
});

// The measured shape: four leading terms the plan already asks, then twelve genuinely new ones.
const DUPES = ["VIBRANTE", "VIBRANT", "FRIZBERRY", "FREEEZEBERRY"];
const FRESH = ["VIBRANTE WELLNESS", "VIBRANTE DRINKS", "VIBRANTE VITA", "VIBRANTE LABS", "FREEZE",
  "FREEZEBERR", "VIBRANTE GO", "VIBRANTE ZERO", "VIBRANTE KIDS", "VIBRANTE PLUS", "BERRYFREEZE", "VIBR"];

test("2159 THE DEFECT: a duplicate at the front of the list no longer spends a slot", () => {
  // Duplicates FIRST, which is the real ordering — the common-law pass surfaces the mark and its
  // nearest forms before anything else, so this is the expected case and not a contrived one.
  const plan = planWith(DUPES);
  const candidates = [...DUPES, ...FRESH].map((t) => ent(t));
  const got = screenThenCap(plan, candidates, CAP);

  assert.equal(got.entries.length, CAP,
    `every slot must carry a real query; got ${got.entries.length} — the four duplicates spent slots`);
  for (const e of got.entries)
    assert.ok(!DUPES.includes(e.term), `a refused duplicate reached the dispatched set: ${e.term}`);
  assert.equal(got.overflow.length, FRESH.length - CAP,
    "overflow must hold GENUINE excess only — terms behind ten real queries, not behind burned slots");
  assert.equal(got.refused.length, DUPES.length, "and the duplicates are still recorded as refused");
});

test("2159 the OLD behaviour, driven, so the arm above is not asserting into thin air", () => {
  // Cap first, screen second — what the code did. Four of the ten slots produce no query, which is the
  // measured 10-cap/6-kept shape exactly.
  const plan = planWith(DUPES);
  const candidates = [...DUPES, ...FRESH].map((t) => ent(t));
  const cappedFirst = candidates.slice(0, CAP);
  const folded = foldSupplementalEntries(plan, cappedFirst);
  assert.equal(folded.added.length, CAP - DUPES.length,
    "the old order yields six real queries out of ten slots — this is the defect, reproduced");
  assert.equal(candidates.length - CAP, 6, "and six real terms sat over the cap behind them");
});

test("2159 CONTROL: with no duplicates the selection is exactly what it always was", () => {
  // The arm that says this did not change the ordinary case. First CAP candidates, in order, and the
  // rest over-cap — byte for byte the old behaviour when nothing is refused.
  const got = screenThenCap(planWith([]), FRESH.map((t) => ent(t)), CAP);
  assert.deepEqual(got.entries.map((e) => e.term), FRESH.slice(0, CAP));
  assert.deepEqual(got.overflow.map((e) => e.term), FRESH.slice(CAP));
  assert.equal(got.refused.length, 0);
});

test("2159 a QUIET re-proposal spends no slot either — refusals are not the only way to mint nothing", () => {
  // The fold produces no query by two routes: an explicit refusal, and a silent `continue` for a row
  // whose qid the plan already holds ("a re-proposal, expected and quiet"). Only the first reaches
  // `refused`, so a screen keyed on refusals alone would still burn a slot on the quiet one. This is
  // the arm for that half — it fails a fix that filters on `refused` instead of on `added`.
  const shared = ent("VIBRANTE ECHO");
  const plan = { plan_version: 1, entries: [{ ...shared }] };   // same QID already in the plan
  const got = screenThenCap(plan, [shared, ...FRESH.map((t) => ent(t))], CAP);
  assert.ok(!got.entries.some((e) => e.qid === shared.qid), "the re-proposal must not occupy a slot");
  assert.equal(got.entries.length, CAP, "and the slot it vacated must carry a real query");
  assert.equal(got.refused.length, 0, "it is not a refusal — the fold stays quiet about it, correctly");
});

test("2159 nothing is invented: entries+overflow is exactly the set that would have been queried", () => {
  const plan = planWith(DUPES);
  const candidates = [...DUPES, ...FRESH].map((t) => ent(t));
  const got = screenThenCap(plan, candidates, CAP);
  const seen = [...got.entries, ...got.overflow].map((e) => e.qid);
  assert.equal(new Set(seen).size, seen.length, "no entry appears in both halves");
  const refusedQids = new Set(got.refused.map((r) => r.qid));
  for (const q of seen) assert.ok(!refusedQids.has(q), "a refused row must be in neither half");
  assert.equal(seen.length + got.refused.length, candidates.length,
    "every candidate is accounted for — dispatched, over-cap, or refused, and nowhere else");
});

test("2159 a cap larger than the candidate list leaves no overflow, and an empty list is not a throw", () => {
  const got = screenThenCap(planWith([]), FRESH.slice(0, 3).map((t) => ent(t)), CAP);
  assert.equal(got.entries.length, 3);
  assert.deepEqual(got.overflow, []);
  assert.doesNotThrow(() => screenThenCap(planWith([]), [], CAP));
  assert.doesNotThrow(() => screenThenCap(planWith([]), null, CAP), "a null candidate list is not a throw");
  assert.deepEqual(screenThenCap(planWith([]), null, CAP).entries, []);
});

// ── the CLASS: both supplemental lanes, not just the measured one ───────────────────────────────────

test("2159 BOTH lanes screen before they count — the recall lane has the identical shape", () => {
  // The issue measured the cross-check lane. The recall lane mints supplemental rows the same way,
  // caps them the same way, and folded them afterwards the same way — so fixing one would have left
  // the class half-done and the next reader looking at two patterns.
  //
  // Its OWNER budget is five, rationed by the material-first order deliberately, so a slot spent on a
  // row nobody dispatches is a fifth of that lane's portfolio reach.
  const calls = [...PIPELINE.matchAll(/screenThenCap\(/g)];
  assert.equal(calls.length, 2, `both supplemental lanes must screen through one helper, found ${calls.length}`);
});

test("2159 neither lane caps inside its mint loop any more", () => {
  // THE ORDER IS THE FIX, and these two conditions are what it removed. A cap tested while candidates
  // are still being built is the defect by definition, whichever lane regrows it.
  assert.ok(!/entries\.length >= XCHECK_CAP/.test(PIPELINE),
    "the cross-check lane is counting candidates into its cap again");
  assert.ok(!/ownerUsed >= RECALL_CAP_OWNER : markUsed >= RECALL_CAP_MARK\) \{\n\s*overflow\.push\(\{ qid, term: term\.slice/.test(PIPELINE),
    "the recall lane is counting candidates into its budgets again");
});

test("2159 the recall lane screens BEFORE it spends either budget", () => {
  // Order assertion, stated as one: the two behaviours it separates are a helper call and a budget
  // loop in the same function, and no return value distinguishes them.
  const lane = PIPELINE.slice(PIPELINE.indexOf("const RECALL_CAP_MARK"));
  const screen = lane.indexOf("screenThenCap(");
  const budget = lane.indexOf("ownerUsed >= RECALL_CAP_OWNER");
  assert.ok(screen > 0 && budget > 0, "the recall lane stopped screening or stopped budgeting");
  assert.ok(screen < budget,
    "the budget must be spent on rows that already survived the screen, or a duplicate takes one of five");
});
