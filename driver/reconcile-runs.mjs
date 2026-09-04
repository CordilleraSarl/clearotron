// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reconcile-runs.mjs —: a run whose process is gone stops claiming to be running.
//
// The owner watched a run that had been SIGKILLed hours earlier sit at `state:"running"`, `endedAt:null`,
// showing 5h43m in the UI, and then vanish from the list — the UI's own coping behaviour, not a repair.
// Every reader that trusts `state` counts that corpse as live: the portal, the run-status page, any
// metric over in-flight runs.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────────
//
// NOT a new stop mechanism. was filed as "there is no clean way to stop a run"; there is.
// `stop_run` (mcp-server/lib/ops.mjs) removes an unclaimed queue job outright and asks a running one to
// cancel, and the run writes its own terminal. But it is COOPERATIVE — it writes a request the run has
// to be alive and healthy enough to read. A run that was killed never cooperated, and no cooperative
// mechanism could have caught it. That gap is what this closes, from the other end.
//
// NOT `teardown`. Teardown sweeps every round of a ref and would destroy historical delivered runs.
// Named here because the issue names it: this is per-run, and it only ever moves a run FORWARD into a
// terminal state that `progress.mjs`'s monotonic guard then makes permanent.
//
// ── THE SIGNAL PROBLEM, MEASURED BEFORE IT WAS DESIGNED AROUND ──────────────────────────────────────
//
// A reconciler needs to ask "is the process behind this run still alive?". On `origin/main`, nothing
// could answer:
//
//   · `status.json` records NO pid. `progress.mjs` used `process.pid` only inside a temp filename.
//   · The run SLOT locks (`slot-lock.mjs`) are anonymous. They carry `<pid>:<nonce>[:<tag>]` and the tag
//     is the run's AGENT — but Phase-4 LIFTED the per-agent admission rule and `acquireRunSlot` now
//     omits the tag entirely, so a slot cannot be traced to a run and one agent may hold several.
//   · The queue's `.processing.pid` claim sidecar records `pid:starttime` correctly, and a join to it IS
//     possible — `status.json` carries `id: job.id` in its seed, even though the Run record built in
//     `mcp-server/lib/runs.mjs` does not surface it. That route is deliberately NOT built here, and the
//     reason is this issue's own evidence: the run it was filed about had "no queue marker" left at all,
//     so the sidecar route would have found nothing for the one case that has to be closed. It is worth
//     adding the day a killed-with-its-marker-intact run turns up; it is not worth adding blind.
//
// So the run has to record it. `progress.mjs`'s seed now stamps `pid` and `pidStarttime`, and the
// liveness question is answered by `claimerIsAlive` from claim-liveness.mjs — the SAME check the queue
// already uses, with the same deliberate fail-safe polarity: dead only on positive evidence, and a pid
// whose starttime cannot be read counts as ALIVE. Two JSON fields rather than a second copy of the
// sidecar's colon-joined string, because one format with two parsers is the defect class is about.
//
// ── AND THE RUNS THAT ARE ALREADY ON DISK ───────────────────────────────────────────────────────────
//
// Every run that started before that stamp — including the stuck one this issue was filed about — has no
// pid, and no amount of design gives it one retroactively. The issue's constraint is explicit: "the one
// known stuck run should be reconciled by the new mechanism, not hand-edited." So there is a second
// test, and it is a WEAKER one, said out loud rather than blended in:
//
//   QUIET. `status.json` is rewritten at every step — stepIndex, stepLabel, updatedAt. A live run is
//   therefore never silent for long, and a dead one froze at the instant it died. A run with no pid
//   whose `updatedAt` has not moved for longer than any gap between two steps could plausibly be is not
//   running.
//
// This is the same reader-side stale reap `run-activity.mjs` already argues for ("Reader-side is the
// ONLY recovery that survives a reboot"), applied to the surface that actually has a writer — that
// ledger has had none since 2026-08-04 and stays empty.
//
// THE DEFAULT WINDOW IS SIX HOURS, and the arithmetic is here so nobody has to re-derive it: the longest
// single stage configured in stages.mjs is `timeoutSec: 2250` and engine/common.mjs adds a +60s hard
// wall, so ~38.5 minutes is the longest one attempt can take. Retries and escalations multiply that.
// Six hours sits well above any plausible gap between two status writes and well below the point where
// a dead run has misled a day's worth of readers. It is a parameter, not a constant, and the CLI prints
// it with every verdict.
//
// Every verdict is one of five and each is a different fact — the four-answer argument in
// claim-liveness.mjs, for the same reason: callers act identically on `live` and `unknown`, and a
// classifier that could not tell them apart could not tell "we protected a live run" from "we could not
// look".

import { claimerIsAlive } from "./claim-liveness.mjs";

/** Six hours. See the header for the arithmetic; injectable everywhere it is used. */
export const DEFAULT_QUIET_MS = 6 * 60 * 60 * 1000;

/** The states a run can be in that mean "this run has ended". Mirrors progress.mjs's TERMINAL_STATES. */
export const ENDED_STATES = Object.freeze(["delivered", "failed", "cancelled"]);

