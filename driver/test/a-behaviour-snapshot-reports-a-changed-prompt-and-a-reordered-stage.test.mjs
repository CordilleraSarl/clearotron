// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The comparison a change is merged against. The whole-run controls need a changed tree, so they are run by
// hand; this file holds the comparison itself to the same three questions at no cost.
import { test } from "node:test";
import assert from "node:assert/strict";

import { compareRecords, executedLines, owner, SCENARIO_GAPS } from "./snapshot/behaviour-snapshot.mjs";

const RECORD = {
  id: "knockout.claude", terminal: { ok: true },
  stages: [{ stage: "knockout-frame" }, { stage: "knockout-assess" }],
  turns: { "knockout-frame.attempt1": { prompt: "aaa", tools: "ttt", instructions: { "skills/knockout-frame/SKILL.md": "fff" } } },
};
const copy = (x) => JSON.parse(JSON.stringify(x));

test("two identical records have no difference", () => {
  assert.deepEqual(compareRecords(RECORD, copy(RECORD)), []);
});

test("a changed prompt is named by scenario, turn and field", () => {
  const head = copy(RECORD);
  head.turns["knockout-frame.attempt1"].prompt = "bbb";
  assert.deepEqual(compareRecords(RECORD, head), ['knockout.claude/turns/knockout-frame.attempt1/prompt: "aaa" -> "bbb"']);
});

test("a changed instruction file is a difference even when the prompt that names it is not", () => {
  const head = copy(RECORD);
  head.turns["knockout-frame.attempt1"].instructions["skills/knockout-frame/SKILL.md"] = "ggg";
  assert.equal(compareRecords(RECORD, head).length, 1);
});

test("two stages in the other order are a difference", () => {
  const head = copy(RECORD);
  head.stages.reverse();
  assert.equal(compareRecords(RECORD, head).length, 1);
  assert.match(compareRecords(RECORD, head)[0], /^knockout\.claude\/stages: /);
});

test("a line is run only when a range with a positive count covers a character on it", () => {
  const source = "const a = 1;\nif (a) { b(); }\n\nfunction never() {\n  return 2;\n}\n";
  const never = source.indexOf("function never");
  const lines = executedLines(source, [
    { ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
    { ranges: [{ startOffset: never, endOffset: source.length - 1, count: 0 }] },
  ]);
  assert.deepEqual([...lines], [1, 2]);
});

test("every area label is neutral, and an unlisted file says so", () => {
  assert.equal(owner("driver/pipeline.mjs"), "pipeline");
  assert.equal(owner("driver/skills/knockout-frame/SKILL.md"), "engine and instructions");
  assert.equal(owner("driver/steps/correction.mjs"), "pipeline");
  assert.equal(owner("driver/publish/index.mjs"), "record and report");
  assert.equal(owner("driver/run-record.mjs"), "record and report");
  assert.equal(owner("driver/progress.mjs"), "record and report");
  assert.equal(owner(".github/workflows/ci.yml"), "release");
  assert.equal(owner("driver/some-new-module.mjs"), "unassigned");
  assert.ok(SCENARIO_GAPS.length > 0, "a scenario not driven stays on the list a comparison prints");
});
