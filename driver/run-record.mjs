// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-record.mjs — the one door to a run's files: where they are, how they are read, how they are written.
//
// It imports node builtins and `shared/driver-dir.mjs` and nothing else, so any module can import it without
// joining an import loop. File names on disk do not change here: the bench and the archive read them.
//
// ── TWO READERS, BECAUSE THE TWO FAILURES MEAN DIFFERENT THINGS ──────────────────────────────────────
//
// A missing or corrupt file has to stay what it was at each call site. `readJson` throws, so a run that needs
// the file stops and says why. `readJsonOr` hands back the fallback the caller names, for a file whose absence
// the caller has already decided how to treat, and `readJsonOrNull` is that reader with null. One reader for
// both would turn some thrown error into a null, and a null reads as "nothing there" where the truth was
// "could not look".

import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { driverRel } from "../shared/driver-dir.mjs";

export { DRIVER_DIR, RUN_DIR_MODE, driverDir, driverFileName, driverRel, ensureDriverDir, labelOfDriverFile } from "../shared/driver-dir.mjs";

/** The parsed JSON at `file`. Throws when the file is missing, unreadable or not JSON. */
export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The parsed JSON at `file`, or `fallback` when the file is missing, unreadable or not JSON. */
export function readJsonOr(file, fallback) {
  try { return readJson(file); }
  catch { return fallback; }
}

/** The parsed JSON at `file`, or null when the file is missing, unreadable or not JSON. */
export function readJsonOrNull(file) {
  return readJsonOr(file, null);
}

// The tmp lives in the TARGET's directory (a sibling name), so the rename never crosses a device; a reader
// sees the old complete file or the new one, never a truncation.
export function atomicWrite(file, text) {
  // unique tmp name: concurrent runs can rollup the same STATUS.md — a shared .tmp would cross-rename/ENOENT
  // between writers (content is derived-from-disk either way, so last-writer-wins on the RENAME is fine; the
  // tmp file itself must not be shared).
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text);
  try { renameSync(tmp, file); }
  catch (e) {
    try { unlinkSync(tmp); } catch { /* cleanup is best-effort — the rename failure is the real error */ }
    throw e;
  }
}

/** The record of the research behind the findings' use checks, by name inside a run folder. */
export const RESEARCH_CHECKS_FILE = "research-checks.md";

