// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A QUERY THE REGISTER REFUSES IS NAMED AS A REFUSAL, WITH THE SIZE OF WHAT WAS SENT.
//
// The provider answers a query its search service cannot take with that service's 400 wrapped in its own
// 500. The count probe passed that on as a bare HTTP 500, so a run's failure read as an outage several
// layers down. The service's bound is the number of OR terms in one field, not the query's length, so the
// reason names the term count, the characters, and the width this provider declares.
//
// Driven through the real count and enumerate arms with the network stubbed, so the text asserted is the
// text a run records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doCount, doEnumerate, doExecutePlan, countFailureReason, providerRejectedTheQuery, CAPABILITIES } from "../src/core.js";
import { joinPlanToBands } from "../../../driver/register-plan.mjs";
import { isCapabilityGapReason } from "../../../driver/coverage-ledger.mjs";

// The provider's answer to a query it refuses, in the shape the service gives it.
const WRAPPED = { errorMessage: "INTERNAL_SERVER_ERROR - 400  on POST request for \"http://search/search\": "
  + "\"{\\\"status\\\":400,\\\"error\\\":\\\"Bad Request\\\",\\\"path\\\":\\\"/search\\\"}\" (Error:500)" };
// A stack as wide as the declared width: the widest the kernel sends in one call, so the stubs below refuse
// it to stand for a service whose bound is not where the declaration puts it.
const W = CAPABILITIES.maxOrWidth;
const names = (n) => Array.from({ length: n }, (_, i) => `QZ${[2, 1, 0].map((k) => String.fromCharCode(65 + Math.floor(i / 26 ** k) % 26)).join("")}XXXXXXX`);

async function withFetch(status, body, fn) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  try { return { out: await fn(), sent }; } finally { globalThis.fetch = real; }
}

