// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the REACH guard for the report prose standard.
//
// WHY THIS FILE EXISTS. A prompt-only change has no failure mode. If `skills/prelim-search/report-prose.md`
// never reaches a stage, nothing throws, no artifact is missing and every other test in this suite still
// passes — the stage simply writes to model defaults and the standard is a file nobody reads. That is the
// seventh-plus instance of the absence-reads-as-a-pass shape this codebase keeps shipping, and it is the
// only part of a test can hold: the PROSE itself cannot be tested and must not be linted (the issue
// rules that out twice — a prose checker flattens the writing and then passes its own test).
//
// So these assert REACH, never content:
//   1. the three prose stages' LIVE prompt names the file — under an empty profile, a custom profile and a
//      pharma matter, because `synthesisSkillReads` branches on `pharmaMatter(job)` and the other two
//      branch on `frameworkFor(profile)`;
//   2. the machine stages do NOT (a standard everything reads is a standard nothing is held to);
//   3. the FOLLOWUP lane names it too — `composeFollowup` is a fresh session with nothing, and it lost the
//      skill pointer entirely once already (stages.mjs A-1);
//   4. every skill path ANY stage names resolves to a file on disk, through the same resolver the engine
//      uses. A named-but-missing skill file is silent at runtime: the agent's read fails and the stage
//      carries on without the methodology.
//
// `skillReads` (the static property) is declarative metadata with NO runtime consumer — only `reads([...])`
// inside message() emits the instruction. So every assertion below goes through message()/composeFollowup,
// not through the property.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { STAGES, resolveSkillReads, composeFollowup } from "../stages.mjs";
import { config } from "../driver.config.mjs";

const STANDARD = "skills/prelim-search/report-prose.md";

// The stages that write a line a reader sees — the same list prose-voice.test.mjs holds PROSE_VOICE to.
const PROSE_STAGES = ["synthesis", "report-overview", "report-card"];
// Stages that write machine artifacts. `notify` is deliberately absent from both lists: it sends the
// email body VERBATIM from a file `composeEmailHtml` builds in code (pipeline.mjs), so no model authors
// cover-note prose and there is nothing there to hold to a prose standard.
const MACHINE_STAGES = ["matter-frame", "prelim-variants", "register-digest", "placement-inquiry", "frame-diff"];

const P = new Proxy({}, { get: (_t, k) => (k === "reportCard" ? (a) => `/r/card-${String(a)}.md` : `/r/${String(k)}`) });
const CUSTOM = {
  frameworkPath: "skills/prelim-search/risk-framework-aurora.md",
  workedExamplesPath: "skills/prelim-search/worked-examples-aurora.md",
};
// The three ctx shapes the resolvers actually branch on.
const CTXS = [
  ["default profile", { profile: null, job: {} }],
  ["custom profile", { profile: CUSTOM, job: {} }],
  ["pharma matter", { profile: null, job: { classes: ["5"] } }],
];
const msg = (stage, ctx) => STAGES[stage].message({ paths: P, job: {}, axis: 1, finding: {}, ...ctx });

test("#253 — the prose standard reaches every stage that writes reader-facing prose", () => {
  for (const stage of PROSE_STAGES) {
    for (const [label, ctx] of CTXS) {
      assert.ok(msg(stage, ctx).includes(STANDARD),
        `${stage} (${label}): the live prompt never names ${STANDARD}, so the standard does not arrive — and nothing else fails when it doesn't`);
      assert.ok(resolveSkillReads(stage, ctx).includes(STANDARD),
        `${stage} (${label}): resolveSkillReads omits ${STANDARD}, so a followup dispatch would run without it`);
    }
    // The static property is declarative, but it is what a reader of stages.mjs sees — keep it honest.
    assert.ok(STAGES[stage].skillReads.includes(STANDARD),
      `${stage}: the declarative skillReads property must name the standard too, or the table lies about the stage`);
  }
});

test("#253 — a corrective (followup) pass carries the standard as well", () => {
  for (const stage of PROSE_STAGES) {
    const composed = composeFollowup(stage, { profile: null, job: {} }, { followup: "Fix the caption." });
    assert.ok(composed.includes(STANDARD),
      `${stage}: composeFollowup drops ${STANDARD} — a corrective pass is a FRESH session and rewrites reader prose with no methodology`);
  }
});

test("#253 — the machine stages deliberately do NOT carry it", () => {
  for (const stage of MACHINE_STAGES) {
    assert.ok(!msg(stage, { profile: null, job: {} }).includes(STANDARD),
      `${stage} writes a machine artifact, not reader prose — paying for the prose standard on every dispatch buys nothing`);
  }
});

test("#253 — every skill path any stage names resolves to a real file", () => {
  const missing = [];
  for (const name of Object.keys(STAGES)) {
    for (const [label, ctx] of CTXS) {
      for (const rel of resolveSkillReads(name, ctx)) {
        const abs = config.resolveSkillPath(rel);
        if (!existsSync(abs) || !statSync(abs).isFile()) missing.push(`${name} (${label}): ${rel} → ${abs}`);
      }
    }
  }
  assert.deepEqual(missing, [],
    "a stage names a skill file that is not on disk — the agent's read fails silently and the stage runs without its methodology");
});
