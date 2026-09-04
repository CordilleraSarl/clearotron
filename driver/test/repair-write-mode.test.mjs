// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Every corrective prompt in the driver has a WRITE MODE, and this file pins which one each site got.
//
// The rule and the measurements live in repair-contract.mjs. The short form: a corrective turn handed an
// EXISTING file that failed ONE named check must PATCH it, because everything the check did not name has
// already passed and re-typing it risks degrading content nobody complained about. The whole-file re-emission
// was not a safety property — it was a habit, and on the settlement flush it was the difference between the
// two attempts that failed and the one that passed.
//
// Two directions are asserted, and the second matters as much as the first:
//   1. every CONVERTED site orders targeted edits and no longer says "full file, not a diff";
//   2. every DELIBERATELY PRESERVED full-write site still says it. Those sites are not oversights — a schema
//      migration rewrites the whole document by nature, and a cold retry has no session context to patch
//      from — so a later "consistency" sweep that converts them is a REGRESSION, and this half catches it.
//
// The exported builders are asserted on their rendered output. pipeline.mjs's followups are inline in async
// functions and only reachable through a full mock run, so those are asserted STRUCTURALLY against the
// source: each site's own instruction text is the anchor, and the repair tail must follow it. That is
// deliberately a source scan and not twelve pipeline runs — the thing under test is what the prompt SAYS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { editRepairTail, fullWriteTail } from "../repair-contract.mjs";
import { digestReemitContract, buildFlushFollowup } from "../digest-queue.mjs";
import { buildEscalationFollowup, buildEnvelopeCloseFollowup,
  buildFrameReopenFollowup, buildFrameReopenRetryMessage } from "../stages.mjs";
// — the one registry. Every assertion about repair text below reads what a composer COMPOSES,
// never a window of pipeline.mjs source.
import { REPAIR_COMPOSERS } from "../repair-composers.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(join(DRIVER, f), "utf8");

const AXIS = "primary-sweep";
const P = {
  registerBand: (a) => `/runs/x/prelim-search/run/register-units/${a}-band.json`,
  registerUnit: (a) => `/runs/x/prelim-search/run/register-units/${a}.md`,
};
const UNIT = P.registerUnit(AXIS);
const DIRECTIVES = [
  { layer: "variant", severity: "dominant-element", item: "HALCYON", observation: "the dominant element was never enumerated in class 35" },
  { layer: "field", severity: "class-gap", item: "Cl.35/38", observation: "the class gap was never scoped" },
];
const FINDINGS = "/runs/x/prelim-search/run/register-findings.md";

