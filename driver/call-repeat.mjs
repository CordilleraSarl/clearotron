// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// call-repeat.mjs -. One detector for "this seat has already sent me these items".
//
// Four stages take per-item work through validated tool calls, and three of them can be handed the same
// batch twice. The first instance lived inside `doubt-closure-tool.mjs`; a second and third hand-written
// copy is how a dictated shape ends up in three places bound by nothing, which is a defect class this
// tree has paid for repeatedly. So it lives here once and each receiver supplies the two facts that
// genuinely differ.
//
// WHAT DIFFERS PER STAGE, AND WHY IT IS EXACTLY TWO THINGS
//
// `idField` - the property that names an item: `doubt_id` for closures, `row_id` for coverage,
// `row_index` for declinations.
//
// `generation` - an optional key scoping a match to one edition of the item list. Absent, a hash matches
// anywhere in the run, which is right only when the identity is STABLE for the run:
//
//   doubt-closure - `doubt_id`, and the spec sidecar is written once outside the stage retry ladder.
//                   No generation needed.
//   coverage      - `row_id` is CONTENT-DERIVED (`shortId("CA", "axis:...")` in coverage-form.mjs), so it
//                   survives the canonical list being regenerated on every call. No generation needed.
//   declination   - `row_index` is a POSITION into `_driver/declination-spec.json`, and that spec is
//                   deliberately rewritten between the main and the corrective synthesis pass. Its own
//                   site says why: "if the surface ever did move, the corrective's `row_index` would
//                   point into the previous pass's list and a declination would land on the wrong
//                   record." The call index outlives both passes, so a match across them would compare
//                   positions into two different lists - that defect, rebuilt one place over. The spec
//                   carries a `ts`; passing it as the generation scopes a match to one edition.
//
// A POSITIONAL IDENTITY WITHOUT A GENERATION KEY IS THE ONE COMBINATION THIS MODULE CANNOT MAKE SAFE.
// It is not rejected here - this module cannot tell a position from a name - so it is stated at each
// caller instead, beside the reason that caller is safe.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * A stable fingerprint of the ITEMS a call speaks about.
 *
 * Sorted and deduped, so the order rows arrive in and a row repeated inside one call cannot change it:
 * two calls carrying the same items hash the same however they were assembled.
 *
 * Returns null when the call names no items - there is nothing to be identical TO, and a shared hash for
 * "carried nothing" would make every empty call a repeat of the first empty one.
 *
 * @param {unknown} rows the array the call carried
 * @param {{idField: string, generation?: string|null}} opts
 * @returns {string|null}
 */
export function idSetHash(rows, { idField, generation = null } = {}) {
  if (!idField) throw new Error("idSetHash: idField is required - a hash over the wrong property matches nothing, silently");
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.map((r) => String(r?.[idField] ?? "").trim()).filter(Boolean))].sort();
  if (!ids.length) return null;
  return createHash("sha256").update(`${String(generation ?? "")}|${ids.join(" ")}`).digest("hex").slice(0, 12);
}

/**
 * The earliest call in this run whose id-set matches, read from the index the receiver already writes.
 *
 * A torn line is skipped rather than thrown on: a half-written index row must never cost a seat its call.
 *
 * @param {string} indexPath the receiver's `index.jsonl`
 * @param {string|null} hash
 * @returns {{seq: number|null, at: string|null}|null}
 */
export function priorCallWithIdSet(indexPath, hash) {
  if (!hash) return null;
  let raw; try { raw = readFileSync(indexPath, "utf8"); } catch { return null; }
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    let row; try { row = JSON.parse(ln); } catch { continue; }
    if (row?.idSetHash === hash) return { seq: row.seq ?? null, at: row.at ?? null };
  }
  return null;
}

/**
 * A generation key for a POSITIONAL identity: a fingerprint of the list the positions point into.
 *
 * Content-derived rather than a timestamp, deliberately. A timestamp splits generations whenever the
 * writer ran, including when it rewrote the identical list - which would report a repeat as new work and
 * quietly stop the detector doing anything. This splits exactly when the list actually changed, which is
 * the only time a position means something different.
 *
 * @param {unknown} rows the authoritative list a `row_index` indexes into
 * @returns {string} a short stable key; the empty-list key is distinct from every non-empty one
 */
export function listGeneration(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return createHash("sha256").update(JSON.stringify(list)).digest("hex").slice(0, 12);
}
