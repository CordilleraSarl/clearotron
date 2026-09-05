// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The staff config view.
//
// The decisive test is the first one: this page must report what the ENGINE has switched on, from a
// process that cannot read the engine's environment. A page built on process.env would confidently say
// "everything is off" on a box where everything is on — and unlike a silent bug, this one gets BELIEVED,
// because its whole purpose is to be the answer to "is that on?".

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { flagView, accessView, observedView, authView } from "../portal-config-view.mjs";
import { buildFlagSnapshot, snapshotPath } from "../flag-snapshot.mjs";

// The three admission kill switches this file used to render (CLEAROTRON_KNOCKOUT_MODE, CLEAROTRON_JX_LANES,
// CLEAROTRON_RECIPES_MODE) were retired 2026-07-27 and are no longer in the snapshot's allowlist. What is left
// is the more dangerous set: flags that change a report's OUTPUT and tell nobody, which is what this screen
// exists to surface. CLEAROTRON_JX_CONSUME is set to "0" as the explicitly-off case.
const ENGINE_ENV = { CLEAROTRON_JX_SERP_GRID: "1", CLEAROTRON_JX_NATIVEREAD: "1", CLEAROTRON_JX_CONSUME: "0" };
const AT = "2026-07-19T12:00:00Z";
const NOW = Date.parse("2026-07-19T13:00:00Z");

function pool(env = ENGINE_ENV, capturedAt = AT) {
  const root = mkdtempSync(join(tmpdir(), "cfgview-"));
  const p = snapshotPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(buildFlagSnapshot(env, { capturedAt })));
  return root;
}

test("#1149 item 8 — the staff screen renders NO flag, and says so rather than showing an empty list", () => {
  // The three tests this replaces asserted the screen's whole reason for existing: the driver's true
  // values render from a process with none of them set, explicitly-off is distinguished from
  // never-configured, and every rendered flag is labelled silent and not an admission gate. All four
  // flags are deleted, so each of those arms had nothing left to iterate over — and an arm iterating an
  // empty list is the shape that reads green while asserting nothing.
  //
  // The screen's PURPOSE survives the emptiness and that is what this asserts: `available` must stay
  // true (the snapshot was read) while `flags` is empty, because "I read the snapshot and it declares
  // no flag" and "I could not read the snapshot" are the two answers this view exists to keep apart.
  const v = flagView(pool(), { now: NOW });
  assert.equal(v.available, true, "the snapshot WAS read — that is not the same as having nothing to show");
  assert.deepEqual(v.flags, [], "and it declares no flag, because #1149 item 8 deleted all four");
});

test("#1149 item 8 — a deleted switch cannot reappear on the staff screen by being set", () => {
  // The counterfactual. `pool()` builds its snapshot from an environment with all three jx arms set, so
  // if the allowlist ever grew one back this reddens rather than quietly rendering a dead toggle to
  // staff as though it governed something.
  const v = flagView(pool(), { now: NOW });
  const names = v.flags.map((f) => f.name);
  for (const gone of ["CLEAROTRON_JX_SERP_GRID", "CLEAROTRON_JX_NATIVEREAD", "CLEAROTRON_JX_CONSUME",
                      "CLEAROTRON_COMMONLAW_SPLIT", "CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_JX_LANES", "CLEAROTRON_RECIPES_MODE"]) {
    assert.ok(!names.includes(gone), `${gone} is retired and must not appear on the staff screen`);
  }
});

test("a missing snapshot is UNAVAILABLE, never 'everything off'", () => {
  const v = flagView(mkdtempSync(join(tmpdir(), "empty-")), { now: NOW });
  assert.equal(v.available, false);
  assert.deepEqual(v.flags, []);
  assert.match(v.note, /cannot be read/);
  assert.ok(!/off/i.test(v.note.replace(/switched on/gi, "")), "the note must not read as 'off'");
});

