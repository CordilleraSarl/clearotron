// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// whatif-memo.mjs — a supplementary memo over a delivered report's archived evidence.
//
// THE QUESTION THIS ANSWERS. A lawyer holding a finished report asks "what if the Korean application
// were abandoned?" — the most natural question there is about a clearance — and the product's only
// answer was "closed runs are read-only; commission a fresh Korean search". Both halves were true, and
// the gap between them is this document.
//
// WHAT A MEMO IS, AND WHAT IT REFUSES TO BECOME. It reads the archived findings and records, applies a
// stated assumption, and says what changes. It dispatches no search, recomputes no stage and rates
// nothing anew. It is a CHILD document that names its parent, and it is never a report: a reader who
// mistakes it for one has been handed a second verdict nobody produced.
//
// THE HARD RULE, AND IT IS LOAD-BEARING. The delivered report and its archive are never modified. This
// module composes text and returns it; it writes nothing, so there is no path from here to the parent's
// artifacts even in error. That is not a courtesy to the client — immutability of a delivered record is
// what makes the memo safe to offer at all, and the feature exists so nobody is ever tempted to relax it.
//
// The distinction it inherits is the one the sibling issue settled: the parent's ARTIFACTS are untouched,
// and the run records that a question was asked of it. Those are different claims and only the first is
// absolute.

/** The line that keeps a memo from being read as a second report. Rendered first, always. */
export const MEMO_BANNER =
  "SUPPLEMENTARY MEMO — not a clearance report, and not an update to one. It reasons over the evidence "
  + "already gathered for the report it names below, under an assumption you supplied. No new searching "
  + "was carried out for it, and the report it derives from is unchanged.";

/** Everything a memo must carry before it may be handed to anyone. */
export const REQUIRED = Object.freeze(["assumption", "parentRunId", "parentReport", "date", "body"]);

/**
 * Compose the memo, or refuse and say what is missing.
 *
 * REFUSES RATHER THAN DEGRADES. A memo missing its assumption is a document whose reader cannot tell
 * what was assumed; one missing its parent is an orphan opinion about a report nobody can identify.
 * Both are worse than no memo, so this returns `{ ok: false, missing }` and composes nothing — the
 * caller reports the refusal, exactly as the plan path reports one.
 *
 * `limits` is where honesty about the assumption lives: what it cannot settle without fresh searching,
 * each with the SMALLEST search that would settle it. An empty list is allowed and means "nothing here
 * needs new evidence" — it is a claim, and `limitsStated` records which claim was made rather than
 * leaving a reader to infer it from silence.
 */
export function composeMemo({ assumption, parentRunId, parentReport, date, body, limits = [], mark = null } = {}) {
  const missing = REQUIRED.filter((k) => !String({ assumption, parentRunId, parentReport, date, body }[k] ?? "").trim());
  if (missing.length) return { ok: false, missing, reason: `a memo cannot be composed without: ${missing.join(", ")}` };

  const limitLines = limits
    .map((l) => ({ cannot: String(l?.cannot ?? "").trim(), smallestSearch: String(l?.smallestSearch ?? "").trim() }))
    .filter((l) => l.cannot);
  // A limit with no named search is half an answer: it tells the reader they need more without telling
  // them what to buy. The composer will not silently drop it, and will not silently accept it either.
  const unnamed = limitLines.filter((l) => !l.smallestSearch);
  if (unnamed.length)
    return { ok: false, missing: ["limits[].smallestSearch"],
      reason: `each stated limit must name the smallest search that would settle it — missing for: ${unnamed.map((l) => l.cannot.slice(0, 60)).join("; ")}` };

  const text = [
    MEMO_BANNER,
    "",
    `# Supplementary memo${mark ? ` — ${mark}` : ""}`,
    "",
    `**Date:** ${date}`,
    `**Derived from:** ${parentReport} (run ${parentRunId})`,
    "",
    "## The assumption you asked me to apply",
    "",
    `> ${String(assumption).trim().replace(/\n/g, "\n> ")}`,
    "",
    "## What changes under it",
    "",
    String(body).trim(),
    "",
    "## What this assumption cannot settle",
    "",
    limitLines.length
      ? limitLines.map((l) => `- ${l.cannot}\n  - The smallest search that would settle it: ${l.smallestSearch}`).join("\n")
      : "Nothing here rests on evidence this report did not already gather. The assumption was applied to "
        + "what was already found, and no part of the answer above is waiting on a search.",
    "",
  ].join("\n");

  return { ok: true, text, limitsStated: limitLines.length, banner: MEMO_BANNER };
}
