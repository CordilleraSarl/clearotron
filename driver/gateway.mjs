// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// gateway.mjs — the STAGE LADDER. One stage's turn, classified, retried, repaired, warm-patched. The
// design linchpin, and the reason every engine can be swapped without touching any of it.
//
// The name is historical and the file is not what it says: it was once the single wrapper around one
// integrator platform's agent CLI, and the compute path moved off that CLI long before the platform
// itself left the product. What remains here is engine-AGNOSTIC — runStage drives an adapter's
// runTurn() (engine/CONTRACT.md §1), and everything below classifies the normalized tuple that comes
// back. Renaming the file is a separate change with its own diff; naming what it is, here, costs
// nothing and stops the next reader looking for a gateway.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir, readJson } from "./run-record.mjs";   //
import { NO_SEARCH_RESULT, RESEARCH_CORRECTION } from "./research-answers.mjs";   // a search that did not answer supplies no result
import { note } from "./log.mjs";
// — the closed disposition set has ONE author; this file dictates it and must not retype it.
import { DISPOSITIONS, POSITION_REQUIRED_DISPOSITIONS } from "./findings-model.mjs";
import { isCancelled, readCancel, RunCancelled } from "./cancel.mjs";
import { engineForRun, selectEngine } from "./engine/registry.mjs";
import { timeoutCause, turnFailure } from "./ladder/turn-failure.mjs";
import { modelGauge, servingProgram } from "./ladder/model-gauge.mjs";
import { rescueAndName } from "./ladder/rescue.mjs";
import { nextRung } from "./ladder/next-rung.mjs";
import { stageOf } from "./ladder/stage.mjs";
import { artifactJudgement } from "./ladder/judge.mjs";
import { retryMode, dispatchTurn } from "./ladder/dispatch.mjs";
import { repairFormInDispatch } from "./ladder/form-repair.mjs";
import { measureAttempt, writeAttemptRow, writeAttemptEvent } from "./ladder/attempt-record.mjs";
// ABBREVIATED_VALUE_NOTE is no longer imported: it explained the "…" marker on a value the model
// had to reproduce EXACTLY, and the only messages that rendered one were the connotation arms telling a
// seat to copy a title or a URL. Nothing is copied now, so no connotation hint renders a cut identifier.
// It stays exported by repair-contract.mjs — other families may still need it.
import { editRepairTail, fullWriteTail, failingTarget, abbrev } from "./repair-contract.mjs";
// — the artifact names come from their WRITERS, so the warm-patch branch below carries no second copy
// of either. Each file is written by its receiver and by nothing else.
import { MODEL_FILE as BLIND_FRAME_MODEL_FILE } from "./blind-frame-record.mjs";
import { FLAGS_FILE as SKEPTIC_FLAGS_FILE } from "./skeptic-record.mjs";
import { MODEL_FILE as FRAME_DIFF_MODEL_FILE, PROSE_FILE as FRAME_DIFF_PROSE_FILE } from "./frame-diff-record.mjs";
import { MATTER_CONTEXT_FILE } from "./matter-frame-record.mjs";
import { MODEL_FILE as VARIANT_MODEL_FILE, PROSE_FILE as VARIANT_PROSE_FILE } from "./clearance-variants-record.mjs";
import { PROSE_FILE as REPORT_OVERVIEW_FILE } from "./report-overview-record.mjs";
import { NARRATIVE_FILE, FINDINGS_FILE, refusalsFor, synthesisCallPaths } from "./synthesis-record.mjs";
import { FINDINGS_FILE as REGISTER_FINDINGS_FILE, refusalsFor as registerDigestRefusalsFor } from "./register-digest-record.mjs";

// artifact basename -> the tool that is now its only writer. A repair for one of these is a CALL, never a
// file edit, and this table is what the warm patch reads to know that. It grows by one row per conversion,
// so its membership IS the conversion record — and a stage absent from it still gets the write-mode tails,
// correctly, because its seat still holds Write.
// EXPORTED for the agreement guard, which derives each recording stage's artifact from this table
// rather than from a second hand-written list: stage → its granted record tool → the row whose `tool`
// matches → the basename. A conversion that adds the grant and forgets the row leaves the guard unable to
// name an artifact for that stage, and it fails there rather than quietly checking one direction less.
export const TOOL_WRITTEN_ARTIFACTS = new Map([
  // Conversion 6, and the LAST of the eight. The stage is NON-FATAL, which makes this row matter more
  // than its siblings rather than less: a repair ladder that handed this seat an Edit would be ordering a
  // hand-write on a stage whose failure ships quietly, so the wrong path would never announce itself.
  ["doubt-closure.md", { tool: "record_doubt_closure", what: "your closure verdicts" }],
  // TWO BASENAMES, ONE TOOL — the knockout lane's frame ( item C), and the second
  // conversion in this table whose call writes more than one artifact. Both rows are needed for the same
  // reason frame-diff's pair is: the stage's `out` is the PLAN, so a repair aimed at the stage arrives
  // naming knockout-plan.json, while the scope note arrives under its own name from the surfaces that
  // key on the document rather than the stage. A table carrying only the plan would hand a note repair
  // the write-tool form, at a seat whose grant no longer carries Write.
  //
  // BOTH ARE EXACT BASENAMES IN THE RUN ROOT, so neither needs the pattern table its sibling stage did:
  // this stage is not fanned, so there is exactly one of each per run.
  ["knockout-plan.json", { tool: "record_knockout_frame", what: "the batch plan",
    refusals: (runDir) => frameRefusalsFor(runDir) }],
  ["knockout-frame.md", { tool: "record_knockout_frame", what: "the batch scope note",
    refusals: (runDir) => frameRefusalsFor(runDir) }],
  // The knockout lane's reviewing pass. ONE EXACT BASENAME, and it sits under `_driver/` rather than the
  // run root because the artifact is the pass's account of what it rewrote, not a surface a client is
  // shown — the lookup keys on the basename either way. The row is what makes a repair on this stage a
  // CALL: the seat's grant carries no Write, so a ladder handing it the write form would order a
  // hand-write it cannot perform, on a stage whose failure is deliberately quiet.
  ["knockout-review.json", { tool: "record_knockout_review", what: "your rewrites of the lines a reader sees first",
    refusals: (runDir) => knockoutReviewRefusalsFor(runDir) }], ["knockout-register.json", { tool: "record_knockout_register_read", what: "what you carried forward, set aside and did not ask", refusals: (runDir) => knockoutRegisterRefusalsFor(runDir) }],
  [BLIND_FRAME_MODEL_FILE, { tool: "record_blind_frame", what: "the threat model" }],
  [SKEPTIC_FLAGS_FILE, { tool: "record_skeptic", what: "your flags and escalation decisions" }],
  ["senior-eye-review.md", { tool: "record_narrative_refutation", what: "your verdict and typed flags" }],
  // TWO BASENAMES, ONE TOOL — the first conversion whose call writes more than one artifact. The stage's
  // `out` is the prose, so a repair aimed at the stage arrives naming `frame-diff.md`; the JSON is what
  // every framediff_* token is about and arrives naming `frame-diff.json`. Both are the driver's now, and
  // both repair to the same call, so both need a row: a table that carried only the JSON would hand the
  // prose-shaped repair back to the write-mode tails, which is the branch this table exists to skip.
  [FRAME_DIFF_MODEL_FILE, { tool: "record_frame_diff", what: "the structured diff" }],
  [FRAME_DIFF_PROSE_FILE, { tool: "record_frame_diff", what: "the structured diff" }],
  // Conversion 2. ONE basename, and the stage's `out` is that same file, so unlike frame-diff there is no
  // second row — but this is the first row whose artifact has READERS: twelve downstream dispatches hand
  // a seat this path. The row is what turns a matter-frame repair into a CALL; without it the repair
  // tails would order a hand-write of a file whose only writer is now the driver, on a stage whose grant
  // no longer carries `Write`.
  [MATTER_CONTEXT_FILE, { tool: "record_matter_frame", what: "the matter frame" }],
  // Conversion 3 — two basenames again (the frame-diff shape), and for the same reason: the stage's `out`
  // is the prose, so a repair aimed at the STAGE arrives naming the .md, while every `variantmodel_*`
  // token is about the .json and arrives naming that. Both are the driver's now and both repair to the
  // same call, so a table carrying only one would hand the other's repair to the write-mode tails.
  //
  // scope-ledger.json is deliberately ABSENT: it was already driver-written before this conversion (the
  // driver derived it), so it is outside this conversion's claim. What changed is where its values come
  // from, not who writes it.
  [VARIANT_MODEL_FILE, { tool: "record_clearance_variants", what: "the variant manifest" }],
  [VARIANT_PROSE_FILE, { tool: "record_clearance_variants", what: "the variant manifest" }],
  // Conversion 4 — ONE basename, and the first row whose artifact a CLIENT reads. report-overview.md is
  // the delivered report's front-matter and its Actions section; assembleReportMd splices the code-built
  // sections into it and publishes the result. So a repair that arrives naming this file and gets handed
  // to the write-mode tails would order a hand-write of the shell of a lawyer's deliverable, on a stage
  // whose grant no longer carries `Write`.
  [REPORT_OVERVIEW_FILE, { tool: "record_report_overview", what: "the report shell" }],
  // THE WRITER — two basenames, one tool, and the pair is not the frame-diff shape even though it looks
  // like it. There the .md and the .json are two renderings of one structure; here they are two
  // different artifacts of one judgment: `narrative.md` is what a lawyer reads and `findings.json` is
  // what the report, the workbook and the portal are built from. Both are the driver's now and both
  // repair to the same call, so both need a row — a table carrying only one would hand the other's
  // repair to the write-mode tails, which is the branch this table exists to skip.
  //
  // AND THESE ARE THE ROWS WITH THE MOST READERS OF ANY IN THIS TABLE. `narrative.md` alone gates the
  // resume path (`digestLocked` keys on its existence), feeds the deterministic registry read and the
  // pre-delivery lint; `findings.json` is parsed by the report assembly, the cards, the audit workbook,
  // the portal's disposition read and the feedback store. A repair routed to a hand-write here is a
  // hand-write of the product.
  //
  // `refusals` IS WHY THE ROW CARRIES A FUNCTION AND NOT JUST NAMES. The conversion moved the catch from
  // a post-hoc validator to the call, and the run's terminal reason moved with it — from
  // `coverage_recommendation` (the seat wrote a forbidden coverage form) to `missing_file:narrative.md`
  // (the seat produced nothing). The second is FALSE about what happened and strictly less useful: an
  // exhausted stage whose every call was refused reads as a stage that never tried. Measured on
  // v4-closure's MOCK_NARRATIVE_RECO arm, which asserts the run names the defect it hit. The judge below
  // reads this on the missing-file branch so the refusal travels with the absence it caused.
  [NARRATIVE_FILE, { tool: "record_synthesis", what: "the narrative and its findings record", refusals: refusalsFor }],
  [FINDINGS_FILE, { tool: "record_synthesis", what: "the narrative and its findings record", refusals: refusalsFor }],
  // Conversion 11 — the register findings document, and the row with the widest PARSER surface in this
  // table: nine readers across driver/, mcp-server/ and driver/publish/ scan it for headings, pipe
  // tables and `/mark/…` uris. Every one of them tolerates freeform prose because a model wrote this
  // file; from here a render satisfies them by construction. A repair arriving under the old dictation
  // names this basename, so without the row the write-mode tails would order a hand-write of the
  // document on a stage whose grant no longer carries `Write`.
  //
  // It carries `refusals` for the reason the two rows above it do, and this stage is where that reason
  // bites hardest: the acceptance boundary REFUSES a row whose uri the band cannot resolve, so a seat
  // working from a stale uri list can be refused on every call. Without the reader that run reports
  // `missing_file:register-findings.md` — a stage that never tried — for a stage that tried and was
  // told no each time, with the reason waiting on disk.
  [REGISTER_FINDINGS_FILE, { tool: "record_register_digest", what: "the register findings", refusals: registerDigestRefusalsFor }],
]);

// ── PER-ORDINAL ARTIFACTS — A DIRECTORY, NOT A BASENAME ( conversion 5) ───────────────────────
//
// The table above is keyed on BASENAME, which every conversion so far could use because every artifact
// had a distinct name. A report card does not: `P.reportCard(26)` is `report-cards/26.md`, so its
// basename is `"26.md"`. A row keyed on that would be meaningless AND dangerous — it would match any
// file called `26.md` anywhere in the tree, and the consumers of this table turn a match into "the
// driver writes this; repair by CALL".
//
// So a fan-out artifact declares its DIRECTORY and the shape of its members. Inside a declared
// directory there is NO basename fallback, ever: `26.md` is unmatchable except by its full run-relative
// shape. That asymmetry is the point — the wrong answer here fails in the worst direction, because a
// MISS makes every repair surface silently order a hand-write at a seat whose grant no longer carries
// `Write`, and a card run does that 26 times instead of once.
export const TOOL_WRITTEN_DIRS = new Map([
  ["report-cards", { tool: "record_report_card", what: "the finding card", member: /^\d+\.md$/ }],
  // THE UNIT'S AUDIT NOTE, and the `member` pattern carries more weight here than it
  // does one row up. `report-cards/` holds nothing but cards, so its shape check is a formality. This
  // directory holds THREE writers' files: the note is the driver's, and `<axis>-band.json` and
  // `<axis>-supplemental-plan.json` belong to `register_execute_plan` and `register_propose_supplemental`.
  // `toolWrittenArtifact` returns `member.test(base) ? dir : null` inside a declared directory and never
  // falls through to the basename table, so a loose pattern here would not merely over-match — it would
  // take a REGISTER tool's artifact and re-route its repair to a call that cannot write it. `\.md$` is
  // what separates them (both siblings are `.json`), and the arm asserts the two siblings still resolve
  // to null rather than only that the note matches.
  ["register-units", { tool: "record_unit_note", what: "the unit's audit note", member: /\.md$/,
    // THE READER TAKES THE FILE, NOT JUST THE RUN, because a per-axis transport journals per axis: six
    // units append in parallel and one shared file would be a journal nobody can attribute. The axis is
    // the note's own basename, which is the same key the driver bound and the tool enforced.
    refusals: (runDir, file) => unitRefusalsFor(runDir, basename(String(file ?? ""), ".md")) }],
]);

// ── THE THIRD SHAPE: a fan-out artifact that is NOT in its own directory ─────────────────────────────
//
// `knockout-assess-<n>.json` is per-chunk, so no exact basename can name it — and it lives in the RUN
// ROOT, so no directory can either. It is the first converted artifact neither table above can key, and
// the two obvious workarounds are both worse than a third table:
//
//   · One TOOL_WRITTEN_ARTIFACTS row per chunk — the chunk count is per RUN, so there is no finite set.
//   · Declaring the run dir in TOOL_WRITTEN_DIRS — the run dir's basename is the run id, and a row for it
//     would claim EVERY artifact in the run, routing every repair in the pipeline to one tool.
//
// THE PATTERN IS IMPORTED, NOT WRITTEN HERE. A regex retyped beside the table it describes can drift from
// the file it claims to match while both sides stay green — the failure this whole file is arranged
// against. `sample` is likewise DERIVED by calling the real constructor, because the guard that
// enumerates this table needs a concrete member and a hand-typed one is the same trap one field over.
//
// ANCHORING IS LOAD-BEARING AT THE RUN ROOT. Inside a declared directory a loose `member` over-matches
// only its siblings; here it over-matches the whole run. This artifact's neighbours are
// `knockout-assessment.md` (the merged prose — still HAND-WRITTEN) and `knockout-findings.json` (the
// merged findings), and an unanchored pattern takes the first. A false positive does not fail loudly: it
// tells a seat to CALL a tool that cannot write that artifact, which is the direction this table's own
// header warns about.
export const TOOL_WRITTEN_PATTERNS = Object.freeze([
  Object.freeze({
    re: KNOCKOUT_ASSESS_CHUNK_RE,
    tool: "record_knockout_assess",
    what: "this chunk's rated assessment",
    sample: basename(knockoutAssessChunkFile("", 0)),
  }),
  Object.freeze({ re: KNOCKOUT_CORRECTION_RE, tool: "record_knockout_correction", what: "your answer to each defect, and what you repaired", sample: basename(knockoutCorrectionFile("", 0)) }),
  Object.freeze({ re: KNOCKOUT_RECHECK_RE, tool: "record_knockout_review", what: "your second look at the corrected record", sample: basename(knockoutReviewFile("", 1)) }),
]);

/**
 * The row for an artifact the driver alone writes, or `null`.
 *
 * TAKES A PATH, not a basename, because a per-ordinal member can only be identified by its directory.
 * Every consumer of the two tables goes through here — enumerated by grep rather than from memory
 * (the cold corrective, both warm-patch lookups, the pipeline lint-repair rung and the mock's refusal),
 * so a new artifact shape reaches all of them at once instead of the four somebody remembered.
 */
export function toolWrittenArtifact(p) {
  const str = String(p ?? "");
  if (!str) return null;
  const base = basename(str);
  const dir = TOOL_WRITTEN_DIRS.get(basename(dirname(str)));
  // Inside a declared per-ordinal directory the SHAPE is the whole test — and a member that does not
  // match it falls through to NOTHING rather than to the basename table.
  if (dir) return dir.member.test(base) ? dir : null;
  // EXACT BEFORE PATTERN — a named row is the more specific claim and must win, so a future exact row
  // can never be shadowed by a pattern that happens to also match it.
  return TOOL_WRITTEN_ARTIFACTS.get(base)
    ?? TOOL_WRITTEN_PATTERNS.find((r) => r.re.test(base))
    ?? null;
}
import { everyToolCallRefused } from "./engine/tool-refusal.mjs";   // one definition, shared with the engine probe
export { everyToolCallRefused };
import { unitRefusalsFor } from "./register-unit-record.mjs";
// The chunk artifact's name shape, IMPORTED from the module that constructs the path — never restated
// here. See TOOL_WRITTEN_PATTERNS below for why this table reads a pattern instead of owning one.
import { KNOCKOUT_ASSESS_CHUNK_RE, knockoutAssessChunkFile } from "./knockout-assess-record.mjs"; import { KNOCKOUT_CORRECTION_RE, knockoutCorrectionFile } from "./knockout-correction-record.mjs";
// The frame transport's refusal reader, so a missing plan or note can be told apart from a stage that
// never called its tool — the distinction, which its sibling stage still lacks.
import { frameRefusalsFor } from "./knockout-frame-record.mjs"; import { knockoutRegisterRefusalsFor } from "./knockout-register-record.mjs";
import { KNOCKOUT_RECHECK_RE, knockoutReviewFile, knockoutReviewRefusalsFor } from "./knockout-review-record.mjs";
// The supplemental lane's single source (stages.mjs). The import is acyclic — stages.mjs reads
// verify/coverage-ledger/config/framework and never reaches back here.
import { SUPPLEMENTAL_LANE_STEERING } from "./stages.mjs";
import { anyResultErrored } from "./engine/session-record.mjs";   // a session that reached an error result is not an ok attempt, whatever its last result said
// The ask contract's enumeration (PURE, node-free — acyclic). The undispatchable hint reads the
// SIBLING ARTIFACT rather than the fail string, because the fail string is cut at 160 chars.
import { undispatchableFiringDirectives } from "./frame-diff-model.mjs";
// — the meaning-sweep form and its accumulator. Both PURE and acyclic: connotation-search.mjs
// imports nothing, disposition-union.mjs imports only it, and neither reaches back here.
import { parsePrRiskResults, connotationObligations, parseDispositionForm, CONNOTATION_FORM_TOKEN_SRC,
  CONNOTATION_UNMATCHED_MARK, CONNOTATION_NO_RESEMBLANCE_MARK, CONNOTATION_FORM_TOKEN_RE } from "./connotation-search.mjs";
import { unionDispositionForm, formSidecarPath } from "./disposition-union.mjs";
import { unionCoverageForm } from "./coverage-union.mjs";
import { coverageFormStamp, readCoverageForm, readCoverageFormInput, writeCoverageForm } from "./coverage-form-io.mjs";
import { unionPlacementForm } from "./placement-union.mjs";
import { placementRenderAccount } from "./placement-form.mjs";
import { placementFormStamp, readPlacementForm, readPlacementFormInput, readSubmittedPlacementForm, readSubmittedPlacementSetAside, writePlacementForm, renderPlacementsFile } from "./placement-form-io.mjs";
// The register-axis vocabulary, quoted verbatim into the coverage-form axis hint. ONE source: the same
// constant `rowIsSettled` refuses against, so the hint can never name a set the gate does not accept.
// Acyclic — coverage-ledger.mjs is PURE (no node imports, no driver imports).
import { REGISTER_AXES } from "./coverage-ledger.mjs";
import { PLAN_AUDIT_CLASSES } from "./register-plan.mjs";   // — the repair turn reads the SAME grading the two dispatch blocks do

// ── WHERE THE TURN CAP WENT, because its absence is a decision and not an oversight ──────────────
//
// A cross-process slot lock (CLEAROTRON_TURN_CAP, default 3) used to fence the command lanes of an
// integrator platform's agent gateway: every blocking turn held one lane for its full duration, and
// the 2026-06-12 starvation was three concurrent runs eating all of them. Compute stopped flowing
// through that gateway when the anthropic-agent engine became the default — engines run off-gateway
// and take no lane, laneWaitMs: 0 — which left the cap fencing FOUR comms one-shots and nothing else.
// Those one-shots are now outbox packets, so the cap governed an empty set.
//
// Leaving it in place would have been worse than deleting it: a configured cap and a permanently-zero
// in-use count reads as a working limit. Run parallelism is unaffected and is governed where it always
// was — CLEAROTRON_GATHER_CONCURRENCY x CLEAROTRON_MAX_CONCURRENT_RUNS, and pipeline.acquireRunSlot, which is
// the OTHER user of slot-lock.mjs and is untouched.

// What a settled turn's failure is called lives in ladder/turn-failure.mjs, and what the ladder does after it in
// ladder/next-rung.mjs, both carved out of the stage ladder below; these are re-exported so every importer is unchanged.
export { isEmbeddedFallback, isTimeout, timeoutCause, isLaneWedge, classifyWedge, isOverloaded, attemptTimedOut } from "./ladder/turn-failure.mjs";
export { warmHardWallStop } from "./ladder/next-rung.mjs";

/**
 * Did this attempt spend its whole derived budget, exit cleanly, and still fail? PURE.
 *
 * THE CASE THIS NAMES, measured on one round: an attempt ran 958.6 seconds against a derived limit of 900,
 * exited 0, wrote nothing, and was recorded as `missing_file` naming its own output. It was working the whole
 * time — 35,341 output tokens, 119 tool calls, 947.7 seconds of active time. The hard kill is the limit plus
 * 60, so it finished 1.4 seconds under it.
 *
 * WHY THE CLASSIFICATION ABOVE IS RIGHT AND THE RECORD WAS STILL WRONG. `isTimeout`'s third signal needs a
 * non-zero exit as well as a wall past the budget, and the program exited 0 — so it is not a timeout, and
 * nothing here argues it should be. The defect is that the row then read `missing_file`, which names an
 * artifact and sends the next reader to look for a path bug or a race. The two numbers that say otherwise
 * were both on the row — the wall beside the derived limit — and nobody was pointed at them.
 *
 * SO THIS RECORDS A FACT AND MOVES NO POLICY. It does not feed `isTimeout`, it does not change which retry
 * the attempt earns, and the fail class is untouched. Whether a clean exit at the budget should also earn the
 * longer retry a timeout earns is a question for the owner, and the issue that asked for this says so
 * explicitly: it may be right that a clean exit is not a timeout. This is the record it would be decided on.
 *
 * Three-valued, like the model fields on the same row: null when the budget is unknown, so "nobody derived a
 * limit for this stage" stays visibly different from "it did not spend it".
 */
export function spentBudgetCleanly({ fail, killed, code, wall, derivedLimitSec }) {
  if (!fail) return false;                              // a passing attempt is not this shape
  if (!Number.isFinite(derivedLimitSec) || derivedLimitSec <= 0) return null;
  if (!Number.isFinite(wall)) return null;
  if (killed) return false;                             // a kill is the timeout path, not this one
  if (code !== 0) return false;                         // a dirty exit at the budget IS a timeout already
  return wall >= derivedLimitSec;
}