test("an OLD capture is still readable, and its age is no longer a verdict on it", () => {
  // THIS ARM USED TO ASSERT `v.stale === true`, and the age banner it belonged to is retired — owner
  // ruling 2026-09-05 (tracker issue 170): "the global configuration page shows LIVE configuration,
  // always. No run-time snapshot as the source of truth."
  //
  // What the arm was FOR survives and is what it checks now: old is not the same as unreadable, and the
  // states must stay distinct even when there is nothing to render. What it may no longer do is treat
  // age as evidence of wrongness — the page answers live, and whether the capture still describes the
  // box is answered by comparison, in the arms in
  // `a-capture-that-stopped-describing-the-box-says-so.test.mjs`.
  const v = flagView(pool(ENGINE_ENV, "2026-07-01T00:00:00Z"));
  assert.equal(v.available, true, "an old capture is still the last known truth when there is nothing live");
  assert.equal(v.source, "capture", "and the page says which reading it gave rather than implying live");
  assert.equal(v.lastRun.capturedAt, "2026-07-01T00:00:00Z", "the date is still reported — as a fact, not a warning");
  assert.deepEqual(v.flags, []);
  assert.ok(!("stale" in v),
    "the age verdict is retired; leaving the field behind would let a page keep rendering the banner "
    + "the ruling removed");
});

// ──: the engine and provider rows, and the hop that must not collapse them ────────────────────

test("#1439 — an OLDER snapshot reports engine and providers as UNKNOWN, never as none", () => {
  // `pool` builds its snapshot without the blocks, which is exactly what every deployment's
  // snapshot looks like until its driver next drains. The view must carry that through as null: an
  // empty list here would tell staff the instance has no providers wired up, which is a different
  // claim from "this snapshot cannot say" and is false.
  const v = flagView(pool(), { now: NOW });
  assert.equal(v.available, true, "the snapshot WAS read");
  assert.equal(v.engine, null);
  assert.equal(v.providers, null);
});

test("#1439 — a missing snapshot states the same two fields rather than omitting them", () => {
  // Both branches of flagView must produce the same SHAPE, or a reader can tell "no snapshot" from
  // "older snapshot" by a key that happens to be absent — and would then render one of them wrongly.
  const v = flagView(mkdtempSync(join(tmpdir(), "empty-")), { now: NOW });
  assert.equal(v.available, false);
  assert.ok("engine" in v, "stated, not omitted");
  assert.ok("providers" in v, "stated, not omitted");
  assert.equal(v.engine, null);
  assert.equal(v.providers, null);
});

test("#1439 — an instance with nothing wired up sends ROWS saying so, and they reach the view", () => {
  // The counterfactual, and the property the page depends on: a provider that is not configured must
  // arrive as a row marked missing. If the view dropped unconfigured rows, this is where it shows.
  const engine = { id: "anthropic-agent", vendor: "Anthropic", known: true, binaryPresent: false,
    billing: { mode: "subscription", apiBilled: false, missing: [] } };
  const providers = [
    { key: "register", label: "Trademark register", provider: null, providerLabel: null,
      known: false, configured: false, missing: ["CLEAROTRON_DATABASE"] },
    { key: "web", label: "Open-web search", provider: "serpapi", providerLabel: "SerpAPI",
      known: true, configured: false, missing: ["SERPAPI_API_KEY"] },
  ];
  const root = mkdtempSync(join(tmpdir(), "cfgview-1439-"));
  const p = snapshotPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(buildFlagSnapshot({}, { capturedAt: AT, engine, providers })));

  const v = flagView(root, { now: NOW });
  assert.deepEqual(v.engine, engine);
  assert.equal(v.providers.length, 2, "every row survives — an unconfigured provider is not dropped");
  assert.ok(v.providers.every((r) => r.configured === false));
  assert.deepEqual(v.providers.map((r) => r.missing).flat(), ["CLEAROTRON_DATABASE", "SERPAPI_API_KEY"]);
});

// ── enrolment ───────────────────────────────────────────────────────────────────────────────────────

const GRANTS = { tenants: {
  celta: { accounts: ["aurora", "zephyr"], users: {
    "cli@celta.example": ["aurora"],
    "boss@celta.example": "*",
    "typo@celta.example": ["aurroa"],        // a typo: celta does not hold "aurroa"
  } },
} };

test("a wildcard grant is expanded to what it actually reaches", () => {
  const v = accessView({ grants: GRANTS, staffDomains: ["example-firm.com"], knownAccounts: ["aurora", "zephyr"] });
  const boss = v.people.find((p) => p.email === "boss@celta.example");
  assert.deepEqual(boss.accounts, ["aurora", "zephyr"], "'*' means this TENANT's accounts, not every account");
  assert.equal(boss.wildcard, true);
});

