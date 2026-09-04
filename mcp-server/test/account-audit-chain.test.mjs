// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// account-audit-chain.test.mjs — THE ACCEPTANCE for the owner's 2026-08-27 ruling, driven.
//
// "A client's AI, over the client connector with an account token, can read the audit chain of a run it is
// granted and nothing of a run it is not — driven with two tokens, not asserted."
//
// So this drives TWO account tokens, on two grants, against two runs, over the real client `/mcp` face —
// the same way a client's Claude or ChatGPT connector does. It never calls authorize() directly, for the
// reason client-view-wire.test.mjs states in its own header: a lib-level test passes green whether or not
// the gate is actually WIRED, and the leak it exists to catch is a missing line at the chokepoint.
//
// FALSIFIED IN BOTH DIRECTIONS, which is what makes each assertion a measurement rather than an absence:
//   · each token READS its own run's audit chain (positive: named content actually arrives)
//   · each token is REFUSED the other's, by name (negative)
//   · the scrub FIRES on the chain — an `[internal]` line planted in audit.md and narrative.md does not
//     survive, and the client-meaningful prose beside it does. Without the plant, "no internal marker in
//     the output" would pass on a fixture that never had one.
//   · a STAFF principal still reads the raw cut, byte-for-byte. A scrub that leaked onto the internal
//     review surface would break it just as quietly.
import { mkdtempSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "audit-chain-ws-"));
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "audit-chain-test-secret";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const { buildFixture, buildRichRun, RUN_ID, RUN_ID2 } = await import("./_fixture.mjs");
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

// THE PLANT. The fixture's audit trail is clean prose, so an assertion that no internal marker reaches a
// client would pass on it vacuously. These two lines are the specimen: `[internal]` is the form the MCP
// actually meets (publish has already consumed the `::p::` marker by the time report.md is on disk), and
// scrub.mjs's dropLabelledInternals is what has to eat it.
const PLANT = "- [internal] Enforcer basis is inferred from the opposition history, not stated.";
const KEEP = "dominant-element exact-in-class probe";

let clientUrl, clientSrv, staffUrl, staffSrv;
before(async () => {
  const fixture = buildFixture();
  buildRichRun();
  appendFileSync(join(fixture.runDir, "audit.md"), `\n${PLANT}\n`);
  appendFileSync(join(fixture.runDir, "narrative.md"), `\n${PLANT}\n`);

  // TWO TENANTS, TWO GRANTS, ONE GUEST LIST — the shape a real deployment has.
  const gdir = mkdtempSync(join(tmpdir(), "audit-chain-grants-"));
  writeFileSync(join(gdir, "grants.json"), JSON.stringify({
    tenants: {
      acme: { accounts: ["acme"], users: { "lawyer@acme.example": "*" } },
      myrkur: { accounts: ["myrkur"], users: { "counsel@myrkur.example": "*" } },
    },
  }));
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(gdir, "grants.json"));
  process.env.CLIENT_MCP_ACCOUNT_ACCESS = "1";
  // Each run has to BELONG to an account — an untagged run is visible only to a full grant, which is a
  // different refusal from the one this test is about.
  writeFileSync(driverDir(fixture.runDir, "profile.json"), JSON.stringify({ profileKey: "acme" }));
  const rich = join(ROOT, "workspace-test", "studio", "prelim-search", "archive", "2026-05", "tmpmyrk1-myrkur", "2026-05-20-iron-heron");
  writeFileSync(driverDir(rich, "profile.json"), JSON.stringify({ profileKey: "myrkur" }));

  const mk = async (opts, ns) => {
    const srv = createServer(makeHttpHandler({ verify: null, devMode: true, limiter: new RateLimiter({ perMinute: 500 }),
      sessions: new Map(), createSession, ns, ...opts }));
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    return [srv, `http://127.0.0.1:${srv.address().port}`];
  };
  [clientSrv, clientUrl] = await mk({ clientSurface: true, tokenOnly: false }, "audit-chain-client");
  [staffSrv, staffUrl] = await mk({}, "audit-chain-staff");
});
after(() => { for (const s of [clientSrv, staffSrv]) { try { s?.close(); } catch { /* best-effort */ } } });

