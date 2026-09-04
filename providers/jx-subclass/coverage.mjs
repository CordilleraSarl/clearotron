// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage.mjs — what this database has actually READ, as opposed to what it happens to hold rows for.
// Zero dependencies (node:sqlite only), the same pattern as providers/uspto-local/src/index-store.js.
//
// ── THE ONE THING THIS FILE EXISTS TO GET RIGHT ────────────────────────────────────────────────────
//
// A similar-group lookup that finds nothing returns the same empty result whether the office publishes
// no cross-references for that class or nobody has opened the page yet. In a clearance search the first
// is a clean negative and the second is a FALSE CLEAR — telling a client two conflicting marks are
// unrelated because the table is half-transcribed.
//
// The China data made this concrete while it was half-read: `cross_reference` held zero CN rows for
// class 15 AND for class 30, because class 15 was read and genuinely carries no 注 block while class 30
// had never been opened. Nothing in the rows distinguished them. CN is now read end to end
// (`cn/coverage.json`: printed 4-252, `unread_pages: "none"`), so today the read-and-empty classes are
// 15 and 33 and no CN class is unread — but the two states are still indistinguishable in the rows,
// and the next tranche or office reintroduces the mix.
//
// assertIndexReady() does not help here: it fires on an EMPTY table, and this table is not empty — it
// holds 1,959 CN rows. A partial table passes every existence check and answers confidently about the
// part it never read.
//
// So coverage is STATED, never DERIVED. Deriving it from the rows that landed would call classes 15
// and 33 "not reached" (they have no rows) and, the other way round, would have called class 30
// "empty" while it was unread (same). Both readings are wrong and both fail silently. The manifests say what was read; this module refuses
// anything outside it.
//
// A MISSING ROW REFUSES. Omission is the failure mode a stated table invites, so absence is never
// treated as permission.
import { DatabaseSync } from "node:sqlite";

export const COVERAGE_DDL = `
  CREATE TABLE IF NOT EXISTS coverage (
    office          TEXT NOT NULL CHECK (office IN ('CN','JP','KR','TW')),
    -- The table this row describes. A database can be complete for one layer and untranscribed for
    -- another: CN group codes cover all 45 classes while CN cross-references stop at class 24.
    layer           TEXT NOT NULL CHECK (layer IN ('group_code','cross_reference','class_span')),
    nice_class      INTEGER NOT NULL CHECK (nice_class BETWEEN 1 AND 45),
    status          TEXT NOT NULL CHECK (status IN ('extracted','partial','pending','not_applicable')),
    read_pages      TEXT,
    groups_no_notes TEXT,
    source_document TEXT,
    edition         TEXT,
    note            TEXT,
    PRIMARY KEY (office, layer, nice_class)
  );`;

/** The coverage row, or null when none was stated. Null is NOT a pass — see assertCovered. */
export function coverageFor(db, { office, layer, niceClass }) {
  return db.prepare(
    "SELECT * FROM coverage WHERE office = ? AND layer = ? AND nice_class = ?",
  ).get(String(office), String(layer), Number(niceClass)) ?? null;
}

export class CoverageError extends Error {
  constructor(message, detail) { super(message); this.name = "CoverageError"; Object.assign(this, detail); }
}

/**
 * Throw unless this office/layer/class was read. Returns the coverage row when it was.
 *
 * `extracted`      → returns. A zero-row answer under it is a real clean negative.
 * `not_applicable` → returns. The office does not publish this layer at all (JP states similarity as a
 *                    class span, not as group→group notes), so zero rows is the correct final answer.
 * `partial`        → throws. Some of the class was read. Answering from it understates by an unknown amount.
 * `pending`        → throws. Never opened.
 * no row           → throws. A layer nobody stated coverage for cannot be assumed complete.
 */
export function assertCovered(db, { office, layer, niceClass, path = "the similar-group database" }) {
  const row = coverageFor(db, { office, layer, niceClass });
  const where = `${office} ${layer} class ${niceClass}`;
  if (!row) {
    throw new CoverageError(
      `[similar-groups] ${path} states no coverage for ${where}. An unstated layer is not an empty one — `
      + "it must refuse, never answer zero.",
      { office, layer, niceClass, status: null },
    );
  }
  if (row.status === "extracted" || row.status === "not_applicable") return row;
  const why = row.status === "partial"
    ? `only part of it has been transcribed (${row.read_pages ?? "range not stated"})`
    : "it has not been transcribed yet";
  throw new CoverageError(
    `[similar-groups] ${path} cannot answer for ${where}: ${why}. `
    + `${row.note ?? ""} A partial table answering zero is a false clear, not a clean negative.`.trim(),
    { office, layer, niceClass, status: row.status, readPages: row.read_pages ?? null },
  );
}

/** Every class whose status is not extracted/not_applicable, for a health line or a report footer. */
export function gaps(db, { office, layer } = {}) {
  const w = [], p = [];
  if (office) { w.push("office = ?"); p.push(String(office)); }
  if (layer) { w.push("layer = ?"); p.push(String(layer)); }
  w.push("status NOT IN ('extracted','not_applicable')");
  return db.prepare(`SELECT office, layer, nice_class, status, note FROM coverage
                     WHERE ${w.join(" AND ")} ORDER BY office, layer, nice_class`).all(...p);
}

/**
 * Every (office, layer) pair must state all 45 classes. A manifest that lists 44 leaves one class
 * refusing for a reason nobody wrote down, which reads as a data gap when it is a bookkeeping gap.
 */
export function assertCoverageComplete(db) {
  const bad = db.prepare(`SELECT office, layer, COUNT(*) n FROM coverage
                          GROUP BY office, layer HAVING n <> 45`).all();
  if (bad.length) {
    throw new CoverageError(
      "[similar-groups] coverage manifest is incomplete: "
      + bad.map((r) => `${r.office}/${r.layer} states ${r.n} of 45 classes`).join("; "),
      { incomplete: bad },
    );
  }
  return true;
}

export function openCoverage(path = "similar-groups.db") {
  return new DatabaseSync(path, { readOnly: true });
}
