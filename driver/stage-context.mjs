// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// WHAT A STAGE IS ACTUALLY HANDED — one source of truth, two views (item)
//
// `stageInputs` (stages.mjs) answers ONE question, and answers it well: which files, when their bytes
// move, make this stage's output stale. It was read as if it answered a second one — what the
// `--experiment` sandbox must contain — and it does not, because a stage's context is more than its
// declared files. Four things are missing from every declaration, by construction:
//
//   · what `pipeline()` DERIVES between stages (`_driver/band-shape.json`, `band-shape.md`,
//     `_driver/register-positions.json`, `_driver/grid-spec*.json`) — nobody declares them because no
//     stage's staleness depends on them in the way the freshness gate means;
//   · what a TOOL opens inside its own process (`register-named-band.json` is read by the band MCP
//     server, not by the agent — the most-consumed artifact in a run, and it appears in no `reads[]`);
//   · what is passed INLINE (`report-card` gets its finding as `ctx.finding`; the declaration exists so
//     the freshness gate can see findings.json move, not because the agent opens it);
//   · what only SOMETIMES reaches the prompt (`matter-frame` and `blind-frame` name
//     `inbound-request.txt` only when `job.rawRequest` exists).
//
// ── THE ONE RULE THIS MODULE EXISTS TO KEEP ──────────────────────────────────────────────────────────
//
// `stageInputs` IS NOT REWRITTEN HERE. This module CALLS it and layers on top. That is deliberate and it
// is the whole safety argument: `stageInputs` feeds `stageStaleness`, `writeStamp`, `dependencyOrder`,
// `reconcilePassStamps`, `mcp-server/lib/trace.mjs` and `driver/stage-freshness.mjs`, so widening what
// it returns makes previously-fresh stages read STALE and can park a live run. The skeptic declaration
// was held back an entire wave for exactly that (stages.mjs, the `skeptic:` entry). One source of truth
// underneath, two views on top: the freshness view is the untouched list, the sandbox view is this.
//
// ── AND THE RULE THE SANDBOX KEEPS ───────────────────────────────────────────────────────────────────
//
// The copy loop used to `continue` past any declared input that was not on disk. An absence read as a
// pass — the defect class this codebase has shipped seven times. `sandboxGaps` replaces it: the arbiter
// is the CANONICAL run, never a hand-kept optional list. If the canonical run has the file, the sandbox
// must have it too or the dispatch is refused by name. If the canonical run does not have it,
// `pipeline()` would not have handed it either, and its absence in the sandbox is faithful.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //

import { STAGES, stageInputs } from "./stages.mjs";
import { toolGroupsForStage } from "./engine/mcp/gather-config.mjs";
import { FACTS_FILE as DIGEST_FACTS_FILE, ACCOUNTING_STAMP as DIGEST_ACCOUNTING_STAMP } from "./register-digest-record.mjs";

/**
 * The five ways an artifact reaches a stage. A declaration can express the first one; production uses
 * all five, and a rig that models only the first replays a pipeline that does not exist.
 *
 *   agent-reads-file — the prompt names the path; the agent opens it. The only kind `reads[]` records.
 *   tool-mediated    — a tool the stage holds opens it INSIDE the tool's own process.
 *   passed-inline    — the driver puts the content in the message; the file is never opened.
 *   conditional      — the prompt names it only on some runs (a job field decides).
 *   driver-side      — the DRIVER reads it and turns it into a prompt block or a ctx field.
 */
export const EDGE_KINDS = ["agent-reads-file", "tool-mediated", "passed-inline", "conditional", "driver-side"];

const bareStage = (label) => String(label).replace(/:.*$/, "");

