// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// jx-subclass.mjs — the driver's door to the similar-group tables ( part 2).
//
// REPLACES `jx-cnipa-groups.mjs`, which was five classes of hand-written top-level groups marked
// `vetted:false`. That table could only answer "which groups exist in class N"; a clearance needs
// "which groups does THIS GOOD carry, and what else must therefore be searched", and it needs a
// citation a lawyer can open. Both are what this answers.
//
// ── THE DATABASE IS A BUILD ARTIFACT, AND ITS ABSENCE IS A REFUSAL ───────────────────────────────
//
// Built by `node providers/jx-subclass/load-public.mjs` from the committed `public/` tables — no
// office document required. It is NOT committed: the office sources permit redistribution of the data
// and not of their prose ("data travels, quotation does not"), so the quotation column is dropped at
// export and the assembled database is gitignored.
//
// So a deployment that never ran the build has no database, and `node:sqlite` CREATES AN EMPTY FILE
// on open rather than failing. Every lookup over that empty file returns nothing, and nothing reads as
// "no similar groups found" — a clean negative, in the one jurisdiction family where a missed group is
// a false clear the client cannot check. That is the exact defect this whole slice exists to remove,
// so it must be impossible to reach it by omission. `assertSubclassReady` is the same shape and the
// same reasoning as `providers/uspto-local/src/index-store.js`'s `assertIndexReady`, which
// acceptance 11 names.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { subclassesFor, crossReferencesFor, classSpanFor, groupsInClass, ENABLED_COUNTRIES } from "../providers/jx-subclass/lookup.mjs";

export { ENABLED_COUNTRIES };

/** The path is configuration, like every other data-plane root. Read at CALL time, never at import. */
export const JX_SUBCLASS_DB_ENV = "CLEAROTRON_JX_SUBCLASS_DB";

export const subclassDbPath = (env = process.env) => {
  const v = String(env[JX_SUBCLASS_DB_ENV] ?? "").trim();
  return v || null;
};

export class SubclassUnavailable extends Error {
  constructor(message, reason) { super(message); this.name = "SubclassUnavailable"; this.reason = reason; }
}

/**
 * Refuse an absent or empty database BY NAME — acceptance 11.
 *
 * Three distinct states, three messages, because the act each one asks for is different: configure it,
 * build it, or rebuild it. A single "unavailable" would send an operator who has not set the variable
 * off running a build, and vice versa.
 */
export function assertSubclassReady(db, { path = "the similar-group database" } = {}) {
  const hasTable = db.prepare(
    "SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='group_code'").get().c;
  if (!hasTable) {
    throw new SubclassUnavailable(
      `[jx-subclass] ${path} holds no similar-group table. Build it with `
      + "`node providers/jx-subclass/load-public.mjs` — an unbuilt database must refuse, never answer "
      + "that a good has no similar groups.", "no-schema");
  }
  const rows = db.prepare("SELECT count(*) AS c FROM group_code").get().c;
  if (!rows) {
    throw new SubclassUnavailable(
      `[jx-subclass] ${path} has the schema and no rows, so every lookup over it would return a `
      + "confident 'no similar groups'. Build it with `node providers/jx-subclass/load-public.mjs`. "
      + "A table nobody built is a refusal, never a clean negative.", "empty");
  }
  return rows;
}

/**
 * Open the database, or refuse by name.
 *
 * `existsSync` FIRST, and it is load-bearing: `new DatabaseSync(path)` on a missing file creates it,
 * so opening before checking would manufacture the empty database this function exists to refuse — and
 * would leave a stray file behind on the deployment that was merely misconfigured.
 */
export function openSubclass({ path = subclassDbPath() } = {}) {
  if (!path) {
    throw new SubclassUnavailable(
      `[jx-subclass] ${JX_SUBCLASS_DB_ENV} is not set, so there is no similar-group database to read. `
      + "Set it to the path built by `node providers/jx-subclass/load-public.mjs`.", "unconfigured");
  }
  if (!existsSync(path)) {
    throw new SubclassUnavailable(
      `[jx-subclass] ${JX_SUBCLASS_DB_ENV} points at ${path}, which does not exist. Build it with `
      + "`node providers/jx-subclass/load-public.mjs`; this does NOT create it, because an empty "
      + "database answers every lookup with a false clear.", "missing");
  }
  const db = new DatabaseSync(path, { readOnly: true });
  assertSubclassReady(db, { path });
  return db;
}

/** Question 1 — the group codes a good carries, with its citation ( acceptance 6). */
export const subclassesForGood = (db, { country, term, niceClass }) =>
  subclassesFor(db, { country, term, niceClass });

/** Question 2 — the groups a search must ALSO cover ( acceptance 8: the types are never merged). */
export const crossSearchFor = (db, { country, group, niceClass }) =>
  crossReferencesFor(db, { country, group, niceClass });

/** The classes a group spans, unioned across the two national bases ( acceptance 7 and 10). */
export const classesSpannedBy = (db, { country, group }) =>
  classSpanFor(db, { country, group });

/**
 * Is this country answerable at all? DATA, not a flag ( acceptance 12).
 *
 * The four countries sit in one table with a country column and the query is identical for each, so
 * enabling one is a list edit in `providers/jx-subclass/lookup.mjs` and nothing else. Exposed here so a
 * caller can ask before it queries, rather than reading `country-not-enabled` as an absence of groups.
 */
export const isCountryEnabled = (country) => ENABLED_COUNTRIES.includes(String(country).toUpperCase());

/**
 * The zh lane's awareness note, for every in-scope class —.
 *
 * REPLACES `cnSubgroupsFor`. Same shape out (one row per class, so the receipt renders unchanged) and a
 * different guarantee in: the groups are the office's own, the edition is stated, and the three ways of
 * having nothing are three different answers.
 *
 * NEVER THROWS, because this is an informational receipt field on a lane that must still run when the
 * database is not deployed. But an unreachable database is a FINDING and says so per class — the old
 * module's `null` for an unlisted class was indistinguishable from a class with no groups, and that
 * ambiguity is what let five hand-written classes read as coverage.
 */
export function cnipaSubgroupsForClasses(classes, { path = subclassDbPath() } = {}) {
  const rows = [...(classes ?? [])].map((c) => ({ class: Number(c) }));
  let db;
  try { db = openSubclass({ path }); }
  catch (e) {
    // One reason, repeated per class rather than one banner: each row of this receipt has to stand alone
    // when a reader greps it, and a row that says nothing about why it is empty is the defect above.
    return rows.map((r) => ({ ...r, groups: null, unavailable: e.reason ?? "unavailable", note: e.message }));
  }
  try {
    return rows.map((r) => {
      const g = groupsInClass(db, { country: "CN", niceClass: r.class });
      return g.status === "ok"
        ? { ...r, groups: g.groups, edition: g.citation?.edition ?? null, source: g.citation?.document ?? null }
        : { ...r, groups: null, status: g.status, note: g.reason ?? g.note ?? null };
    });
  } finally { db.close(); }
}

/** The edition the database itself records for CN, or null when it is unreachable.. */
export function cnipaEditionLabel({ path = subclassDbPath() } = {}) {
  let db;
  try { db = openSubclass({ path }); } catch { return null; }
  try {
    const r = db.prepare("SELECT edition FROM provenance WHERE office = 'CN' LIMIT 1").get();
    return r?.edition ?? null;
  } catch { return null; } finally { db.close(); }
}
