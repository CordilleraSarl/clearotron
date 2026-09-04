// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// search-policy-freeze.test.mjs — the run-sidecar half of the search-depth spine.
// attachSearchPolicy is the freezeProfile/attachFramework discipline applied to the run's PRODUCT IDENTITY:
// minted once at cold start, read verbatim forever (corrupt ⇒ loud, never re-derived), and the second door
// of the never-silently-substitute rule — a frozen non-clearance shape REFUSES to run in this build, and an
// unavailable selection refuses on MINT (CLI dispatch bypasses the runner's admission gate; this holds it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { attachSearchPolicy, freezeProfile } from "../pipeline.mjs";
import { loadProfiles, resolveProfile } from "../profiles.mjs";

const runDir = () => {
  const d = mkdtempSync(join(tmpdir(), "spine-run-"));
  mkdirSync(driverDir(d), { recursive: true });
  return d;
};
const ctxFor = (d, profile = null) => ({ paths: { runDir: d }, profile });

test("cold start mints the sidecar: house-default prelim, frozen once, read verbatim on resume", () => {
  const d = runDir();
  const ctx = ctxFor(d);
  attachSearchPolicy(ctx, {}, { write: true });
  assert.equal(ctx.searchPolicy.level, "global-preliminary-search");
  assert.equal(ctx.searchPolicy.pipeline, "clearance");
  assert.equal(ctx.searchPolicy.origins.level, "the-scope");
  assert.ok(ctx.searchPolicy.frozenAt, "the mint is timestamped");
  const sidecar = driverDir(d, "search-policy.json");
  assert.ok(existsSync(sidecar));
  // resume reads the FILE, never re-resolves: plant a marker and prove it comes back verbatim
  const frozen = JSON.parse(readFileSync(sidecar, "utf8"));
  frozen.origins.level = "planted-marker";
  writeFileSync(sidecar, JSON.stringify(frozen, null, 2) + "\n");
  const ctx2 = ctxFor(d);
  attachSearchPolicy(ctx2, { product: "knockout-search" }, { write: false });   // job says knockout; sidecar wins
  assert.equal(ctx2.searchPolicy.origins.level, "planted-marker");
  assert.equal(ctx2.searchPolicy.level, "global-preliminary-search");
});

test("an explicit selector freezes with its origin; enqueuedVia + parentRunId ride the sidecar (attribution)", () => {
  const d = runDir();
  const ctx = ctxFor(d);
  attachSearchPolicy(ctx, { product: "global-preliminary-search", enqueuedVia: "mcp/start_run", parentRunId: "nova-cedar" }, { write: true });
  assert.equal(ctx.searchPolicy.origins.level, "job.product");
  assert.equal(ctx.searchPolicy.enqueuedVia, "mcp/start_run");
  assert.equal(ctx.searchPolicy.parentRunId, "nova-cedar");
});

test("a corrupt sidecar fails LOUD — the frozen policy is never silently re-derived", () => {
  const d = runDir();
  writeFileSync(driverDir(d, "search-policy.json"), "{not json");
  assert.throws(() => attachSearchPolicy(ctxFor(d), {}, { write: false }), /corrupt/);
});

test("legacy resume (no sidecar, read-only) is an implicit prelim and mints NOTHING — but only for selector-less jobs", () => {
  const d = runDir();
  const ctx = ctxFor(d);
  attachSearchPolicy(ctx, {}, { write: false });
  // THE LEGACY SHAPE KEEPS ITS OWN NAME. A run dir with no frozen sidecar predates the offering, and
  // naming it as a product this build sells would claim it was one. `prelim` is a RETIRED row, still
  // nameable, which is exactly what a run from before the offering needs.
  assert.equal(ctx.searchPolicy.level, "prelim");
  assert.equal(ctx.searchPolicy.origins.level, "legacy-implicit");
  assert.ok(!existsSync(driverDir(d, "search-policy.json")), "read-only never retro-mints");
  // A SELECTOR-CARRYING JOB MUST NOT BE ASSUMED INTO A CLEARANCE. The guard read the DELETED
  // `job.searchLevel`, so it was true for every job and the product arm was unreachable — a job that
  // spelled out `product: "full-country-search"` was assumed into a retired `prelim`. It reads the two
  // selectors that exist now, and BOTH arms refuse.
  assert.throws(() => attachSearchPolicy(ctxFor(runDir()), { product: "global-preliminary-search" }, { write: false }), /refusing the legacy-implicit/);
  assert.throws(() => attachSearchPolicy(ctxFor(runDir()), { recipeKey: "quick" }, { write: false }), /refusing the legacy-implicit/);
});

