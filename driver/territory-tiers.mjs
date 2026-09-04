// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// territory-tiers.mjs — WHAT KIND of place a territory entry names: a country, a region, or neither.
//
// WHY THIS EXISTS. Nothing in the engine could answer "is this a country?" — and two rules were
// counting entries as if it could. `["European Union"]` canonicalizes to `["EU"]`, length 1, so a
// full deep dive over a 27-state region passed the one-country rule (scope-rules.mjs) unchallenged,
// and the 20-territory cap (enqueue-schema.mjs) read it as one place. A region is not a country: the
// case-law and opposition reading that makes a deep dive deep is per-country practice, and there is
// no such thing as "the" precedent of the EUIPO's member states.
//
// WHY IT IS A MODULE OF ITS OWN, and not a field added to either table it reads:
//   - providers/_shared/territory-codes.mjs is the WIRE bridge (display name → code). It cannot import
//     from driver/, and it holds 34 display names, not the code universe.
//   - jurisdiction-codes.mjs scopes itself OUT of the wire vocabulary in its own header ("this module
//     canonicalizes what the DRIVER records and compares"), and it takes codes, not display names.
// The tier needs both halves, so it lives between them — the same argument that created product-rows.mjs.
//
// THE REGION SET IS THE ONE ALREADY DOCUMENTED, not a second list. jurisdiction-codes.mjs names the
// supranational entries in the known universe as "the register-world extras — EU (EUIPO, canonical),
// WO (WIPO / Madrid International Register), AP (ARIPO), OA (OAPI), BX (Benelux), EA (Eurasian), IB
// (International Bureau)". That IS the region set, post-fold: canonicalJurisdictionCode already folds
// EM / EUTM / EUIPO → EU, so those spellings need no entry here. A unit test pins the subset relation
// so a new supranational code cannot ship tiered as a country.
//
// WO (Madrid) tiers as a REGION mechanically, because it covers many countries and must never count as
// one. Whether an international registration is a valid geography for any given product is a separate,
// unanswered question — see the handover; do not read this tier as an answer to it.
//
// AN UNRECOGNIZED ENTRY IS ITS OWN TIER, NEVER A COUNTRY. `normalizeTerritory` passes ANY two-letter
// input through uppercased, so "QQ" would otherwise look exactly like a country code and satisfy a
// one-country rule while naming nowhere. The tier is what a caller asks; what a caller does about it is
// the caller's rule.
//
// PURE (no node imports, no env, no I/O) → tests offline.

import { normalizeTerritory } from "../providers/_shared/territory-codes.mjs";
import { canonicalJurisdictionCode, KNOWN_JURISDICTION_CODES } from "./jurisdiction-codes.mjs";

/** The supranational codes: one entry covering many countries. Post-fold — EM/EUTM/EUIPO arrive as EU. */
export const REGION_CODES = Object.freeze(new Set(["EU", "WO", "AP", "OA", "BX", "EA", "IB"]));

/**
 * — KNOWN, AND STILL NOT A COUNTRY.
 *
 * `KNOWN_JURISDICTION_CODES` is the set of codes the engine RECOGNIZES on a record, which is a wider
 * question than "does this name one country". Its tail carries WIPO ST.3 register-world extras, and
 * `ZZ` is ST.3's code for UNSPECIFIED — the literal "nowhere" token. Tiered by membership alone it came
 * back "country", so a Full country search over `["ZZ"]` named nowhere and satisfied the one-country
 * rule at every door.
 *
 * That is precisely the failure this module was written to prevent — its own header says "QQ would
 * otherwise look exactly like a country code and satisfy a one-country rule while naming nowhere" —
 * arriving from INSIDE the known set instead of outside it, which is why the guard did not see it.
 *
 * KEPT KNOWN, TIERED HONESTLY. Removing `ZZ` from the known set would be the other repair and it is the
 * wrong one: a provider may legitimately stamp it on a record, and an unknown code there is dropped or
 * warned about. What must not happen is a REQUEST naming it passing a geography rule. Membership answers
 * "can we read this"; the tier answers "is this one country"; they were the same answer and are not the
 * same question.
 *
 * DELIBERATELY ONLY `ZZ` TODAY. The siblings beside it in that list — XA, XG, XS, XW — are provider
 * extension codes whose register semantics I could not establish at source, and XK is Kosovo, which
 * registers do treat as a territory. Guessing which of those name a country would trade a measured bug
 * for an unmeasured one. The MECHANISM is the fix and the roster is explicit: adding a code here is one
 * line once somebody can say what it means.
 */
export const KNOWN_NON_COUNTRY_CODES = Object.freeze(new Set(["ZZ"]));

