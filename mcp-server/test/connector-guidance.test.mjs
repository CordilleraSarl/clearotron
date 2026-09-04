// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// connector-guidance.test.mjs — the client pack actually REACHES a connecting client, and the
// methodology backstop drops machinery narration without eating legal prose.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ROOT = mkdtempSync(join(tmpdir(), "guidance-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "guidance-test-secret";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const { buildFixture, buildRichRun, buildKnockoutRun, RUN_ID } = await import("./_fixture.mjs");
const { instructionsFor } = await import("../lib/instructions.mjs");
const { makeHttpHandler } = await import("../lib/http-handler.mjs");
const { makeServer } = await import("../server.mjs");
const { RateLimiter } = await import("../lib/ratelimit.mjs");
const { mintToken } = await import("../../shared/scope.mjs");
const { scrubBody } = await import("../lib/scrub.mjs");

// ---- who gets briefed --------------------------------------------------------------------------

test("a CLIENT principal is briefed, and with the pack that matches what it can actually DO", () => {
  for (const kind of ["user", "account"]) {
    const text = instructionsFor({ kind });
    assert.ok(text, `${kind} got no instructions — the pack is not reaching connecting clients`);
    assert.match(text, /brief/, "the pack should name the tool ladder");
    assert.match(text, /never present the search as legal advice/i, "the pack's hard rules are missing");
  }
  // A report link is pinned to one finished search and must say so.
  assert.match(instructionsFor({ kind: "user" }), /read-only/i);
  // An account holds the whole account and can commission searches. Briefing it with the report-link
  // pack ("re-running searches … is outside this connector by design") would train the assistant to
  // refuse start_run — a tool it holds. It must instead carry the spend discipline.
  const acct = instructionsFor({ kind: "account" });
  assert.match(acct, /describe_options/, "the account pack must teach option discovery — otherwise the assistant guesses the menu, and the account key it is required to pass");
  assert.match(acct, /plan_run/, "the account pack must teach the free preview before any spend");
  assert.match(acct, /start_run/, "the account pack must describe commissioning a search");
  assert.doesNotMatch(acct, /connected, read-only, to \*\*one\*\*/i, "the account principal got the run-bound report-link pack");
});

test("no principal gets the CLIENT pack wrongly — ops gets its own, staff still gets none", () => {
  // THIS ARM CHANGED DELIBERATELY (, owner ruling 7). It used to assert that ops got
  // NOTHING, and that was right while ops meant OUR agents — briefed separately by the Claude Code
  // plugin, and reaching an engineering tool set the client pack does not describe.
  //
  // On a SELF-HOSTED install the customer IS ops. They connect over this same connector and were briefed
  // with nothing, while skills/clearotron-ops/SKILL.md sat shipped and undelivered — SKILL_DIR had mapped
  // it the whole time. So the premise changed, not the principle.
  const ops = instructionsFor({ kind: "ops" });
  assert.ok(ops, "ops is briefed with its own pack");

  // ITS OWN, AND NOT ONE OF THE OTHERS. The failure that matters is not "no pack" — it is the WRONG
  // pack, which is the exact defect the account/client split above exists to prevent. Asserted by
  // identity against the other two rather than by a phrase either might contain.
  assert.notEqual(ops, instructionsFor({ kind: "user" }), "ops must not receive the report-link pack");
  assert.notEqual(ops, instructionsFor({ kind: "account" }), "ops must not receive the account pack");

  // Staff are unchanged: still ours, still reaching tools no pack describes.
  assert.equal(instructionsFor({ kind: "internal" }), undefined, "staff still get none");
  assert.equal(instructionsFor({ kind: "nonsense" }), undefined, "an unknown kind gets none");
  assert.equal(instructionsFor(null), undefined, "and so does an absent scope");
});

