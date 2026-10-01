#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A mock `claude` that replays a written stream: every line of MOCK_CLAUDE_REPLAY (a JSONL file of
// invented stream events) goes to stdout as the program would write it, then it exits 0. For the
// readers that must be driven by an exact sequence of events, which the scripted mock (mock-claude.mjs)
// composes rather than takes. MOCK_CLAUDE_REPLAY_WRITE=<path> writes a stub file there first, so a
// stage's expected output exists.
//
// MOCK_CLAUDE_REPLAY_LOG=<path> appends one line per call, `{ argv, stdin }`, so a test can read what the
// program was given; and a `{n}` in MOCK_CLAUDE_REPLAY is that call's number, from 1, so successive calls
// can replay successive streams.
import { appendFileSync, existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";

// The version probe the driver makes after a failed turn is answered and not counted as a call.
if (process.argv.includes("--version")) { process.stdout.write("2.1.284 (Claude Code)\n"); process.exit(0); }

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { stdin += d; });
process.stdin.on("end", () => {
  const log = process.env.MOCK_CLAUDE_REPLAY_LOG;
  const n = log && existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l.trim()).length + 1 : 1;
  if (log) appendFileSync(log, `${JSON.stringify({ argv: process.argv.slice(2), stdin })}\n`);
  if (process.env.MOCK_CLAUDE_REPLAY_WRITE) writeFileSync(process.env.MOCK_CLAUDE_REPLAY_WRITE, "# replayed\n\nA stub the replay mock wrote.\n");
  const replay = String(process.env.MOCK_CLAUDE_REPLAY).replace("{n}", String(n));
  for (const line of readFileSync(replay, "utf8").split("\n")) if (line.trim()) writeSync(1, `${line}\n`);
  process.exit(0);
});
