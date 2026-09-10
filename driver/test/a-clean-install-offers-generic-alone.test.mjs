// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A FRESH INSTALL OFFERS AS A BRAND OWNER.
//
// An outside user installed this product with no configuration of ours, and their brand-owner picker
// offered three of our test accounts beside their own choices. The picker was not wrong — it listed the
// roster, and on a `git clone` install the roster is this checkout.
//
// The packaging exclusion is real and it works: the published tarball carries two profiles. It protects
// ONE route of the three the install guide documents. A packaging rule cannot answer a question the
// loader is asked, so the loader answers it.
//
// ── WHY THIS FILE NAMES BOTH SIDES ─────────────────────────────────────────────────────────────────
//
// A packaging-only fix leaves the suite exercising five profiles and a customer receiving two — the
// disjoint-roster defect this module's own header narrates from 2026-07-19, where tests pass against a
// roster nobody is given. Marking the fixtures does not by itself fix that: the suite still runs with
// them switched on.
//
// What makes it ONE roster is this file. It names every profile in the directory and names exactly what
// a resolved roster returns, so the difference between the two is asserted rather than assumed. Add a
// fixture without marking it and the first check reds; mark a real account by mistake and the second
// does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadProfiles, loadProjects } from "../profiles.mjs";

const PROFILES = join(dirname(fileURLToPath(import.meta.url)), "..", "profiles");
const OFFERED = ["generic"];
const DEMO = ["demo-brand-owner"];
const FIXTURES = ["aurora", "petcary", "zephyr"];

