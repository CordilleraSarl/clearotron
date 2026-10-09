// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// blind-frame-record.mjs — the recording transport for the blind-frame stage's structured model.
//
// The stage hands back VALUES; the driver serializes them. The seat never writes blind-frame-model.json,
// so a stray brace cannot cost a run its cold model — today a malformed file surfaces as
// `blindframe_unparseable` and burns a corrective-ladder attempt on a formatting defect rather than a
// reasoning one.
//
// ── IT VALIDATES THROUGH THE SHIPPED PARSER, NOT A COPY ─────────────────────────────────────────────
//
// `parseBlindFrameModel` is what `verify.mjs` runs against the artifact. This module calls THAT function
// rather than re-checking the shape, so what the tool accepts and what the validator accepts cannot
// drift. A second validator would be a second writer's twin: two answers to "is this model well-formed",
// disagreeing silently, and the disagreement reading as a model defect.
//
// ── WHAT THE SCHEMA REMOVES RATHER THAN REFUSES ─────────────────────────────────────────────────────
//
// `direction` and `ranking_basis` are ENUMS in the tool's input schema (doubt-closure-call.mjs's `file_index`
// rule: a validator that rejects a bad value has MOVED the defect; a schema that cannot express one has
// REMOVED it). So `blindframe_direction_invalid` and `blindframe_ranking_basis_invalid` become
// unrepresentable at the transport rather than caught after the fact.
//
// The key-unknown family goes the same way: the schema names the keys, so `blindframe_key_unknown`
// cannot arise from a typed call. It stays reachable through the dictated path, which is why the parser
// keeps raising it and this module does not second-guess it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { refuseUndeclared as refuseUndeclaredShared, keepIfAbsent, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";
import { parseBlindFrameModel } from "./blind-frame-model.mjs";

export const MODEL_FILE = "blind-frame-model.json";
const SCHEMA_VERSION = 1;

/** Where the call's evidence lives — the driver's own record of what the seat handed it. */
export function blindFrameCallPaths(runDir) {
  const dir = driverDir(runDir, "blind-frame-calls");
  return { dir, payload: join(dir, "call-001.json"), accepted: join(dir, "accepted.json") };
}

/**
 * Assemble the model from typed params and validate it through the SHIPPED parser.
 *
 * Returns `{ok: true, model}` or `{ok: false, reason}` where reason is the parser's own token-first
 * message — the seat reads the same token the corrective ladder would have shown it an attempt later.
 * PURE.
 */
/** The shape this tool declares, at every depth — what the ACCEPTOR enforces. */
const DECLARED = Object.freeze({
  "": ["dominant_element", "variants", "fields", "sources", "ranking_basis"],
  variants: ["value", "direction", "rationale"],
  fields: ["goods", "on_field", "rationale"],
  sources: ["channel", "rationale"],
});

/** Refuse an undeclared key by path, at depth. Shared walk; the table above is what is this tool's. */
export const refuseUndeclared = (params) => refuseUndeclaredShared(params, DECLARED, "blindframe");

/** The last ACCEPTED call for this run, or null. */
export function lastAcceptedBlindFrame(runDir) {
  return lastAccepted(blindFrameCallPaths(String(runDir ?? "")).accepted, readFileSync);
}

/**
 * Merge a call onto the stored one. PURE. EVERY KEY DECIDED HERE, BEFORE IT IS WRITTEN.
 *
 * This transport wrote its artifact from the received call ALONE, so a repair rung that asked the seat
 * to correct part of it — and a seat that sent only the corrected part — silently deleted the rest.
 * Preserving rather than requiring, because nothing here can tell a first call from a repair and a
 * product refusal is never a pass. See preserve-merge.mjs for the class.
 */
