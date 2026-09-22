// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// common-law-coverage-status.mjs — a common-law seat's coverage statuses, recorded as VALUES.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────────
//
// The common-law gate refused a finished findings file unless one of three exact words appeared
// somewhere in its prose (`no_coverage_status_row`). The research did not change the outcome; the model's
// phrasing did. On the codex engine, 13 of 22 failed common-law attempts on the test box (16-22 September)
// were that word, each one a full stage re-run. The register path had already solved the same problem:
// its seat rules coverage through `record_coverage` and the driver writes the form.
//
// This is that shape for the common-law lane. The seat calls `record_coverage_status` (dispositions
// server) with one {unit, status} entry per ledger row; this module validates each entry, folds it into
// the half's accumulator and writes the file. The gate reads the file before it looks for the word.
//
// ── ONE TOOL, THE DRIVER WRITES THE FILE ─────────────────────────────────────────────────────────────
//
// The seat is never told a file name or a JSON shape. A model typing a structured document is how 74
// correct meaning rulings were once voided by a quote character (dispositions-server.mjs states the
// case), and the contract audit's E3 check refuses a literal skeleton in a manual for that reason. Here
// the serialization is ours.
//
// ── ONE DERIVATION OF THE PATH ──────────────────────────────────────────────────────────────────────
//
// The writer names the file from the grid spec it was handed and the reader from the findings file it is
// judging; both go through coverageStatusPath(). The findings name the writer derives is the one
// stages.mjs's paths() dictates, and a test holds the two equal.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";

/**
 * The three statuses a common-law coverage ledger row may carry, as data and as prose alike. Not the
 * register's COVERAGE_STATUSES: that list adds `withheld-by-judgment`, which is the register's reading turn
 * and never a common-law status.
 */
export const COMMON_LAW_COVERAGE_STATUSES = Object.freeze(["confirmed-clean", "coverage-limited", "deferred"]);

/** A findings file's statuses: `_driver/<findings name>.coverage-status.json`, driver-written, never the seat's. */
export const coverageStatusPath = (findingsPath) =>
  driverDir(dirname(String(findingsPath)), basename(String(findingsPath)).replace(/\.md$/, ".coverage-status.json"));

/** The findings file a grid spec's seat writes: the half's, or the canonical file on an unsplit run. */
export const findingsPathForSpec = (spec) =>
  join(dirname(String(spec.output_path)), spec.half ? `common-law-findings.half-${spec.half}.md` : "common-law-findings.md");

const readStatuses = (file) => {
  let doc;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  const rows = doc?.coverage_status;
  return rows && typeof rows === "object" && !Array.isArray(rows) ? rows : null;
};

/**
 * Is this findings file's coverage status on record as data? At least one entry, every value one of
 * COMMON_LAW_COVERAGE_STATUSES. Anything else — absent, unparseable, empty, a value outside the three — is
 * NOT data, and the caller falls back to the prose word, so the file can never turn a passing document into
 * a failing one.
 *
 * THE MERGED FILE IS THE HALVES. The driver writes `common-law-findings.md` by concatenating the halves'
 * findings, so its statuses are theirs: a half that stated its status only as data leaves no word in the
 * merge. For that file the halves' records answer too.
 */
export function coverageStatusAsData(findingsPath) {
  if (!findingsPath) return false;
  const p = String(findingsPath);
  const valid = (file) => {
    const rows = readStatuses(file);
    const values = rows ? Object.values(rows) : [];
    return values.length > 0 && values.every((v) => COMMON_LAW_COVERAGE_STATUSES.includes(String(v).trim().toLowerCase()));
  };
  if (valid(coverageStatusPath(p))) return true;
  if (basename(p) !== "common-law-findings.md") return false;
  const dir = driverDir(dirname(p));
  let names = [];
  try { names = readdirSync(dir); } catch { return false; }
  return names.filter((n) => /^common-law-findings\.half-[a-z0-9]+\.coverage-status\.json$/.test(n))
    .some((n) => valid(join(dir, n)));
}

/**
 * Record one typed call. `spec` is the DRIVER-WRITTEN grid spec, the same file the grid tool was given, so
 * the seat names no path of its own. Entries that validate are kept even when others in the same call are
 * refused, and statuses accumulate: a later entry for the same unit replaces the earlier one.
 */
export function recordCoverageStatus(spec, received, { now = () => new Date().toISOString() } = {}) {
  const rows = received?.rows;
  if (!Array.isArray(rows) || rows.length === 0)
    return { ok: false, text: "ERROR: rows is required — one entry per coverage ledger row, each {unit, status}." };
  const accepted = [], refused = [];
  rows.forEach((r, i) => {
    const unit = String(r?.unit ?? "").trim();
    const status = String(r?.status ?? "").trim().toLowerCase();
    if (!unit) refused.push(`entry ${i + 1}: unit is empty — name the coverage unit exactly as your ledger row does`);
    else if (!COMMON_LAW_COVERAGE_STATUSES.includes(status))
      refused.push(`entry ${i + 1} (${unit.slice(0, 80)}): status "${String(r?.status ?? "").slice(0, 40)}" is not one of ${COMMON_LAW_COVERAGE_STATUSES.join(" / ")} — qualifiers belong in the ledger row, not here`);
    else accepted.push([unit, status]);
  });
  const file = coverageStatusPath(findingsPathForSpec(spec));
  if (accepted.length) {
    const statuses = { ...(readStatuses(file) ?? {}), ...Object.fromEntries(accepted) };
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ coverage_status: statuses, half: spec.half ?? null, recorded_at: now() }, null, 2) + "\n");
    } catch (e) {
      return { ok: false, text: `ERROR: the driver could not record this call (${String(e?.message ?? e).slice(0, 200)}). This is a driver fault, not a fault in your statuses — do not re-type them.` };
    }
  }
  const lines = [`Recorded ${accepted.length} of ${rows.length}.`];
  if (refused.length) lines.push("Refused — send these again, corrected:", ...refused.map((x) => `- ${x}`));
  return { ok: refused.length === 0, text: lines.join("\n") };
}
