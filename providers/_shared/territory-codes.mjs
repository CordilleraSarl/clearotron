// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Territory vocabulary → ISO 3166 / WIPO ST.3 region codes.
//
// WHY THIS EXISTS: the portal composer offers
// territories by display name ("United States", "European Union" — driver/compose-read.mjs
// PROMPT_TERRITORIES, mirroring portal-ui composerLevers), and those names flowed verbatim into
// `region:` clauses because corsearch's offices.translate is an ISO passthrough that ASSUMES codes.
// That provider answers an unknown multi-word region value as a server error rather than a bad request,
// so auto-recovery classified the failure transient and burned its park budget re-sending it.
// The run died at fan-in with terminalKind:repeat-signature.
//
// The register wire vocabulary is CODES (providers/corsearch/src/index.js: "UPPERCASE 2-letter
// codes"); display names are a UI vocabulary. This module is the one deterministic bridge between
// them. Model phrasing must never be load-bearing for a wire call.
//
// Contract:
//   normalizeTerritory(value) →
//     - a 2-letter code (any 2-letter input passes through uppercased — provider translate owns
//       provider-specific spelling, e.g. EU→EM on clarivate)
//     - ""   for Worldwide (meaning: NO region restriction — the caller omits the clause/filter)
//     - null for an unknown value (caller decides: defer the jurisdiction, or fail loud with a
//       message the composing model can act on — NEVER pass it to the wire)

const strip = (s) => String(s ?? "")
  .normalize("NFKD").replace(/\p{M}/gu, "")           // fold diacritics (Türkiye → Turkiye)
  .toUpperCase()
  .replace(/[().]/g, " ")                             // "African Regional (ARIPO)" → tokens
  .replace(/\s+/g, " ")
  .trim();

import { TERRITORY_TO_CODE } from "../../shared/jurisdiction-tables.mjs";   // a jurisdiction's tables live in one home
export { TERRITORY_TO_CODE };

// ── THE LONG TAIL, DERIVED RATHER THAN TYPED ──────────────────────────────────────────────────────
//
// Measured while fixing Belgium: of the 262 jurisdiction codes this engine holds, 224 had no display
// name in TERRITORY_TO_CODE — Denmark, Portugal, Czechia, Hungary, Israel and most of the world. The
// curated table is a shortlist that grew by demand, and every gap in it is a territory a requester can
// name in words and have resolved to nothing.
//
// So the tail is derived from the runtime's own region names instead of being typed out: every
// two-letter code whose English name the runtime knows maps back to that code. A name the runtime does
// not know answers with the code itself, or "Unknown Region", and both are rejected — a map keyed on
// "WO" pointing at WO would make the sentinel codes resolve as words.
//
// THE CURATED TABLE STILL WINS, and that is the point rather than an ordering detail. Its entries are
// promises this engine makes — the aliases, the regional systems, the worldwide sentinel, and now the
// two Benelux members — and they must not depend on which internationalisation data a customer's
// runtime happens to carry. What is derived is a WIDENING: it can only add names that would otherwise
// have resolved to nothing, and a build whose data is thinner loses names it never promised.
// A WITHDRAWN CODE ANSWERS TO THE SAME NAME AND IS REACHED FIRST. The runtime still knows the codes ISO
// has retired, and it gives them the CURRENT country's name: `VD` (North Vietnam, withdrawn 1977) and
// `VN` both answer "Vietnam". The scan runs AA to ZZ, so the dead code claims the name and the live one
// finds it taken — seven territories resolved that way, Vietnam, Yemen, Serbia, Zimbabwe, Vanuatu,
// Myanmar and Curaçao. None of them is a name this engine holds a jurisdiction for, so a requester who
// wrote "Vietnam" was pointed at a code no register can answer, and one who wrote "Vietnam" AND "VN" had
// two countries and was refused a search they had described correctly.
//
// Asking the runtime to canonicalise the region fixes all seven from the runtime's own data rather than
// from a hand-written list of retirements that would go stale the next time ISO withdraws one. A code
// that is current canonicalises to itself, so this is inert for every other entry — measured over the
// whole AA-ZZ scan, the only entries that move are those seven.
//
// It does not touch the direct-code branch in normalizeTerritory, where UK deliberately stays UK: that
// is an alias the providers own, not a withdrawal, and canonicalising there would take the decision
// away from the translate step that is supposed to make it.
const canonicalRegion = (code) => {
  try { return new Intl.Locale(`und-${code}`).region || code; } catch { return code; }
};

const DERIVED_NAME_TO_CODE = (() => {
  const out = Object.create(null);
  let names;
  try { names = new Intl.DisplayNames(["en"], { type: "region" }); } catch { return out; }
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name;
      try { name = names.of(code); } catch { continue; }
      if (!name || name === code || /^unknown/i.test(name)) continue;
      const key = strip(name);
      if (key && !(key in TERRITORY_TO_CODE) && !(key in out)) out[key] = canonicalRegion(code);
    }
  }
  return out;
})();

export function normalizeTerritory(value) {
  const s = strip(value);
  if (!s) return null;
  if (/^[A-Z]{2}$/.test(s)) return s;                 // already a code (UK stays UK — provider translate owns aliasing)
  if (s in TERRITORY_TO_CODE) return TERRITORY_TO_CODE[s];
  if (s in DERIVED_NAME_TO_CODE) return DERIVED_NAME_TO_CODE[s];
  return null;
}
