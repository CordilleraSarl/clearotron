// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CONVERSION 2 — the matter frame becomes a typed call, and the driver's render has to keep SIX PARSERS
// and TWELVE READER STAGES working.
//
// ── WHY THIS FILE IS SHAPED AROUND THE CONSUMERS RATHER THAN THE RENDERER ───────────────────────────
//
// `matter-context.md` is the widest-read artifact in a run. Asserting that the render matches a golden
// string would pin the renderer to itself and prove nothing about the things that read it — and every
// one of those readers anchors on a regex that lives in ANOTHER file and can move without this one
// noticing. So the arms below call THE SHIPPED PARSERS and assert on what they return. If a consumer's
// regex changes, this file goes red where the change lands, not months later in a round.
//
// The consumers, and the fact each one would silently lose:
//   channelsDiagnosis           the common-law grid falls back to the profile default, reading as "the
//                               frame named no channels" when the frame named six
//   meaningAnglesFromMatterContext  the meaning sweep reverts to its fixed floor
//   parseIntakeAsks             an intake ask evaporates between intake and output (the VENZY miss)
//   validators.matterContext    scope drift stops being detectable
//   anchor-reader               sector/industry/jurisdiction anchors go unfound
//   findSeedNeutralityViolations (S2)  the seed-neutrality tripwire has nothing to scan
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import {
  acceptMatterFrame, renderMatterFrame, recordMatterFrame, matterFrameWasRecorded,
  matterFrameCallPaths, MATTER_CONTEXT_FILE, SCOPE_BASES, INTAKE_ASK_OWNERS,
  mergeMatterFrameCall, frameIdentifiedClasses,
} from "../matter-frame-record.mjs";
import { channelsDiagnosis, channelsFromMatterContext } from "../scope-ledger.mjs";
import { meaningAnglesFromMatterContext } from "../connotation-search.mjs";
import { parseIntakeAsks } from "../pipeline.mjs";
import { findSeedNeutralityViolations } from "../reasoning-tripwires.mjs";
import { validators } from "../verify.mjs";

const SCOPE = Object.freeze({
  marks: ["PROJECT NOVAPULSE"], classes: ["9", "41"],
  jurisdictions: ["EU", "US"], goods: "downloadable game software", customer: "ACME Interactive",
});

const PROSE = [
  "Client: ACME Interactive, a mid-size games studio.",
  "Sector: downloadable game software and live-service play.",
  "Customer base: consumer players in the EU and US; no enterprise channel.",
  "Channels of trade: digital storefronts and the studio's own site.",
  "Off-field sectors: fintech (the in-game wallet is incidental, not a financial product).",
  "Sector-convergence flags: none material this quarter.",
  "Watchlist-owner seeds: BigCo Interactive, Northwind Games.",
  "Scope reasoning: search wide across the majors, cite narrow to the instructed pair.",
].join("\n");

const PARAMS = Object.freeze({
  prose_body: PROSE,
  scope_basis: "instructed",
  scope_jurisdictions: ["EU", "US", "NZ"],
  excluded_jurisdictions: ["CN"],
  search_channels: ["amazon.com", "apps.apple.com", "play.google.com"],
  meaning_angles: ["novapulse cultural appropriation", "novapulse slang meaning"],
  meaning_angles_none: false,
  intake_asks: [{ ask: "Check descriptiveness in the US.", owner: "synthesis" }],
});

const accepted = (over = {}) => {
  const v = acceptMatterFrame({ ...PARAMS, ...over }, { instructedScope: SCOPE });
  assert.equal(v.ok, true, `expected an accepted call: ${v.reason}`);
  return v;
};

function runDir() {
  const d = mkdtempSync(join(tmpdir(), "ct-matterframe-"));
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(driverDir(d, "instructed-scope.json"), JSON.stringify(SCOPE));
  return d;
}

// ── THE ARM THAT MATTERS: the six consumers, against the driver's render ────────────────────────────

