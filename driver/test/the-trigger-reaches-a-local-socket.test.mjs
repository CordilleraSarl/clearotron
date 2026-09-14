// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PORTAL'S TRIGGER CAN DIAL THE ENGINE'S LOCAL KEY DOOR.
//
// The engine serves an identity door on a port and a key door on a unix socket from one process. A
// deployment needing both used to run the process twice; the attempt to collapse that by switching modes
// rather than adding a transport cost an outage. The transport now exists and the portal could not
// address it — its client composed one string for the address and the request path, and its lane check
// refused any address carrying a path, which every socket address does.
//
// DRIVEN OVER A REAL SOCKET, not asserted against the shape of an options object. What matters is that
// three requests of a handshake all arrive at the same door, carrying a Host that a socket cannot supply
// by itself — and a mock of the client would prove none of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpToolCall, dialTarget } from "../portal-mcp-client.mjs";
import { triggerLaneVerdict } from "../../shared/trigger-lane.mjs";

test("the socket path and the request path are resolved apart, for both address forms", () => {
  // THE TRAP THIS SHAPE EXISTS TO AVOID. Composed as one string, a socket address becomes
  // `unix:/run/x.sock/mcp` — a file that does not exist — and the failure arrives as a connect error
  // naming a path nobody configured.
  const sock = dialTarget("unix:/run/clearotron/engine.sock", "/mcp");
  assert.equal(sock.socketPath, "/run/clearotron/engine.sock", "the socket is dialled at its own path");
  assert.equal(sock.path, "/mcp", "and the request still asks for /mcp");
  // The header is ours rather than the runtime's. Measured: Node already sends `Host: localhost` over a
  // socket, so this asserts who DECIDED the value, not that the request carries one — the arm below
  // would pass either way, and saying so is the difference between a test and a claim.
  assert.equal(sock.headers.host, "localhost", "the client sets the Host itself rather than inheriting a default");

  const net = dialTarget("http://127.0.0.1:18793/", "/mcp");
  assert.equal(net.socketPath, null);
  assert.equal(net.host, "127.0.0.1");
  assert.equal(net.path, "/mcp", "a trailing slash on the origin does not double the path");
  assert.equal(dialTarget("https://engine.example", "/mcp").port, 443, "https defaults its port");

  // The two forms must differ in the field that decides how the socket is opened, or this is one case
  // asserted twice.
  assert.notEqual(Boolean(sock.socketPath), Boolean(net.socketPath));
});

test("a whole tool call completes over a real unix socket", async () => {
  const dir = mkdtempSync(join(tmpdir(), "trigger-sock-"));
  const path = join(dir, "engine.sock");
  const seen = [];
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const msg = JSON.parse(body || "{}");
      seen.push({ path: req.url, host: req.headers.host, token: req.headers["x-trademark-token"], method: msg.method });
      if (msg.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }));
      }
      if (msg.method === "tools/call") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: '{"queueId":"q-7"}' }] } }));
      }
      res.writeHead(202); res.end("");
    });
  });
  await new Promise((r) => server.listen(path, r));
  try {
    const out = await mcpToolCall({ url: `unix:${path}`, token: "k-abc", tool: "start_run", args: { markName: "X" } });
    assert.deepEqual(out, { queueId: "q-7" }, "the call's own result comes back through the socket");

    // EVERY REQUEST OF THE HANDSHAKE, not just the first. The address is resolved once for exactly this
    // reason: re-parsed per call, a divergence shows up as a session that initializes and is then not found.
    assert.equal(seen.length, 3, `the handshake is three requests; the socket saw ${seen.length}`);
    for (const r of seen) {
      assert.equal(r.path, "/mcp", "every request asks the door for /mcp");
      // NOT discriminating on its own — Node supplies this default — and kept because a server that
      // started refusing an absent Host would fail here rather than in a deployment.
      assert.equal(r.host, "localhost", "every request carries a Host");
      assert.equal(r.token, "k-abc", "and the key, which is the whole reason this door exists");
    }
    assert.deepEqual(seen.map((r) => r.method), ["initialize", "notifications/initialized", "tools/call"]);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("the lane reports a socket address as reachable, and still catches a half-wired one", () => {
  const ok = triggerLaneVerdict({ url: "unix:/run/x.sock", hasToken: true });
  assert.equal(ok.state, "ok", "a socket with a key is a wired lane, not an unprobed one");
  assert.match(ok.message, /local socket \/run\/x\.sock/, "and the operator is told which socket");

  // THE HALF-WIRED CASE STILL FIRES. Returning early for a socket must not skip the check that catches
  // an address with no credential — that is the state where the portal knows where to call and cannot
  // authenticate, and the Start button fails at the door.
  assert.equal(triggerLaneVerdict({ url: "unix:/run/x.sock", hasToken: false }).state, "fail");

  // And the origin rule it now returns before is untouched for a network address.
  assert.equal(triggerLaneVerdict({ url: "http://127.0.0.1:18793/mcp", hasToken: true }).state, "fail");
  assert.equal(triggerLaneVerdict({ url: "http://127.0.0.1:18793", hasToken: true }).state, "unprobed");
});
