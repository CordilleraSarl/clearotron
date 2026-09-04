// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// write-up-render.mjs — §8: the short entry and the grouped row.
//
// PURE except for `composeCard`, which is itself pure. No IO, no reads.
//
// ── NO NEW AUTHORED PROSE, AND THAT IS THE DESIGN ─────────────────────────────────────────────────
//
// Both forms print the typed `net` the seat already wrote — the same value the reasoned-negatives line
// prints. §8 is explicit: "A form that re-authors a sentence pays a dispatch and saves nothing: that is
// a SHORTER form, not a CHEAPER one." So nothing here calls a model, and the saving is the card dispatch
// these findings no longer buy.
//
// ── THE TERRITORY BINDING, CHOSEN AND STATED ──────────────────────────────────────────────────────
//
// §8 requires the territory field to be bound deliberately, warns that `registryOf` returns an OFFICE
// rather than a country (a Madrid designation's registry is WIPO while its territories are many), and
// rules that a group headed `unknown` is not acceptable.
//
// Bound here to `owner.registrations[].jurisdiction`, through `jurisdictionsOf` — the SAME field
// `cardHead` already prints on every delivered card. A group heading therefore cannot disagree with the
// entries beneath it, which a band-shape join could: that join keys on `mark_text` and would answer for
// the RECORD's registry rather than for what the report already tells the reader.
//
// A finding with no registrations — every common-law finding — has no jurisdiction. It is never placed
// in an `unknown` group: it renders as a SHORT ENTRY, which is what a group of one renders as anyway.
// The unacceptable heading is unreachable rather than special-cased.
import { markDisplay, capFirst } from "./card-frame.mjs";

/** A short entry's own heading. The validators accept exactly this or `### Full detail`, never neither. */
export const SHORT_ENTRY_HEADING = "### In short";

/** The one sentence both forms print. `legal_position` is the archived fallback, never a summary made here. */
export const netOf = (f) => String(f?.net ?? f?.legal_position ?? "").trim();

/** The territories a finding is registered in, as a list. `[]` for a finding holding no registration. */
export const territoriesOf = (f) =>
  [...new Set((f?.owner?.registrations ?? []).map((r) => String(r?.jurisdiction ?? "").trim()).filter(Boolean))];

/** The classes a finding's registrations name, as a sorted list. */
const classesOf = (f) =>
  [...new Set((f?.owner?.registrations ?? []).flatMap((r) => r?.classes ?? []).map(String).filter(Boolean))]
    .sort((a, b) => Number(a) - Number(b));

/**
 * A short entry's BODY — what a seat's `### Full detail` would have been, composed code-side instead.
 *
 * It returns the body ONLY, and that is the integration: `assembleReportMd` composes the frame for every
 * card it assembles, so a short entry gets its head, `- ord:`, `- net:`, `- group:` and `- source:` from
 * the same composer a full card does and the two forms cannot drift. Composing here as well would give
 * the file two heads.
 *
 * §8: "recognisable as intended, never as a truncated full card" — hence its own heading, and no
 * `### Full detail` anywhere in it.
 */
