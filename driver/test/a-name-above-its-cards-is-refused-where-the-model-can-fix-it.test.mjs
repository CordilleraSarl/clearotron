// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NAME RATED ABOVE ITS OWN WORST CARD IS REFUSED WHERE THE MODEL CAN FIX IT.
//
// The rule that a knockout name is never rated above the worst card on its page ran on the merged artifact only.
// The chunk passed, the merged gate failed the stage outside the corrective ladder, and the turn that could rate
// the name again never heard why: the run parked, went back to the register listing and asked the register
// again, and a second sample told nothing could rate the same way. The chunk gate now refuses it in the rule's
// own words, which the chunk's corrective turn carries. The merged gate keeps its check. Invented data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { validators, validateMergedFindings } from "../verify-knockout.mjs";
import { correctiveMessage } from "../gateway.mjs";
import { invented, chunk, merged, mark, finding } from "./ko-fixture-invented.mjs";

test("a name rated above its only card is refused at the chunk, and the corrective turn carries the reason", () => {
  const d = invented();
  const file = join(d, "knockout-assess-0.json");
  const v = validators.knockoutAssessChunk(file, chunk(mark("Severe", [finding("Slight")])));
  assert.equal(v.ok, false, "the chunk passed a name rated above every card on its page");
  assert.match(v.reason, /^knockout_rating_above_cards:TESTMARK: rated "Severe", above every card on its page — the worst is "Slight"/);
  assert.ok(correctiveMessage("Rate this chunk.", 2, `invalid_file:${file}:${v.reason}`, file).includes(v.reason),
    "the corrective turn does not carry the reason, so the model is still never told");
});

test("a name rated at its worst card, or below it, passes the chunk as before", () => {
  const d = invented();
  const file = join(d, "knockout-assess-0.json");
  assert.equal(validators.knockoutAssessChunk(file, chunk(mark("Slight", [finding("Slight")]))).ok, true);
  assert.equal(validators.knockoutAssessChunk(file, chunk(mark("Slight", [finding("Serious")]))).ok, true, "rating below the worst card stays allowed");
});

test("the merged gate keeps its own check, for a record composed from chunks written before this one", () => {
  const out = validateMergedFindings(invented(), merged(mark("Severe", [finding("Slight")])), { marks: [] });
  assert.ok(out.failures.some((x) => x.startsWith("knockout_rating_above_cards:TESTMARK:")));
});