// ── — THE RATE, DERIVED ONCE ──────────────────────────────────────────────────────────────────
//
// register-unit:transliteration-numeric spent 24.5 min to emit FEWER output tokens than a 6.8-min run of
// the same stage — 44.9 tok/s against 10.5 — and finished 31 seconds inside its timeout. Both halves of
// that comparison were already on the attempt row (`wall`, `usage.output`); the RATIO was not, anywhere
// in the tree, so establishing it meant reading two archived runs by hand and dividing. A stage that
// generates four times slower is invisible to anything watching wall alone, because a slow stage and a
// stage doing more work look identical until you divide.
//
// DENOMINATOR, STATED. `wall` excludes lane wait — t0 is taken after the slot is held and `laneWaitMs` is
// the separate measure — so this is seat time, not queueing. It does NOT separate thinking from
// generation: the numerator blends both, and the denominator still contains the turn's own tool waits.
// It records the ratio; it does not diagnose it. A field that claimed more than that would be worse than
// none, because the next reader would stop measuring.
//
// NULL IS NOT ZERO, and that is the whole reason this is a function rather than a division at the call
// site. A killed turn has a null usage envelope; emitting 0 for it would report "generated nothing" for
// exactly the 485-second-opus-killed class that run-economics keeps deliberately visible as UNMEASURED.
// An honest 0 output tokens on a measured turn still reports 0. PURE + exported for test.
// — THE TOOL GAUGE, AND WHY NULL IS NOT ZERO HERE EITHER.
//
// `toolCalls` and `toolWaitMs` say how much of a turn was tool wait rather than generation. An engine
// that cannot report them is NOT a turn that called no tools: `openai-agent` reports no whole-turn tool
// count, so a codex attempt's `toolCalls` is unmeasured. Writing 0 for it would make every codex turn read
// as "called no tools", and a cross-engine comparison would then conclude tool calls are an Anthropic-only
// phenomenon — from an instrument that had simply gone quiet. Its tool wait it does time, from when each
// tool item opens and closes in its stream (openai-agent.mjs, codexTiming).
//
// PRESENT AND NULL, never absent, which is this file's own house rule: a field written even when null
// keeps "this engine cannot report" visibly different from "this record predates the gauge". The first
// cut emitted `undefined`, which JSON drops — the field vanished and those two states became one.
//
// A function rather than a ternary at each call site, for the same reason `tokensPerSec` is one: there
// are two sites, and the rule has to be impossible to state differently in each. PURE + exported for test.
/**
 * THE SAME GAUGE RIDES TWO LEDGERS, AND SUMMING BOTH DOUBLE-COUNTS EVERY FIGURE.
 *
 * `toolGauge` is spread into the per-stage `_driver/<stage>.jsonl` attempt row AND into `run.jsonl`'s
 * `attempt` event, deliberately — the per-stage ledger is what a stage's own analysis reads and the
 * spine is what a whole-run rollup reads, and neither should have to join the other. But a scan that
 * walks every jsonl under the run dir sees each attempt twice, and every millisecond total comes out
 * exactly 2x. That happened: a run-level tool-wait rollup was quoted at double before the shares (which
 * are ratios, and so survive the doubling untouched) gave it away.
 *
 * A ROLLUP MUST PICK ONE LEDGER. Proportions are safe either way; absolute times are not.
 */
export function toolGauge(turn) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  return {
    toolCalls: n(turn?.toolCalls), toolWaitMs: n(turn?.toolWaitMs),
    // round 2 — the two fields that make a WALL KILL readable. `activeMs` is elapsed minus tool wait,
    // including the gap still open when the kill landed; `toolWaitByTool` says what the wait was made of,
    // keyed by the tool(s) of each ask. The total alone cannot separate `register_execute_plan` (the harness
    // working) from the perplexity tools (another MODEL generating) — and the whole "should the kill clock
    // count tool wait" question turns on which of those the wait was.
    activeMs: n(turn?.activeMs),
    // An OBJECT is a measurement (possibly `{}`: measured, no tools). null is "this engine cannot report".
    toolWaitByTool: turn?.toolWaitByTool && typeof turn.toolWaitByTool === "object" && !Array.isArray(turn.toolWaitByTool)
      ? { ...turn.toolWaitByTool } : null,
    // — the asks whose wait the driver COULD NOT MEASURE: ask and result arrived in
    // one stdout chunk, so both were parsed at the same millisecond and the gap reads 0 for a wait that
    // really happened. An ARRAY is a measurement (`[]` = measured, nothing unmeasurable); null is "this
    // engine cannot report", the same distinction toolWaitByTool draws one line up. RECORDING ONLY:
    // toolWaitMs and the per-tool split are exactly what they were, because the kill clock reads them.
    toolWaitUnmeasurable: Array.isArray(turn?.toolWaitUnmeasurable) ? [...turn.toolWaitUnmeasurable] : null, ...toolCallCounts(turn),
    // The calls by tool name, beside the total, so a tool server's own log can be set against what the
    // model asked for. An OBJECT is a measurement (`{}`: none); null is "this engine cannot report".
    toolCallsByName: turn?.toolCallsByName && typeof turn.toolCallsByName === "object" && !Array.isArray(turn.toolCallsByName)
      ? { ...turn.toolCallsByName } : null,
    // ms from spawn to the engine's first output, on both engines; null when it never spoke or cannot report. With
    // `toolWaitMs` and `activeMs` it splits a turn into start-up, tool wait and work. RECORDING ONLY.
    firstByteMs: n(turn?.firstByteMs),
    // The first call's cache read and write in tokens, where the engine reports them (Claude), and how many times the turn
    // searched for a tool to load (`ToolSearch`), read off its own per-name counts. null where the engine cannot say.
    firstCallCache: turn?.firstCallCache && Number.isFinite(turn.firstCallCache.read) && Number.isFinite(turn.firstCallCache.creation)
      ? { read: turn.firstCallCache.read, creation: turn.firstCallCache.creation } : null,
    toolSearchCalls: turn?.toolCallsByName && typeof turn.toolCallsByName === "object" ? (turn.toolCallsByName.ToolSearch ?? 0) : null,
  };
}

/**
 * Whether the attempt is OK: the driver's verdict (`fail`) AND no result event of the session carried
 * `is_error`. A session the vendor refused and a restart recovered ends in a successful LAST result, so
 * the retry ladder (which reads that last result, unchanged) accepts it; the record says what happened.
 * Readers that ask "did the stage fail" read `fail`, which this does not touch. PURE.
 */
export function attemptOk(fail, turn) {
  return !fail && !anyResultErrored(turn?.session);
}

/**
 * The stream record as a row carries it: the file relative to the run, as the dispatch record names its
 * file, and the size — or why it was not kept. null when the engine kept none or ran no session. PURE.
 */
export function streamMeta(runDir, stream) {
  if (!stream || typeof stream !== "object" || !stream.file) return null;
  const dir = String(runDir ?? "");
  const file = dir && String(stream.file).startsWith(dir) ? String(stream.file).slice(dir.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") : String(stream.file);   // forward slashes, as every record path is, on Windows too
  return { file, present: stream.present === true, bytes: Number.isFinite(stream.bytes) ? stream.bytes : null,
    ...(stream.reason ? { reason: stream.reason } : {}) };
}

export function tokensPerSec(usage, wall) {
  const w = Number(wall);
  if (!usage || !Number.isFinite(w) || w <= 0) return null;
  const out = Number(usage.output);
  if (!Number.isFinite(out) || out < 0) return null;
  return Math.round((out / w) * 100) / 100;
}


// ── — THE CAUSE HAS TO SURVIVE THE DIGEST, AND `slice(-3)` IS WHY IT DID NOT ──────────────────────
//
// Both attempt records kept the LAST three non-empty stderr lines. That is the wrong end for the failure
// this issue is about: a warm-patch rung on the codex engine dies in UNDER A SECOND with exit 1, zero
// tokens, `runId: null` — a startup crash, whose cause is the FIRST thing a process says, not the last.
// What survived was the standing codex PATH-alias warning ("Refusing to create helper binaries under
// temporary dir"), so the record carried noise and the actual exit cause was unrecoverable from the
// artifacts. The rung is spent either way; the diagnosis is what was lost.
//
// HEAD AND TAIL, and the elision is MARKED. A digest that silently drops its middle is a narrator
// claiming to be a transcript — the same shape as a summary line that reads broader than it measures. If
// lines were dropped the digest says how many, so a reader knows it is holding an excerpt.
//
// NOT FILTERED. The obvious move is to drop the known PATH-alias line and keep three real ones, and it is
// refused: a filter that removes what it has decided is noise is exactly how a real cause disappears the
// first time it arrives wearing an unexpected shape. Widening the window keeps the noise AND the signal.
export const STREAM_DIGEST_KEEP = 4;
export function streamDigest(text, { keep = STREAM_DIGEST_KEEP } = {}) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= keep * 2) return lines.join(" ⏎ ");
  const dropped = lines.length - keep * 2;
  return [...lines.slice(0, keep), `… ${dropped} line(s) elided …`, ...lines.slice(-keep)].join(" ⏎ ");
}


// D3 — inter-attempt retry backoff. The ladder used to re-dispatch the SAME SECOND an attempt failed,
// so a failure caused by the environment (the 04:30 gateway restart, a still-booting gateway, a
// transient provider blip) burned every retry into the same broken window — the direct cause of one
// outbox-wake failure. Every retry now waits CLEAROTRON_RETRY_BACKOFF_MS first (default 20s; attempt 1
// never waits, and the wait holds NO turn slot — the engine acquires that inside runTurn). Env knob so
// the test suite pins a tiny value and ops can widen it without a code change; explicit 0 disables.
export function retryBackoffMs() {
  const raw = process.env.CLEAROTRON_RETRY_BACKOFF_MS;
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) ? Math.max(0, n) : 20000;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Under --json, stdout is clean JSON. Be defensive about any stray prefix lines anyway.
export function parseJsonStdout(stdout) {
  const s = (stdout ?? "").trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through */ }
  const nl = s.lastIndexOf("\n{");
  if (nl >= 0) { try { return JSON.parse(s.slice(nl + 1)); } catch { /* fall through */ } }
  const br = s.indexOf("{");
  if (br >= 0) { try { return JSON.parse(s.slice(br)); } catch { /* fall through */ } }
  return null;
}

export function payloadText(json) {
  return (json?.result?.payloads ?? []).map((p) => p?.text ?? "").join("\n").trim();
}


// ── Engine seam (CLEAROTRON_AI) ──────────────────────────────────────────────────────────────────
// Which adapters exist and which one this activation runs are engine/registry.mjs's; the gateway asks it
// and names no engine. Re-exported here, so every importer of these names is unchanged.
export { DEFAULT_ENGINE, registeredEngines, registerEngine, selectEngine } from "./engine/registry.mjs";

// — THE ENGINE'S OWN WRITE GUARANTEE, for the run record.
//
// The boundary is enforced on the anthropic path and absent on the codex path, and until now nothing
// in the record said which one a run got. e2e put it plainly on 2026-08-18: "the same job, run on a
// different engine, gets a different write guarantee, and nothing in the run record says so." A guarantee
// that varies by engine is acceptable when it is DECLARED and dishonest only while it is silent.
//
// UNDECLARED IS A VALUE, not an omission. An adapter that says nothing gets "undeclared" written into the
// record rather than the field quietly disappearing — an absent field reads as "not applicable" to every
// later reader, which is the failure this exists to end. A new engine therefore announces its own silence.
export const writeBoundaryOf = (engine) => {
  const v = String(engine?.writeBoundary ?? "").trim();
  return v || "undeclared";
};

// ── B — THE MEANING-SWEEP ACCUMULATOR IS REGENERATED AND COUNTED BEFORE IT IS JUDGED ───────────────
//
// Under the typed transport the rulings reach the accumulator at CALL time (disposition-tool.mjs — the
// seat sends values, the driver writes the file). What judgement time still owes is narrower and it is
// two things:
//
//   1. REGENERATION. The row set is the ledger's, regenerated every pass: a mid-turn ledger top-up grows
//      the obligations, and a stale accumulator cannot grow rows on its own. The union with an empty
//      submission IS the regeneration — same builder, same predicate, same arguments as the tool's own
//      fold, so the bytes written here and the bytes the tool writes are identical for identical inputs.
//   2. THE COUNTED STATE. The union's stats — total / ruled / outstanding, counted by `isRuled`, the
//      same predicate the gate judges with — are the run's own answer to "did this session rule any of
//      its rows?". The  veto reads exactly this (see vetoResumeRuledNone), never a failure-token
//      name: an enrolled-token veto is an enumerated check, and a fifth token forgetting to enrol is the
//      move-blindness this repo has counted seven instances of.
//
// What died here with the form path (2026-08-17 ruling, delete-not-gate): reading the seat's file
// as a SUBMISSION, preserving it, refereeing whose bytes it held (the isDriverOwnBytes machinery) and
// rewriting the seat-facing copy. The seat writes no file, so there is no submission to read, no bytes
// to referee, and no seat-facing copy to keep in step. The capture duty moved to the receiver
// (disposition-tool.mjs captureCall — the payload as handed to the process, indexed before the work).
//
// Three properties kept from the form era, each learned the hard way:
//   · IDEMPOTENT AND RE-ENTRANT. judgeArtifacts is a closure invoked more than once per attempt,
//     and the wall rescues call this again. Regenerating from the ledger makes call order irrelevant.
//   · THE ACCUMULATOR IS NOT AN EXPECTED ARTIFACT. It is never in `files`, so the AD-4 `wrote` gauge and
//     the exit-1 rescue never see a DRIVER write as model progress.
//   · THE ACCUMULATOR IS THE DRIVER'S, IN `_driver/`. It survives an attempt, a recovery park and a
//     process restart, and the seat is never told about `_driver/`, so it can be neither forged nor
//     deleted into a pass — the era stamp the validator arms on.
//
// The path is READ FROM THE SPEC (`connotation.dispositions_path`), never re-derived: it is dictated in
// exactly one place and deriving a filename twice is the drift cost weeks. The seat-facing file
// that path names is no longer written by anyone; the path's one remaining job is anchoring the
// `_driver/` accumulator's name (formSidecarPath), and renaming a spec field would break every archived
// spec for a comfort rename.
//
// RETURNS, and the three shapes are the veto's input so their meaning is load-bearing:
//   null                 — this stage owns no meaning sweep (not a form seat, no dictated path, or zero
//                          queries owed). The veto does not apply: there is no rulings count to read.
//   { countable: false } — this stage OWES a sweep and its state could not be counted (ledger or spec
//                          sidecar unreadable). The veto reads this as ruled = 0 — see the rider at
//                          vetoResumeRuledNone for why absence-reads-as-zero is correct exactly here.
//   { countable: true, total, ruled, outstanding, parked, form } — the counted state.
const FORM_SEATS = [
  { re: /^common-law-findings\.half-([a-z0-9]+)\.md$/, spec: (h) => `grid-spec.half-${h}.json`, ledger: (h) => `common-law-grid.half-${h}.json` },
  { re: /^common-law-findings\.md$/, spec: () => "grid-spec.json", ledger: () => "common-law-grid.json" },
];
export function syncDispositionForm(files) {
  for (const f of (files ?? [])) {
    for (const seat of FORM_SEATS) {
      const m = basename(String(f)).match(seat.re);
      if (!m) continue;
      const dir = dirname(String(f)), half = m[1] ?? null;
      const specPath = driverDir(dir, seat.spec(half));
      let spec = null;
      try { spec = readJson(specPath); }
      catch {
        // No spec sidecar ⇒ a pre-change archived resume: nothing dictated, nothing owed, nothing to count.
        // A spec that EXISTS and does not parse is a different fact: the stage owes a sweep whose state
        // cannot be counted, and reading that as "owes nothing" would resume a session the veto exists to
        // refuse. The validator fails such a run on grid_spec_unreadable in its own lane.
        return existsSync(specPath) ? { countable: false } : null;
      }
      const formPath = spec?.connotation?.dispositions_path;
      let recorded = null;
      try { recorded = parsePrRiskResults(readFileSync(join(dir, seat.ledger(half)), "utf8")); }
      catch { return { countable: false }; }   // owes a sweep; the ledger — the obligations' source — is unreadable
      const ob = connotationObligations(recorded);
      if (!ob.queries.length) return null;   // this seat owns no meaning queries (half a, always)
      const accum = formSidecarPath(formPath);
      const readForm = (p) => { try { return parseDispositionForm(readFileSync(p, "utf8")); } catch { return { rows: null, error: null }; } };
      const u = unionDispositionForm({ rows: readForm(accum).rows }, { rows: null }, ob,
        { half, generatedFrom: seat.ledger(half) });
      // Said out loud on failure rather than swallowed. The gate arms on the `_driver/` copy, so a write
      // that silently did not land would disarm the gate rather than over-report — an absence reading as
      // a pass, which is the one outcome this file exists to refuse. The COUNT is still returned: it was
      // computed from what is on disk plus the regenerated rows, and refusing to report it would turn a
      // failed write into a veto-blinding absence.
      try { mkdirSync(dirname(accum), { recursive: true }); writeFileSync(accum, JSON.stringify(u.form, null, 2) + "\n"); }
      catch (e) { note(`[disposition-accumulator] could not write ${accum}: ${abbrev(String(e.message), 120)}`); }
      // — `parked` JOINS THE COUNTED STATE. Every reader of this object asks "is the meaning sweep
      // finished", and total/ruled/outstanding could not answer it once the park existed: a run with one
      // parked row reports outstanding 0 with ruled < total, which reads as an arithmetic oddity rather
      // than as an obligation nobody decided. Carried by KIND for the same reason the audit is — the
      // declared:exhausted ratio is the only evidence the honest exit is working.
      return { countable: true, total: u.total, ruled: u.ruled, outstanding: u.outstanding,
        parked: u.parked, form: u.form };
    }
  }
  return null;
}

// The register sibling of syncDispositionForm above, with the same three properties and the same
// reasons: idempotent and re-entrant (judgeArtifacts is a closure invoked more than once per attempt),
// never in `files` (or the AD-4 `wrote` gauge would read a DRIVER write as model progress), and the
// accumulator lives in `_driver/`.
//
// SINCE THE TYPED-TRANSPORT CONVERSION THIS READS NO SEAT FILE — there is none to read. Statuses reach
// the accumulator mid-turn through the `record_coverage` tool (coverage-tool.mjs), so this sync's one
// remaining job is REGENERATION before judgement: the driver rows are recomputed from the plan, the
// receipt and the bands as they stand NOW (a settlement-flush or supplemental merge can grow the row
// set between the seat's last call and the judgement), with everything already settled carried by the
// union. `submitted: {rows: null}` is the union's said-nothing arm: prior seat rows and statuses are
// inherited, never retracted by a pass that made no call.
//
// ARMED ON THE ERA STAMP, NEVER ON THE FORM'S OWN PRESENCE. `coverageFormStamp` answers "did a driver
// carrying this code require a form on this run". If it did not — every archived run, and any run whose
// plan apparatus was out of reach — this is a no-op and no verdict moves. If it did, the union runs and
// the form is on disk for the validator; and if the WRITE fails, the stamp is already there and the
// validator fails closed with coverage_form_missing rather than passing over an absence.
//
// Returns the union's stats for the attempt row, or null when this stage owns no coverage form.
export function syncCoverageForm(files) {
  for (const f of (files ?? [])) {
    if (basename(String(f)) !== "register-findings.md") continue;
    const runDir = dirname(String(f));
    const { required, formName } = coverageFormStamp(runDir);
    if (!required) return null;
    const input = readCoverageFormInput(runDir);
    if (!input) return null;             // the stamp cannot outlive its inputs; nothing to regenerate
    // — THE DRIVER NAMES ITSELF. An axis minted from a stray file in register-units produces a row
    // the seat cannot repair and the union regenerates every pass, so the ladder runs out with nothing
    // saying why. verify.mjs recorded that hazard as unguarded and asked for a driver-named report if it
    // was ever observed; this is the report. The axis set is UNCHANGED — filtering it would silently
    // shrink the form, which is worse than the row it would avoid.
    for (const a of (input.unknownAxisUnits ?? []))
      note(`[coverage-form] register-units carries ${a}.md, which is not one of the register axes — its row is DRIVER-written and a seat cannot repair it. This is a driver fault, not a seat one.`);
    const prior = readCoverageForm(runDir, formName).rows;
    const u = unionCoverageForm({ rows: prior }, { rows: null }, input);
    // Said out loud on failure rather than swallowed — but UNLIKE this is not the fail-open leg:
    // the stamp is already armed, so a write that did not land surfaces as coverage_form_missing at the
    // very next judgement instead of disarming the gate.
    try { writeCoverageForm(runDir, u.form, formName); }
    catch (e) { note(`[coverage-form] could not write ${formName}: ${abbrev(String(e.message), 120)} — the gate fails closed on the absence`); }
    return u;
  }
  return null;
}

// ── — THE PLACEMENT FORM IS UNIONED BEFORE IT IS JUDGED, AND placements.json IS RENDERED ────────
//
// The third of its kind, and the one that matters most for wall-clock: `placement-inquiry` was the
// largest stage on all four of the 2026-08-09 round's clearances, and on R1 half of its 62 minutes was
// thrown away when a killed attempt's finished tiers were re-derived from nothing.
//
// TWO ACTS, IN ORDER, ON EVERY JUDGEMENT. Union the seat's answers into the accumulator, then RENDER
// placements.json from the accumulator. The render is here rather than at stage exit for the reason the
// incident teaches: the artifact must exist the moment the seat's work does, not once the turn is allowed
// to finish. A wall that lands between the two is exactly the gap this closes.
//
// ARMED ON THE ERA STAMP, never on the form's own presence — a run whose stamp is absent is every
// archived run, and this is a no-op on all of them.
export function syncPlacementForm(files) {
  for (const f of (files ?? [])) {
    if (basename(String(f)) !== "placement-recommendations.md") continue;
    const runDir = dirname(String(f));
    if (!placementFormStamp(runDir).required) return null;
    const input = readPlacementFormInput(runDir);
    const priorForm = readPlacementForm(runDir);
    const submitted = readSubmittedPlacementForm(runDir);
    const u = unionPlacementForm({ rows: priorForm.rows, set_aside: priorForm.set_aside },
      submitted === null ? null : { rows: submitted, set_aside: readSubmittedPlacementSetAside(runDir) }, input);
    try { writePlacementForm(runDir, u.form); }
    catch (e) { note(`[placement-form] could not write the form: ${abbrev(String(e.message), 120)} — the render below still runs from the union in hand`); }
    // PARSE-THEN-LAND, through the gate's own parser, before it replaces anything. A render defect can
    // never put an unparseable deliverable on disk, and on a throw the previous file is left alone.
    const r = renderPlacementsFile(runDir, u.form.rows);
    if (!r.ok) note(`[placement-form] placements.json NOT re-rendered: ${r.error} — the previous file stands and the omission is on the form`);
    // WHO OWES EACH ROW THE RENDER LEFT OUT — the same account validators.placement judges with, carried onto
    // the attempt row so an omission is never read without its cause.
    const a = placementRenderAccount(u.form.rows);
    const account = { unjudged: a.unjudged.length, registerSelected: a.register_selected,
      registerRendered: a.register_rendered, registerFacts: a.register_facts };
    return { ...u, rendered: r.ok ? r.placements : null, render_error: r.error, account };
  }
  return null;
}

/**
 * Run ONE pipeline stage as a blocking gateway agent turn, with file-truth gating + bounded retries.
 *
 * Failure taxonomy — none silently passes:
 *   (embedded fallback) | (non-zero/timeout exit) | (unparseable json) | (status != "ok")
 *   | (expectFile missing —) | (expectFile fails its structural validator)
 * Retries run on a FRESH session key (winning-key hardening), with ONE exception: a content failure
 * whose turn completed cleanly and whose reason is warm-allowlisted gets ONE warm patch retry that
 * RESUMES the failed session (see warmEligible below). Timeout/transport failures are always fresh.
 *
 * @returns {{ok:boolean, json?:object, attempts:number, text?:string, fail?:string}}
 */