test("attribution is SANITIZED at freeze: malformed parentRunId/enqueuedVia drop to null; portal route refuses", () => {
  const d = runDir();
  const ctx = ctxFor(d);
  attachSearchPolicy(ctx, { parentRunId: "../escape", enqueuedVia: "weird\nvalue" }, { write: true });
  assert.equal(ctx.searchPolicy.parentRunId, null, "a path-shaped lineage value never survives into the sidecar");
  assert.equal(ctx.searchPolicy.enqueuedVia, null, "a newline-bearing via token never survives into the sidecar");
  assert.throws(() => attachSearchPolicy(ctxFor(runDir()), { deliveryRoute: "portal" }, { write: true }), /not available in this build/);
});

test("never a silent substitution: a BUILT selection mints, and a frozen future shape still REFUSES", () => {
  // The first two cases here asserted a refusal on mint because CLEAROTRON_KNOCKOUT_MODE / CLEAROTRON_JX_LANES were
  // off. Both switches were retired 2026-07-27, so a built level mints rather than refusing — the
  // "refuse, don't downgrade" rule is unchanged, there is simply nothing left to refuse it for.
  delete process.env.CLEAROTRON_KNOCKOUT_MODE;
  const koCtx = ctxFor(runDir());
  attachSearchPolicy(koCtx, { product: "knockout-search" }, { write: true });
  assert.equal(koCtx.searchPolicy.level, "knockout-search", "a built product mints as itself, never downgraded");
  const jxCtx = ctxFor(runDir(), { profileKey: "acme", defaultProduct: "multi-country-focus-search" });
  attachSearchPolicy(jxCtx, {}, { write: true });
  assert.equal(jxCtx.searchPolicy.level, "multi-country-focus-search", "a profile-default deepening mints as itself");

  // The refusal that MATTERS is still here: a FROZEN sidecar naming a pipeline THIS build does not know
  // (minted by a future build) must never be re-run as something else.
  const d = runDir();
  writeFileSync(driverDir(d, "search-policy.json"),
    JSON.stringify({ schema: 1, level: "prelim-quantum", pipeline: "quantum", components: {}, recipe: null, origins: { level: "job.product" } }));
  assert.throws(() => attachSearchPolicy(ctxFor(d), {}, { write: false }), /refusing to run it as a clearance/);
});

test("freezeProfile: absent spine keys are NOT own properties (undefined-own keys would change every profileSha)", () => {
  const profiles = loadProfiles({ force: true });
  const bare = freezeProfile(resolveProfile({}, { profiles }));
  // DIRECT `in` checks, not a JSON round-trip (review 2026-07-17): `key: undefined` survives Object.keys
  // and would hash as "null" in profileShaOf while JSON.stringify hides it — the exact bug under guard.
  assert.ok(!("defaultProduct" in bare), "generic ships no default ⇒ the key must not exist AT ALL");
  assert.ok(!("allowedRecipes" in bare));
  assert.ok(!("jxPolicy" in bare));
  const withSpine = freezeProfile({ ...resolveProfile({}, { profiles }), defaultProduct: "global-preliminary-search", allowedRecipes: ["global-preliminary-search"], jxPolicy: { providerStance: "default" } });
  // `defaultProduct` IS FROZEN, and it is load-bearing rather than cosmetic. attachSearchPolicy resolves
  // off this frozen sidecar and nothing else, so while the freeze still spread the deleted
  // `defaultSearchLevel` the account's own default reached the mint NOWHERE: a profile saying "every
  // search here is a Knockout search" froze whatever product the territories derived instead.
  assert.equal(withSpine.defaultProduct, "global-preliminary-search");
  assert.deepEqual(withSpine.allowedRecipes, ["global-preliminary-search"]);
  assert.deepEqual(withSpine.jxPolicy, { providerStance: "default" });
});
