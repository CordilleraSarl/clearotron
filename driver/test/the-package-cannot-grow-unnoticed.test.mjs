// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-package-cannot-grow-unnoticed.test.mjs — the package-size budget.
//
// The package is large by design and that was ruled to be right. What was missing is not a smaller
// package but a MEASUREMENT: nothing recorded the size, so it could double across a few betas and
// nobody would find out from the repository. A number nobody records is a number nobody can notice
// changing.
//
// The arms drive the comparison the gate actually makes, against the baseline this repository
// actually carries — not a hand-built one — so a baseline that goes missing or loses a field fails
// here rather than at a release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compare, largest, MARGIN } from "../../scripts/package-size-budget.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const BASELINE = join(ROOT, "package-size-baseline.json");

test("the baseline is recorded, and carries every field the gate compares", () => {
  assert.ok(existsSync(BASELINE), "no package-size baseline is recorded, so the gate has nothing to compare against");
  const was = JSON.parse(readFileSync(BASELINE, "utf8"));
  for (const k of ["size", "unpackedSize", "entryCount"]) {
    assert.ok(Number.isFinite(was[k]) && was[k] > 0, `the baseline's ${k} is missing or not a number`);
  }
  assert.ok(was.margin > 0 && was.margin < 1, "the baseline's margin is not a proportion");
});

test("a deliberate 20 MB addition fails, and the growth has a name", () => {
  // The acceptance the issue names. 20 MB is about one more bundled demo run.
  const was = JSON.parse(readFileSync(BASELINE, "utf8"));
  const now = {
    size: was.size + 20_000_000,
    unpackedSize: was.unpackedSize + 20_000_000,
    entryCount: was.entryCount + 1,
    files: [{ path: "demo/an-added-run/records.json", size: 20_000_000 }, { path: "small.js", size: 5 }],
  };
  const { over } = compare(now, was);
  assert.ok(over.includes("size"), "20 MB of growth passed the packed budget");
  assert.ok(over.includes("unpackedSize"), "20 MB of growth passed the unpacked budget");
  // …and the report names the path, because a number alone starts an argument rather than settling one.
  assert.equal(largest(now.files, 1)[0].path, "demo/an-added-run/records.json");
});

test("ordinary churn inside the margin passes silently", () => {
  const was = JSON.parse(readFileSync(BASELINE, "utf8"));
  const inside = (f) => Math.floor(was[f] * (1 + MARGIN / 2));
  const { over } = compare({ size: inside("size"), unpackedSize: inside("unpackedSize"), entryCount: inside("entryCount"), files: [] }, was);
  assert.deepEqual(over, [], "a change inside the margin failed the budget");
  // A shrink is never a failure — the gate watches growth, it does not pin a size.
  assert.deepEqual(compare({ size: 1, unpackedSize: 1, entryCount: 1, files: [] }, was).over, []);
});

test("each field is judged on its own, so a shape of growth cannot hide behind a total", () => {
  const was = JSON.parse(readFileSync(BASELINE, "utf8"));
  // Thousands of tiny files: the packed size barely moves and the entry count explodes.
  const many = compare({ size: was.size, unpackedSize: was.unpackedSize,
    entryCount: Math.floor(was.entryCount * 1.5), files: [] }, was);
  assert.deepEqual(many.over, ["entryCount"], "a flood of small files passed unnoticed");
  // One enormous file: the entry count is unchanged and the size doubles.
  const big = compare({ size: was.size * 2, unpackedSize: was.unpackedSize * 2,
    entryCount: was.entryCount, files: [] }, was);
  assert.deepEqual(big.over, ["size", "unpackedSize"], "a doubling in bytes passed unnoticed");
});

test("the baseline's own margin wins over the default, so a change to it is a change in the diff", () => {
  const was = { size: 100, unpackedSize: 100, entryCount: 100, margin: 0.5 };
  assert.deepEqual(compare({ size: 140, unpackedSize: 140, entryCount: 140, files: [] }, was, { margin: was.margin }).over, [],
    "the recorded margin was ignored in favour of the default");
});

test("the gate is wired into CI, not merely available to run", () => {
  // A check nobody runs measures nothing. This pins the wiring, because the script passing locally is
  // exactly the state in which a gate is believed and absent.
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /package-size-budget\.mjs --check/,
    "the package-size budget is not run by CI, so nothing measures the package on a push");
});
