// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-availability.mjs — which of the active provider's offices this DEPLOYMENT can actually reach.
//
//. A capability contract states what a source CAN do, frozen and environment-blind — that is
// providers/<id>/src/capabilities.js's own rule, and it must stay true: register-capabilities.mjs
// imports every contract at module load, so a contract that read the environment would make the same
// provider answer differently on two boxes and there would be no single thing to test.
//
// But a COMPOSED provider has a second fact that the contract cannot hold: the free tier covers EU+US,
// and a box with EUIPO credentials and no USPTO_LOCAL_DB reaches only the EU half. That is not a
// capability question, it is a configuration question, so it is answered here — in the driver, which is
// already the layer that knows what is in the environment.
//
// ── WHY THIS DOES NOT NARROW `offices.covered` ───────────────────────────────────────────────────────
//
// The first cut narrowed the contract's covered list to the configured members and handed that
// downstream. It is wrong twice over:
//
//   · 's admission gate reads `offices.covered` to decide which territories a client may ORDER.
//     Narrowing it to EU would refuse a US-only matter AT THE DOOR, on a provider that covers the US.
// is the report of that shape of refusal and its acceptance is that a US-only scenario is
//     admitted rather than vetoed. A door that refuses is not a disclosure.
//
//     CORRECTED 2026-08-12  — THIS USED TO READ "the ruling on  is that a US-only scenario
//     must START on the free tier and disclose its US deferral", which is wider than  and reads as
//     a ruling about DEPLOYMENT CONFIGURATION.  ruled on two things, neither of them that: the
//     store-wide veto's GRANULARITY (refuse the scenario that does not fit, not every scenario beside
//     it) and the door not narrowing declared coverage. Whether a matter whose ENTIRE ordered scope is
//     unreachable on this box should start is a separate question and  did not answer it. The
//     owner ruling of 2026-08-12 does: partial coverage discloses, empty coverage refuses by name
//     before spend (reachableRegions below, and the two Depth 2 preflights that read it).
//   · resolveRegions would then classify the US as "outside the provider's coverage", which is a false
//     sentence about the product. The free tier covers the US. This install is not configured for it.
//
// So the contract is left exactly as declared, resolveRegions runs against the FULL coverage, and the
// unreachable offices are split out afterwards with a reason that says what is actually true
// (register-plan.mjs officeUnavailableReason). The EU half executes, and the US half rides the plan as
// a `deferred_coverage` entry.
//
// CORRECTED 2026-08-11 — THIS PARAGRAPH USED TO SAY "one qid per office … which is the shape
// joinPlanToBands already has", AND THAT WAS FALSE ABOUT THE COMPILER IT DOCUMENTS. There is no
// per-office qid. compileRegisterPlan narrows ONE shared `regions` array and hands it to every entry
// (register-plan.mjs:550); the unreachable office produces no entry, so no qid, so no band block, so
// nothing ever reaches joinPlanToBands' deferred bucket — whose only source is a block stamped
// `error:true && deferred:true` (register-plan.mjs:1093).
//
// The consequence was not academic. `deferred_coverage` rode the plan and nothing that a reader sees
// read it: coverage-form.mjs seeded its deferred rows from skeleton qids alone, so an EU+US matter on a
// box with no index shipped an EU-only clean with no row saying the US was never searched. A false
// clean, reached through the disclosure that was supposed to prevent one, and this sentence is what
// made it look already-handled. driver.config.mjs:789 cited it as the reason preflight could stop
// requiring USPTO_LOCAL_DB.
//
// The split is still right and is unchanged. What had to be built is the consumer: coverage-form.mjs
// now reads `plan.deferred_coverage` directly and emits an `open` row per active axis. The disclosure
// does not ride joinPlanToBands, because a plan-level fact cannot — it is per-territory, and that
// function is per-qid.
//
// ── WHY THE OLD "BOTH MEMBERS REQUIRED" RULE WAS RIGHT, AND STILL IS ─────────────────────────────────
//
// free-tier/src/capabilities.js argued that a half-configured free tier must be refused up front,
// because joinPlanToBands has three outcomes per qid — executed, missing, deferred — and NO shape for
// "half of this ran", so an EU+US entry whose US half refuses defers WHOLE and takes its EU coverage
// with it. That argument is CORRECT and it is not repealed here. It is the reason the split happens at
// PLAN COMPILE rather than at execution: by the time a qid exists it is already single-office, so no
// entry is ever half-run and the invariant it protects is never tested. Move this later and the old
// failure returns.
//
// PURE apart from the env object handed in.

/**
 * The member ids of a composed provider, or [] for a single-source one.
 *
 * `composedOf` is a STATIC declaration on the contract — membership is a fact about the provider, not
 * about the box, so it belongs there. Absent means single-source, which is true of every provider but
 * the free tier; the contract shape test pins that the free tier declares it, so the absence cannot
 * become an accidental "nothing to check".
 */
export function membersOf(capabilities) {
  const m = capabilities?.composedOf;
  return Array.isArray(m) ? m.filter((id) => typeof id === "string" && id) : [];
}

/**
 * Which offices the active provider covers but cannot reach as configured.
 *
 * @param capabilities   the ACTIVE provider's contract, unmodified
 * @param requirementsFor  (memberId) => { offices: string[], missing: string[] } — injected so this
 *        module never imports driver.config.mjs (which reads the environment at load) and so the
 *        member→variable mapping stays where it is already declared, on the member's own adapter.
 *        Two sources of that mapping is how a preflight and a planner come to disagree about which
 *        variable matters.
 * @returns [{ office, memberId, missing[] }], one entry per unreachable office, deterministic order.
 *
 * A member whose requirements cannot be resolved at all yields NOTHING here — deliberately. This
 * function's job is to name what is missing, and inventing an unavailability from a lookup failure
 * would defer real coverage on a bug in the lookup. The failure that matters (no member configured at
 * all) is caught by preflightCredentials before a run starts.
 */
