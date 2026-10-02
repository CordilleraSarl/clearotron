// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doc 50 — per-framework prompt assembly, end to end: the synthesis dictation carries the framework in
// force's key, demands the schema version this driver dictates (FINDINGS_SCHEMA_VERSION — named by number
// below so a bump has to be deliberate), and never resurrects the retired universal scale (the
// anti-resurrection grep — years of Composite/Level habit in the prompt corpus is exactly what the
// token-first parser forbid exists to catch; the prompt must not re-teach it). It no longer teaches the
// framework's ladder: the rating in the decisions is the rating (owner, 2026-10-01), so the rating
// authority left synthesis's message and the judges read the client's scale instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import { loadProfiles, resolveProfile } from "../profiles.mjs";
import { freezeProfile } from "../pipeline.mjs";
import { loadFrameworkManifest, frameworkFor } from "../framework.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = { narrative: "/n", registerFindings: "/rf", commonLaw: "/cl", placement: "/p", seniorEyeReview: "/le",
  matterContext: "/mc", report: "/r", reportOverview: "/ro", findings: "/f.json", variantManifest: "/vm",
  skepticFlags: "/sf", frameReopenReceipt: "/frr", registerNamedBand: "/rnb", enforcerSignals: "/es", caseLaw: "/case" };

const ctxFor = (key) => {
  const profiles = loadProfiles({ force: true });
  const profile = freezeProfile(resolveProfile(key ? { profileKey: key } : {}, { profiles }));
  const framework = loadFrameworkManifest(ROOT, frameworkFor(profile));
  return { paths: P, job: {}, profile, framework };
};

test("synthesis dictation carries the framework in force's key and the v7 demand, and no longer its ladder", () => {
  const msg = STAGES.synthesis.message(ctxFor("zephyr"));
  assert.doesNotMatch(msg, /FRAMEWORK IN FORCE/, "the rating authority is still dictated to synthesis");
  assert.doesNotMatch(msg, /Very High \/ High \/ Medium \/ Manageable/, "the zephyr ladder is still taught to synthesis");
  assert.match(msg, /"schema_version":7/, "v7 dictated (#469 — the finding sentence is a conclusion, not a chain; armed with #470)");
  assert.match(msg, /"rated_under_framework":"zephyr"/, "the tripwire key dictated verbatim");
  assert.match(msg, /composite\/level\/dispute_type keys are FORBIDDEN/i);
});

test("house default (generic/petcary) dictation: the house-default key, and no ladder", () => {
  const msg = STAGES.synthesis.message(ctxFor(null));
  assert.doesNotMatch(msg, /Very High \/ High \/ Moderate \/ Manageable/, "the house ladder is still taught to synthesis");
  assert.match(msg, /"rated_under_framework":"house-default"/);
});

test("anti-resurrection: the retired universal scale is never re-taught by the prompts", () => {
  for (const key of [null, "zephyr", "demo-brand-owner"]) {
    const msg = STAGES.synthesis.message(ctxFor(key));
    assert.doesNotMatch(msg, /REQUIRE level D or E/i, "the old hardcoded ceiling text is dead");
    assert.doesNotMatch(msg, /composite: integer 1-5/, "the old composite dictation is dead");
    assert.doesNotMatch(msg, /level: one of A B C D E/, "the old level dictation is dead");
    assert.doesNotMatch(msg, /"schema_version":[3456]/, "v3-v6 are never dictated — a superseded contract re-taught is a gate silently switched off (v6 joined the list when #470 armed v7: dictating 6 would disengage validateNetShape)");
    assert.ok(msg.includes("The rating in the decisions is the rating. Do not rate again."),
      "the judges' rating replaces every ceiling and matrix synthesis was once taught");
  }
});

test("demo dictation carries its key, and none of its five bands as a ladder to rate on", () => {
  const msg = STAGES.synthesis.message(ctxFor("demo-brand-owner"));
  assert.doesNotMatch(msg, /Very High \/ High \/ Medium \/ Manageable \/ Low/);
  assert.match(msg, /"rated_under_framework":"demo"/);
});

// The client-summary dictation test that stood here is deleted with the stage (2026-08-01). The
// property it guarded — that a stage prompt speaks the framework in force's OWN band words and never
// re-teaches the retired universal scale — is still asserted on every SURVIVING dictation above.
