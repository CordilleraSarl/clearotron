// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/runs.mjs — discover + resolve prelim run-dirs (in-flight AND archived) across every agent workspace.
//
// Read-only. We MIRROR the driver's own status walk (progress.mjs `findStatusFiles`) here rather than
// importing it, so the MCP stays a pure additive consumer (no edit to the shared driver file the parallel
// skill work may also touch). Keep SKIP_DIRS in sync with progress.mjs if that walk ever changes.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DRIVER_DIR, driverDir } from "../../shared/driver-dir.mjs";   //
import { config, paths, reportIdentityFor } from "./driver.mjs";

// Mirror of progress.mjs SKIP_DIRS — the high-churn leaf dirs that never hold a run-level status.json.
const SKIP_DIRS = new Set([DRIVER_DIR, "register-units", "queue", "_history", "_experiments"]);
const MAX_DEPTH = 6; // studioRoot → [archive/<YYYY-MM>/]<slug>/<date>-<codename>/status.json

function findStatusFiles(root, depth, acc) {
  if (depth < 0) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isFile() && e.name === "status.json") acc.push(join(root, e.name));
    else if (e.isDirectory() && !SKIP_DIRS.has(e.name)) findStatusFiles(join(root, e.name), depth - 1, acc);
  }
}

// Every workspace-<agent>/studio/prelim-search root under the live workspace root.
export function studioRoots() {
  const out = [];
  let names = [];
  try { names = readdirSync(config.workspaceRoot); } catch { /* workspaceRoot may be absent in test envs */ }
  for (const name of names) {
    const agent = config.agentIdFromWorkspaceName(name);
    if (agent == null) continue;
    const root = config.studioRootForAgent(agent);
    if (existsSync(root)) out.push({ agent, root });
  }
  return out;
}

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

// Build a Run summary from a status.json path. runDir = its parent; location from the path (archive vs live).
function runFromStatusFile(statusFile, agent) {
  const runDir = statusFile.slice(0, -"/status.json".length);
  const s = readJson(statusFile);
  if (!s || !s.slug || !s.codename) return null; // a torn/partial status.json is skipped, never thrown
  return {
    runId: s.runId ?? `${s.slug}-${s.date}-${s.codename}`,
    slug: s.slug, codename: s.codename, date: s.date,
    agent: s.agent ?? agent,
    state: s.state ?? null, verdict: s.verdict ?? null, url: s.url ?? null,
    markName: s.markName ?? null, ref: s.ref ?? null, classes: s.classes ?? null,
    stepN: s.stepN ?? null, stepLabel: s.stepLabel ?? null, stepTotal: s.stepTotal ?? null,
    failedStage: s.failedStage ?? null, reason: s.reason ?? null,
    resetsAt: s.resetsAt ?? null,   // rate-limit POSTPONE ONLY: cap-reset / auto-resume time (state === "postponed")
    recoveryResumesAt: s.recoveryResumesAt ?? null,   // recovery-park backoff clock (A4 split; state === "recovering")
    parkedKind: s.parkedKind ?? null,                 // state === "parked-for-human": why it was parked (grace-exit)
    terminalKind: s.terminalKind ?? null,             // state === "failed": why the run ended (invalid-artifact-loop | reclaim-exhausted | …)
    startedAt: s.startedAt ?? null, updatedAt: s.updatedAt ?? null, deliveredAt: s.deliveredAt ?? null,
    location: runDir.includes("/archive/") ? "archive" : "in-flight",
    runDir, status: s,
  };
}

// A client asks for a mark by its NAME. The stored slug is derived and usually prefixed
// ("tmpdemo2014knockoutsearch-venqori"), so a bare mark name matches no slug and an exact-slug filter
// answers a real account with an empty list — which an assistant then relayed to the owner as "no runs
// exist". `mark` is the name-shaped filter: case-insensitive, on a PART of the word, and
// over the mark name AND the slug, because a client may hold either. `slug` stays exact — enumerateRuns
// has driver consumers (status-snapshot.mjs, repair-digest.mjs) that pass a slug meaning that one run.
function markMatches(run, mark) {
  const needle = String(mark).trim().toLowerCase();
  if (!needle) return true;
  return String(run.markName ?? "").toLowerCase().includes(needle)
      || String(run.slug ?? "").toLowerCase().includes(needle);
}

// All runs (newest-first), optionally filtered by agent / state / slug / mark.
export function enumerateRuns({ agent, state, slug, mark } = {}) {
  const runs = [];
  for (const { agent: a, root } of studioRoots()) {
    if (agent && a !== agent) continue;
    const files = [];
    findStatusFiles(root, MAX_DEPTH, files);
    for (const f of files) {
      const r = runFromStatusFile(f, a);
      if (!r) continue;
      if (state && r.state !== state) continue;
      if (slug && r.slug !== slug) continue;
      if (mark && !markMatches(r, mark)) continue;
      runs.push(r);
    }
  }
  const seen = new Set();
  return runs
    .sort((x, y) => String(y.updatedAt ?? "").localeCompare(String(x.updatedAt ?? "")))
    .filter((r) => (seen.has(r.runId) ? false : seen.add(r.runId)));
}

