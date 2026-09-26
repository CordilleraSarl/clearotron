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
// A pure leaf: node:fs, node:path, shared/driver-dir.mjs, the row's own module and the publisher's table of
// stores (itself node:fs and node:path only), so it cannot drag driver.config.mjs, whose unset-env defaults
// are PRODUCTION, into anything that imports it.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir, labelOfDriverFile } from "../shared/driver-dir.mjs";   // a card's label carries a colon, which Windows writes %3A
import { deferralCoverageRow } from "./deferral-row.mjs";
import { PUBLISH_INPUTS, readStore } from "./publish/publish-inputs.mjs";

// The name each part is given: a label the report or the workbook already prints. Never a new phrase.
export const PART_NAMES = {
  courtDecisions: "Court decisions",   // the report's search-coverage row (publish/render.mjs)
  searchLog: "What was searched",      // the workbook's tab (publish/xlsx.mjs)
  register: "Register",                // the report's search-coverage row (publish/render.mjs)
  localLanguage: "Local-language investigation",   // the report's search-coverage row (publish/render.mjs)
  findings: "Findings",                // the workbook's tab (publish/xlsx.mjs)
  machineQc: "Machine QC",             // the workbook's Summary row for the checks (publish/xlsx.mjs)
  conditions: "Conditions",            // the gaps sheet's area for a condition that reaches no page (publish/index.mjs)
  coverage: "Coverage & gaps",         // the workbook's tab (publish/xlsx.mjs)
  marketplaceWeb: "Marketplace and web",   // the report's search-coverage row (publish/render.mjs)
  machineChecks: "Machine Checks",     // the knockout workbook's sheet (publish/knockout.mjs)
  aboutThisRequest: "About this request",   // the knockout report's heading (publish/render-knockout.mjs)
};

// The words the owner ruled where no shipped label or line fitted (537 and 539, 2026-09-25), each held to
// the ruling verbatim by a test. They are his; nothing here composes around them.
export const RULED_WORDS = {
  officialRecords: "Official records",          // the register records behind a clearance's cards
  plainLanguageReview: "Plain-language review", // the knockout pass that rewrites the rater's wording
  // A knockout web search that ran, whose answer reached the report, and whose trail entry was never written.
  recordNotKept: "The record of this search was not kept this run; its answer was used",
};

