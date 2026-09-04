// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// test-run-deps.test.mjs —. A partly-blind suite must refuse, not report its blindness as failures.
//
// The defect, measured on the same commit and the same machine:
//
//     # tests 3456   # pass 3159   # fail 295      <- fresh `git worktree add`, no node_modules
//     # tests 3949   # pass 3947   # fail 0        <- after an install
//
// All 295 are missing packages and the assertions downstream of them, printed as `not ok` lines with
// stack traces in driver/test/*.test.mjs — indistinguishable from code defects. Roughly 190 tests never
// executed, and a regression inside any of them is invisible to a baseline diff taken the same way.
// 's first full-suite comparison was taken against exactly that baseline.
//
// THE ASSERTION IS THE EXIT, not the message. `scripts/test-run.mjs` wraps every invocation, so the
// question is whether it refuses or runs — and a test that only grepped the wording would go green the
// day somebody reworded the refusal into a warning that still ran the suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "test-run.mjs");

/** A workspace whose declared dependency cannot resolve — the fresh-worktree shape, hermetically. */
function worktreeWithout(deps) {
  const root = mkdtempSync(join(tmpdir(), "testrun-deps-"));
  const ws = join(root, "driver");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["driver"] }));
  writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "w", type: "module", dependencies: deps }));
  return { root, ws };
}

const runIn = (cwd, args) => spawnSync(process.execPath, [RUNNER, ...args], { cwd, encoding: "utf8" });

test("#535 a workspace whose dependencies cannot resolve is REFUSED, not run blind", () => {
  const { root, ws } = worktreeWithout({ undici: "^6.0.0", exceljs: "^4.4.0" });
  try {
    const r = runIn(ws, ["node", "-e", "console.log('THE COMMAND RAN')"]);
    assert.equal(r.status, 1, `expected a refusal, got status ${r.status}\n${r.stdout}\n${r.stderr}`);

    // Not a count of failed assertions. This is the whole point: the old behaviour produced `# fail 295`
    // and a green-looking name diff, and this must never be mistaken for a suite that ran and failed.
    assert.doesNotMatch(r.stdout, /THE COMMAND RAN/, "the command was never spawned — nothing ran to fail");
    assert.doesNotMatch(r.stdout, /^# fail [1-9]/m, "a refusal must not look like a failing test run");
    assert.doesNotMatch(r.stdout, /^not ok/m, "no `not ok` lines — nothing was executed to fail");

    // It names WHAT is missing and WHAT fixes it. An agent reading this in CI output has the repo and
    // nothing else.
    assert.match(r.stderr, /REFUSING TO RUN/);
    assert.match(r.stderr, /undici/, "the missing dependency is named");
    assert.match(r.stderr, /exceljs/, "…all of them, not just the first");
    assert.match(r.stderr, /npm install/, "and the command that fixes it");
    assert.match(r.stderr, /#535/, "and where the reasoning lives");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#535 the refusal is about RESOLUTION, not about the name being declared — an installed dep runs", () => {
  // The counterpart, and it is what keeps the guard from being a blanket refusal: a workspace whose
  // declared dependency IS resolvable runs its suite normally. Without this, "refuses on a fresh
  // worktree" and "refuses always" look identical from the failing side.
  const { root, ws } = worktreeWithout({ undici: "^6.0.0" });
  try {
    mkdirSync(join(ws, "node_modules", "undici"), { recursive: true });
    writeFileSync(join(ws, "node_modules", "undici", "package.json"), JSON.stringify({ name: "undici", version: "6.0.0" }));
    const r = runIn(ws, ["node", "-e", "console.log('THE COMMAND RAN')"]);
    assert.equal(r.status, 0, `expected the command to run\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /THE COMMAND RAN/, "the wrapper spawned it rather than refusing");
    assert.doesNotMatch(r.stderr, /REFUSING TO RUN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#535 a dependency resolved from the WORKSPACE ROOT counts — npm hoists, and a hoisted package is installed", () => {
  // The resolution walk has to climb, because npm hoists shared dependencies to the root node_modules.
  // A check that only looked beside the workspace's own package.json would refuse a correctly installed
  // tree, which is a false refusal — worse than the defect, because it blocks a suite that would pass.
  const { root, ws } = worktreeWithout({ undici: "^6.0.0" });
  try {
    mkdirSync(join(root, "node_modules", "undici"), { recursive: true });
    writeFileSync(join(root, "node_modules", "undici", "package.json"), JSON.stringify({ name: "undici", version: "6.0.0" }));
    const r = runIn(ws, ["node", "-e", "console.log('THE COMMAND RAN')"]);
    assert.equal(r.status, 0, `a hoisted dependency must satisfy the check\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /THE COMMAND RAN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#535 a workspace ROOT with no node_modules is refused too — 'declares no dependencies' is not 'installed'", () => {
  // `npm run test:providers` runs from the repo root, whose package.json declares workspaces and no
  // dependencies of its own. Reading that as "nothing to check" would let the root-cwd invocations run
  // blind on exactly the tree this issue is about.
  const root = mkdtempSync(join(tmpdir(), "testrun-deps-root-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", private: true, workspaces: ["driver"] }));
    const bare = runIn(root, ["node", "-e", "console.log('THE COMMAND RAN')"]);
    assert.equal(bare.status, 1, "a workspace root with no install must refuse");
    assert.match(bare.stderr, /REFUSING TO RUN/);

    mkdirSync(join(root, "node_modules"), { recursive: true });
    const installed = runIn(root, ["node", "-e", "console.log('THE COMMAND RAN')"]);
    assert.equal(installed.status, 0, "…and stop refusing once the install is there");
    assert.match(installed.stdout, /THE COMMAND RAN/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#535 the runner does not INSTALL anything — a test wrapper must not be able to fetch packages", () => {
  // scripts/publication-scan.mjs runs the suite through this wrapper, and CI does too. A wrapper that can
  // start a network install is a wrapper that can turn a publication gate into a package fetch. `npm ci`
  // already runs ahead of both, so the refusal is the whole remedy.
  const { root, ws } = worktreeWithout({ undici: "^6.0.0" });
  try {
    const r = runIn(ws, ["node", "-e", "console.log('THE COMMAND RAN')"]);
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /THE COMMAND RAN/, "nothing was spawned");
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /added \d+ packages|npm warn|resolved \d+ packages/,
      "the refusal must not have run an install");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
