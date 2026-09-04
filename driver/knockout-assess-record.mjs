// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// knockout-assess-record.mjs — the recording transport for the knockout lane's rated assessment.
//
// THE FIRST CONVERSION ON A SECOND PRODUCT LANE ( item B). Every conversion before this
// one landed on the shared clearance pipeline, which three of the four products are configurations of.
// Knockout is the one product on its own lane — its own stage table, pipeline, verify and publish modules
// — so it inherited none of that work as a side effect, and it delivers to clients.
//
// ── WHAT THIS ACCEPTOR TAKES, AND WHAT IT DELIBERATELY LEAVES BEHIND ────────────────────────────────
//
// It takes the SHAPE: required keys, types, the array bounds, the closed finding-record keys, and the
// by-path refusal of anything undeclared. Those are the checks a typed schema can express.
//
// ✕ IT DOES NOT LET THE PER-CHUNK PROSE GATES COME OUT OF verify-knockout.mjs, and an earlier draft of
// this comment said it did. That was wrong, and the error is worth keeping written down because it is
// the natural thing to assume about a typed conversion.
//
// BANNED_TONE_RE, QUANT_CLAIM_RE, REGISTER_CLAIM_RE and the permission-prose checks read the CONTENT of
// model-authored strings — `basis`, `factors`, `counterFactors`, `mitigation`, `bullets`, `purpleNotes`,
// `registerEstimate`, `contextFraming`, `chunkSummary`. Typing the envelope says nothing about what is
// inside a string. A seat can hand back a perfectly typed call whose `basis` reads "the registers were
// not run" or "extremely difficult" or "37 million streams", and every check this acceptor performs
// passes it. Deleting those gates because the transport is typed would remove the only thing standing
// between that sentence and a client's page.
//
// Nor do the validator's own SHAPE checks come out, for a different reason: it still runs over artifacts
// this transport did not write — an archived run resumed from disk, or a chunk written before the
// conversion. Same reason the merged-prose register backstop stays.
//
// So this conversion ADDS a gate; it removes none. What it buys is not a shorter validator:
//   · the seat holds no Write for this artifact, which is what ends the ladder-exhaustion failure
//     that came from ordering a write the boundary refused
//   · a defect is refused AT THE CALL, where the seat still has the material to fix it, instead of
//     surfacing as a stage failure a repair turn has to reconstruct
//   · the chunk's bytes and the chunk's identity are both the driver's
//
// IT TAKES NOTHING THAT READS DRIVER STATE, and that split is the whole design rather than an omission.
// `knockoutAssessChunk` keeps every check that joins this payload against something the driver holds:
//
//   · the frozen band ladder          (_driver/framework.json — is this rating in the framework?)
//   · chunk assignment                (_driver/knockout-chunks.json — are these THIS chunk's marks?)
//   · whole-batch multi-mark          (knockout-plan.json — does the per-mark requirement fire?)
//   · research-payload / degraded     (research/<mark>.md on disk — both directions)
//
// A schema cannot express any of those: they are joins, not shapes. Moving them here would ALSO be the
// mistake this conversion exists to avoid — the chunk's identity is the DRIVER's (see below), and a check
// that both derives identity from the payload and validates the payload against it has stopped checking
// anything.
//
// ── THE BOUND ORDINAL IS THE DRIVER'S, AND THE ALTERNATIVE WAS REJECTED ─────────────────────────────
//
// Which chunk this call is writing arrives by env from the driver (`CLEAROTRON_RECORD_AXIS`, set per turn by
// serverEnv from the same label the grant was resolved from). It is never taken from the payload.
//
// A MARKS-DERIVED IDENTITY WAS CONSIDERED AND REJECTED, and the rejection is recorded because the join
// against knockout-chunks.json is sitting right there and reads as a simplification. It must not be
// taken. Today the identity comes from the ordinal the driver bound, and the marks are then joined to
// CHECK membership. Derive identity FROM the marks and the membership guard becomes the decision: a seat
// that rates the wrong marks no longer fails a check — it writes to a different chunk file and passes.
// That is the guard and the thing it guards collapsing into each other.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { refuseUndeclared as refuseUndeclaredShared, keepIfAbsent, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";
// THE VALIDATOR'S OWN PREDICATE, imported rather than restated. Two spellings of one closed set is how
// the call and the stage come to disagree about what is legal, which is the defect this check closes.
import { normalizeKnockoutQualifier, KNOCKOUT_RATING_QUALIFIERS } from "./verify-knockout.mjs";

const SCHEMA_VERSION = 1;

