// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// coverage-tool.mjs — THE TOOL SURFACE for the coverage form. The seat calls; this writes the file.
//
// `coverage-call.mjs` decides whether a typed call is acceptable and is pure. This is the half that
// touches disk: it resolves the driver's own paths, captures what arrived, folds accepted rows into
// the accumulator through the SHIPPED union, and answers the seat inside its turn. It is
// disposition-tool.mjs one lane over, and where the two differ the difference is stated.
//
// ── THE PAYLOAD IS CAPTURED AS RECEIVED, AND THE INDEX IS WRITTEN BY THE RECEIVER ───────────────────
// Both constraints are disposition-tool.mjs's, inherited verbatim (read its header for the incident
// they come from): the capture is the argument object this process was handed, serialized by US,
// written together with its index line BEFORE anything is decided — so a payload with no verdict is a
// FACT rather than an inference, and what the seat actually submitted survives the union.
//
// ── WHY THE UNION IS REUSED RATHER THAN WRITTEN AGAIN ───────────────────────────────────────────────
// Accepted rows are folded in by `unionCoverageForm`, the same function the gateway's pre-judgement
// sync and the pipeline's pre-dispatch write call. A second writer for the same file would diverge on
// the first change to what a settled row is. This module decides WHAT is accepted; it does not
// get a second opinion about what a settled row is.
//
// ── SEAT ROWS: THE TOOL COMPOSES THE SUBMISSION THE UNION EXPECTS ───────────────────────────────────
// unionCoverageForm's seat-row rule is "a submission that SPOKE owns the seat rows outright — omission
// is retraction", written for a seat that re-emitted a whole file. A typed call is INCREMENTAL, so
// this module always re-submits the carried seat rows alongside the call's accepted ones — minus the
// rows the call explicitly retracted, minus any prior row an accepted seat row supersedes by key.
// Silence therefore never removes anything (the brief says so to the seat), and `{"retract"}` is the
// one way a seat row comes off — the placement form's own retract shape, carried over.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { coverageFormAbsence, formRowKey } from "./coverage-form.mjs";
import { unionCoverageForm, outstandingCoverageRows } from "./coverage-union.mjs";
import { coverageFormStamp, coverageFormInput, coverageFormPaths, readCoverageForm, writeCoverageForm } from "./coverage-form-io.mjs";
import { validateCoverageCall, coverageCallAnswer, MAX_ROWS_PER_CALL } from "./coverage-call.mjs";
import { idSetHash, priorCallWithIdSet } from "./call-repeat.mjs";   //
import { PARK_AFTER_REFUSALS, parkedIds, refusalCountsBy } from "./refusal-bound.mjs";   //

const CALLS_DIR = "coverage-calls";

/** Where a run's typed-call payloads and their index live. Both under `_driver/`, beside the accumulator. */
export function coverageCallRecordPaths(runDir, seq) {
  const dir = driverDir(runDir, CALLS_DIR);
  return { dir, payload: join(dir, `call-${String(seq).padStart(3, "0")}.json`), index: join(dir, "index.jsonl"),
    verdicts: join(dir, "verdicts.jsonl") };
}

/**
 * Capture what arrived, BEFORE anything is decided about it, and index it here in the receiver.
 * Best-effort: a capture that cannot be written must never cost the seat its call — but the failure is
 * RETURNED rather than swallowed, because "captured" and "capture failed" are different facts.
 */
