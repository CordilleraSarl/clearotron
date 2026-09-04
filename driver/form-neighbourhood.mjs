// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// form-neighbourhood.mjs — the mechanical Layer A: a deterministic, MODEL-FREE definition of a mark's
// FORM neighbourhood. PURE (no node imports), offline-testable, zero deps (matches core.js style).
//
// WHY THIS EXISTS (the north star, made mechanical):
//   The form-variant set is the seed every register search grows from. Today it is IMAGINED by a model
//   ("reason like a lawyer, don't enumerate edits") — so it is unreproducible and full of holes nobody can
//   see (a live run generated one first-letter single-edit variant of the mark but MISSED another of the very
//   same class — think ZALENA imagined, MALENA not, for a mark VALENA). The vendor's own broad modes cannot
//   close the hole: live-verified 2026-06-26, Corsearch `phonetic` returns same-onset RESPELLINGS only and its
//   COMPLETE in-class phonetic band for that matter's mark (94 marks, has_more:false) EXCLUDED the missed
//   neighbour — which exists as 69 records. `fuzzy` is diacritic noise (2744/15744 hits). So the neighbourhood must be DERIVED
//   FROM THE MARK by a deterministic process; the model may only ADD (meaning/translit/famous-mark) and RANK,
//   never DEFINE, SHRINK, or FILTER. Acid test: ablate the model on the form axis and this set is identical.
//
// WHAT "MECHANICAL" MEANS (and does NOT): the set is a deterministic function of the mark, complete out to a
//   DISCLOSED, length-normalized radius — never "catches every variation" (at enough edit distance everything
//   is a variation). The radius is the one judgment, and it is derived from confusing-similarity doctrine
//   (what an examiner would cite), NOT calibrated to catch any known mark's neighbours.
//
// COMPOSES WITH: phonetic-key.mjs (Double-Metaphone — the sound-alike family the vendor's phoneme model
//   misses). Visual-confusable + transliteration live here as exported functions (cohesive, separately tested).
//
// CONNOTATION AXIS IS NOT HERE: meaning/slang/subcultural connotation is NOT mechanically enumerable (a
//   deterministic "check" there is a word-list in a lab coat). This module only emits the FORM near-forms; the
//   connotation screen consumes them (in the live incident the slang label sat one letter off the benign-
//   given-name mark — the screen must search that near-form too, not just the mark) but reasons separately.

import { doubleMetaphone, phoneticKey } from "./phonetic-key.mjs";
import { dominantElementFromManifest, formativeRootFromManifest } from "./scope-ledger.mjs";
// The ONE script-preserving fold the plan compiler's romanisation lookup and the manifest floor's
// mark-restatement check already share (providers/_shared/script-form.mjs — itself PURE, no node
// imports, so this module stays offline-testable). The floor/model merge below keys on it for the
// same reason those two do: a private second fold is how two definitions of "the same term" drift.
import { formKey } from "../providers/_shared/script-form.mjs";

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const AZ = LOWER.split("");
const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

// Normalize a distinctive element to its mechanical seed: lowercase, fold diacritics, keep only letters.
// (Folding is the FIRST confusable equivalence — "süßen" → "sussen" style is handled in transliterate; here
// we keep the Latin skeleton the edit/phonetic functions operate on.)
export function normalizeElement(s) {
  return foldDiacritics(String(s ?? "")).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Decision 1: the radius — doctrine-derived, length-normalized, DISCLOSED ──────────────────────────
// edit-1 is ALWAYS in scope (a single substitution/insertion/deletion/transposition is the canonical
// examiner-cited confusable). edit-2 is NOT brute-enumerated: it is intractable (tens of thousands of
// strings) AND redundant — the legally-relevant edit-2 region is the phonetic VOWEL family (VALENA→VYLONA/
// VILINA), which the phonetic key + consonant skeleton retrieve in one bounded query. So the radius is:
//   edit-1 (exhaustive)  ∪  phonetic-skeleton family  ∪  visual-confusables  ∪  transliterations.
// `crowdRisk` is disclosure, not a cutoff: a short mark's edit-1 is dense (a saturation crowd the count-first
// register flow narrows); a long mark's is sparse. Length-normalized by construction (edit-1 scales with length).
export function radiusFor(element) {
  const el = normalizeElement(element);
  const L = el.length;
  // doctrine note, surfaced in the disclosed ledger so the cutoff is never silent.
  const crowdRisk = L <= 4 ? "high" : L <= 6 ? "moderate" : "low";
  return {
    element: el,
    length: L,
    editRadius: 1,                 // exhaustive edit-1; edit-2 covered by the phonetic family, not brute force
    includePhoneticFamily: true,
    includeConfusables: true,
    crowdRisk,
    note: `edit-1 exhaustive + phonetic-skeleton family + visual-confusables + transliterations; edit-2 NOT brute-enumerated (intractable + redundant with the phonetic family). crowd-risk=${crowdRisk} (len ${L}) — short marks rely on the register count-first flow to narrow, never to drop.`,
  };
}

// ── Edit-1 (Damerau-Levenshtein) neighbourhood — deletions, transpositions, substitutions, insertions ──
// Deterministic, sorted, deduped, the original removed. This is the class the vendor cannot produce and the
// class the original miss (MALENA for VALENA) lived in. ~53·L+25 candidates for a length-L alpha element.
export function editNeighbourhood(element) {
  const w = normalizeElement(element);
  const out = new Set();
  for (let i = 0; i < w.length; i++) out.add(w.slice(0, i) + w.slice(i + 1));                       // deletions
  for (let i = 0; i < w.length - 1; i++) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2)); // transpositions
  for (let i = 0; i < w.length; i++) for (const c of AZ) if (c !== w[i]) out.add(w.slice(0, i) + c + w.slice(i + 1)); // substitutions
  for (let i = 0; i <= w.length; i++) for (const c of AZ) out.add(w.slice(0, i) + c + w.slice(i));   // insertions
  out.delete(w);
  return [...out].sort();
}

