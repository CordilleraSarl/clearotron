// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-end-state.mjs — what a clearance writes as it ends: the sentinels that gate a resume or a delivery, the scope facts
// and identity record, the front matter laid on the report, the assessment's coverage rows, the assessment set aside,
// the search log audit, and the archive with the what-ifs it settles first.
//
// Moved out of pipeline.mjs unchanged, so that the steps and the delivered ending import these instead of having them
// handed in.
import { driverDir } from "../shared/driver-dir.mjs";
import { coverageFormInput, readCoverageForm, waitingFamilyStates } from "./coverage-form-io.mjs";
import { buildCoverageForm, formLedgerRows } from "./coverage-form.mjs";
import { coverageUnitLabel } from "./coverage-ledger.mjs";
import { orderMarketsOf } from "./coverage-rows-run.mjs";
import { declinationCallPaths } from "./declination-tool.mjs";
import { plainDeferralReason } from "./deferral-row.mjs";
import { NOT_COMPLETED } from "./degraded-parts.mjs";
import { readReadingLog } from "./delivered-record-run.mjs";
import { REGISTER_PROVIDER } from "./driver.config.mjs";
import { fileMeta, note, runLog } from "./log.mjs";
import { NOT_COMPLETED_DIR } from "./parts-not-completed.mjs";
import { buildAuditMd } from "./publish/audit-from-spine.mjs";
import { loadCoverageLedger } from "./register-digest-run.mjs";
import { CORRECTIVE_RECHECK_FILE } from "./repair-review-run.mjs";
import { IDENTITY_FILE as REPORT_IDENTITY_FILE } from "./report-overview-record.mjs";
import { atomicWrite } from "./run-record.mjs";
import { deriveScopeFacts } from "./scope-facts.mjs";
import { projectStageInput, restamp } from "./stage-freshness.mjs";
import { providerMeta } from "./stages.mjs";
import { claimWhatIf, finishWhatIf, pendingWhatIf, whatIfRefusal } from "./whatif-queue.mjs";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export function sentinel(runDir, name, obj) {
  // B5 — sentinels gate resume/delivery decisions: a truncated one must never be visible (tmp + rename).
  atomicWrite(join(runDir, name), JSON.stringify({ ts: new Date().toISOString(), ...obj }, null, 2) + "\n");
}

/**
 * Settle every queued what-if BEFORE the run dir moves into the archive.
 *
 * A queued job lives under the run directory, and the worker enumerates candidates with `liveRunDirs`,
 * which skips `archive` outright. So archiving carried a pending job out of the worker's reach: not
 * claimed, not settled, not refused. The client who asked for it got no answer and no explanation, and
 * no row anywhere said why. That is an absence reported as nothing at all — the one shape
 * `whatIfRefusal` exists to prevent.
 *
 * BEFORE the rename, deliberately: the settlement is written into the run dir and travels with it, so
 * the answer is on disk in the archive where the read tool will look for it.
 *
 * ✕ THE SENTENCE IS PER KIND, and a memo does not get the stage one. `whatIfRefusal`'s standing
 * refusal — "this run is delivered or archived, what-if runs on live runs only" — is TRUE of a stage
 * and FALSE of a memo, which runs on archived evidence by design. Telling a client their memo was
 * refused because the run is archived would be a false sentence in the one place they go to find out
 * what happened. A memo is closed on the true reason instead: it was queued before the run archived,
 * and the drain does not reach an archived run.
 *
 * ✕ A JOB ANOTHER WORKER IS ACTIVELY RUNNING IS LEFT ALONE. `pendingWhatIf` returns queued jobs and
 * claims older than an hour, never a fresh claim, so a live worker's job is not settled underneath it.
 * A fresh claim at the moment of archiving is a race this does not close, and it is written down
 * rather than papered over.
 *
 * Best-effort throughout: a failure to settle must never stop the archive, because a run that cannot
 * archive is a much larger problem than a job with no row.
 */
