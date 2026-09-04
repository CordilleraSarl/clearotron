// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// bundled-demos.mjs — WHICH client bundles this repo ships, read from the directory that ships them.
//
// This was a hand-maintained triple. The directory grew a fourth bundle, the triple did not, and the
// set-equality it feeds could no longer match anything — so the #83 detector, whose whole job is to
// notice a door that has silently fallen back to the bundled roster, returned PASS on the #83
// condition. A guard that cannot match reports that it found nothing wrong.
//
// The same shape had already produced two FALSE REFUSALS on this check, both from an exact match
// against a hard-coded list standing in for the property being protected. Those failed closed and
// somebody investigated. This one failed open.
//
// `generic` is excluded, and that is a property of the DOOR rather than a filter of convenience:
// `list_profiles` returns the clients in `clients[]` and reports `generic` separately as
// `genericFallback`, because it is the no-customer fallback rather than a customer. The set this
// derives is compared against `clients[]`, so it must hold exactly what that array holds.

import { readdirSync } from "node:fs";

export const GENERIC_KEY = "generic";

/**
 * The client keys shipped in a profiles directory, sorted — the roster a door with no configured store
 * resolves.
 *
 * THROWS rather than returning empty. An empty list would be read as a legitimate answer by the
 * set-equality downstream, and would fail open in exactly the direction this module exists to close:
 * the caller would compare against nothing, match nothing, and report that it found nothing wrong. An
 * unreadable or client-less profiles directory is a could-not-look, and it says so.
 *
 * @param {object} o
 * @param {string} o.profilesDir  the directory holding `<key>.json` bundles
 * @returns {string[]} client keys, `generic` excluded, sorted
 */
export function bundledDemoKeys({ profilesDir }) {
  let entries;
  try { entries = readdirSync(profilesDir); }
  catch (e) { throw new Error(`the bundled profiles directory could not be read (${profilesDir}): ${e.message}`); }

  const keys = entries
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length))
    .filter((k) => k !== GENERIC_KEY)
    .sort();

  if (!keys.length)
    throw new Error(`${profilesDir} ships no client bundles beside ${GENERIC_KEY}.json — nothing to compare a `
      + "door's roster against, so the bundled-roster check cannot be answered rather than passing");
  return keys;
}
