// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// account-principal.test.mjs — the signed-in CLIENT principal (kind "account").
//
// What this has to prove, in order of what it would cost to get wrong:
//   1. A client cannot spend without the daily allowance applying. runCaps.dailyRuns only bites jobs
//      stamped clientPrincipal:true, and that stamp is POSITIVE-ONLY (absent ⇒ uncapped), so if the MCP
//      door forgets it a demo tenant runs unlimited paid searches. The chokepoint must force it.
//   2. A client cannot reach another customer's account, by any argument they control.
//   3. A client cannot reach the METHODOLOGY — the engineering reads stay denied even though this
//      principal has far more reach than a report-link token.
//   4. Turning the feature off, or misconfiguring it, fails CLOSED.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveScope, authorize, visibleTools, TOOL_SCOPES, mintToken } from "../lib/scope.mjs";

// resolveScope reads the grants FILE, so these tests write one and point the env at it.
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
const GRANTS = { tenants: { acme: { accounts: ["acme", "acme-eu"], users: { "lawyer@acme.example": "*" } } } };
const dir = mkdtempSync(join(tmpdir(), "acct-grants-"));
const grantsPath = join(dir, "grants.json");
writeFileSync(grantsPath, JSON.stringify(GRANTS));

const withEnv = (env, fn) => {
  const saved = {};
  // — PIN EVERY SPELLING, and SAVE every spelling too. `pinEnv` writes the
  // whole alias set, so a restore that remembered only the key it was handed would delete the sibling
  // spelling an outer harness had set rather than putting it back.
  for (const [k, v] of Object.entries(env)) {
    saved[k] = Object.fromEntries([k].map((s) => [s, process.env[s]]));
    pinEnv(process.env, k, v ?? undefined);
  }
  try { return fn(); } finally { for (const prior of Object.values(saved)) for (const [s, v] of Object.entries(prior)) { if (v === undefined) delete process.env[s]; else process.env[s] = v; } }
};
const clientScope = (email = "lawyer@acme.example") =>
  withEnv({ CLEAROTRON_ACCESS_FILE: grantsPath }, () =>
    resolveScope({ clientSurface: true, innerToken: null, email, accountAccess: true }));

// ---- 1. the money path -------------------------------------------------------------------------

test("start_run is FORCED to carry the daily-allowance stamp", () => {
  const scope = clientScope();
  const out = authorize(scope, "start_run", { profileKey: "acme", markName: "ZEPHYR", classes: [9], forwarder: "x" });
  assert.equal(out.clientPrincipal, true,
    "an MCP-started run was NOT stamped clientPrincipal — runCaps.dailyRuns would not apply and the client runs uncapped");
});

test("a client cannot buy an uncapped day by passing clientPrincipal:false", () => {
  const out = authorize(clientScope(), "start_run", { profileKey: "acme", markName: "Z", forwarder: "x", clientPrincipal: false });
  assert.equal(out.clientPrincipal, true, "the caller overrode the allowance stamp");
});

test("plan_run — the FREE preview — is usable without the caller inventing a forwarder", () => {
  // it reached buildJob with no forwarder and died on "forwarder is required — …rides the delivery
  // packet (docs/DELIVERY.md)": an internal-doc reference a client's assistant cannot act on, on the one
  // call a client is most likely to make first.
  const out = authorize(clientScope(), "plan_run", { profileKey: "acme", markName: "Z", classes: [9] });
  assert.ok(out.forwarder, "plan_run still requires the client to invent a forwarder");
  assert.equal(out.forwarderEmail, "lawyer@acme.example");
  assert.equal(out.clientPrincipal, undefined,
    "a FREE preview must not be stamped — it would consume a day's allowance without spending anything");
});

test("attribution is server-stamped from the verified identity, not caller-supplied", () => {
  const out = authorize(clientScope(), "start_run", { profileKey: "acme", markName: "Z", forwarder: "x", forwarderEmail: "spoof@evil.example" });
  assert.equal(out.forwarderEmail, "lawyer@acme.example", "a client set their own reply-routing identity");
});

