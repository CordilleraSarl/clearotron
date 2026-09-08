// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A COMMITTED FLOOR IS A STATEMENT ABOUT THE PUBLISHED TREE, AND THE INDEX IS NOT THAT TREE.
//
// Both minters enumerated with `git ls-files`, which reads the INDEX. An overlay run stages the withheld
// corpus over a clone and never commits it, so there `ls-files` returns files that exist in no public
// tree — and a floor minted from it records withheld hits into a public fixture. Nothing reports that:
// the number is simply too high, and the next person to re-mint from a clean checkout is shown a SHRINK
// and told to record it.
//
// WHY THIS NEEDS A PLANTED REPOSITORY. On any clean checkout the index and HEAD agree, so a check that
// read this tree would pass while looking at nothing — the same shape as a floor measured over the
// population it is supposed to police. So each arm builds a repository in the state it is about.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { headFiles, stagedOnly } from "../../scripts/published-population.mjs";

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });

/** A repository with one committed file, and optionally one STAGED but uncommitted — the overlay shape. */
function plantRepo({ staged = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "published-population-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.invalid");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "published.md"), "a published line\n");
  git(root, "add", "published.md");
  git(root, "commit", "-qm", "first");
  if (staged) {
    writeFileSync(join(root, "withheld.md"), "a line only the overlay has\n");
    git(root, "add", "withheld.md");
  }
  return root;
}

test("the published population is HEAD's files, and a staged-only file is not among them", () => {
  const root = plantRepo({ staged: true });
  try {
    assert.deepEqual(headFiles(root), ["published.md"],
      "a file the overlay staged and never committed reached the published population");
    assert.deepEqual(stagedOnly(root), ["withheld.md"], "the staged-only file was not detected");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a tree whose index matches HEAD reports nothing staged-only — and the arm above is not vacuous", () => {
  // Without this, the first arm is satisfied by a `stagedOnly` that returns everything it is handed.
  const root = plantRepo({ staged: false });
  try {
    assert.deepEqual(stagedOnly(root), [], "a clean tree reported a staged-only file");
    assert.deepEqual(headFiles(root), ["published.md"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a minter REFUSES on a tree whose index carries what HEAD does not, and says which files", () => {
  // Driven through the process, because the refusal is an exit code and a message a person reads —
  // asserting on the function alone would prove the branch is reachable and not that it stops anything.
  const root = plantRepo({ staged: true });
  try {
    const script = join(import.meta.dirname, "..", "..", "scripts", "published-population.mjs");
    const r = execFileSync(process.execPath, ["-e", `
      import(${JSON.stringify(script)}).then((m) => { m.publishedPopulation(${JSON.stringify(root)}, { what: "a test floor" }); });
    `], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] , cwd: root});
    assert.fail(`the minter did not refuse; it returned ${r}`);
  } catch (e) {
    assert.equal(e.status, 2, "a could-not-look must exit 2, not 1 and not 0");
    assert.match(String(e.stderr), /REFUSING/);
    assert.match(String(e.stderr), /withheld\.md/, "the refusal must name the offending path");
    assert.match(String(e.stderr), /--include-staged/, "and the deliberate override");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--include-staged widens the population deliberately, and says so rather than going quiet", () => {
  // The add-then-mint flow the suite census requires is exactly this shape, so the refusal must have a
  // door. What it must not have is a silent one.
  const root = plantRepo({ staged: true });
  try {
    const script = join(import.meta.dirname, "..", "..", "scripts", "published-population.mjs");
    const out = execFileSync(process.execPath, ["-e", `
      import(${JSON.stringify(script)}).then((m) => {
        const f = m.publishedPopulation(${JSON.stringify(root)}, { includeStaged: true, what: "a test floor" });
        process.stdout.write(JSON.stringify(f.sort()));
      });
    `], { encoding: "utf8", cwd: root });
    assert.deepEqual(JSON.parse(out), ["published.md", "withheld.md"], "the override must widen the population");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
