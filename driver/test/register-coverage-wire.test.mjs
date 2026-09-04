// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-coverage-wire.test.mjs —. The THREE-STATE field, from the snapshot writer to the doors.
//
// The trap this file exists for is written on the issue: `new Set(covered ?? [])` offers ZERO
// territories on production today, because the wired provider declares `covered: null` on purpose. So
// every hop has to keep three answers apart, and each hop is a place one of them can be flattened:
//
//     capabilities → buildFlagSnapshot → JSON on disk → registerTerritoriesFor → productAvailability
//
// `null` = unrestricted. `[...]` = exactly these. ABSENT = the writer did not say, and fails OPEN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlagSnapshot, registerTerritoriesFor } from "../flag-snapshot.mjs";
import { productAvailability, UNAVAILABLE_NOTE, coverageDisclosure, gateCause, gateResolvedPolicy, PRODUCT_POLICIES } from "../search-policy.mjs";
import { PRODUCTS } from "../products.mjs";

const snap = (registerTerritories) =>
  buildFlagSnapshot({}, { capturedAt: "2026-08-10T00:00:00Z", registerProvider: "euipo", registerCanCount: true, ...(registerTerritories === undefined ? {} : { registerTerritories }) });

// A round trip through JSON, because that is what actually happens: the writer serialises to disk and
// a different process parses it. `undefined` does not survive JSON, which is exactly why absence is
// expressed by OMITTING the key rather than by writing undefined into it.
const roundTrip = (s) => JSON.parse(JSON.stringify(s));

test("the writer OMITS the key when it does not know, and omission survives JSON", () => {
  const s = roundTrip(snap(undefined));
  assert.equal("territories" in s.register, false,
    "a written `territories: undefined` would vanish in JSON anyway — but `null` would NOT, and null means something else");
  assert.equal(registerTerritoriesFor(s), undefined);
});

test("null survives as null — unrestricted is a real answer, not a missing one", () => {
  const s = roundTrip(snap(null));
  assert.equal(s.register.territories, null);
  assert.equal(registerTerritoriesFor(s), null);
});

test("an enumerated set survives intact and in order", () => {
  const s = roundTrip(snap(["European Union", "United States"]));
  assert.deepEqual(registerTerritoriesFor(s), ["European Union", "United States"]);
});

test("a snapshot with no register block at all reads as unknown, never as empty", () => {
  const s = buildFlagSnapshot({}, { capturedAt: "x" });          // no provider ⇒ register is undefined
  assert.equal(s.register, undefined);
  assert.equal(registerTerritoriesFor(s), undefined);
  assert.equal(registerTerritoriesFor(null), undefined, "and neither does a missing snapshot");
  assert.equal(registerTerritoriesFor({}), undefined);
});

test("a MALFORMED territories value reads as unknown, not as a coverage claim", () => {
  // Fail open on garbage, for the same reason the rest of this file fails open: the runner's wall still
  // decides, and refusing a product because a snapshot is corrupt is an outage caused by a file.
  for (const bad of [42, "European Union", {}, true]) {
    assert.equal(registerTerritoriesFor({ register: { territories: bad } }), undefined, `${JSON.stringify(bad)}`);
  }
  assert.deepEqual(registerTerritoriesFor({ register: { territories: ["European Union", 7, null] } }),
    ["European Union"], "non-strings are dropped rather than poisoning the list");
});

// ── the gate twins ──────────────────────────────────────────────────────────────────────────────────

const resolvedFor = (name) => {
  const p = PRODUCTS.find((x) => x.name === name);
  return { ...PRODUCT_POLICIES[p.id], product: p.id, stageLabel: p.name };
};

test("gateCause and gateResolvedPolicy stay NULL-EQUIVALENT over the coverage arm", () => {
  // search-policy.test.mjs pins this equivalence over the whole matrix; adding an arm to one side and
  // not the other is precisely how that assertion breaks, so the coverage arm is asserted here too.
  for (const t of [undefined, null, ["European Union"], ["United States"], ["European Union", "United States"]]) {
    for (const p of PRODUCTS) {
      const r = resolvedFor(p.name);
      const cause = gateCause(r, { registerTerritories: t });
      const prose = gateResolvedPolicy(r, { registerTerritories: t });
      assert.equal(cause === null, prose === null,
        `${p.name} @ ${JSON.stringify(t)} — one gate refuses and the other does not`);
    }
  }
});

