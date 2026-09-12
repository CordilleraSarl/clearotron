// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO SAMPLE THAT CANNOT BE READ IS NAMED, AND COSTS NOTHING ELSE.
//
// Two plants in a published beta's own demo container (measured 2026-09-11). With one sample's directory
// unreadable, the demo published three reports, exited 0 and said "one per product" over a package that
// ships four. With one file inside a sample unreadable, the copy it publishes from threw an uncaught EACCES
// and no demo came up at all. Both cases are planted here, in a container of this test's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoInventory, prepareSample, publishContainer, seedDemoRuns } from "../demo-container.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The plants are file modes: root reads straight through them, and Windows has none to plant.
const SKIP = process.platform === "win32" ? "no POSIX file modes on Windows"
  : process.getuid?.() === 0 ? "root reads an unreadable file" : false;

/** Three frozen samples, both lanes, in a container of this test's own. */
function container() {
  const root = mkdtempSync(join(tmpdir(), "demo-container-"));
  for (const [name, entry] of [["clearance", "report.md"], ["knockout", "knockout-findings.json"], ["third", "report.md"]]) {
    mkdirSync(join(root, name, "run"), { recursive: true });
    writeFileSync(join(root, name, "meta.json"), JSON.stringify({ runId: `tmp-${name}` }));
    writeFileSync(join(root, name, "run", entry), "{}\n");
  }
  return root;
}

test("a sample whose directory cannot be read is counted and named, never dropped", { skip: SKIP }, () => {
  const root = container();
  const locked = join(root, "knockout");
  try {
    // THE CONTROL first: all three readable, all three usable.
    assert.deepEqual(demoInventory(root), { children: ["clearance", "knockout", "third"], unusable: [] });
    chmodSync(locked, 0o000);
    const inv = demoInventory(root);
    assert.deepEqual(inv.children, ["clearance", "third"]);
    assert.deepEqual(inv.unusable.map((u) => u.name), ["knockout"]);
    assert.match(inv.unusable[0].why, /its directory could not be read \(EACCES\)/);
    assert.equal(inv.children.length + inv.unusable.length, 3, "the count of samples is the container's, not the readable ones'");
  } finally { chmodSync(locked, 0o755); rmSync(root, { recursive: true, force: true }); }
});

