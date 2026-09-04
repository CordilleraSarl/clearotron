// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// EVERY prompt that can reach a supplemental-lane register unit must agree with the lane
// (ION/copper-foundry 2026-07-22, second pass).
//
// The mechanism: pipeline.mjs dispatches a stage with `opts.followup ?? opts.freshMessage ??
// def.message(ctx)`. A followup/freshMessage REPLACES the stage message wholesale, so the by-design
// steering that lives in def.message never reaches a re-dispatch — each re-dispatch is a second,
// independent prompt. PR#75 fixed def.message alone. Sixteen dispatch paths later, two of them still
// ORDERED register_enumerate and hand-APPENDED band blocks: the frame-reopen warm resume and its fresh
// scoped retry. A third (the named_band_collapsed corrective hint) rides correctiveMessage, so it was
// appended to the very prompt that had just told the model the tool was gone — contradiction inside one
// prompt. That is how a unit reached for the removed tool, found it absent, and reported it
// "persistently blocked by a tool-permission gate" in a lawyer-facing report, then fell back to
// count-only sampling: 10 of Apple's 432 hits, 10 of Amazon's 225, 10 of Microsoft's 114.
//
// This file pins the invariant across ALL of them at once (the registry below), and closes the class
// structurally: the source guard at the bottom fails if a register_enumerate literal reappears anywhere
// in pipeline.mjs outside a comment, so a future inline dispatch cannot ship an order to call it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAGES, REGISTER_ENUMERATE_TOOL, SUPPLEMENTAL_LANE_STEERING, OWNER_SWEEP_STEERING,
  supplementalLaneResumeLine, buildEscalationFollowup, buildEnvelopeCloseFollowup,
  buildFrameReopenFollowup, buildFrameReopenRetryMessage } from "../stages.mjs";
import { correctiveMessage } from "../gateway.mjs";
import { allowedToolsFor, toolGroupsForStage } from "../engine/mcp/gather-config.mjs";

const AXIS = "primary-sweep";
const P = {
  variantManifest: "vm.json", matterContext: "mc.md", registerPlan: "plan.json",
  registerBand: (a) => `/run/register-units/${a}-band.json`,
  registerUnit: (a) => `/run/register-units/${a}.md`,
};
const JOB = { classes: [9, 42] };
const LANE_PLAN = { contract: { supplemental_lane: 1 }, entries: [] };
const LEGACY_PLAN = { entries: [] };
const DIRECTIVES = [
  { layer: "variant", severity: "dominant-element", item: "HALCYON", observation: "the dominant element was never enumerated in class 35" },
  { layer: "field", severity: "class-gap", item: "Cl.35/38", observation: "the class gap was never scoped" },
];
const COLLAPSED = "invalid_file:run/register-units/primary-sweep.md:named_band_collapsed:exact HALCYON~412";
const BAD_STATE = "invalid_file:run/register-units/primary-sweep.md:named_band_state_invalid:verified (one of: enumerated, incomplete)";
const UNIT_FILE = "/x/prelim-search/run/register-units/primary-sweep.md";

