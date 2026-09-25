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
  mergeMatterFrameCall, frameIdentifiedClasses, MEANING_ANGLE_MAX_CHARS,
} from "../matter-frame-record.mjs";
import { channelsDiagnosis, channelsFromMatterContext } from "../scope-ledger.mjs";
import { meaningAnglesFromMatterContext, meaningAnglesAssertedNone } from "../connotation-search.mjs";
import { parseIntakeAsks } from "../pipeline.mjs";
import { findSeedNeutralityViolations } from "../reasoning-tripwires.mjs";
import { validators } from "../verify.mjs";
import { fileURLToPath } from "node:url";

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
  // Only the rendered `none` is the frame's decision; a frame with no line at all has made none.
  assert.equal(meaningAnglesAssertedNone(md), true);
  assert.equal(meaningAnglesAssertedNone("## The matter\n\nA games-kit maker.\n"), false);
});

test("a meaning question the web cannot run as written is refused at the tool, where the frame can rewrite it", () => {
  const at = (meaning_angles) => acceptMatterFrame({ ...PARAMS, meaning_angles }, { instructedScope: SCOPE });
  const long = at(["novapulse slang meaning", "n".repeat(MEANING_ANGLE_MAX_CHARS + 1)]);
  assert.equal(long.ok, false);
  assert.match(long.reason, /^matterframe_meaning_angle_unusable: 1 angle\(s\)/);
  assert.match(at(["\"", "novapulse slang meaning"]).reason, /^matterframe_meaning_angle_unusable/, "a question with no word in it was accepted");
  const edge = "n".repeat(MEANING_ANGLE_MAX_CHARS);
  assert.equal(at([edge]).ok, true);
  // What the tool accepts, the reader keeps: no question it recorded is dropped on the way to the web.
  assert.deepEqual(meaningAnglesFromMatterContext(accepted({ meaning_angles: [edge] }).content), [edge]);
  assert.deepEqual(meaningAnglesFromMatterContext(`Meaning angles: ${"y".repeat(120)}`), ["y".repeat(120)],
    "an older frame's long question was dropped unseen instead of run as written");
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
    "the numbers the house-element check unions, as strings, in the order the frame gave them");

  // AND A RECORDED FRAME THAT IDENTIFIED NOTHING STILL READS EMPTY, so the union is a no-op rather than
  // an undefined that spreads into the class list as a hole.
  const bare = mkdtempSync(join(tmpdir(), "frame-classes-bare-"));
  recordMatterFrame(bare, PARAMS, { instructedScope: SCOPE });
  assert.deepEqual(frameIdentifiedClasses(bare), []);
});

