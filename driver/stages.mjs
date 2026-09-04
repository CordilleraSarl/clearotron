// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stages.mjs — the SINGLE source of truth for per-stage {agent, model, thinking, timeout, skillReads,
// output file, validator, message}. Centralizing this fixes the live cross-file tier drift
// (prelim-register/SKILL.md vs prelim-search/SKILL.md vs phase2-execution.md vs narrative-refutation/SKILL.md).
//
// Tiers: the three register SWEEP axes are sonnet (Haiku 4.5 rejects `adaptive`); saturation-probe stays
// haiku (count-only); common-law stays haiku/low. Judgment = opus. Phase-4 resourcing: the six
// judgment/framing stages run opus at HIGH effort. (Opus fast mode — the `--settings {"fastMode":true}` knob —
// was REMOVED 2026-06-17: it ~2.5x'd subscription usage and tripped the 5h cap; HIGH effort is retained.) The
// two SAFETY stages are declared honestly + at HIGH effort —
// Step-2.6 skeptic = sonnet (was the alias gemini-flash, which mapped to sonnet anyway), Touchpoint-3
// narrative-refutation = opus (was deepseek-v4-pro, which mapped to opus anyway). Heavy stages carry a
// per-stage `stallSec` (the standalone engine's zero-streamed-tokens watchdog) so deep thinking is not
// false-killed by the tight global default. Models are friendly aliases; gateway.resolveModel() maps to full ids.

import { join, basename } from "node:path";
import { driverRel } from "../shared/driver-dir.mjs";   //
import { validators } from "./verify.mjs";
import { REGISTER_PROVIDER, PROVIDERS } from "./driver.config.mjs";
import { REGISTER_AXES, decideAxes } from "./coverage-ledger.mjs";
// — the digest dispatch asks the SAME question verify.mjs asks ("does this run owe a form or a
// prose table?") of the SAME file, so the instruction and the gate cannot disagree. Reading it here is
// the point: a boolean threaded through ctx would drift the moment one call site forgot to set it.
import { coverageFormStamp } from "./coverage-form-io.mjs";
// The unit note's transport owns its repair tail — see UNIT_NOTE_REPAIR_TAIL. Acyclic: that module
// imports node builtins and shared/driver-dir only.
import { UNIT_NOTE_REPAIR_TAIL } from "./register-unit-record.mjs";
import { grantVocabularySentence } from "./register-grant-vocabulary.mjs";
import { LINE_GROUNDS } from "./hit-list.mjs";   //  — the dictation reads the contract, never a copy of it   //  — the grant sentence is per-deployment
import { marketplaceScopeDirective } from "./jurisdiction-systems.mjs";
import { MEANING_SEAT } from "./common-law-receipts.mjs";   // — the seat whose whole dispatch is the meaning sweep
import { meaningSweepReceiptsInstruction } from "./connotation-search.mjs";   // M1 — ONE composer; this sentence was authored four times
import { frameworkFor, workedExamplesFor } from "./framework.mjs";
import { requiredScriptsFor } from "./registration-scripts.mjs";   // item 21 — which scripts a territory registers marks in
import { resolveTerritories, defaultJurisdictionsLine } from "./effective-scope.mjs";   // the ONE territory ladder (the geography stamp included) + the defaults-never-widen rule (2160)
import { editRepairTail } from "./repair-contract.mjs";
import { reportIdentityFor } from "./search-policy.mjs";
import { profileSelectionDirective } from "./profile-selection.mjs";   //  lever 3 — driver selection  //  — the one product-name resolver
import { FINDINGS_SCHEMA_VERSION, OFF_FIELD_GROUNDS, POSITION_REQUIRED_DISPOSITIONS, DISPOSITIONS } from "./findings-model.mjs";   // — the dictated findings contract version + off-field's declared grounds; — and the disposition vocabulary itself, which was typed out here while its two neighbours were interpolated
import { STATEMENT_CLAUSE_MAX } from "./findings-model.mjs";   // — the ask is dictated against the clause that clips it
// The ledger's closed vocabularies, so the dispatch cannot teach an order or a member the code refuses.
import { SCOPE_LAYERS, SCOPE_STATUSES } from "./scope-ledger.mjs";
import { CLOSURE_EVIDENCE_FILES } from "./doubt-closure-call.mjs";
import { caseLawSourceLines } from "./case-law-sources.mjs";   
import { readAcceptedClosures } from "./doubt-closure-tool.mjs";   //  — what a retry no longer needs to ask   // conversion 6 — file_index is a POSITION into this list
import { DECLINATION_REASON_TOKENS } from "./declination-call.mjs";   // — the vocabulary is dictated FROM the acceptance boundary, so the order and the refusal cannot disagree

// REGISTER_AXES + decideAxes moved to coverage-ledger.mjs (WS-A) so verify.mjs can consume them
// without a stages⇄verify import cycle; re-exported here so every existing import site keeps working.
export { REGISTER_AXES, decideAxes };

// ── review — THE DISPATCH-BLOCK STAMP: written by the composer, read by the message ───────────
//
// A stage message that says "it is tabulated for you below" is asserting something about the driver
// blocks `composeDispatchExtra` built moments earlier. That assertion was unconditional while the
// blocks are best-effort, so on three reachable shapes (no frozen register plan, an unparseable
// receipt, neither artifact on disk) the seat that signs the run was promised a table and handed
// none — an absence dressed as a pass, the exact inference exists to stop.
//
// BOTH HALVES OF THE CONTRACT LIVE HERE, in one file, on purpose. The writer is in pipeline.mjs and
// the reader is in the message builders below; if each named the ctx key itself, the shape would be a
// convention held across two files by hand, which is how the two copies of the plan-audit grading came
// to drift before b0ac330 collapsed them. pipeline.mjs imports `stampDispatchBlocks` rather than
// assigning the field, so there is one definition of what the stamp IS.
//
// (stages.mjs cannot import pipeline.mjs — pipeline imports stages — and stage-context.mjs, where the
// extras are declared, imports stages.mjs too. stages.mjs is the one home both sides can reach.)
export function stampDispatchBlocks(ctx, stage, { built = [], failed = [] } = {}) {
  if (!ctx || typeof ctx !== "object") return;
  ctx.dispatchBlocks = { ...(ctx.dispatchBlocks ?? {}), [stage]: { built: [...built], failed: [...failed] } };
}

// Three states, and the third is the point: ABSENT IS NOT CORRUPT. A run with no register plan is a
// legitimate shape the codebase documents (attachRegisterPlan degrades to null on a class-less matter
// or a pre-spec48 resume); a receipt that exists and will not parse is a DRIVER-written artifact bug.
// A predicate that returned one boolean would make the bug read as an ordinary run — an absence that
// is not a finding — so the two are kept apart and the prompt says which one it is looking at.
//
// An UNSTAMPED ctx answers "absent" deliberately: the only route to a stage message with no stamp is a
// cold dispatch nobody composed for, and a prompt must never promise a block on a path that built
// none. Fail-safe is whichever branch claims less. PURE.
export function dispatchBlockState(ctx, stage, id) {
  const rec = ctx?.dispatchBlocks?.[stage];
  if (!rec) return "absent";
  if (rec.built?.includes(id)) return "present";
  if (rec.failed?.some((f) => f.id === id)) return "failed";
  return "absent";
}

// ── The two synthesis lines that make a claim about the blocks, branched in ONE place ──────────────
//
// Returned as an array the message spreads, so the branch is a named function a test can drive over
// every shape rather than a ternary buried in a 900-character template literal.
//
// THE NO-BLOCK BRANCH IS NOT SILENCE, and that is the whole lesson of the digest's coverage form one
// stage upstream: the first cut of THAT build told every digest not to write a ledger while arming the
// form conditionally, so a run with no form judged no coverage at all and passed. Dropping these two
// lines when no block builds would repeat it exactly — the seat would lose ASSERT-OR-DEFER itself, not
// just the table. So the rule is stated on every shape; only the sentence describing what is BELOW
// changes, because that is the only sentence that was ever making a false claim.
export function synthesisRegisterRecordLines({ dispatchBlocks, paths: P, registerOnly }) {
  const stateOf = (id) => dispatchBlockState({ dispatchBlocks }, "synthesis", id);
  const receipt = stateOf("synthesis-plan-audit");
  const ledger = stateOf("synthesis-coverage-ledger");
  const named = (s, what, path) => (s === "present" ? `${what} (${path})` : "");
  const below = [named(receipt, "the plan-execution receipt", P.planExecution), named(ledger, "the coverage ledger", P.registerCoverageLedger)].filter(Boolean);
  const broken = [receipt === "failed" ? `the plan-execution receipt (${P.planExecution})` : "", ledger === "failed" ? `the coverage ledger (${P.registerCoverageLedger})` : ""].filter(Boolean);

  // A builder that THREW is a driver-written artifact that exists and will not parse. That is a bug in
  // this machine, not a run shape, and the seat is told so in those words: it must not read the silence
  // where the table should be as "nothing to disclose", which is the failure mode of the whole issue.
  const brokenClause = broken.length
    ? ` DRIVER ARTIFACT FAULT: ${broken.join(" and ")} exists on disk and could NOT be parsed by the driver this run — that is a defect in this machine, not a statement that the slice is clean. Treat everything it would have covered as UNVERIFIED: you may not call any register slice searched-clean on the strength of a record the driver could not read, and the coverage judgment says so.`
    : "";

  const record = below.length
    ? `DISPATCH RECORD — the REGISTER layer's, authoritative and driver-written: ${below.join("; ")} — tabulated below, every row, so nothing here needs re-deriving.${brokenClause}`
    : `DISPATCH RECORD — NONE this run. The driver composed no register record for this dispatch, so there is NO table below and nothing in this message is a driver-verified statement of what ran.${brokenClause}`;

  const ground = below.length
    ? `KNOW WHICH GROUND YOU ARE ON: the REGISTER layer has a driver-computed record — ${below.join(" and ")} — and it is tabulated for you below. No other layer does${registerOnly ? " on this run" : ""}.`
    : `KNOW WHICH GROUND YOU ARE ON: NO layer has a driver-computed record on this run and no table follows, so the register layer stands on exactly the same standard as every other one — a source you read and can cite. An absence of tabulated gaps is NOT a clean register: it is the absence of a record, and a clean claim needs the source, never the silence.`;

  const commonLaw = registerOnly ? "" : ` ${P.commonLaw} is not a dispatch record either — it is that stage's own narrative, so reading it as proof a check ran turns its assertion into yours. Its \`## Coverage ledger\` section is the exception you MUST still read, and in one direction only: it names the common-law units this run did NOT close, and a unit recorded there as \`coverage-limited\` or \`deferred\` can never be written as a clean negative. It licenses nothing — a \`confirmed-clean\` row there is that stage's own word, so a clean common-law statement still needs the source you read, exactly like every other off-register fact.`;

  return [
    record,
    `ASSERT-OR-DEFER: a fact whose supporting search did not run is not yours to assert. Say the check was not dispatched this run and stop — never describe what such a check would have shown, and never attach names, parties or outcomes to it. ${ground}${commonLaw} Off the register the standard is the one ATTRIBUTION SOURCE above already sets: a source you read and can cite. USE-CHECK, OWN-RIGHTS and ATTRIBUTION SOURCE are three named instances of this single rule, and an owner's enforcement history — oppositions, proceedings, disputes — falls under it exactly as they do: off-record facts need a source, not a register receipt they could never appear in. A fact you defer that you could have supported is a small loss; a fact you assert that you cannot is the one this contract exists to stop.`,
  ];
}

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
    readingLog: p(driverRel("reading-log.jsonl")),   // band-server appends every lookup — audit.md "# Reading audit" renders from it
    // P2-A (the recall spine) — three driver-derived sidecars:
    // the retrieved→judgment reconciliation (recall-reconciliation.mjs join, re-derived after EVERY
    // digest pass; unended > 0 blocks delivery), the exact-identity positions projection (charter
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
    // placement already selected — and the seam that lost the jx lane's own target (ten banded 色度
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
    instructedScope: p(driverRel("instructed-scope.json")),
    // compute-don't-author — the per-class scope truth (scope-facts.mjs): instructed × frozen plan ×
    // band states × coverage ledger. The masthead classes/coverage_line are stamped FROM this sidecar.
    scopeFacts: p(driverRel("scope-facts.json")),
    // D1 — arms the registerFindings off-enum status gate; — the SAME sentinel carries the coverage
    // form's era stamp (`form_required`/`form_path`). One file, two facts, written by runDigest before
    // every digest pass it dispatches and BEFORE the form itself, so a failed form write fails closed.
    coverageEnum: p(driverRel("coverage-enum.json")),
    // — the seat-facing coverage form. DICTATED here so 's stray-artifact sweep knows the
    // driver put it there; the accumulator beside it in `_driver/` is derived from this name.
    narrative: p("narrative.md"),
    findings: p("findings.json"),  // Phase 1 — the per-finding machine contract; synthesis mirrors its RATED findings into this JSON, the report/Excel render consume it
    caseLaw: p("case-law-findings.md"),
    // — the RETRIEVAL RECORD beside the prose. Until this existed, `case-law-findings.md` was the
    // only artifact case law produced and its whole contract was a non-empty check, so "the sweep ran"
    // and "the dive read something" were unanswerable and 's record trace had nothing to join to.
    caseLawCitations: p("case-law-citations.json"),
    seniorEyeReview: p("senior-eye-review.md"),
    // delivery contract (file-gated; rendered to the page by the pure-code publish step)
    report: p("report.md"),       // CODE (assembleReportMd) — the assembled client report (overview + per-card)
    reportOverview: p("report-overview.md"),        // CODE (report-overview-record.mjs) since conversion 4 — the driver renders the shell off the record_report_overview call; NO card bodies
    reportCardsDir: p("report-cards"),              // B1 — per-finding card files (one isolated LLM call each)
    reportCard: (ord) => p(join("report-cards", `${ord}.md`)),  // B1 — LLM (report-card): ONE card from finding[ord]'s own record
    audit: p("audit.md"),         // CODE (buildAuditMd from the spine) — full audit record
    // THE SEAT WRITES THIS ONE, so it cannot live in `_driver/`. 's write boundary makes
    // `<runDir>/_driver/**` a tree a seat may NEVER write into (authority-trees.mjs:70, `live: true`) —
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

// Forwarding agent → the chat number it is bound to. A ROUTING KEY, and since that is ALL it is:
// nothing in this repo sends a message, so this table's only job is to put a `whatsappTo` field on the
// outbox packets an integrator consumes (docs/DELIVERY.md). It used to additionally decide whether two
// send STAGES ran, and those stages are gone.
// Keyed by agent id (== the queue location the runner derived), the same key the binding uses.
// CLEAROTRON_AGENT_WHATSAPP (JSON object, e.g. {"main":"+41..."}) overrides per deployment — the roster is
// tenant config, not code. Read once at import (deployment-static, like the systemd env). The fallback
// keeps the legacy demo roster so offline tests and the reference deploy work unchanged.
export const AGENT_WHATSAPP = (() => {
  try {
    const m = JSON.parse(process.env.CLEAROTRON_AGENT_WHATSAPP || "");
    if (m && typeof m === "object" && !Array.isArray(m)) return m;
  } catch { /* fall through to the demo roster */ }
  return { clawdi: "+10000000001", "clawdi-alex": "+10000000002", "clawdi-sam": "+10000000003" };
})();


// D3 — the escalation-risk SHADOW apparatus (ESCALATION_RISK_MENU + parseEscalationRisk +
// the CLEAROTRON_ESCALATION_FILTER flag) is DELETED: it logged a category per ESCALATE line for a filter
// that was never turned on, and the crowd/judgment redesign made the category vocabulary stale.
// ESCALATE lines themselves (which axes re-run) are unchanged.
// SWEEP_AXES was DELETED 2026-08-03. It was a three-entry shadow of the live four-entry REGISTER_AXES
// (coverage-ledger.mjs), had no reader tree-wide, and was already WRONG — it never gained
// saturation-probe. A design doc named it as the live mechanism; that reference now points at
// REGISTER_AXES, which is the vocabulary the plan, the coverage ledger and the MCP faces all use.

// ── — THE COMMON-LAW SEATS' TIER, PER SEAT, AS DATA ──────────────────────────────────────────
//
// THE MEANING SEAT IS ON SONNET (2026-08-11). built this map so the tier could move for one seat
// and asked for the decision to be taken "on the round's evidence rather than in advance". Six measured
// clearances later the evidence is one-sided: the meaning seat has never converged on attempt 1 on
// haiku/low, on any run, and the two candidate confounds have both been eliminated by shipping them —
// `cdec607`'s write mode did not close it (a run on that engine still took 3 attempts and 26m48s) and
// 's clause split did not close it (5 attempts across 2 ladders on the acceptance round). Its
// ladder costs 15–28 minutes of critical path per clearance, every clearance, because the halves fan in
// and this seat is the wave maximum whenever its matter is dense.
//
// ONE VARIABLE MOVES. `thinking` stays `low` on all three seats. The alternative — the sonnet/adaptive
// pair `axisTier` hands every non-seat axis — moves the model AND the thinking budget, and a round that
// improves under it cannot say which one bought the improvement. That is the same attribution trap
// wrote itself to avoid, one level in.
//
// WHAT IT WILL NOT FIX, STATED SO THE ROUND IS NOT MISREAD. Every measured failure is bookkeeping, not
// judgment: a literal `RULED-BENIGN` written where a receipt id belongs, a well-formed id bound to the
// wrong row, a form left untouched while a polished narrative was written. A stronger model does
// bookkeeping better; it does not stop the bookkeeping being the seat's job. 's class ruling — hand
// the constraint to the model instead of grading it against one — is the cure, and this is not it.
//
// WHY THE SEATS NEEDED SEPARATING. gave the meaning seat its own job and left it on the tier the
// grid halves were resourced for. A grid half judges returned candidates against a term x platform
// sweep — bounded, mechanical. The meaning seat rules up to 84 reputational receipts, each needing a
// the candidate's POSITION, a one-line reason, and where `quote_required` a short anchor into the
// characters. That is judgment work, and it is the only seat of the three doing it.
//
// AND IT IS NOT A FEATURE GATE. There is no flag, no env var and no second code path: the tier is a
// value, and moving it back is the same one-line data edit through review that moved it here. That is
// the whole difference between an A/B this program allows and one it forbids.
//
// CLEAROTRON_MEANING_SEAT_MODEL — the meaning seat's model, overridable from the environment, on exactly
// the shape `CLEAROTRON_SYNTHESIS_MODEL` already has: one stage, one variable, unset ⇒ the shipped default,
// toggled in the box's .env and never hardcoded here.
//
// IT EXISTS TO SETTLE A QUESTION THAT IS CURRENTLY UNANSWERABLE. The tier moved to sonnet and moved
// what this seat is TOLD on a refusal, in the same range — so the first-attempt pass on the next round
// cannot be attributed to either. The measured result is also not what the flip was bought for: on the
// delivered run of 2026-08-11 the seat converged in ONE attempt and still took 1674.2s, against 1721s
// over EIGHT attempts on haiku. The tier bought convergence and not wall — and `:a` (431.1s) and `:b`
// (452.9s) passed first time on the haiku it failed on, which is the strongest evidence in the file
// that the defect is bookkeeping rather than judgment.
//
// So E2E can run the seat on haiku against CURRENT code, one variable, no second code path and no
// revert: `CLEAROTRON_MEANING_SEAT_MODEL=haiku` on the box, one run, read `_driver/common-law-half:m.jsonl`.
// `thinking` is deliberately NOT overridable — two movable variables is the trap this whole entry was
// written to avoid.
// ── THE QUESTION IS SETTLED: haiku (2026-08-12) ──────────────────────────────────────────────────────
//
// The experiment the block above specifies was run — `CLEAROTRON_MEANING_SEAT_MODEL=haiku`, one variable, on
// `857db4a`, in the 2026-08-12 certification round — and the answer is that the sonnet default was
// bought against the wrong baseline. Reading `_driver/common-law-half:m.jsonl`, which is the file that
// entry names:
//
//   R2, 08-09, pre-         haiku    7 attempts (6 failed)   1972.1s
//   quoted in-file, undated      haiku    8 attempts               1721s
//   quoted in-file, 08-11        sonnet   1 attempt                1674.2s
//   R2, 08-12, on 857db4a        haiku    2 attempts (1 failed)     422.9s
//
// **haiku on current code converges in 2 attempts at 423s — 4.7x faster than haiku on the old code.**
// The haiku→haiku pair is the solid row and it is attributable to the CODE, not the tier: changed
// what the seat is told on a refusal, and that is what bought the convergence. The sonnet flip was
// measured against pre- haiku, so it was credited with an improvement it did not cause. Against
// current code sonnet's 1674.2s is ~4x the wall of haiku's 423s for the same delivered outcome.
//
// THE MARGIN, RECORDED RATHER THAN BURIED. Adequacy is load-dependent: R2 two attempts, R1 two attempts,
// **R6 three attempts and the last rung of the ladder**, tripping two different gates
// (`connotation_token_absent=12`, then `connotation_quote_unbound=3`). R6 is the heaviest meaning
// workload the offering sells. So haiku is sufficient at every load the suite exercises, and at R6's
// load it is sufficient BY EXACTLY ONE ATTEMPT. The ladder is the backstop and that is what a backstop
// is for — but a round that sees R6's meaning seat go terminal should suspect this line first, and the
// margin is the reason it should.
//
// WHAT THIS DOES NOT CHANGE. `thinking` stays `low` on all three seats — one variable moves, still. The
// override stays: `CLEAROTRON_MEANING_SEAT_MODEL=sonnet` on the box restores the old behaviour with no code
// change and no second path, which is the same one-line data edit that moved it here. And it does not
// fix the class of defect above: every measured failure is bookkeeping, and a cheaper model does
// bookkeeping no worse than a dearer one did — 's ruling remains the cure.
//
// SAVES ~20 MINUTES OF CRITICAL PATH PER CLEARANCE. This seat is the wave maximum whenever its matter is
// dense, so its wall is the fan-in's wall.
export const COMMON_LAW_SEAT_TIER = {
  a: { model: "haiku", thinking: "low" },
  b: { model: "haiku", thinking: "low" },
  [MEANING_SEAT]: { model: process.env.CLEAROTRON_MEANING_SEAT_MODEL || "haiku", thinking: "low" },
};

// per-axis tier: saturation-probe is the only haiku register unit; the sweeps run sonnet (the authorized fix).
//
// — the grid seats resolve here too, and that is a MOVE rather than an addition: `common-law-half`
// no longer carries a static `model`/`thinking`, because a static one wins over this function and would
// make the per-seat map dead. The old comment on that stage warned that "def.model wins over axisTier so
// the tier never misreads the half id" — the hazard it named was axisTier returning the SONNET default
// for a half id, and naming the seats here removes it by construction instead of by avoidance.
export function axisTier(axis) {
  if (Object.hasOwn(COMMON_LAW_SEAT_TIER, axis)) return COMMON_LAW_SEAT_TIER[axis];
  return axis === "saturation-probe" ? { model: "haiku", thinking: "off" } : { model: "sonnet", thinking: "adaptive" };
}

// Active register provider — the single source of truth (driver.config.REGISTER_PROVIDER; flip + redeploy
// to switch). ONE provider per run, never both. The provider-specific tool names + operator vocabulary
// live in skills/prelim-register/providers/<provider>.md, which the register spawns are told to read.
const PROVIDER = REGISTER_PROVIDER;
// THE FOURTH SILENT FALLBACK, and the only one that fabricates rather than defaults. An id with
// no PROVIDERS entry used to synthesise a meta pointing at `providers/<whatever>.md`, and stages.mjs
// then TELLS THE SPAWN TO READ THAT FILE. A mis-set or unset variable therefore produced an instruction
// to read a document that does not exist — which a model resolves by carrying on with no provider
// vocabulary at all, and the run looks like a model that chose not to read its brief.
//
// Not thrown at module load: this module is imported by the whole test suite and by tools that never
// run a clearance, and `activeProvider()` / `preflightCredentials()` already refuse at the doors a real
// run passes through. What it must not do is INVENT a document.
// EXPORTED since conversion 4: the report shell's `run:` line is `<date> · <provider> + common-law`, and
// the provider half is this label. It was a driver fact the seat retyped out of the dispatch; the driver
// stamps it now, and it reads the label from here rather than re-deriving it from CLEAROTRON_DATABASE
// — a second derivation of a provider name is how a masthead ends up naming a register the run never used.
export const PROVIDER_META = PROVIDERS[PROVIDER] ?? {
  label: PROVIDER ?? "(none configured)",
  skillDoc: null,
  hasPublicRecordUrl: true,
};

// ---- message builders (faithful to the spawn briefs in phase2-execution.md; the leaf reads the skill for detail) ----
export const lines = (...a) => a.filter(Boolean).join("\n");

// ── — THE PROSE RUNG FOR SYNTHESIS ──────────────────────────────────────────────────────────
//
// Owner: "on a worldwide search you go deep on what's genuinely in the way, and you record the rest
// properly. Same judgment, different threshold — which is what a lawyer actually does."
//
// THE TYPED REGISTER IS NEVER GRADED and the instruction says so first, because that is the sentence
// standing between this and a filter. Every downstream surface — the cards, report.html, the xlsx,
// reference-score.mjs — builds from findings.json. What this rung shortens is the SECOND account of the
// same conflict, authored in prose beside the typed fields ( measured 41,506 B of narrative prose
// against the same findings' 32,349 B of typed fields, verbatim overlap).
//
// NO COUNT APPEARS HERE, EVER. A number turns judgment back into a rule, and an arithmetic cut is what
// re-opens. The stage is told what kind of report it is writing and grades its own writing.
//
// THE UNCERTAINTY DIRECTION IS DELIBERATE. The rung is phrased as "the rest", not as a list of what
// earns prose: a mark the seat is unsure about is not clearly "the rest", so it keeps its write-up.
// Phrased the other way — "write prose for X and Y" — a seat that could not resolve Y would silently
// write less, which is the one direction this must not fail in.
//
// Returns "" for the ungraded rung, and `lines()` drops it — so a one-country dispatch is byte-identical
// to today's, by construction rather than by a branch anybody has to remember.
// ── lever 2 — THE INQUIRY TRACE RUNG ────────────────────────────────────────────────────────
//
// `placement-inquiry` runs BEFORE any disposition exists, so its depth cannot be gated on one. Owner
// ruled it must not be gated by the driver at all: the stage is told what kind of report it is writing
// and grades its own WRITTEN REASONING.
//
// THE FORM IS UNCHANGED IN EVERY PRODUCT, and that is the mechanical proof this is scope and not
// quality: every surfaced candidate still gets a placement tier and a row in placements.json, and the
// DRIVER renders that form from what the seat fills. The seat cannot drop a candidate by
// writing less about it, whatever this instruction says.
//
// THIS LEVER COMPOUNDS, and the spec says so as a risk rather than a benefit:
// `placement-recommendations.md` is dispatched forward to register-digest, synthesis,
// narrative-refutation and report-overview, so a lighter trace on a marginal mark stays lighter through
// four more stages. What it cannot cost is the mark's existence.
//
// Same three disciplines as the prose rung: whitelist so a typo cannot grade, no count in the wording,
// and "" for the ungraded rung so a one-country dispatch is byte-identical by construction.
// ── lever 3 — THE SKEPTIC'S FLAGGING BAR ────────────────────────────────────────────────────
//
// The stage is told the report type and sets its own bar for what is worth flagging. THE ESCALATION
// RE-WALK ITSELF IS NOT GATED, in any product, and the reason is on the record: gating a RECALL check on
// the marks we already found is circular — an axis holding nothing on the obligation list is exactly
// where a missed floor row hides. Do not "improve" this later by adding a gate.
export function skepticRungDirective(depth) {
  const rung = String(depth?.skepticFlagging ?? "as-today");
  if (rung !== "graded" && rung !== "graded-high") return "";
  const breadth = rung === "graded-high"
    ? "This is a WORLDWIDE search, and its bar is the higher one."
    : "This is a MULTI-COUNTRY search, so the bar for a re-walk sits higher than on a single country.";
  return `DEPTH OF WRITING — ${breadth}\n`
    + "FIRST, WHAT DOES NOT CHANGE: every axis you flag is still re-walked in full, and you are still "
    + "reading for what the search MISSED. Nothing about this narrows the re-walk, and nothing here is a "
    + "reason to leave a gap unflagged that you believe is real.\n"
    + "Flag what is worth a re-walk at this breadth. For the rest, say what you saw and move on — a note "
    + "in your read is the record. If you are unsure whether a gap is worth flagging, flag it: an axis "
    + "nobody re-walked is exactly where a missed floor row hides.";
}

// ── lever 3 — THE VARIANT MANIFEST'S OWN BAR ────────────────────────────────────────────────
//
// The manifest multiplies the register plan, so the sweeps shrink with it. NO COUNT REACHES THIS
// INSTRUCTION and the reason is sharper here than anywhere else in the ladder: an arithmetic cut to a
// variant list removes non-Latin spellings first, which is precisely what was opened for.
export function variantRungDirective(depth) {
  const rung = String(depth?.variantManifest ?? "as-today");
  if (rung !== "graded" && rung !== "graded-high") return "";
  const breadth = rung === "graded-high"
    ? "This is a WORLDWIDE search, and its bar is the higher one."
    : "This is a MULTI-COUNTRY search — breadth of ground, not depth per spelling.";
  return `DEPTH OF WRITING — ${breadth}\n`
    + "FIRST, WHAT DOES NOT CHANGE: every script the matter's territories actually use is still carried, "
    + "and a transliteration or non-Latin spelling is NEVER what you drop. Those are the spellings a "
    + "conflict hides behind, and dropping them is the failure this engine has already paid for.\n"
    + "Grade the rest of your list to what this breadth needs. For the rest — near-duplicate Latin "
    + "spellings that no register would separate — DROP the near-duplicate. Do not keep an entry to "
    + "represent the ones you dropped: grading here is by omission and nothing else.\n"
    + "A term field is dispatched to the register VERBATIM, so it holds the searchable string and "
    + "nothing besides — no parenthetical, no note on what a term covers, no reasoning. Anything you "
    + "want to say about a spelling goes in the rationale field, never inside the term. If you are "
    + "unsure whether a spelling earns its own entry, carry it.";
}

// ── lever 3 — WHICH FINDINGS EARN A GROUNDED PROFILE ────────────────────────────────────────
//
// `narrative-refutation` runs in every product and reaches its verdict over the WHOLE narrative in every
// product. What narrows is which findings get a grounded profile written against them.
//
// THE VOCABULARY IS `disposition`, NOT "band". The spec's ladder says "band 1 / band 2"; its own
// definition table maps those to dispositions — `adversarial` (band 1), `coexistence-partner` /
// `distinguished` (band 2), `off-field` (band 3). A finding's actual `band` field is a RISK WORD from
// whichever framework the run read ("High", "Manageable", "Very High", …) and gateway.mjs forbids
// numbering it: "no numbers, no codes, no words from any other scale". An instruction naming "band 1"
// would name nothing the stage can act on, and would vary by framework where it did.
// — RETIRED, and kept as a tombstone rather than deleted. This graded grounded profiles by asking
// the seat to classify findings by disposition at review time. The band is on findings.json BEFORE this
// stage is dispatched, so the architecture's rule applies: prefer driver selection where the key
// precedes the dispatch. `profile-selection.mjs` lists the ordinals; nothing calls this.
//
// Left in place because the NEXT lever to be converted will look for what the directive form looked
// like, and a deleted function teaches nothing about why it stopped being the right shape.
export function profileRungDirective(depth) {
  const rung = String(depth?.groundedProfiles ?? "every-finding");
  if (rung !== "adversarial" && rung !== "adversarial+partner") return "";
  const kept = rung === "adversarial"
    ? "the `adversarial` findings — the ones genuinely in the way"
    : "the `adversarial` findings, and the `coexistence-partner` and `distinguished` ones";
  const breadth = rung === "adversarial"
    ? "This is a WORLDWIDE search, and its bar is the higher one."
    : "This is a MULTI-COUNTRY search.";
  return `DEPTH OF WRITING — ${breadth}\n`
    + "FIRST, WHAT DOES NOT CHANGE: you still read the WHOLE narrative and you still reach your verdict "
    + "over all of it. Every finding is still refuted or allowed to stand on its own terms. This is about "
    + "which findings you write a grounded profile against, never about which you examine.\n"
    + `Write the grounded profile for ${kept}. For the rest, your read stands without one. If you are `
    + "unsure whether a finding needs a profile, write it — a conflict examined thinly is the cost this "
    + "cannot pay.";
}

export function inquiryRungDirective(depth) {
  const rung = String(depth?.inquiryTrace ?? "full");
  if (rung !== "graded" && rung !== "graded-high") return "";
  const breadth = rung === "graded-high"
    ? "This is a WORLDWIDE search, and its bar is the higher one: across this much ground, only a candidate genuinely in the way earns the full written inquiry."
    : "This is a MULTI-COUNTRY search — it trades breadth for depth per candidate, which is what a lawyer does when the question spans more ground.";
  return `DEPTH OF WRITING — ${breadth}\n`
    + "FIRST, WHAT DOES NOT CHANGE: every candidate you surface still gets a placement tier and its row, "
    + "exactly as on a single-country search. Nothing is dropped, nothing is filtered, and this says "
    + "nothing about WHERE a candidate is placed — only about how much of your own reasoning you write "
    + "down beside it.\n"
    + "Write the full inquiry for the candidates you judge are genuinely in the way. For the rest, a "
    + "placement line carrying your reason is the record. If you are unsure which side of that line a "
    + "candidate falls, write the full inquiry — the later stages read this file, so a thin trace on a "
    + "mark that mattered stays thin through everything downstream.";
}

/**
 * — the narrative depth directive, owner-ruled and written verbatim.
 *
 * FIVE NUMBERED RULES, TWO SLOTS, AND NO INTERPRETIVE PHRASE. The directive this replaces asked the seat
 * to judge at write time which marks were "genuinely in the way" — a second judgment, on top of one it
 * had already made. Rule 2 is now a LOOKUP of a decision the seat records anyway: the band it assigns
 * each finding in the same pass, in the same file.
 *
 * KEYED TO BAND RANK, ORDINAL AGAINST THE RUN'S OWN MANIFEST. Frameworks carry different band
 * vocabularies and different lengths, so the rank is the only portable key — a list of band names would
 * select nothing on a framework that spells them differently, and a cut that keeps everything reads
 * exactly like a cut that works.
 *
 * ABSENT PARAMETERS MEAN NO DIRECTIVE, which is what byte-identical means for the ungraded product: it
 * is told nothing new, rather than told a permissive version of the rule.
 */
export function proseRungDirective(depth, bandOrder = null) {
  const rank = Number(depth?.narrativeKeptBandRank);
  const maxWords = Number(depth?.narrativeWriteUpWords);
  const bands = Array.isArray(bandOrder) ? bandOrder : null;
  if (!Number.isFinite(rank) || rank < 1 || !Number.isFinite(maxWords) || maxWords < 1) return "";
  // The kept list is stated as the BAND NAMES this run's manifest carries at those ranks when the driver
  // knows them, and as the rank otherwise. The seat is told a set of values it holds, never a concept.
  const keptList = bands && bands.length
    ? bands.slice(0, rank).map((b) => `\`${String(b?.label ?? b)}\``).join(", ")
    : `the top ${rank} bands of this run's risk framework, in the order the framework lists them`;
  return [
    "DEPTH OF WRITING — rules for prose write-ups in narrative.md on this run.",
    "1. Every finding gets its complete typed record in findings.json. No exceptions. The rules below are about prose in narrative.md only.",
    `2. Write a prose write-up for a finding only if its band is one of: ${keptList}.`,
    "3. For every other finding, write no prose write-up. Its typed record is its write-up.",
    `4. Each prose write-up is at most ${maxWords} words.`,
    "5. These rules never change what you conclude, what disposition you assign, or which marks appear in the report.",
  ].join("\n");
}


// ION/copper-foundry 2026-07-22 — the supplemental lane's two load-bearing facts, in ONE place:
// WHICH tool the lane removes, and WHAT the model is told about its absence.
//
// pipeline.mjs's dispatcher resolves a stage's prompt as `opts.followup ?? opts.freshMessage ??
// def.message(ctx)` — a followup/freshMessage REPLACES the stage message wholesale. So every
// re-dispatch path (escalation, envelope close, frame-reopen, the corrective ladder) that re-states
// the lane by hand can drift out of step with the exclusion, and a prompt that names the removed tool
// teaches the model the absence is a fault. That is exactly how ION's incumbent-class pass reported
// `register_enumerate` "permission-blocked" in a delivered report. Import these; never re-type them.
export const REGISTER_ENUMERATE_TOOL = "mcp__register__register_enumerate";
export const SUPPLEMENTAL_LANE_STEERING = "register_enumerate is NOT available to you on this run and its absence is BY DESIGN, never an outage or a permission fault — never report it as one, and never fall back to sampling with register_search where a proposal would enumerate.";

// The OWNER axis, steered rather than exempted (owner's call, 2026-07-27; REWRITTEN 2026-07-29, PR-1
// F1). ION's incumbent-class pass fell back to count-only register_search and "reviewed" 10 of
// Apple's 432 hits — those owner queries effectively unscreened, written up as coverage. Then
// the 2026-07-28 E2E run showed the deeper defect: our own prose rule forbade the {owner + mark-text}
// composition BOTH live providers execute natively in one call, so nine of sixteen owner queries
// ended as count-only crowds ("portfolio too large, noted") when the owner×term intersection would
// have enumerated every one of them (the six mega-owners collapse below any ceiling once intersected
// with the term band).
//
// TOOL TRUTH (verified against the code): mintSupplementalEntries (engine/mcp/supplemental.mjs)
// accepts `owner` as a SCOPE FIELD on a mark-text proposal, and defaultBuildEntryQuery
// (providers/_shared/execute-plan.mjs) carries it as an owner clause NEXT TO the name clause — one
// query, owner × term × class, on every provider whose contract declares ownerTermIntersection
// (a provider without it defers the slice loudly; it is never silently widened to mark-only).
// predicate:"owner" remains the BARE portfolio sweep (the term IS the owner name) — count context.
export const OWNER_SWEEP_STEERING = `OWNER / WATCHLIST COVERAGE on this lane: the owner×term slice is THE coverage instrument for a named owner — a mark-text proposal carrying the owner as a scope field, e.g. {predicate:"exact"|"default", term:"<the mark/element>", owner:"<the owner>", nice_classes:[…]}. That intersects the owner's portfolio with the dangerous band in ONE query and ENUMERATES record-by-record even where the bare portfolio is a many-thousand crowd — so a watchlist owner is answered by records, not by a number. The manifest's watchlist_owners are ALREADY compiled into the frozen plan as exactly this lane (qids "…+owner-<owner>" slices + one "…+watch" bare-owner count whose covered_by points at them) — read those band blocks before proposing a duplicate; your proposals are for owners the run surfaced that the manifest did not seed. A bare predicate:"owner" proposal (the owner name as the term; nice_classes REQUIRED — an all-class owner sweep is refused) is CROWD CONTEXT, not coverage: an honest "incomplete" COUNT descriptor that sizes the portfolio and whose write-up POINTS AT the owner×term slice qids that actually cover it — never "portfolio too large, noted" as an ending in itself. register_search {owner, name} stays what it is: a COUNT-ONLY context probe (limit:1), a count, never a review pass. And you NEVER stand sampled register_search pages in for either — not for a slice, not for a sweep — nor write such a sample up as though the owner had been screened: ten of an owner's 432 hits presented as review is a recall hole with a clean face, not a search. "Portfolio too large, noted" is never a finding: size the crowd, then cover it with owner×term slices.`;

// PR-8 (reading layer) — the ONE band-reading contract every band-consuming judgment stage receives.
// The raw merged band is NOT named to the model any more (it stays a declared stage input for
// freshness hashing, and on disk for the machine checks, which all keep reading the COMPLETE band):
// judgment reads the deterministic SHAPE whole and looks up the records it chooses through the band
// tools, on the record — every lookup lands in the run's reading audit. This replaces the improvised,
// unlogged shell-slicing of a multi-megabyte file that no Read call could ever take whole.
export const BAND_READING_CONTRACT = `THE REGISTER BAND — how you read it: call `+"`band_shape`"+` FIRST (the deterministic shape of the complete merged band: totals, mechanical similarity tiers, THE FLOORS — every live in-class identical/near-identical record, listed individually and unconditionally — class/status/registry/recency census, owner concentrations, the `+"`incomplete`"+` crowd descriptors, and the blind spots the shape mechanically cannot see). A large shape is served in PARTS — the response labels itself part N/M and names the next call; read ALL parts before reasoning (a partial shape is never the shape). Then pull exactly the records and slices your reasoning needs via `+"`band_lookup`"+` (filter by owner / class / tier / qid / slice / text; matching un-enumerated crowds ride along so a counted-only zone can never read as a clean) and `+"`band_record`"+` (the official registry record fetched into this run, when one exists). Every floor row must be weighed — the floors list is complete by construction and no lookup pattern excuses skipping one. A crowd descriptor is an open slice for judgment to act on (cleared / material-gap), never a cleared slice by default; the shape's tiers are mechanical string classes, never a relevance or risk call — both of those remain yours. Do NOT slice band or shape files with shell tools: the band tools are the reading layer, and they keep the reading on the record.`;

/**
 * `borderline` on a placement entry is an INTERNAL adjudication flag: placement declaring that its own
 * answer to the promotion question could be argued either way on this record. Four stages read
 * placements.json — the digest, synthesis, narrative-refutation and report-overview — and three of them
 * author reader-facing prose, so the rule that keeps it out of the client's report has to travel with the
 * file rather than being restated per skill. Stated once here and appended wherever the file is named: a
 * rule you have to repeat in four places is a rule that will drift out of one of them.
 */
/**
 * Item 10, the BAND declaration — the same discipline gave placement's promotion question, one level
 * up, and deliberately NOT a band criterion. Writing a question that decides Very High from High would
 * overwrite the customer's own rating doctrine with ours; this only asks a stage to SAY when the
 * framework's own criteria do not decide.
 *
 * Stated once here and appended wherever the field is named, for the reason PLACEMENT_BORDERLINE_NOTE
 * gives: a rule repeated in four places is a rule that will drift out of one of them.
 */
export const BAND_BORDERLINE_NOTE =
  `DECLARE A BAND YOUR FRAMEWORK DOES NOT DECIDE. Where the framework's OWN criteria do not cleanly settle ` +
  `which of two of its bands a conflict belongs in — where a competent lawyer reasoning through the same ` +
  `framework on the same record could land on either — say so: add "borderline_between": ["<band A>", ` +
  `"<band B>"] to that finding, naming exactly those two of the framework's band words. You STILL give ` +
  `"band" your best answer, and it must be one of the two you named — the declaration records that the ` +
  `criteria left the question open, never that you declined to answer it. Declaring one is a correct ` +
  `professional outcome; what is a failure is a confident band on a record the framework does not decide. ` +
  `Omit the key entirely when the criteria DO decide, which is the ordinary case. It is INTERNAL routing ` +
  `and audit data between stages and runs: it NEVER becomes hedge language on a reader-facing surface — ` +
  `the report states the position reached, not the confidence the pipeline had in reaching it.`;

export const PLACEMENT_BORDERLINE_NOTE =
  `A placement entry may carry "borderline": true — placement's own declaration that its answer to the ` +
  `promotion question (does this conflict change the advice, or only complete the record?) could be argued ` +
  `either way on this record. It is INTERNAL adjudication data between stages: read it, weigh it, disagree ` +
  `with it in your own reasoning. It NEVER becomes hedge language on a reader-facing surface — the report ` +
  `states the position reached, not the confidence the pipeline had in reaching it.`;

/**
 * What a judgment stage is told when the run is REGISTER-ONLY (searchPolicy components.commonLawGrid
 * false). No common-law worker ran and no common-law-findings.md exists, so every prompt that would
 * name that file drops the clause and adds this line instead — a stage told to read a file that was
 * never written is the failure mode this replaces.
 *
 * It says "absence of evidence is not evidence of absence" in the one place it can bite: the model
 * must not read an empty marketplace surface as a clean marketplace. The DELIVERED flag is separate
 * and lives in riskStatement (findings-model.mjs), where every published surface joins it.
 */
export const REGISTER_ONLY_NOTE = "SCOPE — this is a REGISTER-ONLY search: no common-law / marketplace sweep ran and there is no common-law findings file. Reason from the register material alone. Do NOT treat the absence of unregistered-use evidence as evidence of absence, and do not write as though marketplaces, storefronts, app stores, social handles or domains were checked — they were not.";

/**
 * — the report shell's front-matter IDENTITY fields (`matter` / `title` / `client` / `use`),
 * supplied INLINE from the intake record. It names no file, so it costs the citation contract nothing.
 *
 * These were never reliably sourced. `matter-context.md` was `report-overview`'s declared carrier for
 * them and the 08-02 R2 run never opened it — but the frame could not have answered anyway: matter-frame
 * is handed the mark, classes, goods, territories and customer and NEVER `job.ref`, so the TMP reference
 * has no source in that file at all. What the model actually had was the run-dir path in its writeReturn
 * line (the slug is `tmp<ref>-<kebab-mark>` — phase0.mjs deriveSlug), i.e. `matter:` and `title:` were
 * being reverse-engineered out of a directory name. render.mjs binds both: `fm.title` is the report's
 * <h1> and `fm.matter` the masthead reference.
 *
 * The pattern is report-card's (`ctx.finding` inline, T7): a fact the driver holds is HANDED to
 * the model, never left to model discretion over an optional file. FALSY-OMITTED per field, and the
 * whole block drops when the run knows none of them — a header with no fields under it would be an
 * instruction to invent.
 */
export function frontMatterIdentity({ job, profile } = {}) {
  const rows = [
    job?.ref || job?.tmp ? `- matter: ${job.ref ?? job.tmp}` : "",
    job?.name || job?.markName || job?.marks?.[0]?.name ? `- title: the project / mark label — ${job.name ?? job.markName ?? job.marks?.[0]?.name}` : "",
    job?.customer ? `- client: ${job.customer}` : (profile?.name ? `- client: ${profile.name}` : ""),
    job?.goods ? `- use: ${job.goods}` : "",
  ].filter(Boolean);
  if (!rows.length) return "";
  return lines("FRONT-MATTER IDENTITY (from the intake record — copy these VERBATIM into the front-matter; do NOT re-derive them from the run path, the narrative or the findings):", ...rows);
}

/**
 * P6 (charter 2026-07-30 §7 + the §L walk-through; PROMPT-ONLY — no new lint, no new gate).
 *
 * The house prose contract, carried by every stage that writes prose a reader sees: `synthesis`,
 * `report-overview`, `report-card`. It is GUIDANCE, deliberately not a checker —
 * spec §7 rules prose rules prompt-only because a code gate here adds redelivery cycles and removes
 * the flexibility the judgment needs. The word budgets are TARGETS the model writes to; the only HARD
 * caps are the ones code already folds (card-budget.mjs clips `overall_caption` at 3 sentences;
 * render.mjs folds the typed `net` to the card budget — its "### The read" fold is dead for fresh
 * assemblies since retired the section), and this block exists precisely because obeying a cap with
 * 60-word sentences satisfies the code and fails the reader.
 *
 * Ruling 4 (the owner, 2026-07-30) is BINDING and is the spine of the block: NO prescriptions — facts,
 * evidence, assessment, the weakest-point statement, deadlines and process facts. Every forward step a
 * human must still take is a TYPED ACTION in the findings.json actions register (spec 64), which code
 * renders; prose that repeats one as an instruction is a delivery defect. The same ruling subsumes
 * Reviewer's "never assume client facts" aside — a prescription is almost always a guess about the client.
 *
 * The two-level rule (charter Part E): stages.mjs carries a path list, and the instructions the model
 * actually follows live in the skill files that list names. Every rule below therefore has a matching
 * edit in delivery-contract.md / synthesis-rules.md / worked-examples.md — the level-2 files previously
 * taught the OPPOSITE of three of these (a "recommended action" in the caption, a surface-specific
 * hedge exception, counsel advice modelled as recommended prose). Change one level, change both.
 */
export const PROSE_VOICE = `HOUSE PROSE CONTRACT — binding on every line a reader sees (the report, its cards, the cover note):
- WORD BUDGETS (targets, not a checker): about 20-25 words a sentence, about 80 words a paragraph. Where code states a hard cap (a 3-sentence caption, a 2-sentence read), that cap is the FOLD POINT and never the target — three 60-word sentences obey the cap and defeat it. One idea a sentence; three or more parallel items become a real list, never an inline "(a)…(b)…(c)" run.
- EACH FACT ONCE, AT ITS RANK. A finding is stated in its own row. The summary names the decisive one and no other. A later section that needs an earlier finding CROSS-REFERENCES IT BY ORDINAL ("the three US class-32 rights — findings 1, 4 and 7") and stops. Telling the same mark, owner or conflict again in a second and third section is the largest single defect in the delivered product: the report's structure already holds each fact once, and your prose must use that structure instead of restating into it.
- NO PRESCRIPTIONS (RULED). Prose states the POSITION, never the remedy. NEVER "we recommend / we advise / we suggest", "you should", "the practical path is", "the realistic path is", "consider …ing", "it would be prudent to", or any imperative aimed at the reader. State what IS — the risk, the evidence, the weakest point, the deadline, the process fact — and let the typed actions register carry what a human must do.
- NO DISCLAIMERS (RULED). No caveat about the document, no "further investigation may be warranted" tail, no warning about the report's own completeness. A real limit on the answer is a FACT, stated ONCE where it belongs, in consequence terms: "Chinese-script registers were not searched, so a Chinese filing could surface later."
- ONE READER, ONE POSTURE. Every surface is written for the same reader — the reviewing lawyer — in one voice: the calibrated register of an advisory preliminary assessment ("appears to be", "cannot be excluded", "as we understand <jurisdiction> examination practice"). There is no softer second audience and no harder first one: never hedge MORE on one surface than on another, and never flatten a surface to bald assertion. The hedge is calibration, NEVER a substitute for a fact the run holds — where the run has the record, state the record.
- THE READER OWNS EVERY NOUN. One reader — and every noun on their surface is a word they already hold, from their business, their market, or the law said plainly. Where this run has no reader-facing word for a thing, DESCRIBE the thing: the description is the finished sentence, never a stand-in for the term you meant. "The full variant band enumerated to zero" and "annexed on mark distance, not cleared on goods" name machinery the reader has never met and leave a smart reader nothing to picture; "we searched every spelling of the name and found no live rights" and "the right was set aside because the marks look different, not because their goods were checked" carry the same facts in words they own. The bar is ONE PASS — a smart reader who is not a lawyer takes the meaning the first time — and this engine already clears it: "Every other right on the record turned out narrower than its class number suggested once the specification was read." JUDGE THE SENTENCE, NEVER THE WORD: a mark, an owner or a product genuinely called AXIS, SLICE or BAND is written exactly as it is named. No word is forbidden here; naming the engine's own thing on the reader's surface is.
- SAY THE LEVEL, NOT ITS NEIGHBOURS. State risk as the level it IS ("a manageable risk", "a high risk") — never as a relation to another level ("sits below that level", "does not quite reach the level above", "one step down from high").
- THIRD-PARTY RIGHTS ARE NAMED AS RIGHTS. Write "<MARK>-formative rights", "rights that contain <MARK>", "other owners of marks containing <MARK>". NEVER "<MARK>-branded" or "<MARK> branded goods": that reads as the client's own brand and mis-attributes the right to the wrong party.
- NEVER ASSERT A FACT ABOUT THE CLIENT. Write only what the run's own material establishes. "Consent or coexistence is not in hand" claims something about the client's own file that no search reached — the honest form is record-scoped: "no coexistence agreement appears on the record searched". The same holds for the client's use, portfolio, budget, timing and intentions.
- SEARCHED-AND-EMPTY IS NOT COULD-NOT-SEARCH. Say which one it is, every time, in the words the run earned: "searched — none found" for a source this run actually queried, "not searched this run" or "could not be searched — <the reason>" for one it did not reach. The two readings must never both appear about the same source in one report.
- ABSENCE OF A PRIVATE ACT PROVES NOTHING. Cease-and-desist letters, settlements, licences and consents are private — no search reaches them, so their absence is never evidence and is never implied to be one. "No enforcement history surfaced" may not be written, or positioned, as "the owner does not enforce".
- NAME THE LEGAL TEST IN PLAIN WORDS. "applying the well-accepted framework for confusion — the marks as wholes against the goods and services" reads correctly to a lawyer and to a client. Never recite a court's factor template as though it structured the analysis, and never cite a decision this run did not fetch.
- NO FILLER. Delete any phrase carrying no fact: run-shaped noise ("session-wide notice coverage", "coverage across the session"), throat-clearing ("it is worth noting that", "importantly", "as noted above"), and any sentence whose deletion loses nothing.`;

const reads = (skillReads) => `First, read and follow exactly: ${skillReads.join(", ")}.`;

// ---- followup composition (A-1) ---------------------------------------------------------------------
//
// A FOLLOWUP DISPATCH IS NOT A RESUMED SESSION, and the message the followup branch builds is therefore
// the WHOLE of what a corrective pass ever sees. `gateway.mjs` makes `warm` require `attempt > 1`, so
// attempt 1 passes `resumeRef: undefined` — and `--resume` (anthropic) / `codex resume` (openai) is the
// ONLY continuity mechanism either engine has. Neither reads `sessionKey` at all (grep: zero hits in
// driver/engine/). Every `stage(name, ctx, {followup})` call is a NEW stage() call, i.e. attempt 1.
//
// The branch used to send `opts.followup` alone, on the premise that a resumed session already held the
// rest. That premise is false, and three things went with it:
//   · the skill-file pointer. `reads()` above is MESSAGE CONTENT, not an access grant — it is the first
//     line of every stage prompt and the only thing that names the document defining what a correct
//     output IS. Losing the line means a corrective pass runs without the methodology.
//   · `opts.extra` — every driver-COMPUTED block (the deferred-axis hint, the settled-deferrals section,
//     the placement rulings tail, the owner-screen receipt). Reachable only on the fresh-message branch.
//   · any pointer to the stage's own declared inputs (stageInputs below).
// Measured on ee4ea93, two runs: a cold followup dispatch opened 4/40 and 3/43 of its declared inputs
// where a cold fresh dispatch opened 62/112 and 67/104. Five of seven followups in one run opened NONE.
//
// DELIBERATELY NOT RESTORED: `def.message(ctx)`. The full stage prompt re-commissions the whole task and
// would fight the followup's own "your unit digest stands — do NOT redo it". What a corrective pass is
// missing is its methodology and its evidence; the task order is not missing, it is contradicted.
const readsForReference = (skillReads) =>
  `METHODOLOGY (reference — this is a correction to work that already exists, NOT an instruction to redo the stage): this stage is held to ${skillReads.join(", ")}. Re-read whatever the instruction below turns on.`;

// The inputs line. Named "or state why not": every declared input either appears here or is absent from
// disk, and absence is itself the reason (an optional input — crowdContext, frameReopenReceipt — that this
// run never produced). The composer takes the list ALREADY filtered by the caller so this module stays a
// pure prompt table with no filesystem reach.
const inputsForReference = (paths) =>
  `YOUR DECLARED INPUTS, unchanged and on disk — this dispatch is a fresh session and does not carry them, so open the ones the instruction above turns on (and only those): ${paths.join(", ")}.`;

/**
 * The skill documents a stage's prompt ACTUALLY names for this run.
 *
 * `skillReads` on a def is declarative metadata and, for the three profile-aware stages, deliberately
 * names the firm-neutral DEFAULT framework (see the note above STAGES). `skillReadsFor` is the live
 * per-run resolution — the same list `message()` emits. A followup must use the live one: pointing a
 * corrective pass at the house framework when the customer's profile selects another would silently
 * swap doc-50's rating authority in exactly the passes that re-rate. Pinned by stages-followup.test.mjs.
 */
// ── — THE FILES A SKILL.md POINTS AT ARE INSTRUCTION LOAD, AND NOTHING MEASURED THEM ─────────
//
// `skillReads` names what a dispatch is told to "read and follow exactly". Several of those SKILL.md
// files then point the seat at a sibling document — a companion list, or an outright "also read X before
// writing section Y" — and the instruction-load ratchet could not see a byte of it. The finding that
// opened this: 345 B were cut from matter-frame's watchlist-reference.md and the ratchet did not move.
//
// MEASURED, over the SKILL.md files a stage actually reads: 9 companions across 4 skills, 101,077 B,
// none of it counted. `prelim-register` alone carries 77,994 B of it.
//
// ── WHY A SECOND LIST RATHER THAN MORE `skillReads` ─────────────────────────────────────────────────
//
// Putting them in `skillReads` would make the ratchet right and CHANGE THE PROMPT: `reads()` composes
// "First, read and follow exactly: …" from that array, and `composeFollowup` composes "this stage is
// held to …" from `resolveSkillReads`. Promoting 101 KB from companion to follow-exactly across four
// skills is a doctrine change to what four seats are told, and it should not ride a measurement fix.
// SKILL.md chose its own framing on purpose — matter-frame's is explicitly "enrichment, not authority".
//
// So these are declared here, measured the same way, and emitted into no prompt. `resolveAlsoReads` has
// exactly one consumer: driver/test/skill-instruction-load.mjs.
//
// DECLARED PER SKILL, NOT PER STAGE, because that is the shape of the fact. Two stages read
// prelim-register/SKILL.md and both therefore carry its companions; declaring the pair twice is how the
// two drift. A stage picks these up by reading the SKILL.md they belong to, which is also what makes the
// guard in skill-instruction-load.test.mjs able to check the list against the documents themselves.
export const SKILL_COMPANIONS = Object.freeze({
  "matter-frame": Object.freeze(["watchlist-reference.md"]),
  "prelim-common-law": Object.freeze(["perplexity-prompts.md"]),
  "prelim-register": Object.freeze([
    "register-recipes.md", "status-rules.md", "stealth-filer-indicators.md",
    "providers/corsearch.md", "providers/clarivate.md",
  ]),
  "case-law-citation": Object.freeze(["sources/courtlistener.md", "sources/legaldatahunter.md", "sources/eurlex.md"]),
});

/**
 * The companion documents a dispatch's SKILL.md points its seat at — measured, never emitted.
 *
 * A CROSS-SKILL LINK IS NOT ONE OF THESE. `prelim-variants/SKILL.md` cites a step of
 * `prelim-register/SKILL.md`, and prelim-register's own stages already measure that file: counting it
 * here too would inflate the ratchet with 28,535 B nobody dispatched twice, and a ratchet that moves for
 * reasons no stage can be traced to is worse than one that under-counts.
 */
export function resolveAlsoReads(name, ctx = {}) {
  const out = [];
  for (const p of resolveSkillReads(name, ctx)) {
    const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(p)?.[1];
    if (!skill) continue;
    for (const c of SKILL_COMPANIONS[skill] ?? []) out.push(`skills/${skill}/${c}`);
  }
  return [...new Set(out)];
}

export function resolveSkillReads(name, ctx = {}) {
  const def = STAGES[name];
  if (!def) return [];
  return (def.skillReadsFor ? def.skillReadsFor(ctx) : def.skillReads) ?? [];
}

/**
 * Compose a followup dispatch's message: methodology pointer, then the instruction, then the computed
 * blocks, then the input pointers. The instruction stays FIRST IN INTENT — the two reference lines that
 * bracket it are addressed to a session that has nothing, and neither states a task.
 */
export function composeFollowup(name, ctx, { followup, extra = null, inputs = [], cleared = [] } = {}) {
  const skills = resolveSkillReads(name, ctx);
  return lines(
    skills.length ? readsForReference(skills) : "",
    followup,
    clearedConstraint(cleared),
    extra || "",
    inputs.length ? inputsForReference(inputs) : "",
  );
}

/**
 * WHAT THIS RUN HAS ALREADY CORRECTED, stated to a session that was not there for it.
 *
 * a measured run's synthesis seat failed `finding_action_condition_on_advisory`, was corrected, went
 * clean — and then a designed followup twenty-seven minutes later reintroduced the same violation
 * EIGHT times. The corrective ladder had done its job both times; nothing carried its result forward.
 *
 * THE ARTEFACT WAS NEVER THE MISSING PIECE. The corrected `findings.json` is on disk and rides the
 * input pointers above, so this was never a regeneration from pre-correction state. What the dispatch
 * could not carry is the RULE the correction enforced — and the seat then re-authors under doctrine,
 * where the same mistake is still permitted. So the block below states the constraint, not the repair.
 *
 * IT IS NOT THE LADDER'S SENTENCE, and that distinction is the whole design. `gateway.mjs`'s corrective
 * hint is written for a seat mid-repair — "fix exactly this row, change nothing else" — and replaying
 * it into a pass with no repair to do would order work that is already finished. This is a standing
 * rule for the pass about to happen.
 *
 * AND IT IS NOT A RESUME. A designed followup is a fresh pass BY DESIGN; handing the seat its own
 * prior reasoning is the one thing the design is trying to avoid. This adds a constraint, not a memory.
 *
 * Empty in, nothing out — a first cycle has corrected nothing, and a paragraph announcing that would be
 * noise in the position the instruction occupies.
 */
export function clearedConstraint(cleared) {
  const list = [...new Set((Array.isArray(cleared) ? cleared : []).map((s) => String(s ?? "").trim()).filter(Boolean))].sort();
  if (!list.length) return "";
  const one = list.length === 1;
  return `ALREADY CORRECTED ON THIS RUN — do not reintroduce ${one ? "it" : "them"}: `
    + `${list.map((k) => `\`${k}\``).join(", ")}. `
    + `${one ? "This check" : "Each of these"} fired earlier in this run and an earlier pass fixed it; the `
    + `file you are working from ALREADY carries that fix. You are not being asked to repeat the repair — `
    + `you are being told which rule the last correction enforced, because the work you are about to do `
    + `can break it again and the file cannot tell you that.`;
}

// Phase 2 — per-customer reasoning-skill selection. The firm-wide DOCTRINE is identical across the
// per-customer frameworks (enforced byte-for-byte by test/doctrine-diff.test.mjs); the resolved profile
// only picks WHICH framework + worked-examples set the synthesis/report-synthesis stages read (falling
// back to the firm-neutral defaults when a profile names none). Keys are validated in profiles.mjs
// (KNOWN_PROFILE_KEYS + FIELD_CONSUMERS point here).
//
// NOTE on the apparent mismatch with the static `skillReads:` PROPERTY below: that property names the
// firm-neutral DEFAULT framework, while the LIVE in-context read happens via reads([... frameworkFor(profile)
// ...]) inside each message(). This is intentional — `skillReads` is declarative metadata (no runtime
// consumer; only reads([...]) actually emits the read instruction), so it cannot know the per-run profile.
// Do NOT "reconcile" the two by pointing message() at the static default: that silently breaks per-customer
// framework selection (guarded by the framework-selection test in profiles.test.mjs).
// frameworkFor / workedExamplesFor live in framework.mjs (doc 50) — the single home for the selection
// fallback, shared with the validator, publish and the profile service.
// spec-48 C4 — a pharma-shaped matter (Nice 5 anywhere in scope, or pharma-shaped goods text)
// force-reads the pharma field module in synthesis and flags it for the refutation review.
export const pharmaMatter = (job) =>
  [...(Array.isArray(job?.classes) ? job.classes : []),
    ...(Array.isArray(job?.marks) ? job.marks.flatMap((m) => (Array.isArray(m?.classes) ? m.classes : [])) : [])]
    .map(String).includes("5")
  || /pharma|medicin|drug|therapeut|veterinar|clinic/i.test(String(job?.goods ?? ""));
// ---- the LIVE skill-read resolvers for the three profile-aware stages -------------------------------
// One definition each, called from BOTH the stage's message() and (via `skillReadsFor` on the def)
// resolveSkillReads. The static `skillReads:` property stays as declarative metadata and keeps naming the
// firm-neutral default — do NOT reconcile the two by pointing message() at it (see the note above STAGES;
// that silently breaks per-customer framework selection). stages-followup.test.mjs pins message() and
// skillReadsFor emitting the SAME list, under a custom profile and under a pharma matter, so the two call
// sites cannot drift apart.
// #253 — the report prose standard. General rules ONCE, in one shared file, reached by every stage that
// writes a line a reader sees and by no other. There was no such file before: the three prose stages
// overlap only on the per-customer framework, so the general rules had to be duplicated (they were, in
// synthesis-rules.md and delivery-contract.md) or reach only some stages. A standard that reaches some
// stages is worse than none — the rules then apply unevenly and nothing says which. So it is named
// EXPLICITLY in all three resolvers rather than left to a relative link the agent may or may not follow.
// The reach is pinned by report-prose-standard.test.mjs, because nothing FAILS if these rules never
// arrive: the stage simply writes to model defaults and every other test still passes.
const REPORT_PROSE = "skills/prelim-search/report-prose.md";
// THE SPINE RIDES WITH synthesis-rules.md EVERYWHERE IT IS READ (tracker issue 1926). 412 lines MOVED
// out of that file into `firm-wide-reasoning.md` so the knockout lane can read the same copy instead of
// carrying its own retired transcription. A move, not a copy — which means every stage that read
// synthesis-rules.md for that material must now read both, or it silently LOSES doctrine it has had all
// along. That is the one way this extraction could do harm, so the two lists are edited together and
// the pairing is stated rather than left to be noticed.
const SPINE_DOC = "skills/prelim-search/firm-wide-reasoning.md";
const synthesisSkillReads = ({ profile, job }) => [
  "skills/prelim-search/synthesis-rules.md", SPINE_DOC, frameworkFor(profile), workedExamplesFor(profile),
  ...(pharmaMatter(job) ? ["skills/prelim-search/field-doctrine-pharma.md"] : []),
  REPORT_PROSE,
];
const reportOverviewSkillReads = ({ profile }) =>
  ["skills/prelim-search/synthesis-rules.md", SPINE_DOC, frameworkFor(profile), "skills/prelim-search/delivery-contract.md", REPORT_PROSE];
const reportCardSkillReads = ({ profile }) =>
  ["skills/prelim-search/delivery-contract.md", frameworkFor(profile), REPORT_PROSE];

// spec-48 C1 — the territories whose legal system scopes the marketplace-risk directive, and whose
// registration scripts set the script floor. THE SHARED LADDER (effective-scope.mjs resolveTerritories),
// the same one the doors, the freeze and the register plan read.
//
// It used to be a hand copy of "instructed, else the profile defaults" that had never heard of the
// geography stamp, so a worldwide search framed its marketplace directive and its script floor on the
// account's default territories — a directive naming seven countries inside a search sold as everywhere.
// An empty list is the worldwide answer here too: marketplaceScopeDirective and requiredScriptsFor both
// treat it as "no territorial framing", which is what a worldwide search is.
const scopeTerritories = (job, profile) => resolveTerritories(job, profile).jurisdictions;
/**
 * THE CLOSING LINE OF EVERY SEAT DISPATCH — and, where the driver wrote a FORM, the line that says which
 * file is actually checked.
 *
 * THE DEFECT THIS FIXES IS EMPHASIS, NOT OMISSION. This function said "Write your output to" and named
 * the prose .md — singular, definite, in the last and most emphatic position in the prompt. For the
 * three seats that are handed a driver-written form, the gated deliverable is the FORM: every
 * `connotation_*` token reads the disposition form, the coverage gate reads the coverage form, the
 * placement validators read the placement form. The form was described in the middle of the prompt and
 * contradicted by the closing line. A seat that treats the closing instruction as the definition of the
 * task writes the .md and returns — which is exactly `form_untouched`. On one
 * measured run the meaning seat came back with 0 of 73 rows ruled.
 *
 * So the form is not merely mentioned. It is item 1, it carries the only capitalised sentence, and it
 * gets the last word — because the last word is what the previous version got wrong.
 *
 * A SEAT WITH NO FORM IS BYTE-IDENTICAL to the old text, and a test proves that over every stage rather
 * than by eye. That is the whole safety argument for touching the closing line of 21 dispatches.
 *
 * `checked` takes the DRIVER-WRITTEN FORMS only — files the driver has already created and the seat
 * fills in. It deliberately does NOT take every mandatory artifact: `common-law` also owes
 * common-law-grid.json, which is the seat SAVING a tool's output rather than filling a form the driver
 * wrote, and rolling those together would blur the one distinction this line exists to draw.
 *
 * @param {string} out                  the prose/primary output path
 * @param {string[]|string|null} checked driver-written forms the validator reads
 */
export const writeReturn = (out, checked = []) => {
  const forms = (Array.isArray(checked) ? checked : [checked]).filter(Boolean);
  if (!forms.length) {
    return `Write your output to this ABSOLUTE path (create parent dirs if needed): ${out}\n`
      + `Then return ONLY: the absolute output path + a 2-3 line summary. Do NOT spawn any sub-agents.`;
  }
  const one = forms.length === 1;
  return [
    `YOU OWE ${forms.length + 1} FILES, AND THE ${one ? "FORM IS" : "FORMS ARE"} WHAT GETS CHECKED.`,
    ...forms.map((f, i) => `  ${i + 1}. ${f}`
      + `\n     The driver has ALREADY WRITTEN this form. Fill it in. This is the file the validator reads.`),
    // THE PROSE PATH KEEPS THE LITERAL "ABSOLUTE path …:" PHRASING, and not for style. This closing line
    // is itself a dictated shape with a consumer: the harness mock locates a stage's output by matching
    // /ABSOLUTE path[^:]*:\s*(\/\S+)/ against the dispatch (mock-stage-fixtures.mjs applyStageWrites).
    // Dropping the phrase left it unable to find the output at all, so it wrote nothing — and 191 tests
    // read that as `form_untouched` on seats that had never been asked for anything. It must also remain
    // the FIRST occurrence in this string, or the mock writes the prose into the form.
    `  ${forms.length + 1}. Your write-up — write it to this ABSOLUTE path (create parent dirs if needed): ${out}`,
    ``,
    `The write-up does not stand in for the ${one ? "form" : "forms"}. A dispatch whose ${one ? "form is" : "forms are"} `
      + `unfilled fails on the ${one ? "form" : "forms"}, however complete the write-up is.`,
    `Then return ONLY: the absolute paths + a 2-3 line summary. Do NOT spawn any sub-agents.`,
    `Fill the ${one ? "form" : "forms"} FIRST. If you write only one file, write the ${one ? "form" : "forms"}.`,
  ].join("\n");
};

// Doubt hand-off (2026-07-22 — the copper-gantry defect): a gather layer that identifies a check it
// CANNOT perform itself used to bury that need in free prose ("requires prelim-register layer
// cross-check…") that nothing downstream parses — the question died unasked and the contradiction it
// would have resolved shipped unresolved. This one dictated line is the fix: the driver parses EXACTLY
// this shape (doubt-ledger.mjs mintCrossCheckDoubts), mints it as a doubt, stitches it to whatever
// answer the run later produces, and ships it visibly OPEN in the audit's Doubt Ledger if none arrives.
// Additive to every gather message — it changes what gets RECORDED, never what gets searched.
const CROSS_CHECK_HANDOFF = `CROSS-CHECK HAND-OFF: when your findings identify a check you could NOT perform in this layer that another layer must (a register cross-check on a marketplace hit, a US/Madrid designation check), record it on its OWN line in EXACTLY the form "CROSS-CHECK REQUIRED: <what> — <why>" (that exact prefix; an em-dash between what and why; name the mark in CAPS in <what>). The driver parses ONLY this exact line shape to carry the question to an answer and record its ending in the delivered audit — a cross-check need stated only in prose is a question that dies unasked.`;

// item 21 — the per-script floor, stated to the stage that can actually satisfy it.
//
// The gate (verify.mjs → variantCompletenessGaps) REFUSES a manifest with no rendering for an in-scope
// script. It cannot supply one: a search term minted by code is a search whose provenance no one can
// defend, and the moment code mints one, judgment has moved into the funnel. So the requirement is
// stated here, in the prompt that authors the family, and the gate is the backstop.
//
// ONE RENDERING PER SCRIPT, NOT A COUNT, and only scripts a mark could plausibly be REGISTERED in —
// Japan is Latin plus katakana, not its four writing systems. See registration-scripts.mjs, which is
// the reference table a person maintains.
const scriptFloorDirective = (job, profile) => {
  const req = requiredScriptsFor(scopeTerritories(job, profile));
  const scripts = Object.entries(req);
  if (!scripts.length) return "";
  return `SCRIPT COVERAGE (MANDATORY, and the validator refuses a manifest without it): this matter is scoped to territories that register marks in ${scripts.length > 1 ? "scripts" : "a script"} other than Latin — ${scripts.map(([s, t]) => `${s} (${t.join(", ")})`).join("; ")}. State AT LEAST ONE rendering of the mark in each, as a "transliteration" variant carrying its "romanization" field. A conflicting right in one of these territories is commonly registered in the local script under characters a Latin-only family never asks for, so the search would come back clean because it never looked. ONE rendering per script is the floor — how many the mark deserves, and which of them bite, is your judgment and this floor never touches it. If the mark genuinely has no defensible rendering in one of these scripts, say so in the manifest prose rather than inventing one: a fabricated transliteration is a search we cannot stand behind.`;
};

// ── #445 — THE SIX CATEGORY NAMES WERE GIVEN AND NONE OF THEM WAS DEFINED ───────────────────────────
//
// An evidence run scored 7 of 9 found, 2 lost, **withheld 0**. Nothing was
// retrieved and dropped — DELPHI SCIENTIFIC and DELFITY were never searched for. The variant dispatch
// named a closed enum of seven categories and defined not one of them, so the model inferred what six
// words meant from the words themselves and generated against its own inference:
//
//   DELPHI SCIENTIFIC  stem + descriptor. Nothing said a composite is drawn from words that could
//                      plausibly follow the distinctive element ON THE GOODS IN SCOPE, so the model
//                      produced seven descriptors and every one came from the applicant's own biotech
//                      sector — the one place a conflicting mark is least likely to be hiding.
//   DELFITY            a fuzzy neighbour. Nothing said how far `phonetic` reaches, or that a shortened
//                      or elided middle is inside it.
//
// One absence, seen twice. The ruling (design agent, 2026-08-06) is explicit that the fix is a BETTER
// BRIEF, not a smarter filter: no decomposition pass, no prefix/stem-expansion rule, no mark enumeration.
// Every one of those passes this matter and teaches the funnel nothing, and the next compound mark
// breaks differently and earns another rule.
//
// So: each category says what it is DRAWN FROM, and carries one worked example. Every example is a
// coined mark chosen to be nothing like the matter that exposed this — an example from BIOVELTRIN would
// be writing to the answer sheet, which the ruling names as a fail condition.
//
// This is a CATEGORY BRIEF, never a term list. Code must never mint a search term (scriptFloorDirective
// above states the same rule for the script floor and for the same reason): the moment code supplies a
// term, judgment has moved into the funnel. It supplies the definition; the model supplies the family.
export const VARIANT_CATEGORY_BRIEF =
  `WHAT THE ELEVEN CATEGORIES MEAN. These are not labels to sort a family you have already thought of — each ` +
  `one names a DIFFERENT PLACE TO LOOK, and a category you read narrowly is a search nobody runs. Generate ` +
  `against the definition, not against the word:\n` +
  `- "core": the mark itself and the forms that are still the SAME mark — the whole string, the distinctive ` +
  `element standing alone, and the spacing, hyphenation and casing forms of both. Drawn from the mark as ` +
  `filed; nothing is added to it. (ICEHOUSE → "ICE HOUSE", "ICE-HOUSE".)\n` +
  `- "phonetic": what the mark sounds like when a customer HEARS it and writes it down, drawn from the sound ` +
  `and never from the spelling. Hold the consonant skeleton, let the vowels go anywhere. A DROPPED, DOUBLED ` +
  `OR ELIDED MIDDLE SYLLABLE IS INSIDE THIS CATEGORY, and so is a shortened form and a different ending that ` +
  `still says the same word — those are the neighbours that get missed when "phonetic" is read as "spelled ` +
  `slightly differently". (KUZAMI → "COOSAMMY", "KUSAMI", "KZAMI", "KUZAM", "KUZAMY".)\n` +
  `- "visual": what the mark LOOKS like at a glance in a register list or on a shelf, drawn from letter ` +
  `shapes. Confusable-glyph substitutions (rn/m, l/1/I, 0/O, vv/w), doubled letters, and adjacent letters ` +
  `transposed. (CLARIVO → "CIARIVO", "CLARlVO", "CLARIV0".)\n` +
  `- "transliteration": the mark as it would be WRITTEN in each script the in-scope territories actually ` +
  `register marks in, each with its romanization. Drawn from the territory list — never from taste, and ` +
  `never only the scripts you find interesting. (NORVELL scoped to JP/KR → "ノーヴェル" romanized ` +
  `"NO VE RU", "노르벨" romanized "NO REU BEL".)\n` +
  `- "numeric": digit-for-letter and letter-for-digit forms, and numbers spelled out or figured. Drawn from ` +
  `the mark's own characters. (FORTE8 → "FORTE EIGHT", "F0RTE8", "4TE8".)\n` +
  `- "composite": the distinctive element paired with a word that could plausibly FOLLOW IT ON THE GOODS AND ` +
  `SERVICES IN SCOPE — not with the words your client's own sector uses. Drawn from the trade vocabulary of ` +
  `the CLASS, never from the applicant's own product vocabulary: the conflict you are looking for was filed ` +
  `by someone else, in this class, who had no idea your client exists, so brief yourself as though you were ` +
  `them. Reach for the generic words a stranger would append — the sector house-style, the field, the trade ` +
  `descriptor, the corporate suffix. ` +
  `(VELTRA in class 5 → "VELTRA PHARMA", "VELTRA LABS", "VELTRA THERAPEUTICS", "VELTRA HEALTH", not the ` +
  `applicant's own product names.)\n` +
  `- "exact-phrase": the full mark exactly as filed, one row, tagged so the register sweeps it as a whole ` +
  `phrase (match_mode exact). Drawn from the mark as filed and nothing else — distinct from "core" in that ` +
  `it asserts the DISPATCH mode, not a spelling family. (ICEHOUSE → "ICEHOUSE", swept as the phrase.)\n` +
  `- "exact-element": each element of the mark standing solo, swept broad (match_mode default/contains) so ` +
  `filings that carry the element inside a longer mark are reached. Drawn from the mark's own elements, one ` +
  `row per element. (VELTRIWORKS → "VELTRI", "WORKS".)\n` +
  `- "plural-root": the shortest morphological root of each plural or inflected element, written AS THE ` +
  `ROOT — its whole purpose is the contains sweep that reaches the inflected family. Drawn from the ` +
  `element's morphology, never from taste. (DIAGNOSTICS → "DIAGNOST".)\n` +
  `- "formative-family": the distinctive root as a FAMILY of marks — the root that other filings build on. ` +
  `Written as the root, dispatched contains/default, never exact-only: a family root swept exact matches ` +
  `the root alone and nothing that incorporates it, which is the inverse of what it is for. Drawn from the ` +
  `distinctive element's formative root; see the Formative-family rules. (VELTRI → reaching "VELTRI LABS", ` +
  `"VELTRI GENETICS", "NEOVELTRI".)\n` +
  `- "other": a member the family genuinely needs that none of the ten describes — and it carries no worked ` +
  `example on purpose, because an example would narrow the one category whose job is to stay open. Name in ` +
  `the rationale what it is drawn from. Never a parking spot for a term you could have placed elsewhere.\n` +
  `COVER EVERY CATEGORY THE MARK CAN HAVE. A category that yields nothing for this mark is a judgment you ` +
  `state in the prose, not a category you skip in silence — and a category read narrowly costs a search that ` +
  `is never run, which no downstream judgment can recover.`;

// ---- the stage table ----
// Each: {model, thinking, timeoutSec, skillReads, out(paths)->absPath, validate, message(ctx)->string}.
// ctx = { paths, job, run, axis?, flags? }.
// ── E1 — THE STAGE-CONTRACT DECLARATION ────────────────────────────────────────────────────────
//
// Every stage declares, beside its `message`, each element it asks a model for and the CLASS of that
// element, from a closed enum:
//
//   judgment                     the model's own call — it stays with the model
//   mechanical:pre-bound         the driver writes the value into the form before dispatch
//   mechanical:code-extracted    code lifts it out of material already on disk
//   mechanical:tool-written      a tool writes the artifact; the model only calls it
//   mechanical:code-assigned     code assigns it (ordinals, ids, derived tokens)
//   mechanical:code-rendered     code renders the shape from typed fields the model returned
//
// THERE IS NO BARE `mechanical`. A mechanical element must name what discharges it — "mechanical" on
// its own is a label a defect can wear, which is the failure exists to end.
//
// THE CLASS IS THE DOCTRINAL CLASS — what discharges the element under 's plan — NOT a claim that
// the move has landed. `receipt_id` reads mechanical:pre-bound while a model still types it; M1 is what
// makes that true. stays open for the moves.
//
// `why` is the REASON THE CLASS IS WHAT IT IS, beside the row. It is not decoration: several classes
// here are correct only GIVEN A RULING THAT LIVES SOMEWHERE ELSE (the rulings S1-S4 of
// 2026-08-13), and this declaration will outlive those rulings. A future reader hunting relabels will
// re-open every such row unless the ruling is named and dated where the row is. An undated `judgment`
// on an element a move was supposed to discharge is indistinguishable from a relabel.
//
// `tokens` lists the validator failure tokens that SPEAK ABOUT that element. PER STAGE, never global:
// `too_short` and `missing` come from the shared nonEmpty()/needs() helpers (verify.mjs:123-133) and are
// legitimately owned by DIFFERENT elements in matter-frame, prelim-variants and frame-diff. A global
// token→element map sees several owners for one token and "fixes" a partition that was never violated.
//
// An EMPTY `tokens` array is a finding, not an omission: it says no validator polices that element. 139
// of 286 elements are in that state, and contract-arm2-baseline.json ratchets the number down. The
// mechanical-AND-unspoken subset is the highest-value target for the moves: nothing polices it and it
// is not the model's judgment either.
//
// Enforced by driver/test/contract-audit.test.mjs. Adding a key here changes no runtime behaviour:
// only `def.contract` reaches _driver/stage-contracts.json, written by
// recordStageContract() in pipeline.mjs, and nothing spreads a stage def.
export const STAGES = {
  "matter-frame": {
    model: "opus", thinking: "high", timeoutSec: 300, stallSec: 300,
    skillReads: ["skills/matter-frame/SKILL.md"],
    out: (P) => P.matterContext,
    validate: validators.matterContext,
    // The output contract THIS prompt holds the frame to — the dictated "Meaning angles:" line below.
    // Recorded by the driver at DISPATCH (pipeline.mjs recordStageContract → _driver/stage-contracts.json)
    // and the ONLY thing validators.matterContext gates the line requirement on — the romanisation-floor
    // pattern (prelim-variants below). It is evidence of PROMPT VINTAGE, never of run freshness: a
    // completed legacy frame is re-validated (crash/parked-resume skip, replay-archive) without the
    // marker and keeps passing under the rules it was minted under. The instructed-scope sentinel proved
    // the wrong thing here exactly as it did for the romanisation floor (present on every current-era
    // run, archived and parked included) — the first cut keyed on it and flipped real archived replay
    // verdicts AND forced completed matter-frames to re-dispatch on resume, dragging the full downstream
    // staleness cascade (2026-07-31 review round).
    contract: { meaningAngles: 1 },
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "## Instructed scope — STAMPED by the driver from _driver/instructed-scope.json": {
        class: "mechanical:code-rendered", tokens: ["frame_scope_missing"],
        why: "STAMPED (conversion 2). The ruling arrived: the driver held marks/classes/jurisdictions/goods the whole time (written at intake before any model ran) and the seat was asked to quote them back so a validator could string-compare the retyping against the same file. renderInstructedScope now emits the section and the tool's schema has no field for it, so the retyping — and the paraphrase drift it could suffer — cannot happen. The token is RE-POINTED rather than retired: on a recorded frame it names the driver failing to stamp a scope it holds, which is the one way this section can still be wrong",
      },
      "search_channels — the domains where real use of THIS matter's goods would show": {
        class: "judgment", tokens: [],
        why: "the vertical read — which channels real use of THIS matter's goods would show on; no artifact holds it. Consumed by channelsFromMatterContext() in scope-ledger.mjs for the generic-fallback common-law grid",
      },
      "meaning_angles — the per-matter semantic-field queries, or an asserted none": {
        class: "judgment", tokens: ["meaning_angles_missing"],
        why: "the semantic-field read; the driver's fixed shapes are the floor and these are the per-matter angles no fixed list can ask",
      },
      "### Intake asks rows — {ask, owner} content": {
        class: "judgment", tokens: [],
        why: "which requester instruction is an EXPLICIT check, and which layer executes it, is a reading of intent no artifact holds",
      },
      "### Intake asks line shape — rendered by the driver from intake_asks[]": {
        class: "mechanical:code-rendered", tokens: [],
        why: "LANDED (conversion 2). This element already said what the fix would be — 'the model returns {ask, owner} rows into a driver-written form and code renders the section' — and it is now what happens. The seat sends typed rows; renderMatterFrame emits the section that parseIntakeAsks reads back. An empty array renders `- none stated`, so the asserted-zero keeps its dictated words without the seat having to type them",
      },
      "Prose body — client, sector, product description, customer base, channels of trade, off-field sectors, sector-convergence flags, watchlist-owner seeds": {
        class: "judgment", tokens: ["too_short", "missing"],
        why: "the commercial read of the matter; both tokens are artifact-level floors (a 200-char minimum and one regex /jurisdic|material|sector|client/i), not per-field gates",
      },
      "scope_jurisdictions / excluded_jurisdictions / scope_basis — typed fields the driver renders": {
        class: "mechanical:code-rendered", tokens: ["frame_scope_missing"],
        why: "CLASS ALIGNED WITH `## Instructed scope` in this same stage — #850 rules that row \"Code stamps the section from _driver/instructed-scope.json\", and the instructed jurisdictions are in that same file. Not pre-bound: no form carries them. On the instructed branch the driver already holds the list and hands it over; the model retypes it into a shape the driver dictates. verify.mjs:1113 string-compares it back — `add(\"jurisdictions\", scope.jurisdictions)` — failing frame_scope_missing:jurisdictions, so this half IS policed, unlike the campaign-shape twin above. [citation unverified]",
      },
      "Scope reasoning — search-wide/cite-narrow, the in-scope-by-reach routes, and the reopen trigger behind each exclusion": {
        class: "judgment", tokens: [],
        why: "Which territories a mark's actual reach pulls in, and what would reopen an exclusion, is the judgment the instructed list cannot supply. Only the retyping of the instructed values is mechanical.",
      },
      "Class scope & adjacency — classes scoped IN with a one-line reason each, classes deliberately scoped OUT": {
        class: "judgment", tokens: [],
        why: "the same-or-economically-linked-undertaking test is a recall lever the driver cannot compute",
      },
      "Applicant's own & affiliated marks — the self-exclusion set (mandatory)": {
        class: "judgment", tokens: [],
        why: "naming affiliates beyond the seed is judgment; the profile half is already pre-bound — stages.mjs:844 hands the model exclusionSeed verbatim and _driver/instructed-scope.json carries job.customer [citation unverified]",
      },
      "Campaign shape (stated) — the intake's campaign facts retyped from the `Stated campaign shape` line the dispatch already carries": {
        class: "mechanical:code-rendered", tokens: [],
        why: "CLASS ALIGNED WITH `## Instructed scope` in this same stage — same mechanism, same job object, same retyping of a driver-held value, so the same discharge: code stamps the line rather than the model retyping it. Not pre-bound: pre-bound means the driver writes the value into a FORM before dispatch, and nothing here does that. The driver holds job.campaignShape and puts it in the dispatch; the model retypes it into the frame. The dispatch itself calls it \"facts, not judgment\". Same shape as `## Instructed scope` eight elements above, which is already mechanical. NOTE FOR E7: this is derivable-and-not-derived, and it is NOT covered by frame_scope_missing — instructed-scope.json carries marks/classes/jurisdictions/goods/customer (pipeline.mjs:6178) and no campaign field, so nothing joins the frame's copy back to the intake value. [citation unverified]",
      },
      "Campaign shape (inferred) — the inference where intake stated none, and the decision to label the line `(inferred — not stated in the request)`": {
        class: "judgment", tokens: [],
        why: "Reading a campaign shape off the request when none is stated is a judgment, and so is deciding the read is an inference rather than a fact — that label is what stops a downstream stage treating it as intake truth.",
      },
      "Structured envelope — the typed fields record_matter_frame accepts, their enums, and the acceptance floors": {
        class: "mechanical:tool-written", tokens: ["matterframe_"],
        why: "LANDED (conversion 2). A structured-return tool types the envelope and the model supplies values only, so the shape defects the dictation could only catch AFTER the file was written are refused in the turn where restating is free. Several are now unrepresentable rather than merely caught: `scope_basis` and the ask `owner` are schema enums, and the instructed scope has no field at all. The two that remain reachable are the ones a schema cannot express — a prose body under the 200-char floor, and the meaning-angles pair (neither sent, or both) which is a CONTRADICTION the dictated single line had no way to state",
      },
      "Return shape — hand the frame back through record_matter_frame, write NO file, return ONLY a 2-3 line summary": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (conversion 2). It read `mechanical:pre-bound` — 'the driver named the path in the dispatch' — which was true and is now beside the point: there is no path in the dispatch. The seat sends VALUES and the driver renders matter-context.md, so nothing is pre-bound because nothing is handed over to be filled in",
      },
    },
    message: ({ paths: P, job, customerUnknown, profile, exclusionSeed }) => lines(
      reads(["skills/matter-frame/SKILL.md"]),
      `Build the strategic matter frame for this trademark preliminary-search request.`,
      `Request: ${JSON.stringify(job.marks ?? job.markName ?? job.name)}; classes ${JSON.stringify(job.classes ?? "")}.`,
      job.goods ? `Goods/services (verbatim): ${job.goods}` : "",
      // Round 2 Change 1a — the instructed territories are the AUTHORITATIVE scope; matter-frame derives scope
      // from them (+ rights effective in them), never widening on "the sector is global". See SKILL "Scope jurisdictions".
      job.jurisdictions ? `Instructed territories (AUTHORITATIVE scope — do NOT widen to "major markets"): ${Array.isArray(job.jurisdictions) ? job.jurisdictions.join(", ") : job.jurisdictions}` : "",
      job.customer ? `Customer/applicant (from the intake brief — drives the self-exclusion set): ${job.customer}` : "",
      // WS-B profile defaults — falsy-omitted, so an empty profile renders this message byte-identical
      // to the pre-profile shape (the aurora/generic regression anchor).
      // Industry is CONTEXT not a rule (Design Law #1): it sharpens which sectors/adjacencies matter for
      // the vertical (e.g. food/ingestible adjacency for a beverage brand), it never dictates a conclusion.
      profile?.industry ? `Customer industry (context for sector framing — let it sharpen the relevant sectors and adjacencies for this vertical; it is context, never a rule that decides a finding): ${profile.industry}.` : "",
      exclusionSeed?.length ? `Affiliate/self-exclusion seed (customer profile — the applicant matches this customer): ${exclusionSeed.join(", ")}.` : "",
      // "the request names none" must mirror the intake's classes-anywhere predicate (enqueue-schema:
      // top-level classes OR any marks[].classes) — defaults never override explicitly requested classes.
      profile?.defaultClasses?.length
        && !(Array.isArray(job.classes) && job.classes.length)
        && !(Array.isArray(job.marks) && job.marks.some((m) => Array.isArray(m?.classes) && m.classes.length))
        ? `Customer-default classes (the request names none — apply these): ${profile.defaultClasses.join(", ")}.` : "",
      ...defaultJurisdictionsLine(job, profile),   // — fills an ABSENT scope, never widens a stated one; vocabulary-checked (helper above STAGES)
      job.priorUse ? `Stated prior/intended use: ${job.priorUse}` : "",
      // P2-C (Round-2 §8a) — campaign-shape FACTS ride the job like priorUse (verbatim sidecar prose, never
      // structured). Stated ⇒ the frame carries them as fact; absent ⇒ the frame may only INFER a campaign
      // shape with an explicit inference label (see the skill's Product description rules). Context, never
      // a rule that decides a finding.
      job.campaignShape ? `Stated campaign shape (verbatim from intake — how the mark will be deployed: house-brand attachment, duration, scale; facts, not judgment): ${job.campaignShape}` : "",
      job.deadline ? `Requester deadline: ${job.deadline}` : "",
      job.upfrontInstructions ? `Requester instructions (verbatim): ${job.upfrontInstructions}` : "",
      // A5 traceability: the untouched request text is an artifact in the run dir — the source of truth for
      // any claim about what was asked. Read it when the structured fields above are ambiguous.
      job.rawRequest ? `The VERBATIM inbound request is archived at ${P.inboundRequest} — every claim about the request must trace to it; read it if anything above is ambiguous.` : "",
      `Name client + sector + customer base + materially-matters jurisdictions + off-field sectors + watchlist-owner seeds.`,
      // WS2 (B4) — the verbatim-scope bind: the driver wrote the job fields to
      // _driver/instructed-scope.json BEFORE this stage ran; the frame must QUOTE them, and the
      // validator string-compares the frame against that file (paraphrase drift between the request
      // and the frame is a defect, not a style choice — scope flows downstream from here).
      // #5 — channel derivation (replaces the static class→channel table). The generic-fallback common-law grid
      // reads THIS to pick its channels, so a regulated/B2B matter isn't forced onto consumer storefronts.
      `Send \`search_channels\` — an array of DOMAINS naming the search channels where real use of a mark in THIS matter's industry/goods would show, reasoned from the vertical (NOT a fixed list): consumer-retail goods → marketplaces (amazon.com, apps.apple.com, play.google.com); pharma/veterinary/medical (cl. 5/10/44 regulated) → drug/health registers (ema.europa.eu, fda.gov, animaldrugsatfda.fda.gov); B2B/developer products → the real trade/developer channels. Domains only (the grid site-restricts to them); the general web is always added by the driver.`,
      // P2-C (Round-2 §8b) — the DERIVED half of the meaning sweep's scope. The driver's fixed shapes
      // ("<mark> offensive", "<mark> urban dictionary") stay as the floor; THIS line supplies the per-matter
      // angles no fixed list can ask. The driver appends these queries VERBATIM to the dictated meaning sweep
      // (each is executed and receipted — the per-query identity gate polices them like the floor's), so
      // every query must be a real, runnable web search. REQUIRED on every frame this prompt mints (the
      // stage-contract marker above arms the validator; legacy/archived frames stay under their own rules)
      // — never a hardcoded sensitivities checklist, always reasoned from THIS mark.
      `Send \`meaning_angles\` — an array of the per-matter meaning/connotation angles a reputational reader would probe, derived from the mark's OWN semantic field and this matter's market/industry (NOT a fixed sensitivities list): the cultural origin and communities the word evokes (appropriation/criticism debates), charged historical or political associations of the term or its imagery, and category-specific controversy for these goods. 3-8 short queries, each anchored on the mark's element(s) (e.g. a Polynesian-derived element → "<element> cultural appropriation"; "<element> bar criticism"). Send \`meaning_angles_none: true\` INSTEAD, with an empty array, only when the mark is a coined term with no real-word semantic field to probe — that is an asserted zero and the driver records it as one. Sending neither is not an answer, and sending both is refused.`,
      // A6 — the intake-ask register: every EXPLICIT customer instruction becomes a machine
      // row the driver freezes (_driver/intake-asks.json) and every later surface must answer as a
      // LABELLED response. An ask can never evaporate between intake and output (the VENZY
      // descriptiveness check vanished exactly here).
      `Send \`intake_asks\` — one row per EXPLICIT check/instruction the requester asked for, each \`{ask, owner}\` with the ask quoted VERBATIM from the request and owner = the layer that will execute it (meaning/connotation/use checks → common-law; register/filing checks → register; assessments like descriptiveness/registrability → synthesis). Send an EMPTY array when the request contains no explicit asks beyond the clearance itself — the driver renders "none stated" for you, and an empty array IS that answer.`,
      // ── CONVERSION 2 — THE WRITE DICTATION IS GONE ────────────────────────────────────────
      //
      // This dispatch used to end `writeReturn(P.matterContext)` and dictate four line SHAPES the seat had
      // to hit: the `## Instructed scope` quote block, `Search channels:`, `Meaning angles:` and the
      // `### Intake asks` rows. All four were re-parsed by the driver (contract-e3-backlog.mjs names each
      // one with its parser). They are typed fields now and the driver renders every line, so a shape the
      // model mistypes is a shape the model no longer types.
      //
      // Deleted rather than left beside the tool: a superseded path left executable is what the golden rule
      // bans, and e2e has twice measured a seat obeying the prose while holding the tool.
      //
      // EACH FIELD CARRIES ITS OWN IMPERATIVE IN ITS OWN SENTENCE (: a field phrased outside one was
      // written 0 of 9 times against 74 of 74 when imperative-carried).
      `Hand the frame back by calling the \`record_matter_frame\` tool. Send \`prose_body\` — the commercial read of the matter in full prose: client, sector, product description, customer base, channels of trade, off-field sectors, sector-convergence flags, watchlist-owner seeds, your scope reasoning, the class scope and adjacency call with a one-line reason per class, the applicant's own and affiliated marks, and the campaign shape where you are inferring one (label an inference as an inference).`,
      `Send \`scope_basis\` as "instructed" or "derived", with \`scope_jurisdictions\` and \`excluded_jurisdictions\` as arrays of territories.`,
      // The driver STAMPS the instructed-scope section from _driver/instructed-scope.json, so the seat is
      // not asked to quote back values the driver wrote at intake. That retyping was the stage's
      // `frame_scope_missing` loop and it is gone; see matter-frame-record.mjs.
      `You are NOT asked to quote the request's marks, classes, territories or goods back — the driver stamps that section from its own intake record, so it cannot drift from what was asked.`,
      `Do NOT write or edit any file. There is no path for you to write to: the driver renders the frame from what you send, and nothing you hand-write is read.`,
      `When the tool accepts your call, return ONLY a 2-3 line summary of the frame.`,
      // The Class 2 sanctioned equivalent. O3c measured this stage's ambient Bash as `ls`/`find`/`cat`
      // DISCOVERY over the run dir (21 calls / 15 attempts), which is why it gets a search tool where
      // frame-diff — whose reads were an enumerable pair — got only the seeded `Read`. Named here because
      // a granted tool no instruction mentions is a capability the seat does not know it has, and it then
      // reaches for the one the doctrine does name ( direction (a)).
      `To look inside this run's own files, call \`search_run_artifacts\` — a read-only literal search over the run directory. Use it instead of shell commands; there is no Bash on this stage.`,
    ),
  },

  "prelim-variants": {
    model: "opus", thinking: "high", timeoutSec: 600, stallSec: 450,
    skillReads: ["skills/prelim-variants/SKILL.md", "skills/prelim-variants/transliteration-scripts.md"],
    out: (P) => P.variantManifest,
    validate: validators.variantManifest,
    // The output contract THIS prompt holds the artifact to — recorded by the driver at DISPATCH
    // (pipeline.mjs recordStageContract → _driver/stage-contracts.json), and the ONLY thing
    // validators.variantManifest gates the romanisation floor on. It is evidence of PROMPT VINTAGE,
    // never of run freshness: a completed legacy output is re-validated (crash-resume skip, replay)
    // without the marker and keeps passing under the rules it was minted under, while any output this
    // code actually dispatches for — fresh, forced, or corrective — is held to the floor the message
    // below states. The instructed-scope sentinel proved the wrong thing here (present on every
    // current-era run, archived and parked included) and flipped real replay verdicts — 2026-07-30
    // review round.
    // `completeness` (A7, 2026-07-31) arms verify.mjs's variantCompletenessGaps floor the same way —
    // its own key, so an archived output minted under the romanisation prompt alone keeps its verdict.
    // `term_shape` (, 2026-08-08) arms variantTermShapeGaps: a manifest value carrying markdown
    // emphasis or a `, etc.` enumeration compiles to a nil search that reads as CLEAN, and the plan-side
    // screen stops the search without ever telling this stage. Its own key for the same reason as above.
    contract: { romanization: 1, completeness: 1, term_shape: 1 },
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "The prose manifest's Request / Elements / Variants tables and Watchlists section — the same terms already in variant-manifest.json": {
        class: "mechanical:code-rendered", tokens: ["too_short", "missing"],
        why: "variant-manifest.json holds mark, dominant_element, elements[], variants[], incumbent_classes[], watchlist_owners[]; the prose tables restate exactly those. Both tokens police the PROSE copy (needs /variant/i + /\\|/ = a markdown table exists)",
      },
      "mark — \"<the mark verbatim>\"": {
        class: "mechanical:pre-bound", tokens: ["variantmodel_mark_missing"],
        why: "_driver/instructed-scope.json.marks holds it and stage-context.mjs:175 binds that file to this stage. variant-manifest-model.mjs:225-231 already concedes the field is not the model's: it is excluded from the term-shape gate because \"the stage is told to emit it VERBATIM, and it arrives from the job… a value this stage CANNOT restate\" [citation unverified]",
      },
      "dominant_element — the distinctive anchor the sweep enumerates": {
        class: "judgment", tokens: ["variantmodel_dominant_element_missing"],
        why: "stripping the descriptive elements to name the anchor is the ONE input the whole mechanical form-neighbourhood seeds from; no artifact holds it. Also walked by variantTermShapeGaps, whose token is owned by variants[].value",
      },
      "Formative root: <root> — the shortest distinctive stem a family of marks would share, on its own line": {
        class: "judgment", tokens: [],
        why: "the strip is a judgment (VELTRIN → VELTRI) that decides what the exact-in-class-live floor searches as a contains predicate; floorSeeds() in form-neighbourhood.mjs reads it via formativeRootFromManifest() in scope-ledger.mjs. The LINE SHAPE is code-renderable and no token speaks about the line's absence — renderFormNeighbourhoodJson() in form-neighbourhood.mjs degrades to \"manifest names no Dominant element / Formative root\"",
      },
      "elements[] — {value, kind: distinctive|common|saturated-common}": {
        class: "judgment", tokens: [],
        why: "the saturation read decides whether the register counts a token or enumerates it. Every token that names this array — element_kind_invalid, element_key_unknown — is a closed-enum or key-set check owned by the envelope, so nothing polices the read itself",
      },
      "Prose Elements table columns — Role | Saturation (low|borderline|high|very-high) | Famous-mark | Notes": {
        class: "judgment", tokens: [],
        why: "a FOUR-value saturation scale plus separate role, famous-mark and incumbent notes, against ONE three-value `kind` enum in the structured model (ELEMENT_KINDS declared in variant-manifest-model.mjs). The structured model cannot carry the distinction, so #850's move for this stage (\"model emits the structured model only; code renders the prose tables from it\") drops the saturation rating, the famous-mark flag and the incumbent note unless the schema grows those keys first",
      },
      "variants[].value — the search terms themselves": {
        class: "judgment", tokens: ["variantmodel_term_markup"],
        why: "the repo forbids code from minting a search term twice over — stages.mjs:771-773 and variant-manifest-model.mjs:387 (\"VALIDATES, NEVER GENERATES… the moment code mints a search term, judgment has moved into the funnel\"). variantmodel_term_markup is therefore a shape rule that stays model-facing BY DESIGN; do not reclassify it mechanical to satisfy E6. It also walks dominant_element and elements[].value (variantTermShapeGaps), which is why they carry no token of their own [citation unverified]",
      },
      "variants[].category — one of core|phonetic|visual|transliteration|numeric|composite|other": {
        class: "judgment", tokens: [],
        why: "#850 ruled the category CHOICE J and the closed enum M. variantmodel_category_invalid fires on the spelling, so the envelope owns it — nothing checks whether a phonetic variant was correctly called phonetic",
      },
      "variants[].rationale — one line per variant": {
        class: "judgment", tokens: [],
        why: "the collision-plausibility reason; no artifact holds it and no token speaks about it",
      },
      "romanization — the Latin-script form of every non-Latin variant value, on the row whose own value it romanises": {
        class: "judgment", tokens: ["variantmodel_romanization_missing", "variantmodel_romanization_invalid", "variantmodel_romanization_orphan"],
        why: "transliteration is a language judgment and the floor is real — half the registers hold non-Latin filings only under their transliteration. NOTE romanization_orphan is a BINDING failure (a romanisation attached to a Latin row), not a language one: the mechanical half of an otherwise judgment field",
      },
      "Family completeness — at minimum one core, one phonetic and one visual variant, plus a transliteration variant when the mark, the dominant element or any elements[] value is non-Latin": {
        class: "judgment", tokens: ["variantmodel_family_incomplete", "variantmodel_variants_empty"],
        why: "structural completeness of the family the plan compiles from; code refuses but must never mint the missing member (variant-manifest-model.mjs:387). variantmodel_family_incomplete carries THREE arms — category:<cat>, script:<term> and script-coverage:<script>:<territories> — and owns all three here, including the per-script arm declared below [citation unverified]",
      },
      "Per-script coverage — at least one rendering of the mark in each script the in-scope territories register marks in, as a transliteration variant carrying its romanization": {
        class: "judgment", tokens: [],
        why: "the rendering is judgment (a fabricated transliteration is a search we cannot stand behind); WHICH scripts are required is already code — requiredScriptsFor(scopeTerritories(job, profile)) computes it and the dispatch names them, so that half is pre-bound. Its failures ride variantmodel_family_incomplete's script-coverage arm, owned above",
      },
      "incumbent_classes[] — the industry-incumbent alert's Nice classes": {
        class: "judgment", tokens: [],
        why: "which non-target-industry incumbent owns the element, and in which classes, is a market read. variantmodel_incumbent_classes_invalid is an array-type check owned by the envelope, so no token speaks about the read",
      },
      "watchlist_owners[] — the NAMED register owners the register must cover": {
        class: "judgment", tokens: [],
        why: "naming real register owners rather than sectors is judgment. variantmodel_watchlist_owners_invalid is a type check plus a code bound (WATCHLIST_OWNERS_MAX declared in variant-manifest-model.mjs) and is owned by the envelope, so nothing polices whether the right owners were named",
      },
      "Watchlist union / client-exclusion / 24-owner cap applied by the model before emitting watchlist_owners[]": {
        class: "mechanical:code-extracted", tokens: [],
        why: "code holds every input: the frame's seeds are in matter-context.md, the client is job.customer / _driver/instructed-scope.json.customer, and the cap is already a code constant the parser enforces after the fact. Split it out and only the naming stays with the model",
      },
      "Archetype — primary (one of six) + modifiers + one-line reasoning": {
        class: "judgment", tokens: [],
        why: "the classification that decides which variant axes fire at all; no artifact holds it, and it has no slot in variant-manifest.json and no token anywhere",
      },
      "Risk theory — 2-4 sentences on where conflict concentrates for THIS mark": {
        class: "judgment", tokens: [],
        why: "the bridge from archetype to variant generation and the relevance signal the register skill gates candidates on; prose-only, no structured slot, no token",
      },
      "Distinctiveness & registrability read — spectrum placement per market language, descriptive/generic/laudatory/geographic/deceptive/offensive flags, acquired-distinctiveness note": {
        class: "judgment", tokens: [],
        why: "an advisory legal read that reaches the client-facing report; prose-only, no structured slot, no token",
      },
      "Famous-mark flags per element + famous_mark_calls_needed[]": {
        class: "judgment", tokens: [],
        why: "recognising that an element is also a band, a celebrity or a famous brand is the judgment; but the HAND-OFF is prose that makes prelim-common-law fire a dedicated Perplexity call, with no structured slot and no token — the same shape as the CROSS-CHECK line #850 classed M for its line shape",
      },
      "Scope statement — 2-4 sentences opening the deliverable narrative, with the class scope reasoned and advisory additions marked": {
        class: "judgment", tokens: [],
        why: "the collab-direct-class reasoning is a recall lever no artifact holds; the Request block it sits beside (Marks/Classes/Jurisdiction/Industry) is straight retyping of job fields the driver already wrote to _driver/instructed-scope.json",
      },
      "Cross-mark themes — shared elements, shared conceptual themes, shared industry-incumbent alerts (multi-mark requests)": {
        class: "judgment", tokens: [],
        why: "a cross-mark read synthesis consumes; prose-only, no structured slot, no token",
      },
      "### Scope ledger rows — {Layer, Item, Status: applied|dropped, Reason, Reopen trigger} across variant / field / source / jurisdiction": {
        class: "judgment", tokens: [],
        why: "defending an omission with the concrete observation that should reopen it is the whole judgment, and frame-diff diffs it against the blind re-derivation. The ROW SHAPE is mechanical — scope-ledger.mjs:123-126 parses the table into scope-ledger.json — and the jurisdiction rows are largely a re-carry of the matter frame's own Scope-jurisdictions line [citation unverified]",
      },
      "Prose variant-table category token — translit-<script>, and for Chinese translit-zh-meaning vs translit-zh-phonetic": {
        class: "judgment", tokens: [],
        why: "the meaning-vs-phonetic SENSE is a judgment the downstream class-scope gates key on, and variant-manifest.json has NO key that can carry it (one flat `transliteration` value). So this prose row is not rendered from the structured model, and #850's \"structured only\" move for this stage loses the distinction unless the schema grows a sense field first",
      },
      // The search floor came back at as a TYPED designation, having been retired at as a ⭐
      // marker. The retirement was right on its own terms and this is not a reversal of it: what it
      // deleted was a mechanism no surface could carry, and `search_floor` is a surface.
      "search_floor — the AXES this mark's search floor obliges, which a coverage-limited row may not demote": {
        class: "judgment", tokens: ["variantmodel_search_floor_invalid"],
        why: "A PER-MARK call, not a statable rule, so it stays judgment: which axes are this mark's search floor depends on where conflict concentrates for THIS mark — the same read the archetype and risk-theory rows carry. Code applies and audits the floor; it does not choose it. Designated HERE and judged by prelim-register's coverage row, which is the whole mechanism — a floor field on the coverage row itself would let the seat that missed the work decide the work was never obliged. The token covers the shape (an array of REGISTER_AXES); WHICH axes is the judgment, and nothing polices that. Do not confuse it with the FORM floor, which IS code doctrine (scope-ledger.mjs `radiusFor`) and generates its axes mechanically.",
      },
      "Per-jurisdiction sub-queries": {
        class: "judgment", tokens: [],
        why: "a per-territory search decision no artifact holds — the dispatch names the deliverable and no file the model reads says what one looks like. coverage-ledger.mjs:139-140 shows a downstream consumer that expects them (\"the per-jurisdiction sub-query belongs to primary-sweep\") [citation unverified]",
      },
      "Verify? ✅ column on every transliteration row of the prose Variants table": {
        class: "mechanical:code-rendered", tokens: [],
        why: "the tick is a pure function of the row being a transliteration row, and the structured model already carries category:\"transliteration\" — code can stamp it",
      },
      "Structured envelope — schema_version, EXACTLY the seven top-level keys, the element and variant key sets, the closed enums, the JSON skeleton dictated inline in the message": {
        class: "mechanical:tool-written", tokens: ["variantmodel_missing", "variantmodel_unparseable", "variantmodel_key_unknown", "variantmodel_variant_key_unknown", "variantmodel_element_key_unknown", "variantmodel_category_invalid", "variantmodel_element_kind_invalid", "variantmodel_incumbent_classes_invalid", "variantmodel_watchlist_owners_invalid"],
        why: "a structured-return tool writes the envelope; the model supplies values only",
      },
      "Output paths + return shape — write the prose manifest and the structured model to the named absolute paths, return ONLY the path + a 2-3 line summary": {
        class: "mechanical:pre-bound", tokens: [],
        why: "the driver named both paths in the dispatch",
      },
    },
    message: ({ paths: P, job, profile, depth }) => lines(
      // Force-load the companion: the everyday-first meaning-SET rule lives there; leaving it to a prose
      // pointer let it silently revert run-to-run (quartz-vault emitted the set, marble-foundry dropped it
      // to one technical guess with no skill change). Force-loaded, it can't be skipped under output pressure.
      reads(["skills/prelim-variants/SKILL.md", "skills/prelim-variants/transliteration-scripts.md"]),
      // lever 3 — the manifest rung. Empty on a one-country run; `lines` drops it.
      variantRungDirective(depth),
      `Read the matter frame: ${P.matterContext}.`,
      `Generate the variant manifest (elements, archetype, per-axis searches, per-jurisdiction sub-queries).`,
      // WS2 (B2) — the STRUCTURED sibling the register-plan compiler consumes (the
      // blind-frame-model precedent): the model reasons ONCE here; code compiles + freezes the
      // deterministic search plan from this JSON. Dictated keys + closed enums; the validator
      // strict-parses it, so an off-enum token fails the stage (corrective ladder repairs warm).
      // ── CONVERSION 3 — THE LITERAL JSON SKELETON IS GONE ────────────────────────────────────────
      //
      // This sentence dictated `variant-manifest.json` key by key and enum by enum — "emit the STRUCTURED
      // model … to <path> — a JSON OBJECT with EXACTLY these keys: {…}" — and `parseVariantManifestModel`
      // strict-parsed what came back. The seat hand-formatted a structure the driver already validates,
      // and O3c caught it doing `python3 -c` over its own JSON to check the formatting first.
      //
      // The `record_prelim_variants` schema IS that shape now, so the key-set and enum families stop being
      // reachable from a typed call rather than merely being caught after the file is written.
      //
      // WORTH KNOWING: the guard did NOT flag this sentence. Its write-order markers are the six
      // phrasings the composers use, and "ALSO emit … to <path>" is none of them — the guard caught this
      // dispatch only because `writeReturn()` sat beside it, and went green the moment that was deleted
      // while this order still stood. Recorded, which already holds the guard-precision work.
      //
      // The WATCHLIST-OWNER contract rides into the tool's schema description rather than being lost:
      // real register owners, never sectors or descriptions, because the driver compiles each into a
      // deterministic owner lane.
      // — the enum above is stated one line up; its DEFINITIONS go here, immediately after it, so the
      // model reads what the seven words mean at the moment it is told to use them. Two marks were lost on
      // this absence with `withheld: 0` — never in front of the engine at all.
      VARIANT_CATEGORY_BRIEF,
      // The romanisation is what makes the transliteration axis EXECUTABLE (a clearance run, 2026-07-29:
      // thirteen native-script terms compiled with no Latin form, and the register that indexes non-Latin
      // filings by their transliteration refused every one — the axis returned no coverage at all). The
      // driver carries BOTH forms on the entry and each provider expresses the one it can answer, so the
      // model's ONE job is to state the pair; it never chooses which form gets searched.
      `ROMANIZATION (MANDATORY on every non-Latin variant value, FORBIDDEN on a Latin one): a variant whose "value" is written in ANY non-Latin script — Han, Katakana, Hangul, Arabic, Cyrillic, Devanagari, Thai, Greek — MUST also carry "romanization": its Latin-script form, syllable-separated by single spaces, PLAIN ASCII LETTERS AND DIGITS ONLY (no tone marks, no diacritics, no leftover characters): 华威豹 → "HUA WEI BAO", ティキスラッシュ → "TIKI SURASSHU", 티키 슬러시 → "TIKI SEULLEOSI", Тики Слаш → "TIKI SLASH". Put each romanization on the row whose OWN value it romanises — never on a neighbouring row, never as a row of its own — and never romanise a value that is already Latin (that row is refused as an orphan). Half the registers we search hold non-Latin filings ONLY under their transliteration and cannot answer the characters at all, so a non-Latin variant without its romanization is a term we cannot search anywhere. WHEN THE MARK OR THE DOMINANT ELEMENT IS ITSELF NON-LATIN, list it as a "core" variant carrying its romanization too — "mark" and "dominant_element" have no romanization slot of their own, and the driver reads every term's romanization off the variant that states it.`,
      // A7 — the completeness floor the validator holds this output to (armed via the stage contract
      // above). The FAMILY must be stated in full; which member bites stays judgment's call downstream.
      `FAMILY COMPLETENESS (MANDATORY): the variants[] array must state the mark's WHOLE search family, never a single row — at MINIMUM one "core" variant (the mark / a spacing-punctuation form of it), one "phonetic" variant and one "visual" variant; and when the mark, the dominant element or any elements[] value is non-Latin, at least one "transliteration" variant as well (the transliteration-numeric register axis compiles ONLY from transliteration/numeric rows — with none stated, that axis runs empty, silently). A manifest missing any of these fails the stage. State the family completely and let the searches say what is out there — completeness here is structural, it is NOT a ranking, and it never pre-judges which neighbour matters.`,
      // item 21 — the PER-SCRIPT arm of the same floor. Stated as the requirement it is (one rendering
      // per in-scope script), never as a list of terms: code must never mint a search term, so the gate
      // refuses and THIS prompt is what produces the rendering. The territories come from the frozen
      // scope; registration-scripts.mjs decides which scripts each one plausibly registers marks in.
      scriptFloorDirective(job, profile),
      // ── CONVERSION 3 — BOTH WRITE ORDERS ARE GONE ─────────────────────────────────────────
      //
      // This dispatch used to end `writeReturn(P.variantManifest)`, and the sentence above it dictated a
      // literal JSON SKELETON for `variant-manifest.json` — key by key, enum by enum — which
      // `parseVariantManifestModel` then strict-parsed. The seat hand-formatted a structure the driver
      // already validates, and O3c caught the cost: `python3 -c` over its own JSON, 9 Bash calls with 4
      // writes across 15 attempts, a seat checking what the transport can check.
      //
      // Deleted rather than left beside the tool: a superseded path left executable is what the golden
      // rule bans, and e2e has twice measured a seat obeying the prose while holding the tool.
      //
      // EACH FIELD CARRIES ITS OWN IMPERATIVE IN ITS OWN SENTENCE.
      `Hand the manifest back by calling the \`record_prelim_variants\` tool. Send \`mark\` verbatim, \`dominant_element\`, and \`elements\` — one \`{value, kind}\` per token, kind from the closed set distinctive | common | saturated-common.`,
      `Send \`variants\` — one \`{value, category, rationale, romanization}\` per search term, category from the closed set the skill names, and \`romanization\` on every non-Latin value and only on those.`,
      `Send \`incumbent_classes\` and \`watchlist_owners\` where Step 5 names them, as arrays; omit or send empty where it does not.`,
      // THE SCOPE LEDGER STOPS BEING A TABLE THE DRIVER RE-READS. It used to be dictated as markdown in
      // the skill doc and recovered by parsing those columns back out of the prose (renderScopeLedgerJson
      // over variant-manifest.md). The rows arrive typed now and the driver renders the table AND
      // serialises scope-ledger.json from the same values, so the parse is deleted rather than moved.
      // `reopen_trigger` IS NAMED HERE. The first cut of this sentence listed four fields; the renderer
      // emits five columns, the skill calls a dropped row without a reopen trigger "itself a coverage gap",
      // and the acceptance boundary does not refuse one — so an under-specified dispatch was the only thing
      // standing between doctrine and a silently empty column. Whether acceptance should REFUSE such a row
      // is a separate question and is stated in the PR body rather than decided here.
      `Send \`scope_ledger\` — one \`{layer, item, status, reason, reopen_trigger}\` per decision, layer from ${SCOPE_LAYERS.join(" | ")} and status from ${SCOPE_STATUSES.join(" | ")}. Every \`dropped\` row carries the concrete observation that should reopen it; a dropped row with no reopen trigger is itself a coverage gap. The driver renders the ledger table and writes scope-ledger.json from these rows; do not format a table.`,
      `Do NOT write or edit any file. There is no path for you to write to: the driver serialises the model, renders the prose manifest and derives the scope ledger, and nothing you hand-write is read.`,
      `When the tool accepts your call, return ONLY a 2-3 line summary of the manifest.`,
    ),
  },

  // Property 1 (Independence) — a BLIND re-derivation of the whole frame. STARVED of matter-context (which
  // already carries the frame), it reads ONLY the raw instruction and re-derives the threat model cold across
  // four layers, emitting a structured model. Runs IN PARALLEL with the gather (pipeline.mjs) — no tool calls,
  // so it finishes inside the longest gather member's wall (zero added critical-path latency). NON-FATAL.
  // Opus: it is a PEER re-derivation of prelim-variants/matter-frame (both opus) — a weaker tier cannot
  // credibly out-imagine the frame; the independence is the input DIET (starvation), not a different family.
  "blind-frame": {
    model: "opus", thinking: "high", timeoutSec: 600, stallSec: 450,
    skillReads: ["skills/blind-frame/SKILL.md"],
    // The STRUCTURED model IS the output — not a sibling of one. That is what makes an absence
    // loud: runStage gates on `out` (missing_file:blind-frame-model.json) and re-judges it through
    // validators.blindFrame (invalid_file:…:blindframe_*). Point this at prose again, or at nothing, and
    // the stage can complete having written no model at all.
    out: (P) => P.blindFrameModel,
    validate: validators.blindFrame,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "dominant_element — the spine the blind re-derivation locks onto": {
        class: "judgment", tokens: ["blindframe_dominant_element_missing"],
        why: "a cold re-derivation of the spine from the raw instruction alone; the whole point is that no artifact may supply it — the run's own answer is deliberately withheld",
      },
      "variants[] — {value, direction: add|drop|phonetic|homophone|neighbour|composite, rationale}, neighbours in BOTH directions": {
        class: "judgment", tokens: ["blindframe_variants_empty"],
        why: "fresh imagination, starved of the frame. blindframe_direction_invalid and blindframe_variant_key_unknown are enum-spelling and key-set checks owned by the envelope; blindframe_variants_empty is the one content-absence token",
      },
      "fields[] — {goods, on_field boolean, rationale} by goods-overlap with the actual product": {
        class: "judgment", tokens: [],
        why: "the on-field boundary is the judgment the frame is being tested against. Its two tokens (field_on_field_invalid, field_key_unknown) are a JSON-type check and a key-set check, both owned by the envelope — nothing polices the boundary itself, and fields[] may legitimately be empty",
      },
      "sources[] — {channel, rationale} by the product's real channel": {
        class: "judgment", tokens: [],
        why: "which channels this product actually lives on. The only token naming it is blindframe_source_key_unknown, a key-set check owned by the envelope",
      },
      "ranking_basis — goods-overlap | class-number": {
        class: "judgment", tokens: [],
        why: "how to rank a saturated element is a stated position. blindframe_ranking_basis_invalid fires on the enum spelling and is owned by the envelope, so no token speaks about the position",
      },
      "Structured envelope — schema_version, EXACTLY the six top-level keys, the variant/field/source key sets, the closed enums, on_field as a JSON boolean, \"no key you were not given\"": {
        class: "mechanical:tool-written", tokens: ["blindframe_unparseable", "blindframe_key_unknown", "blindframe_variant_key_unknown", "blindframe_field_key_unknown", "blindframe_source_key_unknown", "blindframe_direction_invalid", "blindframe_field_on_field_invalid", "blindframe_ranking_basis_invalid"],
        why: "#850 rules the envelope M and the content J for this stage; a structured-return tool writes the envelope and the model supplies values only",
      },
      "Return shape — hand the model back through record_blind_frame, write NO file, return ONLY a 2-3 line summary": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (#1092, the register-digest transport's pattern): the seat sends VALUES and the driver writes blind-frame-model.json. The write dictation is DELETED rather than left beside the tool — a superseded path left executable is what the golden rule bans, and e2e measured the consequence: on 2e203b75 the seat obeyed the prose and hand-wrote a 17182B model with no call capture beside it, on a box whose grant already carried the tool. Nothing is pre-bound any more because the seat is handed no path. Owner ruling S4 (2026-08-13) still holds and is now structural: prose stays prose, data moves to structured fields, and the envelope is code's because code is the only writer.",
      },
    },
    message: ({ paths: P, job }) => lines(
      reads(["skills/blind-frame/SKILL.md"]),
      `BLIND re-derivation. You are deliberately STARVED of the matter frame so you cannot inherit its conclusions.`,
      `Re-derive the threat model COLD from ONLY the raw instruction below. Do NOT read the matter frame (matter-context.md), the variant manifest, or ANY prior analysis; do NOT assume the earlier triage was right.`,
      `Mark(s): ${JSON.stringify(job.marks ?? job.markName ?? job.name)}; classes ${JSON.stringify(job.classes ?? "")}.`,
      job.goods ? `Goods/services (verbatim): ${job.goods}` : "",
      job.jurisdictions ? `Stated territories: ${Array.isArray(job.jurisdictions) ? job.jurisdictions.join(", ") : job.jurisdictions}` : "",
      job.priorUse ? `Stated manner of use: ${job.priorUse}` : "",
      // P2-C (Round-2 §8a): the same campaign-shape FACTS the matter frame gets — the blind re-derivation
      // must not re-invent a launch shape the client already stated.
      job.campaignShape ? `Stated campaign shape (verbatim from intake): ${job.campaignShape}` : "",
      job.upfrontInstructions ? `Requester instructions (verbatim): ${job.upfrontInstructions}` : "",
      job.rawRequest ? `The VERBATIM inbound request is archived at ${P.inboundRequest} — read it ONLY for the mark / goods / territories / manner of use; read nothing else.` : "",
      `Re-derive across the FOUR layers (element + neighbours BOTH directions; field by goods-overlap; sources by real channel; ranking by goods-overlap) per the skill.`,
      // ONE output: the STRUCTURED model. There is no prose twin — it was written for nobody and
      // emission is the wall-clock, so the reasoning stays in the turn and only the model lands on disk.
      // — THE WRITE DICTATION IS GONE, and with it the path. `writeReturn(P.blindFrameModel)` used to
      // close this dispatch; the seat now hands values to `record_blind_frame` and the driver writes the
      // model. Deleted rather than kept beside the tool: e2e measured a seat obeying this prose on
      // 2e203b75 while holding the tool, which is what a superseded path left executable buys.
      `Hand the threat model back by calling the \`record_blind_frame\` tool — \`dominant_element\`, \`variants\`, \`fields\`, \`sources\` and \`ranking_basis\` as VALUES, with the closed enums the skill names. The driver validates what arrives, holds the record, and writes blind-frame-model.json itself.`,
      `Do NOT write or edit any file. There is no path for you to write to, nothing you hand-write is read, and a prose companion is read by nobody — your reasoning belongs in this turn and in the \`rationale\` lines.`,
      `When the tool accepts your model, return ONLY a 2-3 line summary of what you found.`,
    ),
  },

  "common-law": {
    // stallSec is REQUIRED here, like the sibling sweep stage `register-unit` (timeoutSec 1200 / stallSec
    // 900): common-law's first action is the long perplexity_research grid sweep, during which the model
    // streams 0 tokens while blocked on the tool. Without a per-stage override it falls back to the global
    // CLEAROTRON_STALL_MS (120s) and the engine's zero-streamed-tokens watchdog kills a big sweep mid-flight
    // (reclassified `lane_wedge`) — the AURA quartz-keystone failure (168-cell grid > 120s). The Phase-4
    // stallSec pass (d9d5661d) resourced every other heavy stage but missed this one.
    // 2026-06-24 (perf): hard wall 1200→1500, stall 900→1100 — insurance for a slow-provider multi-call sweep.
    // 2026-07-11 (calibration): hard wall 1500→2250. On dense-marketplace matters common-law measured ~1854–
    // 1904s (VIBRANTE FROSTPLUM, cl. 5/32), so EVERY attempt-1 was SIGKILLed at the 1500s wall (code 137) and
    // only the ×1.5 retry (2250s) finished — ~25min + a full gather's tokens wasted per pass, twice per run.
    // 2250 IS the proven-sufficient budget (the successful reruns ran at exactly this); an even heavier matter
    // still backstops on the ×1.5 retry. stallSec stays 1100 (< the wall) so a genuine silent wedge trips at
    // 18min, not 37 — the reruns proved 1100/2250 works (they streamed throughout).
    // The upstream fix for gather COST is still in-class scoping + the 600 enumerate ceiling; this wall just
    // stops killing a gather that is legitimately working. Ship WITH the scoping/ceiling levers, not alone.
    model: "haiku", thinking: "low", timeoutSec: 2250, stallSec: 1100,
    skillReads: ["skills/prelim-common-law/SKILL.md"],
    out: (P) => P.commonLaw,
    validate: validators.commonLaw,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "deterministic grid dispatch — call perplexity_research with enable_sandbox:true and grid_spec_path: _driver/grid-spec.json": {
        class: "mechanical:tool-written", tokens: ["grid_ledger_missing", "grid_join_missing", "platforms_missing", "connotation_search_missing"],
        why: "The driver wrote _driver/grid-spec.json and the plugin writes common-law-grid.json from the API response. The model supplies no value at all — the only arg is a path the message interpolates. #850 calls this the reference pattern.",
      },
      "legacy branch — author the search-as-code grid program from the prompt template": {
        class: "mechanical:tool-written", tokens: ["grid_join_missing", "platforms_missing"],
        why: "The same program is compiled by the driver into the grid spec on the deterministic branch, so code already holds it. The legacy branch is a second contract for one artifact and it is still in the shipped message — #850's audit reads only the deterministic branch and does not name it.",
      },
      "legacy branch — save the grid call's stdout JSON VERBATIM to common-law-grid.json (single object, or array per batch in batch order)": {
        class: "mechanical:tool-written", tokens: ["grid_ledger_missing", "grid_ledger_unparseable", "grid_join_missing", "platforms_missing"],
        why: "A copy operation over tool output, named as one in its own instruction. The deterministic branch discharges it in the plugin. This is the transcription lane #850 says truncated and dropped cells.",
      },
      "GRID KEYS — reuse each of the N driver-supplied variant terms VERBATIM as its Negative-results matrix key": {
        class: "mechanical:pre-bound", tokens: ["grid_join_missing", "receipts_short"],
        why: "The driver holds gridVariants, prints them into the dispatch, then string-joins the model's retyping back against the same list (findGridLedgerViolations / findReceiptViolations). This is matter-frame's `frame_scope_missing` loop wearing a different token. The table does not name it.",
      },
      "PLATFORMS — sweep exactly the profile's store domains, and key the matrix by them": {
        class: "mechanical:pre-bound", tokens: ["platforms_missing", "platform_identity_error"],
        why: "`_driver/profile.json` holds the list and the message prints it; findPlatformIdentityViolations then joins the ledger against that same array. Nothing the model can add.",
      },
      "BATCHING — split the keys into ceil(N/batch) batches of <=batch variants and concatenate the matrices": {
        class: "mechanical:code-assigned", tokens: [],
        why: "The driver computes the batch count before dispatch and prints it. On the deterministic branch the plugin owns the chunking outright. No token in validators.commonLaw speaks about it — a gap.",
      },
      "per-candidate taxonomy judgement — which returned candidates are confusion risks / commercial awareness / competitor intel / PR risk": {
        class: "judgment", tokens: ["missing", "too_short"],
        why: "#850 keeps it: the legal filter over raw unjudged web output is the stage's reason to exist.",
      },
      "Findings section prose (the findings file's Findings heading and its per-finding rows)": {
        class: "judgment", tokens: ["missing", "too_short", "declared_unavailable"],
        why: "#850 rules the four prose sections J (keep). `missing` here is the findings-heading arm of commonLawStructural() in verify.mjs.",
      },
      "Negative-results matrix — one receipt-carrying row per (variant x platform) cell": {
        class: "judgment", tokens: ["missing", "receipts_short"],
        why: "#850 rules the Negative-results prose J and I do not re-litigate it. Recorded so E2 can see it: the two arms that speak about it (`missing:negative-results`, `missing:platform matrix` in commonLawEvidence() in verify.mjs, and `receipts_short` at commonLawEvidence() in verify.mjs) count CELLS, and every cell is in the ledger the tool wrote.",
      },
      "Coverage ledger rows — one per planned coverage unit, status in {confirmed-clean, coverage-limited, deferred} + reason": {
        class: "judgment", tokens: ["missing", "no_coverage_status_row"],
        why: "#850 rules coverage prose J. `no_coverage_status_row` (hasCoverageLedgerRow() in verify.mjs) is the arm that speaks about the status vocabulary.",
      },
      "Audit trail — call log: per call, type, prompt summary, results returned": {
        class: "judgment", tokens: ["missing"],
        why: "#850 rules audit-trail prose J. Recorded for E7: the call count and the per-call result count are in the ledger and in _driver/tool-calls.jsonl, so only the prompt-summary column is authored.",
      },
      "Grid program receipt — paste the SANDBOX PROGRAM block from the tool result verbatim into the audit trail": {
        class: "mechanical:tool-written", tokens: [],
        why: "Verbatim re-emission of a block the tool already returned and, on the deterministic branch, already wrote. No validator token speaks about it — a gap, and an instance of exactly the shape #850 says escapes a stages.mjs-only reading.",
      },
      "Summary section — Perplexity calls executed, mandatory platforms covered N/N, findings surfaced, open flags": {
        class: "mechanical:code-extracted", tokens: [],
        why: "Every number is a count over the ledger the tool wrote and the findings rows the model typed; the driver can derive all four. No token speaks about it.",
      },
      "disposition form `ruling` — exactly one of benign / off-topic / loaded, on every row": {
        class: "judgment", tokens: ["connotation_token_absent", "connotation_no_ruling"],
        why: "#850: \"this is the whole job\". isRuled() in connotation-search.mjs accepts only a member of RULING_SET, and no artifact holds that call.",
      },
      "disposition form `note` — one line saying what the receipt says and why it reads that way": {
        class: "judgment", tokens: ["connotation_no_ruling"],
        why: "#850 keeps it. `connotation_no_ruling` is the residual that carries the empty-note state (usableSnippet() in connotation-search.mjs).",
      },
      "disposition form `receipt_id` — copy one of that row's own candidate ids": {
        class: "mechanical:pre-bound", tokens: ["connotation_form_damaged", "connotation_cite_absent"],
        why: "The row's `candidates[].receipt_id` values are in the driver's own copy of the form (_driver/, dispositionForm() in verify.mjs) and were computed from the ledger. Move M1: pre-bind the sole-candidate rows, ordinal selection otherwise. This is the field that produced the invented `R-RECEIPT`.",
      },
      "disposition form `anchor` — a SHORT fragment of a candidate snippet, on quote_required rows": {
        class: "mechanical:code-extracted", tokens: ["connotation_quote_unbound"],
        why: "quoteBinding() in connotation-search.mjs already computes the binding from the snippet the tool fetched; move M2 runs it forward. Code holds the text.",
      },
      "disposition rows are the driver's — the seat sends values through `record_dispositions`, never a document": {
        class: "mechanical:pre-bound", tokens: ["connotation_form_damaged", "connotation_no_ruling", "connotation_call_schema_violation"],
        why: "B: the driver regenerates every row from the ledger on every pass and folds accepted call rows in (disposition-union.mjs via disposition-tool.mjs). The hand-edited form and its whole-file states (`form_unparseable`, `form_untouched`) died with the form path; a malformed payload is refused per row at the call and surfaces as `call_schema_violation`.",
      },
      "covering EVERY disposition row across the turn's calls": {
        class: "mechanical:pre-bound", tokens: ["connotation_token_absent", "connotation_call_never_made", "connotation_call_partial"],
        why: "The obligation set is computed by the driver from the ledger before dispatch (obligationRows/connotationObligations), and the tool's answer names what is still outstanding after every call.",
      },
      "PR / reputational section — the readings the meaning sweep surfaced, per form, each labelled benign or loaded": {
        class: "judgment", tokens: ["connotation_search_missing"],
        why: "The semantic read of a surfaced passage is the model's. `connotation_search_missing` (verify.mjs:362) fires when the ledger recorded no meaning query at all. [citation unverified]",
      },
      "`Connotation-search source: <URL | \"perplexity_research — no result\">` line on a clean PR row": {
        class: "mechanical:code-extracted", tokens: ["connotation_search_missing"],
        why: "The ledger's extras.pr_risk[] holds every query and its results, and the driver renders the disposition table from the form. #460 deleted the transcription from the message; this line survives in the skill and asks for a URL back out of an artifact code already reads.",
      },
      "`CROSS-CHECK REQUIRED: <what> — <why>` — the check that is needed and why": {
        class: "judgment", tokens: [],
        why: "#850: content J. Only the model knows which cross-layer question its findings raise. No validator token speaks about it — doubt-ledger.mjs mintCrossCheckDoubts parses the line but validators.commonLaw never looks.",
      },
      "`CROSS-CHECK REQUIRED:` exact line shape — that prefix, an em-dash, the mark in CAPS, on its own line": {
        class: "mechanical:code-rendered", tokens: [],
        why: "#850: M (shape) — typed row in the return, code renders the line. A dictated shape a parser re-parses is the E3 class. No token.",
      },
      "INSTRUCTED CHECKS — the ask text the requester wrote, quoted back in the findings file with its receipt": {
        class: "mechanical:pre-bound", tokens: [],
        why: "The driver holds intakeAsks, filters them by owner and prints them numbered into the dispatch. Same shape as synthesis's `ask_answers[].ask` which the table classes M. No token at this stage.",
      },
      "INSTRUCTED CHECKS — execute each as part of the sweep, or state honestly why it could not run": {
        class: "judgment", tokens: [],
        why: "Running the check and ruling on its result is the work; the honest not-executed reason is the model's own account of its turn. No token.",
      },
      "layer-availability declaration — whether the findings prose says the marketplace layer could not be completed": {
        class: "mechanical:code-extracted", tokens: ["declared_unavailable"],
        why: "The ledger's gap rows already decide whether the grid ran; #554 made a zero-gap ledger override the sentence. The surviving model act (write no file when the tool truly failed) is a dispatch-level choice, not a value in the artifact.",
      },
      "final return — the absolute output path plus a 2-3 line summary": {
        class: "mechanical:pre-bound", tokens: [],
        why: "The path is `out: (P) => P.commonLaw`, interpolated into the message by the driver; the summary's counts are the ledger's. No token speaks about the return message at all.",
      },
    },
    message: ({ paths: P, gridVariants, profile, gridSpecPath, job, intakeAsks }) => {
      // C1 — weight the sweep where use creates RIGHTS (data-derived; "" when unknown)
      const systemScope = marketplaceScopeDirective(scopeTerritories(job, profile));
      // T9 (A2) — the OWNING stage finally receives its committed intake checks (the VENZY
      // descriptiveness ask was captured, threaded to synthesis for an ANSWER SLOT, and never run by
      // anyone). An instructed check is EXECUTED here with a receipt, or honestly not-executed with
      // the mechanical reason — synthesis then answers from a real result, never from silence.
      const ownedAsks = (intakeAsks ?? []).filter((a) => a.owner === "common-law");
      const asksBlock = ownedAsks.length ? lines(
        `INSTRUCTED CHECKS (the requester explicitly asked for these; THIS stage owns them — EXECUTE each as part of the sweep and record its receipt in the findings file, or state honestly why it could not run):`,
        ...ownedAsks.map((a, i) => `  ${i + 1}. "${a.ask}"`),
      ) : "";
      // DETERMINISTIC GRID (robust fix, 2026-06-14): when the driver wrote a grid-spec, the model is OUT
      // of the grid data path entirely — it passes grid_spec_path, the plugin runs the dictated cells and
      // WRITES common-law-grid.json from the API response (no truncation, no dropped/mis-keyed cells), and
      // the model only judges the returned candidates. This is the structural cure for both the Zephyr
      // truncation and the NOVA PULSE dropped-cell failures (no tier bump would fix the output ceiling).
      if (gridSpecPath) {
        return lines(
          reads(["skills/prelim-common-law/SKILL.md"]),
          `Inputs: variant manifest ${P.variantManifest}; matter frame ${P.matterContext}.`,
          systemScope,
          asksBlock,
          `Run the marketplace sweep via the DETERMINISTIC grid: call perplexity_research with enable_sandbox:true and grid_spec_path: ${gridSpecPath}. The tool runs EXACTLY the dictated term × platform grid and WRITES the complete ledger to ${P.commonLawGrid} itself.`,
          `Do NOT author the grid program, do NOT save ${P.commonLawGrid} yourself, and do NOT re-emit the grid JSON in your message (re-emitting is exactly what truncated/dropped cells before). The tool returns only the candidate hits that need judgment.`,
          `Judge each returned candidate into the fixed taxonomy and write your findings file to ${P.commonLaw} with its Findings, Negative-results matrix, Coverage ledger, and Audit trail sections. The driver validates grid completeness from the ledger the tool wrote — never from your prose.`,
          // P2-C (Round-2 §8b leg 2) — receipts disposition is a dictated obligation, not skill-prose-only
          // (the §7 lesson: prose-only contracts get skipped under output pressure; the evidence run listed
          // its queries and still asserted clean past a recorded cultural-criticism receipt).
          // — the obligation is unchanged; what was deleted is the TRANSCRIPTION it used to demand
          // ("the query VERBATIM, one recorded result … title or URL copied exactly"). The driver writes
          // the form; this names it and the two fields the seat owns, and nothing else.
          meaningSweepReceiptsInstruction(),
          CROSS_CHECK_HANDOFF,
          writeReturn(P.commonLaw),
        );
      }
      // WS-B: the platform grid is DICTATED from the customer profile (single source — the receipts
      // gate's identity join validates the saved ledger against this same list); the batch ceiling is
      // derived from the profile's cell floor (Ember Guard 2026-06-12: a 224-cell single grid call
      // truncated mid-matrix — ~14×7=98 cells/call is the proven-safe budget, scaled per profile).
      const batch = profile?.batchSize ?? 14;
      return lines(
        reads(["skills/prelim-common-law/SKILL.md"]),
        `Inputs: variant manifest ${P.variantManifest}; matter frame ${P.matterContext}.`,
        systemScope,
        asksBlock,
        `Run the marketplace sweep as the Step-2 search-as-code grid call (enable_sandbox: true, depth: "pro-search"); judge the per-cell candidates into the fixed taxonomy; the Negative-results matrix carries one receipt row per (variant × platform) cell.`,
        profile?.platforms?.length ? lines(
          `PLATFORMS (the grid sweeps EXACTLY these store domains for EVERY variant): ${profile.platforms.join(", ")} — plus ONE unrestricted general-web search per variant (platform name "web").`,
          `The receipts gate validates every variant against THIS list (count AND identity) — never substitute platforms from memory or skill examples.`,
        ) : "",
        gridVariants?.length ? lines(
          `GRID KEYS (the validator checks EXACTLY these ${gridVariants.length} terms — use each VERBATIM as its Negative-results matrix key; a " / "-packed key may instead carry full per-alternate rows):`,
          ...gridVariants.map((v) => `- ${v}`),
          ...(gridVariants.length > batch ? [
            `BATCHING (MANDATORY at this size — one oversized grid call truncates and fails the run): split the keys into ${Math.ceil(gridVariants.length / batch)} batches of ≤${batch} variants, run ONE grid call per batch (same program, same platforms), and concatenate the matrices. Every batch's stdout is transcribed in full before the next call.`,
          ] : []),
          // Machine receipts (post-mortem §1b): the gate validates the saved stdout JSON by exact join on the
          // keys above — not by re-reading the markdown matrix — whenever this file exists.
          `MACHINE RECEIPTS (MANDATORY): save the grid call's stdout JSON VERBATIM to ${P.commonLawGrid} — the single stdout object, or a JSON ARRAY of the per-batch stdout objects in batch order when batched. Copy the JSON exactly as the tool returned it (no reformatting, no re-typing, no judging); the driver validates grid completeness from THIS file.`,
        ) : "",
        CROSS_CHECK_HANDOFF,
        writeReturn(P.commonLaw),
      );
    },
  },

  // A1 SPLIT — one concurrent HALF of the common-law grid, parameterized by half id ("a"/"b") threaded
  // through ctx.axis (the same channel register-unit uses for its axis: it drives out(), the session-key
  // suffix and the stage label; def.model wins over axisTier so the tier never misreads the half id).
  // The half member exists ONLY on the deterministic-grid path: the driver wrote _driver/grid-spec.half-
  // <h>.json (disjoint terms, full platform list — see common-law-receipts.splitGridTerms) and the plugin
  // writes THIS half's ledger itself; the model judges only the returned candidates, exactly like the
  // single-member deterministic branch above. The driver merges the two halves' findings + ledgers into
  // the canonical files in code (pipeline.mjs), so downstream never sees half artifacts.
  "common-law-half": {
    // Same resourcing rationale as "common-law" above: the sweep streams 0 tokens while blocked on the
    // grid tool, so the stall override is REQUIRED. The wall stays 2250 even though a half grid is ~half
    // the cells — the wall exists to stop killing legitimate work, and a dense-matter half plus the
    // judgment pass still wants headroom; the ×1.5 retry remains the backstop.
    // — model/thinking MOVED to COMMON_LAW_SEAT_TIER, resolved per seat through axisTier. Not
    // duplicated here: a static def.model wins over axisTier, so leaving one would make the per-seat map
    // dead while looking authoritative. The wall and the stall stay here — they are the same for every
    // seat and are about the grid tool's silence, not about the judgment tier.
    timeoutSec: 2250, stallSec: 1100,
    skillReads: ["skills/prelim-common-law/SKILL.md"],
    out: (P, half) => P.commonLawHalf(half),
    validate: validators.commonLawHalf,
    // — the run's own receipt of which prompt vintage minted this dispatch, written at DISPATCH
    // only. DELIBERATELY NOT a gate: the validator keys on whether the dispositions file is there, not
    // on this stamp, because an obligation is discharged by structure OR by prose and a fresh dispatch
    // must never fail for choosing the older path. It exists so a round can attribute a measured change
    // to having been told — which is the attribution and both ask for and could not get.
    contract: { structuredDispositions: true },
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "half grid dispatch — call perplexity_research with enable_sandbox:true and grid_spec_path: _driver/grid-spec.half-<h>.json": {
        class: "mechanical:tool-written", tokens: ["grid_ledger_missing", "grid_join_missing", "platforms_missing", "connotation_query_unrecorded", "grid_ledger_unparseable", "platform_identity_error"],
        why: "The driver wrote the half spec (common-law-receipts.splitGridTerms) and the plugin writes common-law-grid.half-<h>.json itself. The model's only contribution is the call. #850 calls this the reference pattern; there is no legacy branch on this stage, so the transcription lane is already closed here.",
      },
      "half scoping — cover ONLY this half's dictated terms, never widen beyond the spec": {
        class: "mechanical:pre-bound", tokens: ["grid_join_missing"],
        why: "The partition is computed by the driver and written into the spec; the tool runs exactly it. The instruction restates a bound the model cannot cross.",
      },
      "per-candidate taxonomy judgement over the candidates the tool returned (seats a/b)": {
        class: "judgment", tokens: ["missing", "too_short"],
        why: "#850 keeps it — same element as the canonical stage.",
      },
      "Findings section prose (both branches — on seat m, every loaded reading as its own finding with its receipt)": {
        class: "judgment", tokens: ["missing", "too_short", "declared_unavailable"],
        why: "#850 rules the prose J. The findings-heading arm differs per seat: verify.mjs:447 for a/b, verify.mjs:252 for m (which also accepts meaning/connotation). [citation unverified]",
      },
      "Negative-results matrix — one receipt-carrying row per (variant x platform) cell (seats a/b only)": {
        class: "judgment", tokens: ["missing"],
        why: "#850 rules it J. Note the half validator has no `receipts_short` arm: completeness is the machine join against the half ledger, so the accounting half of this section is already code's here.",
      },
      "Coverage ledger rows — status + reason per coverage unit (seats a/b only)": {
        class: "judgment", tokens: ["missing", "no_coverage_status_row"],
        why: "#850 rules coverage prose J.",
      },
      "Audit trail — which queries ran and what each returned": {
        class: "judgment", tokens: ["missing"],
        why: "#850 rules it J. Recorded for E7: on seat m the ledger holds both halves of that sentence — `connotation_query_unrecorded` (commonLawMeaningSeat() in verify.mjs) proves it by joining the dictated queries against the ledger, never against this prose.",
      },
      "disposition form `ruling` — exactly benign / off-topic / loaded, on every row": {
        class: "judgment", tokens: ["connotation_token_absent", "connotation_no_ruling"],
        why: "#850: the whole job of the meaning seat.",
      },
      "disposition form `note` — one line saying what the receipt says and why it reads that way": {
        class: "judgment", tokens: ["connotation_no_ruling"],
        why: "#850 keeps it. The empty-note state lands in the `no_ruling` residual (connotation-search.mjs:2129-2133). [citation unverified]",
      },
      "disposition form `receipt_index` — the 1-based POSITION of the candidate you ruled on, in that row's own list": {
        class: "mechanical:pre-bound", tokens: ["connotation_form_damaged", "connotation_cite_absent"],
        why: "M1 LANDED. The element was `receipt_id`, an 8-character token the seat had to copy from a list the driver had already written, and it is the exact field that took the literal placeholder on 27 rows of one seat — the prompt displayed a token shape and the model produced one of that shape. It now asks for a position and code resolves position to id (resolveCandidate, connotation-search.mjs); a row with a single candidate is pre-filled and asks for nothing. No seat-facing text displays an id shape any more, which is what closes the echo rather than refusing it afterwards.",
      },
      "disposition form `anchor` — a SHORT fragment copied exactly from a snippet carried on one of that row's candidates": {
        class: "mechanical:code-extracted", tokens: ["connotation_quote_unbound"],
        why: "quoteBinding() in connotation-search.mjs already returns the matching receipt_id from the snippet text; move M2 runs it forward. The `split` state that cost a1-a4 180 seconds becomes a code-side choice.",
      },
      "disposition rows are the driver's — the seat sends values through `record_dispositions`, never a document": {
        class: "mechanical:pre-bound", tokens: ["connotation_form_damaged", "connotation_no_ruling", "connotation_call_schema_violation"],
        why: "B: the driver regenerates those rows from the ledger every pass and folds accepted call rows in (disposition-union.mjs via disposition-tool.mjs). The hand-edited form and its whole-file states died with the form path; a malformed payload is refused per row at the call.",
      },
      "covering EVERY disposition row across the turn's calls": {
        class: "mechanical:pre-bound", tokens: ["connotation_token_absent", "connotation_call_never_made", "connotation_call_partial"],
        why: "The obligation set is driver-computed before dispatch. This is #850's a1: 81 rows, 12 ruled, turn ended honestly — under the typed transport the tool's answer names the remainder after every call.",
      },
      "do not hand-write the disposition table into the findings file": {
        class: "mechanical:code-rendered", tokens: [],
        why: "Code renders it from the form. A prohibition is the artefact of a duty that should never have been offerable — no token speaks about it because the render overwrites whatever is typed.",
      },
      "a loaded reading ALSO becomes a Finding in the findings file": {
        class: "judgment", tokens: ["missing"],
        why: "Deciding a reading is loaded enough to be a finding is the same call as `ruling: loaded` — the model's. Only the findings-heading arm speaks about the section it lands in.",
      },
      "`CROSS-CHECK REQUIRED: <what> — <why>` — the check that is needed and why (seats a/b only)": {
        class: "judgment", tokens: [],
        why: "#850: content J. No validator token.",
      },
      "`CROSS-CHECK REQUIRED:` exact line shape — prefix, em-dash, mark in CAPS, own line": {
        class: "mechanical:code-rendered", tokens: [],
        why: "#850: M (shape). The driver parses only this shape (doubt-ledger.mjs mintCrossCheckDoubts). E3 class; no token.",
      },
      "INSTRUCTED CHECKS — the requester's ask text, quoted back with its receipt (half a only)": {
        class: "mechanical:pre-bound", tokens: [],
        why: "The driver holds the asks, picks the owning half and prints them numbered. Same shape the table classes M at synthesis. No token at this stage.",
      },
      "INSTRUCTED CHECKS — execute each as part of the sweep, or state honestly why it could not run (half a only)": {
        class: "judgment", tokens: [],
        why: "Running the instructed check and ruling on its result is the work. No token.",
      },
      "layer-availability declaration — whether the findings prose says the marketplace layer could not be completed": {
        class: "mechanical:code-extracted", tokens: ["declared_unavailable"],
        why: "The half ledger's gap rows already decide it — #554's whole argument, and the R5 MERIDIAN THISTLE terminal is the case where the phrase out-ranked the machine record on a complete grid.",
      },
      "final return — the absolute output path plus a 2-3 line summary": {
        class: "mechanical:pre-bound", tokens: [],
        why: "The path is `out: (P, half) => P.commonLawHalf(half)`, interpolated by the driver. No token speaks about the return message.",
      },
    },
    message: ({ paths: P, axis: half, job, profile, intakeAsks }) => {
      const systemScope = marketplaceScopeDirective(scopeTerritories(job, profile));
      // ── — THE MEANING SEAT. Its whole dispatch is the meaning work. ─────────────────────────
      // Measured across 14 preserved clearance runs, the grid half that also owned the sweep refused
      // its first attempt on 13 of 14 — while spending LESS wall than its sibling on three of them and
      // ruling zero of 61 rows. That is not a seat running out of capacity; it is a seat asked to do two
      // unlike jobs in one turn and finishing the one with a visible end. This message gives it one job.
      //
      // No grid dictate, no findings-file structure, no negative-results matrix: it swept no cells, and
      // asking for those sections would be demanding ceremony a seat has no material for — which is how
      // a floor teaches a model to fabricate rows to pass it.
      if (half === MEANING_SEAT) return lines(
        reads(["skills/prelim-common-law/SKILL.md"]),
        `Inputs: variant manifest ${P.variantManifest}; matter frame ${P.matterContext}.`,
        systemScope,
        `You own this matter's MEANING SWEEP and nothing else. Two sibling members are running the marketplace grid concurrently and the driver merges all three in code — do NOT sweep marketplaces, do NOT judge listings, and do NOT widen beyond your dictated queries.`,
        `Run the sweep via the DETERMINISTIC grid: call perplexity_research with enable_sandbox:true and grid_spec_path: ${P.gridSpecHalf(half)}. Your spec carries the dictated meaning queries and NO term x platform cells. The tool runs exactly those queries and WRITES your ledger to ${P.commonLawGridHalf(half)} itself.`,
        `Do NOT author the grid program, do NOT save ${P.commonLawGridHalf(half)} yourself, and do NOT re-emit the ledger JSON in your message.`,
        // The MEANING seat always owns meaning queries — that is what it is for — so the may-own-nothing
        // sentence is FALSE here. It used to be served anyway, because the option was keyed on being a
        // half rather than on the obligations.
        meaningSweepReceiptsInstruction({ lead: "MEANING-SWEEP RECEIPTS — THIS IS THE WORK.", findingsTail: false }),
        `Then write ${P.commonLawHalf(half)}: a short report of the sweep under a "Findings" heading — every LOADED reading as its own finding, with the receipt behind it — and an "Audit trail" section saying which queries ran and what each returned. The driver renders the disposition TABLE from your recorded rulings, so do not hand-write that table.`,
        writeReturn(P.commonLawHalf(half)),
      );
      // Instructed checks are receipts executed ONCE per run — half "a" is the designated owner (the
      // merge carries its receipts into the canonical findings; duplicating them on both halves would
      // double-execute and double-report the same ask).
      const ownedAsks = half === "a" ? (intakeAsks ?? []).filter((a) => a.owner === "common-law") : [];
      const asksBlock = ownedAsks.length ? lines(
        `INSTRUCTED CHECKS (the requester explicitly asked for these; THIS stage owns them — EXECUTE each as part of the sweep and record its receipt in the findings file, or state honestly why it could not run):`,
        ...ownedAsks.map((a, i) => `  ${i + 1}. "${a.ask}"`),
      ) : "";
      return lines(
        reads(["skills/prelim-common-law/SKILL.md"]),
        `Inputs: variant manifest ${P.variantManifest}; matter frame ${P.matterContext}.`,
        systemScope,
        asksBlock,
        `You are running ONE HALF of this matter's marketplace grid — a sibling member runs the other half concurrently, and the driver merges the two in code. Cover ONLY your half's dictated terms; never widen to terms outside your spec.`,
        `Run your half of the sweep via the DETERMINISTIC grid: call perplexity_research with enable_sandbox:true and grid_spec_path: ${P.gridSpecHalf(half)}. The tool runs EXACTLY your half's dictated term × platform grid and WRITES this half's complete ledger to ${P.commonLawGridHalf(half)} itself.`,
        `Do NOT author the grid program, do NOT save ${P.commonLawGridHalf(half)} yourself, and do NOT re-emit the grid JSON in your message (re-emitting is exactly what truncated/dropped cells before). The tool returns only the candidate hits that need judgment.`,
        `Judge each returned candidate into the fixed taxonomy and write your findings file to ${P.commonLawHalf(half)} with its Findings, Negative-results matrix, Coverage ledger, and Audit trail sections. The driver validates grid completeness from the ledger the tool wrote — never from your prose.`,
        // P2-C (Round-2 §8b leg 2) — the SAME dictate the single-member message carries, half-scoped
        // (2026-07-31 review round): under the split THIS seat writes the PR section, so leaving the
        // obligation to skill prose here is exactly the "prose-only contracts get skipped under output
        // pressure" failure mode the disposition gate exists to close — and the miss would otherwise
        // surface only at the code-side merge, where no model turn can see the remedy. The half validator
        // joins these rows against THIS half's own recorded receipts (validators.commonLawHalf).
        // — THE SEAT DOES NOT AUTHOR THIS FILE, SO NO SHAPE IS DICTATED HERE. replaced the
        // retyped title with an id and left the seat authoring the JSON — which still meant typing the
        // query verbatim, and one unrecognised row still discarded the whole artifact (19 of 20 receipts
        // correctly ruled, thrown away, on the terminal production run of 2026-08-06). The driver writes
        // the form now. The JSON schema that used to sit here was one of THREE copies of one shape bound
        // by nothing — the other two were in the tool result and the rendered skill — and all three are
        // gone with it.
        // a and b sweep the marketplace grid; a half of it can legitimately carry no meaning queries, and
        // the seat must be told that recording nothing is then the right outcome.
        meaningSweepReceiptsInstruction({ mayOwnNoQueries: true }),
        CROSS_CHECK_HANDOFF,
        writeReturn(P.commonLawHalf(half)),
      );
    },
  },

  // register UNIT — parameterized by axis (model/thinking come from axisTier()).
  // reads the shared spine (SKILL.md) + unit.md (MODE A); never digest.md.
  "register-unit": {
    // 2026-06-24 (perf): hard wall 1200→1500, stall 900→1100 — the stage that timed out (NOVA PULSE/VELTRIPHEN).
    // The kills were code:137 at wall 1260s/1860s = the HARD timeout (timeoutSec+60), NOT the 900s stall. The
    // real fix is the in-class scoping (unit.md) + the 600 enumerate ceiling, which cap the silent page-loop to
    // ~seconds; this is a safety margin only. stallSec stays < timeoutSec so a true silent wedge still trips.
    timeoutSec: 1500, stallSec: 1100,
    skillReads: ["skills/prelim-register/SKILL.md", "skills/prelim-register/unit.md"],
    out: (P, axis) => P.registerUnit(axis),
    validate: validators.registerUnit,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "execute the frozen plan — ONE register_execute_plan call with {plan_path, axis, output_path}": {
        class: "mechanical:tool-written", tokens: ["named_band_missing", "tool_timeout"],
        why: "All three args are driver values interpolated into the message; the tool writes every band block. #850 calls this already right. Note #793: `named_band_missing` and `tool_timeout` are one evidence state with two causes, and registerPlanCallKilled (verify.mjs:1265) separates them from the call log, not from the model. [citation unverified]",
      },
      "the dictated entry list — qid, predicate, terms, owner, nice_classes, regions, when-guard, expected_kind, covered_by": {
        class: "mechanical:pre-bound", tokens: [],
        why: "Printed from _driver/register-plan.json purely so judgment knows what is covered; the executor reads the same file. The model returns nothing against it and no token speaks about it.",
      },
      "supplemental proposals — WHICH queries the manifest/frame warrant beyond the dictated set": {
        class: "judgment", tokens: [],
        why: "#850 keeps it, and it is the one element of this stage nothing else can supply. It has NO validator token: registerUnit never asks whether a proposal was made, so a unit that proposes nothing on a plan-covered axis passes. Naming the gap rather than inventing a token.",
      },
      "proposal class scoping — pass nice_classes:[...] AND in_scope_classes:[...] on every proposal/call": {
        class: "mechanical:pre-bound", tokens: [],
        why: "The driver holds job.classes, prints the array, then asks the model to retype it into two fields of every tool call. matter-frame's defect in tool-argument form; the executor could stamp it from the plan contract. No validator token — the tool refuses an unscoped proposal, which is why this never surfaced. The table does not name it.",
      },
      "proposal `romanization` beside a single non-Latin term — plain-ASCII Latin form, space-separated syllables": {
        class: "judgment", tokens: [],
        why: "#850 keeps romanization at prelim-variants as a language judgment and I hold the same line here. Recorded for E7: where the proposed term is a manifest translit variant, variant-manifest.json already carries its romanization, so that subset is code-extractable. No token at this stage.",
      },
      "proposal envelope — predicate enum {exact, default, wildcard, phonetic, owner}, term vs terms, rationale": {
        class: "mechanical:tool-written", tokens: [],
        why: "#850: tool-written envelope, model supplies values only. A literal JSON skeleton in a stage message is the E3 class. register_propose_supplemental mints the qid'd entry; no registerUnit token speaks about the envelope.",
      },
      "named-band block envelope — {state: enumerated|incomplete, query, total_hits, records|fetched+sample+reason}": {
        class: "mechanical:tool-written", tokens: ["named_band_unparseable", "named_band_block_invalid", "named_band_state_invalid", "band_block_unplanned", "named_band_invalid"],
        why: "#850: M (envelope), tool-written blocks. `band_block_unplanned` (verify.mjs:1297) is the backstop that kills a hand-authored qid-less block — a token that exists only because the legacy lane still offers the duty in the same message. [citation unverified]",
      },
      "enumerated block records carried verbatim — record_id, mark_text, classes, status, owner_name, owner_country, application_date, registration_date, expiry_date, jurisdictions, screen_verdict": {
        class: "mechanical:tool-written", tokens: ["named_band_collapsed"],
        why: "register_enumerate already returns each record batch-screened; carrying it is transcription. `named_band_collapsed` (verify.mjs:1283, findCollapsedBands) is exactly the recall loss that transcription produces — a slice claiming total_hits with zero records reaching the band. [citation unverified]",
      },
      "per-axis prose digest — the SHORT AUDIT NOTE at register-units/<axis>.md": {
        class: "judgment", tokens: ["too_short"],
        why: "#850 rules the per-axis prose digest J (keep) and I do not re-litigate. The only arm that speaks about it is nonEmpty at 40 or 80 chars, in validators.registerUnit — the branch reading `return /not applicable|n\\/a|no .*(hits|results)/i.test(c) ? nonEmpty(c, 40) : nonEmpty(c, 80)`. CONVERTED at tracker issue 1893 and the ruling STANDS: the judgment half — is this axis a null result, and the one observation the counts cannot carry — is still the seat's, sent as values through `record_unit_note`. What left is the part that was never judgment: the three COUNTS (queries enumerated, incomplete blocks, records carried forward) are aggregates over the tool-written band, so the driver derives them and the note cannot disagree with the material it describes. The floor is checked at the call now as well as by the validator, so a short note surfaces as a refusal the seat can act on rather than as a stage failure.",
      },
      "escalation judgement — the CROWD BOUND: attempt each dangerous-category slice once class-scoped, gate on the RESULT, stop terminal on a crowd, and write a block only for the distinctive anchor": {
        class: "judgment", tokens: [],
        why: "#850 keeps escalation judgement. Which slice is the distinctive anchor and which is a stripped common component is a materiality read the driver cannot make. No validator token speaks about it.",
      },
      "axis applicability — decide the axis has no work in this manifest and write a one-line \"not applicable\" band block": {
        class: "judgment", tokens: ["band_block_unplanned"],
        why: "The applicability call is the model's; the block is not. Under the supplemental lane a seat obeying unit.md:89-91 writes exactly the qid-less block verify.mjs:1297 kills. The skill file and the stage message contradict each other on the one path the skill offers for an empty axis. [citation unverified]",
      },
      "reading the band back and judging it — keep proposing until the axis's dangerous named band is covered": {
        class: "judgment", tokens: [],
        why: "Sufficiency of coverage against the manifest is the model's read. No token: registerUnit checks the band parses, never that it is complete (fan-in in pipeline.mjs is a different gate).",
      },
      "recall carry-or-justify — for each prior-confirmed conflict, a reasoned drop row written over the fetched record (primary-sweep only)": {
        class: "judgment", tokens: [],
        why: "The drop reasoning is judgment; the conflict list beside it is pre-bound (the driver holds recallDirectives and the plan's recall-* probes). No registerUnit token — the recall tripwire lives downstream.",
      },
      "layer-execution declaration — whether the prose says the register layer / provider tools were not executed or not bound": {
        class: "mechanical:code-extracted", tokens: ["declared_not_executed"],
        why: "_driver/plan-execution.json and the tool-call log already hold whether the call ran — registerPlanCallKilled (verify.mjs:1265) reads exactly that to settle the same question one arm below. This arm still decides it from the model's sentence. [citation unverified]",
      },
      "`CROSS-CHECK REQUIRED: <what> — <why>` — the check that is needed and why": {
        class: "judgment", tokens: [],
        why: "#850: content J. No validator token.",
      },
      "`CROSS-CHECK REQUIRED:` exact line shape — prefix, em-dash, mark in CAPS, own line": {
        class: "mechanical:code-rendered", tokens: [],
        why: "#850: M (shape) — typed row, code renders. E3 class; no token.",
      },
      "final return — the absolute output path plus queries-enumerated count, incomplete-block count, records carried forward": {
        class: "mechanical:code-extracted", tokens: [],
        why: "The path is `out: (P, axis) => P.registerUnit(axis)`, pre-bound by the driver; all three counts are aggregates over the band the tool wrote. No token speaks about the return message.",
      },
    },
    message: ({ paths: P, axis, job, registerPlan, recallDirectives }) => {
    // Lever-1 data plane (2026-06-24): hand the funnel a COPYABLE in-scope Nice-class array. The NOVA PULSE timeout
    // proved skill prose alone is not enough — the funnel HAD [9,28,41,42] in matter-context and still ran
    // all-class enumerations (10k-record flood) because nice_classes read as optional. Pin it in the task.
    const inScope = Array.isArray(job?.classes) && job.classes.length ? job.classes.map(String).join(", ") : null;
    // WS2 (B4) — in plan mode the frozen register plan DICTATES this axis's calls (the model
    // reasoned once at variants time; the funnel executes, it never re-improvises the queries — THE
    // F2 fix). Band blocks carry the qid so fan-in identity-joins plan⇄band. Legacy (no plan): the
    // manifest-driven message below, unchanged.
    const planEntries = (registerPlan?.entries ?? []).filter((e) => e.axis === axis);
    // ION/copper-foundry 2026-07-22: the lane is a property of the PLAN's contract, so it governs the
    // whole message — the tool exclusion in pipeline.mjs keys on exactly this and nothing else. Read it
    // once here so no branch below can drift out of step with what the model can actually call.
    const supplementalLane = !!registerPlan?.contract?.supplemental_lane;
    return lines(
      `First, read and follow exactly: skills/prelim-register/SKILL.md (the shared spine) then skills/prelim-register/unit.md (MODE A — UNIT). Do NOT read digest.md (digest-mode judgment a unit must never run).`,
      // WHAT THE KEY ALSO CARRIES — COMPOSED, NOT DOCTRINE ( /).
      // `unit.md` used to name three tools flat, and on a deployment withholding two of them the seat was
      // told it holds tools its grant does not carry. The composer derives the list from the same table
      // that does the excluding, and returns NULL — not an empty sentence — when the provider cannot be
      // resolved, which is the path `--experiment` takes.
      grantVocabularySentence(),
      `You are register UNIT mode, axis = "${axis}". Active register provider: ${PROVIDER_META.label}.`
      // A provider with no vocabulary doc is a provider this seat cannot be briefed on. Emitting the
      // sentence with a null path in it would instruct the model to read a file that does not exist,
      // which it resolves by carrying on unbriefed — indistinguishable from choosing not to read.
      + (PROVIDER_META.skillDoc
        // "(EUIPO = free EU cross-check, available alongside)" used to sit at the end of this sentence.
        // It described the credential-blind attach, which is gone: EUIPO is a register PROVIDER
        // now, so when it is active it IS `${PROVIDER_META.label}` and there is nothing "alongside".
        // Leaving the clause in would tell every unit on every vendor that a second EU source was
        // available to it, and a unit that believes it has a cross-check it does not have will report
        // agreement it never obtained.
        ? ` Read and follow ${PROVIDER_META.skillDoc} for THIS provider's exact tool names + operator vocabulary; use only that provider's register tools. There is exactly ONE register in this run — if its coverage does not reach a territory the matter needs, that is a DEFERRED coverage row you disclose, never a gap you fill from somewhere else.`
        : " NO provider vocabulary doc is registered for it, so there is nothing to read for its tool names — treat that as a fault and say so rather than improvising an operator vocabulary."),
      `Inputs: variant manifest ${P.variantManifest}; matter frame ${P.matterContext}.`,
      // spec 64 (B2) — recall context: the plan carries deterministic recall-* probes re-fetching the
      // mark's prior-confirmed conflicts; the funnel writes its drop reasoning OVER the fetched record,
      // never cold (the recall tripwire demands carried-or-justified for each remembered conflict).
      (axis === "primary-sweep" && (recallDirectives?.length))
        ? `PRIOR-CONFIRMED CONFLICTS (recall context): earlier delivered runs of this mark confirmed live conflicts — ${[...new Set(recallDirectives.map((d) => d.mark_text).filter(Boolean))].slice(0, 10).join(", ")} — and the dictated plan carries "recall-*" probes re-fetching them. If a probe's record surfaces and your judgment DROPS it, write the reasoned drop row over the fetched record (never silence): each remembered conflict must be carried as a finding or reasoned away.`
        : "",
      planEntries.length
        ? lines(
            // (2026-07-03, the senior lawyer): the TOOL executes the plan — the model never runs
            // dictated entries by hand and never re-types results (the transcription defect class
            // dies at the source, the deterministic-grid precedent). The entry list stays in the
            // message for transparency and so judgment knows what is already covered.
            `EXECUTE THE FROZEN PLAN VIA THE TOOL: call register_execute_plan ONCE with {"plan_path": "${P.registerPlan}", "axis": "${axis}", "output_path": "${P.registerBand(axis)}"}. The tool runs every dictated entry below ITSELF (paged enumerates; count-only crowd descriptors; a "when"-guarded fringe only if its parent enumerated) and WRITES the band file itself with each block's qid stamped. Do NOT run these dictated entries manually and do NOT write their blocks yourself.`,
            `For your audit context, the dictated entries the tool will run:`,
            ...planEntries.map((e) => `- qid "${e.qid}": ${e.predicate} ${e.terms ? `names ${JSON.stringify(e.terms)} (one OR-stacked call)` : JSON.stringify(e.term)}${e.owner ? ` · owner ${JSON.stringify(e.owner)}` : ""} · nice_classes ${JSON.stringify(e.nice_classes)}${e.regions?.length ? ` · regions ${JSON.stringify(e.regions)}` : ""}${e.when ? ` · when: "${e.when.runs_if_enumerated}" enumerated` : ""} · expected: ${e.expected_kind}${Array.isArray(e.covered_by) && e.covered_by.length ? ` · crowd context — coverage is ${e.covered_by.join(", ")}` : ""}`),
            // copper-lattice re-route (supplemental_lane contract): judgment additions stay the model's
            // CALL — which queries the manifest/frame warrant beyond the dictated set — but their
            // EXECUTION and their band blocks are code's (register_propose_supplemental mints qid'd
            // entries, runs them through the same executor, merges the band itself, and returns the
            // results read back from the band). The old lane — free register_enumerate calls +
            // hand-appended qid-less blocks — is where a SIGKILLed pass's false 0/clean shipped
            // (2026-07-08); a plan without the contract flag (a frozen pre-flag resume) keeps that
            // lane verbatim in the else-branch below, J1a state enum included.
          )
        : "",
      // The ADDITIONS instruction — how this unit runs coverage that the frozen plan did not dictate.
      //
      // ION/copper-foundry 2026-07-22: this used to live INSIDE the `planEntries.length` branch above,
      // so an axis the plan dictated NOTHING for was told only "Run THIS axis's searches per the
      // manifest" — while pipeline.mjs had already stripped register_enumerate from its toolset (the
      // exclusion is contract-gated, this instruction was entries-gated). The ban shipped without its
      // replacement, and the class-scoping lines below still said "pin EVERY register_enumerate". ION's
      // incumbent-class axis had zero dictated entries: the unit reached for the tool the message named,
      // found it absent, reported `register_enumerate` "permission-blocked … across every retry" — a
      // FALSE tool-outage line in a delivered report — and fell back to count-only register_search.
      // That fallback reviewed 10 of Apple's 432 hits, 10 of Amazon's 225, 10 of Microsoft's 114 —
      // those owner queries effectively unscreened. Enforcement needs matching
      // invitation control — whatever forbids the old path must also, in the same breath, name the new one.
      supplementalLane
        ? `JUDGMENT ADDITIONS${planEntries.length ? " beyond the dictated plan" : ""} are yours to PROPOSE — call register_propose_supplemental with {"axis": "${axis}", "output_path": "${P.registerBand(axis)}", "proposals": [{"predicate": "exact|default|wildcard|phonetic|owner", "term" OR "terms", "romanization" (MANDATORY beside a single non-Latin term — its plain-ASCII Latin form, space-separated syllables; a register that indexes filings by transliteration cannot answer bare characters), "nice_classes": […], "rationale": "why"} …]} for everything the manifest/frame warrants${planEntries.length ? " beyond the dictated set" : " on this axis"}. Batch related proposals into one call; iterate freely — propose, read the returned counts/term_counts/record previews, propose narrower. The tool mints each proposal as a qid'd supplemental entry, executes it through the SAME deterministic executor as the dictated plan, and MERGES its block into the band ITSELF. ${SUPPLEMENTAL_LANE_STEERING} You NEVER write or edit band blocks yourself — a hand-authored band block fails the stage. Never edit or remove a qid-stamped block.`
        : `JUDGMENT ADDITIONS${planEntries.length ? " beyond the dictated plan" : ""} are yours — run register_enumerate calls for everything the manifest/frame warrants${planEntries.length ? " beyond the dictated set" : " on this axis"} and APPEND each as a block WITHOUT a qid to ${P.registerBand(axis)} (the tool's merge preserves them on any re-run). Never edit or remove a qid-stamped block. Every block you append MUST carry "state":"enumerated" (ONLY if you paged it to has_more:false) or "state":"incomplete" — EXACTLY those two strings; there is no "verified"/"checked"/"complete"/"clean" state, and any other value fails the stage.`,
      // Owner-axis steering rides the lane only: off-lane the unit still has register_enumerate, so the
      // proposal grammar this text is about does not apply to it.
      supplementalLane ? OWNER_SWEEP_STEERING : "",
      planEntries.length ? "" : `This axis carries NO dictated plan entries: the whole axis is yours to cover by ${supplementalLane ? "proposal" : "enumeration"} per the manifest/frame. "No entries" means the plan had nothing to freeze here — it does NOT mean the axis is out of scope, and it is never a reason to leave it thin.`,
      // Lever-1 (2026-06-24): EVERY register_enumerate MUST be class-scoped, or it returns an all-45-class crowd
      // that floods the band and TIMES OUT the stage. Scoping by class = which Nice classes the matter instructed
      // = BREADTH (region/variant/match-mode are the breadth dials); it is NOT sampling/sufficiency.
      // ION/copper-foundry: these lines name the tool the unit is expected to class-scope, so they MUST
      // follow the lane too — naming register_enumerate to a unit that cannot call it is what taught ION's
      // incumbent-class pass that the tool was broken.
      inScope
        ? `IN-SCOPE NICE CLASSES = [${inScope}]. Pin EVERY ${supplementalLane ? "proposal" : "register_enumerate"} to these — pass nice_classes:[${inScope}] AND in_scope_classes:[${inScope}] on every ${supplementalLane ? "proposal" : "call"}. ${supplementalLane ? "A proposal" : "An enumerate"} WITHOUT nice_classes (all-class default / starts_with / ends_with / phonetic / fuzzy) is FORBIDDEN: it pulls an all-45-class crowd that floods the band and times the stage out — it is not breadth. A bare saturated element with no class filter is a COUNT-ONLY descriptor (register_search limit:1), never enumerated. ONLY exception: the exact-IDENTICAL cross-class merch check (nice_classes:[25], match_mode:exact).`
        : `Pin EVERY ${supplementalLane ? "proposal" : "register_enumerate"} to the matter's in-scope Nice classes (from the matter frame) via nice_classes — an unscoped all-class ${supplementalLane ? "proposal" : "enumerate"} is FORBIDDEN (it floods the band + times out the stage). Only exception: the exact-identical cross-class merch check (nice_classes:[25]).`,
      // CROWD BOUND (, a REMOVAL): gate the dangerous-category substring enumeration on the class-scoped
      // RESULT (tractable vs crowd), not the manifest label — a slice that returns a crowd is terminal (stop the
      // per-major/phonetic fan-out). On a crowd, WRITE a block only for the distinctive anchor (material); for a
      // stripped common component (GREAT/OUTDOORS) write none — saturation-probe already counted it (immaterial).
      // This removes the primary-sweep grind that double-SIGKILLed The Wide Open. Boundary held: the funnel
      // counts + hands up; it never writes coverage-limited and never drives CONDITIONAL (judgment's call, Layer B).
      `CROWD BOUND (removal — prevents the primary-sweep timeout, spec-46): every dangerous-category substring slice (the dominant token / formative root as a contains predicate + its per-major + phonetic slices) is attempted ONCE class-scoped and gated on its RESULT, not on the manifest label. Returns enumerated (tractable — NOVA PULSE∩class≈257, the phrase "WIDE OPEN"≈99) → keep it + run its per-major / phonetic. Returns incomplete because the slice is ITSELF a crowd over the ceiling (a hyper-common word — GREAT≈28k, OUTDOORS≈2.7k) → TERMINAL: STOP, do NOT fan it out per-major and do NOT phonetic-fringe it (that grind double-SIGKILLed the stage). On a crowd slice, WHAT you write depends which slice it is: the DISTINCTIVE anchor / dominant category → write ONE incomplete block (a material could-not-finish for judgment); a stripped COMMON component (GREAT/OUTDOORS — NOT the anchor) → write NO block, the saturation-probe axis already counted it (immaterial dilution; a duplicate primary-sweep crowd risks mis-reading as a material in-class gap). For an all-common-words phrase mark ("The Wide Open" — dominant unit = the phrase), the exact phrase + near-neighbours IS the dangerous band; the common-word components are dilution counts. The funnel counts + hands up; it never writes coverage-limited and never drives CONDITIONAL — materiality is judgment's call (Layer B).`,
      // judgment-relocation (2026-06-23): the funnel ENUMERATES or reports HONEST INCOMPLETENESS — it decides
      // NOTHING about relevance or sufficiency. For the DANGEROUS NAMED BAND (the exact mark + each manifest
      // variant × in-scope class × material/major jurisdiction) you MUST use register_enumerate, which owns the
      // page loop and CANNOT return a partial list — it returns {state:"enumerated", …records} (paged to
      // has_more:false) OR {state:"incomplete", total_hits, fetched, sample, reason} (a crowd over the ceiling /
      // provider window / a provider error). There is NO "good enough" / top-N / "narrow-to-tractable" verb here:
      // a band is either ENUMERATED or INCOMPLETE. For a SATURATION crowd (a count-only context probe — never the
      // named band) use a count-only descriptor; never enumerate it. Do NOT screen the noise pile.
      // ION/copper-foundry: the third lane contradiction in this message. Under the supplemental lane the
      // TOOLS write every band block (qid-stamped) and a hand-authored one FAILS the stage
      // (band_block_unplanned) — so telling the model to "write the COMPLETE NAMED BAND … one block per
      // register_enumerate call" ordered precisely the thing the validator kills, using a tool it does not
      // have. ION's incumbent-class band carries ten qid-less blocks written exactly that way.
      supplementalLane
        ? `BAND ARTIFACT: the band ${P.registerBand(axis)} is written BY THE TOOLS — register_execute_plan for the dictated entries, register_propose_supplemental for your proposals — with every block qid-stamped. You NEVER author, edit or append a band block: a hand-written block fails the stage. Your job is to READ the band back and judge it, and to keep proposing until this axis's dangerous named band (the exact mark + each manifest variant × in-scope class × material/major jurisdiction) is covered. Every block the tools write is either {"state":"enumerated", …records} (paged to has_more:false) or {"state":"incomplete", total_hits, fetched, sample, reason} (a crowd over the ceiling / the provider window / a provider error). There is no "good enough" / top-N / narrow-to-tractable verb: a band is ENUMERATED or INCOMPLETE. If a slice is not covered, PROPOSE it — never sample it yourself with register_search and never record a sample as though it were a band. The band is the real material the lawyer reads: an unenumerable band is an HONEST "incomplete" descriptor, NEVER a clean negative.`
        : `BAND ARTIFACT (MANDATORY): ALSO write the COMPLETE NAMED BAND for this axis to ${P.registerBand(axis)} — a JSON ARRAY, one block per register_enumerate / count-probe call, in the named-band contract: {"state":"enumerated","query":"<what was searched>","total_hits":N,"records":[{record_id, mark_text, classes, status, owner_name, owner_country, application_date, registration_date, expiry_date, jurisdictions, screen_verdict}, …]} for a band you paged to has_more:false (carry EVERY enumerated record, with its screening facts — live AND recently-dead, with the status/lapse-date; status is surfaced, never date-cut), and {"state":"incomplete","query":"…","total_hits":N,"fetched":K,"sample":[…],"reason":"…"} for any band/crowd you could NOT enumerate to completion (genuinely too large, hit the provider window, a provider error). The band is the real material the lawyer reads — a missing/sampled enumerated record is a recall hole; an unenumerable band is an HONEST "incomplete" descriptor, NEVER a clean negative.`,
      // judgment-relocation (2026-06-24): the funnel writes NO coverage ledger and NO clearance verdict — the
      // band IS the coverage signal (Layer B reads it and authors the ledger). The .md is a SHORT prose audit
      // note only (what you searched, counts) — it is gated for existence, but the BAND is the load-bearing
      // artifact (the driver hard-fails fan-in if the band is missing).
      //
      // CONVERTED: the note is a typed call and the driver writes it. What made this
      // stage worth converting is not the prose — it is that all three of the counts the note stated are
      // AGGREGATES OVER THE BAND, and the band is written by the tools and already forbidden to the seat.
      // A seat-typed count beside a tool-written band is two authorings of one fact, and the failure mode
      // is the quiet one: the note says nine enumerated queries, the band holds eight, and nothing compares
      // them. Deriving removes the disagreement rather than detecting it.
      `FILE THIS AXIS'S AUDIT NOTE WITH \`record_unit_note\`. THE DISPATCH NAMES NO PATH FOR IT, deliberately — the driver writes this axis's note from what you send and you never open it, so there is no path here for you to hold. THE COUNTS ARE NOT YOURS TO TYPE: queries enumerated, incomplete blocks and records carried forward are taken from the band, so the note and the band cannot disagree. Send only what the band cannot say — \`null_result\` if this axis genuinely found nothing (refused against a band that carries records), and \`note\`, ONE short observation an auditor would want, in a lawyer's words. Still NO coverage-limited/confirmed-clean/deferred rows and NO clearance verdict: those are judgment's, Layer B. Call it AFTER the band exists — a note over a band that has not been written is refused by name, because an account of a sweep that has not happened is not a short note, it is a wrong one.`,
      CROSS_CHECK_HANDOFF,
      // THE CLOSING LINE SPLITS WITH THE LANE, because what the seat owes splits with it. Under the
      // supplemental-lane contract the seat writes NOTHING — the band is the tools' and the note is the
      // driver's — so the dispatch names no file and ends the way conversion 9's reviewer does. With the
      // lane OFF (a frozen pre-flag plan on resume, or a matter with no Nice classes, which compiles no
      // register plan at all) the branch above still orders the band by hand, and that one file is what
      // this line must name. Naming the note here after the conversion would order a hand-write of an
      // artifact the seat cannot write, which is the exact defect the agreement guard exists to catch.
      supplementalLane ? "" : writeReturn(P.registerBand(axis)),
    );
    },
  },

  "placement-inquiry": {
    // 1800s, not 600: a CROWDED band makes honest placement long — 2026-07-16 live (ZORVAPLUS cl.5/32,
    // named band 1.9MB, 540 live in-class in-scope records) killed 4 straight attempts at the 600/900s
    // hard wall (code:137, streaming healthily the whole time — the 600s stall guard never fired, so
    // these were working turns cut mid-analysis, not wedges). Same fix pattern as the gather siblings
    // (their 137-kill post-mortems above). stallSec stays 600 — a genuine silent wedge still dies fast.
    // (History: 600 was itself a bump from 300 after the v14 post-mortem burned 2 attempts.)
    //
    // — 2700, and the number is the LADDER'S OWN ARITHMETIC, not a judgement about how long a model
    // should take. 2026-08-09 R1, from _driver/placement-inquiry.jsonl:
    //     att1  wall 1860.664  budget 1800  status timeout  hardWall  wrote:true  quiescentMs 371177
    //     att2  wall 1844.05   budget 2700  status ok
    // runStage's hard-wall arm already grants exactly `timeoutSec * 1.5` = 2700 on the retry, and the
    // retry finished in 1844 s. So the run paid 1860 s to discover a budget the code was always willing
    // to give, then paid it again — 62 minutes for one stage on a 192-minute run against a 120 benchmark,
    // and placement-inquiry was the LARGEST stage on all four of that round's clearances. Setting the
    // first budget to the one the second attempt would get costs nothing a walled retry did not already
    // cost, and stallSec stays 600 so a genuinely silent wedge still dies in ten minutes.
    //
    // THIS IS NOT THE FIX, AND MUST NOT BE READ AS ONE. It makes the discard less likely; it does not make
    // finished work survivable. Attempt 1 had WRITTEN a complete placement-recommendations.md and lain
    // quiescent for 371 s against a 60 s bar — the wall rescue looked and refused, because
    // validators.placement fails `placementmodel_missing` when the structured sibling placements.json is
    // absent, and the seat writes the prose first (on that run: md at 09:08:58, json at 09:15:50 by
    // attempt 2). The real cure is the driver-written placement form — placements.json rendered by the
    // driver from a form the seat only fills tiers into, on the / union pattern, which makes
    // partial progress survive a kill. That is its own build issue and its own review.
    model: "opus", thinking: "high", timeoutSec: 2700, stallSec: 600,
    // B2 — evidence of PROMPT VINTAGE for validators.placement's structured-sibling floor (the
    // recordStageContract pattern): written at DISPATCH only, so archived/pre-B2 artifacts keep
    // validating under the rules they were minted under and replay verdicts never flip.
    // — `placementForm: 1` joins it rather than replacing it. Under the form era placements.json is
    // DRIVER-RENDERED from the accumulator, so validators.placement must stop demanding it from the seat;
    // archived runs carry the old key alone and keep validating under the rules they were minted under.
    contract: { structuredPlacements: 1, placementForm: 1 },
    skillReads: ["skills/placement-inquiry/SKILL.md"],
    out: (P) => P.placement,
    // — `outSibs: [P.placementModel]` is DELETED, and the premise is retired rather than overruled.
    // It existed because a FORCED re-run that rewrote the md but not the JSON would leave the previous
    // pass's tiers on disk, so the JSON was snapshotted and REMOVED before every dispatch. placements.json
    // is now rendered by the driver from a form that is regenerated against the current fold on every
    // pass, so a stale-tier file is unreachable: there is no seat write to miss. Removing it also removes
    // the R1 incident's own trigger — the destructive step ran, the seat wrote its prose, the wall killed
    // the turn in the gap, and the wall rescue then refused because the JSON the driver had just deleted
    // was absent.
    validate: validators.placement,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "tier — EXACTLY one of headline-candidate / sheet-2 / watchlist-annex / out-of-scope-filtered, per placed candidate": {
        class: "judgment", tokens: ["placement_tier_invalid", "missing"],
        why: "The answer to 'does this conflict change the advice, or only complete the record?' No artifact on disk holds it — the band supplies records, never a deliverable position. #850 keeps it J.",
      },
      "reason — the short paragraph carrying the stated ground for the tier (owner characterisation, customer/channel read, decisive ground, Stage-2 mitigant)": {
        class: "judgment", tokens: ["placement_reason_missing", "placement_reason_bare"],
        why: "Four downstream stages adopt or counter-reason BY ARGUING WITH THIS TEXT (stages.mjs:2485-2489). It is authored reasoning, not a value any artifact holds. [citation unverified]",
      },
      "borderline: true — the declaration that the promotion question could be argued either way on this record": {
        class: "judgment", tokens: ["placement_borderline_invalid"],
        why: "A statement about the seat's own confidence in its own call. Nothing computes it. (placement_borderline_invalid polices only the TYPE — boolean — which is the envelope, not the call.)",
      },
      "select — one record URI of the register candidate being placed": {
        class: "mechanical:code-extracted", tokens: [],
        why: "buildSelectionIndex() in placement-form.mjs already holds every selectable record, built from _driver/register-positions.json plus the band shape's floors, and resolves any URI of a family to the canonical row. #850 M1: the model should return the 1-based index into that driver-written list; code resolves index→id. WHICH candidate to place stays judgment — the row existing at all is the judgment; only the pointing token is mechanical. NO VALIDATOR TOKEN speaks about it: an unresolved select is recorded on the form as `unresolved[]` (placement-union.mjs:134) and handed back in the next dispatch, never a fail. [citation unverified]",
      },
      "seat rows for candidates the register does not hold — mark / owner / jurisdiction / records: [] written in full": {
        class: "judgment", tokens: ["placement_mark_missing", "placement_owner_missing", "placement_jurisdiction_invalid", "placement_records_invalid"],
        why: "There is nothing on disk to select — the register does not hold the candidate, so the seat writes the row. #850 keeps it J for exactly that reason.",
      },
      "the rulings tail prose — Band reconciliation, Disagreements / flags surfaced to downstream, Coverage rulings & open questions, Open questions for the client / reviewer": {
        class: "judgment", tokens: ["too_short"],
        why: "Cross-candidate reasoning about the band as a whole, plus the cleared/material-gap materiality calls. #850 keeps it J.",
      },
      "the identifier half of each `cleared:` / `material-gap:` line — the axis, the named slice and its count": {
        class: "mechanical:code-extracted", tokens: [],
        why: "The band's `incomplete` crowd descriptor carries query, total_hits, fetched and reason, and the driver already writes one coverage-form row per unaccounted crowd block with the qid, hit count and unaccounted classes/terms computed (coverage-form.mjs; digest.md:196-201). The MATERIALITY CALL is judgment and stays in the element above; the descriptor's identity and count are transcription of the driver's own numbers.",
      },
      "the md's four tier sections — one per-candidate entry restating that candidate's tier and reasoning": {
        class: "mechanical:code-rendered", tokens: ["missing", "too_short"],
        why: "Since #562 the form carries tier + reason as data and the driver renders placements.json from it (renderPlacementsJson() in placement-form.mjs). The md's tier sections are a SECOND authoring of the same two fields — the E4 shape #850 names for synthesis's narrative.md/findings.json, one lane over. `missing:placement tiers` is the token that checks the md for tier words.",
      },
      "the 7-point structured inquiry trace per enumerated record (what the applicant does, customer, channels, overlap, convergence, enforcement posture, registration status)": {
        class: "judgment", tokens: [],
        why: "Commercial-relevance reasoning, written once per SURFACED CANDIDATE — not per enumerated record; this element's own key overstates it and is left alone only because that string is frozen in contract-arm2-baseline.json. Measured on delivered run ed1d7248: SIX `**Inquiry trace:**` bullets against a band of 412 enumerated records, each one compressed bullet with inline (1)…(7), 2,096 of the md's 44,131 chars — 4.7%. NO CODE PARSES IT and it carries no token, but that is not the same as having no consumer, and the previous wording here ('lands only in md prose nothing parses') invited exactly that misreading: placement-recommendations.md is dispatched as model context to register-digest, synthesis and narrative-refutation, and a reviewing lawyer reads it. Its consumer is the human audit trail. The `reason` contract forbids restating it there — see the tier-enum dispatch line's 'NEVER the full 7-point inquiry trace' (cited by its text, not a line number: the pointer this comment used to carry had drifted 756 lines and aimed at a bare brace). #1339 D2 proposed dropping the order; owner ruled DROP THE TRIM on the re-derivation: the trace is ~8 s of emission at 70 tok/s, and deleting the whole md would be 2.6-3.0 min against a claim needing 25-33, so no trim inside this artifact could ever have been the dominant term.",
      },
      "placements.json — the structured mirror, keys EXACTLY {mark, owner, jurisdiction, records, tier, reason} + optional borderline": {
        class: "mechanical:code-rendered", tokens: ["placementmodel_missing", "placements_unparseable", "placements_key_unknown", "placement_invalid", "placement_key_unknown"],
        why: "The driver renders it: renderPlacementsJson() in placement-form.mjs over the union, landed by gateway.mjs:706 (the #562 union-then-render block; re-verified 2026-08-29 — the old :507 predated this branch and pointed at the engine-resolution doc comment). The skill file was not updated with #562, so the stage's two sources contradict each other — the contract that escapes if E1 is authored against stages.mjs alone. [citation unverified]",
      },
      "mark / owner / records / territories / classes on a SELECTED row": {
        class: "mechanical:code-extracted", tokens: [],
        why: "renderEntry() in placement-form.mjs machine-copies all five from the canonical row built out of _driver/register-positions.json; SELECT_ROW_CONTRACT declared in placement-form.mjs states it in its do_not field. The driver already overwrites what the model types, which is #850's own definition of mechanical.",
      },
      "retract: <row_id> — withdrawing a seat row already on the form": {
        class: "judgment", tokens: [],
        why: "Whether a placed candidate should come off is a call only the model makes. The row_id it names is driver-assigned (shortId 'PS'/'PR', placement-form.mjs:205/273), so the HANDLE is code-assigned even though the act is judgment. [citation unverified]",
      },
      "return payload — the absolute output path plus a 2-3 line summary": {
        class: "mechanical:pre-bound", tokens: [],
        why: "The driver wrote that literal path into the same message and reads the artifact off disk at it. The matter-frame instructed-scope shape exactly: the driver knows the value, hands it over, asks for it back. Nothing consumes the summary.",
      },
    },
    message: ({ paths: P, axes, registerOnly, depth }) => lines(
      reads(["skills/placement-inquiry/SKILL.md"]),
      // lever 2 — the inquiry trace rung. Empty on a one-country run; `lines` drops it.
      inquiryRungDirective(depth),
      `Inputs: matter frame ${P.matterContext}${registerOnly ? "" : `; common-law ${P.commonLaw}`}.`,
      registerOnly ? REGISTER_ONLY_NOTE : "",
      // judgment-relocation (2026-06-23): the COMPLETE named band crosses the firewall and is the AUTHORITATIVE
      // material — place over the REAL records, not a pre-pruned per-axis prose digest (those are audit-only).
      // PR-8: read via the band tools (shape whole + logged lookups), never by slicing the raw file.
      `THE MATERIAL YOU PLACE OVER is the complete merged register band, read through the band tools. ${BAND_READING_CONTRACT}`,
      `The per-axis prose digests (${(axes ?? []).map((a) => P.registerUnit(a)).join(", ")}) are an audit summary only — where they differ from the band material the tools return, the band wins.`,
      `Place EVERY surfaced candidate at headline-candidate / sheet-2 / watchlist-annex / out-of-scope-filtered with the structured-inquiry trace.`,
      // The boundary package (2026-08-01): two runs of the same matter at identical settings disagreed on
      // 29% of shared records' tiers, and NINE IN TEN of those disagreements sat on headline vs sheet-2 —
      // a well-behaved model answering an UNDER-POSED question ("warrants the client narrative" is
      // deliverable-shaped and moves with the band; the skill also forbids this stage the risk tier its old
      // definition pointed at). One stated question, answered in writing on both sides, so a disagreement
      // is about an ANSWER the digest can adjudicate rather than an unstated feeling. Never a threshold.
      `THE HEADLINE / SHEET-2 LINE IS ONE QUESTION, ANSWERED IN WRITING ON EVERY ENTRY THAT REACHES EITHER TIER: does this conflict CHANGE THE ADVICE, or only COMPLETE THE RECORD? — i.e. would the senior lawyer signing this clearance need to discuss THIS conflict with the client before the client acts, because this owner can and plausibly would block adoption, or because resolving it changes what the client should DO (consent, scope-narrowing, a coexistence call, filing strategy)? Changes-the-advice → headline-candidate, and the entry NAMES what it changes (who blocks / what the client must decide); completes-the-record → sheet-2, and the entry states why this conflict does NOT change the advice. Not "warrants the client narrative" (that moves with the rest of the band) and NEVER a risk tier — tiering is the digest's job. If your answer could be argued either way by two competent lawyers on this record, SET "borderline": true on that entry and let the reason state both readings and which you chose: declaring a borderline is a correct professional outcome; a confident tier on a record the question does not decide is not.`,
      // B2 (charter 2026-07-31) — the tier sections travel as DATA; the rulings tail travels as PROSE.
      // Four consumers (register-digest, synthesis, narrative-refutation, report-overview) adopt or
      // counter-reason each tier BY ARGUING WITH ITS REASON — five of fourteen digest departures on the
      // measured run quoted placement's reason verbatim in order to contradict it — so the reason is the
      // load-bearing field, never the tier alone.
      // — the seat SELECTS and JUDGES; the driver COPIES and RENDERS. It no longer writes
      // placements.json at all: the driver renders that file from the accumulator on every judgement,
      // so a tier placed by an attempt that is then killed at its wall survives. The fields the seat
      // used to re-type — mark, owner, records — are machine-copied from the register's own
      // exact-identity fold, which is also why a family held across territories is ONE candidate.
      `PLACEMENT FORM (MANDATORY): record every placement in ${P.placementForm} — {"rows":[…]}, and DO NOT WRITE placements.json (the driver renders it from this form).`,
      `· A REGISTER candidate: {"select":"<one record URI it holds>","tier":"…","reason":"…"} (+ optional "borderline":true). Naming ONE record selects the whole position — a mark registered in several territories is one candidate and you tier it once. The driver fills mark, owner, records, territories and classes from the register record itself; anything you write in those fields on a selected row is ignored, so do not re-type them.`,
      `· A COMMON-LAW candidate the register does not hold: write the row in full — {"kind":"seat","mark","owner","jurisdiction","records":[],"tier","reason"}. An empty records list is correct there, never a gap.`,
      `· tier EXACTLY one of headline-candidate / sheet-2 / watchlist-annex / out-of-scope-filtered. reason = a SHORT PARAGRAPH carrying your STATED reasoning for the tier — the candidate characterisation (what the owner actually does, the customer/channel overlap read), the decisive placement ground, and any Stage-2 mitigant flag — substantial enough that a downstream stage can quote it and argue with it; NEVER a bare label, NEVER the full 7-point inquiry trace.`,
      `· The form ACCUMULATES across attempts: a row you complete stays complete even if a later pass never mentions it, so a pass that only fixes two rows writes only those two. To remove a row, hand back {"retract":"<its row_id>"} — silence never removes anything.`,
      `· The rulings tail of the md (Band reconciliation, Disagreements / flags surfaced to downstream, Coverage rulings & open questions, Open questions for the client / reviewer) is NOT mirrored into the form — it travels verbatim as prose.`,
      writeReturn(P.placement, [P.placementForm]),
    ),
  },

  // reads the shared spine (SKILL.md) + digest.md (MODE B); never unit.md.
  "register-digest": {
    // 2400s, not 1500: same crowd-bound scaling as placement-inquiry above — on the 2026-07-16
    // ZORVAPLUS band (1.9MB named band, 540 live in-class records) the PRE-escalation digest took an
    // honest 939s and the POST-escalation digest (enriched band) was killed at the 1500s hard wall
    // (code:137, streaming). stallSec stays 900 — a silent wedge still dies fast. The durable fix is
    // band-size-scaled budgets for every band-traversing stage (follow-up); this is the incident floor.
    // thinking "low" since 2026-08-01, and this is a MEASURED change, not a saving assumed:
    // a 4-arm probe on an archived band (EFFORT-PROBE-REGISTER-DIGEST-2026-07-30) ran two arms at
    // high and one at low. Fixed-effort control spread (high vs high): 1.03x wall / 1.04x output. Effort
    // difference (high vs low): 3.49x wall / 3.59x output — an effect ~85x the noise, 1,511s vs 433s.
    // Neither probe could detect an effect on the ANSWER: of a 35-record common core, 25 tiered identically
    // and the 10 that moved had a HIGH arm as the odd one out in all ten (nine of them sitting on the
    // headline/sheet-2 boundary, which is a criterion problem, not an effort one). So high was not buying
    // agreement; it was buying variance and wall. High was never validated either — it was chosen and
    // recorded, and established that --effort is a disposition, not a guarantee.
    // The comparison stays live rather than closing here: the suite runs arms via CLEAROTRON_STAGE_THINKING
    // (see thinkingFor), and last night's R1+R2 are the same-matter control at high. REVERT THIS LITERAL if
    // an arm moves a record the boundary criterion decides clearly, moves a coverage-ledger ruling, or costs
    // more digest attempts — a wall gain never offsets one of those.
    // CAVEAT the probe carries in its own words: it ran on a band trimmed 2,596 -> 300 records. The tiering
    // work is per-record, so the finding should hold at full size, but the first full-band arm is the test.
    model: "opus", thinking: "low", timeoutSec: 2400, stallSec: 900,
    skillReads: ["skills/prelim-register/SKILL.md", "skills/prelim-register/digest.md"],
    out: (P) => P.registerFindings,
    validate: validators.registerFindings,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "coverage form `status` per row — EXACTLY one bare token of confirmed-clean / coverage-limited / deferred": {
        class: "judgment", tokens: ["coverage_no_status", "coverage_clean_unexecuted", "coverage_clean_skipped", "coverage_clean_tainted"],
        why: "'Does this un-enumerated slice matter to whether I can sign' — the sufficiency call the funnel is forbidden to make (prelim-register SKILL.md, `## Coverage = the band blocks`). The obligations are driver-computed with every identifier; the status is a VALUE the seat sends through record_coverage (typed transport), validated per row at call time. #850 keeps it J.",
      },
      "coverage form `reason` per row — the sentence the lawyer reads": {
        class: "judgment", tokens: ["coverage_form_engine_vocabulary"],
        why: "Authored reasoning, sent as a value through record_coverage. digest.md (Coverage ledger section) forbids retyping any identifier into it ('Nothing joins on your typing; the driver supplies every identifier'), so what remains is pure judgment. coverage_form_engine_vocabulary polices only that the sentence does not leak engine vocabulary into client-facing prose — the tool refuses it at call time too, same predicate.",
      },
      "seat-added coverage rows — the decision to add one, and the axis it is filed under (expressed in the `unit` label)": {
        class: "judgment", tokens: ["coverage_form_axis_invalid"],
        why: "The shipped code rules it judgment in its own words: 'THE AXIS IS PART OF THE JUDGMENT, and on a SEAT row it is the one identifier the seat still supplies' and normalizeAxis 'repair[s] formatting, never invent[s] an axis' (coverage-form.mjs:519-524). The driver cannot know which axis a coverage unit it never planned belongs under. [citation unverified]",
      },
      "the seat row's duplicate `axis` cell (the same token already typed as the leading segment of `unit`)": {
        class: "mechanical:code-extracted", tokens: ["coverage_form_axis_invalid"],
        why: "seatRows() in coverage-form.mjs already calls normalizeAxis(r.axis, r.unit) and normalizeAxis() in coverage-ledger.mjs derives the axis as normalizeAxis(unit.split('/')[0], unit). The classification is stated once and typed twice; the second copy is code-extractable from the first.",
      },
      "the coverage record's envelope — parse integrity and the five-field seat-row key set": {
        class: "mechanical:tool-written", tokens: ["coverage_form_damaged"],
        why: "CONVERTED (the register-digest typed transport, B's pattern): record_coverage writes the envelope and takes only status/reason/kind/axis/unit values — coverage-call.mjs validates, coverage-tool.mjs serializes, the seat types no JSON. On the live path coverage_form_damaged can now only mean the DRIVER's own accumulator failed to parse (a driver/fs fault, hinted as such); archived pre-conversion accumulators are still judged by the same token.",
      },
      "the compulsory dominant-element crowd row's `unit` cell — the dictated grammar `<axis> / dominant-element crowd (<N> members): <label>` and the bare integer N": {
        class: "mechanical:code-rendered", tokens: [],
        why: "The driver computes the denominator: it groups screened-live dominant-element records by _driver/register-positions.json, counts the positions the digest did not individually end, verifies N and re-verifies after every rewrite (digest.md:132-164). The model is asked to retype a number the driver already checks it against — the frame_scope_missing loop restated. The RULING (why crowd membership ends this residual class) is judgment and lives in `reason`. No verify.mjs token: the reconciliation gate is a delivery block in pipeline.mjs, not this stage's validator.",
      },
      "rolled-up coverage judgment — `sufficient: <true|false>`": {
        class: "mechanical:code-extracted", tokens: [],
        why: "deriveCoverageStatus() in coverage-ledger.mjs ALREADY computes {complete, materialGaps} from exactly these rows: any non-excluded row at coverage-limited or deferred ⇒ not complete. digest.md states the same rule as an iff. The materiality judgment is already expressed in the per-row status the seat set; the boolean is arithmetic over the driver's own form.",
      },
      "the rolled-up one-line `reason` naming the material slice": {
        class: "judgment", tokens: [],
        why: "Which gap the lawyer is being asked to accept, and why it matters — a legal statement, not a fold of the rows.",
      },
      "findings prose — the relevance gate keep/drop, opposition read, owner aggregation and identity-conflict flags, Option-D cross-checks, watchlist application, which position earns a Sheet-1 row, and each row's `Flag reason` and `Verify?` cells": {
        class: "judgment", tokens: ["too_short", "missing"],
        why: "'The only relevance judge' — the funnel pre-gated nothing (prelim-register SKILL.md, `## Coverage = the band blocks`). #850 keeps findings prose / relevance gate / opposition / Option-D / position rows as J.",
      },
      "the Sheet-1 findings row's identifier cells — URI, Mark, Owner, Country, Classes, Status, Filed, Expiry": {
        class: "mechanical:tool-written", tokens: ["registerdigest_uri_missing", "registerdigest_uri_unknown"],
        why: "CONVERTED (conversion 11, tracker issue 1893): the seat sends the position's `uri` and the driver renders every cell from the band record it names — record_id, mark_text, classes, status, owner_name, owner_country, application_date, registration_date, expiry_date. The join is now the check: a uri no band record carries is refused AT THE CALL, where restating it costs nothing, instead of producing a plausible row of retyped cells that fails downstream or nowhere. The DECISION that a position earns a row stays judgment (element above); the cells were never anything but transcription.",
      },
      "the full clickable record URL, composed from providers/<name>.md 'Record base host' plus the record `uri`": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (conversion 11): the driver composes the link from the run's record host and the record's own uri, so the seat never sees a host table it was not given. The host was already a code fact — activeRecordOrigins (record-origins.mjs) is the shipped per-provider record-host allow-list, imported by checkFindingsSibling() in verify.mjs — and #850 already ruled the identical element M for report-card. This carries that call back to the stage that composes the URL first.",
      },
      "source attribution — the register name tagged on each record, plus the EUIPO `environment` word": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (conversion 11): the driver stamps the provider and its environment word into the rendered document from the run config it already holds, and the tool takes no field for either. 'Exactly one register per run' (prelim-register SKILL.md, `## Provider`) and digest.md's `## Provider` note conceded 'the tag is constant across the findings file' — a constant the seat was retyping onto every record.",
      },
      "Negative-results drop rows — the Notes cell carrying URI, screen_verdict, class and status": {
        class: "mechanical:tool-written", tokens: ["registerdigest_uri_unknown", "registerdigest_drop_reason_missing"],
        why: "CONVERTED (conversion 11): the seat sends the dropped record's `uri` and its one-line reason; the driver renders the Notes cell's four provenance fields from the band record. This is the element the conversion most clearly repays — the acceptance gate used to parse those fields back out to check the model's retyping against material the driver already held, which is a guard comparing a value with a copy of itself. The DROP DECISION and its why stay judgment (the findings-prose element), and a drop with no stated reason is refused: a batch-dropped candidate with no row is a silent recall loss.",
      },
      "## Summary counts — total queries executed (search + detail-fetch), enumerated records across N axes, crowd-descriptor count, candidates past the gate, surfaced count, open-verification-flag count": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (conversion 11): the driver renders the whole Summary section from its own receipts and the tool takes no count field at all. band_shape computes the band totals and the crowds list; _driver/plan-execution.json records every executed plan entry; _driver/tool-calls.jsonl writes one line per call with server/tool/axis/seq (tool-calls.mjs), so call counts are the driver's arithmetic. Unlike case-law's queries[] (#850's M5 blocker) no query TEXT is needed here — only counts, which the log already supports.",
      },
      "Audit trail — per-unit search/detail-fetch counts, per-jurisdiction `_query` attribution": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (conversion 11): the driver renders the Audit trail table from the same artifacts as the Summary counts, plus `_query` which digest.md:388 says 'the driver stamps at merge' — carrying that forward was transcription of a driver stamp. The judgment half — flagging a unit that shortcut its axis — stays in the findings-prose element.",
      },
      "INSTRUCTED CHECKS — the answer to each requester ask the register owns": {
        class: "judgment", tokens: [],
        why: "Answering a lawyer's question from the frozen band, including the honest 'the frozen material cannot answer this' that becomes an open coverage row. No artifact holds it. (No token here: intake_ask_unanswered lives on validators.narrative, not registerFindings.)",
      },
      "the record ids read while answering each instructed check": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (conversion 11): the driver renders the ids beneath each instructed check from its own reading audit, and the tool takes {ask, answer} only. Every band_shape / band_lookup / band_record call lands in reading-log.jsonl with its args (the pattern #850 names as already existing for the band tools), so the driver held this list the whole time the seat was being asked to reproduce it.",
      },
      "adopt-or-override each placement by engaging its reason, and the `### Disagreement resolutions` rows (one per surfaced disagreement and per borderline:true, each ADOPTED/OVERRODE in writing)": {
        class: "judgment", tokens: [],
        why: "Answering the promotion question the other way, in writing, against a reason another stage authored. #850 keeps it J. The row's SUBJECT is handed over as data (the driver appends the PLACEMENT RULINGS TAIL block, pipeline.mjs:3584), so nothing here is a fetch. [citation unverified]",
      },
      // ── REWRITTEN, NEVER DELETED (the ruling) — AND THE ROW THAT COST THIS CONVERSION A DESIGN ──
      //
      // What stood here described the no-form branch as a LIVE path: "hand-writing the `## Coverage
      // ledger` table, naming every deferred slice by its query id verbatim…". M6 deleted that
      // branch on 2026-08-14 and the row outlived it. Conversion 11 was designed twice because of it —
      // the first design kept this stage's writer on the reasoning that a live hand-write arm needed
      // one, which is what register-unit's own-key shape exists for. There is no such arm. Both halves
      // of the disproof were in comments at the sites: "AND NOW THERE IS NO SECOND BRANCH" in the
      // dispatch above, "ALWAYS ARM, ALWAYS WRITE" in pipeline's runDigest.
      //
      // THE LESSON IS ABOUT THIS TABLE, not about the branch. A contract-elements table is a register of
      // DECISIONS and its retired rows stay on purpose, so the ruling survives — which makes it
      // trustworthy about intent and silent about state. Read a row's `why` as the argument that was
      // made, never as a description of what runs today. The E3 backlog retired ITS half of this same
      // subject on 2026-08-16 (contract-e3-backlog.mjs, the RETIRED note); this table did not, and the
      // asymmetry is the disease arriving in the registry that has no staleness checker of its own.
      //
      // WHY THE ROW IS NOT DELETED. Its twelve tokens are still emitted — verify.mjs's prose arms are
      // LOAD-BEARING FOR ARCHIVED REPLAYS, and replay verdicts get quoted. A deletion would drop twelve
      // tokens out of the arm-2 census, understating what the validators speak about, and rules
      // the point directly: deletion under-counts the backlog. So the row keeps its tokens and its
      // class, and its SUBJECT is restated as what those tokens are about today.
      "the archived-era prose `## Coverage ledger` table — the pre-#476 contract these tokens still judge on a REPLAYED run (no live run reaches it)": {
        class: "mechanical:code-rendered", tokens: ["no_coverage_status_row", "coverage_status_offenum", "coverage_deferred_unaccounted", "coverage_clean_unverified_incomplete", "coverage_ledger_unparseable", "coverage_ledger_empty", "coverage_key_unknown", "coverage_axis_invalid", "coverage_status_invalid", "coverage_classes_invalid", "coverage_axis_missing", "missing"],
        why: "RETIRED SUBJECT, LIVE TOKENS. #850's move M6 (2026-08-14) deleted the branch and made the driver always arm and always write, so NO LIVE RUN reaches the arms below: where the form exists the driver renders both the table and the JSON mirror from it. What the tokens judge now is an ARCHIVED pre-#476 run, which carries no era stamp and whose coverage verdict is decided by exactly this contract — that is why verify.mjs's prose arms are not dead code and must not be tidied away as such. ARM SCOPING (verify.mjs): coverage_deferred_unaccounted and coverage_clean_unverified_incomplete fire only inside `if (!stamp.required)`; coverage_status_offenum reads parseCoverageLedgerFull over the model's prose; the coverage_ledger_* / coverage_axis_* / coverage_key_unknown / coverage_classes_invalid family comes from parseCoverageLedgerJson over register-coverage-ledger.json, which is code-derived in BOTH eras — so on a form run those are driver faults and only on the archived branch do they speak about model output. Conversion 11 does not touch any of this: it moves the findings DOCUMENT, and the coverage form keeps its own transport (record_coverage) and its own writer.",
      },
      "return payload — the absolute output path plus a 2-3 line summary (counts + the path of the file written)": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (conversion 11): there is no path to hand back — the dispatch names no file, so the element's subject is gone rather than reassigned. The tool's own answer reports what it rendered (surfaced / incumbent / dropped counts). What stood here was the frame_scope_missing loop in miniature: the driver wrote the path into the message, gated on the file at that path, and asked for the path back.",
      },
    },
    message: ({ paths: P, axes, lateBind, intakeAsks }) => lines(
      `First, read and follow exactly: skills/prelim-register/SKILL.md (the shared spine) then skills/prelim-register/digest.md (MODE B — DIGEST).`,
      `You are register DIGEST mode. Combine the unit digests into the register findings file.`,
      // T9 (A2) — the owning stage executes its committed intake checks (see common-law twin).
      // PR-8: this stage holds the READ-ONLY band tools, not the live register — the old wording
      // ("EXECUTE each with the register tools you hold") ordered live searches from a stage that had
      // no register tools at all (the postmortem prompt/grant mismatch). An instructed check is
      // answered from the frozen material; NEW register work enters only through the supplemental
      // mint (a register-unit lane proposal / the skeptic's escalation re-run), never from here.
      (intakeAsks ?? []).filter((a) => a.owner === "register").length ? lines(
        `INSTRUCTED CHECKS (the requester explicitly asked for these; THIS stage owns their ANSWERS): answer each from the run's frozen register material via the band tools (band_shape / band_lookup / band_record) and record the result + the record ids you read in the findings file. You hold NO live register tools here — that is by design, never an outage: a check the frozen material genuinely cannot answer (it needs a register query no dispatched slice covers) is recorded honestly as a Coverage-ledger open row naming the missing query, so the escalation lane can propose it through the supplemental mint — never guessed, never silently dropped, and never reported as a tool fault:`,
        ...(intakeAsks ?? []).filter((a) => a.owner === "register").map((a, i) => `  ${i + 1}. "${a.ask}"`),
      ) : "",
      `Unit digests: ${(axes ?? []).map((a) => P.registerUnit(a)).join(", ")}.`,
      `Manifest: ${P.variantManifest}; matter frame: ${P.matterContext}; placements: ${P.placement} (structured tiers + reasons: ${P.placementModel} — when present, it is the authoritative per-candidate tier record; the md carries the rulings tail).`,
      PLACEMENT_BORDERLINE_NOTE,
      // B2 — the adopt-or-counter contract runs on the REASON, not the tier alone (digest.md §Consume).
      // AD-2 A9: the corrective pass does not re-read placement — and the rulings tail it still needs is
      // handed to it AS DATA by the driver (runDigest appends the PLACEMENT RULINGS TAIL block), never
      // left to the model to remember or to fetch back.
      `Adopt or override each placement BY ENGAGING ITS reason — an override quotes the reason it contradicts (never silently re-tiers), and a kept tier may still tighten a label while reusing the reason. On a corrective/repair pass, do NOT re-read the whole placement file: the tiers are in ${P.placementModel}, and the md's rulings tail is handed to you verbatim in this dispatch (the PLACEMENT RULINGS TAIL block) — adjudicate against it there.`,
      // judgment-relocation (2026-06-23): the COMPLETE named band — run the relevance gate over the REAL
      // material. PR-8: read via the band tools (shape whole + logged lookups), never by slicing the raw file.
      BAND_READING_CONTRACT,
      `Reconcile your Coverage ledger against the shape's crowd descriptors: an `+"`incomplete`"+` slice is an open crowd the lawyer must weigh (a count-only / unenumerable slice), never a clean.`,
      // P2-A (charter P2d): identity collapse is CODE-derived before you read — the shape's Positions
      // section (and _driver/register-positions.json) is the exact-identity projection. "Owner
      // clustering" as arithmetic is no longer your job; residual folds that ARE judgment
      // (related-owner, brand-family) remain yours, stated with their reasoning.
      `Apply the relevance gate, opposition, Option-D, merch sweep, applicant own-rights sweep when priority is live. Sheet-1 rows follow the shape's POSITIONS (one row per position, citing AT LEAST ONE constituent record URI — listing all of them is better but one is sufficient), never one row per registration of the same right. Union + reconcile the Coverage ledger against the materially-matters list.`,
      // P2-A (charter P2a): the retrieved→judgment reconciliation — the driver joins every screened-live
      // dominant-element record against your endings after EVERY digest pass; an unended POSITION blocks
      // delivery. ONE contract, ONE unit (review problem 2): the join groups records by the same
      // register-positions.json projection Sheet-1 rows follow, so a compliant one-URI position row is a
      // complete ending. See digest.md "Dominant-element reconciliation" for the three ending forms.
      `EVERY live, in-scope record the screen surfaced whose mark carries the dominant element must END somewhere a reader can see — counted by POSITION, so ONE ending covers every constituent of that position: a findings-table row, a Negative-results drop row citing any one constituent URI, or membership of the explicitly ruled, counted dominant-element crowd (one Coverage-ledger row: `+"`<axis> / dominant-element crowd (<N> members): <label>`"+` with the ruling as its reason, `+"`<N>`"+` counted in POSITIONS). The code-ranked closest positions must end individually — the driver's reconciliation gate re-checks after every rewrite and an unended position blocks delivery.`,
      // B5b checkpoint 2 (code-built when a customer bound after matter-frame but before this digest):
      // exclusion is a CLASSIFICATION filter — never a reason to re-run searches.
      lateBind ? `APPLICANT LATE-BOUND (mid-run reply): the applicant is ${lateBind.customer}.${lateBind.exclusions?.length ? ` Affiliate/exclusion set: ${lateBind.exclusions.join(", ")}.` : ""} Classify marks owned by the applicant/exclusion set as the client's OWN rights (own-rights context, not conflicts). Do NOT run any additional searches because of this — it is a classification filter only.` : "",
      // — WHICH DOCUMENT THE SEAT OWES IS READ OFF THE ERA STAMP, NEVER ASSERTED.
      //
      // What stood here told the model to "write only the prose ## Coverage ledger table" — which made a
      // model-authored markdown table the source of truth every coverage gate read, and made the gate's
      // disclosure join a substring match against text the model typed. Where a form exists that is
      // gone: the driver writes the form before this dispatch (digestDispatchExtra carries the brief
      // with the path and the row counts) and renders both the table and the JSON mirror from it after.
      //
      // ── M6 — AND NOW THERE IS NO SECOND BRANCH (2026-08-14) ──────────────────────────────────
      //
      // A NO-FORM arm stood here until M6, saying "this run has NO coverage form, so the ## Coverage
      // ledger table in your findings is yours to write and it is what every coverage gate reads". It
      // was the one condition could not reach — the driver armed the form only when the plan
      // apparatus was in reach — and inside it, 's whole correction was reversed: the model's prose
      // was the source of truth again. One contract per stage, not one per runtime condition.
      //
      // The driver now always arms and always writes (pipeline.mjs runDigest). A run that can carry no
      // rows gets a form that DECLARES that and names its cause, and the seat is told the same thing it
      // is told on every other run: the form is the artifact, do not write the table. Nothing here is
      // conditional any more, so nothing here can disagree with the stamp — which is what the paragraph
      // above was worried about, solved by removing the second contract rather than by keeping the two
      // readers in step.
      // Typed transport (B's pattern, one lane over): the seat sends coverage statuses as VALUES
      // through `record_coverage`, never by opening or editing any file — the same delete-not-gate
      // conversion made for the disposition form. The obligations themselves ride this dispatch
      // (digestDispatchExtra appends coverageFormBrief, which enumerates every row with its computed
      // identifiers), and the tool's every answer re-lists what is outstanding.
      `Your Coverage ledger is a set of driver-computed obligations, enumerated in this dispatch (the coverage block below, with a row_id per row). Record a "status" and a "reason" on EVERY row ONLY by calling the \`record_coverage\` tool — the driver validates each row as it arrives, holds the record itself, and renders both the ## Coverage ledger table and the coverage JSON from it. Never write or edit any coverage file, and do NOT write a ## Coverage ledger table into your findings — nothing you hand-write in either place is read. Each row is discharged only by ITSELF: a status on one row never accounts for another row's slice. If this dispatch carries NO coverage block, the run's coverage form is a driver-written declaration of absence — a complete answer; there is nothing for you to record.`,
      // ── CONVERTED (, conversion 11). A bare write-return naming the findings path
      // stood here
      // and the sections above dictated a document skeleton the seat typed and nine parsers read back.
      // What survives is every sentence that says what a JUDGMENT MEANS — the relevance gate, the
      // position rule, opposition, Option-D, the adopt-or-override contract, the dominant-element
      // ending rule. What goes is the seat retyping identifier cells, record URLs, summary counts and
      // audit rows out of artifacts the driver already holds, and laying them out as tables.
      `RECORD YOUR WORK WITH \`record_register_digest\`. THE DISPATCH NAMES NO FILE FOR YOU TO WRITE, deliberately — the driver renders the findings document from what you send. You hold no Write or Edit tool for it and nothing you write by hand is read.`,
      `WHAT THE CALL TAKES, AND WHAT IT DOES NOT. \`findings_rows\` / \`incumbent_rows\`: one entry per POSITION that earns a row — the \`uri\` of any one constituent, your \`flag_reason\`, and \`verify\`. \`negative_rows\`: one entry per candidate screened out — its \`uri\` and your \`drop_reason\`. \`instructed_checks\`: {ask, answer}. \`disagreement_resolutions\`: {subject, ADOPTED|OVERRODE, reason}. Plus your prose sections: \`opposition\`, \`merch_sweep\`, \`cross_checks\`, \`open_flags\`.`,
      `YOU DO NOT SEND — AND MUST NOT RETYPE — any record's Mark, Owner, Country, Classes, Status, Filed or Expiry, the clickable record URL, the register name, the summary counts, the audit trail or the record ids you read. Every one of those is rendered from the band record your \`uri\` names or from this run's own receipts. The uri IS the join: a uri no band record carries is refused on the call, naming it, rather than rendered as a row of blank cells.`,
      // ── — THE SEAT MARKS THE LIST, AND THE RULE NAMES THE FIELD IT SENDS ─────────
      //
      // Stated as a FIELD ON THE CALL, deliberately. The failure this avoids is measured: tracker issue
      // 1955 ruled a rule that described a downstream effect — "the string you sweep" — the seat opened
      // the file, and it reached one variant of thirty-six, because the seat authors rows and had no
      // field to put the effect in. A rule the seat cannot map onto something it sends produces nothing
      // and no refusal.
      //
      // The dictation says SEND IT. It does not say "optional", even though the transport accepts a call
      // without it: the leniency is a delivery-safety property of the driver — a new instruction wired
      // to a refusal on its first live outing would put a no-report path on the run that exercises it —
      // and telling a seat a thing is optional is how it comes back unsent. What the driver forgives is
      // not the seat's contract.
      `MARK THE LIST — \`fates\`. \`${basename(P.registerHitList)}\` holds one line per enumerated record: sign, classes, territory, status, owner, the office's own reading where there is one, and its dates. Send \`fates\` as one entry per line you dispose of — \`{ "id": <the line's id>, "fate": 0 | 1 | 2, "ground": <token, when fate is 0> }\` — where 0 is NOT PICKED (scanned on the list, never opened), 1 is OPENED AND DISMISSED, 2 is REPORTED. A fate of 0 carries exactly one \`ground\`, one of: ${LINE_GROUNDS.join(" · ")}. THESE ARE THE ONLY GROUNDS A LINE CAN BE SET ASIDE ON WITHOUT OPENING IT, and each answers ONE question — a record is out of TERRITORY, or it is a different SIGN, and which of those it is is the thing a reader checks. Never one token for both. If the reason needs the record — its goods, its specification, the wording of a class head — that is not a ground, it is an OPEN: fetch it, read it, and send fate 1 with your reasoning in the row it earns.`,
      `COVERAGE DOES NOT COME HERE. Your Coverage-ledger rulings ride \`record_coverage\`, row by row, exactly as described above — two transports, two statements, and the obligation ledger keeps its own writer.`,
    ),
  },

  skeptic: {
    // Phase-4: declare sonnet PRIMARY at HIGH effort. The skeptic is the commission-audit safety stage —
    // resource it. (It already ran on sonnet in-engine: anthropic-agent maps gemini-flash→sonnet, so the
    // old "gemini-flash, fall back to sonnet" never fired; this just makes the config honest + lifts effort.)
    model: "sonnet", thinking: "high", timeoutSec: 600, stallSec: 600,
    skillReads: ["skills/prelim-search/phase2-execution.md"],
    out: (P) => P.skepticFlags,
    validate: validators.skepticFlags,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "flags — one bullet per flag, citing the affected worker / axis / finding": {
        class: "judgment", tokens: ["too_short"],
        why: "A fresh-eyes audit by a reader that did not write the findings — 'ask what's wrong here, not is this right' (phase2-execution.md:139-142). Nothing on disk holds a second opinion. #850 keeps it J.",
      },
      "\"no flags surfaced\" — the clean sentinel phrase": {
        class: "mechanical:code-rendered", tokens: ["too_short"],
        why: "The DECISION that the run is clean sits inside the flags element; this is the dictated literal a regex then matches. An empty flag list in a structured return renders it. A clean file phrased any other way and under 200 chars fails as too_short, which is the shape doing the failing, not the judgment.",
      },
      "the escalation decision — which register axes carry a material, unresolved, genuinely closeable gap, and the one-line reason for each": {
        class: "judgment", tokens: [],
        why: "Whether a documented coverage-limited row, a capability-gap deferral or a fresh concern on a confirmed-clean row warrants spending a re-run. The driver hands the coverage/execution truth in as a computed table (stages.mjs:1466; skepticDeferralExtra) precisely so this is a call over data rather than a re-derivation — but the call itself is nobody else's. [citation unverified]",
      },
      "escalation decisions — one {axis, reason} per axis that must be re-run, sent through record_skeptic": {
        class: "mechanical:code-rendered", tokens: [],
        why: "#850 rules the line shape M: typed rows, code renders. The axis is one of the closed list the driver wrote into the same message (`Valid axes: ${axes}`, stages.mjs:2628), and the parse at skeptic-record.mjs:49-53 recognises only /ESCALATE:\\s*<axis>\\b/i per known axis — the em-dash, the reason, the section title and the literal 'none' are parsed by nothing. NO TOKEN: skepticFlags never inspects these lines, so a malformed ESCALATE line is a silent no-escalation, not a failure. [citation unverified]",
      },
      "the verbatim ESCALATE string dictated for a `translit-too-generic` unit digest": {
        class: "mechanical:code-rendered", tokens: [],
        why: "Fixed prose fired on a condition the driver can read off disk — `translit-too-generic` is recorded in the unit digest (register-units/<axis>.md) before this stage runs. A constant string plus an on-disk trigger is a render, not a judgment. Skill-file only: nothing in stages.mjs mentions it.",
      },
      "the `risk: <category>` field inside that dictated ESCALATE line": {
        class: "mechanical:code-rendered", tokens: [],
        why: "IT HAS NO CONSUMER AT ALL. stages.mjs:333-336 records that the risk-category filter was deleted, and pipeline.mjs states 'spec-48 D3 — the escalation-risk SHADOW loop (risk-tag parse + would-skip telemetry for the never-enabled CLEAROTRON_ESCALATION_FILTER) is DELETED' at the parse site (envelopeDecision() in pipeline.mjs). The doc block at envelopeDecision() in pipeline.mjs that describes reading the field is a stale header left standing over envelopeDecision — the function it documented is gone. Classed code-rendered because it is not judgment; the correct move is deletion from the skill file. [citation unverified]",
      },
      "return payload — a 2-3 line summary; the audit itself rides record_skeptic": {
        class: "mechanical:tool-written", tokens: ["skeptic_"],
        why: "#1202 — THE TOKENS ARE DECLARED HERE NOW, AND THEY WERE ALWAYS BEING RAISED. `acceptSkeptic` "
          + "refuses nine ways (`skeptic_flags_missing`, `skeptic_axis_invalid`, `skeptic_roundtrip_mismatch`, "
          + "the dynamic `skeptic_flag_${d}` / `skeptic_reason_${d}` pair, and the rest) and this element read "
          + "`tokens: []` — not because the refusals did not exist but because the census could not SEE them: "
          + "it read `fail(` and `throw`, and an acceptance boundary returns `{ok: false, reason}`. So the "
          + "conversion that moved these refusals to the boundary moved them out of the census in the same "
          + "commit, and nothing went red. Attached to this element rather than a new one because this IS the "
          + "typed-envelope element for this stage — the tokens speak about what record_skeptic accepts. "
          + "ORIGINAL NOTE, still true: CONVERTED (#1092, blind-frame's template one stage over): the seat sends flags and escalations as VALUES and the driver renders skeptic-flags.md through renderSkepticFlags. Nothing is pre-bound because the seat is handed no path — e2e measured the cost of leaving the old order beside the tool: on 2e203b75 the seat hand-wrote a 5693B skeptic-flags.md with no call capture, on a box whose grant already carried record_skeptic. The line shape is now code's alone, which is what #850 asked for.",
      },
    },
    message: ({ paths: P, axes, registerOnly, depth }) => lines(
      `Read skills/prelim-search/phase2-execution.md, section "Step 2.6 — Skeptic review", and perform that fresh-eyes audit.`,
      // lever 3 — the flagging rung. Empty on a one-country run; `lines` drops it.
      skepticRungDirective(depth),
      // A2 (addendum 2026-07-30): the two MACHINE artifacts are named as inputs beside the prose. The
      // driver also hands their contents in as a computed table (pipeline skepticDeferralExtra), so the
      // coverage/escalation question is answered from data — never re-derived out of the findings prose,
      // which cost 28,592 thinking tokens and produced two un-closable escalations on the evidence run.
      `Inputs: register findings ${P.registerFindings}${registerOnly ? "" : `; common-law ${P.commonLaw}`}; manifest ${P.variantManifest}; matter frame ${P.matterContext}.`,
      `Machine coverage + execution truth (authoritative, driver-written — the computed table below carries their contents): coverage ledger ${P.registerCoverageLedger}; plan-execution receipt ${P.planExecution}.`,
      registerOnly ? REGISTER_ONLY_NOTE : "",
      `Surface flags only (one per entry, one line each, citing the affected worker/axis/finding). Do NOT re-run anything.`,
      // Structured escalation decision — the driver parses these lines verbatim to decide which register axes
      // to re-run, so be precise: emit an ESCALATE line ONLY for an axis with a MATERIAL, unresolved gap that a
      // re-run would actually fix (not for an axis you merely mention or that is fine). Naming an axis in prose
      // above does NOT escalate it; only these lines do.
      `Then decide, per register axis, which must be re-run. Valid axes: ${(axes ?? REGISTER_AXES).join(", ")}.`,
      // Do NOT escalate a gap the Coverage ledger already documents as `coverage-limited` (a documented/accepted
      // structural limit — budget overrun, ring-fenced jurisdiction yield, phonetic-fringe sampled, count-only
      // saturation — that a warm re-run cannot close). Escalate only genuinely closeable gaps (a `deferred` row,
      // or a new concern on a row the ledger marks `confirmed-clean`). The driver enforces this too, but keep the
      // ESCALATE list clean. Re-running a documented limit only re-spends gather + re-digest for no recall gain.
      `Do NOT emit ESCALATE for an axis whose only Coverage-ledger gap is already recorded as "coverage-limited".`,
      // A2: the second never-escalate class. A capability-gap deferral is not a gap in the work — it is
      // a slice the active provider cannot express at all, so a re-run buys the identical refusal. The
      // computed table above marks each one NOT CLOSEABLE; the driver enforces the skip too.
      `Do NOT emit ESCALATE for an axis whose outstanding work is a capability-gap deferral (the table above marks these NOT CLOSEABLE) — no re-run can reach those slices. They stay open and disclosed; flag them as gaps if a findings surface reads them as clean.`,
      // — THE DICTATED LINE SHAPE AND THE PATH ARE BOTH GONE. `writeReturn(P.skepticFlags)` closed this
      // dispatch and the prose above dictated `ESCALATE: <axis> — <one-line reason>` in a named section, a
      // shape pipeline.mjs re-parses. The seat now sends VALUES and the driver renders the file, so the one
      // authority for the line shape is `renderSkepticFlags` — which is what 's "typed rows, code
      // renders" asked for, and what the E3 backlog row on this dictation was waiting for.
      // DIRECTION (a) — THE GRANT CARRIED THIS TOOL AND NO SERVED TEXT NAMED IT. `search_run_artifacts`
      // landed with the conversion ('s unlock path 1) as the sanctioned replacement for the seven Bash
      // reads O3c measured on this stage, and then appeared in no dispatch, no skill doc and no repair
      // prose — so the seat was handed a capability it had no way to know about while the doctrine it DOES
      // read still tells it to build every row from files. A granted-but-unnamed tool does not fail loudly:
      // the seat reaches for the shell it no longer holds, takes the refusal, and thins its audit.
      // ITS OWN IMPERATIVE, ITS OWN SENTENCE (: a capability phrased outside one was acted on 0 of 9
      // times against 74 of 74 when imperative-carried).
      `Re-read any of this run's own artifacts with the \`search_run_artifacts\` tool — ONE file per call, named relative to the run directory (e.g. "register-findings.md"), with \`terms\` as literal substrings OR-matched per line. It is the only search surface you hold: there is no shell on this seat and no retrieval tool, and a token you expected and did not find is itself a finding.`,
      `Hand your audit back by calling the \`record_skeptic\` tool: \`flags\` — one entry per flag — and \`escalations\` — one entry per axis that must be re-run, each with \`axis\` and a one-line \`reason\`.`,
      `An EMPTY \`flags\` array IS the clean answer, and an EMPTY \`escalations\` array IS a decision: the driver renders the "no flags surfaced" sentinel and the "none" line from them. Omitting either field is not an answer.`,
      `Do NOT write or edit any file, and do NOT type an ESCALATE line anywhere — the driver renders those from your values, and a token you type inside a flag or a reason is refused.`,
      `When the tool accepts your call, return ONLY a 2-3 line summary.`,
    ),
  },

  // Property 1 (the omission detector) — diff the BLIND model against what the run ACTUALLY scoped/searched
  // and emit STRUCTURED reopen directives. Sonnet/low: a structured comparison, not fresh imagination (that
  // was spent in blind-frame). CODE consumes frame-diff.json (runSupplementalSweeps + the dominant-element
  // gap clamp); the DECISION is never the model's. NON-FATAL (a flake just means no reopen this run).
  "frame-diff": {
    model: "sonnet", thinking: "low", timeoutSec: 600,
    skillReads: ["skills/frame-diff/SKILL.md"],
    out: (P) => P.frameDiff,
    validate: validators.frameDiff,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "The prose reasoning in frame-diff.md — the same directives the JSON already carries": {
        class: "mechanical:code-rendered", tokens: ["too_short"],
        why: "CONVERTED (#1092, third conversion). This element was already ruled code-rendered and the ruling has now arrived: the seat is not asked for prose at all, and `renderFrameDiff` projects the file from the same parsed model the JSON is serialized from. So the two artifacts cannot disagree about a directive, and too_short stops being a length floor on a restatement — an artifact the driver writes cannot come back short",
      },
      "directives[] — {layer: variant|field|source, item, observation, severity: dominant-element|material|minor}": {
        class: "judgment", tokens: [],
        why: "matching by MEANING not string identity, and deciding whether an omission is ON the spine, is the judgment #850 keeps here. Every token naming this array — directives_invalid, directive_key_unknown, layer_invalid, severity_invalid — is an array-shape, key-set or enum-spelling check owned by the envelope, so nothing polices whether the diff found the omissions",
      },
      "Dispatchability of a FIRING directive — its item is itself a mark-shaped term, or remedy.terms names the mark-shaped term(s)": {
        class: "judgment", tokens: ["framediff_directive_undispatchable"],
        why: "#850 ruled remedy.terms dispatchability J, and it stays J because code must never guess `term: d.item` — deriveDirectiveRemedy() in frame-diff-model.mjs returns null rather than dispatch a label, on the record of the RUN1 false-close. The asker has to say what the search IS. This token also speaks about remedy.terms, declared below",
      },
      "remedy — {terms, nice_classes, regions}": {
        class: "judgment", tokens: [],
        why: "naming the exact re-search is judgment the driver cannot derive for a variant directive. framediff_remedy_invalid is a key/type check owned by the envelope; the content failure it can suffer — a remedy that is itself a label — is owned by the dispatchability element above",
      },
      "dominant_element — bound by the driver from the blind model; the seat is not asked for it": {
        class: "mechanical:pre-bound", tokens: [],
        why: "BOUND (#1169) — the classification is now true rather than aspirational. It read \"echo the blind model's, verbatim\" and was WORSE THAN UNREAD: the driver held two copies and preferred the echo over both, so a transcription slip retargeted applyDominantBackstop's spine test — the gate that forces dominant_element_gap true — with no token speaking about it. Now `boundDominantElement` (frame-diff-record.mjs) reads blind-frame-model.json, falling back to the manifest's `Dominant element:` line, and stamps the value into frame-diff.json; the tool's input schema has NO such property, so the field cannot arrive from a seat at all. The artifact keeps carrying it because the parser, the render and the archive all read it — what changed is who writes it",
      },
      "dominant_element_gap — boolean": {
        class: "judgment", tokens: [],
        why: "kept J because the model can assert a gap code cannot see — BUT the driver already overrides it in one direction (applyDominantBackstop() in frame-diff-model.mjs forces it true on any firing on-spine directive) and the message says so outright. #850 did not classify this field. The commonest stated case — \"the crowd was capped at top-50 of 257\" — is readable from the merged band's own `incomplete` descriptor, so it is a code-extraction site worth ruling on before this is called settled. framediff_gap_invalid is a JSON-type check owned by the envelope",
      },
      "Structured envelope — schema_version, EXACTLY the four top-level keys, the directive and remedy key sets, the closed enums, directives as an ARRAY, the gap as a JSON boolean": {
        class: "mechanical:tool-written", tokens: ["framediff_model_missing", "framediff_unparseable", "framediff_key_unknown", "framediff_directive_key_unknown", "framediff_layer_invalid", "framediff_severity_invalid", "framediff_directives_invalid", "framediff_gap_invalid", "framediff_remedy_invalid"],
        why: "a structured-return tool writes the envelope; the model supplies values only. LANDED (#1092, third conversion): `record_frame_diff` types the whole envelope, and most of these tokens are now UNREPRESENTABLE from a typed call rather than merely caught — the schema enums remove layer_invalid and severity_invalid, the JSON boolean removes gap_invalid, and the named keys remove the key-unknown pair. They stay listed because the parser keeps raising them and must: the archive is full of files written under the dictation, and a replay has to be able to fail on them",
      },
      "Return shape — hand the diff back through record_frame_diff, write NO file, return ONLY a 2-3 line summary": {
        class: "mechanical:tool-written", tokens: [],
        why: "CONVERTED (#1092, third conversion, after blind-frame and skeptic). It read `mechanical:pre-bound` — 'the driver named both paths in the dispatch' — which was true and is now beside the point: there are no paths in the dispatch. The seat sends VALUES and the driver writes BOTH artifacts, so nothing is pre-bound because nothing is handed over to be filled in. First conversion whose single call owns two files",
      },
    },
    message: ({ paths: P, registerOnly, axes }) => lines(
      reads(["skills/frame-diff/SKILL.md"]),
      `Diff the BLIND frame model against what this run ACTUALLY scoped and searched, then emit STRUCTURED reopen directives.`,
      `BLIND model (the frame-starved cold re-derivation): ${P.blindFrameModel}.`,
      `What the run SCOPED: the Scope ledger ${P.scopeLedger} (or the "### Scope ledger" section of ${P.variantManifest}) + the manifest ${P.variantManifest}.`,
      // — the searched surface is the EXECUTION record, read before the digest re-narrates it: the
      // merged band is every query the funnel ran and every record it carried, and the unit notes say what
      // each axis searched. Same question as before, asked of the primary evidence instead of its summary.
      `What the run SEARCHED: the register's COMPLETE MERGED BAND ${P.registerNamedBand} (every executed query with its records, or an honest "incomplete" descriptor) + the per-axis unit audit notes (${(axes ?? []).map((a) => P.registerUnit(a)).join(", ")})${registerOnly ? "" : `; common-law ${P.commonLaw}`}.`,
      registerOnly ? REGISTER_ONLY_NOTE : "",
      `For each blind-model variant / field / source the run did NOT scope or search, emit one directive {layer, item, observation, severity}. Match by MEANING, not string identity (a drop-S neighbour the run never searched; a field the run off-fielded that shares the product's goods; a channel the run never touched). "observation" = the concrete signal that should reopen it. severity = dominant-element (the omission is ON the spine) | material (a real omission worth a targeted sweep) | minor (already covered, or presentation only).`,
      // THE ASK CONTRACT, stated at BOTH levels (the two-level prompt rule): the parser REFUSES a firing
      // variant directive that dictates nothing dispatchable, so the invitation must demand what the code
      // demands. Stating it only in skills/frame-diff/SKILL.md would leave this line inviting the exact
      // shape the parse throws on — enforcement without a matching invitation, which is how the
      // 2026-07-29 run raised four omissions nothing could search.
      `A FIRING variant directive (severity dominant-element or material) MUST be dispatchable: either its "item" is ITSELF a single mark-shaped search term (TAKIS, AXIOS, CORAL MAGIC), or it carries remedy: {terms:["<mark-shaped term>", …], nice_classes:["<class>", …]} saying WHAT to search. A label — a parenthetical, an enumeration, more than about four words ("TAKIS (famous CPG snack, one-keystroke neighbour)") — dispatches as a nil search that reads CLEAN, so the driver REFUSES the file and asks you to restate it in-turn. Every offending directive is named at once: fix them ALL in one re-save. Never delete a directive or downgrade it to "minor" to get past this — a real omission must still be raised, it just has to say what the search IS.`,
      `field and source directives are NOT under that rule: an un-classed field directive and a source channel are disclosed rather than swept blind, which is a principled ending for those layers. A remedy is welcome on them whenever you know the exact re-search, and any remedy you supply is linted the same way wherever it rides.`,
      `Set dominant_element_gap true when the dominant element is not fully enumerated (the crowd not yet counted worldwide, a spine neighbour unsearched). The driver holds the dominant element and re-checks this against it — do not rely on it to hide a spine omission.`,
      //, third conversion — THE WRITE DICTATION AND BOTH PATHS ARE GONE. This dispatch used to end
      // "Emit BOTH: your prose reasoning to <frame-diff.md>, and the STRUCTURED diff … to
      // <frame-diff.json>", closed by `writeReturn(P.frameDiff)`. The seat now sends VALUES and the driver
      // writes the JSON and renders the prose from the same parsed model. Deleted rather than left beside
      // the tool: a superseded path left executable is what the golden rule bans, and e2e has twice
      // measured a seat obeying the prose while holding the tool.
      //
      // THE PROSE IS NOT ASKED FOR AT ALL any more, and that is the ruling arriving rather than a
      // side effect: this stage's own contract classifies the prose element `mechanical:code-rendered` —
      // "the same directives the JSON already carries" — and nothing in the driver reads frame-diff.md.
      //
      // EACH FIELD CARRIES ITS OWN IMPERATIVE IN ITS OWN SENTENCE (: a field phrased outside one was
      // written 0 of 9 times against 74 of 74 when imperative-carried).
      `Hand the diff back by calling the \`record_frame_diff\` tool. Send \`directives\` — one entry per omission, each with \`layer\`, \`item\`, \`observation\` and \`severity\` from the closed enums the skill names, plus \`remedy\` wherever the item is not itself the search term.`,
      // — the `dominant_element` echo is GONE from this sentence and from the tool's schema. The
      // driver binds it from blind-frame-model.json. What is left here is the one field only the seat can
      // answer.
      `Send \`dominant_element_gap\` as a JSON boolean — omitting it is not an answer, and an EMPTY \`directives\` array IS the clean answer.`,
      `Do NOT write or edit any file. There is no path for you to write to: the driver serializes the structured diff and renders the prose from it, and nothing you hand-write is read.`,
      `When the tool accepts your call, return ONLY a 2-3 line summary of what the diff found.`,
    ),
  },

  synthesis: {
    // A4 (teal-bastion): attempt 1 timed out at 1232s producing a long answer. Give the CORE judgment stage
    // headroom to finish on attempt 1 — timeoutSec 1200 → 1500. thinking = HIGH (resource the core judgment).
    // 2026-07-30 (charter P1 §1): 1500 → 2500. Both sides of the evidence are honoured: dense matters have
    // measured HONEST band-traversing work past the 1500s wall (see the register-digest 2400s calibration
    // above), so the wall gets real headroom — BUT on a clearance run, 2026-07-29, a synthesis burned to
    // the 1500s wall (code 137, ~2.95M cacheRead moved) and its retry did the identical work in 369s: that
    // was a STALL wearing a "needed more time" label. The raise is therefore paired with the engine's
    // no-progress ceiling (anthropic-agent watchdog: no token movement / agent-loop step / artifact write
    // for stallSec=900s ⇒ killed WELL below the wall and RECORDED as a stall, with the streamed usage on
    // the journal row), and a stall retry re-runs at the SAME budget (gateway.mjs), never the 1.5×
    // extension — a bigger wall must never mean bigger stall burn.
    // 900s per-stage stall (this is the longest pure-thinking stage; the old global 120s stall needed a manual
    // 20-min override on the VELTRIPHEN run). NOTE 2026-06-17: Opus fast mode was REMOVED here and everywhere
    // (it ~2.5x'd subscription usage → 5h-cap 429s); HIGH effort retained.
    // CLEAROTRON_SYNTHESIS_MODEL (2026-07-10): stage-specific override for a live A/B test (Fable vs Opus 4.8) on
    // just this stage — the driver's only other env override (CLEAROTRON_AZURE_MODEL, driver.config.mjs) is
    // tier-wide, which would retarget all 6 opus stages. Unset ⇒ unchanged default "opus". Toggled live in
    // the service's EnvironmentFile (a oneshot unit — no restart needed, takes effect on the next
    // queue-triggered run), never hardcoded here.
    model: process.env.CLEAROTRON_SYNTHESIS_MODEL || "opus", thinking: "high", timeoutSec: 2500, stallSec: 900,
    // F4 guaranteed-read: worked-examples.md is the analysis DEPTH TARGET (now carrying beverage exemplars
    // alongside the gaming ones) — it was previously reachable only by a model-discretion second hop, so the
    // depth target was silently absent on many runs. It is now in-context for every synthesis.
    skillReads: ["skills/prelim-search/synthesis-rules.md", "skills/prelim-search/firm-wide-reasoning.md", "skills/prelim-search/risk-framework.md", "skills/prelim-search/worked-examples.md", "skills/prelim-search/report-prose.md"],
    skillReadsFor: synthesisSkillReads,
    out: (P) => P.narrative,
    validate: validators.narrative,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "narrative.md — the cross-finding reasoning: the dominant-element spine, the verdict prose, the calibration-challenge answers, the coverage honesty read, prioritisation": {
        class: "judgment", tokens: ["too_short"],
        why: "#850 keeps this as the core of the product — no artifact holds the cross-finding read",
      },
      "narrative.md per-finding write-ups — the same conflict authored a second time in prose beside findings.json net/legal_position/practical_position": {
        class: "mechanical:code-rendered", tokens: [],
        why: "#850 measured it: 41,506 B of narrative prose against the same 40 findings' 32,349 B of typed fields, verbatim overlap 0/40 net, 0/40 legal_position, 3/40 practical_position — three authorings of one judgment. The MEASUREMENT stands; M4's DIRECTION does not. It proposed findings.json as the authored source with the prose rendered from it, and the owner read the two side by side and ruled the opposite (#1339 D3, 2026-08-19): report-card holds the single authored wording, and the typed fields carry the reads it is written FROM. Nobody builds the inverse pattern",
      },
      "narrative.md \"## Answers to your instructions\" — one `- You asked: <ask> → <answer>` line per intake ask": {
        class: "mechanical:code-rendered", tokens: ["intake_ask_unanswered"],
        why: "the driver already code-builds the report's section from the ask_answers register (assembleReportMd · buildAskAnswersSection, named in stages.mjs) — the narrative section is a second authoring of a register the driver renders anyway",
      },
      "narrative coverage prose — how a coverage gap is stated": {
        class: "judgment", tokens: ["coverage_recommendation", "coverage_gap_unexplained"],
        why: "what the run could and could not clear is the lawyer's honest statement; the token polices only the forbidden 'commission a re-run' form",
      },
      "findings[].band — the framework's band word": {
        class: "judgment", tokens: ["finding_band_missing", "finding_band_forbidden", "finding_band_invalid"],
        why: "the rating under the frozen framework is the product",
      },
      "findings[].borderline_between — the two band words the framework does not decide between": {
        class: "judgment", tokens: ["finding_borderline_between_invalid", "finding_borderline_between_unrated", "finding_borderline_between_mismatch"],
        why: "a declaration that the framework's own criteria do not settle the call — only the reasoning that made the call can state it",
      },
      "findings[].disposition — adversarial / coexistence-partner / distinguished / off-field": {
        class: "judgment", tokens: ["finding_disposition_missing", "finding_disposition_invalid"],
        why: "the realistic posture of the conflict; the enum membership rides the envelope, the choice does not",
      },
      "findings[].net — the one-sentence finding conclusion": {
        class: "judgment", tokens: ["finding_net_missing", "finding_net_invalid", "finding_net_prescriptive", "findings_net_chained"],
        why: "the answer to 'is this a problem for me' exists nowhere on disk",
      },
      "findings[].legal_position / practical_position": {
        class: "judgment", tokens: ["finding_legal_position_invalid", "finding_practical_position_invalid", "finding_legal_position_missing", "finding_practical_position_missing"],
        why: "the two separated reads are the reasoning itself",
      },
      "findings[].meters.use.token / meters.enforcer.token — the two strengths with no quadrant axis": {
        class: "judgment", tokens: ["finding_meter_missing", "finding_meter_token_invalid", "finding_meter_unknown"],
        why: "Judgment, and S1 does not reach them: quadrant plots goods proximity and mark similarity only (stages.mjs:1733), so nothing derives use (confirmed/not-confirmed/unknown) or enforcer strength. Deriving these from the quadrant would invent a reading the position does not carry. [citation unverified]",
      },
      "findings[].meters.mark_similarity.token / meters.goods_proximity.token — the coarse 3-pip restatement of the quadrant position": {
        class: "mechanical:code-assigned", tokens: ["finding_meter_missing", "finding_meter_token_invalid", "finding_meter_unknown"],
        why: "Owner ruling S1 (2026-08-13): fine-grained master — the model states severity once, as the precise position, and code derives the word. These two tokens plot the same two axes as quadrant, so under S1 code assigns them. The draft classed all four meters judgment on the pre-ruling body; that is the mechanical-element-wearing-a-judgment-label trap #850 names.",
      },
      "findings[].meters[].basis — verified-from-record vs inferred-from-signal": {
        class: "judgment", tokens: ["finding_basis_invalid"],
        why: "whether the claim rests on a fetched record or on a proxy is the model's own account of its reasoning; the driver machine-joins it afterwards but cannot originate it",
      },
      "findings[].meters[].source — the /mark/… record URI or URL behind a verified meter": {
        class: "mechanical:code-extracted", tokens: ["finding_basis_source_missing", "finding_meter_source_invalid", "finding_record_url_foreign_host"],
        why: "#850 M1: 59 /mark/… meter sources on the measured run resolve to records the run had already fetched — the frozen band and the fetched record store hold them; the model names the record handle and code writes the URI",
      },
      "findings[].source.resolved_link — the record URL actually fetched": {
        class: "mechanical:code-extracted", tokens: ["finding_source_invalid", "finding_record_url_foreign_host"],
        why: "the URL is composable in code from the record's own uri plus the provider host table — the skill file says so outright, and #495's foreign-host gate exists only because the model types it",
      },
      "findings[].source.source_type — register-vendor / register-euipo / common-law-marketplace / common-law-web / case-law": {
        class: "mechanical:code-extracted", tokens: ["finding_source_type_invalid", "finding_source_key_unknown"],
        why: "the lane that produced the record is a driver fact — a uri in the register record store is a register finding, a grid-ledger receipt is common-law; the prompt's own warning (\"a common-law finding never wears a register tag\") is a check against an artifact the driver already holds",
      },
      "findings[].owner.registrations[].uri — one record URI per registration": {
        class: "mechanical:code-extracted", tokens: ["finding_registration_invalid", "finding_record_url_foreign_host"],
        why: "#850 M1: all 68 registration URIs on the measured run resolve to records already fetched into _records/<cc>-<id>.json and the frozen band; ordinal / record-handle selection against the band replaces the typed token",
      },
      "findings[].owner.registrations[] secondary fields — classes / status / filed / expiry / jurisdiction": {
        class: "mechanical:code-extracted", tokens: ["finding_registration_invalid", "finding_registration_key_unknown"],
        why: "the driver already overwrites what the model types, from the record keyed by uri — the definition of mechanical",
      },
      "findings[].owner.name / country / nameRaw / nameNative": {
        class: "mechanical:code-extracted", tokens: ["finding_owner_invalid", "finding_owner_key_unknown"],
        why: "the prompt states the driver binds the owner name from the fetched record; the model's typed value is discarded",
      },
      "findings[].mark — the conflicting mark text": {
        class: "mechanical:code-extracted", tokens: ["finding_mark_missing"],
        why: "once the finding names its record handle the mark text comes from that record (register lane) or from the grid-ledger candidate row (common-law lane); no run has a mark string that is not already on disk. The judgment is WHICH record is a finding, not how its name is spelled",
      },
      "findings[].ordinal — 1-based unique per finding": {
        class: "mechanical:code-assigned", tokens: ["finding_ordinal_invalid", "finding_ordinal_duplicate"],
        why: "code assigns — the knockout lane already re-ranks and renumbers (findings-model.mjs parseKnockoutFindings/consolidateFindings)",
      },
      "findings[].quadrant {x,y}": {
        class: "judgment", tokens: ["finding_quadrant_invalid"],
        why: "Owner ruling S1 (2026-08-13): the precise position is the single authored statement of severity and stays with the model; the meter words are derived from it. The draft recorded S1 as unruled — it was ruled in #850's comments.",
      },
      "findings[].use_check.source — the searched use-check result URL or the honest negative": {
        class: "mechanical:tool-written", tokens: ["finding_use_check_missing", "finding_use_check_source_missing", "finding_use_check_invalid"],
        why: "the value is a perplexity_research result URL — a tool return, not a model judgment. NOTHING DISCHARGES IT TODAY: tool-calls.jsonl records server/tool/ok with no arguments and no results, the same absence #850 records as the blocker on move M5. Declared mechanical because a structured-return tool could write it; the call log must be extended first (reading-log.jsonl shows the shape one server over)",
      },
      "findings[].use_check.quality — owner-site / independent / register-mirror": {
        class: "mechanical:code-extracted", tokens: ["finding_use_check_quality_invalid", "finding_use_check_key_unknown"],
        why: "the prompt states code re-derives it and overrides the model's value",
      },
      "findings[].own_rights.source — the record URI(s) the own-portfolio check returned, or the scoped negative": {
        class: "mechanical:code-extracted", tokens: ["finding_own_rights_source_missing", "finding_own_rights_invalid", "finding_own_rights_key_unknown"],
        why: "the check runs through band_lookup / band_record, and reading-log.jsonl captures those tools' args and results (#850's own contrast with tool-calls.jsonl) — the URIs the lookup returned are on disk before the model retypes them",
      },
      "findings[].bears_on — what a risk-raising fact proves about THIS conflict": {
        class: "judgment", tokens: ["finding_bears_on_invalid"],
        why: "probative grading of a fact against this owner's rights on the disputed element",
      },
      "findings[].impact — the exposure line, derived from this matter's own record facts": {
        class: "judgment", tokens: ["finding_impact_invalid"],
        why: "reads the client's stated commitments against enforcement consequences; deliberately un-linted because impact never moves a rating",
      },
      "findings[].deadline {kind, date} — a recorded register deadline": {
        class: "mechanical:code-extracted", tokens: ["finding_deadline_invalid", "finding_deadline_key_unknown", "finding_deadline_date_missing"],
        why: "an opposition window / SOU / renewal date is a register fact carried in the fetched record — synthesis-rules.md §Registration metadata forbids restating dates and the driver overwrites them. The judgment is that the deadline demands an action, which is carried by the action's existence",
      },
      "findings[].ruled_out + ruled_out_reason": {
        class: "judgment", tokens: ["finding_ruled_out_reason_missing"],
        why: "naming the specific point that settled a concept neighbour is a legal call",
      },
      "findings[].off_field_ground — different-field / no-material-risk": {
        class: "judgment", tokens: ["finding_off_field_ground_missing", "finding_off_field_ground_invalid", "finding_off_field_ground_orphan", "finding_off_field_goods_proximate"],
        why: "declares which argument an off-field label rests on; the goods-meter cross-check is code, the ground is not",
      },
      "findings[].manageable {category, reason}": {
        class: "judgment", tokens: ["finding_manageable_invalid", "finding_manageable_key_unknown", "finding_manageable_category_invalid", "finding_manageable_reason_missing", "finding_manageable_on_unmanageable"],
        why: "promote-or-omit is a judgment about this client's exposure",
      },
      "coverage[] rows {area, state, note} — one per coverage area, in client English": {
        class: "judgment", tokens: ["findings_coverage_invalid", "findings_coverage_state_invalid", "findings_coverage_key_unknown"],
        why: "same posture #850 keeps for register-digest's coverage form status+reason: what a client needs told about a gap is a lawyer's statement, not a slice identifier",
      },
      "coverage_judgment.sufficient + reason — the sufficiency-to-sign decision": {
        class: "judgment", tokens: [],
        why: "the one lever that clamps CLEAR→CONDITIONAL; decided on the risk picture, never a count. NO TOKEN SPEAKS ABOUT IT — validateCoverageJudgmentRows() in findings-model.mjs is a deliberate loose passthrough except for rows[], so a missing or contradictory sufficiency judgment is unpoliced. E2's second half (a declared element with no validator that can speak about it) fires here",
      },
      "coverage_judgment.rows — the per-open-slice register": {
        class: "mechanical:code-extracted", tokens: ["findings_coverage_judgment_rows_invalid", "findings_coverage_judgment_row_key_unknown"],
        why: "the driver builds it from the coverage ledger and the plan-execution receipt (register-coverage-ledger.json + _driver/plan-execution.json). The prompt forbids typing it AND the driver replaces it, yet the parser still polices the shape — #850's ruling is to delete the field from the contract",
      },
      "mark_assessment.distinctiveness / connotation (prose or structured form: spectrum, read, per_class[], per_market[], acquired, note)": {
        class: "judgment", tokens: ["findings_mark_assessment_invalid", "findings_mark_assessment_key_unknown"],
        why: "the standing read of the applicant's own mark — spectrum placement and the flagged secondary reading exist only in the reasoning",
      },
      "mark_assessment.*.counter_registrations[].uri": {
        class: "mechanical:code-extracted", tokens: ["findings_mark_assessment_invalid"],
        why: "same class as the finding URIs — an opaque /mark/… token the frozen band already holds; M1's ordinal/handle selection covers it",
      },
      "four_answers[*].read / token / basis — third_party_rights, objection_likelihood, registrability, client_enforceability (+ registrability.obstacles[] rows)": {
        class: "judgment", tokens: ["findings_four_answers_invalid", "findings_four_answers_key_unknown", "findings_four_answers_read_missing", "findings_four_answers_token_invalid", "findings_four_answers_basis_invalid"],
        why: "explicitly not a computed score; the skill file forbids deriving them",
      },
      "four_answers[*].ordinals — which findings each answer rests on": {
        class: "judgment", tokens: ["findings_four_answers_ordinals_invalid"],
        why: "which findings ground an answer is a relevance call. Its SHAPE is already M1-compliant — an index into the driver's own finding set, not an opaque token — so nothing mechanical is left to move",
      },
      "actions[].id — 1-based unique": {
        class: "mechanical:code-assigned", tokens: ["finding_action_id_invalid", "finding_action_id_duplicate"],
        why: "code assigns ids; remapActionOrdinals (findings-model.mjs) already renumbers across consolidation",
      },
      "actions[].kind — the closed condition/advisory enum": {
        class: "judgment", tokens: ["finding_action_kind_invalid", "finding_action_condition_on_advisory"],
        why: "spec-64 doctrine: the author declares the kind from the legal read and code only partitions the enum — the named failure mode is a keyword grep over prose",
      },
      "actions[].text and actions[].condition": {
        class: "judgment", tokens: ["finding_action_invalid", "finding_action_key_unknown", "finding_action_text_missing", "finding_action_condition_invalid"],
        why: "the client-plain forward ask and the record-scoped fact it closes are authored prose",
      },
      "actions[].ordinals — the findings an action closes": {
        class: "judgment", tokens: ["finding_action_ordinals_invalid", "finding_action_ordinal_unknown"],
        why: "which findings a step closes is the legal link; the shape is already an index into the driver's finding set",
      },
      "actions[].deadline {kind, date}": {
        class: "mechanical:code-extracted", tokens: ["finding_action_deadline_invalid", "finding_action_deadline_key_unknown"],
        why: "the hard date is a register fact in the fetched record, same as the per-finding deadline",
      },
      "ask_answers[].ask — the requester's instruction retyped verbatim so the driver can join on it": {
        class: "mechanical:pre-bound", tokens: ["findings_ask_answers_invalid", "finding_ask_answer_invalid", "finding_ask_answer_key_unknown", "finding_ask_answer_ask_missing"],
        why: "the driver froze them at intake in _driver/intake-asks.json and hands them to the model in the same message it asks for them back — the matter-frame instructed-scope loop exactly",
      },
      "ask_answers[].answer (+ ordinals)": {
        class: "judgment", tokens: ["finding_ask_answer_answer_missing", "finding_ask_answer_ordinals_invalid"],
        why: "what was found / nothing found / not executed and why is the answer only the run's reasoning holds",
      },
      "context_notes[] {type, mark, owner, context} — the famous-neighbour ungrounded reference": {
        class: "judgment", tokens: ["findings_context_note_invalid", "findings_context_note_type_invalid", "findings_context_note_key_unknown"],
        why: "carrying a famous neighbour for diligence and stating why it is not a grounded conflict is the famous-neighbour rule in action; the `type` enum rides the envelope",
      },
      "the findings.json envelope — schema_version, the top-level and per-finding key allowlists, closed-enum membership, the forbidden retired composite/level/dispute_type keys": {
        class: "mechanical:tool-written", tokens: ["findings_unparseable", "findings_key_unknown", "findings_empty", "finding_invalid", "finding_key_unknown", "finding_legacy_scale_forbidden", "finding_composite_invalid", "finding_level_invalid", "finding_dispute_type_invalid"],
        why: "a structured-return tool writes the envelope and the model supplies values only. finding_composite_invalid / finding_level_invalid / finding_dispute_type_invalid are reachable on v≤3 replay only — no fresh v7 dispatch can emit them",
      },
      "rated_under_framework — the framework_key of the framework this rating reasoned with": {
        class: "mechanical:pre-bound", tokens: ["findings_rated_under_missing", "findings_rated_under_mismatch"],
        why: "THE SECOND frame_scope_missing. The driver holds the value in _driver/framework.json, writes it into the dispatch, asks the model to retype it, and fails the file when the retyping does not match its own copy. #850's table groups it under the tool-written envelope row; pre-bound is the sharper discharge and either removes it from the model",
      },
    },
    message: ({ paths: P, job, customerUnknown, profile, intakeAsks, enforcerSignals, framework, jxAim, registerOnly, crowdContext, dispatchBlocks, findingsSurface, depth }) => lines(
      // C4 — pharma matters (class 5 / pharma-shaped goods) FORCE-READ the field module: the
      // therapeutic-goods discipline, no-use ≠ safety (pipelines run 5-10y), practitioner/pharmacist
      // confusion. Conditional read (frameworkFor pattern); doctrine TABLES live elsewhere, untouched.
      reads(synthesisSkillReads({ profile, job })),
      `Produce the joint synthesis narrative (dominant-element spine, cross-pollination Option-D cap N=10, actual-use check, owner workup on high-risk findings, rate each conflict net of merits defences UNDER THE FRAMEWORK YOU JUST READ — state the likelihood of confusion in plain words, then give the band those words require under the framework's own definitions (the prose and the band are one judgment and may not disagree), coverage honesty).`,
      // — the prose rung. Empty on a one-country run, and `lines` drops it.
      proseRungDirective(depth, framework?.bands ?? null),
      // doc 50 — THE RATING AUTHORITY: the framework read above (the customer's own, or the Generic default)
      // rates this matter. All framework-derived strings below come from the FROZEN manifest — never hardcoded.
      framework ? `FRAMEWORK IN FORCE (the rating authority for this customer): ${framework.title} — rate every conflict by reasoning through ITS band definitions (Legal position first, then Practical position, then Potential outcomes — or its matrix where it states one). Its bands, highest to lowest, are EXACTLY: ${framework.bands.map((b) => b.label).join(" / ")}. Voice the client side as it does: "${framework.entity_label}". Where the framework states ceilings or matrix mappings, honour them exactly as written — they are its own anti-escalation mechanism; no practical or optics factor lifts a rating past what its stated method yields. A conflict ${framework.entity_label} clearly wins with no material risk is NOT a rated conflict: give it NO band — disposition "off-field" (commercial awareness) if worth the client knowing, else omit it. The framework's lowest band (${framework.bands[framework.bands.length - 1].label}) is for real-but-manageable residual risk — nuisance claims, weak strategic complaints, registration obstacles — never for clear wins.` : "",
      // C1 — marketplace risk is a RIGHTS question only where use creates rights. Data-derived
      // (jurisdiction-systems.mjs, conservative, unknown = unlabeled); empty when nothing is known.
      marketplaceScopeDirective(scopeTerritories(job, profile)),
      // D2 — provider enforcement telemetry, AIM-ATTENTION only (never a rating rule)
      enforcerSignals ? `ENFORCER SIGNALS (aim-attention only): ${P.enforcerSignals} carries provider enforcement telemetry for ${enforcerSignals} fetched record(s) (an "aggression" enrichment / actual opposition proceedings). Read it to AIM your owner-workup attention — an owner with real opposition history deserves the deeper enforcer read and a bears_on line grounded in it. It NEVER sets a meter or a rating by itself; absence of a signal proves nothing.` : "",
      // Phase 4 slice 3 — the jx nativeread flags, AIM-ATTENTION only (never a rating rule). DARK by
      // default: ctx.jxAim is set only when the aim artifact carries items on a live zh lane — absent
      // ⇒ byte-identical. The CLEAROTRON_JX_CONSUME gate that used to decide this went with item 8.
      jxAim ? `CHINESE-EVIDENCE FLAGS (aim-attention only): _driver/jx/aim-attention.json carries ${jxAim} structured flag(s) from a native-script read of the Chinese evidence slice (register conflicts a Latin-only read misses, CNIPA sub-class practice, squatter filing patterns, cultural meaning notes). Read it to AIM your attention — a flagged record deserves your own read of the underlying evidence. Its severity_hint values are triage hints for ordering your attention and NEVER set a band; items marked demoted:"lead" are UNGROUNDED (their cited record is not in the fetched slice) and may only be raised as leads for further searching, never as findings. You remain the sole rating authority under the framework above.` : "",
      // WS2 (spec 11) — ENFORCED, not advisory: validators.narrative HARD-REJECTS this file if a
      // use-dependent finding above the framework's lowest band asserts a use-negative without a searched
      // source line. So actually run the query.
      `USE-CHECK (enforced): for EVERY finding whose mitigant/verdict turns on the ABSENCE of use (regardless of its band) ("not in actual use", "unused", "no marketplace use found", non-use revocation/cancellation as the mitigant, "owner's use unknown"), run ONE scoped \`perplexity_research\` query (owner + mark + the goods/field) and END that finding's actual-use line with a literal "- **Use-check source:** <result URL | "perplexity_research — no result">" line. Mirror the result into the matching # Actions item (the deferred "confirm the owner's use" becomes a stated result). NEVER assert a use-negative you did not search — an inference from the owner's profile is not a searched result. On a perplexity outage write "- **Use-check source:** perplexity_research — no result" and proceed (the run still delivers). ALSO populate that finding's use_check field in findings.json: {"source": "<the result URL | perplexity_research — no result>"} — the structured field is the authoritative cite the report renders from (the prose line is for narrative readability).`,
      // Spec-v3 A4 — ENFORCED the same way (validators.narrative): own-rights reliance needs its evidence.
      // PR-8 review fix: synthesis holds the FROZEN band, not the live register — and the band is class-
      // and mark-text-scoped to this matter's dispatched slices, so the client's OWN house-mark
      // registrations (typically the client's home classes, mark text no slice covers) are STRUCTURALLY
      // INVISIBLE to an owner-scoped lookup here. The retired "own-portfolio sweep — no registrations
      // found" literal asserted a register-negative no sweep ever ran (on main this check WAS live) and
      // rendered into the client report as the authoritative cite — a factually false negative, the exact
      // twin of the use-negative the USE-CHECK forbids. The negative literal now states exactly what was
      // consulted, the prompt forbids reading it as a portfolio negative, and the un-answerable case gets
      // the instructed-check treatment: an open row naming the missing owner query for the escalation
      // lane / supplemental mint. own-rights.mjs accepts any text after "Own-rights source:", so the
      // validator contract is unchanged.
      `OWN-RIGHTS (enforced): if ANY finding's clearance reasoning relies on the client's own house mark / franchise root ("the prefix is the client's own registered mark"), run ONE own-portfolio check over the run's FROZEN register material — band_lookup with owner:<the applicant/house-mark owner> (plus band_record for any registration you cite) — and END that finding's reasoning with a literal "- **Own-rights source:** <record URI(s) | "no applicant-owned registrations in the searched register material">" line citing the record URIs the lookup returned. KNOW WHAT THE NEGATIVE MEANS: the searched material covers only this matter's dispatched slices (its classes, its mark texts), so an empty owner lookup is NEVER evidence the client's registrations do not exist — a house mark's own registrations usually live in the client's home classes under mark text no slice here covers. NEVER write "no registrations found" or any other portfolio-wide register-negative, and never leave the reasoning leaning on the unverified reliance: write the honest scoped negative, let the finding stand or fall without the crutch, AND record the un-run owner query (owner + house root + its home classes/key jurisdictions) as an open Coverage/open-item row so the escalation lane can propose it through the supplemental mint — the same treatment every instructed check the frozen material cannot answer gets. The affiliate-exclusion mandate covers CONFLICTS only — it never suppresses this supporting-evidence check. ALSO populate that finding's own_rights field in findings.json: {"source": "<comma-separated record URIs | no applicant-owned registrations in the searched register material>"} — the structured field is the authoritative cite.`,
      // CHANGE 5c (attribution source) — a named-entity attribution that is NOT itself a registry / common-law
      // record fact needs a source or it does not ship. (BEST EFFORT: the doc-30 Fix B exact spec is not in the
      // repo — this enforces the principle, not a verbatim spec; see residualIssues.)
      `ATTRIBUTION SOURCE: any narrative claim that ATTRIBUTES a mark or rights to a named entity by a fact that is NOT itself in the fetched register record or the common-law record — a corporate-history claim ("acquired by <X> in 2024", "now owned by <X>", "a subsidiary of <X>", "rebranded from <Y>"), a relationship claim, or any other off-record attribution — MUST either carry an inline source (attribute + link, the same fetch-before-cite discipline as a use-check) OR be omitted. Do NOT assert an acquisition / ownership-transfer / corporate-affiliation as bare fact from recall: ground it in a fetched source or leave it out. The owner name BOUND from the fetched record (keyed by the registration uri) is on-record and needs no extra source; it is the further attribution layered ON TOP that this rule governs.`,
      // Applicant-unknown runs (2026-06-18): no special candidate-self treatment. An identical hit is an
      // ordinary finding at its real tier, IN the overall rating — just flagged as possibly the applicant's own.
      customerUnknown ? `APPLICANT UNKNOWN on this run (the requester named no applicant). Run the clearance normally — do NOT guess the applicant from the mark, and do NOT downrank or exclude anything on that account. For any finding whose mark is IDENTICAL or near-identical to the searched mark in the searched classes, treat it as an ORDINARY adverse finding at its real tier and INCLUDE it in the overall rating, but append the single neutral line "- **Note:** if this is the applicant's own prior filing, disregard." so the reader can discount it. Do NOT use conditional "if unrelated… / if it is the applicant's own…" rating wording, and do NOT state the overall as "computed excluding" anything. Similar-but-distinct marks need no note.` : "",
      job?.commercialFlexibility ? `Commercial flexibility (verbatim from intake — sets the advice posture): ${job.commercialFlexibility}` : "",
      job?.priorUse ? `Client prior/intended use (verbatim from intake): ${job.priorUse}` : "",
      // P2-C (Round-2 §8a): the synthesis surface gets the SAME campaign-shape facts as the frames — the
      // verdict's launch-shape reasoning must quote the client's stated facts, never re-invent a shape
      // (house-brand attachment / seasonality / scale). Context, never a rule that decides a finding.
      job?.campaignShape ? `Stated campaign shape (verbatim from intake — how the mark will be deployed; facts, not judgment): ${job.campaignShape}` : "",
      `Inputs: register findings ${P.registerFindings}${registerOnly ? "" : `; common-law ${P.commonLaw}`}; placements ${P.placement} (structured tiers + reasons: ${P.placementModel}); matter frame ${P.matterContext}; manifest ${P.variantManifest}.`,
      PLACEMENT_BORDERLINE_NOTE,
      registerOnly ? REGISTER_ONLY_NOTE : "",
      // — THE DISPATCH RECORD, NAMED HERE AND DELIVERED AS DATA.
      //
      // This stage was told to produce "coverage honesty" and to emit a MANDATORY coverage judgment over
      // two machine artifacts it was never shown — while its own reviewer was handed the receipt as a
      // code-derived table and told to audit it. On the first delivered clearance that asymmetry cost a
      // fabricated enforcement history over a check that never dispatched, three named attributions the
      // reviewer deleted, and a blocked first pass. Both files are now declared inputs and both arrive as
      // driver-computed blocks (planAuditExtra / coverageLedgerExtra); the paths are named for authority,
      // the way the skeptic's twin names them, never as an instruction to go and read.
      //
      // ASSERT-OR-DEFER IS STATED ONCE, HERE. The three enforced contracts above — USE-CHECK, OWN-RIGHTS,
      // ATTRIBUTION SOURCE — are named instances of it, and this line says so instead of restating their
      // mechanics a fourth time. The general rule had never been written down at all, which is why the
      // classes those three do not cover (an owner's enforcement history) had nothing holding them.
      //
      // AND IT SAYS WHICH GROUND THE STAGE IS STANDING ON. Two earlier cuts of this line got that wrong
      // in opposite directions. The first named the two REGISTER artifacts and claimed the rule "governs
      // every layer" — read literally, that makes every common-law finding unassertable, because none of
      // it appears in a register receipt. The second gave the common-law layer a record of its own and
      // named common-law-findings.md as it. That file is the common-law stage's NARRATIVE, not a
      // receipt: treating it as proof a check ran is exactly how one stage's unsupported assertion
      // becomes the next stage's supported fact, which is 's shape and the shape this whole build
      // exists to stop.
      //
      // So: ONE layer has a driver-computed receipt and the line says which. Everywhere else the
      // standard is the one ATTRIBUTION SOURCE above already sets — a source that was read and can be
      // cited — and this points at that instance rather than inventing a second record.
      //
      // ── review, TWO CORRECTIONS, both in `synthesisRegisterRecordLines` above ────────────────
      //
      // (1) BOTH LINES USED TO PROMISE THE TABLE UNCONDITIONALLY while the blocks are best-effort, so on
      // a run with no frozen plan, an unparseable receipt or neither artifact the seat was told a record
      // was tabulated below and handed nothing. The branch reads the composer's own stamp of what it
      // built — never a second predicate guessing at the builders, which is the drift b0ac330 removed.
      //
      // (2) THE COMMON-LAW CLAUSE OVERSHOT. De-authorising `common-law-findings.md` wholesale also
      // de-authorised its `## Coverage ledger` section, which prelim-common-law/SKILL.md writes for this
      // seat ("feeds synthesis coverage-honesty") and synthesis-rules.md orders it to read before any
      // clean statement — two opposed instructions about one file in one dispatch. The carve-out is
      // DIRECTIONAL, which is what makes it safe: that ledger constrains (a `coverage-limited` row
      // forbids a clean negative) and never licenses (a `confirmed-clean` row is still the stage's own
      // word, so a clean claim still needs a source). 's shape stays blocked.
      ...synthesisRegisterRecordLines({ dispatchBlocks, paths: P, registerOnly }),
      // A3 (F5/F8) — the machine's own open items are FIRST-CLASS judgment inputs, not telemetry:
      // every reopen deferral and every skeptic flag must be weighed, and the weighing must LAND somewhere
      // a reader sees (a coverage[] row or explicit reasoned-immaterial prose) — never silently dropped.
      `SKEPTIC FLAGS + FRAME-REOPEN DEFERRALS: read ${P.skepticFlags} (the fresh-eyes audit flags) and ${P.frameReopenReceipt} (JSON; its "deferrals" array = search directives the machine declared material but could NOT close this run, each {directive, reason}). Weigh EVERY flag and EVERY deferral into your analysis: each one either (a) lands as a findings.json coverage[] row (state "open" or "not-searched", area naming the unswept item, note carrying the mechanical reason) so the reader sees the gap, or (b) is explicitly reasoned immaterial in the narrative (one line naming it and why). A deferral or flag that appears in neither place is a delivery failure the refutation reviewer will flag. Files absent ⇒ skip this directive.`,
      // A6 — the intake-ask contract: every explicit customer instruction is answered as a
      // LABELLED response, on this and every downstream surface.
      intakeAsks?.length ? `INTAKE ASKS (answer each as a LABELLED response — the four-link contract captured→executed→report→client starts here): the requester explicitly asked for these checks:\n${intakeAsks.map((a, i) => `  ${i + 1}. "${a.ask}" (owner: ${a.owner})`).join("\n")}\nSEND ONE "ask_answers" ENTRY PER ASK, as a TOP-LEVEL field of the findings record you hand to the call (never as a narrative section — the driver renders the labelled line into the narrative from these same entries): {"ask":"<the ask VERBATIM as listed above — the driver joins on it>","answer":"<the ANSWER ALONE — what was found / nothing found / NOT executed this run — <reason> — and nothing else>"}. THE "answer" FIELD IS NOT A LABELLED LINE, and you do not write one: the driver renders "- You asked: <the ask> → " and prints your "answer" straight after it, into the narrative AND into the report's code-built section. An "answer" that repeats the label or restates the ask ships the question to the client twice — "- You asked: EU register only → You asked: 'EU register only.' → Satisfied…" — which is the delivered defect this wording exists to stop, and a label you cannot write is a label you cannot double. Start "answer" at the first word of the answer itself ("Satisfied…", "nothing found", "NOT executed this run — …"). A paraphrased ask no longer matches and breaks the join. An ask that was NOT executed additionally gets a coverage row (state "open", area "intake-ask / <short>") so the verdict carries it. Never fold an ask's answer into generic prose — the typed entry is the contract.` : "",
      // judgment-relocation (2026-06-23): you are Layer B — the ONE judgment layer. The funnel ENUMERATED the
      // dangerous named band or reported HONEST INCOMPLETENESS; you read the complete material and decide
      // relevance, risk, sufficiency and prioritisation. PR-8: the reading goes through the band tools
      // (shape whole + logged lookups) — nothing was sampled away upstream, and nothing is sliced by hand.
      BAND_READING_CONTRACT,
      // PR-8: synthesis holds NO live register tools — by design, never an outage. The funnel owns
      // enumeration; a register check this stage still wants is either answerable from the frozen
      // material (the band tools) or it is NEW SEARCH WORK, which enters only through the supplemental
      // mint (a register-unit lane proposal / the escalation re-run) — never a live query from the
      // judgment seat (that is the un-frozen, un-audited search the plan freeze retired).
      `You hold NO live register tools on this stage — by design, never an outage or a permission fault; never report it as one. Register facts come from the band tools (the frozen, logged material); a register question the frozen material cannot answer is an honest open item for the coverage judgment, never a reason to improvise a search.`,
      // crowd-context (2026-07-22) — EVIDENCE to the coverage judgment, same posture as the enforcer
      // signals above (aim/evidence, never a rule): gated on ctx.crowdContext so a run without the
      // artifact sends a byte-identical message; the COVERAGE JUDGMENT dictation below teaches the
      // path unconditionally (files absent ⇒ that path simply never applies).
      crowdContext ? `CROWD CONTEXT (evidence for your coverage judgment — never a threshold): ${P.crowdContext} (readable mirror: ${P.crowdContextMd}) carries the driver's crowded-field evidence over ${crowdContext.slices} material un-enumerated slice(s): per-term live register counts, the same counts restricted to the in-scope classes, and — where the exact/near-identical subset was small enough — that subset FULLY enumerated, record by record. Read it alongside the named band's crowd descriptors before deciding coverage_judgment; the dictation below states how it may (and may not) be used.` : "",
      // MACHINE FINDINGS contract (findings-model.mjs).
      // The report + Excel are DATA-DRIVEN — every value comes from this JSON, so the rated
      // findings must be mirrored into it. Same compose-instruction style as the register MACHINE COVERAGE
      // LEDGER: dictate the keys + closed enums; qualifiers/nuance stay in the prose. The driver validates
      // it (validators.narrative) and the render consumes it; an absent file falls back to prose (legacy).
      `MACHINE FINDINGS (MANDATORY): beside the narrative sections, your record_synthesis call carries the findings record — a JSON OBJECT {"schema_version":${FINDINGS_SCHEMA_VERSION},"rated_under_framework":"${framework?.framework_key ?? "house-default"}","findings":[...],"coverage":[...],"context_notes":[...],"actions":[...],"ask_answers":[...]} (context_notes OPTIONAL — see the FAMOUS-NEIGHBOUR rule below; actions MANDATORY — see the ACTIONS REGISTER rule below; ask_answers — see the INTAKE ASKS rule: MANDATORY when the run carries intake asks, omit otherwise). Put ONE object in findings[] per finding in your narrative — RATED findings (they carry a band) AND the unrated off-field commercial-awareness items (disposition "off-field", NO band). What you do NOT deliver you DECLINE, by name — see DECLINATIONS below; there is no silent omission left. Each finding object has EXACTLY these keys: {"ordinal","mark","owner","band" (rated findings only),"net" (MANDATORY on every finding a reader sees — the one-clause read; see THE ONE-CLAUSE NET below),"borderline_between" (OPTIONAL, rated findings only — see THE BAND below),"disposition","meters","quadrant","source","legal_position","practical_position" (BOTH, on EVERY finding),"off_field_ground" (off-field findings only),"manageable" (notable-but-manageable findings only)}. The retired composite/level/dispute_type keys are FORBIDDEN — the validator rejects them.`,
      `- ordinal: 1-based integer in your "Finding N" order, unique. mark: the conflicting mark text, verbatim as it appears in the narrative.`,
      `- owner: {"name","country","registrations":[...]}. registrations = ONE object PER REGISTRATION the owner holds for this mark — ONE registration = ONE record "uri" (one owner with two Class-41 regs = two registration objects). Each registration: {"uri", optionally "classes":["9","41"],"status","filed","expiry","jurisdiction"}. The "uri" is the ONLY field that matters: the driver BINDS classes/status/filed/expiry/jurisdiction AND the owner name from the FETCHED record keyed by that uri, so you do NOT need to fill them and must NEVER invent or transpose a number, date, status or class. Any structured field you do include is a HINT and is OVERWRITTEN by the record; a uri with no fetched record shows "register-index entry — full record not pulled this run", never your typed values. A common-law finding with no registration → "registrations":[].`,
      `- band: the framework's band WORD, EXACTLY as the framework writes it${framework ? ` (one of: ${framework.bands.map((b) => b.label).join(" / ")})` : ""} — the band your reasoning through the framework's own definitions yields. THE BAND FOLLOWS THE WORDS: your prose likelihood read and the band may not disagree. Never a number, never a code, never a word from another framework's ladder. Where the framework states ceilings or a matrix, the band is what its stated method produces — an aggressive enforcer / owner size / partnership moves the framework's INPUTS (the legal or practical read), never the output band. Emit band ONLY on rated findings (dispositions adversarial / coexistence-partner / distinguished); an off-field awareness item carries NO band.`,
      // item 10 — the DECLARATION, stated once in BAND_BORDERLINE_NOTE and appended wherever the field is
      // named. It is not a band criterion and must never become one; see the note's own doc block.
      `- borderline_between: ` + BAND_BORDERLINE_NOTE,
      // item 9a — the one sentence that is ALWAYS visible. Written once here, rendered by the card and
      // the MCP brief.
      // (ruled 2026-08-06) — it is a CONCLUSION, not a chain. The old dictation specified a
      // semicolon-chained rights→facts→consequence sentence and this line restated that shape in full, so
      // a rewrite of synthesis-rules.md alone would have left the prompt teaching the retired form. The
      // two mechanical marks (semicolon, arrow) are now refused by the parser (findings_net_chained) and
      // named by the pre-delivery lint (net-conclusion-form); the reasoning MOVES to the two positions
      // below, which is why the "do not shorten" rule survives the change unaltered.
      `- net: THE FINDING SENTENCE — MANDATORY on every finding that reaches a reader (the parser REFUSES the file without it: finding_net_missing). It is the single sentence a reader sees before anything else on this finding's card, the sentence the grouped-negative line states, and the one the client brief lists it by. Since #243 it is the ONLY per-finding summary anywhere in the report: the card no longer authors its own one-liner and there is no "The read" section — a finding with no net reaches the reader with a risk chip and no sentence. IT IS A CONCLUSION, NOT A CHAIN (#469): ONE sentence answering the one question a lawyer asks of this finding — IS THIS A PROBLEM FOR ME. Name the parties and the territory and state the outcome as a likelihood ("Veltra Labs' registered VELTRA is more likely than not to prevail against VELTRA PHARMA in the United States."; "Nothing on the German register reaches the applicant's class-9 goods."). NO SEMICOLON-CHAIN, NO "→", NO CONSEQUENCE CLAUSE ON THE END — the parser REFUSES a net carrying a semicolon or an arrow (findings_net_chained). If the sentence needs one to hold together, what you are writing is reasoning, and reasoning goes in legal_position / practical_position, which the reader opens the moment this sentence says yes. THE REASONING MOVES, IT NEVER DISAPPEARS: every clause the retired chain carried — territories, the goods paraphrased to the WORST overlap ("(among broad goods)" as the scope-limiter), the owner's actual business, status and use history, revocation exposure — is still owed IN FULL in those two positions. A net that got shorter because the reasoning got thinner is the one rewrite this ruling rejects. DO NOT RESTATE THE BAND: the band word is the verdict and renders as the card's own chip beside this sentence; say what is true of the world instead. NEVER AN ACTION PRESCRIPTION: no recommended step, no "the practical path is…", no imperative aimed at the reader — the reader is a lawyer who layers their own advice on top, and what a human must do lives in the typed actions register. A standalone sentence: capital letter, full stop, and read it back for number agreement. There is NO length cap and none is coming — a conclusion is short because it is a conclusion, never because it was trimmed; never drop a fact to fit, move it below. ITS SHAPE is specified in synthesis-rules.md → "The finding sentence — the shape of the typed net" (#253, re-ruled #469). Read that section before writing your first net.`,
      // CHANGE 2 (disposition) — the per-finding PLACEMENT enum the report bands by. You ALREADY reason this in
      // the narrative ("a documented coexistence stands on the record", "distinguished by the house mark",
      // "same token, different field"); name it as a typed token. It sets PLACEMENT/ORDER ONLY and NEVER touches the
      // band (that is fixed above): a coexistence-partner still renders in the manageable section while an
      // adversarial finding of the same band leads the on-field section. Emit it on EVERY findings[] object.
      `- disposition: EXACTLY one bare token of: ${POSITION_REQUIRED_DISPOSITIONS.join(" / ")} — the realistic posture of THIS conflict, which sets only where the card is placed in the report (it NEVER changes the band you set above). THE FIFTH TOKEN THE PARSER ACCEPTS IS "withdrawn", AND IT IS NOT A POSTURE: it is how a CORRECTIVE pass kills a finding it has concluded is wrong — the row stays in findings.json for the audit surface and renders nowhere. Do not reach for it on a first pass; do reach for it rather than leaving a finding you believe is wrong standing, which is what the four above would force. Pick by your own narrative reasoning, not by the band: adversarial = a bare / near-identical mark in the applicant's CORE classes whose owner is capable AND willing to block (the conflicts that drive the verdict); coexistence-partner = a client partner, or a documented coexistence stands on the record (notable but manageable); distinguished = distinguished by a house mark / added matter / a famous-but-different word (notable but manageable); off-field = NOT a rated conflict — the same token in a different commercial field, or a conflict the client clearly wins with no material risk, worth the client knowing (commercial awareness only; NO band; and it must declare WHICH of those two grounds it rests on — see off_field_ground below). Off-field is a claim about the FIELD or about a clear win, never about the mark: a mark you have argued apart on sound, rhythm, orthography or connotation is "distinguished" and carries a band, however different the two businesses look. COMMERCIAL AWARENESS IS MAJORS ONLY (§L): an off-field item earns its place ONLY as a major brand / an active dispute or proceeding / a well-known enforcer — an off-field name that is none of these is OMITTED (it is watchlist noise, not awareness); there is no third state between "worth a lawyer's line" and "omitted". When in genuine doubt between adversarial and coexistence-partner, the question is whether the owner would actually block — not how severe the band is. RULED-OUT (doc-52, OPTIONAL): if an off-field item shares NO word or sound with the applicant's mark — a concept/genre neighbour, a same-theme name under a DIFFERENT word (e.g. "UNTAMED" surfacing against "OPEN COUNTRY") — additionally set "ruled_out": true and a short plain "ruled_out_reason". §L: that reason NAMES THE SPECIFIC POINT that was checked and settled it — the word or sound it does not share, the field it sits in, the register entry that decides it ("shares the theme, not the word: UNTAMED against OPEN COUNTRY, no common element") — never a generic dismissal ("not relevant", "different field", "no overlap"). ONE line, about 20-25 words: a reviewing lawyer must be able to see WHAT was looked at without opening anything. It then renders in a quiet "Also considered — ruled out" list, not as a commercial-awareness conflict. Do NOT set ruled_out on anything that shares a word or sound with the mark (that is a real conflict, however weak).`,
      // P5 (charter 2026-07-30, Reviewer §L) — the content model: legal and practical SEPARATED on every
      // rated finding; the manageable band requires a category + reason (promote-or-omit); common-law
      // findings ride the SAME rating machinery; crowding is per-market only. Structured fields are
      // OPTIONAL in the parser (archived runs) but dictated here — a fresh run that omits them is
      // flagged by the predelivery lint, never validator-thrown.
      // requirement 1 — no disposition is structurally exempt. On the 08-02 VENZY run all four
      // off-field findings carried `net` and NEITHER position, while every adversarial and distinguished
      // finding carried both: the class of finding most likely to be challenged was the only class with
      // no reasoning structure. The validator now rejects the omission on every disposition that reaches
      // a reader; this states what an off-field one has to say.
      `- legal_position / practical_position (BOTH, on EVERY finding — adversarial, coexistence-partner, distinguished AND off-field alike; there is no disposition that carries a label without a stated ground): the two reads, SEPARATED — never blurred, never averaged. legal_position = ONE-TWO sentences of the LEGAL read alone: mark similarity × goods/services proximity × the senior right's scope, under the framework's own definitions (high similarity + high goods proximity = HIGH legal risk, whatever the owner's posture). practical_position = ONE-TWO sentences of the enforcement REALITY: owner posture and capability, marketplace presence, coexistence history, a delisted retailer / no visible revenue — practical facts stated ALONGSIDE the legal read. The band is what the framework's own method yields from BOTH positions as IT states them; a practical fact NEVER discounts the legal read in-line ("high similarity but the owner looks dormant, so call it low" is the averaging this field split forbids — write the high legal read, write the dormancy as practical, and let the framework's stated method produce the band). FACTS THAT CONDITION, NEVER ADVICE (the overall_caption rule, same voice): they state what IS, never a step to take. WHO READS THEM DEPENDS ON THE FINDING (#1339 D3): a RATED finding gets a report-card, and that card is the client's single authored wording, written FROM these fields — so write them TIGHT, the reads and the facts that carry them, never a second client paragraph the report will not print beside the card. An OFF-FIELD finding gets NO card, and there these two fields ARE what the client reads. NEVER prescribe ("narrow the goods", "seek consent before filing", "file first", "add a disclaimer") and NEVER use advice grammar ("we recommend", "you should", "the practical path is") — every forward ask lives in the actions register, code-built from it; a prescription typed here is a delivery defect the lint flags. ON AN OFF-FIELD FINDING the two reads are the same two reads, sized to the negative: legal_position states the legal read that makes this NOT a rated conflict (what the senior right actually covers, and where its scope stops short of ours); practical_position states the enforcement reality behind that (who the owner is, what they actually trade in, whether they have ever asserted). "Off-field" is a conclusion, and a conclusion states its ground.`,
      // requirement 2 — the label follows the argument. off-field had been carrying TWO different
      // claims under one token; the author now declares which, and a field claim is checked against the
      // finding's own goods meter (findings-model.validateOffFieldGround).
      `- off_field_ground (MANDATORY on every off-field finding, FORBIDDEN on every other disposition): EXACTLY one bare token of: ${OFF_FIELD_GROUNDS.join(" / ")}. "different-field" = the goods/services genuinely do not meet — a claim ABOUT THE GOODS, and the validator checks it against your own meters: a different-field finding whose goods_proximity is not "low" is REJECTED, because one record cannot say "a different commercial field" and "the goods are proximate" at the same time. "no-material-risk" = the framework's clear win — a conflict ${framework ? framework.entity_label : "the client"} plainly wins, worth the client knowing, carrying no field claim at all. THE LABEL FOLLOWS THE ARGUMENT: if what separates you from this mark is the MARK — its sound, rhythm, syllable count, orthography, connotation — then the disposition is "distinguished", NOT off-field, whatever the fields are. "Placed off-field on rhythm" is a mark argument wearing a sector label, and a reader who is told a proprietor is not in our field when the goods wording covers ours has been given a conclusion with the wrong reason attached. Where the goods overlap and the marks are argued apart, say "distinguished" and rate it.`,
      `- manageable (MANDATORY on every notable-but-manageable finding — dispositions coexistence-partner / distinguished): {"category":"<EXACTLY one of large-competitor / commercial-partner / troll / well-known-enforcer>","reason":"<one-two lines: WHY this finding is manageable for THIS client — the fact that makes it notable-but-not-blocking>"}. PROMOTE-OR-OMIT: a finding you would place in the manageable band that fits NONE of the four categories is either relevant enough to drive the read (make it disposition adversarial — it belongs in the on-field section) or not worth the lawyer's line (omit it) — never a category-less parking spot. Never put manageable on an adversarial or off-field finding. FACTS THAT CONDITION, NEVER ADVICE (the overall_caption rule, same voice): these fields render VERBATIM on the report — they state what IS, never a step to take. NEVER prescribe ("narrow the goods", "seek consent before filing", "file first", "add a disclaimer") and NEVER use advice grammar ("we recommend", "you should", "the practical path is") — every forward ask lives in the actions register, code-built from it; a prescription typed here is a delivery defect the lint flags.`,
      `COMMON-LAW PARITY: a common-law / marketplace finding gets THE SAME rating machinery as a register finding — the framework's band by the same method, the same meters, the same legal_position / practical_position split, the same disposition logic (and manageable where it applies). The renderer keeps common-law in its own section (a different LEGAL BASIS — unregistered rights), but the section split is presentation: never leave a common-law conflict unrated, half-metered, or rated on a softer scale because its source is marketplace/web rather than a register.`,
      `CROWDING IS PER-MARKET ONLY (§L): every crowd / dilution / "crowded field" statement — in the narrative, a finding's reasoning, legal_position, or coverage prose — NAMES the market it was counted in (jurisdiction × goods lane: "the US class-32 register carries ~N live TIKI-formative marks"), because that is the only lane where the dilution is earned (the WP-56 rule above). A GLOBAL crowd statement ("the field is crowded", "TIKI is diluted worldwide") is FORBIDDEN on every surface — volume elsewhere earns nothing here, and a global sentence is how it leaks.`,
      // RATING CALIBRATION CHALLENGE (judgment-not-rules): symmetric self-check answered BEFORE committing each finding's band. The engine's guardrails all police OVER-rating; this adds the missing UNDER-rating probe and forces the band to match the prose, both directions. Not a formula — a question the reasoning must answer.
      `RATING CALIBRATION CHALLENGE — for EACH rated finding, before you commit its band, answer the one that applies (this is symmetric: it catches BOTH over- and under-rating, and the band MUST match your own prose):
      (a) OVER-RATING check — if this finding's own reasoning says the marks are "distinguishable as wholes", or "better-than-even is not reached", or there is no real commercial overlap (the senior's actual use does not meet ours), or the shared dominant element is a heavily-diluted crowded element, then the read belongs in the framework's LOWEST band — or is not a rated conflict at all — never the middle band: a crowded field is a CEILING that lets you reach the client-favoured read, never a FLOOR that parks an over-threshold mark in the middle (synthesis-rules.md → "the band follows the words" posture + "Crowded field analysis"). Do not pull a mark down one band and then stop when the same reasoning carries it lower.
      (b) UNDER-RATING check — if this finding is an ACTIVE same-field brand operating in the applicant's CORE classes (a live competitor whose own marketplace use actually MEETS ours), it is a genuine conflict ABOVE the lowest band: do NOT hold it at the lowest band on a mark-shape distinction alone (an onset-letter / one-keystroke difference the market would not notice), and do NOT let a "sheet-2 / lower-tier" placement carry it down by default. Set its disposition=adversarial and rate it on the use-meets-use read (typically the framework's middle band) — OR state explicitly, in one line, why the two uses do NOT meet in the market. An active in-field competitor is not diluted away by a crowd.`,
      // WP-56 (VIBRANTE): the calibration checks kept leaking on three evidence bases — the senior's trade
      // dress read the registration down, a remote-jurisdiction crowd diluted a local right, and the (b)
      // escape hatch accepted a sub-occasion read where the registered goods/channels/consumers meet. This
      // pins the BASIS both checks are answered on; THE KEEP preserves the legitimate
      // different-lane-within-a-class defence (the goods-meet vs manner-of-use-distinguishes pair).
      `USE-MEETS-USE BASIS (governs BOTH checks above): "the uses do / do not meet" is judged against the senior right's OWN scope — for a REGISTERED senior, the mark AS REGISTERED and the G&S AS REGISTERED (read the specification; quote it when it decides the point) against the applicant's intended goods and channels; for a COMMON-LAW senior, their actual trade. OUR side stays our own actual/intended manner of use per the request form — that Stage-1 lever is untouched. Three bases NEVER establish that the uses do not meet: (i) the senior's current presentation / trade dress (how the owner happens to dress or position the mark today informs Stage-2 enforcement reality only — it never narrows the registered right); (ii) a consumption-occasion / sub-category distinction inside a goods lane where the registered goods, channels and consumers already meet (a different "moment" or "occasion" is not a different market); (iii) distancing mined from a use-check that CONFIRMED same-class, same-channel use (a confirming receipt cannot be re-read as a distinguishing one). THE KEEP: a genuinely different lane WITHIN a class — a different shelf, channel, consumer or purpose, read from the REGISTERED specification — remains a full Stage-1 defence carrying the read to the lowest band or out of the rated set; the class number decides nothing in either direction. And dilution is earned per conflict: a crowd counts for THIS conflict only when counted in THIS conflict's jurisdiction × goods lane — volume elsewhere earns nothing here.`,
      // WP-56 — the response may not stand in for the rating: reconcile the recommended path with the band's
      // own Practical-position words, with carve-outs so the question cannot inflate bands or add noise.
      `RESPONSE-BAND COHERENCE — if a finding's recommended path is consent / coexistence / settlement before filing, state in ONE line which band's Practical position those words describe under the framework in force — or why the response addresses only prosecution mechanics / nuisance posture (the lowest band's own practical words). Carve-outs: a documented EXISTING coexistence agreement is a FACT about the conflict, not a response (it does not trigger this line); a consent sought to clear a routine citation can be a legitimate lowest-band "registration obstacle". The line reconciles — it never moves a band by itself.`,
      `- meters: {"mark_similarity":{...},"goods_proximity":{...},"use":{...},"enforcer":{...}} — all four present, each {"token","basis","source"}. token — EACH SET IS CLOSED AND EACH IS STATED ON ITS OWN LINE, so read the one you are filling in: mark_similarity = high | medium | low. goods_proximity = high | medium | low. enforcer = high | medium | low | unknown. use = confirmed | not-confirmed | unknown. NEVER write "unknown", "n/a", "unclear", "tbd" or "none" as the token on mark_similarity or goods_proximity — those two carry no indeterminate value, the file is REJECTED for it, and a clearance has already lost eleven minutes to that one word. Where goods proximity is genuinely open — a broad specification, the actual trade unstated, classes that neither meet nor plainly diverge — that is still a judgement you can make from the wording in front of you: pick the closest band ("medium" is the honest middle), and say in that finding's own reason and prose that the specification leaves it open and why. Rating it is not a claim to certainty; refusing to rate it is not a move you have. These are the COARSE 3-pip strengths — the precise position lives in quadrant. basis: verified-from-record (asserted from a fetched record/filing) or inferred-from-signal (reasoned from a proxy, e.g. "uses a good law firm"); the enforcer's basis is the one the report surfaces as "verified" vs "inferred" (B1 — never present inferred as fact). source (spec-48 A4): MANDATORY whenever basis is "verified-from-record" — the /mark/… record URI or the exact URL the claim actually rests on (the validator REJECTS a bare verified stamp: finding_basis_source_missing); omit it (or "") on inferred-from-signal. The driver machine-joins each source to the run's fetch receipts and presents an unjoined "verified" as assumed — so name the real source, never a plausible one. SENIOR-RIGHT SOURCE (WP-receipts, 2026-07-05): when a finding's owner holds SEVERAL registrations of the same mark, the verified source must be the SENIOR live leg — the earliest applicationDate among live legs, registered before pending (the batch-screen rows carry the dates). Never cite a junior leg as the verified basis when a senior live leg exists in the cluster; the driver's senior-right closure will fetch and re-bind it anyway, so citing the junior leg only wastes a fetch.`,
      `- quadrant: {"x","y"} numbers in [0,1]. x = goods/services proximity (0 = distant, 1 = identical). y = mark similarity (0 = distinct, 1 = identical).`,
      `- source: {"source_type","resolved_link"}. source_type EXACTLY one of: register-vendor / register-euipo / common-law-marketplace / common-law-web / case-law (the finding's ACTUAL source — a common-law finding never wears a register tag, E2). resolved_link = the record URL you ACTUALLY fetched/cited for this finding (the same link in your Record line), or "" if none.`,
      `coverage[]: ONE object per coverage AREA, EXACTLY {"area","state","note"}. area = the area name (e.g. "register / EU", "common-law / US marketplace"). state EXACTLY one of: confirmed-clean / coverage-limited / open / not-searched / note. note = a short qualifier (or ""). Write area + note in PLAIN client English — a lawyer reads this panel. NO internal engine idioms: never "slice", "crossed into the band", "null class/owner/status", "unadjudicable", "enumerated-empty", "in-scope subset", "reopen pass", or cell-matrix / saturation / fetch-count telemetry. Say what was and was not searched, and why, in words a client understands.`,
      // P6 (charter §7 "Coverage prose is the worst offender and nothing governs it") — the coverage
      // lane's own prose contract. Two of the four longest sentences in the delivered report were
      // coverage/gap prose, and NOTHING governed it: the code-stamped `coverage_line:` front-matter
      // (scope-facts.mjs,) is EXCLUDED from predelivery-lint's prose scan by design
      // (stripFrontMatterBlock, predelivery-lint.mjs:372), so a coverage number re-typed into prose
      // beside it is caught only if the prose form itself trips SCOPE_NUMBER_RE — which the narrative's
      // own phrasings routinely dodge. Prompt-only per §7; the fix is to stop authoring the duplicate.
      `COVERAGE PROSE (the lane that runs longest — hold it to the house budgets): the register coverage line a reader sees is COMPUTED from this run's own record and STAMPED BY CODE as front-matter (the proportion, the class states, the searched registers). Do NOT re-type its numbers anywhere in prose — not in a coverage[] note, not in the coverage_judgment reason, not in the narrative. Nothing catches the duplicate for you (the code-stamped line sits outside the prose checks precisely because ITS numbers are the authoritative ones), so a re-typed count does not disagree with the record — it silently drifts from it a redelivery later. Carry the SUBSTANCE and drop the number: "the remaining forms are non-Latin script" says the useful half; the code says how many. State each coverage fact ONCE, in ONE place — an area's state belongs in its coverage[] row, the sufficiency read belongs in coverage_judgment.reason, and neither is re-narrated in the other or in the findings. And say WHICH KIND of negative you hold every time: a source this run actually queried and got nothing from reads "searched — none found"; a source it did not reach reads "not searched this run" or "could not be searched — <the reason>". The same source must never wear both readings in one report.`,
      `- use_check / own_rights: OPTIONAL per-finding objects; populate per the USE-CHECK / OWN-RIGHTS rules above. use_check = {"source","quality"}: source is the cite of record the report renders — MANDATORY (spec-48 A4, symmetric) for ANY ASSERTED use status (token "confirmed" OR "not-confirmed") on a finding banded ABOVE the framework's lowest band, not only use-negatives (the validator rejects an asserted use with no receipt: finding_use_check_missing); "unknown" needs none. quality: OPTIONAL, EXACTLY one of owner-site / independent / register-mirror — your read of what KIND of page the source is (the code re-derives its own classification and wins; a register mirror is never evidence of use). own_rights = {"source"} — MANDATORY for any own-rights-reliant finding.`,
      // U3 (probative grading) — a risk-RAISING signal must say what it proves about THIS conflict.
      `- bears_on: a string, MANDATORY whenever this finding's enforcer meter is "high" (and good practice for any other risk-RAISING adjustment): one line on what the fact proves about THIS mark against THIS owner's rights on the disputed element — e.g. "owner has asserted <element> against comparable <goods>", NOT a bare "aggressive enforcer". A default win on a different element, or against an obvious copycat, does not count: if you cannot say why it bears on this confusion, the fact is annotation and the enforcer meter is not "high".`,
      // doc-35 T1 (authority grounding — fetch-before-cite, like use_check/own_rights): an enforcement AUTHORITY
      // is "verified" ONLY when its OWN record was fetched. A vendor-record MENTION of an opposition is a LEAD.
      `ENFORCEMENT AUTHORITY — grounded or it is a LEAD: a named proceeding / opposition / decision cited as the enforcer basis (an opposition no., a case cite, a "sustained" holding) carries enforcer basis "verified-from-record" ONLY if its OWN authority record (the TTAB / court docket) was fetched THIS run. A register-vendor record's MENTION of an opposition (the entry appearing in a fetched Corsearch/EUIPO record) is a LEAD, not a verified authority → set enforcer basis to "inferred-from-signal" and write bears_on as "vendor-record lead — not independently verified", NEVER "sustained / verified / established on the record". Do NOT then add a "verify against TTABVUE/the docket before relying" action: the lead framing already IS the honest analysis, and the card and the actions must never contradict each other (one cannot say "verified" while the other says "verify"). An ungrounded authority NEVER lifts the legal letter (it stays clearance-timing/awareness, not confusion that raises the level).`,
      // Three-tier risk — tier 3 IMPACT (synthesis-rules.md → Reasoning posture 4 + per-finding item 9).
      // 2026-07-21 — the old wording ended "…tied to the client's ACTUAL use as the matter states it (brand
      // printed on physical stock already shipping vs. a removable app listing; the scale + reversibility of
      // the use)". That parenthetical was an EXEMPLAR, and one exemplar issued once for a whole findings set
      // becomes a template: quartz-anvil shipped "a removable storefront label, not physical stock already
      // shipping … low-cost and reversible" near-verbatim on two unrelated findings, and the customer's own
      // framework licenses no such medium discount. Worse, a medium-based default is ALWAYS available, so it
      // silently defeated the "omit where the record says nothing" instruction. Removed, not policed: the
      // replacement demands derivation from THIS record and names no medium, category or industry, so there
      // is no phrase left to pattern-match. Deliberately NOT backed by a lint — impact never moves a rating,
      // so a checker here would be Goodhart bait on advisory prose.
      `- impact: OPTIONAL string, ONE line, ONLY where THIS matter's record states facts bearing on exposure: what the client has actually committed (launch spend, localization, channel or franchise commitments, contractual obligations, inventory or stock the record names, timelines the client stated) and what enforcement would practically cost them — injunction scope, damages / account of profits, reputational harm, legal costs. CITE the record fact your line rests on, so a reader can check it. MEDIUM-NEUTRAL: digital goods are goods; "not yet shipping"/"not yet launched" is a fact to REPORT, never a discount to apply; reversibility or cost-to-change is claimable ONLY where the record establishes it, never inferred from the kind of product or channel. Where the record supports no such fact, OMIT the key — do NOT substitute a general expectation about this category of product. SURFACE it for the client's OWN risk-acceptance decision: do NOT conclude whether it is acceptable, and it NEVER moves the band (impact is surfaced beside the rating for the client to weigh).`,
      `Do NOT write aggregate threshold judgments ("all High findings carry X", "every rated finding is Y"); cite per-finding in each findings[] object. Aggregate COUNTS ("640 live filings") are encouraged; aggregate RULE statements are not.`,
      `Every finding in your reasoning gets ONE findings.json object (rated ones carry a band; off-field awareness items carry none) — never invent a finding not in your reasoning; a record you are not delivering is DECLINED by name (see DECLINATIONS), never dropped in silence. The narrative is your reasoning; the JSON is the machine-readable judgment that builds the report and Excel, so accuracy in the structured fields (band, disposition, meters, quadrant, source, use_check, own_rights) is what matters. If a value is genuinely unknown, use the "unknown"/"" token rather than omitting the key.`,
      // ── — DECLINATIONS. The half of this stage's judgment no artifact ever held. ────────────
      //
      // Measured on R2 round e48f7056: 102 records reached this stage's findings surface and stopped
      // there, and the run could say only THAT synthesis had stopped them — `reason_source:
      // step-silent`, one sentence for all 102. A record dropped that way is unexplained in both
      // directions: the run cannot say why, and nothing downstream can reconstruct it.
      //
      // The list is DRIVER-PRINTED and the seat cites by POSITION, so a record it was never handed is
      // one it cannot speak about — the same shape as doubt-closure's ids and matter-frame's instructed
      // scope. `findingsSurface` absent ⇒ this whole block is absent: a stage that was handed no
      // list is not ordered to answer one, and a dictation that asked for declinations against nothing
      // would be ordering an empty ritual.
      // THE ORDER IS UNCONDITIONAL; ONLY THE LIST IS NOT. The first draft gated this whole block on
      // `findingsSurface`, reasoning that a stage handed no list should not be ordered to answer one.
      // 's agreement guard refused it, and it was right: `record_declination` was then a tool the
      // grant carried and no dictation mentioned — "granted-but-never-ordered", which is the silent
      // capability hole in the other direction, and the one that shipped before. A seat that is never
      // told a tool exists does not use it, and nothing records that it did not.
      `DECLINATIONS: what you do not deliver, you decline BY NAME through the \`record_declination\` tool. A record that reached your findings surface leaves this stage as a finding in ${P.findings} or as a declination, and there is no third way out.`,
      ...(Array.isArray(findingsSurface) && findingsSurface.length ? [
        `DECLINATIONS (MANDATORY): the register digest carried ${findingsSurface.length} record(s) onto your findings surface. Each one leaves this stage by one of two routes and there is no third: it becomes a finding in ${P.findings}, or you decline it BY NAME with a reason and a ground. A record you simply do not mention is reported as a defect of this run, named individually in its trace and shipped as an open doubt, so silence costs you more than a declination ever will.`,
        `Decline by calling the \`record_declination\` tool. Its schema names the fields it takes and what each is for — read them there, not here. The one thing to know before you call: you cite a record by its POSITION in the list below — there is no field for a mark name or a uri, so a record you were not handed cannot be expressed at all. The reason vocabulary is closed: ${DECLINATION_REASON_TOKENS.join(" / ")}, each an omission synthesis-rules.md already authorises, and if your ground is none of them the rules do not let you omit the record. The grounds you write are one or two lines in your OWN words on why THIS record does not earn a line — never machine-parsed, and what the reviewing lawyer reads. Send them in one batch where you can; a refused row never voids its neighbours, and the answer names what is still undecided so you can finish in this turn.`,
        `A REFUSAL FROM THAT TOOL IS ABOUT BOOKKEEPING, NEVER ABOUT YOUR LEGAL JUDGMENT. There is exactly ONE case: declining a mark IDENTICAL to the applied-for mark, live, in one of the matter's own filed classes, on a discretionary ground — because synthesis-rules.md orders that an on-point identical mark in the relevant class is never dropped, "regardless of filer profile", so such a declination contradicts the instruction you are already following. Nothing else is refused. If that record really is the applicant's own, or already delivered under another record, say exactly that with own-right or duplicate-of-delivered and it is accepted. Whether goods are related, whether a name is off-field, whether a conflict is worth the line — those are your calls and the tool does not have an opinion about any of them.`,
        `The records on your findings surface, by position:`,
        ...findingsSurface.map((r, i) => `  ${i}. ${r.mark ?? "(unnamed)"}${r.owner ? ` — ${r.owner}` : ""}${r.tier ? ` [${r.tier}]` : ""}${r.uri ? ` ${r.uri}` : ""}`),
      ] : []),
      // A1 — the home for a famous neighbour the famous-neighbour rule keeps but no record grounds. WITHOUT
      // this, such a mark was forced into findings[] with an empty-uri registration, which the F-14 URI guard
      // (rightly) hard-rejects — the crash this fix closes. Keep it OUT of findings[]; never fake a registration.
      `FAMOUS-NEIGHBOUR / UNGROUNDED REFERENCE (context_notes): a mark you carry for diligence because it is a famous one-keystroke or homophone NEIGHBOUR of the searched mark (the famous-neighbour rule — never dropped) but for which you fetched NO register record AND cited NO common-law record — i.e. it is known only from general knowledge (e.g. CHROME on a KROME clearance) — is NOT a finding. Do NOT put it in findings[], and NEVER invent a registration for it: an empty-uri registration, or a register source_type on a knowledge-only mark, is REJECTED (no finding may ship without a fetched record). Instead add it to the top-level "context_notes" array — each object EXACTLY {"type":"famous-neighbour-ungrounded","mark","owner","context"}: mark = the neighbour verbatim; owner = the holder if known (omit the key if not); context = one line on why it is noted and why it is not a grounded conflict (the field divergence / no record fetched). A context note carries NO band/meters and NEVER moves the overall rating. If the neighbour IS a real conflict, do the opposite — GROUND it (fetch a representative registration so it carries a real uri) and keep it as a normal finding.`,
      // judgment-relocation (revised 2026-06-24): the SUFFICIENCY decision lives HERE, in judgment — never in the
      // funnel. You read the complete band + the `incomplete` crowd descriptors and decide whether the dangerous
      // picture is complete enough to SIGN. Your decision drives the VERDICT only: if a material slice is not
      // fully cleared, the run still DELIVERS — as a CONDITIONAL carrying your honest flag. There is NO re-search
      // re-loop and NO no-deliver halt: a lawyer always gets a report unless something technically breaks.
      // WP-56 B2 — the standing "mark itself" read: every report carries it whether or not the brief asks
      // (a staff lawyer, teal-lattice). Typed field → code-rendered at the TOP of the report on both variants.
      `MARK ASSESSMENT (MANDATORY top-level field of the findings record you send): emit "mark_assessment": {"distinctiveness":"<1-2 sentences>","connotation":"<1-2 sentences>"} — your standing read of the APPLICANT'S OWN mark, in your own lawyer voice. §L BUDGET: ONE OR TWO SENTENCES EACH, and the detail goes into the typed rows of the STRUCTURED FORM below rather than into a longer paragraph — the block ran 854 words on the delivered report and its job is two short reads. CONNOTATION LEADS WITH THE FLAGGED READING: if a loaded, subcultural or offensive secondary reading surfaced, it is the FIRST thing the field says; when the sweep genuinely came back clean, state that once as a data point and STOP. Never open with a list of what the mark is NOT ("no offensive reading, no gang association, no adverse political connotation, no…") — an inventory of absent problems is the most recognisable machine tell there is, and it buries the one reading that matters when there is one. It is advisory (for the reviewing lawyer to assess), frames the report, and NEVER moves any band or rating. distinctiveness: where the mark sits on the spectrum (coined / arbitrary / suggestive / descriptive) in the applicant's field, its dominant element, any obvious registrability flag (descriptive / generic / laudatory / geographic / deceptive — or "plainly distinctive, no flag"), AND the per-market read of the manifest's translated/transliterated forms (the variant manifest's "Distinctiveness & registrability" section is your input — carry its judgment forward or better it: e.g. "descriptive once translated in <market>"). connotation: what the mark READS as — English AND non-English (the meaning sweep's results incl. the non-Latin/translated forms): any loaded / subcultural / offensive secondary reading, or the clean result stated as a DATA POINT ("no adverse readings surfaced across <the languages/scripts searched>") — never an unsearched assertion, never a sweep dump. Plain client English ("coined and strong"). Real PR/reputational HITS still live in their own section — this block is the standing read, not the incident report. STRUCTURED FORM (preferred when your read carries per-class / per-market / counter-registration detail): either field may instead be an OBJECT {"read":"<1-2 SHORT sentences — the consequence for the client, e.g. \\"A weak name to own. SLUSH is simply what the product is, so the whole mark rests on TIKI.\\">","spectrum":"<the one-line placement>","per_class":[{"class":"5","note":"…"}],"per_market":[{"market":"CN","note":"…"}],"counter_registrations":[{"mark":"…","uri":"/mark/…","note":"…"}],"acquired":"<optional>","note":"<optional residual>"} — typed rows instead of one wall paragraph. ALWAYS include "read" on the structured form: it is the ONLY prose the reader sees up front (the report collapses the rows behind toggles; the audit workbook renders the rows in full). NEVER pack per-class/per-market rows into a single prose string when you have them as rows.`,
      // P5 (charter 2026-07-30 + Round-2 §4) — the four answers as DATA where computable. Judgment
      // tokens are lawyer-authored with a stated basis, never a computed score (ROUND2-FINDINGS B11);
      // an answer the run cannot ground is OMITTED, never faked — the narrative carries the honest
      // prose instead. This block extends the structured verdict record; it NEVER mints a second risk
      // statement (riskStatement() stays the one assembler every surface renders).
      `FOUR ANSWERS (top-level field of the findings record you send — emit what you can GROUND and omit the rest): "four_answers": {"third_party_rights":{...},"objection_likelihood":{...},"registrability":{...},"client_enforceability":{...}} — the four questions this opinion answers, as data. Each answer you emit is {"read":"<1-2 SHORT sentences — the consequence for the client>","token":"<optional judgment word>","basis":"<one line naming what it rests on — findings, records, the crowd counts>","ordinals":[<the findings[] ordinals it rests on>]}. Tokens (closed enums, YOUR lawyer judgment with its basis — never a computed score): third_party_rights = strong|moderate|weak (how strong the blocking third-party rights are — the senior rights the findings establish); objection_likelihood = likely|possible|unlikely (a real objection/opposition from the identified owners, from disposition + enforcer reads); registrability = registrable|registrable-with-conditions|obstructed (the applicant's own path to registration — absolute grounds + the citation landscape; may additionally carry "obstacles":[{"class":"5","note":"…"}] per-class rows); client_enforceability = strong|moderate|weak (what the client could enforce against others, from the mark's distinctiveness + the element crowd — cross-consistent with your mark_assessment). OMIT any answer the run's material cannot ground (e.g. client_enforceability on a run with no own-rights material) — an omitted answer is honest; a faked token is a defect. The answers must AGREE with the findings, the bands and the verdict they derive from — they are the same judgment surfaced as data, never a second opinion. FACTS THAT CONDITION, NEVER ADVICE (the overall_caption rule, same voice): these fields render VERBATIM on the report — they state what IS, never a step to take. NEVER prescribe ("narrow the goods", "seek consent before filing", "file first", "add a disclaimer") and NEVER use advice grammar ("we recommend", "you should", "the practical path is") — every forward ask lives in the actions register, code-built from it; a prescription typed here is a delivery defect the lint flags. In particular registrability states the POSITION ("the descriptive element carries no exclusive rights of its own"), never the remedy ("add a disclaimer", "narrow the specification") — the remedy, where one is needed, is a typed action.`,
      // spec 64 — the typed forward-action register: the opinion's named forward steps live as DATA, and the
      // delivered disposition is DERIVED from the kinds (pipeline applyCoverageFloor legalActions arm). The
      // author declares the kind from the legal read; code only partitions the closed enum — never a keyword
      // grep over prose (the spec's named failure mode). The report's "Only you can close these" section is
      // code-rendered FROM this register, so bucket prose and disposition can never drift apart.
      `ACTIONS REGISTER (MANDATORY top-level field of the findings record you send): emit "actions": [...] — ONE object per forward step your opinion names that a HUMAN must still take, each EXACTLY {"id","kind","text","ordinals"} plus an OPTIONAL "deadline" and an OPTIONAL "condition". RULE: if your narrative, your overall reasoning, or any finding names a forward legal step (consent, coexistence, territorial delimitation, narrowing the goods, changing the mark, responding to an examiner objection or opposition, clearing a senior right, a required in-jurisdiction counsel opinion), that step MUST exist here as a typed action whose kind matches your own words — a prose-only condition is a delivery defect the reviewer flags. id: 1-based unique integer. kind: EXACTLY one of — CONDITIONS (a forward legal act must happen before the client can rely on a clean result; any one of these makes the run deliver CONDITIONAL): consent / coexistence-agreement / territorial-delimitation / goods-amendment / mark-modification / senior-clearance / proceeding-response / counsel-opinion-required; ADVISORY (never gates a clean result): client-fact (a fact only the client holds — their own prior filing, intended markets; renders as a labelled open question) / commercial-decision (a risk-appetite call that is theirs) / monitoring / filing-routine (ordinary filing mechanics — the "nothing beyond ordinary filing" home). DECLARE the kind from your legal read of what must happen, never from how severe the band is — the kind, not the band, decides CLEAR vs CONDITIONAL. text: ONE client-plain sentence starting with a capital letter that a lay client can act on — it renders VERBATIM and WHOLE in the email's "subject to:" box and the report's action list, so nothing you write here is dropped and nothing is summarised for you. IT MUST FIT ONE LINE OF THE VERDICT STATEMENT: the delivered sentence every surface joins reads "<Tier> — conditional on: <this> (and N more)." and clips at ${STATEMENT_CLAUSE_MAX} characters with an ellipsis, so an ask longer than that ends "…" on the index, the run status, the report hero, the email headline and the workbook. A delivered report carried asks of 350-600 characters. THE ASK IS THE STEP, NOT THE ARGUMENT FOR IT: the reasoning belongs in the finding this action closes (its "ordinals"), where a reader who wants it will look. If the step will not fit in one short sentence, it is not yet clear enough to ask for. LAWYER ENGLISH, NEVER ENGINE ENGLISH (§L): write what a lawyer would actually say to a client — "Investigate whether <owner> is using the mark in <market>", never "Test for non-use". An ask may NEVER name one of this system's own mechanisms as the step: no "rerun the watchlist owner-by-owner screen", no "close the script gaps by the transliteration index route", no "read the N unread registry documents". Reading this run's own records is the ENGINE's job and was owed before delivery — printing it as something the reader must do is a defect, not an action. Test each one: if it does not read as a sentence a lawyer would say aloud to a client, it is not an action — it is either work this run owed, or it is nothing. condition (OPTIONAL, CONDITION kinds only): the SAME demand restated as the factual open-state it closes — a FACT, never an instruction, and a fact THIS RUN ESTABLISHED (§L — never assume the client's own file): "No consent from <owner> appears on the record searched", "The examiner's objection is unanswered". Do NOT write "consent is not in hand" or "no coexistence agreement is in place": the client may hold one and no search this run ran could see it — say what the record shows, scoped to the record. The delivered verdict statement's "conditional on:" lede prefers this field over the imperative text, so type it whenever the fact reads better than the ask. ordinals: the findings[] ordinals this action closes ([] for a run-level action). deadline: {"kind","date"} (ISO date) whenever the action has a hard date — an opposition window, a statement-of-use date; a recorded register deadline that demands action must ride here, never only in prose. A clean run with nothing beyond ordinary filing legitimately emits "actions": [] — never invent an action, and never leave a named one out.`,
      `COVERAGE JUDGMENT (MANDATORY top-level field of the findings record you send): emit "coverage_judgment": {"sufficient":<bool>, "reason":"<one line: what you have seen of the dangerous category and why it is / is not enough to sign>"} — EXACTLY those two keys. Do NOT emit "rows": the driver writes that register itself, one row per open slice, from the coverage ledger and the plan-execution receipt you were handed above; anything you type there is replaced wholesale. Retyping a slice identifier is how a slice comes to be named two ways that nothing makes agree — the machine writes the row, you rule on it. Decide it on the RISK PICTURE, never a count. Its ONLY effect: sufficient:false clamps the verdict CLEAR→CONDITIONAL (the report still ships, carrying your reason). Do NOT emit commands[] or halt — there is no re-enumeration loop and no human-halt; you deliver a conditional instead:`,
      `- An `+"`incomplete`"+` crowd that is IMMATERIAL to the dangerous category (off-field noise, a saturated everyday-word substring pile that is not the named band) → sufficient:true. That is you, the lawyer, deciding it is enough; the run delivers clean (subject to the findings). spec-49 doctrine: a crowd-gated SKIPPED fringe (#361) is not itself a coverage hole, and a crowd descriptor is risk-REDUCING dilution evidence for your per-mark reasoning (cap-as-ceiling, synthesis-rules §Crowded field analysis) — only a MATERIAL uncleared slice (exact/near-identical named variant × in-scope class × material jurisdiction) drives sufficient:false, with the per-mark reason named. The descriptor's existence alone NEVER makes the verdict conditional.`,
      `- An `+"`incomplete`"+` band that IS material (the exact mark / a near-identical named variant in an in-scope class was NOT enumerated to has_more:false, or a material jurisdiction's named band is unfinished) → sufficient:false, with a reason that NAMES the un-cleared slice specifically ("the exact-NOVA PULSE × cl.9 live slice returned ~N,NNN hits and could not be fully enumerated"). The run ships CONDITIONAL and names the un-cleared dangerous slice in the RISK READ as a substantive verdict input — analysis: you, the lawyer, stating what you could not fully clear and why it bears on the answer — NOT as a "[Gap] we should close" caveat in # Actions (doc-35: the report states its reasoned view, it does not narrate an unfinished search as a client to-do). Be specific — name the slice, not "coverage limited".`,
      // crowd-context (2026-07-22) — the ubiquity path: ADDITIVE to the material path above, licensed
      // ONLY when the driver's crowd-context artifact is on disk and actually covers the slice. It moves
      // the sufficiency question from "did I look at everything" to the question a practitioner actually
      // answers on a crowded register: "have I SEEN the dangerous subset, and does the crowd evidence
      // carry an explicit ubiquity read". The counts remain evidence; the lawyer's named reasoning decides.
      `- A MATERIAL un-enumerated slice WHERE the driver's CROWD CONTEXT is present (${P.crowdContext}, readable mirror ${P.crowdContextMd} — gathered precisely because the slice was too large to enumerate: per-term live counts, the same counts restricted to the in-scope classes, and the exact/near-identical subset FULLY enumerated when it was small enough) → the crowded-field/ubiquity path is OPEN to you: you may reach sufficient:true by EXPLICIT crowded-field/ubiquity reasoning that NAMES those counts and the clean enumerated sample in your reason ("the exact/near-identical <TERM> × cl.<N> subset — M records — was fully enumerated and every record is cleared or distinguished in the findings; the formative term rides ~N,NNN live registrations register-wide and ~N,NNN in the in-scope classes — ubiquity the per-mark confusion analysis already prices in"). The counts are evidence for the reasoning, never a threshold: no number makes the picture sufficient by itself — your reasoning over the named counts and the actually-seen sample does. It stays sufficient:false when the enumerated exact/near-identical sample is ABSENT (the subset was itself too large to enumerate, or no slice in the artifact matches the gap) or when that sample contains a mark your findings have NOT cleared — an unseen or uncleared dangerous subset is exactly the doubt the previous path exists for. With NO crowd-context artifact on disk, the previous path stands unchanged: a material un-enumerated slice is sufficient:false.`,
      `- The band is COMPLETE and you are satisfied → sufficient:true → the run delivers (clear, subject to findings). NOTE: an OPEN JUDGMENT (the search IS complete but the legal/commercial answer genuinely admits more than one defensible call — "coexistence with a partner is the client's commercial call"; "get a second opinion on the EU class-25 angle") is NOT a coverage gap: it does NOT set sufficient:false. Surface it as reasoning in the narrative + # Actions and SHIP it. The test is "is the uncertainty about whether I LOOKED (→ sufficient:false, conditional), or about what the COMPLETE picture MEANS (→ open judgment, ships)?"`,
      // VOICE / PRIORITISATION (the Razer-headline fix). Lead with the genuine top risk, not a partner by default.
      // P6 — the house prose contract (word budgets, each fact once at its rank, no prescriptions,
      // no disclaimers, one reader, the §L language rules). Carried by the four stages that author
      // reader-facing prose; the level-2 skill files above teach the same contract, never a variant.
      PROSE_VOICE,
      // ── — part 2's ruling at a THIRD seat: this one ────────────────────────────────────
      //
      // A scored run on 2026-08-22 was refused by the reviewer. This seat told the client, as a
      // WHOLE-REPORT limitation, that no registry certificate was obtained and that every right's goods
      // were therefore judged from class numbers rather than wording. The run's own
      // `_driver/register-record-bodies.jsonl` held 855 fetched bodies and nine findings recorded
      // `meters.use.basis = "verified-from-record"` — and where the wording HAD been read it contradicted
      // this seat's narrative on a headline Swiss conflict.
      //
      // The seat was not lying: the record sidecar is not among its declared inputs, so it cannot see what
      // the fetch lane retrieved and it described the lane from the only thing it had. part 2 settled
      // this at the knockout ASSESS seat, at the SWEEP seat, and the same blindness sat here with no
      // prohibition at all — the cure had been applied by hand each time to the seat that had just failed.
      //
      // WORSE HERE THAN IN EITHER KNOCKOUT CASE. That limitation is scoped to the whole report rather than
      // one section, so it disclaims the evidentiary basis of every right in the findings list at once.
      //
      // The renderer owns the sentence and writes it from the sidecar (document-coverage.mjs), in every
      // state INCLUDING the one where nothing was fetched — deleting the claim and saying nothing would
      // read, on a run that genuinely retrieved no document, as one where the wording was read.
      `SAY NOTHING ABOUT WHETHER REGISTRY DOCUMENTS WERE OBTAINED, fetched, read, or unavailable — not as a`,
      `limitation, not as a caveat, not as a scope note, not as an aside inside a finding, and never as a`,
      `whole-report statement about what the goods comparison rests on. You cannot see the fetch lane: this`,
      `run may hold the full specification wording for every right below, on a lane whose artifacts are not`,
      `among your inputs. The report states what was retrieved in code, from the run's own records. A`,
      `sentence like "no registry certificate was obtained, so goods were compared from class numbers" is`,
      `the exact claim this rule exists to stop, and it has already been shipped to a client once.`,
      // ── — SAME SEAT, DIFFERENT FAILURE, AND 's PROHIBITION DOES NOT REACH IT ──────────
      //
      // The rule above is about MACHINERY the seat cannot see. This one is about PARTIES it can. In the
      // same refused report this seat described the client's own company: a named therapeutic pipeline
      // and a named commercial agreement. The reviewer called it confabulated attribution on the
      // headline owner. Three elements failed three different ways, and the third is the one a
      // "cite your sources" instruction does not stop:
      //
      //   INVENTED      a named indication occurring in no run artifact whatsoever.
      //   CONTRADICTED  the company's own description WAS in the grid; the cited page announced a
      //                 strategic INVESTMENT and the narrative called it a manufacturing agreement.
      //   CATEGORY      a second indication that is REAL and IS in the run — inside a registration's
      //                 class-5 goods wording. That says what the mark is registered FOR. It was
      //                 rendered as what the company's pipeline IS.
      //
      // The category shape is why the last sentence below exists. A seat told to source its claims will
      // source that one, correctly, to a document it really read — and still be wrong, because goods
      // wording is evidence about a registration's scope and never about a company's activities.
      `EVERY FACTUAL ASSERTION ABOUT A NAMED PARTY MUST RESOLVE TO A SOURCE THIS RUN HOLDS. That covers the`,
      `client's own company as much as any third party: its business, its products, its pipeline, its`,
      `partners, its funding, its agreements. Where the run holds material about a party, say what that`,
      `material says — not a fuller or more specific version of it. Where it holds none, say nothing; a`,
      `plausible description of a company you have not read about is a fabrication even when it is flattering`,
      `and even when it turns out to be true. If a fact matters and you cannot source it, write that it is`,
      `unverified rather than dropping the caveat and keeping the fact.`,
      `AND GOODS AND SERVICES WORDING IS NEVER EVIDENCE ABOUT A PARTY'S ACTIVITIES. A specification states`,
      `what a mark is REGISTERED FOR — a scope claim, drafted broadly, often years earlier, routinely`,
      `covering things the owner has never made. Reading an indication, an industry or a product line out of`,
      `a class heading and presenting it as what the company does is the specific error that shipped: it`,
      `passes any check that asks whether the words appear somewhere in the run, because they do.`,
      `PRIORITISATION (voice): lead the report's spine with the GENUINE TOP RISK — the conflict that most drives the verdict (the bare/near-identical mark in a core class whose owner can and would block). A coexistence-partner / commercial-relationship finding is SURFACED with its caveat (the realistic posture is documented coexistence — the client's commercial call) but is NEVER automatically the headline: do not lead with a partner just because they are prominent or familiar. Order the spine by what actually drives risk (disposition=adversarial + the most severe band first), not by who the reader recognises. This sets ORDER/VOICE only — it NEVER changes any band (those are fixed above).`,
      // ── CONVERTED. `writeReturn(P.narrative)` stood here and the intake-ask line
      // above dictated a SECTION and a LINE SHAPE. Everything downstream then parsed prose back out,
      // and a prose regex cannot do that job: 31 of 32 positives false over the delivered corpus, and
      // it fired on the real sentence too. What survives is every sentence that says what a VALUE
      // MEANS — the net contract, the band contract, the meters, the disposition logic, the voice
      // rules. What goes is the seat formatting them into a file for the driver to read back.
      `RECORD YOUR WORK WITH \`record_synthesis\`. THE DISPATCH NAMES NO FILE FOR YOU TO WRITE, deliberately — the driver renders both the narrative and the findings record from what you send. You hold no Write or Edit tool for either and nothing you write by hand is read.`,
      `WHAT THE CALL TAKES. \`narrative\`: your CROSS-FINDING read as sections — \`spine\` (the dominant-element spine), \`verdict\` (what the findings together mean for this client), \`coverage.read\` (the honest coverage prose) and \`calibration\` ([{challenge, answer}]). \`findings\`: the findings document exactly as specified above — schema_version, rated_under_framework, findings[], coverage[], ask_answers[] and the top-level registers. It is the same values it always was; it arrives on the call instead of as a file you write.`,
      `THE PER-FINDING WRITE-UPS ARE NOT A FIELD, and that is a ruling rather than an omission: the report card holds the single authored wording for a finding and the typed fields carry the reads it is written from. Do not restate a finding's reasoning in the narrative sections — the spine is what the findings mean TOGETHER, which is the read no other artifact on this run holds.`,
      `COVERAGE ROWS AND ASK ANSWERS ARE SENT ONCE, ON THE RECORD, AND THE DRIVER RENDERS THEM INTO THE NARRATIVE TOO. Do not repeat them as narrative sections — a second authored copy is refused, because two copies of one statement can disagree and it is the record's copy that ships to the report, the workbook and the portal.`,
      `YOUR COVERAGE ROWS ARE JOINED TO THIS RUN'S PLAN-EXECUTION RECEIPT AS YOU SEND THEM. \`confirmed-clean\` asserts a search ran and came back empty, so a confirmed-clean row naming a slice the receipt does not record as executed is REFUSED — in this turn, where restating it costs nothing, rather than at a gate whose only repair is re-asking this whole stage. Name the area as the receipt names the slice. The honest alternatives are \`coverage-limited\` and \`not-searched\`, and neither is a worse answer than a clean claim that is not true.`,
    ),
  },

  "case-law": {
    model: "sonnet", thinking: "adaptive", timeoutSec: 900,
    skillReads: ["skills/case-law-citation/SKILL.md"],
    out: (P) => P.caseLaw,
    validate: validators.caseLaw,
    // — PROMPT VINTAGE, the romanization/completeness pattern. The ledger arm of validators.caseLaw
    // arms ONLY when this marker is on the run's stage contract, so every archived case-law output —
    // which by construction has no ledger, because none was ever asked for — keeps its verdict on
    // replay. Fresh runs are held to the floor the message below states.
    contract: { citations: 1 },
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "case-law-findings.md grounded profiles — which precedent grounds which finding, the holding read from the fetched document, and the relevance/bearing line": {
        class: "judgment", tokens: ["too_short"],
        why: "whether an authority is on point for this conflict is the whole job; no artifact holds it",
      },
      "citations[].read — read / listed-not-read / unreachable": {
        class: "judgment", tokens: ["caselaw_ledger"],
        why: "#850: only the model knows whether it opened the document. Ledger reasons that speak about it: citation_read_state, dive_unread",
      },
      "citations[].bearing — one line on what the authority grounds": {
        class: "judgment", tokens: [],
        why: "kept judgment by #850. NO TOKEN SPEAKS ABOUT IT — findCaseLawLedgerViolations() in case-law-ledger.mjs never inspects `bearing`, so an empty or generic bearing passes",
      },
      "queries[] — the query text, jurisdiction and hit count of every search dispatched": {
        class: "mechanical:code-extracted", tokens: ["caselaw_ledger"],
        why: "#850 move M5 — code records it from the call log. NOT BUILT AND CANNOT BE BUILT TODAY: tool-calls.jsonl records server/tool/ok and no arguments and no result counts for the case-law bridge servers (courtlistener__*, legaldatahunter__*, WebFetch for EUR-Lex). reading-log.jsonl captures args for the band tools, so the pattern exists one server over; the move is to extend the call log first. Ledger reasons: no_queries, query_no_text, query_no_jurisdiction",
      },
      "citations[].url — the link actually fetched": {
        class: "mechanical:tool-written", tokens: ["caselaw_ledger"],
        why: "the fetch tool's return holds the URL; the model retypes it. Blocked by the same call-log absence as queries[] — declared mechanical because a structured-return tool could write it, with nothing discharging it today. Ledger reason: citation_no_url",
      },
      "citations[].proceeding / forum / jurisdiction / decided — the published identity of the decision": {
        class: "mechanical:tool-written", tokens: ["caselaw_ledger"],
        why: "transcription off the fetched document — the highest-stakes hallucination surface in the workflow per case-law-citation's SKILL.md (`## Grounding workflow`, 'Frontier models attribute case citations at roughly 4–18% accuracy'), and the reason the fetch-before-cite discipline exists. Same call-log absence blocks it. Ledger reason: citation_no_proceeding",
      },
      "the `- ord: <N>` join line on every grounded profile, and citations[].ord": {
        class: "mechanical:code-assigned", tokens: [],
        why: "#850: code binds from the finding index it already supplies. NO TOKEN SPEAKS ABOUT IT — the ledger validator never checks `ord` and nothing parses the prose `- ord:` line, so a wrong or absent join silently drops the profile's bearing from that card",
      },
      "the grounded-profile document shape — `### Grounded profile — <mark> vs <mark/owner> (<jurisdiction>)` heading, **Question grounded:**, **On-point authorities:** bullets, **Tags:** line, **Coverage gaps:** line": {
        class: "mechanical:code-rendered", tokens: [],
        why: "a dictated line shape the driver then joins on (\"keep the head shape exactly\") — typed rows rendered by code is the same move #850 makes for the CROSS-CHECK line and the ESCALATE line. This is the #850 case exactly: the element shape is in the skill file, not the stage message, and no token exists anywhere for it",
      },
      "the Coverage gaps statement — what was not searched": {
        class: "judgment", tokens: [],
        why: "the model's honest account of what it could not reach. Half of it is code-known (TTAB and EUIPO Boards-of-Appeal are structurally unwired, per the skill's own list) and that half is a candidate render; the run-specific half (an MCP that errored, a EUR-Lex search with no case-name lead) is not on disk today",
      },
      "the case-law-citations.json envelope — schema_version 1 and the dictated key set": {
        class: "mechanical:tool-written", tokens: ["caselaw_ledger_missing", "caselaw_ledger_unparseable"],
        why: "tool-written envelope; the model supplies values only. Another literal JSON skeleton plus an \"EXACTLY these keys\" clause that a parser re-parses — E3's target",
      },
    },
    message: ({ paths: P, findingsIndex, caseLawSources }) => lines(
      reads(["skills/case-law-citation/SKILL.md"]),
      `Ground the watchlist/precedent claims in the narrative ${P.narrative} via fetch-before-cite.`,
      ...caseLawSourceLines(caseLawSources),
      // The retrieval record. WHY IT IS A SIBLING AND NOT PROSE: the two sign-off conditions this
      // answers — "the sweep ran, with its queries" and "the dive READ documents in its named
      // territory" — were unanswerable against a markdown file, and a check that arms on wording is
      // the defect. The model states what it searched and what it opened; code does the counting.
      `ALSO write the RETRIEVAL RECORD to ${P.caseLawCitations} — a JSON OBJECT with EXACTLY these keys: {"schema_version":1,"queries":[{"query":"<the search you dispatched, verbatim>","jurisdiction":"<the territory it was scoped to>","results":<how many hits it returned>}, …],"citations":[{"proceeding":"<case name or number as published>","forum":"<court or office>","jurisdiction":"<territory>","decided":"<YYYY-MM-DD or YYYY>","url":"<the link you ACTUALLY fetched>","read":"read"|"listed-not-read"|"unreachable","ord":<the finding ordinal this grounds, or null>,"bearing":"<one line: what it grounds>"}, …]}.`,
      // — the delivered report carried this filename to the client as body prose.
      // The path has to be named HERE, because the model writes the file; the rule is that it never
      // travels from this instruction into anything a reader sees.
      `THAT FILE IS THE DRIVER'S RECORD, NOT THE READER'S. Never name it — or any other internal file, path, key or stage — in ${P.caseLaw} or any prose a client reads. Say what you searched and what it showed, in the reader's own words.`,
      `EVERY query you dispatch gets a row, INCLUDING the ones that returned nothing — a sweep that found no adverse case law is an honest and reportable result, and the queries are the only thing that separates it from a sweep that never ran. "read" means you OPENED the document: a hit list is "listed-not-read", and a paywalled or dead link is "unreachable". Never mark a proceeding "read" you did not fetch — the depth dive is judged on documents actually read in its own territory, and a dive whose record shows none is a dive that ran thin. Record what happened; the driver counts it and never re-reads your judgment.`,
      // T7 (E5): the ord stamp makes the card/render join DETERMINISTIC.
      (findingsIndex ?? []).length ? lines(
        `The run's rated findings (join keys). EVERY "Grounded profile" section MUST start its body with the line "- ord: <N>" naming which finding it grounds (use the ordinal from this list; a profile that grounds no listed finding omits the line):`,
        ...(findingsIndex ?? []).map((x) => `- ord ${x.ordinal}: ${x.mark}${x.owner ? ` — ${x.owner}` : ""}`),
      ) : "",
      writeReturn(P.caseLaw),
    ),
  },

  "narrative-refutation": {
    // Phase-4: OPUS PRIMARY at HIGH effort, declared consistently. This is the adversarial-independence safety
    // stage — resource it like the other judgment stages. It was model="deepseek-v4-pro" + a bespoke sonnet
    // fallback, but anthropic-agent maps deepseek→opus, so it already RAN on opus and the "surprise" sonnet
    // rung only fired on a route error — dropped now; it resolves ONE model like every other opus stage
    // (chainEntries). The old deepseek SILENT-STALL worry (0 streamed tokens, connection
    // held open) is exactly what the engine's per-stage stall-watchdog (stallSec) now aborts — no longer a risk.
    // (Independence trade-off: the narrative is opus-authored, so this is opus-refutes-opus; the independence is
    // the input DIET + adversarial posture, not a different family. sonnet@high is the tier-diverse alternative.)
    model: "opus", thinking: "high", timeoutSec: 900, stallSec: 600,
    skillReads: ["skills/narrative-refutation/SKILL.md"],
    out: (P) => P.seniorEyeReview,
    validate: validators.seniorEyeReview,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "the verdict — CLEAR / CONDITIONAL / BLOCKING": {
        class: "judgment", tokens: ["no_verdict_line"],
        why: "the adversarial-independence call that blocks delivery — the guard #850 credits with stopping a bad report",
      },
      "the verdict's placement on the FIRST line, parsed by parseVerdict": {
        class: "mechanical:code-rendered", tokens: ["no_verdict_line"],
        why: "#850: a typed field, not a line position a parser re-derives",
      },
      "the flagged corrections — the narrative text quoted, the underlying-file text it contradicts, and the minimum-change fix (one of: correct / demote / remove / verify-flag)": {
        class: "judgment", tokens: [],
        why: "the refutation itself. NO TOKEN SPEAKS ABOUT IT — the validator checks only that a verdict line exists; a CONDITIONAL with zero flags is caught by findReviewerCoherenceFlags() in verify.mjs, which the pipeline reads as telemetry, not by validators.seniorEyeReview",
      },
      "the independent re-derivation of the top risk (headline sanity: self-conflict, compared-as-wholes, confusion-vs-business, risk shape, probative grading)": {
        class: "judgment", tokens: [],
        why: "re-deriving the headline from the source files against an upstream chain that already agreed is the failure this stage exists for. Skill-file-only, and unpoliced",
      },
      "the `[kind: coverage-disposition|fact|rating|narrative]` choice": {
        class: "judgment", tokens: [],
        why: "#850 splits it: the choice is the reviewer's legal read of what the correction IS. NO TOKEN — the validator accepts a line with or without it by contract, and parseCorrectionKinds partitions an unknown token to `fact`, so a mistyped kind is invisible telemetry drift",
      },
      "the `[kind: …]` token placement — \"anywhere on the line\", in exactly that form": {
        class: "mechanical:code-rendered", tokens: [],
        why: "#850: a typed field per flag in a structured return; a dictated token shape that a regex then re-parses is E3's target",
      },
      "the `[on: N, M]` flag ordinals — which findings each flag names": {
        class: "mechanical:code-extracted", tokens: [],
        why: "#850: selection against the finding index the driver already holds; targetsOf's normalised prose join is the fallback that already fails (6 of 9 flags resolved to nothing on a delivered run). NO TOKEN: parseOn exists at verify.mjs:583 and validators.seniorEyeReview never calls it — the skill file itself says \"either every flag has one or none of them do any work\", and nothing checks which state a review is in [citation unverified]",
      },
      "the section titled exactly \"PLAN-EXECUTION CHECK\"": {
        class: "mechanical:code-rendered", tokens: ["plan_audit_missing"],
        why: "a heading a validator string-matches. This is #850's stated case in its purest form: read stages.mjs alone and the token is armed with no invitation anywhere. Code renders the section frame from the driver's own table; the model fills the audit",
      },
      "the plan-execution audit judgment — a clean claim resting on a MISSING slice is blocking; a crowd/incomplete descriptor is a signal for judgment, never a verdict input; a machine-manufactured conditional is flagged in either direction": {
        class: "judgment", tokens: ["plan_audit_missing"],
        why: "auditing whether a clean claim rests on a slice that never ran, without re-deciding the lawyer's materiality reasoning",
      },
      "the demotion-receipt audit — the three receipts (registered-scope comparison with the specification quoted, in-lane dilution, use-meets-use consistency) plus the response-band reconciliation line": {
        class: "judgment", tokens: [],
        why: "#850 keeps it — the guard that blocked a bad report. NO TOKEN",
      },
      "the READER-OWNED NOUNS pass — quote the sentence, give the rewrite that keeps every fact": {
        class: "judgment", tokens: [],
        why: "the stage message says it outright: a model judgment and NOT a filter by construction — the same letters are a defect in one sentence and the client's own brand in the next, and no token list tells those apart. NO TOKEN, deliberately",
      },
      "coverage of the driver-fed \"DETERMINISTIC REGISTRY CHECK (B2)\" items — every listed item covered in the flags, with the offending narrative text quoted and the verdict raised to at least CONDITIONAL": {
        class: "judgment", tokens: [],
        why: "the items are code-found and driver-fed, so the FINDING is mechanical; what the model owes is the flag, the quote and the verdict consequence. NO TOKEN — unlike the plan-execution table, this driver-fed block has no section gate at all",
      },
    },
    message: ({ paths: P, intakeAsks, job, registerOnly, profileSelection }) => lines(
      reads(["skills/narrative-refutation/SKILL.md"]),
      // lever 3 — WHICH FINDINGS EARN A GROUNDED PROFILE, chosen by the DRIVER and listed by
      // ordinal. The band is on findings.json before this stage is dispatched, so there is nothing for
      // the seat to judge: unlisted work is never asked for. Empty when every finding is profiled —
      // which is the one-country product always, and any run whose cut keeps everything.
      profileSelectionDirective(profileSelection),
      `Adversarially refute the narrative ${P.narrative} against the source files: register findings ${P.registerFindings}${registerOnly ? "" : `, common-law ${P.commonLaw}`}, placements ${P.placement} (structured tiers + reasons: ${P.placementModel}), matter frame ${P.matterContext}.`,
      PLACEMENT_BORDERLINE_NOTE,
      // PR-8: the reviewer verifies register claims against the RECORD, on the record — the same
      // read-only band tools the drafting stages used, every lookup logged to the reading audit.
      `REGISTER VERIFICATION TOOLS: you hold the read-only band tools — band_shape (the deterministic shape of the complete register band, incl. THE FLOORS: every live in-class identical/near-identical record, listed unconditionally), band_lookup (pull any record the narrative relies on or omits) and band_record (the official registry record fetched this run). Check the narrative's register assertions against them — a floor row the narrative neither rates nor reasons away is a FLAGGED CORRECTION. They are read-only and logged; you hold no live register tools (by design, never an outage).`,
      registerOnly ? REGISTER_ONLY_NOTE : "",
      // C4 — the pharma field module is binding on pharma matters; the review verifies it was honoured
      pharmaMatter(job) ? `This is a PHARMA matter (Nice 5 / pharma goods): verify the narrative honoured the pharma field module (skills/prelim-search/field-doctrine-pharma.md) — therapeutic-area goods discipline (same therapeutic area ≈ proximate goods regardless of formulation), NO-USE never softens a pharma risk (pipelines run 5-10 years pre-launch), and practitioner/pharmacist confusion including handwriting/verbal look-alikes was weighed. A violation is a FLAGGED CORRECTION.` : "",
      // C5 — the generic correction: a registered right can support an injunction without the
      // owner's use (country-dependent); "no use → procedural only / no injunction risk" is a forbidden inference.
      `Flag as a CORRECTION any line reasoning "the owner does not use it → procedural risk only / no injunction exposure": non-use may open a revocation DEFENCE after the grace period, it does not neutralise an enforceable registration today.`,
      // WP-56 — demotion-verification lens (the mirror of the anti-over-rating checks; see the skill section)
      `DEMOTION VERIFICATION (per the skill): for every finding at the framework's lowest band, or disposition "distinguished"/"off-field", whose senior right is same-class and in use, verify the three demotion receipts (a registered-scope comparison with the specification quoted — never the senior's trade dress; any dilution counted in that conflict's jurisdiction × goods lane; a use-meets-use read consistent with the finding's own use-check result) and the response-band reconciliation line. A missing/dishonest receipt on the conflict that would otherwise drive the verdict is BLOCKING; elsewhere a FLAGGED CORRECTION. Where the receipts exist, the demotion STANDS — audit the evidence, never re-decide the band.`,
      // A3/A6 — verify the machine's own open items and the customer's explicit asks were HONOURED,
      // not narrated away: an unaddressed deferral/flag or an unanswered ask is a flagged correction.
      `Also verify against ${P.skepticFlags} and ${P.frameReopenReceipt} (JSON "deferrals"): every skeptic flag and every reopen deferral must be either visible as a coverage[]/narrative open item or explicitly reasoned immaterial — one that appears in neither place is a FLAGGED CORRECTION. Files absent ⇒ skip.`,
      // RETIRED. This ordered the reviewer to "verify the \"## Answers to your
      // instructions\" section answers EACH of these verbatim intake asks with a labelled line … A missing
      // or evasive answer is a FLAGGED CORRECTION." Every clause of it was true when it was written and
      // none of it is now: the answers are typed entries on the findings record, the driver renders the
      // labelled line into the narrative AND the report from those same entries, and an unanswered or
      // mislabelled ask is refused at the record call by name, before anything renders. A missing or
      // evasive answer cannot arise on this seat's turn.
      //
      // NOBODY EDITED IT WRONG — a stage underneath it got better and the sentence went false where it
      // stood. That is why the retirement ships with a guard rather than alone: `CODE_BUILT_SECTIONS` in
      // pipeline.mjs is the list of headings the driver writes, and an arm walks it against what actually
      // reaches a seat, so the next section to become code-built cannot leave its old order behind.
      //
      // What the reviewer still owes on intake asks is unchanged and lives one line up: the skeptic-flag
      // and reopen-deferral check. The asks themselves are the writer's contract, not the reviewer's.
      // — the reader-vocabulary lens. The issue asks for "one judgment pass, directly after synthesis
      // or inside the existing review step", and this step already has both mechanisms it names: a
      // first-line verdict and typed corrections traceable to the sentence they rewrite. So the lens needs
      // no machinery — only a reading. It is a MODEL judgment and NOT a filter by construction, which is
      // the owner's ruling: the same letters are a defect in one sentence ("the variant band enumerated to
      // zero") and the client's own brand in the next (a mark called BAND), and no token list tells those
      // apart. It types as `narrative` — the facts and the ratings are right and the writing is not.
      `READER-OWNED NOUNS: read every line that reaches the client — the caption, each card's stamped net, the coverage line, every action's text — and ask of each noun whether the reader already owns the word. A sentence that names a thing only this engine has a word for, or a coinage that means nothing outside this run, is a FLAGGED CORRECTION [kind: narrative]: quote the sentence and give the rewrite that keeps every fact. "The full variant band enumerated to zero" leaves a smart reader nothing to picture; "we searched every spelling of the name and found no live rights" is the same result in words they own. JUDGE MEANING IN CONTEXT, NEVER THE WORD — a mark, an owner or a product genuinely called AXIS, SLICE or BAND passes untouched, and nothing here forbids a word.`,
      // qw/typed-correction-kinds — the typed-actions doctrine, applied to the review (see the
      // ACTIONS REGISTER comment above): the AUTHOR declares the type from its own legal read; code
      // only partitions the closed enum — never a keyword grep over the correction's prose. Today the
      // kinds feed TELEMETRY ONLY (the run.jsonl `correction-kinds` histogram; verify.mjs
      // parseCorrectionKinds) — the corrective-skip decision is a separate owner-gated build, which is
      // why `fact` is the documented fail-safe for anything untyped or unknown.
      // ── CONVERTED. The three lines that stood here dictated a LINE SHAPE and
      // ordered a hand-write: a `[kind: …]` token "anywhere on the line", a verdict on the first line,
      // and writeReturn. The seat chose the enumeration style, so the parse could miss it — 1679's
      // lettered flags were invisible for exactly that reason. The kind VOCABULARY survives verbatim
      // below, because the model still declares it from its own legal read; what goes is the seat
      // formatting it into prose for the driver to parse back out.
      `RECORD YOUR REVIEW WITH \`record_narrative_refutation\`. THE DISPATCH NAMES NO FILE FOR YOU TO WRITE, deliberately — the driver renders the review from what you send, so a flag the corrective ladder cannot parse cannot be written. You hold no Write or Edit tool for it and nothing you write by hand is read.`,
      `WHAT THE CALL TAKES: \`verdict\` (CLEAR / CONDITIONAL / BLOCKING) and \`flags\`, one entry per flag. Each flag carries \`kind\`, \`text\` (one line, naming the file and the exact claim), optionally \`fix\` (one line — the targeted edit that would settle it) and optionally \`on\` (the finding ordinals it is about, omitted for a flag about the document rather than a finding). You do NOT number the flags: render order is the numbering.`,
      `TYPE EACH CORRECTION: \`kind\` is ONE of coverage-disposition | fact | rating | narrative — pick the one your own legal read says the correction IS: coverage-disposition (a coverage row / disposition placement is wrong or dishonest), fact (a factual defect — record values, owners, statuses, dates, grounding), rating (a band/rating you challenge), narrative (prose, structure or voice of the narrative). DECLARE the kind from what the correction is about, never from how severe it is.`,
      `A BLOCKING verdict REQUIRES at least one flag. A refusal to sign that names nothing is refused by the call itself, in this turn, rather than at the gate — where its only repair is one forced re-ask of this whole stage.`,
    ),
  },

  // ---- Phase 3 delivery, redesigned as small file-gated steps (v14 post-mortem: the old monolithic
  // compose-HTML+build-xlsx+send-in-one-turn hung past 600s and lost the run un-resumably). The LLM now only
  // writes two markdown files; deterministic code renders + publishes them to the page; a tiny step notifies.

  // A1 — curated client report (curation judgment). Writes report.md only. NO xlsx, NO send.
  // sonnet, not opus: this curates the ALREADY-synthesised opus narrative into the report contract —
  // the judgment was spent in `synthesis`; this is curation/formatting (audit-emit is sonnet too).
  // B1 (report confabulation fix). report.md was ONE sonnet pass over ALL cards — it cross-contaminated
  // (the ashen-lattice bug: one finding's body pasted into another's card). It is now rendered in two parts and
  // ASSEMBLED deterministically by the driver: `report-overview` writes the cross-finding shell (front-matter
  // + Actions/Coverage/Methodology, NO cards); `report-card` renders ONE card per finding from THAT finding's
  // own record in isolation — cross-card bleed becomes structurally impossible. Both sonnet/low: curation, not
  // judgment (the judgment was spent in synthesis). render.mjs already orders/groups/binds from findings.json.
  "report-overview": {
    model: "sonnet", thinking: "low", timeoutSec: 900,
    skillReads: ["skills/prelim-search/synthesis-rules.md", "skills/prelim-search/risk-framework.md", "skills/prelim-search/delivery-contract.md", "skills/prelim-search/report-prose.md"],
    skillReadsFor: reportOverviewSkillReads,
    out: (P) => P.reportOverview,
    validate: validators.reportOverview,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      // ── RETIRED FROM THE ASK BY CONVERSION 4, not reclassified ───────────────────────────────
      //
      // NINE front-matter rows stood here: type, matter, title, client, use, run, classes,
      // overall_label and overall_badge. The stage does not ask a seat for any of them any more — the
      // driver stamps all nine from `_driver/report-identity.json` and its own sidecars, and the record
      // tool has no field for one. A declaration is a statement about what the stage ASKS FOR, so an
      // element it stopped asking for has no row (the report-card precedent, five rows, same reasoning).
      //
      // Three of the nine were the sharpest case found anywhere: `classes`, `overall_label` and
      // `overall_badge` were dictated to the seat and then STAMPED OVER by applyScopeFrontMatter /
      // applyVerdictFrontMatter — after every assembly and after every lint-repair reassembly — with the
      // skill doc annotating its own three fields as driver-replaced in the model's own reading. They
      // are E3 backlog row 3 (`other`), the kind no lint can see, and they retire with the rest.
      "front_matter.overall_caption (the ≤3-sentence bottom line)": {
        class: "judgment", tokens: ["reportoverview_"],
        why: "The one driver + the fact that conditions reliance, chosen and worded — no artifact holds it. Only the model can pick which finding is the genuine top risk and state the consequence. `too_short` is a 120-char whole-file floor, not caption-specific; nothing in the validator speaks about the caption itself (the 3-sentence cap is code, card-budget.mjs foldCaption, and the tier-word check is predelivery-lint's overallTierChecks).",
      },
      "overall_caption.tier_word (the delivered overall tier repeated in prose)": {
        class: "mechanical:pre-bound", tokens: [],
        why: "The driver computes it, writes it to _driver/verdict.json, loads it as displayVerdict, hands it in the dispatch, stamps overall_label from it anyway, and then lints the prose against it (overallTierChecks() in predelivery-lint.mjs). A word the driver holds and the model retypes.",
      },
      "front_matter.handling_note (optional)": {
        class: "judgment", tokens: [],
        why: "Judgment on the thin edge: no typed field marks a finding as resting on an adversary's personal web/social profiles, so nothing on disk answers it today. Consumed by normalizeRecordLinks() in index.mjs (driver/publish/) as bold cover text. If a source_type/link classifier were added it becomes mechanical:code-rendered — flagging it so E7 can decide rather than leaving it silent.",
      },
      // RETIRED BY CONVERSION 4 — `actions.section_shape`. The `# Actions` heading, the single `### `
      // sub-heading and the `- ` list shape are rendered by the driver from typed entries, so the stage
      // no longer dictates a shape for `assembleReportMd` and `predelivery-lint` to re-read. The splice
      // anchor those two use is now matching the driver's own render rather than a seat's typing.
      "actions.checks_we_ran[] candidate bullets — one per coverage row, derived from the typed coverage[] the run already holds": {
        class: "mechanical:code-rendered", tokens: ["too_short"],
        why: "#850's audit table rules this row 'J (selection) / M (from coverage rows)' with the move 'render candidate bullets from typed coverage[]; model edits'. The bullet SET is derivable from coverage[] — one candidate per coverage area — so producing the candidates is code's. Only the editing on top is the model's, and that is the sibling row below.",
      },
      "actions.checks_we_ran[] selection and edit — which candidate checks a client should read, and how each result is stated in plain English": {
        class: "judgment", tokens: ["too_short"],
        why: "The judgment half of #850's 'J (selection) / M (from coverage rows)' split: which of the rendered candidates earn a place in a client-facing Actions section, and how a result is worded for a lawyer to read. #850 keeps the model's edit pass — 'model edits' — and only the candidate generation moves.",
      },
      "actions.checks_we_ran[].source_link (the `([source](<url>))` URL in each bullet)": {
        class: "mechanical:code-rendered", tokens: [],
        why: "A URL the run already fetched, retyped by hand: the same 127-URI transcription class #850 rules M for synthesis. findings.json carries the typed source.resolved_link (findings-model.mjs:615, render.mjs:1265) and the coverage rows carry theirs; code can render the link once the model names the check. [citation unverified]",
      },
      // RETIRED BY CONVERSION 4 — `actions.only_you_can_close_these[]`. buildOnlyYouSection already
      // replaced any authored section wholesale, so this row described an ask the driver overwrote. The
      // record tool has no field for it and nothing a seat sends can create one, which settles a live
      // three-way disagreement: the skill doc taught the seat to write the section, the dispatch told it
      // not to, and the driver overwrote it either way. Structure now says what three documents could not.
      "# Methodology (optional plain-English scope note)": {
        class: "judgment", tokens: ["missing"],
        why: "Judgment with a derivable half, stated so it is not hidden: WHICH layers ran is on disk (coverage ledger, _driver/plan-execution.json, scope-facts.json), so a candidate note is renderable; whether a scope limit is worth a reviewer's attention, and in what words, is not. `missing:front-matter+shell` accepts `# Methodology` as the shell marker, so the token does speak about this element's presence.",
      },
      "lint_contracts.numbers_and_reach (registration count stated at most once and only from the finding set; no WIPO/Madrid + 'worldwide' pairing)": {
        class: "mechanical:code-rendered", tokens: [],
        why: "findings.json holds every owner's registration list and every Madrid designation; predelivery-lint already computes both (countsFromFindings, wipoLanguageChecks). The prompt is asking a model to agree with a number code owns — #850 line 237's ruling, applied at the shell as well as the card.",
      },
      "lint_contracts.withdrawn_findings_excluded (a withdrawn finding 'DOES NOT EXIST for this report')": {
        class: "mechanical:pre-bound", tokens: [],
        why: "`withdrawn` is a typed disposition (findings-model.mjs:61) and fullProseOrdinals already filters it (findings-model.mjs:283). The driver can hand a filtered findings view instead of handing the whole file plus a prohibition. [citation unverified]",
      },
      // RETIRED BY CONVERSION 4 — the `::p::` MARKER. Which note is internal is still the model's call
      // and rides `internal: true` on the entry; the marker itself is a rendering instruction the driver
      // now carries out. A dictated token position that a render splits on deterministically was the
      // definition of the class, so the row goes rather than being reclassified.
      "return payload: a 2-3 line summary; the shell itself rides record_report_overview": {
        class: "mechanical:tool-written", tokens: ["reportoverview_"],
        why: "CONVERTED (#1092, conversion 4): the seat sends the caption, the checks and the notes as VALUES and the driver renders report-overview.md. Nothing is pre-bound because the seat is handed NO PATH — the dispatch names no artifact at all, which is what stops MOCK_FAIL_STAGE-style keying on a basename and, more to the point, what stops a seat writing the file itself. The `reportoverview_*` family is attached HERE rather than to a new element for the reason conversion 4's census work established: this IS the stage's typed-envelope element, the tokens speak about what record_report_overview accepts, and minting a new element would read as an arm-2 rename (+1) for a contract that did not grow.",
      },
    },
    message: ({ paths: P, job, customerUnknown, profile, intakeAsks, displayVerdict, registerOnly, searchPolicy }) => lines(
      reads(reportOverviewSkillReads({ profile })),
      // wp50/wi2 — one vocabulary in PROSE too: the driver stamps overall_label from the sidecar
      // regardless ( applyVerdictFrontMatter), but the caption/summary WORDS must agree —
      // VENZY's caption said "High risk" under a stamped VERY HIGH. Backstop: overallTierChecks lint.
      displayVerdict?.tier ? `THE DELIVERED OVERALL TIER (code-derived from the final findings; the driver stamps overall_label from it regardless): ${displayVerdict.tier}${displayVerdict.verdict && displayVerdict.verdict !== "CLEAR" ? ` — delivered ${displayVerdict.verdict}` : ""}. Wherever your prose names the OVERALL level (overall_caption, any summary sentence), use exactly this tier word — "high risk" prose under a VERY HIGH tier is a delivery defect. Individual findings keep their own per-finding tiers.` : "",
      // ── CONVERSION 4. THE SHELL IS HANDED BACK AS VALUES ──────────────────────────────
      //
      // The dictation this replaces asked for a FILE: front-matter the seat typed key by key, a section
      // whose sub-heading and bullet shape were dictated, and a path to save it to. Nine of the ten
      // front-matter keys were driver facts the seat retyped, and THREE of those the driver stamped over
      // afterwards (classes, overall_label, overall_badge — applyScopeFrontMatter / applyVerdictFrontMatter,
      // re-run after every lint-repair reassembly). The skill doc annotated its own three fields as
      // driver-replaced, in the model's own reading: the seat was told it was typing values that would be
      // thrown away, and told to type them anyway.
      //
      // Deleted rather than left beside the tool: a superseded path left executable is what the golden
      // rule bans, and e2e has twice measured a seat obeying the prose while holding the tool.
      //
      // EACH FIELD CARRIES ITS OWN IMPERATIVE IN ITS OWN SENTENCE.
      `Hand the shell back by calling the \`record_report_overview\` tool. There is no file to write and no front-matter to type: the driver renders the shell — every front-matter key it already holds, the \`# Actions\` section and the optional \`# Methodology\` note — from the values you send, and assembles the cards around it. Do NOT author any \`## <owner> — <MARK>\` card and do not think about a \`# Marks\` heading; each card is rendered separately. Risk scoring is unchanged.`,
      // TRANSFORM, NOT FREE-GENERATION (Fix B1 — carried from main's report-synthesis): the shell RESHAPES the
      // settled synthesis, it never re-derives. Applied here to overall_caption + # Actions.
      `TRANSFORM, NOT FREE-GENERATION: overall_caption and # Actions draw ONLY on the settled synthesis narrative ${P.narrative} (and findings.json ${P.findings}) — introduce NO finding, owner, or claim that is not already there, NEVER re-compute a band, and never let a claim outrun its evidence (a verified-from-record fact stays fact; an inferred-from-signal claim reads AS an inference — "on the available signals…" — never flattened to bald fact).`,
      // — the D2 case-law line is RETIRED HERE (it stays on `report-card`, which is where
      // enforcement-history and opposition-likelihood are actually written). Two reasons, and the second
      // is the general one:
      //   1. It contradicted the TRANSFORM clause directly above. The shell may introduce no finding,
      //      owner or claim that is not already in the settled narrative — so it can never be the surface
      //      that first grounds an enforcement claim in a citation.
      //   2. It was the "if the file exists, fish in it" pattern  T7 already retired on
      //      `report-card`, for the reason copper-spire demonstrated: model discretion over an optional
      //      file MISSES. T7's replacement there is a deterministic inline join (ctx.caseLawProfile), and
      //      that lane is untouched — case-law grounding still reaches every card whose finding matched.
      // A6 → PR-9: the answers section is CODE-BUILT at assembly from the findings.json
      // ask_answers register (assembleReportMd · buildAskAnswersSection — the only-you pattern), so the
      // shell no longer authors it and the section can never drift from the register the lint verifies.
      intakeAsks?.length ? `Do NOT author a "### Answers to your instructions" subsection — the driver code-builds it at assembly from the findings.json ask_answers register (synthesis owns that register; anything you author here is replaced wholesale). Never re-file an ask's answer under generic risk prose elsewhere.` : "",
      job?.deliverableSpec ? `Requester deliverable requirements (verbatim from intake — honor template/framework/format asks): ${job.deliverableSpec}` : "",
      profile?.riskAppetite ? `CUSTOMER RISK POSTURE (emphasis only — it NEVER changes a band; the rating is already set by the framework in force. It shapes ordering, the recommendation, and the recommended follow-up): ${profile.riskAppetite}` : "",
      // Phase 1 context pack (background facts): CONTEXT for curation emphasis only — same D1 contract as
      // riskAppetite (never moves a band, already set). It rides report-overview (the shell), NOT
      // synthesis (the rating stage); feeding the pack into synthesis is the review-gated follow-up.
      profile?.contextPack ? `CUSTOMER CONTEXT (background facts + standing concerns — CONTEXT only: it sharpens which finding leads, what the overall_caption + Actions emphasise, and the recommended follow-up; it NEVER changes a band — the rating is already set by the framework in force): ${profile.contextPack}` : "",
      // The saved search's own standing instructions, on the SAME lane as the context pack and under the
      // same contract. Until now they were accepted at save, validated, frozen into the run's sidecar, and
      // read by nobody — a staff member could write "always call out the Benelux position" on a saved
      // search, watch it save, and get a report that never mentioned it.
      //
      // Why this lane and no other. This is free text a CUSTOMER-facing saved search carries into the
      // engine's reasoning, which is exactly the surface the profile key-set walls off — so it rides
      // report-overview (the SHELL: emphasis, ordering, what the summary leads with) and never synthesis
      // (the RATING stage), the same boundary the context pack observes and for the same reason. It is
      // additionally D1-guarded at save: validateRecipe runs the anti-rule / threshold-language guards over
      // extras.standingInstructions, so "rate anything above 60% similarity as HIGH" is refused at the door
      // rather than arriving here as a rule wearing a suggestion's clothes.
      searchPolicy?.extras?.standingInstructions ? `SAVED-SEARCH STANDING INSTRUCTIONS (this saved search's own standing context — same contract as CUSTOMER CONTEXT above: it sharpens which finding leads and what the overall_caption + Actions emphasise, and it NEVER changes a band, a Level, or a Composite; the rating is already set by the framework in force. If it reads like a rating rule, treat it as emphasis and rate normally): ${searchPolicy.extras.standingInstructions}` : "",
      profile?.delivery?.style ? `PROSE STYLE (presentation tone only — register/phrasing of the prose; NEVER a risk word or a band): ${profile.delivery.style}` : "",
      customerUnknown ? `APPLICANT-UNKNOWN carry-through: the overall rating INCLUDES every finding normally (nothing was excluded for a missing applicant) — overall_caption must NOT say the overall was "computed excluding" anything.` : "",
      // — matter/title/client/use arrive INLINE from the intake record (the report-card
      // ctx.finding pattern) rather than being fished out of matter-context.md, which this stage no
      // longer declares and never opened. See frontMatterIdentity's doc block for why that file could
      // not have answered anyway.
      // frontMatterIdentity is GONE from this dispatch (conversion 4). It existed to hand the seat
      // matter/title/client/use so the seat could copy them into front-matter the driver then read back —
      // a value the driver held, dictated, retyped, and re-parsed. The driver stamps all four from
      // `_driver/report-identity.json`, which it writes from the same `job` object this block read.
      `Send \`overall_caption\` — the WHOLE summary, ONE line, at most 3 sentences of plain legal English: the one driver + what conditions reliance (the decisive OPEN FACT, never a prescribed step). Every other front-matter key is the driver's and is stamped from what it already holds; you never type one.`,
      // CHANGE 3 (voice / codes) — overall_caption carries ZERO risk codes. CHANGE 1 — it never LEADS with a coverage gap.
      `overall_caption VOICE: write plain CONSEQUENCE + the FACT that conditions it, with ZERO risk codes — no retired "Level C" / "Composite 3" codes, no bare "Horse Trade" / "Paper Conflict" / "Classic" / "Nuisance" dispute-type tokens, no engineering register ("axes", "Option D", query/fetch counts). Say what it MEANS and what STATE OF THE WORLD determines exposure ("one owner holds a near-identical mark for the same goods and is likely to object — no coexistence or consent appears on the record searched"), not the code. NOTE the shape of that example (§L): the conditioning fact is scoped to what this run SAW. Never write "consent is not in hand" or "coexistence is not in place" — the client may hold either, and no search this run ran could see it. FACTS THAT CONDITION, NEVER ADVICE: the caption names the driver + what conditions reliance; it NEVER prescribes a step ("narrow the goods", "seek consent before filing") and never uses advice grammar ("we recommend", "the practical path is") — the forward asks are code-built from the findings.json actions register, and a caption that repeats them as instructions is a defect. No terse code tag anywhere — the driver renders each card's risk chip from its record; captions carry plain consequence only. And do NOT LEAD the caption with a coverage gap — lead with the substantive risk and the driving finding; a genuinely un-cleared dangerous slice is named in the risk read as analysis (and a genuine human-only step rides the actions register), never the headline and never a closeable-search caveat.`,
      // judgment-relocation (2026-06-23): the Razer-headline fix — lead with the GENUINE top risk, not a partner.
      `LEAD WITH THE GENUINE TOP RISK: the caption + the order of # Actions must headline the conflict that actually drives the verdict (the bare / near-identical mark in a core class whose owner can and would block — disposition adversarial, the most severe band). Do NOT lead with a commercial partner / coexistence-relationship finding just because it is prominent or familiar — that finding is surfaced RISK-FIRST: the band consequence leads and the conditioning FACTS follow ("a rated <band> conflict — the coexistence is documented and neither party has challenged it; continuing it is the client's commercial call" — §L: say what "undisturbed" MEANS, in plain words; a right or an arrangement is never described as "undisturbed" on a reader surface); a path/response clause ("the realistic path is …", "the practical path is …") is retired voice — it may never appear, never LEAD a finding's line and never stand in for its rating. It is not the headline unless it genuinely IS the top risk. Reflect the synthesis prioritisation; never re-order by who the reader recognises.`,
      `There are no sections for you to lay out and no headings to emit — the driver renders them. Send \`actions\` (the checks and what they found) and, only when there is a genuine scope note to make, \`methodology\`. Coverage is built deterministically from the typed coverage[] states in findings.json and is never yours. Mark an internal-only note by sending that bullet with \`internal: true\`; do not type a ::p:: marker.`,
      // spec 64 — "### Only you can close these" is NO LONGER authored here: the driver CODE-BUILDS it
      // at assembly from the findings.json typed actions register (the same data the verdict derives
      // from), so the ask list, the "subject to" line, the email box and the disposition can never
      // drift apart. The overview authors RESULTS only.
      `ACTIONS — one entry per check, each \`{text, source_link, internal}\`. The heading, the sub-heading and the list shape are the driver's; \`text\` is the plain-English RESULT — what was checked and how it came back — as an IMPERSONAL statement. The forward asks are code-built from the findings.json actions register at assembly (author that register in the synthesis contract), so there is no field for them here and nothing you send can create one. doc-35 close-the-loop: the report carries the reasoned view + results — it NEVER narrates a search it could have run. DECISION TREE for every prospective entry: (a) a check that RAN and is settled (clean or fixed) is a RESULT — it belongs here as one; (b) a check a search layer CAN answer but that was NOT closed this run is NOT a client-facing item: it is CLOSED in the run, or — if it genuinely could not be closed — it rides as an INTERNAL entry (\`internal: true\`), NEVER a client "[Gap] run a sweep / confirm against X" caveat (a caveat about something we could have closed ourselves is not a deliverable). NEVER write an entry whose verb is a search the system itself runs ("run a sweep", "confirm against TSDR / TTABVUE / EUIPO", "X was not searched this run"). COVERAGE: "confirmed-clean" / "note" areas are results, not actions; a search-reachable gap is closed or internal, never a client open item. Send no entries at all when there are none — the driver omits the section.`,
      // The source arms, carried from the skill doc's two-arm rule because the FIELD now enforces
      // arm (a): `source_link` is a URL slot, and a citation label in a URL slot ships a link to nowhere
      // in a document a client reads. Arm (b) has no field on purpose — a search is not a page, so it is
      // stated in the text where the skill doc always said it belonged.
      `\`source_link\` is for arm (a) ONLY — the source IS a page and you can state a real http(s) URL. When the source is a SEARCH rather than a page (a research-tool query, a register lookup), OMIT \`source_link\` and cite it inside \`text\` as plain words — "(<search name> (<mode>): <the query>)" — or link the RECORD the search surfaced. Never put a citation label where a URL goes.`,
      // T6 (J9) — the delivery lint's constraints, stated at DRAFT time so the first
      // generation passes (the lint-repair redo was a deterministic ~2-generation tax on 83% of runs).
      `LINT CONTRACTS (the delivery lint fails a shell that breaks these — write them right the first time): (1) never state a numeric registration count for an owner that differs from the finding set's registration list — unsure ⇒ name the owner without a count; (2) findings marked withdrawn in findings.json DO NOT EXIST for this report — never mention them; (3) never pair a WIPO/Madrid registration with "worldwide"/"global" language — name the designated countries or omit the reach claim.`,
      // CHANGE 1 (telemetry strip) — Methodology is OPTIONAL and telemetry-free. No run telemetry (query/fetch
      // counts, variant counts, platform/storefront counts, cell-matrix sizes, "remainder clean" enumerations,
      // axis mechanics), and no confirmed-clean / clean-check enumeration list — those live in the run-dir / audit,
      // and coverage states render from typed coverage[]. Methodology is a SHORT plain-English scope note or nothing.
      `# METHODOLOGY (OPTIONAL) — emit it ONLY if there is a genuine plain-English scope note a reviewer needs (e.g. "register + marketplace + general web; transliteration variants searched; foreign-platform direct search not run"). Do NOT write a telemetry block: NO query/fetch/variant/platform counts, NO "[N] storefronts … remainder clean ([cells]-cell matrix)" line, NO axis mechanics, and NO enumeration of what came back confirmed-clean or what clean-checks were run. If there is no real scope note to make, OMIT the section entirely. NEVER put any of this in overall_caption.`,
      // P6 §7 — the caption obeyed "3 sentences" with three 60-word sentences. The cap is code-enforced
      // (card-budget.mjs foldCaption); the WORD budget is the thing that was missing, and it stays prompt-side.
      `overall_caption is HARD-CAPPED at 3 sentences — a verdict, not a recap; COUNT and trim before emitting. The cap is the FOLD POINT, not the target: write to about 20-25 words a sentence (roughly 75 words for the whole caption). Three sixty-word sentences pass the count and defeat it.`,
      // P6 — the house prose contract (word budgets, each fact once at its rank, no prescriptions,
      // no disclaimers, one reader, the §L language rules). delivery-contract.md and synthesis-rules.md
      // — the two skill files this stage READS — carry the same contract; they previously taught the
      // opposite on the caption ("+ the recommended action", "say what it MEANS and what to DO").
      PROSE_VOICE,
      `PLAIN LANGUAGE (rule 8): no coined jargon or jargon STACKS — translate, never echo ("apex" → "the single highest-risk conflict"; "saturation"/"saturated" → "crowded field"; "spine" → don't surface). A smart non-lawyer follows every line with no glossary.`,
      `NO SECOND PERSON, NO NAMES (rule 9): never "you"/"your" — "the client" or impersonal; never address the reviewer. Flags/actions are impersonal imperatives. Owner / filer names stay.`,
      `HONESTY (rule 7): an Actions item reads as a SEARCHED result only if a search produced it; never dress an un-run check as a clean negative.`,
      `HANDLING NOTE: if a finding rests on an adversary's public social/web profiles, send \`handling_note\` — one line, e.g. "open profile links only in a private browser window". It renders bold on the email cover. Omit it otherwise.`,
      // — the citation list is now the READ list, and it is TWO files.
      //
      // It used to name seven more (register findings, common-law, both placement artifacts, the
      // refutation and the matter frame) and the 08-02 R2 dependency graph recorded that the stage opened
      // NONE of them: 7 of 9 declared edges never read, the largest declaration/behaviour gap in the
      // pipeline. A client-facing summary asserting grounding in material it never consulted is the
      // defect, and the stage's own TRANSFORM clause above had already settled which reading is right —
      // overall_caption and # Actions draw ONLY on the narrative and findings.json, introducing no
      // finding, owner or claim that is not already there. That clause and this line contradicted each
      // other; the clause is the B1 contract, so this line yields to it.
      //
      // NOTHING is lost. The refutation still gates delivery (verify.mjs validators.seniorEyeReview) and
      // its verdict still reaches this prompt — as driver-computed DATA, not as a file read: pipeline.mjs
      // writes _driver/verdict.json, loads it as `displayVerdict`, and the DELIVERED OVERALL TIER line at
      // the top of this message carries its tier and verdict word. The ordering dependency on
      // `narrative-refutation` is therefore REAL and is NOT created by this declaration list — trimming
      // the list buys no concurrency (see the PR for).
      `Inputs — the ONLY two files this stage reads: the settled synthesis narrative ${P.narrative} and the machine findings ${P.findings}. Nothing else in the run dir is yours to consult here: every register, common-law, placement and refutation judgment already landed in those two, and the shell restates it — it never re-opens the evidence.`,
      // PLACEMENT_BORDERLINE_NOTE is NOT carried here: it teaches how to weigh a `"borderline": true`
      // entry, and those exist only in placements.json, which this stage no longer declares or reads. It
      // stays on every stage that does read the placements.
      registerOnly ? REGISTER_ONLY_NOTE : "",
      `Do NOT write or edit any file. There is no path for you to write to: the driver renders the shell from your values and assembles the report around it, and nothing you hand-write is read.`,
      `When the tool accepts your call, return ONLY a 2-3 line summary of the shell.`,
    ),
  },

  // B1 — ONE finding card, rendered in ISOLATION from that finding's own machine record (passed inline). The
  // model sees NO other finding, so it cannot cross-contaminate. axis = the finding ordinal (drives out-path +
  // the in-card "- ord:" line the driver orders + provenance-checks by).
  "report-card": {
    model: "sonnet", thinking: "low", timeoutSec: 600,
    skillReads: ["skills/prelim-search/delivery-contract.md", "skills/prelim-search/risk-framework.md", "skills/prelim-search/report-prose.md"],
    skillReadsFor: reportCardSkillReads,
    out: (P, axis) => P.reportCard(axis),
    validate: validators.reportCard,
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      // RETIRED FROM THE ASK, not reclassified — the card head, `- ord:`, `- group:`, `- source:` and
      // `- net:` are no longer requested of the seat at all. assembleReportMd composes the whole meta
      // block from the record (card-frame.mjs); this stage's message says "no head, no meta lines".
      // A declaration is a statement about what the stage ASKS FOR, so an element it stopped asking
      // for has no row here — leaving one would keep five mechanical elements on the ledger that no
      // longer exist, which is the same lie in the other direction.
      "`### Full detail` bullets — the portfolio / Risk assessment / enforcement narration": {
        class: "judgment", tokens: ["missing", "too_short"],
        why: "JUDGMENT PER OWNER RULING S2, 2026-08-13, which RE-SCOPED S2 rather than adopting it whole: \"the mechanical card fields (headings, ids, links, driver-stamped values) move to code NOW — uncontested. The prose half is decided by EVIDENCE: after config #40 lands, build one matter both ways and the owner reads the two cards side by side. If the rendered card reads worse, the model pass stays, on typed inputs.\" So this row is judgment PENDING that side-by-side reading, and it is the only report-card row S2 leaves open — every mechanical field on this card is already declared mechanical above. Re-open this class when the side-by-side lands, not before.",
      },
      "claim framing keyed on the record's `basis` (verified-from-record ⇒ fact; inferred-from-signal ⇒ 'on the available signals…')": {
        class: "mechanical:code-rendered", tokens: [],
        why: "Which framing applies is a pure function of a typed field on the record the driver hands in (meters.*.basis). The model is being asked to branch on data code already holds; only the sentence around it is prose. Not in the audit table — the same class as its ordinal/URI calls, at a site it did not list.",
      },
      // ── RETIRED FROM THE ASK BY CONVERSION 5, not reclassified ───────────────────────────────
      //
      // FOUR rows stood here: the final `- Source:` bullet, the registration-number suppression rule,
      // the `::p::` internal-flag position, and the one-item-per-bullet list shape. Every one of them
      // was a LINE SHAPE the seat had to hit and a parser then re-read, and every one is the driver's
      // now — it renders the bullets, the bold lead-ins, the marker position, and composes the Source
      // line from `source.resolved_link` on the finding's own record.
      //
      // The Source row is the sharpest: the seat was composing a URL from a host table it is not even
      // given (providers/<name>.md is NOT in this stage's skillReads) plus a path on the record. That is
      // the transcription class in its purest form, and 's link-to-nowhere shipped from it once.
      //
      // The suppression rule did not vanish with its row — it moved to the ACCEPTANCE BOUNDARY, where a
      // bullet carrying a registration number is refused in the turn rather than flagged at delivery.
      "lint_contracts.numbers_and_reach (owner registration COUNT at most once and only from this record; no WIPO/Madrid + 'worldwide' reach language)": {
        class: "mechanical:code-rendered", tokens: [],
        why: "#850 line 237: code owns the numbers already, and the lint is checking the model against a render the model should not be doing. The record handed to this card carries its own registration list and its designations.",
      },
      "case-law bearing woven into the card (does the matched precedent ground THIS card's enforcer / confusability read)": {
        class: "judgment", tokens: [],
        why: "Judgment, and on the same S2 footing as the Full-detail bullets (owner ruling 2026-08-13, prose half pending the side-by-side reading). Whether a matched precedent grounds THIS card's enforcer or confusability read is a legal call over the citation's holding; the driver can join a precedent to a finding but cannot say what it grounds.",
      },
      "the quoted fetched citation inside the card": {
        class: "mechanical:code-extracted", tokens: [],
        why: "The body is in the dispatch (sliced to 4000 chars) and on disk in the case-law profile. This is M2's shape at a third site: the model names the citation, code extracts the fragment. A hand-typed quote here has the same failure mode as connotation's quote_unbound and nothing here checks it at all.",
      },
      "return payload: a 2-3 line summary; the card itself rides record_report_card": {
        class: "mechanical:tool-written", tokens: ["reportcard_"],
        why: "CONVERTED (#1092, conversion 5 — the first FAN-OUT transport): the seat sends its detail bullets as VALUES and the driver renders report-cards/<ord>.md. Nothing is pre-bound because the seat is handed no path. The CARD INDEX is bound by the driver from the same label the grant resolved from (`report-card:<ord>` → CLEAROTRON_RECORD_AXIS), and a payload naming any other ordinal is refused — which turns the 224/0 contract O3c measured from a habit into a structure. The `reportcard_*` family is attached HERE for the reason conversions 4's census work established: this is the stage's typed-envelope element, and minting a new one would read as an arm-2 rename for a contract that did not grow.",
      },
    },
    message: ({ paths: P, finding, axis, profile, caseLawProfile }) => lines(
      reads(reportCardSkillReads({ profile })),
      // ── CONVERSION 5. THE FIRST FAN-OUT TRANSPORT ────────────────────────────────────
      //
      // What moves is the SHAPE, not the analysis. Owner ruling S2 (2026-08-13) keeps the prose the
      // model's pending a side-by-side reading of one matter built both ways — so this dispatch still
      // asks for the seat's judgment, bullet by bullet, and stops asking it to hit line templates a
      // parser then re-reads.
      //
      // THE CARD INDEX IS BOUND BY THE DRIVER. It knows which card it fanned out; the tool refuses a
      // payload naming any other. O3c measured the sibling contract holding 224/0 — every card seat
      // touched only its own card — but that is a measured HABIT, and this makes it a structure.
      `Hand THIS finding's card back by calling the \`record_report_card\` tool. There is no file to write and no line shapes to hit: the driver renders the \`### Full detail\` section, every bullet, the bold lead-ins, the internal-note markers and the final Source link, and writes the card itself. Presentation only — the risk scoring is already set. This turn is bound to ONE card; you have NO other finding's data and MUST NOT invent, reference or borrow from any other finding.`,
      // THE BOUND CARD IS STATED, not left to be read out of the record JSON. The driver knows it, the
      // tool enforces it, and a seat that has to infer its own index from a field in a blob is one
      // misread away from writing another finding's card. It also gives the harness a stable handle:
      // the knob that fails ONE card used to key on `report-cards/2.md`, a path this dispatch no longer
      // names at all.
      `THIS TURN IS BOUND TO CARD ${axis}. Send \`ordinal\`: "${axis}" — the tool refuses a payload naming any other card, and you hold no other finding's record.`,
      `Send \`full_detail\` — one entry per item, each \`{text, lead, internal}\`. \`text\` is your sentence; \`lead\` is a one-word lead-in ("Portfolio", "Risk assessment", "Enforcement") sent as the word ALONE — the driver renders the bold and the full stop. §L: the entry carrying the risk read is led "Risk assessment", NEVER "Legal lever", which reads as leverage the client can pull rather than the assessment it is. THAT ENTRY IS REQUIRED, and the tool refuses the card without it (reportcard_read_lead_missing): the report suppresses the record's own legal and practical reads wherever this bullet is present, so a card that omits it — or marks it internal — reaches the client with no risk read at all, and nothing downstream recovers it. NO "Filing" BULLET (#1339 D3, ruled): the driver already renders every registration from the FETCHED record — number, classes, status, filing and registration years, jurisdiction, designations, priority — so a typed filing bullet is that same fact retyped by a seat nothing can transposition-check. State a filing fact only where it carries the read you are making. Every other lead is optional. Mark an internal-only note with \`internal: true\`; do not type a \`::p::\` marker — the driver places it where the render splits.`,
      // T7 (E5) — the MATCHED grounded profile arrives INLINE (deterministic join), replacing
      // the old "if the file exists, fish in it" discretion that missed cards on copper-spire.
      caseLawProfile ? lines(
        `GROUNDED CASE-LAW for THIS finding (deterministically matched — weave its bearing into the card; quote a fetched citation where it grounds the enforcer/confusability read; never cite a proceeding it does not carry${caseLawProfile.none ? "; it records an explicit NO-ON-POINT-PRECEDENT result — that honest negative may be stated" : ""}):`,
        "```markdown",
        String(caseLawProfile.body ?? "").slice(0, 4000),
        "```",
      ) : "",
      `The finding's OWN record — the ONLY source for this card (owner, mark, registrations, meters with their basis, band, disposition, source link):`,
      "```json",
      JSON.stringify(finding ?? {}, null, 2),
      "```",
      // TRANSFORM, NOT FREE-GENERATION (Fix B1 — main's claims-must-not-outrun-evidence discipline, applied per card).
      `TRANSFORM, NOT FREE-GENERATION: RESHAPE this record into the card — do not re-derive or re-judge. Use ONLY the fields above; NEVER re-compute the band (synthesis fixed it). Carry each claim's BASIS: a meter/owner fact whose basis is "verified-from-record" stays stated as fact; one whose basis is "inferred-from-signal" reads AS an inference ("on the available signals…"), never flattened into bald fact. The enforcer / "litigious" label especially — established only when a filing backs it (verified-from-record); otherwise present it as the inference it is.`,
      // T6 (H6/I8): the "- label:" risk-expression line is RETIRED — the RENDER builds the risk
      // chip from the record's typed band (the framework in force's own word, on every surface), so a
      // re-invented label can no longer disagree with the finding it describes and no code tag is
      // model-authored anywhere.
      // S2 — THE FRAME IS THE DRIVER'S, and this is the line that used to hand it to the seat.
      // The head (`## <owner> — <MARK>, <jurisdictions>`), `- ord:`, `- group:` and `- source:` are now
      // composed by assembly from THIS record — card-frame.mjs, pinned to the delivered corpus rather
      // than to any wording here. They were dictated for years for one reason: the `- group:` and
      // `- net:` stamps anchored their regexes on `^##…\n(?:- ord:…\n)?`, so the driver dictated a head
      // in order to have something of its own dictating to anchor on. `- group:` was the sharpest of
      // them — assembly overwrote the seat's answer on every run since the VIBRANTE mislabel, so the
      // seat was ordered to type a value that was discarded on the same pass.
      //
      // A card that still ARRIVES with a head renders the old way, so archived runs and a drifted seat
      // are byte-identical rather than gaining a second head. See carriesOwnFrame().
      `WRITE THE CARD'S DETAIL ONLY — NO HEAD, NO META LINES. Your output STARTS at "### Full detail" and contains nothing above it: no "## …" heading, and none of "- ord:", "- group:", "- source:", "- net:", "- one:", "- label:", "- open:". Every one of those is composed by the driver from the record above, where they are already typed — a line you write there is discarded, not read.`,
      `Emit NO "### The read" narrative — RETIRED (#243). It was a THIRD condensation of the same finding, beside this card's own one-liner and the typed net. The legal read and the enforcement read are already TYPED on the record (legal_position / practical_position) and render from there; the one-clause summary is the typed net. Your whole output is the \`full_detail\` entries — filing, portfolio, the risk assessment, enforcement — and the driver builds the section around them.`,
      // The SOURCE bullet is gone from the ask entirely. It was the transcription class in its purest
      // form: a seat composing a URL from a host table it is not even given (providers/<name>.md is NOT
      // in this stage's skillReads) plus a path on the record. The driver reads `source.resolved_link`
      // off the finding and renders the line — so the no-public-URL provider branch, which existed only
      // to tell a seat what to type when it could not build a link, has no reader and is gone with it.
      // CHANGE 5a (no floating reg numbers) — the per-record structured render is the source of truth for
      // registration / serial numbers; the code lane renders them. Don't float them in prose.
      `REGISTRATION NUMBERS (CHANGE 5a): do NOT state a registration / application / serial number in a \`full_detail\` entry — the per-record structured render owns the numbers, and the driver renders the ONE place a number appears (the Source line it composes from this record). Name the OWNER + MARK in prose instead. The acceptance boundary refuses an entry carrying one, so this is a rule you find out about in the turn rather than at delivery.`,
      // CHANGE 5b (inferred enforcer) — present an enforcer inferred from a signal as an inference, never as fact.
      `ENFORCER (CHANGE 5b): if THIS record's enforcer meter basis is "inferred-from-signal" (the litigiousness is reasoned from a proxy — owner size, a good law firm, a portfolio shape — not a filed action on record), present it AS an inference ("on the available signals the owner appears likely to object…"), NEVER as established fact ("the owner is litigious"). Only an enforcer whose basis is "verified-from-record" (a filing / C&D / litigation on record) is stated as fact. Same discipline for any other "inferred-from-signal" claim — it reads as the inference it is.`,
      `PLAIN LANGUAGE (rule 8): no coined jargon / jargon STACKS ("saturation" → "crowded field"; "spine" → don't surface). NO SECOND PERSON (rule 9): never "you"/"your" — "the client" or impersonal; owner/filer names stay. HONESTY (rule 7): a "no use found" negative is sayable only if the record's use_check carries a searched result; otherwise label it an un-run inference. EVIDENCE: a bounded rating carries its scope in parentheses ("Medium (Germany only)").`,
      // spec 64 Bug 4 (ashen-gantry): "prosecute through any citation" reads as "sue them" to a lay client,
      // and stated confidence must match the record. Prompt guidance + a reviewer flag — never a grep lint.
      `LEGAL TERMS OF ART (client-facing lines): a lay client must not misread a term of art. Never "prosecute" / "prosecution (through a citation / the application)" — it reads as "sue them": say "respond to the examiner's objection" / "continue the application process". Never bare "citation" for an examiner's reference — say "the examiner raising the prior mark". Never "office action" — say "the examiner's objection". A formal proceeding (an opposition, a cancellation) is named by its name, with one plain clause on what it means for the client. And CONFIDENCE MATCHES THE RECORD: "through ANY citation" / "will succeed" is sayable only when the record supports it — against a capable owner the honest form is "a citation is likely answerable because <the record's reason>".`,
      // spec 64 — the IMPACT bullet moved to the CODE lane: render.mjs fullDetail appends
      // "If enforced: <f.impact>" deterministically from the record (structured-only cards included),
      // so the prompt no longer asks for it (it would double-render).
      // T6 (J9) — the delivery lint's constraints, stated at DRAFT time so the first generation
      // passes (the lint-repair redo was a deterministic ~2-generation tax on 83% of runs).
      `LINT CONTRACTS (the delivery lint fails a card that breaks these — state them right the first time): state an owner's registration COUNT at most once, and only as the number of registrations in the record above (unsure ⇒ name the owner without a count). NEVER pair a WIPO/Madrid/international registration with "worldwide"/"global" reach language — name the designated countries or omit the reach claim.`,
      // P6 — the house prose contract. This card is the surface where "each fact once, at its rank"
      // actually bites: the delivered report told TIKI PUNCH in six sections, and 43% of it was
      // on-field conflict prose. delivery-contract.md (this stage's skill read) carries the same rules.
      PROSE_VOICE,
      `THIS CARD IS THE FACT'S RANK. Everything you write here belongs to THIS finding and is written ONCE, here: do not restate the overall verdict, do not re-narrate another finding, and do not repeat what the summary above already said about this one. If the reader needs a neighbouring finding, name it by ordinal and stop.`,
      profile?.riskAppetite ? `CUSTOMER RISK POSTURE (emphasis only — never moves the band, already set): ${profile.riskAppetite}` : "",
      profile?.delivery?.style ? `PROSE STYLE (presentation tone only — register/phrasing; NEVER a risk word or a band): ${profile.delivery.style}` : "",
      `Do NOT write or edit any file. There is no path for you to write to: the driver renders the card from your values and assembles the report around it, and nothing you hand-write is read.`,
      `When the tool accepts your call, return ONLY a 2-3 line summary of the card.`,
    ),
  },

  // RETIRED 2026-08-01 — the `client-summary` stage (A1b, the cheap client-facing re-voicing that
  // wrote client-summary.md) is DELETED. The one-report decision removed the client export and its
  // render fork and the docs; the stage itself kept running on every clearance and its
  // output no longer reached any reader. composeEmailHtml takes its headline tier from the verdict
  // sidecar and its conditions from the report's `# Actions`, so nothing downstream needed it.
  // Replay is a different question and stays green: validators.clientSummary / checkClientSummaryJoin
  // (verify.mjs), the client-summary-capable checks in predelivery-lint.mjs, and the progress.mjs
  // STAGE_TO_STEP entry are all KEPT so archived runs still verify, lint and resolve step labels.

  // A2b — doubt-closure (T2c, 2026-07-22): the settle-by-citation pass — the cheapest possible model
  // step over the doubts the deterministic stitch left OPEN. Offline evidence (6 archived runs): ~75%
  // of stitch-open doubts had an on-disk answer the exact-token join could not reach; this stage may
  // ONLY point at such an answer — one dictated SETTLED line citing a verbatim quote, or one honest
  // OPEN line. It never writes new analysis, never re-searches, never changes findings. CODE re-verifies
  // every quote against the named file (doubt-ledger.applyClosure); an unverifiable citation leaves the
  // doubt OPEN + a loud `doubt-closure-unverified` event. Non-fatal, non-gating, non-looping; the
  // pipeline runs it ONLY when open doubts remain after the stitch (unconditional; kill switch deleted post-E2E 2026-07-22).
  "doubt-closure": {
    // 2026-08-21: first-attempt budget 300→600. Sized from the stage's OWN clean-pass work,
    // not by doubling: the two runs that produced a settled closure took 466.0s and 497.4s of generation.
    // At 300 the hard wall lands at 360s (timeoutSec + 60), so BOTH were killed on attempt 1 and ~42k
    // output tokens were generated and discarded before the retry re-did the same work.
    // THE RETRY RUNG WAS THE OTHER HALF OF THE DEFECT. gateway's single extended shot grants
    // timeoutSec * 1.5, so the old ladder was 300→450: both successes EXCEEDED rung 2 as well and
    // survived only on the +60s grace, which is a margin, not a budget. The ladder is now 600→900
    // (walls 660 / 960), the first rung of which already clears the observed need by ~100s.
    // NO stallSec, deliberately: the default 120s silence window is already the one these runs ran
    // under, and neither ever tripped it — the attempt records signal `hardWall`, never `stalled`, at
    // 116.1 and 85.0 tok/s. A wider wall does not expose a stall timer that 497s of streaming did not.
    model: "sonnet", thinking: "low", timeoutSec: 600,
    skillReads: [],
    out: (P) => P.doubtClosure,
    validate: validators.doubtClosure,
    // ── — A RETRY ASKS ONLY FOR WHAT IS STILL UNANSWERED ──────────────────────────────────────
    //
    // A killed attempt's accepted answers did not carry. Measured: attempt 2 was re-presented all 80
    // doubts byte-identically and re-answered 68 of them to the same verdict. That generation is the
    // wall-clock, and the receiver's idempotent serve does not touch it — it stops the re-JUDGING, not
    // the re-composing, because the seat writes every row before the tool sees any of it.
    //
    // TWO PREMISES HOLD THIS UP, AND BOTH ARE CHECKABLE. First, the ids are frozen for the life of the
    // stage: `pipeline.mjs` writes the spec sidecar once and `stage()` runs its whole retry ladder inside
    // that call, so `d.id` here means on attempt 2 exactly what it meant on attempt 1. Second, the
    // artifacts this stage cites do not change across a kill — measured on the killed runs by three
    // independent checks — so a doubt settled on attempt 1 was settled against the same text attempt 2
    // would have read. If either stops being true, this narrowing stops being safe.
    //
    // NARROWS THE ASK, NOT THE CONTRACT. The spec sidecar is untouched, so the tool still accepts every
    // id: a seat that answers something it was no longer asked about is served from the ledger rather
    // than refused, and `still_open` keeps naming everything genuinely open.
    refreshCtx: (ctx) => {
      const runDir = ctx?.paths?.runDir;
      if (!runDir) return ctx;                       // nothing to read against — ask for everything
      const ledger = readAcceptedClosures(runDir);
      const answered = new Set([...ledger.doubt, ...ledger.ask]
        .map((l) => String(l?.id ?? "").trim()).filter(Boolean));
      if (!answered.size) return ctx;                // first attempt, or nothing accepted — unchanged
      return {
        ...ctx,
        openDoubts: (ctx.openDoubts ?? []).filter((d) => !answered.has(String(d?.id ?? "").trim())),
        openAsks: (ctx.openAsks ?? []).filter((a) => !answered.has(String(a?.ask_id ?? "").trim())),
      };
    },
    // PR-6: ONE closure judgment for BOTH ledgers — the stitch-open DOUBTS (prose questions, dictated
    // SETTLED/OPEN lines) and the still-open ASKS (machine questions, dictated IMMATERIAL/OPEN lines).
    // The stage may only POINT (verbatim quotes, code-re-verified) — and for an ask it can NEVER claim
    // "executed": execution is computed from the plan-execution record, not asserted by a model.
    // E1 — what this stage asks a model for, and what discharges each element. See THE STAGE-
    // CONTRACT DECLARATION above STAGES for the enum and the rules; contract-audit.mjs enforces them.
    contractElements: {
      "the SETTLED-or-OPEN ruling per open doubt — whether on-disk evidence answers it": {
        class: "judgment", tokens: ["missing"],
        why: "#850 keeps it — deciding that a given passage answers a doubt the deterministic stitch could not close is the stage's only job",
      },
      "which of the three citable files carries the answer — sent as a POSITION, never a name": {
        class: "judgment", tokens: ["doubtclosure_"],
        why: "#850 move M2's split: the pointing act is the judgment half and stays. What changed at conversion 6 is that the model can no longer NAME a file — `file_index` is a position into the driver's own list, so an unallowed or invented citation is inexpressible rather than refused. Before, an invented filename failed silently as an unverifiable quote.",
      },
      "the verbatim quote ≤200 chars": {
        class: "mechanical:code-extracted", tokens: ["missing"],
        why: "#850 move M2, second site: the driver already re-verifies every quote against the named file (applyClosure() in doubt-ledger.mjs) and discards what does not match — running that forward instead of backward is the whole change. Code holds both the file text and the locator",
      },
      "return payload: typed closure rows; the ledgers and the artifact both ride record_doubt_closure": {
        class: "mechanical:code-rendered", tokens: ["doubtclosure_"],
        why: "CONVERTED (#1092, conversion 6): the seat sends {kind, doubt_id, verdict, file_index, quote, reason, handoff} as VALUES and the driver applies them to both ledgers AND renders doubt-closure.md from the same accepted set. The dictated line shapes are gone, and with them the parse: `parseClosureLines`/`parseAskClosureLines` were STRICT, so a typographic quote or an em-dash the model preferred lost a settlement SILENTLY — byte-identical to a doubt the seat looked at and left open, with nothing to count it. The `doubtclosure_` family is attached HERE for the reason conversion 4's census work established: this IS the stage's typed-envelope element, and minting a new one would read as an arm-2 rename for a contract that did not grow.",
      },
      "the doubt id / ask_id echoed on every line": {
        class: "mechanical:pre-bound", tokens: ["missing"],
        why: "the driver wrote the ledger, holds every id, lists them in the message, and asks the model to type them back — the same loop as matter-frame's instructed scope. One row per id, driver-written, is the pre-bind",
      },
      "the one-line reason a citation answers the doubt": {
        class: "judgment", tokens: ["missing"],
        why: "why this passage settles that question is the reasoning the quote alone does not carry",
      },
      "the IMMATERIAL-or-OPEN ruling per open ask, and the one-line reason it is immaterial to THIS matter": {
        class: "judgment", tokens: ["missing"],
        why: "a materiality call on a machine question, with the hard floor that execution is computed from the plan-execution record and can never be asserted",
      },
      "the OPEN <ask_id> line's \"what the reviewing lawyer should do with it\"": {
        class: "judgment", tokens: ["missing"],
        why: "a handover instruction to a human — nothing on disk holds it",
      },
    },
    message: ({ paths: P, openDoubts = [], openAsks = [] }) => lines(
      `A finished trademark clearance run recorded ${openDoubts.length} OPEN doubt(s) and ${openAsks.length} OPEN ask(s) — questions the run asked itself that deterministic joining could not end. Your ONLY job: for each one, either POINT at evidence that ALREADY EXISTS on disk, or say honestly that none does. You never write new analysis, never search anywhere, never change any finding.`,
      // BY POSITION, and the list is CLOSURE_EVIDENCE_FILES — the same array the driver writes into the
      // spec sidecar. `file_index` is a position into THIS list, so a second literal here would put the
      // seat's citation and the driver's verification on different files without either side erroring.
      // ZERO-BASED, because `file_index` is an index and acceptClosure bounds it 0..len-1. Numbering this
      // list from 1 for readability would put every citation one file off — and it would VERIFY, against
      // the wrong file's text, or fail as an "invented quote" the seat could not explain. Silent either way.
      `Evidence files — the ONLY files you may cite. Send \`file_index\` as the NUMBER shown; there is no field for a file name, so a file you were not given cannot be named:`,
      ...CLOSURE_EVIDENCE_FILES.map((f, i) => `${i} = ${f} — ${P[({ "findings.json": "findings", "register-findings.md": "registerFindings", "register-coverage-ledger.json": "registerCoverageLedger" })[f]]}`),
      openDoubts.length ? lines(
        `THE OPEN DOUBTS:`,
        ...openDoubts.map((d) => {
          const subj = [d.subject?.mark, ...(d.subject?.terms ?? [])].filter(Boolean).join(" / ") || d.subject?.text || "(see birth quote)";
          return `- ${d.id} — subject: ${subj} — born in ${d.birth?.artifact}: "${d.birth?.quote}"`;
        }),
        `For EACH doubt id above send ONE row with kind "doubt": verdict "settled" (with file_index, quote and reason) or verdict "open" (with reason).`,
      ) : "",
      openAsks.length ? lines(
        `THE OPEN ASKS (machine questions — a directive, proposal or probe the run raised and could not end deterministically):`,
        ...openAsks.map((a) => `- ${a.ask_id} — [${a.born?.place}] ${a.ask?.text}`),
        `For EACH ask id above send ONE row with kind "ask": verdict "immaterial" (with file_index, quote and reason) or verdict "open" (with a handoff — what the reviewing lawyer should do with it).`,
        `IMMATERIAL is always available and is the terminating move — but only with a real citation. You can NEVER mark an ask executed: execution is computed by code from the plan-execution record, not asserted.`,
      ) : "",
      `The quote must appear VERBATIM in the file you cite. The tool checks it as your call arrives, so you learn in THIS turn; the driver re-checks it afterwards either way and DISCARDS any inexact or invented quote (the row then ships OPEN). An honest OPEN row is a good answer; a stretched citation is a defect that costs you the row.`,
      `A presence-reconciliation doubt (an on-field-rated register row that reached no delivered surface) MAY be SETTLED by citing a delivered crowd/coverage disclosure that prices that row's family in — same citable files, same verbatim-quote rule.`,
      `You may NOT settle a doubt by quoting the file it was born in — each doubt above names it ("born in …"). That file is what raised the question; quoting it back restates the question instead of answering it. The tool refuses those rows and names the file, so cite a different evidence file or send verdict:"open".`,
      `Send your verdicts by calling the \`record_doubt_closure\` tool. There is no file to write and no line to type: the driver applies your rows to both ledgers and renders the artifact from the same accepted set. Send them in one batch where you can; a refused row never voids its neighbours, and the answer names what was refused and why so you can fix it here.`,
    ),
  },

  // A2 (the full audit) is now DETERMINISTIC CODE, not an LLM stage — see pipeline.mjs + publish/audit-from-spine.mjs
  // (parses the register + common-law spine tables → audit.md, count-guarded). The LLM audit-emit was removed
  // because its output varied (47 vs 69 findings on identical input); code guarantees the complete list every time.

  // ── WHERE THE THREE SEND STAGES WENT ────────────────────────────────────────────────────
  //
  // `notify` (email), `notify-chat` and `notify-fail-chat` (chat pings) used to sit here as the tail of
  // this table. They were the ONLY stages whose job was to make the engine operate a messaging tool, and
  // they ran on exactly one code path: `CLEAROTRON_DELIVERY=stage`, the delivery mode that routed
  // requester-facing events through an integrator platform's gateway agent. That mode is gone, so all
  // three were unreachable — a stage table advertising three sends this product cannot perform.
  //
  // WHAT REPLACED THEM IS NOT A STAGE. Every requester-facing event is an outbox packet the integrator
  // consumes (docs/DELIVERY.md), written by code, in the run's own catch block or beside its delivery.
  // That is why nothing here needs a `send` shape any more, and why the stage count dropped by three
  // rather than three stages being rewritten.
};

// ---- register-unit RE-DISPATCH message builders ------------------------------------------------------
//
// Every re-dispatch of a register unit (skeptic escalation, deadline-envelope close, frame-reopen sweep
// and its fresh scoped retry) hands pipeline.mjs a followup/freshMessage, which REPLACES def.message
// above — so each one is a SECOND prompt that has to agree with the lane the run is actually on. They
// lived inline in pipeline.mjs, four screens apart, and drifted: two of them still ordered
// register_enumerate on runs where the tool had been removed. They live here now, beside the steering
// constant and the message they replace, so a lane change is one edit and the drift cannot recur.

const directiveLine = (d) => `- [${d.layer}${d.severity === "dominant-element" ? " · DOMINANT-ELEMENT" : ""}] ${d.item} — ${d.observation}`;

// The one line a WARM resume needs about the lane: judgment additions are proposals, not enumerates.
// (A warm resume re-enters a session whose attempt-1 prompt already carried the full lane brief; this
// re-states only the part a followup could otherwise contradict.)
export const supplementalLaneResumeLine = (P, axis) =>
  `Any ADDITIONAL register sub-query this needs: PROPOSE it via register_propose_supplemental ({"axis": "${axis}", "output_path": "${P.registerBand(axis)}", "proposals": […]}) — the tool executes it and merges the band itself. You never run register coverage via register_enumerate and never author band blocks. ${SUPPLEMENTAL_LANE_STEERING}`;

// Step-2.6 skeptic escalated this axis → resume its session to defend or adjust.
export function buildEscalationFollowup({ paths: P, axis, flags, supplementalLane = false }) {
  return lines(
    `You are RESUMING your own register-unit session for axis "${axis}". Your prior search, coverage ledger, and fetched records are already in your context, and your output file is ${P.registerUnit(axis)}.`,
    supplementalLane ? supplementalLaneResumeLine(P, axis) : "",
    `Do NOT restart the search from scratch. The Step-2.6 skeptic raised the concerns below. For EACH concern relevant to THIS axis: either (a) defend your existing finding using evidence already in your context, or (b) run ONLY the narrow additional sub-query the concern requires, then revise.`,
    `Every finding the concerns do not touch stays exactly as it is.`,
    ``,
    `Skeptic concerns:`,
    flags,
    ``,
    // The tail sits AFTER the concern list so "what the correction above names" refers to the concerns
    // themselves, not to the standing instruction that introduces them.
    UNIT_NOTE_REPAIR_TAIL,
  );
}

// The deadline envelope permits closing this axis's DEFERRED coverage rows before the analysis is written.
export function buildEnvelopeCloseFollowup({ paths: P, axis, rows, supplementalLane = false }) {
  return lines(
    `You are RESUMING your own register-unit session for axis "${axis}". Your prior search, coverage ledger, and fetched records are already in your context, and your output file is ${P.registerUnit(axis)}.`,
    supplementalLane ? supplementalLaneResumeLine(P, axis) : "",
    `The Coverage ledger records DEFERRED (planned but never run) work owned by this axis — the deadline envelope permits closing it NOW, before the analysis is written:`,
    rows || `(deferred row(s) for ${axis} — see the Coverage ledger)`,
    `Run ONLY those deferred sub-queries and update each closed row to confirmed-clean or coverage-limited with the honest reason. Nothing else in the digest changes.`,
    UNIT_NOTE_REPAIR_TAIL,
  );
}

// Frame-reopen, WARM-RESUME arm: the blind frame-diff found threats the run did not fully scope or search.
//
// This arm was one of the two live defects the single-source refactor exposed: it ordered
// register_enumerate and hand-APPENDED band blocks unconditionally, on a run where the tool is removed
// and where band_block_unplanned kills a hand-authored block. It is reached on a lane run whenever the
// code-side dispatch arm above it cannot run (no executePlan adapter for the active provider, or
// CLEAROTRON_PLAN_DISPATCH=off), so the contradiction was dispatchable, not theoretical.
export function buildFrameReopenFollowup({ paths: P, axis, directives, reopenFetchCap, supplementalLane = false }) {
  const dom = (directives ?? []).filter((d) => d.severity === "dominant-element");
  const other = (directives ?? []).filter((d) => d.severity !== "dominant-element");
  if (supplementalLane) return lines(
    `You are RESUMING your own register-unit session for axis "${axis}". Your prior queries, your band artifact (${P.registerBand(axis)}), and your fetched records are already in your context.`,
    `A blind, frame-INDEPENDENT re-derivation (it never saw this run's framing) found these threats the run did NOT fully scope or search:`,
    ...(directives ?? []).map(directiveLine),
    dom.length
      ? `For the DOMINANT-ELEMENT item(s) this is a CLOSURE pass — PROPOSE the dominant element (and its formative root) via register_propose_supplemental ({"axis": "${axis}", "output_path": "${P.registerBand(axis)}", "proposals": […]}): the match_mode-exact NAME-LIST slice AND the contains band, one proposal per material+major in-scope jurisdiction (regions), every proposal pinned to the in-scope classes via nice_classes. The tool runs each proposal through the SAME deterministic executor as the dictated plan and MERGES its qid-stamped block into ${P.registerBand(axis)} ITSELF — it owns the page loop and carries live AND recently-dead records with their status (never date-cut), so there is nothing to sample and nothing to stop at page 0 / top-N. What you must still bound is YOUR OWN per-record detail reading: at most ${reopenFetchCap} records across this whole closure pass, then stop reading detail and reason from the screened band as it stands (a BOUNDED band that is WRITTEN beats an exhaustive one killed at the hard wall that writes NOTHING). A slice the executor cannot exhaust comes back as an "incomplete" block (count + sample + reason) — a descriptor for judgment, NEVER a clean negative. You author NO clearance verdict and NO "confirmed-clean" floor row: the band IS the coverage signal; judgment (Layer B) reads it and decides sufficiency.`
      : "",
    other.length ? `For the other item(s), PROPOSE ONLY the narrow additional slice each requires — same register_propose_supplemental call, class-scoped and region-scoped; the tool merges each block into ${P.registerBand(axis)}.` : "",
    `Then reconcile your account of this axis against the band the tools just wrote — the driver renders ${P.registerUnit(axis)} from your call and takes its counts from that band, so the reconciliation is what you SEND, not a file you re-open. You never author, edit, append to or re-save ${P.registerBand(axis)} yourself — the tools own every block and its qid stamp, and a hand-authored block fails the stage. Hand the reconciled note back with \`record_unit_note\`; you open neither file.`,
    UNIT_NOTE_REPAIR_TAIL,
    SUPPLEMENTAL_LANE_STEERING,
  );
  return lines(
    `You are RESUMING your own register-unit session for axis "${axis}". Your prior queries, your band artifact (${P.registerBand(axis)}), and your fetched records are already in your context.`,
    `A blind, frame-INDEPENDENT re-derivation (it never saw this run's framing) found these threats the run did NOT fully scope or search:`,
    ...(directives ?? []).map(directiveLine),
    dom.length
      ? `For the DOMINANT-ELEMENT item(s) this is a CLOSURE pass — re-ENUMERATE the dominant element (and its formative root) with register_enumerate: the match_mode:exact name-list AND the contains band, region-scoped PER material+major in-scope jurisdiction, filtered to the in-scope classes, carrying live AND recently-dead records (with status — never date-cut). register_enumerate owns the page loop for SCREENING: do NOT sample, do NOT stop at page 0 / top-N while screening the crowd (that batch-screen pass is cheap). BUT BOUND the expensive per-record detail-fetch to at most ${reopenFetchCap} records across this whole closure pass — once ${reopenFetchCap} records have been detail-fetched, STOP fetching and record the remaining screened survivors as an "incomplete" block (count + sample + reason: "detail-fetch ceiling ${reopenFetchCap} reached — bounded to fit the time budget"). A BOUNDED coverage-limited band that is WRITTEN beats an exhaustive one that is killed at the hard wall mid-fetch and writes NOTHING. APPEND each call's result as a block to your ${P.registerBand(axis)} band artifact — an "enumerated" block (EVERY record, with its screening facts) for a band you paged to has_more:false, or an honest "incomplete" block (count + sample + reason) for a band/crowd you genuinely could not exhaust. You author NO clearance verdict and NO "confirmed-clean" floor row — the band IS the coverage signal; judgment (Layer B) reads it and decides sufficiency. An "incomplete" block is a descriptor for judgment, NEVER a clean negative. Every block you append MUST carry "state":"enumerated" (ONLY if paged to has_more:false) or "state":"incomplete" — EXACTLY those two strings; there is no "verified"/"checked"/"complete" state, and any other value fails the stage.`
      : "",
    other.length ? `For the other item(s), run ONLY the narrow additional sub-query each requires (via register_enumerate) and APPEND its block(s) to ${P.registerBand(axis)}.` : "",
    // The band half of this arm was self-contradictory: the paragraph above orders each result APPENDED as
    // a block, and the sentence here then ordered the whole band artifact re-emitted "with the new blocks
    // folded in". A re-emission is not an append — it is a rewrite of blocks the model did not author, and
    // a rewrite is how an existing block's qid gets dropped (the plan-execution receipt joins on qid, so a
    // dropped one reads as an axis that was never executed). Append + patch is therefore the CORRECT
    // instruction here, not merely the cheaper one: the blocks the model never touched are never re-typed,
    // so their qids cannot be lost in transcription.
    `Your ${P.registerBand(axis)} band artifact GROWS BY APPENDING: add each new block to the array already on disk and leave every block already in it exactly as it stands, each keeping its "qid" field byte-identical — never re-emit the band whole, because a block you re-type is a block whose qid can be lost, and the plan-execution receipt joins on it (a dropped qid corrupts the audit trail and reads as an axis that never ran).`,
    `Then reconcile the ${P.registerUnit(axis)} digest with the blocks you just appended, preserving everything else.`,
    UNIT_NOTE_REPAIR_TAIL,
  );
}

// Frame-reopen, FRESH scoped retry (doc-44): the warm resume above hit the hard wall, so this is a cold
// session — it carries no prior context and must state the whole contract itself.
//
// BOTH arms below deliberately keep the FULL re-emission while every other corrective builder in this file
// moved to targeted edits, and the reason is what "cold" means here. A patch is only safe when the file on
// disk is a trustworthy base and the session that wrote it can say which lines it meant. Neither holds: this
// session never wrote the digest, and the digest it would be patching was left behind by a resume that died
// at the hard wall — the kill-torn class the run-level rescue refuses to trust as a base. Re-stating the
// whole contract and writing the whole file is the honest shape for a session starting from nothing.
export function buildFrameReopenRetryMessage({ paths: P, axis, directives, reopenFetchCap, supplementalLane = false }) {
  if (supplementalLane) return lines(
    `Run a SCOPED register sweep for axis "${axis}" — cover ONLY the near-form threats below. A prior warm resume of this axis TIMED OUT at the hard wall, so start clean; the band artifact for this axis is ${P.registerBand(axis)}.`,
    ...(directives ?? []).map(directiveLine),
    `PROPOSE each of them via register_propose_supplemental ({"axis": "${axis}", "output_path": "${P.registerBand(axis)}", "proposals": […]}) — one proposal per threat, each pinned to the in-scope classes via nice_classes and region-scoped per material+major in-scope jurisdiction. The tool runs every proposal through the deterministic executor and MERGES its qid-stamped block into the band itself, live AND recently-dead records carried with their status (never date-cut). Screen what comes back in full (that pass is cheap), but BOUND YOUR OWN per-record detail reading to at most ${reopenFetchCap} records; a slice the executor cannot exhaust comes back as an honest "incomplete" block (count + sample + reason). A WRITTEN bounded band beats an exhaustive one killed mid-fetch.`,
    `Then hand the audit note back with \`record_unit_note\` — there is no digest file to re-emit and nothing you write by hand is read; the driver renders ${P.registerUnit(axis)} from your call and takes its counts from the band, so the note is reconciled against the band by construction rather than by you re-typing it. You never author, edit, append to or re-save band blocks yourself either — the tool owns every block and its qid stamp, and a hand-authored block fails the stage. Author NO clearance verdict: the band is the coverage signal; judgment reads it.`,
    SUPPLEMENTAL_LANE_STEERING,
  );
  return lines(
    `Run a SCOPED register sweep for axis "${axis}" — cover ONLY the near-form threats below. A prior warm resume of this axis TIMED OUT at the hard wall, so start clean; your band artifact is ${P.registerBand(axis)}.`,
    ...(directives ?? []).map(directiveLine),
    `Enumerate each via register_enumerate, region-scoped per material+major in-scope jurisdiction, filtered to the in-scope classes, live AND recently-dead (status carried, never date-cut). Screen the crowd fully (cheap), but BOUND the per-record detail-fetch to at most ${reopenFetchCap} records, then write the remaining screened survivors as an "incomplete" block (count + sample + reason). A WRITTEN bounded band beats an exhaustive one killed mid-fetch.`,
    `APPEND each result as a block to ${P.registerBand(axis)} — that file is yours on this lane and the full write of it is deliberate, because a warm resume died at the hard wall and what is on disk may be kill-torn. The NOTE is not yours: hand it back with \`record_unit_note\` and the driver renders ${P.registerUnit(axis)} from your call. A torn note needs no repair from you — the next accepted call re-renders it whole. Author NO clearance verdict — the band is the coverage signal; judgment reads it. Every block you append MUST carry "state":"enumerated" (ONLY if paged to has_more:false) or "state":"incomplete" — EXACTLY those two strings; there is no "verified"/"checked"/"complete" state, and any other value fails the stage.`,
  );
}

// ---- operability helpers (resume / --from / --experiment / stage model resolution / telemetry) --------

// Canonical forward order of the LLM stages — one entry per stage, with the register-unit fan-out collapsed
// to ONE ordinal (it's a barrier) and the in-place re-runs (skeptic-escalation re-digest, corrective
// re-synthesis, verdict re-check) NOT given separate ordinals (they re-run a stage already listed). Used by
// `--from <stage>` to force re-run of X..end while earlier stages still skip. The code-only delivery steps
// (audit, publish) are intentionally absent — they self-gate (count-guard / .published), so `--from` controls
// the LLM stages only. doubt-closure is condition-only (it fires only when stitch-open doubts exist) and
// absent for that reason.
export const STAGE_ORDER = [
  // — frame-diff moved AHEAD of placement-inquiry (2026-08-03). The frame settles before placement
  // dispatches, so placement runs ONCE, on the settled frame. This list is what `--from <stage>` keys on,
  // so it must track the executed order: `--from frame-diff` now forces placement + digest too.
  "matter-frame", "prelim-variants", "blind-frame", "common-law", "common-law-half", "register-unit",
  "frame-diff", "placement-inquiry", "register-digest", "skeptic", "synthesis",
  "case-law", "narrative-refutation", "report-overview", "report-card",
];
// — the stages deliberately OUTSIDE the forward order, each with the reason. STAGE_ORDER ∪ this map
// is a CLOSED partition of Object.keys(STAGES), asserted in both directions by progress.test.mjs. The
// exclusion was stated in the comment above and enforced by nothing: a stage added to STAGES and forgotten
// here gets stageOrdinal() === -1, so `--from <it>` cannot target it and its archived rows sort ahead of
// everything on any consumer that orders by indexOf. Silent in both places.
export const STAGE_ORDER_EXCLUDED = {
  "doubt-closure": "condition-only (fires only when stitch-open doubts exist) — it re-runs no fixed point in the forward order",
};
// `client-summary` was here until 2026-08-01 and is GONE with the stage; `notify`, `notify-chat` and
// `notify-fail-chat` went the same way on with the delivery mode that was their only caller. That
// drops all four as `--from` targets, and `--from report-card` is now the last one — everything after it
// is code (audit, publish, the delivery packet), which self-gates and never needed a resume target. stageOrdinal()
// therefore returns -1 for it, so an ARCHIVED run's client-summary rows sort ahead of everything on
// any consumer that orders by indexOf (mcp-server/server.mjs stage listing) — a display-order artifact
// on retired rows only, never a gate.
// rawStageKey may carry an axis suffix ("register-unit:primary-sweep") — strip it. Returns -1 for unknowns.
export function stageOrdinal(name) {
  return STAGE_ORDER.indexOf(String(name ?? "").split(":")[0]);
}

// ── Per-stage thinking override (measurement instrument, dev/test only) ──────────────────────────────
// CLEAROTRON_STAGE_THINKING="register-digest=high,synthesis=high" pins a stage's thinking tier for one process,
// so the E2E suite can run A/B arms without a code fork or a redeploy between them. PRODUCTION FLIPS THE
// COMMITTED LITERAL in STAGES and redeploys — same rule as REGISTER_PROVIDER; this is an instrument, not a
// config surface. It is deliberately thinking-only: model overrides stay out (CLEAROTRON_SYNTHESIS_MODEL remains
// the single exception), so a measurement can never silently move two variables at once.
//
// FAIL LOUD on a bad spec. effortFor() falls back to "medium" for an unknown tier, so a typo would quietly
// run a stage at a tier nobody chose and every number measured against it would be a lie — the same class of
// silence as a skills overlay that cannot be read. Parsed per call (never memoised on first read) so a test
// or a suite arm can flip it mid-process; the parse is a split over a short string.
const THINKING_TIERS = new Set(["off", "low", "medium", "adaptive", "high", "max"]);
export function stageThinkingOverride(name) {
  const spec = process.env.CLEAROTRON_STAGE_THINKING;
  if (!spec) return undefined;
  let found;
  for (const part of spec.split(",")) {
    const raw = part.trim();
    if (!raw) continue;
    const eq = raw.indexOf("=");
    const stage = (eq < 0 ? raw : raw.slice(0, eq)).trim();
    const tier = (eq < 0 ? "" : raw.slice(eq + 1)).trim().toLowerCase();
    if (eq < 0 || !stage || !tier)
      throw new Error(`CLEAROTRON_STAGE_THINKING: "${raw}" is not <stage>=<tier> (e.g. register-digest=low)`);
    if (!STAGES[stage])
      throw new Error(`CLEAROTRON_STAGE_THINKING: unknown stage "${stage}". Known: ${Object.keys(STAGES).join(", ")}`);
    if (!THINKING_TIERS.has(tier))
      throw new Error(`CLEAROTRON_STAGE_THINKING: unknown thinking tier "${tier}" for "${stage}". One of: ${[...THINKING_TIERS].join(", ")}`);
    if (stage === name) found = tier;   // keep scanning: a later duplicate wins, but every entry is still validated
  }
  return found;
}
// The declared tier for a stage, override applied. Every reader of def.thinking goes through this.
export function thinkingFor(name, def = STAGES[name], tier = {}) {
  return stageThinkingOverride(name) ?? def?.thinking ?? tier?.thinking;
}

// THE model a stage runs on, with its thinking tier: `[{ model, thinking }]` — at most ONE entry. The
// stage's own `model`, or the axis tier's when the stage declares none (`register-unit` is the one such
// stage; called without an axis it resolves nothing and the array is EMPTY, exactly as before). `thinking`
// goes through thinkingFor(), so the CLEAROTRON_STAGE_THINKING measurement override rides the entry.
// The engine's argv builder omits --thinking when it is falsy.
//
// It returns an array rather than a bare entry because that is the shape both callers already read
// (`[0].thinking`, and the empty case) — a call-shape leftover, not a chain. The model-failover chain that
// used to make it longer (a same-family `fallback` rung, then a cross-provider tail) is DELETED: no
// stage def ever set `fallback`, and the tail's engine gate was never true on either shipped engine, so a
// second rung never existed on any build that shipped. Recovery is the same-model retry ladder, the
// lane-wedge retry and the rate-limit postpone — driver.config.mjs records why arming it was rejected.
export function chainEntries(name, axis = null) {
  const def = STAGES[name];
  if (!def) throw new Error(`chainEntries: unknown stage ${name}`);
  const tier = axis ? axisTier(axis) : {};
  const model = def.model ?? tier.model;
  return model ? [{ model, thinking: thinkingFor(name, def, tier) }] : [];
}

// The canonical INPUT files a stage reads (absolute paths) — for telemetry (input→output linkage) and the
// --experiment sandbox (copy these into the shadow dir). Output files are intentionally EXCLUDED. Derived
// directly from each stage's message() reads above; keep in sync if a message() changes its inputs.
// ── item 15c — WHAT EACH STAGE AUTHORS ───────────────────────────────────────────────────────────────
//
// The mirror of stageInputs, and the missing half of the dependency graph. Several stages write more
// than the one file `out()` names — synthesis authors findings.json beside the narrative, the variants
// stage writes its structured model, frame-diff writes its diff, a register unit writes its
// band — and none of that was declared anywhere. Without it "repair in dependency order" has no order to
// work with: you cannot tell which stale stage feeds which without knowing who WROTE the thing that moved.
//
// DELIBERATELY NOT `outSibs`, and this is the trap the ruling names. `outSibs` is the DESTRUCTIVE list:
// snapshotOutputs COPIES those files to _history and then DELETES them before a forced re-run, so that a
// prior pass's machine record never sits beside a fresh md. Adding findings.json there would delete it
// before every forced synthesis — and since a corrective pass EDITS rather than rewrites, so the
// edit would land on a file that is no longer there. Two different questions, two different lists: this
// one is declarative and nothing deletes from it.
//
// Includes `out()` itself, so a caller has the stage's whole authored surface in one call.
export function stageOutputs(name, P, { axes = [], axis = null } = {}) {
  const def = STAGES[name];
  if (!def) return [];
  const primary = def.out ? [def.out(P, axis)] : [];
  const extra = {
    "prelim-variants": [P.variantManifestModel, P.scopeLedger],
    // blind-frame is NOT listed: since its structured model is `out` itself, which this function
    // already includes. A second entry would claim a sibling the stage does not have.
    "frame-diff": [P.frameDiffModel],
    // — the seat authors the FORM; the driver renders placements.json from it. Both are the
    // stage's authored surface for dependency purposes (a repair in dependency order has to know
    // that a move here moves both), and this list is declarative — nothing deletes from it.
    "placement-inquiry": [P.placementModel, P.placementForm],
    // synthesis authors findings.json beside the narrative, and it is the single most-consumed artifact
    // in the run — every report surface, the verdict, the actions register and the delivery gate are
    // keyed to it. It was undeclared, which is exactly how a repair could rebuild a tail from a findings
    // set its own upstream was about to move.
    synthesis: [P.findings],
    "register-unit": axis ? [P.registerBand(axis)] : (axes ?? []).map((a) => P.registerBand(a)),
    "register-digest": [P.registerCoverageLedger],
    "common-law": [P.commonLawGrid],
    // B — the dispositions are NOT an authored output any more: the seat records rulings through
    // `record_dispositions` and the driver's accumulator lives in `_driver/`, which is never a stage
    // output. Declaring the retired seat-facing path here would aim repairs at a file nobody writes.
    "common-law-half": axis ? [P.commonLawGridHalf(axis)] : [],
    // — the retrieval record is authored beside the prose. Declared for the reason findings.json
    // and the half dispositions were: an artifact a stage writes and nothing declares is one a repair
    // cannot aim at, and the drift guard cannot see the stage message naming it.
    "case-law": [P.caseLawCitations],
  }[name] ?? [];
  return [...primary, ...extra].filter(Boolean);
}

/**
 * Order `labels` so a stage is repaired BEFORE anything that reads what it writes (item 15a).
 *
 * The graph is derived, never hand-maintained: stage A precedes stage B when an artifact A declares as an
 * OUTPUT is one B declares as an INPUT. A hand-written order would be one more thing to keep in step with
 * two maps that already state the answer.
 *
 * Stable: labels with no relation between them keep their incoming order, so a repair set that has no
 * dependencies at all behaves exactly as it did before this existed. A cycle cannot arise from the two
 * maps as they stand, and if one ever does the affected pair simply keeps its incoming order rather than
 * throwing — a repair pass is not the place to discover a graph problem.
 */
export function dependencyOrder(labels, P, { axes = [] } = {}) {
  const bare = (l) => String(l).replace(/:.*$/, "");
  const axisOf = (l) => (String(l).includes(":") ? String(l).slice(String(l).indexOf(":") + 1) : null);
  const outs = new Map(), ins = new Map();
  for (const l of labels) {
    const opts = { axes, axis: axisOf(l) };
    try { outs.set(l, new Set(stageOutputs(bare(l), P, opts))); } catch { outs.set(l, new Set()); }
    try { ins.set(l, new Set(stageInputs(bare(l), P, opts))); } catch { ins.set(l, new Set()); }
  }
  const feeds = (a, b) => [...(outs.get(a) ?? [])].some((f) => (ins.get(b) ?? new Set()).has(f));
  // insertion sort on the "feeds" relation — O(n²) on a set that is never more than a handful of stages,
  // and it preserves incoming order for unrelated pairs, which a comparator sort would not.
  const out = [];
  for (const l of labels) {
    let at = out.length;
    for (let i = 0; i < out.length; i++) if (feeds(l, out[i])) { at = i; break; }
    out.splice(at, 0, l);
  }
  return out;
}

export function stageInputs(name, P, { axes = [], axis = null, registerOnly = false } = {}) {
  const units = (axes ?? []).map((a) => P.registerUnit(a));
  const map = {
    "matter-frame": [],
    "prelim-variants": [P.matterContext],
    // STARVED on purpose: ONLY the raw instruction — never matterContext (the --experiment sandbox copies
    // exactly these inputs, so listing matterContext here would leak the frame the blind pass must not see).
    "blind-frame": [P.inboundRequest],
    // — frame-diff now runs BEFORE placement-inquiry and register-digest, so register-findings.md and
    // register-coverage-ledger.json do not exist yet on a fresh run. They were never the evidence anyway:
    // they are the digest's RE-NARRATION of what the sweeps did. The searched surface is the merged named
    // band plus the per-axis unit audit notes, both of which exist at the new seam. Leaving the two digest
    // outputs declared here would name a LATER stage's outputs as this stage's inputs — they would go
    // absent→present mid-pass, stale a skipped frame-diff on the delivery path, and park the run (the
    // mechanism the skeptic note below describes). ONE consequence to know: several arms mutate the band
    // and the units in-pass, and frame-diff is one-shot by contract (no in-process re-diff), so they
    // restamp frame-diff against what they moved — same sanctioned-rewrite mechanism the settlement flush
    // already uses (restampStage).
    //
    // 2026-08-04 — THAT LIST IS NOT JUST THE REOPEN, and getting it wrong parks a live run. named the
    // reopen's own sweeps and stopped there; THREE arms downstream of the frame seam rewrite these same
    // files (the escalation recheck's band re-merge, the skeptic escalation's forced register-unit
    // re-runs, the envelope close's forced register-unit re-runs), and the reopen's own source-layer arm
    // additionally rewrites common-law.md. pipeline.mjs `settleOneShotStamp` covers all of them at two
    // seams. Anything ADDED to this list must be checked against every arm that runs after frame-diff, or
    // the next resume-shaped run parks at the delivery gate with nothing able to repair it.
    "frame-diff": [P.blindFrameModel, P.scopeLedger, P.variantManifest, P.registerNamedBand, ...units, P.commonLaw],
    "common-law": [P.variantManifest, P.matterContext],
    "common-law-half": [P.variantManifest, P.matterContext],   // A1 split — same inputs, half-scoped spec sidecar
    "register-unit": [P.variantManifest, P.matterContext],
    // judgment-relocation (2026-06-23): the merged COMPLETE NAMED BAND crosses the firewall into Layer B.
    "placement-inquiry": [P.matterContext, P.commonLaw, P.registerNamedBand, ...units],
    // B2 — the structured placement mirror joins every placement consumer's declared inputs (OPTIONAL
    // like crowdContext: absent fingerprints as absent, so pre-B2 runs are byte-identical).
    "register-digest": [P.variantManifest, P.matterContext, P.placement, P.placementModel, P.registerNamedBand, ...units],
    // A-4 (item 12) — planExecution and the coverage ledger are what skepticDeferralExtra is BUILT from,
    // and they were the two things this stage consumed without declaring, so they could change without
    // staling it. Declaring them was tried in Wave A and HELD BACK, because on its own it parks the run:
    // deliveryPathStages includes every SKIPPED stage, all four refreshSupplementalExecution call sites
    // are downstream of the skeptic dispatch (escalation, envelope close, both reopen arms), so on most
    // non-trivial runs the skeptic goes stale and there was no in-pass arm to refresh it.
    //
    // Wave D is that arm. UPSTREAM_STALE_REPAIR + dependencyOrder repair a stale upstream stage in place,
    // in order, so the declaration now ships WITH the repair rather than before it — which was the whole
    // reason to wait. Both are OPTIONAL in the stage-freshness sense: a register-only or pre-receipt run
    // simply has neither, an absent declared input fingerprints as absent, and such a run stays
    // byte-identical.
    skeptic: [P.registerFindings, P.commonLaw, P.variantManifest, P.matterContext, P.planExecution, P.registerCoverageLedger],
    // crowd-context (2026-07-22): OPTIONAL inputs, declared like frameReopenReceipt — absent files
    // fingerprint as absent (stage-freshness handles that today), so a run without the artifact is
    // byte-identical; present files join the P2 staleness contract like any other declared input.
    // — planExecution + the coverage ledger join this list, and the reason is the same one the
    // skeptic's entry gives one line up: they are what the stage's driver-computed blocks are BUILT
    // from, so they could move without staling the stage that ruled over them.
    //
    // THE PARKING RISK THE SKEPTIC'S ENTRY HAD, SYNTHESIS DOES NOT. What held the skeptic declaration
    // back a whole wave was that all four `refreshSupplementalExecution` sites (escalation, envelope
    // close, both reopen arms) run DOWNSTREAM of the skeptic dispatch, so the receipt moved after the
    // stage read it and nothing could repair the staleness in-pass. Every one of those four sites, and
    // the only other writer of the receipt, run UPSTREAM of the synthesis dispatch — synthesis is the
    // last stage before the receipt is settled for the run. The ledger is written by `runDigest`, which
    // also rewrites `register-findings.md`; synthesis has always declared THAT, so the ledger is a
    // strict co-mover with an input this stage already stales on and adds no edge it did not have. The
    // digest-funnel's settlement flush restamps the skeptic against both files and deliberately does
    // NOT restamp synthesis — "their staleness recompute is the contract" — which is the behaviour
    // this declaration extends, not a new one it introduces.
    synthesis: [P.registerFindings, P.commonLaw, P.placement, P.placementModel, P.registerNamedBand, P.matterContext, P.variantManifest, P.skepticFlags, P.frameReopenReceipt, P.crowdContext, P.crowdContextMd, P.planExecution, P.registerCoverageLedger],   // A3/F8;
    "case-law": [P.narrative],
    "narrative-refutation": [P.narrative, P.registerFindings, P.commonLaw, P.placement, P.placementModel, P.matterContext, P.skepticFlags, P.frameReopenReceipt],   // A3/F8
    // P2 clause 4 — P.findings joins the declared inputs of every stage that READS it. All three read it
    // today and none declared it, which is exactly how copper-vault's delivery gate came to be evaluated
    // over a findings set that had moved: findings.json is authored by synthesis but rewritten afterwards
    // by four deterministic mutators (injectDeferralCoverage / enrichFindingDeadlines /
    // consolidateFindingsFile — which RENUMBERS ordinals — and the coverage-floor clamp), and every
    // ordinal-keyed consumer downstream is keyed to it.
    // — NINE declared, TWO opened. The 08-02 R2 dependency graph (union of `reads` across every
    // dispatch of the stage) recorded `narrative.md` and `findings.json` read and the other seven never
    // touched, while the prompt asserted grounding in all nine. The stage's own TRANSFORM clause already
    // said two — overall_caption and # Actions draw ONLY on the narrative and findings.json — so the
    // declaration and the citation list both yield to it. Declared == cited == read, guarded by the
    // exact-set test in test/operability.test.mjs.
    //
    // WHY DROPPING seniorEyeReview DOES NOT RE-OPEN copper-vault. This map is the staleness graph, so
    // narrowing it narrows what can stale this stage. It costs nothing here because the refutation's
    // staleness is TRANSITIVE through synthesis: `narrative-refutation`'s declared inputs are a SUBSET of
    // `synthesis`'s, plus `narrative` — which is synthesis's own output. So any input change that could
    // move senior-eye-review.md also stales synthesis, whose repair rewrites narrative.md AND
    // findings.json, which stales this stage through the two inputs it kept. The only case the trim drops
    // is a FORCED refutation re-run on byte-identical inputs (the reviewer is documented as flipping on
    // those) — and that re-render was churn, because `displayVerdict` is computed from _driver/verdict.json
    // well upstream of the pre-delivery sweep and is not recomputed by the sweep's repair, so the overview
    // would have re-rendered against an unchanged verdict.
    //
    // dependencyOrder loses the narrative-refutation → report-overview edge with it. Ordering survives on
    // two other grounds: synthesis → report-overview still holds (it authors both remaining inputs), and
    // `deliveryPathStages` lists narrative-refutation ahead of report-overview, which the stable insertion
    // sort preserves for unrelated pairs.
    "report-overview": [P.narrative, P.findings],
    "report-card": [P.caseLaw, P.findings],   // B1 — the finding's record is passed INLINE (ctx.finding); D2 adds the grounded case-law file (read if present)
    // T2c — the settle-by-citation pass cites ONLY these three evidence surfaces (the doubts themselves
    // ride inline in the message, like report-card's ctx.finding).
    "doubt-closure": [P.findings, P.registerFindings, P.registerCoverageLedger],
  };
  // Register-only wrote no common-law findings. Telemetry would record a permanently-missing input and
  // the --experiment sandbox would silently skip it — dropping it keeps both honest about what ran.
  return (map[name] ?? []).filter((f) => !(registerOnly && f === P.commonLaw));
}

// ── The haiku+adaptive guard ( corruption 4b) ────────────────────────────────────────────────────
//
// Haiku 4.5 rejects adaptive thinking and the request BOUNCES TO SONNET. So an effort arm pointed at a
// haiku-tier stage with adaptive routing does not measure haiku at any effort — it measures sonnet, and
// the arm's own manifest says haiku. This guard was written for exactly that pairing.
//
// IT COULD NOT SEE IT. `assertTierSanity` read `s.thinking` — the STATIC stage definition — and is
// called once, at run start (pipeline.mjs). Every way the pairing can actually arise is a RUNTIME
// override that never touches the stage def:
//   · `CLEAROTRON_STAGE_THINKING=register-unit=adaptive` over the haiku saturation-probe axis;
//   · `--experiment register-unit --axis primary-sweep --model haiku`, where the model comes from the
//     operator and the thinking tier still comes from the axis (adaptive).
// Both dispatch haiku+adaptive with the guard sitting green behind them. A guard that passes on the one
// pairing it exists to catch is worse than no guard: it is a reason not to look.
//
// TWO HALVES NOW, because they catch different things and neither subsumes the other:
//   assertTierSanity()   — start of run, over the EFFECTIVE declared tier (thinkingFor, so the env
//                          override is applied). Catches a misconfigured process BEFORE it spends.
//   assertEffectiveTier() — at every dispatch (pipeline.mjs stageOnce), over the model and tier this
//                          dispatch is actually about to send. Catches the per-dispatch overrides the
//                          static scan structurally cannot see.
const HAIKU_ADAPTIVE_WHY =
  "Haiku 4.5 rejects adaptive thinking and the request silently BOUNCES TO SONNET — the run would measure sonnet and record haiku (#238 corruption 4)";

/** Refuse a haiku+adaptive pairing THIS DISPATCH is about to send. Called per dispatch, not per run. */
export function assertEffectiveTier(label, { model, thinking } = {}) {
  if (model === "haiku" && thinking === "adaptive")
    throw new Error(`tier sanity: haiku+adaptive forbidden — ${label} is dispatching model="haiku" thinking="adaptive". ${HAIKU_ADAPTIVE_WHY}. The pairing comes from a runtime override (CLEAROTRON_STAGE_THINKING, an --experiment --model, or a caller-pinned opts.thinking), which is why the static stage table looks clean.`);
  return true;
}

// sanity: no haiku stage may use adaptive thinking. Evaluated over the EFFECTIVE tier — `thinkingFor`
// applies CLEAROTRON_STAGE_THINKING — so a measurement arm that pins a haiku stage to adaptive is refused
// at run start rather than measured as haiku and served by sonnet.
export function assertTierSanity() {
  const bad = [];
  for (const [name, s] of Object.entries(STAGES)) {
    if (s.model === "haiku" && thinkingFor(name, s) === "adaptive") bad.push(name);
  }
  for (const axis of REGISTER_AXES) {
    const t = axisTier(axis);
    // register-unit takes its model AND its tier from the axis, so the override has to be read against
    // the stage name the env spec actually uses ("register-unit"), not the axis label.
    if (t.model === "haiku" && thinkingFor("register-unit", STAGES["register-unit"], t) === "adaptive")
      bad.push(`register-unit:${axis}`);
  }
  // — the common-law seats take their tier from the axis now, exactly like register-unit, so the
  // STAGES loop above cannot see them: `common-law-half` carries no static `model` and its arm is
  // skipped. Without this the sanity check would go quiet on three seats the moment the tier moved,
  // which is the one round it matters.
  for (const seat of Object.keys(COMMON_LAW_SEAT_TIER)) {
    const t = axisTier(seat);
    if (t.model === "haiku" && thinkingFor("common-law-half", STAGES["common-law-half"], t) === "adaptive")
      bad.push(`common-law-half:${seat}`);
  }
  if (bad.length) throw new Error(`tier sanity: haiku+adaptive forbidden → ${bad.join(", ")}. ${HAIKU_ADAPTIVE_WHY}`);
  return true;
}
