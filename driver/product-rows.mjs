// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// product-rows.mjs — the ONE canonical wire row for a product in the offering.
//
// Three surfaces answered "what can I order?" independently: the portal's own list, the recipe service's,
// and the ops-MCP's describe_options. All three derived the same row from the registry, and
// portal-service.mjs said so in as many words — "both are pure derivations, so there is nothing to drift
// beyond presentation". That was true while every field was a straight copy. It stopped being true the
// moment a row had to carry a COMPUTED figure and a client-facing NAME, so the derivation moved here and
// the three call it.
//
// ── WHY THIS IS NOT IN search-policy.mjs ────────────────────────────────────────────────────────────
//
// search-policy.mjs is a leaf that every consumer in the engine imports (and profiles.mjs imports it, so
// a cycle is one careless import away). Reaching from there into effort-model.mjs would be safe today —
// effort-model has no imports of its own — but it would falsify that file's own contract comment, and
// the next person to add an import would have no rule left to check against.
//
// ── WHY THIS IS NOT IN effort-model.mjs ─────────────────────────────────────────────────────────────
//
// effort-model.mjs declares itself a VERBATIM port of the effort half of composerLevers.ts, and
// portal-ui/test/effortModelParity.test.ts pins the two together weight by weight. That claim is the
// whole value of the file. Registry-aware arithmetic there would weaken it into "mostly a port", which
// is the shape that lets a weight drift.
//
// So: a third module that contaminates neither, and one place to pin.

import { ORDERABLE_PRODUCTS, PRODUCT_POLICIES, RETIRED_POLICIES, policyFor } from "./search-policy.mjs";
import { maxNamesFor, productSpec } from "./products.mjs";
import { leversFromResolved, turnaround, turnaroundHours } from "./effort-model.mjs";

/**
 * The BASE turnaround for a product: what it takes with nothing added.
 *
 * A per-product turnaround is not a single number, and pretending otherwise is what produced the string
 * this replaces ("under an hour" / "same day", where "same day" said the same thing about a one-hour
 * register read and a two-hour clearance with a native-language lane). But the decomposition is clean:
 * the PRODUCT fixes the bounds and there is nothing left for the REQUEST to fix — since the quote
 * is a table lookup with no arithmetic in it. So publish the FLOOR — one name, nothing optional — which
 * every surface that has a request now also arrives at.
 *
 * The alternative was to make every surface compute its own floor levers, which is this function written
 * four times.
 *
 * BEFORE the floor and a request's quote could differ: the bounds were multiplied by a wave count
 * derived from a hard-coded copy of the run-slot cap, so a multi-name request quoted higher than the row
 * published here. They cannot differ now, and a surface that starts producing a different number from
 * this one has reintroduced the multiplier.
 *
 * The base is the ruled bounds formatted:
 *
 *     knockout-search              0.17h   5–10 min
 *     global-preliminary-search    2.5h    1.5–2.5 hours
 *     multi-country-focus-search   2.5h    1.5–2.5 hours
 *     full-country-search          2.5h    1.5–2.5 hours
 *
 * ALL THREE CLEARANCES ARE IDENTICAL HERE and that is the owner ruling, not a flattening to fix.
 * The table above used to separate them with lane adders (+0.5 case law, +0.5 native, +0.5 single
 * territory). Eight delivered runs refuted that: the full-country run — the only one carrying every lane,
 * quoted 3.0h — came in at 2.33h, SHORTER than five of the other seven, which carried fewer lanes and were
 * quoted 1.5h. The adders produced spread the wall does not have. One range now covers every clearance.
 *
 * What separates the clearance products is SCOPE — where they point and how much they read — which the
 * effort units and the cost band still express. Turnaround is not the axis that tells them apart, and the
 * hours column agreeing across the three is the decision rather than a bug.
 */
export function baseTurnaroundFor(policy) {
  if (!policy) return { text: null, hours: null };
  const spec = productSpec(policy.product);
  const levers = leversFromResolved({
    pipeline: policy.pipeline,
    components: policy.components,
    caseLaw: spec?.caseLaw === true,
    // The FLOOR is the product with nothing added, and geography is the request's half of the answer —
    // so no territory is assumed here even for the one product that always has exactly one. A floor that
    // baked in the single-territory increment would be quoting a request nobody has made yet.
  });
  const i = { levers, names: 1, classes: 0, platforms: 0, density: null };
  return { text: turnaround(i), hours: turnaroundHours(i) };
}

/**
 * The canonical wire row for one product, or null for a key this build does not know.
 *
 * ANSWERS FOR A RETIRED ROW TOO, and deliberately: the portal's availability refusal and the plan doors
 * both call it to put a NAME in front of a client, and a run ordered before a retirement still has to be
 * nameable. What it must never be used for is building a MENU — that is `productRows()` below, which
 * walks the orderable offering.
 *
 * `name` is the product's CLIENT-FACING NAME and it comes off report.identity — the registry row's own
 * string, printed at the top of the delivered document, so the interface can never call a thing by a
 * different name than the report it produces, and a saved-search label cannot rename a product.
 *
 * `maxNames` is the OFFERING's figure and is never hand-typed on any surface that shows it. That is the
 * rule this row exists to keep: a tagline reading "up to 20 names" beside a wall that refuses at 8 is
 * exactly what shipped before.
 */
export function productRow(key) {
  const k = String(key ?? "").trim().toLowerCase();
  const p = PRODUCT_POLICIES[k] ?? RETIRED_POLICIES[k];
  if (!p) return null;
  const base = baseTurnaroundFor(p);
  const spec = productSpec(k);
  return {
    key: k,
    name: p.report?.identity ?? null,
    stageLabel: p.stageLabel,
    pipeline: p.pipeline,
    components: Object.entries(p.components ?? {}).filter(([, v]) => v).map(([c]) => c),
    // What the OFFERING says about this product, for the surfaces that have to describe it without
    // re-deriving anything: the geography it accepts, whether it carries case law, whether the
    // native-language investigation is absent / offered / automatic, and how many names it reads.
    geography: spec?.geography ?? null,
    caseLaw: spec?.caseLaw === true,
    nativeLanguage: spec?.nativeLanguage ?? null,
    maxNames: maxNamesFor(k),
    baseTurnaround: base.text,
    baseTurnaroundHours: base.hours,
    // A retired row is nameable and NOT orderable, and the row says which rather than leaving a caller to
    // join against a second list it might not have.
    orderable: ORDERABLE_PRODUCTS.includes(k),
  };
}

/** Every product in the offering, in offering order — lightest first, which is the order a menu reads
 *  down. Retired rows are NOT here: `productRow()` names one, this offers one. */
export function productRows() {
  return ORDERABLE_PRODUCTS.map((key) => productRow(key));
}

export { policyFor };