// What "orders targeted edits" MEANS, asserted once here so every site below can be checked against the
// same bar rather than each inventing its own phrasing test.
// — THE UNIT DIGEST IS NOT EDITABLE ANY MORE, so its followups get their own check.
// `ordersEdits` asserts the Edit tail and the untouched-remainder guarantee; neither is a thing a seat can
// do to a file the driver renders. This asserts the same PROPERTY one lane over — the followup names the
// one act that can repair this artifact — plus both negatives, so a composer that quietly returned to
// ordering a write cannot pass. The negatives matter more here than the positive: gateway's generic warm
// patch already re-routes, and it was the BESPOKE composers that kept ordering an Edit of a file the seat
// holds no tool for.
const ordersTheCall = (m, target, label) => {
  assert.match(m, /record_unit_note/, `${label} — names the call that is the only way to repair this artifact`);
  assert.doesNotMatch(m, /TARGETED EDITS/, `${label} — no Edit branch for a file the seat cannot write`);
  assert.doesNotMatch(m, /full file, not a diff/, `${label} — and no whole-document re-emission either`);
  assert.doesNotMatch(m, new RegExp(`re-emit the COMPLETE ${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
    `${label} — and no re-emit order aimed at the digest itself`);
};

const ordersEdits = (m, target, label) => {
  assert.ok(m.includes(`TARGETED EDITS to ${target} using the Edit tool`), `${label} — names the Edit tool and the target by absolute path`);
  assert.match(m, /leave every other line of the file byte-identical/, `${label} — states the untouched-remainder guarantee`);
  assert.doesNotMatch(m, /full file, not a diff/, `${label} — the whole-document re-emission is gone`);
  assert.doesNotMatch(m, /re-emit the COMPLETE/i, `${label} — and so is every re-emit order`);
};

// ── the shared tail itself ────────────────────────────────────────────────────────────────────────────
test("the two tails say opposite things about write mode, and the edit tail never strands an absent file", () => {
  const e = editRepairTail("/runs/x/out.md");
  ordersEdits(e, "/runs/x/out.md", "editRepairTail");
  // The one escape hatch: an Edit direction aimed at a file that turns out not to exist must not deadlock.
  assert.match(e, /does not exist, create it in full with the Write tool/);
  // …and it must never argue in terms of how long a rewrite takes or what it costs. The reason given to a
  // model is degradation risk, which is a correctness argument and true independently of any budget.
  assert.doesNotMatch(e, /\b(minute|second|hour|token|cost|budget|deadline|faster|slower|cheap|expensive)\b/i,
    "no prompt may reason about time, tokens or budgets");
  const w = fullWriteTail("/runs/x/out.md");
  assert.match(w, /Write the COMPLETE file now/);
  assert.doesNotMatch(w, /TARGETED EDITS/);
});

// ── digest-queue: the settlement flush ────────────────────────────────────────────────────────────────
test("digestReemitContract orders a PATCH CALL, and keeps the reconciliation mandate the flush exists for", () => {
  // CONVERSION 11 — this asserted `ordersEdits`. register-findings.md's only writer is the driver now, so
  // an Edit order here would be the superseded path the golden rule bans; the anti-truncation property the
  // Edit was chosen for is carried by the patch instead (see digest-queue.test.mjs for the full note).
  const c = digestReemitContract(FINDINGS);
  assert.match(c, /record_register_digest/, "the flush must name the transport that writes the document");
  assert.match(c, /patch: true/, "a flush corrects named rows, and a patch is what makes that cheaper than the append it replaced");
  assert.doesNotMatch(c, EDIT_TAIL, "a file-edit tail on a tool-call repair is the shape #460 closed");
  assert.match(c, /Coverage ledger/,
    "WHAT to reconcile is unchanged; only the write mode moved");
  // The truncation fear the old full-emission contract was justified by is answered, not abandoned: a Write
  // carrying only the changed sections still destroys what it omits, so the flush must never invite one.
  const followup = buildFlushFollowup({ registerFindingsPath: FINDINGS, sections: [{ trigger: "escalation", text: "…" }] });
  assert.ok(followup.trimEnd().endsWith(c), "the consolidated followup still ENDS with the contract");
  assert.ok(!followup.includes("ONLY those rows corrected"), "never 'emit only the changed sections'");
});

test("the comment above digestReemitContract states the Write-vs-Edit distinction its old justification missed", () => {
  const t = src("digest-queue.mjs");
  const block = t.split("export function digestReemitContract")[0].split("── the consolidated settlement followup")[1];
  assert.match(block, /A Write REPLACES the file/);
  assert.match(block, /An Edit PATCHES the bytes it names in place/);
  assert.match(block, /cannot be truncated/, "the old justification is answered on its own terms, not dropped");
});

// ── stages.mjs: the register-unit corrective builders ─────────────────────────────────────────────────
test("the escalation followup orders the unit-note CALL, on both lanes, with the concerns still dictated", () => {
  for (const lane of [false, true]) {
    const m = buildEscalationFollowup({ paths: P, axis: AXIS, flags: "- the crowd weighing looks thin", supplementalLane: lane });
    ordersTheCall(m, UNIT, `escalation (lane=${lane})`);
    assert.match(m, /the crowd weighing looks thin/, "the concerns still ride");
    assert.match(m, /defend your existing finding|run ONLY the narrow additional sub-query/, "WHAT to do is unchanged");
    // "corrected for what the concerns above name" has to have a referent: the tail sits AFTER the list.
    assert.ok(m.indexOf("Skeptic concerns:") < m.indexOf("record_unit_note"), "the tail follows the concerns it points back at");
  }
});

test("the envelope-close followup orders the unit-note CALL and still names the rows it may close", () => {
  for (const lane of [false, true]) {
    const m = buildEnvelopeCloseFollowup({ paths: P, axis: AXIS, rows: "| translit | deferred | provider gap |", supplementalLane: lane });
    ordersTheCall(m, UNIT, `envelope (lane=${lane})`);
    assert.match(m, /confirmed-clean or coverage-limited with the honest reason/, "the closure vocabulary survives");
    assert.match(m, /\| translit \| deferred \| provider gap \|/);
  }
});

test("frame-reopen WARM resume orders the digest CALL — and the band prohibition survives the Edit it qualified", () => {
  const lane = buildFrameReopenFollowup({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 120, supplementalLane: true });
  ordersTheCall(lane, UNIT, "frame-reopen warm (lane)");
  // Introducing the Edit tool into a prompt whose band is TOOL-OWNED is the one new hazard this conversion
  // creates: "you may edit" must not read as "you may edit the band". The scope is stated in the sentence
  // immediately before the tail, where it is read as a qualification of it.
  assert.match(lane, /never author, edit, append to or re-save \/runs\/x\/prelim-search\/run\/register-units\/primary-sweep-band\.json yourself/);
  // THE SCOPE SENTENCE OUTLIVED THE HAZARD IT QUALIFIED, and that is why it stays. It existed because
  // introducing the Edit tool into a prompt whose band is TOOL-OWNED risked reading as "you may edit the
  // band". There is no Edit direction here now — the digest is a call — so the sentence no longer
  // qualifies anything, but the band prohibition it carries is the live half and is asserted above.
  assert.doesNotMatch(lane, /the edit direction below covers the DIGEST only/,
    "the qualification survived the direction it qualified — a sentence pointing at nothing teaches a "
    + "seat that an edit direction is somewhere below");

  const legacy = buildFrameReopenFollowup({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 120, supplementalLane: false });
  ordersTheCall(legacy, UNIT, "frame-reopen warm (legacy)");
  // On the legacy lane the model owns its own band, and this arm used to order "APPEND each call's result
  // as a block" and then, three lines later, a COMPLETE re-emission of the band "with the new blocks folded
  // in". An append and a re-emission are not the same act, and the re-emission is the one that re-types
  // blocks the model never authored — which is how a qid gets dropped. Correctness, not cost.
  assert.match(legacy, /APPEND each call's result as a block/, "the append order is untouched");
  assert.match(legacy, /GROWS BY APPENDING/);
  assert.match(legacy, /keeping its "qid" field byte-identical/);
  assert.match(legacy, /never re-emit the band whole/);
  assert.doesNotMatch(legacy, /re-emit the COMPLETE updated \S+ digest .* AND your \S+ band artifact/,
    "the self-contradictory band re-emission is gone");
});

// — THE EXEMPTION'S PURPOSE SURVIVES AND ITS MECHANISM MOVED, which is a different
// thing from the exemption being retired. It existed because a FRESH session dispatched after a warm
// resume died at the hard wall has no context to patch FROM, and the artifact on disk may be kill-torn —
// so the digest had to be re-emitted whole rather than edited. Both halves still hold, and neither is a
// dictation any more: `record_unit_note` renders the note WHOLE on every accepted call, so a torn note is
// repaired by the next call by construction, and there is no patch instruction to be exempt from. The BAND
// half of the legacy lane is untouched — that file is still the seat's on that lane, and it still appends.
test("frame-reopen COLD retry orders the note CALL, and the kill-torn reasoning is still stated", () => {
  for (const lane of [false, true]) {
    const m = buildFrameReopenRetryMessage({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 90, supplementalLane: lane });
    ordersTheCall(m, UNIT, `cold retry (lane=${lane})`);
    // WHY the session is fresh at all, restated as an assertion so the reasoning is not folklore.
    assert.match(m, /TIMED OUT at the hard wall, so start clean/);
    assert.match(m, /kill-torn|re-renders it whole|renders \S+ from your call/,
      `cold retry (lane=${lane}) — says why a torn artifact needs no repair from the seat`);
  }
  // The LEGACY lane still owns its band, and the append order there is untouched by the note conversion.
  const legacy = buildFrameReopenRetryMessage({ paths: P, axis: AXIS, directives: DIRECTIVES, reopenFetchCap: 90, supplementalLane: false });
  assert.match(legacy, /APPEND each result as a block/, "the legacy lane's band order is not the note's");
  // and the source says the same thing to the next reader, so a consistency sweep does not "fix" it
  const t = src("stages.mjs");
  const why = t.split("export function buildFrameReopenRetryMessage")[0].split("// Frame-reopen, FRESH scoped retry")[1];
  assert.match(why, /kill-torn/);
});

// 2 -> 0. Both occurrences were the cold retry's note re-emission, and the note is
// a call now. THE ARM KEEPS ITS SHAPE rather than becoming `assert.equal(total, 0)`, because a count pinned
// at zero is true by construction and would go green over a tree where the wording came back somewhere
// worse. What it asserts is the CONTAINMENT — wherever the phrase appears, it is inside the one builder
// entitled to it — which is a statement that can still fail, and the count is reported beside it so a
// reappearance is visible rather than merely permitted.
test("stages.mjs holds the full-write wording ONLY inside the cold-retry builder", () => {
  const t = src("stages.mjs");
  const total = [...t.matchAll(/full file, not a diff/g)].length;
  const cold = t.split("export function buildFrameReopenRetryMessage")[1].split("// ---- operability helpers")[0];
  const inside = [...cold.matchAll(/full file, not a diff/g)].length;
  assert.equal(inside, total,
    `${total} full-write order(s) in stages.mjs and ${inside} of them inside the cold-retry builder — the `
    + "phrase reached a builder that is not entitled to it. The count is 0 today: the note conversion took "
    + "both of the cold retry's, because the driver renders that file whole on every accepted call.");
});

// ── pipeline.mjs: the inline followups, checked at the source ─────────────────────────────────────────
// ── THE COMPOSED TEXT, NOT A SOURCE WINDOW ──────────────────────────────────────────────────
//
// `CONVERTED` and `GRID_SCOPED` are GONE. They were two hand-maintained lists of regex anchors over
// pipeline.mjs source — the second-list problem this issue exists to abolish. They had to be edited by
// hand every time a conversion moved a site: conversion 2 moved matter-frame's entry out of one of them,
// and a list that must be edited to stay true is a list that goes stale between edits.
//
// Every assertion below now runs over the text `driver/repair-composers.mjs` COMPOSES, which is derived
// and strictly stronger. A source window can be satisfied by a sentence that never reaches a seat; the
// composed text is what a seat is handed.

/** Every registered composer × every sample, composed. */
const composedSamples = () =>
  REPAIR_COMPOSERS.flatMap((c) => c.samples.map((s) => ({ key: c.key, name: s.name, tail: s.tail, text: c.compose(s.args) })));

const EDIT_TAIL = /Apply the fix by TARGETED EDITS to .+ using the Edit tool/;

test("a composer's declared tail matches the text it composes — in BOTH directions", () => {
  const all = composedSamples();
  // FLOOR. A walk that stopped finding composers would assert nothing and read as a pass — the absence
  // that reads as a green tick, in the check whose whole job is to stop exactly that.
  assert.ok(all.length >= 30, `only ${all.length} composed sample(s) — the registry walk has gone stale`);

  let edits = 0, refusals = 0;
  for (const s of all) {
    if (s.tail === "edit") { edits++; assert.match(s.text, EDIT_TAIL, `${s.key} / ${s.name} — declares the shared repair tail and does not compose one`); }
    if (s.tail === "tool" || s.tail === "none") {
      refusals++;
      assert.doesNotMatch(s.text, EDIT_TAIL,
        `${s.key} / ${s.name} — declares "${s.tail}" and hands over the Edit tool anyway. That is the two-halves-`
        + `disagreeing shape #460 closed: a file-edit affordance in a message whose stage cannot write the file.`);
    }
  }
  // BOTH ARMS MUST BE POPULATED, or one of them is asserted against nothing and passes vacuously.
  // FLOOR LOWERED BY ONE AT CONVERSION 11, deliberately and in the same commit: register-digest's
  // late-bind sample moved from `edit` to `tool` when the findings document became the driver's. The
  // floor exists so this arm cannot go vacuous, so it tracks the population rather than holding a number
  // the population has left — but it is lowered by the ONE row that moved, never re-derived from the
  // current count, which would ratify any future silent drop.
  assert.ok(edits >= 7, `only ${edits} sample(s) declare the edit tail`);
  assert.ok(refusals >= 4, `only ${refusals} sample(s) declare tool/none`);
});