// ──: ONE CODEX HOME PER STAGE LADDER, NOT PER TURN ────────────────────────────────────────────
//
// codex resolves `resume <thread-id>` against $CODEX_HOME/sessions. The engine used to create and
// delete that directory per TURN, so every warm resume pointed at a home that had never heard of the
// thread. Measured on codex-cli 0.147.0: it does not start fresh, it fails —
// `thread/resume failed: no rollout found for thread id … (code -32600)`, exit 1 — and the control
// (same id, its own home) resumes cleanly.
//
// THE SCOPE IS THE LADDER, NOT THE RUN. The issue proposed a per-RUN home; that is wrong here.
// pipeline.mjs's runBatched dispatches stages at gatherConcurrency, so several ladders are live inside
// one clearance at once, and each renders its own config.toml with its own [mcp_servers] and
// allowedTools. A shared per-run home would have concurrent turns overwriting one another's config —
// one stage served another stage's tools, or a half-written file. A ladder is exactly the unit that
// shares a session chain (lastSessionRef across attempts, repairRef inside one), so it is the unit
// that should share a home.
//
// Anthropic needs none of this: `claude -p --resume` resolves against an ambient store nothing wipes,
// which is precisely why warm resume worked there and not here.
export async function runStage(name, opts) {
  // The run's own engine: the one it recorded when it started, or the machine's for a run with no record.
  const engineForHome = engineForRun(opts?.runDir);
  let stageHome = null;
  if (engineForHome?.makeStageHome) {
    try { stageHome = engineForHome.makeStageHome(name); }
    catch { stageHome = null; }   // fall back to the engine's own per-turn home rather than fail a stage
  }
  try {
    return await runStageLadder(name, opts, stageHome, engineForHome);
  } finally {
    // Deleted when the LADDER settles — every resume that needed it has happened by then. Best-effort:
    // a home we cannot remove must never turn a completed stage into a failure.
    if (stageHome) engineForHome.releaseStageHome(stageHome);
  }
}

