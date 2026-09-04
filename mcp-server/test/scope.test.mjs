// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope.test.mjs — the inner authorization plane (mint/verify HMAC tokens + the dispatch enforcement).
// Pure node:crypto — no MCP SDK / jose, so it runs anywhere (incl. the node_modules-less worktree).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintToken, verifyToken, resolveScope, authorize, visibleTools, isFirmDomain, TOOL_SCOPES, USER_ARTIFACTS } from "../lib/scope.mjs";

const withSecret = (fn) => {
  const saved = process.env.TRADEMARK_MCP_TOKEN_SECRET;
  process.env.TRADEMARK_MCP_TOKEN_SECRET = "test-secret-aaaaaaaaaaaaaaaa";
  try { return fn(); } finally { if (saved === undefined) delete process.env.TRADEMARK_MCP_TOKEN_SECRET; else process.env.TRADEMARK_MCP_TOKEN_SECRET = saved; }
};

test("mint/verify round-trip: user token carries scope + runId + exp", () => withSecret(() => {
  const tok = mintToken({ scope: "user", runId: "tmp8439-2026-06-16-quartz-causeway", ttlSec: 3600 });
  const v = verifyToken(tok);
  assert.equal(v.scope, "user");
  assert.equal(v.runId, "tmp8439-2026-06-16-quartz-causeway");
  assert.ok(v.exp > Math.floor(Date.now() / 1000));
}));

test("ops token has no runId binding; user token MUST be run-bound", () => withSecret(() => {
  assert.equal(verifyToken(mintToken({ scope: "ops" })).runId, null);
  assert.throws(() => mintToken({ scope: "user" }), /must be bound to a runId/);
  assert.throws(() => mintToken({ scope: "bogus" }), /scope must be ops\|user/);
}));