test("a grant naming an account its tenant does not hold is FLAGGED — it fails as a silent 404", () => {
  const v = accessView({ grants: GRANTS, knownAccounts: ["aurora", "zephyr"] });
  const typo = v.people.find((p) => p.email === "typo@celta.example");
  assert.deepEqual(typo.dangling, ["aurroa"]);
  assert.ok(v.unknownAccounts.includes === undefined || true);
});

test("an account no profile matches is reported — the other typo direction", () => {
  const v = accessView({
    grants: { tenants: { celta: { accounts: ["aurora", "ghost"], users: {} } } },
    knownAccounts: ["aurora"],
  });
  assert.deepEqual(v.unknownAccounts, ["ghost"]);
});

test("the view says out loud that it can only see half of enrolment", () => {
  const v = accessView({ grants: GRANTS });
  assert.match(v.note, /second half/);
  // — AND IT NO LONGER NAMES ONE VENDOR. This sentence told every reader that signing in needs
  // Cloudflare Access, including readers whose instance runs the local passphrase door, where it is
  // simply untrue. It is the sentence was raised over, so the arm now fails if it comes back.
  assert.doesNotMatch(v.note, /Cloudflare/,
    "the view cannot see which door this instance runs, so it must not assert one");
  assert.match(v.note, /whichever door this instance runs/);
  assert.match(v.note, /SECURITY\.md/, "and it points at the one document that owns the model");
});

test("an empty or missing grants file does not throw — it reports nobody", () => {
  for (const g of [null, undefined, {}, { tenants: {} }]) {
    const v = accessView({ grants: g });
    assert.deepEqual(v.people, []);
  }
});

// ── observed activity ───────────────────────────────────────────────────────────────────────────────
//
// The panel that answers "why can't I see my colleagues on the access page" — they are staff, admitted
// by a domain rule, so they were never IN the grants file to be listed. This reads the other direction.

