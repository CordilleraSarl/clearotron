// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE DICTATION AND THE PARSER MUST NOT BE ABLE TO DIVERGE ON THE DISPOSITION VOCABULARY.
//
// What was shipped: `stages.mjs` told the seat "EXACTLY one bare token of" a HARDCODED list of four,
// while `findings-model.mjs` accepted five and the served skill file said "four of the five" naming the
// fifth. The word in the dictation was EXACTLY.
//
// The fifth is `withdrawn`, and it is how a corrective pass KILLS a finding it has concluded is wrong —
// findings-model's own comment names the incident it exists for, where a killed card must never
// resurrect. **A seat obeying the dictation literally could not withdraw a finding it knew was wrong.**
// It had to leave it standing or reach for a token meaning something else, on the highest-traffic
// artifact in the engine, on the live path.
//
// The fix was one interpolation — the same file already interpolates FINDINGS_SCHEMA_VERSION and
// OFF_FIELD_GROUNDS from the same module, two imports away. This is the half that stops it coming back:
// a hardcoded token list in the dictation now fails CI rather than waiting to be noticed by a read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES } from "../stages.mjs";
import { DISPOSITIONS, POSITION_REQUIRED_DISPOSITIONS } from "../findings-model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "stages.mjs"), "utf8");

/** The synthesis dictation as the seat actually receives it, composed rather than read as source. */
function synthesisText() {
  const def = STAGES.synthesis;
  assert.ok(typeof def?.message === "function", "synthesis has no composed message — this guard is reading nothing");
  const P = { findings: "/run/findings.json", runDir: "/run" };
  return String(def.message({
    paths: P, profile: {}, half: null, axes: [], job: { classes: [9], goods: "software", marks: ["LUMEN"], mark: "LUMEN", jurisdictions: ["US"] },
    registerPlan: null, recallDirectives: [], lateBind: null, intakeAsks: [], ownedAsks: [], marks: ["LUMEN"],
  }) ?? "");
}

test("the dictated disposition list IS the constant — not a copy of it", () => {
  const text = synthesisText();
  const line = text.split("\n").find((l) => /^- disposition:/.test(l.trim()));
  assert.ok(line, "the disposition bullet is gone from the dictation — the seat is told nothing about the field");
  // The four posture tokens, in the constant's own order. A hardcoded list that happens to match today
  // would pass this — which is why the SOURCE check below is the one that binds.
  assert.ok(line.includes(POSITION_REQUIRED_DISPOSITIONS.join(" / ")),
    `the dictated list does not match POSITION_REQUIRED_DISPOSITIONS — seat told: ${line.slice(0, 160)}`);
});

test("…and it is INTERPOLATED, so a change to the constant cannot leave the dictation behind", () => {
  // The binding, and the reason this file exists. A matching hardcoded list is exactly what shipped:
  // correct on the day it was typed, silently wrong the moment the vocabulary moved.
  assert.match(SRC, /EXACTLY one bare token of: \$\{POSITION_REQUIRED_DISPOSITIONS\.join\(" \/ "\)\}/,
    "the disposition list is hardcoded in stages.mjs again — interpolate the constant, as FINDINGS_SCHEMA_VERSION and OFF_FIELD_GROUNDS already are");
});

test("every token the PARSER accepts is accounted for in what the seat is told", () => {
  // The defect in one assertion. `withdrawn` is not a posture, so it is not in the EXACTLY-one list —
  // but a vocabulary the parser accepts and the dictation never mentions is a token the seat cannot
  // reach, and this one is how a wrong finding gets killed.
  const text = synthesisText();
  const unmentioned = DISPOSITIONS.filter((d) => !text.includes(d));
  assert.deepEqual(unmentioned, [],
    `the parser accepts ${unmentioned.join(", ")} and the dictation never names ${unmentioned.length === 1 ? "it" : "them"} — the seat cannot reach a token it was never told exists`);
});

test("the fifth token is named as a CORRECTIVE act, not offered as a fifth posture", () => {
  // Both halves matter. Silence made it unreachable; listing it beside the four would invite a first-pass
  // seat to file a finding as already-killed, which renders nowhere and can never resurrect.
  const text = synthesisText();
  const fifth = DISPOSITIONS.filter((d) => !POSITION_REQUIRED_DISPOSITIONS.includes(d));
  assert.equal(fifth.length, 1, "the posture/non-posture split changed — this guard's premise needs rereading");
  const line = text.split("\n").find((l) => /^- disposition:/.test(l.trim())) ?? "";
  assert.ok(line.includes(fifth[0]), `${fifth[0]} is not mentioned in the disposition bullet`);
  assert.ok(!line.includes(`${POSITION_REQUIRED_DISPOSITIONS.join(" / ")} / ${fifth[0]}`),
    `${fifth[0]} is listed as a fifth posture — it is a corrective act and must be named separately`);
});

// ── VOID CONTROL ────────────────────────────────────────────────────────────────────────────────────

test("VOID CONTROL: the dictation actually composed, and carries the disposition contract", () => {
  // Every assertion above reads a composed string. If synthesis's message ever failed to compose under
  // this generic ctx, `text` would be "" and the `unmentioned` check would report every token as absent
  // — loud — but the two `includes` checks would go quiet. This makes the empty case impossible.
  const text = synthesisText();
  assert.ok(text.length > 2000, `synthesis composed ${text.length} chars — too short to be the real dictation`);
  assert.ok(text.includes("disposition"), "the composed dictation does not mention dispositions at all");
});
