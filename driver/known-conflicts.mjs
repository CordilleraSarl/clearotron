// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// known-conflicts.mjs — the PER-MARK, WORKSPACE-LEVEL recall store (spec 64, Bug 3).
//
// The copper-lattice recall tripwire (-) wrote `_known-conflicts.json` into the MATTER dir
// (`<studioRoot>/<slug>/`) — but every refless email mints a NEW matter id, so a re-run of the same
// mark started with an EMPTY ledger and the tripwire was structurally blind across matter ids
// (copper-causeway could not see teal-conduit's VENERET: different noref slugs for the same VENZY).
// The store therefore lives one level up, keyed by the MARK:
//
//     <studioRoot>/_known-conflicts/<kebab(mark)>.json     (studioRoot = workspace-<agent>/studio/prelim-search)
//
// One file per searched mark name; workspace-per-agent keeps customers separated. Each file keeps the
// EXACT inner shape the tripwire already reads ({schema_version, marks:{"<mark key>":[rows]}}), so
// findRecallRegressionViolations needs zero changes — the pipeline merges files and passes the object.
//
// Semantics preserved from the matter-dir ledger: deduped by NORMALIZED registration uri, and
// best-effort at write time (a store failure must never mask a delivery). Row schema v2 adds OPTIONAL
// fields (owner, jurisdiction, customer, opposition_end, deadline_source_uri, source_url) — v1 rows
// parse unchanged. v3 adds `terminal`. URIs are stored in the canonical `/mark/<cc>/<id>` PATH form
// (normalizeRecordUri): the tripwire compares against fetched-record keys and drop-row uris, both
// path-shaped — a full-URL row could be *carried*-matched but never *justified*, a latent hole this
// module closes.
//
// WRITE DISCIPLINE — "append-only" with ONE bounded exception (round 3, and read it before editing).
// Code ADDS rows and never deletes or rewrites one; a human edit wins, because the human fields are
// the ones a reader wrote (`status`, `mark_text`, an annotation). The single exception is `terminal`,
// which is MACHINE PROVENANCE, not a human suppression switch — it records which terminal a row was
// observed at, and a delivered run may UPGRADE it (see upsertDeliveryLegs). A human who wants a row
// to stop mattering edits `status`, which no write ever touches.
//
// PURE core + thin IO (the coverage-ledger.mjs pattern): parseKnownConflicts / mergeKnownConflicts /
// upsertDeliveryLegs are pure and unit-tested offline; readKnownConflictsFor / writeKnownConflictsFor
// do the file IO. Token-first throws so a gateway ladder could route them (today only the pipeline's
// never-kill try/catch consumes them).

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRecordUri } from "./registry-fidelity.mjs";

const short = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

