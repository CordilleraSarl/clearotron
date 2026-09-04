// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// channel-plan-reaches-the-trace.test.mjs — 's call site: the plan now reaches the comparison.
//
// The pure comparison landed first and reported `state: "unknown"` on every run, because the ordered list
// was not in the artifact it reads: `common-law-grid.json`'s top-level keys are `cells`, `extras`, `gaps`
// — the executed set only. That unknown was honest and useless.
//
// WHY grid-spec.json AND NOT ctx.profile.platforms, asserted here because it is the whole correctness of
// the wiring: the deterministic grid runs `grid-spec.platforms` and the receipts gate joins the same file,
// so it is what the executor was ORDERED from. It also already carries `[...channels, "web"]`, and — the
// case that would silently break a profile-based read — on a GENERIC profile the channels come from the
// matter frame's "Search channels:" line, not from the profile at all. Comparing the grid against
// `profile.platforms` there would measure it against a plan it was never given.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planVsExecutedChannels, traceCommonLawCarry, reconciliationRates } from "../commonlaw-carry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (f) => readFileSync(join(ROOT, f), "utf8");

// The grid-spec shape the writer produces: the dictated channels plus the general-web cell.
const SPEC_PLATFORMS = ["taobao.com", "jd.com", "1688.com", "web"];
const gridWith = (platforms) => JSON.stringify({
  cells: platforms.map((p) => ({ term: "delphi", platform: p, status: "ok", candidates: [] })), gaps: [],
});

test("#1066 a run that swept every ordered channel reads complete", () => {
  const a = traceCommonLawCarry({ gridRaw: gridWith(SPEC_PLATFORMS), findingsText: "", planned: SPEC_PLATFORMS });
  assert.equal(a.totals.channels.state, "complete");
  assert.equal(reconciliationRates(a).channels.rate, 1);
});

test("#1066 THE CASE THAT WAS INVISIBLE: mandatory channels never searched, named and rated", () => {
  const a = traceCommonLawCarry({ gridRaw: gridWith(["web"]), findingsText: "", planned: SPEC_PLATFORMS });
  assert.equal(a.totals.channels.state, "incomplete");
  assert.deepEqual(a.totals.channels.never_searched, ["1688.com", "jd.com", "taobao.com"]);
  const r = reconciliationRates(a);
  assert.equal(r.channels.rate, 1 / 4);
  // The two self-referential rates still read clean on this run — which is the entire point. They divide
  // the run by itself, so they cannot see a channel that never produced a cell, and before this the run
  // had no third number to contradict them.
  assert.equal(r.candidates.rate, null, "nothing retrieved, so that rate is undefined — not 0, and not a defect");
});

test("#1066 no grid spec ⇒ UNKNOWN, never a clean 1", () => {
  const a = traceCommonLawCarry({ gridRaw: gridWith(["web"]), findingsText: "" });
  assert.equal(a.totals.channels.state, "unknown");
  assert.equal(reconciliationRates(a).channels.rate, null,
    "a register-only run and a run whose grid spec never landed both genuinely cannot say what was ordered");
});

test("#1066 the plan is read from the GRID SPEC, and the reason is pinned with the read", () => {
  // Behaviour cannot reach this: both sources would produce a plausible list on a NAMED profile, and the
  // two only diverge on a generic profile whose channels came from the matter frame. So the source choice
  // is pinned where it is made, and the reason is pinned with it — a later edit that "simplifies" this to
  // ctx.profile.platforms would pass every other test in this file.
  //
  // part 2 MOVED THE READ into `plannedChannelsFor`, because a second seam now needs it: the
  // stage-exit check reports the same comparison two hours earlier. This assertion follows the extraction
  // rather than the old inline position — the property it defends is the SOURCE, not the line it sat on.
  // Pinning the position instead would have made a correct refactor look like a regression, and the
  // temptation then is to re-inline the read, which is how the two seams end up with two answers.
  const pipeline = src("driver/pipeline.mjs");
  const at = pipeline.indexOf("function plannedChannelsFor(P) {");
  assert.ok(at > 0, "plannedChannelsFor is gone — find where the ordered channel list is read before trusting this");
  const reader = pipeline.slice(at, at + 500);
  assert.match(reader, /P\.gridSpec/, "the plan is no longer read from the grid spec");
  assert.ok(!/ctx\.profile/.test(reader),
    "the plan is read from the profile — on a generic profile the channels come from the matter frame, so "
    + "that compares the grid against a plan it was never given");

  // And it still reaches the trace. One derivation, and every caller takes it.
  const callAt = pipeline.indexOf("const artifact = traceCommonLawCarry({");
  assert.ok(callAt > 0, "the common-law carry call moved — this assertion is measuring nothing");
  assert.match(pipeline.slice(Math.max(0, callAt - 1800), callAt + 400), /planned: plannedChannels/,
    "the trace no longer receives the ordered channel list");
  assert.ok(!/planned:\s*ctx\.profile/.test(pipeline), "nothing anywhere passes the profile as the plan");
});
test("#1066 an unreadable grid spec degrades to unknown and never throws", () => {
  // Fail-open on a disclosure path: this annotates, it never gates, so a malformed spec must not cost a
  // delivered run. The pure function carries the same property.
  // Expectations are ENUMERATED, not computed. My first version derived the expected state with
  // `platforms?.length ? "complete" : "unknown"`, which reads a STRING's length as a plan of 10 channels —
  // a test asserting the wrong thing confidently, which is the shape this whole issue is about.
  const cases = [
    [undefined, "unknown"], [null, "unknown"], ["taobao.com", "unknown"],   // not an array ⇒ no plan
    // An EXPLICIT empty list is a statement ("nothing was ordered") and `null` is an absence ("no plan
    // reached us"); they are different facts and stay different. An empty plan missed nothing, so
    // "complete" — and its RATE is null, so it can never score a false 1 off having ordered nothing.
    [[], "complete"], [["", "  "], "complete"],
    [["web"], "complete"], [["taobao.com"], "incomplete"],
  ];
  for (const [planned, expected] of cases)
    assert.equal(planVsExecutedChannels({ planned, cells: [{ platform: "web" }] }).state, expected,
      `planned=${JSON.stringify(planned)} did not degrade cleanly`);
});
