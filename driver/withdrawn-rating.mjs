// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RIGHT WHOSE RATING WAS WITHDRAWN STAYS ON THE PAGE, AS LEFT OPEN. The review can withdraw a finding whose right
// still stands, because the rating it carried cannot be supported: its goods wording could not be used. Such a
// finding keeps `disposition: "withdrawn"`, so no card, total, logo or summary counts it as rated, and it says so with
// `rating_withdrawn_ground` (findings-model.mjs RATING_WITHDRAWN_GROUNDS). Before that field, the right left the
// delivered page with the findings the review rejected, and the overview's optional Methodology note was the only
// place a writer could still mention it, a note the page does not show.
//
// Here each such finding becomes one "Open item" coverage row, written by code the way the native-script rows are:
// the finding as the report names it, and the approved sentence for its ground. The row reaches every surface that
// reads `coverage[]`. A finding the review rejected (no ground) writes nothing, as before.
//
// THE SENTENCE IS THE OWNER'S. A ground with no approved sentence writes no row: the reader is never shown words
// nobody approved, and the finding stays where it was.
import { existsSync, readFileSync } from "node:fs";
import { parseFindingsJson, RATING_WITHDRAWN_GROUNDS } from "./findings-model.mjs";
import { writeFindings } from "./stage-freshness.mjs";
import { runLog } from "./log.mjs";
import { COVERAGE_ROW_NOT_ADDED } from "./degraded-parts.mjs";

/** The sentence each ground's row carries, once approved; null until then, and a null ground writes no row. */
export const WITHDRAWN_RATING_NOTES = Object.freeze(Object.fromEntries(RATING_WITHDRAWN_GROUNDS.map((g) => [g, null])));

/** The finding as the report names one: its mark, its owner and the territories of its registrations. PURE. */
export function withdrawnRatingArea(f) {
  const mark = String(f?.mark ?? "").trim();
  const owner = String(f?.owner?.name ?? "").trim();
  const where = [...new Set((f?.owner?.registrations ?? []).map((r) => String(r?.jurisdiction ?? "").trim()).filter(Boolean))];
  return `${mark}${owner ? ` — ${owner}` : ""}${where.length ? ` (${where.join(", ")})` : ""}`;
}

/**
 * The Left open rows a findings record owes for its withdrawn ratings, one per finding, in ordinal order. PURE.
 * @param {object} doc  the findings record
 * @param {Record<string, string|null>} [notes]  each ground's approved sentence
 * @returns {{area: string, state: "open", note: string}[]}
 */
export function withdrawnRatingRows(doc, notes = WITHDRAWN_RATING_NOTES) {
  return (Array.isArray(doc?.findings) ? doc.findings : [])
    .filter((f) => f?.disposition === "withdrawn" && typeof notes[f?.rating_withdrawn_ground] === "string"
      && notes[f.rating_withdrawn_ground].trim() && String(f?.mark ?? "").trim())
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
    .map((f) => ({ area: withdrawnRatingArea(f), state: "open", note: notes[f.rating_withdrawn_ground] }));
}

/**
 * Writes the rows `withdrawnRatingRows` owes into findings.json. Idempotent by area and note, so a resume or a second
 * pass after a findings rewrite never doubles a row. Never throws: a failure is noted and recorded for the audit, as
 * every coverage adder's is, and the run goes on.
 */
export function injectWithdrawnRatingCoverage(P, runDir, note, { notes = WITHDRAWN_RATING_NOTES } = {}) {
  try {
    if (!existsSync(P.findings)) return;
    const doc = JSON.parse(readFileSync(P.findings, "utf8"));
    if (!Array.isArray(doc.coverage)) doc.coverage = [];
    const owed = withdrawnRatingRows(doc, notes)
      .filter((r) => !doc.coverage.some((c) => String(c?.area ?? "") === r.area && String(c?.note ?? "") === r.note));
    if (!owed.length) return;
    doc.coverage.push(...owed);
    parseFindingsJson(JSON.stringify(doc));                    // re-validate the shape (throws → catch keeps original)
    writeFindings(runDir, doc, { why: "withdrawn-rating-coverage-rows", settles: [] });
    note(`[withdrawn-rating] wrote ${owed.length} Left open row(s) for right(s) that stand with their rating withdrawn`);
  } catch (e) {
    const fail = String(e?.message || e).replace(/\s+/g, " ");
    note(`[withdrawn-rating] coverage injection skipped: ${fail.slice(0, 100)}`);
    try { runLog(runDir, { event: COVERAGE_ROW_NOT_ADDED, adder: "withdrawn-rating", fail: fail.slice(0, 200) }); }
    catch { /* the note above still stands */ }
  }
}