export function unavailableOffices(capabilities, { requirementsFor, env = process.env } = {}) {
  const out = [];
  if (typeof requirementsFor !== "function") return out;
  for (const memberId of membersOf(capabilities)) {
    let req;
    try { req = requirementsFor(memberId, env); } catch { continue; }
    const missing = Array.isArray(req?.missing) ? req.missing.filter(Boolean) : [];
    if (!missing.length) continue;
    for (const office of (Array.isArray(req?.offices) ? req.offices : [])) {
      out.push({ office: String(office), memberId, missing: [...missing] });
    }
  }
  return out.sort((a, b) => a.office.localeCompare(b.office));
}

/**
 * The same answer as a Map office → { memberId, missing[] }, for the planner's per-region split.
 * Separate from the array form because the plan needs a lookup and the report needs an ordered list,
 * and deriving one from the other at two call sites is how they come to disagree.
 */
export function unavailableByOffice(unavailable) {
  return new Map((unavailable ?? []).map((u) => [u.office, u]));
}

/**
 * — the SAME split, for the two lanes that never compile a plan.
 *
 * The plan lane splits an unreachable office off at compile (compileRegisterPlan) and every surviving
 * qid is single-office. Depth 2's count and record lanes do not compile a plan: they resolve regions
 * against the full declared coverage and hand them straight to the provider adapter. On a composite
 * that is a fan-out to EVERY member, so the unconfigured one is asked, refuses, and the composite
 * correctly declines to return a partial sum — killing a lane whose other half works perfectly. That
 * is 's observed refusal, and 's acceptance ("free-tier starts and ships a disclosed US
 * deferral") was never met on these two lanes.
 *
 * @param regions      what resolveRegions produced, against the FULL coverage. `[]` is meaningful.
 * @param unavailable  unavailableOffices() output for the active provider.
 * @param covered      capabilities.offices.covered — needed ONLY for the empty-regions case below.
 * @returns { regions, dropped[] } — dropped is the subset of `unavailable` that this scope actually
 *          asked for, so a caller discloses the offices the READER ordered and not every office the
 *          box happens to be missing.
 *
 * @param worldwide  resolveRegions's OWN flag for "this scope is unrestricted". Required, see below.
 *
 * AN EMPTY `regions` IS NOT AN EMPTY SCOPE, and this is the half a narrowing filter gets wrong.
 * Downstream, `[]` means UNRESTRICTED — free-tier's routeRegions reads it as "every member
 * participates, each over its own whole coverage" (providers/free-tier/src/core.js). So filtering `[]`
 * yields `[]`, which routes to the unconfigured member exactly as before and fixes nothing. The
 * reachable office list is therefore SUBSTITUTED explicitly on that path, never left empty.
 *
 * BUT `regions: []` MEANS TWO DIFFERENT THINGS, and substituting on both produces a false statement.
 * resolveRegions returns it for an unrestricted scope AND for "every territory the matter named fell
 * outside the provider's coverage" — its own comment: *"regions empty WITH deferrals is the opposite
 * case … Sweeping the world because the requested countries were unreachable would be the exact
 * inversion of what was asked."* Substitute on that second case and a JP-only matter on a half-wired
 * free tier gets counted over the EU and told its US coverage is incomplete — two registers the client
 * never ordered, one of them presented as a gap in their search.
 *
 * The discriminator is resolveRegions's `worldwide` flag, which is set on exactly the unrestricted
 * path (express Worldwide, or no territories named at all) and absent when regions are empty because
 * they were all deferred. It is a required argument rather than a default, because defaulting it to
 * true is the silent version of this bug and defaulting it to false silently reinstates the fan-out.
 *
 * An empty RESULT means the ordered scope is entirely unreachable here. It is returned as such rather
 * than silently widened. The caller refuses on it (countPreflight), which is the ruling's "empty
 * coverage refuses early" and lands before spend. An entirely UNCOVERED scope is a different fact and
 * is not this function's to answer — it yields no drops at all, and is where it gets a reader.
 */
export function reachableRegions(regions, unavailable, covered, worldwide) {
  const out = (unavailable ?? []).length ? new Set((unavailable ?? []).map((u) => String(u.office))) : null;
  const asked = (Array.isArray(regions) ? regions : []).map((r) => String(r));
  // Nothing unreachable: byte-identical to what came in, for every single-source provider and every
  // fully wired composite. The `null` above keeps that path free of a Set nobody reads.
  if (!out) return { regions: asked, dropped: [] };
  // Empty and NOT unrestricted: every named territory was deferred as uncovered. Unchanged behaviour,
  // and NO drops — an office the matter never ordered is not a gap in it.
  if (!asked.length && !worldwide) return { regions: [], dropped: [] };
  // The unrestricted case. `covered` is the contract's own list and is NOT narrowed anywhere else
  // — it is read here only to name the offices that remain.
  const scope = asked.length ? asked : (Array.isArray(covered) ? covered.map((c) => String(c)) : []);
  const kept = scope.filter((r) => !out.has(r));
  const dropped = (unavailable ?? []).filter((u) => scope.includes(String(u.office)));
  return { regions: kept, dropped };
}
