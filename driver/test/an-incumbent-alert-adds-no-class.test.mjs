// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN INCUMBENT ALERT ADDS NO CLASS.
//
// The variants manual said an industry-incumbent alert triggers a parallel sweep in the incumbent's own classes, and its
// worked manifest taught a class-11 sweep on an order for classes 9, 28, 41 and 42. The register asks the client's
// classes and markets: an incumbent is an owner question there, and anything wider is a stated question about that
// owner. The worked example is corrected, not removed. This holds the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-variants", "SKILL.md"), "utf8")
  .replace(/[ \t]+/g, " ");

test("the incumbent alert makes the owner a question in the client's classes and adds no class", () => {
  assert.ok(manual.replace(/\s+/g, " ").includes("It adds no class: the register asks this owner's marks in the client's classes and markets, "
    + "and anything wider only as a stated question about this owner."));
  for (const gone of ["Triggers parallel-class sweep", "triggers parallel sweep", "parallel-class 11 sweep", "Industry-incumbent parallel sweeps apply",
    "register worldwide + class-11 incumbents"])
    assert.ok(!manual.includes(gone), `the variants manual still says "${gone}"`);
});

test("the worked manifest asks the incumbent in the ordered classes and drops the class it would have added", () => {
  for (const ruled of [
    "is an owner question in the ordered classes.",
    "— an owner question in the ordered classes |",
    "| field | lighting / class-11 fixtures | dropped | class 11 is the incumbent's goods, not the client's | the client's goods include lighting |",
    "| source | register worldwide, ordered classes | applied |",
    "The industry-incumbent alert makes the incumbent an owner question in the ordered classes; it adds no class.",
  ]) assert.ok(manual.includes(ruled), `the worked manifest does not say "${ruled}"`);
});
