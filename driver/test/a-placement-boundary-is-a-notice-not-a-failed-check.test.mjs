// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PLACEMENT ROW WITH NO RECORD IS A NOTICE IN THE RUN RECORD, NOT A FAILED CHECK IN THE LAWYER'S WORKBOOK.
//
// A placement row that names no register record is expected for a common-law candidate. The check that states this
// boundary flagged on presence, as a failing check, so the audit workbook's summary said "A machine check on the report
// did not pass." on runs where nothing had failed, and on one run it was the only line there. It is now recorded as a
// notice: beside the checks in the run record, with its count and its words, and read by no delivery surface. A run
// recorded before the change carries it as a failure, and its workbook, rebuilt, leaves it out too. Every mark is
// invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runLint, placementsChecks, deliveryFlagLines, deliveredFailure, NOTICE_IDS } from "../predelivery-lint.mjs";

const GENERIC = "A machine check on the report did not pass.";
const row = (mark, records) => ({ mark, owner: "Pellwood Crafts", decision: "watchlist", records });
const PLACEMENTS = [row("TALVERA", ["/mark/us/1"]), row("TALVERRA", [])];
const lint = (placements) => runLint({ reportMd: "# Actions\n\n### Only you can close these\n\n- Nothing is open.\n",
  searchedNames: ["TALVERA"], headerName: "TALVERA", ratedNames: ["TALVERA"], placements });

test("the row is recorded as a notice with its count and its words, and it is not among the failures", () => {
  const [, c] = placementsChecks({ placements: PLACEMENTS });
  assert.equal(c.id, "placement-rows-without-uri");
  assert.equal(c.notice, true);
  assert.equal(c.pass, true, "a notice is not a failed check");
  assert.match(c.detail, /^1 of 2 placement row\(s\) name no record URI/, "the run record lost the count");
  assert.ok(NOTICE_IDS.has(c.id));
  const withRow = lint(PLACEMENTS), without = lint([row("TALVERA", ["/mark/us/1"])]);
  assert.ok(withRow.checks.some((x) => x.id === "placement-rows-without-uri" && x.notice), "the run record lost the notice");
  assert.deepEqual(withRow.failures.map((f) => f.id), without.failures.map((f) => f.id), "the notice changed the failures");
  assert.deepEqual(deliveryFlagLines(withRow.failures), deliveryFlagLines(without.failures), "the notice reached a delivery line");
});

test("the same row recorded as a failure, as a run before this change wrote it, reaches no delivery line", () => {
  const archived = { id: "placement-rows-without-uri", family: "content-model", surface: "placement", pass: false, detail: "1 of 2 placement row(s) name no record URI." };
  // The control: delivered as a failure, it is the line the workbook printed.
  assert.deepEqual(deliveryFlagLines([archived]), [GENERIC]);
  assert.equal(deliveredFailure(archived), false, "a rebuilt workbook would still say a check failed");
  // A real failure beside it is still delivered, and a pass is not.
  const real = { id: "reference-integrity:email", family: "reference", surface: "email", pass: false, detail: "x" };
  assert.deepEqual([archived, real, { ...real, pass: true }].filter(deliveredFailure).map((f) => f.id), ["reference-integrity:email"]);
  assert.deepEqual(deliveryFlagLines([archived, real].filter(deliveredFailure)), ["The email's conditions name a party that no finding in the report identifies."]);
  // The workbook reads its failed checks through it.
  assert.match(readFileSync(new URL("../publish/index.mjs", import.meta.url), "utf8"),
    /lint: \(lintSink\?\.checks \?\? \[\]\)\.filter\(c => deliveredFailure\(c\) && /, "publish reads the failed checks without it");
});
