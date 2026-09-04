// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — TWO DEFECTS, ONE AREA, AND THE FIRST ARM IS THE ONE THAT MATTERS.
//
// 1. Customer profiles were WHOLE-STORE REPLACEMENT: `CLEAROTRON_CUSTOMERS_DIR` or the bundled directory,
//    never both. So pointing at your own folder deleted `generic.json` from view — the universal
//    fallback profiles.mjs then refuses BY NAME. "Bring your own customers" meant "and copy the house
//    default across first, or the engine stops": a required step nothing announced.
//
//    THE FALLBACK IS `generic` ALONE. Falling the whole bundled directory through would put our demo
//    customers into a deployment's roster, which two shipped guards forbid — pool-admin-reassign
//    ("REFUSES rather than validating against the demo roster") and mcp-server's roster boot check,
//    which counts the configured roster exactly. generic is not a demo customer; it is the fallback
//    every unprofiled job resolves to, and the only file whose absence made an empty store a refusal.
//
// 2. `bin/onboard.mjs` never asked where configuration lives, so the default was the checkout.
//
// THE LOAD-BEARING ARM IS "an empty store is a working install". It fails on the parent commit with
// `profiles/generic.json is REQUIRED` and passes here. Everything else in this file would pass against
// a helper that was never wired to anything — that arm is the one that can only pass if the resolution
// itself changed. Verified red before it was written.
//
// What must NOT change, and is asserted here because the issue says so in as many words: a NAMED
// customer that is missing everywhere still REFUSES rather than degrading to generic (silently
// dropping a client's platforms, self-exclusion seed and risk framework is a wrong deliverable, not a
// degraded one — 2026-07-18), and a configured-but-unreadable store THROWS rather than falling back,
// because existsSync cannot tell "missing" from "cannot read".

import test from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUNDLED = join(ROOT, "driver", "profiles");

/** Load profiles in a CHILD process with a given CLEAROTRON_CUSTOMERS_DIR. A child, not an import: the store
 *  is read into a module-level const at load time, so a second import in this process would return the
 *  first resolution and the arm would assert against a cache rather than against the code. */
function loadWith(dir) {
  const src = 'import("../../driver/profiles.mjs").then(m=>{'
    + 'const p=m.loadProfiles({force:true});'
    + 'console.log(JSON.stringify({keys:[...p.keys()].sort(),roots:m.profilesReadRoots.length,store:m.profilesStoreDir}));'
    + '}).catch(e=>{console.log(JSON.stringify({error:e.message}));});';
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: join(ROOT, "driver", "test"),
    // pinEnv, not a bare key: CLEAROTRON_CUSTOMERS_DIR answers to more than one spelling through the
    // alias table, and setting only this one lets whatever the operator's shell holds under the other
    // spelling win instead.
    env: (() => { const e = { ...process.env }; if (dir !== null) pinEnv(e, "CLEAROTRON_CUSTOMERS_DIR", dir); return e; })(),
    encoding: "utf8",
  });
  const line = `${r.stdout ?? ""}`.trim().split("\n").filter(Boolean).pop() ?? "";
  try { return JSON.parse(line); } catch { return { error: `unparseable: ${line} ${r.stderr ?? ""}` }; }
}

test("#1723 an EMPTY configuration store is a working install, not a refusal", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-empty-"));
  try {
    const got = loadWith(dir);
    assert.equal(got.error, undefined, `an empty store must load: ${got.error}`);
    assert.deepEqual(got.keys, ["generic"],
      "generic — AND ONLY generic — falls through from the bundled set. This is the arm that fails on the parent commit, "
      + "and the `only` half is what two shipped guards require: pool-admin-reassign asserts an unset store REFUSES "
      + "rather than validating against the demo roster, and mcp-server's boot check counts the configured roster "
      + "exactly. A deployment's roster is its own customers plus the universal fallback, never our fixtures.");
    assert.equal(got.roots, 2, "overlay and base are both read roots");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1723 the overlay wins PER KEY, and bundled CUSTOMERS never join a configured roster", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-overlay-"));
  try {
    const bundled = JSON.parse(readFileSync(join(BUNDLED, "aurora.json"), "utf8"));
    bundled.matchDomains = ["overlaid-example.test"];
    writeFileSync(join(dir, "aurora.json"), JSON.stringify(bundled));
    const got = loadWith(dir);
    assert.equal(got.error, undefined, got.error);
    assert.ok(got.keys.includes("generic"), "the universal fallback is always reachable");
    assert.ok(got.keys.includes("aurora"), "the store's own file is there");
    assert.ok(!got.keys.includes("petcary"),
      "and a BUNDLED customer the deployment never configured must NOT appear in its roster — "
      + "otherwise a typo'd customer key gets checked against our demo fixtures");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1723 profilesStoreDir names the WRITABLE store, so the write boundary protects the right one", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-store-"));
  try {
    assert.equal(loadWith(dir).store, dir, "with an overlay configured, writes belong in the overlay");
    assert.equal(loadWith(null).store, BUNDLED, "with none, the bundled directory is the only store there is");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1723 a configured-but-UNREADABLE store throws rather than falling back", () => {
  const got = loadWith(join(tmpdir(), "cfg-definitely-absent-1723"));
  assert.match(got.error ?? "", /profiles_overlay_unreadable/,
    "existsSync cannot tell missing from unreadable, so a permissions fault must never resolve every customer to the demo roster");
});