async function runStageLadder(name, opts, stageHome = null, engine = selectEngine()) {
  // The stage's options, files, billing and tools, fixed for the ladder (ladder/stage.mjs); every phase below reads them.
  const stage = stageOf(name, opts, stageHome, engine);
  const { model, sessionKey, timeoutSec, maxRetries, runDir } = stage;
  const helpers = ladderHelpers();
  // The artifact judgement, and the forms it last synced, held across attempts (ladder/judge.mjs).
  const judge = artifactJudgement(stage, helpers);
  let lastFail;
  // — WHAT ACTUALLY RAN, carried out to the caller. The attempt rows have held the truth all along
  // (`modelActual` from the wire, `modelUsed` from the engine's own resolver); the ladder simply never
  // handed either back, so the stage event upstream had nothing to write but the ASSIGNED alias. On a
  // codex run that made the skim line read `anthropic/claude-sonnet-5` while the attempt milliseconds
  // away said `gpt-5.6-sol`. Both are kept: the wire's word is the truth, the resolver's is the fallback
  // when the stream never stated one, and neither is invented.
  let lastModelWire = null;
  let lastModelUsed = null;
  let lastJson = null;          // the failed attempt's parsed envelope — warm eligibility needs its status
  let lastKey = sessionKey;     // the failed attempt's session key — the warm patch resumes exactly it
  let lastSessionRef = sessionKey;  // the failed attempt's engine sessionRef — anthropic warm-resume (--resume) reuses it
  let lastKillClass = null;     // how the failed attempt's hard-wall kill read (killedWhile): a working one is resumed warm
  const attemptFails = [];      // every failed attempt's `fail` string, in order — the taint chain reads the
                                // winning invocation's ladder (a success AFTER a kill-class attempt is tainted)
  let killSeen = false;         // has ANY attempt in THIS ladder been kill-class (isTaintRow)? One kill closes
                                // the exit-1 rescue for the rest of the ladder — see the rescue block below
  let warmUsed = false;         // one warm attempt max per stage run (mirrors the single extended timeout retry)
  // build 2 — the attempt number escalated to a FRESH dispatch after a warm patch reproduced its
  // own failure byte-for-byte. 0 = never. Because `warm` requires !warmUsed, this can be set at most
  // once per stage run, which is the structural bound on the escalation.
  let warmEscalatedAt = 0;
  //: in-dispatch form repairs spent by this stage run, capped at MAX_FORM_REPAIRS. Per STAGE RUN,
  // not per attempt, so the added spend is bounded no matter how deep the ladder goes. Deliberately
  // SEPARATE from warmUsed: a form repair must not consume the warm attempt a work-class failure is
  // entitled to on attempt 2.
  let formRepairsUsed = 0;
  let attempt = 0;
  // A warm turn that never reached the model costs no rung, once per ladder: WARM_ZERO_USAGE_FREE_RUNGS in ladder/next-rung.mjs.
  let rungsRefunded = 0;
  let timeoutRetriesUsed = 0;   // a slow stage gets ONE longer shot, then we stop (don't burn 3× the budget)
  let effTimeout = timeoutSec;  // bumped ×1.5 for the single timeout retry
  let lastQuantity = null;      //: the settled attempt's progress quantity (null = ABSENT, never zero)
  let lastReads = null;         // AD-4 reads gauge of the settled (last) attempt — rides the failure return
  let lastReadsTruncated = null; // …and whether that gauge was capped (a capped list is not a complete one)
  let lastWarm = null;          // …and whether that attempt was a WARM PATCH (a resumed session is not re-offered
                                // the files, so its gauge cannot ground a `read:false` — see journalStageInputs)
  let lastWrote = null;         // AD-4 emitted-vs-landed of the settled (last) attempt — rides the failure return
  //: the artifact the last refusal was actually ABOUT, when that is not the declared output. ONE
  // source — the same derivation that names the file in the token — so the row and the token can never
  // disagree about which artifact a ladder was fighting over. It persists across attempts on purpose:
  // the attempt that finally PASSES is the one whose sha proves what the ladder bought.
  let lastGraded = null;
  // — the bound grows with the refunds rather than the counter shrinking. Decrementing `attempt`
  // would have made a real attempt 2 report as attempt 1, and every row keyed on that number would then
  // describe a turn that did not happen. The ladder gets another rung; the record keeps its arithmetic.
  while (attempt < maxRetries + 1 + rungsRefunded) {
    attempt++;
    // ── CANCELLATION IS HONOURED HERE ────────────────────────────────────────────────────────────
    // This is the ONLY point both pipelines pass through: the clearance lane reaches runStage via
    // stage → stageWithChain → stageOnce, the knockout lane via koStage. (progress.recordTransition
    // looks like a shared advance point and is not — knockout never calls it, so a check there would
    // miss every knockout run.)
    //
    // INSIDE the attempt loop, not at function entry, because the TURN is the unit of spend: a single
    // stage is up to maxRetries+1 model turns, and a stop pressed during a retry ladder should not have
    // to wait for the ladder to exhaust. Nothing is thrown mid-turn — a dispatched turn always finishes.
    if (isCancelled(runDir)) {
      note(`[${name}] CANCELLED by user — not dispatching attempt ${attempt}`);
      throw new RunCancelled(name, readCancel(runDir));
    }
    // Warm or fresh, and the wait before it; then the turn, with its dispatch record, witness and manuals (ladder/dispatch.mjs).
    const mode = await retryMode(stage, { attempt, lastFail, lastJson, lastKillClass, lastUnion: judge.lastUnion, warmUsed }, helpers);
    const { vetoedResume, warm, timeoutWarm } = mode;
    warmUsed = mode.warmUsed;
    const { preArtifact, key, dispatch, dispatchedAt, witnessed, wire, turn, settledAt } = await dispatchTurn(stage,
      { attempt, warm, timeoutWarm, vetoedResume, lastFail, lastKey, lastSessionRef, warmEscalatedAt, effTimeout }, helpers);
    const { code, killed, wall, stderr, json, usage } = turn;

    // What the turn asked for against what the wire reported, and which program served it (ladder/model-gauge.mjs).
    const { modelRequested, modelActual, modelBasis, providerReported, modelSnapshot, famRequested, famActual, modelMismatch } = modelGauge(engine, model, turn);
    const cli = servingProgram();
    if (modelActual) lastModelWire = modelActual;                       // — never overwritten with null

    let fail = null;
    let stampedQuantity = null;   //: a validator's own exact count, when it stamped one (see below)
    let failingFile = null;       //: the artifact the validator rejected — the repair's only target
    // A TURN THAT COMPLETED IS JUDGED ON WHAT IT WROTE, whatever its stderr says about a request inside it
    // (attemptTimedOut). Which signal fired is kept on the row either way.
    const timedOutBy = timeoutCause({ killed, code, wall, stderr, timeoutSec: effTimeout });
    fail = turnFailure({ timedOutBy, code, json, stderr });
    if (fail === null) {
      const j = judge.judgeArtifacts();
      fail = j.fail; stampedQuantity = j.quantity; failingFile = j.file; lastGraded = j.graded ?? lastGraded;
    }

    // A form defect is handed back to the session that wrote it, inside this dispatch (ladder/form-repair.mjs).
    const repaired = await repairFormInDispatch(stage, judge, { attempt, key, turn, effTimeout, fail, stampedQuantity, failingFile,
      formRepairsUsed, killSeen, lastGraded, lastModelUsed }, helpers);
    const { formRepairsThisAttempt } = repaired;
    ({ fail, stampedQuantity, failingFile, formRepairsUsed, killSeen, lastGraded, lastModelUsed } = repaired);
    // Whether this attempt's own artifacts answer its failure, and the name the failure then goes by (ladder/rescue.mjs).
    const rescue = rescueAndName(stage, judge, { fail, turn, preArtifact, dispatchedAt, settledAt, killSeen,
      modelMismatch, famRequested, famActual, modelRequested, modelActual }, helpers);
    const { killClass, attemptKilledWhile } = rescue;
    ({ fail, killSeen } = rescue);
    // What this attempt wrote, read and still owes, and its draft kept when it is the best so far (ladder/attempt-record.mjs).
    const { wrote, reads, readsTruncated, quantity, noChange } = measureAttempt(stage, { attempt, key, warm, turn, preArtifact, fail,
      stampedQuantity, failingFile, killClass, killSeen, attemptFails }, helpers);
    lastWrote = wrote;
    lastReads = reads;
    lastReadsTruncated = readsTruncated;
    lastWarm = warm;

    if (runDir) {
      // The attempt's row in the stage's own log, then its event on the run's spine (ladder/attempt-record.mjs).
      const facts = { ...rescue, attempt, key, warm, warmEscalatedAt, effTimeout, dispatch, witnessed, wire, turn, cli, modelRequested,
        modelActual, modelBasis, modelSnapshot, modelMismatch, providerReported, timedOutBy, fail, formRepairsThisAttempt, lastGraded,
        wrote, reads, readsTruncated, quantity, noChange };
      writeAttemptRow(stage, judge, facts, helpers);
      writeAttemptEvent(stage, facts, helpers);
    }

    // sessionKey = the key that actually SUCCEEDED (attempt 1 = base key; a retry = `${base}-rerunN`). Callers
    // that re-run a stage as a follow-up pass THIS key, so the follow-up's records sit beside the attempt that
    // won (winning-key hardening). No engine resumes by key: resumeRef is the only continuity a turn has.
    if (!fail) return { ok: true, json, attempts: attempt, modelWire: lastModelWire, modelUsed: lastModelUsed, text: payloadText(json), sessionKey: key, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    attemptFails.push(fail);
    lastFail = fail;
    lastJson = json;
    lastKey = key;
    lastQuantity = quantity;   //: rides the ladder's final return, so the run-level catch stamps the exact count
    lastSessionRef = turn.sessionRef ?? lastSessionRef;   // anthropic warm-resume target for the next attempt
    lastKillClass = attemptKilledWhile;
    note(`[${name}] attempt ${attempt} FAILED: ${fail}${quantity === null ? "" : ` (count ${quantity}${noChange ? ", unchanged" : ""})`}`);

    // What the ladder does next after this failure — escalate, retry, break, or return — is ladder/next-rung.mjs.
    const next = nextRung({ fail, warm, attempt, maxRetries, attemptFails, usage, json, turn, signals: turn.signals, runDir, name, timeoutSec,
      saidBackOpen: SAID_BACK_OPEN_RE.test(fail), warmEscalatedAt, rungsRefunded, timeoutRetriesUsed, effTimeout });
    ({ warmEscalatedAt, rungsRefunded, timeoutRetriesUsed, effTimeout } = next);
    if (next.rung === "identical") return { ok: false, attempts: attempt, fail, sessionKey: key, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], identicalSignature: true, warmEscalated: warmEscalatedAt > 0 || undefined, quantity, noChange, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    if (next.rung === "rate-limited") return { ok: false, attempts: attempt, fail, resetsAt: turn.signals?.resetsAt, sessionKey: key, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], quantity, noChange, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    if (next.rung === "break") break;
  }
  // A SAID-BACK REFUSAL NEVER WITHHOLDS THE REPORT (reports always ship, ruled 2026-08-27). The placement form's
  // refusals refuse the pass so that a corrective turn carries them to the step, which is the only way back to it
  // within a pass (verify.mjs, placementSaidBackVerdict). They are the stage's last check, so a pass whose attempts
  // run out on one has passed every other, and stands: an open floor is recorded by the floor duty and named at
  // delivery; any other refusal is kept in the attempt record.
  if (SAID_BACK_OPEN_RE.test(lastFail ?? "")) {
    note(`[${name}] ${abbrev(String(lastFail), 160)} — still open when the attempts ran out: the pass stands; an open floor is recorded by the floor duty and named at delivery, and any other refusal is kept in the attempt record`);
    return { ok: true, json: lastJson, attempts: attempt, modelWire: lastModelWire, modelUsed: lastModelUsed, text: payloadText(lastJson), sessionKey: lastKey, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, reads: lastReads, readsTruncated: lastReadsTruncated, warm: lastWarm, wrote: lastWrote, formRepairs: formRepairsUsed, saidBackOpen: lastFail };
  }
  // sessionKey on FAILURE = the last attempted key (lastKey) — callers that recover terminally (e.g. the
  // WS-A coverage-ledger quarantine) need a session to attribute/resume; it is best-effort, not a winner.
  return { ok: false, attempts: attempt, fail: lastFail, sessionKey: lastKey, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, quantity: lastQuantity, reads: lastReads, readsTruncated: lastReadsTruncated, warm: lastWarm, wrote: lastWrote, formRepairs: formRepairsUsed };
}

// What the ladder's phases (ladder/*.mjs) call from this file. They never import it, since it imports them, so they
// are handed these, as rescue.mjs is handed `rel`.
function ladderHelpers() {
  return { rel, sleep, retryBackoffMs, vetoResumeRuledNone, warmEligible, warmTimeoutMessage, warmPatchMessage, correctiveMessage,
    syncDispositionForm, syncCoverageForm, syncPlacementForm, toolWrittenArtifact, gradedArtifact, saidBackOnly, isFormClassFail,
    MAX_FORM_REPAIRS, repairTarget, refusalsInWindow, killedWhile, draftCarryEligible, writeBoundaryOf, attemptOk, streamMeta,
    tokensPerSec, toolGauge, spentBudgetCleanly, streamDigest };
}

/**
 * One dispatch's refusals, read from the refusal journals of the tool-written artifacts in `files`.
 * An entry is placed by its `at`; one with no readable `at` cannot be placed in a dispatch, so it is
 * counted apart rather than guessed into this one.
 * @returns {{ count: number, last: string|null, unattributed?: number } | null}  null when no file in
 *   `files` has a refusal journal, so "this stage keeps no journal" never reads as "nothing was refused".
 */
function refusalsInWindow(files, runDir, from, to) {
  let journals = 0, count = 0, unattributed = 0, last = null, lastAt = -Infinity;
  for (const f of files) {
    const reader = toolWrittenArtifact(f)?.refusals;
    if (!reader) continue;
    journals++;
    for (const r of reader(runDir, f) ?? []) {
      const at = Date.parse(String(r?.at ?? ""));
      if (!Number.isFinite(at)) { unattributed++; continue; }
      if (at < from || at > to) continue;
      count++;
      if (at >= lastAt) { lastAt = at; last = String(r?.reason ?? ""); }
    }
  }
  return journals ? { count, last, ...(unattributed ? { unattributed } : {}) } : null;
}

// A failure string's display path. A path outside a studio keeps its Windows drive, `C:\…`, so the patterns
// that read these strings back never stop the path at the first colon: FORM_CLASS_RE and WARM_ELIGIBLE_RE
// take the path lazily up to the token they know, and failingTarget allows a drive letter.
function rel(p) {
  const m = /[\\/](clearance-search|prelim-search)[\\/]/.exec(p);   // either spelling of the studio segment, behind either separator
  return m ? p.slice(m.index + 1) : p;
}

// Fix B: a retry after a CONTENT (file-validation) failure tells the model what was wrong, instead of re-running
// the identical prompt blind (recovery was model-variance luck — the skeptic burned 2 of 3 attempts this way on
// marble-keystone). A FRESH-session retry carries the correction in the MESSAGE (winning-key hardening); the warm
// patch retry below resumes the completed session with the same hint. Only content failures (invalid_file /
// missing_file) get corrective text — a timeout/transport failure is fixed by re-running, not by different content.
// opts.supplementalLane (trailing + optional, so every positional caller is unchanged): the failing stage
// ran without register_enumerate, so a hint that names it would contradict the prompt it is appended to.
export function correctiveMessage(baseMessage, attempt, lastFail, expectFile, { supplementalLane = false, adds = false } = {}) {
  if (attempt <= 1 || !lastFail) return baseMessage;
  // A6 (addendum 2026-07-30): the max_tokens fault wraps the underlying content failure (or stands bare
  // on a transport-shaped turn). The retry must be told the CAUSE was the output ceiling — an unnamed
  // re-run does the same work at the same length and dies on the same wall.
  const maxTok = /^max_tokens_no_output(:|$)/.test(lastFail);
  const inner = maxTok ? lastFail.replace(/^max_tokens_no_output:?/, "") : lastFail;
  if (!maxTok && !/^(invalid_file|missing_file)/.test(inner)) return baseMessage;
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  const names = files.map(rel).join(", ");
  // DIRECTION (b) — THE COLD CORRECTIVE IS A REPAIR SURFACE, AND the SWEEP STOPPED AT THE WARM ONE.
  //
  // `warmPatchMessage` consults TOOL_WRITTEN_ARTIFACTS and turns a repair into a CALL. This composer did not,
  // so a converted seat that hit the output ceiling was told to "CALL THE WRITE TOOL" for an artifact whose
  // only writer is the driver — an order it cannot obey, because the conversion took `Write` out of its grant.
  // Same class as the ten anchor sites and the two transports before them: a retirement reaches the
  // first-attempt surfaces and misses a correction surface.
  //
  // FOUND BY recording-agreement.mjs, and the way it found it is the point: it drives this function's REAL
  // OUTPUT through the write-order markers rather than reading its branches, so the miss showed up as text a
  // seat would actually be handed.
  const toolWritten = files.length ? toolWrittenArtifact(files[0]) : null;
  const budget = maxTok
    ? `Your previous attempt STOPPED at its maximum output-token ceiling (stop_reason max_tokens) before any usable ` +
      `output landed — the size of what you tried to emit WAS the failure. Do the work with LESS output: ` +
      (toolWritten
        ? `call \`${toolWritten.tool}\` with ${toolWritten.what} as soon as the values are ready — the driver ` +
          `writes the file from that call, and nothing you write by hand is read — `
        : `CALL THE WRITE TOOL for the required file(s) as soon as their content is ready, `) +
      `keep your text reply to a 2-3 line summary, and never restate file contents or your reasoning in the reply. `
    : "";
  if (!/^(invalid_file|missing_file)/.test(inner))
    // bare max_tokens fault (the turn died at the ceiling before file validation could even run)
    return baseMessage +
      `\n\nCORRECTION: ${budget}${requiredFileClause(inner, { names, toolWritten })}`;
  return baseMessage +
    `\n\nCORRECTION: your previous attempt failed file validation (${inner}). ${budget}Re-do the task and make sure ` +
    `${correctionHint(inner, { gridLedgerName: gridLedgerNameFor(expectFile), supplementalLane, undispatchable: frameDiffUndispatchable(expectFile, inner), heldRecord: heldSynthesisRecord(files), adds })}. ` +
    requiredFileClause(inner, { names, toolWritten });
}

/**
 * The trailing "The required file is …" sentence — the LAST thing the seat reads, and the position a
 * reader weights most.
 *
 * Under the typed disposition transport this is ONE sentence for every token: the stage's declared
 * output is the only file the seat owes, and rulings ride the `record_dispositions` tool, which the
 * connotation hints name. The two-file variant this used to carry ( — the hint and this clause
 * contradicting each other about which file to finish) died with the seat-facing form: there is no
 * second file left to name, and re-adding one here would re-open the exact contradiction measured
 * in a delivered run's dispatch. PURE.
 *
 * — `toolWritten` (a TOOL_WRITTEN_ARTIFACTS row, or null) is what keeps the LAST sentence honest after
 * a conversion. "Do not stop until it exists" is an instruction to a seat that can make a file exist; once
 * the driver is the only writer, the thing the seat must not stop before is the tool ACCEPTING the call.
 * Optional and trailing, so every existing positional caller is unchanged and a stage with no row keeps the
 * sentence it has.
 */
export function requiredFileClause(inner, { names, toolWritten = null } = {}) {
  const out = names || "the stage output";
  if (toolWritten) {
    return `${out} is written by the driver from your \`${toolWritten.tool}\` call. `
      + `Do not stop until the tool accepts it.`;
  }
  return `The required file is ${out}. Do not stop until it exists and is complete.`;
}

// A1 split: which grid ledger a grid_*/platforms_missing defect is ABOUT — derived from the failing
// stage's own output file, never hardcoded (mirrors the named_band sibling derive in warmPatchMessage).
// A half member's findings file (common-law-findings.half-<h>.md) is judged by validators.commonLawHalf
// against ITS half ledger (common-law-grid.half-<h>.json), so a hint naming the canonical
// common-law-grid.json would aim every warm patch and cold retry at a file the half validator never
// re-reads — the ladder would repeat the same wrong-file repair until the member exhausts.
export function gridLedgerNameFor(expectFile) {
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  const m = files.length ? basename(String(files[0])).match(/^common-law-findings\.half-([a-z0-9]+)\.md$/) : null;
  return m ? `common-law-grid.half-${m[1]}.json` : "common-law-grid.json";
}

// The ask contract's offenders, read off the SIBLING artifact the failing stage saved — the same
// derive-from-the-out-file shape as gridLedgerNameFor above and warmPatchMessage's named_band branch.
// The stage's out file is <run>/frame-diff.md; its structured sibling is <run>/frame-diff.json. This
// exists because the fail string CANNOT carry the list: verify.mjs slices a parse error to 160 chars,
// which is less than one offender's name plus reason. Never throws — an unreadable artifact yields []
// and the hint falls back to scraping the (truncated) token, which still names one.
export function frameDiffUndispatchable(expectFile, lastFail = "framediff_directive_undispatchable") {
  if (!/framediff_directive_undispatchable/.test(String(lastFail ?? ""))) return [];   // no stat on every other corrective turn
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  if (!files.length) return [];
  try { return undispatchableFiringDirectives(readFileSync(join(dirname(String(files[0])), "frame-diff.json"), "utf8")); }
  catch { return []; }
}

// Reason-aware hint: the validator's reason rides inside lastFail — translate the known ones to a concrete fix
// so the retry knows what to change (default covers any other content failure). opts.gridLedgerName: the
// ledger the grid hints name (gridLedgerNameFor — the canonical file, or the failing half member's own).
// opts.supplementalLane: the failing stage's toolset had register_enumerate removed (derived in runStage
// from excludeTools) — the hints that name a repair TOOL branch on it.
// opts.undispatchable: [{item, why}] read off the saved frame-diff.json (frameDiffUndispatchable) — the
// ask contract's offenders, because the fail string is truncated to 160 chars and can only name the first.
// Trailing + optional exactly like supplementalLane, so every positional caller is unchanged; an empty
// list falls back to scraping the token, which still beats naming nothing.
// B — connotation hints name the `record_dispositions` TOOL, never a file: the seat writes no
// dispositions file, and the one thing R6's three dead attempts were never told was where the gate was
// counting. Under the typed transport the answer is the tool, and every connotation arm names it.
/**
 * `toolWritten` — the ARTIFACT this hint is about is the driver's render, not the seat's file.
 *
 * A hint describes WHAT is wrong; the caller's tail says HOW to repair it. A few hints were written
 * before any artifact was tool-written and closed with a write instruction of their own, which on a
 * converted stage puts two contradictory orders in one message: "re-save the COMPLETE JSON file"
 * immediately above "never by writing or editing any file". Measured on the digest after conversion 11
 * — the routing was already correct, the prose was not. So the closing clause is the one part of a hint
 * that has to know, and it is passed rather than guessed.
 */
// THE CLEARANCE WRITER'S FINDINGS CONTRACT, AND ONLY IT. A knockout finding's refusals carry `knockout_finding_*`
// and `knockoutassess_finding_*` tokens (findings-model.mjs), prefixed so that no clearance branch would take
// them; a bare `findings?_` matched the `finding_` inside them anyway, named findings.json, a file a knockout
// run never has, and handed the model the clearance contract's keys. `synthesis_findings_*` stays the
// clearance writer's.
const CLEARANCE_FINDINGS_TOKEN_RE = /(?<!knockout_|knockoutassess_)findings?_/;

// THE WRITER'S RETRY, WHEN THE DRIVER HOLDS ITS RECORD. A save the tool accepted can still fail the stage's own check
// of the written files, and the driver then holds the record that save left: the retry sends only the change, in the
// patch the follow-ups above it ask for. A record nobody saved yet, or one whose version is being replaced, still
// takes the complete save.
// The patch a held record takes, in the tool's own words; the retry for most findings checks leaves the narrative as it is.
// On the correction answering a review's flags, and on its retries, the rows are described in the words ruled for that
// correction (2026-11-02): it may add the finding for an excluded position its flags name (synthesis-record.mjs).
export const REPLACED_ROWS = "the complete corrected finding object(s), each with the `ordinal` it replaces";
export const CORRECTION_ROWS = "the complete finding objects you changed or added: keep each existing finding's `ordinal`; for a new finding answering a flag about an excluded position named in this correction, use the next unused ordinal after the highest in the current record and cite a record from that position";
/** The rows a held record's patch carries: on a correction's dispatch (`adds`), the finding it may add among them. PURE. */
export const patchRows = (adds = false) => (adds ? CORRECTION_ROWS : REPLACED_ROWS);
const heldRecordPatch = (adds = false) => `ONE \`record_synthesis\` PATCH call, sending only the change: \`findings_patch\` carrying ${patchRows(adds)}, and \`findings\` carrying any register you corrected, complete, and never a \`findings[]\` list`;
const heldRecordRetry = (adds = false) => `Fix exactly that in ${heldRecordPatch(adds)}; leave the narrative prose unchanged`;
const VERSION_FAILURE_RE = /finding_legacy_scale_forbidden|schema_version/;
// A USE CHECK'S CORRECTION corrects what depends on the finding too, so it never says to leave the narrative as it is
// (design, 2026-10-28). A held record takes the patch, in the tool's own words, with the narrative sections it changes;
// a record not yet accepted is completed by its first call, which the line after every hint names. The caller prints a
// full stop after the hint, so the ruled sentences go without their last one.
const USE_CHECK_TOKEN_RE = /finding_use_check_(missing|source_missing):/;
const useCheckCorrection = (heldRecord, adds = false) => heldRecord
  ? `${RESEARCH_CORRECTION} Send it in ${heldRecordPatch(adds)}. In \`narrative\`, send only the sections you changed — the rest are held`
  : RESEARCH_CORRECTION.replace(/\.$/, "");
/**
 * Does the driver hold an accepted synthesis record for the run these files belong to? Read from either of the files
 * the writer's call renders: the stage's own expected file is the narrative, and a caller may name the findings.
 */
export const heldSynthesisRecord = (files) => {
  const f = (Array.isArray(files) ? files : [files]).find((x) => typeof x === "string" && [NARRATIVE_FILE, FINDINGS_FILE].includes(basename(x)));
  return Boolean(f) && existsSync(synthesisCallPaths(dirname(f)).accepted);
};

// ── THE REPAIR HINTS: ONE ROW PER FAILURE, READ IN ORDER ─────────────────────────────────────────
//
// Each row names the failure it answers (`code`), the pattern that recognises that failure in the
// failure string (`when`), and the end state the corrective turn is told to reach (`hint`). The FIRST row
// whose pattern matches answers, so the order is part of the table: a row that must sit above another
// says so in its own comments, as the findings row does above the coverage rows. A failure no row
// recognises gets REPAIR_HINT_DEFAULT. `failureCode` names the row a failure selects, so a test or a
// record can say which repair a turn was handed without matching the sentence.
const REPAIR_HINTS = [
  { code: "findings_contract", when: CLEARANCE_FINDINGS_TOKEN_RE, hint(lastFail, { heldRecord, adds }) {
    // The per-finding machine contract (findings-model.mjs). MUST sit ABOVE the coverage_ branch — a
    // findings_coverage_* token would otherwise route to the (wrong) coverage-ledger hint. The structural
    // "findings-heading" token has no underscore after "findings", so it never matches this branch.
    const tok = (lastFail.match(new RegExp(`${CLEARANCE_FINDINGS_TOKEN_RE.source}[a-z_]+(?::[^\\s)]*)?`)) || ["findings contract defect"])[0];
    // A2 (teal-bastion) — the specific repair the blind generic hint was missing: the famous-neighbour
    // empty-uri crash. Without naming the fix (registrations:[] / route to context_notes), three retries each
    // re-emitted a different malformed shape and never converged. These addenda close that loop.
    let extra = "";
    if (/finding_registration_invalid/.test(lastFail)) {
      extra = ` SPECIFIC FIX: a registration.uri is NEVER empty. If this finding has a fetched register record, ` +
        `put its real record URI. If it has NO fetched record (a common-law finding, or a famous mark known only ` +
        `from general knowledge — e.g. KODAK on a CODAK clearance), it is NOT a register finding: set ` +
        `"registrations":[]. And if it is a famous one-keystroke/homophone NEIGHBOUR kept only for diligence, move ` +
        `it OUT of findings[] into the top-level "context_notes" array ({"type":"famous-neighbour-ungrounded",` +
        `"mark","owner","context"}). NEVER invent an empty-uri registration to satisfy the schema.`;
    } else if (/finding_source_/.test(lastFail)) {
      extra = ` SPECIFIC FIX: source is {"source_type","resolved_link"} with source_type EXACTLY one of ` +
        `register-vendor / register-euipo / common-law-marketplace / common-law-web / case-law (a knowledge-cited ` +
        `or common-law finding wears a common-law tag, NEVER a register tag); resolved_link = the URL you actually ` +
        `fetched, or "".`;
    } else if (/findings_context_note_/.test(lastFail)) {
      extra = ` SPECIFIC FIX: each context_notes entry is EXACTLY {"type":"famous-neighbour-ungrounded","mark",` +
        `"owner"(optional),"context"} — a short non-finding diligence note for a famous neighbour with no fetched ` +
        `record; it carries no band/registration and never moves the rating.`;
    } else if (/finding_legacy_scale_forbidden/.test(lastFail)) {
      // doc 50 — the reversion repair: years of Composite/Level habit pull the model back to the retired
      // scale; the fix is stated in the framework's own terms, never as a mapping. Under a framework that
      // states a method the refusal itself says so, and the retired keys have a home: the framework's own
      // inputs (framework-method.mjs).
      extra = /own inputs under "inputs"/.test(lastFail)
        ? ` SPECIFIC FIX: delete composite/level/dispute_type and record the framework's own inputs under ` +
          `"inputs", then give the band the framework's table yields for them.`
        : ` SPECIFIC FIX: schema_version 4 carries NO composite/level/dispute_type — delete those keys. ` +
          `The rating is "band": the band WORD your reasoning under the framework you read yields (EXACTLY one of ` +
          `its band words, as written in the framework). Your reasoning trail stays in the narrative prose.`;
    } else if (/finding_(inputs_[a-z]+|band_off_table|borderline_off_table):/.test(lastFail)) {
      // The framework's method (framework-method.mjs). Each refusal already names its fix — the value list,
      // or the band the table gives — so no addendum: the generic band hint below would point elsewhere.
      extra = "";
    } else if (USE_CHECK_TOKEN_RE.test(lastFail)) {
      // A use status with no source behind it. Where no search completed, the honest record is an unknown use,
      // never a no-result, so the repair is handed the ruled sentence for a search that did not answer, unchanged.
      extra = ` ${NO_SEARCH_RESULT}`;
    } else if (/finding_band_|findings_rated_under_|finding_disposition_missing/.test(lastFail)) {
      extra = ` SPECIFIC FIX: every finding carries "disposition"; adversarial / coexistence-partner / ` +
        `distinguished findings are RATED and carry "band" = EXACTLY one of the framework's band words (as ` +
        `written in the framework you read — no numbers, no codes, no words from any other scale); off-field ` +
        `findings are NOT rated and carry NO band. The top level carries "rated_under_framework" = the ` +
        `framework key you were told to rate under, verbatim.`;
    }
    return `findings.json is a JSON OBJECT { schema_version, rated_under_framework, findings[], coverage[], context_notes[] } ` +
      `(schema_version 5 additionally allows top-level ask_answers[] = [{ask, answer}], structured mark_assessment fields, ` +
      // review — coverage_judgment.rows USED TO BE LISTED HERE as a key the model may emit, and
      // this is the message the seat reads at the moment it is REPAIRING findings.json: the one turn
      // where it is most likely to re-add a field the driver took. The dictation deletes the invitation
      // and the driver writes the register at the post-synthesis seam, so a hint offering it back cost a
      // paid corrective turn writing rows that are overwritten wholesale — and left the seat holding two
      // contradictory statements of who owns the field. b0ac330 fixed exactly this drift 271 lines below
      // and left this arm teaching the retired contract.
      `and corrections.entries[]). coverage_judgment carries EXACTLY { sufficient, reason } from you — do NOT emit ` +
      `"rows": the driver derives that register from the coverage ledger and the plan-execution receipt, and anything ` +
      `you type there is replaced wholesale. ` +
      // — the contract the driver now dictates. Stated here because this hint is what the model
      // reads when a findings_/finding_ token fails: a hint naming the old contract teaches the wrong one.
      `On schema_version 6 EVERY finding that reaches a reader carries BOTH "legal_position" and "practical_position" — ` +
      // ── — THE SET IS DERIVED, NOT RETYPED ───────────────────────────────────────────────────
      //
      // This sentence hand-listed all five dispositions, which made it a SECOND AUTHOR of a closed set
      // whose first author is findings-model.mjs. Retire a token there and this dictation keeps teaching
      // it; add one and this dictation silently omits it. The failure is invisible because the sentence
      // stays grammatical either way — it just describes a contract the code no longer has.
      //
      // Both halves derive. `POSITION_REQUIRED_DISPOSITIONS` IS the v6 set ("four of the five, and the
      // omission is reasoned, not an exemption"), and the parenthetical is its exact complement, computed
      // rather than restated so the two cannot disagree about which token is the odd one out.
      //
      // THE RENDERED BYTES ARE UNCHANGED, deliberately. `a, b, c AND d` is what this dictation has always
      // said, and measured that a field phrased outside its own imperative was written 0 of 9 times
      // against 74 of 74 when it was inside one — dispatch wording is not free to tidy in passing. So the
      // join restores the conjunction rather than settling for the comma `join` produces.
      `${POSITION_REQUIRED_DISPOSITIONS.join(", ").replace(/, ([^,]+)$/, " AND $1")} alike (only a review-killed ${
        DISPOSITIONS.filter((d) => !POSITION_REQUIRED_DISPOSITIONS.includes(d)).map((d) => `"${d}"`).join(" / ")
      } finding is ` +
      `outside this, and it carries "withdrawn_reason" instead). If the right stands and only its rating is withdrawn, because its goods wording cannot be used, also set "rating_withdrawn_ground": "goods-wording-unavailable". An off-field finding additionally carries ` +
      `"off_field_ground" = "different-field" (the goods do not meet — its own goods_proximity meter must then read ` +
      `"low") or "no-material-risk" (a clear win, carrying no field claim). A mark argued apart on sound, rhythm, ` +
      `orthography or connotation is "distinguished", never off-field. ` +
      `On schema_version 4+ each finding carries "band" (the framework-in-force's band WORD; rated dispositions only — ` +
      `composite/level/dispute_type are RETIRED and forbidden), owner.registrations[] (ONE entry per ` +
      `registration — never overwrite or transpose another's facts; a finding with no fetched record → []), the four ` +
      `meters as {token, basis} (basis = verified-from-record | inferred-from-signal), quadrant {x,y} in [0,1], a ` +
      `typed source, a disposition, and a unique 1-based ordinal. The failed check was: ${tok}.${extra} ` +
      (USE_CHECK_TOKEN_RE.test(lastFail) ? useCheckCorrection(heldRecord, adds)
        : heldRecord && !VERSION_FAILURE_RE.test(lastFail) ? heldRecordRetry(adds)
        : `Fix exactly that, re-save the COMPLETE findings.json, and leave the narrative prose unchanged`);
  } },
  { code: "coverage_status_offenum", when: /coverage_status_offenum/, hint(lastFail) {
    // D1 — the off-enum PROSE Status cell (distinct from coverage_status_invalid, which is the JSON
    // mirror's token): the defect lives in register-findings.md's own Coverage-ledger table, so the
    // repair is a one-cell prose relabel — never a JSON re-save. MUST sit above the JSON-mirror
    // coverage_ branch so the shared substring never routes this to the wrong file.
    const det = (lastFail.match(/\(axis ([a-z-]+)/) || [])[1] || "";   // the status text itself may carry parens — anchor on the token's own "(axis …" tail
    return `every row of the prose Coverage ledger's Status column is EXACTLY one bare token of ` +
      `confirmed-clean / coverage-limited / deferred${det ? ` (the off-enum row is on axis ${det})` : ""}. ` +
      `Relabel the offending Status cell(s) to the honest enum token and move any qualifier or commentary ` +
      `("N/A", "confirmed", "not-searched (…)", ✅, bolding) into the Reason column — an axis that was not ` +
      `applicable or not searched is an honest \`deferred\` with the reason stated. Leave every other row ` +
      `and section unchanged`;
  } },
  { code: "coverage_ledger_shape", when: /coverage_(ledger_unparseable|ledger_empty|axis_invalid|axis_missing|status_invalid|key_unknown|mirror_missing)/, hint(lastFail, { resaveClause }) {
    // Map #3 — `mirror_missing` is LEGACY and never fires anymore (the JSON is code-derived from the prose,
    // so the prose↔JSON cross-check was retired); the alternation keeps it only to give a sane hint to any
    // in-flight pre-Map-#3 run that might surface it. The structure tokens (unparseable/empty/axis_*/status_*/
    // key_unknown) still fire on a malformed DERIVED JSON and carry this same JSON-shape hint.
    // WS-A machine coverage ledger. This branch MUST sit above the prose-sections branch at the
    // bottom — its /coverage-ledger/ substring would otherwise swallow these underscore tokens and
    // emit the wrong (common-law prose) hint to the register-digest worker.
    const tok = (lastFail.match(/coverage_[a-z_]+(?::[^\s)]*)?/) || ["coverage ledger defect"])[0];
    // The axis vocabulary is CLOSED — the run's active axes, nothing else. Saying only "take the text left
    // of the first ' / '" made the derivation rule the WHOLE definition, so a prose table carrying a
    // digest-level observation row (not an axis row) derived an axis the validator must reject — and the
    // retry was told to redo the very derivation that failed, so it looped until the attempts ran out.
    // The validator's own message carries the allowed list; quote it back rather than re-deriving it here.
    const allowedAxes = (lastFail.match(/\(not in: ([^)]+)\)/) || [])[1] || "";
    return `register-coverage-ledger.json is a JSON ARRAY mirroring the prose Coverage ledger — one object ` +
      `per table row with EXACTLY the keys {"axis","scope","status","reason"}: axis = lowercase text left of ` +
      `the first " / " of the Coverage-unit cell, and it must be ` +
      (allowedAxes ? `EXACTLY one of the run's active axes (${allowedAxes})` : `one of the run's ACTIVE AXES`) +
      ` — that vocabulary is CLOSED. Every active axis owns at least one row. If a prose row's Coverage-unit ` +
      `cell is not one of those axes (a digest-level tally, a tiering note, a summary line), it is NOT a ` +
      `ledger row: fold what it says into the "reason" of the axis it qualifies, or leave it in the prose ` +
      `table only — never invent an axis to carry it, and never drop a real axis to make room. scope = the ` +
      `verbatim right side; status = EXACTLY one bare token of confirmed-clean / coverage-limited / deferred ` +
      `(a qualifier like "(count-only, saturated)" moves into reason). The failed check was: ${tok}. ` +
      resaveClause;
  } },
  { code: "use_check_missing", when: /use_check_missing/, hint(lastFail) {
    return "every finding the failed check names by number, a finding at a material band whose owner's use is recorded as " +
      "confirmed or not-confirmed, carries the cite of record in its `use_check.source`: a result URL, or " +
      "'perplexity_research — no result'. Run the scoped marketplace use-check (owner + mark + goods/field) and record " +
      "its result there, or record the honest 'no result'; never assert a use-negative you did not search";
  } },
  { code: "connotation_form_damaged", when: /connotation_form_damaged/, hint(lastFail) {
    // The accumulator is DRIVER-WRITTEN, so a damaged row is a narrow, nameable fault: a row's recorded
    // receipt is no longer one of that row's own candidates (the ledger regenerates candidates every
    // pass, so a top-up can orphan a recorded id). The remedy is ONE tool call about the named row —
    // never a file edit; the seat writes no dispositions file.
    return "every recorded row's receipt is one of THAT ROW's own listed candidates. Re-send ONLY the " +
      "named row(s) through the `record_dispositions` tool with `receipt_index` set to the POSITION of " +
      "the candidate you ruled on in that row's own list (1, 2, …) — never a typed id. Your other rows " +
      "are recorded and KEPT; do not re-send them and do not write any file";
  } },
  { code: "connotation_quote_unbound", when: /connotation_quote_unbound/, hint(lastFail) {
    // — THE ARM THAT MAKES THE LOOP ESCAPABLE. Its own token and its own remedy, deliberately not
    // folded into the no-ruling arm below: the seat this fires on HAS ruled, and telling it to add a
    // ruling is the message R6 received four times before the run died. Every one of those attempts was
    // byte-identical, because the seat opened the form, found a ruling, and correctly changed nothing.
    //
    // The token carries the STATE and the near receipt, so the hint names the nearest miss rather than
    // the class. Those are different sentences with different remedies:
    //   split  — the text is real and in that receipt, just not contiguous. Requote continuously.
    //   absent — the text is in no receipt. Nothing about requoting the same words will help.
    //: composed into `Fix exactly this: ensure <hint>.`, so it states the REQUIRED END STATE.
    const [, rowTok = "", state = "", near = ""] =
      lastFail.match(/connotation_quote_unbound:quote_unbound=\d+;(\S+)[^\s]*\s*\[?[^\]]*\]?\s*(split|absent|too_short|missing)?\s*(R-[A-Z0-9]+)?/) || [];
    const where = state === "split"
      ? `your quote's opening and closing words are BOTH in ${near ? `receipt ${near}` : "one of that row's receipts"}, ` +
        `but the snippet has text between them that your quote does not — you joined two passages. Quote ONE ` +
        `continuous passage instead: start where you started and stop at the end of that same sentence or item`
      : state === "absent"
        ? "the text you quoted appears in NONE of that row's receipts. Do not rephrase it — open the snippet " +
          "carried on one of that row's candidates and copy a passage out of it exactly as written"
        : state === "too_short" || state === "missing"
          ? "the row's proof of reading is empty or too short — name the passage you relied on and copy a few "
          + "characters out of that same passage; the driver copies the whole passage out for you"
          : "the row's proof of reading does not appear in any of that row's candidate snippets — copy your "
          + "`fragment` out of one of them exactly as written; the `quote` is the driver's to extract, not yours";
    // — THE REMEDY NAMES THE FIELDS THE TOOL READS, which are not the fields this token is named
    // after. The token and the STATE come from the document check, which knows `quote` and `anchor`
    // (spotCheckBinds' two routes, kept for archived forms). The tool knows neither: moved proof of
    // reading to `segment_index` + `fragment`, and a row carrying an anchor is refused `segment_absent`.
    // This text used to order the anchor, so the diagnosis was current and the remedy was two retirements
    // out of date — R5's attempt-2 shape, where one paragraph named two different fields and the seat
    // correctly did nothing. The DIAGNOSIS below stays in the document's vocabulary because that is what
    // failed; the INSTRUCTION is in the tool's, because that is the only way back in.
    //
    // Each field carries its own imperative in its own sentence — measured a field phrased outside one
    // as written 0 of 9 times against 74 of 74 when imperative-carried.
    return "every row owing proof of reading carries BOTH fields. Give `segment_index` — the NUMBER of the " +
      `passage you relied on, in the numbered passages of the receipt you ruled on. And copy \`fragment\` — a ` +
      `few characters taken EXACTLY out of that same passage, in whatever script it is written in. ` +
      `${rowTok ? `The failure names the row (${rowTok}) and every other row is already accepted` : "The failure names the rows"} — ` +
      `your RULING on it is sound and is KEPT, so do not re-rule anything. Re-send ONLY the named row(s) ` +
      `through the \`record_dispositions\` tool (keep \`row_index\`, \`ruling\` and ` +
      `\`note\` as you had them) — never write or edit any file. ` +
      `You are POINTING at the passage, not reproducing it — short and exact beats long and approximate. ${where}`;
  } },
  { code: "connotation_call_never_made", when: /connotation_call_never_made/, hint(lastFail) {
    // B — rows are owed and no `record_dispositions` call was ever STARTED this run. The one thing R6's
    // dead attempts were never told was WHERE the gate was counting; under the typed transport the
    // answer is a TOOL, and this arm names it. — composed into `Fix exactly this: ensure <hint>.`.
    return "every meaning obligation is recorded through the `record_dispositions` tool. NOTHING has been " +
      "recorded this run — no call was ever made — and rulings written into your findings prose, or into " +
      "any file, are not read by this check and cannot make it pass. Call `record_dispositions` now with " +
      "`grid_spec_path` (the driver-written spec path your grid instructions name) and `rows`: one entry " +
      "per obligation, each with `row_index` (the NUMBER printed beside that obligation in the obligations " +
      "block), `receipt_index` (the POSITION of the candidate you ruled on in " +
      "that row's own list), `ruling` and a one-line `note`. The tool's answer names what is still " +
      "outstanding and which rows still owe proof of reading — a `segment_index` and a `fragment`. " +
      "Rule from what the receipts say, never from memory, " +
      "and carry any loaded reading into Findings as well";
  } },
  { code: "connotation_call_truncated", when: /connotation_call_truncated/, hint(lastFail) {
    // B — a call STARTED and never returned: a driver-side or transport fault, NOT a fault in the
    // rulings. The one message a seat must never take from this is "re-derive your rulings".
    return "the `record_dispositions` call(s) that never returned are re-sent AS THEY WERE. This is NOT a " +
      "fault in your rulings — a call was killed in flight before its rows were recorded, which is the " +
      "driver's fault, not yours. Do not re-derive or change any ruling: call `record_dispositions` again " +
      "with the same rows for whatever the tool's answer still lists as outstanding, and stop when it " +
      "reports nothing outstanding";
  } },
  { code: "connotation_call_schema_violation", when: /connotation_call_schema_violation/, hint(lastFail) {
    // B — calls arrived and not one row was accepted from any of them: the payload SHAPE is wrong. The
    // remedy is the shape, never the rulings — the tool's own answer named each refusal in-turn.
    return "the `record_dispositions` payload has the right SHAPE — the rulings themselves are not in " +
      "question. `rows` must be an ARRAY of objects, each with `row_index` (the obligation's NUMBER in the " +
      "obligations block) as an INTEGER, `ruling`, `note`, and `receipt_index` as an INTEGER position " +
      "(1, 2, …) — never a typed id of any kind, never a query string, never a string index, never extra " +
      "fields. Re-send your rulings with the corrected " +
      "shape; the tool's answer names each refusal and what is still outstanding";
  } },
  { code: "connotation_call_partial", when: /connotation_call_partial/, hint(lastFail) {
    // B — rows landed and obligations remain. What is recorded is KEPT; the remedy is the remainder.
    return "every remaining meaning obligation is recorded through the `record_dispositions` tool. " +
      "Everything you already recorded is KEPT — do not re-send it and do not re-derive it. Call " +
      "`record_dispositions` with rows for ONLY the obligations the failure counts as outstanding " +
      "(the tool's answer lists them and marks which still owe a `segment_index` and a `fragment`), and " +
      "stop when it reports nothing " +
      "outstanding. Rule from what the receipts say, never from memory, and carry any loaded reading " +
      "into Findings as well";
  } },
  { code: "meaning_angles_missing", when: /meaning_angles_missing|matterframe_meaning_angles/, hint(lastFail) {
    // P2-C (Round-2 §8b): the matter frame's derived-connotation angles are required on fresh runs.
    //
    // CONVERSION 2 — THIS ORDERED A HAND-WRITE AND NOW ORDERS A CALL. It ended "Re-save the COMPLETE file
    // with the line added", which after the conversion is an instruction to rewrite an artifact whose only
    // writer is the driver, on a stage whose grant no longer carries `Write`. The guard found it by
    // driving this function's real output through the write-order markers — the second time a conversion's
    // repair sweep has surfaced here rather than in the diff being written.
    //
    // The ANGLES themselves are described in the same words as before: what the seat has to decide has not
    // changed, only how it hands the decision over.
    return "the matter frame must carry the per-matter meaning/connotation angles — derived from the mark's " +
      "OWN semantic field and this matter's market/industry (cultural origin and communities the word " +
      "evokes, charged historical/political associations of the term or its imagery, category-specific " +
      "controversy for these goods) — short queries, each anchored on the mark's element(s); they are the " +
      "whole meaning search, run as written. Send them " +
      "as `meaning_angles` in one `record_matter_frame` call, or send `meaning_angles_none: true` with an " +
      "empty array ONLY when the mark is a coined term with no real-word semantic field to probe. The call " +
      "replaces the stored frame, so send the whole frame again, not only the angles — the driver renders " +
      "the file and there is nothing for you to save";
  } },
  { code: "own_rights_missing", when: /own_rights_missing/, hint(lastFail) {
    return "every finding whose clearance reasoning relies on the client's own house mark / franchise root ENDS " +
      "with an \"**Own-rights source:** <record URI(s) | 'no applicant-owned registrations in the searched register material'>\" line — " +
      "run ONE owner-scoped band_lookup over the run's frozen register material (plus band_record for any cite) and cite the record URIs, " +
      "or state the honest SCOPED negative (never a portfolio-wide 'no registrations found' — the frozen material covers only this " +
      "matter's dispatched slices), adjust the reasoning to stand without the crutch, and record the missing owner query as an open " +
      "Coverage/open-item row for the escalation lane; the affiliate-exclusion mandate covers CONFLICTS, never this supporting evidence";
  } },
  { code: "blindframe", when: /blindframe_/, hint(lastFail) {
    // Property 1 (frame-omission design): the blind-frame stage's STRUCTURED MODEL, which since is
    // the stage's whole output — there is no prose companion to leave alone. A JSON-defect repair on a
    // clean turn: warm-eligible (WARM_ELIGIBLE_RE), and warmPatchMessage aims it at the file itself
    // through the generic invalid_file branch (failingTarget resolves the single-file stage's output).
    const tok = (lastFail.match(/blindframe_[a-z_]+(?::[^\s)]*)?/) || ["blind-frame model defect"])[0];
    // — THE REPAIR RIDES THE TYPED TOOL, because the seat no longer holds Write or Edit. This used to
    // end "Correct it in place — the file is the stage's only output", which after the conversion orders an
    // act the grant denies: a failure on obedience, mid-round, on the first repair rung that fires. Same
    // shape as the ten anchor sites, caught before it shipped rather than after. The one-change
    // invariant covers a dictation AND the ladder that corrects it.
    return `the model is a set of VALUES you hand to the \`record_blind_frame\` tool: dominant_element, ` +
      `variants[] (each {value, direction (add|drop|phonetic|homophone|neighbour|composite), rationale}), ` +
      `fields[] (each {goods, on_field — a JSON boolean, rationale}), sources[] (each {channel, rationale}) ` +
      `and ranking_basis (goods-overlap | class-number). The failed check was: ${tok}. Call ` +
      `\`record_blind_frame\` again with the corrected values — everything that already validated can be ` +
      `sent as it was. Do not write or edit any file: blind-frame-model.json is the driver's to write`;
  } },
  { code: "framediff_directive_undispatchable", when: /framediff_directive_undispatchable/, hint(lastFail, { undispatchable }) {
    // P2-B (charter P2e — the ask contract). This is the ONE frame-diff defect whose repair is not
    // "re-save the JSON": a firing directive named a thing to search in words nothing can dispatch.
    // The refusal used to arrive hours later at reopen, after this session had exited — so it arrives
    // here instead, in-turn, where a restatement is free. The hint quotes the parser's own reason and
    // asks for the remedy, never for the directive to be deleted: dropping it would silently close a
    // real omission, which is the failure this whole channel exists to prevent.
    //
    // PLURAL, and enumerated from the ARTIFACT — not from the fail string. verify.mjs slices a parse
    // error to 160 characters, so `lastFail` cannot carry more than the first offender's name and
    // half its reason. A singular hint over a plural defect made the ladder count DIRECTIVES instead
    // of attempts: the 2026-07-29 artifact carries four undispatchable firing directives, a
    // compliant model repairs the one the hint quoted, and the 3-attempt ladder exhausts with the
    // reopen pass lost. The offenders are therefore re-derived from the saved frame-diff.json, so
    // ONE corrective turn can satisfy the whole contract.
    const offenders = undispatchable.length ? undispatchable
      : [{ item: (lastFail.match(/framediff_directive_undispatchable:([^—\n]*)/) || [, ""])[1].trim(), why: "" }].filter((o) => o.item);
    const enumerated = offenders.length
      // — the model is told to RESTATE these items, so the item and its reason are values it must
      // reproduce; both were cut with no marker. Same class as the recurrence receipt.
      ? offenders.map((o, i) => `  ${i + 1}. "${abbrev(String(o.item), 120)}" — ${abbrev(String(o.why || "not dispatchable as written"), 260)}`).join("\n")
      : `  (the saved frame-diff.json could not be re-read — re-check EVERY firing directive yourself)`;
    return `${offenders.length || "one or more"} of your FIRING directives (severity dominant-element or material) ask for a search the driver cannot dispatch. ` +
      `EVERY ONE of them is listed here, and ALL of them must be fixed in ONE re-save — the repair ladder counts ATTEMPTS, not directives, ` +
      `so fixing only the first will exhaust it and lose the whole reopen pass:\n${enumerated}\n` +
      //, third conversion — THE ORDER IS A CALL, NOT A RE-SAVE. This read "re-save the COMPLETE
      // frame-diff.json" and closed with "leave your prose reasoning unchanged", which after the
      // conversion is two impossible instructions in one sentence: the seat holds no `Write`, and the
      // prose is rendered by the driver from the very values this hint is asking it to correct.
      `Fix them ALL and send them in ONE \`record_frame_diff\` call: add a structured remedy to each — ` +
      `remedy: {terms: ["<the mark-shaped term(s) to search>"], nice_classes: ["<class>", …], regions: []} — saying WHAT to search, ` +
      `not what the omission is called. A field (class-gap) directive may instead name its classes in the item ("Cl. 35 and Cl. 38"), ` +
      `and the dominant element is then the term. Do NOT delete any directive and do NOT downgrade one to "minor" to make this pass: ` +
      `a real omission that cannot be searched must still be raised — but it has to say what the search IS. Send the whole diff again, ` +
      `not only the corrected directives — the call replaces the stored model`;
  } },
  { code: "framediff", when: /framediff_/, hint(lastFail) {
    const tok = (lastFail.match(/framediff_[a-z_]+(?::[^\s)]*)?/) || ["frame-diff defect"])[0];
    //, third conversion — the shape hint stays (it is what the values must satisfy) and the ORDER
    // changes. The seat sends `directives[]` and `dominant_element_gap` as values; the driver serializes
    // the object this paragraph describes. Most of these tokens are now unreachable from a typed call at
    // all — the schema's enums and boolean removed layer/severity/gap, and the named keys removed the
    // key-unknown family — so a live one on this stage means the DICTATED path produced it, which is what
    // the archive is full of and what a replay must still be able to fail on.
    //
    // — `dominant_element` is NOT named as a value to send. It is the driver's, bound from the blind
    // model, and a repair hint is a served surface like any other: a hint still asking for it would order
    // the field back into existence one rung down from the dispatch that stopped asking. This is the third
    // repair surface a frame-diff change has had to sweep; see recording-agreement.mjs on why the sweep is
    // never optional.
    return `the structured diff is { schema_version, directives[], ` +
      `dominant_element_gap (a JSON boolean) } — send directives:[] for a clean diff. Each directive is ` +
      `{layer (variant|field|source), item, observation, severity (dominant-element|material|minor)}. ` +
      `The dominant element itself is the driver's — it is bound from the blind model, not sent by you. ` +
      `The failed check was: ${tok}. Send the corrected diff in one \`record_frame_diff\` call — the driver ` +
      `writes frame-diff.json and renders the prose from it, so there is nothing for you to save`;
  } },
  { code: "receipts_short", when: /receipts_short/, hint(lastFail) {
    const shorts = (lastFail.match(/receipts_short:([^\s]+)/) || [])[1] || "";
    return `the Negative-results matrix accounts for EVERY (variant × platform) grid cell — these variants are ` +
      `short (variant:rows/expected): ${shorts}. Re-transcribe their cells from the grid call's stdout JSON ` +
      `(every cell needs a receipt row: "No results" / "No similar listings (N candidates reviewed)" / ` +
      `"Similar listing(s) found — see Findings" / "not executed — coverage-limited"); re-run the grid call ` +
      `only if those cells are genuinely absent from its output`;
  } },
  { code: "grid_ledger_unparseable", when: /grid_ledger_unparseable/, hint(lastFail, { gridLedgerName }) {
    return `${gridLedgerName} is the grid call's stdout JSON saved VERBATIM — a single stdout object, or a ` +
      `JSON ARRAY of the per-batch stdout objects in batch order, each with its cells[] (and gaps[]) intact. ` +
      `Re-save the file exactly as the tool returned it — no reformatting, no re-typing, no judging. If the ` +
      `saved file is TRUNCATED mid-string (an unterminated value near the end), your single call's stdout ` +
      `EXCEEDED the output budget: re-run the grid SPLIT into MORE, SMALLER batches (fewer variants per call) ` +
      `and save each batch's stdout as its own element of the JSON array — never try to re-emit one oversized object.`;
  } },
  { code: "grid_join_missing", when: /grid_join_missing/, hint(lastFail, { gridLedgerName }) {
    const shorts = (lastFail.match(/grid_join_missing:([^\s]+)/) || [])[1] || "";
    return `the saved ${gridLedgerName} must account for EVERY dictated (variant × platform) grid cell — ` +
      `these variants are short (variant:cells/expected): ${shorts}. Append the missing cells' grid stdout to ` +
      `the JSON (make the file a JSON array of stdout objects if it is not already), re-running ONLY the cells ` +
      `genuinely absent from the prior output; then make sure the Negative-results matrix matches`;
  } },
  { code: "platforms_missing", when: /platforms_missing/, hint(lastFail, { gridLedgerName }) {
    // capture to end-of-string: real manifest variants are multi-word, a [^\s]+ capture would chop
    // "PROJECT NOVA PULSE:itch.io+…" at the first space and dictate a garbage cell list.
    const det = (lastFail.match(/platforms_missing:(.+)$/s) || [])[1] || "";
    return `the grid must sweep EVERY platform DICTATED in your task message's PLATFORMS list — never a ` +
      `remembered or skill-example list. These variants are missing dictated platforms ` +
      `(variant:domain+domain): ${det}. Run exactly those missing (variant × platform) cells, append their ` +
      `stdout to ${gridLedgerName}, and account for them in the Negative-results matrix`;
  } },
  { code: "connotation_query_unrecorded", when: /connotation_query_unrecorded/, hint(lastFail, { gridLedgerName }) {
    // — THE TOKEN THAT HAD NO HINT, and the absence is what made the failure
    // permanent rather than merely wrong.
    //
    // AND IT IS ONLY REACHABLE NOW WHEN A QUERY IS GENUINELY ABSENT. It used to be reachable when the
    // query was recorded in a different spelling, and then this hint asked for the one thing that could
    // not help: re-running a query that had already run and been recorded. Measured on a production
    // clearance, 2026-09-16 — one query of sixty-one carried a typographic apostrophe where the driver
    // wrote a straight one, the stage failed four times byte-identically, and the clearance stopped. The
    // join compares on `queryKey` now, so a re-run is the right remedy again; the closing sentence below
    // asks for the dictated spelling, which is what stops the ledger drifting from the list a second
    // time.
    //
    // Measured on the owner's own demo clearance: 61 dictated meaning queries, 60 recorded, ONE dropped
    // — the single query in the whole sweep that found nothing. Four attempts, the same refusal string
    // byte for byte, because a retry with no guidance can only repeat itself.
    //
    // The guidance the seat needed EXISTS, in the branch immediately below: "record EVERY query (even
    // zero-result ones)". It is gated on `connotation_search_missing`, which means ZERO searches
    // recorded. With 60 of 61 recorded that condition is false, so the one instruction that would have
    // fixed this could never fire in the state that needed it. A hint gated behind the wrong condition
    // is guidance that is absent exactly when it is wanted.
    //
    // The validator is UNTOUCHED. Fail-closed still holds for a query that genuinely never ran — the
    // gate cannot tell "ran, found nothing" from "never ran", and it is not being asked to. What
    // changes is that the seat is now told how to say the first one.
    const dropped = (lastFail.match(/connotation_query_unrecorded:(.+)$/s) || [])[1] || "";
    // ── TWO FAULTS, TWO REMEDIES, and sending the wrong one is what made this permanent ────────────
    //
    // The gate marks each dropped query `[unmatched; nearest recorded: …]` or `[no recorded query
    // resembles this one]`, and the difference is what the gate can SEE, not what happened.
    //
    // UNMATCHED is knowable: something close is recorded, so the search ran and the wording differs.
    // Re-running changes nothing, and telling a seat to re-run is how a stage fails four times with the
    // same string.
    //
    // NO RESEMBLANCE IS NOT KNOWABLE, and this hint used to pretend otherwise. It said the query was
    // missing and to go and run it — but a query recorded under a translation, a transliteration or the
    // seat's own rewording resembles nothing and has already run, and that seat was then sent round the
    // same loop the unmatched branch exists to break. The gate cannot tell the two apart; no threshold
    // can, and a threshold that could would be one that hides a query nobody ran.
    //
    // So this branch stops asserting and hands over both repairs. Both are cheap, a seat can tell which
    // applies by looking at its own ledger, and neither wastes an attempt: if the search did run, fix
    // the row's wording; if it did not, run it and append the row. Where both labels appear, both
    // sentences are sent, as before.
    // Detected from the validator's own constants, never a copy of its prose: these two choose between
    // opposite repairs, and a re-worded label with a stale matcher here keeps sending the wrong one.
    const anyUnmatched = String(dropped).includes(CONNOTATION_UNMATCHED_MARK);
    const anyUnresembled = String(dropped).includes(CONNOTATION_NO_RESEMBLANCE_MARK);
    return anyUnmatched && !anyUnresembled
      ? `these dictated meaning queries ARE recorded in ${gridLedgerName} extras.pr_risk[] under a ` +
        `different wording, which is why the driver cannot match them: ${dropped}. Do NOT re-run them — ` +
        `the search already ran and its results are already in the ledger. EDIT each row's \`query\` ` +
        `field to the query text EXACTLY as the task message dictates it, character for character, and ` +
        `leave its results untouched. The driver matches your rows to its list by that text`
      : `the driver cannot match these dictated meaning queries to any row in ${gridLedgerName} ` +
      `extras.pr_risk[]: ${dropped}. That means one of two things and the driver cannot tell which, so ` +
      `check your own ledger and do whichever applies — both are cheap. IF THE SEARCH ALREADY RAN and ` +
      `you recorded it under different wording — a translation, a reordering, your own phrasing — do ` +
      `NOT run it again. EDIT that row's \`query\` field to the query text EXACTLY as the task message ` +
      `dictates it, character for character, and leave its results untouched. IF IT NEVER RAN, run it ` +
      `now and append a row to extras.pr_risk[]. A query that returned NO results still owes its row: ` +
      `record it with an empty results array, which is the receipt that the search RAN and came back ` +
      `clean. On an "offensive meaning" query the empty answer IS the good news, and a missing row is ` +
      `indistinguishable from a search nobody performed. Either way, record each query's text EXACTLY ` +
      `as the task message dictates it — the driver matches your rows to its list by that text, so a ` +
      `reworded query reads as one you never ran. Touch ONLY the listed queries and leave every other ` +
      `recorded row exactly as it is. Where a query is marked \`[unmatched; nearest recorded: …]\` the ` +
      `driver has already found its row for you: edit that row's \`query\` and do not search again`;
  } },
  { code: "connotation_search_missing", when: /connotation_search_missing/, hint(lastFail) {
    // — was "your PR / reputational section claims a clean meaning … but the ledger recorded ZERO
    // searches", which under the `ensure` prefix instructed the model to make the unbacked claim.
    return "a clean-meaning claim has the sweep behind it — yours does not: your PR / reputational section " +
      "claims a clean meaning (None identified / no gang / no offensive " +
      "association / affirmative sweep) but the grid ledger's extras.pr_risk recorded ZERO connotation searches. " +
      "Run the CONNOTATION / MEANING sweep — the mark AND its near-forms on the general web (Urban Dictionary, " +
      "Wikipedia, news), query shapes \"[name] gang/slang/offensive/meaning\" — record EVERY query (even " +
      "zero-result ones) into extras.pr_risk, and cite a `Connotation-search source:` line in the PR section. A " +
      "dictionary gloss is never a clearance (a mark can read as a benign given name yet sit one letter off \"Mara\", a street-gang label). You may " +
      "instead report a real connotation hit — but a clean claim needs the search behind it";
  } },
  { code: "named_band_collapsed", when: /named_band_collapsed/, hint(lastFail, { supplementalLane }) {
    const slices = (lastFail.match(/named_band_collapsed:(.+)$/s) || [])[1] || "";
    // The diagnosis is lane-independent; the REPAIR is not. This hint rides correctiveMessage, so it is
    // appended to the register-unit stage message itself — and on the supplemental lane that message has
    // just told the model it cannot call register_enumerate and must never author a band block. The legacy
    // text therefore contradicted its own prompt in the same breath (ION/copper-foundry 2026-07-22). The
    // collapsed token is deliberately NOT warm-eligible, so this only ever reaches a cold retry.
    const diagnosis = `your named band has a COLLAPSED enumerated slice — a block that claimed hits (total_hits>0) but ` +
      `carried ZERO records (slice~claimed-hits): ${slices}. The funnel enumerated the slice yet nothing reached ` +
      `the band — a clean can never ship over a searched-but-lost slice. `;
    return supplementalLane
      ? diagnosis +
        `On this run the TOOLS own every band block: if the collapsed slice belongs to a DICTATED plan entry ` +
        `(it carries a qid from the frozen plan), close it by calling register_execute_plan ONCE with the exact ` +
        `{"plan_path", "axis", "output_path"} from your stage instructions; it re-runs this axis's dictated entries and refreshes their blocks, ` +
        `qid-stamped. If the collapsed slice ` +
        `was a judgment addition, RE-PROPOSE that EXACT slice through register_propose_supplemental with the same ` +
        `predicate, term(s), nice_classes and regions — the tool re-executes it and merges the corrected block ` +
        `itself, qid-stamped. Do NOT author, edit or append a band block by hand (a hand-authored block fails the ` +
        `stage). If the slice is genuinely a crowd that cannot be exhausted, the tool returns an honest ` +
        `"incomplete" block (count + sample + reason) and THAT is the correct outcome — NEVER an empty ` +
        `"enumerated" block. ${SUPPLEMENTAL_LANE_STEERING}`
      : diagnosis +
        `Re-run that EXACT slice with ` +
        `register_enumerate (class-scoped, region-scoped per material+major in-scope jurisdiction), page to ` +
        `has_more:false, and APPEND its records as an "enumerated" block (every record with its screening facts). ` +
        `If the slice is genuinely a crowd you cannot exhaust, write an honest "incomplete" block (count + sample + ` +
        `reason) — NEVER an empty "enumerated" block`;
  } },
  { code: "intake_ask_unanswered", when: /intake_ask_unanswered/, hint(lastFail) {
    // T9 (A2): the committed-check completion gate — every frozen intake ask needs its line.
    const det = (lastFail.match(/intake_ask_unanswered:(\d+):of:(\d+)/) || []);
    // RE-AIMED AT THE CALL. This ordered the seat to "End the narrative with the
    // section …" — a section the driver code-builds, on a stage whose grant carries no writer for the
    // narrative at all. A repair rung is the worst place for that: it fires when something has already
    // gone wrong, and it told the seat to do the one thing it cannot. Caught by the arm that walks
    // CODE_BUILT_SECTIONS against every composed message, on its first run.
    //
    // The SUBSTANCE is unchanged, because none of it was wrong: answer from the gather stages' actual
    // results, and an un-run check gets the honest not-executed line plus an open coverage row rather
    // than silence. What moves is where the answer goes.
    return `your record is missing ${det[1] ?? "some"} of the ${det[2] ?? "frozen"} intake-ask answers. ` +
      `Send one \`ask_answers\` entry per frozen ask (_driver/intake-asks.json) on the findings record you ` +
      `hand to \`record_synthesis\` — the ask VERBATIM as it was given to you, and the ANSWER ALONE: the ` +
      `driver renders the labelled line into the narrative and the report from those entries, so there is ` +
      `no section for you to write and nothing you write by hand is read. ` +
      `Answer from the gather stages' actual results (the owning stage was instructed to run each check); an ` +
      `un-run check gets the honest "NOT executed this run — <reason>" answer plus an open coverage[] row — never silence`;
  } },
  { code: "tool_timeout", when: /\btool_timeout:/, hint(lastFail) {
    // — THE SAME ABSENT BAND, AND THE OPPOSITE INSTRUCTION.
    //
    // `named_band_missing`'s hint below tells the model it never made its call. When the call WAS made
    // and was killed in flight, that sentence is false, and it is worse than merely useless: it accuses
    // a model that did exactly what it was told, and it invites the one repair the doctrine forbids —
    // writing the band by hand to make the complaint go away. R5 on 2026-08-12 took that hint four
    // times against a deterministic 300s cap.
    //
    // So the hint says what is actually true: the call is right, the call is what to repeat, and if it
    // dies again the honest audit note IS the answer. Nothing here asks for a shorter or cheaper call —
    // no model gets a time budget, and the cap that killed it is the bridge's, fixed in this issue's
    // other half.
    return `your dictated register tool call was MADE and never RETURNED — it was still running when ` +
      `the bridge killed it, so the band was never written. This is NOT a missing-structure defect and ` +
      `NOT something you did wrong. Call register_execute_plan ONCE more with the exact ` +
      `{"plan_path", "axis", "output_path"} from your stage instructions. If it is killed again, do ` +
      `NOT author band blocks by hand and do NOT narrate coverage you did not get — the driver's own call ` +
      `log records that the call never returned`;
  } },
  { code: "named_band_missing", when: /named_band_missing/, hint(lastFail) {
    // 2026-07-14 (copper-keystone): the unit's .md narrated success but the band file was NEVER WRITTEN —
    // the model skipped its one register_execute_plan call and fabricated the narrative. Unlike the
    // defective-block repairs below, the fix here IS re-calling the tool: with no existing blocks there
    // is nothing the qid-ownership merge could wrongly preserve, and a hand-authored band fails the stage.
    return `your unit's NAMED BAND file (<axis>-band.json beside your .md) was NEVER WRITTEN — the ` +
      `load-bearing artifact is absent, so the stage cannot pass no matter what the .md says. Produce it ` +
      `NOW by CALLING register_execute_plan ONCE with the exact {"plan_path", "axis", "output_path"} ` +
      `from your stage instructions — the TOOL executes the dictated entries and writes the band itself, ` +
      `qid-stamped. Do NOT author band blocks by hand (a hand-authored band fails the stage), do NOT ` +
      `re-do your digest prose, and NEVER claim the band was written without the tool call actually made`;
  } },
  { code: "named_band_shape", when: /named_band_(state_invalid|block_invalid|unparseable)/, hint(lastFail, { supplementalLane }) {
    // T1 (J1b): the copper-spire killer. The generic hint never named the fix, and re-calling
    // register_execute_plan cannot repair a model-authored block (its merge PRESERVES qid-less blocks) —
    // so every retry deterministically re-failed. Name the exact repair.
    // CORRECTION (2026-07-27 review): the earlier note here claimed this branch was LEGACY-ONLY under the
    // supplemental_lane contract because band_block_unplanned catches every model-authored block. It does
    // not — verify.mjs parses the band (checkSiblingJson) BEFORE the contract check, and named-band.mjs
    // throws these three tokens at PARSE time, so on a lane run a hand-authored block lands HERE first.
    // The legacy "rewrite it in place" repair would then be answered by band_block_unplanned on the next
    // pass ("REMOVE them and re-propose") — two paid attempts whose hints contradict each other. So the
    // lane arm PRUNES the illegal block and re-establishes its coverage through the tool instead.
    const badState = (lastFail.match(/named_band_state_invalid:([^\s(]+)/) || [])[1] || "";
    const bandDiagnosis = `your band JSON has a defective MODEL-AUTHORED block${badState ? ` (state "${badState}")` : ""}. ` +
      `The ONLY legal states are "enumerated" (paged to has_more:false, records carried) and "incomplete" ` +
      `(count + sample + reason) — there is no "verified"/"checked"/"complete"/"clean" state. `;
    return supplementalLane
      ? bandDiagnosis +
        `On this run the TOOLS own every block, so a hand-authored one is the defect itself — not something to ` +
        `repair into shape (the next pass rejects any qid-less block outright). DELETE the offending qid-less ` +
        `block(s) and re-save the band carrying ONLY the tool-written qid-stamped blocks, each byte-identical ` +
        `to what the tool wrote. Then re-establish that slice's coverage by RE-PROPOSING it through ` +
        `register_propose_supplemental with the same predicate, term(s), nice_classes and regions — the tool ` +
        `re-executes it and merges its own qid-stamped block, so the coverage comes back without you authoring ` +
        `it. NEVER rewrite a qid-STAMPED block: its state is code-owned, so a defective one is a tool bug to ` +
        `report in your digest, never something to repair. ${SUPPLEMENTAL_LANE_STEERING}`
      : bandDiagnosis +
        `Open the band ` +
        `file and REWRITE the offending qid-less block(s) IN PLACE to the correct state (records present ⇒ ` +
        `"enumerated"; otherwise an honest "incomplete" descriptor). NEVER touch a qid-stamped block, and do ` +
        `NOT re-call register_execute_plan to fix this — its merge preserves your defective block verbatim`;
  } },
  { code: "plan_audit_missing", when: /plan_audit_missing/, hint(lastFail) {
    // T1 (J3b): the reviewer omitted the deterministic plan audit — the validator requires the
    // exact section title whenever the plan-execution receipt exists.
    // — THE GRADING IS QUOTED, NOT PARAPHRASED. What stood here restated the three classes in its
    // own words ("a missing dictated slice ⇒ a blocking flag; a crowd-gated skipped fringe is
    // sanctioned; …"), which made this the THIRD statement of one rule — and the one a model reads at
    // exactly the moment it is rewriting the section the rule governs. The dispatch blocks now share a
    // single literal; this is its third reader, so a change to the grading reaches the repair turn too
    // instead of leaving it teaching the previous version.
    return `your review carries a plan audit: audit the ` +
      `driver-fed plan-execution receipt, under the same grading you were given with it — ` +
      `${PLAN_AUDIT_CLASSES} — flagging a clean claim that rests on class (1), a class (2) fringe ` +
      `claimed searched-clean, and a class (3) slice the narrative shows no materiality reasoning for. ` +
      `Send it as \`plan_audit\` in a new \`record_narrative_refutation\` call, or, if you saved the review by ` +
      `rewriting its file, as the section titled exactly "PLAN-EXECUTION CHECK". Keep your verdict and flags as they were`;
  } },
  { code: "coverage_no_status", when: /coverage_no_status/, hint(lastFail) {
    // — THE HINT NO LONGER EXPLAINS A TRANSCRIPTION REQUIREMENT, BECAUSE THERE IS NOT ONE.
    // What stood here were two arms (coverage_deferred_unaccounted and coverage_clean_unverified_
    // incomplete) whose entire content was instructions for reproducing an identifier: "each qid must
    // appear VERBATIM in a row on its own axis", "the gate recognises the disclosure by exactly two
    // things and nothing else: the qid written verbatim, or the number N standing alone". Those
    // sentences existed because the gate joined on the typing. The driver writes the qid, the hit count
    // and the receipt reason into the row now, so the only thing the seat can still fail to do is form
    // a judgment — which is the thing it is for. The rows ride in the token so the repair can be acted
    // on without opening anything else, exactly like the 2026-08-05 block-naming fix asked.
    //
    // AND IT LEADS WITH THE CAUSE, BECAUSE ONE TOKEN CARRIES THREE DEFECTS. `coverage_no_status` fires
    // for a row with no status, a status outside the enum, AND an enum-VALID `confirmed-clean` on a row
    // the driver marked `open` — and the last is the common one, because it is what a digest does when
    // it believes a slice is fine and the machine knows it is not. Opening with "row(s) with no status"
    // over a form where every row carries one is the 2026-08-05 defect one level in: an instruction the
    // seat has already complied with, burning the warm attempt that displaced a cold one. verify.mjs
    // emits a partitioned census (`open_clean=2,no_status=1`) precisely so this arm can tell them apart.
    const census = (lastFail.match(/coverage_no_status:([a-z_]+=\d+(?:,[a-z_]+=\d+)*)/) || [])[1] || "";
    const n = (name) => Number((census.match(new RegExp(`${name}=(\\d+)`)) || [])[1] || 0);
    const rows = (lastFail.match(/coverage_no_status:[^;]*;([^\n]*)/) || [])[1] || "";
    const openClean = n("open_clean"), unset = n("no_status"), badAxis = n("axis_invalid");
    const lead = openClean
      ? `${openClean} row(s) of your coverage form are marked "confirmed-clean" over an obligation the DRIVER computed as OPEN. ` +
        `Every row already carries a status, so do not go looking for blank ones — these statuses are the defect`
      : unset && !badAxis
        ? `row(s) of your coverage form carry no status this gate accepts`
        : `row(s) of your coverage form were refused`;
    return `${lead}: ${abbrev(rows, 200) || "see the failure"}. ` +
      `The driver computed every obligation and every identifier in it — the coverage unit, the query id, the hit ` +
      `count, the unaccounted classes and terms, each deferred slice's own receipt reason. Record the named row(s) ` +
      `through the \`record_coverage\` tool — {"row_id","status","reason"} per row, never by writing or editing any ` +
      `file: "status" EXACTLY one bare token of confirmed-clean / coverage-limited / deferred / withheld-by-judgment, "reason" the sentence ` +
      `the lawyer reads (qualifiers go in the reason, never in the status). ` +
      `A row marked "open" cannot be confirmed-clean, and its own "open_because" says which of the two kinds ` +
      `it is. A NEVER-SEARCHED slice — the active register provider cannot express it, so nothing can make it run — is ` +
      `"deferred", quoting its receipt reason. An UNACCOUNTED CROWD BLOCK ran and saturated, so it is "coverage-limited"; ` +
      `do not call it "deferred", which means a slice that could not run at all and which clamps this run's verdict to ` +
      `CONDITIONAL. Either way the gap is an OPEN, disclosed question for the lawyer, never a clean negative. ` +
      `EACH OPEN ROW IS DISCHARGED ONLY BY ITSELF — a status on one row does not account for another row's slice, ` +
      `however plainly its reason discusses the axis, so record the status on the row that owns the block. Rows about ` +
      `slices that genuinely enumerated to has_more:false STAY confirmed-clean — do not downgrade them, that trades ` +
      `one false claim for another. Everything already recorded is kept. Do NOT re-run ` +
      `searches yourself and do NOT hand-write a Coverage ledger table — the driver renders it from what the tool records`;
  } },
  { code: "coverage_form_axis_invalid", when: /coverage_form_axis_invalid/, hint(lastFail) {
    // fix round — THE HINT NAMES THE CELL AND QUOTES THE ALLOWED SET, which is the whole of the
    // 2026-07-30 lesson recorded on the `coverage_axis_invalid` arm above: "the retry was told to redo
    // the very derivation that failed, so it looped until the attempts ran out … The validator's own
    // message carries the allowed list; quote it back."
    //
    // WHERE THE ALLOWED LIST COMES FROM, and why it is not read out of the token here. That arm parses
    // "(not in: …)" out of the failure because ITS vocabulary is the RUN's active axes — a set that
    // varies per run, so the validator is the only thing that knows it. This one is the FULL register
    // vocabulary, a module constant, so quoting REGISTER_AXES is quoting the same single source rather
    // than re-deriving a second one. It also keeps the token free of the parentheses that
    // "(not in: …)" would put before the overflow, which pipeline's merge-gate remedy truncates at.
    //
    // PLACEMENT. Nothing above can swallow this: the structure arm needs the substring
    // `coverage_axis_invalid` and this token spells `coverage_form_axis_invalid`, and every
    // correctionHint caller passes ONE validator reason (verify returns a single fail object), so no
    // fail string carries two coverage tokens for an earlier arm to match first.
    const rows = (lastFail.match(/coverage_form_axis_invalid:[^;]*;([^\n]*)/) || [])[1] || "";
    return `row(s) YOU ADDED to the coverage form carry an "axis" outside the register-axis vocabulary, which ` +
      `is CLOSED: ${abbrev(rows, 220) || "see the failure"}. Each entry above is the row's id followed by the value ` +
      `that was rejected — "axis=<empty>" means that row has no "axis" at all. ` +
      `Re-send each of those rows through the \`record_coverage\` tool — {"kind":"seat","axis","unit","status",` +
      `"reason"}, with "axis" EXACTLY one bare token of: ${REGISTER_AXES.join(" / ")} — never invent an ` +
      `axis, never leave it blank, and never put a jurisdiction, a class, a sweep name or a descriptive phrase in ` +
      `that field. Choose the axis whose coverage the row qualifies: a per-jurisdiction reconciliation or a ` +
      `cross-class / cross-check / merch sweep is "primary-sweep"; an owner, incumbent, watchlist-owner or ` +
      `stealth-filer sweep is "incumbent-class"; a counted dominant-element or meaning-token crowd is ` +
      `"saturation-probe"; a transliteration or numeric-form slice is "transliteration-numeric". Set that ` +
      `row's "unit" to "<the same axis> / <what you swept>" — the driver's own rows read that way and the axis is ` +
      `recovered from it if the field is ever lost. A re-sent row with the same unit REPLACES the recorded one; ` +
      `{"retract":"<row_id>"} withdraws one outright. ` +
      `The rows the DRIVER wrote already carry a correct axis: do not touch them — every "status" and "reason" ` +
      `already recorded is kept. Do NOT re-run any search, do NOT write or edit any file, and do NOT hand-write a ` +
      `Coverage ledger table — the driver renders it from what the tool records`;
  } },
  { code: "coverage_form_damaged", when: /coverage_form_damaged/, hint(lastFail) {
    // Typed transport: the seat holds no writer onto the accumulator, so a damaged one is the driver's
    // own serialization or filesystem at fault — never the seat's JSON. The repair is still a tool
    // call, because record_coverage rewrites the accumulator whole from the regenerated rows plus the
    // call: statuses in the unreadable copy cannot be carried, so the seat re-sends its rulings.
    const detail = (lastFail.match(/coverage_form_damaged:form_damaged=\d+;([^\n]*)/) || [])[1] || "";
    return `the driver's coverage accumulator could not be read${detail ? ` (${abbrev(detail, 120)})` : ""} — a ` +
      `driver-side fault, not your JSON (you never write this file). Re-record your statuses through the ` +
      `\`record_coverage\` tool — {"row_id","status","reason"} per obligation row — which rewrites the record ` +
      `from the driver's own rows plus your call. Statuses in the unreadable copy cannot be read, so re-send ` +
      `every ruling the tool's answer still lists as outstanding. Never write or edit any file`;
  } },
  { code: "coverage_form_missing", when: /coverage_form_(missing|empty)/, hint(lastFail) {
    // Named for readability in the journal, not because a model can act on either: both mean the DRIVER
    // did not write the form it stamped as required — absent in one case, present with no obligations in
    // it in the other. Deliberately out of the warm allowlist, and for the same reason: a resumed seat
    // cannot patch a file it was never told about, and warming it would spend a turn asking a model to
    // fix a driver bug. `coverage_form_empty` is matched HERE rather than by the `coverage_no_status`
    // arm above so an empty form never reads to the seat as rows it forgot to fill in.
    const empty = /coverage_form_empty/.test(lastFail);
    return `the driver-written coverage form is ${empty ? "present but carries no rows" : "absent"} although this run ` +
      `requires one. This is a DRIVER defect, not something your turn can repair: write your findings as normal and ` +
      `report the ${empty ? "empty" : "missing"} form in your final message`;
  // ── — THE TWO ARMS BELOW SERVE THE UNSTAMPED (PROSE) ERA, AND THEY ARE BACK BECAUSE THEIR
  // TOKENS ARE BACK. M6 (2026-08-14) narrowed "unstamped" to ARCHIVED RUNS ONLY — the driver now
  // arms unconditionally — so these arms are dead for live runs and kept for replay, exactly like the
  // gates they hint for. Deleting them would leave an archived run's refusal falling to a generic hint,
  // which is the misdirection this whole build is about. verify.mjs restores
  // findUnaccountedDeferredSlices and findUnverifiedIncompleteCleanClaims on any run with no coverage
  // form; a token that can fire with no
  // arm falls to a generic hint, which is the misdirection this whole build is about. COLD, exactly as
  // on main — neither name is in WARM_ELIGIBLE_RE and neither is added to it, so the warm lane is
  // unchanged and `coverage_(no_status|form_damaged)` cannot match either of these names.
  // `coverage_clean_deferred` gets NO arm: its token is folded into the superset above and nothing emits
  // it any more, and an arm for a token nobody emits is what the closed-vocabulary rule refuses to leave
  // lying around.
  } },
  { code: "coverage_deferred_unaccounted", when: /coverage_deferred_unaccounted/, hint(lastFail) {
    //: the accounting requirement, not the clean-claim gate. The distinction matters in the hint —
    // this fires when the ledger is SILENT about a deferred qid, so telling the model to "correct its
    // clean claim" would send it looking for a row that does not exist. The qids ride in the token.
    const [, ax = "", qids = ""] = lastFail.match(/coverage_deferred_unaccounted:([^:\s)]+):?([^\s)]*)/) || [];
    return `your Coverage ledger does not account for ${qids ? `these DEFERRED slice(s): ${qids}` : "every DEFERRED slice"} ` +
      `on ${ax ? `axis "${ax}"` : "a dictated axis"}. The active register provider cannot express those queries at all, ` +
      `so they were never searched and nothing can make them run — the plan recorded that before this stage began. ` +
      `Each qid must appear VERBATIM in a row on its own axis with Status "deferred" (or "coverage-limited"), quoting ` +
      `the receipt's mechanical reason. A ledger that says nothing about a slice the plan could not run is incomplete ` +
      `output, not a clean one; treat the gap as an OPEN, disclosed question for the lawyer`;
  } },
  { code: "coverage_clean_unverified_incomplete", when: /coverage_clean_unverified_incomplete/, hint(lastFail) {
    // The discriminated incomplete gate (copper-lattice): clean claimed over a multi-term OR-stack
    // crowd whose per-term truth is not fully accounted. Relabel — the re-enumeration is the driver's.
    // ION/copper-foundry: the repair is now a DISCLOSURE, not a mass downgrade — the gate joins the
    // unaccounted block to a coverage-limited/deferred row that IDENTIFIES it, so the hint must name
    // the identifying evidence (the stack's total hit count) or the repair lands unrecognised.
    // The token now names the offending BLOCK (verify.mjs — see the 2026-08-05 block there for what its
    // absence cost). Two consequences for this hint, and both are the difference between clearable and not:
    //   * it can name the qid and the exact identifying number, which are the ONLY two things
    //     blockIsDisclosed accepts. Before, the model had to find one block among ninety-one and guess
    //     which number identified it.
    //   * it can tell the truth about WHICH SHAPE fired. This gate has two arms — unaccounted TERMS in a
    //     multi-term OR-stack, and an unaccounted CLASS leg after the class split — and the hint described
    //     the term arm unconditionally. On a class-arm failure that instruction is not vague, it is WRONG:
    //     it sends the model hunting for unaccounted terms in a block whose term_counts is absent and whose
    //     unaccounted-term set is empty. No honest digest can satisfy it, and the ladder burns out.
    const ax = (lastFail.match(/coverage_clean_unverified_incomplete:([^\s)]+)/) || [])[1] || "";
    const qid = (lastFail.match(/ qid=(\S+)/) || [])[1] || "";
    const hits = (lastFail.match(/ hits=(\d+)/) || [])[1] || "";
    const classes = (lastFail.match(/ classes=(\S+)/) || [])[1] || "";
    const terms = (lastFail.match(/ terms=([^\n]+?)(?= \(\+|$)/) || [])[1] || "";
    const what = classes
      ? `class ${classes.includes(",") ? `legs ${classes}` : classes} of that block ${classes.includes(",") ? "are" : "is"} ` +
        `neither verified-zero nor enumerated nor itself a crowd — populated, tractable, and nobody enumerated it`
      : terms
        ? `these terms of its OR-stack are neither verified-zero nor individually enumerated nor themselves ` +
          `crowds: ${terms}`
        : `part of it is neither verified-zero nor enumerated nor itself a crowd`;
    return `${ax ? `axis "${ax}"` : "an axis"} has ONE undisclosed incomplete block and this is it: ` +
      `${qid ? `qid ${qid}` : "the block named in the failure"}${hits ? ` (${hits} hits)` : ""}. ${what} — and no ` +
      `Coverage-ledger row discloses it, so that axis's confirmed-clean rows swallow it. Give THAT block its ` +
      `OWN coverage-limited (or deferred) row on this axis. The gate recognises the disclosure by exactly two ` +
      `things and nothing else: the qid written verbatim${hits ? `, or the number ${hits} standing alone` : ""} ` +
      `— so write ${qid ? `"${qid}"` : "the qid"} into that row's reason. State in the reason what is open ` +
      `${classes ? `(class ${classes} counted, not enumerated)` : "(which part stayed open)"}. Rows about slices ` +
      `that genuinely enumerated to has_more:false STAY confirmed-clean: do not downgrade them, that trades one ` +
      `false claim for another. Correct exactly that row and change nothing else. Do NOT re-run searches ` +
      `yourself — the driver owns the re-run`;
  } },
  { code: "coverage_clean_unexecuted", when: /coverage_clean_unexecuted/, hint(lastFail) {
    // T1 (J6): the F3 gate — a clean claim over a slice the plan-execution receipt says never ran.
    const ax = (lastFail.match(/coverage_clean_unexecuted:([^\s)]+)/) || [])[1] || "";
    return `the plan-execution receipt says ${ax ? `axis "${ax}"` : "a dictated axis"} did NOT fully execute, ` +
      `yet your findings claim it clean. Either the claim is wrong — correct it to an honest ` +
      `coverage-limited/deferred row carrying the mechanical reason from the receipt — or the coverage ` +
      `actually ran and your ledger row mis-states it: fix the row to match the receipt. A clean can never ` +
      `rest on a slice the plan dictated and nothing ran`;
  } },
  { code: "band_block_unplanned", when: /band_block_unplanned/, hint(lastFail) {
    // copper-lattice re-route: a hand-authored band block under the supplemental_lane contract.
    const qs = (lastFail.match(/band_block_unplanned:([^\s)]+)/) || [])[1] || "";
    return `this run's register plan carries the supplemental_lane contract: EVERY band block is written by ` +
      `a TOOL and carries a qid — you never author band blocks. The qid-less block(s) (${abbrev(qs, 100)}) came ` +
      `from a hand append. REMOVE them from the band file, then re-run their queries the sanctioned way: ` +
      `register_propose_supplemental with the same query as a proposal (the tool executes it and merges the ` +
      `band itself, qid-stamped). Leave every qid-stamped block untouched`;
  } },
  { code: "coverage_clean_tainted", when: /coverage_clean_tainted/, hint(lastFail) {
    // Timeout-taint gate (copper-lattice): a clean claim over an axis whose winning register-unit pass
    // was cut down mid-work. The repair is a RELABEL, never a re-search — the re-run is the driver's job
    // (taint chain / envelope), the digest's job is the honest status.
    const ax = (lastFail.match(/coverage_clean_tainted:([^\s)]+)/) || [])[1] || "";
    return `the register-unit pass that produced ${ax ? `axis "${ax}"` : "a tainted axis"} was killed at the ` +
      `timeout wall mid-work (the per-attempt log is code-truth you cannot argue with), so its self-reported ` +
      `clean is unverified. Relabel that axis's confirmed-clean Coverage-ledger row(s) to deferred with the ` +
      `reason "timeout-tainted pass — self-reported clean downgraded pending re-run", and change nothing ` +
      `else. Do NOT re-run searches yourself — the driver owns the re-run`;
  } },
  { code: "declared_unavailable", when: /declared_unavailable/, hint(lastFail) {
    return "you never write a fallback/partial findings file: if the perplexity_research tool returned results, write " +
      "the COMPLETE findings file from them; if the tool is genuinely failing after retries, write NO findings file " +
      "at all and report the tool failure with diagnostics in your final message (the driver fails the run — a report " +
      "must never ship without its marketplace layer)";
  } },
  { code: "coverage_status_row", when: /findings\+ledger|no_coverage_status_row/, hint(lastFail) {
    // — `findings+ledger` IS BACK IN THIS ALTERNATION. The first cut of this build removed it on
    // the reading that the seat never writes a Coverage-ledger table any more; that is true only on a
    // run the driver stamped as form-required, and the stamp is conditional. On an unstamped run
    // validators.registerFindings demands the table exactly as it did before and emits this label,
    // so dropping the arm left the one lane that can still fire it with a generic hint.
    return "the file has a findings heading plus a Coverage ledger with a status row (confirmed-clean / coverage-limited / deferred)";   // the common-law clause went with that lane's status gate (ruling 2026-10-01)
  } },
  { code: "prose_sections", when: /negative-results|coverage-ledger|audit-trail|findings-heading/, hint(lastFail) {
    return "the findings file carries ALL required sections: a findings heading, the Negative results matrix " +
      "(every variant × platform row), the Coverage ledger with a status row, and the Audit trail call log";
  } },
];

