// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// mock-stall-tree.mjs — what an engine mock that stalls mid-stream leaves running, for the kill-path tests.
//
// With MOCK_STALL_TREE_PIDFILE=<file>, the mock starts one grandchild in the mock's process group (a tool-server stand-in
// that ignores SIGTERM, so only the escalation's SIGKILL ends it on a POSIX system) and writes {pid, grandPid} to the
// file, so a test can show both are gone after the kill. Without it, this does nothing.
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

export function stallTree() {
  const file = process.env.MOCK_STALL_TREE_PIDFILE;
  if (!file) return;
  const grand = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1<<30);"], { stdio: "ignore" });
  writeFileSync(file, JSON.stringify({ pid: process.pid, grandPid: grand.pid }));
}