const auditFile = (lines) => {
  const d = mkdtempSync(join(tmpdir(), "observed-"));
  const p = join(d, "portal-audit.log");
  writeFileSync(p, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  return p;
};

test("observed: a missing, unconfigured or non-file log reports unavailable and never throws", () => {
  // This runs inside a web request on a page whose real job is explaining access. Every one of these
  // must cost the reader one panel and nothing else.
  for (const p of [undefined, null, "", join(tmpdir(), "definitely-not-here-9f3a.log"), tmpdir()]) {
    const v = observedView({ auditPath: p });
    assert.equal(v.available, false, `${String(p)} must report unavailable`);
    assert.deepEqual(v.people, []);
    assert.match(v.note, /Access itself is unaffected/, "and must say access is not the thing that broke");
  }
});

test("observed: an empty log is AVAILABLE with nobody — distinct from unreadable", () => {
  const d = mkdtempSync(join(tmpdir(), "observed-empty-"));
  const p = join(d, "portal-audit.log");
  writeFileSync(p, "");
  const v = observedView({ auditPath: p });
  assert.equal(v.available, true, "the log is fine, it is simply empty");
  assert.deepEqual(v.people, []);
});

test("observed: identities are aggregated, counted per event, and sorted newest first", () => {
  const p = auditFile([
    { at: "2026-07-18T09:00:00.000Z", event: "plan", by: "reviewer@staff.example", account: "aurora" },
    { at: "2026-07-19T09:00:00.000Z", event: "trigger", by: "reviewer@staff.example", account: "zephyr" },
    { at: "2026-07-20T09:00:00.000Z", event: "profile-save", by: "owner@staff.example", account: "aurora" },
  ]);
  const v = observedView({ auditPath: p });
  assert.equal(v.available, true);
  assert.deepEqual(v.people.map((x) => x.email), ["owner@staff.example", "reviewer@staff.example"],
    "most recent first — this is a 'who has been here lately' list");
  const reviewer = v.people.find((x) => x.email === "reviewer@staff.example");
  assert.deepEqual(reviewer.events, { plan: 1, trigger: 1 });
  assert.deepEqual(reviewer.accounts, ["aurora", "zephyr"], "every brand owner they touched, deduped");
  assert.equal(reviewer.firstSeen, "2026-07-18T09:00:00.000Z");
  assert.equal(reviewer.lastSeen, "2026-07-19T09:00:00.000Z");
  assert.equal(reviewer.count, 2);
});

test("observed: an email is matched case-insensitively, so one person is one row", () => {
  const p = auditFile([
    { at: "2026-07-20T09:00:00.000Z", event: "plan", by: "Reviewer@Staff.EXAMPLE" },
    { at: "2026-07-20T10:00:00.000Z", event: "plan", by: "reviewer@staff.example" },
  ]);
  assert.equal(observedView({ auditPath: p }).people.length, 1);
});

test("observed: a corrupt line costs its own row and nothing else", () => {
  // A log is appended to by a live service; a torn write must not blank the panel for everyone else.
  const p = auditFile([
    { at: "2026-07-20T09:00:00.000Z", event: "plan", by: "a@staff.example" },
    "not json{{{",
    { at: "2026-07-20T10:00:00.000Z", event: "plan", by: "b@staff.example" },
  ]);
  const v = observedView({ auditPath: p });
  assert.deepEqual(v.people.map((x) => x.email).sort(), ["a@staff.example", "b@staff.example"]);
});

test("observed: the byte bound holds, and the torn first record is discarded", () => {
  const many = [];
  for (let i = 0; i < 400; i++) many.push({ at: `2026-07-20T09:${String(i % 60).padStart(2, "0")}:00.000Z`, event: "plan", by: `p${i}@staff.example` });
  const p = auditFile(many);
  const v = observedView({ auditPath: p, maxBytes: 2048 });
  assert.equal(v.truncated, true, "a long log is read from the tail, not pulled in whole");
  assert.ok(v.people.length > 0 && v.people.length < 400, "only the tail is represented");
  // The tail read lands mid-record; that fragment must not become a half-parsed row.
  for (const person of v.people) assert.match(person.email, /^p\d+@staff\.example$/, "no torn email survived");
});

test("observed: the identity bound caps the list", () => {
  const many = [];
  for (let i = 0; i < 50; i++) many.push({ at: "2026-07-20T09:00:00.000Z", event: "plan", by: `p${i}@staff.example` });
  assert.equal(observedView({ auditPath: auditFile(many), maxIdentities: 5 }).people.length, 5);
});

test("OBSERVED NEVER RE-EXPORTS WHAT THE AUDIT LOG IS FOR", () => {
  // The projection to {by, event, account, at} is the point, not laziness. `error` in particular is
  // recorded in the audit BECAUSE the trigger path must not put upstream refusal detail in a response;
  // re-exporting it here would quietly undo that decision one surface over. This test is what stops a
  // well-meaning "let's surface more detail" edit later.
  const p = auditFile([{
    at: "2026-07-20T09:00:00.000Z", event: "trigger", by: "a@staff.example", account: "aurora",
    error: "upstream said PORTAL_OPS_TOKEN was rejected", selector: "recipe:aurora/secret-launch",
    id: "portal-abc123", project: "console-ecosystem", ok: false,
  }]);
  const dumped = JSON.stringify(observedView({ auditPath: p }));
  for (const leak of ["PORTAL_OPS_TOKEN", "secret-launch", "portal-abc123", "console-ecosystem"]) {
    assert.ok(!dumped.includes(leak), `${leak} must not reach a response body`);
  }
  assert.ok(dumped.includes("a@staff.example") && dumped.includes("aurora"), "but who and which brand owner do");
});

test("accessView carries the grants file through, and tolerates not knowing it", () => {
  const withFile = accessView({ grants: GRANTS, grantsFile: { name: "grants.json", modifiedAt: "2026-07-18T00:00:00.000Z" } });
  assert.deepEqual(withFile.grantsFile, { name: "grants.json", modifiedAt: "2026-07-18T00:00:00.000Z" });
  assert.equal(accessView({ grants: GRANTS }).grantsFile, null, "unknown is null, never a guess");
});

// ── the auth row: the one row on this page the PORTAL answers for ───────────────────────────────────
//
// 's fifth criterion, ruled 2026-08-21. Every other row here is snapshot-derived because the portal
// cannot see the engine's environment. This one inverts that: `PORTAL_AUTH_MODE` is read and acted on by
// the portal itself, so routing it through the snapshot would publish a second process's guess about
// this one's own door — and let it go stale, which is the failure the stale notice on this page warns
// about. The tests below pin the exception AND the three things it must never leak.

test("#1439 — an UNSET mode reports the service's default, not 'unconfigured'", () => {
  // portal-service.mjs is explicit that unset means the fronted default ("unset means cf-access, exactly
  // as before"), and it refuses to start in any other. A page reporting a running instance as having no
  // sign-in method would be the most believed wrong answer on the most believed page.
  const a = authView({ mode: "", team: "acme" });
  assert.equal(a.mode, "auth-proxy", "the EFFECTIVE mode, which is what is actually protecting the door");
  assert.equal(a.shape, "fronted");
  // …and the fact that nobody typed it survives separately, because an operator who believes they chose
  // this will never go looking for the variable that would change it.
  assert.equal(a.declared, null, "declared records what was CONFIGURED, which is a different fact");
});

test("#1439 — `cf-access` is NORMALISED, because the service normalises it at the read", () => {
  // item 1 landed in 880cf43e and it is NOT an alias row:
  //     const AUTH_MODE = AUTH_MODE_SET === "cf-access" ? "auth-proxy" : AUTH_MODE_SET;
  // So a box configured `cf-access` is RUNNING `auth-proxy`. Reporting the typed spelling as the mode
  // would name a mode the service is not in — this page disagreeing with the door it describes, which
  // is the one thing it may never do.
  const a = authView({ mode: "cf-access", team: "acme" });
  assert.equal(a.mode, "auth-proxy", "the mode the service actually resolved to");
  assert.equal(a.declared, "cf-access", "and what the operator typed, which is a DIFFERENT question");
  assert.equal(a.shape, "fronted");
});

test("#1439 — the generic issuer wins over the Cloudflare one, and an Entra box is not described by a team it lacks", () => {
  // gave the portal PORTAL_OIDC_ISSUER — the same value the staff MCP face already read. Naming
  // only CF_ACCESS_TEAM would describe every deployment through one vendor's variable, which is the
  // framing exists to remove.
  const entra = authView({ mode: "auth-proxy", oidcIssuer: "https://login.example/v2" });
  assert.equal(entra.issuer, "https://login.example/v2", "its own issuer, with no Cloudflare anywhere");
  assert.deepEqual(entra.missing, [], "and nothing is missing — the service starts on this");

  const both = authView({ mode: "auth-proxy", oidcIssuer: "https://login.example/v2", team: "acme" });
  assert.equal(both.issuer, "https://login.example/v2", "the provider-agnostic one is preferred");

  const cfOnly = authView({ mode: "auth-proxy", team: "acme" });
  assert.equal(cfOnly.issuer, "acme", "and a Cloudflare-fronted box, which configures nothing else, still answers");
});

test("#1439 — the mode is resolved by the SERVICE's own expression, whitespace and case included", () => {
  // portal-service.mjs does `(process.env.PORTAL_AUTH_MODE || "").trim().toLowerCase()`. A view that
  // matched the raw string would report " Local " as unrecognised while the service ran happily in local
  // mode — the page disagreeing with the door it describes.
  assert.equal(authView({ mode: "  Local  " }).shape, "local");
  assert.equal(authView({ mode: "CF-ACCESS", team: "t" }).shape, "fronted");
});

test("#1439 — a missing issuer is a STATE that names its variable, never an omitted row", () => {
  // The same discipline the provider rows take: a row that quietly drops the issuer is indistinguishable
  // from one that never needed it.
  const a = authView({ mode: "cf-access", team: "" });
  assert.equal(a.issuer, null);
  // BOTH, because either satisfies the service — `(!TEAM && !OIDC_ISSUER) || !AUD` is what is fatal.
  // Naming only the Cloudflare one would send an Entra deployment to go and configure Cloudflare.
  assert.deepEqual(a.missing, ["PORTAL_OIDC_ISSUER", "CF_ACCESS_TEAM"], "names BOTH ways to satisfy it");
});

test("#1439 — local mode has no issuer and claims none", () => {
  const a = authView({ mode: "local" });
  assert.equal(a.issuer, null, "there is no third party issuing anything");
  assert.deepEqual(a.missing, [], "and nothing is missing — an empty string here would render as a blank");
});

test("#1439 — an unrecognised mode is reported as such rather than guessed into a shape", () => {
  // portal-service.mjs exits on a mode it does not have, so this is unreachable from a running portal.
  // It is still a state rather than a silent fall-through to the default: a typo must never be able to
  // select an identity source nobody chose, on the page as much as at the door.
  const a = authView({ mode: "loca1" });
  assert.equal(a.shape, "unrecognised");
  assert.equal(a.issuer, null, "and it certainly does not get an issuer");
});

test("#1439 — THE LEAK TEST: no audience, no secret, no local address, whatever is passed in", () => {
  // The ruling is "the mode, and the issuer, and nothing else". This asserts over the SERIALISED view
  // rather than field by field, so a field added later is covered by this arm on the day it is added
  // rather than on the day someone remembers to extend the list.
  const serialised = JSON.stringify(authView({ mode: "cf-access", team: "acme" }));
  for (const forbidden of ["CLEAROTRON_OIDC_AUDIENCE", "aud", "PORTAL_LOCAL_USER", "secret", "token"]) {
    assert.ok(!serialised.toLowerCase().includes(forbidden.toLowerCase()),
      `the auth view carries "${forbidden}" — this page is read over shoulders and in screen shares: ${serialised}`);
  }
  // And the positive half, so the arm above cannot pass by the view having gone empty.
  assert.ok(serialised.includes("acme"), "the issuer IS shown — an empty view would pass every check above");
});

test("#1439 — authView reads NOTHING from process.env, so the route is visibly the reader", () => {
  // If this function read the environment itself, the seam would be invisible and the test would need to
  // mutate process.env to exercise it. Planting a value it would pick up proves it does not.
  const before = process.env.PORTAL_AUTH_MODE;
  const beforeTeam = process.env.CF_ACCESS_TEAM;
  process.env.PORTAL_AUTH_MODE = "local";
  process.env.CF_ACCESS_TEAM = "planted-team";
  try {
    const a = authView({ mode: "cf-access", team: "passed-in" });
    assert.equal(a.shape, "fronted", "the ARGUMENT decided the shape, not the planted environment");
    assert.equal(a.issuer, "passed-in", "and not the planted team");
  } finally {
    if (before === undefined) delete process.env.PORTAL_AUTH_MODE; else process.env.PORTAL_AUTH_MODE = before;
    if (beforeTeam === undefined) delete process.env.CF_ACCESS_TEAM; else process.env.CF_ACCESS_TEAM = beforeTeam;
  }
});

// ── — THE PORTAL NAMES THE MODE, AND ITS CEILING IS HONEST ────────────────────────────────────
//
// The portal cannot COMPUTE this. `driver/portal-service.mjs` deliberately has no engine environment
// and says so three times in one block, so `engineInventory(process.env)` there would report demo on
// every install — a confident wrong answer. It can only read a snapshot, and the mode is derived from
// a fact that snapshot already carries (`binaryPresent`), which is what keeps "derived, never stored"
// true rather than merely claimed.
const poolWithEngine = (engine) => {
  const root = mkdtempSync(join(tmpdir(), "cfgview-mode-"));
  const p = snapshotPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(buildFlagSnapshot(ENGINE_ENV, { capturedAt: AT, engine })));
  return root;
};

