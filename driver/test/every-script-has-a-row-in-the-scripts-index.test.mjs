// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// `scripts/` held 125 files and its README indexed 28, so nobody could tell a CI guard from a tool somebody runs or a
// finished one-off. The README now ends in one row per file saying how it runs. This holds the table to the folder:
// a file it does not list fails, a row naming a file the folder does not hold fails, and the two claims a reader can
// check against the tree, "CI" and "named nowhere", are checked against it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { publishedOf } from "../../shared/reference-guard-classes.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GUARD = "scripts-index";
const RUNS = /^(CI|by hand|by hand, `npm run [a-z:-]+`|npm, before every pack|one-off, named nowhere)$/;

/** The index table's rows: script → how it runs. */
function indexRows() {
  const readme = readFileSync(join(ROOT, "scripts", "README.md"), "utf8");
  const section = readme.split("\n## Every script, by how it runs\n")[1] ?? "";
  return new Map([...section.matchAll(/^\| `([^`]+)` \| ([^|]+?) \|$/gm)].map((m) => [m[1], m[2]]));
}

test("every file in scripts/ has one row in the index, and every row names a file there", (t) => {
  const tracked = trackedFiles(GUARD, { root: ROOT, pathspec: ["scripts"] });
  if (tracked === null) return t.skip(skipReason(GUARD));
  // The scripts this checkout publishes: a private overlay lays its own scripts into scripts/, and they are indexed where
  // they live, not here.
  const published = publishedOf(tracked, ROOT);
  assert.ok(!published.error, published.error);
  const files = published.files.filter((f) => f !== "scripts/README.md").map((f) => f.slice("scripts/".length)).sort();
  assert.ok(files.length > 100, `only ${files.length} scripts were listed, so this would pass on nothing`);
  const rows = indexRows();
  assert.deepEqual(files.filter((f) => !rows.has(f)), [], "these scripts have no row in scripts/README.md's index");
  assert.deepEqual([...rows.keys()].filter((f) => !files.includes(f)), [], "these index rows name a file scripts/ does not hold");
  for (const [f, runs] of rows) assert.match(runs, RUNS, `${f}: "${runs}" is not one of the index's kinds`);
});

test("a script the index says CI runs is run by a workflow, and one it says nothing names is named nowhere", (t) => {
  const tracked = trackedFiles(GUARD, { root: ROOT, pathspec: [".github", "."] });
  if (tracked === null) return t.skip(skipReason(GUARD));
  const workflows = tracked.filter((f) => /^\.github\/(workflows|actions)\//.test(f))
    .flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n")).filter((l) => !/^\s*#/.test(l)).join("\n");
  const npm = Object.entries(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {});
  const runByWorkflow = (f) => workflows.includes(`scripts/${f}`)
    || npm.some(([name, cmd]) => cmd.includes(f) && new RegExp(`npm (run )?(-s )?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(workflows));
  const rows = indexRows();
  const ci = [...rows].filter(([, r]) => r === "CI").map(([f]) => f);
  assert.ok(ci.length > 20, "the index marks almost nothing as CI, so this half would pass on nothing");
  assert.deepEqual(ci.filter((f) => !runByWorkflow(f)), [], "the index says CI runs these, and no workflow does");
  const sources = tracked.filter((f) => f !== "scripts/README.md" && f !== "driver/suite-census.json" && f !== "scripts/test-durations.json"
    && !/\.(png|jpg|jpeg|woff2|zip|gz|tgz)$/.test(f));
  for (const f of [...rows].filter(([, r]) => r === "one-off, named nowhere").map(([g]) => g)) {
    const named = sources.filter((p) => p !== `scripts/${f}` && readFileSync(join(ROOT, p), "utf8").includes(f));
    assert.deepEqual(named, [], `the index says nothing names ${f}, and these do`);
  }
});
