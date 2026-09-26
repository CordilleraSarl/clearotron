// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CROWD IS NARROWED BY GOODS AND CLASS FIRST, THEN BY MARKET, AND THE READING STEP IS TOLD WHICH MARKETS.
//
// Ruled 2026-09-26: the order's scope sets what is searched; a crowd is narrowed by judgment, goods and
// class first, then the markets, taking the order's own countries, else (on a worldwide order) the
// customer's priority markets, else the markets the customer's field and brand point to, else the major
// markets. The register reading step's message had no territory line at all, so it could not narrow by
// market in that order. Driven through the real order door and the real message builder.
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateJob } from "../enqueue-schema.mjs";
import { STAGES } from "../stages.mjs";
import { MAJOR_MARKETS } from "../effective-scope.mjs";

const DEFAULTS = ["NZ", "PH", "KE"];
const PATHS = { variantManifest: "vm.json", matterContext: "mc.md", registerBand: (a) => `band-${a}.json`,
  registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" };
const PLAN = { plan_version: 1, regions: [], entries: [{ qid: "primary-sweep:exact:lanternwick", axis: "primary-sweep",
  predicate: "exact", term: "LANTERNWICK", nice_classes: ["9"], expected_kind: "enumerate" }] };
const order = (extra) => ({ ref: "N-1", markName: "LANTERNWICK", classes: [9, 41], goods: "computer game software",
  product: "global-preliminary-search", ...extra });
const unitMessage = (job, defaults = DEFAULTS) => STAGES["register-unit"].message({ paths: PATHS, axis: "primary-sweep",
  job, profile: { defaultJurisdictions: defaults }, registerPlan: PLAN });
const narrowingLine = (msg) => msg.split("\n").find((l) => l.startsWith("NARROWING A CROWD")) ?? "";

test("a worldwide order narrows by goods and class, then the priority markets, the field's markets and the major markets, in that order", () => {
  const job = order({ jurisdictions: ["Global"] });
  validateJob(job);
  const line = narrowingLine(unitMessage(job));
  assert.ok(line, "the reading step is not told how to narrow a crowd");
  const at = (s) => line.indexOf(s);
  assert.ok(at("the order's classes [9, 41]") > 0, "the classes are not named");
  assert.ok(at("the order's classes") < at("then the classes the crowding owners file in"), "class before the owners' classes");
  assert.ok(at("the crowding owners") < at(`the customer's priority markets (${DEFAULTS.join(", ")})`), "goods and class before any market");
  assert.ok(at("the customer's priority markets") < at("the markets the customer's field and brand point to"));
  assert.ok(at("field and brand") < at(`the major markets (${MAJOR_MARKETS.join(", ")})`));
  assert.match(line, /set aside, never clean\.$/);
});

test("an order that names its countries narrows only within them, and no default reaches the reading step", () => {
  const job = order({ product: "multi-country-focus-search", jurisdictions: ["JP", "KR"] });
  validateJob(job);
  const msg = unitMessage(job);
  assert.match(narrowingLine(msg), /one question per market of the order's scope \(JP, KR\); nothing outside it was ordered/);
  for (const t of DEFAULTS) assert.ok(!new RegExp(`\\b${t}\\b`).test(msg), `${t} reached a named order's reading step`);
  assert.doesNotMatch(narrowingLine(msg), /major markets/);
});

test("an order that names nothing takes the account's defaults as its scope, and narrows within them", () => {
  const job = order({ product: "multi-country-focus-search" });
  validateJob(job);
  assert.equal(job.geography?.mode, "account-default");
  assert.match(narrowingLine(unitMessage(job)), /of the order's scope \(NZ, PH, KE\)/);
});

test("a customer with nothing set up narrows by the order's classes and then the field's or the major markets", () => {
  const job = order({ jurisdictions: ["Global"] });
  validateJob(job);
  const line = narrowingLine(unitMessage(job, []));
  assert.doesNotMatch(line, /priority markets/);
  assert.match(line, /the markets the customer's field and brand point to \(judge them from the matter frame\), else the major markets \(US, EU, GB, CN, JP\)/);
});
