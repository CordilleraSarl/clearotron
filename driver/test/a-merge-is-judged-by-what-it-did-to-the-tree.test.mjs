// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MERGE IS JUDGED BY WHAT IT DID TO THE TREE, and each shape is planted rather than described.
//
// The check these drive was built from an incident where every content gate passed on a damaged tree:
// citation, release-note, census and environment audit all exited 0 while 26 release notes sat duplicated,
// because each of them asks about files that are there and none asks what a merge brought back.
//
// So every arm here BUILDS A REAL REPOSITORY and performs the real act. A fixture of git output would test
// the parser and not the question, and the question is the whole of it: these are the three shapes a merge
// can damage a tree in, and each one is planted so the check has to actually catch it.
//
// GIT RUNS WITH HOOKS OFF IN EVERY ONE. A `core.hooksPath` set globally reaches into a throwaway repository
// too, and the commit-message hook treats a repository with no origin as public and errs toward refusing —
// so a suite that does not disable hooks starts depending on whoever ran it last having the right git
// config. Measured on this box, 2026-09-17, on two arms that failed exactly that way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mergeShape, verdictOf, parseArgs } from "../../scripts/merge-shape-check.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

/** A throwaway repository with one commit on `main`, and a `git` bound to it. Hooks off — see the header. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "mshape-"));
  const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=", "-C", dir, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  const write = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  const commit = (msg) => { git("add", "-A"); git("commit", "-q", "-m", msg); return git("rev-parse", "HEAD"); };
  write("README.md", "start\n");
  commit("first");
  return { dir, git, write, commit, shape: (c = "HEAD") => mergeShape({ repo: dir, commit: c }) };
}

// ── SHAPE ONE: A MERGE BRINGS BACK WHAT A CUT TOOK ───────────────────────────────────────────────────
//
// The incident exactly. A branch's lineage is older than a deletion on the target, so it never deleted the
// file — and the merge, finding it present on one side and absent on the other, brings it back.
test("a merge that restores a note the cut consumed is refused, and the deleting commit is named", () => {
  // THE MECHANISM, MEASURED OFF THE REAL ONE RATHER THAN GUESSED. The first plant written here had the
  // note present at the merge base, and it did not reproduce: with the base holding the file, one side
  // deleting it and the other leaving it alone, git keeps the deletion, which is correct and is why this
  // is not an everyday occurrence. The incident needed the note ABSENT AT THE BASE — so the branch reads
  // as having ADDED it and the target as unchanged, and the merge takes the addition.
  //
  // That is what a locally rebased branch does: its lineage carries files from before a cut that the
  // target has since consumed, and the common ancestor is older than any of it.
  const r = repo();
  r.git("checkout", "-q", "-b", "feature");
  r.write(".changeset/a-note.md", "Fixed: something.\n");
  r.commit("the branch carries the note from its older lineage");

  r.git("checkout", "-q", "main");
  r.write(".changeset/a-note.md", "Fixed: something.\n");
  r.commit("the target had it too");
  r.git("rm", "-q", ".changeset/a-note.md");
  r.write(".changeset/pre/a-note.md", "Fixed: something.\n");
  r.commit("Release 1.0.0 — the cut consumes the note");

  r.git("merge", "--no-ff", "-q", "feature", "-m", "merge the feature");
  const s = r.shape();

  assert.equal(s.isMerge, true, "precondition: the arm must be judging a merge");
  assert.deepEqual(s.resurrected.map((x) => x.path), [".changeset/a-note.md"],
    "the note the cut consumed came back through the merge and must be named");
  assert.match(s.resurrected[0].deletedIn, /Release 1\.0\.0/,
    "…with the commit that deleted it, so a reader judges it without a second command");
  assert.equal(verdictOf(s), 1, "a resurrected note refuses");
  rmSync(r.dir, { recursive: true, force: true });
});

// ── SHAPE TWO: TWO OF ONE NAME ───────────────────────────────────────────────────────────────────────
test("a note in both .changeset and .changeset/pre is refused, whatever the merge itself changed", () => {
  // Deliberately a merge that adds and removes NOTHING. The duplication is a property of the resulting
  // TREE, not of the diff — the merge that first exposed this had already had its own changes absorbed,
  // and a check reading only the diff would have called it clean.
  const r = repo();
  r.write(".changeset/dup.md", "Fixed: a thing.\n");
  r.write(".changeset/pre/dup.md", "Fixed: a thing.\n");
  r.commit("both copies present");
  r.git("checkout", "-q", "-b", "feature");
  // The branch needs a commit of its own or it is an ancestor, and `git merge --no-ff` then reports
  // "Already up to date" and creates NO merge commit — which is the second bad merge shape seen on this
  // box tonight, and it silently made the first version of this arm test nothing at all.
  r.write("branch-work.mjs", "export const b = 1;\n");
  r.commit("the branch does its own unrelated work");
  r.git("checkout", "-q", "main");
  r.write("unrelated.mjs", "export const y = 2;\n");
  r.commit("main moves on");
  r.git("merge", "--no-ff", "-q", "feature", "-m", "a merge that touches neither copy of the note");

  const s = r.shape();
  assert.deepEqual(s.added, ["branch-work.mjs"],
    "precondition: this merge touches neither copy of the note, so only the tree question can fire");
  assert.deepEqual(s.removed, [], "…and removes nothing");
  assert.equal(s.duplicated.length, 1, "the pair holding one name twice must be found");
  assert.deepEqual(s.duplicated[0].names, ["dup.md"]);
  assert.equal(verdictOf(s), 1, "two of one name refuses");
  rmSync(r.dir, { recursive: true, force: true });
});

// ── SHAPE THREE: A MERGE THAT DELETES FROM THE TARGET — REPORTED, NEVER REFUSED ──────────────────────
test("a merge that deletes from the target is reported and does NOT refuse", () => {
  // The direction that matters. The commit which FIXED the original incident was exactly this shape — it
  // deleted 26 files from the branch it landed on — so a check that refuses a removal would have refused
  // its own cure. Reported so a reader looks; never fatal, because a guard that reds on an honest act is a
  // guard somebody switches off.
  const r = repo();
  r.write("doomed.mjs", "export const gone = 1;\n");
  r.commit("a file that will be removed on purpose");
  r.git("checkout", "-q", "-b", "feature");
  r.git("rm", "-q", "doomed.mjs");
  r.commit("the branch deliberately removes it");
  r.git("checkout", "-q", "main");
  r.git("merge", "--no-ff", "-q", "feature", "-m", "take the deliberate removal");

  const s = r.shape();
  assert.deepEqual(s.removed, ["doomed.mjs"], "the removal must be visible to a reader");
  assert.equal(verdictOf(s), 0, "…and must not refuse: a deliberate deletion is legitimate");
  rmSync(r.dir, { recursive: true, force: true });
});

// ── AND THE SCOPE IS LOAD-BEARING, NOT A FIRST CUT SOMEBODY FORGOT TO WIDEN ──────────────────────────
test("a file restored OUTSIDE the scope is not refused — a revert is an honest act", () => {
  // Judged over the whole tree, the resurrection question refuses `git revert`: reverting a commit that
  // deleted a file re-adds it, and the target's history carries the deletion, which is the refusal
  // condition word for word. This arm is the reason the scope exists, and it fails the moment somebody
  // widens the scope without answering that question — which is what it is for.
  // The SAME mechanism as shape one, on a path outside the scope — so the only thing separating a refusal
  // from a pass is the scope itself.
  const r = repo();
  r.git("checkout", "-q", "-b", "feature");
  r.write("src/thing.mjs", "export const t = 1;\n");
  r.commit("the branch carries the source file");

  r.git("checkout", "-q", "main");
  r.write("src/thing.mjs", "export const t = 1;\n");
  r.commit("the target had it too");
  r.git("rm", "-q", "src/thing.mjs");
  r.commit("delete the source file — a revert of this would legitimately bring it back");
  r.git("merge", "--no-ff", "-q", "feature", "-m", "merge the feature");

  const s = r.shape();
  assert.ok(s.added.includes("src/thing.mjs"),
    "precondition: the merge DID bring the file back — without this the arm passes because nothing happened");
  assert.deepEqual(s.resurrected, [],
    "a file outside the scope is not a finding: restoring one is what a revert does, and refusing that "
    + "gets the whole check switched off");
  assert.equal(verdictOf(s), 0);
  rmSync(r.dir, { recursive: true, force: true });
});

// ── THE CONTROLS, so a green reading means something ─────────────────────────────────────────────────
test("a clean merge is clean, and a commit that is not a merge says it examined nothing", () => {
  // Without these the four above are satisfied by a check that refuses everything, or by one whose reading
  // is empty for reasons that have nothing to do with the tree.
  const r = repo();
  r.git("checkout", "-q", "-b", "feature");
  r.write("added.mjs", "export const a = 1;\n");
  r.commit("an ordinary addition");
  r.git("checkout", "-q", "main");
  r.git("merge", "--no-ff", "-q", "feature", "-m", "an ordinary merge");

  const clean = r.shape();
  assert.equal(clean.isMerge, true);
  assert.deepEqual(clean.added, ["added.mjs"], "an ordinary addition is still reported as added");
  assert.deepEqual(clean.resurrected, [], "…and is not a resurrection: the target never had it");
  assert.equal(verdictOf(clean), 0, "an ordinary merge must pass, or nobody will run this twice");

  const notMerge = r.shape("HEAD^2");
  assert.equal(notMerge.isMerge, false, "a single-parent commit is not a merge");
  assert.equal(verdictOf(notMerge), 0);

  const unreadable = mergeShape({ repo: r.dir, commit: "no-such-ref" });
  assert.equal(unreadable.readable, false, "an unreadable commit is a stated could-not-look");
  assert.equal(verdictOf(unreadable), 2, "…and exits differently from both a pass and a finding");
  rmSync(r.dir, { recursive: true, force: true });
});

test("the check is wired into the tree it ships in", () => {
  // The arms above drive throwaway repositories, which proves the logic and says nothing about whether the
  // script can read THIS one. A guard that only works on fixtures is the shape this whole file argues
  // against, so it is read once against the repository it lives in.
  const s = mergeShape({ repo: ROOT, commit: "HEAD" });
  assert.equal(s.readable, true, `the check could not read this repository: ${s.why}`);
});

test("a commit named on the command line is the one examined, with or without --repo", () => {
  // Without --repo the commit sat at position 0, and the old filter dropped exactly that position: the
  // check examined HEAD, found no merge, and exited 0 about a commit nobody named.
  assert.deepEqual(parseArgs(["b288ce3"], "/here"), { repo: "/here", commit: "b288ce3" });
  assert.deepEqual(parseArgs(["--repo", "/tree", "b288ce3"], "/here"), { repo: "/tree", commit: "b288ce3" });
  assert.deepEqual(parseArgs(["b288ce3", "--repo", "/tree"], "/here"), { repo: "/tree", commit: "b288ce3" });
  assert.deepEqual(parseArgs([], "/here"), { repo: "/here", commit: "HEAD" }, "no commit named still means HEAD");
});
