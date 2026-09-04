// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-unit-record.mjs — the recording transport for a register unit's audit note.
//
// The unit's `.md` is, in its own dispatch's words, "a SHORT PROSE AUDIT NOTE — what you searched
// (queries enumerated, incomplete-block count, records carried forward)". Its whole machine contract is
// a length floor: 80 characters, or 40 when it declares a null result. The BAND beside it is the
// load-bearing artifact and the driver hard-fails fan-in without it.
//
// ── THE THREE FACTS THE NOTE STATES ARE FACTS ABOUT THE BAND, AND THE TOOLS WROTE THE BAND ─────────
//
// Queries enumerated, incomplete-block count, records carried forward. Every one is a count over
// `register-units/<axis>-band.json`, which `register_execute_plan` and `register_propose_supplemental`
// write themselves, qid-stamped, and which the seat is already forbidden to author: "You NEVER author,
// edit or append a band block: a hand-written block fails the stage."
//
// So this transport does not ask a seat to TYPE those counts. It derives them. A seat-typed count
// beside a tool-written band is two authorings of one fact, and the failure mode is the quiet one —
// the note says nine enumerated queries, the band holds eight, and nothing compares them. Deriving
// removes the disagreement rather than detecting it.
//
// What the seat still supplies is the only thing the band cannot say: whether this axis produced a
// null result, and any one-line observation an auditor would want. That is judgment, and it stays.
//
// ── WHAT THIS DOES NOT TOUCH ───────────────────────────────────────────────────────────────────────
//
// The band's own hand-write path. `stages.mjs` carries a ternary on the plan's `supplemental_lane`
// contract, and the branch that tells a seat to write band blocks by hand fires ONLY where that flag
// is absent — which `pipeline.mjs` stamps unconditionally on every fresh run. That branch is the
// resume-and-replay compatibility path for pre-flag plans and archived runs, kept deliberately, and it
// is left exactly as it is.
import { writeFileSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join, dirname, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";
import { refuseUndeclared as refuseUndeclaredShared, keepIfAbsent, lastAccepted, acceptedEnvelope } from "./preserve-merge.mjs";

/**
 * THE REPAIR TAIL FOR THIS STAGE'S BESPOKE FOLLOWUPS — one implementation, used by all of them.
 *
 * gateway's warm patch and cold corrective re-route a repair away from the write-mode tails on their own,
 * because they consult `toolWrittenArtifact`. The BESPOKE composers do not: they were written before the
 * conversion and each ended with `editRepairTail(<the note>)`, ordering an Edit of a file the seat can no
 * longer write. That is the residual gap measured and closed for the RECORDING category — and this
 * stage is deliberately NOT in that category, so its agreement guard does not walk these composers. Found
 * the way it would be found in production: an escalation re-run defended its unit, the driver read the
 * note it had rendered itself, saw no change, and the arm that asserts the skip went red.
 *
 * Lives here rather than in repair-contract.mjs so the tail travels with the transport that owns the
 * artifact, and so stages.mjs (which composes the followups) never has to reach into gateway.mjs for the
 * table — that import would be a cycle.
 */
export const UNIT_NOTE_REPAIR_TAIL =
  "HAND THE CORRECTED NOTE BACK BY CALLING `record_unit_note` AGAIN. There is no file to edit and nothing "
  + "you write by hand is read: the driver renders the note from your call, and the counts in it are taken "
  + "from the band rather than from anything you type. Send the same two fields — `null_result` if this axis "
  + "genuinely found nothing, and `note`, one short observation — corrected for what the concerns above name. "
  + "If what the concerns name is the SEARCH rather than the note, fix the search first: the band is the "
  + "material, and the note follows it.";

/** Where a unit's artifacts live, given the run dir and the axis. */
export function unitPaths(runDir, axis) {
  const dir = join(String(runDir ?? ""), "register-units");
  return { dir, note: join(dir, `${axis}.md`), band: join(dir, `${axis}-band.json`) };
}

/**
 * Where the call's evidence lives — the driver's own record of what the seat handed it, per axis.
 *
 * `refusals` exists because the conversion moved WHERE a defect is caught, and moving it left no trace.
 * Before, a thin or contradictory note reached disk, a validator named it, and the driver re-dispatched —
 * three events in the run's journal. Now the transport refuses at the call and the seat restates in the
 * same turn, which is better and is INVISIBLE: nothing in the run would say the defect had happened.
 * "No defect occurred" and "a defect occurred and was corrected" must not look the same.
 *
 * PER AXIS, unlike the writer's single journal, because the seats are parallel: one file per axis is one
 * writer per file, and an interleaved append from six units would be a journal nobody can attribute.
 */
export function unitCallPaths(runDir, axis) {
  const dir = driverDir(runDir, "register-unit-calls");
  // PER AXIS, and the accepted base with it: the driver dispatches one seat per axis, so a base keyed
  // on the run would let one axis's repair inherit another axis's note.
  return { dir, payload: join(dir, `${axis}.json`), accepted: join(dir, `${axis}-accepted.json`), refusals: join(dir, `${axis}-refusals.jsonl`) };
}

/** Every call this axis turned away, in order — the run's own record that a defect was met and corrected. */
export function unitRefusalsFor(runDir, axis) {
  try {
    return readFileSync(unitCallPaths(String(runDir ?? ""), String(axis ?? "")).refusals, "utf8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

/**
 * The band's own account of itself. PURE over a parsed band.
 *
 * `enumerated` / `incomplete` are the two states the contract allows and the only two — the dispatch
 * says so in as many words ("EXACTLY those two strings; there is no verified/checked/complete/clean
 * state"). A block carrying anything else is counted as neither and surfaced as `unknown`, because
 * silently folding it into one of the two would report a band as better or worse accounted than it is.
 */
export function bandAccount(band) {
  const blocks = Array.isArray(band) ? band : [];
  const acct = { blocks: blocks.length, enumerated: 0, incomplete: 0, unknown: 0, records: 0 };
  for (const b of blocks) {
    const state = String(b?.state ?? "").trim();
    if (state === "enumerated") { acct.enumerated++; acct.records += Array.isArray(b?.records) ? b.records.length : 0; }
    else if (state === "incomplete") acct.incomplete++;
    else acct.unknown++;
  }
  return acct;
}

/** Read and account for this axis's band, or null when it cannot be read. */
export function readBandAccount(runDir, axis) {
  try { return bandAccount(JSON.parse(readFileSync(unitPaths(runDir, axis).band, "utf8"))); }
  catch { return null; }
}

/**
 * Render the audit note. PURE, and the single authority for the shape.
 *
 * THE COUNTS COME FROM THE BAND, THE WORDS COME FROM THE SEAT. A reader of this note is auditing what
 * the run searched, so every number in it is a count the driver took over the artifact the tools wrote.
 *
 * The 40-character floor applies only to a note that DECLARES a null result — the validator keys on
 * /not applicable|n\/a|no .*(hits|results)/ — so the null-result render says "no results" in those
 * words rather than hoping a shorter note happens to match.
 */
export function renderUnitNote({ axis, account, nullResult = false, note = "" } = {}) {
  const a = account ?? { blocks: 0, enumerated: 0, incomplete: 0, unknown: 0, records: 0 };
  const out = [`# Register unit — ${axis}`, ""];
  if (nullResult) {
    out.push(`This axis returned no results: ${a.enumerated} enumerated quer${a.enumerated === 1 ? "y" : "ies"} carried no records.`, "");
  } else {
    out.push(`Searched this axis over ${a.blocks} band block${a.blocks === 1 ? "" : "s"}: `
      + `${a.enumerated} enumerated to completion, ${a.incomplete} incomplete, `
      + `${a.records} record${a.records === 1 ? "" : "s"} carried forward.`, "");
  }
  if (a.unknown) {
    // Surfaced, never folded. A block in neither state is an accounting hole and the note says so.
    out.push(`${a.unknown} block${a.unknown === 1 ? " carries" : "s carry"} neither state — the band is not fully accounted.`, "");
  }
  if (String(note ?? "").trim()) out.push(String(note).trim(), "");
  return out.join("\n").replace(/\n+$/, "\n");
}

/**
 * Validate the call and render the note. Returns `{ok:true, content, account}` or `{ok:false, reason}`
 * with a token-first message, so the seat meets the defect in the turn where restating is free.
 *
 * THE BAND IS READ, NEVER PASSED. Whether the band exists and what it holds are facts about the run; a
 * seat that could hand us its own account of the band could report a completeness it did not achieve —
 * which is the one claim this lane exists to make honestly.
 */
/** The shape this tool declares. Flat — a unit note carries no nested object. */
const DECLARED = Object.freeze({ "": ["null_result", "note", "axis"] });

/** Refuse an undeclared key by path. Shared walk; the table above is what is this tool's. */
export const refuseUndeclared = (params) => refuseUndeclaredShared(params, DECLARED, "unit");

/** The last ACCEPTED call FOR THIS AXIS, or null. Per axis — one seat runs per axis. */
export function lastAcceptedUnitNote(runDir, axis) {
  return lastAccepted(unitCallPaths(String(runDir ?? ""), axis).accepted, readFileSync);
}

/**
 * Merge a call onto the stored one, for this axis. PURE. EVERY KEY DECIDED HERE.
 *
 * `note` is, in this acceptor's own words, "for what the counts cannot say" — the counts come from the
 * driver's account, so a partial that drops `note` still renders, still clears the length floor, and
 * ships a unit note with the seat's observation gone and nothing indicating one was ever made.
 *
 * `null_result` is worse than a lost datum. Dropped, it defaults to false, so "this axis found nothing"
 * silently becomes "no claim made" — and `unit_null_result_contradicted`, the guard that refuses a
 * null-result claim over a band carrying records, CANNOT FIRE ON A CLAIM THAT IS NO LONGER THERE.
 * Omitting the field disarms the check built for it.
 */
export function mergeUnitNoteCall(stored, received) {
  const base = stored ?? {};
  return {
    axis: received?.axis,                                  // the address; every call names it
    note: keepIfAbsent(received?.note, base.note),
    null_result: keepIfAbsent(received?.null_result, base.null_result),
  };
}

export function acceptUnitNote(params, { account = null } = {}) {
  const axis = String(params?.axis ?? "").trim();
  if (!axis) return { ok: false, reason: "unit_axis_missing: `axis` names which unit this note is for — the driver dispatches one seat per axis and the note is filed under that name" };
  if (!account) {
    return { ok: false, reason: `unit_band_unreadable:${axis} — this axis's band could not be read, and the note's counts are taken from it. The band is written by register_execute_plan / register_propose_supplemental; if it is absent the unit has not run, and a note about it would be an account of nothing` };
  }
  const note = params?.note;
  if (note != null && (typeof note !== "string" || /[\r\n]{2,}/.test(note))) {
    return { ok: false, reason: `unit_note_shape:${axis} — \`note\` is one short observation, a single paragraph. The counts are the driver's; this is for what the counts cannot say` };
  }
  const nullResult = Boolean(params?.null_result);
  if (nullResult && account.records > 0) {
    // The one contradiction worth refusing: a null-result claim over a band that carried records.
    return { ok: false, reason: `unit_null_result_contradicted:${axis}:${account.records} — you declared this axis a null result and its band carries ${account.records} record(s). The band is what the lawyer reads; a note that calls it empty is the claim this lane cannot afford to get wrong` };
  }
  const content = renderUnitNote({ axis, account, nullResult, note: note ?? "" });
  // The shipped floor, checked here so a drift surfaces as a refusal the seat sees rather than as a
  // stage failure the driver reports about a file it wrote itself.
  const floor = /not applicable|n\/a|no .*(hits|results)/i.test(content) ? 40 : 80;
  if (content.trim().length < floor) {
    return { ok: false, reason: `unit_note_too_short:${axis}:${content.trim().length}:of:${floor} — the rendered note is under the floor validators.registerUnit applies` };
  }
  return { ok: true, content, account };
}

/**
 * Capture what arrived, validate, and write the note — in that order.
 *
 * The capture happens BEFORE the decision, as in every sibling transport: a payload recorded after
 * validation records what we DECIDED, which is already in the answer, rather than what we were GIVEN.
 */
export function recordUnitNote(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const dir0 = String(runDir ?? "");
  const axis = String(received?.axis ?? "").trim() || "unknown-axis";
  const { dir, payload } = unitCallPaths(dir0, axis);
  // — ONE FILE PER CALL, refusals included. ITS OWN NAMESPACE, deliberately: this
  // transport keys its capture by AXIS (`<axis>.json`), not by a literal `call-001.json`, so a shared
  // sequence scheme would be wrong here. Two calls on the SAME axis used to overwrite, which is the same
  // loss the siblings had under a different key. Sequence 1 keeps `<axis>.json` exactly where it is.
  const nameFor = (seq) => (seq === 1 ? payload : join(dir, `${axis}-${String(seq).padStart(3, "0")}.json`));
  const cap = captureCall({ nameFor, params: received, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // ORDER: capture, refuse undeclared BY PATH, merge onto the axis's base,
  // validate the MERGED call, and store the base only after it passes.
  const undeclared = refuseUndeclared(received);
  if (undeclared) {
    return { written: null, refused: undeclared, captured: closeCapture({ ok: false, refused: undeclared }), capture_failed: captureFailed };
  }
  const call = mergeUnitNoteCall(lastAcceptedUnitNote(dir0, axis), received);
  const v = acceptUnitNote(call, { account: readBandAccount(dir0, axis) });
  if (!v.ok) {
    // BEST-EFFORT, and it must stay that way: a journal write that failed a refusal would turn a defect
    // the seat can fix into one it cannot see. The refusal is the return value; this is the audit trail.
    try { appendFileSync(unitCallPaths(dir0, axis).refusals, JSON.stringify({ at: now(), axis, reason: v.reason }) + "\n"); }
    catch { /* the run's own journal is never worth a turn */ }
    return { written: null, refused: v.reason, captured: closeCapture({ ok: false, refused: v.reason }), capture_failed: captureFailed };
  }

  const at = unitPaths(dir0, axis).note;
  try {
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, v.content);
    // Stored ONLY now, after the values passed — a refused call must never become the base.
    // BEST-EFFORT, in its own try — see report-overview-record.mjs for why.
    try { writeFileSync(unitCallPaths(dir0, axis).accepted, acceptedEnvelope(call, now())); }
    catch { /* a lost base is never a lost artifact */ }
  } catch (e) {
    // The call was VALID and we could not store it. That is infrastructure, and it must not read as a
    // rejected call — the two have opposite repairs.
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }
  return { written: at, refused: null, axis, ...v.account,
    captured: closeCapture({ ok: true }), capture_failed: captureFailed };
}
