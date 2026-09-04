#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// write-build-info.mjs — stamp the commit a tarball was packed from, so a packaged install can name
// the code it ran.
//
// WHY THIS EXISTS. `clearotron doctor` on a packaged install says "the engine directory is not a
// readable git checkout — this run's code cannot be named, which is not the same as it being fine".
// That message is honest and it is also the PERMANENT state of every registry install: there is no
// checkout, so there never will be a commit to read. A clearance whose code cannot be named is not one
// anyone can audit afterwards, and the packaged install is the one every real customer will have.
//
// `npm pack` does not stamp `gitHead` — measured, it is absent from the packed manifest — so the commit
// has to be written deliberately. `prepack` runs before the archive is built and the file it writes
// ships, which is what makes this the right hook rather than `prepublishOnly`.
//
// IT REFUSES RATHER THAN GUESSES. A tarball that cannot name its commit is the exact artefact this
// exists to prevent, so a pack that cannot read one does not produce a nameless archive — it stops.
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BUILD_INFO = "build-info.json";

/** The commit this tree is on, or null when there is no checkout to read it from. */
export function headCommit(root = ROOT, run = null) {
  const git = run ?? ((args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }));
  try {
    const sha = String(git(["rev-parse", "HEAD"])).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

/** The bytes to write. PURE, and deliberately carries no clock — a stamp that changed every pack would
 *  make two archives of the same tree differ, which is the property the sync stamp exists to protect. */
export function buildInfo(commit, version) {
  return `${JSON.stringify({ commit, version }, null, 2)}\n`;
}

export function main(root = ROOT, { run = null, write = writeFileSync, read = readFileSync } = {}) {
  const commit = headCommit(root, run);
  if (!commit) {
    console.error("write-build-info: cannot read a commit for this tree, so this pack would produce an");
    console.error("  archive that can never name the code it carries. That is the thing this stamp exists");
    console.error("  to prevent, so the pack stops here rather than shipping a nameless one.");
    return 1;
  }
  const version = JSON.parse(read(join(root, "package.json"), "utf8")).version;
  write(join(root, BUILD_INFO), buildInfo(commit, version));
  console.error(`write-build-info: ${BUILD_INFO} ← ${commit.slice(0, 8)} (v${version})`);
  return 0;
}

// THE ENTRY-POINT TEST GOES THROUGH shared/is-entrypoint.mjs, never a basename compare.
// `argv[1].endsWith("write-build-info.mjs")` was wrong twice over: through a symlink argv[1] keeps the
// path the caller typed while the module URL is resolved, so the two differ and `prepack` would write no
// build-info while exiting 0 — a tarball then names no commit and nothing reports that it did not.
// And a basename compare answers TRUE for any unrelated script of the same filename.
if (isEntrypoint(import.meta.url)) process.exit(main());