test("#1723 a NAMED customer missing from BOTH layers still refuses — unchanged by the overlay", () => {
  const dir = mkdtempSync(join(tmpdir(), "cfg-named-"));
  try {
    const src = 'import("../../driver/profiles.mjs").then(m=>{'
      + 'try{m.resolveProfile({profileKey:"nosuchcustomer"},{profiles:m.loadProfiles({force:true})});console.log("NOTHROW");}'
      + 'catch(e){console.log(JSON.stringify({code:e.code}));}});';
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", src],
      { cwd: join(ROOT, "driver", "test"), env: pinEnvAll({ ...process.env }, { CLEAROTRON_CUSTOMERS_DIR: dir }), encoding: "utf8" });
    const out = `${r.stdout ?? ""}`.trim();
    assert.ok(!out.includes("NOTHROW"), "falling back to generic would silently strip the client's own framework");
    assert.match(out, /profile_key_unknown/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1723 the doctor NAMES where configuration resolves from, in all three states", () => {
  const doctor = (env) => {
    const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor"],
      { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  };

  // UNSET is a reported state, not silence: it means this install is running our demo roster, which is
  // fine to start with and bad to discover later from a clearance that used a framework nobody chose.
  const unset = doctor({ CLEAROTRON_CUSTOMERS_DIR: "", CLEAROTRON_CUSTOMERS_DIR: "" });
  assert.match(unset, /Configuration store/, "the doctor must have a section for this at all");
  // — "not set" is ADVICE: it tells the reader what to go and write, so it names the CURRENT
  // spelling. This arm pinned the retired one and so passed while the doctor sent a fresh installer to
  // set a variable the engine is moving away from. Both spellings are cleared above, or the compat
  // window makes "unset" untestable.
  assert.match(unset, new RegExp(`CLEAROTRON_CUSTOMERS_DIR is not set`));

  // INSIDE THE CHECKOUT is the defect this issue is named for, and must read as a problem.
  const inside = join(ROOT, "driver", "profiles");
  assert.match(doctor({ CLEAROTRON_CUSTOMERS_DIR: inside }), /INSIDE the checkout/,
    "a store inside the clone is the state whose cost only arrives at the next git pull");

  // OUTSIDE is the healthy state and must not be reported as a problem.
  const dir = mkdtempSync(join(tmpdir(), "cfg-doctor-"));
  try {
    const out = doctor({ CLEAROTRON_CUSTOMERS_DIR: dir });
    assert.ok(!new RegExp(`${dir}[^\\n]*INSIDE the checkout`).test(out),
      "a store outside the checkout must not be flagged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1723 setup REFUSES a configuration directory inside the checkout", () => {
  // The refusal is in bin/onboard.mjs's step 7b. Asserted on the SOURCE rather than by driving the
  // wizard: it is interactive and validates a live engine binary before it ever reaches this step, so a
  // spawn here would test the engine's availability, not the refusal. Named so the next reader knows
  // this arm is deliberately weaker than the others and why.
  const src = readFileSync(join(ROOT, "bin", "onboard.mjs"), "utf8");
  assert.match(src, /config-inside-checkout/, "the refusal must exist and be reachable");
  // — the wizard writes the name in force into the user's.env, so this anchors on the key it
  // actually writes. It was matched through a resolver rather than spelled literally, so that a rename
  // would carry the arm with it; left one spelling, so the literal IS the resolved name now.
  assert.match(src, new RegExp(`candidate\\["CLEAROTRON_CUSTOMERS_DIR"\\] = join\\(cfg, "profiles"\\)`),
    "and the store must come from the answer, not the repo");
  assert.ok(!new RegExp(`candidate\\[?\\.?"?CLEAROTRON_CUSTOMERS_DIR"?\\]? = join\\(REPO`).test(src),
    "never defaulted into the checkout");
});

// ── — THE BOUNDARY THAT HAD NO ARM ──────────────────────────────────────────────────────────
//
// 's PR body called the explicit-`dir` boundary "the most important line in this PR" and then
// shipped it untested, because every arm above exercises ONE side at a time: the explicit-`dir` arms
// run with the env var unset, and the env arms pass no `dir`. The boundary only ACTS when both are
// present, and that configuration appeared in no test.
//
// Measured, not argued: deleting the boundary (`const overlay = PROFILES_OVERLAY_DIR` regardless of
// `explicit`) makes an explicit-`dir` load return the ENV store's customers, and 89 arms across
// config-resolves, profiles, profile-service, pool-admin-reassign and mcp roster-boot-check stay
// GREEN. This arm is red under that plant and green without it.

/** Load with an explicit `dir` WHILE an env overlay is also configured — the only state where the
 *  boundary does anything, and the state nothing exercised. */
function loadExplicitWithEnvOverlay(explicitDir, envDir) {
  const src = 'import("../../driver/profiles.mjs").then(m=>{'
    + `const p=m.loadProfiles({dir:${JSON.stringify(explicitDir)},force:true});`
    + 'console.log(JSON.stringify({keys:[...p.keys()].sort()}));'
    + '}).catch(e=>{console.log(JSON.stringify({error:e.message}));});';
  const e = { ...process.env };
  pinEnv(e, "CLEAROTRON_CUSTOMERS_DIR", envDir);
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src],
    { cwd: join(ROOT, "driver", "test"), env: e, encoding: "utf8" });
  const line = `${r.stdout ?? ""}`.trim().split("\n").filter(Boolean).pop() ?? "";
  try { return JSON.parse(line); } catch { return { error: `unparseable: ${line} ${r.stderr ?? ""}` }; }
}

test("#1777 an EXPLICIT dir ignores the env overlay entirely — the boundary, in the state where it acts", () => {
  const explicitDir = mkdtempSync(join(tmpdir(), "cfg-explicit-"));
  const envDir = mkdtempSync(join(tmpdir(), "cfg-env-"));
  try {
    const generic = JSON.parse(readFileSync(join(BUNDLED, "generic.json"), "utf8"));
    writeFileSync(join(explicitDir, "generic.json"), JSON.stringify(generic));
    // A customer that exists ONLY in the env store. If the boundary fails, it appears in the roster
    // that an explicit `dir` asked for — which is how profile-service's write path and every fixture
    // that builds its own roster would start seeing customers they never created.
    const leaked = JSON.parse(readFileSync(join(BUNDLED, "aurora.json"), "utf8"));
    leaked.matchDomains = ["leaked-1777.example"];
    writeFileSync(join(envDir, "leaked.json"), JSON.stringify(leaked));

    const got = loadExplicitWithEnvOverlay(explicitDir, envDir);
    assert.equal(got.error, undefined, got.error);
    assert.deepEqual(got.keys, ["generic"],
      "an explicit dir is ONE directory. Anything from CLEAROTRON_CUSTOMERS_DIR appearing here means the "
      + "boundary is gone, and every caller that passes an explicit dir — profile-service's seven "
      + "write-path sites, and the fixtures that assert on exactly the roster they built — is silently "
      + "reading a roster it did not ask for.");
    assert.ok(!got.keys.includes("leaked"), "the env store's customer must not be in this roster");
  } finally {
    rmSync(explicitDir, { recursive: true, force: true });
    rmSync(envDir, { recursive: true, force: true });
  }
});

test("#1777 the inside-the-checkout rule is a PATH prefix, not a string prefix", async () => {
  const { isInsideCheckout } = await import("../../shared/inside-checkout.mjs");
  const repo = "/srv/product";

  assert.equal(isInsideCheckout("/srv/product/config", repo), true, "a path beneath the checkout");
  assert.equal(isInsideCheckout("/srv/product", repo), true,
    "the root ITSELF is inside — CLEAROTRON_CUSTOMERS_DIR=<repo> is the plainest form of the mistake");

  // THE SEPARATOR IS THE WHOLE RULE. Without it, a sibling named after the checkout is refused at setup
  // for no reason, and the message tells the user to move a directory that was never in the wrong place.
  assert.equal(isInsideCheckout("/srv/product-notes", repo), false,
    "a SIBLING whose name merely starts with the checkout's is not inside it");
  assert.equal(isInsideCheckout("/srv/productive/config", repo), false, "nor is a differently-named sibling tree");

  assert.equal(isInsideCheckout("/var/lib/clearotron/config", repo), false, "an unrelated path");
  // Both sides resolved: the same directory must not answer differently by how it was spelled.
  assert.equal(isInsideCheckout("/srv/product/../product/config", repo), true, "resolved, not compared raw");
  assert.equal(isInsideCheckout("", repo), false, "an empty candidate is not a match");
  assert.equal(isInsideCheckout("/srv/product/config", ""), false, "and neither is an empty root");
});