// ── the kind of each DECLARED edge ───────────────────────────────────────────────────────────────────
//
// Keyed on the paths() KEY, not the string, so a path rename cannot silently drop a classification.
// Anything not named here is `agent-reads-file` — the common case and the one the declaration means.
const DECLARED_KIND = {
  "blind-frame": {
    inboundRequest: ["conditional",
      "the prompt names it ONLY when job.rawRequest exists (stages.mjs blind-frame message); on a run with no raw forward this edge is a staleness dependency and nothing more"],
  },
  "report-card": {
    findings: ["passed-inline",
      "the finding's machine record rides the message as ctx.finding (pipeline.mjs dispatches report-card with {axis:String(ordinal), finding:f}); the file is declared so the freshness gate sees findings.json move"],
  },
  // SETTLED WITH EVIDENCE (the sub-question asks). Neither file is opened by the skeptic's agent —
  // in the reference run neither appears in any dispatch's reads[] — because `skepticDeferralExtra`
  // (pipeline.mjs) reads BOTH driver-side and hands the skeptic the answer as a table:
  // `loadCoverageLedger(P.runDir).rows` reads register-coverage-ledger.json (machine ledger first,
  // register-findings.md prose as the fallback), and `readPlanExecution(ctx)` reads
  // _driver/plan-execution.json (ctx first, then disk). The block names both paths as the authority and
  // says they are "also yours to read directly" — so the agent MAY open them, but nothing requires it
  // and the escalation decision is made from the driver-computed rows either way.
  skeptic: {
    planExecution: ["driver-side",
      "skepticDeferralExtra reads it via readPlanExecution(ctx) and emits the refused-query rows; the prompt names the path as the authority but the answer is already in the message"],
    registerCoverageLedger: ["driver-side",
      "skepticDeferralExtra reads it via loadCoverageLedger(P.runDir) and emits the axis|unit|status|reason table plus the closeable/not-closeable split"],
  },
  "register-digest": {
    registerNamedBand: ["tool-mediated",
      "opened inside the band MCP server process (CLEAROTRON_BAND_RUN_DIR), never by the agent — band_lookup/band_shape are the reading layer"],
  },
  "placement-inquiry": {
    registerNamedBand: ["tool-mediated", "same — the band tools are this stage's reading layer"],
    // — the placement form is CONTEXT, and deliberately NOT a freshness input. The driver writes it
    // before dispatch and rewrites it after every judgement (the union runs on each one), so it is always
    // newer than the md the seat just wrote — and adding it to stageInputs would make the largest stage in
    // the run read stale on every resume and re-dispatch itself. 's ruling exactly: the fix is a
    // second view, not a wider freshness list.
    placementForm: ["driver-side",
      "written by the driver before dispatch and re-unioned on every judgement; the prompt names the path because the seat writes its selections there"],
  },
  synthesis: {
    registerNamedBand: ["tool-mediated", "same — the band tools are this stage's reading layer"],
    // — declared for staleness, DELIVERED as data. Neither file is something the agent has to
    // open: `planAuditExtra` (stage:"synthesis") and `coverageLedgerExtra` read both driver-side and
    // hand the stage the rows. The prompt names the paths as the authority, exactly as the skeptic's
    // twin does, so the agent MAY open them and nothing requires it.
    planExecution: ["driver-side",
      "planAuditExtra tabulates it into the PLAN-EXECUTION CHECK block; the prompt names the path as the authority but the answer is already in the message"],
    registerCoverageLedger: ["driver-side",
      "coverageLedgerExtra reads it via loadCoverageLedger(P.runDir) and emits the axis|unit|status|reason table"],
  },
};

