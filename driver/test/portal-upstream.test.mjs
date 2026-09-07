// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-upstream — the tenancy wall.
//
// profile-service has no tenancy gate of its own. Until now that was fine: the only door into it was
// the STAFF Cloudflare Access app, so everyone who could reach it was allowed to see everything. The
// unified portal admits CLIENTS, and this module is the only thing between a signed-in client and every
// other client's configuration.
//
// So these are not ordinary tests. Each one is a breach that would be live in production.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeUpstream, stripCodeOwned, serializeProfile, readOnlyFields, frameworkView, PATH_FIELDS, CODE_OWNED_FIELDS } from "../portal-upstream.mjs";
import { makePrincipal, PortalDeny } from "../portal-access.mjs";

const GRANTS = { tenants: {
  celta: { accounts: ["aurora", "zephyr"], users: { "cli@celta.example": ["aurora"], "boss@celta.example": "*" } },
} };
const STAFF_DOMAINS = ["example-firm.com"];
const P = (email) => makePrincipal({ email, grants: GRANTS, staffDomains: STAFF_DOMAINS });
const CLIENT = P("cli@celta.example");      // aurora ONLY
const STAFF = P("staff@example-firm.com");   // everyone

/** Records what actually reached upstream — the only way to prove nothing leaked past the wall. */
function spy(json = {}) {
  const calls = [];
  const callUpstream = async (method, path, body, identity) => {
    calls.push({ method, path, body, identity });
    return { status: 200, json };
  };
  return { calls, up: makeUpstream({ callUpstream }) };
}

const denies = (status) => (e) => e instanceof PortalDeny && e.status === status;

// ── rule 1: the account comes from the principal ────────────────────────────────────────────────────

test("BREACH: a client asking for another customer's profile is refused — and nothing reaches upstream", async () => {
  const { calls, up } = spy();
  await assert.rejects(() => up.getProfile(CLIENT, "zephyr"), denies(404),
    "a foreign account is 404 — never 403, which would confirm zephyr exists");
  assert.equal(calls.length, 0, "the request must not reach profile-service AT ALL — it has no gate of its own");
});

test("a client's own account resolves whether they name it or not", async () => {
  const { calls, up } = spy({ profile: { name: "Aurora" } });
  await up.getProfile(CLIENT, "aurora");
  await up.getProfile(CLIENT, null);
  assert.deepEqual(calls.map((c) => c.path), ["/profiles/aurora", "/profiles/aurora"]);
});

test("BREACH: a client cannot reach another customer through ANY door", async () => {
  const { calls, up } = spy();
  const body = { profile: { name: "x" } };
  await assert.rejects(() => up.writeProfile(CLIENT, "zephyr", "save", body), denies(404));
  await assert.rejects(() => up.writeProfile(CLIENT, "zephyr", "validate", body), denies(404));
  await assert.rejects(() => up.listProjects(CLIENT, "zephyr"), denies(404));
  await assert.rejects(() => up.getProject(CLIENT, "zephyr", "alpha"), denies(404));
  await assert.rejects(() => up.writeProject(CLIENT, "zephyr", "alpha", "save", body), denies(404));
  assert.equal(calls.length, 0, "not one of the five reached upstream");
});

test("staff act for a named account; an unnamed one is an actionable 400, never a silent default", async () => {
  const { calls, up } = spy({ profile: {} });
  await up.getProfile(STAFF, "zephyr");
  assert.equal(calls[0].path, "/profiles/zephyr");
  await assert.rejects(() => up.getProfile(STAFF, null), denies(400),
    "staff reach everyone, so an unnamed account must ask rather than guess");
});

test("the customer ROSTER is never proxied to a client — it is the list of every Cordillera client", async () => {
  const up = makeUpstream({ callUpstream: async () => ({ status: 200, json: {} }), roster: async () => [{ key: "aurora" }] });
  assert.equal((await up.listRoster(CLIENT)).status, 404);
  assert.equal((await up.listRoster(STAFF)).status, 200);
});

// ── rule 3: the code-owned fields ───────────────────────────────────────────────────────────────────

