#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// reconcile-runs.mjs —: bring runs whose process is gone to an explicit terminal state.
//
// The owner watched a SIGKILLed run sit at `state:"running"`, `endedAt:null`, showing 5h43m in the UI,
// and then drop silently out of the list. Every reader that trusts `state` counts that as live.
//
// `stop_run` cannot fix it after the fact: it is COOPERATIVE — it writes a cancel request the run has to
// be alive to read. A run that was killed never cooperated. This is the other end of that gap, and it is
// the only recovery that survives a reboot.
//
// The decision lives in driver/reconcile-runs.mjs and is pure and unit-tested; this file walks a
// workspace, applies it, and reports. Read that header for how liveness is established and why the
// quiet window is what it is.
//
//   node scripts/reconcile-runs.mjs [--workspace-root <dir>] [--agents a,b,c] [--quiet-hours N] [--apply]
//
// OPERATOR-ONLY, and DRY-RUN BY DEFAULT. It rewrites status.json on real runs.
//
// ── THERE IS NO DEFAULT WORKSPACE ROOT, AND THAT IS THE POINT ────────────────────────────────────────
//
// Same rule as scripts/backfill-started-at.mjs, and it earned it there: the default used to be the
// production workspace, so an unset variable pointed a rewriting script at live client runs, one flag
// away from editing them. An absence is a finding — this refuses and names the variable.
//
// ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────────────────────────────
//
// It moves a run only FORWARD, from `running` into a terminal state, and progress.mjs's monotonic guard
// then makes that permanent. So the failure that matters is terminalising a LIVE run, and the whole
// design is bent away from it: `postponed` and `recovering` are never touched (both are parked with a
// clock and no process is meant to be alive), a pid whose starttime cannot be read counts as ALIVE, and
// a run with neither a pid nor a readable `updatedAt` is reported as `unknown` and left exactly as it is.

import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DRIVER_DIR } from "../shared/driver-dir.mjs";   //
import { classifyRun, terminalPatch, DEFAULT_QUIET_MS } from "../driver/reconcile-runs.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

const WORKSPACE_ROOT = argValue("--workspace-root") ?? envFrom(process.env, "CLEAROTRON_WORK_DIR");
// The default is the CANONICAL agent alone. It used to name two of this firm's people, which shipped
// their identities to every clone and told an installer nothing. Per-agent rosters are a
// property of a deployment, so they are passed: --agents a,b,c
const AGENTS = (argValue("--agents") ?? "clawdi").split(",").map((s) => s.trim()).filter(Boolean);
const APPLY = process.argv.includes("--apply");
const QUIET_MS = (() => {
  const raw = argValue("--quiet-hours");
  if (raw == null) return DEFAULT_QUIET_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`reconcile-runs: --quiet-hours ${JSON.stringify(raw)} is not a positive number of hours.`);
    process.exit(2);
  }
  return n * 60 * 60 * 1000;
})();

// Every status.json under a studio root, live and archived. Lifted verbatim in shape from
// backfill-started-at.mjs so the two rewriting scripts cannot disagree about what a run directory is.
export function findRunDirs(studioRoot, depth = 5, acc = []) {
  if (depth < 0) return acc;
  let entries = [];
  try { entries = readdirSync(studioRoot, { withFileTypes: true }); } catch { return acc; }
  if (entries.some((e) => e.isFile() && e.name === "status.json")) acc.push(studioRoot);
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "queue" || e.name === DRIVER_DIR || e.name === "register-units" || e.name === "node_modules") continue;
    findRunDirs(join(studioRoot, e.name), depth - 1, acc);
  }
  return acc;
}

/**
 * Reconcile ONE run dir. Pure decision + optional write, so the report and the mutation are the same
 * code path and a dry run cannot describe something different from what `--apply` would do.
 */
