// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// steps/corrections.mjs — the functions the correction steps share: how a review's flags name findings, the rollback
// and repair of a corrective pass, and the correction after a repair's review.
//
// Moved out of pipeline.mjs unchanged. The names below are still held there, and this module must not import that one
// back, so pipeline.mjs hands them in once, as it loads, through useThePipeline(); each moves here when the code that
// shares it has moved.
import { driverDir } from "../../shared/driver-dir.mjs";
import { correctionTargets } from "../corrections-delivered.mjs";
import { REPORT_LINE_KEY, REPORT_LINE_LABEL, answersLeftBehind, buildCorrectionsApplied, correctionScope, correctionsWorklist, flaggedPositions, linesOf, reportLines } from "../corrections-feedforward.mjs";
import { parseFindingsJsonLenient } from "../findings-model.mjs";
import { note, runLog } from "../log.mjs";
import { listedAddresses, listedExclusionPositions, readAcceptedFlags } from "../narrative-refutation-record.mjs";
import { properNameCandidates } from "../predelivery-lint.mjs";
import { atomicWrite } from "../run-record.mjs";
import { foldAfterSave, modelRecordPath, restoreFold } from "../record-fold.mjs";
import { normalizeRecordUri } from "../registry-fidelity.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { NARRATIVE_PROSE, anyRenumbered, sectionText } from "../repair-scope.mjs";
import { writeFindings } from "../stage-freshness.mjs";
import { paths } from "../stages.mjs";
import { lastAcceptedCall, rebaseSynthesis, restoreSynthesisBase, snapshotSynthesisBase } from "../synthesis-record.mjs";
import { parseCorrections } from "../verify.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

let CORRECTIONS_DELIVERED_FILE, asPartNotCompleted, extractRulingsTail, must, postRepairCorrectionsPath, postRepairStatePath, prepareDeclinationSpec, recordFromTheSaves, recordSynthesisSeam, removalRepairedRow, reviewAfterRepairPath, reviewExclusionsPaths, safeReadJson, snapshotFindingsForCorrections, stage, stageCharter;

/** Called once by pipeline.mjs as it loads, with the names above. */
export function useThePipeline(held) {
  ({ CORRECTIONS_DELIVERED_FILE, asPartNotCompleted, extractRulingsTail, must, postRepairCorrectionsPath, postRepairStatePath, prepareDeclinationSpec, recordFromTheSaves, recordSynthesisSeam, removalRepairedRow, reviewAfterRepairPath, reviewExclusionsPaths, safeReadJson, snapshotFindingsForCorrections, stage, stageCharter } = held);
}

/**
 * — `depth` IS A PARAMETER because the corrective pass re-emits the WHOLE narrative and was the
 * only synthesis dispatch that did not carry the depth rung. The fresh dispatch carried it once; this
 * one carried it zero times, and the file that ships is the one this pass writes. The delivered
 * narrative then did the thing the rung forbids — full prose accounts for conflicts the rung excludes.
 *
 * A re-emission that is not told the rung is not a repair of the rung's output. It is a fresh write
 * under the default contract, wearing the corrective pass's name.
 */
/** A flag's position ids as the review's list keys them; null when it names none. PURE. */
const positionIdsOf = (ids, listed) => {
  if (!Array.isArray(ids) || !ids.length) return null;
  const out = [...new Set(ids.map((p) => listed?.get(String(normalizeRecordUri(p) ?? "")) ?? String(normalizeRecordUri(p) ?? p)))];
  return out.length ? out : null;
};

/**
 * WHAT A FLAG IS ABOUT, READ ONE WAY FOR THE CORRECTION AND ITS RECHECK (ruled 2026-10-30). A finding flag names its
 * findings; a flag on a writer's exclusion names its positions; a flag about the document names the passage, section or
 * coverage claim in its text, and carries no finding ordinal, which is normal for it. That is a declared target, `[]`,
 * as the rendered review's `[on: -]` already reads, so a document flag no longer opens every finding for revision. A flag
 * whose target cannot be read, one with no text, stays `null`, which leaves the pass open: an unidentified target is not
 * a document one. PURE.
 */
export const flagOrdinals = (f) => (Array.isArray(f?.on) && f.on.length ? f.on : String(f?.text ?? "").trim() ? [] : null);   // @internal

/**
 * The review's flags as the correction and its recheck read them: from the typed call the review recorded, or, for a
 * review that has none (an archived run, a review the tool refused), parsed from its rendered document. Both read a flag's
 * target the same way. IMPURE (reads the run's accepted call and its exclusions list).
 */
export function correctionRows(P, review, typed = readAcceptedFlags(P?.runDir)) {   // @internal
  if (!typed) return parseCorrections(review);
  const listed = listedExclusionPositions(P.runDir);
  return typed.map((f, i) => ({
    n: i + 1, kind: f.kind, text: f.text, fix: f.fix ?? null,
    ordinals: flagOrdinals(f),
    // A writer's excluded position, as the review's list keys it, whichever of its record ids the flag named.
    positions: positionIdsOf(f.positions, listed),
    // The report's other parts the flag declared, by the addresses its review was handed.
    ...(Array.isArray(f.lines) && f.lines.length ? { lines: [...new Set(f.lines)] } : {}),
  }));
}

