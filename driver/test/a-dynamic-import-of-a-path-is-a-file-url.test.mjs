// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A dynamic import() of a FILESYSTEM PATH must go through pathToFileURL.
//
// `import("C:\\Users\\x\\clearotron\\driver\\publish\\report-registry.mjs")` is not a specifier the ESM
// loader accepts: on Windows a drive-letter path is rejected outright, and the demo crashed on the
// owner's own machine at the first such call. On POSIX the same code works by accident, because there
// an absolute path and a relative specifier are close enough to get away with it — which is exactly why
// this cannot be left to review to catch.
//
// ✕ A RELATIVE SPECIFIER IS NOT THE DEFECT AND IS NOT SWEPT. `import("../driver/profiles.mjs")` is a
// module specifier, is portable, and is correct as written. The defect is a computed absolute PATH, and
// the shape that builds one here is `join(...)`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { trackedFiles } from "../../shared/tracked-files.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const GUARD = "a dynamic import of a path is a file url";

test("no tracked .mjs hands a raw join() path to import()", (t) => {
  const all = trackedFiles(GUARD, { root: REPO, pathspec: ["*.mjs"] });
  // null means NO CHECKOUT to read the corpus from. That is a could-not-look and it is skipped LOUDLY
  // rather than passing on an empty list — a guard whose population is zero reports a clean tree.
  if (all === null) return t.skip("no tracked corpus in this tree — the guard could not look");
  // THE POPULATION IS ASSERTED, not assumed. A discovered set that came back empty would make every
  // assertion below vacuously true and this guard would pass on a tree it never read.
  assert.ok(all.length > 100, `the tracked .mjs corpus reads as ${all.length} files — too few to be the real tree`);

  // ✕ THIS FILE IS EXCLUDED FROM ITS OWN POPULATION, and the exclusion is the point rather than a
  // convenience. The needle it searches for necessarily appears in the line that searches for it and in
  // the message that reports it, so the guard flags itself. That is invisible until the file is
  // COMMITTED — `git ls-files` cannot see an untracked file — so it passes locally on the run that
  // writes it and fails in CI on the run that lands it. Excluded by path, which is checkable, rather
  // than by splitting the needle into pieces, which hides what the guard looks for from its reader.
  const SELF = "driver/test/a-dynamic-import-of-a-path-is-a-file-url.test.mjs";
  assert.ok(all.includes(SELF), "this guard's own file is not in the corpus — the exclusion below is aimed at nothing");

  const offenders = [];
  for (const rel of all) {
    if (rel === SELF) continue;
    let src;
    try { src = readFileSync(join(REPO, rel), "utf8"); } catch { continue; }
    // `import(join(` — the computed-path shape. `import(pathToFileURL(join(` does not match it.
    const lines = src.split("\n");
    lines.forEach((l, i) => { if (l.includes("import(join(")) offenders.push(`${rel}:${i + 1}`); });
  }
  assert.deepEqual(offenders, [],
    `these hand a raw filesystem path to import() and fail on Windows:\n  ${offenders.join("\n  ")}`);
});

test("the transformation this sweep applied is the one the loader accepts", () => {
  // The control, so the guard above is not asserting a spelling nobody checked. A file URL round-trips
  // to the same path, and the href is a string the loader takes.
  const p = join(REPO, "shared", "tracked-files.mjs");
  const href = pathToFileURL(p).href;
  assert.match(href, /^file:\/\//, "pathToFileURL must produce a file: URL, which is what import() accepts");
  assert.equal(fileURLToPath(href), p, "the URL must name the same file the path did");
});

test("importing by that specifier actually resolves a real module", async () => {
  // Drives it rather than asserting the string shape: the sweep is only worth anything if a module
  // imported this way loads.
  const mod = await import(pathToFileURL(join(REPO, "shared", "tracked-files.mjs")).href);
  assert.equal(typeof mod.trackedFiles, "function");
});
