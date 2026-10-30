// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE READING STEP DECIDES ON A CROWD, AND JUDGMENT IS NOT SOMEONE ELSE'S.
//
// The register manuals told the reading step its work is rule-following, that judgment downstream decides whether to
// narrow a crowd, and that the lawyer decides sufficiency over the whole band. The ruled method has the reading step
// decide on each crowd by the narrowing steps and say in its note why more searching would not change the advice;
// placement reads the band and the write-up rules each slice's coverage. This holds the ruled lines and that the old
// ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-register");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the register manual's unit mode reads its answers and decides, and the digest is not handed all the judgment", () => {
  const manual = flat("SKILL.md");
  for (const ruled of [
    "Unit mode — `saturation-probe` uses `haiku`, with thinking off, for count-only work. `primary-sweep` uses `opus`, with adaptive thinking, to run the plan, read its answers, and decide which further searches could change the advice. `transliteration-numeric` and `incumbent-class` use `sonnet`, with adaptive thinking.",
    "Register units execute searches and decide which further questions could change the advice. The primary sweep uses the judgment model for that decision. The digest assesses the evidence carried forward. The driver selects each stage's model; a unit does not choose its own replacement.",
  ]) assert.ok(manual.includes(ruled), `the register manual does not say "${ruled.slice(0, 80)}…"`);
  for (const gone of ["nuanced rule-following, not open analysis", "All the precision-critical judgment lives here",
    "units execute (smaller model tiers), the digest worker judges", "re-spawns it escalated to Opus"])
    assert.ok(!manual.includes(gone), `the register manual still says "${gone}"`);
  const orchestration = readFileSync(join(DIR, "..", "clearance-search", "phase2-execution.md"), "utf8").replace(/\s+/g, " ");
  assert.ok(!orchestration.includes("opus judgment happens once, at the re-digest"), "the orchestration manual still puts all the opus judgment at the digest");
});

test("the unit manual has the unit decide on each crowd, and writes its reason as the note", () => {
  const unit = flat("unit.md");
  for (const ruled of [
    "an incomplete result crosses the firewall as an incomplete block, and you decide on it by the narrowing steps: narrow it, or record it with its count and move on.",
    "Read the count and decide by the narrowing steps whether a narrower named question inside it would change what you tell the client.",
    "the prose carries no clearance verdict. Your one line on why more searching would not change the advice is the `note` you send.",
    "you decide on each `incomplete` by the narrowing steps, and the write-up rules each slice's coverage.",
  ]) assert.ok(unit.includes(ruled), `the unit manual does not say "${ruled.slice(0, 80)}…"`);
  for (const gone of ["judgment decides whether to command a narrower enumeration", "Judgment reads the count and decides",
    "no clearance verdict and no sufficiency claim", "the lawyer reads the band and decides sufficiency"])
    assert.ok(!unit.includes(gone), `the unit manual still says "${gone}"`);
});

test("the recipes give the write-up and placement their own work, and the crowd to the narrowing steps", () => {
  const recipes = flat("register-recipes.md");
  for (const ruled of [
    "the write-up (Layer B) performs the cross-cutting relevance / owner-aggregation / prioritisation over the candidates placement carried forward.",
    "Placement reads the band; a crowd is narrowed by the steps in unit.md.",
    "You decide on each `incomplete` by the narrowing steps; placement reads the band and decides relevance.",
    "That `incomplete` block is never a clean; you decide on it by the narrowing steps: narrow it, or record it with its count and "
      + "move on. The funnel does not \"narrow and re-probe until tractable, then call it clean\" — it surfaces the descriptor, and you decide on it.",
  ]) assert.ok(recipes.includes(ruled), `the recipes do not say "${ruled.slice(0, 80)}…"`);
  for (const gone of ["relevance / sufficiency / owner-aggregation", "The lawyer reads the complete band", "the signal to judgment",
    "lets judgment command"])
    assert.ok(!recipes.includes(gone), `the recipes still say "${gone}"`);
});
