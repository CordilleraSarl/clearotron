// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// listen-port-in-use.test.mjs —. What every service that binds a port does when the port is taken.
//
// There was no coverage of this at all: `grep -rn EADDRINUSE` over the tree returned exactly one hit,
// and it was production code (bin/example.mjs). Starting the product twice, or on a box where something
// already holds 18794 / 18801 / 18802, produced
//
//     Error: listen EADDRINUSE: address already in use 127.0.0.1:18802
//         at Server.setupListenHandle [as _listen2] (node:net:1908:16)
//
// — the failure named and no remedy, from an uncaught exception.
//
// ── WHY THE SERVICES ARE SPAWNED AND NOT STUBBED ─────────────────────────────────────────────────
//
// Same argument portal-service-boot.test.mjs makes for the grants guard: a unit test of the helper
// tests the helper. What has to be true is that THIS process, started with a port already held, does
// not end up listening and does not print a stack. The only honest way to assert that is to start it
// and look — a call site that forgot to route through the helper passes every unit test.
//
// So both halves are here: the helper's own contract, and the four call sites actually wired to it.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "listen-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __mkdtemp(__join(__tmpdir(), "listen-pool-")));
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "listen-test-token-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { listenOrDie, listenErrorMessage } = await import("../../shared/listen.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, "..");

/** Hold a real port for the duration of a test, and hand back its number. */
async function holdPort() {
  const squatter = createServer(() => {});
  const port = await new Promise((r) => squatter.listen(0, "127.0.0.1", () => r(squatter.address().port)));
  return { port, release: () => new Promise((r) => squatter.close(r)) };
}

/**
 * Start a service and report how it ended. Adapted from portal-service-boot.test.mjs's `boot`.
 *
 * Killed the moment it announces a listener: reaching that line is itself the failure these tests
 * screen for, and a service left running past the end of a test is a port leak into the next one.
 */
function boot(script, overrides, { waitMs = 20000 } = {}) {
  const env = { ...process.env, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete env[k];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, waitMs);
    const sawListen = () => /listening on|archive index →/.test(stderr + stdout);
    child.stderr.on("data", (c) => { stderr += String(c); if (sawListen()) { try { child.kill("SIGKILL"); } catch { /* gone */ } } });
    child.stdout.on("data", (c) => { stdout += String(c); if (sawListen()) { try { child.kill("SIGKILL"); } catch { /* gone */ } } });
    child.on("exit", (code, signal) => finish({ code, signal, stderr, stdout, listened: sawListen() }));
    child.on("error", (e) => finish({ code: null, signal: null, stderr: stderr + String(e), stdout, listened: false }));
  });
}

// A Node stack frame: "    at Server.setupListenHandle (node:net:1908:16)". The whole point of the
// helper is that an operator never sees one of these for a taken port, so it is asserted ABSENT rather
// than left to a human reading the output once.
const STACK_FRAME = /^\s+at\s.+:\d+:\d+\)?$/m;

// ── the helper's own contract ──────────────────────────────────────────────────────────────────────

test("#773 the EADDRINUSE sentence names the port, the likely cause, the way to look, and the way to move it", () => {
  const m = listenErrorMessage({ code: "EADDRINUSE" }, { what: "profile-service", host: "127.0.0.1", port: 18794, portVar: "PROFILE_PORT" });
  assert.match(m, /18794/, "the port");
  assert.match(m, /127\.0\.0\.1:18794/, "the full address, not just the number");
  assert.match(m, /already in use/i);
  assert.match(m, /second copy of profile-service/i, "what is probably holding it — the first-run cause");
  assert.match(m, /ss -ltnp|lsof/, "how to find out what actually holds it");
  assert.match(m, /PROFILE_PORT/, "the variable that moves it, NAMED — not 'the port variable'");
  assert.doesNotMatch(m, STACK_FRAME);
});