/**
 * THE CHUNK ARTIFACT'S NAME SHAPE — the ONE copy, and every consumer imports it from here.
 *
 * It existed FIVE times before this conversion and would have been six: the constructor in
 * `stages-knockout.mjs` (`koPaths().assessChunk`), a second constructor here, the validator's
 * chunk-number parse in `verify-knockout.mjs`, the guarded-write test's, and the mock's. Six independent
 * spellings of one filename, joined by nothing. The registry row in `gateway.mjs` reads THIS regex rather
 * than restating it, because a table that re-types a pattern is a table that can disagree with the file
 * it claims to describe while every arm on both sides stays green.
 *
 * ANCHORED AT BOTH ENDS, ON THE BASENAME, and the run root is why that matters more here than it would in
 * a directory. This artifact's siblings live beside it: `knockout-assessment.md` (the merged prose, still
 * HAND-WRITTEN) and `knockout-findings.json` (the merged findings). An unanchored `^knockout-assess`
 * matches the first of those, and a false match does not fail loudly — it re-routes that artifact's repair
 * to a tool that cannot write it, telling a seat to call instead of write. That is the same over-match
 * hazard `TOOL_WRITTEN_DIRS` documents for `register-units/`, except nothing here scopes it to a directory.
 */
export const KNOCKOUT_ASSESS_CHUNK_RE = /^knockout-assess-\d+\.json$/;

/** The artifact this transport writes: one chunk of the rated assessment, at the RUN ROOT. */
export function knockoutAssessChunkFile(runDir, chunkNo) {
  return join(String(runDir ?? ""), `knockout-assess-${Number(chunkNo)}.json`);
}

/**
 * The chunk index carried by a chunk artifact's path, or `null` if the path is not one.
 *
 * The validator recovers this index to join a chunk against its assigned marks, so a path that is not a
 * chunk must answer `null` and never `NaN`: `Number(null)` is 0, and a membership join keyed on chunk 0
 * for a file that is not chunk 0 is the silent-wrong-answer direction.
 */
export function knockoutAssessChunkNo(p) {
  const base = String(p ?? "").split("/").pop() ?? "";
  if (!KNOCKOUT_ASSESS_CHUNK_RE.test(base)) return null;
  return Number(base.slice("knockout-assess-".length, -".json".length));
}

/**
 * Where the call's evidence lives — the driver's own record of what the seat handed it, PER CHUNK.
 *
 * Per chunk and not per run: a run has as many of these calls as it has chunks, and one shared directory
 * would let chunk 2's capture overwrite chunk 1's. The captures are the discriminator this conversion is
 * proven by, so losing one loses the proof for that chunk.
 */
export function knockoutAssessCallPaths(runDir, chunkNo) {
  const dir = driverDir(runDir, join("knockout-assess-calls", `chunk-${Number(chunkNo)}`));
  return { dir, payload: join(dir, "call-001.json"), accepted: join(dir, "accepted.json") };
}

/**
 * THE SHAPE THIS TOOL DECLARES, at every depth — the same shape `tools/list` serves the seat.
 *
 * BUILT FROM THE VALIDATOR AND THE DISPATCH MESSAGE, NOT FROM THE STAGE'S DOCTRINE BLOCK, and the
 * difference is not academic. `skills/knockout-assess/SKILL.md` prints an explicit output template, and
 * five fields `knockoutAssessChunk` REQUIRES are absent from it — `counterFactors` appears nowhere in
 * that document at all. The fields are ordered by the dispatch message instead, so the doctrine block is
 * stale by omission and a seat building to it would be refused. Building this list from the block would
 * have shipped a schema that refuses legitimate calls, and on this lane a refused call is a knockout
 * report that does not ship. Recorded on the tracker for whoever owns the doctrine; not edited here,
 * because that file is engine input and changing it is a design call.
 */
const DECLARED = Object.freeze({
  "": ["schema_version", "framework", "batch", "chunkSummary", "marks"],
  framework: ["source", "ladder"],
  batch: ["productContext", "standardCaveats"],
  marks: [
    "ref", "name", "classesSearched", "beltAndBraces", "contextFraming", "rating", "ratingQualifier",
    "classesDriving", "bullets", "purpleNotes", "registerEstimate", "parodyNote", "crowdedField",
    "findings", "negatives", "degraded",
    // the typed read — required by the validator, absent from the doctrine's own shape block
    "basis", "factors", "counterFactors", "mitigation", "assessment",
    // — the rater's read of a filing it was handed and weighed but did not raise as a
    // conflict. Rows of { recordId, read }; the recordId is JOINED against the run's own register record
    // store, so it is a fact and not an echo.
    "registerReads",
  ],
  // "closed keys, all eight, no others" — the doctrine's own words, and the one place it is stricter
  // than the template around it.
  // — `weighedFilings` is the register record ids this finding's reasoning rests on.
  // It exists so the SOURCE of a finding is a driver fact rather than a label: stages.mjs already
  // classifies source_type as `mechanical:code-extracted` for the clearance lane, on the ground that
  // "the lane that produced the record is a driver fact". The chip is derived from this joined list and
  // from the finding's own receipted evidence — never from a word the seat typed about itself.
  "marks.findings": ["ordinal", "name", "owner", "band", "net", "type", "evidence", "basis", "weighedFilings"],
  "marks.registerReads": ["recordId", "read"],
  "marks.negatives": ["term", "source", "note"],
});