export function settlePendingWhatIfsBeforeArchive(run) {   // @internal
  let pending = [];
  // NOT a silent catch. This function exists because a job went unanswered with no row anywhere; a
  // failure to enumerate that returned quietly would reproduce exactly that, one level up, and the
  // archive would still succeed so nothing downstream would look wrong.
  try { pending = pendingWhatIf(run.runDir); }
  catch (e) { note(`what-if settle before archive could not enumerate the queue (${String(e?.message ?? e).slice(0, 120)}) — pending jobs may be unanswered`); return; }
  for (const entry of pending) {
    try {
      // CLAIM FIRST, exactly as the worker does. `finishWhatIf` writes the terminal file and does not
      // remove the `.json`; the claim is what renames it out of the queue. Settling without claiming
      // writes a `.failed` beside a `.json` that still reads as QUEUED to every reader — the job would
      // look pending and answered at the same time, which is worse than the silence being fixed here.
      const job = claimWhatIf(entry);
      if (!job) continue;                     // another worker won it, or it vanished — not ours to settle
      const kind = job?.op?.kind === "memo" ? "memo" : "stage";
      // ✕ THE SENTENCE IS PER KIND. The standing refusal — "what-if runs on live runs only" — is TRUE
      // of a stage and FALSE of a memo, which reasons over archived evidence by design. A memo is
      // closed on the true reason instead.
      const error = kind === "memo"
        ? "this what-if was queued before its run was archived, and the drain does not reach an archived run — ask it again against the archived run, which a memo may read"
        : (whatIfRefusal({ location: "archive", state: run.state ?? null, kind }) ?? "this run is delivered or archived — what-if runs on live runs only");
      finishWhatIf(run.runDir, entry.id, { ok: false, op: job.op ?? null, error });
      try { runLog(run.runDir, { event: "whatif-settled-on-archive", id: entry.id, kind, stale: entry.stale }); }
      catch { /* the row is written; the log line is a convenience and must not undo it */ }
    } catch (e) {
      // One job's settlement must not cost the others, or the archive — but it must not be SILENT
      // either. A swallowed failure here leaves exactly the unanswered job this function exists to
      // prevent, and the archive still succeeds, so nothing downstream looks wrong.
      note(`what-if ${entry.id} could not be settled before archive (${String(e?.message ?? e).slice(0, 120)}) — it may be unanswered`);
    }
  }
}

export function archive(run) {
  try {
    settlePendingWhatIfsBeforeArchive(run);
    mkdirSync(dirname(run.archiveDir), { recursive: true });
    renameSync(run.runDir, run.archiveDir);
    return run.archiveDir;
  } catch (e) {
    note(`archive failed (non-fatal): ${e.message}`);
    return null;
  }
}

// Deterministically inject/replace fields into a markdown file's YAML front-matter — the DRIVER writes these
// fields, never the LLM. Idempotent; string values are JSON-quoted for YAML safety. No-op if the file has no
// front-matter block. (It was introduced for the WS1c failover stamp; that stamp is deleted with the chain,
//, and every surviving caller — the verdict labels, the scope line, rated_under, the project/origin
// disclosure — is a compute-don't-author field with a live source.)
// `runDir` (P2): the driver-owned front matter is a DECORATION applied after the report is assembled —
// the derived verdict labels, the scope line, rated_under. Consumers that declare report.md as an input
// (report-overview / report-card) are written from its BODY and never derive anything from these
// fields, and the injection happens after they are drafted (and again after any lint redo), so leaving it
// to read as staleness would strand the run: a mismatch with no recompute path that can settle it.
// Re-stamping says "this change is accounted for". Deliberately NOT done for the findings.json mutators
// — those SHOULD invalidate their consumers (that is the whole fix), and they run before the drafting
// stages, so one recompute settles them.
export function injectFrontMatter(path, fields, runDir = null) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return false; }
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return false;
  let body = m[1];
  for (const [k, v] of Object.entries(fields)) {
    // plain, single-line value (matches the existing handling_note convention; parseFront splits on the
    // FIRST ':' only, so internal colons in stage labels like "register-unit:primary-sweep" survive intact).
    const line = `${k}: ${String(v).replace(/\r?\n/g, " ").trim()}`;
    const re = new RegExp(`^${k}:.*$`, "m");
    body = re.test(body) ? body.replace(re, line) : `${body}\n${line}`;
  }
  atomicWrite(path, `---\n${body}\n---\n${text.slice(m[0].length)}`);   // B5 — never a half-written report.md visible
  if (runDir) restamp(runDir, path, { project: projectStageInput });
  return true;
}

// ── A DELIVERY WITHOUT THE OVERALL ASSESSMENT: WHAT IT SETS ASIDE AND WHAT IT READS ───────────────────────────────

