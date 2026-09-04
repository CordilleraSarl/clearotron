// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// cancel.mjs — a user's decision to stop a run, as one file in the run dir.
//
// A ZERO-IMPORT LEAF. The MCP writes the marker, the gateway honours it between turns, the runner
// refuses to resume past it, and both pipelines end on it. One path constant, four consumers, no cycles.
//
// ── WHY A FILE, AND WHY THAT MAKES STOP COOPERATIVE ──────────────────────────────────────────────
// A run executes in a detached process tree that the portal cannot signal, across a queue the portal
// does not own. So "stop" cannot be something DONE TO the run; it has to be something the run NOTICES.
// It is honoured at the next turn boundary — never instantly — and any copy that implies otherwise is
// lying. Work already dispatched (the register-unit axis fan-out, knockout's batched sweeps) finishes.
//
// ── THE MARKER OUTLIVES THE RUN, ON PURPOSE ──────────────────────────────────────────────────────
// Nothing deletes `.cancel`. That is what makes the decision STICK: a cancelled run has three separate
// ways back to life (the queue's due-postponed claim, the run-dir self-resume watcher, and crash
// reclaim of a dead claimer), and every one of them reads this marker rather than trusting that some
// other path already handled it. A cancel that could be undone by a resume two minutes later is the
// failure mode this whole file exists to prevent.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CANCEL_MARKER = ".cancel";

export const cancelPath = (runDir) => join(String(runDir), CANCEL_MARKER);

/** Has this run been asked to stop? False for a null/absent runDir — never throws. */
export function isCancelled(runDir) {
  if (!runDir) return false;
  try { return existsSync(cancelPath(runDir)); } catch { return false; }
}

/** The cancel record, or null. Best-effort: a corrupt marker still means CANCELLED (isCancelled is the gate). */
export function readCancel(runDir) {
  try { return JSON.parse(readFileSync(cancelPath(runDir), "utf8")); } catch { return null; }
}

/**
 * The actor a caller passed nothing for. DISTINCT from the scope layer's "unidentified", and
 * the two must never collapse into one word: "the session could not name anybody" is a question about
 * the session, "no caller passed anything" is a bug at the call site. `by: null` said both at once,
 * which is exactly why a cancelled client run could not say who stopped it.
 */
export const UNATTRIBUTED = "unattributed";

/** Ask a run to stop. Idempotent — the first request's timestamp is the one that counts.
 *  `by` is normalised here rather than trusted: this marker travels into the archived matter record,
 *  and a future caller that forgets the field writes UNATTRIBUTED — never a null that reads as
 *  "nobody was there". */
export function requestCancel(runDir, { via = "unknown", by = undefined } = {}) {
  if (isCancelled(runDir)) return readCancel(runDir);
  const named = typeof by === "string" && by.trim() ? by.trim() : UNATTRIBUTED;
  const rec = { ts: new Date().toISOString(), via, by: named };
  writeFileSync(cancelPath(runDir), JSON.stringify(rec) + "\n");
  return rec;
}

/**
 * Thrown by the gateway when a run is asked to stop, and caught by both pipelines' run-level handlers.
 *
 * A DISTINCT CLASS, NOT A StageFailure, and that is load-bearing. A StageFailure goes through
 * `classifyFailureReason`, which is a regex guess over the reason text: an unrecognised reason
 * classifies as "unknown", which buys one recovery park — so the run would write `.postponed`, and the
 * runner would AUTO-RESUME IT TWO MINUTES LATER AND KEEP BILLING. The cancel would silently undo
 * itself. A separate class cannot be mis-classified because it never reaches the classifier.
 */
export class RunCancelled extends Error {
  constructor(stage, rec = null) {
    super(`cancelled by user at ${stage}`);
    this.name = "RunCancelled";
    this.stage = stage;
    this.requestedAt = rec?.ts ?? null;
    this.via = rec?.via ?? null;
  }
}
