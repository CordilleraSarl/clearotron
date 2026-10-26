// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE VARIANTS STAGE IS NOT ASKED FOR A QUESTION PER MARKET.
//
// The variants stage's opening message asked for "per-jurisdiction sub-queries" in the manifest, beside the elements,
// the archetype and the per-axis searches. The ruled method asks a crowd's markets from the one list the register's
// opening message names, so the manifest owes no question per market. This holds the ruled line and that the old one
// is gone. The mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, paths } from "../stages.mjs";

test("the variants stage is asked for elements, archetype and per-axis searches, and no per-market question", () => {
  const message = STAGES["clearance-variants"].message({ paths: paths("/r"), job: { marks: ["ORBANTIQ"], jurisdictions: ["US"] }, profile: null });
  assert.ok(message.includes("Generate the variant manifest (elements, archetype, per-axis searches)."));
  assert.ok(!message.includes("per-jurisdiction sub-queries"), "the variants stage is still asked for a question per market");
});
