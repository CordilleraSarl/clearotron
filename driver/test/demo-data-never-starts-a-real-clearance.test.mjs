// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// DEMO DATA NEVER STARTS A REAL CLEARANCE —.
//
// ── THE FAILURE THIS EXISTS FOR, FROM THIS REPOSITORY'S OWN RECORD ──────────────────────────────────
//
// `driver/profiles.mjs` documents it: a process held none of the store directories, every customer
// silently resolved to the bundled roster, and a DELIVERED RUN searched three house platforms instead
// of the client's — no self-exclusion seed, no customer framework, and nothing said so. The assert built
// to catch it passed, because it only checked the frozen framework was non-empty and a bundled demo
// framework is non-empty.
//
// That was a misconfiguration risk. With a deliberate demo account, project and four seeded reports, it
// becomes a standing one — so a profile can now say it is fiction, and the engine refuses to spend on it.
//
// ── WHY THE MARKER IS WHERE IT IS ───────────────────────────────────────────────────────────────────
//
// CUSTOMER-ONLY, not overlayable: a project marking a real customer's run as demo would refuse
// legitimate work, and a project un-marking a demo customer would let fiction through. Both directions
// are the argument, and the second is the dangerous one.
//
// `true` OR ABSENT, never `false`. One spelling means a grep for the marker is complete, and a reader
// never has to decide whether `false` means "unmarked" or "un-marked on purpose".
//
// A STATED LIMIT, so nobody reads it later as an oversight: `generic` is NOT marked, by ruling — it is
// the neutral no-customer profile and is already exempt from run caps as "not a brand owner", so
// marking it would refuse every legitimate no-customer run. The consequence is that the silent-fallback
// incident above is caught when the fallback lands on a marked record, and not when it lands on
// `generic`. That is the ruling's cost, accepted deliberately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_PROFILE_KEYS, PROJECT_KEYS, CUSTOMER_ONLY_KEYS, FIELD_CONSUMERS,
  loadProfiles, validateProfileEdit, profileStoreResolution } from "../profiles.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = { name: "Spine Co", platforms: ["example.com"] };

test("2012 a profile can declare itself demo data, and only in one spelling", () => {
  assert.ok(KNOWN_PROFILE_KEYS.includes("demoData"), "the closed key set admits the marker");
  assert.ok(FIELD_CONSUMERS.demoData, "and the manifest names who reads it");

  assert.equal(validateProfileEdit("spine", { ...BASE, demoData: true }).ok, true, "`true` is the marker");
  assert.equal(validateProfileEdit("spine", { ...BASE }).ok, true, "absent is a real account");
  for (const bad of [false, "true", 1, null]) {
    const v = validateProfileEdit("spine", { ...BASE, demoData: bad });
    assert.equal(v.ok, false, `demoData: ${JSON.stringify(bad)} must be refused, not tolerated`);
    assert.match(v.errors.join(" "), /demoData must be true when present/);
  }
});

test("2012 the marker is CUSTOMER-ONLY — a project can neither apply nor remove it", () => {
  // The dangerous direction is the second one: an overlay that un-marks a demo customer would put
  // fiction through the wall, and it would look like an ordinary project override doing it.
  assert.ok(CUSTOMER_ONLY_KEYS.includes("demoData"));
  assert.equal(PROJECT_KEYS.includes("demoData"), false);
  const v = validateProfileEdit("projects/aurora/p", { projectName: "P", demoData: true }, "", { sparse: true });
  assert.equal(v.ok, false, "an overlay carrying the marker is refused outright");
});

test("2012 the shipped invented companies say so, and `generic` does not", () => {
  const ps = loadProfiles({ force: true });
  for (const k of ["aurora", "petcary", "zephyr"]) {
    assert.ok(ps.has(k), `${k} is in the bundled roster`);
    assert.equal(ps.get(k).demoData, true, `${k} is an invented company and must say so`);
  }
  assert.equal(ps.get("generic").demoData, undefined,
    "generic is the neutral no-customer profile and is exempt from run caps as 'not a brand owner' — "
    + "marking it would refuse every legitimate no-customer run");
});

test("2012 the store receipt distinguishes a bundled fallback that is HOLDING demo data", () => {
  // Criterion 5. "The fallback is in force" and "the fallback is in force and it is fiction" are
  // different sentences, and only the second one explains a wrong deliverable.
  const r = profileStoreResolution({});
  assert.equal(typeof r.demoRecords, "number", "the receipt counts marked records");
  assert.ok(r.demoRecords >= 3, `expected the three bundled demo records, counted ${r.demoRecords}`);
  if (r.situation === "bundled-fallback") {
    assert.ok(r.findings.includes("bundled_fallback_holds_demo_records"));
    assert.match(r.detail, /marked demo data/);
  }
});

test("2012 the WALL refuses, and it refuses as a REJECT rather than a clarify", () => {
  // The refusal lives at the runner's admission chokepoint, not at a door: the doors are fail-open by
  // their own doctrine, so a check placed only there reports a pass on exactly the resolution failure
  // it exists to catch. Asserted on the source because standing up a queue and a claim here would test
  // the harness rather than the rule.
  const src = readFileSync(join(ROOT, "driver", "runner.mjs"), "utf8");
  assert.match(src, /effProfile\?\.demoData === true/, "the wall reads the resolved effective profile");
  assert.match(src, /classify: rejectMsg \? "reject" : "clarify"/,
    "a demo account is not re-sendable, so it must not be notified as a clarification");

  // — THE SENTENCE MOVED, AND THE RULE DID NOT. The wall now asks
  // `demoRunAgreement`, because the decision gained a second direction (a REAL account with a demoRun
  // job is refused too). The refusal text is unchanged and lives with the decision that composes it, so
  // this reads it there — and still asserts the wall DELEGATES, which is what keeps the two together.
  assert.match(src, /demoRunAgreement\(/, "the wall no longer asks the agreement — the refusal may have drifted");
  const agreement = readFileSync(join(ROOT, "driver", "demo-run-agreement.mjs"), "utf8");
  assert.match(agreement, /is DEMO DATA \(demoData: true in its profile\)/, "the refusal names the reason");
  assert.match(agreement, /Nothing has been searched, and nothing has been spent/, "and says nothing was spent");
});

test("2012 resolving a profile is NOT starting a clearance — the demo path keeps working", () => {
  // Criterion 4, and the line that would have broken it: putting the refusal in resolveEffectiveProfile
  // is one line and catches every door — including seeding, replay and republishing, none of which
  // start a run. Publishing a frozen report under a demo account must stay ordinary.
  const src = readFileSync(join(ROOT, "driver", "profiles.mjs"), "utf8");
  const resolver = src.slice(src.indexOf("export function resolveEffectiveProfile"));
  assert.equal(/demoData/.test(resolver.slice(0, 4000)), false,
    "resolveEffectiveProfile must not refuse on the marker — seeding and replay resolve profiles too, "
    + "and a throw here would refuse the demo the marker exists to make safe");

  const ps = loadProfiles({ force: true });
  assert.equal(ps.get("aurora").demoData, true, "a marked account still loads");
  assert.ok(ps.get("aurora").platforms?.length, "and is still readable, listable and reportable — the "
    + "marker is provenance, never visibility");
});
