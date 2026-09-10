// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-company-created-after-the-door-starts-is-listed.test.mjs — the roster moves while the door runs.
//
// The engine door is a long-lived process, and the customer roster it answers from is a module cache
// with no expiry, filled by its first read — which the door's own boot line makes. start_run was given a
// re-read on a miss (driver/enqueue-schema.mjs); list_profiles and describe_options were not. So a
// company created in the portal after the door started could be started and could not be listed: the
// door went on answering from the roster it read at boot until it was restarted. Measured in testing,
// 2026-09-10.
//
// THE CALLER'S KEY IS THE OTHER CAUSE, and one arm below keeps the two apart. The door narrows
// list_profiles to the account cap of the key that asks, so a key minted before the company existed
// does not list it however fresh the roster is. That is the cap working, and it survives a restart,
// which is why a restart alone did not make the company appear to a check holding such a key.
//
// Driven through the real HTTP face with mcpToolCall — the call the live surface check makes — so the
// account filter the face applies is part of what is measured rather than assumed. Here the first call
// fills the door's copy of the roster, as the boot line does on a running door.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import "./_fixture.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

// profiles.mjs freezes the store from CLEAROTRON_CUSTOMERS_DIR at module load, so it is pinned before
// anything that imports it — the discipline list-profiles-archived.test.mjs describes.
const STORE = mkdtempSync(join(tmpdir(), "roster-moves-"));
const company = (key, name) => writeFileSync(join(STORE, `${key}.json`),
  JSON.stringify({ name, matchDomains: [`${key}.example`], platforms: ["amazon.com"] }));
writeFileSync(join(STORE, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
company("acme", "Acme Industrial");
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", STORE);
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "roster-moves-secret";

const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { mcpToolCall } = await import("../../driver/portal-mcp-client.mjs");

// ── the door, booted once for the file, as portal-trigger-wire.test.mjs boots it ──────────────────
const sessions = new Map();
async function createSession(map, scope = { kind: "internal", runId: null }, owner = null) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const server = makeServer({ scope, local: false });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => map.set(id, { server, transport, lastSeen: Date.now(), email: owner, sub: scope?.sub ?? null, kind: scope?.kind ?? null }),
  });
  transport.onclose = () => { if (transport.sessionId) map.delete(transport.sessionId); };
  await server.connect(transport);
  return transport;
}
let srv, url;
before(async () => {
  srv = createServer(makeHttpHandler({ verify: null, devMode: true, limiter: new RateLimiter({ perMinute: 500 }),
    sessions, createSession, ns: "roster-moves" }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  for (const [, e] of sessions) { try { e.transport.close(); } catch { /* */ } try { e.server?.close?.(); } catch { /* */ } }
  srv.closeAllConnections?.();
  await new Promise((r) => srv.close(r));
});

const call = (token, tool, args = {}) => mcpToolCall({ url, token, tool, args });
const listed = async (token) => ((await call(token, "list_profiles"))?.clients ?? []).map((c) => c.key).sort();
// No accounts claim: every account. The cap is not what the first arms are about.
const uncapped = () => mintToken({ scope: "ops", sub: "portal" });
// The launcher's own shape for the portal's key (bin/start.mjs): two verbs, capped to a roster.
const portalKey = (accounts) => mintToken({ scope: "ops", sub: "portal", verbs: ["start_run", "stop_run"], accounts });

test("a company created after the door has answered once is on its next list, whatever key asks", async () => {
  assert.deepEqual(await listed(uncapped()), ["acme"], "the door's first answer is the roster as it stood");
  company("newco", "Newco Labs");
  assert.deepEqual(await listed(uncapped()), ["acme", "newco"],
    "the door answered from the roster it read first — a company created since stays missing until the door restarts");
  assert.deepEqual(await listed(portalKey(["acme", "newco"])), ["acme", "newco"],
    "a key taken against the roster as it stands now still does not see the new company");
});

test("a key minted before the company existed does not list it — the cap working, not the roster", async () => {
  const minted = portalKey(["acme"]);   // taken at start, when acme was the whole roster
  company("laterco", "Laterco Foods");
  assert.ok((await listed(uncapped())).includes("laterco"),
    "the door itself does not have the company, so this arm would be measuring the roster, not the cap");
  assert.deepEqual(await listed(minted), ["acme"], "the door showed a key a company outside its cap");
});

test("a project created after the door has answered once is listed under its company", async () => {
  const token = uncapped();
  await listed(token);
  mkdirSync(join(STORE, "projects", "acme"), { recursive: true });
  writeFileSync(join(STORE, "projects", "acme", "spring-launch.json"),
    JSON.stringify({ projectName: "Spring launch", platforms: ["amazon.com"] }));
  const acme = (await call(token, "list_profiles")).clients.find((c) => c.key === "acme");
  assert.deepEqual(acme?.projects.map((p) => p.key), ["spring-launch"],
    "the door answered from the projects it read first, the same way it answered the roster");
});

test("describe_options answers about a company created after the door has answered once", async () => {
  const token = uncapped();
  await call(token, "describe_options", { profileKey: "acme" });
  company("freshco", "Freshco Drinks");
  const out = await call(token, "describe_options", { profileKey: "freshco" });
  assert.equal(out?.account?.profileKey, "freshco",
    "describe_options said nothing about the account — its roster is the one the door read first");
  assert.equal(out.account.name, "Freshco Drinks");
});

test("a key granted a company created after the door started is told that company's name", async () => {
  const granted = mintToken({ scope: "ops", sub: "portal", accounts: ["acme", "grantco"] });
  await call(granted, "describe_options");
  company("grantco", "Grantco Tools");
  const out = await call(granted, "describe_options");
  const g = (out?.accountsGranted ?? []).find((a) => a.profileKey === "grantco");
  assert.ok(g, "the granted accounts are no longer listed at all, so this arm measures nothing");
  assert.equal(g.name, "Grantco Tools", "the name came back empty — read from the roster the door read first");
});
