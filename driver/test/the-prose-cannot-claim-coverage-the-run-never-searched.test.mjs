// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The delivered narrative's coverage claims against what the run actually searched (tracker issue 134).
//
// WHAT THIS IS ABOUT. `coverage_line:` is code-stamped from scope-facts.json; the narrative is prose a
// model writes. Nothing bound them. On `amber-summit` the masthead read `registers: JP, WO` while the
// narrative said "Register searches covered Japan and Korea" — one of them was wrong and a human found
// it by eye. They agree on today's runs because the prompt stopped contradicting itself, which is
// evidence the INPUT was fixed, not evidence the surfaces are bound. This is the binding.
//
// THE ONE CASE WHOSE ANSWER IS KNOWN is the recorded failure, and it is the alias table's whole test:
// REGION_NAMES says `KR: 'South Korea'` and the failing prose said "Korea". A check built on the map
// alone is green through the exact defect it was named for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageClaimChecks } from "../predelivery-lint.mjs";

const fired = (r) => r.filter((c) => !c.pass);
const detail = (r) => fired(r).map((c) => c.detail).join(" ~ ");

test("the recorded amber-summit failure fires: prose claims Korea, the run searched JP + WO", () => {
  const r = coverageClaimChecks({
    text: "Register searches covered Japan and Korea.",
    searchedJurisdictions: ["JP", "WO"],
  });
  assert.equal(fired(r).length, 1, `expected exactly one flag, got: ${JSON.stringify(r)}`);
  assert.match(detail(r), /South Korea \(KR\)/, "the flag must name the territory and its code");
  assert.match(detail(r), /searched: JP, WO/, "and state what WAS searched, so the repair has both halves");
});

// A DIFFERENT member of the class than the one the check was written against. "Korea" reaches KR
// through the alias table; these reach their codes by other routes, and an arm that only drove the
// evidence case would be green through a broken alias map or a broken EU-reach import.
test("a different member of the class fires too — a bare WIPO claim on a run that searched none", () => {
  const r = coverageClaimChecks({
    text: "The clearance screened the international register for conflicting designations.",
    searchedJurisdictions: ["CH"],
  });
  assert.equal(fired(r).length, 1, `expected the WIPO alias to fire, got: ${JSON.stringify(r)}`);
  assert.match(detail(r), /WIPO \(Madrid\) \(WO\)/);
});

test("EU reach is honoured, not reimplemented: an EU search covers an EU claim", () => {
  const r = coverageClaimChecks({
    text: "Register searches covered the European Union.",
    searchedJurisdictions: ["EUTM"],
  });
  assert.deepEqual(fired(r), [], "EUTM searched must cover a European Union claim — this is searchedCovers' own rule");
});

test("the other direction of EU reach still fires: a member state is NOT covered by an EU-only search", () => {
  const r = coverageClaimChecks({
    text: "Register searches covered Germany.",
    searchedJurisdictions: ["EU"],
  });
  assert.equal(fired(r).length, 1, "a national right needs a national search — an EU-only search does not cover Germany");
});

test("negation is the discriminator, not sentence classification", () => {
  for (const text of [
    "Register searches covered Japan; Korea was not searched.",
    "Register searches covered Japan. Korea is outside the instructed scope.",
    "We recommend a further search covering Korea.",
    "Clearing Korea would require an additional register search.",
  ]) {
    assert.deepEqual(fired(coverageClaimChecks({ text, searchedJurisdictions: ["JP", "WO"] })), [],
      `a disclaiming, deferring or recommending clause must not fire: ${text}`);
  }
});

// The false-positive machine this check would have been without a coverage predicate. Reports name a
// territory for every adverse mark they carry; firing on all of them would make the family noise and
// it would be switched off inside a week.
test("naming a territory without claiming coverage of it does not fire", () => {
  for (const text of [
    "The closest conflict is a German registration owned by Acme GmbH.",
    "The applicant is domiciled in South Korea.",
    "A Japanese applicant filed a similar mark in Brazil in 2019.",
  ]) {
    assert.deepEqual(fired(coverageClaimChecks({ text, searchedJurisdictions: ["CH"] })), [],
      `a bare territory mention is not a coverage claim: ${text}`);
  }
});

test("an honest claim passes", () => {
  const r = coverageClaimChecks({
    text: "Register searches covered Japan and the international register.",
    searchedJurisdictions: ["JP", "WO"],
  });
  assert.deepEqual(fired(r), []);
  assert.equal(r.length, 1, "a comparison that happened and found nothing is a PASS, and says so");
});

// The absence-as-pass trap this codebase keeps paying for. A run with no register layer has no searched
// set; a green check there would certify a comparison that never ran.
test("no searched set emits NO check — not a pass", () => {
  for (const searchedJurisdictions of [[], null, undefined]) {
    const r = coverageClaimChecks({ text: "Register searches covered Japan and Korea.", searchedJurisdictions });
    assert.deepEqual(r, [], `an incomparable run must record nothing, not pass: ${JSON.stringify(searchedJurisdictions)}`);
  }
});

test("both delivered prose surfaces are checkable, and the flag says which one", () => {
  const text = "Register searches covered Japan and Korea.";
  for (const surface of ["report", "narrative"]) {
    const r = coverageClaimChecks({ text, searchedJurisdictions: ["JP"], surface });
    assert.equal(fired(r).length, 1);
    assert.equal(fired(r)[0].surface, surface, "a repair has to know which surface to rewrite");
    assert.equal(fired(r)[0].id, "coverage-claim-vs-searched");
    assert.equal(fired(r)[0].family, "scope");
  }
});