// ── what a stage's TOOLS open, inside their own processes ────────────────────────────────────────────
//
// Derived from `toolGroupsForStage` (engine/mcp/gather-config.mjs) rather than a hand-kept list of
// stages: the group map already IS the statement of which stage holds which tool, and a stage that
// gains the band group gains these edges with no edit here.
export const TOOL_GROUP_EDGES = {
  band: (P) => [
    { path: P.registerNamedBand, why: "band_lookup / band_shape read the merged band (band-server.mjs bandPath)" },
    { path: P.bandShape, why: "band_shape serves _driver/band-shape.json; without it the tier filter returns ok:false and the stage runs with no floors" },
    { path: P.bandShapeMd, why: "band_shape serves band-shape.md (the readable shape, part-paged)" },
    { path: P.registerPositions, why: "the exact-identity projection the shape and the recall join read as one unit" },
    { path: join(P.runDir, "_records"), dir: true, why: "band_record serves the official registry records fetched into this run" },
  ],
  // ── conversion 11 — THE RECORD TOOL READS A DRIVER-WRITTEN SIDECAR, AND NOTHING DECLARED IT ───────
  //
  // FOURTH OCCURRENCE OF THE CLASS THE DISPATCH_EXTRAS BANNER BELOW ALREADY RECORDS. `--experiment
  // register-digest` calls `stage()` directly and never enters `runDigest`, which is the only site that
  // writes these two files. So a sandboxed arm got neither, `readDigestFacts` returned empty facts, and
  // the seat's first call refused `registerdigest_uri_unknown` — the transport's documented fail-closed
  // degradation firing correctly about the wrong thing, because the DRIVER never wrote the file and no
  // seat-facing error can say so. Measured by the replay rig before any model call, 2026-08-27.
  //
  // DECLARED HERE RATHER THAN AS AN UNDECLARED EDGE because it is genuinely tool-mediated: the sidecar
  // is what lets `record_register_digest` take no record fields at all, so it belongs to the grant, and
  // any stage ever given this recording group needs it for the same reason.
  //
  // THE STAMP IS LISTED THOUGH IT IS CONDITIONALLY WRITTEN. `writeRegisterDigestFacts` writes it only
  // when the run has an owed population, and `sandboxGaps` reports a gap only for something the
  // CANONICAL run holds — so a run that legitimately never armed the accounting contributes no gap,
  // while one that did and lost it in the copy refuses by name. Listing it costs nothing on the first
  // and is the whole point on the second.
  // ── FIFTH AND SIXTH OCCURRENCE OF THIS TABLE'S OWN SUBJECT ───────────────────────────────────────
  //
  // The digest entry below calls its gap "the fourth occurrence of the class". These are the fifth and
  // sixth, and they were found IN THE TABLE ADDED TO FIX THE FOURTH — because that fix was an entry for
  // one server rather than a rule about all of them. Measured across all fifteen MCP servers: three open
  // a driver-written file (`band`, `declination`, `recording`) and only `band` and the digest half were
  // declared. Both files below are present on any canonical run that reached synthesis and were ABSENT
  // from its sandbox, so an `--experiment synthesis` arm ran with the declination floor silent and the
  // closure spec missing, and nothing refused because `sandboxGaps` had no gap to refuse on.
  //
  // NO DERIVATION FOR EITHER, unlike the digest's sidecar: the driver writes both before dispatching the
  // stage that reads them, so on any run that reached the stage they exist and the manifest copy is the
  // whole fix. Declared, `sandboxGaps` refuses BY NAME when one is missing instead of dispatching into
  // the silence.
  //
  // The arm that keeps this from having a SEVENTH occurrence is in `experiment-context.test.mjs`: it
  // walks the servers for driver-written reads and asserts each is declared, rather than listing these
  // two. A list is what produced this comment.
  declination: (P) => [
    { path: driverDir(P.runDir, "declination-spec.json"), why: "record_declination resolves every row_index against this spec; without it the tool refuses the call and the seat cannot decline at all" },
  ],
  "recording-doubt-closure": (P) => [
    { path: driverDir(P.runDir, "doubt-closure-spec.json"), why: "record_doubt_closure resolves its rows against this spec; without it the tool refuses and the closure verdicts cannot be recorded" },
  ],
  "recording-register-digest": (P) => [
    { path: driverDir(P.runDir, DIGEST_FACTS_FILE), why: "record_register_digest resolves every uri the seat cites against this sidecar (readDigestFacts); without it every call refuses registerdigest_uri_unknown" },
    { path: driverDir(P.runDir, DIGEST_ACCOUNTING_STAMP), why: "the era stamp that arms the digest's accounting refusal — absent, the rule silently does not apply" },
  ],
};

