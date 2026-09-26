// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WORLDWIDE ORDER IS NEVER FRAMED AS THE ACCOUNT'S DEFAULT TERRITORIES.
//
// The order door takes a worldwide word off the territory list and stamps the geography instead. The
// territory ladder honours the stamp ahead of the account's defaults, but the matter frame's default
// line only asked whether the list was empty. It was, so a worldwide order was told "the request names
// none — apply these", and the frame scoped the search to the account's defaults.
//
// Driven through the real door and the real matter-frame message, because the defect lives in the bytes
// the model is handed, not in the resolved scope.
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateJob } from "../enqueue-schema.mjs";
import { STAGES } from "../stages.mjs";
import { resolveTerritories } from "../effective-scope.mjs";

const DEFAULTS = ["NZ", "PH", "IN"];
const DEFAULT_LINE = /Customer-default jurisdictions/;

const order = (extra) => ({
  ref: "WW-1", markName: "LANTERNWICK", classes: [9, 41], goods: "computer game software",
  product: "global-preliminary-search", ...extra,
});
const frameFor = (job) => STAGES["matter-frame"].message({
  paths: { inboundRequest: "/dev/null" }, job, customerUnknown: true,
  profile: { defaultJurisdictions: DEFAULTS }, exclusionSeed: [],
});

// Each default may appear on the priority line and on no other line of the frame's message.
const linesCarrying = (msg, t) => msg.split("\n").filter((l) => new RegExp(`\\b${t}\\b`).test(l));
const PRIORITY_LINE = /^Customer priority markets \(the account's default territories — where a crowded result is narrowed first; never the scope of this order\): NZ, PH, IN\.$/;

test("a worldwide order, as the door records it, is framed as worldwide, with the defaults only as its priority markets", () => {
  const job = order({ jurisdictions: ["Global"] });
  validateJob(job);
  assert.equal(job.geography?.mode, "worldwide", "the door no longer stamps the worldwide word");
  assert.deepEqual(resolveTerritories(job, { defaultJurisdictions: DEFAULTS }).jurisdictions, [],
    "the ladder narrowed a worldwide order");
  const msg = frameFor(job);
  assert.doesNotMatch(msg, DEFAULT_LINE, "a worldwide order was told to apply the account's defaults");
  assert.match(msg, /^Order scope: worldwide \(AUTHORITATIVE — every register question is asked worldwide;/m);
  for (const t of DEFAULTS) {
    const carrying = linesCarrying(msg, t);
    assert.equal(carrying.length, 1, `${t} reached the frame on ${carrying.length} lines`);
    assert.match(carrying[0], PRIORITY_LINE, `${t} reached the frame outside the priority line`);
  }
});

test("a worldwide stamp sent by the requester is honoured the same way", () => {
  const job = order({ geography: { mode: "worldwide", origin: "request" } });
  validateJob(job);
  const msg = frameFor(job);
  assert.doesNotMatch(msg, DEFAULT_LINE);
  assert.match(msg, /^Order scope: worldwide/m);
  assert.match(msg, /^Customer priority markets/m);
});

test("a worldwide order under an account with no defaults gets the scope line alone", () => {
  const job = order({ jurisdictions: ["Global"] });
  validateJob(job);
  const msg = STAGES["matter-frame"].message({ paths: { inboundRequest: "/dev/null" }, job, customerUnknown: true,
    profile: { defaultJurisdictions: [] }, exclusionSeed: [] });
  assert.match(msg, /^Order scope: worldwide/m);
  assert.doesNotMatch(msg, /Customer priority markets/);
});

test("THE CONTROL: an order that says nothing about territory still gets the account's defaults", () => {
  // A Global preliminary search is worldwide whatever it says, so the control is a product that takes
  // territories and was sent none.
  const job = order({ product: "multi-country-focus-search" });
  validateJob(job);
  assert.equal(job.geography?.mode, "account-default");
  const msg = frameFor(job);
  assert.match(msg, DEFAULT_LINE, "defaults fill an absent scope, and that must survive");
  assert.match(msg, /NZ, PH, IN/);
});