/** The scope with each part its flags declared, by the label its review was shown, in declaration order. IMPURE (reads the run). */
function withLineLabels(scope, rows, P) {
  const declared = [...new Set((rows ?? []).flatMap((r) => (Array.isArray(r?.lines) ? r.lines : [])))];
  if (!declared.length) return scope;
  const byAddress = new Map((listedAddresses(P.runDir)?.lines ?? []).map((l) => [l.address, l.label]));
  return { ...scope, lineLabels: declared.map((a) => byAddress.get(a) ?? a) };
}

/** The scope with each named position's mark, owner and id, as the corrective pass is told them. IMPURE (reads the run). */
function withPositionLabels(scope, P) {
  if (!scope?.positions?.length) return scope;
  const shown = safeReadJson(reviewExclusionsPaths(P).shown);
  const byUri = new Map((Array.isArray(shown?.positions) ? shown.positions : []).map((p) => [p.uri, p]));
  // Its row in the list `record_declination` reads, prepared again before this pass, so keeping an exclusion names the row.
  const spec = safeReadJson(paths(P.runDir).declinationSpec)?.rows;
  const rowOf = (u) => (Array.isArray(spec) ? spec.findIndex((r) => r?.kind !== "page" && String(normalizeRecordUri(r?.uri) ?? "") === u) : -1);
  const label = (u) => { const p = byUri.get(u); const i = rowOf(u); return `${p?.mark ?? "(unnamed)"}${p?.owner ? ` — ${p.owner}` : ""} (${u})${i >= 0 ? `, row ${i}` : ""}`; };
  return { ...scope, positionLabels: scope.positions.map(label) };
}

/**
 * The review as the correction reads it, once: the pieces of its message, and the excluded positions its flags name,
 * which its dispatch also hands the writer's save (synthesis-record.mjs, `correctionPositions`), so the positions the
 * message names are the positions the save may add a finding for. IMPURE (reads the run).
 */
export function correctionReading(P) {   // @internal
  const review = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : "";
  const rulingsTail = extractRulingsTail(existsSync(P.placement) ? readFileSync(P.placement, "utf8") : "");
  // — THE FLAGS ARRIVE AS A TYPED WORKLIST, not only as a wall of prose. The reviewer already
  // declares each flag's kind and taught it all four; the first run after that deployed came back
  // with four kinds populated across twelve lines. The raw review still rides below — this is a better
  // index of the same evidence, and dropping the prose would lose the reasoning the flags rest on.
  // ── T3b: THE TYPED FLAGS ARE THE WORKLIST'S SOURCE, NOT THE RENDERED PROSE ──────────────────────
  //
  //. The comment above says the flags "arrive as a typed worklist" — they did not.
  // `parseCorrections` re-reads the DOCUMENT the driver had just rendered from those very values, so a
  // flag the parse misses is a defect the reviewer named and the corrective pass never sees. That parse
  // is what conversion 9 removed the need for: since the reviewer records typed values, the flags exist
  // as data a few hundred milliseconds earlier, and reading them back out of markdown re-introduces the
  // one failure the conversion closed.
  //
  // ✕ THE FALLBACK IS EXPLICIT AND RECORDED, NOT SILENT. `readAcceptedFlags` returns null for a run with
  // no accepted call — an archived run, a resume across the conversion, or a review the tool REFUSED —
  // and those runs still have a rendered document that the old parse reads correctly. So the parse stays
  // as the second source rather than being deleted. What it must never be is invisible: a reader who
  // cannot tell which source produced a worklist cannot tell a missed flag from an absent one, so the
  // choice is written to the run log with the count each source yielded.
  const typed = readAcceptedFlags(P.runDir);
  const rows = correctionRows(P, review, typed);
  if (P.runDir) {
    try {
      runLog(P.runDir, {
        event: "corrective-worklist-source",
        source: typed ? "typed-call" : "rendered-parse",
        flags: rows.length,
        // BOTH counts, always, so a divergence is visible in the record rather than inferable. If the
        // typed source is in use and the parse would have found fewer, that difference IS the defect this
        // change exists to close, and a reader should be able to see it without re-running anything.
        parsedWouldFind: parseCorrections(review).length,
      });
    } catch { /* telemetry only — a log that cannot be written never blocks a repair */ }
  }
  const worklist = correctionsWorklist(rows);
  // — THE SCOPE BLOCK, and it is the whole saving. The corrective pass costs 683 s on a delivered
  // run because it re-emits the entire narrative and the entire findings.json; on that run exactly ONE
  // finding moved. When every flag declares which finding it is about, the pass is told so, and told
  // that nothing else may move. When any flag declares nothing, this is "" and the dispatch is
  // byte-identical to the one before this existed — the narrowing is bought by the reviewer's own
  // declaration, never assumed on its behalf. The positions the flags named ride either way, with their rows.
  const named = flaggedPositions(rows);
  const scope = withLineLabels(withPositionLabels({ ...correctionScope(rows), ...(named.length ? { positions: named } : {}) }, P), rows, P);
  return { review, rulingsTail, worklist, scope, positions: named };
}