test("the plan compile actually calls it — the wiring, not the helper", () => {
  // An exported function nothing calls reads as done. This pins the one call site. Asserted on the
  // source because the compile happens inside a stage this file cannot run.
  //
  // REPOINTED FOR DECISION 18. This used to require the job line to UNION the frame's classes into
  // `classes:`, which is exactly what the bound removed: unioning put every added class on every entry,
  // where an added class is now one identical-mark question. So the instructed list stays the plan's
  // class scope, and the frame's rows — with their reasons, which the union threw away — arrive beside
  // it as `addedClasses`. The arm still answers the same question: is the reader wired in at all.
  const pipeline = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const lines = pipeline.split("\n");
  const i = lines.findIndex((l) => l.includes("jobKey: ctx.run.slug") && l.includes("classes:"));
  assert.ok(i >= 0, "the register-plan compile's job line could not be found — this arm cannot look");
  assert.match(lines[i], /inScopeClassList\(/, "the compile must carry the instructed classes");
  assert.doesNotMatch(lines[i], /frameIdentifiedClasses\(/,
    "the compile still unions the frame's classes into the plan's scope — an added class costs one question, not every entry");
  const near = lines.slice(i, i + 3).join("\n");
  assert.match(near, /addedClasses:\s*frameIdentifiedClassRows\(/,
    "the frame's added classes never reach the compile, so a class the frame added is never searched");
});


// ── THE CLIENT'S OWN HOUSE ELEMENT — PROPOSED HERE, VERIFIED ELSEWHERE ───────────────────────────
//
// The 2026-09-16 production run: the mark was the client's own famous house mark plus a tagline, the
// plan treated the house element as a conflict axis, and over half the band came from that element.
// The reviewing lawyer's method was three queries on the remainder. What the frame may do about that is
// PROPOSE; it cannot verify, because it runs before the plan and holds no band tool.
const { frameHouseElementCandidate } = await import("../matter-frame-record.mjs");

const HOUSE = Object.freeze({ element: "NOVAPULSE", remainder: "SOUND OF TOMORROW",
  owner_basis: "the client's own registered house mark, used in the instructed classes" });

// ── AND THE TOOL THE FRAME IS GIVEN OFFERS IT ──────────────────────────────────────────────────────
//
// For a beta the acceptor took this field and the plan acted on it, and no frame ever proposed one: the
// schema a model is SENT did not offer it, so a model following its schema had nothing to fill in.
// Measured on the published 0.3.2-beta.10 — none of 71 recorded frames carried one. This reads what the
// model is actually sent, by asking the recording server for its tool list, not what a source file says.
async function frameToolSchema() {
  const { spawn } = await import("node:child_process");
  const server = fileURLToPath(new URL("../engine/mcp/recording-server.mjs", import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("the recording server did not list its tools")); }, 15000);
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== 2) continue;
        clearTimeout(timer); child.kill("SIGKILL");
        resolve((m.result?.tools ?? []).find((t) => t.name === "record_matter_frame")?.inputSchema ?? null);
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
  });
}

test("the frame tool OFFERS the house-element proposal, and a proposal shaped by that schema alone is accepted", async () => {
  const schema = await frameToolSchema();
  assert.ok(schema, "the recording server lists no record_matter_frame — this arm cannot look");
  const h = schema.properties?.house_element_candidate;
  assert.ok(h, "record_matter_frame's schema does not offer house_element_candidate, so a model following it never proposes one");
  assert.deepEqual([...(h.required ?? [])].sort(), ["element", "owner_basis", "remainder"]);
  assert.deepEqual(Object.keys(h.properties ?? {}).sort(), ["element", "owner_basis", "remainder"],
    "the schema offers a different shape from the one the acceptor takes");
  assert.ok(!(schema.required ?? []).includes("house_element_candidate"),
    "the field is required, so every frame would name a house element — it is sent only when the client owns one");
  assert.match(h.description, /checked on the register, by owner, before anything is excluded/,
    "the model is no longer told a proposal is verified before anything is excluded");
  // THE SCHEMA AND THE ACCEPTOR AGREE: a proposal built from the offered keys and nothing else is taken.
  const proposal = Object.fromEntries(Object.keys(h.properties).map((k) => [k, HOUSE[k]]));
  const v = accepted({ house_element_candidate: proposal });
  assert.deepEqual(v.model.house_element_candidate, HOUSE, "a proposal shaped exactly as the schema offers it was not accepted");
});

// ── EVERY FIELD THE DISPATCH ASKS FOR HAS A SLOT ON THE TOOL, AND THE CLASSES REACH THE PLAN ─────────
//
// The house element above was the first field found asked for and accepted but not offered. Two more
// were the same: the dispatch told the frame to send `identified_classes` and `ratified_forms`, the
// acceptor validated and recorded both, the plan compile read the classes, and the tool the model hands
// the frame back through declared neither. A real run's frame carried no added class although its goods
// reached one. Each end had its test; nothing held the two ends to the tool between them.
const { STAGES, paths: stagePaths } = await import("../stages.mjs");
const { refuseUndeclared, frameIdentifiedClassRows } = await import("../matter-frame-record.mjs");
const { compileRegisterPlan, awaitsReadingTurn } = await import("../register-plan.mjs");
const { PROVIDER_CAPABILITIES } = await import("../register-capabilities.mjs");