/** Every artifact of the overall assessment an earlier pass can leave in the run, as a path. */
function assessmentArtifacts(P, runDir) {
  return [
    P.findings, P.narrative, P.report, P.reportOverview, P.reportCardsDir, P.audit, P.seniorEyeReview, P.caseLaw,
    P.caseLawCitations, P.doubtClosure, P.clientSummary, P.emailBody, P.correctionsApplied,
    join(runDir, REPORT_IDENTITY_FILE), join(runDir, ".published"),
    ...["verdict.json", "senior-rights.json", "corrections-state.json", "corrective-cycle.json", CORRECTIVE_RECHECK_FILE,
      "predelivery-lint.json", "reasoning-integrity.json"].map((n) => driverDir(runDir, n)),
    declinationCallPaths(runDir, 0).ledger,
  ].filter(Boolean);
}

/**
 * Move every assessment artifact an earlier pass left under `_driver/not-completed/set-aside/`, so no rejected draft,
 * earlier verdict, overview or published record can reach a surface of a delivery made without the assessment. Kept,
 * not deleted: the run's record still holds them. Returns the names moved. IMPURE (moves files in the run).
 */
export function setAsideTheAssessment(P, runDir) {   // @internal
  const dest = driverDir(runDir, NOT_COMPLETED_DIR, "set-aside");
  const moved = [];
  for (const src of assessmentArtifacts(P, runDir)) {
    if (!existsSync(src)) continue;
    mkdirSync(dest, { recursive: true });
    const name = relative(runDir, src).replace(/[\\/]/g, "__");
    const to = join(dest, name);
    rmSync(to, { recursive: true, force: true });
    renameSync(src, to);
    moved.push(name);
  }
  return moved;
}

// The register ledger's closed statuses as the shipped coverage states of a delivery made without the assessment.
// "Confirmed-clean" is the write-up's claim that every right it found is reported, and with no assessment nothing is
// reported, so the row is an open item, with the shipped gap reason. A slice the provider could not express was not
// run. A family the reading turn chose not to ask takes the "Note" state its withheld families already take.
const LEDGER_STATE = { "confirmed-clean": "open", "coverage-limited": "coverage-limited",
  deferred: "not-searched", "withheld-by-judgment": "note" };
// The note an open row carries: the shipped gap row's own reason (deferral-row.mjs), never the write-up's text.
const OPEN_ROW_NOTE = plainDeferralReason(NOT_COMPLETED);

/**
 * The register coverage ledger's rows as the report's coverage rows, in a delivery made without the assessment: each
 * row's recorded status as a shipped state (LEDGER_STATE), its unit in the reader's label, and no row clean. The row's
 * reason is not printed: the write-up wrote it for the assessment, in the engine's own words, and in a normal run
 * synthesis writes the reader's note in its place. An open row carries the shipped gap reason; every other row carries
 * no note, and nothing replaces the reason. PURE.
 */
export function assessmentCoverageRows(ledgerRows) {   // @internal
  return (Array.isArray(ledgerRows) ? ledgerRows : []).map((r) => {
    const state = LEDGER_STATE[String(r?.status ?? "").trim().toLowerCase()];
    const unit = String(r?.unit ?? r?.axis ?? "").trim();
    return state && unit ? { area: coverageUnitLabel(unit), state, note: state === "open" ? OPEN_ROW_NOTE : "" } : null;
  }).filter(Boolean);
}

/**
 * The coverage rows a delivery without the assessment states. The register write-up's own ledger where it saved one;
 * where it never did, because placement or the write-up is the step that failed, the driver's own coverage form, whose
 * rows the frozen plan, the plan receipt and the bands give, and whose statuses the write-up records as it rules. A
 * row it never ruled is an open item, with the shipped gap reason and no words of the engine's. IMPURE (reads the run).
 */
export function assessmentCoverageOfRun(runDir) {   // @internal
  const ledger = loadCoverageLedger(runDir);
  const fromLedger = assessmentCoverageRows(ledger.rows);
  if (fromLedger.length) return fromLedger;
  let rows = readCoverageForm(runDir).rows;
  if (!Array.isArray(rows)) {
    const { input } = coverageFormInput(runDir);
    rows = input ? buildCoverageForm(input).rows : [];
  }
  const ruled = assessmentCoverageRows(formLedgerRows(rows));
  const unruled = (rows ?? []).filter((r) => r && r.kind !== "family" && !LEDGER_STATE[String(r.status ?? "").trim().toLowerCase()])
    .map((r) => String(r.unit ?? r.axis ?? "").trim()).filter(Boolean)
    .map((unit) => ({ area: coverageUnitLabel(unit), state: "open", note: OPEN_ROW_NOTE }));
  return [...ruled, ...unruled];
}

/**
 * The audit a run delivers without its assessment: the search log it holds, from the register write-up and the web
 * search, with no record the assessment would have rated and no placement set-aside. PURE apart from reading the run.
 */
