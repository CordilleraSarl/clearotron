// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PORTAL'S BOOT CHECK IS NOT LOGGED AS A REJECTION.
//
// On every start the portal asks the engine door, without a key, what credential it wants, and reads the
// answer to say which door it found. The door logged that expected 401 as "auth reject 401: no key
// presented on the token-only door", so every `clearotron start` and every demo showed a rejection
// (measured on a published beta). The probe now names itself, and the door leaves that one request out of
// its reject log. What the door answers is unchanged, because the portal reads the refusal's body, and a
// keyless request that does not name itself is still logged.
//
// Driven with mock req/res, as http-handler.test.mjs drives the handler: no network and no transport.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeHttpHandler } from "../lib/http-handler.mjs";
import { RateLimiter } from "../lib/ratelimit.mjs";
import { BOOT_PROBE_HEADER, triggerLaneVerdict, HOSTED } from "../../shared/trigger-lane.mjs";

const noSession = async () => { throw new Error("createSession must not run for a keyless request"); };
function mockRes() {
  return {
    statusCode: null, body: null, headersSent: false, _finish: [],
    once(ev, fn) { if (ev === "finish") this._finish.push(fn); return this; },
    writeHead(s) { this.statusCode = s; this.headersSent = true; },
    end(b) { this.body = b; for (const fn of this._finish.splice(0)) fn(); },
  };
}
const mockReq = (method, headers = {}) => ({ method, url: "/mcp", headers, async *[Symbol.asyncIterator]() { /* empty */ } });

async function ask(method, headers) {
  const said = [];
  const h = makeHttpHandler({ verify: null, tokenOnly: true, limiter: new RateLimiter({ perMinute: 100 }),
    sessions: new Map(), createSession: noSession, log: (l) => said.push(l) });
  const res = mockRes();
  await h(mockReq(method, headers), res);
  return { res, said };
}

test("the portal's keyless boot check gets the door's usual answer and no reject line", async () => {
  const probe = await ask("GET", { [BOOT_PROBE_HEADER]: "1" });
  assert.equal(probe.res.statusCode, 401, "the probe must still be refused: it carries no key");
  assert.deepEqual(probe.said.filter((l) => /auth reject/.test(l)), [],
    "the door logged the portal's own boot check as a rejection");

  // The answer is byte-for-byte the one an unmarked caller gets, so the portal's reading of it is unchanged.
  const plain = await ask("GET", {});
  assert.equal(probe.res.body, plain.res.body, "naming itself changed what the door answered the probe");
  const verdict = triggerLaneVerdict({ url: "http://127.0.0.1:1", hasToken: true, verbs: null, posture: HOSTED, invoke: "npx ",
    probe: { ok: true, status: 401, error: null, challenge: null, body: String(probe.res.body) } });
  assert.notEqual(verdict.state, "fail", `the portal no longer reads the probe's answer as a key door: ${verdict.message}`);
});

test("a keyless request that does not name itself as the probe is still logged as a rejection", async () => {
  for (const [method, headers] of [["GET", {}], ["POST", {}], ["POST", { [BOOT_PROBE_HEADER]: "1" }]]) {
    const { res, said } = await ask(method, headers);
    assert.equal(res.statusCode, 401);
    assert.ok(said.some((l) => /auth reject 401: no key presented on the token-only door/.test(l)),
      `a keyless ${method}${Object.keys(headers).length ? " carrying the probe's header" : ""} was not logged as a rejection`);
  }
});
