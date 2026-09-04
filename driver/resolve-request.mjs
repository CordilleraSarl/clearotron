// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// resolve-request.mjs — WHICH PRODUCT is this request, and WHERE would it point? Asked once, by every door.
//
// Two resolutions that each need the other's answer, sequenced in one place so no door has to know the
// order and no two doors can sequence them differently:
//
//   resolveSearchPolicy  needs the RESOLVED TERRITORIES, because a request that names no product is
//                        whichever product its scope makes it (the offering's last rung).
//   resolveEffectiveScope needs the RESOLVED POLICY, because a saved search carries its own scope
//                        (`recipeScope`) and that scope sits between the request and the account defaults.
//
// The cycle is only apparent. A saved search supplies BOTH halves at once: when `recipeKey` is named the
// product is the recipe's own base and no derivation is needed, and when it is not named `recipeScope` is
// provably null and the first pass already has the whole ladder. So: resolve the scope without a recipe,
// resolve the policy against it, then resolve the scope again now that a recipe's scope is known. The two
// scope passes differ only on the recipe arm, which is exactly the arm whose product came from elsewhere.
//
// WHY A MODULE OF ITS OWN. search-policy.mjs is a leaf that profiles.mjs imports, and effective-scope.mjs
// imports profiles.mjs — so search-policy cannot call the scope resolver without a cycle. Re-implementing
// the ladder inside it would be the second ruler this codebase has already rejected twice (validateJob,
// effective-scope). One module above both, and every door calls it.
//
// FAIL-OPEN IS THE CALLER'S CHOICE, not this module's. It throws what its callees throw — an unreadable
// profile store, an invalid recipe file — because the runner's wall and the free previews want opposite
// things from that failure and only they know which.

import { resolveSearchPolicy } from "./search-policy.mjs";
import { resolveEffectiveScope } from "./effective-scope.mjs";
import { productFor } from "./products.mjs";

/**
 * Resolve a prospective request to its product and its scope.
 *
 * @param job      the validated job
 * @param profile  the EFFECTIVE profile (project already folded in), or null
 * @param recipes  the saved-search store, or null when the job names none
 * @returns {{resolved, scope, product}}
 *          `resolved` is resolveSearchPolicy's answer (or its `{clarify}`); `scope` is
 *          resolveEffectiveScope's; `product` is the product id the run WOULD be, or null when the
 *          policy did not resolve.
 */
export function resolveRequest(job, { profile = null, recipes = null } = {}) {
  // Pass 1 — the ladder with no saved-search rung. Its answer is USED only where that rung is provably
  // empty (no recipeKey), and read only for the territories.
  const pre = resolveEffectiveScope(job ?? {}, profile, null);
  const resolved = resolveSearchPolicy(job ?? {}, { profile, recipes, territories: pre.jurisdictions });
  if (resolved?.clarify) return { resolved, scope: pre, product: null };
  const scope = resolveEffectiveScope(job ?? {}, profile, resolved);
  return { resolved, scope, product: resolved.product ?? null };
}

/**
 * The product a RESOLVED run is, derived from what it actually runs rather than from what it was asked
 * for. The two agree by construction at every door — that is what `checkProductScope` enforces — and
 * this is the function that says so about a run in flight or a run that finished.
 *
 * Publish asks exactly this question of a finished run's frozen pipeline and its searched territories,
 * which is why the product NAME is never stored: one function, one answer, at the door and at delivery.
 */
export function productOfRun({ resolved = null, scope = null } = {}) {
  return productFor({ pipeline: resolved?.pipeline ?? null, territories: scope?.jurisdictions ?? [] });
}
