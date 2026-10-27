// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REASONING NOTES FOLLOW THE RULED CROWD, SET-ASIDE AND RECORD.
//
// Three notes the model reads still taught the older method. The dilution frame was earned only once the crowd had
// been enumerated worldwide, where the method counts a crowd, narrows it by goods and names its survivors. Player-made
// content was never to be omitted, where a result a lawyer would not raise is set aside with its ground. And reading
// the run's own records was said to be owed before delivery, where what the run read and set aside, with its count
// and reason, is the engine's record. This holds the ruled lines, in the manuals and in the writer's message, and
// that the old ones are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const flat = (rel) => readFileSync(join(DRIVER, rel), "utf8").replace(/\s+/g, " ");
const CROWD = "until the crowd has been counted, narrowed by goods, and its survivors named.";

test("the dilution frame is earned once the crowd is counted, narrowed by goods and its survivors named", () => {
  for (const rel of ["skills/clearance-search/firm-wide-reasoning.md", "skills/blind-frame/SKILL.md"]) {
    const text = flat(rel);
    assert.ok(text.includes(CROWD), `${rel} does not carry the ruled crowd line`);
    assert.ok(!text.includes("has been *enumerated*, filtered by goods, worldwide"), `${rel} still asks for a worldwide enumeration`);
  }
});

test("player-made content a lawyer would not raise is set aside with its ground", () => {
  const reasoning = flat("skills/clearance-search/firm-wide-reasoning.md");
  assert.ok(reasoning.includes("It is still **useful commercial context** — where a lawyer would raise it, surface it in the Findings sheet "
    + "and the narrative as Low priority / Of Interest; otherwise set it aside with its ground."));
  assert.ok(!reasoning.includes("Do not omit it."), "the reasoning manual still forbids setting player-made content aside");
});

test("what the run read and set aside is the engine's record, in the worked example and the writer's message", () => {
  const examples = flat("skills/clearance-search/worked-examples.md");
  assert.ok(examples.includes("*(The other three name this system's own mechanisms. What the run read, and what it set aside with its count "
    + "and reason, is the engine's record — printing it as a step for the reader is a defect, not an action.)*"));
  const stages = flat("stages.mjs");
  assert.ok(stages.includes("What the run read, and what it set aside with its count and reason, is the ENGINE's record — printing it as "
    + "something the reader must do is a defect, not an action."));
  for (const [name, text] of [["the worked example", examples], ["the writer's message", stages]])
    assert.ok(!text.includes("was owed before delivery"), `${name} still says reading the run's records was owed before delivery`);
});
