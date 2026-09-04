// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — SIX COMMANDS THE PUBLIC MANIFEST ADVERTISES ────────────────────────
//
// `package.json` is a front door. Six of its script entries ran a file the cut withholds, so a stranger
// who cloned the public tree and ran one got a module-not-found — the manifest advertising a command
// that cannot exist there. Owner ruling 2026-09-04: option B UPGRADED. They get the `existsSync` guard
// `postinstall` was deliberately written with, and where the file is absent they REFUSE BY NAME and
// EXIT NONZERO.
//
// THE UPGRADE IS WHAT THESE ARMS ARE ABOUT, and it is why "the wrapper is present" would not be a test.
// A plain guard makes the six succeed by doing nothing — the reader runs the command, gets exit 0, and
// believes something happened. That is a quieter lie than the crash it replaced, and it is the exact
// shape this repo calls an absence read as a pass. So the arms drive the STRING THE MANIFEST SHIPS, in
// a directory where the file genuinely is not, and read the status and the words.
//
// AND THE STRING IS TAKEN FROM package.json, NEVER RETYPED HERE. A copy of the guard in this file would
// pass forever while the manifest drifted underneath it — the arm would be measuring itself. What runs
// below is what npm runs.
//
// BREAK MATRIX:
//   · every one of the six carries a guard          → break: leave one bare, arm 1 red
//   · absent file → NONZERO, never a silent no-op   → break: drop process.exit(1), arm 2 red
//   · absent file → the refusal NAMES it            → break: print a generic message, arm 2 red
//   · present file → it actually runs               → break: guard inverted, arm 3 red
//   · present file → the child's exit code survives → break: swallow the failure, arm 3 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).scripts;

/** The six the ruling names, and the withheld file each one runs. */
const GUARDED = {
  "deploy:drift": "scripts/deploy-drift-check.mjs",
  "generators": "scripts/regen-baselines.mjs",
  "guard:messages": "scripts/commit-message-guard.mjs",
  "guard:messages:self-test": "scripts/commit-message-guard.mjs",
  "hooks:install": "scripts/install-hooks.mjs",
  "hooks:check": "scripts/install-hooks.mjs",
};

/**
 * The body npm hands to node, recovered from the manifest entry.
 *
 * Deliberately NOT a re-implementation: the entry is `node -e "<body>"` with the inner double quotes
 * escaped by JSON, so unwrapping it is the only step between what ships and what runs here.
 */
function bodyOf(name) {
  const entry = SCRIPTS[name];
  assert.ok(entry.startsWith('node -e "') && entry.endsWith('"'), `${name} is not a node -e entry: ${entry}`);
  return entry.slice('node -e "'.length, -1).replace(/\\"/g, '"');
}

const run = (name, cwd) => spawnSync(process.execPath, ["-e", bodyOf(name)], { cwd, encoding: "utf8" });

test("every one of the six carries the guard, and none of them runs its file bare", () => {
  nonEmpty(Object.keys(GUARDED), "the arm would pass over an empty list");
  for (const [name, target] of Object.entries(GUARDED)) {
    const entry = SCRIPTS[name];
    assert.ok(entry, `${name} is gone from the manifest — the ruling was about keeping these visible`);
    assert.ok(entry.includes("existsSync"), `${name} runs ${target} with no guard`);
    assert.ok(entry.includes(target), `${name} no longer names ${target}`);
  }
});

test("on a tree without the file, each refuses BY NAME and exits nonzero — never a silent no-op", () => {
  const empty = mkdtempSync(join(tmpdir(), "public-clone-"));
  for (const [name, target] of Object.entries(GUARDED)) {
    const r = run(name, empty);
    // NONZERO IS THE UPGRADE. Exit 0 here is the ruling's rejected option: a command that succeeds by
    // doing nothing, which a reader cannot tell from one that worked.
    assert.notEqual(r.status, 0, `${name} exited 0 on a tree with no ${target} — that is the silent no-op the owner ruled out`);
    assert.equal(r.status, 1, `${name} exited ${r.status}, not the guard's own 1`);
    // NAMED, so the reader learns what the command is rather than that something is missing.
    assert.match(r.stderr, new RegExp(`npm run ${name.replace(/[:.*+?^${}()|[\]\\]/g, "\\$&")} requires`), `${name}: the refusal does not name the command`);
    assert.ok(r.stderr.includes(target), `${name}: the refusal does not name ${target}`);
    assert.match(r.stderr, /not included in this distribution/, `${name}: the refusal does not say why`);
    assert.equal(r.stdout, "", `${name} printed to stdout — a refusal belongs on stderr`);
  }
});

test("where the file IS there it runs, and the child's own exit code survives the wrapper", () => {
  // THE CONTROL THAT MAKES ARM 2 MEAN SOMETHING. Without it a guard that refused unconditionally would
  // pass every assertion above, and the six would be broken for us in exactly the way they were broken
  // for a stranger.
  const present = mkdtempSync(join(tmpdir(), "internal-tree-"));
  mkdirSync(join(present, "scripts"), { recursive: true });
  const marker = join(present, "ran.txt");
  for (const target of new Set(Object.values(GUARDED)))
    writeFileSync(join(present, target), [
      // .mjs is ESM — the stand-in is written the way the real scripts are, not with require().
      'import { appendFileSync } from "node:fs";',
      `appendFileSync(${JSON.stringify(marker)}, "x");`,
      'process.exit(process.argv[2] === "--check" || process.argv[2] === "--self-test" ? 7 : 0);',
      "",
    ].join("\n"));

  const ok = run("deploy:drift", present);
  assert.equal(ok.status, 0, `a present file did not run cleanly: ${ok.stderr}`);
  nonEmpty(readFileSync(marker, "utf8"), "the guard reported success without running the file");

  // The flagged pair pass their flag through AND their failure through. A wrapper that swallowed either
  // would turn a red guard run into a green one on our own daily commands.
  const flagged = run("hooks:check", present);
  assert.equal(flagged.status, 7, "the child's exit code did not survive the wrapper — a failing guard would read as a pass");
  assert.equal(flagged.stderr, "", "the wrapper leaked a stack trace over the child's own output");
});