/** A call through the recording server itself, as the model makes it, against a run of its own. */
async function callFrameTool(runDirPath, args) {
  const { spawn } = await import("node:child_process");
  const server = fileURLToPath(new URL("../engine/mcp/recording-server.mjs", import.meta.url));
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDirPath } });
    let buf = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("the recording server did not answer the call")); }, 15000);
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== 2) continue;
        clearTimeout(timer); child.kill("SIGKILL");
        resolve(m.result ?? null);
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) + "\n");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "record_matter_frame", arguments: args } }) + "\n");
  });
}

test("every field the frame's dispatch asks for is a slot on the tool, and the acceptor takes every slot", async () => {
  const ctx = {
    paths: stagePaths(mkdtempSync(join(tmpdir(), "frame-dispatch-"))),
    job: { markName: "NOVAPULSE", classes: ["9"], jurisdictions: ["US"], goods: "downloadable game software" },
    customerUnknown: false, profile: {}, exclusionSeed: [],
  };
  const dispatch = String(STAGES["matter-frame"].message(ctx));
  const asked = [...new Set([...dispatch.matchAll(/Send `([a-z_]+)`/g)].map((m) => m[1]))];
  assert.ok(asked.length >= 6 && asked.includes("identified_classes") && asked.includes("ratified_forms"),
    `the dispatch asks for ${JSON.stringify(asked)}: too few read to hold anything, or the two fields this is about are gone`);

  const schema = await frameToolSchema();
  assert.ok(schema, "the recording server lists no record_matter_frame — this cannot look");
  const offered = Object.keys(schema.properties ?? {});
  assert.deepEqual(asked.filter((k) => !offered.includes(k)), [],
    "the dispatch asks the frame to send a field its tool does not declare, so the model cannot send it");

  // AND THE OTHER END. A call carrying every offered key, nested keys included, is not refused as
  // undeclared — a slot the acceptor refuses is the same dead field from the other side.
  const sample = (s) => s?.type === "array" ? [s.items?.type === "object" ? sample(s.items) : "x"]
    : s?.type === "object" ? Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sample(v)]))
    : "x";
  assert.equal(refuseUndeclared(sample(schema)), null, "the acceptor refuses a key the tool offers");
});

test("a class the frame adds through its own tool reaches the plan as one identical-mark question", async () => {
  // DECISION 18, DRIVEN THROUGH THE WIRE. The call is built from what the tool OFFERS and nothing else,
  // because a model sends what its schema declares: the server and the acceptor both take an undeclared
  // key, so a hand-built call passes against a tool that offers no slot at all. It goes to the recording
  // server as the model sends it, and what the compile receives is read back from what that call
  // recorded, by the reader the pipeline uses.
  const schema = await frameToolSchema();
  const slot = schema?.properties?.identified_classes;
  assert.ok(slot?.items?.properties, "record_matter_frame offers no identified_classes slot, so a model following it can add no class");
  const dir = runDir();
  const reason = "the studio sells branded game controllers";
  const row = Object.fromEntries(Object.keys(slot.items.properties).map((k) => [k, { class: 28, reason }[k]]));
  const result = await callFrameTool(dir, { ...PARAMS, identified_classes: [row] });
  assert.ok(result && !result.isError, `the tool refused the call: ${JSON.stringify(result)}`);
  assert.deepEqual(frameIdentifiedClassRows(dir), [{ class: "28", reason }],
    "the class sent through the tool was not recorded where the plan compile reads it");

  const MARK = "NOVAPULSE";
  const plan = compileRegisterPlan({
    manifest: { schema_version: 1, mark: MARK, dominant_element: MARK, elements: [{ value: MARK, kind: "distinctive" }],
      variants: [{ value: MARK, category: "core" }, { value: "NOVAPULS", category: "spelling" }], incumbent_classes: [] },
    job: { jobKey: "t", classes: SCOPE.classes, jurisdictions: [] },
    capabilities: PROVIDER_CAPABILITIES.clarivate, addedClasses: frameIdentifiedClassRows(dir) });
  const inAdded = plan.entries.filter((e) => (e.nice_classes ?? []).includes("28"));
  assert.equal(inAdded.length, 1, `class 28 reached ${inAdded.length} entries; an added class costs one question`);
  assert.equal(inAdded[0].term, MARK, "the added class's one question is not the identical mark");
  assert.ok(!awaitsReadingTurn(inAdded[0].when), "the added class's question waits, so the class would never be searched");

  // THE CONTROL: the same call without the field adds nothing.
  const bare = runDir();
  await callFrameTool(bare, PARAMS);
  assert.deepEqual(frameIdentifiedClassRows(bare), []);
});

