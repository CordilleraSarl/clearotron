// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// npm-cli.mjs — HOW TO RUN NPM WITHOUT A SHELL, on every platform.
//
// ON WINDOWS NPM IS A BATCH FILE. `npm` there is `npm.cmd`, and Node refuses to start a batch file without
// a shell (EINVAL, since the 2024 fix for batch-file argument injection). A shell is no way round it here:
// the engine install passes `<package>@>=<floor>`, and cmd.exe reads that `>` as a redirection into a file.
// npm itself is a Node program, `npm-cli.js`, so on Windows it runs through the Node running now: the one
// npm named when it launched this process, else the one beside `node.exe`, which is where Node's own
// Windows installer puts it. Elsewhere `npm` is run as it always was.

import { existsSync } from "node:fs";
import { win32 } from "node:path";

/** The command and arguments that run npm with `args`: `{command, args}`. `platform` is a parameter so the Windows branch runs on a Linux CI. */
export function npmInvocation(args = [], { platform = process.platform, env = process.env, execPath = process.execPath, exists = existsSync } = {}) {
  if (platform !== "win32") return { command: "npm", args };
  const named = String(env.npm_execpath ?? "");
  if (/npm-cli\.js$/i.test(named) && exists(named)) return { command: execPath, args: [named, ...args] };
  const beside = win32.join(win32.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (exists(beside)) return { command: execPath, args: [beside, ...args] };
  return { command: "npm", args };
}
