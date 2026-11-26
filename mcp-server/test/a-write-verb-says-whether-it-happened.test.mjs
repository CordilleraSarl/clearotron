// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WRITE VERB SAYS WHETHER IT HAPPENED, IN THE SHAPE IT DECLARES.
//
// The six verbs that change something (start_run, stop_run, feed_context, what_if_run, mark_sent, ack_event) each
// declare the shape of their result, and their result carries `outcome`: what the verb did, or `refused` with the
// refusal's own sentence in `reason`. The text block a host reads is unchanged.
//
// THE CHECK IS THE SDK'S OWN CLIENT, on the stdio door and on both HTTP doors. Listing the tools compiles every
// declared shape with the same validator a real client uses, so a shape that does not compile fails here as it
// would fail a firm's assistant; every call's structured result is then validated against its declared shape by
// that client. Nothing is claimed or spent: the queue has no worker, and the one engine-starting verb is refused.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "write-verb-shape-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
// Every call through a door writes an audit line, and the default log is shared by every test file a suite runs
// under one home: pinned here, before the audit module reads it at import, so this file's calls never land inside
// another file's count of lines (http-handler.test.mjs counts exactly two).
process.env.TRADEMARK_MCP_AUDIT_LOG = join(ROOT, "audit.jsonl");
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "write-verb-shape-test-secret";
const GRANTS_DIR = mkdtempSync(join(tmpdir(), "write-verb-shape-grants-"));
writeFileSync(join(GRANTS_DIR, "grants.json"), JSON.stringify({
  tenants: { acme: { accounts: ["demo-brand-owner"], users: { "lawyer@acme.example": "*" } } },
  people: { "lawyer@acme.example": { run: true } },
}));
pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(GRANTS_DIR, "grants.json"));
process.env.CLIENT_MCP_ACCOUNT_ACCESS = "1";

const { test, before, after } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { AjvJsonSchemaValidator } = await import("@modelcontextprotocol/sdk/validation/ajv-provider.js");
const { buildFixture, RUN_ID } = await import("./_fixture.mjs");
const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { WRITE_VERBS, outputSchemaFor } = await import("../lib/result-shapes.mjs");
const { driverDir } = await import("../../shared/driver-dir.mjs");
const { config } = await import("../lib/driver.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server.mjs");

async function createSession(sessions, scope, owner = null) {
  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
  const server = makeServer({ scope, local: false });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => sessions.set(id, { server, transport, lastSeen: Date.now(), email: owner, sub: scope?.sub ?? null, kind: scope?.kind ?? null }),
  });
  transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
  await server.connect(transport);
  return transport;
}

