// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The register-unit message must agree with the LANE its plan declares (ION/copper-foundry 2026-07-22).
//
// pipeline.mjs strips `mcp__register__register_enumerate` from the unit's toolset whenever the frozen
// plan carries `contract.supplemental_lane` — the exclusion keys on the contract and NOTHING else. The
// message, however, gated its "propose via register_propose_supplemental" instruction on the axis having
// DICTATED ENTRIES, and separately told every unit to "Pin EVERY register_enumerate…" and to write the
// band file itself.
//
// ION's incumbent-class axis had zero dictated entries. It therefore received the ban with no
// replacement, plus two standing instructions to use the banned tool. It reached for the tool, found it
// absent, reported `register_enumerate` "persistently blocked by a tool-permission gate … across every
// retry" — a FALSE tool-outage line in a lawyer-facing report — and fell back to count-only
// register_search: 10 of Apple's 432 hits reviewed, 10 of Amazon's 225, 10 of Microsoft's 114, then
// wrote those samples into the band as qid-less blocks.
//
// The invariant, pinned here: a supplemental-lane unit message NEVER instructs the model to call
// register_enumerate or to author band blocks, and ALWAYS names the proposal path — with or without
// dictated entries on the axis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, OWNER_SWEEP_STEERING } from "../stages.mjs";

const P = {
  variantManifest: "vm.json", matterContext: "mc.md",
  registerBand: (a) => `band-${a}.json`, registerUnit: (a) => `unit-${a}.md`,
  registerPlan: "plan.json",
};
const JOB = { classes: [9, 42] };
const msg = (plan, axis = "incumbent-class") =>
  STAGES["register-unit"].message({ paths: P, axis, job: JOB, registerPlan: plan });

const LANE = { contract: { supplemental_lane: 1 }, entries: [] };
const LANE_WITH_ENTRIES = {
  contract: { supplemental_lane: 1 },
  entries: [{ qid: "ic:exact:a", axis: "incumbent-class", predicate: "exact", term: "ION", nice_classes: ["9"], expected_kind: "enumerate" }],
};
const LEGACY = { entries: [] };

test("supplemental lane: the message never orders the tool pipeline.mjs removed — with OR without dictated entries", () => {
  for (const [label, plan] of [["no entries (the ION shape)", LANE], ["with entries", LANE_WITH_ENTRIES]]) {
    const m = msg(plan);
    // never ORDERS an enumerate call…
    assert.doesNotMatch(m, /call register_enumerate|run register_enumerate|run extra register_enumerate/i, label);
    assert.doesNotMatch(m, /Pin EVERY register_enumerate/i, label);
    assert.doesNotMatch(m, /one block per register_enumerate/i, label);
    // …and always names the replacement
    assert.match(m, /register_propose_supplemental/, label);
    // …and says the absence is deliberate, so it is never reported as an outage
    assert.match(m, /BY DESIGN, never an outage or a permission fault/, label);
    // …and never asks the model to author the band (band_block_unplanned would kill the stage)
    assert.doesNotMatch(m, /ALSO write the COMPLETE NAMED BAND/, label);
    assert.match(m, /written BY THE TOOLS/, label);
  }
});

test("supplemental lane: an axis with NO dictated entries is still told to cover the axis", () => {
  const m = msg(LANE);
  // the ION regression: the old else-branch said only "Run THIS axis's searches per the manifest"
  assert.doesNotMatch(m, /Run THIS axis's searches per the manifest\./);
  assert.match(m, /NO dictated plan entries/);
  assert.match(m, /whole axis is yours to cover by proposal/);
  assert.match(m, /never a reason to leave it thin/);
  // class scoping still lands, phrased for the lane
  assert.match(m, /Pin EVERY proposal to these/);
  assert.match(m, /nice_classes:\[9, 42\]/);
});

test("legacy lane (no contract flag) keeps the register_enumerate instructions verbatim", () => {
  const m = msg(LEGACY);
  assert.match(m, /run register_enumerate calls/);
  assert.match(m, /Pin EVERY register_enumerate to these/);
  assert.match(m, /ALSO write the COMPLETE NAMED BAND/);
  assert.doesNotMatch(m, /register_propose_supplemental/);
  // and it too must cover an entry-less axis rather than shrug
  assert.match(m, /NO dictated plan entries/);
  assert.match(m, /whole axis is yours to cover by enumeration/);
});

// The owner half of the same incident. Banning the enumerate lane closed ION's old path but left the
// axis with no stated way to cover a WATCHLIST OWNER, so it fell back to count-only register_search and
// wrote 10-of-432 samples up as review. F1 (PR-1) closed the grammar gap itself: a mark-text proposal
// now CARRIES the owner as a scope field, so the lane message states the owner×term slice as the
// coverage instrument and demotes the bare predicate:"owner" sweep to crowd context that points at it.
test("supplemental lane: the unit is told HOW to cover a watchlist owner, with or without dictated entries", () => {
  for (const [label, plan] of [["no entries (the ION shape)", LANE], ["with entries", LANE_WITH_ENTRIES]]) {
    const m = msg(plan);
    assert.ok(m.includes(OWNER_SWEEP_STEERING), label);
    assert.match(m, /OWNER \/ WATCHLIST COVERAGE/, label);
    // the grammar the mint actually accepts (F1): owner rides the mark-text proposal as a scope field
    assert.match(m, /owner as a scope field/, label);
    assert.match(m, /owner:"<the owner>"/, label);
    assert.match(m, /owner×term slice is THE coverage instrument/, label);
    // the RETIRED doctrine (owner and name may never compose) must not survive anywhere in the message
    assert.doesNotMatch(m, /never both|REPLACES the name clause/, label);
    // …and the fallback that actually shipped is still named and forbidden — for slice AND sweep alike
    assert.match(m, /NEVER stand sampled register_search pages in for either/, label);
    // the ban is still not re-armed by the new text
    assert.doesNotMatch(m, /call register_enumerate|run register_enumerate/i, label);
  }
});

test("legacy lane gets NO owner-proposal steering (off-lane the unit still has register_enumerate)", () => {
  const m = msg(LEGACY);
  assert.ok(!m.includes(OWNER_SWEEP_STEERING));
  assert.doesNotMatch(m, /OWNER \/ WATCHLIST COVERAGE/);
});

test("the lane read matches pipeline.mjs's exclusion key exactly (contract.supplemental_lane, truthy)", () => {
  // If these ever diverge the ban and the instruction drift apart again — which IS the bug.
  assert.match(msg({ contract: { supplemental_lane: 1 }, entries: [] }), /register_propose_supplemental/);
  assert.doesNotMatch(msg({ contract: {}, entries: [] }), /register_propose_supplemental/);
  assert.doesNotMatch(msg({ entries: [] }), /register_propose_supplemental/);
  assert.doesNotMatch(msg(null), /register_propose_supplemental/);
});
