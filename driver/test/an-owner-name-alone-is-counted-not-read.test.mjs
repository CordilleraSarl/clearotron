// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A search on an owner's name alone asks how large that owner's register is. The instructions already
// call it crowd context: a count, never a portfolio read. It was minted to enumerate like every other
// proposal, so a large owner's filings were fetched page by page up to the ceiling although nothing read
// them as coverage. It is now minted as a count. The owner's marks that share the client's word are the
// owner×term slice, and that still enumerates record by record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintSupplementalEntries } from "../engine/mcp/supplemental.mjs";
import { OWNER_SWEEP_STEERING } from "../stages.mjs";

test("an owner's name alone is minted as a count; the owner's marks sharing the word still enumerate", () => {
  const { minted, rejected } = mintSupplementalEntries("incumbent-class", [
    { predicate: "owner", term: "Sample Games Holdings", nice_classes: [9, 28, 41] },
    { predicate: "default", term: "NEARFIELD", owner: "Sample Games Holdings", nice_classes: [9, 28, 41] },
    { predicate: "exact", term: "NEARFIELD", nice_classes: [9] },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(minted.map((e) => [e.predicate, e.owner ? "owner×term" : "-", e.expected_kind]), [
    ["owner", "-", "count"],
    ["default", "owner×term", "enumerate"],
    ["exact", "-", "enumerate"],
  ]);
});

test("the count is what the owner-search instruction already promises", () => {
  assert.match(OWNER_SWEEP_STEERING, /CROWD CONTEXT, not coverage/,
    "the minting follows the instruction; if the instruction stops calling a bare owner search count-only, revisit the minting");
});

test("the register manual's incumbent paragraph carries sentence 4, character for character, once", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const unit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register", "unit.md"), "utf8");
  const S4 = "Read an owner's portfolio as far as it answers a question about this owner: can it block, would it, and what kind of filer it is. Never its whole register because it is an incumbent.";
  assert.equal(unit.split(S4).length - 1, 1);
  const para = unit.split("\n").find((l) => l.startsWith("- **`incumbent-class`**"));
  assert.ok(para?.includes(S4), "it sits in the incumbent-class paragraph");
});
