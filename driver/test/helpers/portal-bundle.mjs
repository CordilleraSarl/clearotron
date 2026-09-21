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
  // AN ABSENT BUNDLE IS AN ABSENCE, AND DOCTOR ALREADY TREATS IT AS ONE. This helper exists for the
  // STALE bundle, which doctor reports with `problem` and exits 1 for — a misconfiguration the reader
  // has no other way to learn about. A bundle that is simply NOT THERE takes doctor's `unbuilt` branch
  // instead, which is `blocking`: named under "this install cannot do everything yet", and rc-neutral
  // by the exit contract in bin/onboard.mjs runCheck, where only `problems` and `inert` return 1.
  // So the twelve arms pass with no bundle at all, and there is nothing here to make current.
  //
  // IT IS ALSO THE UNIVERSAL CASE, which is what made this load-bearing. `portal-ui/dist` is untracked,
  // so it is absent on every fresh clone and every new worktree — CI included. Treating absent as
  // "needs building" sent every one of those runs into a build that scripts/test-run.mjs refuses by
  // design, and the refusal is fatal here, so three files failed at IMPORT and 101 assertions did not
  // run at all. Measured on beta-16 at b9c1433: 3 files, 0 pass, 3 fail, none of them about a bundle.
  if (distAt === 0) return "no bundle here — doctor reports that as an absence, which fails no arm";
  if (distAt >= newestUnder(src)) return "already current";
  const r = spawnSync("npm", ["run", "build:ui"], { cwd: repo, encoding: "utf8", timeout: 600_000 });
  if (r.status !== 0) {
    // NOT a silent skip: an arm that needed this and did not get it should fail saying why, rather than
    // fail later on a doctor verdict that reads as though the product were broken.
    throw new Error(`could not build the portal bundle, so a doctor arm would fail on the bundle rather `
      + `than on its own subject:\n${`${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-1200)}`);
  }
  return "built";
}
