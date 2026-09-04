// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engine-pin-must-win.test.mjs —: the offline suite's promise, checked instead of asserted.
//
// `scripts/test-run.mjs` prints this before every run, in the wrapper every workspace goes through:
//
//     OFFLINE SUITE — no model is called, no register is queried, nothing is spent.
//     … every suite that dispatches a stage points CLEAROTRON_CLAUDE_PATH at driver/test/mock-claude.mjs …
//
// A test file that pins its engine binary with `||=` keeps an INHERITED value. So a developer with
// CLEAROTRON_CLAUDE_PATH exported at a real `claude`, or an agent that set it for one command and left it
// set, runs that file against whatever the variable names — at whatever tier the stage asks for — while
// the banner above promises nothing is spent. The suite stays green throughout, because from inside
// the test a real engine and a mock engine both just answer.
//
// measured this with a tripwire binary and reported THREE files. Re-measured against the same
// criterion before fixing: THIRTEEN. The tripwire was planted as CLEAROTRON_CLAUDE_PATH, and only three
// files pinned that name — the other ten pinned the gateway binary's variable and would have fired on
// a tripwire planted there. (That variable is gone with the gateway,; the lesson is not.) That is not a criticism of the measurement; it is what an unmeasured completeness claim is
// worth, and it is the reason this file exists rather than a fixed count in a commit message.
//
// So: the pin must WIN. Every one of them now assigns unconditionally, like the rest of the corpus,
// and this is what fails when the next one does not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const GUARD = "engine pins in the test corpus";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Every environment variable in this tree that names an executable the engine layer will SPAWN.
// Derived once and named here so a sixth one cannot arrive and be excused by omission.
const ENGINE_BINS = ["ENGINE_BIN", "CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH"];

// Two shapes, because the corpus uses two. The direct form names the variable; the keyed form pins a
// whole block through `Object.entries(...)` and names nothing on the assigning line — which is exactly
// how the three files found stayed invisible to a grep for the variable.
const DIRECT = new RegExp(String.raw`process\.env\.(?:${ENGINE_BINS.join("|")})\s*\|\|=`);
const KEYED = /process\.env\[[A-Za-z_$][\w$]*\]\s*\|\|=/;

const corpus = () => trackedFiles(GUARD, { root: ROOT, pathspec: ["*/test/*.test.mjs", "*/test/**/*.test.mjs"] });

const offenders = (files, read) => {
  const hits = [];
  for (const f of files) {
    const text = read(f);
    if (text === null) continue;
    text.split("\n").forEach((line, i) => {
      if (DIRECT.test(line)) hits.push(`${f}:${i + 1}  ${line.trim()}`);
      else if (KEYED.test(line)) hits.push(`${f}:${i + 1}  ${line.trim()}`);
    });
  }
  return hits.sort();
};

const read = (f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return null; } };

test("#900 no test file lets an inherited engine binary beat its own mock pin", (ctx) => {
  const files = corpus();
  if (files === null) return ctx.skip(skipReason(GUARD));
  assert.deepEqual(offenders(files, read), [],
    `these files DEFAULT their engine pin instead of setting it, so an exported engine variable wins:\n`
    + `  ${offenders(files, read).join("\n  ")}\n\n`
    + `Assign it: \`process.env.CLEAROTRON_CLAUDE_PATH = MOCK\`, not \`||=\`. If a file genuinely needs an override `
    + `seam, give it its own named variable that says so — the mock pin is not that seam, and the offline `
    + `suite's banner promises it is not.`);
});

test("#900 the guard FIRES on a planted default, in BOTH shapes, and passes the assigning forms", () => {
  // Without this the test above is indistinguishable from a regex that matches nothing.
  //
  // ASSEMBLED, never written out. This file is a tracked `*.test.mjs`, so the scan above reads it: a
  // plant written verbatim would make this file its own first offender and redden the guard on the
  // change that introduced it. Same trick, and the same reason, as the vendor-as-architecture canary.
  const DEFAULTS = ["|", "|="].join("");
  const planted = new Map([
    ["planted/direct.test.mjs", `process.env.CLEAROTRON_CLAUDE_PATH ${DEFAULTS} MOCK;\n`],
    ["planted/keyed.test.mjs", `for (const [k, v] of Object.entries({ CLEAROTRON_CLAUDE_PATH: M }))\n  process.env[k] ${DEFAULTS} v;\n`],
    // The fixed forms, which must NOT be flagged — a guard that reddens on the repair is worse than none.
    ["planted/fixed-direct.test.mjs", "process.env.CLEAROTRON_CLAUDE_PATH = MOCK;\n"],
    ["planted/fixed-keyed.test.mjs", "process.env[k] = v;\n"],
    // And the legitimate neighbour this must not sweep up: a temp workspace root that defers to an
    // outer harness costs nothing and calls nothing. Only the binaries spend.
    ["planted/workspace.test.mjs", `process.env.CLEAROTRON_WORK_DIR ${DEFAULTS} mkdtempSync("x");\n`],
  ]);
  const hits = offenders([...planted.keys()], (f) => planted.get(f));
  assert.equal(hits.length, 2, `expected exactly the two plants, got:\n  ${hits.join("\n  ")}`);
  assert.match(hits[0], /^planted\/direct\.test\.mjs:1 {2}/);
  assert.match(hits[1], /^planted\/keyed\.test\.mjs:2 {2}/);
});

test("#900 the corpus has a floor — a sweep that reads nothing is broken, not clean", (ctx) => {
  const files = corpus();
  if (files === null) return ctx.skip(skipReason(GUARD));
  // An absence is a finding. If the pathspec ever stops matching, this says so rather than reporting a
  // clean corpus — which is the same green a genuinely clean corpus reports.
  assert.ok(files.length >= 300,
    `only ${files.length} test file(s) reached the scan — the pathspec is broken, not the tree`);
  // And it must be reaching the files this issue was actually about.
  for (const f of ["driver/test/runner.jx-e2e.test.mjs", "driver/test/satprobe-codeside.test.mjs"]) {
    assert.ok(files.includes(f), `${f} is not in the scanned corpus — the pathspec no longer covers it`);
  }
});

test("#900 the wrapper's promise names the variable this guard protects", () => {
  // The guard and the banner have to stay joined. If somebody rewords the promise away from
  // CLEAROTRON_CLAUDE_PATH, or drops it, the thing this file enforces stops being a thing anyone claimed.
  const wrapper = read("scripts/test-run.mjs");
  assert.ok(wrapper, "scripts/test-run.mjs is missing — every workspace's test script goes through it");
  assert.match(wrapper, /nothing is spent/,
    "the offline banner no longer promises nothing is spent — then re-read #900 before deleting this file");
  assert.match(wrapper, /CLEAROTRON_CLAUDE_PATH/,
    "the banner no longer names the pin it promises. Keep them together: this guard exists to make that "
    + "sentence true, and a promise with no named mechanism cannot be checked by anything.");
});
