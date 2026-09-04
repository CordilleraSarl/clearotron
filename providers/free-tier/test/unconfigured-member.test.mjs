// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — WHAT THE COMPOSITE DOES WHEN ONE MEMBER IS NOT CONFIGURED ON THIS BOX.
//
// This is the BACKSTOP, not the mechanism. On a correctly planned run the unreachable office was split
// off at plan compile (driver/register-availability.mjs) and no qid for it ever reaches this file. These
// tests pin what happens when it does anyway — a wrong plan, a direct tool call, a future caller that
// does not know about the split.
//
// AN UNCONFIGURED MEMBER ARRIVES IN TWO SHAPES, AND THE FIRST VERSION OF THIS FILE KNEW ONLY ONE.
//
// resolveDbPath THROWS when USPTO_LOCAL_DB is unset, and the composite converts a throw into a
// disclosed gap. That is real, and it is what these tests originally covered — against a stub that
// throws.
//
// It is not what the provider does. Four of uspto-local's five entry points CATCH their own throw and
// return a plain tool error, so the throw never reached the composite and the backstop never fired for
// the provider it was written for. The tests passed anyway, because the stub behaved as the author
// believed rather than as the product does. That is the whole failure mode the test-quality lens looks
// for, found in the tests written to prevent it.
//
// Fixed at the source (2026-08-11): resolveDbPath throws WITH the capability-gap marker, so every path
// out of that provider carries it — the four that catch first included. Both shapes are covered below,
// and the real-member tests at the end are the ones that would have caught this.
//
// Before any of it, nothing caught the throw at all: it escaped the tool boundary with no gap marker
// and no deferred row, arriving as a stage failure carrying a provider's internal message — the shape
// was reported in ("the free-tier credential is absent" out of knockout-register-count, on a box
// whose EUIPO credentials were present and correct).
//
// THE TWO PROPERTIES ASSERTED EVERYWHERE BELOW, TOGETHER:
//   1. the result carries CAPABILITY_GAP_MARKER — so it becomes error:true + deferred:true, a DISCLOSED
//      coverage row, and is HELD rather than re-run (nothing a re-run does closes an unset variable, and
//      the ladder would spend a paid unit per attempt to re-derive the same deterministic no);
//   2. it NAMES the variable, so the reader can act on it.
// Either alone passes under a bug that matters — a gap nobody can act on, or an actionable message that
// silently re-runs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { doSearch, doEnumerate, doBatchScreen, doRecordFetch, doCountHits,
  _setMemberCore, _resetMemberCores } from "../src/core.js";
import { CAPABILITY_GAP_MARKER } from "../../_shared/execute-plan.mjs";

const THROWN = "[uspto-local] no index path. Set USPTO_LOCAL_DB to the synced US register file.";

/**
 * A member that THROWS. Kept, because a member CAN throw — but it is no longer the whole story.
 *
 * The first version of this file used only this stub and asserted the backstop worked. It does, for a
 * throw. The REAL uspto-local does not throw: four of its five entry points catch their own throw and
 * return a plain tool error, so the backstop never fired against the provider it was written for. A
 * stub whose behaviour is not the product's is a test that passes under the defect it names, and this
 * one did. The real-member test below is the one that matters; this one covers the other shape.
 */
function unconfiguredMember() {
  const boom = () => { throw new Error(THROWN); };
  return { CAPABILITIES: { offices: { covered: ["US"] } },
    doSearch: boom, doEnumerate: boom, doBatchScreen: boom, doRecordFetch: boom, doImageFetch: boom, doCountHits: boom };
}

/** A member that works, so "the other half still runs" is a real assertion and not a vacuous one. */
function workingMember() {
  return {
    CAPABILITIES: { offices: { covered: ["EU"] } },
    doSearch: async () => ({ type: "text", text: JSON.stringify({ results: [{ record_id: "/mark/eu/1" }], total_hits: 1, has_more: false }) }),
    doEnumerate: async () => ({ type: "text", text: JSON.stringify({ state: "enumerated", records: [], total_hits: 0 }) }),
    doBatchScreen: async () => ({ type: "text", text: JSON.stringify({ rows: [] }) }),
    doRecordFetch: async () => ({ type: "text", text: "{}" }),
    doCountHits: async () => ({ ok: true, total: 7 }),
  };
}

function wire() {
  _resetMemberCores();
  _setMemberCore("euipo", workingMember());
  _setMemberCore("uspto-local", unconfiguredMember());
}

const tctx = { kind: "probe" };
const textOf = (r) => (typeof r?.text === "string" ? r.text : String(r?.reason ?? ""));

const assertDisclosedGap = (r, what) => {
  const text = textOf(r);
  assert.ok(text.includes(CAPABILITY_GAP_MARKER),
    `${what}: must carry the capability-gap marker, or it is an ordinary failure the ladder RE-RUNS — `
    + `spending a paid unit per attempt against the same unset variable. Got: ${text.slice(0, 200)}`);
  assert.match(text, /USPTO_LOCAL_DB/,
    `${what}: must name the variable an operator has to set. A gap nobody can act on is a dead end.`);
};

test("search: a US slice on an unconfigured member is a disclosed gap, not a crash", async () => {
  wire();
  assertDisclosedGap(await doSearch(null, { name: "GLIMBEX", regions: ["US"] }, tctx), "search(US)");
});

