// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// knockout-correction-record.mjs — record_knockout_correction: a material defect reaches the step that can repair it.
//
// The knockout's independent check names a defect by mark and finding, with what it rests on. It changes nothing itself,
// because a band and a finding are the rating step's to reason. So a defect goes back to that step, for one correction and
// one recheck, as an address and never as prose to match. Nothing else about the batch is reopened.
//
// WHAT STANDS, STANDS BY CONSTRUCTION. A call may touch only the names a defect names and, inside one, only the findings a
// defect names, plus a new finding where a defect says one is missing. A sibling cannot drift, because no field reaches it.
// A call sends only what changes, and its rows merge onto the chunk the run already holds.
//
// THE CHUNK IS THE RECORD, so a corrected batch composes as a rated one does, through the same steps and the same gate, and
// a resumed run reads the correction back rather than losing it. The chunk as first rated is kept beside the run's work:
// the record the check read, and what comes back if the corrected record cannot pass the gate.
//
// A DEPENDENT ANSWER MOVES WITH WHAT IT DEPENDS ON. A rating that moves brings its basis, its opening read and the batch
// summary with it, and the summary's block for the name has to carry the band the name now has. Whether the prose is right
// is the recheck's to read; these checks only stop an answer being left behind on the old band.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { captureCall, stampVerdict } from "./call-capture.mjs";
import { DRIVER_DIR, driverDir } from "../shared/driver-dir.mjs";
import { acceptedEnvelope } from "./preserve-merge.mjs";
import { acceptKnockoutAssess, knockoutAssessCallPaths, knockoutAssessChunkFile, refuseUndeclared } from "./knockout-assess-record.mjs";
import { validators as koValidators } from "./verify-knockout.mjs";

const TOKEN = "knockoutcorrection";
const SCHEMA_VERSION = 1;

/** The artifact one correction leaves: the answer to each defect in its chunk, at the run root as a model's output is. */
export const knockoutCorrectionFile = (runDir, chunkNo) => join(String(runDir ?? ""), `knockout-correction-${Number(chunkNo)}.json`);
export const KNOCKOUT_CORRECTION_RE = /^knockout-correction-\d+\.json$/;

/** The driver's own account of the round: the record the check read, and each defect with its address. */
export const correctionWorkPath = (runDir) => driverDir(runDir, "knockout-correction-work.json");
const chunkBasePath = (runDir, chunkNo) => driverDir(runDir, `knockout-correction-base-${Number(chunkNo)}.json`);
const correctionCallDir = (runDir, chunkNo) => driverDir(runDir, join("knockout-correction-calls", `chunk-${Number(chunkNo)}`));

const nameKey = (s) => String(s ?? "").trim().toLowerCase();
const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };
/** A finding's identity across a renumbering: the gate re-ranks on the band, so an ordinal does not survive a move. */
export const sameFinding = (a, b) => nameKey(a?.name) === nameKey(b?.name) && nameKey(a?.owner) === nameKey(b?.owner);
const withoutOrdinal = (f) => { const { ordinal: _ordinal, ...rest } = f ?? {}; return JSON.stringify(rest); };

/**
 * The round's work, from the record the check read and the defects it raised: each numbered, on its chunk, with the finding
 * it names held by identity. A defect on a name no chunk holds cannot have passed the review's own gate. PURE.
 */
export function correctionWork({ rated, material, chunks }) {
  const chunkOf = new Map((chunks ?? []).flatMap((names, c) => names.map((n) => [nameKey(n?.name ?? n), c])));
  const defects = (material ?? []).map((m, i) => {
    const mark = (rated?.marks ?? []).find((r) => nameKey(r?.name) === nameKey(m.mark));
    const finding = m.finding == null ? null : (mark?.findings ?? []).find((f) => f?.ordinal === m.finding) ?? null;
    return { n: i + 1, kind: m.kind, mark: m.mark, ...(m.finding != null ? { finding: m.finding } : {}), problem: m.problem, rests_on: m.rests_on ?? [],
      chunk: chunkOf.get(nameKey(m.mark)) ?? null,
      ...(finding ? { names: { name: finding.name, owner: finding.owner } } : {}) };
  });
  return { schema_version: SCHEMA_VERSION, rated, defects };
}

