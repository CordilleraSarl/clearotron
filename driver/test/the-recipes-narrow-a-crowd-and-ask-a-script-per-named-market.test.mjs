// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE RECIPES NARROW A CROWD, AND ASK A SCRIPT ONLY FOR A MARKET THE FRAME NAMES.
//
// The register recipes said no step narrows a crowd, and their transliteration recipe ran on any worldwide order, for
// every transliteration in the manifest, on the claim that most registers store non-Latin marks in their own script.
// The ruled method narrows a crowd by the steps in unit.md and asks one script question per market the frame names; a
// register that files foreign marks by their romanised form needs no script question at all. This holds the ruled
// lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const recipes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register", "register-recipes.md"), "utf8")
  .replace(/\s+/g, " ");

test("no recipe step denies the narrowing: a crowd is narrowed by the steps in unit.md", () => {
  assert.ok(recipes.includes("**No recipe step samples a top-N; a crowd is narrowed by the steps in unit.md.**"));
  assert.ok(recipes.includes("Each named slice is scoped by class and region (breadth, not sufficiency), and `register_enumerate` pages it to "
    + "completion or returns `incomplete`; a crowd is narrowed by the steps in unit.md, which stop at the first list you can read."));
  for (const gone of ["narrows-for-tractability", "narrow-to-tractable-and-stop"])
    assert.ok(!recipes.includes(gone), `the recipes still say "${gone}"`);
});

test("the transliteration recipe asks one script question per market the frame names", () => {
  for (const ruled of [
    "## Recipe 5 — Foreign-language transliteration **When to use:** the frame names a market whose buyers read a non-Latin script.",
    "(#recipe-5--foreign-language-transliteration)",
    "Ask one script question per market the frame names. Where the register files foreign marks by their romanised form, and it says so, the "
      + "Latin question already covers them; do not ask it again in other scripts. For each script question you ask:",
    "**Breadth note.** The script questions here are owned by the `transliteration-numeric` unit. `register_enumerate` owns each query's page loop.",
  ]) assert.ok(recipes.includes(ruled), `the recipes do not say "${ruled.slice(0, 90)}…"`);
  for (const gone of ["For each transliteration variant in the manifest", "most providers store non-Latin marks in their native script",
    "(worldwide / multi-region scope)", "the unit runs every variant query the manifest declares", "per-jurisdiction named queries"])
    assert.ok(!recipes.includes(gone), `the recipes still say "${gone}"`);
});
