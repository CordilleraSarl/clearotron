// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// doubt-closure-call.mjs — THE SEAT STOPS TYPING LINES. It calls; the driver settles.
//
// LIVE since conversion 6. Built inert in with 13 arms against it before anything
// could call it; the pipeline consumes it now. Nothing in the acceptance boundary below changed to
// make that happen — the wiring came to the module, which is the whole point of having built it first.
//
// ── WHAT THIS REPLACES, AND WHY IT IS QUIETER THAN THE FORM IT LEARNS FROM ──────────────────────────
//
// The doubt-closure stage is handed the run's still-open doubts and dictates one line each:
//
//     SETTLED <id>: <file>: "<verbatim quote>" — <one-line reason>
//     OPEN <id>: <one-line why no on-disk evidence answers it>
//
// `parseClosureLines` is STRICT on purpose: a line that does not match parses to NOTHING and its doubt
// simply stays open. That is the right default and it has a cost — a typographic quote, an em-dash the
// model chose over the dictated one, a wrapped line, and a settlement is **silently lost**.
//
// This is the disposition form's disease with the volume turned down. There, a hand-typed document failed
// to parse and produced a loud token. Here there is NO token: a lost settlement is byte-identical to a
// doubt the stage looked at and left open. Nothing counts it, and nothing can.
//
// The seat sends VALUES; the serialization is ours; a transport failure becomes inexpressible.
//
// ── WHAT IT DOES NOT DO, AND THE PR MUST NOT OVERSELL IT ────────────────────────────────────────────
//
// THE ANTI-CONFABULATION GUARD IS UNTOUCHED. `applyClosure` re-verifies every quote VERBATIM against the
// cited file, and a settlement that does not verify leaves its doubt open and lands in `unverified`. The
// model can only ever point, never settle. That was true of the dictated form and it is true here. This
// transport removes a PARSE failure. It does not remove, weaken, or replace the verification.
//
// ── THE THREE DECISIONS, each a cost ────────────────────────────────────────────────────────────────
//
// 1. THE SEAT CANNOT NAME A FILE. `file` is not in the accepted shape — a POSITION in the allowed-files
//    list is. This is B's `receipt_id` ruling applied: a validator that rejects an unallowed citation has
//    MOVED the defect; a schema that cannot express one has REMOVED it. `applyClosure` already refuses to
//    verify against a file the stage was not given (`fileTexts` holds only the allowed ones), so today an
//    invented filename fails silently as an unverifiable quote. A position cannot be invented.
//
// 2. THE QUOTE IS CHECKED AGAINST THAT FILE, AT CALL TIME. `applyClosure` checks it later; checking it
//    here means the seat learns inside its own turn instead of three attempts later through a corrective.
//    Verified with `squash` — the SAME predicate applyClosure settles with, imported rather than copied,
//    because two normalizers would diverge on the first change and the divergence would read as a seat
//    citing badly.
//
// 3. PARTIAL ACCEPT. A refused row never voids its neighbours. All-or-nothing was the old transport's
//    whole disease — one bad row voided seventy-three good ones — and re-creating it here would be
//    re-creating the bug in a new place.
//
// PURE — no node imports, so it tests offline, exactly like connotation-search.mjs and disposition-call.mjs.
// It reads doubt-ledger.mjs and doubt-ledger.mjs does not read it: the import runs ONE WAY, so there is no
// second opinion about what a settlement is or when a quote verifies.
import { squash, citesOwnSource } from "./doubt-ledger.mjs";

// One call carries a BATCH. A tool that is tedious at N rows gets routed around — 17 of 23 recorded runs
// already wrote a program rather than hand-author the disposition form — and the next workaround will not
// be a benign script. Ergonomics are a correctness property here, not a courtesy.
export const MAX_CLOSURES_PER_CALL = 40;

// ⭐ THE CITABLE SET, AND ITS ORDER, IN ONE PLACE — because `file_index` is a POSITION.
//
// The seat cites by position, not by name (decision 1 above). That makes an invented filename
// inexpressible, but it also means the ORDER the dispatch lists these in and the order the driver writes
// into the spec sidecar MUST be the same order. Two literals would look identical on the day they were
// written and drift on the day one of them was edited — and the failure is silent: every citation would
// verify against the WRONG file's text, and a settlement pointing at the wrong evidence reads exactly
// like a settlement pointing at the right one. So both sides import this, and neither writes its own list.
export const CLOSURE_EVIDENCE_FILES = Object.freeze([
  "findings.json",
  "register-findings.md",
  "register-coverage-ledger.json",
]);

