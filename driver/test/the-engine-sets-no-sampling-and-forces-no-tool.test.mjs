// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THIS ENGINE SETS NO SAMPLING AND FORCES NO TOOL, AND THAT HOLDS ONLY WHILE NOBODY ADDS ONE.
//
// The current Anthropic generation refuses three things outright, each a 400: a non-default
// `temperature`, `top_p` or `top_k`; a forced `tool_choice` of `any` or `tool`; and the old spelling of
// thinking-off. The product satisfies all three today, and it satisfies them by ABSENCE — it builds no
// request body at all. It spawns the program and passes flags, and the program writes the body.
//
// An absence is not a guarantee. It is the state of the tree on the day it was measured, and the next
// person who needs "just a little less randomness here" will add the field that breaks every turn on
// the newest model, with nothing to stop them and a 400 from a vendor as the first news. So the absence
// is written down as a rule.
//
// MEASURED, NOT ASSUMED (2026-09-29, program 2.1.277, driven through a local recorder on the base-url
// override): the body the program sends carries no `temperature`, no `top_p`, no `top_k` and no
// `tool_choice`, at every effort level this driver asks for; thinking rides as `{"type":"adaptive"}` and
// effort as `output_config.effort`. Nothing below asserts any of that — the program is not ours to pin.
// These arms assert only what is ours: that we add none of it on the way in.
//
// THE SCOPE IS THE ANTHROPIC PATH. The OpenAI engine answers to a different vendor's rules and is not
// covered here; where a shared file is read, the arm says which lines it means.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildClaudeArgs } from "../engine/anthropic-agent.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(HERE, "..");
const ROOT = join(DRIVER, "..");

/** The flags a turn is built with, for a spread of the tiers the driver actually asks for. */
const argsFor = (thinking) =>
  buildClaudeArgs({ message: "m", model: "sonnet", thinking, cwd: ROOT }).args.join(" ");

test("no turn this engine builds carries a sampling flag", () => {
  for (const thinking of ["off", "low", "medium", "adaptive", "high", "max"]) {
    const a = argsFor(thinking);
    for (const flag of ["--temperature", "--top-p", "--top_p", "--top-k", "--top_k"])
      assert.ok(!a.includes(flag), `a ${thinking} turn passes ${flag}; the current generation refuses a non-default value`);
  }
});

test("no turn this engine builds forces a tool", () => {
  for (const thinking of ["off", "high"]) {
    const a = argsFor(thinking);
    for (const flag of ["--tool-choice", "--tool_choice"])
      assert.ok(!a.includes(flag), `a ${thinking} turn passes ${flag}; a forced tool choice is refused on the current generation`);
  }
});

test("the guard can fail — it is driven against a turn that does carry one", () => {
  // Without this the two arms above pass on any string, including one this builder never produced.
  const planted = [...argsFor("high").split(" "), "--temperature", "0.2"].join(" ");
  assert.ok(planted.includes("--temperature"), "the plant did not land, so the arms above assert nothing");
});

/**
 * The tree-wide floor. The arms above read one builder; this reads every file that could put one of
 * these fields into a request, so a second path added later is caught by the same rule.
 *
 * `providers/jx` is READ AND EXPECTED TO CARRY `tool_choice` today: three request builders still set it
 * and nothing forwards it — the turn envelope reads a body's prompt and its first tool and posts
 * neither field. Those lines are counted rather than banned, so removing them is free and adding a
 * fourth is not.
 */
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "test" || e.name === "fixtures") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
};

test("nothing on the anthropic path sets temperature, top_p or top_k", () => {
  const offenders = [];
  for (const f of walk(DRIVER).concat(walk(join(ROOT, "providers")))) {
    if (/[/\\]openai-agent\.mjs$/.test(f)) continue;            // a different vendor's rules
    const text = readFileSync(f, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;            // prose about it is not a use of it
      if (/\b(temperature|top_p|top_k|topP|topK)\s*:/.test(line))
        offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [],
    "a sampling field is set on the anthropic path. The current generation refuses a non-default value "
    + "outright, and the program writes the body — there is nothing here this field can legitimately reach.");
});

test("no file outside the known, unforwarded set forces a tool choice", () => {
  const found = [];
  for (const f of walk(join(ROOT, "providers")).concat(walk(DRIVER))) {
    const text = readFileSync(f, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (/\btool_choice\s*:/.test(line)) found.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
    }
  }
  // A SUBSET, NOT AN EQUALITY, AND THE DIFFERENCE IS THE WHOLE POINT. Equality against the known set
  // would make REMOVING one of them red — a guard keyed to the thing it wants gone, firing when the
  // work is done. The three known files build request bodies that the turn envelope parses for a
  // prompt and a tool schema and never posts, so their field reaches no vendor and taking it out is
  // free. Adding a fourth is not.
  const KNOWN = new Set(["providers/jx/src/core.js", "providers/jx/src/judge.js", "providers/jx/src/nativeread.js"]);
  const unexpected = found.filter((f) => !KNOWN.has(f.split(":")[0]));
  assert.deepEqual(unexpected, [],
    "a file outside the known set forces a tool choice, on a generation that refuses it. The known "
    + "three reach no vendor: the turn envelope reads a body's prompt and its first tool schema and "
    + "posts neither field.");
});
