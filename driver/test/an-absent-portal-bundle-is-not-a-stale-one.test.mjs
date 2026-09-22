// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync, utimesSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doctorRepoRoot } from "./helpers/portal-bundle.mjs";
import { bundleVerdict, gitStanding } from "../../shared/bundle-freshness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

// ── THE DOCTOR ARMS DO NOT DEPEND ON THE CHECKOUT'S PORTAL BUNDLE ──────────────────────────────────
//
// Twelve arms across three files run `doctor` and expect exit 0 for reasons that are not about the
// bundle. Against the checkout, a bundle older than its sources failed them all, on every run of any
// clone built once and then pulled. Building the bundle for them cannot work inside a suite run (the
// harness refuses the build, and a build changes `portal-ui/dist`), and an absent bundle already passes.
//
// So they run doctor from `doctorRepoRoot()`: this tree's code, and no `.git`. Doctor judges a bundle's
// age only in a git checkout, since a pull is the only way one goes stale, so from that root a stale,
// current or absent bundle gives the same answer and nothing is built or touched.

/** A tree with portal sources NEWER than its bundle: stale, if anything is. */
function staleTree(t, { git }) {
  const dir = mkdtempSync(join(tmpdir(), "portal-bundle-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "portal-ui", "src"), { recursive: true });
  mkdirSync(join(dir, "portal-ui", "dist"), { recursive: true });
  writeFileSync(join(dir, "portal-ui", "dist", "index.html"), "<!doctype html>built\n");
  const old = new Date(Date.now() - 3600_000);
  utimesSync(join(dir, "portal-ui", "dist", "index.html"), old, old);
  writeFileSync(join(dir, "portal-ui", "src", "app.js"), "// touched after the build\n");
  if (git) execFileSync("git", ["init", "-q", dir]);
  return dir;
}
const verdictOf = (repo) => bundleVerdict({ repo, distDir: join(repo, "portal-ui", "dist"), srcDir: join(repo, "portal-ui", "src") });

test("a stale bundle is judged stale in a git checkout and not judged at all outside one", (t) => {
  // THE MECHANISM, with its control. The same stale tree reads `stale` once it is a git checkout, so the
  // `unversioned` answer is about the missing `.git` and not about a bundle that failed to look old.
  assert.equal(verdictOf(staleTree(t, { git: true })), "stale", "the control: doctor still calls a stale checkout stale");
  assert.equal(verdictOf(staleTree(t, { git: false })), "unversioned");
});

test("the doctor arms' root has no git and runs this tree's code", () => {
  const root = doctorRepoRoot();
  assert.equal(gitStanding("portal-ui/dist", root).isGitCheckout, false,
    `${root} is inside a git work tree, so doctor would judge the checkout's bundle from it`);
  assert.notEqual(verdictOf(root), "stale", "whatever state the checkout's bundle is in, it is not judged stale from here");
  assert.equal(readFileSync(join(root, "bin", "onboard.mjs"), "utf8"), readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8"),
    "the arms must run the code under test, not a copy of something else");
  assert.equal(realpathSync(join(root, "driver")), realpathSync(join(REPO, "driver")));
  assert.equal(existsSync(join(root, ".env")), false, "no configuration file of its own");
  assert.equal(doctorRepoRoot(), root, "one root per process");
});

test("the twelve arms run doctor from that root, and none asserts on the bundle", () => {
  // If an arm ran doctor at the checkout again, a stale bundle would fail it again; and if one ever
  // asserted on bundle freshness, a root where the question does not arise would hide what it measures.
  const reads = {
    "doctor-refuses-what-cannot-run.test.mjs": /function doctor\(\{ env = \{\}, repo = doctorRepoRoot\(\) \} = \{\}\)/,
    "onboard-wizard.test.mjs": /const ONBOARD = join\(doctorRepoRoot\(\), "bin", "onboard\.mjs"\);/,
    "what-doctor-passes-a-search-accepts.test.mjs": /const DOCTOR_ROOT = doctorRepoRoot\(\);/,
  };
  for (const [f, uses] of Object.entries(reads)) {
    const src = readFileSync(join(HERE, f), "utf8");
    assert.match(src, uses, `${f} no longer runs doctor from doctorRepoRoot()`);
    assert.doesNotMatch(src, /\[join\((?:ROOT|REPO), "bin", "(?:clearotron|onboard)\.mjs"\), "doctor"/,
      `${f} runs doctor at the checkout, where a stale bundle fails it`);
    assert.ok(!/assert[^\n]*OLDER than the sources/.test(src),
      `${f} asserts on bundle staleness, so it IS about the bundle and needs a checkout to measure it`);
  }
});

test("the helper builds nothing and never names the checkout's bundle", () => {
  // The previous helper built the bundle, which the suite runner refuses and which changes
  // `portal-ui/dist`. A run must leave that directory byte-identical, so the helper may neither spawn a
  // build nor reach for the path at all.
  const src = readFileSync(join(HERE, "helpers", "portal-bundle.mjs"), "utf8")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(src, /child_process|spawnSync|execFileSync|build:ui/, "the helper can start a build");
  assert.doesNotMatch(src, /portal-ui|dist/, "the helper reads or writes the checkout's bundle");
});