test("#773 it says it will NOT move to another port, because something in front of it is addressed here", () => {
  // The tempting fix is a retry loop like bin/example.mjs's. For a SERVICE that is the wrong answer: a
  // portal that quietly moved off PORTAL_SERVICE_PORT leaves the tunnel pointing at the old address,
  // the health check passing against whatever answers there, and the operator debugging a proxy.
  const m = listenErrorMessage({ code: "EADDRINUSE" }, { what: "the portal service", host: "127.0.0.1", port: 18802, portVar: "PORTAL_SERVICE_PORT" });
  assert.match(m, /NOT quietly move/i);
});

test("#773 EACCES on a privileged port is its own answer, not the in-use one", () => {
  const m = listenErrorMessage({ code: "EACCES" }, { what: "the portal service", host: "0.0.0.0", port: 443, portVar: "PORTAL_SERVICE_PORT" });
  assert.match(m, /privileged/i);
  assert.match(m, /443/);
  assert.doesNotMatch(m, /already in use/i, "a permission failure reported as a collision sends the reader to kill the wrong thing");
});

test("#773 an address this host does not have is named as that, and an unknown code still gets a sentence", () => {
  const notThere = listenErrorMessage({ code: "EADDRNOTAVAIL" }, { what: "x", host: "10.9.9.9", port: 1234, portVar: "X_PORT" });
  assert.match(notThere, /not an address on this machine/i);
  // The default arm matters most: an unrecognised bind failure must not fall through to a stack trace.
  const unknown = listenErrorMessage({ code: "EPERM", message: "operation not permitted" }, { what: "x", host: "127.0.0.1", port: 1234, portVar: "X_PORT" });
  assert.match(unknown, /EPERM/);
  assert.match(unknown, /operation not permitted/);
  assert.match(unknown, /Refusing to start/i);
});

test("#773 listenOrDie exits non-zero on a taken port and never calls onReady", async () => {
  const held = await holdPort();
  try {
    const codes = [];
    const said = [];
    let ready = false;
    listenOrDie(createServer(() => {}), {
      port: held.port, host: "127.0.0.1", what: "test-service", portVar: "TEST_PORT",
      log: (m) => said.push(m), onReady: () => { ready = true; }, exit: (c) => codes.push(c),
    });
    await new Promise((r) => setTimeout(r, 250));
    assert.deepEqual(codes, [1], "exit(1) exactly once");
    assert.equal(ready, false, "the success callback must never run for a bind that failed");
    assert.match(said.join("\n"), new RegExp(String(held.port)));
    assert.match(said.join("\n"), /TEST_PORT/);
  } finally { await held.release(); }
});

test("#773 listenOrDie on a FREE port is an ordinary listen — the success half is the helper's too", async () => {
  const codes = [];
  const server = createServer(() => {});
  const ready = new Promise((r) => {
    listenOrDie(server, {
      port: 0, host: "127.0.0.1", what: "test-service", portVar: "TEST_PORT",
      log: () => {}, onReady: () => r(server.address().port), exit: (c) => codes.push(c),
    });
  });
  const port = await ready;
  assert.ok(port > 0, "it listened");
  assert.deepEqual(codes, [], "nothing exited");
  await new Promise((r) => server.close(r));
});

// ── the four call sites, started for real ──────────────────────────────────────────────────────────

/** Everything portal-service refuses to start without, minus the port, which each test supplies. */
function portalEnv(port) {
  const grants = join(mkdtempSync(join(tmpdir(), "listen-grants-")), "grants.json");
  writeFileSync(grants, JSON.stringify({ tenants: {} }));
  return {
    PORTAL_AUTH_MODE: "local",
    PORTAL_LOCAL_USER: "dev@local",
    PORTAL_LOCAL_CREDENTIAL: join(mkdtempSync(join(tmpdir(), "listen-cred-")), "credential.json"),
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    PORTAL_SECRET: "listen-test-secret",
    PORTAL_STAFF_DOMAINS: "example-firm.com",
    CLEAROTRON_ACCESS_FILE: grants,
    CLEAROTRON_REPORTS_DIR: mkdtempSync(join(tmpdir(), "listen-pool-")),
    CLEAROTRON_WORK_DIR: mkdtempSync(join(tmpdir(), "listen-ws-")),
    PORTAL_SERVICE_HOST: "127.0.0.1",
    PORTAL_SERVICE_PORT: String(port),
  };
}