const servers = [];
async function door({ clientSurface }) {
  const srv = createServer(makeHttpHandler({ verify: null, devMode: true, clientSurface, tokenOnly: false,
    limiter: new RateLimiter({ perMinute: 1000 }), sessions: new Map(), createSession, ns: "write-verb-shape-test" }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}/mcp`;
}

let opsUrl, clientUrl, fixture;
const clients = [];
before(async () => {
  fixture = buildFixture();
  writeFileSync(driverDir(fixture.runDir, "profile.json"), JSON.stringify({ profileKey: "demo-brand-owner" }));
  mkdirSync(config.outboxDir, { recursive: true });
  opsUrl = await door({ clientSurface: false });
  clientUrl = await door({ clientSurface: true });
});
after(async () => {
  for (const c of clients) { try { await c.close(); } catch { /* best-effort */ } }
  for (const s of servers) { try { s.close(); } catch { /* best-effort */ } }
});

async function connect(transport) {
  const client = new Client({ name: "write-verb-shape-test", version: "1" });
  await client.connect(transport);
  clients.push(client);
  return client;
}
const KINDS = new WeakMap();
const scopeKindOf = (client) => KINDS.get(client) ?? "ops";
const httpClient = async (url, token, kind = "ops") => {
  const c = await connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { "x-trademark-token": token } } }));
  KINDS.set(c, kind);
  return c;
};
const stdioClient = () => connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env }, stderr: "ignore" }));

const OPS = () => mintToken({ scope: "ops", sub: "ops@firm.example", ttlSec: 3600 });
const ACME = () => mintToken({ scope: "account", sub: "lawyer@acme.example", accounts: ["demo-brand-owner"], ttlSec: 3600 });
const USER = () => mintToken({ scope: "user", runId: RUN_ID, ttlSec: 3600 });

const job = (markName) => ({ markName, forwarder: "requester", classes: [9], profileKey: "demo-brand-owner" });

/**
 * What each verb is asked on a door, and the outcomes it may answer with. Every call goes through the SDK client,
 * which refuses a structured result that does not match the declared shape: a mismatch throws here, not passes.
 */
async function exercise(client, verb) {
  const call = async (args) => {
    const r = await client.callTool({ name: verb, arguments: args });
    assert.ok(r.structuredContent, `${verb} answered with no structured result: ${r.content?.[0]?.text}`);
    if (!r.isError) assert.equal(r.content[0].text, JSON.stringify(Object.fromEntries(Object.entries(r.structuredContent).filter(([k]) => k !== "outcome")), null, 2),
      `${verb}: the text block is the result as it was, without the structured result's outcome`);
    return r.structuredContent;
  };
  const refused = async (args) => {
    const s = await call(args);
    assert.equal(s.outcome, "refused", `${verb} with ${JSON.stringify(args)}: ${JSON.stringify(s)}`);
    assert.ok(s.reason.length > 0, `${verb}: a refusal names its reason`);
    return s;
  };
  switch (verb) {
    case "start_run": {
      const queued = await call(job(`SHAPE${randomUUID().slice(0, 6).toUpperCase()}`));
      assert.equal(queued.outcome, "queued", JSON.stringify(queued));
      assert.ok(existsSync(queued.queuePath), "the job it says it queued is in the queue");
      await refused({ forwarder: "requester" });
      return ["queued", "refused"];
    }
    case "stop_run": {
      const queued = (await client.callTool({ name: "start_run", arguments: job(`STOP${randomUUID().slice(0, 6).toUpperCase()}`) })).structuredContent;
      assert.equal(queued?.outcome, "queued", JSON.stringify(queued));
      const dequeued = await call({ id: queued.id });
      assert.equal(dequeued.outcome, "dequeued", JSON.stringify(dequeued));
      assert.ok(!existsSync(queued.queuePath), "the job it says it removed is gone");
      await refused({ runId: "no-such-run" });
      return ["dequeued", "refused"];
    }
    case "feed_context": {
      const written = await call({ runId: RUN_ID, customer: "Acme Holdings" });
      assert.equal(written.outcome, "written");
      await refused({ runId: RUN_ID });
      return ["written", "refused"];
    }
    case "ack_event": {
      const file = `write-verb-shape-${randomUUID().slice(0, 8)}.pending`;
      writeFileSync(join(config.outboxDir, file), JSON.stringify({ kind: "delivered", runId: RUN_ID }));
      const first = await call({ file });
      assert.equal(first.outcome, "acknowledged", JSON.stringify(first));
      const second = await call({ file });
      assert.equal(second.outcome, "already-gone", "a second acknowledgement finds the event gone");
      await refused({ file: "../escape.pending" });
      return ["acknowledged", "already-gone", "refused"];
    }
    case "mark_sent": {
      // A run with a delivery packet waiting: the first door to mark it settles it, every later call finds it settled.
      if (!existsSync(driverDir(fixture.runDir, "delivery.json"))) writeFileSync(driverDir(fixture.runDir, "delivery.json"), JSON.stringify({ runId: RUN_ID }));
      const first = await call({ runId: RUN_ID, messageId: "<shape-test@mail>" });
      assert.ok(["marked-sent", "already-sent"].includes(first.outcome), JSON.stringify(first));
      const again = await call({ runId: RUN_ID, messageId: "<shape-test@mail>" });
      assert.equal(again.outcome, "already-sent", JSON.stringify(again));
      await refused({ runId: "no-such-run" });
      return [first.outcome, "already-sent", "refused"];
    }
    case "what_if_run": {
      // Refused before anything starts: a token for no run. A real confirmation would start the engine on ops,
      // so only a session that queues what-ifs (an account) is given one; it queues and starts nothing.
      await refused({ runId: RUN_ID, confirmationToken: "not-a-token" });
      const offered = (await client.listTools()).tools.find((t) => t.name === "what_if_plan");
      const plan = offered ? (await client.callTool({ name: "what_if_plan", arguments: { runId: RUN_ID, stage: "report-overview" } })) : null;
      const token = plan && !plan.isError ? JSON.parse(plan.content[0].text).confirmationToken : null;
      if (token && scopeKindOf(client) === "account") {
        const queued = await call({ runId: RUN_ID, confirmationToken: token });
        assert.equal(queued.outcome, "queued", JSON.stringify(queued));
        return ["refused", "queued (what-if)"];
      }
      return ["refused"];
    }
    default: throw new Error(`no exercise for ${verb}`);
  }
}