/** The four answers. Exported so a caller cannot misspell one in a comparison. */
export const TERRITORY_TIERS = Object.freeze(["worldwide", "region", "country", "unrecognized"]);

/**
 * What kind of place does this entry name?
 *
 * @param value a territory as a requester wrote it — a display name ("United States"), a code ("US"),
 *              or one of the worldwide tokens ("Worldwide" / "global" / "all")
 * @returns "worldwide"    — no territorial restriction at all; not a place, a mode
 *          "region"       — a supranational system covering many countries (EU, BX, AP, OA, EA, WO, IB)
 *          "country"      — one country, inside the known ISO 3166-1 universe
 *          "unrecognized" — the engine has no idea what this names. NEVER treat it as a country.
 */
export function territoryTier(value) {
  const code = normalizeTerritory(value);
  if (code === "") return "worldwide";
  if (code == null) return "unrecognized";
  const canonical = canonicalJurisdictionCode(code);
  if (!canonical) return "unrecognized";
  if (REGION_CODES.has(canonical)) return "region";
  // — a known code that names no country is NOT one. Checked before the
  // membership test, because membership is exactly what made it look like a country.
  if (KNOWN_NON_COUNTRY_CODES.has(canonical)) return "unrecognized";
  return KNOWN_JURISDICTION_CODES.has(canonical) ? "country" : "unrecognized";
}

/**
 * — THE ENTRIES THAT NAME A PLACE, for a caller that must not pass on the rest.
 *
 * An account's `defaultJurisdictions` is a free-text lines field in the staff profile editor, validated
 * as an array and nothing more (products.mjs says so in as many words), and it reaches the matter-frame
 * prompt. So a typo in a staff form had a clear path into a client-facing prompt, where the model reads
 * it as a place that matters.
 *
 * WHY THIS FILTERS RATHER THAN REFUSING, and the choice is deliberate. The profile loader's only
 * mechanism is `die()`, which is right for `platforms` — its own comment says a slip there "bricks every
 * run under the profile", so failing at load beats failing in every run. A bad territory default does
 * NOT brick a run; it widens a prompt. Refusing it at load would convert a scope defect into a total
 * outage for that account, and a product refusal is never an improvement on a product that works. The
 * garbage is dropped where it would have been read, and the caller says what it dropped.
 *
 * @returns {{kept: string[], dropped: string[]}} — `dropped` is a finding, never a silence.
 */
export function recognizedTerritories(list) {
  const kept = [], dropped = [];
  for (const entry of list ?? []) (territoryTier(entry) === "unrecognized" ? dropped : kept).push(entry);
  return { kept, dropped };
}

/**
 * The canonical IDENTITY of a territory entry — what makes two spellings the same place.
 *
 * `"United States"`, `"US"` and `"us"` are one country; `"European Union"`, `"EUIPO"` and `"EM"` are one
 * region. A rule that counts places has to count identities, not strings, or a requester who wrote the
 * name and the code has "two countries" and is refused a search they correctly described.
 *
 * An UNRECOGNIZED entry keys on its own uppercased text, because nothing better exists and two typos
 * that differ are still two unknowns. `""` for a worldwide token — a mode is not a place, and callers
 * partition those out before they ever count.
 *
 * @param value a territory as a requester wrote it
 */
export function territoryKey(value) {
  const code = normalizeTerritory(value);
  if (code === "") return "";
  return canonicalJurisdictionCode(code ?? "") || String(value ?? "").trim().toUpperCase();
}

/**
 * Split a territory list by tier, keeping the ORIGINAL entries in their original order.
 *
 * Originals rather than codes because both callers echo what the requester sent back to them: a
 * refusal that quotes "EU" at someone who wrote "European Union" makes them hunt for a value they
 * never used.
 *
 * @returns {{worldwide: string[], regions: string[], countries: string[], unrecognized: string[],
 *            named: string[]}}
 *          `named` is every entry that is not a worldwide token — regions, countries and unrecognized
 *          entries together, i.e. everything that would actually restrict the search. It is the list a
 *          per-search cap counts, because each of those is a register plan whatever tier it is.
 */
export function partitionTerritories(list) {
  const out = { worldwide: [], regions: [], countries: [], unrecognized: [], named: [] };
  for (const entry of list ?? []) {
    const tier = territoryTier(entry);
    if (tier === "worldwide") { out.worldwide.push(entry); continue; }
    out.named.push(entry);
    if (tier === "region") out.regions.push(entry);
    else if (tier === "country") out.countries.push(entry);
    else out.unrecognized.push(entry);
  }
  return out;
}