/** recipe-service refuses a store outside its repo root, so both are pointed at one temp tree. */
function recipeEnv(port) {
  const root = mkdtempSync(join(tmpdir(), "listen-reciperoot-"));
  const dir = join(root, "recipes");
  mkdirSync(dir, { recursive: true });
  return {
    RECIPE_AUTH_DISABLED: "1", RECIPE_DEV: "1",
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    CLEAROTRON_RECIPES_DIR: dir, RECIPE_REPO_ROOT: root,
    RECIPE_HOST: "127.0.0.1", RECIPE_PORT: String(port),
  };
}

/** — profile-service now refuses a store outside its repo root too, so both are pointed at one
 *  temp tree, exactly as recipeEnv above. Before this it inherited the PRODUCT CHECKOUT as its repo root
 *  and a /tmp store was outside it — which is the misconfiguration that cost 19 hours on the test box. */
function profileEnv(port) {
  const root = mkdtempSync(join(tmpdir(), "listen-profileroot-"));
  const dir = join(root, "profiles");
  mkdirSync(dir, { recursive: true });
  return {
    PROFILE_AUTH_DISABLED: "1", PROFILE_DEV: "1",
    CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
    CLEAROTRON_CUSTOMERS_DIR: dir, PROFILE_REPO_ROOT: root,
    PROFILE_HOST: "127.0.0.1", PROFILE_PORT: String(port),
  };
}

const CALL_SITES = [
  { name: "portal-service", script: join(DRIVER, "portal-service.mjs"), env: portalEnv, portVar: "PORTAL_SERVICE_PORT" },
  { name: "profile-service", script: join(DRIVER, "profile-service.mjs"), env: profileEnv, portVar: "PROFILE_PORT" },
  { name: "recipe-service", script: join(DRIVER, "recipe-service.mjs"), env: recipeEnv, portVar: "RECIPE_PORT" },
  { name: "dev-portal", script: join(DRIVER, "dev-portal.mjs"), env: (p) => ({ PORTAL_HOST: "127.0.0.1", PORTAL_PORT: String(p) }), portVar: "PORTAL_PORT" },
];

for (const site of CALL_SITES) {
  test(`#773 ${site.name} on a taken port: exit 1, names the port and ${site.portVar}, NO stack trace`, async () => {
    const held = await holdPort();
    try {
      const r = await boot(site.script, site.env(held.port));
      const out = r.stderr + r.stdout;
      assert.equal(r.listened, false, `it must not end up listening\n${out}`);
      assert.equal(r.code, 1, `expected exit(1); got code=${r.code} signal=${r.signal}\n${out}`);
      assert.match(out, new RegExp(String(held.port)), "the message names the port that is taken");
      assert.match(out, /already in use/i);
      assert.match(out, new RegExp(site.portVar), "…and the variable that moves it");
      // The regression this whole issue is about. A stack trace here means a listener was created
      // somewhere that did not route through the helper.
      assert.doesNotMatch(out, STACK_FRAME, `a stack trace reached the operator:\n${out}`);
    } finally { await held.release(); }
  });
}

