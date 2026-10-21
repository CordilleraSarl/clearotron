// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the manuals each model stage declares, read from the tree
//
// THE REVIEW AND THE REPORT WRITERS ARE GIVEN NO DUTY THEIR OTHER INSTRUCTIONS CONTRADICT.
//
// The reviewer was told to take the frame's off-field judgment as ground truth and never reconsider it, while the
// same review is told to check placement's grounds against the evidence. The overview and the cards were told to
// assign each finding a band by customer difference, while their forms cannot change a finding's disposition, which
// is what chooses the band a card renders in. Each now reads one reconciled sentence (design's wording, 2026-10-19).
// That each declared manual reaches its stage on both engines is the instruction-files check's to prove.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSkillReads } from "../stages.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const manualsOf = (stage) => resolveSkillReads(stage, { profile: null, job: {} }).map((rel) => ({ rel, text: readFileSync(join(DRIVER, rel), "utf8") }));
const flat = (s) => s.replace(/\s+/g, " ");

test("the reviewer checks the coverage list and placement's grounds, and is no longer told the frame is beyond question", () => {
  const manuals = manualsOf("narrative-refutation");
  assert.ok(manuals.some((m) => m.rel === "skills/narrative-refutation/SKILL.md"), "premise: the reviewer reads its own manual");
  const all = flat(manuals.map((m) => m.text).join("\n"));
  assert.ok(all.includes("**Use `matter-frame`'s material-jurisdiction list as your coverage checklist.** Confirm that the run actually searched, or honestly deferred, every jurisdiction it called material. Check the grounds of validated placement decisions against the evidence; flag an unsupported decision."),
    "the reviewer does not read the reconciled coverage and grounds duty");
  assert.doesNotMatch(all, /second-guess matter-context|do NOT re-decide what is off-field/, "the reviewer is still told the frame's off-field call is beyond question");
});

test("the overview and the cards render the band the finding's disposition chooses, and are no longer told to choose it", () => {
  for (const stage of ["report-overview", "report-card"]) {
    const manuals = manualsOf(stage);
    assert.ok(manuals.some((m) => m.rel === "skills/clearance-search/delivery-contract.md"), `premise: ${stage} reads the delivery contract`);
    const all = flat(manuals.map((m) => m.text).join("\n"));
    assert.ok(all.includes("**Curation:** The finding's disposition chooses the report band a card renders in; it never recomputes the finding's rating. Mirror the run's actual data."),
      `${stage} does not read the reconciled curation sentence`);
    assert.doesNotMatch(all, /identical-mark-but-different-customer findings go \*\*off-field\*\*/, `${stage} is still told to choose the band by customer difference`);
  }
});