export function captureCoverageCall(runDir, seq, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload, index } = coverageCallRecordPaths(runDir, seq);
  const rows = Array.isArray(received?.rows) ? received.rows : [];
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(payload, JSON.stringify({
      _provenance: "the typed call as RECEIVED by the tool, WHOLE — never the seat's own bytes, and never a selection: every key the recorder was handed is written, including ones this transport does not accept, because a payload pruned to what we liked is not evidence about what was sent",
      receivedAt: now(), seq, rowCount: rows.length,
          // ── — THE WHOLE CALL, not the one field this tool reads ──────────
          // This wrote `rows` alone. A capture stamped "the typed call as RECEIVED" that records
          // one extracted field is not a record of the call, and an audit replaying it reads the
          // absent fields as a transport that never sent them. Spread LAST so the call's own keys
          // win over nothing and the meta above cannot be shadowed by a seat-supplied key.
          ...(received && typeof received === "object" && !Array.isArray(received) ? received : { rows: rows }),
    }, null, 2) + "\n");
    // - the id-set hash rides the index row, so a re-sent batch is detectable from the
      // DRIVER's own record and stays readable after the run. NO generation key: `row_id` is
      // content-derived (`shortId("CA", "axis:...")` in coverage-form.mjs), so it survives the canonical
      // list being regenerated on every call - the same row keeps the same id.
      appendFileSync(index, JSON.stringify({ at: now(), seq, payload: basename(payload), rowCount: rows.length,
        idSetHash: idSetHash(rows, { idField: "row_id" }) }) + "\n");
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, payload: null, why: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * WHAT WAS DECIDED ABOUT A CALL, IN A SIBLING FILE — never folded into the index row.
 *
 * `index.jsonl` is written by the receiver BEFORE anything is decided, so a payload carrying an index
 * line and no verdict means the call died between receipt and decision. That is a fact rather than an
 * inference, and it is the reason the counts live here instead: a refusal tally on the index row would
 * make the two indistinguishable. Disposition's transport learned this first and this is its shape.
 *
 * Best-effort, and the failure is RETURNED: a ledger that cannot be written must not cost the seat its
 * call, but "recorded" and "could not record" are different facts and the bound depends on which.
 */
export function recordCoverageCallVerdict(runDir, seq, { accepted, refused, overflow } = {},
  { now = () => new Date().toISOString() } = {}) {
  const { dir, verdicts } = coverageCallRecordPaths(runDir, seq);
  const arr = (v) => (Array.isArray(v) ? v : []);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(verdicts, JSON.stringify({
      at: now(), seq,
      accepted: arr(accepted).map((r) => ({ row_id: String(r?.row_id ?? "").trim(),
        status: String(r?.status ?? "").trim() })).filter((r) => r.row_id),
      // The refusal keeps its reason token AND its detail. The token is what a histogram counts; the
      // detail is what tells a reader whether thirty refusals were thirty attempts at one thing or a
      // seat working through genuinely different faults. The park needs the first, a person reading a
      // parked row needs the second.
      refused: arr(refused).map((r) => ({ row_id: String(r?.row_id ?? "").trim(),
        reason: String(r?.reason ?? "").trim(), detail: String(r?.detail ?? "").slice(0, 400) })),
      overflow: arr(overflow).length,
    }) + "\n");
    return { ok: true, verdicts };
  } catch (e) {
    return { ok: false, verdicts: null, why: String(e?.message ?? e).slice(0, 200) };
  }
}

/** The verdict ledger as parsed, oldest first. A bad line is SKIPPED, never thrown on — this is
 *  diagnostic evidence and one corrupt append must not blind the bound to the other twenty-nine. An
 *  absent ledger is an empty one: no call has been decided yet. */
export function readCoverageCallVerdicts(runDir) {
  const { verdicts } = coverageCallRecordPaths(runDir, 0);
  let raw;
  try { raw = readFileSync(verdicts, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skipped, deliberately — see above */ }
  }
  return out;
}

/** How many calls this run has already recorded — the ceremony budget is measured, not guessed. */
export function coverageCallsSoFar(runDir) {
  const { index } = coverageCallRecordPaths(runDir, 0);
  try { return readFileSync(index, "utf8").split("\n").filter((l) => l.trim()).length; }
  catch { return 0; }
}

/** Outstanding rows with the anchor facts the answer needs. Derived from the just-written union. */
function outstandingDetail(form, parked = new Set()) {
  return outstandingCoverageRows(form)
    // - A PARKED ROW LEAVES `outstanding` AND NEVER BECOMES `settled`, and those are two different
    // facts rather than one. Leaving `outstanding` is what lets the stage finish: the seat stops being
    // told it still owes a row it has been refused thirty times on, which is the live-lock. NOT becoming
    // settled is what keeps the count honest — the corpse of was a narrative claiming "73
    // processed; 73 recorded" over a machine-checked 72, and a park that counted as a judgement would
    // rebuild that lie in one line. `rowIsSettled` is untouched here on purpose.
    .filter((r) => !parked.has(String(r.row_id ?? "").trim()))
    .map((r) => ({
      row_id: String(r.row_id ?? ""), unit: String(r.unit ?? r.axis ?? ""),
      open: r.open === true, ...(r.open_because ? { open_because: r.open_because } : {}),
    }));
}

