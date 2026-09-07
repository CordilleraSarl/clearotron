// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// binding-layers.mjs — which registers legally bind a territory, and which of them a search reached.
//
// THE OWNER'S RULING THIS IMPLEMENTS (2026-08-16): "A clearance for a country must cover every
// trademark right with legal effect there — the national register, the EU-wide register where it
// applies, and international registrations designating either. If we can only search one of those
// layers, it is not a complete clearance for that country, and the report must state that plainly."
//
// THE DEFECT IT ANSWERS. `resolveRegions` is one-to-one: a territory resolves through
// `normalizeTerritory` → `offices.translate` → exactly ONE office code. A matter scoped to France
// searches the French national register alone. An EU trade mark blocks use in France without appearing
// anywhere in the French register, and was never searched unless the client separately listed the EU.
//
// AND IT PRESENTED AS SEARCHED, which is the part that made it a compliance defect rather than a
// coverage one. The disclosure machinery only describes territories the compiler recorded as
// UNREACHABLE. These were recorded as reached, so there was no row to render, and `prelim-search`'s
// rule against rendering a deferred jurisdiction as a clean negative had nothing to fire on.
//
// ── TWO FACTS, KEPT APART ON PURPOSE ────────────────────────────────────────────────────────────────
//
// The layer set is a property of the TERRITORY. France is bound by FR + EM + WO-designating-either,
// whoever searches it and whether or not anyone can. That is `bindingLayersFor` below.
//
// What a given office code's search actually RETURNS is a property of the PROVIDER, and it is a fact
// about a vendor's behaviour rather than about this repository. That is `layerCoverageFor`, read from
// the capability contracts. The same separation `register-availability.mjs` already draws between a
// frozen capability contract and what a deployment can reach.
//
// ── WHY THERE IS AN "unestablished" STATE, AND WHY IT READS AS NOT-SEARCHED ──────────────────────────
//
// The issue's first task was to establish, per provider, which layers an office code returns. For two
// providers the answer is in the tree. For two it is not, and no amount of reading settles it:
//
//   · clarivate declares `US` and `WO` as SEPARATE office codes, and nothing here establishes whether a
//     search scoped to `US` returns international registrations designating the US.
//   · corsearch declares no enumerable covered set at all.
//
// Guessing in either direction is worse than the defect. Guessing "returns" re-creates exactly the
// silent over-claim this issue exists to remove. Guessing "excludes" over-discloses and trains a reader
// to skim the limitation. So `unestablished` is its own value, it is the DEFAULT, and it is treated as
// not-searched — the direction that produces a disclosure a lawyer can act on rather than a claim
// nobody checked.
//
// An unreachable layer must NEVER resolve to an empty set. `register-availability.mjs` carries the
// paragraph on why an empty covered set reads as "covers nothing" and must not be produced by failure;
// the same rule holds here, which is why every function below returns a populated shape or throws.

/** The three kinds of right that can bind a territory. Closed vocabulary. */
export const LAYERS = Object.freeze(["national", "regional", "international"]);

/** What a provider's office code is known to do with a layer. `unestablished` is the default. */
export const LAYER_COVERAGE_STATES = Object.freeze(["returns", "excludes", "unestablished"]);

// ── the regional registers, and the territories they bind ──────────────────────────────────────────
//
// REGIONAL-IN-LIEU-OF-NATIONAL IS THE CASE THAT BREAKS A NAIVE TABLE. Benelux IS the national register
// for NL, BE and LU — those three have no separate national office, so BX is not an extra layer over a
// national one, it is the national one. A table that listed BX as `regional` for the Netherlands would
// disclose a missing national register that does not exist, every single time.
//
// ARIPO and OAPI are the same shape and are deliberately NOT in this table. OAPI genuinely replaces its
// members' national registers; ARIPO does not, and varies by member and by protocol. Getting that wrong
// in either direction is a legal claim, so neither is asserted here and both fall to the default below,
// which discloses rather than assumes. Named so the next reader knows it is a decision, not an omission.
const BENELUX_MEMBERS = Object.freeze(["NL", "BE", "LU"]);

