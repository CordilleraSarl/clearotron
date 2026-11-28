// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The portal → engine wire.
//
// This is the ONE link between a person pressing Start and a search actually beginning, and until this
// file existed it had no test at all — while a comment in portal-service.mjs claimed "the wire shape is
// pinned by a test against the face's own makeHttpHandler". It was not. The only way anyone would have
// discovered a broken handshake was a customer pressing Start and watching it fail, and the cheapest
// reproduction of that costs about forty dollars.
//
// So these drive the REAL mcpToolCall over a REAL loopback socket, against a face stubbed at the tool
// boundary. In the protocol's 2026-07-28 revision ONE request is the whole exchange (2026-11-27): no
// handshake and no session. What is under test is that one request — its revision, method and tool in
// its headers, the handshake's facts in `_meta`, the token on it — and the two encodings an answer may come in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mcpToolCall } from "../portal-mcp-client.mjs";

/**
 * A real MCP face, stubbed at the tool boundary only.
 *
 * The tool records what it was called with, so the test can assert the ARGUMENTS survived the trip, not
 * merely that a call happened. `posts` records every request the face received, to pin that one is all it takes.
 */
async function face({ toolResult = { ok: true, queued: true }, isError = false, sse = false, refuse = null } = {}) {
  const { makeHttpHandler } = await import("../../mcp-server/lib/http-handler.mjs");
  const calls = [], posts = [];

  // The MCP SDK's server object is heavier than this test needs, so the wire contract is honoured
  // directly below. The handler is built as the ops face builds it, to keep its construction under test.
  const handler = makeHttpHandler({
    verify: null,
    devMode: true,               // loopback service door — exactly the prod ops face's configuration
    limiter: { take: () => true },
    serve: async () => {},
    log: () => {},
  });

  // makeHttpHandler owns the transport; for the tool dispatch we wrap it so the stub can answer.
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    let msg = {};
    try { msg = JSON.parse(body || "{}"); } catch { /* the handler's own 400 path */ }
    if (req.method === "POST") posts.push(msg.method ?? null);

    // The real face serves ONLY /mcp and 404s everything else (http-handler.mjs). The stub has to do
    // the same or it silently accepts paths production would reject — which would make the URL-contract
    // test below pass while the misconfiguration it exists to catch shipped anyway.
    if (new URL(req.url, "http://x").pathname !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not found — the MCP endpoint is /mcp" }));
    }

    // — `refuse: {on, status}` makes the face answer a transport-layer refusal instead of serving the call.
    if (refuse && refuse.on === msg.method) {
      res.writeHead(refuse.status, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: refuse.body ?? "ops principal rate limit exceeded — retry shortly" }));
    }
    if (msg.method === "tools/call") {
      // The new revision's request, asserted here so a client that forgot a part fails loudly instead of
      // working against this stub and failing against the real door, which refuses headers and a body
      // that disagree.
      assert.equal(req.headers["mcp-protocol-version"], "2026-07-28", "the request names its revision");
      assert.equal(req.headers["mcp-method"], "tools/call", "the request names its method in Mcp-Method");
      assert.equal(req.headers["mcp-name"], msg.params?.name, "the request names its tool in Mcp-Name");
      assert.equal(msg.params?._meta?.["io.modelcontextprotocol/protocolVersion"], "2026-07-28", "the handshake's facts ride the request");
      assert.equal(req.headers["mcp-session-id"], undefined, "no session id: the revision has no sessions");
      assert.ok(req.headers["x-trademark-token"], "the scoped token rides the request");
      calls.push({ name: msg.params?.name, args: msg.params?.arguments, token: req.headers["x-trademark-token"] });
      const payload = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(toolResult) }], ...(isError ? { isError: true } : {}) } };
      if (sse) {
        // The transport may answer either way, and the client has to cope with both. A client that only
        // parsed JSON would work in tests and fail against the live face, or the reverse.
        res.writeHead(200, { "content-type": "text/event-stream" });
        return res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(payload));
    }
    res.writeHead(404); res.end();
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  void handler;
  return { url, calls, posts, close: () => new Promise((r) => server.close(r)) };
}

