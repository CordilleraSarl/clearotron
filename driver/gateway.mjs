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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import { config, resolveModel, modelFamily, envOn, envGateOn } from "./driver.config.mjs";
import { stageLog, runLog, note, outputMeta } from "./log.mjs";
// — the closed disposition set has ONE author; this file dictates it and must not retype it.
import { DISPOSITIONS, POSITION_REQUIRED_DISPOSITIONS } from "./findings-model.mjs";
import { frozenSnapshot, describeDrift } from "./run-integrity.mjs";   // — the frozen judged-by set across a seat turn
import { isCancelled, readCancel, RunCancelled } from "./cancel.mjs";
import { anthropicAgentEngine } from "./engine/anthropic-agent.mjs";
import { openaiAgentEngine } from "./engine/openai-agent.mjs";
import { resolveAuthMode } from "./engine/auth.mjs";
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
import { MODEL_FILE as VARIANT_MODEL_FILE, PROSE_FILE as VARIANT_PROSE_FILE } from "./prelim-variants-record.mjs";
import { PROSE_FILE as REPORT_OVERVIEW_FILE } from "./report-overview-record.mjs";
import { NARRATIVE_FILE, FINDINGS_FILE, refusalsFor } from "./synthesis-record.mjs";
import { FINDINGS_FILE as REGISTER_FINDINGS_FILE, refusalsFor as registerDigestRefusalsFor } from "./register-digest-record.mjs";

// artifact basename -> the tool that is now its only writer. A repair for one of these is a CALL, never a
// file edit, and this table is what the warm patch reads to know that. It grows by one row per conversion,
// so its membership IS the conversion record — and a stage absent from it still gets the write-mode tails,
// correctly, because its seat still holds Write.
// EXPORTED for 's agreement guard, which derives each recording stage's artifact from this table
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
  [VARIANT_MODEL_FILE, { tool: "record_prelim_variants", what: "the variant manifest" }],
  [VARIANT_PROSE_FILE, { tool: "record_prelim_variants", what: "the variant manifest" }],
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
import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, recordAxisFor, seatWritesForGroups } from "./engine/mcp/gather-config.mjs";
// The profiles STORE root, for the write boundary only — read from the module that owns it, never
// re-derived from CLEAROTRON_CUSTOMERS_DIR here. Acyclic: profiles.mjs imports node builtins + config.
import { unitRefusalsFor } from "./register-unit-record.mjs";
// The chunk artifact's name shape, IMPORTED from the module that constructs the path — never restated
// here. See TOOL_WRITTEN_PATTERNS below for why this table reads a pattern instead of owning one.
import { KNOCKOUT_ASSESS_CHUNK_RE, knockoutAssessChunkFile } from "./knockout-assess-record.mjs";
// The frame transport's refusal reader, so a missing plan or note can be told apart from a stage that
// never called its tool — the distinction, which its sibling stage still lacks.
import { frameRefusalsFor } from "./knockout-frame-record.mjs";
import { profilesStoreDir } from "./profiles.mjs";
// The supplemental lane's single source (stages.mjs). The import is acyclic — stages.mjs reads
// verify/coverage-ledger/config/framework and never reaches back here.
import { REGISTER_ENUMERATE_TOOL, SUPPLEMENTAL_LANE_STEERING } from "./stages.mjs";
// The ONE kill-class discriminator (timeout/status_timeout fails, exit 137, killed, hard-wall/stall
// signals; lane_wedge and rate_limited deliberately excluded). Reused verbatim so "a kill" means the
// same thing to the exit-1 rescue below as it does to the register taint chain that reads the very
// same rows off disk. Acyclic: register-taint.mjs imports node builtins only.
import { isTaintRow } from "./register-taint.mjs";
import { recordDispatch } from "./dispatch-record.mjs";
import { recordBestDraft } from "./best-draft.mjs";
//: the allowlisted progress-quantity extractor. Acyclic — repairs.mjs imports node builtins only
// (fs/crypto/path). Used only when the validator did not stamp its own count; never a digit hunt.
import { progressQuantity } from "./repairs.mjs";
// The ask contract's enumeration (PURE, node-free — acyclic). The undispatchable hint reads the
// SIBLING ARTIFACT rather than the fail string, because the fail string is cut at 160 chars.
import { undispatchableFiringDirectives } from "./frame-diff-model.mjs";
import { witnessStageMethodology, describeMethodologyDrift } from "./methodology-witness.mjs";
// — the meaning-sweep form and its accumulator. Both PURE and acyclic: connotation-search.mjs
// imports nothing, disposition-union.mjs imports only it, and neither reaches back here.
import { parsePrRiskResults, connotationObligations, parseDispositionForm, rulingsProse, CONNOTATION_FORM_TOKEN_SRC, CONNOTATION_FORM_TOKEN_RE } from "./connotation-search.mjs";
import { unionDispositionForm, formSidecarPath } from "./disposition-union.mjs";
import { unionCoverageForm } from "./coverage-union.mjs";
import { coverageFormStamp, readCoverageForm, readCoverageFormInput, writeCoverageForm } from "./coverage-form-io.mjs";
import { unionPlacementForm } from "./placement-union.mjs";
import { placementFormStamp, readPlacementForm, readPlacementFormInput, readSubmittedPlacementForm, writePlacementForm, renderPlacementsFile } from "./placement-form-io.mjs";
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

export function isEmbeddedFallback(json, stderr = "") {
  const m = json?.meta ?? json?.result?.meta ?? {};
  return m.transport === "embedded" || m.fallbackFrom === "gateway" || /EMBEDDED FALLBACK/.test(stderr);
}

// A gateway turn that ran out of time. Three signals: (1) execFile hit its hard kill (timeoutSec+60);
// (2) the gateway hit its OWN turn timeout, after which the CLI auto-falls-back to embedded and that
// attempt errors — surfacing as `EmbeddedAttemptSessionTakeoverError` / "request timed out" on a
// nonzero exit (the v14 delivery failure, previously mislabelled `nonzero_exit_1`); (3) any nonzero
// exit whose wall already reached the configured budget. Distinguished from transient errors so the
// retry policy can give a slow stage ONE longer shot instead of 3 identical doomed attempts.
export function isTimeout({ killed, code, wall, stderr = "", timeoutSec }) {
  if (killed) return true;
  if (/EmbeddedAttemptSessionTakeoverError|request timed out|\bETIMEDOUT\b/i.test(stderr)) return true;
  if (code !== 0 && wall >= timeoutSec) return true;
  return false;
}

// A LANE WEDGE: a timeout whose turn moved ZERO tokens — the gateway never admitted it to a command lane (the
// serial `main` lane saturated by the heartbeat sweep). The real signature (teal-bastion 2026-06-15) is a
// hard-kill timeout with a NULL usage envelope, so we key on "fail is a timeout AND no tokens moved" rather than
// on a parsed 0-usage object. A slow-but-working model that times out returns a status_timeout envelope WITH
// usage (admitted) → NOT a wedge. Kept pure + exported so the classifier is unit-tested (it must not misfire on
// admitted turns, and it MUST fire on the null-usage hard-kill that the production incident actually produced).
export function isLaneWedge(fail, usage) {
  if (fail !== "timeout") return false;
  const moved = (usage?.input || 0) + (usage?.output || 0) + (usage?.cacheRead || 0) + (usage?.cacheWrite || 0);
  return moved === 0;
}

// Final wedge classification at the runStage call site. A 0-token timeout LOOKS like a wedge (isLaneWedge), but a
// HARD-WALL kill (signals.hardWall — the turn ran the full timeout+60 and was SIGKILLed) is a genuine over-budget
// grind, NOT a saturated command lane; labelling it `lane_wedge` wastes a 2-cycle chain retry on a turn that won't
// fit. Keep `lane_wedge` only for a STALL (signals.stalled) or a truly-silent non-hard-wall null-usage kill; a
// hard-wall kill stays `timeout` (gets at most ONE extended shot, then the deferral). PURE + exported for test.
export function classifyWedge(fail, usage, signals) {
  if (isLaneWedge(fail, usage) && !signals?.hardWall) return "lane_wedge";
  return fail;
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
// that cannot report them is NOT a turn that called no tools: `openai-agent` carries no tool references
// at all, so every codex attempt is unmeasured. Writing 0 for those would make every codex turn read as
// "called no tools", and a cross-engine comparison would then conclude tool wait is an Anthropic-only
// phenomenon — from an instrument that had simply gone quiet.
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
    toolWaitUnmeasurable: Array.isArray(turn?.toolWaitUnmeasurable) ? [...turn.toolWaitUnmeasurable] : null,
  };
}

export function tokensPerSec(usage, wall) {
  const w = Number(wall);
  if (!usage || !Number.isFinite(w) || w <= 0) return null;
  const out = Number(usage.output);
  if (!Number.isFinite(out) || out < 0) return null;
  return Math.round((out / w) * 100) / 100;
}

// #5b — stop a warm/followup resume after ONE attempt when it ran to the HARD WALL. A followup (escalation,
// envelope close, frame-reopen "enumerate to exhaustion" sweep) resumes an already-loaded session; if it
// SIGKILLed at the full timeout+60 wall (signals.hardWall, NOT a 0-token stall), the same work re-issued at a
// 1.5× extension just burns another full wall — so break and let the caller record the coverage-limited
// deferral. The signal is `followup` (or a `warm` content-retry): NOTE `warm` ALONE never fires here on a
// timeout — warmEligible() excludes `timeout`, so `warm` is always false on a timeout chain. That is exactly
// the dead-code bug this predicate fixes: before threading `followup`, a hard-wall followup burned TWO attempts
// (~2.5× the wall) instead of ONE (~1×). A STALL (no hardWall) is NOT stopped here — it keeps the normal
// one-extended-shot retry, since a transient stall can clear. PURE + exported for test (the live hard-wall path
// needs a 60s wall-clock kill, untestable in the offline suite — this predicate IS the policy under test).
export function followupHardWallStop({ fail, warm, followup, signals }) {
  return fail === "timeout" && (Boolean(warm) || Boolean(followup)) && Boolean(signals?.hardWall);
}

// D3 — Anthropic overload (HTTP 529 / overloaded_error). Through claude -p a 529 surfaces as a FAILED
// turn (nonzero exit) whose result text/stderr carries the overloaded_error envelope — classified
// generically it looked like `nonzero_exit_1` and the ladder re-attempted INSTANTLY, hammering an API
// that just said "go away" (and burning the retry budget in seconds — the 04:30 restart-window shape).
// Detect it and reclassify to `status_overloaded`, the token the normalized --json envelope already
// produces for the same condition: FALLBACK_ELIGIBLE routes it to the chain's model cascade,
// TRANSIENT_RE routes an exhausted chain to the recovery park (.postponed + escalating backoff) — the
// existing machinery owns the re-attempt; runStage breaks its own ladder on it (mirrors lane_wedge).
// The 529 match is deliberately ANCHORED (api error / http prefix, or overload vocabulary within the
// same line) so a stray "529" in ordinary output never misroutes a real content failure. PURE + exported.
const OVERLOAD_RE = /overloaded_error|"type"\s*:\s*"overloaded"|\bapi[ _]?error:?\s*529\b|\bhttp\s*529\b|\b529\b[^\n]{0,120}overloaded|overloaded[^\n]{0,120}\b529\b/i;
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

