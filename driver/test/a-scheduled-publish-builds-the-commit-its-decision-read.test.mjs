// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A scheduled release run was queued on one commit, main moved to a version commit while it waited, and its
// `pending` job decided about main. The publish job then checked out the event commit and tried to publish the
// tree from before the version commit. The decision now names its commit, and the publish job builds that one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "release-cut-decision.mjs");

test("a run whose event commit is behind main reports main's version and main's commit", () => {
  const dir = mkdtempSync(join(tmpdir(), "cut-decision-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd: dir, encoding: "utf8" }).trim();
  const version = (v) => { writeFileSync(join(dir, "package.json"), JSON.stringify({ version: v })); git("add", "-A"); git("commit", "-q", "-m", v); return git("rev-parse", "HEAD"); };
  git("init", "-q", "-b", "main");
  const event = version("1.0.0");
  git("tag", "v1.0.0");
  const decided = version("1.1.0");
  git("update-ref", "refs/remotes/origin/main", decided);
  git("checkout", "-q", event);

  const output = join(dir, "output.txt");
  execFileSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output, CLEAROTRON_CUT_REF: "origin/main" } });
  assert.equal(readFileSync(output, "utf8"), `version=1.1.0\ncut=true\nsha=${decided}\n`);
  assert.notEqual(decided, event, "premise: the event commit is behind main");
});

test("the publish job checks out the decided commit and refuses when it holds another", () => {
  const yaml = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  const pending = yaml.slice(yaml.indexOf("\n  pending:\n"), yaml.indexOf("\n  entry:\n"));
  assert.match(pending, /sha: \$\{\{ steps\.cut\.outputs\.sha \}\}/, "the pending job passes on the commit it read");
  const publish = yaml.slice(yaml.indexOf("\n  publish:\n"), yaml.indexOf("\n  publish-awaited:\n"));
  assert.match(publish, /ref: \$\{\{ needs\.pending\.outputs\.sha \|\| github\.sha \}\}/);
  assert.match(publish, /DECIDED_SHA: \$\{\{ needs\.pending\.outputs\.sha \}\}/);
  assert.match(publish, /"\$\(git rev-parse HEAD\)" != "\$DECIDED_SHA"/);
  assert.match(publish, /"\$VERSION" != "\$DECIDED_VERSION"/);
});
