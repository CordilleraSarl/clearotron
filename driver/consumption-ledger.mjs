// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// consumption-ledger.mjs — what an account actually CONSUMED, across runs.
//
// The token rollup answers "what did this run spend" and lives inside the run dir. Nothing answered
// "what did this account spend this month", because the only cross-run per-account record in the system
// is `.matter-ledger.jsonl` — and that counts RUNS, not consumption, so two runs differing ~20× in work
// were indistinguishable in every account-level view. This is the missing join: one row per run per
// terminal, written beside the matter ledger, carrying the measured figures.
//
// SEPARATE FILE, SEPARATE READER, ON PURPOSE. The matter ledger is what the admission wall counts
// (runner.mjs::checkRunCaps) and `accountUsage` mirrors it exactly so the screen can never disagree with
// the gate. Nothing here is allowed to change either of those numbers: this file is measurement, the
// matter ledger is control. A consumption row is written at a run's TERMINAL, long after admission, and
// no gate reads it.
//
// APPEND-ONLY, LAST-ROW-PER-RUN WINS. A run can reach a terminal more than once — postponed, resumed,
// delivered — and each terminal appends a fresh row rather than rewriting the file. That keeps the write
// crash-safe and race-free between concurrent runs sharing a workspace (a rewrite would need a lock the
// rest of this codebase deliberately does not take), at the cost of the reader collapsing by runId. The
// figures RESTATE rather than accumulate (rollupTokens recomputes from the whole run dir every time), so
// last-row-wins is the correct collapse, not merely a convenient one.
//
// Pure leaf: node:fs + node:path, no driver imports, no env reads — the same rule usage-ledger.mjs
// follows, so an MCP tool call can read consumption without dragging the pipeline in.

import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Where the consumption ledger sits: beside the matter ledger, in the studio dir. */
export function consumptionLedgerPath(studioRoot) {
  return join(studioRoot, ".consumption-ledger.jsonl");
}

/**
 * Append one terminal row for a run. Best-effort by contract — a measurement write must never affect a
 * run, delivered or failed; a full disk loses a row, not a report.
 *
 * `tokens` is a rollupTokens() result (or null when the rollup itself failed). Only `total` and `byModel`
 * are kept: per-stage detail stays in the run dir, where it is recomputable, rather than being copied
 * into a file that grows for the lifetime of an account.
 */
export function recordConsumption({
  studioRoot, runId, phase, tokens = null, providerUsage = null,
  profileKey = null, projectKey = null, level = null, stageLabel = null,
  clientPrincipal = false, markCount = null, startedAt = null, quote = null, now = Date.now(),
}) {
  if (!studioRoot || !runId) return false;
  const row = {
    ts: now,
    runId,
    phase,                                    // delivered | failed | postponed | recovery-park
    ...(profileKey ? { profileKey } : {}),
    ...(projectKey ? { projectKey } : {}),
    ...(level ? { level } : {}),
    ...(stageLabel ? { stageLabel } : {}),
    ...(clientPrincipal === true ? { clientPrincipal: true } : {}),
    ...(Number.isFinite(markCount) ? { markCount } : {}),
    // WHAT WE SAID IT WOULD BE, beside what it turned out to be. This pairing on one line is the entire
    // point of the row: measured tokens alone cannot correct an estimate, and an estimate alone cannot be
    // checked. `quote.unitsVersion` says which weight set produced it, so re-fitting later never makes an
    // older row uninterpretable — it makes it a data point about the old weights.
    ...(quote ? { quote } : {}),
    // wall-clock rides the same row as the tokens deliberately: a speed pass and a spend pass ask the
    // same question of the same run, and splitting them across two artifacts guarantees they drift.
    ...(startedAt ? { startedAt, wallSec: Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000)) } : {}),
    // WHICH PROVIDER PRODUCED THIS CONSUMPTION is part of the measurement, not a detail. Tokens are not
    // commensurable across engines — different tokenizers, different accounting, and a subscription turn
    // appears on no API invoice at all — so an account-level row that says only "N tokens" cannot answer
    // a margin question or a "which engine should we run" question. What we SELL stays engine-agnostic;
    // what we PAY is recorded per engine, in that engine's own terms.
    ...(tokens?.total ? { tokens: tokens.total, byModel: tokens.byModel ?? {}, byEngine: tokens.byEngine ?? {}, byAuthMode: tokens.byAuthMode ?? {} } : {}),
    ...(providerUsage ? { providerUsage } : {}),
  };
  try {
    appendFileSync(consumptionLedgerPath(studioRoot), JSON.stringify(row) + "\n");
    return true;
  } catch {
    return false;   // measurement is never load-bearing
  }
}

