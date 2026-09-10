// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// TWO GUARDS, EACH RIGHT, THAT HAD COME TO CONTRADICT EACH OTHER.
//
// `a-bail-on-an-unmeetable-precondition-is-a-skip` requires an arm that cannot meet a precondition to
// say so with `ctx.skip(...)` rather than a bare `return;`, because node:test counts a bare return as a
// PASS. `mint-suite-census.mjs` counted a rising skip count as a LOSS and refused to re-stamp, because
// an arm that stopped running reads as one that passed. Both sentences are true. Following the first
// tripped the second, measured on `c6e183d`.
//
// Overwatch ruled on 2026-09-06: the bail guard is right, and a reasoned skip is neither a pass nor a
// loss. It gets its own bucket — printed, never silent, and not a refusal.
//
// WHY THE DECISION MOVED INTO shared/suite-census.mjs. It was spelled out twice inside the script, once
// per population, and the two copies had already drifted on their all-clear line. A ruling about what a
// census is FOR belongs where a test can reach it, which is the same move made for the unit-state and
// drainer verdicts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { censusBuckets, lossBetween } from "../../shared/suite-census.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const f = (tests, asserts, skips, todos = 0) => ({ tests, asserts, skips, todos });
const files = (b) => b.map((x) => x.file);

test("a rising skip count is a NOTE, never a loss, and never refuses", () => {
  const b = censusBuckets({ prev: { "a.test.mjs": f(10, 20, 0) }, next: { "a.test.mjs": f(10, 20, 2) } });
  assert.deepEqual(files(b.notes), ["a.test.mjs"]);
  assert.deepEqual(b.losses, [], "a skip landing in losses is the refusal that made following the bail guard impossible");
  assert.deepEqual(files(b.notes.filter((n) => n.kind === "SKIPPED")), ["a.test.mjs"]);
});

test("a rising TODO count is the same bucket, for the same reason", () => {
  const b = censusBuckets({ prev: { "a.test.mjs": f(3, 9, 0, 0) }, next: { "a.test.mjs": f(3, 9, 0, 1) } });
  assert.deepEqual(files(b.notes), ["a.test.mjs"]);
  assert.deepEqual(b.losses, []);
});

test("the bucket is a place to LOOK, not an exemption: a skip is reported whatever else moved", () => {
  // The census counts `skip(` sites in the text. It never sees a reason, honest or otherwise, and this
  // is the arm that stops a later reader assuming it does. A file that gained tests AND skips is in both
  // lists, and a file that lost assertions AND gained skips still refuses.
  const grewToo = censusBuckets({ prev: { "a.test.mjs": f(2, 4, 0) }, next: { "a.test.mjs": f(5, 9, 3) } });
  assert.deepEqual(files(grewToo.notes), ["a.test.mjs"]);
  assert.deepEqual(grewToo.grew, ["a.test.mjs"]);

  const shrankToo = censusBuckets({ prev: { "a.test.mjs": f(9, 20, 0) }, next: { "a.test.mjs": f(9, 11, 4) } });
  assert.deepEqual(files(shrankToo.notes), ["a.test.mjs"], "the skip is still named");
  assert.deepEqual(shrankToo.losses.map((l) => l.kind), ["SHRANK"], "and the lost assertions still refuse");
});

test("a skip-only change is NOT an all-clear", () => {
  // The teeth of the second acceptance point. Before this, a file that gained nothing but skips was
  // summarised as "(unchanged)" — an arm that stopped running, reported as a clean tree.
  const b = censusBuckets({ prev: { "a.test.mjs": f(10, 20, 0) }, next: { "a.test.mjs": f(10, 20, 1) } });
  assert.equal(b.allClear, false, "a stopped arm may not be rolled into an all-clear");
  assert.equal(censusBuckets({ prev: { "a.test.mjs": f(10, 20, 0) }, next: { "a.test.mjs": f(10, 20, 0) } }).allClear, true);
});