/** A filing's Note when its link was removed because the address is not on the register's own site (537). */
export const linkNotOnRegisterSite = (register) => `Address not on this register's own site (${register}); cited by number`;

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
//
// MATCHED ON THE LABEL, NEVER ON THE FILE NAME. A card's stage label carries a colon — `report-card:3` —
// and Windows cannot hold one, so `driverFileName` writes it `%3A` there and this filter's raw colon
// matched nothing: `degradedParts` returned an empty list, and the audit workbook then reported coverage
// CLOSED over a card that failed. On Linux the two spellings are the same string, which is why every arm
// was green and only the scheduled Windows run showed it.
//
// `labelOfDriverFile` decodes `%3A` on every platform and strips the extension, so the label is the same
// on both and the predicate reads it rather than the bytes on disk. The label is also what `stageEnded`
// wants: it resolves its path through `driverDir`, which re-encodes the colon for the platform it is on,
// so handing it the raw name would send Windows looking for a file it never wrote.
function findingCards(runDir) {
  let files = [];
  try { files = readdirSync(driverDir(runDir)).filter((f) => f.endsWith(".jsonl")); } catch { return null; }
  const failed = files.map((f) => labelOfDriverFile(f)).filter((stage) => /^report-card:.+/.test(stage))
    .filter((stage) => stageEnded(runDir, stage));
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

/**
 * The fetched official records, `_records/*.json`: "absent" with no file, "damaged" when files are there
 * and none of them parses, "read" otherwise. It asks what registry-fidelity.mjs readRecordArtifacts asks
 * of the same folder, which skips a file it cannot parse, only whether anything survived.
 */
export function recordsState(runDir) {
  let files;
  try { files = readdirSync(join(runDir, "_records")).filter((f) => f.endsWith(".json")); } catch { return "absent"; }
  if (!files.length) return "absent";
  for (const f of files) {
    try {
      const body = JSON.parse(readFileSync(join(runDir, "_records", f), "utf8"));
      if (body && typeof body === "object" && !Array.isArray(body)) return "read";
    } catch { /* the next file */ }
  }
  return "damaged";
}

// The official records behind the cards, where the run's record set was built from a fetch ledger it could
// not read: the set is empty for that reason, and the cards print what the model wrote with nothing to check
// it against and no mark that it went unchecked. Two cases are left out on purpose. A merely empty set is the
// product's design on a register whose report cites no record address, which never fetches one. And the
// count of fetches whose bodies went missing is taken before the closure fetch, which can still close it.
function officialRecords(runDir, log) {
  const last = lastEvent(log, ["record-artifacts"]);
  if (!last?.ledgerError) return null;
  return { part: "official-records", name: RULED_WORDS.officialRecords, reason: NOT_COMPLETED,
    cause: `the fetch ledger could not be read: ${last.ledgerError}` };
}

const CHECKS = [courtDecisions, searchLog, register, localLanguage, findingCards, checks, officialRecords];

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

/**
 * Write the parts and their rows to the run's record, where publishing and a later republish read them,
 * with the state of every store the publisher reads as delivery found it: the evidence a republish needs
 * to tell a store this run lost from one it never had.
 */
export function writeDegradedParts(runDir, parts) {
  const record = { parts, rows: degradedPartRows(parts), stores: storeStates(runDir) };
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

// ── AT PUBLISH: THE STORES A REPUBLISH OR A DISK FAULT CAN TAKE ──────────────────────────────────────
//
// Two things only the publisher sees. A store that is PRESENT AND UNREADABLE when it is read: an archived
// run is never in that state, only a missing one, so it cannot fire on older work. And a store that
// delivery read and a later republish finds MISSING: the delivery's own record of what it read is the
// evidence, so a run delivered before that record existed writes nothing, as before.
//
// Each store the publisher reads is the part it feeds, named with a label the report or workbook prints,
// or it is declared out with the reason, so a new store cannot be added without deciding which.
export const STORE_PARTS = {
  "findings.json": "findings",
  "_driver/receipts.json": "officialRecords",
  "_driver/senior-rights.json": "officialRecords",
  "_driver/verdict.json": "conditions",
  "_driver/framework.json": "findings",
  "_driver/register-recall.json": "coverage",
  "_driver/register-plan.json": "register",
  "register-named-band.json": "register",
  "_driver/instructed-scope.json": "register",
  "_driver/jx-lanes.json": "localLanguage",
  "_driver/jx/units.json": "localLanguage",
  "case-law-findings.md": "courtDecisions",
  "case-law-citations.json": "courtDecisions",
  "_driver/predelivery-lint.json": "machineQc",
  "_driver/escalation-state.json": "machineQc",
  "_driver/reasoning-integrity.json": "machineQc",
  "_driver/corrections-state.json": "machineQc",
  "common-law-grid.json": "marketplaceWeb",
};

/** The stores no row describes honestly, each with its reason. */
export const STORES_WITHOUT_A_PART = {
  "_driver/enforcer-signals.json": "presentation-only lines about enforcement, and no shipped name describes them",
  "status.json": "the pool's mark name and a machine note, neither of them a part of the report",
  "_driver/search-policy.json": "the product's identity, which no shipped name describes",
  "_driver/profile.json": "the pool's profile stamp, not a part of the report",
};

// The record set is a folder, not a named store (publish-inputs.mjs NOT_READ_BY_NAME), and is read as one.
const RECORDS = "_records/";

const partName = (key) => PART_NAMES[key] ?? RULED_WORDS[key];

/** The state of every store the publisher reads, as `base` holds it now: read, damaged or absent. */
export function storeStates(base) {
  const states = {};
  for (const name of Object.keys(PUBLISH_INPUTS)) {
    try { states[name] = readStore(base, name).state; } catch { states[name] = "damaged"; }
  }
  states[RECORDS] = recordsState(base);
  return states;
}

/** The store states delivery recorded, or null for a run delivered before it recorded them. */
export function readDeliveredStores(runDir) {
  try {
    const stores = JSON.parse(readFileSync(driverDir(runDir, DEGRADED_PARTS_FILE), "utf8"))?.stores;
    return stores && typeof stores === "object" && !Array.isArray(stores) ? stores : null;
  } catch { return null; }
}

/**
 * The parts publishing finds degraded, from the store states now and, where delivery recorded them, then.
 * PURE over its inputs. `now` is `storeStates(base)`; `delivered` is `readDeliveredStores(runDir)`.
 */
export function degradedAtPublish(now = {}, delivered = null) {
  const parts = [];
  const mapped = { ...STORE_PARTS, [RECORDS]: "officialRecords" };
  for (const [store, key] of Object.entries(mapped)) {
    const state = now[store];
    const cause = state === "damaged" ? `${store} is present and cannot be read`
      : state === "absent" && delivered?.[store] === "read" ? `${store} was read at delivery and is missing now`
        : null;
    if (cause) parts.push({ part: `store:${store}`, name: partName(key), reason: NOT_COMPLETED, cause });
  }
  return parts;
}

/** One row per area across lists, the first kept: delivery's rows, then publishing's. */
export function mergeDegradedRows(...lists) {
  const seen = new Set();
  const rows = [];
  for (const r of lists.flat()) {
    if (!r || typeof r.area !== "string" || seen.has(r.area)) continue;
    seen.add(r.area);
    rows.push(r);
  }
  return rows;
}

// ── THE KNOCKOUT: A STEP THAT FAILED AS A WHOLE ───────────────────────────────────────────────────────
//
// The listing of filings and the owner lookups each end in one run-log event, a success or a failure, and
// the last of the pair is the step's state at delivery, so a resume that succeeded clears it. The
// plain-language review logs its outcome; the three that ship the rater's wording unreviewed are failures.
const REVIEW_FAILED = ["stage-failed", "artifact-unreadable", "rewrite-refused-by-the-merged-gate"];

/** Which of the knockout's whole steps ended failed, each with its raw cause for the run's record. */
export function knockoutStepFailures(runDir) {
  const log = readJsonl(driverDir(runDir, "run.jsonl"));
  const listing = lastEvent(log, ["knockout-register-records", "knockout-register-records-refused", "knockout-register-records-failed"]);
  const owners = failedStep(log, "knockout-owner-checks", "knockout-owner-checks-failed");
  const review = lastEvent(log, ["knockout-review"]);
  const cause = (e) => String(e?.cause ?? e?.reason ?? e?.outcome ?? e?.event ?? "no cause recorded");
  return {
    listing: listing?.event === "knockout-register-records-failed" ? { reason: reasonFor(cause(listing)), cause: cause(listing) } : null,
    ownerChecks: owners ? { reason: reasonFor(cause(owners)), cause: cause(owners) } : null,
    review: REVIEW_FAILED.includes(review?.outcome) ? { reason: reasonFor(cause(review)), cause: `${review.outcome}: ${cause({ reason: review.reason })}` } : null,
  };
}
