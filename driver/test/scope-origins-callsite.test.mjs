// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scope-origins-callsite.test.mjs —. The provenance sentence a client approves, through a REAL
// call site rather than a hand-built profile.
//
// `resolveEffectiveScope` decides whether to say "this project" or "the account's default classes" by
// reading `profile.origins`. `resolveEffectiveProfile` returned `origins` BESIDE the profile and no
// caller bridged the two — run-quote.mjs:59, resolve-request.mjs:44,47 and scope-rules.mjs:107 all pass
// the profile alone. Both `=== "project"` tests were therefore permanently false and the FROM.project
// branch was dead code.
//
// WHY IT PASSED ANYWAY, and why this file exists: every existing test in effective-scope.test.mjs builds
// its own profile object with `origins` written in by hand — `{ ...PROFILE, origins: { defaultJurisdictions:
// "project" } }`. That is a shape no caller produced. The resolver was correct about a profile nothing
// gave it, which is the issue's own diagnosis, so a test that never touches the producer cannot see it.
//
// Nothing here hand-writes `origins`. The profile comes out of the real resolver, from real files on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfiles, loadProjects, resolveEffectiveProfile } from "../profiles.mjs";
import { resolveEffectiveScope } from "../effective-scope.mjs";

const CUSTOMER = {
  name: "Aurora Interactive Corporation", matchDomains: ["aurora.example"], industry: "gaming",
  platforms: ["store.steampowered.com", "gog.com"],
  defaultClasses: [9, 28, 41, 42], defaultJurisdictions: ["DE", "FR"], selfExclusionOwners: [],
};
// The project REPLACES classes (replace semantics — its list is what actually runs) and says nothing
// about territories, so one field comes from the project and its sibling from the account. One run,
// both answers, which is the case a single-field fixture cannot express.
const PROJECT = { projectName: "Console ecosystem", defaultClasses: [14, 25] };

function world() {
  const dir = mkdtempSync(join(tmpdir(), "scope-origins-"));
  writeFileSync(join(dir, "aurora.json"), JSON.stringify(CUSTOMER));
  writeFileSync(join(dir, "generic.json"), JSON.stringify({
    name: "House default", matchDomains: [], industry: "gaming", platforms: ["store.steampowered.com"],
    defaultClasses: [], defaultJurisdictions: [], selfExclusionOwners: [],
  }));
  mkdirSync(join(dir, "projects", "aurora"), { recursive: true });
  writeFileSync(join(dir, "projects", "aurora", "console.json"), JSON.stringify(PROJECT));
  const profiles = loadProfiles({ dir, force: true });
  return { profiles, projects: loadProjects({ dir, profiles, force: true }) };
}

const JOB = { profileKey: "aurora", projectKey: "console" };
const POLICY = { pipeline: "prelim", components: {} };

test("#734 a project-supplied value says 'this project' when the profile comes from the real resolver", () => {
  const { profiles, projects } = world();
  const { profile } = resolveEffectiveProfile(JOB, { profiles, projects });

  // The producer attaches it. Asserted here because everything below rests on it, and because the
  // sibling-only return is precisely what rotted.
  assert.ok(profile.origins, "the resolved profile carries its own provenance map");
  assert.equal(profile.origins.defaultClasses, "project");

  const eff = resolveEffectiveScope(JOB, profile, POLICY);
  const classSentence = JSON.stringify(eff.classesFrom ?? eff.classes ?? eff);
  assert.match(classSentence, /project/i,
    `a project that REPLACES its customer's classes must not be presented as an account default — got ${classSentence}`);
  assert.doesNotMatch(classSentence, /account/i,
    "…and specifically not 'the account's default classes', which is where a reader would go to change it");
});

test("#734 the sibling field still says the ACCOUNT — the fix must not relabel everything 'this project'", () => {
  // The failure mode of an over-broad fix. This project sets no territories, so they are genuinely the
  // account's, and a blanket "came from the project" would be the same lie pointing the other way.
  const { profiles, projects } = world();
  const { profile } = resolveEffectiveProfile(JOB, { profiles, projects });
  assert.equal(profile.origins.defaultJurisdictions, "customer", "the project says nothing about territories");

  const eff = resolveEffectiveScope(JOB, profile, POLICY);
  const terr = JSON.stringify(eff.jurisdictionsFrom ?? eff.jurisdictions ?? eff);
  assert.doesNotMatch(terr, /this project/i,
    `territories came from the account and must say so — got ${terr}`);
});

test("#734 a run under NO project is unchanged — origins is null and every value is the account's", () => {
  const { profiles, projects } = world();
  const { profile, origins } = resolveEffectiveProfile({ profileKey: "aurora" }, { profiles, projects });
  assert.equal(origins, null, "no project, no overlay, no origin map");
  assert.equal(profile.origins, undefined, "and nothing invented onto the profile");
  const eff = resolveEffectiveScope({ profileKey: "aurora" }, profile, POLICY);
  assert.doesNotMatch(JSON.stringify(eff), /this project/i, "a plain customer run never claims a project");
});

test("#734 the whole point, stated as the defect: the account-default reading is now unreachable for a project field", () => {
  // Before the fix this is the assertion that failed, because `profile.origins` was undefined at every
  // real call site and the FROM.project branch could not be reached from one.
  const { profiles, projects } = world();
  const { profile, origins } = resolveEffectiveProfile(JOB, { profiles, projects });

  // The sibling and the attached copy must agree — two sources of the same fact is how they drift.
  assert.deepEqual(profile.origins, origins,
    "the profile's map and the returned sibling are the same map; a caller reading either gets the same answer");

  // And the classes that actually run are the project's, which is what makes the wrong label harmful
  // rather than cosmetic: the number is right and the reason given for it points somewhere else.
  assert.deepEqual(profile.defaultClasses, [14, 25], "replace semantics — the project's list is what runs");
});
