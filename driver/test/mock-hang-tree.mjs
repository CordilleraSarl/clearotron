#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// SIGTERM-immune process TREE mock for the C1/C2 kill-escalation tests: ignores SIGTERM itself (the
// pre-escalation state of the 19h wedge) and spawns a SIGTERM-ignoring grandchild in the SAME process
// group (the MCP-server stand-in) — only the group SIGKILL escalation can reap either. Never exits on
// its own. Env knobs:
//   MOCK_TREE_PIDFILE       — writes {pid, grandPid, escapeePid} JSON so the test can assert tree death
//   MOCK_TREE_ESCAPEE=1     — ALSO spawn a detached grandchild (its OWN group — escapes the group kill)
//                             that inherits our stdout pipe: a settle-on-stream-close implementation
//                             would hang on it forever, so it proves the settled-promise guarantee.
//                             The test reaps it manually.
//   MOCK_TREE_EMIT_INIT=1   — emit one stream-json init line first (feeds the engine's NDJSON parser
//                             and resets its stall clock once, like a real claude that then goes silent)
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

process.on("SIGTERM", () => {});

const IGNORE_TERM = "process.on('SIGTERM',()=>{});setInterval(()=>{},1<<30);";
const grand = spawn(process.execPath, ["-e", IGNORE_TERM], { stdio: "ignore" });   // inherits our pgid
let escapee = null;
if (process.env.MOCK_TREE_ESCAPEE === "1") {
  escapee = spawn(process.execPath, ["-e", IGNORE_TERM], { stdio: ["ignore", "inherit", "ignore"], detached: true });
}
writeFileSync(process.env.MOCK_TREE_PIDFILE, JSON.stringify({ pid: process.pid, grandPid: grand.pid, escapeePid: escapee?.pid ?? null }));
if (process.env.MOCK_TREE_EMIT_INIT === "1") {
  process.stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: "hang-tree" }) + "\n");
}
setInterval(() => {}, 1 << 30);