// ── the edges a declaration cannot carry ─────────────────────────────────────────────────────────────
const UNDECLARED = {
  // The verbatim forward is named in the prompt only when job.rawRequest exists — and matter-frame,
  // unlike blind-frame, never declared it at all (stages.mjs "matter-frame": []).
  "matter-frame": (P) => [
    { path: P.inboundRequest, kind: "conditional",
      why: "the prompt names it only when job.rawRequest exists; undeclared because matter-frame has no upstream to go stale against" },
  ],
  // The half-grid spec sidecar the message hands the plugin as grid_spec_path. Undeclared, derived in
  // pipeline() — which is precisely why `--experiment common-law-half` could not run at all.
  "common-law-half": (P, { axis } = {}) => (axis
    ? [{ path: P.gridSpecHalf(axis), kind: "agent-reads-file",
      why: "the prompt hands this half's spec to perplexity_research as grid_spec_path; derived in pipeline(), declared nowhere" }]
    : []),
  "common-law": (P) => [
    { path: P.gridSpec, kind: "agent-reads-file",
      why: "ctx.gridSpecPath — the prompt hands the canonical spec to perplexity_research as grid_spec_path; derived in pipeline(), declared nowhere" },
  ],
  //, typed transport — the coverage form's SEAT COPY IS GONE from this map because it is gone
  // from the run: the prompt names no coverage path any more (coverageFormBrief enumerates the rows
  // inline and names the `record_coverage` tool), the seat opens no coverage file, and the accumulator
  // the gate judges is declared on VALIDATOR_SIDECARS below. The brief's own read of that accumulator
  // is declared on DISPATCH_EXTRAS.
  "register-digest": () => [],
  // The provider enforcement telemetry: the prompt names the path only when ctx.enforcerSignals is a
  // non-zero count (stages.mjs synthesis message). Undeclared on purpose — it is aim-attention only and
  // must never move a freshness stamp — but a sandbox without it hands a different prompt.
  synthesis: (P) => [
    { path: P.enforcerSignals, kind: "conditional",
      why: "named in the prompt only when ctx.enforcerSignals > 0; aim-attention telemetry, deliberately outside the freshness map" },
  ],
};

// ── the sidecars a stage's own VALIDATOR resolves ────────────────────────────────────────────────────
//
// A gate is context too. Every one of these is read by verify.mjs from the run dir holding the output
// under test, so a sandbox without them judges the arm under different rules than production did —
// which is precisely why one bespoke `copyFileSync` of `_driver/profile.json` was hand-patched into
// runExperiment (a shadow common-law validation without it fell back to the default platform floor and
// made the comparison lie). This table generalises that patch: one statement of fact about verify.mjs,
// covering every stage, and `experiment-context.test.mjs` fails if verify.mjs grows a read that no
// stage declares.
//
// STARVATION SURVIVES BY CONSTRUCTION, not by an exception: `blind-frame`'s validator resolves NO
// sidecar, so the blind pass's sandbox still holds exactly one file. Widening the sandbox is only safe
// because this list is a fact about gates rather than a convenience copy of `_driver/`.
export const VALIDATOR_SIDECARS = {
  "matter-frame": ["instructed-scope.json", "stage-contracts.json"],
  "prelim-variants": ["instructed-scope.json", "stage-contracts.json"],
  "register-unit": ["instructed-scope.json", "register-plan.json"],
  "common-law": ["grid-spec.json", "profile.json"],
  // — the DRIVER'S copy of the placement form. Without it in the sandbox an experiment arm would
  // union against nothing and re-render an empty deliverable — the same class of defect fixed
  // for the coverage form one line down.
  "placement-inquiry": ["stage-contracts.json", "placement-form.form.json"],
  // — `register-coverage-form.form.json` is the DRIVER'S copy of the coverage form and the artifact
  // validators.registerFindings judges. Without it in the sandbox an experiment arm would judge the
  // register digest under different rules than production did — the exact defect this table generalises.
  "register-digest": ["coverage-enum.json", "plan-execution.json", "register-plan.json", "register-coverage-form.form.json"],
  synthesis: ["intake-asks.json", "coverage-closure.json", "framework.json"],
  "narrative-refutation": ["plan-execution.json"],
};
// The half-spec is axis-parameterised, so it is declared as an edge (UNDECLARED below) rather than a
// flat filename; named here only so the drift guard can see it is accounted for.
export const AXIS_PARAMETERISED_SIDECARS = ["grid-spec.half-"];
// Read by validators.clientSummary ONLY, and the `client-summary` STAGE was deleted (2026-08-01) — the
// validator survives as an archive read handle. No dispatch is judged by these, so no sandbox needs
// them. Recorded rather than filtered silently: if that stage ever returns, the omission is visible
// here instead of showing up as an arm quietly validating under different rules.
export const STAGELESS_VALIDATOR_SIDECARS = ["verdict.json", "client-summary-scope.json"];