/**
 *, T3b — THE CORRECTIVE PASS FAILED VALIDATION. RESTORE THE LAST GOOD STATE.
 *
 * Owner decision, 2026-08-26, put to him as a client outcome with options: a targeted fix that fails
 * validation is DISCARDED — the report never ships text a repair degraded.
 *
 * ── WHAT HAPPENED BEFORE THIS, WHICH IS WORSE THAN SHIPPING DEGRADED TEXT ────────────────────────
 *
 * `must(correctivePass, …)` threw. Nothing between it and the run-level catch caught it, so a
 * corrective synthesis that could not produce a document its validators accept KILLED THE RUN: the
 * client received no report at all, on a matter where the only defect was that a repair of an
 * already-delivered draft did not take. The pre-corrective findings were sitting on disk in full the
 * whole time — `snapshotFindingsForCorrections` writes the TEXT, not just a sha, and has since PR-4.
 *
 * So the rollback is not only "don't ship the degraded version". It is the difference between a report
 * and no report, which is the order of preference this product works to: avoid, then recover inside the
 * run, then deliver always.
 *
 * ── WHAT IS ROLLED BACK TO, AND WHY IT IS A GOOD STATE ───────────────────────────────────────────
 *
 * The findings.json the reviewer read. It passed synthesis's own validators when it was written, and it
 * is the document every earlier stage's output was checked against. It is not a guess at a good state;
 * it is the last one this run demonstrated.
 *
 * The narrative beside it and the transport's merge base come back with it, whether or not findings.json
 * moved: a pass can save a narrative change alone, and a base left at the failed pass's record is what the
 * next patch would merge onto, which applies the discarded pass again. The snapshot holds both
 * (`snapshotFindingsForCorrections`); a snapshot taken without them leaves both files as they are.
 *
 * ── TWO CASES THAT MUST STILL THROW, BECAUSE SWALLOWING THEM LOSES MORE THAN IT SAVES ────────────
 *
 *   rate-limited   The run is PARKED and auto-resumes after the cap resets, with every stage intact.
 *                  Rolling back and delivering here would spend the client's report to avoid a wait,
 *                  and the corrective pass would never be retried at all.
 *   no snapshot    There is no last good state — the run had no findings.json before the pass. An
 *                  absence is a finding, not a pass: with nothing to restore, delivering would ship
 *                  whatever the failed pass left behind, which is exactly the text the owner ruled out.
 *
 * Returns the rollback record, or null to mean "this one still throws".
 */
export function rollbackCorrectivePass(P, runDir, pre, fail) {   // @internal
  if (fail?.fail === "rate_limited" || fail?.resetsAt) return null;
  if (!pre?.raw) return null;
  let now = null;
  try { now = readFileSync(P.findings, "utf8"); } catch { /* the pass may have left nothing readable */ }
  const nowSha = now == null ? null : createHash("sha256").update(now).digest("hex");
  const changed = nowSha !== pre.sha;
  if (changed) {
    // Atomic, like every other write to this file: a half-restored findings.json is a worse state than
    // either of the two this is choosing between.
    writeFindings(runDir, pre.raw, { why: "corrective-pass-rolled-back", settles: [] });
    if (pre.fold) restoreFold(runDir, pre.fold);   // the record the model wrote and the map, as they stood
  }
  // `restored` keeps speaking for findings.json alone; what happened to the narrative and the base is its own field.
  const base = restoreSynthesisBase(runDir, pre.base);
  const record = { ts: new Date().toISOString(), reason: String(fail?.fail ?? "failed").slice(0, 200),
    restored: changed, preSha: pre.sha, failedSha: nowSha, ...(base ? { base } : {}) };
  try { atomicWrite(paths(runDir).correctiveRollback, JSON.stringify(record, null, 2) + "\n"); }
  catch { /* sidecar is best-effort; the runLog event below is the record that decides */ }
  return record;
}

/**
 * THE FLOOR UNDER A CORRECTIVE PASS: nothing leaves the findings record without
 * somebody having said so.
 *
 * WHAT THIS IS A BACKSTOP FOR, and why it is not the fix. A corrective pass resent a whole document
 * holding the four findings it was correcting; fifteen went, and the result validated, so every gate
 * downstream read a clean run. The CAUSE was that the seat could not send a targeted edit at all — the
 * tool schema required both halves of the call and declared no patch field, while the prompt demanded
 * one. That is fixed at the schema, and a targeted edit cannot remove a finding: an ordinal names one to
 * replace and there is no shape that deletes. This runs underneath, for the whole-document path that
 * remains reachable.
 *
 * REPAIR AND DELIVER, decided under authority the owner delegated in session on 2026-08-27.
 * The three alternatives were weighed and written down: rolling back gives the client every finding but
 * none of the reviewer's corrections — one silent loss traded for another; printing the removals as open
 * points tells the client about a hole instead of filling it; holding the report is against the standing
 * deliver-always ruling. Repair keeps the corrections AND restores what vanished unexplained, so the
 * client gets a complete corrected report and there is no hole to print.
 *
 * WHOLE FROM THE SNAPSHOT, NEVER RE-DERIVED — the owner's condition, and the reason this reads
 * `JSON.parse(pre.raw)` rather than a normalized view. A restored finding is the exact object the
 * reviewer read. Re-deriving one would be this function inventing evidence.
 *
 * NAMED MEANS NAMED BY A FLAG, and both spellings count: a flag that carries `on` names ordinals, and a
 * flag that carries none is matched against the marks the review names. A removal the reviewer asked for
 * stays removed — that is a judgment, and this function has no business reversing it. What it reverses
 * is a removal NOBODY STATED, which is by construction one nobody reviewed.
 *
 * EVERY FIRING IS A DEFECT SIGNAL. After the schema fix this should be zero: the run log carries the
 * event so e2e can assert exactly that, and a non-zero count is a report of the fix not holding rather
 * than of this backstop working.
 *
 * @returns {null | {restoredFindings: {ordinal: *, mark: *}[], restoredKeys: string[], restoredRows: {register: string, key: string}[], leftRemoved: {ordinal: *, mark: *}[]}}
 */