export function reconcileRunDir(runDir, { apply = false, now = Date.now(), quietMs = DEFAULT_QUIET_MS, isAlive } = {}) {
  const statusPath = join(runDir, "status.json");
  if (!existsSync(statusPath)) return { runDir, verdict: "no-status", why: "no status.json" };
  let status;
  try { status = JSON.parse(readFileSync(statusPath, "utf8")); }
  catch { return { runDir, verdict: "unreadable-status", why: "status.json is not readable JSON" }; }

  const { verdict, why } = classifyRun(status, { now, quietMs, ...(isAlive ? { isAlive } : {}) });
  if (verdict !== "dead" && verdict !== "quiet") return { runDir, verdict, why, runId: status.runId ?? null };

  const patch = terminalPatch({ verdict, why, now });
  if (apply) {
    // The status writer's own atomic pattern: temp beside the target, then rename. Not writeRunStatus —
    // that takes a run ctx this script does not have, and going through it would need a synthetic one.
    // The monotonic guard it enforces is not being bypassed: this only ever writes a terminal onto a
    // NON-terminal run, which is the direction that guard permits.
    const tmp = `${statusPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...status, ...patch }, null, 2) + "\n");
    renameSync(tmp, statusPath);
  }
  return { runDir, runId: status.runId ?? null, verdict, why, applied: apply, patch };
}

function main() {
  // Checked at RUN time, not import time: the suite imports this module for its helpers, and a
  // module-scope exit would take the suite with it.
  if (!WORKSPACE_ROOT) {
    console.error(
      "reconcile-runs: no workspace root. Pass --workspace-root <dir> or set CLEAROTRON_WORK_DIR.\n" +
      "There is deliberately no default. The previous default on the sibling rewriting script was the\n" +
      "production workspace, so an unset variable pointed it at live client runs — one --apply away\n" +
      "from editing them."
    );
    process.exit(2);
  }

  const now = Date.now();
  const rows = [];
  for (const agent of AGENTS) {
    const studio = join(WORKSPACE_ROOT, `workspace-${agent}`, "studio", "prelim-search");
    for (const dir of findRunDirs(studio)) rows.push({ agent, ...reconcileRunDir(dir, { apply: APPLY, now, quietMs: QUIET_MS }) });
  }

  const counts = {};
  for (const r of rows) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

  console.log(`\nreconcile-runs — ${APPLY ? "APPLYING" : "DRY RUN (nothing written; pass --apply)"}`);
  console.log(`  workspace   ${WORKSPACE_ROOT}`);
  console.log(`  agents      ${AGENTS.join(", ")}`);
  console.log(`  quiet window ${Math.round(QUIET_MS / 3600000)}h — how long a run with NO RECORDED PID may be silent before it counts as gone\n`);

  // Every actionable row printed in full: this writes a permanent terminal state, so the operator sees
  // each one and its reason rather than a count.
  for (const r of rows.filter((x) => x.verdict === "dead" || x.verdict === "quiet")) {
    console.log(`  ${APPLY ? "RECONCILED" : "WOULD RECONCILE"}  ${r.runId ?? r.runDir}`);
    console.log(`      ${r.why}`);
    console.log(`      → state=failed terminalKind=${r.patch.terminalKind} endedAt=${r.patch.endedAt}`);
  }

  // And the ones it declined to touch, as counts with their reasons available — an absence is a finding,
  // so "0 reconciled" has to be distinguishable from "nothing was looked at".
  console.log(`\n  ${rows.length} run(s) examined: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`);
  const unknown = rows.filter((r) => r.verdict === "unknown");
  if (unknown.length) {
    console.log(`\n  ${unknown.length} run(s) could NOT be judged and were left alone:`);
    for (const r of unknown.slice(0, 20)) console.log(`      ${r.runId ?? r.runDir} — ${r.why}`);
    if (unknown.length > 20) console.log(`      … and ${unknown.length - 20} more`);
  }
  if (!rows.length) {
    console.log(`\n  NOTHING WAS EXAMINED. ${WORKSPACE_ROOT} holds no run directories for these agents —`);
    console.log(`  check --workspace-root and --agents before reading this as a clean result.`);
  }
  console.log("");
}

if (isEntrypoint(import.meta.url)) main();
