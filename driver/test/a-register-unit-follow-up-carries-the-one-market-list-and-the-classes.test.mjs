// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REGISTER-UNIT FOLLOW-UP CARRIES THE ONE MARKET LIST AND THE CLASS LINE.
//
// The unit manual's narrowing step reads "from the one list your opening message names". A follow-up is a fresh session
// that never saw the opening message: the skeptic's escalation, the deadline envelope's close, both arms of the
// frame-reopen follow-up and of its cold retry, and the decision on the web search's cross-checks. On a test run of a
// crowded matter the escalation and envelope-close dispatches carried no market list, so the step pointed at nothing
// and the markets were the model's to pick. Each follow-up now carries the line the opening message gives, and the
// class line. Every market, class and mark here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { repairFollowup } from "../repair-composers.mjs";
import { inScopeClassLine, followupScopeLines } from "../stages.mjs";
import { narrowingOrderLine } from "../effective-scope.mjs";

const JOB = { jobKey: "t", classes: ["9", "42"], geography: { mode: "worldwide" } };
const PROFILE = { defaultJurisdictions: ["CA", "MX", "BR"] };
const AXIS = "primary-sweep";
const P = { registerBand: (a) => `register-units/${a}-band.json`, registerUnit: (a) => `register-units/${a}.md`, registerPlan: "_driver/register-plan.json" };
const DIRECTIVES = [{ item: "QZORVA", observation: "unsearched", severity: "dominant-element" }, { item: "QZORVEN", observation: "unsearched" }];

const followUps = (lane, scope = { job: JOB, profile: PROFILE }) => ({
  escalation: repairFollowup("register-unit:escalation", { paths: P, axis: AXIS, flags: "- the crowd on QZORVA was not narrowed", supplementalLane: lane, ...scope }),
  "envelope-close": repairFollowup("register-unit:envelope-close", { paths: P, axis: AXIS, rows: "- QZORVA, class 9: deferred", supplementalLane: lane, ...scope }),
  "frame-reopen": repairFollowup("register-unit:frame-reopen-directive", { paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 4, supplementalLane: lane, ...scope }),
  "frame-reopen retry": repairFollowup("register-unit:frame-reopen-retry", { paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 4, supplementalLane: lane, ...scope }),
  "cross-check decision": repairFollowup("register-unit:xcheck-decide", { axis: AXIS, registerPlan: P.registerPlan, bandPath: P.registerBand(AXIS),
    entries: [{ qid: "xcheck-owner-qzorva", predicate: "owner", term: "Example Holdings", nice_classes: [9] }], supplementalLane: lane, ...scope }),
});

test("every register-unit follow-up names the customer's priority markets as its one list, and the order's classes", () => {
  const market = narrowingOrderLine(JOB, PROFILE, "9, 42");
  assert.match(market, /one question per market: the customer's priority markets \(CA, MX, BR\)/, "guard: the order is worldwide, so the list is the customer's priorities");
  for (const lane of [true, false]) {
    for (const [name, text] of Object.entries(followUps(lane))) {
      assert.ok(text.includes(market), `the ${name} follow-up (lane ${lane}) carries no market list`);
      assert.ok(text.includes(inScopeClassLine("9, 42", lane)), `the ${name} follow-up (lane ${lane}) carries no class line`);
      assert.doesNotMatch(text, /else the major markets/, `the ${name} follow-up hands the model the major markets as its list`);
    }
  }
});

test("a follow-up composed with no order to read adds nothing", () => {
  assert.deepEqual(followupScopeLines({ job: null, profile: PROFILE }), []);
  for (const [name, text] of Object.entries(followUps(true, {}))) assert.doesNotMatch(text, /NARROWING A CROWD/, `the ${name} follow-up invented a market list`);
});

test("the pipeline hands every register-unit follow-up the order and the profile it is read from", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs"), "utf8");
  for (const key of ["xcheck-decide", "frame-reopen-directive", "frame-reopen-retry", "escalation", "envelope-close"]) {
    const at = src.indexOf(`repairFollowup("register-unit:${key}"`);
    assert.ok(at >= 0, `no call composes the ${key} follow-up`);
    const call = src.slice(at, src.indexOf(";", at));
    assert.match(call, /job: ctx\.job, profile: ctx\.profile/, `the ${key} follow-up is composed without the order and the profile`);
  }
});
