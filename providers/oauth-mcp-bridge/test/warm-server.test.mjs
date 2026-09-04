// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — this workspace ships an HTTP door and had no test CI has ever run.
//
// `warm-server.mjs` is a streamable-HTTP MCP face designed to be reached remotely. Its coverage was a
// script at `providers/oauth-mcp-bridge/test/warm-server.smoke.mjs` — DELETED by this change, and
// named in full here only so a reader can find where the coverage went, and to explain why
// this file exists. It was wired to no npm script and matched no runner's glob
// (`test:providers` globs `*.test.mjs`), so nothing executed it. It carried the malformed-Host defect
// of and CI would not have caught that in either direction — not when it arrived and
// not if it came back.
//
// The script worked. What it could not do is report: five assertions inside one `main()` collapse to one
// pass/fail, so the census recorded 1 test where five claims live and a failure named no assertion.
// Those five are separate arms here, and the door's real guarantee has gained the control it never had.
//
// PORTS ARE OBTAINED, NEVER FIXED. The script hardcoded 18898/18899, and this runner runs files
// concurrently on a box that also hosts live instances — a fixed-port fixture there is a flake waiting
// for a busy afternoon, and a flake in the only arm covering a door is worse than no arm.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WARM = path.join(HERE, "..", "warm-server.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long the mock holds a call open. Long enough that overlap is observable — see the control arm. */
const HOLD_MS = 60;

// ── the mock upstream ─────────────────────────────────────────────────────────────────────────────
//
// A loopback streamable-HTTP MCP server with no auth, recording how many upstream calls are open at
// once. `inFlight`/`maxInFlight` are mutable module state, so THE ARMS BELOW MUST RUN IN ORDER: the
// control fills maxInFlight and the serialization arm resets it. node:test runs subtests inside a
// describe sequentially by default; adding `concurrency` here would make the serialization arm read
// the control's traffic and the reset meaningless.
let inFlight = 0;
let maxInFlight = 0;

function buildMockServer() {
  const s = new Server({ name: "mock-upstream", version: "0.0.1" }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "search", description: "allowed", inputSchema: { type: "object" } },
      { name: "get_counts", description: "allowed", inputSchema: { type: "object" } },
      { name: "read_document", description: "NOT allowlisted", inputSchema: { type: "object" } },
    ],
  }));
  s.setRequestHandler(CallToolRequestSchema, async (req) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(HOLD_MS);
    inFlight--;
    return { content: [{ type: "text", text: `ok:${req.params.name}` }] };
  });
  return s;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d ? JSON.parse(d) : undefined));
    req.on("error", reject);
  });
}

/** Listens on port 0 and reports the port the OS actually gave — the house idiom, and raceless. */
async function startMockUpstream() {
  const sessions = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const sid = req.headers["mcp-session-id"];
      if (req.method === "POST") {
        const body = await readJson(req);
        let t;
        if (sid && sessions.has(sid)) t = sessions.get(sid);
        else if (!sid && isInitializeRequest(body)) {
          t = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => sessions.set(id, t),
          });
          t.onclose = () => t.sessionId && sessions.delete(t.sessionId);
          await buildMockServer().connect(t);
        } else { res.writeHead(400).end(); return; }
        await t.handleRequest(req, res, body);
      } else if (sid && sessions.has(sid)) {
        await sessions.get(sid).handleRequest(req, res);
      } else res.writeHead(400).end();
    } catch { if (!res.headersSent) res.writeHead(500).end(); }
  });
  const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
  return { server, port };
}

/** A port nothing is listening on right now. The child cannot report the port it bound — see below. */
async function obtainPort() {
  const probe = net.createServer();
  const port = await new Promise((r) => probe.listen(0, "127.0.0.1", () => r(probe.address().port)));
  await new Promise((r) => probe.close(r));
  return port;
}

