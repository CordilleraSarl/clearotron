// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Mark families — several names a customer treats as one piece of work.
//
// AQUAPLUS and AQUAMAX belong together because somebody says so. No heuristic decides it: string
// distance, shared prefix and class overlap are each confidently wrong in both directions, and a product
// that guessed would either split a brand line or merge two unrelated marks — the second being the worse
// failure, and the silent one. So a family is an ASSERTION, made by a person, stored where assertions go.
//
// ── why this is a sidecar and not a field in meta.json ────────────────────────────────────────────────
//
// The same reason `archive-tags.json` is one, recorded at publish/index.mjs:338: "meta.json is rewritten
// on every republish so a flag there would be lost." That is not hypothetical here — a `rerender-all`
// pass over the pool is a live plan, and a family written into meta would be erased by the very operation
// meant to bring old reports up to date. Curation state that a person entered by hand must outlive a
// re-render of the artefact it describes.
//
// ── the shape ────────────────────────────────────────────────────────────────────────────────────────
//
//   { "schema": 1,
//     "families": { "hydra-range": { "name": "Hydra range", "account": "aurora" } },
//     "of":       { "<runId>": "hydra-range" } }
//
// Keyed by RUN rather than by mark. A mark is not a thing the pool stores — it is a grouping the browser
// derives from run metadata — so a run id is the only stable handle the two sides already agree on. The
// UI folds run→family up into mark→family when it groups.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const FILE = "family-tags.json";

// A FUNCTION, not a shared constant.
//
// This was `const EMPTY = { schema: 1, families: {}, of: {} }` returned as `{ ...EMPTY }`, which is a
// SHALLOW copy: every caller got the same two nested objects, and the first write mutated the module
// constant for the life of the process. Two pools then shared one set of families, and — worse — an
// unreadable sidecar returned whatever had last been written to a different pool instead of nothing.
// Caught by a test asserting a malformed file degrades to no families; it degraded to someone else's.
const empty = () => ({ schema: 1, families: {}, of: {} });

/** Ids are derived from the name so that grouping into "Hydra range" twice MERGES rather than duplicating. */
export function familyId(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** A run id is one path segment and nothing else — the same gate the report route applies. */
const okRunId = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(v) && !v.includes("..");

export function readFamilies(poolRoot) {
  try {
    const raw = JSON.parse(readFileSync(join(poolRoot, FILE), "utf8"));
    // Shape-checked rather than trusted. This file is hand-editable by design — it is how staff would fix
    // a mis-grouping without the UI — so a malformed one must degrade to "no families" rather than take
    // the list down with it.
    const families = raw && typeof raw.families === "object" && raw.families && !Array.isArray(raw.families) ? { ...raw.families } : {};
    const of = raw && typeof raw.of === "object" && raw.of && !Array.isArray(raw.of) ? { ...raw.of } : {};
    return { schema: 1, families, of };
  } catch {
    return empty();
  }
}

/**
 * What the browser needs: run → family id, and family id → name.
 *
 * Scoped to an account when one is given, so a staff member acting for one client cannot see another
 * client's brand lines in the payload. `null` means the all-owners view, which is staff-only upstream.
 */
export function familiesView(poolRoot, account = null) {
  const store = readFamilies(poolRoot);
  const names = {};
  const of = {};
  for (const [id, fam] of Object.entries(store.families)) {
    if (account !== null && fam?.account !== account) continue;
    names[id] = typeof fam?.name === "string" ? fam.name : id;
  }
  for (const [runId, id] of Object.entries(store.of)) {
    if (names[id]) of[runId] = id;
  }
  return { of, names };
}

function save(poolRoot, store) {
  // Written via a temp file and renamed, so a reader never sees a half-written JSON document. The list
  // endpoint reads this on every poll; a torn read would blank every family on screen at once.
  const target = join(poolRoot, FILE);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o640 });
  renameSync(tmp, target);
}

/**
 * Put runs into a named family, minting it if it does not exist.
 *
 * `account` is passed in by the caller, which resolved it from each run's OWN metadata — never from a
 * request body. A family spans exactly one brand owner: the UI rolls a family's band up across its marks,
 * and a band is only comparable within one framework, so a cross-account family would produce a roll-up
 * that means nothing. It is also the tenancy wall.
 */
export function groupRuns(poolRoot, { name, runIds, account }) {
  const id = familyId(name);
  if (!id) return { error: "a family needs a name" };
  const ids = (Array.isArray(runIds) ? runIds : []).filter(okRunId);
  if (!ids.length) return { error: "no runs to group" };

  const store = readFamilies(poolRoot);
  const existing = store.families[id];
  if (existing && existing.account !== account) {
    // Two clients may both have a "Core range". Same derived id, different owners — and silently merging
    // them would put one customer's marks under another's heading.
    return { error: "a family with that name already belongs to another brand owner" };
  }
  store.families[id] = { name: String(name).trim().slice(0, 80), account };
  for (const runId of ids) store.of[runId] = id;
  save(poolRoot, store);
  return { familyId: id, name: store.families[id].name, runs: ids.length };
}

/** Take runs out of whatever family they are in, dropping any family left with nothing in it. */
export function ungroupRuns(poolRoot, { runIds }) {
  const ids = (Array.isArray(runIds) ? runIds : []).filter(okRunId);
  if (!ids.length) return { error: "no runs to ungroup" };

  const store = readFamilies(poolRoot);
  let removed = 0;
  for (const runId of ids) {
    if (store.of[runId]) {
      delete store.of[runId];
      removed += 1;
    }
  }
  // An empty family is not a family. Left behind, it would accumulate as a list of headings with nothing
  // under them, and the next person to use its name would silently inherit its owner.
  const live = new Set(Object.values(store.of));
  for (const id of Object.keys(store.families)) if (!live.has(id)) delete store.families[id];
  save(poolRoot, store);
  return { removed };
}
