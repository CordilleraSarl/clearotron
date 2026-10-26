// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN ASSISTANT STARTS A RUN IN ITS OWN QUEUE.
//
// start_run without an agent puts the job in the deployment's default queue, and a run's events name the agent of the
// queue it started in. On a box with more than one assistant the default can be another assistant's, so the requester's
// own assistant never sees the run's notices, and the other one sends them. The ops skill and the tool's own description
// now tell an assistant to pass its own agent id on every start. This holds both sentences.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

test("the ops skill tells an assistant to pass its own agent id on every start", () => {
  const skill = read("skills/clearotron-ops/SKILL.md").replace(/\s+/g, " ");
  assert.ok(skill.includes("- **`agent`** — your own agent id, on every start. A run's events name the agent of the queue it started in, "
    + "and a courier takes only its own. Without `agent` the job starts in the deployment's default queue, which on a box with more "
    + "than one assistant may be another one's."));
});

test("start_run's own description of its agent field says the same", () => {
  const def = read("mcp-server/server.mjs").split("\n").find((l) => l.includes('{ name: "start_run"'));
  assert.ok(def, "guard: the start_run definition was found");
  const agent = /agent: \{ type: "string", description: "([^"]*)" \}/.exec(def);
  assert.ok(agent, "start_run has no described agent field");
  assert.ok(agent[1].startsWith("Which agent workspace's queue. An assistant passes its own agent id: the run's events name the queue's agent, "
    + "and a courier takes only its own."), agent[1]);
  assert.ok(agent[1].includes("which on a box with more than one assistant may be another one's."), agent[1]);
});
