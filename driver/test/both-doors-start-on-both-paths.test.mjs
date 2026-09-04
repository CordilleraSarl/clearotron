// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — F26. Owner ruling, restated several times in session: START BOTH.
//
// The ruling already held on the systemd path — the client door is in SERVER_INSTALL_SET on the 2148
// ruling that the door auto-starts and the per-account key is the gate — and did not hold on the
// foreground path, with nothing in the output saying which of the two you were on. The owner spent the
// leg believing MCP had not started at all. It had: the STAFF door was up, and the door he was looking
// for was the other one. Two doors, two audiences, and the output named neither as a door.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnv, resolvePorts, BACKGROUND_UNITS } from "../../bin/start.mjs";
import { clientDoorPort } from "../../shared/client-door.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const START_SRC = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");

const BASE = {
  ports: resolvePorts({}),
  paths: { base: "/i", pool: "/i/pool", workspace: "/i/w", queue: "/i/q", outbox: "/i/o",
    locks: "/i/l", grants: "/i/grants.json", audit: "/i/audit", recipes: "/i/r", configStore: "/i/c" },
  user: "op@localhost", staffDomains: "localhost", portalSecret: "s", tokenSecret: "t", opsToken: "o",
};

test("2176-F26 the foreground path composes an environment for the client door at all", () => {
  const envs = childEnv(BASE);
  assert.ok(envs.client, "there was no client-door environment, so the foreground path cannot start one");
  assert.equal(envs.client.CLIENT_MCP_HTTP_PORT, String(clientDoorPort({})));
});

test("2176-F26 the door is SPAWNED on the foreground path, not merely configured for", () => {
  // Composing an env a spawn never uses is the shape this finding already had once: the ruling held in
  // one place and not the other, and nothing said so.
  assert.match(START_SRC, /start\("the client door", "mcp-server\/http-server-client\.mjs", envs\.client/,
    "the foreground path must actually start the door it composes an environment for");
  // Non-fatal, for the reason the worker is: an install that refuses to come up because one door could
  // not bind is worse than one serving the portal without it.
  assert.match(START_SRC, /"mcp-server\/http-server-client\.mjs", envs\.client, \{ fatal: false \}/,
    "a door that cannot bind must not take the portal down with it");
});

test("2176-F26 PARITY — the door's foreground environment carries what the units give it", () => {
  // The ruling is about parity, so this compares against what the door needs rather than a list typed
  // out here: the access file and the token secret reach it exactly as they reach the units, because
  // they come from the same shared block.
  const envs = childEnv(BASE);
  assert.equal(envs.client.CLEAROTRON_ACCESS_FILE, BASE.paths.grants,
    "the door scopes every caller against the guest list; without it the door cannot answer anyone");
  assert.equal(envs.client.TRADEMARK_MCP_TOKEN_SECRET, "t",
    "the door verifies keys with this; without it the door dies at birth");
  assert.equal(envs.client.CLEAROTRON_NO_ENV_FILE, "1",
    "children are configured by what they are handed, like every other child on this path");
  // The allow-list is derived from the same number the listener is given, never written twice.
  assert.equal(envs.client.CLIENT_MCP_ALLOWED_HOSTS,
    `127.0.0.1:${envs.client.CLIENT_MCP_HTTP_PORT},localhost:${envs.client.CLIENT_MCP_HTTP_PORT}`);
});

test("2176-F26 the fence defaults to the units' value and an operator's OWN decision survives", () => {
  // NOT A NEW EXPOSURE. "1" is what enablePlan writes into the unit env file, so both paths agree; a
  // door reachable with no key issued refuses everything, which is the protection the ruling relies on.
  assert.equal(childEnv(BASE).CLIENT_MCP_ACCOUNT_ACCESS, undefined,
    "the fence belongs to the door's environment, not to every child");
  assert.equal(childEnv(BASE).client.CLIENT_MCP_ACCOUNT_ACCESS, "1");
  // And a deliberate 0 is a decision, not a default to be overwritten.
  assert.equal(childEnv({ ...BASE, clientFence: "0" }).client.CLIENT_MCP_ACCOUNT_ACCESS, "0",
    "an operator who turned account access off must not have it turned back on by starting the product");
});

test("2176-F26 the summary names BOTH doors, their ports, and who each is for", () => {
  // The ambiguity is what cost the leg: "MCP is running" says nothing on a box with two of them.
  assert.match(START_SRC, /Engine door.*Staff\./s, "the staff door must be named as a door, and as staff's");
  assert.match(START_SRC, /Client door/, "the client door must be named as a door");
  assert.match(START_SRC, /a client's assistant connects here/,
    "each door must say who it is for, not merely that it exists");
  // A door that did not come up must say so rather than be silently absent from the summary.
  assert.match(START_SRC, /Client door {2}NOT RUNNING on/,
    "a door that failed to start must be reported, not omitted — an absence reads as 'fine'");
  // The branch must turn on the SYNCHRONOUS truth. `rec.alive` is flipped by an async exit handler, so
  // reading it asks whether the event loop has delivered the exit yet — the margin is real today and
  // nothing pinned it. Found in review by role-dev/Grogu.
  assert.match(START_SRC, /clientDoor\?\.child\?\.exitCode === null/,
    "the not-running branch must read child.exitCode, which the runtime sets when the process is reaped");
});

test("2176-F26 THE DOOR ACTUALLY BOOTS on the composed environment — shape is not the same as starting", async () => {
  // THIS ARM EXISTS BECAUSE THE OTHERS PASSED WHILE THE DOOR DIED AT BIRTH. Every assertion above was
  // green on an environment that made the door exit 1 on its first line:
  //
  //   FATAL: auth enabled but CLEAROTRON_CLIENT_OIDC_AUDIENCE plus CF_ACCESS_TEAM or
  //   CLIENT_MCP_OIDC_ISSUER … are missing — refusing to start (fail-closed)
  //
  // CLIENT_MCP_TOKEN_ONLY was missing. Asserting the presence of names cannot catch the absence of one
  // nobody thought to name, so the only honest check is to start the thing and require it to answer.
  // Found by driving it, not by reading the diff.
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const PORT = 18947;   // NOT 18811: that is the door's default and a real install may hold it.
  const base = mkdtempSync(join(tmpdir(), "f26-boot-"));
  writeFileSync(join(base, "grants.json"), `${JSON.stringify({ tenants: {} }, null, 2)}\n`);
  const envs = childEnv({ ...BASE,
    ports: { ...BASE.ports, client: PORT },
    paths: { ...BASE.paths, base, grants: join(base, "grants.json"), denylist: join(base, "denylist") },
    tokenSecret: "t".repeat(32) });

  const child = spawn(process.execPath, [join(REPO, "mcp-server", "http-server-client.mjs")],
    { env: { PATH: process.env.PATH, HOME: base, ...envs.client }, stdio: ["ignore", "pipe", "pipe"] });
  const pid = child.pid;                       // recorded, and the only thing this arm ever kills
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    const exited = await Promise.race([
      new Promise((r) => child.once("exit", (c) => r(c))),
      new Promise((r) => setTimeout(() => r(null), 8000)),
    ]);
    assert.equal(exited, null,
      `the door exited instead of serving on the environment the foreground path composes:\n${out}`);
    // Alive is not answering. A 401 from a token-only door IS the door answering, and is the state the
    // ruling relies on: reachable, and refusing everyone until a key is issued.
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "GET", signal: AbortSignal.timeout(4000) });
    assert.ok(res.status < 500, `the door answered ${res.status}; a 5xx is not a door serving:\n${out}`);
  } finally { try { process.kill(pid); } catch { /* already gone */ } }
});

