// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// portal-bundle.mjs — a repo root for `doctor` arms that are not about the portal bundle.
//
// WHY THIS EXISTS. `doctor` reports a bundle older than the sources it was built from as a problem and
// exits 1, and it is right to: the product serves that stale screen without complaint and reports itself
// healthy, so nothing else would tell the reader. Twelve arms across three files run `doctor` or the
// setup check and expect exit 0 for reasons that have nothing to do with the bundle. Run against the
// checkout, they failed on every run of any clone that was built once and then pulled.
//
// NEITHER BUILDING NOR WEAKENING THE CHECK. Building the bundle for them cannot work inside a suite run:
// scripts/test-run.mjs refuses `npm run build:ui` in the checkout by design, and a build would change
// `portal-ui/dist`, which the repo-writes guard fails a run for. Making doctor tolerate staleness would
// remove a real protection from the product to make a test convenient.
//
// SO THE ARMS RUN DOCTOR FROM A ROOT WHERE THE QUESTION DOES NOT ARISE. `hermeticInstallRoot` builds a
// temp repo root with `bin/` copied and the rest of THIS tree symlinked, and it has no `.git`. Doctor
// judges a bundle's age only in a git checkout, because `git pull` is the only way one goes stale; in a
// tree with no git it reports the bundle present and compares nothing (bundleFreshness, "unversioned").
// So a stale, current or absent bundle in the checkout gives these arms the same answer, and nothing
// here reads or writes `portal-ui/dist`.
//
// The bundle's own behaviour is covered elsewhere, by the file that makes a bundle stale ON PURPOSE in a
// git checkout and requires doctor to say so. Nothing here weakens that.
import { rmSync } from "node:fs";
import { hermeticInstallRoot } from "../hermetic-install-root.mjs";

let made = null;

/** The repo root the doctor arms run from: this tree's code, no `.git`, no `.env`. One per process. */
export function doctorRepoRoot() {
  if (made) return made.root;
  made = hermeticInstallRoot(null);
  process.once("exit", () => { try { rmSync(made.project, { recursive: true, force: true }); } catch { /* best effort */ } });
  return made.root;
}
