// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE NARRATIVE REVIEW COUNTS A MATERIAL MARKET AS ACCOUNTED FOR WHEREVER AN ANSWER REACHED IT.
//
// The narrative review flagged a material market with no ledger row of its own as missing coverage, and suspected a
// clean row for a market with no scoped search of its own. A complete worldwide answer accounts for every market in it,
// and a market the identical mark's narrowing left inside a crowd stays in that crowd's count. The review now flags
// only a market no question reached at all. This holds the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REFUTATION_SENTENCES } from "./ruled-sentences-narrative-refutation.mjs";

const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "narrative-refutation", "SKILL.md"), "utf8")
  .replace(/\s+/g, " ");

test("the narrative review flags only a material market no question reached at all", () => {
  assert.ok(manual.includes(REFUTATION_SENTENCES.forEveryMaterialJurisdictionNamed));
  assert.ok(manual.includes(REFUTATION_SENTENCES.missingCoverageRowMatterContext));
  for (const gone of ["is there a ledger row? If a material jurisdiction has no row,", "material jurisdiction with no ledger row at all"])
    assert.ok(!manual.includes(gone), `the narrative review still says "${gone}"`);
});
