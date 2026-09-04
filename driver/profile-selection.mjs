// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// profile-selection.mjs — which findings the refutation seat is asked to profile, chosen by the DRIVER.
//
// 's architecture: "prefer driver selection wherever the key precedes the dispatch." The band is
// on findings.json before narrative-refutation is dispatched, so there is nothing for a directive to
// ask the seat to judge — the driver lists the ordinals and unlisted work is never requested.
//
// WHY THAT IS STRONGER THAN AN INSTRUCTION. A directive can be carried and ignored, carried and
// misread, or — as this issue found twice — not carried at all by a dispatch nobody checked. A list of
// ordinals has none of those failure modes: the seat is asked for exactly what the list contains.
//
// ── THE DIRECTION IT FAILS IN ────────────────────────────────────────────────────────────────────────
//
// `null` means EVERY finding, and every unreadable state returns null: no cut on the row, no findings
// file, an unparseable one, a manifest that resolves no bands. Being wrong toward depth costs time;
// being wrong toward brevity silently drops work from a report somebody paid for, and the only symptom
// is that a profile nobody asked about is missing.
//
// A finding with NO BAND is included, deliberately. Band-less findings are off-field by the synthesis
// seat's own dispatch, and excluding them here would be a second, unruled cut riding on this one — the
// narrative directive's rank rule excludes them from PROSE, which is a different question from whether
// the reviewer may look at them.

/** Band rank, ordinal against the run's own manifest. 0 when the band is absent or not on the manifest. */
export function bandRank(band, bandOrder) {
  const order = Array.isArray(bandOrder) ? bandOrder.map((b) => String(b?.label ?? b ?? "").trim().toLowerCase()) : [];
  const b = String(band ?? "").trim().toLowerCase();
  if (!b || !order.length) return 0;
  const i = order.indexOf(b);
  return i < 0 ? 0 : i + 1;
}

/**
 * The ordinals to profile, or null for "every finding".
 *
 * @param {{findings?: Array}|Array|null} findings  findings.json's findings[], or the document
 * @param {Array} bandOrder                         the run's manifest bands, rank 1 first
 * @param {number|null} maxRank                     the per-product cut; absent ⇒ null ⇒ all
 * @returns {{ordinals: number[]|null, total: number, keyless: number}}
 */
export function profileOrdinals({ findings = null, bandOrder = null, maxRank = null } = {}) {
  const cut = Number.isFinite(Number(maxRank)) && Number(maxRank) > 0 ? Number(maxRank) : null;
  const list = Array.isArray(findings) ? findings : (Array.isArray(findings?.findings) ? findings.findings : null);
  const order = Array.isArray(bandOrder) && bandOrder.length ? bandOrder : null;
  if (!cut || !list || !list.length || !order) return { ordinals: null, total: list?.length ?? 0, keyless: 0 };

  const ordinals = [];
  let keyless = 0;
  for (const f of list) {
    const ord = Number(f?.ordinal);
    if (!Number.isFinite(ord)) continue;
    const rank = bandRank(f?.band, order);
    // RANK 0 = no band, or a band this manifest does not list. Included, and counted: a finding whose
    // band cannot be placed is not evidence that it may be skipped.
    if (rank === 0) { keyless++; ordinals.push(ord); continue; }
    if (rank <= cut) ordinals.push(ord);
  }
  // EVERY finding selected is the same as no selection, and saying so keeps the dispatch byte-identical
  // on a run where the cut happens to keep everything.
  if (ordinals.length === list.length) return { ordinals: null, total: list.length, keyless };
  return { ordinals: ordinals.sort((a, b) => a - b), total: list.length, keyless };
}

/** The sentence the dispatch carries. Empty when every finding is profiled. */
export function profileSelectionDirective(sel) {
  if (!sel?.ordinals) return "";
  if (!sel.ordinals.length)
    return "GROUNDED PROFILES — write NO grounded profiles on this run. Refute the narrative in full as "
      + "usual; the profiles are the only thing this removes.";
  return "GROUNDED PROFILES — write a grounded profile for these findings only, by ordinal: "
    + `${sel.ordinals.join(", ")}. Not for any other finding. This changes nothing about what you refute, `
    + "what you conclude, or which findings your review covers — only which of them get a profile.";
}