test("conversion 2 — every consumer of matter-context.md reads the DRIVER's render correctly", () => {
  const md = accepted().content;

  const chan = channelsDiagnosis(md);
  assert.equal(chan.state, "named", "the common-law grid must see a named channel set, not a fallback");
  assert.deepEqual(chan.channels, ["amazon.com", "apps.apple.com", "play.google.com"]);
  assert.deepEqual(channelsFromMatterContext(md), chan.channels);

  assert.deepEqual(meaningAnglesFromMatterContext(md),
    ["novapulse cultural appropriation", "novapulse slang meaning"],
    "the meaning sweep appends these VERBATIM; a parse miss reverts it to the fixed floor with no error");

  assert.deepEqual(parseIntakeAsks(md), [{ ask: "Check descriptiveness in the US.", owner: "synthesis" }]);

  // S2 scans the text for seed neutrality. It must have real text to scan — a render that dropped the
  // prose body would leave the tripwire looking at machine lines and finding nothing, which reads clean.
  assert.doesNotThrow(() => findSeedNeutralityViolations([{ name: "matter-context", text: md }]));
  assert.ok(md.includes("Watchlist-owner seeds: BigCo Interactive, Northwind Games."),
    "the seed line the S2 scan is about must survive the render verbatim");

  // Every instructed value must appear, because that is what the scope bind has always meant — and the
  // driver now stamps them rather than asking the seat to retype them.
  for (const v of ["PROJECT NOVAPULSE", "9", "41", "EU", "US", "downloadable game software"])
    assert.ok(md.replace(/\s+/g, " ").includes(v), `the stamped scope must carry ${v}`);
});

test("conversion 2 — an asserted `none` is a different fact from an unanswered frame", () => {
  const md = accepted({ meaning_angles: [], meaning_angles_none: true }).content;
  assert.deepEqual(meaningAnglesFromMatterContext(md), [],
    "an asserted none parses as no angles — the coined-mark case, and a valid one");
  assert.match(md, /^Meaning angles: none$/m,
    "and it renders the explicit form the dictation used, so an archived reader sees the same sentence");

  // The refusals that make the assertion mean something. Neither of these could be expressed before: the
  // dictation could only catch a MISSING line, after the file was already on disk.
  const neither = acceptMatterFrame({ ...PARAMS, meaning_angles: [], meaning_angles_none: false }, { instructedScope: SCOPE });
  assert.equal(neither.ok, false);
  assert.match(neither.reason, /^matterframe_meaning_angles_missing/);
  const both = acceptMatterFrame({ ...PARAMS, meaning_angles_none: true }, { instructedScope: SCOPE });
  assert.equal(both.ok, false);
  assert.match(both.reason, /^matterframe_meaning_angles_contradictory/);
});

test("conversion 2 — an empty channel list is `all-rejected`, not `no-line`", () => {
  // The line is rendered even when the array is empty, ON PURPOSE. channelsDiagnosis distinguishes four
  // states and two of them are "the seat answered with nothing" versus "the seat never answered".
  // Omitting the line would report the second on a frame that did the first.
  const md = accepted({ search_channels: [] }).content;
  assert.equal(channelsDiagnosis(md).state, "all-rejected");
  assert.notEqual(channelsDiagnosis(md).state, "no-line");
});

test("conversion 2 — no intake asks renders the dictated `none stated`, and parses as an empty list", () => {
  const md = accepted({ intake_asks: [] }).content;
  assert.deepEqual(parseIntakeAsks(md), [],
    "an EMPTY list is the answer 'the requester asked for nothing in particular' — and it must not read as "
    + "the section being absent, which is what triggers the followup re-dispatch");
  assert.notEqual(parseIntakeAsks(md), null);
});

// ── THE REFUSALS ────────────────────────────────────────────────────────────────────────────────────

test("conversion 2 — the transport refuses what the dictation could only catch afterwards", () => {
  const bad = (over, token) => {
    const v = acceptMatterFrame({ ...PARAMS, ...over }, { instructedScope: SCOPE });
    assert.equal(v.ok, false, `expected a refusal for ${token}`);
    assert.match(v.reason, new RegExp(`^${token}`));
  };
  bad({ prose_body: "" }, "matterframe_prose_missing");
  bad({ prose_body: "too short" }, "matterframe_prose_too_short");
  bad({ scope_basis: "guessed" }, "matterframe_scope_basis_invalid");
  bad({ intake_asks: [{ ask: "x", owner: "marketing" }] }, "matterframe_intake_ask_owner_invalid");
  bad({ intake_asks: [{ ask: "", owner: "register" }] }, "matterframe_intake_ask_empty");
  // A quote inside an ask would close the rendered `- ask: "…"` early and parseIntakeAsks would read a
  // TRUNCATED ask. Refused rather than escaped: the requester's words are evidence.
  bad({ intake_asks: [{ ask: 'check the "house mark" angle', owner: "synthesis" }] }, "matterframe_intake_ask_quote");
});

