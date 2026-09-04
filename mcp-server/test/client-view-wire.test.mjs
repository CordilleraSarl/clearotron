// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// client-view-wire.test.mjs — the client view is actually APPLIED, through the real /mcp face.
//
// WHY THIS EXISTS, and why lib-level scrub tests are not enough. R1 was never "no scrubber exists" — brief
// had one all along. The leak was that the scrubber was not APPLIED to read_artifact. A test that calls
// scrub functions directly reproduces that hole exactly: delete the presentForPrincipal line from the
// dispatch chokepoint and every scrub unit test still passes green while the leak is wide open.
//
// So this drives a REAL user-scoped session over the real HTTP face (initialize → tools/call), the same way
// a client's Claude/ChatGPT connector does, and asserts on what comes back on the wire. It also pins the
// other half — that a STAFF principal still reads the raw internal cut — because a scrub that silently
// applied to staff would break the internal review surface just as badly, and equally quietly.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
const ROOT = mkdtempSync(join(tmpdir(), "client-view-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "client-view-test-secret";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const { buildFixture, RUN_ID } = await import("./_fixture.mjs");
const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { mcpToolCall } = await import("../../driver/portal-mcp-client.mjs");

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

let url, srv, fixture;
before(async () => {
  fixture = buildFixture();
  const sessions = new Map();
  srv = createServer(makeHttpHandler({
    verify: null, devMode: true, limiter: new RateLimiter({ perMinute: 500 }),
    sessions, createSession, ns: "client-view-test",
  }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { try { srv?.close(); } catch { /* best-effort */ } });

// a run-bound client (report-link) token — exactly what the report's "Ask your AI" link carries
const clientToken = () => mintToken({ scope: "user", runId: RUN_ID, ttlSec: 3600 });
const call = (tool, args, token) => mcpToolCall({ url, token, tool, args });

test("client token: read_artifact(report) is the CLIENT cut on the wire", async () => {
  const r = await call("read_artifact", { runId: RUN_ID, name: "report" }, clientToken());
  const text = r.text ?? JSON.stringify(r);

  // internal-only content is gone
  assert.ok(!text.includes("[internal]"), "an [internal] label reached a client over the wire");
  assert.ok(!/Enforcer basis is inferred/i.test(text), "internal reasoning text survived");
  assert.ok(!/overall_badge/.test(text), "the internal band code reached a client");
  assert.ok(!/profile d37721cda899/.test(text), "the framework profile hash reached a client");

  // …and the legal product did NOT get gutted (parity with report.html, the one report — see scrub.test.mjs)
  assert.match(text, /# Marks/, "the client lost the report body");
  assert.match(text, /A direct, live, in-class conflict/, "the client lost the card read");
  assert.match(text, /Corsearch/, "a provider name was stripped — the client report names it deliberately");
  assert.match(text, /# Methodology/, "Methodology was stripped — the client report renders it");
});

test("client token: the Resources door gets the same cut as the tool", async () => {
  // a second route to the same bytes; if only the tool scrubs, a client just asks for the URI instead
  const r = await call("read_artifact", { runId: RUN_ID, name: "report", frontMatterOnly: true }, clientToken());
  const fm = r.frontMatter ?? {};
  assert.equal(fm.overall_badge, undefined, "frontMatterOnly bypassed the scrub");
  assert.equal(fm.title, "ACME", "front matter came back empty — over-scrubbed");
  assert.ok(!/profile /.test(fm.rated_under ?? ""), "the profile hash leaked via frontMatterOnly");
});

test("client token: curated cards carry no internal tier/label shorthand", async () => {
  const r = await call("list_findings", { runId: RUN_ID, group: "on-field" }, clientToken());
  const blob = JSON.stringify(r);
  assert.ok(!/"tier"/.test(blob), "the internal tier code reached a client");
  assert.ok(!/Composite 4/.test(blob), "the internal Level/Composite label reached a client");
  assert.match(blob, /on-field/, "the client lost the card grouping (that vocabulary IS client-facing)");
});

test("a NON-CLIENT principal still reads the RAW internal cut — the scrub must not bleed", async () => {
  // ops stands in for the firm-side principals here (internal takes no token at all, which this transport
  // helper cannot express — it always sends the header). Same property either way: the client cut is gated
  // on the principal KIND, and every non-client kind keeps the internal review surface byte-for-byte.
  const opsToken = mintToken({ scope: "ops", sub: "client-view-test", ttlSec: 3600 });
  const r = await call("read_artifact", { runId: RUN_ID, name: "report" }, opsToken);
  const text = r.text ?? JSON.stringify(r);
  assert.match(text, /\[internal\]/, "staff LOST the internal notes — the client scrub bled onto the staff surface");
  assert.match(text, /overall_badge/, "staff lost the band code");
  assert.match(text, /profile d37721cda899/, "staff lost the framework profile identity");
});

test("the client cut is decided by PRINCIPAL, not by which tool was called", async () => {
  // brief is the tool that always scrubbed; read_artifact is the one that did not. Same principal ⇒ same
  // answer to "may I see this?" — that asymmetry between two client-reachable reads WAS the bug.
  const brief = await call("brief", { runId: RUN_ID }, clientToken());
  assert.ok(!JSON.stringify(brief).includes("[internal]"), "brief leaked an internal note");
  // ONE report (spec 2026-07-30 §5): clientSummary — a second version by another name — is no longer a
  // client-reachable artifact at all. The file remains an internal cover-note source (ops read it above).
  await assert.rejects(
    () => call("read_artifact", { runId: RUN_ID, name: "clientSummary" }, clientToken()),
    /may only read the report/,
    "a client principal must be refused the clientSummary artifact",
  );
});

// ---- the evidence layer, on the wire -----------------------------------------------------------
// Same lesson as the rest of this file: a lib-level test of lib/evidence.mjs passes green whether or not
// the tools are actually registered and reachable. These drive the real face.
//
// An account principal is only admissible on the CLIENT surface (the staff handler refuses an account key
// outright), and that surface fails closed three further ways — account access off, no grants file, and a
// run with no account tag. Every one of those guards fired in turn while this test was written, which is
// exactly why it drives the face instead of calling authorize() directly.

const accountToken = () => mintToken({ scope: "account", sub: "lawyer@acme.example", accounts: ["acme"], ttlSec: 3600 });
let clientUrl, clientSrv;
before(async () => {
  process.env.CLIENT_MCP_ACCOUNT_ACCESS = "1";
  const gdir = mkdtempSync(join(tmpdir(), "evidence-grants-"));
  writeFileSync(join(gdir, "grants.json"),
    JSON.stringify({ tenants: { acme: { accounts: ["acme"], users: { "lawyer@acme.example": "*" } } } }));
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(gdir, "grants.json"));
  // The run has to BELONG to the account: a run with no account tag is visible only to a full grant.
  writeFileSync(driverDir(fixture.runDir, "profile.json"), JSON.stringify({ profileKey: "acme" }));

  const sessions = new Map();
  clientSrv = createServer(makeHttpHandler({
    verify: null, devMode: true, tokenOnly: false, clientSurface: true,
    limiter: new RateLimiter({ perMinute: 500 }), sessions, createSession, ns: "client-evidence-test",
  }));
  await new Promise((r) => clientSrv.listen(0, "127.0.0.1", r));
  clientUrl = `http://127.0.0.1:${clientSrv.address().port}`;
});
after(() => { try { clientSrv?.close(); } catch { /* best-effort */ } });
const clientCall = (tool, args, token) => mcpToolCall({ url: clientUrl, token, tool, args });

test("account: the evidence layer is reachable and carries the records + the empty searches", async () => {
  const token = accountToken();
  const ev = await clientCall("list_evidence", { runId: RUN_ID }, token);
  assert.ok(Array.isArray(ev.records) && ev.records.length, "an account got no records");
  assert.ok(ev.records.some((r) => r.mark === "ACME (Beta Inc)"), "the register record is missing");

  const sl = await clientCall("list_searches", { runId: RUN_ID }, token);
  assert.ok(sl.count >= 1, "the search log came back empty");
  assert.ok(sl.searches.every((s) => !("notes" in s)), "a search row carried its notes field");

  const cov = await clientCall("get_search_coverage", { runId: RUN_ID }, token);
  assert.ok(Array.isArray(cov.areas), "coverage did not come back in the expected shape");
});

test("a report-link token is refused the evidence layer on the wire", async () => {
  // accountSafe, not clientSafe: the decision is that a forwardable link does not open the record set.
  for (const tool of ["list_evidence", "list_searches", "get_search_coverage"]) {
    const r = await clientCall(tool, { runId: RUN_ID }, clientToken()).catch((e) => ({ error: String(e) }));
    assert.match(JSON.stringify(r), /FORBIDDEN|not available/i, `${tool} was reachable from a report link`);
  }
});

test("the COST tools stay refused for an account, on the wire", async () => {
  // Re-cut for the owner's 2026-08-27 ruling: trace and decision_timeline moved to the account layer
  // with get_run and get_finding. What is left here is what the ruling did not give away — the two
  // tools that report model identity and billed counts, and the reads nobody has ruled on.
  for (const tool of ["get_telemetry", "get_provider_usage", "get_coverage", "search"]) {
    const r = await clientCall(tool, { runId: RUN_ID }, accountToken()).catch((e) => ({ error: String(e) }));
    assert.match(JSON.stringify(r), /FORBIDDEN|not available/i, `${tool} was reachable by a client account`);
  }
});