export function repairUnnamedRemovals(P, runDir, pre, namedOrdinals, namedMarks, namedLines = []) {   // @internal
  if (!pre?.raw) return null;                                   // nothing held — nothing to compare against
  // In the model's numbering: the flags name its ordinals, and a folded record renumbers, so a finding
  // removed from the folded record would shift every ordinal after it (record-fold.mjs).
  let preDoc = null, postDoc = null, postRaw = null;
  try { preDoc = JSON.parse(pre.model?.raw ?? pre.raw); } catch { return null; }
  try { postRaw = readFileSync(modelRecordPath(runDir, P.findings), "utf8"); postDoc = JSON.parse(postRaw); } catch { return null; }
  if (!preDoc || !postDoc || typeof postDoc !== "object") return null;

  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const marks = new Set((namedMarks ?? []).map(norm).filter(Boolean));
  const ordinals = new Set((namedOrdinals ?? []).map((o) => String(o)));
  const wasNamed = (f) => ordinals.has(String(f?.ordinal))
    || [f?.mark, f?.owner?.name].some((n) => { const v = norm(n); return v && marks.has(v); });

  const preList = Array.isArray(preDoc.findings) ? preDoc.findings : [];
  const postList = Array.isArray(postDoc.findings) ? postDoc.findings : [];
  const held = new Set(postList.map((f) => String(f?.ordinal)));
  const restoredFindings = [], leftRemoved = [];
  for (const f of preList) {
    if (held.has(String(f?.ordinal))) continue;
    (wasNamed(f) ? leftRemoved : restoredFindings).push(f);
  }

  // A KEY, NOT A TYPED LIST. Derived by comparing the two documents, so a register added next year is
  // covered the day it exists — a list of key names here would be a second place to remember.
  const restoredKeys = Object.keys(preDoc).filter((k) => !(k in postDoc));

  // ROWS OF A REGISTER, NOT ONLY WHOLE REGISTERS. A pass rewriting a coverage note or an action sends the
  // complete array in its PATCH, and a patch REPLACES the stored register — so a row the seat left out is
  // a row deleted, and nothing downstream objects unless the slice was a limited one. A row no flag named
  // is restored whole, keyed as `reportLines` keys it; a row the reviewer named stays out, as a named
  // finding does.
  const lineKeys = new Set(namedLines ?? []);
  const restoredRows = [];
  const rowsBack = {};
  for (const [reg, keyOf] of Object.entries(REPORT_LINE_KEY)) {
    if (!Array.isArray(preDoc[reg]) || !Array.isArray(postDoc[reg])) continue;
    const have = new Set(postDoc[reg].map(keyOf));
    const back = preDoc[reg].filter((r) => !have.has(keyOf(r)) && !lineKeys.has(keyOf(r)));
    if (!back.length) continue;
    rowsBack[reg] = back;
    for (const r of back) restoredRows.push({ register: reg, key: keyOf(r), label: REPORT_LINE_LABEL[reg](r) });
  }

  if (!restoredFindings.length && !restoredKeys.length && !restoredRows.length) return null;

  // ONE RESTORATION, applied to a record in the model's numbering: the file's here, and the merge base's
  // below. Whatever a record already holds stays as it holds it; only what came back is added.
  const byOrdinal = new Map(preList.map((f, i) => [String(f?.ordinal), i]));
  const restoreInto = (doc) => {
    const merged = { ...doc };
    for (const k of restoredKeys) if (!(k in merged)) merged[k] = preDoc[k];
    for (const [reg, back] of Object.entries(rowsBack)) {
      // In the snapshot's order, the post-pass version of every row it kept, then any row the pass added.
      const keyOf = REPORT_LINE_KEY[reg];
      const now = Array.isArray(doc[reg]) ? doc[reg] : [];
      const post = new Map(now.map((r) => [keyOf(r), r]));
      const restored = new Set(back);
      const inPre = new Set(preDoc[reg].map(keyOf));
      merged[reg] = [
        ...preDoc[reg].flatMap((r) => restored.has(r) ? [r] : post.has(keyOf(r)) ? [post.get(keyOf(r))] : []),
        ...now.filter((r) => !inPre.has(keyOf(r))),
      ];
    }
    if (restoredFindings.length) {
      // Back in the order the reviewer read them, by ordinal — a restored finding appended to the end
      // would be a different document from the one that was correct.
      const list = Array.isArray(doc.findings) ? doc.findings : [];
      const has = new Set(list.map((f) => String(f?.ordinal)));
      merged.findings = [...list, ...restoredFindings.filter((f) => !has.has(String(f?.ordinal)))]
        .sort((a, b) => (byOrdinal.get(String(a?.ordinal)) ?? 0) - (byOrdinal.get(String(b?.ordinal)) ?? 0));
    }
    return merged;
  };
  const merged = restoreInto(postDoc);
  const brief = (f) => ({ ordinal: f?.ordinal ?? null, mark: f?.mark ?? null });
  const record = {
    ts: new Date().toISOString(),
    restoredFindings: restoredFindings.map(brief),
    restoredKeys,
    restoredRows,
    leftRemoved: leftRemoved.map(brief),
  };
  writeFindings(runDir, merged, { why: "unnamed-removals-restored", settles: [] });
  foldAfterSave(runDir, P.findings);   // after the seam the repaired record is folded again, as a save's is
  // THE MERGE BASE TAKES THE SAME RESTORATION. The patch that follows (the corrections gate's re-emit) merges
  // onto the base and re-renders the file from it, so a restore written to the file alone is dropped again.
  // The edit is judged as a call is; a refusal leaves the base as it was, and the record says so.
  record.base = rebaseSynthesis(runDir, restoreInto);
  try { atomicWrite(paths(runDir).correctiveRepair, JSON.stringify(record, null, 2) + "\n"); }
  catch { /* sidecar is best-effort; the runLog event is the record that decides */ }
  return record;
}

