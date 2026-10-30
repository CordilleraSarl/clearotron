// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-job-rebuilt-from-its-run-keeps-the-orders-territories.test.mjs — a job read back out of a run's status
// takes the order's territories from the run's instructed scope.
//
// THE DEFECT. `--resume` and `--experiment` rebuild the job from status.json, which carries the run's
// identity and no territories. The stage messages read the territories off the job, so the rebuilt job fell
// back to the account's defaults: a register unit re-run on a saved run was told to narrow by markets the
// order never named, and that the request named none. Measured 2026-10-29 on a saved run: four markets in
// place of the order's three.
//
// The scope a run writes at intake is `instructedScopeOf(job)`, so each arm builds it the same way.
//
// Run:  node --test driver/test/a-job-rebuilt-from-its-run-keeps-the-orders-territories.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { jobFromStatus, instructedScopeOf } from "../pipeline.mjs";
import { narrowingOrderLine, defaultJurisdictionsLine, resolveTerritories } from "../effective-scope.mjs";

/** An account whose own default territories are not the order's. */
const PROFILE = { defaultJurisdictions: ["US", "EU", "GB", "JP"] };

/** What seedRunStatus keeps of a job: its identity, and no territories. */
const statusOf = (job) => ({ id: job.id, ref: job.ref, markName: job.markName, classes: job.classes, forwarder: job.forwarder });

const ORDER = {
  id: "job-1240", ref: "INV-1240", markName: "INVENTED MARK", classes: [9, 42], forwarder: "invented-forwarder",
  jurisdictions: ["US", "EU", "CH"], geography: { mode: "named", origin: "request" },
};

test("the rebuilt job carries the order's territories, copied from the instructed scope as they were written", () => {
  const rebuilt = jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER));
  assert.deepEqual(rebuilt.jurisdictions, ["US", "EU", "CH"]);
  assert.deepEqual(rebuilt.geography, { mode: "named", origin: "request" });
  assert.deepEqual(resolveTerritories(rebuilt, PROFILE).jurisdictions, ["US", "EU", "CH"]);
});

test("a stage message built from the rebuilt job names the order's markets, as the run's own did", () => {
  const rebuilt = jobFromStatus(statusOf(ORDER), instructedScopeOf(ORDER));
  assert.equal(narrowingOrderLine(rebuilt, PROFILE), narrowingOrderLine(ORDER, PROFILE));
  assert.match(narrowingOrderLine(rebuilt, PROFILE), /one question per market of the order's scope \(US, EU, CH\)/);
  assert.deepEqual(defaultJurisdictionsLine(rebuilt, PROFILE), defaultJurisdictionsLine(ORDER, PROFILE));
  assert.deepEqual(defaultJurisdictionsLine(rebuilt, PROFILE), [], "an order that names its countries is never told the request named none");
});

test("a worldwide order stays worldwide, and the account's markets stay its priorities", () => {
  const worldwide = { ...ORDER, jurisdictions: [], geography: { mode: "worldwide", origin: "request" } };
  const rebuilt = jobFromStatus(statusOf(worldwide), instructedScopeOf(worldwide));
  assert.equal(resolveTerritories(rebuilt, PROFILE).geographyMode, "worldwide");
  assert.equal(narrowingOrderLine(rebuilt, PROFILE), narrowingOrderLine(worldwide, PROFILE));
  assert.deepEqual(defaultJurisdictionsLine(rebuilt, PROFILE), defaultJurisdictionsLine(worldwide, PROFILE));
});

test("an order that named no countries is rebuilt the same way, and the account's defaults apply as they did", () => {
  const unnamed = { ...ORDER, jurisdictions: null, geography: { mode: "account-default", origin: "request" } };
  const rebuilt = jobFromStatus(statusOf(unnamed), instructedScopeOf(unnamed));
  assert.equal(rebuilt.jurisdictions, undefined, "a scope that names no territories adds none");
  assert.equal(narrowingOrderLine(rebuilt, PROFILE), narrowingOrderLine(unnamed, PROFILE));
  assert.deepEqual(defaultJurisdictionsLine(rebuilt, PROFILE), defaultJurisdictionsLine(unnamed, PROFILE));
});

test("with no instructed scope the rebuild is what it was: identity only", () => {
  const rebuilt = jobFromStatus(statusOf(ORDER), null);
  assert.deepEqual(Object.keys(rebuilt).sort(), ["classes", "forwarder", "id", "markName", "ref"]);
});
