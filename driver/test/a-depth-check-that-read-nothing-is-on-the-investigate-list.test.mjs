// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A graded run whose narrative the depth check could not read reaches the harness's INVESTIGATE list.
//
// `narrative-write-ups:could-not-read` is the depth check saying, in writing, that the depth rules were
// applied to nothing on the run. It was one row of a fifty-odd-row receipt, and nothing a test lane reads
// carried it. These arms hold that the ledger reads it, from either shape a receipt carries (the check
// object, and the stored list of failing ids), and that it adds nothing when the rules were applied.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { runLedger, investigate } from "../../scripts/e2e.mjs";

const ID = "narrative-write-ups:could-not-read";

// A delivered run directory holding only the receipt given (none when `receipt` is undefined), and the
// investigate lines that name the check.
function linesFor(receipt) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-depth-"));
  try {
    mkdirSync(driverDir(dir), { recursive: true });
    writeFileSync(join(dir, "status.json"), JSON.stringify({ state: "delivered" }));
    if (receipt !== undefined) writeFileSync(driverDir(dir, "predelivery-lint.json"), JSON.stringify(receipt));
    return investigate(runLedger(dir)).filter((l) => l.includes(ID));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a depth check that read nothing is on the list once, in the receipt's own terms", () => {
  const lines = linesFor({ checks: [{ id: ID, family: "narrative-depth", pass: false, structural: true }], failures: [ID] });
  assert.equal(lines.length, 1, `a graded run delivered with the depth rules applied to nothing: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /applied to nothing/);
  assert.match(lines[0], /neither the band-rank cut nor the word cap was verified/);
});

test("it is read from either shape a receipt carries", () => {
  assert.equal(linesFor({ checks: [{ id: ID, pass: false }] }).length, 1, "the check object alone");
  assert.equal(linesFor({ failures: [ID] }).length, 1, "the stored list of failing ids alone");
});

test("a depth check that read its write-ups, a receipt without it, and no receipt add nothing", () => {
  assert.deepEqual(linesFor({ checks: [{ id: ID, pass: true }], failures: [] }), [], "a passing check");
  assert.deepEqual(linesFor({ checks: [{ id: "narrative-write-ups", pass: true }], failures: [] }), [], "a run whose write-ups were read");
  assert.deepEqual(linesFor(undefined), [], "no receipt: other checks own that absence");
});