// ── what pipeline() DERIVES ──────────────────────────────────────────────────────────────────────────
//
// The registry is DECLARATIVE on purpose: `writes` says which artifacts exist only because the driver
// computed them, `reads` says what that computation needs. pipeline.mjs binds an `id` to the function
// that actually runs it. Nothing here names a stage — a derivation is pulled into a sandbox because its
// OUTPUT is in that stage's context, which is the general rule and the reason this is not two special
// cases. A new derived artifact is one entry here plus its runner; the rig needs no edit at all.
export const CONTEXT_DERIVATIONS = [
  {
    id: "band-shape",
    // PR-8 / P2-A — deriveBandShape(), run after every named-band merge. All three `probeOrder` seams
    // live inside these functions (band-shape.mjs: dominantElementComposites, deriveRegisterPositions,
    // buildBandShape), which is why a rig that REPLAYS a persisted band-shape.json cannot serve a
    // seeded arm: it would replay the unseeded artifact and report no movement.
    writes: (P) => [P.bandShape, P.bandShapeMd, P.registerPositions],
    reads: (P) => [
      { path: P.registerNamedBand, why: "the merged band the shape is derived FROM" },
      { path: P.variantManifestModel, why: "targets: the mark, its dominant element, distinctive elements and variants" },
      { path: P.crowdContext, why: "the crowd join the shape's crowd descriptors carry" },
      { path: join(P.runDir, "_records"), dir: true, why: "recordDetailIndex — registration/application numbers, IR↔base linkage, Madrid designations; no search row carries them" },
    ],
  },
  {
    id: "grid-spec",
    // The deterministic common-law grid contract + the A1 half-split sidecars.
    writes: (P) => [P.gridSpec, P.gridSpecHalf("a"), P.gridSpecHalf("b")],
    reads: (P) => [
      { path: P.variantManifest, why: "ctx.gridVariants = parseManifestVariants(variant-manifest.md)" },
      { path: P.matterContext, why: "the generic profile's channels and the derived meaning angles come from the frame" },
      { path: P.variantManifestModel, why: "the transliteration connotation bucket" },
      { path: P.commonLaw, why: "the resumed-unsplit self-disarm reads the canonical findings" },
      { path: P.commonLawHalf("a"), why: "the resumed-unsplit self-disarm" },
      { path: P.commonLawHalf("b"), why: "the resumed-unsplit self-disarm" },
    ],
  },
  {
    id: "register-digest-facts",
    // conversion 11 — the sidecar the record tool resolves uris against, plus the era stamp that arms
    // the accounting refusal. Written by `writeRegisterDigestFacts`, whose only call site is inside
    // `runDigest`; declaring it here is what lets the `--experiment` rig REPLAY the derivation instead
    // of dispatching into a context the driver never built.
    //
    // THE READ SET IS SIX PATHS AND NOT THE THREE THE WRITER OPENS DIRECTLY. `digestSummaryCounts` and
    // `digestAuditRows` are called from inside it and open three more — the plan-execution receipt, the
    // register findings, and the coverage form behind its own era stamp. A read set naming only the
    // obvious three would let the sandbox derive a sidecar with different counts and audit rows from
    // the canonical one, silently, which is this registry's whole subject matter one level down.
    writes: (P) => [driverDir(P.runDir, DIGEST_FACTS_FILE), driverDir(P.runDir, DIGEST_ACCOUNTING_STAMP)],
    reads: (P) => [
      { path: P.registerNamedBand, why: "the slim record index — every identifier cell the render prints, keyed by the uri the seat cites" },
      { path: P.readingLog, why: "readOkRecordUris — which records this run actually read" },
      { path: P.placementModel, why: "THE OWED SET: the records placement carried in, which is what the accounting refusal holds the seat to" },
      { path: P.planExecution, why: "digestSummaryCounts and digestAuditRows both tabulate the plan-execution receipt" },
      { path: P.registerFindings, why: "digestAuditRows returns EMPTY without it — the audit rows would silently vanish from the sandboxed sidecar" },
      { path: P.coverageEnum, why: "coverageFormStamp — whether this run requires a coverage form at all, which decides whether the audit rows read one" },
      { path: driverDir(P.runDir, "register-coverage-form.form.json"), why: "readCoverageForm — the accumulator digestAuditRows reads when the stamp says a form is required" },
    ],
  },
];

