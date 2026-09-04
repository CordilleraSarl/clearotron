// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE DIRECTORY-README GUARD ADR-0004 DESCRIBED AND NOBODY BUILT.
//
// item 10's fourth bullet asked for it; three of that item's four bullets landed and the item was
// announced complete on the strength of the others. measured the absence — no test, no script, no
// npm script, no CI step — and fixed the RECORD, so ADR-0004 now says plainly that a new directory ships
// without a front door and nothing says so. This is the "nothing says so" half.
//
// ── WHERE THE RULE COMES FROM, AND WHY IT IS NOT A POLICY I INVENTED ───────────────────────────────
//
// Both halves are ADR-0004's own sentences, mechanised:
//
//   N = 4      "Same for a directory of one to four files whose parent already maps them."   (:23)
//   the test   "whether a stranger could arrive at the directory without passing its parent" (:24)
//
// A stranger cannot arrive at `providers/uspto-local/test/` without passing `providers/uspto-local/`.
// So that parent's README naming `test/` IS the stranger test, checked rather than applied by hand.
//
// ── WHY THE DECLARATION IS IN THE ANCESTOR AND NOT A MARKER FILE IN THE DIRECTORY ──────────────────
//
// asks for the exceptions to be accounted for AT THE DIRECTORY rather than in a list in this file,
// on 's `# external:` precedent — a declaration a reader meets where the decision was made beats a
// roster nobody opens. A marker file inside each directory was the obvious reading and it is the wrong
// one here, for two reasons this tree makes concrete:
//
//   · A FIXTURE CORPUS IS ONE ARTIFACT. `no-client-identifiers.test.mjs` promotes a whole capture
//     DIRECTORY the moment any file in it declares its matter — "a capture's README and its sibling
//     evidence are part of the same artifact", in its own words. A note explaining a capture joins the
//     capture and is swept with it.
//   · GENERATED DIRECTORIES OVERWRITE. `providers/jx-subclass/public/` and `examples/sample-run/run/`
//     are outputs. A stub inside one is either erased on the next build or silently stale.
//
// The ancestor README is where the decision actually lives, and — measured before this was written —
// where the tree had ALREADY put it: 15 of the 19 directories this guard flags were already named by an
// ancestor. The mechanism is not new; it was unchecked. Three one-line additions closed the other four.
//
// ── FAIL CLOSED, AND THIS IS THE PART THAT COULD HAVE GONE WRONG QUIETLY ───────────────────────────
//
// The walk stops at the NEAREST ancestor holding a README. If that README does not name the directory,
// the directory is UNACCOUNTED — the search does not continue to a grandparent. Walking on would let any
// directory be excused by a distant ancestor that happens to contain its name in prose, which is a guard
// that passes almost everything and reads exactly like one that passes because the tree is correct.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const GUARD = "directory front doors (#1716)";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** ADR-0004:23 — "a directory of one to four files whose parent already maps them" is not a unit. */
export const N = 4;

const isReadme = (base) => /^README(\.md)?$/i.test(base);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Directory → file count, and which directories hold a README. PURE. */
export function directoryIndex(paths) {
  const count = new Map(), readme = new Set();
  for (const p of paths ?? []) {
    const i = String(p).lastIndexOf("/");
    if (i < 0) continue;
    const dir = p.slice(0, i);
    count.set(dir, (count.get(dir) ?? 0) + 1);
    if (isReadme(p.slice(i + 1))) readme.add(dir);
  }
  return { count, readme };
}

/** Directories carrying MORE than n files and no README of their own. PURE. */
export function needsAFrontDoor(paths, n = N) {
  const { count, readme } = directoryIndex(paths);
  return [...count.keys()].filter((d) => count.get(d) > n && !readme.has(d)).sort();
}

/**
 * The README that accounts for `dir`, or null. PURE — `readReadme(path)` is injected.
 *
 * Names the directory by its path relative to that README, or by its first segment: a README saying
 * `fixtures/` accounts for `fixtures/owner-screen-2026-07-29-redacted` under it, because a stranger
 * reaches the second only through the first.
 */
export function accountedBy(dir, has, readReadme) {
  let cur = String(dir ?? "");
  while (cur.includes("/")) {
    const parent = cur.slice(0, cur.lastIndexOf("/"));
    const path = `${parent}/README.md`;
    if (has(path)) {
      const rel = dir.slice(parent.length + 1);
      const text = String(readReadme(path) ?? "");
      const seg = rel.split("/")[0];
      if (new RegExp(`(^|[^A-Za-z0-9_/-])${esc(rel)}($|[^A-Za-z0-9_-])`).test(text)) return path;
      if (new RegExp(`(^|[^A-Za-z0-9_/-])${esc(seg)}/?($|[^A-Za-z0-9_-])`).test(text)) return path;
      return null;   // the nearest front door is SILENT about it — do not walk past it
    }
    cur = parent;
  }
  return null;
}

