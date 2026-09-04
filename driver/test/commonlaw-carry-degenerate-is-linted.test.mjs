// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A LANE FLAGGED ITS OWN TRACE WRONG AND THE GATE WAS NOT LOOKING AT THAT ARTIFACT.
//
// `commonlaw-carry.mjs:441` computes `degenerate` for the common-law grid and each jx slice, on the
// same shape `record-carry.mjs` uses: not one retrieved candidate reached a finding, while the
// findings themselves name URLs from that lane. Both are statements about the same candidates, so
// the trace is wrong — and its drop counts must not be quoted.
//
// `predelivery-lint.mjs` had ONE degenerate arm and it read `record-carry` only. Nothing anywhere
// read the common-law or jx carries. On a full-country run (2026-08-23) the `jx-zh-grid` slice
// recorded `degenerate: true` — 567 retrieved, 0 findings, 65 findings_urls — while
// `record-carry.degenerate` was `false`. The one arm that existed never fired, and no surface a
// person reads carried it. I then quoted that artifact's drop count in a published measurement and
// had to withdraw it.
//
// The run is cited by DATE, not codename: a run codename is a client identifier and this tree is
// de-identified by design. The figures below are counts, which identify nobody.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { commonLawCarryChecks, runLint } from "../predelivery-lint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The shape that sets `degenerate`: nothing reached a finding, yet the findings cite this lane. */
const degenerateSlice = (over = {}) => ({
  slice: "jx-zh-grid", computable: true, consumed: true, stage_completed: true,
  degenerate: true, findings_urls: 65,
  totals: { retrieved: 567, finding: 0, dropped: 567, unreasoned: 455 },
  ...over,
});

const healthySlice = () => ({
  slice: "common-law", computable: true, consumed: true, stage_completed: true,
  degenerate: false, findings_urls: 40,
  totals: { retrieved: 3584, finding: 115, dropped: 3469, unreasoned: 752 },
});

test("a degenerate slice raises a structural check naming the lane", () => {
  const checks = commonLawCarryChecks({ carries: [degenerateSlice()] });
  const d = checks.find((c) => c.id === "commonlaw-carry-degenerate:jx-zh-grid");

  assert.ok(d, `the degenerate slice must raise a check: got ${JSON.stringify(checks.map((c) => c.id))}`);
  assert.equal(d.pass, false);
  assert.equal(d.structural, true, "structural, so it rides the delivery banner rather than a debug sink");
  assert.match(d.detail, /567/, "the retrieved count belongs in the message");
  assert.match(d.detail, /65 URL/, "…and the independent evidence that candidates DID surface");
  assert.match(d.detail, /the TRACE is wrong/,
    "the wording must say the trace is wrong, NOT that recall failed — reading this as a recall "
    + "failure sends the fix at the search lane, which is the #420 shape this check exists to prevent");
  assert.match(d.detail, /do not quote its drop counts/,
    "and it must say so explicitly: I quoted them and had to withdraw the number");
});

test("CONTROL — the same slice with one finding raises nothing", () => {
  // The arm the issue named. Without it, a check that fired on every slice would pass the test above.
  const healthy = degenerateSlice({ degenerate: false, totals: { retrieved: 567, finding: 1, dropped: 566, unreasoned: 455 } });

  assert.deepEqual(commonLawCarryChecks({ carries: [healthy] }), [],
    "a lane that reached a finding has a coherent trace and must raise nothing");
  assert.deepEqual(commonLawCarryChecks({ carries: [healthySlice()] }), [],
    "and neither does a healthy common-law grid");
});

test("every slice is checked, not just the first", () => {
  // The real run carries a HEALTHY common-law grid alongside a degenerate jx slice. An arm that
  // stopped at the first artifact would read that run as clean.
  const checks = commonLawCarryChecks({ carries: [healthySlice(), degenerateSlice()] });

  assert.equal(checks.length, 1, "one failing slice, one check");
  assert.equal(checks[0].id, "commonlaw-carry-degenerate:jx-zh-grid",
    "…and the id names WHICH lane, or a two-slice run cannot say where to look");
});

