// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A DEPLOYMENT IS JUDGED ON THE SCENARIO YOU ASKED FOR, NOT ON THE WHOLE STORE.
//
// WHAT WENT WRONG. The pre-run sweep checks every job block in the store through both admission
// gates and refuses the INVOCATION if any scenario disagrees with the outcome it declares. That is the
// right check and the wrong granularity. With the free tier wired — an EU+US register — R5 is a
// worldwide search the register genuinely cannot reach, so R5 refuses. Correctly. But the refusal was
// store-wide, so it also refused R3, which is US-only and entirely inside EU+US coverage:
//
//     $ e2e.mjs run R3
//     the store's scenarios and the doors disagree — refusing before anything spends:
//       R5: … a Global preliminary search needs geography this deployment's register cannot reach …
//
// One out-of-coverage scenario made every other scenario unrunnable on that provider., and
// all carried `merged-awaiting-e2e` and none could be exercised end to end, because the free tier
// was the one configuration under which no scenario would start.
//
// WHAT MUST NOT BE LOST IN FIXING IT. R5's refusal is correct and permanent on that provider, and the
// sweep exists so a store/doors disagreement is visible BEFORE an expensive run. A fix that filtered
// other scenarios' findings into silence would trade one failure for a quieter one. So the split here
// is the same one this file's subject already draws between `wrong` and `dead`: everything is PRINTED,
// only what names your scenario STOPS you.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { findingIsAbout } from "../../scripts/e2e.mjs";

const E2E_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "e2e.mjs"), "utf8");

/**
 * The argument at a `sweepStoreOrDie(` call inside a named function, by bracket matching.
 *
 * A source census rather than a live one, because the live exercise COSTS MONEY: proving `run R3` starts
 * means letting it start, and a scenario that starts is a clearance that spends. The property still has
 * to be pinned — an id threaded from one caller and not the other is precisely the shape of this bug —
 * so it is pinned where it can be read for free.
 *
 * Bracket-matched, not regex-matched over the file: a whole-file search for `sweepStoreOrDie(id)` passes
 * as long as ANY caller threads an id, which is exactly the assertion that cannot fail when one caller
 * silently stops. ('s door test was rewritten for the same reason.)
 */
function sweepArgIn(functionName) {
  const fnAt = E2E_SRC.indexOf(`function ${functionName}(`);
  assert.notEqual(fnAt, -1, `${functionName} not found — this census is measuring nothing`);
  const callAt = E2E_SRC.indexOf("sweepStoreOrDie(", fnAt);
  assert.notEqual(callAt, -1, `${functionName} does not call sweepStoreOrDie — the sweep was removed from a door`);
  const open = callAt + "sweepStoreOrDie(".length;
  let depth = 1, i = open;
  for (; i < E2E_SRC.length && depth > 0; i++) {
    if (E2E_SRC[i] === "(") depth++;
    else if (E2E_SRC[i] === ")") depth--;
  }
  return E2E_SRC.slice(open, i - 1).trim();
}

// The two real findings from the 2026-08-11 free-tier round, verbatim in shape.
const R5_FINDING = 'R5: expect.terminal="delivered" wants ADMITTED, schema="run" gateErrors=1 — a Global '
  + 'preliminary search needs geography this deployment\'s register cannot reach — it wants "worldwide, and '
  + 'nothing else" and the wired register covers European Union, United States';
const R0D_CASE_FINDING = "R0d/second-door: expects `duplicate` without oneMatterAcrossDoors — door-suffixed "
  + "refs make each door a DIFFERENT matter and the duplicate can never occur";

test("a finding about R5 does not stop R3 — the whole defect, in one line", () => {
  assert.equal(findingIsAbout(R5_FINDING, "R5"), true);
  assert.equal(findingIsAbout(R5_FINDING, "R3"), false);
});

test("a CASE finding belongs to its scenario", () => {
  // Labels come in two shapes — `R5` and `R0d/<case>` — and a case finding is still a finding about the
  // scenario you are about to run. Matching only the bare id would let a broken case start its run.
  assert.equal(findingIsAbout(R0D_CASE_FINDING, "R0d"), true);
  assert.equal(findingIsAbout(R0D_CASE_FINDING, "R0"), false, "R0 must not swallow R0d's findings");
});

