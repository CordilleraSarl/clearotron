// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A scoped access key has ONE door, and it is not the network one (tracker issue 174).
//
// THE DESIGN THESE ARMS EXIST TO PIN. The interface serves two populations with different proofs: people
// through a tunnel with a proxy JWT, and programs on the same box with a scoped key. One authentication
// rule per process meant running it twice, and on the production install collapsing the two cost a silent
// outage — the shared instance was switched to the proxy mode for the desktop path, which took the
// portal's trigger with it, and both sides logged a true sentence that was not the one the operator
// needed.
//
// WHY A LOOPBACK CHECK IS NOT THE ANSWER, which is the whole reason for a socket. The tunnel daemon runs
// ON the box, so a request forwarded from the internet and a request from the local portal arrive with
// the SAME peer address. A peer-IP rule would accept a stolen key replayed through the tunnel and would
// look correct in every test written on a box with no tunnel. The discriminator has to be the transport.
//
// THE REFUSAL IS DRIVEN WITH A REAL KEY, and the issue insists on that for a reason worth restating: a
// synthetic key can be refused for being MALFORMED, which leaves the arm green while never exercising the
// transport rule at all. Every key below is minted by the product's own `mintToken` against the product's
// own secret, so a refusal here can only be about which door it arrived at.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

process.env.TRADEMARK_MCP_TOKEN_SECRET = "a-secret-for-this-test-only";

const { mintToken } = await import("../../shared/scope.mjs");
const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { keyDoorRefusal, openKeyDoor, probeSocket, KEY_SOCKET_MODE } = await import("../key-socket.mjs");

let dir, sockPath, keyDoor, netServer, netPort;
const REAL_KEY = () => mintToken({ scope: "ops", sub: "portal", ttlSec: 3600 });

const deps = () => ({
  limiter: { take: () => true }, opsLimiter: { take: () => true },
  sessions: new Map(), createSession: async () => { throw new Error("no transport in this test"); },
  ns: "trademark-artifacts", log: () => {},
});

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "keydoor-"));
  sockPath = join(dir, "engine.sock");

  // THE KEY DOOR: token-only, no verifier. Built exactly as http-server.mjs builds it.
  keyDoor = await openKeyDoor({
    handler: makeHttpHandler({ ...deps(), verify: null, tokenOnly: true, devMode: false }),
    path: sockPath, log: () => {},
  });

  // THE NETWORK DOOR: a verifier, and no key path at all. Also exactly as http-server.mjs builds it.
  const netHandler = makeHttpHandler({
    ...deps(), tokenOnly: false, devMode: false,
    verify: async () => { throw Object.assign(new Error("no proxy identity on this request"), { status: 401 }); },
  });
  const { createServer } = await import("node:http");
  netServer = createServer(netHandler);
  await new Promise((r) => netServer.listen(0, "127.0.0.1", r));
  netPort = netServer.address().port;
});