test("BREACH: a crafted body cannot move the fields that decide how a client is RATED", async () => {
  const { calls, up } = spy();
  // The attack: a client re-points the framework that rates their own matters, and raises their caps.
  await up.writeProfile(CLIENT, null, "save", {
    profile: {
      name: "Aurora",
      frameworkPath: "frameworks/always-clear.md",
      workedExamplesPath: "evil.md",
      allowedRecipes: ["*"],
      jxPolicy: { all: true },
      runCaps: { perMonth: 99999 },
    },
  });
  const sent = calls[0].body.profile;
  for (const f of CODE_OWNED_FIELDS) {
    assert.equal(sent[f], undefined, `${f} must be stripped before it reaches the writer`);
  }
  assert.equal(sent.name, "Aurora", "…while the fields a customer DOES own pass through");
});

test("the code-owned list matches profile-service's own — duplication that silently diverges is the bug", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../profile-service.mjs", import.meta.url), "utf8"));
  const m = src.match(/const CODE_OWNED_FIELDS = \[([^\]]*)\]/);
  assert.ok(m, "profile-service still declares CODE_OWNED_FIELDS");
  const theirs = m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  assert.deepEqual([...CODE_OWNED_FIELDS].sort(), theirs.sort(),
    "the two lists must agree — this module strips, profile-service preserves, and a field in only one is a hole");
});

test("serializeProfile is an ALLOWLIST — an unknown key cannot round-trip through the editor", () => {
  const out = serializeProfile({
    name: "Aurora",
    frameworkPath: "frameworks/x.md",     // code-owned: excluded
    somethingNobodyDeclared: "payload",   // unknown: excluded
  });
  assert.equal(out.name, "Aurora");
  assert.equal(out.frameworkPath, undefined);
  assert.equal(out.somethingNobodyDeclared, undefined)
  for (const k of Object.keys(out)) assert.ok(!CODE_OWNED_FIELDS.includes(k));
});

test("the code-owned values are still READABLE by staff — the page shows them badged, it just cannot send them", () => {
  const ro = readOnlyFields({ name: "Aurora", frameworkPath: "frameworks/x.md", runCaps: { perMonth: 10 } }, { staff: true });
  assert.equal(ro.frameworkPath, "frameworks/x.md");
  assert.deepEqual(ro.runCaps, { perMonth: 10 });
  assert.equal(ro.name, undefined, "only the code-owned ones");
});

test("a CLIENT never receives an engine path — the filter is here, not only in the browser", () => {
  const profile = { name: "Aurora", frameworkPath: "skills/prelim-search/risk-framework-aurora.md",
                    workedExamplesPath: "skills/prelim-search/worked-examples-aurora.md",
                    runCaps: { perMonth: 10 }, jxPolicy: "wide" };
  const ro = readOnlyFields(profile, { staff: false });
  assert.equal(ro.frameworkPath, undefined, "the framework path is withheld");
  assert.equal(ro.workedExamplesPath, undefined, "so is the worked-examples path");
  assert.deepEqual(ro.runCaps, { perMonth: 10 }, "the non-path code-owned values still cross");
  assert.equal(ro.jxPolicy, "wide");
  // The old page filtered these in React, which meant the value still crossed the wire and was one
  // devtools tab away. Serialising the whole object is the check that matters: a filter that only the
  // renderer honours would pass a key-by-key assertion on a nested object it never looked at.
  assert.ok(!JSON.stringify(ro).includes("risk-framework-aurora"), "no path anywhere in the payload");
});

test("readOnlyFields fails CLOSED — a caller that forgets the role discloses nothing", () => {
  const ro = readOnlyFields({ frameworkPath: "skills/x.md", runCaps: { perMonth: 1 } });
  assert.equal(ro.frameworkPath, undefined, "no role given ⇒ treated as a client, not as staff");
});

