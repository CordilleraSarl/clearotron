// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CLIENT OF THE NEW PROTOCOL FALLS BACK AT EVERY DOOR.
//
// The protocol's 2026-07-28 revision removes the opening handshake and the session our doors are built on. A client
// that speaks both revisions asks the new way first, with `server/discover`, and falls back to the old handshake when
// the answer is not a new-revision one. Every door here speaks only the old revision, so that fallback is what lets
// such a client reach this product today. This file holds each door to it, through the protocol's own v2 client in
// its probing mode, against the door run as its own process:
//   - the staff door and the client door (HTTP). A keyed probe is refused with 400 and a body whose `error` is a
//     sentence, not a JSON-RPC error object. The client reads that as "not the new revision" and falls back. A 401 or
//     403 there would be fatal to the client rather than a fallback, so each probe carries a valid key. That order,
//     the key accepted and then the 400, is the contract this file pins;
//   - the local door (stdio) and a gather server the engine's stages reach (stdio, the shared `serve`). Each answers
//     a probe sent before the handshake with -32601, method not found. The client also falls back on a probe that
//     times out or closes, so each arm asserts that answer directly, as well as the connection it leads to.
// In every arm the client ends on the old revision, and lists the same tools a client of the old revision lists.
//
// WHAT THIS DOES NOT PROVE: that any one assistant falls back. This is the protocol's reference client; an assistant
// that asks only the new way, and never falls back, would still not connect.
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

/** The tool names a client of the old revision lists at this door: what the fallback must reach. */
async function oldToolNames(transport) {
  const client = new OldClient({ name: "old-revision-client", version: "1" });
  await client.connect(transport);
  try { return (await client.listTools()).tools.map((t) => t.name).sort(); } finally { await client.close(); }
}

async function newClientAt(transport) {
  const client = new Client({ name: "new-revision-client", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  return client;
}

async function assertHttpDoorFallsBack(url, key) {
  const headers = { "x-trademark-token": key };
  const want = await oldToolNames(new OldHttpTransport(new URL(url), { requestInit: { headers } }));
  assert.ok(want.length > 0, "a client of the old revision listed no tools here");
  const seen = [];
  const client = await newClientAt(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers }, fetch: recordingFetch(seen) }));
  try {
    assert.equal(client.getProtocolEra(), "legacy", "the client did not end on the old revision");
    const got = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(got, want, "the fallback reached a different tool list from the old revision's");
  } finally { await client.close(); }
  const posts = seen.filter((r) => r.verb === "POST");
  assert.equal(posts[0]?.method, "server/discover", `the client did not ask the new way first: ${JSON.stringify(posts)}`);
  assert.equal(posts[0].status, 400, `the probe was answered ${posts[0].status}; only a 400 lets the client fall back`);
  assert.equal(typeof posts[0].error, "string", "the probe's refusal is no longer a sentence; a JSON-RPC error object there can end the client's connection");
  assert.equal(posts[1]?.method, "initialize", `after the refusal the client did not fall back to the handshake: ${JSON.stringify(posts)}`);
  assert.equal(posts[1].status, 200);
  assert.ok(posts.some((r) => r.method === "tools/list" && r.status === 200), "the tools were never listed over the fallback");
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

test("the staff door: a keyed probe is refused with a 400 sentence, and the client falls back and lists the tools", async () => {
  const port = await startDoorOnAFreePort(STAFF_DOOR, (port) => ({
    TRADEMARK_MCP_AUTH_MODE: "token", TRADEMARK_MCP_AUTH_DISABLED: "", TRADEMARK_MCP_DEV: "",
    TRADEMARK_MCP_HTTP_HOST: "127.0.0.1", TRADEMARK_MCP_HTTP_PORT: String(port), TRADEMARK_MCP_ALLOWED_HOSTS: `127.0.0.1:${port}`,
  }));
  await assertHttpDoorFallsBack(`http://127.0.0.1:${port}/mcp`, mintToken({ scope: "ops", sub: "fallback-test", ttlSec: 600 }));
});

test("the client door: a company's keyed probe is refused with a 400 sentence, and the client falls back and lists the tools", async () => {
  const port = await startDoorOnAFreePort(CLIENT_DOOR, (port) => ({
    CLIENT_MCP_TOKEN_ONLY: "1", CLIENT_MCP_ACCOUNT_ACCESS: "1", CLIENT_MCP_AUTH_DISABLED: "", CLIENT_MCP_DEV: "",
    CLIENT_MCP_HTTP_HOST: "127.0.0.1", CLIENT_MCP_HTTP_PORT: String(port), CLIENT_MCP_ALLOWED_HOSTS: `127.0.0.1:${port}`,
  }));
  await assertHttpDoorFallsBack(`http://127.0.0.1:${port}/mcp`,
    mintToken({ scope: "account", sub: "lawyer@acme.example", accounts: ["acme"], ttlSec: 600 }));
});

test("the local door: a probe before the handshake is method-not-found, and the client falls back and lists the tools", async () => {
  await assertStdioServerFallsBack(LOCAL_DOOR, {});
});

test("a gather server: a probe before the handshake is method-not-found, and the client falls back and lists the tools", async () => {
  await assertStdioServerFallsBack(GATHER_SERVER, {});
});
