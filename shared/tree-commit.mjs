// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// tree-commit.mjs — the tree a path belongs to, and the commit that tree carries.
//
// A CHECKOUT ANSWERS THROUGH GIT; A PACKAGED INSTALL ANSWERS THROUGH ITS build-info.json. An install
// from the registry is a copy of the package, not a clone: there is no git there and there never will
// be, so asking git about it fails every time, and a deploy check that treats that failure as a fault
// reports every packaged box as broken. What a packaged install does carry is `build-info.json`, written
// by `prepack`, naming the commit it was packed from — read here through the one reader of that file.
//
// Git is asked first, and only its failure sends the question to the stamp: a checkout's HEAD is the
// truth about a checkout, and a stale stamp left in one must not outvote it.
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { packagedBuild } from "./packaged-build.mjs";

/** `git -C <repo> <args>`, keeping git's own sentence when it fails. */
export function gitTry(repo, ...args) {
  try {
    return { ok: true, out: execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), err: null };
  } catch (e) {
    return { ok: false, out: null, err: String(e?.stderr || e?.message || e).replace(/\s+/g, " ").trim().slice(0, 120) };
  }
}

/**
 * `{ root, head, source, why }` for the tree holding `path`. `source` is "git" or "build-info"; `root`
 * null means neither could say, and `why` names both failures. Readers are injected so an arm can drive
 * a packaged install without building one.
 */
export function treeOf(path, { git = gitTry, build = packagedBuild } = {}) {
  const top = git(path, "rev-parse", "--show-toplevel");
  if (top.ok) {
    const head = git(top.out, "rev-parse", "HEAD");
    return { root: top.out, head: head.ok ? head.out : null, source: "git",
      why: head.ok ? null : `git could not read HEAD in ${top.out}: ${head.err}` };
  }
  // WALK UP to the package root: a unit's WorkingDirectory or a running module sits somewhere inside
  // the installed package, and the stamp is at its top.
  for (let d = path; ; d = dirname(d)) {
    const b = build(d);
    if (b) return { root: d, head: b.commit, source: "build-info", why: null };
    if (dirname(d) === d) break;
  }
  return { root: null, head: null, source: null,
    why: `git could not read ${path} (${top.err}), and no build-info.json above it names a commit` };
}