export function correctionNamedOrdinals(P) {
  const out = [];
  try {
    // `P.reviewFlags`: the pass after a delivery-check repair applies a LATER review's flags, read from that review's own
    // calls. Absent everywhere else, where `readAcceptedFlags` reads the newest accepted call of the review acted on.
    const typed = Array.isArray(P.reviewFlags) ? P.reviewFlags : readAcceptedFlags(P.runDir);
    if (typed) { for (const f of typed) if (Array.isArray(f?.on)) out.push(...f.on); return out; }
  } catch { /* fall through to the rendered parse, exactly as the worklist does */ }
  try {
    const review = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : "";
    for (const r of parseCorrections(review)) if (Array.isArray(r?.ordinals)) out.push(...r.ordinals);
  } catch { /* no ordinals — every removal is then judged by mark alone */ }
  return out;
}

/**
 * The non-finding lines the review's flags name or quote, as `reportLines` keys — matched against the
 * PRE-corrective document, for the reason the names are: a removed row is absent from the post file.
 *
 * ── THIS JOIN DECIDES A RESTORATION, AND ITS TWO FAILURE DIRECTIONS ARE OPPOSITE ─────────────────────
 *
 * `linesOf` applies no correction anywhere — but these keys become `namedLines`, and `repairUnnamedRemovals`
 * keeps a removed row OUT when its key is among them. So a prose match decides whether a row the pass
 * deleted comes back:
 *
 *   a MISS  → the row is restored although the reviewer asked for it to go: the driver overrides a
 *             judgment that was made, and the reviewer sees it named as restored and can say so again.
 *   a FALSE HIT → an accidental deletion stays deleted: the row leaves the client's report and the
 *             restored-lines section says nothing, because the driver believed it was asked for.
 *
 * The second is the worse one and it is the same bet the backstop already makes by mark for findings.
 * What keeps it bounded is that the reviewer is told: every restored row prints in the re-read section,
 * so an override is visible, and a flag whose wording missed still leaves its own row in the observation
 * table as unresolved. `namesLine` wants the label's shape — "the coverage line for <area>" — so a flag
 * writing "the US coverage note" misses unless it also quoted eight running words of the line.
 */
export function correctionNamedLines(P, doc0) {
  try {
    const review = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : "";
    const lines = reportLines(doc0);
    // A flag that declared its parts by address is bound to those; only a flag that declared none is matched by its prose.
    return [...new Set(parseCorrections(review).flatMap((r) => (Array.isArray(r?.lines) && r.lines.length ? r.lines
      : linesOf(r?.text, lines).map((l) => l.key))))];
  } catch { return []; }   // no review read — every row removal is then unnamed, and restored
}

/**
 * @param {*} doc0 the findings document to match the review's names against. DEFAULTS to the file on
 *   disk, which is right for the staleness check — but WRONG for judging a removal: a finding that was
 *   removed is not in the post-pass document, so its mark could never be found there and every named
 *   removal would read as unnamed. The repair path passes the PRE-corrective document for that reason.
 */
export function correctionNamedSet(P, doc0 = null) {
  const review = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : "";
  let doc = doc0;
  if (!doc) { try { doc = parseFindingsJsonLenient(readFileSync(P.findings, "utf8")); } catch { return []; } }
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const known = new Map();
  for (const f of doc?.findings ?? []) {
    for (const name of [f.mark, f.owner?.name]) { const n = norm(name); if (n) known.set(n, name); }
  }
  const named = new Set();
  for (const tok of properNameCandidates(review)) {
    const n = norm(tok);
    for (const [k, orig] of known) if (n && (k === n || k.includes(n) || n.includes(k))) named.add(orig);
  }
  return [...named];
}

/**
 * THE TRUSTED STATE BEFORE THE CORRECTION AFTER A POST-REPAIR REVIEW, for its rollback, from the first source that
 * stands, in this order:
 *   1. the findings record as it stands, with its fold, narrative and base (the usual snapshot);
 *   2. the state kept whole before the review (`retainStateBeforeReview`), byte for byte;
 *   3. the save the review read (`before`, read before the correction starts), rebuilt through the driver's own
 *      acceptance, never from a save the correction may write afterwards;
 *   4. the save kept from before the delivery-check repair, rebuilt the same way.
 * A save that the run's CURRENT duty refuses is not lost: it was accepted when it was made, and the records owed since
 * are evidence added later. It is rebuilt with the duty set aside and marked so (`duty: "relaxed"`); once the correction
 * settles, the writer's duty is judged again on the record that stands, and names what it leaves unaccounted in the
 * approved sentence. A save that cannot be read, or that
 * the acceptance refuses for anything else, is not a source. Null only when none of the four stands. Never throws.
 */
