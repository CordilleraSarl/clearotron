// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CROWD'S MARKET STEP USES THE ONE LIST, AND A WIDER CROWD SAYS WHAT READING IT WOULD CHANGE.
//
// The narrowing steps give a crowd one market step, on the one market list the opening message names. Lines
// elsewhere in the register manuals still sent a crowd to each major market on its own, beside that list, and a
// test run of a crowded matter followed them. Each now hands a crowd to the narrowing steps, and a major the list
// does not name stays in the crowd's count. Before narrowing a wider crowd, judgment writes what reading it would
// change, or sets it aside with its count and its reason. The last price words leave the shared manual and the
// provider notes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UNIT_SENTENCES } from "./ruled-sentences-unit.mjs";
import { REGISTER_SENTENCES } from "./ruled-sentences-register.mjs";
import { RECIPES_SENTENCES } from "./ruled-sentences-register-recipes.mjs";
import { CORSEARCH_SENTENCES } from "./ruled-sentences-corsearch.mjs";
import { SIGNA_SENTENCES } from "./ruled-sentences-signa.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("a crowd's market step uses the one list, and a major the list does not name stays in the crowd's count", () => {
  const skill = flat("SKILL.md"), unit = flat("unit.md"), recipes = flat("register-recipes.md");
  assert.ok(skill.includes(REGISTER_SENTENCES.whenTheScopeSweepReturns));
  assert.ok(unit.includes(UNIT_SENTENCES.whenTheWorldwideQuestionCrowd));
  assert.ok(unit.includes(UNIT_SENTENCES.theIdenticalMarkForThe));
  assert.ok(recipes.includes(RECIPES_SENTENCES.theirMarketStepUsesThe));
  assert.ok(recipes.includes(RECIPES_SENTENCES.thenOneMarketTimeFrom));
  for (const [name, text] of [["SKILL.md", skill], ["unit.md", unit], ["register-recipes.md", recipes]]) {
    for (const gone of ["A slice gets its OWN `register_enumerate` call only on the guarded crowd-narrow path", "the per-major region-scoped band",
      "A major gets its own question only when the worldwide question was a crowd", "run its per-major / phonetic passes", "(per major region)",
      "Per-major enumerate ONLY for a major Step 2 left under-covered", "or enumerate per major when Step 2 is incomplete",
      "asked region-scoped only when it was a crowd", "still a crowd in a main market"])
      assert.ok(!text.includes(gone), `${name} still says "${gone}"`);
  }
});

test("before narrowing a wider crowd, judgment writes what reading it would change, or sets it aside", () => {
  const condition = UNIT_SENTENCES.theSameStepsServeAny;
  for (const m of ["SKILL.md", "unit.md"]) assert.ok(flat(m).includes(condition), `${m} does not carry the condition sentence`);
});

test("the shared manual and the provider notes carry no price words", () => {
  assert.ok(flat("SKILL.md").includes(REGISTER_SENTENCES.euipoCoversTheAloneRunning));
  const corsearch = flat("providers/corsearch.md");
  assert.ok(corsearch.includes(CORSEARCH_SENTENCES.donRunMultipleSeparatePhonetic));
  assert.ok(corsearch.includes("## Request limits"));
  assert.ok(flat("providers/signa.md").includes(SIGNA_SENTENCES.oneCallNotThree));
  const all = ["SKILL.md", "register-recipes.md", "providers/corsearch.md", "providers/signa.md"].map(flat).join(" ");
  for (const gone of ["and is free", "the honest trade", "costs more", "## API budget", "no extra spend", "do NOT spend"])
    assert.ok(!all.includes(gone), `the register manuals still say "${gone}"`);
});