const REPAIR_HINT_DEFAULT = "the required output file is actually written and contains every required section IN FULL";

/** The code of the repair hint a failure string selects, or null when it gets the default. PURE. */
export function failureCode(lastFail) {   // @internal — driven by its test
  return REPAIR_HINTS.find((row) => row.when.test(lastFail))?.code ?? null;
}

/** Every row's code, in the order the rows are read. */
export const REPAIR_HINT_CODES = Object.freeze(REPAIR_HINTS.map((row) => row.code));   // @internal — driven by its test

export function correctionHint(lastFail, { gridLedgerName = "common-law-grid.json", supplementalLane = false, undispatchable = [], toolWritten = null, heldRecord = false, adds = false } = {}) {
  // The repair act, for the hints that name one. Kept to a single sentence and a single decision so a
  // new hint has one thing to append rather than a branch to reproduce.
  const resaveClause = toolWritten
    ? `Fix exactly that and send the corrected values — the driver re-derives this file and the prose table together from your \`${toolWritten}\` call, so there is nothing here for you to save`
    : `Fix exactly that, re-save the COMPLETE JSON file, and leave the prose table unchanged`;
  const row = REPAIR_HINTS.find((r) => r.when.test(lastFail));
  return row ? row.hint(lastFail, { resaveClause, gridLedgerName, supplementalLane, undispatchable, toolWritten, heldRecord, adds }) : REPAIR_HINT_DEFAULT;
}