export function isOverloaded({ json, stdout = "", stderr = "" } = {}) {
  if (json?.status === "overloaded") return true;
  return OVERLOAD_RE.test(`${stdout}\n${stderr}`);
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

// ── — WALL RESCUE QUIESCENCE. How long every declared artifact must have been UNTOUCHED when the
// turn settled, for its write to count as provably COMPLETE rather than possibly torn.
//
// The torn-write window is [watchdog decision, child death]: one poll tick plus the SIGTERM→SIGKILL
// escalation (engine/common.mjs killEscalateMs, default 5000ms). 60s is that window with an order of
// magnitude to spare, and the incident clears it by another: on the 2026-08-04 R1 run the
// placement artifact's last write was 13:58:46Z and the wall kill was 14:15:00Z — 974 seconds quiet.
//
// This is the ONE fact a shape validator cannot supply, and it is the entire reason this rescue may do
// what the exit-1 rescue must not. Setting it to 0 is NOT tuning — it deletes the only completeness
// evidence and would rescue post-merge audit 2's torn draft. Disarm with CLEAROTRON_WALL_RESCUE=0 instead.
const wallRescueQuiesceMs = () => 60000;   // step 3 — was a knob; no environment ever set it
const wallRescueEnabled = () => !/^(0|off|false|no)$/i.test(String(process.env.CLEAROTRON_WALL_RESCUE ?? "").trim());

// ── Engine seam (CLEAROTRON_AI) ──────────────────────────────────────────────────────────────────
// The 14 stages run on the anthropic-agent engine (`claude -p` off-gateway with the stall-watchdog; see
// engine/CONTRACT.md). Its runTurn() returns the normalized tuple runStage consumes
// ({code,killed,wall,stdout,stderr,laneWaitMs,json,usage,sessionRef,signals}); all the
// classification/retry/warm logic below is engine-agnostic. There is no second exec path beside it —
// the comms one-shots that used to have one now write outbox packets and spawn nothing.
//
// Engine registry (provider adapters). The driver orchestration + the classification/retry/warm ladder are
// ENGINE-AGNOSTIC: everything provider-specific lives behind an engine's runTurn() → the normalized tuple. So
// provider CHOICE (e.g. Anthropic → OpenAI) = which adapter is registered and selected via CLEAROTRON_AI —
// NOT a model-name swap: each provider needs its own agentic-runtime adapter (MCP/tools/skills/streaming/resume).
// One is implemented today: `anthropic-agent` (`claude -p`, off-gateway). Adding e.g. `openai-agent` = write
// engine/openai-agent.mjs implementing the same runTurn() contract (engine/CONTRACT.md §1), registerEngine() it,
// and select it via CLEAROTRON_AI — runStage is untouched. (The legacy gateway-bin engine removed in the
// extraction was a *runtime*, not a provider choice, and coupled the driver to one integrator platform.) An
// unknown CLEAROTRON_AI fails loud — no silent wrong-provider run. There are no comms stages: every
// requester-facing event is an outbox packet (docs/DELIVERY.md).
const ENGINES = new Map([
  [anthropicAgentEngine.name, anthropicAgentEngine],
  [openaiAgentEngine.name, openaiAgentEngine],   // second provider adapter (codex exec) — CLEAROTRON_AI=openai-agent
]);
export const DEFAULT_ENGINE = anthropicAgentEngine.name;   // "anthropic-agent" — production default UNCHANGED
/**
 * The ids this registry actually holds — read-only, so a SECOND list can be pinned against the first
 * rather than drifting away from it in silence. `ENGINE_BINARIES` in driver.config names the
 * binary variable per engine and the wizard builds its menu from it; without this, "the wizard offers
 * an engine the driver does not ship" and "the driver ships an engine setup cannot reach" are both
 * invisible until a reader picks the row that does not exist. Same guarantee the register-provider
 * list already has (onboard-wizard.test.mjs, "a new adapter must not be invisible to setup").
 */
export function registeredEngines() { return [...ENGINES.keys()]; }
export function registerEngine(engine) {
  if (!engine?.name || typeof engine.runTurn !== "function") throw new Error("registerEngine: expected an { name, runTurn } engine adapter");
  ENGINES.set(engine.name.toLowerCase(), engine);
}
/**
 * The engine for this activation. PROCESS-WIDE, and the missing parameter is the point.
 *
 * This took a `_stageName` it ignored, under a call-site comment reading "per-stage: CLEAROTRON_AI base,
 * comms forced to the gateway, override-able". None of that existed: no per-stage override, no comms
 * forcing, no per-job override. `CLEAROTRON_AI` is read from the process env at every activation and
 * governs every stage of every job in it.
 *
 * A comment describing a capability that does not exist is worse than no comment — it gets believed and
 * planned against, and the plan only fails once someone tries to use it. Corrected rather than built:
 * per-stage selection is an architecture change (a job spec would have to carry the engine, and the
 * routing would have to survive resume), not a comment fix.
 *
 * WHAT THE ABSENCE COSTS, stated so a round plan does not discover it mid-round: **an A/B cannot run
 * both engines concurrently on one instance.** Comparing codex against anthropic means flipping
 * CLEAROTRON_AI and running sequentially, or standing up a second instance with its own env, pool and
 * ports. The same absence blocks routing the refutation reviewer to a different engine for family
 * diversity (ENGINE-OPENAI-ADAPTER §6). Recorded in docs/E2E.md, which is where a round plan looks.
 */
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

export function selectEngine() {
  const id = (process.env.CLEAROTRON_AI || DEFAULT_ENGINE).toLowerCase();
  const engine = ENGINES.get(id);
  if (!engine) throw new Error(`CLEAROTRON_AI="${id}" is not a registered engine adapter (available: ${[...ENGINES.keys()].join(", ")}). Implement one and registerEngine() it — see engine/CONTRACT.md.`);
  return engine;
}

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
// What died here with the form path (2026-08-17 owner ruling, delete-not-gate): reading the seat's file
// as a SUBMISSION, preserving it, refereeing whose bytes it held ('s isDriverOwnBytes machinery) and
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
      try { spec = JSON.parse(readFileSync(specPath, "utf8")); }
      catch {
        // No spec sidecar ⇒ a pre- archived resume: nothing dictated, nothing owed, nothing to count.
        // A spec that EXISTS and does not parse is a different fact: the stage owes a sweep whose state
        // cannot be counted, and reading that as "owes nothing" would resume a session the veto exists to
        // refuse. The validator fails such a run on grid_spec_unreadable in its own lane.
        return existsSync(specPath) ? { countable: false } : null;
      }
      const formPath = spec?.connotation?.dispositions_path;
      // No dictated path ⇒ a pre- spec (an archived run being resumed). Nothing to count, and the
      // gate has nothing to judge either — the two agree by construction.
      if (!formPath || spec?.connotation?.disposition_required !== true) return null;
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
      note(`[coverage-form] register-units carries ${a}.md, which is not one of the register axes — its row is DRIVER-written and a seat cannot repair it. This is a driver fault, not a seat one (#1100).`);
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
    const prior = readPlacementForm(runDir).rows;
    const submitted = readSubmittedPlacementForm(runDir);
    const u = unionPlacementForm({ rows: prior }, submitted === null ? null : { rows: submitted }, input);
    try { writePlacementForm(runDir, u.form); }
    catch (e) { note(`[placement-form] could not write the form: ${abbrev(String(e.message), 120)} — the render below still runs from the union in hand`); }
    // PARSE-THEN-LAND, through the gate's own parser, before it replaces anything. A render defect can
    // never put an unparseable deliverable on disk, and on a throw the previous file is left alone.
    const r = renderPlacementsFile(runDir, u.form.rows);
    if (!r.ok) note(`[placement-form] placements.json NOT re-rendered: ${r.error} — the previous file stands and the omission is on the form`);
    return { ...u, rendered: r.ok ? r.placements : null, render_error: r.error };
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
  const engineForHome = selectEngine();
  let stageCodexHome = null;
  if (engineForHome?.name === "openai-agent") {
    try { stageCodexHome = mkdtempSync(join(tmpdir(), `codex-stage-${String(name).replace(/[^a-z0-9-]/gi, "_")}-`)); }
    catch { stageCodexHome = null; }   // fall back to the engine's own per-turn home rather than fail a stage
  }
  try {
    return await runStageLadder(name, opts, stageCodexHome);
  } finally {
    // Deleted when the LADDER settles — every resume that needed it has happened by then. Best-effort:
    // a home we cannot remove must never turn a completed stage into a failure.
    try { if (stageCodexHome) rmSync(stageCodexHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

async function runStageLadder(name, opts, stageCodexHome = null) {
  const {
    agent = config.defaultAgent,
    message,
    // — OPTIONAL PER-ATTEMPT RECOMPOSE. A stage may declare that its dispatch text depends on state
    // the run changes between attempts; when it does, this recomposes the base the corrective text is
    // appended to. Absent — which is every stage but one — the base stays exactly `message`, byte for
    // byte, and there is a test that drives both arms to prove it.
    //
    // A CAPABILITY THE STAGE DECLARES, not a flag hiding a second path: there is no configuration that
    // turns this on for a stage that did not ask, and no branch a reader has to know about to predict what
    // a stage sends.
    refreshMessage,
    model,
    thinking,
    sessionKey,
    timeoutSec = 600,
    stallSec,          // per-stage stall override (anthropic-agent only); falls back to global CLEAROTRON_STALL_MS
    expectFile = [],
    validate,
    maxRetries = config.maxRetries,
    runDir,
    followup = false,   // #5b: this run is a warm-resume / followup (escalation, envelope close, frame-reopen
                        // sweep) — a hard-wall timeout breaks after ONE attempt (a 1.5× extension can't fit
                        // an already-over-budget resume; the caller records the coverage-limited deferral).
    excludeTools,       // copper-lattice re-route: tool names dropped from this stage's allowedTools
  } = opts;
  if (!message) throw new Error(`runStage(${name}): message is required`);
  if (!sessionKey) throw new Error(`runStage(${name}): sessionKey is required`);
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  // ION/copper-foundry 2026-07-22: this file cannot see the plan's supplemental_lane contract, and it
  // must not grow a second flag that could drift from it — so derive the lane from the ONE observable
  // that the contract produces here, the removed tool. Every corrective/warm re-dispatch below then
  // agrees with the toolset the attempt actually gets, instead of contradicting the base prompt.
  const supplementalLane = Array.isArray(excludeTools) && excludeTools.includes(REGISTER_ENUMERATE_TOOL);

  const engine = selectEngine();   // process-wide, not per-stage — see selectEngine
  // Billing-mode (auth) resolution — fail LOUD if a mode claims API billing but has no key (fixes the
  // anthropic silent-fallthrough WITHOUT editing anthropic-agent.mjs), and give the stamp its value. Frozen
  // per run (env-derived). The throw is caught by pipelineInner's terminal catch and turned into a run
  // FAILURE carrying the named auth error on the guaranteed failure-packet lane (verified) — loud + named,
  // NOT a silent mis-bill. (Same catch as the unknown-engine throw above.)
  const auth = resolveAuthMode({ engineName: engine.name });
  // Two INDEPENDENT engine capability flags (both default ON for an engine that declares neither, so the
  // anthropic engine — which sets neither — behaves exactly as before). A future adapter can opt out of
  // either without the other:
  let gatherMcpConfig, gatherAllowedTools, engineSkillsDir, engineSkillsGrantRoots, engineResolveSkill;
  // — the DECLARATION half of the run-dir read grant. `null` means this stage has no recording
  // row to declare anything, and the adapter treats unknown as "keep the grant" — so a stage the
  // gateway says nothing about is unaffected by that change.
  let gatherSeatWrites = null;
  // (a) Skills plumbing (usesSkillsDir): a CLI-agentic engine resolves the stage prompts' `skills/…` refs
  // against its neutral cwd (a tmpdir) and confines file tools to cwd + --add-dir roots, so hand it the
  // compute-skills dir (config.skillsDir — the driver-co-located tree) + this run's dir so it can absolutize
  // the refs and grant read(skills)/write(runDir). The agent's own workspace is no longer involved.
  if (engine.usesSkillsDir !== false) {
    engineSkillsDir = config.skillsDir;
    engineSkillsGrantRoots = config.skillsGrantRoots;   // layered skills: BOTH roots reach the seat, resolve overlay-first
    engineResolveSkill = (rel) => config.resolveSkillPath(rel);
  }
  // (b) Gather tools (usesGatherMcp): a gather stage gets its tool group's MCP servers + allowedTools;
  // tool-free judgment stages get none (lean context). Both current engines get the SAME claude-shaped
  // mcpConfig; a codex engine translates it to config.toml internally, so gather-config.mjs is untouched.
  if (engine.usesGatherMcp !== false) {
    const groups = toolGroupsForStage(name);
    if (groups.length) {
      // The bound card index rides the same label the grant was resolved from — derived by the SAME
      // declared rule (`perAxis`), never by a second string-sniff that could disagree with it.
      const cfg = buildGatherMcpConfig(groups, { sessionKey, agent, runDir, recordAxis: recordAxisFor(name)?.axis });
      gatherMcpConfig = cfg ? JSON.stringify(cfg) : undefined;
      gatherAllowedTools = allowedToolsFor(groups);
      gatherSeatWrites = seatWritesForGroups(groups);   // — the SAME derivation allowedToolsFor uses
      // Per-stage exclusion (copper-lattice re-route): a supplemental-lane register unit loses
      // register_enumerate — its judgment additions go through register_propose_supplemental, so the
      // free-enumerate hand-transcription lane cannot silently return. Group-level removal is
      // infeasible (synthesis + legacy no-plan units share the group); the validator is the backstop.
      if (Array.isArray(excludeTools) && excludeTools.length && gatherAllowedTools) {
        const drop = new Set(excludeTools);
        gatherAllowedTools = gatherAllowedTools.split(" ").filter((t) => !drop.has(t)).join(" ");
      }
    }
  }
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
  // statOf feeds the ONE artifact-state snapshot both the exit-1 rescue and AD-4's emitted-vs-landed
  // gauge read. It is taken PER ATTEMPT, just before the turn is dispatched — it used to be taken
  // once before the whole ladder, which is the cross-attempt rescue hole post-merge audit 2 found: a
  // later attempt's nonzero exit was judged "fresh" against a snapshot predating an EARLIER attempt's
  // write, so attempt 1's kill-torn partial rescued attempt 2's no-write exit as stage truth.
  const statOf = (f) => { try { const s = statSync(f); return `${s.mtimeMs}:${s.size}`; } catch { return null; } };
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
  // criterion 1 — A WARM TURN THAT NEVER REACHED THE MODEL DOES NOT COST A RUNG, ONCE.
  //
  // Measured before this existed: a warm turn returning `usage: null` and `runId: null` — the
  // startup-death shape, exit 1 under a second, zero tokens — still advanced the ladder. A stage with
  // three attempts spent one on a turn that did nothing, which is the defect this issue names: "a
  // warm-patch attempt either reaches the model or does not consume a ladder rung."
  //
  // THE BOUND IS THE WHOLE DESIGN. Refunding unconditionally lets a warm turn that never lands loop
  // until the wall. ONE free rung per ladder is the concession; a second zero-usage warm turn in the
  // same ladder is charged, and the record says so rather than leaving the difference to be inferred.
  //
  // PROVISIONAL, and deliberately one line to change: the number below is a routed parameter (2026-08-22,
  // overwatch), not a measured optimum. Nobody has yet counted how often a second free rung would have
  // converted, and until someone does, 1 is the smallest concession that closes the defect.
  //
  // THE CHARGING BRANCH CANNOT FIRE TODAY, and that is stated rather than left to be discovered. `warm`
  // requires `!warmUsed` and `warmUsed` is set the moment one fires, so a ladder gets AT MOST ONE warm
  // turn — there can be no second zero-usage warm turn to charge. This counter is therefore defence, not
  // arithmetic anyone reaches: it keeps the bound LOCAL and explicit, so that if the one-warm-per-ladder
  // invariant is ever relaxed, the refund does not silently become unbounded along with it. Deriving the
  // bound from `warmUsed` instead would have coupled a rung policy to an unrelated rule and hidden the
  // dependency. The arms pin the invariant as the premise rather than pretending to exercise the branch.
  const WARM_ZERO_USAGE_FREE_RUNGS = 1;
  let rungsRefunded = 0;
  let timeoutRetriesUsed = 0;   // a slow stage gets ONE longer shot, then we stop (don't burn 3× the budget)
  let effTimeout = timeoutSec;  // bumped ×1.5 for the single timeout retry
  let lastQuantity = null;      //: the settled attempt's progress quantity (null = ABSENT, never zero)
  let lastReads = null;         // AD-4 reads gauge of the settled (last) attempt — rides the failure return
  let lastReadsTruncated = null; // …and whether that gauge was capped (a capped list is not a complete one)
  let lastWarm = null;          // …and whether that attempt was a WARM PATCH (a resumed session is not re-offered
                                // the files, so its gauge cannot ground a `read:false` — see journalStageInputs)
  let lastWrote = null;         // AD-4 emitted-vs-landed of the settled (last) attempt — rides the failure return
  let lastUnion = null;         // the last judgement's meaning-sweep counted state (syncDispositionForm's
                                // return). Written onto the attempt row for the journal AND read by the
                                // veto below — the run's own answer to "did this session rule any of
                                // its rows?", counted by the gate's own isRuled, never a token name
  let lastCoverageUnion = null; //: the same, for the register coverage form
  let lastPlacementUnion = null; //: the same, for the placement form — and it renders placements.json
  //: the seat-facing form the last judgement synced, measured at record time so the row carries the
  // bytes that were on disk when the attempt settled. At most one of the three fires per stage — a stage
  // owns one form or none — and the ?? chain is that fact, not a preference between them.
  //: the artifact the last refusal was actually ABOUT, when that is not the declared output. ONE
  // source — the same derivation that names the file in the token — so the row and the token can never
  // disagree about which artifact a ladder was fighting over. It persists across attempts on purpose:
  // the attempt that finally PASSES is the one whose sha proves what the ladder bought.
  let lastGraded = null;
  const gradedFormMeta = () => outputMeta(lastGraded);
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
    // D3: inter-attempt backoff (see retryBackoffMs) — a retry dispatched the same second it failed
    // tends to re-hit the same still-booting gateway / still-overloaded provider. Attempt 1 never waits.
    if (attempt > 1) {
      const backoff = retryBackoffMs();
      if (backoff > 0) { note(`[${name}] retry backoff ${backoff}ms before attempt ${attempt}`); await sleep(backoff); }
    }
    // Warm patch retry: resume the COMPLETED failed session with only the fix instruction (see design note
    // above warmEligible). Otherwise: fresh key + full corrective message (Fix B), exactly as before.
    // — the warm patch is VETOED, not de-allowlisted, and the veto keys on the DIRECT STATE:
    // the run's own counted rulings (lastUnion, counted by the gate's isRuled), never a failure-token
    // name. The connotation family stays in WARM_ELIGIBLE_RE because that allowlist decides two other
    // things: which file a repair is aimed at and whether a rejected draft may be carried across a
    // recovery park (draftCarryEligible). See vetoResumeRuledNone for the condition and its riders.
    //
    // `warmUsed` is NOT consumed here. A vetoed resume skips ITS warm patch and does not spend the
    // lane: if attempt 2 comes back with rows ruled (`call_partial` — a seat that has now recorded
    // rulings), attempt 3 can still warm, which is the case warm is good at.
    const vetoedResume = vetoResumeRuledNone(attempt, lastUnion);
    const warm = attempt > 1 && !warmUsed && process.env.CLEAROTRON_WARM_RETRY !== "0" && !vetoedResume && warmEligible(lastFail, lastJson);
    if (warm) warmUsed = true;
    else if (vetoedResume && !warmUsed && process.env.CLEAROTRON_WARM_RETRY !== "0" && warmEligible(lastFail, lastJson))
      note(`[${name}] attempt ${attempt - 1} left this stage's meaning population with ZERO ruled rows (${String(lastFail).slice(0, 100)}) — a resumed session re-reads its own output and cannot rule what it did not rule; SKIPPING the warm patch and dispatching attempt ${attempt} FRESH (the warm attempt is not spent: a partial failure later in this ladder still gets it)`);
    // Snapshot each expected artifact at THIS attempt's start. TWO readers, one base — so they can never
    // disagree about what this dispatch emitted:
    //   · AD-4 emitted-vs-landed telemetry — `wrote` says whether this dispatch WROTE its artifact, as
    //     distinct from the artifact merely EXISTING afterwards (landed — possibly inherited, possibly an
    //     earlier attempt's);
    //   · the exit-1 rescue below — freshness against THIS attempt's start, never the ladder's start
    //     (post-merge audit 2; the one-shot pre-ladder snapshot this replaces let attempt 1's kill-torn
    //     partial read as attempt 2's own fresh write).
    // Position is safe: nothing between here and the dispatch touches `files` (the methodology witness
    // writes only its own _driver sidecar).
    const preArtifact = new Map(files.map((f) => [f, statOf(f)]));
    const key = attempt === 1 ? sessionKey : warm ? lastKey : `${sessionKey}-rerun${attempt - 1}`;
    // — THE BASE, RECOMPOSED IF THE STAGE ASKED FOR IT. Only on the fresh-session arm: a WARM patch
    // resumes the session that already holds the full text, so re-presenting a shorter list there would
    // describe a context the seat is not in. A hard-wall kill is never warm — `warmEligible` requires
    // `json?.status === "ok"` and a killed turn has none — so the arm that matters is this one.
    //
    // NEVER-KILL: a refresh that throws costs the base, never the attempt. A stage that cannot recompute
    // its own text must still dispatch the text it started with.
    let base = message;
    if (!warm && typeof refreshMessage === "function") {
      try { const fresh = refreshMessage(attempt); if (typeof fresh === "string" && fresh) base = fresh; }
      catch (e) { note(`[${name}] refreshMessage failed on attempt ${attempt}, dispatching the original text: ${String(e?.message ?? e).slice(0, 120)}`); }
    }
    const effMessage = warm ? warmPatchMessage(lastFail, files, { supplementalLane }) : correctiveMessage(base, attempt, lastFail, files, { supplementalLane });
    note(`[${name}] attempt ${attempt}/${maxRetries + 1}${warm ? " [warm patch]" : ""} (engine=${engine.name} agent=${agent} model=${model ?? "default"} key=${key} timeout=${effTimeout}s)`);
    // The engine runs ONE turn and returns the normalized tuple. Every adapter returns the same shape
    // (zero change); anthropic-agent = claude -p off-gateway with the stall-watchdog. A warm retry threads
    // the prior attempt's sessionRef so the engine resumes the SAME session (anthropic: via
    // --resume <session_id>, keeping the prompt cache warm). usage is destructured so the
    // cost telemetry below AND the lane-wedge check (isLaneWedge) read the same value.
    // WITNESS the methodology this turn is about to read, immediately before it reads it — same resolver,
    // same message, so what is recorded is what the engine resolves and not a re-derivation that could
    // disagree. Recording only: it freezes nothing, gates nothing, and can never fail a turn (see
    // methodology-witness.mjs). Silent in the normal case; a line only when a document MOVED under a run.
    // — WHAT THIS TURN WAS TOLD, written BEFORE it is told it. A turn that is walled, stalled or
    // SIGKILLed is exactly the turn whose prompt someone will want, and a record written afterwards is
    // the record that is missing then.
    //
    // DEFAULT ON, via envGateOn — deliberately NOT the CLEAROTRON_DUMP_JSON pattern a few lines below, which
    // is default-off. A flag that has to be remembered before the interesting run will not be set on the
    // interesting run, which is the whole shape of this defect. The kill switch exists for one case: a
    // pool filesystem under pressure, where the house rule is already `df -h /` before an unattended run.
    //
    // It is the PRE-IMAGE, not the wire bytes: the engine localizes skill refs at spawn, and
    // _driver/methodology-read.json carries that resolution. Two records, two questions.
    const dispatch = envGateOn("CLEAROTRON_DISPATCH_RECORD")
      ? recordDispatch(runDir, name, {
        attempt,
        kind: warm ? "warm-patch" : followup ? "followup" : attempt === warmEscalatedAt ? "fresh-escalation" : vetoedResume ? "fresh-total-defect" : attempt > 1 ? "corrective" : "fresh",
        message: effMessage,
        // — THE RESOLVED GRANT, recorded beside the sha of the message it went out with. This is
        // the value handed to `engine.runTurn` below as `allowedTools`, not a re-derivation of it: a
        // second computation of what a stage was granted could disagree with what it WAS granted, and a
        // record that disagrees with the run is worse than no record. `undefined` here is a tool-free
        // judgment stage, which recordDispatch writes as an explicit `[]`.
        grant: gatherAllowedTools,
      })
      : null;
    for (const line of describeMethodologyDrift(witnessStageMethodology(runDir, name, effMessage, engineResolveSkill)))
      note(`[${name}] ${line}`);
    // — the frozen judged-by set, hashed into THIS PROCESS'S MEMORY before the seat runs. Never
    // written to disk before the comparison, so the thing being watched cannot reach it. See
    // run-integrity.mjs for why it is not a manifest file and why the append-only journals are excluded.
    const integrityBefore = frozenSnapshot(runDir);
    const turn = await engine.runTurn({ agent, sessionKey: key, message: effMessage, model, thinking, timeoutSec: effTimeout, resumeRef: warm ? lastSessionRef : undefined, codexHome: stageCodexHome, mcpConfig: gatherMcpConfig, allowedTools: gatherAllowedTools, seatWrites: gatherSeatWrites, skillsDir: engineSkillsDir, skillsGrantRoots: engineSkillsGrantRoots, profilesDir: profilesStoreDir, resolveSkill: engineResolveSkill, runDir, stallSec,
      progressFiles: files });   // the no-progress watchdog's artifact-advance signal (anthropic-agent; other adapters ignore it)
    const settledAt = Date.now();   //: zero point of the wall-rescue quiescence clock, read before anything else
    // LOG-ONLY. Nothing here can fail a turn: the claim that the frozen set does not change across a seat
    // turn is READ from the writers' call sites and not yet MEASURED on a running system, and arming an
    // unmeasured guard is the defect class this exists to catch. One run supplies the number; the row's
    // own `armed: false` says so to anyone who meets a "would-fault" verdict in the log.
    try {
      const drift = describeDrift(name, integrityBefore, frozenSnapshot(runDir));
      if (drift) runLog(runDir, drift);
    } catch { /* an integrity check that fails a run by failing itself is worse than no check */ }
    const { code, killed, wall, stderr, laneWaitMs, json, usage } = turn;

    // The artifact judgement, lifted out of the classification chain into ONE function so the
    // write-time form repair below can RE-JUDGE the corrected file with the same code — never with a
    // second, drifting copy of the contract. It returns the three facts that must always travel
    // together: the fail string, the validator's own stamped count, and WHICH file was
    // rejected (the repair aims at that file, and only that file's bytes decide whether it landed).
    const judgeArtifacts = () => {
      // — union the meaning-sweep form BEFORE judging it, on every judgement (see syncDispositionForm).
      // A ruling recorded on attempt 1 is therefore still recorded on attempt 3, and the outstanding count
      // cannot rise. Returns null for every stage that owns no meaning sweep, which is all but one.
      const u = syncDispositionForm(files);
      if (u) lastUnion = u;
      // — the same treatment for the register coverage form. A status recorded on attempt 1 is
      // still recorded on attempt 3, and the outstanding count cannot rise.
      const cu = syncCoverageForm(files);
      if (cu) lastCoverageUnion = cu;
      // — and the same for placement, which also RENDERS placements.json from the union. A tier
      // placed on attempt 1 is on disk, in the deliverable, before attempt 1 is allowed to finish.
      const pu = syncPlacementForm(files);
      if (pu) lastPlacementUnion = pu;
      for (const f of files) {
        if (!existsSync(f)) {
          // A TOOL-WRITTEN ARTIFACT IS ABSENT FOR ONE OF TWO REASONS, and they are not the same finding:
          // the seat never called its record tool, or it called and every call was REFUSED. The token was
          // the same for both, so a stage that met a defect, was told by name, and could not restate it
          // reported as a stage that produced nothing. Measured twice, on two different stages: the
          // writer's forbidden coverage form went from naming that defect to "produced nothing", and a
          // register unit whose band is missing went from `named_band_missing` to an absent note, because
          // its transport refuses a note over a band that does not exist. Both are a strictly earlier
          // catch reported as a strictly worse signature. The refusal journal is the transport's own
          // record of the second case; the LAST entry is the one the stage exhausted on. The token stays
          // `missing_file` — `contract-vocabulary` classifies by prefix and the repair ladder's routing
          // for this file is already the tool re-route — so this adds the cause without moving the class.
          //
          // THE READER TAKES (runDir, file) so both kinds of row can share one signature. A per-RUN
          // transport's reader ignores the second argument, which is what makes this forward-compatible;
          // a per-AXIS one needs it, because six units append in parallel and one shared journal would be
          // a record nobody can attribute.
          const refused = toolWrittenArtifact(f)?.refusals?.(runDir, f) ?? [];
          const last = refused.length ? String(refused[refused.length - 1]?.reason ?? "") : "";
          return { fail: `missing_file:${rel(f)}${last ? ` — every call refused, last: ${last}` : ""}`, quantity: null, file: f };
        }
        if (validate) {
          const v = validate(f, readFileSync(f, "utf8"));
          // — the token names THE ARTIFACT THE VALIDATOR GRADED, which for every form-bearing stage
          // is a sibling of the declared output, not the output itself. `common-law-findings.half-m.md`
          // was named on a refusal reading `form_untouched=79` over a 46-line file that holds no rows;
          // the 79 rows are in the disposition form, which the message never mentioned. `file:` stays the
          // stage's own output — that is the repair anchor and the ladder's byte-identity key, and both
          // are unchanged by naming the graded artifact in the string a human reads.
          if (!v.ok) {
            const g = gradedArtifact(v.reason, f);
            return { fail: `invalid_file:${rel(g)}:${v.reason}`, quantity: Number.isFinite(v.quantity) ? v.quantity : null, file: f, graded: g === f ? null : g };
          }
        }
      }
      return { fail: null, quantity: null, file: null, graded: null };
    };

    // ── corruption 3 — WHAT WAS ASKED FOR vs WHAT ACTUALLY RAN ─────────────────────────────────
    //
    // Until this landed, every model figure on every record was a pure function of the REQUESTED alias:
    // `resolveModel(model)` / `engine.resolveModelId(model)`, computed here without ever looking at the
    // provider's answer. So `--model gemini` logged `google/gemini-3.1-pro-preview` and ran sonnet (the
    // engine's alias table substituted, silently), a haiku stage that bounced to sonnet logged haiku,
    // and every attribution downstream — the A/B arm's manifest, tokens.mjs' per-model rollup, 's
    // billing classes — was keyed to a model that had not run. Patching the log would not have fixed
    // it; the log was already saying what the code believed.
    //
    // TWO FIELDS, NEVER COLLAPSED INTO ONE:
    //   modelUsed   — the requested resolution. Unchanged in meaning and unchanged in value, because
    //                 run-economics.mjs and tokens.mjs both read it and a field that quietly changes
    //                 what it means is its own corruption.
    //   modelActual — the id the WIRE reported (engine tuple `modelWire`), or NULL when the stream
    //                 never said: an engine that does not emit one (codex), a turn killed before any
    //                 event, a spawn error. It NEVER falls back to the requested alias.
    // `modelBasis` names which of the two the row can defend: "actual" or "unknown". There is no third
    // state in which a requested value is dressed as an observed one.
    const modelRequested = engine.resolveModelId ? engine.resolveModelId(model) : resolveModel(model);
    const modelActual = (typeof turn.modelWire === "string" && turn.modelWire) ? turn.modelWire : null;
    const modelBasis = modelActual ? "actual" : "unknown";
    if (modelActual) lastModelWire = modelActual;                       // — never overwritten with null
    // The comparison is by FAMILY (driver.config modelFamily), because `--model haiku` legitimately comes
    // back as `claude-haiku-4-5-20251001`. THREE-VALUED: null when either side names no family this
    // build recognises — an unknown is recorded as unknown and never as agreement.
    const famRequested = modelFamily(modelRequested), famActual = modelFamily(modelActual);
    const modelMismatch = (famRequested && famActual) ? famRequested !== famActual : null;

    let fail = null;
    let stampedQuantity = null;   //: a validator's own exact count, when it stamped one (see below)
    let failingFile = null;       //: the artifact the validator rejected — the repair's only target
    if (isTimeout({ killed, code, wall, stderr, timeoutSec: effTimeout })) fail = "timeout";
    else if (isEmbeddedFallback(json, stderr)) fail = "embedded_fallback";
    else if (code !== 0) fail = `nonzero_exit_${code}`;
    else if (!json) fail = "unparseable_json";
    else if (json.status !== "ok") fail = `status_${json.status}`;
    else {
      const j = judgeArtifacts();
      fail = j.fail; stampedQuantity = j.quantity; failingFile = j.file; lastGraded = j.graded ?? lastGraded;
    }

    // ── — WRITE-TIME FORM REJECTION, INSIDE THE DISPATCH ────────────────────────────────────
    // In the 08-02 round, 5 of 12 non-clean dispatches were PURE FORM: a bad enum, a closed-vocabulary
    // string twice, an undispatchable wildcard. Each burned a full paid dispatch — a fresh model call
    // and minutes of wall-clock — to discover something the contract already knew by name. The contract
    // is unchanged (see FORM_CLASS_RE); what moves is WHEN it is answered. A form defect is handed back
    // to the SAME session that wrote it, with the SAME warmPatchMessage the attempt-2 warm retry would
    // have carried, before this dispatch settles — so the retry ladder is never charged for it and its
    // attempts stay available for the failures that actually need another pass.
    //
    // WHAT THIS DELIBERATELY DOES NOT TOUCH — a work-class failure behaves exactly as it does today.
    // It is not form-class, so it never enters this loop; `warmUsed` is NOT consumed here, so a work
    // failure that reaches the ladder still gets its warm attempt 2 (the connotation tokens are
    // warm-eligible by an explicit 2026-08-01 ruling, and a form fix must not quietly revoke it).
    //
    // ZERO SEMANTICS — the three ways this could read an absence as a pass, and how each is closed:
    //   1. A repair turn that WRITES NOTHING. Re-judging byte-identical bytes would either "confirm"
    //      the same failure (harmless but wasteful) or, if the validator were ever non-deterministic,
    //      manufacture a pass out of the harness's own silence. So the TARGET file's stat is the gate:
    //      unchanged (or gone) ⇒ NOT repaired, the ORIGINAL fail stands, and the ladder gets it. The
    //      target is what the repair MESSAGE names (repairTarget) — usually a sibling, not the
    //      expectFile — because watching the wrong file turns a correct repair into a false "no-write".
    //   2. A repair turn that was KILLED. Its bytes may be torn mid-write and a shape validator cannot
    //      prove otherwise, so it is never re-judged, and its kill arms killSeen for the rest of the
    //      ladder — the same refusal the exit-1 rescue makes below.
    //   3. A form failure this list does not recognise. It never enters the loop at all and reaches the
    //      ladder as a work-class failure would — visibly, never swallowed as "validated fine".
    // Cancellation is honoured by SKIPPING the repair (the turn is the unit of spend): the loop top
    // above throws RunCancelled on the next attempt, so no new throw site is introduced here.
    let formRepairsThisAttempt = 0;
    let repairRef = turn.sessionRef;
    while (fail && failingFile && isFormClassFail(fail)
           && formRepairsUsed < MAX_FORM_REPAIRS
           && envGateOn("CLEAROTRON_FORM_REPAIR")
           // A6: an output-ceiling turn's defect is caused by the budget, not by the vocabulary — it
           // keeps its named fault and its own policy below.
           && json?.stopReason !== "max_tokens"
           && !isCancelled(runDir)) {
      formRepairsUsed++; formRepairsThisAttempt++;
      const triggeredBy = fail;
      // THE FILE THE REPAIR MESSAGE ACTUALLY AIMS AT — not necessarily the rejected expectFile. Every
      // framediff_/coverage_ token routes its repair to a SIBLING (frame-diff.json,
      // register-coverage-ledger.json) and tells the model NOT to touch the .md, so watching the .md
      // would read a compliant model's correct answer as "wrote nothing". repairTarget is the same
      // derivation warmPatchMessage uses to compose the instruction — one rule, two readers.
      const target = repairTarget(triggeredBy, files);
      const targetPre = statOf(target);
      const repairPre = new Map(files.map((f) => [f, statOf(f)]));
      note(`[${name}] FORM defect at write time (${triggeredBy.slice(0, 140)}) — repairing INSIDE this dispatch (${formRepairsUsed}/${MAX_FORM_REPAIRS}) at ${rel(target)}; the retry ladder is not charged`);
      //: a form repair is a real model invocation, so it gets its own record rather than hiding
      // inside the attempt it belongs to. Hoisted only to be recordable — the message is unchanged.
      const repairMessage = warmPatchMessage(triggeredBy, files, { supplementalLane });
      const repairDispatch = envGateOn("CLEAROTRON_DISPATCH_RECORD")
        ? recordDispatch(runDir, name, { attempt, repair: formRepairsUsed + 1, kind: "form-repair", message: repairMessage })
        : null;
      // — `seatWrites` IS DELIBERATELY NOT PASSED HERE, and the omission is the decision. A form
      // repair exists precisely because a file came out malformed and the seat is being told to go fix
      // it at `target`, so this turn authors a file whatever the stage's steady-state row says. Omitting
      // the declaration leaves it `null` — unknown — and unknown keeps the grant, which is the answer
      // this turn wants. Passing `gatherSeatWrites` would lean on the dispatch naming an ABSOLUTE path
      // under the run dir to win the grant back, and warmPatchMessage renders the target through rel();
      // a relative path there would silently strip the write root off the one turn that needs it most.
      const rt = await engine.runTurn({ agent, sessionKey: key, message: repairMessage, model, thinking,
        timeoutSec: effTimeout, resumeRef: repairRef, codexHome: stageCodexHome, mcpConfig: gatherMcpConfig, allowedTools: gatherAllowedTools,
        skillsDir: engineSkillsDir, skillsGrantRoots: engineSkillsGrantRoots, profilesDir: profilesStoreDir, resolveSkill: engineResolveSkill, runDir, stallSec,
        progressFiles: files });
      repairRef = rt.sessionRef ?? repairRef;
      // A KILLED REPAIR TURN'S BYTES ARE NOT STAGE TRUTH. Same doctrine as the exit-1 rescue below: a
      // stage validator is a SHAPE check, not a completeness proof, and a torn draft can pass its own
      // validator — so a repair turn that was killed (or exited nonzero, or came back with a non-ok
      // envelope) never gets re-judged. Its kill also ARMS killSeen, which closes the exit-1 rescue for
      // the rest of this ladder exactly as an attempt's kill would.
      const repairKill = isTaintRow({ fail: null, code: rt.code, killed: rt.killed, signals: rt.signals });
      if (repairKill) killSeen = true;
      const repairSettled = !repairKill && rt.code === 0 && rt.json?.status === "ok";
      // Did the TARGET file change and still exist? That, and nothing else, decides whether a repair
      // happened. Deleting it is not a repair either.
      const nowStat = statOf(target);
      const landed = repairSettled && nowStat !== null && nowStat !== targetPre;
      let outcome;
      if (!repairSettled) {
        outcome = repairKill ? "killed" : "unsettled";
      } else if (!landed) {
        outcome = "no-write";
      } else {
        const j = judgeArtifacts();
        if (j.fail === triggeredBy) outcome = "unchanged";      // wrote, reproduced its own failure byte-for-byte
        else { fail = j.fail; stampedQuantity = j.quantity; failingFile = j.file; lastGraded = j.graded ?? lastGraded; outcome = fail ? "moved" : "repaired"; }
      }
      if (runDir) {
        // A repair turn is a real model invocation and is journalled as one — same {model, usage}
        // shape every dispatch row carries, so tokens.mjs and run-economics.mjs count its spend
        // honestly. It is NOT an attempt row: `repair` names the row's class, and its `fail` is the
        // defect this turn was dispatched to FIX, never the attempt's settled outcome. Written BEFORE
        // the attempt row below, which is both chronologically true and what keeps the attempt row the
        // last line of the stage's telemetry (compare.mjs reads exactly that line).
        stageLog(runDir, name, {
          attempt, key, agent, model,
          modelUsed: (lastModelUsed = engine.resolveModelId ? engine.resolveModelId(model) : resolveModel(model)),
          // Same billing stamp as the attempt row, written on the same terms — see the note there.
          engine: engine.name, writeBoundary: writeBoundaryOf(engine), authMode: auth.mode, apiBilled: auth.apiBilled === true,
          code: rt.code, wall: rt.wall, timeoutSec: effTimeout,
          // — same rename as the attempt row above. This row already carries the driver's verdict as
          // `repairOutcome` (only "repaired" is success), so it needs no `ok`; what it lacked was any mark
          // that the engine had claimed otherwise.
          engineStatus: rt.json?.status,
          repair: formRepairsUsed, repairOf: MAX_FORM_REPAIRS, repairOutcome: outcome, fail: triggeredBy,
          repairTarget: rel(target),   // the file the repair was AIMED at (often a sibling, not the expectFile)
          dispatch: repairDispatch,    // — the verbatim message this repair turn was given
          stopReason: rt.json?.stopReason ?? undefined,
          killed: rt.killed || undefined, signals: rt.signals ?? undefined,
          warm: true,   // a repair turn always RESUMES the session that wrote the defect
          runId: rt.json?.runId, engineSummary: rt.json?.summary, usage: rt.usage,
          selfReportContradicted: (outcome !== "repaired" && rt.json?.status === "ok") || undefined,   //
          // — a repair turn is a real model invocation and run-economics counts it as a dispatch.
          // Skipping it here would leave retry-waste rows as the only dispatches with no rate.
          tokensPerSec: tokensPerSec(rt.usage, rt.wall),
          output: files.length ? outputMeta(files[0]) : null,
          form: gradedFormMeta() ?? undefined,   // — see the attempt row
          // `wrote` keeps its house meaning (did THIS turn move ANY expected artifact); `repairLanded`
          // is the narrower fact the decision above was actually made on.
          //
          // NULL WHEN THERE IS NOTHING EXPECTED, EXACTLY AS THE ATTEMPT ROW DOES IT. A stage
          // declaring no expected artifact leaves `files` empty, and `[].some()` is `false` — so this row
          // used to answer "this turn wrote nothing" where the attempt row answers "there was nothing to
          // write". Two producers of one field, two units for the empty case, and the reader is
          // `run-economics.mjs`: `if (rec.wrote === false) st.emittedOnDispatchesThatWroteNothing +=
          // cls.output`. Every repair turn on such a stage billed its whole output to a waste counter.
          // The `output:` line above already guards the same emptiness on the same row.
          wrote: files.length ? files.some((f) => statOf(f) !== repairPre.get(f)) : null,
          repairLanded: landed,
          reads: Array.isArray(rt.reads) ? rt.reads : null,
          readsTruncated: Array.isArray(rt.reads) ? rt.readsTruncated === true : null,
          stderrTail: streamDigest(rt.stderr),
        });
        try {
          runLog(runDir, {
            event: "form-repair", stage: name, attempt, repair: formRepairsUsed, of: MAX_FORM_REPAIRS,
            fail: triggeredBy, outcome, landed, ok: outcome === "repaired",
            model: engine.resolveModelId ? engine.resolveModelId(model) : resolveModel(model),
          });
        } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
      }
      note(`[${name}] in-dispatch form repair ${formRepairsUsed}: ${outcome}${outcome === "moved" ? ` → ${String(fail).slice(0, 140)}` : ""}`);
      // Every stop below means "another repair turn cannot converge, or must not be trusted": the turn
      // did not settle cleanly, it wrote nothing, or it reproduced its own failure byte-for-byte (the A4
      // doctrine, applied inside the dispatch). In all three the ORIGINAL fail goes to the ladder.
      if (outcome !== "moved") break;
    }
    // Exit-1 adapter truth (charter P1 §2): the claude CLI reports a provider error on the FINAL assistant
    // message (an HTTP 500 after the work was done) as subtype:"success" + is_error:true, which the adapter
    // rightly converts to a nonzero exit — but by then the turn's Write already landed the artifact, and
    // re-running finished work burned ~35 min on the R-round evidence run. So before a nonzero exit is
    // accepted as failure, judge the ARTIFACT exactly as the skip path does (exists + validates), with one
    // extra requirement the skip path doesn't need: the file must have been WRITTEN by THIS ATTEMPT
    // (differs from the attempt-start snapshot) — an inherited/stale file, and equally an EARLIER
    // ATTEMPT's file, never rescues a failed turn.
    //
    // A KILL ANYWHERE IN THIS LADDER CLOSES THE RESCUE (post-merge audit 2, 2026-07-31). The design
    // always said the rescue "never applies to a kill — a cut-down turn's artifact may be mid-write";
    // testing only the CURRENT attempt's `killed` honoured that one attempt at a time, so attempt 1 =
    // kill that wrote a torn partial + attempt 2 = nonzero exit shipped the partial as stage truth.
    // Both legs of the fix are needed, because they refuse different things:
    //   · the per-attempt snapshot refuses an EARLIER attempt's bytes outright;
    //   · `killSeen` refuses this attempt's own write once a kill has torn the file underneath it —
    //     freshness is `stat differs`, i.e. a MUTATION, never a proof of complete rewrite (a patch, an
    //     append, or a Write killed mid-flush all satisfy it), and a stage `validate` is a SHAPE check,
    //     not a completeness proof: the audit repro is a torn draft that passes its own validator.
    // Only register stages carry a backstop for this (register-taint.mjs, on these very rows);
    // synthesis / narrative / cards / digest have none, and synthesis is where the evidence run took its
    // 137 hard-wall kill. This does NOT touch the plain retry ladder register-taint's corpus audit found
    // benign (kill → fresh full redo that EXITS CLEAN): that turn reports completion and is gated on its
    // final state by the normal success path above. The rescue is the opposite case by construction — the
    // turn did not report completion, and completeness of its write is exactly what is unknown.
    // Still never applies to a rate-limit rejection either (0 tokens, nothing written).
    const killClass = isTaintRow({ fail, code, killed, signals: turn.signals });
    // ONE artifact judgement, shared by both rescues below ('s rule: never a second, drifting copy of
    // the contract). Present + written by THIS attempt (the per-attempt snapshot — an inherited file and
    // equally an earlier attempt's file never rescue a failed turn) + passes the stage's own validator.
    const attemptWroteTruth = () => {
      // — the rescues judge with `validate` directly rather than through judgeArtifacts, so the union
      // has to run here too or a rescued turn would be refused for rows the form already holds. Idempotent,
      // so the double call on the normal path costs a regeneration and changes nothing.
      const u = syncDispositionForm(files);
      if (u) lastUnion = u;
      const cu = syncCoverageForm(files);          //, same reason
      if (cu) lastCoverageUnion = cu;
      // — and placement. THIS CALL IS THE R1 CURE: the wall rescue asks whether this attempt wrote
      // a valid artifact, and until the union has run and placements.json has been rendered from it, the
      // answer for a killed-in-the-gap attempt is no. Idempotent, so the double call costs a regeneration.
      const pu = syncPlacementForm(files);
      if (pu) lastPlacementUnion = pu;
      return files.every((f) => {
        const now = statOf(f);
        if (now === null || now === preArtifact.get(f)) return false;   // absent, or not written by this attempt
        if (validate) { const v = validate(f, readFileSync(f, "utf8")); if (!v.ok) return false; }
        return true;
      });
    };
    let rescued = null;
    let quiescentMs = null;   //: how long the artifact had been untouched when the turn settled
    let rescueRefused = null; //: WHICH of the rescue's three causes refused — on the row, not only in a note
    if (fail && /^nonzero_exit_/.test(fail) && files.length) {
      if (killClass || killSeen) {
        note(`[${name}] ${fail} with a kill-class attempt in this ladder — the exit-1 rescue stays CLOSED (a killed turn's artifact may be torn mid-write and a validator cannot prove it whole); failing honestly instead`);
      } else if (attemptWroteTruth()) {
        rescued = fail;
        fail = null;
        note(`[${name}] ${rescued} but every expected artifact is present, fresh and valid — accepting the artifact as stage truth (a final-message provider error must not re-run finished work)`);
      }
    }
    // ── — THE WALL RESCUE ────────────────────────────────────────────────────────────────────
    //
    // A stage SIGKILLed at its hard wall AFTER it had already written a complete, valid artifact is a
    // stage that SUCCEEDED. Measured on R1 2026-08-04: placement-inquiry walled twice (1861s/1800s and
    // 2760s/2700s, both `wrote: true`, the second `noChange: true`), parked the run — and the resume two
    // minutes later SKIPPED it, because pipeline.mjs's skip predicate found the artifact present and
    // passing its own validator. 77 minutes of dispatch, 335,782 output tokens and one park out of a
    // budget of three, all spent after the deliverable was finished.
    //
    // WHY THIS MAY DO WHAT THE EXIT-1 RESCUE ABOVE MUST NOT. That refusal is not wrong and is not being
    // reversed: post-merge audit 2 pinned a torn draft that CLEARS its own shape validator, and
    // `stat differs` is a mutation, never a proof of complete rewrite. What this arm adds is the one
    // fact neither has — QUIESCENCE. The torn-write window is [watchdog decision, child death]: a poll
    // tick plus the SIGTERM→SIGKILL escalation, single-digit seconds. An artifact that had been
    // untouched for a full minute when the turn settled was not being written when the turn was killed.
    // On the incident the margin was 974 seconds. On the audit's repro it is zero, which is why that
    // fixture still fails exactly as it did.
    //
    // AND IT ADMITS NOTHING THE RESUME WOULD REFUSE. The skip predicate accepts these same bytes minutes
    // later on the same disk; this only stops the run paying a second wall, a park and a resume to reach
    // the same answer. The resume's `!freshness.stale` arm is deliberately NOT copied: it compares
    // declared inputs against a stamp written only on success, so at kill time it is not merely
    // unnecessary but meaningless — and the stage cannot be stale against inputs it has just this moment
    // read and acted on.
    //
    // A stage with no validator, or whose artifact fails it, or which never wrote, is untouched.
    else if (fail === "timeout" && turn.signals?.hardWall && files.length && validate && wallRescueEnabled()) {
      // — `unreadable` is tracked as its own fact rather than inferred from the -1 sentinel. The
      // sentinel is not the only way this goes negative: an artifact written in the same instant the turn
      // settled yields a small NEGATIVE elapsed, and the refusal message read that as "artifact
      // unreadable" — a diagnosis about the filesystem for a file that was perfectly readable and simply
      // still being written. That is the under-quiescence case, and it is now named as one.
      let unreadable = false;
      const quiet = files.map((f) => { try { return settledAt - statSync(f).mtimeMs; } catch { unreadable = true; return -1; } });
      quiescentMs = quiet.length ? Math.min(...quiet) : null;
      const bar = wallRescueQuiesceMs();
      if (quiescentMs >= bar && attemptWroteTruth()) {
        rescued = fail;
        fail = null;
        note(`[${name}] hard-wall kill at ${Math.round(wall)}s, but every expected artifact was written by this attempt, passes its validator and had been untouched for ${Math.round(quiescentMs / 1000)}s when the turn settled — the stage FINISHED and the wall is a fact about the dispatch, not a failure of the stage (the resume's skip path would accept these same bytes)`);
      } else {
        // Said out loud, because "the rescue considered it and refused" and "the rescue never looked"
        // must not be the same silence. This is the file that reads an absence as a diagnosis otherwise.
        //
        // — AND SAID ON THE ROW, not only in a note. The note goes to the operator's console; the
        // JOURNAL is what a later round reads, and `rescued: null` reads identically for all three
        // refusal causes. Measured on the 2026-08-09 R1: placement-inquiry was killed at its
        // hard wall having WRITTEN its artifact and lain quiescent for 371 s against a 60 s bar — so the
        // rescue was refused on the third cause, its validator — and 31 minutes of finished work were
        // discarded and re-run cold. `grep -c rescue run.jsonl` on that run returns 0. Nothing in the
        // record said why, and reconstructing it took a file-mtime comparison against a preserved run dir.
        rescueRefused = unreadable ? "artifact-unreadable"
          : quiescentMs < bar ? "under-quiescence"
          : "not-written-by-this-attempt-or-invalid";
        note(`[${name}] hard-wall kill at ${Math.round(wall)}s — wall rescue REFUSED (${unreadable ? "artifact unreadable" : quiescentMs < bar ? `artifact touched ${Math.round(quiescentMs / 1000)}s before the kill, under the ${Math.round(bar / 1000)}s quiescence bar` : "not written by this attempt, or fails its validator"}); failing honestly as timeout`);
      }
    }
    // Arm the ladder-wide refusal for every LATER attempt. Read before `classifyWedge` below only because
    // the rescue above needs it; the two can never disagree in reach — isTaintRow excludes lane_wedge, and
    // a wedge is a `timeout` fail that breaks the ladder immediately, so no later attempt exists to judge.
    if (killClass) killSeen = true;
    // Lane-wedge reclassification (see isLaneWedge): a 0-token timeout is a saturated command lane, not a slow
    // model. Becoming `lane_wedge` makes the retry policy skip the wasteful extended shot; the chain (pipeline.mjs)
    // cascades providers on it and retries the whole chain if EVERY provider wedges (a shared lane is not
    // provider-specific). teal-bastion 2026-06-15.
    // See classifyWedge: a 0-token timeout is a saturated-lane wedge UNLESS it's a hard-wall over-budget kill.
    fail = classifyWedge(fail, usage, turn.signals);
    // D3: an Anthropic 529/overload hides inside the generic transport tokens (nonzero_exit_1 through
    // claude -p) — reclassify to status_overloaded so it stops the same-model ladder below and rides the
    // chain cascade / recovery park instead. Only the transport shapes are eligible: a timeout/wedge has
    // its own policy, and a content failure must never be laundered into a transient by a stray match.
    if (fail && /^(nonzero_exit_|status_error$|unparseable_json$)/.test(fail) && isOverloaded({ json, stdout: turn.stdout, stderr })) fail = "status_overloaded";
    // Rate-limit / session-cap (429): the standalone engine maps EVERY tier to the one Claude subscription, so
    // the fallback cascade is futile — classify distinctly (NOT in FALLBACK_ELIGIBLE) and carry resetsAt so the
    // pipeline POSTPONES the run to resetsAt instead of failing it. (Overrides the nonzero_exit_1 a 429 shows as.)
    // Guarded on `fail`: a turn whose finished, validated artifact was just accepted (the exit-1 rescue above)
    // stays accepted — the NEXT stage's first turn hits the same cap at 0 tokens spent and postpones cleanly.
    if (turn.signals?.rateLimited && fail) fail = "rate_limited";
    // A6 (addendum 2026-07-30): stop_reason max_tokens with ZERO usable output is a DETECTED FAULT with a
    // name — never a silent paid retry. The turn ran to its output-token ceiling and the artifact never
    // landed (a content fail on a "successful" turn), or the turn itself died at the ceiling (transport
    // shapes) — either way the CAUSE is the output budget, and an unnamed retry just re-buys the same
    // wall. Naming it here makes the stage-log row carry the fault (counted per attempt), routes
    // correctiveMessage to the shrink-your-output correction, and arms the A4 identical-signature break
    // on a second identical hit. The content detail stays appended (hint derivation and the
    // coverage-quarantine joins still read it); the transport shapes go BARE — their tokens
    // (nonzero_exit / unparseable_json) read as TRANSIENT to the run-level classifier (repairs.mjs
    // TRANSIENT_RE is substring-matched) and would silently re-arm the full recovery ladder for a
    // deterministic ceiling fault. Never fires on a rescued turn (fail is already null) nor on the
    // kill/wedge/overload/rate-limit classes (each keeps its own policy).
    if (fail && json?.stopReason === "max_tokens" && /^(missing_file:|invalid_file:|nonzero_exit_|status_error$|unparseable_json$)/.test(fail)) {
      const named = /^(missing_file:|invalid_file:)/.test(fail) ? `max_tokens_no_output:${fail}` : "max_tokens_no_output";
      note(`[${name}] DETECTED FAULT: stop_reason=max_tokens with no usable output (${fail}) → ${named}`);
      fail = named;
    }

    // corruption 3, THE ENFORCEMENT — a turn that ran a different model than it was told to is a
    // FAILED turn, not a successful one with an interesting note. Everything the stage produced is
    // attributed to the wrong model, so accepting it would put the corruption on the record permanently
    // (the artifact lands, the row says haiku, sonnet wrote it).
    //
    // Deliberately scoped to `!fail`: a turn that already failed keeps its own cause, because `timeout`
    // and `rate_limited` drive retry policies this must not override. `modelMismatch` is journalled on
    // the row either way, so the mismatch is never lost — only the classification defers.
    //
    // Default-ON gate through `envGateOn` ('s rule): `CLEAROTRON_MODEL_WIRE_CHECK=0` disarms it without
    // a deploy if a provider ever starts reporting an id this build's family regex misreads. Disarming
    // silences the REFUSAL, never the record — `modelActual`/`modelMismatch` keep landing on every row.
    if (modelMismatch === true && !fail && envGateOn("CLEAROTRON_MODEL_WIRE_CHECK")) {
      fail = `model_mismatch:${famRequested}->${famActual}`;
      note(`[${name}] MODEL MISMATCH: asked for ${modelRequested} (${famRequested}), the wire says ${modelActual} (${famActual}) — failing the turn. An unhonoured model override is an error, not a substitution (#238); every number attributed to this turn would name the wrong model.`);
    }

    // AD-4 house rule — both computed UNCONDITIONALLY, three-valued on purpose:
    //   wrote: did THIS attempt move any expected artifact? true/false when the stage has expected files,
    //          null when it has none (nothing to emit — distinct from "did not write").
    //   reads: the turn's reads gauge; [] = ran and read nothing, null = this engine cannot observe reads.
    //   readsTruncated: whether that list is COMPLETE. An engine that caps its gauge (anthropic-agent stops
    //          at 500 distinct paths) hands back a list that reads as exhaustive when it is a prefix — so a
    //          `read:false` derived from it would be manufactured. null when there is no gauge to truncate.
    //   warm: whether THIS attempt was a warm patch. A warm patch resumes the failed session with only the
    //          fix instruction — the declared inputs are not re-offered, so the turn opening nothing is the
    //          normal warm-resume shape, not evidence it ignored them. Journalled on the attempt row already;
    //          it rides the return tuple so the stage row's `read` flags can honour it (post-merge audit N1).
    // `wrote` and the exit-1 rescue's freshness test read the SAME per-attempt snapshot (preArtifact), so a
    // rescued row can never carry wrote:false, and a failed row's wrote:true is the mid-write/taint shape.
    const wrote = files.length ? files.some((f) => statOf(f) !== preArtifact.get(f)) : null;
    const reads = Array.isArray(turn.reads) ? turn.reads : null;
    const readsTruncated = reads === null ? null : turn.readsTruncated === true;
    lastWrote = wrote;
    lastReads = reads;
    lastReadsTruncated = readsTruncated;
    lastWarm = warm;

    // — the convergence ledger. Two facts the attempt row never carried:
    //   quantity: how many of the thing are STILL wrong ("9 meaning receipts undisposed"), as a NUMBER,
    //     taken from the UNTRUNCATED fail string — the validator's own count where it stamped one, the
    //     allowlisted text extraction otherwise (repairs.mjs progressQuantity). null = this failure
    //     carries no progress quantity; NEVER 0, which would read as "nothing left" — i.e. as a PASS.
    //     Written unconditionally, three-valued like `wrote` and `reads`: on a successful attempt and on
    //     a quantity-less failure alike the row SAYS null rather than staying silent.
    //   noChange: this attempt's failure is byte-identical to the previous attempt's. The ladder already
    //     stops on that for the content classes (the A4 break below) — but it can only know it AFTER
    //     paying for the attempt, and nothing recorded that the attempt bought a repeat rather than a
    //     fresh result. The flag is recorded for EVERY class, wider than the break it names, because a
    //     record of what happened is not the policy about what to do with it.
    // RECORDING ONLY: no break/park/terminate decision reads either field ( owns that policy).
    const quantity = fail ? (stampedQuantity ?? progressQuantity(fail)?.value ?? null) : null;
    const noChange = Boolean(fail) && attemptFails[attemptFails.length - 1] === fail;

    // ── — PRESERVE THE BEST REJECTED DRAFT ─────────────────────────────────────────────────
    // RECORDING ONLY, like `quantity` and `noChange` beside it: nothing here breaks, parks or terminates,
    // and what the machinery DOES with a preserved draft is pipeline.mjs's decision. Without this, a
    // recovery park re-commissions the stage cold and the convergence it parked to protect is gone — the
    // halves that reached 1 and 2 violations restarted at 21 and 13.
    // Three refusals, each closing a way this could quietly certify a bad document as the floor:
    //   · a KILL-CLASS attempt (killClass || killSeen) is never preserved — the same refusal the exit-1
    //     rescue makes above and for the same reason: `wrote` is a MUTATION, not a proof of a complete
    //     rewrite, and a stage validate is a SHAPE check. A kill-torn artifact is not a base to patch.
    //   · `wrote !== true` — an inherited file, or an earlier attempt's, is not THIS attempt's work.
    //   · a non-finite quantity never wins (best-draft.beatsBest) — ABSENT IS NOT ZERO.
    if (runDir && fail && wrote === true && !killClass && !killSeen && draftCarryEligible(fail)) {
      const target = failingFile ?? files[0] ?? null;
      if (target && recordBestDraft(runDir, name, target, { quantity, fail, attempt, key }))
        note(`[${name}] attempt ${attempt} rejected at count ${quantity} — preserved as the best draft so far (the next dispatch continues it rather than restarting)`);
    }

    if (runDir) {
      // — THIS COMMENT USED TO SAY the `usage` extraction "has only ever logged null" and that the
      // envelope shape was "unconfirmed". Both halves are false and have been for a long time, which is
      // how a stale build-stage note came to describe a live field as dead. Measured on preserved runs
      // whose engine commit is byte-identical to this file: the R5 register-unit attempt row of 08-12
      // carries {input:8349, output:18374, cacheRead:1805815, cacheWrite:96608, total:1929146}. Every
      // figure in 's own table is a verbatim read of these rows — the issue was minted BY reading
      // the field this comment called null. The shape is `mapUsage`'s canonical
      // {input, output, cacheRead, cacheWrite, total}, written by both engines
      // (anthropic-agent.mjs mapUsage, openai-agent.mjs from turn.completed).
      //
      // CLEAROTRON_DUMP_JSON stays, but as what it now is: a raw-envelope capture for reading a field this
      // extraction does not map, not an open probe waiting for an answer it already has.
      if (envOn("CLEAROTRON_DUMP_JSON") && json) {
        try { writeFileSync(driverDir(runDir, `${name}.attempt${attempt}.rawjson.json`), JSON.stringify(json, null, 2)); } catch { /* best-effort */ }
      }
      // Telemetry is TOKENS ONLY (owner directive 2026-07-11): the attempt row carries the raw `usage`
      // counts and no driver-computed currency — the per-engine cost policy (costUsd/pricedModel) and the
      // price table it read are gone. Raw provider output (e.g. a CLEAROTRON_DUMP_JSON capture) is untouched.
      stageLog(runDir, name, {
        attempt, key, agent, model,
        // engine-aware provenance: the GPT id on an openai run, the anthropic-catalog id on an anthropic
        // run. STILL THE REQUESTED RESOLUTION — unchanged in meaning so run-economics.mjs and tokens.mjs
        // keep reading exactly what they have always read.
        modelUsed: modelRequested,
        // corruption 3 — the wire's own answer, beside it. Three-valued and written UNCONDITIONALLY:
        //   modelActual   — the id the provider reported, or null when the stream never said one.
        //   modelBasis    — "actual" | "unknown". Never "requested-dressed-as-actual".
        //   modelMismatch — true/false when both sides name a family, null when either does not.
        // Written even on the rows where they are null, so "this engine cannot report" stays visibly
        // different from "this record predates the gauge".
        modelActual, modelBasis, modelMismatch,
        // W3 billing telemetry: which engine ran + the RESOLVED billing mode (subscription vs api-key). This
        // records INTENT (the mode the engine was configured to bill under), not independent billing evidence
        // — the actual proof is the provider console (claude's stream also reports apiKeySource; codex does
        // not). The value's job here is to make a silent mode-mismatch impossible to miss after the fact.
        //
        // — `apiBilled` IS WRITTEN EVEN WHEN FALSE, and it read `|| undefined` until now, which
        // elided exactly the value a subscription run has. The cost was measured rather than argued: a
        // sweep of every archived August run looking for this stamp found it nowhere, and the CONTROL
        // showed no run carried one at all — so the absence could not say whether API mode had ever been
        // used, and the question had to be left open. That is the house rule two files over, in the wild:
        // "every telemetry field is written unconditionally, so 'did not happen' stays distinguishable
        // from 'not recorded'" (instrumentation-house-rule.test.mjs). A run must be able to STATE that it
        // billed subscription, not merely fail to state that it billed API.
        engine: engine.name, writeBoundary: writeBoundaryOf(engine), authMode: auth.mode, apiBilled: auth.apiBilled === true,
        // build 2 — THIS attempt is the fresh dispatch bought by discarding a warm session that
        // reproduced its own failure. Exact, not cumulative: a `warmEscalatedAt > 0` test would mark
        // every later attempt too the moment the ladder is deepened, and the row would stop meaning
        // one dispatch.
        warmEscalated: attempt === warmEscalatedAt || undefined,
        code, wall, timeoutSec: effTimeout, fail,
        // — THE DRIVER'S OWN VERDICT ON THIS ATTEMPT: the same `ok!fail` the run.jsonl spine has
        // carried since AD-4, which this row never had. Its headline was `status`/`summary`, both echoed
        // verbatim from the ENGINE's envelope — they answer "did the CLI turn complete", never "did this
        // attempt produce what the stage exists to produce". Sixty report-card attempts on round 892dd88e
        // journalled status:"ok", summary:"success", code:0, wrote:true and output.present:true beside a
        // populated `fail`, and a watcher keyed on the headline saw sixty successes.
        ok: !fail,
        // The engine's claim about itself, KEPT and renamed to say whose claim it is. A self-report is
        // evidence — deleting it would destroy the only record of what the seat believed it had done — and
        // it is not a verdict. Still three-valued (ok | timeout | error). Nothing in the driver reads either
        // field (measured across driver/, scripts/ and mcp-server/), so the rename costs no consumer, and
        // archived rows keep `status`/`summary` meaning exactly what they meant when they were written.
        engineStatus: json?.status,
        // TRUE exactly when the engine said the turn completed and the driver failed the attempt anyway.
        // BOTH filed shapes are this one: wrote:false with the artifact never written, and wrote:true with
        // the artifact written and rejected. A check keyed on `wrote` alone sees only the first.
        selfReportContradicted: (fail && json?.status === "ok") || undefined,
        // convergence ledger (see the computation above): the progress quantity as a number —
        // null means ABSENT, never zero — and whether this attempt reproduced its predecessor exactly.
        quantity, noChange: noChange || undefined,
        // — what the meaning-sweep union held after this attempt was judged. `carried` is the number
        // of rows whose ruling came from a PREVIOUS attempt, i.e. exactly the work a cold re-dispatch used
        // to destroy. Absent on every stage that owns no meaning sweep. RECORDING ONLY.
        // — `parked` rides here too. RECORDING ONLY, so this one is diagnostics rather than a
        // client surface — but it is the trail the NEXT round reads to ask what a run actually did, and a
        // trail that omits the parks describes a run that decided everything.
        dispositions: lastUnion ? { countable: lastUnion.countable, ruled: lastUnion.ruled, outstanding: lastUnion.outstanding, parked: lastUnion.parked, total: lastUnion.total } : undefined,
        // — the same field for the register coverage form. Absent on every stage that owns no
        // coverage form, and on any run whose plan apparatus is out of reach. RECORDING ONLY.
        coverage: lastCoverageUnion ? { settled: lastCoverageUnion.settled, outstanding: lastCoverageUnion.outstanding, carried: lastCoverageUnion.carried, total: lastCoverageUnion.total } : undefined,
        // — the placement form's own row. `carried` is the measurement the issue asks for: tiers a
        // previous attempt placed that this one did not re-submit, i.e. exactly what the R1 discard
        // destroyed. `unresolved` counts selections the fold does not hold. RECORDING ONLY.
        placements: lastPlacementUnion ? { settled: lastPlacementUnion.settled, outstanding: lastPlacementUnion.outstanding,
          carried: lastPlacementUnion.carried, total: lastPlacementUnion.total, seatRows: lastPlacementUnion.seat_rows,
          unresolved: lastPlacementUnion.unresolved, rendered: lastPlacementUnion.rendered } : undefined,
        //: how many in-dispatch form repairs THIS attempt bought (absent = none). Its own rows
        // sit immediately above with the defect each one was dispatched to fix.
        formRepairs: formRepairsThisAttempt || undefined,
        laneWaitMs,   // WS-C turn-cap queue time — the live overlap validation reads this
        // A6: the provider's stop reason, verbatim — the max_tokens fault line is countable from the
        // rows alone (fail carries the named fault; this field carries the raw discriminator).
        stopReason: json?.stopReason ?? undefined,
        // taint durability (copper-lattice): the kill discriminators survive to disk — register-taint.mjs
        // reads these rows across process restarts (--resume), where the in-memory turn object is gone.
        // `followup` matters too: a followup success PATCHES the prior session's output, it never
        // supersedes a taint the way a fresh full pass does.
        killed: killed || undefined,
        signals: turn.signals ?? undefined,
        //: how long every declared artifact had been untouched when the turn settled. Present on any
        // hard-wall kill the wall rescue looked at — INCLUDING the ones it refused, so "considered and
        // refused" is readable from the record and never the same silence as "never looked". null when the
        // arm did not apply (no wall, no validator, no declared file).
        quiescentMs: Number.isFinite(quiescentMs) ? Math.round(quiescentMs) : undefined,
        rescueRefused: rescueRefused ?? undefined,   // — the cause, when the rescue looked and refused
        //: the verbatim message this attempt was dispatched with — {file, sha, bytes, chars, kind}.
        // null when the run has no directory or the gate is off; {present:false, error} when the write
        // failed. An absence is a record here, never a silence.
        dispatch,
        // exit-1 rescue (charter P1 §2): the turn exited nonzero but its artifact was fresh + valid — the
        // row records WHAT was rescued so the journal never reads a rescued 500 as a clean turn.
        // Since it also carries "timeout": a hard-wall kill whose artifact was finished and quiet.
        // A stage that succeeded AT THE WALL is therefore distinguishable from one that succeeded
        // normally — `rescued:"timeout"` plus `killed:true` on the winning row is the signature.
        rescued: rescued ?? undefined,
        followup: followup || undefined,
        warm: warm || undefined,
        runId: json?.runId, engineSummary: json?.summary,   // — the SEAT's word for itself; see `ok` above
        usage,
        // — the ratio `usage` and `wall` could always have been divided into, recorded so nobody
        // has to read two archived runs to find out a stage generated four times slower. null (never 0)
        // on a turn that measured nothing — see tokensPerSec.
        tokensPerSec: tokensPerSec(usage, wall),
        // — WHAT tokensPerSec's denominator CONTAINS, beside the ratio. Two integers from the
        // stream's own agent loop: how many tools the turn called, and how long it spent waiting for
        // them. A slow stage and a stage doing more tool work look identical in the ratio alone, which
        // is the comparison had to reconstruct by hand across archived runs.
        //
        // null (not 0, and not absent) on an engine that cannot report them, so "this adapter does not
        // measure" stays visibly different from "this turn called no tools" — see toolGauge.
        ...toolGauge(turn),
        // AD-4 emitted-vs-landed, UNCONDITIONAL (was success-only, which made a failed attempt's mid-write
        // artifact invisible): `output` = what LANDED on disk after this attempt (null when the stage has no
        // expected file); `wrote` = whether THIS attempt emitted it (see the computation above the runDir
        // gate). A failed row with wrote:true is the mid-write/taint shape; ok with wrote:false is inherited.
        // outputMeta, NOT fileMeta: an attempt that emitted nothing must journal {present:false} — under
        // fileMeta it journalled {sha:null,size:0}, a record where there is no file (see log.mjs).
        output: files.length ? outputMeta(files[0]) : null,
        // — THE FORM'S OWN sha, beside the output's. On a form-bearing stage the declared output is
        // the prose the seat writes once; the form is what every attempt after the first is graded on.
        // Five attempts on one delivered run recorded one identical output sha, so the record could not
        // distinguish a retry that filled 40 rows from one that touched nothing. ADDITIVE — `output`
        // keeps its meaning exactly, and this is absent on every stage that owns no form.
        form: gradedFormMeta() ?? undefined,
        wrote,
        // AD-4 reads gauge: which files the turn actually opened ([] = none; null = engine can't observe)
        // and whether that list is complete (true = the engine's cap dropped distinct paths).
        reads, readsTruncated,
        stderrTail: streamDigest(stderr),
        // — STDOUT ONLY WHEN THE TURN PRODUCED NO PARSEABLE JSON. A crashing wrapper prints its
        // reason to whichever stream it likes, and on the observed failure the record carried neither.
        // Absent on every healthy turn, so this costs nothing on the runs that work.
        stdoutTail: (fail && !json) ? streamDigest(turn.stdout) || undefined : undefined,
      });
      // AD-4 — `attempt` lands on run.jsonl too (ADDITIVE: _driver/<stage>.jsonl keeps the full per-attempt
      // detail and 's harness keeps reading it there; run.jsonl gets the lean per-attempt spine it never
      // had — its readers previously saw one "stage" event with attempts:N and no causes, and the knockout
      // lane logs no stage events at all, so run.jsonl alone could not distinguish "no retries happened"
      // from "retries not recorded here"). Best-effort like every telemetry write.
      try {
        runLog(runDir, {
          event: "attempt", stage: name, attempt, of: maxRetries + 1, ok: !fail, fail: fail ?? null,
          //: the spine carries the same pair as the per-stage log, or the two disagree about what
          // ran. `model` stays the requested resolution (its existing readers); `modelActual` is the wire.
          model: modelRequested, modelActual, modelBasis, modelMismatch,
          wrote, warm: warm || undefined, warmEscalated: attempt === warmEscalatedAt || undefined,
          rescued: rescued ?? undefined, killed: killed || undefined,
          quiescentMs: Number.isFinite(quiescentMs) ? Math.round(quiescentMs) : undefined,   // — see the per-stage row
          rescueRefused: rescueRefused ?? undefined,   // — the cause, when the rescue looked and refused
          // — AND THE BILLING PAIR, by the same argument makes for the model pair one field up:
          // the spine carries it or the two logs disagree about what ran. This is the row a sweep across
          // archived runs actually reads, and the question "has this box ever billed API" could not be
          // answered from it because the pair was only ever on the per-stage log. Written unconditionally,
          // like everything else here: a subscription run states `false`.
          authMode: auth.mode, apiBilled: auth.apiBilled === true,
          //: the spine carries the POINTER and the sha, not the text — enough to find the file and
          // to tell two attempts apart without opening either.
          dispatch: dispatch?.file ?? null, dispatchSha: dispatch?.sha ?? null,
          //: the spine carries the convergence pair too — the ladder's shape (25 → 9 → 9 vs
          // 29 → 11 → pass) is readable from run.jsonl alone, without joining the per-stage log.
          quantity, noChange: noChange || undefined,
          // — and the COST pair, by the same argument made for the convergence pair. The
          // spine carried neither `wall` nor `usage`, so "which stage generated slowly" was not a
          // question run.jsonl could answer at all: it took joining the per-stage log for every stage
          // in the run, which is why the anomaly was found by hand across two archived runs rather than
          // by anything watching. Written UNCONDITIONALLY, null and not 0 when the turn measured
          // nothing — an unmeasured turn and a turn that emitted nothing are different events, and the
          // 485-second killed dispatch is exactly the one a 0 here would erase.
          wall, outputTokens: usage?.output ?? null, tokensPerSec: tokensPerSec(usage, wall),
          // — the spine carries them too, or a round has to join two files to ask why a stage was slow.
          ...toolGauge(turn),
          formRepairs: formRepairsThisAttempt || undefined,   //, see the stage row above
        });
      } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
    }

    // sessionKey = the key that actually SUCCEEDED (attempt 1 = base key; a retry = `${base}-rerunN`). Callers
    // that re-run a stage as a follow-up must resume THIS key, not the base key — else they resume a failed
    // attempt's empty/partial session and lose the warm cache (winning-key hardening).
    if (!fail) return { ok: true, json, attempts: attempt, modelWire: lastModelWire, modelUsed: lastModelUsed, text: payloadText(json), sessionKey: key, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    attemptFails.push(fail);
    lastFail = fail;
    lastJson = json;
    lastKey = key;
    lastQuantity = quantity;   //: rides the ladder's final return, so the run-level catch stamps the exact count
    lastSessionRef = turn.sessionRef ?? lastSessionRef;   // anthropic warm-resume target for the next attempt
    note(`[${name}] attempt ${attempt} FAILED: ${fail}${quantity === null ? "" : ` (count ${quantity}${noChange ? ", unchanged" : ""})`}`);

    // A4 (addendum 2026-07-30): a byte-identical CONTENT failure signature on consecutive attempts is a
    // proven-deterministic defect — the previous attempt already carried this exact validator string and
    // the corrective/warm re-dispatch reproduced it byte-for-byte, so another paid turn cannot converge
    // (VENZY/E2E-R2: 63% of the run was correction, much of it re-buying identical failures). Stop NOW
    // and park honestly: the run-level recovery ladder (classifyFailureReason → one "unknown" park →
    // repeat-signature terminal) owns what happens next, with proper accounting — that lane's single
    // fresh sample replaces the blind third attempt this used to buy. Scoped to the content classes
    // (missing_file / invalid_file / max_tokens_no_output — same stage, same validator string); every
    // transport class keeps its own policy (timeout's single extended shot, the chain cascade, the
    // wedge/overload breaks above and below).
    //
    // BUILD 2 — A4's PREMISE FAILS ON EXACTLY ONE ATTEMPT, AND IT IS THE ONE IT USUALLY FIRES ON.
    // "Another paid turn cannot converge" assumes the two consecutive attempts are independent samples.
    // A warm patch is not a sample: it RESUMES the session that produced the previous failure (key =
    // lastKey, resumeRef = lastSessionRef), so a session that wrote a document with zero rulings writes
    // it again. It has no capacity to disagree with itself, and its repeat proves nothing about whether
    // a fresh dispatch would converge.
    //
    // The 2026-08-07 round measured both sides of this on the meaning-sweep stage. Where it cost a run:
    // fresh ruled 0 of 72 → warm ruled 0 of 72, byte-identical, the artifact never rewritten → A4 broke
    // the ladder at 2 of 3 with attempt 3's budget unspent → RECOVERABLE park, ~90s, one of three defect
    // lanes → the recovery lane then re-dispatched FRESH and ruled 69 of 72. Two dispatches and a park to
    // reach the attempt the ladder still had in hand. The control is the run whose warm attempt MOVED
    // (78 unruled → 1): the string changed, A4 never fired, and cold attempt 3 cleared it in the ladder.
    //
    // So: discard the SESSION, not the ladder. Fall through to attempt N+1, which is necessarily FRESH
    // (`warmUsed` is already spent, so `warm` cannot be true again) and carries the full corrective
    // message. Three existing bounds keep this finite and none of them is new or relaxed here:
    //   1. `warmUsed` caps warm at ONE attempt per stage run, and `warm` is this escalation's trigger —
    //      so the escalation can fire at most once per ladder, structurally. It is never reset below.
    //   2. `while (attempt < maxRetries + 1)` is untouched: the ceiling stays 3 attempts in production.
    //   3. The guard below only escalates when a further attempt already exists. With no budget left the
    //      break happens exactly as it does today, terminal signal intact.
    // Worst case: fresh(X) → warm(X, escalate) → fresh(X) → A4 fires normally (attempt 3 is not warm) →
    // terminal at 3 attempts.
    //
    // The escalated dispatch does NOT re-buy the paid sweep: perplexity-server short-circuits on a
    // complete recorded ledger ("the sweep is a fact of this run, not of this attempt"), and the seat
    // opens a form already carrying every prior ruling.
    //
    // NOT de-allowlisting the connotation family from WARM_ELIGIBLE_RE instead: on the same round another
    // clearance cleared 61 unruled → 0 on a warm attempt 2. That lane works, and removing it would cost
    // every run that converges on it. This refuses to treat a warm no-op as proof, and nothing more.
    const identicalContent = /^(missing_file:|invalid_file:|max_tokens_no_output)/.test(fail)
      && attemptFails.length >= 2 && attemptFails[attemptFails.length - 2] === fail;
    // ── — THE ESCALATION IS FOR A SEAT THAT PRODUCED SOMETHING ───────────────────────────────
    //
    // BUILD 2 (above) buys ONE fresh attempt after a warm repeat, because a resumed session cannot
    // disagree with itself and its repeat proves nothing about a fresh dispatch. Measured, that is true
    // of a seat whose output was WRONG and false of a seat that wrote nothing at all:
    //
    //   invalid_file repeated (the seat produced something)   fresh attempt 3 converged  9 of 9
    //   missing_file repeated (the seat produced nothing)     fresh attempt 3 converged  0 of 6
    //
    // The second case cost ~3.4 min and ~19k output tokens per affected run for an attempt that has never
    // once converged. So the escalation keeps its budget where it pays and stops buying the case where it
    // does not. This is the deterministic-vs-transient line asked for, drawn on what the record
    // already shows before attempt 3 is spent — not a shorter ladder, which would hide the escalation
    // rather than decide it.
    //
    // A CHANGED FAILURE IS NEVER CUT, and that is structural rather than a second condition:
    // `identicalContent` requires this attempt's failure to repeat the previous one byte-for-byte, so a
    // run that moved missing_file → invalid_file never reaches here at all. Two of the measured runs did
    // exactly that, with real quantity — precisely where the ladder earns its keep.
    //
    // `noChange` says the same thing one line up and is NOT read here on purpose: it is RECORDING ONLY,
    // and no break/park/terminate decision reads it ( owns that policy). `identicalContent` is the
    // live signal this branch already decides on, so the rule needs no new input.
    //
    // SIX IS SIX, and all of it from the test box. If a fresh attempt 3 ever converges after a
    // produced-nothing repeat, this is the line to revisit — the note below names the case in the run log
    // so that event is findable rather than silent.
    const producedNothing = /^missing_file:/.test(fail);
    // (round 2) — THE CUT WAS RECORDED AND THE BREAK BESIDE IT WAS NOT, SO THE PATHOLOGY SURVIVED.
    //
    // The comment below says a decision that prevents an attempt must leave a trace. It shipped attached
    // to ONE of the two branches that prevent one. Measured on a delivered run of the test instance (engine 734689e8): the
    // marker `escalationDeclined` appears in ZERO files anywhere in the workspace, because the cut also
    // requires `warm` and that run's attempt rows carry no `warm` field at all — while `"warm"` appears
    // in 98 jsonl files instance-wide, so the absence is the run's, not the field's. With `warm` falsy
    // the run fell through to the pre-existing `else if (identicalContent)` break, which stopped attempt
    // 3 exactly as the cut would have and recorded NOTHING: its note is gated on `warm`, and note() is
    // stderr regardless.
    //
    // `warm` is CORRECT on the cut and is not an accidental narrowing of the decision: the thing being
    // declined is the warm→fresh escalation, which only exists on a warm attempt. On a cold path there is
    // no escalation to decline — the ladder simply breaks. What was narrowed with it was the RECORDING,
    // and both branches end the same way, with budget still in hand.
    //
    // ONE STATEMENT, so a third branch cannot arrive recording a fourth shape. `wouldHaveBeenAttempt` is
    // the number when budget remained and NULL when the ladder was genuinely spent — that is the whole
    // difference between a choice and an ending, and a row that printed `attempt + 1` unconditionally
    // would claim a prevented attempt that never existed.
    // THE RUN SPINE, NOT THE SEAT JSONL — and the first cut had this wrong.
    //
    // `_driver/<stage>.jsonl` IS THE ATTEMPT LEDGER. Nothing states that in one place, and it is relied on
    // everywhere: convergence-ledger derives quantities per row, warm-retry and retry-backoff count rows as
    // attempts, seat-attempts.mjs claims any row carrying `{attempt:int≥1, key, status}` as a dispatch for
    // seat-retry-report's statistics. A decision is not an attempt, and filing one there put a row with no
    // quantity into ledgers that derive quantities — four test files caught it the moment this fired on a
    // path that is actually common. The escalation cut merged into that file first and had the same fault
    // latent: it fires only on warm produced-nothing, so nothing had reached it yet.
    //
    // `run.jsonl` is where this codebase already files the things that are NOT attempts — `form-repair`
    // above, `repair-attempted`, `engine-turn-probe`. It is durable, it is one file per run, and it is the
    // one the wall decomposition deliberately skips. Findable was the requirement; the seat ledger was
    // never what made it so.
    const recordAttemptPrevented = (decision, rule) => {
      try {
        runLog(runDir, {
          event: "attempt-prevented", stage: name, attempt, of: maxRetries + 1, decision, rule,
          fail: String(fail).slice(0, 200),
          warm: Boolean(warm), producedNothing,
          // The whole difference between a CHOICE and an ENDING. Null when the ladder was genuinely spent:
          // printing `attempt + 1` there claims a prevented attempt that never existed, and every count
          // taken off these rows would be high by exactly the runs that had nothing left to prevent.
          // Null and PRESENT — an omitted key cannot be told from a row written before this existed.
          wouldHaveBeenAttempt: attempt < maxRetries + 1 ? attempt + 1 : null,
        });
      } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
    };
    // criterion 1 — the rung decision, recorded on BOTH branches.
    //
    // `usage == null && runId == null` is the seat never having answered: no token count and no run
    // identity, which together mean the turn died before the model saw it. Either alone is weaker —
    // a turn can legitimately report no usage on some paths — so both are required.
    const zeroUsageWarm = Boolean(warm) && fail && usage == null && json?.runId == null;
    if (zeroUsageWarm) {
      const free = rungsRefunded < WARM_ZERO_USAGE_FREE_RUNGS;
      if (free) rungsRefunded++;
      note(`[${name}] attempt ${attempt} [warm patch] returned no usage and no runId — it never reached the model`
        + (free ? `; NOT charging the ladder a rung for it (${rungsRefunded}/${WARM_ZERO_USAGE_FREE_RUNGS} free rungs used)`
          : `; CHARGING it — the ladder has already refunded ${rungsRefunded}, and a second one would let a warm turn that never lands loop`));
      try {
        runLog(runDir, { event: "warm-rung", stage: name, attempt, of: maxRetries + 1 + rungsRefunded,
          rung_free: free,
          reason: free ? "warm turn never reached the model" : "second zero-usage warm turn",
          free_rungs_used: rungsRefunded, free_rungs_max: WARM_ZERO_USAGE_FREE_RUNGS,
          fail: String(fail).slice(0, 200) });
      } catch { /* telemetry best-effort — never fail a turn over a journal line */ }
    }
    // Exactly one row per prevented attempt: the warm produced-nothing case satisfies the cut AND then
    // falls into the break below, and two rows for one decision would double every count taken off them.
    const cutFired = identicalContent && producedNothing && warm && attempt < maxRetries + 1;
    if (cutFired) {
      note(`[${name}] attempt ${attempt} [warm patch] reproduced attempt ${attempt - 1}'s failure byte-for-byte and the seat produced NOTHING either time (${fail.slice(0, 140)}) — NOT escalating to a fresh attempt ${attempt + 1}: measured 0 of 6 convergences on this shape (#1062). A seat whose output was merely wrong still escalates.`);
      // THE CUT IS RECORDED, NOT JUST NOTED. `note` is stderr only (log.mjs) and reaches no artifact, so
      // the run record held no trace of a decision that PREVENTS an attempt — and because the cut
      // returns, the prevented attempt never runs. n=6 would therefore be permanent: a seat or model
      // change that made attempt 3 worth buying again could not be noticed, because nothing anywhere
      // counts how often the cut fired or on what. Its own row in the seat's attempt jsonl, where every
      // attempt already lives, is the smallest thing that makes it findable.
      //
      // FINDABILITY ONLY. This samples nothing: the prevented attempt is still prevented, and the row
      // records the case rather than the counterfactual. Re-opening the question needs a deliberate
      // measurement, not a quiet retry ladder that buys one anyway.
      recordAttemptPrevented("escalation-declined:produced-nothing", "#1062");
    }
    if (identicalContent && !producedNothing && warm && attempt < maxRetries + 1) {
      warmEscalatedAt = attempt + 1;
      note(`[${name}] attempt ${attempt} [warm patch] reproduced attempt ${attempt - 1}'s failure byte-for-byte (${fail.slice(0, 140)}) — a resumed session cannot disagree with itself; DISCARDING that session and escalating attempt ${attempt + 1} to a FRESH dispatch (the recovery lane's fresh sample, bought here without the park)`);
    } else if (identicalContent) {
      // — NOT said when the break was a CHOICE. A produced-nothing repeat reaches here with budget
      // still in hand, and "there is no attempt left" would be false: the attempt exists and was
      // deliberately not spent. Its own note above says which case this is.
      if (warm && !producedNothing) note(`[${name}] the warm patch reproduced its own failure and there is no attempt left to escalate to (attempt ${attempt} of ${maxRetries + 1}) — breaking; the fresh sample falls to the recovery lane`);
      note(`[${name}] attempt ${attempt} failed BYTE-IDENTICALLY to attempt ${attempt - 1} (${fail.slice(0, 140)}) — breaking the ladder: same stage, same validator string, further retries are provably futile`);
      // RECORDED, on the path the cut does not reach. This break is the PRE-EXISTING rule and this change
      // does not re-decide it: my 0-of-6 measurement is about the warm→fresh escalation and licenses
      // nothing about a cold break. It makes the population countable, which is what a later ruling on
      // that question would need and could not have had.
      if (!cutFired) recordAttemptPrevented("ladder-break:identical-signature", "#460");
      return { ok: false, attempts: attempt, fail, sessionKey: key, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], identicalSignature: true, warmEscalated: warmEscalatedAt > 0 || undefined, quantity, noChange, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    }

    // Lane-wedge: the turn never got a command lane (0 tokens). The extended ×1.5 shot can't help (it produced
    // nothing), and switching models can't fix a SHARED lane — so stop here and let the chain cascade fast. The
    // chain-level lane-wedge retry (stage() in pipeline.mjs) waits for the lane to clear and retries the chain.
    if (fail === "lane_wedge") break;
    //: a model mismatch is a CONFIGURATION fault, not a transient. The next attempt sends the same
    // argv to the same provider and gets the same substitution, so retrying only buys the wrong model
    // twice. Break immediately and let the stage fail with the mismatch named on every row.
    if (fail.startsWith("model_mismatch:")) {
      note(`[${name}] model mismatch is deterministic — breaking the ladder (a retry re-buys the same wrong model)`);
      break;
    }
    // D3: overload (529 / status_overloaded) — stop the ladder here: an in-ladder re-attempt hammers an
    // API that just said it is overloaded, seconds apart, on the SAME model. Breaking hands the failure
    // to the existing machinery: the chain cascades models (FALLBACK_ELIGIBLE) and an exhausted chain
    // parks the run for recovery with escalating backoff (TRANSIENT_RE → .postponed).
    if (fail === "status_overloaded") break;
    // Rate-limit: do NOT retry (every retry hits the same capped subscription) and do NOT fall back — return
    // immediately so the pipeline can postpone + auto-resume after the window. resetsAt rides the result.
    if (fail === "rate_limited") return { ok: false, attempts: attempt, fail, resetsAt: turn.signals?.resetsAt, sessionKey: key, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], quantity, noChange, reads, readsTruncated, warm, wrote, formRepairs: formRepairsUsed };
    // Timeout-aware retry: a genuinely over-budget/hung stage will just re-time-out on an identical
    // attempt (the v14 delivery burned 3 × 600s). Give it exactly ONE longer shot, then stop.
    if (fail === "timeout") {
      // A warm-resume / followup (frame-reopen sweep, escalation, envelope close) that ran to its HARD WALL
      // won't fit a 1.5× extension — break after this one attempt and let the caller record the coverage-limited
      // DEFERRAL (which the gate clamps CLEAR→CONDITIONAL). See followupHardWallStop: the live signal is
      // `followup` (threaded from stageOnce), NOT `warm` — `warm` is always false on a timeout chain, which is
      // why this was dead code before the thread (a hard-wall followup burned ~2.5× the wall instead of ~1×).
      if (followupHardWallStop({ fail, warm, followup, signals: turn.signals })) {
        note(`[${name}] warm/followup hit the hard wall — breaking (a 1.5× extension won't fit; recording the deferral)`);
        break;
      }
      if (timeoutRetriesUsed >= 1) {
        note(`[${name}] second timeout — stopping (won't finish on a 3rd identical attempt)`);
        break;
      }
      timeoutRetriesUsed++;
      // Stall honesty (charter P1 §1): a STALL kill (byte-silent or no-progress — signals.stalled) is NOT
      // "the stage needed more time" — the R-round evidence retry did the identical work in 369s after a
      // 1500s stall burn. Retry ONCE at the SAME budget; extending would only extend the next stall's burn.
      // A hard-wall kill (a genuine over-budget grind) keeps the single 1.5× extended shot.
      if (turn.signals?.stalled) {
        note(`[${name}] stall kill${turn.signals?.noProgress ? " (no-progress watchdog)" : ""} → one retry at the SAME ${effTimeout}s budget (a stall is not a slow turn)`);
      } else {
        effTimeout = Math.round(timeoutSec * 1.5);
        note(`[${name}] timeout → one extended retry at ${effTimeout}s`);
      }
    }
  }
  // sessionKey on FAILURE = the last attempted key (lastKey) — callers that recover terminally (e.g. the
  // WS-A coverage-ledger quarantine) need a session to attribute/resume; it is best-effort, not a winner.
  return { ok: false, attempts: attempt, fail: lastFail, sessionKey: lastKey, modelWire: lastModelWire, modelUsed: lastModelUsed, attemptFails: [...attemptFails], warmEscalated: warmEscalatedAt > 0 || undefined, quantity: lastQuantity, reads: lastReads, readsTruncated: lastReadsTruncated, warm: lastWarm, wrote: lastWrote, formRepairs: formRepairsUsed };
}

function rel(p) {
  const i = p.indexOf("/prelim-search/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// Fix B: a retry after a CONTENT (file-validation) failure tells the model what was wrong, instead of re-running
// the identical prompt blind (recovery was model-variance luck — the skeptic burned 2 of 3 attempts this way on
// marble-keystone). A FRESH-session retry carries the correction in the MESSAGE (winning-key hardening); the warm
// patch retry below resumes the completed session with the same hint. Only content failures (invalid_file /
// missing_file) get corrective text — a timeout/transport failure is fixed by re-running, not by different content.
// opts.supplementalLane (trailing + optional, so every positional caller is unchanged): the failing stage
// ran without register_enumerate, so a hint that names it would contradict the prompt it is appended to.
export function correctiveMessage(baseMessage, attempt, lastFail, expectFile, { supplementalLane = false } = {}) {
  if (attempt <= 1 || !lastFail) return baseMessage;
  // A6 (addendum 2026-07-30): the max_tokens fault wraps the underlying content failure (or stands bare
  // on a transport-shaped turn). The retry must be told the CAUSE was the output ceiling — an unnamed
  // re-run does the same work at the same length and dies on the same wall.
  const maxTok = /^max_tokens_no_output(:|$)/.test(lastFail);
  const inner = maxTok ? lastFail.replace(/^max_tokens_no_output:?/, "") : lastFail;
  if (!maxTok && !/^(invalid_file|missing_file)/.test(inner)) return baseMessage;
  const files = (Array.isArray(expectFile) ? expectFile : [expectFile]).filter(Boolean);
  const names = files.map(rel).join(", ");
  // DIRECTION (b) — THE COLD CORRECTIVE IS A REPAIR SURFACE, AND 's SWEEP STOPPED AT THE WARM ONE.
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
    `${correctionHint(inner, { gridLedgerName: gridLedgerNameFor(expectFile), supplementalLane, undispatchable: frameDiffUndispatchable(expectFile, inner) })}. ` +
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
export function correctionHint(lastFail, { gridLedgerName = "common-law-grid.json", supplementalLane = false, undispatchable = [], toolWritten = null } = {}) {
  // The repair act, for the hints that name one. Kept to a single sentence and a single decision so a
  // new hint has one thing to append rather than a branch to reproduce.
  const resaveClause = toolWritten
    ? `Fix exactly that and send the corrected values — the driver re-derives this file and the prose table together from your \`${toolWritten}\` call, so there is nothing here for you to save`
    : `Fix exactly that, re-save the COMPLETE JSON file, and leave the prose table unchanged`;
  let hint = "the required output file is actually written and contains every required section IN FULL";
  if (/findings?_/.test(lastFail)) {
    // The per-finding machine contract (findings-model.mjs). MUST sit ABOVE the coverage_ branch — a
    // findings_coverage_* token would otherwise route to the (wrong) coverage-ledger hint. The structural
    // "findings-heading" token has no underscore after "findings", so it never matches this branch.
    const tok = (lastFail.match(/findings?_[a-z_]+(?::[^\s)]*)?/) || ["findings contract defect"])[0];
    // A2 (teal-bastion) — the specific repair the blind generic hint was missing: the famous-neighbour
    // empty-uri crash. Without naming the fix (registrations:[] / route to context_notes), three retries each
    // re-emitted a different malformed shape and never converged. These addenda close that loop.
    let extra = "";
    if (/finding_registration_invalid/.test(lastFail)) {
      extra = ` SPECIFIC FIX: a registration.uri is NEVER empty. If this finding has a fetched register record, ` +
        `put its real record URI. If it has NO fetched record (a common-law finding, or a famous mark known only ` +
        `from general knowledge — e.g. CHROME on a NOVAPULSE clearance), it is NOT a register finding: set ` +
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
      // scale; the fix is stated in the framework's own terms, never as a mapping.
      extra = ` SPECIFIC FIX: schema_version 4 carries NO composite/level/dispute_type — delete those keys. ` +
        `The rating is "band": the band WORD your reasoning under the framework you read yields (EXACTLY one of ` +
        `its band words, as written in the framework). Your reasoning trail stays in the narrative prose.`;
    } else if (/finding_band_|findings_rated_under_|finding_disposition_missing/.test(lastFail)) {
      extra = ` SPECIFIC FIX: every finding carries "disposition"; adversarial / coexistence-partner / ` +
        `distinguished findings are RATED and carry "band" = EXACTLY one of the framework's band words (as ` +
        `written in the framework you read — no numbers, no codes, no words from any other scale); off-field ` +
        `findings are NOT rated and carry NO band. The top level carries "rated_under_framework" = the ` +
        `framework key you were told to rate under, verbatim.`;
    }
    hint = `findings.json is a JSON OBJECT { schema_version, rated_under_framework, findings[], coverage[], context_notes[] } ` +
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
      `outside this, and it carries "withdrawn_reason" instead). An off-field finding additionally carries ` +
      `"off_field_ground" = "different-field" (the goods do not meet — its own goods_proximity meter must then read ` +
      `"low") or "no-material-risk" (a clear win, carrying no field claim). A mark argued apart on sound, rhythm, ` +
      `orthography or connotation is "distinguished", never off-field. ` +
      `On schema_version 4+ each finding carries "band" (the framework-in-force's band WORD; rated dispositions only — ` +
      `composite/level/dispute_type are RETIRED and forbidden), owner.registrations[] (ONE entry per ` +
      `registration — never overwrite or transpose another's facts; a finding with no fetched record → []), the four ` +
      `meters as {token, basis} (basis = verified-from-record | inferred-from-signal), quadrant {x,y} in [0,1], a ` +
      `typed source, a disposition, and a unique 1-based ordinal. The failed check was: ${tok}.${extra} Fix exactly that, re-save ` +
      `the COMPLETE findings.json, and leave the narrative prose unchanged`;
  } else if (/coverage_status_offenum/.test(lastFail)) {
    // D1 — the off-enum PROSE Status cell (distinct from coverage_status_invalid, which is the JSON
    // mirror's token): the defect lives in register-findings.md's own Coverage-ledger table, so the
    // repair is a one-cell prose relabel — never a JSON re-save. MUST sit above the JSON-mirror
    // coverage_ branch so the shared substring never routes this to the wrong file.
    const det = (lastFail.match(/\(axis ([a-z-]+)/) || [])[1] || "";   // the status text itself may carry parens — anchor on the token's own "(axis …" tail
    hint = `every row of the prose Coverage ledger's Status column is EXACTLY one bare token of ` +
      `confirmed-clean / coverage-limited / deferred${det ? ` (the off-enum row is on axis ${det})` : ""}. ` +
      `Relabel the offending Status cell(s) to the honest enum token and move any qualifier or commentary ` +
      `("N/A", "confirmed", "not-searched (…)", ✅, bolding) into the Reason column — an axis that was not ` +
      `applicable or not searched is an honest \`deferred\` with the reason stated. Leave every other row ` +
      `and section unchanged`;
  } else if (/coverage_(ledger_unparseable|ledger_empty|axis_invalid|axis_missing|status_invalid|key_unknown|mirror_missing)/.test(lastFail)) {
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
    hint = `register-coverage-ledger.json is a JSON ARRAY mirroring the prose Coverage ledger — one object ` +
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
  } else if (/use_check_missing/.test(lastFail)) {
    hint = "every Composite-3-or-higher finding whose risk turns on the owner's actual use ENDS with a " +
      "\"**Use-check source:** <result URL | 'perplexity_research — no result'>\" line — run the scoped marketplace " +
      "use-check (owner + mark + goods/field) and cite its result, or state the honest 'no result'; never assert a " +
      "use-negative you did not search";
  } else if (/connotation_form_damaged/.test(lastFail)) {
    // The accumulator is DRIVER-WRITTEN, so a damaged row is a narrow, nameable fault: a row's recorded
    // receipt is no longer one of that row's own candidates (the ledger regenerates candidates every
    // pass, so a top-up can orphan a recorded id). The remedy is ONE tool call about the named row —
    // never a file edit; the seat writes no dispositions file.
    hint = "every recorded row's receipt is one of THAT ROW's own listed candidates. Re-send ONLY the " +
      "named row(s) through the `record_dispositions` tool with `receipt_index` set to the POSITION of " +
      "the candidate you ruled on in that row's own list (1, 2, …) — never a typed id. Your other rows " +
      "are recorded and KEPT; do not re-send them and do not write any file";
  } else if (/connotation_quote_unbound/.test(lastFail)) {
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
    hint = "every row owing proof of reading carries BOTH fields. Give `segment_index` — the NUMBER of the " +
      `passage you relied on, in the numbered passages of the receipt you ruled on. And copy \`fragment\` — a ` +
      `few characters taken EXACTLY out of that same passage, in whatever script it is written in. ` +
      `${rowTok ? `The failure names the row (${rowTok}) and every other row is already accepted` : "The failure names the rows"} — ` +
      `your RULING on it is sound and is KEPT, so do not re-rule anything. Re-send ONLY the named row(s) ` +
      `through the \`record_dispositions\` tool (keep \`row_index\`, \`ruling\` and ` +
      `\`note\` as you had them) — never write or edit any file. ` +
      `You are POINTING at the passage, not reproducing it — short and exact beats long and approximate. ${where}`;
  } else if (/connotation_call_never_made/.test(lastFail)) {
    // B — rows are owed and no `record_dispositions` call was ever STARTED this run. The one thing R6's
    // dead attempts were never told was WHERE the gate was counting; under the typed transport the
    // answer is a TOOL, and this arm names it. — composed into `Fix exactly this: ensure <hint>.`.
    hint = "every meaning obligation is recorded through the `record_dispositions` tool. NOTHING has been " +
      "recorded this run — no call was ever made — and rulings written into your findings prose, or into " +
      "any file, are not read by this check and cannot make it pass. Call `record_dispositions` now with " +
      "`grid_spec_path` (the driver-written spec path your grid instructions name) and `rows`: one entry " +
      "per obligation, each with `row_index` (the NUMBER printed beside that obligation in the obligations " +
      "block), `receipt_index` (the POSITION of the candidate you ruled on in " +
      "that row's own list), `ruling` and a one-line `note`. The tool's answer names what is still " +
      "outstanding and which rows still owe proof of reading — a `segment_index` and a `fragment`. " +
      "Rule from what the receipts say, never from memory, " +
      "and carry any loaded reading into Findings as well";
  } else if (/connotation_call_truncated/.test(lastFail)) {
    // B — a call STARTED and never returned: a driver-side or transport fault, NOT a fault in the
    // rulings. The one message a seat must never take from this is "re-derive your rulings".
    hint = "the `record_dispositions` call(s) that never returned are re-sent AS THEY WERE. This is NOT a " +
      "fault in your rulings — a call was killed in flight before its rows were recorded, which is the " +
      "driver's fault, not yours. Do not re-derive or change any ruling: call `record_dispositions` again " +
      "with the same rows for whatever the tool's answer still lists as outstanding, and stop when it " +
      "reports nothing outstanding";
  } else if (/connotation_call_schema_violation/.test(lastFail)) {
    // B — calls arrived and not one row was accepted from any of them: the payload SHAPE is wrong. The
    // remedy is the shape, never the rulings — the tool's own answer named each refusal in-turn.
    hint = "the `record_dispositions` payload has the right SHAPE — the rulings themselves are not in " +
      "question. `rows` must be an ARRAY of objects, each with `row_index` (the obligation's NUMBER in the " +
      "obligations block) as an INTEGER, `ruling`, `note`, and `receipt_index` as an INTEGER position " +
      "(1, 2, …) — never a typed id of any kind, never a query string, never a string index, never extra " +
      "fields. Re-send your rulings with the corrected " +
      "shape; the tool's answer names each refusal and what is still outstanding";
  } else if (/connotation_(no_ruling|token_absent|cite_absent)/.test(lastFail)) {
    // READER TOLERANCE, not a live path: this engine's gate can no longer mint these three — any unruled
    // residual surfaces as a call token (the audit runs whenever rows are owed). What CAN still carry
    // one is the recorded lastFail of a run parked under the previous engine and resumed on this one,
    // and the golden-rule boundary is exactly that parsing history is fine. The remedy under this
    // engine is the same as call_partial's: record the remainder through the tool.
    hint = "every remaining meaning obligation is recorded through the `record_dispositions` tool — " +
      "never by writing or editing any file. Everything already recorded is KEPT. Call " +
      "`record_dispositions` with rows for the obligations still outstanding; the tool's answer lists " +
      "them, marks which still owe a `segment_index` and a `fragment`, and reports when nothing remains";
  } else if (/connotation_call_partial/.test(lastFail)) {
    // B — rows landed and obligations remain. What is recorded is KEPT; the remedy is the remainder.
    hint = "every remaining meaning obligation is recorded through the `record_dispositions` tool. " +
      "Everything you already recorded is KEPT — do not re-send it and do not re-derive it. Call " +
      "`record_dispositions` with rows for ONLY the obligations the failure counts as outstanding " +
      "(the tool's answer lists them and marks which still owe a `segment_index` and a `fragment`), and " +
      "stop when it reports nothing " +
      "outstanding. Rule from what the receipts say, never from memory, and carry any loaded reading " +
      "into Findings as well";
  } else if (/meaning_angles_missing|matterframe_meaning_angles/.test(lastFail)) {
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
    hint = "the matter frame must carry the per-matter meaning/connotation angles — derived from the mark's " +
      "OWN semantic field and this matter's market/industry (cultural origin and communities the word " +
      "evokes, charged historical/political associations of the term or its imagery, category-specific " +
      "controversy for these goods) — 3-8 short queries, each anchored on the mark's element(s). Send them " +
      "as `meaning_angles` in one `record_matter_frame` call, or send `meaning_angles_none: true` with an " +
      "empty array ONLY when the mark is a coined term with no real-word semantic field to probe. The call " +
      "replaces the stored frame, so send the whole frame again, not only the angles — the driver renders " +
      "the file and there is nothing for you to save";
  } else if (/own_rights_missing/.test(lastFail)) {
    hint = "every finding whose clearance reasoning relies on the client's own house mark / franchise root ENDS " +
      "with an \"**Own-rights source:** <record URI(s) | 'no applicant-owned registrations in the searched register material'>\" line — " +
      "run ONE owner-scoped band_lookup over the run's frozen register material (plus band_record for any cite) and cite the record URIs, " +
      "or state the honest SCOPED negative (never a portfolio-wide 'no registrations found' — the frozen material covers only this " +
      "matter's dispatched slices), adjust the reasoning to stand without the crutch, and record the missing owner query as an open " +
      "Coverage/open-item row for the escalation lane; the affiliate-exclusion mandate covers CONFLICTS, never this supporting evidence";
  } else if (/blindframe_/.test(lastFail)) {
    // Property 1 (frame-omission design): the blind-frame stage's STRUCTURED MODEL, which since is
    // the stage's whole output — there is no prose companion to leave alone. A JSON-defect repair on a
    // clean turn: warm-eligible (WARM_ELIGIBLE_RE), and warmPatchMessage aims it at the file itself
    // through the generic invalid_file branch (failingTarget resolves the single-file stage's output).
    const tok = (lastFail.match(/blindframe_[a-z_]+(?::[^\s)]*)?/) || ["blind-frame model defect"])[0];
    // — THE REPAIR RIDES THE TYPED TOOL, because the seat no longer holds Write or Edit. This used to
    // end "Correct it in place — the file is the stage's only output", which after the conversion orders an
    // act the grant denies: a failure on obedience, mid-round, on the first repair rung that fires. Same
    // shape as 's ten anchor sites, caught before it shipped rather than after. The one-change
    // invariant covers a dictation AND the ladder that corrects it.
    hint = `the model is a set of VALUES you hand to the \`record_blind_frame\` tool: dominant_element, ` +
      `variants[] (each {value, direction (add|drop|phonetic|homophone|neighbour|composite), rationale}), ` +
      `fields[] (each {goods, on_field — a JSON boolean, rationale}), sources[] (each {channel, rationale}) ` +
      `and ranking_basis (goods-overlap | class-number). The failed check was: ${tok}. Call ` +
      `\`record_blind_frame\` again with the corrected values — everything that already validated can be ` +
      `sent as it was. Do not write or edit any file: blind-frame-model.json is the driver's to write`;
  } else if (/framediff_directive_undispatchable/.test(lastFail)) {
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
    hint = `${offenders.length || "one or more"} of your FIRING directives (severity dominant-element or material) ask for a search the driver cannot dispatch. ` +
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
  } else if (/framediff_/.test(lastFail)) {
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
    hint = `the structured diff is { schema_version, directives[], ` +
      `dominant_element_gap (a JSON boolean) } — send directives:[] for a clean diff. Each directive is ` +
      `{layer (variant|field|source), item, observation, severity (dominant-element|material|minor)}. ` +
      `The dominant element itself is the driver's — it is bound from the blind model, not sent by you. ` +
      `The failed check was: ${tok}. Send the corrected diff in one \`record_frame_diff\` call — the driver ` +
      `writes frame-diff.json and renders the prose from it, so there is nothing for you to save`;
  } else if (/receipts_short/.test(lastFail)) {
    const shorts = (lastFail.match(/receipts_short:([^\s]+)/) || [])[1] || "";
    hint = `the Negative-results matrix accounts for EVERY (variant × platform) grid cell — these variants are ` +
      `short (variant:rows/expected): ${shorts}. Re-transcribe their cells from the grid call's stdout JSON ` +
      `(every cell needs a receipt row: "No results" / "No similar listings (N candidates reviewed)" / ` +
      `"Similar listing(s) found — see Findings" / "not executed — coverage-limited"); re-run the grid call ` +
      `only if those cells are genuinely absent from its output`;
  } else if (/grid_ledger_unparseable/.test(lastFail)) {
    hint = `${gridLedgerName} is the grid call's stdout JSON saved VERBATIM — a single stdout object, or a ` +
      `JSON ARRAY of the per-batch stdout objects in batch order, each with its cells[] (and gaps[]) intact. ` +
      `Re-save the file exactly as the tool returned it — no reformatting, no re-typing, no judging. If the ` +
      `saved file is TRUNCATED mid-string (an unterminated value near the end), your single call's stdout ` +
      `EXCEEDED the output budget: re-run the grid SPLIT into MORE, SMALLER batches (fewer variants per call) ` +
      `and save each batch's stdout as its own element of the JSON array — never try to re-emit one oversized object.`;
  } else if (/grid_join_missing/.test(lastFail)) {
    const shorts = (lastFail.match(/grid_join_missing:([^\s]+)/) || [])[1] || "";
    hint = `the saved ${gridLedgerName} must account for EVERY dictated (variant × platform) grid cell — ` +
      `these variants are short (variant:cells/expected): ${shorts}. Append the missing cells' grid stdout to ` +
      `the JSON (make the file a JSON array of stdout objects if it is not already), re-running ONLY the cells ` +
      `genuinely absent from the prior output; then make sure the Negative-results matrix matches`;
  } else if (/platforms_missing/.test(lastFail)) {
    // capture to end-of-string: real manifest variants are multi-word, a [^\s]+ capture would chop
    // "PROJECT NOVA PULSE:itch.io+…" at the first space and dictate a garbage cell list.
    const det = (lastFail.match(/platforms_missing:(.+)$/s) || [])[1] || "";
    hint = `the grid must sweep EVERY platform DICTATED in your task message's PLATFORMS list — never a ` +
      `remembered or skill-example list. These variants are missing dictated platforms ` +
      `(variant:domain+domain): ${det}. Run exactly those missing (variant × platform) cells, append their ` +
      `stdout to ${gridLedgerName}, and account for them in the Negative-results matrix`;
  } else if (/connotation_query_unrecorded/.test(lastFail)) {
    // — THE TOKEN THAT HAD NO HINT, and the absence is what made the failure
    // permanent rather than merely wrong.
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
    hint = `every dictated meaning query owes a row, including the ones that find nothing — these are ` +
      `missing from ${gridLedgerName} extras.pr_risk[]: ${dropped}. A query that returned NO results is ` +
      `not an excuse to omit it: record it with an empty results array, which is the receipt that the ` +
      `search RAN and came back clean. That is the whole point of the sweep — on an "offensive meaning" ` +
      `query the empty answer IS the good news, and a missing row is indistinguishable from a search ` +
      `nobody performed. Re-run ONLY the listed queries, append a row per query to extras.pr_risk[] ` +
      `whether or not it has hits, and leave every row already recorded exactly as it is`;
  } else if (/connotation_search_missing/.test(lastFail)) {
    // — was "your PR / reputational section claims a clean meaning … but the ledger recorded ZERO
    // searches", which under the `ensure` prefix instructed the model to make the unbacked claim.
    hint = "a clean-meaning claim has the sweep behind it — yours does not: your PR / reputational section " +
      "claims a clean meaning (None identified / no gang / no offensive " +
      "association / affirmative sweep) but the grid ledger's extras.pr_risk recorded ZERO connotation searches. " +
      "Run the CONNOTATION / MEANING sweep — the mark AND its near-forms on the general web (Urban Dictionary, " +
      "Wikipedia, news), query shapes \"[name] gang/slang/offensive/meaning\" — record EVERY query (even " +
      "zero-result ones) into extras.pr_risk, and cite a `Connotation-search source:` line in the PR section. A " +
      "dictionary gloss is never a clearance (a mark can read as a benign given name yet sit one letter off \"Sureño\", a street-gang label). You may " +
      "instead report a real connotation hit — but a clean claim needs the search behind it";
  } else if (/named_band_collapsed/.test(lastFail)) {
    const slices = (lastFail.match(/named_band_collapsed:(.+)$/s) || [])[1] || "";
    // The diagnosis is lane-independent; the REPAIR is not. This hint rides correctiveMessage, so it is
    // appended to the register-unit stage message itself — and on the supplemental lane that message has
    // just told the model it cannot call register_enumerate and must never author a band block. The legacy
    // text therefore contradicted its own prompt in the same breath (ION/copper-foundry 2026-07-22). The
    // collapsed token is deliberately NOT warm-eligible, so this only ever reaches a cold retry.
    const diagnosis = `your named band has a COLLAPSED enumerated slice — a block that claimed hits (total_hits>0) but ` +
      `carried ZERO records (slice~claimed-hits): ${slices}. The funnel enumerated the slice yet nothing reached ` +
      `the band — a clean can never ship over a searched-but-lost slice. `;
    hint = supplementalLane
      ? diagnosis +
        `On this run the TOOLS own every band block: if the collapsed slice belongs to a DICTATED plan entry ` +
        `(it carries a qid from the frozen plan), close it by calling register_execute_plan ONCE with the exact ` +
        `{"plan_path", "axis", "output_path"} from your stage instructions — that is the tool's whole call form ` +
        `(it takes no per-qid argument); it re-runs this axis's dictated entries and refreshes their blocks, ` +
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
  } else if (/intake_ask_unanswered/.test(lastFail)) {
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
    hint = `your record is missing ${det[1] ?? "some"} of the ${det[2] ?? "frozen"} intake-ask answers. ` +
      `Send one \`ask_answers\` entry per frozen ask (_driver/intake-asks.json) on the findings record you ` +
      `hand to \`record_synthesis\` — the ask VERBATIM as it was given to you, and the ANSWER ALONE: the ` +
      `driver renders the labelled line into the narrative and the report from those entries, so there is ` +
      `no section for you to write and nothing you write by hand is read. ` +
      `Answer from the gather stages' actual results (the owning stage was instructed to run each check); an ` +
      `un-run check gets the honest "NOT executed this run — <reason>" answer plus an open coverage[] row — never silence`;
  } else if (/\btool_timeout:/.test(lastFail)) {
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
    hint = `your dictated register tool call was MADE and never RETURNED — it was still running when ` +
      `the bridge killed it, so the band was never written. This is NOT a missing-structure defect and ` +
      `NOT something you did wrong. Call register_execute_plan ONCE more with the exact ` +
      `{"plan_path", "axis", "output_path"} from your stage instructions. If it is killed again, do ` +
      `NOT author band blocks by hand and do NOT narrate coverage you did not get — record the timeout ` +
      `in your .md, state the scope you attempted, and flag CROSS-CHECK REQUIRED. That note is the ` +
      `correct answer to a tool that will not return, and it is what the reader needs`;
  } else if (/named_band_missing/.test(lastFail)) {
    // 2026-07-14 (copper-keystone): the unit's .md narrated success but the band file was NEVER WRITTEN —
    // the model skipped its one register_execute_plan call and fabricated the narrative. Unlike the
    // defective-block repairs below, the fix here IS re-calling the tool: with no existing blocks there
    // is nothing the qid-ownership merge could wrongly preserve, and a hand-authored band fails the stage.
    hint = `your unit's NAMED BAND file (<axis>-band.json beside your .md) was NEVER WRITTEN — the ` +
      `load-bearing artifact is absent, so the stage cannot pass no matter what the .md says. Produce it ` +
      `NOW by CALLING register_execute_plan ONCE with the exact {"plan_path", "axis", "output_path"} ` +
      `from your stage instructions — the TOOL executes the dictated entries and writes the band itself, ` +
      `qid-stamped. Do NOT author band blocks by hand (a hand-authored band fails the stage), do NOT ` +
      `re-do your digest prose, and NEVER claim the band was written without the tool call actually made`;
  } else if (/named_band_(state_invalid|block_invalid|unparseable)/.test(lastFail)) {
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
    hint = supplementalLane
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
  } else if (/plan_audit_missing/.test(lastFail)) {
    // T1 (J3b): the reviewer omitted the deterministic plan audit — the validator requires the
    // exact section title whenever the plan-execution receipt exists.
    // — THE GRADING IS QUOTED, NOT PARAPHRASED. What stood here restated the three classes in its
    // own words ("a missing dictated slice ⇒ a blocking flag; a crowd-gated skipped fringe is
    // sanctioned; …"), which made this the THIRD statement of one rule — and the one a model reads at
    // exactly the moment it is rewriting the section the rule governs. The dispatch blocks now share a
    // single literal; this is its third reader, so a change to the grading reaches the repair turn too
    // instead of leaving it teaching the previous version.
    hint = `your review lacks the section titled exactly "PLAN-EXECUTION CHECK". Add it: audit the ` +
      `driver-fed plan-execution receipt, under the same grading you were given with it — ` +
      `${PLAN_AUDIT_CLASSES} — flagging a clean claim that rests on class (1), a class (2) fringe ` +
      `claimed searched-clean, and a class (3) slice the narrative shows no materiality reasoning for. ` +
      `Keep the verdict (CLEAR / CONDITIONAL / BLOCKING) on the FIRST line and the rest of your review intact`;
  } else if (/coverage_no_status/.test(lastFail)) {
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
    hint = `${lead}: ${abbrev(rows, 200) || "see the failure"}. ` +
      `The driver computed every obligation and every identifier in it — the coverage unit, the query id, the hit ` +
      `count, the unaccounted classes and terms, each deferred slice's own receipt reason. Record the named row(s) ` +
      `through the \`record_coverage\` tool — {"row_id","status","reason"} per row, never by writing or editing any ` +
      `file: "status" EXACTLY one bare token of confirmed-clean / coverage-limited / deferred, "reason" the sentence ` +
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
  } else if (/coverage_form_axis_invalid/.test(lastFail)) {
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
    hint = `row(s) YOU ADDED to the coverage form carry an "axis" outside the register-axis vocabulary, which ` +
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
  } else if (/coverage_form_damaged/.test(lastFail)) {
    // Typed transport: the seat holds no writer onto the accumulator, so a damaged one is the driver's
    // own serialization or filesystem at fault — never the seat's JSON. The repair is still a tool
    // call, because record_coverage rewrites the accumulator whole from the regenerated rows plus the
    // call: statuses in the unreadable copy cannot be carried, so the seat re-sends its rulings.
    const detail = (lastFail.match(/coverage_form_damaged:form_damaged=\d+;([^\n]*)/) || [])[1] || "";
    hint = `the driver's coverage accumulator could not be read${detail ? ` (${abbrev(detail, 120)})` : ""} — a ` +
      `driver-side fault, not your JSON (you never write this file). Re-record your statuses through the ` +
      `\`record_coverage\` tool — {"row_id","status","reason"} per obligation row — which rewrites the record ` +
      `from the driver's own rows plus your call. Statuses in the unreadable copy cannot be read, so re-send ` +
      `every ruling the tool's answer still lists as outstanding. Never write or edit any file`;
  } else if (/coverage_form_(missing|empty)/.test(lastFail)) {
    // Named for readability in the journal, not because a model can act on either: both mean the DRIVER
    // did not write the form it stamped as required — absent in one case, present with no obligations in
    // it in the other. Deliberately out of the warm allowlist, and for the same reason: a resumed seat
    // cannot patch a file it was never told about, and warming it would spend a turn asking a model to
    // fix a driver bug. `coverage_form_empty` is matched HERE rather than by the `coverage_no_status`
    // arm above so an empty form never reads to the seat as rows it forgot to fill in.
    const empty = /coverage_form_empty/.test(lastFail);
    hint = `the driver-written coverage form is ${empty ? "present but carries no rows" : "absent"} although this run ` +
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
  } else if (/coverage_deferred_unaccounted/.test(lastFail)) {
    //: the accounting requirement, not the clean-claim gate. The distinction matters in the hint —
    // this fires when the ledger is SILENT about a deferred qid, so telling the model to "correct its
    // clean claim" would send it looking for a row that does not exist. The qids ride in the token.
    const [, ax = "", qids = ""] = lastFail.match(/coverage_deferred_unaccounted:([^:\s)]+):?([^\s)]*)/) || [];
    hint = `your Coverage ledger does not account for ${qids ? `these DEFERRED slice(s): ${qids}` : "every DEFERRED slice"} ` +
      `on ${ax ? `axis "${ax}"` : "a dictated axis"}. The active register provider cannot express those queries at all, ` +
      `so they were never searched and nothing can make them run — the plan recorded that before this stage began. ` +
      `Each qid must appear VERBATIM in a row on its own axis with Status "deferred" (or "coverage-limited"), quoting ` +
      `the receipt's mechanical reason. A ledger that says nothing about a slice the plan could not run is incomplete ` +
      `output, not a clean one; treat the gap as an OPEN, disclosed question for the lawyer`;
  } else if (/coverage_clean_unverified_incomplete/.test(lastFail)) {
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
    hint = `${ax ? `axis "${ax}"` : "an axis"} has ONE undisclosed incomplete block and this is it: ` +
      `${qid ? `qid ${qid}` : "the block named in the failure"}${hits ? ` (${hits} hits)` : ""}. ${what} — and no ` +
      `Coverage-ledger row discloses it, so that axis's confirmed-clean rows swallow it. Give THAT block its ` +
      `OWN coverage-limited (or deferred) row on this axis. The gate recognises the disclosure by exactly two ` +
      `things and nothing else: the qid written verbatim${hits ? `, or the number ${hits} standing alone` : ""} ` +
      `— so write ${qid ? `"${qid}"` : "the qid"} into that row's reason. State in the reason what is open ` +
      `${classes ? `(class ${classes} counted, not enumerated)` : "(which part stayed open)"}. Rows about slices ` +
      `that genuinely enumerated to has_more:false STAY confirmed-clean: do not downgrade them, that trades one ` +
      `false claim for another. Correct exactly that row and change nothing else. Do NOT re-run searches ` +
      `yourself — the driver owns the re-run`;
  } else if (/coverage_clean_unexecuted/.test(lastFail)) {
    // T1 (J6): the F3 gate — a clean claim over a slice the plan-execution receipt says never ran.
    const ax = (lastFail.match(/coverage_clean_unexecuted:([^\s)]+)/) || [])[1] || "";
    hint = `the plan-execution receipt says ${ax ? `axis "${ax}"` : "a dictated axis"} did NOT fully execute, ` +
      `yet your findings claim it clean. Either the claim is wrong — correct it to an honest ` +
      `coverage-limited/deferred row carrying the mechanical reason from the receipt — or the coverage ` +
      `actually ran and your ledger row mis-states it: fix the row to match the receipt. A clean can never ` +
      `rest on a slice the plan dictated and nothing ran`;
  } else if (/band_block_unplanned/.test(lastFail)) {
    // copper-lattice re-route: a hand-authored band block under the supplemental_lane contract.
    const qs = (lastFail.match(/band_block_unplanned:([^\s)]+)/) || [])[1] || "";
    hint = `this run's register plan carries the supplemental_lane contract: EVERY band block is written by ` +
      `a TOOL and carries a qid — you never author band blocks. The qid-less block(s) (${abbrev(qs, 100)}) came ` +
      `from a hand append. REMOVE them from the band file, then re-run their queries the sanctioned way: ` +
      `register_propose_supplemental with the same query as a proposal (the tool executes it and merges the ` +
      `band itself, qid-stamped). Leave every qid-stamped block untouched`;
  } else if (/coverage_clean_tainted/.test(lastFail)) {
    // Timeout-taint gate (copper-lattice): a clean claim over an axis whose winning register-unit pass
    // was cut down mid-work. The repair is a RELABEL, never a re-search — the re-run is the driver's job
    // (taint chain / envelope), the digest's job is the honest status.
    const ax = (lastFail.match(/coverage_clean_tainted:([^\s)]+)/) || [])[1] || "";
    hint = `the register-unit pass that produced ${ax ? `axis "${ax}"` : "a tainted axis"} was killed at the ` +
      `timeout wall mid-work (the per-attempt log is code-truth you cannot argue with), so its self-reported ` +
      `clean is unverified. Relabel that axis's confirmed-clean Coverage-ledger row(s) to deferred with the ` +
      `reason "timeout-tainted pass — self-reported clean downgraded pending re-run", and change nothing ` +
      `else. Do NOT re-run searches yourself — the driver owns the re-run`;
  } else if (/declared_unavailable/.test(lastFail)) {
    hint = "you never write a fallback/partial findings file: if the perplexity_research tool returned results, write " +
      "the COMPLETE findings file from them; if the tool is genuinely failing after retries, write NO findings file " +
      "at all and report the tool failure with diagnostics in your final message (the driver fails the run — a report " +
      "must never ship without its marketplace layer)";
  } else if (/findings\+ledger|no_coverage_status_row/.test(lastFail)) {
    // — `findings+ledger` IS BACK IN THIS ALTERNATION. The first cut of this build removed it on
    // the reading that the seat never writes a Coverage-ledger table any more; that is true only on a
    // run the driver stamped as form-required, and the stamp is conditional. On an unstamped run
    // validators.registerFindings demands the table exactly as it did before and emits this label,
    // so dropping the arm left the one lane that can still fire it with a generic hint.
    hint = "the file has a findings heading plus a Coverage ledger with a status row (confirmed-clean / coverage-limited / deferred)";
  } else if (/negative-results|coverage-ledger|audit-trail|findings-heading/.test(lastFail)) {
    hint = "the findings file carries ALL required sections: a findings heading, the Negative results matrix " +
      "(every variant × platform row), the Coverage ledger with a status row, and the Audit trail call log";
  }
  return hint;
}

