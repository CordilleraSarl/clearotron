// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// placement-diff.mjs —: compare two runs' placement tiers, so 's repeat runs can be scored.
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// 's offline half is answered: the band-shape seam moves its input, so the branch is taken and the
// noise floor needs repeat PAID arms on one matter. Those runs are the E2E agent's. When they land there
// is nothing to compare them with — `placement-carry.mjs` joins placements to the digest surfaces WITHIN
// one run, and nothing in the tree diffs two `placements.json`.
//
// Without this the round spends two full R2 arms and then eyeballs a table.
//
// ── THE JOIN KEY: mark + owner + jurisdiction, and NOT `records[]` ────────────────────────────────────
//
// A common-law candidate carries `records: []` BY CONTRACT — `stages.mjs` dictates it — so a URI join
// silently drops exactly the population most likely to move between runs. The three fields that every
// entry carries are `mark`, `owner` and `jurisdiction`, and `placement-model.mjs` makes all three
// required, so the key is total over the artifact.
//
// ── THE headline-candidate ↔ sheet-2 CELL IS REPORTED ON ITS OWN ─────────────────────────────────────
//
// `placement-model.mjs` records the measurement this exists to serve: "nine of ten measured tier
// disagreements between two runs of the same matter sat on the headline-candidate / sheet-2 boundary:
// the runs were not disagreeing about a fact, they were answering an under-posed question." Folding that
// cell into one disagreement rate reports a big number and hides that it is one boundary.
//
// The `borderline` flag splits it again, and this is the part a bare rate cannot say. An entry where
// either run DECLARED the call arguable is a run behaving correctly and disagreeing; one where neither
// did is two confident answers that contradict. Those are different findings about the engine and they
// must not average together.
//
// ── AN ENTRY IN ONE RUN AND NOT THE OTHER IS ITS OWN ROW ─────────────────────────────────────────────
//
// Never a tier disagreement, never dropped. A candidate that one arm placed and the other never saw is
// a RECALL difference, and calling it a tier difference would attribute a retrieval gap to judgment —
// the same conflation and were both filed for.
//
// PURE — no IO, no clock. The CLI (`scripts/placement-diff.mjs`) owns the reading.

import { PLACEMENT_TIERS } from "./placement-model.mjs";

export const PLACEMENT_DIFF_SCHEMA_VERSION = 1;

/** The boundary the measurement says nine of ten disagreements sit on. */
export const BOUNDARY_PAIR = ["headline-candidate", "sheet-2"];

/** Lowercase, collapse whitespace, drop a trailing parenthetical. Folds nothing else. */
export const normKey = (s) => String(s ?? "").trim().replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().replace(/\s+/g, " ");

/** mark + owner + jurisdiction. Total over the artifact: placement-model makes all three required. */
export const entryKey = (e) => `${normKey(e?.mark)}|${normKey(e?.owner)}|${normKey(e?.jurisdiction)}`;

const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/**
 * Compare two placement sets.
 *
 * `a` and `b` are `parsePlacementsJson(...).placements` arrays, labelled by `labelA` / `labelB`. Order
 * is irrelevant and duplicate keys keep the FIRST occurrence — a second entry under one key is itself
 * reported, because it means the join is not the identity the artifact claims.
 */
