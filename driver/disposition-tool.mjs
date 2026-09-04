// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// disposition-tool.mjs — B, THE TOOL SURFACE. The seat calls; this writes the file.
//
// `disposition-call.mjs` decides whether a typed call is acceptable and is pure. This is the half that
// touches disk: it resolves the driver's own paths, captures what arrived, folds accepted rows into the
// accumulator through the SHIPPED union, and answers the seat inside its turn.
//
// ── DECISION 3, AND IT IS THE ONE THAT RECREATES YESTERDAY'S BLINDNESS IF IT CAPTURES THE WRONG THING ─
//
// Two constraints, both load-bearing, both stated here because a later reader will otherwise "simplify"
// them away:
//
//   THE PAYLOAD IS CAPTURED AS RECEIVED, PRE-SERIALIZATION. What lands in the record is the argument
//   object this process was handed, serialized by US. Not the seat's bytes, not a re-read of a file, not
//   a summary computed after validation. The 2026-08-15 failure could only be diagnosed by hand because
//   the one artifact that would have settled it — what the seat actually submitted — had been overwritten
//   by the driver's own union before anyone looked. A capture taken after validation would record what we
//   decided, which is the thing already in the record, rather than what we were given.
//
//   THE INDEX IS WRITTEN BY THE RECEIVER, NEVER BY THE CONSUMER. This handler writes both the payload and
//   the line naming it, in that order, before it validates anything. 's three snapshot sites all
//   discard their return, so no attempt row names its snapshot and correlation is by mtime — which is
//   precisely how the union discard had to be diagnosed. A consumer-written index can only ever name the
//   payloads the consumer got to; a call that dies mid-flight writes no index line, and its absence is
//   then indistinguishable from a call that was never made. Written here, the line exists before the work
//   does, so a payload with no verdict is a FACT rather than an inference.
//
// ── WHY THE UNION IS REUSED RATHER THAN WRITTEN AGAIN ───────────────────────────────────────────────
//
// Accepted rows are folded in by `unionDispositionForm`, the same function the gateway and the grid tool
// call, with the same arguments in the same order. A second writer for the same file is disease 7 on the
// artifact this whole tranche exists to protect, and the two copies would diverge on the first change to
// what `isRuled` accepts. This module decides WHAT is accepted; it does not get a second opinion about
// what a ruled row is.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { connotationObligations, obligationRows, parsePrRiskResults, parseDispositionForm } from "./connotation-search.mjs";
import { unionDispositionForm, formSidecarPath } from "./disposition-union.mjs";
import { validateDispositionCall, callAnswer, addressableRows, evidenceSatisfiable, MAX_ROWS_PER_CALL } from "./disposition-call.mjs";
import { PARK_AFTER_REFUSALS, parkedIds, refusalCountsBy } from "./refusal-bound.mjs";   //

const CALLS_DIR = "disposition-calls";

/**
 * The obligations sidecar — what the seat was TOLD it owed, written when the block was rendered.
 *
 * 's rule, applied to this filename: the path is derived ONCE and imported, never re-derived at the
 * other end. perplexity-server.mjs writes this file and this module reads it; two spellings of one name
 * is the drift cost weeks, and the reader would fail OPEN — it would simply find no file, fall back
 * to the live derivation, and renumber the seat's page without anyone being told.
 */
export function obligationsSidecarPath(outputPath) {
  return join(dirname(outputPath), `connotation-obligations.${basename(outputPath, ".json")}.json`);
}

/**
 * The row order the driver RECORDED when it rendered the obligations block, or `null` if it did not.
 *
 * — this is what a `row_index` counts off. It is deliberately the driver's own record of what it
 * SAID rather than a fresh derivation: the obligation set is re-derived every call against a ledger that
 * can grow mid-turn, and a re-derivation has no memory of the page the seat is holding. `null` degrades
 * to the live order, which is the behaviour every caller had before this existed.
 */