test("2176-F26 a door that CANNOT bind is reported as not running — driven, not read", async () => {
  // Grogu's review point, as an arm rather than an expression taken on trust: occupy the port first,
  // then require the door to fail and the summary's NOT RUNNING branch to be the reachable one. The
  // defect this refuses is F26's own, relocated into its failure path — a dead door announced as one a
  // client's assistant connects to.
  const { createServer } = await import("node:net");
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const PORT = 18948;
  const squatter = createServer();
  await new Promise((r) => squatter.listen(PORT, "127.0.0.1", r));
  const base = mkdtempSync(join(tmpdir(), "f26-busy-"));
  writeFileSync(join(base, "grants.json"), `${JSON.stringify({ tenants: {} }, null, 2)}\n`);
  const envs = childEnv({ ...BASE,
    ports: { ...BASE.ports, client: PORT },
    paths: { ...BASE.paths, base, grants: join(base, "grants.json"), denylist: join(base, "denylist") },
    tokenSecret: "t".repeat(32) });
  const child = spawn(process.execPath, [join(REPO, "mcp-server", "http-server-client.mjs")],
    { env: { PATH: process.env.PATH, HOME: base, ...envs.client }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    const code = await Promise.race([
      new Promise((r) => child.once("exit", (c) => r(c))),
      new Promise((r) => setTimeout(() => r("still-up"), 8000)),
    ]);
    assert.notEqual(code, "still-up", `the door bound a port already held by another listener:\n${out}`);
    // exitCode is the fact the summary now reads, and it is set the moment the process is reaped.
    assert.notEqual(child.exitCode, null,
      "exitCode must be non-null once the door has exited — this is the value the NOT RUNNING branch reads");
    assert.match(out, /already in use|EADDRINUSE/i,
      `the door must say WHY it could not start, since the summary points a reader at its output:\n${out}`);
  } finally {
    try { process.kill(child.pid); } catch { /* already gone */ }
    await new Promise((r) => squatter.close(r));
  }
});

test("2176-F26 the client door is in the background set, which is the parity this is measured against", () => {
  // If the door ever left SERVER_INSTALL_SET, the arms above would be enforcing parity with nothing.
  assert.ok(BACKGROUND_UNITS.includes("clearotron-client-mcp.service"),
    "the door left the install set, so 'the same set as --background' no longer means what these arms assume");
});