/**
 * The run-context face of recordConsumption, so both pipelines call ONE mapping instead of keeping a
 * copy each — the knockout lane already went a whole release without a token stamp because its
 * publish path was a byte-faithful copy that quietly fell behind (fixed 2026-07-28).
 *
 * Reads plain properties off ctx and imports nothing: the module stays a leaf.
 */
export function recordRunConsumption(ctx, { phase, tokens = null, providerUsage = null, now = Date.now() } = {}) {
  const run = ctx?.run;
  if (!run?.studioRoot) return false;
  const policy = ctx?.searchPolicy ?? null;
  // startedAt comes from the run's own status.json rather than ctx: it is written once at seed and
  // survives a resume, so a run that postponed and came back still measures wall from its true start.
  let startedAt = null;
  try { startedAt = JSON.parse(readFileSync(join(run.runDir, "status.json"), "utf8"))?.startedAt ?? null; }
  catch { /* no status yet — the row simply carries no wall figure */ }
  return recordConsumption({
    studioRoot: run.studioRoot,
    runId: `${run.slug}-${run.date}-${run.codename}`,
    phase,
    tokens,
    providerUsage,
    profileKey: ctx?.profile?.profileKey ?? null,
    projectKey: ctx?.profile?.projectKey ?? null,
    level: policy?.level ?? null,
    stageLabel: policy?.stageLabel ?? null,
    // the same positive-only stamp the matter ledger and the admission wall use: absent means a staff,
    // email or CLI run, never "unknown"
    clientPrincipal: ctx?.job?.clientPrincipal === true,
    markCount: Array.isArray(ctx?.job?.marks) ? ctx.job.marks.length
      : (ctx?.job?.markName || ctx?.job?.name) ? 1 : null,
    startedAt,
    // frozen on ctx at run start (pipeline.mjs), so a resume records the figure the requester was shown
    quote: ctx?.quote ?? null,
    now,
  });
}

/** Collapse rows to one per runId, last write winning (see the header on why last-wins is correct). */
function latestPerRun(rows) {
  const byRun = new Map();
  for (const r of rows) if (r?.runId) byRun.set(r.runId, r);
  return [...byRun.values()];
}

function emptyTotals() {
  // No `reasoning` key: the reasoning-token slot was unfillable (no such count exists in the provider
  // payload) and read 0 forever — dropped with the engine contract's `reasoningTokens?`, 2026-07-30.
  // The summing loop below iterates THESE keys, so a source row carrying extra fields is simply ignored.
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, attempts: 0 };
}

/**
 * What an account has CONSUMED today and this month, and over how many runs.
 *
 * Deliberately NOT folded into accountUsage(): that function mirrors the admission wall and its numbers
 * are a promise to the user about whether the next run will be refused. These are measurements with a
 * different provenance (written at terminal, absent for a run still in flight) and a different failure
 * mode (a lost row under-counts silently). Keeping them apart means a bug here can never move the number
 * that gates a run.
 *
 * `runs` counts runs with a terminal row in the window; a run still in flight contributes nothing until
 * it ends, so today's figure trails reality by design rather than guessing at partial spend.
 *
 * Best-effort like its sibling — an unreadable ledger yields a lower number, never an exception.
 */
export function accountConsumption({ workspaceRoot, account, now = Date.now() }) {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const monthKey = new Date(now).toISOString().slice(0, 7);
  const out = {
    today: { runs: 0, tokens: emptyTotals() },
    thisMonth: { runs: 0, tokens: emptyTotals() },
  };
  let workspaces = [];
  try { workspaces = readdirSync(workspaceRoot).filter((n) => n.startsWith("workspace-")); } catch { return out; }

  const rows = [];
  for (const ws of workspaces) {
    const studio = join(workspaceRoot, ws, "studio", "prelim-search");
    try {
      for (const line of readFileSync(consumptionLedgerPath(studio), "utf8").split("\n")) {
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e?.profileKey === account && typeof e.ts === "number") rows.push(e);
      }
    } catch { /* no consumption ledger in this workspace yet */ }
  }

  for (const e of latestPerRun(rows)) {
    const stamp = new Date(e.ts).toISOString();
    const buckets = [];
    if (stamp.slice(0, 7) === monthKey) buckets.push(out.thisMonth);
    if (stamp.slice(0, 10) === dayKey) buckets.push(out.today);
    for (const b of buckets) {
      b.runs += 1;
      for (const k of Object.keys(b.tokens)) b.tokens[k] += Number(e.tokens?.[k]) || 0;
    }
  }
  return out;
}
