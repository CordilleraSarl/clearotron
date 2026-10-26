// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SATURATION CROWD THAT WOULD CHANGE THE ADVICE IS NARROWED.
//
// The saturation recipe said a crowd is described and a named slice enumerated, "nothing in between". The same steps
// that narrow any other crowd serve this one where reading it would change the advice. This holds the ruled line and
// that the old one is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the saturation recipe narrows a crowd that reading would change the advice on", () => {
  const recipes = flat("register-recipes.md");
  assert.ok(recipes.includes("The crowd is *described* (count) and the named slices are *enumerated*; a crowd that reading would change the "
    + "advice on is narrowed by the steps in unit.md."));
  assert.ok(!recipes.includes("nothing in between"), "the saturation recipe still allows nothing between a count and an enumeration");
});
