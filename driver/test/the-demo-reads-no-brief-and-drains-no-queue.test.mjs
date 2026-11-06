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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { withFreePorts, saidPortWasTaken } from "./helpers/free-port.mjs";
import { HEARTBEAT_FILE } from "../worker-heartbeat.mjs";
import { DEMO_ALARM, demoLineOnScreen } from "../../bin/start.mjs";

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

    // THE SERVICES' ROUTINE LINES ARE FILED, AND THE SCREEN SAYS WHERE (owner's words, 2026-11-06).
    const startupLog = join(home, "trademark-demo", "startup.log");
    assert.ok(said.includes(`Startup details are in \`${startupLog}\`.`), `the demo did not say where its startup details are:\n${safe(said).slice(-3000)}`);
    const filed = readFileSync(startupLog, "utf8");
    // WHICH LINES ARE ROUTINE IS THE FILTER'S ANSWER, NOT THIS FILE'S: a checkout with no built portal page prints the portal's
    // `listening on` line with `ui=MISSING`, which rightly stays on the screen, as the offline suites run.
    const routine = filed.split("\n").filter((l) => l.trim() && !demoLineOnScreen(l));
    assert.ok(routine.some((l) => /^\[trademark-artifacts-http\] listening on /.test(l)), "anti-vacuity: the engine door's own lines are not in the startup file");
    assert.deepEqual(routine.filter((l) => said.includes(l)), [], "a routine service line is still on the demo's screen");
    // A NEW ROUTINE LINE IS NAMED HERE, not left on every demo's screen: a fresh demo prints no service line that shows
    // without an alarm in it.
    const unlisted = filed.split("\n").filter((l) => /^\[[\w-]+\] /.test(l) && demoLineOnScreen(l) && !DEMO_ALARM.test(l));
    assert.deepEqual(unlisted, [], "a fresh demo shows these lines; add each to DEMO_ROUTINE_LINES in bin/start.mjs if it is routine");

    // ANOTHER ASSISTANT HAS A COMMAND, AND THE CLIENT DOOR KEEPS ITS KEY ROUTE (owner's words, 2026-11-06).
    assert.match(said, /^ {2}Another assistant\? Run `.*clearotron connect --base \S*trademark-demo` in a second terminal and pick it\.$/m,
      "the demo does not say how to connect an assistant other than Claude Code");
    assert.match(said, /It refuses every caller until a key is issued: .*clearotron connect --base \S*trademark-demo --where elsewhere$/m,
      "the client door's line no longer names the command that mints its key");

    assert.match(filed, /brief reading OFF — this is the demo/, `the portal did not say its brief reader is off:\n${safe(filed).slice(-3000)}`);
    assert.doesNotMatch(said + filed, /brief reading ON/, "the demo's portal can read a brief, which is a model turn");
    assert.ok(!existsSync(join(locks, HEARTBEAT_FILE)), "a worker is draining the demo's queue");
    assert.match(said, /Nothing is started and nothing is charged/, "the demo did not say what ordering in it does");
    assert.doesNotMatch(said, /the moment money is committed/, "the demo told its visitor that ordering commits money");
  } finally {
    await stop(run);
    rmSync(home, { recursive: true, force: true });
  }
});
