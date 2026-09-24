#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sarl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHAT A MERGE DID TO THE SHAPE OF THE TREE, which no other check here asks.
//
// Every gate in this directory reads CONTENT: is this citation resolvable, does this commit owe a release
// note, does the census match the tree, is this variable declared. A merge's damage is to the SHAPE — what
// it deleted, what it brought back, what there are now two of — and a tree can be damaged in all three ways
// while every content gate passes, because each of them asks only about files that are there.
//
// Measured on 2026-09-17, on a tree carrying 26 duplicated release notes: `citation-line-check`,
// `release-note-required`, `env-audit` and `mint-suite-census --check` all exited 0. The arm that caught it
// ran in CI, after the push.
//
// ── THE INCIDENT THIS IS BUILT FROM ──────────────────────────────────────────────────────────────────
//
// A branch was rebased locally while the remote still carried its original commit, so the published tip was
// merged back rather than force-pushed — right for the history and wrong for the tree. That tip's lineage
// predated a release, so the merge restored the release notes the cut had consumed. Each then existed in
// both `.changeset/` and `.changeset/pre/`, and the next cut would have republished text a reader had
// already been shown.
//
// The merge was checked at the time for the things a merge is usually checked for: no work lost, no change
// applied twice, every test name still present. Nobody asked what else it brought back.
//
// AND IT WEAKENED A TEST IN ANOTHER FILE. A guard being written that week failed to fail when its author
// planted a defect, because the duplication meant the code under test found what it needed at the first
// path and never reached the branch being driven. A shape defect does not only break its own guard; it
// silently changes what other tests reach. That is why this asks about the tree rather than about a file.
//
// ── WHAT IT REFUSES, AND THE ONE IT DELIBERATELY DOES NOT ────────────────────────────────────────────
//
// RESURRECTED — refused, and ONLY under the paths named in RESURRECTION_SCOPE. A file the merge added to
// the target that the target's own history had deleted.
//
// THE SCOPE IS THE WHOLE DESIGN, not a first cut somebody forgot to widen. Judged over the whole tree this
// check refuses `git revert`: reverting a commit that deleted a file re-adds it, and the target's history
// carries the deletion, which is this condition word for word. A revert is an honest act and one of the
// most valuable ones on this repository — so a guard that reds on it is a guard somebody switches off, and
// then it is not there for the case it was built for.
//
// So it runs where resurrection has no honest explanation. A release note consumed by a cut has been shown
// to readers already; nothing legitimate brings it back. That is a property of `.changeset/`, not of files
// in general, and the list says so rather than pretending to a generality it does not have.
//
// WIDENING IT NEEDS THE REVERT QUESTION ANSWERED FIRST. The durable discriminator is that a revert's diff
// is the inverse of the deleting commit's, not anything in its message, which can say whatever was typed.
// Until something computes that, more paths means more honest reds.
//
// TWO OF ONE NAME — refused. `.changeset/` and `.changeset/pre/` holding the same note. ONE pair, named
// here, not a framework for pairs: this is the only one anybody has been bitten by, and a general
// mechanism for a population of one is a mechanism whose other members are imaginary.
//
// REMOVED — reported, never refused. A merge that deletes from the branch it is merging into is worth a
// look and is often correct: the removal that FIXED the incident above was exactly this shape. A guard
// that reds on an honest deletion is a guard somebody switches off, so this one prints and exits 0.

