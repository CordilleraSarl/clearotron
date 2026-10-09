// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/session-record.mjs — what a model session went through, kept beside what it ended with.
//
// ── why this exists ──────────────────────────────────────────────────────────────────────────────────
//
// Both engines read the program's stream in memory and kept the LAST result. A session the vendor's
// classifier cut off mid-answer, or one the API refused and a restart recovered, ended in an ordinary
// successful result and was recorded as a clean session. A cut drops the tool calls that had not
// finished, so a stage that lost calls mid-answer looked exactly like one that finished.
//
// Measured on the bench's saved-data replays (2026-09-28, 50 Claude sessions): 23 were cut and carried
// on; in 8 the API then refused; one of the 8 still answered, because a background helper restarted the
// session and the last result was a success. The program's own words for each event, read off a saved
// stream with the content left out:
//
//   cut          a `user` event, `isSynthetic: true`, whose text block says the response "was stopped by
//                a safety classifier"
//   refusal      a `system` event, subtype `model_refusal_no_fallback`, carrying `api_refusal_category`
//                and `original_model`; then an `assistant` message with `stop_reason: "refusal"`
//   restart      a second `system` / `init` event in the same stream
//   results      one `result` event per answer, each with `result_index`, `is_error`, `stop_reason`,
//                `terminal_reason` and, for one a helper's notice started, `origin.kind`
//
// So nothing here is inferred: every row is an event the program wrote, with when it arrived. The
// record answers "was this session interrupted, refused or restarted, and when" from the run directory,
// and it never decides anything — the retry policy reads the last result exactly as before.
//
// ── what is NOT recorded ─────────────────────────────────────────────────────────────────────────────
//
// No text in the session record. The cut message, the refusal's explanation and every result's answer
// carry the model's or the vendor's words about client matter; a row carries the event's kind, its time
// and its codes. The raw stream, which does carry the words, goes to its own file in the run directory
// (streamSink below), where the dispatch text already sits.
//
// ONE EXCEPTION, and it sits beside the record rather than in it: when a session ENDED IN AN ERROR, the
// program's own words for that error go on the attempt row (`errorText`, see "how the session ended"
// below). An expired sign-in recorded `stop_sequence` six times and nothing else, while the program had
// said in plain words that the session had expired. On a healthy ending that field is the model's answer
// and stays off the row.

import { mkdirSync, openSync, writeSync, closeSync, statfsSync } from "node:fs";
import { dirname } from "node:path";

/** The program's words for a classifier cut, as it writes them into the session. Matched, never quoted. */
export const CLASSIFIER_CUT_RE = /stopped by a safety classifier/i;

// A row list is a record, not a log: a session that is cut fifty times has said what it needs to say by
// the fiftieth, and the count beside the list keeps saying how many there were.
const ROWS_CAP = 50;

/** An empty record. `starts` counts the program's own session starts (`system`/`init`). */
export function newSessionRecord() {
  return { starts: 0, results: [], classifierCuts: [], refusals: [], refusalStops: 0, dropped: 0 };
}

const push = (rec, list, row) => {
  if (list.length < ROWS_CAP) list.push(row);
  else rec.dropped += 1;
};

/** The text a `user` event carries outside its tool results: a string, or its `text` blocks. */
function userText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}

/**
 * Fold one parsed Claude stream event into the record. `atMs` is milliseconds since the spawn. PURE
 * over its arguments; the caller owns the clock.
 */
export function noteClaudeEvent(rec, ev, atMs) {
  if (!rec || !ev || typeof ev !== "object") return;
  if (ev.type === "system" && ev.subtype === "init") { rec.starts += 1; return; }
  if (ev.type === "system" && ev.subtype === "model_refusal_no_fallback") {
    push(rec, rec.refusals, {
      atMs, category: typeof ev.api_refusal_category === "string" ? ev.api_refusal_category : null,
      model: typeof ev.original_model === "string" ? ev.original_model : null,
    });
    return;
  }
  if (ev.type === "assistant") {
    if (ev.message?.stop_reason === "refusal") rec.refusalStops += 1;
    return;
  }
  if (ev.type === "user") {
    if (CLASSIFIER_CUT_RE.test(userText(ev.message?.content))) push(rec, rec.classifierCuts, { atMs, synthetic: ev.isSynthetic === true });
    return;
  }
  if (ev.type === "result") {
    push(rec, rec.results, {
      atMs,
      index: Number.isFinite(ev.result_index) ? ev.result_index : rec.results.length + rec.dropped,
      subtype: typeof ev.subtype === "string" ? ev.subtype : null,
      isError: ev.is_error === true,
      stopReason: typeof ev.stop_reason === "string" ? ev.stop_reason : null,
      terminalReason: typeof ev.terminal_reason === "string" ? ev.terminal_reason : null,
      origin: typeof ev.origin?.kind === "string" ? ev.origin.kind : null,
    });
  }
}

/**
 * Fold one parsed Codex `exec --json` event into the record. Codex states no refusal category and no
 * classifier cut on its stream (measured, codex-cli 0.150–0.158), so what it can say is said: how the
 * turn ended, every time it ended, and every stream error.
 */
export function noteCodexEvent(rec, ev, atMs) {
  if (!rec || !ev || typeof ev !== "object") return;
  if (ev.type === "thread.started") { rec.starts += 1; return; }
  if (ev.type === "turn.completed" || ev.type === "turn.failed" || ev.type === "error") {
    push(rec, rec.results, {
      atMs, index: rec.results.length + rec.dropped, subtype: ev.type,
      isError: ev.type !== "turn.completed", stopReason: null, terminalReason: null, origin: null,
    });
  }
}

/** True when any result the session reached was an error, whatever the last one said. */
export const anyResultErrored = (rec) => Array.isArray(rec?.results) && rec.results.some((r) => r?.isError === true);

