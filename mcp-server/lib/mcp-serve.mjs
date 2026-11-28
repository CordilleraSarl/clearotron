// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// lib/mcp-serve.mjs — one MCP request, answered on its own, in whichever revision of the protocol it was sent in.
//
// THE PROTOCOL'S 2026-07-28 REVISION HAS NO OPENING HANDSHAKE AND NO SESSIONS (2026-11-27). Every request carries what
// the older revision negotiated once, and authorization rides every request. So a door no longer keeps a session per
// caller: lib/http-handler.mjs authenticates and scopes EACH request, and hands it here with its scope. SDK v2's
// `createMcpHandler` then serves it: a request in the new revision directly, and one in the older revision statelessly,
// from a server built for that one request. An older client's GET stream and DELETE are answered 405, which the SDK's
// own older client takes in its stride (measured 2026-11-27, SDK 1.32.2 and Claude Code 2.1.326).
//
// The server for a request is built from its scope by `serverFor`, so a second key on the same connection gets its own
// scope, never an earlier key's: there is nothing held between requests for it to inherit.
import { createMcpHandler } from "@modelcontextprotocol/server";

/** A Node request's headers as a fetch `Headers`. */
function headersOf(req) {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    if (v == null) continue;
    h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  return h;
}

/**
 * `serverFor(scope)` → a fresh MCP server for one request. Returns `(req, res, { body, scope, email }) => Promise`, the
 * `serve` lib/http-handler.mjs calls once it has authenticated and scoped the request.
 */
export function mcpServe(serverFor, { onerror = null } = {}) {
  const handler = createMcpHandler((ctx) => serverFor(ctx.authInfo?.extra?.scope ?? null), { legacy: "stateless", ...(onerror ? { onerror } : {}) });
  return async (req, res, { body, scope, email = null }) => {
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method, headers: headersOf(req),
      body: req.method === "POST" && body !== undefined ? JSON.stringify(body) : undefined,
    });
    const answer = await handler.fetch(request, {
      authInfo: { token: "", clientId: String(email ?? ""), scopes: [], extra: { scope } },
      ...(body !== undefined ? { parsedBody: body } : {}),
    });
    if (res.headersSent) return;
    res.writeHead(answer.status, Object.fromEntries(answer.headers));
    if (answer.body) for await (const chunk of answer.body) res.write(chunk);
    res.end();
  };
}