// ── 's DEFERRED-SLICE BLOCK IS GONE ──────────────────────────────────────────────────────
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
const FORM_CLASS_RE = /^invalid_file:[^:]*:(framediff_(key_unknown|directive_key_unknown|directives_invalid|layer_invalid|severity_invalid|gap_invalid|remedy_invalid|directive_undispatchable)|coverage_(key_unknown|axis_invalid|status_invalid|status_offenum|classes_invalid))\b/;
export function isFormClassFail(fail) {
  return FORM_CLASS_RE.test(fail ?? "");
}
// How many in-dispatch repairs one stage run may buy. TWO, and the number has a cause: parseFrameDiff
// is FAIL-FAST — it throws on the first bad severity (frame-diff-model.mjs:66) before it ever collects
// the undispatchable directives (:100) — so ONE artifact carrying both defects surfaces them
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
// is 's subject, not this one, and is handled where byte-identical output is detected.
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
// (repair-contract.mjs:10-18) is 105,747 out FAIL → 137,519 out FAIL → 36,362 out PASS, and the attempt
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
const WARM_ELIGIBLE_RE = new RegExp(`^(missing_file|invalid_file:[^:]*:(use_check_missing|own_rights_missing|coverage_ledger_unparseable|coverage_ledger_empty|coverage_axis_invalid|coverage_axis_missing|coverage_status_(invalid|offenum)|coverage_key_unknown|coverage_(no_status|form_damaged|form_axis_invalid|form_engine_vocabulary)|grid_join_missing|grid_ledger_unparseable|platforms_missing|${CONNOTATION_FORM_TOKEN_SRC}|findings?_[a-z_]+|blindframe_[a-z_]+|framediff_[a-z_]+|named_band_(state_invalid|block_invalid|unparseable|missing)|tool_timeout:[a-z_]+:[a-z0-9-]+|plan_audit_missing|intake_ask_unanswered))`);

