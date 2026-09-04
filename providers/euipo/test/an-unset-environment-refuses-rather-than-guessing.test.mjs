// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// an-unset-environment-refuses-rather-than-guessing.test.mjs — item 2, ADR-0001.
//
// EUIPO sandbox and production are separate deployments holding different corpora: production is the
// register; sandbox is a frozen snapshot plus synthetic rows, so a clearance run against it reports on
// marks that do not exist.
//
// `core.js` already refuses an unset EUIPO_ENVIRONMENT by name — that is the item's judge-it criterion
// and it was already met. These arms hold the RESIDUAL the item's own text is about: euipo-client.js
// carried `environment = "sandbox"` as a destructure default and `ENV[x] || ENV.sandbox` four times.
// Unreachable today, because every live caller arrives through resolveConfig — and failing OPEN
// tomorrow, for the first caller that does not. Everything else in this engine fails closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ENV, getAccessToken, euipoRecordFetch, euipoSearch } from "../src/euipo-client.js";

const NO_NETWORK = () => { throw new Error("NETWORK CALLED — the refusal must land before any request"); };
const CREDS = { clientId: "id-123", clientSecret: "secret-abc" };

test("CONTROL: both deployments are still on the map, so the arms below are about the FALLBACK", () => {
  assert.deepEqual(Object.keys(ENV).sort(), ["production", "sandbox"]);
  assert.match(ENV.sandbox.auth, /sandbox/);
  assert.doesNotMatch(ENV.production.auth, /sandbox/);
});

test("getAccessToken with NO environment refuses by name, before any network call", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = NO_NETWORK;
  try {
    await assert.rejects(() => getAccessToken({ ...CREDS }), (e) => {
      assert.match(e.message, /EUIPO_ENVIRONMENT is not set and there is NO default/);
      assert.match(e.message, /#1149 item 2, ADR-0001/);
      return true;
    });
  } finally { globalThis.fetch = prev; }
});

test("an UNKNOWN environment refuses too, naming the two that exist — never the nearest guess", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = NO_NETWORK;
  try {
    await assert.rejects(() => getAccessToken({ ...CREDS, environment: "staging" }), (e) => {
      assert.match(e.message, /"staging" is not one of: sandbox, production/);
      assert.match(e.message, /guessing one is not an option/);
      return true;
    });
  } finally { globalThis.fetch = prev; }
});

test("the record-fetch face refuses on its own — it is separately reachable and had its own fallback", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = NO_NETWORK;
  try {
    await assert.rejects(() => euipoRecordFetch({ ...CREDS }, { application_number: "018123456" }),
      /EUIPO_ENVIRONMENT is not set and there is NO default/);
  } finally { globalThis.fetch = prev; }
});

test("the search face refuses too, and does it before it can report a corpus it never asked", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = NO_NETWORK;
  try {
    await assert.rejects(() => euipoSearch({ ...CREDS }, { name: "NOVAPULSE" }),
      /EUIPO_ENVIRONMENT is not set and there is NO default/);
  } finally { globalThis.fetch = prev; }
});

// ── AND THE STATED ENVIRONMENT IS THE ONE USED ────────────────────────────────────────────────────
//
// This arm is the VOID CONTROL for the four above, and measured as one: with the old fallbacks restored
// it stays GREEN while arms 2-5 red, which is exactly what makes it worth having. `hostsFor` written to
// throw unconditionally would satisfy every refusal arm and break every real call; only this one says
// the working path still works, and that a stated `production` is not quietly serviced from sandbox.
test("a stated `production` reaches the production auth host, not the sandbox one", async () => {
  const prev = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    // The shipped reader is `await resp.text()` then JSON.parse — stubbing `json()` would be stubbing
    // a method this code path does not call, and the arm would fail on the real one.
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "t", expires_in: 3600 }) };
  };
  try {
    // A clientId this test alone uses: the token cache is module-level and keyed by clientId, so a
    // shared one would let a cached token from another arm satisfy this without a request.
    await getAccessToken({ clientId: "prod-only-1149", clientSecret: "s", environment: "production" });
  } finally { globalThis.fetch = prev; }
  assert.equal(seen.length, 1, "exactly one token request");
  assert.equal(seen[0], ENV.production.auth);
  assert.doesNotMatch(seen[0], /sandbox/);
});