// ── the DEFERRED-SLICE BLOCK IS GONE ──────────────────────────────────────────────────────
//
// `deferredSlicesRequiredRows` composed a prose block listing every deferred qid and told the stage each
// one "must appear VERBATIM in a Coverage-ledger row". Its own doc block recorded why it had to ship
// every qid rather than the first six: "the accounting join is on the qid verbatim, so a qid the stage
// was never shown can never be named." That is a description of a transcription contract, and
// removes the contract rather than the elision. The driver writes one form row per deferred qid, with
// that qid's own receipt reason, and marks it `open`; coverage-form.coverageFormBrief lists the rows in
// the dispatch and names `record_coverage` as the one route a status takes (the typed transport — the
// seat opens no file). Nothing is retyped, so nothing can be mistyped.
//
// The REQUIREMENT is unchanged and is still enforced in verify.mjs against the same plan-execution
// receipt: a deferred slice is a row the digest owes, not a disclosure it may offer.

// ──: WRITE-TIME FORM REJECTION — the form-class allowlist ─────────────────────────────────────
// A FORM failure is one where the model wrote something the CONTRACT already forbids by name: a value
// outside a closed enum, a key outside a closed key set, a JSON type the parser asserts, or a search
// term the dispatcher cannot express. It is the opposite of a WORK failure, where the model did the
// job badly or incompletely — and the two need opposite fixes (E2E round 2026-08-02, §2b).
//
// THE ADMISSION CRITERION IS MECHANICAL, so this list can be defended token by token: a token is here
// only if its check in the strict parser is literally `!ALLOWED.includes(x)` over a closed vocabulary,
// or a JSON-type/domain assertion on a named field. Two parsers own every token below —
// frame-diff-model.parseFrameDiff and coverage-ledger.parseCoverageLedgerJson — plus one closed-
// vocabulary check over the PROSE mirror of the same COVERAGE_STATUSES list (verify.registerFindings'
// coverage_status_offenum). NO NEW RULE IS ADDED HERE: every one of these already fails the stage
// today. moves WHEN it is answered, not WHAT is answered.
//
// THREE OF THESE WERE OBSERVED COSTING A PAID DISPATCH in the 08-02 round: framediff_severity_invalid
// (a bad enum), coverage_axis_invalid (the literal string "all axes" against a closed four-axis
// vocabulary, twice), framediff_directive_undispatchable (the wildcard `KIN*` where a dispatchable
// term was required).
//
// DELIBERATELY EXCLUDED, each for a reason, because admitting one would put a WORK failure in the
// cheap lane — the one thing this change must not do:
//   · framediff_unparseable / coverage_ledger_unparseable — a file that will not parse is usually
//     TRUNCATED, and the existing hint (correctionHint's grid_ledger_unparseable arm) says so: the
//     turn's output exceeded its budget and needs a re-run split smaller. That is capacity, not form.
//   · coverage_ledger_empty / coverage_axis_missing — a missing row is COMPLETENESS: the axis was not
//     accounted for. Nothing about the vocabulary is wrong.
//   · blindframe_* — same token SHAPE as framediff_* (closed enums on direction / ranking_basis) and
//     they would very likely qualify. They are OUT because blind-frame's output is JSON, and the
//     offline repair-turn path for a JSON-output stage cannot be tested truthfully until  is
//     fixed (the mock's TARGETED-EDITS write mandate is `.md`-only, so the repair turn writes nothing
//     and the harness reads its own silence as "the model could not fix it"). Naming the gap rather
//     than shipping an untested admission.
//   · findings_* / connotation_* / named_band_* — WORK class by construction ( owns them).
//   · coverage_form_axis_invalid ( fix round; re-examined at the typed-transport conversion) — AN
//     OPEN QUESTION, NAMED RATHER THAN ANSWERED. By the criterion above it belongs here: it is a
//     closed four-token vocabulary, the SAME vocabulary whose prose-era sibling
//     (`coverage_axis_invalid`, "all axes") is one of the three defects this block records as having
//     cost a paid dispatch in the 08-02 round. What stops it NOW: a coverage repair is a
//     `record_coverage` TOOL CALL, and the offline repair-turn mock speaks no MCP at all — an
//     admission here cannot be tested truthfully; the harness would read its own silence as "the model
//     could not fix it". The miss behaviour is the safe one: it falls to the ladder, where it is
//     warm-eligible and its hint names the field, the allowed set and the tool. (The tool also refuses
//     an off-vocabulary axis AT CALL TIME, so on the live path this token now fires only over rows
//     recorded before the conversion.) Raise, do not ship an untested admission.
// Anything NOT on this list — including a form defect nobody has classified yet — falls through to
// the retry ladder exactly as it does today, visibly. Unknown shape is never "validated fine". That is
// also why this hand-maintained table needs no self-healing derivation: its MISS behaviour is
// already the safe one — a token nobody added costs what it costs today and is never swallowed.
// Kill-switch: CLEAROTRON_FORM_REPAIR=0 (or off/false/no — it reads through envGateOn,) restores
// today's behaviour exactly.
const FORM_CLASS_RE = /^invalid_file:.*?:(framediff_(key_unknown|directive_key_unknown|directives_invalid|layer_invalid|severity_invalid|gap_invalid|remedy_invalid|directive_undispatchable)|coverage_(key_unknown|axis_invalid|status_invalid|status_offenum|classes_invalid))\b/;
export function isFormClassFail(fail) {
  return FORM_CLASS_RE.test(fail ?? "");
}
// How many in-dispatch repairs one stage run may buy. TWO, and the number has a cause: parseFrameDiff
// is FAIL-FAST — it throws on the first bad severity (parseFrameDiff() in frame-diff-model.mjs) before it ever collects
// the undispatchable directives — so ONE artifact carrying both defects surfaces them
// SEQUENTIALLY. That is exactly what the 08-02 frame-diff ladder did (severity on a1, undispatchable
// on a2), and a cap of 1 would have handed the second one straight back to the ladder. The codebase
// already learned this lesson once at directive granularity: undispatchableThrow batches ALL offenders
// into ONE throw precisely because "the ladder is 3 attempts and a per-directive throw spends one".
// A form chain DEEPER than two still reaches the ladder — visibly, and that is the honest outcome.
const MAX_FORM_REPAIRS = 2;

