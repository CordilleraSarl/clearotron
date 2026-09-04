// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine-build.mjs — which build of the engine produced this artifact.
//
// Nothing stamped it before. `meta.json` and `report-data.json` recorded what the run found and when,
// and not one field said which code decided it — so "this finding is wrong" could not be joined to a
// diff, and a defect fixed in one release could not be told apart from one that was never present.
//
// Best-effort by construction: a deployment that is not a git checkout, or one whose git is missing,
// gets `null` and every caller keeps working. A stamp that could fail a publish would be worse than no
// stamp — the report is the product, the provenance is a convenience.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { packagedBuild } from "../shared/packaged-build.mjs";   // — the archive names its own commit

const HERE = dirname(fileURLToPath(import.meta.url));

// Resolved once per process. The engine cannot change under a running process without a restart, and a
// git spawn per published report is a cost with no matching information.
let cached;
// Which evidence answered: "git" | "build-info" | null. Resolved with `cached`, reset with it.
let source;

/**
 * The engine's commit sha, or null.
 *
 * `-C HERE` so it reads the checkout the DRIVER is running from, which on this VM is not the process
 * cwd: the portal, the runner and the MCP faces all start elsewhere. Reading cwd would report whichever
 * repo happened to launch the process, which is a wrong answer rather than a missing one.
 */
export function engineCommit() {
  if (cached !== undefined) return cached;
  let git = null;
  try {
    git = execFileSync("git", ["-C", HERE, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim() || null;
  } catch {
    git = null;
  }
  if (git) { cached = git; source = "git"; return cached; }

  // ── — A PACKAGED INSTALL IS NOT AN UNNAMEABLE ONE ─────────────────────────
  //
  // `git` is a CONTRIBUTOR's route; the archive is the product's, and it is the install most people
  // run. It ships `build-info.json` (written by `prepack`) naming the exact commit, and this function
  // used to answer `null` beside it — so every run from a tarball was unattributable to a commit by its
  // own artifacts, on both lanes. Measured 2026-08-31 on the owner's packaged production install, on
  // that install's first clearance run: `status.json` carried the `engineCommit` KEY with a null VALUE.
  //
  // Git stays FIRST and is never overridden. In a checkout the two can legitimately disagree — a
  // `build-info.json` left behind by an earlier pack names the commit that was packed, not the one
  // running now — and the live checkout is the better answer whenever there is one.
  const packed = packagedBuild(join(HERE, ".."));
  cached = packed ? packed.commit : null;
  source = packed ? "build-info" : null;
  return cached;
}

/**
 * WHICH evidence named the commit: `"git"`, `"build-info"`, or `null` when nothing could.
 *
 * A commit read from a shipped file is not a commit read from a live checkout — the file cannot say the
 * tree was clean — and a reader who cannot tell them apart cannot tell a stamped archive from a
 * verified tree. Every surface that prints the sha can print what stood behind it.
 */
export function engineCommitSource() { engineCommit(); return source; }

/** Test seam: forget the cached answer. */
export function resetEngineCommit() { cached = undefined; source = undefined; resetEngineCommitDate(); resetProvenance(); }

// ──: WHICH ENGINE A RUN LOADED, WRITTEN AT ITS START ────────────────────────────────────────
//
// `engineCommit` above has stamped the sha into the POOL COPY since — `meta.json`,
// `report-data.json`, `/portal/health`. That is real and it is not enough, and the difference is a
// population rather than a field:
//
//   · it is written at PUBLISH, so a run that FAILED or was aborted carries it nowhere;
//   · the pool copy is not the run dir, so the ARCHIVED run dir is unattributable on its own;
//   · a sha alone cannot say the tree was dirty, and on a test box a hand-edited engine is exactly
//     what a green run is most likely to have been produced by.
//
// So attribution has been a reflog reconstruction: join a checkout's reflog against each run's
// `startedAt`. That reconstruction expires with the reflog, cannot survive a re-clone, is wrong for
// every run made while the checkout sat detached, and mixes a local-time reflog against UTC stamps.
// It decided three certifications in one morning (,) and produced two near-miss
// wrong rulings in two days.
//
// A SIBLING, NOT A WIDER RETURN TYPE. `engineCommit()` keeps its bare-string contract exactly:
// 's guard pins its import line by regex AND pins the literal `engineCommit: engineCommit` in
// the publisher, four consumers read the string, and `scripts/freeze-example-run.mjs` asserts in prose
// that it "is cached to one value and cannot differ between the two". Widening it would break all of
// that to add a field only one new caller wants.
//
// THE SHAPE IS `classifySkillsStore`'s, DELIBERATELY. That function answers the same question one
// repository over — can anybody reproduce the tree this run was rated under — and it earned two rules
// worth copying rather than re-deriving: "could-not-determine is not a pass" (a third outcome,
// `blocked`, distinct from clean and dirty), and untracked files COUNT as dirt, because
// `--untracked-files=no` hides precisely the hand-dropped file this is for.
let provenance;

/** Test seam: forget the cached provenance. */
export function resetProvenance() { provenance = undefined; }

let commitAt;

/** Test seam: forget the cached commit date. */
export function resetEngineCommitDate() { commitAt = undefined; }

/**
 * WHEN the deployed commit landed —.
 *
 * `/portal/health` answered `ok:true` beside a bare sha, and on production that sha was 101 commits
 * behind `origin/main`. Production being behind main is CORRECT — it ships when the owner asks — so
 * staleness was never the defect. The defect is that the payload gave a reader no way to tell an
 * intentionally pinned release from a deploy that silently stopped, and the rule that would catch the
 * second ("check the deployed line by ancestry, never by clock") is exactly the rule a green tick
 * talks people out of running.
 *
 * A DATE, AND NOT THE DISTANCE FROM `main` THE ISSUE SUGGESTED. Measured on production 2026-08-22,
 * that suggestion inverts: a health probe must not touch the network, so the only `origin/main` it can
 * read is the ref the deploy's own `pull --ff-only` wrote — which equals HEAD by construction. The
 * checkout reported `HEAD..origin/main = 0` while the true distance was 101. `behind_main: 0` on a
 * stale release is strictly worse than the bare sha, because it actively asserts currency. The arm
 * `a distance measured from a local ref reads zero on the stalest instance` pins that, so nobody
 * re-derives it.
 *
 * `%cI` and not `%aI`: committer date is when the commit landed on this line. Author date can predate
 * a merge by days, which answers a question about the patch rather than about the deployment.
 *
 * Same cache and the same 2s bound as `engineCommit()`, and null off a git checkout for the same
 * reason — a provenance stamp never breaks a health probe.
 */
export function engineCommitDate() {
  if (commitAt !== undefined) return commitAt;
  const r = git(HERE, ["log", "-1", "--format=%cI"]);
  commitAt = r.ok && r.out ? r.out : null;
  return commitAt;
}

const git = (root, args) => {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
    });
    return { ok: true, out: String(out).trim() };
  } catch (e) {
    return { ok: false, out: "", why: e?.code === "ENOENT" ? "git is not on PATH" : String(e?.message ?? e).slice(0, 120) };
  }
};

