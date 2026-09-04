// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// rule-shape.mjs — F2 reasoning-integrity instrument. (Design document retired with the subsystem in
//, deleted with the name.) Scans the synthesis narrative / report for RULE-SHAPED reasoning
// — a rating decided by a numeric cutoff or a blanket rule rather than reasoned ("clearance is reasoned,
// not computed", risk-framework.md). Surfaces as a LOUD banner on the report, read before curation.
//
// GOODHART GUARD (§0(a), §6): OBSERVABILITY, never a pass/fail a retry can satisfy — the pipeline writes
// the sidecar and moves on; nothing gates on it. PURE (no node imports, tests offline); empty input → [].
//
// DELIBERATELY NARROW — near-zero false positives. It does NOT flag bare percentages or counts: the
// engine ENCOURAGES base-rate counts ("640 of 3,060 filings claim gaming", "545 live JELLY filings",
// "127k reviews") over adjectives. It flags ONLY the shape of a RULE that DECIDES the rating: a
// Level/Composite cutoff ("Level C or above", "Composite 3+"), an explicit "threshold", or a blanket
// "always/automatically/any X is <rating>". The real target (a rule injected into a customer context
// pack) extends this same scan when the pack ships (post-v1).

const PATTERNS = [
  // a Level/Composite CUTOFF that computes the rating ("Level C or above", "Composite 3 and up", "C+")
  [/\b(?:level|composite)\b[^.\n]{0,24}?(?:\bor\s+(?:above|higher|worse|more)\b|\band\s+up\b)/i, "a Level/Composite cutoff"],
  [/\b(?:level|composite)\s*[a-e0-9]\s*\+/i, "a Level/Composite cutoff (\"+\")"],
  [/\b(?:above|below|over|under|at or above)\s+(?:a\s+)?(?:level|composite)\s*[a-e0-9]/i, "a Level/Composite cutoff"],
  // a numeric comparison operator applied to a Level/Composite
  [/[<>≥≤]=?\s*(?:level|composite)?\s*[a-e0-9]\b.{0,20}\b(?:risk|rate|composite|level)\b/i, "a numeric comparison on the rating"],
  // an explicit threshold that decides risk
  [/\bthreshold\b[^.\n]{0,30}\b(?:risk|level|composite|confusion|similar)/i, "an explicit risk threshold"],
  [/\b(?:risk|level|composite|confusion|similar\w*)\b[^.\n]{0,30}\bthreshold\b/i, "an explicit risk threshold"],
  // a blanket rule: always/automatically/in every case/any X -> a rating
  [/\b(?:always|automatically|in every case|by default|whenever)\b[^.\n]{0,40}\b(?:rate|rated|treat|score|scored|high|medium|low|level|composite|blocking)\b/i, "a blanket \"always/automatically …\" rule"],
  [/\bany\b[^.\n]{0,40}\b(?:is|are|=)\s+(?:automatically\s+)?(?:high|very high|medium|low|level\s*[a-e]|composite\s*\d)\b/i, "a blanket \"any X is <rating>\" rule"],
];

/**
 * Flag rule-shaped reasoning in a synthesis/report surface. Pure: empty/missing input → [], never throws.
 * @param {string} text
 * @returns {Array<{why:string, snippet:string}>}  one entry per distinct match (snippet trimmed for the banner)
 */
// A cutoff phrase that merely says WHERE findings are shown/banded ("findings at Level C or above are
// detailed below") is PRESENTATION, not a rule that DECIDES a rating — skip it. Conservative: only the
// tail right after the match is inspected, so a real "treat Level C or above as high" still flags.
const PRESENTATION = /\b(?:detailed|listed|shown|displayed|set out|appears?|see|follow|grouped|sorted|ranked|below)\b/i;

// Appendix B: a customer's risk MATRIX is a sanctioned reasoning rubric, not the us-invented shortcut F2
// targets ("the brittleness ban is on US inventing mechanical shortcuts … its matrix ceilings are the
// client's rule, not ours"). So a Level/Composite cutoff phrased as matrix-citation ("Level C tops out at
// Medium per the matrix", "4/5 require Level D or E", "read the Composite off the matrix") is NOT rule-shaped
// reasoning — skip it. A genuine us-invented shortcut ("we treat Level C or above as high") carries none of
// this vocabulary and still flags.
const MATRIX_CONTEXT = /\b(?:matrix|ceiling|tops?\s+out|caps?\s+at|read\s+off|per\s+the\s+(?:risk\s+)?(?:framework|matrix))\b/i;

// doc-27 Item 3: the matrix DERIVATION notation "Level C + Horse Trade" / "Composite 3 + Paper Conflict"
// — where the "+" joins a Level/Composite to a Dispute Type (risk-framework's Classic / Horse Trade /
// Paper Conflict / Descriptive / Nuisance) — is the customer's full citation, not a us-invented cutoff, so
// it is exempt EVEN without nearby matrix vocabulary. A BARE "Level C +" (no Dispute Type follows) is still
// a shortcut and still flags. `[ \t]*` (NOT \s) keeps the Dispute Type on the SAME line as the "+" — a
// bare "Level C +\nHorse Trade …" across a line break is NOT the derivation and still flags.
const DISPUTE_TYPE_AFTER_PLUS = /^[ \t]*(?:classic|horse[ \t]*trade|paper[ \t]*conflict|descriptive|nuisance)\b/i;

export function findRuleShapeFlags(text) {
  const s = String(text || "");
  const out = [];
  const seen = new Set();
  for (const [re, why] of PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m;
    while ((m = g.exec(s))) {
      if (PRESENTATION.test(s.slice(m.index, m.index + m[0].length + 40))) continue;   // presentation, not a rule
      if (MATRIX_CONTEXT.test(s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60))) continue;   // sanctioned matrix-citation, not a us-invented shortcut
      if (/\+$/.test(m[0]) && DISPUTE_TYPE_AFTER_PLUS.test(s.slice(m.index + m[0].length))) continue;   // matrix derivation "Level C + Horse Trade", not a bare cutoff
      const snippet = m[0].replace(/\s+/g, " ").trim().slice(0, 120);
      const key = `${why}::${snippet.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); out.push({ why, snippet }); }
      break;   // one flag per pattern is enough for the banner
    }
  }
  return out;
}
