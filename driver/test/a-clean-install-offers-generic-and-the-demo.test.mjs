// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A FRESH INSTALL OFFERS AS A BRAND OWNER (tracker issue 335, tracker issue 342).
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
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadProfiles, loadProjects } from "../profiles.mjs";

const PROFILES = join(dirname(fileURLToPath(import.meta.url)), "..", "profiles");
const OFFERED = ["demo-brand-owner", "generic"];
const FIXTURES = ["aurora", "petcary", "zephyr"];

const onDisk = () => readdirSync(PROFILES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
const marked = (key) => JSON.parse(readFileSync(join(PROFILES, `${key}.json`), "utf8"))?.testFixture === true;

test("335 every bundled profile is either offered or marked as a fixture — no third state", () => {
  // The set-level half. A new profile added to this directory is one or the other, and saying which is
  // the deliberate act; a file that is neither would ship to a customer unnoticed, which is the defect.
  assert.deepEqual(onDisk(), [...OFFERED, ...FIXTURES].sort(),
    "the bundled directory changed — every file in it must be named here as offered or as a fixture");
  for (const k of FIXTURES) assert.equal(marked(k), true, `${k}.json is a test fixture and is not marked`);
  for (const k of OFFERED) assert.notEqual(marked(k), true, `${k}.json is offered to users and must not be marked`);
});

test("335 a resolved roster offers Generic and the demo, and no test account", () => {
  // The behavioural half, and the acceptance as the user met it: what the picker would list.
  const keys = [...loadProfiles({ force: true, includeTestFixtures: false }).keys()].sort();
  assert.deepEqual(keys, OFFERED,
    "a clean install's brand-owner list must be exactly Generic and the demo account");
});

test("335 the suite reaches every fixture under the key its baselines use", () => {
  // Acceptance 3. Asked for by name, so the ask is visible at the call site rather than ambient.
  const keys = [...loadProfiles({ force: true, includeTestFixtures: true }).keys()].sort();
  assert.deepEqual(keys, [...OFFERED, ...FIXTURES].sort());
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

test("335 the fixtures' own projects ARE reachable when the fixtures are", () => {
  const roster = loadProfiles({ force: true, includeTestFixtures: true });
  const keys = [...loadProjects({ force: true, profiles: roster }).keys()];
  assert.ok(keys.some((k) => k.startsWith("aurora/")),
    "skipping a fixture's projects must be conditional on the fixture being absent, not unconditional");
});
