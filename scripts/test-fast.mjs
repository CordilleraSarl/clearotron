#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// test-fast.mjs — the contributor tier of the suite: every test file EXCEPT the ones that declare
// themselves full-tier.
//
//   node ../scripts/test-run.mjs node ../scripts/test-fast.mjs test/*.test.mjs
//
// ── why there are two tiers ───────────────────────────────────────────────────────────────
//
// `npm test` is the first command CONTRIBUTING.md and INSTALL.md put in front of a stranger, and it
// ran for over twenty minutes on a clean tree — the whole suite, 372 driver files, of which about
// two dozen integration files carry most of the cost. Nothing was wrong with it. It was just not a
// thing a newcomer waits for, so the first thing a newcomer learns is to not run it.
//
// ── THE LINE IS DRAWN ON WHAT A TEST DOES, NOT ON A STOPWATCH ────────────────────────────────────
//
//   FAST TIER (`npm test`) — what a contributor needs before opening a PR. One module's behaviour, a
//   contract, a schema, a guard over the tree, a fixture rendered and asserted. If it can tell you
//   your change is wrong, it belongs here, and here is the default: a new test file is fast-tier
//   unless it says otherwise.
//
//   FULL TIER (`npm run test:full`) — what the merge gate needs. The files that drive the
//   orchestrator END TO END: a whole pipeline run, the runner's claim/queue lifecycle, a complete
//   corrective or operability cycle. They spawn stage after stage against the mock engine, and that
//   is both why they are slow and why a merge cannot land without them.
//
// A file declares itself full-tier with a comment line near the top:
//
//     // @tier full — drives <what> end to end
//
// That is the only thing that marks a tier. This script holds no list of filenames, because a list
// rots the first time a file is renamed and nobody notices that a tier stopped covering it.
//
// ── WHAT THIS SCRIPT STRUCTURALLY CANNOT DO IS SHRINK CI ─────────────────────────────────────────
//
// `npm run test:full` is the unfiltered `node --test test/*.test.mjs` — byte for byte the command
// `npm test` ran before this split — and that is what .github/workflows/ci.yml and
// scripts/publication-scan.mjs invoke. So a marker that should have been added and was not costs a
// contributor time, and a marker added by mistake costs a contributor coverage: neither can take a
// file out of the merge gate. driver/test/test-tiers.test.mjs asserts that wiring, because the way
// this change fails is silent — a fast default plus a CI step still saying `npm test` is a green
// merge gate covering a fraction of what it did.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// A comment line, so it cannot be matched inside a string a test happens to assert on.
const MARKER = /^\s*\/\/\s*@tier\s+full\b/m;

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scripts/test-fast.mjs <test file> [...]");
  console.error("  (the caller's shell expands the glob, exactly as `node --test test/*.test.mjs` does)");
  process.exit(2);
}

// An unexpanded glob is the silent failure this script must not have: `node --test 'test/*.test.mjs'`
// with nothing matching runs zero tests, and zero tests passing looks identical to a suite that ran.
const absent = files.filter((f) => !existsSync(f));
if (absent.length) {
  console.error(`[test-fast] REFUSING TO RUN — ${absent.length} of ${files.length} argument(s) are not files:`);
  for (const f of absent.slice(0, 5)) console.error(`  ${f}`);
  console.error(`  A glob that matched nothing runs zero tests, and zero tests pass.`);
  process.exit(2);
}

const full = [];
const fast = [];
for (const f of files) {
  let src = "";
  try { src = readFileSync(f, "utf8"); } catch { /* unreadable is not a tier decision — run it */ }
  (MARKER.test(src) ? full : fast).push(f);
}

// SAID OUT LOUD, EVERY RUN, WITH THE NAMES. This tier is a deliberate absence, and an absence nobody
// is told about is the one that gets mistaken for coverage.
if (full.length) {
  console.error(`[test-fast] running ${fast.length} test file(s). ${full.length} marked \`@tier full\` are NOT in this run:`);
  for (const f of full) console.error(`             ${f}`);
  console.error(`[test-fast] the merge gate runs all ${files.length}:  npm run test:full`);
  console.error(`             (.github/workflows/ci.yml runs the full tier on every pull request)`);
} else {
  console.error(`[test-fast] running all ${fast.length} test file(s) — none is marked \`@tier full\`.`);
}

if (!fast.length) {
  console.error(`[test-fast] REFUSING TO RUN — every file is marked full-tier, so this tier would assert nothing.`);
  process.exit(2);
}

// Identical to the full tier's command in every respect but the file list: no reporter, no
// concurrency flag, nothing that would make the two tiers' output differ. scripts/publication-scan.mjs
// parses `# fail` lines out of it.
const child = spawn(process.execPath, ["--test", ...fast], { stdio: "inherit" });

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => { try { child.kill(sig); } catch { /* already gone */ } });
}
child.on("error", (e) => {
  console.error(`[test-fast] could not start the test runner: ${e.message}`);
  process.exit(1);
});
// The exit code IS the result. Never let the wrapper report a pass the runner did not.
child.on("close", (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return; }
  process.exit(code ?? 1);
});
