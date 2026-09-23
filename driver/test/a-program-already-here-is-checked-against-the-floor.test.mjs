// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PROGRAM ALREADY ON THIS MACHINE IS CHECKED AGAINST THE FLOOR, NOT ONLY THE ONE SETUP INSTALLS.
//
// The engine table declares the oldest version of the vendor's program this build asks for, and setup
// passed it to npm — so a program setup installs cannot land under it. A copy already on the machine
// wins over the installed one by design, and nothing compared its version to anything. The unchecked
// route is the one most machines take.
//
// What it costs is not a crash. The program carries its own list of accepted models, so a copy below the
// floor refuses the newest model of a tier and serves the one before it: the search finishes, the report
// is delivered, and the only trace is a model id in the record that nobody chose. Measured 2026-09-22 on
// 2.1.263 — the current top tier's id came back a 400, and the tier alias answered with the generation
// before it.
//
// Driven over version strings rather than programs: the comparison is pure, and the two surfaces that
// report it are given a resolved copy with a version on it. An old string and a current one, both ways.
import test from "node:test";
import assert from "node:assert/strict";
import { olderThanFloor, ENGINE_BINARIES } from "../driver.config.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { foundWords, cannotRunLine } from "../../bin/onboard.mjs";

const CLAUDE = ENGINE_BINARIES["anthropic-agent"];
const FLOOR = CLAUDE.floor;
// The version the vendor's own refusal named, and the one the box carried when it was measured.
const TOO_OLD = "2.1.263";
const CURRENT = "2.1.280";
const copy = (version, extra = {}) => ({ path: "/somewhere/bin/claude", executable: true, relative: false, source: "path", version, rejected: [], ...extra });

test("an old version sorts below the floor and a current one does not, part by part", () => {
  assert.equal(olderThanFloor(TOO_OLD, FLOOR), true);
  assert.equal(olderThanFloor(CURRENT, FLOOR), false);
  assert.equal(olderThanFloor("2.2.0", FLOOR), false);
  assert.equal(olderThanFloor("3.0.0", FLOOR), false);
  // THE COMPARISON THAT TEXT GETS WRONG. "2.1.99" is two hundred releases behind "2.1.280" and sorts
  // above it as a string, so a machine well under the floor would read as being past it.
  assert.equal(olderThanFloor("2.1.99", "2.1.280"), true);
  assert.equal(olderThanFloor("2.1.9", "2.1.280"), true);
  // A two-part version, and one the vendor prefixes, still place.
  assert.equal(olderThanFloor("2.0", "2.1.280"), true);
  assert.equal(olderThanFloor("v2.1.280", "2.1.280"), false);
});

test("what cannot be compared is not called a pass", () => {
  // Each of these is a real state: no version read from the copy, a program that answered in prose, and
  // an engine with no floor declared. None of them is evidence that the copy is new enough.
  for (const [version, floor] of [[null, FLOOR], [undefined, FLOOR], ["", FLOOR], ["a build from source", FLOOR],
    [CURRENT, null], [CURRENT, undefined], [TOO_OLD, ""]])
    assert.equal(olderThanFloor(version, floor), null, `${JSON.stringify(version)} against ${JSON.stringify(floor)} answered something other than "cannot compare"`);
});

test("setup's row names the version and the floor, and says the same thing when the engine is chosen", () => {
  const row = foundWords(CLAUDE, copy(TOO_OLD));
  assert.match(row, /problem:/, `an old copy still reads as found: "${row}"`);
  assert.ok(row.includes(TOO_OLD) && row.includes(FLOOR), `the row names neither the version it read nor the floor: "${row}"`);

  const said = cannotRunLine(CLAUDE, copy(TOO_OLD));
  assert.ok(said.includes(TOO_OLD) && said.includes(FLOOR), `the explanation names neither version: "${said}"`);
  // IT RUNS, AND THE WORDS MAY NOT SAY OTHERWISE. Every other problem on this path is a copy that cannot
  // start, and describing this one that way sends the reader to look for a broken install they do not have.
  assert.doesNotMatch(said, /incomplete|won't run|cannot run|isn't there/i,
    `an old copy is described as one that cannot run: "${said}"`);
  assert.match(said, /refuses the newest model|runs the one before it/i,
    `the explanation does not say what actually goes wrong: "${said}"`);
});

test("the stand-in program the suite spawns claims a version this build supports", () => {
  // NOT HOUSEKEEPING. Every arm that drives a healthy install spawns that mock, doctor now compares what
  // a program says against the floor, and the mock answers `--version` with a literal. When the floor
  // moved past it those arms went red together, all for this one string, and each of them read as a
  // defect in the thing it was actually testing. This says so once, here, and names the line to change.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mock-claude.mjs"), "utf8");
  const said = /process\.stdout\.write\("(\d+\.\d+\.\d+)[^"]*"\)/.exec(src);
  assert.ok(said, "mock-claude.mjs no longer answers --version with a plain version string");
  assert.notEqual(olderThanFloor(said[1], FLOOR), true,
    `mock-claude.mjs answers --version with ${said[1]}, older than the ${FLOOR} floor — doctor reports it as too old and every healthy-install arm fails on it. Raise that line.`);
});

test("a current copy reads as found, and one whose version was never read is not accused", () => {
  const row = foundWords(CLAUDE, copy(CURRENT));
  assert.equal(row, `found on this computer (version ${CURRENT})`);
  assert.doesNotMatch(row, /problem/, "a copy at the floor is reported as a problem");
  // A copy installed by a route that leaves no version to read: unknown, and unknown is not old.
  const unread = foundWords(CLAUDE, copy(null));
  assert.equal(unread, "found on this computer");
  assert.doesNotMatch(unread, /problem|older/, `a copy whose version could not be read is accused of being old: "${unread}"`);
});
