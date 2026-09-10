// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE TWO-REGISTER RULE, AS THE REVIEWER READS IT.
//
// The report goes to a lawyer who layers advice on top, and that lawyer's client reads the same page.
// The band, the summary, the basis line and the one-liners are the whole product for the second reader,
// and they were the hardest lines on it: single sentences of seventy-odd words in the lawyer's
// vocabulary. The owner's ruling is that default-visible text carries no legal or engine vocabulary at
// all, and that inside a fold the lawyer's words are allowed where a plain one would lose precision.
//
// THIS IS ADVISORY AND MUST STAY ADVISORY. A hit is a rewrite of that line — never a disclosure to the
// client, never a run failure. The rule is presentation: it changes no band, no evidence and nothing
// that is searched.
//
// — AND IT MUST NOT FIRE ON THE MARK IT IS CLEARING.
//
// This is the defect `coverage-form.mjs` records one level in: a refusal that cannot tell a mark from
// engine vocabulary blocked a clearance on the mark SLICE, and a render-time substitution turned "AXIS
// Bank filed in class 36" into "group Bank filed in class 36" on a report clearing AXIS. Half the words
// here are ordinary English and several are plausible marks — PREVAIL, SENIOR, SPECIFICATION. A check
// that flagged the mark under clearance would put noise on exactly the report that matters most, so
// every term the run is about is excluded before the text is read.

/**
 * The lawyer's vocabulary, as WORKED EXAMPLES with the plain form beside each. Not a ban list: the
 * issue rejects "a list of forbidden words as the mechanism" in terms, and this is what the reviewer
 * offers a seat as the rewrite, which is a different thing from a gate that refuses.
 *
 * Each entry is [what a lawyer writes, what the reader needs]. The second half is the load-bearing one —
 * a flag naming a word teaches nothing, and the seat has to produce a sentence.
 */
export const PLAIN_FORMS = Object.freeze([
  ["proprietor", "owner"],
  ["subsisting", "live"],
  ["specification", "goods list"],
  ["citable", "earlier marks the office can raise against you"],
  ["prevail", "win"],
  ["formative", "names built on"],
  ["belt-and-braces", "extra"],
  ["non-use attack", "could be cancelled for not being used"],
  ["on the record as it stands", "on what we found"],
  ["marks-and-goods comparison", "same name, same goods"],
  ["dispatch", "the request"],
  ["instructed", "what was asked"],
  ["chunk", ""],
]);

/** The longest visible sentence a reader should meet. The issue's number, not a derived one. */
export const SENTENCE_WORD_LIMIT = 25;

/**
 * How a term in `PLAIN_FORMS` is looked for in prose — ONE definition, because two of them drift.
 *
 * THE INFLECTIONS ARE THE POINT, and they were the reason a second copy of this rule survived. The
 * pre-delivery lint carried its own hand-tuned patterns — `\bproprietors?\b`, `\bprevails?\b|\bprevailing\b`
 * — while this file built `\bproprietor\b` and matched neither plural. So the pinned source was the
 * WEAKER of the two, and reading terms from it without this would have quietly narrowed what the live
 * check catches: a consolidation that loses coverage is a regression wearing a tidy-up's clothes.
 *
 * A trailing `s`, `es`, `ed` or `ing` after the term, and a hyphen matching a space, which is how the
 * same phrase is written in two documents by two people.
 */
export const termMatcher = (term) => new RegExp(
  `\\b${term.replace(/[-]/g, "[- ]").replace(/\s+/g, "\\s+")}(?:e?s|ed|ing)?\\b`, "i");

/** Everything the run is ABOUT — the mark, its variants, the owners named. Never flagged. */
const ownTerms = (about = {}) => {
  const out = [];
  for (const v of [about.mark, ...(about.marks ?? []), ...(about.owners ?? []), ...(about.terms ?? [])]) {
    const s = String(v ?? "").trim();
    if (s) out.push(s.toLowerCase());
  }
  return out;
};

/** Sentences, split on terminators that end one. Crude on purpose — this counts words, not grammar. */
export const sentencesOf = (text) =>
  String(text ?? "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export const wordsIn = (sentence) => String(sentence ?? "").trim().split(/\s+/).filter(Boolean).length;

/**
 * What is wrong with one default-visible line, as rewrite advice. `[]` means nothing to say.
 *
 * `about` carries the run's own marks and owners so they are never reported — see the header. A term
 * that IS the thing being cleared is not the lawyer's vocabulary, it is the subject.
 */
export function plainRegisterFlags(text, about = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  const mine = ownTerms(about);
  // Blank the run's own terms before reading, rather than filtering hits afterwards: a mark can contain
  // one of these words ("PREVAIL"), and a hit inside it is not a hit at all.
  let scan = raw;
  for (const t of mine) {
    if (!t) continue;
    scan = scan.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }

  const flags = [];
  for (const [term, plain] of PLAIN_FORMS) {
    if (!termMatcher(term).test(scan)) continue;
    flags.push({
      kind: "vocabulary",
      term,
      say: plain
        ? `"${term}" is the lawyer's word — the reader needs "${plain}". Rewrite the sentence, do not swap the word.`
        : `"${term}" is an engine word and has no place on a page a client reads. Rewrite the sentence.`,
    });
  }

  for (const s of sentencesOf(raw)) {
    const n = wordsIn(s);
    if (n > SENTENCE_WORD_LIMIT) {
      flags.push({
        kind: "length",
        words: n,
        say: `${n} words in one sentence, and a visible line takes ${SENTENCE_WORD_LIMIT}. Split it — one idea per sentence, `
          + "the conclusion first. Do not shorten it by dropping the reason.",
      });
    }
  }
  return flags;
}

/**
 * The fields a reader meets before opening anything. Named here rather than at each call site so the
 * two products answer to one list — the knockout and the clearance drifted apart once already.
 */
export const DEFAULT_VISIBLE_FIELDS = Object.freeze({
  knockout: ["summary", "batchOpener", "basis", "net", "factors", "counterFactors", "mitigation", "standardCaveats", "reviewerNotes"],
  clearance: ["summary", "oneLiner", "registrability", "thirdPartyRights", "ownRights", "freedomToOperate", "reviewerNotes", "coverage"],
});
