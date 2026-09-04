// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The preview's promise, kept: a saved search's scope binds the RUN, not just the review screen.
//
// Before the fold (audit N3, 2026-07-27) resolveEffectiveScope's recipeScope input had exactly one
// consumer — the plan/review previews — while the run resolved scope from job fields + profile
// defaults only. sim-praxis/us-eu-prelim-search carries classes [9,35,41,42] + 3 territories over a
// profile whose defaults are empty: the requester approved that scope and the run ignored it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldRecipeScope } from "../pipeline.mjs";
import { resolveEffectiveScope } from "../effective-scope.mjs";
import { withRunPlatforms } from "../profiles.mjs";

const SCOPE = { jurisdictions: ["US", "EU", "GB"], classes: [9, 35, 41, 42], platforms: ["gnc.com"] };
const policy = { recipeScope: SCOPE };

test("an unset job field takes the saved search's scope; a requester-set field wins", () => {
  const empty = foldRecipeScope({}, policy);
  assert.deepEqual(empty.jurisdictions, ["US", "EU", "GB"]);
  assert.deepEqual(empty.classes, [9, 35, 41, 42]);
  assert.deepEqual(empty.platforms, ["gnc.com"]);

  const set = foldRecipeScope({ jurisdictions: ["CH"], classes: [25] }, policy);
  assert.deepEqual(set.jurisdictions, ["CH"], "request wins over saved search — same ladder as the preview");
  assert.deepEqual(set.classes, [25]);
});

test("platforms are ADDITIVE and dedup case-insensitively — a mandate is never removable", () => {
  const job = foldRecipeScope({ platforms: ["GNC.com", "etsy.com"] }, policy);
  assert.deepEqual(job.platforms, ["GNC.com", "etsy.com"], "already-present (any case) is not re-added");
  const widened = foldRecipeScope({ platforms: ["etsy.com"] }, policy);
  assert.deepEqual(widened.platforms, ["etsy.com", "gnc.com"], "saved stores join the run's own");
});

test("the fold is idempotent (resume re-fold changes nothing) and null/legacy scope is a no-op", () => {
  const once = foldRecipeScope({}, policy);
  const twice = foldRecipeScope(structuredClone(once), policy);
  assert.deepEqual(twice, once);
  assert.deepEqual(foldRecipeScope({ classes: [3] }, { recipeScope: null }), { classes: [3] });
  assert.deepEqual(foldRecipeScope({ classes: [3] }, {}), { classes: [3] }, "pre-fold frozen sidecars carry no key");
});

test("PARITY: what the folded run searches is what resolveEffectiveScope previewed", () => {
  const profile = { platforms: ["amazon.com"], defaultClasses: [16], defaultJurisdictions: ["CH"], origins: {} };
  for (const job of [{}, { jurisdictions: ["JP"] }, { platforms: ["etsy.com"] }, { jurisdictions: ["JP"], classes: [5], platforms: ["etsy.com"] }]) {
    const preview = resolveEffectiveScope(structuredClone(job), profile, { recipeScope: SCOPE });
    const folded = foldRecipeScope(structuredClone(job), policy);
    // run-side territory/class reads are "job else profile default" — after the fold that ladder
    // must land exactly where the preview did
    const runJx = folded.jurisdictions?.length ? folded.jurisdictions : profile.defaultJurisdictions;
    const runCl = folded.classes?.length ? folded.classes : profile.defaultClasses;
    assert.deepEqual(runJx, preview.jurisdictions, `territories diverge from preview for ${JSON.stringify(job)}`);
    assert.deepEqual(runCl, preview.classes, `classes diverge from preview for ${JSON.stringify(job)}`);
    // run-side platforms union at the gather door: withRunPlatforms(profile, job.platforms)
    const run = new Set(withRunPlatforms(profile, folded.platforms).profile.platforms.map((p) => p.toLowerCase()));
    assert.deepEqual(run, new Set(preview.platforms.map((p) => p.toLowerCase())),
      `marketplaces diverge from preview for ${JSON.stringify(job)}`);
  }
});
