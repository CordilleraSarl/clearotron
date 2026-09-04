// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// channels-plan-vs-executed.test.mjs —, the half that is knowable without the pipeline.
//
// THE METRIC WAS HONEST ABOUT WHAT IT MEASURED AND SILENT ABOUT WHAT IT NEVER LOOKED AT. Mandatory CN
// marketplace channels were never searched on a 139-minute run, and the summary read as if coverage were
// complete. The reason is structural, not a bug in a formula: both reconciliation rates divide the run by
// itself — retrieved-by-retrieved, rowed-cells-by-candidate-bearing-cells — so a channel that produced no
// cell and no candidate enters NEITHER numerator NOR denominator. Three of eight swept and fully
// reconciled scores identically to eight of eight, and the committed floor cannot fire, because a rate
// that was never computed is not a rate below a floor.
//
// WHAT THIS DOES AND DOES NOT CLOSE. The comparison is here and it is pure. The PLAN is not in the grid
// artifact — `common-law-grid.json`'s top-level keys are `cells`, `extras`, `gaps`, the executed set only
// — so the ordered list has to be handed in, and the call site that would hand it in belongs to another
// lane's active work. Until it does, this reports an explicit unknown, which is the point: a run that
// cannot say what it was ordered to search must not score clean on coverage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planVsExecutedChannels, traceCommonLawCarry, reconciliationRates, reconciliationVerdict } from "../commonlaw-carry.mjs";

// A REAL PROFILE SHAPE: store domains only. `web` is NOT here, because the profile does not list it —
// the driver appends the general-web search to every dictation. Hard-coding it into this fixture would
// have assumed the answer to the question the carve-out below exists to settle.
const PLANNED = ["taobao.com", "jd.com", "1688.com", "amazon.com"];

test("#1066 THE DEFECT: a planned channel that produced nothing is named, not averaged away", () => {
  const r = planVsExecutedChannels({
    planned: PLANNED,
    cells: [{ term: "delphi", platform: "amazon.com" }, { term: "delphi", platform: "web" }],
  });
  assert.equal(r.state, "incomplete");
  assert.deepEqual(r.never_searched, ["1688.com", "jd.com", "taobao.com"],
    "the three mandatory channels the run never reached must be NAMED — a count alone is what a reader "
    + "cannot act on, and the whole finding is which ones");
  assert.equal(r.rate, 2 / 5);
});

test("#1066 a GAP is searched — it ran and produced nothing, which is the opposite of never searched", () => {
  // The distinction the grid already draws and no metric consumed. Both gap shapes ship: the grid program
  // appends strings, the reconciler and the driver's merge append objects. Reading one traces half a run.
  const r = planVsExecutedChannels({
    planned: PLANNED,
    cells: [{ term: "delphi", platform: "amazon.com" }],
    gaps: ["delphi | taobao.com | HTTP 503", { term: "delphi", platform: "jd.com", error: "blocked" }],
  });
  assert.deepEqual(r.never_searched, ["1688.com", "web"],
    "a channel that reported a gap was reached; counting it as never-searched would turn an outage into a "
    + "coverage hole and send the reader to the wrong repair");
  assert.equal(r.state, "incomplete");
});

test("#1066 complete is complete, and platform names normalise the way cell keys do", () => {
  const r = planVsExecutedChannels({
    planned: ["Taobao.com", " JD.com ", "web"],
    cells: [{ platform: "taobao.com" }, { platform: "jd.com" }, { platform: "WEB" }],
  });
  assert.equal(r.state, "complete");
  assert.deepEqual(r.never_searched, []);
  assert.equal(r.rate, 1);
});

test("#1066 THE DRIVER-ORDERED WEB CHANNEL IS PLANNED, whatever the profile lists", () => {
  // The dictation appends "ONE unrestricted general-web search per variant (platform name \"web\")" to
  // every profile's platform list. So `web` is executed on every run and named by almost no profile. A
  // comparison that read it off the profile alone would report an unplanned channel on EVERY run — an
  // alarm that fires on correct behaviour is an alarm nobody reads, and it would bury the real ones.
  const r = planVsExecutedChannels({
    planned: PLANNED,                                        // no `web` — the real profile shape
    cells: PLANNED.map((p) => ({ platform: p })).concat([{ platform: "web" }]),
  });
  assert.deepEqual(r.unplanned, [], "the general-web search was reported as a channel nobody ordered");
  assert.equal(r.state, "complete");
  assert.ok(r.planned.includes("web"), "and it belongs on the PLANNED side — the driver ordered it");
});