test("the count probe names a refused query with its term count, its size and the declared width", async () => {
  const { out, sent } = await withFetch(500, WRAPPED, () =>
    doCount("k", "https://x", { names: names(W), regions: ["US"], match_mode: "exact" }, null));
  const text = JSON.stringify(out);
  const value = sent.find((s) => s.url.endsWith("/count"))?.body?.searchFields?.[0]?.value ?? "";
  assert.equal(value.split(" OR ").length, W, "the stub did not see the whole stack");
  assert.match(text, /capability-gap: register_refused_query: the register refused this query as malformed \(a 400 inside its HTTP 500\)/);
  assert.match(text, new RegExp(`Sent ${W} OR terms \\(${value.length} characters\\); this provider's declared width is ${CAPABILITIES.maxOrWidth} terms\\.`));
  assert.match(text, /Provider's words: INTERNAL_SERVER_ERROR - 400/, "the provider's own words were dropped");
});

test("a run's enumerate records the named refusal, not a bare 500", async () => {
  const { out } = await withFetch(500, WRAPPED, () =>
    doEnumerate("k", "https://x", { names: names(W), regions: ["US"], match_mode: "exact" }, null));
  const reason = JSON.parse(out.text).reason;
  assert.match(reason, /^provider error on the count probe before enumeration: capability-gap: register_refused_query: /);
  assert.match(reason, new RegExp(`Sent ${W} OR terms \\(\\d+ characters\\)`), `the numbers did not survive the enumerate wrapper: ${reason}`);
});

test("THE CONTROL: any other failure keeps today's wording, and the owner retry cue is untouched", () => {
  assert.equal(countFailureReason(500, "Count Failed - US - something else", {}), "HTTP 500: Count Failed - US - something else");
  assert.equal(countFailureReason(502, "", {}), "HTTP 502");
  assert.equal(countFailureReason(400, "APPLICANT_NAME", {}), "HTTP 400: APPLICANT_NAME");
  // A refused query must not start the owner lane's fallback count that a bare HTTP 400 starts.
  assert.equal(providerRejectedTheQuery(countFailureReason(500, WRAPPED.errorMessage, { searchFields: [{ value: "A OR B" }] })), false);
  assert.equal(providerRejectedTheQuery("HTTP 400: APPLICANT_NAME"), true);
});

test("the plan executor defers a refused query at once, as a capability gap, and asks nothing more about it", async () => {
  // The service's bound, stubbed at the declared width: a stack that wide is refused, a narrower one counts.
  const dir = mkdtempSync(join(tmpdir(), "refused-query-"));
  const real = globalThis.fetch;
  const counts = new Map();
  globalThis.fetch = async (url, init) => {
    const value = JSON.parse(init?.body ?? "{}")?.searchFields?.[0]?.value ?? "";
    const terms = value.split(" OR ").length;
    counts.set(terms, (counts.get(terms) ?? 0) + 1);
    const refused = terms >= W;
    return new Response(JSON.stringify(refused ? WRAPPED : { counts: { US: 0 }, ids: {}, totalResults: 0 }),
      { status: refused ? 500 : 200, headers: { "content-type": "application/json" } });
  };
  try {
    const plan = { regions: ["US"], entries: [
      { qid: "q-wide", axis: "primary-sweep", predicate: "exact", terms: names(W), nice_classes: [9] },
      { qid: "q-narrow", axis: "primary-sweep", predicate: "exact", terms: names(3), nice_classes: [9] },
    ] };
    const planPath = join(dir, "register-plan.json"), outPath = join(dir, "primary-sweep-band.json");
    writeFileSync(planPath, JSON.stringify(plan));
    await doExecutePlan("k", "https://x", { plan_path: planPath, axis: "primary-sweep", output_path: outPath }, null);
    const blocks = JSON.parse(readFileSync(outPath, "utf8"));
    const wide = blocks.find((b) => b.qid === "q-wide");
    assert.equal(wide?.error, true);
    assert.equal(wide?.deferred, true, `a refused query was left to the recovery ladder: ${JSON.stringify(wide)}`);
    assert.ok(isCapabilityGapReason(wide.reason), "the deferral does not read as a capability gap downstream");
    assert.match(wide.reason, new RegExp(`Sent ${W} OR terms \\(\\d+ characters\\); this provider's declared width is ${W} terms\\.$`),
      `the numbers did not survive the executor's clip: ${wide.reason}`);
    const join_ = joinPlanToBands(plan, { "primary-sweep": blocks });
    assert.deepEqual(join_.deferred.map((d) => d.qid), ["q-wide"]);
    assert.deepEqual(join_.missing, [], "the refused slice is still a hole the fan-in will re-dispatch");
    assert.ok(join_.executed.some((e) => (e.qid ?? e) === "q-narrow"), "the narrow slice on the same axis did not run");
    // What it cost: the probe and the executor's one in-tool retry. The fetch no longer re-sends a refusal
    // on top of each, which made it four.
    assert.equal(counts.get(W), 2, `the refused query was sent ${counts.get(W)} times`);
  } finally { globalThis.fetch = real; rmSync(dir, { recursive: true, force: true }); }
});

test("THE CONTROL: an ordinary 500 is still sent again, once", async () => {
  const { sent } = await withFetch(500, { errorMessage: "Count Failed - US - the index is rebuilding" }, () =>
    doCount("k", "https://x", { names: names(3), regions: ["US"], match_mode: "exact" }, null));
  assert.equal(sent.filter((s) => s.url.endsWith("/count")).length, 2, "a transient 500 lost its one retry");
});

test("a stack wider than the declared width goes out in chunks the parser accepts", async () => {
  // The parser refuses a stack of 498 terms. The declared width sits below that, so a 500-name stack is
  // sent as two chunks, each under the refusal, and nothing is refused.
  const real = globalThis.fetch;
  const sizes = [];
  globalThis.fetch = async (url, init) => {
    const terms = (JSON.parse(init?.body ?? "{}")?.searchFields?.[0]?.value ?? "").split(" OR ").length;
    if (String(url).endsWith("/count")) sizes.push(terms);
    const refused = terms >= 498;
    return new Response(JSON.stringify(refused ? WRAPPED : { counts: { US: 0 }, ids: {}, totalResults: 0 }),
      { status: refused ? 500 : 200, headers: { "content-type": "application/json" } });
  };
  try {
    const { text } = await doEnumerate("k", "https://x", { names: names(500), regions: ["US"], match_mode: "exact" }, null);
    assert.doesNotMatch(text, /register_refused_query/, "a chunk was still wider than the parser takes");
    assert.deepEqual(sizes, [496, 4]);
  } finally { globalThis.fetch = real; }
});
