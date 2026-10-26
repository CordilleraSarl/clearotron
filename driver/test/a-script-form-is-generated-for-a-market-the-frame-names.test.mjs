// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A SCRIPT FORM IS GENERATED FOR A MARKET THE FRAME NAMES, NOT FOR EVERY SCRIPT ON A WORLDWIDE ORDER.
//
// The variants manuals generated every script on a worldwide order: transliterations "always for worldwide/
// multi-region scope", all eight scripts in the worldwide row, and "when in doubt: generate them". The ruled method
// generates one script form per market the frame names whose buyers read a non-Latin script; a market it does not name
// gets none. The driver's own script floor already asks nothing more on a worldwide order. This holds the ruled lines
// and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-variants");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the variants manual generates one script form per market the frame names", () => {
  const manual = flat("SKILL.md");
  for (const ruled of [
    "| foreign-transliteration | One script form per market the frame names whose buyers read a non-Latin script.",
    "| variant | foreign-transliteration | applied | one per market the frame names whose buyers read a non-Latin script | — |",
    "runs for each market the frame names whose buyers read a non-Latin script, or for a non-Latin mark; drop where no such market is named",
    "- [ ] Foreign transliterations generated, one per market the frame names whose buyers read a non-Latin script",
  ]) assert.ok(manual.includes(ruled), `the variants manual does not say "${ruled}"`);
  for (const gone of ["Always for worldwide/multi-region scope", "6 variants — worldwide scope", "runs for worldwide / multi-region scope",
    "generated for worldwide/multi-region scope"])
    assert.ok(!manual.includes(gone), `the variants manual still says "${gone}"`);
});

test("the script table gives a worldwide order the script of each market the frame names, and no others", () => {
  const scripts = flat("transliteration-scripts.md");
  assert.ok(scripts.includes("| **Worldwide / global** | The script of each market the frame names, one per market |"));
  assert.ok(scripts.includes("Generate the script of each market the frame names; a market it does not name gets no script form."));
  assert.ok(scripts.includes("so that a market the frame names in those scripts has its script"));
  for (const gone of ["All 8 below", "When in doubt: generate them", "so that every script the portal offers is also generated as standard"])
    assert.ok(!scripts.includes(gone), `the script table still says "${gone}"`);
});
