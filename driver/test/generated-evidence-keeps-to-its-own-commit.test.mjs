// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// generated-evidence-keeps-to-its-own-commit.test.mjs — the hand-written diff has to be reviewable.
//
// One integration branch was 37 commits, 2,490 files, 221,105 additions and 410,984 deletions, and
// most of it was regenerated demo evidence. A reviewer cannot find the source changes inside that, so
// in practice nobody reads them: the review happens and it reviews nothing.
//
// The evidence is not the problem. It is generated output, it is meant to change wholesale, and it is
// right that it ships. Mixing it into the same commits as hand-written code is the problem, and a
// convention nobody checks is a convention that lasts one beta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mixedPaths, products, GENERATOR, MANIFEST } from "../../scripts/demo-evidence.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

test("a commit that touches the evidence and nothing else passes", () => {
  assert.deepEqual(mixedPaths(["demo/knockout-search/run/report.md", "demo/MANIFEST.json"]), []);
});

test("a commit that touches neither passes — this guard is not about every commit", () => {
  assert.deepEqual(mixedPaths(["driver/pipeline.mjs", "README.md"]), []);
});

test("a commit that mixes them names the source files it hid", () => {
  const mixed = mixedPaths(["demo/knockout-search/run/report.md", "driver/pipeline.mjs", "README.md"]);
  assert.deepEqual(mixed, ["driver/pipeline.mjs", "README.md"],
    "the guard did not name the hand-written paths buried in the regeneration");
});

test("the manifest says what produced the evidence, and names every product's run", () => {
  // Without it, a reviewer skipping the demo diff is trusting that it IS generated output rather than
  // a hand edit hidden inside 200,000 lines. With it, the thing they skip says what made it.
  assert.ok(existsSync(MANIFEST), "demo/MANIFEST.json is missing, so the skipped diff explains nothing");
  const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
  assert.equal(m.generator, GENERATOR, "the manifest does not name the generator");
  assert.match(m.recordedFromTree, /^[0-9a-f]{40}$/, "the manifest does not name the tree it was recorded from");

  const onDisk = products({ root: ROOT });
  assert.ok(onDisk.length > 0, "precondition: no demo products on disk");
  assert.deepEqual(m.products.map((p) => p.product), onDisk.map((p) => p.product),
    "the manifest and the demo directory disagree about which products ship");
  for (const p of m.products) {
    assert.ok(p.runId, `${p.product} names no run, so nothing says which capture it replays`);
  }
});

test("the recipe for reading a branch without the evidence is written down", () => {
  // A convention that lives only in a reviewer's head is one the next contributor cannot follow.
  const contributing = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8");
  assert.match(contributing, /:!demo/, "CONTRIBUTING does not show how to diff a branch without the evidence");
  assert.match(contributing, /demo-evidence\.mjs --apply/, "CONTRIBUTING does not say to re-record the manifest");
});

test("the guard is wired into CI, not merely available to run", () => {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /demo-evidence\.mjs --check/,
    "nothing checks the convention on a push, so it lasts exactly as long as people remember it");
});
