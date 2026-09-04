// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-variants.mjs — the CLOSE-VARIATION form generator for the register hit-count lane.
//
// The third count predicate ("close variations") is not a provider capability. It is N exact-predicate
// probes over forms this file generates, and that is the whole design: `identical` and `containing` are
// questions a register answers natively, and no register in the wired set answers "near-miss" the same
// way twice. A native fuzzy predicate is a per-provider upgrade for later, declared in a capability
// contract when it has been probed. Until then the product needs ONE meaning on every deployment, so the
// forms are ours and the predicate under them is the exact one every provider already has.
//
// ══ WHY CODE AND NOT A MODEL ═══════════════════════════════════════════════════════════════════════
//
// Rule 1 of the count lane (register-count.mjs) is that no model touches a number. A model-generated
// variant set would put a model one step upstream of one — the forms decide the figure, so a set that
// varies between runs is a figure that varies between runs, over the same name, on the same register.
// This file imports nothing. Same input, same forms, forever, and the forms are recorded in the artifact
// so a reader can check the number against what was actually asked.
//
// ══ WHAT A "CLOSE VARIATION" IS HERE, EXACTLY ══════════════════════════════════════════════════════
//
// ONE classic near-form step from the name. Every rule below is a single global substitution or one
// structural edit applied to the BASE name — never to another rule's output. That bound is deliberate
// and it is what makes the set explainable: every form is one named rule away from the mark, and the
// report prints the rule's own forms beside the number.
//
// Chaining rules would be a better search and a worse product. Two steps out is where "close" stops
// meaning close (ALCHEMIST → ALKEMIST is a near-miss a filer would worry about; ALCHEMIST → ALKMIST is
// a different word), and the set would grow multiplicatively into a figure nobody could audit and a bill
// nobody predicted — on Corsearch every form is a billable search.
//
// ══ WHAT THIS IS NOT ═══════════════════════════════════════════════════════════════════════════════
//
// NOT a confusability judgment. A form appearing here says a register was asked about it, nothing more.
// Whether any filing found under it would actually block anything is lawyer judgment, and this product
// does not make it — same rule the "containing" column has carried since the lane launched.
//
// NOT phonetic search. There is no soundex, no metaphone, no edit-distance ranking. Those return a
// SCORE, and a score is a judgment wearing arithmetic; the count lane has no room for one.

/** Hard ceiling on generated forms, per mark. Each one is a provider call — on a billing provider, a
 *  billable one — so the bound is a cost bound as much as a legibility bound. Rules are applied in
 *  declaration order and the set is truncated at the cap, so which forms survive a truncation is
 *  deterministic too (and `truncated` says it happened). */
export const VARIANT_CAP = 12;

const CONSONANT = "b-df-hj-np-tv-z";