test("search: an EU+US slice defers WHOLE — and still as a gap, never as a half answer", async () => {
  wire();
  const r = await doSearch(null, { name: "GLIMBEX", regions: ["EU", "US"] }, tctx);
  assertDisclosedGap(r, "search(EU+US)");
  // Deferring whole is the rule this provider is built on — joinPlanToBands has no shape for "half of
  // this ran", so EU rows must not ride out under a completeness claim they do not have. What
  // changed is that a correctly compiled plan never HANDS this function a two-office slice on a
  // half-configured box; when one arrives anyway, the honest answer is still the whole deferral.
  assert.doesNotMatch(textOf(r), /"results"/, "no half-band may escape wearing a complete answer's shape");
});

test("enumerate, batch screen and record fetch behave the same way", async () => {
  wire();
  assertDisclosedGap(await doEnumerate(null, { name: "GLIMBEX", regions: ["US"] }, tctx), "enumerate(US)");
  assertDisclosedGap(await doBatchScreen(null, { record_ids: ["/mark/us/9"] }, tctx), "batch_screen(US)");
  assertDisclosedGap(await doRecordFetch(null, { record_id: "/mark/us/9" }, tctx), "record_fetch(US)");
});

test("count: the total is UNKNOWN, never a partial sum, and never 0", async () => {
  wire();
  const r = await doCountHits(null, { name: "GLIMBEX", regions: ["US"] }, tctx);
  assertDisclosedGap(r, "count_hits(US)");
  assert.equal(r.ok, false);
  assert.equal(r.total, null,
    "a real number smaller than the truth is indistinguishable downstream from a complete one — "
    + "and 0 is the shape of a clean negative over a register nobody searched");
});

test("count is the surface #660 was REPORTED on, and it answers in its own shape", async () => {
  wire();
  const r = await doCountHits(null, { name: "GLIMBEX", regions: ["US"] }, tctx);
  // callMember cannot serve this path: the count answers in {ok,total,reason}, not a text tool result.
  // A guard written only for the text shape would leave exactly the lane the issue was filed from.
  assert.equal(typeof r.reason, "string");
  assert.equal(r.text, undefined, "the count contract is {ok,total,reason} — not a tool text result");
});

test("THE EU HALF STILL WORKS on the same box — the coverage this deployment has is not lost", async () => {
  wire();
  const r = await doSearch(null, { name: "GLIMBEX", regions: ["EU"] }, tctx);
  assert.ok(!textOf(r).startsWith("ERROR"),
    "an unconfigured US index must not disable the EU search — that was the whole cost of the old "
    + "both-members-required rule, and the reason the free tier could not run anywhere");
  assert.equal(JSON.parse(r.text).total_hits, 1);
  const c = await doCountHits(null, { name: "GLIMBEX", regions: ["EU"] }, tctx);
  assert.equal(c.ok, true);
  assert.equal(c.total, 7);
});


// ── THE REAL MEMBER, WITH NO INDEX CONFIGURED ───────────────────────────────────────────────────────
//
// Driven against providers/uspto-local/src/core.js itself rather than a stub, because the stub above is
// what made the original version of this file wrong: it throws, and the real provider does not.
//
// What the real one does with USPTO_LOCAL_DB unset:
//   doSearch / doRecordFetch / doBatchScreen  -> catch their own throw, return a plain tool ERROR
//   doCountHits                               -> {ok:false} with a plain reason
// None of those reach `callMember`'s catch, so none of them became a disclosed gap. They landed in the
// ordinary-error lane, which the recovery ladder RE-RUNS — spending a paid unit per attempt against an
// unset environment variable that answers identically every time.
//
// Fixed at the source: resolveDbPath now throws WITH the capability-gap marker, so every path out of
// that provider carries it — including the four that catch before the composite ever sees a throw.

test("the REAL uspto-local core marks an unset index as a capability gap, not an ordinary error", async () => {
  const us = await import("../../uspto-local/src/core.js");
  const probes = [
    ["doSearch", { name: "GLIMBEX" }],
    ["doRecordFetch", { record_id: "/mark/us/1" }],
    ["doBatchScreen", { record_ids: ["/mark/us/1"] }],
    ["doCountHits", { name: "GLIMBEX" }],
  ];
  const saved = process.env.USPTO_LOCAL_DB;
  delete process.env.USPTO_LOCAL_DB;
  try {
    for (const [fn, args] of probes) {
      const r = await us[fn]({}, args, { kind: "test" });
      const text = typeof r?.text === "string" ? r.text : String(r?.reason ?? "");
      assert.ok(text.includes(CAPABILITY_GAP_MARKER),
        `${fn}: an unset index must be a DISCLOSED, HELD gap. Without the marker the ladder re-runs it, `
        + `paying a unit per attempt to meet the same unset variable. Got: ${text.slice(0, 140)}`);
      assert.match(text, /USPTO_LOCAL_DB/, `${fn}: and it must name the variable to set`);
    }
  } finally { if (saved !== undefined) process.env.USPTO_LOCAL_DB = saved; }
});

test("…so the composite classifies it as a gap without needing the throw path at all", async () => {
  // The end-to-end version of the same point: free-tier routes a US slice to the real member core and
  // the result must arrive marked, through the normal return path rather than through callMember.
  _resetMemberCores();
  _setMemberCore("euipo", workingMember());
  const saved = process.env.USPTO_LOCAL_DB;
  delete process.env.USPTO_LOCAL_DB;
  try {
    const r = await doSearch(null, { name: "GLIMBEX", regions: ["US"] }, { kind: "test" });
    assert.ok(textOf(r).includes(CAPABILITY_GAP_MARKER),
      "a US slice on a box with no index must be a disclosed gap even though nothing threw");
  } finally { if (saved !== undefined) process.env.USPTO_LOCAL_DB = saved; _resetMemberCores(); }
});
