// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ladder/form-sync.mjs — the forms a stage writes through its tools, as the ladder reads them: the disposition, coverage
// and placement forms synced to their files, the artifact a tool wrote, the artifact a failure grades, the said-back
// refusals, and which failures are a form's class and how many in-dispatch repairs one may take.
//
// Moved out of gateway.mjs unchanged, so that the ladder's phases import these instead of having them handed in.
import { MODEL_FILE as BLIND_FRAME_MODEL_FILE } from "../blind-frame-record.mjs";
import { MODEL_FILE as VARIANT_MODEL_FILE, PROSE_FILE as VARIANT_PROSE_FILE } from "../clearance-variants-record.mjs";
import { connotationObligations, parseDispositionForm, parsePrRiskResults } from "../connotation-search.mjs";
import { coverageFormStamp, readCoverageForm, readCoverageFormInput, writeCoverageForm } from "../coverage-form-io.mjs";
import { unionCoverageForm } from "../coverage-union.mjs";
import { formSidecarPath, unionDispositionForm } from "../disposition-union.mjs";
import { MODEL_FILE as FRAME_DIFF_MODEL_FILE, PROSE_FILE as FRAME_DIFF_PROSE_FILE } from "../frame-diff-record.mjs";
import { KNOCKOUT_ASSESS_CHUNK_RE, knockoutAssessChunkFile } from "../knockout-assess-record.mjs";
import { KNOCKOUT_CORRECTION_RE, knockoutCorrectionFile } from "../knockout-correction-record.mjs";
import { frameRefusalsFor } from "../knockout-frame-record.mjs";
import { knockoutRegisterRefusalsFor } from "../knockout-register-record.mjs";
import { knockoutReviewRefusalsFor } from "../knockout-review-record.mjs";
import { note } from "../log.mjs";
import { MATTER_CONTEXT_FILE } from "../matter-frame-record.mjs";
import { placementFormStamp, readPlacementForm, readPlacementFormInput, readSubmittedPlacementForm, readSubmittedPlacementSetAside, renderPlacementsFile, writePlacementForm } from "../placement-form-io.mjs";
import { placementRenderAccount } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { FINDINGS_FILE as REGISTER_FINDINGS_FILE, refusalsFor as registerDigestRefusalsFor } from "../register-digest-record.mjs";
import { unitRefusalsFor } from "../register-unit-record.mjs";
import { abbrev } from "../repair-contract.mjs";
import { PROSE_FILE as REPORT_OVERVIEW_FILE } from "../report-overview-record.mjs";
import { driverDir, readJson } from "../run-record.mjs";
import { FLAGS_FILE as SKEPTIC_FLAGS_FILE } from "../skeptic-record.mjs";
import { FINDINGS_FILE, NARRATIVE_FILE, refusalsFor } from "../synthesis-record.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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
  // The knockout lane's reviewing pass. ONE EXACT BASENAME, at the run root: the pass's answer and the material defects it found,
  // not a surface a client is shown. The row is what makes a repair on this stage a CALL: the seat's grant carries no Write, so a
  // ladder handing it the write form would order a hand-write it cannot perform.
  ["knockout-review.json", { tool: "record_knockout_review", what: "your answer and the material defects you found",
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
export const CLEARANCE_FINDINGS_TOKEN_RE = /(?<!knockout_|knockoutassess_)findings?_/;

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
export const MAX_FORM_REPAIRS = 2;

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
export const SAID_BACK_TOKEN_SRC = "placement_(?:floors_without_fate|refused)=";
const SAID_BACK_REASON_RE = new RegExp(`^${SAID_BACK_TOKEN_SRC}`);
/** Is a validator's refusal a said-back one, a duty the output leaves open rather than an invalid output? PURE. */
export const saidBackOnly = (reason) => SAID_BACK_REASON_RE.test(String(reason ?? ""));

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
export function repairSiblingName(lastFail, expectFile) {
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