test("conversion 2 — the doctrine's own vocabularies, not a tidier one", () => {
  // `worldwide` is a live value elsewhere in the driver (register-plan stamps it, scope-facts reads it to
  // decide the "registers: worldwide" coverage tail). A two-value enum would have made it unsendable.
  assert.deepEqual([...SCOPE_BASES], ["instructed", "worldwide", "inferred"]);
  assert.deepEqual([...INTAKE_ASK_OWNERS], ["common-law", "register", "synthesis"]);
  for (const basis of SCOPE_BASES) assert.equal(acceptMatterFrame({ ...PARAMS, scope_basis: basis }, { instructedScope: SCOPE }).ok, true);
});

// ── THE TRANSPORT, END TO END ───────────────────────────────────────────────────────────────────────

test("conversion 2 — the driver writes the frame and the capture proves the transport was taken", () => {
  const dir = runDir();
  assert.equal(matterFrameWasRecorded(dir), false, "no call yet — and that is the discriminator's zero");

  const r = recordMatterFrame(dir, PARAMS);
  assert.equal(r.refused, null, `unexpected refusal: ${r.refused}`);
  assert.equal(r.written, join(dir, MATTER_CONTEXT_FILE));
  assert.equal(r.instructed_scope_stamped, true, "the driver had an intake record and must have used it");
  assert.equal(matterFrameWasRecorded(dir), true);

  const md = readFileSync(join(dir, MATTER_CONTEXT_FILE), "utf8");
  assert.deepEqual(channelsFromMatterContext(md), PARAMS.search_channels, "the FILE, not just the render");
  assert.equal(validators.matterContext(join(dir, MATTER_CONTEXT_FILE), md).ok, true);
});

test("conversion 2 — a REFUSED call still leaves the capture, and writes no frame", () => {
  const dir = runDir();
  const r = recordMatterFrame(dir, { ...PARAMS, prose_body: "" });
  assert.match(String(r.refused), /^matterframe_prose_missing/);
  assert.equal(r.written, null, "a refused frame must not reach disk");
  assert.equal(matterFrameWasRecorded(dir), true,
    "the capture exists even for a refusal — that is WHY it is the discriminator: it answers 'was the "
    + "typed transport taken', not 'did the frame come out well'");
  const capture = JSON.parse(readFileSync(matterFrameCallPaths(dir).payload, "utf8"));
  assert.equal(capture.params.prose_body, "", "the capture records what ARRIVED, untidied");
});

// ── THE TWO GUARD RULINGS (owner, 2026-08-17): stated per token, and pinned ─────────────────────────

