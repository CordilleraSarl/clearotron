// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STOPPED RUN LEAVES NO CODEX HOME BEHIND.
//
// A Codex home holds the turn's sign-in, on Linux as a link to the account's saved one. It was removed in the
// `finally` that closes its turn or its stage, and a process that a signal ends by its default action never runs
// one: an operator's stop left a stage home behind, with that link in it, and nothing swept old homes. Now a
// home's name carries the process that made it, the first home a process makes sweeps away the homes of processes
// that have ended, and a process removes its homes when it exits and on a signal nothing else answers. Every
// folder here is made under a temporary cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, utimesSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sweepStaleCodexHomes, processAlive } from "../engine/openai-agent.mjs";

const AGENT = fileURLToPath(new URL("../engine/openai-agent.mjs", import.meta.url));
const SIGNALS = { skip: process.platform === "win32" && "POSIX signals" };

test("the sweep removes the homes of ended processes and day-old unnamed ones, and keeps a live maker's", (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-homes-sweep-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ended = spawnSync(process.execPath, ["-e", ""]).pid;
  const live = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  t.after(() => live.kill("SIGKILL"));
  assert.equal(processAlive(ended), false, "guard: the ended process is gone");
  assert.equal(processAlive(live.pid), true, "guard: the live one runs");
  const make = (name) => { const d = join(root, name); mkdirSync(d); return d; };
  make(`stage-skeptic-p${ended}-AbC123`);
  make(`stage-skeptic-p${live.pid}-DeF456`);
  make(`turn-p${process.pid}-GhI789`);
  const old = make("stage-skeptic-5dQd14");   // named before its maker was recorded, two days ago
  const twoDays = Date.now() / 1000 - 2 * 24 * 3600;
  utimesSync(old, twoDays, twoDays);
  make("turn-JkL012");                        // the same, made just now
  assert.deepEqual(sweepStaleCodexHomes(root).sort(), ["stage-skeptic-5dQd14", `stage-skeptic-p${ended}-AbC123`].sort());
  assert.deepEqual(readdirSync(root).sort(), [`stage-skeptic-p${live.pid}-DeF456`, "turn-JkL012", `turn-p${process.pid}-GhI789`].sort(),
    "a live maker's home, this process's own, or a fresh one was swept");
});

// A process that makes a home the way a stage does, says where it is, then does `after`.
function maker(t, after, setup = "") {
  const cache = mkdtempSync(join(tmpdir(), "codex-homes-stop-"));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const p = spawn(process.execPath, ["--input-type=module", "-e", `${setup}
const { makeCodexHome } = await import(${JSON.stringify(pathToFileURL(AGENT).href)});
const dir = makeCodexHome("stage-probe-");
process.stdout.write(dir + "\\n");
${after}`], { env: { ...process.env, XDG_CACHE_HOME: cache }, stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => { if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL"); });
  const exited = new Promise((resolve) => p.once("exit", (code, signal) => resolve({ code, signal })));
  const dir = new Promise((resolve) => {
    let buf = "";
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) resolve(buf.slice(0, i)); });
    p.once("exit", () => resolve(buf.trim() || null));
  });
  return { p, dir, exited };
}

test("a process stopped by SIGTERM removes the home it made, then ends by the signal", SIGNALS, async (t) => {
  const { p, dir, exited } = maker(t, "setTimeout(() => {}, 60000);");
  const home = await dir;
  assert.ok(home && existsSync(home), "guard: the home was made");
  p.kill("SIGTERM");
  const end = await exited;
  assert.equal(end.signal, "SIGTERM", `the process did not end as the signal ends it: ${JSON.stringify(end)}`);
  assert.equal(existsSync(home), false, "a stopped stage left its home behind");
});

test("a process that exits removes the home it made", async (t) => {
  const { dir, exited } = maker(t, "process.exit(0);");
  const home = await dir;
  const end = await exited;
  assert.equal(end.code, 0);
  assert.equal(existsSync(home), false, "an exit left the home behind");
});

test("a process with its own stop keeps it: its handler runs, and its exit removes the home", SIGNALS, async (t) => {
  const { p, dir, exited } = maker(t, "setTimeout(() => {}, 60000);",
    `process.on("SIGTERM", () => { process.exit(3); });`);
  const home = await dir;
  p.kill("SIGTERM");
  const end = await exited;
  assert.deepEqual([end.code, end.signal], [3, null], "the process's own stop was overridden");
  assert.equal(existsSync(home), false, "the stop left the home behind");
});
