// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RELEASE NOTE IN BOTH PLACES AT ONCE IS PUBLISHED TWICE, AND NOTHING USED TO REFUSE IT.
//
// A pre-release consumes a note by moving it from `.changeset/` into `.changeset/pre/`. A branch carrying
// its own copy of work main already has can put that filename back at the top level, and the tree then
// holds both: the next cut consumes the top-level copy a second time and republishes its sentence on the
// public releases page. Ten notes reached that state on one head in September 2026 and no run failed.
//
// THE ARMS BELOW ARE DRIVEN ON A FIXTURE, not on this tree, because this tree is usually clean and an arm
// that only ever sees a clean tree would pass just as well if the comparison had been deleted. The live
// tree is then checked separately, which is the assertion that actually protects the releases page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { duplicateNotes, main, misfiledNotes, placementMain } from "../../scripts/release-duplicate-notes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TEMP = [];
const tree = () => {
  const d = mkdtempSync(join(tmpdir(), "dupnotes-"));
  TEMP.push(d);
  mkdirSync(join(d, ".changeset", "pre"), { recursive: true });
  return d;
};
const note = (root, rel) => writeFileSync(join(root, ".changeset", rel),
  '---\n"clearotron-driver": patch\n---\n\nFixed: A thing a reader can see.\n');

test.after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

test("a note consumed by a cut and then re-added at the top level is named, and removing the copy clears it", () => {
  const root = tree();
  note(root, join("pre", "a-thing.md"));
  note(root, join("pre", "another.md"));

  // The ordinary state after a cut: everything consumed, nothing waiting.
  assert.deepEqual(duplicateNotes(root).duplicates, []);

  // The branch puts its own copy back.
  note(root, "a-thing.md");
  assert.deepEqual(duplicateNotes(root).duplicates, ["a-thing.md"],
    "a note present in .changeset/ and .changeset/pre/ at once is what gets published twice");
  assert.equal(main(root), 1, "and the command refuses, so a pipeline step can be gated on it");

  // The same tree with the copy deleted passes — which is what says the arm is judging the duplicate
  // and not merely the presence of notes.
  rmSync(join(root, ".changeset", "a-thing.md"));
  assert.deepEqual(duplicateNotes(root).duplicates, []);
  assert.equal(main(root), 0);
});

test("a note waiting at the top level that no cut has consumed is not a duplicate", () => {
  const root = tree();
  note(root, "brand-new.md");
  note(root, join("pre", "already-shipped.md"));
  const read = duplicateNotes(root);
  assert.deepEqual(read.duplicates, [], "different names in the two places are the normal working state");
  // THE FLOOR. Both sides must have been enumerated; a comparison of two empty lists is also empty, and
  // would pass this arm while checking nothing at all.
  assert.equal(read.waiting, 1, "the waiting notes were read");
  assert.equal(read.consumed, 1, "the consumed notes were read");
});

test("README.md is not a release note, and pre/ is compared by file name", () => {
  const root = tree();
  writeFileSync(join(root, ".changeset", "README.md"), "# how to write a note\n");
  writeFileSync(join(root, ".changeset", "pre", "README.md"), "# notes already consumed\n");
  assert.deepEqual(duplicateNotes(root).duplicates, [],
    "the contract document sits in .changeset/ on every tree and is not a note anyone publishes");
});

test("a tree with no .changeset/ is a refusal, not a clean answer", () => {
  const root = tree();
  rmSync(join(root, ".changeset"), { recursive: true });
  assert.ok(duplicateNotes(root).error, "an absence is a finding — it must not read as no duplicates");
  assert.equal(main(root), 2, "could not look is its own exit code, distinct from a pass and from a refusal");
});

test("no release note in THIS tree is counted twice", () => {
  const read = duplicateNotes(ROOT);
  assert.ok(!read.error, `the repository's own .changeset/ must be readable: ${read.error ?? ""}`);
  assert.deepEqual(read.duplicates, [],
    "a note here in both .changeset/ and .changeset/pre/ would have its text republished by the next cut");
  assert.ok(existsSync(join(ROOT, ".changeset")), "and the directory it read is this repository's own");
});

// ── AND A NOTE IN THE CONSUMED PILE THAT NO CUT PUT THERE ──────────────────────────────────────────
//
// `.changeset/pre/` is where a cut MOVES a note after publishing it. A note written straight into it is
// born consumed: the versioning tool filters `pre/` ids out of its count, so it is never eligible for a
// release, nothing refuses it, and it later appears in the stable's changelog as though a pre-release had
// carried it. One note reached that state in this repository and took the whole report redesign with it —
// shipped, and announced in no release from beta.0 to beta.5.
//
// These arms build a REAL repository, because the check reads history to tell the two cases apart and a
// directory that is not a checkout answers nothing at all.
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

