// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CROWD NARROWED IN ITS FIELD'S MARKETS IS NOT OWED THE MAJOR MARKETS.
//
// The one market list a crowd of the identical mark is read in is the order's countries, else the customer's priority
// markets, else the markets the customer's field and brand point to, with the major markets as their fallback (W8). The
// code that judges whether the identical mark's crowd was read skipped the third rung: with no countries and no
// priority markets it went straight to the five majors, so a crowd the market step had narrowed in the field's own
// markets was recorded as not covered in markets the method never sent it to. It now takes the markets the identical
// mark's market step used, and the majors only where no market step ran. Every mark and market here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../stages.mjs";
import { mainMarketsOf } from "../pipeline.mjs";
import { crowdNarrowing, marketStepMarkets } from "../register-plan.mjs";
import { MAJOR_MARKETS } from "../effective-scope.mjs";

const IDENTICAL = { qid: "primary-sweep:exact:qzorva", axis: "primary-sweep", predicate: "exact", term: "QZORVA", provenance: "mark", nice_classes: ["9"] };
const step = (qid, over) => ({ qid, axis: "primary-sweep", predicate: "exact", term: "QZORVA", nice_classes: ["9"], narrows: IDENTICAL.qid, origin: "supplemental", ...over });
const PLAN = { regions: [], entries: [IDENTICAL, step("supp:qzorva:de", { regions: ["DE"] }), step("supp:qzorva:fr", { regions: ["FR"] })] };
const BLOCKS = new Map([
  [IDENTICAL.qid, { qid: IDENTICAL.qid, state: "incomplete", total_hits: 2400 }],
  ["supp:qzorva:de", { qid: "supp:qzorva:de", state: "enumerated", total_hits: 40 }],
  ["supp:qzorva:fr", { qid: "supp:qzorva:fr", state: "enumerated", total_hits: 31 }],
]);
const WORLDWIDE = { jobKey: "t", classes: ["9"], geography: { mode: "worldwide" } };

function ctxFor(t, { plan = PLAN, profile = {} } = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "main-markets-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(join(runDir, "_driver"), { recursive: true });
  return { paths: paths(runDir), job: WORLDWIDE, profile, registerPlan: plan };
}
const identicalRow = (plan, mainMarkets) => crowdNarrowing(plan, BLOCKS, { mainMarkets }).rows.find((r) => r.qid === IDENTICAL.qid);

test("with no countries and no priority markets, the main markets are the ones the identical mark's market step used", (t) => {
  assert.deepEqual(marketStepMarkets(PLAN).sort(), ["DE", "FR"]);
  const main = mainMarketsOf(ctxFor(t));
  assert.deepEqual([...main].sort(), ["DE", "FR"], "the field's markets were passed over for the majors");
  const row = identicalRow(PLAN, main);
  assert.equal(row?.narrowing, "required-covered", `a crowd read in its field's markets was judged not covered: ${JSON.stringify(row)}`);
  const asBefore = identicalRow(PLAN, MAJOR_MARKETS);
  assert.equal(asBefore?.narrowing, "required-not-covered", "guard: judged against the majors, the same crowd is not covered");
});

test("the majors stand where no market step ran, and the customer's priority markets come first", (t) => {
  const noStep = { regions: [], entries: [IDENTICAL, step("supp:qzorva:c9", { nice_classes: ["9"], goods_text: ["accounting software"] })] };
  assert.deepEqual(marketStepMarkets(noStep), [], "a goods step was taken for a market step");
  assert.deepEqual([...mainMarketsOf(ctxFor(t, { plan: noStep }))].sort(), [...MAJOR_MARKETS].sort());
  assert.deepEqual(mainMarketsOf(ctxFor(t, { profile: { defaultJurisdictions: ["CA"] } })), ["CA"], "the market step outranked the customer's priorities");
});
