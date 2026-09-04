// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// screen-verdict-reaches-the-floor-row.test.mjs —.
//
// `screen_verdict` was declared on every floor row of `_driver/band-shape.json` and populated on none.
// MEASURED across every band shape reachable on this box — 259 artifacts, 47,392 floor rows, ZERO
// non-null verdicts — while every sibling field on the same rows was 100% populated:
//
//     live 47390/47392 · status 47390/47392 · basis 47390/47392
//     tier 47392/47392 · matched_target 47390/47392 · screen_verdict 0/47392
//
// So "those rows were never screened" is the wrong reading, and joining the shapes to the bands that
// produced them says why: 2,166 records carry `screen.screen_verdict` and NOT ONE carries it at the
// top level. `floorRow` read only the top level, so it could never have found a value — while `status`
// TWO LINES ABOVE IT did the dual read, which is exactly why status measured 100% on the same rows.
//
// THE ISSUE REASONED THIS CAUSE AWAY, and the mistake is worth keeping: it observed that no floor row
// carries a `screen` sub-object and concluded the value was not hiding there. That is evidence about
// the OUTPUT row — which this projection builds, and which never copies `screen` — and it says nothing
// about the input. An output-side observation cannot refute an input-side hypothesis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBandShape } from "../band-shape.mjs";

// The real merged-band shape: the verdict lives inside `screen`, which is where 2,166 of 2,166
// verdict-carrying records on this box put it.
const IN_SCREEN = {
  record_id: "/mark/us/90000001", mark_text: "ZEPHYR", classes: [9], owner_name: "Verrit Instruments Ltd",
  screen: { screen_verdict: "surface:in-scope-live", live_status: "live", registry: "USPTO", status: "Registered" },
};
// The other documented home — `record-carry.mjs` names both in as many words. Kept LIVE: the floors
// are live in-class identical/near records only, so a dead fixture never becomes a row at all and the
// arm would assert nothing. (It was `Expired` first, and this arm caught that rather than passing on
// an empty array.)
const TOP_LEVEL = {
  record_id: "/mark/us/90000002", mark_text: "ZEPHYR", classes: [9], owner_name: "Kelbrook Trading GmbH",
  screen_verdict: "surface:all-class", status: "Registered",
};
// Screened, and genuinely without a verdict — the row that must still read null, or the fix has just
// replaced one unreadable value with another.
const NO_VERDICT = {
  record_id: "/mark/us/90000003", mark_text: "ZEPHYR", classes: [9], owner_name: "Harbour Supply Ltd",
  screen: { live_status: "live", registry: "USPTO", status: "Registered" },
};
// A record screening never reached at all: no status, no screen. An unknown status reads LIVE by the
// fail-safe in `isLiveRecord`, so this IS a floor row — which is what makes it the row that tests the
// "status and verdict rise and fall together" property. Without it that assertion sat behind a branch
// no fixture could take, which is the exact shape `scripts/unexecuted-asserts.mjs` exists to catch, and
// it caught this one in CI.
const UNSCREENED = {
  record_id: "/mark/us/90000004", mark_text: "ZEPHYR", classes: [9], owner_name: "Calder Works SA",
};

const floors = (records) => buildBandShape({ enumerated: records, crowds: [] },
  { targets: ["ZEPHYR"], inScopeClasses: ["9"] }).shape.floors.in_class_identical_or_near;

test("#1472 a verdict inside `screen` reaches the floor row", () => {
  const rows = floors([IN_SCREEN]);
  assert.equal(rows.length, 1, "premise: an in-class identical record is a floor row");
  assert.equal(rows[0].screen_verdict, "surface:in-scope-live",
    "the verdict is on the record and did not reach the row the lawyer reads");
});

test("#1472 the other documented location still works", () => {
  const rows = floors([TOP_LEVEL]);
  assert.equal(rows.length, 1, "premise: the fixture is a live in-class record, so it IS a floor row");
  assert.equal(rows[0].screen_verdict, "surface:all-class");
});

test("#1472 THE CONTROL — a screened record with no verdict still reads null", () => {
  // Absence must stay absence. If this flips, the fix has invented a verdict, which is the failure
  // mode strictly worse than the one it repairs.
  assert.equal(floors([NO_VERDICT])[0].screen_verdict, null);
});

test("#1472 the field's TWO readers agree — the pin", () => {
  // `band-shape.mjs` reads this field in two places: the crowd/record projection and the floor row.
  // They disagreed about where it lives, and the floor row lost. Both are asserted here against the
  // SAME record, so the next change to either has to keep them in step.
  const { shape } = buildBandShape({ enumerated: [IN_SCREEN, TOP_LEVEL, NO_VERDICT, UNSCREENED], crowds: [] },
    { targets: ["ZEPHYR"], inScopeClasses: ["9"] });
  const rows = shape.floors.in_class_identical_or_near;
  const byId = Object.fromEntries(rows.map((r) => [r.record_id, r.screen_verdict]));
  assert.equal(byId["/mark/us/90000001"], "surface:in-scope-live");
  assert.equal(byId["/mark/us/90000002"], "surface:all-class");
  assert.equal(byId["/mark/us/90000003"], null);

  // AND THE POPULATION PROPERTY THE MEASUREMENT WAS ABOUT: on rows where screening reached the record
  // at all, the verdict is no longer the one field of the set that is empty. `status` is the sibling
  // that was 100% while this was 0% — they must now rise and fall together.
  const statusless = rows.filter((r) => r.status == null);
  assert.equal(statusless.length, 1, "premise: exactly one fixture is unscreened, so the next line asserts something");
  assert.deepEqual(statusless.map((r) => r.screen_verdict), [null],
    "a row screening never reached somehow gained a verdict");

  const withStatus = rows.filter((r) => r.status != null).length;
  const withVerdict = rows.filter((r) => r.screen_verdict != null).length;
  assert.equal(withStatus, 3, "three of the four fixtures resolve a status");
  assert.equal(withVerdict, 2, "two carry a verdict; one is screened without one, one was never screened");
});
