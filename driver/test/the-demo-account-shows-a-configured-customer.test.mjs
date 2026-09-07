// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DEMO ACCOUNT, PROJECT AND TENANT —.
//
// The demo showed one report, of one product, belonging to NOBODY: a single frozen clearance filed under
// `generic`, which runner.mjs says in as many words "is not a brand owner". So the first screen anyone
// outside the company sees argued that the product produces a report, rather than what the product is.
//
// All three layers a demo needs already existed as real concepts with real files — tenant, account,
// project overlay — and none had a demo instance. This adds one of each.
//
// ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────────────────────
//
// THE FOUR FROZEN RUNS. They execute against the FINAL build in the authorised post-deploy window, not
// from a dev branch — the engine changes within hours of this landing, and four reports frozen against a
// build about to be replaced would be worth less than no reports. That is sequencing, not omission: the
// tracker carries them, and this commit is their trigger condition.
//
// So these arms cover the CONFIGURATION, which is everything that can be true before a run exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfiles, resolveEffectiveProfile } from "../profiles.mjs";
import { loadFrameworkManifest } from "../framework.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY = "demo-brand-owner";

test("2014 the demo account is a CONFIGURED customer, and it is marked as demo data", () => {
  const p = loadProfiles({ force: true }).get(KEY);
  assert.ok(p, "the demo account is on the roster");

  // THE MARKER IS THE POINT OF THE TWO ISSUES BEFORE THIS ONE. Without it the wall would let a real
  // clearance run on fiction, and the report banner would not appear — the demo would be exactly the
  // hazard the thread was opened to remove. The design comment for this issue predates that marker and
  // lists sixteen fields; this is the seventeenth, and it is not optional here of all places.
  assert.equal(p.demoData, true, "the demo account must declare itself demo data");

  // It shows what a configured customer looks like BESIDE house defaults — that is its whole job on the
  // first screen. Asserted as "differs from generic", not as literals, so the arm does not become a
  // second copy of the profile.
  const g = loadProfiles({ force: true }).get("generic");
  assert.notDeepEqual(p.platforms, g.platforms, "its marketplaces are its own, not the house list");
  assert.ok(p.platforms.length > 6, "a real configured customer has a real marketplace list");
  assert.ok(p.frameworkPath && p.frameworkPath !== g.frameworkPath,
    "it rates under its OWN framework — rating under the house default would print 'Generic default' on "
    + "the demo's own face, which is the overlap with `generic` this thread exists to remove");
  assert.ok(p.riskAppetite?.trim(), "and carries a risk posture, because a blank one shows nothing");
});

test("2014 the project overlay LAYERS — a visitor sees it do something", () => {
  // A project that repeated the account's configuration would prove nothing. Each assertion below is a
  // field where account and project genuinely disagree, which is what makes the two screens worth
  // clicking between.
  const { profile: acct } = resolveEffectiveProfile({ profileKey: KEY });
  const { profile: proj, projectName } = resolveEffectiveProfile({ profileKey: KEY, projectKey: "japan-and-korea-app-launch" });
  assert.equal(projectName, "Japan and Korea app launch");

  assert.notDeepEqual(proj.defaultJurisdictions, acct.defaultJurisdictions, "the project moves the territory");
  assert.ok(proj.defaultClasses.includes(42) && !acct.defaultClasses.includes(42), "and adds a class");
  assert.equal(proj.delivery.privileged, true, "and raises privilege");
  assert.equal(acct.delivery.privileged, false, "which the account does not have");

  // PLATFORMS UNION UPWARD — the client floor is never subtractable. The project adds its own
  // marketplaces without dropping the account's, which is the merge law this overlay exists inside.
  for (const site of acct.platforms) assert.ok(proj.platforms.includes(site), `${site} survives the overlay`);
  assert.ok(proj.platforms.some((s) => !acct.platforms.includes(s)), "and the project adds its own");
});

test("2014 the framework is its own, and its provenance note is clean", () => {
  // ROOT-relative, not the bare string "driver": the suite wrapper runs with the CWD set to driver/,
  // where a relative root resolves to driver/driver and the manifest "goes missing". Passed alone it
  // works, which is exactly how that assumption survives to CI.
  const m = loadFrameworkManifest(join(ROOT, "driver"), "skills/prelim-search/risk-framework-demo.md");
  assert.ok(m, "the manifest resolves from the account's frameworkPath");
  assert.equal(m.framework_key, "demo");
  assert.equal(m.entity_label, "Demo Brand Owner");
  assert.equal(m.structure.kind, "matrix", "matrix-shaped, so it exercises the two-input path");
  assert.equal(m.bands.length, 5, "five bands, matching the one band vocabulary the report chrome states");

  // OWNER RULING: the provenance note must not describe this framework as copied, transposed, invented
  // or synthetic. `frameworkView()` strips source_deck for non-staff readers, but STAFF surfaces are the
  // ones that get screenshotted in a demo — which is the whole reason the wording matters here.
  assert.doesNotMatch(m.source_deck, /synthetic|transpos|invented|copied|fictitious/i,
    `source_deck describes the framework as derived: ${JSON.stringify(m.source_deck)}`);
  const md = readFileSync(join(ROOT, "driver", "skills", "prelim-search", "risk-framework-demo.md"), "utf8");
  assert.doesNotMatch(md.split("\n")[0], /synthetic|demo customer/i, "and neither does its title line");
});

test("2014 the tenant grants exactly the demo account, and nothing else", () => {
  const g = JSON.parse(readFileSync(join(ROOT, "examples", "grants.example.json"), "utf8"));
  const t = g.tenants["demo-org"];
  assert.ok(t, "Demo Org exists as a tenant");
  assert.deepEqual(t.accounts, [KEY], "it reaches the demo account and no other");
  assert.deepEqual(Object.keys(t.users), ["*@demo-org.example"], "one domain wildcard, as the shape allows");

  // The existing fixtures are untouched: adding a tenant must not re-scope anybody else's access, and
  // several portal arms assert those exact account lists.
  assert.deepEqual(g.tenants["aurora-direct"].accounts, ["aurora"]);
  assert.deepEqual(g.tenants["evaluation"].accounts, ["zephyr", "petcary"]);
});