test("a directory in the container that is not a frozen demo is named too, and a dot-directory is not a sample", () => {
  const root = container();
  try {
    mkdirSync(join(root, "half-copied", "run"), { recursive: true });
    mkdirSync(join(root, ".cache"));
    const inv = demoInventory(root);
    assert.deepEqual(inv.children, ["clearance", "knockout", "third"]);
    assert.deepEqual(inv.unusable.map((u) => u.name), ["half-copied"]);
    assert.match(inv.unusable[0].why, /not a frozen demo/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a sample holding a file that cannot be read fails alone, with its reason, and never throws", { skip: SKIP }, () => {
  const root = container();
  const tmp = mkdtempSync(join(tmpdir(), "demo-copies-"));
  const locked = join(root, "knockout", "run", "knockout-findings.json");
  try {
    chmodSync(locked, 0o000);
    // repoRoot is the container, so every sample is copied before it is published, as the shipped ones are.
    const results = ["clearance", "knockout", "third"].map((n) => prepareSample(join(root, n), { repoRoot: root, tmp }));
    assert.deepEqual(results.filter((r) => r.sample).map((r) => r.sample.name), ["clearance", "third"]);
    const failed = results.filter((r) => !r.sample);
    assert.deepEqual(failed.map((r) => r.name), ["knockout"]);
    assert.match(failed[0].why, /could not be copied to publish from \(EACCES\)/);
    for (const r of results.filter((x) => x.sample)) {
      assert.ok(!r.sample.publishFrom.startsWith(root), "a good sample was not copied out of the tracked container");
      assert.equal(r.sample.meta.runId, `tmp-${r.sample.name}`);
    }
  } finally { chmodSync(locked, 0o644); rmSync(root, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); }
});

test("a sample whose manifest is unreadable or names no run fails alone too", { skip: SKIP }, () => {
  const root = container();
  const manifest = join(root, "third", "meta.json");
  try {
    writeFileSync(join(root, "clearance", "meta.json"), JSON.stringify({ title: "no run id" }));
    chmodSync(manifest, 0o000);
    assert.match(prepareSample(join(root, "clearance"), {}).why, /names no runId/);
    assert.match(prepareSample(join(root, "third"), {}).why, /its meta\.json could not be read \(EACCES\)/);
    assert.equal(prepareSample(join(root, "knockout"), {}).sample.meta.runId, "tmp-knockout", "the control sample did not prepare");
  } finally { chmodSync(manifest, 0o644); rmSync(root, { recursive: true, force: true }); }
});

test("the launcher's copy of the container, and its runs, leave out the unreadable sample alone", { skip: SKIP }, () => {
  // The second publisher: `start --demo` seeds the archive from the whole container and lays each run in
  // the demo's workspace. One unreadable file failed the whole copy and emptied the archive.
  const root = container();
  const tmp = mkdtempSync(join(tmpdir(), "demo-copies-"));
  const work = mkdtempSync(join(tmpdir(), "demo-work-"));
  for (const n of ["clearance", "knockout", "third"])
    writeFileSync(join(root, n, "run", "status.json"), JSON.stringify({ runId: `tmp-${n}`, slug: n, codename: "c", date: "2026-09-01" }));
  const locked = join(root, "knockout", "run", "knockout-findings.json");
  try {
    chmodSync(locked, 0o000);
    const whole = publishContainer(root, { repoRoot: root, tmp });
    assert.ok(!whole.dir.startsWith(root), "the container was published from inside itself");
    assert.deepEqual(readdirSync(whole.dir).sort(), ["clearance", "third"]);
    assert.deepEqual(whole.unusable.map((u) => u.name), ["knockout"]);
    assert.match(whole.unusable[0].why, /could not be copied to publish from \(EACCES\)/);
    const runs = seedDemoRuns({ workspace: work, examplesDir: root });
    assert.deepEqual([...runs.seeded].sort(), ["tmp-clearance", "tmp-third"]);
    assert.deepEqual(runs.failed.map((f) => f.name), ["knockout"]);
    assert.match(runs.failed[0].why, /its run could not be copied \(EACCES\)/);
  } finally {
    chmodSync(locked, 0o644);
    for (const d of [root, tmp, work]) rmSync(d, { recursive: true, force: true });
  }
});

test("the launcher names each sample it left out", () => {
  const start = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  assert.match(start, /const container = publishContainer\(join\(REPO, "demo"\), \{ repoRoot: REPO \}\);/);
  assert.match(start, /examplesDir: container\.dir,/);
  assert.match(start, /for \(const u of \[\.\.\.container\.unusable, \.\.\.runs\.failed\]\)/);
  assert.match(start, /WARNING: demo sample \$\{name\} left out — \$\{why\}/);
  // The seeder's "all N examples this package ships" counts the copy, so it is not said over a left-out one.
  assert.match(start, /if \(seed\.skipped && !leftOut\.size\) say\(/, "the launcher calls a copy's count the package's");
});

test("the demo replays every sample it can, names the rest, and says one per product only when it is true", () => {
  const src = readFileSync(join(ROOT, "bin", "example.mjs"), "utf8");
  assert.match(src, /const inventory = demoInventory\(DEMO_ROOT\);/);
  assert.match(src, /const failures = ALL \? inventory\.unusable\.map/, "an unusable sample in the container is not counted as a failure");
  assert.match(src, /const r = prepareSample\(dir, \{ repoRoot: REPO \}\);[\s\S]*else if \(ALL\) failures\.push/);
  assert.doesNotMatch(src, /publishSource\(/, "a sample is still copied outside the per-sample catch");
  assert.match(src, /if \(results\.length > 1 && !failures\.length\) console\.log\(`[^`]*one per product/);
  assert.match(src, /\$\{failures\.length\} of \$\{shipped\} demo\(s\) could NOT be replayed/);
  assert.match(src, /process\.exitCode = 1;/, "a demo missing a sample must not exit 0");
});
