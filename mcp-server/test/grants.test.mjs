// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// GRANTS (INSTALL.md §8): the tenant→accounts guest list — resolution, the account gate, token
// accounts, start_run gating, and enumeration filtering. Also pins the OFF state: no grants file
// means exactly today's single-tenant behavior.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import {
  loadGrants, accountsForEmail, assertAccountAccess, accountVisible,
  mintToken, verifyToken, resolveScope, authorize,
} from "../lib/scope.mjs";

process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "test-secret-grants";

const GRANTS = {
  tenants: {
    firm: { accounts: "*", users: { "senior@firm.example": "*", "junior@firm.example": ["celta"] } },
    trial: { accounts: ["aurora", "zephyr", "petcary"], users: { "*@vendor.example": "*", "one@other.example": ["aurora"] } },
  },
};

test("accountsForEmail: exact, domain-wildcard, tenant-grant expansion, union, and the misses", () => {
  assert.equal(accountsForEmail("senior@firm.example", GRANTS), "*", "user '*' on an accounts:'*' tenant = everything");
  assert.deepEqual(accountsForEmail("junior@firm.example", GRANTS), ["celta"]);
  assert.deepEqual(accountsForEmail("anyone@vendor.example", GRANTS).sort(), ["aurora", "petcary", "zephyr"], "*@domain expands to the tenant grant");
  assert.deepEqual(accountsForEmail("one@other.example", GRANTS), ["aurora"]);
  assert.deepEqual(accountsForEmail("stranger@nowhere.example", GRANTS), [], "authenticated but granted NOTHING");
  assert.equal(accountsForEmail("anyone@x.example", null), "*", "no grants file = enforcement off");
  // union across tenants
  const multi = { tenants: { a: { accounts: ["x"], users: { "p@q.example": "*" } }, b: { accounts: ["y"], users: { "p@q.example": "*" } } } };
  assert.deepEqual(accountsForEmail("p@q.example", multi).sort(), ["x", "y"]);
});

