// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// card-budget.mjs — PR-9 (Levels): the report renders three honest levels, and depth is FOLDED, never
// deleted. Budgets are enforced at ASSEMBLY (assembleReportMd), not in the hash-frozen renderer — the
// same guarantee with zero freeze break and zero archived-run blast radius (an archived run re-renders
// from its already-assembled report.md; only fresh assemblies fold).
//
// The two folds, both MOTION not deletion (so "repairs never grow / substance never shrinks" holds):
//   • "### The read" is capped at 2 sentences / ~120 words, cut ONLY at a sentence boundary; the
//     overflow MOVES to the head of "### Full detail" under a "**Continued read:**" bullet — the frozen
//     renderer shows Full detail as the card's level-3 drill, so the depth stays one click away.
// RETIRED THE SECTION: report-card no longer authors "### The read" (it was a third
//     condensation of a finding the typed `net` already summarises), so on a card written to the
//     current contract foldCardRead finds no heading and returns {md, fold:null} — a no-op. It is kept,
//     not deleted, for the two inputs that can still carry the section: a drifted card, and any card
//     re-assembled from an older report-cards/ directory on a resume. Nothing else calls it.
//   • overall_caption is clipped at 3 sentences; the overflow MOVES to the head of the # Actions
//     "### Checks we ran — what we found" bucket ("**Continued summary:**" bullet), which the frozen
//     renderer shows inside the collapsible Scope section. (The plan's first-draft home was a "# Summary"
//     section, but the frozen hero renders # Summary INSTEAD OF the caption — parking overflow there
//     would either swallow the clipped caption or defeat the budget; the Scope bucket is the level-2
//     home that actually renders.)
//
// Every fold is RECORDED and returned to the caller — assembleReportMd persists them to
// _driver/card-folds.json and the predelivery lint surfaces a flag-only observability row. A fold is
// routine operation, never a defect: the row always passes; it exists so a reviewer can see where the
// assembly moved words. PURE — no IO, no config.

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean);

// Sentence boundaries: [.!?…] followed by whitespace, EXCEPT after common legal/citation abbreviations
// and single-letter initials ("U.S.", "Cl.", "No.", "J. Smith"). Conservative by design — a missed
// boundary folds LESS (the read keeps an extra sentence); a false boundary would cut mid-citation.
const ABBREV_RE = /\b(?:cl|no|nos|reg|regs|app|appl|ser|art|sec|inc|corp|ltd|co|vs|v|approx|para|fig|etc|e\.g|i\.e|cf|et al|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|mr|ms|dr|st)\.$/i;
const INITIAL_RE = /\b[A-Z]\.$/;
export function splitSentences(text) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out = [];
  let start = 0;
  const re = /[.!?…]+(?=\s)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const end = m.index + m[0].length;
    const before = t.slice(start, end).trimEnd();
    if (ABBREV_RE.test(before) || INITIAL_RE.test(before)) continue;
    out.push(t.slice(start, end).trim());
    start = end;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// Keep sentences up to the budget: always at least ONE sentence (a single over-long sentence has no
// legal boundary to cut at — it stays whole rather than being chopped mid-thought), then add sentences
// while both the sentence cap and the word cap hold.
function partitionAtBudget(sentences, maxSentences, maxWords) {
  const kept = [];
  let wordCount = 0;
  for (const s of sentences) {
    const w = words(s).length;
    if (kept.length === 0) { kept.push(s); wordCount = w; continue; }
    if (kept.length >= maxSentences || wordCount + w > maxWords) break;
    kept.push(s);
    wordCount += w;
  }
  return { kept, overflow: sentences.slice(kept.length) };
}

