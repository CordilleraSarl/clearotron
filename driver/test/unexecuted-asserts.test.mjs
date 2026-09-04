// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE FIFTH MEMBER: AN ARM THAT RAN AND ASSERTED NOTHING.
//
// Four of the five ways a guard stops guarding move the file's text, and `driver/suite-census.json`
// catches all four by counting it: DELETED, RENAMED out of the collection glob, GUTTED, SKIPPED. The
// fifth moves no token:
//
//     test("…", () => {
//       if (!process.env.NEVER_SET) return;   // gated: never runs
//       …every assert. line still textually present…
//     });
//
// The test site is counted, the assert sites are counted, the suite reports it PASSING, and
// `mint-suite-census.mjs --check` exits 0. That was measured on this repo by planting exactly it.
//
// ── TWO GUARDS ALREADY CATCH TWO SPELLINGS, AND SAYING SO IS THE POINT ──────────────────────────────
//
// Planting that arm here does NOT sail through: ``'s `topLevelBails` catches a top-level
// `if (…) return;` in a test body and demands it be declared with a reason. `discoveredLoops` catches a
// `for (… of <discovered set>)` whose set was never asserted non-empty. Between them the two commonest
// spellings of a vacuous arm are already covered, and this file does not claim otherwise — the plant
// that started this work tripped `` on the full suite.
//
// WHAT NEITHER CAN DO IS ASK THE QUESTION. Both read the text, so both are bounded by the spellings
// somebody enumerated. A loop over an ordinary empty array is neither a bail nor a discovered set:
//
//     const rows = rowsFor(subject);          // [] in this environment
//     for (const r of rows) assert.ok(r.ok);  // never runs. not a bail, not a discovery.
//
// `topLevelBails` returns nothing, `discoveredLoops` returns nothing, the census counts the assert, the
// suite passes. An arm below plants exactly that and shows all three answering clean while the coverage
// pass names the line.
//
// So this is not the fifth member's only guard; it is the one that needs no spelling. A parser cannot
// know whether a line ran, and `node --test --experimental-test-coverage` answers that per line with no
// instrumentation of the asserts themselves.
//
// ── WHAT THE ARMS BELOW ARE FOR ─────────────────────────────────────────────────────────────────────
//
// The first is END-TO-END on a real sub-run, not on a hand-written lcov: it writes a test file with a
// gated arm, runs it under coverage, and asserts the gated site comes back never-executed while its
// ungated neighbour does not. A fixture lcov would prove the parser and nothing about the mechanism —
// and the mechanism is the entire claim.
//
// The second is the staleness refusal, which is the difference between an instrument and a number
// generator. Coverage line numbers belong to the tree that produced them. Read against a moved tree, an
// assert site that did not exist yet has no record — and a missing record defaulted to "not executed"
// manufactures findings while defaulted to "executed" hides them. Measured on a tree three commits
// ahead of its lcov: 20 sites with no record, in exactly the three files that had changed, beside 42
// genuinely-unexecuted ones. Folding those together is a 48% error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseLcov, unexecuted } from "../../scripts/unexecuted-asserts.mjs";
import { assertSiteLines, countTestSites } from "../../shared/suite-census.mjs";
import { topLevelBails, discoveredLoops } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("#1010 ONE RULE for what an assert site is — the two censuses cannot disagree about what they count", () => {
  // If these two ever answer differently, the coverage census is asking about lines the text census
  // never counted, and a growth in one would be invisible to the other.
  const src = "assert.ok(1);\nassert.equal(2, 3); assert.ok(4);\n// assert.ok(5)\n  * assert.ok(6)\n";
  assert.deepEqual(assertSiteLines(src), [1, 2, 2], "a line with two sites must contribute two");
  assert.equal(countTestSites(src).asserts, assertSiteLines(src).length,
    "the total and the lines have parted — one of them is now counting something the other is not");
  assert.equal(assertSiteLines("// assert.ok(1)\n").length, 0, "a comment is not an assert site");
});