// ── the DRIVER-COMPUTED prompt blocks ────────────────────────────────────────────────────────────────
//
// `opts.extra` is context the stage receives and no file records. `--experiment register-digest`
// bypassed `runDigest` entirely, so an arm ran without the deferred-axis hint, the placement rulings
// tail and the owner-screen receipt — three blocks the production dispatch carries. Declared here with
// their read sets so the sandbox manifest covers them like any other edge.
export const DISPATCH_EXTRAS = [
  {
    id: "digest-dispatch-extra", stage: "register-digest",
    reads: (P) => [
      //, typed transport — the driver's coverage ACCUMULATOR. coverageFormBrief ENUMERATES its
      // rows into the dispatch (the seat's only sight of them — the seat-facing copy is dead, statuses
      // ride record_coverage), so an arm dispatched without it is not measuring its variable — it is
      // measuring the absence of the rows the stage's whole coverage contract now runs through. The
      // same file is on VALIDATOR_SIDECARS, because it is also the copy the gate judges.
      { path: driverDir(P.runDir, "register-coverage-form.form.json"), why: "the accumulator coverageFormBrief enumerates into the dispatch (#476; typed transport)" },
      { path: P.coverageEnum, why: "the era stamp that says a coverage form is required on this run (#476)" },
      { path: P.planExecution, why: "the coverage form's skeleton + per-qid deferral reasons (#476; was the A8 deferred-axis hint)" },
      { path: P.registerPlan, why: "the coverage form's unit labels and open-block join come from the frozen plan (#476)" },
      { path: P.placementModel, why: "the borderline-declaration count row" },
      { path: P.placement, why: "the placement RULINGS TAIL, carried as data on a corrective pass (P5)" },
      { path: P.ownerScreen, why: "the owner×element screen receipt (P2-B)" },
    ],
  },
  {
    id: "skeptic-deferral-extra", stage: "skeptic",
    reads: (P, { axes = [] } = {}) => [
      { path: P.registerCoverageLedger, why: "loadCoverageLedger — the machine ledger rows" },
      { path: P.registerFindings, why: "loadCoverageLedger's prose fallback when the machine ledger is absent" },
      { path: P.planExecution, why: "readPlanExecution — the deterministically-refused queries" },
      { path: P.ownerScreen, why: "the owner-screen negative that rides the same block" },
      { path: P.registerPlan, why: "capabilityGapAxes / fullyDeferredAxes split the deferrals against the frozen plan" },
      { path: driverDir(P.runDir, "register-taint.json"), why: "readActiveTaintAxes — a kill-touched axis is relabelled deferred at the same choke point" },
      // …and the FALLBACK behind that receipt: with no register-taint.json, readActiveTaintAxes reads
      // the per-axis unit telemetry directly (register-taint.jsonlTaintedAxes). A sandbox without these
      // would silently relabel nothing on exactly the runs that never wrote a receipt — the taint would
      // vanish rather than fail, which is the wrong direction for a gap that CLAMPS a verdict.
      ...(axes ?? []).map((a) => ({ path: driverDir(P.runDir, `register-unit:${a}.jsonl`),
        why: `readActiveTaintAxes' receipt-less fallback reads this axis's unit telemetry for kill-touched attempts` })),
    ],
  },
  // ── corruption 2 — narrative-refutation's two blocks, which were declared NOWHERE ─────────────
  //
  // `refute()` (pipeline.mjs) has always composed TWO driver-computed blocks for this stage, and this
  // table knew about neither. So `--experiment narrative-refutation` dispatched with `extra: undefined`
  // while every canonical dispatch of the same stage carried both — and an A/B arm run that way is not
  // measuring its variable, it is measuring the absence of two prompt blocks. There is no error path
  // for that: the shadow prompt was simply shorter and the diff looked like a result.
  //
  // The import-time guard below (DISPATCH_EXTRA_BUILDERS in pipeline.mjs) only ever checked the
  // direction that could not catch this — declared-but-unbuildable. `ab-tooling-honesty.test.mjs` now
  // walks the OTHER direction: every `stage(…, {extra:…})` call site in pipeline.mjs must name a stage
  // that is either declared here or on the stated repair-dispatch allowlist.
  {
    id: "plan-audit", stage: "narrative-refutation",
    reads: (P) => [
      { path: P.planExecution, why: "planAuditExtra tabulates executed/missing/skipped/unplanned + the per-axis skeleton from this receipt — the whole PLAN-EXECUTION CHECK block is derived from it" },
      { path: P.registerPlan, why: "planAuditExtra returns EMPTY unless ctx.registerPlan is attached, and reconstructCtx attaches it from this frozen sidecar (attachRegisterPlan, frozenOnly)" },
    ],
  },
  {
    id: "refute-registry-check", stage: "narrative-refutation",
    reads: (P) => [
      { path: P.narrative, why: "the B2 deterministic registry check runs findRegistryArithmeticIssues / findRegistryViolations OVER the narrative text" },
      { path: join(P.runDir, "_records"), dir: true, why: "assembleRunRecords — the fetched official records each claimed field is checked against; without them the check finds zero mismatches and the block silently vanishes" },
    ],
  },
  // ── — synthesis's two, and the asymmetry they close ─────────────────────────────────────────
  //
  // The reviewer received the plan-execution receipt as a code-derived table; the stage it reviews
  // received neither the receipt nor the coverage ledger — not in its prompt, not in `stageInputs`. A
  // grep for either path over the whole synthesis stage block returned zero. So the run's own record of
  // what had and had not been searched reached the auditor and never reached the author, and the author
  // is the one who writes the claim.
  //
  // Two entries rather than one: the two artifacts fail independently (an unreadable receipt must not
  // take the ledger table down with it — `composeDispatchExtra` catches per builder), and the arm's
  // receipt then records which of the two a dispatch actually carried instead of one merged id that
  // cannot say.
  {
    id: "synthesis-plan-audit", stage: "synthesis",
    reads: (P) => [
      { path: P.planExecution, why: "planAuditExtra tabulates executed/missing/skipped/unplanned + the per-axis skeleton from this receipt — the whole PLAN-EXECUTION CHECK block is derived from it" },
      { path: P.registerPlan, why: "planAuditExtra returns EMPTY unless ctx.registerPlan is attached; pipelineInner attaches it at attachRegisterPlan, well upstream of the synthesis dispatch, and reconstructCtx attaches it from this frozen sidecar" },
    ],
  },
  {
    id: "synthesis-coverage-ledger", stage: "synthesis",
    reads: (P) => [
      { path: P.registerCoverageLedger, why: "loadCoverageLedger — the machine ledger rows the block tabulates" },
      { path: P.registerFindings, why: "loadCoverageLedger's prose fallback when the machine ledger is absent" },
    ],
  },
];

