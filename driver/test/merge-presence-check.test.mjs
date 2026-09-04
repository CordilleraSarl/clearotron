// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// merge-presence-check.test.mjs — the drop arm, exercised, because nothing else can exercise it.
//
// scripts/merge-presence-check.mjs cannot run in CI (it reads the forge's pull-request index), and
// its most important verdict — MOVED-AFTER-MERGE, work pushed to a branch that the merge never took
// — has no live fixture left in the repository. was the real one; re-landed its commit an
// hour after it was found, so the real repository now correctly reports RE-LANDED and the drop arm
// runs against nothing.
//
// The fixtures below are SYNTHETIC and that is a deliberate departure from the house rule that
// fixtures come from real artifacts. The rule exists because an invented fixture certifies the bug
// it was invented alongside. It does not bite here: what is being reproduced is git mechanics —
// squash, patch-id, a push landing after a merge — which are exact and reproducible, not a guess at
// what some artifact contained. The one thing these tests must never do is assert a verdict the real
// / shapes would not produce, so each arm is built to the shape the incident actually had
// and the incident's own shas are named beside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { makeGit, presenceOf, completenessOf } from "../../scripts/merge-presence-check.mjs";

// ── a throwaway repository with a "remote" ───────────────────────────────────────────────────────
//
// completenessOf() fetches a moved branch from `origin`, so the fixture needs a real remote rather
// than a stub: a local bare repo the working clone genuinely pushes to and fetches from. Anything
// less would test a mock of git instead of git.
function repo() {
  const root = mkdtempSync(join(tmpdir(), "merge-presence-"));
  const bare = join(root, "origin.git");
  const work = join(root, "work");
  execFileSync("git", ["init", "--bare", "-b", "main", bare]);
  execFileSync("git", ["clone", bare, work]);
  const g = makeGit(work);
  g("config", "user.email", "test@example.invalid");
  g("config", "user.name", "merge presence test");
  const commit = (file, body, message) => {
    writeFileSync(join(work, file), body);
    g("add", file);
    g("commit", "-m", message);
    return g("rev-parse", "HEAD").trim();
  };
  return { root, bare, work, g, commit, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const LONG_A = "the sanitizer peels an outer pair only when both ends carry the same quote character";
const LONG_B = "a run directory lives two levels down, under the executing agent's own workspace root";

test("#902 COMPLETENESS: a commit pushed after the merge is MOVED-AFTER-MERGE — the #895 shape", () => {
  const r = repo();
  try {
    r.commit("base.txt", "base\n", "base");
    r.g("push", "origin", "main");

    // The branch: one commit that gets merged, then one written AFTER the merge. That is
    // exactly — f6e889e merged at 18:45:01Z, 43c0b3e authored at 18:53:12Z and never on main.
    r.g("checkout", "-b", "feature");
    const merged = r.commit("feature.txt", `${LONG_A}\n`, "the merged commit");
    r.g("push", "origin", "feature");

    // Squash-merge onto main, exactly as gh does it: a NEW sha carrying the same content.
    r.g("checkout", "main");
    r.g("merge", "--squash", "feature");
    r.g("commit", "-m", "the merged commit (#1)");
    r.g("push", "origin", "main");

    // ...and only now does the author push the second commit.
    r.g("checkout", "feature");
    const dropped = r.commit("feature-arm.txt", `${LONG_B}\n`, "the arm that never landed");
    r.g("push", "origin", "feature");
    r.g("checkout", "main");

    const heads = new Map([["feature", r.g("rev-parse", "feature").trim()]]);
    const v = completenessOf(
      { headRefName: "feature", headRefOid: merged },
      heads, r.g, r.work, "2000-01-01T00:00:00Z", "main",
    );

    assert.equal(v.verdict, "MOVED-AFTER-MERGE",
      "a commit on the branch and not on main is the whole finding — this is what #895 was");
    assert.match(v.detail, new RegExp(dropped.slice(0, 8)),
      "the dropped commit is NAMED — a count with no sha is not something anybody can act on");
  } finally { r.cleanup(); }
});

test("#902 COMPLETENESS: the same commit carried by a LATER merge is RE-LANDED, not a drop — the #890 shape", () => {
  const r = repo();
  try {
    r.commit("base.txt", "base\n", "base");
    r.g("push", "origin", "main");

    r.g("checkout", "-b", "feature");
    const merged = r.commit("feature.txt", `${LONG_A}\n`, "the merged commit");
    r.g("push", "origin", "feature");
    r.g("checkout", "main");
    r.g("merge", "--squash", "feature");
    r.g("commit", "-m", "the merged commit (#1)");
    r.g("push", "origin", "main");

    r.g("checkout", "feature");
    r.commit("feature-arm.txt", `${LONG_B}\n`, "the arm written after the merge");
    r.g("push", "origin", "feature");

    // ...and a second pull request carries that same patch onto main under a different sha. This is
    //: dcdee41 on its branch, landed as bfd07f2 by. Subjects differ; the PATCH does not.
    r.g("checkout", "main");
    writeFileSync(join(r.work, "feature-arm.txt"), `${LONG_B}\n`);
    r.g("add", "feature-arm.txt");
    r.g("commit", "-m", "a different subject entirely (#2)");
    r.g("push", "origin", "main");

    const heads = new Map([["feature", r.g("rev-parse", "feature").trim()]]);
    const v = completenessOf(
      { headRefName: "feature", headRefOid: merged },
      heads, r.g, r.work, "2000-01-01T00:00:00Z", "main",
    );

    assert.equal(v.verdict, "RE-LANDED",
      "matched by patch-id, not by subject — the subjects deliberately do not match here");
  } finally { r.cleanup(); }
});

test("#902 COMPLETENESS: a deleted branch is UNVERIFIABLE — never a pass", () => {
  const r = repo();
  try {
    r.commit("base.txt", "base\n", "base");
    r.g("push", "origin", "main");
    // No entry in `heads` is exactly what a deleted branch looks like to this check.
    const v = completenessOf(
      { headRefName: "gone", headRefOid: "0".repeat(40) },
      new Map(), r.g, r.work, "2000-01-01T00:00:00Z", "main",
    );
    assert.equal(v.verdict, "UNVERIFIABLE",
      "the question cannot be answered, and this script exists because an absence took the success path");
  } finally { r.cleanup(); }
});

test("#902 PRESENCE: content still in the tree is PRESENT, and it is proved by CONTENT not ancestry", () => {
  const r = repo();
  try {
    r.commit("base.txt", "base\n", "base");
    const sha = r.commit("kept.txt", `${LONG_A}\n`, "adds a distinctive line");
    const v = presenceOf(sha, r.g, "HEAD");
    assert.equal(v.verdict, "PRESENT");
    assert.ok(v.markers.some((m) => m.marker === LONG_A),
      "the marker it proved the merge by is reported, so a reader can re-run the grep themselves");
  } finally { r.cleanup(); }
});

test("#902 PRESENCE: content a LATER commit removed is SUPERSEDED and names the commit that did it", () => {
  const r = repo();
  try {
    r.commit("base.txt", "base\n", "base");
    const sha = r.commit("kept.txt", `${LONG_A}\n`, "adds a distinctive line");
    // A later, deliberate retirement — the real shape is deleting bin/register-ledger-prune.mjs,
    // which the first cut of this script reported as six lost merges. It was six correct merges.
    writeFileSync(join(r.work, "kept.txt"), "rewritten by a later, deliberate change\n");
    r.g("add", "kept.txt");
    const later = r.commit("kept.txt", "rewritten by a later, deliberate change\n", "retires that line on purpose");

    const v = presenceOf(sha, r.g, "HEAD");
    assert.equal(v.verdict, "SUPERSEDED",
      "landed-and-since-retired is not lost work, and reporting it as lost is a false accusation");
    assert.match(v.detail, new RegExp(later.slice(0, 7)),
      "the superseding commit is NAMED — 'something else changed it' with no sha is an excuse");
  } finally { r.cleanup(); }
});

test("#902 PRESENCE: content that vanished with nothing having touched the file is MISSING", () => {
  const r = repo();
  try {
    r.commit("base.txt", "base\n", "base");
    const sha = r.commit("kept.txt", `${LONG_A}\n`, "adds a distinctive line");
    // Rewrite history so the line is gone and NO later commit touches the path — the one shape that
    // should wake somebody. `git log <sha>..HEAD -- kept.txt` finds nothing to blame.
    r.g("reset", "--hard", "HEAD~1");
    const v = presenceOf(sha, r.g, "HEAD");
    assert.equal(v.verdict, "MISSING",
      "gone, with nothing accounting for it, is the finding this whole script is for");
  } finally { r.cleanup(); }
});
