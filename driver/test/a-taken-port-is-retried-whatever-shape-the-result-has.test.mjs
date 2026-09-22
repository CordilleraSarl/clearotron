// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The port helper's own arms. Its default predicate is the half a caller trusts without reading, so it is
// driven on the shapes callers actually hand back, starting with a real child that met a taken port. A
// default that read one shape and not the others answered "not taken" for the rest, and a file importing
// the helper got no retry at all while looking protected.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { saidPortWasTaken, withFreePorts } from "./helpers/free-port.mjs";

test("a real child that met a taken port is read as taken, from the spawnSync result it returns", async () => {
  const held = createServer();
  await new Promise((resolve) => held.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = held.address();
    const r = spawnSync(process.execPath,
      ["-e", `require("node:net").createServer().listen(${port}, "127.0.0.1")`], { encoding: "utf8", timeout: 30_000 });
    assert.match(r.stderr, /EADDRINUSE/, `the child did not meet the held port, so this arm measured nothing:\n${r.stderr}`);
    assert.equal(saidPortWasTaken(r), true, "a spawnSync result whose stderr says the address is in use read as free");
  } finally { await new Promise((resolve) => held.close(resolve)); }
});

test("every shape a caller hands back is read, and a clean one is not taken", () => {
  const taken = "cannot start — 127.0.0.1:40123 is already in use";
  assert.equal(saidPortWasTaken(taken), true, "a string");
  assert.equal(saidPortWasTaken({ stdout: taken, stderr: "" }), true, "a spawnSync result, on stdout");
  assert.equal(saidPortWasTaken({ stdout: "", stderr: "Error: listen EADDRINUSE" }), true, "a spawnSync result, on stderr");
  assert.equal(saidPortWasTaken({ said: taken }), true, "a drive's `said` string");
  assert.equal(saidPortWasTaken({ said: () => taken }), true, "a drive's `said` read through a function");
  assert.equal(saidPortWasTaken({ stdout: "listening on 127.0.0.1:40123", stderr: "" }), false, "a clean result");
  assert.equal(saidPortWasTaken({}), false, "a result with nothing to say");
  assert.equal(saidPortWasTaken(null), false, "no result at all");
});

test("a taken port is retried on fresh numbers, and each result thrown away is handed to discard", async () => {
  const seen = [];
  const discarded = [];
  const result = await withFreePorts(["a", "b"], (ports, attempt) => {
    seen.push(ports);
    return { attempt, stderr: attempt < 3 ? "listen EADDRINUSE" : "" };
  }, { discard: (r) => discarded.push(r.attempt) });
  assert.equal(result.attempt, 3, "the first result that did not say a port was taken is the one returned");
  assert.deepEqual(discarded, [1, 2], "each retried result is discarded, and the returned one is not");
  for (const ports of seen) {
    assert.ok(Number.isInteger(ports.a) && ports.a > 0 && Number.isInteger(ports.b) && ports.b > 0,
      `every name is given a real port: ${JSON.stringify(ports)}`);
  }
});

test("when every attempt is taken, the last result comes back as it is, so the arm reports the real failure", async () => {
  const discarded = [];
  const result = await withFreePorts(["a"], (_ports, attempt) => ({ attempt, said: "is already in use" }),
    { attempts: 3, discard: (r) => discarded.push(r.attempt) });
  assert.equal(result.attempt, 3);
  assert.equal(saidPortWasTaken(result), true, "the returned result still says what happened");
  assert.deepEqual(discarded, [1, 2], "the result handed back to the caller is not discarded under it");
});
