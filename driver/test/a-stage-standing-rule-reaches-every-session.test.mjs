// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STAGE'S STANDING RULE REACHES EVERY SESSION IT OPENS: THE FIRST, EACH FOLLOW-UP, ON BOTH ENGINES.
//
// A follow-up is a fresh session composed from the stage's declared reads and the follow-up's own text
// (`composeFollowup`; stages-followup.test.mjs pins that no engine resumes by session key). A rule written
// only into the opening message is therefore lost to every correction pass, re-emit and recheck. A stage
// lists such rules as `standing`, and its opening message states them too. This holds both halves, for
// every follow-up the stage's registered composers build, and that each engine's rewrite of the message
// leaves the rule as it was.
//
// The sentences themselves were approved word for word, so they are pinned here as written.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";

import { STAGES, composeFollowup, WEB_EVIDENCE_ONLY_THROUGH_RESEARCH } from "../stages.mjs";
import { REPAIR_COMPOSERS, repairFollowup } from "../repair-composers.mjs";
import { buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { absolutizeSkillRefs as codexRewrite } from "../engine/common.mjs";
import { SKILLS, clearanceDispatches } from "./model-stage-dispatches.mjs";

const RUN = "/nonexistent/invented-run";
const withStanding = () => Object.entries(STAGES).filter(([, d]) => d.standing?.length);

test("the writer's standing rule is the approved sentence, word for word", () => {
  assert.equal(WEB_EVIDENCE_ONLY_THROUGH_RESEARCH,
    "Web evidence comes only through `perplexity_research`; do not fetch pages with a shell command or a script.");
  assert.deepEqual([...STAGES.synthesis.standing], [WEB_EVIDENCE_ONLY_THROUGH_RESEARCH]);
});

test("every opening message of a stage with standing rules states each of them, under every context", () => {
  const names = new Set(withStanding().map(([n]) => n));
  assert.ok(names.has("synthesis"), "the writer lists no standing rule");
  let checked = 0;
  for (const d of clearanceDispatches(RUN)) {
    if (!names.has(d.name)) continue;
    for (const rule of STAGES[d.name].standing) assert.ok(d.message.includes(rule), `${d.name} (${d.label}): the opening message does not state: ${rule}`);
    checked++;
  }
  assert.ok(checked >= names.size, "no opening message was checked");
});

test("every follow-up a stage's composers build carries its standing rules once, after the instruction", () => {
  let checked = 0;
  for (const [name, def] of withStanding()) {
    const composers = REPAIR_COMPOSERS.filter((c) => c.stage === name);
    assert.ok(composers.length, `${name}: no registered follow-up to check`);
    for (const c of composers) {
      for (const sample of c.samples ?? [{ name: "no arguments", args: {} }]) {
        const followup = repairFollowup(c.key, sample.args);
        const msg = composeFollowup(name, { profile: null, job: {} }, { followup });
        for (const rule of def.standing) {
          assert.equal(msg.split(rule).length - 1, 1, `${c.key} (${sample.name}): the standing rule is not stated exactly once: ${rule}`);
          assert.ok(msg.indexOf(followup) < msg.indexOf(rule), `${c.key} (${sample.name}): the instruction no longer comes first`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked >= 9, `only ${checked} follow-ups checked`);
});

test("a stage with no standing rules gets no extra line in its follow-ups", () => {
  const msg = composeFollowup("register-digest", { profile: null, job: {} }, { followup: "an invented follow-up instruction" });
  for (const [, def] of withStanding()) for (const rule of def.standing) assert.ok(!msg.includes(rule));
});

test("each engine's rewrite of the message leaves the standing rules as they were", () => {
  for (const [name, def] of withStanding()) {
    const msg = composeFollowup(name, { profile: null, job: {} }, { followup: "an invented follow-up instruction" });
    const claude = buildClaudeArgs({ message: msg, model: "opus", thinking: "low", cwd: "/tmp", skillsDir: SKILLS, runDir: RUN }).input;
    const codex = codexRewrite(msg, SKILLS);
    for (const rule of def.standing) {
      assert.ok(claude.includes(rule), `claude, ${name}: the rule did not survive the rewrite`);
      assert.ok(codex.includes(rule), `codex, ${name}: the rule did not survive the rewrite`);
    }
  }
});
