// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — AN OFFICE THE PROVIDER COVERS THAT THIS DEPLOYMENT CANNOT REACH.
//
// WHAT WENT WRONG. The free tier composes EUIPO (EU) and a local US index (US), and required BOTH
// members' credentials before any run started. Building that index reads 41.5 GB across two bulk
// products from an account with ID.me identity verification and takes hours, so on every box that did
// not already have one — which was every box — the whole free tier refused., and all
// carried `merged-awaiting-e2e` and none of them could be exercised, because the tier that exists so a
// clearance needs no paid subscription was the one configuration that would not start.
//
// The refusal also named the wrong thing: "the free-tier credential is absent" when EUIPO's id and
// secret were both present and correct and the absent variable was USPTO_LOCAL_DB.
//
// WHY THE TESTS ARE SHAPED THIS WAY. The dangerous outcome here is not a crash, it is a SMALLER SEARCH
// THAT LOOKS COMPLETE — the EU half returning a clean over a matter that asked for the world. So almost
// nothing below asserts "an error was produced". They assert the pair: which regions the plan actually
// carries, AND what it disclosed about the rest. A test that checked only one of those passes under the
// bug that matters.
//
// The worldwide case is the one that nearly shipped, and it gets two tests of its own — one for the
// unwired box and one for the wired one. An unrestricted scope compiles to an EMPTY region filter, which
// MEANS "every office this provider covers". There was no "US" in `regions` for a filter to catch, so
// the first working version of this change searched the EU, disclosed nothing, and returned a
// whole-world clean over half a world. It passed every other test in this file.

import { test } from "node:test";
import assert from "node:assert/strict";

import { membersOf, unavailableOffices, unavailableByOffice } from "../register-availability.mjs";
import { compileRegisterPlan, officeUnavailableReason, uncoveredJurisdictionReason } from "../register-plan.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { capabilitiesFor } from "../register-capabilities.mjs";
import { coerceToolAbsenceDeferred, isCapabilityGapReason } from "../coverage-ledger.mjs";
import { coveredTerritoryNames } from "../register-coverage.mjs";
import { countPreflight } from "../register-count.mjs";

const FREE_TIER = capabilitiesFor("free-tier");
const EUIPO = capabilitiesFor("euipo");

const MODEL = {
  schema_version: 1,
  mark: "GLIMBEX",
  dominant_element: "GLIMBEX",
  elements: [{ value: "GLIMBEX", kind: "distinctive" }],
  variants: [{ value: "GLIMBECKS", category: "phonetic", rationale: "sound-alike" }],
  incumbent_classes: ["9"],
};
const manifest = () => parseVariantManifestModel(JSON.stringify(MODEL));

/** The US index unconfigured; EUIPO fine. The whole subject of this file. */
const NO_INDEX = [{ office: "US", memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] }];

const compile = (jurisdictions, unavailable = [], capabilities = FREE_TIER) =>
  compileRegisterPlan({
    manifest: manifest(),
    job: { jobKey: "t-660", classes: ["9"], jurisdictions },
    capabilities,
    unavailableOffices: unavailable,
  });

const regionsOf = (plan) => [...new Set((plan.entries ?? []).flatMap((e) => e.regions ?? []))].sort();
const deferredOf = (plan) => (plan.deferred_coverage ?? []).map((d) => d.jurisdiction).sort();

// ── the overlay itself ──────────────────────────────────────────────────────────────────────────────

test("membership is declared on the contract, and a single-source provider has none", () => {
  assert.deepEqual(membersOf(FREE_TIER), ["euipo", "uspto-local"]);
  // Not [] by accident — euipo genuinely composes nothing, so there is no member to be unconfigured and
  // the whole availability path is a no-op on it. This is what keeps euipo standalone unaffected.
  assert.deepEqual(membersOf(EUIPO), []);
  assert.deepEqual(membersOf(null), []);
});

test("an unconfigured member yields its offices, WITH the variable that is missing", () => {
  const un = unavailableOffices(FREE_TIER, {
    requirementsFor: (id) => ({
      offices: capabilitiesFor(id).offices.covered,
      missing: id === "uspto-local" ? ["USPTO_LOCAL_DB"] : [],
    }),
  });
  assert.deepEqual(un, [{ office: "US", memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] }]);
  // The variable name is the entire point of 's third bullet — a refusal that names the provider
  // instead of the variable sent an operator looking for an EUIPO fault on a correct EUIPO config.
  assert.deepEqual(un[0].missing, ["USPTO_LOCAL_DB"]);
});