// Every lane prompt must (a) name the replacement tool and (b) say the absence is deliberate — the two
// halves of "enforcement needs matching invitation control". Neither may order the removed tool, and
// none may ask the model to hand-append a block (band_block_unplanned kills those on this lane).
const LANE_MUST = [/BY DESIGN, never an outage or a permission fault/, /register_propose_supplemental/];
const LANE_MUST_NOT = [/call register_enumerate|run register_enumerate/i, /APPEND (each|its|each call's) (result|block|records)/i];

// The registry IS the test surface: one row per prompt that can reach a supplemental-lane register unit.
// A new re-dispatch path adds a row here; forgetting to add one is what the source guard catches.
const STEERING_SITES = [
  {
    id: "register-unit stage message (the prompt every followup replaces)",
    build: (lane) => STAGES["register-unit"].message({ paths: P, axis: AXIS, job: JOB, registerPlan: lane ? LANE_PLAN : LEGACY_PLAN }),
    legacyMust: [/run register_enumerate calls/, /ALSO write the COMPLETE NAMED BAND/],
  },
  {
    id: "skeptic-escalation followup",
    build: (lane) => buildEscalationFollowup({ paths: P, axis: AXIS, flags: "- concern", supplementalLane: lane }),
    legacyMustNot: [/register_propose_supplemental/, /BY DESIGN/],
  },
  {
    id: "deadline-envelope close followup",
    build: (lane) => buildEnvelopeCloseFollowup({ paths: P, axis: AXIS, rows: "| u | deferred | r |", supplementalLane: lane }),
    legacyMustNot: [/register_propose_supplemental/, /BY DESIGN/],
  },
  {
    id: "frame-reopen warm resume",
    build: (lane) => buildFrameReopenFollowup({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 120, supplementalLane: lane }),
    legacyMust: [/re-ENUMERATE the dominant element .* with register_enumerate/, /APPEND each call's result as a block/],
  },
  {
    id: "frame-reopen fresh scoped retry",
    build: (lane) => buildFrameReopenRetryMessage({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 120, supplementalLane: lane }),
    legacyMust: [/Enumerate each via register_enumerate/, /APPEND each result as a block/],
  },
  {
    id: "named_band_collapsed corrective hint (rides the stage message itself)",
    build: (lane) => correctiveMessage("Run the unit.", 2, COLLAPSED, UNIT_FILE, { supplementalLane: lane }),
    legacyMust: [/Re-run that EXACT slice with register_enumerate/],
  },
  {
    // Reached on the lane, contrary to the note that used to sit on it: verify.mjs PARSES the band
    // (checkSiblingJson) before the band_block_unplanned contract check, and named-band.mjs throws
    // named_band_state_invalid / _block_invalid / _unparseable at parse time — so a lane run's
    // hand-authored block arrives here FIRST. It is warm-eligible too (WARM_ELIGIBLE_RE), so the same
    // hint rides warmPatchMessage's sibling route.
    id: "named_band_state_invalid corrective hint (also the warm sibling route)",
    build: (lane) => correctiveMessage("Run the unit.", 2, BAD_STATE, UNIT_FILE, { supplementalLane: lane }),
    legacyMust: [/REWRITE the offending qid-less block\(s\) IN PLACE/],
  },
];

test("every supplemental-lane prompt names the replacement and calls the absence deliberate", () => {
  for (const site of STEERING_SITES) {
    const m = site.build(true);
    for (const re of LANE_MUST) assert.match(m, re, `${site.id} — lane must say ${re}`);
    for (const re of LANE_MUST_NOT) assert.doesNotMatch(m, re, `${site.id} — lane must NOT say ${re}`);
    // …and none of the site's OWN legacy phrasing survives. A hand-written must-not list only catches the
    // phrasings someone thought to write down (the list above misses "re-ENUMERATE … with register_enumerate"
    // verbatim); each site's legacyMust IS the defect text this PR removed, so deriving the negative from it
    // catches a re-introduction of the real string without a new regex per edit.
    for (const re of site.legacyMust ?? []) assert.doesNotMatch(m, re, `${site.id} — lane must NOT keep its legacy ${re}`);
    // the steering is the shared constant, not a paraphrase that can drift out of step with the exclusion
    assert.ok(m.includes(SUPPLEMENTAL_LANE_STEERING), `${site.id} — carries the steering constant verbatim`);
    // The invariant stated as itself: with the two sanctioned PROHIBITIONS that name the tool removed, the
    // tool name must not appear at all — that, not a phrasing list, is what "the lane never orders it" means.
    // Strip the resume line FIRST: it ENDS with the steering constant, so stripping the constant first would
    // dissolve the resume line and leave its own "you never run … via register_enumerate" clause behind.
    const stripped = m.split(supplementalLaneResumeLine(P, AXIS)).join("").split(SUPPLEMENTAL_LANE_STEERING).join("");
    assert.doesNotMatch(stripped, /register_enumerate/, `${site.id} — names the removed tool outside a prohibition`);
  }
});

test("the diagnosis survives the lane branch — a lane prompt still says WHAT to cover, not just what not to call", () => {
  // The failure mode this guards: "fix" a contradictory prompt by deleting the offending sentence, which
  // leaves the unit banned from the old path and invited to nothing (the ION shape exactly).
  const reopen = buildFrameReopenFollowup({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 120, supplementalLane: true });
  assert.match(reopen, /HALCYON/, "the directive still names the threat");
  assert.match(reopen, /Cl\.35\/38/);
  assert.match(reopen, /DOMINANT-ELEMENT item\(s\) this is a CLOSURE pass/);
  assert.match(reopen, /nice_classes/, "class scoping still lands");
  assert.match(reopen, /regions/, "region scoping still lands");
  assert.match(reopen, /120 records/, "the fetch bound survives");
  assert.match(reopen, /"incomplete" block \(count \+ sample \+ reason\)/, "incomplete-descriptor honesty survives");
  // — THE DIGEST IS A CALL, so the reconciliation is what the seat SENDS rather than a
  // file it re-opens, and the three assertions that pinned the Edit direction go with it. The one that
  // scoped the Edit ("covers the DIGEST only") existed to stop "you may edit" reading as "you may edit the
  // band"; there is no edit direction now, so a sentence qualifying one would point at nothing and teach a
  // seat that a direction is somewhere below it. The band prohibition it carried is the live half and is
  // asserted below, unchanged.
  assert.match(reopen, /reconcile your account of this axis against the band the tools just wrote/,
    "the reconciliation is what the seat sends, not a file it re-opens");
  assert.match(reopen, /record_unit_note/, "the digest is handed back by the call that owns it");
  assert.doesNotMatch(reopen, /TARGETED EDITS/, "no Edit direction for a file the seat cannot write");
  assert.doesNotMatch(reopen, /the edit direction below covers the DIGEST only/,
    "the qualification outlived the direction it qualified");
  // …and the band contract inverts: the tool writes it, the model does not
  assert.match(reopen, /never author, edit, append to or re-save/);
  assert.doesNotMatch(reopen, /"state":"enumerated"/, "the hand-author state enum is dropped on the lane");

  const retry = buildFrameReopenRetryMessage({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 90, supplementalLane: true });
  assert.match(retry, /TIMED OUT at the hard wall/, "a fresh session still gets the whole contract");
  assert.match(retry, /HALCYON/);
  assert.match(retry, /90 records/);
  assert.doesNotMatch(retry, /"state":"enumerated"/);
});

test("legacy (no contract flag) prompts keep the enumerate lane VERBATIM — a frozen pre-flag resume must not be re-steered", () => {
  for (const site of STEERING_SITES) {
    const m = site.build(false);
    for (const re of site.legacyMust ?? []) assert.match(m, re, `${site.id} — legacy keeps ${re}`);
    for (const re of site.legacyMustNot ?? []) assert.doesNotMatch(m, re, `${site.id} — legacy must NOT say ${re}`);
    if (!site.legacyMust) assert.ok(!m.includes(SUPPLEMENTAL_LANE_STEERING), `${site.id} — no lane steering off-lane`);
  }
});

test("the collapsed-band repair is lane-appropriate: re-execute the qid or RE-PROPOSE, never author a block", () => {
  const lane = correctiveMessage("Run the unit.", 2, COLLAPSED, UNIT_FILE, { supplementalLane: true });
  const legacy = correctiveMessage("Run the unit.", 2, COLLAPSED, UNIT_FILE);
  // same diagnosis both ways — the lane changes the REPAIR, never the finding
  for (const m of [lane, legacy]) {
    assert.match(m, /COLLAPSED enumerated slice/);
    assert.match(m, /HALCYON~412/, "the offending slice is quoted back");
    assert.match(m, /NEVER an empty "enumerated" block/);
  }
  // TOOL TRUTH: register_execute_plan's published inputSchema is exactly {plan_path, axis, output_path}
  // on BOTH providers — there is no qid/qids property (the executor's `qids` filter is the driver's own
  // code-side plan-direct-execute repair). A hint ordering "execute_plan with that qid" would contradict
  // the three-key call form the same prompt's stage message gives — this PR's own failure class.
  assert.match(lane, /register_execute_plan ONCE with the exact \{"plan_path", "axis", "output_path"\}/);
  assert.match(lane, /takes no per-qid argument/);
  assert.match(lane, /RE-PROPOSE that EXACT slice through register_propose_supplemental/);
  assert.match(lane, /Do NOT author, edit or append a band block by hand/);
  assert.doesNotMatch(legacy, /register_propose_supplemental/, "off-lane the executor/propose repair does not apply");
});

test("a defective MODEL-AUTHORED band block on the lane is PRUNED and re-proposed, never rewritten in place", () => {
  // The branch's old note called it legacy-only because band_block_unplanned "catches any" hand-authored
  // block. It does not catch it FIRST: verify.mjs parses the band before the contract check, so a lane run
  // lands here, and the legacy repair ("rewrite it in place") is answered next pass by band_block_unplanned
  // ("remove it and re-propose") — two paid attempts with contradictory hints.
  const lane = correctiveMessage("Run the unit.", 2, BAD_STATE, UNIT_FILE, { supplementalLane: true });
  const legacy = correctiveMessage("Run the unit.", 2, BAD_STATE, UNIT_FILE);
  for (const m of [lane, legacy]) {
    assert.match(m, /defective MODEL-AUTHORED block \(state "verified"\)/, "the diagnosis is lane-independent");
    assert.match(m, /there is no "verified"\/"checked"\/"complete"\/"clean" state/);
  }
  assert.match(lane, /DELETE the offending qid-less block\(s\)/);
  assert.match(lane, /RE-PROPOSING it through register_propose_supplemental/);
  assert.match(lane, /a defective one is a tool bug to report in your digest/);
  assert.doesNotMatch(lane, /REWRITE the offending qid-less block\(s\) IN PLACE/);
  // legacy stays BYTE-identical — a frozen pre-flag resume still owns its own blocks
  assert.match(legacy, /REWRITE the offending qid-less block\(s\) IN PLACE/);
  assert.doesNotMatch(legacy, /register_propose_supplemental/);
  assert.equal(correctiveMessage("Run the unit.", 2, BAD_STATE, UNIT_FILE, { supplementalLane: false }), legacy);
});

test("the register_execute_plan tool DESCRIPTION agrees with the lane — it rides in context on every lane turn", () => {
  // The highest-authority surface a register unit reads. Only register_enumerate is dropped from the lane
  // toolset (gateway.mjs), so tools/list still hands the model register_execute_plan's description verbatim
  // — and corsearch's (the DEFAULT provider) told it to "add judgment extras as separate register_enumerate
  // calls appended without a qid", i.e. use the tool the stage message had just called absent BY DESIGN and
  // hand-append blocks band_block_unplanned kills. Clarivate already named the propose tool; they agree now.
  // Read as TEXT, never imported: these files are executable stdio servers.
  for (const f of ["corsearch-server.mjs", "clarivate-server.mjs"]) {
    const src = readFileSync(new URL(`../engine/mcp/${f}`, import.meta.url), "utf8");
    const desc = (src.split(`name: "register_execute_plan"`)[1] ?? "").split("inputSchema:")[0];
    assert.ok(desc.includes("description:"), `${f} declares register_execute_plan with a description`);
    assert.doesNotMatch(desc, /register_enumerate/, `${f} — the executor must not point judgment extras at the tool the lane removes`);
    assert.match(desc, /register_propose_supplemental/, `${f} — it names the replacement instead`);
  }
});

test("owner/watchlist steering rides the lane only, and states the proposal grammar the executor actually has", () => {
  const lane = STAGES["register-unit"].message({ paths: P, axis: "incumbent-class", job: JOB, registerPlan: LANE_PLAN });
  const legacy = STAGES["register-unit"].message({ paths: P, axis: "incumbent-class", job: JOB, registerPlan: LEGACY_PLAN });
  assert.ok(lane.includes(OWNER_SWEEP_STEERING), "the lane message carries it");
  assert.ok(!legacy.includes(OWNER_SWEEP_STEERING), "off-lane the unit still has register_enumerate — the grammar note does not apply");
  // TOOL TRUTH (F1, PR-1): a mark-text proposal may carry an `owner` SCOPE FIELD — the owner×term
  // intersection slice is the coverage instrument; the bare predicate:"owner" sweep is crowd context
  // that points at those slices. The steering must state the grammar the mint actually accepts.
  assert.match(OWNER_SWEEP_STEERING, /owner×term slice is THE coverage instrument/);
  assert.match(OWNER_SWEEP_STEERING, /owner as a scope field/);
  assert.match(OWNER_SWEEP_STEERING, /owner:"<the owner>"/);
  assert.match(OWNER_SWEEP_STEERING, /CROWD CONTEXT, not coverage/);
  assert.match(OWNER_SWEEP_STEERING, /honest "incomplete" COUNT descriptor/);
  assert.match(OWNER_SWEEP_STEERING, /POINTS AT the owner×term slice qids/);
  assert.match(OWNER_SWEEP_STEERING, /never "portfolio too large, noted"/);
  assert.match(OWNER_SWEEP_STEERING, /NEVER stand sampled register_search pages in/);
  // the retired doctrine must not survive anywhere in the message: the prohibition on composing
  // owner with mark text is exactly what killed nine of sixteen owner queries on the 2026-07-28 E2E run
  assert.doesNotMatch(OWNER_SWEEP_STEERING, /never both|REPLACES the name clause/);
  assert.doesNotMatch(OWNER_SWEEP_STEERING, /call register_enumerate|run register_enumerate/i);
  // PR-7: the compiler now SEEDS this exact lane from the manifest's watchlist_owners, so the steering
  // must (a) tell the model those slices already exist in the frozen plan and (b) name the qid shapes
  // the plan mints, so a duplicate proposal is a read-the-band miss, not an invitation.
  assert.match(OWNER_SWEEP_STEERING, /ALREADY compiled into the frozen plan/);
  assert.match(OWNER_SWEEP_STEERING, /\+owner-<owner>/);
  assert.match(OWNER_SWEEP_STEERING, /\+watch/);
  assert.match(OWNER_SWEEP_STEERING, /covered_by/);
});

test("the excluded tool constant names a tool the unit would OTHERWISE be granted (a typo would make the ban a no-op)", () => {
  const granted = allowedToolsFor(toolGroupsForStage(`register-unit:${AXIS}`)).split(" ");
  assert.ok(granted.includes(REGISTER_ENUMERATE_TOOL), `${REGISTER_ENUMERATE_TOOL} is in the register group's allowlist`);
  // …and the lane's replacement tools survive the exclusion runStage performs, so the steering is honest
  const kept = granted.filter((t) => t !== REGISTER_ENUMERATE_TOOL);
  assert.ok(!kept.includes(REGISTER_ENUMERATE_TOOL));
  assert.ok(kept.includes("mcp__register__register_propose_supplemental"));
  assert.ok(kept.includes("mcp__register__register_execute_plan"));
  assert.ok(kept.includes("mcp__register__register_search"));
});

test("SOURCE GUARD: no register_enumerate literal survives outside a comment in pipeline.mjs", () => {
  // The structural half of the fix. Every inline dispatch that named the tool is now a builder in
  // stages.mjs, where the lane branch lives — so a new inline followup ordering the banned tool cannot
  // ship. Comment lines are stripped (the incident history is documented there on purpose); a TRAILING
  // comment on a code line is deliberately NOT stripped, so the guard cannot be dodged with one. Only the
  // two real comment openers are stripped — a leading `*` was too broad (a markdown-style bullet inside a
  // multi-line prompt template would have been read as a JSDoc continuation and skipped).
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const offenders = src.split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !/^\s*(\/\/|\/\*)/.test(line))
    .filter(([, line]) => line.includes("register_enumerate"));
  assert.deepEqual(offenders, [], `pipeline.mjs must reach the tool only through REGISTER_ENUMERATE_TOOL:\n${
    offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join("\n")}`);
  // the constant IS how it is referenced now (guards against the guard passing on an empty file)
  assert.match(src, /REGISTER_ENUMERATE_TOOL/);
});