/**
 * Record one typed call. The tool handler's core.
 *
 * The seat names NO path at all — the run dir is the server's (CLEAROTRON_BAND_RUN_DIR, wired per run by
 * the driver), the form name is the era stamp's, and every other identifier is the driver's own. That
 * is one field fewer than record_dispositions needed, and one fewer place a seat could name a run
 * other than its own.
 */
export function recordCoverage(runDir, received, { now = () => new Date().toISOString() } = {}) {
  const stamp = coverageFormStamp(runDir);
  if (!stamp.required)
    return { ok: false, text: "ERROR: this run carries no coverage form (no era stamp) — nothing is owed here and nothing was recorded. If this is a live digest dispatch, that is a driver fault: report it in your final message." };
  const { input, absent } = coverageFormInput(runDir);
  if (!input) {
    // The M6 absence declaration: the driver wrote a form that DECLARES it can carry no rows. Nothing
    // is owed and nothing is recordable — said plainly, so the seat stops trying rather than retrying.
    const cf = readCoverageForm(runDir, stamp.formName);
    const declared = coverageFormAbsence(cf.parsed);
    return {
      ok: false,
      text: declared
        ? `Nothing is owed: this run's coverage form is a driver-written absence declaration (${declared.cause}) — there are no rows to rule, the driver renders the declaration into the findings itself, and there is nothing for you to record.`
        : `ERROR: this run's coverage form is required but its inputs are out of reach (${absent ?? "unknown"}) — a driver fault, not yours. Do not retype anything; report it in your final message.`,
    };
  }

  // ── CAPTURE FIRST, BEFORE ANY DECISION ────────────────────────────────────────────────────────────
  const seq = coverageCallsSoFar(runDir) + 1;
  // - ASKED BEFORE THE CAPTURE, and the order is the mechanism. `captureCoverageCall` appends THIS
  // call's row, hash included; asking afterwards matches the row just written and every call would report
  // itself as a repeat of itself.
  const idSet = idSetHash(Array.isArray(received?.rows) ? received.rows : [], { idField: "row_id" });
  const repeatOf = priorCallWithIdSet(coverageCallRecordPaths(runDir, 0).index, idSet);
  const cap = captureCoverageCall(runDir, seq, received, { now });

  // The canonical rows the call is judged against: the union-REGENERATED form — driver rows recomputed
  // from the plan/receipt/bands as they stand NOW (a mid-turn supplemental merge can grow the row set,
  // and the answer must name the new rows while the seat still holds the page), with prior statuses and
  // recorded seat rows carried. The same regeneration every judgement runs.
  const prior = readCoverageForm(runDir, stamp.formName);
  const canonical = unionCoverageForm({ rows: prior.rows }, { rows: null }, input);

  const { accepted, retractions, refused, overflow } = validateCoverageCall(received?.rows, canonical.form.rows);

  // ── COMPOSE THE SUBMISSION, THEN FOLD THROUGH THE SHIPPED UNION ───────────────────────────────────
  const retractedIds = new Set(retractions.map((id) => id.toUpperCase()));
  const acceptedSeatKeys = new Set(accepted.filter((r) => r.kind === "seat").map(formRowKey));
  const carriedSeat = canonical.form.rows.filter((r) => r.kind === "seat"
    && !retractedIds.has(String(r.row_id ?? "").toUpperCase())
    && !acceptedSeatKeys.has(formRowKey(r)));
  // ── THE REFUSAL BOUND ─────────────────────────────────────────────────────────────────────
  // DECIDED BEFORE THE ANSWER AND INCLUDING THIS CALL'S OWN REFUSALS, so a row that crosses the bound on
  // this very call is parked now rather than one call late. The verdict ledger is appended after the
  // work (below), so at this point this call's refusals exist only in `refused` — the same ordering
  // disposition's park uses, and the reason it is written out rather than left to the reader.
  const priorVerdicts = readCoverageCallVerdicts(runDir);
  const allVerdicts = [...priorVerdicts, { refused }];
  const parked = new Set(parkedIds(allVerdicts, { idField: "row_id" }));
  const refusalsByRow = refusalCountsBy(allVerdicts, { idField: "row_id" });

  // — the park goes THROUGH the union, so it lands in the accumulator and survives the next call's
  // regeneration. Computed only in the answer, it evaporated: the form still read the row as merely
  // unsettled and every consumer downstream counted it as work still owed.
  const u = unionCoverageForm({ rows: prior.rows }, { rows: [...accepted, ...carriedSeat] }, input,
    { parkedIds: [...parked] });
  // The park's own evidence, on the row, so the form states WHY it was given up on and after how many.
  for (const r of (Array.isArray(u.form?.rows) ? u.form.rows : [])) {
    if (r?.parked !== true) continue;
    const c = refusalsByRow[String(r.row_id ?? "").trim()] ?? 0;
    if (c > (Number(r.parked_refusals) || 0)) r.parked_refusals = c;
    if (!String(r.parked_reason ?? "").trim())
      r.parked_reason = `refused ${c} times without settling (bound ${PARK_AFTER_REFUSALS}) — parked unresolvable so the stage can complete`;
  }

  let wrote = true, writeWhy = "";
  try { writeCoverageForm(runDir, u.form, stamp.formName); }
  catch (e) { wrote = false; writeWhy = String(e?.message ?? e).slice(0, 200); }

  const left = outstandingDetail(u.form, parked);
  const lines = [coverageCallAnswer({ accepted, retractions, refused, overflow }, left)];
  // Told to the seat, because a row that silently stopped being owed is indistinguishable from one the
  // seat believes it still has to fix — and the seat is the only party that can stop re-sending it.
  const parkedNow = [...parked].filter((id) => refused.some((r) => String(r?.row_id ?? "").trim() === id));
  if (parkedNow.length)
    lines.push(`${parkedNow.length} row(s) reached the refusal bound (${PARK_AFTER_REFUSALS}) and are PARKED as `
      + `unresolvable — they are no longer owed and nothing further is asked of you for them: `
      + parkedNow.map((id) => `${id} (refused ${refusalsByRow[id]}x)`).join(", ")
      + ". They are NOT recorded as ruled: this run will report them as unresolved.");
  if (!wrote)
    lines.push(`DRIVER FAULT: the accumulator could not be written (${writeWhy}). Your statuses were validated but NOT saved — do not re-send yet; this is ours to fix.`);
  if (!cap.ok)
    lines.push(`(note: this call could not be journalled — ${cap.why}. Your statuses were still recorded.)`);
  // - RECORDED AND NAMED, NOT ACTED ON. Detection only: coverage answers by folding through a
  // REGENERATED union rather than replaying a stored verdict per row, so "serve it from the ledger" is a
  // different question from doubt-closure's and is not assumed to share its answer. What ships is the
  // fact that the same rows came back, which is what a reader needs to see the loop at all.
  //
  // Both keys written UNCONDITIONALLY: "not a repeat" and "this build does not report repeats" are
  // different facts, and a key present only when something is wrong makes its absence a claim.
  if (repeatOf)
    lines.push(`(note: every row in this call was already sent on call ${repeatOf.seq}. Your statuses stand; nothing further is owed for them.)`);
  // Appended AFTER the work, so the ledger records what was decided rather than what arrived.
  const vr = recordCoverageCallVerdict(runDir, seq, { accepted, refused, overflow }, { now });
  if (!vr.ok)
    lines.push(`(note: this call's verdict could not be journalled — ${vr.why}. Your statuses were still recorded, `
      + `but the refusal bound cannot count what was not written.)`);
  return { ok: wrote, text: lines.join("\n"), accepted: accepted.length, refused: refused.length,
    retracted: retractions.length, seq, outstanding: left.length,
    id_set: idSet, repeat_of: repeatOf ? repeatOf.seq : null,
    parked: [...parked], parked_refusals: Object.fromEntries([...parked].map((id) => [id, refusalsByRow[id] ?? 0])) };
}

export { MAX_ROWS_PER_CALL, coverageFormPaths };
