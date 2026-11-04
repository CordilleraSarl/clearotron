// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DEMO READS NO BRIEF AND DRAINS NO QUEUE.
//
// The demo says it needs no account and no key, and ordering from its portal lands on a report it already
// has. Two of the processes it started could still spend. The portal's brief reader is a model turn on
// whatever engine the machine is signed in to, and it booted ON in the demo ("brief reading ON —
// engine=anthropic-agent billing=subscription", measured in an empty home on a published beta). The queue
// worker ran too, so a job an assistant queued through the demo's own connect line would have been run as
// a real clearance. Its closing lines also told the visitor that confirming an order "is the moment money
// is committed", which in a demo it never is.
//
// Driven through the real supervisor in an empty home, signed in to nothing: nothing here can reach a
// model, and the assertions read what the demo said and what it left on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";
import { HEARTBEAT_FILE } from "../worker-heartbeat.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The closing block's last line in a demo: the summary has ended once it is printed.
const ENDED = /The demo has no background form/;

/** Output with any line about a passphrase taken out, so no assertion message can carry one. */
const safe = (s) => String(s).split("\n").map((l) => (/passphrase/i.test(l) ? "[a passphrase line, redacted]" : l)).join("\n");

test("a demo boots with its brief reader off and no worker, and does not say an order commits money", { timeout: 180000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "demo-spends-nothing-"));
  const stop = async ({ child, closed }) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.race([closed, new Promise((r) => setTimeout(r, 20000))]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; }
  };
  const boot = async (ports) => {
    const child = spawn(process.execPath, [join(REPO, "bin", "start.mjs"), "--demo", "--no-open"], {
      cwd: REPO,
      env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: home,
        PORTAL_SERVICE_PORT: String(ports.portal), TRADEMARK_MCP_HTTP_PORT: String(ports.mcp),
        CLIENT_MCP_HTTP_PORT: String(ports.client) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let said = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => { said += c; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { said += c; });
    const closed = new Promise((resolve) => child.on("close", resolve));
    const deadline = Date.now() + 120000;
    while (!ENDED.test(said) && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    return { child, closed, said: () => said };
  };
  const run = await withFreePorts(["portal", "mcp", "client"], boot, {
    busy: (r) => !ENDED.test(r.said()) && saidPortWasTaken(r),
    discard: async (r) => { await stop(r); rmSync(home, { recursive: true, force: true }); mkdirSync(home); },
  });
  try {
    assert.match(run.said(), ENDED, `the demo never reached its closing lines:\n${safe(run.said()).slice(-3000)}`);
    // A worker beats as soon as it starts. Given the time it takes, so a worker that did start is seen.
    await new Promise((r) => setTimeout(r, 8000));
    const said = run.said();
    const locks = join(home, "trademark-demo", "locks");
    assert.ok(existsSync(locks), "anti-vacuity: the demo made its lock directory, where a worker would beat");

    assert.match(said, /brief reading OFF — this is the demo/, `the portal did not say its brief reader is off:\n${safe(said).slice(-3000)}`);
    assert.doesNotMatch(said, /brief reading ON/, "the demo's portal can read a brief, which is a model turn");
    assert.ok(!existsSync(join(locks, HEARTBEAT_FILE)), "a worker is draining the demo's queue");
    assert.match(said, /Nothing is started and nothing is charged/, "the demo did not say what ordering in it does");
    assert.doesNotMatch(said, /the moment money is committed/, "the demo told its visitor that ordering commits money");
  } finally {
    await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});
