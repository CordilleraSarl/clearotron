// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// DOES THIS SENTENCE ASSERT ANYTHING ITS REFERENCE DOES NOT?
//
// One question, two callers. The knockout renderer asks it of a model-written caveat against the scope
// block the page already prints, and drops the caveat when the answer is no. The writing-standard check
// asks it of a page's lede against that page's title, and refuses the lede when the answer is no. The
// two are the same rule — "this line adds nothing to the line above it" — and they were one function
// private to the renderer until the check needed it.
//
// LIFTED RATHER THAN COPIED, AND THAT IS THE WHOLE POINT. Two definitions of one rule is one definition
// and one imitation of it, and the imitation is whichever the reader did not run. A copy here would
// drift the first time either caller tuned its stopword list, and the drift would be invisible: both
// sides would keep passing their own tests.
//
// ── THE STEM MUST BE IDEMPOTENT ON THE SINGULAR ─────────────────────────────────────────────────
//
// Carried over from the renderer with the defect it had already been repaired for, stated here so it is
// not reintroduced. An earlier form stripped a trailing "es" — which turned "gives" into "giv" while
// leaving "give" alone, so the two never matched and every caveat read as new. The fold has to map the
// plural onto the singular AND leave the singular where it is. Strip one trailing "s" and nothing else.

/**
 * Words that carry no claim, so their presence or absence says nothing about what a sentence asserts.
 *
 * Exported because a caller comparing two short strings — a title against a lede — can be left with no
 * content words at all, and that case needs naming rather than inferring from a false return.
 */
export const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'do',
  'does', 'each', 'for', 'from', 'has', 'have', 'here', 'in', 'is', 'it', 'its', 'no', 'not', 'of', 'on',
  'or', 'that', 'the', 'their', 'them', 'there', 'these', 'they', 'this', 'to', 'up', 'was', 'we', 'were',
  'what', 'when', 'which', 'will', 'with', 'you', 'your']);

/** The words in a string that carry a claim: longer than two characters, and not a stopword. */
export const contentWords = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** Fold plural onto singular. Idempotent on the singular, which is the property that makes it work. */
export const stem = (w) => w.replace(/ies$/, 'y').replace(/s$/, '');

/**
 * Does `line` assert anything `reference` does not already assert?
 *
 * TRUE unless every content word in the line is already in the reference. An empty line has nothing to
 * say and returns false; a line with one unfamiliar word is kept. Singular and plural are folded, so
 * "conclusion" does not read as new beside "conclusions".
 *
 * THE TEST IS SUBSET, NOT SIMILARITY, and the difference is the whole safety argument for the renderer's
 * use of it: a caveat is dropped only when EVERY content word in it already appears in the reference. A
 * caveat making any new claim survives.
 *
 * @param {string} line the sentence being judged
 * @param {string} reference the text it is judged against
 * @returns {boolean}
 */
export function saysSomethingNew(line, reference) {
  const known = new Set(contentWords(reference).map(stem));
  const words = contentWords(line);
  if (!words.length) return false;
  return words.some((w) => !known.has(stem(w)));
}