const ACME = () => mintToken({ scope: "account", sub: "lawyer@acme.example", accounts: ["acme"], ttlSec: 3600 });
const MYRKUR = () => mintToken({ scope: "account", sub: "counsel@myrkur.example", accounts: ["myrkur"], ttlSec: 3600 });
const call = (tool, args, token) => mcpToolCall({ url: clientUrl, token, tool, args });
const staff = (tool, args) => mcpToolCall({ url: staffUrl, token: mintToken({ scope: "ops", sub: "ops" }), tool, args });
const refused = async (tool, args, token) => {
  const r = await call(tool, args, token).catch((e) => ({ error: String(e) }));
  return JSON.stringify(r);
};

// ---- 1. THE GRANTED RUN — the chain arrives -----------------------------------------------------

test("acme's token reads its own run's AUDIT TRAIL over the wire", async () => {
  const t = ACME();
  const art = await call("read_artifact", { runId: RUN_ID, name: "audit" }, t);
  assert.match(art.text ?? "", /# Audit Trail/, "the audit trail did not come back");
  assert.match(art.text ?? "", new RegExp(KEEP), "the audit trail's own reasoning was scrubbed away");

  const raw = await call("list_findings", { runId: RUN_ID, kind: "audit" }, t);
  assert.ok(Array.isArray(raw.items) && raw.items.length, "the raw audit view came back empty");
  assert.equal(raw.items[0].id, "AT1");
  assert.match(raw.items[0].rationale ?? "", new RegExp(KEEP), "the AT record lost its rationale");

  const one = await call("get_finding", { runId: RUN_ID, id: "AT1" }, t);
  assert.equal(one.id, "AT1", "get_finding did not resolve the audit record");
  assert.equal(one.step, "primary-sweep", "the audit record lost the step it names");
});

test("acme's token reads the decision chain — get_run, trace, decision_timeline", async () => {
  const t = ACME();
  const run = await call("get_run", { runId: RUN_ID }, t);
  assert.ok(run.stages.some((s) => s.stage === "register-digest"), "the stage list did not come back");
  assert.ok(run.artifacts.some((a) => a.name === "audit"), "the artifact inventory did not come back");
  // AND THE INVENTORY DOES NOT NAME WHAT THE READ REFUSES. artifactStatus() walks REPORTED_ARTIFACTS,
  // which carries the sealed set — so an unfiltered list hands a client a directory of documents it may
  // not open. A positive assertion alone would never have seen it.
  const named = run.artifacts.map((a) => a.name);
  for (const sealed of ["skepticFlags", "seniorEyeReview", "clientSummary", "placement", "findings", "reportOverview"])
    assert.ok(!named.includes(sealed), `get_run's inventory named the sealed artifact "${sealed}"`);

  const tr = await call("trace", { runId: RUN_ID, target: "narrative" }, t);
  assert.equal(tr.emittingStage.stage, "synthesis", "trace did not resolve the emitting stage");
  assert.ok(Array.isArray(tr.emittingStage.inputs) && tr.emittingStage.inputs.length, "trace lost its inputs");

  const tl = await call("decision_timeline", { runId: RUN_ID }, t);
  assert.ok(tl.timeline.length > 3, "the timeline came back empty");
  assert.ok(tl.timeline.some((e) => e.decision === "stage-completed"), "no stage decisions on the timeline");
  // The chain's CONCLUSION travels — dropping it here while trace keeps `judgment.verdict` would be two
  // surfaces disagreeing about one fact.
  assert.ok("verdict" in tl, "the timeline lost the verdict it exists to narrate");
  assert.ok("state" in tl, "the timeline lost the run's state");
  // And `riskLadderAvailable` does NOT: it says only whether diff_artifact could show the wording
  // change, and diff_artifact is sealed. A flag about a tool you cannot call is a dangling pointer.
  assert.equal(tl.riskLadderAvailable, undefined, "a flag about a sealed tool reached a client");
});

test("the register artifacts and the narrative are readable, by the prefixed axis spelling", async () => {
  const t = ACME();
  for (const name of ["narrative", "registerFindings", "commonLaw", "matterContext"]) {
    const r = await call("read_artifact", { runId: RUN_ID, name }, t);
    assert.ok((r.text ?? "").length > 0, `${name} came back empty`);
  }
  const ax = await call("read_artifact", { runId: RUN_ID, name: "registerUnit:primary-sweep" }, t);
  assert.ok((ax.text ?? "").length > 0, "the register axis came back empty");
  assert.match(await refused("read_artifact", { runId: RUN_ID, name: "primary-sweep" }, t), /registerUnit:<axis>/);
});

// ---- 2. THE SCRUB FIRES, and only on the client side --------------------------------------------

test("the planted [internal] line does not survive to a client, on either artifact", async () => {
  const t = ACME();
  for (const name of ["audit", "narrative"]) {
    const r = await call("read_artifact", { runId: RUN_ID, name }, t);
    assert.ok(!(r.text ?? "").includes("[internal]"), `an [internal] label reached a client on ${name}`);
    assert.ok(!/Enforcer basis is inferred/.test(r.text ?? ""), `the internal reasoning survived on ${name}`);
  }
});

test("the same bytes reach a STAFF principal unscrubbed — the plant is still there", async () => {
  // The other half of the same measurement: if this fails, the scrub is running on the internal review
  // surface too, and the plant above proved nothing about the client boundary.
  const r = await staff("read_artifact", { runId: RUN_ID, name: "audit" });
  assert.ok((r.text ?? "").includes("[internal]"), "a staff read came back scrubbed — the internal cut is gone");
});

test("COST never rides along: no model identity or token counts on the opened chain", async () => {
  const t = ACME();
  const blob = JSON.stringify(await Promise.all([
    call("get_run", { runId: RUN_ID }, t),
    call("trace", { runId: RUN_ID, target: "narrative" }, t),
    call("decision_timeline", { runId: RUN_ID }, t),
  ]));
  // The fixture's run.jsonl stamps a real model on every stage and its telemetry line carries token
  // counts, so each of these strings IS present in the raw results a staff principal gets.
  for (const leak of ["claude-opus", "claude-sonnet", "claude-haiku", "deepseek", "gemini"])
    assert.ok(!blob.includes(leak), `model identity "${leak}" reached a client account`);
  assert.ok(!/"providerUsage"/.test(blob), "the billed-usage tally reached a client account");
  assert.ok(!/senior-eye-review\.md/.test(blob), "a pointer to a sealed artifact reached a client account");
  assert.ok(!/"rationale"/.test(blob), "the reviewers' own prose reached a client account");
  // AND NO INTERNAL IDENTITY. trace's verdict branch ships a HARD-CODED sentence naming an internal
  // recipient — a literal, not model output, so no prose filter would ever have caught it. Driven on the
  // branch that emits it, because on any other target the string is absent and this passes vacuously.
  const v = await call("trace", { runId: RUN_ID, target: "verdict" }, t);
  assert.match(v.note ?? "", /gates delivery/, "the verdict branch stopped explaining itself");
  assert.ok(!/Alex/.test(JSON.stringify(v)), "an internal identity reached a client account");
});

// ---- 3. THE SECOND TOKEN — nothing of a run it is not granted ------------------------------------

test("myrkur's token reads its OWN run and is refused acme's, by name, on every opened read", async () => {
  const mine = MYRKUR();
  const own = await call("read_artifact", { runId: RUN_ID2, name: "registerFindings" }, mine);
  assert.match(own.text ?? "", /MYRKUR/, "myrkur's own run did not come back");

  for (const [tool, args] of [
    ["read_artifact", { runId: RUN_ID, name: "audit" }],
    ["list_findings", { runId: RUN_ID, kind: "audit" }],
    ["get_finding", { runId: RUN_ID, id: "AT1" }],
    ["get_run", { runId: RUN_ID }],
    ["trace", { runId: RUN_ID, target: "narrative" }],
    ["decision_timeline", { runId: RUN_ID }],
  ]) {
    const body = await refused(tool, args, mine);
    assert.match(body, /FORBIDDEN/, `${tool} was not refused across the grant`);
    assert.match(body, /does not include account/, `${tool} refused without saying it was the grant`);
    assert.ok(body.includes("acme"), `${tool} refused without naming the account it refused`);
    assert.ok(!body.includes("Beta Inc"), `${tool} leaked the other account's content in its refusal`);
  }
});

test("and the refusal runs the other way too — acme is refused myrkur's run", async () => {
  const body = await refused("read_artifact", { runId: RUN_ID2, name: "audit" }, ACME());
  assert.match(body, /does not include account/);
  assert.ok(body.includes("myrkur"), "the refusal did not name the account");
  assert.ok(!body.includes("Øksemorder"), "the refusal leaked the other account's content");
});

// ---- 4. THE REPORT LINK DID NOT MOVE ------------------------------------------------------------

test("a forwardable report-link token still reads the report and nothing of the chain", async () => {
  // The audience the ruling did not name. USER_ARTIFACTS gates read_artifact for BOTH client kinds, so
  // widening it in place rather than forking it would have opened the audit chain to a link riding
  // inside a delivered PDF. This is the test that would have caught that.
  const link = mintToken({ scope: "user", runId: RUN_ID, ttlSec: 3600 });
  const rep = await call("read_artifact", { runId: RUN_ID, name: "report" }, link);
  assert.ok((rep.text ?? "").length > 0, "the report link stopped reading the report");
  for (const name of ["audit", "narrative", "registerFindings", "matterContext", "registerUnit:primary-sweep"])
    assert.match(await refused("read_artifact", { runId: RUN_ID, name }, link), /may only read the report/, `${name} reached a report link`);
  for (const [tool, args] of [["get_run", {}], ["trace", { target: "narrative" }], ["decision_timeline", {}], ["get_finding", { id: "AT1" }]])
    assert.match(await refused(tool, { runId: RUN_ID, ...args }, link), /client layer only/, `${tool} reached a report link`);
  assert.match(await refused("list_findings", { runId: RUN_ID, kind: "audit" }, link), /curated group/);
});

// ---- 5. THE OTHER DOOR TO THE SAME BYTES --------------------------------------------------------

// A test-local transport driver, because portal-mcp-client exports only mcpToolCall and the product has
// no reason to grow a Resources client for a test. It duplicates the SDK handshake, never a policy rule —
// every gate this exercises still lives in server.mjs.
async function mcpRaw(token, method, params) {
  const endpoint = `${clientUrl}/mcp`;
  const h = (extra = {}) => ({ "content-type": "application/json", accept: "application/json, text/event-stream", "x-trademark-token": token, ...extra });
  const init = await fetch(endpoint, { method: "POST", headers: h(), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "audit-chain-test", version: "1" } } }) });
  const sid = init.headers.get("mcp-session-id");
  await init.text();
  const res = await fetch(endpoint, { method: "POST", headers: h({ "mcp-session-id": sid }), body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }) });
  return await res.text();
}

