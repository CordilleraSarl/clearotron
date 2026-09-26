// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ENGINE IS GIVEN NO FIXED CALL BUDGET. How far the web sweep follows up, and how many register calls
// a step makes, is the reading's judgment (ruled 2026-09-25). The manuals still set numbers no code
// enforced: four web calls a mark, three follow-ups and five in all, fifteen calls a run, a workflow cap
// of 150 register calls, five phoneme previews and ten image lookups. A model reads a number like that as
// a stop, whatever it has read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const skill = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", rel), "utf8");

test("the web and register manuals set no call budget", () => {
  const manuals = {
    "clearance-common-law/SKILL.md": skill("clearance-common-law/SKILL.md"),
    "clearance-common-law/perplexity-prompts.md": skill("clearance-common-law/perplexity-prompts.md"),
    "clearance-register/SKILL.md": skill("clearance-register/SKILL.md"),
    "clearance-register/digest.md": skill("clearance-register/digest.md"),
  };
  assert.ok(manuals["clearance-common-law/SKILL.md"].includes("Step 3 — Famous-mark check")
    && manuals["clearance-register/SKILL.md"].includes("| Worker | register_enumerate calls"), "guard: the manuals were read");
  for (const [name, text] of Object.entries(manuals)) {
    for (const budget of [/Budget: /, /\d+-per-mark cap/, /workflow cap/, /up to \d+ follow-up calls/, /Phoneme at \d+/, /image at \d+/, /up to \d+ \((?:phonetic recipes|device-led)\)/])
      assert.doesNotMatch(text, budget, `${name} sets a call budget: ${budget}`);
  }
});
