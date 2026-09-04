// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-origins.mjs —. Which hosts the run's register may legitimately put in a record URL.
//
// A ONE-FUNCTION MODULE, AND THE NARROWNESS IS THE POINT.
//
// The record-URL gate lives in the findings validator, so `verify.mjs` needs this answer. Importing
// `driver.config.mjs` there to get it is what I tried first, and skill-contract-enumerations.test.mjs
// refused it — correctly. That test derives "the modules that judge seat output" from verify.mjs's own
// import list, and then requires every closed vocabulary those modules export to be TAUGHT somewhere the
// seat can read. Pulling driver.config in dragged `KNOWN_REGISTER_PROVIDERS` into the gate surface, and
// the seat is never handed a provider name at all — so the honest options were to teach a vocabulary
// nobody emits, or to stop widening the surface. This is the second.
//
// Nothing here is a vocabulary. It is a lookup, and it exports one function.
import { PROVIDERS } from "./driver.config.mjs";

/**
 * The record hosts `providerId` may legitimately produce, as an array of origins.
 *
 * COMPOSITES RESOLVE THROUGH THEIR MEMBERS. free-tier is EUIPO + the USPTO local index and its own
 * `publicRecordOrigin` is null on purpose (two offices, two hosts). Reading that null as the allow-list
 * would produce an EMPTY set and refuse every free-tier delivery — every one of whose links is a
 * legitimate EUIPO or USPTO one. That is the free public tier, so the failure would land hardest on the
 * runs nobody is paying for.
 *
 * An EMPTY ARRAY is an answer, not an absence: clarivate and signa publish no per-record page
 * (`hasPublicRecordUrl: false`), so no absolute record URL is legitimate on them — cite the office
 * register instead. The caller distinguishes that from `null`, which means "no provider named, gate off".
 */
export function recordOriginsFor(providerId, seen = new Set()) {
  const conf = PROVIDERS[providerId];
  if (!conf || seen.has(providerId)) return [];
  seen.add(providerId);
  if (Array.isArray(conf.composedOf) && conf.composedOf.length)
    return [...new Set(conf.composedOf.flatMap((m) => recordOriginsFor(m, seen)))];
  if (!conf.hasPublicRecordUrl) return [];
  return conf.publicRecordOrigin ? [conf.publicRecordOrigin] : [];
}

/** The provider this process is configured for, or null. Read here so verify.mjs needs no config import. */
export function activeRecordOrigins(env = process.env) {
  const id = String(env?.CLEAROTRON_DATABASE ?? "").trim().toLowerCase();
  return id ? recordOriginsFor(id) : null;
}
