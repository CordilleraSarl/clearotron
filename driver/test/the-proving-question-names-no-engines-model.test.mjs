// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The setup wizard asked a codex user to prove the OpenAI engine "with one haiku-tier turn". Haiku is an
// Anthropic model, so the sentence told them setup was about to spend on a model family they do not use.
// Both proving sentences are rendered here for every engine and every lane, and no model family of any
// engine may appear in them.
import test from "node:test";
import assert from "node:assert/strict";
import { probingLine, proveQuestion } from "../../bin/onboard.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";

// Every engine's model families. A sentence that brands none cannot name the wrong one.
const MODEL_NAMES = /haiku|sonnet|opus|claude|\bgpt|\bo[1-9](?:-mini)?\b|codex-mini/i;

test("the proving sentences name the engine and no engine's model, on every engine and lane", () => {
  const engines = Object.keys(ENGINE_BINARIES);
  assert.ok(engines.length >= 2, `only ${engines.length} engine(s) found — the arm would be sweeping a table that shrank`);
  for (const engineId of engines) {
    for (const lane of ["subscription", "api-key"]) {
      const question = proveQuestion({ engineId, lane });
      const line = probingLine(engineId);
      for (const s of [question, line]) {
        assert.ok(s.includes(engineId), `the sentence does not name the engine it proves: ${s}`);
        assert.doesNotMatch(s, MODEL_NAMES, `a model family was named to a ${engineId} user: ${s}`);
      }
      assert.ok(question.includes(lane), `the question does not name the lane: ${question}`);
    }
  }
});

test("the arm's model-name pattern catches the sentence that was reported", () => {
  // THE PLANT: the old wording, rendered for the OpenAI engine, must be refused by the same pattern.
  assert.match("Prove openai-agent on the subscription lane now with one haiku-tier turn (a few tokens, 60s ceiling)?", MODEL_NAMES);
});
