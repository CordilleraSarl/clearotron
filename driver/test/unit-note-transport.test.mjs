// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE UNIT NOTE'S TYPED TRANSPORT, and the three things about it that are not the
// same as the conversions before it.
//
// 1. The stage KEEPS a seat write. Every RECORDING row declares `seatWrites: false`; this stage's
//    lane-off branch orders the named band by hand, and that branch is live for a matter with no Nice
//    classes — which compiles no register plan at all, so the lane flag is absent. So the transport sits
//    on its own LOCAL key, and the arms below assert the grant still carries `Write`/`Edit`.
// 2. The directory it writes into holds TWO OTHER WRITERS' files. `report-cards/` holds nothing but
//    cards; `register-units/` holds the note, `<axis>-band.json` and `<axis>-supplemental-plan.json`.
//    `toolWrittenArtifact` returns `member.test(base) ? dir : null` INSIDE a declared directory and never
//    falls through to the basename table, so a loose `member` would not merely over-match — it would take
//    a register tool's artifact and route its repair to a call that cannot write it.
// 3. The counts are DERIVED, so the note cannot disagree with the band it describes. The arm that
//    matters there is the negative one: a note over a band that does not exist is refused, not filled
//    with zeros, because zero-because-absent reads as "nothing was searched".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolWrittenArtifact, TOOL_WRITTEN_DIRS } from "../gateway.mjs";
import { allowedToolsFor, toolGroupsForStage, buildGatherMcpConfig, recordAxisFor, PER_AXIS_STAGES } from "../engine/mcp/gather-config.mjs";
import { recordUnitNote, unitPaths, unitCallPaths, unitRefusalsFor, bandAccount } from "../register-unit-record.mjs";

const runDir = () => mkdtempSync(join(tmpdir(), "unit-note-"));
const band = (dir, axis, blocks) => {
  const { band: p } = unitPaths(dir, axis);
  mkdirSync(join(dir, "register-units"), { recursive: true });
  writeFileSync(p, JSON.stringify(blocks, null, 2) + "\n");
};
const ENUM = (n) => ({ state: "enumerated", query: "q", total_hits: n, records: Array.from({ length: n }, (_, i) => ({ record_id: `r${i}` })) });

// ── 1. THE STAGE KEEPS ITS WRITER, WHICH IS THE WHOLE REASON FOR THE CATEGORY CHOICE ────────────────

test("#1893 the register-unit grant gains the record tool and KEEPS Write/Edit", () => {
  const groups = toolGroupsForStage("register-unit:primary-sweep");
  assert.deepEqual(groups, ["register", "unit-note"], "the funnel's key is untouched beside the transport's");
  const granted = allowedToolsFor(groups).split(/\s+/).filter(Boolean);
  assert.ok(granted.includes("mcp__unit-note__record_unit_note"), "the record tool is granted");
  // THE ASSERTION THIS FILE EXISTS FOR. A future edit that drops these is not tidying a pin — it is
  // breaking every matter with no Nice classes, whose seat is still ordered to write its band by hand.
  for (const t of ["Write", "Edit"])
    assert.ok(granted.includes(t),
      `register-unit lost ${t}. Its lane-off branch orders the named band BY HAND, and that branch is `
      + "reached by a matter with no Nice classes — no register plan compiles, so the supplemental-lane "
      + "flag is absent. This stage is not in the RECORDING category for exactly this reason.");
  // …and the transport carries no retrieval of its own, which is the one promise an own key can make.
  const own = allowedToolsFor(["unit-note"]).split(/\s+/).filter((t) => t.startsWith("mcp__"));
  assert.deepEqual(own, ["mcp__unit-note__record_unit_note"], "the unit-note key widened a retrieval surface");
});

test("#1893 the driver binds the axis, and the binding reaches the transport's OWN server", () => {
  // The mock reads this value from ANY server in the wiring, deliberately — one value, one setter. That
  // makes "did it reach the RIGHT server" a question the harness cannot answer, so it is asked here.
  const bound = recordAxisFor("register-unit:incumbent-class");
  assert.deepEqual(bound, { stage: "register-unit", axis: "incumbent-class" });
  assert.ok(PER_AXIS_STAGES.includes("register-unit"),
    "register-unit left the per-axis population — its tool would then accept whatever index it was handed");
  // The RECORDING half of the population must still be in it: the union is the point, not a replacement.
  assert.ok(PER_AXIS_STAGES.includes("report-card"),
    "the RECORDING per-axis rows dropped out of the union — the derivation reads one source, not both");
  const cfg = buildGatherMcpConfig(toolGroupsForStage("register-unit:incumbent-class"),
    { sessionKey: "k", agent: "a", runDir: "/RUN", recordAxis: bound.axis });
  assert.equal(cfg?.mcpServers?.["unit-note"]?.env?.CLEAROTRON_RECORD_AXIS, "incumbent-class",
    "the bound axis never reached the unit-note server — the tool would refuse every call as unbound");
  // A stage that does NOT fan out gets no binding at all, so the tool's unbound refusal stays reachable.
  assert.equal(recordAxisFor("register-digest"), null, "a colon-less label binds nothing");
  assert.equal(recordAxisFor("skeptic:1"), null, "a stage outside the population binds nothing");
});

