// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FRAME-REOPEN FOLLOW-UP READS WHAT COULD CHANGE THE ADVICE, WITH NO FIXED CAP AND NO PRICE.
//
// The register instructions carry no fixed call budget, tell the model nothing about a limit, and name no price. The
// frame-reopen follow-up and its cold retry, on the arms whose units fetch records, still gave the model a fixed
// detail-fetch cap and told it that screening "is cheap". They now ask it to read the detail of the records that could
// change what it tells the client and to record the rest as an incomplete block; and the follow-up says the unit
// decides on each incomplete block by the manual's narrowing steps, and the write-up rules each slice's coverage.
// Every mark here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFrameReopenFollowup, buildFrameReopenRetryMessage } from "../stages.mjs";

const P = { registerBand: (a) => `register-units/${a}-band.json`, registerUnit: (a) => `register-units/${a}.md` };
const DIRECTIVES = [{ item: "QZORVA", observation: "unsearched", severity: "dominant-element" }, { item: "QZORVEN", observation: "unsearched" }];
const ARMS = [["the follow-up", buildFrameReopenFollowup], ["the cold retry", buildFrameReopenRetryMessage]];
const compose = (build, lane) => build({ paths: P, axis: "primary-sweep", directives: DIRECTIVES, supplementalLane: lane });

test("no frame-reopen message gives the model a fixed fetch cap or a price", () => {
  for (const [name, build] of ARMS) for (const lane of [true, false]) {
    const text = compose(build, lane);
    assert.doesNotMatch(text, /at most 4 records|detail-fetch ceiling|BOUND the/, `${name} (lane ${lane}) still caps the detail it reads`);
    assert.doesNotMatch(text, /\bcheap\b|\bexpensive\b|time budget/i, `${name} (lane ${lane}) still tells the model what a pass costs`);
  }
});

test("a unit that fetches records reads the detail that could change the advice, and decides each incomplete block by the manual's steps", () => {
  for (const [name, build] of ARMS)
    assert.match(compose(build, false), /read the detail of the records that could change what you tell the client/i, `${name} does not say what detail to read`);
  assert.match(compose(buildFrameReopenFollowup, false),
    /the band IS the coverage signal; you decide on each "incomplete" block by the narrowing steps in unit\.md, and the write-up rules each slice's coverage\./);
});

test("every frame-reopen message says who decides an incomplete block, and none leaves it to a later judgment", () => {
  for (const [name, build] of ARMS) for (const lane of [true, false]) {
    const text = compose(build, lane);
    assert.match(text, /the band (IS|is) the coverage signal; you decide on each "incomplete" block by the narrowing steps in unit\.md, and the write-up rules each slice's coverage\./,
      `${name} (lane ${lane}) does not say the unit decides each incomplete block`);
    assert.doesNotMatch(text, /judgment (\(Layer B\) )?reads it/, `${name} (lane ${lane}) still leaves the band to a later judgment`);
  }
});
