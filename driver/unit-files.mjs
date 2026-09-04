// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unit-files.mjs —: EVERY UNIT FILE THIS REPO SHIPS, wherever in the tree it sits.
//
// built the inventory that says which units a deployment is supposed to have. It looked in exactly
// one directory, `driver/systemd/`, in three places — the inventory's file accounting, the drift arm's
// tracked-file lookup, and the ratchet test. Four tracked unit files live outside it:
//
//   mcp-server/remote/client-mcp.service
//   mcp-server/remote/client-mcp-apikey.service
//   mcp-server/remote/trademark-artifacts-http.service
//   providers/oauth-mcp-bridge/systemd/courtlistener-mcp.service
//
// The cost was not a missing row. It was three inventory entries stating AS FACT that no tracked file
// existed, and giving as their reason that writing one would be dangerous — while the tracked template
// for each was already in the tree, one directory over. The guard could not notice, because the lookup
// that would have contradicted it only ever opened `driver/systemd/`. A false statement, inside the
// document whose whole purpose is that no unit is outside the guarantee by omission.
//
// ── WHY A WALK AND NOT `git ls-files` ────────────────────────────────────────────────────────────
//
// The health script runs this against a DEPLOYED CLONE, resolved from a live unit's WorkingDirectory.
// `git ls-files` would work there today and would stop working the first time someone deploys from an
// export rather than a clone — and the failure would be an empty list, which reads as "no unit files are
// tracked", which reads as a pass. A filesystem walk assumes nothing but a directory.
//
// The test cross-checks this walk against `git ls-files` anyway. Two independent mechanisms over one
// tree: a stray untracked unit file shows up in the walk and not in git, an over-eager prune shows up in
// git and not in the walk. Either way the difference is named.

import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Unit kinds systemd loads from a user unit directory. `.service`, `.timer` and `.path` are the ones
 *  this repo ships; the rest are here so a future unit kind is FOUND rather than silently skipped. */
export const UNIT_SUFFIXES = Object.freeze([
  ".service", ".timer", ".path", ".socket", ".target", ".mount", ".slice",
]);

/** Directories that never hold a unit this repo ships, and would make the walk cost real time.
 *  `node_modules` is the one that matters — a dependency shipping a `.service` file is not ours. */
export const PRUNED_DIRS = Object.freeze([
  "node_modules", ".git", "dist", "build", "coverage", ".cache", ".next", ".venv", "__pycache__",
]);

/** Deep enough for any tree this repo ships. Exceeding it is RECORDED, never a quiet truncation. */
export const MAX_DEPTH = 12;

const isUnit = (name) => UNIT_SUFFIXES.some((s) => name.endsWith(s));

/**
 * Walk `root` for every unit file this repo ships.
 *
 * @param {string} root — repo root. In the health script this is the DEPLOYED CLONE, not the checkout
 *   the script itself lives in: what a box runs must be compared against the commit that box deployed.
 * @returns {{files: string[], paths: Map<string,string[]>, collisions: string[], error: string|null}}
 *   files      — sorted unique BASENAMES. This is what the inventory accounts for, because systemd
 *                names a unit by its basename and the drift arm keys on the live fragment's basename.
 *   paths      — basename → every repo-relative path carrying it, so a reader can find the file.
 *   collisions — basenames carried by more than one path. See below.
 *   error      — the walk was INCOMPLETE: an unreadable root, an unreadable subtree, or a directory
 *                past MAX_DEPTH. Never an empty result standing in for a reason — see below.
 *
 * TWO ZEROES THAT ARE NOT PASSES, and both have burned this repo before:
 *
 * 1. `error` is set and `files` is empty when the root cannot be read. A caller that treats an empty
 *    list as "nothing unaccounted for" turns a wrong path into a green check. Callers must branch on
 *    `error` before they branch on `files.length`.
 * 2. `files` is empty with no error only when a tree genuinely ships no unit file. That is a real
 *    answer and a suspicious one for THIS repo, so callers say which of the two they got.
 *
 * An INCOMPLETE walk still returns what it found, and what it found is sound: a file present is
 * present. So a caller may act on the findings and must still say the walk was incomplete, because
 * the one thing a partial walk cannot support is a clean bill of health.
 *
 * COLLISIONS ARE REPORTED, NEVER RESOLVED. Two files with one basename make the drift lookup ambiguous,
 * and an ambiguous lookup that silently picks one is a comparison that never happened wearing the shape
 * of one that did — which is exactly the failure was built to end. Picking the first hit would make
 * the wrong answer quiet; naming the collision makes it loud.
 */
export function findUnitFiles(root) {
  const paths = new Map();
  const pruned = new Set(PRUNED_DIRS);
  const holes = [];

  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) {
      // A depth cap that returns quietly is a walk that stops finding files and says nothing — the
      // failure mode this module exists to refuse. It is recorded like any other hole.
      holes.push(`${relative(root, dir) || "."} is deeper than ${MAX_DEPTH} levels and was not walked`);
      return;
    }
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (e) {
      // A directory that cannot be read below the root is a HOLE in the walk, not a failure of it —
      // recorded so an unreadable subtree cannot masquerade as an absence of unit files.
      holes.push(`could not read ${relative(root, dir) || "."}: ${String(e?.message ?? e).slice(0, 120)}`);
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (pruned.has(e.name)) continue;
        walk(join(dir, e.name), depth + 1);
      } else if (e.isFile() && isUnit(e.name)) {
        const rel = relative(root, join(dir, e.name)).split(sep).join("/");
        if (!paths.has(e.name)) paths.set(e.name, []);
        paths.get(e.name).push(rel);
      }
    }
  };

  try { readdirSync(root); }
  catch (e) {
    return { files: [], paths: new Map(), collisions: [],
      error: `unit-file walk could not start at ${root}: ${String(e?.message ?? e).slice(0, 120)}` };
  }
  walk(root, 0);

  for (const list of paths.values()) list.sort();
  const files = [...paths.keys()].sort();
  const collisions = files.filter((f) => paths.get(f).length > 1);
  const error = holes.length
    ? `${holes[0]}${holes.length > 1 ? ` (and ${holes.length - 1} more subtree(s))` : ""}`
    : null;
  return { files, paths, collisions, error };
}

/** The repo-relative path a basename was found at, for a message a reader can act on. */
export function unitFilePath(walk, basename) {
  return walk?.paths?.get(basename)?.[0] ?? null;
}
