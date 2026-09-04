// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// driver-dir.mjs — where a run's `_driver/` is, decided once.
//
//. Measured on `origin/main` `8c6ed5e9`: **1123** sites across **221** files build this path by
// hand as `join(<base>, "_driver", …)`, and there was no accessor anywhere. Nineteen of those sites are
// product code that CREATES the directory; the rest read from it, and 211 more create it in fixtures.
//
// The state that made this indefensible rather than merely untidy: `driver/engine/deny-authority-write.mjs`
// — the hook whose entire job is policing writes into this subtree — computed the subtree's
// location by hand, exactly like every other caller. When the thing that guards a location does not
// share a definition with the things that create it, the location is not a decision anybody owns. It is
// a convention held in 1123 places, and a convention is only ever as strong as the next call site
// somebody adds without reading the other 1122. Nine were added in the day between filing this issue and
// fixing it.
//
// ── WHY CREATION AND READING ARE DIFFERENT POPULATIONS ────────────────────────────────────────────
//
// Creation is small (19), and it is where a decision other than "what is the path" has to live: the
// MODE. Every one of the nineteen was
//
//     mkdirSync(join(runDir, "_driver"), { recursive: true })
//
// with no mode argument at all, so the permission bits are whatever the process umask happens to give —
// 775 on a real run measured 2026-08-18, because the umask is 002. That is not a bug this module fixes.
// It is a decision that could not be TAKEN, because taking it meant nineteen edits that all had to agree
// and keep agreeing. Now it is one.
//
// Reading is large (~1100) and carries no second decision. Converting it is mechanical and belongs in
// its own change, where its guard can be total too.
//
// ── WHY (base, ...parts) AND NOT (runDir) ─────────────────────────────────────────────────────────
//
// The obvious narrow signature cannot express two of the nineteen, and an accessor that cannot express
// its own population needs an exception list — which would rebuild this issue's defect inside its fix:
//
//   · `driver/stage-freshness.mjs` creates a CHILD, `join(runDir, "_driver", STAMP_DIR)`.
//   · `driver/pipeline.mjs:15053` passes a shadow dispatch sandbox under `_experiments/`, not a run
//     directory. It is a run-dir-SHAPED base, which is why the parameter is `base` and not `runDir`.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────
//
// IT DOES NOT SET A MODE, and this change alters no behaviour on disk. Pinning 0o750 here in the same
// commit would be a semantic change riding inside a seam, and the seam is the part that has to be
// reviewable by reading nineteen call sites and agreeing they still mean what they meant. The mode is
// 's business, and when it is taken it is one line in this file.
//
// IT WOULD NOT RESTRAIN THE SEAT IF IT DID. The agent runs as the same account that owns these
// directories, so owner bits apply whatever the group bits say. A tighter mode removes GROUP write,
// which is worth having on a box with a shared pool group, and nothing more. Said here because a module
// named for a boundary invites the stronger reading.
//
// IT IS NOT `driverDirs`. `scripts/seat-retry-report.mjs` exports `driverDirs(root)`, which WALKS a tree
// to find every `_driver` beneath it. Discovery, not construction — a different concern that happens to
// share a noun, and the reason nothing here takes that name.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** The directory's name. The one place the string lives, so renaming it is an edit rather than a sweep. */
export const DRIVER_DIR = "_driver";

/**
 * The path to a run's `_driver/`, or to something inside it.
 *
 * @param {string} base   the run directory — or any run-dir-shaped base, such as an `_experiments/` sandbox
 * @param {...string} parts  optional path segments beneath it
 */
export function driverDir(base, ...parts) {
  return join(base, DRIVER_DIR, ...parts);
}

/**
 * The path to something inside `_driver/`, RELATIVE to a run directory rather than resolved against one.
 *
 * `driver/stages.mjs` is why this exists. The path registry declares ~29 artifacts as run-relative
 * fragments and resolves them later, so there is no base to give — and the registry, whose whole purpose
 * is that no artifact is reached by a literal, would otherwise have been the last population still
 * reaching this directory by one.
 */
export function driverRel(...parts) {
  return join(DRIVER_DIR, ...parts);
}

/**
 * Create a run's `_driver/` (or a directory inside it) and return the path.
 *
 * `recursive` is kept because every call site had it: the parent run directory may not exist yet, and a
 * second caller in the same run must not throw on an existing directory. It is also what makes the
 * nested form work — `ensureDriverDir(runDir, "stage-inputs")` creates `_driver/` on the way.
 */
export function ensureDriverDir(base, ...parts) {
  const dir = driverDir(base, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}
