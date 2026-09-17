// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// "I COULD NOT LOOK" AND "THIS HAS DRIFTED" ARE DIFFERENT ANSWERS AND WANT DIFFERENT THINGS DONE.
//
// The deployment check reported both through one FAIL. Two of its arms said, in their own message, "This
// is a failure to look, never a pass" — and then returned the verdict a genuine drift returns, so a reader
// could not tell the two apart without reading to the end of the message. A drift is fixed by redeploying.
// A could-not-look is fixed by pointing the check at something it can read, and until somebody does,
// nothing is known about that surface either way.
//
// The cost of leaving it is that a FAIL which turns out to be "could not look" teaches whoever runs the
// check to read FAIL as noise, and the run where it means drift is the one nobody acts on.
//
// AND THE FIX HAD TO AVOID DOING THE SAME THING ONE LEVEL UP. Several surfaces are deliberately not
// probed — the client door answers behind an access proxy, a door this instance does not name has no
// address to dial — and those are the resting state of a healthy box. An exit code that moved on every
// skip would fire on every good run and be ignored inside a week, which is this defect wearing a hat.
// So a could-not-look is marked distinctly from an ordinary skip, and only it moves the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { exitFor } from "../surface-exit-verdict.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const SRC = readFileSync(join(ROOT, "scripts", "live-surface-check.mjs"), "utf8");

test("the three answers are three exit codes, and a drift outranks a could-not-look", () => {
  assert.equal(exitFor({ failed: 0, couldNotLook: 0 }), 0, "everything read, nothing disagreed");
  assert.equal(exitFor({ failed: 2, couldNotLook: 0 }), 1, "a drift — redeploy, and the report names which");
  assert.equal(exitFor({ failed: 0, couldNotLook: 3 }), 3,
    "nothing drifted and a surface could not be read: a different errand, so a different code");
  assert.equal(exitFor({ failed: 1, couldNotLook: 5 }), 1,
    "both present ⇒ the drift wins, because it is actionable now and the unreadable surface is a second "
    + "errand. It is on the report either way; only the code is ordered.");
});

test("no argument is not a pass by omission", () => {
  // `exitFor()` with nothing is a caller that measured nothing. It answers 0 here because the counts
  // default to zero, and that is only safe while the caller cannot reach it without having counted — so
  // this arm exists to make the assumption visible rather than to bless it.
  assert.equal(exitFor(), 0);
  assert.equal(exitFor({}), 0);
});

test("an ordinary skip does NOT move the exit code", () => {
  // The direction that keeps this usable. A healthy box skips several surfaces by design, and a code that
  // moved on those would be indistinguishable from a code that never moves.
  assert.equal(exitFor({ failed: 0, couldNotLook: 0 }), 0,
    "skips that are not blocked never reach this function, and nothing else may imply them");
});

test("no arm in the check admits a failure to look and then returns a drift", () => {
  // THE PROPERTY, not the two sites. Stated over the whole file so it catches a new arm written the old
  // way, which a test naming the two known ones could not. It is a rule about this file's own prose
  // contract: the sentence "failure to look" is the author saying the surface was not compared, and the
  // verdict beside it may not be the one a real disagreement returns.
  //
  // Read off the source because the two arms it guards need a deployment whose workspace root cannot be
  // resolved — not a state reachable from a test box, and a check that could only be driven where it
  // cannot run would be worth less than this.
  const failSites = SRC.split(/\bfail\(/).slice(1);
  const offenders = failSites
    .map((chunk) => chunk.slice(0, chunk.indexOf(");") + 1))
    .filter((chunk) => /failure to look/i.test(chunk));
  assert.deepEqual(offenders, [],
    "an arm says it could not look and returns the verdict a drift returns — use the blocked reporter, "
    + `which is a skip that moves the exit code. Offending text: ${offenders.join(" · ").slice(0, 300)}`);
});

test("every result carries the marker, so a reader of the JSON can tell the two apart", () => {
  // The distinction has to survive to the consumer or it is only a nicer terminal. Asserted on the shape
  // of the record rather than on a live run, which needs a deployment.
  assert.match(SRC, /const record = \(name, state, detail, blocked = false\) =>/,
    "every record carries the marker, defaulted, so an arm that does not think about it is not blocked");
  assert.match(SRC, /results\.push\(\{ name, state, detail, blocked \}\)/,
    "…and it is written into the result the --json consumer reads, not only used for the terminal");
});