// ── Warm patch retry ──────────────────────────────────────────────────────────────────────────────────
// When the failed attempt's TURN COMPLETED cleanly (envelope status "ok") and the defect is one of a NAMED
// repairable set, the next retry RESUMES that session with only a short patch instruction instead of
// re-running the whole stage cold (synthesis use_check_missing: ~$5 + 6–13 min → <$1 + ~1–2 min; the
// skeptic ok-but-no-file flake closes in seconds). One warm attempt max per stage run; the cold corrective
// path stays as the fallback and the same validator judges every attempt. Eligibility is an explicit
// allowlist (dictate-don't-infer) — new reasons join it only with a test. Kill-switch: CLEAROTRON_WARM_RETRY=0.
// WS-A additions: the machine coverage-ledger tokens (coverage_*) AND the shipped common-law grid
// tokens (grid_join_missing / grid_ledger_unparseable — these were never warm-eligible, so the grid
// contract's own de-risk was inert: a bad ledger burned cold $5+ retries). All are JSON-defect repairs
// on a turn that completed cleanly — exactly the warm-patch shape.
// findings?_[a-z_]+ : the findings.json contract token family — a JSON-defect repair on a turn that
// completed cleanly, exactly the warm-patch shape.
// Map #3 — coverage_mirror_missing was REMOVED from the warm allowlist: it can no longer fire (the JSON is
// code-derived from the prose, so the mirror cross-check is retired). The coverage_* STRUCTURE tokens stay
// (they fire on a malformed derived JSON); the warm sibling-JSON path is still valid for them.
// blindframe_* / framediff_* : the frame-omission design's structured siblings — a JSON-defect repair on a
// turn that completed cleanly (the prose passed), exactly the warm-patch shape; the sibling dispatch in
// warmPatchMessage names the JSON to fix and forbids touching the prose.
// named_band_state_invalid / _block_invalid / _unparseable ( T1, J1b): a JSON-defect repair of the
// model's OWN qid-less judgment block on a turn that completed cleanly — exactly the warm-patch shape.
// (named_band_collapsed stays cold: a collapsed slice needs a RE-RUN of the search, not a JSON patch.)
// plan_audit_missing ( T1, J3b): the review is complete except one required section — a warm resume
// re-emits the review with the section added instead of burning a cold re-refutation.
// coverage_status_offenum (D1): a single off-enum Status CELL in the prose Coverage ledger on an
// otherwise-clean digest turn — a one-cell prose relabel (qualifier moves into Reason), exactly the
// warm-patch shape; the shape fired on ~43% of the archive corpus, so a cold-only ladder would burn
// a full register-digest re-run per live hit.
// named_band_missing (2026-07-14, copper-keystone): warm-eligible too — the session completed cleanly (the
// prose passed), and the repair is ONE tool call from the warm session (see warmPatchMessage's dedicated
// branch below — never the sibling re-save message, which would instruct the hand-author lane).
// connotation_quote_unbound: warm-eligible on the SAME reasoning and one more. It fires only on a
// row whose ruling, note and receipt_id the gate has already accepted, so the repair is ONE field on ONE
// named row — the narrowest edit any arm on this list asks for, and the warm session is the one that
// wrote the quote. R6's four byte-identical attempts were not evidence that warm cannot fix this; they
// were evidence that the seat was told to fix something else. The token now names the state and the arm
// names the remedy, so there is something to change. A warm turn that STILL returns byte-identical output
// is the subject, not this one, and is handled where byte-identical output is detected.
// connotation_* (the family, via CONNOTATION_FORM_TOKEN_SRC; 2026-08-01 ruling, carried through B's
// typed transport): WHY THESE ARE SAFE TO WARM. Every member is emitted only over an obligation set
// built from `recorded.filter(e => e.results.length)` — a violation is therefore PROOF the meaning sweep
// ran and returned results. What is missing is a RULING the resumed session can record with ONE
// `record_dispositions` call (warmPatchMessage's connotation branch orders exactly that): a tool call,
// not a re-search. The failure modes that mean "the search did not happen" are DIFFERENT tokens,
// deliberately kept out of this allowlist — connotation_search_missing (whose hint orders a re-run of
// the sweep) and the merge-gate StageFailure from findDroppedConnotationQueries. That separation is
// what makes warm safe.
// THE RULED-NONE CASE IS NOT DECIDED HERE. `call_never_made` matches this allowlist, and that is fine:
// eligibility says a warm patch COULD carry the fix, and the veto (vetoResumeRuledNone) — keyed on
// the run's own counted rulings, upstream of this allowlist — refuses the resume whenever the whole
// population is unruled. Eligibility and the veto answer different questions on purpose: dropping a
// token from here to force a fresh dispatch would also change which artifact draftCarryEligible may
// carry across a recovery park, which is the coupling this comment exists to keep visible.
// Self-sufficiency: the accumulator is the driver's, in `_driver/`, and it carries the rulings the seat
// has already recorded, so the repair stands regardless of what the short patch message carries — and a
// warm turn that no-ops can no longer lose ground.
// THE TRADE, AND BUILD 2 PAID IT OFF. Warm does NOT add ladder depth. It REPLACES what would have
// been cold attempt 2 with a cheaper attempt that is likelier to land — the resumed session already holds
// its own ledger read and its own prose, so it edits what it wrote instead of re-deriving the document.
//
// The cost used to be that it DISPLACED that cold attempt: a warm turn that no-ops ("I already wrote
// those rows") reproduces the failure string byte-for-byte, the identical-signature break (A4,)
// fired, and the ladder ended at 2 — where in the observed R1 case cold attempt 3 was what finally
// cleared. That risk was accepted here rather than overlooked, and the 2026-08-07 round then measured
// what it costs: R6 broke at 2 of 3 with attempt 3 unspent, parked ~90s, spent a defect
// lane, and the recovery lane's fresh dispatch ruled 69 of 72 — the attempt the ladder still had.
//
// It is no longer displaced. A4 now escalates instead of breaking when the repeat came from a warm patch
// (see the block in runStage): a resumed session cannot disagree with itself, so the SESSION is discarded
// and attempt N+1 runs fresh inside the ladder. Warm is still capped at ONE attempt per stage — which is
// also the bound on the escalation, since `warm` is what triggers it — and CLEAROTRON_WARM_RETRY=0 still
// disables the lane, so the fallback in both cases is exactly today's cold ladder.
// The prose route is deliberate — neither token matches a sibling pattern below, so the patch names the
// failing half's own .md and never orders a rewrite of the TOOL-written grid ledger the receipts live in.
// coverage_no_status / coverage_form_damaged: WARM, and this is the whole economic case for the
// issue. The coverage-judgment family was COLD-ONLY — WARM_ELIGIBLE_RE carried seven coverage STRUCTURE
// tokens and not one `coverage_clean_*` — so every retry re-dispatched a fresh session that re-read a
// 1.9 MB band and re-derived a 160 KB document instead of editing it. The stage's own measured profile
// (repair-contract.mjs, 'WHY THIS EXISTS') is 105,747 out FAIL → 137,519 out FAIL → 36,362 out PASS, and the attempt
// that passed is the one that PATCHED. A cold ladder never patches.
// WHY THEY ARE SAFE TO WARM, on the same argument made one gate over: findCoverageFormViolations
// emits both tokens only over rows the DRIVER wrote from the frozen plan and the plan-execution
// receipt, so a violation is PROOF the searches ran and were accounted. What is missing is a STATUS on
// obligations the driver already computed with every qid, hit count and receipt reason: one
// `record_coverage` call, not a re-search (the typed transport — the seat edits no file; the warm patch
// orders the call). The tokens that mean "the search did not happen" are DIFFERENT and are deliberately
// kept out — coverage_clean_unexecuted / _skipped / _tainted, whose remedies are a re-run or a relabel.
// coverage_form_missing is ALSO deliberately absent: a seat cannot patch a file it was never told about
// (the sidecar lives in `_driver/`), the defect is the driver's, and warming it would spend a resumed
// turn asking a model to fix a driver bug. It is emitted as `invalid_file:…` and not as `missing_file`
// precisely so the bare `missing_file` alternation at the head of this literal cannot warm it by accident.
// coverage_form_axis_invalid ( fix round): WARM, and this is the clearest case in the list. The seat
// must re-send rows IT added with ONE FIELD corrected — a single `record_coverage` call — and the
// failure token names the rows and the rejected values. A cold re-dispatch would re-read a 1.9 MB
// band and re-derive a 160 KB document to retype one word — the exact economics that made the coverage
// family warm-eligible in the first place. It also cannot mean "the search did not happen": the offending
// rows are SEAT rows, added on top of a driver form whose existence is proof the plan ran. It is spelled
// with `form` first so this alternation's own `coverage_axis_invalid` (the derived-JSON structure token,
// a different file and a different repair) cannot match it and route it to the wrong sibling.
// — THE CONNOTATION ALTERNATION IS INTERPOLATED FROM THE EXPORTED VOCABULARY, NOT RETYPED. It was
// retyped at five sites, and a reason added without all five following it matches nothing here: the
// failure is warm-ineligible in silence, the repair is aimed at the findings document instead of the
// form, and the ladder spends its attempts on a file the validator never re-reads. Binding to the list
// is what did one level up, for the same reason. The RE is built from a string for that one splice;
// nothing else in it changed, and it carries no backslash escapes for the string form to mangle.
/** The placement form's said-back refusals: corrective while attempts remain, never the reason a pass fails. */
const SAID_BACK_TOKEN_SRC = "placement_(?:floors_without_fate|refused)=";
const SAID_BACK_REASON_RE = new RegExp(`^${SAID_BACK_TOKEN_SRC}`);
const SAID_BACK_OPEN_RE = new RegExp(`^invalid_file:.*?:${SAID_BACK_TOKEN_SRC}`);
/** Is a validator's refusal a said-back one, a duty the output leaves open rather than an invalid output? PURE. */
export const saidBackOnly = (reason) => SAID_BACK_REASON_RE.test(String(reason ?? ""));
const WARM_ELIGIBLE_RE = new RegExp(`^(missing_file|invalid_file:.*?:(use_check_missing|own_rights_missing|coverage_ledger_unparseable|coverage_ledger_empty|coverage_axis_invalid|coverage_axis_missing|coverage_status_(invalid|offenum)|coverage_key_unknown|coverage_(no_status|form_damaged|form_axis_invalid|form_engine_vocabulary)|grid_join_missing|grid_ledger_unparseable|platforms_missing|${CONNOTATION_FORM_TOKEN_SRC}|findings?_[a-z_]+|blindframe_[a-z_]+|framediff_[a-z_]+|named_band_(state_invalid|block_invalid|unparseable|missing)|tool_timeout:[a-z_]+:[a-z0-9-]+|plan_audit_missing|intake_ask_unanswered))`);

// — `tool_timeout` IS ON THAT LIST TO KEEP ROUTING WHERE IT ALREADY IS, not to add a lane.
//
// This failure reaches the ladder today as `named_band_missing`, which is warm-eligible. Renaming the
// token without adding it here would quietly move the class from warm to COLD — a full stage re-run
// instead of a resume, on every timeout, as a side effect of an attribution fix. A rename must not
// change what a failure costs.
//
// The issue notes that the argument applies: "the retry ladder cannot help a deterministic tool
// timeout — this failure class is an argument for the same disclosed-deferral treatment when the ladder
// is provably futile." That is a real question and it is NOT settled here. Two reasons to leave it:
// this issue's OTHER half raised the bridge cap, so a retry is no longer provably futile — R5's four
// attempts all died at a 300s cap that no longer applies; and turning a failure class into a disclosed
// deferral is a doctrine change, which is the to make and not an attribution fix's.

// — a rejected draft may be CARRIED across a recovery park only when its repair is a PATCH, not a
// re-search. That is exactly the judgement WARM_ELIGIBLE_RE already encodes: the tokens meaning "the
// search did not happen" (connotation_search_missing, the merge-gate drop) are deliberately kept OUT of
// it, and telling a model "do NOT redo the sweep" over an unsearched grid would manufacture a clean read.
// ONE allowlist governs both "patchable inside the dispatch" and "patchable across a park", so the two
// can never drift apart. Narrowed to invalid_file: a missing_file draft has no bytes to carry.
export function draftCarryEligible(fail) {
  const f = String(fail ?? "");
  return /^invalid_file:/.test(f) && WARM_ELIGIBLE_RE.test(f);
}
export function warmEligible(fail, json) {
  return json?.status === "ok" && WARM_ELIGIBLE_RE.test(fail ?? "");
}

/**
 * How a turn stopped at its hard wall read when it was stopped: "working" when it asked for a tool other than its own record
 * write within the stage's last stall window, "record-only" when its only asks there were that write, "silent" when it asked
 * for none, and null for anything that is not a hard-wall kill or a turn whose engine could not say. The window is the stage's
 * own `stallSec`, 120 s where it sets none, read back from the end of the turn. Measured before this was built, over saved
 * hard-wall kills: 10 of 14 on production and 18 of 24 on a test machine were working. PURE.
 */
export function killedWhile(turn, stallSec) {
  if (!turn?.killed || !turn?.signals?.hardWall || turn?.signals?.stalled) return null;
  const asked = turn.lastToolAsk;
  const wallMs = Number(turn.wall) * 1000;
  if (!asked || !Number.isFinite(wallMs)) return null;
  const windowMs = (Number.isFinite(stallSec) && stallSec > 0 ? stallSec : 120) * 1000;
  const within = (ms) => Number.isFinite(ms) && wallMs - ms <= windowMs;
  return within(asked.workMs) ? "working" : within(asked.recordMs) ? "record-only" : "silent";
}

/**
 * What a session resumed after a working hard-wall kill reads: design's words, with the stage's own closing tail, the record
 * tool's for a tool-written stage and the whole-file write for any other. Approved word for word. PURE.
 */