test("start_run/plan_run are bounded by the grant — including the implicit generic account", () => {
  const scope = clientScope();
  for (const tool of ["start_run", "plan_run"]) {
    assert.throws(() => authorize(scope, tool, { profileKey: "someone-else", markName: "Z", forwarder: "x" }),
      /grant .* does not include/, `${tool} crossed into another customer's account`);
    // omitting profileKey means the neutral "generic" profile — that too must be granted explicitly,
    // else omission is a way OUT of the grant
    assert.throws(() => authorize(scope, tool, { markName: "Z", forwarder: "x" }),
      /grant .* does not include account "generic"/, `${tool}: omitting profileKey escaped the grant`);
  }
});

// ---- 2 & 3. reach ------------------------------------------------------------------------------

test("the account tool set is the client layer + evidence + the AUDIT CHAIN + own-run lifecycle", () => {
  const allowed = Object.keys(TOOL_SCOPES).filter((t) => visibleTools({ kind: "account" })(t)).sort();
  // — server_info JOINS this set deliberately. It is the AGPL §13 source offer, and an offer a
  // client session may not call is not an offer; it reads no run and no account data, returning only
  // published facts about published code. This list is pinned exactly so that a tool reaching the
  // account layer has to be argued for in a diff rather than arriving quietly — which is what this
  // comment is.
  //
  // OWNER RULING 2026-08-27 ("I don't see why we don't open it or just give it to clients. Ignore the
  // call spend.") adds the four AUDIT-CHAIN reads: decision_timeline, get_finding, get_run, trace. The
  // reasoning is in shared/scope.mjs at ACCOUNT_ARTIFACTS; what it comes to here is that the decision
  // chain is the client's and the firm keeps model identity, billed counts and its own quality
  // judgments. The sealed half is pinned in its own test below, which is the half that matters.
  //
  // AND THE SAME RULING'S SECOND HALF adds what-if: `what_if_plan`, `what_if_run`, `what_if_result`.
  // Over the client connector what_if_run ENQUEUES — it never spawns the engine, which is what keeps the
  // remote surfaces' "NEVER shells" property a fact about the code rather than a convention.
  assert.deepEqual(allowed, ["brief", "decision_timeline", "describe_options", "get_finding", "get_run",
    "get_search_coverage", "list_evidence", "list_findings", "list_runs", "list_searches", "plan_run",
    "read_artifact", "server_info", "start_run", "stop_run", "trace",
    "what_if_plan", "what_if_result", "what_if_run"].sort());
});

// describe_options tells a session what it may ORDER and which account it holds — the option space plus
// its own profileKey, projects, saved searches and allowance. That is the client's own product, so it
// rides the account layer beside plan_run. It is NOT clientSafe, and the distinction is the same one the
// evidence layer draws: an account principal is an identity the firm enrolled, while a report-link token
// rides inside a delivered document and can be forwarded to anyone. A forwardable link that could
// enumerate the depths, the account's projects and its remaining allowance is a different product.
test("describe_options is an ACCOUNT tool and is denied to a forwardable report link", () => {
  assert.doesNotThrow(() => authorize(clientScope(), "describe_options", {}));
  assert.throws(() => authorize({ kind: "user", runId: "r1" }, "describe_options", {}),
    /not available to a client \(user\) token — client layer only/);
  assert.equal(visibleTools({ kind: "user" })("describe_options"), false,
    "a report-link session must not even SEE it in the tool list");
});

test("describe_options: an OMITTED account is the discovery question; a NAMED one is grant-gated", () => {
  const scope = clientScope();
  // start_run/plan_run REQUIRE profileKey from an accounts-scoped session, and list_profiles is denied
  // to it — so refusing the omitted form here would re-open the dead end this tool exists to close.
  assert.doesNotThrow(() => authorize(scope, "describe_options", {}));
  assert.doesNotThrow(() => authorize(scope, "describe_options", { profileKey: "acme" }));
  assert.throws(() => authorize(scope, "describe_options", { profileKey: "someone-else" }),
    /grant .* does not include account "someone-else"/);
});