test("frameworkView: a client sees the whole rating method, minus where the file lives", () => {
  const full = {
    path: "skills/prelim-search/risk-framework-zephyr.md",
    custom: true,
    workedExamples: "skills/prelim-search/worked-examples-zephyr.md",
    manifest: { title: "Zephyr Beverages framework", source_deck: "Zephyr Beverages risk deck",
                entity_label: "Zephyr Beverages/Alani/Rockstar",
                bands: [{ label: "Very High", tone: "severe" }, { label: "Manageable", tone: "low" }],
                structure: { kind: "matrix", axes: ["Legal position", "Practical position"] } },
    bandMeanings: [{ band: "Very High", meaning: "Stop and re-name.", response: "do not proceed" }],
  };

  const client = frameworkView(full, { staff: false });
  // Owner decision 2026-07-20: the client sees the method in full. That is doc 50 made visible.
  assert.equal(client.manifest.title, "Zephyr Beverages framework");
  assert.deepEqual(client.bandMeanings, full.bandMeanings,
    "band meanings reach the client — they are the real rating criteria, which is what they asked about");
  assert.equal(client.custom, true);

  // source_deck does NOT, and the field name is the trap: it reads like a deck title and every manifest
  // on disk uses it as an internal provenance note. The house one carries "(Privileged & Confidential)"
  // and a .pptx filename; the demo ones — the accounts built to be shown to a prospect — say "content
  // invented". Pinned with the real house string rather than a tidy invention, because a fixture that
  // reads "Zephyr Beverages risk deck" would pass while proving nothing about the data that actually ships.
  assert.equal(client.manifest.source_deck, undefined, "the provenance note is withheld from a client");
  const houseish = { ...full, manifest: { ...full.manifest,
    source_deck: "Generic house default — IP Risk Assessment Framework.pptx (Privileged & Confidential), transcribed 2026-07-05 (doc 50)" } };
  const seenByClient = JSON.stringify(frameworkView(houseish, { staff: false }));
  assert.ok(!seenByClient.includes("Privileged & Confidential"), "no confidentiality marking reaches a client");
  assert.ok(!seenByClient.includes(".pptx"), "no internal filename either");
  assert.equal(client.manifest.title, "Zephyr Beverages framework", "…while the framework's own title still shows");
  // …but not the paths, and not by accident: the boolean carries the FACT the page needs.
  assert.equal(client.path, undefined);
  assert.equal(client.workedExamples, undefined);
  assert.equal(client.hasWorkedExamples, true,
    "the page renders its worked-examples row off this, not off the path's presence");
  assert.ok(!JSON.stringify(client).includes("worked-examples-zephyr.md"));

  const staff = frameworkView(full, { staff: true });
  assert.equal(staff.path, full.path, "staff keep the paths — they are the ones who open the file");
  assert.equal(staff.hasWorkedExamples, true, "and get the boolean too, so the page has ONE contract");
});

