// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// grounds-grammar.mjs —: a charged rating has to carry its reason, and the reason is a statement
// about what could NOT be established.
//
// ── WHAT SHIPPED, AND WHAT IS ACTUALLY HAPPENING ─────────────────────────────────────────────────
//
// shipped two behaviours. The recurrence half is proven. The second is "rule loaded, AND use the
// note to state what could not be established" — and e2e read all 24 `loaded` rulings in the corpus
// (3 runs) and found every one of them describing the material instead. Verbatim, two of them:
//
//     "Article about real gang member sentenced for federal drug trafficking offense"
//     "Wikipedia article documenting 1871 race riot, negative historical violence event"
//
// Both are true. Neither says what could not be established. A charged judgment recorded without its
// grounds is the same shape as 's `step-silent`: the ledger has a label for the decision and
// cannot say why for any single one, so a reader cannot tell "correctly judged" from "silently
// asserted" — which are opposite repairs.
//
// ── WHY THIS IS NOT THE KEYWORD PROBE e2e WARNED ABOUT ───────────────────────────────────────────
//
// e2e's own note on the measurement: "because a keyword probe on prose is exactly the instrument that
// misleads, I read the notes rather than banking the zero." That warning is right and it is the design
// constraint here, so three things are true of this module and none of them is true of a word list:
//
//   1. IT CHECKS A CONTRACT, NOT A LANGUAGE. Doctrine instructs the seat to state what could not be
//      established. This asks whether the note does so in a form a reader can recognise. It is not a
//      general classifier of English and must never be described as one — the question is "did the
//      writer meet the instruction", which is answerable, not "what does this prose mean", which is
//      not.
//   2. THERE ARE THREE VERDICTS AND ONLY ONE IS A PASS. A note that is neither recognisably grounds
//      nor recognisably description is `unclear`, and `unclear` is a finding — never a pass. A
//      two-way classifier would have to guess, and guessing on prose is how the probe misleads.
//   3. DESCRIPTION WINS OVER AN INCIDENTAL LIMIT PHRASE. "Article about a man who could not pay his
//      debts" contains "could not" and states nothing about what was established. A word list scores
//      that as grounds. This does not, and the precedence is the whole reason the module exists
//      rather than a regex at the call site.
//
// ── ONE LIMITATION, STATED BECAUSE IT CANNOT BE FIXED FROM THE CORPUS ────────────────────────────
//
// The NEGATIVE arm is validated against real data: 24 notes, all describing the material, two quoted
// verbatim in the test. The POSITIVE arm is not, and cannot be — **the corpus contains no example of
// a note that states what could not be established.** That is the defect. So `grounds` is validated
// against constructed examples only, and the first real one to arrive is worth re-reading this against
// rather than assuming it passes.
//
// PURE. No IO, no model, no network.

/** The verdicts. `unclear` is not a pass — see (2) above. */
export const GROUNDS_VERDICTS = Object.freeze(["grounds", "description", "unclear"]);

// A statement about the LIMIT of what was established. Deliberately anchored on the verb, not on a
// bare word: "no evidence" alone appears inside descriptions of what a page claims, while "no evidence
// ties/links/connects" is the writer speaking about their own reach.
const LIMIT = [
  /\b(could|can)\s?not\s+(be\s+)?(establish|confirm|verif|determin|tell|rule\s+out|distinguish|attribut|tie|link|connect)/i,
  /\b(unable|no\s+way)\s+to\s+(establish|confirm|verif|determin|tell|rule\s+out|distinguish|attribut|tie|link|connect)/i,
  /\bnot\s+(been\s+)?(established|confirmed|verified|determined|attributable|attributed)\b/i,
  /\bno\s+(evidence|source|record|basis|indication|way)\s+(that|to|which|ties|tying|links|linking|connects|connecting|shows|showing|establishes|establishing)/i,
  /\bnothing\s+(here\s+)?(establishes|confirms|ties|links|connects|shows|indicates)/i,
  /\b(remains|is)\s+unclear\s+(whether|if|which|who|what)/i,
  /\bwhether\b[^.]{0,80}\b(could|can)\s?not\s+be\b/i,
  /\bdoes\s+not\s+(establish|confirm|show|say|tie|link|connect)\b/i,
];

// The failing shape, and it is the one the corpus is full of: the note's SUBJECT is the source or its
// contents. Anchored at the start, because that is where the corpus puts it and because a source noun
// deep in a sentence is often a legitimate part of a grounds statement ("no source ties the article to
// the applicant").
const DESCRIBES_SOURCE =
  /^\s*(?:an?\s+|the\s+)?(article|page|post|thread|wikipedia|wiki|report|story|news|blog|video|listing|profile|document|record|entry|piece|item|coverage|write-?up)\b/i;

// A second failing shape with no source noun at all: the note is a bare characterisation of the
// material. "Negative historical violence event." "Offensive social-media content." No verb of
// establishment, no subject but the material.
const CHARACTERISES = /^\s*[^.]{0,120}\b(content|material|imagery|language|event|incident|topic|subject\s+matter)\b\s*[.]?\s*$/i;

/**
 * Does this note state what could not be established, or does it describe the material?
 *
 * @param {string} note
 * @returns {{verdict: "grounds"|"description"|"unclear", why: string}}
 */
export function classifyGroundsNote(note) {
  const s = String(note ?? "").trim();
  if (!s) return { verdict: "unclear", why: "the note is empty — a charged rating with no note at all" };

  const describes = DESCRIBES_SOURCE.test(s) || CHARACTERISES.test(s);
  const limits = LIMIT.some((re) => re.test(s));

  // PRECEDENCE, and it is the load-bearing line. A note whose subject is the source describes the
  // material whatever else it happens to contain — otherwise "Article about a man who could not pay"
  // scores as grounds, which is the exact failure a word list produces.
  if (describes) {
    return {
      verdict: "description",
      why: limits
        ? "the note's subject is the source or the material; a limit phrase appears inside that "
          + "description rather than as a statement about what was established"
        : "the note's subject is the source or the material — it says what is THERE, not what could "
          + "not be established",
    };
  }
  if (limits) return { verdict: "grounds", why: "the note states a limit on what could be established" };
  return {
    verdict: "unclear",
    why: "neither a recognisable statement of what could not be established nor a recognisable "
      + "description of the material — this is a finding, not a pass",
  };
}

/** The only passing verdict. Named so no caller has to remember which of the three it is. */
export function statesGrounds(note) { return classifyGroundsNote(note).verdict === "grounds"; }