test("a trace that could not be computed says so, instead of passing quietly", () => {
  // Mirrors record-carry rather than covering only `degenerate`. A partial mirror recreates the
  // asymmetry this issue is about: a slice whose trace is uncomputable is equally unable to say
  // nothing was dropped.
  const checks = commonLawCarryChecks({ carries: [{ slice: "jx-zh-grid", computable: false, reason: "no grid on this run" }] });

  assert.equal(checks.length, 1);
  assert.equal(checks[0].id, "commonlaw-carry-computable:jx-zh-grid");
  assert.match(checks[0].detail, /no grid on this run/, "the artifact's own reason must reach the reader");
  assert.match(checks[0].detail, /not the same as saying none were dropped/);
});

test("an absent or down-level artifact grows no check", () => {
  // An archived run predating these fields must not fail on a field it never had — the rule
  // recordCarryChecks already follows.
  assert.deepEqual(commonLawCarryChecks({ carries: [] }), []);
  assert.deepEqual(commonLawCarryChecks({ carries: null }), []);
  assert.deepEqual(commonLawCarryChecks({ carries: [null, undefined, "not an object"] }), []);
  assert.deepEqual(commonLawCarryChecks({ carries: [{ computable: true }] }), [],
    "a v1 artifact carrying no `degenerate` field raises nothing");
});

test("the lint WIRING carries it to the delivery surface, not just the helper", () => {
  // THE POINT OF THIS FILE. The arm existing proves nothing: before this change the function could
  // have existed and still never been reached, which is exactly the defect — `record-carry` had an
  // arm and the jx carry had no reader at all. This asserts runLint surfaces it in `failures`, which
  // is what pipeline.mjs renders as the banner (`flagLines(lint.failures)`).
  const out = runLint({ commonLawCarries: [degenerateSlice()] });

  assert.ok(Array.isArray(out.failures), "runLint reports failures");
  assert.ok(out.failures.some((f) => f.id === "commonlaw-carry-degenerate:jx-zh-grid"),
    `the check must reach runLint's failures: got ${JSON.stringify(out.failures.map((f) => f.id))}`);
});

test("the pipeline actually LOADS both carry artifacts and passes them", () => {
  // The last link, and the one that was missing. runLint takes `commonLawCarries` as a parameter, so
  // a caller that never reads those files leaves every arm above unreachable on a real run — the
  // component tests would stay green and the defect would be untouched.
  const src = readFileSync(join(ROOT, "driver", "pipeline.mjs"), "utf8");

  // ANCHOR ON THE SEAM'S OWN BINDING, NOT ON THE EXPRESSION.: the first version of this arm
  // grepped the whole file for `[P.commonLawCarry, P.jxZhCarry].map(…)`, and that expression is
  // DELIBERATELY shared with the reconciliation siblings at pipeline.mjs:2968 — reusing it is how a
  // third hand-written list is kept from drifting. So replacing the lint seam's load with
  // `const lintCommonLawCarries = []` left the arm green: it was matching the OTHER site. The very
  // reuse the arm was written to reward is what made it unable to see the deletion.
  //
  // The binding name is unique to this seam, and capturing what it is assigned FROM means an empty
  // list, a null, or a different pair all fail with the value named.
  const seam = /const lintCommonLawCarries = ([^;]+);/.exec(src);
  assert.ok(seam, "the lint seam must load the carries into its own named binding in pipeline.mjs");
  assert.match(seam[1], /\[P\.commonLawCarry, P\.jxZhCarry\]\.map\(\(f\) => safeReadJson\(f\)\)/,
    `the lint seam must read BOTH carries, via the same pair expression the reconciliation siblings `
    + `use so a third hand-written list cannot drift from those — got: ${seam[1].trim()}`);
  assert.match(src, /commonLawCarries: lintCommonLawCarries/,
    "…and pass them into runLint; loading them and not passing them is the same silence");
});
