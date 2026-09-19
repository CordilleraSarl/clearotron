// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// the-house-element-stays-out-of-what-folds-in-later.test.mjs — once the compile sets the client's own
// registered element aside, no later writer puts a search on it back into the plan.
//
// Measured on the first live run that proposed an exclusion (2026-09-19): ownership verified, the
// compile dropped the element, and the plan still ended with two primary-sweep searches on the bare
// element. Neither came from the compile. The common-law cross-check folded in a `default` search on
// it, and the register session proposed an `exact` one through the supplemental tool, which runs a
// proposal the moment it mints it. Three more folded rows searched the element with other words and no
// word of the remainder, which is exactly what the compile itself drops. The arms below are that plan's
// shape, in invented words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { compileRegisterPlan, excludeHouseElement, foldSupplementalEntries, screenThenCap, houseElementOf } from "../register-plan.mjs";
import { parseVariantManifestModel } from "../variant-manifest-model.mjs";
import { proposeSupplemental } from "../engine/mcp/supplemental.mjs";

const MODEL = {
  schema_version: 1,
  mark: "NOVAPULSE SOUND OF TOMORROW",
  dominant_element: "NOVAPULSE",
  elements: [{ value: "NOVAPULSE", kind: "distinctive" }, { value: "TOMORROW", kind: "distinctive" }],
  variants: [
    { value: "NOVAPULS", category: "visual", rationale: "one-letter mutation of the house element" },
    { value: "NOVAPULSE SOUND OF TOMORROW", category: "exact-phrase", rationale: "the whole phrase" },
  ],
  incumbent_classes: ["9"],
};
const HOUSE = { element: "NOVAPULSE", remainder: "SOUND OF TOMORROW" };

/** The plan as the pipeline freezes it after a verified exclusion: the compile, plus its confirmation row. */
function excludedPlan({ legacy = false } = {}) {
  const r = excludeHouseElement(MODEL, HOUSE);
  const plan = compileRegisterPlan({ manifest: parseVariantManifestModel(JSON.stringify(r.manifest)),
    job: { jobKey: "TMP9999-novapulse", classes: ["9"], jurisdictions: ["EU"] }, skillVersion: "clearance-register@spec48",
    houseElement: HOUSE.element });
  const confirmation = { ...r.confirmation, qid: "house-owner-novapulse" };
  if (legacy) delete confirmation.house_element_remainder;   // a plan frozen before the remainder was recorded
  return { ...plan, entries: [...plan.entries, confirmation] };
}
const row = (qid, predicate, term, extra = {}) => ({ qid, axis: "primary-sweep", predicate, term, nice_classes: ["9"], regions: [], expected_kind: "enumerate", ...extra });

// What the later writers offered on the live run, in the same shapes.
const LIVE_LATER_ROWS = [
  row("xcheck-mark-novapulse", "default", "NOVAPULSE"),                                 // cross-check, bare element
  row("supp:primary-sweep:exact:novapulse:00000001", "exact", "NOVAPULSE", { origin: "supplemental" }),   // register session, bare element
  row("supp:primary-sweep:exact:novapulses:00000002", "exact", "NOVAPULSES", { origin: "supplemental" }),
  row("supp:primary-sweep:exact:novapulse-audio:00000003", "exact", "NOVAPULSE AUDIO", { origin: "supplemental" }),
  row("supp:primary-sweep:exact:novapulse-audio-live:00000004", "exact", "NOVAPULSE AUDIO LIVE", { origin: "supplemental" }),
];
const KEPT_LATER_ROWS = [
  row("xcheck-mark-novapulse-sound-of-tomorrow", "default", "NOVAPULSE SOUND OF TOMORROW"),   // carries the remainder
  row("supp:primary-sweep:exact:novapulse-tomorrow:00000005", "exact", "NOVAPULSE TOMORROW", { origin: "supplemental" }),
  row("supp:primary-sweep:exact:zenithcore:00000006", "exact", "ZENITHCORE", { origin: "supplemental" }),
  row("xcheck-owner-novapulse-audio-gmbh", "owner", "Novapulse Audio GmbH"),                    // an owner sweep is not mark text
];
const termsOf = (plan) => plan.entries.filter((e) => !e.house_element_confirmation)
  .flatMap((e) => [e.term, ...(e.terms ?? [])]).filter(Boolean).map((t) => String(t).toUpperCase());

test("the live shape: the two bare-element searches and three element-only forms stay out; the rest folds in", () => {
  const plan = excludedPlan();
  assert.ok(!termsOf(plan).includes("NOVAPULSE"), "precondition: the compile itself holds no search on the bare element");
  const r = foldSupplementalEntries(plan, [...LIVE_LATER_ROWS, ...KEPT_LATER_ROWS]);
  assert.deepEqual(r.excluded.sort(), LIVE_LATER_ROWS.map((e) => e.qid).sort());
  assert.deepEqual(r.refused, [], "left out quietly: a refused row renders to the client as an open ask");
  for (const e of KEPT_LATER_ROWS) assert.ok(r.added.includes(e.qid), `${e.term} was not folded in`);
  const terms = termsOf(r.plan);
  for (const gone of ["NOVAPULSE", "NOVAPULSES", "NOVAPULSE AUDIO", "NOVAPULSE AUDIO LIVE"])
    assert.ok(!terms.includes(gone), `the plan searches ${gone} again`);
  const confirmations = r.plan.entries.filter((e) => String(e.term).toUpperCase() === "NOVAPULSE");
  assert.equal(confirmations.length, 1, "the one query left on the bare element is the ownership confirmation");
  assert.equal(confirmations[0].predicate, "owner");
});

