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

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("a crowd's market step uses the one list, and a major the list does not name stays in the crowd's count", () => {
  const skill = flat("SKILL.md"), unit = flat("unit.md"), recipes = flat("register-recipes.md");
  assert.ok(skill.includes("When the in-scope sweep returns `incomplete` as a crowd, narrow it by the steps in *Read the identical mark first*: "
    + "their market step uses the one list your opening message names, and a major or material jurisdiction the list does not name is not asked "
    + "on its own; it stays in the crowd's count."));
  assert.ok(unit.includes("When the worldwide question is a crowd, its market step uses the one list your opening message names; a major the list "
    + "does not name is not asked on its own and stays in the crowd's count."));
  assert.ok(unit.includes("The identical mark for the client's goods, still a crowd in a market on the one list your opening message names, is not done."));
  assert.ok(recipes.includes("Their market step uses the one list your opening message names: "
    + "`register_enumerate name:<root> match=default nice_classes:<target> regions:[<market>]`"));
  assert.ok(recipes.includes("then one market at a time from the one list your opening message names:"));
  for (const [name, text] of [["SKILL.md", skill], ["unit.md", unit], ["register-recipes.md", recipes]]) {
    for (const gone of ["A slice gets its OWN `register_enumerate` call only on the guarded crowd-narrow path", "the per-major region-scoped band",
      "A major gets its own question only when the worldwide question was a crowd", "run its per-major / phonetic passes", "(per major region)",
      "Per-major enumerate ONLY for a major Step 2 left under-covered", "or enumerate per major when Step 2 is incomplete",
      "asked region-scoped only when it was a crowd", "still a crowd in a main market"])
      assert.ok(!text.includes(gone), `${name} still says "${gone}"`);
  }
});

test("before narrowing a wider crowd, judgment writes what reading it would change, or sets it aside", () => {
  const condition = "The same steps serve any other question that comes back as a crowd, when reading it would change what you tell the client. "
    + "Before you narrow a wider crowd, write in the proposal what reading it would change. If you cannot, set it aside with its count and your "
    + "reason. You need not take every step on every crowd.";
  for (const m of ["SKILL.md", "unit.md"]) assert.ok(flat(m).includes(condition), `${m} does not carry the condition sentence`);
});

test("the shared manual and the provider notes carry no price words", () => {
  assert.ok(flat("SKILL.md").includes("**EUIPO covers the EU alone.** Running it makes every non-EU territory a deferred row — a known limit of "
    + "that register, not a fault."));
  const corsearch = flat("providers/corsearch.md");
  assert.ok(corsearch.includes("Don't run multiple separate phonetic searches — they make more requests and return largely overlapping results."));
  assert.ok(corsearch.includes("## Request limits"));
  assert.ok(flat("providers/signa.md").includes("It is ONE call, not three."));
  const all = ["SKILL.md", "register-recipes.md", "providers/corsearch.md", "providers/signa.md"].map(flat).join(" ");
  for (const gone of ["and is free", "the honest trade", "costs more", "## API budget", "no extra spend", "do NOT spend"])
    assert.ok(!all.includes(gone), `the register manuals still say "${gone}"`);
});
