// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// bundle-freshness.mjs — is the portal bundle the one its sources would build?
//
// MOVED HERE FROM `bin/onboard.mjs` BECAUSE A SECOND READER NEEDS IT (tracker issue 160). `doctor` asked
// this question and answered it well; `/portal/health` asked a narrower one — present or absent — and
// answered `ui: "built", ok: true` over a bundle `doctor` had just called stale. Two surfaces, two
// answers, one of them wrong, and the operator has no reason to prefer either.
//
// The rule now has one home and both surfaces import it. A `driver/` module importing a `bin/` CLI to
// borrow a predicate is the wrong direction, which is why this file exists rather than an import.
//
// PURE where it matters: `bundleFreshness` decides from facts it is handed, so every route is drivable
// without building a portal. The three readers below touch the filesystem and are separated from it for
// that reason.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Which of the eight states this tree's bundle is in.
 *
 * ✕ ABSENT COMES FIRST. The route rows all describe a bundle that EXISTS; asking which route we are on
 * before asking whether there is anything to serve made a tree with neither bundle nor sources answer
 * "no sources, so the bundle ships with them" and print a tick over an empty directory.
 *
 * @returns {"no-sources"|"unbuilt"|"unversioned"|"guarded"|"tracked-unguarded"|"unmeasured"|"current"|"stale"}
 */
export function bundleFreshness({ srcPresent, distPresent, isGitCheckout, distTracked, distGated, distMtime, newestSrcMtime }) {
  if (!distPresent) return "unbuilt";
  if (!srcPresent) return "no-sources";
  if (!isGitCheckout) return "unversioned";
  if (distTracked) return distGated ? "guarded" : "tracked-unguarded";
  // A COULD-NOT-LOOK IS NOT A PASS, and it is not a stale bundle either. Ticking would be
  // absence-as-pass on the one branch this exists to answer; calling it stale would send an operator to
  // rebuild a bundle nobody has shown to be old.
  if (!(distMtime > 0) || !(newestSrcMtime > 0)) return "unmeasured";
  return newestSrcMtime > distMtime ? "stale" : "current";
}

/** Newest mtime under `dir`, or 0. Best-effort: an unreadable tree answers 0, and 0 makes no claim. */
export function newestMtimeUnder(dir, exists = existsSync) {
  if (!exists(dir)) return 0;
  let newest = 0;
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      try { newest = Math.max(newest, statSync(full).mtimeMs); } catch { /* raced or unreadable */ }
    }
  };
  walk(dir);
  return newest;
}

/**
 * Does a workflow IN THIS TREE rebuild the bundle and refuse on a difference?
 *
 * Measured by the gate's own refusal text, not by the presence of a file called `ci.yml`: a tree can
 * carry a workflow of that name doing something else entirely, and what the caller goes on to claim is
 * specifically that a difference would be caught. A missing directory answers false, which is the
 * exported tree's state and the correct answer for it.
 */
export function distGateInTree(repo) {
  const dir = join(repo, ".github", "workflows");
  let entries;
  try { entries = readdirSync(dir); } catch { return false; }
  for (const name of entries) {
    if (!/\.ya?ml$/.test(name)) continue;
    try {
      if (readFileSync(join(dir, name), "utf8").includes("portal-ui/dist does not match a fresh build")) return true;
    } catch { /* unreadable — it certifies nothing, so it is not the gate */ }
  }
  return false;
}

/** Is `repo` a git checkout, and is `rel` tracked in it? Two questions because they mean different things. */
export function gitStanding(rel, repo) {
  const git = (args) => {
    try { execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" }); return true; } catch { return false; }
  };
  if (!git(["rev-parse", "--is-inside-work-tree"])) return { isGitCheckout: false, tracked: false };
  return { isGitCheckout: true, tracked: git(["ls-files", "--error-unmatch", "--", rel]) };
}

/**
 * The verdict for a tree, read from disk. `doctor` and `/portal/health` both call this, so they cannot
 * disagree about what "stale" means.
 */
export function bundleVerdict({ repo, distDir, srcDir, present }) {
  const standing = gitStanding("portal-ui/dist", repo);
  const distPresent = present ?? existsSync(join(distDir, "index.html"));
  return bundleFreshness({
    srcPresent: existsSync(srcDir),
    distPresent,
    isGitCheckout: standing.isGitCheckout,
    distTracked: standing.tracked,
    distGated: distGateInTree(repo),
    distMtime: distPresent ? newestMtimeUnder(distDir) : 0,
    newestSrcMtime: newestMtimeUnder(srcDir),
  });
}

/**
 * What `/portal/health` says about the bundle, from that verdict.
 *
 * `ui` HAD TWO STATES, PRESENT AND ABSENT, and there was no third for *present and older than the
 * sources it was built from* — so health answered `built`, `ok: true`, over the exact tree `doctor`
 * refuses at rc 1. An operator following the documented upgrade got a green health check and the
 * previous screen.
 *
 * `ok: false` is set for `stale` and nothing else here. `missing` already has a louder signal — /portal
 * answers 503 — and widening `ok` is a change to what every monitor watching this endpoint does, which
 * is a decision rather than a fix.
 */
export function healthUi(verdict) {
  if (verdict === "unbuilt") return { ui: "missing", ok: true };
  if (verdict === "stale") return { ui: "stale", ok: false };
  // A verdict nobody could measure is not a claim that the bundle is good. It reads as unknown, and
  // leaves `ok` alone: a health check that flips to false because a directory could not be stat'd would
  // page somebody for a bundle that is probably fine.
  if (verdict === "unmeasured") return { ui: "unknown", ok: true };
  return { ui: "built", ok: true };
}
