// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A provider outage should pause the knockout batch, not end it.
//
// The knockout lane has no recovery ladder by design — its own header says so, and its failures go
// terminal with the standard failure packet. The ONE escape hatch is a rate-limit re-throw through
// pipeline()'s outer catch, which postpones the run and auto-resumes it later.
//
// The all-marks-failed branch could not reach that hatch. `StageFailure` decides `rateLimited` by an EXACT
// string match — `reason === "rate_limited"` — and the throw carried a prose sentence, so `rateLimited`
// was false, the lane's catch wrote `.failed`, and a client received a failure notice for a provider
// hiccup on a paid multi-name screen. Only a human could restart it.
//
// The status needed to tell an outage from a broken configuration was being discarded twice over: the
// provider put it only in an error MESSAGE, and `research()` collapsed everything into one `cause` string.
// The driver's own outage patterns cannot read that message — OUTAGE_RE and TRANSIENT_RE both require a
// literal "http" before the code, so "Perplexity API 429: …" matches neither.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { callAgentAPI } from "../../providers/perplexity/src/core.js";
import { StageFailure } from "../pipeline.mjs";

const reply = (status, body = "upstream said no") => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  json: async () => ({ choices: [{ message: { content: "fine" } }] }),
});

// ── the provider surfaces its status on the error object ─────────────────────────────────────────────

test("A RETRYABLE STATUS RIDES THE ERROR OBJECT — not only the message text", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply(429); };
  const err = await callAgentAPI("k", { preset: "pro-search" }, { retries: 1, backoffMs: 0, fetchImpl })
    .then(() => null, (e) => e);
  assert.ok(err, "it still throws once the retries are spent");
  assert.equal(err.status, 429, "the code is readable without parsing prose");
  assert.equal(err.retryable, true);
  assert.equal(calls, 2, "and it genuinely retried first — a fast blip never reaches the driver");
});

test("a 5xx does the same", async () => {
  const err = await callAgentAPI("k", { preset: "pro-search" }, { retries: 0, backoffMs: 0, fetchImpl: async () => reply(503) })
    .then(() => null, (e) => e);
  assert.equal(err.status, 503);
  assert.equal(err.retryable, true);
});

test("a NON-retryable status is marked as such and throws immediately", async () => {
  let calls = 0;
  const err = await callAgentAPI("k", { preset: "pro-search" }, { retries: 3, backoffMs: 0, fetchImpl: async () => { calls += 1; return reply(401, "bad key"); } })
    .then(() => null, (e) => e);
  assert.equal(err.status, 401);
  assert.equal(err.retryable, false);
  assert.equal(calls, 1, "no retry — waiting does not fix a bad key");
  assert.match(err.message, /401/, "the message still carries it too, for logs");
});

test("the message keeps its old shape — nothing that reads it breaks", async () => {
  const err = await callAgentAPI("k", { preset: "pro-search" }, { retries: 0, backoffMs: 0, fetchImpl: async () => reply(500, "boom") })
    .then(() => null, (e) => e);
  assert.match(err.message, /^Perplexity API 500: boom$/);
});

// ── research() classifies narrowly ───────────────────────────────────────────────────────────────────

const researchWith = async (fetchImpl) => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.PERPLEXITY_API_KEY;
  globalThis.fetch = fetchImpl;
  process.env.PERPLEXITY_API_KEY = "test-key";
  try {
    const { RESEARCH_PROVIDERS } = await import("../driver.config.mjs");
    return await RESEARCH_PROVIDERS.perplexity.research("task", { preset: "pro-search" });
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.PERPLEXITY_API_KEY; else process.env.PERPLEXITY_API_KEY = realKey;
  }
};

test("429 and 5xx are OUTAGE-shaped", async () => {
  for (const status of [429, 500, 502, 503, 504, 599]) {
    const r = await researchWith(async () => reply(status));
    assert.equal(r.ok, false);
    assert.equal(r.outage, true, `${status} is an outage`);
    assert.equal(r.status, status, "and the code is reported");
  }
});

