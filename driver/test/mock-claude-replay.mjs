#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A mock `claude` that replays a written stream: every line of MOCK_CLAUDE_REPLAY (a JSONL file of
// invented stream events) goes to stdout as the program would write it, then it exits 0. For the
// readers that must be driven by an exact sequence of events, which the scripted mock (mock-claude.mjs)
// composes rather than takes. MOCK_CLAUDE_REPLAY_WRITE=<path> writes a stub file there first, so a
// stage's expected output exists.
import { readFileSync, writeFileSync, writeSync } from "node:fs";

process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
  if (process.env.MOCK_CLAUDE_REPLAY_WRITE) writeFileSync(process.env.MOCK_CLAUDE_REPLAY_WRITE, "# replayed\n\nA stub the replay mock wrote.\n");
  for (const line of readFileSync(process.env.MOCK_CLAUDE_REPLAY, "utf8").split("\n")) if (line.trim()) writeSync(1, `${line}\n`);
  process.exit(0);
});
