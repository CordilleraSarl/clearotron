// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The COUNT kernel — providers/_shared/count.mjs.
//
// One rule dominates this file: a count nobody took must never read as zero. Every failure case below
// exists to pin that, because the two are indistinguishable once they reach a narrow column on a
// report — and one of them is a wrong answer rather than a missing one.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeCountProbe } from "../count.mjs";
import { makeEnumerate } from "../enumerate.mjs";

const text = (obj) => ({ type: "text", text: JSON.stringify(obj) });

test('seam "cheap": the count rides page 0, and the smallest-response params are sent', async () => {
  const seen = [];
  const count = makeCountProbe({
    search: async (_auth, params) => { seen.push(params); return text({ total_hits: 412, results: [{ record_id: "a" }] }); },
    capabilities: { countProbe: "cheap" },
  });
  const r = await count("auth", { name: "IRONWHISK", nice_classes: [8] }, {});
  assert.deepEqual(r, { ok: true, total: 412, probe: "cheap", reason: null });
  assert.equal(seen.length, 1, "ONE call — a count is one round trip, never a page loop");
  assert.equal(seen[0].limit, 1);
  assert.deepEqual(seen[0].fields, ["uri"]);
  assert.equal(seen[0].name, "IRONWHISK", "the caller's query is passed through untouched");
});

test('seam "endpoint": the count call answers directly, and per-office truth rides along', async () => {
  const count = makeCountProbe({
    count: async () => ({ ok: true, total: 18, per_office: { US: 12, EM: 6 } }),
    search: async () => { throw new Error("the endpoint seam must NEVER reach the search"); },
    capabilities: { countProbe: "endpoint" },
  });
  const r = await count({ apiKey: "k" }, { name: "X", regions: ["US"] }, {});
  assert.equal(r.ok, true);
  assert.equal(r.total, 18);
  assert.deepEqual(r.per_office, { US: 12, EM: 6 });
});

test('seam "none": REFUSES — it never degrades to a zero', async () => {
  const count = makeCountProbe({ capabilities: { countProbe: "none" } });
  const r = await count("auth", { name: "X" }, {});
  assert.equal(r.ok, false);
  assert.equal(r.total, null, "null, not 0 — the number is unknown");
  assert.equal(r.unsupported, true, "and the caller can tell an ABSENT capability from a failed call");
  assert.match(r.reason, /not the same as none/);
});

test("every failure path returns null — a provider error can never be read as 'no filings'", async () => {
  const endpointFailed = makeCountProbe({
    count: async () => ({ ok: false, reason: "HTTP 502" }),
    capabilities: { countProbe: "endpoint" },
  });
  assert.deepEqual(await endpointFailed({}, {}, {}), { ok: false, total: null, probe: "endpoint", reason: "HTTP 502" });

  const cheapErrored = makeCountProbe({
    search: async () => ({ type: "text", text: "ERROR: corsearch_search HTTP 500" }),
    capabilities: { countProbe: "cheap" },
  });
  const e = await cheapErrored("auth", {}, {});
  assert.equal(e.ok, false);
  assert.equal(e.total, null);
  assert.match(e.reason, /HTTP 500/);

  const cheapGarbage = makeCountProbe({
    search: async () => ({ type: "text", text: "<html>gateway timeout</html>" }),
    capabilities: { countProbe: "cheap" },
  });
  const g = await cheapGarbage("auth", {}, {});
  assert.equal(g.ok, false);
  assert.equal(g.total, null);

  // A CLIENT-SIDE refusal keeps its marker verbatim, so callers can tell "no retry will help" from
  // "try again" — the capability-gap distinction execute-plan already draws.
  const gap = makeCountProbe({
    count: async () => ({ ok: false, reason: "capability-gap: multi-word term under a space-unsafe mode" }),
    capabilities: { countProbe: "endpoint" },
  });
  assert.match((await gap({}, {}, {})).reason, /^capability-gap:/);
});