test("1976 serving a pack widens what an assistant is TOLD, never what a principal may DO", () => {
  // A pack is guidance, not auth. This arm exists because "ops now gets something it did not get" is
  // the shape a reader could mistake for a privilege change — the verbs and the account scope are
  // decided in shared/scope.mjs and this function cannot reach them. Asserted by driving the scope
  // builder rather than by reading the comment that says so.
  const before = { kind: "ops", verbs: null, accounts: "*" };
  const text = instructionsFor(before);
  assert.ok(text, "the pack is served");
  assert.deepEqual(before, { kind: "ops", verbs: null, accounts: "*" },
    "instructionsFor mutated the scope it was handed — guidance must not touch authority");
});

// ---- it survives the wire ----------------------------------------------------------------------

let url, srv;
before(async () => {
  buildFixture();
  // — the mark-lookup arm needs a POPULATION, not one run: an archived
  // single-mark run and a batch knockout whose markName is "<first> +N more" are different members of
  // the class the lookup claims to cover.
  buildRichRun();
  buildKnockoutRun();
  const sessions = new Map();
  async function createSession(s, scope, owner = null) {
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const server = makeServer({ scope, local: false });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => s.set(id, { server, transport, lastSeen: Date.now(), email: owner, kind: scope?.kind ?? null }),
    });
    transport.onclose = () => { if (transport.sessionId) s.delete(transport.sessionId); };
    await server.connect(transport);
    return transport;
  }
  srv = createServer(makeHttpHandler({ verify: null, devMode: true, limiter: new RateLimiter({ perMinute: 500 }), sessions, createSession, ns: "guidance-test" }));
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { try { srv?.close(); } catch { /* best-effort */ } });

// raw initialize — mcpToolCall does not surface the init result, and `instructions` only rides there
async function initialize(token) {
  const res = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-trademark-token": token },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
  return JSON.parse(line.replace(/^data: /, "")).result;
}

test("wire: initialize carries the RIGHT pack for each token, ops included", async () => {
  // THE WIRE ARM, which is the one that matters: instructionsFor can return the correct text while the
  // server never puts it on `initialize`, and then every connecting assistant is briefed by nothing
  // while the unit arm above is green. This drives a real token through a real transport.
  const client = await initialize(mintToken({ scope: "user", runId: RUN_ID, ttlSec: 3600 }));
  assert.ok(client.instructions, "instructions absent on the wire — a connecting client is briefed by nothing");
  assert.match(client.instructions, /plain language/i);

  // CHANGED BY OWNER RULING 7: an ops token used to receive nothing here. On a
  // self-hosted install the customer IS ops — they connect over this connector and were briefed with
  // nothing while the ops pack shipped, mapped and undelivered.
  const ops = await initialize(mintToken({ scope: "ops", sub: "guidance-test", ttlSec: 3600 }));
  assert.ok(ops.instructions, "an ops principal reached initialize with no briefing — the pack ships and "
    + "SKILL_DIR maps it, so nothing was missing except the line that serves it");
  assert.notEqual(ops.instructions, client.instructions,
    "ops received the report-link pack, which briefs it for a surface it is not on");
});

// ---- the methodology backstop ------------------------------------------------------------------

test("machinery narration is dropped from client prose", () => {
  const cases = [
    "The senior-eye review escalated this finding.",
    "Our skeptic pass flagged the owner as unverified.",
    "A sub-agent re-ran the sweep.",
    "The refutation lane disagreed with the first read.",
    "This was produced with claude-4 under a token budget.",
    "Routed to anthropic/claude-opus for the second opinion.",
    "The orchestrator fanned out across nine lanes.",
  ];
  for (const s of cases) assert.equal(scrubBody(s).trim(), "", `machinery narration survived: ${s}`);
});

test("MARKS that share a model's name are NOT collateral damage", () => {
  // these are plausible real clearance subjects — a bare model-name token would delete the client's
  // own conflict finding, which is worse than the leak it prevents
  const keep = [
    "SONNET is registered by Beta Inc in class 9, and the mark is live.",
    "The HAIKU application was refused on absolute grounds.",
    "OPUS Corp owns the cited EU registration.",
    "CLAUDE is a personal name and a weak element in the mark.",
    "The goods are wireless, not wired.",
  ];
  for (const s of keep) assert.match(scrubBody(s), /\w/, `legitimate legal prose was deleted: ${s}`);
  assert.match(scrubBody(keep[0]), /SONNET is registered/);
  assert.match(scrubBody(keep[2]), /OPUS Corp/);
});

