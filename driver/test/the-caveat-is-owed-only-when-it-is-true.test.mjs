// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-caveat-is-owed-only-when-it-is-true.test.mjs — the verifier learns the doctrine the producer knew.
//
//. `pipeline-knockout` injects the standing caveat only when the seat supplied NONE and
// the register surfaced NO filings. `verify-knockout` required it UNCONDITIONALLY. Any run where the
// rater wrote its own matter-specific caveats — or where the register surfaced filings — failed by
// construction.
//
// R13's first run ever died there. All four marks were rated, the reasoning named the famous holders and
// weighed manner-of-use, and none of it reached a findings file because the lint refused the merge. The
// message named a missing caveat, sending a reader to the rater, and the rater had done nothing wrong —
// the false-defect class.
//
// RF-10 v3: when register analysis ran AND surfaced live filings, the caveat is FALSE. It describes work
// that already happened, so requiring it would be requiring an untruth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSurfacedFilings, validateMergedFindings, raterCaveats, isEngineAppendedCaveat } from "../verify-knockout.mjs";
import { survivorBoundaryNote } from "../pipeline-knockout.mjs";
import { CAPABILITY_SKIPPED_NOTE } from "../search-policy.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const runWith = (records) => {
  const dir = mkdtempSync(join(tmpdir(), "ko-1926-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (records !== undefined) writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify(records));
  return dir;
};
const merged = (caveats) => ({
  schema_version: 1,
  batch: { executiveSummary: "a summary", ...(caveats === undefined ? {} : { standardCaveats: caveats }) },
  marks: [],
});
const caveatFailure = (r) => (r.failures ?? []).find((x) => /standing caveat/.test(x));

test("1926 THE DEFECT: a rater's own caveats no longer fail the merge", () => {
  // The R13 shape — three sensible matter-specific caveats, none of them the standing sentence.
  const dir = runWith([]);
  const f = validateMergedFindings(dir, merged([
    "Triage, not clearance.", "Class- and manner-specific.", "Aurora advisory only.",
  ]), { marks: [] });
  assert.equal(caveatFailure(f), undefined,
    "a run whose rater supplied its own caveats still fails the lint — this is the defect, and it killed "
    + "a run with all four marks rated");
});

test("1926 the caveat is still OWED when the rater supplied none and the register surfaced nothing", () => {
  // The case the caveat is true for, and it must keep failing.
  for (const records of [[], undefined, { records: [] }]) {
    const dir = runWith(records);
    const f = validateMergedFindings(dir, merged(undefined), { marks: [] });
    assert.ok(caveatFailure(f),
      `records=${JSON.stringify(records)}: the standing caveat is owed here and the lint let it through`);
    assert.match(caveatFailure(f), /this run owes it/, "the failure must say WHY it is owed");
  }
});

test("1926 a register that surfaced filings does not owe the caveat — it would be FALSE", () => {
  const dir = runWith({ records: [{ mark: "FROZEN" }] });
  const f = validateMergedFindings(dir, merged(undefined), { marks: [] });
  assert.equal(caveatFailure(f), undefined,
    "the register surfaced filings, so 'register analysis MAY adjust' describes work that already "
    + "happened — requiring it is requiring an untruth");
});

test("1926 whitespace caveats are NOT supplied caveats", () => {
  // An array of blanks would otherwise waive the requirement while saying nothing to a reader.
  const dir = runWith([]);
  const f = validateMergedFindings(dir, merged(["", "   "]), { marks: [] });
  assert.ok(caveatFailure(f), "blank entries counted as the rater having supplied caveats");
});

test("1926 ONE derivation: the predicate answers the same for producer and verifier", () => {
  // The two disagreed because each had its own copy. This is the shared one, and both sides import it.
  assert.equal(registerSurfacedFilings(join(runWith({ records: [{ a: 1 }] }), "_driver", "register-records.json")), true);
  assert.equal(registerSurfacedFilings(join(runWith([]), "_driver", "register-records.json")), false);
  assert.equal(registerSurfacedFilings("/no/such/file.json"), false, "an unreadable file is 'surfaced nothing', not a throw");
  // Both shapes the file has carried.
  assert.equal(registerSurfacedFilings(join(runWith([{ x: 1 }]), "_driver", "register-records.json")), true);
});

test("1926 the producer imports the shared predicate rather than keeping its own", () => {
  const src = readFileSync(new URL("../pipeline-knockout.mjs", import.meta.url), "utf8");
  assert.match(src, /registerSurfacedFilings.*from "\.\/verify-knockout\.mjs"/,
    "the producer no longer imports the shared predicate");
  assert.equal(/const registerSurfacedFilings = \(\(\) =>/.test(src), false,
    "the producer has grown its own copy back — two predicates that must agree forever is how they stop");
});


// ── — THE SHAPE THE PRODUCER ACTUALLY EMITS ───────────────────────────────────────
//
// Every arm above builds the caveats array as it stands at the INJECTION site. The producer then appends
// the survivor sentence unconditionally, and only THEN calls the lint — so no arm above had ever driven
// a document the pipeline emits, and the lint could not fire on one.
//
// The survivor sentence is the real one from `survivorBoundaryNote`, not a stand-in: a fixture that
// invents the engine's own words proves nothing about whether the verifier recognises them.

const SURVIVOR = survivorBoundaryNote({ level: "knockout-search" });

test("2042 THE DEFECT: a pipeline-shaped document with NO standing caveat used to pass", () => {
  // Gimli's row 3. The standing caveat is entirely absent, the register surfaced nothing, and the run
  // owes it — but the survivor sentence made `supplied` non-empty, so the lint said nothing at all.
  const dir = runWith([]);
  const f = validateMergedFindings(dir, merged([SURVIVOR]), { marks: [] });
  assert.ok(caveatFailure(f),
    "the engine's own survivor sentence is not a caveat the RATER supplied, and a run missing the "
    + "standing caveat must still be caught once it is appended");
});

test("2042 blanks plus the survivor sentence are still nobody's caveats", () => {
  const dir = runWith([]);
  assert.ok(caveatFailure(validateMergedFindings(dir, merged(["", "   ", SURVIVOR]), { marks: [] })));
});

test("2042 the capability-skipped note is the engine's words too", () => {
  const skipped = CAPABILITY_SKIPPED_NOTE["common-law-no-credential"];
  assert.ok(isEngineAppendedCaveat(skipped), "the engine states it, the rater does not");
  const dir = runWith([]);
  assert.ok(caveatFailure(validateMergedFindings(dir, merged([SURVIVOR, skipped]), { marks: [] })),
    "two engine sentences and nothing from the rater is still a run that owes the standing caveat");
});

test("2042 THE CONTROL — the pipeline's HAPPY shape stays silent", () => {
  // Three arms above assert a failure. A lint that failed every pipeline-shaped document would satisfy
  // all three and refuse every real run, which is the false-defect class 1926 was raised to kill.
  const dir = runWith([]);
  const standing = "Ratings reflect our common law assessment. Register analysis may adjust ratings in either direction.";
  assert.equal(caveatFailure(validateMergedFindings(dir, merged([standing, SURVIVOR]), { marks: [] })), undefined,
    "standing caveat injected, survivor appended — what the producer emits when the rater supplies nothing");
  assert.equal(caveatFailure(validateMergedFindings(dir, merged(["Triage, not clearance.", SURVIVOR]), { marks: [] })), undefined,
    "and a rater's own caveat beside the survivor sentence is still the rater having supplied one");
  // And the register-surfaced branch, which owes nothing whatever the array holds.
  assert.equal(caveatFailure(validateMergedFindings(runWith([{ mark: "X" }]), merged([SURVIVOR]), { marks: [] })), undefined,
    "a register that surfaced filings does not owe a caveat that would be false");
});

test("2042 raterCaveats is the ONE derivation, and both sides call it", () => {
  assert.deepEqual(raterCaveats([SURVIVOR]), [], "the engine's sentence is not the rater's");
  assert.deepEqual(raterCaveats(["", "  "]), [], "and blanks never were");
  assert.deepEqual(raterCaveats(["Triage, not clearance.", SURVIVOR]), ["Triage, not clearance."]);
  const producer = readFileSync(new URL("../pipeline-knockout.mjs", import.meta.url), "utf8");
  assert.match(producer, /raterCaveats\(merged\.batch\.standardCaveats\)/,
    "the producer must decide injection with the same predicate the lint decides omission with — a private "
    + "copy is how the two stopped agreeing in the first place");
  assert.doesNotMatch(producer, /!merged\.batch\.standardCaveats\?\.length/,
    "and must not go back to counting the array, blanks included");
});

test("2042 the requester's email never opens on a blank line", () => {
  const publish = readFileSync(new URL("../publish/knockout.mjs", import.meta.url), "utf8");
  assert.match(publish, /\.find\(Boolean\)/,
    "the email takes the first NON-BLANK caveat: `?? fallback` catches null and undefined, never \"\", "
    + "so an empty element 0 put an empty italic line at the top of the client's message");
  assert.doesNotMatch(publish, /standardCaveats \?\? \[\]\)\[0\]/, "element 0 is no longer taken blind");
});