// ── Consonant skeleton + wildcard patterns — retrieve the phonetic VOWEL family in one bounded vendor query ──
// VALENA → consonants V,L,N → skeleton "VLN"; vowel-slot wildcard "V?L?N?"-style patterns the vendor's Lucene
// `?`/`*` supports (live-confirmed). This is the tractable, complete way to reach VYLONA/VILINA/VILENA without
// brute edit-2. Deterministic; derived purely from the string.
export function consonantSkeleton(element) {
  const w = normalizeElement(element);
  let sk = "";
  for (const ch of w) if (!VOWELS.has(ch)) sk += ch;
  // collapse immediate doublings (NN→N) — registries rarely distinguish them and it widens the net.
  return sk.replace(/(.)\1+/g, "$1");
}

// Wildcard retrieval patterns for the structural family. `?` = exactly one char (vendor Lucene). We emit the
// vowel-slot skeleton (each consonant kept, each vowel run → a single `?`), plus suffix/prefix anchors so the
// family is retrievable even when the vendor caps wildcard breadth. DISTINCT from edit-1 (which is dispatched
// as exact OR-stacked names).
export function skeletonPatterns(element) {
  const w = normalizeElement(element);
  if (!w) return [];
  // vowel-run → single '?'; keep consonants verbatim.
  let pat = "";
  let i = 0;
  while (i < w.length) {
    if (VOWELS.has(w[i])) { pat += "?"; while (i < w.length && VOWELS.has(w[i])) i++; }
    else { pat += w[i]; i++; }
  }
  const out = new Set([pat]);
  // also leading/trailing-anchored substrings of the skeleton, so a long mark's family is reachable in pieces.
  const sk = consonantSkeleton(w);
  if (sk.length >= 2) { out.add(`${sk[0]}*${sk[sk.length - 1]}`); }
  return [...out];
}

// ── Visual confusables (Unicode-confusable axis) — look-alikes an examiner/consumer would conflate ──────
// A principled homoglyph map (subset of the Unicode confusables data) for the Latin axis: digit/letter
// look-alikes, multigraph look-alikes (rn↔m, vv↔w, cl↔d), and a `confusableSkeleton` that folds a string to a
// canonical form so two marks that LOOK identical normalize equal. Generates a bounded set of look-alike
// spellings to search. NOT a per-case word-list — it is a fixed glyph table applied to any string.
const HOMOGLYPH_SUB = {
  o: ["0"], "0": ["o"], l: ["1", "i"], i: ["1", "l"], "1": ["l", "i"],
  s: ["5", "z"], z: ["s"], b: ["8"], a: ["@"], e: ["3"], g: ["9", "q"],
  t: ["7"], u: ["v"], v: ["u"], c: ["k"], k: ["c"], f: ["ph"], y: ["i"],
};
const MULTIGRAPH = [["m", "rn"], ["w", "vv"], ["d", "cl"], ["m", "nn"]];

// Fold a string to its visual skeleton (canonical look-alike form): diacritics stripped, common homoglyph
// classes collapsed to one representative. Two marks colliding here look the same to the eye.
export function confusableSkeleton(s) {
  let w = foldDiacritics(String(s ?? "")).toLowerCase();
  w = w.replace(/0/g, "o").replace(/[1!|]/g, "l").replace(/5/g, "s").replace(/8/g, "b").replace(/3/g, "e").replace(/@/g, "a").replace(/7/g, "t");
  w = w.replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d");
  return w.replace(/[^a-z0-9]/g, "");
}

// Generate bounded look-alike spellings (each single homoglyph swap + each multigraph swap). Deterministic.
export function visualConfusables(element, { max = 60 } = {}) {
  const w = normalizeElement(element);
  const out = new Set();
  for (let i = 0; i < w.length; i++) {
    const subs = HOMOGLYPH_SUB[w[i]];
    if (subs) for (const r of subs) out.add(w.slice(0, i) + r + w.slice(i + 1));
  }
  for (const [a, b] of MULTIGRAPH) {
    if (w.includes(a)) out.add(w.replaceAll(a, b));
    if (w.includes(b)) out.add(w.replaceAll(b, a));
  }
  out.delete(w);
  return [...out].sort().slice(0, max);
}

// ── Transliteration (cross-script axis), SCOPED to market-relevant scripts (named limit) ─────────────────
// For the Latin-script markets (CH/EU/US/UK) the dominant transliteration axis is diacritic variation
// (folding both directions) + the German/Nordic special-letter conventions (ß→ss, ä→ae/a, ø→o). Cross-script
// (Cyrillic/Greek homoglyph romanization) is included for worldwide scope via a fixed look-alike table.
// SUPPORTED_SCRIPTS is explicit so the boundary is disclosed, never pretended-complete.
export const SUPPORTED_SCRIPTS = ["latin-diacritic", "german", "nordic", "cyrillic-homoglyph", "greek-homoglyph"];

const DIACRITIC_MAP = { a: ["á", "à", "â", "ä", "ã", "å"], e: ["é", "è", "ê", "ë"], i: ["í", "ì", "î", "ï"], o: ["ó", "ò", "ô", "ö", "õ", "ø"], u: ["ú", "ù", "û", "ü"], n: ["ñ"], c: ["ç"], s: ["š", "ß"], y: ["ý", "ÿ"], z: ["ž"] };
const CYRILLIC_LOOKALIKE = { a: "а", e: "е", o: "о", p: "р", c: "с", y: "у", x: "х", k: "к", m: "м", t: "т", h: "н", b: "в" };
const GREEK_LOOKALIKE = { a: "α", b: "β", e: "ε", i: "ι", o: "ο", p: "ρ", t: "τ", x: "χ", y: "υ", n: "η", k: "κ", m: "μ" };

export function foldDiacritics(s) {
  // NFD decompose then strip combining marks; plus the non-decomposable special letters.
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/Ø/g, "O").replace(/ø/g, "o").replace(/Æ/g, "AE").replace(/æ/g, "ae").replace(/Œ/g, "OE").replace(/œ/g, "oe").replace(/Ð/g, "D").replace(/ð/g, "d").replace(/Þ/g, "TH").replace(/þ/g, "th").replace(/ł/g, "l").replace(/Ł/g, "L");
}

