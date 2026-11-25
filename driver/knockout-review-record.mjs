// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// record_knockout_review — the knockout lane's REVIEWING pass, as a typed return path.
//
// The review checks what the client is told against the request, the framework and the evidence the run holds. The clearance
// product's equivalent rides `narrative-refutation`.
//
// WHAT THE SEAT SENDS: its answer to the client's question (`first_question`) and the material defects (`material`). It rewords
// nothing; a supported line stands. `material` is REPLACED when present and KEPT when absent: it is the pass's whole answer to
// whether the client is being told the right thing, so half of one is not a thing.
//
// AND THE PASS CHANGES NO RATING. A material defect is named by mark and finding, with what it rests on, and
// goes to the step that can reason a band (knockout-correction-record.mjs).
//
// ONE REVIEW: a correction is not read again. A label that still carries a pass ordinal is kept apart by that ordinal.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { refuseUndeclared as refuseUndeclaredShared, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";
import { PERMITTED_SOURCES, registerRecordIdsHeld, urlHeldFor } from "./verify-knockout.mjs";
import { DRIVER_DIR, driverDir, paths as runPaths, readJson } from "./run-record.mjs";

const SCHEMA_VERSION = 1;

/**
 * Path → the keys that path declares, in `refuseUndeclared`'s own shape.
 *
 * The top level ("") is deliberately permissive by that helper's rule — an envelope field nobody reads
 * must never kill a stage. The care is inside the typed sub-object: a material row's field under a key this tool does not
 * declare would be accepted and then dropped, and the artifact would say the seat named what it did not.
 */
const DECLARED = {
  "": ["schema_version", "first_question", "material"],
  material: ["kind", "mark", "finding", "problem", "rests_on"],
};

// THE KEYS AN EARLIER REVIEW SENT, when it reworded the lines a reader meets first. It rewords nothing now.
const RETIRED_KEYS = Object.freeze(["rewrites", "declined"]);
const RETIRED_REASON = (k) => `this review rewords nothing, so it takes no \`${k}\`: send \`first_question\` and \`material\` only`;

/** What a material defect can be, and whether it has to name the evidence it rests on. */
export const MATERIAL_KINDS = Object.freeze({ band: false, missing: true, exclusion: true, scope: false, contradiction: false });

/** One file per call, refusals included, beside the other transports' capture directories. A later pass keeps its own. */
export function knockoutReviewCallPaths(runDir, pass = 0) {
  const dir = pass ? driverDir(runDir, join("knockout-review-calls", `pass-${Number(pass)}`)) : runPaths(runDir).knockoutReviewCalls;
  return { dir, accepted: join(dir, "accepted.json"), refusals: join(dir, "refusals.jsonl") };
}

/**
 * The artifact this transport writes, AT THE RUN ROOT.
 *
 * NOT UNDER `_driver/`, and the lane learned that the expensive way. `_driver/` is the driver's own
 * measurements and is behind a deny hook; a stage whose `out` lands there has a seat that will be
 * refused on Write and on Bash, and a corrective ladder that exhausts against a dispatch ordering a
 * write nothing permits. The assess chunk was relocated out of it for exactly that reason. This file is
 * a MODEL output — the seat's answer — so the run root is where it belongs by the same rule, and an
 * arm sweeps both stage tables to keep it there.
 *
 * The CALL captures stay under `_driver/`: those are the driver's record of what arrived, not a seat's
 * output, and nothing dispatches against them.
 */
export function knockoutReviewFile(runDir, pass = 0) {
  return join(String(runDir ?? ""), pass ? `knockout-review-${Number(pass)}.json` : "knockout-review.json");
}