// ── — the three listeners left behind ────────────────────────────────────────────────────
//
// `mcp-server` and `providers/oauth-mcp-bridge` are separate npm workspaces, which is why stopped
// at the driver's four. That was a sequencing reason and not a design one, and leaving three of seven
// listeners on the old behaviour was worse than either state on its own: the tree carried two
// conventions for the same thing.
//
// THE CASES LIVE HERE, IN THE DRIVER'S SUITE, and not in each workspace's own. `holdPort`, `boot` and
// STACK_FRAME are the machinery, and copying them into mcp-server/test/ to keep each case beside its
// service would put three copies of a port-collision harness in the tree — the same drift argument
// shared/listen.mjs makes about four bind handlers. The scripts are spawned by absolute path, so which
// suite runs them decides nothing about what is being asserted. `node` resolves the workspace imports
// from the hoisted root either way.
const MCP_SITES = [
  {
    name: "the MCP staff surface", script: join(DRIVER, "..", "mcp-server", "http-server.mjs"),
    portVar: "TRADEMARK_MCP_HTTP_PORT",
    env: (port) => {
      const grants = join(mkdtempSync(join(tmpdir(), "listen-mcp-grants-")), "grants.json");
      writeFileSync(grants, JSON.stringify({ tenants: {} }));
      return {
        TRADEMARK_MCP_HTTP_HOST: "127.0.0.1", TRADEMARK_MCP_HTTP_PORT: String(port),
        TRADEMARK_MCP_AUTH_DISABLED: "1", TRADEMARK_MCP_DEV: "1",
        CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
        CLEAROTRON_ACCESS_FILE: grants,
        CLEAROTRON_REPORTS_DIR: mkdtempSync(join(tmpdir(), "listen-mcp-pool-")),
        CLEAROTRON_WORK_DIR: mkdtempSync(join(tmpdir(), "listen-mcp-ws-")),
      };
    },
  },
  {
    name: "the client MCP surface", script: join(DRIVER, "..", "mcp-server", "http-server-client.mjs"),
    portVar: "CLIENT_MCP_HTTP_PORT",
    env: (port) => ({
      CLIENT_MCP_HTTP_HOST: "127.0.0.1", CLIENT_MCP_HTTP_PORT: String(port),
      CLIENT_MCP_AUTH_DISABLED: "1", CLIENT_MCP_DEV: "1",
      CF_ACCESS_TEAM: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined, CLEAROTRON_OIDC_AUDIENCE: undefined,
      TRADEMARK_MCP_TOKEN_SECRET: "listen-test-token-secret",
      CLEAROTRON_REPORTS_DIR: mkdtempSync(join(tmpdir(), "listen-cmcp-pool-")),
      CLEAROTRON_WORK_DIR: mkdtempSync(join(tmpdir(), "listen-cmcp-ws-")),
    }),
  },
];

for (const site of MCP_SITES) {
  test(`#808 ${site.name} on a taken port: exit 1, names the port and ${site.portVar}, NO stack trace`, async () => {
    const held = await holdPort();
    try {
      const r = await boot(site.script, site.env(held.port));
      const out = r.stderr + r.stdout;
      assert.equal(r.listened, false, `it must not end up listening\n${out}`);
      assert.equal(r.code, 1, `expected exit(1); got code=${r.code} signal=${r.signal}\n${out}`);
      assert.match(out, new RegExp(String(held.port)), "the message names the port that is taken");
      assert.match(out, /already in use/i);
      assert.match(out, new RegExp(site.portVar), "…and the variable that moves it");
      assert.doesNotMatch(out, STACK_FRAME, `a stack trace reached the operator:\n${out}`);
    } finally { await held.release(); }
  });
}