function trustedStateBeforeCorrection(Pv, runDir, before) {
  const held = snapshotFindingsForCorrections(Pv, runDir);
  if (held) return held;
  const sha = (t) => createHash("sha256").update(t).digest("hex");
  try {
    const k = JSON.parse(readFileSync(postRepairStatePath(runDir), "utf8"));
    if (typeof k?.findings === "string" && typeof k.narrative === "string" && typeof k.accepted === "string") {
      const h = sha(k.findings);
      return { raw: k.findings, sha: h, model: { raw: k.findings, sha: h }, fold: k.fold ?? null,
        base: { accepted: k.accepted, narrative: k.narrative }, from: "state-before-the-review" };
    }
  } catch { /* no state kept, or it does not read: the saves below */ }
  return recordFromTheSaves(Pv, runDir, before);
}

/**
 * A FAILED CORRECTION AFTER A POST-REPAIR REVIEW NEVER ENDS THE RUN (the owner's ruling of 2026-10-19: a run is never
 * held). The trusted state comes back whole: the record, its narrative and the merge base, then the fold and the seam's
 * writes made again over a record rebuilt from a save, as after any save, so the delivered verdict is derived from the
 * record that stands. The correction's points stay in the run's open-questions record. A rate-limited correction is
 * not waited for either: it is rolled back as a failed one is, since the report it would correct is already reviewed,
 * and waiting for the reset would hold the run.
 *
 * WITH NO TRUSTED STATE, THIS PASS DOES NOT DELIVER THE ASSESSMENT. That is the precise limit: the record, the state
 * kept whole before the review, the save the review read and the save kept from before the repair are all unreadable
 * or refused, a storage failure. Nothing the failed pass wrote is adopted: the narrative and the base
 * go back to what they were, and the failed pass's record is set aside under `_driver/` as evidence. A pass that went on from there delivered a
 * report with no findings, labelled with the verdict as it stood (measured on the mock pipeline, 2026-10-19): a clear
 * result over a record nobody can read. So the failure is the assessment not completed (parts-not-completed.mjs): once
 * its recovery is spent, the run delivers what it holds without the assessment. Returns the rollback record, or null
 * for this case.
 */
async function recoverFromFailedCorrection(ctx, Pv, runDir, pre, pass, { baseBefore, findingsBefore }) {
  // A rate limit is a failure of this pass like any other here: the shared rollback would leave it to wait.
  const failure = pass?.fail === "rate_limited" || pass?.resetsAt ? { fail: "rate_limited, not waited for" } : pass;
  if (pre?.raw) {
    const rollback = rollbackCorrectivePass(Pv, runDir, pre, failure);
    if (rollback && pre.from) rollback.from = pre.from;
    if (rollback && pre.duty) rollback.duty = pre.duty;
    if (rollback && (pre.from === "accepted-save" || pre.from === "save-before-the-repair")) {
      // A record rebuilt from a save is folded, and given the seam's writes, as the save itself was.
      try { foldAfterSave(runDir, Pv.findings); } catch (e) { note(`[post-repair] the restored record could not be folded (${String(e?.message ?? e).slice(0, 100)})`); }
      try { await ctx.afterSynthesisSave?.(); } catch (e) { note(`[post-repair] the seam's writes could not be made again over the restored record (${String(e?.message ?? e).slice(0, 100)})`); }
    }
    return rollback;
  }
  // NO TRUSTED STATE: nothing the failed pass wrote is adopted, and the pass ends as it always did.
  const base = restoreSynthesisBase(runDir, baseBefore);
  let findings = "unchanged";
  if (!findingsBefore) {
    let now = null;
    try { now = readFileSync(Pv.findings, "utf8"); } catch { now = null; }
    // Set aside, never deleted: the failed pass's record stays beside the run's record for whoever diagnoses the run.
    if (now != null) {
      try { renameSync(Pv.findings, paths(runDir).findingsFailedCorrection); findings = "set-aside"; }
      catch { try { rmSync(Pv.findings, { force: true }); findings = "removed"; } catch { findings = "failed"; } }
    }
  }
  runLog(runDir, { event: "post-repair-correction-unrecoverable", reason: String(failure?.fail ?? "failed").slice(0, 200), findings, ...(base ? { base } : {}) });
  note(`[post-repair] the correction after the review of the repair failed with no trusted state to restore (the record and both saves unreadable) — nothing it wrote is kept, and this pass does not deliver a report without its record`);
  return null;
}

/**
 * The one correction after that review: every accepted point goes to it, whatever its class, and nothing
 * reviews it again. It runs the first correction's own backstops — the rollback, the put-back of a removal no
 * flag named, the follow-up when a correction missed the findings — on a view of the run's paths that points at
 * the review after the repair, and records what each flag led to beside the first correction's record.
 */