test("the Resources surface agrees with the tool surface, kind for kind", async () => {
  // Two surfaces disagreeing about one grant is the defect shared/scope.mjs cites twice. read_artifact
  // and resources/read are two doors to the same bytes, and BOTH gates keyed on CLIENT_KINDS — so
  // widening only the tool would have left this door sealing the chain the other one opened.
  const acme = ACME(), link = mintToken({ scope: "user", runId: RUN_ID, ttlSec: 3600 });

  const listed = await mcpRaw(acme, "resources/list", {});
  assert.ok(listed.includes(`${RUN_ID}/audit`), "the account's resource listing does not offer the audit trail");

  const read = await mcpRaw(acme, "resources/read", { uri: `trademark://run/${RUN_ID}/audit` });
  assert.ok(read.includes("Audit Trail"), "the account could not read the audit trail as a resource");
  assert.ok(!read.includes("[internal]"), "the Resources door served the internal cut");

  // The report link is sealed here exactly as it is on the tool door, and the account is still bounded.
  const denied = await mcpRaw(link, "resources/read", { uri: `trademark://run/${RUN_ID}/audit` });
  assert.match(denied, /may only read the report/, "a report link read the audit trail as a resource");
  const sealed = await mcpRaw(acme, "resources/read", { uri: `trademark://run/${RUN_ID}/status.json` });
  assert.match(sealed, /not readable by a client account/, "a sealed artifact was served as a resource");
});
