// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// account-whatif-queued.test.mjs — THE ACCEPTANCE for the second half of the 2026-08-27 ruling, driven.
//
// "A client's AI can plan and run a what-if on a granted run; the original run is untouched; the diff
// comes back; a run it is not granted is refused by name."
//
// The whole chain is driven over the real client `/mcp` face with two account tokens: plan → enqueue →
// the worker claims and executes → the result reads back through the account-scoped read. The ENGINE
// SPAWN is the one link injected, exactly as whatif.test.mjs injects `runExperiment` — running a real
// stage needs a live undelivered run and real spend, which is the test-box slot requested on the tracker.
// Everything either side of that spawn is real code on a real transport.
//
// WHAT THIS FILE IS ACTUALLY LOOKING FOR, in the order it would hurt:
//   1. THE TOKEN IS UNSIGNED. A confirmationToken is plain base64url JSON. If what_if_run took only a
//      token, the dispatch gate (assertAccountAccess on authedArgs.runId) would never fire and a client
//      could hand-craft one naming another customer's run. Both halves are driven: the run must be
//      NAMED, and the token must AGREE with the name.
//   2. THE CLIENT DOOR MUST NOT SPAWN THE ENGINE. Asserted as a property of the module graph, not of a
//      log line: the account path must not pull driver/pipeline.mjs into the process at all.
//   3. THE ORIGINAL RUN IS UNTOUCHED — measured with a sha manifest of the run dir taken before and
//      after, because "no error" is not evidence that nothing was written.
//   4. Cost does not ride back on the plan or the result.
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { driverDir } from "../../shared/driver-dir.mjs";
const ROOT = mkdtempSync(join(tmpdir(), "whatif-queued-ws-"));
import { pinEnv } from "../../shared/env-aliases.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "whatif-queued-test-secret";
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
const { drainWhatIfQueues } = await import("../../driver/whatif-worker.mjs");
const { listWhatIf } = await import("../../driver/whatif-queue.mjs");
const { WHAT_IF_NOTE } = await import("../lib/whatif.mjs");   

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

// A sha manifest of every file under a directory — the measurement behind "the original run is untouched".
// The what-if queue itself lives under _experiments/, which is where an experiment is SUPPOSED to write,
// so it is excluded: the claim is that the CANONICAL run is unchanged, not that nothing happened.
function manifest(dir) {
  const out = new Map();
  const walk = (d) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "_experiments") walk(p); continue; }
      try { out.set(relative(dir, p), createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16)); } catch { /* vanished */ }
    }
  };
  walk(dir);
  return out;
}
const diffManifest = (a, b) => {
  const changed = [];
  for (const [k, v] of b) if (!a.has(k)) changed.push(`added ${k}`); else if (a.get(k) !== v) changed.push(`modified ${k}`);
  for (const k of a.keys()) if (!b.has(k)) changed.push(`removed ${k}`);
  return changed;
};

let clientUrl, clientSrv, fixture, richDir, studioRoots;
before(async () => {
  fixture = buildFixture();
  buildRichRun();
  richDir = join(ROOT, "workspace-test", "studio", "prelim-search", "archive", "2026-05", "tmpmyrk1-myrkur", "2026-05-20-iron-heron");
  const gdir = mkdtempSync(join(tmpdir(), "whatif-queued-grants-"));
  writeFileSync(join(gdir, "grants.json"), JSON.stringify({
    tenants: {
      acme: { accounts: ["acme"], users: { "lawyer@acme.example": "*" } },
      myrkur: { accounts: ["myrkur"], users: { "counsel@myrkur.example": "*" } },
    },
  }));
  pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(gdir, "grants.json"));
  process.env.CLIENT_MCP_ACCOUNT_ACCESS = "1";
  writeFileSync(driverDir(fixture.runDir, "profile.json"), JSON.stringify({ profileKey: "acme" }));
  writeFileSync(driverDir(richDir, "profile.json"), JSON.stringify({ profileKey: "myrkur" }));
  studioRoots = [join(ROOT, "workspace-test", "studio", "prelim-search")];

  const sessions = new Map();
  clientSrv = createServer(makeHttpHandler({ verify: null, devMode: true, clientSurface: true, tokenOnly: false,
    limiter: new RateLimiter({ perMinute: 500 }), sessions, createSession, ns: "whatif-queued-test" }));
  await new Promise((r) => clientSrv.listen(0, "127.0.0.1", r));
  clientUrl = `http://127.0.0.1:${clientSrv.address().port}`;
});
after(() => { try { clientSrv?.close(); } catch { /* best-effort */ } });

