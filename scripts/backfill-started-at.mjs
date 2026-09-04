#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// backfill-started-at.mjs — repair the startedAt lie in historical status.json files (A3, 2026-07-28 postmortem).
//
// Until 2026-07-28 the status seed patched `startedAt: now` UNCONDITIONALLY on every resume, so any run
// that ever parked and resumed carries its LAST resume time as its start (the 2026-07-28 postmortem run: a 08:31 start
// shown as 14:16 — 5h45 of history gone). The append-only `_driver/run.jsonl` spine kept the truth the
// whole time: every pass logs a `start` event, and `resume:false` marks the one true cold start. This
// script walks every workspace status.json (live + archive; the POOL is untouched — meta.json carries
// no startedAt) and rewrites startedAt to min(ts | event=start, resume=false), with provenance:
//
//   startedAtPrior   — what the field said before the backfill (null if it was absent)
//   startedAtSource  — "run.jsonl:start(resume:false) backfill YYYY-MM-DD"
//
// Rules of engagement:
//   • OPERATOR-LOCAL, dry-run by default — nothing is written without --apply.
//   • updatedAt is PRESERVED byte-for-byte: the mtime>updatedAt forensic ("this status was
//     hand-edited after the run last wrote it") must survive the backfill... except for the mtime the
//     backfill itself costs, which the startedAtSource stamp accounts for.
//   • Idempotent: a status whose startedAt already equals the derived truth is skipped, so re-running
//     the script (or running it after the A3 seed fix, which makes new runs honest by construction)
//     changes nothing.
//   • No run.jsonl, or no resume:false start event (a resumed pre-spine run) ⇒ skipped, reported.
//
// Usage:  node scripts/backfill-started-at.mjs [--apply] [--workspace-root <dir>] [--agents a,b,c]

import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DRIVER_DIR, driverDir } from "../shared/driver-dir.mjs";   //

// NAMED, never guessed. This used to fall back to a hardcoded production workspace path, so a run
// with the variable unset — a fresh shell, a public clone, a test — silently pointed a rewriting
// script at the live pool. `--apply` is one flag away from that. The default is now no default.
const WORKSPACE_ROOT = argValue("--workspace-root") ?? envFrom(process.env, "CLEAROTRON_WORK_DIR");
// The default is the CANONICAL agent alone. It used to name two of this firm's people, which shipped
// their identities to every clone and told an installer nothing. Per-agent rosters are a
// property of a deployment, so they are passed: --agents a,b,c
const AGENTS = (argValue("--agents") ?? "clawdi").split(",").map((s) => s.trim()).filter(Boolean);
const APPLY = process.argv.includes("--apply");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

// The one derivation: min ts over `start` events with resume:false. `resume:false` is explicit in every
// spine row the pipeline has ever written (runLog start carries `resume: isResume`), so a strict ===
// false — not falsy — keeps a malformed row from ever claiming to be the cold start.
export function trueStartFromSpine(runDir) {
  const p = driverDir(runDir, "run.jsonl");
  if (!existsSync(p)) return null;
  let min = null;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row?.event !== "start" || row.resume !== false || typeof row.ts !== "string") continue;
    if (min === null || row.ts < min) min = row.ts;
  }
  return min;
}

// Backfill ONE run dir. Pure decision + optional write; returns what happened so main() can report.
export function backfillRun(runDir, { apply = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const statusPath = join(runDir, "status.json");
  if (!existsSync(statusPath)) return { runDir, outcome: "no-status" };
  let status;
  try { status = JSON.parse(readFileSync(statusPath, "utf8")); } catch { return { runDir, outcome: "unreadable-status" }; }
  const trueStart = trueStartFromSpine(runDir);
  if (!trueStart) return { runDir, outcome: "no-true-start" };
  if (status.startedAt === trueStart) return { runDir, outcome: "already-honest" };
  const next = {
    ...status,
    startedAt: trueStart,
    startedAtPrior: status.startedAt ?? null,
    startedAtSource: `run.jsonl:start(resume:false) backfill ${today}`,
    // updatedAt DELIBERATELY untouched — see header.
  };
  if (apply) {
    const tmp = `${statusPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    renameSync(tmp, statusPath);
  }
  return { runDir, outcome: apply ? "backfilled" : "would-backfill", prior: status.startedAt ?? null, startedAt: trueStart };
}

// Every status.json under a studio root: live runs (<studio>/<slug>/<leaf>/) and the archive
// (<studio>/archive/<YYYY-MM>/<slug>/<leaf>/). Bounded-depth walk, mirroring progress.mjs's rollup scan.
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

function main() {
  // Checked at RUN time, not import time: the test suite imports this module for its pure helpers,
  // and a module-scope exit would take the suite with it.
  if (!WORKSPACE_ROOT) {
    console.error(
      "backfill-started-at: no workspace root. Pass --workspace-root <dir> or set CLEAROTRON_WORK_DIR.\n" +
      "There is deliberately no default. The previous one was the production workspace, so an unset\n" +
      "variable pointed this rewriting script at live runs — one --apply away from editing them."
    );
    process.exit(2);
  }
  const counts = {};
  const rows = [];
  for (const agent of AGENTS) {
    const studio = join(WORKSPACE_ROOT, `workspace-${agent}`, "studio", "prelim-search");
    if (!existsSync(studio)) continue;
    for (const runDir of findRunDirs(studio)) {
      const r = backfillRun(runDir, { apply: APPLY });
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
      if (r.outcome === "backfilled" || r.outcome === "would-backfill") rows.push(r);
    }
  }
  for (const r of rows) console.log(`${r.outcome}: ${r.runDir}\n  startedAt ${r.prior ?? "(absent)"} -> ${r.startedAt}`);
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (pass --apply to write)"} — ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ") || "no runs found"}`);
}

import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings
import { envFrom } from "../shared/env-aliases.mjs";   // — resolves EITHER spelling; names the retired one because that is the live-writable half
if (isEntrypoint(import.meta.url)) main();
