// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// effective-scope — WHERE a search points, resolved once for every door.
//
// These tests exist because the ladder is the kind of logic that rots silently: every layer produces a
// plausible-looking answer, so a precedence bug does not throw, it just runs a narrower or wider search
// than the person approving it believed they were approving. The failure is invisible in the output and
// only shows up in the bill, or in a missed conflict.
//
// SAFETY GUARD: env pinned before dynamic driver imports.
import { mkdtempSync as __mkdtemp } from "node:fs";
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __mkdtemp(__join(__tmpdir(), "escope-ws-")));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __join(process.env.CLEAROTRON_WORK_DIR, "pool"));
import { test } from "node:test";
import assert from "node:assert/strict";

const { resolveEffectiveScope } = await import("../effective-scope.mjs");

const PROFILE = {
  key: "zephyr",
  platforms: ["amazon.com", "gnc.com"],
  defaultJurisdictions: ["US", "EU"],
  defaultClasses: [5, 32],
  origins: {},
};
const savedSearch = (scope) => ({ recipeScope: scope });

// ── territories: first hit wins ─────────────────────────────────────────────────────────────────────

test("territories: the request beats the saved search beats the account", () => {
  const saved = savedSearch({ jurisdictions: ["GB"] });

  const fromRequest = resolveEffectiveScope({ jurisdictions: ["JP"] }, PROFILE, saved);
  assert.deepEqual(fromRequest.jurisdictions, ["JP"]);
  assert.equal(fromRequest.jurisdictionsFrom, "this request");

  const fromSaved = resolveEffectiveScope({}, PROFILE, saved);
  assert.deepEqual(fromSaved.jurisdictions, ["GB"], "the saved search supplies what the request omitted");
  assert.equal(fromSaved.jurisdictionsFrom, "the saved search");

  const fromAccount = resolveEffectiveScope({}, PROFILE, null);
  assert.deepEqual(fromAccount.jurisdictions, ["US", "EU"]);
  assert.equal(fromAccount.jurisdictionsFrom, "the account's default territories");
});

test("territories: an empty array is not a request for scope — it falls through, never blanks the search", () => {
  // The dangerous shape: a composer sending `jurisdictions: []` because a picker was cleared must not
  // resolve to "search nowhere", nor silently override the account's own territories with nothing.
  const r = resolveEffectiveScope({ jurisdictions: [] }, PROFILE, savedSearch({ jurisdictions: ["GB"] }));
  assert.deepEqual(r.jurisdictions, ["GB"]);
});

test("territories: nothing set anywhere is stated as such, not disguised as a choice", () => {
  const bare = { key: "x", platforms: [], origins: {} };
  const r = resolveEffectiveScope({}, bare, null);
  assert.deepEqual(r.jurisdictions, []);
  assert.equal(r.jurisdictionsFrom, "not set anywhere");
});

test("territories: a value that arrived via a project overlay says so, rather than claiming to be an account default", () => {
  // The distinction matters to whoever approves the run: "this project searches CN" is a different
  // statement from "your account always searches CN", and only one of them is worth querying.
  const viaProject = { ...PROFILE, defaultJurisdictions: ["CN"], origins: { defaultJurisdictions: "project" } };
  const r = resolveEffectiveScope({}, viaProject, null);
  assert.deepEqual(r.jurisdictions, ["CN"]);
  assert.equal(r.jurisdictionsFrom, "this project");
});

// ── the geography stamp: worldwide, silence, and a job that predates the field ──────────────────────

test("territories: WORLDWIDE WINS — it short-circuits above the ladder, and defaults cannot narrow it", () => {
  // The incident shape: an account with default territories, and a requester who asked for everywhere.
  // Before the stamp those two facts could not both be on the wire, so the defaults won and a worldwide
  // search ran as a two-country one. Worldwide is not a gap for a lower rung to fill.
  const r = resolveEffectiveScope({ geography: { mode: "worldwide", origin: "request" } }, PROFILE, null);
  assert.deepEqual(r.jurisdictions, [], "no territorial restriction — the account's US/EU do not apply");
  assert.equal(r.geographyMode, "worldwide");
  assert.equal(r.jurisdictionsFrom, "this request", "the requester asked for this; it is not an absence");
  // it beats a saved search's scope too — the same rung it beats for the account
  const overSaved = resolveEffectiveScope({ geography: { mode: "worldwide", origin: "request" } }, PROFILE, savedSearch({ jurisdictions: ["GB"] }));
  assert.deepEqual(overSaved.jurisdictions, []);
});

test("territories: silence and worldwide resolve DIFFERENTLY against the same account", () => {
  // The whole point of the field, stated as the two answers it separates.
  const everywhere = resolveEffectiveScope({ geography: { mode: "worldwide", origin: "request" } }, PROFILE, null);
  const silent = resolveEffectiveScope({ geography: { mode: "account-default", origin: "account-default" } }, PROFILE, null);
  assert.deepEqual(everywhere.jurisdictions, []);
  assert.deepEqual(silent.jurisdictions, ["US", "EU"], "silence is what the account's defaults are FOR");
  assert.equal(silent.geographyMode, "account-default");
  assert.equal(silent.jurisdictionsFrom, "the account's default territories");
});