test("every LOSS shape still refuses — a census that stopped catching a gutting catches nothing", () => {
  const cases = [
    ["a file gone from the collection", { "a.test.mjs": f(10, 20, 0) }, {}, "REMOVED"],
    ["fewer tests inside one", { "a.test.mjs": f(10, 20, 0) }, { "a.test.mjs": f(9, 20, 0) }, "SHRANK"],
    ["fewer assertions inside one", { "a.test.mjs": f(10, 20, 0) }, { "a.test.mjs": f(10, 19, 0) }, "SHRANK"],
  ];
  for (const [why, prev, next, kind] of cases) {
    const b = censusBuckets({ prev, next });
    assert.deepEqual(b.losses.map((l) => l.kind), [kind], `${why} stopped refusing`);
    assert.equal(b.allClear, false);
  }
  // And the shapes that are NOT a loss stay out of it, or a green tree cannot be re-stamped at all.
  for (const [prev, next] of [[{}, { "a.test.mjs": f(1, 1, 0) }], [{ "a.test.mjs": f(1, 1, 0) }, { "a.test.mjs": f(4, 9, 0) }]]) {
    assert.deepEqual(censusBuckets({ prev, next }).losses, []);
  }
});

test("a withheld absence is declared only where a reader says so — and without one, every absence is damage", () => {
  const prev = { "cut.test.mjs": f(4, 8, 0), "kept.test.mjs": f(2, 3, 0) };
  const next = { "kept.test.mjs": f(2, 3, 0) };
  const declared = censusBuckets({ prev, next, withheld: (x) => (x === "cut.test.mjs" ? { path: "somewhere" } : null) });
  assert.deepEqual(declared.withheldGone, ["cut.test.mjs"]);
  assert.deepEqual(declared.losses, [], "a stated consequence of the cut is not a loss");
  assert.equal(declared.allClear, false, "and it is still not an all-clear — a stated absence read silently is one nobody noticed");

  const workspace = censusBuckets({ prev, next });
  assert.deepEqual(workspace.withheldGone, []);
  assert.deepEqual(workspace.losses.map((l) => l.file), ["cut.test.mjs"],
    "a workspace has no withheld register, so an absence there is damage and must refuse");
});

test("ABSENT IS NOT ZERO — a census minted before skips were counted reports no gain", () => {
  // The care lossBetween already took, pinned through the function that now consumes it. Reading an
  // absent field as a measured zero makes every file with a pre-existing skip look like it just gained
  // one, the first --apply after that refuses the whole tree, and the operator learns to pass
  // --allow-loss reflexively — the refusal being trained away.
  const prev = { "a.test.mjs": { tests: 10, asserts: 20 } };
  assert.deepEqual(censusBuckets({ prev, next: { "a.test.mjs": f(10, 20, 3) } }).notes, []);
  assert.deepEqual(lossBetween(prev, { "a.test.mjs": f(10, 20, 3) }).skipped, []);
});

test("BOTH populations read the one rule, and the script keeps no private copy", () => {
  // The ruling is "one bucket", and that is a property of the source: a second hand-rolled decision is
  // exactly how the two loops came to disagree about their all-clear line in the first place.
  const src = readFileSync(join(ROOT, "scripts", "mint-suite-census.mjs"), "utf8");
  // Counted on the CALL, not on a formatting of it — the root-script call wraps and the workspace one
  // does not, and an arm that reds on a reformat teaches the next reader to edit the arm.
  assert.ok((src.match(/\bcensusBuckets\s*\(/g) ?? []).length >= 2,
    "both the workspace and the root-script populations must decide through the shared function");
  assert.doesNotMatch(src, /lossBetween\(/, "the script decides through censusBuckets, not by re-reading the raw difference");
  // Nothing skip-shaped may reach the refusal list.
  for (const line of src.split("\n")) {
    if (/lost\.push\(/.test(line) || /^\s*lost\.push/.test(line)) {
      assert.doesNotMatch(line, /skip/i, `a skip reaching the refusal list is the old defect returning: ${line.trim()}`);
    }
  }
  // And the bucket is printed before the mode branches, so no mode can be the one that hides it.
  const bucketAt = src.indexOf("SKIPPED WITH REASON");
  assert.notEqual(bucketAt, -1, "the bucket's heading is gone — a bucket nobody prints is the failure both guards exist to stop");
  assert.ok(bucketAt < src.indexOf("if (CHECK) {"), "the bucket must print before --check returns");
  assert.ok(bucketAt < src.indexOf("if (!APPLY) {"), "the bucket must print before the dry run returns");
  assert.ok(bucketAt < src.indexOf("REFUSING TO RE-STAMP"), "the bucket must print before --apply refuses");
});
