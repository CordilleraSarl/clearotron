// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// PLACEMENT READS A NARROWED ANSWER AS AN ANSWER.
//
// The placement manual said nothing upstream narrows a crowd, told placement never to let the gathering narrow one, and
// ruled a saturated element with no enumerated exact slice a material gap even where a narrowed list that was read
// answered it. The register digest's checklist said the same. The ruled method narrows a crowd until it gives a list
// a lawyer can read, so a narrowed list that was read answers the slice. This holds the ruled wording and that the
// old is gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const flat = (rel) => readFileSync(join(SKILLS, rel), "utf8").replace(/\s+/g, " ");

test("the placement manual no longer says nothing upstream narrows a crowd", () => {
  const manual = flat("placement-inquiry/SKILL.md");
  assert.ok(manual.includes("You never tell it to sample or take a top-N."));
  assert.ok(manual.includes("No \"sample this\", no \"top-N\"."));
  for (const gone of ["There is no third \"coverage-limited and move on\" state anywhere upstream.", "narrow-for-tractability", "\"narrow to tractable\""])
    assert.ok(!manual.includes(gone), `the placement manual still says "${gone}"`);
});

test("a saturated element answered by a narrowed list that was read is not a material gap, in placement and in the digest", () => {
  const manual = flat("placement-inquiry/SKILL.md");
  for (const ruled of [
    "but *no* `enumerated` block for the exact-in-class-live name-list, and no narrowed list that was read answers it, that exact slice is **unsearched, not clean**",
    "A saturated dominant element with no enumerated exact slice, and no narrowed list that was read answering it, is the canonical material gap.",
    "A saturated dominant element with no enumerated exact-in-class-live slice, and no narrowed list that was read answering it, is an unsearched dangerous category, not a clearance.",
  ]) assert.ok(manual.includes(ruled), `the placement manual does not say "${ruled.slice(0, 80)}…"`);
  for (const gone of ["name-list, that exact slice is **unsearched, not clean**", "no enumerated exact slice is the canonical material gap.",
    "no enumerated exact-in-class-live slice is an unsearched dangerous category"])
    assert.ok(!manual.includes(gone), `the placement manual still says "${gone}"`);
  const digest = flat("clearance-register/digest.md");
  assert.ok(digest.includes("saturated field with no enumerated exact-owner slice, and no narrowed list that was read answering it, ruled a material gap"));
  assert.ok(!digest.includes("no enumerated exact-owner slice ruled a material gap"), "the digest's checklist still rules it a gap");
});