test("an OR-stack loses its house-element member and keeps the rest", () => {
  const r = foldSupplementalEntries(excludedPlan(),
    [row("supp:primary-sweep:exact:stack:00000007", "exact", undefined, { terms: ["NOVAPULSE", "ZENITHCORE"] })]);
  const added = r.plan.entries.find((e) => e.qid === "supp:primary-sweep:exact:stack:00000007");
  assert.deepEqual(added.terms, ["ZENITHCORE"]);
});

test("the cross-check's own path: a bare-element row neither survives the cap nor is refused", () => {
  const s = screenThenCap(excludedPlan(), [LIVE_LATER_ROWS[0], KEPT_LATER_ROWS[0]], 10);
  assert.deepEqual(s.entries.map((e) => e.qid), [KEPT_LATER_ROWS[0].qid]);
  assert.deepEqual(s.refused, []);
});

test("CRITERION 2: with no verified exclusion, every later row folds exactly as before", () => {
  const { entries, ...rest } = excludedPlan();
  const plain = { ...rest, entries: entries.filter((e) => !e.house_element_confirmation) };
  assert.equal(houseElementOf(plain), null);
  const r = foldSupplementalEntries(plain, LIVE_LATER_ROWS);
  assert.deepEqual(r.excluded, []);
  assert.deepEqual(r.added.sort(), LIVE_LATER_ROWS.map((e) => e.qid).sort());
});

test("a plan frozen before the remainder was recorded leaves out only the bare element", () => {
  const r = foldSupplementalEntries(excludedPlan({ legacy: true }), LIVE_LATER_ROWS);
  assert.deepEqual(r.excluded.sort(), LIVE_LATER_ROWS.slice(0, 2).map((e) => e.qid).sort(),
    "without the remainder, \"carries no word of it\" cannot be decided");
});

test("the supplemental tool runs nothing on the house element, and records no open ask for it", async () => {
  // THE TOOL EXECUTES WHAT IT MINTS, before any fold, so this is where the register session's bare
  // element search has to stop.
  const run = mkdtempSync(join(tmpdir(), "house-supp-"));
  mkdirSync(driverDir(run), { recursive: true });
  mkdirSync(join(run, "register-units"), { recursive: true });
  writeFileSync(driverDir(run, "register-plan.json"), JSON.stringify(excludedPlan()));
  const bandPath = join(run, "register-units", "primary-sweep-band.json");
  const ran = [];
  const executePlan = async (params) => {
    const supp = JSON.parse(readFileSync(params.plan_path, "utf8"));
    for (const e of supp.entries.filter((x) => params.qids.includes(x.qid))) ran.push(e.term ?? e.terms);
    writeFileSync(bandPath, "[]");
    return { type: "text", text: JSON.stringify({ written: bandPath, blocks: 0 }) };
  };
  const call = (proposals) => proposeSupplemental({ axis: "primary-sweep", output_path: bandPath, proposals },
    { kind: "propose_supplemental", sessionKey: "run-x", agentId: "a", sessionId: "s" }, { executePlan });

  const mixed = JSON.parse((await call([
    { predicate: "exact", term: "NOVAPULSE", nice_classes: [9], rationale: "the element alone" },
    { predicate: "exact", term: "ZENITHCORE", nice_classes: [9], rationale: "a near form seen in common law" },
  ])).text);
  assert.deepEqual(mixed.excluded_house_element, ["NOVAPULSE"], "the reply names what was left out");
  assert.deepEqual(ran, ["ZENITHCORE"], "only the other proposal ran");

  const only = JSON.parse((await call([{ predicate: "default", term: "NOVAPULSE", nice_classes: [9], rationale: "contains" }])).text);
  assert.equal(only.executed, false);
  assert.deepEqual(only.excluded_house_element, ["NOVAPULSE"]);
  assert.deepEqual(ran, ["ZENITHCORE"], "nothing more ran");

  const suppPath = join(run, "register-units", "primary-sweep-supplemental-plan.json");
  assert.ok(existsSync(suppPath));
  const supp = JSON.parse(readFileSync(suppPath, "utf8"));
  assert.ok(!supp.entries.some((e) => e.term === "NOVAPULSE"), "the house element was minted into the supplemental plan");
  assert.ok(!(supp.rejected ?? []).some((r) => JSON.stringify(r).includes("NOVAPULSE")),
    "a rejected[] row renders as an OPEN ask on the report, and the element is not an open question");
});
