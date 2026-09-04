// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the frame-diff dominant element is the DRIVER'S, and a seat cannot move it.
//
// THE DEFECT THIS PINS. The stage was told to echo the blind model's dominant element verbatim into a
// field the driver already held two copies of, and `pipeline.mjs` then read the echo FIRST. So a
// transcription slip retargeted `applyDominantBackstop`'s spine test — the gate that forces
// `dominant_element_gap` true on a firing on-spine directive, which clamps a CLEAR verdict to
// CONDITIONAL. A typo could move a verdict, and no failure token spoke about it.
//
// WHAT IS ASSERTED, AND WHY IN THIS ORDER:
//
//   1. THE PLANT. A call carrying a WRONG dominant element must not change which element the spine test
//      runs against. This is the issue's own acceptance sentence and it is first because it is the only
//      arm that proves the STRUCTURE — the others prove the texts agree with it.
//   2. THE NEGATIVE CONTROL (A5). The same plant, fed through the OLD precedence, must flip the verdict.
//      Without it, arm 1 passes on a fixture too weak to tell the fix from its absence — and the planted
//      typo here is chosen so the backstop's answer genuinely differs (NOVAPULZE does not match the
//      NOVAPULSE directive, so the gap stays false where it should be forced true).
//   3. THE SOURCE ORDER, stated and pinned: blind model, then the manifest's prose line, then nothing.
//   4. AN ABSENCE IS A STATE, not an empty string: no artifact answers ⇒ the key is absent from the
//      record and `source` is null, which is distinguishable from "the artifact said nothing".
//   5. THE SERVED TEXT. No surface a seat reads may ask it to send the field. This is the anti-rot arm:
//      the structure above holds whatever the prose says, but a dispatch that keeps asking would have
//      the seat spending a field the transport discards, and the next reader would restore the schema
//      property to "fix" it. Its own negative control included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

import { recordFrameDiff, boundDominantElement, boundDominantElementFrom, MODEL_FILE } from "../frame-diff-record.mjs";
import { applyDominantBackstop, parseFrameDiff } from "../frame-diff-model.mjs";
import { STAGES, paths as stagePaths, resolveSkillReads } from "../stages.mjs";
import { correctionHint } from "../gateway.mjs";

const DRIVER = fileURLToPath(new URL("../", import.meta.url));

const SPINE = "NOVAPULSE";
const TYPO = "NOVAPULZE";          // the plant: one keystroke, and it matches no directive item below

const blindModel = (dominant) => JSON.stringify({
  schema_version: 1,
  dominant_element: dominant,
  variants: [{ value: dominant, direction: "drop", rationale: "the bare element" }],
  fields: [{ goods: "game software", on_field: true, rationale: "goods-overlap" }],
  sources: [{ channel: "developer ecosystem", rationale: "B2D product" }],
  ranking_basis: "goods-overlap",
});

// A FIRING directive that lands ON the spine, with a lint-clean remedy so the ask contract passes and the
// only thing left to decide is the backstop's. `dominant_element_gap: false` is the seat UNDER-flagging —
// which is the case the backstop exists for.
const onSpineCall = () => ({
  directives: [{
    layer: "variant", item: SPINE,
    observation: "the drop-S neighbour of the spine was never searched",
    severity: "material",
    remedy: { terms: [SPINE], nice_classes: ["9"] },
  }],
  dominant_element_gap: false,
});

function runDirWith({ blind, manifest } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "framediff-bind-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (blind !== undefined) writeFileSync(join(dir, "blind-frame-model.json"), blind);
  if (manifest !== undefined) writeFileSync(join(dir, "variant-manifest.md"), manifest);
  return dir;
}

