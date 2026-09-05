// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A TEST FILE NAMED ON THE COMMAND LINE AND NOT ON DISK IS A REFUSAL, NOT A PASS.
//
// `node --test a.test.mjs absent.test.mjs` exits 0, prints `# fail 0`, and says nothing whatever about
// the file it could not open. It refuses only when EVERY path it was handed is missing. So the one
// thing this repository asks of somebody making a change — work out which arms it touches and run them
// by name — reports full coverage over the arms that are not there.
//
// It bit on this tree, not in theory: two arms were run by name against a fresh clone of the public
// repository, came back clean, and neither file existed. The cut withholds test files that exist
// privately, and the withheld one is very often the file named after the module somebody just changed.
//
// The arms below drive the real runner as a child process, because the property is about what the
// runner does with argv before it spawns anything, and asserting that from inside the runner's own
// process would be asserting about a function rather than about the command people type.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = join(ROOT, "scripts", "test-run.mjs");
// A REAL, CHEAP, PRESENT ARM to pair the missing one with. The whole defect is that a mix of present
// and absent reads as a pass, so every arm here needs a file that genuinely runs.
const PRESENT = "driver/test/the-runner-refuses-a-path-that-is-not-there.test.mjs";
const ABSENT = "driver/test/a-file-this-repository-does-not-contain.test.mjs";

/** Run the runner and hand back its status and output, never throwing on a non-zero exit. */
const runner = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [RUNNER, ...args],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, out: stdout };
  } catch (e) {
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

test("a present arm beside an absent one REFUSES, and names the absent file", () => {
  const r = runner([process.execPath, "--test", "--test-name-pattern", "a name that matches nothing at all", PRESENT, ABSENT]);
  assert.notEqual(r.status, 0,
    "the runner exited 0 over a file that is not there — this is the defect, and it reads as coverage");
  assert.match(r.out, /a-file-this-repository-does-not-contain\.test\.mjs/,
    "the refusal must NAME the file, or the reader is told only that something is wrong");
  assert.doesNotMatch(r.out, /^# fail 0$/m,
    "a refusal that still prints a passing tally is the shape this guard exists to remove");
});

// CONTROL — and it is the arm that matters most, because a guard that refuses good invocations gets
// switched off, and then the defect above is back with nobody watching. The first cut of this guard
// DID refuse a legitimate one: `--test-name-pattern 'nothing.test.mjs'`, where the pattern merely ends
// in a test suffix. That is why the flag arms below exist rather than one happy-path arm.
test("CONTROL — a file that IS there still runs", () => {
  const r = runner([process.execPath, "--test", "--test-name-pattern", "a name that matches nothing at all", PRESENT]);
  assert.equal(r.status, 0, `the runner refused a file that exists:\n${r.out}`);
});

test("CONTROL — a flag VALUE that ends in a test suffix is not a path, and is not refused", () => {
  const r = runner([process.execPath, "--test", "--test-name-pattern", "nothing.test.mjs", PRESENT]);
  assert.equal(r.status, 0,
    `the runner read a --test-name-pattern value as a filename and refused it:\n${r.out}`);
});

test("CONTROL — an --option=value form is not read as a path either", () => {
  const r = runner([process.execPath, "--test", "--test-name-pattern=nothing.test.mjs", PRESENT]);
  assert.equal(r.status, 0, `the runner refused an --option=value argument:\n${r.out}`);
});

test("the refusal happens BEFORE anything is spawned — no test output precedes it", () => {
  const r = runner([process.execPath, "--test", PRESENT, ABSENT]);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.out, /^ok 1 /m,
    "an arm ran before the refusal, so the runner spawned the child and then complained — the point is "
    + "to refuse the invocation, not to annotate a run that already happened");
});
