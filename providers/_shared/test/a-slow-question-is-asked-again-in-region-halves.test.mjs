// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A QUESTION SLOWER THAN THE REGISTER'S GATEWAY WAITS IS ASKED AGAIN IN REGION HALVES.
//
// One question across 186 regions came back HTTP 504 from a register's gateway on every attempt, and the
// slice it answered was lost. The shared enumeration now asks the same question on each half of its
// regions after a gateway timeout, halves again only a half that still times out while its sibling
// answered, and merges the parts. When both halves time out, the regions are not what makes it slow: the
// question is not answered this run, with that reason. A question that answers is asked once, as before,
// and any other error is reported as before.
//
// Driven through makeEnumerate with a stand-in register that times out above a number of regions, so the
// calls asserted are the calls a run makes. Every error keeps its whole text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "region-halves-"));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(TMP, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = join(TMP, "records.jsonl");

const { makeEnumerate, isGatewayTimeout, isGatewayStall, GATEWAY_STALL } = await import("../enumerate.mjs");

// The gateway's own answer: longer than any clip the kernel used to apply, with its last words last.
const GATEWAY = "ERROR: register_search HTTP 504: " + JSON.stringify({
  type: "https://gateway.example.test/errors/504", title: "Error 504: Gateway time-out", status: 504,
  detail: "The origin web server timed out responding to this request. " + "x".repeat(600) + " END-OF-BODY",
});
const REGIONS = ["AA", "BB", "CC", "DD", "EE", "FF", "GG", "HH"];
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const parse = (r) => JSON.parse(r.text);
const recordsFor = (regions, perRegion) => regions.flatMap((r) => Array.from({ length: perRegion }, (_, i) => ({ record_id: `/mark/${r.toLowerCase()}/${i}` })));

/**
 * A register that times out on the questions `slow` picks and answers the rest; every question is logged.
 * `limit` is the plain case: it times out above that many regions.
 */
function register({ limit = Infinity, slow = (regions) => regions.length > limit, perRegion = 1, error = GATEWAY, ceilingDefault = 600, countProbe = "cheap" } = {}) {
  const asked = [];
  const answer = (params) => {
    asked.push(params.regions.length);
    if (slow(params.regions)) return null;
    return recordsFor(params.regions, perRegion);
  };
  const { enumerate } = makeEnumerate({
    search: async (_auth, params) => {
      const rows = answer(params);
      if (!rows) return { type: "text", text: error };
      return ok({ total_hits: rows.length, results: rows, has_more: false });
    },
    ...(countProbe === "endpoint" ? { count: async (_auth, params) => {
      if (slow(params.regions)) return { ok: false, total: null, reason: "HTTP 504: Error 504: Gateway time-out" };
      return { ok: true, total: params.regions.length * perRegion };
    } } : {}),
    capabilities: { countProbe, screenSource: "search-row", ceilingDefault },
    rowScreen: () => ({ verdict: "live" }),
  });
  return { enumerate: (params) => enumerate({}, params, null), asked };
}

test("a question that answers is asked once, with no split and nothing added to its answer", async () => {
  const { enumerate, asked } = register({ limit: 1000 });
  const out = parse(await enumerate({ names: ["QZXV"], regions: REGIONS }));
  assert.deepEqual(asked, [8]);
  assert.equal(out.state, "enumerated");
  assert.equal(out.count, 8);
  assert.equal("region_split" in out, false);
});

test("a gateway timeout is asked again in halves, a half that still times out alone is halved again, and the parts merge", async () => {
  // Slow only where HH is asked alongside more than one other region: the half without it answers.
  const { enumerate, asked } = register({ slow: (r) => r.includes("HH") && r.length > 2, perRegion: 2 });
  const out = parse(await enumerate({ names: ["QZXV"], regions: REGIONS }));
  assert.deepEqual(asked, [8, 4, 4, 2, 2], "the whole, each half as it stands, then the half that timed out alone, halved");
  assert.equal(out.state, "enumerated");
  assert.equal(out.total_hits, 16);
  assert.deepEqual(out.records.map((r) => r.record_id), recordsFor(REGIONS, 2).map((r) => r.record_id), "every region's records, once each, in region order");
  assert.deepEqual(out.region_split.parts, [4, 2, 2], "the size of every part that answered");
  assert.equal(out.region_split.cause, GATEWAY, "the timeout that started it, whole");
});

