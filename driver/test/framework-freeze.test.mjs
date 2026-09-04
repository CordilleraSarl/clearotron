// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Regression (2026-06-19): the per-customer reasoning framework must survive the run-sidecar freeze
// (freezeProfile). The stages call frameworkFor()/workedExamplesFor() on the FROZEN ctx.profile, NOT the raw
// resolved profile — so a frameworkPath dropped by the freeze means aurora.json/zephyr.json's configured
// frameworks are silently never applied (every run falls back to the firm-neutral default). This test feeds
// the REAL frozen shape into the synthesis stage exactly as production does.
import { test } from "node:test";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import assert from "node:assert/strict";
import { freezeProfile } from "../pipeline.mjs";
import { loadProfiles, resolveProfile, resolveEffectiveProfile, loadProjects } from "../profiles.mjs";
import { STAGES } from "../stages.mjs";

const P = { narrative: "/n", registerFindings: "/rf", commonLaw: "/cl", placement: "/p", seniorEyeReview: "/le", matterContext: "/mc", report: "/r", reportOverview: "/ro", findings: "/f.json", variantManifest: "/vm" };
const frozenSyn = (profiles, key) =>
  STAGES.synthesis.message({ paths: P, job: {}, profile: freezeProfile(resolveProfile(key ? { profileKey: key } : {}, { profiles })) });

test("freezeProfile carries the per-customer framework, so it is ACTUALLY applied (not silently defaulted)", () => {
  const profiles = loadProfiles({ force: true });
  const fz = freezeProfile(resolveProfile({ profileKey: "aurora" }, { profiles }));
  assert.equal(fz.frameworkPath, "skills/prelim-search/risk-framework-aurora.md", "the frozen sidecar MUST carry frameworkPath (dropping it is the bug)");
  assert.equal(fz.workedExamplesPath, "skills/prelim-search/worked-examples-aurora.md");
  // and the synthesis stage, fed the FROZEN profile (as production does), reads the customer's framework
  assert.match(frozenSyn(profiles, "aurora"), /risk-framework-aurora\.md/);
  assert.match(frozenSyn(profiles, "aurora"), /worked-examples-aurora\.md/);
  assert.match(frozenSyn(profiles, "zephyr"), /risk-framework-zephyr\.md/);
});

test("a profile with no per-customer framework still defaults to the firm-neutral one (frozen path)", () => {
  const profiles = loadProfiles({ force: true });
  for (const key of [null, "petcary"]) {     // generic + petcary ship no framework
    const syn = frozenSyn(profiles, key);
    assert.match(syn, /skills\/prelim-search\/risk-framework\.md/, `${key ?? "generic"} ⇒ firm-neutral default`);
    assert.doesNotMatch(syn, /risk-framework-(aurora|zephyr)\.md/, `${key ?? "generic"} must NOT read a per-customer framework`);
  }
});

// ── T9 (K3): the frozen profile carries a verifiable sha ────────────────────────────────────────
import { profileShaOf } from "../pipeline.mjs";

test("profileShaOf: canonical (key-order-independent), self-excluding, recomputable — K1 becomes verifiable", () => {
  const a = { profileKey: "zephyr", name: "Zephyr Beverages", platforms: ["amazon.com", "walmart.com"], batchSize: 14 };
  const b = { batchSize: 14, platforms: ["amazon.com", "walmart.com"], name: "Zephyr Beverages", profileKey: "zephyr" };
  assert.equal(profileShaOf(a), profileShaOf(b), "key order never changes the sha");
  assert.match(profileShaOf(a), /^[0-9a-f]{64}$/);
  // the stamped sha excludes itself — recompute-and-compare works on a stamped sidecar
  const stamped = { ...a, profileSha: profileShaOf(a) };
  assert.equal(profileShaOf(stamped), profileShaOf(a), "self-excluding");
  const c = { ...a, platforms: ["amazon.com"] };
  assert.notEqual(profileShaOf(c), profileShaOf(a), "a changed frozen value changes the sha");
});