test("END TO END: the getProfile ROUTE applies the role filter, not just the helper", async () => {
  // The helpers above are pure and easy to get right. What this pins is the WIRING — that getProfile
  // actually passes the principal's role down. A route that called readOnlyFields(p) with no options
  // would still pass every unit test above while shipping paths to every client, because the helper
  // would be doing its job correctly on an argument nobody gave it.
  const upstreamBody = {
    profile: { name: "Aurora", frameworkPath: "skills/prelim-search/risk-framework-aurora.md",
               workedExamplesPath: "skills/prelim-search/worked-examples-aurora.md" },
    contextPack: "Aurora watches the handheld-console resellers.",
    framework: { path: "skills/prelim-search/risk-framework-aurora.md", custom: true,
                 workedExamples: "skills/prelim-search/worked-examples-aurora.md",
                 manifest: { title: "Aurora framework", bands: [{ label: "High", tone: "high" }],
                             source_deck: "Synthetic demo transposition (content invented)" },
                 bandMeanings: [{ band: "High", meaning: "Re-name unless counsel says otherwise." }] },
    derived: { batchSize: 3, minCellsPerVariant: 14 },
  };

  const asClient = await spy(upstreamBody).up.getProfile(CLIENT, null);
  const seen = JSON.stringify(asClient.json);
  assert.ok(!seen.includes("risk-framework-aurora.md"), "no framework path reaches a client, anywhere in the body");
  assert.ok(!seen.includes("worked-examples-aurora.md"), "nor the worked-examples path");
  // The whole-body check that matters for the pitch: `aurora` is a synthetic demo account, and its
  // manifest says so in words. Sylvain logging into a demo tenant must not be told the ratings he is
  // being shown were invented.
  assert.ok(!seen.includes("content invented"), "no provenance note reaches a client, anywhere in the body");
  assert.equal(asClient.json.framework.hasWorkedExamples, true, "but the FACT survives as a boolean");
  assert.equal(asClient.json.framework.manifest.title, "Aurora framework", "the method itself is theirs to see");
  assert.deepEqual(asClient.json.framework.bandMeanings, upstreamBody.framework.bandMeanings);
  assert.equal(asClient.json.contextPack, upstreamBody.contextPack, "and the pack they now edit");
  assert.deepEqual(asClient.json.derived, { batchSize: 3, minCellsPerVariant: 14 }, "coverage is not secret");

  const asStaff = await spy(upstreamBody).up.getProfile(STAFF, "aurora");
  assert.equal(asStaff.json.readOnly.frameworkPath, "skills/prelim-search/risk-framework-aurora.md",
    "staff keep the path — they are the ones who open the file");
  assert.equal(asStaff.json.framework.path, "skills/prelim-search/risk-framework-aurora.md");
  // REVERSED by (owner, 2026-08-31, on his own install's generic page: "cannot say
  // this - its an obvious link to client data"): the provenance note renders for NO role. This line
  // used to assert staff keep it — that one-branch strip is exactly how the leak shipped. The note is
  // not deleted; it stays in the manifest on disk, and staff read it there.
  assert.equal(asStaff.json.framework.manifest.source_deck, undefined,
    "the provenance note reaches no role's page — the surface is one surface whoever reads it");
});

test("EVERY path field is redacted, not just the two known today", () => {
  // The same guard portal-ui/test/profileFields.test.ts runs over its own copy of this list. The two
  // packages cannot import from each other, so the lists are pinned separately against CODE_OWNED_FIELDS
  // rather than against one another. A seventh code-owned field called `overridesPath` fails both.
  for (const f of CODE_OWNED_FIELDS) {
    if (f.endsWith("Path")) assert.ok(PATH_FIELDS.includes(f), `${f} looks like a path but is not redacted`);
  }
});

test("frameworkView: no worked examples ⇒ the row is false, not missing", () => {
  assert.equal(frameworkView({ custom: false, workedExamples: "" }, { staff: false }).hasWorkedExamples, false);
  assert.equal(frameworkView({ custom: false }, { staff: true }).hasWorkedExamples, false);
  assert.equal(frameworkView(null, { staff: true }), null, "a degraded upstream stays null, never {}");
  assert.equal(frameworkView([], { staff: true }), null, "an array is not a framework");
});

test("stripCodeOwned never mutates its input — a shared draft object must not be edited underneath a caller", () => {
  const original = { name: "Aurora", runCaps: { perMonth: 10 } };
  const stripped = stripCodeOwned(original);
  assert.deepEqual(original, { name: "Aurora", runCaps: { perMonth: 10 } });
  assert.equal(stripped.runCaps, undefined);
});

// ── path handling ───────────────────────────────────────────────────────────────────────────────────

test("BREACH: a project key cannot climb out of its customer's directory", async () => {
  const { calls, up } = spy();
  for (const evil of ["../../zephyr/secret", "..", "a/b", "with space", "", "x".repeat(200)]) {
    const r = await up.getProject(CLIENT, null, evil);
    assert.equal(r.status, 404, `"${evil}" must not resolve`);
  }
  assert.equal(calls.length, 0, "no crafted key reached upstream");
  // …and an ordinary one does.
  const ok = await up.getProject(CLIENT, null, "spring-launch");
  assert.equal(ok.status, 200);
  assert.equal(calls[0].path, "/profiles/aurora/projects/spring-launch");
});

