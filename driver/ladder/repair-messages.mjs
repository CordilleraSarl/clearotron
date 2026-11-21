// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ladder/repair-messages.mjs — what a corrective, warm or timed-out turn is told: the repair hints keyed by failure code,
// the corrective message with its patch rows and held-record clauses, the warm patch and timeout messages, and the file a
// repair targets.
//
// Moved out of gateway.mjs unchanged, so that the ladder's phases import these instead of having them handed in.
import { CONNOTATION_FORM_TOKEN_RE, CONNOTATION_NO_RESEMBLANCE_MARK, CONNOTATION_UNMATCHED_MARK } from "../connotation-search.mjs";
import { REGISTER_AXES } from "../coverage-ledger.mjs";
import { DISPOSITIONS, POSITION_REQUIRED_DISPOSITIONS } from "../findings-model.mjs";
import { undispatchableFiringDirectives } from "../frame-diff-model.mjs";
import { CLEARANCE_FINDINGS_TOKEN_RE, gridLedgerNameFor, repairSiblingName, toolWrittenArtifact } from "./form-sync.mjs";
import { rel } from "./turn-signals.mjs";
import { PLAN_AUDIT_CLASSES } from "../register-plan.mjs";
import { abbrev, editRepairTail, failingTarget, fullWriteTail } from "../repair-contract.mjs";
import { NO_SEARCH_RESULT, RESEARCH_CORRECTION } from "../research-answers.mjs";
import { driverDir } from "../run-record.mjs";
import { SUPPLEMENTAL_LANE_STEERING } from "../stages.mjs";
import { FINDINGS_FILE, NARRATIVE_FILE, synthesisCallPaths } from "../synthesis-record.mjs";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

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

// ── A FAILURE'S CODES: THE TOKENS ITS REASON CARRIES ─────────────────────────────────────────────
//
// A validator's failure opens with its token (`coverage_form_damaged`, `framediff_model_missing`), and the
// ladder wraps it as `[max_tokens_no_output:](invalid_file|missing_file):<artifact>[:<reason>]`. Those tokens
// are the failure's codes, and every route a failure takes to a repair turn carries them: the ladder's own
// string, the draft carry that rebuilds it around a file's base name, the merged-findings gate's token. So the
// codes are read from the string, in one place, rather than handed along beside it, where a route that
// carries only the string would lose them. The artifact's name is not a code: `register-coverage-ledger.json`
// failing with a token no row names is not a missing prose section.
//
// ONE COMPATIBILITY CODE READS THE NAME, kept on 2026-11-21 so that no sentence a model reads changes: before codes,
// the prose-sections row matched `coverage-ledger` anywhere in the string, so every failure that names the
// coverage ledger, in its file or in a word, and that no earlier row answers, was handed the prose-sections
// sentence. It still is, under its own code, at that row's place in the table, which keeps its priority:
// a failure whose own token has a row gets that row, as it did.
export const NAMES_THE_COVERAGE_LEDGER = "named:coverage-ledger";
const WRAPPED_RE = /^((?:max_tokens_no_output:)?)(invalid_file|missing_file):([^:\s]+)(.*)$/s;
const TOKEN_RE = /[a-z0-9]+(?:[_+-][A-Za-z0-9]+)*/g;   // a token opens in lower case, as every row's code does

/**
 * The codes a failure string carries: each token of its reason, and whether a detail follows it (`token:…`), plus
 * NAMES_THE_COVERAGE_LEDGER where the string names that ledger. The artifact segment of a wrapped failure is not
 * read. PURE.
 */
export function failureCodes(lastFail) {
  const s = String(lastFail ?? "");
  const m = WRAPPED_RE.exec(s);
  const reason = m ? `${m[1]}${m[2]}${m[4]}` : s;
  const tokens = [...reason.matchAll(TOKEN_RE)].map((t) => ({ token: t[0], detail: reason[t.index + t[0].length] === ":" }));
  return { tokens, namesTheCoverageLedger: s.includes("coverage-ledger") };
}