export function diffPlacements(a = [], b = [], { labelA = "A", labelB = "B" } = {}) {
  const index = (list) => {
    const m = new Map(); const dupes = [];
    for (const e of Array.isArray(list) ? list : []) {
      const k = entryKey(e);
      if (m.has(k)) { dupes.push({ key: k, mark: String(e?.mark ?? ""), owner: String(e?.owner ?? ""), jurisdiction: String(e?.jurisdiction ?? "") }); continue; }
      m.set(k, e);
    }
    return { m, dupes };
  };
  const A = index(a), B = index(b);

  const matrix = {};
  for (const t of PLACEMENT_TIERS) { matrix[t] = {}; for (const u of PLACEMENT_TIERS) matrix[t][u] = 0; }

  const agreed = [], moved = [], onlyA = [], onlyB = [], unknownTier = [];
  for (const [k, ea] of A.m) {
    const eb = B.m.get(k);
    if (!eb) {
      onlyA.push({ key: k, mark: String(ea.mark ?? ""), owner: String(ea.owner ?? ""), jurisdiction: String(ea.jurisdiction ?? ""), tier: String(ea.tier ?? "") });
      continue;
    }
    const ta = String(ea.tier ?? ""), tb = String(eb.tier ?? "");
    if (!PLACEMENT_TIERS.includes(ta) || !PLACEMENT_TIERS.includes(tb)) {
      // A tier outside the closed vocabulary is a defect in the artifact, not a movement. Reported as
      // itself rather than counted as a disagreement.
      unknownTier.push({ key: k, mark: String(ea.mark ?? ""), [labelA]: ta, [labelB]: tb });
      continue;
    }
    matrix[ta][tb] += 1;
    const row = {
      key: k, mark: String(ea.mark ?? ""), owner: String(ea.owner ?? ""), jurisdiction: String(ea.jurisdiction ?? ""),
      [labelA]: ta, [labelB]: tb,
      // Either side declaring the call arguable makes this a different finding from two confident
      // contradictory answers. Absent means not borderline — every archived artifact parses unchanged.
      borderline: ea.borderline === true || eb.borderline === true,
      borderline_in: [ea.borderline === true ? labelA : null, eb.borderline === true ? labelB : null].filter(Boolean),
    };
    if (ta === tb) agreed.push(row); else moved.push(row);
  }
  for (const [k, eb] of B.m) {
    if (A.m.has(k)) continue;
    onlyB.push({ key: k, mark: String(eb.mark ?? ""), owner: String(eb.owner ?? ""), jurisdiction: String(eb.jurisdiction ?? ""), tier: String(eb.tier ?? "") });
  }

  const isBoundary = (r) => BOUNDARY_PAIR.includes(r[labelA]) && BOUNDARY_PAIR.includes(r[labelB]);
  const boundary = moved.filter(isBoundary);
  const offBoundary = moved.filter((r) => !isBoundary(r));
  const byPair = {};
  for (const r of moved) bump(byPair, `${r[labelA]} → ${r[labelB]}`);

  const compared = agreed.length + moved.length;
  return {
    schema_version: PLACEMENT_DIFF_SCHEMA_VERSION,
    labels: { a: labelA, b: labelB },
    join: { key: "mark|owner|jurisdiction", why: "a common-law candidate carries records:[] by contract, so a URI join drops exactly the population most likely to move" },
    totals: {
      [labelA]: A.m.size, [labelB]: B.m.size,
      compared, agreed: agreed.length, moved: moved.length,
      // The headline number, and it is deliberately NOT the only one printed.
      moved_pct: compared ? Math.round((moved.length / compared) * 1000) / 10 : null,
      boundary_moves: boundary.length,
      off_boundary_moves: offBoundary.length,
      // Two confident contradictory answers. This is the number that is about the ENGINE rather than
      // about an under-posed question, and it is the one a floor should be quoted from.
      confident_moves: moved.filter((r) => !r.borderline).length,
      declared_borderline_moves: moved.filter((r) => r.borderline).length,
      only_in_a: onlyA.length, only_in_b: onlyB.length,
      unknown_tier: unknownTier.length,
      duplicate_keys: A.dupes.length + B.dupes.length,
    },
    matrix,
    by_pair: byPair,
    // Kept apart, deliberately: the boundary cell is an under-posed question and the rest is not.
    boundary_moves: boundary,
    off_boundary_moves: offBoundary,
    agreed_count_only: agreed.length,
    // A RECALL difference, never a tier disagreement.
    only_in_a: onlyA,
    only_in_b: onlyB,
    unknown_tier: unknownTier,
    duplicate_keys: [...A.dupes.map((d) => ({ ...d, side: labelA })), ...B.dupes.map((d) => ({ ...d, side: labelB }))],
  };
}