const onDisk = () => readdirSync(PROFILES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const marked = (key) => JSON.parse(readFileSync(join(PROFILES, `${key}.json`), "utf8"))?.testFixture === true;
const demoMarked = (key) => JSON.parse(readFileSync(join(PROFILES, `${key}.json`), "utf8"))?.demoData === true;

test("335 every bundled profile is either offered or marked as a fixture — no third state", () => {
  // The set-level half. A new profile added to this directory is one or the other, and saying which is
  // the deliberate act; a file that is neither would ship to a customer unnoticed, which is the defect.
  assert.deepEqual(onDisk(), [...OFFERED, ...DEMO, ...FIXTURES].sort(),
    "the bundled directory changed — every file in it must be named here as offered, as the demo's, or as a fixture");
  for (const k of FIXTURES) assert.equal(marked(k), true, `${k}.json is a test fixture and is not marked`);
  for (const k of DEMO) assert.equal(demoMarked(k), true, `${k}.json is the demo's account and is not marked demoData`);
  for (const k of OFFERED) assert.notEqual(marked(k), true, `${k}.json is offered to users and must not be marked`);
});

test("342 a resolved roster offers Generic ALONE — not the demo, not a test account", () => {
  // The behavioural half, and the acceptance as the user met it: what the picker would list. Owner
  // ruling 2026-09-08 — nobody should have to clean demo material out of an install they just made.
  const keys = [...loadProfiles({ force: true, includeTestFixtures: false, includeDemo: false }).keys()].sort();
  assert.deepEqual(keys, OFFERED,
    "a clean install's brand-owner list must be exactly Generic");
});

test("342 the demo asks, and gets its own account — the gate is not a one-way door", () => {
  // Without this arm the one above is satisfied by a loader that returns Generic to everybody, which
  // would pass while making the demo unusable. A refusal proves nothing until the grant is shown too.
  const keys = [...loadProfiles({ force: true, includeTestFixtures: false, includeDemo: true }).keys()].sort();
  assert.deepEqual(keys, [...OFFERED, ...DEMO].sort(),
    "the demo must reach the account whose reports it exists to show");
});

test("342 asking for FIXTURES still yields fixtures, though they are demo data too", () => {
  // Every shipped profile but Generic carries `demoData`, so a demo gate applied to all of them would
  // silently swallow a roster somebody asked for by name. The more specific flag decides.
  const keys = [...loadProfiles({ force: true, includeTestFixtures: true, includeDemo: false }).keys()].sort();
  assert.deepEqual(keys, [...OFFERED, ...FIXTURES].sort(),
    "a caller that asked for the fixtures must receive them, not an empty-handed pass");
});

test("335 the suite reaches every fixture under the key its baselines use", () => {
  // Acceptance 3. Asked for by name, so the ask is visible at the call site rather than ambient.
  const keys = [...loadProfiles({ force: true, includeTestFixtures: true, includeDemo: true }).keys()].sort();
  assert.deepEqual(keys, [...OFFERED, ...DEMO, ...FIXTURES].sort());
});

test("335 a fixture's projects do not break the walk on an install that cannot see the fixture", () => {
  // The refusal this could have produced is a hard startup failure, not a wrong list: the projects walk
  // throws by name when a project directory has no customer, and a fixture's projects sit in the same
  // checkout as the fixture. On a clone install the roster no longer has the customer, so the product's
  // own files would have stopped the process at load.
  const roster = loadProfiles({ force: true, includeTestFixtures: false });
  const projects = loadProjects({ force: true, profiles: roster });
  for (const key of [...projects.keys()]) {
    assert.ok(!FIXTURES.some((f) => key.startsWith(`${f}/`)),
      `a resolved install must not carry ${key} — its customer is not offered`);
  }
});

test("342 the gate is on the BUNDLED layer — a store somebody curated keeps its own demo account", () => {
  // `demoData` means two things depending on where the file is. In the bundled directory it means "our
  // demo account". In a deployment's OWN store it means "this account is fiction, do not let it spend" —
  // which is what the admission wall reads it for, and that account is there because somebody put it
  // there. Gating on the flag alone reached into a configured store and deleted it; gating on the layer
  // does not. A configured store is read INSTEAD of the bundled directory, so the question is which
  // directory was read.
  const store = mkdtempSync(join(tmpdir(), "curated-store-"));
  copyFileSync(join(PROFILES, "generic.json"), join(store, "generic.json"));
  copyFileSync(join(PROFILES, "demo-brand-owner.json"), join(store, "housebrand.json"));

  const curated = [...loadProfiles({ dir: store, force: true, includeDemo: false, includeTestFixtures: false }).keys()].sort();
  assert.deepEqual(curated, ["generic", "housebrand"],
    "an account a deployment curated into its own store is that deployment's choice and stays offered");

  const bundled = [...loadProfiles({ dir: null, force: true, includeDemo: false, includeTestFixtures: false }).keys()].sort();
  assert.deepEqual(bundled, ["generic"],
    "…while the bundled demo account is still refused, which is the ruling this gate exists for");
});

test("342 the demo's own projects are skipped when hidden, and reachable when asked for", () => {
  // The skip must be CONDITIONAL. An unconditional one would pass the arm above while making the demo's
  // projects permanently invisible, including to the demo — a refusal and a grant are two measurements.
  const hidden = loadProjects({ force: true, profiles: loadProfiles({ force: true, includeDemo: false }) });
  assert.ok(![...hidden.keys()].some((k) => k.startsWith("demo-brand-owner/")),
    "a clean install must not carry the demo's projects — it cannot see their customer");

  const asked = loadProjects({ force: true, profiles: loadProfiles({ force: true, includeDemo: true }) });
  assert.ok([...asked.keys()].some((k) => k.startsWith("demo-brand-owner/")),
    "the demo must reach its own projects; skipping them unconditionally would hide them from it too");
});

test("335 the fixtures' own projects ARE reachable when the fixtures are", () => {
  const roster = loadProfiles({ force: true, includeTestFixtures: true });
  const keys = [...loadProjects({ force: true, profiles: roster }).keys()];
  assert.ok(keys.some((k) => k.startsWith("aurora/")),
    "skipping a fixture's projects must be conditional on the fixture being absent, not unconditional");
});
