// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE CANDIDATE POPULATION IS DISCOVERED, NOT RECALLED.
//
// The issue's deliverable says so in those words, and the thread is the argument for it: the population
// was posted as 241 lines on one day and measured at 251 sites the next, and the first list anyone could
// act on lived at a path inside one box's scratchpad. A `file:line` list is a dangling pointer within a
// day — which is the same defect class the sweep itself hunts, committed by the sweep's own bookkeeping.
//
// So the artifact is the classifier, and this file is what stops it rotting quietly. The arms below are
// in two groups: the CLASSIFICATION RULES, pinned on literal fixtures, and one measurement against the
// real corpus with a floor, so a classifier that silently stops finding anything reds instead of
// reporting a small population.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSource, sweep, GUARD } from "../../scripts/travelling-predicates.mjs";
import { skipReason } from "../../shared/tracked-files.mjs";

const where = (src) => scanSource(src, "fixture.mjs").map((r) => r.where);
const buckets = (src) => scanSource(src, "fixture.mjs").map((r) => r.bucket);

// ── the climb, which is the whole trick ──────────────────────────────────────────────────────────────

test("#1100 a predicate under && is classified by where the ENCLOSING expression goes", () => {
  // Classifying on the immediate parent files this as "inside a LogicalExpression" and loses it. The
  // measured cost of getting this wrong was 22% travelling against a true 37% — nearly a third of the
  // population sits under exactly this shape.
  assert.deepEqual(where(`const ok = Array.isArray(xs) && xs.some((x) => x.q);`), ["local"]);
  assert.deepEqual(where(`function f() { return a && b.every((x) => x.q); }`), ["return"]);
  assert.deepEqual(where(`const ok = !xs.some((x) => x.q);`), ["local"], "! is plumbing too");
  assert.deepEqual(where(`const ok = xs?.some((x) => x.q) ?? false;`), ["local"], "optional chaining is plumbing");
});

// ── the bug this classifier had, and the distinction that fixes it ───────────────────────────────────

test("#1100 a NAMED predicate travels; an INLINE one passed to filter does not", () => {
  // Both have `arrow.body === theCall`. Treating the arrow itself as the verdict made this classifier
  // report 111 travelling where an independently written one measured 93 — and the 18 it added were all
  // this shape. What decides is where the ARROW goes, so the arrow is plumbing and the climb continues.
  assert.deepEqual(where(`const isReady = (x) => x.parts.every((p) => p.ok);`), ["named-pred"]);
  assert.deepEqual(buckets(`const isReady = (x) => x.parts.every((p) => p.ok);`), ["travels"]);

  assert.deepEqual(where(`rows.filter((x) => x.tags.some((t) => t.ok));`), ["decided"]);
  assert.deepEqual(buckets(`rows.filter((x) => x.tags.some((t) => t.ok));`), ["decided"],
    "an inline predicate is acted on where it stands — it has one end and cannot be a member of the class");
});

// ── decided in place ─────────────────────────────────────────────────────────────────────────────────

test("#1100 a predicate consumed by a test right here is DECIDED, not a candidate", () => {
  for (const src of [
    `if (xs.some((x) => x.q)) { go(); }`,
    `const v = xs.some((x) => x.q) ? 1 : 2;`,
    `while (xs.every((x) => x.q)) { step(); }`,
    `xs.some((x) => x.q);`,
  ]) assert.deepEqual(buckets(src), ["decided"], src);
});

