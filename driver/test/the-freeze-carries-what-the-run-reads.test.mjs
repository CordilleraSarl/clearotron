// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives freezeProfile over a synthetic profile and its output through resolveDemoData
// — THE FOURTH ALLOW-LIST THAT DROPPED A FIELD IN SILENCE.
//
// `freezeProfile` is an allow-list of named fields, and `demoData` was not on it. So the frozen sidecar
// never carried the demonstration flag, `resolveDemoData`'s sidecar branch was DEAD on every run, and the
// banner hung entirely on a roster re-read whose catch answers `false` when the roster cannot be read. A
// republish, an archive re-render, a renamed profile or a missing env therefore rendered a DEMO REPORT AS
// REAL — invented mark, real register basis, published URL, no disclaimer.
//
// THE SAME SHAPE, FOUR TIMES, and three of them in one day:
//   · buildJob        declared `demoRun` in its carries list and never read it (2049)
//   · doors-agree     compared two DECLARATIONS instead of asking the builder what it reads
//   · freezeProfile   this one
//   · and its own header already carries a 2026-06-19 BUGFIX for exactly this: the per-customer
//     framework selection was missing from the freeze, so every run silently used the firm default.
//
// A rule that fails four times is not a rule anyone is going to remember. So this arm asks the BUILDER a
// question — it freezes a profile carrying every declared key and looks at what came out — rather than
// comparing two hand-maintained lists, which is the thing that failed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_PROFILE_KEYS, FIELD_CONSUMERS } from "../profiles.mjs";
import { freezeProfile } from "../pipeline.mjs";
import { resolveDemoData, demoBannerMd } from "../publish/demo-marking.mjs";

// ── THE EXEMPTIONS, each with the consumer that justifies it ─────────────────────────────────────
//
// A key belongs here ONLY when nothing reads it from the frozen profile during a run. Every entry names
// the consumer FIELD_CONSUMERS records, and the arm below checks that record still says so — an
// exemption whose justification has moved is not an exemption any more.
const NOT_FROZEN = {
  // Consumed at RESOLUTION, before a run exists: resolveProfile matches the applicant's domain to pick
  // the profile. Once picked, nothing re-matches, so the run never reads it.
  matchDomains: "profiles.mjs",
  // Consumed AT FREEZE TIME, into values that ARE frozen: it feeds gridCellBudget, whose outputs
  // (minCellsPerVariant, batchSize) are in the sidecar. Freezing the input as well would be harmless
  // and would prove nothing the derived values do not already prove.
  marketplaceDensity: "profiles.mjs",
  // DELIBERATELY LIVE. Admission caps are read at claimAndPrep from the current roster, because a cap is
  // a statement about what the account may spend NOW. A frozen cap would let a queued job outlive the
  // policy that bounded it.
  runCaps: "runner.mjs",
};

test("#2132 every declared profile key is FROZEN or explicitly exempt — a new one cannot be silently dropped", () => {
  // Build a profile carrying every declared key, so the question put to freezeProfile is "what did you
  // keep", not "what did the fixture happen to contain".
  const arrayish = new Set(["platforms", "defaultClasses", "defaultJurisdictions", "selfExclusionOwners",
    "matchDomains", "allowedRecipes"]);
  const objectish = new Set(["delivery", "jxPolicy", "runCaps"]);
  const profile = { key: "probe" };
  for (const k of KNOWN_PROFILE_KEYS) {
    profile[k] = k === "demoData" ? true
      : arrayish.has(k) ? [`SENTINEL-${k}`]
      : objectish.has(k) ? { sentinel: k }
      : `SENTINEL-${k}`;
  }

  const frozen = freezeProfile(profile);
  const kept = new Set(Object.keys(frozen));

  // POSITIVE CONTROL. If the freeze returned an empty object, or the key list were empty, the assertion
  // below would pass over nothing — which is precisely how a guard reports a clean tree it never read.
  assert.ok(KNOWN_PROFILE_KEYS.length >= 15,
    `only ${KNOWN_PROFILE_KEYS.length} declared profile key(s) — the import is broken, not the tree`);
  assert.ok(kept.size >= 10, `freezeProfile kept only ${kept.size} key(s) — it did not run`);

  const dropped = KNOWN_PROFILE_KEYS.filter((k) => !kept.has(k) && !(k in NOT_FROZEN));
  assert.deepEqual(dropped, [],
    "these profile keys are declared, are not frozen, and are not declared exempt. A field that survives "
    + "the loader and vanishes at the freeze is read from the LIVE roster at run time or not at all — "
    + "which is how the demo flag came to hang on a fallback that renders fiction as real. Freeze it, or "
    + "add it to NOT_FROZEN with the consumer that makes it safe: " + dropped.join(", "));

  // AND THE REVERSE, so the exemption list cannot outlive its reason: an exempt key that IS frozen now
  // is an entry describing a state that no longer exists.
  const staleExempt = Object.keys(NOT_FROZEN).filter((k) => kept.has(k));
  assert.deepEqual(staleExempt, [],
    `declared not-frozen but present in the sidecar — delete the exemption: ${staleExempt.join(", ")}`);
});

