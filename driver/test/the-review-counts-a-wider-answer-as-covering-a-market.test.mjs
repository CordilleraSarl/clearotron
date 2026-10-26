// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE NARRATIVE REVIEW COUNTS A WIDER ANSWER AS COVERING A MARKET.
//
// The narrative review suspected a clean row for a market with no scoped search of its own, and asked the run to have
// searched or deferred every material market. A complete answer over a wider scope covers every market in it, and a
// market the identical mark's narrowing left inside a crowd is in that crowd's count, so neither is suspect. This holds
// the ruled lines and that the old ones are gone. A deferred row on a material market stays a real gap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "narrative-refutation", "SKILL.md"), "utf8")
  .replace(/\s+/g, " ");

test("a clean row is suspect only where no search covered the market, its own question or a wider complete answer", () => {
  assert.ok(manual.includes("a `confirmed-clean` row for a jurisdiction no search covered — neither its own question nor a complete answer over a "
    + "wider scope that contains it — is itself suspect"));
  assert.ok(!manual.includes("no corresponding scoped search in the search-count audit"), "the review still asks a scoped search per market");
});

test("the review checks each material market was searched by its own question, a worldwide answer or a crowd's count, or deferred", () => {
  assert.ok(manual.includes("Confirm that the run searched every jurisdiction it called material — by its own question, by a complete worldwide "
    + "answer, or inside the count of a crowd the identical mark's narrowing left — or honestly deferred it."));
  assert.ok(!manual.includes("Confirm that the run actually searched, or honestly deferred, every jurisdiction it called material."));
});
