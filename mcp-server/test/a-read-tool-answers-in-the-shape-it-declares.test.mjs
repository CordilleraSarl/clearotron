// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A READ TOOL ANSWERS IN THE SHAPE IT DECLARES, ON EVERY DOOR, FOR EVERY KIND OF SESSION.
//
// The SDK's own client does the checking: listing the tools compiles every declared shape with the validator a real
// client uses, and every call's structured result is validated against its shape by that client, so a mismatch fails
// here as it would fail a firm's assistant. It runs over the four demos and a run in every state, on the stdio door
// and both HTTP doors, for ops, account and report-link keys, and again with the install serving its demo.
//
// The line between a closed shape and an open one is asserted too: a field the code never builds fails a closed
// shape, and a field a run's own files may carry passes an open one.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "read-tool-shape-"));
const POOL = join(ROOT, "pool");
mkdirSync(POOL, { recursive: true });
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
// Every call through a door writes an audit line, and the default log is shared by every test file a suite runs
// under one home: pinned here, before the audit module reads it at import, so this file's calls never land inside
// another file's count of lines (http-handler.test.mjs counts exactly two).
process.env.TRADEMARK_MCP_AUDIT_LOG = join(ROOT, "audit.jsonl");
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", POOL);
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", join(ROOT, "intake-queue"));
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "read-tool-shape-test-secret";
const GRANTS = join(mkdtempSync(join(tmpdir(), "read-tool-shape-grants-")), "grants.json");
writeFileSync(GRANTS, JSON.stringify({ tenants: { demo: { accounts: ["demo-brand-owner"], users: { "lawyer@demo.example": "*" } } },
  people: { "lawyer@demo.example": { run: true } } }));
pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", GRANTS);
process.env.CLIENT_MCP_ACCOUNT_ACCESS = "1";

const { test, before, after } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { AjvJsonSchemaValidator } = await import("@modelcontextprotocol/sdk/validation/ajv-provider.js");
const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { WRITE_VERBS, DOCUMENT_READERS, outputSchemaFor } = await import("../lib/result-shapes.mjs");
const { config } = await import("../lib/driver.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO = join(HERE, "..", "..", "demo");
const SERVER = join(HERE, "..", "server.mjs");
const AGENT = config.defaultAgent;
const STUDIO = join(ROOT, `workspace-${AGENT}`, "studio", "clearance-search");
const T = "2026-01-10T10:00:00.000Z";
const IDS = [];

function stateRun(slug, codename, state, extra = {}) {
  const dir = join(STUDIO, slug, codename);
  mkdirSync(join(dir, "_driver"), { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: `${slug}-${codename}`, slug, codename, date: codename.slice(0, 10), agent: AGENT, state,
    markName: "STATEMARK", startedAt: T, updatedAt: T, stepN: 4, stepTotal: 8, stepLabel: "Searching the registers", ...extra }));
  writeFileSync(join(dir, "_driver", "profile.json"), JSON.stringify({ profileKey: "demo-brand-owner" }));
  IDS.push(`${slug}-${codename}`);
}

