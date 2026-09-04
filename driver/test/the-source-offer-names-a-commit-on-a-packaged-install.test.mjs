// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F49 — THE AGPL §13 SOURCE OFFER NAMED NO COMMIT ──────────────────────
//
// `server_info` tells every client it carries "the AGPL §13 source offer: this server's name, version,
// licence, source repository and THE COMMIT IT IS RUNNING." Driven from a real packaged install it
// answered `commit: null`. So the one surface that discharges a LICENCE OBLIGATION named no commit on
// the install shape most people run — while `build-info.json` sat in the same tree holding the answer.
//
// The engine's own resolution (driver/engine-build.mjs) had already been fixed for exactly this, after
// exactly this measurement. Two functions answering "which commit is this" from different evidence is
// how one of them goes on being wrong.
//
// WHY THE TREE IS BUILT RATHER THAN MOCKED. The defect is `git rev-parse` failing, and it fails because
// there IS no repository — not because a function was stubbed. A fixture that injects "git returned
// null" asserts the branch and never the condition, and would have passed against the shipped defect
// the day it was written. So these arms run the real resolution in a real directory with no `.git`.
//
// BREAK MATRIX:
//   · no git + build-info  → a 40-char sha        → break: drop the fallback, arm 1 red
//   · the sha is the one build-info NAMES         → break: return any sha, arm 1 red
//   · the reader is told which evidence answered  → break: report "git" always, arm 2 red
//   · a real checkout still prefers GIT           → break: let build-info win, arm 3 red
//   · neither present → null, never an invention  → break: fabricate, arm 4 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * A tree shaped like a packaged install: `shared/` beside a root `build-info.json`, and NO `.git`
 * anywhere above it. Copied from the real module so the arm runs the shipped code.
 */
function packagedTree({ withBuildInfo = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "f49-"));
  mkdirSync(join(root, "shared"), { recursive: true });
  for (const f of ["product-identity.mjs", "packaged-build.mjs"])
    cpSync(join(ROOT, "shared", f), join(root, "shared", f));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "clearotron", version: "0.1.0", license: "AGPL-3.0-only" }));
  if (withBuildInfo) writeFileSync(join(root, "build-info.json"), JSON.stringify({ commit: SHA, packedAt: "2026-09-04T00:00:00Z" }));
  return root;
}

/** Import the copied module fresh, so its module-level cache is this tree's and not another's. */
const identityIn = (root) => import(`${join(root, "shared", "product-identity.mjs")}?t=${Math.random()}`);

test("on a packaged install with no git, the source offer names the commit build-info carries", async () => {
  const root = packagedTree();
  assert.ok(!existsSync(join(root, ".git")), "the rig made a git repo — it would measure the wrong branch");
  const m = await identityIn(root);
  const commit = m.runningCommit();
  nonEmpty([commit ?? ""], "the source offer still answers with no commit on a packaged install");
  assert.match(String(commit), /^[0-9a-f]{40}$/, "the source offer must name a full sha, not a fragment or a label");
  assert.equal(commit, SHA, "the sha is not the one build-info.json names — it came from somewhere else");
});

test("the reader is told WHICH evidence named it, because a stamped file is not a verified tree", async () => {
  const m = await identityIn(packagedTree());
  assert.equal(m.runningCommit(), SHA);
  assert.equal(m.runningCommitSource(), "build-info",
    "a commit read from a shipped file is reported as though it came from a live checkout");
});

test("in a real checkout git still wins — a stale build-info must never override the running tree", async () => {
  const root = packagedTree();
  // A REAL repository, with a build-info naming a DIFFERENT commit. This is the checkout case the
  // engine's own note describes: the file names what was PACKED, the checkout names what is RUNNING.
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: root });
  const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.notEqual(head, SHA, "the rig's git head equals the planted sha — the arm could not tell them apart");
  const m = await identityIn(root);
  assert.equal(m.runningCommit(), head, "a stale build-info.json overrode the live checkout");
  assert.equal(m.runningCommitSource(), "git");
});

test("with neither git nor build-info it answers null, and never invents one", async () => {
  const m = await identityIn(packagedTree({ withBuildInfo: false }));
  assert.equal(m.runningCommit(), null, "a commit was reported by a tree that can name none");
  assert.equal(m.runningCommitSource(), null);
});