// The tripwire's own mark normalization (reasoning-tripwires.mjs `norm`) — fold diacritics, drop
// punctuation — so "VENZY™" and "Venzy" share one store file and one inner key.
export function markKey(name) {
  // \p{L}\p{N} (review fix): a Cyrillic/Greek/CJK mark must not fold to "" — that silently disabled
  // the store for every non-Latin mark. Diacritics still fold for Latin; ASCII behavior unchanged.
  return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Store FILENAME for a mark: the markKey, kebab-cased. "" for an unusable name. */
export function markFileName(name) {
  const k = markKey(name).replace(/\s+/g, "-");
  return k ? `${k}.json` : "";
}

/** Canonical stored uri: the /mark/<cc>/<id> path when extractable, else the trimmed original. */
export function canonicalUri(uri) {
  return normalizeRecordUri(uri) || String(uri ?? "").trim();
}

const ROW_KEYS = ["uri", "mark_text", "classes", "status", "source", "ts",
  "owner", "jurisdiction", "customer", "opposition_end", "deadline_source_uri", "source_url",
  "terminal"]; // v2 — all optional; v3 adds `terminal` (see acceptedConflicts below)

/**
 * The store version THIS driver writes and is the newest it can read. It must move whenever ROW_KEYS
 * grows, and the reason is a rollback, not tidiness: `parseKnownConflicts` rejects an unknown row key
 * token-first, so a file written here is UNPARSEABLE to a driver that predates the key. v3 shipped
 * `terminal` while the files still said `schema_version: 1` — an older driver reading them threw
 * `known_conflicts_row_key_unknown:terminal` into a swallowed catch and read the store as ABSENT, so
 * the recall probes and the recall tripwire went quiet with no signal at all. Two halves fix
 * that: the version is now stamped honestly (a reader can SAY "this file is newer than I am" instead
 * of guessing from a key name), and every read reports the files it could not use (`onError` below).
 * Note the limit plainly: this cannot repair a driver that already shipped without it. Restoring a
 * pre-v3 store after a rollback is an OPERATIONAL move — see scripts/backup-recall-stores.mjs.
 */
export const STORE_SCHEMA_VERSION = 3;

/** Hand an IO/parse failure to the caller's reporter without ever letting the reporter break the
 *  read or the write — loudness is the caller's job, and a broken reporter must not cost the store. */
const report = (onError, path, err) => { try { onError?.(path, err); } catch { /* never fatal */ } };

// ── PROVENANCE: which rows may shape a later DELIVERED verdict (P2-A round 2, review problem 3) ─────
// The store learns from two terminals now: the delivered one (as always) and a run that produced
// findings.json and then died at or after verdict. The failed-run write exists so the NEXT attempt on
// the same matter can SEE this attempt's ratings instead of re-running a recall no-op — that is
// context, and it is the whole point. But an unaccepted run's legs must never reach a later
// DELIVERED verdict: the chain readKnownConflictsFor → findRecallRegressionViolations →
// recallRegressionMaterial → decideRegisterGap → the deliver-conditional floor turns a store row into
// `verdict = "CONDITIONAL"` plus the sentence "a prior-confirmed live conflict was neither carried nor
// justified this run: …" quoted in the report. A finding from a run that was BLOCKED by the reviewer,
// or killed by the recall floor, was never accepted by anyone — it cannot be the premise of a clamp.
//
// So each auto row carries `terminal`. The rule, and the DEFAULT, matter equally:
//   • terminal absent  ⇒ ACCEPTED. Every row written before this change came from a delivered
//     terminal, and every HUMAN-edited row (the store is human-editable and "the file wins") was put
//     there deliberately. Defaulting the other way would silently disarm the existing tripwire.
//   • terminal "delivered" ⇒ accepted.
//   • anything else (`failed:<stage>`) ⇒ context only: visible to the recall PROBES that tell the
//     next run where to look, invisible to every verdict surface.
export function isAcceptedConflictRow(row) {
  const t = row?.terminal;
  return t == null || t === "" || String(t) === "delivered";
}

/** A COPY of a parsed store holding only accepted rows — what every verdict surface reads. Marks that
 *  end up empty are kept (an empty array is a real answer: "nothing accepted for this mark"). PURE. */
export function acceptedConflicts(doc) {
  if (!isPlainObject(doc?.marks)) return doc;
  const marks = {};
  for (const [mark, rows] of Object.entries(doc.marks)) {
    marks[mark] = (Array.isArray(rows) ? rows : []).filter(isAcceptedConflictRow);
  }
  return { ...doc, marks };
}

/**
 * Strict parse of one store file. Returns { schema_version, marks } (rows validated, unknown row keys
 * REJECTED token-first so a hand-edit typo is caught loudly, not silently ignored). Throws:
 *   known_conflicts_unparseable | known_conflicts_schema_future:<v> | known_conflicts_marks_invalid
 *   | known_conflicts_rows_invalid:<mark> | known_conflicts_row_key_unknown:<key>
 *   | known_conflicts_entry_uri_missing:<mark>
 */
export function parseKnownConflicts(raw) {
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error(`known_conflicts_unparseable: ${short(e.message)}`); }
  if (!isPlainObject(doc)) throw new Error("known_conflicts_unparseable: top level must be an OBJECT { schema_version, marks }");
  // A file from a NEWER driver says so in one field. Diagnose it as a version, not as whichever row
  // key happens to be unknown — "this store is newer than this driver" is the fact an operator needs
  // during a rollback, and it is the only shape of that fact a rollback can act on.
  const version = typeof doc.schema_version === "number" ? doc.schema_version : 1;
  if (version > STORE_SCHEMA_VERSION)
    throw new Error(`known_conflicts_schema_future:${version} (this driver writes and reads v${STORE_SCHEMA_VERSION}; the file was written by a NEWER driver — roll forward, or restore a v${STORE_SCHEMA_VERSION} store from scripts/backup-recall-stores.mjs)`);
  const marks = doc.marks;
  if (!isPlainObject(marks)) throw new Error("known_conflicts_marks_invalid (marks must be an object keyed by lowercased mark name)");
  for (const [mark, rows] of Object.entries(marks)) {
    if (!Array.isArray(rows)) throw new Error(`known_conflicts_rows_invalid:${short(mark)} (each mark key holds an ARRAY of rows)`);
    for (const r of rows) {
      if (!isPlainObject(r)) throw new Error(`known_conflicts_rows_invalid:${short(mark)} (each row must be a plain object)`);
      for (const k of Object.keys(r)) if (!ROW_KEYS.includes(k))
        throw new Error(`known_conflicts_row_key_unknown:${short(k)} (row keys are EXACTLY: ${ROW_KEYS.join(", ")})`);
      if (typeof r.uri !== "string" || !r.uri.trim())
        throw new Error(`known_conflicts_entry_uri_missing:${short(mark)} (every row needs a non-empty registration uri)`);
    }
  }
  return { schema_version: version, marks };
}

