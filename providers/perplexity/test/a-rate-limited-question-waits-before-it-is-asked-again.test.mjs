// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RATE-LIMITED QUESTION WAITS BEFORE IT IS ASKED AGAIN.
//
// A 429 says "not now". On a test run of a crowded matter, a retried stage sent its research questions in a burst,
// the provider refused 66 of them with 429 over fourteen minutes, and each refusal failed after one retry 1.5
// seconds later. A 429 now waits first, as the provider's Retry-After asks or else 10, 30 and 60 seconds, within
// two minutes for one call, and only then is retried as before. Driven through the client with a stand-in
// transport and a recorded clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callAgentAPI, rateLimitWaitMs, RATE_LIMIT_WAITS_MS, RATE_LIMIT_MAX_WAIT_MS } from "../src/core.js";

const reply = (status, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  text: async () => (status === 429 ? '{"error":{"message":"rate limited"}}' : "upstream said no"),
  json: async () => ({ choices: [{ message: { content: "fine" } }] }),
});
const scripted = (...statuses) => {
  let i = 0;
  return { fetchImpl: async () => { const s = statuses[Math.min(i, statuses.length - 1)]; i += 1; return typeof s === "object" ? s : reply(s); }, calls: () => i };
};
const near = (ms, target) => ms >= target * 0.9 - 1 && ms <= target * 1.1 + 1;

test("a 429 waits about ten seconds and asks again, without spending one of the preset's retries", async () => {
  const waits = [];
  const t = scripted(429, 200);
  const res = await callAgentAPI("k", { preset: "medium" }, { retries: 0, fetchImpl: t.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.ok(res, "the question was not answered after the wait");
  assert.equal(t.calls(), 2);
  assert.equal(waits.length, 1);
  assert.ok(near(waits[0], RATE_LIMIT_WAITS_MS[0]), `waited ${waits[0]} ms`);
});

test("the provider's Retry-After sets the wait, in seconds or as a date", async () => {
  const waits = [];
  const t = scripted(reply(429, { "retry-after": "3" }), 200);
  await callAgentAPI("k", { preset: "medium" }, { retries: 0, fetchImpl: t.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.ok(near(waits[0], 3000), `waited ${waits[0]} ms for a Retry-After of 3 seconds`);
  const now = Date.parse("2026-10-22T10:00:00Z");
  assert.ok(near(rateLimitWaitMs(0, "Thu, 22 Oct 2026 10:00:20 GMT", { now }), 20_000));
  assert.ok(near(rateLimitWaitMs(0, "600", { now }), RATE_LIMIT_WAITS_MS.at(-1)), "a wait longer than the longest step is cut to it");
});

test("a 429 that persists waits at most two minutes in all, then is retried and fails as before", async () => {
  const waits = [];
  const t = scripted(429);
  const err = await callAgentAPI("k", { preset: "medium" }, { retries: 1, backoffMs: 0, fetchImpl: t.fetchImpl, sleep: async (ms) => { waits.push(ms); } })
    .then(() => null, (e) => e);
  assert.ok(err);
  assert.equal(err.status, 429);
  assert.equal(err.retryable, true);
  const rateLimitWaits = waits.filter((ms) => ms > 0);
  assert.equal(rateLimitWaits.length, RATE_LIMIT_WAITS_MS.length, `waited ${JSON.stringify(waits)}`);
  assert.ok(rateLimitWaits.reduce((a, b) => a + b, 0) <= RATE_LIMIT_MAX_WAIT_MS);
  assert.equal(t.calls(), 1 + RATE_LIMIT_WAITS_MS.length + 1, "the preset's own retry still runs after the waits");
});

test("any other failure keeps its policy: a 5xx retries after the linear backoff, a 4xx fails at once", async () => {
  const waits = [];
  const t = scripted(500, 200);
  await callAgentAPI("k", { preset: "medium" }, { retries: 1, backoffMs: 7, fetchImpl: t.fetchImpl, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [7]);
  const bad = scripted(401);
  const err = await callAgentAPI("k", { preset: "medium" }, { retries: 3, fetchImpl: bad.fetchImpl, sleep: async () => {} }).then(() => null, (e) => e);
  assert.equal(err.status, 401);
  assert.equal(bad.calls(), 1);
});

test("a Retry-After of 0, or a date already past, still ends: three waits at most, then the old retries", async () => {
  for (const after of ["0", "Thu, 01 Jan 2026 00:00:00 GMT"]) {
    const waits = [];
    const t = scripted(reply(429, { "retry-after": after }));
    const err = await callAgentAPI("k", { preset: "medium" }, { retries: 1, backoffMs: 0, fetchImpl: t.fetchImpl, sleep: async (ms) => { waits.push(ms); } })
      .then(() => null, (e) => e);
    assert.equal(err?.status, 429, `a Retry-After of ${after} never let the call end`);
    assert.equal(t.calls(), 1 + RATE_LIMIT_WAITS_MS.length + 1, `Retry-After ${after}: ${t.calls()} calls`);
    assert.ok(waits.every((ms) => ms === 0));
  }
});
