// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// degraded-parts.mjs — the parts of a report that failed, degraded or were skipped while the report still
// shipped, read from the run's record at delivery so the audit workbook can say so.
//
// THE RULE (ruled 2026-09-25): run clean first time; if not, retry and recover; and anything that still
// failed, short of a failure that makes the report meaningless, is delivered and flagged in the audit. The
// defect this module exists for is the part that fails silently: the report ships without it and nothing
// in the delivery says so.
//
// READ FROM THE STATE AT DELIVERY, NEVER FROM HISTORY. The run log is append-only across resumes, so a
// failure that a retry or a resume later recovered is still in it. Each check reads what the delivery can
// see: the stage's own last attempt, the artifact the part is built from, or the last event its step
// wrote. A part that recovered writes no row.
//
// THE WORDS ARE THE WORKBOOK'S OWN. A check names its part with a label the report or the workbook already
// prints (PART_NAMES, each held to its source by a test) and gives a reason token that the shipped
// deferral row translates into its reader's words. The row is that builder's, so this module writes no
// sentence, and no raw cause reaches a reader's cell: the cause stays on the run's record.
//
// A pure leaf: node:fs, node:path, shared/driver-dir.mjs and the row's own module only, so it cannot drag
// driver.config.mjs, whose unset-env defaults are PRODUCTION, into anything that imports it.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { deferralCoverageRow } from "./deferral-row.mjs";

// The name each part is given: a label the report or the workbook already prints. Never a new phrase.
export const PART_NAMES = {
  courtDecisions: "Court decisions",   // the report's search-coverage row (publish/render.mjs)
  searchLog: "What was searched",      // the workbook's tab (publish/xlsx.mjs)
  register: "Register",                // the report's search-coverage row (publish/render.mjs)
  localLanguage: "Local-language investigation",   // the report's search-coverage row (publish/render.mjs)
  findings: "Findings",                // the workbook's tab (publish/xlsx.mjs)
  machineQc: "Machine QC",             // the workbook's Summary row for the checks (publish/xlsx.mjs)
};

// Reason tokens the shipped deferral row translates (deferral-row.mjs, plainDeferralReason). Only these two
// reach it from here, so the reader's line is one of the row's own and never the raw cause.
export const TIMED_OUT = "mechanical-fail:timeout";   // → "the source timed out this run"
export const NOT_COMPLETED = "unfinished";            // → the row's fallback: "it could not be completed this run, …"

export const DEGRADED_PARTS_FILE = "degraded-parts.json";