async function connectClient(port) {
  const client = new Client({ name: "warm-server-arms", version: "0.0.1" }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return client;
}

let mock, credsDir, child, bridge, childExit = null, childErr = "";

describe("the OAuth bridge's warm HTTP door", () => {
  before(async () => {
    mock = await startMockUpstream();
    credsDir = await mkdtemp(path.join(tmpdir(), "warm-arms-"));
    await writeFile(path.join(credsDir, "courtlistener.json"), JSON.stringify({
      serverName: "courtlistener",
      serverUrl: `http://127.0.0.1:${mock.port}/mcp`,
      scope: "openid api",
      clientInfo: { client_id: "x", client_secret: "y", token_endpoint_auth_method: "client_secret_post" },
      tokens: { access_token: "fake-valid", refresh_token: "fake-refresh", token_type: "Bearer", expires_in: 3600 },
    }), { mode: 0o600 });

    // ── READINESS IS A CONNECTION, NOT A LOG LINE ────────────────────────────────────────────────
    //
    // The script waited for "serving streamable-http" on stderr. warm-server.mjs logs the port it was
    // GIVEN rather than the one it bound (the class is open for), so that line
    // appears whether or not the bind succeeded — and with an obtained port, a lost race is exactly the
    // realistic failure. So the door is proven up by speaking MCP to it.
    //
    // The child's exit is watched separately, so "the door never came up" and "the port was taken"
    // cannot arrive as the same red. A could-not-run reported as a disagreement is how a whole
    // afternoon goes into the wrong half of a problem.
    for (let attempt = 1; attempt <= 3 && !bridge; attempt++) {
      const port = await obtainPort();
      childExit = null; childErr = "";
      child = spawn(process.execPath,
        [WARM, "--server", "courtlistener", "--port", String(port), "--creds-dir", credsDir],
        { stdio: ["ignore", "ignore", "pipe"] });
      child.stderr.on("data", (b) => { childErr += b.toString(); });
      child.on("exit", (code, signal) => { childExit = signal ?? code; });

      for (let i = 0; i < 60 && !bridge; i++) {
        if (childExit !== null) break;                       // it died — try a fresh port
        try { bridge = await connectClient(port); } catch { await sleep(100); }
      }
      if (!bridge) { child.kill("SIGKILL"); child = null; }
    }
    assert.ok(bridge,
      "the warm server never answered MCP on any of three obtained ports. This is a COULD-NOT-RUN, not "
      + `a disagreement — the door was never reached, so nothing below was measured. child exit: `
      + `${childExit}; stderr:\n${childErr.slice(-1200)}`);
  });

  after(async () => {
    try { await bridge?.close(); } catch { /* the door is going away anyway */ }
    child?.kill("SIGKILL");
    mock?.server.close();
    if (credsDir) await rm(credsDir, { recursive: true, force: true });
  });

  test("1933 the door is up and speaks MCP", () => {
    // Asserted by `before` having connected at all. Stated as its own arm so a door that never came up
    // names itself in the report rather than appearing as four unrelated failures.
    assert.ok(bridge, "no MCP client — the door did not come up");
    assert.equal(childExit, null, `the warm server exited (${childExit}) instead of serving:\n${childErr.slice(-800)}`);
  });

  test("1933 the allowlisted upstream tools are proxied through", async () => {
    const names = ((await bridge.listTools()).tools ?? []).map((t) => t.name).sort();
    assert.ok(names.includes("search"), `\`search\` is missing from the proxied list: ${JSON.stringify(names)}`);
    assert.ok(names.includes("get_counts"), `\`get_counts\` is missing from the proxied list: ${JSON.stringify(names)}`);
  });

  test("1933 an upstream tool that is NOT allowlisted does not reach the caller", async () => {
    const names = ((await bridge.listTools()).tools ?? []).map((t) => t.name);
    assert.ok(!names.includes("read_document"),
      "the mock upstream offers `read_document` and the bridge passed it through — the allowlist is the "
      + `only thing standing between a caller and every tool the upstream has: ${JSON.stringify(names)}`);
  });

  test("1933 a tools/call reaches the upstream and its answer comes back", async () => {
    const call = await bridge.callTool({ name: "get_counts", arguments: {} });
    assert.match(JSON.stringify(call), /ok:get_counts/,
      `the call did not reach the mock upstream, or its reply was not returned: ${JSON.stringify(call)}`);
  });

  // ── THE CONTROL FOR THE ARM BELOW, AND IT IS NOT OPTIONAL ────────────────────────────────────────
  //
  // The serialization arm asserts `maxInFlight === 1`, which is true when the bridge serializes AND
  // true when eight calls simply never overlapped — on a loaded box, eight client sends can spread past
  // the mock's hold window and the arm reports a guarantee it never witnessed. That is a timing
  // assertion behaving as a load meter, in the direction that fakes a pass.
  //
  // So the same eight calls go STRAIGHT AT THE MOCK first. If they overlap, the fixture can observe
  // overlap and the next arm's `=== 1` means something. If they do not, the measurement is impossible
  // here and this says so instead of letting the next arm pass blind.
  test("1933 CONTROL: without the bridge in the way, eight calls DO overlap upstream", async () => {
    const direct = await connectClient(mock.port);
    try {
      maxInFlight = 0;
      await Promise.all(Array.from({ length: 8 }, () => direct.callTool({ name: "search", arguments: {} })));
      assert.ok(maxInFlight > 1,
        `eight concurrent calls straight at the mock produced max ${maxInFlight} in flight. This fixture `
        + `cannot observe overlap at all, so the serialization arm below would pass without witnessing `
        + `anything. Raise HOLD_MS (currently ${HOLD_MS}ms) or treat this run as unmeasurable — do not `
        + `read the next arm as evidence.`);
    } finally { await direct.close(); }
  });

  test("1933 through the bridge, the same eight calls are serialized upstream", async () => {
    // THE GUARANTEE THE WHOLE DOOR EXISTS FOR. Two refreshes racing is what bricks a warm token — the
    // reuse the mutex prevents — so "many downstream callers, one upstream call at a time" is the
    // property, not an implementation detail.
    maxInFlight = 0;
    await Promise.all(Array.from({ length: 8 }, () => bridge.callTool({ name: "search", arguments: {} })));
    assert.equal(maxInFlight, 1,
      `eight concurrent downstream calls produced ${maxInFlight} concurrent upstream calls. The bridge's `
      + "mutex is what stops two refreshes racing and bricking the token; the arm above proves this "
      + "fixture can see overlap when it happens, so this is a real reading.");
  });
});
