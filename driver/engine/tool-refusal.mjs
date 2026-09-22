// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/tool-refusal.mjs — one definition of "this turn's every tool call was refused", for the two
// places that act on it: the gateway, which stops a stage's retries and names the failure, and the engine
// probe, which refuses a host where it happens before a search is paid for. Two copies would drift.

/**
 * Every tool call the turn made was refused, and none completed. Read off the adapter's own gauge
 * (`mcpToolCalls` / `mcpToolCallsRefused`), which counts a refusal only when the call never reached its
 * server — a tool that ran and errored is not one. One refused call beside a completed one is a model
 * asking for something it may not have, not a host that refuses tools, so it does not count. An engine
 * that keeps no gauge reports nothing, and nothing is not a refusal. Pure.
 */
export function everyToolCallRefused(turn) {
  return Number(turn?.mcpToolCallsRefused ?? 0) > 0 && Number(turn?.mcpToolCalls ?? 0) === 0;
}