/**
 * Refuse an undeclared key by path. THE SHARED IMPLEMENTATION (preserve-merge.mjs), which six transports
 * now use — reused rather than rebuilt, per this issue's own owner ruling.
 *
 * THE HAND-ROLLED FIRST CUT OF THIS WAS A PRODUCT-FAILURE RISK, and the shared module is why it did not
 * ship. Mine refused undeclared keys at the TOP LEVEL as well as inside typed sub-objects. The shared one
 * deliberately does not, and its comment gives the measurement: real traffic carries envelope fields no
 * tool schema declares, and the strict form made those FATAL — the whole stage refused, the run dead, for
 * a key nobody reads. On this lane that is a knockout report that does not ship, which the ruling names a
 * product failure rather than a pass.
 *
 * `basis` is the live hazard the DEPTH half catches here: it is a real key on a MARK and a real key on a
 * FINDING, so a seat that puts the mark's one-sentence band rationale inside a finding record has written
 * something entirely well-formed and lost the report's lead line.
 */
export const refuseUndeclared = (params) => refuseUndeclaredShared(params, DECLARED, "knockoutassess");

/** The last ACCEPTED call for this chunk, or null when there is none. */
export function lastAcceptedChunk(runDir, chunkNo) {
  return lastAccepted(knockoutAssessCallPaths(String(runDir ?? ""), chunkNo).accepted, readFileSync);
}

const nameKey = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Merge a call onto the last accepted one — EVERY KEY DECIDED HERE, BEFORE THE CODE.
 *
 * A repair rung re-asks the seat and a seat commonly returns only what it corrected. A wholesale write
 * would then DELETE everything it omitted, which is how one lane lost fifteen findings and four sections
 * from a delivered report. So each key states its rule:
 *
 *   marks             MERGED BY NAME. The mark name is the natural join key — it is what the chunk
 *                     assignment is expressed in, what the report renders under, and what a repair names
 *                     when it corrects one row. A patch carrying one mark corrects that mark and leaves
 *                     its siblings standing. THE ARM ASSERTS THE SURVIVOR, not the corrected row: a
 *                     happy-path test passes on a merge that deletes everything it was not handed.
 *   chunkSummary      REPLACED when present, KEPT when absent. It narrates the whole chunk, so a partial
 *                     summary is not a thing — either the seat restated it or it did not.
 *   batch             MERGED PER KEY. Chunk 0 only, and its two keys are independent: a correction to
 *                     productContext must not drop standardCaveats.
 *   framework         REPLACED when present. It is one object naming the deck and its ladder; half a
 *                     ladder is not a ladder.
 *   schema_version    THE DRIVER'S. Never taken from the payload — a stored document's version is a fact
 *                     about the writer, not a value the writer may assert.
 *
 * A mark arriving under a name the stored call does not carry is APPENDED, not refused: chunk membership
 * is the validator's join against the driver's own sidecar, and refusing here would answer that question
 * twice, in two places, from two sources.
 */
export function mergeKnockoutAssessCall(stored, received) {
  const base = stored && typeof stored === "object" ? stored : null;
  const patch = received && typeof received === "object" ? received : {};
  if (!base) return { ...patch, schema_version: SCHEMA_VERSION };

  const out = { ...base, schema_version: SCHEMA_VERSION };

  // keepIfAbsent, not `if (x)`: `undefined` is "I did not speak about this" and the stored value stands,
  // while "" is "I say there is none" and is honoured as the statement it is. Collapsing the two turns a
  // preserve-merge into a replace-merge for any seat that sends an empty value, silently.
  out.chunkSummary = keepIfAbsent(patch.chunkSummary, base.chunkSummary);
  out.framework = keepIfAbsent(patch.framework, base.framework);
  if (patch.batch !== undefined) {
    out.batch = { ...(base.batch && typeof base.batch === "object" ? base.batch : {}),
      ...(patch.batch && typeof patch.batch === "object" ? patch.batch : {}) };
  }

  if (Array.isArray(patch.marks)) {
    const merged = Array.isArray(base.marks) ? [...base.marks] : [];
    const at = new Map(merged.map((m, i) => [nameKey(m?.name), i]));
    for (const row of patch.marks) {
      const k = nameKey(row?.name);
      const i = at.get(k);
      if (i === undefined) { at.set(k, merged.length); merged.push(row); }
      else merged[i] = { ...merged[i], ...row };     // per-key within the mark, same reason as batch
    }
    out.marks = merged;
  }
  return out;
}

