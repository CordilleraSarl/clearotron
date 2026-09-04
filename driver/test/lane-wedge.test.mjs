// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Lane-wedge resilience (teal-bastion 2026-06-15). A 0-token TIMEOUT = the gateway never admitted the turn to
// its serial command lane (heartbeat-sweep saturation), NOT a slow model. These pin the two load-bearing pure
// units: the classifier (isLaneWedge — which the production incident's NULL-usage hard-kill MUST trip, and an
// admitted/slow turn must NOT) and the fallback eligibility (lane_wedge cascades through providers, content
// failures never do). The chain-retry wrapper itself (stage() in pipeline.mjs) is a thin bounded loop over these.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLaneWedge, classifyWedge, followupHardWallStop } from "../gateway.mjs";
import { isFallbackEligible } from "../pipeline.mjs";

test("isLaneWedge: the REAL incident signature — a hard-kill 'timeout' with NULL usage — is a wedge", () => {
  assert.equal(isLaneWedge("timeout", null), true);
  assert.equal(isLaneWedge("timeout", undefined), true);
});

test("isLaneWedge: a timeout with all-zero usage is a wedge", () => {
  assert.equal(isLaneWedge("timeout", { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), true);
});

test("isLaneWedge: a timeout that moved ANY tokens is NOT a wedge (admitted / genuinely slow)", () => {
  assert.equal(isLaneWedge("timeout", { input: 8, output: 0 }), false);          // the recovered refutation: in=8
  assert.equal(isLaneWedge("timeout", { input: 0, output: 27742 }), false);      // produced output then timed out
  assert.equal(isLaneWedge("timeout", { cacheRead: 500 }), false);               // warm cache read = admitted
});

test("isLaneWedge: only the hard-kill 'timeout' fail qualifies — status_timeout / content fails do not", () => {
  assert.equal(isLaneWedge("status_timeout", null), false);   // gateway RETURNED an envelope ⇒ admitted/slow ⇒ cascade normally
  assert.equal(isLaneWedge("embedded_fallback", null), false);
  assert.equal(isLaneWedge("invalid_file:x/narrative.md:finding_registration_invalid", null), false);
  assert.equal(isLaneWedge(null, null), false);
  assert.equal(isLaneWedge(undefined, undefined), false);
});

test("classifyWedge: a STALL kill (0-token) stays a lane_wedge; a HARD-WALL kill is a plain timeout", () => {
  // The fix (live, 2026-06-19): a hard-wall SIGKILL produces null usage like a stall, but it ran the FULL
  // timeout — it is NOT a saturated lane. Only signals.hardWall discriminates; keep the stall path as a wedge.
  assert.equal(classifyWedge("timeout", null, { stalled: true }), "lane_wedge");        // real stall → wedge (cascades)
  assert.equal(classifyWedge("timeout", null, { hardWall: true }), "timeout");          // over-budget grind → NOT wedge
  assert.equal(classifyWedge("timeout", null, undefined), "lane_wedge");                // legacy/no-signals null-usage → wedge (unchanged)
  assert.equal(classifyWedge("timeout", { output: 5 }, { hardWall: true }), "timeout"); // moved tokens → never a wedge anyway
  assert.equal(classifyWedge("status_timeout", null, { hardWall: true }), "status_timeout"); // non-hard-kill envelope unchanged
  assert.equal(classifyWedge("invalid_file:x", null, { hardWall: true }), "invalid_file:x"); // content fail untouched
});

test("#5b followupHardWallStop: a FOLLOWUP hard-wall timeout stops after ONE attempt; a fresh one / a stall does NOT", () => {
  // the live bug: `warm` is ALWAYS false on a timeout chain (warmEligible excludes timeout), so the old
  // `warm && hardWall` break was dead → a hard-wall followup burned TWO attempts (~2.5× the wall). The thread
  // is `followup`.
  assert.equal(followupHardWallStop({ fail: "timeout", followup: true, signals: { hardWall: true } }), true, "followup + hard wall → stop after one");
  assert.equal(followupHardWallStop({ fail: "timeout", warm: true, signals: { hardWall: true } }), true, "a warm content-retry hard-wall also stops");
  // negatives — each must keep the normal one-extended-shot retry:
  assert.equal(followupHardWallStop({ fail: "timeout", followup: false, signals: { hardWall: true } }), false, "a FRESH stage gets its extended retry");
  assert.equal(followupHardWallStop({ fail: "timeout", followup: true, signals: { stalled: true } }), false, "a transient STALL is not stopped here (can clear)");
  assert.equal(followupHardWallStop({ fail: "timeout", followup: true, signals: undefined }), false, "no hard-wall signal → not stopped");
  assert.equal(followupHardWallStop({ fail: "lane_wedge", followup: true, signals: { hardWall: true } }), false, "only a `timeout` fail qualifies");
  assert.equal(followupHardWallStop({ fail: "invalid_file:x", followup: true, signals: { hardWall: true } }), false, "a content fail is never a hard-wall stop");
});

test("lane_wedge IS cross-provider-fallback-eligible (the chain cascades providers on a wedge)", () => {
  assert.equal(isFallbackEligible("lane_wedge"), true);
  assert.equal(isFallbackEligible("timeout"), true);
});

test("content failures still never cascade (the quality-floor guardrail is intact)", () => {
  assert.equal(isFallbackEligible("invalid_file:x/narrative.md:finding_registration_invalid"), false);
  assert.equal(isFallbackEligible("missing_file:x"), false);
  assert.equal(isFallbackEligible(null), false);
});
