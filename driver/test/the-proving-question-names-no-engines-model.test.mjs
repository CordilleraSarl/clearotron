// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The setup wizard asked a codex user to prove the OpenAI engine "with one haiku-tier turn". Haiku is an
// Anthropic model, so the sentence told them setup was about to spend on a model family they do not use.
// Both proving sentences are rendered here for every engine and every lane, and no model family of any
// engine may appear in them.
import test from "node:test";
import assert from "node:assert/strict";
import { PAYS_WITH, probingLine, proveQuestion } from "../../bin/onboard.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { PROBE_TIMEOUT_SEC } from "../engine/probe.mjs";
import { readFileSync } from "node:fs";

const ONBOARD = new URL("../../bin/onboard.mjs", import.meta.url);

// Every engine's model families. A sentence that brands none cannot name the wrong one. The question names
// the reader's AI by its product name, so "claude" is held apart from the families below.
const MODEL_NAMES = /haiku|sonnet|opus|\bgpt|\bo[1-9](?:-mini)?\b|codex-mini/i;

test("the proving sentences name the engine and no engine's model, on every engine and lane", () => {
  const engines = Object.keys(ENGINE_BINARIES);
  assert.ok(engines.length >= 2, `only ${engines.length} engine(s) found — the arm would be sweeping a table that shrank`);
  for (const engineId of engines) {
    const { product } = ENGINE_BINARIES[engineId];
    const line = probingLine(engineId);
    assert.ok(line.includes(engineId), `the line does not name the engine it probes: ${line}`);
    assert.doesNotMatch(line, MODEL_NAMES, `a model family was named to a ${engineId} user: ${line}`);
    for (const billing of Object.keys(PAYS_WITH)) {
      const question = proveQuestion({ product, billing });
      assert.ok(question.includes(product), `the question does not name the AI it proves: ${question}`);
      assert.ok(question.includes(PAYS_WITH[billing]), `the question does not say how it is paid for: ${question}`);
      assert.doesNotMatch(question, MODEL_NAMES, `a model family was named to a ${engineId} user: ${question}`);
      assert.doesNotMatch(question, new RegExp(`\\blane\\b|${engineId}`), `the question speaks our words: ${question}`);
      for (const other of engines.filter((e) => e !== engineId))
        assert.ok(!question.includes(ENGINE_BINARIES[other].product), `a ${engineId} user was told about the other AI: ${question}`);
    }
  }
});

test("the arm's model-name pattern catches the sentence that was reported", () => {
  // THE PLANT: the old wording, rendered for the OpenAI engine, must be refused by the same pattern.
  assert.match("Prove openai-agent on the subscription lane now with one haiku-tier turn (a few tokens, 60s ceiling)?", MODEL_NAMES);
});

test("the proving flow says how the turn is paid for in the pay question's words, and never 'lane'", () => {
  assert.equal(proveQuestion({ product: "Codex", billing: "api-key" }),
    `Prove Codex on your API key now with one turn on its cheapest model (a few tokens, ${PROBE_TIMEOUT_SEC}s ceiling)?`);
  // Every answer the pay question offers has its words here: an undefined would print in the question.
  const src = readFileSync(ONBOARD, "utf8");
  for (const id of [...src.slice(src.indexOf("const CLAUDE_PAY_ANSWERS"), src.indexOf("SETUP'S FIRST QUESTION")).matchAll(/id: "([^"]+)"/g)].map((m) => m[1]))
    assert.ok(PAYS_WITH[id], `the pay answer ${id} has no words for the proving question`);
  for (const phrase of ["the lane you just proved", "the lane the turn above", "} lane — binary"])
    assert.ok(!src.includes(phrase), `setup's proving flow still says: ${phrase}`);
});
