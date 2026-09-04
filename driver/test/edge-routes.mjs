// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// edge-routes.mjs — WHAT THE DEPLOYMENT ACTUALLY SERVES, transcribed from the Caddyfile.
//
// Not a test file (no `.test.mjs`, so the runner's `test/*.test.mjs` glob leaves it alone). A helper,
// because the same predicate now has two callers and the whole class of defect it exists to catch is
// "two copies of one fact drifting apart".
//
// ── why a predicate at all ───────────────────────────────────────────────────────────────────────────
//
// Every link in this product is composed by naming a document. The documents sit side by side in the
// pool directory, so `<pool>/<runId>/<file>` is the obvious, natural, well-formed thing to write — and
// it has been dead since the 2026-07-20 portal cutover, which left exactly one legacy path alive.
//
// The failure has no symptom. A link that reaches no handler looks, from here, identical to a link that
// works; from the client's side it looks identical to a link nobody clicked. It has now shipped three
// times: the clearance audit link (email-audit-link.test.mjs), the knockout audit link, and 's
// per-mark report links. Each time the composition was correct and the destination did not exist.
//
// So the property worth pinning is never "the URL is well-formed". It is: SOME HANDLER CLAIMS IT.
//
// ── keeping this true ────────────────────────────────────────────────────────────────────────────────
//
// These two regexps are the deployment's, character for character. Both vhosts carry the same pair —
// `trademark.example.com` and `test-trademark.example.com` — which is why one predicate can stand
// for both environments. If the Caddyfile gains a handler, add it here; if it loses one, these tests
// should go red before a client's link does.

/** `handle /portal` + `handle /portal/*` — the portal, ownership-checked behind Access. */
export const EDGE_PORTAL = /^\/portal(\/|$)/;

/**
 * `@legacyreport path_regexp legacy ^/(…)/report\.html$` → rewritten to /portal/report/<runId>.
 *
 * ONE FILENAME. Not `report-<slug>.html`, not `<runId>-audit.xlsx`, not any other document a run
 * publishes. That is the whole trap: the rule reads as "runs are addressable under their own id", and
 * what it says is "one file is".
 */
export const EDGE_LEGACY_REPORT = /^\/([A-Za-z0-9][A-Za-z0-9._-]{0,180})\/report\.html$/;

/** Anything else meets the host's catch-all `handle { respond "Not found" 404 }`. */
export function servedByEdge(url) {
  let p;
  try { p = new URL(String(url)).pathname; } catch { return false; }
  return EDGE_PORTAL.test(p) || EDGE_LEGACY_REPORT.test(p);
}
