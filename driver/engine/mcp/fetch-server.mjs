#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/mcp/fetch-server.mjs — engine-local URL-fetch MCP server for the OPENAI (codex) engine. codex has
// NO built-in WebFetch tool (claude does), so the caselaw group's EUR-Lex leg — which the claude path serves
// with claude's built-in WebFetch — needs a tiny local fetch tool under codex. ~pure glue over global fetch
// (the same serve() scaffolding as the other gather servers). Read-only GET only; the body is truncated to a
// sane cap so a huge page cannot blow the turn context. Mounted by codex-config.mjs whenever the stage's
// allowedTools carry WebFetch (i.e. the caselaw group). (Runs in the engine process, under whatever user
// that is. The $0 offline suite exercises no live fetch — undici breaks under the constrained ulimits that
// suite runs with — so engine.fetch-server.test.mjs proves the transport against a host that never resolves.)
import { serve } from "./stdio-server.mjs";

const MAX_CHARS = 200000;   // step 3 — was a knob; no environment ever set it
const TIMEOUT_MS = 30000;   // step 3 — was a knob; no environment ever set it

serve({
  name: "fetch", version: "0.1.0",
  tools: [{
    name: "fetch_url",
    description: "Fetch a public URL over HTTP(S) GET and return the response body as text (read-only). Use for public sources such as EUR-Lex.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "The absolute http(s) URL to fetch." } },
      required: ["url"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: async ({ url }) => {
      if (!url || !/^https?:\/\//i.test(String(url))) return { isError: true, text: "fetch_url: a valid absolute http(s) url is required" };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { redirect: "follow", signal: ctrl.signal, headers: { "user-agent": "cordillera-prelim-fetch/0.1" } });
        const body = await res.text();
        const text = body.length > MAX_CHARS ? body.slice(0, MAX_CHARS) + `\n…[truncated at ${MAX_CHARS} chars]` : body;
        return { isError: res.ok ? undefined : true, text: `HTTP ${res.status} ${res.statusText} — ${url}\n\n${text}` };
      } catch (e) {
        return { isError: true, text: `fetch_url error for ${url}: ${e?.message ?? e}` };
      } finally { clearTimeout(timer); }
    },
  }],
});