test("the frame PROPOSES a house element, and the document says it is not yet excluded", () => {
  const v = accepted({ house_element_candidate: HOUSE });
  assert.deepEqual(v.model.house_element_candidate, HOUSE);

  // THE SENTENCE A READER MEETS. "Excluded" on this document would tell a reader the search had been
  // narrowed on the frame's authority, which is exactly what has NOT happened at this point in the run.
  assert.match(v.content, /proposed for exclusion/i,
    "the line states a proposal, never a decision");
  assert.match(v.content, /Excluded only if the driver confirms/i,
    "…and names the condition, so a reader can tell whether the narrowing actually happened");
  assert.ok(v.content.includes(HOUSE.owner_basis), "the basis is evidenced on the document, not only in a field");
});

test("a frame that proposes nothing renders nothing, and that is the ordinary case", () => {
  // THE CONTROL. Every arm here sends the field, so all of them would pass against a transport that had
  // started rendering the line unconditionally — on every archived run, and on every matter whose mark
  // the client does not own a word of.
  const v = accepted();
  assert.equal(v.model.house_element_candidate, null);
  assert.equal(/proposed for exclusion/i.test(v.content), false,
    "no field, no line — an asserted 'none' here would be the frame answering a question nobody asked it");
});

test("the refusals that stop an exclusion swallowing the whole mark", () => {
  const bad = (h, token) => {
    const v = acceptMatterFrame({ ...PARAMS, house_element_candidate: h }, { instructedScope: SCOPE });
    assert.equal(v.ok, false, `expected a refusal for ${token}`);
    assert.match(v.reason, new RegExp(`^${token}`));
  };
  bad({ ...HOUSE, element: "" }, "matterframe_house_element_empty");
  bad({ ...HOUSE, owner_basis: "" }, "matterframe_house_element_basis_missing");

  // THE FLOOR, AND THE DIRECTION THAT WOULD REACH A CLIENT. Naming the whole mark as the house element
  // leaves nothing to search, ownership can verify perfectly, and no count downstream would catch it:
  // "queries on the house element: 0" is satisfied by a plan holding no queries at all.
  bad({ ...HOUSE, remainder: "" }, "matterframe_house_element_no_remainder");
  bad({ ...HOUSE, remainder: "novapulse" }, "matterframe_house_element_remainder_same");
  bad({ element: "NOVAPULSE SOUND OF TOMORROW", remainder: "SOUND OF TOMORROW", owner_basis: "x" },
    "matterframe_house_element_swallows_remainder");
});

test("the reader hands the driver a PROPOSAL, and nothing on an archived frame", () => {
  const d = runDir();
  assert.equal(frameHouseElementCandidate(d), null,
    "a run with no accepted frame proposes nothing — an absent field must never read as an exclusion");
  recordMatterFrame(d, { ...PARAMS, house_element_candidate: HOUSE });
  assert.deepEqual(frameHouseElementCandidate(d), HOUSE);
});