/**
 * States that CLAIM to be in progress. A run in any of these with no process behind it is the defect.
 *
 * `postponed` and `recovering` are deliberately NOT here: both are parked with a clock (`resetsAt`,
 * `recoveryResumesAt`) and no process is expected to be alive while they wait. Reconciling one would
 * terminalise a run that is working exactly as designed, which is the single worst thing this file
 * could do — the monotonic guard makes it permanent.
 */
export const LIVE_CLAIMING_STATES = Object.freeze(["running"]);

export const RECONCILE_VERDICTS = Object.freeze(["live", "dead", "quiet", "ended", "unknown"]);

/**
 * One run → one verdict, with a reason a reader can act on.
 *
 * @param {object} run             a Run record (mcp-server/lib/runs.mjs) or anything with .state/.status
 * @param {object} o
 * @param {number} o.now           epoch ms
 * @param {number} [o.quietMs]
 * @param {(rec: {pid: number, starttime: string|null}) => boolean} [o.isAlive]
 * @returns {{verdict: string, why: string}}
 */
export function classifyRun(run, { now, quietMs = DEFAULT_QUIET_MS, isAlive = claimerIsAlive } = {}) {
  const s = run?.status ?? run ?? {};
  const state = String(run?.state ?? s.state ?? "");

  if (ENDED_STATES.includes(state)) return { verdict: "ended", why: `already terminal (${state})` };
  if (!LIVE_CLAIMING_STATES.includes(state)) {
    // Parked, queued, or a state this file has not been taught. Saying which is the point: an unknown
    // state must never be swept into "not running" by a classifier that only knows three words.
    return { verdict: "unknown", why: `state ${JSON.stringify(state) || "(absent)"} does not claim to be running — left alone` };
  }

  const pid = Number(s.pid) || 0;
  if (pid) {
    // THE EXACT TEST. Same function the queue uses, same fail-safe polarity.
    const alive = isAlive({ pid, starttime: s.pidStarttime ?? null });
    return alive
      ? { verdict: "live", why: `pid ${pid} is alive` }
      : { verdict: "dead", why: `pid ${pid} is gone${s.pidStarttime ? " (or was recycled — recorded starttime does not match)" : ""}` };
  }

  // THE WEAKER TEST, and it is named as weaker wherever it is reported.
  const updatedMs = Date.parse(s.updatedAt ?? run?.updatedAt ?? "");
  if (!Number.isFinite(updatedMs)) {
    return { verdict: "unknown", why: "no pid recorded and no readable updatedAt — nothing here can say whether it is running" };
  }
  const quietFor = now - updatedMs;
  if (quietFor <= quietMs) {
    return { verdict: "unknown", why: `no pid recorded; last wrote ${Math.round(quietFor / 60000)} min ago, inside the ${Math.round(quietMs / 3600000)}h quiet window — cannot say` };
  }
  return { verdict: "quiet", why: `no pid recorded and no status write for ${Math.round(quietFor / 3600000)}h (window ${Math.round(quietMs / 3600000)}h)` };
}

/** The verdicts that mean "write a terminal state". `unknown` and `live` never do. */
const ACTIONABLE = new Set(["dead", "quiet"]);

/**
 * Plan the reconciliation for a set of runs. PURE — returns what it would write and touches nothing.
 * The caller applies it, so the decision and the mutation are separable and the decision is testable.
 *
 * @returns {{plan: Array<{run: object, patch: object, why: string, verdict: string}>, skipped: Array<{run: object, verdict: string, why: string}>}}
 */
export function planReconcile(runs, { now, quietMs = DEFAULT_QUIET_MS, isAlive = claimerIsAlive } = {}) {
  const plan = [];
  const skipped = [];
  for (const run of runs ?? []) {
    const { verdict, why } = classifyRun(run, { now, quietMs, isAlive });
    if (!ACTIONABLE.has(verdict)) { skipped.push({ run, verdict, why }); continue; }
    plan.push({ run, verdict, why, patch: terminalPatch({ verdict, why, now }) });
  }
  return { plan, skipped };
}

/**
 * The terminal a reconciled run gets.
 *
 * `failed`, not a new word. `progress.mjs`'s TERMINAL_STATES is delivered/failed/cancelled, and every
 * consumer in the tree switches on those three — portal-service, status-snapshot, ops.mjs, repairs.mjs,
 * the MCP face. A fourth name would land in each of them as an unhandled case reading "unknown" rather
 * than "ended", which is the shape this issue is about, one level over.
 *
 * `cancelled` was the other candidate and is wrong: it says somebody decided. All this knows is that the
 * run stopped without finishing. WHY it ended goes in `terminalKind`, which is the field that already
 * exists for exactly that job (runs.mjs:59 — "state === 'failed': why the run ended").
 *
 * `reason` is written for a human, because progress.mjs renders it straight into the rollup line.
 */
export function terminalPatch({ verdict, why, now }) {
  const endedAt = new Date(now).toISOString();
  return {
    state: "failed",
    terminalKind: verdict === "dead" ? "process-gone" : "no-heartbeat",
    endedAt,
    reconciledAt: endedAt,
    reconciledFrom: "running",
    reason: verdict === "dead"
      ? `the run's process is gone — reconciled, not completed (${why})`
      : `no status write inside the quiet window — reconciled, not completed (${why})`,
    failedStage: null,
  };
}
