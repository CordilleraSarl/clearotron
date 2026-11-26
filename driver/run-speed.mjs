// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-speed.mjs — one run's speed in one line: whether it was ordered Urgent, and what every session it started asked
// for and was served.
//
// Read from the run's own records: every attempt row on `_driver/run.jsonl` (ladder/attempt-record.mjs) and every
// native-language turn on `_driver/jx-completions.jsonl` carries its turn's speed record, written by the adapter that
// ran it: what it asked for, why it asked for standard in a fast run, and what the program reported serving. A run
// admitted Urgent that the vendor dropped to standard partway still counts as ordered Urgent; this line says how many
// sessions ran fast.
//
// THE COUNTS, per session:
//   fastRequested   asked the vendor for the faster setting;
//   fastConfirmed   of those, the program reported serving fast (the Claude program reports it; a turn whose calls were
//                   mixed is a fallback, not a confirmation);
//   servedUnknown   of those, the program said nothing about what it served (the Codex program never does);
//   fallback        of those, the program reported serving standard or mixed, or said it ran a fast request at standard
//                   speed (out of usage credits);
//   unsupported     a session of a fast run whose model has no faster setting, so it asked for standard (by reason);
//   standard        a session that asked for standard with nothing to explain: every session of a standard run.
// Tokens are summed by what each session asked for, as recorded facts. Nothing here judges them.
import { readFileSync } from "node:fs";
import { paths } from "./run-record.mjs";
import { urgentForRun } from "./engine/run-choices.mjs";
import { runLog } from "./log.mjs";

const tokensOf = (u) => (u && Number.isFinite(Number(u.total)) ? Number(u.total) : 0);

/** The rollup, from the session rows given (attempt rows and native-language turns alike). PURE. */
export function speedRollup(rows = [], urgent = null) {
  const sessions = { total: 0, fastRequested: 0, fastConfirmed: 0, servedUnknown: 0, fallback: 0, unsupported: 0, standard: 0,
    unsupportedBecause: {}, tokens: { fastRequested: 0, standard: 0 } };
  for (const r of rows) {
    const sp = r?.speed ?? null;
    sessions.total++;
    if (sp?.requested === "fast") {
      sessions.fastRequested++;
      sessions.tokens.fastRequested += tokensOf(r.usage);
      const notice = typeof sp.notice === "string" && sp.notice;
      if (sp.served === "fast" && !notice) sessions.fastConfirmed++;
      else if (sp.served === "standard" || sp.served === "mixed" || notice) sessions.fallback++;
      else sessions.servedUnknown++;
      continue;
    }
    sessions.tokens.standard += tokensOf(r.usage);
    if (sp?.standardBecause) {
      sessions.unsupported++;
      sessions.unsupportedBecause[sp.standardBecause] = (sessions.unsupportedBecause[sp.standardBecause] ?? 0) + 1;
    } else sessions.standard++;
  }
  return { ordered: urgent?.ordered === true, fast: urgent?.fast === true, reason: urgent?.reason ?? null, sessions };
}

const readRows = (file, keep) => {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const ln of raw.split("\n")) {
    if (!ln.trim()) continue;
    try { const r = JSON.parse(ln); if (keep(r)) out.push(r); } catch { /* a torn line is skipped */ }
  }
  return out;
};

/** Every attempt row on the run's spine. A spine that cannot be read gives none. */
export function attemptRows(runDir) {
  return readRows(paths(runDir).run, (r) => r?.event === "attempt");
}

/**
 * Every session the run started that has a record: the stages' attempt rows, and the native-language turns that ran a
 * model (a row a fixture or an injected executor wrote ran none, and is stamped not provider-billed: jx-lanes.mjs).
 */
export function sessionRows(runDir) {
  return [...attemptRows(runDir), ...readRows(paths(runDir).jxCompletions, (r) => r && (r.speed || (r.engine && r.engine !== "not-provider-billed")))];
}

/**
 * Write the rollup to the run's spine at a terminal, beside the token rollup that fires at every one. Best-effort: a
 * measurement never affects a run.
 */
export function stampSpeedRollup(runDir, phase) {
  if (!runDir) return null;
  try {
    const rollup = speedRollup(sessionRows(runDir), urgentForRun(runDir));
    runLog(runDir, { event: "speed-rollup", phase, ...rollup });
    return rollup;
  } catch { return null; }
}
