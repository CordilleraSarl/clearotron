// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN EU ORDER ASKS THE MEMBER STATES' OWN REGISTERS, IN THE REQUESTS IT ALREADY MAKES.
//
// An EU order searched the EU-wide register and Madrid, and no member state's national register. A national
// right blocks use in its member state without appearing in the EU-wide register, so a live national
// registration identical to the mark sat outside an EU-scoped search and inside the same day's worldwide
// one. Measured 2026-10-09 on both live providers: an EU-scoped search returns no national filings, and the
// member offices listed in the same request reach them. So the plan lists them in the same request: the
// number of questions does not change, only how many registers each one is put to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRegisterPlan, resolveRegions } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { CAPABILITIES as signa } from "../../providers/signa/src/capabilities.js";

const manifest = {
  schema_version: 1, mark: "TORVANE", dominant_element: "TORVANE", elements: [{ value: "TORVANE", kind: "distinctive" }],
  variants: [{ value: "TORVANE", category: "core" }, { value: "TORVAIN", category: "phonetic" }],
  incumbent_classes: [], goods_words: ["software"],
};
const plan = (jurisdictions) => compileRegisterPlan({
  manifest, job: { jobKey: "t", classes: ["9"], jurisdictions }, capabilities: PROVIDER_CAPABILITIES.clarivate,
});

test("on Clarivate an EU order puts every member register into each request, Benelux once", () => {
  const { regions } = resolveRegions(["EU"], PROVIDER_CAPABILITIES.clarivate);
  for (const office of ["EM", "WO", "FR", "DE", "SE", "IT", "BX"]) assert.ok(regions.includes(office), `${office} is not searched`);
  for (const office of ["NL", "BE", "LU"]) assert.ok(!regions.includes(office), `${office} has no register of its own; BX stands for it`);
  const asked = plan(["EU"]).entries.filter((x) => Array.isArray(x.regions) && x.regions.includes("EM"));
  assert.ok(asked.length > 0, "no request asks the EU-wide register at all");
  for (const e of asked)
    assert.ok(e.regions.includes("FR") && e.regions.includes("BX"), `${e.qid} asks the EU-wide register without the member registers`);
});

test("the member registers add no questions: an EU order asks as many as a one-country order", () => {
  assert.equal(plan(["EU"]).entries.length, plan(["CH"]).entries.length,
    "an EU order compiled extra requests for the member registers instead of widening the ones it makes");
});

test("on Signa an EU order reaches the member registers the provider covers, in the same call", () => {
  const { regions } = resolveRegions(["EU"], signa);
  for (const office of ["euipo", "inpi-fr", "prv"]) assert.ok(regions.includes(office), `${office} is not searched`);
});

test("an EU order resolved twice asks the same registers", () => {
  for (const caps of [PROVIDER_CAPABILITIES.clarivate, signa]) {
    const once = resolveRegions(["EU"], caps).regions;
    assert.deepEqual(resolveRegions(once, caps).regions, once, `${caps.id}: a resolved EU plan grew when resolved again`);
  }
});

test("a one-country order is unchanged", () => {
  assert.deepEqual(resolveRegions(["FR"], PROVIDER_CAPABILITIES.clarivate).regions, ["FR", "EM", "WO"]);
  assert.deepEqual(resolveRegions(["CH"], PROVIDER_CAPABILITIES.clarivate).regions, ["CH", "WO"]);
});
