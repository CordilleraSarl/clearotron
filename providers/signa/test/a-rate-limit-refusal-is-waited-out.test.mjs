// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RATE-LIMIT REFUSAL IS WAITED OUT, AND THE OTHER TWO 429s ARE NOT. Signa's documentation names three
// error types a 429 can carry and says only `rate_limited` clears by waiting `Retry-After` seconds. The
// client used to retry server errors only, so every 429 came back on its first attempt.
//
// A local server stands in for the register and answers with the refusals the documentation describes;
// nothing here reaches Signa. The waits are captured rather than slept, because a test cannot sit out a
// real window, and each arm reads the call ledger back: a retry is an attempt on the same row.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "signa-429-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
// Before the import: the ledger's path is fixed when its module loads.
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");
const { signaFetch, rateLimitWaitMs, RATE_LIMIT_RETRIES, RATE_LIMIT_SLEEP_BUDGET_MS } = await import("../src/core.js");

const refusal = (type, retry_after = null) => ({
  error: { type, title: "Refused", status: 429, detail: "synthetic", retryable: type === "rate_limited", retry_after },
  request_id: "req_test",
});
const PAGE = { data: [], has_more: false, pagination: { total_count: 0 } };

/** A register that plays `answers` in order, one per request, then answers 200 to anything after. */
async function register(answers) {
  let n = 0;
  const server = createServer((req, res) => {
    const a = answers[n++] ?? { status: 200, body: PAGE };
    res.writeHead(a.status, { "content-type": "application/json", ...(a.headers ?? {}) });
    res.end(JSON.stringify(a.body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, asked: () => n, close: () => new Promise((r) => server.close(r)) };
}

let target = 0;
async function ask(answers, tctx = {}) {
  const reg = await register(answers);
  const waits = [];
  const label = `t${++target}`;
  try {
    const r = await signaFetch("k", reg.base, "/v1/trademarks", { method: "POST", body: { q: "X" },
      tctx: { kind: "test", target: label, ...tctx }, sleep: async (ms) => { waits.push(ms); } });
    const log = existsSync(process.env.CLEAROTRON_REGISTER_CALL_LOG) ? readFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "utf8") : "";
    const rows = log.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((row) => row.target === label);
    return { r, waits, rows, asked: reg.asked() };
  } finally { await reg.close(); }
}

test("a rate_limited 429 waits Retry-After seconds and asks again, on one ledger row", async () => {
  const { r, waits, rows, asked } = await ask([{ status: 429, headers: { "retry-after": "2" }, body: refusal("rate_limited", 2) }]);
  assert.equal(r.status, 200, "the answer after the wait is the one returned");
  assert.equal(asked, 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 2000 && waits[0] < 3000, `the wait is Retry-After plus under a second of jitter, got ${waits[0]}`);
  assert.equal(rows.length, 1, "a retry is an attempt on the same ledger row, never a row of its own");
  assert.equal(rows[0].attempts, 2);
  assert.equal(rows[0].http_status, 200);
});

test("with no Retry-After header, the body's retry_after is the wait", async () => {
  const { waits } = await ask([{ status: 429, body: refusal("rate_limited", 1) }]);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 1000 && waits[0] < 2000, `got ${waits[0]}`);
});

test("a window that never clears is asked at most three more times, then the 429 stands", async () => {
  const always = Array.from({ length: 10 }, () => ({ status: 429, body: refusal("rate_limited") }));
  const { r, waits, rows, asked } = await ask(always);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.type, "rate_limited", "the refusal's body reaches the caller as it always did");
  assert.equal(asked, 1 + RATE_LIMIT_RETRIES);
  // Neither the header nor the body states a wait: the documentation's backoff, one second doubling.
  assert.deepEqual(waits.map((w) => Math.floor(w / 1000)), [1, 2, 4]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attempts, 1 + RATE_LIMIT_RETRIES);
  assert.equal(rows[0].http_status, 429);
});

for (const type of ["daily_credit_cap_exceeded", "insufficient_credits"]) {
  test(`CONTROL: a ${type} 429 returns at once, because no wait inside a call clears it`, async () => {
    const { r, waits, rows, asked } = await ask([{ status: 429, headers: { "retry-after": "1" }, body: refusal(type) }]);
    assert.equal(r.status, 429);
    assert.equal(asked, 1);
    assert.deepEqual(waits, []);
    assert.equal(rows[0].attempts, 1);
  });
}

test("CONTROL: a stated wait longer than one window is not slept through inside a call", async () => {
  const { r, waits, asked } = await ask([{ status: 429, headers: { "retry-after": "120" }, body: refusal("rate_limited", 120) }]);
  assert.equal(r.status, 429);
  assert.equal(asked, 1);
  assert.deepEqual(waits, []);
});

test("one call sleeps at most one window in all: a third wait that would pass it is not taken", async () => {
  const slow = Array.from({ length: 5 }, () => ({ status: 429, headers: { "retry-after": "25" }, body: refusal("rate_limited", 25) }));
  const { r, waits, asked } = await ask(slow);
  assert.equal(r.status, 429);
  assert.equal(waits.length, 2, "25 s twice fits in 60 s; a third would not");
  assert.ok(waits.reduce((a, b) => a + b, 0) <= RATE_LIMIT_SLEEP_BUDGET_MS);
  assert.equal(asked, 3);
});

test("a wait that would run past the turn's time to stop sending is not taken", async () => {
  // A plan call that outlasts its turn ends with it and its answers are never written, so the refusal
  // returns while the turn still has time to write what the call holds.
  const { r, waits, asked } = await ask([{ status: 429, headers: { "retry-after": "2" }, body: refusal("rate_limited", 2) }],
    { sendUntilMs: Date.now() + 500 });
  assert.equal(r.status, 429);
  assert.deepEqual(waits, []);
  assert.equal(asked, 1);
});

test("CONTROL: a time to stop sending the wait fits inside does not stop it", async () => {
  const { r, waits } = await ask([{ status: 429, headers: { "retry-after": "2" }, body: refusal("rate_limited", 2) }],
    { sendUntilMs: Date.now() + 60_000 });
  assert.equal(r.status, 200);
  assert.equal(waits.length, 1);
});

test("CONTROL: a server error still gets its one retry after a second and a half", async () => {
  const { r, waits, rows } = await ask([{ status: 503, body: { error: { type: "unavailable" } } }]);
  assert.equal(r.status, 200);
  assert.deepEqual(waits, [1500]);
  assert.equal(rows[0].attempts, 2);
});

test("the wait rule, read without a server", () => {
  const none = () => 0;
  assert.equal(rateLimitWaitMs("3", refusal("rate_limited", 9), 0, none), 3000, "the header wins over the body");
  assert.equal(rateLimitWaitMs("0", refusal("rate_limited"), 0, none), 0, "a stated zero is a real zero");
  assert.equal(rateLimitWaitMs(null, refusal("rate_limited"), 2, none), 4000);
  assert.equal(rateLimitWaitMs("Wed, 21 Oct 2026 07:28:00 GMT", refusal("rate_limited", 5), 0, none), 5000,
    "a header that is not a number of seconds falls back to the body");
  assert.equal(rateLimitWaitMs("1", { message: "too many requests" }, 0, none), null, "no error type: not a refusal the documentation says to wait out");
  assert.equal(rateLimitWaitMs("90", refusal("rate_limited"), 0, none), 90000,
    "the rule reports the register's figure; the call's budget decides whether it is waited");
});
