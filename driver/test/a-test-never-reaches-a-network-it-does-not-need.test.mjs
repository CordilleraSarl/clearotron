// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — THE CLASS, NOT THE TWO FILES THAT HAD IT ───────────────────────────
//
// An arm spent sixty seconds a call waiting on a registry it did not need. The advice it tested names a
// LOCAL install and the package resolves locally, but `npx` reaches for the network anyway — and that
// reach sometimes BLOCKS rather than failing. It produced zero bytes on both streams for the whole
// sixty seconds, so it was never prompting; it was waiting.
//
// THE PART THAT MAKES IT A CLASS RATHER THAN A BUG. The same command, in the same environment, exited 0
// at 01:06Z and hung at 01:12Z. It was never deterministic — it was a coin weighted by whatever the
// connection happened to do, and it landed green for months and red on the night it blocked every lane
// on the driver shard. So a green here proves nothing about the next run, which is exactly why this
// guard exists instead of a fix in two files: the next arm to shell out to a package manager will look
// fine until it does not.
//
// THE RULE. A test that spawns npm or npx, for work that resolves on disk, seals the network with
// `npm_config_offline`. Nothing here forbids reaching a registry — it forbids reaching one BY ACCIDENT,
// for work that never needed it. A test that genuinely audits or fetches declares itself below, with
// the reason, and keeps its network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_CORPUS = skipReason("a-test-never-reaches-a-network-it-does-not-need (2174)");

/**
 * Tests that spawn a package manager and are ALLOWED to reach a registry, each with the reason.
 *
 * A name earns its place here by needing the network to do its job, never by being inconvenient to fix.
 * An entry whose file stops spawning anything is a stale exemption, and the arm below fails on one.
 */
const NEEDS_THE_NETWORK = [
  // (none today — `verify-publishable`'s audit is a SCRIPT, not a test, and it is the one place in the
  // tree that legitimately asks a registry a question it cannot answer offline.)
];

/** A spawn of npm/npx from a test: the call text, so the arm can read what env rides with it. */
const SPAWN = /(?:execFileSync|execSync|spawnSync|spawn)\s*\(\s*["'`](?:npm|npx|\/bin\/sh|sh)["'`][\s\S]{0,900}?\)/g;
const MENTIONS_PM = /\b(?:npm|npx)\b/;

test("2174 a test that spawns a package manager seals the network it does not need", (ctx) => {
  const files = trackedFiles("offline-package-manager-spawns", { root: ROOT, pathspec: ["*.test.mjs"] });
  // A bare `return` here would report this subject CLEAN having measured none of it — which is the
  // vacuous pass this very file exists to prevent, one level up. Say it could not look.
  if (files == null) return ctx.skip(NO_CORPUS);
  const spawners = [];
  for (const rel of nonEmpty(files, "the tracked test corpus")) {
    let text;
    try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
    const calls = text.match(SPAWN) ?? [];
    // A shell spawn only counts when the thing it runs is a package manager — this file is about npm
    // reaching a registry, not about every child process in the suite.
    const relevant = calls.filter((c) => MENTIONS_PM.test(c));
    if (relevant.length) spawners.push({ rel, calls: relevant, text });
  }

  // THE POPULATION MUST EXIST — asserted where it is iterated, below. If a refactor moves every spawn
  // behind a helper this regex cannot see, the loop would pass having examined nothing.
  const offenders = [];
  // The seal may ride on the call or on a helper in the same file that composes the env; either is the
  // file taking responsibility for it, and neither is an accident.
  for (const { rel, text } of nonEmpty(spawners, "tests that spawn a package manager")) {
    if (NEEDS_THE_NETWORK.includes(rel)) continue;
    if (!/npm_config_offline/.test(text)) offenders.push(rel);
  }

  assert.deepEqual(offenders, [],
    "these tests spawn npm or npx without sealing the network. If the work resolves on disk, pass "
    + "`npm_config_offline: \"true\"` in the child env — npm reaches for a registry it does not need and "
    + "that reach can BLOCK rather than fail. If the test genuinely needs a registry, add it to "
    + "NEEDS_THE_NETWORK with the reason.");
});

/**
 * Which exemptions no longer name a file that spawns a package manager.
 *
 * A PURE FUNCTION ON PURPOSE. The list is empty today, so a loop over the real one asserts nothing and
 * the coverage census says so — an assertion that cannot run is not protecting anything, it is a promise
 * to protect something later. Extracted, the RULE runs today against entries built for the arm, and the
 * real list is checked by the same code rather than by a second copy of it.
 */
export function staleExemptions(list, { files, read }) {
  const stale = [];
  for (const rel of list) {
    if (!files.includes(rel)) { stale.push(`${rel} (not a tracked test file)`); continue; }
    const text = read(rel);
    if (!(text.match(SPAWN) ?? []).some((c) => MENTIONS_PM.test(c))) stale.push(`${rel} (spawns no package manager)`);
  }
  return stale;
}

test("2174 the exemption rule catches a stale entry, and the real list is clean", (ctx) => {
  const files = trackedFiles("offline-exemptions", { root: ROOT, pathspec: ["*.test.mjs"] });
  if (files == null) return ctx.skip(NO_CORPUS);

  // THE RULE, EXERCISED TODAY. An exemption naming a file that no longer spawns anything is a hole
  // nobody notices: it stops covering a real case and starts excusing a future one that inherits the
  // name. With the real list empty, the only way to know this rule works is to run it on entries that
  // break it.
  const spawns = 'execFileSync("npm", ["pack"])';
  const reads = { "kept.test.mjs": spawns, "drifted.test.mjs": "no child processes here" };
  assert.deepEqual(staleExemptions(["kept.test.mjs"], { files: ["kept.test.mjs"], read: (f) => reads[f] }), [],
    "an exemption that still spawns a package manager was called stale");
  assert.deepEqual(
    staleExemptions(["drifted.test.mjs"], { files: ["drifted.test.mjs"], read: (f) => reads[f] }),
    ["drifted.test.mjs (spawns no package manager)"],
    "an exemption whose file stopped spawning anything was not caught");
  assert.deepEqual(
    staleExemptions(["gone.test.mjs"], { files: [], read: () => "" }),
    ["gone.test.mjs (not a tracked test file)"],
    "an exemption naming a file that is not in the corpus was not caught");

  // AND THE REAL LIST, through the same rule. Empty is the passing state and says so: nothing in the
  // tree needs a registry today, which is a claim rather than a silence.
  assert.deepEqual(staleExemptions(NEEDS_THE_NETWORK, { files, read: (rel) => readFileSync(join(ROOT, rel), "utf8") }), [],
    "an exemption in NEEDS_THE_NETWORK no longer covers a real case");
});
