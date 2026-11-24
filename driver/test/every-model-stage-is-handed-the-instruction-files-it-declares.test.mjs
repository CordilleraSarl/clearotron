// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EVERY MODEL STAGE IS HANDED THE INSTRUCTION FILES IT DECLARES, AS FILES THAT EXIST, ON BOTH ENGINES.
//
// A stage's standing instructions are the files its definition declares: `resolveSkillReads` for the
// clearance stages, and for the knockout lane its `skillReads` plus the framework deck the lane resolves
// for the run. The opening message names them as `skills/…` references, and each engine rewrites those
// references into absolute paths before the prompt leaves the driver: Claude inside `buildClaudeArgs`,
// with its own copy of the rewrite (that module imports nothing but node built-ins), and Codex through
// `absolutizeSkillRefs` in engine/common.mjs, the copy the Codex adapter calls.
//
// What is already held elsewhere: stages-followup.test.mjs proves that every CLEARANCE stage's opening
// message names each file `resolveSkillReads` declares, and that a follow-up points at the same files.
// What nothing held: the knockout lane, that the message names nothing BESIDES its declared files (a
// file named only in the opening message is lost to every follow-up, which is a fresh session composed
// from the declared list), that each declared file is in the shipped tree, and that each engine's own
// rewrite turns every declared reference into the absolute path of that file. A declared file the tree
// does not hold, or a reference one engine's rewrite misses, reaches the model as a path to nothing, and
// nothing fails: the model reads what it can and carries on.
//
// Invented values only. The contexts carry no customer, mark or owner of any real matter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";
import { requireRegisterProvider } from "../driver.config.mjs";
import { buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { absolutizeSkillRefs as codexRewrite, claudeTurnInstructions } from "../engine/common.mjs";
import { STAGE_DECLARATIONS, turnOutputOf } from "../stage-declarations.mjs";
import { declaredStageOfLabel } from "../engine/mcp/gather-config.mjs";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";
import { skillRefsIn } from "../methodology-witness.mjs";
import { DRIVER, SKILLS, CLEARANCE_CTXS, knockoutDispatches, everyModelStageDispatch } from "./model-stage-dispatches.mjs";

const RUN = "/nonexistent/invented-run";

// ── FILES AN OPENING MESSAGE NAMES THAT ITS STAGE DOES NOT DECLARE ──────────────────────────────────────
//
// Each is read by the stage's first session and by no follow-up: a follow-up is composed from the declared
// list (`composeFollowup`), and it is a fresh session (stages-followup.test.mjs pins that no engine resumes
// by session key). Listed here, with what it is, so a new one cannot arrive unnoticed and a fix shows as a
// change to this list rather than as silence. Keyed by stage and context label.
const NAMED_NOT_DECLARED = Object.freeze({
  // The active register provider's operator manual, which the search unit's opening message names beside
  // its two declared files. Its follow-ups name it too, through the stage's `followupSkillReads` (packet row D11).
  "register-unit": () => [`skills/clearance-register/providers/${requireRegisterProvider()}.md`],
});

const dispatches = () => everyModelStageDispatch(RUN);

test("every model stage is composed and checked: the clearance stages under every context, and the knockout lane", () => {
  const all = dispatches();
  const names = new Set(all.map((d) => d.name));
  for (const n of [...Object.keys(STAGES), ...Object.keys(KO_STAGES)]) assert.ok(names.has(n), `${n} was not composed`);
  assert.equal(all.length, Object.keys(STAGES).length * CLEARANCE_CTXS.length + Object.keys(KO_STAGES).length);
  // A stage that reads no file is allowed (doubt-closure works from its message alone), but most read
  // several: a population with no reads at all would make every check below pass on nothing.
  assert.ok(all.filter((d) => d.declared.length).length >= 30, "almost no stage declares an instruction file");
});

test("the register search's follow-ups are pointed at the active provider's manual, which is in the tree", async () => {
  const { composeFollowup } = await import("../stages.mjs");
  const deck = `skills/clearance-register/providers/${requireRegisterProvider()}.md`;
  const msg = composeFollowup("register-unit", { axis: "primary-sweep" }, { followup: "an invented follow-up instruction" });
  assert.ok(msg.split("\n")[0].includes(deck), `the follow-up's methodology line does not name ${deck}:\n${msg.split("\n")[0]}`);
  assert.ok(existsSync(join(DRIVER, deck)) && statSync(join(DRIVER, deck)).size > 0, `${deck} is not in the shipped tree`);
  // Each engine's rewrite turns it into the file's absolute path, as every other instruction reference.
  assert.ok(codexRewrite(msg, SKILLS).includes(join(DRIVER, deck)), "the Codex rewrite does not reach it");
  assert.ok(buildClaudeArgs({ message: msg, model: "opus", thinking: "low", cwd: "/tmp", skillsDir: SKILLS, runDir: RUN }).input.includes(join(DRIVER, deck)),
    "the Claude rewrite does not reach it");
});

test("every instruction file a model stage declares is in the shipped tree, and is not empty", () => {
  const missing = [];
  for (const d of dispatches()) {
    for (const f of d.declared) {
      const p = join(DRIVER, f);
      if (!existsSync(p)) missing.push(`${d.name} (${d.label}): ${f} is not in the tree`);
      else if (!statSync(p).size) missing.push(`${d.name} (${d.label}): ${f} is empty`);
    }
  }
  assert.deepEqual(missing, [], "declared instruction files the model would be pointed at and could not read");
});

test("every knockout stage's opening message names each instruction file it declares, the framework deck included", () => {
  for (const d of knockoutDispatches(RUN)) {
    const named = skillRefsIn(d.message);
    for (const f of d.declared) assert.ok(named.includes(f), `${d.name}: its message never names ${f}`);
  }
});

test("an opening message names no instruction file beyond those its stage declares, except the ones listed here", () => {
  const unlisted = [], stale = [];
  for (const d of dispatches()) {
    const extra = skillRefsIn(d.message).filter((f) => !d.declared.includes(f)).sort();
    const listed = (NAMED_NOT_DECLARED[`${d.name}@${d.label}`] ?? NAMED_NOT_DECLARED[d.name])?.() ?? [];
    for (const f of extra) if (!listed.includes(f)) unlisted.push(`${d.name} (${d.label}): names ${f}, which it does not declare`);
    for (const f of listed) if (!extra.includes(f)) stale.push(`${d.name} (${d.label}): ${f} is listed here but no longer named-and-undeclared`);
  }
  assert.deepEqual(unlisted, [], "a file the first session reads and every follow-up loses: declare it, or list it above with what it is");
  assert.deepEqual(stale, [], "a listed file is now declared or no longer named: delete its entry in the commit that changed it");
});

test("each engine's own rewrite turns every declared instruction reference into the absolute path of that file", () => {
  const lost = [];
  for (const d of dispatches()) {
    const claude = buildClaudeArgs({ message: d.message, model: "opus", thinking: "low", cwd: "/tmp", skillsDir: SKILLS, runDir: RUN }).input;
    const codex = codexRewrite(d.message, SKILLS);
    for (const f of d.declared) {
      const abs = join(DRIVER, f);
      if (!claude.includes(abs)) lost.push(`claude, ${d.name} (${d.label}): ${f} did not become ${abs}`);
      if (!codex.includes(abs)) lost.push(`codex, ${d.name} (${d.label}): ${f} did not become ${abs}`);
    }
    // Nothing is left as a bare relative reference, which the engine's working folder would not resolve.
    for (const [engine, text] of [["claude", claude], ["codex", codex]]) {
      const bare = skillRefsIn(text);
      if (bare.length) lost.push(`${engine}, ${d.name} (${d.label}): left relative: ${bare.join(", ")}`);
    }
  }
  assert.deepEqual(lost, [], "instruction references that reach a model as something other than the file's absolute path");
});

test("the two engines' rewrites hand every stage the same instruction paths", () => {
  for (const d of dispatches()) {
    const claude = buildClaudeArgs({ message: d.message, model: "opus", thinking: "low", cwd: "/tmp", skillsDir: SKILLS, runDir: RUN }).input;
    assert.equal(claude, codexRewrite(d.message, SKILLS), `${d.name} (${d.label}): Claude and Codex are handed different instruction paths`);
  }
});

test("the system-level instruction reaches both engines on every stage, fresh and resumed, the stage's own output rule byte for byte", async () => {
  // Each stage's output rule is chosen by how it returns its result (stage-declarations.mjs, turnOutputOf): its record
  // tool, by name, or the file it writes. Claude carries it as its appended system prompt with the evidence rule, Codex as
  // its developer instructions with the temp-folder rule, and the two carry the same output rule.
  const { codexDeveloperInstructions } = await import("../engine/openai-agent.mjs");
  const kinds = new Set();
  for (const d of dispatches()) {
    const output = turnOutputOf(STAGE_DECLARATIONS[declaredStageOfLabel(d.name)] ?? null);
    kinds.add(output.kind);
    for (const resumeRef of [undefined, "invented-session"]) {
      const { args } = buildClaudeArgs({ message: d.message, model: "opus", thinking: "low", cwd: "/tmp", skillsDir: SKILLS, runDir: RUN, resumeRef, output });
      const at = args.indexOf("--append-system-prompt");
      assert.ok(at >= 0 && args[at + 1] === claudeTurnInstructions(output),
        `claude, ${d.name}${resumeRef ? " (resumed)" : ""}: the stage's output rule is not appended`);
    }
    if (output.kind === "record") assert.ok(claudeTurnInstructions(output).includes(`calling \`${output.tool}\``), `${d.name}: the rule does not name the stage's own record tool`);
    assert.doesNotMatch(claudeTurnInstructions(output), /Write tool|Edit tool|WRITE TOOL/, `${d.name}: the rule names one engine's own file tool`);
    const developerInstructions = codexDeveloperInstructions({ output });
    assert.ok(developerInstructions.startsWith(claudeTurnInstructions(output).replace(/ Use only this run's supplied evidence and accepted work\.$/, "")),
      `codex, ${d.name}: not the output rule Claude is given`);
    const toml = renderCodexConfigToml({ mcpConfig: null, allowedTools: "", developerInstructions });
    const line = toml.split("\n").find((l) => l.startsWith("developer_instructions = "));
    assert.ok(line, "codex: no developer instructions in the rendered configuration");
    assert.equal(JSON.parse(line.slice("developer_instructions = ".length)), developerInstructions,
      `codex, ${d.name}: the developer instructions are not the output rule plus the temp-folder rule`);
  }
  assert.deepEqual([...kinds].sort(), ["file", "record"], "the stages cover both a recording stage and a writing stage");
});