export const readCorrectionWork = (runDir) => readJson(correctionWorkPath(runDir));

/** Keep each chunk a defect touches as it was rated. Written once: a resumed round must not take a corrected chunk for the base. */
export function keepChunkBases(runDir, chunkNos) {
  for (const c of chunkNos) {
    if (!existsSync(chunkBasePath(runDir, c))) copyFileSync(knockoutAssessChunkFile(runDir, c), chunkBasePath(runDir, c));
  }
}

/** Put the chunks back as they were rated. The round's work says it stood down, so a resumed run does not go through it again. */
export function restoreChunkBases(runDir, chunkNos) {
  for (const c of chunkNos) {
    if (existsSync(chunkBasePath(runDir, c))) copyFileSync(chunkBasePath(runDir, c), knockoutAssessChunkFile(runDir, c));
  }
}

/** Which marks and which findings of one chunk the round may touch, read against the chunk as rated. PURE. */
export function chunkScope(work, chunkNo, base) {
  const byMark = new Map();
  const defects = (work?.defects ?? []).filter((d) => d.chunk === Number(chunkNo));
  for (const d of defects) {
    const key = nameKey(d.mark);
    const row = byMark.get(key) ?? { flagged: new Set(), adds: false };
    if (d.names) {
      const mark = (base?.marks ?? []).find((m) => nameKey(m?.name) === key);
      for (const f of mark?.findings ?? []) if (sameFinding(f, d.names)) row.flagged.add(f.ordinal);
    }
    if (["missing", "exclusion", "scope"].includes(d.kind)) row.adds = true;
    byMark.set(key, row);
  }
  return { defects, byMark };
}

