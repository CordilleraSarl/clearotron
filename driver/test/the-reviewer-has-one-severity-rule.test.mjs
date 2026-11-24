// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWER HAS ONE SEVERITY RULE (design's audit, 2026-11-24).
//
// The verdict logic defined CONDITIONAL as one to three correctable flags, and a later paragraph allowed any number of
// minor flags and let one material flag block. So a review with four minor defects had two answers. The count is gone:
// the reviewer lists every correctable defect and the severity grounds choose the verdict. No code derives the verdict
// from a count (the record tool asks only that a BLOCKING name a flag), so the manual is what this pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MANUAL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "narrative-refutation", "SKILL.md"), "utf8");
const logic = MANUAL.slice(MANUAL.indexOf("## Verdict logic"), MANUAL.indexOf("## What NOT to do"));

test("the verdict is chosen by severity, never by how many flags there are", () => {
  assert.ok(logic.startsWith("## Verdict logic\n\nList every correctable defect. Choose the verdict by the severity grounds below.\n"));
  assert.doesNotMatch(logic, /\b1-3 flags|one to three flags|up to three flags/i, "a count still decides CONDITIONAL");
  assert.match(logic, /\*\*CONDITIONAL\*\*: every flag is fixable with a small narrative edit .*and none is a BLOCKING ground below\./);
  // Four minor defects are CONDITIONAL, and one material defect is BLOCKING: the paragraph that says so stays.
  assert.match(logic, /Total flag count is NOT itself a blocking criterion/);
  assert.match(logic, /A run with one material flag .* is BLOCKING regardless of total count/);
});
