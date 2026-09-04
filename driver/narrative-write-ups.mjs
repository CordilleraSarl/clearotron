// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// narrative-write-ups.mjs — the delivered narrative, read back against the rules the seat was given.
//
//. The depth ladder tells the synthesis seat which findings earn a prose write-up and how long
// each may run. Instruction-only has now failed twice on this engine — the cards before the acceptors,
// and prose write-ups for rung-excluded findings on a delivered run — so the artifact is verified
// against the same typed values the directive is keyed to.
//
// ── THE JOIN, WHICH IS THE ONLY RISKY PART ───────────────────────────────────────────────────────────
//
// A write-up is identified by heading; the disposition lives on the finding. That is a join, and this
// issue's own doubt-closure measurement is the standing warning about what a join does to a selection —
// 23x on the matcher alone. So the join here is an EXACT ORDINAL, read out of the heading the seat
// already writes ("Finding 3 — …") and matched against `findings[].ordinal`. No name matching, no alias
// table, no substring fallback.
//
// And it fails in the safe direction, in three separate ways:
//
//   THE WORD CAP NEEDS NO JOIN         it applies to every write-up block unconditionally
//   MEMBERSHIP NEEDS ONE               so it applies ONLY to blocks that join, because a block whose
//                                      disposition cannot be read might be perfectly correct, and a
//                                      redo demand against correct prose is the expensive error here
//   UNJOINED BLOCKS ARE COUNTED        a membership rule that silently examined three of eleven
//                                      write-ups reads exactly like one that found nothing wrong

import { isFinding } from "./engagement-receipt.mjs";

/** Every block of the narrative, by the same scan `findEngagementReceipts` uses. PURE. */
function blocksOf(md) {
  const out = [];
  let cur = null;
  for (const ln of String(md ?? "").split("\n")) {
    const h = ln.match(/^(#{2,4})\s+(.*)/);
    if (h) { if (cur) out.push(cur); cur = { heading: h[2].trim(), body: [] }; }
    else if (cur) cur.body.push(ln);
  }
  if (cur) out.push(cur);
  return out.map((b) => ({ heading: b.heading, text: b.body.join("\n") }));
}

/** WHITESPACE TOKENS, stated because a word count is otherwise three different numbers. */
export const wordCount = (s) => (String(s ?? "").trim() ? String(s).trim().split(/\s+/).length : 0);

/**
 * The per-finding prose write-ups in a narrative, with their ordinal where the heading states one.
 *
 * @returns {Array<{heading: string, ordinal: number|null, words: number}>}
 */
export function narrativeWriteUps(narrativeMd) {
  const out = [];
  for (const b of blocksOf(narrativeMd)) {
    if (!isFinding(b.heading, `${b.heading}\n${b.text}`)) continue;
    const m = b.heading.match(/\bfinding\s+(\d{1,4})\b/i);
    out.push({ heading: b.heading, ordinal: m ? Number(m[1]) : null, words: wordCount(b.text) });
  }
  return out;
}

/**
 * Violations of the depth rules, read off the delivered narrative.
 *
 * `keptDispositions` and `maxWords` come from the per-product row. ABSENT MEANS NO RULE — an ungraded
 * product has neither, so this returns nothing at all there and the product is untouched by construction
 * rather than by a threshold set above whatever it happens to produce.
 *
 * @returns {{violations: Array, examined: number, unjoined: number, total: number}}
 */
export function writeUpViolations({ narrativeMd, findings = null, bandOrder = null, maxBandRank = null,
  maxWords = null } = {}) {
  // BAND RANK, ordinal against the RUN'S OWN MANIFEST — owner-ruled. Not a band-name list: the frameworks
  // carry different band vocabularies and different lengths (one ships five bands, others four), so a
  // hard-coded name set would silently select nothing on a framework that spells them differently. The
  // rank is the portable key; `bandOrder` is the manifest's own sequence, rank 1 first.
  const order = Array.isArray(bandOrder) ? bandOrder.map((b) => String(b?.label ?? b ?? "").trim().toLowerCase()) : null;
  const cutoff = Number.isFinite(Number(maxBandRank)) && Number(maxBandRank) > 0 ? Number(maxBandRank) : null;
  const kept = order && order.length && cutoff ? { order, cutoff } : null;
  const cap = Number.isFinite(Number(maxWords)) && Number(maxWords) > 0 ? Number(maxWords) : null;
  // `graded` SEPARATES THE TWO ZEROES, and conflating them is the defect this field exists for. An
  // ungraded product has no rule in force and correctly examines nothing; a GRADED product whose
  // narrative carries no recognisable write-up block also reports `total: 0`, and the caller could not
  // tell them apart — so a graded run the check could not read looked exactly like product 4's correct
  // inertness. Measured over 28 preserved runs: 6 of 22 graded runs, and 5 of 12 multi-country (42%).
  const graded = Boolean(kept || cap);
  if (!graded) return { violations: [], examined: 0, unjoined: 0, total: 0, graded: false, findingsTotal: 0 };

  const list = Array.isArray(findings) ? findings : (Array.isArray(findings?.findings) ? findings.findings : []);
  const byOrdinal = new Map();
  for (const f of list) if (Number.isFinite(Number(f?.ordinal))) byOrdinal.set(Number(f.ordinal), f);

  const writeUps = narrativeWriteUps(narrativeMd);
  const violations = [];
  let examined = 0, unjoined = 0;
  for (const w of writeUps) {
    // THE CAP FIRST, because it needs nothing but the block.
    if (cap && w.words > cap)
      violations.push({ kind: "over-cap", heading: w.heading, ordinal: w.ordinal, words: w.words, cap });
    if (!kept) continue;
    const f = w.ordinal != null ? byOrdinal.get(w.ordinal) : null;
    if (!f) { unjoined++; continue; }        // not flagged: a band that cannot be read is not a violation
    examined++;
    const band = String(f.band ?? "").trim();
    // A BAND-LESS FINDING IS EXCLUDED WITH NO EXCEPTION CLAUSE. Measured: band-less findings are all
    // off-field, so a rank cut excludes them — and a write-up on one is exactly what the rule refuses.
    const rank = band ? kept.order.indexOf(band.toLowerCase()) + 1 : 0;
    if (rank < 1 || rank > kept.cutoff)
      violations.push({ kind: "not-kept", heading: w.heading, ordinal: w.ordinal,
        band: band || null, rank: rank || null, cutoff: kept.cutoff });
  }
  return { violations, examined, unjoined, total: writeUps.length, graded: true, findingsTotal: list.length };
}

/** The sentence a repair reads. */
export function writeUpMessage(v) {
  if (v.kind === "over-cap")
    return `"${v.heading}" runs to ${v.words} words against a cap of ${v.cap} on this product. Cut it to `
      + `that. This bounds how densely a finding is written, never which findings are written about.`;
  const where = v.band ? `band "${v.band}"${v.rank ? ` (rank ${v.rank})` : " is not on this run's manifest"}`
    : "no band";
  return `"${v.heading}" has a prose write-up and carries ${where}. On this product a prose write-up is `
    + `for a finding at band rank ${v.cutoff} or higher. Its typed record in findings.json is its `
    + `write-up. Remove the prose block; change nothing about the band, the disposition, or which marks appear.`;
}