test("the write ACTION is two literals, never interpolated from input", async () => {
  const { calls, up } = spy();
  for (const evil of ["save/../../x", "delete", "", null, "SAVE"]) {
    assert.equal((await up.writeProfile(CLIENT, null, evil, { profile: {} })).status, 404, `action "${evil}"`);
  }
  assert.equal(calls.length, 0);
});

test("an unknown profile upstream and a foreign one are the SAME answer to the caller", async () => {
  const up = makeUpstream({ callUpstream: async () => ({ status: 404, json: { error: "unknown_profile" } }) });
  const r = await up.getProfile(CLIENT, null);
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: "not_found" },
    "upstream's 'unknown_profile' would tell a prober which accounts exist");
});

test("a malformed body is refused before it reaches the writer", async () => {
  const { calls, up } = spy();
  for (const bad of [undefined, null, "string", 42, []]) {
    const r = await up.writeProfile(CLIENT, null, "save", { profile: bad });
    assert.equal(r.status, 400, `profile: ${JSON.stringify(bad)}`);
  }
  assert.equal(calls.length, 0);
});

test("identity travels as a VERIFIED ARGUMENT, never as a body field", async () => {
  // profile-service stamps the git author and the audit line from the identity it is HANDED, and
  // ignores any author in the body. Both halves matter: the verified principal must reach it (or every
  // config change is attributed to nobody), and a body field that merely looks like an author must not
  // be carried along for some future reader to trust.
  const { calls, up } = spy({ profile: {} });
  await up.writeProfile(CLIENT, null, "save", {
    profile: { name: "Aurora" },
    by: "attacker@evil.example",           // a crafted author
    email: "attacker@evil.example",
  });
  assert.equal(calls[0].identity.email, "cli@celta.example",
    "the VERIFIED principal reaches upstream — otherwise the git author is nobody");
  const sentBody = JSON.stringify(calls[0].body);
  assert.ok(!sentBody.includes("attacker@evil.example"),
    "a body-supplied author is not forwarded — only `profile` and `contextPack` cross");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["profile"],
    "the forwarded body is an allowlist, not a pass-through");
});

// ── rule 4: role no longer shapes the project list ──────────────────────────────────────────────────
//
// It used to. Archived projects were filtered out of a client's view here (2026-07-20: hide them
// completely, recovery via Cordillera), which held together while Cordillera created every project —
// the party who could bring one back was the party who had set it up.
//
// Clients create their own now. Under that filter, archiving a project you had just made removed it
// from your list AND removed the only control that could restore it, so the screen carried a paragraph
// warning that archiving was one-way. These tests pin the replacement: both roles see the same rows,
// the flag reaches the screen, and tenancy stays exactly where it was.

test("both roles see an archived project, flagged — because hiding it is what made archiving one-way", async () => {
  const body = { customer: "aurora", projects: [
    { key: "live-one", name: "Live one", archived: false },
    { key: "retired-one", name: "Retired one", archived: true },
  ] };

  for (const [who, principal, requested] of [["a client", CLIENT, null], ["staff", STAFF, "aurora"]]) {
    const r = await spy(body).up.listProjects(principal, requested);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.projects.map((p) => p.key), ["live-one", "retired-one"], `${who} sees both`);
    assert.equal(r.json.projects[1].archived, true, "and the flag reaches the screen, which greys the row");
    assert.equal(r.json.customer, "aurora", "the rest of the body is passed through untouched");
  }
});

test("a client can read an archived project of their own — that is how it gets brought back", async () => {
  const archived = { overlay: { archived: true, projectName: "Retired one" }, effective: {}, origins: {} };
  const client = await spy(archived).up.getProject(CLIENT, null, "retired-one");
  assert.equal(client.status, 200, "reading it is how the un-archive control has something to act on");
  assert.equal(client.json.overlay.archived, true);
});