test("the connotation remedy orders the TOOL and carries NO repair tail", () => {
  const e = REPAIR_COMPOSERS.find((c) => c.key === "common-law-half:connotation-remedy");
  assert.ok(e, "the remedy is registered");
  const text = e.compose(e.samples[0].args);
  assert.match(text, /record_dispositions/, "the followup names the one route a ruling can take");
  assert.doesNotMatch(text, EDIT_TAIL, "a file-edit tail on a tool-call remedy is the shape #460 closed");
});

test("the intake-asks remedy orders the TOOL and carries NO repair tail", () => {
  // The matter-frame twin, and the composer whose defect was CONFIRMED — it ordered an Edit on an
  // artifact whose only writer is the driver, on a stage whose grant no longer carries `Edit`, and the
  // guard reported the stage clean in all three directions while that order stood.
  const e = REPAIR_COMPOSERS.find((c) => c.key === "matter-frame:intake-asks-followup");
  assert.ok(e, "the remedy is registered");
  const text = e.compose(e.samples[0].args);
  assert.match(text, /record_matter_frame/, "the followup names the one route the asks can take");
  assert.match(text, /intake_asks/, "…and the field that carries them");
  assert.doesNotMatch(text, EDIT_TAIL, "a file-edit tail on a tool-call remedy is the shape #460 closed");
});