test("a fully wired composite reports NOTHING unavailable", () => {
  const un = unavailableOffices(FREE_TIER, {
    requirementsFor: (id) => ({ offices: capabilitiesFor(id).offices.covered, missing: [] }),
  });
  assert.deepEqual(un, []);
});

test("a member whose requirements cannot be resolved yields nothing, never a fabricated gap", () => {
  // Inventing an unavailability from a broken lookup would DEFER COVERAGE THE BOX ACTUALLY HAS, which is
  // a worse failure than the lookup bug it would be reporting.
  assert.deepEqual(unavailableOffices(FREE_TIER, { requirementsFor: () => { throw new Error("boom"); } }), []);
  assert.deepEqual(unavailableOffices(FREE_TIER, { requirementsFor: () => null }), []);
  assert.deepEqual(unavailableOffices(FREE_TIER, {}), []);
});

test("unavailableByOffice is a lookup over the same answer, not a second derivation", () => {
  const m = unavailableByOffice(NO_INDEX);
  assert.equal(m.get("US").memberId, "uspto-local");
  assert.equal(m.get("EU"), undefined);
});

// ── THE CONTRACT IS NOT NARROWED. This is what keeps 's R3 admissible. ──────────────────────────

test("THE DOOR STILL OFFERS THE US — the invariant that keeps #659's R3 admissible", async () => {
  // The load-bearing cross-issue property, and the one an over-fix breaks silently.
  //
  // 's admission gate derives the orderable territories from `offices.covered`. The obvious way to
  // implement is to narrow that list to the configured members — and it is wrong: a US-only matter
  // would then be REFUSED AT THE DOOR rather than admitted and disclosed, which is the exact opposite of
  // 's ruling that R3 must start on the free tier. The two issues would each break the other's
  // acceptance, and the only visible symptom would be a scenario that stopped running.
  //
  // Asserted through coveredTerritoryNames rather than by reading the field, because the field is frozen
  // and a test that only proves Object.freeze works proves nothing about the DOOR.
  const offered = await coveredTerritoryNames(FREE_TIER);
  assert.ok(offered.includes("United States"),
    "the US must stay orderable on the free tier — the deployment discloses its gap, it does not refuse the matter");
  assert.ok(offered.includes("European Union"));
  assert.deepEqual([...FREE_TIER.offices.covered], ["EU", "US"], "and the contract itself is unchanged");
});

// ── the four geographies, wired and unwired ─────────────────────────────────────────────────────────

test("EU-only still runs, and discloses nothing — there is no gap to disclose", () => {
  const p = compile(["EU"], NO_INDEX);
  assert.deepEqual(regionsOf(p), ["EU"]);
  assert.deepEqual(deferredOf(p), []);
});

test("EU+US: the EU half EXECUTES and the US half is disclosed — the case the old design lost", () => {
  const p = compile(["EU", "US"], NO_INDEX);
  assert.deepEqual(regionsOf(p), ["EU"], "the EU coverage this box has must survive");
  assert.deepEqual(deferredOf(p), ["US"], "…and the half it does not have must be stated");
  // Both halves asserted together, deliberately. "EU executed" alone passes under a plan that silently
  // dropped the US; "US deferred" alone passes under the old defer-the-whole-entry behaviour.
});

test("US-only: nothing is left to search, so every entry is unsupported and the row is disclosed", () => {
  const p = compile(["US"], NO_INDEX);
  assert.deepEqual(regionsOf(p), []);
  assert.deepEqual(deferredOf(p), ["US"]);
  assert.ok((p.entries ?? []).length > 0 && (p.entries ?? []).every((e) => e.unsupported),
    "a plan with an empty region filter would sweep the world instead — the opposite of what was asked");
});

test("WORLDWIDE expands the empty filter and discloses the US — the false clean that nearly shipped", () => {
  const p = compile(null, NO_INDEX);
  assert.deepEqual(regionsOf(p), ["EU"], "worldwide must become an EXPLICIT EU-only search…");
  assert.deepEqual(deferredOf(p), ["US"], "…and must say so; an empty filter here searched EU and disclosed nothing");
});

test("worldwide on a WIRED box keeps the empty filter byte-for-byte", () => {
  // The expansion is guarded on there being something unreachable. Without the guard every worldwide
  // plan on every provider would be rewritten to chase a case that cannot arise there.
  const wired = compile(null, []);
  assert.deepEqual(regionsOf(wired), [], "an unrestricted scope stays unrestricted when nothing is missing");
  assert.deepEqual(deferredOf(wired), []);
});