test("archived was never the tenancy rule, and removing it did not touch the one that is", async () => {
  // THE PROPERTY THAT MATTERS. Rule 2 lives in resolveAccount: a client naming an account that is not
  // theirs gets 404 whatever the project's state. Loosening the archive filter must not have loosened
  // this, so it is asserted right beside it.
  const archived = { overlay: { archived: true }, effective: {}, origins: {} };
  const foreign = spy(archived);
  // A PortalDeny(404), which the service renders as the same not_found a nonexistent project gets.
  const is404 = (e) => e instanceof PortalDeny && e.status === 404;
  await assert.rejects(() => foreign.up.getProject(CLIENT, "zephyr", "retired-one"), is404);
  await assert.rejects(() => foreign.up.listProjects(CLIENT, "zephyr"), is404);
  assert.deepEqual(foreign.calls, [], "and nothing reached the upstream at all");
});

test("a degraded upstream response is passed through, not turned into a throw", async () => {
  // spy()'s default json is {} — a body with no projects[] at all. Previously a bare `.filter` on it
  // could have thrown inside the wall; now there is no filter, and the shape problem stays upstream's.
  const empty = await spy().up.listProjects(CLIENT, null);
  assert.equal(empty.status, 200);
});

// ── saved searches — the same wall, over a service that has NO tenancy gate whatsoever ──────────────
//
// recipe-service was built as a staff tool behind CF Access: its routes take the customer as a PATH
// SEGMENT and gate it only against the profile roster, which is an EXISTENCE check, not an ownership
// one. Reaching it from the client portal means `/recipes/zephyr/...` would answer for any caller that
// could name zephyr. These tests pin the only thing preventing that: the customer segment is built
// from the account resolveAccount returned, never from anything the caller said.

/** A spy over the RECIPE channel specifically, so a leak is provable by what path was built. */
function recipeSpy(json = {}) {
  const calls = [];
  const callRecipes = async (method, path, body, identity) => {
    calls.push({ method, path, body, identity });
    return { status: 200, json };
  };
  return { calls, up: makeUpstream({ callUpstream: async () => ({ status: 200, json: {} }), callRecipes }) };
}

test("BREACH: a client listing another customer's saved searches is refused — nothing reaches the store", async () => {
  const { calls, up } = recipeSpy();
  await assert.rejects(() => up.listSearches(CLIENT, "zephyr"), denies(404));
  assert.equal(calls.length, 0, "a refused read must not reach the recipe store at all");
});

test("BREACH: a client cannot WRITE a saved search under another customer", async () => {
  const { calls, up } = recipeSpy();
  await assert.rejects(() => up.writeSearch(CLIENT, "zephyr", "us-knockouts", "save", { recipe: { label: "x", base: "knockout-search" } }),
    denies(404));
  assert.equal(calls.length, 0, "a refused write must not reach the recipe store at all");
});

test("the customer segment is built from the RESOLVED account, never from the caller's words", async () => {
  const { calls, up } = recipeSpy();
  // the client names nothing; their single grant resolves
  await up.listSearches(CLIENT, null);
  assert.equal(calls[0].path, "/recipes/aurora", "resolved from the principal, not the request");
  await up.writeSearch(CLIENT, "aurora", "us-knockouts", "save", { recipe: { label: "US knockouts", base: "knockout-search" } });
  assert.equal(calls[1].path, "/recipes/aurora/us-knockouts/save");
});

test("a path-shaped slug cannot escape the customer's directory", async () => {
  const { calls, up } = recipeSpy();
  for (const evil of ["../zephyr/secret", "a/b", "..", "with space", ""]) {
    const r = await up.getSearch(CLIENT, "aurora", evil);
    assert.equal(r.status, 404, `slug ${JSON.stringify(evil)} must be refused`);
  }
  assert.equal(calls.length, 0, "no malformed slug reaches the store");
});

test("only validate and save are mountable actions — no delete verb exists to reach", async () => {
  const { calls, up } = recipeSpy();
  for (const action of ["delete", "remove", "destroy", "archive"]) {
    const r = await up.writeSearch(CLIENT, "aurora", "x", action, { recipe: {} });
    assert.equal(r.status, 404, `${action} must not be routable`);
  }
  assert.equal(calls.length, 0);
});