test("conversion 2 — `frame_scope_missing` is RE-POINTED at the stamp, and can still fail", () => {
  const dir = runDir();
  recordMatterFrame(dir, PARAMS);
  const at = join(dir, MATTER_CONTEXT_FILE);

  assert.equal(validators.matterContext(at, readFileSync(at, "utf8")).ok, true);

  // THE FAILURE IT NOW NAMES, and it is a DRIVER fault rather than a seat one: the intake record is on
  // disk and the render carries no stamp. Before the conversion this token caught a seat paraphrasing the
  // scope; that defect is gone because the seat no longer types it. This one is reachable and was not.
  const unstamped = readFileSync(at, "utf8").replace(/^## Instructed scope$/m, "## Scope (unstamped)");
  const v = validators.matterContext(at, unstamped);
  assert.equal(v.ok, false, "a recorded frame with no stamped section must fail — the guard is not decorative");
  assert.match(v.reason, /^frame_scope_missing:stamp/);
});

test("conversion 2 — `meaning_angles_missing` stays live for a DICTATED frame, and is unreachable for a recorded one", () => {
  // An archived, hand-written frame: no call capture in the run dir. The old rules apply to it in full —
  // this is trap 6, a new way in and never a replacement.
  const dir = mkdtempSync(join(tmpdir(), "ct-matterframe-archive-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "stage-contracts.json"), JSON.stringify({ "matter-frame": { meaningAngles: 1 } }));
  const at = join(dir, MATTER_CONTEXT_FILE);
  const legacy = "# Matter context\n\nClient: ACME. Sector: gaming. Jurisdictions: EU.\n"
    + "material sector client jurisdic\n".repeat(8);
  writeFileSync(at, legacy);
  assert.equal(matterFrameWasRecorded(dir), false, "the fixture must be on the DICTATED path or it proves nothing");
  const v = validators.matterContext(at, legacy);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "meaning_angles_missing",
    "an archived frame minted under the meaning-angles prompt is still held to it");

  // And the recorded path cannot produce that state at all: the transport refuses the call, so no frame
  // exists to validate. The guard is not left standing green over the new path — it is unreachable there.
  const fresh = runDir();
  const refused = recordMatterFrame(fresh, { ...PARAMS, meaning_angles: [], meaning_angles_none: false });
  assert.match(String(refused.refused), /^matterframe_meaning_angles_missing/);
  assert.equal(refused.written, null);
});

test("conversion 2 — with no intake record the stamp says `none given` rather than inventing one", () => {
  const dir = mkdtempSync(join(tmpdir(), "ct-matterframe-noscope-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const r = recordMatterFrame(dir, PARAMS);
  assert.equal(r.refused, null, "a legacy/replay run with no receipt must still be able to record a frame");
  assert.equal(r.instructed_scope_stamped, false, "and it must SAY the stamp did not happen");
  assert.match(readFileSync(join(dir, MATTER_CONTEXT_FILE), "utf8"), /- \*\*Mark\(s\):\*\* none given/);
});

test("conversion 2 — the render is a projection of the model, and the prose body is untouched", () => {
  const v = accepted();
  assert.equal(renderMatterFrame(v.model), v.content, "content must be the render of the parsed model");
  assert.ok(v.content.includes(PROSE),
    "the seat's judgment prose rides VERBATIM — reflowing text that S2 scans and twelve seats read would "
    + "be the driver editing legal reasoning to fit a renderer");
});

// ── CLASSES THE FRAME JUDGED NECESSARY BEYOND THE INSTRUCTED ONES ───────────────────────────────────
//
// The frame reads the description of use and can conclude a class nobody instructed is in scope. It has
// always said so in its prose and nothing could act on it: the plan compile takes its classes from the
// driver's intake record, so an identified class reached the sweep only if something proposed it as
// supplemental work, competing for capped slots with model-minted extras. A cap decided coverage the
// frame had already judged necessary.
//
// TYPED RATHER THAN PARSED. Deriving classes from judgment prose is ruled against with measurement —
// 19 of 21 runs carry the same class in both an applied and a dropped row, and deriving there dropped
// the primary class. These arms drive the field, not a parser.

test("the frame's identified classes are accepted with a reason each, and normalised", () => {
  const v = accepted({ identified_classes: [
    { class: "9", reason: "the software the goods run on" },
    { class: 42, reason: "the hosted service the client sells" },
  ] });
  assert.deepEqual(v.model.identified_classes, [
    { class: "9", reason: "the software the goods run on" },
    { class: "42", reason: "the hosted service the client sells" },
  ], "a number and a string both land as the same string form");
});

test("an identified class without a reason is refused, because it widens what the client is charged to search", () => {
  const v = acceptMatterFrame({ ...PARAMS, identified_classes: [{ class: "9" }] }, { instructedScope: SCOPE });
  assert.equal(v.ok, false);
  assert.match(v.reason, /^matterframe_identified_class_reason_missing:9/);
});

test("a class outside 1-45, a non-number and a duplicate are each refused, and differently", () => {
  const refuse = (rows) => acceptMatterFrame({ ...PARAMS, identified_classes: rows }, { instructedScope: SCOPE });
  const zero = refuse([{ class: "0", reason: "x" }]);
  const high = refuse([{ class: "46", reason: "x" }]);
  const word = refuse([{ class: "nine", reason: "x" }]);
  const dupe = refuse([{ class: "9", reason: "a" }, { class: "9", reason: "b" }]);
  for (const [name, v] of [["0", zero], ["46", high], ["nine", word], ["duplicate", dupe]])
    assert.equal(v.ok, false, `${name} was accepted`);
  // THE REFUSALS MUST BE DISTINGUISHABLE, or this arm asserts one thing four times and a ladder cannot
  // tell a reader which mistake they made.
  assert.match(dupe.reason, /^matterframe_identified_class_duplicate:9/);
  for (const v of [zero, high, word]) assert.match(v.reason, /^matterframe_identified_class_invalid:/);
  assert.equal(new Set([zero, high, word, dupe].map((v) => v.reason)).size, 4, "four mistakes, four sentences");
});

test("ABSENT AND EMPTY CHANGE NOTHING — the ruling's own condition", () => {
  // The field is optional by design: a frame that identifies nothing is the ordinary case. Both forms
  // must produce the same model and the same document as a frame that never heard of the field, or this
  // lands as a silent behaviour change on every run that does not use it.
  const absent = accepted({});
  const empty = accepted({ identified_classes: [] });
  assert.deepEqual(absent.model.identified_classes, []);
  assert.deepEqual(empty.model.identified_classes, []);
  assert.equal(absent.content, empty.content, "an empty list renders exactly as an absent field");
  assert.ok(!absent.content.includes("identified by the frame"),
    "a frame that identified nothing must not render a row saying so");
});

test("the rendered frame says which classes were added and why, as their own rows", () => {
  const v = accepted({ identified_classes: [{ class: "9", reason: "the software the goods run on" }] });
  const rows = v.content.split("\n").filter((l) => l.includes("identified by the frame"));
  assert.equal(rows.length, 1, "one row per identified class");
  assert.match(rows[0], /Class 9/);
  assert.match(rows[0], /the software the goods run on/, "the frame's own sentence, not a paraphrase");
  // AND IT IS NOT FOLDED INTO THE INSTRUCTED SCOPE, which is a different claim: that section is what the
  // client asked for, quoted from the driver's record; this is what the frame concluded as well.
  const instructed = v.content.slice(0, v.content.indexOf("## The matter"));
  assert.ok(!instructed.includes("identified by the frame"),
    "an instruction and a judgement must not render in the same block");
});

test("a partial repair that omits the field KEEPS it — dropping it would narrow the next compile", () => {
  // The merge rule, and the reason it is keep-if-absent rather than replace. The plan compile unions
  // these into every variant axis, so a repair call that simply did not mention them would narrow the
  // search silently, in the direction that misses rights.
  const first = accepted({ identified_classes: [{ class: "9", reason: "the software the goods run on" }] });
  const merged = mergeMatterFrameCall(first.model, { prose_body: PROSE });
  assert.deepEqual(merged.identified_classes, first.model.identified_classes,
    "a repair that omits the field must not withdraw the classes");
});

test("the compile reads the identified classes off the run, and an absent frame is empty rather than a throw", () => {
  // THE HALF THAT CHANGES THE SEARCH. Everything above is about the document; this is the value the plan
  // compile unions into every variant axis, so its failure mode is a narrower sweep rather than a
  // quieter frame.
  const runDir = mkdtempSync(join(tmpdir(), "frame-classes-"));

  // A run with no frame at all — the ordinary state before the stage has run, and every legacy or
  // replayed run whose accepted call predates the field. Empty, never a throw: a compile that threw here
  // would fail a run for the absence of an optional judgement.
  assert.deepEqual(frameIdentifiedClasses(runDir), [], "no frame yet must read as no classes");
  assert.deepEqual(frameIdentifiedClasses(join(runDir, "nope")), [], "an unreadable run dir too");

  recordMatterFrame(runDir, { ...PARAMS, identified_classes: [
    { class: "9", reason: "the software the goods run on" },
    { class: "42", reason: "the hosted service" },
  ] }, { instructedScope: SCOPE });
  assert.deepEqual(frameIdentifiedClasses(runDir), ["9", "42"],
    "the numbers the compile unions, as strings, in the order the frame gave them");

  // AND A RECORDED FRAME THAT IDENTIFIED NOTHING STILL READS EMPTY, so the union is a no-op rather than
  // an undefined that spreads into the class list as a hole.
  const bare = mkdtempSync(join(tmpdir(), "frame-classes-bare-"));
  recordMatterFrame(bare, PARAMS, { instructedScope: SCOPE });
  assert.deepEqual(frameIdentifiedClasses(bare), []);
});

test("the plan compile actually calls it — the wiring, not the helper", () => {
  // An exported function nothing calls reads as done. This pins the one call site: the register-plan
  // compile's own job.classes, unioned with the instructed list. Asserted on the source because the
  // compile happens inside a stage this file cannot run.
  const pipeline = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const line = pipeline.split("\n").find((l) => l.includes("jobKey: ctx.run.slug") && l.includes("classes:"));
  assert.ok(line, "the register-plan compile's job line could not be found — this arm cannot look");
  assert.match(line, /frameIdentifiedClasses\(/, "the compile does not union the frame's identified classes");
  assert.match(line, /inScopeClassList\(/, "and it must still carry the instructed ones");
});