export function warmTimeoutMessage(expectFile) {
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  const names = files.map(rel).join(", ");
  const toolWritten = files.length ? toolWrittenArtifact(files[0]) : null;
  const tail = toolWritten
    ? `Call \`${toolWritten.tool}\` with the values from the work already in your context — never by writing or editing any file. Do not stop until the tool accepts the call.`
    : fullWriteTail(names || "the stage output");
  return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo the work from scratch.\n` +
    `Your previous turn was stopped at the stage's time limit while you were still working. Everything you already recorded through the stage's tools is kept; do not record it again. Continue from the last step you completed, finish what remains, and then ` +
    tail + ` This attempt has a longer limit, but not an unlimited one: finish the remaining work rather than revisiting finished steps.`;
}

// ── — THE FIRST RETRY IS ROUTED BY THE RUN'S OWN COUNTED STATE, NOT BY A TOKEN NAME ────────────
//
// Two m-seat failures in the same hour, on the same engine, with opposite correct answers:
//
//   R5  3 rows of many unruled     warm patch     83s  closed
//   R6  EVERY row unruled          warm patch   1007s  byte-identical, discarded
//
// The warm patch is right on R5 and unwinnable on R6. A resumed session re-reads its own output; it
// cannot produce rulings it did not produce the first time when the defect is "you ruled none of the
// rows". The engine already reaches that conclusion — the byte-identical escalation in runStage says so
// in its own words — and pays seventeen minutes to reach it.
//
// THE CONDITION IS THE DIRECT STATE: attempt > 1 and the stage's meaning population has ZERO ruled rows,
// read from the judgement's own count (syncDispositionForm → lastUnion, counted by isRuled — the same
// predicate the gate judges with). It is DELIBERATELY NOT a token list. The first cut keyed this veto on
// TOTAL_DEFECT_TOKENS, a closed list of two form-path tokens — and when the typed transport armed, the
// failure tokens moved out of the list and the veto silently stood down with every assertion still green
// (the hold). An enrolled-token veto is an ENUMERATED check: a future fifth token forgetting to
// enrol is the move-blindness this repo has counted seven instances of. The direct state keys the veto
// on the condition it exists for, and nothing has to remember to join.
//
// THE CALL TAXONOMY IS CLASSIFICATION, NOT THE VETO'S KEY. call_never_made / call_truncated /
// call_partial / call_schema_violation stay as telemetry and as the seat's own remedy routing — their
// partial-vs-total reasoning (a seat that has recorded rows is a seat warm can help; R5's case, and warm
// wins it) now lives in the COUNT the veto reads rather than in a list a token must enrol in.
//
// THE DISPATCH KIND STRING "fresh-total-defect" IS KEPT for journal-vocabulary stability — readers of
// dispatch records and attempt rows bind to it, and a rename would change what a failure costs a reader
// long after it stopped changing what it costs the run.
//
// This does not add or remove a ladder attempt. It decides what attempt 2 IS.
/**
 * Must a corrective retry refuse to RESUME the failed session? True exactly when this stage owes a
 * meaning population and that population has zero ruled rows — the state a resumed session cannot fix.
 *
 * `state` is syncDispositionForm's return: null (stage owes no meaning sweep — the veto does not
 * apply), { countable: false } (owes a sweep, state unreadable), or the counted stats.
 *
 * ── RIDER: A MISSING OR UNCOUNTABLE RULINGS COUNT READS AS ZERO — THE VETO FIRES. DELIBERATELY. ──────
 * This INVERTS the house "an absence is a finding, never a zero" rule, and it is correct in exactly
 * this one place, for one reason: the veto's failure direction is RESUMING-WHEN-IT-SHOULDN'T. Reading
 * an unknown count as "some rows were ruled" resumes a session that may have ruled nothing — the exact
 * 2026-08-15 terminal shape, seventeen paid minutes of a session re-reading its own output. Reading it
 * as zero costs one fresh dispatch. Do not "fix" this to fail loud or to skip the veto on absence: the
 * absence IS still a finding (syncDispositionForm notes it, the validator fails the run in its own
 * lane) — it is only the RESUME decision that must take the safe direction. PURE.
 */
export function vetoResumeRuledNone(attempt, state) {
  if (!(attempt > 1) || state == null) return false;
  const ruled = state.countable === true ? Number(state.ruled) : 0;
  return !(ruled > 0);
}
// opts.supplementalLane: trailing + optional (every positional caller keeps its current output). No warm
// branch names register_enumerate today — a warm resume re-enters the session whose attempt-1 prompt
// already carried the full lane brief — so this only forwards the flag to correctionHint, where a
// lane-branched token would otherwise silently take the legacy arm on a lane run.
// ── WHICH FILE A REPAIR TURN IS TOLD TO WRITE ───────────────────────────────────────────────────────
// warmPatchMessage does NOT always aim at the stage's expectFile. For a whole family of tokens it aims
// at a SIBLING and says, in the same breath, "do NOT rewrite <the expectFile> (it already passed
// validation)": framediff_* → frame-diff.json, coverage_* → register-coverage-ledger.json, findings_*
// → findings.json, grid_* → the failing half's own ledger, named_band_* → <axis>-band.json.
//
// That in-dispatch repair has to know that, because it decides whether a repair LANDED by looking at
// a file's bytes — and looking at the expectFile after a sibling repair would read a compliant model's
// correct answer as "wrote nothing". Rather than re-deriving the routing in the gateway (two copies of
// one rule, drifting from the day they are written), the derivation is lifted here and BOTH callers use
// it: the message that tells the model what to write, and the check that reads what it wrote.
//
// Absolute path, or null when there is no expectFile to hang it off.
export function repairTarget(lastFail, expectFile) {
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  if (!files.length) return null;
  const f = String(lastFail ?? "");
  // named_band_missing: the band is ABSENT and a TOOL writes it — the target is still the band file.
  // — tool_timeout is the same absent band reached the other way (the call was made and killed),
  // so the target is identical. Different cause, different hint, same file to produce.
  if (/named_band_missing/.test(f) || /\btool_timeout:/.test(f)) return join(dirname(files[0]), basename(files[0]).replace(/\.md$/i, "-band.json"));
  const sibling = repairSiblingName(f, files);
  if (sibling) return join(dirname(files[0]), sibling);
  // missing_file: the expectFile itself must land, in full.
  if (/^missing_file/.test(f)) return files[0];
  // generic invalid_file: the token names the defective member of a multi-file stage.
  return failingTarget(f, files) ?? files[0] ?? null;
}

// — WHICH ARTIFACT A VALIDATOR REASON IS ABOUT, as an absolute path. The repair routing already
// holds this answer and has held it since; the `invalid_file:` string was minted beside it without
// asking. One derivation, three readers now: the repair target, the warm-patch message, and the token an
// operator and the seat both read.
//
// FALLS BACK TO THE STAGE'S OWN OUTPUT and never to null, so a reason with no sibling branch — every
// findings token, every prose gate — mints the byte-identical string it minted before. That equality is
// load-bearing: `identicalContent` breaks a ladder by comparing two fail strings, so a token whose path
// wobbled between attempts would read as progress on a seat that had made none.
export function gradedArtifact(reason, expectFile) {
  const f = String(expectFile ?? "");
  if (!f) return f;
  const sibling = repairSiblingName(String(reason ?? ""), [f]);
  return sibling ? join(dirname(f), sibling) : f;
}

// The SIBLING file a token routes its repair to, by bare name — null when the repair aims at the
// stage's own output. Extracted from warmPatchMessage verbatim so repairTarget and the message it
// belongs to can never disagree about where a repair is supposed to land.
function repairSiblingName(lastFail, expectFile) {
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  const f = String(lastFail ?? "");
  return /coverage_(ledger|axis|key|mirror|status_invalid)/.test(f) ? "register-coverage-ledger.json"
    //, typed transport — THE COVERAGE-FORM TOKENS ARE DELIBERATELY ABSENT, exactly like the
    // connotation tokens below and for the same reason: the seat writes no coverage file, so there is
    // no sibling a repair could aim at. The remedy is a `record_coverage` call, which
    // warmPatchMessage's own coverage branch orders BEFORE this function is consulted (its regex, not
    // this name, is what routes those tokens); the graded artifact falls back to the stage's own .md.
    // The old arm returned COVERAGE_FORM_NAME — the seat-facing copy, which nothing writes any more —
    // and a repair aimed at a dead file is the two-halves-disagreeing shape fixed.
    // A1 split: the grid ledger is derived from the failing findings file (gridLedgerNameFor) — a half
    // member repairs ITS common-law-grid.half-<h>.json, the file validators.commonLawHalf re-judges;
    // hardcoding the canonical name here would loop the ladder on a file the validator never reads.
    : /grid_(join_missing|ledger_unparseable)/.test(f) ? gridLedgerNameFor(files)
    // T1 (J1b): the named band lives beside the axis.md as <axis>-band.json — repair THE BAND,
    // never the prose digest (which already passed).
    : /named_band_(state_invalid|block_invalid|unparseable)/.test(f) ? (files.length ? basename(files[0]).replace(/\.md$/i, "-band.json") : null)
    // B — connotation tokens are DELIBERATELY ABSENT again, and this time it is correct for the tool
    // era: the seat writes no dispositions file, so there is no sibling a repair could aim at. The
    // remedy is a `record_dispositions` call, which warmPatchMessage's own connotation branch orders;
    // the graded artifact falls back to the stage's own.md exactly as it did before.
    : CLEARANCE_FINDINGS_TOKEN_RE.test(f) ? "findings.json"   // Phase-0 contract sibling (dormant until Phase 1)
    // blindframe_ is deliberately ABSENT: blind-frame-model.json is no longer a sibling, it is the
    // stage's expectFile. Routing it here would hand the model a message that forbids rewriting the very
    // file it then orders re-saved. The generic invalid_file branch aims the patch correctly.
    : /framediff_/.test(f) ? "frame-diff.json"
    : null;
}

export function warmPatchMessage(lastFail, expectFile, { supplementalLane = false, adds = false } = {}) {
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  const names = files.map(rel).join(", ");
  // named_band_missing (2026-07-14, copper-keystone): the band is ABSENT, not defective — the repair is a
  // TOOL CALL (register_execute_plan writes the whole band; with no existing blocks there is nothing
  // its qid-ownership merge could wrongly preserve). NEVER the sibling "re-save the JSON" message below:
  // a hand-authored band is the exact lane the supplemental contract abolished, and it fails the stage.
  if (/named_band_missing/.test(lastFail ?? "") && files.length) {
    const band = join(dirname(files[0]), basename(files[0]).replace(/\.md$/i, "-band.json"));
    return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo your digest prose (${names} already passed validation) and do NOT author band blocks by hand.\n` +
      `The named band ${band} was NEVER WRITTEN — the stage cannot pass without it. Call register_execute_plan ONCE with the exact {"plan_path", "axis", "output_path"} from your original stage instructions (output_path = ${band}); the TOOL executes the dictated entries and writes the band itself, qid-stamped. Then stop — do not edit the band afterwards.`;
  }
  // — THE SAME RESUME, WITHOUT THE ACCUSATION. The branch above tells the model the band was never
  // written, which on a killed call reads as "you did not do it" to a model that did. Worse, a model
  // told it failed to produce an artifact has one obvious way to comply, and it is the forbidden one.
  // Warm for the same reason that one is: the session completed cleanly and the repair is one call.
  if (/\btool_timeout:/.test(lastFail ?? "") && files.length) {
    const band = join(dirname(files[0]), basename(files[0]).replace(/\.md$/i, "-band.json"));
    return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo your digest prose (${names} already passed validation).\n` +
      `Your register tool call WAS MADE and never returned — it was still running when the bridge killed it, so ${band} was never written. Nothing about your turn was wrong. Call register_execute_plan ONCE more with the exact {"plan_path", "axis", "output_path"} from your original stage instructions (output_path = ${band}), then stop.\n` +
      `If it is killed again: do NOT author band blocks by hand and do NOT narrate coverage you did not obtain. The driver's own call log records that the call never returned.`;
  }
  // Sibling-JSON defects (WS-A coverage mirror / common-law grid): the FINDINGS file already passed
  // its prose checks — telling the model to rewrite it "in full" on a patch turn risks degrading
  // valid prose (and a prose-structural failure is NOT quarantine-rescuable). Name the SIBLING file
  // that is actually defective and forbid touching the findings.
  // (coverage_status_offenum is EXCLUDED from the coverage sibling route: it is a PROSE-cell defect in
  //  register-findings.md itself — the generic full-file patch below is the correct repair, mirroring
  //  plan_audit_missing / intake_ask_unanswered.)
  // B — A CONNOTATION REPAIR IS A TOOL CALL, NOT A FILE EDIT. The seat writes no dispositions file:
  // rulings reach the driver's accumulator only through `record_dispositions`, so a warm patch that
  // ordered any file edit would aim the seat at an artifact it cannot affect — the two halves of one
  // message disagreeing about where the work lands, which is the exact defect class the token split and
  // That routing fixes each closed one layer up.
  if (CONNOTATION_FORM_TOKEN_RE.test(lastFail ?? "") && files.length) {
    // The ABSOLUTE spec path, derived from the failing member's own output by exactly the rule
    // gridLedgerNameFor states and for exactly the same reason: a warm patch carries no base prompt
    // behind it, so this line is the only place the resumed session is re-told which spec its calls
    // name — and a half must be aimed at ITS spec, never the canonical one.
    const halfM = basename(String(files[0])).match(/^common-law-findings\.half-([a-z0-9]+)\.md$/);
    const specPath = driverDir(dirname(files[0]), halfM ? `grid-spec.half-${halfM[1]}.json` : "grid-spec.json");
    // THE CLOSING SENTENCE IS PER STATE (the lesson, kept): "record every outstanding row" is right
    // for a partial and WRONG for a quote defect, where every row is ruled and re-recording rulings is
    // work already done. A truncated call's close must forbid the one compliance a wrongly-accused seat
    // reaches for — re-deriving its rulings.
    const close = /connotation_quote_unbound/.test(lastFail ?? "")
      ? `Do not stop until the tool's answer shows no row owing proof of reading — your rulings are sound and are kept; re-send only the named row(s), each with a \`segment_index\` and a \`fragment\` copied out of that passage.`
      : /connotation_call_truncated/.test(lastFail ?? "")
        ? `This was a transport fault, not a fault in your rulings — re-send the same rows as they were and stop when the tool's answer reports nothing outstanding.`
        : `Do not stop until the tool's answer reports nothing outstanding.`;
    return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo the sweep and do NOT rewrite ${names || "the findings file"} (its own checks passed).\n` +
      `The meaning-sweep dispositions did not pass (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { gridLedgerName: gridLedgerNameFor(files), supplementalLane })}.\n` +
      `Record rulings ONLY by calling the \`record_dispositions\` tool with grid_spec_path: ${specPath} — never by writing or editing any file. Everything already recorded is kept. ${close}`;
  }
  //, carried through the typed transport — A COVERAGE REPAIR IS A TOOL CALL, NOT A FILE EDIT.
  // The seat writes no coverage file: statuses reach the driver's accumulator only through
  // `record_coverage`, so a warm patch that ordered any file edit would aim the seat at an artifact it
  // cannot affect — the exact two-halves-disagreeing shape the connotation branch above closed for B.
  // The economics are unchanged and are still the point of warming this family: the resumed session
  // sends the missing rows in one call instead of re-deriving a 160 KB document from a 1.9 MB band.
  if (/coverage_(no_status|form_damaged|form_axis_invalid)/.test(lastFail ?? "") && files.length) {
    // THE CLOSING ORDER IS PER TOKEN. "Record every outstanding row" is right for a missing judgment
    // and WRONG for an off-vocabulary axis — every row there already carries a status, so it orders
    // work already done. An axis repair closes on the field it is actually about.
    const axisOnly = /coverage_form_axis_invalid/.test(lastFail ?? "");
    return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT re-read the band, do NOT re-run any search, and do NOT rewrite ${names || "the findings file"} (its own checks passed).\n` +
      `The coverage record did not pass (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { gridLedgerName: gridLedgerNameFor(files), supplementalLane })}.\n` +
      `Record statuses ONLY by calling the \`record_coverage\` tool — never by writing or editing any file. Everything already recorded is kept. ` +
      (axisOnly
        ? `Re-send ONLY the seat row(s) the correction names, with a valid "axis"; every other recorded status and reason stands.`
        : `Do not stop until the tool's answer reports nothing outstanding.`);
  }
  const sibling = repairSiblingName(lastFail, files);
  // ── THE SIBLING BRANCH MUST NOT OUTRANK THE TOOL-WRITTEN ONE (third conversion) ────────────
  //
  // This branch orders "Re-save the COMPLETE corrected JSON at <sibling>", which is a hand-write. For
  // frame-diff the sibling IS the tool-written artifact — `frame-diff.json`, with `frame-diff.md` as the
  // stage's `out` — so on this stage the sibling branch is the wrong answer for EVERY token, not an edge
  // case. It ran first and won, and the seat holds no `Write`.
  //
  // Caught by the agreement guard while this conversion was half-built, but only after the guard was
  // widened: its write-order markers matched `writeReturn`, the two repair tails and the max-tokens
  // corrective, and not this composer's own phrasing. The marker for it lands in the same diff — a
  // detector that goes quiet on a rephrasing is the thing that guard exists to refuse.
  const sibIsToolWritten = sibling ? toolWrittenArtifact(sibling) : null;
  // ── AND THE FAILING FILE VETOES IT TOO, not just the sibling ────────────────
  //
  // `repairSiblingName` maps a TOKEN to a sibling, and a token does not name a file. `findings_coverage_*`
  // meant the digest's `register-coverage-ledger.json` for as long as the digest's prose file was the only
  // thing that could raise it. The writer's conversion makes `findings.json` raise the same tokens through
  // the same parser — so on a synthesis failure this branch told the seat not to rewrite `narrative.md`
  // and then ordered a hand re-save of the DIGEST's ledger, an artifact of another stage that this seat
  // has no business touching and no grant to write.
  //
  // The veto is the file, not the token, for the reason this file already states one branch down: the
  // right question is never which token fired but whether the ARTIFACT has a writer other than the
  // driver. A tool-written failing file cannot be repaired by re-saving anything by hand, whatever the
  // token's historical sibling was. Unchanged for every stage whose output is still hand-written.
  //
  // THE DIGEST NO LONGER KEEPS THIS BRANCH. This comment used to end "the digest keeps this branch,
  // because `register-findings.md` is still its seat's to write", and conversion 11 made that false —
  // the veto below now fires for it, correctly, and the digest routes to the tool tail. Corrected here
  // rather than deleted because the sentence is the reason the veto is keyed on the FILE and not the
  // token, and a reader who finds the old claim will trust it against the code.
  const outIsToolWritten = files.length ? toolWrittenArtifact(files[0]) : null;
  if (sibling && files.length && !sibIsToolWritten && !outIsToolWritten) {
    const sib = join(dirname(files[0]), sibling);
    // THE OUT FILE IS NAMED ONLY TO SAY "LEAVE IT ALONE", AND ON A CONVERTED STAGE THAT IS THE WRONG WAY
    // TO SAY IT. This message carries TWO artifacts — the stage's out, told to stand,
    // and the sibling, told to be re-saved — so a reader looking for "does any message name a
    // tool-written artifact beside a write order" cannot pair them, and the guard flags the pair.
    // Its conservatism is right: pairing an order with a target by proximity would be guessing, and the
    // defect it exists to catch looks exactly like this from outside. So the converted case says the file
    // is the driver's WITHOUT naming a path — which is also more accurate than telling a seat not to
    // rewrite something it holds no writer for.
    const outIsToolWritten = toolWrittenArtifact(files[0]);
    const standsClause = outIsToolWritten
      ? `Do NOT redo the work from scratch. This stage's own output is the driver's — it is rendered from your \`${outIsToolWritten.tool}\` call and you hold no tool that writes it, so there is nothing there for you to rewrite or protect.`
      : `Do NOT redo the work from scratch, and do NOT rewrite ${names || "the findings file"} (it already passed validation).`;
    return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. ${standsClause}\n` +
      `Your saved ${sibling} failed validation (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { gridLedgerName: gridLedgerNameFor(files), supplementalLane, undispatchable: frameDiffUndispatchable(files, lastFail), heldRecord: heldSynthesisRecord(files), adds })}.\n` +
      `Re-save the COMPLETE corrected JSON at ${sib}. Do not stop until it exists and is valid.`;
  }
  // — A BLIND-FRAME REPAIR IS A TOOL CALL, NOT A FILE WRITE, and this branch is what stops the two
  // write-mode branches below from ordering an act the grant now denies. The seat holds no Write and no
  // Edit after the conversion, so `fullWriteTail`'s "Write the COMPLETE file now … with the Write tool" and
  // `editRepairTail`'s "TARGETED EDITS … using the Edit tool" would both fail on obedience, mid-round, on
  // the first repair rung that fires. Third instance of the same class in one day, and the only one caught
  // before it shipped: the ten anchor sites were found after, and the connotation and coverage
  // branches above exist because the same disagreement was found in those transports first.
  //
  // BOTH DIRECTIONS, because after the conversion they are the same fault. `missing_file` no longer means
  // "the turn wrote nothing" — the driver writes the file, so an absent model means the TOOL WAS NEVER
  // CALLED. `blindframe_*` means the call arrived and its values failed the parser. One remedy: call it.
  //
  // THE TOKEN-FAMILY LIST IS GONE (third conversion), and its removal is the root-cause half. It
  // read `/blindframe_|skeptic_/`, which is a second authoring of "which stages are converted" — one that
  // this conversion would have had to extend with `framediff_`, and the next one with its own prefix,
  // each time by somebody remembering. The right question is not which token fired but whether the
  // ARTIFACT has a writer other than the driver, and `TOOL_WRITTEN_ARTIFACTS` already answers it. After a
  // conversion the seat cannot write the file at all, so NO token about it can be repaired by a write.
  //
  // The sibling is consulted too: frame-diff's `out` is the prose and every `framediff_*` token is about
  // the JSON beside it, so a lookup on `files[0]` alone would miss the artifact the failure is actually
  // about.
  // ── AND THE SIBLING'S TOOL IS NEVER ADOPTED ACROSS A STAGE BOUNDARY ────────
  //
  // This read `toolWrittenArtifact(files[0]) ?? sibIsToolWritten`, so a stage whose OWN output has no
  // row could inherit its sibling's tool. That was harmless while every sibling belonged to the same
  // stage as its output. It stopped being harmless the moment `findings.json` gained a row:
  // `repairSiblingName` maps EVERY `findings_*` token to `findings.json`, including the ones the
  // DIGEST raises about `register-findings.md` — so a digest failure was about to be answered with
  // "call `record_synthesis`", a tool the digest seat does not hold and never will. The seat would
  // have been handed a repair it could not perform, which is the two-halves-disagreeing shape this
  // whole routing exists to prevent, arriving from the one direction nobody had had to think about.
  //
  // frame-diff is unaffected and was the reason the fallback was written: BOTH its basenames carry
  // rows, so the `files[0]` lookup already answers for it. The fallback was covering a case that no
  // longer exists and exposing one that now does.
  const toolWritten = files.length ? toolWrittenArtifact(files[0]) : null;
  if (toolWritten) {
    const never = /^missing_file/.test(lastFail ?? "");
    return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo the work.\n` +
      (never
        ? `Your previous turn completed but ${toolWritten.what} never reached the driver (${lastFail}) — the \`${toolWritten.tool}\` tool was never called, and nothing you may have written by hand is read.\n`
        // `undispatchable` IS PASSED HERE TOO, and leaving it out was a regression this branch introduced
        // the moment frame-diff started routing through it. P2-B's whole property is that the hint
        // enumerates EVERY offending directive, read off the artifact rather than off the 160-char fail
        // string — a warm patch that named one of four would make the three-attempt ladder count
        // DIRECTIVES again, which is the 2026-07-29 reopen loss. Caught by frame-diff-model.test.mjs's
        // cardinality pin, which asserts the warm path carries the full list without the caller passing
        // anything.
        : `What you sent did not pass (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { supplementalLane, undispatchable: frameDiffUndispatchable(files, lastFail), toolWritten: toolWritten.tool, heldRecord: heldSynthesisRecord(files), adds })}.\n`) +
      `Call \`${toolWritten.tool}\` with the values from the work already in your context — never by writing or editing any file. ` +
      `Do not stop until the tool accepts the call.`;
  }
  // Write-mode branch (E2E R2 2026-07-30/31): the FAILURE TOKEN is the validator's own existence verdict,
  // measured at the moment that matters — branch on it rather than re-deriving with an existsSync here
  // (this function is pure and unit-tested; WARM_ELIGIBLE_RE admits exactly missing_file and invalid_file:*,
  // so the branch is total).
  //   missing_file : the turn completed but the file was NEVER written. There is nothing to patch — the work
  //                  is in the session's context and must land in full.
  //   invalid_file : the file EXISTS and ONE named check failed. Everything else in it already passed, so a
  //                  full re-emit is the expensive way to risk degrading valid content. Patch it.
  // On a multi-file stage the token names the defective member; aim the repair at THAT file only.
  if (/^missing_file/.test(lastFail ?? "")) {
    return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo the work from scratch.\n` +
      `Your previous turn completed but ${names || "the stage output"} was NEVER WRITTEN (${lastFail}).\n` +
      fullWriteTail(names || "the stage output");
  }
  const defective = failingTarget(lastFail, files) ?? files[0] ?? null;
  return `You are RESUMING your own session for this stage — your prior work and inputs are already in your context. Do NOT redo the work from scratch.\n` +
    `Your saved ${defective ? rel(defective) : names || "output"} failed validation (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { gridLedgerName: gridLedgerNameFor(files), supplementalLane, undispatchable: frameDiffUndispatchable(files, lastFail), heldRecord: heldSynthesisRecord(files), adds })}.\n` +
    editRepairTail(defective || names || "the stage output");
}

// ── — WHY THIS IMPORT IS AT THE BOTTOM OF THE FILE ─────────────────────────────────────────────
//
// `import` is hoisted, so its position is free — and at the top of THIS file it is not free. 61
// line-citations across 35 tracked files point into this file and its sibling; one line added at the
// top repoints every one of them by one. `scripts/citation-line-check.mjs` would catch only the few
// that landed on a blank line: it says so itself — "a citation that drifted onto a different REAL line
// reads as correct to it". So the choice was a 61-number sweep with a silent-error mode, or one import
// placed where it shifts nothing. This is the second.
//
// Move it to the top the day those citations name symbols instead of numbers — which is what
// CONTRIBUTING.md asks for, and what makes them checkable at all.

/**
 * THE COUNTS A TEST ROUND READS PER STAGE, on both engines, spread into `toolGauge`. `toolCallsRefused`:
 * calls the program refused (Claude's own denials; Codex's tool-server calls refused before reaching their
 * server). `commandToolCalls`: calls to a tool that runs a command, which no Claude stage is offered, so
 * zero is the expected reading there; Codex keeps its shell and counts the commands it ran. `mcpToolCalls`: the tool-server
 * calls Codex completed, its only count of calls made, since its `toolCalls` stays null.
 * `toolCallsErroredByName`: the tool-server calls that came back as an error, by tool name, so a stage that
 * had a call refused and made it again says so where its row otherwise reads ok on one attempt. Null, as in
 * `toolGauge`, is "this engine does not report", never zero. RECORDING ONLY. It sits at the end of this
 * file so that adding it moved no line another file cites.
 */
function toolCallCounts(turn) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  const errored = turn?.toolCallsErroredByName;
  return { toolCallsRefused: n(turn?.toolCallsRefused), commandToolCalls: n(turn?.commandToolCalls), mcpToolCalls: n(turn?.mcpToolCalls),
    toolCallsErroredByName: errored && typeof errored === "object" && !Array.isArray(errored) ? { ...errored } : null };
}

