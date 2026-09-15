// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/audit.mjs — append-only access log for the remote HTTP face: who (email) called what (tool/runId), when.
//
// Confidential legal data behind a multi-user surface needs an audit trail. We log a SUMMARY (method + tool
// name + runId/uri), never the full request body or any artifact content. Best-effort: a write failure must
// never break a request.

import { appendFileSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
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

export function appendAudit({ email, sub, body, status, transport, path = DEFAULT_AUDIT_PATH }) {
  // `sub` = the inner-token PRINCIPAL (ops-token issuance, INSTALL.md §8) — distinguishes
  // two automations sharing a transport identity. null for internal/user sessions without a sub claim.
  //
  // `transport` is written only where it changes an answer: "stdio" marks a call that arrived over the
  // local route, which has no signed-in identity to record and therefore no email. Omitted on the HTTP
  // doors, whose records are identified by the email they already carry.
  const line = JSON.stringify({ ts: new Date().toISOString(), email: email ?? null, sub: sub ?? null, ...summarize(body), status: status ?? null, ...(transport ? { transport } : {}) }) + "\n";
  try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, line); } catch { /* best-effort */ }
}

// ── READING THE LOG BACK ────────────────────────────────────────────────────────────────────────────
//
// The portal asks one question of this log: has this reader's assistant ever called a connector on this
// installation? It is the only signal either process has — enrolment says a person MAY connect, not that
// they DID — and the Ask-AI control on a report is drawn from the answer.
//
// THE PORTAL MUST NOT COMPUTE THIS PATH ITSELF. `DEFAULT_AUDIT_PATH` resolves at import, in the writing
// process, from that process's `TRADEMARK_MCP_AUDIT_LOG` and its `homedir()`. A reader that re-ran that
// branch would be the portal-reads-the-connector's-environment defect in a new place. It agrees today —
// on every shipped shape the portal and the connector are units of the SAME login reading the SAME
// `%h/.env`, and the override name is set nowhere — but `existsSync(LEGACY_AUDIT_PATH)` is evaluated at
// import in two processes that start at different times, so a legacy file appearing between those two
// imports would give them different answers with nothing in either log to say so.
//
// So: read BOTH candidates and take the union. A reader that has connected appears in one of them; which
// one is not a question worth asking, and asking it is the part that can be wrong.

/**
 * Every file a connector on this installation could be appending to.
 *
 * AN OVERRIDE IS AN ANSWER, NOT A PREFERENCE. `TRADEMARK_MCP_AUDIT_LOG` exists to relocate this log, and
 * `appendAudit` writes there and nowhere else — so a reader that went on to consult the default homes
 * would report readers from a log the connector on this box is not writing to. It is only where the name
 * is UNSET that there are two candidates to union, because that is the only case where the two processes
 * resolve it themselves.
 */
export function auditPaths() {
  const override = String(process.env.TRADEMARK_MCP_AUDIT_LOG ?? "").trim();
  if (override) return [override];
  const seen = new Set();
  const out = [];
  for (const p of [LEGACY_AUDIT_PATH, join(homedir(), "trademark", "telemetry", "trademark-mcp-access.jsonl")]) {
    if (!seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

const TAIL_BYTES = 256 * 1024;

/**
 * Who has called a connector on this installation, from the tail of the access log.
 *
 * BOUNDED AND FALLIBLE BY DESIGN. The log is append-only and unrotated, so it is read from the end and
 * never whole; `truncated` says the window did not reach the start of the file. A reader further back
 * than the window reads as absent, which is the same answer as a reader who has genuinely never called,
 * and the control's own escape ("Already connected? Ask anyway") is what makes that survivable.
 *
 * `available: false` IS NOT "NOBODY HAS CONNECTED". No log, an unreadable one, a directory where a file
 * should be — every one of those is a could-not-look, and a caller that renders it as "never connected"
 * is asserting something it did not measure. It is returned separately so a caller can say so.
 */
export function readConnections({ paths = auditPaths(), maxBytes = TAIL_BYTES } = {}) {
  const emails = new Set();
  let local = false;
  let available = false;
  let truncated = false;
  const notes = [];

  for (const path of paths) {
    let fd = null;
    try {
      const size = statSync(path).size;
      fd = openSync(path, "r");
      const from = size > maxBytes ? size - maxBytes : 0;
      if (from > 0) truncated = true;
      const buf = Buffer.allocUnsafe(size - from);
      readSync(fd, buf, 0, buf.length, from);
      available = true;
      const lines = buf.toString("utf8").split("\n");
      // A window that starts mid-file starts mid-line: that first fragment is not a record.
      if (from > 0) lines.shift();
      for (const line of lines) {
        if (!line.trim()) continue;
        let rec = null;
        try { rec = JSON.parse(line); } catch { continue; }
        if (!rec || typeof rec !== "object") continue;
        if (typeof rec.email === "string" && rec.email.trim()) emails.add(rec.email.trim().toLowerCase());
        if (rec.transport === "stdio") local = true;
      }
    } catch (e) {
      if (e?.code !== "ENOENT") notes.push(`${path}: ${e?.code ?? e?.message ?? e}`);
    } finally {
      if (fd !== null) { try { closeSync(fd); } catch { /* best-effort */ } }
    }
  }

  return { available, emails, local, truncated, note: notes.length ? notes.join("; ") : null };
}
