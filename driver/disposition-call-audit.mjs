// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// disposition-call-audit.mjs — WHAT HAPPENED TO THE SEAT'S CALLS, judged after the turn.
//
// The typed transport removes one failure class and creates four new ones. A transport whose new failures
// are unnamed is not safer than the one it replaced — it is quieter, which is worse. `form_untouched` was
// truthful about the OLD transport and said nothing about WHY; these four each carry one cause and one
// remedy, because `form_damaged` carried two and its corrective sent a seat whose JSON had broken to go
// and fix a receipt id.
//
// ── THE EVIDENCE ALREADY EXISTS, AND THAT IS WHY THIS READS IT INSTEAD OF INVENTING A RECORD ─────────
//
// `stdio-server.mjs` writes `started` before every tool call and `settled` after it, to
// `_driver/tool-calls.jsonl`, built for on exactly this reasoning: a killed process writes no
// epilogue, so **a `started` with no `settled` IS the evidence** and nothing else can express it. Two of
// the four states below are read straight off those pairs. A second record of the same fact is how the
// eight diverged pairs in this codebase began, and a record this module wrote itself would be missing in
// precisely the case that matters — the process that died mid-call.
//
// The third source is the call index from `disposition-tool.mjs`, written by the RECEIVER before the work.
// Its absence is what distinguishes a call that was never made from one that arrived and vanished.
//
// ── WHY `never_made` IS A FIRST-CLASS FAILURE AND NOT A ZERO ─────────────────────────────────────────
//
// Under the old transport, a seat that did nothing and a seat whose submission was destroyed produced the
// SAME artifact: a form with no seat fields set. That is the whole of the 2026-08-15 misdiagnosis. Here
// they are different records — no `started` line at all versus a `started` with no `settled` — and the
// engine is required to say which. An absence is a finding, and this is the module that makes it one.

import { readFileSync } from "node:fs";

// THE NAMES LIVE HERE, IN ONE PLACE, and they are `reason` stems. The emitted token is composed elsewhere
// as `connotation_${reason}` (verify.mjs), so the `connotation_` namespace is applied for us rather than
// invented here — which is also why these are not prefixed a second time.
//
// ── TWO CHECKS WERE RUN ON THESE NAMES, AND ONLY ONE OF THEM HAS A TOOL ─────────────────────────────
//
// 1. STRING COLLISION, tooled: does the token clash with a vocabulary something else already teaches?
//    All four are clean in both forms. Worth knowing that the bare stem `partial` is NOT — it belongs to
//    a `complete`/`near-complete`/`partial` level vocabulary in the MCP server — and `call_` is what
//    keeps these clear of it. Both forms have to be checked: a prefix can introduce a collision the stem
//    does not have, and remove one the stem does.
//
// 2. NAMESPACE DUPLICATION, untooled: do these names JOIN the existing family, or start a parallel one?
//    The first draft of this module named them `disposition_call_*`, a second token family beside
//    `CONNOTATION_REASONS` for four states of the stage that family already covers. **The collision check
//    passes that draft cleanly** — a brand-new prefix collides with nothing precisely BECAUSE it is new,
//    which is the same property that makes it a second home for one fact.
//
// So a green collision report is not evidence the names belong here. The check that caught it has no
// tool: find where the token is BUILT, and confirm the new members join the list already there.
export const CALL_FAILURE_REASONS = Object.freeze({
  SCHEMA: "call_schema_violation",
  TRUNCATED: "call_truncated",
  PARTIAL: "call_partial",
  NEVER_MADE: "call_never_made",
});

export const TOOL_NAME = "record_dispositions";

const lines = (path) => {
  try { return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()); } catch { return null; }
};

/**
 * The call pairs for THIS tool, out of the shared tool-call log.
 *
 * Returns `{ started, settled, unsettled, readable }`. `readable: false` means the log could not be read
 * at all — which is NOT "no calls were made", and every caller below is required to treat it as such.
 * A missing log on a run that predates it looks identical to a run where nothing was called, and reading
 * the second from the first is the zero-means-pass shape this whole tranche exists to refuse.
 */
export function callPairs(toolCallsPath, { tool = TOOL_NAME } = {}) {
  const raw = lines(toolCallsPath);
  if (raw == null) return { started: 0, settled: 0, unsettled: [], readable: false };
  const startedSeqs = new Set(), settledSeqs = new Set();
  for (const l of raw) {
    let row; try { row = JSON.parse(l); } catch { continue; }
    if (row?.tool !== tool) continue;
    // Keyed on (server, seq): the seq counter is PER PROCESS and a server is spawned per stage, so a bare
    // seq collides across processes and would pair one call's start with another's settle.
    const key = `${row.server ?? ""}#${row.seq ?? ""}`;
    if (row.event === "started") startedSeqs.add(key);
    else if (row.event === "settled") settledSeqs.add(key);
  }
  const unsettled = [...startedSeqs].filter((k) => !settledSeqs.has(k));
  return { started: startedSeqs.size, settled: settledSeqs.size, unsettled, readable: true };
}

