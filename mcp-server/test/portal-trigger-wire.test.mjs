// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-trigger-wire.test.mjs — the portal's MCP client speaks the REAL ops HTTP face
// (initialize → tools/call over /mcp) with an accounts-scoped token, and start_run lands a queue file
// with the server-stamped identity. This pins the WIRE SHAPE against the face's own makeHttpHandler —
// the previous bare-REST /tools/start_run target existed on no HTTP face, and an injected-trigger unit
// test could never have caught it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ROOT = mkdtempSync(join(tmpdir(), "wire-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "wire-test-secret";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { mcpToolCall } = await import("../../driver/portal-mcp-client.mjs");

async function createSession(sessions, scope = { kind: "internal", runId: null }, owner = null) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const server = makeServer({ scope, local: false });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => sessions.set(id, { server, transport, lastSeen: Date.now(), email: owner, sub: scope?.sub ?? null, kind: scope?.kind ?? null }),
  });
  transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
  await server.connect(transport);
  return transport;
}

test("wire: mcpToolCall → real /mcp face → start_run queues with server-stamped identity; foreign account refused upstream", async () => {
  const sessions = new Map();
  const handler = makeHttpHandler({ verify: null, devMode: true, limiter: new RateLimiter({ perMinute: 200 }),
    sessions, createSession, ns: "wire-test" });
  const srv = createServer(handler);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const token = mintToken({ scope: "ops", sub: "portal-poc", verbs: ["start_run", "stop_run"], accounts: ["aurora"] });
  try {
    const r = await mcpToolCall({ url, token, tool: "start_run", args: {
      profileKey: "aurora", forwarder: "portal", forwarderEmail: "cli@celta.example",
      markName: "WIREMARK", classes: [9], goods: "software",
    } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.queued && r.queuePath, "start_run answered through the MCP transport");
    const job = JSON.parse(readFileSync(r.queuePath, "utf8"));
    assert.equal(job.profileKey, "aurora");
    assert.equal(job.enqueuedBy, "portal-poc", "attribution = the ops token's sub, stamped by the face");
    assert.equal(job.enqueuedVia, "mcp/start_run");
    // an account OUTSIDE the token's grant is refused by the face's authorize chokepoint
    await assert.rejects(
      () => mcpToolCall({ url, token, tool: "start_run", args: { profileKey: "zephyr", forwarder: "portal", markName: "X", classes: [9] } }),
      /FORBIDDEN|grant/i, "the confused-deputy bound holds at the face");
    // scoped sessions must name profileKey — the domain-resolution bypass is closed at the door
    await assert.rejects(
      () => mcpToolCall({ url, token, tool: "start_run", args: { forwarder: "portal", forwarderDomain: "acme.example", markName: "X", classes: [9] } }),
      /profileKey explicitly|does not include account "generic"/, "untagged jobs are not available to scoped tokens (refused at the face gate or the ops door)");
  } finally {
    for (const [, e] of sessions) { try { e.transport.close(); } catch { /* */ } try { e.server?.close?.(); } catch { /* */ } }
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});