// The rule table. ORDERED, and the order is the survival order under the cap: the transformations most
// likely to catch a real near-miss filing come first (separator and doubling collapse, then the classic
// letter-swap pairs, then the trims). `id` is what the artifact records; `label` is what a reader sees.
//
// Every `apply` returns a string or null. Null means the rule did not bite on this name — it is NOT a
// failure and it is not recorded: a name with no PH in it simply has no PH→F form, and listing one that
// equals the base would be a variant that is the mark itself.
const RULES = Object.freeze([
  { id: "collapse-separators", label: "spacing/hyphen collapse",
    apply: (s) => s.replace(/[\s\-'’.]+/g, "") },
  { id: "doubled-to-single", label: "doubled consonant → single",
    apply: (s) => s.replace(new RegExp(`([${CONSONANT}])\\1`, "gi"), "$1") },
  // The first single consonant flanked by vowels is doubled — the other half of the doubling pair, and
  // pinned to ONE site so the rule yields one form rather than a combinatorial set.
  { id: "single-to-doubled", label: "single consonant → doubled",
    apply: (s) => s.replace(new RegExp(`([aeiou])([${CONSONANT}])([aeiou])`, "i"), "$1$2$2$3") },
  { id: "ch-to-k", label: "CH → K", apply: (s) => s.replace(/ch/gi, "K") },
  { id: "k-to-ch", label: "K → CH", apply: (s) => s.replace(/k/gi, "CH") },
  { id: "c-to-k", label: "C → K", apply: (s) => s.replace(/c/gi, "K") },
  { id: "k-to-c", label: "K → C", apply: (s) => s.replace(/k/gi, "C") },
  { id: "ck-to-k", label: "CK → K", apply: (s) => s.replace(/ck/gi, "K") },
  { id: "s-to-z", label: "S → Z", apply: (s) => s.replace(/s/gi, "Z") },
  { id: "z-to-s", label: "Z → S", apply: (s) => s.replace(/z/gi, "S") },
  { id: "ph-to-f", label: "PH → F", apply: (s) => s.replace(/ph/gi, "F") },
  { id: "f-to-ph", label: "F → PH", apply: (s) => s.replace(/f/gi, "PH") },
  { id: "y-to-i", label: "Y → I", apply: (s) => s.replace(/y/gi, "I") },
  { id: "i-to-y", label: "I → Y", apply: (s) => s.replace(/i/gi, "Y") },
  { id: "x-to-ks", label: "X → KS", apply: (s) => s.replace(/x/gi, "KS") },
  // The vowel swaps are FIRST-OCCURRENCE ONLY, unlike the consonant pairs above. A global A→E over
  // BRIMSTONE yields CRYBEBY, which is not a form anyone has filed and not a form anyone would fear; the
  // near-miss a filer actually worries about is one vowel out (ARBORA/ERBORA). Same one-step bound as
  // the rest of the table, applied where a global rule would have broken it.
  { id: "e-to-a", label: "first E → A", apply: (s) => s.replace(/e/i, "A") },
  { id: "a-to-e", label: "first A → E", apply: (s) => s.replace(/a/i, "E") },
  { id: "o-to-u", label: "first O → U", apply: (s) => s.replace(/o/i, "U") },
  { id: "u-to-o", label: "first U → O", apply: (s) => s.replace(/u/i, "O") },
  // The trims come last: they REMOVE a letter, so they are the forms furthest from the mark and the
  // first to fall off the cap on a long name that the swap rules already cover well.
  { id: "trim-plural", label: "plural/suffix trim",
    apply: (s) => (/[^s]s$/i.test(s) ? s.slice(0, -1) : (/es$/i.test(s) ? s.slice(0, -2) : null)) },
  { id: "trim-trailing-e", label: "trailing E trim",
    apply: (s) => (/[^e]e$/i.test(s) ? s.slice(0, -1) : null) },
]);

/** Every rule this build knows, for the report's method line and for the contract tests. */
export const VARIANT_RULES = Object.freeze(RULES.map((r) => Object.freeze({ id: r.id, label: r.label })));

/** The form as the register is asked for it, and as the artifact records it: upper-case, so a reader can
 *  tell a GENERATED form from the mark the client wrote. Register name predicates are case-insensitive
 *  on every provider in the wired set, so the case carries no search meaning — only display meaning. */
const canon = (s) => String(s ?? "").trim().toUpperCase();

/**
 * The close-variation forms for one mark.
 *
 * @param name  the mark, verbatim from the request.
 * @param cap   the ceiling (default VARIANT_CAP). Below 1 ⇒ no forms, never an unbounded set: a typo'd
 *              env var must not turn a bounded fan-out into an unbounded bill.
 * @returns { base, forms: [{ form, rules: [id] }], truncated, generated }
 *          `forms` is deduped and never contains the base. A name with no near-forms (a bare number,
 *          a single letter) returns an EMPTY list — which the caller must report as "no variant forms
 *          were generated", never as a count of zero filings.
 */
export function variantForms(name, { cap = VARIANT_CAP } = {}) {
  const base = canon(name);
  // CLAMPED TO THE CODE CAP, never merely defaulted to it. A caller may ask for fewer forms and may not
  // ask for more: the ceiling is a spend guarantee (every form is a paid call on a billing provider),
  // and a ceiling a caller can raise is not one. Anything unusable — 0, negative, NaN, a string from a
  // typo'd env var — collapses to NO forms rather than to the default, because the safe direction for a
  // misconfigured bound is to buy nothing and report that nothing was counted.
  const limit = Number.isFinite(cap) && cap >= 1 ? Math.min(Math.floor(cap), VARIANT_CAP) : 0;
  // Insertion-ordered, so the cap truncates the tail of the RULE order and nothing else. A form two
  // rules produce is recorded once with both rule ids — the audit question is "why was this asked",
  // and the answer is every rule that reached it.
  const byForm = new Map();
  if (base) {
    for (const r of RULES) {
      let out;
      try { out = r.apply(base); } catch { out = null; }
      const form = canon(out);
      // The base itself is not a variation of the base — that is the `identical` predicate, already
      // counted, and re-asking it would double-bill one number and inflate the other.
      if (!form || form === base) continue;
      if (byForm.has(form)) byForm.get(form).push(r.id);
      else byForm.set(form, [r.id]);
    }
  }
  const all = [...byForm].map(([form, rules]) => ({ form, rules: Object.freeze(rules) }));
  return {
    base,
    forms: all.slice(0, limit),
    generated: all.length,
    truncated: all.length > limit,
  };
}
