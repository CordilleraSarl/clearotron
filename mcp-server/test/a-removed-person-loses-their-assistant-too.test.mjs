// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Taking somebody off the guest list ends their assistant's session too, on the next request.
//
// An ACCOUNT session's reach is resolved once, at `resolveScope`, and lives in the server the transport
// was built around. After that the door compared the caller's address against the session's and nothing
// else — so somebody removed from an installation kept a whole account's reach through their assistant
// until the session went idle for `SESSION_TTL_MS`, half an hour by default. The portal's own side has
// never had that gap: it reads the access file on every request.
//
// This matters because the People page now says, before a manager presses the button, that removing
// somebody takes their access away "straight away, here and through their AI". That sentence was true of
// the website and nearly true of the assistant, and "nearly" is a half-hour window in which somebody who
// has just been removed can still read the installation's work.
//
// WHAT IS DELIBERATELY NOT CHECKED is the other three kinds of session, and they are driven here for
// that reason. A run-bound `user` session and an `ops` session carry a token whose subject is a run id
// or an automation principal — neither is an address anybody enrols — and `internal` is firm staff,
// admitted by a domain rule that does not live in the guest list. Asking the guest list about any of
// them would refuse a caller for not being something they were never meant to be.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "withdrawn-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "withdrawn-test-secret";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pinEnv } from "../../shared/env-aliases.mjs";

const { buildFixture, RUN_ID } = await import("./_fixture.mjs");
const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { mcpToolCall } = await import("../../driver/portal-mcp-client.mjs");

/**
 * A session factory that stores NEITHER `sub` NOR `kind` — the shape some of this repository's callers
 * have and others do not. It is the deliberate choice here: the gate reads both, so if it depended on
 * this factory to set them it would be a gate that quietly stops gating wherever the factory is thinner.
 * The handler stamps them onto the stored entry itself, and this arm is what proves that.
 */
async function createSession(sessions, scope, owner = null) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const server = makeServer({ scope, local: false });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => sessions.set(id, { server, transport, lastSeen: Date.now(), email: owner }),
  });
  transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
  await server.connect(transport);
  return transport;
}

const LAWYER = "lawyer@acme.example";
let url, srv, enrolled;

before(async () => {
  buildFixture();
  const fx = buildFixture();
  writeFileSync(driverDir(fx.runDir, "profile.json"), JSON.stringify({ profileKey: "acme" }));

  // The guest list, and the seam that reads it. `enrolled` stands in for the access file so the arm can
  // take somebody off the list between two requests without racing a filesystem mtime.
  enrolled = new Set([LAWYER]);
  process.env.CLIENT_MCP_ACCOUNT_ACCESS = "1";
  const gdir = mkdtempSync(join(tmpdir(), "withdrawn-grants-"));
  writeFileSync(join(gdir, "grants.json"), JSON.stringify({
    tenants: { acme: { accounts: ["acme"], users: { [LAWYER]: "*" } } },
  }));
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(gdir, "grants.json"));

  srv = createServer(makeHttpHandler({
    verify: null, devMode: true, clientSurface: true, limiter: new RateLimiter({ perMinute: 500 }),
    sessions: new Map(), createSession, ns: "withdrawn-test",
    stillEnrolled: (email) => enrolled.has(String(email ?? "").toLowerCase()),
  }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { try { srv?.close(); } catch { /* best-effort */ } });

const account = () => mintToken({ scope: "account", sub: LAWYER, accounts: ["acme"], ttlSec: 3600 });
const runBound = () => mintToken({ scope: "user", runId: RUN_ID, ttlSec: 3600 });
const ask = (token, tool = "list_runs", args = {}) => mcpToolCall({ url, token, tool, args });
const refusal = async (token, tool = "list_runs") => {
  try { await ask(token, tool); return null; }
  catch (e) { return String(e?.message ?? e); }
};

test("an account session works while its holder is on the guest list", async () => {
  const token = account();
  assert.ok(await ask(token), "the session could not be opened at all — nothing below would mean anything");
  assert.ok(await ask(token), "a second request on the same session was refused before anybody was removed");
  assert.equal(enrolled.has(LAWYER), true, "the arm removed them before it meant to");
});

test("the request AFTER the removal is refused, and says why in words the holder can act on", async () => {
  const token = account();
  assert.ok(await ask(token), "the session must be live before it can be withdrawn");
  enrolled.delete(LAWYER);
  const said = await refusal(token);
  assert.ok(said, "a removed person's next request went through — the session held its reach");
  assert.match(said, /403/);
  assert.match(said, /withdrawn/);
  // NOT "expired", NOT "invalid key". Somebody reading this in their assistant has to know that the
  // answer is to ask whoever manages the installation, not to reconnect.
  assert.doesNotMatch(said, /expired|invalid/i);
  enrolled.add(LAWYER);
});

test("a RUN-BOUND session is untouched — its subject is a run, not somebody's address", async () => {
  const token = runBound();
  const read = () => ask(token, "read_artifact", { runId: RUN_ID, name: "report" });
  assert.ok(await read(), "the run-bound session could not be opened");
  // Empty the guest list entirely. A gate that asked about this session would refuse it now.
  const held = [...enrolled];
  enrolled.clear();
  assert.ok(await read(), "a run-bound session was refused for not being on a guest list it was never on");
  for (const e of held) enrolled.add(e);
});

test("the gate does not depend on the session factory storing anything — the door stamps it", async () => {
  // `createSession` above records neither `sub` nor `kind`. If the gate read what that factory wrote it
  // would pass this file and every other one, and do nothing on the real client door.
  const token = account();
  assert.ok(await ask(token), "the session could not be opened");
  enrolled.delete(LAWYER);
  const said = await refusal(token);
  assert.ok(said && /withdrawn/.test(said),
    "the gate read a field the session factory never set, so it never fired — the handler must stamp it");
  enrolled.add(LAWYER);
});
