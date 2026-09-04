// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ── record_knockout_frame — the knockout lane's FRAMING stage, as a typed return path ───────────────
//
// item C, and the lane's second and last conversion. The seat sends the batch plan as
// VALUES and the scope note as one string; the driver writes both files.
//
// ── TWO ARTIFACTS FROM ONE CALL, AND ONLY ONE OF THEM WAS EVER CHECKED ─────────────────────────────
//
// This stage writes `knockout-plan.json` AND `knockout-frame.md`. `koStage` takes its `expectFile` and
// its `validate` from the stage's `out`, which is the PLAN — so before this conversion a seat that wrote
// the plan and skipped the note passed the stage, and the missing note surfaced only in a scenario run
// in another repo. After it, the note exists whenever the call succeeded. That is a consequence of the
// move rather than a feature of it, and it is written down because if this conversion is ever reverted
// the gap comes back silently.
//
// ── THE NOTE IS WRITTEN VERBATIM. THE DRIVER COMPOSES NOTHING INTO IT ──────────────────────────────
//
// `knockout-frame.md` is checked by the e2e `names-configured-depth` op: it must name the search the
// registry says was configured, and name no other. That is a transparency promise to a client, and its
// baseline lives in the CONFIG repo, which cannot be read from here.
//
// So this transport moves WHO WRITES the file and changes nothing about what it says. `scope_note` is
// written byte-for-byte as sent — no heading, no product line, no trailing-newline fixup. A composed
// note might well be better (see the coupling filed on the tracker: the product name is hardcoded in the
// dispatch and derived from the registry by the op, and they agree by coincidence). It is not this PR's
// to attempt, because a wording change cannot be proven safe from this repo.
//
// ── WHAT THIS ACCEPTOR TAKES, AND WHAT STAYS WITH THE VALIDATOR ────────────────────────────────────
//
// Same split as knockout-assess: SHAPE here, and nothing that reads driver state. `knockoutPlan` keeps
// the one check that joins against something on disk — name parity against `_driver/instructed-scope.json`,
// the paraphrase-drift gate.
//
// ✕ THE KEBAB-COLLISION CHECK IS DUPLICATED, NOT MOVED, and that is deliberate. It classifies as shape —
// it is computed from the payload's own names — so by the rule above it belongs here. It also guards a
// silent client-facing failure: two marks that differ only in spacing, punctuation or case collapse to
// one research key, so one is never swept and is then assessed against the other's evidence. Moving it
// costs that incident if the classification's assumption ever breaks; holding it on both sides costs one
// duplicated predicate. On a failure of that shape the redundancy is the cheaper side of the trade, and
// the predicate itself is IMPORTED from `search-policy.mjs` rather than restated, so the two copies
// cannot disagree about what a collision is.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { refuseUndeclared as refuseUndeclaredShared, keepIfAbsent, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";
// The collision predicate itself, imported. See the duplication note above: two copies of a rule are how
// two gates come to disagree about what they are enforcing.
import { kebabCollisions } from "./search-policy.mjs";

const SCHEMA_VERSION = 1;

/** The two artifacts this transport writes, both at the RUN ROOT and both exact basenames. */
export function knockoutFrameFiles(runDir) {
  const dir = String(runDir ?? "");
  return { frame: join(dir, "knockout-frame.md"), plan: join(dir, "knockout-plan.json") };
}

/**
 * Where the call's evidence lives. PER RUN, not per anything: this stage is not fanned out — it frames
 * the whole batch in one turn — so unlike knockout-assess there is no ordinal to key on and one
 * directory cannot be overwritten by a sibling.
 */
export function knockoutFrameCallPaths(runDir) {
  const dir = driverDir(runDir, "knockout-frame-calls");
  return { dir, payload: join(dir, "call-001.json"), accepted: join(dir, "accepted.json"),
    refusals: join(dir, "refusals.jsonl") };
}

/**
 * THE SHAPE THIS TOOL DECLARES, at every depth — the same shape `tools/list` serves the seat.
 *
 * BUILT FROM THE VALIDATOR AND THE SKILL'S OWN OUTPUT CONTRACT, which agree here — `MARK_KEYS` in
 * `verify-knockout.mjs` and the JSON block in `skills/knockout-frame/SKILL.md` list the same eight keys
 * in the same order. That agreement is worth stating rather than assuming: on the assess stage they did
 * NOT agree, and five fields the validator required were absent from the doctrine's own template.
 *
 * `scope_note` is this transport's addition and appears in neither, because before this conversion the
 * note was not a value anything carried — it was a file the seat was told to write.
 */
const DECLARED = Object.freeze({
  "": ["schema", "batch", "marks", "scope_note"],
  batch: ["productContext", "umbrellaBrandNote", "executionOrder"],
  marks: ["ref", "name", "classes", "beltAndBraces", "classesPlain", "contextFraming", "priorKnowledge", "priority"],
});