export function toldRowIds(outputPath) {
  try {
    const told = JSON.parse(readFileSync(obligationsSidecarPath(outputPath), "utf8"))?.rowsTold;
    return Array.isArray(told) && told.length ? told.map((x) => String(x ?? "").trim()) : null;
  } catch { return null; }
}

/** Where a run's typed-call payloads and their index live. Both under `_driver/`, beside the accumulator. */
export function callRecordPaths(dispositionsPath, seq) {
  const driverDir = dirname(formSidecarPath(dispositionsPath));
  const dir = join(driverDir, CALLS_DIR);
  return { dir, payload: join(dir, `call-${String(seq).padStart(3, "0")}.json`), index: join(dir, "index.jsonl"),
    verdicts: join(dir, "verdicts.jsonl") };
}

/**
 * WHAT WE DECIDED ABOUT A CALL, written after the work — the other half of the pre-work index line.
 *
 * ──. THE REASON EXISTED, WAS CORRECT, AND WAS NEVER WRITTEN DOWN ──────────────────────────────
 *
 * On R5 round `892dd88e` a seat spent 163 typed calls on 2 rows of 72. 113 of 114 tool results said
 * `refused`, and 162 of 170 per-row refusals gave ONE specific correct actionable reason — the anchor did
 * not occur in the captured text it ruled on. **The transport answered well every single time.** And then
 * the run parked, and every one of those reasons was gone: they existed only inside the seat's turn.
 * `index.jsonl` carries `at, seq, payload, rowCount` and no verdict; not one reason token appeared
 * anywhere under `_driver`. The single surviving trace was `obligationsNeverAddressed: 2` — the one
 * description of that run that demonstrably did not happen.
 *
 * The header above already names the shape this closes: *"a payload with no verdict is a FACT rather than
 * an inference."* Until now there was no verdict to be missing.
 *
 * ── PER CALL, NEVER PER ROW-FINAL-STATE, AND THAT IS NOT A STYLE CHOICE ─────────────────────────────
 *
 * One line per call, naming every row in it. The investigation that first read this evidence nearly
 * killed a TRUE hypothesis by joining distinct `(row_id, anchor-present)` pairs against each row's FINAL
 * state — a row sent 85 times with an anchor and once without landed in both buckets and read as
 * uncorrelated. **An instrument keyed on final state rebuilds exactly the blindness it was built to
 * remove.** So the durable unit is the call, and `foldCallVerdicts` derives per-row histograms from it.
 *
 * BEST-EFFORT, like the capture: a ledger that cannot be written must never cost the seat its rulings.
 * The failure is returned, not swallowed, because "recorded" and "could not record" are different facts.
 */