/** One name's block in a chunk summary: its `## NAME` sub-header to the next. Null where it has none. PURE. */
export function summaryBlock(summary, name) {
  const want = nameKey(name);
  const lines = String(summary ?? "").split("\n");
  const at = lines.findIndex((l) => /^##\s/.test(l) && l.toLowerCase().includes(want));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  return lines.slice(at, end < 0 ? lines.length : end).join("\n");
}

function patchedFindings(mark, baseMark, row, scope, refuse) {
  const out = new Map((mark?.findings ?? []).map((f) => [f?.ordinal, f]));
  const asRated = new Map((baseMark?.findings ?? []).map((f) => [f?.ordinal, f]));
  for (const f of row.findings ?? []) {
    if (!Number.isInteger(f?.ordinal)) return refuse(`finding_ordinal:${row.name}: each finding names its ordinal: an existing one to replace it, or the next one for a new finding.`);
    const was = asRated.get(f.ordinal);
    if (was && !scope.flagged.has(f.ordinal) && withoutOrdinal(was) !== withoutOrdinal(f)) return refuse(`finding_scope:${row.name}: no defect names finding ${f.ordinal}, so it stays as it is.`);
    if (!was && !scope.adds) return refuse(`finding_new:${row.name}: no defect on this name asks for a new finding, and ${f.ordinal} is not one it holds.`);
    out.set(f.ordinal, f);
  }
  for (const o of row.remove_findings ?? []) {
    if (!scope.flagged.has(o)) return refuse(`finding_remove:${row.name}: no defect names finding ${o}, so it stays as it is.`);
    out.delete(o);
  }
  return [...out.values()].sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * The chunk with one call applied, or why it cannot be. PURE. `held` is the chunk as it now stands, and `base` as it was
 * rated: scope is read against the second, so a repair may re-send what an earlier call changed.
 */
export function applyCorrectionCall({ held, base, call, scope }) {
  const refuse = (what) => ({ ok: false, reason: `${TOKEN}_${what}` });
  let failure = null;
  const stop = (what) => { failure = refuse(what); return null; };
  const marks = (held?.marks ?? []).map((m) => m);
  const moved = [];
  for (const row of Array.isArray(call?.marks) ? call.marks : []) {
    const name = String(row?.name ?? "");
    const inScope = scope.byMark.get(nameKey(name));
    if (!inScope) return refuse(`scope:${name}: no material defect names this mark. Leave it as it stands.`);
    const i = marks.findIndex((m) => nameKey(m?.name) === nameKey(name));
    if (i < 0) return refuse(`scope:${name}: this name is not in the chunk you were handed.`);
    const baseMark = (base?.marks ?? []).find((m) => nameKey(m?.name) === nameKey(name));
    const { findings: _findings, remove_findings: _removed, ...fields } = row;
    const next = { ...marks[i], ...fields };
    if (row.findings !== undefined || row.remove_findings !== undefined) {
      next.findings = patchedFindings(marks[i], baseMark, row, inScope, stop);
      if (failure) return failure;
    }
    const was = `${marks[i].rating}|${marks[i].ratingQualifier ?? ""}`, now = `${next.rating}|${next.ratingQualifier ?? ""}`;
    if (was !== now) {
      for (const key of ["basis", "assessment"]) {
        if (row[key] === undefined) return refuse(`dependent:${name}: the rating moved from ${marks[i].rating} to ${next.rating}, and ${key} still reads for the old band. Send it as it now reads.`);
      }
      if (call.chunkSummary === undefined) return refuse(`dependent:${name}: the rating moved from ${marks[i].rating} to ${next.rating}, and chunkSummary still reads for the old band. Send it as it now reads.`);
    }
    marks[i] = next;
    moved.push(name);
  }
  const chunkSummary = call?.chunkSummary ?? held?.chunkSummary;
  for (const name of moved) {
    const m = marks.find((x) => nameKey(x?.name) === nameKey(name));
    const block = summaryBlock(chunkSummary, name);
    if (block && !block.toLowerCase().includes(String(m.rating ?? "").toLowerCase())) return refuse(`summary:${name}: its block in chunkSummary does not carry its band, ${m.rating}. Send chunkSummary as it now reads.`);
  }
  return { ok: true, chunk: { ...held, marks, chunkSummary } };
}

/** The answers so far with this call's merged on by defect, or why they cannot stand. PURE. */
export function mergedAnswers(stored, received, scope, { base, chunk }) {
  const refuse = (what) => ({ ok: false, reason: `${TOKEN}_${what}` });
  const known = new Map(scope.defects.map((d) => [d.n, d]));
  const byDefect = new Map((stored ?? []).map((a) => [a.defect, a]));
  for (const a of Array.isArray(received) ? received : []) {
    if (!known.has(a?.defect)) return refuse(`answers: there is no defect ${a?.defect} on this chunk.`);
    if (!["changed", "stands"].includes(a?.outcome)) return refuse(`answers: defect ${a.defect} takes outcome "changed" or "stands".`);
    if (typeof a?.why !== "string" || !a.why.trim()) return refuse(`answers: defect ${a.defect} carries no reason. Write down what you changed, or why the record stands.`);
    byDefect.set(a.defect, { defect: a.defect, outcome: a.outcome, why: a.why.trim() });
  }
  const unanswered = scope.defects.filter((d) => !byDefect.has(d.n)).map((d) => d.n);
  if (unanswered.length) return refuse(`answers: defect ${unanswered.join(", ")} has no answer. Each is answered changed or stands, with its reason.`);
  for (const a of byDefect.values()) {
    if (a.outcome !== "changed") continue;
    const d = known.get(a.defect);
    const of = (doc) => (doc?.marks ?? []).find((m) => nameKey(m?.name) === nameKey(d.mark));
    if (JSON.stringify(of(base)) === JSON.stringify(of(chunk))) return refuse(`answers: defect ${a.defect} says changed, and nothing on ${d.mark} differs from the rated record. Send the change, or answer stands with your reason.`);
  }
  return { ok: true, answers: [...byDefect.values()].sort((x, y) => x.defect - y.defect) };
}

export function recordKnockoutCorrection(runDir, received, { boundOrdinal = null, now = () => new Date().toISOString() } = {}) {
  const dir = String(runDir ?? "");
  if (boundOrdinal === null || boundOrdinal === "") return { written: null, refused: `${TOKEN}_unbound: no chunk was bound for this turn. The driver sets it from the label it dispatched.` };
  const chunkNo = Number(boundOrdinal);
  const callDir = correctionCallDir(dir, chunkNo);
  const cap = captureCall({ nameFor: (seq) => join(callDir, `call-${String(seq).padStart(3, "0")}.json`), params: received, extra: { boundOrdinal: String(boundOrdinal) }, now });
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };
  const refused = (reason) => {
    try { writeFileSync(join(callDir, "refusals.jsonl"), JSON.stringify({ at: now(), reason }) + "\n", { flag: "a" }); }
    catch { /* the refusal still stands and is still returned */ }
    return { written: null, refused: reason, captured: closeCapture({ ok: false, refused: reason }), capture_failed: cap.failed };
  };

  const { answers: receivedAnswers, ...rest } = received ?? {};
  const undeclared = refuseUndeclared({ ...rest, marks: (Array.isArray(rest.marks) ? rest.marks : []).map(({ remove_findings: _r, ...m }) => m) });
  if (undeclared) return refused(undeclared.replace(/^knockoutassess/, TOKEN));

  const work = readCorrectionWork(dir);
  const file = knockoutAssessChunkFile(dir, chunkNo);
  const held = readJson(file), base = readJson(chunkBasePath(dir, chunkNo));
  if (!work || !held || !base) return refused(`${TOKEN}_state: this run holds no correction for chunk ${chunkNo}.`);
  const scope = chunkScope(work, chunkNo, base);

  const applied = applyCorrectionCall({ held, base, call: rest, scope });
  if (!applied.ok) return refused(applied.reason);
  const receipt = knockoutCorrectionFile(dir, chunkNo);
  const answers = mergedAnswers(readJson(receipt)?.answers, receivedAnswers, scope, { base, chunk: applied.chunk });
  if (!answers.ok) return refused(answers.reason);

  // THE SAME GATES A RATED CHUNK PASSED, at the call, while the seat can still repair what they name.
  const shape = acceptKnockoutAssess(applied.chunk, { boundOrdinal });
  if (!shape.ok) return refused(shape.reason);
  const text = JSON.stringify(shape.model, null, 2) + "\n";
  const gate = koValidators.knockoutAssessChunk(file, text);
  if (!gate.ok) return refused(`${TOKEN}_gate: ${gate.reason}`);

  try {
    writeFileSync(file, text);
    writeFileSync(receipt, JSON.stringify({ schema_version: SCHEMA_VERSION, chunk: chunkNo, answers: answers.answers }, null, 2) + "\n");
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200), captured: closeCapture({ ok: false, write_failed: true }), capture_failed: cap.failed };
  }
  try { writeFileSync(knockoutAssessCallPaths(dir, chunkNo).accepted, acceptedEnvelope(shape.model, now())); }
  catch { /* the chunk is the record; this is only the base a later rating call would merge onto */ }
  return { written: receipt, refused: null, chunk: chunkNo, answers: answers.answers.length, captured: closeCapture({ ok: true }), capture_failed: cap.failed };
}