test("#1716 every tracked directory over four files has a front door, or an ancestor that names it", (ctx) => {
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (tracked === null) return ctx.skip(skipReason(GUARD));
  const paths = nonEmpty(tracked, "trackedFiles(GUARD, { root: ROOT })");

  const has = (p) => paths.includes(p);
  const read = (p) => readFileSync(join(ROOT, p), "utf8");
  const flagged = needsAFrontDoor(paths);

  // A guard over an empty flagged set proves nothing, and this tree HAS such directories by design —
  // fixture corpora and generated output are the whole reason the exception mechanism exists.
  assert.ok(flagged.length > 0,
    "no directory over four files lacks a README — either every leaf grew one, or this guard stopped "
    + "seeing the tree. Check `git ls-files` before believing the green.");

  const unaccounted = flagged.filter((d) => !accountedBy(d, has, read));
  assert.deepEqual(unaccounted, [],
    "these directories are over four files, carry no README, and the nearest README above them does not "
    + "name them. Give the directory a front door, or name it in the README of the directory above — one "
    + "line saying what is in there and why it has none of its own:\n  " + unaccounted.join("\n  "));
});

test("#1716 the matcher fires in both directions, over planted trees", () => {
  const planted = [
    "pkg/README.md",
    "pkg/src/a.js", "pkg/src/b.js", "pkg/src/c.js", "pkg/src/d.js", "pkg/src/e.js",   // 5 > N
    "pkg/tiny/a.js", "pkg/tiny/b.js",                                                  // 2, under N
    "lone/a.js", "lone/b.js", "lone/c.js", "lone/d.js", "lone/e.js",                   // 5, no ancestor README
  ];
  assert.deepEqual(needsAFrontDoor(planted), ["lone", "pkg/src"], "the threshold or the README test moved");
  assert.deepEqual(needsAFrontDoor(planted, 5), ["lone", "pkg/src"].filter(() => false),
    "N is not being applied — five files must not exceed a threshold of five");

  const has = (p) => planted.includes(p);
  // NAMED by the ancestor → accounted.
  assert.equal(accountedBy("pkg/src", has, () => "`src/` holds the adapter."), "pkg/README.md");
  // SILENT ancestor → unaccounted. This is the fail-closed case.
  assert.equal(accountedBy("pkg/src", has, () => "Nothing about the layout here."), null);
  // NO ancestor README at all → unaccounted.
  assert.equal(accountedBy("lone", has, () => "irrelevant"), null);

  // A SEGMENT accounts for what is under it, because a stranger reaches the child through the parent.
  const nested = ["pkg/README.md", "pkg/fixtures/deep/a", "pkg/fixtures/deep/b"];
  assert.equal(accountedBy("pkg/fixtures/deep", (p) => nested.includes(p), () => "see `fixtures/`"), "pkg/README.md");

  // …and a substring is NOT a mention. `srcs` must not excuse `src`, or the guard passes on coincidence.
  assert.equal(accountedBy("pkg/src", has, () => "the srcs directory"), null);
  assert.equal(accountedBy("pkg/src", has, () => "unsrc"), null);
});

test("#1716 the walk STOPS at the nearest front door and does not shop for a distant one", () => {
  // The failure this prevents: `a/README.md` mentions `src` in prose about something else, `a/b/README.md`
  // is the real front door for `a/b/` and says nothing about `a/b/src/`. Walking past the nearest one
  // would excuse `a/b/src/` on the grandparent's unrelated sentence — and a guard that finds an excuse
  // somewhere up the tree passes almost everything, greenly.
  const paths = ["a/README.md", "a/b/README.md", "a/b/src/x", "a/b/src/y"];
  const has = (p) => paths.includes(p);
  const read = (p) => (p === "a/README.md" ? "the src layout is described elsewhere" : "b holds the thing");
  assert.equal(accountedBy("a/b/src", has, read), null,
    "the walk continued past `a/b/README.md` and took an excuse from `a/README.md`");

  // And when the NEAREST one does name it, that is the one returned — not the furthest.
  const read2 = (p) => (p === "a/b/README.md" ? "`src/` is the adapter" : "src src src");
  assert.equal(accountedBy("a/b/src", has, read2), "a/b/README.md");
});

test("#1716 N is the ADR's number, not a number this file chose", () => {
  const adr = readFileSync(join(ROOT, "docs", "decisions", "0004-documentation-structure.md"), "utf8");
  assert.equal(N, 4);
  assert.match(adr, /one to four files whose parent already maps them/,
    "ADR-0004 no longer states the range this guard's N is taken from. If the ADR moved, move N with it "
    + "and say so there — a threshold that outlives its stated reason is the shape #1494 was filed about.");
});