test("the Methodology OUTPUT still survives — only the machinery goes", () => {
  // the owner's line: what we covered is client product; how the engine did it is not
  const meth = "Register layer covered worldwide exact VENZY and a named edit-1 band (264 enumerated records). "
    + "Common-law layer covered 25 search terms across 9 platforms plus a 30-query connotation sweep.";
  const out = scrubBody(meth);
  assert.match(out, /264 enumerated records/);
  assert.match(out, /9 platforms/);
  assert.match(out, /connotation sweep/);
});

// ---- first contact: finding a mark, and what the tool list says to a lawyer -------

const { tools, attachHandlers } = await import("../server.mjs");
const { ACCOUNT_ARTIFACTS, USER_ARTIFACTS } = await import("../../shared/scope.mjs");
const { ListPromptsRequestSchema, GetPromptRequestSchema } =
  await import("@modelcontextprotocol/sdk/types.js");

// The served surface for one audience, built through attachHandlers — never by calling the description
// helper directly, which would assert the wiring instead of exercising it.
function servedSurface(kind) {
  const h = new Map();
  attachHandlers({ setRequestHandler(schema, fn) { h.set(schema, fn); } }, { scope: { kind, runId: RUN_ID }, local: false });
  return h;
}
async function servedTools(kind) {
  for (const fn of servedSurface(kind).values()) {
    try { const r = await fn({ params: {} }); if (r && Array.isArray(r.tools)) return r.tools; } catch { /* not tools/list */ }
  }
  throw new Error(`no tools/list handler for ${kind}`);
}

test("2164 a bare MARK NAME finds its runs — the filter that told a client his data did not exist", () => {
  const marks = (rs) => rs.map((r) => r.markName);
  // THE POPULATION FIRST. The exact-slug assertion below is satisfied identically by a working filter
  // and by an EMPTY WORKSPACE, and it passed against an empty one on this arm's first run — the fixture
  // builders for the archived and batch runs were not being called. An absence is a finding, so the
  // reachability of the run has to be asserted before its absence under a filter means anything.
  assert.ok(tools.list_runs({}).some((r) => r.markName === "MYRKUR"),
    "fixture population absent — every assertion below would pass on an empty account while measuring nothing");

  // THE FAILURE, REPRODUCED. Every slug in this fixture is prefixed, exactly like the real ones
  // ("tmpdemo2014knockoutsearch-venqori"), so the mark name a client types matches no slug at all and
  // an exact filter answers a populated account with an empty list.
  assert.deepEqual(tools.list_runs({ slug: "myrkur" }), [],
    "the fixture no longer reproduces the prefixed-slug shape this arm is about");

  // THE FIX, over a class rather than the one member it was written against: the plain name, the wrong
  // case, a substring, and a BATCH run whose markName is "<first> +N more" — a different member again.
  assert.deepEqual(marks(tools.list_runs({ mark: "myrkur" })), ["MYRKUR"]);
  assert.deepEqual(marks(tools.list_runs({ mark: "MyRkUr" })), ["MYRKUR"], "the lookup is case-sensitive — a client types their mark in their own case");
  assert.deepEqual(marks(tools.list_runs({ mark: "acme" })), ["ACME"]);
  assert.ok(marks(tools.list_runs({ mark: "halcyon" })).some((m) => /HALCYON/.test(m)),
    "a batch run's '<first> +N more' markName is not reachable by the name it cleared");
  // The slug half of the same lookup: a client who pastes the identifier from a report also lands.
  assert.ok(tools.list_runs({ mark: "tmpmyrk1" }).length >= 1, "the identifier a client might paste finds nothing");
  // An absence is still an absence.
  assert.deepEqual(tools.list_runs({ mark: "no-such-mark-anywhere" }), []);

  // AND THE MACHINE CALLER IS UNTOUCHED. enumerateRuns has driver consumers (status-snapshot,
  // repair-digest) that pass a slug meaning THAT ONE RUN; substring matching there would widen them
  // silently, which is why `mark` is a second parameter and not a loosening of `slug`.
  const exact = tools.list_runs({ slug: "tmpmyrk1-myrkur" });
  assert.equal(exact.length, 1);
  assert.equal(exact[0].markName, "MYRKUR");
  assert.deepEqual(tools.list_runs({ slug: "myrk" }), [], "the exact-slug filter started matching on a substring");
  // Filters still compose.
  assert.deepEqual(tools.list_runs({ mark: "myrkur", state: "no-such-state" }), []);

  // `mark` NARROWS AND NEVER WIDENS, which is what keeps it out of the account gate's way. list_runs is
  // a cross-run tool: a scoped session's rows are dropped by filterByAccounts AFTER the tool returns
  // (server.mjs), so the property that matters is that no filter value can surface a run the unfiltered
  // call does not already return. A one-character substring is the widest input there is.
  const everything = new Set(tools.list_runs({}).map((r) => r.runId));
  for (const needle of ["a", "e", "-", "tmp", ""]) {
    for (const r of tools.list_runs({ mark: needle }))
      assert.ok(everything.has(r.runId), `mark: "${needle}" surfaced ${r.runId}, which the unfiltered call does not return`);
  }
  assert.deepEqual(tools.list_runs({ mark: "" }).length, everything.size, "an empty mark silently narrowed the list");
});

