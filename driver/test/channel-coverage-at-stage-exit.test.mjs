// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// part 2 — PLAN-VS-EXECUTED IS ANSWERABLE AT SEARCH-STAGE EXIT, AND IS ANSWERED THERE.
//
// Part 1 built the comparison and wired the ordered channel list into it. Both run at
// PUBLISH, where the rest of the carry trace is derived — about two hours after the sweep they describe.
// The issue asked whether the comparison is knowable earlier. It is: the merged grid is written at the
// end of the grid stage and the spec has been on disk since dispatch, so both inputs exist at that
// instant and neither changes afterwards.
//
// ── WHAT THIS FILE PINS, AND WHY EACH ONE COSTS SOMETHING TO GET WRONG ──────────────────────────────
//
// 1. ONE READ OF THE PLAN, shared by both seams. 's reason is specific: the plan is the grid
//    spec's `platforms`, NOT `ctx.profile.platforms`, because the two diverge on a generic profile
//    where channels come from the matter frame. Two copies of a rule that specific is how one of them
//    ends up reading the profile again and comparing the grid against a plan it was never given.
//
// 2. THE `unknown` STATE SURVIVES THE MOVE. A stage-exit check runs on runs whose spec never landed,
//    so moving the question earlier INCREASES the population that cannot answer it. If `unknown` were
//    to degrade to a clean 1 here, the change would have manufactured coverage out of runs that
//    ordered nothing — "a coverage question that was never asked must not answer itself in the
//    affirmative" is the whole, and it would have arrived through the fix.
//
// 3. IT ANNOTATES AND DOES NOT GATE. A profile legitimately lists a platform a given grid skipped;
//    promoting this to a floor on arrival is the  shape — a grammar killing paid work.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planVsExecutedChannels } from "../commonlaw-carry.mjs";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");

test("#1066 the check is called where the merged grid is written, not only at publish", () => {
  const at = SRC.indexOf("atomicWrite(P.commonLawGrid,");
  assert.ok(at > 0, "the canonical grid write moved — find it before trusting this test");
  const after = SRC.slice(at, at + 700);
  assert.match(after, /noteChannelCoverageAtStageExit\(P, mergedGrid\)/,
    "the stage-exit check is no longer wired to the grid write — the comparison silently went back to "
    + "reporting two hours late, which is exactly what #1066 part 2 is");
});

test("#1066 ONE derivation of the ordered channel list, shared by both seams", () => {
  const calls = SRC.match(/plannedChannelsFor\(P\)/g) ?? [];
  assert.ok(calls.length >= 2, `only ${calls.length} caller(s) of plannedChannelsFor — the publish site and `
    + "the stage-exit site must share it, or one of them will drift back to ctx.profile.platforms");
  // The specific drift ruled against, asserted directly rather than left to the comment.
  assert.ok(!/planned:\s*ctx\.profile\.platforms/.test(SRC),
    "something reads the PROFILE's platforms as the plan again. On a generic profile the channels come "
    + "from the matter frame, so that compares the grid against a plan it was never given — silently, on "
    + "exactly the regulated matters the fallback exists to serve");
});

test("#1066 the stage-exit reporter never fails the run it is describing", () => {
  const fn = SRC.slice(SRC.indexOf("function noteChannelCoverageAtStageExit"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
  assert.match(body, /try \{/, "the reporter must be wrapped — a coverage NOTE that kills a paid run is worse than the gap");
  assert.match(body, /catch/, "…and it must catch, not merely try");
  assert.ok(!/throw/.test(body), "the reporter throws — it describes a run, it does not judge one");
});

// ── THE STATE MACHINE ITSELF, at the inputs this seam actually sees ────────────────────────────────

test("#1066 no plan means UNKNOWN — never a clean sweep", () => {
  const r = planVsExecutedChannels({ planned: null, cells: [{ platform: "etsy" }], gaps: [] });
  assert.equal(r.state, "unknown");
  assert.equal(r.rate, null, "a rate that was never computed must not be reported as a rate");
  assert.equal(r.never_searched, null);
  assert.match(r.why, /not recorded/, "the reason travels with the state — an unknown with no why is a shrug");
});

test("#1066 a planned channel that produced nothing at all is NEVER-SEARCHED", () => {
  const r = planVsExecutedChannels({ planned: ["etsy", "ebay"], cells: [{ platform: "etsy" }], gaps: [] });
  assert.equal(r.state, "incomplete");
  assert.ok(r.never_searched.includes("ebay"));
});

test("#1066 a GAP is searched — an outage is not a coverage hole", () => {
  // The distinction that sends a reader to the right repair: a cell that RAN and produced nothing was
  // searched; only a channel with no cell and no gap was never looked at.
  //
  // Asserted on `ebay` specifically rather than on an empty never_searched, because `web` is unioned
  // into every non-empty plan by construction (: the driver appends one general-web search per
  // variant, and almost no profile lists it). A fixture with no web cell therefore reports web as never
  // searched, correctly. My first draft asserted the array was empty and failed on that — the code was
  // right and the expectation was wrong, which is worth leaving written down.
  for (const gaps of [[{ term: "X", platform: "ebay", error: "timeout" }], ["X | ebay | timeout"]]) {
    // BOTH gap shapes: the grid program appends strings, the reconciler and the merge append objects.
    // Reading one shape traces half a run.
    const r = planVsExecutedChannels({ planned: ["etsy", "ebay"], cells: [{ platform: "etsy" }], gaps });
    assert.ok(r.executed.includes("ebay"), `a gap must count as SEARCHED (${typeof gaps[0]} shape)`);
    assert.ok(!r.never_searched.includes("ebay"), "an outage was reported as a coverage hole");
  }
});

test("#1066 the driver-ordered general-web channel rides the plan, but only when a sweep was ordered", () => {
  // A finding from part 1, pinned here because the stage-exit seam now reports it too: `web` executes
  // on every run and almost no profile names it, so a naive comparison would report an unplanned
  // channel on EVERY run forever — an alarm that fires on correct behaviour is an alarm nobody reads.
  const withPlan = planVsExecutedChannels({ planned: ["etsy"], cells: [{ platform: "etsy" }], gaps: [] });
  assert.ok(withPlan.planned.includes("web"), "web is ordered by the driver and belongs in the plan");
  assert.deepEqual(withPlan.unplanned, [], "…so a web cell is never reported as unplanned");
  // And a profile that ordered NO sweep must not acquire a coverage hole out of nothing.
  const noPlan = planVsExecutedChannels({ planned: [], cells: [], gaps: [] });
  assert.deepEqual(noPlan.never_searched, [], "an empty plan orders nothing, so nothing is missing from it");
});