test("#1100 a ternary BRANCH is plumbing, and a ternary TEST is a decision", () => {
  // These two look alike and are opposites. The test position decides right there; a branch position
  // hands the boolean onward, and the climb has to continue to whatever holds the ternary.
  //
  // Getting this wrong did not misclassify anything — it produced an UNRESOLVED bucket, which reads as
  // a limit of the pattern rather than as a gap in the instrument. All three unresolved sites on main
  // were this one shape (gateway.mjs:1407, reasoning-tripwires.mjs:82, register-plan.mjs:318), and the
  // discovered population went from 93 to 96 once it was fixed.
  assert.deepEqual(buckets(`const v = xs.some((x) => x.q) ? 1 : 2;`), ["decided"], "the TEST decides here");
  assert.deepEqual(where(`const v = n ? xs.some((x) => x.q) : null;`), ["local"], "a consequent travels");
  assert.deepEqual(where(`const v = n ? null : xs.some((x) => x.q);`), ["local"], "so does an alternate");
  assert.deepEqual(where(`function f() { return n ? xs.some((x) => x.q) : false; }`), ["return"],
    "and it keeps climbing past the ternary to whatever actually holds the value");
  // No shape may land outside a named bucket. An unresolved row is a hole in the instrument, and a
  // discovered number is only as good as the classifier's coverage of the corpus it walked.
  for (const src of [`const v = n ? xs.some((x) => x.q) : null;`, `const v = n ? null : xs.every((x) => x.q);`])
    assert.ok(!buckets(src).includes("unresolved"), `unresolved: ${src}`);
});

test("#1100 the travelling shapes are each recognised, and named apart", () => {
  assert.deepEqual(where(`const a = xs.some((x) => x.q);`), ["local"]);
  assert.deepEqual(where(`function f() { return xs.some((x) => x.q); }`), ["return"]);
  assert.deepEqual(where(`o.flag = xs.some((x) => x.q);`), ["assign"]);
  assert.deepEqual(where(`const o = { flag: xs.some((x) => x.q) };`), ["field"]);
  // The words matter: the issue's thread classifies by them, and a bucket that collapsed them would
  // hide which end of the contract a reader has to go and find.
  assert.deepEqual(buckets(`const a = xs.some((x) => x.q);`), ["travels"]);
});

test("#1100 only a NON-COMPUTED some/every member call is hunted", () => {
  assert.deepEqual(scanSource(`const a = xs["some"]((x) => x.q);`, "f.mjs"), [],
    "a computed member is not the syntactic pattern, and counting it would inflate the population");
  assert.deepEqual(scanSource(`const a = somebody(xs);`, "f.mjs"), []);
});

// ── an unparsed file is a HOLE in the population, and must never be silent ───────────────────────────

test("#1100 a file that cannot be parsed is REPORTED, never skipped", () => {
  const rows = scanSource(`const a = ;;;(((`, "broken.mjs");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bucket, "unparsed",
    "a silently skipped file is a hole in a population whose whole purpose is completeness");
  assert.ok(rows[0].why && rows[0].why.length, "and it says why, or nobody can fix it");
});

// ── the real corpus, with a floor ────────────────────────────────────────────────────────────────────

test("#1100 the classifier still finds a population, and none of it is unparsed", (ctx) => {
  const rows = sweep();
  // — the marker IS printed, and node:test still counts a bare return as a PASS. The gate greps
  // stderr; a reader watching the run sees a green arm that read nothing.
  if (rows === null) return ctx.skip(skipReason(GUARD));
  const tally = rows.reduce((a, r) => { a[r.bucket] = (a[r.bucket] ?? 0) + 1; return a; }, {});

  // A FLOOR, NOT AN EQUALITY. The count moves with the tree — that is the premise of this whole file —
  // so pinning it would red on every unrelated commit and get the guard deleted. What must never happen
  // is finding NOTHING and reading as "the class is clean".
  assert.ok((tally.travels ?? 0) >= 40,
    `only ${tally.travels ?? 0} travelling sites — the classifier stopped classifying, and an empty `
    + "sweep reads as a clean sweep");
  assert.ok((tally.decided ?? 0) >= 40, "the decided bucket emptied — the climb is mis-terminating");
  assert.equal(tally.unparsed ?? 0, 0,
    "a driver file no longer parses as an ES module; the population has a hole in it");
});