test("THE WIRE: a start_run reaches the engine with its arguments intact", async () => {
  const f = await face();
  try {
    const out = await mcpToolCall({
      url: f.url, token: "tok-abc", tool: "start_run",
      args: { id: "portal-x1", profileKey: "demo-brand-owner", markName: "AQUAPLUS", classes: [9, 42], goods: "software" },
    });
    assert.deepEqual(out, { ok: true, queued: true }, "the tool's JSON payload is returned parsed");
    assert.equal(f.calls.length, 1, "exactly ONE run is started — never two from one press");
    assert.deepEqual(f.posts, ["tools/call"], "one request is the whole exchange: no handshake before it");
    assert.equal(f.calls[0].name, "start_run");
    assert.equal(f.calls[0].token, "tok-abc");
    // The arguments are what decide scope and therefore cost. A trip that silently dropped `classes`
    // would run a narrower search than the customer confirmed and paid for.
    assert.deepEqual(f.calls[0].args, {
      id: "portal-x1", profileKey: "demo-brand-owner", markName: "AQUAPLUS", classes: [9, 42], goods: "software",
    });
  } finally { await f.close(); }
});

test("an event-stream answer parses identically to a JSON one", async () => {
  // The live face answers tools/call as text/event-stream. A client tested only against JSON would pass
  // every test here and fail on the first real press.
  const f = await face({ sse: true });
  try {
    const out = await mcpToolCall({ url: f.url, token: "t", tool: "start_run", args: { id: "x" } });
    assert.deepEqual(out, { ok: true, queued: true });
  } finally { await f.close(); }
});

test("an upstream refusal THROWS rather than returning a queued-looking object", async () => {
  // isError with a human message is how the face refuses — a verb-scope refusal arrives exactly this
  // way. Returning it as a value would let the portal report "queued" for a run that never started,
  // which is the one lie the whole confirmation flow exists to prevent.
  const f = await face({ toolResult: "FORBIDDEN (start_run): this ops token is verb-scoped to [read]", isError: true });
  try {
    await assert.rejects(
      () => mcpToolCall({ url: f.url, token: "t", tool: "start_run", args: { id: "x" } }),
      /refused upstream.*verb-scoped/s,
    );
  } finally { await f.close(); }
});

test("THE URL CONTRACT: the caller passes an ORIGIN — /mcp is appended, never doubled", async () => {
  // A configured value of "http://host:18790/mcp" would become "/mcp/mcp" and 404 on the first press.
  // This is a configuration mistake the code cannot detect at startup, so it is pinned here instead.
  const f = await face();
  try {
    await mcpToolCall({ url: f.url, token: "t", tool: "start_run", args: { id: "x" } });
    assert.equal(f.calls.length, 1, "the origin form works");
  } finally { await f.close(); }

  const g = await face();
  try {
    await assert.rejects(
      () => mcpToolCall({ url: `${g.url}/mcp`, token: "t", tool: "start_run", args: { id: "x" } }),
      /tools\/call refused \(404\)/,
      "a URL that already ends in /mcp must fail LOUDLY, not silently start nothing",
    );
  } finally { await g.close(); }
});

test("a trailing slash on the configured origin is tolerated", async () => {
  const f = await face();
  try {
    await mcpToolCall({ url: `${f.url}/`, token: "t", tool: "start_run", args: { id: "x" } });
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

test("a dead engine surfaces as an error, never as a silent success", async () => {
  // Nothing is listening. The portal's route turns this into its 502 "nothing was started" — the point
  // here is only that it THROWS rather than resolving.
  await assert.rejects(
    () => mcpToolCall({ url: "http://127.0.0.1:1", token: "t", tool: "start_run", args: { id: "x" }, timeoutMs: 2000 }),
    (e) => e instanceof Error,
  );
});

// ──: A TRANSPORT REFUSAL CARRIES ITS STATUS CODE ──────────────────────────────────────────────
//
// The E2E harness has to tell "the server is rate-limiting us" from "this job is out of product scope",
// and until this landed its only evidence was formatted English. The status is on the error now.
test("a 429 on the call throws with .status and .transport, not just a sentence", async () => {
  const g = await face({ refuse: { on: "tools/call", status: 429 } });
  try {
    const err = await mcpToolCall({ url: g.url, token: "t", tool: "start_run", args: { id: "x" } })
      .then(() => null, (e) => e);
    assert.ok(err, "a 429 must not resolve");
    assert.equal(err.status, 429, "the status code rides the error — the caller must not have to regex the message");
    assert.equal(err.transport, true, "marked as transport: the tool never ran, so its verdict is UNKNOWN and not 'no'");
    assert.match(err.message, /tools\/call refused \(429\)/);
  } finally { await g.close(); }
});

test("a 5xx is transport too — the door died before it could judge anything", async () => {
  const g = await face({ refuse: { on: "tools/call", status: 503, body: "upstream unavailable" } });
  try {
    const err = await mcpToolCall({ url: g.url, token: "t", tool: "start_run", args: { id: "x" } })
      .then(() => null, (e) => e);
    assert.equal(err.status, 503);
    assert.equal(err.transport, true);
  } finally { await g.close(); }
});
