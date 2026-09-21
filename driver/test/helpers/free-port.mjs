// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// free-port.mjs — a port for a child process, and what to do when the number goes stale.
//
// THE RACE THIS EXISTS FOR, MEASURED. A test asks the operating system for a free port by listening on
// 0, reads the number, CLOSES the socket, and hands the number to a child. Between the close and the
// child's own bind, that number is free for anything to take: another file listening on 0, or the local
// end of any outbound connection. The numbers come from the ephemeral range, so this is not unlikely —
// it took a CI shard down on one run and passed on the re-run, which is the shape of a race rather than
// a defect in what was being tested.
//
// Holding the socket open until the child binds does not work: two processes cannot hold one port, and
// handing a listening socket across a spawn is not available to the driver a test is exercising.
//
// SO THE NUMBER STAYS DISPOSABLE AND THE ATTEMPT IS REPEATED. `withFreePorts` allocates, runs the real
// spawn, and if what came back says the address was already in use, allocates a different set and runs
// it again. The spawn under test is never stubbed — the retry drives exactly the same code path, which
// is the point: a test that mocked the bind would stop covering the thing that failed.
//
// A retry cannot mask a genuine "already in use" that the test is ASSERTING: such a test passes its own
// `busy` predicate, or reads the result itself rather than through here.
import { createServer } from "node:net";

/** One port the operating system says is free, as a number. The socket is closed before it is returned. */
export async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** Did this result say a port was taken? Both the driver's sentence and the system's own code. */
export const saidPortWasTaken = (said) =>
  /is already in use|EADDRINUSE/i.test(typeof said === "string" ? said : String(said?.said ?? ""));

/**
 * Allocate `names` as free ports, run `run(ports)`, and repeat with fresh numbers while the result says
 * a port was taken. Returns the last result; after `attempts` it returns whatever it got, so the arm
 * reports the real failure rather than this helper hiding it behind a timeout.
 */
export async function withFreePorts(names, run, { attempts = 4, busy = saidPortWasTaken } = {}) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ports = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await freePort()])));
    result = await run(ports, attempt);
    if (!busy(result)) return result;
  }
  return result;
}