test("A BROKEN CONFIGURATION IS NOT AN OUTAGE — this is the guard that matters", async () => {
  // Calling these outages would make them park and auto-resume forever: the run slot burns and the real
  // error — the one a person could actually fix — never surfaces. Waiting repairs none of them.
  for (const status of [400, 401, 403, 404, 422]) {
    const r = await researchWith(async () => reply(status));
    assert.equal(r.ok, false);
    assert.notEqual(r.outage, true, `${status} must stay terminal and loud`);
  }
});

test("a network throw is not an outage either — deliberately narrow", async () => {
  // Defensible either way, and chosen conservatively: a permanently wrong endpoint throws exactly like a
  // transient DNS blip, and parking forever on a typo'd host is the worse failure.
  const r = await researchWith(async () => { throw new TypeError("fetch failed"); });
  assert.equal(r.ok, false);
  assert.notEqual(r.outage, true);
  assert.equal(r.status, null, "no status to report, and none invented");
});

test("a missing key is not an outage", async () => {
  const realKey = process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  try {
    const { RESEARCH_PROVIDERS } = await import("../driver.config.mjs");
    const r = await RESEARCH_PROVIDERS.perplexity.research("task");
    assert.equal(r.ok, false);
    assert.notEqual(r.outage, true, "an unconfigured deployment must fail loudly, not wait");
  } finally { if (realKey !== undefined) process.env.PERPLEXITY_API_KEY = realKey; }
});

// ── the lane's contract ──────────────────────────────────────────────────────────────────────────────

test("THE EXACT STRING IS THE CONTRACT: only `rate_limited` reaches the postpone lane", () => {
  // This is the whole defect in one assertion. The old throw's reason was a readable sentence, and a
  // readable sentence is not the magic word.
  assert.equal(new StageFailure("knockout-sweep", "rate_limited", null).rateLimited, true);
  assert.equal(new StageFailure("knockout-sweep", "all 3 research calls failed — nothing to assess", null).rateLimited, false,
    "the old reason string could never postpone, however true it was");
  assert.equal(new StageFailure("knockout-sweep", "rate_limited exceeded", null).rateLimited, false,
    "…and near-misses do not count either — it is an equality check, not a substring one");
});

test("THE LANE POSTPONES ONLY WHEN EVERY FAILURE IS OUTAGE-SHAPED", () => {
  // Asserted at the source: the branch sits inside knockoutInner and needs a whole run to reach. What has
  // to keep holding is the ALL, not ANY: a batch where two marks hit a 429 and one hit a bad key is a
  // broken configuration wearing an outage's clothes, and parking it would auto-resume forever while
  // burying the error a person could fix.
  const src = readFileSync(fileURLToPath(new URL("../pipeline-knockout.mjs", import.meta.url)), "utf8");
  const branch = src.slice(src.indexOf("if (degraded.size >= planMarks.length)"));
  const body = branch.slice(0, branch.indexOf("if (degraded.size) note("));
  assert.match(body, /outaged\.size >= planMarks\.length/, "every failed mark must be outage-shaped");
  assert.match(body, /throw new StageFailure\("knockout-sweep", "rate_limited", null\)/, "and only then is it the magic word");
  assert.ok(body.includes("nothing to assess"), "the mixed / unexplained case still ends the batch");
  assert.ok(src.includes("if (r?.outage === true) outaged.add(m.name);"), "the flag is collected per mark");
});

test("the PARTIAL-degrade doctrine is untouched — one bad mark must not stop a batch", () => {
  // runner.knockout-e2e pins that 1 of 3 marks failing still delivers (null-results doctrine). Only the
  // all-failed branch moved; if this guard ever became `outaged.size > 0` a single 429 would park a batch
  // that could have delivered.
  const src = readFileSync(fileURLToPath(new URL("../pipeline-knockout.mjs", import.meta.url)), "utf8");
  assert.ok(!/outaged\.size\s*>\s*0/.test(src), "no branch parks on a single outage-shaped mark");
  assert.match(src, /the batch continues \(null-results doctrine\)/, "the partial path is still there");
});