test("#2132 each exemption still names the consumer that justifies it", () => {
  // An exemption is only as good as its reason, and the reason lives in FIELD_CONSUMERS. If a field's
  // consumer moves — say runCaps starts being read from the frozen profile — the exemption becomes a
  // licence rather than a fact, and nothing else would notice.
  for (const [key, file] of Object.entries(NOT_FROZEN)) {
    const declared = FIELD_CONSUMERS[key];
    assert.ok(declared, `${key} is exempt from the freeze but has no FIELD_CONSUMERS entry at all`);
    assert.equal(declared.file, file,
      `${key} is exempt because ${file} consumes it, but FIELD_CONSUMERS now says ${declared.file} — `
      + "the exemption's justification moved and the exemption did not");
  }
});

test("#2132 the demo flag survives the freeze, and only when it is literally true", () => {
  // The field this issue is about, driven rather than asserted through the walk above.
  assert.equal(freezeProfile({ key: "k", demoData: true }).demoData, true);
  // `=== true` and nothing looser, matching demoRunShape and buildJob: a truthy string must not be able
  // to declare a real client matter fiction.
  for (const truthy of ["true", 1, "yes", {}, []])
    assert.equal(freezeProfile({ key: "k", demoData: truthy }).demoData, false,
      `${JSON.stringify(truthy)} is truthy and must NOT mark a real matter as a demonstration`);
  // And absent stays absent — the freeze preserves a marking, it cannot invent one.
  assert.equal(freezeProfile({ key: "k" }).demoData, false);
});

// ── ACCEPTANCE 3, AND IT IS THE ONLY ARM HERE THAT TOUCHES THE CLIENT'S PAGE ──────────────────────
//
// Everything above proves the freeze CARRIES the field. That is not the issue: the issue is that a
// re-render with no roster served a demonstration report as a real one. So this drives the actual
// seam — the freeze's own output, through the real resolver, with the roster THROWING — and asks
// what the reader would see.
//
// The roster is made to throw rather than return empty on purpose. `resolveDemoData` catches an
// unreadable roster and lets "absent stay absent"; that catch IS the failure path, so an arm that
// hands it a working roster is testing the branch that was never in doubt.
test("#2132 a re-render with the roster UNREACHABLE still marks a demo run — the sidecar answers alone", () => {
  const frozen = freezeProfile({ key: "demo-brand-owner", demoData: true });
  const rosterGone = () => { throw new Error("roster unavailable — no CLEAROTRON_CUSTOMERS_DIR"); };
  const resolve = (sidecar) => resolveDemoData({
    runDir: "/any-run-dir",                       // truthy only; readFile below is what answers
    customerKey: "demo-brand-owner",              // supplied, and deliberately un-answerable
    readFile: () => JSON.stringify(sidecar),
    loadRoster: rosterGone,
  });

  assert.equal(resolve(frozen), true,
    "the frozen sidecar must answer on its own — this is the republish/archive-re-render path");
  assert.match(demoBannerMd(resolve(frozen)), /invented/,
    "and the marking must actually reach the page a reader opens");

  // THE CONTROL, AND IT IS THE PRE-FIX WORLD EXACTLY. Strip the one key the freeze now carries and the
  // same call falls through to the roster, which throws, which answers false — a demonstration report
  // rendered identically to a real one. If this ever stops returning false the arm above proves
  // nothing, because it would be passing on the fallback rather than on the sidecar.
  const { demoData: _dropped, ...preFix } = frozen;
  assert.equal(resolve(preFix), false,
    "control: without the frozen key the resolver has only the unreachable roster left");
  assert.equal(demoBannerMd(false), "", "…and an unmarked demo report carries no disclaimer at all");
});