// This test used to assert the OPPOSITE — "a parsed response with no total is a COUNTED zero — the one
// place 0 is an answer" — on the reasoning that normalizeSearchResponse always emits total_hits, so a
// missing key could only mean an honest empty set. The premise was true and the conclusion was not: the
// normalizer emitted the key for an ABSENT body too, defaulting it to 0. So a 200 whose body a proxy cut
// mid-stream reached this line as total_hits 0 and left it as {ok:true, total:0} — this file's own rule
// ("a count nobody took must never read as zero") broken from the inside, by the comment that licensed
// the coercion. The number has to BE a number. Nothing else is an answer, and 0 is not the safe default
// to fall back to — it is the single most expensive wrong answer this system can give.
test("a response with NO usable total is NOT a zero — nothing here defaults a missing number to 0", async () => {
  const count = makeCountProbe({
    search: async () => text({ results: [] }),
    capabilities: { countProbe: "cheap" },
  });
  const r = await count("auth", {}, {});
  assert.equal(r.ok, false);
  assert.equal(r.total, null, "null, not 0 — nothing was counted");
  assert.match(r.reason, /no usable total_hits/);

  // …and a real, counted zero still comes through as one. The rule discriminates on whether a number
  // was reported, never on whether it was small — a register that genuinely holds nothing must still be
  // able to say so.
  const honest = makeCountProbe({
    search: async () => text({ total_hits: 0, results: [] }),
    capabilities: { countProbe: "cheap" },
  });
  assert.deepEqual(await honest("auth", {}, {}), { ok: true, total: 0, probe: "cheap", reason: null });
});

test("THE ENUMERATE CEILING DOES NOT APPLY — a big number is the answer, not a crowd", async () => {
  // Over in enumerate.mjs a total past the ceiling means "this band cannot be exhausted" and yields a
  // crowd descriptor. Here there is nothing to exhaust: 209012 is simply how many there are, and on a
  // name-selection screen it is the single most useful thing the register can say.
  const count = makeCountProbe({
    search: async () => text({ total_hits: 209012, results: [] }),
    capabilities: { countProbe: "cheap" },
  });
  const r = await count("auth", { name: "SUN" }, {});
  assert.equal(r.ok, true);
  assert.equal(r.total, 209012);
  assert.equal(r.state, undefined, "no completeness state — this kernel makes no completeness claim");
  assert.equal(r.reason, null, "and no crowd reason");
});

test("construction fails loud when the seam has no dependency to run on", () => {
  assert.throws(() => makeCountProbe({ capabilities: { countProbe: "endpoint" } }), /requires a count\(\)/);
  assert.throws(() => makeCountProbe({ capabilities: { countProbe: "cheap" } }), /requires a search\(\)/);
});

// ── the agreement that makes the extraction worth doing ──────────────────────────────────────────────
// makeEnumerate's per-term rescue probe IS this kernel. The two answers cannot drift, because there is
// only one implementation — this test is what pins that claim to observable behaviour rather than to a
// comment. A term whose probe FAILS must stay `error` (never verified-zero), which is the same
// null-not-zero rule one layer up.
test("enumerate's per-term probe is this kernel — same calls, same null-on-failure", async () => {
  const calls = [];
  const totals = { FROSTBERRY: 0, ICEBERRY: 9000, HAILBERRY: null };
  const { enumerate } = makeEnumerate({
    search: async (_auth, params) => {
      calls.push(params);
      const term = params.names?.[0];
      // the whole-stack page-0 probe crowds, forcing the per-term rescue
      if (!term || params.names.length > 1) return text({ total_hits: 9999, results: [], has_more: false });
      const n = totals[term];
      if (n == null) return { type: "text", text: "ERROR: provider exploded" };
      return text({ total_hits: n, results: [], has_more: false });
    },
    capabilities: { countProbe: "cheap", ceilingDefault: 600, pageSize: 100, pageGuard: 5 },
  });
  const r = await enumerate("auth", { names: ["FROSTBERRY", "ICEBERRY", "HAILBERRY"] }, {});
  const parsed = JSON.parse(r.text);
  assert.equal(parsed.state, "incomplete");
  assert.equal(parsed.term_counts.FROSTBERRY.disposition, "verified-zero", "a PROBED zero is a true zero");
  assert.equal(parsed.term_counts.ICEBERRY.disposition, "crowd");
  assert.equal(parsed.term_counts.HAILBERRY.disposition, "error", "a FAILED probe is never a zero");
  assert.equal(parsed.term_counts.HAILBERRY.total_hits, null);
  // and the probe used the cheap seam's smallest-response params, exactly as the standalone kernel does
  const probes = calls.filter((c) => c.names?.length === 1 && c.limit === 1);
  assert.ok(probes.length >= 3, "one probe per term, through the shared kernel");
  assert.deepEqual(probes[0].fields, ["uri"]);
});

