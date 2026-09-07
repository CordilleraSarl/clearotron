// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// scripts/validate-profiles.mjs — the entry point the live config store's CI calls.
//
// WHY IT IS TESTED HERE. The store it guards has no package.json, no CI of its own until now, and holds
// the only real client data of the three repos. Its CI checks THIS repo out to run this script, so a
// regression here silently disarms the only static gate that store has. The two properties that matter:
// a real defect exits non-zero, and a clean store exits zero — a gate that cannot fail is not a gate.
//
// Fixtures are the repo's own bundled demo profiles, copied and then broken. Nothing is invented: an
// invented profile shape would pass a validator that the real bundles fail.

import { test } from "node:test";
import { pinEnvAll } from "../../shared/env-aliases.mjs";   // — a spread carries EVERY spelling, so an override must clear every spelling
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO, "scripts", "validate-profiles.mjs");
const BUNDLED = join(REPO, "driver", "profiles");

/** A copy of the bundled roster, for breaking. */
function store() {
  const d = mkdtempSync(join(tmpdir(), "profiles-"));
  cpSync(BUNDLED, d, { recursive: true });
  return d;
}

const run = (args) => {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    // Unset so the test never reads whatever store this box happens to point at.
    env: pinEnvAll({ ...process.env }, { CLEAROTRON_CUSTOMERS_DIR: "" }),
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const edit = (dir, file, fn) => {
  const p = join(dir, file);
  const o = JSON.parse(readFileSync(p, "utf8"));
  fn(o);
  writeFileSync(p, JSON.stringify(o, null, 2));
};

test("the bundled roster is clean, and the report names which store it read", () => {
  const { code, out } = run(["--dir", BUNDLED]);
  assert.equal(code, 0, out);
  assert.match(out, /no findings\./);
  // The literal list is deliberate brittleness, like the key-split arm: adding a BUNDLED profile is a
  // shipped-surface change and should require somebody to type it here. `demo-brand-owner` joined in
  // — the demo account, marked demo data, which the runner refuses real clearances on.
  assert.match(out, /roster: aurora, demo-brand-owner, generic, petcary, zephyr/, "the roster is printed — the two stores share no key");
});

test("an unset CLEAROTRON_CUSTOMERS_DIR validates the bundled roster and SAYS that is what it did", () => {
  const { code, out } = run([]);
  assert.equal(code, 0, out);
  assert.match(out, /bundled demo roster/, "never silently implies it checked the live store");
});

test("a profile with a dead knob fails — the F7 deny-unknown-key guard", () => {
  const d = store();
  try {
    edit(d, "petcary.json", (o) => { o.notAKnob = "x"; });
    const { code, out } = run(["--dir", d]);
    assert.equal(code, 1);
    assert.match(out, /unknown key "notAKnob"/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("unparseable JSON is named by file, not swallowed", () => {
  const d = store();
  try {
    writeFileSync(join(d, "zephyr.json"), "{ not json");
    const { code, out } = run(["--dir", d]);
    assert.equal(code, 1);
    assert.match(out, /zephyr\.json: unparseable JSON/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("every bad bundle is reported in one pass, not one per push", () => {
  const d = store();
  try {
    edit(d, "petcary.json", (o) => { o.notAKnob = "x"; });
    edit(d, "zephyr.json", (o) => { o.alsoNotAKnob = "y"; });
    const { code, out } = run(["--dir", d]);
    assert.equal(code, 1);
    assert.match(out, /notAKnob/);
    assert.match(out, /alsoNotAKnob/);
    assert.match(out, /2 finding\(s\)/, "both, in one run");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a missing generic.json fails — the set-level guard, and it is not masked by a per-file error", () => {
  // The masking bug this pins: loadProfiles throws on the FIRST bad bundle, so with any per-file error
  // present it re-reported that one and never reached the set-level guards. A missing universal fallback
  // mis-profiles every job, so hiding it behind a typo is the wrong trade.
  const d = store();
  try {
    rmSync(join(d, "generic.json"));
    const clean = run(["--dir", d]);
    assert.equal(clean.code, 1);
    assert.match(clean.out, /generic\.json is REQUIRED/);

    edit(d, "petcary.json", (o) => { o.notAKnob = "x"; });
    const masked = run(["--dir", d]);
    assert.equal(masked.code, 1);
    assert.match(masked.out, /set-level guards did NOT run/, "and it says the missing-generic check was not reached");
    assert.doesNotMatch(masked.out, /the store as a whole.*notAKnob/, "no duplicate of the per-file error");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("two profiles claiming one match domain fail — readdir order must never decide a customer", () => {
  const d = store();
  try {
    // SEEDED ON BOTH SIDES, NOT BORROWED FROM ONE. This read aurora's first matchDomain and
    // bailed with a bare `return` when the bundled roster carried none — so the day the demo profiles
    // stop declaring matchDomains, the collision rule retires silently and this arm still reports ok.
    // The subject here is the RULE, not the roster's contents, so the collision is constructed.
    //
    // Still the real bundles, copied and then broken — this file's stated discipline, and the reason
    // the profiles are not invented outright: an invented shape would pass a validator the real ones
    // fail, and the overlap check has to run against a store that is otherwise valid.
    const dom = "collision-probe.example";
    edit(d, "aurora.json", (o) => { o.matchDomains = [dom]; });
    edit(d, "zephyr.json", (o) => { o.matchDomains = [dom]; });
    const { code, out } = run(["--dir", d]);
    assert.equal(code, 1);
    assert.match(out, /matchDomains overlap/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a project overlay may not set a customer-only key", () => {
  const d = store();
  try {
    const pdir = join(d, "projects", "aurora");
    mkdirSync(pdir, { recursive: true });
    // `frameworkPath` is rating authority — whole-customer only. An overlay states deltas.
    writeFileSync(join(pdir, "probe.json"), JSON.stringify({ frameworkPath: "skills/prelim-search/risk-framework.md" }));
    const { code, out } = run(["--dir", d]);
    assert.equal(code, 1);
    assert.match(out, /projects\/aurora\/probe\.json/);
    assert.match(out, /customer-only/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("an overlay with no customer to overlay fails", () => {
  const d = store();
  try {
    const pdir = join(d, "projects", "nosuchcustomer");
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, "probe.json"), JSON.stringify({ projectName: "Probe" }));
    const { code, out } = run(["--dir", d]);
    assert.equal(code, 1);
    assert.match(out, /no customer profile "nosuchcustomer"/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a directory that is not there exits 2 and names the path — not 0, and not 1", () => {
  // 2 is "could not look", which is a different thing from "looked and found nothing". A CI step that
  // cannot find the store must not report it clean.
  const { code, out } = run(["--dir", "/nonexistent/profiles"]);
  assert.equal(code, 2);
  assert.match(out, /\/nonexistent\/profiles/);
});

test("an empty directory is a finding, not a clean sweep", () => {
  const d = mkdtempSync(join(tmpdir(), "profiles-empty-"));
  try {
    const { code, out } = run(["--dir", d]);
    assert.equal(code, 1);
    assert.match(out, /holds no \*\.json profile bundle at all/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the CLI exists where the config repo's CI expects it", () => {
  // The workflow in the configuration repository calls this exact path after checking this repo out.
  // Renaming or moving it breaks a gate in another repository, which no test there can catch.
  assert.ok(existsSync(CLI), "scripts/validate-profiles.mjs is a cross-repo contract");
});