import { execFileSync } from "node:child_process";
import { dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Run git and hand back stdout, or null when it fails.
 *
 * HOOKS OFF, ALWAYS. This runs git inside repositories the arms below create, and a `core.hooksPath` set
 * globally reaches into every one of them — which is how a suite ends up depending on whoever ran it last
 * having the right git config. Measured the hard way on this box, 2026-09-17: a global hooks path broke two
 * arms because the commit-message hook treats a repository with no origin as public, and a throwaway
 * repository has no origin either.
 */
export const gitIn = (repo) => (...args) => {
  try {
    return execFileSync("git", ["-c", "core.hooksPath=", "-C", repo, ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { return null; }
};

/** The lines of a `--name-only` listing, empties dropped. A null read is an empty list, never a throw. */
const lines = (out) => String(out ?? "").split("\n").map((s) => s.trim()).filter(Boolean);

/**
 * THE PAIRS THAT MAY NOT HOLD THE SAME NAME. A note in both places has its text republished by the next
 * cut — the reader is shown an announcement they were shown in the last release.
 *
 * Deliberately a list of one. See the header.
 */
export const UNIQUE_PAIRS = [
  { a: ".changeset", b: ".changeset/pre", why: "a note in both would have its text republished by the next cut" },
];

/**
 * WHERE A FILE COMING BACK HAS NO HONEST EXPLANATION. See the header: judged over the whole tree, the
 * resurrection question refuses `git revert`, which is why this is a list and not a wildcard.
 *
 * A release note the cut consumed has been shown to readers. There is no act that legitimately returns one,
 * so here — and only here — a file arriving back through a merge is a finding rather than a question.
 */
export const RESURRECTION_SCOPE = [".changeset/"];

/**
 * Is this commit a merge, and what are its parents?
 *
 * The FIRST parent is the branch being merged INTO, which is the thing every question below is asked
 * about: "what did this do to the target" only means something relative to what the target had.
 */
export function parentsOf(git, commit) {
  const out = git("rev-list", "--parents", "-n", "1", commit);
  if (!out) return { ok: false, parents: [], why: `could not read ${commit}` };
  const ids = out.split(/\s+/).filter(Boolean).slice(1);
  return { ok: true, parents: ids, why: null };
}

/**
 * The files a merge added to its first parent, and the ones it removed.
 *
 * `--diff-filter` on the two-dot form: what the target gained and lost by taking this merge. NOT the
 * three-dot form, which answers a question about the merge base and would report the branch's own additions
 * as though the merge had made them.
 */
export function addedAndRemoved(git, firstParent, commit) {
  return {
    added: lines(git("diff", "--name-only", "--diff-filter=A", firstParent, commit)),
    removed: lines(git("diff", "--name-only", "--diff-filter=D", firstParent, commit)),
  };
}

/**
 * Of the files this merge ADDED, the ones the target had previously DELETED — and the commit that deleted
 * each, so the finding is judgeable without a second command.
 *
 * A file the target never had is an ordinary addition and is not reported: a branch adding files is what a
 * branch is for. What has no innocent explanation is a file the target decided to remove arriving back
 * through a merge, because the branch did not delete it — its lineage was older than the deletion.
 */
export function resurrectedBy(git, firstParent, added, scope = RESURRECTION_SCOPE) {
  const out = [];
  for (const path of added) {
    if (!scope.some((p) => path.startsWith(p))) continue;
    const deletedIn = git("log", "--diff-filter=D", "--format=%h %s", "-1", firstParent, "--", path);
    if (deletedIn) out.push({ path, deletedIn });
  }
  return out;
}

/** Names present under BOTH halves of a pair. Compared by basename, which is what a cut reads. */
export function duplicatedAcross(git, commit, pairs = UNIQUE_PAIRS) {
  const at = (dir) => {
    const all = lines(git("ls-tree", "-r", "--name-only", commit, "--", `${dir}/`));
    return all.filter((f) => f.endsWith(".md"));
  };
  const out = [];
  for (const pair of pairs) {
    const inB = new Set(at(pair.b).map((f) => basename(f)));
    // The `a` half must EXCLUDE the `b` half, or every file under the nested directory counts as its own
    // duplicate and the check reports the whole of `pre/` against itself.
    const inA = at(pair.a).filter((f) => !f.startsWith(`${pair.b}/`)).map((f) => basename(f));
    const both = [...new Set(inA.filter((n) => inB.has(n)))].sort();
    if (both.length) out.push({ ...pair, names: both });
  }
  return out;
}

/**
 * The whole reading for one commit. Never throws: an unreadable commit is a stated could-not-look, because
 * a shape check that dies on a bad argument and exits non-zero is indistinguishable from one that found
 * something.
 */
export function mergeShape({ repo = HERE, commit = "HEAD", git = gitIn(repo) } = {}) {
  const { ok, parents, why } = parentsOf(git, commit);
  if (!ok) return { readable: false, why, isMerge: false, added: [], removed: [], resurrected: [], duplicated: [] };
  if (parents.length < 2) {
    return { readable: true, why: null, isMerge: false, added: [], removed: [], resurrected: [], duplicated: [] };
  }
  const { added, removed } = addedAndRemoved(git, parents[0], commit);
  return {
    readable: true, why: null, isMerge: true, firstParent: parents[0], added, removed,
    resurrected: resurrectedBy(git, parents[0], added),
    duplicated: duplicatedAcross(git, commit),
  };
}

/** The exit code a reading earns. Resurrection and a duplicated name refuse; a removal is reported. */
export function verdictOf(shape) {
  if (!shape.readable) return 2;
  return shape.resurrected.length || shape.duplicated.length ? 1 : 0;
}

/**
 * The repository and the commit a command line names. PURE, so an arm can hold it.
 *
 * The first version filtered out "the argument after --repo" as `i !== repoAt + 1`. With no --repo,
 * `repoAt` is -1 and that filter drops position 0 — the commit the reader named — so the check examined
 * HEAD instead, found no merge, and exited 0 saying nothing was examined: a clean answer about a commit
 * nobody asked about.
 */
export function parseArgs(args, here = HERE) {
  const repoAt = args.indexOf("--repo");
  const repo = repoAt >= 0 ? args[repoAt + 1] : here;
  const commit = args.filter((a, i) => !a.startsWith("--") && (repoAt < 0 || i !== repoAt + 1))[0] ?? "HEAD";
  return { repo, commit };
}

if (isEntrypoint(import.meta.url)) {
  const { repo, commit } = parseArgs(process.argv.slice(2));

  const shape = mergeShape({ repo, commit });
  const code = verdictOf(shape);

  if (!shape.readable) {
    console.error(`merge-shape-check: ${shape.why} — nothing was examined, which is not the same as nothing being wrong.`);
    process.exit(code);
  }
  if (!shape.isMerge) {
    console.log(`merge-shape-check: ${commit} is not a merge, so there is no merge to judge. Nothing examined.`);
    process.exit(0);
  }

  console.log(`merge-shape-check: ${commit} against its first parent ${shape.firstParent.slice(0, 8)}`);
  console.log(`  ${shape.added.length} file(s) added to the target, ${shape.removed.length} removed from it`);

  for (const r of shape.resurrected) {
    console.error(`\n  RESURRECTED  ${r.path}`);
    console.error(`    the target deleted this in ${r.deletedIn}, and this merge brings it back. The branch did not`);
    console.error(`    re-add it — its lineage is older than the deletion, so the file rode in on the merge.`);
  }
  for (const d of shape.duplicated) {
    console.error(`\n  TWO OF ${d.names.length} NAME(S)  ${d.a} and ${d.b}`);
    console.error(`    ${d.why}`);
    for (const n of d.names) console.error(`      ${n}`);
  }
  // Printed last and never fatal: this is the shape a correct fix also has.
  if (shape.removed.length) {
    console.log(`\n  removed from the target by this merge — read them, they are often correct:`);
    for (const p of shape.removed.slice(0, 40)) console.log(`      ${p}`);
    if (shape.removed.length > 40) console.log(`      … and ${shape.removed.length - 40} more`);
  }
  if (code === 0) console.log("\n  nothing resurrected and nothing duplicated.");
  process.exit(code);
}