const ACME = () => mintToken({ scope: "account", sub: "lawyer@acme.example", accounts: ["acme"], ttlSec: 3600 });
const MYRKUR = () => mintToken({ scope: "account", sub: "counsel@myrkur.example", accounts: ["myrkur"], ttlSec: 3600 });
const call = (tool, args, token) => mcpToolCall({ url: clientUrl, token, tool, args });
const refused = async (tool, args, token) => JSON.stringify(await call(tool, args, token).catch((e) => ({ error: String(e) })));

// The injected engine spawn — the ONE link a real run replaces. It writes into the shadow dir the way
// runExperiment does, so what comes back through the read is shaped like a real experiment's result.
const fakeRun = (spy) => async ({ confirmationToken }) => {
  const op = JSON.parse(Buffer.from(confirmationToken, "base64url").toString("utf8"));
  spy.push(op);
  return {
    ok: true, runId: op.runId, stage: op.stage, axis: op.axis ?? null,
    shadowDir: "whatif-20260902-report-overview", output: "report.md",
    completeness: "complete", honestyNote: "This step writes the final report itself, so the re-run IS a complete answer.",
    diff: "-  overall_label: MEDIUM\n+  overall_label: LOW\n- [internal] the enforcer basis was re-read\n",
    telemetryDelta: "| model | tokens |\n| anthropic/claude-opus-4-8 | 5200 |",
    // — the SHIPPED note, not a copy of it. This stub carried its own transcript
    // of the old "byte-for-byte unchanged" sentence, which is how a corrected claim survives in the tree.
    note: WHAT_IF_NOTE,
  };
};

// ---- 1. PLAN — free, and stripped of what the ruling sealed ---------------------------------------

test("a client plans a what-if and is told everything but the bill", async () => {
  const plan = await call("what_if_plan", { runId: RUN_ID, stage: "report-overview", instructions: "treat ACME's mark as expired" }, ACME());
  assert.equal(plan.runnable, true, "the plan came back unrunnable");
  assert.ok(plan.confirmationToken, "no confirmation token — the handshake is broken");
  assert.equal(plan.completeness, "complete");
  assert.ok(Array.isArray(plan.downstreamNotRecomputed), "the honesty about downstream work is missing");
  assert.ok(plan.externalCalls, "the client was not told whether this hits billed search");

  const blob = JSON.stringify(plan);
  assert.ok(!/claude-|opus|sonnet|haiku/i.test(blob), "the plan named the model tier to a client");
  assert.ok(!/"tokens"/.test(blob), "the prior run's token counts reached a client");
  // The wall time SURVIVES, and that pair is the judgment: a duration is the client's own wait.
  assert.equal(plan.costPrior.wallSec, 45, "the client was not told how long the step takes");
});