const servers = [];
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
async function door(clientSurface) {
  const srv = createServer(makeHttpHandler({ verify: null, devMode: true, clientSurface, tokenOnly: false,
    limiter: new RateLimiter({ perMinute: 5000 }), sessions: new Map(), createSession, ns: "read-tool-shape-test" }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}/mcp`;
}

let opsUrl, clientUrl;
const clients = [];
before(async () => {
  for (const product of readdirSync(DEMO).filter((n) => existsSync(join(DEMO, n, "meta.json")))) {
    const meta = JSON.parse(readFileSync(join(DEMO, product, "meta.json"), "utf8"));
    const s = JSON.parse(readFileSync(join(DEMO, product, "run", "status.json"), "utf8"));
    const dir = join(STUDIO, "archive", s.date.slice(0, 7), s.slug, `${s.date}-${s.codename}`);
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(join(DEMO, product, "run"), dir, { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ ...s, agent: AGENT }));
    mkdirSync(join(POOL, meta.runId), { recursive: true });
    writeFileSync(join(POOL, meta.runId, "meta.json"), JSON.stringify(meta));
    IDS.push(meta.runId);
    // A delivery packet, so the packet reader answers on a run that has one.
    if (!existsSync(join(dir, "_driver", "delivery.json"))) writeFileSync(join(dir, "_driver", "delivery.json"), JSON.stringify({ runId: meta.runId }));
  }
  stateRun("tmpst-running", "2026-01-10-ash-river", "running");
  stateRun("tmpst-postponed", "2026-01-10-blue-fen", "postponed", { resetsAt: "2026-01-10T15:00:00.000Z" });
  stateRun("tmpst-failed", "2026-01-10-elm-gate", "failed", { reason: "a stage failed", failedStage: "synthesis", terminalKind: "invalid-artifact-loop" });
  stateRun("tmpst-cancelled", "2026-01-10-fog-hill", "cancelled");
  mkdirSync(join(STUDIO, "queue"), { recursive: true });
  writeFileSync(join(STUDIO, "queue", "q-demo.json"), JSON.stringify({ id: "q-demo", profileKey: "demo-brand-owner", markName: "ORDERED", classes: [9] }));
  mkdirSync(config.outboxDir, { recursive: true });
  writeFileSync(join(config.outboxDir, "read-shape.pending"), JSON.stringify({ kind: "delivered", runId: IDS[0] }));
  opsUrl = await door(false);
  clientUrl = await door(true);
});
after(async () => {
  for (const c of clients) { try { await c.close(); } catch { /* best-effort */ } }
  for (const s of servers) { try { s.close(); } catch { /* best-effort */ } }
});

async function connect(transport) {
  const client = new Client({ name: "read-tool-shape-test", version: "1" });
  await client.connect(transport);
  clients.push(client);
  return client;
}
const http = (url, token) => connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { "x-trademark-token": token } } }));
const stdio = (env = {}) => connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, ...env }, stderr: "ignore" }));

/** The calls each read tool is asked, per run where it takes one. */
const ORDER = { markName: "ORDERED", forwarder: "requester", classes: [9], profileKey: "demo-brand-owner" };
const RUNLESS = { server_info: [{}], list_runs: [{}, { state: "queued" }], list_profiles: [{}], search_runs: [{ query: "mark" }], list_outbox_events: [{}],
  // The two pre-order tools: an order that would run, an Urgent one, a batch, one country, and one that cannot run as stated.
  plan_run: [ORDER, { ...ORDER, urgent: true }, { ...ORDER, markName: undefined, marks: [{ name: "ORDERED" }, { name: "ORDERLY" }], product: "knockout-search" },
    { ...ORDER, product: "full-country-search", jurisdictions: ["CH"] }, { ...ORDER, deliveryRoute: "portal" }],
  describe_options: [{}, { profileKey: "demo-brand-owner" }] };
const PER_RUN = {
  read_artifact: (runId) => [{ runId, name: "report" }, { runId, name: "status" }, { runId, name: "report", frontMatterOnly: true }],
  trace: (runId) => [{ runId, target: "synthesis" }, { runId, target: "report" }],
  search: (runId) => [{ runId, query: "mark" }],
  run_changes: (runId) => [{ runId }, { runId, since: "2026-01-01T00:00:00Z" }],
  diff_artifact: (runId) => [{ runId, name: "report" }, { runId, name: "registerFindings" }],
  what_if_plan: (runId) => [{ runId, stage: "report-overview" }, { runId }],
  list_findings: (runId) => [{ runId }, { runId, kind: "negatives" }, { runId, kind: "audit" }, { runId, group: "on-field" }],
  get_finding: (runId) => [{ runId, id: "F1" }, { runId, id: "NR1" }, { runId, id: "AT1" }],
};

/** Every read tool this session is offered with a declared shape, called on every run: the SDK client checks each answer. */
async function sweep(label, client, runIds) {
  const { tools } = await client.listTools();   // compiles every declared shape
  const offered = tools.filter((t) => t.outputSchema && !WRITE_VERBS.includes(t.name) && !["start_run"].includes(t.name));
  const checked = new Map();
  for (const t of offered) {
    const calls = RUNLESS[t.name] ?? runIds.flatMap((id) => (PER_RUN[t.name] ?? ((runId) => [{ runId }]))(id));
    for (const args of calls) {
      const r = await client.callTool({ name: t.name, arguments: args })
        .catch((e) => assert.fail(`${label}: ${t.name} ${JSON.stringify(args)} — ${e.message}`));
      if (r.isError) continue;   // a refusal is not a result; the verbs' refusals have their own test
      assert.ok(r.structuredContent, `${label}: ${t.name} answered with no structured result`);
      // THE TEXT AND THE STRUCTURED ANSWER ARE ONE ANSWER: a list rides under `items`, a report reader adds `document`.
      const text = JSON.parse(r.content[0].text);
      const { document: _doc, ...rest } = r.structuredContent;
      assert.deepEqual(Array.isArray(text) ? { items: text } : text, DOCUMENT_READERS.includes(t.name) ? rest : r.structuredContent,
        `${label}: ${t.name} ${JSON.stringify(args)} — the structured answer is not the text's answer`);
      checked.set(t.name, (checked.get(t.name) ?? 0) + 1);
    }
  }
  return { offered: offered.map((t) => t.name).sort(), checked };
}

