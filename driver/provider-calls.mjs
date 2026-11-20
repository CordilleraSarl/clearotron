// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// provider-calls.mjs — the calls the driver makes to a provider itself, with no model turn: a register record fetched in
// code, the adapter it went through noted against the run, and a dictated meaning search issued again.
//
// Moved out of pipeline.mjs unchanged, so that the steps import these instead of having them handed in.
import { parsePrRiskResults } from "./connotation-search.mjs";
import { registerAdapter } from "./engine/run-choices.mjs";
import { noteRegisterServed } from "./register-served.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// V4-2 — the driver-code targeted record fetch (registry-evidence closure), delegated to the ACTIVE
// register provider's adapter (driver.config.PROVIDERS). Pure code at the comparator's named point — no
// agent turn, no gateway command lane: the adapter imports the provider's dependency-free plugin core and
// calls doRecordFetch directly. The plugin chokepoint writes BOTH ledgers (call row + normalized record
// body) under the un-namespaced sessionKey we pass, so the row prefix-matches this run and the assembled
// record set picks it up on re-assembly. Credential = the provider's own env var (already in the driver's
// systemd EnvironmentFile); absence is a named mechanical cause. One provider is active per run.
/**
 * Note the adapter's own id against this run, and hand the adapter straight back.
 *
 * RECORDED WHERE IT IS RESOLVED, so the run's record says what SERVED it rather than what was configured
 * at launch. Noting is idempotent per run and writes only when the set changes, so a run fetching a
 * thousand records pays one write. A null run directory notes nothing: a call outside a run has no record
 * to carry the field, and inventing one is the guess this field exists to replace.
 */
export function noteAdapter(ctx, adapter) {
  noteRegisterServed(ctx?.run?.runDir ?? ctx?.paths?.runDir ?? null, adapter?.id);
  return adapter;
}

export async function defaultRecordFetcher(uri, ctx) {
  return noteAdapter(ctx, registerAdapter(ctx.register)).recordFetch(uri, ctx);
}

/**
 * THE ENGINE RE-ISSUES A DICTATED MEANING SEARCH ITSELF, without asking the assessing model to redo the
 * sweep — the same shape as `defaultRecordFetcher` above, which fetches a register record in code when
 * one was dropped unexamined rather than sending the model back for it.
 *
 * "Through the same tool" is literal and costs no new machinery: the research provider's grid functions
 * are a plain module with no listener, so the component the model calls and this one call the SAME
 * functions on the same provider. There is no second implementation to drift.
 *
 * NARROW BY CONSTRUCTION. The spec handed over carries only the queries that are missing, so this buys
 * those cells rather than re-running a sweep that already cost real money and real minutes.
 *
 * It DECIDES nothing. The caller re-merges and the gate judges, so a re-issue that comes back empty is
 * simply a re-merge that still fails, and is disclosed as such rather than counted as searched.
 */
/** The grid spec's `results_per_cell` from a frozen search policy, or nothing for a run frozen without one. PURE. */
export function resultsPerCellOf(searchPolicy) {   // @internal
  const n = searchPolicy?.web?.resultsPerCell;
  return Number.isInteger(n) && n >= 1 ? { results_per_cell: n } : {};
}

export async function defaultConnotationReissuer(queries, { spec, modelOverride = null, rawPath = null } = {}) {
  const apiKey = process.env.PERPLEXITY_API_KEY || "";
  if (!apiKey) return { ok: false, cause: "no research credential in the driver environment", rows: [] };
  const core = await import("../providers/perplexity/src/core.js");
  const narrow = { ...spec, connotation: { ...(spec.connotation ?? {}), queries: queries.slice() } };
  try {
    const task = core.buildGridProgramTask(narrow);
    const data = await core.callAgentAPI(apiKey,
      core.buildRequestBody({ task, preset: "pro-search", modelOverride, enableSandbox: true }));
    // WHAT CAME BACK, KEPT IN THE RUN like every other web call's: the capture keeps the receipts only.
    if (rawPath) {
      try {
        mkdirSync(dirname(rawPath), { recursive: true });
        writeFileSync(rawPath, JSON.stringify({ tool: "connotation-reissue", queries, items: core.rawResultItems(data) }, null, 1) + "\n");
      } catch { /* best-effort: the receipts below are the record */ }
    }
    const cap = core.captureGridFromResponse(data, narrow);
    if (!cap?.ok) return { ok: false, cause: String(cap?.error ?? "capture failed").slice(0, 160), rows: [] };
    const rows = parsePrRiskResults(cap.ledgerJson).filter((r) => queries.includes(r.query));
    return { ok: true, rows, requested: queries.length };
  } catch (e) {
    return { ok: false, cause: String(e?.message ?? e).slice(0, 160), rows: [] };
  }
}
