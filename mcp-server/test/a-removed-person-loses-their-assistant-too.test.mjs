// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Taking somebody off the guest list ends their assistant's reach too, on the next request.
//
// An ACCOUNT session's reach used to be resolved once, at `resolveScope`, and lived in the server the
// transport was built around, so somebody removed from an installation kept a whole account's reach through
// their assistant until the session went idle, half an hour by default. The portal's own side has never had
// that gap: it reads the access file on every request. Sessions no longer exist (design, 2026-11-27): every
// request is scoped from its own key and asked the guest-list question before it is served, which is what
// these arms hold the client door to.
//
// This matters because the People page now says, before a manager presses the button, that removing
// somebody takes their access away "straight away, here and through their AI". That sentence was true of
// the website and nearly true of the assistant, and "nearly" is a half-hour window in which somebody who
// has just been removed can still read the installation's work.
//
// WHAT IS DELIBERATELY NOT CHECKED is the other three kinds of key, and they are driven here for
// that reason. A run-bound `user` key and an `ops` key carry a token whose subject is a run id
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
import { pinEnv } from "../../shared/env-aliases.mjs";

const { buildFixture, RUN_ID } = await import("./_fixture.mjs");
const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { mcpServe } = await import("../lib/mcp-serve.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { mcpToolCall } = await import("../../driver/portal-mcp-client.mjs");

/**
 * The doors' own composition, counted: each request is answered by a server built from that request's scope, and
 * `served` counts the requests that got as far as that server. The gate must turn a removed person away BEFORE this
 * point, from the scope the handler resolved itself, so a refusal that still reached the server would be a gate in
 * name only.
 */
const answer = mcpServe((scope) => makeServer({ scope, local: false }));
let served = 0;
const serve = (req, res, ctx) => { served++; return answer(req, res, ctx); };

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
    serve, ns: "withdrawn-test",
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

test("an account key works while its holder is on the guest list", async () => {
  const token = account();
  assert.ok(await ask(token), "the key was not served at all — nothing below would mean anything");
  assert.ok(await ask(token), "a second request with the same key was refused before anybody was removed");
  assert.equal(enrolled.has(LAWYER), true, "the arm removed them before it meant to");
});

test("the request AFTER the removal is refused, and says why in words the holder can act on", async () => {
  const token = account();
  assert.ok(await ask(token), "the key must be served before it can be withdrawn");
  enrolled.delete(LAWYER);
  const said = await refusal(token);
  assert.ok(said, "a removed person's next request went through — the key held its reach");
  assert.match(said, /403/);
  assert.match(said, /withdrawn/);
  // NOT "expired", NOT "invalid key". Somebody reading this in their assistant has to know that the
  // answer is to ask whoever manages the installation, not to reconnect.
  assert.doesNotMatch(said, /expired|invalid/i);
  // And the answer is asked again on every request, not remembered: put back on the list, the same key is served.
  enrolled.add(LAWYER);
  assert.ok(await ask(token), "a person put back on the guest list was still refused — the refusal was held, not asked");
});

test("a RUN-BOUND key is untouched — its subject is a run, not somebody's address", async () => {
  const token = runBound();
  const read = () => ask(token, "read_artifact", { runId: RUN_ID, name: "report" });
  assert.ok(await read(), "the run-bound key was not served");
  // Empty the guest list entirely. A gate that asked about this key would refuse it now.
  const held = [...enrolled];
  enrolled.clear();
  assert.ok(await read(), "a run-bound key was refused for not being on a guest list it was never on");
  for (const e of held) enrolled.add(e);
});

test("the gate turns a removed person away before the server that would answer them is reached", async () => {
  // The gate reads the scope the handler resolved from this request's own key, not anything the server that answers
  // records. A gate that ran inside, or after, that server could let the call it refuses be answered first.
  const token = account();
  const before = served;
  assert.ok(await ask(token), "the key was not served");
  assert.equal(served, before + 1, "the request that went through never reached the server, so the count below means nothing");
  enrolled.delete(LAWYER);
  const said = await refusal(token);
  assert.ok(said && /withdrawn/.test(said), "a removed person's request was not refused by the guest-list gate");
  assert.equal(served, before + 1, "a removed person's request reached the server that answers requests");
  enrolled.add(LAWYER);
});