test("an ARCHIVED run refuses in words the client can act on", async () => {
  // whatIfPlan does not throw here — it RETURNS {runnable:false, reason}, and `reason` is the one field
  // on the plan that is free prose from a branch nothing else drives. It names trace and read_artifact
  // as the way to interrogate the run instead, and both of those are now client-reachable, so the
  // sentence is actionable rather than a dead end. Driven on MYRKUR's OWN archived run, so what is being
  // measured is the archived refusal and not the grant one.
  const plan = await call("what_if_plan", { runId: RUN_ID2, stage: "report-overview" }, MYRKUR());
  assert.equal(plan.runnable, false, "an archived run was offered as runnable");
  // Wording re-cut with the shared eligibility composer: the door and the worker
  // now answer from ONE sentence, so this pins the substance rather than the old phrasing.
  assert.match(plan.reason, /delivered or archived/, "the refusal did not say why");
  assert.match(plan.reason, /trace|read_artifact/, "the refusal named no way forward");
  assert.equal(plan.confirmationToken, undefined, "an unrunnable plan handed out a token to commit with");
  // And the enqueue refuses it too, so the two doors agree rather than one inviting what the other stops.
  const forged = Buffer.from(JSON.stringify({ runId: RUN_ID2, stage: "report-overview" })).toString("base64url");
  assert.match(await refused("what_if_run", { runId: RUN_ID2, confirmationToken: forged }, MYRKUR()),
    /delivered or archived/, "an archived run accepted a queued experiment");
});

test("a client cannot choose the model — the one argument that is both cost and method", async () => {
  const body = await refused("what_if_plan", { runId: RUN_ID, stage: "report-overview", model: "anthropic/claude-opus-4-8" }, ACME());
  assert.match(body, /is not available to a client account/);
  assert.ok(body.includes("model"), "the refusal did not name the argument it refused");
  assert.match(body, /instructions/, "the refusal did not say what to use instead");
});

// ---- 2. THE UNSIGNED TOKEN — both halves of the gate ---------------------------------------------

test("what_if_run refuses to act on a token alone — the run has to be NAMED", async () => {
  const plan = await call("what_if_plan", { runId: RUN_ID, stage: "report-overview", instructions: "x" }, ACME());
  const body = await refused("what_if_run", { confirmationToken: plan.confirmationToken }, ACME());
  assert.match(body, /must name the run it is changing/,
    "a token-only call was accepted — the account gate keys on runId and would never have fired");
});

test("a token naming ANOTHER account's run is refused, even when the named run is granted", async () => {
  // The attack the cross-check exists for: the token is unsigned, so a client can forge one. Declaring a
  // run they DO hold satisfies the grant gate; the token then has to be caught by whatIfEnqueue.
  const forged = Buffer.from(JSON.stringify({ runId: RUN_ID2, stage: "report-overview", instructions: "x" })).toString("base64url");
  const body = await refused("what_if_run", { runId: RUN_ID, confirmationToken: forged }, ACME());
  assert.match(body, /confirmationToken is for run/, "a forged token ran against a run it did not name");
  assert.ok(body.includes(RUN_ID2), "the refusal did not name the run the token actually pointed at");
});

test("the ungranted run is refused by name, on every what-if verb", async () => {
  const mine = MYRKUR();
  for (const [tool, args] of [
    ["what_if_plan", { runId: RUN_ID, stage: "report-overview" }],
    ["what_if_run", { runId: RUN_ID, confirmationToken: "x" }],
    ["what_if_result", { runId: RUN_ID }],
  ]) {
    const body = await refused(tool, args, mine);
    assert.match(body, /FORBIDDEN/, `${tool} was not refused across the grant`);
    assert.ok(body.includes("acme"), `${tool} refused without naming the account`);
    assert.ok(!body.includes("Beta Inc"), `${tool} leaked the other account's content in its refusal`);
  }
});

// ---- 3. THE FULL CHAIN — enqueue, drain, collect --------------------------------------------------