// The evidence layer is accountSafe and NOT clientSafe — a granted identity, never a forwardable report
// link. This is the decision the owner took when it shipped, so it is pinned rather than left to the
// registry: flipping clientSafe on would put a run's whole record set behind a link inside a delivered PDF.
test("the evidence layer is reachable by an ACCOUNT and not by a report-link token", () => {
  const account = clientScope();
  for (const tool of ["list_evidence", "list_searches", "get_search_coverage"]) {
    assert.doesNotThrow(() => authorize(account, tool, { runId: "r1" }), `${tool} must be reachable by an account`);
    assert.throws(() => authorize({ kind: "user", runId: "r1" }, tool, { runId: "r1" }),
      /not available to a client \(user\) token/, `${tool} must NOT be reachable from a forwardable report link`);
  }
});

// WHAT THE 2026-08-27 RULING DID NOT GIVE AWAY. The old form of this test read "every engineering read
// is denied" and listed nineteen tools; the ruling opened four of them, so the list is smaller and the
// reason is narrower — and stating the narrower reason is the whole point of re-cutting it rather than
// deleting the names that moved.
//
// COST is the first half: get_telemetry and get_provider_usage exist to report model identity and billed
// counts, which is the firm's cost structure and not an audit fact. That line is cheap to hold because
// every other decision-chain read is model-free by construction — events.mjs, trace.mjs and getStages
// each say so on their own surface — so sealing exactly these two costs a client nothing of the chain.
//
// UNRULED is the second half, and it is deliberately not dressed up as a principle. Nobody has decided
// what get_coverage, search, diff_artifact or run_changes should show a client, and shared/scope.mjs's
// default is that an undecided tool is denied. If the owner widens them, this list shrinks again.
test("COST and the UNRULED reads stay sealed to a client account", () => {
  const scope = clientScope();
  for (const tool of ["get_telemetry", "get_provider_usage", "get_coverage", "search", "search_runs",
    "diff_artifact", "run_changes", "list_profiles", "get_delivery_packet", "list_outbox_events",
    "feed_context", "mark_sent", "ack_event"]) {
    assert.throws(() => authorize(scope, tool, { runId: "r1" }), /not available to a client account session/,
      `"${tool}" was reachable by a client account`);
  }
});

test("the AUDIT CHAIN is reachable by an ACCOUNT and still refused to a forwardable report link", () => {
  const account = clientScope();
  for (const tool of ["get_run", "trace", "decision_timeline", "get_finding"]) {
    assert.doesNotThrow(() => authorize(account, tool, { runId: "r1" }), `${tool} must be reachable by an account`);
    // The report-link token is the audience the ruling did NOT name: it rides inside a delivered PDF and
    // can be forwarded to anyone. Widening USER_ARTIFACTS in place would have opened it here too.
    assert.throws(() => authorize({ kind: "user", runId: "r1" }, tool, { runId: "r1" }),
      /not available to a client \(user\) token/, `${tool} reached a forwardable report link`);
    assert.equal(visibleTools({ kind: "user" })(tool), false, `${tool} was listed to a report-link session`);
  }
});

test("the audit-chain artifacts open for an ACCOUNT; the rest stay sealed BY NAME", () => {
  const scope = clientScope();
  for (const name of ["report", "audit", "narrative", "registerFindings", "commonLaw", "caseLaw",
    "matterContext", "registerUnit:primary-sweep", "register-unit:primary-sweep"])
    assert.doesNotThrow(() => authorize(scope, "read_artifact", { runId: "r1", name }), `${name} was refused to an account`);

  // STILL SEALED, and each for a reason stated at ACCOUNT_ARTIFACTS: status.json/run.jsonl are JSON that
  // the markdown scrub would pass through untouched (and carry codename, agent id, paths and stacks);
  // the two reviewer files are the engine's judgment of its OWN output, the class; clientSummary is
  // ops-only — one report, and the cover-note source is not it.
  for (const name of ["run.jsonl", "status.json", "skepticFlags", "seniorEyeReview", "clientSummary",
    "placement", "findings", "primary-sweep", "registerUnit:../../x"])
    assert.throws(() => authorize(scope, "read_artifact", { runId: "r1", name }), /not readable by a client account/,
      `${name} reached a client account`);

  // A BARE AXIS NAME IS REFUSED ON PURPOSE. Staff read_artifact accepts "primary-sweep"; this gate wants
  // the prefix, because an unprefixed axis could only be matched by shape and "placement" has the same
  // shape. The refusal names the spelling that works.
  assert.throws(() => authorize(scope, "read_artifact", { runId: "r1", name: "primary-sweep" }),
    /registerUnit:<axis>/);

  // THE REPORT LINK IS UNTOUCHED — the set it reads did not move.
  for (const name of ["audit", "narrative", "matterContext", "registerUnit:primary-sweep"])
    assert.throws(() => authorize({ kind: "user", runId: "r1" }, "read_artifact", { runId: "r1", name }),
      /may only read the report/, `${name} reached a forwardable report link`);
});

