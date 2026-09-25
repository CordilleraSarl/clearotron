// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the case-law bridge against a local stand-in for a case-law source
//
// A case-law source that answers with an error has not answered, in the bridge's call log and on the report.
//
// THE DEFECT. The report says "none found" for a case-law pass with no citation only when a query came back
// with hits, or when a case-law source's call log shows a call it answered. The bridge logged every call
// that returned as answered. Under MCP a tool reports its own failure, a quota or an outage behind the
// server, inside its result as `isError: true`, and the call returns. So a source answering every query
// with an error would have printed "none found".
//
// THE PATH IS DRIVEN WHOLE: the real bridge process, over stdio, proxying a local stand-in that answers one
// call and refuses another inside its result; the call log the bridge writes into the run; and the court
// state read from that log beside a record whose every query is at 0.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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
import { driverDir } from "../../shared/driver-dir.mjs";
import { CASELAW_BRIDGES } from "../engine/mcp/gather-config.mjs";
import { courtDecisionsState, caseLawPassRecord } from "../publish/search-depth.mjs";

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "providers", "oauth-mcp-bridge", "bridge.mjs");
const SOURCE = "courtlistener";
const REFUSAL = "quota exceeded for this key";

// The stand-in source: `search` answers, unless asked to fail, and then it says so inside its result.
function standIn() {
  const s = new Server({ name: "case-law-stand-in", version: "0.0.1" }, { capabilities: { tools: {} } });
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "search", description: "search", inputSchema: { type: "object" } }] }));
  s.setRequestHandler(CallToolRequestSchema, async (req) => (req.params.arguments?.fail
    ? { isError: true, content: [{ type: "text", text: REFUSAL }] }
    : { content: [{ type: "text", text: "0 decisions" }] }));
  return s;
}

const readBody = (req) => new Promise((resolve, reject) => {
  let d = "";
  req.on("data", (c) => (d += c));
  req.on("end", () => resolve(d ? JSON.parse(d) : undefined));
  req.on("error", reject);
});

let upstream, dir, runDir, client;
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
  dir = mkdtempSync(join(tmpdir(), "caselaw-error-answer-"));
  runDir = join(dir, "run");
  writeFileSync(join(dir, `${SOURCE}.json`), JSON.stringify({
    serverName: SOURCE, serverUrl: `http://127.0.0.1:${port}/mcp`, scope: "openid api",
    clientInfo: { client_id: "x", client_secret: "y", token_endpoint_auth_method: "client_secret_post" },
    tokens: { access_token: "fake-valid", refresh_token: "fake-refresh", token_type: "Bearer", expires_in: 3600 },
  }), { mode: 0o600 });
  client = new Client({ name: "error-answer-arm", version: "0.0.1" }, { capabilities: {} });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [BRIDGE, "--server", SOURCE, "--creds-dir", dir],
    env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir }, stderr: "ignore",
  }));
});

after(async () => {
  try { await client?.close(); } catch { /* the bridge exits when its stdin closes */ }
  upstream?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const logRows = () => readFileSync(driverDir(runDir, "reading-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("the bridge logs an error answer as a failed call, with its words, and a real answer as answered", async () => {
  assert.ok(CASELAW_BRIDGES.includes(SOURCE), "the stand-in speaks for a case-law source the court state counts");
  const answered = await client.callTool({ name: "search", arguments: { q: "an ordinary query" } });
  const refused = await client.callTool({ name: "search", arguments: { q: "a query", fail: true } });
  assert.notEqual(answered.isError, true);
  assert.equal(refused.isError, true, "the error answer still reaches the caller as the source sent it");
  const rows = logRows();
  assert.equal(rows.length, 2, "one row per call");
  assert.deepEqual(rows.map((r) => [r.tool, r.ok]), [[`${SOURCE}__search`, true], [`${SOURCE}__search`, false]]);
  assert.equal(rows[1].error, REFUSAL, "the source's own words are kept");
});

test("a pass whose source only refused reads could not be completed; an answered call reads none found", () => {
  const zeros = JSON.stringify({ schema_version: 1, queries: [{ query: "q", jurisdiction: "US", results: 0 }], citations: [] });
  const attempts = JSON.stringify({ attempt: 1, ok: true }) + "\n";
  const words = "**No on-point precedent found.**";
  const [ok, refusedRow] = readFileSync(driverDir(runDir, "reading-log.jsonl"), "utf8").trim().split("\n");
  const state = (log) => courtDecisionsState(words, caseLawPassRecord({ attemptsJsonl: attempts, ledgerRaw: zeros, readingLogJsonl: log, bridges: CASELAW_BRIDGES }));
  assert.equal(state(refusedRow), "not-checked", "a source that answered only with an error has not answered");
  assert.equal(state(ok), "none-found", "the control: a call the source answered is the sign it was reached");
});
