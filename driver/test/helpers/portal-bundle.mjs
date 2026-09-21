// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-bundle.mjs — make the checkout's portal bundle current, for arms that are not about the bundle.
//
// WHY THIS EXISTS. `doctor` reports a bundle older than the sources it was built from as a problem and
// exits 1, and it is right to: the product serves that stale screen without complaint and reports itself
// healthy, so nothing else would tell the reader. Twelve arms across three files run `doctor` or the
// setup check against the checkout and expect exit 0 for reasons that have nothing to do with the
// bundle. On any clone that was built once and then pulled, those twelve fail on every run, for a
// condition the arm is not testing.
//
// THE FIX IS HERE AND NOT IN `doctor`. Making the check tolerate staleness would remove a real
// protection from the product to make a test convenient. So the arms make the condition untrue instead,
// by building the bundle the way an operator would.
//
// The bundle's own behaviour is covered elsewhere, by the file that makes a bundle stale ON PURPOSE and
// requires doctor to say so. Nothing here weakens that: this only runs where the sources exist and the
// bundle is behind them, and it builds rather than back-dating anything.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Newest modification time anywhere under a directory, or 0 when it is not there. */
function newestUnder(dir) {
  let newest = 0;
  const walk = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory()) walk(f);
      else newest = Math.max(newest, statSync(f).mtimeMs);
    }
  };
  try { walk(dir); } catch { return 0; }
  return newest;
}

let done = false;

/**
 * Build the portal bundle if the checkout has sources and the bundle is behind them. Once per process.
 * Returns what it did, so an arm can say so rather than appear to hang.
 */
export function ensurePortalBundleIsCurrent({ repo = REPO } = {}) {
  if (done) return "already checked";
  done = true;
  const src = join(repo, "portal-ui", "src");
  const dist = join(repo, "portal-ui", "dist");
  if (!existsSync(src)) return "no sources — nothing can be stale against them";
  const distAt = newestUnder(dist);
  if (distAt !== 0 && distAt >= newestUnder(src)) return "already current";
  const r = spawnSync("npm", ["run", "build:ui"], { cwd: repo, encoding: "utf8", timeout: 600_000 });
  if (r.status !== 0) {
    // NOT a silent skip: an arm that needed this and did not get it should fail saying why, rather than
    // fail later on a doctor verdict that reads as though the product were broken.
    throw new Error(`could not build the portal bundle, so a doctor arm would fail on the bundle rather `
      + `than on its own subject:\n${`${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-1200)}`);
  }
  return "built";
}
