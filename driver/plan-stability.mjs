// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Plan-stability metrics — PURE, no driver imports.
//
// Measures whether re-running the same mark finds the same facts. The baseline on the
// holdout matter was a mean material-fact Jaccard of ~0.04 across six runs — verdicts agreed while the evidence
// diverged. Every fix must RAISE these numbers on the frozen holdout; they are
// ran-vs-done mechanism metrics, never verdict metrics.
//
// Three overlap sets per run:
//   bandIds   — enumerated register record_ids from register-named-band.json (recall stability)
//   material  — findings.json findings with composite>=3, keyed mark|owner (fact-set stability)
//   qids      — executed plan qids, read from the run's _driver/plan-execution.json receipt
//
// CLI: node plan-stability.mjs <runDir> [<runDir>…]   (groups by slug = parent dir name)
// Run via sudo when the run dirs belong to another user; read-only throughout.

import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — realpath both sides, or a symlinked invocation exits 0 silently

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function bandIdSet(runDir) {
  const band = readJson(join(runDir, "register-named-band.json"));
  const out = new Set();
  if (!band) return out;
  const blocks = Array.isArray(band) ? band : [band];
  for (const b of blocks) {
    for (const r of b?.enumerated ?? []) if (r?.record_id) out.add(String(r.record_id));
  }
  return out;
}

export function materialSet(runDir) {
  const f = readJson(join(runDir, "findings.json"));
  const out = new Set();
  for (const x of f?.findings ?? []) {
    // material = composite>=3 (legacy) or band-rated (doc 50 v4: any banded finding — off-field
    // awareness items carry no band, so band-presence is the rated line; stability telemetry only).
    if (((x?.composite ?? 0) >= 3 || x?.band != null) && x?.disposition !== "withdrawn")
      out.add(`${norm(x.mark)}|${norm(x.owner?.name)}`);
  }
  return out;
}

export function executedQidSet(runDir) {
  const plan = readJson(driverDir(runDir, "register-plan.json"));
  const exec = readJson(driverDir(runDir, "plan-execution.json"));
  const out = new Set();
  for (const e of exec?.executed ?? []) if (e?.qid) out.add(e.qid);
  if (!out.size && plan) for (const ax of Object.values(plan.axes ?? {})) for (const q of ax) if (q?.qid) out.add(q.qid);
  return out;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return null; // nothing to compare — do not count as agreement
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function pairwiseMean(sets) {
  const vals = [];
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const v = jaccard(sets[i], sets[j]);
      if (v != null) vals.push(v);
    }
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

export function slugStability(runDirs) {
  return {
    runs: runDirs.length,
    bandJaccard: pairwiseMean(runDirs.map(bandIdSet)),
    materialJaccard: pairwiseMean(runDirs.map(materialSet)),
    qidJaccard: pairwiseMean(runDirs.map(executedQidSet)),
  };
}

// Re-runs of one mark can live under different slugs (noref slugs embed a per-submission hash),
// so grouping keys on the normalized mark name from status.json, falling back to the slug dir.
export function markKey(runDir) {
  const s = readJson(join(runDir, "status.json"));
  return norm(s?.markName) || basename(dirname(runDir));
}

export function groupByMark(dirs) {
  const byMark = new Map();
  for (const d of dirs) {
    const k = markKey(d);
    if (!byMark.has(k)) byMark.set(k, []);
    byMark.get(k).push(d);
  }
  return byMark;
}

if (isEntrypoint(import.meta.url)) {
  const dirs = process.argv.slice(2).filter((d) => existsSync(d));
  const out = {};
  for (const [mark, ds] of groupByMark(dirs)) if (ds.length >= 2) out[mark] = slugStability(ds);
  console.log(JSON.stringify(out, null, 2));
}
