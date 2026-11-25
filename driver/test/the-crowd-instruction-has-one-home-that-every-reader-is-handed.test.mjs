// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE CROWD INSTRUCTION HAS ONE HOME, AND EVERY STAGE THAT APPLIES IT IS HANDED IT. "At every step: look at what you have
// before you work on it" tells each stage how to handle a crowded answer. It was copied word for word into four manuals,
// and a copy edited on its own would have told one stage something the others were not told. It now lives in one manual
// (CROWD_DOC), and each stage that applied a copy reads that manual beside its own. Read here: no other manual carries the
// paragraph, every such stage declares the manual exactly once, and its opening message names it once, so the gateway
// inlines it once. The placement inquiry's own reading instruction quotes the first sentences and is not a copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CROWD_DOC, resolveSkillReads, STAGES, paths } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";

const DRIVER = join(import.meta.dirname, "..");
const SKILLS = join(DRIVER, "skills");
const HEADING = /^#{1,3} At every step: look at what you have before you work on it$/m;
// The paragraph's opening, as a pattern: a test quotes no sentence of a gathered manual.
const OPENING = /Fifty\? Read them all\. A few hundred\? Sort by the client's goods and markets, read the near ones first, list the rest\./;
const flat = (t) => t.replace(/\s+/g, " ");

function manuals(dir = SKILLS) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? manuals(join(dir, e.name))
    : e.name.endsWith(".md") ? [join(dir, e.name)] : []));
}
const rel = (file) => `skills/${relative(SKILLS, file).split(sep).join("/")}`;

// Every stage that applied a copy of the paragraph before it moved: the writers and the review (report-prose.md), the
// common-law seats (the common-law spine), the register unit and write-up (the register spine).
const CLEARANCE_READERS = ["common-law", "common-law-half", "synthesis", "narrative-refutation", "report-overview", "report-card",
  "register-unit", "register-digest"];

test("one manual carries the paragraph under its heading, and no other manual carries it", () => {
  const carriers = manuals().filter((f) => HEADING.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(carriers, [CROWD_DOC], "the crowd instruction is under its heading in some other manual again");
  const whole = manuals().filter((f) => OPENING.test(flat(readFileSync(f, "utf8")))).map(rel);
  assert.deepEqual(whole.filter((f) => f !== CROWD_DOC && !f.startsWith("skills/placement-inquiry/")), [],
    "a manual copied the crowd paragraph back in");
  assert.match(flat(readFileSync(join(DRIVER, CROWD_DOC), "utf8")), /to the off-register sweep and to the write-up alike\./,
    "premise: the shared manual holds the paragraph to its last sentence");
});

test("every stage that applies the paragraph declares its one home, once", () => {
  for (const stage of CLEARANCE_READERS) {
    const reads = resolveSkillReads(stage, { profile: null, job: {} });
    assert.equal(reads.filter((r) => r === CROWD_DOC).length, 1, `${stage} does not read the crowd instruction exactly once`);
  }
  assert.equal(KO_STAGES["knockout-register-read"].skillReads.filter((r) => r === CROWD_DOC).length, 1,
    "the Knockout's register reader does not read the crowd instruction exactly once");
  // CONTROL: the check can say no. The frame holds no register answer, so it is not handed the instruction.
  assert.equal(resolveSkillReads("matter-frame", { profile: null, job: {} }).includes(CROWD_DOC), false);
});

test("the register unit's and write-up's opening messages name it once, between the spine and their own manual", () => {
  for (const [stage, mode] of [["register-unit", "unit.md"], ["register-digest", "digest.md"]]) {
    const message = STAGES[stage].message({ profile: {}, job: {}, paths: paths("/nonexistent/invented-run"), axis: "primary-sweep",
      run: { slug: "invented", codename: "invented" } });
    const sentence = message.match(/First, read and follow exactly: [^\n]*?\.md(?: \([^)]*\))?\.(?=\s|$)/)?.[0] ?? "";
    assert.ok(sentence, `premise: ${stage} opens with its read sentence`);
    assert.equal(sentence.split(CROWD_DOC).length - 1, 1, `${stage} names the crowd instruction ${sentence.split(CROWD_DOC).length - 1} times`);
    assert.ok(sentence.indexOf("clearance-register/SKILL.md") < sentence.indexOf(CROWD_DOC)
      && sentence.indexOf(CROWD_DOC) < sentence.indexOf(`clearance-register/${mode}`), `${stage}: the manuals are out of order`);
  }
});
