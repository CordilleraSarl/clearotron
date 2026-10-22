// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE LEGACY WEB PATH SEARCHES WHAT THE FRAME NAMES.
//
// Without a grid spec, the web manual's legacy path took every variant in the manifest as a search term, made a
// field-scoped search mandatory whenever the matter left the customer's field and ran it for every term, and said the
// narrative reviewer would block delivery. The search terms are the variants the frame's grid names; the field search
// runs once, for the mark, where the frame names a field outside the customer's own; and the reviewer flags in the
// audit workbook rather than blocks. This holds the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "clearance-common-law");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");
const manual = flat("SKILL.md");
const prompts = flat("perplexity-prompts.md");

test("the legacy grid takes the variants the frame's grid names", () => {
  assert.ok(manual.includes("- The variants the frame's grid names (the program's SEARCH TERMS array)"));
  assert.ok(prompts.includes("SEARCH TERMS ([N]): [JSON array of the variants the frame's grid names]"));
  assert.ok(!manual.includes("ALL variants from the Variants table"), "the web manual still takes every variant");
  assert.ok(!prompts.includes("every variant from the manifest's Variants table"), "the grid prompt still takes every variant");
});

test("the field search runs once, for the mark, where the frame names a field outside the customer's own", () => {
  assert.ok(manual.includes("- **Field-scoped general search** — when the frame names a field outside the customer's own (the profile's "
    + "industry — e.g. a collaboration or goods outside it), a general internet search **scoped to the collaborated / actual goods** is "
    + "also run (e.g. a gaming × pizza collab → search the web generally for *pizza*). Extend with field-scoped cells when the frame names "
    + "a field outside the customer's own. Scope to the specific goods the brief instructs — not a fixed per-field platform list"));
  assert.ok(manual.includes("- **Field-scoped general-web cell (when the frame names a field outside the customer's own):** one extra cell "
    + "for the mark combined with the collaborated / actual goods the brief instructs — e.g. for a gaming × pizza collab, a "
    + "`\"<mark> pizza\"` cell."));
  assert.ok(prompts.includes("Where the frame names a field outside the customer's own, run one general-web search of the mark combined with"));
  for (const gone of ["the matter goes outside the customer's core field", "is also mandatory", "one extra cell per term", "`\"<term> pizza\"` cells"])
    assert.ok(!manual.includes(gone), `the web manual still says "${gone}"`);
  for (const gone of ["the matter goes outside the customer's core field", "for each search term run one general-web search of the term"])
    assert.ok(!prompts.includes(gone), `the grid prompt still says "${gone}"`);
});

test("the narrative reviewer flags an untraced publisher in the audit workbook, and blocks no delivery", () => {
  assert.ok(manual.includes("will flag in the audit workbook any case where the orchestrator's narrative names a publisher / developer that "
    + "doesn't trace back to one of these extracted fields."));
  assert.ok(!manual.includes("BLOCK delivery"), "the web manual still says the reviewer blocks delivery");
});