export function recordCallVerdict(dispositionsPath, seq, { accepted, refused, overflow, dropped } = {},
  { now = () => new Date().toISOString() } = {}) {
  const { dir, verdicts } = callRecordPaths(dispositionsPath, seq);
  const arr = (v) => (Array.isArray(v) ? v : []);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(verdicts, JSON.stringify({
      at: now(), seq,
      // ── THE RULING IS RECORDED PER CALL, INCLUDING ON REFUSED ROWS ────────────────────────────────
      //
      // This is the field that turns a cost defect into a measurable correctness defect, and it is only
      // useful on the rows that were REJECTED. R5's terminal, partitioned by attempt over one seat: A1
      // ruled `benign` (18 calls), A2 `benign` (23), **A3 `loaded` and `off-topic` across 85 calls with
      // `benign` gone entirely**, then the resume ruled `benign` again and was accepted. **Had any single
      // A3 call been accepted, a contradicted legal ruling would have banked against 41 prior `benign`
      // calls from the same seat.** Only the continued refusals kept it out of the opinion.
      //
      // A ledger that records THAT a row was refused and not WHAT it claimed cannot show that at all. The
      // enum only — `note` is the seat's prose and the capture file already holds the payload whole, so
      // nothing is gained by copying it here and a second copy of client-adjacent text is a cost.
      accepted: arr(accepted).map((r) => ({ row_id: String(r?.row_id ?? "").trim(), ruling: String(r?.ruling ?? "").trim() }))
        .filter((r) => r.row_id),
      refused: arr(refused).map((r) => ({ row_id: String(r?.row_id ?? "").trim(),
        reason: String(r?.reason ?? "").trim(), detail: String(r?.detail ?? "").slice(0, 400),
        // The ruling AS SENT on a refused row. `validateDispositionCall` refuses before it normalises, so
        // this is read off the raw payload the seat submitted rather than off anything we resolved.
        ruling: String(r?.ruling ?? "").trim().toLowerCase() })),
      dropped: arr(dropped).map((r) => ({ row_id: String(r?.row_id ?? "").trim(),
        reason: String(r?.reason ?? "").trim(), detail: String(r?.detail ?? "").slice(0, 400) })),
      overflow: arr(overflow).length,
    }) + "\n");
    return { ok: true, verdicts };
  } catch (e) {
    return { ok: false, verdicts: null, why: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * The verdict ledger as parsed, oldest first. A bad line is SKIPPED, not thrown on — this is diagnostic
 * material and one unparseable line must not destroy the evidence of every other call.
 *
 * A missing file yields `[]`, and the caller must not read that as "nothing was refused": no ledger and
 * an empty ledger are different facts, which is why `ledgerPresent` is reported separately by the audit.
 */
/**
 * IS THERE A LEDGER AT ALL? Separate from reading it, because `readCallVerdicts` returns `[]` for a
 * missing file and for an empty one, and those are not the same fact.
 *
 * Caught by the test written to assert exactly this: the audit first reported `seatsWithLedger: 1` for a
 * run that had never written a ledger line, because the fold of an empty read is a perfectly good object.
 * An absence reading as a presence, inside the change whose purpose is to make absence legible.
 *
 * Lives here so `callRecordPaths` stays the ONE function that knows the layout.
 */
export function callVerdictLedgerExists(dispositionsPath) {
  return existsSync(callRecordPaths(dispositionsPath, 0).verdicts);
}

export function readCallVerdicts(dispositionsPath) {
  const { verdicts } = callRecordPaths(dispositionsPath, 0);
  let raw;
  try { raw = readFileSync(verdicts, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* one bad line is not the whole ledger */ }
  }
  return out;
}

/**
 * Capture what arrived, BEFORE anything is decided about it, and index it here in the receiver.
 *
 * Returns the payload path so the caller can name it in its own record. Best-effort: a capture that
 * cannot be written must never cost the seat its call — the rows are still valid work. But the failure is
 * RETURNED rather than swallowed, because "captured" and "capture failed" are different facts and the
 * caller reports which.
 */
export function captureCall(dispositionsPath, seq, received, { now = () => new Date().toISOString() } = {}) {
  const { dir, payload, index } = callRecordPaths(dispositionsPath, seq);
  const rows = Array.isArray(received?.rows) ? received.rows : [];
  try {
    mkdirSync(dir, { recursive: true });
    // The argument object as handed to this process. `rows` is written whole and unfiltered — including
    // rows that will be refused, and including fields this transport does not accept, because a payload
    // pruned to what we liked is not evidence about what was sent.
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
    // THE INDEX LINE IS WRITTEN BY THIS PROCESS, BEFORE THE WORK. See the header.
    appendFileSync(index, JSON.stringify({ at: now(), seq, payload: basename(payload), rowCount: rows.length }) + "\n");
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, payload: null, why: String(e?.message ?? e).slice(0, 200) };
  }
}

/** How many calls this run has already recorded — the ceremony budget is measured, not guessed. */
export function callsSoFar(dispositionsPath) {
  const { index } = callRecordPaths(dispositionsPath, 0);
  try {
    return readFileSync(index, "utf8").split("\n").filter((l) => l.trim()).length;
  } catch { return 0; }
}

/**
 * The rows still owed, each carrying whether it owes a POINTER and a PROOF.
 *
 * THE SEAT LEARNS ANCHOR-OWED FROM HERE OR NOWHERE. The obligations block never names `quote_required`:
 * under the old transport the seat read it off the FORM, and B removes the form from the seat's world. A
 * tool answer that returned bare row ids would judge a seat on a requirement it was never shown — the
 * exact shape this tranche exists to end.
 *
 * RE-DERIVED every call, deliberately, against the ledger as it stands NOW. A mid-turn top-up grows the
 * ledger and can give an already-accepted row an anchor obligation it did not have; re-deriving is what
 * lets the answer NAME those rows back to the seat while it can still act. Freezing the set at the turn's
 * first call would paper over a missing message with a weaker gate.
 */
// ── — THE PER-ROW REFUSAL BOUND ─────────────────────────────────────────────────────────────
//
// A production run died delivering nothing because ONE row was refused 217 times across 3 attempts. The
// engine cannot make a seat read its ledger, and it should not try to: the refusals were CORRECT, each
// named one specific actionable reason, and 72 other rows were ruled soundly. What killed the run is that
// nothing counted. 217 refusals of one row is a live-lock, not a retry — the stage can neither progress
// nor stop, and 72 rows of good work are thrown away with it.
//
// THIRTY, AND THE FIRST NUMBER WAS WRONG. This shipped as TWELVE with the claim that "every value
// between about 6 and 30 parks exactly the same rows on the evidence we have". **That claim was refuted
// by the production ledger it was guessing about.** Replaying the deployed bound over
// that run's real verdicts (228 calls, 283 refusals) moves the answer twice inside that range:
//
//     bound     rows parked     rulings lost
//     6 – 12         3               2
//     14 – 16        2               1
//     18 – 30        1               0
//
// Twelve sat in the worst part of it. Two rows converged AFTER passing it — `Q-CK6PSMT0` accepted on its
// 18th call having been refused 17 times, `X-FRBHHCJ3` accepted one call after its 12th refusal — and
// every refusal on both landed BEFORE the acceptance, so at twelve the park fires first and the tool
// tells the seat to stop re-sending a row that was about to succeed.
//
// THE RISK IS ONE-SIDED, which is what picks the number. Parking too EARLY tells a converging seat to
// abandon work it was about to finish, and the report ships permanently poorer while honestly saying so.
// Parking too LATE costs bounded extra calls on a row that is going nowhere, in a run that still
// completes. Those are not comparable costs, so the bound belongs at the generous end.
//
// Thirty is the top of the MEASURED safe band, not an extrapolation past it: 13 refusals of margin over
// the latest observed convergence (17), and still a sevenfold cut from the killer's 217. Choosing the
// floor of the band (18) would buy nothing and sit one converging row away from the same mistake.
//
// n=1, AND THE ASYMMETRY SURVIVES IT. This is one production ledger. A second could raise the floor and
// this number should move with it — but no ledger can make twelve safe, because twelve is already
// refuted. If you retune, replay a real ledger; do not reason about the distribution as I first did.
//
// COUNT IS NOT THE RIGHT DISCRIMINATOR, and that is the real fix, deferred. The two rows this bound
// nearly destroyed were CONVERGING; the killer was FLAT across 217 refusals. `decideRecovery`'s
// `progress.kind` already computes exactly that distinction and nothing reads it. A trend-aware
// park would need no margin at all. Post-deadline, cross-referenced, deliberately not attempted here.
// ── — THE BOUND AND ITS COUNTING NOW LIVE IN ONE PLACE ─────────────────────────────────────────
//
// This stage is where the live-lock was found and where the bound was argued, but it is one
// MEMBER of a class, not the class: coverage and declination loop per-item obligations through validated
// tool calls in exactly the same shape. The counting moved to `refusal-bound.mjs` so the three cannot
// drift, and the argument for the number moved with it. These names are re-exported unchanged because
// they are what this transport's callers and its tests already read.
//
// What did NOT move is `recordCallVerdict` below: each transport records a different thing about a
// refused item — this one keeps the seat's `ruling`, and the note on that field explains why it is the
// difference between a cost defect and a correctness one. One shared writer would have cost that.
// Imported ABOVE and re-exported here, deliberately: `export { X } from "..."` forwards the name
// without binding it in this module, so the two references below it would throw at run time on the
// park path — the one path no unit test in this file drives end to end. eslint found that; the
// 7,235-test suite did not.
export { PARK_AFTER_REFUSALS };

/**
 * Which rows have been refused past the bound. PURE, and counted PER ROW ACROSS CALLS — the unit 's
 * own banner records an earlier investigation dying on, when it joined per-row-final-state instead.
 *
 * A row that is ruled later is never re-parked, because the union only parks rows that are not ruled.
 * @returns {string[]} row_ids, sorted, so the same ledger always yields the same answer.
 */
export function parkedRowIds(verdicts, { bound = PARK_AFTER_REFUSALS } = {}) {
  return parkedIds(verdicts, { idField: "row_id", bound });
}

/** How many times each row has been refused so far. PURE — the park's own evidence. */
export function refusalCounts(verdicts) {
  return refusalCountsBy(verdicts, { idField: "row_id" });
}

export function outstandingWithAnchors(canonicalRows, formRows) {
  const byId = new Map((formRows ?? []).map((r) => [String(r?.row_id ?? "").trim(), r]));
  const out = [];
  // — INDEXED, NOT ITERATED, and the argument is the ADDRESSABLE list rather than the canonical one.
  // The position in it is the number the block printed, so `i` is the seat's own address; a `null` is a
  // row that was told and is no longer owed, and it keeps its slot precisely so the numbers after it do
  // not move. Nothing is outstanding about a hole, so it is skipped without closing it.
  (canonicalRows ?? []).forEach((c, i) => {
    if (!c) return;
    const row_index = i + 1;
    const id = String(c.row_id ?? "").trim();
    const s = byId.get(id);
    const ruled = s && String(s.ruling ?? "").trim() && String(s.note ?? "").trim() && String(s.receipt_id ?? "").trim();
    const quoted = s && String(s.quote ?? "").trim();
    if (ruled && (!c.quote_required || quoted)) return;
    // — a parked row is no longer OWED. Leaving it here would keep telling the seat it still owes a
    // row the driver has already given up on, which is the live-lock restated in the tool's own answer.
    if (s?.parked === true) return;
    // — THE INVARIANT, STATED WHERE THE DEMAND IS SET. `evidence_owed` is `quote_required` copied
    // forward from form-build; whether it can still be DISCHARGED depends on the candidates as they are
    // now, and candidates regenerate between the two. Carried beside it rather than left for the reader to
    // join, because the answer that consumes this is what tells the seat to keep trying. Written whenever
    // evidence is owed — including `false`, so "owed and satisfiable" stays distinguishable from a row
    // written before this existed.
    const owed = !!c.quote_required;
    out.push({ row_id: id, row_index, evidence_owed: owed, ruled: !!ruled,
      ...(owed ? { evidence_unsatisfiable: !evidenceSatisfiable(c, s) } : {}) });
  });
  return out;
}

/**
 * Record one typed call. The tool handler's core.
 *
 * `spec` is the DRIVER-WRITTEN grid spec — the same file the grid tool was given. The seat names no path
 * of its own: 's rule is that the path is the driver's, taken from the spec it wrote, because two
 * derivations of one filename is the drift that cost weeks.
 */
export function recordDispositions(spec, received, { now = () => new Date().toISOString() } = {}) {
  const dispositionsPath = spec?.connotation?.dispositions_path ?? null;
  if (!dispositionsPath)
    return { ok: false, text: "ERROR: this half owns no disposition form — nothing is owed here, and nothing was recorded." };
  if (!existsSync(spec.output_path))
    return { ok: false, text: `ERROR: the meaning ledger is not on disk yet (${basename(spec.output_path)}). Run the grid first; this tool records rulings ABOUT it.` };

  let ledgerRaw;
  try { ledgerRaw = readFileSync(spec.output_path, "utf8"); }
  catch (e) { return { ok: false, text: `ERROR: the meaning ledger could not be read (${e?.message ?? e}). This is a driver fault, not yours.` }; }

  const recorded = parsePrRiskResults(ledgerRaw);
  const ob = connotationObligations(recorded);
  const canonical = obligationRows(ob);
  if (!canonical.length)
    return { ok: false, text: "ERROR: this half owes no meaning rulings — the ledger records no meaning queries." };

  // ── CAPTURE FIRST, BEFORE ANY DECISION ────────────────────────────────────────────────────────────
  const seq = callsSoFar(dispositionsPath) + 1;
  const cap = captureCall(dispositionsPath, seq, received, { now });

  // — the addressing list, read once and used for BOTH ends of this call: the validator resolves
  // the seat's numbers against it, and the answer names outstanding rows by their position in it.
  const told = toldRowIds(spec.output_path);
  const addressable = addressableRows(canonical, told);
  const numberOf = new Map();
  addressable.forEach((c, i) => { if (c) numberOf.set(String(c.row_id ?? "").trim(), i + 1); });
  const asRow = (id) => { const n = numberOf.get(String(id ?? "").trim()); return n ? `row ${n}` : "a row no longer in the list"; };

  const { accepted, refused, overflow } = validateDispositionCall(received?.rows, recorded, { told });

  // ── FOLD INTO THE ACCUMULATOR THROUGH THE SHIPPED UNION ───────────────────────────────────────────
  const accum = formSidecarPath(dispositionsPath);
  const readRows = (p) => { try { return parseDispositionForm(readFileSync(p, "utf8")).rows; } catch { return null; } };
  // — DECIDED BEFORE THE UNION, and including THIS call's refusals, so a row that crosses the bound
  // on this very call is parked now rather than one call late. The verdict ledger is written after the
  // work (below), so this call's refusals exist only in `refused` at this point.
  const priorVerdicts = readCallVerdicts(dispositionsPath);
  const allVerdicts = [...priorVerdicts, { refused }];
  const parkedIds = parkedRowIds(allVerdicts);
  const refusalsByRow = refusalCounts(allVerdicts);

  const u = unionDispositionForm(
    { rows: readRows(accum) }, { rows: accepted }, ob,
    { half: spec.half ?? null, generatedFrom: basename(spec.output_path), parkedIds },
  );
  // The park's own evidence, on the row, so the form states WHY it was given up on and after how many.
  for (const r of (Array.isArray(u.form?.rows) ? u.form.rows : [])) {
    if (r?.parked !== true) continue;
    const c = refusalsByRow[String(r.row_id ?? "").trim()] ?? 0;
    if (c > (Number(r.parked_refusals) || 0)) r.parked_refusals = c;
    if (!String(r.parked_reason ?? "").trim())
      r.parked_reason = `refused ${c} times without binding (bound ${PARK_AFTER_REFUSALS}) — parked unresolvable so the stage can complete`;
  }
  const json = JSON.stringify(u.form, null, 2) + "\n";
  let wrote = true, writeWhy = "";
  try {
    mkdirSync(dirname(accum), { recursive: true });
    // The accumulator in `_driver/` is the ONLY copy. The seat-facing mirror at `dispositions_path`
    // died with the form path (owner ruling 2026-08-17, delete-not-gate): the seat never reads or
    // writes it, the validator reads the accumulator, and a mirror nothing reads is a second writer
    // waiting to drift. The path itself survives in the spec as the accumulator's name anchor.
    writeFileSync(accum, json);
  } catch (e) { wrote = false; writeWhy = String(e?.message ?? e).slice(0, 200); }

  // ── THE AGREEMENT CHECK — DID THE ROWS WE ACCEPTED ACTUALLY LAND? ─────────────────────────────────
  //
  // Two resolutions run over one call. `validateDispositionCall` resolves `receipt_index` against the
  // obligations and writes the driver's id onto the accepted row; `seatFields` then re-resolves that row
  // inside the union (`disposition-union.mjs:98`), against the candidate list as the CURRENT pass
  // regenerated it, and discards `resolveCandidate`'s `state` when it misses. So "accepted" and "in the
  // accumulator" are two different facts and nothing compared them.
  //
  // This compares them, per call, and records any disagreement as OURS. It is deliberately not a throw:
  // 's silent-drop hypothesis is unproven, and an instrument that crashes the run it is measuring
  // cannot measure it. If the count is always zero the hypothesis is dead and we will be able to say so
  // from the artifact — which is the point of building it before the cure.
  const landed = new Map((Array.isArray(u.form?.rows) ? u.form.rows : [])
    .map((r) => [String(r?.row_id ?? "").trim(), r]));
  const dropped = accepted.flatMap((a) => {
    const row = landed.get(String(a?.row_id ?? "").trim());
    const receipt = String(row?.receipt_id ?? "").trim();
    const ruling = String(row?.ruling ?? "").trim();
    if (row && receipt && ruling) return [];
    // E12 FIRED ON THE FIRST DRAFT OF THIS SENTENCE, AND IT WAS RIGHT TO. The contract-dictation guard's
    // rule is CO-MENTION: a statement in the served corpus that names a retired field must name the field
    // that replaced it, in the same statement. My first version reported `receipt_id=` twice and never
    // said `receipt_index`, so a reader landing on it would learn the retired vocabulary and not the live
    // one. The fix is to say what actually happened — the seat gave a POSITION, and the union's
    // re-resolution of it against a regenerated candidate list produced no id — which names both fields
    // because both are genuinely part of the mechanism. Satisfying the guard by deleting the token would
    // have made the sentence less useful; satisfying it by completing the sentence made it more.
    return [{ row_id: a.row_id, reason: "accepted_not_folded",
      detail: !row ? "the accumulator carries no row with this id after the union"
        : `the seat's receipt_index resolved to an id at validation, and the union's re-resolution against the regenerated candidate list wrote receipt_id=${receipt || "(empty)"} ruling=${ruling || "(empty)"}` }];
  });

  // WRITTEN AFTER THE WORK, WHATEVER THE WORK DECIDED. A refusal is the only record of an obligation the
  // seat addressed and did not discharge, and until this it survived nowhere outside the seat's turn.
  const ver = recordCallVerdict(dispositionsPath, seq, { accepted, refused, overflow, dropped }, { now });

  const left = outstandingWithAnchors(addressable, u.form?.rows);
  const parkedRows = (Array.isArray(u.form?.rows) ? u.form.rows : []).filter((r) => r?.parked === true);
  const lines = [callAnswer({ accepted, refused, overflow }, left)];
  if (parkedRows.length)
    lines.push(`PARKED (do not re-send): ${parkedRows.map((r) => asRow(r.row_id)).join(", ")} — refused past the bound of ${PARK_AFTER_REFUSALS} without binding. The driver has recorded ${parkedRows.length === 1 ? "it" : "them"} as UNRESOLVED and stopped asking. Your other rulings stand. Finish the rows still listed above; if none are listed, you are done.`);
  if (dropped.length)
    lines.push(`DRIVER FAULT: ${dropped.length} row(s) you sent were ACCEPTED and are not in the driver's record (${dropped.map((d) => asRow(d.row_id)).slice(0, 3).join(", ")}). Do not re-send them and do not change them — your answer was valid and this is ours to fix.`);
  if (!wrote)
    lines.push(`DRIVER FAULT: the accumulator could not be written (${writeWhy}). Your rulings were validated but NOT saved — do not re-send yet; this is ours to fix.`);
  if (!cap.ok)
    lines.push(`(note: this call could not be journalled — ${cap.why}. Your rulings were still recorded.)`);
  if (!ver.ok)
    lines.push(`(note: this call's verdict could not be journalled — ${ver.why}. Your rulings were still recorded.)`);
  return { ok: wrote, text: lines.join("\n"), accepted: accepted.length, refused: refused.length,
    dropped: dropped.length, seq, outstanding: left.length, parked: parkedRows.length };
}

export { MAX_ROWS_PER_CALL };