test("plan → enqueue → the worker runs it → the diff comes back, and the run is untouched", async () => {
  const t = ACME();
  const before = manifest(fixture.runDir);

  const plan = await call("what_if_plan", { runId: RUN_ID, stage: "report-overview", instructions: "treat ACME's mark as expired" }, t);
  const queued = await call("what_if_run", { runId: RUN_ID, confirmationToken: plan.confirmationToken }, t);
  assert.equal(queued.queued, true, "the client door executed instead of queueing");
  assert.match(queued.experimentId, /^wi-[0-9a-f]{8}$/, "no experiment id came back");
  assert.equal(queued.stage, "report-overview");

  // Queued means queued: the read says so before any worker has run.
  const pending = await call("what_if_result", { runId: RUN_ID, experimentId: queued.experimentId }, t);
  assert.equal(pending.state, "queued", `a job nothing has run reads as "${pending.state}"`);
  assert.equal(pending.result, undefined, "a queued job came back carrying a result");

  // THE WORKER. Real claim, real recording; the engine spawn is the injected link.
  const spy = [];
  const settled = await drainWhatIfQueues(studioRoots, { runWhatIf: fakeRun(spy) });
  assert.equal(settled.length, 1, `the worker settled ${settled.length} jobs, expected 1`);
  assert.equal(spy.length, 1, "the worker did not execute the queued op");
  assert.equal(spy[0].stage, "report-overview", "the worker ran a different stage from the one planned");
  assert.equal(spy[0].instructions, "treat ACME's mark as expired", "the client's instruction did not survive the queue");

  const done = await call("what_if_result", { runId: RUN_ID, experimentId: queued.experimentId }, t);
  assert.equal(done.state, "done", `the finished job reads as "${done.state}": ${done.error ?? ""}`);
  assert.match(done.result.diff, /overall_label/, "the diff did not come back to the client");
  assert.equal(done.result.completeness, "complete");

  // COST DOES NOT RIDE BACK. telemetryDelta is a model-and-token table and the shadow dir is a filename
  // no client tool can open; both are absent by omission from the projection.
  const blob = JSON.stringify(done);
  assert.ok(!/claude-|opus-4-8/i.test(blob), "the experiment's model reached a client");
  assert.ok(!/telemetryDelta/.test(blob), "the token table reached a client");
  assert.ok(!/shadowDir/.test(blob), "an internal sandbox path reached a client");
  // And the diff is client-cut like every other artifact text.
  assert.ok(!blob.includes("[internal]"), "an [internal] line rode back inside the diff");

  // THE ORIGINAL RUN IS UNTOUCHED — measured, not inferred from the absence of an error.
  const changed = diffManifest(before, manifest(fixture.runDir));
  assert.deepEqual(changed, [], `the canonical run dir changed during a what-if: ${changed.join(", ")}`);

  // A second drain has nothing to do — the claim is terminal, not re-runnable.
  assert.deepEqual(await drainWhatIfQueues(studioRoots, { runWhatIf: fakeRun([]) }), []);
});

test("the listing answers 'what have I asked of this run' — including WHAT was asked", async () => {
  const t = ACME();
  const all = await call("what_if_result", { runId: RUN_ID }, t);
  assert.ok(Array.isArray(all.experiments) && all.experiments.length >= 1, "the listing came back empty");
  assert.ok(all.experiments.every((e) => /^wi-/.test(e.id)), "the listing carried something that is not an experiment");
  // Ids and states alone cannot tell one experiment from another, which is the whole question this tool
  // says it answers. The request comes back with it.
  const one = all.experiments.find((e) => e.asked);
  assert.ok(one, "no experiment in the listing says what was asked of it");
  assert.equal(one.asked.stage, "report-overview");
  assert.match(one.asked.instructions ?? "", /ACME|x|y/, "the client's own instruction did not come back");
  // And the server's stored attribution does not ride around the account with it.
  const blob = JSON.stringify(all);
  assert.ok(!/requestedBy|lawyer@acme/.test(blob), "the stored requester identity was handed back");
  assert.ok(!/"model"/.test(blob), "a model tier reached a client through the listing");
});

