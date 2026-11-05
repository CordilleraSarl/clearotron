// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// wider-list.js — whether an answer the run already holds answers a phrase question, so that nothing is sent.
//
// A phrase holding AND, OR or NOT cannot be asked on the exact field, and is asked as its words in order
// (register-plan.mjs, exactOperatorSubstitution). Before that goes out, this reads the run's own answers, on these rules:
//
//   THE SAME REQUEST, whatever came back. A request already answered is not asked again, and a crowd stays a crowd.
//   A WIDER LIST, ONLY WHEN IT PROVABLY HOLDS THE PHRASE AND WAS COMPLETE. Its request must match the phrase's words
//     whether or not the register indexes the operator word; a phonetic field or a bare one-word pattern proves nothing
//     about a multi-word mark. It asked the same offices or more, offices it left out for the goods field subtracted first,
//     and the same classes or more, or none. Goods, owner and options must be the same: a record here cannot be read
//     against a narrower goods or owner question. Every record must carry usable mark text. A crowded, incomplete or
//     failed list is no answer at all, so the question is asked.
//
// What the phrase takes from a wider list is the records in its own offices and classes whose mark reads as its words in
// order, which is what its own request would have returned as far as the code can establish. The other records stand in
// the run under the search that found them. The match rules are the ones core.js records from measurement: a wildcard
// applies within a word, and ADJn means within n words, in order. They are not the vendor's documentation, so anything
// this cannot establish is asked rather than assumed. PURE.

const OPERATOR_WORD = /^(?:AND|OR|NOT)$/i;
const orLegs = (value) => String(value ?? "").split(/\s+OR\s+/).filter(Boolean);
const wordsOf = (text) => String(text ?? "").replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
const wordMatches = (pattern, word) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "iu").test(word);

/** Does one leg of a compiled value (`*A ADJ2 B*`) match a mark whose words are these? null when the leg is not a chain of words. */
export function legMatches(leg, words) {
  const parts = String(leg).trim().split(/\s+/);
  const wanted = [], gaps = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) wanted.push(parts[i]);
    else {
      const m = /^ADJ(\d*)$/i.exec(parts[i]);
      if (!m) return null;
      gaps.push(m[1] ? Number(m[1]) : 1);
    }
  }
  const from = (k, at) => {
    for (let i = at; i < words.length; i++) {
      if (k > 0 && i - at + 1 > gaps[k - 1]) return false;
      if (!wordMatches(wanted[k], words[i])) continue;
      if (k === wanted.length - 1 || from(k + 1, i + 1)) return true;
    }
    return false;
  };
  return from(0, 0);
}

/** Does this compiled value hold the literal phrase, whether or not the register indexes its operator word? */
function holdsThePhrase(value, literal) {
  const all = wordsOf(literal);
  const kept = all.filter((w) => !OPERATOR_WORD.test(w));
  const provable = (leg) => /\sADJ\d*\s/i.test(leg) || /^\*[^\s]*\*$/.test(leg.trim());
  return orLegs(value).some((leg) => provable(leg) && legMatches(leg, all) === true && legMatches(leg, kept) === true);
}

const superset = (a, b) => [...b].every((x) => a.has(x));
const CLASS_FIELD = "INT_CLASS_NUMBER";

/** A compiled request taken apart into what this comparison reads. */
function partsOf(body, markField) {
  const fields = Array.isArray(body?.searchFields) ? body.searchFields : [];
  const mark = fields.find((f) => f?.name === markField) ?? null;
  const classes = new Set(orLegs(fields.find((f) => f?.name === CLASS_FIELD)?.value));
  const { registrationOfficeCodes, searchFields: _fields, ...options } = body ?? {};
  const others = fields.filter((f) => f?.name !== markField && f?.name !== CLASS_FIELD);
  return { mark, classes, offices: new Set(registrationOfficeCodes ?? []), rest: JSON.stringify({ others, options }) };
}

const markTexts = (r) => [r?.mark_text, r?.screen?.mark_text, r?.screen?.mark_transliteration].filter((t) => wordsOf(t).length);

/**
 * The answer a held search gives this question, or null when none does: `{state, total_hits, count, records, reused_from}`,
 * or for the same request the held block itself with `reused_from`. `want` is the question's compiled request, `literal` its
 * term, and `held` the run's answers as `[{qid, query, body, block}]`. `markField` is the contains form's field.
 */
export function answerFromHeldList({ want, literal, held, markField }) {
  const w = partsOf(want, markField);
  if (!w.mark) return null;
  const legs = orLegs(w.mark.value);
  // A word of the question this comparison cannot read (punctuation inside it) would read as no match, and no match as a zero.
  if (legs.length !== 1 || /[^\p{L}\p{N}*?\s]/u.test(legs[0])) return null;
  const answers = Array.isArray(held) ? held : [];
  const sameRequest = answers.find((h) => h?.block && h.block.error !== true && h.block.deferred !== true && JSON.stringify(h.body) === JSON.stringify(want));
  if (sameRequest) return { ...sameRequest.block, reused_from: { qid: sameRequest.qid, query: sameRequest.block.query ?? null } };
  for (const h of answers) {
    const b = h?.block;
    if (!b || b.error === true || b.deferred === true || b.state !== "enumerated" || !Array.isArray(b.records)) continue;
    const c = partsOf(h.body, markField);
    if (!c.mark || !holdsThePhrase(c.mark.value, literal)) continue;
    if (c.rest !== w.rest) continue;
    const leftOut = new Set(Array.isArray(b.offices_without_goods_field) ? b.offices_without_goods_field : []);
    if (!superset(new Set([...c.offices].filter((o) => !leftOut.has(o))), w.offices)) continue;
    if (c.classes.size && !(w.classes.size && superset(c.classes, w.classes))) continue;
    if (!b.records.every((r) => markTexts(r).length)) continue;
    const records = b.records.filter((r) => w.offices.has(String(r?.office ?? "").toUpperCase())
      && (!w.classes.size || !Array.isArray(r?.classes) || !r.classes.length || r.classes.some((n) => w.classes.has(String(n))))
      && markTexts(r).some((t) => legMatches(legs[0], wordsOf(t)) === true));
    return { state: "enumerated", total_hits: records.length, count: records.length, records, reused_from: { qid: h.qid, query: b.query ?? null } };
  }
  return null;
}