// — `tool_timeout` IS ON THAT LIST TO KEEP ROUTING WHERE IT ALREADY IS, not to add a lane.
//
// This failure reaches the ladder today as `named_band_missing`, which is warm-eligible. Renaming the
// token without adding it here would quietly move the class from warm to COLD — a full stage re-run
// instead of a resume, on every timeout, as a side effect of an attribution fix. A rename must not
// change what a failure costs.
//
// The issue notes that 's argument applies: "the retry ladder cannot help a deterministic tool
// timeout — this failure class is an argument for the same disclosed-deferral treatment when the ladder
// is provably futile." That is a real question and it is NOT settled here. Two reasons to leave it:
// this issue's OTHER half raised the bridge cap, so a retry is no longer provably futile — R5's four
// attempts all died at a 300s cap that no longer applies; and turning a failure class into a disclosed
// deferral is a doctrine change, which is 's to make and not an attribution fix's.

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
// ('s hold). An enrolled-token veto is an ENUMERATED check: a future fifth token forgetting to
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
// 's in-dispatch repair has to know that, because it decides whether a repair LANDED by looking at
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
    : /findings?_/.test(f) ? "findings.json"   // Phase-0 contract sibling (dormant until Phase 1)
    // blindframe_ is deliberately ABSENT: blind-frame-model.json is no longer a sibling, it is the
    // stage's expectFile. Routing it here would hand the model a message that forbids rewriting the very
    // file it then orders re-saved. The generic invalid_file branch aims the patch correctly.
    : /framediff_/.test(f) ? "frame-diff.json"
    : null;
}