test("2075 D6 — NEITHER gate refuses on coverage now, staff prose included", () => {
  // This arm asserted that the staff gate refused with prose naming the register's reach while the
  // client sentence named none of it. Under the owner's D6 ruling (2026-09-02, "disclosure yes, in line
  // with the picker") a coverage fact refuses on neither side: the picker offers a territory the
  // register cannot reach and says so, and a product refused for the same fact was the last place the
  // two controls could disagree.
  const r = resolvedFor("Full country search");
  assert.equal(gateResolvedPolicy(r, { registerTerritories: ["European Union"] }), null,
    "the staff gate still refuses a coverage limit — the order path and the menu now disagree");
  assert.equal(gateCause(r, { registerTerritories: ["European Union"] }), null,
    "the client gate still refuses a coverage limit");

  // THE SPLIT IT PROTECTED IS STILL REAL, one map along: the disclosure a CLIENT reads names the
  // register's reach in composer display names and never the mechanism behind it.
  const fullGeo = PRODUCTS.find((p) => p.name === "Full country search").geography;
  const disclosed = coverageDisclosure(fullGeo, ["European Union"]);
  assert.ok(disclosed, "the coverage fact is neither refused nor disclosed, so it is simply gone");
  assert.doesNotMatch(disclosed.note, /CLEAROTRON_|euipo|signa|clarivate|corsearch/i,
    "the client sentence names a vendor or a variable");
});

// ── the arm ORDER, which is the part that decides what a client is told ─────────────────────────────

test("Refs tracker issue 2075 — coverage no longer COMPETES to be reported, because it no longer refuses", () => {
  // THIS ARM USED TO ASSERT THE ORDERING, and the ordering existed because coverage was a refusal that
  // could be shadowed by "not part of the current release" — a sentence telling a client to wait for a
  // version that will never help. The owner's ruling of 2026-08-31 removes the worldwide cause from the
  // refusals entirely, so there is nothing left to order it against: the product is ORDERABLE, and what
  // the register does not reach is a disclosure beside a live row.
  const geo = PRODUCTS.find((p) => p.id === "global-preliminary-search").geography;
  const cause = productAvailability(PRODUCT_POLICIES["global-preliminary-search"], {
    built: { knockout: false, registerProbe: false, jxLanes: false },   // everything unbuilt too
    registerTerritories: ["European Union"],
    geography: geo,
  });
  assert.equal(cause, null, "a worldwide search is refused again on a register that reaches part of the world");

  // AND THE FACT IS NOT LOST — it moved to the sibling that discloses rather than refuses. An arm that
  // only asserted the absence would pass just as well on a build that dropped coverage altogether.
  const disclosed = coverageDisclosure(geo, ["European Union"]);
  assert.ok(disclosed, "the coverage limit is neither refused nor disclosed, so it is simply gone");
  assert.equal(disclosed.cause, "register-not-worldwide");
  assert.ok(disclosed.note.includes("European Union"), "the disclosure does not name what the register reaches");

  // THE ORDERING RULE ITSELF SURVIVES for the causes that are still refusals: the specific truth a
  // client can act on leads over the release sentence that will never help them. Asserted on the count
  // arm, which is the one this test was copied from and the one still in scope.
  const knockout = PRODUCTS.find((p) => PRODUCT_POLICIES[p.id]?.components?.registerProbe);
  assert.equal(productAvailability(PRODUCT_POLICIES[knockout.id], {
    built: { knockout: false, registerProbe: false, jxLanes: false },
    registerCanCount: false,
    geography: knockout.geography,
  }), "register-cannot-count", "the more specific truth no longer leads");
});

test("with no geography passed, the coverage arm cannot fire at all", () => {
  // The arm is opt-in per call site, so a caller that has not been wired keeps its previous behaviour
  // rather than silently gaining a refusal it never asked for.
  assert.equal(productAvailability(PRODUCT_POLICIES["global-preliminary-search"], {
    registerTerritories: ["European Union"],
  }), null);
});