// ── 2. THE DIRECTORY ROW, ASSERTED ON THE SIBLINGS AND NOT ONLY ON THE MEMBER ───────────────────────

test("#1893 the register-units row claims the note and NEITHER register tool's artifact", () => {
  const row = TOOL_WRITTEN_DIRS.get("register-units");
  assert.ok(row, "the directory row is gone — a note repair would be handed to the write-mode tails");
  assert.equal(row.tool, "record_unit_note");
  assert.equal(toolWrittenArtifact("/r/register-units/primary-sweep.md")?.tool, "record_unit_note");
  // THE TWO THAT MUST NOT MATCH, which is the half `report-cards` never had to prove. Inside a declared
  // directory `toolWrittenArtifact` returns the row or NULL and never falls through, so a row that
  // claimed these would route a register tool's repair to a call that cannot write them.
  for (const sibling of ["primary-sweep-band.json", "primary-sweep-supplemental-plan.json"])
    assert.equal(toolWrittenArtifact(`/r/register-units/${sibling}`), null,
      `${sibling} belongs to register_execute_plan / register_propose_supplemental, not to the note's call`);
  // A .md that is not a unit note still resolves — the shape is the whole test inside a declared dir, and
  // an axis is any label. Asserted so nobody "tightens" the pattern to a closed axis list it cannot know.
  assert.equal(toolWrittenArtifact("/r/register-units/some-new-axis.md")?.tool, "record_unit_note");
});

// ── 3. THE COUNTS ARE DERIVED, AND AN ABSENT BAND IS A REFUSAL RATHER THAN A ZERO ──────────────────

test("#1893 a note over a band that does not exist is REFUSED, never filled with zeros", () => {
  const dir = runDir();
  const r = recordUnitNote(dir, { axis: "primary-sweep", note: "A short observation about this axis, long enough to clear the floor the validator applies." });
  assert.match(String(r.refused ?? ""), /unit_band_unreadable/,
    "a note over no band must refuse. Deriving zeros would ship 'nothing was searched' as a fact.");
  assert.equal(r.written, null, "and nothing is written");
  // THE REFUSAL IS JOURNALLED, per axis. Without it the conversion makes a corrected defect and a defect
  // that never happened look identical, which is the audit hole the transport's own header names.
  const journal = unitRefusalsFor(dir, "primary-sweep");
  assert.equal(journal.length, 1, "the refusal is in this axis's journal");
  assert.match(String(journal[0].reason), /unit_band_unreadable/);
  assert.deepEqual(unitRefusalsFor(dir, "another-axis"), [],
    "and it is NOT in another axis's — six units append in parallel; a shared journal cannot be attributed");
});

test("#1893 the counts come from the band, and a null-result claim over records is refused", () => {
  const dir = runDir();
  band(dir, "primary-sweep", [ENUM(2), { state: "incomplete", query: "crowd", total_hits: 9000, fetched: 50 }, ENUM(1)]);
  // The derivation itself, on the same blocks — so the arm below is checking a join and not a constant.
  assert.deepEqual(bandAccount(JSON.parse(readFileSync(unitPaths(dir, "primary-sweep").band, "utf8"))),
    { blocks: 3, enumerated: 2, incomplete: 1, unknown: 0, records: 3 });
  const ok = recordUnitNote(dir, { axis: "primary-sweep", note: "Nothing in the returned material needed a second pass beyond what the band already records here." });
  assert.equal(ok.refused, null, `an honest note was refused: ${ok.refused}`);
  assert.equal(ok.records, 3, "the note's record count is the band's, not the seat's");
  assert.equal(ok.incomplete, 1);
  assert.ok(existsSync(unitPaths(dir, "primary-sweep").note), "the driver wrote the note");
  const text = readFileSync(unitPaths(dir, "primary-sweep").note, "utf8");
  assert.match(text, /3/, "the rendered note carries the derived count");
  // THE CONTRADICTION. A null-result claim over a band carrying records is the one thing this lane
  // cannot afford to get wrong, and it is refused at the call rather than caught downstream.
  const bad = recordUnitNote(dir, { axis: "primary-sweep", null_result: true, note: "This axis found nothing at all worth carrying forward to the judgment stage." });
  assert.match(String(bad.refused ?? ""), /unit_null_result_contradicted:primary-sweep:3/,
    "a null-result claim over 3 records must name the count it contradicts");
  // …and the earlier accepted note is still on disk: a refused call never voids an accepted one.
  assert.ok(existsSync(unitPaths(dir, "primary-sweep").note));
});

test("#1893 the call payload is captured before the decision, refused calls included", () => {
  // The evidence half. A refusal that leaves no trace of WHAT was sent turns a seat-side defect into an
  // unanswerable question three days later.
  const dir = runDir();
  recordUnitNote(dir, { axis: "phonetic", note: "short" });
  const { payload } = unitCallPaths(dir, "phonetic");
  assert.ok(existsSync(payload), "the payload is written before the accept decision, not after it");
  const captured = JSON.parse(readFileSync(payload, "utf8"));
  assert.equal(captured.params.note, "short", "the call as RECEIVED, not the driver's rendering of it");
});