/** Does this row answer that code? By name, by family prefix, or by name with a detail after it. PURE. */
const answers = (row, { token, detail }) => (row.codes ?? []).includes(token)
  || (row.families ?? []).some((f) => token.startsWith(f)) || (detail && (row.withDetail ?? []).includes(token));

/**
 * The row a failure selects and the code that selected it: the FIRST row, in table order, that answers one of the
 * failure's codes. `by` names the token, or NAMES_THE_COVERAGE_LEDGER, so a test can say why a sentence was chosen.
 * Null when no row answers, and the failure gets REPAIR_HINT_DEFAULT. PURE.
 */
export function hintSelection(lastFail) {
  const { tokens, namesTheCoverageLedger } = failureCodes(lastFail);
  for (const row of REPAIR_HINTS) {
    const hit = tokens.find((c) => answers(row, c));
    if (hit) return { row, by: hit.token };
    if (namesTheCoverageLedger && (row.codes ?? []).includes(NAMES_THE_COVERAGE_LEDGER)) return { row, by: NAMES_THE_COVERAGE_LEDGER };
  }
  return null;
}

// ── THE REPAIR HINTS: ONE ROW PER FAILURE, READ IN ORDER ─────────────────────────────────────────
//
// Each row names the failure it answers (`code`), the codes that select it (`codes` by name, `families` by
// prefix, `withDetail` by name with a detail after it), and the end state the corrective turn is told to reach
// (`hint`). The FIRST row answering one of a failure's codes answers, so the order is part of the table: a
// row that must sit above another says so in its own comments, as the findings row does above the coverage
// rows. A failure no row answers gets REPAIR_HINT_DEFAULT. `failureCode` names the row a failure selects, so
// a test or a record can say which repair a turn was handed without matching the sentence. Which token each
// validator mints, and which row or the default answers it, is held by
// every-failure-token-is-answered-or-takes-the-default.test.mjs.
export const REPAIR_HINTS = [
  { code: "findings_contract", families: ["finding_", "findings_"], codes: ["synthesis_findings_invalid", "synthesis_findings_missing"], hint(lastFail, { heldRecord, adds }) {
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
  { code: "coverage_status_offenum", codes: ["coverage_status_offenum"], hint(lastFail) {
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
  { code: "coverage_ledger_shape", codes: ["coverage_ledger_unparseable", "coverage_ledger_empty", "coverage_axis_invalid", "coverage_axis_missing", "coverage_status_invalid", "coverage_key_unknown", "coverage_mirror_missing"], hint(lastFail, { resaveClause }) {
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
  { code: "use_check_missing", codes: ["use_check_missing"], hint(lastFail) {
    return "every finding the failed check names by number, a finding at a material band whose owner's use is recorded as " +
      "confirmed or not-confirmed, carries the cite of record in its `use_check.source`: a result URL, or " +
      "'perplexity_research — no result'. Run the scoped marketplace use-check (owner + mark + goods/field) and record " +
      "its result there, or record the honest 'no result'; never assert a use-negative you did not search";
  } },
  { code: "connotation_form_damaged", codes: ["connotation_form_damaged"], hint(lastFail) {
    // The accumulator is DRIVER-WRITTEN, so a damaged row is a narrow, nameable fault: a row's recorded
    // receipt is no longer one of that row's own candidates (the ledger regenerates candidates every
    // pass, so a top-up can orphan a recorded id). The remedy is ONE tool call about the named row —
    // never a file edit; the seat writes no dispositions file.
    return "every recorded row's receipt is one of THAT ROW's own listed candidates. Re-send ONLY the " +
      "named row(s) through the `record_dispositions` tool with `receipt_index` set to the POSITION of " +
      "the candidate you ruled on in that row's own list (1, 2, …) — never a typed id. Your other rows " +
      "are recorded and KEPT; do not re-send them and do not write any file";
  } },
  { code: "connotation_quote_unbound", codes: ["connotation_quote_unbound"], hint(lastFail) {
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
  { code: "connotation_call_never_made", codes: ["connotation_call_never_made"], hint(lastFail) {
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
  { code: "connotation_call_truncated", codes: ["connotation_call_truncated"], hint(lastFail) {
    // B — a call STARTED and never returned: a driver-side or transport fault, NOT a fault in the
    // rulings. The one message a seat must never take from this is "re-derive your rulings".
    return "the `record_dispositions` call(s) that never returned are re-sent AS THEY WERE. This is NOT a " +
      "fault in your rulings — a call was killed in flight before its rows were recorded, which is the " +
      "driver's fault, not yours. Do not re-derive or change any ruling: call `record_dispositions` again " +
      "with the same rows for whatever the tool's answer still lists as outstanding, and stop when it " +
      "reports nothing outstanding";
  } },
  { code: "connotation_call_schema_violation", codes: ["connotation_call_schema_violation"], hint(lastFail) {
    // B — calls arrived and not one row was accepted from any of them: the payload SHAPE is wrong. The
    // remedy is the shape, never the rulings — the tool's own answer named each refusal in-turn.
    return "the `record_dispositions` payload has the right SHAPE — the rulings themselves are not in " +
      "question. `rows` must be an ARRAY of objects, each with `row_index` (the obligation's NUMBER in the " +
      "obligations block) as an INTEGER, `ruling`, `note`, and `receipt_index` as an INTEGER position " +
      "(1, 2, …) — never a typed id of any kind, never a query string, never a string index, never extra " +
      "fields. Re-send your rulings with the corrected " +
      "shape; the tool's answer names each refusal and what is still outstanding";
  } },
  { code: "connotation_call_partial", codes: ["connotation_call_partial"], hint(lastFail) {
    // B — rows landed and obligations remain. What is recorded is KEPT; the remedy is the remainder.
    return "every remaining meaning obligation is recorded through the `record_dispositions` tool. " +
      "Everything you already recorded is KEPT — do not re-send it and do not re-derive it. Call " +
      "`record_dispositions` with rows for ONLY the obligations the failure counts as outstanding " +
      "(the tool's answer lists them and marks which still owe a `segment_index` and a `fragment`), and " +
      "stop when it reports nothing " +
      "outstanding. Rule from what the receipts say, never from memory, and carry any loaded reading " +
      "into Findings as well";
  } },
  { code: "meaning_angles_missing", codes: ["meaning_angles_missing", "matterframe_meaning_angles", "matterframe_meaning_angles_contradictory", "matterframe_meaning_angles_missing"], hint(lastFail) {
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
  { code: "own_rights_missing", codes: ["own_rights_missing"], hint(lastFail) {
    return "every finding whose clearance reasoning relies on the client's own house mark / franchise root ENDS " +
      "with an \"**Own-rights source:** <record URI(s) | 'no applicant-owned registrations in the searched register material'>\" line — " +
      "run ONE owner-scoped band_lookup over the run's frozen register material (plus band_record for any cite) and cite the record URIs, " +
      "or state the honest SCOPED negative (never a portfolio-wide 'no registrations found' — the frozen material covers only this " +
      "matter's dispatched slices), adjust the reasoning to stand without the crutch, and record the missing owner query as an open " +
      "Coverage/open-item row for the escalation lane; the affiliate-exclusion mandate covers CONFLICTS, never this supporting evidence";
  } },
  { code: "blindframe", families: ["blindframe_"], hint(lastFail) {
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
  { code: "framediff_directive_undispatchable", codes: ["framediff_directive_undispatchable"], hint(lastFail, { undispatchable }) {
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
  { code: "framediff", families: ["framediff_"], hint(lastFail) {
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
  { code: "receipts_short", codes: ["receipts_short"], hint(lastFail) {
    const shorts = (lastFail.match(/receipts_short:([^\s]+)/) || [])[1] || "";
    return `the Negative-results matrix accounts for EVERY (variant × platform) grid cell — these variants are ` +
      `short (variant:rows/expected): ${shorts}. Re-transcribe their cells from the grid call's stdout JSON ` +
      `(every cell needs a receipt row: "No results" / "No similar listings (N candidates reviewed)" / ` +
      `"Similar listing(s) found — see Findings" / "not executed — coverage-limited"); re-run the grid call ` +
      `only if those cells are genuinely absent from its output`;
  } },
  { code: "grid_ledger_unparseable", codes: ["grid_ledger_unparseable"], hint(lastFail, { gridLedgerName }) {
    return `${gridLedgerName} is the grid call's stdout JSON saved VERBATIM — a single stdout object, or a ` +
      `JSON ARRAY of the per-batch stdout objects in batch order, each with its cells[] (and gaps[]) intact. ` +
      `Re-save the file exactly as the tool returned it — no reformatting, no re-typing, no judging. If the ` +
      `saved file is TRUNCATED mid-string (an unterminated value near the end), your single call's stdout ` +
      `EXCEEDED the output budget: re-run the grid SPLIT into MORE, SMALLER batches (fewer variants per call) ` +
      `and save each batch's stdout as its own element of the JSON array — never try to re-emit one oversized object.`;
  } },
  { code: "grid_join_missing", codes: ["grid_join_missing"], hint(lastFail, { gridLedgerName }) {
    const shorts = (lastFail.match(/grid_join_missing:([^\s]+)/) || [])[1] || "";
    return `the saved ${gridLedgerName} must account for EVERY dictated (variant × platform) grid cell — ` +
      `these variants are short (variant:cells/expected): ${shorts}. Append the missing cells' grid stdout to ` +
      `the JSON (make the file a JSON array of stdout objects if it is not already), re-running ONLY the cells ` +
      `genuinely absent from the prior output; then make sure the Negative-results matrix matches`;
  } },
  { code: "platforms_missing", codes: ["platforms_missing"], hint(lastFail, { gridLedgerName }) {
    // capture to end-of-string: real manifest variants are multi-word, a [^\s]+ capture would chop
    // "PROJECT NOVA PULSE:itch.io+…" at the first space and dictate a garbage cell list.
    const det = (lastFail.match(/platforms_missing:(.+)$/s) || [])[1] || "";
    return `the grid must sweep EVERY platform DICTATED in your task message's PLATFORMS list — never a ` +
      `remembered or skill-example list. These variants are missing dictated platforms ` +
      `(variant:domain+domain): ${det}. Run exactly those missing (variant × platform) cells, append their ` +
      `stdout to ${gridLedgerName}, and account for them in the Negative-results matrix`;
  } },
  { code: "connotation_query_unrecorded", codes: ["connotation_query_unrecorded"], hint(lastFail, { gridLedgerName }) {
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
  { code: "connotation_search_missing", codes: ["connotation_search_missing"], hint(lastFail) {
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
  { code: "named_band_collapsed", codes: ["named_band_collapsed"], hint(lastFail, { supplementalLane }) {
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
  { code: "intake_ask_unanswered", codes: ["intake_ask_unanswered"], hint(lastFail) {
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
  { code: "tool_timeout", withDetail: ["tool_timeout"], hint(lastFail) {
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
  { code: "named_band_missing", codes: ["named_band_missing"], hint(lastFail) {
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
  { code: "named_band_shape", codes: ["named_band_state_invalid", "named_band_block_invalid", "named_band_unparseable"], hint(lastFail, { supplementalLane }) {
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
  { code: "plan_audit_missing", codes: ["plan_audit_missing", "refutation_plan_audit_missing"], hint(lastFail) {
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
  { code: "coverage_no_status", codes: ["coverage_no_status"], hint(lastFail) {
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
  { code: "coverage_form_axis_invalid", codes: ["coverage_form_axis_invalid"], hint(lastFail) {
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
  { code: "coverage_form_damaged", codes: ["coverage_form_damaged"], hint(lastFail) {
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
  { code: "coverage_form_missing", codes: ["coverage_form_missing", "coverage_form_empty"], hint(lastFail) {
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
  { code: "coverage_deferred_unaccounted", codes: ["coverage_deferred_unaccounted"], hint(lastFail) {
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
  { code: "coverage_clean_unverified_incomplete", codes: ["coverage_clean_unverified_incomplete"], hint(lastFail) {
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
  { code: "coverage_clean_unexecuted", codes: ["coverage_clean_unexecuted"], hint(lastFail) {
    // T1 (J6): the F3 gate — a clean claim over a slice the plan-execution receipt says never ran.
    const ax = (lastFail.match(/coverage_clean_unexecuted:([^\s)]+)/) || [])[1] || "";
    return `the plan-execution receipt says ${ax ? `axis "${ax}"` : "a dictated axis"} did NOT fully execute, ` +
      `yet your findings claim it clean. Either the claim is wrong — correct it to an honest ` +
      `coverage-limited/deferred row carrying the mechanical reason from the receipt — or the coverage ` +
      `actually ran and your ledger row mis-states it: fix the row to match the receipt. A clean can never ` +
      `rest on a slice the plan dictated and nothing ran`;
  } },
  { code: "band_block_unplanned", codes: ["band_block_unplanned"], hint(lastFail) {
    // copper-lattice re-route: a hand-authored band block under the supplemental_lane contract.
    const qs = (lastFail.match(/band_block_unplanned:([^\s)]+)/) || [])[1] || "";
    return `this run's register plan carries the supplemental_lane contract: EVERY band block is written by ` +
      `a TOOL and carries a qid — you never author band blocks. The qid-less block(s) (${abbrev(qs, 100)}) came ` +
      `from a hand append. REMOVE them from the band file, then re-run their queries the sanctioned way: ` +
      `register_propose_supplemental with the same query as a proposal (the tool executes it and merges the ` +
      `band itself, qid-stamped). Leave every qid-stamped block untouched`;
  } },
  { code: "coverage_clean_tainted", codes: ["coverage_clean_tainted"], hint(lastFail) {
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
  { code: "declared_unavailable", codes: ["declared_unavailable"], hint(lastFail) {
    return "you never write a fallback/partial findings file: if the perplexity_research tool returned results, write " +
      "the COMPLETE findings file from them; if the tool is genuinely failing after retries, write NO findings file " +
      "at all and report the tool failure with diagnostics in your final message (the driver fails the run — a report " +
      "must never ship without its marketplace layer)";
  } },
  { code: "coverage_status_row", codes: ["findings+ledger", "no_coverage_status_row"], hint(lastFail) {
    // — `findings+ledger` IS BACK IN THIS ALTERNATION. The first cut of this build removed it on
    // the reading that the seat never writes a Coverage-ledger table any more; that is true only on a
    // run the driver stamped as form-required, and the stamp is conditional. On an unstamped run
    // validators.registerFindings demands the table exactly as it did before and emits this label,
    // so dropping the arm left the one lane that can still fire it with a generic hint.
    return "the file has a findings heading plus a Coverage ledger with a status row (confirmed-clean / coverage-limited / deferred)";   // the common-law clause went with that lane's status gate (ruling 2026-10-01)
  } },
  { code: "prose_sections", codes: ["negative-results", "coverage-ledger", "audit-trail", "findings-heading", NAMES_THE_COVERAGE_LEDGER], hint(lastFail) {
    return "the findings file carries ALL required sections: a findings heading, the Negative results matrix " +
      "(every variant × platform row), the Coverage ledger with a status row, and the Audit trail call log";
  } },
];

const REPAIR_HINT_DEFAULT = "the required output file is actually written and contains every required section IN FULL";

export function correctionHint(lastFail, { gridLedgerName = "common-law-grid.json", supplementalLane = false, undispatchable = [], toolWritten = null, heldRecord = false, adds = false } = {}) {
  // The repair act, for the hints that name one. Kept to a single sentence and a single decision so a
  // new hint has one thing to append rather than a branch to reproduce.
  const resaveClause = toolWritten
    ? `Fix exactly that and send the corrected values — the driver re-derives this file and the prose table together from your \`${toolWritten}\` call, so there is nothing here for you to save`
    : `Fix exactly that, re-save the COMPLETE JSON file, and leave the prose table unchanged`;
  const row = hintSelection(lastFail)?.row;
  return row ? row.hint(lastFail, { resaveClause, gridLedgerName, supplementalLane, undispatchable, toolWritten, heldRecord, adds }) : REPAIR_HINT_DEFAULT;
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
