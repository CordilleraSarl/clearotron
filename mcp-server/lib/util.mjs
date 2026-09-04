// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/util.mjs — small shared, read-only helpers.

import { statSync, readFileSync } from "node:fs";

// Cap artifact/telemetry reads so a pathologically large file can't OOM the stdio server. The artifacts are
// driver-produced and normally tiny, so this is a generous defence-in-depth ceiling (env-overridable).
export const MAX_READ_BYTES = Number(process.env.TRADEMARK_MCP_MAX_BYTES || 64 * 1024 * 1024);

// Read text but refuse a file larger than `max`. ENOENT/other stat errors fall through to readFileSync so the
// caller's existing existence handling/try-catch still applies.
export function readCapped(path, max = MAX_READ_BYTES) {
  let size;
  try { size = statSync(path).size; } catch { return readFileSync(path, "utf8"); }
  if (size > max) throw new Error(`file too large to read (${size} bytes > ${max}); narrow the query or raise TRADEMARK_MCP_MAX_BYTES`);
  return readFileSync(path, "utf8");
}

// Consistent MIME for a file path (used by BOTH ListResources and ReadResource so the same resource reports
// the same type).
export function mimeFor(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".jsonl")) return "application/x-ndjson";
  if (path.endsWith(".md")) return "text/markdown";
  return "text/plain";
}
