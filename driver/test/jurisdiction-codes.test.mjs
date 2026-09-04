// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Addendum A12 (2026-07-30) — the canonical jurisdiction-code map: GB/UK and EU/EM/EUTM/EUIPO are ONE
// territory each, folded at one chokepoint (driver/jurisdiction-codes.mjs) and consumed by every
// driver-side recording/comparison surface; unknown codes surface loudly, never silently recorded.
// Pure/offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJurisdictionCode, isKnownJurisdictionCode, foldJurisdictionCodes, JURISDICTION_CODE_FOLD,
} from "../jurisdiction-codes.mjs";
import { jurisdictionScopeFlags, effectiveInScope } from "../frame-diff-model.mjs";
import { registrationSystem, partitionBySystem, marketplaceScopeDirective } from "../jurisdiction-systems.mjs";

test("the fold: UK→GB, EM/EUTM/EUIPO→EU; canonical codes pass through; case/whitespace normalized", () => {
  assert.equal(canonicalJurisdictionCode("UK"), "GB");
  assert.equal(canonicalJurisdictionCode("uk "), "GB");
  assert.equal(canonicalJurisdictionCode("EM"), "EU");
  assert.equal(canonicalJurisdictionCode("EUTM"), "EU");
  assert.equal(canonicalJurisdictionCode("euipo"), "EU");
  assert.equal(canonicalJurisdictionCode("GB"), "GB");
  assert.equal(canonicalJurisdictionCode("EU"), "EU");
  assert.equal(canonicalJurisdictionCode("US"), "US");
  assert.equal(canonicalJurisdictionCode(""), "", "the worldwide sentinel survives");
  assert.equal(canonicalJurisdictionCode(null), "");
  // an unknown token passes through uppercased — carried, never dropped or guessed
  assert.equal(canonicalJurisdictionCode("Narnia"), "NARNIA");
  // the map itself never folds a canonical code onto itself or another alias
  for (const [alias, canon] of Object.entries(JURISDICTION_CODE_FOLD)) {
    assert.notEqual(alias, canon);
    assert.equal(JURISDICTION_CODE_FOLD[canon], undefined, `${canon} is terminal`);
  }
});

test("known universe: ISO + register-world extras are known (via aliases too); junk is not", () => {
  for (const c of ["US", "GB", "UK", "EU", "EM", "EUTM", "CH", "WO", "AP", "OA", "BX", "XK"])
    assert.equal(isKnownJurisdictionCode(c), true, c);
  for (const c of ["XQ", "NARNIA", ""]) assert.equal(isKnownJurisdictionCode(c), false, String(c));
});

test("foldJurisdictionCodes: dedupes across spellings, keeps order, surfaces unknowns WITHOUT dropping them", () => {
  const { codes, unknown } = foldJurisdictionCodes(["UK", "GB", "EM", "EU", "US", "XQ", "", "uk"]);
  assert.deepEqual(codes, ["GB", "EU", "US", "XQ"], "one code per territory; blanks stripped; unknowns carried");
  assert.deepEqual(unknown, ["XQ"], "the unknown is named for the caller to surface loudly");
});

test("scope diff (frame-diff-model): UK-vs-GB and EU-vs-EM can no longer read as different territories", () => {
  // pre-A12 both directions false-flagged: scope UK / searched GB was under-coverage AND over-reach
  assert.deepEqual(jurisdictionScopeFlags({ scopeJurisdictions: ["UK"], searched: ["GB"] }),
    { overReach: [], underCoverage: [] });
  assert.deepEqual(jurisdictionScopeFlags({ scopeJurisdictions: ["EU"], searched: ["EM"] }),
    { overReach: [], underCoverage: [] });
  // a genuinely unsearched in-scope territory still flags — the fold must never paper over a real gap
  const real = jurisdictionScopeFlags({ scopeJurisdictions: ["UK", "US"], searched: ["GB"] });
  assert.deepEqual(real.underCoverage, ["US"]);
  // an EUTM right reaches a scope spelled with the provider's EM
  assert.equal(effectiveInScope("EUTM", ["EM"]), true);
  assert.equal(effectiveInScope("DE", ["EM"]), true, "a member-state right sits inside the scoped EU, however spelled");
});

test("registration systems: both spellings of one territory label identically; partitions dedupe", () => {
  assert.equal(registrationSystem("UK"), registrationSystem("GB"));
  assert.equal(registrationSystem("EM"), "first-to-register");
  assert.equal(registrationSystem("EUIPO"), "first-to-register");
  const p = partitionBySystem(["UK", "GB", "US", "EM", "EU"]);
  assert.deepEqual(p.firstToUse, ["GB", "US"], "UK+GB collapse to one canonical entry");
  assert.deepEqual(p.firstToRegister, ["EU"], "EM+EU collapse too");
  const d = marketplaceScopeDirective(["UK", "GB", "EM"]);
  assert.equal((d.match(/GB/g) ?? []).length, 1, "the directive names one territory once");
});
