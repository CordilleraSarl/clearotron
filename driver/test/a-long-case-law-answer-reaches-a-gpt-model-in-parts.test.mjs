// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the case-law bridge against a local stand-in for a case-law source
//
// A LONG CASE-LAW ANSWER REACHES A GPT MODEL IN PARTS, AND THE SOURCE IS ASKED ONCE.
//
// Case-law sources answer through the OAuth bridge, not through serve(), so the bridge keeps the same size
// (shared/answer-parts.mjs): given an answer size, a longer answer is served in parts under it, the whole
// held in the bridge, and a later part is read from it without asking the source again. Given no size, the
// answer passes through as the source sent it. The real bridge process, over stdio, proxying a local
// stand-in; all text is invented.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ANSWER_PART_ARG, quotedBytes } from "../../shared/answer-parts.mjs";
import { codexToolAnswerBytes } from "../engine/mcp/codex-config.mjs";

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "providers", "oauth-mcp-bridge", "bridge.mjs");
const SOURCE = "courtlistener";
const SIZE = codexToolAnswerBytes({});
const DECISIONS = Array.from({ length: 700 }, (_, i) => `Qzxv Beverages v. Holder ${i}, No. ${1000 + i} (invented court, 2019): `
  + `a dispute over a mark for mineral waters, decided on the likelihood of confusion.`).join("\n");
let asked = 0;

function standIn() {
  const s = new Server({ name: "case-law-stand-in", version: "0.0.1" }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "search", description: "search", inputSchema: { type: "object", properties: { q: { type: "string" } } } }] }));
  s.setRequestHandler(CallToolRequestSchema, async () => { asked++; return { content: [{ type: "text", text: DECISIONS }] }; });
  return s;
}

const readBody = (req) => new Promise((resolve, reject) => {
  let d = "";
  req.on("data", (c) => (d += c));
  req.on("end", () => resolve(d ? JSON.parse(d) : undefined));
  req.on("error", reject);
});

let upstream, dir;
const clients = [];
async function bridge(env) {
  const client = new Client({ name: "long-answer-arm", version: "0.0.1" }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [BRIDGE, "--server", SOURCE, "--creds-dir", dir],
    env: { ...process.env, ...env }, stderr: "ignore",
  }));
  clients.push(client);
  return client;
}

before(async () => {
  const sessions = new Map();
  upstream = http.createServer(async (req, res) => {
    try {
      const sid = req.headers["mcp-session-id"];
      if (req.method === "POST") {
        const body = await readBody(req);
        let t;
        if (sid && sessions.has(sid)) t = sessions.get(sid);
        else if (!sid && isInitializeRequest(body)) {
          t = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => sessions.set(id, t) });
          t.onclose = () => t.sessionId && sessions.delete(t.sessionId);
          await standIn().connect(t);
        } else { res.writeHead(400).end(); return; }
        await t.handleRequest(req, res, body);
      } else if (sid && sessions.has(sid)) await sessions.get(sid).handleRequest(req, res);
      else res.writeHead(400).end();
    } catch { if (!res.headersSent) res.writeHead(500).end(); }
  });
  const port = await new Promise((r) => upstream.listen(0, "127.0.0.1", () => r(upstream.address().port)));
  dir = mkdtempSync(join(tmpdir(), "caselaw-long-answer-"));
  writeFileSync(join(dir, `${SOURCE}.json`), JSON.stringify({
    serverName: SOURCE, serverUrl: `http://127.0.0.1:${port}/mcp`, scope: "openid api",
    clientInfo: { client_id: "x", client_secret: "y", token_endpoint_auth_method: "client_secret_post" },
    tokens: { access_token: "fake-valid", refresh_token: "fake-refresh", token_type: "Bearer", expires_in: 3600 },
  }), { mode: 0o600 });
});

after(async () => {
  for (const c of clients) { try { await c.close(); } catch { /* the bridge exits when its stdin closes */ } }
  upstream?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const bodyOf = (served) => served.slice(served.indexOf("]\n") + 2, served.lastIndexOf("\n[end of part"));

test("given the answer size, the bridge hands a long case-law answer over in parts, whole, asking the source once", async () => {
  const client = await bridge({ CLEAROTRON_TOOL_ANSWER_BYTES: String(SIZE) });
  asked = 0;
  const first = (await client.callTool({ name: "search", arguments: { q: "qzxv" } })).content[0].text;
  const total = Number(first.match(/^\[search answer part 1\/(\d+) — /)?.[1]);
  assert.ok(total >= 2, `a long answer was not served in parts: ${first.slice(0, 120)}`);
  const served = [first];
  for (let p = 2; p <= total; p++) served.push((await client.callTool({ name: "search", arguments: { q: "qzxv", [ANSWER_PART_ARG]: p } })).content[0].text);
  assert.ok(served.every((t) => quotedBytes(t) <= SIZE), "a part ran over the size");
  assert.equal(served.map(bodyOf).join(""), DECISIONS, "the parts together are the answer");
  assert.equal(asked, 1, "a later part asked the source again");
  const listed = (await client.listTools()).tools;
  assert.equal(listed.find((t) => t.name === "search").inputSchema.properties[ANSWER_PART_ARG].type, "number");
});

test("THE CONTROL: given no answer size, the bridge passes the answer through as the source sent it", async () => {
  const client = await bridge({});
  const whole = await client.callTool({ name: "search", arguments: { q: "qzxv" } });
  assert.equal(whole.content[0].text, DECISIONS);
  assert.equal((await client.listTools()).tools.find((t) => t.name === "search").inputSchema.properties[ANSWER_PART_ARG], undefined);
});