test("#1169 — a planted WRONG dominant element in the call cannot retarget the spine test", () => {
  const dir = runDirWith({ blind: blindModel(SPINE) });

  // The seat sends the echo it is no longer asked for, and gets it wrong.
  const r = recordFrameDiff(dir, { ...onSpineCall(), dominant_element: TYPO });
  assert.equal(r.refused, null, `the call must be ACCEPTED — a stray property is ignored, not refused: ${r.refused}`);

  const stored = parseFrameDiff(readFileSync(join(dir, MODEL_FILE), "utf8"));
  assert.equal(stored.dominant_element, SPINE,
    "the record must carry the DRIVER'S spine, not the seat's typo — the whole point of the bind");
  assert.equal(r.dominant_element_source, "blind-frame-model.json",
    "and the answer must say where it came from, so the seat is not reasoning against a spine it cannot see");

  const decided = applyDominantBackstop(stored, stored.dominant_element);
  assert.equal(decided.dominant_element_gap, true,
    "a firing directive ON the spine forces the gap TRUE — the clamp input the typo used to be able to disarm");

  // The capture keeps the evidence: what the seat SENT is recorded even though it was not honoured.
  const capture = JSON.parse(readFileSync(driverDir(dir, "frame-diff-calls", "call-001.json"), "utf8"));
  assert.equal(capture.params.dominant_element, TYPO,
    "the capture records what ARRIVED, untidied — a capture that dropped the ignored field would hide that a "
    + "seat is still sending one, which is the signal a stale skill doc is in play");
});

test("#1169 NEGATIVE CONTROL — the same plant under the OLD precedence DOES move the verdict", () => {
  // Exactly the fixture arm 1 uses, decided the way the code used to decide it: the document's own field
  // first. If this does not flip, arm 1 is passing on a plant too weak to prove anything.
  const seatEchoFirst = TYPO;
  const model = {
    schema_version: 1, dominant_element: SPINE,
    directives: [{ layer: "variant", item: SPINE, observation: "o", severity: "material",
      remedy: { terms: [SPINE], nice_classes: ["9"] } }],
    dominant_element_gap: false,
  };
  const parsed = parseFrameDiff(JSON.stringify(model));

  assert.equal(applyDominantBackstop(parsed, seatEchoFirst).dominant_element_gap, false,
    "the typo must leave the gap FALSE — that is the verdict move this issue is about");
  assert.equal(applyDominantBackstop(parsed, SPINE).dominant_element_gap, true,
    "and the correct spine must force it TRUE, so the two answers are genuinely different");
});

test("#1169 — the bind reads the driver's own artifacts in the stated order", () => {
  const both = runDirWith({ blind: blindModel(SPINE), manifest: "Dominant element: KROMA\n" });
  assert.deepEqual(boundDominantElement(both), { value: SPINE, source: "blind-frame-model.json" },
    "the blind model wins: it is the document the diff IS a diff of");

  // NORMALISED, and deliberately not corrected here. `dominantElementFromManifest` lowercases (its `norm`),
  // which is invisible to the spine test — `applyDominantBackstop` norms both sides — and was already this
  // rung's behaviour before the bind existed. What IS new is that the value now reaches frame-diff.json,
  // so a run whose blind model is unreadable stores a lowercased spine where it used to store the seat's
  // cased echo. Asserting the real shape rather than the flattering one: inventing a case transform over a
  // MARK to make a display line prettier is the kind of quiet normalisation this repo bans everywhere else.
  const manifestOnly = runDirWith({ manifest: "# Manifest\n\nDominant element: KROMA\n" });
  assert.deepEqual(boundDominantElement(manifestOnly), { value: "kroma", source: "variant-manifest.md" },
    "with no blind model, the manifest's prose line is the fallback — unchanged from the old chain");

  const unparseable = runDirWith({ blind: "{not json", manifest: "Dominant element: KROMA\n" });
  assert.equal(boundDominantElement(unparseable).source, "variant-manifest.md",
    "an UNPARSEABLE blind model falls through rather than throwing — the stage must still be able to record");

  // The path-object entry point must agree with the runDir one, or the pipeline and the tool could bind
  // two different spines for one run.
  const P = stagePaths(both);
  assert.deepEqual(boundDominantElementFrom(P), boundDominantElement(both),
    "both entry points are one body; if these ever differ, the driver and its own tool disagree about the spine");
});

test("#1169 — no artifact answers is a STATE, not an empty field", () => {
  const dir = runDirWith({});
  assert.deepEqual(boundDominantElement(dir), { value: "", source: null });

  const r = recordFrameDiff(dir, { directives: [], dominant_element_gap: false });
  assert.equal(r.refused, null, "a clean diff with no derivable spine is still a valid record");

  // WHAT CARRIES THE STATE IS `dominant_element_source`, NOT KEY PRESENCE. The record module drops the
  // undefined key, and then `parseFrameDiff` — which is what gets serialized, deliberately, so the file and
  // the validator cannot drift — normalises it back to "". So the stored artifact cannot distinguish "no
  // artifact answered" from "an artifact answered with nothing", and the tool's ANSWER is where that
  // distinction lives. Same lesson as CHANNEL_STATES in scope-ledger.mjs: an empty value that cannot say
  // why it is empty is an absence pretending to be a decision.
  const raw = JSON.parse(readFileSync(join(dir, MODEL_FILE), "utf8"));
  assert.equal(raw.dominant_element, "", "the parser normalises the missing key to an empty string");
  assert.equal(r.dominant_element_source, null,
    "and the null SOURCE is the fact a reader needs: no artifact answered, rather than one that said nothing");
});