/** Refuse an undeclared key by path, through the shared implementation every transport now uses. */
export const refuseUndeclared = (params) => refuseUndeclaredShared(params, DECLARED, "knockoutframe");

const str = (v) => (typeof v === "string" && v.trim() ? v : null);
const isClassArray = (v) => Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 45);

/** The last accepted call for this run, or null. */
export function lastAcceptedFrame(runDir) {
  return lastAccepted(knockoutFrameCallPaths(runDir).accepted, readFileSync);
}

/**
 * Fold a call into what is already stored, with the rule stated PER KEY.
 *
 * MARKS ARE MERGED BY NAME, exactly as the assess transport merges its own. A second call that resends
 * one corrected mark keeps the rest; a mark it does send replaces that mark's record WHOLE, because a
 * plan row is a single statement about one name and half a row is not a smaller statement, it is a
 * different one.
 *
 * `scope_note`, `batch` and `schema` take `keepIfAbsent`: `undefined` means "I did not speak about this"
 * and the stored value stands. `batch` merges per key rather than wholesale for the same reason marks do
 * — a second call correcting `executionOrder` must not silently drop `productContext`.
 */
export function mergeKnockoutFrameCall(stored, received) {
  const base = stored ?? {};
  const patch = received ?? {};
  const out = {};

  out.schema = SCHEMA_VERSION;
  out.scope_note = keepIfAbsent(patch.scope_note, base.scope_note);

  const bBase = base.batch ?? {};
  const bPatch = patch.batch ?? {};
  out.batch = {
    productContext: keepIfAbsent(bPatch.productContext, bBase.productContext),
    umbrellaBrandNote: keepIfAbsent(bPatch.umbrellaBrandNote, bBase.umbrellaBrandNote),
    executionOrder: keepIfAbsent(bPatch.executionOrder, bBase.executionOrder),
  };

  const byName = new Map();
  for (const m of Array.isArray(base.marks) ? base.marks : []) if (m?.name) byName.set(String(m.name), m);
  for (const m of Array.isArray(patch.marks) ? patch.marks : []) if (m?.name) byName.set(String(m.name), m);
  out.marks = [...byName.values()];
  return out;
}

/**
 * Is this a plan the driver may write? SHAPE ONLY — every check here is answerable from the payload.
 *
 * The one check deliberately NOT here is name parity against `_driver/instructed-scope.json`: it reads
 * driver state, so it stays in `knockoutPlan` where the file is in reach. A seat cannot satisfy it by
 * restating anything, which is exactly why it is not a call-time question.
 */
export function acceptKnockoutFrame(params) {
  const scopeNote = str(params?.scope_note);
  if (!scopeNote)
    return { ok: false, reason: "knockoutframe_note_missing: scope_note is required — the 2–3 sentence scope note the driver writes to knockout-frame.md. It is the surface an audit reads to see which search ran, and before this transport a run could complete without one" };

  const productContext = str(params?.batch?.productContext);
  if (!productContext)
    return { ok: false, reason: "knockoutframe_context_missing: batch.productContext (one sentence) is required — every mark's contextFraming is read against it" };

  const marks = Array.isArray(params?.marks) ? params.marks : null;
  if (!marks || !marks.length)
    return { ok: false, reason: "knockoutframe_marks_missing: marks[] is required and cannot be empty — a plan carries one row per instructed mark" };

  for (const m of marks) {
    const name = str(m?.name);
    if (!name)
      return { ok: false, reason: "knockoutframe_mark_unnamed: every plan mark carries its name verbatim from the instructed scope" };
    if (!str(m?.classesPlain))
      return { ok: false, reason: `knockoutframe_classes_plain:${name} — classesPlain is required: the sweep prompt's plain-language class line` };
    if (!str(m?.contextFraming))
      return { ok: false, reason: `knockoutframe_context_framing:${name} — contextFraming is required, and the rating hangs off it: the assess stage is told to rate WITH this field, per mark` };
    for (const ck of ["classes", "beltAndBraces"]) {
      if (m?.[ck] != null && !isClassArray(m[ck]))
        return { ok: false, reason: `knockoutframe_classes:${name}.${ck} must be Nice-class integers 1–45 — these interpolate into report and email HTML, so a free string is both a contract break and an injection surface` };
    }
  }

  // DUPLICATED FROM THE VALIDATOR ON PURPOSE — see the header. Two marks that differ only in spacing,
  // punctuation or case share one research key, so one is never swept and is then assessed against the
  // other's evidence. Refused at the call, where the seat can still reword one.
  const collisions = kebabCollisions(marks.map((m) => String(m?.name ?? "")));
  if (collisions.length)
    return { ok: false, reason: `knockoutframe_key_collision: marks ${collisions.map(([a, b]) => `"${a}"/"${b}"`).join(", ")} collide to the same research key — a batch cannot carry two marks that differ only in spacing, punctuation or case, because they would share ONE research payload and one of them would be rated on the other's evidence. Reword or drop one` };

  const order = params?.batch?.executionOrder;
  if (order != null) {
    if (!Array.isArray(order))
      return { ok: false, reason: "knockoutframe_order_shape: batch.executionOrder must be an array of mark names when present" };
    const names = new Set(marks.map((m) => String(m?.name ?? "").trim().toLowerCase()));
    for (const n of order) {
      if (!names.has(String(n ?? "").trim().toLowerCase()))
        return { ok: false, reason: `knockoutframe_order_unknown: executionOrder names "${n}", which is not a mark in this plan` };
    }
  }

  return { ok: true, model: { schema: SCHEMA_VERSION, batch: params.batch, marks, scope_note: scopeNote } };
}

