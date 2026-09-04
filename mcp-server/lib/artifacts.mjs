// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/artifacts.mjs — map an MCP artifact name to the driver stage that produced it, and list the versions of
// it that actually exist on disk. Backs diff_artifact, which reuses the driver's compareCmd (keyed by stage).
//
// Versions only exist when something snapshotted them: an in-place re-dispatch writes into _history/<ts>-<reason>/,
// and a what-if experiment writes into _experiments/<...>. The automated escalation re-digest / corrective
// re-synthesis overwrite IN PLACE (no snapshot) — so on a normal run there is only the "canonical" version and
// there is nothing to diff. listArtifactVersions surfaces exactly what's comparable, honestly.

import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { STAGES, REGISTER_AXES } from "./driver.mjs";

// MCP artifact name → { stage, axis } for compareCmd, or null if unrecognized.
// Accepts: a register axis ("primary-sweep"), "registerUnit:<axis>"/"register-unit:<axis>", a canonical paths()
// key ("registerFindings"/"narrative"/…), or a basename ("register-findings.md").
export function artifactToStage(P, name) {
  const n = String(name ?? "");
  if (n === "register-unit") return { stage: "register-unit", axis: null }; // caller must supply axis
  if (REGISTER_AXES.includes(n)) return { stage: "register-unit", axis: n };
  if (n.startsWith("registerUnit:") || n.startsWith("register-unit:")) {
    const ax = n.split(":")[1];
    return REGISTER_AXES.includes(ax) ? { stage: "register-unit", axis: ax } : null;
  }
  const bn = (P[n] && typeof P[n] !== "function") ? basename(P[n]) : (n.includes(".") ? n : `${n}.md`);
  for (const [stage, def] of Object.entries(STAGES)) {
    if (!def.out) continue;
    if (stage === "register-unit") {
      for (const ax of REGISTER_AXES) {
        try { if (basename(def.out(P, ax)) === bn) return { stage, axis: ax }; } catch { /* skip */ }
      }
    } else {
      try { if (basename(def.out(P)) === bn) return { stage, axis: null }; } catch { /* skip */ }
    }
  }
  return null;
}

// Guard diff_artifact's a/b refs against path-escape BEFORE they reach the driver's compareCmd — whose refDir()
// honours absolute paths and "../" traversal and reads RAW (no readCapped cap). Constrain each ref to the exact
// set of versions that exist for THIS run+stage (canonical + real _history/_experiments snapshots): an absolute
// path, a ".." traversal, or another run's snapshot is simply not in that set, so this closes the escape (incl.
// cross-agent run-dir reads) without editing the shared driver file. Throws on a disallowed ref.
export function assertDiffRefsSafe(versions, a, b) {
  const allowed = new Set(versions);
  for (const [k, ref] of [["a", a], ["b", b]]) {
    if (ref != null && !allowed.has(ref)) {
      const snaps = versions.filter((v) => v !== "canonical");
      throw new Error(`diff_artifact: ${k} ref "${ref}" is not allowed for this run. Use 'canonical' or one of: ${snaps.length ? snaps.join(", ") : "(no snapshots exist)"}.`);
    }
  }
}

// The refs that can be diffed for this artifact: always "canonical", plus any _history/_experiments snapshot
// dir that actually contains the file (flat, or nested under register-units/ for experiments).
export function listArtifactVersions(P, runDir, stage, axis) {
  const def = STAGES[stage];
  let bn;
  try { bn = basename(stage === "register-unit" ? def.out(P, axis) : def.out(P)); } catch { return ["canonical"]; }
  const out = ["canonical"];
  for (const sub of ["_history", "_experiments"]) {
    let dirs = [];
    try { dirs = readdirSync(join(runDir, sub)).sort(); } catch { continue; }
    for (const d of dirs) {
      if (existsSync(join(runDir, sub, d, bn)) || existsSync(join(runDir, sub, d, "register-units", bn))) out.push(`${sub}/${d}`);
    }
  }
  return out;
}