test("a single-source provider is completely unaffected", () => {
  // euipo standalone is 's first acceptance half. It composes nothing, so no overlay applies and
  // its plans must be identical with and without the parameter.
  const withParam = compile(["EU"], [], EUIPO);
  const without = compileRegisterPlan({
    manifest: manifest(), job: { jobKey: "t-660", classes: ["9"], jurisdictions: ["EU"] }, capabilities: EUIPO,
  });
  assert.deepEqual(regionsOf(withParam), regionsOf(without));
  assert.deepEqual(deferredOf(withParam), deferredOf(without));
});

// ── the sentence a lawyer reads, and the two classifiers that route it ──────────────────────────────

test("the disclosed reason names the member, the variable and the fix", () => {
  const r = compile(["EU", "US"], NO_INDEX).deferred_coverage[0].reason;
  assert.match(r, /uspto-local/, "which source is missing");
  assert.match(r, /USPTO_LOCAL_DB/, "which variable to set");
  assert.match(r, /never a clean negative/, "doctrine rule 2, stated on the row");
});

test("it is DISTINGUISHABLE from a true coverage gap — the product does cover the US", () => {
  const unavailable = officeUnavailableReason(["US"], "free-tier", { memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] });
  const uncovered = uncoveredJurisdictionReason(["US"], "free-tier");
  assert.notEqual(unavailable, uncovered);
  // Telling a lawyer "the US is outside this provider's coverage" when the fix is one environment
  // variable is a false statement about the product, not a rounding of one.
  assert.match(unavailable, /AS THIS DEPLOYMENT IS CONFIGURED/);
  assert.match(unavailable, /does cover this office/);
});

test("it relabels to `deferred` — a disclosed gap, not an accepted saturation limit", () => {
  const reason = officeUnavailableReason(["US"], "free-tier", { memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] });
  const [row] = coerceToolAbsenceDeferred([{ status: "coverage-limited", axis: "identical", reason }]);
  assert.equal(row.status, "deferred",
    "TOOL_ABSENCE_RE must fire, or the row reads as a limit the run accepted rather than a gap it disclosed");
});

test("it is HELD, never re-run by the clock", () => {
  const reason = officeUnavailableReason(["US"], "free-tier", { memberId: "uspto-local", missing: ["USPTO_LOCAL_DB"] });
  assert.ok(isCapabilityGapReason(reason),
    "an unset variable answers identically on every re-run — closing it on the clock spends a paid unit "
    + "per axis to re-derive a deterministic no (the 2026-07-30 evidence run did exactly that)");
});

// ── a mixed list must not borrow the configuration wording ──────────────────────────────────────────

test("one TRUE coverage gap in the list keeps the coverage sentence", () => {
  // CH is outside EU+US on any box — no variable closes it. If the whole-plan refusal borrowed the
  // "set the variable and re-run" wording for that, it would promise a fix that does not exist.
  const p = compile(["CH", "US"], NO_INDEX);
  assert.deepEqual(regionsOf(p), []);
  const gap = (p.entries ?? [])[0]?.unsupported_reason ?? (p.entries ?? [])[0]?.reason ?? "";
  const combined = String(gap) + (p.deferred_coverage ?? []).map((d) => d.reason).join(" ");
  assert.match(combined, /CH/, "the territory no register reaches is still named");
});

// ── the refusal names the variable, not the provider ('s third bullet) ──────────────────────────

test("the count refusal names the VARIABLE that is missing, not the provider", () => {
  // The sentence that sent an operator hunting an EUIPO fault: "the free-tier credential is absent from
  // the driver env", produced on a box where EUIPO's id and secret were both present and correct and the
  // absent variable was USPTO_LOCAL_DB. The provider id is not the name of a credential.
  const why = countPreflight({
    capabilities: FREE_TIER, jurisdictions: ["US"], credentialPresent: false, missing: ["USPTO_LOCAL_DB"],
  });
  assert.match(why, /USPTO_LOCAL_DB/, "names the variable an operator must set");
  assert.doesNotMatch(why, /the free-tier credential/,
    "and does not name the provider as though the provider were the credential");
});

test("a single-key provider keeps the old wording — its name IS the credential's subject", () => {
  const why = countPreflight({ capabilities: capabilitiesFor("corsearch"), jurisdictions: ["US"], credentialPresent: false });
  assert.match(why, /the corsearch credential is absent/,
    "an empty missing list must not degrade into a sentence with no subject at all");
});