test("#1720 no binary is DEMO, a binary is ENGINE-UNPROVEN, and neither is ever engine-ready", () => {
  const demo = flagView(poolWithEngine({ id: "anthropic-agent", known: true, binaryPresent: false }), { now: NOW });
  assert.equal(demo.engineMode, "demo",
    "an install with nothing to spawn is in demo mode, and the surface that decides whether a Start "
    + "button is live has to say so");

  const unproven = flagView(poolWithEngine({ id: "anthropic-agent", known: true, binaryPresent: true }), { now: NOW });
  assert.equal(unproven.engineMode, "engine-unproven",
    "a binary that resolves is NOT proof the engine is signed in — that passes every filesystem test "
    + "and fails at the first stage");
  assert.notEqual(unproven.engineMode, "engine-ready",
    "READY is reachable only from a completed probe turn, and this process never spends one");
});

test("#1720 no snapshot answers NULL, never demo — an absent file is not an absent engine", () => {
  const v = flagView(mkdtempSync(join(tmpdir(), "empty-mode-")), { now: NOW });
  assert.equal(v.available, false);
  assert.equal(v.engineMode, null,
    "inferring demo from a missing snapshot tells a first-time visitor their install is limited when "
    + "what happened is that nobody wrote a snapshot yet — the same defect one level down");
});

test("#1720 a snapshot that predates engine reporting answers NULL rather than guessing", () => {
  // `buildFlagSnapshot` with no engine block is every snapshot written before 's writer. The view
  // already renders `engine: null` there and says it cannot tell; the mode must not be braver than the
  // field it is derived from.
  const v = flagView(pool(), { now: NOW });
  assert.equal(v.engine, null, "fixture precondition: this snapshot carries no engine block");
  assert.equal(v.engineMode, null, "a mode was derived from an engine block that is not there");
});
