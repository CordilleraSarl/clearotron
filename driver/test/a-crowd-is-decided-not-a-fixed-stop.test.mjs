// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A CROWD IS DECIDED, NOT A FIXED STOP. The listing ceiling is a call limit, never a decision point (ruled
// 2026-09-25). The register unit's manual and its dispatch called a crowded slice TERMINAL: no per-market
// narrowing, no phonetic fringe, "do not narrow it further". The same manual tells the unit to narrow a
// crowded question until it lists. And the plan ran the wildcard fringe only if its contains parent listed
// under the ceiling, so a crowd stopped it with no reason written.
//
// Now the unit decides on a crowd as on the identical mark's, and the fringe waits for the reading turn
// like every other widening: released, or withheld with its reason. A withheld fringe is an explained
// absence to the form oracle, never an unsearched family ordered searched over the turn's decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRegisterPlan, awaitsReadingTurn } from "../register-plan.mjs";
import { PROVIDER_CAPABILITIES } from "../register-capabilities.mjs";
import { formNeighbourhood } from "../form-neighbourhood.mjs";
import { STAGES } from "../stages.mjs";
import { mechanicalFormGapDirectives } from "../pipeline.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(DRIVER, rel), "utf8");
const MARK = "TALVORIN";
const manifest = {
  schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
  variants: [{ value: MARK, category: "core" }], incumbent_classes: [], goods_words: ["software"],
};
const form = { elements: [{ element: MARK, band: formNeighbourhood(MARK) }] };
const compile = (id) => compileRegisterPlan({ manifest, job: { jobKey: "t", classes: ["9"], jurisdictions: ["EU"] },
  form, capabilities: PROVIDER_CAPABILITIES[id] });

test("the wildcard fringe waits for the reading turn on every register, and nothing waits on a crowd", () => {
  assert.ok(form.elements[0].band.wildcardPatterns.length, "guard: the form band has retrieval patterns");
  for (const id of Object.keys(PROVIDER_CAPABILITIES)) {
    const plan = compile(id);
    const fringe = plan.entries.filter((e) => e.predicate === "wildcard" && e.axis === "primary-sweep" && e.provenance === "floor");
    assert.ok(fringe.length, `${id}: guard: the fringe compiled`);
    for (const e of fringe)
      assert.ok(awaitsReadingTurn(e.when) || e.unsupported === true, `${id}: the fringe does not wait for the reading turn: ${JSON.stringify(e.when)}`);
    assert.deepEqual(plan.entries.filter((e) => e.when?.runs_if_enumerated).map((e) => e.qid), [],
      `${id}: an entry still runs only if its parent listed under the ceiling`);
    // The step the fringe hung on is still designated, for the reference score.
    assert.equal(plan.entries.filter((e) => e.crowd_gate_parent === true).length, 1, `${id}: the contains sweep lost its designation`);
  }
});

test("the unit's manual and dispatch decide on a crowd, and point at the order that narrows it", () => {
  const unit = read("skills/clearance-register/unit.md");
  for (const stop of [/\*\*TERMINAL\*\*/, /do not narrow it further/, /no further narrow/, /run per-major only\s+when the worldwide slice was tractable/,
    /STOP the per-major \/ phonetic fan-out/, /tractable distinctive/, /\(tractable distinctive token only\)/])
    assert.doesNotMatch(unit, stop, `the unit manual still stops on a crowd: ${stop}`);
  assert.ok(unit.includes("### Read the identical mark first. Look at the count before you read anything"), "guard: the order the crowd rule points at");
  assert.match(unit, /the ceiling is a call limit, never a decision point: decide on that crowd as on the identical mark's,\s+narrowing it \[in that order\]\(#read-the-identical-mark-first-look-at-the-count-before-you-read-anything\)/);
  const plan = compile("clarivate");
  const P = { variantManifest: "vm.json", matterContext: "mc.md", registerBand: (a) => `band-${a}.json`, registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" };
  const dispatch = STAGES["register-unit"].message({ paths: P, axis: "primary-sweep", job: { classes: [9] }, registerPlan: plan, capabilities: null });
  assert.doesNotMatch(dispatch, /TERMINAL: STOP|do NOT fan it out per-major|do NOT phonetic-fringe it/, "the dispatch still stops on a crowd");
  assert.match(dispatch, /→ the ceiling is a call limit, never a decision point: decide on that crowd as on the identical mark's/);
  // The fringe is listed to the turn as a family it decides.
  const fringeLine = dispatch.split("\n").find((l) => /: wildcard "/.test(l)) ?? "";
  assert.match(fringeLine, /WAITING FOR YOU/, `the fringe is not handed to the turn: ${fringeLine}`);
});

test("a fringe the reading turn withheld is an explained absence to the form oracle, not an unsearched family", (t) => {
  const run = mkdtempSync(join(tmpdir(), "crowd-decided-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(join(run, "_driver"), { recursive: true });
  const plan = compile("clarivate");
  const fringe = plan.entries.filter((e) => e.predicate === "wildcard" && e.provenance === "floor");
  // Every exact near-form of the band was dispatched; the wildcard fringe was not.
  const P = { runDir: run, formNeighbourhood: join(run, "form-neighbourhood.json"), registerNamedBand: join(run, "register-named-band.json") };
  writeFileSync(P.formNeighbourhood, JSON.stringify(form));
  writeFileSync(P.registerNamedBand, JSON.stringify({ blocks: form.elements[0].band.exactQueries.map((q) => ({ state: "enumerated", query: `name:\`${q}\``, records: [] })) }));
  const ctx = { paths: P, registerPlan: plan };
  const family = (ds) => ds.filter((d) => /phonetic family$/.test(d.item));
  assert.equal(family(mechanicalFormGapDirectives(ctx)).length, 1, "control: an undecided, unsearched fringe is ordered searched");
  writeFileSync(join(run, "_driver", "withheld-families-primary-sweep.json"), JSON.stringify({ axis: "primary-sweep",
    families: Object.fromEntries(fringe.map((e) => [e.qid, { reason: "The identical mark's list already answers who could object here." }])) }));
  assert.deepEqual(family(mechanicalFormGapDirectives(ctx)), [], "a fringe withheld with its reason was ordered searched over the turn's decision");
});