test("STAFF may act for any account, and the account they name is the one that is used", async () => {
  const { calls, up } = recipeSpy();
  await up.listSearches(STAFF, "zephyr");
  assert.equal(calls[0].path, "/recipes/zephyr");
});

test("with no recipe store wired, every saved-search route answers 404 rather than guessing one", async () => {
  const up = makeUpstream({ callUpstream: async () => ({ status: 200, json: {} }) });   // no callRecipes
  assert.equal((await up.listSearches(CLIENT, "aurora")).status, 404);
  assert.equal((await up.getSearch(CLIENT, "aurora", "x")).status, 404);
  assert.equal((await up.writeSearch(CLIENT, "aurora", "x", "save", { recipe: {} })).status, 404);
});

test("expectedVersion is carried through so a concurrent edit 409s instead of clobbering", async () => {
  const { calls, up } = recipeSpy();
  await up.writeSearch(CLIENT, "aurora", "x", "save", { recipe: { label: "L", base: "knockout-search" }, expectedVersion: 3 });
  assert.equal(calls[0].body.expectedVersion, 3);
  // absent ⇒ not invented
  await up.writeSearch(CLIENT, "aurora", "x", "save", { recipe: { label: "L", base: "knockout-search" } });
  assert.equal("expectedVersion" in calls[1].body, false);
});

test("a saved search must be an object — a string or array is refused before the store sees it", async () => {
  const { calls, up } = recipeSpy();
  for (const bad of ["a string", [1, 2], null, 42]) {
    const r = await up.writeSearch(CLIENT, "aurora", "x", "save", { recipe: bad });
    assert.equal(r.status, 400);
  }
  assert.equal(calls.length, 0);
});

// ──: provenance reaches NO role, for EVERY deck — the class, held both ways ─────

test("2085: a planted source_deck survives NEITHER branch of frameworkView", () => {
  // The leak shipped through the branch the strip did not cover: client was cleaned, staff passed the
  // manifest whole, and the owner met the Privileged & Confidential line on his own page. The plant
  // drives BOTH branches with the same poisoned manifest, so a future one-branch regression cannot
  // read as covered by the other branch's green.
  const planted = { manifest: { title: "T", source_deck: "PLANTED — Privileged & Confidential.pptx (doc 50)" } };
  for (const staff of [true, false]) {
    const v = frameworkView(planted, { staff });
    assert.equal(v.manifest.source_deck, undefined, `source_deck survived the ${staff ? "staff" : "client"} branch`);
    assert.ok(!JSON.stringify(v).includes("PLANTED"), `the planted provenance string reached the ${staff ? "staff" : "client"} view`);
    assert.equal(v.manifest.title, "T", "…while the rest of the manifest still rides");
  }
});

test("2085: EVERY bundled deck's REAL manifest is clean through the view — not just the one the owner saw", () => {
  // The acceptance names the sweep: generic, aurora, zephyr, demo, triage — a uniform fix that misses
  // one member carries the defect. Driven over the real files on disk, not fixtures, because the real
  // strings ("Privileged & Confidential", "content invented", the engine source path) are what ships.
  const dir = fileURLToPath(new URL("../skills/prelim-search/", import.meta.url));
  const manifests = readdirSync(dir).filter((f) => f.endsWith(".manifest.json"));
  assert.ok(manifests.length >= 5, `only ${manifests.length} manifest(s) found — the walker broke, not the tree`);
  for (const f of manifests) {
    const manifest = JSON.parse(readFileSync(join(dir, f), "utf8"));
    assert.ok(typeof manifest.source_deck === "string" && manifest.source_deck.length,
      `${f} carries no source_deck on disk — the repo-side provenance must NOT be deleted (acceptance 3), and this sweep would be vacuous`);
    for (const staff of [true, false]) {
      const v = frameworkView({ manifest }, { staff });
      assert.equal(v.manifest.source_deck, undefined, `${f}'s provenance reached the ${staff ? "staff" : "client"} view`);
    }
  }
});