test("#1169 — no text a frame-diff seat is served asks it to send dominant_element", () => {
  const P = stagePaths("/tmp/framediff-served-probe");
  const CTX = Object.freeze({
    paths: P, profile: {}, intakeAsks: [], framework: null, axes: ["primary-sweep"], axis: null,
    job: { marks: ["PROBEMARK"], markName: "PROBEMARK", classes: [9], goods: "probe goods", rawRequest: "probe" },
  });

  const served = [
    ["dispatch:stages.mjs", STAGES["frame-diff"].message(CTX)],
    ...(resolveSkillReads("frame-diff", CTX) ?? []).map((rel) =>
      [`skill:driver/${rel}`, readFileSync(join(DRIVER, rel), "utf8")]),
    // The repair rung. A hint is served text like any other, and it is the surface a conversion forgets:
    // the frame-diff conversion had to sweep three of them.
    ["repair:correctionHint", correctionHint("invalid_file:frame-diff.json:framediff_gap_invalid")],
  ];

  // `dominant_element` as a FIELD NAME — never `dominant_element_gap`, which is genuinely the seat's and
  // is named all over these texts. The prose form "the dominant element" is also fine and deliberate: the
  // seat still reasons about the spine, it just does not transcribe it.
  const FIELD = /dominant_element(?!_gap)/;

  for (const [surface, text] of served) {
    assert.equal(FIELD.test(String(text)), false,
      `${surface} names \`dominant_element\` as a field. The tool has no such property (#1169) — a text that `
      + "still asks for it spends a seat's attention on a value the transport discards, and the next reader "
      + "restores the property to make the text true again.");
  }

  // A5 — prove the scan can FAIL. Without this the regex could be wrong in a way that matches nothing.
  assert.equal(FIELD.test("Send `dominant_element` as the blind model's, echoed verbatim."), true,
    "the scan must catch the sentence this issue deleted");
  assert.equal(FIELD.test("Send `dominant_element_gap` as a JSON boolean."), false,
    "and must not catch the field that IS the seat's");
});

test("#1169 — the tool's input schema has no dominant_element property", async () => {
  // Read the served schema, not a copy of it: the property's absence is the structural half of the fix,
  // and asserting it against the shipped server is what makes the other arms more than prose.
  const src = readFileSync(join(DRIVER, "engine", "mcp", "recording-server.mjs"), "utf8");
  // BOUNDED AT THE NEXT TOOL, whatever it is — not at a hardcoded sibling. The first cut sliced
  // "record_frame_diff → record_search_run_artifacts" because those were adjacent when it was written;
  // conversion 3 inserted `record_prelim_variants` between them, and THAT tool has a `dominant_element`
  // field of its own, so the slice swallowed a neighbour's schema and the assertion failed on a property
  // frame-diff does not declare. An anchor that names its neighbour is an anchor that breaks when the
  // neighbour changes.
  const from = src.indexOf('name: "record_frame_diff"');
  assert.ok(from > 0, "found no record_frame_diff tool block to read — the anchor moved");
  const next = src.indexOf('\n    name: "', from + 1);
  const block = src.slice(from, next > 0 ? next : undefined);
  assert.ok(block.length > 200, "the record_frame_diff block is too short to be its schema");
  assert.ok(!/name: "record_(?!frame_diff)/.test(block), "the slice swallowed a neighbouring tool's schema");
  assert.equal(/^\s*dominant_element: \{/m.test(block), false,
    "record_frame_diff must not declare a dominant_element property");
  assert.ok(/required: \["directives", "dominant_element_gap"\]/.test(block),
    "and its required list must be exactly the two fields the seat still owns");
  assert.ok(/dominant_element_gap: \{/.test(block), "the gap flag stays — it is the seat's own claim");

  assert.equal(existsSync(join(DRIVER, "engine", "mcp", "recording-server.mjs")), true);
});
