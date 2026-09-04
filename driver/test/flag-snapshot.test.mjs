// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The flag snapshot.
//
// This file used to open with "THE BLOCKER": reading process.env inside portal-service reported every
// kill switch as off, because unset and off were the same value, so a naive portal refused every knockout
// on a correctly-configured box. The snapshot was the fix, and `flagsFor` carried it into the gate.
//
// The kill switches were RETIRED on 2026-07-27 and the whole class went with them. The first test here is
// still the one that matters, but it now asserts the stronger property: availability does not consult an
// environment at all, so a process with NO environment — the portal, the ops-MCP, a unit test — cannot
// reach a different answer from the engine's.
//
// That inversion is the regression test for the bug that prompted the retirement. `describe_options` and
// `plan_run` told clients that knockout, knockout-register and prelim-jx were "not switched on for this
// account" while the engine would have run all three, because the ops-MCP unit has no EnvironmentFile and
// nobody had plumbed a snapshot into it. Every test that existed at the time injected a `flags` map, which
// is exactly why a caller relying on the default went unnoticed. These do not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlagSnapshot, builtFor, isStale, snapshotPath, postureDelta, PRODUCTION_POSTURE, engineFor, providersFor, writeFlagSnapshot, readFlagSnapshot } from "../flag-snapshot.mjs";
import { gateResolvedPolicy, productAvailability, gateCause, BUILT, PRODUCT_POLICIES, ORDERABLE_PRODUCTS } from "../search-policy.mjs";

const KNOCKOUT = { level: "knockout", stageLabel: "Depth 1", pipeline: "knockout", components: {} };
const PRELIM = { level: "prelim", stageLabel: "Depth 4", pipeline: "prelim", components: {} };
const AT = "2026-07-19T12:00:00Z";

// The engine's environment once carried three switches; nothing reads them now. Kept as a realistic
// input to buildFlagSnapshot (which must ignore retired names) rather than as a precondition.
const ENGINE_ENV = { CLEAROTRON_JX_SERP_GRID: "1", CLEAROTRON_JX_NATIVEREAD: "1", CLEAROTRON_JX_CONSUME: "1" };

test("THE REGRESSION: an EMPTY environment must refuse nothing — no caller can be wrong by default", () => {
  // No options argument at all, and no CLEAROTRON_* in scope. This is how the ops-MCP calls it, and calling
  // it this way is what produced a client-facing lie about three shipped depths.
  const saved = {};
  for (const n of ["CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_JX_LANES", "CLEAROTRON_RECIPES_MODE"]) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  try {
    assert.equal(gateResolvedPolicy(KNOCKOUT), null, "knockout runs with no environment");
    assert.equal(gateResolvedPolicy(PRELIM), null);
    const jx = { level: "prelim-jx", stageLabel: "Depth 5", pipeline: "clearance", components: { jxLanes: true } };
    assert.equal(gateResolvedPolicy(jx), null, "and so does the native-script deepening");
    const recipe = { ...PRELIM, recipe: { slug: "screen" } };
    assert.equal(gateResolvedPolicy(recipe), null, "and a saved search");

    // The same, through the two client-facing readers. EVERY built level must be pickable.
    for (const key of ORDERABLE_PRODUCTS) {
      assert.equal(productAvailability(PRODUCT_POLICIES[key]), null, `${key} must be available with no env`);
      assert.equal(gateCause({ ...PRODUCT_POLICIES[key], level: key }), null, `${key} must have no gate cause`);
    }
  } finally {
    for (const [n, v] of Object.entries(saved)) if (v !== undefined) process.env[n] = v;
  }
});