export function searchLogAuditMd(P) {   // @internal
  const read = (p) => { try { return existsSync(p) ? readFileSync(p, "utf8") : ""; } catch { return ""; } };
  const commonLawGrid = read(P.commonLawGrid) || null;
  return buildAuditMd(read(P.registerFindings), read(P.commonLaw),
    { findings: [], readingLog: readReadingLog(P), commonLawGrid, placementRows: [], searchLogOnly: true });
}

/**
 * THE MASTHEAD'S SCOPE FACT, derived and written: `_driver/scope-facts.json`, the pure join of the instructed scope, the
 * frozen plan, the band states and the coverage ledger (scope-facts.mjs). One author for both reports: the one the
 * assessment completed and the one delivered without it. Returns the facts, or null with no scope to state. IMPURE.
 */
export function writeScopeFactsOf(ctx, P, runDir) {   // @internal
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
  const plan = ctx.registerPlan ?? readJson(P.registerPlan);
  const instructed = readJson(P.instructedScope);
  if (!plan && !Array.isArray(instructed?.classes)) return null;   // a run with no register layer and no instructed classes has no scope fact to state
  const planExecution = ctx.planExecution ?? readJson(P.planExecution);
  const facts = deriveScopeFacts({
    instructedScope: instructed,
    plan,
    planExecution,
    coverageRows: loadCoverageLedger(runDir).rows,
    withheldQids: waitingFamilyStates(runDir, planExecution?.awaiting).withheld.map((f) => f.qid),
    markets: orderMarketsOf(ctx, plan),
  });
  facts.derived_from = Object.fromEntries([
    ["instructed_scope", P.instructedScope], ["register_plan", P.registerPlan],
    ["plan_execution", P.planExecution], ["coverage_ledger", P.registerCoverageLedger],
  ].filter(([, p]) => existsSync(p)).map(([k, p]) => [k, fileMeta(p)]));
  try {
    atomicWrite(P.scopeFacts, JSON.stringify({ ts: new Date().toISOString(), ...facts }, null, 2) + "\n");
    runLog(runDir, { event: "scope-facts", classes: facts.classes_line, states: Object.fromEntries(Object.entries(facts.per_class).map(([c, v]) => [c, v.state])) });
  } catch (e) { note(`scope-facts write failed (non-fatal): ${e.message}`); }
  return facts;
}

/** Stamp the driver-owned `classes:` and `coverage_line:` from the scope fact onto report.md. IMPURE. */
export function applyScopeFrontMatterOf(P, runDir) {   // @internal
  let facts = null;
  try { facts = JSON.parse(readFileSync(P.scopeFacts, "utf8")); } catch { return; }
  const fields = {};
  if (facts?.classes_line) fields.classes = facts.classes_line;
  if (facts?.coverage_line) fields.coverage_line = facts.coverage_line;
  if (!Object.keys(fields).length) return;
  const wrote = injectFrontMatter(P.report, fields, runDir);
  if (wrote) runLog(runDir, { event: "scope-frontmatter", classes: facts.classes_line ?? null, coverage_line: Boolean(facts.coverage_line) });
}

/**
 * THE REPORT'S IDENTITY, as the driver states it: the nine front-matter keys of `_driver/report-identity.json`,
 * which the overview's shell and the report read. `displayVerdict` supplies the rating's two keys; a run whose
 * overall assessment was not completed passes null, and the two keys are then null, so no surface is handed a rating
 * the run never reached. PURE apart from reading the run's status for its start date.
 */
export function reportIdentityRecord(job, ctx, runDir, displayVerdict = null) {   // @internal
  const idMarks = Array.isArray(job.marks) ? job.marks.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean) : [];
  const clRan = !ctx.registerOnly;
  let runDate = null;
  try { runDate = String(JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"))?.startedAt ?? "").slice(0, 10) || null; } catch { /* no status yet — the date half is omitted rather than invented */ }
  return {
    schema_version: 1,
    matter: job.ref ?? job.tmp ?? null,
    title: job.name ?? job.markName ?? idMarks[0] ?? null,
    client: job.customer ?? ctx.profile?.name ?? null,
    use: job.goods ?? null,
    classes: Array.isArray(job.classes) ? job.classes.join(", ") : (job.classes ?? null),
    run: [runDate, providerMeta(ctx?.register ?? REGISTER_PROVIDER).label].filter(Boolean).join(" · ") + (clRan ? " + common-law" : ""),
    overall_label: displayVerdict?.tier ?? null,
    overall_badge: displayVerdict?.badge ?? null,
  };
}