after(() => {
  try { keyDoor?.server?.close(); } catch { /* closing */ }
  try { netServer?.close(); } catch { /* closing */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
});

/** POST /mcp carrying a key, over either transport. Resolves { status, body }. */
function post(target, key) {
  const opts = { method: "POST", path: "/mcp", headers: { "content-type": "application/json", authorization: `Bearer ${key}` } };
  return new Promise((resolve, reject) => {
    const req = request(typeof target === "string" ? { ...opts, socketPath: target } : { ...opts, host: "127.0.0.1", port: target }, (res) => {
      let b = ""; res.on("data", (c) => { b += c; }); res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  });
}

// ── the arm that matters ─────────────────────────────────────────────────────────────────────────────

test("174: a REAL access key presented on the network door is refused", async () => {
  const key = REAL_KEY();
  assert.ok(key && key.length > 20, "premise: this is a real minted key, not a placeholder");

  // The same key is accepted on the socket below, so a refusal here cannot be about the key.
  const r = await post(netPort, key);
  assert.equal(r.status, 401, `the network door must not honour a key, got ${r.status}: ${r.body.slice(0, 200)}`);
  assert.doesNotMatch(r.body, /malformed|invalid signature|expired/i,
    "and it must be refused for arriving at this door — not for being a bad key, which would mean this arm never tested the transport rule");
});

test("174: the SAME real key is accepted on the socket", async () => {
  const key = REAL_KEY();
  const r = await post(sockPath, key);
  assert.notEqual(r.status, 401, `the key door refused a valid key: ${r.body.slice(0, 300)}`);
  // Proves the two outcomes above differ ONLY in the transport: one key, one process, two answers.
});

// REFUSAL BY CONSTRUCTION, not by a branch. This is what makes the arm above durable — there is no code
// path on the network handler that reads a key, and the handler refuses to be built with both rules.
test("174: a handler cannot be built that honours both a proxy identity and a key", () => {
  assert.throws(() => makeHttpHandler({ ...deps(), verify: async () => ({ email: "x@y" }), tokenOnly: true }),
    /mutually exclusive|tokenOnly is for a door with no auth proxy/,
    "the two rules cannot be combined, so 'a key on the network door is refused' is not a deletable check");
});

// ── the socket as a filesystem object ────────────────────────────────────────────────────────────────

test("174: the socket's mode says which local accounts may present a key", () => {
  assert.ok(existsSync(sockPath), "the socket exists as a file, which is what makes this checkable");
  const mode = statSync(sockPath).mode & 0o777;
  assert.equal(mode, KEY_SOCKET_MODE, `expected ${KEY_SOCKET_MODE.toString(8)}, got ${mode.toString(8)}`);
  assert.equal(mode & 0o007, 0, "and nothing outside the owner and group may reach it — the point of using a socket");
  assert.equal(keyDoor.mode, mode, "the mode the door reports is the mode on disk, read back rather than assumed");
});

// A tunnel forwards to a PORT. There is no address it can forward to that reaches this file — that is the
// property, and it is a fact about the transport rather than a check anything performs.
test("174: the key door has no network address at all", () => {
  const addr = keyDoor.server.address();
  assert.equal(typeof addr, "string", "a unix socket's address is its path, not a host and port");
  assert.equal(addr, sockPath);
  assert.equal(addr.includes(":"), false, "nothing here is addressable as host:port, so nothing can be forwarded to it");
});

// ── the refusals that bind whatever the transport ────────────────────────────────────────────────────

test("174: the key door refuses to open without a grants file, or beside the auth bypass", () => {
  assert.match(keyDoorRefusal({ authDisabled: true, accessFile: "/tmp/grants.json" }), /authenticates nobody/,
    "a mandatory key and a bypass are contradictory");
  assert.match(keyDoorRefusal({ authDisabled: false, accessFile: "" }), /CLEAROTRON_ACCESS_FILE is unset/,
    "no grants file means no scope resolution — the refusal this door must not lose by living outside the token-mode block");
  assert.equal(keyDoorRefusal({ authDisabled: false, accessFile: "/tmp/grants.json" }), null, "and it opens when both are satisfied");
});

// ── a socket is a file, so a stale one is a real state ───────────────────────────────────────────────

test("174: a live socket is not mistaken for a leftover, and a leftover is not mistaken for a live one", async () => {
  assert.equal(await probeSocket(sockPath), "live", "the door opened above is answering");
  assert.equal(await probeSocket(join(dir, "never-existed.sock")), "absent", "a path with no file");
});

test("174: opening onto a LIVE socket refuses rather than stealing the path", async () => {
  await assert.rejects(
    openKeyDoor({ handler: (_q, s) => s.end(), path: sockPath, log: () => {} }),
    /already serving the key socket/,
    "unlinking unconditionally would silently take the path from a healthy sibling and stop its callers arriving");
});

// ── the WIRING, driven on the real server process ────────────────────────────────────────────────────
//
// Every arm above builds the two handlers the way http-server.mjs builds them. None of them proves that
// http-server.mjs ACTUALLY builds them that way — and a projection that is right while the thing calling
// it is wrong is a defect this repository has shipped before. So: boot the real entrypoint, with the real
// setting, and read the socket off the filesystem.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { pinEnvAll } from "../../shared/env-aliases.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "http-server.mjs");

/** Boot the real server, resolve on the first stderr line matching `re`, then stop it. */
function bootUntil(env, re, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let out = ""; let done = false;
    const child = execFile(process.execPath, [SERVER], { env: pinEnvAll({ ...process.env }, env), timeout: timeoutMs },
      (err, _o, stderr) => { if (!done) { done = true; resolve({ matched: false, stderr: String(stderr) || out }); } });
    child.stderr.on("data", (c) => {
      out += String(c);
      if (!done && re.test(out)) { done = true; resolve({ matched: true, stderr: out, child }); }
    });
  });
}

test("174: the real server opens the key door, and its posture line names the socket and mode", async () => {
  const d = mkdtempSync(join(tmpdir(), "keydoor-boot-"));
  const p = join(d, "engine.sock");
  // THE PROXY MODE, which is the shape this door exists for: a network door taking an identity, and a
  // socket taking a key. Booting this in token mode is now REFUSED — see the arm above — and that
  // refusal is what this test originally tripped over, which is the arm doing its job.
  const r = await bootUntil({
    TRADEMARK_MCP_AUTH_MODE: "cf-access",
    TRADEMARK_MCP_AUTH_DISABLED: "", TRADEMARK_MCP_DEV: "",
    TRADEMARK_MCP_HTTP_HOST: "127.0.0.1", TRADEMARK_MCP_HTTP_PORT: "0",
    TRADEMARK_MCP_ALLOWED_HOSTS: "127.0.0.1:18790",
    CLEAROTRON_ACCESS_FILE: "/tmp/does-not-need-to-exist.json",
    TRADEMARK_MCP_KEY_SOCKET: p,
    CF_ACCESS_TEAM: "a-team", CLEAROTRON_OIDC_AUDIENCE: "an-audience",
    MCP_ALLOWED_EMAIL_DOMAINS: "example.test",   // the identity gate is fail-closed and refuses to start without one
  }, /key door listening on/);

  try {
    assert.ok(r.matched, `the server never opened the key door; stderr:\n${r.stderr}`);
    // The operator-facing half of the acceptance: the socket and its mode are readable without opening a
    // unit file.
    assert.match(r.stderr, /key path: .*engine\.sock \(mode 660 once open\)/, "the posture line names the path and the mode");
    assert.match(r.stderr, /unreachable from any network/, "and says what the transport buys");
    assert.ok(existsSync(p), "the socket is on disk where the line says it is");
    assert.equal(statSync(p).mode & 0o777, KEY_SOCKET_MODE, "with the mode it announced — read back, not assumed");
  } finally {
    try { r.child?.kill(); } catch { /* gone */ }
    try { rmSync(d, { recursive: true, force: true }); } catch { /* gone */ }
  }
});

test("174: a deployment that sets no socket is told it has no key path, rather than left guessing", async () => {
  const r = await bootUntil({
    TRADEMARK_MCP_AUTH_MODE: "token",
    TRADEMARK_MCP_AUTH_DISABLED: "", TRADEMARK_MCP_DEV: "",
    TRADEMARK_MCP_HTTP_HOST: "127.0.0.1", TRADEMARK_MCP_HTTP_PORT: "0",
    TRADEMARK_MCP_ALLOWED_HOSTS: "127.0.0.1:18790",
    CLEAROTRON_ACCESS_FILE: "/tmp/does-not-need-to-exist.json",
    TRADEMARK_MCP_KEY_SOCKET: "",
    CF_ACCESS_TEAM: "", CLEAROTRON_OIDC_AUDIENCE: "",
  }, /key path: none configured/);
  try {
    assert.ok(r.matched, `the absent case must be a line too; stderr:\n${r.stderr}`);
    // Silence here would leave "this deployment has no key path" and "this build lacks the feature"
    // looking identical, which is the confusion the issue is about.
    assert.match(r.stderr, /has no door on this process/);
  } finally { try { r.child?.kill(); } catch { /* gone */ } }
});

// ── what review found, and what each arm would have missed ───────────────────────────────────────────
//
// Three defects, all caught by a second reader rather than by me. Each gets an arm here, because a fix
// with no arm is a fix the next change can undo.

// THE ONE THAT MATTERED. The mutual exclusion in makeHttpHandler is between `verify` and `tokenOnly` on
// ONE handler; it says nothing about two handlers in one process. The TCP handler is built with
// `tokenOnly: TRADEMARK_MCP_AUTH_MODE === "token"`, so token mode plus a socket yields TWO key doors —
// and the TCP one is reachable through the tunnel, which is the whole thing this issue prevents. It is
// also production's current configuration, so it is the upgrade path rather than a contrived case.
test("174: token mode PLUS a socket is refused — otherwise both doors take a key", () => {
  const r = keyDoorRefusal({ authDisabled: false, accessFile: "/tmp/grants.json", authMode: "token" });
  assert.match(r, /makes the NETWORK door take a key/, "the refusal names what would actually be wrong");
  assert.match(r, /unset the mode|unset the socket/, "and tells the operator the two ways out");
  assert.equal(keyDoorRefusal({ authDisabled: false, accessFile: "/tmp/grants.json", authMode: "TOKEN" }), r,
    "the mode is matched however it is spelled — an operator's capitalisation is not a security boundary");
  assert.equal(keyDoorRefusal({ authDisabled: false, accessFile: "/tmp/grants.json", authMode: "cf-access" }), null,
    "and the proxy mode, which is the shape this door is FOR, still opens");
});

// 0660 says who may CONNECT. Who may REPLACE is the containing directory's write bit — a different
// permission entirely, and the one that lets a local account stand up an impostor the portal then hands
// its key to.
test("174: a world-writable directory without the sticky bit is refused", async () => {
  const open = mkdtempSync(join(tmpdir(), "keydoor-open-"));
  chmodSync(open, 0o777);   // world-writable, NOT sticky
  await assert.rejects(
    openKeyDoor({ handler: (_q, s) => s.end(), path: join(open, "engine.sock"), log: () => {} }),
    /world-writable without the sticky bit/,
    "any local account could remove the socket and bind its own listener in its place");

  // THE ORDINARY SHAPE OPENS, and nothing pinned it before — pointed out in review. A service directory
  // at 0770 owned by the service group is the correct deployment, and it is group-writable. Without this
  // arm, somebody tightening the check to refuse group-writable would break every real installation and
  // no test would say so; the two refusal arms above would both still pass.
  //
  // It is allowed by DECISION, not by derivation: it is correct only where every member of that group is
  // already trusted with every key presented at this path. See key-socket.mjs for why the socket's own
  // mode does not establish that.
  chmodSync(open, 0o770);
  const ordinary = await openKeyDoor({ handler: (_q, s) => s.end(), path: join(open, "ordinary.sock"), log: () => {} });
  try { assert.equal(ordinary.mode, KEY_SOCKET_MODE, "a group-writable service directory is the ordinary shape and must open"); }
  finally { try { ordinary.server.close(); } catch { /* closing */ } }

  // The sticky bit is exactly the thing that makes a shared directory safe for this, so it is honoured.
  chmodSync(open, 0o1777);
  const d = await openKeyDoor({ handler: (_q, s) => s.end(), path: join(open, "engine.sock"), log: () => {} });
  try { assert.ok(d.mode === KEY_SOCKET_MODE, "and a sticky directory opens normally"); }
  finally { try { d.server.close(); } catch { /* closing */ } rmSync(open, { recursive: true, force: true }); }
});

// The probe returns four states and only two were acted on. A socket owned by another account answers
// EACCES — neither ENOENT nor ECONNREFUSED — and fell through to `listen`, surfacing as a bare
// EADDRINUSE with no sentence. That is the case the probe exists for.
test("174: a path this process cannot inspect is named, not left to fail as a bare address-in-use", async () => {
  await assert.rejects(
    openKeyDoor({ handler: (_q, s) => s.end(), path: join(dir, "opaque.sock"), log: () => {}, probe: async () => "unknown" }),
    /cannot determine what/,
    "refusing to unlink a path it cannot inspect, and saying why");
});