/**
 * The engine checkout's identity, three-valued.
 *
 * @returns {{outcome: "clean"|"dirty"|"blocked", engineHead: string|null, engineBranch: string|null,
 *            engineDirt: string[], detail: string}}
 *
 * `engineHead` and not `head`: `run.jsonl` already carries a `head`, and it is the DOCTRINE STORE's
 * (pipeline.mjs's `skills-store` event). Two commits of two different repositories under one key is
 * the confusion this issue was filed about, so the key names its repository.
 *
 * Resolved once per process, like the sha above and for the same reason — the engine cannot change
 * under a running process. A RESUME re-enters a new process and re-measures, which is the correct
 * behaviour: a resumed segment genuinely can load different code from the segment that started.
 */
export function engineProvenance() {
  if (provenance === undefined) provenance = classifyEngineCheckout(HERE);
  return provenance;
}

/**
 * The classifier, over an EXPLICIT root — the split `skills-store-provenance.mjs` already uses
 * (`classifySkillsStore` beside `preflightSkillsStore`), and for the same two reasons.
 *
 * A test can drive it over a real temp checkout without writing a probe file into the tree it is
 * measuring. That is not a hypothetical: the first version of this took no root, the test copied this
 * module into the repo under test to move `HERE`, and the copy itself registered as untracked dirt —
 * the arm asserting "clean" measured its own instrument and failed. Injecting the root removes the
 * instrument from the sample.
 *
 * And callers still cannot get it wrong: `engineProvenance()` takes no argument, so nobody passes
 * `process.cwd()` and reports whichever repository happened to launch the process — the mistake the
 * note on `engineCommit()` above exists to prevent.
 */
export function classifyEngineCheckout(root) {
  const blocked = (detail) => ({ outcome: "blocked", engineHead: null, engineBranch: null, engineDirt: [], detail });

  const head = git(root, ["rev-parse", "HEAD"]);
  if (!head.ok || !head.out) {
    // — ask the archive before giving up. The warning below is the honest answer
    // only when NEITHER source can name the code; firing it beside a build-info.json that says exactly
    // which commit this is was the defect. A packaged install cannot be asked whether its tree is dirty
    // — there is no tree — so this is its own outcome and never `clean`: the sha is attested by the
    // archive, and that is a different and weaker claim than a verified working tree.
    const packed = packagedBuild(join(root, ".."));
    if (packed) return { outcome: "packaged", engineHead: packed.commit, engineBranch: null, engineDirt: [],
      detail: `packaged install of ${packed.commit.slice(0, 8)}${packed.version ? ` (v${packed.version})` : ""}, `
        + `named from the archive's own build-info.json rather than from a checkout — there is no working `
        + `tree here to be clean or dirty` };
    return blocked(`the engine directory is neither a readable git checkout (${head.why || "rev-parse produced nothing"}) `
      + `nor a packaged install carrying build-info.json — this run's code cannot be named, which is not `
      + `the same as it being fine`);
  }
  const branchRes = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchRes.ok && branchRes.out !== "HEAD" ? branchRes.out : null;

  // Whole-checkout dirt, unlike the doctrine store's path-scoped question: there is no subtree here
  // that "the engine" means less than all of. Untracked included — see the note above.
  const status = git(root, ["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) {
    return blocked(`HEAD is ${head.out.slice(0, 8)} but the working tree cannot be read (${status.why}) — `
      + `reporting the sha alone would state a commit this run may not have run`);
  }
  const dirt = status.out ? status.out.split("\n").filter(Boolean).slice(0, 20) : [];
  return {
    outcome: dirt.length ? "dirty" : "clean",
    engineHead: head.out,
    engineBranch: branch,
    engineDirt: dirt,
    detail: dirt.length
      ? `${dirt.length}${dirt.length === 20 ? "+" : ""} uncommitted change(s): this run did NOT execute ${head.out.slice(0, 8)} as committed`
      : `${branch ? `on ${branch}` : "detached"} at ${head.out.slice(0, 8)}, working tree clean`,
  };
}

