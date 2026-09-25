// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEWER ASKS THE CLIENT'S QUESTION FIRST.
//
// Owner ruling 2026-09-24: the reviewing pass opens on one question, ahead of every check, in the owner's
// words. A reviewer that began on wording spent its attention on sentence length while a finding written
// from the wrong record went through unremarked. These arms pin where the question sits and that it
// reaches the seat on both engines: the reviewer's dispatch opens by ordering its manual read, both
// engines resolve that order to the same file through one function, and the manual's body opens with the
// question, character for character.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES, paths as stagePaths } from "../stages.mjs";
import { absolutizeSkillRefs } from "../engine/anthropic-agent.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANUAL = "skills/narrative-refutation/SKILL.md";

// The owner's sentence, as ruled. A difference of one character here is a new ruling, not a fix.
const FIRST_QUESTION = "Does the report answer the client's question: who could object, how strong they are, "
  + "what the client should do? Are the marks a lawyer would list present, and is each position written from "
  + "the record that matters? Answer that before any check on wording.";

function reviewerMessage() {
  const dir = mkdtempSync(join(tmpdir(), "first-question-"));
  try {
    return STAGES["narrative-refutation"].message({
      paths: stagePaths(dir), intakeAsks: [], job: {}, registerOnly: false, profileSelection: null,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the reviewer's dispatch opens by ordering its manual read, before any instruction of its own", () => {
  const first = reviewerMessage().split("\n").find((l) => l.trim());
  assert.equal(first, `First, read and follow exactly: ${MANUAL}.`,
    "an instruction placed ahead of the manual would lead the brief instead of the owner's question");
});

test("the manual's body opens with the owner's question, character for character", () => {
  const text = readFileSync(join(DRIVER, MANUAL), "utf8");
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const firstParagraph = body.trim().split(/\n\s*\n/)[0];
  assert.equal(firstParagraph, FIRST_QUESTION);
  assert.equal(text.split(FIRST_QUESTION).length - 1, 1, "the question appears once, not restated below");
});

test("both engines resolve the manual order to the same file", () => {
  const skillsDir = "/store/skills";
  const resolved = absolutizeSkillRefs(reviewerMessage(), skillsDir);
  assert.match(resolved, /First, read and follow exactly: \/store\/skills\/narrative-refutation\/SKILL\.md\./);
  for (const engine of ["anthropic-agent.mjs", "openai-agent.mjs"]) {
    const src = readFileSync(join(DRIVER, "engine", engine), "utf8");
    assert.match(src, /absolutizeSkillRefs\(message, skillsDir, resolveSkill\)/,
      `${engine} no longer hands the reviewer's message through the shared resolver`);
  }
});