test("tamper + expiry + malformed are rejected", () => withSecret(() => {
  const tok = mintToken({ scope: "user", runId: "r1", ttlSec: 3600 });
  // flip a char in the signature segment
  const parts = tok.split(".");
  const bad = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].slice(-1) === "A" ? "B" : "A"}`;
  assert.throws(() => verifyToken(bad), /bad token signature/);
  assert.throws(() => verifyToken("v1.x.y"), /bad token signature|payload not JSON|malformed/);
  assert.throws(() => verifyToken("garbage"), /malformed token/);
  // expired
  const exp = mintToken({ scope: "user", runId: "r1", ttlSec: -10 });
  assert.throws(() => verifyToken(exp), /token expired/);
  // a token signed with a DIFFERENT secret must not verify
  const other = (() => { process.env.TRADEMARK_MCP_TOKEN_SECRET = "different-secret-bbbbbbbbbbbb"; const t = mintToken({ scope: "ops" }); process.env.TRADEMARK_MCP_TOKEN_SECRET = "test-secret-aaaaaaaaaaaaaaaa"; return t; })();
  assert.throws(() => verifyToken(other), /bad token signature/);
}));

test("mint/verify fail-closed without a secret", () => {
  const saved = process.env.TRADEMARK_MCP_TOKEN_SECRET; delete process.env.TRADEMARK_MCP_TOKEN_SECRET;
  try {
    assert.throws(() => mintToken({ scope: "ops" }), /TOKEN_SECRET unset/);
    assert.throws(() => verifyToken("v1.a.b"), /TOKEN_SECRET unset/);
  } finally { if (saved !== undefined) process.env.TRADEMARK_MCP_TOKEN_SECRET = saved; }
});

test("resolveScope: local=ops; firm-staff+no-token=internal; user-token=run-bound user; ops-token=ops", () => withSecret(() => {
  // The fail-closed §E semantics (internal requires PROVEN firm staff) carry the product's full scope
  // shape: sub/verbs (ops-token least-privilege) + accounts (GRANTS) ride on every resolved scope.
  assert.deepEqual(resolveScope({ local: true }), { kind: "ops", runId: null, sub: "local", verbs: null, accounts: "*" });
  assert.deepEqual(resolveScope({ firmStaff: true }), { kind: "internal", runId: null, sub: null, verbs: null, accounts: "*" });
  assert.deepEqual(resolveScope({ innerToken: mintToken({ scope: "ops" }) }), { kind: "ops", runId: null, sub: null, verbs: null, accounts: "*" });
  assert.deepEqual(resolveScope({ innerToken: mintToken({ scope: "user", runId: "R" }) }), { kind: "user", runId: "R", sub: null, verbs: null, accounts: null });
}));

test("resolveScope is POSITIVE + fail-closed: NOT firm-staff and NO token ⇒ refused (never internal)", () => withSecret(() => {
  // The core §E hardening: the old code returned `internal` (read-all) here. It must now REFUSE.
  assert.throws(() => resolveScope({}), /forbidden:.*firm[- ]staff/);
  assert.throws(() => resolveScope({ firmStaff: false }), /forbidden:/);
  // The "edge config is wrong" case: a customer wrongly admitted to the STAFF CF app presents a non-firm
  // domain, so firmStaff is false and they are refused — the AUD that admitted them is irrelevant.
  assert.equal(isFirmDomain("alice@aurora-interactive.com", ["example.com"]), false);
  assert.throws(() => resolveScope({ firmStaff: isFirmDomain("alice@aurora-interactive.com", ["example.com"]) }), /forbidden:/);
}));

test("resolveScope client surface: ONLY a run-bound user token; no-token/ops/internal all refused", () => withSecret(() => {
  // A signed-in client with a run-bound token gets exactly `user` scope, bound to that run.
  const cs = resolveScope({ clientSurface: true, innerToken: mintToken({ scope: "user", runId: "R" }) });
  assert.equal(cs.kind, "user");
  assert.equal(cs.runId, "R");
  // No token on the client surface ⇒ refused (NOT internal — this is the leak-#6 fix).
  assert.throws(() => resolveScope({ clientSurface: true }), /forbidden:.*run-scoped token/);
  // firmStaff is IGNORED on the client surface — it can never yield internal there.
  assert.throws(() => resolveScope({ clientSurface: true, firmStaff: true }), /forbidden:.*run-scoped token/);
  // An ops token is NOT honoured on the client surface (a stray/leaked ops credential can't be exercised).
  assert.throws(() => resolveScope({ clientSurface: true, innerToken: mintToken({ scope: "ops" }) }), /forbidden:.*run-scoped user token/);
}));

test("isFirmDomain: exact, lowercased, empty-set-false, malformed-false", () => {
  assert.equal(isFirmDomain("jordan@example.com", ["example.com"]), true);
  assert.equal(isFirmDomain("JORDAN@Example.COM", ["@example.com"]), true);
  assert.equal(isFirmDomain("x@evil.example.com", ["example.com"]), false); // subdomain look-alike
  assert.equal(isFirmDomain("x@example.com", []), false);                   // empty set ⇒ never firm
  assert.equal(isFirmDomain("not-an-email", ["example.com"]), false);
  assert.equal(isFirmDomain(["x@example.com"], ["example.com"]), false);    // non-string ⇒ false
});

test("authorize: ops can do everything (reads, cross-run, writes)", () => {
  const ops = { kind: "ops", runId: null };
  assert.deepEqual(authorize(ops, "brief", { runId: "x" }), { runId: "x" });
  assert.deepEqual(authorize(ops, "list_runs", {}), {});
  assert.deepEqual(authorize(ops, "start_run", { markName: "X" }), { markName: "X" });
});

// The stamp is a PREVIEW courtesy, and stops there — the line drawn 2026-07-27.
//
// #53's defect was the free call every principal makes first dying on a message naming an internal doc,
// so plan_run is what the stamp exists to rescue. Carrying it into start_run would remove a spend gate:
// an ops sub is often a connector name or "local", buildJob fills forwarderEmail from
// `${forwarder}@example.com` when none is given, and the result is a paid run whose delivery packet
// routes nowhere. Refusing the spend and naming the missing field is the cheaper failure.
test("the forwarder stamp rescues the PREVIEW and never the spend", () => {
  const ops = { kind: "ops", runId: null, sub: "portal-poc" };
  const internal = { kind: "internal", runId: null, sub: "staff@cordillera.ch" };
  for (const scope of [ops, internal])
    assert.equal(authorize(scope, "plan_run", { markName: "X" }).forwarder, scope.sub,
      "a preview without a forwarder must not die on docs/DELIVERY.md");
  assert.ok(!("forwarder" in authorize(ops, "start_run", { markName: "X" })),
    "start_run must still make the caller name where the report goes");
  // internal never reaches the question — start_run is a write, and a read-only session is refused
  // outright, which is the stronger guarantee.
  assert.throws(() => authorize(internal, "start_run", { markName: "X" }), /requires an ops token/);
});

test("authorize: internal (CF-authed, no token) = read-all, NO writes", () => {
  const internal = { kind: "internal", runId: null };
  assert.deepEqual(authorize(internal, "list_runs", {}), {});         // cross-run read OK
  assert.deepEqual(authorize(internal, "brief", { runId: "a" }), { runId: "a" });
  assert.throws(() => authorize(internal, "start_run", {}), /requires an ops token/);
  assert.throws(() => authorize(internal, "what_if_run", {}), /requires an ops token/);
});

// ---- the forwarder stamp (finishing #53, which covered the account kind only) --------------------
//
// buildJob requires a forwarder and names docs/DELIVERY.md when it is missing. plan_run builds the same
// job start_run does, so the FREE preview — the first call any connecting principal makes — died on an
// internal doc reference for ops and internal sessions too. Who is asking is a fact of the verified
// session, so the chokepoint answers it.

test("plan_run/start_run are stamped with the OPS session's identity, and the caller may still choose", () => {
  const connector = { kind: "ops", runId: null, sub: "connector-intake" };
  assert.equal(authorize(connector, "plan_run", { markName: "X" }).forwarder, "connector-intake",
    "an ops plan_run still died on \"forwarder is required — …docs/DELIVERY.md\"");
  assert.equal(authorize(connector, "start_run", { markName: "X", forwarder: "acme-legal" }).forwarder, "acme-legal",
    "ops routes on someone else's behalf — a caller-chosen forwarder must win (as it does on every branch; what the account branch forces is forwarderEmail)");
  // no identity at all ⇒ the house name, never an empty string that reads as "nobody asked"
  assert.equal(authorize({ kind: "ops", runId: null }, "plan_run", {}).forwarder, "cordillera-mcp");
});

test("forwarderEmail is stamped only from an EMAIL-shaped identity, never a connector name", () => {
  const local = { kind: "ops", runId: null, sub: "local" };
  assert.equal(authorize(local, "plan_run", { markName: "X" }).forwarderEmail, undefined,
    "\"local@…\" in a delivery packet is worse than an unset field");
  const staff = { kind: "internal", runId: null, sub: "senior@firm.example" };
  assert.equal(authorize(staff, "plan_run", { markName: "X" }).forwarderEmail, "senior@firm.example");
  assert.equal(authorize(staff, "plan_run", { markName: "X" }).forwarder, "senior@firm.example");
});

test("a CF-authed staff identity REACHES the stamp — the whole chain, not its two halves", () => {
  // The stamp tests above hand-BUILD their principal ({ kind: "internal", sub: "…" }), so they exercise
  // stampForwarder and never the wiring that produces `sub`. That is what let the one-line change this
  // fix rests on — the internal arm of resolveScope carrying `sub: email ?? null` instead of `null` —
  // be reverted with the entire suite green: the no-email case is pinned, and it passes either way.
  // Reverting it silently returns every CF-authed staff plan_run to forwarder "cordillera-mcp" with no
  // forwarderEmail. So: the email in, the stamp out, in one assertion chain.
  assert.equal(resolveScope({ firmStaff: true, email: "senior@firm.example" }).sub, "senior@firm.example",
    "the CF-verified email was known here and thrown away — the bug #53 left behind");
  const stamped = authorize(resolveScope({ firmStaff: true, email: "senior@firm.example" }), "plan_run", { markName: "X" });
  assert.equal(stamped.forwarder, "senior@firm.example");
  assert.equal(stamped.forwarderEmail, "senior@firm.example");
});

test("the internal stamp sits AFTER the write gate — staff still cannot start_run", () => {
  const staff = { kind: "internal", runId: null, sub: "senior@firm.example" };
  assert.throws(() => authorize(staff, "start_run", { markName: "X" }), /requires an ops token/);
  assert.deepEqual(authorize(staff, "brief", { runId: "a" }), { runId: "a" }, "reads are untouched by the stamp");
});

test("authorize: user token is read-only, ONE run, no cross-run, run pinned (client-safe only)", () => {
  const user = { kind: "user", runId: "RUN-1" };
  // a client-safe tool pins/injects the bound run when omitted
  assert.deepEqual(authorize(user, "brief", {}), { runId: "RUN-1" });
  // read_artifact of THE report is fine and run-pinned; clientSummary is retired from client reach
  // (one report, spec 2026-07-30 §5 — it was a second version by another name)
  assert.deepEqual(authorize(user, "read_artifact", { runId: "RUN-1", name: "report" }), { runId: "RUN-1", name: "report" });
  assert.throws(() => authorize(user, "read_artifact", { name: "clientSummary" }), /may only read the report/);
  // a DIFFERENT run is refused (cannot reach another matter)
  assert.throws(() => authorize(user, "read_artifact", { runId: "RUN-2", name: "report" }), /scoped to run "RUN-1"/);
  // cross-run enumeration refused (caught by the client-safe gate)
  assert.throws(() => authorize(user, "list_runs", {}), /client layer only/);
  assert.throws(() => authorize(user, "search_runs", { query: "x" }), /client layer only/);
  // writes refused
  assert.throws(() => authorize(user, "start_run", {}), /requires an ops token/);
  assert.throws(() => authorize(user, "what_if_plan", { runId: "RUN-1" }), /requires an ops token/);
});

test("4A: a user (report-link) token reaches ONLY the plain-language client layer", () => {
  const user = { kind: "user", runId: "RUN-1" };
  // ALLOWED — the client layer (brief, the curated cards, THE report)
  assert.deepEqual(authorize(user, "brief", {}), { runId: "RUN-1" });
  assert.deepEqual(authorize(user, "list_findings", { group: "on-field" }), { runId: "RUN-1", group: "on-field" });
  assert.deepEqual(authorize(user, "read_artifact", { name: "report" }), { runId: "RUN-1", name: "report" });
  // DENIED — every engineering read, incl. get_telemetry (the only model-identity leak)
  for (const t of ["get_telemetry", "trace", "decision_timeline", "get_coverage", "diff_artifact", "get_provider_usage", "search", "get_run", "get_finding", "run_changes"])
    assert.throws(() => authorize(user, t, { runId: "RUN-1" }), /client layer only/, `${t} must be denied to a user token`);
  // DENIED — read_artifact of any INTERNAL artifact name, incl. clientSummary (retired from client
  // reach: one report, spec 2026-07-30 §5 — the file survives as an internal cover-note source)
  for (const n of ["narrative", "audit", "run.jsonl", "skepticFlags", "seniorEyeReview", "matterContext", "registerFindings", "commonLaw", "primary-sweep", "clientSummary"])
    assert.throws(() => authorize(user, "read_artifact", { name: n }), /may only read the report/, `read_artifact(${n}) must be denied`);
  // USER_ARTIFACTS is exactly the one document
  assert.deepEqual([...USER_ARTIFACTS], ["report"]);
});

test("leak11: a user token's list_findings is the curated CARDS path only — the raw audit trail is sealed", () => {
  const user = { kind: "user", runId: "RUN-1" };
  // ALLOWED — the curated report-card groups (plain-language client cards); kind/sourceLayer are stripped so
  // the handler can only take the cards path.
  assert.deepEqual(authorize(user, "list_findings", { group: "on-field" }), { runId: "RUN-1", group: "on-field" });
  assert.deepEqual(authorize(user, "list_findings", { runId: "RUN-1", group: "off-field", kind: "audit", sourceLayer: "Register" }), { runId: "RUN-1", group: "off-field" });
  // DENIED — the raw views that parse audit.md (search queries, rationale, register/common-law PROVIDER names)
  assert.throws(() => authorize(user, "list_findings", { kind: "audit" }), /curated group|audit trail is internal/);
  assert.throws(() => authorize(user, "list_findings", { kind: "negatives" }), /curated group/);
  assert.throws(() => authorize(user, "list_findings", {}), /curated group/);                 // default (raw findings) denied
  assert.throws(() => authorize(user, "list_findings", { group: "bogus" }), /curated group/);  // invalid group denied
  // ops + internal are UNTOUCHED — they may still pull the raw audit trail
  assert.deepEqual(authorize({ kind: "internal", runId: null }, "list_findings", { runId: "a", kind: "audit" }), { runId: "a", kind: "audit" });
  assert.deepEqual(authorize({ kind: "ops", runId: null }, "list_findings", { kind: "audit" }), { kind: "audit" });
});

test("4A: ops + internal scopes are UNCHANGED by the client-safe gate", () => {
  const ops = { kind: "ops", runId: null }, internal = { kind: "internal", runId: null };
  // internal (CF-authed staff) still reaches every read, incl. engineering tools + internal artifacts
  assert.deepEqual(authorize(internal, "get_telemetry", { runId: "a" }), { runId: "a" });
  assert.deepEqual(authorize(internal, "trace", { runId: "a" }), { runId: "a" });
  assert.deepEqual(authorize(internal, "read_artifact", { runId: "a", name: "narrative" }), { runId: "a", name: "narrative" });
  // ops keeps everything
  assert.deepEqual(authorize(ops, "get_telemetry", { runId: "a" }), { runId: "a" });
  assert.deepEqual(authorize(ops, "read_artifact", { runId: "a", name: "run.jsonl" }), { runId: "a", name: "run.jsonl" });
});

test("visibleTools: user sees ONLY client-safe; internal sees all reads; ops sees writes; what-if local-only", () => {
  const userVis = visibleTools({ kind: "user" });
  assert.equal(userVis("brief"), true);
  assert.equal(userVis("list_findings"), true);
  assert.equal(userVis("read_artifact"), true);
  assert.equal(userVis("get_telemetry"), false, "model-identity leak hidden from a user token");
  assert.equal(userVis("trace"), false);
  assert.equal(userVis("get_run"), false);
  assert.equal(userVis("start_run"), false);
  assert.equal(userVis("what_if_run"), false);
  const internalVis = visibleTools({ kind: "internal" });
  assert.equal(internalVis("trace"), true, "internal staff keep the full read surface");
  assert.equal(internalVis("get_telemetry"), true);
  assert.equal(internalVis("start_run"), false);
  const opsHttp = visibleTools({ kind: "ops", local: false });
  assert.equal(opsHttp("start_run"), true);
  assert.equal(opsHttp("what_if_run"), false, "what-if (shell/spend) is never exposed over HTTP");
  const opsLocal = visibleTools({ kind: "ops", local: true });
  assert.equal(opsLocal("what_if_run"), true, "stdio keeps the full set");
  assert.equal(opsLocal("start_run"), true);
});

test("every write/crossRun tool is declared in TOOL_SCOPES (registry completeness)", () => {
  for (const t of ["start_run", "plan_run", "stop_run", "feed_context", "what_if_plan", "what_if_run", "list_runs", "search_runs"])
    assert.ok(TOOL_SCOPES[t], `${t} must be declared`);
});

test("clientSafe is declared on exactly the plain-language client tools", () => {
  for (const t of ["brief", "list_findings", "read_artifact"])
    assert.ok(TOOL_SCOPES[t]?.clientSafe, `${t} must be clientSafe`);
  for (const t of ["get_telemetry", "trace", "get_run", "get_finding", "decision_timeline", "get_coverage", "diff_artifact", "get_provider_usage", "search", "run_changes", "list_runs", "search_runs", "list_profiles", "start_run", "plan_run", "what_if_run"])
    assert.ok(!TOOL_SCOPES[t]?.clientSafe, `${t} must NOT be clientSafe`);
});

// ── Revocation is refusal ON SIGHT, and the record is an ID, never the key ────

import { tokenId } from "../lib/scope.mjs";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const withDenylist = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "denylist-arm-"));
  const path = join(dir, "token-denylist");
  writeFileSync(path, "# armed by the arm\n");
  const saved = process.env.TRADEMARK_MCP_TOKEN_DENYLIST;
  process.env.TRADEMARK_MCP_TOKEN_DENYLIST = path;
  try { return fn(path); } finally {
    if (saved === undefined) delete process.env.TRADEMARK_MCP_TOKEN_DENYLIST; else process.env.TRADEMARK_MCP_TOKEN_DENYLIST = saved;
    rmSync(dir, { recursive: true, force: true });
  }
};

test("2082: a key is REFUSED ON SIGHT once its id is denylisted — mint, verify, revoke, refused", () => withSecret(() => withDenylist((path) => {
  // The issue's acceptance arm, end to end through the verifier itself: the key does not wait out its
  // ninety days. Verified GOOD first, so the later refusal is proven to be the denylist's doing and not
  // a broken token — a refusal asserted without the passing read would also pass on a mangled mint.
  const tok = mintToken({ scope: "account", sub: "lawyer@acme.example", ttlSec: 3600 });
  const before = verifyToken(tok);
  assert.equal(before.sub, "lawyer@acme.example");
  assert.ok(before.jti, "an account token carries its revocation handle");
  appendFileSync(path, `${before.jti}\n`);
  assert.throws(() => verifyToken(tok), /revoked/, "the denylisted id must be refused, not honoured to expiry");
})));

test("2082: tokenId reads OUR OWN mint's recordable facts, and only those", () => withSecret(() => {
  const tok = mintToken({ scope: "account", sub: "lawyer@acme.example", ttlSec: 3600 });
  const id = tokenId(tok);
  // The same facts the verifier reads — one token, one parse contract, two readers that must agree.
  const v = verifyToken(tok);
  assert.equal(id.jti, v.jti);
  assert.equal(id.exp, v.exp);
  assert.equal(id.sub, "lawyer@acme.example");
  // What it hands back is the record, and the record must not BE the credential.
  assert.ok(!JSON.stringify(id).includes(tok), "tokenId must never return the token value");
  // Garbage is null, not a throw: the caller is recording after a successful mint, and a malformed
  // string is an absence to report, not a crash to eat the key in.
  for (const bad of [null, 42, "", "v1.not-base64.sig", "v2.x.y", tok.split(".").slice(0, 2).join(".")])
    assert.equal(tokenId(bad), null, `tokenId(${JSON.stringify(bad)}) must be null`);
}));