export async function runPostRepairCorrection(ctx, P, run, { rec, items, points, grounds = false, whole = false, synthesisRef }) {
  const runDir = run.runDir;
  const Pv = { ...P, seniorEyeReview: reviewAfterRepairPath(runDir), correctionsApplied: postRepairCorrectionsPath(runDir), reviewFlags: rec.flags };
  const named = [...new Set(points.filter((x) => x.target.kind !== "none").map((x) => x.target.label))];
  const rows = rec.flags.map((f, i) => ({ n: i + 1, kind: f.kind, text: f.text, fix: f.fix ?? null, ordinals: flagOrdinals(f) }));
  const review = readFileSync(Pv.seniorEyeReview, "utf8");
  const rulingsTail = extractRulingsTail(existsSync(P.placement) ? readFileSync(P.placement, "utf8") : "");
  // The writer's own record, in the numbering of the items and of the patch, while the delivery fold is in force.
  const followup = repairFollowup("synthesis:post-repair-corrective", {
    narrative: P.narrative, findings: modelRecordPath(runDir, P.findings), placement: P.placement, rulingsTail,
    items: named, renumbered: anyRenumbered(items), worklist: correctionsWorklist(rows, { afterRepair: true }), review, whole,
  });
  const before = lastAcceptedCall(runDir);
  // What stood before the correction, held before it can alter any of it: the files as they are, for a pass that
  // fails with no trusted state to restore, and the trusted state itself.
  const baseBefore = snapshotSynthesisBase(runDir);
  const findingsBefore = (() => { try { readFileSync(Pv.findings); return true; } catch { return false; } })();
  const pre = trustedStateBeforeCorrection(Pv, runDir, before);
  prepareDeclinationSpec(ctx, P);
  const pass = await stage("synthesis", ctx, { force: true, followup: followup + stageCharter("synthesis", ctx.depth, ctx.framework), sessionKey: synthesisRef.key,
    model: synthesisRef.model, thinking: synthesisRef.thinking, trigger: "post-repair-corrective" });
  recordSynthesisSeam(ctx, pass, "post-repair-corrective");
  const rollback = pass.ok ? null : await recoverFromFailedCorrection(ctx, Pv, runDir, pre, pass, { baseBefore, findingsBefore });
  if (rollback) {
    runLog(runDir, { event: "corrective-rollback", reason: rollback.reason, restored: rollback.restored, pass: "post-repair", from: rollback.from ?? "record",
      ...(rollback.duty ? { duty: rollback.duty } : {}) });
    note(`[post-repair] the correction after the review of the repair failed (${rollback.reason}) — the record it started from is back, and the run delivers with the points recorded`);
  } else {
    await asPartNotCompleted("assessment", async () => must(pass, "synthesis(post-repair)"));
    let preDocForNames = null;
    try { preDocForNames = pre ? parseFindingsJsonLenient(pre.raw) : null; } catch { /* fall back to the file */ }
    const repaired = repairUnnamedRemovals(Pv, runDir, pre, correctionNamedOrdinals(Pv), correctionNamedSet(Pv, preDocForNames), correctionNamedLines(Pv, preDocForNames));
    if (repaired) runLog(runDir, removalRepairedRow(repaired));
    await enforceCorrectionsReachFindings(ctx, Pv, pre, { synthesisKey: synthesisRef.key, synthesisModel: synthesisRef.model, synthesisThinking: synthesisRef.thinking });
  }
  let applied = null;
  try {
    const preDoc = pre ? parseFindingsJsonLenient(pre.model?.raw ?? pre.raw) : null;
    let postDoc = null;
    try { postDoc = parseFindingsJsonLenient(readFileSync(modelRecordPath(runDir, P.findings), "utf8")); } catch { /* shape defects ride the normal ladder */ }
    const after = lastAcceptedCall(runDir);
    const sections = points.filter((x) => x.target.kind === "section").map((x) => {
      const sec = NARRATIVE_PROSE.find((y) => y.key === x.target.key);
      return { n: x.n, label: x.target.label, before: sectionText(sec?.read(before?.narrative)), after: sectionText(sec?.read(after?.narrative)) };
    });
    applied = buildCorrectionsApplied(rows, preDoc, postDoc, { sections });
    // `grounds`: the review these rows answer hardened the run's verdict, so its points are that verdict's grounds.
    atomicWrite(Pv.correctionsApplied, JSON.stringify({ ts: new Date().toISOString(), pass: "post-repair", ...(grounds ? { grounds: true } : {}),
      rows: applied, classes: points.map((x) => ({ n: x.n, class: x.class, target: x.target.label })) }, null, 2) + "\n");
    const outcomes = applied.reduce((a, x) => ((a[x.outcome] = (a[x.outcome] ?? 0) + 1), a), {});
    runLog(runDir, { event: "post-repair-fix-pass", handed: rows.length, ok: Boolean(pass.ok), rolledBack: Boolean(rollback), outcomes });
  } catch (e) {
    note(`[post-repair] the observation of the correction could not be built (${String(e?.message ?? e).slice(0, 100)}) — its points print as not checked`);
    runLog(runDir, { event: "post-repair-fix-pass", handed: rows.length, ok: Boolean(pass.ok), rolledBack: Boolean(rollback), observation: false });
  }
  return { ran: true, ok: Boolean(pass.ok), rollback, applied };
}

// `resume.correction` is the first correction's (see its dispatch), handed on by that caller alone: the correction after
// the review of a repair shares this follow-up and is handed no positions.
/**
 * The findings and other parts the review's flags declare, by the names a reader is given: a finding's mark or owner, or
 * "finding N" when it has neither, and a part's label from the address list. IMPURE (reads the run).
 */
function correctionDeclaredNames(P, pre) {
  try {
    let doc = null;
    try { doc = pre ? parseFindingsJsonLenient(pre.model?.raw ?? pre.raw) : null; } catch { doc = null; }
    const review = existsSync(P.seniorEyeReview) ? readFileSync(P.seniorEyeReview, "utf8") : "";
    const rows = correctionRows(P, review, Array.isArray(P.reviewFlags) ? P.reviewFlags : readAcceptedFlags(P.runDir));
    const byOrd = new Map((doc?.findings ?? []).map((f) => [f?.ordinal, f]));
    const labels = new Map((listedAddresses(P.runDir)?.lines ?? []).map((l) => [l.address, l.label]));
    return rows.flatMap((r) => [
      ...(Array.isArray(r?.ordinals) ? r.ordinals : []).map((o) => { const f = byOrd.get(o); return f?.mark ?? f?.owner?.name ?? `finding ${o}`; }),
      ...(Array.isArray(r?.lines) ? r.lines : []).map((a) => labels.get(a) ?? a)]);
  } catch { return []; }   // nothing declared can be read — the prose names stand alone, as before
}