async function sweep(label, client) {
  const { tools } = await client.listTools();   // compiles every declared shape with the SDK's own validator
  const offered = tools.filter((t) => WRITE_VERBS.includes(t.name));
  for (const t of offered) assert.ok(t.outputSchema, `${label}: ${t.name} is offered with no declared result`);
  const seen = [];
  for (const t of offered) seen.push([t.name, await exercise(client, t.name)]);
  return { offered: offered.map((t) => t.name).sort(), checked: seen.map(([n]) => n).sort(), answered: seen.flatMap(([, o]) => o) };
}

test("every write verb a door offers declares its result, and answers in that shape", async () => {
  const doors = {
    "stdio door (ops)": await stdioClient().catch((e) => { throw new Error(`stdio connect: ${e?.message || String(e)}`); }),
    "ops HTTP door (ops key)": await httpClient(opsUrl, OPS()),
    "client HTTP door (account key)": await httpClient(clientUrl, ACME(), "account"),
    "client HTTP door (report link)": await httpClient(clientUrl, USER(), "user"),
  };
  const seen = {}, outcomes = {};
  for (const [label, client] of Object.entries(doors)) {
    const { offered, checked, answered } = await sweep(label, client).catch((e) => { throw new Error(`${label}: ${e?.message || String(e)}`, { cause: e }); });
    assert.deepEqual(checked, offered, `${label}: every verb offered was checked`);
    seen[label] = offered;
    outcomes[label] = answered;
  }
  // EVERY SUCCESS FORM WAS SEEN, not only the refusals: each outcome below came back through the SDK client's check.
  const all = new Set(Object.values(outcomes).flat());
  for (const o of ["queued", "dequeued", "written", "acknowledged", "already-gone", "already-sent", "refused"])
    assert.ok(all.has(o), `no verb answered "${o}" — ${JSON.stringify(outcomes)}`);
  assert.ok(outcomes["client HTTP door (account key)"].includes("queued (what-if)"), "the account's what-if queued");
  // POSITIVE EVIDENCE OF COVERAGE: the ops doors offer all six, an account key the three it may use, a report link none.
  assert.deepEqual(seen["stdio door (ops)"], [...WRITE_VERBS].sort());
  assert.ok(seen["client HTTP door (account key)"].includes("start_run"), JSON.stringify(seen));
  assert.deepEqual(seen["client HTTP door (report link)"], []);
});

test("a result that leaves out its outcome, or a refusal with no reason, does not match the declared shape", () => {
  const ajv = new AjvJsonSchemaValidator();
  for (const verb of WRITE_VERBS) {
    for (const client of [false, true]) {
      const schema = outputSchemaFor(verb, { client });
      if (!schema) continue;
      const v = ajv.getValidator(schema);
      assert.equal(v({ outcome: "refused", reason: "no" }).valid, true, `${verb}: a refusal with its reason matches`);
      assert.equal(v({ outcome: "refused" }).valid, false, `${verb}: a refusal with no reason is refused by the shape`);
      assert.equal(v({ ok: true }).valid, false, `${verb}: a result with no outcome is refused by the shape`);
    }
  }
  const start = new AjvJsonSchemaValidator().getValidator(outputSchemaFor("start_run"));
  const good = { outcome: "queued", ok: true, id: "x", agent: "a", queue: "q", queued: true, warnings: [], queuePath: "p", queueWatched: "ok", note: "n" };
  assert.equal(start(good).valid, true, "the shape start_run declares accepts its own answer");
  assert.equal(start({ ...good, surprise: 1 }).valid, false, "and refuses a field it does not declare");
});

test("the declared shapes carry no sentence an assistant would read, and no key a client caches across tools", () => {
  const raw = readFileSync(join(HERE, "..", "result-shapes.json"), "utf8");
  for (const key of ["\"description\"", "\"title\"", "\"$id\"", "\"$schema\""])
    assert.ok(!raw.includes(key), `result-shapes.json carries ${key}`);
});