/**
 * Merge ledgers: union of mark keys; within a mark, union of rows deduped by canonical uri —
 * an EXISTING row's fields are never overwritten (human edits win; code only adds). PURE.
 *
 * Deliberately NOT terminal-monotone, unlike the write path: the upgrade belongs to the WRITE, which
 * holds the real fact ("a delivered run just confirmed this leg"). A merge only ever sees two stored
 * copies of a row, and the one path that can shadow a delivered row with a failed one — the legacy
 * matter-dir ledger folded first — cannot: legacy rows predate `terminal` entirely, so they parse as
 * accepted. Making merge overwrite would trade that non-problem for a real one, since rows are folded
 * BY REFERENCE here and the caller's document would mutate underneath it.
 */
export function mergeKnownConflicts(a, b) {
  const out = { schema_version: Math.max(a?.schema_version ?? 1, b?.schema_version ?? 1), marks: {} };
  for (const src of [a, b]) {
    if (!isPlainObject(src?.marks)) continue;
    for (const [mark, rows] of Object.entries(src.marks)) {
      if (!Array.isArray(rows)) continue;
      const have = out.marks[mark] ?? (out.marks[mark] = []);
      const seen = new Set(have.map((r) => canonicalUri(r?.uri).toLowerCase()));
      for (const r of rows) {
        const u = canonicalUri(r?.uri).toLowerCase();
        if (!u || seen.has(u)) continue;
        seen.add(u);
        have.push(r);
      }
    }
  }
  return out;
}