export function transliterations(element, { scripts = SUPPORTED_SCRIPTS } = {}) {
  const w = normalizeElement(element);
  const out = new Set();
  const want = new Set(scripts);
  // German/Nordic conventional respellings (ae/oe/ue ↔ a/o/u, ss)
  if (want.has("german") || want.has("nordic")) {
    out.add(w.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u"));
    out.add(w.replace(/a/g, "ae").replace(/o/g, "oe").replace(/u/g, "ue"));
    out.add(w.replace(/ss/g, "s"));
  }
  // diacritic variants: a bounded "first occurrence of each base vowel → each accented form" set.
  if (want.has("latin-diacritic")) {
    for (const [base, accents] of Object.entries(DIACRITIC_MAP)) {
      const idx = w.indexOf(base);
      if (idx >= 0) for (const acc of accents) out.add(w.slice(0, idx) + acc + w.slice(idx + 1));
    }
  }
  // whole-word cross-script homoglyph romanization (every mappable letter swapped) — one string per script.
  if (want.has("cyrillic-homoglyph")) { const t = [...w].map((c) => CYRILLIC_LOOKALIKE[c] ?? c).join(""); if (t !== w) out.add(t); }
  if (want.has("greek-homoglyph"))    { const t = [...w].map((c) => GREEK_LOOKALIKE[c] ?? c).join("");    if (t !== w) out.add(t); }
  out.delete(w);
  return [...out].filter(Boolean).sort();
}

// ── Orchestration: the complete machine-defined FORM band for a distinctive element ─────────────────────
// Returns the authoritative band spec + a DISCLOSED ledger. `exactQueries` are OR-stackable name searches
// (edit-1 ∪ confusables ∪ transliterations); `wildcardPatterns` retrieve the phonetic family; `phoneticKeys`
// are used downstream to VERIFY which returned marks are true sound-alikes. The model adds rows to `modelAdds`
// elsewhere; it can never remove from here.
// `droppedAxes` are the form families judgment dropped for THIS matter (scope-ledger.mjs
// droppedVariantFamilies). The floor stays exhaustive WITHIN the families judgment kept — this is the funnel
// honouring a scope decision that was already written and, until 2026-07-18, ignored. edit-1 is never
// droppable: it is the doctrine floor (radiusFor), not a family.
export function formNeighbourhood(element, { markets = [], scripts = SUPPORTED_SCRIPTS, droppedAxes = [] } = {}) {
  const radius = radiusFor(element);
  const el = radius.element;
  if (!el) return { element: "", radius, exactQueries: [], wildcardPatterns: [], phoneticKeys: [], confusables: [], transliterations: [], ledger: { disclosed: radius.note, axes: [] } };

  const drop = new Set(droppedAxes ?? []);
  const edits = editNeighbourhood(el);
  const confs = drop.has("visual-confusable") ? [] : visualConfusables(el);
  const trans = drop.has("transliteration") ? [] : transliterations(el, { scripts });
  const wildcards = drop.has("phonetic-family") ? [] : skeletonPatterns(el);
  const keys = drop.has("phonetic-family") ? [] : doubleMetaphone(el).filter(Boolean);

  // exactQueries = the strings dispatched as OR-stacked exact/near name searches (deduped, original excluded).
  //
  // Deduped ON THE DIACRITIC FOLD, not the raw string. The registers fold diacritics, so `paradisè`,
  // `paradisé`, `paradisê`, `paradisë` and `paradiše` are ONE query, not five — and one already covered by the
  // element itself. Drivers Haven 2026-07-17 dispatched exactly those five as distinct terms; each returned
  // the same 424 hits, together they exhausted the run's record budget, all five stayed `unenumerated`, and
  // `coverage_clean_unverified_incomplete:primary-sweep` then blocked delivery six times on a gate that could
  // never clear. This is the same equivalence coverageGaps() already compares on, applied at generation.
  // ß→ss and the Cyrillic/Greek homoglyph forms survive: foldDiacritics leaves them genuinely distinct.
  const exactQueries = dedupeOnFold([...edits, ...confs, ...trans], el);

  return {
    element: el,
    markets,
    radius,
    exactQueries,
    wildcardPatterns: wildcards,
    phoneticKeys: keys,
    confusables: confs,
    transliterations: trans,
    ledger: {
      disclosed: radius.note,
      dropped_axes: [...drop].sort(),
      axes: [
        { axis: "edit-1", count: edits.length, mechanism: "Damerau-Levenshtein edit-1, exhaustive" },
        { axis: "phonetic-family", count: wildcards.length, mechanism: drop.has("phonetic-family") ? "DROPPED — judgment's variant-layer scope decision" : `consonant-skeleton wildcard + Double-Metaphone key(s) [${keys.join(",")}]` },
        { axis: "visual-confusable", count: confs.length, mechanism: drop.has("visual-confusable") ? "DROPPED — judgment's variant-layer scope decision" : "Unicode-confusable homoglyph + multigraph table" },
        { axis: "transliteration", count: trans.length, mechanism: drop.has("transliteration") ? "DROPPED — judgment's variant-layer scope decision" : `scoped scripts: ${scripts.join(", ")}` },
      ],
      total_exact: exactQueries.length,
    },
  };
}

// Collapse terms that are the SAME query once the register folds diacritics, and drop any that fold onto the
// element itself. Keeps the first form in sort order so output stays deterministic. PURE.
export function dedupeOnFold(terms, element) {
  const fold = (s) => foldDiacritics(String(s ?? "")).toLowerCase();
  const seen = new Set([fold(element)]);
  const out = [];
  for (const t of [...new Set(terms)].sort()) {
    const f = fold(t);
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(t);
  }
  return out;
}

// ── The coverage ORACLE (completeness, NEVER sufficiency) ───────────────────────────────────────────────
// Compares the machine-defined form band against what the register funnel actually DISPATCHED. A generated
// near-form that was never dispatched (and not explicitly explained) is a COMPLETENESS gap — this is a check
// that the machine searched its own deterministic set, NOT a judgment about whether the RESULTS were enough
// (that stays with synthesis/Layer B). Names are compared on the normalized seed so casing/diacritics don't
// cause false gaps. `explained` carries forms the funnel legitimately could not dispatch (e.g. a wildcard the
// provider rejected) with the reopen trigger — an explained absence is not a gap, mirroring the scope-ledger.
export function coverageGaps(band, { dispatched = [], explained = [] } = {}) {
  const norm = (s) => normalizeElement(s);
  const have = new Set(dispatched.map(norm));
  const excused = new Set(explained.map((e) => norm(e?.form ?? e)));
  const gaps = [];
  for (const q of band?.exactQueries ?? []) {
    const n = norm(q);
    if (!have.has(n) && !excused.has(n)) gaps.push(q);
  }
  // the wildcard family + at least one phonetic key must also have been dispatched (the vowel family is not
  // reachable via exact OR-stacking) — a missing structural-family dispatch is a gap of its own.
  const familyDispatched = (band?.wildcardPatterns ?? []).some((p) => have.has(norm(p)))
    || (band?.phoneticKeys ?? []).some((k) => have.has(norm(k)))
    || dispatched.some((d) => /[?*]/.test(String(d)));
  return {
    complete: gaps.length === 0 && (band?.wildcardPatterns?.length ? familyDispatched : true),
    missingExact: gaps,
    phoneticFamilyDispatched: familyDispatched,
  };
}

// ── Driver glue: CODE-DERIVE the machine form band FROM the manifest's distinctive element(s) ────────────
// Mirrors scope-ledger.mjs renderScopeLedgerJson: the model identifies WHICH token is distinctive (judgment
// — "VELTRIS" out of "BIO VELTRIS"); the MACHINE generates that token's complete form neighbourhood
// (mechanical). The driver writes the result to form-neighbourhood.json; the register funnel searches it as
// the authoritative form floor. PURE. Throws `form_neighbourhood_no_element` when no distinctive element can
// be read (caller never-kills → the run degrades to the model's manifest variants, never worse than today).
// `model` is the VALIDATED variant-manifest.json (variant-manifest-model.mjs). When supplied it is
// AUTHORITATIVE for the dominant element and the prose is used only for the formative root — because the prose
// parse is unsafe. `dominantElementFromManifest` captures to the first `.`/`;`/`(`/newline, so a manifest that
// writes "Dominant element: HYDRA — the stem a family of marks shares" yields the whole clause, which
// normalizeElement then compacts to `hydrathestemafamilyofmarksshares`. That pseudo-element got a full
// exhaustive edit-1 neighbourhood: 1,736 junk exact queries on AquaPlus 2026-07-17, 4,524 on the 07-16 run.
// Measured 2026-07-18: 10 of 20 recent runs carried one of these. The JSON field is a validated scalar and
// cannot swallow a sentence.
export function renderFormNeighbourhoodJson(manifestMd, { markets = [], scripts = SUPPORTED_SCRIPTS, droppedAxes = [], model = null, mark = "" } = {}) {
  const { seeds, seededFrom, rejected } = floorSeeds(manifestMd, { model, mark });
  // The reason travels WITH the throw. It used to say only "the job states no mark", which is one
  // of two causes and not the one that actually fires: a non-Latin mark states a mark perfectly well and
  // still seeds nothing. deriveFormNeighbourhood truncates e.message into its runLog line, so whatever is
  // not in this string is not anywhere — `rejected` is discarded with the exception on exactly the path it
  // was written for.
  if (!seeds.length) {
    const why = rejected.map((r) => `${r.role}: ${r.reason}`).join("; ")
      || "manifest names no Dominant element / Formative root, and the job states no mark";
    throw new Error(`form_neighbourhood_no_element: ${why} — nothing to seed the mechanical form band`);
  }
  const elements = seeds.map(({ element, role }) => ({ element, role, band: formNeighbourhood(element, { markets, scripts, droppedAxes }) }));
  const families = variantFloorFamilies(elements, { mark, droppedAxes });
  return JSON.stringify({
    schema_version: 2,
    generated: "deterministic (model-free) — edit-1 ∪ phonetic-family ∪ visual-confusable ∪ transliteration ∪ spacing-punctuation",
    markets,
    seeded_from: seededFrom,
    dropped_axes: [...(droppedAxes ?? [])].sort(),
    disclosed_radius: elements[0]?.band?.radius?.note ?? "",
    elements,
    // — the MARKED union. `families.terms` IS the floor, partitioned by the generator that
    // produced each term; `model_additions` are the terms only the model imagined; `model_restatements`
    // are the terms it imagined that the floor had already enumerated. Every term the funnel will search
    // sits in exactly one of the three, which is what makes "floor or addition" a readable property of
    // the artifact rather than a claim in a prompt.
    variant_floor: mergeVariantFloor(families, model?.variants, { rejectedSeeds: rejected }),
  });
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// THE VARIANT FLOOR — the mechanical core of variant GENERATION, not only of the form band
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// WHAT WAS ALREADY TRUE before this section existed, stated because most of it was already right:
// editNeighbourhood, consonantSkeleton/skeletonPatterns, doubleMetaphone, visualConfusables and
// transliterations are ALL pure functions of their seed string — same seed in, byte-identical terms
// out, no model in the loop — and compileRegisterPlan dispatches those terms directly from the
// code-written band. The model has no channel through which to delete one, and never had.
//
// WHAT WAS NOT TRUE, and is what this section fixes:
//
//   1. THE SEED WAS A LOTTERY. The floor was generated for exactly ONE model-chosen token
//      (`dominant_element`) plus a formative root parsed out of the prose manifest. A deterministic
//      function of an unstable input is an unstable output: a model that promotes a different token
//      between two runs of the same matter moves the entire floor with it. The seed set is now the
//      UNION of every distinctive element the manifest names, in SORTED order, so neither which token
//      the model calls dominant nor the order it lists them in moves the artifact.
//
//   2. THE FLOOR COULD SILENTLY BE EMPTY — the zero-semantics defect in its purest form.
//      renderFormNeighbourhoodJson threw `form_neighbourhood_no_element` when it could read no
//      element; deriveFormNeighbourhood caught that, wrote no artifact, and compileRegisterPlan's
//      `bandFor(null)` then compiled ZERO floor entries with nothing anywhere reporting it. A model
//      turn that returned nothing produced a manifest with no floor under it. The seed set now falls
//      back to the JOB'S OWN MARK — run input, not model output — split per token, so an empty floor
//      needs a run with no mark, which the intake schema cannot produce.
//
//   3. NOTHING SAID WHICH TERMS WERE WHICH. The plan marked the floor with a `+form` suffix inside a
//      qid string and the wildcard fringe not at all; the manifest marked nothing. mergeVariantFloor
//      partitions the searched vocabulary into floor / model-restatement / model-addition, and
//      compileRegisterPlan stamps the same distinction on every entry as a real field.
//
//   4. THE `core` FAMILY HAD NO GENERATOR. VARIANT_CATEGORY_FLOOR (variant-manifest-model.mjs) makes
//      the model STATE a core variant and fails the stage without one, but nothing generated the
//      mark's own spacing/punctuation restatements — which are as mechanical as edit-1 and were left
//      entirely to whatever the model happened to think of. spacingPunctuationForms enumerates them.
//
// WHAT IS DELIBERATELY STILL MODEL-ONLY: meaning, connotation and non-rule-based script renderings
// (Han/Katakana/Hangul). A deterministic generator for those is a curated word list wearing a lab
// coat — the same objection this file's own header raises against a connotation "check", and the same
// line variantCompletenessGaps' per-script floor draws when it says it VALIDATES, NEVER GENERATES.

// A seed longer than this is a prose-parse artifact, not an element. The measured shape is the
// swallowed clause — "hydrathestemafamilyofmarksshares", 32-36 characters against a 5-char element —
// which took a full exhaustive edit-1 neighbourhood and put 1,736 junk exact queries on the wire
// (AquaPlus 2026-07-17). isStemOfNamedElement already rejects that shape for the formative root by
// measuring it against the named elements; this is the same measure for a seed with nothing to
// measure against, and it is deliberately loose — no real single-token mark element is 25 characters.
export const MAX_SEED_LENGTH = 24;

/**
 * The job's mark as TEXT, whatever shape the caller holds it.
 *
 * `ctx.job.marks` is an ARRAY OF OBJECTS — `{name, classes, ref}`, built that way by enqueue.mjs and by
 * ops.mjs startRun. The old `String(m)` over that array produced the literal string "[object Object]",
 * which tokenised to `["object"]`: the floor was then generated for the word OBJECT, and the run logged
 * that its seed was the job's own mark rather than the model's. A wrong floor that reports itself as the
 * trustworthy one, on every run that reaches the fallback — Latin script included, no model failure
 * required. The unit tests never saw it because they pass strings.
 *
 * stages.mjs resolves the same field with JSON.stringify, which keeps the names; this keeps them and
 * nothing else.
 */
export function markText(mark) {
  const one = (m) => {
    if (m == null) return "";
    if (typeof m === "string") return m;
    if (typeof m === "object") return String(m.name ?? m.mark ?? m.markName ?? "");
    return String(m);
  };
  return (Array.isArray(mark) ? mark.map(one) : [one(mark)]).map((s) => s.trim()).filter(Boolean).join(" ");
}

/**
 * The floor's SEED SET: every element the floor is generated for, deterministic in both membership
 * and order. Returns `{ seeds:[{element, role}], seededFrom, rejected:[{value, reason}] }`.
 *
 * Order of preference, and why each arm exists:
 *   `dominant`            — the model's named anchor, from the VALIDATED json sibling when present
 *                           (a validated scalar cannot swallow a sentence) and the prose manifest
 *                           otherwise, where it can, so the prose arm is length-guarded.
 *   `formative-root`      — the stem that WIDENS the net (VELTRI for VELTRIS), guarded exactly as
 *                           before by isStemOfNamedElement.
 *   `distinctive-element` — every OTHER element the manifest calls distinctive, SORTED. This is the
 *                           arm that takes the churn out: the model can reorder elements[] or promote
 *                           a different member to dominant_element and the seed set is unchanged.
 *   `mark-token`          — ONLY when no model-named element survived: the job's own mark, split on
 *                           every separator and seeded per TOKEN, never as the concatenation. The
 *                           concatenation is the same bad-seed shape as the swallowed clause
 *                           ("BIO VELTRIS" → "bioveltris", an 11-char pseudo-element with a 600-term
 *                           neighbourhood nobody asked for); the tokens are real elements.
 *
 * Rejected seeds are RETURNED, never dropped in silence — an absence is a finding, and a seed the
 * floor refused is recorded in the artifact where a reader can see what was not enumerated. PURE.
 */
export function floorSeeds(manifestMd, { model = null, mark = "" } = {}) {
  const seeds = [];
  const rejected = [];
  const seen = new Set();
  const guard = (value) => {
    const n = normalizeElement(value);
    if (!n) return "empty after normalization";
    if (n.length < 2) return `${n.length} character(s) — too short to enumerate a neighbourhood for`;
    if (n.length > MAX_SEED_LENGTH) return `${n.length} characters exceeds the ${MAX_SEED_LENGTH}-character seed bound (a prose-parse artifact, not an element)`;
    return "";
  };
  const add = (value, role, { guarded = true } = {}) => {
    const n = normalizeElement(value);
    if (!n || seen.has(n)) return false;
    if (guarded) {
      const why = guard(value);
      if (why) { rejected.push({ value: String(value).slice(0, 60), role, reason: why }); return false; }
    }
    seen.add(n);
    seeds.push({ element: n, role });
    return true;
  };

  const fromModel = String(model?.dominant_element ?? "").trim();
  const dom = fromModel || dominantElementFromManifest(manifestMd);
  // the validated sibling is a scalar the parser already policed — trusted as it always was. The PROSE
  // fallback is the arm that produced the swallowed clause, so only that one is length-guarded.
  if (dom) add(dom, "dominant", { guarded: !fromModel });
  const root = formativeRootFromManifest(manifestMd);
  if (root && normalizeElement(root) && normalizeElement(root) !== normalizeElement(dom)
      && isStemOfNamedElement(root, dom, model)) add(root, "formative-root");
  // SORTED, so the model's array order can never move the artifact.
  const distinctive = [...new Set((Array.isArray(model?.elements) ? model.elements : [])
    .filter((e) => String(e?.kind ?? "").trim().toLowerCase() === "distinctive")
    .map((e) => String(e?.value ?? "").trim()).filter(Boolean))].sort();
  for (const v of distinctive) add(v, "distinctive-element");

  if (seeds.length) {
    return { seeds, seededFrom: fromModel ? "variant-manifest.json (validated)" : "variant-manifest.md (prose fallback)", rejected };
  }
  // ZERO SEMANTICS: the model said nothing usable. The mark is run INPUT and cannot be lost with it.
  for (const tok of markSeedTokens(mark)) add(tok, "mark-token");
  // AN ABSENCE IS A FINDING. Both arms fail TOGETHER on a non-Latin mark — normalizeElement keeps
  // only [a-z0-9], so a Han/Kana/Hangul/Cyrillic/Greek/Arabic/Thai dominant_element from the manifest
  // normalises to "" and is dropped by `add` before the guard ever runs, and the mark fallback tokenises
  // to nothing for the same reason. The fallback cannot rescue the case it exists for, and the whole
  // failure used to leave no trace but a single form-neighbourhood-skipped line.
  //
  // It is NOT fixed by romanising. variantCompletenessGaps' per-script floor validates and never
  // generates, on the stated principle that the moment code mints a search term, judgment has moved into
  // the funnel — and that was 's own reason for excluding non-rule-based transliteration. A
  // romanisation is a minted term. So the deterministic floor genuinely does not exist for this mark, and
  // the honest move is to say which mark, and why, where a reader will see it.
  if (!seeds.length) {
    const text = markText(mark);
    const latin = foldDiacritics(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    rejected.push({
      value: text.slice(0, 60), role: "mark-token",
      reason: !text
        ? "the job states no mark, so there is nothing to seed the mechanical form band from"
        : !latin
          ? "no Latin-script token: the mechanical form floor is derived on [a-z0-9] and cannot be generated for this script without romanising, which would mint a search term"
          : `every token is a single character (${latin}) — an edit-1 neighbourhood of one character is the whole alphabet, which is noise rather than coverage`,
    });
  }
  return {
    seeds,
    seededFrom: seeds.length ? "job mark (FALLBACK — the manifest named no usable element)" : "",
    rejected,
  };
}

// The job's mark, reduced to seedable tokens: deduped, SORTED (order in the artifact is fixed by the
// sort, never by however the intake happened to list multiple marks), length-guarded exactly as every
// other seed is. Accepts the string, or the array `job.marks` carries. PURE.
export function markSeedTokens(mark) {
  const raw = markText(mark);
  const toks = foldDiacritics(raw).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // The length-2 floor STAYS, and asked whether it should. It should: an edit-1 neighbourhood of a
  // one-character seed is every character in the alphabet, which is noise rather than coverage — the same
  // reason MIN_SKELETON exists in reference-score.mjs. What was wrong is not the floor but its silence.
  // A one-character mark has no mechanical form floor, and floorSeeds now says so where a reader can see
  // it rather than leaving the run with an empty band and one skipped log line.
  return [...new Set(toks)].sort().filter((t) => t.length >= 2 && t.length <= MAX_SEED_LENGTH);
}

/**
 * The `core` family, generated rather than imagined: the mark's own spacing/punctuation restatements.
 * "CORAL FREEZE" → coralfreeze / coral-freeze / coral.freeze; "E-TRADE" → etrade / e trade / e.trade. A
 * single-token mark with no separator has none, and gets [] — the floor never fabricates a form the
 * mark cannot have (the same reason VARIANT_CATEGORY_FLOOR leaves out the context-dependent
 * categories: a floor that demands what a mark cannot have teaches the model to invent rows).
 *
 * Deterministic and exhaustive over the mark's separator positions. The mark's own written form is
 * excluded — it is already the plan's exact entry, not a variant of itself. PURE.
 */
export function spacingPunctuationForms(mark) {
  const raw = Array.isArray(mark) ? mark.map((m) => String(m ?? "")).join(" ") : String(mark ?? "");
  const folded = foldDiacritics(raw).toLowerCase().trim();
  if (!folded) return [];
  const tokens = folded.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length < 2) return [];
  const out = new Set([tokens.join(""), tokens.join(" "), tokens.join("-"), tokens.join(".")]);
  out.delete(folded);
  out.delete(folded.replace(/\s+/g, " "));
  return [...out].filter(Boolean).sort();
}

/**
 * The floor, PARTITIONED BY GENERATOR. Each row names the family, the exported function that produced
 * it, and whether that function is exhaustive or bounded — because "deterministic" and "complete" are
 * different claims and the artifact must not let a reader confuse them. Returns rows in a fixed order
 * with sorted terms, so the block is byte-stable for a given seed set.
 *
 * The partition is over the band's OWN exactQueries (the fold-deduped set the plan actually
 * dispatches), assigned to the first family that claims each term — so the family terms sum EXACTLY
 * to what gets searched, never to a parallel list that drifts from it. PURE.
 */
export function variantFloorFamilies(elements, { mark = "", droppedAxes = [] } = {}) {
  const drop = new Set(droppedAxes ?? []);
  const edit = new Set(), visual = new Set(), translit = new Set(), other = new Set();
  const wildcards = new Set(), keys = new Set();
  for (const el of elements ?? []) {
    const band = el?.band;
    if (!band) continue;
    const edits = new Set(editNeighbourhood(el.element));
    const confs = new Set(band.confusables ?? []);
    const trans = new Set(band.transliterations ?? []);
    for (const q of band.exactQueries ?? []) {
      if (edits.has(q)) edit.add(q);
      else if (confs.has(q)) visual.add(q);
      else if (trans.has(q)) translit.add(q);
      else other.add(q);
    }
    for (const w of band.wildcardPatterns ?? []) wildcards.add(w);
    for (const k of band.phoneticKeys ?? []) keys.add(k);
  }
  const sorted = (s) => [...s].sort();
  return [
    { family: "edit-1", category: "phonetic", generator: "editNeighbourhood",
      enumeration: "EXHAUSTIVE — every Damerau-Levenshtein edit-1 (deletion, transposition, substitution, insertion) over [a-z]",
      dropped: false, terms: sorted(edit) },
    { family: "spacing-punctuation", category: "core", generator: "spacingPunctuationForms",
      enumeration: "EXHAUSTIVE over the mark's separator positions; empty for a single-token mark",
      // MEASURED, not assumed (2026-08-03): the register compiler's `norm` and the shared `formKey`
      // both strip separators, so every member of this family keys IDENTICALLY to the mark and is
      // already searched as the mark's own exact entry — which is why compileRegisterPlan does not
      // re-dispatch them, and why doing so would be the PARADISE shape (five spellings, one result
      // set, the run's record budget spent). Enumerated here because the family is genuinely
      // mechanical and the surfaces that do NOT fold spacing — the common-law grid, the connotation
      // sweep — are real; those consumers are NOT wired to it by this change.
      dispatch: "covered by the mark's own register entry (norm/formKey fold separators); not re-dispatched",
      dropped: false, terms: spacingPunctuationForms(mark) },
    { family: "visual-confusable", category: "visual", generator: "visualConfusables",
      enumeration: "BOUNDED — a fixed homoglyph + multigraph table, capped at the first 60 in sort order",
      dropped: drop.has("visual-confusable"), terms: sorted(visual) },
    { family: "transliteration", category: "transliteration", generator: "transliterations",
      enumeration: `BOUNDED — RULE-BASED scripts only (${SUPPORTED_SCRIPTS.join(", ")}); the diacritic arm varies the FIRST occurrence of each base vowel. Han/Katakana/Hangul renderings are model-only by design`,
      dropped: drop.has("transliteration"), terms: sorted(translit) },
    { family: "phonetic-family", category: "phonetic", generator: "skeletonPatterns + doubleMetaphone",
      enumeration: "BOUNDED — retrieval PATTERNS and keys, not a term list: the consonant-skeleton wildcard reaches the vowel family (edit-2 region) in one query instead of brute-enumerating it",
      dropped: drop.has("phonetic-family"), terms: sorted(wildcards), phonetic_keys: sorted(keys) },
    ...(other.size ? [{ family: "other", category: "other", generator: "formNeighbourhood (dedupeOnFold residue)",
      enumeration: "a dispatched term no single generator claims — recorded rather than hidden", dropped: false, terms: sorted(other) }] : []),
  ];
}

/**
 * ── THE NO-REMOVAL MERGE POINT ──────────────────────────────────────────────────────────────────
 *
 * Join the model's variants to the deterministic floor and return the MARKED union:
 *   `floor_families`      — the floor, by generator (variantFloorFamilies), in full and always
 *   `model_restatements`  — model variants the floor had already enumerated
 *   `model_additions`     — model variants the floor cannot reach (meaning, non-rule-based script,
 *                           an incumbent's actual mark) — the model's real contribution
 *   `counts`              — floor / restated / added / union
 *
 * THE GUARANTEE IS THE CONTROL FLOW, NOT A RULE APPLIED AFTERWARDS. The floor is built FIRST, from
 * code, and the model's variants are only ever consulted to decide which BUCKET each of them lands
 * in. There is no branch on which a model variant subtracts from `floor_families`, and no argument
 * this function accepts that could ask it to — so "the model cannot remove a floor term" is a
 * property of the shape of the function, not an instruction anyone has to keep obeying. A prompt
 * asking a model not to remove terms is not a floor; this is.
 *
 * MALFORMED OR ABSENT MODEL OUTPUT IS NOT A SPECIAL CASE. `modelVariants` of null, [], a string, or a
 * list of shapeless objects all take the same path: zero restatements, zero additions, and the floor
 * emitted in full. The failure that shrinks the manifest to nothing therefore cannot exist here —
 * there is no code path on which a model turn's outcome reduces the term count below the floor.
 *
 * EVERY TERM LANDS IN EXACTLY ONE BUCKET. Membership is decided on formKey — the same script-
 * preserving fold the plan compiler keys its romanisation lookup on — so a term that is in neither
 * the floor nor the additions is impossible by construction: the model's list is walked in full and
 * each member goes to `model_restatements` if the floor holds it and to `model_additions` if it does
 * not. There is no third outcome and no `continue` that discards one. PURE.
 */
export function mergeVariantFloor(floorFamilies, modelVariants, { rejectedSeeds = [] } = {}) {
  const families = Array.isArray(floorFamilies) ? floorFamilies : [];
  const floorByKey = new Map();
  for (const f of families) {
    for (const t of f?.terms ?? []) {
      const k = formKey(t);
      if (!k || floorByKey.has(k)) continue;
      floorByKey.set(k, f.family);
    }
  }
  const model_restatements = [], model_additions = [];
  const seenModel = new Set();
  for (const v of Array.isArray(modelVariants) ? modelVariants : []) {
    const value = typeof v === "string" ? v.trim() : String(v?.value ?? "").trim();
    if (!value) continue;
    const k = formKey(value);
    if (!k || seenModel.has(k)) continue;
    seenModel.add(k);
    const category = typeof v === "string" ? "" : String(v?.category ?? "").trim().toLowerCase();
    const hit = floorByKey.get(k);
    if (hit) model_restatements.push({ value, category, floor_family: hit });
    else model_additions.push({ value, category });
  }
  return {
    // The one-line answer to "which of these did a machine produce and which did a model imagine".
    marking: "floor_families[].terms = deterministic, generated by code from the seed set — a model turn can neither shrink nor reorder them. model_additions = terms only the model proposed. model_restatements = terms the model proposed that the floor already held.",
    floor_families: families,
    model_restatements,
    model_additions,
    ...(rejectedSeeds?.length ? { rejected_seeds: rejectedSeeds } : {}),
    counts: {
      floor: floorByKey.size,
      model_restated: model_restatements.length,
      model_added: model_additions.length,
      union: floorByKey.size + model_additions.length,
    },
  };
}

/**
 * Is `root` a plausible formative root, or a prose-parse artifact?
 *
 * A stem is never LONGER than the element it stems from — SUREN(5) for ZURENA(6), HYDR(4) for HYDRA(5),
 * VELTRI(6) for VELTRIN(7). Substring containment is NOT the test: a real root can differ in its leading
 * character (ZURENA → SUREN reaches the ARBORA family), which is exactly the widening the root exists for.
 * The swallowed-sentence artifacts are always the element PLUS a clause — 32-36 characters against a 5-char
 * element — so length alone separates them cleanly without narrowing any legitimate root. PURE.
 */
export function isStemOfNamedElement(root, dominant, model = null) {
  const r = normalizeElement(root);
  if (!r) return false;
  const named = [dominant, ...(Array.isArray(model?.elements) ? model.elements.map((e) => e?.value) : [])]
    .map(normalizeElement).filter(Boolean);
  if (!named.length) return true;                       // nothing to measure against ⇒ today's behaviour
  return r.length <= Math.max(...named.map((n) => n.length));
}

// Strict-parse form-neighbourhood.json back to its element bands (for the oracle). Tolerant: returns [] on any
// shape defect (the oracle is a backstop, never a hard gate — a malformed artifact must not crash the run).
export function parseFormNeighbourhoodJson(raw) {
  try {
    const o = JSON.parse(raw);
    return Array.isArray(o?.elements) ? o.elements.filter((e) => e && e.band && Array.isArray(e.band.exactQueries)) : [];
  } catch { return []; }
}

// Extract the NAME tokens a register band actually DISPATCHED, tolerant of EVERY band shape: the MERGED
// register-named-band.json (`{enumerated:[{...,_query,mark_text}], crowds:[{query}]}` from mergeNamedBands), a
// per-axis block array (`[{state,query,records}]`), or `{blocks:[…]}`. From every query string it pulls the
// backtick-quoted `name:` value + its `(v1,v2,…)` phonetic-variant tail + any wildcard pattern (`?`/`*`), and it
// ALSO takes every returned `mark_text` (a record that came back proves its name was IN the searched band). PURE.
export function dispatchedQueriesFromBand(bandJsonText) {
  let o;
  try { o = typeof bandJsonText === "string" ? JSON.parse(bandJsonText) : bandJsonText; }
  catch { return []; }
  const queries = [];   // strings to scan for `name:` clauses + wildcard patterns
  const out = new Set(); // accumulates name tokens (returned mark_text added directly)
  const harvest = (b) => {
    if (!b || typeof b !== "object") return;
    if (b.query) queries.push(String(b.query));
    if (b._query) queries.push(String(b._query));
    if (b.mark_text) out.add(String(b.mark_text).trim());
    for (const r of (Array.isArray(b.records) ? b.records : [])) { if (r?._query) queries.push(String(r._query)); if (r?.mark_text) out.add(String(r.mark_text).trim()); }
    for (const s of (Array.isArray(b.sample) ? b.sample : [])) { if (typeof s === "string") out.add(s.trim()); else if (s?.mark_text) out.add(String(s.mark_text).trim()); }
  };
  if (Array.isArray(o)) o.forEach(harvest);
  else if (Array.isArray(o?.blocks)) o.blocks.forEach(harvest);
  else { (Array.isArray(o?.enumerated) ? o.enumerated : []).forEach(harvest); (Array.isArray(o?.crowds) ? o.crowds : []).forEach(harvest); }
  for (const q of queries) {
    for (const m of q.matchAll(/name:`([^`]+)`(?:\(([^)]*)\))?/gi)) {
      if (m[1]) out.add(m[1]);
      if (m[2]) for (const v of m[2].split(",")) if (v.trim()) out.add(v.trim());
    }
    for (const m of q.matchAll(/`([a-z0-9?*]+)`/gi)) if (/[?*]/.test(m[1])) out.add(m[1]);       // backtick-wrapped wildcard
    for (const m of q.matchAll(/\b([a-z0-9]*[?*][a-z0-9?*]*)\b/gi)) if (/[?*]/.test(m[1])) out.add(m[1]); // bare wildcard in a prose query
  }
  return [...out].filter(Boolean);
}

// Turn the form-neighbourhood band(s) + what was dispatched into frame-diff-compatible `variant` directives —
// the mechanical regrounding of the form axis. A generated near-form never dispatched fires the SAME
// supplemental-sweep + clamp channel as the blind frame-diff (no reliance on a peer model to NOTICE it). When
// MANY are missing (the funnel never searched the machine band at all) we emit ONE systemic directive instead
// of hundreds. `explained` carries reopen-triggered legitimate non-dispatches. PURE.
export function formGapDirectives(elements, { dispatched = [], explained = [], maxIndividual = 8 } = {}) {
  const directives = [];
  for (const el of elements ?? []) {
    const g = coverageGaps(el.band, { dispatched, explained });
    if (g.complete) continue;
    const miss = g.missingExact;
    if (miss.length > maxIndividual) {
      directives.push({
        layer: "variant", item: `${el.element} form-neighbourhood`, severity: "material",
        observation: `${miss.length} of the deterministic form near-forms of "${el.element}" were never dispatched (the machine form band was not searched) — e.g. ${miss.slice(0, 6).join(", ")}. Search the complete form-neighbourhood.json band (OR-stacked, count-first).`,
      });
    } else {
      for (const form of miss) directives.push({
        layer: "variant", item: form, severity: "material",
        observation: `mechanical form near-form of "${el.element}" (deterministically generated) was not dispatched — search it.`,
      });
    }
    if (!g.phoneticFamilyDispatched && (el.band?.wildcardPatterns?.length)) directives.push({
      layer: "variant", item: `${el.element} phonetic family`, severity: "material",
      observation: `the consonant-skeleton wildcard (${el.band.wildcardPatterns.join(" / ")}) / phonetic key was not dispatched — the vowel-family (VYLONA/VILINA-class) is unsearched.`,
    });
  }
  return directives;
}
