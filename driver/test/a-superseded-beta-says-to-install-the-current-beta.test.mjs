// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the deprecate script's sentence choice, on invented version lists
//
// A SUPERSEDED BETA SAYS TO INSTALL THE CURRENT BETA.
//
// The range deprecation wrote one sentence on every version it took: "upgrade to the latest version of clearotron".
// The latest version is what `npm install clearotron` gives, the stable, so on 2026-10-28 three superseded betas of a
// newer line told their readers to move down to an older one. A range of betas only now carries the beta sentence,
// approved word for word; any range holding a stable keeps the sentence it always had. Neither is typed at dispatch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rangeMessageFor, BETA_MESSAGE, RANGE_MESSAGE } from "../../scripts/deprecate-below.mjs";

test("the beta sentence is the approved one, word for word", () => {
  assert.equal(BETA_MESSAGE, "This beta is superseded. Install the current beta: npm install clearotron@beta.");
});

test("a range of betas only carries the beta sentence", () => {
  assert.equal(rangeMessageFor(["0.5.0-beta.1", "0.5.0-beta.2", "0.5.0-beta.3"]), BETA_MESSAGE);
});

test("THE CONTROL: a range that holds a stable keeps the sentence it always had", () => {
  assert.equal(rangeMessageFor(["0.4.1-beta.6", "0.4.1"]), RANGE_MESSAGE);
  assert.equal(rangeMessageFor(["0.2.0", "0.2.4"]), RANGE_MESSAGE);
  assert.equal(rangeMessageFor([]), RANGE_MESSAGE);
});
