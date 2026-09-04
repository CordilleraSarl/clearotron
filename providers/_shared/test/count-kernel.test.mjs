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