test("territories: an UNRECORDED job is its own state — it resolves as it always did, and says so", () => {
  // A job queued or archived before the stamp existed carries none of it. Its geographic intent was
  // never captured and cannot be recovered, so the resolver must not pick one: it reports "unrecorded"
  // and walks the ladder exactly as before. Reading absent as "worldwide" would silently widen every
  // archived run; reading it as "account-default" would claim a choice nobody made.
  const legacy = resolveEffectiveScope({}, PROFILE, null);
  assert.equal(legacy.geographyMode, "unrecorded");
  assert.deepEqual(legacy.jurisdictions, ["US", "EU"], "the account's defaults, exactly as before the field existed");
  assert.equal(legacy.jurisdictionsFrom, "the account's default territories", "the client-facing sentence is unchanged");
  // …and an unstamped job that names its own territories still reports them as the request's
  const legacyNamed = resolveEffectiveScope({ jurisdictions: ["JP"] }, PROFILE, null);
  assert.equal(legacyNamed.geographyMode, "unrecorded");
  assert.equal(legacyNamed.jurisdictionsFrom, "this request", "presence is all the evidence an old job has");
});

test("provenance survives the job being written to AFTER the door — the stamp answers, not the presence", () => {
  // job.jurisdictions is not frozen at the door: foldRecipeScope (pipeline.mjs) copies a saved search's
  // territories into it on every pass, after validateJob has run. Under a stamp that says the requester
  // named none, calling that list "this request" attributes a choice to someone who never made it.
  const job = { geography: { mode: "account-default", origin: "account-default" } };
  job.jurisdictions = ["CN"];                    // written downstream, exactly as the fold does it
  const r = resolveEffectiveScope(job, PROFILE, savedSearch({ jurisdictions: ["CN"] }));
  assert.deepEqual(r.jurisdictions, ["CN"], "the territories the run will actually use");
  assert.notEqual(r.jurisdictionsFrom, "this request", "the requester named nothing — the stamp says so");
  assert.equal(r.jurisdictionsFrom, "the saved search");
  // and the account profile changing later cannot rewrite what the stored request asked for
  const edited = { ...PROFILE, defaultJurisdictions: ["BR", "AR", "MX"], origins: { defaultJurisdictions: "project" } };
  assert.equal(resolveEffectiveScope(job, edited, savedSearch({ jurisdictions: ["CN"] })).jurisdictionsFrom, "the saved search");
});

// ── classes ─────────────────────────────────────────────────────────────────────────────────────────

test("classes follow the same ladder and name their own field in the provenance", () => {
  assert.equal(resolveEffectiveScope({ classes: [9] }, PROFILE, null).classesFrom, "this request");
  assert.deepEqual(resolveEffectiveScope({}, PROFILE, savedSearch({ classes: [25] })).classes, [25]);
  assert.equal(resolveEffectiveScope({}, PROFILE, null).classesFrom, "the account's default classes");
});

// ── platforms: the exception that unions ────────────────────────────────────────────────────────────

test("platforms UNION across every layer — no layer can revoke an account's marketplace", () => {
  // A client's marketplace list is a mandate. A project overlay that silently dropped four storefronts
  // is a real defect in this codebase's history, and this is the rule that prevents its return.
  const r = resolveEffectiveScope({ platforms: ["iherb.com"] }, PROFILE, savedSearch({ platforms: ["walmart.com"] }));
  for (const p of ["amazon.com", "gnc.com", "walmart.com", "iherb.com"]) {
    assert.ok(r.platforms.includes(p), `${p} must survive the union`);
  }
});

test("platforms: what THIS request added is reported apart from what the account already mandated", () => {
  // The composer needs the split: account marketplaces render fixed, because a deselect there is a
  // no-op the union undoes, and a removable-looking chip would lie about what gets swept.
  const r = resolveEffectiveScope({ platforms: ["iherb.com"] }, PROFILE, null);
  assert.deepEqual(r.platformsAdded, ["iherb.com"]);
  assert.equal(r.platformsFrom, "this request");
  assert.ok(!r.platformsAdded.includes("amazon.com"), "an account marketplace was never 'added' by the request");
});

test("platforms: re-naming a marketplace the account already has adds nothing and claims nothing", () => {
  const r = resolveEffectiveScope({ platforms: ["amazon.com"] }, PROFILE, null);
  assert.deepEqual(r.platformsAdded, []);
  assert.equal(r.platformsFrom, "the account's default marketplaces");
  assert.equal(r.platforms.filter((p) => p === "amazon.com").length, 1, "no duplicate — duplicates inflate the grid floor");
});

test("platforms: a saved search's stores are attributed to it, not to the request", () => {
  const r = resolveEffectiveScope({}, PROFILE, savedSearch({ platforms: ["walmart.com"] }));
  assert.deepEqual(r.platformsAdded, [], "the request added nothing");
  assert.deepEqual(r.platformsFromSavedSearch, ["walmart.com"]);
  assert.equal(r.platformsFrom, "the saved search");
});

// ── the number nobody can infer ─────────────────────────────────────────────────────────────────────

test("gridCellsPerVariant grows with the platform list, so widening the sweep is visible before it is bought", () => {
  const plain = resolveEffectiveScope({}, PROFILE, null);
  const wider = resolveEffectiveScope({ platforms: ["iherb.com"] }, PROFILE, null);
  assert.equal(wider.gridCellsPerVariant, plain.gridCellsPerVariant + 1);
});

test("no profile ⇒ no invented grid size", () => {
  const r = resolveEffectiveScope({ jurisdictions: ["US"] }, null, null);
  assert.equal(r.gridCellsPerVariant, null);
  assert.deepEqual(r.jurisdictions, ["US"], "an instructed territory still resolves without a profile");
});