export function warmPatchMessage(lastFail, expectFile, { supplementalLane = false } = {}) {
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
      `If it is killed again: do NOT author band blocks by hand and do NOT narrate coverage you did not obtain. Record the timeout in your .md, state the scope you attempted, and flag CROSS-CHECK REQUIRED. That is the correct answer to a tool that will not return.`;
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
  // 's routing fixes each closed one layer up.
  if (CONNOTATION_FORM_TOKEN_RE.test(lastFail ?? "") && files.length) {
    // The ABSOLUTE spec path, derived from the failing member's own output by exactly the rule
    // gridLedgerNameFor states and for exactly the same reason: a warm patch carries no base prompt
    // behind it, so this line is the only place the resumed session is re-told which spec its calls
    // name — and a half must be aimed at ITS spec, never the canonical one.
    const halfM = basename(String(files[0])).match(/^common-law-findings\.half-([a-z0-9]+)\.md$/);
    const specPath = driverDir(dirname(files[0]), halfM ? `grid-spec.half-${halfM[1]}.json` : "grid-spec.json");
    // THE CLOSING SENTENCE IS PER STATE ('s lesson, kept): "record every outstanding row" is right
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
  // ── THE SIBLING BRANCH MUST NOT OUTRANK THE TOOL-WRITTEN ONE (, third conversion) ────────────
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
      `Your saved ${sibling} failed validation (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { gridLedgerName: gridLedgerNameFor(files), supplementalLane, undispatchable: frameDiffUndispatchable(files, lastFail) })}.\n` +
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
  // THE TOKEN-FAMILY LIST IS GONE (, third conversion), and its removal is the root-cause half. It
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
        : `What you sent did not pass (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { supplementalLane, undispatchable: frameDiffUndispatchable(files, lastFail), toolWritten: toolWritten.tool })}.\n`) +
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
    `Your saved ${defective ? rel(defective) : names || "output"} failed validation (${lastFail}). Fix exactly this: ensure ${correctionHint(lastFail, { gridLedgerName: gridLedgerNameFor(files), supplementalLane, undispatchable: frameDiffUndispatchable(files, lastFail) })}.\n` +
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