test("2164 the tool descriptions a CLIENT reads carry no operator vocabulary — and ops keeps its own", async () => {
  // THE HOLE. visibleTools() filters tool NAMES per audience; nothing filtered the text riding with
  // them, so a lawyer's assistant was handed "ENGINEERING/AUDIT view", run.jsonl, the skeptic stage —
  // and start_run opening with "OPS-ONLY" at the one principal entitled to call it.
  const OPERATOR_VOCAB = /HEARTBEAT\.md|STATUS\.md|prelim-deliver|ENGINEERING\/AUDIT|run-dir|run\.jsonl|status\.json|agent workspace|pipeline stage|skeptic|ops only|OPS-ONLY|the driver|queue dir|docs\/|internal working documents|_history|_experiments|failover/i;
  for (const kind of ["user", "account"]) {
    for (const t of await servedTools(kind)) {
      assert.doesNotMatch(t.description, OPERATOR_VOCAB,
        `${kind} is handed operator vocabulary in the description of ${t.name}`);
      assert.ok(t.description.length > 40, `${kind}'s ${t.name} description was emptied rather than rewritten`);
    }
  }
  // A CUT, NOT A REWRITE. Ops is our own surface and its text is deliberately unchanged — if this goes
  // green because every description everywhere was sanitised, the arm above stops measuring anything.
  const opsText = (await servedTools("ops")).map((t) => t.description).join("\n");
  assert.match(opsText, OPERATOR_VOCAB, "the ops text was sanitised too — the audience cut has become a blanket rewrite");

  // The readable-artifact list is COMPUTED from the set authorize() enforces. A hand-typed list is how
  // a description comes to advertise an artifact the gate refuses by name (the old one offered
  // skeptikFlags, run.jsonl and an ops-only cover note to an account that cannot read any of them).
  const acctRead = (await servedTools("account")).find((t) => t.name === "read_artifact").description;
  for (const n of ACCOUNT_ARTIFACTS) assert.ok(acctRead.includes(n), `the account's readable list omits ${n}`);
  const userRead = (await servedTools("user")).find((t) => t.name === "read_artifact").description;
  for (const n of ACCOUNT_ARTIFACTS) {
    if (USER_ARTIFACTS.has(n)) continue;
    assert.ok(!new RegExp(`\\b${n}\\b`).test(userRead), `a report link is offered ${n}, which its own gate refuses`);
  }
});

