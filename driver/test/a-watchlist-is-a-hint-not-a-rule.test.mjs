// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WATCHLIST IS A HINT, NOT A RULE. The watchlist of enforcers, brand owners and competitors, and the
// frame's off-field sectors, tell the reading where to look. They never decide by themselves what is carried
// or what can lead the report (ruled 2026-09-25). The manuals said otherwise: a watchlist-flagged row
// entered the findings "regardless of relevance-gate result", synthesis included it "regardless of
// legal-test result", and an off-field sector was "categorically excluded from headline risk".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const skill = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", rel), "utf8");

test("no manual lets a watchlist carry a finding, or an off-field sector exclude one", () => {
  const digest = skill("clearance-register/digest.md");
  const synthesis = skill("clearance-search/synthesis-rules.md");
  const frame = skill("matter-frame/SKILL.md");
  assert.ok(digest.includes("### Step 5 — Apply watchlists") && synthesis.includes("## Watchlist findings")
    && frame.includes("### Off-field sectors"), "guard: the manuals were read");
  for (const carried of [/always include/, /regardless of relevance-gate/, /override the gate/, /can only ever ADD a finding/, /exists to \*guarantee\*/])
    assert.doesNotMatch(digest, carried, `the digest lets a watchlist carry a finding: ${carried}`);
  for (const carried of [/automatic inclusion/, /regardless of legal-test/])
    assert.doesNotMatch(synthesis, carried, `synthesis lets a watchlist carry a finding: ${carried}`);
  assert.doesNotMatch(frame, /categorically excluded from headline risk/, "the frame lets an off-field sector exclude a finding");
});