const repo = () => {
  const d = tree();
  git(d, "init", "-q");
  git(d, "config", "user.email", "nobody@example.invalid");
  git(d, "config", "user.name", "Nobody");
  return d;
};

const commitNote = (root, rel, { asRelease = false, subject = "an ordinary change" } = {}) => {
  note(root, rel);
  git(root, "add", "-A");
  const args = ["commit", "-q", "-m", asRelease ? "Release 9.9.9-beta.1" : subject];
  if (asRelease) args.push("--author=github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>");
  git(root, ...args);
};

test("a note a release put in the consumed pile is where it belongs", () => {
  const root = repo();
  commitNote(root, join("pre", "already-published.md"), { asRelease: true });
  assert.deepEqual(misfiledNotes(root).misfiled, [],
    "a version commit moving a note into pre/ is a note being consumed correctly");
  assert.equal(placementMain(root), 0);
});

test("a note written straight into the consumed pile is named, with the commit that put it there", () => {
  const root = repo();
  commitNote(root, join("pre", "already-published.md"), { asRelease: true });
  commitNote(root, join("pre", "never-announced.md"), { subject: "a change that wrote its own note" });

  const { misfiled } = misfiledNotes(root);
  assert.deepEqual(misfiled.map((m) => m.name), ["never-announced.md"],
    "only the hand-filed one is named; the consumed one beside it must not be swept up with it");
  assert.equal(misfiled[0].subject, "a change that wrote its own note",
    "the commit that misfiled it is named, because that is what tells the author where it went wrong");
  assert.equal(placementMain(root), 1);
});

test("a tree whose history cannot be read gives no verdict either way", () => {
  // A shallow clone is the real case: CI checks out depth 1 for the suites, and a file's adding commit is
  // not in that history. Answering "misfiled" from a missing answer would condemn every note there.
  const root = tree();
  mkdirSync(join(root, ".changeset", "pre"), { recursive: true });
  note(root, join("pre", "already-published.md"));
  const read = misfiledNotes(root);
  assert.deepEqual(read.misfiled, [], "an unanswerable history is not evidence of misfiling");
  assert.deepEqual(read.unknown, ["already-published.md"], "it is reported as unread rather than as clean");
  assert.equal(placementMain(root), 2, "could not look is its own exit code, distinct from a pass and a refusal");
});

// ── THE CASE THAT BROKE THE FIRST IMPLEMENTATION, PINNED ──────────────────────────────────────────
//
// A note that is misfiled, moved out to be published, and then consumed by a release properly ends up
// back under `pre/` — and it is now correct. The obvious query for "which commit put it there",
// `git log --diff-filter=A -- .changeset/pre/<name>`, answers with the ORIGINAL misfiling and never
// mentions the release, for two compounding reasons: a cut consumes a note by MOVING it, which git
// records as a rename rather than an add, and a path-limited log simplifies history straight back
// through that rename to the file's first creation.
//
// Measured on this repository 2026-09-17: the query named the misfiling commit for a note the beta.6
// version commit had just consumed, so the check refused a tree that was correct. Every future cut
// would have met the same refusal. `--full-history` is what stops it.
test("a note misfiled, moved out, then consumed by a release reads as consumed — not as its first sin", () => {
  const root = repo();
  commitNote(root, join("pre", "twice-moved.md"), { subject: "a change that filed its note in the wrong pile" });
  assert.deepEqual(misfiledNotes(root).misfiled.map((m) => m.name), ["twice-moved.md"],
    "while it sits where no release put it, it is named");

  // Moved out to where a cut can see it.
  git(root, "mv", ".changeset/pre/twice-moved.md", ".changeset/twice-moved.md");
  git(root, "commit", "-q", "-m", "move the note where the cut will read it");
  assert.deepEqual(misfiledNotes(root).misfiled, [], "nothing is in the consumed pile to judge");

  // And consumed by a release, the way a cut does it: a move, authored by the pipeline.
  git(root, "mv", ".changeset/twice-moved.md", ".changeset/pre/twice-moved.md");
  git(root, "commit", "-q", "-m", "Release 9.9.9-beta.2",
    "--author=github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>");

  const { misfiled, unknown } = misfiledNotes(root);
  assert.deepEqual(unknown, [], "history answers for it");
  assert.deepEqual(misfiled, [],
    "the release consumed it, so it belongs where it now sits — reading back past the rename to the "
    + "original misfiling would refuse a tree that is correct, which is what the first implementation did");
  assert.equal(placementMain(root), 0);
});
