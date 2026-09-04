// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// tool-calls.mjs — did the tool call the model was told to make actually RETURN?
//
//. The R5 round of 2026-08-12 failed `named_band_missing` four times and the round's handover
// read it as the model omitting required structure. The preserved run dir says otherwise: the model
// called `register_execute_plan` ONCE exactly as dictated, the call was killed at codex's 300s default
// before it could write the band, and the model then wrote an honest audit note recording the timeout
// and flagging CROSS-CHECK REQUIRED. Hand-authoring the band is the forbidden act, so that note is the
// doctrine-compliant response to what happened.
//
// The validator's evidence was md-present + band-absent, and that pair is genuinely ambiguous: it is
// the fabrication signature AND the killed-call signature. `named_band_missing` picked one and the
// wrong one, and it picked it four times in a row because a deterministic timeout repeats.
//
// THE MISSING FACT WAS NEVER IN THE RUN DIR. Only the MCP server process knew a call was in flight when
// it was killed, and it wrote nothing. `driver/engine/mcp/stdio-server.mjs` now writes one line when a
// call starts and one when it settles; this file reads them.
//
// ── WHY AN ABSENCE IS THE EVIDENCE HERE, WHEN AN ABSENCE IS NORMALLY A BUG ──────────────────────────
//
// The house rule is that an absence must never read as a pass. This reads an absence as a FAILURE, which
// is the same rule pointing the other way: a `started` line with no `settled` line means the process
// died holding the call. That inference is only sound because the FIRST line is written before the work
// begins — the presence of the start is what makes the missing end informative.
//
// It follows that a MISSING LOG proves nothing at all, and this module says so by returning null rather
// than false. No log means the servers never ran, or ran without a run dir, or this is a replay of an
// archived run that predates the log. A caller must treat null as "no evidence" and keep whatever
// verdict it already had — reading null as "the call returned fine" would re-create 's incident
// class in a new file.

import { readFileSync, existsSync } from "node:fs";

import { driverDir } from "../shared/driver-dir.mjs";   //

/** Where the MCP servers write it. One per run, beside the other _driver artifacts. */
export const toolCallsPath = (runDir) => driverDir(String(runDir ?? ""), "tool-calls.jsonl");

/**
 * Every call that STARTED and never SETTLED, newest first.
 *
 * @param runDir  the run directory (the log lives at _driver/tool-calls.jsonl)
 * @param {object} [filter] — { tool, axis } to narrow. Omitted fields match anything.
 * @returns {Array<{seq,server,tool,axis,ts}>|null} — null when there is NO LOG, which is not the same
 *          fact as an empty array and must not be collapsed into it. Empty array = the log exists and
 *          every call in it returned.
 *
 * Pairing is on (server, seq): the counter is per PROCESS and a register server is spawned per stage,
 * so two stages both produce a seq 1. Keying on seq alone would let one stage's settle close another
 * stage's start — a killed call silently marked returned, which is the failure this module exists to
 * prevent.
 */
export function unsettledToolCalls(runDir, { tool = null, axis = null } = {}) {
  const path = toolCallsPath(runDir);
  if (!existsSync(path)) return null;
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return null; }   // unreadable is also "no evidence"
  const started = new Map();
  const settled = new Set();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }   // a torn last line costs its own row, nothing more
    if (!r || typeof r !== "object") continue;
    const key = `${r.server ?? "?"}#${r.seq ?? "?"}`;
    if (r.event === "started") started.set(key, r);
    else if (r.event === "settled") settled.add(key);
  }
  const out = [];
  for (const [key, r] of started) {
    if (settled.has(key)) continue;
    if (tool && r.tool !== tool) continue;
    if (axis && r.axis !== axis) continue;
    out.push(r);
  }
  return out.reverse();
}

/**
 * Did the register unit for `axis` make its dictated plan call and never get it back?
 *
 * The narrow question `registerUnit` needs, so the validator states the question once rather than
 * assembling it from parts at the call site.
 *
 * @returns {object|null} the unsettled call, or null for BOTH "no log" and "every call returned" —
 *          deliberately, because the caller's action is identical in those two cases: keep the verdict
 *          it already had. The difference is diagnosable from `unsettledToolCalls` directly when
 *          somebody needs it, and folding it in here would tempt a caller to branch on the wrong one.
 */
export function registerPlanCallKilled(runDir, axis) {
  for (const tool of ["register_execute_plan", "register_propose_supplemental"]) {
    const rows = unsettledToolCalls(runDir, { tool, axis });
    if (rows?.length) return rows[0];
  }
  return null;
}