// ── spec 62: the project overlay survives (or is absent from) the freeze ────────────────────────────────
test("spec 62: a NO-PROJECT freeze is byte-identical to the pre-62 one-arg freeze (regression anchor + existing shas preserved)", () => {
  const profiles = loadProfiles({ force: true });
  for (const key of ["aurora", "zephyr", "petcary", null]) {
    const job = key ? { profileKey: key } : {};
    const legacy = freezeProfile(resolveProfile(job, { profiles }));                 // the pre-62 one-arg call
    const eff = resolveEffectiveProfile(job, { profiles });                          // no projectKey ⇒ no project
    const now = freezeProfile(eff.profile, eff.projectKey ? { projectKey: eff.projectKey, projectName: eff.projectName, origins: eff.origins } : null);
    assert.deepEqual(now, legacy, `${key ?? "generic"}: no-project freeze is unchanged`);
    assert.ok(!("projectKey" in now) && !("origins" in now), "a no-project freeze carries no project fields");
    assert.equal(profileShaOf(now), profileShaOf(legacy), `${key ?? "generic"}: profileSha unchanged`);
  }
});

test("spec 62: a project-bearing freeze carries projectKey/projectName/origins; sha differs from the customer-only freeze; the project floor is applied", () => {
  const profiles = loadProfiles({ force: true });
  const projects = loadProjects({ profiles, force: true });
  const eff = resolveEffectiveProfile({ profileKey: "aurora", projectKey: "console-ecosystem" }, { profiles, projects });
  const fzProj = freezeProfile(eff.profile, { projectKey: eff.projectKey, projectName: eff.projectName, origins: eff.origins });
  assert.equal(fzProj.profileKey, "aurora", "profileKey stays the CUSTOMER");
  assert.equal(fzProj.projectKey, "console-ecosystem");
  assert.equal(fzProj.projectName, "Console ecosystem");
  assert.equal(fzProj.origins.platforms, "customer+project");
  assert.equal(fzProj.frameworkPath, "skills/prelim-search/risk-framework-aurora.md", "the customer's framework still rates the matter");
  // the frozen floor is DERIVED from the resolved (project) platforms — a field dropped from freezeProfile would
  // be the exact silent-fallback bug that bit frameworkPath in June.
  assert.equal(fzProj.minCellsPerVariant, eff.profile.platforms.length + 1, "the project's marketplace floor is frozen");
  const fzCust = freezeProfile(resolveProfile({ profileKey: "aurora" }, { profiles }));
  assert.notEqual(profileShaOf(fzProj), profileShaOf(fzCust), "which project rated this run is sha-verifiable, not merely asserted");
});

// ── The framework must load from the DEPLOYMENT's skills store, not the driver's bundle ──────────────
// 2026-07-19: `loadFrameworkManifest(DRIVER_DIR, ...)` read manifests out of the driver's BUNDLED
// skills/ while CLEAROTRON_INSTRUCTIONS_DIR pointed the AGENT at the deployment's config store. A customer whose
// framework ships only in that store hard-failed at attachFramework with `framework_manifest_missing` —
// the first Aurora Interactive run died there before a single stage ran. The pre-flight "does the file exist?"
// check passed, because it did exist; just not where the driver looked. Assert the ROOT, not the file.
import { mkdtempSync, mkdirSync as mkdirp, writeFileSync as writeF } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { loadFrameworkManifest } from "../framework.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath as toURLPath } from "node:url";
import { dirname as dirOf } from "node:path";
const HERE_DRIVER = joinPath(dirOf(toURLPath(import.meta.url)), "..");

test("config.skillsRoot follows CLEAROTRON_INSTRUCTIONS_DIR — the driver reads frameworks where the AGENT reads them", async () => {
  const store = mkdtempSync(joinPath(tmpdir(), "skills-store-"));
  mkdirp(joinPath(store, "skills", "prelim-search"), { recursive: true });
  const fwPath = "skills/prelim-search/risk-framework-tenant.md";
  writeF(joinPath(store, fwPath), "# Tenant framework\n");
  // shape mirrors the shipped risk-framework.manifest.json (parseFrameworkManifest is strict)
  const houseManifest = JSON.parse(readFileSync(joinPath(HERE_DRIVER, "skills/prelim-search/risk-framework.manifest.json"), "utf8"));
  writeF(joinPath(store, fwPath.replace(/\.md$/, ".manifest.json")),
    JSON.stringify({ ...houseManifest, framework_key: "tenant-only", title: "Tenant framework" }));

  const prev = process.env.CLEAROTRON_INSTRUCTIONS_DIR;
  pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", joinPath(store, "skills"));
  try {
    const { config } = await import(`../driver.config.mjs?skillsroot=${Math.random()}`);
    assert.equal(config.skillsRoot, store, "skillsRoot is the PARENT of skillsDir — the base a profile's relative path joins against");
    assert.equal(loadFrameworkManifest(config.skillsRoot, fwPath).framework_key, "tenant-only",
      "a framework present ONLY in the deployment store loads — the Aurora Interactive shape");
  } finally {
    pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", prev);
  }
});