test("when both halves time out too, the regions are not the cause: halving stops and the question is not answered", async () => {
  const { enumerate, asked } = register({ limit: 3 });
  const out = parse(await enumerate({ names: ["QZXV"], regions: REGIONS }));
  assert.deepEqual(asked, [8, 4, 4], "the whole and each half once, and nothing more");
  assert.equal(out.state, "incomplete");
  assert.ok(out.reason.startsWith(`provider error — ${GATEWAY_STALL}: after a gateway timeout the question was asked again on each half of its regions, and both halves timed out too`), out.reason);
  assert.equal(isGatewayStall(out.reason), true, "the executor must be able to read it as a stall");
  assert.ok(out.reason.includes("END-OF-BODY"), "the gateway's words, whole");
  assert.deepEqual(out.region_split.parts, []);
});

test("a single region that still times out alone is the same stall: nothing is left to halve, and the stall leads the reason", async () => {
  const { enumerate, asked } = register({ slow: (r) => r.includes("AA") });
  const out = parse(await enumerate({ names: ["QZXV"], regions: REGIONS }));
  assert.deepEqual(asked, [8, 4, 4, 2, 2, 1, 1], "down the slow side to one region, and no further");
  assert.equal(out.state, "incomplete");
  assert.ok(out.reason.startsWith(`provider error — ${GATEWAY_STALL}: after a gateway timeout the question was asked again in region halves `
    + "down to the one region AA, which timed out alone too, so it is not answered this run. The gateway's words: "),
    `the stall does not lead the reason, so a cut reason would lose it: ${out.reason.slice(0, 160)}`);
  assert.ok(out.reason.includes("END-OF-BODY"), "the gateway's body was clipped");
  assert.equal(isGatewayStall(out.reason), true, "a region that times out alone meets the same wall, so it is a stall");
  assert.ok(out.region_split, "the answer no longer says it was asked in parts");
});

test("THE CONTROL: any other error is reported as before, whole, and asked once", async () => {
  const error = "ERROR: register_search HTTP 500: " + "y".repeat(700) + " END-OF-BODY";
  const { enumerate, asked } = register({ limit: 0, error });
  const out = parse(await enumerate({ names: ["QZXV"], regions: REGIONS }));
  assert.deepEqual(asked, [8]);
  assert.equal(out.state, "incomplete");
  assert.equal(out.reason, `provider error during enumeration (page 0): ${error}`, "the error keeps its whole text");
  assert.equal("region_split" in out, false);
});

test("THE CONTROL: a single-region question that times out has nothing to split", async () => {
  const { enumerate, asked } = register({ limit: 0 });
  const out = parse(await enumerate({ names: ["QZXV"], regions: ["AA"] }));
  assert.deepEqual(asked, [1]);
  assert.equal(out.reason, `provider error during enumeration (page 0): ${GATEWAY}`);
});

test("the merged total is held to the ceiling the whole question would have met", async () => {
  // Each half is under the ceiling of 10; the two together are not.
  const { enumerate } = register({ limit: 4, perRegion: 2, ceilingDefault: 10 });
  const out = parse(await enumerate({ names: ["QZXV"], regions: REGIONS }));
  assert.equal(out.state, "incomplete");
  assert.equal(out.total_hits, 16);
  assert.match(out.reason, /exceeds the enumerate ceiling 10 — this is a CROWD/);
  assert.deepEqual(out.region_split.parts, [4, 4]);
});

test("a count probe that times out is asked again in halves too", async () => {
  const { enumerate } = register({ limit: 2, countProbe: "endpoint" });
  const out = parse(await enumerate({ names: ["QZXV"], regions: REGIONS.slice(0, 4) }));
  assert.equal(out.state, "enumerated");
  assert.equal(out.count, 4);
  assert.deepEqual(out.region_split.parts, [2, 2]);
  assert.match(out.region_split.cause, /Gateway time-out/);
});

test("what counts as a gateway timeout", () => {
  for (const yes of ["ERROR: x HTTP 504: {}", "HTTP 524", "Error 504: Gateway time-out", "gateway timeout"]) assert.equal(isGatewayTimeout(yes), true, yes);
  for (const no of ["HTTP 500: x", "HTTP 502", "HTTP 5040", "tooManyResults: 40000", "", null]) assert.equal(isGatewayTimeout(no), false, String(no));
});