test("#1010 END TO END — a GATED arm is caught, and its ungated neighbour is not", { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "unexec-"));
  try {
    // Both arms pass. Both carry the same assert. Only one of them ever runs one.
    const file = join(dir, "planted.test.mjs");
    writeFileSync(file, [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("ungated", () => {',
      '  assert.equal(1, 1);',
      '});',
      'test("gated — every token in place, and it asserts nothing", () => {',
      '  if (!process.env.NEVER_SET_BY_ANYONE) return;',
      '  assert.equal(2, 2);',
      '});',
    ].join("\n"));
    const lcovPath = join(dir, "out.lcov");
    // NODE_TEST_CONTEXT IS DELETED, NOT OVERWRITTEN, AND FINDING THAT OUT COST AN HOUR. This arm runs
    // inside `node --test`, which sets `NODE_TEST_CONTEXT=child-v8` — and a child that inherits it
    // configures no reporters at all, so it exits 0 having written no lcov. `existsSync` below then
    // reads as "the instrument found nothing" when the instrument never ran: the vacuous pass this
    // whole file is about, arriving inside the arm that proves it.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    execFileSync(process.execPath, ["--test", "--experimental-test-coverage",
      "--test-reporter=tap", "--test-reporter-destination=stdout",
      "--test-reporter=lcov", `--test-reporter-destination=${lcovPath}`, file],
    { cwd: dir, stdio: "pipe", env });

    assert.ok(existsSync(lcovPath), "the coverage run produced no lcov — an absent artifact is a finding");
    const { never, unknown } = unexecuted(parseLcov(readFileSync(lcovPath, "utf8")), { resolve: (sf) => (sf.startsWith("/") ? sf : join(dir, sf)) });
    assert.deepEqual(unknown, {}, "the lcov and the file it describes are the same tree, so nothing may be unknown");
    assert.deepEqual(never, { "planted.test.mjs": 1 },
      "the gated assert did not come back as never-executed. That is the one defect #1010's other four "
      + "members cannot see, and this instrument exists only to see it.");

    // THE CONTROL: the suite is green and the text census is blind, which is why the arm above matters.
    assert.equal(countTestSites(readFileSync(file, "utf8")).asserts, 2,
      "the text census counts BOTH asserts — it cannot tell that one never ran, which is the premise here");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1010 THE SHAPE NO TEXTUAL GUARD CATCHES — an assert inside a loop that never turns", { timeout: 120_000 }, () => {
  // The argument for this instrument existing beside the two that already read the text. If either of
  // those ever grows to catch this shape, this arm fails on its first two assertions and says so — which
  // is the right outcome, because then the cheap guard covers it and this one is defence in depth.
  const dir = mkdtempSync(join(tmpdir(), "unexec-shape-"));
  try {
    const body = [
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'const rowsFor = () => [];              // [] in this environment; an ordinary call, not a discovery',
      'test("reads as a real arm, and asserts nothing about its subject", () => {',
      '  const rows = rowsFor("subject");',
      '  for (const r of rows) {',
      '    assert.ok(r.ok);',
      '  }',
      '  assert.equal(typeof rowsFor, "function");',
      '});',
    ].join("\n");
    const file = join(dir, "shape.test.mjs");
    writeFileSync(file, body);

    // ON ITS OWN LINE, WHICH IS THE INSTRUMENT'S BOUNDARY AND IS STATED RATHER THAN DISCOVERED LATER.
    // Coverage is per LINE. `for (const r of rows) assert.ok(r.ok);` puts the loop head and the assert
    // on one line, the head runs, and the line reads as covered — measured, and the first version of
    // this arm was written that way and passed for the wrong reason. Braced, the assert has its own
    // line and the instrument sees it. Nearly every assert in this suite is already on its own line
    // (they are long multi-line calls), so the boundary is narrow — but it is real, and a one-line loop
    // body is invisible to this the same way a comment is invisible to the text census.
    assert.deepEqual(topLevelBails(body), [],
      "#1479's detector now catches this shape. Good — but this arm's premise is gone, so re-read the "
      + "header: the loop-over-an-empty-array case is no longer the one only a run can see.");
    assert.deepEqual(discoveredLoops(body), [],
      "the discovered-loop detector now catches this shape; same conclusion as above");
    assert.equal(countTestSites(body).asserts, 2, "the text census counts both asserts, as it must");

    const lcovPath = join(dir, "out.lcov");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    execFileSync(process.execPath, ["--test", "--experimental-test-coverage",
      "--test-reporter=tap", "--test-reporter-destination=stdout",
      "--test-reporter=lcov", `--test-reporter-destination=${lcovPath}`, file],
    { cwd: dir, stdio: "pipe", env });

    const { never, unknown } = unexecuted(parseLcov(readFileSync(lcovPath, "utf8")), { resolve: (sf) => (sf.startsWith("/") ? sf : join(dir, sf)) });
    assert.deepEqual(unknown, {});
    assert.deepEqual(never, { "shape.test.mjs": 1 },
      "the assert inside the loop that never turned was not reported. That assertion is what the arm "
      + "claims about its subject, it never ran, and no reader of the text could have known.");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1010 an lcov from ANOTHER TREE is unknown, never a finding and never a pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "unexec-stale-"));
  try {
    const file = join(dir, "moved.test.mjs");
    writeFileSync(file, 'import assert from "node:assert/strict";\nassert.ok(1);\nassert.ok(2);\n');
    // An lcov that only ever saw line 2 — line 3 is a site the run never measured.
    const lcov = `TN:\nSF:moved.test.mjs\nDA:2,1\nend_of_record\n`;
    const { never, unknown } = unexecuted(parseLcov(lcov), { resolve: (sf) => join(dir, sf) });
    assert.deepEqual(unknown, { "moved.test.mjs": 1 },
      "a site the coverage run never saw must be UNKNOWN — defaulted either way it is a lie about a line "
      + "nobody measured, and the script refuses on it rather than reporting a number");
    assert.deepEqual(never, {}, "an unmeasured site was reported as never-executed — that manufactures findings");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#1010 the committed baseline is real, and it is a ceiling rather than a defect list", () => {
  const path = join(ROOT, "driver", "unexecuted-asserts.json");
  assert.ok(existsSync(path), "the baseline is gone — `--check` has nothing to compare against and passes vacuously");
  const census = JSON.parse(readFileSync(path, "utf8"));
  const total = Object.values(census.files ?? {}).reduce((a, b) => a + b, 0);
  // A floor on the population, for the same reason suite-census.json has one: a baseline that has
  // collapsed to nothing is a check measuring nothing, and it looks exactly like a clean tree.
  assert.ok(total >= 20,
    `the baseline holds ${total} unexecuted site(s). It was minted at 42 across 22 files; a collapse means `
    + "the minting side stopped seeing them, not that the branches went");
  assert.ok(census._README?.length, "the baseline lost the note saying what it is and how to re-stamp it");
  for (const [f, n] of Object.entries(census.files ?? {})) {
    assert.match(f, /\.test\.mjs$/, `${f} is not a test file — the baseline is keyed on something else now`);
    assert.ok(Number.isInteger(n) && n > 0, `${f} carries ${n}; a zero entry is noise a re-stamp should drop`);
  }
});
