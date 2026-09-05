// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// bundle-rebuild.mjs — rebuild the portal bundle when it is older than the sources it was built from.
//
// ── WHY THE PRODUCT DOES THIS RATHER THAN TELLING THE READER TO ─────────────────────────────────────
//
// Owner ruling, 2026-09-05: "this is not a question a user should ever face." A packaged install ships
// the built UI, so an npm install or upgrade replaces the bundle and the sources together and none of
// this can arise. Only a SOURCE checkout updated by a plain `git pull` can be stale — `portal-ui/dist`
// is untracked on the public tree, so a pull can never update it — and that reader ran the documented
// upgrade, it exited 0, nothing warned, and the portal then served the previous screen while reporting
// itself healthy.
//
// INSTALL.md tells a reader to rebuild "whenever you change anything under portal-ui/src", and that is
// right for someone editing their own tree. A PULL IS NOT THE READER CHANGING ANYTHING. They have no
// reason to look, which is what makes the silence expensive.
//
// ── IT REUSES THE ONE FRESHNESS PREDICATE, DELIBERATELY ─────────────────────────────────────────────
//
// `bundleVerdict` already decides what a usable bundle is, and `doctor` and `/portal/health` both read
// it. A second comparison here would be a second author for one fact, and the two would drift — which
// is the shape this repo keeps paying for. Only `stale` triggers a rebuild:
//
//   unbuilt      already handled loudly — /portal answers 503 naming the build command.
//   unmeasured   a could-not-look. Rebuilding on it would run a build because a directory could not be
//                stat'd, which is a confident action on no evidence.
//   tracked/…    the packaged and committed-bundle routes, where the bundle is not ours to rebuild.

import { bundleVerdict } from "./bundle-freshness.mjs";
import { join } from "node:path";

/**
 * Rebuild the bundle if — and only if — it is stale. Returns what happened, and never throws.
 *
 * `run` is injected so a test can drive every branch without spawning npm; the default is supplied by
 * the caller rather than imported here, keeping this module free of `node:child_process`.
 *
 * A FAILED REBUILD IS REPORTED AND DOES NOT STOP THE CALLER. A box that serves an old screen is worse
 * than one that serves a current screen, and better than one that will not start at all — the operator
 * needs the box up to fix whatever broke the build.
 */
export function rebuildIfStale({ repo, run, say = () => {}, distDir, srcDir } = {}) {
  // The path construction is inside the guard too: `join(null, …)` throws, and a caller with no repo
  // is a could-not-look like any other — not a crash in the middle of somebody's `start`.
  let verdict, dist, src;
  try {
    dist = distDir ?? join(repo, "portal-ui", "dist");
    src = srcDir ?? join(repo, "portal-ui", "src");
    verdict = bundleVerdict({ repo, distDir: dist, srcDir: src });
  }
  catch (e) { return { verdict: "unmeasured", rebuilt: false, ok: true, why: `the bundle could not be checked — ${e.message}` }; }

  if (verdict !== "stale") return { verdict, rebuilt: false, ok: true, why: null };

  say("  The portal bundle is older than the sources it was built from — rebuilding it.");
  let code;
  try { code = run("npm", ["run", "build:ui"]); }
  catch (e) { code = e?.status ?? 1; }
  if (code === 0) {
    say("  Portal bundle rebuilt.");
    return { verdict, rebuilt: true, ok: true, why: null };
  }
  // NAMED, NOT SWALLOWED. The reader is about to serve a screen that is not the one their sources
  // describe, and that is the whole failure this exists to prevent — so it is said in full.
  say(`  The portal bundle could not be rebuilt (npm run build:ui exited ${code}). The portal will `
    + `serve the PREVIOUS screen until that command succeeds — run it and read its output.`);
  return { verdict, rebuilt: false, ok: false, why: `npm run build:ui exited ${code}` };
}
