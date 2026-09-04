// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-carry.mjs — the placement→digest CARRY join: every placed candidate ends somewhere a
// reader can see, and the ones that do not are COUNTED BY NAME.
//
// THE DEFECT. `placements.json` is a declared input of `register-digest` (stages.mjs), and the digest
// is told to adopt or counter-reason EVERY entry (digest.md "Consume placement-recommendations.md":
// adopt the graduated outcome, or override "never silently", writing the counter-reasoning as a
// `### Disagreement resolutions` row). The driver reads that file in exactly three places and none of
// them is that join:
//   pipeline.mjs      — counts `borderline:true` entries for one run.jsonl row;
//   predelivery-lint  — flags an EMPTY placements.json;
//   verify.mjs        — validates the sibling's schema.
// So a placed candidate the digest simply never mentions leaves ZERO trace. Four sandboxed arms over
// one band produced watchlist-annex sets of 7, 7, 6 and **0** — one arm in four dropped the whole set,
// and nothing anywhere recorded that it had.
//
// WHY THE EXISTING JOINS CANNOT CATCH IT. Every carry gate in this driver keys on a `/mark` URI:
// recall-reconciliation's parseFindingsEndings, presence-reconciliation's parseRatedRows (`if
// (!uris.length) continue`), band-shape's dominantElementComposites (band records only). A common-law
// candidate carries `records: []` by contract (stages.mjs dictates it), so it has no URI, is in no
// band, and is invisible to all three. That is exactly the class of entity the arms lost — company-shaped
// names that only ever existed as a placement.
//
// WHAT THIS MODULE DOES NOT DO. It never decides a TIER. headline-candidate vs sheet-2 is stated as a
// judgment question in the digest's own dispatch ("does this conflict change the advice, or only
// complete the record?") and puts tier assignment out of scope. This join asks one mechanical
// question per placed candidate — did it reach a reader at all — and answers it in exactly one of five
// classes. Which surface it reached is recorded as DATA, never enforced.
//
// NORTH STAR — annotate, never gate (presence-reconciliation.mjs's rule). The digest's drop stands.
// This module records the QUESTION: the artifact counts it, the run.jsonl row asserts it, and every
// unanswered entry mints a doubt into the existing stitch → doubt-closure → `# Doubt Ledger` chain.
//
// ZERO SEMANTICS (provider-usage.mjs's `unclassified` shape, and the reason it exists). A record that
// matches no criterion must be VISIBLE with a count, never absorbed into a total. So there are two
// distinct not-carried answers and they are never merged: `uncarried` = joined and genuinely absent (a
// loss), `unclassified` = the entry offers no join key that clears the distinctiveness floor, so this
// module cannot decide either way (a limit of the join, not a claim about the candidate). Reading
// `unclassified` as carried would rebuild the silent drop one level up.
//
// PURE (no node imports) like recall-reconciliation.mjs / presence-reconciliation.mjs — the pipeline
// owns all IO, events and enforcement. Join primitives are IMPORTED, never re-implemented: urisIn from
// presence-reconciliation.mjs and normalizeJoinText / hasToken / distinct from doubt-ledger.mjs. A
// local copy of a matcher is how two matchers drift apart.

import { urisIn } from "./presence-reconciliation.mjs";
import { normalizeJoinText, hasToken, distinct } from "./doubt-ledger.mjs";
import { normalizeRecordUri } from "./registry-fidelity.mjs";

export const PLACEMENT_CARRY_SCHEMA_VERSION = 1;

/** The five carry classes. EXACTLY ONE per placed candidate, decided in the fixed order below. */
export const CARRY_CLASSES = ["carried", "reasoned-negative", "adjudicated", "uncarried", "unclassified"];

// ── the three surfaces of register-findings.md ────────────────────────────────────────────────────
// The section walk mirrors recall-reconciliation.mjs / screen-gate.mjs: a heading switches the bucket,
// everything under it belongs to that bucket. Only two headings are special; every other section —
// the findings tables, the watchlist annex, out-of-scope, the coverage ledger, the audit trail — is a
// surface a reader can see, which is the only property this join tests.
const NEGATIVE_HEADING_RE = /negative results?/i;
const ADJUDICATION_HEADING_RE = /disagreement resolutions?/i;

const isSepRow = (t) => /^\|[\s:|-]+\|$/.test(t);