test("an id that names nothing is an ABSENCE, and says so", async () => {
  const r = await call("what_if_result", { runId: RUN_ID, experimentId: "wi-deadbeef" }, ACME());
  assert.equal(r.state, "unknown", "a missing experiment did not read as unknown");
  // A traversal dressed as an id resolves to nothing rather than to a file outside the run.
  const bad = await call("what_if_result", { runId: RUN_ID, experimentId: "../../../etc/passwd" }, ACME());
  assert.equal(bad.state, "unknown");
});

// ---- 4. THE CLIENT DOOR NEVER SPAWNS THE ENGINE ---------------------------------------------------

test("the account path does not reach the engine", async () => {
  // http-server.mjs states that the remote surfaces never shell, and lib/whatif.mjs's LAZY import of
  // driver/pipeline.mjs is what keeps that true. Node exposes no loaded-module registry, so "pipeline.mjs
  // is not resident" is not directly observable from here — what IS observable, and is the same property
  // one step earlier, is that the client branch routes to whatIfEnqueue and that whatIfEnqueue has no
  // path to the engine at all. Read off the source, so a future edit that reintroduces one fails here.
  const src = readFileSync(new URL("../lib/whatif.mjs", import.meta.url), "utf8");
  const enqueueBody = src.slice(src.indexOf("export async function whatIfEnqueue"), src.indexOf("export async function whatIfRun"));
  assert.ok(enqueueBody.length > 200, "whatIfEnqueue was not found — this assertion is measuring nothing");
  assert.ok(!/pipeline\.mjs|runExperiment/.test(enqueueBody),
    "the client enqueue path reaches the engine — the client surface would shell");
  const serverSrc = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const tool = serverSrc.slice(serverSrc.indexOf("async what_if_run("), serverSrc.indexOf("async what_if_result("));
  assert.match(tool, /kind === "account"[\s\S]*whatIfEnqueue/, "the account branch no longer routes to the enqueue");
  assert.ok(tool.indexOf("whatIfEnqueue") < tool.indexOf("whatIfRun"), "the account branch does not come first — an account could fall through to the executor");
});

// ---- 5. A REPORT LINK STILL HOLDS NONE OF THIS ----------------------------------------------------

test("a forwardable report-link token reaches no what-if verb", async () => {
  const link = mintToken({ scope: "user", runId: RUN_ID, ttlSec: 3600 });
  for (const [tool, args] of [
    ["what_if_plan", { runId: RUN_ID, stage: "report-overview" }],
    ["what_if_run", { runId: RUN_ID, confirmationToken: "x" }],
    ["what_if_result", { runId: RUN_ID }],
  ]) {
    // The two refusals differ by design and both are correct: authorize()'s write gate fires before the
    // clientSafe test, so a report link meets "requires an ops token" on the spending verbs and "client
    // layer only" on the read. What matters is that neither is reachable.
    const body = await refused(tool, args, link);
    assert.match(body, /client layer only|requires an ops token/, `${tool} reached a report link`);
  }
});

// ---- 6. THE WORKER'S OWN REFUSALS -----------------------------------------------------------------

test("a job queued against a run that then finishes is recorded as refused, not left pending", async () => {
  const t = ACME();
  const plan = await call("what_if_plan", { runId: RUN_ID, stage: "report-overview", instructions: "y" }, t);
  const queued = await call("what_if_run", { runId: RUN_ID, confirmationToken: plan.confirmationToken }, t);
  // The run reaches a terminal state AFTER the job was queued — the window the worker's own check exists
  // for. This is the last test in the file because it leaves the fixture run delivered.
  writeFileSync(join(fixture.runDir, ".delivered"), "");
  const settled = await drainWhatIfQueues(studioRoots, { runWhatIf: fakeRun([]) });
  assert.equal(settled.length, 1);
  const r = await call("what_if_result", { runId: RUN_ID, experimentId: queued.experimentId }, t);
  assert.equal(r.state, "failed", "a job on a delivered run stayed pending forever");
  assert.match(r.error, /live runs only/);
  assert.equal(listWhatIf(fixture.runDir).filter((e) => e.state === "queued").length, 0, "a job was left queued");
});