/**
 * The record as the attempt row carries it. `interrupted` is the one-word answer a reader filters on: the
 * session was cut, refused, restarted, or reached an error result, at least once.
 */
export function sessionSummary(rec) {
  if (!rec) return null;
  const interrupted = rec.classifierCuts.length > 0 || rec.refusals.length > 0 || rec.refusalStops > 0
    || rec.starts > 1 || anyResultErrored(rec);
  return {
    interrupted, starts: rec.starts, results: rec.results.map((r) => ({ ...r })),
    classifierCuts: rec.classifierCuts.map((r) => ({ ...r })), refusals: rec.refusals.map((r) => ({ ...r })),
    refusalStops: rec.refusalStops, ...(rec.dropped ? { rowsDropped: rec.dropped } : {}),
  };
}

// ── how the session ended, in the program's own words ──────────────────────────────────────────────────
//
// The stop reason alone misleads on an error. Measured on an expired sign-in: the Claude program reported
// `subtype: "success"`, `is_error: true`, `stop_reason: "stop_sequence"` (the stop of its OWN synthetic
// message, whose model reads `<synthetic>`) and `terminal_reason: "api_error"`, with the reason in the
// result text: "Failed to authenticate: OAuth session expired and could not be refreshed". Six retries of
// one stage journalled six identical `stop_sequence` rows and said nothing about why. The stop reason stays
// verbatim, because on an error it describes the program's synthetic message and rewriting it would be
// inventing; these three go beside it, on both engines:
//
//   terminalReason   the kind of ending, as the program states it. null when it states none (Codex never does).
//   apiErrorStatus   the vendor's status when it gave one. null when it did not, which is not zero.
//   errorText        the program's words for the error, ONLY when the session ended in one, cut to a length a
//                    person reads. Never a word of ours in their place: an error that carried none reads null.
//
// The verdict does not move: `fail`, the retry ladder and the envelope's status read exactly what they
// read before. These record; they decide nothing.
export const ERROR_TEXT_CAP = 300;

const words = (t) => (typeof t === "string" && t.trim() ? t.slice(0, ERROR_TEXT_CAP) : null);

/** Claude: from the session's LAST result event (the one the verdict reads), or nulls when none arrived. */
export function claudeEnding(resultEvent) {
  const r = resultEvent && typeof resultEvent === "object" ? resultEvent : null;
  return {
    terminalReason: typeof r?.terminal_reason === "string" ? r.terminal_reason : null,
    apiErrorStatus: r?.api_error_status ?? null,
    errorText: r?.is_error === true ? words(r.result) : null,
  };
}

/**
 * Codex: no terminal kind and no status on its stream. Its words are the failed turn's own message, or the
 * stream error when the turn never completed; an `error` it recovered from (a reconnect, then a completed
 * turn) is not why it ended. Reads the raw messages `parseCodexEvent` keeps, never its placeholders.
 */
export function codexEnding(ev) {
  const failed = ev?.turnFailedText ?? null, stream = ev?.streamErrorText ?? null;
  const said = ev?.turnFailed ? words(failed) : (ev?.turnCompleted ? null : words(stream));
  return { terminalReason: null, apiErrorStatus: null, errorText: said };
}

/** The three as an attempt row carries them: written every time, null where the engine said nothing. */
export function endingFields(json) {
  return { terminalReason: json?.terminalReason ?? null, apiErrorStatus: json?.apiErrorStatus ?? null, errorText: json?.errorText ?? null };
}

/** A per-tool-name call count, folded one name at a time. */
export function countTool(byName, name) {
  const k = String(name ?? "?") || "?";
  byName[k] = (byName[k] ?? 0) + 1;
}

// ── the raw stream ───────────────────────────────────────────────────────────────────────────────────
//
// Every byte the program wrote on its protocol channel, one file per session, beside the dispatch that
// started it. Kept while the disk holding the run has room: below STREAM_FLOOR_BYTES free it is not
// written, and the record says so rather than leaving a file that stops halfway. A write that fails
// mid-session closes the file and says so too. Neither ever fails the turn.
export const STREAM_FLOOR_BYTES = 5 * 1024 ** 3;

/**
 * Open a sink for `file`. Returns `{ write(chunk), close() }`; `close()` returns what landed:
 * `{ file, bytes, present: true }`, or `{ file, present: false, reason }`. A null file is a null sink.
 */
export function streamSink(file, { floorBytes = STREAM_FLOOR_BYTES, freeBytes = null } = {}) {
  if (!file) return { write() {}, close: () => null };
  let fd = null, bytes = 0, reason = null;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const free = freeBytes ?? (() => { const s = statfsSync(dirname(file)); return Number(s.bavail) * Number(s.bsize); })();
    if (free < floorBytes) reason = `not written: the disk holding the run had ${Math.round(free / 1024 ** 2)} MiB free, under the ${Math.round(floorBytes / 1024 ** 3)} GiB floor`;
    else fd = openSync(file, "w", 0o600);
  } catch (e) { reason = `not written: ${String(e?.message ?? e).slice(0, 120)}`; }
  return {
    write(chunk) {
      if (fd === null) return;
      try { bytes += writeSync(fd, typeof chunk === "string" ? chunk : Buffer.from(chunk)); }
      catch (e) { try { closeSync(fd); } catch { /* already gone */ } fd = null; reason = `cut short after ${bytes} bytes: ${String(e?.message ?? e).slice(0, 120)}`; }
    },
    close() {
      if (fd !== null) { try { closeSync(fd); } catch { /* the bytes are on disk or they are not; bytes says which */ } fd = null; }
      return reason ? { file, present: bytes > 0, bytes, reason } : { file, present: true, bytes };
    },
  };
}