// ── context the driver passes INLINE ─────────────────────────────────────────────────────────────────
//
// ctx fields the message builder reads that no file copy can supply. Declared here, resolved in
// pipeline.mjs (the resolver needs the case-law join) — the same declaration/execution split the
// derivations use. A stage whose REQUIRED inline context cannot be rebuilt is REFUSED, never dispatched
// against an undefined.
//
// The resolver reads the CANONICAL run, not the sandbox: this is the driver reading the run it is
// introspecting, exactly as pipelineInner reads its own run dir before it dispatches a card. findings
// .json is a `passed-inline` edge and is therefore not in the sandbox at all.
export const INLINE_CONTEXT = {
  //. The stage cannot derive this: its tool layer reports an un-enrolled bridge
  // as a configured server that failed to connect, so "unavailable" reaches the seat with the reason
  // already wrong. The driver reads the same inventory the portal's product card reads and hands the
  // answer down, which is why it is declared here rather than discovered there.
  "case-law": {
    from: "caseLawInventory(process.env), filtered to the case-law rows",
    required: [],
    // production: ctx.caseLawSources = [{label, enrolment, available}, …] set before stage("case-law", ctx)
    fields: ["caseLawSources"],
  },
  "report-card": {
    // The dispatch label is already `report-card:<ordinal>` (see _driver/report-card:N.jsonl), so the
    // axis slot IS the ordinal — no new selector, and no stage-specific branch in the rig.
    from: "findings.json (+ the case-law join over case-law-findings.md), by the ordinal in --axis",
    required: ["finding"],
    // production: stage("report-card", {…ctx, axis:String(f.ordinal), finding:f, caseLawProfile:…})
    fields: ["finding", "caseLawProfile"],
  },
};

/**
 * Every edge into `name`'s context, with the KIND of each. The declared inputs come through
 * `stageInputs` VERBATIM and in order — this function classifies them, it never re-states them.
 */
