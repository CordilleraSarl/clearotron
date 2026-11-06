// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A reader whose Codex test turn failed, and who answered no to running it again, went back to the AI menu
// with Claude under Enter: a change of AI they had not chosen. And a reader taking every default went round
// the same setup again, because a declined proof and a declined retry both led straight back to the menu.
//
// Now the menu's default is the AI picked on the pass before, and a declined proof or retry is asked the
// question the no-program path already asks, "Continue with no engine configured?", whose Enter goes on with
// no AI. No returns to the menu, and only that answer says so. A token pasted for a sign-in is saved only with
// the turn it proved.
//
// WHY MOST OF THESE ARMS READ SOURCE. The engine step is a loop inside the wizard, which runs only behind a
// terminal and refuses when stdin is not one, so it has no seam to call (the-engine-step-cannot-loop-on-a-menu-
// nothing-changed.test.mjs reads it the same way). The menu's default is a function, and is driven for both AIs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { engineOptions, engineMenuDefault } from "../../bin/onboard.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "onboard.mjs"), "utf8");
const STEP = SRC.slice(SRC.indexOf("  engine: for (;;) {"), SRC.indexOf("// 3 ── ambient keys"));
const CONTINUE = 'if (await confirm("Continue with no engine configured?", true)) { sayNoEngine(); break engine; }';

test("the anchors are where this file looks for them", () => {
  assert.ok(STEP.length > 1000 && STEP.includes("probeEngineTurn(proofTurn("), "the engine step is not where this file reads it");
});

test("the menu's default is the AI the reader picked before, on both AIs, and row 0 on the first pass", () => {
  const options = engineOptions();
  assert.equal(engineMenuDefault(options, null), 0, "the first pass keeps the production default");
  for (const id of Object.keys(ENGINE_BINARIES)) {
    const at = engineMenuDefault(options, id);
    assert.equal(options[at].id, id, `after a pass on ${id}, Enter picks ${options[at].id}`);
  }
  assert.equal(engineMenuDefault(options, "no-such-ai"), 0, "a pick the menu no longer offers falls back to row 0");
  // And the loop hands it the pick of the pass before, set once a pick is made.
  assert.match(STEP, /const pick = await choose\(ENGINE_QUESTION, options, engineMenuDefault\(options, lastPick\), PAY_PREAMBLE\);\n\s*if \(!pick\.id\) \{ sayNoEngine\(\); break; \}\n\s*lastPick = pick\.id;/);
});

test("a declined proof is asked whether to go on without an AI, and only a no goes back to the menu", () => {
  const at = STEP.indexOf("if (!await confirm(proveQuestion(");
  assert.ok(at > 0, "the proof question is not in the engine step");
  const branch = STEP.slice(at, STEP.indexOf("continue;", at) + "continue;".length);
  assert.ok(branch.includes(CONTINUE), `the declined proof does not offer the way on: ${branch}`);
  assert.ok(branch.indexOf(CONTINUE) < branch.indexOf('info("Not proven, so not written. Pick again'),
    "the line that sends the reader back to the menu prints before the reader has chosen to go back");
});

test("a declined retry is asked the same question, with the same yes default, before the menu", () => {
  const at = STEP.indexOf('if (!await confirm("Fixed it? Run the turn again", false)) {');
  assert.ok(at > 0, "the retry question is not in the engine step");
  const branch = STEP.slice(at, STEP.indexOf("continue engine;", at) + "continue engine;".length);
  assert.ok(branch.includes(CONTINUE), `the declined retry does not offer the way on: ${branch}`);
  assert.ok(branch.indexOf(CONTINUE) < branch.indexOf('info("Not proven, so not written. Back to the engine menu'),
    "the line that sends the reader back to the menu prints before the reader has chosen to go back");
  // The way on is the no-AI ending every other route takes: nothing about the AI is saved on it.
  const success = STEP.slice(STEP.indexOf("if (v.ok) {"), STEP.indexOf("break engine;", STEP.indexOf("if (v.ok) {")));
  assert.match(success, /candidate\.CLEAROTRON_AI = pick\.id;/, "the AI is no longer saved in the proved branch");
  assert.equal([...STEP.matchAll(/candidate\.CLEAROTRON_AI = /g)].length, 1, "the AI is saved somewhere other than the proved branch");
});

test("a token pasted for a sign-in is saved only with the turn it proved", () => {
  const capture = STEP.slice(STEP.indexOf("if (handOff.captureToken) {"));
  assert.ok(capture.length > 0, "the token capture is not in the engine step");
  assert.doesNotMatch(capture, /candidate\[eng\.headless\.tokenEnv\] = tok;/, "the pasted token is saved before any turn has proved it");
  assert.match(capture, /pastedToken = tok;\n\s*authEnv\[eng\.headless\.tokenEnv\] = tok;/, "the next turn no longer runs with the pasted token");
  const success = STEP.slice(STEP.indexOf("if (v.ok) {"), STEP.indexOf("break engine;", STEP.indexOf("if (v.ok) {")));
  assert.match(success, /if \(pastedToken !== null\) candidate\[eng\.headless\.tokenEnv\] = pastedToken;/, "a proved token is no longer saved");
});
