// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — pure snapshot/diff over injected directory listings
// — A STAGE WROTE ITS REAL OUTPUT INTO A MATTER DIRECTORY ONE LETTER OFF.
//
// On the codex engine, with the sandbox bypassed, `--add-dir` stops being a fence: a write outside it
// does not fail, it silently creates the whole tree. A stage wrote 9.8 KB of findings into a sibling
// matter directory whose slug was mistyped by one letter, while the validator failed the stage on the
// thin file at the correct path — twice, byte-identical. The driver's dispatch carried the correct slug
// every time and the typo zero times, so the model was told the right path and wrote elsewhere.
//
// Nothing said so. The stray tree sits in the studio root beside real matters, one letter from a real
// matter name, holding a plausible-looking clearance artifact, and it took a human comparing two
// directory listings by eye to find it.
//
// This does not delete and does not fail a run — the same posture as the doctrine sweep it is modelled
// on. Deleting a file a model wrote destroys evidence about a stage's behaviour, and failing the run
// turns a hygiene defect into a lost clearance. The value is that the stray stops being invisible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matterSiblings, findStrayMatterSiblings, withinOneEdit } from "../stray-artifacts.mjs";

const dirs = (...names) => (_root) => names.map((n) => ({ name: n, isDirectory: () => true }));
const OWN = "tmp0000-fixture-alpha";
const TYPO = "tmp0000-fixture-alph";       // one DELETION — the shape that bit
const OTHER = "tmp0000-unrelated-matter";

test("2151 a matter directory one edit from this run's own is reported AND flagged", () => {
  const before = matterSiblings("/studio", dirs(OWN, OTHER));
  const after = matterSiblings("/studio", dirs(OWN, OTHER, TYPO));
  const stray = findStrayMatterSiblings(before, after, { own: OWN });
  assert.equal(stray.length, 1);
  assert.equal(stray[0].name, TYPO);
  assert.equal(stray[0].nearMiss, true,
    "a one-letter sibling is the hazardous class — a reader cannot tell it from the real matter by eye");
});

test("2151 a stray that is NOT a near-miss is still reported, not judged uninteresting", () => {
  // Flagging rather than filtering. A rule that only reported near-misses would silently drop every
  // other way a directory can appear where none should.
  const before = matterSiblings("/studio", dirs(OWN));
  const after = matterSiblings("/studio", dirs(OWN, "tmp0000-something-else-entirely"));
  const stray = findStrayMatterSiblings(before, after, { own: OWN });
  assert.equal(stray.length, 1, "it appeared during a run that did not create it — that is the finding");
  assert.equal(stray[0].nearMiss, false, "…and it is reported as what it is");
});

test("2151 an empty snapshot reports NOTHING — `we never looked` is not `everything is stray`", () => {
  const after = matterSiblings("/studio", dirs(OWN, TYPO, OTHER));
  assert.deepEqual(findStrayMatterSiblings(new Set(), after, { own: OWN }), [],
    "reporting every matter on the box as a stray would make the first real one invisible");
});

test("2151 an unreadable studio root yields an empty snapshot rather than throwing", () => {
  const boom = () => { throw new Error("EACCES"); };
  assert.equal(matterSiblings("/studio", boom).size, 0, "a hygiene sweep must never be able to cost a run");
});

test("2151 the near-miss test, INCLUDING what it deliberately does not catch", () => {
  assert.equal(withinOneEdit("berrycake", "berycake"), true, "one deletion — the shape that was observed");
  assert.equal(withinOneEdit("alpha", "alphx"), true, "one substitution");
  assert.equal(withinOneEdit("alpha", "alphax"), true, "one insertion");
  assert.equal(withinOneEdit("alpha", "alpha"), false, "identical is the thing itself, not a near-miss");
  assert.equal(withinOneEdit("alpha", "beta"), false);
  assert.equal(withinOneEdit("alpha", "alphaxy"), false, "two insertions is not one edit");

  // A TRANSPOSITION IS DISTANCE TWO and is NOT flagged, which my first fixture got wrong — I wrote
  // "aplha" as the near-miss case and the arm went red, correctly. Saying so here rather than widening
  // the test to fit the code: the flag is a HINT, and the guarantee is the arm above it — EVERY stray
  // matter directory is reported whether or not it is a near-miss, so a transposed slug is still seen.
  assert.equal(withinOneEdit("alpha", "aplha"), false, "swapped letters are two edits; still REPORTED, just not flagged");
});