test("the match is on the LABEL, not anywhere in the prose", () => {
  // R5's own text mentions no other scenario today, but a finding that quotes an id in its reason must
  // never be attributed to that id — that is how a scenario comes to refuse for someone else's defect.
  assert.equal(findingIsAbout("R5: R3 is the one that is fine", "R3"), false);
  assert.equal(findingIsAbout("R5: R3 is the one that is fine", "R5"), true);
});

test("case-insensitive, because `run r3` and the store's `R3` are the same scenario", () => {
  assert.equal(findingIsAbout(R5_FINDING, "r5"), true);
  assert.equal(findingIsAbout("r5: something", "R5"), true);
});

test("an empty or absent id matches NOTHING — it must never mean `all`", () => {
  // This predicate answers one question — "is this finding about scenario X?" — and an absent X is not a
  // question. `list`'s refuse-on-everything is a decision the SWEEP makes for a null id, stated there;
  // folding it in here would make a general predicate silently mean "all" wherever it was reused, which
  // is how a scoped check comes to refuse a scenario nobody named.
  assert.equal(findingIsAbout(R5_FINDING, ""), false);
  assert.equal(findingIsAbout(R5_FINDING, null), false);
  assert.equal(findingIsAbout(R5_FINDING, undefined), false);
});

test("a prefix is not a match — R1 must not answer for R10", () => {
  assert.equal(findingIsAbout("R10: something wrong", "R1"), false);
  assert.equal(findingIsAbout("R10: something wrong", "R10"), true);
});

// ── the PAIR: run scopes, list does not ─────────────────────────────────────────────────────────────

test("`run` threads its scenario id into the sweep — the fix itself", () => {
  assert.equal(sweepArgIn("cmdRun"), "id",
    "without the id the sweep judges the whole store again and R5 refuses R3's run");
});

test("`list` still refuses on EVERY finding — #659 did not ask for a quieter survey", () => {
  // The tempting over-fix. Listing is the command whose whole job is to survey the store, and a
  // store/doors disagreement is a defect IN the store: it must keep failing there. Scoping this call
  // too would turn the sweep's early warning into a line of stderr nobody exits on, trading a narrow
  // bug for a lost signal. Two tests in e2e-scenario-store.test.mjs assert the exit code; this one
  // states WHY the argument lists differ, so the difference does not read as an oversight.
  assert.equal(sweepArgIn("cmdList"), "",
    "cmdList must call sweepStoreOrDie() with no id, so every finding stays fatal there");
});

// ── the invariant the scoping RESTS ON, which nothing was checking ──────────────────────────────────
//
// `run R3` selects the scenario by FILENAME (loadScenario reads R3.json). Every finding about it is
// labelled with the scenario's `id` FIELD, and the scoped sweep matches findings by that label.
//
// Those are two different keys, and nothing compared them. They agree across all seven scenarios in the
// store today — but the store is a DIFFERENT REPO, so the property 's scoping depends on was held by
// coincidence. A file whose id diverged would produce findings labelled with the other name, the scoped
// refusal would not match, and a scenario the doors refuse would START AND SPEND. That is the failure
// the whole sweep exists to prevent, reachable through the fix for it.

import { lintScenarios } from "../../scripts/e2e.mjs";

test("a scenario whose id and filename disagree is a REFUSAL, not a curiosity", () => {
  const sc = (id, file) => ({ id, __file: file, job: { ref: "E2E-x" }, expect: { terminal: "delivered" } });
  const wrong = lintScenarios([sc("R9", "R3.json")]).wrong.filter((w) => /filename/.test(w));
  assert.equal(wrong.length, 1, "the disagreement must be reported");
  assert.match(wrong[0], /R3\.json/, "and name the file");
  assert.match(wrong[0], /start and spend/, "and say what it costs, or it reads as tidiness");
});

test("agreeing ids are silent — the rule must not fire on the store as it stands", () => {
  const sc = (id, file) => ({ id, __file: file, job: { ref: "E2E-x" }, expect: { terminal: "delivered" } });
  const wrong = lintScenarios([sc("R3", "R3.json"), sc("R5", "R5.json")]).wrong.filter((w) => /filename/.test(w));
  assert.deepEqual(wrong, [], "all seven scenarios agree today; a rule that fires on them would be deleted");
});

test("a scenario with no filename attached is not judged on one", () => {
  // Callers that build scenarios in memory (every other test in the suite) must not trip this.
  const wrong = lintScenarios([{ id: "R3", job: { ref: "E2E-x" }, expect: { terminal: "delivered" } }])
    .wrong.filter((w) => /filename/.test(w));
  assert.deepEqual(wrong, []);
});