const str = (v) => (typeof v === "string" ? v.trim() : "");
const isStrArray = (v, lo, hi) =>
  Array.isArray(v) && v.length >= lo && v.length <= hi && v.every((x) => typeof x === "string" && x.trim());
const isClassArray = (v) =>
  Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 45);

/**
 * The typed checks — SHAPE ONLY. Every failure names the field and says what it is for, because the
 * corrective ladder re-asks the turn with this string and "basis is required" teaches nothing.
 */
export function acceptKnockoutAssess(params, { boundOrdinal = null } = {}) {
  if (boundOrdinal === null || boundOrdinal === "")
    return { ok: false, reason: "knockoutassess_unbound: no chunk ordinal was bound for this turn — the driver sets it from the label it dispatched, and a tool that guessed would write one chunk's ratings over another's" };

  const chunkNo = Number(boundOrdinal);
  if (!Number.isInteger(chunkNo) || chunkNo < 0)
    return { ok: false, reason: `knockoutassess_bad_ordinal:${boundOrdinal} — the bound chunk ordinal is not a whole number` };

  const chunkSummary = str(params?.chunkSummary);
  if (!chunkSummary)
    return { ok: false, reason: "knockoutassess_summary_missing: chunkSummary (2–5 sentences covering THIS chunk's marks) is required — code composes the batch executive summary from the chunks, so a chunk without one vanishes from the summary" };

  if (chunkNo === 0 && !str(params?.batch?.productContext))
    return { ok: false, reason: "knockoutassess_batch_missing: chunk 0 carries the batch object (productContext at minimum) — it is the only chunk that does, and the merged artifact takes it from there" };

  const marks = Array.isArray(params?.marks) ? params.marks : null;
  if (!marks || !marks.length)
    return { ok: false, reason: "knockoutassess_marks_missing: marks[] is required and cannot be empty — a chunk rates the marks assigned to it" };

  for (const m of marks) {
    const name = str(m?.name);
    if (!name) return { ok: false, reason: "knockoutassess_mark_unnamed: every mark carries its name verbatim" };
    if (!str(m?.rating))
      return { ok: false, reason: `knockoutassess_rating_missing:${name} — rating is required, in the framework's own band vocabulary` };
    if (!isStrArray(m?.bullets, 1, 5))
      return { ok: false, reason: `knockoutassess_bullets:${name} — 1–5 non-empty evidence bullets required` };
    if (!str(m?.basis))
      return { ok: false, reason: `knockout_read_incomplete:${name}: "basis" is required — ONE sentence saying why this band, for this name, in these classes. The report renders it as the lead line; a paragraph in "bullets" cannot fill it` };
    if (!isStrArray(m?.factors, 2, 4))
      return { ok: false, reason: `knockout_read_incomplete:${name}: "factors" must be 2–4 non-empty one-line strings — the load-bearing observations behind the band, one per line` };
    if (!isStrArray(m?.counterFactors, 1, 3))
      return { ok: false, reason: `knockout_read_incomplete:${name}: "counterFactors" must be 1–3 non-empty one-line strings — what holds this name at this band rather than the next one, either way` };
    // MITIGATION MAY BE EMPTY, and the empty string is the ANSWER rather than the absence of one: some
    // names have nothing that would move them. The key must still be present, so "nothing would move it"
    // is a thing the turn said rather than a thing it forgot — absent and a considered "none" read
    // identically on the page otherwise.
    if (typeof m?.mitigation !== "string")
      return { ok: false, reason: `knockout_read_incomplete:${name}: "mitigation" is required (may be "" when nothing would move the band — but the key must be there, so a considered "none" is not confusable with an omission)` };
    // ── THE SECOND RATING AXIS, CLOSED AT THE CALL TOO ────────────────────────
    //
    // Found by driving a CLEAN chunk through both gates and watching the driver-side validator refuse
    // what the tool had just accepted: `ratingQualifier: ""` passes here and fails there. The value was
    // declared, so nothing refused it, and the seat got `ok` at the call and a stage failure afterwards
    // — the corrective ladder then repairing a call the tool could have refused while the seat still had
    // the material in hand.
    //
    // Refused AT THE CALL now, on the validator's own predicate, for the same reason conversion 11 gave
    // for the band-record join: restating a value costs nothing at the call and everything three layers
    // downstream. `null` is a legal answer and means no qualifier — the empty string is not.
    if (m?.ratingQualifier != null && !normalizeKnockoutQualifier(m.ratingQualifier))
      return { ok: false, reason: `knockout_qualifier_unknown:${name}: ratingQualifier "${m.ratingQualifier}" is not one of ${KNOCKOUT_RATING_QUALIFIERS.join(" / ")} — the qualifier is a closed sub-gradation that can only cap a band, and anything else belongs in the band word itself. Send null when the band needs no qualifier` };
    for (const ck of ["classesSearched", "classesDriving", "beltAndBraces"]) {
      if (m?.[ck] != null && !isClassArray(m[ck]))
        return { ok: false, reason: `knockoutassess_classes:${name}.${ck} must be Nice-class integers 1–45 — these interpolate into report and email HTML, so a free string is both a contract break and an injection surface` };
    }
    for (const f of (Array.isArray(m?.findings) ? m.findings : [])) {
      if (!Number.isInteger(f?.ordinal) || f.ordinal < 1)
        return { ok: false, reason: `knockoutassess_finding_ordinal:${name} — every finding carries an integer ordinal ≥ 1, unique within the mark, most blocking first. The code renumbers them contiguously; yours breaks ties inside a band` };
      if (!str(f?.name))
        return { ok: false, reason: `knockoutassess_finding_unnamed:${name} — a finding names the CONFLICTING mark, verbatim` };
    }
  }

  const model = {
    schema_version: SCHEMA_VERSION,
    ...(params?.framework !== undefined ? { framework: params.framework } : {}),
    ...(params?.batch !== undefined ? { batch: params.batch } : {}),
    chunkSummary,
    marks,
  };
  return { ok: true, model, chunkNo };
}