export function mergeBlindFrameCall(stored, received) {
  const base = stored ?? {};
  return {
    dominant_element: received?.dominant_element,
    variants: received?.variants,
    fields: received?.fields,
    ranking_basis: received?.ranking_basis,
    // KEEP-IF-ABSENT. `sources` is the channel half of the cold threat model — the half frame-diff
    // compares the actual scope against, so losing it makes that comparison quietly narrower.
    sources: keepIfAbsent(received?.sources, base.sources),
  };
}

export function acceptBlindFrame(params) {
  const model = {
    schema_version: SCHEMA_VERSION,
    dominant_element: params?.dominant_element,
    variants: params?.variants,
    fields: params?.fields,
    sources: params?.sources,
    ranking_basis: params?.ranking_basis,
  };
  // Undefined optional groups are dropped rather than sent as `undefined`: JSON.stringify would remove
  // them anyway, and the parser must see the same object the file will.
  for (const k of Object.keys(model)) if (model[k] === undefined) delete model[k];

  try {
    return { ok: true, model: parseBlindFrameModel(JSON.stringify(model)) };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e) };
  }
}

/**
 * Capture what arrived, validate, and write the model — in that order.
 *
 * The capture happens BEFORE the decision for the same reason it does in the closure transport: a
 * payload recorded after validation records what we DECIDED, which is already in the answer, rather than
 * what we were GIVEN. Best-effort, and its failure is RETURNED rather than swallowed.
 */
export function recordBlindFrame(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload } = blindFrameCallPaths(String(runDir ?? ""));
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed `call-001.json`,
  // so a turn refused and then re-sent kept only the survivor: the file whose header promises "including
  // calls that were refused" held the one call that was not. Sequence 1 still resolves to `call-001.json`,
  // so every consumer reading that name is unmoved. Best-effort throughout, as the capture always was —
  // a lost forensic record never fails a run.
  const nameFor = (seq) => join(dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // ── ORDER IS THE MECHANISM ───────────────────────────────────────────────────
  //   1. CAPTURE what arrived (above), before any decision.
  //   2. REFUSE an undeclared key BY PATH, BEFORE the merge — a misplaced key must never reach the
  //      stored base, or the next repair inherits it.
  //   3. MERGE onto the last accepted call, so an omitted key comes back rather than being deleted.
  //   4. VALIDATE the MERGED call — it is what gets written; validating the received one would gate on
  //      a document nobody ships.
  //   5. WRITE the base only after 4 passes. A refused call must never become the base a later repair
  //      builds on, or one bad turn poisons every turn after it.
  const undeclared = refuseUndeclared(received);
  if (undeclared) {
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }
  const call = mergeBlindFrameCall(lastAcceptedBlindFrame(runDir), received);
  const verdict = acceptBlindFrame(call);
  if (!verdict.ok) {
    return {
      written: null,
      refused: verdict.reason,
      captured: closeCapture({ ok: false, refused: verdict.reason }),
      capture_failed: captureFailed,
    };
  }

  const at = join(String(runDir ?? ""), MODEL_FILE);
  try {
    writeFileSync(at, JSON.stringify(verdict.model, null, 2) + "\n");
    // Step 5. BEST-EFFORT, in its own try — see report-overview-record.mjs for why.
    try { writeFileSync(blindFrameCallPaths(String(runDir ?? "")).accepted, acceptedEnvelope(call, now())); }
    catch { /* a lost base is never a lost artifact */ }
  } catch (e) {
    // The model was VALID and we could not store it. That is an infrastructure failure and it must not
    // read as a rejected model — the two have opposite repairs.
    return {
      written: null,
      refused: null,
      write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }),
      capture_failed: captureFailed,
    };
  }

  return {
    written: at,
    refused: null,
    variants: verdict.model.variants.length,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** Read back what was written — used by the tool's answer so the seat is told the stored state. */
export function readRecordedModel(runDir) {
  try { return parseBlindFrameModel(readFileSync(join(String(runDir ?? ""), MODEL_FILE), "utf8")); }
  catch { return null; }
}