// ⭐ THE VERDICT ENUM IS PER KIND, and the kinds are not symmetric.
//
// The SAME doubt-closure.md is parsed twice, by two parsers, into two ledgers (applyClosure() in
// doubt-ledger.mjs, applyAskClosure() in ask-ledger.mjs, both called from the pipeline's closure pass):
// parseClosureLines -> applyClosure (doubts) and parseAskClosureLines -> applyAskClosure (asks). Doubts
// settle; asks are ruled IMMATERIAL. A single enum across both would accept `settled` on an ask.
export const VERDICTS_BY_KIND = Object.freeze({
  doubt: Object.freeze(["settled", "open"]),
  ask: Object.freeze(["immaterial", "open"]),
});
export const CLOSURE_KINDS = Object.freeze(Object.keys(VERDICTS_BY_KIND));
export const CLOSURE_VERDICTS = VERDICTS_BY_KIND.doubt;   // kept for the doubt-only callers

// ⭐ AND AN OPEN ASK IS NOT INERT, WHICH IS WHY THE FIELD IS NAMED DIFFERENTLY.
//
// applyClosure's OPEN changes nothing — it is the seat agreeing with the ledger, and the reason is
// DISCARDED (doubt-ledger.mjs: `if (!l) return d` / the OPEN branch never stores it).
// applyAskClosure's OPEN REWRITES the ask's handoff: `{ ...a, handoff: clip(l.reason, 300) || a.handoff }`.
// So on an open ask the text is CONTENT the reviewing lawyer reads, not commentary.
//
// Rather than validate that mistake, the grammar removes it: an open ask carries `handoff`, not `reason`.
// The field name tells the seat what the text becomes. Same principle as file_index — don't reject the
// error, make it unsayable.
const textFieldFor = (kind, verdict) => (kind === "ask" && verdict === "open" ? "handoff" : "reason");

const str = (v) => String(v ?? "").trim();
const isInt = (v) => Number.isInteger(v);

/**
 * Decide one typed closure row against the doubts and evidence this stage was actually given. PURE.
 *
 * @param row          {doubt_id, verdict, file_index?, quote?, reason}
 * @param openIds      Set of doubt ids the stage may speak about — its own OPEN ledger
 * @param allowedFiles the evidence file names, IN ORDER. `file_index` indexes THIS list
 * @param fileTexts    {name: content} for those files only
 * @returns {{ok: true, row: {...}} | {ok: false, reason: string}}
 */