// Insert a bullet at the head of a "### <heading>" section body (right after the heading line and any
// blank line), creating the section when absent. Returns the new text.
function insertBulletAtSectionHead(text, headingRe, headingLine, bullet, { parentHeadingRe = null, parentHeadingLine = null } = {}) {
  const m = text.match(headingRe);
  if (m) {
    const at = m.index + m[0].length;
    return `${text.slice(0, at)}\n${bullet}\n${text.slice(at).replace(/^\n/, "\n")}`;
  }
  if (parentHeadingRe) {
    const p = text.match(parentHeadingRe);
    if (p) {
      const at = p.index + p[0].length;
      return `${text.slice(0, at)}\n${headingLine}\n\n${bullet}\n${text.slice(at).replace(/^\n/, "\n")}`;
    }
    return `${text.replace(/\s*$/, "")}\n\n${parentHeadingLine}\n\n${headingLine}\n\n${bullet}\n`;
  }
  return `${text.replace(/\s*$/, "")}\n\n${headingLine}\n\n${bullet}\n`;
}

/**
 * Fold ONE card's "### The read" to the level-1 budget (2 sentences / ~120 words, sentence-boundary
 * cut). Overflow moves to the head of "### Full detail" under a "**Continued read:**" bullet — the
 * same card, one drill deeper. Returns { md, fold } — fold is null when nothing moved. PURE.
 */
export function foldCardRead(cardMd, { maxSentences = 2, maxWords = 120 } = {}) {
  const text = String(cardMd ?? "");
  const head = text.match(/^###\s+The read[^\n]*\n/m);
  if (!head) return { md: text, fold: null };
  const bodyStart = head.index + head[0].length;
  const nextHead = text.slice(bodyStart).search(/^#{1,3}\s/m);
  const bodyEnd = nextHead === -1 ? text.length : bodyStart + nextHead;
  const body = text.slice(bodyStart, bodyEnd);
  const sentences = splitSentences(body);
  const { kept, overflow } = partitionAtBudget(sentences, maxSentences, maxWords);
  if (!overflow.length) return { md: text, fold: null };
  const overflowText = overflow.join(" ");
  let md = `${text.slice(0, bodyStart)}\n${kept.join(" ")}\n\n${text.slice(bodyEnd)}`;
  md = insertBulletAtSectionHead(md, /^###\s+Full detail[^\n]*\n/m, "### Full detail",
    `- **Continued read:** ${overflowText}`);
  return { md, fold: { surface: "read", movedSentences: overflow.length, movedWords: words(overflowText).length } };
}

/**
 * Clip the overview's overall_caption at 3 sentences. Overflow moves to the head of the # Actions
 * "### Checks we ran — what we found" bucket ("**Continued summary:**" bullet).
 *
 * — THAT BUCKET NO LONGER FOLDS. This said the overflow lands in "the collapsible Scope section in
 * the frozen render, i.e. level 2"; the checks bucket is now emitted OPEN, beside the Scope fold rather
 * than inside it, so the destination is level 1 — visible at §4 without a click. The clip itself is
 * unchanged, and so is where the sentences go; what changed is that a reader reaches them without
 * opening anything, which is the better answer for text that was cut out of the caption.
 *
 * Returns { md, fold }. PURE.
 */
export function foldCaption(overviewMd, { maxSentences = 3 } = {}) {
  const text = String(overviewMd ?? "");
  const capLine = text.match(/^overall_caption:\s*(.+)$/m);
  if (!capLine) return { md: text, fold: null };
  const sentences = splitSentences(capLine[1]);
  if (sentences.length <= maxSentences) return { md: text, fold: null };
  const kept = sentences.slice(0, maxSentences);
  const overflowText = sentences.slice(maxSentences).join(" ");
  let md = text.replace(capLine[0], () => `overall_caption: ${kept.join(" ")}`);
  md = insertBulletAtSectionHead(md, /^###\s+Checks we ran[^\n]*\n/m, "### Checks we ran — what we found",
    `- **Continued summary:** ${overflowText}`,
    { parentHeadingRe: /^#\s+Actions\b[^\n]*\n/m, parentHeadingLine: "# Actions" });
  return { md, fold: { surface: "caption", movedSentences: sentences.length - maxSentences, movedWords: words(overflowText).length } };
}
