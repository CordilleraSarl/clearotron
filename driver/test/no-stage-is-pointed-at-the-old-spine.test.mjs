// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// NO STAGE CAN REACH THE OLD ORCHESTRATOR SPINE.
//
// No stage declares the old orchestrator spine, but two manuals stages do declare linked into it: phase two's unit
// brief, to its register-sources section, and the web manual, to its search-approval section. The spine still carries
// the funnel era's duties, so a worker that followed either link read rules the method no longer has. Both links go.
// The spine's own lines that name a per-market sub-query, a row per material market, a price word or a re-run before
// sending now follow the ruled method, and it says no stage reads it. This holds that no chain of links from any file
// a stage declares reaches the spine, the ruled lines, and that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

import { DRIVER, SKILLS, everyModelStageDispatch } from "./model-stage-dispatches.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const SPINE = resolve(SKILLS, "clearance-search", "SKILL.md");
const flat = (rel) => readFileSync(join(SKILLS, rel), "utf8").replace(/\s+/g, " ");

test("no chain of links from a file any stage declares reaches the spine", () => {
  const declared = new Set(everyModelStageDispatch("/nonexistent/invented-run").flatMap((d) => d.declared).map((rel) => resolve(DRIVER, rel)));
  // The register search reads whichever provider's manual is active; every one is a starting point.
  const providers = join(SKILLS, "clearance-register", "providers");
  for (const name of nonEmpty(readdirSync(providers), "the provider manuals")) if (name.endsWith(".md")) declared.add(resolve(providers, name));
  assert.ok(declared.size > 20, "guard: the stages' declared files were found");
  assert.ok(!declared.has(SPINE), "a stage declares the spine");
  const seen = new Set(), queue = [...declared], reached = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || !file.endsWith(".md") || !existsSync(file)) continue;
    seen.add(file);
    for (const [, target] of readFileSync(file, "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
      const path = target.split("#")[0];
      if (!path || /^[a-z]+:/i.test(path)) continue;
      const next = resolve(dirname(file), path);
      if (next === SPINE) reached.push(`${relative(SKILLS, file)} → ${target}`);
      else queue.push(next);
    }
  }
  assert.ok(seen.size > declared.size, "guard: the walk followed links beyond the declared files");
  assert.deepEqual(reached, []);
});

test("the unit brief names the active provider and no sub-budget, and the web manual states the approval itself", () => {
  const phase2 = flat("clearance-search/phase2-execution.md");
  assert.ok(phase2.includes("the **active register provider** and its output path (`register-units/<axis>.md`)."));
  assert.ok(!phase2.includes("the sub-budget"), "phase two still hands a unit a sub-budget");
  const web = flat("clearance-common-law/SKILL.md");
  assert.ok(web.includes("This workflow's searches are pre-approved at workflow trigger time, when the requesting lawyer or a staff lawyer "
    + "forwards the request email."));
});

test("the spine says no stage reads it, and its lines follow the ruled method", () => {
  const spine = flat("clearance-search/SKILL.md");
  for (const now of [
    "and is NOT read by the integrator agent. No stage reads this file; each stage's message names the manual it reads.",
    "## Register sources — the active vendor is the source of truth",
    "- [Register sources — the active vendor is the source of truth](#register-sources--the-active-vendor-is-the-source-of-truth)",
    "plus case-law citation tools",
    "referred to the two vendors of that time",
    "5. **Skeptic review** — a fresh-eyes coverage check; a unit with a gap its register can close is re-run",
    "every `matter-context` material jurisdiction is accounted for — by a ledger row, by a complete worldwide answer, or inside the count "
      + "of a crowd the identical mark's narrowing left;",
    "Detail-fetch: ✅ <count> URIs",
    "Downstream (Phase 1 variants, Phase 2 register units, Touchpoint 2 placement, Touchpoint 3 refutation)",
    "Every ⏭ or ⚠ MUST have a stated reason. A line without one still sends, with its gap named.",
  ]) assert.ok(spine.includes(now), now);
  for (const gone of ["is read by the pipeline stages", "per-jurisdiction sub-queries", "Per-jurisdiction sub-queries", "free EU cross-check",
    "free / citation tools", "*paid vendors*", "escalated to opus", "coverage check against floors", "material jurisdiction has a row",
    "under-25", "re-run the missing step rather than send", "stays cheaply in context"])
    assert.ok(!spine.includes(gone), `the spine still says "${gone}"`);
});
