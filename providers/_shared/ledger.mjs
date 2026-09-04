// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── Shared register ledger — ONE implementation for every provider core ────────────────────────────
//
// Replaces the three byte-similar copies that lived in providers/{corsearch,clarivate,signa}/src/core.js.
// One register provider runs at a time, so all three append to the SAME per-call / per-record JSONL with
// an identical row schema; every consumer reads these paths unchanged:
//   driver/provider-usage.mjs, driver/registry-fidelity.mjs, driver/coverage-ledger.mjs,
//   driver/engine/mcp/gather-config.mjs (serverEnv).
//
// The names are now vendor-neutral — CLEAROTRON_REGISTER_CALL_LOG / CLEAROTRON_REGISTER_RECORD_LOG over
// register-calls.jsonl / register-records.jsonl. The old CORSEARCH_* names still work for one
// release, and an existing corsearch-named file is still read where it sits, so no deployed box has to
// be migrated. Every rule about which name wins lives in ONE place — ./ledger-path.mjs — and the writer
// and all three readers call it, which is what removes the driver-reads-new / plugin-writes-old
// ordering footgun the rename was previously deferred over. gather-config's serverEnv closes the last
// gap by handing a spawned server the ALREADY-RESOLVED path, so a child never re-decides.
//
// Every row carries a `provider` discriminator so a ledger line says which vendor produced it.
//
// Paths are captured at MODULE LOAD, exactly as all three cores did — deliberately not lazy: a
// read-at-call-time lookup would be a behaviour change (the offline test fleet re-imports driver
// modules per test and relies on the frozen value).
//
// SECURITY — the ids below (agentId / sessionKey / sessionId) are the GATEWAY tool-call context
// (e.g. "clawdi", "prelim-acme-…"), the per-run attribution. They are NEVER the provider credential
// (Corsearch's `sessionKey` COOKIE merely shares the name; Clarivate's X-ApiKey; Signa's Bearer token).
// The ledger is only ever handed `tctx` + response metrics — keep it so.
//
// Telemetry is fully isolated in try/catch: a ledger failure must NEVER affect a search.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ledgerPath } from "./ledger-path.mjs";

export const CALL_LOG_PATH = ledgerPath("call");
// Spec A1 (citation fidelity): every fetched record's BODY is persisted alongside the call ledger, so the
// driver can verify report registry identifiers FIELD-FOR-FIELD against the record actually fetched (and
// archive the records into the run dir). Same session attribution; same never-break-a-search posture.
//
// — THIS IS NOW THE FALLBACK, NOT THE ADDRESS. The record log is run-scoped (see ledger-path.mjs);
// its destination arrives per write. Two different processes need two different mechanisms and both are
// live:
//   · the SPAWNED register MCP server is forked once per run and gather-config hands it
//     CLEAROTRON_REGISTER_RECORD_LOG pointing at that run's `_driver/` — so the module-load capture below is
//     already the right per-run value in the child, and nothing about it needed to change.
//   · the DRIVER also fetches records (the registry-evidence closure, the screen-gate refetch, the
//     knockout listing) and is LONG-LIVED, with several runs' pipelines in flight at once
//     (runner.mjs drains queues concurrently). A process-global address — captured here or re-read from
//     process.env — would attribute one run's records to another, silently. So the driver passes the run's
//     path per call on `tctx.recordLog`, which is the only shape that is correct under concurrency.
// The const remains for a writer with no run dir at all (a bare CLI probe, a test): losing a body is
// worse than filing it globally, and `fetchedWithoutRecord` in registry-fidelity is what makes a run
// whose bodies went there report as a FAILURE rather than as a clean zero.
export const RECORD_LOG_PATH = ledgerPath("record");

// Build the telemetry context for a tool call from the SDK tool-factory `ctx` (per-call gateway context).
export const tctxOf = (ctx, kind) => ({
  kind,
  agentId:    ctx?.agentId    ?? null,
  sessionKey: ctx?.sessionKey ?? null,
  sessionId:  ctx?.sessionId  ?? null,
});

function append(path, line) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line + "\n");
  } catch { /* telemetry must never break a search */ }
}

/**
 * Bind the ledger to one provider id. Returns { logCall, logRecordBody, tctxOf } — the exact trio each
 * core used to define inline.
 *   logCall(tctx, metrics)         metrics = { http_status, ok, attempts, took_ms, bytes, cache_hit }
 *   logRecordBody(tctx, target, body)
 */
export function makeLedger(provider) {
  const logCall = (tctx, metrics) => {
    try {
      append(CALL_LOG_PATH, JSON.stringify({
        ts: new Date().toISOString(),
        provider,
        agentId:    tctx?.agentId    ?? null,
        sessionKey: tctx?.sessionKey ?? null,  // GATEWAY session key, NOT the provider credential
        sessionId:  tctx?.sessionId  ?? null,
        tool:       tctx?.kind       ?? null,
        target:     tctx?.target     ?? null,
        ...metrics,
      }));
    } catch { /* telemetry must never break a search */ }
  };
  const logRecordBody = (tctx, target, body) => {
    try {
      // The run's own log when the caller knows which run this is; the global fallback otherwise.
      // `tctx.recordLog` is a PATH the driver resolved from the run dir — never a credential, never
      // written into the row.
      const dest = typeof tctx?.recordLog === "string" && tctx.recordLog.trim()
        ? tctx.recordLog.trim() : RECORD_LOG_PATH;
      append(dest, JSON.stringify({
        ts: new Date().toISOString(),
        provider,
        agentId:    tctx?.agentId    ?? null,
        sessionKey: tctx?.sessionKey ?? null,
        sessionId:  tctx?.sessionId  ?? null,
        target,
        body,
      }));
    } catch { /* record persistence must never break a search */ }
  };
  return { logCall, logRecordBody, tctxOf };
}