test("loadGrants: unset = null (off); set-but-broken THROWS (a configured guest list never fails open)", () => {
  assert.equal(loadGrants({ grantsPath: undefined }), null);
  const dir = mkdtempSync(join(tmpdir(), "grants-"));
  try {
    assert.throws(() => loadGrants({ grantsPath: join(dir, "missing.json") }));
    writeFileSync(join(dir, "bad.json"), "{\"nope\":1}");
    assert.throws(() => loadGrants({ grantsPath: join(dir, "bad.json") }), /malformed/);
    writeFileSync(join(dir, "ok.json"), JSON.stringify(GRANTS));
    assert.equal(loadGrants({ grantsPath: join(dir, "ok.json") }).tenants.firm.accounts, "*");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("assertAccountAccess: null/'*' scope passes everything; a list gates; untagged runs only for full grants", () => {
  assertAccountAccess({ accounts: "*" }, "anything");
  assertAccountAccess({ accounts: null }, null);
  assertAccountAccess({ accounts: ["aurora"] }, "aurora");
  assert.throws(() => assertAccountAccess({ accounts: ["aurora"] }, "celta"), /does not include account "celta"/);
  assert.throws(() => assertAccountAccess({ accounts: ["aurora"] }, null), /no account tag/);
  assert.equal(accountVisible({ accounts: ["aurora"] }, "aurora"), true);
  assert.equal(accountVisible({ accounts: ["aurora"] }, "zephyr"), false);
});

test("ops token accounts claim: minted, surfaced, and carried into the scope; legacy = full", () => {
  const tok = mintToken({ scope: "ops", sub: "trial-connector", accounts: ["aurora", "zephyr"] });
  const v = verifyToken(tok);
  assert.deepEqual(v.accounts, ["aurora", "zephyr"]);
  const scope = resolveScope({ innerToken: tok });
  assert.deepEqual(scope.accounts, ["aurora", "zephyr"]);
  assert.equal(resolveScope({ innerToken: mintToken({ scope: "ops", sub: "legacy" }) }).accounts, "*");
  assert.equal(resolveScope({ local: true }).accounts, "*");
  // a run-bound token is already narrower than any account cap could make it (accounts[] is for the ops
  // and account scopes; the message names both since the account key gained one too)
  assert.throws(() => mintToken({ scope: "user", runId: "r1", accounts: ["a"] }), /only meaningful on an ops or account token/);
  assert.throws(() => mintToken({ scope: "ops", sub: "x", accounts: [] }), /non-empty/);
});

test("authorize gates start_run by the grant — including the implicit 'generic' account", () => {
  const scoped = resolveScope({ innerToken: mintToken({ scope: "ops", sub: "trial", accounts: ["aurora"] }) });
  // start_run args are passed through UNTOUCHED — the forwarder stamp is a plan_run-only courtesy
  // (shared/scope.mjs), so the spend path still requires the caller to name its own routing key.
  assert.deepEqual(authorize(scoped, "start_run", { markName: "X", profileKey: "aurora" }), { markName: "X", profileKey: "aurora" });
  assert.throws(() => authorize(scoped, "start_run", { markName: "X", profileKey: "celta" }), /does not include account "celta"/);
  assert.throws(() => authorize(scoped, "start_run", { markName: "X" }), /account "generic"/, "no profileKey = the generic account, which must be granted too");
  const full = resolveScope({ innerToken: mintToken({ scope: "ops", sub: "full" }) });
  assert.deepEqual(authorize(full, "start_run", { markName: "X" }), { markName: "X" }, "legacy full ops unchanged");
});

test("describe_options: naming an account is gated by the grant, OMITTING one is the discovery question", () => {
  const scoped = resolveScope({ innerToken: mintToken({ scope: "ops", sub: "trial", accounts: ["aurora"] }) });
  assert.doesNotThrow(() => authorize(scoped, "describe_options", {}),
    "an omitted profileKey is how a session asks which accounts it holds — refusing it re-opens the dead end");
  assert.doesNotThrow(() => authorize(scoped, "describe_options", { profileKey: "aurora" }));
  assert.throws(() => authorize(scoped, "describe_options", { profileKey: "celta" }), /does not include account "celta"/);
});

test("describe_options: the grant binds a scoped INTERNAL session too, not just ops and account", () => {
  // A staff member granted one customer (junior@firm.example ⇒ ["celta"]) already has list_profiles
  // narrowed to that grant by filterByAccounts. A gate written per-branch would let the same session
  // read another customer's name, projects, saved-search slugs and remaining allowance from here —
  // two surfaces disagreeing about one grant, which is the shape of every leak this file has had.
  const dir = mkdtempSync(join(tmpdir(), "grants-desc-"));
  try {
    writeFileSync(join(dir, "grants.json"), JSON.stringify(GRANTS));
    pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(dir, "grants.json"));
    const junior = resolveScope({ firmStaff: true, email: "junior@firm.example" });
    assert.deepEqual(junior.accounts, ["celta"]);
    assert.doesNotThrow(() => authorize(junior, "describe_options", { profileKey: "celta" }));
    assert.throws(() => authorize(junior, "describe_options", { profileKey: "aurora" }), /does not include account "aurora"/);
    assert.doesNotThrow(() => authorize(junior, "describe_options", {}), "omission stays legal for every kind");
    // a FULL-grant staff session is unrestricted, exactly as it is for every other read
    const senior = resolveScope({ firmStaff: true, email: "senior@firm.example" });
    assert.doesNotThrow(() => authorize(senior, "describe_options", { profileKey: "aurora" }));
  } finally {
    pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("internal (token-less) scope resolves accounts from the grants file by email", () => {
  const dir = mkdtempSync(join(tmpdir(), "grants-scope-"));
  try {
    writeFileSync(join(dir, "grants.json"), JSON.stringify(GRANTS));
    pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", join(dir, "grants.json"));
    // internal read-all requires PROVEN firm staff (the HTTP handler derives firmStaff from the
    // transport identity) — an email alone never resolves internal (fail-closed, post-rebaseline).
    assert.equal(resolveScope({ firmStaff: true, email: "senior@firm.example" }).accounts, "*");
    assert.deepEqual(resolveScope({ firmStaff: true, email: "junior@firm.example" }).accounts, ["celta"]);
    assert.deepEqual(resolveScope({ firmStaff: true, email: "nobody@nowhere.example" }).accounts, []);
    assert.throws(() => resolveScope({ email: "senior@firm.example" }), /firm-staff/, "email without proven staff identity refuses");
    pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", undefined);
    assert.equal(resolveScope({ firmStaff: true, email: "senior@firm.example" }).accounts, "*", "grants unset = off");
  } finally {
    pinEnv(process.env, "CLEAROTRON_ACCESS_FILE", undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("filterByAccounts narrows list_runs/list_profiles/list_outbox_events/search_runs to the grant (fixture-backed)", async () => {
  // a tagged run: workspace with _driver/profile.json in the REAL frozen-sidecar shape — freezeProfile
  // writes `profileKey`, never `key` (the 2026-07-18 fix: a {key}-shaped fixture masked the reader bug
  // that left every real run untagged)
  const ws = mkdtempSync(join(tmpdir(), "grants-ws-"));
  const mk = (slug, run, key) => {
    const d = join(ws, "workspace-test", "studio", "prelim-search", slug, run);
    mkdirSync(driverDir(d), { recursive: true });
    writeFileSync(join(d, "status.json"), JSON.stringify({ schema: 1, runId: `${slug}-${run}`, slug, codename: run, agent: "test", state: "delivered", updatedAt: "2026-01-01T00:00:00Z" }));
    if (key) writeFileSync(driverDir(d, "profile.json"), JSON.stringify({ profileKey: key, name: "Fixture" }));
  };
  mk("tmp1-a", "run-a", "aurora");
  mk("tmp2-b", "run-b", "celta");
  mk("tmp3-c", "run-c", null); // untagged (pre-grants)
  const saved = process.env.CLEAROTRON_WORK_DIR;
  pinEnv(process.env, "CLEAROTRON_WORK_DIR", ws);
  try {
    const { filterByAccounts } = await import("../server.mjs");
    const scope = { kind: "ops", accounts: ["aurora"] };
    const runs = [{ runId: "tmp1-a-run-a" }, { runId: "tmp2-b-run-b" }, { runId: "tmp3-c-run-c" }];
    assert.deepEqual(filterByAccounts(scope, "list_runs", runs).map((r) => r.runId), ["tmp1-a-run-a"]);
    const profs = { clients: [{ key: "aurora" }, { key: "celta" }], genericFallback: "generic" };
    assert.deepEqual(filterByAccounts(scope, "list_profiles", profs).clients.map((c) => c.key), ["aurora"]);
    const ob = { ok: true, count: 2, events: [{ runId: "tmp1-a-run-a", kind: "delivered" }, { runId: "tmp2-b-run-b", kind: "delivered" }] };
    const fob = filterByAccounts(scope, "list_outbox_events", ob);
    assert.deepEqual(fob.events.map((e) => e.runId), ["tmp1-a-run-a"]);
    assert.equal(fob.count, 1);
    assert.deepEqual(filterByAccounts({ kind: "ops", accounts: "*" }, "list_runs", runs), runs, "full grant untouched");

    // ──: search_runs, BOTH shapes — the exact filter that leaked on 2026-07-18 ───────────────
    //
    // Nothing anywhere exercised this. The in-file note records the review that found it: search_runs
    // answers an OBJECT ({query, mode, hits, ...}), the array guard above never matched it, and every
    // scoped session saw EVERY hit. A real cross-account content leak, fixed, and then covered by no
    // test at all — so a refactor that dropped the `{hits}` branch would have restored it silently.
    const hits = { query: "venzy", mode: "content", runsScanned: 3, truncated: false,
      hits: [{ runId: "tmp1-a-run-a", line: "…" }, { runId: "tmp2-b-run-b", line: "…" }, { runId: "tmp3-c-run-c", line: "…" }] };
    const fh = filterByAccounts(scope, "search_runs", hits);
    assert.deepEqual(fh.hits.map((h) => h.runId), ["tmp1-a-run-a"], "the object shape is filtered — this is the leak");
    assert.equal(fh.query, "venzy", "and the rest of the envelope survives");
    // The array shape too, which the guard above DOES catch — asserted so the two cannot drift apart.
    assert.deepEqual(filterByAccounts(scope, "search_runs", runs).map((r) => r.runId), ["tmp1-a-run-a"]);
    // An untagged run (pre-grants, no resolvable account) is dropped for a scoped session either way.
    assert.deepEqual(filterByAccounts(scope, "search_runs", { hits: [{ runId: "tmp3-c-run-c" }] }).hits, []);
  } finally {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", saved);
    rmSync(ws, { recursive: true, force: true });
  }
});

test("runAccountKey: reads the REAL frozen shape (profileKey) AND the legacy {key} shape (pre-fix sidecars)", async () => {
  const { runAccountKey } = await import("../lib/runs.mjs");
  const d1 = mkdtempSync(join(tmpdir(), "rak-"));
  mkdirSync(driverDir(d1), { recursive: true });
  writeFileSync(driverDir(d1, "profile.json"), JSON.stringify({ profileKey: "aurora", name: "A" }));
  assert.equal(runAccountKey({ runDir: d1 }), "aurora");
  const d2 = mkdtempSync(join(tmpdir(), "rak-"));
  mkdirSync(driverDir(d2), { recursive: true });
  writeFileSync(driverDir(d2, "profile.json"), JSON.stringify({ key: "zephyr" }));
  assert.equal(runAccountKey({ runDir: d2 }), "zephyr", "legacy shape still resolves (belt-and-braces)");
  const d3 = mkdtempSync(join(tmpdir(), "rak-"));
  assert.equal(runAccountKey({ runDir: d3 }), null, "no sidecar = untagged (full-grant-only)");
});

// ── The SHIPPED example (examples/grants.example.json) ────────────────────────────────────────────
// The install docs tell a stranger to copy this file and sign in as one of its addresses. If it stops
// loading, or a shape change makes its rows resolve to nothing, the first thing they try silently
// produces an empty world — and no other test reads it. So it is loaded here through the real loader
// rather than re-declared as a fixture.
test("examples/grants.example.json loads through loadGrants and grants what it looks like it grants", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples", "grants.example.json");
  const g = loadGrants({ grantsPath: path });
  assert.ok(g && typeof g.tenants === "object", "the shipped example is a well-formed grants file");
  assert.ok(Object.keys(g.tenants).length >= 2, "it shows more than one tenant, which is the point of the file");

  // Each documented resolution path is exercised by a row: a tenant-wide "*", a narrower per-user
  // list, and a *@domain wildcard. An example that only ever produced "*" would teach nothing.
  assert.equal(accountsForEmail("principal@firm.example", g), "*", "a user of '*' on an accounts:'*' tenant sees everything");
  assert.deepEqual(accountsForEmail("associate@firm.example", g), ["aurora"], "a per-user list narrows inside the tenant");
  assert.deepEqual(accountsForEmail("anyone@aurora.example", g), ["aurora"], "*@domain expands to the tenant's grant");
  assert.deepEqual(accountsForEmail("stranger@nowhere.example", g), [], "an address in no tenant is granted nothing");

  // `generic` is the house account and portal-access.mjs strips it from every client grant, so a
  // client tenant granted only `generic` resolves to no principal at all. An example that named it
  // would look broken on the installer's first sign-in.
  const named = new Set(Object.values(g.tenants).flatMap((t) => (t.accounts === "*" ? [] : t.accounts)));
  assert.ok(!named.has("generic"), "the example never grants `generic` to a tenant");

  // Every account key it names must be a demo customer this repo actually ships, or the example resolves
  // to accounts that do not exist on a stock install.
  //
  // DERIVED FROM THE SHIPPED ROSTER, not restated. This was a literal ["aurora", "zephyr", "petcary"],
  // which is a copy of the roster that goes stale the moment one is added — and it did, when
  // `demo-brand-owner` shipped. The literal could only ever say "these three
  // existed when somebody last looked".
  //
  // AND IT NOW CHECKS THE CLAIM IT ACTUALLY MAKES. "A demo customer" became machine-checkable in tracker
  // issue 2012: a profile declares itself with `demoData: true`. So the assertion is no longer "is it on
  // a list I typed" but "does this repo ship it, AND does it say it is demo data" — which is what an
  // example granting real client accounts would fail, and a stale literal never could.
  const PROFILES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "driver", "profiles");
  const shipped = new Map(readdirSync(PROFILES).filter((f) => f.endsWith(".json"))
    .map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(PROFILES, f), "utf8"))]));
  assert.ok(shipped.size >= 2, `read ${shipped.size} shipped profile(s) — this check would be vacuous`);
  for (const a of named) {
    assert.ok(shipped.has(a), `the example grants "${a}", which this repo does not ship — it resolves to nothing on a stock install`);
    assert.equal(shipped.get(a).demoData, true,
      `the example grants "${a}", which is NOT marked demo data. A shipped example must never hand a `
      + "tenant an account that presents as a real client.");
  }
});