export function shortEntryBody(f) {
  const terr = territoriesOf(f);
  const cls = classesOf(f);
  const facts = [
    terr.length ? `Registered in ${terr.join(", ")}.` : "",
    cls.length ? `Class${cls.length === 1 ? "" : "es"} ${cls.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
  // The net is its own sentence, capitalised, never run on after the facts: the typed `net` is written as
  // a clause and reads as a fragment when it is glued to the end of another one.
  const why = capFirst(netOf(f));
  return [SHORT_ENTRY_HEADING, facts, why].filter(Boolean).join("\n\n");
}

/** One member line, in the grammar `buildReasonedNegativesSection` already ships on both surfaces. */
export function memberLine(f) {
  const who = String(f?.owner?.name ?? "").trim();
  const cls = classesOf(f);
  const why = netOf(f);
  return `- **#${f?.ordinal} ${markDisplay(f?.mark)}**`
    + (who ? ` — ${who}` : "")
    + (cls.length ? ` · ${cls.length === 1 ? "class" : "classes"} ${cls.join(", ")}` : "")
    + (why ? ` · *${why}*` : "");
}

/**
 * Group the entry findings.
 *
 * `byRight` — worldwide. §8: "Worldwide groups by the right, not the country … one row reading 'held in
 * 18 territories' is the better read." A right is one owner's one mark, so that is the key; the
 * territories become the group's own description instead of fragmenting it into single-member groups.
 *
 * Otherwise — multi-country. Grouped by territory, because a named-country reader thinks per country. A
 * finding registered in three territories appears under each: the group answers "what is in my way in
 * France", and omitting it from two of them would answer that question wrongly.
 *
 * Returns `{ groups, singles }`. A group of fewer than two members is NOT a group — §8 sets the minimum
 * at two and renders the remainder as short entries, so `singles` is exactly that remainder.
 */
export function groupEntries(findings, { byRight = false } = {}) {
  const rows = (findings ?? []).filter((f) => f?.ordinal != null);
  const buckets = new Map();
  const place = (key, label, f) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, findings: [] });
    buckets.get(key).findings.push(f);
  };
  for (const f of rows) {
    const terr = territoriesOf(f);
    if (byRight) {
      const owner = String(f?.owner?.name ?? "").trim();
      const mark = String(f?.mark ?? "").trim();
      if (!owner && !mark) continue;                       // nothing to key a right on — falls to singles
      // The label is computed AFTER grouping, from every member: a right's territories are the UNION of
      // its members' territories, and labelling from the first member placed would name one of them and
      // silently drop the rest — which is the whole read this grouping exists to give.
      place(`${owner.toLowerCase()}|${mark.toLowerCase()}`, null, f);
    } else {
      // No jurisdiction ⇒ no group. Never an `unknown` heading; it falls through to a short entry.
      for (const t of terr) place(t.toLowerCase(), t, f);
    }
  }
  const grouped = [...buckets.values()].filter((g) => g.findings.length >= 2).map((g) => {
    if (g.label != null) return g;
    // A by-right group: one MARK, held across its members' territories. "3 marks" would be wrong —
    // that is the count of records, and the point of grouping by the right is that they are one right.
    const f0 = g.findings[0];
    const terr = [...new Set(g.findings.flatMap(territoriesOf))].sort();
    const where = terr.length === 0 ? ""
      : terr.length <= 3 ? `, held in ${terr.join(", ")}`
      : `, held in ${terr.length} territories`;
    return { ...g, label: `${capFirst(f0?.owner?.name)} — ${markDisplay(f0?.mark)}${where}`, oneRight: true };
  });
  const inAGroup = new Set(grouped.flatMap((g) => g.findings.map((f) => f.ordinal)));
  return {
    groups: grouped.sort((a, b) => b.findings.length - a.findings.length || String(a.label).localeCompare(String(b.label))),
    singles: rows.filter((f) => !inAGroup.has(f.ordinal)),
  };
}

/**
 * The grouped section for `report.md` — a SIBLING of the reasoned-negatives section, in the same line
 * grammar, with a different grouping key. §8: the negatives grouping "is not extended and not touched".
 *
 * `None.` when empty, which is the existing zero-is-not-absence rule: a run that grouped and found
 * nothing says so, so a reader never has to guess whether the grouping ran.
 */
export function buildGradedEntriesSection(findings, { byRight = false } = {}) {
  const { groups } = groupEntries(findings, { byRight });
  const head = "# Also on the register";
  if (!groups.length) {
    return `${head}\n\nNone. Every mark this search surfaced is written up individually above — nothing was grouped.`;
  }
  const blocks = groups.map((g) => {
    const n = g.findings.length;
    // A by-right group counts REGISTRATIONS of one mark; a territory group counts distinct marks.
    const count = g.oneRight ? `${n} registration${n === 1 ? "" : "s"}` : `${n} mark${n === 1 ? "" : "s"}`;
    return `**${g.label}** — ${count}.\n` + g.findings.map(memberLine).join("\n");
  });
  return `${head}\n\n${blocks.join("\n\n")}`;
}