// EU member states, for whom an EU trade mark is a binding regional right. An EUTM covering an
// instructed EU member blocks use there without appearing in that member's national register.
// Exported for the audit's register-presence store, which needs the CONVERSE
// direction — a member state's national right operates inside an EU-scoped matter's market — and must
// not carry a second copy of this list to drift from it.
export const EU_MEMBERS = Object.freeze([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/** The EU-wide register's office code, in the vocabulary the contracts use. */
export const EU_OFFICE = "EM";
/** The international (Madrid) register's office code. */
export const WO_OFFICE = "WO";
/** The Benelux register's office code. */
export const BX_OFFICE = "BX";

/**
 * The registers that legally bind a territory — a property of the territory, never of the provider.
 *
 * @param {string} territory an ISO-ish territory code, already normalized
 * @returns {{layer: string, office: string, why: string}[]} always non-empty
 */
export function bindingLayersFor(territory) {
  const t = String(territory ?? "").trim().toUpperCase();
  if (!t) throw new Error("bindingLayersFor: a territory is required — an empty one would silently bind nothing");

  const layers = [];

  // NATIONAL. Benelux members do not have one of their own; BX stands in its place, and it is the
  // national layer rather than an additional regional one.
  if (BENELUX_MEMBERS.includes(t)) {
    layers.push({ layer: "national", office: BX_OFFICE,
      why: `${t} has no separate national register — Benelux (BX) is the national register for it` });
  } else if (t === WO_OFFICE) {
    // The international register ORDERED AS a territory. Same shape as the EU below: there is no
    // national layer to miss, because the Madrid register IS the order. Without this a matter listing
    // "International" (territory-codes.mjs normalizes it to WO) discloses a missing national register
    // that does not exist — a limitation on a register the plan searched, which is the kind a reader
    // learns to skim.
    layers.push({ layer: "international", office: WO_OFFICE, why: "the international register, ordered directly" });
    return Object.freeze(layers.map(Object.freeze));
  } else if (t === EU_OFFICE || t === "EU") {
    // The EU ordered AS a territory. There is no national layer to miss; the EU register IS the order.
    layers.push({ layer: "regional", office: EU_OFFICE, why: "the EU-wide register, ordered directly" });
    layers.push({ layer: "international", office: WO_OFFICE,
      why: "international registrations designating the EU bind it without a separate EU filing" });
    return Object.freeze(layers.map(Object.freeze));
  } else {
    layers.push({ layer: "national", office: t, why: `the national register of ${t}` });
  }

  // REGIONAL. An EUTM binds every member state.
  if (EU_MEMBERS.includes(t)) {
    layers.push({ layer: "regional", office: EU_OFFICE,
      why: `an EU trade mark blocks use in ${t} without appearing in its national register` });
  }

  // INTERNATIONAL. A Madrid registration designating the territory — or, for an EU member, designating
  // the EU — binds it. One layer, because a search either reaches Madrid designations or it does not.
  layers.push({ layer: "international", office: WO_OFFICE,
    why: EU_MEMBERS.includes(t)
      ? `an international registration designating ${t} or the EU binds ${t}`
      : `an international registration designating ${t} binds ${t}` });

  return Object.freeze(layers.map(Object.freeze));
}

/**
 * What the active provider's contract says its office code returns for a layer.
 *
 * Reads `capabilities.offices.layers` — a map of office code → { national, regional, international },
 * each one of LAYER_COVERAGE_STATES. Anything absent is `unestablished`, deliberately: a provider that
 * has not written the datum down has not established it, and silence must not read as coverage.
 *
 * @returns {"returns"|"excludes"|"unestablished"}
 */
export function layerCoverageFor(capabilities, officeCode, layer) {
  const table = capabilities?.offices?.layers;
  // `"*"` — the answer for every office code not named individually. It exists for the provider whose
  // covered set is not enumerable: corsearch takes any ISO code as a region filter, so there is no list
  // of national offices to write down, and without a fallback the honest answer for every one of them
  // would stay `unestablished` forever. A named entry always wins; `"*"` is consulted only when the
  // code has none, so it can never soften a specific declaration into a general one.
  const entry = table?.[String(officeCode ?? "").toUpperCase()] ?? table?.["*"];
  const state = entry?.[layer];
  return LAYER_COVERAGE_STATES.includes(state) ? state : "unestablished";
}

/**
 * For one ordered territory: which binding layers this plan actually searched, and which it did not.
 *
 * `searchedOffices` is what the compiler resolved for the matter — every office code that will be
 * queried, across every ordered territory. A layer counts as searched when SOME searched office is
 * established to return it. `unestablished` never counts as searched.
 *
 * @returns {{territory, binding, searched, unsearched, complete}}
 */
export function territoryLayerReport(territory, searchedOffices, capabilities) {
  const binding = bindingLayersFor(territory);
  const offices = [...new Set((searchedOffices ?? []).map((o) => String(o ?? "").toUpperCase()).filter(Boolean))];

  // ── THE NATIONAL LAYER IS MATCHED THROUGH THE PROVIDER'S OWN VOCABULARY ( Stage 2) ──────────
  //
  // `bindingLayersFor` names the national office in TERRITORY terms — FR's national register is "FR",
  // because that is a fact about France and not about any vendor. `searchedOffices` is the PROVIDER's
  // vocabulary, and the two only coincide by luck: clarivate's codes are ISO-ish so `FR === FR`, but
  // Signa's are its own keys and France is `inpi-fr`. String equality therefore reported France's
  // national register as UNSEARCHED on a run that had just searched it.
  //
  // Over-disclosure, so it was never going to produce a false clean — but a limitation that fires on a
  // territory the run did cover is a limitation the reader learns to skim, and that is how a real one
  // gets missed. Resolved through the contract's own `translate`, which is the office↔territory bridge
  // the provider already publishes; with no contract, or no translate, the old comparison stands.
  const nationalOffice = (b) => {
    const t = capabilities?.offices?.translate;
    if (typeof t !== "function") return b.office.toUpperCase();
    let resolved = null;
    try { resolved = t(b.office); } catch { resolved = null; }
    return String(resolved || b.office).toUpperCase();
  };

  const searched = [];
  const unsearched = [];
  for (const b of binding) {
    // A layer is reached if ANY searched office returns it — the national register of FR reaches FR's
    // national layer, and an EUIPO search reaches the EU regional layer for every member state.
    const wanted = b.layer === "national" ? nationalOffice(b) : null;
    const by = offices.find((o) => layerCoverageFor(capabilities, o, b.layer) === "returns"
      && (b.layer !== "national" || o === wanted));
    if (by) searched.push({ ...b, by });
    else unsearched.push({ ...b, state: offices.map((o) => layerCoverageFor(capabilities, o, b.layer)).includes("excludes") ? "excludes" : "unestablished" });
  }
  return Object.freeze({
    territory: String(territory).toUpperCase(),
    binding, searched, unsearched,
    complete: unsearched.length === 0,
  });
}

/**
 * The sentence a lawyer reads. Plain words, no engine vocabulary — `coverage-form.mjs` refuses a row
 * whose reason carries an axis token, and the reader does not have one anyway.
 */
export function unsearchedLayerReason(report) {
  const names = {
    national: "the national register",
    regional: "EU-wide rights",
    international: "international registrations designating it",
  };
  const missing = report.unsearched.map((u) => names[u.layer] ?? u.layer);
  const list = missing.length === 1 ? missing[0]
    : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Not a complete clearance for ${report.territory}: ${list} ${missing.length === 1 ? "was" : "were"} `
    + `not searched. A right on an unsearched register blocks use in ${report.territory} without appearing `
    + `in the register that was searched, so this result cannot be read as a clean negative for `
    + `${report.territory}.`;
}