/** SHAPE ONLY. Whether a material row joins this run's record is the validator's join, not this. */
export function acceptKnockoutReview(call) {
  // THE REVIEW REWORDS NOTHING: a call that still sends a rewrite or a declined line is refused, never quietly dropped.
  for (const k of RETIRED_KEYS) {
    const v = call?.[k];
    if (v !== undefined && !(Array.isArray(v) && !v.length)) return { ok: false, reason: RETIRED_REASON(k) };
  }
  // THE ANSWER TO THE QUESTION THE PASS OPENS ON is recorded when the seat sends it. Only words are kept; anything else is left out
  // rather than refused.
  const firstQuestion = typeof call?.first_question === "string" && call.first_question.trim() ? call.first_question : undefined;
  const material = call?.material;
  if (material !== undefined && !Array.isArray(material)) return { ok: false, reason: "material must be an array" };
  for (const m of material ?? []) {
    if (!Object.hasOwn(MATERIAL_KINDS, m?.kind)) return { ok: false, reason: `a material row's kind is one of ${Object.keys(MATERIAL_KINDS).join(", ")}` };
    if (typeof m?.mark !== "string" || !m.mark.trim()) return { ok: false, reason: "a material row names the mark it is about, verbatim" };
    if (m.finding !== undefined && !Number.isInteger(m.finding)) return { ok: false, reason: `the material row on "${m.mark}": finding is the finding's ordinal` };
    if (typeof m?.problem !== "string" || !m.problem.trim()) return { ok: false, reason: `the material row on "${m.mark}" says nothing about what is wrong` };
    const rests = m.rests_on;
    if (rests !== undefined && (!Array.isArray(rests) || rests.some((r) => typeof r !== "string" || !r.trim()))) return { ok: false, reason: `the material row on "${m.mark}": rests_on is a list of held recordIds, question qids, and URLs` };
    if (MATERIAL_KINDS[m.kind] && !rests?.length) return { ok: false, reason: `the ${m.kind} row on "${m.mark}" names no evidence: send the recordIds, question qids, or URLs it rests on in rests_on` };
  }
  // A CLEAN READ IS AN ANSWER: the question answered and an empty list of defects sent. A call with neither cannot be told from a
  // stage that never ran.
  if (!(material ?? []).length && !(Array.isArray(material) && firstQuestion !== undefined))
    return { ok: false, reason: "send `first_question` and `material`, an empty list where you found no defect — an empty call cannot be told from a stage that never ran" };
  return { ok: true, model: { schema_version: SCHEMA_VERSION, ...(firstQuestion !== undefined ? { first_question: firstQuestion } : {}), material: material ?? [] } };
}

/** Merge a repair turn onto what was already accepted: `material` replaced when present and kept when absent, the answer likewise. */
export function mergeKnockoutReviewCall(was, now) {
  if (!was) return { ...now };
  // A call accepted by an earlier build may carry the retired keys; only this turn's own can be refused.
  const { rewrites: _rewrites, declined: _declined, ...base } = was;
  return { ...base, ...now, material: now?.material ?? base.material };
}

/**
 * The stage's `validate` — shape, and the JOIN against the record this run actually holds.
 *
 * THE JOIN IS THE HALF THAT MATTERS. Shape alone accepts a material row aimed at a mark this run does not carry, or resting on a
 * source it does not hold. Refusing here puts the reason in front of the seat while it can still send a repair turn.
 */
export function validateKnockoutReviewFile(file, text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { ok: false, reason: `not valid JSON: ${e.message}` }; }
  const shape = acceptKnockoutReview(doc);
  if (!shape.ok) return shape;

  // The run dir, from the artifact's own path rather than a fixed depth — the assumption that bit the
  // assess validator when its chunk file moved out of `_driver/`.
  const dir = dirname(file);
  const runDir = basename(dir) === DRIVER_DIR ? dirname(dir) : dir;
  const findingsFile = join(runDir, "knockout-findings.json");
  if (!existsSync(findingsFile)) {
    // A COULD-NOT-LOOK, SAID AS ONE. Passing here would let every material row through unchecked.
    return { ok: false, reason: `the merged record is not on disk at ${findingsFile}, so no address could be checked` };
  }
  let merged;
  try { merged = readJson(findingsFile); }
  catch (e) { return { ok: false, reason: `the merged record will not parse, so no address could be checked: ${e.message}` }; }
  const fault = joinFault(doc, merged, runDir);
  return fault ? { ok: false, reason: fault } : { ok: true };
}

