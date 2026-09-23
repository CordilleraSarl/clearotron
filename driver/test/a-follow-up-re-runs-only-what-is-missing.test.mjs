// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-follow-up-re-runs-only-what-is-missing.test.mjs — a follow-up asks the register again only for what is
// still missing.
//
// THE DEFECT. register_execute_plan took no qids, so the plan-join follow-up, sent for one or two entries
// with no band block, re-ran every entry on the axis; so did a follow-up that closed deferred rows or
// answered a skeptic. On a register that bills per call, or that hydrates every record it lists, each of
// those re-runs paid again for every answer the run already held. In production, 7–22 September, the
// plan-join follow-up alone re-sent 1,211 searches that had already been answered.
//
// THE CHANGE: every register tool server declares `qids`; the plan-join follow-ups name exactly the missing
// entries; a follow-up to an axis that has already run says not to call the tool without qids. The
// dispatched prompts are pinned on the real pipeline in pipeline.mock.test.mjs and
// a-capability-gap-is-not-reopened.pipeline.test.mjs; this file pins the composers and the servers.
//
// Run:  node scripts/test-run.mjs node --test driver/test/a-follow-up-re-runs-only-what-is-missing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { repairFollowup } from "../repair-composers.mjs";
import { PLAN_ENTRY_RERUN_RULE, buildEscalationFollowup, buildEnvelopeCloseFollowup } from "../stages.mjs";

const MCP = join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "mcp");
const REGISTER_SERVERS = ["signa", "clarivate", "corsearch", "euipo", "uspto-local", "free-tier"];
const P = { registerPlan: "/run/_driver/register-plan.json", registerBand: (a) => `/run/register-units/${a}-band.json`,
  registerUnit: (a) => `/run/register-units/${a}.md` };

test("every register tool server's register_execute_plan declares qids, and says what leaving it out does", () => {
  for (const srv of REGISTER_SERVERS) {
    const src = readFileSync(join(MCP, `${srv}-server.mjs`), "utf8");
    const at = src.indexOf('name: "register_execute_plan"');
    assert.ok(at >= 0, `${srv}: the tool is where this test looks for it`);
    const block = src.slice(at, src.indexOf("handler:", at));
    assert.match(block, /qids: \{ type: "array", items: \{ type: "string" \}, description: "[^"]*without it every entry on the axis runs again/,
      `${srv}: qids is declared, with the cost of leaving it out`);
  }
});

test("the warm plan-join follow-up hands the tool exactly the missing qids", () => {
  const entries = [{ qid: "eu:exact:timber", predicate: "exact", term: "TIMBER", nice_classes: ["9"], expected_kind: "enumerate" },
    { qid: "eu:exact:timber+merch", predicate: "exact", term: "TIMBER", nice_classes: ["25"], expected_kind: "enumerate" }];
  const text = repairFollowup("register-unit:plan-join", { axis: "eu", registerPlan: P.registerPlan, bandPath: P.registerBand("eu"), entries });
  const call = JSON.parse(text.match(/register_execute_plan ONCE with (\{[^\n]*?\]\})/)[1]);
  assert.deepEqual(call.qids, ["eu:exact:timber", "eu:exact:timber+merch"]);
  assert.match(text, /do not call it without qids: that re-runs every entry on the axis/);
});

test("the fresh plan-join call names the missing qids too, and without entries asks for the axis as before", () => {
  const withEntries = repairFollowup("register-unit:plan-join-fresh", { axis: "eu", registerPlan: P.registerPlan, bandPath: P.registerBand("eu"), entries: [{ qid: "eu:exact:timber" }] });
  assert.deepEqual(JSON.parse(withEntries.match(/register_execute_plan ONCE with (\{[^\n]*?\]\})/)[1]).qids, ["eu:exact:timber"]);
  assert.match(withEntries, /runs ONLY those dictated entries/);
  const without = repairFollowup("register-unit:plan-join-fresh", { axis: "eu", registerPlan: P.registerPlan, bandPath: P.registerBand("eu") });
  assert.doesNotMatch(without, /"qids"/);
});

test("both follow-ups to an axis that has already run carry the rule, in both lanes", () => {
  for (const lane of [true, false]) {
    assert.ok(buildEscalationFollowup({ paths: P, axis: "eu", flags: "- concern", supplementalLane: lane }).includes(PLAN_ENTRY_RERUN_RULE));
    assert.ok(buildEnvelopeCloseFollowup({ paths: P, axis: "eu", rows: "| u | deferred | r |", supplementalLane: lane }).includes(PLAN_ENTRY_RERUN_RULE));
  }
});
