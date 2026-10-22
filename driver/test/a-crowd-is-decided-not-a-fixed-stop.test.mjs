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
  assert.match(unit, /the ceiling is a call limit, never a decision point: decide on that crowd with \[the same steps\]\(#read-the-identical-mark-first-look-at-the-count-before-you-read-anything\),\s+only as far as reading it would change what you tell the client; record what stays a crowd with its count\./);
  const plan = compile("clarivate");
  const P = { variantManifest: "vm.json", matterContext: "mc.md", registerBand: (a) => `band-${a}.json`, registerUnit: (a) => `unit-${a}.md`, registerPlan: "plan.json" };
  const dispatch = STAGES["register-unit"].message({ paths: P, axis: "primary-sweep", job: { classes: [9] }, registerPlan: plan, capabilities: null });
  assert.doesNotMatch(dispatch, /TERMINAL: STOP|do NOT fan it out per-major|do NOT phonetic-fringe it/, "the dispatch still stops on a crowd");
  assert.match(dispatch, /→ the ceiling is a call limit, never a decision point: decide on that crowd with the same steps \(unit\.md, "Read the identical mark first"\), only as far as reading it would change what you tell the client; record what stays a crowd with its count\./);
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

test("the write-up settles a crowd the narrowing steps closed as withheld by judgment, and the shared manual narrows a crowded name-list", () => {
  const digest = read("skills/clearance-register/digest.md").replace(/\s+/g, " ");
  assert.ok(digest.includes("There are three kinds and they take different statuses:"), "the open-row paragraph still names two kinds");
  assert.ok(digest.includes("**A crowd the narrowing steps closed.** A narrowed list that was read answered it, or the reading step set it aside "
    + "with its count and a reason. That is finished work, not a gap. Status `withheld-by-judgment`, with that reason. A crowd left by the identical "
    + "mark's own narrowing is not this kind: one still a crowd after the last step, or in a country its market step did not read, is an unaccounted crowd block."));
  assert.ok(digest.includes("For the first two kinds the gap is an OPEN, disclosed question for the lawyer, never a clean negative. "
    + "The third is never a clean negative either: its count stays on the record."));
  const skill = read("skills/clearance-register/SKILL.md").replace(/\s+/g, " ");
  assert.ok(skill.includes("**The exact name-list is read first, and narrowed when it crowds.**"));
  assert.doesNotMatch(skill, /left as a crowd descriptor|small and cheap by construction/, "the shared manual still says the name-list can never stay a crowd");
});

test("both manuals stop on a lawyer's judgment, and the register manuals carry the approved words with no billing words", () => {
  const flat = (rel) => read(rel).replace(/\s+/g, " ");
  const STOP = "Once the identical mark for the client's goods has been read, decide as a lawyer would whether you have enough. Would more searching "
    + "change what you tell the client: who could object, how weak the word is in this market, or what the client should do? If it would, widen one step, "
    + "read, and decide again. If it would not, you are done. Write in one line why more searching would not change the advice, record which questions you "
    + "did not ask and why, and move on. That is complete work.";
  for (const m of ["skills/clearance-register/SKILL.md", "skills/clearance-register/unit.md"]) {
    assert.ok(flat(m).includes(STOP), `${m} does not stop on a lawyer's judgment`);
    assert.doesNotMatch(flat(m), /Having read the list, ask whether looking wider/, `${m} keeps the old stopping paragraph`);
  }
  assert.ok(flat("skills/clearance-register/unit.md").includes("**The exact name-list is read first, and narrowed when it crowds.** The exact mark token × in-scope class (`match_mode:exact`) is the identical-mark question of the narrowing steps"));
  assert.ok(flat("skills/clearance-register/SKILL.md").includes("The narrowing steps bound the searching: each keeps the limits before it, and they end."));
  const recipes = flat("skills/clearance-register/register-recipes.md");
  assert.ok(recipes.includes("then the majors, taken from a complete worldwide answer; a crowd is narrowed by the steps in `unit.md`, whose market step uses the one list your opening message names; then the exact name-list, narrowed by the steps in `unit.md` when it crowds"));
  assert.ok(recipes.includes("Scope the search text by class and region; narrow a crowd by the client's goods with the goods field, never by putting goods words into the search text."));
  // the billing and price words the approved set takes out
  const all = ["SKILL.md", "unit.md", "digest.md", "register-recipes.md", "providers/clarivate.md", "providers/corsearch.md", "providers/euipo.md",
    "providers/free-tier.md", "providers/uspto-local.md"].map((f) => flat(`skills/clearance-register/${f}`)).join(" ");
  for (const gone of ["wastes a paid call", "one billable search", "both paid vendors", "Queries are free", "metered provider", "cheap `/count`",
    "cost breakdown", "send one cheap", "(cheap tiers)", "(cheap, informational", "(cheap — tells", "cheapest, always enumerates"])
    assert.ok(!all.includes(gone), `the register manuals still say "${gone}"`);
});

test("judgment on a crowd narrows by the steps or records it with its count and moves on: it never halts", () => {
  const flat = (rel) => read(rel).replace(/\s+/g, " ");
  const skill = flat("skills/clearance-register/SKILL.md");
  const unit = flat("skills/clearance-register/unit.md");
  const recipes = flat("skills/clearance-register/register-recipes.md");
  assert.ok(skill.includes("either **commands a narrower named enumeration** by the narrowing steps (which the funnel then runs) or **records the crowd with its count and moves on**."));
  assert.ok(skill.includes("which commands a narrower named enumeration by the narrowing steps, or records it and moves on: a crowd with its count, a failed search as a gap."));
  assert.ok(unit.includes("an incomplete result crosses the firewall as an incomplete block, and you decide on it by the narrowing steps: narrow it, or record it with its count and move on."));
  assert.ok(recipes.includes("the lawyer decides whether to command a narrower named enumeration by the narrowing steps (which the funnel then runs), or to record it with its count and move on."));
  for (const [name, text] of [["SKILL.md", skill], ["unit.md", unit], ["register-recipes.md", recipes]])
    assert.doesNotMatch(text, /halts to a human|, or halts\.| or halt\./, `${name} still lets judgment halt on a crowd`);
  assert.doesNotMatch(flat("skills/clearance-register/providers/corsearch.md"), /cheapest count-only/);
});
