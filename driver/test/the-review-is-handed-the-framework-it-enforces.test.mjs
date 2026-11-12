// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE REVIEW IS HANDED THE FRAMEWORK IT ENFORCES, ON EVERY ROUTE THAT OPENS A REVIEW SESSION.
//
// The review's manual judges a rating on the framework's own method and at its lowest band. On a test run
// with Codex, a review that was handed no framework searched folders outside its run for one. So the review
// reads the run's own resolved framework (the file the writer reads, a customer's own where the profile
// names one), the shared reasoning, and on a pharma matter the field module its standing lines enforce. It
// does not read the writer's level-specific rules or its worked examples.
//
// Four routes open a review session: the full review, the recheck after a correction (a follow-up of the
// review's own session, and a fresh dispatch of the stage when that session is not known), and the review of
// a delivery-check repair. Each must name those files and state the approved sentence. Each engine then
// rewrites the reference into a path, and a customer's framework that lives only in the instruction overlay
// must resolve inside a folder the engine grants.
//
// Invented values only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import { STAGES, composeFollowup, paths, resolveSkillReads, REVIEW_APPLIES_THE_SUPPLIED_FRAMEWORK } from "../stages.mjs";
import { REPAIR_COMPOSERS, repairFollowup } from "../repair-composers.mjs";
import { buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { absolutizeSkillRefs as codexRewrite } from "../engine/common.mjs";
import { skillRefsIn } from "../methodology-witness.mjs";

const { messageCtxFor } = await import("../pipeline.mjs");

const DEF = STAGES["narrative-refutation"];
const FRAMEWORK = "skills/clearance-search/risk-framework-invented-owner.md";
const CUSTOM = { frameworkPath: FRAMEWORK, workedExamplesPath: "skills/clearance-search/worked-examples-invented-owner.md" };
const SHARED = "skills/clearance-search/firm-wide-reasoning.md";
const PHARMA = "skills/clearance-search/field-doctrine-pharma.md";
const HOUSE = "skills/clearance-search/risk-framework.md";
const WRITER_ONLY = ["skills/clearance-search/synthesis-rules.md", CUSTOM.workedExamplesPath];
// A real, empty run folder: the pipeline's context builder logs what it read there.
const RUN = mkdtempSync(join(tmpdir(), "invented-review-run-"));
after(() => rmSync(RUN, { recursive: true, force: true }));
const P = paths(RUN);

const composerSamples = (key) => {
  const c = REPAIR_COMPOSERS.find((x) => x.key === key);
  assert.ok(c, `${key} is not a registered follow-up`);
  return c.samples.map((s) => ({ label: `${key} (${s.name})`, followup: repairFollowup(key, s.args) }));
};

/** Every route that opens a review session, composed for one context. */
function routes(ctx) {
  const msgCtx = { ...ctx, paths: P, run: null };
  return [
    { label: "the full review", message: String(DEF.message(msgCtx)) },
    // The recheck when the review's own session is not known: the stage's opening message, through the context the pipeline builds.
    { label: "a recheck dispatched afresh", message: String(DEF.message({ ...messageCtxFor("narrative-refutation", msgCtx), ...ctx })) },
    ...["narrative-refutation:verdict-recheck", "narrative-refutation:post-repair-review"].flatMap((key) =>
      composerSamples(key).map(({ label, followup }) => ({ label, message: composeFollowup("narrative-refutation", msgCtx, { followup }) }))),
  ];
}

test("the sentence is the approved one, word for word, and the review lists it as standing", () => {
  assert.equal(REVIEW_APPLIES_THE_SUPPLIED_FRAMEWORK,
    "Apply the frozen risk framework supplied for this run. If it or another required instruction is missing or unreadable, report the missing input; do not search other folders for a replacement.");
  assert.equal(DEF.standing[0], REVIEW_APPLIES_THE_SUPPLIED_FRAMEWORK);
});

test("the review reads the customer's framework and the shared reasoning, never the house default or the writer's own rules", () => {
  const reads = resolveSkillReads("narrative-refutation", { profile: CUSTOM, job: {} });
  assert.ok(reads.includes(FRAMEWORK) && reads.includes(SHARED), reads.join(", "));
  assert.ok(!reads.includes(HOUSE), "the house default stands in for the customer's framework");
  for (const f of WRITER_ONLY) assert.ok(!reads.includes(f), `the review reads the writer's ${f}`);
  assert.ok(!reads.includes(PHARMA), "a matter outside the pharma class reads the field module");
  assert.ok(resolveSkillReads("narrative-refutation", { profile: CUSTOM, job: { classes: ["5"] } }).includes(PHARMA),
    "a pharma matter's review is not handed the field module its standing lines enforce");
  // No profile names a framework: the house default, as the writer reads it.
  assert.ok(resolveSkillReads("narrative-refutation", { profile: null, job: {} }).includes(HOUSE));
});

test("every route that opens a review session names the customer's framework and the shared reasoning, and states the sentence once", () => {
  const all = routes({ profile: CUSTOM, job: {} });
  assert.ok(all.length >= 5, `only ${all.length} routes composed`);
  for (const { label, message } of all) {
    const refs = skillRefsIn(message);
    assert.ok(refs.includes(FRAMEWORK), `${label}: the customer's framework is not named`);
    assert.ok(refs.includes(SHARED), `${label}: the shared reasoning is not named`);
    assert.ok(!refs.includes(HOUSE), `${label}: the house default is named in its place`);
    assert.equal(message.split(REVIEW_APPLIES_THE_SUPPLIED_FRAMEWORK).length - 1, 1, `${label}: the sentence is not stated exactly once`);
  }
});

test("on a pharma matter, every route names the field module the review is told to check", () => {
  for (const { label, message } of routes({ profile: CUSTOM, job: { classes: ["5"] } }))
    assert.ok(skillRefsIn(message).includes(PHARMA), `${label}: the field module is not named`);
});

test("a framework that lives only in the instruction overlay resolves inside a folder each engine grants", () => {
  const root = mkdtempSync(join(tmpdir(), "review-framework-"));
  try {
    const base = join(root, "repo", "skills"), overlay = join(root, "config", "skills");
    mkdirSync(base, { recursive: true });
    const fw = join(overlay, FRAMEWORK.slice("skills/".length));
    mkdirSync(dirname(fw), { recursive: true });
    writeFileSync(fw, "An invented owner's framework.\n");
    // The configured resolution: the overlay's copy where it has one, the shipped tree otherwise.
    const resolve = (rel) => { const o = join(dirname(overlay), rel); return existsSync(o) ? o : join(dirname(base), rel); };
    const roots = [overlay, base];
    for (const { label, message } of routes({ profile: CUSTOM, job: {} })) {
      const { args, input } = buildClaudeArgs({ message, model: "opus", thinking: "low", cwd: root, skillsDir: overlay, skillsGrantRoots: roots, resolveSkill: resolve, runDir: join(root, "run") });
      const granted = args.reduce((acc, a, i) => (a === "--add-dir" ? [...acc, args[i + 1]] : acc), []);
      assert.ok(input.includes(fw), `claude, ${label}: the framework reference did not become the overlay's file`);
      assert.ok(granted.some((r) => fw.startsWith(r + "/")), `claude, ${label}: no granted folder holds ${fw}`);
      // Codex's sandbox reads the same roots (openai-agent.mjs, readRoots), so the same file is in reach.
      assert.ok(codexRewrite(message, overlay, resolve).includes(fw), `codex, ${label}: the framework reference did not become the overlay's file`);
      assert.ok(roots.some((r) => fw.startsWith(r + "/")));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
