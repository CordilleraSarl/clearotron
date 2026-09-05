// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A what-if is diffed against its canonical run, so it must rate under the same authority (tracker issue 135).
//
// THE DEFECT. whatIfRun reconstructs a minimal job from status.json — six fields — and resolveProfile
// keys on NONE of them. It reads `job.profileKey` first, then falls back to `job.forwarderDomain`; the
// reconstruction carries `forwarder` but not `forwarderDomain`, and no profileKey at all. Both routes
// were dead, so every what-if silently resolved to the house `generic` profile. Measured on a petcary
// run: {"event":"profile-mismatch","sidecar":"petcary","resolved":"generic"}, while the client-facing
// result said ok:true, "Sandboxed re-run complete", and nothing else.
//
// WHY IT IS WORSE THAN A WRONG LABEL. A what-if changes ONE thing and reads the difference. That
// changed two — the client's instruction and the rating authority — so the diff attributed to the
// instruction whatever the framework substitution also moved. The petcary profile carried platforms 6,
// floor 7, batch 2; the house default carries none of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveProfile } from "../profiles.mjs";

const WHATIF = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "mcp-server", "lib", "whatif.mjs"), "utf8");

// ── the resolution rule itself, driven ──────────────────────────────────────────────────────────────
// A hand-built roster, so this asserts resolveProfile's CONTRACT rather than whatever the box's config
// store happens to hold. That store is not on the runner, and an arm that read it would be green by
// the box rather than by the code.
const roster = () => new Map([
  ["generic", { key: "generic", name: "House default" }],
  ["petcary", { key: "petcary", name: "Petcary", platforms: [1, 2, 3, 4, 5, 6], floor: 7, batch: 2 }],
]);

test("the reconstructed job's six fields resolve to the HOUSE profile — the defect, reproduced", () => {
  // Exactly what whatif.mjs built before the fix.
  const reconstructed = { id: "r1", ref: "E2E", markName: "PETCARY", classes: [9], forwarder: "x", name: "PETCARY" };
  const p = resolveProfile(reconstructed, { profiles: roster() });
  assert.equal(p.key, "generic",
    "this is the substitution: no profileKey and no forwarderDomain, so the customer never resolves");
});

test("carrying the canonical profileKey resolves the SAME authority the run rated under", () => {
  const withKey = { id: "r1", ref: "E2E", markName: "PETCARY", classes: [9], forwarder: "x", profileKey: "petcary" };
  const p = resolveProfile(withKey, { profiles: roster() });
  assert.equal(p.key, "petcary");
  assert.equal(p.floor, 7, "and the whole profile, not just its name — floor/batch/platforms are what RATE the matter");
  assert.equal(p.batch, 2);
});

// The acceptance's "or it REFUSES rather than substituting one". Carrying the key makes this automatic
// rather than something a future edit has to remember, because resolveProfile already refuses a named
// key it cannot find.
test("a canonical key the store no longer holds REFUSES — it does not fall back to the house", () => {
  const gone = { id: "r1", ref: "E2E", markName: "X", classes: [9], profileKey: "departed-customer" };
  assert.throws(() => resolveProfile(gone, { profiles: roster() }), (e) => {
    assert.equal(e.code, "profile_key_unknown");
    assert.match(e.message, /Refusing to silently fall back/);
    return true;
  }, "a what-if against a store missing the customer must refuse, never substitute");
});

// ── the wiring, so the resolution rule above is actually reached ────────────────────────────────────
test("whatIfRun carries the canonical run's FROZEN profile, never a fresh resolve", () => {
  assert.match(WHATIF, /profile\.json/,
    "the key must come from the canonical run's frozen _driver/profile.json");
  assert.match(WHATIF, /job\.profileKey = canonicalProfileKey/,
    "and be put on the job resolveProfile actually reads");
  // The pipeline's own discipline: a frozen profile is never silently re-derived. A fresh resolveProfile
  // here would reintroduce the bug under a different name — it would resolve against TODAY's store
  // rather than what the run rated under.
  assert.ok(!/resolveProfile\s*\(/.test(WHATIF),
    "whatif.mjs must not re-resolve the profile itself — read the frozen record");
});

test("the client-facing result states the rating authority — the engine knew and the surface did not", () => {
  assert.match(WHATIF, /ratedUnder: canonicalProfileKey/,
    "ok:true with no mention of the authority is the shape this issue is about");
});

test("a run with no frozen profile yields null, not a fabricated customer", () => {
  // Pre-profile runs legitimately rated under the house default; null says "none frozen" rather than
  // implying a customer was matched. An absence must read as an absence.
  assert.match(WHATIF, /\?\?\s*null/, "the frozen-profile read degrades to null");
  assert.ok(!/\?\?\s*["']generic["']/.test(WHATIF),
    "defaulting the KEY to \"generic\" would manufacture the very substitution this fixes");
});
