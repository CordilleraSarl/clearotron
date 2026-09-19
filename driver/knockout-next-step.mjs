// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// knockout-next-step.mjs — a next-step section the assessing model wrote into a name's read comes off
// before the report is published.
//
// A knockout states findings and a rating; what to do with the name is the reading lawyer's. The assessing
// instructions stopped asking for a next step, and the model still writes one now and then, under a heading
// of its own: "What to do with it", "Practical next step". Refusing the turn and re-asking cost a full
// re-dispatch each time, and the owner ruled for delivery over the loop (2026-09-19). So the section is
// removed here, in code, with no model call, and the run record names every heading removed.
//
// WHAT COMES OFF: a heading whose own words are a next step, and the section under it — nothing else. A
// hashed heading's section runs to the next heading at its level or above; a line that is only bold text
// runs to the next heading of either kind; a bold label opening a paragraph ("**Practical next step** —
// …") takes that paragraph. Position does not matter: removing a section cannot reorder what is left.
//
// WHAT STAYS, BY DESIGN: the same advice written as an ordinary sentence with no heading over it. Nothing
// bounds that sentence but judgement, and cutting a guess out of the client's read is worse than leaving
// it. The instruction not to write one is the only thing that reaches it.

// A heading's own words that make it a next step. Whole-heading: "What drives the rating" and "What is
// still open" are not next steps, and a word appearing somewhere inside a heading proves nothing.
export const NEXT_STEP_HEADING_RE =
  /^(?:(?:practical|immediate|suggested|recommended|possible)\s+)?(?:next\s+steps?\b.*|what\s+to\s+do\b.*|what\s+happens\s+next|recommendations?\b.*|our\s+recommendations?\b.*|(?:the\s+)?way\s+forward)$/i;

const label = (s) => String(s).replace(/[*_`]/g, "").replace(/[\s:.–—-]+$/, "").trim();

/** What kind of heading this line is, and its words — or null for a line that heads nothing. PURE. */
function headingAt(line) {
  const atx = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  if (atx) return { kind: "atx", level: atx[1].length, text: label(atx[2]) };
  const bold = /^\s*(\*\*|__)(.+?)\1\s*:?\s*$/.exec(line);
  if (bold) return { kind: "bold", text: label(bold[2]) };
  const lead = /^\s*(\*\*|__)(.+?)\1\s*[:.–—-]?\s+\S/.exec(line);
  if (lead) return { kind: "lead", text: label(lead[2]) };
  return null;
}

/** Is this whole line a heading over a next step? PURE. */
export function isNextStepHeading(line) {
  const h = headingAt(String(line ?? ""));
  return Boolean(h && NEXT_STEP_HEADING_RE.test(h.text));
}

/**
 * The text with every next-step section removed, and what was removed: `{ text, removed: [{ heading,
 * chars }] }`. Text with nothing to remove comes back byte-identical. PURE.
 */
export function stripNextStepSections(text) {
  const src = String(text ?? "");
  const lines = src.split("\n");
  const keep = [];
  const removed = [];
  for (let i = 0; i < lines.length;) {
    const h = headingAt(lines[i]);
    if (!h || !NEXT_STEP_HEADING_RE.test(h.text)) { keep.push(lines[i]); i++; continue; }
    let j = i + 1;
    if (h.kind === "lead") {
      while (j < lines.length && lines[j].trim() !== "") j++;
    } else {
      for (; j < lines.length; j++) {
        const n = headingAt(lines[j]);
        if (!n || n.kind === "lead") continue;
        if (h.kind === "atx" ? n.kind === "atx" && n.level <= h.level : true) break;
      }
    }
    removed.push({ heading: h.text, chars: lines.slice(i, j).join("\n").trim().length });
    i = j;
  }
  if (!removed.length) return { text: src, removed };
  return { text: keep.join("\n").replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n").trim(), removed };
}