test("2164 named prompts are offered to the client audiences, gated, and refused by name otherwise", async () => {
  const list = async (kind) => (await servedSurface(kind).get(ListPromptsRequestSchema)({ params: {} })).prompts.map((p) => p.name);
  const account = await list("account");
  const user = await list("user");
  assert.ok(account.includes("explain-my-report") && account.includes("what-wasnt-covered"),
    "the account surface offers no named prompts — the connector's front door is empty");
  assert.ok(user.includes("explain-my-report"), "a report link is offered no named prompts");

  // GATED LIKE THE PACK. A report-link principal holds one finished search and four tools; offering it
  // "Compare the search options" advertises a thing its own briefing calls out of scope.
  assert.ok(account.includes("compare-the-search-options"));
  assert.ok(!user.includes("compare-the-search-options"), "the report link was offered the account-only prompt");
  assert.deepEqual(await list("ops"), [], "ops is offered client prompts");
  assert.deepEqual(await list("internal"), [], "staff are offered client prompts");

  const get = (kind, name) => servedSurface(kind).get(GetPromptRequestSchema)({ params: { name } });
  const got = await get("account", "compare-the-search-options");
  assert.match(got.messages[0].content.text, /what this deployment can actually run/i);
  // An unoffered name is REFUSED BY NAME. An empty message would read to the model as "there is nothing
  // to ask here" — the absence-as-pass shape, one layer up.
  await assert.rejects(() => get("user", "compare-the-search-options"), /unknown prompt/);
  await assert.rejects(() => get("account", "no-such-prompt"), /unknown prompt/);

  // A prompt's text becomes the USER's message, so it must read as a question a lawyer asks — never as
  // an instruction naming the machinery, which is the same rule the pack states for chat.
  for (const kind of ["user", "account"]) {
    for (const name of await list(kind)) {
      const { messages } = await get(kind, name);
      const text = messages[0].content.text;
      assert.doesNotMatch(text, /\b(list_runs|read_artifact|list_findings|list_evidence|list_searches|get_run|trace|decision_timeline|start_run|plan_run|describe_options|brief)\b/,
        `the ${name} prompt names a tool in text the client sends as their own words`);
    }
  }
});

test("2164 the packs teach the product, and teach not to say the machinery out loud", () => {
  // ACCEPTANCE CASE #1 (the owner's transcript, 2026-09-03): the assistant told a client "nothing in
  // the findings touches meaning" about a clearance that ran a meaning seat, dozens of connotation
  // queries and native-language lanes. It was faithful to the findings list and wrong about the
  // product — the finding list is the conflicts layer, and the meaning reading is not in it.
  const acct = instructionsFor({ kind: "account" });
  const client = instructionsFor({ kind: "user" });
  for (const [who, pack] of [["account", acct], ["client", client]]) {
    assert.match(pack, /meaning/i, `the ${who} pack never mentions the meaning reading the product runs`);
    assert.match(pack, /connotation/i, `the ${who} pack never names the connotation reading`);
    // The rule that would have prevented the transcript: check the layer before denying the capability.
    assert.match(pack, /never deny a capability without checking/i, `the ${who} pack carries no rule against denying a capability the product has`);
    // A reading that ran and returned nothing is a RESULT. This is the absence-as-pass rule, stated for
    // the surface that talks to the client.
    assert.match(pack, /is a result/i, `the ${who} pack does not teach that an empty reading is a result`);
    // THE VOICE CONTRACT (owner ruling, 2026-09-03): clean prose for a lawyer, and the machinery stays
    // out of the answer. The pack still names tools — it has to, to steer which one is called — so the
    // rule is about what is SAID, not about what the pack may contain.
    assert.match(pack, /Never name a tool[^.]*in your answer/i, `the ${who} pack does not forbid naming tools to the client`);
    assert.match(pack, /Your reader is a lawyer/i, `the ${who} pack does not name its reader`);
  }
  // The account pack alone carries the lookup steering, because it is the only one that lists searches.
  assert.match(acct, /Look a mark up by its name/i, "the account pack does not teach the mark-name lookup");
  assert.match(acct, /not an absence/i, "the account pack does not teach broadening before reporting nothing");
  assert.match(acct, /commonLaw/, "the account pack does not say where the meaning reading is read from");
});
