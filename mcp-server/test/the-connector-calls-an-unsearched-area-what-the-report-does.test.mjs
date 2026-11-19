// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CONNECTOR CALLS AN UNSEARCHED AREA WHAT THE REPORT DOES. The coverage statement gives each area's state in the
// report's own words, so an assistant and the page a client holds name one state the same way. The report's word for
// an area the search did not reach is "Not searched" (owner, 2026-11-18), where it read "Not run this run"; the
// connector follows it on a clearance's coverage rows and on a Knockout search with no register part. Invented runs.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageStatement } from "../lib/evidence.mjs";
import { knockoutCoverage } from "../lib/knockout.mjs";

function runDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "connector-not-searched-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a clearance's unsearched coverage row reads Not searched", (t) => {
  const dir = runDir(t);
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ coverage: [
    { area: "Register / Vietnam", state: "not-searched", note: "the register service does not cover this office" },
    { area: "Register / Switzerland", state: "confirmed-clean", note: "" },
  ] }));
  assert.deepEqual(coverageStatement({ runDir: dir }).areas.map((a) => a.stateLabel), ["Not searched", "Searched — clean"]);
});

test("a Knockout search with no register part reads Not searched on its register area", (t) => {
  const dir = runDir(t);
  writeFileSync(join(dir, "knockout-findings.json"), JSON.stringify({ marks: [{ name: "TARNELLO", findings: [], negatives: [] }] }));
  const register = knockoutCoverage({ runDir: dir }).areas.filter((a) => a.area === "Register");
  assert.equal(register.length, 1);
  assert.equal(register[0].state, "Not searched");
});