/**
 * Upsert one delivery's LIVE register legs under every searched mark name — the extraction of the
 * old inline pipeline writer, shared by the workspace store writer. `legs` = [{uri, mark_text,
 * classes, status, owner?, jurisdiction?, opposition_end?, deadline_source_uri?}]; rows are stamped
 * {source, ts, customer?} and uris canonicalized (the original survives as source_url when it
 * differed). Deduped by canonical uri. PURE — mutates and returns `ledger`.
 * Returns { ledger, added, upgraded }.
 *
 * ── ROUND-3 FIX: A DELIVERED WRITE UPGRADES AN EXISTING ROW'S `terminal` ────────────────────────────
 * Round 2 made the write append-only on the uri *including* provenance, and that quietly inverted the
 * fix it belonged to. Sequence, all of it the MODAL recovery path this PR's failed-terminal write was
 * added for — fail at verdict, re-run, deliver:
 *   A) the run dies at register-digest ⇒ the leg is stored `terminal:"failed:register-digest"`, and
 *      acceptedConflicts() correctly hides it from every verdict surface. Working as intended.
 *   B) the re-run DELIVERS and confirms the same leg ⇒ the write saw a known uri and skipped, so the
 *      row still reads "failed:register-digest" and the leg is hidden FOREVER. A leg a delivered run
 *      confirmed is exactly what the  recall tripwire exists to remember, and the branch had
 *      made it permanently invisible — strictly worse than before the store knew about terminals.
 * So a write whose own terminal is ACCEPTED lifts any matching unaccepted row to "delivered". This is
 * monotone (unaccepted → accepted, never the reverse: a later failed run cannot demote a leg a
 * delivered run confirmed), it is bounded to `terminal`, and `terminal` is machine provenance — no
 * human-authored field is touched, and a human who wants a row to stop mattering edits `status`.
 */
export function upsertDeliveryLegs(ledger, { names = [], legs = [], codename = "", ts = "", customer = null, terminal = "delivered" } = {}) {
  if (!isPlainObject(ledger.marks)) ledger.marks = {};
  const stamp = String(terminal || "delivered");
  const writeIsAccepted = isAcceptedConflictRow({ terminal: stamp });
  let added = 0, upgraded = 0;
  for (const name of names) {
    const key = String(name ?? "").toLowerCase().trim();
    if (!key) continue;
    const rows = Array.isArray(ledger.marks[key]) ? ledger.marks[key] : (ledger.marks[key] = []);
    // uri → EVERY row holding it (a hand-edited store may carry two; upgrading one and leaving the
    // other unaccepted would leave the same leg both visible and hidden).
    const have = new Map();
    for (const r of rows) {
      const u = canonicalUri(r?.uri).toLowerCase();
      if (!u) continue;
      if (!have.has(u)) have.set(u, []);
      have.get(u).push(r);
    }
    for (const leg of legs) {
      const canon = canonicalUri(leg?.uri);
      const u = canon.toLowerCase();
      if (!u) continue;
      if (have.has(u)) {
        if (writeIsAccepted) for (const r of have.get(u)) if (!isAcceptedConflictRow(r)) { r.terminal = "delivered"; upgraded++; }
        continue;
      }
      have.set(u, []);
      const row = { uri: canon, mark_text: leg?.mark_text ?? null, classes: leg?.classes ?? null, status: leg?.status ?? "live" };
      if (leg?.owner) row.owner = leg.owner;
      if (leg?.jurisdiction) row.jurisdiction = leg.jurisdiction;
      if (leg?.opposition_end) row.opposition_end = leg.opposition_end;
      if (leg?.deadline_source_uri) row.deadline_source_uri = leg.deadline_source_uri;
      if (String(leg?.uri ?? "").trim() && canon !== String(leg.uri).trim()) row.source_url = String(leg.uri).trim();
      if (customer) row.customer = customer;
      row.source = `auto:delivery ${codename}`;
      row.ts = ts;
      // ASSERTED on every auto row (review problem 3 + the house rule): "this row came from a
      // delivered run" and "this row came from a run that died at register-digest" are different
      // facts, and only the first may clamp a later verdict.
      row.terminal = stamp;
      rows.push(row);
      have.get(u).push(row);
      added++;
    }
  }
  return { ledger, added, upgraded };
}

// ── thin IO ─────────────────────────────────────────────────────────────────────────────────────────────

/** The workspace store dir for a run: <studioRoot>/_known-conflicts (studioRoot = 2 above the run dir). */
export function storeDirFor(studioRoot) {
  return join(studioRoot, "_known-conflicts");
}

