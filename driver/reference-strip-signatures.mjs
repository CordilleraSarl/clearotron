// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE TWO SIGNATURES THE REFERENCE STRIP LEFT BEHIND (tracker issue 185).
//
// The strip's job was to remove internal references from this repository before it went public, and it
// did that. Where the reference was the SUBJECT of the sentence, it took the subject with it:
//
//     "[ref]'s design ruling — above any fold, only a statement…"   became   "'s design ruling — …"
//     "renders the pre-[ref] section"                              became   "renders the pre- section"
//
// Neither construction occurs in written English, which is the whole reason they can be counted rather
// than judged. A reader of a public repository meets them as sentences that do not finish, and one of
// them is in user-facing configuration documentation rather than in a comment.
//
// WHAT THIS MODULE IS AND IS NOT. It finds them. It does not repair them: the repair is per-sentence and
// needs somebody reading the surrounding code, because "the pre- section" means "the section as it was
// before the findings contract changed" and only that reader can say so. The finding is mechanical and
// costs nothing, so it is the part that ships as a check.
export const SIGNATURES = [
  {
    name: "a comment beginning with a bare possessive",
    // Anchored at the comment leader, so `it's` and `the run's` mid-sentence are untouched — only the
    // case where the possessive has nothing in front of it to possess.
    re: /^\s*(?:\/\/|#|\*)\s*'s\b/,
  },
  {
    name: "`pre- ` followed by a lowercase word",
    // The hyphen is left dangling by a stripped number. `pre-flight` and `pre-delivery` do not match:
    // the strip's residue always leaves whitespace after the hyphen.
    re: /\bpre-\s+[a-z]/,
  },
];

// THE RULE'S OWN DEFINITION IS THE ONLY EXEMPTION, and it is named rather than pattern-matched.
//
// These three files QUOTE the residue in order to define it: the specimens in the arm, the examples in
// the header above. Scanning them counts the definition as an instance, which puts the guard's own text
// into the backlog it polices and makes every re-mint grow the number it exists to shrink. Caught by a
// plant, not by review — they were untracked when the table was first minted, so `git ls-files` did not
// list them and the census read a tree that did not include them yet.
export const RULE_DEFINITIONS = [
  "driver/reference-strip-signatures.mjs",
  "driver/test/the-reference-strip-left-sentences-unfinished.test.mjs",
  "scripts/mint-reference-strip-backlog.mjs",
];

/** Files worth scanning: prose-bearing, tracked, not generated, and not this rule's own definition. */
export const isScannable = (f) =>
  /\.(mjs|md|yml|ts)$/.test(f) && !f.startsWith("portal-ui/dist/") && !RULE_DEFINITIONS.includes(f);

/**
 * Count both signatures per file across `files`.
 * `read` is injected so an arm can drive this over a synthetic tree — a census helper that can only
 * read the real repository cannot be planted, and a plant is the only thing that proves it still counts.
 */
export function censusOf(root, files, read) {
  const out = {};
  let total = 0;
  for (const f of files.filter(isScannable)) {
    let text;
    try { text = read(f); } catch { continue; }          // binary or unreadable — nothing to count
    const counts = SIGNATURES.map((s) => text.split("\n").filter((l) => s.re.test(l)).length);
    if (counts.some((n) => n > 0)) { out[f] = counts; total += counts.reduce((a, b) => a + b, 0); }
  }
  // Sorted, so a re-mint produces a reviewable diff instead of a reordered file.
  return { total, files: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a < b ? -1 : 1)) };
}