/**
 * Split register-findings.md into the three carry surfaces. Per surface: `uris` = every canonical
 * `/mark` uri in the section, `lines` = every content line ({section, line}), table separators and
 * blanks dropped.
 *
 * BOTH reach every line of the section, prose included, and that is deliberate. The first cut held
 * the text path to pipe-TABLE rows only, on the theory that digest.md puts carried candidates in
 * tables. Run against the real 2026-07-29 findings it manufactured a loss: the watchlist annex there
 * is written as `- **W-1 · TIKI Brand outdoor-living portfolio — …**` bullets, so a candidate the
 * digest had plainly carried came back `uncarried`. A join that invents losses is worth nothing, and
 * the section shape is the digest's to choose. So the reach is the same as parseFindingsEndings
 * (recall-reconciliation.mjs), which has always counted a prose mention as an ending — one
 * convention, not two. Precision on the text path comes from the distinctiveness floor instead, and
 * the matched line is recorded on every row so a reader can see what the join saw. PURE.
 */
export function parseCarrySurfaces(registerFindingsText) {
  const uris = { carried: new Set(), "reasoned-negative": new Set(), adjudicated: new Set() };
  const lines = { carried: [], "reasoned-negative": [], adjudicated: [] };
  let bucket = "carried";
  let section = "(preamble)";
  for (const raw of String(registerFindingsText ?? "").split("\n")) {
    const h = raw.match(/^#{1,6}\s+(.*)/);
    if (h) {
      section = h[1].trim();
      bucket = NEGATIVE_HEADING_RE.test(section) ? "reasoned-negative"
        : ADJUDICATION_HEADING_RE.test(section) ? "adjudicated"
          : "carried";
      continue;
    }
    for (const u of urisIn(raw)) uris[bucket].add(u);
    const t = raw.trim();
    if (t && !isSepRow(t)) lines[bucket].push({ section, line: t });
  }
  return { uris, lines };
}

// ── the per-entry classification ──────────────────────────────────────────────────────────────────
// Precedence between the three ENDED classes is fixed so "exactly one" holds, and it is the SAME
// order recall-reconciliation.mjs uses: an explicit negative is reported first, so a candidate the
// digest dropped reads as dropped even where its name also appears elsewhere. One convention across
// both joins, not two.
//
// The first cut put `carried` first, on the argument that a findings-surface appearance is the fuller
// answer. Measured on the real 2026-07-29 findings that made `reasoned_negative` read 0 on a file
// carrying real drop rows for three watchlist owners — their names also sit in a Cross-checks table
// row, which the bucket scan reaches first. A count that says "no negatives" about a file full of
// them is worse than useless to a reader comparing runs, so the order went back to the precedent.
// Either way the `uncarried` count — the number this join exists to produce — is identical.
const ENDED_ORDER = ["reasoned-negative", "carried", "adjudicated"];

/** The canonical, deduped `/mark` uris an entry's `records[]` names. PURE. */
export function entryUris(entry) {
  const out = new Set();
  for (const r of Array.isArray(entry?.records) ? entry.records : []) {
    const u = normalizeRecordUri(r);
    if (u) out.add(String(u).toLowerCase());
  }
  return [...out];
}

/**
 * The join terms that clear the distinctiveness floor, mark first then owner. Takes anything with
 * `{mark, owner}` — a placements.json entry (classifyPlacement, which uses `terms[0]` as the join key
 * and keeps the owner as corroboration) or an artifact row (mintPlacementCarryDoubts, which puts them
 * in `subject.terms` for the doubt stitch to match on). Both shapes carry both fields; this is stated
 * because the two call sites pass different objects and that is easy to break by accident. PURE.
 */
export function entryTerms(entry) {
  return [entry?.mark, entry?.owner]
    .map((s) => String(s ?? "").trim())
    .filter((s) => s && distinct(normalizeJoinText(s)));
}

/**
 * Classify ONE placed candidate against the parsed surfaces. Returns
 * `{class, section, ended_by, basis, owner_confirmed}`.
 *
 * Fixed order, so the answer is a function of the inputs and nothing else:
 *   1. the entry names record uris ⇒ decide on URI equality alone (both sides canonical — the
 *      recall-regression lesson: canonicalizing one side makes a full-URL row unjoinable forever);
 *   2. no uris (a common-law-shaped candidate) ⇒ decide on the entry's MARK, floor-guarded, against
 *      the section's content lines. The owner is recorded as corroboration (`owner_confirmed`), never
 *      required: the digest re-words owner names and demanding both would manufacture losses;
 *   3. no uris and no floor-passing term ⇒ `unclassified`. Never guessed in either direction.
 * PURE.
 */
export function classifyPlacement(entry, surfaces) {
  const uris = entryUris(entry);
  if (uris.length) {
    for (const cls of ENDED_ORDER) {
      const hit = uris.find((u) => surfaces.uris[cls].has(u));
      if (hit) return { class: cls, section: null, ended_by: hit, basis: "record-uri", owner_confirmed: null };
    }
    return { class: "uncarried", section: null, ended_by: null, basis: "record-uri", owner_confirmed: null };
  }
  const terms = entryTerms(entry);
  if (!terms.length) {
    return { class: "unclassified", section: null, ended_by: null, basis: "no-join-key", owner_confirmed: null };
  }
  const mark = terms[0];
  const owner = String(entry?.owner ?? "").trim();
  for (const cls of ENDED_ORDER) {
    for (const r of surfaces.lines[cls]) {
      if (!hasToken(r.line, mark)) continue;
      const ownerConfirmed = !!owner && distinct(normalizeJoinText(owner)) ? hasToken(r.line, owner) : null;
      return { class: cls, section: r.section, ended_by: r.line, basis: "mark-token", owner_confirmed: ownerConfirmed };
    }
  }
  return { class: "uncarried", section: null, ended_by: null, basis: "mark-token", owner_confirmed: null };
}

// ── — THE BORDERLINE ENTRY'S OWN QUESTION, ASKED OF THE ADJUDICATION SURFACE ALONE ─────────
//
// `borderline: true` is placement's UNDECIDED marker — the seat declaring that its own tier call could
// be argued either way. `digest.md` makes the answer mandatory: one row per borderline entry in a
// `### Disagreement resolutions` row, "each EXPLICITLY resolved … never silently carried and never
// left as a shrug".
//
// Both halves of that check already existed and NOTHING JOINED THEM. The count reaches run.jsonl as
// `placement-borderline {count, marks}` and is never compared to anything; `findUnresolvedDisagreements`
// (reasoning-tripwires.mjs) reads the rows that ARE present, so an entry with no row has nothing to trip
// on. A digest that silently drops one produces `count:4`, a well-formed table with three rows, a silent
// tripwire, a clean lint and a valid schema — a complete-looking audit trail with the obligation absent.
//
// ── WHY THIS CANNOT READ `class === "adjudicated"`, WHICH IS THE WHOLE DEFECT ────────────────────
//
// `ENDED_ORDER` is first-hit and `carried` precedes `adjudicated`. So a borderline entry whose mark
// appears in ANY ordinary findings section classifies `carried`, and its adjudication obligation is
// never asked — the classification is not wrong, it is answering a different question. That order is
// deliberate and measured (see ENDED_ORDER's own note: putting `carried` first made `reasoned_negative`
// read 0 on a file full of real drop rows), so it does not move. This asks the adjudication surface
// DIRECTLY instead, which is the join the issue describes and the one nothing was performing.
//
// SAME JOIN KEYS as `classifyPlacement`, in the same order — record URI, else mark token — because two
// derivations of "does this line name this entry" is exactly the drift this module exists to end. PURE.
export function adjudicationOf(entry, surfaces) {
  const uris = entryUris(entry);
  const terms = entryTerms(entry);
  // URI FIRST — the strongest key when the row carries one.
  const uriHit = uris.find((u) => surfaces.uris.adjudicated.has(u));
  if (uriHit) return { adjudicated: true, by: uriHit, basis: "record-uri" };

  // ── THEN THE MARK TOKEN, AND FALLING THROUGH TO IT IS THE WHOLE CORRECTION ───────────────────────
  //
  // `classifyPlacement` returns early on the URI branch: if an entry names URIs and none is on a
  // surface, it is uncarried and the token branch is never reached. Copying that shape here was WRONG,
  // and a real delivered artifact caught it.
  //
  // The carry surfaces are record tables — rows that carry `/mark/...` URIs. `### Disagreement
  // resolutions` is PROSE: a human-written adjudication that names the MARK and argues about it.
  // Measured on `placement-carry-2026-07-29`, whose delivered digest discharges its one borderline
  // entry in as many words —
  //
  //     | R-8 (my override) — placement-inquiry placed `TIKI LOVERS` at sheet-2 (S2-C) while flagging
  //       it as a borderline headline call | OVERRODE — promoted to headline. …
  //
  // — and names no URI anywhere in that row. A URI-only branch reports that discharged obligation as
  // unanswered, which is a false positive against a digest that did exactly what doctrine asks. So an
  // entry is adjudicated if EITHER key finds it, and only a miss on both is a miss.
  const mark = terms[0];
  if (mark) {
    for (const r of surfaces.lines.adjudicated) {
      if (hasToken(r.line, mark)) return { adjudicated: true, by: r.line, basis: "mark-token" };
    }
  }
  // NO JOIN KEY IS NOT AN ANSWER. An entry naming no URI and no distinctive term cannot be looked for,
  // and reporting that as "unadjudicated" would blame the digest for this module's blindness — the same
  // distinction `unclassified` already keeps apart from `uncarried`.
  if (!uris.length && !mark) return { adjudicated: null, by: null, basis: "no-join-key" };
  return { adjudicated: false, by: null, basis: uris.length && mark ? "record-uri+mark-token" : (uris.length ? "record-uri" : "mark-token") };
}

// ── the artifact ──────────────────────────────────────────────────────────────────────────────────

const clip = (s, n = 240) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const emptyTotals = () => {
  const t = { placements: 0 };
  for (const c of CARRY_CLASSES) t[c.replace(/-/g, "_")] = 0;
  // — NOT members of CARRY_CLASSES, deliberately: an entry is borderline AND carried/uncarried,
  // never borderline INSTEAD of one. Folding it into the class enum would make "exactly one class"
  // false and would hide the very entries this counts, since most of them classify `carried`.
  t.borderline = 0;
  t.unadjudicated_borderline = 0;
  return t;
};

/**
 * THE JOIN. `placements` = parsePlacementsJson(...).placements (or the same shape); the text is
 * register-findings.md. Every entry lands in exactly one class, and the per-TIER breakdown is carried
 * because that is where this defect is legible: "of 7 watchlist-annex placements, 7 uncarried" is the
 * arm-d failure stated as a number, and a per-run total alone would hide it.
 *
 * Deterministic; no timestamps (the caller stamps `ts`), no IO, no judgment. PURE.
 */
export function reconcilePlacementCarry({ placements = [], registerFindingsText = "" } = {}) {
  const surfaces = parseCarrySurfaces(registerFindingsText);
  const totals = emptyTotals();
  const byTier = {};
  const rows = [];
  for (const e of Array.isArray(placements) ? placements : []) {
    const c = classifyPlacement(e, surfaces);
    const tier = String(e?.tier ?? "(untiered)");
    totals.placements++;
    totals[c.class.replace(/-/g, "_")]++;
    const bt = (byTier[tier] ??= emptyTotals());
    bt.placements++;
    bt[c.class.replace(/-/g, "_")]++;
    // — asked ONLY of entries that declared themselves borderline. A non-borderline placement
    // owes no Disagreement-resolutions row, so asking would manufacture a finding.
    const borderline = e?.borderline === true;
    const adj = borderline ? adjudicationOf(e, surfaces) : null;
    if (borderline) {
      totals.borderline++; bt.borderline++;
      if (adj.adjudicated === false) { totals.unadjudicated_borderline++; bt.unadjudicated_borderline++; }
    }
    rows.push({
      mark: String(e?.mark ?? ""), owner: String(e?.owner ?? ""),
      jurisdiction: String(e?.jurisdiction ?? ""), tier,
      records: entryUris(e),
      borderline,
      class: c.class, basis: c.basis, section: c.section,
      ended_by: c.ended_by ? clip(c.ended_by) : null,
      owner_confirmed: c.owner_confirmed,
      // Three-valued and only ever present on a borderline row: true (a row names it), false (none
      // does), null (no join key — this module cannot say). `undefined` on a row that owes nothing.
      adjudicated: borderline ? adj.adjudicated : undefined,
      adjudicated_by: borderline && adj.by ? clip(adj.by) : (borderline ? null : undefined),
      adjudication_basis: borderline ? adj.basis : undefined,
    });
  }
  return {
    schema_version: PLACEMENT_CARRY_SCHEMA_VERSION,
    computable: true,
    unit: "placement",
    totals,
    by_tier: byTier,
    // the two not-ended lists, kept APART on purpose (see the zero-semantics note in the header)
    uncarried: rows.filter((r) => r.class === "uncarried"),
    unclassified: rows.filter((r) => r.class === "unclassified"),
    // — BY NAME, which is the issue's own requirement: a count told the reader four entries were
    // borderline and never which one went unanswered. `adjudicated === false` only — a null (no join
    // key) is this module's blindness and belongs with `unclassified`, not on the digest's account.
    unadjudicated_borderline: rows.filter((r) => r.borderline && r.adjudicated === false),
    rows,
  };
}

// ── the run.jsonl row ─────────────────────────────────────────────────────────────────────────────
// AD-4 house rule: every field is written on EVERY row, so "the join found nothing uncarried"
// (uncarried:0) and "the join could not run" (uncarried:null) differ by VALUE, never by field presence.
export const PLACEMENT_CARRY_EVENT_FIELDS = ["placements", "carried", "reasoned_negative",
  // — `borderline` is how many DECLARED themselves undecided; `unadjudicated_borderline` is how
  // many of those no Disagreement-resolutions row answers. Both ride the AD-4 rule above: written on
  // every row, so "none unanswered" (0) and "the join could not run" (null) differ by value.
  "adjudicated", "uncarried", "unclassified", "borderline", "unadjudicated_borderline"];

export function placementCarryEvent({ trigger = null, artifact = null, reason = null } = {}) {
  const computable = artifact?.computable === true;
  const vals = computable ? artifact.totals : {};
  const row = { event: "placement-carry", trigger, computable, reason };
  for (const k of PLACEMENT_CARRY_EVENT_FIELDS) row[k] = vals[k] ?? null;
  return row;
}

// ── the mint ──────────────────────────────────────────────────────────────────────────────────────
/**
 * One doubt per entry this join could not answer — both classes, minted with distinct ids so the two
 * facts stay apart in the ledger: `doubt:placement-carry:uncarried:N` (placed, joined, absent from
 * every surface) and `doubt:placement-carry:unclassified:N` (no join key — this module cannot say).
 * The frozen doubt-record shape, status "open"; stitchDoubts and the doubt-closure stage decide
 * endings exactly as for every other doubt family, and an OPEN one shipping in the `# Doubt Ledger`
 * is the system working. Never gates, never re-tiers. PURE.
 */
export function mintPlacementCarryDoubts(artifact, { sourceName = "placements.json" } = {}) {
  const doubts = [];
  // — a THIRD id family, kept distinct for the same reason the first two are: a placement the
  // digest never carried and a placement it carried but never adjudicated are different failures with
  // different remedies, and one id family would make them one row in the ledger.
  //
  // ANNOTATE, NEVER GATE — placement-carry's own north star, and the issue names it. A borderline entry
  // nobody resolved is a disclosure the next seat and the auditor are owed; it is not grounds to
  // withhold a report, and nothing here re-tiers or refuses.
  for (const cls of ["uncarried", "unclassified", "unadjudicated_borderline"]) {
    const list = Array.isArray(artifact?.[cls]) ? artifact[cls] : [];
    list.forEach((r, i) => {
      const terms = entryTerms(r);
      doubts.push({
        id: `doubt:placement-carry:${cls.replace(/_/g, "-")}:${i + 1}`,
        birth: {
          place: "placement-carry",
          artifact: String(sourceName ?? ""),
          quote: clip(`${r.tier}: ${r.mark}${r.owner ? ` — ${r.owner}` : ""}${r.jurisdiction ? ` (${r.jurisdiction})` : ""}`),
        },
        subject: {
          mark: r.mark, owner: r.owner, uris: r.records ?? [], terms,
          // — THE KEY, WHICH THIS MINT ALREADY HELD AND SPENT ON PROSE. Every branch below
          // interpolates `r.tier` into the doubt's own text, so the tier was never missing — it was
          // only unreadable by code. Written down, doubt-closure selection can key on it without a
          // `placements.json` lookup, and without the mark+owner matcher that key would otherwise need.
          //
          // `(untiered)` is carried through UNCHANGED rather than folded to null: it is this file's own
          // sentinel for an entry that declared no tier (reconcilePlacementCarry, `String(e?.tier ??
          // "(untiered)")`), and a second name for the same absence is how two readers come to disagree.
          // doubt-selection.mjs treats it as keyless, which is what it is.
          placementTier: r.tier ?? null,
          text: cls === "uncarried"
            ? `placement-inquiry placed this candidate at ${r.tier}; the register digest neither carried it to a findings surface, nor wrote it a Negative-results drop row, nor resolved it in a Disagreement-resolutions row`
            : cls === "unclassified"
              ? `placement-inquiry placed this candidate at ${r.tier}; it names no record URI and its mark clears no distinctiveness floor, so the carry join cannot tell whether the digest carried it`
              : `placement-inquiry declared its own ${r.tier} call BORDERLINE on this candidate — the tier could be argued either way — and no \`### Disagreement resolutions\` row names it. The digest's own doctrine requires each borderline entry to be explicitly resolved there, never silently carried and never left as a shrug${r.class === "carried" ? `; it does appear on an ordinary findings surface, which is why the carry join reads \`carried\` and does not ask this question` : ""}`,
        },
        status: "open",
        ending: null,
      });
    });
  }
  return doubts;
}