export function stageContext(name, P, opts = {}) {
  const bare = bareStage(name);
  if (!STAGES[bare]) return [];
  const edges = [];
  const seen = new Set();
  const push = (e) => {
    if (!e?.path) return;
    if (seen.has(e.path)) return;
    seen.add(e.path);
    edges.push({ dir: false, declared: false, ...e });
  };
  const kinds = DECLARED_KIND[bare] ?? {};
  // the paths() key each declared path came from, so a kind override is keyed on meaning not on string
  const keyByPath = new Map();
  for (const [k, v] of Object.entries(P)) if (typeof v === "string") keyByPath.set(v, k);
  for (const path of stageInputs(bare, P, opts)) {
    const [kind, why] = kinds[keyByPath.get(path)] ?? ["agent-reads-file", "named in the stage's prompt"];
    push({ path, kind, why, declared: true });
  }
  for (const group of toolGroupsForStage(name)) {
    for (const e of TOOL_GROUP_EDGES[group]?.(P) ?? []) push({ ...e, kind: "tool-mediated" });
  }
  for (const e of UNDECLARED[bare]?.(P, opts) ?? []) push(e);
  for (const f of VALIDATOR_SIDECARS[bare] ?? []) {
    push({ path: driverDir(P.runDir, f), kind: "driver-side", via: "validator",
      why: `verify.mjs resolves _driver/${f} from the run dir when it judges this stage's output` });
  }
  return edges;
}

/**
 * The files (and directories) a sandbox must hold before `name` may be dispatched into it.
 *
 * Context edges, plus the read set of every driver-computed prompt block bound to the stage, plus the
 * TRANSITIVE read set of every derivation whose output is already in the set — to a fixed point. The
 * closure is what makes this general: a derived artifact enters a stage's manifest because the stage's
 * context names it, and its inputs follow automatically.
 *
 * `passed-inline` edges are excluded — there is nothing to copy; INLINE_CONTEXT covers them.
 */
export function sandboxManifest(name, P, opts = {}) {
  const bare = bareStage(name);
  const out = new Map();
  const add = (e) => { if (e?.path && !out.has(e.path)) out.set(e.path, { dir: false, ...e }); };
  for (const e of stageContext(name, P, opts)) if (e.kind !== "passed-inline") add(e);
  for (const x of DISPATCH_EXTRAS) {
    if (x.stage !== bare) continue;
    for (const r of x.reads(P, opts)) add({ ...r, kind: "driver-side", via: x.id });
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const d of CONTEXT_DERIVATIONS) {
      if (!d.writes(P).some((w) => out.has(w))) continue;
      for (const r of d.reads(P)) if (!out.has(r.path)) { add({ ...r, kind: "driver-side", via: d.id }); grew = true; }
    }
  }
  return [...out.values()];
}

/** The derivation ids whose output `name`'s sandbox needs, in registry order. */
export function derivationsFor(name, P, opts = {}) {
  const want = new Set(sandboxManifest(name, P, opts).map((e) => e.path));
  return CONTEXT_DERIVATIONS.filter((d) => d.writes(P).some((w) => want.has(w))).map((d) => d.id);
}

const holds = (path, dir) => {
  if (!existsSync(path)) return false;
  if (!dir) return true;
  try { return readdirSync(path).length > 0; } catch { return false; }
};

/**
 * What the sandbox FAILED to reproduce — the replacement for the silent `if (!existsSync(src)) continue`.
 *
 * The canonical run is the arbiter, and that is the point: "the pipeline never produced this" and "the
 * rig lost it" are different facts, and only the second one is a defect. An empty directory counts as
 * missing (a `_records/` that exists and holds nothing serves no record).
 *
 * Returns [] when the sandbox is faithful. Never throws — the caller decides what a gap means.
 */
export function sandboxGaps(manifest, canonicalRunDir, shadowRunDir) {
  const gaps = [];
  for (const e of manifest) {
    if (!String(e.path).startsWith(`${canonicalRunDir}/`)) continue;   // not a run-dir artifact
    const rel = e.path.slice(canonicalRunDir.length + 1);
    if (!holds(e.path, e.dir)) continue;                                // the canonical run has no such thing
    if (!holds(join(shadowRunDir, rel), e.dir)) gaps.push({ rel, kind: e.kind, via: e.via ?? null, why: e.why ?? null });
  }
  return gaps;
}
