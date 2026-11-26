// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-speed.mjs — one run's speed in one line: whether it was ordered Urgent, and how many of its judgment-tier calls
// the vendor reported serving fast, out of how many.
//
// Read from the run's own spine (`_driver/run.jsonl`): every attempt row carries the speed its turn asked for, what the
// program reported serving, and the stage's declared tier (ladder/attempt-record.mjs). A run admitted Urgent that the
// vendor dropped to standard partway still counts as ordered Urgent; this line says how many calls ran fast.
//
// A call is one request to the vendor. The Claude program reports each call's speed; the Codex program reports none, so
// its turns are counted as turns whose served speed is unknown, never as calls served at the speed they asked for.
import { readFileSync } from "node:fs";
import { paths } from "./run-record.mjs";
import { isJudgmentTier } from "./engine/speed.mjs";
import { urgentForRun } from "./engine/run-choices.mjs";
import { runLog } from "./log.mjs";

/** The rollup, from the attempt rows given. PURE. */
export function speedRollup(rows = [], urgent = null) {
  const judgment = { turns: 0, turnsAskedFast: 0, callsFast: 0, callsStandard: 0, callsUnknown: 0, turnsServedUnknown: 0 };
  for (const r of rows) {
    if (r?.event !== "attempt" || !isJudgmentTier(r?.tier)) continue;
    judgment.turns++;
    const sp = r.speed ?? null;
    if (sp?.requested === "fast") judgment.turnsAskedFast++;
    if (sp?.calls && typeof sp.calls === "object") {
      judgment.callsFast += Number(sp.calls.fast) || 0;
      judgment.callsStandard += Number(sp.calls.standard) || 0;
      judgment.callsUnknown += Number(sp.calls.unknown) || 0;
    } else judgment.turnsServedUnknown++;
  }
  return { ordered: urgent?.ordered === true, fast: urgent?.fast === true, reason: urgent?.reason ?? null, judgment };
}

/** Every attempt row on the run's spine. A spine that cannot be read gives none. */
export function attemptRows(runDir) {
  let raw;
  try { raw = readFileSync(paths(runDir).run, "utf8"); } catch { return []; }
  const out = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try { const r = JSON.parse(ln); if (r?.event === "attempt") out.push(r); } catch { /* a torn line is skipped */ }
  }
  return out;
}

/**
 * Write the rollup to the run's spine at a terminal, beside the token rollup that fires at every one. Best-effort: a
 * measurement never affects a run.
 */
export function stampSpeedRollup(runDir, phase) {
  if (!runDir) return null;
  try {
    const rollup = speedRollup(attemptRows(runDir), urgentForRun(runDir));
    runLog(runDir, { event: "speed-rollup", phase, ...rollup });
    return rollup;
  } catch { return null; }
}
