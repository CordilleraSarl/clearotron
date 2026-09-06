// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tracker issue 146 — A FALSE RED INDISTINGUISHABLE FROM A TRUE ONE.
//
// Adding a `git worktree` and symlinking `node_modules` from another one reds six licence arms on
// whatever branch happens to be checked out. `npm ls` resolves through the symlink, finds a tree that
// does not match this worktree's lockfile, and calls every package extraneous. Measured in the issue:
// symlinked, 6 failures over 3100 problems; a real `npm install` from the repo root, 14/14 pass — same
// worktree, same commit, same arms.
//
// The arms are RIGHT. They refuse a tree nobody has looked at, and nobody has. What was missing is the
// only thing a reader could act on: the refusal named a compliance property, so it read as "this change
// broke the notices file" while the file was untouched. It survives a rebase, a fresh branch and a clean
// tree, because the fault is in none of them, and a lane came within one measurement of reporting six
// licence failures against somebody else's diff.
//
// WHAT THESE ARMS PROTECT. That the note names the cause when the cause is present, and — the one that
// matters more — that it is silent and changes nothing when a real licence problem is what npm found.
// A note that softened a genuine refusal would be a worse defect than the one it repairs.
import test from "node:test";
import assert from "node:assert/strict";
import { foreignTreeNote, collect, undeclaredProblems } from "../../scripts/third-party-notices.mjs";

const BORROWED = "/home/x/other-worktree/node_modules";
const linked = () => BORROWED;
const notLinked = () => null;
const extraneous = (n) => Array.from({ length: n }, (_, i) => `extraneous: pkg-${i}@1.0.0 /w/node_modules/pkg-${i}`);
const missing = (n) => Array.from({ length: n }, (_, i) => `missing: dep-${i}@^1.0.0, required by root`);
const REAL = "invalid: some-dep@1.2.3 does not satisfy ^2.0.0";
// MEASURED, NOT ASSUMED. The issue says a borrowed tree makes "every package extraneous". Driven in a
// real worktree with a symlinked node_modules it is 2485 missing, 306 extraneous and 5 invalid — the
// workspace links resolve elsewhere, so most DECLARED packages read as missing rather than as spare
// ones. A detector keyed on `extraneous` alone would have been narrower than the fault it is named for.
const BORROWED_SHAPE = [...missing(2485), ...extraneous(306), ...Array(5).fill(REAL)];

/** The error, or a failure saying nothing threw — `assert.throws` hands back undefined, not the error. */
const threw = (fn) => {
  try { fn(); } catch (e) { return e; }
  assert.fail("the refusal did not fire at all, so there was no message to read — that is the finding");
};

