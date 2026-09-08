// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The command that reports this suite green must have run it, or say what it did not run.
//
// EVERY ARM BUILDS ITS OWN TREE. `plan()` takes a root for exactly this reason: the shipped manifest
// is one arrangement of workspaces, and the interesting states — a workspace with no scripts block, a
// corpus that stopped reaching one — are states this repository is not in and should never be put in
// to test them. The suite runs files in parallel, so nothing here touches a shared path.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { plan, providerTestFiles, COVERED_ELSEWHERE } from "../../scripts/test-full.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** A throwaway tree: workspaces as named, provider directories as named. */
function treeWith({ workspaces = [], scripts = {}, providers = {} }) {
  const root = mkdtempSync(join(tmpdir(), "test-full-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces }, null, 2));
  for (const ws of workspaces) {
    mkdirSync(join(root, ws), { recursive: true });
    const body = scripts[ws] === undefined ? {} : { scripts: scripts[ws] };
    writeFileSync(join(root, ws, "package.json"), JSON.stringify({ name: ws, ...body }, null, 2));
  }
  for (const [dir, files] of Object.entries(providers)) {
    mkdirSync(join(root, "providers", dir, "test"), { recursive: true });
    for (const f of files) writeFileSync(join(root, "providers", dir, "test", f), "// planted\n");
  }
  return root;
}

test("a declared workspace with no `test:full` script FAILS the command rather than being skipped", () => {
  // THE PLANT THE ISSUE ASKED FOR: a workspace carrying no scripts block at all. Under
  // `--workspaces --if-present` this exited 0 and said nothing.
  const root = treeWith({ workspaces: ["pkg-a", "pkg-b"], scripts: { "pkg-a": { "test:full": "true" } } });
  try {
    const { faults, corpora } = plan(root);
    assert.equal(faults.length, 1, "the workspace with no script is one fault");
    assert.match(faults[0], /pkg-b/);
    assert.match(faults[0], /defines no `test:full`/);
    // AND THE OTHER ONE IS STILL PLANNED. A refusal that also lost the workspaces it could run
    // would pass this arm's first half while being useless.
    assert.ok(corpora.some((c) => c.name === "pkg-a"), "the healthy workspace is still a corpus");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a workspace whose tests another corpus runs is COVERED, and the coverage is checked, not believed", () => {
  const root = treeWith({
    workspaces: ["providers/oauth-mcp-bridge"],
    providers: { "oauth-mcp-bridge": ["a.test.mjs", "b.test.mjs"], other: ["c.test.mjs"] },
  });
  try {
    const { faults, corpora } = plan(root);
    assert.deepEqual(faults, [], "a covered workspace is not a fault");
    const covered = corpora.find((c) => c.kind === "covered");
    assert.equal(covered.name, "providers/oauth-mcp-bridge");
    assert.equal(covered.reaches, 2);
    assert.equal(covered.hasTests, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the exemption FAILS when the covering corpus stops reaching the workspace", () => {
  // THE PLANT THAT MAKES THE EXEMPTION SAFE TO HAVE. Somebody narrows the provider file list — a
  // skip entry, a changed directory filter, a tightened suffix — and the two files this workspace
  // owns stop running with nothing red anywhere. Driven by handing `plan` the narrowed list, because
  // reading both sides from the same directory is a comparison that cannot fail.
  const root = treeWith({
    workspaces: ["providers/oauth-mcp-bridge"],
    providers: { "oauth-mcp-bridge": ["a.test.mjs", "b.test.mjs"], other: ["c.test.mjs"] },
  });
  try {
    // CONTROL FIRST, in the same tree: with the real list the claim holds.
    assert.deepEqual(plan(root).faults, [], "unnarrowed, the exemption is true");

    const narrowed = providerTestFiles(root).filter((f) => !f.includes("oauth-mcp-bridge"));
    const { faults } = plan(root, { providerFiles: narrowed });
    assert.equal(faults.length, 1, "a corpus that no longer reaches the workspace is a fault");
    assert.match(faults[0], /reaches 0 of its 2 test file\(s\)/);
    assert.match(faults[0], /no longer true/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the exemption FAILS when the covered workspace has no tests of its own", () => {
  // THE VACUOUS PASS, REFUSED. An intersection with an empty set is empty, so a check that only
  // asked \"is the corpus missing any of them\" would report a workspace that lost every test as
  // perfectly covered — an arm that can never fail dressed as coverage.
  const root = treeWith({
    workspaces: ["providers/oauth-mcp-bridge"],
    providers: { other: ["c.test.mjs"] },
  });
  try {
    const { faults } = plan(root);
    assert.equal(faults.length, 1);
    assert.match(faults[0], /no test files of its own/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the population is discovered from the manifest, so a new workspace is covered by construction", () => {
  const root = treeWith({ workspaces: ["a", "b", "c"], scripts: {
    a: { "test:full": "true" }, b: { "test:full": "true" }, c: { "test:full": "true" } } });
  try {
    const { faults, corpora } = plan(root);
    assert.deepEqual(faults, []);
    for (const n of ["a", "b", "c"]) assert.ok(corpora.some((x) => x.name === n), `${n} is planned`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the provider file list is deduplicated, and reaches every provider directory that has tests", () => {
  const files = providerTestFiles(REPO);
  assert.equal(new Set(files).size, files.length, "no path appears twice");
  assert.ok(files.length > 30, `expected the real corpus, got ${files.length}`);
  // THE SHAPE THE OLD SHELL FORM HAD. It listed `_shared` explicitly and then again through the
  // wildcard. Measured before it was called a defect — the test runner runs a repeated path once —
  // but a list built here should not depend on that.
  assert.ok(files.some((f) => f.startsWith("providers/_shared/")), "the shared directory is reached");
});

test("this repository's own plan has no faults, and names the workspace it does not run itself", () => {
  const { faults, corpora } = plan(REPO);
  assert.deepEqual(faults, [], `the shipped manifest should be accountable: ${faults.join("; ")}`);
  const covered = corpora.filter((c) => c.kind === "covered");
  assert.equal(covered.length, COVERED_ELSEWHERE.length);
  for (const c of covered) {
    assert.ok(c.hasTests > 0, `${c.name} is recorded as covered and has tests`);
    assert.equal(c.reaches, c.hasTests, `${c.name}'s covering corpus reaches all of them`);
    assert.ok(c.cover.why.length > 40, "the reason is written, not a placeholder");
  }
});

test("the command names every corpus on stdout, and says which one it did not run itself", () => {
  // DRIVEN AT THE DOOR, not through the exported function: the summary is the deliverable and it is
  // printed by main(), which the arms above never reach.
  const out = execFileSync("node", ["scripts/test-full.mjs", "--list"], { cwd: REPO, encoding: "utf8" });
  for (const name of ["driver", "mcp-server", "portal-ui", "providers"]) {
    assert.match(out, new RegExp(`^\\s*${name.replace("/", "\\/")}:`, "m"), `${name} is named`);
  }
  assert.match(out, /covered by the providers corpus/);
});

// ── THE OTHER HALF OF "A COMMAND THAT REPORTS GREEN MUST HAVE LOOKED" ────────────────────────────
//
// Same defect, different corpus: scripts/ holds four minters writing committed derived files, and CI
// ran exactly one of them. These arms sit here rather than in a file of their own because the property
// is the one this file already exists for.
//
// EVERY OUTCOME IS DRIVEN OVER THROWAWAY MINTERS. Dirtying a real generated file and restoring it
// would be a shared-file mutation, and the runner runs test files in parallel — that is a race that
// reddens somebody else's arm, not a test.

/** A directory of stub minters, each exiting with the code its name gives. */
function mintersExiting(codes) {
  const dir = mkdtempSync(join(tmpdir(), "minters-"));
  codes.forEach((code, i) => {
    writeFileSync(join(dir, `mint-stub-${i}.mjs`),
      `console.log("stub ${i} says ${code}");\nprocess.exit(${code});\n`);
  });
  return dir;
}

test("the generated-file check discovers its minters rather than naming them", async () => {
  const { minters } = await import("../../scripts/generated-files-are-current.mjs");
  const found = minters();
  assert.ok(found.length >= 4, `expected the real minters, got ${found.join(", ")}`);
  for (const m of found) assert.match(m, /^mint-.*\.mjs$/, "only minters are collected");
});

test("an empty population is a fault, not a pass over nothing", async () => {
  const { checkAll, minters } = await import("../../scripts/generated-files-are-current.mjs");
  const empty = mkdtempSync(join(tmpdir(), "no-minters-"));
  try {
    assert.deepEqual(minters(empty), []);
    // THE ASSERTION THAT MATTERS: not "it returned nothing" but "it says so". A check reporting
    // all-current over zero members is the exact shape this whole file refuses.
    assert.equal(checkAll({ dir: empty, log: () => {} }).empty, true);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test("a stale generated file is reported as stale, and a minter that cannot look is kept apart from it", async () => {
  const { checkAll } = await import("../../scripts/generated-files-are-current.mjs");
  const dir = mintersExiting([0, 1, 2]);
  try {
    const r = checkAll({ dir, log: () => {} });
    assert.equal(r.empty, false);
    assert.equal(r.found.length, 3);
    assert.equal(r.stale.length, 1, "exit 1 is stale");
    assert.equal(r.unreadable.length, 1, "exit 2 is a could-not-look, counted separately");
    // The two are different remedies — re-mint versus fix the minter — so a check that merged them
    // would send the reader to do the wrong one.
    assert.match(r.stale[0].m, /mint-stub-1/);
    assert.match(r.unreadable[0].m, /mint-stub-2/);
    assert.match(r.stale[0].out, /stub 1 says 1/, "the minter's own words are carried, not summarised");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the whole check exits 0 on this tree, and every minter it found is current", () => {
  const out = execFileSync("node", ["scripts/generated-files-are-current.mjs"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /checked [4-9]\d* minter\(s\)/);
  assert.doesNotMatch(out, /STALE/);
});

// ── TWO RESIDUALS FROM THE REVIEW OF THIS FILE'S OWN CHANGE ──────────────────────────────────────
//
// Both were latent rather than live, and both are the defect this file exists for, one level in: a
// check that reads one shape of the thing it governs and reports clean on every other shape.

test("a provider test is collected wherever it sits under providers/, not only in the one shape", () => {
  // THE SHAPE-BOUND ENUMERATION. This read `providers/<dir>/test/*.test.mjs` one level deep, and the
  // covered-workspace check counted that workspace's own files the SAME way — so a file outside the
  // shape was in no corpus, both sides missed it together and therefore agreed, and every check
  // reported clean under a command whose whole claim is that it runs every corpus.
  const root = mkdtempSync(join(tmpdir(), "prov-shape-"));
  try {
    const put = (p) => {
      mkdirSync(join(root, dirname(p)), { recursive: true });
      writeFileSync(join(root, p), "// planted\n");
    };
    put("providers/a/test/in-the-shape.test.mjs");
    put("providers/b/off-the-shape.test.mjs");            // no test/ directory at all
    put("providers/c/test/deeper/still-a-test.test.mjs"); // below the one level that was read
    put("providers/d/test/not-a-test.mjs");               // must NOT be collected
    mkdirSync(join(root, "providers/e/node_modules/dep/test"), { recursive: true });
    writeFileSync(join(root, "providers/e/node_modules/dep/test/vendor.test.mjs"), "// a dependency's\n");

    const files = providerTestFiles(root);
    assert.deepEqual(files.sort(), [
      "providers/a/test/in-the-shape.test.mjs",
      "providers/b/off-the-shape.test.mjs",
      "providers/c/test/deeper/still-a-test.test.mjs",
    ], "every test under providers/ is collected, at any depth, and nothing else is");
    // BOTH DIRECTIONS. A walk that collected everything would satisfy the half above.
    assert.ok(!files.some((f) => f.includes("node_modules")), "an installed dependency's tests are not this corpus");
    assert.ok(!files.some((f) => f.endsWith("not-a-test.mjs")), "only .test.mjs is collected");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("this tree's provider corpus reaches every provider test on disk, with nothing left over", () => {
  // The arm above proves the walk; this one proves it against the real tree, because a walk that is
  // correct in a fixture and pointed at the wrong directory here would pass it.
  const collected = new Set(providerTestFiles(REPO));
  const onDisk = execFileSync("find", ["providers", "-name", "*.test.mjs", "-type", "f", "-not", "-path", "*/node_modules/*"],
    { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);
  assert.ok(onDisk.length > 30, `expected the real corpus, found ${onDisk.length}`);
  const missed = onDisk.filter((f) => !collected.has(f));
  assert.deepEqual(missed, [], "a provider test on disk that no corpus runs");
  assert.equal(collected.size, onDisk.length, "and nothing collected that is not on disk");
});

test("a minter that WRITES while running --check is caught, not logged as current", async () => {
  // `--check` IS A CONTRACT AND NOTHING WAS VERIFYING IT. A minter that ignores the flag and re-mints
  // repairs the drift on whoever ran it, leaves the commit without the repair, and reports `current`
  // over a check that never happened — a pass from a minter that did not look.
  const { checkAll } = await import("../../scripts/generated-files-are-current.mjs");
  const dir = mkdtempSync(join(tmpdir(), "minters-contract-"));
  const sentinel = join(dir, "state");
  try {
    writeFileSync(sentinel, "0");
    // Honours the contract: reports, changes nothing.
    writeFileSync(join(dir, "mint-honest.mjs"), `process.exit(0);\n`);
    // Ignores it: re-mints and reports clean, which is the harmful form.
    writeFileSync(join(dir, "mint-inert.mjs"),
      `import { writeFileSync } from "node:fs";\n`
      + `writeFileSync(${JSON.stringify(sentinel)}, String(Date.now()));\nprocess.exit(0);\n`);

    const r = checkAll({ dir, root: dir, log: () => {}, readTree: () => readFileSync(sentinel, "utf8") });
    assert.equal(r.wrote.length, 1, "the minter that wrote during --check is caught");
    assert.match(r.wrote[0].m, /mint-inert/);
    assert.equal(r.stale.length, 0, "and it is not filed as merely stale — different remedy");
    // THE CONTROL. Without it, a probe that flagged everything would satisfy the half above.
    assert.ok(!r.wrote.some((w) => /mint-honest/.test(w.m)), "the minter that honoured the contract is not accused");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the contract probe says so when it could not read the tree, rather than passing quietly", async () => {
  const { checkAll } = await import("../../scripts/generated-files-are-current.mjs");
  const dir = mkdtempSync(join(tmpdir(), "minters-notree-"));
  try {
    writeFileSync(join(dir, "mint-x.mjs"), "process.exit(0);\n");
    const r = checkAll({ dir, root: dir, log: () => {}, readTree: () => null });
    assert.equal(r.contractChecked, false, "an unreadable tree is a stated limit, not a silent pass");
    assert.deepEqual(r.wrote, [], "and nothing is accused on a reading that could not be taken");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
