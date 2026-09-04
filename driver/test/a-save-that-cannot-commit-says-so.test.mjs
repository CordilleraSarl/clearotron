// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A save that cannot be committed must not read like one that was.
//
// The owner created a project through the portal. Both files landed on disk, neither was committed, and
// nothing said so: the UI reported success, and the audit line recorded `project-create` with nothing to
// distinguish it from a save that persisted. The residue then blocked `sync-skills` fleet-wide.
//
// TWO DEFECTS, and the environment cause is neither of them. Git refused the checkout for the service
// account, which is configuration and was fixed on the box. What the PRODUCT could not do was tell a
// save from a half-save:
//
//   1. the failure did not surface as the refusal. The commit path ran `git diff --cached` first, and
//      outside a usable repository git falls back to `--no-index` mode, which has no `--cached` — so the
//      log recorded `error: unknown option 'cached'` and twenty lines of usage. The real reason was one
//      `rev-parse` away and nothing ran it.
//   2. the audit row is composed BEFORE the commit is attempted (deliberately — 2026-07-18: a live
//      mutation with no record of who made it is the worse failure). So it read exactly like a success.
//


import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeStoreCommit, commitWithAuditRow } from "../../shared/store-in-repo.mjs";

/** A directory that is NOT a usable git repository — the shape the portal met on the box. */
const unusableStore = () => mkdtempSync(join(tmpdir(), "store-2005-broken-"));

/** A real repository, so the control is a genuine success rather than an absence of failure. */
function workingStore() {
  const root = mkdtempSync(join(tmpdir(), "store-2005-ok-"));
  const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  writeFileSync(join(root, "seed.txt"), "seed\n");
  git("add", "seed.txt");
  git("commit", "-q", "-m", "seed");
  return root;
}

test("2005 the refusal reaches the log AS the refusal, not as a fallback-mode parse error", () => {
  const lines = [];
  const commit = makeStoreCommit({ repoRoot: unusableStore(), log: (l) => lines.push(l), what: "profile" });
  assert.throws(() => commit({ files: ["x.json"], message: "m", author: "a@b.test" }),
    /not a usable git repository/, "the save must FAIL rather than report success over a refused commit");

  const said = lines.join("\n");
  assert.match(said, /not a usable git repository/, "the log must name the condition");
  assert.match(said, /not a git repository|dubious ownership/, "and carry git's OWN refusal, whichever it is");
  // THE DEFECT, NAMED. This is what the reader used to get instead.
  assert.doesNotMatch(said, /unknown option/, "a fallback-mode parse error is not a diagnosis");
  assert.doesNotMatch(said, /usage: git diff/, "and twenty lines of diff usage is not either");
});

test("2005 the audit trail records the gap — a create that did not persist does not read like one that did", () => {
  const rows = [];
  const r = commitWithAuditRow({
    audit: (row) => { rows.push(row); return null; },
    gitCommit: () => { throw new Error("fatal: detected dubious ownership in repository at '/opt/store'"); },
    files: ["projects/generic/etatat.json"], message: "m", by: "krzys@example.test",
    row: { event: "project-create", key: "generic/etatat" },
  });
  assert.ok(r.commitError, "the caller is told");

  // The FIRST row still exists, unchanged. 2026-07-18: a live mutation with no record of who made it is
  // the worse failure of the two, and that guarantee holds precisely because the row precedes the commit.
  assert.equal(rows[0].event, "project-create", "the original row is not rewritten or withheld");
  // …and a SECOND row says it did not stick.
  assert.equal(rows[1]?.event, "store-commit-failed");
  assert.equal(rows[1].of, "project-create", "naming which row it is about");
  assert.equal(rows[1].key, "generic/etatat");
  assert.match(rows[1].detail, /dubious ownership/, "carrying the cause, not a generic failure");
  assert.match(rows[1].note, /LIVE on disk and NOT committed/,
    "a reader asking what really happened must be able to tell a save from a half-save");
});

test("2005 THE CONTROL — a working store still commits, and writes NO failure row", () => {
  // Three arms above assert a failure. A preflight that refused every store would satisfy all of them
  // while breaking every save on every box, which is a far worse outcome than the bug.
  const root = workingStore();
  writeFileSync(join(root, "profiles.json"), "{}\n");
  const rows = [];
  const commit = makeStoreCommit({ repoRoot: root, log: () => {}, what: "profile" });
  const r = commitWithAuditRow({
    audit: (row) => { rows.push(row); writeFileSync(join(root, "_audit.log"), "x\n"); return "_audit.log"; },
    gitCommit: commit, files: ["profiles.json"], message: "chore: save", by: "a@b.test",
    row: { event: "project-create", key: "generic/real" },
  });
  assert.equal(r.commitError, null, "a usable store commits");
  assert.match(r.commit, /^[0-9a-f]{7,40}$/, "and returns the sha it wrote");
  assert.deepEqual(rows.map((x) => x.event), ["project-create"], "no failure row on a save that persisted");
  // Proving the commit is REAL and not merely un-thrown: the tree is clean afterwards.
  const porcelain = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim();
  assert.equal(porcelain, "", "a committed save leaves no residue — the residue is what blocked sync-skills");
});

test("2005 the preflight runs BEFORE anything composes a diff", () => {
  // Ordering is the whole of defect 1: `git diff --cached` first meant the reader got git's fallback-mode
  // complaint instead of the refusal underneath. Asserted on the source because the ordering is what
  // must not drift back, and a passing run cannot show which command went first.
  const src = readFileSync(new URL("../../shared/store-in-repo.mjs", import.meta.url), "utf8");
  const preflight = src.indexOf('repoRefusal()');
  const diff = src.indexOf('"diff", "--cached"');
  assert.notEqual(preflight, -1, "the preflight must exist");
  assert.notEqual(diff, -1, "anchor missing: the staged-diff read — re-aim this arm");
  assert.ok(src.indexOf("const refusal = repoRefusal();") < diff,
    "the repository check must run before the staged diff, or the fallback-mode error masks the cause again");
});
