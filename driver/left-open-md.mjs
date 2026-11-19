// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// "LEFT OPEN" IN THE DELIVERED MARKDOWN. The page lists what a search left open; the report's Markdown, which the
// connector serves when a reader's assistant asks for the report, listed none of it. So a limitation the page shows, an
// earlier right that could not be rated or a script no search completed in, reached an assistant only through a second
// tool it had to know to ask for (design, 2026-11-19).
//
// THE PAGE'S ROWS, IN THE PAGE'S WORDS. The rows are the ones the page draws (publish/left-open.mjs leftOpenRows), and
// this prints them as the page does: its heading, the state words with their counts in the page's order, and each row's
// area and note. Where the assessment did not complete, rows that share a note print it once, as the page does. A row
// whose note the Markdown already states is not repeated, and a run with nothing open gets no heading at all.
//
// WRITTEN WHEN report.md IS ASSEMBLED, so a stored report keeps the text it was delivered with.
import { REPORT_PAGE as R } from "./publish/strings.mjs";
import { readerRowHead } from "./coverage-ledger.mjs";

// The page's state order and its fallback: a state it does not know reads as a note.
const STATES = Object.keys(R.coverageStates);
const stateOf = (r) => (Object.hasOwn(R.coverageStates, r?.state) ? r.state : "note");
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// A note this long that the Markdown already holds word for word is already said; a short one may be a phrase.
const SAID_AT = 40;

/**
 * The "Left open" section for report.md, or "" when nothing is open. `rows` are the page's rows ({area, state, note});
 * `verdict` false is a report whose assessment did not complete; `already` is the Markdown the section joins. PURE.
 */
export function leftOpenMarkdown(rows, { verdict = true, already = "" } = {}) {
  const seen = new Set();
  const open = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r || r.state === "confirmed-clean") return false;
    const note = String(r.note ?? "").trim();
    if (note.length >= SAID_AT && String(already).includes(note)) return false;
    const key = `${stateOf(r)}\u0000${r.area ?? ""}\u0000${note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!open.length) return "";
  const head = (r) => `**${cap(readerRowHead(r.area))}**`;
  const out = [`# ${R.searched.leftOpen}`, ""];
  for (const state of STATES) {
    const rows = open.filter((r) => stateOf(r) === state);
    if (!rows.length) continue;
    out.push(`**${R.coverageStates[state]} (${rows.length})**`, "");
    if (verdict) {
      for (const r of rows) out.push(`- ${head(r)}${String(r.note ?? "").trim() ? `: ${String(r.note).trim()}` : ""}`);
    } else {
      const byNote = new Map();
      for (const r of rows) { const k = String(r.note ?? "").trim(); byNote.set(k, [...(byNote.get(k) ?? []), r]); }
      for (const [note, same] of byNote) {
        if (same.length < 2) { out.push(`- ${head(same[0])}${note ? `: ${note}` : ""}`); continue; }
        out.push(`- ${cap(note)}`, ...same.map((r) => `  - ${cap(readerRowHead(r.area))}`));
      }
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
