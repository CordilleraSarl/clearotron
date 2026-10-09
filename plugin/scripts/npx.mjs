#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// npx.mjs — starts npx with the arguments it is given, on every platform, and stands in for it until it ends.
//
// Claude Code starts a plugin's server as a program, with no shell between. On Windows npx is a batch
// file, `npx.cmd`, and a batch file starts only through the command shell, so an `.mcp.json` that names
// npx starts the server on macOS and Linux and fails on Windows. Node is a program everywhere: the plugin
// starts this file with it, and this file starts npx, directly where npx is a program and through
// `cmd.exe` on Windows.
//
// THE SHELL IS HANDED NOTHING IT COULD READ TWO WAYS. It looks in the working folder before the PATH, and
// Claude Code starts a server in the user's project, so npx is looked up on the PATH here and handed to
// the shell as a quoted absolute path. Every argument must be plain text, which the shell passes
// unchanged; one that is not is refused on every platform, so it fails where it is written.
//
// The server's input, output and errors are its own: they are handed down and never read here, so
// nothing but the server writes to the output Claude Code reads. A stop reaches the server as the end of
// its input, which on Windows is the only stop that reaches a program started through the shell; where
// there are signals, a signal is passed on as well. The exit code is npx's.
//
// Node builtins only: this folder is installed alone, with nothing beside it.
import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Letters, digits and `_ @ . / : = + -`: what cmd.exe passes on unchanged. */
export const plainArgument = (a) => typeof a === "string" && /^[\w@./:=+-]+$/.test(a);

/**
 * The first npx on the PATH, by PATHEXT, as cmd.exe would find it, except that the working folder and
 * any relative PATH entry are never looked in, and a path the shell would rewrite (`%`, `!`) is passed by.
 */
export function npxOnPath(env = process.env, sep = delimiter) {
  const get = (name) => env[Object.keys(env).find((k) => k.toUpperCase() === name) ?? name];
  const exts = (get("PATHEXT") || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  for (const entry of (get("PATH") || "").split(sep)) {
    const dir = entry.replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(dir)) continue;
    for (const ext of exts) {
      const file = join(dir, `npx${ext.toLowerCase()}`);
      if (/[%!"]/.test(file)) continue;
      try { if (statSync(file).isFile()) return file; } catch { /* not in this folder */ }
    }
  }
  return null;
}

/** How npx is started here: the program itself, or on Windows one line for the command shell. */
export function npxCommand(args, platform = process.platform, env = process.env) {
  const bad = args.find((a) => !plainArgument(a));
  if (bad !== undefined) throw new Error(`not a plain argument: ${JSON.stringify(bad)}`);
  if (platform !== "win32") return { command: "npx", args, shell: false };
  const npx = npxOnPath(env, ";");
  if (!npx) throw Object.assign(new Error("spawn npx ENOENT"), { code: "ENOENT" });
  return { command: [`"${npx}"`, ...args].join(" "), args: [], shell: true };
}

function main(argv) {
  let how;
  try {
    how = npxCommand(argv);
  } catch (e) {
    process.stderr.write(`npx.mjs: ${e.message}\n`);
    process.exit(1);
  }
  const child = spawn(how.command, how.args, { stdio: "inherit", shell: how.shell, windowsHide: true });
  child.on("error", (e) => {
    process.stderr.write(`npx.mjs: ${e.message}\n`);
    process.exit(1);
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
}

// Run directly, never on import. Both sides through realpath: under a linked folder the two paths
// differ in spelling, and a guard that compared spellings would exit 0 having started nothing.
let direct = false;
try {
  direct = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch { /* imported from somewhere that is not a file */ }
if (direct) main(process.argv.slice(2));
