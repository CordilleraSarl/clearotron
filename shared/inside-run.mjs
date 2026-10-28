// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// inside-run.mjs — is a path a tool was handed inside THIS run's folder, where it really is?
//
// A tool that takes a path served whatever the account could open. Artifact search refused an absolute path and `..`,
// and still followed a link placed inside the run folder to wherever it pointed; the grid tools took a spec in any
// run's folder; the register tools read a plan and wrote a band at any path. A run may read nothing from another run,
// so a tool now resolves the path to its real location, links and `..` included, and serves it only when that
// location is inside the run's own real folder.
//
// A path not written yet is judged by its nearest folder that exists, plus the names below it, none of which may be
// `..`. A run folder that cannot be resolved holds nothing.
//
// A pure leaf: node:fs and node:path only, so every tool server can import it.
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** The real location of `p`, or of its nearest existing folder plus the names below it; null when neither resolves. */
function realLocation(p) {
  const rest = [];
  let at = resolve(p);
  for (;;) {
    try { return join(realpathSync(at), ...rest.reverse()); }
    catch (e) {
      if (e?.code !== "ENOENT" && e?.code !== "ENOTDIR") return null;
      // A link whose target is missing is not a name still to be written: a write through it lands where it points.
      try { lstatSync(at); return null; } catch { /* nothing at all is there */ }
      const up = dirname(at);
      if (up === at) return null;
      rest.push(basename(at));
      at = up;
    }
  }
}

/**
 * Where `p` really is relative to the run folder `runDir` — a relative path that never starts with `..` — or null when
 * it is outside the run, or either cannot be resolved. "" is the run folder itself. PURE but for the reads of the disk.
 */
export function pathInRun(runDir, p) {
  if (typeof runDir !== "string" || !runDir || typeof p !== "string" || !p) return null;
  let root;
  try { root = realpathSync(runDir); } catch { return null; }
  const real = realLocation(isAbsolute(p) ? p : join(runDir, p));
  if (!real) return null;
  const rel = relative(root, real);
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel;
}

/** True when `p` is really inside the run folder `runDir`. */
export const insideRun = (runDir, p) => pathInRun(runDir, p) !== null;