export function acceptClosure(row, { openIds, allowedFiles, fileTexts, bornIn = {} }) {
  const kind = str(row?.kind || "doubt").toLowerCase();
  if (!CLOSURE_KINDS.includes(kind)) return { ok: false, reason: `kind must be one of ${CLOSURE_KINDS.join(" / ")}` };

  const id = str(row?.doubt_id);
  if (!id) return { ok: false, reason: "doubt_id is required" };
  if (!openIds.has(id)) return { ok: false, reason: `doubt_id "${id}" is not one of this stage's open ${kind}s — you may only speak about the ${kind}s you were given` };

  const verdict = str(row?.verdict).toLowerCase();
  const allowed = VERDICTS_BY_KIND[kind];
  if (!allowed.includes(verdict)) return { ok: false, reason: `verdict must be one of ${allowed.join(" / ")} for a ${kind}` };

  const field = textFieldFor(kind, verdict);
  const other = field === "reason" ? "handoff" : "reason";
  if (row?.[other] != null) return { ok: false, reason: `a ${verdict} ${kind} carries "${field}", not "${other}" — the field name says what the text becomes`};
  const reason = str(row?.[field]);
  if (!reason) return { ok: false, reason: `${field} is required — ${field === "handoff" ? "it REPLACES this ask's standing handoff, so it is what the reviewing lawyer reads" : "one line saying why"}` };

  // An OPEN verdict changes nothing in the ledger; it is the seat agreeing. It carries no citation, and
  // supplying one is refused rather than ignored: a quote on an OPEN row means the seat believed it was
  // settling and the run would silently disagree.
  if (verdict === "open") {
    if (row?.file_index != null || row?.quote != null) return { ok: false, reason: `an open ${kind} carries no citation — omit file_index and quote, or rule it ${VERDICTS_BY_KIND[kind][0]}` };
    return { ok: true, row: { kind, doubt_id: id, verdict, [field]: reason } };
  }

  const idx = row?.file_index;
  if (!isInt(idx)) return { ok: false, reason: `file_index must be an integer position into the ${allowedFiles.length} evidence file(s) you were given` };
  if (idx < 0 || idx >= allowedFiles.length) return { ok: false, reason: `file_index ${idx} is outside the ${allowedFiles.length} evidence file(s) you were given (0-${allowedFiles.length - 1})` };
  const file = allowedFiles[idx];

  // THE PROVENANCE RULE, in the seat's own turn. `doubt-ledger.applyClosure` is the authority and
  // refuses this again after the stage — the check is here for the same reason the verbatim check below
  // is: so the seat learns inside this turn rather than through a corrective three attempts later.
  //
  // `bornIn` is the driver's map of id → the artifact that doubt was minted out of, from the same spec
  // sidecar that carries `openIds`. An id the map does not cover is ACCEPTED here and refused there, so
  // a spec written by an older driver costs a turn and never the guard. Note which way that fails: the
  // authority is the side that always has the birth record, and this side is the courtesy.
  //
  // `citesOwnSource` is IMPORTED, not re-implemented, for the reason `squash` is: two matchers for one
  // question diverge on the first edit, and the divergence would read as a seat citing badly.
  const born = bornIn?.[id];
  if (born && citesOwnSource({ birth: { artifact: born } }, file)) {
    return { ok: false, reason: `${file} is the artifact this ${kind} was minted out of — quoting it back restates the question instead of answering it. Cite one of the other evidence files, or send verdict:"open" with what a human should do` };
  }

  const quote = str(row?.quote);
  if (!quote) return { ok: false, reason: "a SETTLED verdict must quote the evidence verbatim" };

  // The verification the seat would otherwise discover three attempts later, done inside its turn.
  const hay = squash(fileTexts?.[file]);
  if (!hay) return { ok: false, reason: `${file} has no readable text in this run, so nothing can be verified against it` };
  if (!hay.includes(squash(quote))) return { ok: false, reason: `that quote does not appear verbatim in ${file} — cite text that is actually there, or send verdict:"open"` };

  return { ok: true, row: { kind, doubt_id: id, verdict, file, quote, reason } };
}

/**
 * A whole call. Rows that validate are accepted even when their neighbours are refused. PURE.
 *
 * A duplicate `doubt_id` inside one call is refused rather than last-wins: two settlements of one doubt
 * means the seat contradicted itself, and picking one silently would hide that.
 *
 * @returns {{accepted: object[], refused: {doubt_id: string, reason: string}[]}}
 */
export function acceptClosureCall(closures, { openIds, allowedFiles, fileTexts, bornIn = {} }) {
  const rows = Array.isArray(closures) ? closures : [];
  if (!rows.length) return { accepted: [], refused: [{ doubt_id: "", reason: "closures[] is required and must carry at least one row" }] };
  if (rows.length > MAX_CLOSURES_PER_CALL) {
    return { accepted: [], refused: [{ doubt_id: "", reason: `${rows.length} rows exceeds ${MAX_CLOSURES_PER_CALL} per call — send them across calls; every accepted row is kept` }] };
  }
  const accepted = [];
  const refused = [];
  const seen = new Set();
  for (const row of rows) {
    const id = str(row?.doubt_id);
    if (id && seen.has(id)) { refused.push({ doubt_id: id, reason: `doubt_id "${id}" appears twice in this call — one verdict per doubt` }); continue; }
    const r = acceptClosure(row, { openIds, allowedFiles, fileTexts, bornIn });
    if (r.ok) { if (id) seen.add(id); accepted.push(r.row); }
    else refused.push({ doubt_id: id, reason: r.reason });
  }
  return { accepted, refused };
}

/** The accepted rows, in the shape applyClosure already consumes. One direction, no re-interpretation. */
/**
 * The accepted rows, split by kind, in the shapes applyClosure and applyAskClosure already consume.
 * One direction, no re-interpretation: this maps, it does not decide.
 */
export function toClosureLines(accepted, kind = "doubt") {
  return (accepted ?? []).filter((r) => (r.kind ?? "doubt") === kind).map((r) => {
    if (r.verdict === "open") return { verdict: "OPEN", id: r.doubt_id, reason: r.handoff ?? r.reason };
    return { verdict: kind === "ask" ? "IMMATERIAL" : "SETTLED", id: r.doubt_id, file: r.file, quote: r.quote, reason: r.reason };
  });
}