test("a composer that names a tool-owned ledger scopes the Edit direction BEFORE handing over the Edit tool", () => {
  // The hazard the conversion bought, now derived instead of anchored. A common-law followup forbids the
  // model from touching the machine grid ledger, which the plugin owns — and the repair tail is the first
  // thing in the message to hand over the Edit tool. An unscoped "use the Edit tool" beside a named ledger
  // path is an invitation to edit it, and a hand-edited ledger is grid_ledger_unparseable / grid_join_missing.
  const LEDGER = /machine ledger|ledgers the tool wrote|grid-ledger/;
  let scoped = 0;
  for (const s of composedSamples()) {
    if (!LEDGER.test(s.text) || !EDIT_TAIL.test(s.text)) continue;
    scoped++;
    const scope = s.text.search(/The edit direction below covers/);
    const tailAt = s.text.search(EDIT_TAIL);
    assert.ok(scope >= 0, `${s.key} / ${s.name} — names a tool-owned ledger and offers the Edit tool with no scoping sentence`);
    assert.ok(scope < tailAt, `${s.key} / ${s.name} — the scope must be read BEFORE the direction it qualifies`);
  }
  assert.equal(scoped, 4, `${scoped} composer(s) exercised this — the single-member and split-half arms of both lanes are four`);
});

