// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A-1 — WHAT A CORRECTIVE PASS ACTUALLY RECEIVES.
//
// A followup dispatch is not a resumed session. `warm` requires `attempt > 1` (gateway.mjs), so attempt 1
// passes `resumeRef: undefined`, and `--resume` / `codex resume` is the only continuity mechanism either
// engine has — neither reads `sessionKey` (asserted below, because that fact is what makes the rest true).
// Every `stage(name, ctx, {followup})` call is a NEW stage() call, i.e. attempt 1. So the composed message
// is the WHOLE of what the corrective lane ever sees, and these tests pin its three restored parts:
// the methodology pointer, the driver-computed `extra` blocks, and the declared-input pointers.
//
// Measured cost of not doing this, on ee4ea93: a cold followup opened 4/40 and 3/43 of its declared inputs
// across two runs, where a cold fresh dispatch opened 62/112 and 67/104.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STAGES, paths, stageInputs, composeFollowup, resolveSkillReads } from "../stages.mjs";
import { skillRefsIn } from "../methodology-witness.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const P = paths("/tmp/a1-run");
const FOLLOWUP = "The coverage ledger is missing a disposition row for the DE axis. Add it and re-emit nothing else.";

// The three profile-aware stages resolve their framework per customer. A profile that names its own
// framework is the case the static `skillReads` property CANNOT represent.
const CUSTOM = {
  frameworkPath: "skills/prelim-search/risk-framework-acme.md",
  workedExamplesPath: "skills/prelim-search/worked-examples-acme.md",
};

test("A-1 — the composed followup carries the methodology pointer for every stage that declares one", () => {
  for (const [name, def] of Object.entries(STAGES)) {
    const skills = resolveSkillReads(name, { profile: null, job: {} });
    const msg = composeFollowup(name, { profile: null, job: {} }, { followup: FOLLOWUP });
    if (!skills.length) {
      assert.deepEqual(skillRefsIn(msg), [], `${name}: declares no skill reads, so the composed message must not invent one`);
      continue;
    }
    for (const s of skills) assert.ok(msg.includes(s), `${name}: composed followup lost the pointer to ${s}`);
    // the witness (and the engine's absolutizer) both key on the same `skills/….md` shape — if the
    // composer ever emitted a pointer in a form neither recognises, the read grant would not follow it
    assert.deepEqual(skillRefsIn(msg).sort(), [...skills].sort(),
      `${name}: the composed message's machine-visible skill refs must be exactly the resolved list`);
  }
});

test("A-1 — the instruction survives verbatim and the stage is NOT re-commissioned", () => {
  const msg = composeFollowup("register-digest", { profile: null, job: {} }, { followup: FOLLOWUP });
  assert.ok(msg.includes(FOLLOWUP), "the followup text is the primary content and is passed through unchanged");
  // The whole point of composing rather than re-sending def.message(ctx): the full stage prompt would
  // re-order the task and fight the followup's own "do NOT redo it".
  assert.doesNotMatch(msg, /^First, read and follow exactly:/m,
    "the fresh-dispatch reads() wording must not appear — a correction is not a fresh commission");
  assert.match(msg, /NOT an instruction to redo the stage/,
    "…and the reference framing says so in words the model reads, not only in a comment");
});

test("A-1 — opts.extra survives a followup (it was reachable only on the fresh-message branch)", () => {
  const extra = "SETTLED DEFERRALS: axis DE — provider capability gap, accepted. Give it an honest deferred row.";
  const msg = composeFollowup("register-digest", { profile: null, job: {} }, { followup: FOLLOWUP, extra });
  assert.ok(msg.includes(extra), "the driver-computed block reaches the dispatch that needs it");
  assert.ok(msg.indexOf(FOLLOWUP) < msg.indexOf(extra), "the instruction stays ahead of the data it acts on");
});

// The ruling: "for every stage declaring an input, a composed followup either carries that input's pointer
// or states why not." The composer is handed the list already filtered to what is on disk (stages.mjs is a
// pure prompt table), so the two halves are: everything handed in is named, and the filter is existence.
test("A-1 — every declared input a run HAS is named in the composed followup", () => {
  for (const name of Object.keys(STAGES)) {
    const declared = stageInputs(name, P, { axes: ["primary", "incumbent-class"], axis: "primary" });
    if (!declared.length) continue;
    const msg = composeFollowup(name, { profile: null, job: {} }, { followup: FOLLOWUP, inputs: declared });
    for (const f of declared) assert.ok(msg.includes(f), `${name}: composed followup never names its declared input ${f}`);
    assert.match(msg, /does not carry them/, `${name}: …and says WHY it is naming them`);
  }
});

