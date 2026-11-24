// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// WHEN THE RECORDING TOOL REFUSES THE FRAME, IT NAMES EVERY DEFECT — NOT THE FIRST (ruling 592).
//
// The acceptor returned on its first defect, so a frame with four faults was refused four times and each
// refusal bought one fault's worth of news. Measured on an archived round: three of that run's four refusals
// were ONE defect class charged as three turns, about a minute and a half of the sweep's extra time.
//
// THE ARMS BELOW ARE WHAT STOPS IT BEING SIMPLIFIED BACK, in both directions. Collecting defects is easy to
// undo by accident (an early `return` added to a branch) and easy to over-apply (always emitting the list
// form, which would change what a seat reads in the ordinary one-defect case). One arm pins each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptKnockoutFrame } from "../knockout-frame-record.mjs";

const NOTE = "A scope note of two sentences. It says which search ran.";
// The call as the manual shows it (design, 2026-11-24): the order's use phrase on the batch, and no spellings, which the
// driver builds.
const MARK = {
  name: "IRONWHISK", classesPlain: "tools (8)", contextFraming: "compound", places: ["web", "shop.example.test"],
};
const frame = (over = {}) => ({ scope_note: NOTE, batch: { productContext: "a kitchen tool line", inUseAs: "a kitchen tool brand", useKind: "kitchen tool", families: [["IRONWHISK"]] }, marks: [MARK], ...over });
const refuse = (p) => { const r = acceptKnockoutFrame(p); assert.equal(r.ok, false, "the fixture was accepted, so this arm measures nothing"); return r.reason; };

test("the control: a whole frame is accepted, so a refusal below is the payload and not the fixture", () => {
  assert.equal(acceptKnockoutFrame(frame()).ok, true);
});

test("four defects on one mark arrive as four, numbered, in the order they are checked", () => {
  const reason = refuse(frame({ marks: [{ name: "IRONWHISK", alternatives: "IRON WHISK" }] }));
  assert.match(reason, /^knockoutframe_refused: 4 defects in this call/, "the count is the first thing a seat reads");
  for (const [i, token] of [
    "knockoutframe_classes_plain:IRONWHISK",
    "knockoutframe_context_framing:IRONWHISK",
    "knockoutframe_places:IRONWHISK",
    "knockoutframe_alternatives:IRONWHISK",
  ].entries()) assert.ok(reason.includes(`${i + 1}. ${token}`), `defect ${i + 1} is not ${token}: ${reason}`);
});

test("defects on different marks and on the batch arrive together", () => {
  const reason = refuse({
    scope_note: "", batch: {},
    marks: [{ ...MARK, name: "A", places: ["web"] },
      { name: "B", classesPlain: "c", contextFraming: "f" }],
  });
  assert.match(reason, /^knockoutframe_refused: 7 defects/);
  for (const t of ["knockoutframe_note_missing", "knockoutframe_context_missing", "knockoutframe_in_use_as_missing", "knockoutframe_use_kind: batch.useKind",
    "knockoutframe_places:A", "knockoutframe_places:B", "knockoutframe_families: batch.families is required"])
    assert.ok(reason.includes(t), `${t} is missing from the refusal: ${reason}`);
});

// THE OTHER DIRECTION, and the reason this file has four arms rather than two. "Every defect" is that defect
// when there is one, so a lone fault must read exactly as it always has — a seat that meets the list form
// for a single fault is being handed a count and a paragraph to learn nothing from. Arms elsewhere pin those
// sentences verbatim; this one pins that the shape does not change around them.
test("one defect is still one sentence, with no count and no list", () => {
  const reason = refuse(frame({ batch: { productContext: "a kitchen tool line", inUseAs: "a kitchen tool brand", families: [["IRONWHISK"]] } }));
  assert.doesNotMatch(reason, /knockoutframe_refused/, "a single defect was dressed as a list");
  assert.doesNotMatch(reason, /^1\. |\n1\. /, "a single defect was numbered");
  assert.match(reason, /^knockoutframe_use_kind: batch\.useKind is required/);
});

// A DEFECT NOBODY CAN DETERMINE IS NOT A DEFECT, and these two are the cases where collecting everything
// would have produced noise instead of news.
test("with no marks, the per-mark and order checks are skipped rather than reported", () => {
  const reason = refuse({ scope_note: NOTE, batch: { productContext: "x", inUseAs: "y", executionOrder: ["GHOST"] }, marks: [] });
  assert.match(reason, /^knockoutframe_marks_missing:/, "the absent list is the whole finding");
  assert.doesNotMatch(reason, /order_unknown/,
    "with no marks there is no name set for executionOrder to be checked against, so every entry would read as unknown");
});

test("a mark with no name is reported once, and nothing else is named against an empty string", () => {
  const reason = refuse(frame({ marks: [{ classesPlain: "", contextFraming: "" }] }));
  assert.match(reason, /^knockoutframe_mark_unnamed:/);
  assert.doesNotMatch(reason, /classes_plain:|context_framing:/,
    "those messages interpolate the mark's name, and a refusal naming the empty string tells a seat nothing");
});
