// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Driver-side regressions for the 2026-07-21 adversarial-review round: the two defects that live in
// the driver rather than in a provider core.
//
//   finding 11 — attachRegisterPlan compiled from `ctx.job.jurisdictions ?? []` with no fallback to the
//     customer profile's defaults, so the DOCUMENTED normal case ("omit it to search the customer's
//     default territories", enqueue-schema.mjs) produced regions:[]. Harmless on corsearch, fatal on a
//     provider whose regions[] is mandatory.
//   finding 1/10/14 — `plan.deferred_coverage` was written by the compiler and read by NOTHING, so a
//     partially covered jurisdiction set silently narrowed the sweep and joined clean.
//
// PURE unit tests over the exported helpers; no run directory, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

const { registerJurisdictions, registerDeferredCoverage } = await import("../pipeline.mjs");

// ── finding 11 ────────────────────────────────────────────────────────────────────────────────────

test("finding 11: an omitted job.jurisdictions falls back to the profile's defaults", () => {
  assert.deepEqual(registerJurisdictions({}, { defaultJurisdictions: ["CH", "EU"] }), ["CH", "EU"]);
  assert.deepEqual(registerJurisdictions({ jurisdictions: [] }, { defaultJurisdictions: ["CH"] }), ["CH"]);
});

test("finding 11: instructed jurisdictions WIN over the profile defaults (precedence unchanged)", () => {
  assert.deepEqual(registerJurisdictions({ jurisdictions: ["GB"] }, { defaultJurisdictions: ["CH", "EU"] }), ["GB"]);
});

test("finding 11: a scalar jurisdiction, blanks and duplicates are normalised, and nothing is invented", () => {
  assert.deepEqual(registerJurisdictions({ jurisdictions: "CH" }, {}), ["CH"]);
  assert.deepEqual(registerJurisdictions({ jurisdictions: [" CH ", "", "CH", "EU"] }, {}), ["CH", "EU"]);
  assert.deepEqual(registerJurisdictions({}, {}), [], "no job scope and no profile default stays EMPTY — never a guess");
  assert.deepEqual(registerJurisdictions(null, null), []);
});

// ── finding 1/10/14 ───────────────────────────────────────────────────────────────────────────────

const ctxWith = () => {
  const notes = [];
  return { ctx: { paths: { runDir: null }, note: notes }, notes };
};

test("finding 1/10/14: deferred_coverage lands on ctx so the jurisdiction-scope backstop can subtract it", () => {
  const ctx = { paths: { runDir: null } };
  const out = registerDeferredCoverage(ctx, {
    regions: ["EM", "CH"],
    deferred_coverage: [{ jurisdiction: "nl", reason: "…" }, { jurisdiction: "UK", reason: "…" }],
  });
  // A12 (addendum 2026-07-30): recorded in the CANONICAL vocabulary (UK→GB — jurisdiction-codes.mjs),
  // so the subtraction meets extractSearchedJurisdictions (which folds the same way) on the same codes.
  assert.deepEqual(out, ["NL", "GB"], "canonical upper-case, ready to match the (canonical) searched set");
  assert.deepEqual(ctx.registerDeferredJurisdictions, ["NL", "GB"]);
});

test("finding 1/10/14: a fully covered plan records an EMPTY deferral set (never undefined)", () => {
  const ctx = { paths: { runDir: null } };
  assert.deepEqual(registerDeferredCoverage(ctx, { regions: ["CH"] }), []);
  assert.deepEqual(ctx.registerDeferredJurisdictions, [], "the backstop must always find an array to subtract");
});

test("finding 1/10/14: a malformed/absent plan never throws at mint time (never-kill)", () => {
  const ctx = { paths: { runDir: null } };
  assert.doesNotThrow(() => registerDeferredCoverage(ctx, null));
  assert.doesNotThrow(() => registerDeferredCoverage(ctx, { deferred_coverage: "nonsense" }));
  assert.doesNotThrow(() => registerDeferredCoverage(ctx, { deferred_coverage: [{}, { jurisdiction: "  " }] }));
  assert.deepEqual(ctx.registerDeferredJurisdictions, []);
});
