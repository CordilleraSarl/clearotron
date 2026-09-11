// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// `status` AND `stop` SEE A FOREGROUND START.
//
// With the product started the way the README starts it — `clearotron start` in a terminal — `status`
// printed a sentence about background units nobody installed, and `stop` printed a bus error with `su`
// advice and then "Nothing was running" while the portal answered 200 (measured on a published beta,
// 2026-09-11). A foreground start now leaves a record while it serves; these arms drive both verbs over it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readRunning, recordRunning, runningDir } from "../../shared/running-start.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = promisify(execFile);

/** A pid that existed and is gone. */
const deadPid = () => spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout * 1;

function home() {
  const h = mkdtempSync(join(tmpdir(), "fg-home-"));
  return { h, env: { PATH: process.env.PATH, HOME: h, XDG_STATE_HOME: join(h, "state"), CLEAROTRON_NO_ENV_FILE: "1" },
    dir: runningDir({ env: { XDG_STATE_HOME: join(h, "state") } }) };
}
const rec = (pid, url) => ({ pid, demo: false, base: "/b", url, host: "127.0.0.1",
  ports: { portal: 1, mcp: 18790, client: 18811 }, startedAt: new Date().toISOString() });

/** Run a verb ASYNCHRONOUSLY: a sync spawn would block this process's event loop, and with it the portal the verb asks. */
const verb = async (name, env) => {
  try { const r = await run(process.execPath, [join(ROOT, "bin", `${name}.mjs`)], { env, cwd: ROOT, timeout: 30000 }); return { code: 0, ...r }; }
  catch (e) { return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }; }
};

test("a record is read while its process lives, ignored once it is gone, and removed on request", () => {
  const { h, dir } = home();
  try {
    const forget = recordRunning(rec(process.pid, "http://127.0.0.1:1/portal"), { dir });
    assert.deepEqual(readRunning({ dir }).map((r) => r.pid), [process.pid]);
    recordRunning(rec(deadPid(), "http://127.0.0.1:1/portal"), { dir });
    writeFileSync(join(dir, "123.json"), "not json");
    assert.deepEqual(readRunning({ dir }).map((r) => r.pid), [process.pid], "a dead start and a torn record are not the product running");
    forget(); forget();
    assert.deepEqual(readRunning({ dir }), []);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("status says the product is up, with the addresses start printed, when the portal answers", async () => {
  const { h, env, dir } = home();
  const server = createServer((_, res) => { res.writeHead(200); res.end("ok"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/portal`;
    recordRunning(rec(process.pid, url), { dir });
    const out = await verb("status", env);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /The product is up, in the foreground/);
    assert.ok(out.stdout.includes(`Open         ${url}`), out.stdout);
    assert.match(out.stdout, /Engine door  http:\/\/127\.0\.0\.1:18790\/mcp/);
    assert.match(out.stdout, /Client door  http:\/\/127\.0\.0\.1:18811\/mcp/);
    assert.match(out.stdout, /Ctrl-C there stops it/);
    assert.doesNotMatch(out.stdout, /not running/);
  } finally { server.close(); rmSync(h, { recursive: true, force: true }); }
});

test("a live start whose portal does not answer is said as that, never as up", async () => {
  const { h, env, dir } = home();
  const server = createServer(); await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port; await new Promise((r) => server.close(r));   // a port nobody holds
  try {
    recordRunning(rec(process.pid, `http://127.0.0.1:${port}/portal`), { dir });
    const out = await verb("status", env);
    assert.match(out.stdout, /is not answering/);
    assert.doesNotMatch(out.stdout, /is up/);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("with nothing running, status says so and names the command that starts it — a dead record included", async () => {
  const { h, env, dir } = home();
  try {
    recordRunning(rec(deadPid(), "http://127.0.0.1:1/portal"), { dir });
    const out = await verb("status", env);
    assert.match(out.stdout, /The product is not running/);
    assert.match(out.stdout, /start` runs it in a terminal/);
    assert.match(out.stdout, /start --background` runs it as services/);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("stop names a foreground start and how to stop it, with no bus advice, when no unit is installed", async () => {
  const { h, env, dir } = home();
  try {
    recordRunning(rec(process.pid, "http://127.0.0.1:1/portal"), { dir });
    const out = await verb("stop", env);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /running in the foreground/);
    assert.match(out.stdout, /Ctrl-C in the terminal that holds it/);
    assert.doesNotMatch(out.stdout, /Nothing was running/);
    assert.doesNotMatch(out.stderr, /could not ask systemd|machinectl|sudo/, "no unit was installed, so there was nothing to ask systemd");
    // THE CONTROL: the empty box still says it is empty, and still skips the bus.
    rmSync(dir, { recursive: true, force: true });
    const empty = await verb("stop", env);
    assert.match(empty.stdout, /Nothing was running in the background/);
    assert.doesNotMatch(empty.stderr, /could not ask systemd/);
  } finally { rmSync(h, { recursive: true, force: true }); }
});

test("start records itself once it is serving, and forgets on every exit", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  assert.match(src, /const forget = recordRunning\(\{ pid: process\.pid, demo: DEMO, base: paths\.base, url: envs\.url, host: HOST,/);
  assert.match(src, /process\.on\("exit", forget\)/, "Ctrl-C, a fatal refusal and a crash all exit through here");
  assert.ok(src.indexOf("recordRunning({") > src.indexOf("const doorRunning ="), "recorded before the portal and doors were known to be up");
});
