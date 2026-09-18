// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// a-packaged-install-names-its-commit-from-build-info.test.mjs — the deploy check reads a packaged
// install's commit from its build-info.json, because there is no git there.
//
// Production and pre-prod run the package from the registry, not a checkout. The deploy check asked git
// which commit each service ran and which commit it was itself, and on those boxes git fails every time,
// so two arms reported "git could not read …/node_modules/clearotron — not a git repository" on every
// deploy: a failure of the check, not of the box, and the kind that teaches a reader to stop reading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { treeOf } from "../../shared/tree-commit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const noGit = () => ({ ok: false, out: null, err: "fatal: not a git repository" });

test("a checkout answers through git", () => {
  const t = treeOf(ROOT);
  assert.equal(t.source, "git", t.why);
  assert.match(t.head, /^[0-9a-f]{40}$/);
});

test("a packaged install answers through the build-info.json at its root, from anywhere inside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "packaged-"));
  try {
    const pkg = join(dir, "app", "node_modules", "clearotron");
    mkdirSync(join(pkg, "driver"), { recursive: true });
    writeFileSync(join(pkg, "build-info.json"), JSON.stringify({ commit: COMMIT, version: "0.3.2" }));
    // Real git and the real reader: the temporary directory is in no repository.
    const t = treeOf(join(pkg, "driver"));
    assert.equal(t.source, "build-info", t.why);
    assert.equal(t.head, COMMIT);
    assert.equal(t.root, pkg, "the package root is the tree, so every unit inside it compares as one");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a checkout's HEAD outvotes a stale stamp left inside it", () => {
  const git = (p, ...a) => (a[1] === "--show-toplevel" ? { ok: true, out: "/co", err: null } : { ok: true, out: "f".repeat(40), err: null });
  const t = treeOf("/co/driver", { git, build: () => ({ commit: COMMIT }) });
  assert.equal(t.source, "git");
  assert.equal(t.head, "f".repeat(40));
});

test("neither git nor a stamp is a could-not-look that names both, never a commit", () => {
  const t = treeOf("/nowhere/at/all", { git: noGit, build: () => null });
  assert.equal(t.root, null);
  assert.equal(t.head, null);
  assert.match(t.why, /not a git repository/);
  assert.match(t.why, /no build-info\.json/);
});

test("the deploy check asks through treeOf, not through git alone", () => {
  // The three places a commit is read: the tree a unit declares, the tree its process runs from, and the
  // check's own. Each asked git directly, which is the defect.
  const src = readFileSync(join(ROOT, "scripts", "live-surface-check.mjs"), "utf8");
  assert.doesNotMatch(src, /gitTry\([^)]*"rev-parse"/, "a commit is still read by asking git alone");
  assert.ok((src.match(/\btreeOf\(/g) ?? []).length >= 4, "the check no longer reads its commits through treeOf");
});