// ── THE REFUSAL THAT WAS NEVER RECOGNISED ─────────────────────────────────────────────────────────
//
// A provider can refuse to COUNT a slice because the query shape would match too much. That is not an
// outage and not a transient: the same shape is refused identically on every future run, so retrying
// it is work that cannot succeed, and recording it as a provider error files a searched slice as a
// permanent gap. The kernel has an arm for exactly this — it returns a CROWD descriptor with an
// unknown total rather than a zero — and the arm is keyed on a recogniser the provider declares.
//
// It had never fired. The clarivate provider declared the recogniser at the top of its capabilities
// file and built its enumeration from the KERNEL SUBSET of that file, which did not carry the key, so
// every refusal rode the repair ladder and landed as a gap. Both halves are driven below: the kernel
// behaviour, and the wiring that decides whether the kernel ever sees it.
test("a count refusal keyed on the provider's own sentence becomes a crowd, not a zero and not a retry", async () => {
  const REFUSAL = "HTTP 500: INTERNAL_SERVER_ERROR - Count Failed - IL - Near/Adj queries with sub queries "
    + "that can return a huge amount of results are not allowed";
  let counts = 0;
  const { enumerate } = makeEnumerate({
    count: async () => { counts += 1; return { ok: false, total: null, reason: REFUSAL }; },
    search: async () => { throw new Error("a refused count must never reach the search — that is the spend this arm prevents"); },
    capabilities: {
      countProbe: "endpoint",
      cardinalityRefusal: /Near\/Adj queries with sub queries that can return a huge amount of results are not allowed/i,
    },
  });
  const parsed = JSON.parse((await enumerate("auth", { name: "PLAN B", nice_classes: [9] }, {})).text);

  assert.equal(parsed.state, "incomplete", "a slice nobody could count is never complete");
  assert.equal(parsed.total_hits, null, "UNKNOWN, not zero — the count never returned, and a zero here is a false clean");
  assert.equal(parsed.crowd_basis, "provider-refused-count");
  assert.equal(parsed.count_unavailable, true);
  assert.equal(counts, 1, "one probe: a structural refusal is the same on every attempt, so the ladder has nothing to offer it");

  // THE CONTROL, and without it this arm would pass just as well on a kernel that called everything a
  // crowd: an ordinary count failure is NOT this, and must still read as a provider error with a zero
  // it can defend — the two answers have to be different or the recogniser is decorative.
  const { enumerate: plain } = makeEnumerate({
    count: async () => ({ ok: false, total: null, reason: "HTTP 503: upstream briefly unavailable" }),
    search: async () => text({ total_hits: 0, results: [], has_more: false }),
    capabilities: {
      countProbe: "endpoint",
      cardinalityRefusal: /Near\/Adj queries with sub queries that can return a huge amount of results are not allowed/i,
    },
  });
  const other = JSON.parse((await plain("auth", { name: "PLAN B" }, {})).text);
  assert.notEqual(other.crowd_basis, "provider-refused-count", "a transient outage is not a structural refusal");
});

test("the provider that declares the recogniser hands it to the kernel it builds", async () => {
  // THE WIRING, ASSERTED AT THE ONE PLACE IT CAN BREAK. The arm above proves the kernel behaves when it
  // is given the recogniser; this proves it is given one. Those are different claims, and for the life
  // of this code the first was true and the second was false.
  const { CAPABILITIES } = await import("../../clarivate/src/capabilities.js");
  assert.ok(CAPABILITIES.kernel.cardinalityRefusal instanceof RegExp,
    "the enumeration seam reads `cardinalityRefusal` off the kernel subset — declared anywhere else, it is dead");
  assert.equal(CAPABILITIES.kernel.cardinalityRefusal, CAPABILITIES.cardinalityRefusal,
    "and it must be the SAME object, not a second copy that agrees today");
  assert.match("Count Failed - IL - Near/Adj queries with sub queries that can return a huge amount of results are not allowed",
    CAPABILITIES.kernel.cardinalityRefusal, "the sentence the provider actually sends still matches it");
});