/**
 * Capture, refuse, merge, validate, then write — in that order, and the order is the mechanism.
 *
 *   1. CAPTURE what arrived, before any decision. A payload recorded after validation records what we
 *      DECIDED, which is already in the answer.
 *   2. REFUSE an undeclared key BY PATH, before the merge, so a misplaced key never reaches the base.
 *   3. MERGE onto the last accepted call for THIS chunk, so an omitted key comes back rather than being
 *      deleted.
 *   4. VALIDATE the merged call — not the received one. The merged call is what gets written.
 *   5. WRITE only after 4 passes, so a refused call never becomes the base a later repair builds on.
 */
export function recordKnockoutAssess(runDir, received, { boundOrdinal = null, now = () => new Date().toISOString() } = {}) {
  const dir = String(runDir ?? "");
  if (boundOrdinal === null || boundOrdinal === "")
    return { written: null, refused: "knockoutassess_unbound: no chunk ordinal was bound for this turn — the driver sets it from the label it dispatched", captured: null, capture_failed: null };

  const chunkNo = Number(boundOrdinal);
  const paths = knockoutAssessCallPaths(dir, chunkNo);
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed
  // `call-001.json`, so a call refused and then re-sent kept only the survivor. Sequence 1 still
  // resolves to `call-001.json`, so every consumer reading that name is unmoved. Best-effort
  // throughout, as the capture always was — a lost forensic record never fails a run.
  const nameFor = (seq) => join(paths.dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, extra: { boundOrdinal: String(boundOrdinal) }, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  const undeclared = refuseUndeclared(received);
  if (undeclared)
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };

  const call = mergeKnockoutAssessCall(lastAcceptedChunk(dir, chunkNo), received);
  const verdict = acceptKnockoutAssess(call, { boundOrdinal });
  if (!verdict.ok)
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };

  const at = knockoutAssessChunkFile(dir, chunkNo);
  try {
    writeFileSync(at, JSON.stringify(verdict.model, null, 2) + "\n");
    // Step 5. Stored ONLY now, after the values passed — see the order above.
    // The shared envelope, so every transport writes the same shape. The chunk is not restated in it —
    // it is the directory this file sits in.
    writeFileSync(paths.accepted, acceptedEnvelope(call, now()));
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: at,
    refused: null,
    chunk: chunkNo,
    marks: verdict.model.marks.length,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** Was this chunk written through the typed transport? The ruled discriminator. */
export function knockoutAssessWasRecorded(runDir, chunkNo) {
  try { readFileSync(knockoutAssessCallPaths(String(runDir ?? ""), chunkNo).payload, "utf8"); return true; }
  catch { return false; }
}
