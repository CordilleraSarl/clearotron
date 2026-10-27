// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GOODS-TEST MISS IS NOT CALLED "OTHER GOODS".
//
// Group (b) holds the identical marks in the ordered classes whose goods matched none of the client's product words. A
// keyword match that failed is not a finding that the goods are unrelated, but the group's crowd sentence called them
// marks "for other goods than the client's", and placement's manual said the crowd's row stands for such a mark once
// its line was read. The sort stays as it is; the words now say what the test found, and the row covers a floor only
// once its line is read and its goods are not the client's. Every mark, owner and goods line is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBandShape, CROWDED_GROUP_RECORDS, A_CROWDS_ROW_COVERS_A_READ_FLOOR } from "../band-shape.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const rec = (id, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: "Qzorvak", owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
const goods = { of: () => [{ classes: ["9"], text: "printers" }], hits: goodsWordCounter(["game controllers", "joysticks"]), matched: goodsWordsMatched(["game controllers", "joysticks"]) };

test("a crowded (b) says its marks' goods name none of the client's product words, never that they are other goods", () => {
  const records = Array.from({ length: CROWDED_GROUP_RECORDS }, (_, i) => rec(`n${i}`, `Owner ${String(i).padStart(4, "0")} Ltd`));
  const { md } = buildBandShape({ enumerated: records }, { targets: ["Qzorvak"], inScopeClasses: ["9"], goods, goodsWordCount: 2,
    dominantTerm: "Qzorv", manifestDominant: "Qzorvak", markets: ["EU"], caps: { owners: 5 } });
  const b = md.slice(md.indexOf("### (b)"), md.indexOf("### (c)"));
  assert.ok(b.includes("These are identical marks in the ordered classes whose goods name none of the client's product words."), b.slice(0, 400));
  assert.ok(!b.includes("other goods"), "the group still calls a goods-test miss other goods");
  assert.ok(b.includes("This row covers a floor only once you have read its line and its goods are not the client's goods."));
});

test("the crowd's row covers a floor once its line is read and its goods are not the client's, in the contract and the manual", () => {
  assert.equal(A_CROWDS_ROW_COVERS_A_READ_FLOOR, "This row covers a floor only once you have read its line and its goods are not the client's goods.");
  const manual = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "placement-inquiry", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(manual.includes("or sits in a crowd of a thousand or more identical marks and its goods, read on its line, are not the client's goods, "
    + "where the crowd's row stands for it;"));
  assert.ok(!manual.includes("identical marks for other goods"), "the placement manual still calls a goods-test miss other goods");
});