const readJsonl = (p) => {
  try {
    return readFileSync(p, "utf8").split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};

/** The stage's own last attempt row, or null when the stage wrote none. */
export function lastAttempt(runDir, stage) {
  const rows = readJsonl(driverDir(runDir, `${stage}.jsonl`))
    .filter((r) => Number.isFinite(Number(r?.attempt)) && typeof r.ok === "boolean");
  return rows.length ? rows[rows.length - 1] : null;
}

/** The last run-log event carrying one of `names`, or null. */
const lastEvent = (log, names) => {
  for (let i = log.length - 1; i >= 0; i--) if (names.includes(log[i]?.event)) return log[i];
  return null;
};

const reasonFor = (fail) => (/timeout|timed out/i.test(String(fail ?? "")) ? TIMED_OUT : NOT_COMPLETED);

// ── The checks. Each returns null, or {part, name, reason, cause}: `cause` is the raw fact for the run's
// record and never reaches a cell.

// Court decisions, on a run that was due them: the stage ended failed, or its file is absent or empty. An
// empty file reads "not in scope" on the report (publish/search-depth.mjs), so nothing else says it.
function courtDecisions(runDir, log) {
  if (lastEvent(log, ["case-law-decision"])?.run !== true) return null;
  const last = lastAttempt(runDir, "case-law");
  const part = { part: "court-decisions", name: PART_NAMES.courtDecisions };
  if (last?.ok === false) return { ...part, reason: reasonFor(last.fail), cause: `the case-law stage ended failed: ${last.fail ?? "no cause recorded"}` };
  let text;
  try { text = readFileSync(join(runDir, "case-law-findings.md"), "utf8"); } catch { text = null; }
  if (text === null) return { ...part, reason: NOT_COMPLETED, cause: "case-law-findings.md is absent" };
  if (!text.trim()) return { ...part, reason: NOT_COMPLETED, cause: "case-law-findings.md is empty" };
  return null;
}

// The search log the workbook's "What was searched" tab is built from. Without it the tab lists no
// register search at all.
function searchLog(runDir) {
  let text;
  try { text = readFileSync(join(runDir, "audit.md"), "utf8"); } catch { text = null; }
  if (text !== null && text.trim()) return null;
  return { part: "search-log", name: PART_NAMES.searchLog, reason: NOT_COMPLETED,
    cause: text === null ? "audit.md is absent" : "audit.md is empty" };
}

// A step whose last word in the run log was its failure: `ok` names the event it writes when it succeeds,
// so a later success on a resume clears it.
const failedStep = (log, ok, failed) => {
  const last = lastEvent(log, [ok, failed]);
  return last?.event === failed ? last : null;
};
const stageEnded = (runDir, stage) => {
  const last = lastAttempt(runDir, stage);
  return last?.ok === false ? last : null;
};

// The register's own steps, each of which the run survives without: the band's shape (the floors and the
// full cards read it), the mechanical form floor, the owner screen, and the digest's folding in of re-runs.
function register(runDir, log) {
  const part = { part: "register", name: PART_NAMES.register, reason: NOT_COMPLETED };
  const steps = [
    ["band-shape-derived", "band-shape-failed", "the band shape"],
    ["form-neighbourhood-derived", "form-neighbourhood-skipped", "the form floor"],
    ["owner-screen-derived", "owner-screen-failed", "the owner screen"],
    ["digest-flush", "digest-flush-failed", "the digest flush"],
  ];
  const failed = steps.map(([ok, bad, what]) => [failedStep(log, ok, bad), what]).filter(([e]) => e);
  if (!failed.length) return null;
  return { ...part, cause: failed.map(([e, what]) => `${what}: ${e.fail ?? e.reason ?? e.event}`).join("; ") };
}

// A finding's written card: its stage ended failed, so the card shipped with its structured rows only.
function findingCards(runDir) {
  let files = [];
  try { files = readdirSync(driverDir(runDir)).filter((f) => /^report-card:.+\.jsonl$/.test(f)); } catch { return null; }
  const failed = files.map((f) => f.slice(0, -".jsonl".length)).filter((stage) => stageEnded(runDir, stage));
  if (!failed.length) return null;
  return { part: "finding-cards", name: PART_NAMES.findings, reason: NOT_COMPLETED, cause: `card stages ended failed: ${failed.join(", ")}` };
}

// The checks that stand behind the report without appearing in it: the frame's omission check (the blind
// frame and the frame diff), the reviewer's pass and its re-check, a corrective pass that rolled back, and
// the crowd counts the judgment reads. Each shares the one name, so they are one reader's line.
function checks(runDir, log) {
  const failed = [];
  const blind = stageEnded(runDir, "blind-frame");
  if (blind) failed.push(["the blind frame", blind.fail]);
  const diff = failedStep(log, "frame-diff", "frame-diff-skipped");
  if (diff && !blind) failed.push(["the frame diff", diff.reason]);
  const skeptic = stageEnded(runDir, "skeptic");
  if (skeptic) failed.push(["the reviewer's pass", skeptic.fail]);
  const recheck = stageEnded(runDir, "narrative-refutation");
  if (recheck) failed.push(["the review's re-check", recheck.fail]);
  const rollback = failedStep(log, "corrective-cycle-receipt", "corrective-rollback");
  if (rollback) failed.push(["the corrective pass, rolled back", rollback.reason]);
  const crowd = failedStep(log, "crowd-context", "crowd-context-failed");
  if (crowd) failed.push(["the crowd counts", crowd.fail]);
  if (!failed.length) return null;
  return { part: "checks", name: PART_NAMES.machineQc, reason: reasonFor(failed.map(([, why]) => why).join("; ")),
    cause: failed.map(([what, why]) => `${what}: ${why ?? "no cause recorded"}`).join("; ") };
}

// The native-language investigation, where lanes were asked and none of them ran. The caller hands in the
// state publishing prints (publish/search-depth.mjs, localLanguageDepth): the lanes' own record is read
// through jx.mjs, which this leaf may not import. A lane that ran short of its depth is not read here, because
// the run cannot yet tell a shortfall from a limit of the product.
function localLanguage(runDir, log, { localLanguage: state = null } = {}) {
  if (state !== "not-run") return null;
  return { part: "local-language", name: PART_NAMES.localLanguage, reason: NOT_COMPLETED, cause: "native-language lanes were asked and none of them ran" };
}

const CHECKS = [courtDecisions, searchLog, register, localLanguage, findingCards, checks];

/**
 * Every part of this clearance run that failed and still ships, read from the run directory as it stands
 * at delivery. `opts.localLanguage` is the native-language state publishing prints, when the run has lanes. A check that cannot read its input reads nothing and reports nothing; the run's own record
 * already carries that input's failure. PURE apart from reading `runDir`.
 */
export function degradedParts(runDir, opts = {}) {
  const log = readJsonl(driverDir(runDir, "run.jsonl"));
  return CHECKS.map((check) => check(runDir, log, opts)).filter(Boolean);
}

/**
 * The rows the audit workbook prints for `parts`: the shipped deferral row. One row per name: two parts
 * that share a name are one reader's line, and both causes stay on the record.
 */
export function degradedPartRows(parts) {
  const seen = new Set();
  const rows = [];
  for (const p of parts) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    rows.push(deferralCoverageRow(p.name, p.reason));
  }
  return rows;
}

/** Write the parts and their rows to the run's record, where publishing and a later republish read them. */
export function writeDegradedParts(runDir, parts) {
  const record = { parts, rows: degradedPartRows(parts) };
  writeFileSync(driverDir(runDir, DEGRADED_PARTS_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** The rows written at delivery, or [] for a run that wrote none (every run before this change). */
export function readDegradedPartRows(runDir) {
  try {
    const rows = JSON.parse(readFileSync(driverDir(runDir, DEGRADED_PARTS_FILE), "utf8"))?.rows;
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.area === "string" && typeof r.note === "string") : [];
  } catch { return []; }
}