test("setting a retired switch to 0 changes NOTHING — a stale .env cannot disable a shipped depth", () => {
  // Prod's .env still names these until someone cleans it up, and a future operator may well try to
  // "turn something off" with one. It must be inert rather than half-working.
  const saved = {};
  for (const n of ["CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_JX_LANES", "CLEAROTRON_RECIPES_MODE"]) {
    saved[n] = process.env[n];
    process.env[n] = "0";
  }
  try {
    assert.equal(gateResolvedPolicy(KNOCKOUT), null);
    assert.equal(productAvailability(PRODUCT_POLICIES["full-country-search"]), null);
    const recipe = { ...PRELIM, recipe: { slug: "screen" } };
    assert.equal(gateResolvedPolicy(recipe), null);
  } finally {
    for (const [n, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
});

test("a missing snapshot degrades to AVAILABLE — it must never take the product down", () => {
  // Unknown availability is accepted and falls through to the engine. Failing closed would mean one
  // unreadable file stops anybody starting any search.
  assert.deepEqual(builtFor(null), { ...BUILT });
  assert.equal(gateResolvedPolicy(KNOCKOUT, { built: builtFor(null) }), null);
  assert.equal(gateResolvedPolicy(PRELIM, { built: builtFor(null) }), null);
});

test("BUILT is what decides, and it is the ONLY thing that decides", () => {
  // A component the BUILD does not have is refused. Asserted against an injected map rather than
  // whichever feature happens to be unfinished today — that is what the `built` injection point is for,
  // and since the switches went it is the only injection point there is.
  const registerProbe = { level: "knockout-register", stageLabel: "Depth 2", pipeline: "knockout", components: { registerProbe: true } };
  const refusal = gateResolvedPolicy(registerProbe, { built: { ...BUILT, registerProbe: false } });
  assert.ok(refusal, "a level that does not exist is refused");
  assert.match(refusal, /not available in this build/);
  assert.equal(gateResolvedPolicy(registerProbe), null, "…and passes once the build has it");

  // And the snapshot carries the map, because env alone cannot answer the question.
  const snap = buildFlagSnapshot(ENGINE_ENV, { capturedAt: POSTURE_AT });
  assert.deepEqual(snap.built, BUILT);
  assert.deepEqual(snap.killSwitches, [], "no flag gates admission any more — and the field says so");
});

test("built.registerProbe follows the REGISTER, not just the build — what offers Depth 2 must match what runs it", () => {
  // Depth 2 is a count, and a provider that cannot count cannot run it however complete the build
  // is. Without this the composer would offer the level from BUILT and the engine would refuse it at
  // the lane preflight — an invitation with no matching ability, which is how a client gets sold
  // something that then fails.
  const cannot = buildFlagSnapshot(ENGINE_ENV, { capturedAt: AT, registerProvider: "signa", registerCanCount: false });
  assert.equal(cannot.built.registerProbe, false, "the offer is withdrawn when the wired register cannot count");
  assert.equal(cannot.built.knockout, BUILT.knockout, "…and nothing else moves");
  assert.deepEqual(cannot.register, { provider: "signa", canCount: false }, "the staff screen can say WHY");

  const can = buildFlagSnapshot(ENGINE_ENV, { capturedAt: AT, registerProvider: "corsearch", registerCanCount: true });
  assert.equal(can.built.registerProbe, BUILT.registerProbe);

  // Unknown (no provider information at all) leaves BUILT alone — the degradation rule: unknown reads
  // as available and the request falls through to the gate, never hidden by a snapshot that cannot say.
  assert.deepEqual(buildFlagSnapshot(ENGINE_ENV, { capturedAt: POSTURE_AT }).built, BUILT);

  // And a client-facing surface reads it through builtFor.
  assert.equal(builtFor(cannot).registerProbe, false);
  const policy = { pipeline: "knockout", components: { registerProbe: true } };
  assert.equal(productAvailability(policy, { built: builtFor(cannot) }), "unbuilt");
  assert.equal(productAvailability(policy, { built: builtFor(can) }), null);
});

test("the snapshot is an ALLOWLIST — it is a file a web service reads", () => {
  const snap = buildFlagSnapshot({
    ...ENGINE_ENV,
    // None of these may appear, whatever happens to be in the engine's environment.
    CORSEARCH_SESSION_KEY: "secret-value",
    ANTHROPIC_API_KEY: "sk-secret",
    CLEAROTRON_REPORTS_DIR: "/srv/trademark-archive",
    CLEAROTRON_GATHER_CONCURRENCY: "8",
    PORTAL_SECRET: "hmac-secret",
  }, { capturedAt: POSTURE_AT });

  const serialised = JSON.stringify(snap);
  for (const forbidden of ["secret-value", "sk-secret", "/srv/trademark-archive", "hmac-secret", "GATHER"]) {
    assert.ok(!serialised.includes(forbidden), `${forbidden} must never reach the snapshot`);
  }
  // step 4.0 — GOVERNED, not prefixed: this asserted `/^CLEAROTRON_/`, which is true only while every
  // switch is written in a retired spelling, so the first converted flag would have reddened it for
  // being correct.
  //
  // AND IT HAS NEVER RUN. `EXPOSED` is empty — the product tracks no flags since the kill switches were
  // retired — so `snap.flags` is `{}` in all nine snapshots this file builds, and the loop body executed
  // zero times for as long as the assertion existed. It read as covered because the `for` and the
  // `assert` shared a LINE: coverage marked the line executed by the loop statement, not by its body.
  // Putting the assert on its own line is what exposed it; the coverage census caught it immediately.
  //
  // So the live assertion is the one that is true today, and it FAILS the day a flag returns — which is
  // when the name rule below acquires its first case and needs a test of its own.
  assert.equal(snap.flagsDeclared, 0,
    "a flag is exposed again — give the name rule below a real case rather than leaving it iterating nothing");
  const ungoverned = Object.keys(snap.flags)
    .filter((n) => !(/^(?:PRELIM|CLEAROTRON)_/.test(n) || n !== n));
  assert.deepEqual(ungoverned, [],
    `these are in the snapshot and are not switches this product governs: ${ungoverned.join(", ")}`);
});

test("a RETIRED switch is not in the snapshot at all — the allowlist is the record of what still exists", () => {
  // Leaving them in would keep a staff screen showing three rows that decide nothing, which is the same
  // reassuring-lie failure the `effect` field exists to prevent, one level up.
  const snap = buildFlagSnapshot({ CLEAROTRON_KNOCKOUT_MODE: "1", CLEAROTRON_JX_LANES: "0", CLEAROTRON_RECIPES_MODE: "1", ...ENGINE_ENV }, { capturedAt: POSTURE_AT });
  for (const gone of ["CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_JX_LANES", "CLEAROTRON_RECIPES_MODE"]) {
    assert.ok(!(gone in snap.flags), `${gone} is retired and must not be reported as a live flag`);
  }
});

test("#1149 item 8 — the product declares NO flag, and the snapshot says so in a number", () => {
  // The three tests this replaces asserted the flag machinery on its four members: every flag carries a
  // silent-output-change effect, `set` separates explicitly-off from never-configured, and a default-ON
  // flag reads ON when unset. All four members are deleted, so those arms had nothing left to run on —
  // and an arm with no member is the shape that reads green while asserting nothing.
  //
  // What replaces them is the fact that matters now: a reader must be able to tell "this snapshot tracks
  // no flags" from "this snapshot lost its flags", and `flags: {}` alone cannot say which.
  const snap = buildFlagSnapshot(ENGINE_ENV, { capturedAt: POSTURE_AT });
  assert.deepEqual(snap.flags, {}, "no flag is declared — #1149 item 8 deleted all four");
  assert.equal(snap.flagsDeclared, 0, "…and the snapshot states that as a count rather than leaving it inferred");
  assert.ok("flagsDeclared" in snap, "present even at zero: absent and zero are different facts");
});

test("#1149 item 8 — a retired switch is not a live one: the deleted names get no row, however they are set", () => {
  // The counterfactual that makes the arm above mean something. ENGINE_ENV sets all three jx arms to "1".
  // If the allowlist ever grew one back by accident, this reddens.
  const snap = buildFlagSnapshot(ENGINE_ENV, { capturedAt: POSTURE_AT });
  for (const dead of ["CLEAROTRON_JX_SERP_GRID", "CLEAROTRON_JX_NATIVEREAD", "CLEAROTRON_JX_CONSUME", "CLEAROTRON_COMMONLAW_SPLIT"]) {
    assert.equal(snap.flags[dead], undefined, `${dead} is deleted and must not reappear in the snapshot`);
  }
});

test("staleness is reported, never acted on", () => {
  const now = Date.parse("2026-07-19T12:00:00Z");
  const fresh = buildFlagSnapshot(ENGINE_ENV, { capturedAt: "2026-07-19T11:00:00Z" });
  const old = buildFlagSnapshot(ENGINE_ENV, { capturedAt: "2026-07-01T11:00:00Z" });
  assert.equal(isStale(fresh, { now }), false);
  assert.equal(isStale(old, { now }), true);
  assert.equal(isStale(null, { now }), true);
  // A stale snapshot is still USED — its values are the last known truth, and refusing to use them
  // would be the fail-closed behaviour this design exists to avoid.
  assert.equal(gateResolvedPolicy(KNOCKOUT, { built: builtFor(old) }), null);
});

test("the snapshot lives beside the pool, so it shares its lifecycle", () => {
  assert.match(snapshotPath("/srv/trademark-archive"), /^\/srv\/trademark-archive\/_state\//);
});

// ── — the posture delta ──────────────────────────────────────────────────────────────────────
// A round said "the China lane is verified" while two of its three slices could not run on the only
// instance the suite may use. Nothing compared the two boxes, so the overstatement was invisible.

const POSTURE_AT = "2026-08-05T00:00:00.000Z";
const prodEnv = { CLEAROTRON_JX_SERP_GRID: "1", CLEAROTRON_JX_NATIVEREAD: "1", CLEAROTRON_JX_CONSUME: "1",
  EUIPO_ENVIRONMENT: "production", EUIPO_CLIENT_ID: "x", EUIPO_CLIENT_SECRET: "y" };

test("#1149 item 8 — an EMPTY flag comparison is reported as vacuous, never as agreement", () => {
  // This is the arm the retirement turns on. With no flag declared on either side the comparison loop
  // runs zero times, and the old assertion here — deepEqual(d, []) — would have gone green while
  // checking nothing, telling a reader this box matches production when nothing was compared.
  const d = postureDelta(buildFlagSnapshot(prodEnv, { capturedAt: POSTURE_AT }));
  const vacuous = d.find((r) => r.what === "flags");
  assert.ok(vacuous, "the flag half must say it checked nothing");
  assert.match(vacuous.effect, /checked nothing/);
  assert.notDeepEqual(d, [], "an empty array here would read as 'no difference found', which is a lie");
  // …and the EUIPO half still agrees, so the row above is the ONLY thing separating this from silence.
  assert.deepEqual(d.filter((r) => r.what !== "flags"), [], "production's EUIPO posture still matches");
});

test("the test box's posture is reported line by line, not as one word", () => {
  // 's state minus the three jx flags, which item 8 deleted: EUIPO defaulting to sandbox with
  // no credentials is still a two-row difference, and each row still names itself.
  const d = postureDelta(buildFlagSnapshot({}, { capturedAt: POSTURE_AT }));
  const names = d.map((r) => r.what);
  assert.ok(names.includes("EUIPO_ENVIRONMENT"));
  assert.ok(names.includes("EUIPO credentials"));
  for (const r of d.filter((x) => x.what !== "flags")) {
    assert.notEqual(r.here, r.production, "a row is only emitted for a real difference");
  }
});

test("EUIPO: sandbox with no credentials is NOT the same as sandbox with them", () => {
  const noCreds = buildFlagSnapshot({ EUIPO_ENVIRONMENT: "sandbox" }, { capturedAt: POSTURE_AT });
  const withCreds = buildFlagSnapshot({ EUIPO_ENVIRONMENT: "sandbox", EUIPO_CLIENT_ID: "a", EUIPO_CLIENT_SECRET: "b" }, { capturedAt: POSTURE_AT });
  assert.equal(noCreds.euipo.credentials, 0);
  assert.equal(withCreds.euipo.credentials, 2);
  // the tools are wired either way; zero credentials means they cannot authenticate at all, which is
  // what R1 disclosed unprompted and what made every EU leg single-vendor
  assert.ok(postureDelta(noCreds).some((r) => r.what === "EUIPO credentials"));
});

test("the snapshot carries the COUNT and never a credential value", () => {
  const snap = buildFlagSnapshot(prodEnv, { capturedAt: POSTURE_AT });
  const text = JSON.stringify(snap);
  assert.equal(snap.euipo.credentials, 2);
  assert.equal(text.includes("\"x\""), false, "EUIPO_CLIENT_ID's value must never reach a file a web service reads");
  assert.equal(text.includes("\"y\""), false, "nor EUIPO_CLIENT_SECRET's");
});

test("no snapshot is not agreement — it is the one answer that fails", () => {
  assert.equal(postureDelta(null), null);
  assert.equal(postureDelta({}), null);
  assert.equal(postureDelta({ flags: {} }).length > 0, true, "an empty flags block is a full delta, not a match");
});

test("EUIPO_ENVIRONMENT unset reports the SERVER's default rather than the empty string", () => {
  // euipo-server.mjs:11 defaults it to sandbox, so an unset variable means the server will use sandbox.
  // Reporting "" would make a reader think the posture is unknown when it is decided.
  const snap = buildFlagSnapshot({}, { capturedAt: POSTURE_AT });
  assert.equal(snap.euipo.environment, "sandbox");
  assert.equal(snap.euipo.set, false, "and it still says nobody configured it");
});

test("the production posture names where it was read from", () => {
  assert.match(PRODUCTION_POSTURE.source, /2026-08-04/);
  assert.match(PRODUCTION_POSTURE.source, /#372/);
});

// ──: what this instance searches with, and the third state that is not "none" ─────────────────

test("#1439 — a snapshot written before the engine recorded this OMITS the keys, and reads as UNKNOWN", () => {
  // The direction that ships the lie if it is collapsed, and the one every deployment is in until its
  // driver next drains. `engine: {}` / `providers: []` would say "an engine with no name" and "no
  // provider is configured" — the second of which is the exact inverse of the fact.
  const snap = buildFlagSnapshot(ENGINE_ENV, { capturedAt: AT });
  assert.ok(!("engine" in snap), "omitted, not null and not empty");
  assert.ok(!("providers" in snap), "omitted, not null and not empty");
  assert.equal(engineFor(snap), null, "and the reader answers UNKNOWN");
  assert.equal(providersFor(snap), null);
});

test("#1439 — the writer's values survive the round trip", () => {
  const engine = { id: "openai-agent", vendor: "OpenAI", known: true, binaryPresent: true,
    billing: { mode: "api-key", apiBilled: true, missing: [] } };
  const providers = [{ key: "web", label: "Open-web search", provider: "serpapi",
    providerLabel: "SerpAPI", known: true, configured: false, missing: ["SERPAPI_API_KEY"] }];
  const snap = buildFlagSnapshot(ENGINE_ENV, { capturedAt: AT, engine, providers });
  assert.deepEqual(engineFor(snap), engine);
  assert.deepEqual(providersFor(snap), providers);
});

test("#1439 — an instance with NOTHING configured is an ARRAY of rows, which is not the unknown state", () => {
  // The distinction the two tests above exist for, asserted together: null and [] must never be reached
  // by the same input. A reader that treats them alike tells a staff member the opposite of the truth in
  // one direction or the other.
  const none = buildFlagSnapshot({}, { capturedAt: AT, engine: null, providers: [] });
  assert.deepEqual(providersFor(none), [], "nothing configured — a real, empty answer");
  assert.notEqual(providersFor(none), null, "…which is NOT the same as the writer not saying");
  assert.equal(engineFor(none), null, "a null engine is not an object, so it reads as unknown");
  const absent = buildFlagSnapshot({}, { capturedAt: AT });
  assert.equal(providersFor(absent), null, "an absent key is the unknown state");
});

test("#1439 — a malformed block reads as UNKNOWN rather than being rendered", () => {
  // The snapshot is a file on disk that a web service parses. Every malformed shape gets the same answer
  // as a missing one, because the page's response to both is identical: say it cannot tell.
  assert.equal(engineFor({ engine: [] }), null, "an array is not an engine");
  assert.equal(engineFor({ engine: "anthropic-agent" }), null, "a bare string is not an engine");
  assert.equal(providersFor({ providers: {} }), null, "an object is not a list of rows");
  assert.equal(engineFor(null), null);
  assert.equal(providersFor(undefined), null);
});

// ── — THE WRITER IS CALLABLE, AND WHAT IT WRITES IS WHAT THE PORTAL READS ─────────────────────
//
// It used to exist only inside this module's own `isMain` block, so the one thing that could produce a
// snapshot was running the file directly. `bin/start.mjs` is the first-run entry that has the engine
// environment the portal lacks, and it could not call this at all.
test("#1720 writeFlagSnapshot writes a snapshot the reader can read, carrying the engine block", async (t) => {
  const { mkdtempSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const root = mkdtempSync(join(tmpdir(), "fs-writer-"));
  const saved = Object.fromEntries(["CLEAROTRON_REPORTS_DIR", "CLEAROTRON_QUEUE_DIR"].map((k) => [k, process.env[k]]));
  process.env.CLEAROTRON_REPORTS_DIR = root;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  const { path, snapshot } = await writeFlagSnapshot({ quiet: true });
  assert.equal(path, snapshotPath(root), "the snapshot went somewhere other than this pool's own path");
  assert.ok(existsSync(path), "writeFlagSnapshot answered a path it did not write");

  // THE FIELD THE PORTAL'S MODE IS DERIVED FROM. A snapshot without it sends the configuration page
  // back to "this cannot answer", which is the state is about.
  assert.equal(typeof snapshot.engine?.binaryPresent, "boolean",
    "the engine block carries no binaryPresent, so nothing downstream can tell demo from unproven");
  const readBack = readFlagSnapshot(root);
  assert.equal(typeof readBack?.engine?.binaryPresent, "boolean",
    "what was written does not survive the reader — the two halves disagree about the same file");
  assert.equal(readBack.engine.id, snapshot.engine.id);
});

// ── — A SUPERVISOR THAT KNOWS THE INSTALL MUST BE ABLE TO SAY SO ────────────
//
// The arm above sets `process.env` and lets the writer find it, which is how `clearotron start` works:
// it writes a `.env` and reads it back. The DEMO writes nothing anywhere — that is what makes "removing
// the demo is one directory" true — so its children were handed the install through `childEnv` while
// this writer, in the parent, read an environment nobody had set. `config.poolRoot` threw by name, no
// snapshot was written, and the visitor's first screen said the configuration could not be written and
// the portal's configuration page would not answer. These two seams are how the parent hands over what
// it already knows.
test("Refs tracker issue 2015 writeFlagSnapshot takes the pool and the env it is GIVEN, over the process's own", async (t) => {
  const { mkdtempSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const given = mkdtempSync(join(tmpdir(), "fs-given-"));
  const ambient = mkdtempSync(join(tmpdir(), "fs-ambient-"));
  const saved = process.env.CLEAROTRON_REPORTS_DIR;
  // THE AMBIENT POOL IS A DECOY AND IT IS SET TO A REAL DIRECTORY ON PURPOSE. If the writer ignored the
  // seam it would succeed against this one, so the arm would pass on a fix that does nothing — the
  // failure has to be "wrote to the wrong pool", not "threw because nothing was set".
  process.env.CLEAROTRON_REPORTS_DIR = ambient;
  t.after(() => { if (saved === undefined) delete process.env.CLEAROTRON_REPORTS_DIR; else process.env.CLEAROTRON_REPORTS_DIR = saved; });

  const { path } = await writeFlagSnapshot({ quiet: true, env: { ...process.env, CLEAROTRON_REPORTS_DIR: given }, poolRoot: given });
  assert.equal(path, snapshotPath(given),
    "the writer used the ambient pool instead of the one it was handed — a demo would write its snapshot into whatever the operator's shell happened to name");
  assert.ok(existsSync(path), "the writer answered a path it did not write");
  assert.ok(!existsSync(snapshotPath(ambient)),
    "the writer ALSO wrote into the ambient pool — a demo would leave a snapshot in somebody else's install");
  // AND THE DEFAULTS ARE UNCHANGED, which is the half that keeps every existing caller working.
  const fallback = await writeFlagSnapshot({ quiet: true });
  assert.equal(fallback.path, snapshotPath(ambient),
    "with no seam supplied the writer no longer reads the environment, so `clearotron start` stopped writing a snapshot");
});
