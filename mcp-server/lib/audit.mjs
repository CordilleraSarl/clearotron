// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/audit.mjs — append-only access log for the remote HTTP face: who (email) called what (tool/runId), when.
//
// Confidential legal data behind a multi-user surface needs an audit trail. We log a SUMMARY (method + tool
// name + runId/uri), never the full request body or any artifact content. Best-effort: a write failure must
// never break a request.

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// — the default moved out of `~/.openclaw/telemetry` (the integrator platform's folder, which this
// engine does not require) into `~/trademark/telemetry`, beside the pool and workspace the setup wizard
// writes. RESOLVED BY EXISTENCE, the same rule providers/_shared/ledger-path.mjs states at length: a
// deployed box already has an access log at the old path, appendAudit is best-effort by design ("a write
// failure must never break a request"), and a moved default would therefore split a compliance trail in
// two with nothing in any log to say so. An existing file keeps being appended to; a fresh install gets
// the new home. Read at import, like the value it replaces — one process, one log.
export const LEGACY_AUDIT_PATH = join(homedir(), ".openclaw", "telemetry", "trademark-mcp-access.jsonl");
export const DEFAULT_AUDIT_PATH =
  process.env.TRADEMARK_MCP_AUDIT_LOG
  || (existsSync(LEGACY_AUDIT_PATH)
    ? LEGACY_AUDIT_PATH
    : join(homedir(), "trademark", "telemetry", "trademark-mcp-access.jsonl"));

// Reduce a JSON-RPC request body to the few fields worth auditing — no content, no secrets.
export function summarize(body) {
  if (!body || typeof body !== "object") return { method: null };
  const method = body.method ?? null;
  const out = { method };
  if (method === "tools/call") {
    out.tool = body.params?.name ?? null;
    const a = body.params?.arguments ?? {};
    if (a.runId) out.runId = a.runId;
    if (a.query) out.query = String(a.query).slice(0, 120);
  } else if (method === "resources/read") {
    out.uri = body.params?.uri ?? null;
  }
  return out;
}

export function appendAudit({ email, sub, body, status, path = DEFAULT_AUDIT_PATH }) {
  // `sub` = the inner-token PRINCIPAL (ops-token issuance, INSTALL.md §8) — distinguishes
  // two automations sharing a transport identity. null for internal/user sessions without a sub claim.
  const line = JSON.stringify({ ts: new Date().toISOString(), email: email ?? null, sub: sub ?? null, ...summarize(body), status: status ?? null }) + "\n";
  try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, line); } catch { /* best-effort */ }
}
