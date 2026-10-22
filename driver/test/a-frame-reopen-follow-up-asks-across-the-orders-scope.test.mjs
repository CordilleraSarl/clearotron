// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FRAME-REOPEN FOLLOW-UP ASKS ACROSS THE ORDER'S SCOPE, NOT ONCE PER MAJOR MARKET.
//
// The ruled method asks a worldwide order worldwide and narrows a crowd on the one market list the opening message
// names. The frame-reopen follow-up and its cold retry still asked once per material and major market. They now ask
// across the order's scope, and the follow-up says a slice that comes back a crowd is narrowed by the manual's steps. A
// unit on the supplemental lane holds no record-fetch tool, so its arms no longer carry a cap on reading record detail;
// the other arms, whose units fetch records, keep theirs. Every mark here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFrameReopenFollowup, buildFrameReopenRetryMessage } from "../stages.mjs";

const P = { registerBand: (a) => `register-units/${a}-band.json`, registerUnit: (a) => `register-units/${a}.md` };
const DIRECTIVES = [{ item: "QZORVA", observation: "unsearched", severity: "dominant-element" }, { item: "QZORVEN", observation: "unsearched" }];
const compose = (build, lane) => build({ paths: P, axis: "primary-sweep", directives: DIRECTIVES, reopenFetchCap: 4, supplementalLane: lane });
const ARMS = [["the follow-up", buildFrameReopenFollowup], ["the cold retry", buildFrameReopenRetryMessage]];

test("both frame-reopen messages ask across the order's scope, on both lanes, and never per material or major market", () => {
  for (const [name, build] of ARMS) for (const lane of [true, false]) {
    const text = compose(build, lane);
    assert.match(text, /across the order's scope/, `${name} (lane ${lane}) does not ask across the order's scope`);
    assert.doesNotMatch(text, /material\+major/i, `${name} (lane ${lane}) still asks per material and major market`);
  }
  assert.match(compose(buildFrameReopenFollowup, true), /a slice that comes back a crowd is narrowed by the steps in unit\.md/);
});

test("a supplemental-lane unit is not capped on reading record detail it cannot fetch", () => {
  for (const [name, build] of ARMS) assert.doesNotMatch(compose(build, true), /at most 4 records/, `${name} on the lane still caps reading record detail`);
});

test("a supplemental-lane unit's frame-reopen messages carry no price words", () => {
  for (const [name, build] of ARMS) assert.doesNotMatch(compose(build, true), /\bcheap\b/i, `${name} on the lane still tells the model what a pass costs`);
});