// Absolute run-dir file paths. The agent write tool gets ABSOLUTE paths; the driver checks the same
// absolute paths with existsSync. Skill reads stay workspace-relative (skills/ lives in the agent workspace).
export function paths(runDir) {
  const p = (f) => join(runDir, f);
  return {
    runDir,
    matterContext: p("matter-context.md"),
    inboundRequest: p("inbound-request.txt"),       // A5 — the verbatim forwarded request, untouched
    confirmationBrief: p("confirmation-brief.md"),  // B1 — the intake brief exactly as sent to the requester
    customerBind: p("customer-bind.json"),          // B5b — late-bound applicant {customer, exclusions[]} dropped by the forwarding agent
    variantManifest: p("variant-manifest.md"),
    // WS2 (B2) — the structured sibling the register-plan compiler consumes
    variantManifestModel: p("variant-manifest.json"),
    scopeLedger: p("scope-ledger.json"),           // CODE-DERIVED from the manifest's `### Scope ledger` (frame-omission design)
    formNeighbourhood: p("form-neighbourhood.json"), // CODE-DERIVED mechanical FORM band (edit-1 ∪ phonetic-family ∪ visual-confusable ∪ transliteration ∪ spacing-punctuation) — the model-free variant floor the register funnel searches, plus the `variant_floor` block marking which terms code generated and which the model added
    // Property 1 — the frame-STARVED cold re-derivation. The STRUCTURED model is the stage's ONLY output
    //: the prose twin `blind-frame.md` was retired because nothing in the repo ever read it — not
    // frame-diff, not the driver, not a renderer, on any run type. Archived runs keep their copy on disk;
    // no code path opens it, so replay over them is unaffected.
    blindFrameModel: p("blind-frame-model.json"),  // the frame-diff and the reopen gate consume this
    frameDiff: p("frame-diff.md"),                 // the blind-model-vs-actual-scope diff (prose reasoning)
    frameDiffModel: p("frame-diff.json"),          // its STRUCTURED reopen directives + dominant_element_gap (CODE consumes this)
    commonLaw: p("common-law-findings.md"),
    commonLawGrid: p("common-law-grid.json"),       // machine receipts — the grid call's stdout JSON, saved verbatim
    // A1 SPLIT — the per-half stage artifacts (half ∈ {"a","b"}): each concurrent half-grid member reads its
    // own spec sidecar, writes its own findings + ledger, and the driver merges them into the canonical
    // commonLaw/commonLawGrid pair above (common-law-receipts.mergeGrids / mergeCommonLawFindings).
    commonLawHalf: (half) => p(`common-law-findings.half-${half}.md`),
    commonLawGridHalf: (half) => p(`common-law-grid.half-${half}.json`),
    // — the seat's meaning-sweep dispositions, STRUCTURED. One row per recorded query: the query, the
    // id of the receipt it was ruled on, and the ruling. The prose disposition table in the canonical
    // findings file is RENDERED from this by the driver, so no identifier is ever retyped to prove a
    // receipt was read — the failure that cost ten of fourteen refusals on the 2026-08-06 evidence.
    commonLawDispositionsHalf: (half) => p(`common-law-dispositions.half-${half}.json`),
    commonLawDispositions: p("common-law-dispositions.json"),
    // The CANONICAL grid spec the driver dictates (the validator/receipts join and the coverage-closure
    // recompute all key on it). It was the one grid artifact reached by a path LITERAL rather than
    // through paths() — which is how the --experiment sandbox came to have no idea it existed, and why
    // the stageInputs drift guard, whose matcher is derived from these paths, could not see it
    // either. Declared here, used from here.
    gridSpec: p(driverRel("grid-spec.json")),
    gridSpecHalf: (half) => p(driverRel(`grid-spec.half-${half}.json`)),
    // — which common-law path this run took and which term of the selector decided it. Written on
    // EVERY run, split or not: the 2026-08-12 round could not explain why two builds took different
    // paths because the unsplit path emitted nothing at all, and "no event" is not a record.
    commonLawPath: p(driverRel("common-law-path.json")),
    // Closure/frame-reopen top-ups: the driver dictates a supplementary grid SPEC (its own output_path)
    // and the PLUGIN writes the supplementary LEDGER — the same deterministic write the initial gather
    // uses, never an agent hand-append. `tag` names the lane (only "closure" today; frame-reopen source
    // channels stay prose/byte-diff). Split → per-half siblings the extended readHalfLedger folds; non-
    // split (half=null) → a sibling of the canonical ledger the driver folds via mergeGrids in code. The
    // driver owns these names so the agent never invents (and never corrupts) a canonical/half ledger.
    commonLawGridSupp: (half, tag) => p(half ? `common-law-grid.half-${half}.supp-${tag}.json` : `common-law-grid.supp-${tag}.json`),
    gridSpecSupp: (half, tag) => p(driverRel(half ? `grid-spec.half-${half}.supp-${tag}.json` : `grid-spec.supp-${tag}.json`)),
    registerUnit: (axis) => p(join("register-units", `${axis}.md`)),
    // judgment-relocation (2026-06-23): the COMPLETE NAMED BAND the funnel emits per axis (a JSON ARRAY of
    // {state:"enumerated"|"incomplete", …} blocks from register_enumerate — see named-band.mjs). This is what
    // crosses the lifted firewall: the real material judgment reads, NOT a pre-pruned digest.
    registerBand: (axis) => p(join("register-units", `${axis}-band.json`)),
    registerNamedBand: p("register-named-band.json"),   // the driver-merged UNION of every axis band (mergeNamedBands)
    // — the SLIM HIT LIST, a third projection of the merged band, written in the same
    // pass as the shape and the owner screen and for the same reason: a stage must never read a list
    // older than the band it was derived from.
    registerHitList: p("register-hit-list.json"),
    // PR-8 (reading layer) — the deterministic band SHAPE, derived by the driver after every named-band
    // re-merge (band-shape.mjs): mechanical tiers + the unconditional floors + census + blind spots.
    // Judgment reads the md whole (band_shape tool / <256KB Read) and looks records up via the band
    // tools; machine checks keep reading the complete band above.
    bandShape: p(driverRel("band-shape.json")),
    bandShapeMd: p("band-shape.md"),
    researchChecks: p(RESEARCH_CHECKS_FILE),   // the research behind the findings' use checks, written by the writer's record for the review
    readingLog: p(driverRel("reading-log.jsonl")),   // band-server appends every lookup — audit.md "# Reading audit" renders from it
    // P2-A (the recall spine) — three driver-derived sidecars:
    // the retrieved→judgment reconciliation (recall-reconciliation.mjs join, re-derived after EVERY
    // digest pass; an unended position ships named and clamps the verdict), the exact-identity positions projection (charter
    // P2d — same right → one position, territories listed; the band stays per-registration), and the
    // read-before-rate join (charter P2c — verified-from-record stamps × _records × reading log).
    recallReconciliation: p(driverRel("recall-reconciliation.json")),
    // — the placement→digest carry join: every candidate placement-inquiry placed ends on a
    // findings surface, in a Negative-results drop row, or in a Disagreement-resolutions row, and
    // the ones that end nowhere are counted BY NAME. The band-keyed joins above cannot see a
    // common-law-shaped placement (records:[] ⇒ no uri ⇒ no band row), which is the class of
    // candidate the digest drops silently. Disclosure only — it never re-tiers and never gates.
    placementCarry: p(driverRel("placement-carry.json")),
    surfaceDuty: p(driverRel("surface-duty.json")),   // item 3
    // — THE FLOOR DUTY. Every floor row (live, in-class, identical/near-identical) either comes
    // back on the placement form by record id or it does not, and until this artifact existed nothing
    // asked. Measured on two delivered runs: 45 of 207 and 99 of 225 never reached the form, all live.
    // Disclosure only — it never re-tiers, never gates and never sends a followup.
    floorDuty: p(driverRel("floor-duty.json")),
    // — the RETRIEVAL→findings trace, one row per retrieved register record: did it become a
    // finding, and if not, which seam it stopped at, on what ground, and WHERE THAT GROUND WAS
    // AUTHORED. The carry join above starts one seam too late — it can only speak about candidates
    // placement already selected — and the seam that lost the jx lane's own target (ten banded 澜珀
    // registrations, four REGISTERED, none reaching any placement) is the one before it. Disclosure
    // only: it never re-retrieves, never keeps a record the funnel dropped, and never gates.
    recordCarry: p(driverRel("record-carry.json")),
    // — the common-law path's own trace. A SIBLING of record-carry.json, not a widening: the two
    // join on different keys (a canonical `/mark` uri there, a canonicalised URL here) and one file
    // holding both is how the key decision gets reversed later.
    commonLawCarry: p(driverRel("commonlaw-carry.json")),
    jxZhCarry: p(driverRel("jx", "zh-carry.json")),
    jxZhGrid: p(driverRel("jx", "zh-grid.json")),
    registerPositions: p(driverRel("register-positions.json")),
    // — RENAMED from read-verification.json with the pass it recorded. The old artifact was the
    // receipt of a model turn that re-asserted its own stamps; this is the machine's own derivation
    // record: every meter whose `verified-from-record` claim the reading log could not support, and
    // what it became. Written on EVERY settle, empty arrays and all, so a reader can tell "nothing was
    // demoted" from "nobody looked".
    basisDerivation: p(driverRel("basis-derivation.json")),
    // P2-B (charter P2b) — the owner×element screen's own receipt: one row per watchlist owner
    // saying whether its slice enumerated, what it attributed, or the mechanical reason it did NOT
    // run. A projection (plan × plan-execution × band), never a coverage authority.
    ownerScreen: p(driverRel("owner-screen.json")),
    placement: p("placement-recommendations.md"),
    // B2 (charter 2026-07-31) — the STRUCTURED mirror of placement's four tier sections: one entry per
    // candidate {mark, owner, jurisdiction, records[], tier, reason} (reason = a short paragraph, the
    // stated reasoning downstream argues with — see placement-model.mjs). The rulings tail (band
    // reconciliation, disagreements, coverage rulings, open questions) stays PROSE in the md above.
    placementModel: p("placements.json"),
    // — the seat's own form. `placements.json` beside it is now DRIVER-RENDERED from this file's
    // accumulated rows, so the two are no longer two copies of one judgment: this is what the seat writes
    // and that is what the driver publishes.
    placementForm: p("placement-form.json"),
    // — placement's set-asides that stand on the run's files, as the reading step and the writer are told them: one
    // entry per decision, with its ground, the records it covers and its exceptions. Driver-written after every
    // placement pass, with no clock in it, so it changes only when a decision does; both stages declare it.
    placementDecisions: p(driverRel("placement-decisions.json")),
    // — the driver's own flag-by-flag account of the corrective pass: which findings each reviewer
    // flag names, and whether any of them actually moved. Handed to the recheck as data so it argues
    // with evidence rather than re-reading two documents to re-derive what the driver already knows.
    correctionsApplied: p(driverRel("corrections-applied.json")),
    registerFindings: p("register-findings.md"),
    registerCoverageLedger: p("register-coverage-ledger.json"), // WS-A machine contract — the digest's JSON mirror of the Coverage ledger
    skepticFlags: p("skeptic-flags.md"),
    frameReopenReceipt: p(driverRel("frame-reopen.json")),   // A3 — the reopen receipt is a first-class judgment input
    // (t1cd) — the digest-trigger funnel's durable work queue (digest-queue.mjs): mechanisms
    // mint re-digest work here instead of calling the digest; written atomically on every mint/flush
    // and loaded on resume BEFORE the trigger blocks run, so per-mechanism bounds survive resumes.
    digestQueue: p(driverRel("digest-queue.json")),
    // WS2 (B3) — the frozen deterministic search plan + its execution receipt + the
    // code-authoritative instructed scope (what the JOB fields said, before any model breathed on them)
    registerPlan: p(driverRel("register-plan.json")),
    enforcerSignals: p(driverRel("enforcer-signals.json")),   // D2 — provider enforcement telemetry (aim-attention)
    // crowd-context (2026-07-22) — driver-gathered crowded-field EVIDENCE over material un-enumerated
    // slices (per-term live counts, in-scope-class counts, the fully-enumerated exact/near-identical
    // subset). OPTIONAL synthesis input: evidence to the coverage judgment, never a gate; absent on any
    // run without a qualifying slice (or whose evidence pass failed) and the run is unaffected.
    crowdContext: p(driverRel("crowd-context.json")),
    crowdContextMd: p("crowd-context.md"),   // the readable mirror the lawyer actually reads
    planExecution: p(driverRel("plan-execution.json")),
    // What was DECIDED about the receipt's deferrals, and when — kept apart from plan-execution.json,
    // which is an execution-FACTS receipt several validators fail-closed on. See envelope-settle.mjs.
    envelopeDecision: p(driverRel("envelope-decision.json")),
    instructedScope: p(driverRel("instructed-scope.json")), defaultTerritories: p(driverRel("default-territories.json")),   // the stored account defaults the engine cannot search — written at intake, read by no stage (pipeline.mjs writes it)
    // compute-don't-author — the per-class scope truth (scope-facts.mjs): instructed × frozen plan ×
    // band states × coverage ledger. The masthead classes/coverage_line are stamped FROM this sidecar.
    scopeFacts: p(driverRel("scope-facts.json")),
    // D1 — arms the registerFindings off-enum status gate; — the SAME sentinel carries the coverage
    // form's era stamp (`form_required`/`form_path`). One file, two facts, written by runDigest before
    // every digest pass it dispatches and BEFORE the form itself, so a failed form write fails closed.
    coverageEnum: p(driverRel("coverage-enum.json")),
    // — the seat-facing coverage form. DICTATED here so the stray-artifact sweep knows the
    // driver put it there; the accumulator beside it in `_driver/` is derived from this name.
    narrative: p("narrative.md"),
    findings: p("findings.json"),  // Phase 1 — the per-finding machine contract; synthesis mirrors its RATED findings into this JSON, the report/Excel render consume it
    caseLaw: p("case-law-findings.md"),
    // — the RETRIEVAL RECORD beside the prose. Until this existed, `case-law-findings.md` was the
    // only artifact case law produced and its whole contract was a non-empty check, so "the sweep ran"
    // and "the dive read something" were unanswerable and the record trace had nothing to join to.
    caseLawCitations: p("case-law-citations.json"),
    seniorEyeReview: p("senior-eye-review.md"),
    // delivery contract (file-gated; rendered to the page by the pure-code publish step)
    report: p("report.md"),       // CODE (assembleReportMd) — the assembled client report (overview + per-card)
    reportOverview: p("report-overview.md"),        // CODE (report-overview-record.mjs) since conversion 4 — the driver renders the shell off the record_report_overview call; NO card bodies
    reportCardsDir: p("report-cards"),              // B1 — per-finding card files (one isolated LLM call each)
    reportCard: (ord) => p(join("report-cards", `${ord}.md`)),  // B1 — LLM (report-card): ONE card from finding[ord]'s own record
    audit: p("audit.md"),         // CODE (buildAuditMd from the spine) — full audit record
    // THE SEAT WRITES THIS ONE, so it cannot live in `_driver/`. That write boundary makes
    // `<runDir>/_driver/**` a tree a seat may NEVER write into (`authorityTrees()` in authority-trees.mjs, `live: true`) —
    // and this stage's dispatch handed the seat a path inside it. The deny fires, the seat writes the
    // only place it can (the run root), the validator looks in `_driver/` and reports `missing_file`,
    // and the escalation ladder burns out on an artifact that exists. Two consecutive rounds died this
    // way with 3 attempts each. Of the 27 P paths under `_driver/`, this was the ONLY stage output —
    // every other one is driver-authored, which is what that tree is for.
    doubtClosure: p("doubt-closure.md"),   // LLM (doubt-closure) — one dictated SETTLED/OPEN line per stitch-open doubt; code re-verifies every quote
    // RETIRED STAGE, ARCHIVE READ HANDLE (2026-08-01). No stage writes this any more — the
    // `client-summary` stage is deleted. The path constant is KEPT because it is how archived runs'
    // client-summary.md is still reached: mcp-server's read_artifact (name "clientSummary"),
    // lib/coverage.mjs artifactStatus, and lib/brief.mjs (which prefers the client-voiced summary over
    // the report cards) all resolve it through paths(). Deleting the entry would not delete those
    // reads — it would leave them resolving `undefined`, which existsSync() turns into a silent miss
    // rather than an error, so the archive would quietly read as having no summary.
    clientSummary: p("client-summary.md"),
    emailBody: p("email-body.md"), // CODE (composeEmailHtml) — the inline-HTML reply (review headline + client table + link)
  };
}
