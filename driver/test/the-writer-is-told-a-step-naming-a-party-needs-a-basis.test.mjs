// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITER'S FIRST DRAFT IS TOLD THAT A STEP NAMING A CONFLICT PARTY NEEDS A BASIS THE PAGE INTRODUCES.
//
// The delivery check's reference check fails a step that names a party nothing on the page introduces. In testing
// (2026-11-17) first drafts wrote such steps with no broken citation, so the citation repair never reached them. The
// writer's instruction for the actions register now says where such a party must be introduced, in design's words
// (2026-11-17). The writer's repair of a step's citations and the correction's steps carry the same rule; their own
// tests pin those lines. The Knockout lane writes no steps, so it carries nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASIS = "An action naming a conflict party must have a basis in the surviving assessment, with that party introduced in a delivered finding or through the existing open identification route for an otherwise eligible unidentified-proprietor lead. Do not introduce a party only in the action, retain a demand whose basis you rejected, or create a finding solely to satisfy the reference check.";

test("the writer's actions register instruction carries the rule, after the rule that no named step is left out", () => {
  const dispatch = readFileSync(join(DRIVER, "stages.mjs"), "utf8");
  const register = dispatch.split("\n").filter((l) => l.includes("ACTIONS REGISTER (MANDATORY top-level field"));
  assert.equal(register.length, 1, "the writer's actions register instruction is not one line of the dispatch");
  assert.ok(register[0].includes(`never invent an action, and never leave a named one out. ${BASIS}`),
    "the instruction does not carry the rule where it was approved");
});