/**
 * THE JOIN AGAINST THE RUN'S RECORD: why this answer cannot stand, or null. It runs at the recording call as well as at the stage's end,
 * so a bad reference is refused while the seat can still repair it in its turn. Heard only at the end, it cost a whole attempt each
 * time: on a saved batch, 2026-11-05, two refusals of one reference spent 430 s and 50,000 generated tokens on one stage.
 */
function joinFault(doc, merged, runDir) {
  for (const m of doc.material ?? []) {
    const fault = materialFault(m, merged, runDir);
    if (fault) return fault;
  }
  return null;
}

/** Why a material row cannot be joined to what this run holds, or null. Whether the defect is real is the reader's judgment. */
function materialFault(m, merged, runDir) {
  const mark = (merged?.marks ?? []).find((r) => String(r?.name ?? "") === m.mark);
  if (!mark) return `the material row names "${m.mark}", which is not a name on this record. Copy it verbatim.`;
  if (m.finding !== undefined && !(mark.findings ?? []).some((f) => f?.ordinal === m.finding)) return `the material row on "${m.mark}" names finding ${m.finding}, which it does not hold.`;
  // WHAT THE RUN HOLDS, not what it holds under this name: a filing, a recorded research payload or an owner check may bear on more than
  // one name. A question the run asked is held too, by its qid. Anything else is refused, in words about those sources and not the run.
  const records = registerRecordIdsHeld(runDir);
  let questions = new Set();
  try { questions = new Set((readJson(runPaths(runDir).registerRecords).marks ?? []).flatMap((e) => (e?.terms ?? []).map((t) => String(t?.qid ?? "")))); } catch { questions = new Set(); }
  const urlHeld = urlHeldFor(runDir);
  const stranger = (m.rests_on ?? []).find((r) => !records.has(r) && !questions.has(r) && !urlHeld(r));
  return stranger ? `the material row on "${m.mark}" rests on "${stranger}", which is not traceable to ${PERMITTED_SOURCES}, or a question this run asked. Copy a recordId, question qid, or URL from what this run holds.` : null;
}

export function recordKnockoutReview(runDir, received, { boundOrdinal = null, now = () => new Date().toISOString() } = {}) {
  const dir = String(runDir ?? "");
  const pass = Number(boundOrdinal) || 0;
  const paths = knockoutReviewCallPaths(dir, pass);
  const nameFor = (seq) => join(paths.dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  const journal = (reason) => {
    try { writeFileSync(paths.refusals, JSON.stringify({ at: now(), reason }) + "\n", { flag: "a" }); }
    catch { /* the refusal still stands and is still returned */ }
  };

  const undeclared = refuseUndeclaredShared(received, DECLARED, "knockoutreview");
  if (undeclared) {
    journal(undeclared);
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }

  // THE READER IS PASSED. `lastAccepted` throws without it rather than answering "nothing stored yet" —
  // the failure knockout-frame shipped, where every repair turn merged onto an empty base and was
  // refused for a field the seat had already sent.
  const call = mergeKnockoutReviewCall(lastAccepted(paths.accepted, readFileSync), received);
  const verdict = acceptKnockoutReview(call);
  if (!verdict.ok) {
    journal(verdict.reason);
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  // Where the record is on disk the seat hears the join now, in its turn. Where it is not, the stage's own check says it could not look.
  const held = (() => { try { return readJson(join(dir, "knockout-findings.json")); } catch { return null; } })();
  const fault = held ? joinFault(verdict.model, held, dir) : null;
  if (fault) {
    journal(fault);
    return { written: null, refused: fault, captured: closeCapture({ ok: false, refused: fault }), capture_failed: captureFailed };
  }

  const file = knockoutReviewFile(dir, pass);
  try {
    writeFileSync(file, JSON.stringify(verdict.model, null, 2) + "\n");
    writeFileSync(paths.accepted, acceptedEnvelope(call, now()));
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: file,
    refused: null,
    material: verdict.model.material.length,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** The refusals journalled for this run, newest last. The accessor a TOOL_WRITTEN_ARTIFACTS row carries. */
export function knockoutReviewRefusalsFor(runDir) {
  try {
    return readFileSync(knockoutReviewCallPaths(String(runDir ?? "")).refusals, "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { reason: l }; } });
  } catch { return []; }
}
