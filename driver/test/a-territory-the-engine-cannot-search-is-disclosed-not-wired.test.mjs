// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import test from "node:test";
import assert from "node:assert/strict";
import { resolveRegions } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { isKnownJurisdictionCode } from "../jurisdiction-codes.mjs";
import { normalizeTerritory } from "../../providers/_shared/territory-codes.mjs";

// ── EVERY TERRITORY THE PLAN SENDS TO A REGISTER IS ONE THE ENGINE KNOWS ───────────────────────────
//
// `normalizeTerritory` answers a display name with a code or with `null`, and the plan reads `null` as
// "disclose this as a gap" and a code as "send it". The derived half of that table is built from the
// runtime's own region data, which carries entries that are not jurisdictions — so a name could answer
// with a code that no register can resolve, and the plan had no branch that would catch it.
//
// The arm is written over the POPULATION rather than over the entries that were found to move. A roster
// of names is a record of one measurement; the property holds for whatever region data the next runtime
// ships, which is the thing that will change.

const providerWithNoCoveredList = () =>
  Object.entries(PROVIDER_CAPABILITIES).find(([, c]) => !Array.isArray(c?.offices?.covered));

test("a provider that publishes no office list is the one that needs this, and there is one", () => {
  // THE ARM'S OWN PREMISE, asserted rather than assumed. A provider that publishes `offices.covered`
  // rejects an unknown code at the membership test, so it would pass the arms below whatever the loop
  // did. If every provider published one, the arms below would be green on a broken loop and this line
  // is what says so.
  const found = providerWithNoCoveredList();
  assert.ok(found, "no provider lacks an office list — the arms below no longer test what they name");
});

test("no region name resolves to a code the engine cannot search", () => {
  // The property, driven over every region name the runtime knows rather than over a list. A name that
  // resolves at all must resolve to a code inside the known universe — the same question
  // `foldJurisdictionCodes` asks before it reports a code as unknown.
  const [, caps] = providerWithNoCoveredList();
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const wired = [], sent = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    let name; try { name = names.of(code); } catch { continue; }
    if (!name || name === code || /^unknown/i.test(name)) continue;
    const got = normalizeTerritory(name);
    if (got == null || got === "") continue;
    sent.push(name);
    const { regions } = resolveRegions([name], caps);
    for (const r of regions) if (!isKnownJurisdictionCode(r)) wired.push(`${name} -> ${r}`);
  }
  // THE FLOOR FIRST, because a resolution that answered every name with `null` would satisfy the
  // assertion below by leaving nothing to check. The derived tail carries the long list of ordinary
  // countries, and a build that loses it should fail here rather than in a client's scope.
  assert.ok(sent.length > 200, `only ${sent.length} region names resolve — the tail is gone, not narrowed`);
  assert.deepEqual(wired, [], "these names were sent to a register as territories it cannot answer");
});

test("the entries that are not jurisdictions are disclosed as gaps, not dropped in silence", () => {
  // The client-facing half. A territory the engine cannot search must reach the report as a disclosed,
  // escalatable gap — the same treatment a name that resolves to nothing gets. Dropping it would leave
  // the reader believing the territory was searched.
  const [, caps] = providerWithNoCoveredList();
  // Measured 2026-09-21: the region names that answer with a code outside the known universe. Named
  // here as evidence for the property above, which is what holds them — not as the test's own roster.
  const notJurisdictions = [
    "Canary Islands", "Eurozone", "United Nations", "Outlying Oceania", "Ascension Island",
    "Clipperton Island", "Sark", "Diego Garcia", "Tristan da Cunha", "Pseudo-Bidi",
  ];
  const { regions, deferred } = resolveRegions(notJurisdictions, caps);
  assert.deepEqual(regions, [], "one of these reached a register as a territory");
  assert.equal(deferred.length, notJurisdictions.length, "a territory the engine cannot search vanished instead of being disclosed");
  for (const d of deferred) assert.ok(d.reason, `${d.jurisdiction} was deferred with no reason for the reader`);
});

test("an ordinary territory still reaches its register, by name and by code alike", () => {
  // THE OTHER FLOOR. The refusal above is one line in a loop every clearance runs, and a version of it
  // that deferred too much would be invisible here and expensive in production: every territory would
  // come back disclosed as uncovered, on a provider that covers it.
  const [, caps] = providerWithNoCoveredList();
  for (const t of ["France", "FR", "Vietnam", "VN", "United Kingdom", "UK", "European Union", "Belgium", "Curaçao"]) {
    const { regions, deferred } = resolveRegions([t], caps);
    assert.deepEqual(deferred, [], `${t} is a territory this provider covers and was disclosed as a gap`);
    assert.ok(regions.length > 0, `${t} resolved to no register`);
  }
});