/** How many payloads the receiver captured. `null` means the index could not be read — not zero. */
export function capturedCalls(callIndexPath) {
  const raw = lines(callIndexPath);
  return raw == null ? null : raw.length;
}

/**
 * Which of the four states this turn is in, if any.
 *
 * `owed` is the count of obligations still outstanding after the turn; `recorded` is how many rows the
 * accumulator now carries for this half. Both are computed by the caller from the same derivation the
 * gate uses — this module never re-derives an obligation, so there is no second opinion about what is
 * owed.
 *
 * Returns `null` when nothing is wrong, or `{ reason, detail, count }`.
 *
 * ── BEFORE YOU ADD A WORD TO ANY DETAIL BELOW: YOU HAVE ABOUT TWO CHARACTERS ────────────────────────
 *
 * The consumer slices the detail at 200 (connotation-search.mjs). Measured at realistic counts, the four
 * render at 149 / 198 / 196 / 153 — so `call_truncated` and `call_schema_violation` have single-digit
 * headroom and everything else has plenty.
 *
 * The margin is NOT eaten by the counts. Pushed to absurd values (999999) the longest reaches 203, and
 * `call_truncated` would need a four-digit unsettled-call count — ~250,000 rows for a 74-row form — to
 * overflow on numbers alone. It is TEXT that will break these: one added clause puts either over, and
 * what falls off the end is the driver-fault sentence that stops a seat re-deriving correct rulings after
 * a call the driver lost. That sentence was already lost once, which is why it now leads.
 *
 * The test asserts the bound across five (owed, recorded) pairs and carries a void control so it cannot
 * go green as the text grows. Edit these strings and run it.
 *
 * PRECEDENCE IS THE DESIGN, not an ordering detail. Each state below is strictly narrower than the one
 * after it, and the FIRST match is the one the seat can act on:
 *
 *   never_made      the seat owed rows and no call was ever started      → it must call the tool
 *   truncated       a call started and never returned                    → re-send that chunk; ours to fix
 *   schema_violation calls arrived and NOTHING was ever accepted          → the payload shape is wrong
 *   partial         calls arrived, rows landed, obligations remain       → send the rest
 *
 * Reporting `partial` for a turn whose only call was killed would be true and useless: it names the
 * symptom the seat can see and hides the cause it cannot.
 */
export function auditDispositionCalls({ toolCallsPath, callIndexPath, owed = 0, recorded = 0 }) {
  if (owed <= 0) return null;                       // nothing outstanding — no call failure to report

  const pairs = callPairs(toolCallsPath);
  const captured = capturedCalls(callIndexPath);

  // AN UNREADABLE RECORD IS NOT AN EMPTY ONE. With neither source readable we know only that rows are
  // owed, and `partial` is the honest floor: it claims calls-may-have-happened-and-work-remains without
  // asserting anything about calls we could not observe. Naming `never_made` here would be a confident
  // accusation built on a file we failed to open.
  const blind = !pairs.readable && captured == null;

  if (!blind && pairs.readable && pairs.started === 0 && (captured ?? 0) === 0) {
    return {
      reason: CALL_FAILURE_REASONS.NEVER_MADE, count: owed,
      detail: `Call \`${TOOL_NAME}\` — it was never called in this run, and nothing was submitted at all. Not a formatting problem: ${owed} obligation${owed === 1 ? "" : "s"} outstanding.`,
    };
  }
  if (pairs.unsettled.length) {
    return {
      reason: CALL_FAILURE_REASONS.TRUNCATED, count: pairs.unsettled.length,
      detail: `NOT a fault in your rulings — do not re-derive them; re-send that chunk as it was. ${pairs.unsettled.length} \`${TOOL_NAME}\` call${pairs.unsettled.length === 1 ? "" : "s"} never returned, so those rows were never recorded — a driver-side or transport fault.`,
    };
  }
  if (!blind && (captured ?? 0) > 0 && recorded === 0) {
    return {
      reason: CALL_FAILURE_REASONS.SCHEMA, count: captured ?? 0,
      detail: `Check the payload SHAPE, not the rulings: \`rows\` must be an array of objects each with \`row_id\`, \`ruling\` and \`note\`. ${captured} call${captured === 1 ? "" : "s"} arrived and no row was accepted; the tool's answer names each refusal.`,
    };
  }
  return {
    reason: CALL_FAILURE_REASONS.PARTIAL, count: owed,
    detail: `Send only what is left — the ${recorded} row${recorded === 1 ? "" : "s"} already recorded ${recorded === 1 ? "is" : "are"} KEPT, and the tool's answer names which outstanding rows still owe a \`segment_index\` and a \`fragment\`. ${owed} still outstanding.`,
  };
}
