// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// script-form.mjs — the ONE vocabulary for "what SCRIPT is this mark term written in, and does the
// ACTIVE provider's index hold that form of it?"
//
// THE DEFECT THIS EXISTS TO KILL. A frozen plan carried 41
// transliteration-numeric entries, 13 of them raw native-script terms (Katakana, Han, Hangul, Arabic,
// Cyrillic, Devanagari, Thai, Greek). The active provider indexes non-Latin filings by their
// ROMANISATION and holds no character index, so every one of those searches would have answered 0
// with no error — the exact shape a reader calls CLEAN. It refused them instead, and the axis
// disclosed a hole rather than shipping thirteen false cleans.
//
// That refusal lived in ONE provider's request builder. Every other provider would have SENT the same
// terms. Whether that is right or wrong depends entirely on a fact about the provider's index, and a
// fact belongs in the capability contract as DATA — not in whichever vendor file happens to carry a
// hand-written check. That is what `capabilities.nativeScriptIndex` is:
//
//   true   — the index holds the CHARACTERS. A native-script term is a legitimate, productive query
//            and must be sent (the table in driver/jx.mjs): 小米 = 553,
//            华威豹 = 6, 스타벅스 = 15 on such a provider, against 0/0/0 on a romanisation index; and
//            archived executed bands returned non-zero on native characters across Han, Katakana,
//            Cyrillic and Greek. Guarding it here would convert evidenced coverage into deferrals —
//            the OPPOSITE defect, and a worse one, because a deferral is at least visible.
//   false  — the index holds only the TRANSLITERATION. Sending the characters is a silent zero.
//            Send the romanisation (which is also strictly better for clearance: "HUA WEI BAO"
//            returns 华威豹, 华味宝 AND 华为爆破 — three character sets, one pronunciation, and
//            Chinese squatting is overwhelmingly homophone-based).
//   null   — UNDECLARED. Nobody has probed it. This is the fail-loud default and it is deliberate:
//            an undeclared index that answers 0 is indistinguishable from a clean, and "we never
//            checked" must cost a disclosed deferral, never a silent zero. It is closed by a probe
//            plus a one-word edit to that provider's capabilities.js — never by a guess here.
//
// PROVIDER-AGNOSTIC BY CONSTRUCTION: the detector below knows nothing about any vendor, and the policy
// hangs off the DECLARATION, not off which file the caller lives in.
//
// PURE (no node imports, no vendor HTTP) → tests offline, and the driver may import it freely.

/**
 * Latin, Common (digits, spaces, punctuation, `*`/`?` wildcard syntax) and Inherited (combining marks,
 * so CAFÉ in either normalisation form stays Latin) are the searchable-as-written set. ANY other
 * script character makes the term native-script.
 */
export const NON_LATIN_RE = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

export function isNonLatinTerm(term) { return NON_LATIN_RE.test(String(term ?? "")); }

/**
 * The declaration-driven policy. Given a provider's capability contract and the MARK TERMS a query is
 * about to carry, return the plain-English gap reason — or null when the slice may be dispatched.
 *
 * Callers pass the terms of the QUERY THAT WILL GO TO THE WIRE, not the plan entry's own term: a
 * provider whose index is romanisation-only substitutes the entry's `romanizedTerms` in its
 * buildEntryQuery, and a slice that has been rescued that way is answerable and must not be refused.
 * Checking the built query is what makes the rescue and the refusal agree.
 *
 * OWNER names are deliberately NOT the caller's concern here — this is the mark-text rule.
 *
 * The reason is returned BARE; the executor prefixes it with its own CAPABILITY_GAP_MARKER so the
 * deferral shape is stamped in exactly one place.
 */
export function nativeScriptIndexGap(capabilities, terms) {
  const declared = capabilities?.nativeScriptIndex;
  if (declared === true) return null;                    // the index holds the characters — SEND them
  const list = Array.isArray(terms) ? terms : terms == null ? [] : [terms];
  const native = list.map((t) => (t == null ? "" : String(t))).filter((t) => t.trim() && isNonLatinTerm(t));
  if (!native.length) return null;
  const id = capabilities?.id ?? "unknown";
  const shown = JSON.stringify(native[0].slice(0, 40));
  if (declared === false) {
    return `term ${shown} is not in Latin script, and the active register provider (${id}) indexes `
      + `non-Latin filings by their TRANSLITERATION, not their characters — searching the characters `
      + `would return 0 with no error, which reads as CLEAN. So the slice is DEFERRED, never searched. `
      + `Send the romanisation instead (e.g. 华威豹 → "HUA WEI BAO"), carried on the plan entry's `
      + `romanizedTerms, which also catches the homophone variants the characters miss.`;
  }
  return `term ${shown} is not in Latin script, and the active register provider (${id}) has NOT `
    + `DECLARED which form its index holds (capabilities.nativeScriptIndex is undeclared) — nobody has `
    + `probed whether it answers the characters or only their romanisation. An undeclared index that `
    + `answers 0 is indistinguishable from a clean, so the slice is DEFERRED rather than sent. Close it `
    + `by probing the provider (fetch one record from an office that files in this script, read its `
    + `name verbatim, search that exact string back) and declaring nativeScriptIndex true or false — `
    + `or by supplying the romanisation on the entry's romanizedTerms.`;
}

