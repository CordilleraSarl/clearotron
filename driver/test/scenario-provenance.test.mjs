// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scenario-provenance.test.mjs —: a declared wall says where it came from, or says it cannot.
//
// The class finding, three instances in one day: scenario files carry confident, specific claims about
// their own history that the artifacts contradict. `measured: true` with no provenance is the trap —
// it tells the next reader NOT to re-measure while giving them nothing to check.
//
// The store now stamps `cost.measuredFrom`. THIS IS THE READER, and the reading is not decoration:
// scripts/e2e.mjs's own dead-key rule says a key nothing reads "would sit in the store looking like the
// rule it used to be, and the next reader would 'fix' the benchmark by editing a number nothing reads".
// A provenance block nothing prints is exactly that key.
//
// TWO THINGS THE BLOCK EXISTS TO SURFACE, both measured on the real store 2026-08-18:
//
//   STALENESS — a figure measured months ago over one run and one measured yesterday over seventeen are
//   both `measured: true`, and only one should be planned against. The age is computed at read time
//   rather than stored, so it cannot itself go stale.
//
//   PROVIDER SPLIT — three scenarios draw their walls from more than one register era. R5 is 7 clarivate
//   plus 1 signa; R6 is one of each. A median across two providers describes neither, and a reader has
//   to see that before booking against the number.

import { test } from "node:test";
import assert from "node:assert/strict";
import { provenanceLines } from "../../scripts/e2e.mjs";

const AT = new Date("2026-08-18T00:00:00Z");

test("#1091 measured:true with NO provenance is named, not passed over", () => {
  const [line] = provenanceLines({ measured: true, wallMinutes: 122 }, AT);
  assert.match(line, /NOTHING says where the figure came from/,
    "this is the exact shape #1091 filed — a confident number with nothing behind it — and silence here "
    + "is the scenario file's silence repeated by the tool that reads it");
  assert.match(line, /#1091/);
});

test("#1091 an UNMEASURED scenario says nothing — the flag is what makes silence a defect", () => {
  assert.deepEqual(provenanceLines({ measured: false, wallMinutes: 183 }, AT), [],
    "a scenario that declares itself unmeasured is already honest; warning about it would train the "
    + "reader to scroll past the line that matters");
  assert.deepEqual(provenanceLines({}, AT), []);
  assert.deepEqual(provenanceLines(null, AT), []);
});

test("#1091 STALENESS is computed at read time, so it cannot itself go stale", () => {
  const p = { at: "2026-06-01", source: "s", deliveredRuns: 1, walls: { min: 1, max: 1 } };
  assert.match(provenanceLines({ measured: true, measuredFrom: p }, AT)[0], /78 days ago/);
  assert.match(provenanceLines({ measured: true, measuredFrom: { ...p, at: "2026-08-18" } }, AT)[0], /\(today\)/);
  assert.match(provenanceLines({ measured: true, measuredFrom: { ...p, at: "2026-08-17" } }, AT)[0], /1 day ago/);
  // A date nobody can parse is stated as such rather than rendered as a plausible age.
  assert.match(provenanceLines({ measured: true, measuredFrom: { ...p, at: "last Tuesday" } }, AT)[0], /date unreadable/);
});

test("#1091 A TWO-PROVIDER POPULATION IS WARNED ABOUT — one number cannot describe it", () => {
  const lines = provenanceLines({ measured: true, measuredFrom: {
    at: "2026-08-18", source: "s", deliveredRuns: 8, failedRuns: 1,
    walls: { min: 139.8, max: 217.1 }, medianMinutes: 150.7, providers: { clarivate: 7, signa: 1 },
  } }, AT);
  const warn = lines.find((l) => /TWO PROVIDER ERAS/.test(l));
  assert.ok(warn, `no provider warning in:\n${lines.join("\n")}`);
  assert.match(warn, /clarivate 7, signa 1/);
  assert.match(warn, /describes neither/, "the warning has to say WHY, or it reads as trivia");
  // One provider is not a split and must not warn — a warning on every scenario is a warning on none.
  assert.ok(!provenanceLines({ measured: true, measuredFrom: {
    at: "2026-08-18", source: "s", deliveredRuns: 4, walls: { min: 1, max: 2 }, providers: { clarivate: 4 },
  } }, AT).some((l) => /TWO PROVIDER ERAS/.test(l)));
});

test("#1091 an EXCLUDED wall prints with its reason — a dropped figure and an unmeasured one differ", () => {
  const lines = provenanceLines({ measured: true, measuredFrom: {
    at: "2026-08-18", source: "s", deliveredRuns: 8, walls: { min: 1, max: 217 },
    excluded: [{ minutes: 217, reason: "includes a recovery park" }],
  } }, AT);
  assert.ok(lines.some((l) => /EXCLUDED 217 min — includes a recovery park/.test(l)));
  // And an exclusion with no reason is itself named, because a wall dropped silently is a wall nobody
  // can re-include when the reason turns out not to hold.
  const bare = provenanceLines({ measured: true, measuredFrom: {
    at: "2026-08-18", source: "s", excluded: [{ minutes: 99 }],
  } }, AT);
  assert.ok(bare.some((l) => /no reason recorded, which is itself the defect/.test(l)));
});

test("#1091 the counts and the range travel with the number", () => {
  const [head] = provenanceLines({ measured: true, measuredFrom: {
    at: "2026-08-18", source: "s", deliveredRuns: 4, failedRuns: 2,
    walls: { min: 108.9, max: 144.9 }, medianMinutes: 138.1, providers: { clarivate: 4 },
  } }, AT);
  assert.match(head, /4 delivered, 2 failed/,
    "the failure count is half the cost of a scenario and the wall alone hides it");
  assert.match(head, /108\.9-144\.9 min/);
  assert.match(head, /median 138\.1/);
});
