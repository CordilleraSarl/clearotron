// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// START SAYS WHAT IS TRUE OF A CLIENT DOOR THAT IS NOT UP.
//
// The client door is non-fatal, and two of `start`'s lines about it said what is true of something else.
// A door that exited printed the queue worker's line, about a queue the client door does not drain and a
// `--watch` flag it does not take. A door still up when the 30-second wait ran out sent the reader to its
// output for a reason it never printed. Each case now has its own line, in the owner's words of
// 2026-10-18, and the queue worker keeps its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nonFatalExitLine, clientDoorDownLines } from "../../bin/start.mjs";

const START_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "start.mjs"), "utf8");
const DOOR = { name: "the client door", script: "mcp-server/http-server-client.mjs" };
const oneLine = (lines) => lines.map((l) => l.trim()).join(" ");

test("a client door that exits says the portal and the engine door are unaffected, and nothing about a queue", () => {
  assert.equal(nonFatalExitLine({ ...DOOR, code: 1, signal: null, clientDoor: true }),
    "\nstart: the client door (mcp-server/http-server-client.mjs) exited with code 1 — the portal and the engine door are unaffected; a client assistant cannot connect until it is up.\n");
  const killed = nonFatalExitLine({ ...DOOR, code: null, signal: "SIGTERM", clientDoor: true });
  assert.match(killed, /exited on SIGTERM — the portal and the engine door are unaffected;/);
  for (const line of [killed, nonFatalExitLine({ ...DOOR, code: 1, signal: null, clientDoor: true })])
    assert.doesNotMatch(line, /queue|--watch/, "the client door's exit still speaks of the queue worker");
});

test("the worker keeps its own exit line", () => {
  assert.equal(nonFatalExitLine({ name: "the worker", script: "driver/runner.mjs", code: 2, signal: null }),
    "\nstart: the worker (driver/runner.mjs) exited with code 2 — the portal is still up, but nothing is draining the queue now. Start one with:\n    node driver/runner.mjs --watch\n");
});

test("a client door still up when the wait ran out names the wait, not output it never printed", () => {
  const silent = clientDoorDownLines({ host: "127.0.0.1", port: 8930, exited: false });
  assert.equal(oneLine(silent),
    "Client door  NOT RUNNING on 127.0.0.1:8930 — it did not answer within 30s. The portal and the engine door are unaffected; a client assistant cannot connect until it is up.");
  assert.doesNotMatch(oneLine(silent), /output above/);
  // a door that exited printed why, and its line still says so
  assert.match(oneLine(clientDoorDownLines({ host: "127.0.0.1", port: 8930, exited: true })),
    /^Client door {2}NOT RUNNING on 127\.0\.0\.1:8930 — its output above says why\. The portal and the engine door are unaffected;/);
});

test("start uses both lines for the client door: its spawn is marked, and the summary reads whether it exited", () => {
  assert.match(START_SRC, /start\("the client door", "mcp-server\/http-server-client\.mjs", envs\.client, \{ fatal: false, clientDoor: true \}\)/,
    "the client door is spawned without the mark its exit line reads");
  assert.match(START_SRC, /err\(nonFatalExitLine\(\{ name, script, code, signal, clientDoor \}\)\)/, "the exit handler does not compose its line");
  assert.match(START_SRC, /clientDoorDownLines\(\{ host: HOST, port: ports\.client, exited: clientDoor\?\.child\?\.exitCode !== null \}\)/,
    "the summary does not choose its line by whether the door exited");
  assert.match(START_SRC, /const deadline = Date\.now\(\) \+ 30_000;/, "the wait the line names is not 30 seconds");
});
