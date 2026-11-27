// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY DOOR SERVES BOTH REVISIONS OF THE PROTOCOL.
//
// The protocol's 2026-07-28 revision removes the opening handshake and protocol sessions, and carries authorization on
// every request. Each door now answers both revisions from one stateless handler (lib/mcp-serve.mjs), scoping each
// request from its own key (lib/http-handler.mjs), and the local door decides the revision from the opening message
// (`serveStdio`). This file holds each door, run as its own process, to that:
//   - the staff door and the client door (HTTP). A client of the new revision (the protocol's v2 client, negotiating
//     both) ends on the new revision without ever sending `initialize`, and lists the tools a client of the old
//     revision lists. The old client (SDK v1) is served too, and is handed no session id. Two keys of different reach,
//     sent over one connection, are each answered with their own tool list: there is no session for the second to
//     inherit from the first;
//   - the local door (stdio): the new client ends on the new revision, the old one on the old, and both list the same
//     tools;
//   - a gather server the engine's stages reach (stdio, the shared `serve`): still the older revision only, and a
//     client that asks the new way falls back to it. Its move follows in this branch.
// WHAT THIS DOES NOT PROVE: that any one assistant connects. These are the protocol's reference clients.
// Every name is invented.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a child env writes every spelling
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Client as OldClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as OldHttpTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport as OldStdioTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAFF_DOOR = join(HERE, "..", "http-server.mjs");
const CLIENT_DOOR = join(HERE, "..", "http-server-client.mjs");
const LOCAL_DOOR = join(HERE, "..", "server.mjs");
const GATHER_SERVER = join(HERE, "..", "..", "driver", "engine", "mcp", "probe-server.mjs");

const SECRET = "fallback-door-test-secret-aaaaaaaaaaaaaaaa";
const ROOT = mkdtempSync(join(tmpdir(), "protocol-fallback-"));
const GRANTS = join(ROOT, "grants.json");
writeFileSync(GRANTS, JSON.stringify({
  tenants: { acme: { accounts: ["acme"], users: { "lawyer@acme.example": "*" } } },
}));
process.env.TRADEMARK_MCP_TOKEN_SECRET = SECRET;
const { mintToken } = await import("../lib/scope.mjs");

const BASE_ENV = {
  HOME: ROOT,
  CLEAROTRON_WORK_DIR: join(ROOT, "work"),
  TRADEMARK_MCP_AUDIT_LOG: join(ROOT, "audit.jsonl"),
  TRADEMARK_MCP_TOKEN_SECRET: SECRET,
  CLEAROTRON_ACCESS_FILE: GRANTS,
  CF_ACCESS_TEAM: "", CLEAROTRON_OIDC_AUDIENCE: "", CLEAROTRON_CLIENT_OIDC_AUDIENCE: "",
};
const childEnv = (extra) => pinEnvAll({ ...process.env }, { ...BASE_ENV, ...extra });

const children = [];
after(() => { for (const c of children) { try { c.kill("SIGKILL"); } catch { /* gone */ } } });

