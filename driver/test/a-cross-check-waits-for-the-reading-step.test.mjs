// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A WEB-TO-REGISTER CROSS-CHECK WAITS FOR THE READING STEP, AND RUNS AS CODE WHEN IT IS NOT DECIDED.
//
// Every register widening waits for the reading step, which asks it or records why not. The cross-check
// lane mints its questions from the web's findings after the reading step has decided its plan, and it
// used to fold them in to run at once. Now they are minted waiting, the reading step is asked once more
// with them listed, and whatever it leaves undecided runs as code, as before: holding it would search
// nothing and hold up delivery.
//
// Driven through the real record tools, the real join and the real follow-up composer, on a plan written
// to a run folder the way the lane writes it. Invented owners and marks throughout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { waitingCrossCheck, undecidedCrossChecks, withoutWait } from "../cross-check-wait.mjs";
import { recordReleasedFamilies, recordWithheldFamilies, releasedFamilyQids, readWithheldFamilies } from "../withheld-families.mjs";
import { joinPlanToBands } from "../register-plan.mjs";
import { repairFollowup } from "../repair-composers.mjs";
import { STAGES, DECIDE_WAITING_FAMILIES } from "../stages.mjs";

const AXIS = "primary-sweep";
const xcheck = (qid, predicate, term) => waitingCrossCheck({ qid, axis: AXIS, predicate, term, nice_classes: ["9"], regions: [], expected_kind: "enumerate" });
const PLAN = { plan_version: 3, regions: ["US"], entries: [
  { qid: "primary-sweep:exact:lanternwick", axis: AXIS, predicate: "exact", term: "LANTERNWICK", nice_classes: ["9"], expected_kind: "enumerate" },
  xcheck("xcheck-owner-lanternwick-studio", "owner", "Lanternwick Studio"),
  xcheck("xcheck-mark-lanternwick-quest", "default", "LANTERNWICK QUEST"),
  xcheck("xcheck-mark-lanternwick-arcade", "default", "LANTERNWICK ARCADE"),
] };

function runWith(plan) {
  const dir = mkdtempSync(join(tmpdir(), "xcheck-wait-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "register-plan.json"), JSON.stringify(plan, null, 2));
  return dir;
}

test("a cross-check is minted waiting, and the reading step decides it with its own tools", () => {
  const dir = runWith(PLAN);
  try {
    const r = recordReleasedFamilies(dir, { axis: AXIS, families: [
      { qids: ["xcheck-owner-lanternwick-studio"], reason: "The studio sells the same kind of games, so its register filings could change the advice." }] });
    assert.deepEqual(r.rejected ?? [], [], `the release was refused: ${JSON.stringify(r.rejected)}`);
    const w = recordWithheldFamilies(dir, { axis: AXIS, families: [
      { qids: ["xcheck-mark-lanternwick-quest"], reason: "The listing is a fan page with no goods for sale, so no filing would follow from it." }] });
    assert.deepEqual(w.rejected ?? [], [], `the withholding was refused: ${JSON.stringify(w.rejected)}`);
    const decided = { released: releasedFamilyQids(dir), withheld: readWithheldFamilies(dir) };
    assert.deepEqual(undecidedCrossChecks(PLAN, decided), ["xcheck-mark-lanternwick-arcade"],
      "only the question nobody decided is left to run as code");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("what the reading step left undecided becomes a dictated entry, and the rest keep their decision", () => {
  const dir = runWith(PLAN);
  try {
    recordReleasedFamilies(dir, { axis: AXIS, families: [
      { qids: ["xcheck-owner-lanternwick-studio"], reason: "The studio sells the same kind of games, so its register filings could change the advice." }] });
    const released = releasedFamilyQids(dir);
    const before = joinPlanToBands(PLAN, {}, { released });
    const awaitingBefore = (before.awaiting ?? []).map((a) => a.qid ?? a);
    assert.ok(awaitingBefore.includes("xcheck-mark-lanternwick-arcade"), "an undecided cross-check did not wait");
    assert.ok(!before.missing.includes("xcheck-mark-lanternwick-arcade"), "a waiting cross-check was dictated before anyone decided it");
    assert.ok(before.missing.includes("xcheck-owner-lanternwick-studio"), "a released cross-check was not dictated");

    const ran = undecidedCrossChecks(PLAN, { released, withheld: readWithheldFamilies(dir) });
    const lifted = withoutWait(PLAN, ran);
    assert.equal(lifted.plan_version, PLAN.plan_version + 1, "the plan's version did not move, so an old receipt could be reused");
    const after = joinPlanToBands(lifted, {}, { released });
    for (const q of ran) assert.ok(after.missing.includes(q), `${q} did not become a dictated entry the direct executor runs`);
    assert.deepEqual(lifted.entries.filter((e) => e.when).map((e) => e.qid),
      PLAN.entries.filter((e) => e.when && !ran.includes(e.qid)).map((e) => e.qid), "a decided question lost its wait");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("when the reading step cannot be asked, every cross-check runs as code", () => {
  assert.deepEqual(undecidedCrossChecks(PLAN, {}), PLAN.entries.filter((e) => e.when).map((e) => e.qid));
  assert.deepEqual(withoutWait(PLAN, undecidedCrossChecks(PLAN, {})).entries.filter((e) => e.when), []);
});

test("the follow-up lists the questions and gives the reading step its own order, word for word", () => {
  const entries = PLAN.entries.filter((e) => e.when).map((e) => ({ ...e, from: "https://shop.example.com/lanternwick" }));
  const text = repairFollowup("register-unit:xcheck-decide", { axis: AXIS, entries });
  assert.match(text, /The web search's findings named these register questions after your reading\. They wait for you like the families in your plan:/);
  for (const e of entries) assert.ok(text.includes(`- qid "${e.qid}": ${e.predicate} "${e.term}"`), `${e.qid} is not listed`);
  assert.ok(text.includes(DECIDE_WAITING_FAMILIES), "the order is not the reading step's own");
  const dispatch = STAGES["register-unit"].message({ paths: { variantManifest: "vm.json", matterContext: "mc.md",
    registerBand: (a) => `band-${a}.json`, registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" },
    axis: AXIS, job: { classes: [9] }, registerPlan: PLAN });
  assert.ok(dispatch.includes(DECIDE_WAITING_FAMILIES), "the reading step's dispatch no longer carries the order the follow-up repeats");
});

test("the lane mints waiting, asks the reading step, runs what is left undecided, and records it (source)", async () => {
  // No mock run reaches this lane: the mock web findings name no owner or similar listing. So the wiring
  // is asserted where it lives, the way the repo pins other mid-run lanes.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const lane = src.slice(src.indexOf("common-law → register cross-check (copper-lattice recovery net #3)"), src.indexOf("WS2 (B3) — the plan⇄band IDENTITY JOIN"));
  assert.ok(lane.length > 1000, "the cross-check lane moved; re-read this arm");
  assert.match(lane, /candidates\.push\(waitingCrossCheck\(\{ qid, axis: "primary-sweep"/, "the lane no longer mints its questions waiting");
  assert.match(lane, /repairFollowup\("register-unit:xcheck-decide"/, "the reading step is no longer asked");
  assert.match(lane, /const ran = undecidedCrossChecks\(ctx\.registerPlan, \{ released, withheld \}\);/, "the undecided are no longer found after the ask");
  assert.match(lane, /withoutWait\(ctx\.registerPlan, ran\)/, "what is left undecided no longer runs as code");
  assert.match(lane, /\.\.\.\(decided \? \{ decided \} : \{\}\)/, "the receipt no longer records the decision");
});