test("#1066 and the useful direction still works: a grid that never ran web says so", () => {
  // The carve-out must not become a blanket exemption. The driver ordered the general-web search, so a
  // run that never produced a web cell has a real coverage hole, and it is the one the profile can never
  // name for itself.
  const r = planVsExecutedChannels({ planned: PLANNED, cells: PLANNED.map((p) => ({ platform: p })) });
  assert.deepEqual(r.never_searched, ["web"]);
  assert.equal(r.state, "incomplete");
});

test("#1066 NO PLAN IS AN EXPLICIT UNKNOWN, never a clean 1", () => {
  // The failure this whole issue is about, arriving one level up: a coverage question that was never
  // asked must not answer itself in the affirmative.
  const r = planVsExecutedChannels({ cells: [{ platform: "amazon.com" }] });
  assert.equal(r.state, "unknown");
  assert.equal(r.rate, null, "an unasked question scored 1.0 is exactly what #1066 filed");
  assert.equal(r.never_searched, null, "and it must not claim an empty never-searched list either");
  assert.match(r.why, /ORDERED/i, "the unknown must say what is missing — the PLAN, not the search");
  assert.deepEqual(r.executed, ["amazon.com"], "what DID run is still reported — the unknown is the plan");
});

test("#1066 a swept channel nobody planned is reported, not swallowed", () => {
  const r = planVsExecutedChannels({ planned: ["amazon.com"], cells: [{ platform: "amazon.com" }, { platform: "web" }, { platform: "etsy.com" }] });
  assert.deepEqual(r.unplanned, ["etsy.com"],
    "a widened sweep and a mis-keyed plan look identical from the never-searched list alone");
  assert.equal(r.state, "complete", "and an extra channel is not a coverage hole");
});

test("#1066 the trace carries the block, and the rate can read below 1", () => {
  const grid = JSON.stringify({ cells: [
    { term: "delphi", platform: "amazon.com", status: "ok", candidates: [{ title: "DELPHI", url: "https://a/1" }] },
  ], gaps: [] });
  const artifact = traceCommonLawCarry({ gridRaw: grid, findingsText: "", planned: PLANNED });
  assert.equal(artifact.totals.channels.state, "incomplete");
  const rates = reconciliationRates(artifact);
  assert.equal(rates.channels.planned, 5);
  assert.equal(rates.channels.searched, 1);
  assert.equal(rates.channels.rate, 1 / 5);
  // And the two self-referential rates are unchanged — this adds a denominator, it does not move theirs.
  assert.equal(rates.candidates.retrieved, 1);
});

test("#1066 a trace with no plan reports channels unknown rather than omitting the question", () => {
  const grid = JSON.stringify({ cells: [{ term: "d", platform: "web", status: "ok", candidates: [] }], gaps: [] });
  const rates = reconciliationRates(traceCommonLawCarry({ gridRaw: grid, findingsText: "" }));
  assert.equal(rates.channels.state, "unknown");
  assert.equal(rates.channels.rate, null);
  assert.match(rates.channels.why, /not recorded/i);
});

test("#1066 the channel rate is NOT a floor yet — deliberately, and the verdict must not trip on it", () => {
  // Annotate first, ratchet after a measured round. A profile legitimately lists platforms a given grid
  // skips, so a hard gate on arrival reds every run on day one — the shape, a grammar killing paid
  // work. This test exists so that turning it into a gate is a decision somebody makes, not a drift.
  const grid = JSON.stringify({ cells: [
    { term: "d", platform: "web", status: "ok", candidates: [{ title: "X", url: "https://x/1" }] },
  ], gaps: [] });
  const artifact = traceCommonLawCarry({ gridRaw: grid, findingsText: "- X — https://x/1 — reasoned", planned: PLANNED });
  const v = reconciliationVerdict(artifact, { candidates: { min_rate: 0.5 }, cells: { min_rate: 0.5 }, channels: { min_rate: 0.9 } });
  assert.ok(!v.trips.some((t) => t.metric === "channels"),
    "the channel rate joined the floor comparison without anyone deciding it should");
});

test("#1066 nothing here throws on a shape that is not a plan", () => {
  for (const bad of [null, undefined, {}, { planned: "taobao.com" }, { planned: [null, "", "  "] }, { cells: "x", gaps: 7 }]) {
    const r = planVsExecutedChannels(bad);
    assert.ok(["unknown", "complete", "incomplete"].includes(r.state), `${JSON.stringify(bad)} produced ${r.state}`);
  }
  // A plan of only-blank entries orders nothing, so it misses nothing and scores no rate — and it must
  // NOT pick up the driver's web channel, which is only ordered alongside a non-empty platform list.
  const blank = planVsExecutedChannels({ planned: ["", "  "], cells: [] });
  assert.equal(blank.rate, null, "0/0 is not a coverage score");
  assert.deepEqual(blank.never_searched, [], "an empty plan cannot have missed anything");
  assert.deepEqual(blank.planned, [], "the always-planned channel was unioned into a plan that ordered nothing");
});
