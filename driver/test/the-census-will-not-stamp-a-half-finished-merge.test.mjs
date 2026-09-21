// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { midOperationVerdict, operationsInProgress, MID_OPERATION_STATES } from "../../scripts/mint-suite-census.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── A TREE MID-MERGE IS NOT A POPULATION, AND THE MINT MUST SAY SO RATHER THAN COUNT IT ────────────
//
// Two ways a half-finished merge lies to the census, and the older guard sees only one. A path from the
// other parent is in the index and not in HEAD, so it is laid and refused by name. A file BOTH parents
// changed is in HEAD, so it is counted — and the thing counted holds conflict markers. Measured on a
// tree conflicted in one test file: 980 files read, "unchanged" printed, exit 0.

test("the verdict refuses a tree carrying a half-finished operation, and says which", () => {
  for (const [name, label] of MID_OPERATION_STATES) {
    const v = midOperationVerdict({ inProgress: [[name, label]] });
    assert.equal(v.refuse, true, `${name} did not stop the mint`);
    assert.match(v.message, new RegExp(label), `the refusal does not name what is in progress`);
    assert.match(v.message, /Finish the/, "the refusal does not say what to do about it");
  }
});

test("the verdict is silent on an ordinary tree", () => {
  // THE OTHER SIDE, and the one that matters for whether this guard survives. A refusal that fired on
  // an ordinary checkout would stop every legitimate re-stamp, and the file's own comment says a guard
  // that fires on the legitimate use is one somebody switches off.
  const v = midOperationVerdict({ inProgress: [] });
  assert.equal(v.refuse, false);
  assert.equal(v.message, null);
});

test("no dead knob: the mint consults the verdict, and before it counts anything", () => {
  // THE HALF THAT SILENTLY REVERTS. A correct verdict function nobody calls is the shape that has cost
  // this repo three fixes already — the branch is right, the path never reaches it, and every arm over
  // the function stays green. Position matters as much as presence: the refusal is worth nothing after
  // the counting it exists to prevent, so this asserts it is reached first.
  const src = readFileSync(join(HERE, "..", "..", "scripts", "mint-suite-census.mjs"), "utf8");
  const guard = src.indexOf("midOperationVerdict({ inProgress: operationsInProgress(");
  assert.ok(guard > 0, "mint-suite-census does not consult midOperationVerdict — the guard is unwired");
  const counts = src.indexOf("censusDisagreements(collectionFromManifests(");
  assert.ok(counts > 0, "the arm no longer knows where counting begins — repoint it");
  assert.ok(guard < counts, "the mid-merge refusal is reached after counting has already begun");
});

test("the reader finds a real merge in a real git directory, and finds nothing in a clean one", (t) => {
  // DRIVEN OVER GIT ITSELF rather than over a stubbed path. The reader asks git where its directory is
  // — which is not `<root>/.git` in a worktree, where every one of these branches is actually used —
  // so a version that guessed the path would pass a stubbed test and find nothing where it is run.
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), "census-merge-"));
    const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "arm@example.invalid");
    git("config", "user.name", "arm");
    const f = join(dir, "f.txt");
    writeFileSync(f, "base\n");
    git("add", "f.txt"); git("commit", "-qm", "base");

    assert.deepEqual(operationsInProgress(dir), [], "a clean tree reported an operation in progress");

    git("checkout", "-q", "-b", "side");
    writeFileSync(f, "side\n"); git("commit", "-qam", "side");
    git("checkout", "-q", "main");
    writeFileSync(f, "main\n"); git("commit", "-qam", "main");
    try { git("merge", "side"); } catch { /* the conflict is the point */ }

    // The premise: this really is the state the defect was measured in — half-finished, with markers.
    const gitDir = git("rev-parse", "--absolute-git-dir").trim();
    assert.ok(existsSync(join(gitDir, "MERGE_HEAD")), "the arm failed to produce a half-finished merge");

    const found = operationsInProgress(dir);
    assert.ok(found.length > 0, "a tree mid-merge reported nothing in progress");
    assert.equal(midOperationVerdict({ inProgress: found }).refuse, true);

    // AND IT CLEARS when the operation finishes, because a guard that latches is a guard that gets
    // switched off. This is the state the refusal tells the operator to reach.
    appendFileSync(f, "");
    writeFileSync(f, "resolved\n");
    git("add", "f.txt"); git("commit", "-qm", "merged");
    assert.deepEqual(operationsInProgress(dir), [], "the refusal outlived the merge that caused it");
  } catch (e) {
    if (/spawn|ENOENT|not found/i.test(String(e?.message)) && !/failed to produce|reported|outlived/.test(String(e?.message))) {
      t.skip(`git unavailable: ${e.message}`);
      return;
    }
    throw e;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});
