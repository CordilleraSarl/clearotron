// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWER AND THE PROMPTS ARE GIVEN NO PRICE.
//
// Four manuals the model reads still priced its work: the plugin's deepest tier as "the most expensive", a metadata
// footer as "tokens, cost", a backstop check as "cheap insurance", a re-run as "paid", an audit as "cheap" beside an
// "Opus escalation", the register vendor as "paid", and a tool-call budget sized to a billing tier. The ruling is that
// nothing the model reads names a price or a limit. This holds the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the web prompts name the deepest tier, not the most expensive, and a footer without its cost", () => {
  const prompts = flat("clearance-common-law/perplexity-prompts.md");
  assert.ok(prompts.includes("routes grid-shaped prompts to the deepest tier)."));
  assert.ok(prompts.includes("→ a metadata footer. Then:"));
  for (const gone of ["most expensive tier", "(tokens, cost)"])
    assert.ok(!prompts.includes(gone), `the web prompts still say "${gone}"`);
});

test("the narrative reviewer keeps its backstop checks as insurance, not cheap insurance", () => {
  const reviewer = flat("narrative-refutation/SKILL.md");
  assert.equal(reviewer.split("insurance against a diff that missed something").length - 1, 2);
  assert.ok(!reviewer.includes("cheap insurance"), "the narrative reviewer still calls a check cheap");
});

test("phase two prices no re-run and no audit", () => {
  const phase2 = flat("clearance-search/phase2-execution.md");
  assert.ok(phase2.includes("a passing mention never triggers a re-run,"));
  assert.ok(phase2.includes("comes from a fresh-eyes audit plus targeted escalation, not from one giant session."));
  for (const gone of ["paid re-run", "cheap fresh-eyes", "Opus escalation"])
    assert.ok(!phase2.includes(gone), `phase two still says "${gone}"`);
});

test("the old spine names a register vendor, not a paid one, and sets no tool-call budget", () => {
  const spine = flat("clearance-search/SKILL.md");
  assert.ok(spine.includes("Your tool surface binds **one register vendor** plus"));
  assert.ok(spine.includes("- **Register vendor = the register source of truth**"));
  for (const gone of ["one paid register vendor", "**Paid vendor", "## Tool call budget", "(#tool-call-budget)", "usage-billed", "billing-tier ceiling"])
    assert.ok(!spine.includes(gone), `the old spine still says "${gone}"`);
});