/** The human table. Deterministic, no clock. */
export function renderPlacementDiff(d) {
  const { a, b } = d.labels;
  const t = d.totals;
  const L = [];
  L.push("");
  L.push("═".repeat(78));
  L.push(`placement tier diff — ${a} vs ${b}`);
  L.push(`${t[a]} entr(ies) in ${a} · ${t[b]} in ${b} · ${t.compared} joined on mark|owner|jurisdiction`);
  L.push("");
  L.push("── the confusion matrix ───────────────────────────────────────────────────────");
  const w = Math.max(...PLACEMENT_TIERS.map((x) => x.length));
  L.push(`  ${" ".repeat(w)}  ${PLACEMENT_TIERS.map((x) => x.slice(0, 8).padStart(9)).join("")}   (rows ${a}, cols ${b})`);
  for (const ta of PLACEMENT_TIERS) {
    L.push(`  ${ta.padEnd(w)}  ${PLACEMENT_TIERS.map((tb) => String(d.matrix[ta][tb]).padStart(9)).join("")}`);
  }
  L.push("");
  L.push("── what moved ─────────────────────────────────────────────────────────────────");
  L.push(`  agreed                       ${String(t.agreed).padStart(5)}`);
  L.push(`  moved                        ${String(t.moved).padStart(5)}   ${t.moved_pct === null ? "" : `(${t.moved_pct}% of joined)`}`);
  L.push(`    on the headline↔sheet-2 boundary  ${String(t.boundary_moves).padStart(5)}`);
  L.push(`    anywhere else                     ${String(t.off_boundary_moves).padStart(5)}`);
  L.push(`  of all moves, DECLARED borderline  ${String(t.declared_borderline_moves).padStart(5)}`);
  L.push(`  of all moves, two CONFIDENT answers ${String(t.confident_moves).padStart(5)}   ← quote a floor from THIS`);
  L.push("");
  if (Object.keys(d.by_pair).length) {
    L.push("── by pair ────────────────────────────────────────────────────────────────────");
    for (const [k, n] of Object.entries(d.by_pair).sort((x, y) => y[1] - x[1])) L.push(`  ${String(n).padStart(5)}  ${k}`);
    L.push("");
  }
  L.push("── present in one arm only — a RECALL difference, never a tier disagreement ────");
  L.push(`  only in ${a}: ${t.only_in_a}`);
  for (const r of d.only_in_a.slice(0, 12)) L.push(`      ${r.mark} · ${r.owner} · ${r.jurisdiction} · ${r.tier}`);
  if (d.only_in_a.length > 12) L.push(`      … and ${d.only_in_a.length - 12} more (full list in --json)`);
  L.push(`  only in ${b}: ${t.only_in_b}`);
  for (const r of d.only_in_b.slice(0, 12)) L.push(`      ${r.mark} · ${r.owner} · ${r.jurisdiction} · ${r.tier}`);
  if (d.only_in_b.length > 12) L.push(`      … and ${d.only_in_b.length - 12} more (full list in --json)`);
  if (t.unknown_tier) {
    L.push("");
    L.push(`  ${t.unknown_tier} entr(ies) carry a tier outside the closed vocabulary — a defect in the artifact, not a movement`);
  }
  if (t.duplicate_keys) {
    L.push(`  ${t.duplicate_keys} duplicate join key(s) — the artifact is not unique on mark|owner|jurisdiction, so this diff understates`);
  }
  L.push("");
  L.push("═".repeat(78));
  L.push("This measures the MODEL-AUTHORED placement tier across two arms, and it is free.");
  L.push("It says nothing about whether either arm is RIGHT — that is the reviewing lawyer's.");
  L.push("Nothing was written. Exit code is 0 either way — this records, it does not judge.");
  return L.join("\n");
}