test("the report-card lint repair is a COLD re-render and keeps its full write — patching it would defeat it", () => {
  // Found by the anchor above matching two sites, which is the useful shape of a source scan: this one
  // reads almost identically to the redo() ladder and is the opposite case. The card is dispatched FRESH
  // with `extra` riding the stage's own write mandate, precisely so a provenance bleed cannot survive in
  // context — a targeted edit of the contaminated card would preserve what the re-render exists to discard.
  const t = src("pipeline.mjs");
  const site = t.split("Fix ONLY what the checks name; change nothing else about the card.")[0].slice(-1600);
  assert.match(site, /The card is re-rendered FRESH/);
  assert.match(site, /this stays a FULL WRITE, and not by omission/);
  assert.match(site, /patching the bad card would\s*\n\s*\/\/\s*preserve exactly what the re-render exists to discard/);
  assert.doesNotMatch(t.split("change nothing else about the card.")[1].slice(0, 300), /editRepairTail\(/,
    "no repair tail was bolted onto the cold re-render");
});

test("no composer carries a whole-file re-emission order except the two that explain themselves", () => {
  // RE-POINTED FROM pipeline.mjs SOURCE TO THE COMPOSED TEXT. The prompts moved into the registry,
  // and a scan of the file they left would go quiet — passing because it had nothing to read, which is the
  // absence-as-green-tick this file exists to refuse. Scanning the composed text also makes the exceptions
  // EXPLICIT: the cold-retry builder's full write used to be "somewhere else in the tree", and is now a
  // named exception with its reason beside it.
  const all = composedSamples();
  assert.ok(all.length >= 30, `only ${all.length} composed sample(s) — the walk has gone stale`);

  // (a) the full-file order. Its ONE legitimate home is the cold retry: a session with no context has
  // nothing to patch, so a targeted-edit order there would be an instruction to edit from memory.
  //
  // EMPTY SINCE, and the emptiness is not what makes this pass. The assertion runs over
  // the 30+ composed samples above, so it fails the moment any composer starts ordering a full-file write
  // — which is the property, and it is unaffected by the population happening to be zero right now. The
  // last holder was the cold retry, and it left because the note it re-emitted is rendered by the driver
  // whole on every accepted call: the guarantee the order existed to give is now structural.
  const fullWrite = all.filter((s) => /full file, not a diff/.test(s.text));
  assert.deepEqual([...new Set(fullWrite.map((s) => s.key))], [],
    "a composer ordered a full-file write. The cold retry's was the last one and it is a call now; if a "
    + "new one is legitimate, name it here with its reason beside it rather than widening the list.");

  // (b) the full RE-EMISSION. Exactly one, and it is the schema migration — a migration rewrites every
  // rated object's vocabulary and deletes retired keys, so there is no small set of named lines to patch.
  //
  // TWO, AND THE SECOND ONE IS WHAT THE RE-POINTING FOUND. The old assertion read pipeline.mjs and
  // said "exactly one". That was true of pipeline.mjs and false of the tree: the cold-retry builder in
  // stages.mjs carries a re-emission too, and the source-scoped check could never see it. Both are
  // legitimate and both are named here, which is the difference between a scan that was scoped and a
  // scan that is complete.
  //
  // BACK TO ONE, and by the opposite route to the one that made it two. It became two
  // when the scan was re-pointed from a source window to the composed text and FOUND the cold retry's; it
  // is one again because that re-emission is gone, not because anything stopped looking. The schema
  // migration keeps its own: a migration rewrites every rated object's vocabulary and deletes retired keys,
  // so there is no small set of named lines to patch.
  const reemit = all.filter((s) => /Re-emit the COMPLETE/i.test(s.text));
  assert.deepEqual([...new Set(reemit.map((s) => s.key))].sort(),
    ["synthesis:schema-downlevel"],
    "a full re-emission may reach a seat only from the schema migration");
  assert.match(reemit.find((s) => s.key === "synthesis:schema-downlevel").text, /at schema_version 4/);
});


test("the document-growth tripwire now reads a repair-shaped trip as a regression alarm", () => {
  const t = src("pipeline.mjs");
  const comment = t.split("// PR-4 — document-growth tripwire")[1].split("if (r.ok && out && priorSize")[0];
  assert.match(comment, /a regression to alarm on, not the known noise it used to be/);
  assert.match(comment, /leave every other line byte-identical/, "it says WHY a trip means the direction was ignored");
  // …and it does not overclaim: the triggers that legitimately ADD rows are named as the exception, or the
  // comment is wrong the first time a wide channel sweep trips it.
  assert.match(comment, /coverage-closure and the frame-reopen source sweep/);
  // the tripwire ITSELF is untouched — thresholds and posture are not part of this change
  const code = t.split("if (r.ok && out && priorSize")[1].slice(0, 700);
  assert.match(code, /growthBytes > 20 \* 1024 \|\| growthPct > 35/);
  assert.match(code, /never withheld/);
});