test("A-1 — a stage with no declared inputs gets no inputs line, and an absent optional input is simply not named", () => {
  const none = composeFollowup("matter-frame", { profile: null, job: {} }, { followup: FOLLOWUP, inputs: [] });
  assert.doesNotMatch(none, /DECLARED INPUTS/, "no inputs ⇒ no line inviting the model to look for some");
  // synthesis declares crowdContext, which most runs never produce: the caller filters it out and the
  // absence IS the reason. What must never happen is naming a path that is not there.
  const declared = stageInputs("synthesis", P, {});
  const present = declared.filter((f) => f !== P.crowdContext && f !== P.crowdContextMd);
  const msg = composeFollowup("synthesis", { profile: null, job: {} }, { followup: FOLLOWUP, inputs: present });
  assert.ok(!msg.includes(P.crowdContext), "an input this run never produced is not asserted to exist");
  for (const f of present) assert.ok(msg.includes(f), `the ones that DO exist are all named (${f})`);
});

// ── the drift guard the whole design turns on ────────────────────────────────────────────────────────
// `skillReads` is declarative metadata and deliberately names the firm-neutral DEFAULT framework;
// `skillReadsFor` is the live per-run resolution. If a followup used the static property, a corrective
// pass on a customer with their own framework would be pointed at the house one — doc-50's rating
// authority swapped, silently, in exactly the passes that re-rate. These assert the LIVE resolution
// matches what message() emits, under a custom profile and under a pharma matter.
test("A-1 — resolveSkillReads equals what message() emits, for every stage, under a custom profile", () => {
  const ctxs = [
    { label: "house default", ctx: { profile: null, job: {} } },
    { label: "customer framework", ctx: { profile: CUSTOM, job: {} } },
    { label: "pharma matter", ctx: { profile: CUSTOM, job: { classes: ["5"] } } },
  ];
  let rendered = 0;
  const withMessage = Object.entries(STAGES).filter(([, d]) => typeof d.message === "function");
  for (const [name, def] of withMessage) {
    for (const { label, ctx } of ctxs) {
      const emitted = skillRefsIn(def.message({ ...ctx, paths: P, axis: "primary", finding: {}, run: { slug: "s", codename: "c" } }));
      rendered++;
      const resolved = resolveSkillReads(name, ctx);
      for (const s of resolved)
        assert.ok(emitted.includes(s), `${name} (${label}): skillReadsFor names ${s} but the stage prompt never does — the two call sites have drifted`);
    }
  }
  // no silent cap: every stage's message renders under all three ctxs today. If one starts throwing on a
  // ctx this test fabricates, the guard must fail loudly rather than quietly cover fewer stages.
  assert.equal(rendered, withMessage.length * ctxs.length,
    "every stage message rendered under every ctx — a stage that cannot render is not silently exempt from the drift guard");
});

test("A-1 — the profile-aware stages resolve the CUSTOMER's framework, not the static default", () => {
  for (const name of ["synthesis", "report-overview", "report-card"]) {
    const resolved = resolveSkillReads(name, { profile: CUSTOM, job: {} });
    assert.ok(resolved.includes(CUSTOM.frameworkPath),
      `${name}: a followup must point at the customer's own framework`);
    assert.ok(!resolved.includes("skills/prelim-search/risk-framework.md"),
      `${name}: …and must NOT fall back to the house default the static skillReads property names`);
    // the static property stays exactly as it was — it is metadata with its own contract, and
    // "reconciling" the two by deleting it is what the note above STAGES forbids
    assert.ok(Array.isArray(STAGES[name].skillReads) && STAGES[name].skillReads.length,
      `${name}: the declarative skillReads property is still there`);
  }
  assert.ok(resolveSkillReads("synthesis", { profile: null, job: { classes: ["5"] } })
    .includes("skills/prelim-search/field-doctrine-pharma.md"), "the pharma force-read reaches a corrective pass too");
});

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────────
// The behaviour above is proven on the composer. This asserts stageOnce actually routes through it —
// same pattern this repo already uses to pin `warm: r.warm` reaching journalStageInputs. Without it,
// reverting one line in pipeline.mjs passes every test in this file.
test("A-1 — stageOnce composes the followup instead of replacing the message", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /const message = opts\.followup \?\? opts\.freshMessage \?\?/,
    "the replace-wholesale form must not come back");
  assert.match(src, /composeFollowup\(name, ctx, \{/, "stageOnce routes the patch branch through the composer");
  assert.match(src, /inputs: stageInputs\(name, P,[^)]*\)[\s\S]{0,80}?existsSync/,
    "…and hands it the declared inputs filtered to what is actually on disk");
});

// The load-bearing fact under all of the above, asserted rather than remembered: if an engine ever starts
// resuming by sessionKey, a followup WOULD arrive warm and this whole design needs revisiting.
test("A-1 — no engine resumes by sessionKey; resumeRef is the only continuity mechanism", () => {
  const dir = new URL("../engine/", import.meta.url);
  for (const f of nonEmpty(readdirSync(dir).filter((n) => n.endsWith("-agent.mjs")), "readdirSync(dir).filter((n) => n.endsWith(\"-agent.mjs\"))")) {
    const src = readFileSync(new URL(f, dir), "utf8");
    assert.ok(!/\bsessionKey\b/.test(src),
      `${f} references sessionKey — if it now resumes by key, a followup is no longer a fresh session and A-1's premise must be re-checked`);
    assert.match(src, /\bresumeRef\b/, `${f} still takes resumeRef, the only continuity mechanism`);
  }
});