// ── the third listener, which CANNOT be spawned, and why that is stated rather than skipped ─────────
//
// `warm-server.mjs` binds at the END of main(), after it has loaded OAuth credentials from disk and
// connected upstream. With no credentials it exits at `loadCreds` and never reaches the bind, so the
// spawn-it-against-a-held-port standard the other six meet is not available to it here: the repo cannot
// hold a working OAuth credential and should not.
//
// So this asserts the wiring instead, and says so rather than leaving a gap that looks like coverage.
// It is genuinely weaker — it proves the call site routes through the helper, not that the process
// behaves — and the difference is the reason this comment is longer than the test.
test("#808 the OAuth bridge routes its bind through the helper, and names its FLAG rather than a variable", () => {
  const src = readFileSync(join(DRIVER, "..", "providers", "oauth-mcp-bridge", "warm-server.mjs"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(code, /listenOrDie\(httpServer/, "the bind must go through the helper, not httpServer.listen");
  assert.doesNotMatch(code, /httpServer\.listen\(/, "a second, unguarded bind survived");
  // This bridge takes --port and reads NO environment variable for it. `listenErrorMessage` renders
  // whichever it is given, so a copied `portVar` here would print a remedy naming a variable that does
  // not exist — a wrong instruction is worse than the stack trace it replaced.
  assert.match(code, /portFlag:\s*"--port"/);
  assert.match(code, /portVar:\s*null/);
  const m = listenErrorMessage({ code: "EADDRINUSE" },
    { what: "the courtlistener MCP bridge", host: "127.0.0.1", port: 18790, portVar: null, portFlag: "--port" });
  assert.match(m, /pass --port <free port>/, "the remedy names the flag");
  assert.doesNotMatch(m, /set .*=<free port>/, "and does not invent a variable");
});

test("#808 every listener in the tree is accounted for — a new one is not silently unguarded", () => {
  // The census, so an eighth service cannot arrive with the old behaviour and no test. `.listen(` is
  // searched for directly: the helper is the only place it is allowed to appear outside a test.
  const roots = [join(DRIVER, "portal-service.mjs"), join(DRIVER, "profile-service.mjs"),
    join(DRIVER, "recipe-service.mjs"), join(DRIVER, "dev-portal.mjs"),
    join(DRIVER, "..", "mcp-server", "http-server.mjs"), join(DRIVER, "..", "mcp-server", "http-server-client.mjs"),
    join(DRIVER, "..", "providers", "oauth-mcp-bridge", "warm-server.mjs")];
  const offenders = [];
  for (const p of roots) {
    const code = readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    // dev-portal.mjs keeps a raw listen inside startPortal ON PURPOSE — bin/example.mjs reads the rejected
    // error's code to scan for a free port, and the CLI gate formats it through listenErrorMessage. It
    // is the documented exception and the test below pins that contract.
    if (p.endsWith("dev-portal.mjs")) continue;
    // — the binding line itself. A service file can be long and can call
    // .listen once; naming only the path leaves the reader to find which call it meant.
    if (/\.listen\(/.test(code) && !/listenOrDie\(/.test(code)) {
      const hit = code.split("\n").find((l) => /\.listen\(/.test(l))?.trim().slice(0, 110) ?? "";
      offenders.push(`${p}  ${hit}`);
    }
  }
  assert.deepEqual(offenders, [],
    `these bind a port without routing through shared/listen.mjs, so a collision is an uncaught `
    + `exception again:\n  ${offenders.join("\n  ")}`);
});

// ── the contract bin/example.mjs depends on ───────────────────────────────────────────────────────────

test("#773 startPortal still REJECTS with code EADDRINUSE — bin/example.mjs's port scan reads that code", async () => {
  // example.mjs:140-143 tries twenty ports and only continues when `e.code === "EADDRINUSE"`. If the fix
  // had been put inside startPortal — retrying, or exiting — that loop would be dead code and
  // `npm run example` would change behaviour silently. The handling lives in the CLI gate instead, and
  // this is the assertion that keeps it there.
  const held = await holdPort();
  try {
    const { startPortal } = await import("../dev-portal.mjs");
    await assert.rejects(
      () => startPortal({ port: held.port, host: "127.0.0.1" }),
      (e) => { assert.equal(e.code, "EADDRINUSE", "the raw code, not a reworded message"); return true; },
    );
  } finally { await held.release(); }
});