// ── THE ROMANISATION VOCABULARY — the other half of the same rule ────────────────────────────────
//
// The detector above says which terms NEED a romanisation; these two say what a romanisation IS.
// They are shared by the two lanes that MINT plan entries — the jx candidate lanes (driver/jx.mjs,
// where they originally lived in jx-lanes.mjs) and the variant-manifest compiler
// (driver/register-plan.mjs / variant-manifest-model.mjs). Both push onto the same
// transliteration-numeric axis and both are read by the same executor seam (`romanizedTerms` →
// `romanized_names`), so a second, privately-shaped emitter would be a false clean waiting to
// happen: one lane's entries would carry a form the substituting provider recognises and the
// other's would not. One definition here is what keeps the two lanes and the guard in agreement —
// the guard falls silent because the right value arrived, never because it was loosened.

/** ASCII letters, digits and single spaces. Rejects tone marks, diacritics and leftover native script
 *  — anything the mark field cannot take. Returns a reason string when refused, null when acceptable. */
export function romanizationRefusal(value) {
  const r = String(value ?? "").normalize("NFC").trim();
  if (!r) return "no romanization — the register is indexed by the romanised form, not the characters, so this candidate has nothing searchable";
  if (r.length > 60) return `romanization too long (${r.length} chars)`;
  if (!/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(r))
    return `romanization ${JSON.stringify(r.slice(0, 40))} is not plain ASCII letters/digits separated by single spaces`;
  return null;
}

/** The two spellings a register may hold for one romanisation — syllable-separated as the record
 *  writes it, and run together as a searcher would type it. Probed: identical counts on CN/TW/GR/KR/TH,
 *  but EG differs (7 vs 10), so BOTH are emitted and OR-joined rather than picking one. */
export function romanizationSpellings(value) {
  const spaced = String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  if (!spaced) return [];
  const joined = spaced.replace(/ /g, "");
  return joined === spaced ? [spaced] : [spaced, joined];
}

/**
 * The script-preserving IDENTITY FOLD for mark-term lookup and dedup — "are these two strings the
 * same term, up to case, punctuation, width and LATIN accents?"
 *
 * Two folds fused, and the seam between them is the whole point:
 *   - LATIN text is accent-folded: lowercase, NFKD, then combining marks stripped — but ONLY the
 *     marks sitting on a Latin base letter — then punctuation/whitespace dropped. "Tikí-Slush" and
 *     "CORAL FREEZE" collide, exactly as the owner-formative dedup has always wanted.
 *   - NON-LATIN text keeps every combining mark. In most non-Latin scripts a combining mark is not
 *     an accent, it is part of WHICH LETTER this is: Japanese dakuten/handakuten (タ=ta vs ダ=da),
 *     Thai vowel signs, Devanagari matras, Arabic diacritics. A fold that strips them (the previous
 *     shape of this function: bare NFKD + strip all \p{M}) collapses MARK-DISTINGUISHED SIBLINGS
 *     into one key: ティキスラッシュ
 *     (TIKI SURASSHU) and ディキスラッシュ (DIKI SURASSHU) keyed identically, so the romanisation
 *     lookup handed one sibling the OTHER's romanisation and the dictated DIKI form was never
 *     searched anywhere — a silent wrong-query false clean, the exact class the carriage fix exists
 *     to kill. NFKD is kept for its width folding (half-width ｶﾞ and full-width ガ are the same
 *     letter); only the mark-stripping is script-scoped.
 *
 * Falls back to the trimmed original for an all-symbol term so a non-empty term never keys empty.
 * PURE. Shared by the plan compiler's romanisation lookup + mark/variant/formative dedups
 * (driver/register-plan.mjs) and the manifest floor's mark-restatement check
 * (driver/variant-manifest-model.mjs) — ONE definition, so the compiler's lookup and the gate that
 * promises the lookup will succeed can never drift apart.
 */
export const formKey = (s) => {
  const t = String(s ?? "").toLowerCase().normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "");
  return t || String(s ?? "").trim();
};