/**
 * Record one `record_knockout_frame` call. The order of the five steps is the contract:
 *
 *   1. CAPTURE the payload as received, before any judgment — the evidence survives a refusal.
 *   2. REFUSE undeclared keys by path.
 *   3. MERGE into what is already stored, per the rules above.
 *   4. VALIDATE the MERGED result, never the patch alone: a second call is legal precisely because the
 *      stored value stands, so judging the patch in isolation would refuse a correct correction.
 *   5. WRITE only after 4 passes, so a refused call never becomes the base a later repair builds on.
 *
 * BOTH FILES ARE WRITTEN OR NEITHER IS. The plan is written first and the note second, and a failure of
 * either leaves `write_failed` on the verdict rather than a partial success: a run holding a plan with no
 * note is the pre-conversion state this transport exists to end, and it must not be reachable through a
 * half-completed write.
 */
export function recordKnockoutFrame(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const dir = String(runDir ?? "");
  const paths = knockoutFrameCallPaths(dir);
  // — ONE FILE PER CALL, refusals included. This wrote a single fixed
  // `call-001.json`, so a call refused and then re-sent kept only the survivor. Sequence 1 still
  // resolves to `call-001.json`, so every consumer reading that name is unmoved. Best-effort
  // throughout, as the capture always was — a lost forensic record never fails a run.
  const nameFor = (seq) => join(paths.dir, `call-${String(seq).padStart(3, "0")}.json`);
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  const journal = (reason) => {
    // THE REFUSAL JOURNAL, which knockout-assess does not have and which is filed as a gap on the tracker.
    // Built in here because this transport is new: a missing artifact can mean the seat never called the
    // tool, or that every call was refused BY NAME, and those are different findings that gateway's judge
    // distinguishes only by reading a journal. Best-effort — a journal write that fails must never turn a
    // refusal into a crash, because the refusal is the answer the seat needs.
    try { writeFileSync(paths.refusals, JSON.stringify({ at: now(), reason }) + "\n", { flag: "a" }); }
    catch { /* the refusal still stands and is still returned */ }
  };

  const undeclared = refuseUndeclared(received);
  if (undeclared) {
    journal(undeclared);
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }

  const call = mergeKnockoutFrameCall(lastAcceptedFrame(dir), received);
  const verdict = acceptKnockoutFrame(call);
  if (!verdict.ok) {
    journal(verdict.reason);
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  const files = knockoutFrameFiles(dir);
  try {
    // The plan carries no `scope_note`: the note is a separate artifact, and a copy of it inside the plan
    // would be a second spelling of one string for anything that later read both.
    const { scope_note: note, ...plan } = verdict.model;
    writeFileSync(files.plan, JSON.stringify(plan, null, 2) + "\n");
    // VERBATIM. Not `${note}\n`, not a heading, not a composed product line — see the header.
    writeFileSync(files.frame, note);
    writeFileSync(paths.accepted, acceptedEnvelope(call, now()));
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: files.plan,
    also_written: files.frame,
    refused: null,
    marks: verdict.model.marks.length,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** The refusals journalled for this run, newest last. The accessor a TOOL_WRITTEN_ARTIFACTS row carries. */
export function frameRefusalsFor(runDir) {
  try {
    return readFileSync(knockoutFrameCallPaths(String(runDir ?? "")).refusals, "utf8")
      .split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { reason: l }; } });
  } catch { return []; }
}

/** Was this run's frame written through the typed transport? The ruled discriminator. */
export function knockoutFrameWasRecorded(runDir) {
  try { readFileSync(knockoutFrameCallPaths(String(runDir ?? "")).payload, "utf8"); return true; }
  catch { return false; }
}