test("tracker issue 146 — a SYMLINKED node_modules is named, with the tree it was borrowed from", () => {
  const note = foreignTreeNote("/w", BORROWED_SHAPE, { linkTarget: linked });
  assert.match(note, /SYMLINK to \/home\/x\/other-worktree\/node_modules/);
  assert.match(note, /2485 missing, 306 extraneous, 5 invalid/, "the shape is counted, so a reader can recognise it again");
  assert.match(note, /working correctly/, "the reader must be told the arms are right before they go looking for a code defect");
  assert.match(note, /npm install` from this repo root/, "and told the one command that fixes it");
});

test("tracker issue 146 — a borrowed tree is named WHATEVER the rows are, because none of them can be trusted", () => {
  // Not a softening, and the distinction is the whole care here. A symlinked node_modules means npm
  // compared another tree against this lockfile, so every row is about the wrong tree — including a row
  // that would be a real finding on a real install. The refusal above is unchanged; this says where to
  // start. It is a direct reading of the box, never an inference from the rows.
  for (const rows of [[REAL], missing(3), extraneous(1), BORROWED_SHAPE]) {
    assert.match(foreignTreeNote("/w", rows, { linkTarget: linked }), /is a SYMLINK to/);
  }
});

test("tracker issue 146 — WITHOUT a symlink the claim is an inference, and is made only where it is overwhelming", () => {
  // A real dependency problem is a handful of rows. Below the floor this says nothing rather than
  // talking a reader out of a finding, which would be a worse defect than the one it repairs.
  assert.equal(foreignTreeNote("/w", [REAL], { linkTarget: notLinked }), null);
  assert.equal(foreignTreeNote("/w", missing(3), { linkTarget: notLinked }), null, "three missing packages is a problem, not a foreign tree");
  assert.equal(foreignTreeNote("/w", extraneous(19), { linkTarget: notLinked }), null, "one row below the floor still says nothing");
  const note = foreignTreeNote("/w", [...missing(500), ...extraneous(500)], { linkTarget: notLinked });
  assert.doesNotMatch(note, /SYMLINK/, "claiming a symlink that is not there sends the reader to look for one");
  assert.match(note, /every one of the 1000 problem\(s\)/);
  assert.match(note, /500 missing, 500 extraneous/);
  assert.match(note, /DIFFERENT lockfile/);
});

test("tracker issue 146 — A REAL PROBLEM AMONG THOUSANDS still stops the inference on an unlinked tree", () => {
  // One row that is NOT a mismatch shape means this is not simply a foreign install, so the weaker
  // claim is not available and nothing is said.
  const rows = [...missing(2000), "ERESOLVE: something else entirely"];
  assert.equal(foreignTreeNote("/w", rows, { linkTarget: notLinked }), null);
});

test("tracker issue 146 — nothing to report is never a note", () => {
  for (const linkTarget of [linked, notLinked]) {
    assert.equal(foreignTreeNote("/w", [], { linkTarget }), null, "a clean tree cannot produce this note");
    assert.equal(foreignTreeNote("/w", null, { linkTarget }), null);
  }
});

test("tracker issue 146 — DRIVEN through the real refusal: appended, never substituted", () => {
  // Through `collect`, which is what the six licence arms call, so this is the message they print.
  const tree = { problems: BORROWED_SHAPE, name: "root", version: "0.0.0", dependencies: {} };
  const e = threw(() => collect(process.cwd(), tree, { linkTarget: linked }));
  // The refusal it always had, unchanged and still first.
  assert.match(e.message, /npm ls reports 2796 problem\(s\) nothing declares/);
  assert.match(e.message, /Fix the tree, or declare it in DECLARED_LS_PROBLEMS/);
  // …and then the cause.
  assert.match(e.message, /BEFORE READING THIS AS A LICENCE DEFECT/);
  assert.match(e.message, /SYMLINK to \/home\/x\/other-worktree\/node_modules/);
  // The 3100 rows do not scroll the cause off the screen — that is why nobody saw it.
  assert.match(e.message, /…and 2784 more/);
  assert.ok(e.message.split("\n").length < 30,
    `the refusal is ${e.message.split("\n").length} lines; a reader scrolling 2796 of them is how this went undiagnosed`);
  assert.match(e.message, /2796 problem/, "and the total is still stated, so nothing is hidden by the truncation");
});

test("tracker issue 146 — a genuine undeclared problem throws with NO note, driven the same way", () => {
  const tree = { problems: [REAL], name: "root", version: "0.0.0", dependencies: {} };
  const e = threw(() => collect(process.cwd(), tree, { linkTarget: notLinked }));
  assert.match(e.message, /npm ls reports 1 problem\(s\) nothing declares/);
  assert.match(e.message, /some-dep@1\.2\.3/);
  assert.doesNotMatch(e.message, /BEFORE READING THIS AS A LICENCE DEFECT/,
    "a borrowed tree is not an excuse for a real problem, even on a box that has one");
});

test("the declared-problem filter still decides what reaches the refusal at all", () => {
  // The note sits downstream of this, so an arm that stopped filtering would change what it fires on.
  assert.deepEqual(undeclaredProblems(["extraneous: a@1"], [{ match: /^extraneous:/ }]), []);
  assert.deepEqual(undeclaredProblems(["extraneous: a@1"], []), ["extraneous: a@1"]);
});