/** A port the kernel calls free. The door's allowed-hosts list must name it, so port 0 cannot be handed on. */
async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Start an HTTP door as its own process, and resolve once it says it is listening. */
async function startDoor(file, env) {
  const child = spawn(process.execPath, [file], { env: childEnv(env), stdio: ["ignore", "ignore", "pipe"] });
  children.push(child);
  let said = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the door never listened:\n${said}`)), 30000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => { said += d; if (/listening on http/.test(said)) { clearTimeout(timer); resolve(); } });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`the door exited ${code} before it listened:\n${said}`)); });
  });
  return child;
}

/**
 * Start a door on a port the kernel called free, and on another when something took it first. The port is released
 * before the door binds it, and on a shared runner another job can take it in that gap: the door then refuses, by
 * design, rather than move. Only that refusal is retried; any other exit fails the test as it stands.
 */
async function startDoorOnAFreePort(file, envFor, attempts = 5) {
  for (let i = 1; ; i++) {
    const port = await freePort();
    try { await startDoor(file, envFor(port)); return port; }
    catch (e) { if (i >= attempts || !/is already in use/.test(String(e?.message))) throw e; }
  }
}

/** A fetch that records each request's JSON-RPC method beside the status the door answered it with. */
function recordingFetch(seen) {
  return async (url, init) => {
    let method = null;
    try { const body = JSON.parse(String(init?.body ?? "")); method = Array.isArray(body) ? body.map((m) => m.method).join(",") : body.method ?? null; } catch { /* a GET or DELETE */ }
    const res = await fetch(url, init);
    let error = null;
    if (res.status >= 400) { try { error = (await res.clone().json()).error; } catch { /* not JSON */ } }
    seen.push({ verb: init?.method ?? "GET", method, status: res.status, error });
    return res;
  };
}

/** The tool names a client of the old revision lists at this door, and the session id it was handed, if any. */
async function oldToolNames(transport) {
  const client = new OldClient({ name: "old-revision-client", version: "1" });
  await client.connect(transport);
  try { return (await client.listTools()).tools.map((t) => t.name).sort(); } finally { await client.close(); }
}

/** tools/list sent on its own, in the new revision, with one key: what that key alone may list. */
async function toolsForKey(url, key) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list", "x-trademark-token": key },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "one-request", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }) });
  assert.equal(res.headers.get("mcp-session-id"), null, "the door handed out a session id");
  const text = await res.text();
  const json = JSON.parse(text.startsWith("{") ? text : (text.split("\n").find((l) => l.startsWith("data:")) ?? "data: {}").slice(5));
  assert.ok(json.result?.tools, `tools/list with one key was not answered with tools: ${text.slice(0, 300)}`);
  return json.result.tools.map((t) => t.name).sort();
}

async function newClientAt(transport) {
  const client = new Client({ name: "new-revision-client", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  return client;
}

async function assertHttpDoorServesBoth(url, key, otherKey) {
  const headers = { "x-trademark-token": key };
  const old = new OldHttpTransport(new URL(url), { requestInit: { headers } });
  const want = await oldToolNames(old);
  assert.ok(want.length > 0, "a client of the old revision listed no tools here");
  assert.equal(old.sessionId, undefined, "a client of the old revision was handed a session id");
  const seen = [];
  const client = await newClientAt(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers }, fetch: recordingFetch(seen) }));
  try {
    assert.equal(client.getProtocolEra(), "modern", "a client of the new revision did not end on it");
    const got = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(got, want, "the new revision lists different tools from the old one's");
  } finally { await client.close(); }
  const posts = seen.filter((r) => r.verb === "POST");
  assert.ok(!posts.some((r) => r.method === "initialize"), `a client of the new revision was made to send the old handshake: ${JSON.stringify(posts)}`);
  assert.ok(posts.every((r) => r.status === 200), `a request in the new revision was refused: ${JSON.stringify(posts)}`);
  // ONE CONNECTION, TWO KEYS, TWO ANSWERS: each request is scoped from its own key.
  const mine = await toolsForKey(url, key), theirs = await toolsForKey(url, otherKey);
  assert.deepEqual(mine, want, "one key alone lists what that key's client lists");
  assert.notDeepEqual(theirs, mine, "a second key on the same connection was answered with the first key's reach");
}

/** What a stdio server answers to a probe sent before any handshake. */
async function answerToProbe(file, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { env: childEnv(env), stdio: ["pipe", "pipe", "ignore"] });
    children.push(child);
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("no answer to the probe: the client would wait for its timeout before falling back")); }, 15000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      clearTimeout(timer);
      child.kill("SIGKILL");
      try { resolve(JSON.parse(buf.slice(0, nl))); } catch (e) { reject(e); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover",
      params: { protocolVersion: "2026-07-28", clientInfo: { name: "probe", version: "1" }, capabilities: {} } }) + "\n");
  });
}

async function assertStdioServerServesBoth(file, env) {
  const params = { command: process.execPath, args: [file], env: childEnv(env), stderr: "ignore" };
  const want = await oldToolNames(new OldStdioTransport(params));
  assert.ok(want.length > 0, "a client of the old revision listed no tools here");
  const client = await newClientAt(new StdioClientTransport(params));
  try {
    assert.equal(client.getProtocolEra(), "modern", "a client of the new revision did not end on it");
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), want);
  } finally { await client.close(); }
}

async function assertStdioServerFallsBack(file, env) {
  const answer = await answerToProbe(file, env);
  assert.equal(answer.id, 1);
  assert.equal(answer.error?.code, -32601, `the probe was answered ${JSON.stringify(answer)}; method-not-found is the answer the client falls back on`);
  const params = { command: process.execPath, args: [file], env: childEnv(env), stderr: "ignore" };
  const want = await oldToolNames(new OldStdioTransport(params));
  assert.ok(want.length > 0, "a client of the old revision listed no tools here");
  const client = await newClientAt(new StdioClientTransport(params));
  try {
    assert.equal(client.getProtocolEra(), "legacy", "the client did not end on the old revision");
    assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), want);
  } finally { await client.close(); }
}

test("the staff door serves the new revision and the old one, without sessions, each request in its own key's scope", async () => {
  const port = await startDoorOnAFreePort(STAFF_DOOR, (port) => ({
    TRADEMARK_MCP_AUTH_MODE: "token", TRADEMARK_MCP_AUTH_DISABLED: "", TRADEMARK_MCP_DEV: "",
    TRADEMARK_MCP_HTTP_HOST: "127.0.0.1", TRADEMARK_MCP_HTTP_PORT: String(port), TRADEMARK_MCP_ALLOWED_HOSTS: `127.0.0.1:${port}`,
  }));
  await assertHttpDoorServesBoth(`http://127.0.0.1:${port}/mcp`, mintToken({ scope: "ops", sub: "fallback-test", ttlSec: 600 }),
    mintToken({ scope: "user", runId: "tmpx-velloquin-2026-11-27-slate-heron", ttlSec: 600 }));
});

test("the client door serves the new revision and the old one, without sessions, each request in its own key's scope", async () => {
  const port = await startDoorOnAFreePort(CLIENT_DOOR, (port) => ({
    CLIENT_MCP_TOKEN_ONLY: "1", CLIENT_MCP_ACCOUNT_ACCESS: "1", CLIENT_MCP_AUTH_DISABLED: "", CLIENT_MCP_DEV: "",
    CLIENT_MCP_HTTP_HOST: "127.0.0.1", CLIENT_MCP_HTTP_PORT: String(port), CLIENT_MCP_ALLOWED_HOSTS: `127.0.0.1:${port}`,
  }));
  await assertHttpDoorServesBoth(`http://127.0.0.1:${port}/mcp`,
    mintToken({ scope: "account", sub: "lawyer@acme.example", accounts: ["acme"], ttlSec: 600 }),
    mintToken({ scope: "user", runId: "tmpx-velloquin-2026-11-27-slate-heron", ttlSec: 600 }));
});

test("the local door serves the new revision and the old one", async () => {
  await assertStdioServerServesBoth(LOCAL_DOOR, {});
});

test("a gather server: a probe before the handshake is method-not-found, and the client falls back and lists the tools", async () => {
  await assertStdioServerFallsBack(GATHER_SERVER, {});
});