// Resolve a run by full runId, else codename, else slug (newest match). Returns the Run + paths(P), or null.
export function resolveRun(idOrCodename) {
  if (!idOrCodename) return null;
  const all = enumerateRuns();
  const r =
    all.find((x) => x.runId === idOrCodename) ||
    all.find((x) => x.codename === idOrCodename) ||
    // The LEGACY delivery runId: "<slug>-<codename>", dateless — the form outbox markers and
    // delivery.json packets carried BEFORE 2026-07-30, while enumerateRuns' runId is the dated
    // pool id "<slug>-<date>-<codename>". Nothing resolved it, so the courier got "run not found"
    // for every delivery and fell back to guessing via list_runs — an observed 17-minute wake loop
    // and a 2-hour delay on 2026-07-19. As of 2026-07-30 every minting site writes the DATED
    // canonical form (charter P1 §3 — the split recurred as duplicate markers), so this arm now
    // exists for HISTORICAL packets/markers only. Keep it: old run dirs stay resolvable forever.
    all.find((x) => x.slug && x.codename && `${x.slug}-${x.codename}` === idOrCodename) ||
    all.find((x) => x.slug === idOrCodename) ||
    null;
  // `poolDir` beside `P`, because the run dir is only half of a delivered run. paths() is the CLEARANCE
  // run-dir table and it has no report-data entry at all: the published surfaces (report.html, report.md
  // for a knockout, and report-data.json for BOTH lanes) are written to <poolRoot>/<runId> by
  // publish/index.mjs and publish/knockout.mjs, which `P` cannot see. A consumer holding only `P` reads a
  // delivered knockout as a run with nothing on disk — see brief.mjs.
  // — poolRootOrNull, not poolRoot. The write side REFUSES when CLEAROTRON_REPORTS_DIR is unset; this is
  // a READ path, and an MCP face that threw here would turn "this box has no pool configured" into an
  // exception on a route that never writes. No pool ⇒ no poolDir ⇒ readReportData returns [], which
  // callers already treat as an absence rather than as an empty result.
  const poolRoot = config.poolRootOrNull;
  return r ? { ...r, P: paths(r.runDir), poolDir: poolRoot ? join(poolRoot, r.runId) : null } : null;
}

// The published client data files for a run: <poolRoot>/<runId>/report-data*.json, parsed, in name order.
//
// PLURAL ON PURPOSE. A single-mark run writes `report-data.json`; a MULTI-MARK knockout batch writes one
// file per name, `report-data-<slug>.json`, each carrying that name's own band and its own report URL
// (publish/knockout.mjs). A reader that stats the one filename returns "nothing published" for every
// batch of two or more names — which is the normal shape of a Knockout search, not an edge case.
//
// [] means NO DATA FILE, and callers must treat that as a finding rather than as an empty result: a run
// can legitimately have a report and no data file (publish stamps meta.reportSchema only when the write
// succeeded, and every run published before the file existed has none).
export function readReportData(run) {
  const poolRoot = config.poolRootOrNull;   // — read path: degrade to "no pool", never throw
  const dir = run?.poolDir ?? (run?.runId && poolRoot ? join(poolRoot, run.runId) : null);
  if (!dir) return [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => /^report-data(-.+)?\.json$/.test(n)).sort(); } catch { return []; }
  const out = [];
  for (const n of names) { const d = readJson(join(dir, n)); if (d && typeof d === "object") out.push(d); }
  return out;
}

// WHAT PRODUCT THIS RUN IS, resolved through the driver's registry at READ TIME — never a stored string.
//
// The run freezes its LEVEL (the product id) and nothing else: `_driver/search-policy.json`'s `level`, and
// report-data.json's `level.searchLevel`, are both that id. `reportIdentityFor` turns the id into today's
// name off the same registry row that chose the run's machinery, so the brief, the report masthead and the
// portal row cannot disagree, and a renamed product renames everywhere at once. Storing the NAME on a run
// record or a cache is the bug removed; the knockout data file's own `level.identity` is a rendered
// string and is deliberately NOT read here for the same reason.
//
// null = the registry cannot name this run's product (a level this build has never heard of, or a run
// older than the sidecar). Callers print NOTHING rather than a fallback name — a hardcoded fallback is
// how a knockout came to announce itself as a product it provably was not (renderKnockoutHtml in
// render-knockout.mjs).
export function productIdentityFor(run, docs = null) {
  try {
    const pol = JSON.parse(readFileSync(driverDir(run.runDir, "search-policy.json"), "utf8"));
    const id = reportIdentityFor(pol).identity;
    if (id) return id;
  } catch { /* no frozen sidecar on this run — fall through to the published level id */ }
  for (const d of (docs ?? readReportData(run))) {
    const level = d?.level?.searchLevel;
    if (!level) continue;
    const id = reportIdentityFor(String(level)).identity;
    if (id) return id;
  }
  return null;
}

// GRANTS (INSTALL.md §8): a run's ACCOUNT is the customer profile frozen into it at start.
// The driver's freezeProfile writes `profileKey` (pipeline.mjs) — reading only `key` made EVERY real
// run untagged (null ⇒ invisible to scoped grants; fail-closed but wrong — Phase-3b review 2026-07-18,
// masked by a fixture that wrote the reader's shape instead of the sidecar's). Accept both, prefer the
// real field. null = pre-grants run or unreadable sidecar; the account gate makes null visible only to
// full-grant sessions.
export function runAccountKey(run) {
  try {
    const p = JSON.parse(readFileSync(driverDir(run.runDir, "profile.json"), "utf8"));
    return p.profileKey ?? p.key ?? null;
  } catch { return null; }
}
