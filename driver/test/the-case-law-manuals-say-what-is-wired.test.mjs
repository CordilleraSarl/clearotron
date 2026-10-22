// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CASE-LAW MANUALS SAY WHAT IS WIRED, NOT WHAT IS FREE.
//
// The case-law manuals told the model which sources were free, that grounding every finding was cost-prohibitive,
// that one tool was a cheap pre-flight, and that a vendor's API had a free tier. What the model needs is whether this
// skill can query a source, and nothing about price. This holds the ruled lines and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "case-law-citation");
const flat = (rel) => readFileSync(join(DIR, rel), "utf8").replace(/\s+/g, " ");

test("the case-law manual says which sources are wired here, and grounds a batch because grounding all is slow", () => {
  const skill = flat("SKILL.md");
  for (const now of ["Boards-of-Appeal decisions — no API wired here today)", "Grounding all findings is slow and low-signal.",
    "**EUIPO Boards-of-Appeal** has no source wired here today", "The wired sources give citation *networks*",
    "have no API wired here and are not searched."])
    assert.ok(skill.includes(now), now);
  for (const gone of ["cost-prohibitive", "no free API", "no free source", "Free sources"])
    assert.ok(!skill.includes(gone), `the case-law manual still says "${gone}"`);
});

test("the source manuals say what is wired and name no price", () => {
  const eurlex = flat("sources/eurlex.md"), ldh = flat("sources/legaldatahunter.md"), cl = flat("sources/courtlistener.md");
  assert.ok(eurlex.includes("full text, no account."));
  assert.ok(eurlex.includes("have no API wired here and are"));
  assert.ok(ldh.includes("there is no source wired here today"));
  assert.ok(cl.includes("5000 requests/day."));
  assert.ok(cl.includes("One-request pre-flight:"));
  for (const [name, text, gone] of [["EUR-Lex", eurlex, "free,"], ["EUR-Lex", eurlex, "no free API"], ["LegalDataHunter", ldh, "no free source"],
    ["CourtListener", cl, "free tier"], ["CourtListener", cl, "Cheap pre-flight"]])
    assert.ok(!text.includes(gone), `the ${name} manual still says "${gone}"`);
});
