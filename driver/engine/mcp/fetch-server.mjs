#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine/mcp/fetch-server.mjs — engine-local URL-fetch MCP server for the OPENAI (codex) engine. codex has
// NO built-in WebFetch tool (claude does), so the caselaw group's EUR-Lex leg — which the claude path serves
// with claude's built-in WebFetch — needs a tiny local fetch tool under codex. Glue over public-fetch.mjs
// (the same serve() scaffolding as the other gather servers), which fetches public addresses only and
// refuses loopback, private, link-local and cloud-metadata ones by the address a name resolves to. Read-only
// GET only; the body is truncated to a sane cap so a huge page cannot blow the turn context. Mounted by
// codex-config.mjs whenever the stage's allowedTools carry WebFetch (i.e. the caselaw group). Runs as a child
// of the engine process, under whatever user that is. The offline suite proves the refusals against local
// servers, which the tool refuses as loopback, and never reaches the internet.
import { serve } from "./stdio-server.mjs";
import { fetchPublic } from "./public-fetch.mjs";

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
    // PUBLIC ADDRESSES ONLY (public-fetch.mjs): loopback, private, link-local and cloud-metadata
    // addresses are refused by the address a name resolves to, on the first request and on every redirect.
    handler: async ({ url }) => {
      if (!url || !/^https?:\/\//i.test(String(url))) return { isError: true, text: "fetch_url: a valid absolute http(s) url is required" };
      try {
        const res = await fetchPublic(url, { timeoutMs: TIMEOUT_MS });
        if (res.refused) return { isError: true, text: `fetch_url refused ${url}: ${res.refused}. This tool fetches public addresses only.` };
        const body = res.text;
        const text = body.length > MAX_CHARS ? body.slice(0, MAX_CHARS) + `\n…[truncated at ${MAX_CHARS} chars]` : body;
        return { isError: res.ok ? undefined : true, text: `HTTP ${res.status} ${res.statusText} — ${url}\n\n${text}` };
      } catch (e) {
        return { isError: true, text: `fetch_url error for ${url}: ${e?.message ?? e}` };
      }
    },
  }],
});