for (const demo of [false, true]) {
  test(`every read tool a door offers answers in its declared shape${demo ? ", on an install serving its demo" : ""}`, async () => {
    const env = demo ? { CLEAROTRON_DEMO: "1" } : {};
    const prior = process.env.CLEAROTRON_DEMO;
    if (demo) process.env.CLEAROTRON_DEMO = "1"; else delete process.env.CLEAROTRON_DEMO;
    try {
      const doors = {
        "stdio door (ops)": [await stdio(env), IDS],
        "ops HTTP door (ops key)": [await http(opsUrl, mintToken({ scope: "ops", sub: "ops@firm.example", ttlSec: 3600 })), IDS],
        "client HTTP door (account key)": [await http(clientUrl, mintToken({ scope: "account", sub: "lawyer@demo.example", accounts: ["demo-brand-owner"], ttlSec: 3600 })), IDS],
        "client HTTP door (report link)": [await http(clientUrl, mintToken({ scope: "user", runId: IDS[0], ttlSec: 3600 })), [IDS[0]]],
      };
      const total = new Set();
      for (const [label, [client, runIds]] of Object.entries(doors)) {
        const { offered, checked } = await sweep(label, client, runIds);
        // EVERY TOOL OFFERED WITH A SHAPE ANSWERED AT LEAST ONCE, so none was checked only on its refusals.
        assert.deepEqual([...checked.keys()].sort(), offered, `${label}: answered ${JSON.stringify([...checked])} of ${JSON.stringify(offered)}`);
        for (const n of offered) total.add(n);
      }
      for (const name of ["list_runs", "get_run", "server_info", "decision_timeline", "get_provider_usage", "get_coverage", "search", "run_changes",
        "search_runs", "list_outbox_events", "get_telemetry", "read_artifact", "trace", "list_profiles", "get_delivery_packet",
        "brief", "list_findings", "get_finding", "list_evidence", "list_searches", "get_search_coverage", "plan_run", "describe_options",
        // An install serving its demo withholds the what-if tools (a-demo-names-no-tool-it-withholds.test.mjs).
        ...(demo ? [] : ["what_if_plan", "what_if_result"])])
        assert.ok(total.has(name), `${name} was never offered with a declared shape on any door`);
    } finally {
      if (prior === undefined) delete process.env.CLEAROTRON_DEMO; else process.env.CLEAROTRON_DEMO = prior;
    }
  });
}

test("a closed shape refuses a field the code never builds; an open one passes a field a run's files may carry", () => {
  const v = (schema) => new AjvJsonSchemaValidator().getValidator(schema);
  const identity = { name: "Clearotron", version: "1.0.0", commit: null, sourceRepo: "r", sourceUrl: "u", license: "l", copyright: "c" };
  assert.equal(v(outputSchemaFor("server_info"))(identity).valid, true);
  assert.equal(v(outputSchemaFor("server_info"))({ ...identity, extra: 1 }).valid, false, "a closed shape refuses an undeclared field");
  assert.equal(v(outputSchemaFor("trace"))({ runId: "r", target: "t", anythingTheLogHolds: { x: 1 } }).valid, true, "an open shape passes it");
  assert.equal(v(outputSchemaFor("trace"))({ target: "t" }).valid, false, "an open shape still requires its identifying keys");
  // How soon is closed throughout: an option that does not say its count does not pass.
  const plan = v(outputSchemaFor("plan_run"));
  const howSoon = { chosen: "standard", urgentAvailable: true, standard: { turnaround: "t", turnaroundLowHours: 1.5, turnaroundHighHours: 2.5, searches: 1, withinAllowance: null }, urgent: null };
  const answer = { ok: true, wouldRun: true, _note: "n", blockers: [], warnings: [], caveat: "c", effort: null, howSoon,
    search: { name: null, product: null, pipeline: null, components: null, savedSearch: null, turnaround: null, maxNames: null, caseLaw: false, nativeLanguage: null, chosenBy: "x", registerReach: null },
    subject: { marks: [], markCount: 0, classes: [], classesFrom: "x", goods: null },
    scope: { jurisdictions: [], jurisdictionsFrom: "x", bindingLayers: [], platforms: [], platformsAdded: [], platformsFrom: "", gridCellsPerVariant: null },
    account: { profileKey: null, name: null, projectKey: null, framework: "f", caps: null, usage: null, usageComplete: null, dailyRunsEffective: null, remainingToday: null, allowanceApplies: null, origins: null } };
  assert.equal(plan(answer).valid, true);
  const { searches: _s, ...uncounted } = howSoon.standard;
  assert.equal(plan({ ...answer, howSoon: { ...howSoon, standard: uncounted } }).valid, false, "an option with no count is refused");
});
