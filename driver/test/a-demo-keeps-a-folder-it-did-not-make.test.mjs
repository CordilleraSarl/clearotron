// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A DEMO KEEPS A FOLDER IT DID NOT MAKE.
//
// `demo --once` publishes the sample reports, exits, and keeps its folder, printing the command that
// removes it. A later plain `demo` published into that same folder and removed it when it stopped, so the
// reports the reader had been told were kept were gone (measured on a published beta). A plain demo still
// removes a folder it made; one that was there before it started is handed over as the reader's, and kept.
//
// The decision is driven as a table, and then the reported sequence is driven through the real command.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { demoStartArgs } from "../../shared/demo-start-args.mjs";
import { demoBaseIsTheReaders } from "../../bin/start.mjs";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT = "/h/trademark-demo";
const readers = (args) => demoBaseIsTheReaders({
  baseGiven: args.includes("--base"), ownBase: args.includes("--demo-own-base"), base: DEFAULT, demoDefault: DEFAULT,
});

test("a folder that was there before the demo is handed over as the reader's, and kept", () => {
  const args = demoStartArgs({ demoBase: DEFAULT, baseExisted: true });
  assert.ok(!args.includes("--demo-own-base"), "the launcher claimed a folder an earlier demo left");
  assert.equal(readers(args), true, "the supervisor would remove a folder this demo did not make");
});

test("a folder the demo makes is still the demo's, and goes when it stops", () => {
  const args = demoStartArgs({ demoBase: DEFAULT, baseExisted: false });
  assert.deepEqual(args, ["--demo", "--base", DEFAULT, "--demo-own-base"]);
  assert.equal(readers(args), false);
});

// THE REPORTED SEQUENCE needs the built portal: in a clone the plain demo refuses without one, before it
// starts anything. Skipped by name, never passed on an early return.
const BUNDLE = join(REPO, "portal-ui", "dist", "index.html");
const NEEDS_BUNDLE = "needs the built portal bundle (npm run build:ui): in a clone the demo refuses without one";
const safe = (s) => String(s).split("\n").map((l) => (/passphrase/i.test(l) ? "[a passphrase line, redacted]" : l)).join("\n");

test("demo --once, then a plain demo: the folder and its reports are still there afterwards", { timeout: 240000 }, async (t) => {
  if (!existsSync(BUNDLE)) return t.skip(NEEDS_BUNDLE);
  const home = mkdtempSync(join(tmpdir(), "demo-once-then-demo-"));
  const base = join(home, "trademark-demo");
  const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: home };
  const stop = async (r) => {
    if (r.child.exitCode === null && r.child.signalCode === null) r.child.kill("SIGTERM");
    await Promise.race([r.closed, new Promise((res) => setTimeout(res, 30000))]);
    if (r.child.exitCode === null && r.child.signalCode === null) { r.child.kill("SIGKILL"); await r.closed; }
  };
  let run = null;
  try {
    const once = spawnSync(process.execPath, [join(REPO, "bin", "clearotron.mjs"), "demo", "--once"], { cwd: REPO, env, encoding: "utf8", timeout: 120000 });
    assert.equal(once.status, 0, `demo --once failed:\n${safe(once.stdout + once.stderr).slice(-2000)}`);
    const kept = readdirSync(join(base, "pool")).filter((d) => existsSync(join(base, "pool", d, "meta.json")));
    assert.ok(kept.length > 0, "anti-vacuity: demo --once published no report to keep");

    const plain = async (ports) => {
      const child = spawn(process.execPath, [join(REPO, "bin", "clearotron.mjs"), "demo", "--no-open"], {
        cwd: REPO, stdio: ["ignore", "pipe", "pipe"],
        env: { ...env, PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
          CLIENT_MCP_HTTP_PORT: String(ports.client) },
      });
      let said = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c) => { said += c; });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c) => { said += c; });
      const closed = new Promise((res) => child.on("close", res));
      const deadline = Date.now() + 150000;
      while (!/The demo has no background form/.test(said) && child.exitCode === null && Date.now() < deadline)
        await new Promise((res) => setTimeout(res, 250));
      return { child, closed, said: () => said };
    };
    run = await withFreePorts(["portal", "mcp", "client"], plain, {
      busy: (r) => !/The demo has no background form/.test(r.said()) && saidPortWasTaken(r),
      discard: stop,
    });
    assert.match(run.said(), /The demo has no background form/, `the plain demo never came up:\n${safe(run.said()).slice(-3000)}`);
    await stop(run);
    const said = run.said();
    run = null;
    assert.ok(existsSync(base), `the plain demo removed a folder it did not make:\n${safe(said).slice(-800)}`);
    for (const id of kept) assert.ok(existsSync(join(base, "pool", id, "meta.json")), `the report ${id} demo --once kept is gone`);
    assert.match(said, /This demo keeps its folder/, "the plain demo did not say, while it ran, that it keeps the folder it found");
    assert.match(said, /The demo's folder is kept at/, "the plain demo did not say where the folder is kept");
  } finally {
    if (run) await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});
