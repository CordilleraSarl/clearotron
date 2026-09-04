// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// registration-scripts.mjs — WHICH SCRIPTS A MARK COULD PLAUSIBLY BE *REGISTERED* IN, per territory.
//
// REFERENCE DATA. This file is a table a person reads and corrects, and it is meant to be read that way:
// no derivation, no cleverness, one row per territory with the reason for the row beside it. If a row is
// wrong, the fix is to edit the row.
//
// THE DISTINCTION THAT MAKES IT USEFUL, and the one a flat `jurisdiction → scripts` list gets wrong:
// these are the scripts a mark is plausibly REGISTERED in, not every script a jurisdiction USES. Japan
// writes in kanji, hiragana, katakana and romaji, and a floor built from that list would demand four
// renderings of every mark — three of which no foreign applicant files and no examiner expects. What a
// foreign word mark actually holds in Japan is the Latin form and its katakana transliteration, because
// katakana is the script Japanese uses for foreign words and it is what the register indexes such a mark
// under. So Japan is two, not four.
//
// The same narrowing everywhere: a territory's row is the shortest list under which a real conflicting
// right could sit unfound. Where a territory registers foreign marks in Latin alone, the row is Latin
// alone — and most are.
//
// WHAT USES IT: the per-script arm of the variant-manifest completeness floor
// (variant-manifest-model.mjs). That floor VALIDATES, NEVER GENERATES — it refuses a manifest with no
// rendering for an in-scope script and the stage regenerates. Code must never invent a search term: the
// moment it does, judgment has moved into the funnel, and a fabricated transliteration is a search we
// cannot defend the provenance of.
//
// ONE RENDERING PER SCRIPT, NOT A COUNT. The floor asks whether the script is represented at all. How
// many renderings a script deserves, and which ones bite, is judgment's call downstream — the same
// division the category floor already draws.
//
// PURE. No IO, no config.

/**
 * Territory → the scripts a mark could plausibly hold a registration in there.
 *
 * Keys are canonical jurisdiction codes (jurisdiction-codes.mjs vocabulary). A territory that is not
 * listed is Latin-only, which is the honest default: adding a script to this table widens what every
 * run in that territory must state, so an unresearched row would cost real work on every matter.
 */
export const REGISTRABLE_SCRIPTS = Object.freeze({
  // ── Han-script markets. A foreign mark is commonly registered BOTH in Latin and in a Chinese
  // rendering (transliterated for sound, translated for meaning, or a coined pairing) — and the Chinese
  // rendering is the one local consumers use, so a conflict found only there is the one that bites.
  CN: ["latin", "han"],
  TW: ["latin", "han"],
  HK: ["latin", "han"],
  MO: ["latin", "han"],
  SG: ["latin", "han"],   // English and Chinese both official; marks routinely file in both

  // ── Japan: katakana, NOT the four writing systems. Katakana is the script Japanese uses for foreign
  // words, and it is what a foreign word mark is transliterated into on the register. Kanji and hiragana
  // renderings exist for marks that are Japanese words to begin with — a matter shaped that way earns a
  // row here by judgment, not by a table demanding it of every mark.
  JP: ["latin", "katakana"],

  // ── Korea: hangul, same reasoning as katakana.
  KR: ["latin", "hangul"],

  // ── Cyrillic markets. A Latin mark is routinely registered alongside its Cyrillic transliteration,
  // and the local trade uses the Cyrillic form.
  RU: ["latin", "cyrillic"],
  UA: ["latin", "cyrillic"],
  BY: ["latin", "cyrillic"],
  KZ: ["latin", "cyrillic"],
  RS: ["latin", "cyrillic"],
  BG: ["latin", "cyrillic"],

  // ── Arabic-script markets. The Arabic rendering is a separate registration in practice.
  SA: ["latin", "arabic"],
  AE: ["latin", "arabic"],
  EG: ["latin", "arabic"],
  QA: ["latin", "arabic"],
  KW: ["latin", "arabic"],
  BH: ["latin", "arabic"],
  OM: ["latin", "arabic"],
  JO: ["latin", "arabic"],
  IR: ["latin", "arabic"],   // Perso-Arabic script
  PK: ["latin", "arabic"],   // Urdu, Perso-Arabic script

  IL: ["latin", "hebrew"],
  GR: ["latin", "greek"],
  CY: ["latin", "greek"],
  TH: ["latin", "thai"],
  IN: ["latin", "devanagari"],   // Devanagari is the single most-registered Indic script; others are matter-specific
});

/** The Unicode script test for each name this table uses. One regex per script, nothing derived. */
const SCRIPT_TESTS = Object.freeze({
  latin: /\p{Script=Latin}/u,
  han: /\p{Script=Han}/u,
  // Katakana specifically — hiragana is a different answer and conflating them would let a hiragana
  // rendering satisfy a katakana requirement, which is the sort of near-miss a floor exists to catch.
  katakana: /\p{Script=Katakana}/u,
  hiragana: /\p{Script=Hiragana}/u,
  hangul: /\p{Script=Hangul}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  arabic: /\p{Script=Arabic}/u,
  hebrew: /\p{Script=Hebrew}/u,
  greek: /\p{Script=Greek}/u,
  thai: /\p{Script=Thai}/u,
  devanagari: /\p{Script=Devanagari}/u,
});

/** Is `value` written (at least partly) in `script`? Unknown script names answer false, never throw. */
export function isInScript(value, script) {
  const re = SCRIPT_TESTS[String(script ?? "").toLowerCase()];
  return re ? re.test(String(value ?? "")) : false;
}

/**
 * The scripts this matter's territories could hold registrations in, as `{script: [territories…]}` —
 * the territories ride along so a gap can name WHY a script is required, which is what makes the
 * refusal actionable rather than a rule the model has to take on faith.
 *
 * `latin` is deliberately excluded from the result: every manifest states its Latin family by
 * construction (the `core` category floor already requires it), so returning it would produce a
 * requirement that can never fail and noise in every gap list.
 */
export function requiredScriptsFor(jurisdictions) {
  const out = new Map();
  for (const j of (jurisdictions ?? [])) {
    const code = String(j ?? "").trim().toUpperCase();
    for (const s of (REGISTRABLE_SCRIPTS[code] ?? [])) {
      if (s === "latin") continue;
      if (!out.has(s)) out.set(s, []);
      if (!out.get(s).includes(code)) out.get(s).push(code);
    }
  }
  return Object.fromEntries([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