/**
 * Read + merge the workspace store files for `names` (plus an optional legacy matter-dir ledger whose
 * HUMAN edits must keep winning for that matter). Returns a merged {schema_version, marks} or null
 * when nothing was found.
 *
 * `onError(path, err)` is called for every file that EXISTS and could not be used, and the caller must
 * wire it. A file that is present but unparseable and a mark that has never been searched both return
 * null here, and they are opposite facts: the first means the recall memory for a live mark is not
 * being read. Silence over that is the absence-reads-as-fine class the house rule forbids — it is
 * precisely how a rollback to a driver that does not know a newer row key would turn the whole recall
 * spine into a no-op with nothing in any log. A MISSING file stays silent: that is the normal state.
 */
export function readKnownConflictsFor(studioRoot, names, { legacyPath = null, onError = null } = {}) {
  let merged = null;
  const fold = (doc) => { merged = merged ? mergeKnownConflicts(merged, doc) : doc; };
  // Legacy matter-sibling ledger first: its rows (possibly human-edited) take precedence in the merge
  // (mergeKnownConflicts never overwrites an existing row).
  if (legacyPath && existsSync(legacyPath)) {
    try { fold(parseKnownConflicts(readFileSync(legacyPath, "utf8"))); }
    catch (e) { report(onError, legacyPath, e); }
  }
  const dir = storeDirFor(studioRoot);
  for (const name of new Set((names ?? []).map(markFileName).filter(Boolean))) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    try { fold(parseKnownConflicts(readFileSync(p, "utf8"))); }
    catch (e) { report(onError, p, e); }
  }
  return merged;
}

/**
 * Upsert one delivery's legs into the workspace store — ONE file per searched name, atomic
 * tmp+rename, existing file merged (its rows win). `onError(path, err)` fires for each file that
 * exists and could not be parsed, same contract as the read.
 * Returns { added, upgraded, unreadable } across files — three counts a caller asserts unconditionally
 *: "nothing new", "an old row was confirmed by this delivery" and "a file is unusable" are
 * three different answers, and a bare `added: 0` reads as the healthy steady state for all three.
 */
export function writeKnownConflictsFor(studioRoot, { names = [], legs = [], codename = "", ts = "", customer = null, terminal = "delivered", onError = null } = {}) {
  const dir = storeDirFor(studioRoot);
  let added = 0, upgraded = 0, unreadable = 0;
  for (const name of names ?? []) {
    const file = markFileName(name);
    if (!file) continue;
    const p = join(dir, file);
    let ledger = { schema_version: STORE_SCHEMA_VERSION, marks: {} };
    // review fix: an UNREADABLE existing file is SKIPPED, never rebuilt — "rebuild from scratch"
    // would destroy a human-edited store (a hand-added annotation key is a parse throw) on the very
    // path whose contract is "human edits win". The mark simply stops accruing auto rows until the
    // file is fixed; the read side skips it the same way. It is REPORTED, though: a mark that has
    // silently stopped remembering anything is the failure this store cannot afford.
    try { if (existsSync(p)) ledger = parseKnownConflicts(readFileSync(p, "utf8")); }
    catch (e) { unreadable++; report(onError, p, e); continue; }
    const r = upsertDeliveryLegs(ledger, { names: [name], legs, codename, ts, customer, terminal });
    if (!r.added && !r.upgraded) continue;
    // Stamp the version we actually wrote. A v1 file that gains a v3 row IS a v3 file, and saying so
    // is what lets any later reader diagnose itself instead of tripping over an unknown row key.
    r.ledger.schema_version = Math.max(Number(r.ledger.schema_version) || 1, STORE_SCHEMA_VERSION);
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${p}.tmp`, JSON.stringify(r.ledger, null, 2) + "\n");
    renameSync(`${p}.tmp`, p);
    added += r.added;
    upgraded += r.upgraded;
  }
  return { added, upgraded, unreadable };
}