export async function enforceCorrectionsReachFindings(ctx, P, pre, resume) {
  if (!pre) return;                                            // no findings.json before the pass — nothing to enforce
  const { run } = ctx;
  // What the review's prose names, and what its flags declare: a target either way counts, so the hold below never fires
  // less often than it did on the prose alone.
  const named = [...new Set([...correctionNamedSet(P), ...correctionDeclaredNames(P, pre)])];
  const readState = () => {
    let raw = null, corrections = null;
    // the record the model wrote: a change the fold hides is still a change it made (record-fold.mjs)
    try { raw = readFileSync(modelRecordPath(run.runDir, P.findings), "utf8"); } catch { return { stale: false }; }
    try { corrections = parseFindingsJsonLenient(raw).corrections; } catch { /* shape defects ride the normal ladder */ }
    const sha = createHash("sha256").update(raw).digest("hex");
    return { stale: named.length > 0 && sha === (pre.model?.sha ?? pre.sha) && !(corrections && corrections.applied), sha };
  };
  if (!readState().stale) return answerFollowsCorrection(ctx, P, pre, resume);
  note(`[corrections] findings.json unchanged after the corrective pass (review names: ${named.join(", ")}) — demanding the re-emit`);
  await stage("synthesis", ctx, {
    force: true, sessionKey: resume.synthesisKey, model: resume.synthesisModel, thinking: resume.synthesisThinking,
    trigger: "corrective-findings",
    ...(resume.correction ? { correction: resume.correction } : {}),
    // The writer's own record while a fold is in force, as the correction's own message names it (`correctionsExtra`).
    followup: repairFollowup("synthesis:corrective-findings", { findings: modelRecordPath(run.runDir, P.findings), named, seniorEyeReview: P.seniorEyeReview, adds: Boolean(resume.correction) }) + stageCharter("synthesis", ctx.depth, ctx.framework),
  });
  if (readState().stale) {
    runLog(run.runDir, { event: "corrective-findings-stale", named });
    note(`[corrections] findings.json STILL stale — internal report ships; client export will hold (corrections-state)`);
    try {
      const tmp = paths(run.runDir).correctionsStateJson;
      writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), stale: named }, null, 2));
      renameSync(tmp, paths(run.runDir).correctionsState);
    } catch { /* sidecar is best-effort; the runLog event stands */ }
  }
}

// THE ANSWERS FOLLOW THE FINDINGS THEY NAME, asked once, as the gate's one repair. A correction that moved findings an
// answer citing findings may depend on (`answersLeftBehind`) is handed those findings and the answers that may miss them.
// The writer updates the answers that depend on them or says why not in the corrections note; nothing is forced. Run
// only where the findings did reach the record: where they did not, the re-emit above is the one repair, and it may
// update the answers in the same PATCH. What remains afterwards is recorded, not judged; the recheck reads the answers.
async function answerFollowsCorrection(ctx, P, pre, resume) {
  const { run } = ctx;
  const leftBehind = () => {
    try {
      return answersLeftBehind(JSON.parse(pre.model?.raw ?? pre.raw), JSON.parse(readFileSync(modelRecordPath(run.runDir, P.findings), "utf8")),
        ctx.framework?.bands);
    } catch { return []; }   // an unreadable record is the ladder's business, not this check's
  };
  const answers = leftBehind();
  if (!answers.length) return;
  runLog(run.runDir, { event: "corrective-answers-left-behind", answers });
  note(`[corrections] ${answers.length} answer(s) in four_answers may miss findings the correction moved (${answers.map((a) => a.answer).join(", ")}) — asking once`);
  await stage("synthesis", ctx, {
    force: true, sessionKey: resume.synthesisKey, model: resume.synthesisModel, thinking: resume.synthesisThinking,
    trigger: "corrective-answers",
    followup: repairFollowup("synthesis:corrective-answers", { findings: modelRecordPath(run.runDir, P.findings), answers }) + stageCharter("synthesis", ctx.depth, ctx.framework),
  });
  const still = leftBehind();
  runLog(run.runDir, { event: "corrective-answers-after", answers: still });
  if (still.length) note(`[corrections] ${still.map((a) => a.answer).join(", ")} still name(s) the findings as before — recorded; any reason the writer gave is in the corrections note, and the recheck reads the answers`);
}

/** Keep the basis at the corrective pass, from the two records the applied table was built from. Throws on a write failure; the caller is never-kill. */
export function recordCorrectionsBasis(runDir, rows, preDoc, postDoc) {   // @internal
  const basis = correctionTargets(rows, preDoc, postDoc);
  atomicWrite(driverDir(runDir, CORRECTIONS_DELIVERED_FILE), JSON.stringify({
    _provenance: "whether each reviewer correction reached the record the report was built from: the basis is kept at the corrective pass, and every assembly reads it against the delivered record (corrections-delivered.mjs)",
    basisAt: new Date().toISOString(), basis,
  }, null, 2) + "\n");
  return basis;
}