test("list_findings: an ACCOUNT reaches the raw audit trail; a report link never does", () => {
  const scope = clientScope();
  // The raw path is what "read the audit trail" means, and it is the half the ruling opened.
  for (const kind of ["findings", "negatives", "audit"])
    assert.doesNotThrow(() => authorize(scope, "list_findings", { runId: "r1", kind }), `kind:${kind} was refused`);
  assert.doesNotThrow(() => authorize(scope, "list_findings", { runId: "r1" }), "the default kind was refused");
  assert.throws(() => authorize(scope, "list_findings", { runId: "r1", kind: "nonsense" }), /kind must be one of/);

  // A GROUP still means the cards path, and the raw-view args are still stripped off it — otherwise the
  // handler could reach filterFindings with a group set and answer from two paths at once.
  const out = authorize(scope, "list_findings", { runId: "r1", group: "on-field", kind: "audit", sourceLayer: "Register" });
  assert.equal(out.kind, undefined, "the raw-view args survived onto the cards path");
  assert.equal(out.sourceLayer, undefined);
  assert.throws(() => authorize(scope, "list_findings", { runId: "r1", group: "invented" }), /curated group/);

  // The forwardable link is unchanged: cards only.
  assert.throws(() => authorize({ kind: "user", runId: "r1" }, "list_findings", { runId: "r1", kind: "audit" }),
    /curated group/, "a report link reached the raw audit trail");
});

// ---- 4. fail-closed ----------------------------------------------------------------------------

test("account access is OFF unless explicitly enabled", () => {
  assert.throws(
    () => withEnv({ CLEAROTRON_ACCESS_FILE: grantsPath, CLIENT_MCP_ACCOUNT_ACCESS: null },
      () => resolveScope({ clientSurface: true, innerToken: null, email: "lawyer@acme.example" })),
    /requires a run-scoped token/, "deploying the code alone opened the door");
});

test("NO grants file ⇒ refused, never an unscoped wildcard", () => {
  // accountsForEmail returns "*" with no grants file; admitting that would be read-all across customers
  assert.throws(
    () => withEnv({ CLEAROTRON_ACCESS_FILE: null }, () =>
      resolveScope({ clientSurface: true, innerToken: null, email: "lawyer@acme.example", accountAccess: true })),
    /refusing an unscoped wildcard/);
});

test("an identity granted nothing is refused, not given an empty read-all", () => {
  assert.throws(() => clientScope("stranger@nowhere.example"), /not granted any account/);
});

test("an ops token is still refused here — account access did not widen the token rules", () => {
  const tok = withEnv({ TRADEMARK_MCP_TOKEN_SECRET: "acct-test-secret-aaaaaaaa" }, () => mintToken({ scope: "ops", sub: "x" }));
  assert.throws(
    () => withEnv({ TRADEMARK_MCP_TOKEN_SECRET: "acct-test-secret-aaaaaaaa", CLEAROTRON_ACCESS_FILE: grantsPath },
      () => resolveScope({ clientSurface: true, innerToken: tok, email: "lawyer@acme.example", accountAccess: true })),
    /accepts only a run-scoped user token/);
});

test("a granted client resolves to kind 'account' with exactly its granted keys", () => {
  const s = clientScope();
  assert.equal(s.kind, "account");
  assert.deepEqual(s.accounts, ["acme", "acme-eu"]);
  assert.equal(s.sub, "lawyer@acme.example", "sub carries the verified identity for attribution");
  assert.equal(s.runId, null, "an account principal is not run-bound");
});