/** Is this correction's answer whole? koStage's skip-if-valid read, and the stage's own check. */
export function validateKnockoutCorrectionFile(file, content) {
  let doc;
  try { doc = JSON.parse(content); } catch (e) { return { ok: false, reason: `not valid JSON: ${e.message}` }; }
  const dir = dirname(file);
  const runDir = basename(dir) === DRIVER_DIR ? dirname(dir) : dir;
  const work = readCorrectionWork(runDir);
  if (!work) return { ok: false, reason: "this run holds no correction, so this answer cannot be checked." };
  const said = new Set((Array.isArray(doc?.answers) ? doc.answers : []).map((a) => a?.defect));
  const open = (work.defects ?? []).filter((d) => d.chunk === doc?.chunk && !said.has(d.n)).map((d) => d.n);
  return open.length ? { ok: false, reason: `defect ${open.join(", ")} has no answer.` } : { ok: true };
}

/** The refusals journalled for this chunk, newest last. The accessor a tool-written row carries. */
export function knockoutCorrectionRefusalsFor(runDir, chunkNo = 0) {
  try {
    return readFileSync(join(correctionCallDir(String(runDir ?? ""), chunkNo), "refusals.jsonl"), "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { reason: l }; } });
  } catch { return []; }
}

/** The answers every chunk of the round has given, by defect. */
export function correctionAnswers(runDir, chunkNos) {
  const out = new Map();
  for (const c of chunkNos) for (const a of readJson(knockoutCorrectionFile(runDir, c))?.answers ?? []) out.set(a.defect, a);
  return out;
}

/**
 * What the driver saw of each defect, comparing the record the check read with the corrected one: in the shape and the
 * words the full engine's table and its resolved set read (corrections-feedforward.mjs). Findings are joined by identity,
 * because the gate renumbers on the band. A correction's own account rides as its reason, and never decides. PURE.
 */
export function correctionOutcomes(work, after, answers = new Map()) {
  const of = (doc, name) => (doc?.marks ?? []).find((m) => nameKey(m?.name) === nameKey(name)) ?? null;
  return (work?.defects ?? []).map((d) => {
    const was = of(work.rated, d.mark), now = of(after, d.mark);
    const common = { n: d.n, kind: d.kind, typed: true, text: d.problem, ordinals: d.finding != null ? [d.finding] : null,
      ...(answers.get(d.n) ? { reason: answers.get(d.n).why } : {}) };
    if (d.names) {
      const label = d.names.name ?? `finding ${d.finding}`;
      const before = (was?.findings ?? []).find((f) => sameFinding(f, d.names));
      const current = (now?.findings ?? []).find((f) => sameFinding(f, d.names));
      if (!current) return { ...common, targets: [label], outcome: "findings-removed", removed: [label] };
      return { ...common, targets: [label], outcome: withoutOrdinal(before) !== withoutOrdinal(current) ? "findings-changed" : "findings-unchanged", removed: [] };
    }
    const moved = JSON.stringify(was) !== JSON.stringify(now);
    return { ...common, targets: [d.mark], outcome: moved ? "line-changed" : "line-unchanged", removed: [] };
  });
}

/**
 * What moved that no defect named, or an empty answer. A call cannot reach these, so a row here is a fault between the chunk
 * and the record, not a seat's edit: the caller keeps the rated record. PURE.
 */
export function movedOutsideScope(work, after) {
  const flaggedNames = new Set((work?.defects ?? []).map((d) => nameKey(d.mark)));
  const marks = [], findings = [];
  for (const was of work?.rated?.marks ?? []) {
    const now = (after?.marks ?? []).find((m) => nameKey(m?.name) === nameKey(was?.name)) ?? null;
    if (!flaggedNames.has(nameKey(was?.name))) {
      if (JSON.stringify(was) !== JSON.stringify(now)) marks.push(was.name);
      continue;
    }
    const named = (work.defects ?? []).filter((d) => nameKey(d.mark) === nameKey(was.name) && d.names).map((d) => d.names);
    for (const f of was.findings ?? []) {
      if (named.some((n) => sameFinding(f, n))) continue;
      const current = (now?.findings ?? []).find((x) => sameFinding(x, f));
      if (!current || withoutOrdinal(f) !== withoutOrdinal(current)) findings.push({ mark: was.name, name: f.name });
    }
  }
  return { marks, findings };
}
